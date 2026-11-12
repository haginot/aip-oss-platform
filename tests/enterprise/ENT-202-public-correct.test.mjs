import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {digest} from '../../src/contracts.mjs';
import {compareQuantity,approvePurchase,receiptBody} from './quantity-helper.mjs';
import {accepted as imported} from '../../fixtures/enterprise/ENT-202-public-import-20261028/support.mjs';
import {accepted as submitted} from '../../fixtures/enterprise/ENT-202-public-submit-20261028/support.mjs';
import {vote,approve} from '../../fixtures/enterprise/ENT-202-public-approve-20261028/support.mjs';
import {cancelled,cancel,worker} from '../../fixtures/enterprise/ENT-202-public-cancel-20261028/support.mjs';
import {scenario,evidence,business,audit,grant,ops,allFields,scope,childGateway,login,rpc,envelope,corrected,accepted,error} from '../../fixtures/enterprise/ENT-202-public-correct-c1a/api-support.mjs';

async function secondPurchase(f){
 const resource={id:randomUUID(),scope:f.seed.scope,currency:'JPY',unit:'minor',capacity:2000,threshold:2000,periodEnd:'2099-01-01T00:00:00Z',calculationVersion:'integer-v1'};
 await f.call('manager','resourceCreate',resource);
 const po=await approvePurchase(f,await compareQuantity(f,{...f.seed,budgetId:resource.id}));
 await f.call('manager','dispatch',{id:po.id});return po;
}

