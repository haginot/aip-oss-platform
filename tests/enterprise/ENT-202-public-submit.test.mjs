import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {digest} from '../../src/contracts.mjs';
import {scenario,evidence,ready,submit,accepted,error,envelope,rpc,ok,business,audit,grant,ops,childGateway,login,observation} from '../../fixtures/enterprise/ENT-202-public-submit-20261028/support.mjs';

test('public submit persists client case ID with real quantity receipt source bindings one Action reservation and no external effects',()=>scenario('submit-positive',async f=>{
 const b=await ready(f),key=randomUUID(),before=await business(f),result=await accepted(f,b,key);
 assert.equal(result.id,b.id);assert.equal(result.state,'WAITING_APPROVAL');const detail=await ok(f,'get',{id:b.id});assert.equal((await ok(f)).items[0].id,b.id);assert.deepEqual(await ok(f,'inspect',{id:b.id}),detail);
 assert.equal(detail.identity.caseId,b.id);assert.equal(detail.identity.paymentId,b.id);assert.equal(detail.invoice.id,b.invoiceId);assert.equal(detail.account.id,b.accountId);assert.equal(detail.invoice.state,'MATCHED');
 assert.equal(detail.invoice.fields.quantity,7);assert.equal(detail.invoice.fields.unit,'台');assert.equal(detail.purchase.quantityContract.ordered.quantity,7);assert.equal(detail.purchase.quantityContract.received.quantity,7);assert.equal(detail.purchase.quantityContract.received.unit,'台');assert.equal(detail.purchase.receipt.actor,'agent');assert.notEqual(detail.purchase.receipt.actor,detail.invoice.author.actor);
 const p=detail.payment;assert.equal(p.fields.invoiceRevision,detail.invoice.revision);assert.equal(p.fields.accountRevision,detail.account.revision);
 const {id,revision,fields,scope,history:accountHistory,...accountData}=detail.account;assert.equal(p.fields.accountDigest,digest(accountData));assert.equal(p.fields.sourceDigest,digest(detail.invoice.source));assert.equal(p.fields.sourceDigest,digest(Object.fromEntries(['id','revision','fields','package','order','receipt','quantityContract'].map(k=>[k,detail.purchase[k]]))));assert.equal(p.reservation,'HELD');assert.deepEqual(p.workflow.votes,[]);
 assert.ok(detail.purchase.order.operationId);assert.ok(detail.purchase.order.payloadDigest);assert.ok(detail.purchase.order.objectRevision);assert.ok(detail.purchase.package.digest);assert.ok(detail.purchase.receipt.payloadDigest);assert.equal(p.fields.operationKind,'invoice-payment');assert.equal(p.fields.destination,'local-synthetic-payment');
 const after=await business(f);assert.equal(after.tables.actions.length-before.tables.actions.length,1);const action=after.tables.actions.find(x=>x.request?.body?.id===b.id);assert.deepEqual(action.request,{operation:'paymentRequest',body:b,key});assert.equal(after.tables.enterprise_instances.filter(x=>x.id===b.id).length,1);assert.equal(after.tables.enterprise_invoice.filter(x=>x.id===b.id&&x.data.reservation==='HELD').length,1);assert.equal(after.tables.outbox.filter(x=>x.aggregate_id===b.id).length,0);assert.deepEqual(after.paymentLedger,before.paymentLedger);assert.deepEqual(after.paymentRequests,before.paymentRequests);assert.deepEqual(after.orderRequests,before.orderRequests);
 const history=await ok(f,'history',{id:b.id});assert.ok(history.audit.events.some(x=>x.record.operation==='paymentRequest'));await observation(f,b);evidence('positive',{b,key,result,detail,before,after,history});
}));

