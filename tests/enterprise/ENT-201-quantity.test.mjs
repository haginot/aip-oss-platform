import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {withFixture,restart} from './helpers.mjs';
import {seedQuantity,publishQuantity,purchaseBody,compareQuantity,approvePurchase,receiptBody,scope} from './quantity-helper.mjs';
import {seedProcurement,comparePurchase} from './procurement-helper.mjs';
import {procurementQuantityManifest} from '../../src/enterprise/procurement.mjs';
import {digest} from '../../src/contracts.mjs';
import {referenceEffects} from '../../scripts/enterprise/reference/effects.mjs';
import {SyntheticPort} from '../../src/enterprise/worker.mjs';
import {evidence} from './assurance-helper.mjs';
const reject=(fn,code)=>assert.rejects(fn,{code});
const read=(f,id,who='operator')=>f.call(who,'purchaseRead',{id});
const work=(f,b,port,mode='dispatch')=>f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode},port);

// All business setup and operations use public Kernel commands. SQL below is
// restricted to the existing audit fault and actual dump/restore counterexamples.
test('positive quantity selection binds approval Action Outbox ledger and independent full receipt',()=>withFixture(async(f,cluster)=>{
 const seed=await seedQuantity(f),b=await compareQuantity(f,seed),before=await read(f,b.id);
 assert.deepEqual(before.quantityContract,{status:'KNOWN',requested:{quantity:7,unit:'台'},ordered:null,received:null,matchEligible:false});
 assert.equal(before.fields.quoteVersion,2);assert.equal(before.quotes.length,2);assert.deepEqual(before.quotes.map(q=>[q.quantity,q.unit,q.quoteVersion]),[[7,'台',2],[7,'台',3]]);
 await approvePurchase(f,b);const effects=await referenceEffects(cluster),port=new SyntheticPort(effects.url);
 try{
  assert.equal((await work(f,b,port)).state,'SUCCEEDED');const record=await read(f,b.id),ledger=await effects.ledger(),e=ledger[0].payload;
  assert.equal(ledger.length,1);assert.equal(ledger[0].applications,1);assert.equal(e.schemaVersion,'1.1.0');assert.equal(e.objectRevision,4);assert.equal(e.aggregateId,b.id);assert.equal(e.operationId,record.order.operationId);assert.equal(e.actionId,record.order.actionId);
  assert.deepEqual(e.fields,record.fields);assert.equal(e.fields.quantity,7);assert.equal(e.fields.unit,'台');assert.equal(e.fields.amount,1200);assert.equal(e.fields.currency,'JPY');assert.equal(e.fields.supplierId,seed.supplierIds[0]);assert.equal(e.fields.quoteId,'quantity-q0');assert.equal(e.fields.quoteVersion,2);assert.equal(record.order.payloadDigest,digest(e));assert.equal(record.package.digest,digest(procurementQuantityManifest));
  const result=await f.call('agent','purchaseReceive',receiptBody(b,record));assert.equal(result.state,'RECEIVED');
  const completed=await read(f,b.id);assert.deepEqual(completed.quantityContract,{status:'KNOWN',requested:{quantity:7,unit:'台'},ordered:{quantity:7,unit:'台'},received:{quantity:7,unit:'台'},matchEligible:true});
  assert.equal(completed.receipt.actor,'agent');assert.equal(completed.receipt.operationId,e.operationId);assert.equal(completed.receipt.actionId,e.actionId);assert.equal(completed.receipt.payloadDigest,digest(e));assert.equal(completed.receipt.packageDigest,completed.package.digest);assert.equal(completed.receipt.packageVersion,'1.1.0');assert.equal(completed.receipt.orderedRevision,e.objectRevision);assert.equal(completed.revision,e.objectRevision+1);
  const audit=await f.call('manager','auditExport',{id:b.id});for(const operation of ['purchaseCreate','purchaseQuote','purchaseSelect','vote','purchaseReceive'])assert.ok(audit.events.some(x=>x.record.operation===operation),operation);assert.ok(audit.events.some(x=>x.record.kind==='EnterpriseExternalObserved'));
  evidence('quantity-positive',{before,record:completed,ledger:await effects.ledger(),externalRequests:effects.requests(),audit,budget:await f.call('manager','assuranceRead',{id:seed.budgetId})});
 }finally{await effects.close();}
}));

