import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {withFixture,restart} from './helpers.mjs';
import {seedProcurement,comparePurchase,approvePurchase,scope} from './procurement-helper.mjs';
import {referenceEffects} from '../../scripts/enterprise/reference/effects.mjs';
import {SyntheticPort} from '../../src/enterprise/worker.mjs';
import {evidence} from './assurance-helper.mjs';
import {hash,validateApproval} from '../../scripts/enterprise/evidence.mjs';
const reject=(fn,code)=>assert.rejects(fn,{code});
const read=(f,id)=>f.call('operator','purchaseRead',{id});

test('ENT-201 AC-01 public API purchase comparison approval order and independent receipt',t=>withFixture(async(f,cluster)=>{
 const seed=await seedProcurement(f),b=await comparePurchase(f,seed);assert.equal(b.revision,4);
 assert.equal((await read(f,b.id)).state,'COMPARED');await approvePurchase(f,b);
 const budget=await f.call('manager','assuranceRead',{id:seed.budgetId});assert.equal(budget.data.reserved,1200);assert.equal(budget.data.reservations[0].reference,b.id);
 const effects=await referenceEffects(cluster),port=new SyntheticPort(effects.url);
 try{
  assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},port)).state,'SUCCEEDED');
  const record=await read(f,b.id);assert.equal(record.state,'ORDER_CONFIRMED');
  await reject(()=>f.call('operator','resourceRelease',{id:seed.budgetId,reference:b.id}),'INVALID_STATE');
  assert.equal((await effects.ledger())[0].payload.fields.supplierId,seed.supplierIds[0]);assert.equal((await effects.ledger())[0].payload.fields.quoteId,'quote-0');
  const body={id:b.id,revision:b.revision,orderOperationId:record.order.operationId,note:'Synthetic full delivery inspected'};
  await reject(()=>f.call('operator','purchaseReceive',body),'PERMISSION_DENIED');await reject(()=>f.call('manager','purchaseReceive',body),'PERMISSION_DENIED');
  const key=randomUUID(),received=await f.call('agent','purchaseReceive',body,key);
  await t.test('positive independent receipt is idempotent and cannot be registered twice',async()=>{
   assert.equal(received.state,'RECEIVED');assert.deepEqual(await f.call('agent','purchaseReceive',body,key),received);
   await reject(()=>f.call('agent','purchaseReceive',{...body,revision:received.revision}),'INVALID_STATE');
  });
  await t.test('persistence receipt survives restart',async()=>{
   restart(f);assert.equal((await read(f,b.id)).state,'RECEIVED');
  });
  const audit=await f.call('manager','auditExport',{id:b.id});for(const op of ['purchaseCreate','purchaseQuote','purchaseSelect','vote','purchaseReceive'])assert.ok(audit.events.some(e=>e.record.operation===op),op);
  assert.ok(audit.events.some(e=>e.record.kind==='EnterpriseExternalObserved'));assert.equal((await effects.ledger())[0].applications,1);
  evidence('api-complete',{record:await read(f,b.id),budget,audit,ledger:await effects.ledger(),requests:effects.requests()});
 }finally{await effects.close();}
}));

