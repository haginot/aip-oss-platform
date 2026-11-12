import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {scenario,uid,evidence,childGateway,cleared,scope,ops,allFields} from '../../fixtures/enterprise/ENT-201-effect-contract-20261027/scenario.mjs';
import {assertContracts,persisted} from '../../fixtures/enterprise/ENT-201-effect-contract-20261027/contracts.mjs';
import {digest} from '../../src/contracts.mjs';

test('effect contract browser exact PO payment RETURN resubmit and real process restart',()=>scenario('return-browser-chain',async f=>{
 const {page,call,body,account,invoice,payment,openInvoice,openPayment,state,capture}=f;
 await call('operator','invoiceImport',body);const p1=await f.request();await call('operator','paymentRequest',p1);
 // The browser writes through a real child gateway, terminated and reconstructed below.
 let gateway=await childGateway(f);f.children.push(gateway);const signIn=who=>f.signIn(who,gateway.origin);
 await signIn('manager');await openPayment(p1.id);const before=await f.observe(p1.id),beforeDom=await capture();
 const exists=await page.evaluate("!!document.querySelector('#return')");
 evidence('return-control-before-attempt',{exists,before,beforeDom,http:await page.evaluate('window.invoiceHttp'),gatewayPid:gateway.pid});await page.screenshot('return-control-before-attempt');
 assert.equal(exists,true,'Current stage approver must have a RETURN control in the real invoice DOM');
 await page.click('#return');await state('RETURNED');await page.click('#reload');await state('RETURNED');
 const returned=await f.observe(p1.id),returnDom=await capture(),returnHttp=await page.evaluate('window.invoiceHttp');
 assert.equal(returned.payment.reservation,'HELD');assert.deepEqual(returned.payment.workflow.votes,[{actor:'manager',subject:'manager',stage:0,decision:'RETURN'}]);assert.equal(returned.requests.length,0);assert.equal(returned.ledger.length,0);
 const vote=returnHttp.find(x=>x.request.operation==='vote');assert.equal(vote.request.body.id,p1.id);assert.equal(vote.request.body.revision,before.payment.revision);assert.equal(vote.request.body.decision,'RETURN');assert.equal(vote.status,200);assert.match(returnDom.sections.approvals,/manager RETURN/);
 await f.deny('manager','dispatch',{id:p1.id},'INVALID_STATE');await f.deny('operator','invoiceCorrect',{...body,revision:returned.invoice.revision},'INVALID_STATE');assert.deepEqual(await f.observe(p1.id),returned);
 const returnAudit=await call('manager','auditExport',{id:p1.id});assert.ok(returnAudit.events.some(x=>x.record.operation==='vote'&&x.record.actor==='manager'));
 await signIn('operator');await openPayment(p1.id);await page.click('#cancel');await state('CANCELLED');const cancelled=await payment(p1.id);assert.equal(cancelled.reservation,'RELEASED');assert.deepEqual(cancelled.workflow.votes,returned.payment.workflow.votes);
 await openInvoice();const current=await invoice();await page.fill('#number',body.number+'-訂正版');await page.click('#correct');await page.until(`JSON.parse(document.querySelector('#summary').textContent).revision===${current.revision+1}`);const corrected=await invoice();assert.equal(corrected.state,'MATCHED');assert.equal(corrected.revision,current.revision+1);assert.deepEqual(corrected.source,returned.invoice.source);assert.equal(corrected.fields.purchaseId,body.purchaseId);for(const k of ['supplierId','amount','currency','quantity','unit'])assert.equal(corrected.fields[k],body[k]);
 const p2=uid('new-payment');await page.fill('#account-id',account.id);await page.fill('#payment-id',p2);await page.fill('#payment-amount','1200');await page.click('#request button');await state('WAITING_APPROVAL');const fresh=await payment(p2);assert.notEqual(p1.id,p2);assert.equal(fresh.fields.invoiceRevision,corrected.revision);assert.equal(fresh.fields.accountRevision,1);assert.equal(fresh.fields.accountDigest,digest(fresh.accountSnapshot));assert.equal(fresh.fields.sourceDigest,digest(corrected.source));assert.deepEqual(fresh.workflow.votes,[]);
 for(const [index,who] of ['manager','reviewer','publisher'].entries()){await signIn(who);await openPayment(p2);await page.click('#approve');await page.until(`document.querySelector('#approvals').children.length===${index+1}`);}await state('READY');
 f.env.payments.fault('lost-ack');await page.click('#dispatch');await state('UNKNOWN');await page.click('#reconcile');await state('SUCCEEDED');const complete=await f.observe(p2);assert.equal(complete.ledger.length,1);assert.equal(complete.ledger[0].applications,1);assert.equal(complete.ledger[0].payload.operationId,complete.payment.operation.id);assert.notEqual(complete.payment.operation.id,cancelled.operation.id);assert.notEqual(complete.payment.operation.id,f.source.order.operationId);assert.equal(complete.ledger[0].payload.operationKind,'invoice-payment');assert.equal(complete.ledger[0].payload.destination,'local-synthetic-payment');assert.equal(complete.orderLedger.length,1);assert.equal(complete.orderLedger[0].id,f.source.order.operationId);assert.equal(complete.orderLedger[0].applications,1);assert.notEqual(complete.orderLedger[0].payload.operationKind,complete.ledger[0].payload.operationKind);assert.notEqual(complete.orderLedger[0].payload.destination,complete.ledger[0].payload.destination);assert.deepEqual(complete.orderRequests.map(x=>x.path),['/effects']);assert.deepEqual(complete.requests.map(x=>x.path),['/payments','/payments/'+complete.payment.operation.id]);assert.equal(complete.ledger.some(x=>x.payload.operationId===cancelled.operation.id),false);assert.deepEqual(complete.requests.map(x=>x.method),['POST','GET']);
 const s=corrected.source;assert.equal(s.receipt.actor,'agent');assert.equal(s.receipt.receivedQuantity,7);assert.equal(s.receipt.unit,'台');assert.equal(s.receipt.operationId,s.order.operationId);assert.equal(s.receipt.payloadDigest,s.order.payloadDigest);assert.equal(s.receipt.packageDigest,s.package.digest);assert.equal(s.receipt.packageVersion,s.package.version);assert.equal(s.receipt.orderedRevision,s.order.objectRevision);
 const cancelAudit=await call('manager','auditExport',{id:p1.id}),cancelCommand=cancelAudit.events.find(x=>x.record.operation==='paymentCancel');assert.ok(cancelCommand);assert.ok(f.env.f.kernel.journal.records().some(x=>x.operationKind==='invoice-version'&&x.id===p1.id&&x.actionId===cancelCommand.record.actionId));
 const oldPid=gateway.pid;await gateway.close();gateway=await childGateway(f);f.children.push(gateway);assert.notEqual(gateway.pid,oldPid);
 await signIn('operator');await openInvoice();assert.equal(await page.evaluate("JSON.parse(document.querySelector('#summary').textContent).revision"),corrected.revision);await openPayment(p1.id);await state('CANCELLED');assert.match((await capture()).sections.approvals,/manager RETURN/);await openPayment(p2);await state('SUCCEEDED');await page.click('#reload');await state('SUCCEEDED');assert.equal(await page.evaluate("document.querySelector('#approvals').children.length"),3);
 assert.deepEqual(await f.observe(p2),complete);assert.deepEqual(await payment(p1.id),cancelled);await page.screenshot('return-resubmit-after-process-restart');
 evidence('return-browser-complete',{before,returned,returnDom,returnHttp,returnAudit,cancelled,cancelAudit,corrected,fresh,complete,afterRestart:{oldPid,newPid:gateway.pid,dom:await capture(),p1:await payment(p1.id),p2:await payment(p2)},browserHttp:await page.evaluate("JSON.parse(sessionStorage.getItem('return-http')??'[]')")});
 await assertContracts(f,complete);
},{browser:true}));


