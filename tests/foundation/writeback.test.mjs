import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startCluster, fixture } from '../../scripts/foundation/runtime.mjs';
import { startErp } from '../../scripts/foundation/erp.mjs';
import { Writeback, HttpWritebackPort } from '../../src/writeback.mjs';
import { createGateway } from '../../src/gateway.mjs';
import { createClient } from '../../src/generated/client.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
let cluster;
before(async () => { cluster = await startCluster(); });
after(async () => { await cluster?.close(); });
async function run(fn) {
  const f = await fixture(cluster), erp = await startErp(cluster);
  const port = new HttpWritebackPort(erp.url, erp.token);
  const worker = new Writeback(f.kernel, port);
  f.kernel.writeback = worker;
  try { await fn({ ...f, erp, port, worker }); }
  finally { await erp.close(); await f.close(); }
}
const count = async (erp, table) => Number((await erp.owner.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
test('independent ERP HTTP ledger, effect and Kernel completion preserve original IDs', () => run(async f => {
  const a = await f.kernel.submit(f.credentials.operator, f.request());
  assert.equal((await f.worker.dispatch(f.credentials.manager, a)).state, 'DELIVERED');
  assert.equal((await f.kernel.status(f.credentials.operator, a)).state, 'SUCCEEDED');
  assert.equal((await f.worker.dispatch(f.credentials.manager, a)).state, 'DUPLICATE');
  assert.equal(await count(f.erp, 'ledger'), 1); assert.equal(await count(f.erp, 'effects'), 1);
  const ledger = (await f.erp.owner.query('SELECT * FROM ledger')).rows[0];
  assert.equal(ledger.operation_id, a.operationId); assert.equal(ledger.payload.actionId, a.actionId);
  assert.equal(ledger.payload.secret, undefined); assert.equal(f.erp.controller.applyRequests, 1);
  await assert.rejects(f.state.pool.query(`SELECT * FROM ${f.erp.database}.public.ledger`));
  const config = { ...cluster.config, user: 'foundation_app', database: f.erp.database };
  const { default: pg } = await import('pg'); const pool = new pg.Pool(config);
  try { await assert.rejects(pool.query('SELECT * FROM ledger')); } finally { await pool.end(); }
}));
test('generated HTTP client joins authorization, Action, projection Inbox, ERP and Audit', () => run(async f => {
  const server = createGateway(f.kernel); await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const operator = createClient({url,tenant:'t1',token:f.credentials.operator.token});
    const manager = createClient({url,tenant:'t1',token:f.credentials.manager.token});
    const a = await operator.submit(f.request());
    await f.kernel.consume(f.credentials.manager, a);
    await assert.rejects(operator.dispatch(a), e => e.code === 'PERMISSION_DENIED');
    assert.equal((await manager.dispatch(a)).state, 'DELIVERED');
    assert.equal((await operator.status(a)).state, 'SUCCEEDED');
    assert.equal((await operator.get({id:'stock'})).revision, 2);
    assert.equal(await count(f.erp, 'ledger'), 1);
    assert.equal(Number((await f.owner.query("SELECT count(*) FROM audit WHERE record->>'kind'='Writeback'")).rows[0].count), 1);
    const ledger=(await f.erp.owner.query('SELECT * FROM ledger')).rows;
    const audit=(await f.owner.query("SELECT record FROM audit WHERE record->>'actionId'=$1 OR record->>'operationId'=$2 ORDER BY sequence",[a.actionId,a.operationId])).rows;
    assert.ok(audit.some(row=>row.record.kind==='PENDING_EXTERNAL'));
    assert.ok(audit.some(row=>row.record.kind==='Writeback'&&row.record.state==='DELIVERED'));
    await mkdir('evidence/generated/foundation',{recursive:true});
    await writeFile('evidence/generated/foundation/writeback-trace.json',JSON.stringify({contractVersion:'1.0.0',action:a,final:await operator.status(a),object:await operator.get({id:'stock'}),ledger,audit},null,2)+'\n');
  } finally { await new Promise(resolve => server.close(resolve)); }
}));
test('ERP success with lost acknowledgement is UNKNOWN until ledger reconciliation; never resent', () => run(async f => {
  const a = await f.kernel.submit(f.credentials.operator, f.request()); f.erp.controller.mode = 'lost-ack';
  assert.equal((await f.worker.dispatch(f.credentials.manager, a)).state, 'UNKNOWN');
  assert.equal(await count(f.erp, 'ledger'), 1); assert.equal(await count(f.erp, 'effects'), 1);
  assert.equal((await f.worker.dispatch(f.credentials.manager, a)).state, 'UNKNOWN');
  assert.equal(f.erp.controller.applyRequests, 1);
  assert.equal((await f.worker.reconcile(f.credentials.manager, a)).state, 'DELIVERED');
  assert.equal((await f.kernel.status(f.credentials.operator, a)).state, 'SUCCEEDED');
  assert.equal(f.erp.controller.applyRequests, 1);
}));
test('partial ERP transaction rolls ledger and effect back; missing ledger remains UNKNOWN', () => run(async f => {
  const a = await f.kernel.submit(f.credentials.operator, f.request()); f.erp.controller.mode = 'rollback';
  assert.equal((await f.worker.dispatch(f.credentials.manager, a)).state, 'UNKNOWN');
  assert.equal(await count(f.erp, 'ledger'), 0); assert.equal(await count(f.erp, 'effects'), 0);
  f.erp.controller.mode = 'normal'; assert.equal((await f.worker.reconcile(f.credentials.manager, a)).state, 'UNKNOWN');
  assert.equal((await f.worker.dispatch(f.credentials.manager, a)).state, 'UNKNOWN'); assert.equal(f.erp.controller.applyRequests, 1);
}));
test('reverse delivery parks GAP, ordered delivery and ERP duplicate/key mismatch preserve one effect', () => run(async f => {
  const a = await f.kernel.submit(f.credentials.operator, f.request());
  const b = await f.kernel.submit(f.credentials.operator, f.request({ expectedRevision: 2, input: { targetId: 'stock', isolated: false } }));
  assert.equal((await f.worker.dispatch(f.credentials.manager, b)).state, 'PENDING');
  assert.equal((await f.worker.dispatch(f.credentials.manager, a)).state, 'DELIVERED');
  assert.equal((await f.worker.dispatch(f.credentials.manager, b)).state, 'DELIVERED');
  const payload = (await f.erp.owner.query('SELECT payload FROM ledger WHERE operation_id=$1', [a.operationId])).rows[0].payload;
  assert.equal((await f.port.apply(payload)).state, 'DUPLICATE');
  await assert.rejects(f.port.apply({ ...payload, isolated: false }));
  assert.equal(await count(f.erp, 'ledger'), 2); assert.equal((await f.erp.owner.query('SELECT * FROM effects')).rows[0].sequence, 2);
}));
test('worker denial, delegation revocation and policy outage precede HTTP dispatch', () => run(async f => {
  const a = await f.kernel.submit(f.credentials.delegated, f.request());
  await assert.rejects(f.worker.dispatch(f.credentials.other, a), e => e.code === 'NOT_FOUND');
  await f.owner.query("UPDATE delegations SET operations='[\"read\"]' WHERE id='delegation'");
  await assert.rejects(f.worker.dispatch(f.credentials.manager, a), e => e.code === 'PERMISSION_DENIED');
  await f.owner.query('UPDATE policy SET available=false');
  await assert.rejects(f.worker.dispatch(f.credentials.manager, a), e => e.code === 'UNAVAILABLE');
  assert.equal(f.erp.controller.applyRequests, 0); assert.equal(await count(f.erp, 'ledger'), 0);
}));
test('explicit external rejection and lease ownership prevent false success', () => run(async f => {
  const a = await f.kernel.submit(f.credentials.operator, f.request());
  await f.owner.query("UPDATE outbox SET lease_owner='other',lease_until=now()+interval '1 hour'");
  assert.equal((await f.worker.dispatch(f.credentials.manager, a)).state, 'BUSY');
  await f.owner.query("UPDATE outbox SET lease_until=now()-interval '1 second'");
  f.erp.controller.mode = 'reject';
  assert.equal((await f.worker.dispatch(f.credentials.manager, a)).state, 'REJECTED');
  assert.equal((await f.kernel.status(f.credentials.operator, a)).state, 'EXTERNAL_FAILED');
  assert.equal(await count(f.erp, 'ledger'), 0); assert.equal(await count(f.erp, 'effects'), 0);
}));
test('failure after external apply leaves durable SENDING fence and reconciliation recovers', () => run(async f => {
  const a = await f.kernel.submit(f.credentials.operator, f.request());
  f.kernel.fault = async point => { if (point === 'after-external') throw Error('worker failure'); };
  await assert.rejects(f.worker.dispatch(f.credentials.manager, a));
  assert.equal((await f.worker.dispatch(f.credentials.manager, a)).state, 'SENDING');
  f.kernel.fault = async () => {};
  assert.equal((await f.worker.reconcile(f.credentials.manager, a)).state, 'DELIVERED');
  assert.equal(f.erp.controller.applyRequests, 1); assert.equal(await count(f.erp, 'ledger'), 1);
}));
