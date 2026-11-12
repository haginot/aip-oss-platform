import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {digest,tokenDigest} from '../../src/contracts.mjs';
import {scenario,evidence,business,audit,grant,ops,allFields,childGateway,login,ok,rpc,error,envelope,reconcile,reconciled,unknown,saved} from '../../fixtures/enterprise/ENT-202-public-reconcile-c2a/api-support.mjs';
import {observationGateway,responseLossProxy} from '../../fixtures/enterprise/ENT-202-public-reconcile-c2a/reconcile-fixture.mjs';
const resultKeys=['id','type','revision','paymentRevision','workflow','payment','invoice','purchase','account','definition','identity','coverage','reconciliation'].sort();
function shape(r,id,observation){assert.deepEqual(Object.keys(r).sort(),resultKeys);assert.equal(r.id,id);assert.equal(r.identity.caseId,id);assert.equal(r.identity.paymentId,id);assert.equal(r.payment.id,id);assert.equal(r.payment.reservation,'HELD');assert.deepEqual(r.reconciliation,{observation,requiresHumanReview:observation!=='SUCCEEDED'});assert.equal(r.payment.state,observation==='SUCCEEDED'?'SUCCEEDED':'UNKNOWN');assert.ok(r.payment.operation.id);assert.ok(r.payment.operation.payloadDigest);}
function getOnly(before,after,minimum=1){assert.equal(after.filter(x=>x.method==='POST').length,before.filter(x=>x.method==='POST').length);assert.ok(after.length-before.length>=minimum);assert.ok(after.slice(before.length).every(x=>x.method==='GET'));}
const noLeak=r=>{assert.deepEqual(Object.keys(r.data),['error']);assert.deepEqual(Object.keys(r.data.error),['code']);};
async function classify(f,id){return f.call('publisher','informationCreate',{id:randomUUID(),scope:f.seed.scope,source:{kind:'object',id,projection:[]},label:'STRICT',purposes:['finance-review']});}

test('C2A API01 actual lost acknowledgement reconciles saved payment operation with one external effect',()=>scenario('c2a-api01',async f=>{
 const p=await unknown(f),before=await saved(f,'before',p.id),r=await reconciled(f,p.id),after=await saved(f,'after',p.id);shape(r,p.id,'SUCCEEDED');assert.notEqual(p.id,f.body.id);assert.notEqual(p.id,r.payment.operation.id);assert.deepEqual(r.payment.operation,before.payment.operation);assert.equal(after.paymentLedger.length,1);assert.equal(after.paymentLedger[0].applications,1);assert.equal(digest(after.paymentLedger[0].payload),r.payment.operation.payloadDigest);getOnly(before.paymentRequests,after.paymentRequests);assert.equal(after.outbox[0].state,'SUCCEEDED');evidence('proof',{r,before,after,audit:await audit(f)});
}));

test('C2A API02 actual pre-send child death remains ABSENT UNKNOWN HELD without resend cancel or replacement',()=>scenario('c2a-api02',async f=>{
 const p=await unknown(f,'absent'),before=await saved(f,'before',p.id),r=await reconciled(f,p.id);shape(r,p.id,'ABSENT');const after=await business(f);await f.deny('manager','dispatch',{id:p.id},'INVALID_STATE');await f.deny('operator','paymentCancel',{id:p.id},'INVALID_STATE');const replacement=await f.request();await f.deny('operator','paymentRequest',replacement,'CONFLICT');assert.deepEqual(await business(f),after);const final=await saved(f,'after',p.id);assert.equal(final.outbox[0].state,'UNKNOWN');assert.equal(final.paymentLedger.length,0);getOnly(before.paymentRequests,final.paymentRequests);evidence('proof',{r,before,after,final,replacement});
}));

