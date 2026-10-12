import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {startErp} from '../../scripts/foundation/erp.mjs';
import {Writeback,HttpWritebackPort} from '../../src/writeback.mjs';
import {createGateway} from '../../src/gateway.mjs';
import {createContractClient} from '../../src/client-transport.mjs';
import {digest} from '../../src/contracts.mjs';
import {seedStore} from '../../scripts/demo/seed.mjs';
import {injectExternal,injectCandidateChange} from '../../scripts/demo/failure-injection.mjs';
let cluster;before(async()=>{cluster=await startCluster();});after(async()=>{await cluster?.close();});
function assertNoRestricted(value) {
 if(value===null||typeof value!=='object')return;
 for(const [key,child]of Object.entries(value)){
  assert.notEqual(key,'secret','restricted Object column must not enter external ERP payload');
  assert.notEqual(child,'hidden-word','restricted value must not cross the ERP boundary');
  assertNoRestricted(child);
 }
}
test('store export contract excludes extra and nested fields for every Action and refuses unsupported shapes',()=>{
 const worker=new Writeback(null,null);
 const impact={phase:'DETECTED',lotId:'demo-lot',affectedIds:'["stock"]',affectedStores:'["s1"]',affectedQuantity:10};
 const order={...impact,phase:'REPLACEMENT_ORDERED',candidateId:'replacement',orderQuantity:10,orderAmount:10000};
 const notice={...order,phase:'CUSTOMER_NOTIFIED',customerMessage:'synthetic notice',customerCount:7};
 for(const [actionType,expected]of Object.entries({DetectRecallImpact:impact,QuarantineInventory:{isolated:true},CreateReplacementOrder:order,PublishCustomerNotice:notice})){
  const event={contractVersion:'1.0.0',actionType,fields:{isolated:true,...expected,secret:'hidden-word',futurePrivate:{nested:{secret:'hidden-word'}}}};
  const before=structuredClone(event),payload=worker.payload({event});
  assert.deepEqual(payload.fields,expected);assertNoRestricted(payload);assert.deepEqual(event,before);
  for(const name of Object.keys(expected)){
   const invalid=structuredClone(event);invalid.fields[name]={secret:'hidden-word'};
   assert.throws(()=>worker.payload({event:invalid}),{code:'INCONSISTENT_STATE'});
  }
 }
 for(const actionType of ['UnknownAction','toString','__proto__'])assert.throws(()=>worker.payload({event:{contractVersion:'1.0.0',actionType,fields:{isolated:true}}}),{code:'INCONSISTENT_STATE'});
 assert.throws(()=>worker.payload({event:{contractVersion:'2.0.0',actionType:'SetIsolation',fields:{isolated:true}}}),{code:'INCONSISTENT_STATE'});
});
async function run(label,fn,{fault}={}){
 const f=await fixture(cluster,{definitionPath:'config/store-ontology.json',fault}),erp=await startErp(cluster,{stores:['s1','s2']});
 const seed=await seedStore(f);f.kernel.writeback=new Writeback(f.kernel,new HttpWritebackPort(erp.url,erp.token));
 const server=createGateway(f.kernel);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const clients=Object.fromEntries(Object.entries(f.credentials).map(([id,c])=>[id,createContractClient({url:`http://127.0.0.1:${server.address().port}`,tenant:'t1',...c},f.definition)]));
 const responses=[];
 async function request(actionType,input,key,credential='operator'){
  const target=await clients[credential].get({id:input.targetId});
  const ids=actionType==='SetIsolation'?[]:['recall','demo-lot','stock','stock2',...(actionType==='CreateReplacementOrder'?['replacement']:[])];
  const objects=await Promise.all([...new Set(ids)].map(id=>clients[credential].get({id})));
  return {actionType,actionVersion:'1.0.0',ontologyVersion:'1.1.0',input,expectedRevision:target.revision,idempotencyKey:key,evidence:objects.map(o=>({id:o.id,revision:o.revision,digest:digest(o)}))};
 }
 async function submit(type,input,key,credential='operator') {const req=await request(type,input,key,credential);const result=await clients[credential].submit(req);responses.push({request:req,result});return result;}
 async function deliver(a){assert.equal((await clients.manager.dispatch(a)).state,'DELIVERED');assert.equal((await clients.operator.status(a)).state,'SUCCEEDED');}
 async function quarantine(){await deliver(await submit('DetectRecallImpact',{targetId:'recall'},'detect'));for(const id of seed.stocks)await deliver(await submit('QuarantineInventory',{targetId:id,caseId:'recall'},'quarantine:'+id));}
 try{
  await fn({...f,url:`http://127.0.0.1:${server.address().port}`,erp,clients,seed,request,submit,deliver,quarantine,responses});
  const audit=(await f.owner.query('SELECT sequence,previous_hash,hash,record FROM audit ORDER BY sequence')).rows;
  let previous='GENESIS';for(const row of audit){assert.equal(row.previous_hash,previous);assert.equal(row.hash,digest({previous,record:row.record}));previous=row.hash;}
  const actions=(await f.owner.query('SELECT id,actor,subject,state,request,result,operation_id FROM actions ORDER BY id')).rows;
  for(const action of actions){assert.ok(['1.1.0','1.2.0'].includes(action.request.ontologyVersion));assert.ok(['1.1.0','1.2.0'].includes(action.request.ruleVersion));assert.ok(audit.some(a=>a.record.actionId===action.id&&a.record.ontologyVersion===action.request.ontologyVersion&&a.record.ruleVersion===action.request.ruleVersion));}
  const outbox=(await f.owner.query('SELECT operation_id,action_id,state,event FROM outbox ORDER BY aggregate_id,sequence')).rows;
  const ledger=(await erp.owner.query('SELECT * FROM ledger')).rows;
  for(const row of ledger){assertNoRestricted(row.payload);assert.equal(row.digest,digest(row.payload));}
  const telemetry=(await f.owner.query('SELECT record FROM telemetry ORDER BY sequence')).rows;
  await mkdir('evidence/generated/demo',{recursive:true});
  await writeFile(`evidence/generated/demo/${label}.json`,JSON.stringify({seed,responses,actions,outbox,ledger,audit,telemetry},null,2)+'\n');
 }finally{await new Promise(r=>server.close(r));await erp.close();await f.close();}
}
test('store normal: impact, delegated quarantine, enforced approval, replacement ERP and customer response',()=>run('normal',async f=>{
 await f.deliver(await f.submit('DetectRecallImpact',{targetId:'recall'},'detect'));
 const impact=await f.clients.operator.get({id:'recall'});assert.equal(impact.fields.affectedQuantity,15);assert.deepEqual(JSON.parse(impact.fields.affectedIds),['stock','stock2']);assert.deepEqual(JSON.parse(impact.fields.affectedStores),['s1','s2']);
 for(const id of f.seed.stocks)await f.deliver(await f.submit('QuarantineInventory',{targetId:id,caseId:'recall'},'quarantine:'+id,'delegated'));
 const a=await f.submit('CreateReplacementOrder',{targetId:'recall',candidateId:'replacement',quantity:15},'order');
 assert.equal(a.state,'PENDING_APPROVAL');assert.equal((await f.clients.operator.get({id:'recall'})).fields.phase,'DETECTED');
 assert.equal(Number((await f.owner.query('SELECT count(*) FROM outbox WHERE action_id=$1',[a.actionId])).rows[0].count),0);
 await assert.rejects(f.clients.operator.approve(a),{code:'PERMISSION_DENIED'});
 await assert.rejects(f.clients.manager.dispatch(a),{code:'NOT_FOUND'});
 assert.equal((await f.clients.manager.approve(a)).state,'PENDING_EXTERNAL');await f.deliver(a);
 const n=await f.submit('PublishCustomerNotice',{targetId:'recall',message:'Synthetic refund and replacement notice for sold rice'},'notice');await f.deliver(n);
 const final=await f.clients.operator.get({id:'recall'});assert.equal(final.fields.phase,'CUSTOMER_NOTIFIED');assert.equal(final.fields.customerCount,7);assert.equal(final.fields.orderAmount,15000);
 const effect=(await f.erp.owner.query("SELECT fields FROM effects WHERE aggregate_id='recall'")).rows[0].fields;assert.equal(effect.customerCount,7);assert.equal(effect.orderQuantity,15);
 assert.equal(Number((await f.erp.owner.query('SELECT count(*) FROM ledger')).rows[0].count),5);
 assert.equal((await f.clients.operator.history({id:'recall'})).items.length,3);
}));

