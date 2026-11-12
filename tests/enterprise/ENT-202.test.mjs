import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {invoiceEnvironment} from '../../scripts/enterprise/invoice-local.mjs';
import {publishInvoice} from '../../scripts/enterprise/invoice-seed.mjs';
import {seedQuantity,compareQuantity,approvePurchase,receiptBody,scope} from './quantity-helper.mjs';
import {SyntheticPort} from '../../src/enterprise/worker.mjs';
import {login} from './http-helper.mjs';
import {evidence} from './assurance-helper.mjs';
import {restart} from './helpers.mjs';
import {digest} from '../../src/contracts.mjs';

export async function scenario(fn,options={}){
 const env=await invoiceEnvironment(options);
 try{
  const clients={},http=[];for(const who of ['operator','manager','reviewer','publisher','agent','reader','other','tenant2'])clients[who]=await login(env,who);
  const call=async(who,op,body={},key=randomUUID())=>{
   const response=await clients[who].api(op,body,key),data=await response.json();http.push({who,op,body,key,status:response.status,data});if(response.status!==200)throw Object.assign(Error(JSON.stringify(data)),{code:data.error.code});return data.result;
  };
  await publishInvoice(env.f,call);const seed=await seedQuantity(env.f,call,options.purchaseScope??scope),f={call};
  const purchase=await approvePurchase(f,await compareQuantity(f,seed)),port=new SyntheticPort(env.payments.url);
  const work=(id,mode='dispatch',who='manager')=>call(who,mode,{id});
  await work(purchase.id);let record=await call('operator','purchaseRead',{id:purchase.id});
  await call('agent','purchaseReceive',receiptBody(purchase,record));record=await call('operator','purchaseRead',{id:purchase.id});
  const account={id:'account-'+randomUUID(),scope:seed.scope,supplierId:seed.supplierIds[0],currency:'JPY',syntheticReference:'synthetic:local-bank-1',revision:0};await call('publisher','paymentAccountSet',account);
  const body={id:'invoice-'+randomUUID(),purchaseId:purchase.id,number:'合成請求-001',supplierId:seed.supplierIds[0],amount:1200,currency:'JPY',quantity:7,unit:'台'};
  const request=(invoiceId=body.id,amount=1200)=>({id:'payment-'+randomUUID(),invoiceId,revision:1,accountId:account.id,amount});
  const approve=async payment=>{for(const who of ['manager','reviewer','publisher'])await call(who,'vote',{id:payment.id,revision:1,decision:'APPROVE'});};
  try{await fn({...env,call,http,seed,purchase,record,account,body,request,approve,port,work});}finally{evidence('http-'+body.id,{http,orderLedger:await env.effects.ledger(),paymentLedger:await env.payments.ledger(),paymentRequests:env.payments.requests(),orderRequests:env.effects.requests()});}
 }finally{await env.close();}
}
const rejected=(fn,code)=>assert.rejects(fn,{code});

