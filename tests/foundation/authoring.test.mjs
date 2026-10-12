import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {createGateway} from '../../src/gateway.mjs';
import {createClient} from '../../src/generated/client.mjs';
import {defaults} from '../../src/definition-programs.mjs';
let cluster;before(async()=>{cluster=await startCluster();});after(async()=>{await cluster?.close();});
const code=c=>e=>e.code===c;
async function run(fn){const f=await fixture(cluster),server=createGateway(f.kernel);await new Promise(r=>server.listen(0,'127.0.0.1',r));try{const client=id=>createClient({url:`http://127.0.0.1:${server.address().port}`,tenant:'t1',token:f.credentials[id].token});await fn({...f,client});}finally{await new Promise(r=>server.close(r));await f.close();}}
function definition(f){return {...structuredClone(f.definition),ontologyVersion:'1.1.0',ruleVersion:'1.1.0',programs:{...structuredClone(defaults),rule:{...defaults.rule,allowRelease:false}}};}
test('HTTP Authoring diff and editable simulation cases bind independent review and invalidate changed cases',()=>run(async f=>{
 const author=f.client('manager'),reviewer=f.client('reviewer'),publisher=f.client('publisher'),d=definition(f);
 await author.draft({definition:d});const diff=await author.definitionDiff({version:'1.1.0'});assert.ok(diff.changes.some(c=>c.path==='/programs'));assert.ok(diff.baselineDigest!==diff.digest);
 await assert.rejects(f.client('operator').definitionDiff({version:'1.1.0'}),code('PERMISSION_DENIED'));
 await assert.rejects(author.editCases({version:'1.1.0',cases:[{id:'foreign',isolated:true,expected:'PENDING_EXTERNAL'}]}),code('PERMISSION_DENIED'));
 await author.editCases({version:'1.1.0',cases:[{id:'stock',isolated:false,expected:'PENDING_EXTERNAL'}]});
 await assert.rejects(reviewer.review({version:'1.1.0'}),code('SIMULATION_FAILED'));
 assert.equal((await f.owner.query("SELECT state FROM definitions WHERE version='1.1.0'")).rows[0].state,'DRAFT');
 await author.editCases({version:'1.1.0',cases:[{id:'stock',isolated:false,expected:'RULE_REJECTED'}]});const sim=await reviewer.review({version:'1.1.0'});assert.equal(sim.caseResults[0].passed,true);
 assert.equal((await f.kernel.get(f.credentials.operator,{id:'stock'})).revision,1);
 await author.editCases({version:'1.1.0',cases:[]});await assert.rejects(publisher.publish({version:'1.1.0'}),code('PERMISSION_DENIED'));
 await reviewer.review({version:'1.1.0'});await publisher.publish({version:'1.1.0'});await publisher.publish({version:'1.0.0',rollback:true});
 await mkdir('evidence/generated/foundation',{recursive:true});await writeFile('evidence/generated/foundation/authoring-trace.json',JSON.stringify({diff,simulation:sim,rollback:'1.0.0',mutationDuringSimulation:false},null,2)+'\n');
}));
test('changed Object revision invalidates reviewed simulation before publication',()=>run(async f=>{
 await f.kernel.draft(f.credentials.manager,{definition:definition(f)});await f.kernel.review(f.credentials.reviewer,{version:'1.1.0'});
 await f.kernel.submit(f.credentials.operator,f.request());await assert.rejects(f.kernel.publish(f.credentials.publisher,{version:'1.1.0'}),code('STALE_REVIEW'));
 assert.equal((await f.kernel.ontology(f.credentials.operator)).definition.ontologyVersion,'1.0.0');
}));
