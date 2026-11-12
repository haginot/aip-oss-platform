import test from 'node:test';
import assert from 'node:assert/strict';
import {scenario,evidence,scope,ops,allFields,childGateway,login,envelope,ready,rpc,ok,denied,business,audit,grant} from '../../fixtures/enterprise/ENT-202-public-read-20261028/support.mjs';

test('public read query/get/inspect/history bind durable payment to real invoice PO account quantity receipt and audit with zero business effects',()=>scenario('public-positive',async f=>{
 const p=await ready(f);await f.approve(p.id);const before=await business(f),beforeAudit=await audit(f);
 const list=await ok(f);assert.deepEqual(list.items.map(x=>x.id),[p.id]);assert.equal(list.items[0].type,'ENT202Case');assert.match(list.coverage,/without a payment/);
 const get=await ok(f,'get',{id:p.id}),inspect=await ok(f,'inspect',{id:p.id}),history=await ok(f,'history',{id:p.id});assert.deepEqual(get,inspect);
 assert.deepEqual(get.identity,{caseId:p.id,paymentId:p.id,invoiceId:f.body.id,purchaseId:f.po.id,accountId:f.account.id});
 assert.equal(get.invoice.revision,1);assert.equal(get.account.revision,1);assert.equal(get.payment.fields.invoiceRevision,get.invoice.revision);assert.equal(get.payment.fields.accountRevision,get.account.revision);
 assert.equal(get.invoice.fields.quantity,7);assert.equal(get.invoice.fields.unit,'台');assert.equal(get.purchase.quantityContract.status,'KNOWN');assert.equal(get.purchase.quantityContract.matchEligible,true);assert.equal(get.purchase.quantityContract.received.quantity,7);assert.equal(get.purchase.receipt.actor,'agent');assert.notEqual(get.purchase.receipt.actor,get.invoice.author.actor);
 assert.equal(get.payment.fields.operationKind,'invoice-payment');const orderOut=before.tables.outbox.find(x=>x.aggregate_id===f.po.id),paymentOut=before.tables.outbox.find(x=>x.aggregate_id===p.id);assert.equal(orderOut.event.operationKind,'procurement-order');assert.equal(orderOut.event.destination,'local-synthetic-procurement');assert.equal(paymentOut.event.operationKind,'invoice-payment');assert.equal(paymentOut.event.destination,'local-synthetic-payment');assert.equal(orderOut.operation_id,get.purchase.order.operationId);assert.equal(paymentOut.operation_id,get.payment.operation.id);assert.notEqual(get.payment.operation.id,get.purchase.order.operationId);assert.ok(get.purchase.order.payloadDigest);assert.ok(get.purchase.order.objectRevision);assert.ok(get.purchase.package.digest);assert.ok(get.purchase.receipt.payloadDigest);assert.ok(get.payment.operation.payloadDigest);assert.equal(get.definition.id,'enterprise-invoice');assert.equal(get.definition.digest,history.audit.definition.digest);
 assert.ok(history.audit.events.some(x=>x.record.operation==='paymentRequest'));assert.ok(history.invoiceAudit.events.some(x=>x.record.operation==='invoiceImport'));assert.ok(Array.isArray(history.events));
 assert.deepEqual(await business(f),before);const afterAudit=await audit(f);assert.ok(afterAudit.length>beforeAudit.length);assert.ok(afterAudit.slice(beforeAudit.length).some(x=>x.record.kind==='EnterpriseRead'));assert.equal(afterAudit.slice(beforeAudit.length).some(x=>x.record.kind==='EnterpriseCommand'),false);
 evidence('contract-observation',{list,get,inspect,history,before,after:await business(f),beforeAudit,afterAudit});
}));