test('ENT-202 AC-01 positive public HTTP full quantity order independent receipt invoice exception approval payment reconciliation',()=>scenario(async e=>{
 const {call,body,account,request,approve,work}=e;
 const imported=await call('operator','invoiceImport',{...body,amount:1199});assert.equal(imported.state,'QUARANTINED');assert.deepEqual(imported.reasons,['AMOUNT_MISMATCH']);await rejected(()=>call('operator','paymentRequest',request()),'INVALID_STATE');
 const corrected=await call('operator','invoiceCorrect',{...body,revision:1});assert.equal(corrected.state,'MATCHED');
 const b={...request(),revision:2};await call('operator','paymentRequest',b);await approve(b);const boundInvoice=await call('operator','invoiceRead',{id:body.id});await rejected(()=>call('operator','invoiceCorrect',{...body,amount:1,revision:2}),'INVALID_STATE');assert.deepEqual(await call('operator','invoiceRead',{id:body.id}),boundInvoice);
 assert.equal((await work(b.id)).state,'SUCCEEDED');assert.equal((await work(b.id)).state,'SUCCEEDED');
 const invoice=await call('operator','invoiceRead',{id:body.id}),payment=await call('operator','paymentRead',{id:b.id}),ledger=await e.payments.ledger(),event=ledger[0].payload;
 assert.equal(invoice.source.quantityContract.matchEligible,true);assert.equal(invoice.source.receipt.actor,'agent');assert.equal(invoice.source.receipt.receivedQuantity,7);assert.equal(invoice.source.receipt.operationId,e.record.order.operationId);
 assert.equal(payment.fields.sourceDigest,digest(invoice.source));assert.equal(event.fields.invoiceRevision,2);assert.equal(event.fields.accountRevision,1);assert.equal(event.fields.accountId,account.id);assert.equal(event.fields.syntheticReference,account.syntheticReference);assert.equal(event.operationKind,'invoice-payment');assert.equal(event.destination,'local-synthetic-payment');assert.equal(event.fields.amount,1200);assert.equal(event.fields.purchaseId,e.purchase.id);assert.equal(event.fields.sourceDigest,payment.fields.sourceDigest);assert.equal(payment.operation.id,event.operationId);assert.equal(payment.operation.payloadDigest,digest(event));
 assert.equal(ledger.length,1);assert.equal(ledger[0].applications,1);assert.notEqual(event.operationId,e.record.order.operationId);assert.equal(e.effects.requests().filter(x=>x.method==='POST').length,1);assert.equal(e.payments.requests().filter(x=>x.method==='POST').length,1);
 const audit=await call('manager','auditExport',{id:b.id});assert.ok(audit.events.some(x=>x.record.operation==='paymentRequest'));assert.ok(audit.events.some(x=>x.record.kind==='EnterpriseExternalObserved'));assert.equal((await call('manager','invoiceAudit',{id:body.id})).events.filter(x=>x.record.kind==='EnterpriseCommand').length,2);
 for(const author of [invoice.author,payment.author,payment.accountSnapshot.author])assert.deepEqual(Object.keys(author).sort(),['actor','delegationId','policyVersion','subject']);for(const value of ['private-author-dept','private-author-case'])assert.equal(JSON.stringify({invoice,payment}).includes(value),false);
 evidence('invoice-positive',{invoice,payment,event,ledger,audit,source:e.record});
},{enterpriseScopes:[scope,{...scope,departmentId:'private-author-dept',caseId:'private-author-case'}]}));

test('ENT-202 AC-02 duplicate mismatch quarantine and partial concurrent cumulative purchase overpayment',()=>scenario(async e=>{
 const {call,body,request,approve,work}=e;await call('operator','invoiceImport',body);
 await rejected(()=>call('operator','invoiceImport',{...body,id:randomUUID(),number:'  合成請求-001  '}),'CONFLICT');
 for(const delta of [{amount:1199},{currency:'USD'},{quantity:6},{unit:'箱'},{supplierId:e.seed.supplierIds[1]}]){
  const r=await call('operator','invoiceImport',{...body,id:randomUUID(),number:randomUUID(),...delta});assert.equal(r.state,'QUARANTINED');assert.ok(r.reasons.length);await rejected(()=>call('operator','paymentRequest',request(r.id)),'INVALID_STATE');
 }
 const p=request(body.id,400);await call('operator','paymentRequest',p);await approve(p);await work(p.id);
 const attempts=[request(body.id,800),request(body.id,800)],results=await Promise.allSettled(attempts.map(b=>call('operator','paymentRequest',b)));assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'CONFLICT');
 const accepted=attempts[results.findIndex(x=>x.status==='fulfilled')];await approve(accepted);await work(accepted.id);
 await rejected(()=>call('operator','paymentRequest',request(body.id,1)),'CONFLICT');
 const second={...body,id:randomUUID(),number:'別番号の同一発注'};await call('operator','invoiceImport',second);await rejected(()=>call('operator','paymentRequest',request(second.id,1)),'CONFLICT');
 assert.equal((await e.payments.ledger()).reduce((n,x)=>n+x.payload.fields.amount,0),1200);evidence('invoice-overpayment',{results:results.map(x=>({status:x.status,code:x.reason?.code})),ledger:await e.payments.ledger()});
}));

