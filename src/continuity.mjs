import {randomUUID} from 'node:crypto';
import {exact,fail,digest} from './contracts.mjs';
import {authorize,project} from './security.mjs';

export async function checkContinuity(u,c,object,request) {
 const mode=(await u.continuity(c.tenant,object.store))?.mode??'NORMAL';
 if(mode==='RECOVERING'||await u.recoveryHold(c.tenant,object.store,object.id))fail('INCONSISTENT_STATE');
 if(mode==='DEGRADED' && !(request.actionType==='SetIsolation'&&request.input.isolated===true || request.actionType==='QuarantineInventory'))fail('CONTINUITY_RESTRICTED');
 // Finite local quarantine bound. Existing Rule/Workflow and approvals still apply.
 if(mode==='DEGRADED' && (object.fields.quantity>100 || request.input.quantity>100))fail('CONTINUITY_RESTRICTED');
}
export function continuitySet(k,credential,body,options) {
 exact(body,['store','mode','expectedRevision']);
 if(!['DEGRADED','RECOVERING'].includes(body.mode)||!Number.isInteger(body.expectedRevision)||body.expectedRevision<0)fail('INVALID_ARGUMENT');
 return k.state.admission(()=>k.call(credential,'recovery',async(u,c)=>{
  if(!c.stores.includes(body.store))fail('PERMISSION_DENIED');
  const current=await u.continuity(c.tenant,body.store);
  if((current?.revision??0)!==body.expectedRevision)fail('CONFLICT');
  if(current?.mode==='RECOVERING'&&body.mode!=='RECOVERING')fail('INCONSISTENT_STATE');
  const result={actionType:'ContinuityMode',actionId:randomUUID(),store:body.store,mode:body.mode,revision:body.expectedRevision+1};
  await u.client.query('INSERT INTO continuity VALUES($1,$2,$3,$4) ON CONFLICT(tenant,store) DO UPDATE SET mode=excluded.mode,revision=excluded.revision',[c.tenant,body.store,body.mode,result.revision]);
  await u.audit({...result,kind:'ContinuityMode',actor:c.actor});return result;
 },options),options);
}
// Recovery takes a store and checkpoint label, never a controller operation-ID list.
// Admission lock drains submissions and blocks dispatch via durable RECOVERING mode.
export function recover(k,credential,body,options) {
 exact(body,['store','checkpoint']);
 if(typeof body.checkpoint!=='string'||!body.checkpoint||body.checkpoint.length>128)fail('INVALID_ARGUMENT');
 return k.state.admission(()=>k.call(credential,'recovery',async(u,c)=>{
  if(!c.stores.includes(body.store))fail('PERMISSION_DENIED');
  if((await u.continuity(c.tenant,body.store))?.mode!=='RECOVERING')fail('INCONSISTENT_STATE');
  const snapshot=k.journal.snapshot(c,body.store),rows=[];let cursor=0;
  do {const page=k.journal.list(c,snapshot,cursor,100);rows.push(...page.records);cursor=page.nextCursor;}while(cursor!==null);
  const operations=new Map();for(const row of rows)if(row.operationKind!=='delivery')operations.set(row.operationId,row);
  const pending=(await u.client.query("SELECT a.*,o.event FROM actions a LEFT JOIN outbox o ON o.action_id=a.id WHERE a.tenant=$1 AND a.store=$2 AND a.state IN ('PENDING_EXTERNAL','MANUAL_REVIEW')",[c.tenant,body.store])).rows;
  for(const a of pending)if(!operations.has(a.operation_id))fail('INCONSISTENT_STATE');
  const results=[];
  for(const row of operations.values()) {
   if(row.phase==='ABORTED'&&!rows.some(r=>r.operationId===row.operationId&&r.phase==='COMMITTED'))continue;
   let action=await u.action(row.actionId,true);const outbox=await u.outbox(row.operationId,true);
   if(action&&(action.digest!==row.canonicalDigest||action.operation_id!==row.operationId||action.key!==row.idempotencyKey))fail('INCONSISTENT_STATE');
   const committed=rows.filter(r=>r.operationId===row.operationId&&r.phase==='COMMITTED').at(-1);
   // A surviving Action ID does not prove a later approval/Object commit survived restore.
   const expectedEvent=committed?.externalEvent;
   let lostLocalCommit=Boolean(committed&&!action);
   if(committed&&action&&expectedEvent) {
    const history=(await u.client.query('SELECT * FROM history WHERE object_id=$1 AND revision=$2 AND action_id=$3',[expectedEvent.aggregateId,expectedEvent.objectRevision,row.actionId])).rows[0];
    const object=await u.object(expectedEvent.aggregateId);
    lostLocalCommit=!outbox||digest(outbox.event)!==digest(expectedEvent)||!history||digest(history.fields)!==digest(expectedEvent.fields)||!object||object.revision<expectedEvent.objectRevision||!Number.isInteger(action.result.objectRevision)||action.result.objectRevision<expectedEvent.objectRevision;
   }
   const event=expectedEvent??outbox?.event;
   let external='UNKNOWN';
   if(event) {
    if(event.operationId!==row.operationId||event.actionId!==row.actionId||event.tenant!==c.tenant||event.store!==body.store)fail('INCONSISTENT_STATE');
    try {external=(await k.writeback.port.status(k.writeback.payload({event}),options)).state;}catch {external='UNKNOWN';}
   }
   let classification='manual',reason='unknown-external-outcome';
   if(lostLocalCommit)reason=committed?.operationKind==='approval'?'lost-approved-commit':'lost-local-commit';
   if(!lostLocalCommit&&action&&row.phase==='COMMITTED'&&['APPLIED','DUPLICATE'].includes(external)&&outbox){await k.writeback.finish(u,c,outbox,action,{state:external});classification='applied';reason=null;}
   else if(!lostLocalCommit&&action&&outbox&&outbox.attempt===0&&committed?.deliveryProtocol==='journal-send-v1'&&!rows.some(r=>r.operationId===row.operationId&&r.phase==='SEND_STARTED')&&row.phase==='COMMITTED'&&external==='UNKNOWN'){classification='unapplied';reason='durable-outbox-never-leased';}
   else if(!lostLocalCommit&&action&&!outbox&&!expectedEvent&&row.phase==='COMMITTED'&&action.state!=='MANUAL_REVIEW'){classification='local-only';reason=null;}
   else if(!action) {
    // Restore only key/identity/result binding, never invent lost Object/history/Audit.
    action={id:row.actionId,tenant:row.tenant,store:row.store,actor:row.actor,subject:row.subject,key:row.idempotencyKey,digest:row.canonicalDigest,state:'MANUAL_REVIEW',request:{...row.typedInput,delegationId:row.delegationId},result:{targetId:row.typedInput.input.targetId,recovery:true,external},operation_id:row.operationId};
    await u.saveAction(action);if(!lostLocalCommit)reason='unconfirmed-intent';
   }
   if(classification==='manual'&&action.state!=='MANUAL_REVIEW')await u.updateAction(action.id,'MANUAL_REVIEW',{...action.result,recovery:true,external});
   const result={operationId:row.operationId,actionId:row.actionId,idempotencyKey:row.idempotencyKey,canonicalDigest:row.canonicalDigest,targetId:row.typedInput.input.targetId,classification,external,lostLocalCommit,commitEvidence:committed?{journalHash:committed.recordHash,operationKind:committed.operationKind,commitRevisions:committed.commitRevisions}:null,reason,elapsedSinceCommitMs:row.committedAt?Math.max(0,Date.now()-Date.parse(row.committedAt)):null,owner:classification==='manual'?'store-approver/platform-operations':null,nextReconcile:classification==='manual'?'ERP ledger + local repair review':null,observedAt:new Date().toISOString(),checkpoint:body.checkpoint,journalEvidence:row.recordHash};
   await u.client.query('INSERT INTO recovery_observations VALUES($1,$2,$3,$4) ON CONFLICT(tenant,store,operation_id) DO UPDATE SET record=excluded.record',[c.tenant,body.store,row.operationId,result]);
   await u.audit({kind:'RecoveryObserved',actor:c.actor,...result,snapshot});results.push(result);
  }
  // Full classification allows unrelated targets to resume; manual targets remain held.
  // Unconfirmed INTENT remains a global journal fence even after classification.
  if(!k.journal.fenced())await u.client.query("UPDATE continuity SET mode='NORMAL',revision=revision+1 WHERE tenant=$1 AND store=$2",[c.tenant,body.store]);
  return {snapshot,results,unresolved:results.filter(r=>r.classification==='manual'),fenced:k.journal.fenced()};
 },options),options);
}
export async function compensate(k,credential,body,options) {
 exact(body,['actionId','expectedRevision','idempotencyKey']);
 const prepared=await k.call(credential,'action',async(u,c,d)=>{
  const a=await u.action(body.actionId);if(!a||a.tenant!==c.tenant||!c.stores.includes(a.store))fail('NOT_FOUND');
  if(a.state!=='SUCCEEDED'||a.request.actionType!=='SetIsolation'||a.request.input.isolated!==true)fail('MANUAL_REVIEW_REQUIRED');
  const object=await u.object(a.request.input.targetId);authorize(c,object);
  return {original:a,request:{actionType:'SetIsolation',actionVersion:d.actions.SetIsolation.version,ontologyVersion:d.ontologyVersion,input:{targetId:object.id,isolated:false},expectedRevision:body.expectedRevision,idempotencyKey:body.idempotencyKey,evidence:[{id:object.id,revision:object.revision,digest:digest(project(c,object,d))}],requireApproval:true}};
 },options);
 return k.submit(credential,prepared.request,{...options,compensation:{actionId:prepared.original.id,operationId:prepared.original.operation_id}});
}