for(const mode of ['ordinary','delegated','approved'])test(`store restricted export: ${mode} quarantine and lost acknowledgement`,()=>run(`restricted-export-${mode}`,async f=>{
 await f.deliver(await f.submit('DetectRecallImpact',{targetId:'recall'},'detect'));
 const credential=mode==='delegated'?'delegated':'operator';
 const req=await f.request('QuarantineInventory',{targetId:'stock',caseId:'recall'},'restricted-export',credential);
 if(mode==='approved')req.requireApproval=true;
 const a=await f.clients[credential].submit(req);f.responses.push({request:req,result:a});
 if(mode==='approved'){
  assert.equal(a.state,'PENDING_APPROVAL');
  assert.equal(Number((await f.owner.query('SELECT count(*) FROM outbox WHERE action_id=$1',[a.actionId])).rows[0].count),0);
  await f.clients.manager.approve(a);
 }
 injectExternal(f.erp,'lost-ack');
 assert.equal((await f.clients.manager.dispatch(a)).state,'UNKNOWN');
 const sends=f.erp.controller.applyRequests;
 const row=(await f.erp.owner.query('SELECT * FROM ledger WHERE operation_id=$1',[a.operationId])).rows[0];
 assertNoRestricted(row.payload);
 assert.deepEqual(row.payload.fields,{isolated:true});
 assert.equal(row.digest,digest(row.payload));
 assert.equal(row.payload.actionId,a.actionId);
 const event=(await f.owner.query('SELECT * FROM outbox WHERE operation_id=$1',[a.operationId])).rows[0];
 assert.equal(event.event.fields.secret,'hidden-word','internal evidence must retain its restricted column');
 assert.deepEqual(f.kernel.writeback.payload(event),row.payload);
 assert.equal((await f.clients.manager.dispatch(a)).state,'UNKNOWN');
 injectExternal(f.erp,'normal');
 assert.equal((await f.clients.manager.reconcile(a)).state,'DELIVERED');
 assert.equal((await f.clients.operator.status(a)).state,'SUCCEEDED');
 assert.equal(f.erp.controller.applyRequests,sends);
 assert.equal((await f.clients[credential].submit(req)).actionId,a.actionId);
 assert.equal((await f.clients.manager.dispatch(a)).state,'DUPLICATE');
 assert.equal(Number((await f.erp.owner.query('SELECT count(*) FROM ledger WHERE operation_id=$1',[a.operationId])).rows[0].count),1);
 assert.deepEqual((await f.erp.owner.query("SELECT fields FROM effects WHERE aggregate_id='stock'")).rows[0].fields,{isolated:true});
}));
test('store denial and constraints: foreign scope, missing evidence, unsafe candidate, deadline and prerequisite',()=>run('denials',async f=>{
 await assert.rejects(f.clients.operator.get({id:'foreign'}),{code:'NOT_FOUND'});
 await assert.rejects(f.clients.reader.submit(await f.request('DetectRecallImpact',{targetId:'recall'},'reader')),{code:'PERMISSION_DENIED'});
 const r=await f.request('DetectRecallImpact',{targetId:'recall'},'missing');await assert.rejects(f.clients.operator.submit({...r,evidence:[]}),{code:'INVALID_EVIDENCE'});
 await assert.rejects(f.submit('CreateReplacementOrder',{targetId:'recall',candidateId:'replacement',quantity:15},'early'),{code:'QUARANTINE_REQUIRED'});
 await f.quarantine();await injectCandidateChange(f);
 await assert.rejects(f.submit('CreateReplacementOrder',{targetId:'recall',candidateId:'replacement',quantity:15},'unsafe'),{code:'RULE_REJECTED'});
 f.kernel.clock=()=>Date.now()+7200000;
 await assert.rejects(f.submit('CreateReplacementOrder',{targetId:'recall',candidateId:'replacement',quantity:15},'expired'),{code:'RECALL_EXPIRED'});
 assert.equal((await f.clients.operator.get({id:'recall'})).fields.phase,'DETECTED');
 const denied=(await f.owner.query("SELECT record FROM audit WHERE record->>'operation'='submit' AND record->>'kind'='Denied'")).rows;assert.ok(denied.length>=4);for(const {record}of denied){assert.equal(record.ontologyVersion,'1.1.0');assert.equal(record.ruleVersion,'1.1.0');assert.ok(record.inputDigest);}
}));
test('store concurrent isolation, replay and mismatched key preserve one effect',()=>run('conflict',async f=>{
 await f.deliver(await f.submit('DetectRecallImpact',{targetId:'recall'},'detect'));
 const a=await f.request('SetIsolation',{targetId:'stock',isolated:true},'race-a');const b={...a,idempotencyKey:'race-b'};
 const results=await Promise.all([f.clients.operator.submit(a),f.clients.operator.submit(b)]);assert.deepEqual(results.map(r=>r.state).sort(),['CONFLICT','PENDING_EXTERNAL']);f.responses.push({request:a,result:results[0]},{request:b,result:results[1]});
 const winner=results.find(r=>r.state==='PENDING_EXTERNAL'),original=results[0]===winner?a:b;await f.deliver(winner);
 assert.equal((await f.clients.operator.submit(original)).actionId,winner.actionId);
 await assert.rejects(f.clients.operator.submit({...original,input:{targetId:'stock',isolated:false}}),{code:'IDEMPOTENCY_MISMATCH'});
 assert.equal((await f.clients.operator.get({id:'stock'})).revision,2);
 assert.equal(Number((await f.erp.owner.query("SELECT count(*) FROM ledger WHERE payload->>'aggregateId'='stock'")).rows[0].count),1);
}));
test('store approval rechecks changed candidate and original delegation',()=>run('stale-approval',async f=>{
 await f.quarantine();const a=await f.submit('CreateReplacementOrder',{targetId:'recall',candidateId:'replacement',quantity:15},'order','delegated');assert.equal(a.state,'PENDING_APPROVAL');
 await injectCandidateChange(f);await assert.rejects(f.clients.manager.approve(a),{code:'RULE_REJECTED'});
 await f.owner.query("UPDATE delegations SET active=false WHERE id='delegation'");await assert.rejects(f.clients.manager.approve(a),{code:'PERMISSION_DENIED'});
 assert.equal((await f.clients.operator.status(a)).state,'PENDING_APPROVAL');assert.equal((await f.clients.operator.get({id:'recall'})).fields.phase,'DETECTED');
}));
test('store external rejection blocks customer notice; lost ack reconciles without resend',()=>run('external-failure',async f=>{
 await f.quarantine();const a=await f.submit('CreateReplacementOrder',{targetId:'recall',candidateId:'replacement',quantity:15},'order');await f.clients.manager.approve(a);
 injectExternal(f.erp,'reject');assert.equal((await f.clients.manager.dispatch(a)).state,'REJECTED');assert.equal((await f.clients.operator.status(a)).state,'EXTERNAL_FAILED');
 await assert.rejects(f.submit('PublishCustomerNotice',{targetId:'recall',message:'replacement ready'},'premature'),{code:'EXTERNAL_PENDING'});
 assert.equal(Number((await f.erp.owner.query('SELECT count(*) FROM ledger WHERE operation_id=$1',[a.operationId])).rows[0].count),0);
}));
test('store unknown external success reconciles without blind resend',()=>run('unknown-success',async f=>{
 await f.quarantine();
 const req=await f.request('SetIsolation',{targetId:'stock2',isolated:true},'lost');const lost=await f.clients.operator.submit(req);f.responses.push({request:req,result:lost});injectExternal(f.erp,'lost-ack');
 assert.equal((await f.clients.manager.dispatch(lost)).state,'UNKNOWN');const sends=f.erp.controller.applyRequests;
 assert.equal((await f.clients.manager.dispatch(lost)).state,'UNKNOWN');assert.equal(f.erp.controller.applyRequests,sends);
 injectExternal(f.erp,'normal');assert.equal((await f.clients.manager.reconcile(lost)).state,'DELIVERED');assert.equal(f.erp.controller.applyRequests,sends);
 assert.equal((await f.clients.operator.status(lost)).state,'SUCCEEDED');
}));
test('store definition publication invalidates pending approval; fresh evaluation and double approval remain safe',()=>run('definition-change',async f=>{
 await f.quarantine();const old=await f.submit('CreateReplacementOrder',{targetId:'recall',candidateId:'replacement',quantity:15},'old-order');
 const definition=structuredClone(f.definition);definition.ontologyVersion='1.2.0';
 await f.clients.manager.draft({definition});await f.clients.reviewer.review({version:'1.2.0'});await f.clients.publisher.publish({version:'1.2.0'});
 await assert.rejects(f.clients.manager.approve(old),{code:'STALE_APPROVAL'});
 const denial=(await f.owner.query("SELECT record FROM audit WHERE record->>'operation'='approve' AND record->>'code'='STALE_APPROVAL' ORDER BY sequence DESC LIMIT 1")).rows[0].record;
 assert.equal(denial.actionId,old.actionId);assert.equal(denial.operationId,old.operationId);assert.equal(denial.ontologyVersion,'1.2.0');assert.equal(denial.originalVersions.ontology,'1.1.0');assert.ok(denial.evidence.length>0);
 assert.equal((await f.clients.operator.status(old)).state,'PENDING_APPROVAL');
 // Re-evaluation uses the newly published contract, retaining current evidence.
 const req=await f.request('CreateReplacementOrder',{targetId:'recall',candidateId:'replacement',quantity:15},'fresh-order');req.ontologyVersion='1.2.0';
 const current=createContractClient({url:f.url,tenant:'t1',...f.credentials.operator},definition);const fresh=await current.submit(req);f.responses.push({request:req,result:fresh});assert.equal(fresh.state,'PENDING_APPROVAL');
 await f.clients.manager.approve(fresh);await assert.rejects(f.clients.manager.approve(fresh),{code:'PERMISSION_DENIED'});await f.deliver(fresh);
}));