test('C1A-A01 public correct recomputes missing independent receipt and preserves original body key and invoice binding',()=>scenario('c1a-a01-receipt',async f=>{
 const po=await secondPurchase(f),body={...f.body,purchaseId:po.id},initial=await imported(f,body);
 assert.deepEqual(initial.data.result,{id:body.id,revision:1,state:'QUARANTINED',reasons:['RECEIPT_NOT_ELIGIBLE']});
 const ordered=await f.call('operator','purchaseRead',{id:po.id});
 await f.deny('operator','purchaseReceive',receiptBody(po,ordered),'PERMISSION_DENIED');
 await f.call('agent','purchaseReceive',receiptBody(po,ordered));
 const before=await business(f),requestBody={...body,revision:1},key=randomUUID(),row=await accepted(f,requestBody,key),invoice=await f.invoice(),after=await business(f);
 assert.deepEqual(row.data,{contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',result:{id:body.id,revision:2,state:'MATCHED',reasons:[]}});
 assert.deepEqual(invoice.fields,body);assert.equal(invoice.author.actor,'operator');assert.equal(invoice.author.subject,'operator');assert.equal(invoice.source.receipt.actor,'agent');assert.equal(invoice.source.quantityContract.matchEligible,true);
 const action=after.tables.actions.find(x=>x.request?.key===key);assert.deepEqual(action.request,{operation:'invoiceCorrect',body:requestBody,key});assert.equal(action.digest,digest(action.request));assert.equal(after.tables.actions.length,before.tables.actions.length+1);
 assert.deepEqual(after.paymentLedger,before.paymentLedger);assert.deepEqual(after.paymentRequests,before.paymentRequests);assert.deepEqual(after.orderRequests,before.orderRequests);assert.deepEqual(after.tables.outbox,before.tables.outbox);
 evidence('receipt-correction',{initial,row,invoice,before,after,audit:await audit(f)});
}));

test('C1A-A02 exact public correct contract non UUID identifiers and HTTP gates reject malformed writes without effects',()=>scenario('c1a-a02-contract',async f=>{
 await imported(f);const body={...f.body,number:'  Ｃ１Ａ 原文 '+f.body.number+'  ',revision:1},key='c1a:key.correct_1';
 const row=await accepted(f,body,key),saved=await f.invoice();assert.equal(saved.fields.number,body.number);assert.equal(saved.revision,2);
 const action=(await business(f)).tables.actions.find(x=>x.request?.key===key);assert.deepEqual(action.request,{operation:'invoiceCorrect',body,key});
 const good=envelope({...body,revision:2}),invalid=[null,[],{},...['actor','subject','delegationId','extra'].map(k=>({...good,[k]:'spoof'})),{...good,body:null},{...good,body:[]},{...good,body:{...good.body,extra:1}}];
 for(const k of Object.keys(good).filter(k=>k!=='key')){const x=structuredClone(good);delete x[k];invalid.push(x);}for(const k of Object.keys(good.body)){const x=structuredClone(good);delete x.body[k];invalid.push(x);}
 for(const field of ['id','purchaseId','supplierId'])for(const v of ['',null,0,'../private','x'.repeat(129)])invalid.push({...good,body:{...good.body,[field]:v}});
 for(const field of ['amount','quantity','revision'])for(const v of [0,-1,1.5,'7',null,Number.MAX_SAFE_INTEGER+1])invalid.push({...good,body:{...good.body,[field]:v}});
 for(const field of ['number','unit'])for(const v of ['',null,0,'  ','x'.repeat(201)])invalid.push({...good,body:{...good.body,[field]:v}});
 for(const v of ['',null,0,'../key','x'.repeat(129)])invalid.push({...good,key:v});for(const v of ['jpy','GBP',null,1])invalid.push({...good,body:{...good.body,currency:v}});
 const before=await business(f),keyless=structuredClone(good);delete keyless.key;error(await corrected(f,good.body,good.key,'operator',{request:keyless}),'UNSUPPORTED_CAPABILITY');
 for(const request of invalid)error(await corrected(f,good.body,good.key,'operator',{request,raw:JSON.stringify(request)}),'INVALID_ARGUMENT');
 error(await corrected(f,good.body,good.key,'operator',{request:{...good,contractVersion:'1.0.0'}}),'UNSUPPORTED_VERSION');for(const d of [{packageId:'enterprise-invoice'},{type:'InvoiceRecord'}])error(await corrected(f,good.body,good.key,'operator',{request:{...good,...d}}),'NOT_FOUND');
 for(const operation of ['create','invoiceCorrect','edit','dispatch','reconcile']){error(await rpc(f,operation,good.body,'operator'),'UNSUPPORTED_CAPABILITY');error(await corrected(f,good.body,good.key,'operator',{request:{...good,operation}}),'INVALID_ARGUMENT');}
 for(const headers of [{cookie:''},{origin:'https://invalid.example'},{'x-csrf-token':'bad'},{'content-type':'text/plain'}])error(await corrected(f,good.body,good.key,'operator',{headers}),'PERMISSION_DENIED');
 for(const raw of ['{',' '.repeat(131073),JSON.stringify({...good,body:{...good.body,number:'x'.repeat(131073)}})])error(await corrected(f,good.body,good.key,'operator',{raw}),'INVALID_ARGUMENT');
 assert.deepEqual(await business(f),before);evidence('contract',{row,saved,before,after:await business(f),audit:await audit(f)});
}));

test('C1A-A03 current author tenant source scope classification action read and actual delegation deny correction without mutation',()=>scenario('c1a-a03-authority',async f=>{
 await imported(f);const body={...f.body,revision:1};
 for(const [who,code] of [['manager','PERMISSION_DENIED'],['tenant2','NOT_FOUND'],['other','NOT_FOUND']]){const before=await business(f);error(await corrected(f,body,randomUUID(),who),code);assert.deepEqual(await business(f),before);}
 for(const [kind,change,code] of [['scope',{scopes:[]},'NOT_FOUND'],['case',{scopes:[{...scope,caseId:'different-case'}]},'NOT_FOUND'],['classification',{fields:['PUBLIC','INTERNAL']},'PERMISSION_DENIED'],['action',{operations:ops.filter(x=>x!=='action')},'PERMISSION_DENIED'],['read',{operations:ops.filter(x=>x!=='read')},'PERMISSION_DENIED']]){
  await grant(f,'operator',change);const before=await business(f);error(await corrected(f,body),code);assert.deepEqual(await business(f),before);evidence('denial-'+kind,{before,after:await business(f)});await grant(f,'operator');
 }
 const delegationId=randomUUID();await f.call('manager','delegate',{id:delegationId,actor:'operator',scopes:[f.seed.scope],operations:['read','action'],expires:new Date(Date.now()+60000).toISOString()});
 const {invoicePublicCorrect}=await import('../../src/enterprise/invoice-public-correct.mjs'),credential={token:f.clients.operator.cookie.slice('enterprise_session='.length),delegationId},before=await business(f);
 await assert.rejects(()=>invoicePublicCorrect(f.env.f.kernel,credential,envelope(body)),{code:'PERMISSION_DENIED'});assert.deepEqual(await business(f),before);
 evidence('actual-delegation',{delegationId,scope:f.seed.scope,actor:'operator',subject:'manager',before,after:await business(f),audit:await audit(f),boundary:'Gateway derives token only; actual delegation rejection is adapter-to-kernel proof. Wire spoof rejection is A02.'});
},{enterpriseScopes:[scope,{...scope,caseId:'different-case'}]}));

test('C1A-A04 correction rejects stale revision changed purchase and normalized supplier number collision',()=>scenario('c1a-a04-conflicts',async f=>{
 await imported(f);const other={...f.body,id:'invoice-'+randomUUID(),number:'ＤＵＰＬＩＣＡＴＥ-'+randomUUID()};await imported(f,other);const otherPO=await secondPurchase(f),before=await business(f);
 error(await corrected(f,{...f.body,revision:2}),'CONFLICT');error(await corrected(f,{...f.body,purchaseId:otherPO.id,revision:1}),'INVALID_ARGUMENT');
 error(await corrected(f,{...f.body,number:'  '+other.number.normalize('NFKC').toLowerCase()+'  ',revision:1}),'CONFLICT');assert.deepEqual(await business(f),before);
 evidence('conflicts',{other,otherPO,before,after:await business(f),audit:await audit(f)});
}));

test('C1A-A05 HELD waiting and returned invoices refuse correction until public unsent cancellation releases reservation',()=>scenario('c1a-a05-held',async f=>{
 await imported(f);const p=await f.request();await submitted(f,p);const body={...f.body,number:f.body.number+'-訂正',revision:1};
 for(const state of ['WAITING_APPROVAL','RETURNED']){if(state==='RETURNED')await vote(f,p.id,'manager','return');const before=await business(f),payment=await f.payment(p.id);assert.equal(payment.reservation,'HELD');if(state==='RETURNED')assert.equal(payment.state,'RETURNED');error(await corrected(f,body),'INVALID_STATE');assert.deepEqual(await business(f),before);}
 const old=await f.payment(p.id);await cancelled(f,p.id);assert.equal((await f.payment(p.id)).reservation,'RELEASED');await accepted(f,body);const next=await f.request();await submitted(f,next);const fresh=await f.payment(next.id);
 assert.notEqual(next.id,p.id);assert.equal(fresh.fields.invoiceRevision,2);assert.deepEqual(fresh.workflow.votes,[]);assert.deepEqual((await f.payment(p.id)).workflow.votes,old.workflow.votes);assert.equal(f.env.payments.requests().length,0);
 evidence('held-release',{old,fresh,invoice:await f.invoice(),audit:await audit(f)});
}));

test('C1A-A06 corrected invoice fresh P2 binds current account source and independent public approvals then dispatches exactly once',()=>scenario('c1a-a06-resubmit',async f=>{
 await imported(f);const p=await f.request();await submitted(f,p);await vote(f,p.id,'manager','return');await cancelled(f,p.id);const old=await f.payment(p.id);
 await accepted(f,{...f.body,number:f.body.number+'-新請求',revision:1});await f.call('publisher','paymentAccountSet',{...f.account,revision:1,syntheticReference:'synthetic:c1a-current-account'});
 const next=await f.request();await submitted(f,next);const fresh=await f.payment(next.id),invoice=await f.invoice();assert.notEqual(next.id,p.id);assert.equal(fresh.fields.invoiceRevision,invoice.revision);assert.equal(fresh.fields.accountRevision,2);assert.equal(fresh.fields.accountDigest,digest(fresh.accountSnapshot));assert.equal(fresh.fields.sourceDigest,digest(invoice.source));assert.deepEqual(fresh.workflow.votes,[]);
 await approve(f,next.id);assert.equal(f.env.payments.requests().length,0);assert.equal((await f.call('manager','dispatch',{id:next.id})).state,'SUCCEEDED');const once=await business(f);assert.deepEqual(await f.call('manager','dispatch',{id:next.id}),{id:next.id,state:'SUCCEEDED'});assert.deepEqual(await business(f),once);
 const current=await f.payment(next.id),ledger=await f.env.payments.ledger();assert.equal(ledger.length,1);assert.equal(ledger[0].applications,1);assert.equal(ledger[0].payload.operationId,current.operation.id);assert.equal(digest(ledger[0].payload),current.operation.payloadDigest);assert.notEqual(current.operation.id,old.operation.id);assert.deepEqual(current.workflow.votes.map(x=>x.actor),['manager','reviewer','publisher']);assert.deepEqual((await f.payment(p.id)).workflow.votes,old.workflow.votes);
 assert.deepEqual(f.env.payments.requests().filter(x=>x.method==='POST').map(x=>x.body.operationId),[current.operation.id]);evidence('fresh-payment',{old,fresh,current,invoice,ledger,requests:f.env.payments.requests(),boundary:'Correction, submission and approval are public v2. Dispatch is existing legacy kernel boundary against local synthetic payment service.'});
}));

test('C1A-A07 parallel same key correction durable replay changed body mismatch and old replay cannot overwrite later revision',()=>scenario('c1a-a07-replay',async f=>{
 await imported(f);const body={...f.body,number:f.body.number+'-初訂正',revision:1},key=randomUUID(),before=await business(f),rows=await Promise.all([corrected(f,body,key),corrected(f,body,key)]);assert.ok(rows.every(x=>x.status===200),JSON.stringify(rows));assert.deepEqual(rows[0].data,rows[1].data);assert.equal(rows[0].data.result.revision,2);const once=await business(f);assert.equal(once.tables.actions.length,before.tables.actions.length+1);
 error(await corrected(f,{...body,number:body.number+'-変更'},key),'IDEMPOTENCY_MISMATCH');assert.deepEqual(await business(f),once);
 const later={...body,number:body.number+'-次訂正',revision:2};await accepted(f,later);const latest=await f.invoice(),after=await business(f),replayed=await accepted(f,body,key);assert.deepEqual(replayed.data,rows[0].data);assert.equal(replayed.data.result.revision,2);assert.equal(latest.revision,3);assert.deepEqual(await f.invoice(),latest);assert.deepEqual(await business(f),after);
 evidence('replay',{key,body,rows,later,latest,replayed,before,once,after});
}));

test('C1A-A08 rollback lost commit response real gateway restart and current revoked rights preserve durable correction replay',()=>scenario('c1a-a08-recovery',async f=>{
 await imported(f);let replayBody,replayKey,replayResult;
 for(const fault of ['enterprise-before-audit','enterprise-after-commit']){
  const body={...f.body,number:f.body.number+'-'+fault,revision:(await f.invoice()).revision},key=randomUUID(),before=await business(f);
  f.env.f.kernel.fault=async point=>{if(point===fault)throw Error('controlled public correction fault');};try{error(await corrected(f,body,key),'UNAVAILABLE');}finally{f.env.f.kernel.fault=async()=>{};}
  const interrupted=await business(f);if(fault==='enterprise-before-audit'){assert.deepEqual(interrupted,before);assert.ok(f.env.f.journal.records().some(x=>x.idempotencyKey==='v2:'+key&&x.phase==='ABORTED'));}else{assert.equal(interrupted.tables.actions.length,before.tables.actions.length+1);assert.ok(f.env.f.journal.fenced());await f.call('manager','recover',{});}
  const result=await accepted(f,body,key),once=await business(f);assert.equal(result.data.result.revision,body.revision+1);assert.deepEqual((await accepted(f,body,key)).data,result.data);assert.deepEqual(await business(f),once);assert.equal(once.tables.actions.filter(x=>x.request?.key===key).length,1);
  evidence('fault-'+fault,{fault,body,key,before,interrupted,once,result,journal:f.env.f.journal.records(),boundary:'Fault at kernel audit/commit; actual HTTP response is UNAVAILABLE. Recovery is existing legacy manager command.'});replayBody=body;replayKey=key;replayResult=result;
 }
 const before=await business(f),processes=[];
 for(let i=0;i<2;i++){const gateway=await childGateway(f);f.children.push(gateway);const client=await login({...f.env,gateway},'operator'),result=await accepted(f,replayBody,replayKey,'operator',{origin:gateway.origin,client});assert.deepEqual(result.data,replayResult.data);processes.push(gateway.pid);await gateway.close();}
 assert.notEqual(processes[0],processes[1]);assert.deepEqual(await business(f),before);
 for(const [kind,change,code] of [['scope',{scopes:[]},'NOT_FOUND'],['classification',{fields:['PUBLIC','INTERNAL']},'PERMISSION_DENIED'],['action',{operations:ops.filter(x=>x!=='action')},'PERMISSION_DENIED'],['read',{operations:ops.filter(x=>x!=='read')},'PERMISSION_DENIED']]){
  await grant(f,'operator',change);const snapshot=await business(f);error(await corrected(f,replayBody,replayKey),code);assert.deepEqual(await business(f),snapshot);evidence('replay-denial-'+kind,{snapshot,after:await business(f)});await grant(f,'operator');
 }
 await f.call('operator','logout',{});const loggedOut=await business(f);error(await corrected(f,replayBody,replayKey),'PERMISSION_DENIED');assert.deepEqual(await business(f),loggedOut);evidence('restarted-replay',{processes,replayBody,replayKey,replayResult,before,after:loggedOut});
}));

test('C1A-A09 UNKNOWN held correction cannot resend immutable operation and legacy reconcile observes ABSENT or SUCCEEDED',()=>scenario('c1a-a09-unknown',async f=>{
 await imported(f);await accepted(f,{...f.body,number:f.body.number+'-送信前訂正',revision:1});
 const cases=[];for(const crash of ['enterprise-before-send','enterprise-after-send']){const p=await f.request({amount:600});await submitted(f,p);await approve(f,p.id);cases.push({p,crash,ready:await f.payment(p.id)});}
 for(const {p,crash,ready} of cases){
  const exit=await worker(f,p.id,crash);assert.equal(exit.code,73,exit.stderr);const unknown=await f.payment(p.id),before=await business(f);assert.equal(unknown.state,'UNKNOWN');assert.equal(unknown.reservation,'HELD');
  error(await corrected(f,{...f.body,revision:2}),'INVALID_STATE');error(await cancel(f,{id:p.id}),'INVALID_STATE');await f.deny('manager','dispatch',{id:p.id},'INVALID_STATE');assert.deepEqual(await business(f),before);
  const result=await f.call('manager','reconcile',{id:p.id}),after=await business(f),current=await f.payment(p.id);assert.equal(current.reservation,'HELD');assert.equal(current.operation.id,ready.operation.id);assert.equal(current.operation.payloadDigest,ready.operation.payloadDigest);
  const requests=after.paymentRequests.filter(x=>x.path.endsWith(ready.operation.id)||(x.method==='POST'&&x.body?.operationId===ready.operation.id)),ledger=after.paymentLedger.filter(x=>x.payload.operationId===ready.operation.id);
  if(crash==='enterprise-before-send'){assert.equal(result.observation,'ABSENT');assert.equal(result.requiresHumanReview,true);assert.deepEqual(requests.map(x=>x.method),['GET']);assert.equal(ledger.length,0);}else{assert.equal(result.state,'SUCCEEDED');assert.deepEqual(requests.map(x=>x.method),['POST','GET']);assert.equal(ledger.length,1);assert.equal(ledger[0].applications,1);assert.equal(digest(ledger[0].payload),ready.operation.payloadDigest);}
  error(await corrected(f,{...f.body,revision:2}),'INVALID_STATE');error(await cancel(f,{id:p.id}),'INVALID_STATE');assert.deepEqual(await business(f),after);
  evidence('unknown-'+crash,{p,crash,ready,exit,unknown,before,result,current,after,requests,ledger,boundary:'Public correct and cancel. Worker dispatch and manager reconcile retain legacy boundary; all external effects are local synthetic service.'});
 }
}));