test('ENT-202 AC-02 account change invalidates old approvals cancellation releases only unsent reservations UNKNOWN observes immutable snapshot',()=>scenario(async e=>{
 const {call,body,request,approve,work,account}=e;await call('operator','invoiceImport',body);const p=request();await call('operator','paymentRequest',p);await approve(p);
 await call('publisher','paymentAccountSet',{...account,revision:1,syntheticReference:'synthetic:local-bank-2'});await rejected(()=>work(p.id),'STALE_APPROVAL');assert.equal(e.payments.requests().length,0);
 await call('operator','paymentCancel',{id:p.id});const next=request();await call('operator','paymentRequest',next);await approve(next);e.payments.fault('lost-ack');assert.equal((await work(next.id)).state,'UNKNOWN');
 await call('publisher','paymentAccountSet',{...account,revision:2,syntheticReference:'synthetic:local-bank-3'});await rejected(()=>work(next.id),'INVALID_STATE');await rejected(()=>call('operator','paymentCancel',{id:next.id}),'INVALID_STATE');await rejected(()=>call('operator','paymentRequest',request(body.id,1)),'CONFLICT');
 assert.equal((await work(next.id,'reconcile')).state,'SUCCEEDED');assert.equal((await e.payments.ledger())[0].payload.fields.syntheticReference,'synthetic:local-bank-2');assert.deepEqual(e.payments.requests().map(x=>x.method),['POST','GET']);
 evidence('invoice-account-unknown',{payment:await call('operator','paymentRead',{id:next.id}),ledger:await e.payments.ledger(),requests:e.payments.requests()});
}));

test('ENT-202 AC-03 negative-authorization importer receiver self proxy boundaries immutable approval and revoked authority',()=>scenario(async e=>{
 const {call,body,request,approve,work}=e;await call('manager','invoiceImport',body);const p=request();await call('operator','paymentRequest',p);
 for(const who of ['operator','manager','agent'])await rejected(()=>call(who,'vote',{id:p.id,revision:1,decision:'APPROVE'}),'PERMISSION_DENIED');
 await call('manager','delegate',{id:'invoice-proxy',actor:'agent',scopes:[scope],operations:['approve','action'],expires:new Date(Date.now()+60000).toISOString()});await rejected(()=>e.f.kernel.enterprise({...e.f.credentials.agent,delegationId:'invoice-proxy'},{operation:'vote',key:randomUUID(),body:{id:p.id,revision:1,decision:'APPROVE'}}),'PERMISSION_DENIED');
 for(const who of ['reader','other','tenant2'])for(const [op,id] of [['invoiceRead',body.id],['paymentRead',p.id],['paymentAccountRead',e.account.id]])await rejected(()=>call(who,op,{id}),who==='reader'?'PERMISSION_DENIED':'NOT_FOUND');
 for(const op of ['edit','attach','cancel','routeSet','definitionMigrate'])await rejected(()=>call('operator',op,{id:p.id,revision:1,fields:{amount:1}}),'PERMISSION_DENIED');
 // Use a separate invoice imported by the operator for the normal approval path.
 await call('operator','paymentCancel',{id:p.id});const other={...body,id:randomUUID(),number:'approval-current'};await call('operator','invoiceImport',other);const valid=request(other.id);await call('operator','paymentRequest',valid);await approve(valid);
 await call('publisher','grant',{principal:'reviewer',scopes:[],operations:[],fields:[]});await rejected(()=>work(valid.id),'PERMISSION_DENIED');
 await call('publisher','grant',{principal:'reviewer',scopes:[scope],operations:['read','search','action','approve','worker','recovery','author','review','publish','records','audit','connect'],fields:['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED']});await rejected(()=>work(valid.id),'STALE_APPROVAL');assert.equal(e.payments.requests().length,0);
 evidence('invoice-authorization',{payment:await call('operator','paymentRead',{id:valid.id}),noPaymentRequests:e.payments.requests()});
}));

