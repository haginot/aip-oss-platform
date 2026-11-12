import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {scenario,evidence,uid,scope,ops,allFields} from '../../fixtures/enterprise/ENT-202-return-resubmit-20261027122740-4651bfda/scenario.mjs';
import {digest} from '../../src/contracts.mjs';

async function pending(f,importer='operator',applicant='operator'){
 await f.call(importer,'invoiceImport',f.body);const b=await f.request();await f.call(applicant,'paymentRequest',b);return b;
}
const returnBody=p=>({id:p.id,revision:p.revision,decision:'RETURN'});

test('RETURN API public chain preserves HELD until atomic cancel corrected invoice and distinct newly approved payment',()=>scenario('return-api-chain',async f=>{
 const b=await pending(f),p=await f.payment(b.id),key=randomUUID(),vb=returnBody(p),returnedResult=await f.call('manager','vote',vb,key),returned=await f.observe(b.id);
 assert.equal(returnedResult.state,'RETURNED');assert.equal(returned.payment.reservation,'HELD');assert.equal(returned.payment.workflow.votes[0].actor,'manager');assert.equal(returned.payment.workflow.votes[0].decision,'RETURN');assert.equal(returned.requests.length,0);
 await f.deny('manager','dispatch',{id:b.id},'INVALID_STATE');await f.deny('operator','invoiceCorrect',{...f.body,revision:returned.invoice.revision},'INVALID_STATE');assert.deepEqual(await f.observe(b.id),returned);
 assert.deepEqual(await f.call('manager','vote',vb,key),returnedResult);assert.deepEqual(await f.observe(b.id),returned);
 const cancelKey=randomUUID(),cb={id:b.id},cancelResult=await f.call('operator','paymentCancel',cb,cancelKey),cancelled=await f.observe(b.id);assert.equal(cancelled.payment.state,'CANCELLED');assert.equal(cancelled.payment.reservation,'RELEASED');assert.deepEqual(cancelled.payment.workflow.votes,returned.payment.workflow.votes);
 assert.deepEqual(await f.call('operator','paymentCancel',cb,cancelKey),cancelResult);await f.deny('operator','paymentCancel',{id:uid('other-body')},'IDEMPOTENCY_MISMATCH',cancelKey);await f.deny('operator','paymentCancel',cb,'INVALID_STATE');assert.deepEqual(await f.call('manager','vote',vb,key),returnedResult);assert.deepEqual(await f.observe(b.id),cancelled);
 const current=await f.invoice(),correctedBody={...f.body,number:f.body.number+'-訂正',revision:current.revision};await f.call('operator','invoiceCorrect',correctedBody);const corrected=await f.invoice();assert.equal(corrected.revision,current.revision+1);assert.equal(corrected.state,'MATCHED');assert.deepEqual(corrected.source,returned.invoice.source);
 await f.deny('manager','vote',vb,'STALE_APPROVAL',key);assert.deepEqual(await f.call('operator','paymentCancel',cb,cancelKey),cancelResult);assert.deepEqual(await f.payment(b.id),cancelled.payment);await f.deny('operator','invoiceCorrect',correctedBody,'CONFLICT');
 const next=await f.request();assert.notEqual(next.id,b.id);await f.call('operator','paymentRequest',next);const fresh=await f.payment(next.id);assert.equal(fresh.fields.invoiceRevision,corrected.revision);assert.equal(fresh.fields.accountRevision,1);assert.equal(fresh.fields.accountDigest,digest(fresh.accountSnapshot));assert.equal(fresh.fields.sourceDigest,digest(corrected.source));assert.deepEqual(fresh.workflow.votes,[]);
 await f.approve(next.id);f.env.payments.fault('lost-ack');assert.equal((await f.call('manager','dispatch',{id:next.id})).state,'UNKNOWN');assert.equal((await f.call('manager','reconcile',{id:next.id})).state,'SUCCEEDED');const complete=await f.observe(next.id);assert.equal(complete.ledger.length,1);assert.equal(complete.ledger[0].applications,1);assert.equal(complete.ledger[0].payload.operationId,complete.payment.operation.id);assert.notEqual(complete.payment.operation.id,p.operation.id);assert.notEqual(complete.payment.operation.id,f.source.order.operationId);assert.equal(complete.ledger[0].payload.operationKind,'invoice-payment');assert.equal(complete.ledger[0].payload.destination,'local-synthetic-payment');assert.deepEqual(complete.requests.map(x=>x.method),['POST','GET']);
 const audit=await f.call('manager','auditExport',{id:b.id}),cancelEvent=audit.events.find(x=>x.record.operation==='paymentCancel');assert.ok(cancelEvent);assert.ok(f.env.f.kernel.journal.records().some(x=>x.operationKind==='invoice-version'&&x.id===b.id&&x.actionId===cancelEvent.record.actionId));assert.equal(audit.events.filter(x=>x.record.operation==='paymentCancel').length,1);
 evidence('return-api-complete',{returnedResult,returned,cancelled,corrected,fresh,complete,audit,replay:{returnKey:key,cancelKey}});
}));