test('failure-recovery invalid quantities units quote versions and mismatched specification are rejected without mutation',()=>withFixture(async f=>{
 const seed=await seedQuantity(f),b=purchaseBody(seed);
 for(const quantity of [0,-1,0.5,Number.MAX_SAFE_INTEGER+1,'7',null])await reject(()=>f.call('operator','purchaseCreate',{...b,quantity}),'INVALID_ARGUMENT');
 for(const unit of ['', ' ', ' 台', '台 ', 'x'.repeat(41),1,null])await reject(()=>f.call('operator','purchaseCreate',{...b,unit}),'INVALID_ARGUMENT');
 const {quantity,unit,...missing}=b;await reject(()=>f.call('operator','purchaseCreate',missing),'INVALID_ARGUMENT');
 for(const packageVersion of ['1.2.0',null,''])await reject(()=>f.call('operator','purchaseCreate',{...b,packageVersion}),'UNSUPPORTED_VERSION');
 await reject(()=>f.call('operator','purchaseCreate',{...b,packageVersion:'1.0.0'}),'INVALID_ARGUMENT');
 await f.call('operator','purchaseCreate',b);const before=await read(f,b.id),quote={id:b.id,revision:1,quoteId:'q',supplierId:seed.supplierIds[0],amount:1200,currency:'JPY',quantity:7,unit:'台',quoteVersion:2};
 for(const delta of [{quantity:6},{quantity:8},{quantity:'7'},{unit:'箱'},{unit:''},{quoteVersion:0},{quoteVersion:0.5},{quoteVersion:'2'},{quoteVersion:Number.MAX_SAFE_INTEGER+1},{currency:'USD'},{amount:0}])await reject(()=>f.call('operator','purchaseQuote',{...quote,...delta}),'INVALID_ARGUMENT');
 const {quoteVersion,...noVersion}=quote;await reject(()=>f.call('operator','purchaseQuote',noVersion),'INVALID_ARGUMENT');assert.deepEqual(await read(f,b.id),before);
 await f.call('operator','purchaseQuote',quote);await reject(()=>f.call('operator','purchaseSelect',{id:b.id,revision:2,quoteId:'q',reason:'one quote'}),'INVALID_STATE');
 const tampered=structuredClone(procurementQuantityManifest);tampered.route=[{approvers:['operator'],quorum:1}];await reject(()=>f.call('manager','install',{manifest:tampered}),'UNSUPPORTED_VERSION');
 // Safe integer boundary is accepted as a quantity, with no amount multiplication.
 const boundary=purchaseBody(seed,{quantity:Number.MAX_SAFE_INTEGER});await f.call('operator','purchaseCreate',boundary);assert.equal((await read(f,boundary.id)).fields.quantity,Number.MAX_SAFE_INTEGER);
 evidence('quantity-invalid',{unchanged:before,missingAndInvalidInputsRejected:true,boundary:await read(f,boundary.id)});
}));