test('public read strict envelope/body version namespace type writes origin CSRF content type size and unauthenticated requests fail closed',()=>scenario('public-validation',async f=>{
 const p=await ready(f),before=await business(f);
 const invalid=[null,[],{}, {...envelope(),actor:'publisher'}, {...envelope(),key:'write-key'},envelope('query',null),envelope('query',[]),envelope('query',{id:p.id}),envelope('get',{}),envelope('get',{id:p.id,purchaseId:f.po.id}),envelope('get',{id:123}),envelope('get',{id:'../private'}),envelope('inspect',{id:p.id,projection:[]})];
 for(const request of invalid)await denied(f,'query',{},'manager','INVALID_ARGUMENT',{request,raw:JSON.stringify(request)});
 for(const contractVersion of ['1.0.0','2.0.1',2,null])await denied(f,'query',{},'manager','UNSUPPORTED_VERSION',{request:{...envelope(),contractVersion}});
 for(const change of [{packageId:'enterprise-invoice'},{packageId:'ENT-201'},{type:'InvoicePayment'},{type:'ENT201Case'}])await denied(f,'query',{},'manager','NOT_FOUND',{request:{...envelope(),...change}});
 for(const operation of ['create','vote','dispatch','reconcile','paymentRequest','paymentCancel','edit','logout'])await denied(f,operation,{id:p.id},'manager','UNSUPPORTED_CAPABILITY');
 for(const headers of [{cookie:''},{origin:'https://invalid.example'},{'x-csrf-token':'invalid'},{'content-type':'text/plain'}])await denied(f,'query',{},'manager','PERMISSION_DENIED',{headers});
 for(const raw of ['{',' '.repeat(131073),JSON.stringify({...envelope(),body:{padding:'x'.repeat(131073)}})])await denied(f,'query',{},'manager','INVALID_ARGUMENT',{raw});
 assert.deepEqual(await business(f),before);evidence('validation-no-effects',{before,after:await business(f),audit:await audit(f)});
}));

test('public read unknown and cross-type IDs never expose related data or bypass case selection',()=>scenario('public-unknown',async f=>{
 const p=await ready(f),before=await business(f);for(const id of ['missing-case',f.body.id,f.po.id,f.account.id,f.seed.supplierIds[0]])for(const op of ['get','inspect','history']){const r=await rpc(f,op,{id});assert.equal(r.status,404);assert.deepEqual(Object.keys(r.data),['error']);assert.equal(JSON.stringify(r.data).includes(f.body.number),false);}
 for(const [id,status] of [['missing-case',404],[p.id,200]]){const r=await fetch(f.env.gateway.origin+'/enterprise/cases/ENT-202/'+id,{headers:{cookie:f.clients.manager.cookie}});assert.equal(r.status,status);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(r.headers.get('cache-control'),'no-store');evidence('screen-'+id,{status:r.status,body:await r.text(),headers:Object.fromEntries(r.headers)});}
 assert.deepEqual(await business(f),before);
}));

for(const revocation of ['scope','classification','read','search','audit','session'])test('public read current '+revocation+' authorization and restoration',()=>scenario('public-auth-'+revocation,async f=>{
 const p=await ready(f);await ok(f,'inspect',{id:p.id});await ok(f,'history',{id:p.id});
 if(revocation==='session')await f.call('manager','logout',{});else await grant(f,'manager',revocation==='scope'?{scopes:[]}:revocation==='classification'?{fields:['PUBLIC','INTERNAL']}:{operations:ops.filter(x=>x!==revocation)});
 const before=await business(f),expected=revocation==='scope'?'NOT_FOUND':'PERMISSION_DENIED';
 if(['scope','classification'].includes(revocation))assert.deepEqual((await ok(f)).items,[]);else if(['read','search','session'].includes(revocation))await denied(f,'query',{},'manager','PERMISSION_DENIED');else await ok(f);
 for(const op of ['get','inspect','history']){if(revocation==='search'||revocation==='audit'&&op!=='history')await ok(f,op,{id:p.id});else await denied(f,op,{id:p.id},'manager',expected);}
 assert.deepEqual(await business(f),before);evidence('revoked',{revocation,before,after:await business(f),audit:await audit(f)});
 if(revocation!=='session')await grant(f);f.clients.manager=await login(f.env,'manager');assert.equal((await ok(f,'inspect',{id:p.id})).identity.caseId,p.id);await ok(f,'history',{id:p.id});
}));

test('public read actual gateway process restart preserves case identity and current authorization without financial submission',()=>scenario('public-restart',async f=>{
 const p=await ready(f),before=await business(f);const first=await childGateway(f);f.children.push(first);let client=await login({...f.env,gateway:first},'manager');const prior=await ok(f,'inspect',{id:p.id},'manager',{origin:first.origin,client});await first.close();
 const second=await childGateway(f);f.children.push(second);assert.notEqual(first.pid,second.pid);client=await login({...f.env,gateway:second},'manager');const after=await ok(f,'inspect',{id:p.id},'manager',{origin:second.origin,client});assert.deepEqual(after,prior);await ok(f,'history',{id:p.id},'manager',{origin:second.origin,client});
 assert.deepEqual(await business(f),before);evidence('actual-restart',{first:{pid:first.pid,origin:first.origin},second:{pid:second.pid,origin:second.origin},prior,after,before,final:await business(f),audit:await audit(f)});
}));