test('persistence failure-recovery atomic invoice payment reservation and final approval audit rollback commit response loss restart',()=>scenario(async e=>{
 const {call,body,request,approve,work,f}=e;
 f.kernel.fault=async p=>{if(p==='enterprise-before-audit')throw Error('invoice audit failure');};await rejected(()=>call('operator','invoiceImport',body),'UNAVAILABLE');f.kernel.fault=async()=>{};
 await rejected(()=>call('operator','invoiceRead',{id:body.id}),'NOT_FOUND');
 await call('operator','invoiceImport',body);const before=await call('operator','invoiceRead',{id:body.id}),b=request(),key=randomUUID();
 f.kernel.fault=async p=>{if(p==='enterprise-before-audit')throw Error('reservation audit rollback');};await rejected(()=>call('operator','paymentRequest',b,key),'UNAVAILABLE');f.kernel.fault=async()=>{};
 assert.deepEqual(await call('operator','invoiceRead',{id:body.id}),before);await rejected(()=>call('operator','paymentRead',{id:b.id}),'NOT_FOUND');
 const created=await call('operator','paymentRequest',b,key);assert.deepEqual(await call('operator','paymentRequest',b,key),created);await rejected(()=>call('operator','paymentRequest',{...b,amount:1},key),'IDEMPOTENCY_MISMATCH');
 for(const who of ['manager','reviewer'])await call(who,'vote',{id:b.id,revision:1,decision:'APPROVE'});
 const pending=await call('operator','paymentRead',{id:b.id});f.kernel.fault=async p=>{if(p==='enterprise-before-audit')throw Error('approval rollback');};await rejected(()=>call('publisher','vote',{id:b.id,revision:1,decision:'APPROVE'}),'UNAVAILABLE');f.kernel.fault=async()=>{};
 assert.deepEqual(await call('operator','paymentRead',{id:b.id}),pending);await call('publisher','vote',{id:b.id,revision:1,decision:'APPROVE'});
 const ready=await call('operator','paymentRead',{id:b.id});restart(f);assert.deepEqual(JSON.parse(JSON.stringify(await f.call('operator','paymentRead',{id:b.id}))),ready);assert.deepEqual(await f.call('operator','paymentRequest',b,key),created);
 // Use the reconstructed Kernel for both the lost commit and journal recovery.
 const invoice2={...body,id:randomUUID(),number:'lost-commit'},commitKey=randomUUID();f.kernel.fault=async p=>{if(p==='enterprise-after-commit')throw Error('lost commit response');};await rejected(()=>f.call('operator','invoiceImport',invoice2,commitKey),'UNAVAILABLE');f.kernel.fault=async()=>{};
 assert.ok(f.kernel.journal.fenced());await f.kernel.enterpriseRecover(f.credentials.manager);assert.equal((await f.call('operator','invoiceImport',invoice2,commitKey)).state,'MATCHED');assert.equal((await f.call('operator','invoiceRead',{id:invoice2.id})).history.length,1);
 assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},e.port)).state,'SUCCEEDED');assert.equal((await e.payments.ledger()).length,1);
 evidence('invoice-rollback-restart',{before,pending,ready,restarted:await f.call('operator','paymentRead',{id:b.id}),recoveredInvoice:await f.call('operator','invoiceRead',{id:invoice2.id}),ledger:await e.payments.ledger()});
}));