test('ENT-201 AC-02 amounts currency related parties self proxy approval and public bypass rejected',t=>withFixture(async f=>{
 const seed=await seedProcurement(f),id='purchase-'+randomUUID();let result=await f.call('operator','purchaseCreate',{id,scope,title:'Negative synthetic',currency:'JPY',budgetId:seed.budgetId});
 const quote={id,revision:result.revision,quoteId:'q1',supplierId:seed.supplierIds[0],amount:1200,currency:'JPY'};
 for(const amount of [-1,0,0.1,Number.MAX_SAFE_INTEGER+1])await reject(()=>f.call('operator','purchaseQuote',{...quote,amount}),'INVALID_ARGUMENT');
 await reject(()=>f.call('operator','purchaseQuote',{...quote,currency:'USD'}),'INVALID_ARGUMENT');await reject(()=>f.call('operator','purchaseQuote',{...quote,supplierId:seed.supplierIds[2]}),'PERMISSION_DENIED');
 await reject(()=>f.call('manager','vote',{id,revision:1,decision:'APPROVE'}),'INVALID_STATE');
 result=await f.call('operator','purchaseQuote',quote);await reject(()=>f.call('operator','purchaseQuote',{...quote,revision:result.revision,quoteId:'duplicate-supplier'}),'CONFLICT');
 await reject(()=>f.call('operator','purchaseSelect',{id,revision:result.revision,quoteId:'q1',reason:'Only one supplier'}),'INVALID_STATE');
 const b=await comparePurchase(f,seed,{},'manager');await reject(()=>f.call('manager','vote',{id:b.id,revision:b.revision,decision:'APPROVE'}),'PERMISSION_DENIED');
 await f.call('manager','delegate',{id:'proxy',actor:'agent',scopes:[scope],operations:['approve'],expires:new Date(Date.now()+60000).toISOString()});
 await reject(()=>f.kernel.enterprise({...f.credentials.agent,delegationId:'proxy'},{operation:'vote',key:randomUUID(),body:{id:b.id,revision:b.revision,decision:'APPROVE'}}),'PERMISSION_DENIED');
 const normal=await comparePurchase(f,seed);await f.call('manager','vote',{id:normal.id,revision:normal.revision,decision:'APPROVE'});
 const record=await read(f,normal.id);await reject(()=>f.call('operator','edit',{id:normal.id,revision:normal.revision,fields:{...record.fields,amount:1}}),'PERMISSION_DENIED');
 await reject(()=>f.call('operator','purchaseQuote',{...quote,id:normal.id,revision:normal.revision}),'PERMISSION_DENIED');
 await reject(()=>f.call('operator','create',{id:randomUUID(),scope,packageId:'enterprise-procurement',fields:record.fields}),'UNSUPPORTED_CAPABILITY');
 await t.test('negative-authorization out-of-scope and unauthorized callers cannot read purchase',async()=>{
  for(const who of ['other','tenant2'])await reject(()=>f.call(who,'purchaseRead',{id:normal.id}),'NOT_FOUND');
  await reject(()=>f.call('reader','purchaseRead',{id:normal.id}),'PERMISSION_DENIED');
 });
}));

test('ENT-201 AC-02 final approvals compete atomically for budget and order is unique across keys',()=>withFixture(async(f,cluster)=>{
 const seed=await seedProcurement(f),a=await comparePurchase(f,seed),b=await comparePurchase(f,seed);
 for(const item of [a,b])for(const who of ['manager','reviewer'])await f.call(who,'vote',{id:item.id,revision:item.revision,decision:'APPROVE'});
 const results=await Promise.allSettled([a,b].map(item=>f.call('publisher','vote',{id:item.id,revision:item.revision,decision:'APPROVE'})));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'PERMISSION_DENIED');
 const winner=results[0].status==='fulfilled'?a:b,loser=winner===a?b:a;
 assert.equal((await read(f,loser.id)).workflow.stage,1);assert.equal((await f.call('manager','assuranceRead',{id:seed.budgetId})).data.reserved,1200);
 const effects=await referenceEffects(cluster),port=new SyntheticPort(effects.url);
 try{
  const command={id:winner.id,revision:winner.revision,decision:'APPROVE'};
  await reject(()=>f.call('publisher','vote',command),'INVALID_STATE');
  await Promise.all([1,2].map(()=>f.kernel.enterpriseWork(f.credentials.manager,{id:winner.id,mode:'dispatch'},port)));
  assert.equal((await effects.ledger()).length,1);assert.equal((await effects.ledger())[0].applications,1);assert.equal(effects.requests().filter(x=>x.method==='POST').length,1);
  evidence('budget-race',{results:results.map(r=>({status:r.status,code:r.reason?.code})),winner:winner.id,ledger:await effects.ledger()});
 }finally{await effects.close();}
}));