test('C2A API03 exact keyless typed boundary accepts non UUID payment and rejects caller selected operation',()=>scenario('c2a-api03',async f=>{
 const p=await unknown(f,'lost-ack',{id:'pay.c2a:non-uuid_1'}),before=await business(f),requests=[];
 for(const request of [
  {...envelope(p.id),key:null},{...envelope(p.id),purpose:'finance-review'},
  ...['mode','url','operationId','digest','purpose'].map(k=>({...envelope(p.id),body:{id:p.id,[k]:'forbidden'}})),
  {...envelope(p.id),contractVersion:'1.0.0'},{...envelope(p.id),packageId:'ENT-201'},{...envelope(p.id),type:'InvoiceRecord'},
  {...envelope(p.id),operation:'dispatch'},envelope(f.body.id),envelope(f.po.id),envelope('bad/id'),envelope(null),{...envelope(p.id),body:[]}
 ]){const r=await reconcile(f,p.id,'manager',{request});assert.notEqual(r.status,200,JSON.stringify(r));noLeak(r);requests.push(r);}
 assert.deepEqual(await business(f),before);error(await rpc(f,'reconcile',{id:p.id}),'UNSUPPORTED_CAPABILITY');const r=await reconciled(f,p.id);shape(r,p.id,'SUCCEEDED');evidence('proof',{requests,before,r,after:await saved(f,'after',p.id)});
}));

test('C2A API04 HTTP and current authority denials have no business or external effect and distinct audit',()=>scenario('c2a-api04',async f=>{
 const p=await unknown(f),cases=[];
 async function denied(label,options={},who='manager',code='PERMISSION_DENIED'){const before=await business(f),auditBefore=await audit(f),r=await reconcile(f,p.id,who,options);error(r,code);assert.deepEqual(await business(f),before);const auditAfter=await audit(f);assert.ok(auditAfter.length>=auditBefore.length);cases.push({label,r,before,auditBefore,auditAfter});}
 for(const [label,headers] of [['session',{cookie:''}],['origin',{origin:'http://127.0.0.1:1'}],['csrf',{'x-csrf-token':'invalid'}],['content-type',{'content-type':'text/plain'}]])await denied(label,{headers});
 await denied('other-tenant',{},'tenant2','NOT_FOUND');await denied('other-scope',{},'other','NOT_FOUND');
 for(const [label,change,code] of [['recovery',{operations:ops.filter(x=>x!=='recovery')},'PERMISSION_DENIED'],['scope',{scopes:[]},'NOT_FOUND'],['classification',{fields:['PUBLIC','INTERNAL']},'PERMISSION_DENIED']]){await grant(f,'manager',change);await denied(label,{},'manager',code);await grant(f);}
 evidence('proof',{cases});
}));

test('C2A API05 persisted session expiry after intent prevents second transaction GET and final release',()=>scenario('c2a-api05',async f=>{
 const p=await unknown(f),before=await saved(f,'before',p.id),auditBefore=await audit(f);let expired=0;
 f.env.f.kernel.fault=async point=>{if(point==='enterprise-before-send'){expired=(await f.env.f.owner.query('UPDATE sessions SET expires=now()-interval \'1 second\' WHERE digest=$1 RETURNING digest',[tokenDigest(f.clients.manager.cookie.slice('enterprise_session='.length))])).rowCount;}};
 let r;try{r=await reconcile(f,p.id);error(r,'PERMISSION_DENIED');}finally{f.env.f.kernel.fault=async()=>{};}
 assert.equal(expired,1);noLeak(r);const after=await saved(f,'after',p.id);assert.deepEqual(after.payment,before.payment);assert.deepEqual(after.paymentRequests,before.paymentRequests);assert.deepEqual(after.paymentLedger,before.paymentLedger);const events=await audit(f);assert.ok(events.slice(auditBefore.length).some(x=>x.record.kind==='EnterpriseExternalUncertain'));evidence('proof',{r,expired,before,after,auditBefore,events});
}));