test('failure-recovery UNKNOWN ABSENT retains reservation no resend and successful observation after real worker process death',()=>scenario(async e=>{
 const {spawn}=await import('node:child_process'),{call,body,request,approve,f}=e;await call('operator','invoiceImport',body);const b=request();await call('operator','paymentRequest',b);await approve(b);
 const child=(mode,crash)=>new Promise((resolve,reject)=>{
  const p=spawn(process.execPath,['tests/enterprise/worker-child.mjs'],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);p.on('error',reject);p.on('exit',(code,signal)=>resolve({code,signal,stdout,stderr}));const {host,port,user,database,options}=f.state.pool.options;p.stdin.end(JSON.stringify({config:{host,port,user,database,options},journal:f.journal.path,credential:f.credentials.manager,id:b.id,mode,url:e.payments.url,crash}));
 });
 const before=await child('dispatch','enterprise-before-send');assert.equal(before.code,73,before.stderr);restart(f);assert.equal((await f.call('operator','paymentRead',{id:b.id})).state,'UNKNOWN');
 await rejected(()=>f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},e.port),'INVALID_STATE');const absent=await child('reconcile');assert.equal(absent.code,0,absent.stderr);assert.equal(JSON.parse(absent.stdout).observation,'ABSENT');assert.equal(JSON.parse(absent.stdout).requiresHumanReview,true);await rejected(()=>f.call('operator','paymentRequest',request(body.id,1)),'CONFLICT');assert.deepEqual(e.payments.requests().map(x=>x.method),['GET']);
 // Another invoice/order gets a separate reservation and a worker that dies after
 // actual external application. No direct ledger insertion or stubbed success.
 const budget={id:randomUUID(),scope,currency:'JPY',unit:'minor',capacity:2000,threshold:2000,periodEnd:'2099-01-01T00:00:00Z',calculationVersion:'integer-v1'};await f.call('manager','resourceCreate',budget);
 const po=await approvePurchase(f,await compareQuantity(f,{...e.seed,budgetId:budget.id}));await f.kernel.enterpriseWork(f.credentials.manager,{id:po.id,mode:'dispatch'},e.port);let order=await f.call('operator','purchaseRead',{id:po.id});await f.call('agent','purchaseReceive',receiptBody(po,order));
 const second={...body,id:randomUUID(),purchaseId:po.id,number:'worker-death'};await f.call('operator','invoiceImport',second);const p2=request(second.id);await f.call('operator','paymentRequest',p2);for(const who of ['manager','reviewer','publisher'])await f.call(who,'vote',{id:p2.id,revision:1,decision:'APPROVE'});
 // Spawn an actual process against the same persisted SQL, journal and HTTP port.
 const crash=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['tests/enterprise/worker-child.mjs'],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);p.on('error',reject);p.on('exit',(code,signal)=>resolve({code,signal,stdout,stderr}));const {host,port,user,database,options}=f.state.pool.options;p.stdin.end(JSON.stringify({config:{host,port,user,database,options},journal:f.journal.path,credential:f.credentials.manager,id:p2.id,mode:'dispatch',url:e.payments.url,crash:'enterprise-after-send'}));});
 assert.equal(crash.code,73,crash.stderr);restart(f);assert.equal((await f.call('operator','paymentRead',{id:p2.id})).state,'UNKNOWN');assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:p2.id,mode:'reconcile'},e.port)).state,'SUCCEEDED');
 assert.deepEqual(e.payments.requests().map(x=>x.method),['GET','POST','GET']);assert.equal((await e.payments.ledger())[0].applications,1);await rejected(()=>f.kernel.enterpriseWork(f.credentials.manager,{id:p2.id,mode:'compensate'},e.port),'UNSUPPORTED_CAPABILITY');
 evidence('invoice-worker-death',{before,absent,crash,payment:await f.call('operator','paymentRead',{id:p2.id}),requests:e.payments.requests(),ledger:await e.payments.ledger()});
}));

