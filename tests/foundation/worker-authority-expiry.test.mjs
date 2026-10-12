import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {startErp} from '../../scripts/foundation/erp.mjs';
import {Writeback,HttpWritebackPort} from '../../src/writeback.mjs';
import {createGateway} from '../../src/gateway.mjs';
import {createClient} from '../../src/generated/client.mjs';
let cluster;before(async()=>{cluster=await startCluster();});after(async()=>{await cluster?.close();});
const outcome=p=>p.then(value=>({value}),error=>({error}));
function barrier(point){let enter,release,armed=true;const entered=new Promise(r=>{enter=r;}),released=new Promise(r=>{release=r;});return {entered,release,fault:async name=>{if(name===point&&armed){armed=false;enter();await released;}}};}
async function run(point,fn){
 const gate=barrier(point),f=await fixture(cluster,{fault:gate.fault}),erp=await startErp(cluster);
 f.kernel.writeback=new Writeback(f.kernel,new HttpWritebackPort(erp.url,erp.token,{timeout:5000}));
 const server=createGateway(f.kernel);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const client=id=>createClient({url:`http://127.0.0.1:${server.address().port}`,tenant:'t1',...f.credentials[id],timeoutMs:10000});
 try{await fn({...f,erp,gate,client});}finally{gate.release();await new Promise(r=>server.close(r));await erp.close();await f.close();}
}
async function expiry(f,at){await f.owner.query("UPDATE delegations SET expires=$1 WHERE id='delegation'",[new Date(at)]);}
async function expireAtBarrier(f,at){
 await Promise.race([f.gate.entered,delay(2000).then(()=>{throw Error('barrier not reached');})]);
 assert.ok(Date.now()<at,'operation must pass authority check before expiry');
 await delay(Math.max(0,at-Date.now()+30));f.gate.release();
}
const count=async(pool,table)=>Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
async function acceptedUnchanged(f,a,state='PENDING'){
 assert.equal((await f.owner.query("SELECT revision FROM objects WHERE id='stock'")).rows[0].revision,2);
 for(const table of ['actions','history','outbox'])assert.equal(await count(f.owner,table),1,table);
 assert.equal((await f.owner.query('SELECT state FROM actions WHERE id=$1',[a.actionId])).rows[0].state,'PENDING_EXTERNAL');
 assert.equal((await f.owner.query('SELECT state FROM outbox WHERE operation_id=$1',[a.operationId])).rows[0].state,state);
 assert.ok(f.journal.records().some(r=>r.operationId===a.operationId&&r.phase==='COMMITTED'));
 assert.ok(!f.journal.records().some(r=>r.operationId===a.operationId&&r.phase==='ABORTED'));
 assert.ok((await f.owner.query("SELECT * FROM audit WHERE record->>'kind'='Denied' AND record->>'code'='PERMISSION_DENIED'")).rowCount>0);
}
async function externalOnce(f,a){
 assert.equal(await count(f.erp.owner,'ledger'),1);assert.equal(await count(f.erp.owner,'effects'),1);
 const row=(await f.erp.owner.query('SELECT * FROM ledger')).rows[0];
 assert.equal(row.operation_id,a.operationId);assert.equal(row.payload.actionId,a.actionId);
 assert.equal(f.erp.controller.applyRequests,1);
}
test('consume original delegation expires after Inbox writes: rollback then renewed retry deduplicates',()=>run('after-inbox',async f=>{
 const a=await f.client('delegated').submit(f.request()),at=Date.now()+600;await expiry(f,at);
 const result=outcome(f.kernel.consume(f.credentials.manager,a,{deadline:Date.now()+10000}));await expireAtBarrier(f,at);
 assert.equal((await result).error?.code,'PERMISSION_DENIED');await acceptedUnchanged(f,a);
 for(const table of ['inbox','projection'])assert.equal(await count(f.owner,table),0,table);
 assert.equal((await f.owner.query("SELECT * FROM audit WHERE record->>'kind'='Consumed'")).rowCount,0);
 await expiry(f,Date.now()+60000);
 assert.equal((await f.kernel.consume(f.credentials.manager,a)).state,'DELIVERED');
 assert.equal((await f.kernel.consume(f.credentials.manager,a)).state,'DUPLICATE');
 for(const table of ['inbox','projection'])assert.equal(await count(f.owner,table),1,table);
 const event=(await f.owner.query('SELECT event FROM outbox')).rows[0].event;assert.equal(event.actor,'agent');assert.equal(event.onBehalfOf,'operator');
 assert.equal((await f.owner.query("SELECT * FROM audit WHERE record->>'kind'='Consumed'")).rowCount,1);
}));
test('dispatch original delegation expires after real ERP apply: preserve SENDING and reconcile without resend',()=>run('after-external',async f=>{
 const a=await f.client('delegated').submit(f.request()),at=Date.now()+600;await expiry(f,at);
 const result=outcome(f.client('manager').dispatch(a));await expireAtBarrier(f,at);
 assert.equal((await result).error?.code,'PERMISSION_DENIED');await acceptedUnchanged(f,a,'SENDING');await externalOnce(f,a);
 assert.ok(f.journal.records().some(r=>r.operationId===a.operationId&&r.phase==='SEND_STARTED'));
 assert.equal((await f.owner.query("SELECT * FROM audit WHERE record->>'kind'='Writeback'")).rowCount,0);
 await expiry(f,Date.now()+60000);
 assert.equal((await f.client('manager').dispatch(a)).state,'SENDING');
 assert.equal((await f.client('manager').reconcile(a)).state,'DELIVERED');await externalOnce(f,a);
 assert.equal((await f.client('operator').status(a)).state,'SUCCEEDED');
}));
test('reconciliation original delegation expires during ERP ledger lock wait: retain UNKNOWN until renewed request',()=>run('unused',async f=>{
 const a=await f.client('delegated').submit(f.request());f.erp.controller.mode='lost-ack';
 assert.equal((await f.client('manager').dispatch(a)).state,'UNKNOWN');
 const writer=await f.erp.owner.connect();let result;
 try{
  await writer.query('SELECT pg_advisory_lock(772343)');
  const at=Date.now()+600;await expiry(f,at);result=outcome(f.client('manager').reconcile(a));
  let waiting=false;
  for(let i=0;i<250;i++){
   const rows=(await f.erp.owner.query("SELECT query FROM pg_stat_activity WHERE usename='synthetic_erp' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0")).rows;
   if(rows.some(r=>r.query.includes('772343'))){waiting=true;break;}await delay(5);
  }
  assert.ok(waiting,'status must wait on real ERP lock');assert.ok(Date.now()<at);
  await delay(Math.max(0,at-Date.now()+30));
 }finally{await writer.query('SELECT pg_advisory_unlock(772343)');writer.release();}
 assert.equal((await result).error?.code,'PERMISSION_DENIED');await acceptedUnchanged(f,a,'UNKNOWN');await externalOnce(f,a);
 assert.equal((await f.owner.query("SELECT * FROM audit WHERE record->>'kind'='Writeback'")).rowCount,1);
 await expiry(f,Date.now()+60000);assert.equal((await f.client('manager').reconcile(a)).state,'DELIVERED');await externalOnce(f,a);
}));
for(const operation of ['consume','dispatch','reconcile'])test(`${operation} rejects expired original delegation before worker effects`,()=>run('unused',async f=>{
 const a=await f.client('delegated').submit(f.request());await expiry(f,Date.now()-1);
 const result=await outcome(operation==='consume'?f.kernel.consume(f.credentials.manager,a):f.client('manager')[operation](a));
 assert.equal(result.error?.code,'PERMISSION_DENIED');await acceptedUnchanged(f,a);
 for(const table of ['inbox','projection'])assert.equal(await count(f.owner,table),0,table);
 assert.equal(f.erp.controller.applyRequests,0);assert.equal(f.erp.controller.statusRequests,0);
 assert.equal(await count(f.erp.owner,'effects'),0);
 assert.ok(!f.journal.records().some(r=>r.operationId===a.operationId&&r.phase==='SEND_STARTED'));
}));
test('valid original delegation permits consume, delivery and replay with one external effect',()=>run('unused',async f=>{
 const a=await f.client('delegated').submit(f.request());
 assert.equal((await f.kernel.consume(f.credentials.manager,a)).state,'DELIVERED');
 assert.equal((await f.kernel.consume(f.credentials.manager,a)).state,'DUPLICATE');
 assert.equal((await f.client('manager').dispatch(a)).state,'DELIVERED');
 assert.equal((await f.client('manager').dispatch(a)).state,'DUPLICATE');
 assert.equal((await f.client('manager').reconcile(a)).state,'DELIVERED');
 assert.equal((await f.client('operator').status(a)).state,'SUCCEEDED');await externalOnce(f,a);
 for(const table of ['inbox','projection','history','actions','outbox'])assert.equal(await count(f.owner,table),1,table);
 const event=(await f.owner.query('SELECT event FROM outbox')).rows[0].event;
 assert.equal(event.actor,'agent');assert.equal(event.onBehalfOf,'operator');
}));