async function publishProgram(f,patch){
 const definition=structuredClone(f.definition);definition.ontologyVersion='1.2.0';
 definition.programs={policy:{denyOperations:[]},rule:{minimumQuantity:null,allowRelease:true},workflow:{approvalAtQuantity:null},...patch};
 if(patch.rule)definition.ruleVersion='1.2.0';if(patch.workflow)definition.workflowVersion='1.2.0';
 await f.clients.manager.draft({definition});await f.clients.reviewer.review({version:'1.2.0'});await f.clients.publisher.publish({version:'1.2.0'});
 const clients=Object.fromEntries(Object.entries(f.credentials).map(([id,c])=>[id,createContractClient({url:f.url,tenant:'t1',...c},definition)]));
 return {definition,clients};
}
test('store published Workflow threshold gates quarantine and low-value procurement',()=>run('published-workflow',async f=>{
 await f.deliver(await f.submit('DetectRecallImpact',{targetId:'recall'},'detect'));
 const {clients}=await publishProgram(f,{workflow:{approvalAtQuantity:10}});
 const req=await f.request('QuarantineInventory',{targetId:'stock',caseId:'recall'},'threshold-quarantine');req.ontologyVersion='1.2.0';
 assert.equal((await clients.operator.validate(req)).state,'PROPOSED');
 const a=await clients.operator.submit(req);f.responses.push({request:req,result:a});assert.equal(a.state,'PENDING_APPROVAL');
 assert.equal((await clients.operator.get({id:'stock'})).fields.isolated,false);
 assert.equal(Number((await f.owner.query('SELECT count(*) FROM outbox WHERE action_id=$1',[a.actionId])).rows[0].count),0);
 await clients.manager.approve(a);await f.deliver(a);
 const second=await f.request('QuarantineInventory',{targetId:'stock2',caseId:'recall'},'second');second.ontologyVersion='1.2.0';await f.deliver(await clients.operator.submit(second));
 // A price below the store approval floor must still honor the public workflow.
 await f.owner.query("UPDATE objects SET fields=jsonb_set(fields,'{unitPrice}','100'),revision=revision+1 WHERE id='replacement'");
 const order=await f.request('CreateReplacementOrder',{targetId:'recall',candidateId:'replacement',quantity:10},'public-order');order.ontologyVersion='1.2.0';
 const pending=await clients.operator.submit(order);f.responses.push({request:order,result:pending});assert.equal(pending.state,'PENDING_APPROVAL');
 await clients.manager.approve(pending);await f.deliver(pending);
}));
test('store published Rule rejects validate and submit without business mutation',()=>run('published-rule',async f=>{
 await f.deliver(await f.submit('DetectRecallImpact',{targetId:'recall'},'detect'));
 const {clients}=await publishProgram(f,{rule:{minimumQuantity:11,allowRelease:false}});
 const req=await f.request('QuarantineInventory',{targetId:'stock',caseId:'recall'},'rule-quarantine');req.ontologyVersion='1.2.0';
 await assert.rejects(clients.operator.validate(req),{code:'RULE_REJECTED'});
 const validationDenial=(await f.owner.query("SELECT record FROM audit WHERE record->>'kind'='Denied' AND record->>'operation'='action' ORDER BY sequence DESC LIMIT 1")).rows[0].record;
 assert.equal(validationDenial.targetId,'stock');assert.equal(validationDenial.actionType,'QuarantineInventory');assert.equal(validationDenial.inputDigest,digest(req));assert.equal(validationDenial.ruleVersion,'1.2.0');
 await assert.rejects(clients.operator.submit(req),{code:'RULE_REJECTED'});
 assert.equal((await clients.operator.get({id:'stock'})).revision,1);
 assert.equal(Number((await f.owner.query("SELECT count(*) FROM outbox WHERE aggregate_id='stock'")).rows[0].count),0);
}));
test('store approval denial Audit disambiguates two pending actions and does not trust an unknown ID',()=>run('approval-denial-context',async f=>{
 await f.quarantine();
 const a=await f.submit('CreateReplacementOrder',{targetId:'recall',candidateId:'replacement',quantity:15},'order-a','delegated');
 const b=await f.submit('CreateReplacementOrder',{targetId:'recall',candidateId:'replacement',quantity:15},'order-b','delegated');
 await injectCandidateChange(f);await assert.rejects(f.clients.manager.approve(a),{code:'RULE_REJECTED'});
 await f.owner.query("UPDATE delegations SET active=false WHERE id='delegation'");await assert.rejects(f.clients.manager.approve(b),{code:'PERMISSION_DENIED'});
 const rows=(await f.owner.query("SELECT record FROM audit WHERE record->>'kind'='Denied' AND record->>'operation'='approve'")).rows.map(r=>r.record);
 for(const [action,code]of [[a,'RULE_REJECTED'],[b,'PERMISSION_DENIED']]){
  const record=rows.find(r=>r.actionId===action.actionId&&r.code===code);assert.ok(record,'denial must name its authorized pending Action');
  const stored=(await f.owner.query('SELECT * FROM actions WHERE id=$1',[action.actionId])).rows[0];
  assert.equal(record.operationId,action.operationId);assert.equal(record.targetId,'recall');assert.equal(record.actionType,'CreateReplacementOrder');
  assert.equal(record.actor,'manager');assert.equal(record.originalActor,'agent');assert.equal(record.originalSubject,'operator');assert.equal(record.originalDelegationId,'delegation');
  assert.deepEqual(record.evidence,stored.request.evidence);assert.equal(record.inputDigest,stored.digest);
  assert.equal(record.ontologyVersion,'1.1.0');assert.equal(record.ruleVersion,'1.1.0');assert.equal(record.workflowVersion,'1.1.0');
  assert.equal((await f.clients.operator.status(action)).state,'PENDING_APPROVAL');
 }
 await assert.rejects(f.clients.manager.approve({actionId:'00000000-0000-0000-0000-000000000000'}),{code:'NOT_FOUND'});
 const last=(await f.owner.query("SELECT record FROM audit WHERE record->>'kind'='Denied' AND record->>'operation'='approve' ORDER BY sequence DESC LIMIT 1")).rows[0].record;
 assert.equal(last.actionId,undefined);assert.equal(last.evidence,undefined);
 await f.owner.query("UPDATE principals SET stores=$1::jsonb WHERE id='manager'",[JSON.stringify(['s3'])]);
 await assert.rejects(f.clients.manager.approve(a),{code:'NOT_FOUND'});
 const foreign=(await f.owner.query("SELECT record FROM audit WHERE record->>'kind'='Denied' AND record->>'operation'='approve' ORDER BY sequence DESC LIMIT 1")).rows[0].record;
 assert.equal(foreign.actionId,undefined);assert.equal(foreign.evidence,undefined);
}));