for(const roles of [['operator','operator','operator'],['manager','operator','manager'],['operator','manager','manager'],['operator','operator','agent']])test('RETURN API denies overlapping importer applicant receiver '+roles.join('/'),()=>scenario('return-identity-'+roles.join('-'),async f=>{
 const b=await pending(f,roles[0],roles[1]),before=await f.observe(b.id);await f.deny(roles[2],'vote',returnBody(before.payment),'PERMISSION_DENIED');assert.deepEqual(await f.observe(b.id),before);const audit=await f.call('publisher','auditExport',{id:b.id});evidence('identity-denial',{roles,before,after:await f.observe(b.id),audit});
}));

for(const boundary of ['tenant','department','case','classification','approver','stale'])test('RETURN API current '+boundary+' denial leaves state reservation effects unchanged',()=>scenario('return-auth-'+boundary,async f=>{
 const b=await pending(f),before=await f.observe(b.id),vb=returnBody(before.payment);let who='manager',code='PERMISSION_DENIED';
 if(boundary==='tenant'){who='tenant2';code='NOT_FOUND';}
 if(boundary==='department'){who='other';code='NOT_FOUND';}
 if(boundary==='case'){await f.call('publisher','grant',{principal:'manager',scopes:[{...scope,caseId:'different-case'}],operations:ops,fields:allFields});code='NOT_FOUND';}
 if(boundary==='classification')await f.call('publisher','grant',{principal:'manager',scopes:[scope],operations:ops,fields:['PUBLIC','INTERNAL']});
 if(boundary==='approver')await f.call('publisher','grant',{principal:'manager',scopes:[scope],operations:ops.filter(x=>x!=='approve'),fields:allFields});
 if(boundary==='stale'){vb.revision++;code='CONFLICT';}
 await f.deny(who,'vote',vb,code);assert.deepEqual(await f.observe(b.id),before);const audit=await f.call('publisher','auditExport',{id:b.id});evidence('authorization-denial',{boundary,before,after:await f.observe(b.id),audit});
},{enterpriseScopes:[scope,{...scope,caseId:'different-case'}]}));

for(const order of ['race','return-first','approve-first'])test('RETURN API final approval '+order+' serializes one terminal outcome no stale overwrite',()=>scenario('return-race-'+order,async f=>{
 const b=await pending(f);await f.vote('manager',b.id);await f.vote('reviewer',b.id);const before=await f.payment(b.id),approve={id:b.id,revision:before.revision,decision:'APPROVE'},ret={...approve,decision:'RETURN'};
 const attempts=order==='race'?await Promise.all([f.probe('publisher','vote',ret),f.probe('publisher','vote',approve)]):order==='return-first'?[await f.probe('publisher','vote',ret),await f.probe('publisher','vote',approve)]:[await f.probe('publisher','vote',approve),await f.probe('publisher','vote',ret)];
 assert.equal(attempts.filter(x=>x.status===200).length,1);assert.equal(attempts.find(x=>x.status!==200).data.error.code,'INVALID_STATE');const after=await f.payment(b.id);assert.ok(['RETURNED','READY'].includes(after.state));assert.equal(after.workflow.votes.length,3);assert.equal(after.reservation,'HELD');assert.equal(f.env.payments.requests().length,0);if(order==='return-first')assert.equal(after.state,'RETURNED');if(order==='approve-first')assert.equal(after.state,'READY');
 await f.deny('publisher','vote',ret,'INVALID_STATE');if(after.state==='RETURNED')await f.deny('manager','dispatch',{id:b.id},'INVALID_STATE');assert.deepEqual(await f.payment(b.id),after);evidence('race-outcome',{order,attempts,before,after,audit:await f.call('manager','auditExport',{id:b.id})});
}));

test('RETURN API concurrent new IDs after cancel cannot exceed invoice or PO HELD totals',()=>scenario('return-concurrent',async f=>{
 const old=await pending(f);await f.vote('manager',old.id,'RETURN');await f.call('operator','paymentCancel',{id:old.id});const current=await f.invoice();await f.call('operator','invoiceCorrect',{...f.body,number:f.body.number+'-並行',revision:current.revision});
 const a=await f.request(),b=await f.request(),attempts=await Promise.all([f.probe('operator','paymentRequest',a),f.probe('operator','paymentRequest',b)]);assert.equal(attempts.filter(x=>x.status===200).length,1);assert.equal(attempts.find(x=>x.status!==200).data.error.code,'CONFLICT');const accepted=[a,b][attempts.findIndex(x=>x.status===200)];const held=await f.payment(accepted.id);assert.equal(held.reservation,'HELD');assert.equal(held.fields.amount,1200);await f.deny('operator','paymentRequest',await f.request({amount:1}),'CONFLICT');assert.equal((await f.payment(old.id)).reservation,'RELEASED');evidence('concurrent-resubmission',{attempts,held,old:await f.payment(old.id),requests:f.env.payments.requests()});
}));

