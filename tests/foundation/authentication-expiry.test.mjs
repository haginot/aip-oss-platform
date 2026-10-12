import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {createGateway} from '../../src/gateway.mjs';
import {authenticate} from '../../src/security.mjs';
import {createClient} from '../../src/generated/client.mjs';
let cluster;before(async()=>{cluster=await startCluster();});after(async()=>{await cluster?.close();});
const outcome=p=>p.then(value=>({value}),error=>({error}));
function barrier(point){let enter,release,armed=true;const entered=new Promise(r=>{enter=r;}),released=new Promise(r=>{release=r;});return {entered,release,fault:async name=>{if(name===point&&armed){armed=false;enter();await released;}}};}
async function paused(gate){await Promise.race([gate.entered,delay(2000).then(()=>{throw Error('barrier not reached');})]);}
async function run(point,fn){
 const gate=barrier(point),f=await fixture(cluster,{fault:gate.fault}),server=createGateway(f.kernel);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const client=id=>createClient({url:`http://127.0.0.1:${server.address().port}`,tenant:'t1',...f.credentials[id],timeoutMs:10000});
 try{await fn({...f,gate,client});}finally{gate.release();await new Promise(r=>server.close(r));await f.close();}
}
async function expiry(f,kind,at){
 if(kind==='session')await f.owner.query("UPDATE sessions SET expires=$1 WHERE principal='operator'",[new Date(at)]);
 else await f.owner.query("UPDATE delegations SET expires=$1 WHERE id='delegation'",[new Date(at)]);
}
async function waitLock(f,pattern){
 for(let i=0;i<250;i++){
  const rows=(await f.owner.query("SELECT query FROM pg_stat_activity WHERE usename='foundation_app' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0")).rows;
  if(rows.some(r=>pattern.test(r.query)))return;
  await delay(5);
 }assert.fail('request did not wait on expected real PostgreSQL lock');
}
async function unchanged(f){
 const o=(await f.owner.query("SELECT * FROM objects WHERE id='stock'")).rows[0];assert.equal(o.revision,1);assert.equal(o.fields.isolated,false);
 for(const table of ['actions','history','outbox'])assert.equal((await f.owner.query(`SELECT * FROM ${table}`)).rowCount,0,table);
 assert.deepEqual(f.journal.records().map(r=>r.phase),['INTENT','ABORTED']);
 assert.equal((await f.owner.query("SELECT * FROM audit WHERE record->>'kind'='PENDING_EXTERNAL'")).rowCount,0);
 assert.equal((await f.owner.query("SELECT * FROM audit WHERE record->>'kind'='Denied' AND record->>'operation'='submit' AND record->>'code'='PERMISSION_DENIED'")).rowCount,1);
}
for(const [kind,lock] of [['session','policy'],['delegation','policy'],['session','object']]){
 test(`${kind} expiry during business ${lock} lock wait rejects HTTP Action and permits same-key retry after renewal`,()=>run('after-intent',async f=>{
  const request=f.request(),client=f.client(kind==='session'?'operator':'delegated'),result=outcome(client.submit(request));await paused(f.gate);
  const at=Date.now()+600;await expiry(f,kind,at);const writer=await f.owner.connect();
  try{
   await writer.query('BEGIN');await writer.query(lock==='policy'?'SELECT * FROM policy FOR UPDATE':"SELECT * FROM objects WHERE id='stock' FOR UPDATE");
   f.gate.release();await waitLock(f,lock==='policy'?/FROM policy/:/FROM objects.*FOR UPDATE/);
   assert.ok(Date.now()<at,'lock wait must begin before expiry');await delay(Math.max(0,at-Date.now()+30));
  }finally{await writer.query('ROLLBACK');writer.release();}
  assert.equal((await result).error?.code,'PERMISSION_DENIED');await unchanged(f);
  await expiry(f,kind,Date.now()+60000);const accepted=await client.submit(request);assert.equal(accepted.state,'PENDING_EXTERNAL');
  assert.deepEqual(await client.submit(request),accepted);
  for(const table of ['actions','history','outbox'])assert.equal((await f.owner.query(`SELECT * FROM ${table}`)).rowCount,1,table);
  const event=(await f.owner.query('SELECT event FROM outbox')).rows[0].event;
  assert.equal(event.actor,kind==='session'?'operator':'agent');assert.equal(event.onBehalfOf,kind==='session'?null:'operator');
 }));
}
test('delegation expiry after business writes and Audit rolls back before commit',()=>run('before-commit',async f=>{
 let at;f.kernel.fault=async point=>{if(point==='after-intent'){at=Date.now()+600;await expiry(f,'delegation',at);}await f.gate.fault(point);};
 const result=outcome(f.client('delegated').submit(f.request()));await paused(f.gate);
 assert.ok(Date.now()<at);await delay(Math.max(0,at-Date.now()+30));f.gate.release();
 assert.equal((await result).error?.code,'PERMISSION_DENIED');await unchanged(f);
}));