test('ENT-201 AC-03 audit rollback commit response loss restart and replay mismatch',t=>withFixture(async f=>{
 const seed=await seedProcurement(f),b=await comparePurchase(f,seed);
 for(const who of ['manager','reviewer'])await f.call(who,'vote',{id:b.id,revision:b.revision,decision:'APPROVE'});
 const body={id:b.id,revision:b.revision,decision:'APPROVE'},key=randomUUID();
 f.kernel.fault=async p=>{if(p==='enterprise-before-audit')throw Error('injected audit failure');};await reject(()=>f.call('publisher','vote',body,key),'UNAVAILABLE');f.kernel.fault=async()=>{};
 assert.equal((await read(f,b.id)).workflow.state,'WAITING_APPROVAL');assert.equal((await f.call('manager','assuranceRead',{id:seed.budgetId})).data.reserved,0);
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM outbox WHERE aggregate_id=$1',[b.id])).rows[0].n,0);
 await f.owner.query('REVOKE INSERT ON audit FROM foundation_app');await reject(()=>f.call('publisher','vote',body,key),'UNAVAILABLE');await f.owner.query('GRANT INSERT ON audit TO foundation_app');
 assert.equal((await read(f,b.id)).workflow.state,'WAITING_APPROVAL');assert.equal((await f.call('manager','assuranceRead',{id:seed.budgetId})).data.reserved,0);
 await t.test('failure-recovery lost response reconciles the original reservation and fences changed replay',async()=>{
  f.kernel.fault=async p=>{if(p==='enterprise-after-commit')throw Error('lost commit response');};await reject(()=>f.call('publisher','vote',body,key),'UNAVAILABLE');restart(f);
  await reject(()=>f.call('publisher','vote',body,key),'INCONSISTENT_STATE');await f.kernel.enterpriseRecover(f.credentials.manager);
  assert.equal((await f.call('publisher','vote',body,key)).state,'READY');await reject(()=>f.call('publisher','vote',{...body,decision:'RETURN'},key),'IDEMPOTENCY_MISMATCH');
  assert.equal((await f.call('manager','assuranceRead',{id:seed.budgetId})).data.reserved,1200);
 });
 evidence('commit-recovery',{record:await read(f,b.id),audit:await f.call('manager','auditExport',{id:b.id})});
}));

test('ENT-201 AC-03 lost external acknowledgement reconciles once and ABSENT never auto resends',()=>withFixture(async(f,cluster)=>{
 const seed=await seedProcurement(f),b=await approvePurchase(f,await comparePurchase(f,seed)),effects=await referenceEffects(cluster),port=new SyntheticPort(effects.url);
 try{
  effects.fault('lost-ack');assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},port)).state,'UNKNOWN');restart(f);
  await reject(()=>f.call('operator','resourceRelease',{id:seed.budgetId,reference:b.id}),'INVALID_STATE');
  await reject(()=>f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},port),'INVALID_STATE');
  assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'reconcile'},port)).state,'SUCCEEDED');assert.equal((await effects.ledger())[0].applications,1);
  const seed2={...seed,budgetId:'extra-'+randomUUID()};await f.call('manager','resourceCreate',{id:seed2.budgetId,scope,currency:'JPY',unit:'minor',capacity:2000,threshold:2000,periodEnd:'2099-01-01T00:00:00Z',calculationVersion:'integer-v1'});
  const absent=await approvePurchase(f,await comparePurchase(f,seed2));f.kernel.fault=async p=>{if(p==='enterprise-before-send')throw Error('crash before send');};
  assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:absent.id,mode:'dispatch'},port)).state,'UNKNOWN');restart(f);
  const observed=await f.kernel.enterpriseWork(f.credentials.manager,{id:absent.id,mode:'reconcile'},port);assert.equal(observed.observation,'ABSENT');assert.equal(observed.requiresHumanReview,true);
  await reject(()=>f.kernel.enterpriseWork(f.credentials.manager,{id:absent.id,mode:'dispatch'},port),'INVALID_STATE');assert.equal((await effects.ledger()).length,1);
  evidence('external-recovery',{record:await read(f,b.id),absent:observed,ledger:await effects.ledger(),requests:effects.requests()});
 }finally{await effects.close();}
}));

