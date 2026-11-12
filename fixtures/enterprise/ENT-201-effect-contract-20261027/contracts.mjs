import assert from 'node:assert/strict';
import {digest} from '../../../src/contracts.mjs';
import {evidence} from './scenario.mjs';
export async function persisted(f,id){
 const q=(sql,args)=>f.env.f.owner.query(sql,args).then(r=>r.rows);
 const [instance]=await q('SELECT * FROM enterprise_instances WHERE id=$1',[id]);
 const [action]=await q('SELECT * FROM actions WHERE id=$1',[instance.action_id]);
 const [outbox]=await q('SELECT * FROM outbox WHERE operation_id=$1',[action.operation_id]);
 const [object]=await q('SELECT * FROM objects WHERE id=$1',[id]);
 const [pack]=await q('SELECT * FROM enterprise_packages WHERE tenant=$1 AND id=$2 AND version=$3',[object.tenant,instance.package_id,instance.package_version]);
 return {instance,action,outbox,object,pack};
}
export async function assertContracts(f,complete){
 const po=await persisted(f,f.po.id),payment=await persisted(f,complete.payment.id),source=await f.call('operator','purchaseRead',{id:f.po.id});
 const audit=await f.call('manager','auditExport',{id:f.po.id});
 evidence('exact-effect-contract',{po,payment,source,complete,audit});
 const e=po.outbox.event,pe=payment.outbox.event;
 assert.deepEqual({operationKind:e.operationKind,destination:e.destination},{operationKind:'procurement-order',destination:'local-synthetic-procurement'});
 assert.deepEqual({operationKind:pe.operationKind,destination:pe.destination},{operationKind:'invoice-payment',destination:'local-synthetic-payment'});
 assert.equal(complete.orderLedger.length,1);assert.equal(complete.ledger.length,1);
 assert.deepEqual(complete.orderLedger[0].payload,e);assert.deepEqual(complete.ledger[0].payload,pe);
 assert.equal(complete.orderLedger[0].applications,1);assert.equal(complete.ledger[0].applications,1);
 assert.notEqual(e.operationId,pe.operationId);assert.notEqual(e.actionId,pe.actionId);
 for(const x of [po,payment]){assert.equal(x.outbox.digest,digest(x.outbox.event));assert.equal(x.outbox.state,'SUCCEEDED');assert.equal(x.outbox.event.operationId,x.action.operation_id);assert.equal(x.outbox.event.actionId,x.instance.action_id);assert.equal(x.outbox.event.aggregateId,x.object.id);assert.equal(x.outbox.event.schemaVersion,x.pack.version);}
 assert.equal(e.packageId,po.pack.id);assert.equal(e.packageVersion,po.pack.version);assert.equal(e.packageDigest,po.pack.digest);assert.equal(po.pack.digest,digest(po.pack.manifest));
 assert.equal(po.action.request.operation,'purchaseCreate');assert.equal(po.action.request.body.id,f.po.id);assert.equal(e.fields.quantity,7);assert.equal(e.fields.unit,'台');
 assert.equal(source.order.operationId,e.operationId);assert.equal(source.order.actionId,e.actionId);assert.equal(source.order.payloadDigest,po.outbox.digest);assert.equal(source.order.objectRevision,e.objectRevision);
 assert.equal(source.receipt.operationId,e.operationId);assert.equal(source.receipt.actionId,e.actionId);assert.equal(source.receipt.orderedRevision,e.objectRevision);assert.equal(source.receipt.payloadDigest,po.outbox.digest);assert.equal(source.receipt.packageVersion,e.packageVersion);assert.equal(source.receipt.packageDigest,e.packageDigest);assert.equal(source.receipt.actor,'agent');assert.equal(source.receipt.receivedQuantity,7);assert.equal(source.receipt.unit,'台');
 assert.deepEqual(source.quantityContract,{status:'KNOWN',requested:{quantity:7,unit:'台'},ordered:{quantity:7,unit:'台'},received:{quantity:7,unit:'台'},matchEligible:true});
 assert.deepEqual(complete.orderRequests,[{method:'POST',path:'/effects'}]);
 assert.deepEqual(complete.requests.map(x=>[x.method,x.path]),[['POST','/payments'],['GET','/payments/'+pe.operationId]]);
}

// Public business setup; SQL below is restricted to isolated corruption injection.
export async function purchaseScenario(name,run,{approved=true}={}){
 const {invoiceEnvironment}=await import('../../../scripts/enterprise/invoice-local.mjs');
 const {seedQuantity,compareQuantity,approvePurchase}=await import('../../../tests/enterprise/quantity-helper.mjs');
 const {login}=await import('../../../tests/enterprise/http-helper.mjs');
 const {randomUUID}=await import('node:crypto');
 const {evidence:record}=await import('../../../tests/enterprise/assurance-helper.mjs');
 const env=await invoiceEnvironment(),http=[];let result;
 try{
  const clients={};for(const who of ['operator','manager','reviewer','publisher','agent'])clients[who]=await login(env,who);
  const probe=async(who,operation,body)=>{const response=await clients[who].api(operation,body,randomUUID()),data=await response.json(),row={who,operation,body,status:response.status,data};http.push(row);return row;};
  const call=async(...a)=>{const row=await probe(...a);assert.equal(row.status,200,JSON.stringify(row));return row.data.result;};
  const deny=async(who,op,body,code='INCONSISTENT_STATE')=>{const row=await probe(who,op,body);assert.equal(row.status,code==='PERMISSION_DENIED'?403:400,JSON.stringify(row));assert.deepEqual(row.data,{error:{code}});return row;};
  const seed=await seedQuantity(env.f,call),po=await compareQuantity({call},seed);if(approved)await approvePurchase({call},po);
  const f={env,call,probe,deny,seed,po,record:(suffix,data)=>record(name+'--'+suffix,data)};
  result=await run(f);
 }finally{record(name+'--result',{result,http,ledger:await env.effects.ledger(),requests:env.effects.requests(),paymentRequests:env.payments.requests(),runtime:process.version,postgres:env.cluster.version});await env.close();}
}