test('C2A API06 saved outbox digest operation binding and recovery fence reject before network',()=>scenario('c2a-api06',async f=>{
 const p=await unknown(f),before=await saved(f,'before',p.id),out=before.outbox[0],cases=[];
 for(const kind of ['digest','operation','aggregate']){const event=structuredClone(out.event);if(kind==='operation')event.operationId='different-operation';if(kind==='aggregate')event.aggregateId='different-payment';await f.env.f.owner.query('UPDATE outbox SET event=$2,digest=$3 WHERE operation_id=$1',[out.operation_id,event,kind==='digest'?'0'.repeat(64):digest(event)]);
  try{const r=await reconcile(f,p.id);assert.notEqual(r.status,200,JSON.stringify(r));noLeak(r);assert.deepEqual(f.env.payments.requests(),before.paymentRequests);cases.push({kind,r,savedOutbox:(await f.env.f.owner.query('SELECT * FROM outbox WHERE operation_id=$1',[out.operation_id])).rows});}finally{await f.env.f.owner.query('UPDATE outbox SET event=$2,digest=$3 WHERE operation_id=$1',[out.operation_id,out.event,out.digest]);}
 }
 f.env.f.kernel.fault=async point=>{if(point==='enterprise-after-commit')throw Error('controlled fence');};try{await assert.rejects(()=>grant(f));}finally{f.env.f.kernel.fault=async()=>{};}
 assert.ok(f.env.f.journal.fenced());const fenced=await reconcile(f,p.id);assert.notEqual(fenced.status,200);noLeak(fenced);assert.deepEqual(f.env.payments.requests(),before.paymentRequests);evidence('proof',{before,cases,fenced,journal:f.env.f.journal.records()});await f.call('reviewer','recover',{});
}));

test('C2A API07 real GET network JSON and operation receipt faults retain UNKNOWN then recover with GET only',()=>scenario('c2a-api07',async f=>{
 const p=await unknown(f),before=await saved(f,'before',p.id),proxy=await observationGateway(f),cases=[];
 for(const mode of ['network','bad-json','wrong-operation']){proxy.setMode(mode);const auditBefore=await audit(f),r=await reconciled(f,p.id,'manager',proxy);shape(r,p.id,'UNKNOWN');const after=await saved(f,'fault-'+mode,p.id);assert.deepEqual(after.payment,before.payment);assert.deepEqual(after.paymentLedger,before.paymentLedger);const events=await audit(f);assert.ok(events.slice(auditBefore.length).some(x=>x.record.kind==='EnterpriseExternalUncertain'));cases.push({mode,r,after,auditBefore,events});}
 proxy.setMode('forward');const r=await reconciled(f,p.id,'manager',proxy);shape(r,p.id,'SUCCEEDED');assert.ok(proxy.requests.every(x=>x.method==='GET'));assert.equal(proxy.requests.length,4);const after=await saved(f,'after',p.id);getOnly(before.paymentRequests,after.paymentRequests);assert.equal(after.paymentLedger[0].applications,1);proxy.capture();evidence('proof',{before,cases,r,after});
}));

test('C2A API08 after-send rollback and actual lost HTTP response converge through child restart read',()=>scenario('c2a-api08',async f=>{
 const p=await unknown(f,'after-send-crash'),before=await saved(f,'before',p.id);f.env.f.kernel.fault=async point=>{if(point==='enterprise-after-send')throw Error('controlled after GET failure');};let uncertain;try{uncertain=await reconciled(f,p.id);shape(uncertain,p.id,'UNKNOWN');}finally{f.env.f.kernel.fault=async()=>{};}
 const first=await childGateway(f);f.children.push(first);const client=await login({...f.env,gateway:first},'manager'),proxy=await responseLossProxy(f,first);await assert.rejects(()=>reconcile(f,p.id,'manager',{origin:proxy.url,client}));assert.equal(proxy.exchanges.length,1);assert.equal(proxy.exchanges[0].status,200);shape(proxy.exchanges[0].body.result,p.id,'SUCCEEDED');await first.close();
 const second=await childGateway(f);f.children.push(second);assert.notEqual(first.pid,second.pid);const client2=await login({...f.env,gateway:second},'manager'),r=await reconcile(f,p.id,'manager',{origin:second.origin,client:client2});error(r,'INVALID_STATE');const view=await ok(f,'get',{id:p.id},'manager',{origin:second.origin,client:client2});assert.equal(view.payment.state,'SUCCEEDED');const after=await saved(f,'after',p.id);getOnly(before.paymentRequests,after.paymentRequests,2);assert.equal(after.paymentLedger[0].applications,1);evidence('proof',{before,uncertain,exchanges:proxy.exchanges,firstPid:first.pid,secondPid:second.pid,r,view,after});
}));