test('ENT-201 AC-03 revoked authority released budget and deadline prohibit dispatch',()=>withFixture(async(f,cluster)=>{
 const seed=await seedProcurement(f),b=await approvePurchase(f,await comparePurchase(f,seed)),effects=await referenceEffects(cluster),port=new SyntheticPort(effects.url);
 try{
  const work=()=>f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},port);
  await f.call('publisher','grant',{principal:'reviewer',scopes:[],operations:[],fields:[]});await reject(work,'PERMISSION_DENIED');
  // Restore via the public grant contract; the revision change still invalidates the old approval.
  await f.call('publisher','grant',{principal:'reviewer',scopes:[scope],operations:['read','search','action','approve','worker','recovery','author','review','publish','records','audit','connect'],fields:['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED']});await reject(work,'STALE_APPROVAL');
  assert.equal((await effects.ledger()).length,0);
 }finally{await effects.close();}
}));

test('ENT-201 AC-03 public reservation release and expired approval fail closed',()=>withFixture(async(f,cluster)=>{
 const seed=await seedProcurement(f),b=await approvePurchase(f,await comparePurchase(f,seed)),effects=await referenceEffects(cluster),port=new SyntheticPort(effects.url);
 try{
  f.kernel.clock=()=>Date.now()+10*86400000;await reject(()=>f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},port),'INVALID_STATE');f.kernel.clock=Date.now;
  await f.call('operator','resourceRelease',{id:seed.budgetId,reference:b.id});await reject(()=>f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},port),'INVALID_STATE');assert.equal((await effects.ledger()).length,0);
 }finally{await effects.close();}
}));

test('ENT-201 AC-03 real worker process death after order application reconciles without resending',()=>withFixture(async(f,cluster)=>{
 const {spawn}=await import('node:child_process');const seed=await seedProcurement(f),b=await approvePurchase(f,await comparePurchase(f,seed)),effects=await referenceEffects(cluster);
 const child=(mode,crash)=>new Promise((resolve,reject)=>{
  const processChild=spawn(process.execPath,['tests/enterprise/worker-child.mjs'],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';processChild.stdout.on('data',x=>stdout+=x);processChild.stderr.on('data',x=>stderr+=x);processChild.on('error',reject);processChild.on('close',code=>resolve({code,stdout,stderr}));
  const {host,port,user,database,options}=f.state.pool.options;processChild.stdin.end(JSON.stringify({config:{host,port,user,database,options},journal:f.journal.path,credential:f.credentials.manager,id:b.id,mode,url:effects.url,crash}));
 });
 try{
  const crashed=await child('dispatch','enterprise-after-send');assert.equal(crashed.code,73,crashed.stderr);restart(f);assert.equal((await read(f,b.id)).state,'UNKNOWN');
  // Recovery observes the committed external effect despite revoked historical authority.
  await f.call('publisher','grant',{principal:'reviewer',scopes:[],operations:[],fields:[]});
  const reconciled=await child('reconcile');assert.equal(reconciled.code,0,reconciled.stderr);assert.equal(JSON.parse(reconciled.stdout).state,'SUCCEEDED');
  assert.equal((await effects.ledger())[0].applications,1);assert.deepEqual(effects.requests().map(r=>r.method),['POST','GET']);
  evidence('process-death',{crashed,reconciled,record:await read(f,b.id),ledger:await effects.ledger(),requests:effects.requests()});
 }finally{await effects.close();}
}));

test('ENT-201 AC-03 real SQL restore fences missing reservation purchase and receipt evidence',()=>withFixture(async(f,cluster)=>{
 const {execFileSync}=await import('node:child_process');const seed=await seedProcurement(f);
 const schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database];
 const dump=name=>{const path=cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};
 const restore=async path=>{await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});restart(f);};
 const beforePurchase=dump('before-purchase'),b=await comparePurchase(f,seed);
 for(const who of ['manager','reviewer'])await f.call(who,'vote',{id:b.id,revision:b.revision,decision:'APPROVE'});
 const beforeFinal=dump('before-final');const body={id:b.id,revision:b.revision,decision:'APPROVE'},key=randomUUID();
 f.kernel.fault=async p=>{if(p==='enterprise-after-commit')throw Error('commit response lost');};await reject(()=>f.call('publisher','vote',body,key),'UNAVAILABLE');const committed=dump('committed');
 await restore(beforeFinal);const journal=JSON.stringify(f.kernel.journal.records());await reject(()=>f.kernel.enterpriseRecover(f.credentials.manager),'RECOVERING');assert.equal(JSON.stringify(f.kernel.journal.records()),journal);
 await reject(()=>f.call('manager','assuranceRead',{id:seed.budgetId}),'RECOVERING');
 await restore(committed);await f.kernel.enterpriseRecover(f.credentials.manager);await f.call('publisher','vote',body,key);
 const effects=await referenceEffects(cluster),port=new SyntheticPort(effects.url);
 try{
  assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},port)).state,'SUCCEEDED');const record=await read(f,b.id),beforeReceipt=dump('before-receipt');
  await f.call('agent','purchaseReceive',{id:b.id,revision:b.revision,orderOperationId:record.order.operationId,note:'Synthetic independent delivery'});const complete=dump('complete');
  await restore(beforeReceipt);await reject(()=>read(f,b.id),'RECOVERING');
  await restore(beforePurchase);await reject(()=>f.call('operator','purchaseCreate',{id:b.id,scope,title:b.title,currency:'JPY',budgetId:seed.budgetId}),'RECOVERING');
  await restore(complete);assert.equal((await read(f,b.id)).state,'RECEIVED');assert.equal((await effects.ledger())[0].applications,1);
  // Diagnostic failure for SQL metadata corruption, rather than success inferred from workflow state.
  await f.owner.query("UPDATE enterprise_procurement SET data=data||'{\"receipt\":null}'::jsonb WHERE id=$1",[b.id]);await reject(()=>read(f,b.id),'RECOVERING');
  evidence('restore',{realSchemaDumpRestore:true,missingFinalActionFenced:true,missingReservationFenced:true,missingPurchaseFenced:true,missingReceiptFenced:true,sqlTamperFenced:true,ledger:await effects.ledger()});
 }finally{await effects.close();}
}));