test('effect contract browser refuses missing or forged PO source without a payment or rewritten historical effect',()=>scenario('effect-browser-source-rejection',async f=>{
 const original=await persisted(f,f.po.id),ledger=await f.env.effects.ledger(),requests=f.env.effects.requests(),attempts=[];
 await f.signIn('operator');
 for(const [name,mutate] of [['missing',e=>{delete e.operationKind;delete e.destination;}],['forged-payment',e=>{e.operationKind='invoice-payment';e.destination='local-synthetic-payment';}],['wrong-origin',e=>{e.operationId=randomUUID();}],['wrong-package',e=>{e.packageDigest='different-package-digest';}],['wrong-revision',e=>{e.objectRevision++;}]]){
  const event=structuredClone(original.outbox.event);mutate(event);await f.env.f.owner.query('UPDATE outbox SET event=$2,digest=$3 WHERE operation_id=$1',[original.outbox.operation_id,JSON.stringify(event),digest(event)]);
  await f.fillInvoice();const count=await f.page.evaluate("window.invoiceHttp.filter(x=>x.request.operation==='invoiceImport').length");await f.page.click('#import button[type=submit]');
  await f.page.until(`window.invoiceHttp.filter(x=>x.request.operation==='invoiceImport').length===${count+1}`);await f.page.until("document.querySelector('#message').textContent==='INCONSISTENT_STATE'");
  const response=await f.page.evaluate("window.invoiceHttp.filter(x=>x.request.operation==='invoiceImport').at(-1)");assert.equal(response.status,400);assert.deepEqual(response.data,{error:{code:'INCONSISTENT_STATE'}});assert.equal((await f.capture()).hidden,true);
  const retained=await persisted(f,f.po.id);assert.deepEqual(retained.outbox.event,event);assert.equal(retained.outbox.digest,digest(event));assert.deepEqual(await f.env.effects.ledger(),ledger);assert.deepEqual(f.env.effects.requests(),requests);assert.deepEqual(await f.env.payments.ledger(),[]);assert.deepEqual(f.env.payments.requests(),[]);
  attempts.push({name,event,response,retained,dom:await f.capture()});
 }
 await f.page.screenshot('effect-source-rejected');evidence('source-rejections',{original,attempts,ledger,requests,paymentLedger:await f.env.payments.ledger(),paymentRequests:f.env.payments.requests()});
},{browser:true}));