test('C2A API09 concurrent same payment reconciles once and rejects terminal second request',()=>scenario('c2a-api09',async f=>{
 const p=await unknown(f),before=await saved(f,'before',p.id),rows=await Promise.all([reconcile(f,p.id),reconcile(f,p.id)]);assert.equal(rows.filter(x=>x.status===200).length,1,JSON.stringify(rows));shape(rows.find(x=>x.status===200).data.result,p.id,'SUCCEEDED');error(rows.find(x=>x.status!==200),'INVALID_STATE');const after=await saved(f,'after',p.id);assert.deepEqual(after.payment.operation,before.payment.operation);getOnly(before.paymentRequests,after.paymentRequests);assert.equal(after.paymentRequests.length-before.paymentRequests.length,1);assert.equal(after.paymentLedger[0].applications,1);evidence('proof',{before,rows,after});
}));

test('C2A API10 changed current account still observes original immutable payment operation snapshot',()=>scenario('c2a-api10',async f=>{
 const p=await unknown(f),before=await saved(f,'before',p.id);await f.call('publisher','paymentAccountSet',{...f.account,revision:1,syntheticReference:'synthetic:c2a-new-account'});const current=await f.call('operator','paymentAccountRead',{id:f.account.id}),r=await reconciled(f,p.id);shape(r,p.id,'SUCCEEDED');assert.deepEqual(r.payment.operation,before.payment.operation);assert.deepEqual(r.payment.accountSnapshot,before.payment.accountSnapshot);assert.equal(r.account.syntheticReference,'synthetic:c2a-new-account');const after=await saved(f,'after',p.id);getOnly(before.paymentRequests,after.paymentRequests);assert.equal(after.paymentLedger[0].applications,1);assert.equal(digest(after.paymentLedger[0].payload),before.payment.operation.payloadDigest);evidence('proof',{before,current,r,after});
}));

test('C2A API11 real current authority revocation between pre-read and work rejects without network',async()=>{
 for(const kind of ['recovery','read','scope','classification'])await scenario('c2a-api11-'+kind,async f=>{const p=await unknown(f),before=await saved(f,'before',p.id),native=f.env.f.kernel.enterpriseWork.bind(f.env.f.kernel);let reached=false;
  f.env.f.kernel.enterpriseWork=async(...args)=>{reached=true;await grant(f,'manager',kind==='scope'?{scopes:[]}:kind==='classification'?{fields:['PUBLIC','INTERNAL']}:{operations:ops.filter(x=>x!==kind)});return native(...args);};let r;try{r=await reconcile(f,p.id);error(r,kind==='scope'?'NOT_FOUND':'PERMISSION_DENIED');}finally{f.env.f.kernel.enterpriseWork=native;}
  assert.equal(reached,true);noLeak(r);const after=await saved(f,'after',p.id);assert.deepEqual(after.payment,before.payment);assert.deepEqual(after.paymentRequests,before.paymentRequests);assert.deepEqual(after.paymentLedger,before.paymentLedger);evidence('proof',{kind,before,r,after,audit:await audit(f)});
 });
});

