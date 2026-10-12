import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {createGateway} from '../../src/gateway.mjs';
import {createClient} from '../../src/generated/client.mjs';
import {RecoveryJournal} from '../../src/adapters/journal.mjs';
import {Kernel} from '../../src/kernel.mjs';
import {digest} from '../../src/contracts.mjs';
import {defaults} from '../../src/definition-programs.mjs';
import {fork} from 'node:child_process';
import {once} from 'node:events';
let cluster;before(async()=>{cluster=await startCluster();});after(async()=>{await cluster?.close();});
const code=expected=>e=>e.code===expected;
async function run(fn){
 const f=await fixture(cluster),server=createGateway(f.kernel);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const clients=Object.fromEntries(Object.entries(f.credentials).map(([name,credential])=>[name,createClient({url:`http://127.0.0.1:${server.address().port}`,tenant:'t1',...credential})]));
 try{await fn(f,clients);}finally{await new Promise(resolve=>server.close(resolve));await f.close();}
}
async function business(f){return (await f.owner.query(`SELECT
 (SELECT jsonb_agg(o ORDER BY id) FROM objects o) objects,
 (SELECT jsonb_agg(a ORDER BY id) FROM actions a) actions,
 (SELECT jsonb_agg(o ORDER BY operation_id) FROM outbox o) outbox,
 (SELECT jsonb_agg(h ORDER BY object_id,revision) FROM history h) history,
 (SELECT jsonb_agg(record ORDER BY sequence) FROM audit WHERE record->>'kind' IN ('ApprovedCommit','PENDING_EXTERNAL','PENDING_APPROVAL')) commits`)).rows[0];}