test('public read other tenant sees no cases and cannot obtain case or audit detail',()=>scenario('public-tenant',async f=>{
 const p=await ready(f),before=await business(f);await denied(f,'query',{},'tenant2','NOT_FOUND');for(const op of ['get','inspect','history'])await denied(f,op,{id:p.id},'tenant2','NOT_FOUND');assert.deepEqual(await business(f),before);
}));

test('public read revocation during composite read suppresses retained partial results',()=>scenario('public-mid-read',async f=>{
 const p=await ready(f),native=f.env.f.kernel.enterprise.bind(f.env.f.kernel);let armed=true;
 f.env.f.kernel.enterprise=async(...args)=>{const result=await native(...args);if(armed&&args[1].operation==='paymentAccountRead'){armed=false;await grant(f,'manager',{scopes:[]});}return result;};
 try{const r=await denied(f,'inspect',{id:p.id},'manager','NOT_FOUND');assert.equal(JSON.stringify(r.data).includes(f.body.number),false);evidence('mid-read-denial',{response:r,audit:await audit(f)});}finally{f.env.f.kernel.enterprise=native;}
}));

test('public read concurrent approval returns CONFLICT without a mixed workflow then recovers on explicit new read',()=>scenario('public-workflow-consistency',async f=>{
 const p=await ready(f),native=f.env.f.kernel.enterprise.bind(f.env.f.kernel);let armed=true;
 f.env.f.kernel.enterprise=async(...args)=>{const result=await native(...args);if(armed&&args[1].operation==='get'&&args[1].body.id===p.id){armed=false;await f.vote('manager',p.id);}return result;};
 try{const conflict=await denied(f,'inspect',{id:p.id},'manager','CONFLICT');assert.equal('result' in conflict.data,false);const stable=await ok(f,'inspect',{id:p.id});assert.deepEqual(stable.workflow.votes,stable.payment.workflow.votes.map(({actor,stage,decision})=>({actor,stage,decision})));assert.equal(stable.workflow.votes.length,1);evidence('concurrent-approval-consistent',{conflict,stable,audit:await audit(f)});}finally{f.env.f.kernel.enterprise=native;}
}));

test('public read distinguishes immutable object revision from current payment business revision after unsent cancellation',()=>scenario('public-revisions',async f=>{
 const p=await ready(f),initial=await ok(f,'get',{id:p.id});await f.call('operator','paymentCancel',{id:p.id});const before=await business(f),cancelled=await ok(f,'get',{id:p.id}),list=await ok(f);assert.equal(cancelled.payment.state,'CANCELLED');assert.equal(cancelled.revision,initial.revision);assert.equal(cancelled.revision,list.items.find(x=>x.id===p.id).revision);assert.equal(cancelled.paymentRevision,2);assert.equal(cancelled.payment.revision,cancelled.paymentRevision);assert.deepEqual(await business(f),before);evidence('revision-contract',{initial,cancelled,list,before,after:await business(f)});
}));

test('public history audit authority revoked after initial projection is rechecked before release and can recover explicitly',()=>scenario('public-audit-release',async f=>{
 const p=await ready(f),native=f.env.f.kernel.enterprise.bind(f.env.f.kernel);let armed=true,afterGrant;
 f.env.f.kernel.enterprise=async(...args)=>{const result=await native(...args);if(armed&&args[1].operation==='invoiceAudit'){armed=false;await grant(f,'manager',{operations:ops.filter(x=>x!=='audit')});afterGrant=await business(f);}return result;};
 try{const r=await denied(f,'history',{id:p.id},'manager','PERMISSION_DENIED');assert.deepEqual(r.data,{error:{code:'PERMISSION_DENIED'}});assert.deepEqual(await business(f),afterGrant);await grant(f);const restored=await ok(f,'history',{id:p.id});assert.ok(restored.audit.events.some(x=>x.record.operation==='paymentRequest'));evidence('audit-final-authorization',{denied:r,restored,afterGrant,audit:await audit(f)});}finally{f.env.f.kernel.enterprise=native;}
}));

// BPR-01: preserve every preceding assertion; exercise policy changes after
// the second payment read and after the final related account read.
import {apiRestriction} from '../../fixtures/enterprise/ENT-202-public-read-20261028/bpr-01-support.mjs';
for(const operation of ['get','inspect'])for(const point of ['paymentRead','paymentAccountRead'])test('BPR-01 '+operation+' payment-only classification after second '+point+' denies before release',()=>scenario('bpr01-'+operation+'-'+point,f=>apiRestriction(f,operation,point)));