test('ENT-201 AC-03 return cancellation expiry and package bypass are explicit',()=>withFixture(async f=>{
 const seed=await seedProcurement(f),returned=await comparePurchase(f,seed);
 assert.equal((await f.call('manager','vote',{id:returned.id,revision:returned.revision,decision:'RETURN'})).state,'RETURNED');
 assert.equal((await read(f,returned.id)).state,'RETURNED');assert.equal((await f.call('operator','cancel',{id:returned.id})).state,'CANCELLED');
 const expired=await comparePurchase(f,seed);f.kernel.clock=()=>Date.now()+10*86400000;
 await reject(()=>f.call('manager','vote',{id:expired.id,revision:expired.revision,decision:'APPROVE'}),'INVALID_STATE');
 assert.deepEqual((await f.call('manager','tick')).expired,[expired.id]);assert.equal((await read(f,expired.id)).state,'EXPIRED');
 f.kernel.clock=Date.now;
 const {procurementManifest}=await import('../../src/enterprise/procurement.mjs'),malicious=structuredClone(procurementManifest);malicious.version='1.0.1';malicious.route=[{approvers:['operator'],quorum:1}];
 await reject(()=>f.call('manager','install',{manifest:malicious}),'UNSUPPORTED_VERSION');
 const related='approver-related-'+randomUUID();await f.call('publisher','supplierCreate',{id:related,scope,name:'Related to approval reviewer',relatedSubjects:['reviewer']});
 const b={id:'purchase-'+randomUUID(),scope,title:'Related approver',currency:'JPY',budgetId:seed.budgetId};let result=await f.call('operator','purchaseCreate',b);
 for(const [index,supplierId] of [seed.supplierIds[0],related].entries())result=await f.call('operator','purchaseQuote',{id:b.id,revision:result.revision,quoteId:'q'+index,supplierId,amount:1200+index,currency:'JPY'});
 result=await f.call('operator','purchaseSelect',{id:b.id,revision:result.revision,quoteId:'q0',reason:'Cheaper'});
 await f.call('manager','vote',{id:b.id,revision:result.revision,decision:'APPROVE'});await reject(()=>f.call('reviewer','vote',{id:b.id,revision:result.revision,decision:'APPROVE'}),'PERMISSION_DENIED');
}));