test('store quarantine dependency race keeps one isolation and rejects stale evidence',()=>run('quarantine-race',async f=>{
 await f.deliver(await f.submit('DetectRecallImpact',{targetId:'recall'},'detect'));
 const a=await f.request('QuarantineInventory',{targetId:'stock',caseId:'recall'},'quarantine-race-a');const b={...a,idempotencyKey:'quarantine-race-b'};
 const results=await Promise.allSettled([f.clients.operator.submit(a),f.clients.operator.submit(b)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const index=results.findIndex(r=>r.status==='fulfilled'),winner=results[index].value,req=[a,b][index];
 assert.equal(winner.state,'PENDING_EXTERNAL');assert.equal(results.find(r=>r.status==='rejected').reason.code,'INVALID_EVIDENCE');
 f.responses.push({request:req,result:winner},{request:[a,b][1-index],result:{code:'INVALID_EVIDENCE'}});
 await f.deliver(winner);assert.equal((await f.clients.operator.submit(req)).actionId,winner.actionId);
 assert.equal((await f.clients.operator.get({id:'stock'})).revision,2);
 assert.equal(Number((await f.erp.owner.query("SELECT count(*) FROM ledger WHERE payload->>'aggregateId'='stock'")).rows[0].count),1);
}));
test('store replacement unknown success blocks notice until reconciliation and never resends',()=>run('procurement-unknown',async f=>{
 await f.quarantine();const a=await f.submit('CreateReplacementOrder',{targetId:'recall',candidateId:'replacement',quantity:15},'unknown-order');await f.clients.manager.approve(a);
 injectExternal(f.erp,'lost-ack');assert.equal((await f.clients.manager.dispatch(a)).state,'UNKNOWN');const sends=f.erp.controller.applyRequests;
 await assert.rejects(f.submit('PublishCustomerNotice',{targetId:'recall',message:'premature'},'early-notice'),{code:'EXTERNAL_PENDING'});
 assert.equal((await f.clients.manager.dispatch(a)).state,'UNKNOWN');assert.equal(f.erp.controller.applyRequests,sends);
 injectExternal(f.erp,'normal');assert.equal((await f.clients.manager.reconcile(a)).state,'DELIVERED');assert.equal(f.erp.controller.applyRequests,sends);
 assert.equal(Number((await f.erp.owner.query('SELECT count(*) FROM ledger WHERE operation_id=$1',[a.operationId])).rows[0].count),1);
 await f.deliver(await f.submit('PublishCustomerNotice',{targetId:'recall',message:'confirmed replacement'},'confirmed-notice'));
 assert.equal((await f.clients.operator.get({id:'recall'})).fields.phase,'CUSTOMER_NOTIFIED');
}));

async function assertWorkerDenial(f,action,operation){
 const rows=(await f.owner.query("SELECT record FROM audit WHERE record->>'kind'='Denied' AND record->>'operation'='worker'")).rows.map(r=>r.record);
 const matches=rows.filter(r=>r.actionId===action.actionId&&r.workerOperation===operation&&r.code==='PERMISSION_DENIED');
 assert.equal(matches.length,1,'persisted denial must identify the authorized Action and worker operation');
 const record=matches[0],stored=(await f.owner.query('SELECT * FROM actions WHERE id=$1',[action.actionId])).rows[0];
 assert.equal(record.operationId,action.operationId);assert.equal(record.actionType,stored.request.actionType);assert.equal(record.targetId,stored.request.input.targetId);
 assert.equal(record.actor,'manager');assert.equal(record.originalActor,'agent');assert.equal(record.originalSubject,'operator');assert.equal(record.originalDelegationId,'delegation');
 assert.equal(record.inputDigest,stored.digest);assert.deepEqual(record.evidence,stored.request.evidence);
 assert.deepEqual(record.originalVersions,{ontology:stored.request.ontologyVersion,policy:stored.request.policyVersion,rule:stored.request.ruleVersion,workflow:stored.request.workflowVersion});
 assert.equal(record.ontologyVersion,'1.1.0');assert.equal(record.ruleVersion,'1.1.0');assert.equal(record.workflowVersion,'1.1.0');assert.equal(record.policyVersion,'1.0.0');
 const telemetry=(await f.owner.query("SELECT record FROM telemetry WHERE record->>'requestId'=$1",[record.requestId])).rows;
 assert.equal(telemetry.length,1);assert.equal(telemetry[0].record.traceId,record.traceId);assert.equal(telemetry[0].record.operation,operation);assert.equal(telemetry[0].record.code,record.code);
 return record;
}

test('store worker denial Audit distinguishes two actions and hides unknown or out-of-scope targets',()=>run('worker-denial-context',async f=>{
 await f.deliver(await f.submit('DetectRecallImpact',{targetId:'recall'},'detect'));
 const actions=[];
 for(const id of f.seed.stocks)actions.push(await f.submit('QuarantineInventory',{targetId:id,caseId:'recall'},'audit:'+id,'delegated'));
 injectExternal(f.erp,'lost-ack');
 for(const action of actions)assert.equal((await f.clients.manager.dispatch(action)).state,'UNKNOWN');
 const sends=f.erp.controller.applyRequests;
 await f.owner.query("UPDATE delegations SET active=false WHERE id='delegation'");
 for(const operation of ['dispatch','reconcile'])for(const action of actions){
  await assert.rejects(f.clients.manager[operation](action),{code:'PERMISSION_DENIED'});
  const record=await assertWorkerDenial(f,action,operation);
  f.responses.push({operation,request:action,result:{code:record.code},requestId:record.requestId,traceId:record.traceId});
  assert.equal((await f.clients.operator.status(action)).state,'PENDING_EXTERNAL');
 }
 const hiddenFields=['actionId','operationId','actionType','targetId','inputDigest','evidence','originalActor','originalSubject','originalDelegationId','originalVersions'];
 async function hidden(action){
  for(const operation of ['dispatch','reconcile']){
   await assert.rejects(f.clients.manager[operation](action),{code:'NOT_FOUND'});
   const record=(await f.owner.query("SELECT record FROM audit WHERE record->>'kind'='Denied' AND record->>'operation'='worker' ORDER BY sequence DESC LIMIT 1")).rows[0].record;
   for(const field of hiddenFields)assert.equal(record[field],undefined,field+' must not leak');
  }
 }
 await hidden({operationId:'00000000-0000-0000-0000-000000000000'});
 await f.owner.query("UPDATE principals SET stores=$1::jsonb WHERE id='manager'",[JSON.stringify(['s3'])]);
 for(const action of actions)await hidden(action);
 await f.owner.query("UPDATE principals SET stores=$1::jsonb WHERE id='manager'",[JSON.stringify(['s1','s2'])]);
 // Also verify the saved Action scope, independently of its Outbox envelope.
 await f.owner.query("UPDATE actions SET tenant='t2' WHERE id=$1",[actions[0].actionId]);await hidden(actions[0]);
 await f.owner.query("UPDATE actions SET tenant='t1' WHERE id=$1",[actions[0].actionId]);
 await f.owner.query("UPDATE delegations SET active=true WHERE id='delegation'");injectExternal(f.erp,'normal');
 for(const action of actions){
  assert.equal((await f.clients.manager.reconcile(action)).state,'DELIVERED');
  assert.equal(Number((await f.erp.owner.query('SELECT count(*) FROM ledger WHERE operation_id=$1',[action.operationId])).rows[0].count),1);
 }
 assert.equal(f.erp.controller.applyRequests,sends);
}));

test('store delegated quarantine expiry after ERP commit blocks procurement until renewed reconciliation',async()=>{
 let expiresAt,paused=false;
 await run('quarantine-authority-expiry',async f=>{
  await f.deliver(await f.submit('DetectRecallImpact',{targetId:'recall'},'detect'));
  await f.deliver(await f.submit('QuarantineInventory',{targetId:'stock2',caseId:'recall'},'second'));
  const a=await f.submit('QuarantineInventory',{targetId:'stock',caseId:'recall'},'delegated-expiry','delegated');
  expiresAt=Date.now()+800;
  await f.owner.query("UPDATE delegations SET expires=$1 WHERE id='delegation'",[new Date(expiresAt)]);
  await assert.rejects(f.clients.manager.dispatch(a),{code:'PERMISSION_DENIED'});
  assert.ok(paused,'expiry must cross the real ERP commit boundary');
  f.responses.push({operation:'dispatch',request:a,result:{code:'PERMISSION_DENIED'}});
  assert.equal((await f.clients.operator.status(a)).state,'PENDING_EXTERNAL');
  const outbox=(await f.owner.query('SELECT * FROM outbox WHERE operation_id=$1',[a.operationId])).rows[0];
  assert.equal(outbox.state,'SENDING');assert.equal(outbox.event.fields.secret,'hidden-word');
  assert.ok(f.journal.records().some(r=>r.operationId===a.operationId&&r.phase==='COMMITTED'));
  assert.ok(f.journal.records().some(r=>r.operationId===a.operationId&&r.phase==='SEND_STARTED'));
  assert.ok(!f.journal.records().some(r=>r.operationId===a.operationId&&r.phase==='ABORTED'));
  const ledger=(await f.erp.owner.query('SELECT * FROM ledger WHERE operation_id=$1',[a.operationId])).rows;
  assert.equal(ledger.length,1);assert.deepEqual(ledger[0].payload.fields,{isolated:true});
  assert.equal(ledger[0].digest,digest(f.kernel.writeback.payload(outbox)));
  const orderInput={targetId:'recall',candidateId:'replacement',quantity:15};
  const blocked=await f.request('CreateReplacementOrder',orderInput,'blocked-order');
  await assert.rejects(f.clients.operator.submit(blocked),{code:'EXTERNAL_PENDING'});
  f.responses.push({request:blocked,result:{code:'EXTERNAL_PENDING'}});
  assert.equal((await f.clients.operator.get({id:'recall'})).fields.phase,'DETECTED');
  assert.equal(Number((await f.owner.query('SELECT count(*) FROM actions')).rows[0].count),3);
  const denials=(await f.owner.query("SELECT record FROM audit WHERE record->>'kind'='Denied'")).rows.map(r=>r.record);
  const denial=await assertWorkerDenial(f,a,'dispatch');
  Object.assign(f.responses.find(r=>r.operation==='dispatch'),{requestId:denial.requestId,traceId:denial.traceId});
  assert.ok(denials.some(r=>r.code==='EXTERNAL_PENDING'&&r.actionType==='CreateReplacementOrder'&&r.ontologyVersion==='1.1.0'&&r.ruleVersion==='1.1.0'&&r.inputDigest===digest(blocked)));
  const sends=f.erp.controller.applyRequests;
  await f.owner.query("UPDATE delegations SET expires=$1 WHERE id='delegation'",[new Date(Date.now()+60000)]);
  assert.equal((await f.clients.manager.dispatch(a)).state,'SENDING');
  const reconciled=await f.clients.manager.reconcile(a);assert.equal(reconciled.state,'DELIVERED');
  f.responses.push({operation:'reconcile',request:a,result:reconciled});
  assert.equal(f.erp.controller.applyRequests,sends);assert.equal((await f.clients.operator.status(a)).state,'SUCCEEDED');
  assert.equal(Number((await f.erp.owner.query('SELECT count(*) FROM ledger WHERE operation_id=$1',[a.operationId])).rows[0].count),1);
  const order=await f.submit('CreateReplacementOrder',orderInput,'confirmed-order');assert.equal(order.state,'PENDING_APPROVAL');
  await f.clients.manager.approve(order);await f.deliver(order);
  await f.deliver(await f.submit('PublishCustomerNotice',{targetId:'recall',message:'confirmed replacement after authority renewal'},'confirmed-notice'));
  assert.equal((await f.clients.operator.get({id:'recall'})).fields.customerCount,7);
  assert.equal(Number((await f.erp.owner.query('SELECT count(*) FROM ledger')).rows[0].count),5);
 },{fault:async point=>{
  if(point==='after-external'&&expiresAt&&!paused){
   paused=true;assert.ok(Date.now()<expiresAt,'delegation must be valid when ERP commits');
   await delay(Math.max(0,expiresAt-Date.now()+30));
  }
 }});
});
