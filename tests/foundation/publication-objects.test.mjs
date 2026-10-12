import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {createGateway} from '../../src/gateway.mjs';
import {createClient} from '../../src/generated/client.mjs';
import {createContractClient} from '../../src/client-transport.mjs';
let cluster;before(async()=>{cluster=await startCluster();});after(async()=>{await cluster?.close();});
const version='1.1.0',code=c=>e=>e.code===c;
function barrier(point){let enter,release,armed=true;const entered=new Promise(r=>{enter=r;}),released=new Promise(r=>{release=r;});return {entered,release,fault:async name=>{if(name===point&&armed){armed=false;enter();await released;}}};}
async function paused(gate){await Promise.race([gate.entered,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('barrier not reached')),2500);timer.unref();})]);}
async function run(point,fn){
 const gate=barrier(point),f=await fixture(cluster,{fault:gate.fault}),server=createGateway(f.kernel);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const client=id=>createClient({url:`http://127.0.0.1:${server.address().port}`,tenant:'t1',token:f.credentials[id].token});
 try{
  const author=client('manager'),reviewer=client('reviewer'),publisher=client('publisher'),operator=client('operator');
  await author.draft({definition:{...structuredClone(f.definition),ontologyVersion:version}});
  const currentOperator=createContractClient({url:`http://127.0.0.1:${server.address().port}`,tenant:'t1',token:f.credentials.operator.token},{...f.definition,ontologyVersion:version});
  await reviewer.review({version});await fn({...f,gate,author,reviewer,publisher,operator,currentOperator});
 }finally{gate.release();await new Promise(r=>server.close(r));await f.close();}
}
async function snapshot(f){return {definition:(await f.owner.query('SELECT * FROM definitions WHERE version=$1',[version])).rows[0],live:(await f.owner.query('SELECT * FROM live_definition')).rows,policy:(await f.owner.query('SELECT * FROM policy')).rows};}
async function audits(f,kind){return (await f.owner.query("SELECT record FROM audit WHERE record->>'operation'='publish' AND record->>'kind'=$1",[kind])).rows;}
async function waitLock(f,pattern){
 for(let i=0;i<250;i++){
  const rows=(await f.owner.query("SELECT query FROM pg_stat_activity WHERE usename='foundation_app' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0")).rows;
  if(rows.some(r=>pattern.test(r.query)))return;
  await new Promise(r=>setTimeout(r,5));
 }
 assert.fail('concurrent request did not wait on the expected real PostgreSQL lock');
}
async function assertAction(f,a){
 assert.equal(a.state,'PENDING_EXTERNAL');assert.equal(a.result.objectRevision,2);
 const object=(await f.owner.query("SELECT * FROM objects WHERE id='stock'")).rows[0];assert.equal(object.revision,2);assert.equal(object.fields.isolated,true);
 assert.equal((await f.owner.query('SELECT * FROM history WHERE action_id=$1',[a.actionId])).rowCount,1);
 const outbox=(await f.owner.query('SELECT * FROM outbox WHERE action_id=$1',[a.actionId])).rows;assert.equal(outbox.length,1);assert.equal(outbox[0].event.operationId,a.operationId);
 assert.equal((await f.owner.query("SELECT * FROM audit WHERE record->>'actionId'=$1 AND record->>'kind'='PENDING_EXTERNAL'",[a.actionId])).rowCount,1);
 assert.equal(f.journal.committed(a.operationId),true);
}
test('Action commit while publication waits invalidates the reviewed Object; fresh review can publish',()=>run('after-object',async f=>{
 const before=await snapshot(f),request=f.request(),action=f.operator.submit(request);await paused(f.gate);
 const publication=f.publisher.publish({version});const outcome=publication.then(value=>({value}),error=>({error}));
 await waitLock(f,/policy/);f.gate.release();const accepted=await action;const result=await outcome;
 assert.equal(result.error?.code,'STALE_REVIEW','publication must reject the now-stale reviewed revision');
 assert.deepEqual(await snapshot(f),before);await assertAction(f,accepted);
 assert.equal((await audits(f,'ReadOrControl')).length,0);assert.equal((await audits(f,'Denied')).length,1);
 assert.deepEqual(await f.operator.submit(request),accepted);
 await f.author.editCases({version,cases:[]});const review=await f.reviewer.review({version});assert.equal(review.decisions.find(d=>d.id==='stock').revision,2);
 await f.publisher.publish({version});assert.equal((await snapshot(f)).live[0].version,version);
}));
test('checked Object rows stay locked until publication commits, including writers without Policy locks',()=>run('publish-before-audit',async f=>{
 const before=await snapshot(f),publication=f.publisher.publish({version});await paused(f.gate);assert.deepEqual(await snapshot(f),before);
 const writer=await f.owner.connect();try{
  await writer.query('BEGIN');await writer.query("SET LOCAL lock_timeout='100ms'");
  await assert.rejects(writer.query("UPDATE objects SET revision=revision+1 WHERE id='stock'"),code('55P03'));
 }finally{await writer.query('ROLLBACK');writer.release();}
 f.gate.release();await publication;
 assert.equal((await snapshot(f)).live[0].version,version);assert.equal((await f.owner.query("SELECT revision FROM objects WHERE id='stock'")).rows[0].revision,1);
 assert.equal((await audits(f,'ReadOrControl')).length,1);
}));
test('publication first makes a waiting Action revalidate the committed definition',()=>run('publish-after-objects',async f=>{
 const publication=f.publisher.publish({version});await paused(f.gate);
 const request=f.request(),action=f.operator.submit(request).then(value=>({value}),error=>({error}));
 await waitLock(f,/policy/);f.gate.release();await publication;
 assert.equal((await action).error?.code,'UNSUPPORTED_VERSION');
 for(const table of ['actions','outbox','history'])assert.equal((await f.owner.query(`SELECT * FROM ${table}`)).rowCount,0);
 assert.equal(f.journal.records().length,0);
 assert.equal((await f.owner.query("SELECT revision FROM objects WHERE id='stock'")).rows[0].revision,1);
 assert.equal((await f.owner.query("SELECT * FROM audit WHERE record->>'kind'='Denied' AND record->>'operation'='submit' AND record->>'code'='UNSUPPORTED_VERSION'")).rowCount,1);
 const accepted=await f.currentOperator.submit({...request,ontologyVersion:version});await assertAction(f,accepted);
}));
test('failed publication releases locks and rolls back all state before a waiting Action resumes',()=>run('publish-before-audit',async f=>{
 const before=await snapshot(f);
 f.kernel.fault=async point=>{await f.gate.fault(point);if(point==='publish-before-audit')throw Error('injected publication failure');};
 const publication=f.publisher.publish({version}).then(value=>({value}),error=>({error}));await paused(f.gate);
 const action=f.operator.submit(f.request());await waitLock(f,/policy/);f.gate.release();
 assert.equal((await publication).error?.code,'UNAVAILABLE');await assertAction(f,await action);
 assert.deepEqual(await snapshot(f),before);
 assert.equal((await audits(f,'ReadOrControl')).length,0);assert.equal((await audits(f,'Denied')).length,1);
 f.kernel.fault=async()=>{};
 await f.author.editCases({version,cases:[]});await f.reviewer.review({version});await f.publisher.publish({version});
 assert.equal((await snapshot(f)).live[0].version,version);
}));
test('concurrent publishers serialize before Policy SHARE and reject the changed baseline without deadlock',()=>run('publish-after-definition',async f=>{
 const other='1.2.0';await f.author.draft({definition:{...structuredClone(f.definition),ontologyVersion:other}});await f.reviewer.review({version:other});
 const first=f.publisher.publish({version});await paused(f.gate);
 const second=f.publisher.publish({version:other}).then(value=>({value}),error=>({error}));
 await waitLock(f,/pg_advisory_xact_lock\(772343\)/);f.gate.release();await first;
 assert.equal((await second).error?.code,'STALE_REVIEW');
 assert.equal((await snapshot(f)).live[0].version,version);
 assert.equal((await f.owner.query('SELECT state FROM definitions WHERE version=$1',[other])).rows[0].state,'REVIEWED');
 assert.equal((await audits(f,'ReadOrControl')).length,1);assert.equal((await audits(f,'Denied')).length,1);
}));