test('ENT-201 R1 pre-send SQL restore retains external intent fence and reserved budget',()=>withFixture(async(f,cluster)=>{
 const {execFileSync}=await import('node:child_process');
 const seed=await seedProcurement(f),b=await approvePurchase(f,await comparePurchase(f,seed));
 const schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database];
 const dump=name=>{const path=cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};
 const restore=async path=>{await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});restart(f);};
 const ready=dump('R1-ready'),effects=await referenceEffects(cluster),port=new SyntheticPort(effects.url);
 try{
  assert.equal((await read(f,b.id)).state,'ORDER_READY');
  assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},port)).state,'SUCCEEDED');
  const sent=dump('R1-sent');assert.equal((await effects.ledger())[0].applications,1);
  await restore(ready);const journal=JSON.stringify(f.kernel.journal.records());
  const probes=[];const fenced=async(label,fn)=>{await reject(fn,'RECOVERING');probes.push({label,code:'RECOVERING'});};
  await fenced('purchaseRead',()=>read(f,b.id));
  await fenced('generic get',()=>f.call('operator','get',{id:b.id}));
  await fenced('query',()=>f.call('operator','query',{packageId:'enterprise-procurement',type:'PurchaseRequest'}));
  await fenced('resourceRelease',()=>f.call('operator','resourceRelease',{id:seed.budgetId,reference:b.id}));
  await fenced('dispatch',()=>f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},port));
  await fenced('reconcile',()=>f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'reconcile'},port));
  assert.equal((await f.call('manager','assuranceRead',{id:seed.budgetId})).data.reserved,1200);
  assert.deepEqual(effects.requests().map(x=>x.method),['POST']);
  // Rejected new commands append submission ABORTED records but cannot remove the intent.
  assert.ok(f.kernel.journal.records().length>=JSON.parse(journal).length);
  await restore(sent);assert.equal((await read(f,b.id)).state,'ORDER_CONFIRMED');
  const record=await read(f,b.id);await f.call('agent','purchaseReceive',{id:b.id,revision:b.revision,orderOperationId:record.order.operationId,note:'R1 full delivery after trusted SQL recovery'});
  assert.equal((await read(f,b.id)).state,'RECEIVED');assert.equal((await effects.ledger())[0].applications,1);
  evidence('R1-restore',{realSchemaDumpRestore:true,probes,reserved:1200,ledger:await effects.ledger(),requests:effects.requests(),record:await read(f,b.id)});
 }finally{await effects.close();}
}));

