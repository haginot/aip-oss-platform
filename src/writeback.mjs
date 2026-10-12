import {budget,checkBudget} from './budget.mjs';
import { enforcePolicy } from './definition-programs.mjs';
import { randomUUID } from 'node:crypto';
import { digest, fail } from './contracts.mjs';

// External contract 1.0.0 is an explicit per-Action projection, not an Object
// serializer. Keep it independent of the live Ontology so delivery and later
// reconciliation of an immutable event produce identical payload digests.
const impactFields = { phase: 'string', lotId: 'string', affectedIds: 'string', affectedStores: 'string', affectedQuantity: 'integer' };
const orderFields = { ...impactFields, candidateId: 'string', orderQuantity: 'integer', orderAmount: 'integer' };
const exportFields = {
  DetectRecallImpact: impactFields,
  QuarantineInventory: { isolated: 'boolean' },
  CreateReplacementOrder: orderFields,
  PublishCustomerNotice: { ...orderFields, customerMessage: 'string', customerCount: 'integer' }
};

// External effects are never inside the Kernel database transaction. A durable
// lease precedes send; unknown delivery must be resolved through the ledger.
export class Writeback {
  constructor(kernel, port) { this.kernel = kernel; this.port = port; }
  async checked(u, c, operationId, workerOperation) {
    const event = await u.outbox(operationId, true);
    if (!event || event.event.tenant !== c.tenant || !c.stores.includes(event.event.store)) fail('NOT_FOUND');
    const action = await u.action(event.action_id, true);
    if (!action || action.tenant !== c.tenant || !c.stores.includes(action.store)) fail('NOT_FOUND');
    if (action.operation_id !== operationId || action.store !== event.event.store) fail('INCONSISTENT_STATE');
    // Preserve only scope-authorized context outside the transaction, so a
    // rollback (including authority expiry after ERP commit) remains auditable.
    c.savedActionEvidence = { ...this.kernel.savedActionEvidence(action), workerOperation };
    if ((await u.continuity(c.tenant,event.event.store))?.mode==='RECOVERING') fail('INCONSISTENT_STATE');
    if (!this.kernel.journal.committed(operationId) || this.kernel.journal.fenced()) fail('INCONSISTENT_STATE');
    const definition=await u.definition();enforcePolicy(definition.body,'action');
    for (const id of [action.actor, action.subject]) {
      const p = await u.principal(id);
      if (!p?.active || p.tenant !== c.tenant || !p.stores.includes(action.store) || !p.operations.includes('action')) fail('PERMISSION_DENIED');
    }
    if (action.request.delegationId) {
      const d = await u.delegation(action.request.delegationId);
      if (!d?.active || d.expires.getTime() <= Date.now() || d.actor !== action.actor || d.subject !== action.subject || d.audience !== 'kernel' || !d.stores.includes(action.store) || !d.operations.includes('action')) fail('PERMISSION_DENIED');
      u.requireAuthorityUntil(d.expires);
    }
    if (digest(event.event) !== event.digest) fail('INCONSISTENT_STATE');
    this.payload(event); // Reject unsupported/malformed exports before leasing or HTTP.
    return { event, action };
  }
  payload(event) {
    const e = event.event;
    if (e.contractVersion !== '1.0.0' || typeof e.fields?.isolated !== 'boolean') fail('INCONSISTENT_STATE');
    const payload = { contractVersion: e.contractVersion, operationId: e.operationId, actionId: e.actionId, tenant: e.tenant, store: e.store, aggregateId: e.aggregateId, sequence: e.sequence, isolated: e.fields.isolated };
    if (e.actionType === undefined || e.actionType === 'SetIsolation') return payload;
    if (!Object.hasOwn(exportFields, e.actionType)) fail('INCONSISTENT_STATE');
    const fields = {};
    for (const [name, type] of Object.entries(exportFields[e.actionType])) {
      const value = e.fields[name];
      if (type === 'integer' ? !Number.isSafeInteger(value) : typeof value !== type) fail('INCONSISTENT_STATE');
      fields[name] = value;
    }
    return { ...payload, actionType: e.actionType, fields };
  }
  async dispatch(credential, { operationId }, options={}) {
    options=budget(options);const owner = randomUUID();
    const lease = await this.kernel.state.admission(()=>this.kernel.call(credential, 'worker', async (u, c) => {
      const { event } = await this.checked(u, c, operationId, 'dispatch');
      if((await u.continuity(c.tenant,event.event.store))?.mode==='DEGRADED') fail('CONTINUITY_RESTRICTED');
      if(await u.recoveryHold(c.tenant,event.event.store,event.event.aggregateId))fail('INCONSISTENT_STATE');
      if (event.state === 'DELIVERED') return { state: 'DUPLICATE' };
      if (event.state !== 'PENDING') return { state: event.state };
      if (!await u.lease(operationId, owner)) return { state: 'BUSY' };
      await u.sending(operationId);
      // Independent fsync before any HTTP send. DB rollback/restore can only overestimate attempts.
      const committed=this.kernel.journal.records().filter(r=>r.operationId===operationId&&r.phase==='COMMITTED').at(-1);
      if(!committed)fail('INCONSISTENT_STATE');
      const {recordHash,sequence,previousHash,...sendRecord}=committed;
      this.kernel.journal.append({...sendRecord,operationKind:'delivery',phase:'SEND_STARTED',deliveryOwner:owner,sendStartedAt:new Date().toISOString()});
      return { state: 'LEASED' };
    },options),options);
    if (lease.state !== 'LEASED') return lease;
    return this.kernel.call(credential, 'worker', async (u, c) => {
      const { event, action } = await this.checked(u, c, operationId, 'dispatch');
      if((await u.continuity(c.tenant,event.event.store))?.mode==='DEGRADED')fail('CONTINUITY_RESTRICTED');
      if(await u.recoveryHold(c.tenant,event.event.store,event.event.aggregateId))fail('INCONSISTENT_STATE');
      if (event.lease_owner !== owner || event.lease_until.getTime() <= Date.now()) fail('LEASE_EXPIRED');
      let result;
      try { result = await this.port.apply(this.payload(event),options); }
      catch { result = { state: 'UNKNOWN' }; }
      await this.kernel.fault('after-external');
      return this.finish(u, c, event, action, result);
    },options);
  }
  reconcile(credential, { operationId }, options={}) {
    options=budget(options);
    return this.kernel.call(credential, 'worker', async (u, c) => {
      const { event, action } = await this.checked(u, c, operationId, 'reconcile');
      let result;
      try { result = await this.port.status(this.payload(event),options); }
      catch { result = { state: 'UNKNOWN' }; }
      return this.finish(u, c, event, action, result);
    },options);
  }
  async finish(u, c, event, action, result) {
    // Missing ledger is never interpreted as proof of non-application.
    const state = ['APPLIED', 'DUPLICATE'].includes(result.state) ? 'DELIVERED' : result.state === 'GAP' ? 'PENDING' : result.state === 'REJECTED' ? 'REJECTED' : 'UNKNOWN';
    await u.finish(event.operation_id, state);
    const actionState = state === 'DELIVERED' ? 'SUCCEEDED' : state === 'REJECTED' ? 'EXTERNAL_FAILED' : 'PENDING_EXTERNAL';
    if (action.state !== actionState) await u.updateAction(action.id, actionState, { ...action.result, external: state });
    await u.audit({ kind: 'Writeback', operationId: event.operation_id, actionId: action.id, actor: c.actor, onBehalfOf: c.onBehalfOf, policyVersion: c.policyVersion, externalState: result.state, state });
    return { state, operationId: event.operation_id };
  }
}

export class HttpWritebackPort {
  constructor(url, token, { timeout = 1000 } = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') fail('INVALID_ARGUMENT');
    this.url = url; this.token = token; this.timeout = timeout;
  }
  async request(path, payload, options={}) {
    options=budget(options);
    const token = typeof this.token === 'function' ? await this.token(options) : this.token;
    checkBudget(options);
    const timeout=AbortSignal.timeout(Math.max(1,Math.min(this.timeout,options.deadline-Date.now())));
    const response = await fetch(this.url + path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: options.signal?AbortSignal.any([options.signal,timeout]):timeout });
    if (!response.ok) fail('UNAVAILABLE');
    const result = await response.json();
    if (result.operationId !== payload.operationId || result.digest !== digest(payload)) fail('INCONSISTENT_STATE');
    return result;
  }
  apply(payload,options) { return this.request('/apply', payload,options); }
  status(payload,options) { return this.request('/status', payload,options); }
}
