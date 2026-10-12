import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {defaults} from '../../src/definition-programs.mjs';
import {createGateway} from '../../src/gateway.mjs';
import {createClient} from '../../src/generated/client.mjs';
let cluster;before(async()=>{cluster=await startCluster();});after(async()=>{await cluster?.close();});
async function run(fn){const f=await fixture(cluster);try{await fn(f);}finally{await f.close();}}
const code=c=>e=>e.code===c;
function definition(f,version='1.1.0'){return {...structuredClone(f.definition),ontologyVersion:version,policyVersion:version,ruleVersion:version,workflowVersion:version,programs:structuredClone(defaults)};}
async function publish(f,d){await f.kernel.draft(f.credentials.manager,{definition:d});const sim=await f.kernel.review(f.credentials.reviewer,{version:d.ontologyVersion});await f.kernel.publish(f.credentials.publisher,{version:d.ontologyVersion});return sim;}
test('executable Rule/Workflow simulation and distinct publication enforce rejection, approval and rollback over HTTP',()=>run(async f=>{
 const d=definition(f);d.programs.rule.allowRelease=false;d.programs.workflow.approvalAtQuantity=10;
 const before=(await f.owner.query('SELECT fields,revision FROM objects ORDER BY id')).rows;
 const sim=await publish(f,d);
 assert.equal(sim.objectsChecked,2);assert.equal(sim.decisions.length,4);
 assert.ok(sim.decisions.every(row=>!['foreign','tenant-stock'].includes(row.id)));
 assert.equal(sim.decisions.find(row=>row.id==='stock'&&row.isolated).state,'PENDING_APPROVAL');
 assert.equal(sim.decisions.find(row=>row.id==='stock'&&!row.isolated).state,'RULE_REJECTED');
 assert.deepEqual((await f.owner.query('SELECT fields,revision FROM objects ORDER BY id')).rows,before);
 assert.equal((await f.owner.query('SELECT count(*) FROM actions')).rows[0].count,'0');
 const server=createGateway(f.kernel);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const options={url:`http://127.0.0.1:${server.address().port}`,tenant:'t1',token:f.credentials.operator.token};
  const {createContractClient}=await import('../../src/client-transport.mjs');const client=createContractClient(options,d);
  const a=await client.submit(f.request({ontologyVersion:d.ontologyVersion}));assert.equal(a.state,'PENDING_APPROVAL');
  assert.equal((await f.kernel.get(f.credentials.operator,{id:'stock'})).revision,1);
  await assert.rejects(client.submit(f.request({ontologyVersion:d.ontologyVersion,input:{targetId:'stock',isolated:false}})),code('RULE_REJECTED'));
  await f.kernel.approve(f.credentials.manager,{actionId:a.actionId});
  assert.equal((await client.status(a)).state,'PENDING_EXTERNAL');
  assert.equal((await f.kernel.get(f.credentials.operator,{id:'stock'})).revision,2);
  const publisher=createClient({...options,token:f.credentials.publisher.token});await publisher.publish({version:'1.0.0',rollback:true});
  assert.equal((await f.kernel.submit(f.credentials.operator,f.request({expectedRevision:2,input:{targetId:'stock',isolated:false}}))).state,'PENDING_EXTERNAL');
 }finally{await new Promise(resolve=>server.close(resolve));}
}));
test('published Policy rejects all action/search/tool entry points, records policy version, and can be rolled back',()=>run(async f=>{
 const d=definition(f);d.programs.policy.denyOperations=['search','action','tool'];
 const sim=await publish(f,d);assert.ok(sim.decisions.every(row=>row.state==='PERMISSION_DENIED'));
 await assert.rejects(f.kernel.search(f.credentials.operator,{type:'InventoryPosition'}),code('PERMISSION_DENIED'));
 await assert.rejects(f.kernel.validate(f.credentials.operator,f.request({ontologyVersion:d.ontologyVersion})),code('PERMISSION_DENIED'));
 await assert.rejects(f.kernel.submit(f.credentials.operator,f.request({ontologyVersion:d.ontologyVersion})),code('PERMISSION_DENIED'));
 await assert.rejects(f.kernel.tool(f.credentials.operator,{name:'objects.search',args:{type:'InventoryPosition'}}),code('PERMISSION_DENIED'));
 assert.equal((await f.kernel.get(f.credentials.operator,{id:'stock'})).revision,1);
 assert.equal((await f.owner.query('SELECT version FROM policy')).rows[0].version,d.policyVersion);
 assert.equal((await f.owner.query('SELECT count(*) FROM actions')).rows[0].count,'0');
 await f.kernel.publish(f.credentials.publisher,{version:'1.0.0',rollback:true});
 assert.equal((await f.kernel.submit(f.credentials.operator,f.request())).state,'PENDING_EXTERNAL');
}));
test('unversioned or code-bearing programs and out-of-scope authoring reject without publication',()=>run(async f=>{
 const d=definition(f);d.ruleVersion='1.0.0';d.programs.rule.allowRelease=false;
 await assert.rejects(f.kernel.draft(f.credentials.manager,{definition:d}),code('UNVERSIONED_DEFINITION'));
 d.ruleVersion='1.1.0';d.programs.rule.eval='return true';
 await assert.rejects(f.kernel.draft(f.credentials.manager,{definition:d}),code('INVALID_ARGUMENT'));
 await assert.rejects(f.kernel.draft(f.credentials.operator,{definition:definition(f)}),code('PERMISSION_DENIED'));
 assert.equal((await f.kernel.ontology(f.credentials.manager)).definition.ontologyVersion,'1.0.0');
}));
test('review baseline changes and published programs invalidate stale review and prior approval',()=>run(async f=>{
 const a=await f.kernel.submit(f.credentials.operator,f.request({requireApproval:true}));
 const d=definition(f),e=definition(f,'1.2.0');d.programs.rule.allowRelease=false;
 await f.kernel.draft(f.credentials.manager,{definition:d});await f.kernel.review(f.credentials.reviewer,{version:d.ontologyVersion});
 await publish(f,e);
 await assert.rejects(f.kernel.publish(f.credentials.publisher,{version:d.ontologyVersion}),code('STALE_REVIEW'));
 await assert.rejects(f.kernel.approve(f.credentials.manager,{actionId:a.actionId}),code('STALE_APPROVAL'));
 assert.equal((await f.kernel.get(f.credentials.operator,{id:'stock'})).revision,1);
}));
test('published Policy revocation fences queued projection and ERP delivery, without rewriting original Action',()=>run(async f=>{
 const {startErp}=await import('../../scripts/foundation/erp.mjs');const {Writeback,HttpWritebackPort}=await import('../../src/writeback.mjs');
 const erp=await startErp(cluster);try{
  f.kernel.writeback=new Writeback(f.kernel,new HttpWritebackPort(erp.url,erp.token));
  const a=await f.kernel.submit(f.credentials.operator,f.request());const d=definition(f);d.programs.policy.denyOperations=['action'];await publish(f,d);
  await assert.rejects(f.kernel.consume(f.credentials.manager,a),code('PERMISSION_DENIED'));
  await assert.rejects(f.kernel.dispatch(f.credentials.manager,a),code('PERMISSION_DENIED'));
  assert.equal(erp.controller.applyRequests,0);assert.equal((await f.kernel.status(f.credentials.operator,a)).state,'PENDING_EXTERNAL');
  assert.equal((await f.owner.query('SELECT count(*) FROM inbox')).rows[0].count,'0');
  await f.kernel.publish(f.credentials.publisher,{version:'1.0.0',rollback:true});assert.equal((await f.kernel.dispatch(f.credentials.manager,a)).state,'DELIVERED');
 }finally{await erp.close();}
}));
test('Policy change after durable INTENT aborts before state mutation and leaves a classified journal',()=>run(async f=>{
 const d=definition(f);d.programs.policy.denyOperations=['action'];const request=f.request();
 f.kernel.fault=async point=>{if(point==='after-intent')await publish(f,d);};
 await assert.rejects(f.kernel.submit(f.credentials.operator,request),code('PERMISSION_DENIED'));
 assert.equal((await f.kernel.get(f.credentials.operator,{id:'stock'})).revision,1);
 for(const table of ['actions','outbox','history'])assert.equal((await f.owner.query(`SELECT count(*) FROM ${table}`)).rows[0].count,'0');
 assert.equal(f.journal.latest('t1','operator',request.idempotencyKey).phase,'ABORTED');assert.equal(f.journal.fenced(),false);
}));