const strictScope={...scope,classification:'STRICT'};
test('ENT-201 R2 STRICT scope enforces detail list aggregate generic replay and worker classification',()=>withFixture(async(f,cluster)=>{
 const seed=await seedProcurement(f,f.call,strictScope),b=await comparePurchase(f,seed);
 const query={packageId:'enterprise-procurement',type:'PurchaseRequest'};
 const all=['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'];
 const grant=(principal,fields,operations=['read','search','action'])=>f.call('publisher','grant',{principal,scopes:[strictScope],operations,fields});
 await grant('reader',all,['read','search']);
 assert.equal((await f.call('reader','purchaseRead',{id:b.id})).id,b.id);assert.equal((await f.call('reader','query',query)).items.length,1);
 const command={id:b.id,revision:b.revision,quoteId:'quote-0',reason:'Current classified replay'};const key=randomUUID(),selected=await f.call('operator','purchaseSelect',command,key);
 await grant('reader',['CONFIDENTIAL'],['read','search']);
 const probes=[];
 await reject(()=>f.call('reader','propose',{id:b.id,projection:['title'],purpose:'summary',maxCost:1}),'PERMISSION_DENIED');probes.push('propose');
 for(const operation of ['purchaseRead','get','history','auditExport']){
  const who=operation==='auditExport'?'operator':'reader';
  if(who==='operator')await grant('operator',['CONFIDENTIAL'],['read','search','action','audit']);
  await reject(()=>f.call(who,operation,{id:b.id}),'PERMISSION_DENIED');probes.push(operation);
 }
 for(const body of [query,{...query,projection:['title'],search:{field:'title',text:b.title}},{...query,export:true}])assert.deepEqual(await f.call('reader','query',body),{items:[]});
 assert.deepEqual(await f.call('reader','query',{...query,aggregate:true}),{count:0});
 await reject(()=>f.call('operator','purchaseSelect',command,key),'PERMISSION_DENIED');restart(f);
 await reject(()=>f.call('operator','purchaseSelect',command,key),'PERMISSION_DENIED');
 await grant('operator',all);assert.deepEqual(await f.call('operator','purchaseSelect',command,key),selected);
 // A valid classified purchase can still progress through the existing approvals.
 const current=await approvePurchase(f,await comparePurchase(f,seed));const effects=await referenceEffects(cluster),port=new SyntheticPort(effects.url);
 try{
  const ops=['read','search','worker','recovery'];
  await grant('reader',['CONFIDENTIAL'],ops);
  await reject(()=>f.kernel.enterpriseWork(f.credentials.reader,{id:current.id,mode:'dispatch'},port),'PERMISSION_DENIED');assert.equal((await effects.ledger()).length,0);
  await grant('reader',all,ops);assert.equal((await f.kernel.enterpriseWork(f.credentials.reader,{id:current.id,mode:'dispatch'},port)).state,'SUCCEEDED');
  await grant('reader',['CONFIDENTIAL'],ops);
  for(const mode of ['dispatch','reconcile'])await reject(()=>f.kernel.enterpriseWork(f.credentials.reader,{id:current.id,mode},port),'PERMISSION_DENIED');
  assert.equal((await effects.ledger())[0].applications,1);assert.deepEqual(effects.requests().map(x=>x.method),['POST']);
  f.kernel.clock=()=>Date.now()+10*86400000;assert.deepEqual((await f.call('reader','tick')).expired,[]);f.kernel.clock=Date.now;
  evidence('R2-classification',{scope:strictScope,probes,queryHidden:true,aggregate:0,replayDeniedAfterRestart:true,restoredReplay:selected,terminalWorkerReplayDenied:true,ledger:await effects.ledger(),externalRequests:effects.requests()});
 }finally{await effects.close();}
},{enterpriseScopes:[scope,strictScope]}));

test('ENT-201 AC-04 canonical gate rejects missing, same-session, stale and wrong-scope approval',async()=>{
 const run={id:'synthetic-test-only',inputs:{digest:hash('current')},implementationSession:'implementation',suites:[{stdoutHash:hash('passing output')}]};
 const issueIds=['ENT-201'];
 const review={verdict:'APPROVE',session:'different-session',inputsDigest:run.inputs.digest,
  receiptHash:hash(JSON.stringify(run)),issueIds};
 const verify=(approval,receipt=run)=>validateApproval(process.cwd(),approval,receipt,issueIds);
 await assert.rejects(verify(undefined),/independent approval required/);
 await assert.rejects(verify({...review,session:run.implementationSession}),/separate reviewer session required/);
 await assert.rejects(verify(review,{...run,inputs:{digest:hash('changed inputs')}}),/stale review source/);
 await assert.rejects(verify(review,{...run,suites:[{stdoutHash:hash('changed output')}]}),/stale review receipt/);
 await assert.rejects(verify({...review,issueIds:['ENT-202']}),/review scope/);
 const report='tests/enterprise/ENT-201.test.mjs';
 await assert.rejects(verify({...review,report,reportHash:hash('changed report')}),/changed review report/);
 // Exact receipt and report hashes alone cannot authenticate a reviewer.
 await assert.rejects(verify({...review,report,reportHash:hash(readFileSync(new URL(import.meta.url)))}),/single enterprise batch attestation required/);
});