test('negative-authorization current boundaries self proxy approval immutable approved specification and independent receipt',()=>withFixture(async(f,cluster)=>{
 const seed=await seedQuantity(f),self=await compareQuantity(f,seed,{},'manager');
 await reject(()=>f.call('manager','vote',{id:self.id,revision:self.revision,decision:'APPROVE'}),'PERMISSION_DENIED');
 await f.call('manager','delegate',{id:'quantity-proxy',actor:'agent',scopes:[scope],operations:['approve','action'],expires:new Date(Date.now()+60000).toISOString()});
 await reject(()=>f.kernel.enterprise({...f.credentials.agent,delegationId:'quantity-proxy'},{operation:'vote',key:randomUUID(),body:{id:self.id,revision:self.revision,decision:'APPROVE'}}),'PERMISSION_DENIED');
 const b=await compareQuantity(f,seed);await f.call('manager','vote',{id:b.id,revision:b.revision,decision:'APPROVE'});const record=await read(f,b.id);
 for(const delta of [{quantity:8},{unit:'箱'},{quoteVersion:3},{supplierId:seed.supplierIds[1]},{amount:1},{currency:'USD'}])await reject(()=>f.call('operator','edit',{id:b.id,revision:b.revision,fields:{...record.fields,...delta}}),'PERMISSION_DENIED');
 await reject(()=>f.call('operator','purchaseQuote',{id:b.id,revision:b.revision,quoteId:'extra',supplierId:seed.supplierIds[1],amount:1,currency:'JPY',quantity:7,unit:'台',quoteVersion:4}),'PERMISSION_DENIED');
 await reject(()=>f.call('operator','purchaseSelect',{id:b.id,revision:b.revision,quoteId:'quantity-q1',reason:'after approval'}),'PERMISSION_DENIED');
 for(const who of ['other','tenant2'])await reject(()=>read(f,b.id,who),'NOT_FOUND');await reject(()=>read(f,b.id,'reader'),'PERMISSION_DENIED');
 for(const who of ['reviewer','publisher'])await f.call(who,'vote',{id:b.id,revision:b.revision,decision:'APPROVE'});
 const effects=await referenceEffects(cluster),port=new SyntheticPort(effects.url);
 try{
  await work(f,b,port);const body=receiptBody(b,await read(f,b.id));
  for(const who of ['operator','manager','reviewer','publisher'])await reject(()=>f.call(who,'purchaseReceive',body),'PERMISSION_DENIED');
  await reject(()=>f.kernel.enterprise({...f.credentials.agent,delegationId:'quantity-proxy'},{operation:'purchaseReceive',key:randomUUID(),body}),'PERMISSION_DENIED');
  assert.equal((await read(f,b.id)).receipt,null);assert.equal((await effects.ledger())[0].payload.fields.quantity,7);
  evidence('quantity-authority',{record:await read(f,b.id),ledger:await effects.ledger(),immutableFields:record.fields});
 }finally{await effects.close();}
}));

test('failure-recovery partial excess invalid and wrong operation receipts never become success; races and replay remain unique',()=>withFixture(async(f,cluster)=>{
 const seed=await seedQuantity(f),b=await approvePurchase(f,await compareQuantity(f,seed)),effects=await referenceEffects(cluster),port=new SyntheticPort(effects.url);
 try{
  await Promise.all([work(f,b,port),work(f,b,port)]);assert.equal(effects.requests().filter(x=>x.method==='POST').length,1);
  const before=await read(f,b.id),body=receiptBody(b,before);
  for(const delta of [{receivedQuantity:0},{receivedQuantity:1},{receivedQuantity:6},{receivedQuantity:8},{receivedQuantity:-1},{receivedQuantity:0.5},{receivedQuantity:'7'},{receivedQuantity:Number.MAX_SAFE_INTEGER+1},{unit:'箱'}])await reject(()=>f.call('agent','purchaseReceive',{...body,...delta}),'INVALID_ARGUMENT');
  const {receivedQuantity,...missing}=body;await reject(()=>f.call('agent','purchaseReceive',missing),'INVALID_ARGUMENT');await reject(()=>f.call('agent','purchaseReceive',{...body,orderOperationId:randomUUID()}),'INVALID_STATE');assert.deepEqual(await read(f,b.id),before);
  const keys=[randomUUID(),randomUUID()],results=await Promise.allSettled(keys.map(k=>f.call('agent','purchaseReceive',body,k)));assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'CONFLICT');
  const index=results.findIndex(x=>x.status==='fulfilled'),received=results[index].value;assert.deepEqual(await f.call('agent','purchaseReceive',body,keys[index]),received);
  await reject(()=>f.call('agent','purchaseReceive',{...body,receivedQuantity:8},keys[index]),'IDEMPOTENCY_MISMATCH');await reject(()=>f.call('agent','purchaseReceive',{...body,revision:received.revision}),'INVALID_STATE');
  assert.equal((await read(f,b.id)).history.length,5);assert.equal((await effects.ledger())[0].applications,1);
  evidence('quantity-receipt-race',{before,results:results.map(x=>({status:x.status,code:x.reason?.code,result:x.value})),record:await read(f,b.id),ledger:await effects.ledger(),externalRequests:effects.requests()});
 }finally{await effects.close();}
}));

