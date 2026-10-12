import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { startCluster,fixture } from '../../scripts/foundation/runtime.mjs';
import { digest } from '../../src/contracts.mjs';
let cluster;before(async()=>{cluster=await startCluster();});after(async()=>{await cluster?.close();});
const code=expected=>error=>error.code===expected;
async function run(fn,options){const f=await fixture(cluster,options);try{await fn(f);}finally{await f.close();}}
test('transaction joins object, Action, history, Outbox, Audit, journal and deduplicated consumer',()=>run(async f=>{
 const result=await f.kernel.submit(f.credentials.operator,f.request({idempotencyKey:'one'}));assert.equal(result.state,'PENDING_EXTERNAL');
 const object=await f.kernel.get(f.credentials.operator,{id:'stock'});assert.equal(object.revision,2);assert.equal(object.fields.isolated,true);
 assert.equal((await f.owner.query('SELECT count(*) FROM history')).rows[0].count,'1');
 assert.equal((await f.owner.query('SELECT count(*) FROM outbox')).rows[0].count,'1');
 assert.equal(f.journal.records().length,2);assert.equal(f.journal.records()[1].phase,'COMMITTED');
 assert.deepEqual(await f.kernel.submit(f.credentials.operator,f.request({idempotencyKey:'one'})),result);
 await assert.rejects(f.kernel.submit(f.credentials.operator,f.request({idempotencyKey:'one',input:{targetId:'stock',isolated:false}})),code('IDEMPOTENCY_MISMATCH'));
 assert.equal((await f.kernel.consume(f.credentials.manager,{operationId:result.operationId})).state,'DELIVERED');
 assert.equal((await f.kernel.consume(f.credentials.manager,{operationId:result.operationId})).state,'DUPLICATE');
 let previous='GENESIS';for(const row of (await f.owner.query('SELECT * FROM audit ORDER BY sequence')).rows){assert.equal(row.previous_hash,previous);assert.equal(row.hash,digest({previous,record:row.record}));previous=row.hash;}
 await assert.rejects(f.state.pool.query("UPDATE audit SET hash='tamper'"));
}));
test('concurrent expected revision accepts one and records conflict for the other',()=>run(async f=>{
 const results=await Promise.all([f.kernel.submit(f.credentials.operator,f.request()),f.kernel.submit(f.credentials.operator,f.request())]);
 assert.deepEqual(results.map(x=>x.state).sort(),['CONFLICT','PENDING_EXTERNAL']);
 assert.equal((await f.owner.query('SELECT count(*) FROM outbox')).rows[0].count,'1');
 assert.equal((await f.kernel.get(f.credentials.operator,{id:'stock'})).revision,2);
}));
for(const point of ['after-intent','after-action','after-object','after-outbox','before-audit','before-commit']) test(`partial failure ${point} rolls back all state and retries same key`,()=>run(async f=>{
 const request=f.request({idempotencyKey:point});await assert.rejects(f.kernel.submit(f.credentials.operator,request),code('UNAVAILABLE'));
 for(const table of ['actions','outbox','history']) assert.equal((await f.owner.query(`SELECT count(*) FROM ${table}`)).rows[0].count,'0');
 assert.equal((await f.kernel.get(f.credentials.operator,{id:'stock'})).revision,1);
 assert.equal(f.journal.records().at(-1).phase,'ABORTED');f.kernel.fault=async()=>{};
 assert.equal((await f.kernel.submit(f.credentials.operator,request)).state,'PENDING_EXTERNAL');
},{fault:async where=>{if(where===point)throw Error('injected failure');}}));
test('timeout and cancellation do not acknowledge or mutate',()=>run(async f=>{
 await assert.rejects(f.kernel.submit(f.credentials.operator,f.request(),{deadline:Date.now()-1}),code('DEADLINE_EXCEEDED'));
 const controller=new AbortController();controller.abort();await assert.rejects(f.kernel.submit(f.credentials.operator,f.request(),{signal:controller.signal}),code('CANCELLED'));
 assert.equal((await f.kernel.get(f.credentials.operator,{id:'stock'})).revision,1);assert.equal(f.journal.records().length,0);
}));
test('commit before acknowledgement failure fences replay and dispatch',()=>run(async f=>{
 const request=f.request({idempotencyKey:'unknown'});await assert.rejects(f.kernel.submit(f.credentials.operator,request),code('UNAVAILABLE'));
 assert.equal((await f.kernel.get(f.credentials.operator,{id:'stock'})).revision,2);
 f.kernel.fault=async()=>{};await assert.rejects(f.kernel.submit(f.credentials.operator,request),code('INCONSISTENT_STATE'));
 const action=(await f.owner.query('SELECT * FROM actions')).rows[0];await assert.rejects(f.kernel.consume(f.credentials.manager,{operationId:action.operation_id}),code('INCONSISTENT_STATE'));
},{fault:async where=>{if(where==='after-commit')throw Error('lost ack');}}));
test('reverse event order parks gap; inbox failure rolls back; ordered redelivery converges',()=>run(async f=>{
 const a=await f.kernel.submit(f.credentials.operator,f.request());const b=await f.kernel.submit(f.credentials.operator,f.request({expectedRevision:2,input:{targetId:'stock',isolated:false}}));
 assert.equal((await f.kernel.consume(f.credentials.manager,{operationId:b.operationId})).state,'GAP');
 f.kernel.fault=async where=>{if(where==='after-inbox')throw Error('consumer crash');};
 await assert.rejects(f.kernel.consume(f.credentials.manager,{operationId:a.operationId}),code('UNAVAILABLE'));assert.equal((await f.owner.query('SELECT count(*) FROM inbox')).rows[0].count,'0');
 f.kernel.fault=async()=>{};await f.kernel.consume(f.credentials.manager,{operationId:a.operationId});await f.kernel.consume(f.credentials.manager,{operationId:b.operationId});
 assert.equal((await f.owner.query("SELECT * FROM projection WHERE aggregate_id='stock'")).rows[0].sequence,2);
}));
test('audit write failure prevents object, action, history and outbox commit',()=>run(async f=>{
 await f.owner.query('REVOKE INSERT ON audit FROM foundation_app');
 await assert.rejects(f.kernel.submit(f.credentials.operator,f.request()),code('UNAVAILABLE'));
 for(const table of ['actions','outbox','history'])assert.equal((await f.owner.query(`SELECT count(*) FROM ${table}`)).rows[0].count,'0');
 assert.equal((await f.owner.query("SELECT revision FROM objects WHERE id='stock'")).rows[0].revision,1);
 assert.equal(f.journal.records().at(-1).phase,'ABORTED');
}));
test('poison event is retained as dead letter, never applied or marked successful',()=>run(async f=>{
 const a=await f.kernel.submit(f.credentials.operator,f.request());await f.owner.query("UPDATE outbox SET digest='wrong' WHERE operation_id=$1",[a.operationId]);
 assert.equal((await f.kernel.consume(f.credentials.manager,{operationId:a.operationId})).state,'DEAD_LETTER');assert.equal((await f.owner.query('SELECT count(*) FROM inbox')).rows[0].count,'0');
 assert.equal((await f.owner.query('SELECT state FROM outbox WHERE operation_id=$1',[a.operationId])).rows[0].state,'DEAD_LETTER');
}));