test('C2A API12 final read revocation rejects whole response after actual committed success',async()=>{
 for(const kind of ['read','scope','classification','payment-policy','purchase-policy'])await scenario('c2a-api12-'+kind,async f=>{const p=await unknown(f),before=await saved(f,'before',p.id),native=f.env.f.kernel.enterpriseWork.bind(f.env.f.kernel);let worked;
  f.env.f.kernel.enterpriseWork=async(...args)=>{worked=await native(...args);assert.equal(worked.state,'SUCCEEDED');if(kind.endsWith('-policy'))await classify(f,kind==='payment-policy'?p.id:f.po.id);else await grant(f,'manager',kind==='scope'?{scopes:[]}:kind==='classification'?{fields:['PUBLIC','INTERNAL']}:{operations:ops.filter(x=>x!=='read')});return worked;};let r;try{r=await reconcile(f,p.id);error(r,kind==='scope'?'NOT_FOUND':'PERMISSION_DENIED');}finally{f.env.f.kernel.enterpriseWork=native;}
  noLeak(r);const db=(await f.env.f.owner.query('SELECT i.state,o.state AS outbox_state,o.event,o.digest FROM enterprise_instances i JOIN outbox o ON o.aggregate_id=i.id WHERE i.id=$1',[p.id])).rows;assert.equal(db[0].state,'SUCCEEDED');assert.equal(db[0].outbox_state,'SUCCEEDED');assert.equal(db[0].digest,before.payment.operation.payloadDigest);const requests=f.env.payments.requests(),ledger=await f.env.payments.ledger();getOnly(before.paymentRequests,requests);assert.equal(ledger[0].applications,1);evidence('proof',{kind,before,worked,r,db,requests,ledger,audit:await audit(f)});
 });
});

test('C2A API13 final projection change conflicts and final success overrides real stale ABSENT observation',async()=>{
 await scenario('c2a-api13-conflict',async f=>{const p=await unknown(f),before=await saved(f,'before',p.id),nativeWork=f.env.f.kernel.enterpriseWork.bind(f.env.f.kernel),nativeRead=f.env.f.kernel.enterprise.bind(f.env.f.kernel);let final=false,changed=false;
  f.env.f.kernel.enterpriseWork=async(...args)=>{const r=await nativeWork(...args);final=true;return r;};f.env.f.kernel.enterprise=async(...args)=>{const result=await nativeRead(...args);if(final&&!changed&&args[1].operation==='paymentAccountRead'){changed=true;await f.call('publisher','paymentAccountSet',{...f.account,revision:1,syntheticReference:'synthetic:c2a-during-projection'});}return result;};let r;try{r=await reconcile(f,p.id);error(r,'CONFLICT');}finally{f.env.f.kernel.enterpriseWork=nativeWork;f.env.f.kernel.enterprise=nativeRead;}assert.ok(changed);noLeak(r);const after=await saved(f,'after',p.id);assert.equal(after.payment.state,'SUCCEEDED');getOnly(before.paymentRequests,after.paymentRequests);evidence('proof',{before,r,after,changed});
 });
 await scenario('c2a-api13-stale-absent',async f=>{const p=await unknown(f,'absent'),before=await saved(f,'before',p.id),native=f.env.f.kernel.enterpriseWork.bind(f.env.f.kernel);let first,second;
  f.env.f.kernel.enterpriseWork=async(...args)=>{first=await native(...args);assert.equal(first.observation,'ABSENT');const event=before.outbox[0].event,response=await fetch(f.env.payments.url+'/payments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operationId:before.payment.operation.id,event})});assert.equal(response.status,200);second=await native(...args);assert.equal(second.state,'SUCCEEDED');return {...first,internalSecret:'must-not-leak',externalRevision:999};};let r;try{r=await reconciled(f,p.id);}finally{f.env.f.kernel.enterpriseWork=native;}
  shape(r,p.id,'SUCCEEDED');assert.equal(JSON.stringify(r).includes('must-not-leak'),false);assert.equal('externalRevision' in r,false);const after=await saved(f,'after',p.id);assert.deepEqual(after.payment.operation,before.payment.operation);assert.equal(after.paymentLedger[0].applications,1);assert.deepEqual(after.paymentRequests.map(x=>x.method),['GET','POST','GET']);evidence('proof',{before,first,second,r,after,note:'The one POST is the test fixture completing the already saved operation between two real GET observations, not an adapter resend.'});
 });
});