test('persistence new and legacy versions coexist without invented quantities or migrated approval history',()=>withFixture(async(f,cluster)=>{
 const seed=await seedProcurement(f),old=await comparePurchase(f,seed);await approvePurchase(f,old);const original=await read(f,old.id);
 await publishQuantity(f);const stillOld=await read(f,old.id);assert.deepEqual(stillOld,original);assert.equal(stillOld.package.version,'1.0.0');assert.deepEqual(stillOld.quantityContract,{status:'UNKNOWN',requested:null,ordered:null,received:null,matchEligible:false});assert.equal('quantity' in stillOld.fields,false);
 // A caller omitting packageVersion remains pinned to published 1.0.0 even after 1.1.0 publication.
 const legacy=await comparePurchase(f,seed);assert.equal((await read(f,legacy.id)).package.version,'1.0.0');
 const fresh=await compareQuantity(f,seed);assert.equal((await read(f,fresh.id)).package.version,'1.1.0');
 const effects=await referenceEffects(cluster),port=new SyntheticPort(effects.url);
 try{
  await work(f,old,port);const record=await read(f,old.id);await f.call('agent','purchaseReceive',{id:old.id,revision:record.revision,orderOperationId:record.order.operationId,note:'旧版全量受領・数量は記録なし'});
  const complete=await read(f,old.id);assert.equal(complete.state,'RECEIVED');assert.equal(complete.quantityContract.matchEligible,false);assert.equal('receivedQuantity' in complete.receipt,false);assert.equal('quantity' in (await effects.ledger())[0].payload.fields,false);restart(f);assert.deepEqual(await read(f,old.id),complete);
  assert.equal((await f.call('operator','query',{packageId:'enterprise-procurement',type:'PurchaseRequest'})).items.length,3);
  evidence('quantity-legacy',{original,complete,fresh:await read(f,fresh.id),ledger:await effects.ledger()});
 }finally{await effects.close();}
}));

test('persistence quantity receipt audit and exact idempotent result survive restart and classification revocation',()=>withFixture(async(f,cluster)=>{
 const seed=await seedQuantity(f),b=await approvePurchase(f,await compareQuantity(f,seed)),effects=await referenceEffects(cluster),port=new SyntheticPort(effects.url);
 try{
  await work(f,b,port);const body=receiptBody(b,await read(f,b.id)),key=randomUUID(),result=await f.call('agent','purchaseReceive',body,key),complete=await read(f,b.id);restart(f);assert.deepEqual(await read(f,b.id),complete);assert.deepEqual(await f.call('agent','purchaseReceive',body,key),result);
  const grant=fields=>f.call('publisher','grant',{principal:'agent',scopes:[scope],operations:['read','search','action'],fields});await grant(['INTERNAL']);
  for(const op of ['purchaseRead','get','history'])await reject(()=>f.call('agent',op,{id:b.id}),'PERMISSION_DENIED');await reject(()=>f.call('agent','purchaseReceive',body,key),'PERMISSION_DENIED');assert.deepEqual(await f.call('agent','query',{packageId:'enterprise-procurement',type:'PurchaseRequest',aggregate:true}),{count:0});
  restart(f);await reject(()=>f.call('agent','purchaseReceive',body,key),'PERMISSION_DENIED');await grant(['CONFIDENTIAL']);assert.deepEqual(await f.call('agent','purchaseReceive',body,key),result);
  evidence('quantity-persistence',{record:await read(f,b.id),audit:await f.call('manager','auditExport',{id:b.id}),ledger:await effects.ledger(),replay:result});
 }finally{await effects.close();}
}));