for(const operation of ['vote','paymentCancel'])for(const fault of ['enterprise-before-audit','enterprise-after-commit'])test('RETURN API '+operation+' '+fault+' atomic rollback or committed recovery no double release',()=>scenario('return-fault-'+operation+'-'+fault,async f=>{
 const b=await pending(f);if(operation==='paymentCancel')await f.vote('manager',b.id,'RETURN');const before=await f.observe(b.id),key=randomUUID(),who=operation==='vote'?'manager':'operator',body=operation==='vote'?returnBody(before.payment):{id:b.id};
 f.env.f.kernel.fault=async p=>{if(p===fault)throw Error('slice fault '+operation+' '+fault);};await f.deny(who,operation,body,'UNAVAILABLE',key);f.env.f.kernel.fault=async()=>{};
 if(fault==='enterprise-before-audit')assert.deepEqual(await f.observe(b.id),before);else{assert.ok(f.env.f.kernel.journal.fenced());const recovery=await f.call('manager','recover',{});assert.ok(recovery.recovered.length);evidence('recovery-'+operation,recovery);}
 const result=await f.call(who,operation,body,key),after=await f.observe(b.id);assert.equal(after.payment.state,operation==='vote'?'RETURNED':'CANCELLED');assert.equal(after.payment.reservation,operation==='vote'?'HELD':'RELEASED');assert.equal(after.payment.workflow.votes.length,1);assert.deepEqual(await f.call(who,operation,body,key),result);assert.deepEqual(await f.observe(b.id),after);assert.equal(after.requests.length,0);
 const audit=await f.call('manager','auditExport',{id:b.id});assert.equal(audit.events.filter(x=>x.record.operation===operation).length,1);if(operation==='paymentCancel')assert.ok(f.env.f.kernel.journal.records().some(x=>x.operationKind==='invoice-version'&&x.id===b.id&&x.actionId===audit.events.find(x=>x.record.operation===operation).record.actionId));evidence('fault-result',{operation,fault,before,result,after,audit,journal:f.env.f.kernel.journal.records()});
}));

async function worker(f,id,mode,crash){
 const argv=['tests/enterprise/worker-child.mjs'],startedAt=new Date().toISOString(),p=spawn(process.execPath,argv,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);const {host,port,user,database,options}=f.env.f.state.pool.options;p.stdin.end(JSON.stringify({config:{host,port,user,database,options},journal:f.env.f.journal.path,credential:f.env.f.credentials.manager,id,mode,url:f.env.payments.url,crash}));const exit=await new Promise((resolve,reject)=>{p.on('error',reject);p.on('exit',(code,signal)=>resolve({code,signal}));});const result={argv:[process.execPath,...argv],cwd:process.cwd(),runtime:process.version,startedAt,finishedAt:new Date().toISOString(),stdout,stderr,...exit};evidence('worker-'+id+'-'+mode,result);return result;
}
for(const crash of ['enterprise-before-send','enterprise-after-send'])test('RETURN API uncertain '+crash+' refuses cancel correct and resubmit observes same operation without POST replay',()=>scenario('return-unknown-'+crash,async f=>{
 const b=await pending(f);await f.approve(b.id);const ready=await f.payment(b.id),exit=await worker(f,b.id,'dispatch',crash);assert.equal(exit.code,73);const before=await f.observe(b.id);assert.equal(before.payment.state,'UNKNOWN');assert.equal(before.payment.reservation,'HELD');await f.deny('operator','paymentCancel',{id:b.id},'INVALID_STATE');await f.deny('operator','invoiceCorrect',{...f.body,revision:before.invoice.revision},'INVALID_STATE');await f.deny('operator','paymentRequest',await f.request({amount:1}),'CONFLICT');await f.deny('manager','dispatch',{id:b.id},'INVALID_STATE');assert.deepEqual(await f.observe(b.id),before);
 const result=await f.call('manager','reconcile',{id:b.id}),after=await f.observe(b.id);assert.equal(after.payment.operation.id,ready.operation.id);assert.equal(after.payment.operation.payloadDigest,ready.operation.payloadDigest);assert.equal(after.payment.reservation,'HELD');
 if(crash==='enterprise-before-send'){assert.deepEqual(result,{id:b.id,state:'UNKNOWN',observation:'ABSENT',requiresHumanReview:true});assert.deepEqual(after.requests.map(x=>x.method),['GET']);assert.equal(after.ledger.length,0);}else{assert.equal(result.state,'SUCCEEDED');assert.deepEqual(after.requests.map(x=>x.method),['POST','GET']);assert.equal(after.ledger.length,1);assert.equal(after.ledger[0].applications,1);assert.equal(digest(after.ledger[0].payload),ready.operation.payloadDigest);}
 assert.ok(after.requests.at(-1).path.endsWith(ready.operation.id));await f.deny('operator','paymentCancel',{id:b.id},'INVALID_STATE');await f.deny('operator','invoiceCorrect',{...f.body,revision:before.invoice.revision},'INVALID_STATE');evidence('unknown-result',{crash,exit,ready,before,result,after});
}));
