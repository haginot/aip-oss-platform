import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startCluster, fixture } from '../../scripts/foundation/runtime.mjs';
import { startErp } from '../../scripts/foundation/erp.mjs';
import { Kernel } from '../../src/kernel.mjs';
import { RecoveryJournal } from '../../src/adapters/journal.mjs';
import { Writeback, HttpWritebackPort } from '../../src/writeback.mjs';
import { digest } from '../../src/contracts.mjs';
let cluster;
before(async () => { cluster = await startCluster(); });
after(async () => { await cluster?.close(); });
const day = 86400000;
async function run(t, fn) {
  const f = await fixture(cluster), erp = await startErp(cluster);
  await f.owner.query("UPDATE sessions SET expires='2100-01-01'::timestamptz");
  const port = new HttpWritebackPort(erp.url, erp.token);
  const restart = () => {
    f.kernel = new Kernel(f.state, new RecoveryJournal(f.journal.path));
    f.worker = new Writeback(f.kernel, port);
  };
  restart();
  try { await fn({ ...f, erp, port, restart, current: () => f }); }
  finally { t.mock.timers.reset(); await erp.close(); await f.close(); }
}
const count = async (pool, table) => Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
for (const [label, elapsed] of [['30 days minus one second',30*day-1000],['30 days',30*day],['30 days plus one second',30*day+1000],['18 years',18*366*day]]) {
  test(`retained Action key, Inbox, ERP ledger and Audit survive ${label}`, t => run(t, async f => {
    const request = f.request();
    const a = await f.kernel.submit(f.credentials.operator, request);
    await f.kernel.consume(f.credentials.manager, a);
    assert.equal((await f.worker.dispatch(f.credentials.manager, a)).state, 'DELIVERED');
    const originalAudit = (await f.owner.query('SELECT * FROM audit ORDER BY sequence')).rows;
    const payload = (await f.erp.owner.query('SELECT payload FROM ledger')).rows[0].payload;
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() + elapsed });
    f.restart(); const reopened = f.current();
    const replay = await reopened.kernel.submit(f.credentials.operator, request);
    assert.equal(replay.actionId, a.actionId); assert.equal(replay.operationId, a.operationId);
    await assert.rejects(reopened.kernel.submit(f.credentials.operator, { ...request, input: {targetId:'stock',isolated:false} }), e => e.code === 'IDEMPOTENCY_MISMATCH');
    assert.equal((await reopened.kernel.consume(f.credentials.manager, a)).state, 'DUPLICATE');
    assert.equal((await reopened.worker.dispatch(f.credentials.manager, a)).state, 'DUPLICATE');
    assert.equal((await f.port.apply(payload)).state, 'DUPLICATE');
    await assert.rejects(f.port.apply({ ...payload, isolated: false }));
    assert.equal((await reopened.kernel.status(f.credentials.operator, a)).state, 'SUCCEEDED');
    assert.equal(await count(f.owner,'actions'),1); assert.equal(await count(f.owner,'inbox'),1);
    assert.equal(await count(f.owner,'history'),1); assert.equal(await count(f.erp.owner,'ledger'),1);
    assert.equal(await count(f.erp.owner,'effects'),1);
    assert.equal((await f.erp.owner.query('SELECT sequence FROM effects')).rows[0].sequence,1);
    const retainedAudit = (await f.owner.query('SELECT * FROM audit ORDER BY sequence')).rows;
    assert.deepEqual(retainedAudit.slice(0, originalAudit.length), originalAudit);
    let previous = 'GENESIS';
    for (const row of retainedAudit) { assert.equal(row.previous_hash, previous); assert.equal(row.hash,digest({previous,record:row.record})); previous=row.hash; }
    // Neither the application principal nor the owner can erase this Audit chain.
    await assert.rejects(f.state.pool.query('DELETE FROM audit'));
    await assert.rejects(f.owner.query('DELETE FROM audit'));
  }));
}
test('missing ERP ledger after years stays UNKNOWN and cannot cause automatic resend', t => run(t, async f => {
  const a = await f.kernel.submit(f.credentials.operator, f.request());
  f.erp.controller.mode = 'lost-ack';
  assert.equal((await f.worker.dispatch(f.credentials.manager, a)).state,'UNKNOWN');
  // Deliberate synthetic corruption: retain the effect while losing its receipt.
  await f.erp.owner.query('DELETE FROM ledger');
  t.mock.timers.enable({ apis:['Date'], now:Date.now()+18*366*day });
  f.restart(); const reopened=f.current();
  assert.equal((await reopened.worker.reconcile(f.credentials.manager,a)).state,'UNKNOWN');
  assert.equal((await reopened.worker.dispatch(f.credentials.manager,a)).state,'UNKNOWN');
  assert.equal((await reopened.kernel.status(f.credentials.operator,a)).state,'PENDING_EXTERNAL');
  assert.equal(f.erp.controller.applyRequests,1); assert.equal(await count(f.erp.owner,'effects'),1);
  assert.equal(await count(f.erp.owner,'ledger'),0);
}));
test('unresolved commit INTENT does not age out with Audit retention or process reopening', t => run(t, async f => {
  const request=f.request();
  f.kernel.fault=async point=>{if(point==='after-commit') throw Error('response lost');};
  await assert.rejects(f.kernel.submit(f.credentials.operator,request));
  assert.equal(await count(f.owner,'actions'),1);
  t.mock.timers.enable({apis:['Date'],now:Date.now()+18*366*day});
  f.restart(); const reopened=f.current();
  assert.equal(reopened.kernel.journal.fenced(),true);
  assert.equal(reopened.kernel.journal.latest('t1','operator',request.idempotencyKey).phase,'INTENT');
  await assert.rejects(reopened.kernel.submit(f.credentials.operator,request),e=>e.code==='INCONSISTENT_STATE');
  const action=(await f.owner.query('SELECT id,operation_id FROM actions')).rows[0];
  await assert.rejects(reopened.worker.dispatch(f.credentials.manager,{actionId:action.id,operationId:action.operation_id}),e=>e.code==='INCONSISTENT_STATE');
  assert.equal(f.erp.controller.applyRequests,0); assert.equal(await count(f.owner,'history'),1);
}));