const strict={...scope,classification:'STRICT'};
test('negative-authorization quantity STRICT scope revoked read search aggregate replay and worker hide all data',()=>withFixture(async(f,cluster)=>{
 const seed=await seedQuantity(f,f.call,strict),b=await compareQuantity(f,seed),all=['CONFIDENTIAL','STRICT'];
 const grant=(principal,fields,operations=['read','search','action','worker','recovery'])=>f.call('publisher','grant',{principal,scopes:[strict],operations,fields});await grant('reader',all);assert.equal((await read(f,b.id,'reader')).fields.quantity,7);
 const body={id:b.id,revision:b.revision,quoteId:'quantity-q0',reason:'数量比較'},key=randomUUID();await f.call('operator','purchaseSelect',body,key);
 await grant('reader',['CONFIDENTIAL']);for(const op of ['purchaseRead','get','history'])await reject(()=>f.call('reader',op,{id:b.id}),'PERMISSION_DENIED');await reject(()=>f.call('reader','propose',{id:b.id,projection:['quantity'],purpose:'summary',maxCost:1}),'PERMISSION_DENIED');
 const query={packageId:'enterprise-procurement',type:'PurchaseRequest'};assert.deepEqual(await f.call('reader','query',query),{items:[]});assert.deepEqual(await f.call('reader','query',{...query,projection:['quantity'],search:{field:'unit',text:'台'},export:true}),{items:[]});assert.deepEqual(await f.call('reader','query',{...query,aggregate:true}),{count:0});
 await grant('operator',['CONFIDENTIAL']);await reject(()=>f.call('operator','purchaseSelect',body,key),'PERMISSION_DENIED');restart(f);await reject(()=>f.call('operator','purchaseSelect',body,key),'PERMISSION_DENIED');
 // Approval invalidation is checked separately from current field visibility.
 await grant('operator',all);const valid=await approvePurchase(f,await compareQuantity(f,seed));const effects=await referenceEffects(cluster),port=new SyntheticPort(effects.url);
 try{
  await reject(()=>f.kernel.enterpriseWork(f.credentials.reader,{id:valid.id,mode:'dispatch'},port),'PERMISSION_DENIED');assert.equal((await effects.ledger()).length,0);await grant('reader',all);assert.equal((await f.kernel.enterpriseWork(f.credentials.reader,{id:valid.id,mode:'dispatch'},port)).state,'SUCCEEDED');await grant('reader',['CONFIDENTIAL']);await reject(()=>f.kernel.enterpriseWork(f.credentials.reader,{id:valid.id,mode:'dispatch'},port),'PERMISSION_DENIED');
  evidence('quantity-strict',{queryHidden:true,aggregate:0,replayDenied:true,ledger:await effects.ledger(),externalRequests:effects.requests()});
 }finally{await effects.close();}
},{enterpriseScopes:[scope,strict]}));

test('failure-recovery audit rollback and commit response loss preserve quantity reservation and receipt atomically',()=>withFixture(async(f,cluster)=>{
 const seed=await seedQuantity(f),b=await compareQuantity(f,seed);for(const who of ['manager','reviewer'])await f.call(who,'vote',{id:b.id,revision:b.revision,decision:'APPROVE'});
 const final={id:b.id,revision:b.revision,decision:'APPROVE'},key=randomUUID();f.kernel.fault=async p=>{if(p==='enterprise-before-audit')throw Error('quantity audit failure');};await reject(()=>f.call('publisher','vote',final,key),'UNAVAILABLE');f.kernel.fault=async()=>{};
 assert.equal((await read(f,b.id)).workflow.state,'WAITING_APPROVAL');assert.equal((await f.call('manager','assuranceRead',{id:seed.budgetId})).data.reserved,0);
 await f.owner.query('REVOKE INSERT ON audit FROM foundation_app');await reject(()=>f.call('publisher','vote',final,key),'UNAVAILABLE');await f.owner.query('GRANT INSERT ON audit TO foundation_app');assert.equal((await f.call('manager','assuranceRead',{id:seed.budgetId})).data.reserved,0);
 f.kernel.fault=async p=>{if(p==='enterprise-after-commit')throw Error('quantity lost commit response');};await reject(()=>f.call('publisher','vote',final,key),'UNAVAILABLE');restart(f);await reject(()=>f.call('publisher','vote',final,key),'INCONSISTENT_STATE');await f.kernel.enterpriseRecover(f.credentials.manager);assert.equal((await f.call('publisher','vote',final,key)).state,'READY');
 const effects=await referenceEffects(cluster),port=new SyntheticPort(effects.url);
 try{
  await work(f,b,port);const before=await read(f,b.id),body=receiptBody(b,before),receiptKey=randomUUID();
  f.kernel.fault=async p=>{if(p==='enterprise-before-audit')throw Error('receipt audit failure');};await reject(()=>f.call('agent','purchaseReceive',body,receiptKey),'UNAVAILABLE');f.kernel.fault=async()=>{};assert.deepEqual(await read(f,b.id),before);
  f.kernel.fault=async p=>{if(p==='enterprise-after-commit')throw Error('receipt response lost');};await reject(()=>f.call('agent','purchaseReceive',body,receiptKey),'UNAVAILABLE');restart(f);await f.kernel.enterpriseRecover(f.credentials.manager);const received=await f.call('agent','purchaseReceive',body,receiptKey);assert.equal(received.receipt.receivedQuantity,7);assert.equal((await read(f,b.id)).history.length,5);assert.equal((await effects.ledger())[0].applications,1);
  evidence('quantity-audit-recovery',{before,record:await read(f,b.id),audit:await f.call('manager','auditExport',{id:b.id}),ledger:await effects.ledger()});
 }finally{await effects.close();}
}));

