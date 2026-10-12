import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { startCluster,fixture } from '../../scripts/foundation/runtime.mjs';
import { digest } from '../../src/contracts.mjs';
import { invoke } from '../../src/gateway.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
let cluster;before(async()=>{cluster=await startCluster();});after(async()=>{await cluster?.close();});
const code=expected=>e=>e.code===expected;
async function run(fn){const f=await fixture(cluster);try{await fn(f);}finally{await f.close();}}
test('get/list/search/link/column/Action/tool share tenant and store scope without counts or secret snippets',()=>run(async f=>{
 const c=f.credentials.operator;
 const one=await f.kernel.get(c,{id:'stock'});assert.equal(one.fields.secret,undefined);assert.equal(one.policyVersion,'1.0.0');
 await assert.rejects(f.kernel.get(c,{id:'foreign'}),code('NOT_FOUND'));
 await assert.rejects(f.kernel.get(c,{id:'tenant-stock'}),code('NOT_FOUND'));
 const query=await f.kernel.query(c,{type:'InventoryPosition',limit:1});assert.equal(query.count,2);assert.equal(query.items.length,1);
 const next=await f.kernel.query(c,{type:'InventoryPosition',limit:1,cursor:query.nextCursor});assert.equal(next.items[0].id,'stock2');
 assert.equal((await f.kernel.search(c,{type:'InventoryPosition',search:'hidden-word'})).count,0);
 assert.equal((await f.kernel.traverse(c,{id:'lot',link:'stock'})).items.length,1);
 await assert.rejects(f.kernel.query(c,{type:'InventoryPosition',projection:['secret']}),code('PERMISSION_DENIED'));
 await assert.rejects(f.kernel.query(c,{type:'InventoryPosition',filter:{op:'eq',field:'secret',value:'hidden-word'}}),code('PERMISSION_DENIED'));
 for(const op of ['query','search'])await assert.rejects(f.kernel[op](c,{type:'InventoryPosition',filter:{op:'eq',field:'name',value:'no-match'},projection:['secret']}),code('PERMISSION_DENIED'));
 await assert.rejects(f.kernel.tool(c,{name:'objects.search',args:{type:'InventoryPosition',search:'no-match',projection:['secret']}}),code('PERMISSION_DENIED'));
 await assert.rejects(f.kernel.submit(c,f.request({input:{targetId:'foreign',isolated:true}})),code('PERMISSION_DENIED'));
 assert.equal((await f.kernel.tool(c,{name:'objects.search',args:{type:'InventoryPosition',search:'rice'}})).count,2);
 await assert.rejects(f.kernel.tool(c,{name:'sql',args:{sql:'UPDATE objects'}}),code('PERMISSION_DENIED'));
}));
test('trusted delegated identity, invalid delegation and actor forgery are audited',()=>run(async f=>{
 const request=f.request();const result=await f.kernel.submit(f.credentials.delegated,request);
 const a=(await f.owner.query('SELECT * FROM actions WHERE id=$1',[result.actionId])).rows[0];assert.equal(a.actor,'agent');assert.equal(a.subject,'operator');
 assert.equal(f.journal.records()[0].onBehalfOf,'operator');
 await assert.rejects(f.kernel.get({...f.credentials.operator,actor:'manager'},{id:'stock'}),code('PERMISSION_DENIED'));
 await assert.rejects(f.kernel.submit(f.credentials.operator,{...f.request(),actor:'manager'}),code('INVALID_ARGUMENT'));
 await assert.rejects(f.kernel.get({...f.credentials.operator,delegationId:'delegation'},{id:'stock'}),code('PERMISSION_DENIED'));
 await f.owner.query("UPDATE delegations SET active=false WHERE id='delegation'");
 await assert.rejects(f.kernel.submit(f.credentials.delegated,request),code('PERMISSION_DENIED'));
 await assert.rejects(f.kernel.consume(f.credentials.manager,{operationId:result.operationId}),code('PERMISSION_DENIED'));
 const denied=await f.owner.query("SELECT record FROM audit WHERE record->>'kind'='Denied'");assert.ok(denied.rowCount>=4);
 assert.ok(!JSON.stringify(denied.rows).includes(f.credentials.operator.token));
}));
test('policy outage, session expiry, revocation and cursor changes fail closed',()=>run(async f=>{
 const page=await f.kernel.query(f.credentials.operator,{type:'InventoryPosition',limit:1});
 await f.owner.query('UPDATE policy SET epoch=epoch+1');
 await assert.rejects(f.kernel.query(f.credentials.operator,{type:'InventoryPosition',limit:1,cursor:page.nextCursor}),code('INCONSISTENT_STATE'));
 await f.owner.query('UPDATE policy SET available=false');
 for(const operation of [()=>f.kernel.get(f.credentials.operator,{id:'stock'}),()=>f.kernel.search(f.credentials.operator,{type:'InventoryPosition'}),()=>f.kernel.submit(f.credentials.operator,f.request()),()=>f.kernel.tool(f.credentials.operator,{name:'objects.search',args:{type:'InventoryPosition'}})]) await assert.rejects(operation(),code('UNAVAILABLE'));
 await f.owner.query('UPDATE policy SET available=true');await f.owner.query("UPDATE sessions SET expires=now()-interval '1 second' WHERE principal='operator'");
 await assert.rejects(f.kernel.get(f.credentials.operator,{id:'stock'}),code('PERMISSION_DENIED'));
 assert.equal((await f.owner.query('SELECT count(*) FROM actions')).rows[0].count,'0');
}));
test('AI proposal is typed, grounded, permission intersected and cannot execute directly',()=>run(async f=>{
 const o=await f.kernel.get(f.credentials.operator,{id:'stock'});const request=f.request({evidence:[{id:o.id,revision:o.revision,digest:digest(o)}]});
 const proposal=await f.kernel.tool(f.credentials.operator,{name:'actions.propose',args:request});assert.equal(proposal.state,'PROPOSED');assert.equal(proposal.proposal.requireApproval,true);
 assert.equal((await f.owner.query('SELECT count(*) FROM actions')).rows[0].count,'0');
 await assert.rejects(f.kernel.tool(f.credentials.reader,{name:'actions.propose',args:request}),code('PERMISSION_DENIED'));
 await assert.rejects(f.kernel.tool(f.credentials.operator,{name:'actions.propose',args:f.request()}),code('INVALID_EVIDENCE'));
 await assert.rejects(f.kernel.tool(f.credentials.operator,{name:'actions.propose',args:{...request,input:{targetId:'stock',isolated:'yes'}}}),code('INVALID_ARGUMENT'));
 await assert.rejects(f.kernel.tool(f.credentials.operator,{name:'actions.propose',args:{...request,evidence:[{id:'stock',revision:1,digest:'forged'}]}}),code('INVALID_EVIDENCE'));
 const result=await f.kernel.submit(f.credentials.operator,proposal.proposal);assert.equal(result.state,'PENDING_APPROVAL');
 await assert.rejects(f.kernel.approve(f.credentials.operator,{actionId:result.actionId}),code('PERMISSION_DENIED'));
 assert.equal((await f.kernel.approve(f.credentials.manager,{actionId:result.actionId})).state,'PENDING_EXTERNAL');
 assert.equal((await f.kernel.get(f.credentials.operator,{id:'stock'})).revision,2);
}));
test('public envelope rejects spoofed tenant and actor and retains versions',()=>run(async f=>{
 const e={contractVersion:'1.0.0',requestId:'r',traceId:'t',tenant:'t1',operation:'get',body:{id:'stock'}};
 assert.equal((await invoke(f.kernel,f.credentials.operator,e)).result.id,'stock');
 await assert.rejects(invoke(f.kernel,f.credentials.operator,{...e,tenant:'t2'}),code('PERMISSION_DENIED'));
 await assert.rejects(invoke(f.kernel,f.credentials.operator,{...e,actor:'manager'}),code('INVALID_ARGUMENT'));
}));
test('delegation subject change between journal intent and transaction is denied without mixed identity',()=>run(async f=>{
 f.kernel.fault=async point=>{if(point==='after-intent')await f.owner.query("UPDATE delegations SET subject='manager' WHERE id='delegation'");};
 await assert.rejects(f.kernel.submit(f.credentials.delegated,f.request()),code('PERMISSION_DENIED'));
 assert.equal((await f.owner.query('SELECT count(*) FROM actions')).rows[0].count,'0');
 assert.equal((await f.kernel.get(f.credentials.operator,{id:'stock'})).revision,1);
 assert.equal(f.journal.records().at(-1).phase,'ABORTED');
}));
test('approval revalidates original delegation scope, audience and subject',()=>run(async f=>{
 const a=await f.kernel.submit(f.credentials.delegated,f.request({requireApproval:true}));
 for(const sql of ["UPDATE delegations SET operations='[\"read\"]'", "UPDATE delegations SET operations='[\"action\"]', audience='other'", "UPDATE delegations SET audience='kernel', subject='manager'"]) {
  await f.owner.query(sql);
  await assert.rejects(f.kernel.approve(f.credentials.manager,a),code('PERMISSION_DENIED'));
 }
 assert.equal((await f.kernel.get(f.credentials.operator,{id:'stock'})).revision,1);
 assert.equal((await f.owner.query('SELECT count(*) FROM outbox')).rows[0].count,'0');
}));
test('authorization matrix records actual allowed and denied calls with policy and trusted subjects',()=>run(async f=>{
 const c=f.credentials.operator,rows=[];
 const cases=[
  ['get',()=>f.kernel.get(c,{id:'stock'}),()=>f.kernel.get(c,{id:'foreign'}),'NOT_FOUND'],
  ['list',()=>f.kernel.query(c,{type:'InventoryPosition'}),()=>f.kernel.query(c,{type:'InventoryPosition',projection:['secret']}),'PERMISSION_DENIED'],
  ['search',()=>f.kernel.search(c,{type:'InventoryPosition',search:'rice'}),()=>f.kernel.search(c,{type:'InventoryPosition',filter:{op:'eq',field:'secret',value:'hidden-word'}}),'PERMISSION_DENIED'],
  ['column',()=>f.kernel.get(c,{id:'stock',projection:['quantity']}),()=>f.kernel.get(c,{id:'stock',projection:['secret']}),'PERMISSION_DENIED'],
  ['Action',()=>f.kernel.validate(c,f.request()),()=>f.kernel.validate(c,f.request({input:{targetId:'foreign',isolated:true}})),'PERMISSION_DENIED'],
  ['AI tool',()=>f.kernel.tool(c,{name:'objects.search',args:{type:'InventoryPosition'}}),()=>f.kernel.tool(c,{name:'shell',args:{command:'synthetic-only'}}),'PERMISSION_DENIED']
 ];
 for(const [path,allowed,denied,expected] of cases){await allowed();let actual;try{await denied();assert.fail('expected denial');}catch(e){actual=e.code;}assert.equal(actual,expected);rows.push({path,actor:'operator',onBehalfOf:null,policyVersion:'1.0.0',allowed:true,denied:actual});}
 const a=await f.kernel.submit(f.credentials.delegated,f.request());
 const audit=(await f.owner.query("SELECT record FROM audit WHERE record->>'actionId'=$1",[a.actionId])).rows.map(r=>r.record);
 assert.equal(audit[0].actor,'agent');assert.equal(audit[0].onBehalfOf,'operator');
 await mkdir('evidence/generated/foundation',{recursive:true});
 await writeFile('evidence/generated/foundation/authorization-matrix.json',JSON.stringify({contractVersion:'1.0.0',rows,delegated:a,audit},null,2)+'\n');
}));