test('failure-recovery actual SQL restore fences missing invoice reservation account history and pre-send payment state',()=>scenario(async e=>{
 const {execFileSync}=await import('node:child_process'),{f,cluster,call,body,request,approve,work}=e;
 const schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database];
 const dump=name=>{const path=cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};
 const restore=async path=>{await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});restart(f);};
 const initial=dump('invoice-initial');await call('operator','invoiceImport',body);const invoice=dump('invoice-imported'),b=request();await call('operator','paymentRequest',b);await approve(b);const ready=dump('invoice-ready');await work(b.id);const complete=dump('invoice-complete'),requests=e.payments.requests();
 // SQL still has a valid payment row but has forgotten external intent. The
 // independent fsynced intent must stop every send and observation.
 await restore(ready);for(const mode of ['dispatch','reconcile'])await rejected(()=>f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode},e.port),'RECOVERING');await rejected(()=>f.call('operator','paymentRead',{id:b.id}),'RECOVERING');
 await restore(invoice);await rejected(()=>f.call('operator','paymentRequest',request()),'RECOVERING');await rejected(()=>f.kernel.enterpriseRecover(f.credentials.manager),'RECOVERING');
 await restore(initial);await rejected(()=>f.call('operator','invoiceImport',{...body,id:randomUUID()}),'RECOVERING');await rejected(()=>f.call('publisher','paymentAccountSet',{...e.account,revision:1,syntheticReference:'synthetic:changed'}),'RECOVERING');
 await restore(complete);const completed=await f.call('operator','paymentRead',{id:b.id});assert.equal(completed.state,'SUCCEEDED');assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},e.port)).state,'SUCCEEDED');assert.deepEqual(e.payments.requests(),requests);
 // Corruption injection is a negative case, never business setup.
 await f.owner.query("UPDATE enterprise_invoice SET data=jsonb_set(data,'{fields,amount}','1') WHERE id=$1",[b.id]);await rejected(()=>f.call('operator','paymentRead',{id:b.id}),'RECOVERING');
 evidence('invoice-sql-restore',{actualDumpRestore:true,missingReservationFenced:true,missingInvoiceFenced:true,preSendRestoreFenced:true,corruptionFenced:true,completed,requests:e.payments.requests(),ledger:await e.payments.ledger()});
}));

test('negative-authorization STRICT classification current reads replay query and worker fail closed while correctable input is preserved',()=>scenario(async e=>{
 const {call,body,request,approve,work}=e;await call('operator','invoiceImport',body);const b=request(),key=randomUUID();const result=await call('operator','paymentRequest',b,key);await approve(b);
 const grant=(principal,fields,scopes=[e.seed.scope],operations=['read','search','action','worker','recovery','audit'])=>call('publisher','grant',{principal,scopes,operations,fields});
 await grant('agent',['CONFIDENTIAL','STRICT']);assert.equal((await call('agent','paymentRead',{id:b.id})).fields.amount,1200);
 await grant('agent',['CONFIDENTIAL']);for(const [op,id] of [['invoiceRead',body.id],['paymentRead',b.id],['paymentAccountRead',e.account.id],['auditExport',b.id],['get',b.id],['history',b.id]])await rejected(()=>call('agent',op,{id}),'PERMISSION_DENIED');
 assert.deepEqual(await call('agent','query',{packageId:'enterprise-invoice',type:'InvoicePayment'}),{items:[]});assert.deepEqual(await call('agent','query',{packageId:'enterprise-invoice',type:'InvoicePayment',aggregate:true}),{count:0});await rejected(()=>work(b.id,'dispatch','agent'),'PERMISSION_DENIED');
 await grant('operator',['CONFIDENTIAL']);await rejected(()=>call('operator','paymentRequest',b,key),'PERMISSION_DENIED');await grant('operator',['CONFIDENTIAL','STRICT']);assert.deepEqual(await call('operator','paymentRequest',b,key),result);
 // Restore is a new grant revision: the previous requester authority is stale.
 await rejected(()=>work(b.id),'STALE_APPROVAL');assert.equal(e.payments.requests().length,0);
 evidence('invoice-strict',{noRequests:e.payments.requests(),current:await call('operator','paymentRead',{id:b.id})});
},{purchaseScope:{...scope,classification:'STRICT'},enterpriseScopes:[scope,{...scope,classification:'STRICT'}]}));

