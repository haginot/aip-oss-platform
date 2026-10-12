import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {createGateway} from '../../src/gateway.mjs';
import {createClient} from '../../src/generated/client.mjs';
import {defaults} from '../../src/definition-programs.mjs';
import {digest} from '../../src/contracts.mjs';
let cluster;before(async()=>{cluster=await startCluster();});after(async()=>{await cluster?.close();});
const version='1.1.0', code=c=>e=>e.code===c;
const cases=[{id:'stock',isolated:false,expected:'RULE_REJECTED'}];
function barrier(point){
 let armed=true,enter,release;
 const entered=new Promise(r=>{enter=r;}),released=new Promise(r=>{release=r;});
 return {entered,release,fault:async name=>{if(name===point&&armed){armed=false;enter();await released;}}};
}
async function run(point,fn){
 const gate=barrier(point),f=await fixture(cluster,{fault:gate.fault}),server=createGateway(f.kernel);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const client=id=>createClient({url:`http://127.0.0.1:${server.address().port}`,tenant:'t1',token:f.credentials[id].token});
 try{
  await client('manager').draft({definition:{...structuredClone(f.definition),ontologyVersion:version,ruleVersion:version,programs:{...structuredClone(defaults),rule:{...defaults.rule,allowRelease:false}}}});
  await fn({...f,gate,author:client('manager'),reviewer:client('reviewer'),publisher:client('publisher')});
 }finally{gate.release();await new Promise(r=>server.close(r));await f.close();}
}
async function snapshot(f){
 return {definition:(await f.owner.query('SELECT * FROM definitions WHERE version=$1',[version])).rows[0],
  live:(await f.owner.query('SELECT * FROM live_definition')).rows,
  policy:(await f.owner.query('SELECT * FROM policy')).rows};
}
async function audit(f,operation,kind){return (await f.owner.query('SELECT record FROM audit WHERE record->>\'operation\'=$1 AND record->>\'kind\'=$2',[operation,kind])).rows;}
async function paused(f){await Promise.race([f.gate.entered,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('barrier not reached')),2500);timer.unref();})]);}
async function unchangedLive(f,before){const after=await snapshot(f);assert.deepEqual(after.live,before.live);assert.deepEqual(after.policy,before.policy);return after;}
async function publishValid(f){
 await f.author.editCases({version,cases});const sim=await f.reviewer.review({version});assert.equal(sim.casesDigest,digest(cases));
 await f.publisher.publish({version});const result=await snapshot(f);
 assert.equal(result.definition.state,'PUBLISHED');assert.deepEqual(result.definition.cases,cases);
 assert.equal(result.definition.simulation.casesDigest,digest(result.definition.cases));
 assert.equal(result.live[0].version,version);assert.equal(result.policy[0].epoch,2);
 assert.equal((await audit(f,'publish','ReadOrControl')).length,1);
 await assert.rejects(f.author.editCases({version,cases:[]}),code('PERMISSION_DENIED'));
 assert.deepEqual(await snapshot(f),result);
 await f.publisher.publish({version:'1.0.0',rollback:true});
}
test('review cannot overwrite a concurrent case edit; corrected cases can be reviewed and published',()=>run('review-after-definition',async f=>{
 const before=await snapshot(f),pending=f.reviewer.review({version});
 const rejected=assert.rejects(pending,code('STALE_REVIEW'));
 await paused(f);
 const invalid=[{id:'stock',isolated:false,expected:'PENDING_EXTERNAL'}];
 await f.author.editCases({version,cases:invalid});f.gate.release();await rejected;
 const after=await unchangedLive(f,before);assert.equal(after.definition.state,'DRAFT');assert.equal(after.definition.simulation,null);assert.equal(after.definition.reviewer,null);assert.deepEqual(after.definition.cases,invalid);
 assert.equal((await audit(f,'review','ReadOrControl')).length,0);assert.equal((await audit(f,'review','Denied')).length,1);
 await assert.rejects(f.publisher.publish({version}),code('PERMISSION_DENIED'));
 await assert.rejects(f.reviewer.review({version}),code('SIMULATION_FAILED'));
 await publishValid(f);
}));
test('publish cannot use a review invalidated by a concurrent case edit',()=>run('publish-after-definition',async f=>{
 await f.reviewer.review({version});const before=await snapshot(f),pending=f.publisher.publish({version});
 const rejected=assert.rejects(pending,code('STALE_REVIEW'));await paused(f);
 await f.author.editCases({version,cases});f.gate.release();await rejected;
 const after=await unchangedLive(f,before);assert.equal(after.definition.state,'DRAFT');assert.equal(after.definition.simulation,null);assert.deepEqual(after.definition.cases,cases);
 assert.equal((await audit(f,'publish','ReadOrControl')).length,0);assert.equal((await audit(f,'publish','Denied')).length,1);
 await publishValid(f);
}));
test('publish independently rejects a stored simulation bound to different cases',()=>run('unused',async f=>{
 await f.reviewer.review({version});
 // Isolated owner-only corruption injects a stale historic review; public HTTP must reject it.
 await f.owner.query('UPDATE definitions SET cases=$2 WHERE version=$1',[version,JSON.stringify(cases)]);
 const before=await snapshot(f);await assert.rejects(f.publisher.publish({version}),code('STALE_REVIEW'));
 assert.deepEqual(await snapshot(f),before);assert.equal((await audit(f,'publish','ReadOrControl')).length,0);assert.equal((await audit(f,'publish','Denied')).length,1);
 await publishValid(f);
}));
test('editing cases back to their original content still invalidates an in-flight review',()=>run('review-after-definition',async f=>{
 const pending=f.reviewer.review({version}),rejected=assert.rejects(pending,code('STALE_REVIEW'));
 await paused(f);await f.author.editCases({version,cases});await f.author.editCases({version,cases:[]});f.gate.release();await rejected;
 const after=await snapshot(f);assert.equal(after.definition.state,'DRAFT');assert.equal(after.definition.simulation,null);assert.deepEqual(after.definition.cases,[]);assert.equal(after.live[0].version,'1.0.0');assert.equal(after.policy[0].epoch,1);
 await publishValid(f);
}));
test('an edit arriving during publication waits for commit and cannot change PUBLISHED cases',()=>run('publish-before-audit',async f=>{
 await f.author.editCases({version,cases});await f.reviewer.review({version});
 const before=await snapshot(f),pending=f.publisher.publish({version});await paused(f);
 // Uncommitted definition, live pointer and epoch are not externally visible.
 assert.deepEqual(await snapshot(f),before);
 const rejected=assert.rejects(f.author.editCases({version,cases:[]}),code('PERMISSION_DENIED'));
 let waiting=false;
 for(let i=0;i<200;i++){
  const rows=(await f.owner.query("SELECT pid FROM pg_stat_activity WHERE wait_event_type='Lock' AND query='SELECT * FROM policy WHERE id=1 FOR SHARE' AND cardinality(pg_blocking_pids(pid))>0")).rows;
  if(rows.length){waiting=true;break;}await new Promise(r=>setTimeout(r,5));
 }
 assert.equal(waiting,true,'concurrent HTTP editor must actually wait on publication transaction');
 f.gate.release();await pending;await rejected;
 const after=await snapshot(f);assert.equal(after.definition.state,'PUBLISHED');assert.deepEqual(after.definition.cases,cases);assert.equal(after.definition.simulation.casesDigest,digest(cases));
 assert.equal(after.definition.simulation.casesRevision,after.definition.cases_revision);assert.equal(after.live[0].version,version);assert.equal(after.policy[0].epoch,2);
 assert.equal((await audit(f,'publish','ReadOrControl')).length,1);assert.equal((await audit(f,'author','Denied')).length,1);
}));
test('publication failure before Audit rolls back definition, live pointer and Policy together',()=>run('unused',async f=>{
 await f.reviewer.review({version});const before=await snapshot(f);
 f.kernel.fault=async point=>{if(point==='publish-before-audit')throw Error('injected pre-Audit failure');};
 await assert.rejects(f.publisher.publish({version}),code('UNAVAILABLE'));
 assert.deepEqual(await snapshot(f),before);assert.equal((await audit(f,'publish','ReadOrControl')).length,0);assert.equal((await audit(f,'publish','Denied')).length,1);
 f.kernel.fault=async()=>{};await publishValid(f);
}));
test('rollback also rejects mismatched case binding on a previously published definition',()=>run('unused',async f=>{
 await f.reviewer.review({version});await f.publisher.publish({version});await f.publisher.publish({version:'1.0.0',rollback:true});
 await f.owner.query('UPDATE definitions SET cases=$2 WHERE version=$1',[version,JSON.stringify(cases)]);
 const before=await snapshot(f);await assert.rejects(f.publisher.publish({version,rollback:true}),code('STALE_REVIEW'));
 assert.deepEqual(await snapshot(f),before);assert.equal((await audit(f,'publish','ReadOrControl')).length,2);assert.equal((await audit(f,'publish','Denied')).length,1);
}));