test('public submit strict envelope version namespace body key and unsupported writes reject before business mutation',()=>scenario('submit-validation',async f=>{
 const b=await ready(f),good=envelope(b),before=await business(f);
 const invalid=[null,[],{}, {...good,actor:'publisher'}, {...good,body:null},{...good,body:[]},...['id','invoiceId','revision','accountId','amount'].map(k=>({...good,body:Object.fromEntries(Object.entries(b).filter(([n])=>n!==k))})),{...good,body:{...b,extra:1}},{...good,body:{...b,id:'../secret'}},{...good,body:{...b,amount:0}},{...good,body:{...b,amount:'1200'}},{...good,body:{...b,revision:0}},{...good,body:{...b,revision:1.1}},{...good,key:''},{...good,key:12},Object.fromEntries(Object.entries(good).filter(([k])=>k!=='key'))];
 for(const request of invalid)error(await submit(f,b,good.key,{request,raw:JSON.stringify(request)}),'INVALID_ARGUMENT');
 error(await submit(f,b,good.key,{request:{...good,contractVersion:'1.0.0'}}),'UNSUPPORTED_VERSION');
 for(const change of [{packageId:'packageENT202'},{type:'InvoicePayment'},{packageId:'enterprise-invoice'}])error(await submit(f,b,good.key,{request:{...good,...change}}),'NOT_FOUND');
 for(const operation of ['create','import','invoiceImport','approve','paymentRequest','dispatch','cancel','reconcile']){const request={...good,operation};delete request.key;error(await rpc(f,operation,b,'operator',{request}),'UNSUPPORTED_CAPABILITY');}
 for(const headers of [{cookie:''},{origin:'https://invalid.example'},{'x-csrf-token':'invalid'},{'content-type':'text/plain'}])error(await submit(f,b,good.key,{headers}),'PERMISSION_DENIED');
 for(const raw of ['{',' '.repeat(131073),JSON.stringify({...good,body:{...b,padding:'x'.repeat(131073)}})])error(await submit(f,b,good.key,{raw}),'INVALID_ARGUMENT');
 assert.deepEqual(await business(f),before);evidence('denials',{before,after:await business(f),audit:await audit(f)});
}));

test('public submit same key/body replays exactly and changed body mismatches with one durable Action',()=>scenario('submit-replay',async f=>{
 const b=await ready(f),key=randomUUID(),first=await accepted(f,b,key),before=await business(f);assert.deepEqual(await accepted(f,b,key),first);error(await submit(f,{...b,amount:b.amount-1},key),'IDEMPOTENCY_MISMATCH');assert.deepEqual(await business(f),before);await observation(f,b);
}));

test('public submit concurrent identical key replays one Action and a different key cannot duplicate the case ID',()=>scenario('submit-same-key-concurrent',async f=>{
 const b=await ready(f),key=randomUUID(),before=await business(f),rows=await Promise.all([submit(f,b,key),submit(f,b,key)]);for(const row of rows)assert.equal(row.status,200,JSON.stringify(row));assert.deepEqual(rows[0].data,rows[1].data);const once=await business(f);assert.equal(once.tables.actions.length-before.tables.actions.length,1);assert.equal(once.tables.enterprise_invoice.filter(x=>x.id===b.id).length,1);error(await submit(f,b,randomUUID()),'CONFLICT');assert.deepEqual(await business(f),once);await observation(f,b);evidence('same-key-concurrent',{rows,before,once});
}));

for(const kind of ['scope','classification','action','session','tenant'])test('public submit current '+kind+' authorizes initial write and replay',()=>scenario('submit-auth-'+kind,async f=>{
 const b=await ready(f),key=randomUUID();await accepted(f,b,key);
 if(kind==='session')await f.call('operator','logout',{});else if(kind!=='tenant')await grant(f,'operator',kind==='scope'?{scopes:[]}:kind==='classification'?{fields:['PUBLIC','INTERNAL']}:{operations:ops.filter(x=>x!=='action')});
 const before=await business(f),code=['scope','tenant'].includes(kind)?'NOT_FOUND':'PERMISSION_DENIED',who=kind==='tenant'?'tenant2':'operator';
 error(await submit(f,b,key,{who}),code);error(await submit(f,{...b,id:randomUUID()},randomUUID(),{who}),code);assert.deepEqual(await business(f),before);evidence('current-denied',{before,after:await business(f),audit:await audit(f)});
}));