test('ENT-202 AC-04 current source test config and original four AC hashes are recorded for separate independent review',async()=>{
 const {inputs,hash}=await import('../../scripts/enterprise/evidence.mjs'),{readFileSync}=await import('node:fs'),current=inputs(process.cwd());
 for(const path of ['src/enterprise/invoice.mjs','src/enterprise/worker.mjs','config/enterprise/invoice.json','tests/enterprise/ENT-202.test.mjs','tests/enterprise/ENT-202.browser.test.mjs','work/enterprise/issues/ENT-202.md','work/enterprise/plan.json'])assert.equal(current.entries.find(x=>x.path===path)?.sha256,hash(readFileSync(path)));
 const plan=JSON.parse(readFileSync('work/enterprise/plan.json')).issues.find(x=>x.id==='ENT-202');assert.equal(plan.originalAcceptance.length,4);assert.equal(plan.status,'OPEN');assert.equal(plan.sourceSpecSha256,hash(readFileSync(plan.sourceSpec)));
 if(process.env.ENTERPRISE_CANDIDATE_INPUTS)assert.deepEqual(current,JSON.parse(readFileSync(process.env.ENTERPRISE_CANDIDATE_INPUTS)));
 evidence('invoice-current-inputs',{inputs:current,originalAcceptance:plan.originalAcceptance,formalAcceptance:'PENDING',independentReview:'PENDING_SEPARATE_SESSION'});
});

test('positive three point match requires publicly ordered independent full receipt and refuses legacy UNKNOWN quantity',()=>scenario(async e=>{
 const {call,body,request,work}=e;
 const budget=async()=>{const b={id:randomUUID(),scope,currency:'JPY',unit:'minor',capacity:2000,threshold:2000,periodEnd:'2099-01-01T00:00:00Z',calculationVersion:'integer-v1'};await call('manager','resourceCreate',b);return b.id;};
 const po=await approvePurchase({call},await compareQuantity({call},{...e.seed,budgetId:await budget()}));await work(po.id);const invoice={...body,id:randomUUID(),number:'before-independent-receipt',purchaseId:po.id};
 const quarantined=await call('operator','invoiceImport',invoice);assert.deepEqual(quarantined.reasons,['RECEIPT_NOT_ELIGIBLE']);await rejected(()=>call('operator','paymentRequest',request(invoice.id)),'INVALID_STATE');
 const order=await call('operator','purchaseRead',{id:po.id});await call('agent','purchaseReceive',receiptBody(po,order));const corrected=await call('operator','invoiceCorrect',{...invoice,revision:1});assert.equal(corrected.state,'MATCHED');const matched=await call('operator','invoiceRead',{id:invoice.id});assert.equal(matched.source.receipt.receivedQuantity,7);assert.equal(matched.source.receipt.unit,'台');
 const {comparePurchase}=await import('./procurement-helper.mjs');const legacy=await approvePurchase({call},await comparePurchase({call},{...e.seed,budgetId:await budget()}));await work(legacy.id);const old=await call('operator','purchaseRead',{id:legacy.id});await call('agent','purchaseReceive',{id:legacy.id,revision:old.revision,orderOperationId:old.order.operationId,note:'旧数量不明の独立検収'});
 const oldInvoice={...body,id:randomUUID(),number:'legacy-unknown',purchaseId:legacy.id},result=await call('operator','invoiceImport',oldInvoice);assert.equal(result.state,'QUARANTINED');assert.ok(result.reasons.includes('RECEIPT_NOT_ELIGIBLE'));await rejected(()=>call('operator','paymentRequest',request(oldInvoice.id)),'INVALID_STATE');assert.equal(e.payments.requests().length,0);
 evidence('invoice-receipt-gate',{quarantined,matched,legacy:await call('operator','invoiceRead',{id:oldInvoice.id}),noPayments:e.payments.requests()});
}));