async function pending(f,c,who='operator',ids=['stock','stock2']){
 const evidence=[];for(const id of ids){const o=await c[who].get({id});evidence.push({id,revision:o.revision,digest:digest(o)});}
 const p=await c[who].tool({name:'actions.propose',args:f.request({evidence})});
 return {action:await c[who].submit(p.proposal),request:p.proposal};
}
test('B-001: approval journal does not shadow a public key with :approval suffix, including reopen',()=>run(async(f,c)=>{
 const request=f.request({idempotencyKey:'k:approval',input:{targetId:'stock2',isolated:true}}),b=await c.operator.submit(request);
 const a=await c.operator.submit(f.request({idempotencyKey:'k',requireApproval:true}));
 await c.manager.approve({actionId:a.actionId});
 const before=await business(f);
 assert.deepEqual(await c.operator.submit(request),b);
 const reopened=new Kernel(f.state,new RecoveryJournal(f.journal.path));
 assert.deepEqual(await reopened.submit(f.credentials.operator,request),b);
 const child=fork(new URL('../../scripts/foundation/replay-process.mjs',import.meta.url),[],{stdio:['ignore','pipe','pipe','ipc']});
 const result=once(child,'message'),exit=once(child,'exit'),timer=setTimeout(()=>child.kill('SIGKILL'),10000);
 try{
  child.send({config:{...cluster.config,user:'foundation_app',options:f.state.pool.options.options},journalPath:f.journal.path,credential:f.credentials.operator,request});
  assert.deepEqual((await result)[0],{result:b});assert.deepEqual(await exit,[0,null]);
 }finally{clearTimeout(timer);if(child.exitCode===null)child.kill();}
 assert.deepEqual(await business(f),before);
 const rows=f.journal.records();assert.equal(rows.filter(r=>r.approvalActor).every(r=>r.actionId===a.actionId&&r.operationId===a.operationId),true);
 assert.equal(f.journal.latest('t1','operator','k:approval').actionId,b.actionId);
}));
test('B-001: legacy approval records are separated by provenance, never by suffix',()=>run(async(f,c)=>{
 const bRequest=f.request({idempotencyKey:'legacy:approval',input:{targetId:'stock2',isolated:true}}),b=await c.operator.submit(bRequest);
 const a=await c.operator.submit(f.request({idempotencyKey:'legacy',requireApproval:true}));await c.manager.approve({actionId:a.actionId});
 const {recordHash,previousHash,sequence,operationKind,...record}=f.journal.records().at(-1);
 f.journal.append({...record,idempotencyKey:'legacy:approval'});
 assert.deepEqual(await c.operator.submit(bRequest),b);
 assert.equal(f.journal.latest('t1','operator','legacy').actionId,a.actionId);
}));
test('B-002: approval rejects changed non-target AI evidence without business mutation',()=>run(async(f,c)=>{
 const {action,request}=await pending(f,c);
 await c.operator.submit(f.request({input:{targetId:'stock2',isolated:true}}));
 const before=await business(f);
 await assert.rejects(c.manager.approve({actionId:action.actionId}),code('INVALID_EVIDENCE'));
 assert.deepEqual(await business(f),before);
 assert.equal(f.journal.records().at(-1).phase,'ABORTED');
 assert.equal((await c.operator.submit(request)).actionId,action.actionId);
 assert.ok((await f.owner.query("SELECT 1 FROM audit WHERE record->>'kind'='Denied' AND record->>'code'='INVALID_EVIDENCE'")).rowCount);
}));
for(const boundary of ['principal','delegation','columns'])test(`B-002: approval uses original evidence ${boundary} authority`,()=>run(async(f,c)=>{
 if(boundary!=='columns'){
  await f.owner.query("UPDATE principals SET stores='[\"s1\",\"s2\"]' WHERE id IN ('operator','manager')");
  await f.owner.query("UPDATE delegations SET stores='[\"s1\",\"s2\"]' WHERE id='delegation'");
 }
 const {action}=await pending(f,c,'delegated',boundary==='columns'?['stock','stock2']:['stock','foreign']);
 if(boundary==='principal')await f.owner.query("UPDATE principals SET stores='[\"s1\"]' WHERE id='operator'");
 if(boundary==='delegation')await f.owner.query("UPDATE delegations SET stores='[\"s1\"]' WHERE id='delegation'");
 if(boundary==='columns')await f.owner.query("UPDATE principals SET secret_access=true WHERE id IN ('operator','agent')");
 const before=await business(f);
 await assert.rejects(c.manager.approve({actionId:action.actionId}),code(boundary==='columns'?'INVALID_EVIDENCE':'NOT_FOUND'));
 assert.deepEqual(await business(f),before);assert.equal(f.journal.records().at(-1).phase,'ABORTED');
}));
test('B-002: unchanged delegated evidence succeeds despite wider approver columns; evidence is locked to commit',()=>run(async(f,c)=>{
 await f.owner.query("UPDATE principals SET secret_access=true WHERE id='manager'");
 const {action}=await pending(f,c,'delegated');let checked=false;
 f.kernel.fault=async point=>{
  if(point!=='approval-after-evidence')return;
  const writer=await f.owner.connect();
  try{
   await writer.query('BEGIN');await writer.query("SET LOCAL lock_timeout='100ms'");
   await assert.rejects(writer.query("UPDATE objects SET revision=revision+1 WHERE id='stock2'"),e=>e.code==='55P03');
   checked=true;
  }finally{await writer.query('ROLLBACK');writer.release();}
 };
 assert.equal((await c.manager.approve({actionId:action.actionId})).state,'PENDING_EXTERNAL');assert.equal(checked,true);
 assert.equal((await c.operator.get({id:'stock2'})).revision,1);
 const event=(await f.owner.query('SELECT event FROM outbox WHERE action_id=$1',[action.actionId])).rows[0].event;
 assert.equal(event.actor,'agent');assert.equal(event.onBehalfOf,'operator');
 assert.equal((await f.owner.query("SELECT count(*) FROM audit WHERE record->>'kind'='ApprovedCommit'")).rows[0].count,'1');
}));
for(const change of ['object','baseline'])test(`B-003: rollback cannot first-publish a REVIEWED definition after ${change} changed`,()=>run(async(f,c)=>{
 const definition=structuredClone(f.definition);definition.ontologyVersion='1.1.0';definition.ruleVersion='1.1.0';definition.programs=structuredClone(defaults);definition.programs.rule.allowRelease=false;
 await c.manager.draft({definition});await c.reviewer.review({version:'1.1.0'});
 if(change==='object')await c.operator.submit(f.request());
 else {const next=structuredClone(f.definition);next.ontologyVersion='1.2.0';await c.manager.draft({definition:next});await c.reviewer.review({version:'1.2.0'});await c.publisher.publish({version:'1.2.0'});}
 await assert.rejects(c.publisher.publish({version:'1.1.0'}),code('STALE_REVIEW'));
 const before=(await f.owner.query('SELECT * FROM policy')).rows,unchanged=await business(f),journal=f.journal.records();
 await assert.rejects(c.publisher.publish({version:'1.1.0',rollback:true}),code('PERMISSION_DENIED'));
 assert.deepEqual((await f.owner.query('SELECT * FROM policy')).rows,before);
 assert.deepEqual(await business(f),unchanged);assert.deepEqual(f.journal.records(),journal);
 assert.ok((await f.owner.query("SELECT 1 FROM audit WHERE record->>'kind'='Denied' AND record->>'code'='PERMISSION_DENIED'")).rowCount);
 assert.equal((await f.owner.query("SELECT state FROM definitions WHERE version='1.1.0'")).rows[0].state,'REVIEWED');
 await c.publisher.publish({version:'1.0.0',rollback:true});
 assert.equal((await c.operator.ontology()).definition.ontologyVersion,'1.0.0');
}));
for(const boundary of ['policy','principal','delegation'])test(`B-004: query/search/tool enforce search permission at ${boundary} boundary`,()=>run(async(f,c)=>{
 const client=boundary==='delegation'?c.delegated:c.operator,query={type:'InventoryPosition',search:'rice'};
 assert.equal((await client.query(query)).count,2);assert.equal((await client.search(query)).count,2);assert.equal((await client.tool({name:'objects.search',args:query})).count,2);
 if(boundary==='policy'){
  const definition=structuredClone(f.definition);definition.ontologyVersion='1.1.0';definition.policyVersion='1.1.0';definition.programs=structuredClone(defaults);definition.programs.policy.denyOperations=['search'];
  await c.manager.draft({definition});await c.reviewer.review({version:'1.1.0'});await c.publisher.publish({version:'1.1.0'});
 }else if(boundary==='principal')await f.owner.query("UPDATE principals SET operations='[\"read\",\"action\",\"tool\"]' WHERE id='operator'");
 else await f.owner.query("UPDATE delegations SET operations='[\"read\",\"action\",\"tool\"]' WHERE id='delegation'");
 const before=await business(f),journal=f.journal.records(),snapshots=(await f.owner.query('SELECT count(*) FROM snapshots')).rows;
 for(const operation of [()=>client.query(query),()=>client.query({...query,search:''}),()=>client.search(query),()=>client.tool({name:'objects.search',args:query})])await assert.rejects(operation(),code('PERMISSION_DENIED'));
 await assert.rejects(f.kernel.query(boundary==='delegation'?f.credentials.delegated:f.credentials.operator,query),code('PERMISSION_DENIED'));
 assert.deepEqual(await business(f),before);assert.deepEqual((await f.owner.query('SELECT count(*) FROM snapshots')).rows,snapshots);
 assert.deepEqual(f.journal.records(),journal);
 assert.ok((await f.owner.query("SELECT 1 FROM audit WHERE record->>'kind'='Denied' AND record->>'code'='PERMISSION_DENIED'")).rowCount);
 assert.equal((await client.get({id:'stock'})).id,'stock');assert.equal((await client.query({type:'InventoryPosition'})).count,2);
}));