test('public submit actual relogin and gateway process restart retain the same key identity and reservation',()=>scenario('submit-restart',async f=>{
 const b=await ready(f),key=randomUUID(),first=await childGateway(f);f.children.push(first);let client=await login({...f.env,gateway:first},'operator');const initial=await accepted(f,b,key,{origin:first.origin,client});await first.close();
 const second=await childGateway(f);f.children.push(second);assert.notEqual(first.pid,second.pid);client=await login({...f.env,gateway:second},'operator');const before=await business(f);assert.deepEqual(await accepted(f,b,key,{origin:second.origin,client}),initial);assert.equal((await ok(f,'get',{id:b.id},'operator',{origin:second.origin,client})).identity.caseId,b.id);assert.deepEqual(await business(f),before);evidence('restart',{first:{pid:first.pid,origin:first.origin},second:{pid:second.pid,origin:second.origin},before,after:await business(f),audit:await audit(f)});
}));

test('public submit lost committed response recovers through existing journal and same key without second reservation',()=>scenario('submit-lost-response',async f=>{
 const b=await ready(f),key=randomUUID();f.env.f.kernel.fault=async point=>{if(point==='enterprise-after-commit')throw Error('synthetic lost response');};
 try{error(await submit(f,b,key),'UNAVAILABLE');}finally{f.env.f.kernel.fault=async()=>{};}
 const committed=await business(f);assert.equal(committed.tables.enterprise_invoice.filter(x=>x.id===b.id).length,1);await f.call('manager','recover',{});const recovered=await business(f);assert.equal((await accepted(f,b,key)).id,b.id);assert.deepEqual(await business(f),recovered);await observation(f,b);evidence('loss',{committed,recovered,after:await business(f)});
}));

test('public submit audit failure rolls back business Action and reservation before explicit same key recovery',()=>scenario('submit-audit-rollback',async f=>{
 const b=await ready(f),key=randomUUID(),before=await business(f);f.env.f.kernel.fault=async point=>{if(point==='enterprise-before-audit')throw Error('synthetic audit failure');};try{error(await submit(f,b,key),'UNAVAILABLE');}finally{f.env.f.kernel.fault=async()=>{};}
 assert.deepEqual(await business(f),before);assert.ok(f.env.f.journal.records().some(x=>x.idempotencyKey==='v2:'+key&&x.phase==='ABORTED'));await accepted(f,b,key);await observation(f,b);
}));

test('public submit concurrent and cumulative reservations reject overpayment while independent partials use exactly the remaining capacity',()=>scenario('submit-parallel',async f=>{
 const b=await ready(f),before=await business(f),requests=[{...b,amount:700},{...b,id:randomUUID(),amount:700}],rows=await Promise.all(requests.map(x=>submit(f,x)));
 assert.deepEqual(rows.map(x=>x.status).sort(),[200,400]);error(rows.find(x=>x.status!==200),'CONFLICT');const winner=requests[rows.findIndex(x=>x.status===200)];await accepted(f,{...b,id:randomUUID(),amount:500});error(await submit(f,{...b,id:randomUUID(),amount:1}),'CONFLICT');
 const after=await business(f),payments=after.tables.enterprise_invoice.filter(x=>x.kind==='payment'&&x.data.invoiceId===b.invoiceId);assert.equal(payments.length,2);assert.equal(payments.reduce((n,x)=>n+x.data.fields.amount,0),1200);assert.ok(payments.every(x=>x.data.reservation==='HELD'));assert.deepEqual(after.paymentRequests,before.paymentRequests);assert.deepEqual(after.orderRequests,before.orderRequests);await observation(f,winner);evidence('parallel',{requests,rows,before,after});
}));

test('public submit stale invoice and incompatible account reject, and self approval cannot mutate a submitted request',()=>scenario('submit-business-errors',async f=>{
 const b=await ready(f),before=await business(f);error(await submit(f,{...b,revision:b.revision+1}),'CONFLICT');error(await submit(f,{...b,accountId:f.body.id}),'NOT_FOUND');assert.deepEqual(await business(f),before);await accepted(f,b);const committed=await business(f);await f.deny('operator','vote',{id:b.id,revision:1,decision:'APPROVE'},'PERMISSION_DENIED');assert.deepEqual(await business(f),committed);await observation(f,b);
}));