for(const kind of ['session','delegation'])test(`${kind} expiry during initial HTTP authentication rejects before journal admission`,()=>run('unused',async f=>{
 const at=Date.now()+600;await expiry(f,kind,at);const writer=await f.owner.connect();let result;
 try{
  await writer.query('BEGIN');await writer.query("SELECT * FROM live_definition FOR UPDATE");
  result=outcome(f.client(kind==='session'?'operator':'delegated').submit(f.request()));
  await waitLock(f,/FROM live_definition/);assert.ok(Date.now()<at);
  await delay(Math.max(0,at-Date.now()+30));
 }finally{await writer.query('ROLLBACK');writer.release();}
 assert.equal((await result).error?.code,'PERMISSION_DENIED');
 assert.equal(f.journal.records().length,0);
 for(const table of ['actions','history','outbox'])assert.equal((await f.owner.query(`SELECT * FROM ${table}`)).rowCount,0);
 assert.equal((await f.owner.query("SELECT revision FROM objects WHERE id='stock'")).rows[0].revision,1);
 assert.ok((await f.owner.query("SELECT * FROM audit WHERE record->>'kind'='Denied' AND record->>'code'='PERMISSION_DENIED'")).rowCount>0);
}));
test('original delegation expiry during approval rolls back and preserves pending Action',()=>run('approval-after-evidence',async f=>{
 const a=await f.client('delegated').submit(f.request({requireApproval:true}));
 const at=Date.now()+600;await expiry(f,'delegation',at);
 const result=outcome(f.client('manager').approve({actionId:a.actionId}));await paused(f.gate);
 assert.ok(Date.now()<at);await delay(Math.max(0,at-Date.now()+30));f.gate.release();
 assert.equal((await result).error?.code,'PERMISSION_DENIED');
 assert.equal((await f.owner.query('SELECT state FROM actions WHERE id=$1',[a.actionId])).rows[0].state,'PENDING_APPROVAL');
 assert.equal((await f.owner.query("SELECT revision FROM objects WHERE id='stock'")).rows[0].revision,1);
 for(const table of ['history','outbox'])assert.equal((await f.owner.query(`SELECT * FROM ${table}`)).rowCount,0);
 assert.equal((await f.owner.query("SELECT * FROM audit WHERE record->>'kind'='ApprovedCommit'")).rowCount,0);
 assert.ok((await f.owner.query("SELECT * FROM audit WHERE record->>'kind'='Denied' AND record->>'code'='PERMISSION_DENIED'")).rowCount>0);
 assert.equal(f.journal.records().at(-1).phase,'ABORTED');
 await expiry(f,'delegation',Date.now()+60000);
 assert.equal((await f.client('manager').approve({actionId:a.actionId})).state,'PENDING_EXTERNAL');
 const event=(await f.owner.query('SELECT event FROM outbox')).rows[0].event;
 assert.equal(event.actor,'agent');assert.equal(event.onBehalfOf,'operator');
}));
test('expiry after final SQL and before COMMIT rolls back authenticated transaction',()=>run('after-final-sql',async f=>{
 const at=Date.now()+600;await expiry(f,'session',at);
 const result=outcome(f.state.transaction(async u=>{
  await authenticate(u,f.credentials.operator,'action');
  await u.client.query("UPDATE objects SET revision=revision+1 WHERE id='stock'");
  await f.gate.fault('after-final-sql');
 },Date.now()+10000));
 await paused(f.gate);assert.ok(Date.now()<at);await delay(Math.max(0,at-Date.now()+30));f.gate.release();
 assert.equal((await result).error?.code,'PERMISSION_DENIED');
 assert.equal((await f.owner.query("SELECT revision FROM objects WHERE id='stock'")).rows[0].revision,1);
}));