test('failure-recovery approval SQL rollback fence and payment operation destination separation reject corrupted events without sending',()=>scenario(async e=>{
 const {execFileSync}=await import('node:child_process'),{f,cluster,call,body,request,approve,work}=e;await call('operator','invoiceImport',body);const b=request();await call('operator','paymentRequest',b);
 const schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],path=cluster.directory+'/invoice-unapproved.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);await approve(b);
 const complete=cluster.directory+'/invoice-approved.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+complete]);await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});restart(f);
 await rejected(()=>f.call('operator','paymentRead',{id:b.id}),'RECOVERING');await rejected(()=>f.call('manager','vote',{id:b.id,revision:1,decision:'APPROVE'}),'RECOVERING');
 await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+complete],{stdio:'pipe'});restart(f);
 const before=await f.call('operator','paymentRead',{id:b.id}),original=(await f.owner.query('SELECT event FROM outbox WHERE operation_id=$1',[before.operation.id])).rows[0].event;
 // Deliberate transport corruption only; no business success is created by SQL.
 for(const delta of [{operationKind:'purchase-order'},{destination:'local-synthetic-order'}]){
  const event={...original,...delta};await f.owner.query('UPDATE outbox SET event=$2,digest=$3 WHERE operation_id=$1',[before.operation.id,event,digest(event)]);await rejected(()=>f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},e.port),'PERMISSION_DENIED');assert.equal(e.payments.requests().length,0);assert.equal(e.effects.requests().filter(x=>x.method==='POST').length,1);
 }
 await f.owner.query('UPDATE outbox SET event=$2,digest=$3 WHERE operation_id=$1',[before.operation.id,original,digest(original)]);assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},e.port)).state,'SUCCEEDED');
 evidence('invoice-operation-approval-fence',{before,approvalSQLRestoreFenced:true,wrongOperationAndDestinationRejected:true,requests:e.payments.requests(),ledger:await e.payments.ledger()});
}));

test('failure-recovery invoice witnesses coexist with committed authority change acknowledgement loss and current revocation recovery',()=>scenario(async e=>{
 const {f,body,call}=e;await call('operator','invoiceImport',body);
 f.kernel.fault=async p=>{if(p==='enterprise-after-commit')throw Error('grant response lost');};await rejected(()=>f.call('publisher','grant',{principal:'reader',scopes:[scope],operations:['read','search'],fields:['INTERNAL']}),'UNAVAILABLE');f.kernel.fault=async()=>{};assert.ok(f.kernel.journal.fenced());
 const recovered=await f.kernel.enterpriseRecover(f.credentials.manager);assert.equal(recovered.recovered.length,1);assert.equal(f.kernel.journal.fenced(),false);assert.equal((await f.call('operator','invoiceRead',{id:body.id})).state,'MATCHED');await rejected(()=>f.call('reader','invoiceRead',{id:body.id}),'PERMISSION_DENIED');
 evidence('invoice-authority-commit-recovery',{recovered,invoice:await f.call('operator','invoiceRead',{id:body.id}),readerStillDenied:true});
}));

test('positive reproducible local startup publishes exact independently reviewed invoice and quantity packages and synthetic seed',async()=>{
 const {spawn}=await import('node:child_process'),argv=['scripts/enterprise/invoice-local.mjs'],startedAt=new Date().toISOString(),child=spawn(process.execPath,argv,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);const exited=new Promise(resolve=>child.on('exit',(code,signal)=>resolve({code,signal})));let config;
 try{
  config=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout '+stderr)),30000);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);if(!config)reject(Error('startup exited '+code+' '+stderr));});child.stdout.on('data',()=>{try{const row=JSON.parse(stdout.trim().split('\n').at(-1));if(row.url){clearTimeout(timer);resolve(row);}}catch{}});});
  assert.equal(config.syntheticOnly,true);const client=await login({gateway:{origin:new URL(config.url).origin}},'operator');
  const response=await client.api('query',{packageId:'enterprise-invoice',type:'InvoicePayment'});assert.equal(response.status,200);assert.deepEqual((await response.json()).result,{items:[]});
  const resource=await client.api('assuranceRead',{id:config.purchasing.budgetId});assert.equal(resource.status,200);assert.equal((await resource.json()).result.data.capacity,2000);assert.equal(config.purchasing.supplierIds.length,3);
 }finally{child.kill('SIGTERM');const exit=await exited;evidence('invoice-startup',{argv:[process.execPath,...argv],startedAt,finishedAt:new Date().toISOString(),stdout,stderr,config,exit});assert.equal(exit.code,0,stderr);}
});