test('failure-recovery quantity UNKNOWN observes original operation only and ABSENT never auto resends',()=>withFixture(async(f,cluster)=>{
 const seed=await seedQuantity(f),b=await approvePurchase(f,await compareQuantity(f,seed)),effects=await referenceEffects(cluster),port=new SyntheticPort(effects.url);
 try{
  effects.fault('lost-ack');assert.equal((await work(f,b,port)).state,'UNKNOWN');const unknown=await read(f,b.id);assert.equal(unknown.quantityContract.ordered,null);await reject(()=>f.call('agent','purchaseReceive',receiptBody(b,unknown)),'INVALID_STATE');restart(f);await reject(()=>work(f,b,port),'INVALID_STATE');assert.equal((await work(f,b,port,'reconcile')).state,'SUCCEEDED');assert.equal((await read(f,b.id)).order.operationId,unknown.order.operationId);
  const seed2=await seedBudget(f,seed),absent=await approvePurchase(f,await compareQuantity(f,seed2));f.kernel.fault=async p=>{if(p==='enterprise-before-send')throw Error('pre-send crash');};assert.equal((await work(f,absent,port)).state,'UNKNOWN');restart(f);const observed=await work(f,absent,port,'reconcile');assert.equal(observed.observation,'ABSENT');assert.equal(observed.requiresHumanReview,true);await reject(()=>work(f,absent,port),'INVALID_STATE');assert.deepEqual(effects.requests().map(x=>x.method),['POST','GET','GET']);assert.equal((await effects.ledger()).length,1);assert.equal((await effects.ledger())[0].applications,1);
  evidence('quantity-unknown',{unknown,observed,record:await read(f,b.id),ledger:await effects.ledger(),externalRequests:effects.requests()});
 }finally{await effects.close();}
}));
async function seedBudget(f,seed){const budgetId='budget-extra-'+randomUUID();await f.call('manager','resourceCreate',{id:budgetId,scope:seed.scope,currency:'JPY',unit:'minor',capacity:2000,threshold:2000,periodEnd:'2099-01-01T00:00:00Z',calculationVersion:'integer-v1'});return {...seed,budgetId};}

test('failure-recovery quantity worker process death reconciles one immutable ledger application',()=>withFixture(async(f,cluster)=>{
 const seed=await seedQuantity(f),b=await approvePurchase(f,await compareQuantity(f,seed)),effects=await referenceEffects(cluster);
 const child=(mode,crash)=>new Promise((resolve,reject)=>{const processChild=spawn(process.execPath,['tests/enterprise/worker-child.mjs'],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';processChild.stdout.on('data',x=>stdout+=x);processChild.stderr.on('data',x=>stderr+=x);processChild.on('error',reject);processChild.on('close',code=>resolve({code,stdout,stderr}));const {host,port,user,database,options}=f.state.pool.options;processChild.stdin.end(JSON.stringify({config:{host,port,user,database,options},journal:f.journal.path,credential:f.credentials.manager,id:b.id,mode,url:effects.url,crash}));});
 try{
  const crashed=await child('dispatch','enterprise-after-send');assert.equal(crashed.code,73,crashed.stderr);restart(f);assert.equal((await read(f,b.id)).state,'UNKNOWN');const reconciled=await child('reconcile');assert.equal(reconciled.code,0,reconciled.stderr);assert.equal(JSON.parse(reconciled.stdout).state,'SUCCEEDED');assert.equal((await effects.ledger())[0].payload.fields.quantity,7);assert.equal((await effects.ledger())[0].applications,1);assert.deepEqual(effects.requests().map(x=>x.method),['POST','GET']);
  evidence('quantity-process-death',{crashed,reconciled,record:await read(f,b.id),ledger:await effects.ledger(),externalRequests:effects.requests()});
 }finally{await effects.close();}
}));

test('failure-recovery quantity actual SQL restores fence missing order intent receipt and purchase history',()=>withFixture(async(f,cluster)=>{
 const seed=await seedQuantity(f),schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database];
 const dump=name=>{const path=cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};const restore=async path=>{await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});restart(f);};
 const initial=dump('quantity-initial'),b=await approvePurchase(f,await compareQuantity(f,seed)),ready=dump('quantity-ready'),effects=await referenceEffects(cluster),port=new SyntheticPort(effects.url);
 try{
  await work(f,b,port);const sent=dump('quantity-sent');
  // Isolate R1 BEFORE any receipt exists: the SQL purchase row still matches
  // its journal version, so the durable pre-send intent must fence READY SQL.
  await restore(ready);for(const op of ['purchaseRead','get'])await reject(()=>f.call('operator',op,{id:b.id}),'RECOVERING');await reject(()=>f.call('operator','query',{packageId:'enterprise-procurement',type:'PurchaseRequest'}),'RECOVERING');await reject(()=>work(f,b,port),'RECOVERING');await reject(()=>work(f,b,port,'reconcile'),'RECOVERING');await reject(()=>f.call('operator','resourceRelease',{id:seed.budgetId,reference:b.id}),'RECOVERING');
  assert.equal((await f.call('manager','assuranceRead',{id:seed.budgetId})).data.reserved,1200);assert.deepEqual(effects.requests().map(x=>x.method),['POST']);
  await restore(sent);const before=await read(f,b.id);assert.equal(before.state,'ORDER_CONFIRMED');assert.deepEqual(before.quantityContract.ordered,{quantity:7,unit:'台'});
  await f.call('agent','purchaseReceive',receiptBody(b,before));const completed=await read(f,b.id),complete=dump('quantity-complete');
  await restore(sent);await reject(()=>read(f,b.id),'RECOVERING');await restore(initial);await reject(()=>f.call('operator','purchaseCreate',purchaseBody(seed,{id:b.id})),'RECOVERING');await restore(complete);assert.deepEqual(await read(f,b.id),completed);assert.equal(completed.quantityContract.matchEligible,true);
  await f.owner.query("UPDATE enterprise_procurement SET data=jsonb_set(data,'{receipt,receivedQuantity}','8') WHERE id=$1",[b.id]);await reject(()=>read(f,b.id),'RECOVERING');assert.equal((await effects.ledger())[0].applications,1);
  evidence('quantity-sql-restore',{realSchemaDumpRestore:true,preSendSQLRestoredAfterExternalApplyFenced:true,missingReceiptFenced:true,missingPurchaseFenced:true,receiptTamperFenced:true,completed,ledger:await effects.ledger(),externalRequests:effects.requests()});
 }finally{await effects.close();}
}));

test('negative-authorization quantity requires exact reviewed published version and current approval authority before send',()=>withFixture(async(f,cluster)=>{
 const seed=await seedProcurement(f),manifest=structuredClone(procurementQuantityManifest),body=purchaseBody(seed);
 await f.call('manager','install',{manifest});await reject(()=>f.call('operator','purchaseCreate',body),'UNSUPPORTED_VERSION');
 await reject(()=>f.call('manager','review',{id:manifest.id,version:manifest.version}),'PERMISSION_DENIED');
 await f.call('reviewer','review',{id:manifest.id,version:manifest.version});await reject(()=>f.call('operator','purchaseCreate',body),'UNSUPPORTED_VERSION');await f.call('publisher','publish',{id:manifest.id,version:manifest.version});
 const b=await approvePurchase(f,await compareQuantity(f,seed)),effects=await referenceEffects(cluster),port=new SyntheticPort(effects.url);
 try{
  await f.call('publisher','grant',{principal:'reviewer',scopes:[],operations:[],fields:[]});await reject(()=>work(f,b,port),'PERMISSION_DENIED');
  await f.call('publisher','grant',{principal:'reviewer',scopes:[scope],operations:['read','search','action','approve','worker','recovery','author','review','publish','records','audit','connect'],fields:['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED']});await reject(()=>work(f,b,port),'STALE_APPROVAL');assert.equal((await effects.ledger()).length,0);assert.equal(effects.requests().length,0);
  evidence('quantity-version-and-revocation',{draftCreateDenied:true,reviewedUnpublishedCreateDenied:true,selfReviewDenied:true,restoredAuthorityInvalidatesOldApproval:true,record:await read(f,b.id),ledger:await effects.ledger(),externalRequests:effects.requests()});
 }finally{await effects.close();}
}));
