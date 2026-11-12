import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {bootstrapEnterpriseFixture,scope,operations,TRACE_LIMIT} from '../../scripts/enterprise/fixture-bootstrap.mjs';
import {budget,checkBudget} from '../../src/budget.mjs';

const principals=['operator','manager','reviewer','publisher','agent','reader','other','tenant2'];
const bootstrapOperations=['authorityMigrate','authorityMigrate','grant','documentMigrate','documentMigrate','install','review','publish'];
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fake(settings={}){
 const log={queries:[],operations:[],stateClose:0,ownerEnd:0,forbiddenClose:0,admissions:0,transactions:0,callbacks:0,journal:0};
 const failure=settings.error??Object.assign(new Error('private failure'),{code:'UNAVAILABLE'});
 const originalScopes=[{...scope}];
 const callbackThis={},unit={},result={ok:true};
 const f={credentials:Object.fromEntries(principals.map(name=>[name,{token:'TOKEN_SENTINEL_'+name}])),
  state:{
   close(){log.stateClose++;return settings.stateClose?.();},
   transaction(fn,deadline,signal){assert.equal(this,f.state);log.transactions++;checkBudget({deadline,signal});log.callbacks++;return fn.call(callbackThis,unit);},
   admission(fn,options){assert.equal(this,f.state);log.admissions++;checkBudget(options);log.callbacks++;return fn.call(callbackThis);}
  },
  journal:{records(){assert.equal(this,f.journal);log.journal++;return [];},append(record){assert.equal(this,f.journal);log.journal++;return record;}},
  owner:{
   query(sql,...args){
    assert.equal(this,f.owner);log.queries.push({sql,args});
    if(log.queries.length===settings.failQuery)throw failure;
    if(sql.includes('SELECT tablename'))return {rows:[{tablename:'enterprise_fake'}]};
    if(sql.includes('SELECT scopes'))return {rows:[{scopes:originalScopes}]};
    return {rows:[]};
   },
   end(){log.ownerEnd++;return settings.ownerEnd?.();}
  },
  kernel:{enterprise(credential,request,...args){
   assert.equal(this,f.kernel);log.operations.push({credential,request,args});
   if(log.operations.length===settings.failOperation)throw failure;
   if(settings.enterprise)return settings.enterprise(f,credential,request,args,log);
   const options=budget(args[0]);
   return f.state.admission(()=>f.state.transaction(()=>{f.journal.records();f.journal.append({token:'JOURNAL_SECRET',body:request.body});return result;},options.deadline,options.signal),options);
  }},
  close(){log.forbiddenClose++;throw new Error('must not call f.close');}
 };
 return {f,log,failure,originalScopes,result};
}
const quiet={observer(){}};
async function fails(env,options={},controls=quiet){
 let caught=false;
 try{await bootstrapEnterpriseFixture(env.f,options,controls);}catch(error){caught=true;assert.equal(error,env.failure);}
 assert.equal(caught,true);assert.equal(env.log.stateClose,1);assert.equal(env.log.ownerEnd,1);assert.equal(env.log.forbiddenClose,0);
}
function descriptors(f){return [f.owner,f.state,f.kernel,f.journal].map(value=>Object.getOwnPropertyDescriptors(value));}

test('Q01_REAL_INITIALIZER_SUCCESS_OWNERSHIP_TRANSFER',async()=>{
 const env=fake();const before=descriptors(env.f);let observed=0;
 const result=await bootstrapEnterpriseFixture(env.f,{}, {observer(){observed++;}});
 assert.equal(result.owner,env.f.owner);assert.equal(result.state,env.f.state);assert.equal(result.kernel,env.f.kernel);
 assert.equal(env.log.stateClose,0);assert.equal(env.log.ownerEnd,0);assert.equal(observed,0);
 assert.deepEqual(env.log.operations.map(x=>x.request.operation),bootstrapOperations);
 const files=['002-enterprise.sql','003-package-provenance.sql','004-enterprise-governance.sql','005-enterprise-controls.sql','006-enterprise-assurance.sql','007-enterprise-procurement.sql'];
 for(let i=0;i<files.length;i++)assert.equal(env.log.queries[i].sql,await readFile(new URL('../../migrations/'+files[i],import.meta.url),'utf8'));
 assert.deepEqual(descriptors(env.f),before.map((d,i)=>i===2?{...d,documentScanner:{value:undefined,writable:true,enumerable:true,configurable:true},connections:{value:env.f.kernel.connections,writable:true,enumerable:true,configurable:true}}:d));
 assert.equal(result.manifest.id,JSON.parse(await readFile(new URL('../../config/enterprise/foundation.json',import.meta.url))).id);
});

test('Q02_REAL_INITIALIZER_MIGRATION_FAILURE',async()=>{
 const env=fake({failQuery:2});await fails(env);assert.equal(env.log.queries.length,2);assert.equal(env.log.operations.length,0);
 assert.match(env.log.queries[1].sql,/CREATE|ALTER|INSERT/);
 const late=fake(),query=late.f.owner.query;
 late.f.owner.query=function(...args){const value=Reflect.apply(query,this,args);return late.log.queries.length===6?Promise.reject(late.failure):value;};
 await fails(late);assert.equal(late.log.queries.length,6);assert.equal(late.log.operations.length,0);
});

test('Q03_REAL_INITIALIZER_FIRST_AUTHORITY_FAILURE',async()=>{
 const env=fake({failOperation:1});await fails(env);assert.equal(env.log.operations.length,1);
 assert.equal(env.log.operations[0].request.operation,'authorityMigrate');assert.equal(env.log.operations[0].credential,env.f.credentials.publisher);
 assert.equal(env.log.queries.length,22);
});

test('Q04_REAL_INITIALIZER_LATER_BOOTSTRAP_FAILURE',async()=>{
 const env=fake({failOperation:8});await fails(env);assert.deepEqual(env.log.operations.map(x=>x.request.operation),bootstrapOperations);
 assert.equal(env.log.operations.at(-1).credential,env.f.credentials.publisher);
});

test('Q05_STATE_CLOSE_REJECTION_STILL_AWAITS_OWNER',async()=>{
 const owner=deferred(),entered=deferred();let settled=false;
 const env=fake({failQuery:1,stateClose(){return Promise.reject(new Error('state cleanup secret'));},ownerEnd(){entered.resolve();return owner.promise;}});
 const pending=fails(env).then(()=>{settled=true;});await entered.promise;await Promise.resolve();
 assert.equal(env.log.ownerEnd,1);assert.equal(settled,false);owner.resolve();await pending;assert.equal(settled,true);
});

test('Q06_OWNER_CLOSE_REJECTION_PRIMARY_ERROR_PRESERVED',async()=>{
 const env=fake({failOperation:1,ownerEnd(){return Promise.reject(new Error('owner cleanup secret'));}});let summary;
 await fails(env,{}, {observer(value){summary=value;}});
 assert.equal(summary.events.find(x=>x.phase==='owner-end').kind,'reject');
 assert.equal(summary.events.find(x=>x.phase==='state-close').kind,'resolve');
});

test('Q07_BOTH_CLEANUP_REJECT_ATTEMPTED_ONCE',async()=>{
 const env=fake({failQuery:1,stateClose(){throw new Error('sync close secret');},ownerEnd(){return Promise.reject(new Error('async close secret'));}});let summary;
 await fails(env,{}, {observer(value){summary=value;}});
 assert.equal(summary.events.filter(x=>['state-close','owner-end'].includes(x.phase)&&x.kind==='reject').length,2);
});

test('Q08_DEFERRED_CLEANUP_ACTUALLY_AWAITED',async()=>{
 const state=deferred(),owner=deferred(),entered=deferred();let settled=false;
 const env=fake({failOperation:8,stateClose(){return state.promise;},ownerEnd(){entered.resolve();return owner.promise;}});
 const pending=fails(env).then(()=>{settled=true;});await entered.promise;
 assert.equal(env.log.stateClose,1);assert.equal(env.log.ownerEnd,1);assert.equal(settled,false);
 state.resolve();await Promise.resolve();await Promise.resolve();assert.equal(settled,false);
 owner.resolve();await pending;assert.equal(settled,true);
});

test('Q09_ORIGINAL_THROW_IDENTITY_AND_CODE',async()=>{
 const primary=Object.assign(new Error('do not retain this stack'),{code:'DEADLINE_EXCEEDED'});const stack=primary.stack;
 const env=fake({error:primary,failOperation:4});await fails(env);assert.equal(primary.stack,stack);assert.equal(primary.code,'DEADLINE_EXCEEDED');
 for(const value of [undefined,null,19,'private thrown string']){
  const sample=fake({enterprise(){throw value;}});let caught=false;
  try{await bootstrapEnterpriseFixture(sample.f,{},quiet);}catch(error){caught=true;assert.equal(error,value);}
  assert.equal(caught,true);assert.equal(sample.log.stateClose,1);assert.equal(sample.log.ownerEnd,1);
 }
});

test('Q10_DEADLINE_SIGNAL_THIS_ARGS_NO_RESET_NO_RETRY',async()=>{
 const env=fake();const signal=new AbortController().signal,deadline=Date.now()+5000,options={deadline,signal},extra={},methodThis={},callbackThis={},arg1={},arg2={};
 let expectedCallback,expectedReturn,expectedThrow,methodCalls=0,callbackCalls=0,thenReads=0;
 const thenable=Object.defineProperty({},'then',{get(){thenReads++;throw new Error('instrumentation must not inspect then');}});
 for(const name of ['transaction','admission'])env.f.state[name]=function(callback,...args){
  methodCalls++;assert.equal(this,methodThis);assert.notEqual(callback,expectedCallback);
  assert.deepEqual(args,name==='transaction'?[deadline,signal,options,extra]:[options,extra]);
  assert.equal(args[name==='transaction'?2:0],options);assert.equal(args.at(-1),extra);
  if(name==='transaction'){assert.equal(args[0],deadline);assert.equal(args[1],signal);}
  return callback.call(callbackThis,arg1,arg2);
 };
 let exercised=false;
 env.f.kernel.enterprise=function(credential,request,...args){
  assert.equal(this,env.f.kernel);assert.equal(args.length,0);assert.equal(credential,env.f.credentials[principals.find(p=>env.f.credentials[p]===credential)]);
  if(exercised)return {};exercised=true;
  for(const name of ['transaction','admission'])for(const mode of ['return','throw','promise','thenable']){
   expectedReturn=mode==='promise'?Promise.resolve(extra):mode==='thenable'?thenable:extra;
   expectedThrow=mode==='throw'?Object.assign(new Error('private throw'),{code:'CANCELLED'}):null;
   expectedCallback=function(a,b){callbackCalls++;assert.equal(this,callbackThis);assert.equal(a,arg1);assert.equal(b,arg2);if(expectedThrow)throw expectedThrow;return expectedReturn;};
   const callArgs=name==='transaction'?[expectedCallback,deadline,signal,options,extra]:[expectedCallback,options,extra];
   let synchronous=false;
   try{const returned=Reflect.apply(env.f.state[name],methodThis,callArgs);assert.equal(expectedThrow,null);assert.equal(returned,expectedReturn);synchronous=true;}
   catch(error){assert.equal(error,expectedThrow);synchronous=true;}
   assert.equal(synchronous,true);
  }
  return {};
 };
 await bootstrapEnterpriseFixture(env.f,{},quiet);
 assert.equal(methodCalls,8);assert.equal(callbackCalls,8);assert.equal(thenReads,0);assert.equal(options.deadline,deadline);assert.equal(options.signal,signal);
 const before=Date.now(),shared=budget(),after=Date.now();assert.ok(shared.deadline>=before+5000&&shared.deadline<=after+5000);
 assert.equal(env.log.stateClose,0);assert.equal(env.log.ownerEnd,0);
});

test('Q11_SYNC_JOURNAL_RETURN_AND_THROW',async()=>{
 const env=fake();const returned={},argument={body:'JOURNAL_PRIVATE'},failure=new Error('JOURNAL_PRIVATE');let calls=0,active=true;
 env.f.journal.append=function(value){assert.equal(this,env.f.journal);assert.equal(value,argument);assert.equal(active,true);calls++;if(calls===2)throw failure;return returned;};
 let exercised=false;
 env.f.kernel.enterprise=function(){if(!exercised){exercised=true;assert.equal(env.f.journal.append(argument),returned);assert.throws(()=>env.f.journal.append(argument),error=>error===failure);}return {};};
 await bootstrapEnterpriseFixture(env.f,{},quiet);active=false;assert.equal(calls,2);assert.equal(env.log.stateClose,0);
});

test('Q12_EXACT_DESCRIPTOR_RESTORATION_SUCCESS_AND_FAILURE',async()=>{
 for(const fail of [false,true]){
  const env=fake({failOperation:fail?1:0});
  for(const target of [env.f.owner,env.f.state,env.f.kernel,env.f.journal]){
   const prototype={};
   for(const name of Object.keys(target))if(typeof target[name]==='function'){
    Object.defineProperty(prototype,name,{value:target[name],configurable:true,writable:false,enumerable:false});delete target[name];
   }
   Object.setPrototypeOf(target,prototype);
  }
  const query=env.f.owner.query;
  Object.defineProperty(env.f.owner,'query',{get(){return query;},configurable:true,enumerable:true});
  Object.defineProperty(env.f.journal,'append',{value:env.f.journal.append,writable:false,enumerable:false,configurable:true});
  const before=descriptors(env.f),prototypes=[env.f.owner,env.f.state,env.f.kernel,env.f.journal].map(Object.getPrototypeOf);
  if(fail)await fails(env);else await bootstrapEnterpriseFixture(env.f,{},quiet);
  const after=descriptors(env.f);delete after[2].documentScanner;delete after[2].connections;
  assert.deepEqual(after,before);assert.deepEqual([env.f.owner,env.f.state,env.f.kernel,env.f.journal].map(Object.getPrototypeOf),prototypes);
  assert.equal(env.f.owner.query,query);assert.equal(Object.hasOwn(env.f.state,'transaction'),false);
 }
});

test('Q13_PHASE_OPERATION_TIMING_WITH_FAKE_CLOCK',async()=>{
 let now=0,summary,callbackCount=0,admissionCount=0,transactionCount=0;
 const env=fake();const signal={},options={deadline:1100,signal},callbackThis={},argument={},methodThis=env.f.state,result={};
 let admissionCallback,transactionCallback,expectedResult=result;
 env.f.state.admission=function(callback,received){
  admissionCount++;assert.equal(this,methodThis);assert.equal(received,options);assert.notEqual(callback,admissionCallback);
  now+=7;const value=callback.call(callbackThis,argument);assert.equal(value,expectedResult);now+=11;return value;
 };
 env.f.state.transaction=function(callback,deadline,receivedSignal){
  transactionCount++;assert.equal(this,methodThis);assert.equal(deadline,options.deadline);assert.equal(receivedSignal,signal);assert.notEqual(callback,transactionCallback);
  now+=3;const value=callback.call(callbackThis,argument);assert.equal(value,expectedResult);now+=5;return value;
 };
 env.f.journal.records=function(value){assert.equal(this,env.f.journal);assert.equal(value,argument);now+=2;return result;};
 env.f.kernel.enterprise=function(){
  now=10;
  transactionCallback=function(value){callbackCount++;assert.equal(this,callbackThis);assert.equal(value,argument);return env.f.journal.records(argument);};
  admissionCallback=function(value){callbackCount++;assert.equal(this,callbackThis);assert.equal(value,argument);return env.f.state.transaction(transactionCallback,options.deadline,signal);};
  assert.equal(env.f.state.admission(admissionCallback,options),result);
  let thenReads=0;
  const thenable=Object.defineProperty({},'then',{get(){thenReads++;throw new Error('must not inspect callback return');}});
  expectedResult=thenable;
  transactionCallback=function(value){callbackCount++;assert.equal(this,callbackThis);assert.equal(value,argument);return thenable;};
  assert.equal(env.f.state.admission(admissionCallback,options),thenable);assert.equal(thenReads,0);
  const callbackFailure=Object.assign(new Error('private callback failure'),{code:'CANCELLED'});
  transactionCallback=function(value){callbackCount++;assert.equal(this,callbackThis);assert.equal(value,argument);throw callbackFailure;};
  assert.throws(()=>env.f.state.admission(admissionCallback,options),error=>error===callbackFailure);
  throw env.failure;
 };
 await fails(env,{}, {clock:()=>now,wallClock:()=>1000+now,observer(value){summary=value;}});
 const event=(phase,kind)=>summary.events.find(x=>x.phase===phase&&x.kind===kind);
 assert.equal(event('admission-wait','start').elapsedMs,10);assert.equal(event('admission-acquired','start').elapsedMs,17);
 assert.equal(event('transaction','start').elapsedMs,17);assert.equal(event('transaction-callback','start').elapsedMs,20);
 assert.equal(event('transaction-callback','return').durationMs,2);assert.equal(event('transaction','return').durationMs,10);
 assert.equal(event('admission-acquired','return').durationMs,10);assert.equal(event('admission-wait','return').durationMs,28);
 assert.equal(event('admission-wait','start').deadline,1100);assert.equal(event('admission-wait','start').remainingMs,90);
 assert.equal(event('transaction','start').remainingMs,83);assert.equal(event('journal-records','return').durationMs,2);
 assert.equal(event('transaction','start').operation,'authorityMigrate');
 assert.equal(callbackCount,6);assert.equal(admissionCount,3);assert.equal(transactionCount,3);
 assert.ok(summary.events.every(x=>Number.isInteger(x.ordinal)&&x.ordinal>0));
});

test('Q14_PRIVACY_SENTINELS_AND_BOUNDED_TRACE',async()=>{
 const sentinels=['SQL_SECRET','PARAM_SECRET','TOKEN_SECRET','BODY_SECRET','PATH_SECRET','STACK_SECRET','MESSAGE_SECRET','UNKNOWN_CODE_SECRET'];
 const primary=Object.assign(new Error(sentinels[6]),{code:sentinels[7],stack:sentinels[5]});let summary;
 const env=fake({error:primary});env.f.credentials.publisher.token=sentinels[2];
 env.f.kernel.enterprise=function(credential,request){
  for(let i=0;i<400;i++)env.f.journal.append({sql:sentinels[0],params:sentinels[1],token:credential.token,body:sentinels[3],path:sentinels[4],request});
  throw primary;
 };
 await fails(env,{}, {observer(value){summary=value;}});
 const serialized=JSON.stringify(summary);for(const secret of sentinels)assert.equal(serialized.includes(secret),false);
 assert.equal(summary.events.length,TRACE_LIMIT);assert.ok(summary.dropped>0);assert.ok(serialized.length<30000);
 assert.deepEqual(summary.cleanup,[{phase:'state-close',outcome:'resolve'},{phase:'owner-end',outcome:'resolve'}]);assert.equal(summary.code,'UNKNOWN');
 const allowedPhases=new Set(['migration','seed','bootstrap','enterprise','journal-append','state-close','owner-end']);
 assert.ok(summary.events.every(x=>allowedPhases.has(x.phase)));assert.ok(summary.events.every(x=>['NONE','authorityMigrate'].includes(x.operation)));
 const unknown=fake({error:primary,failOperation:1});let unknownSummary;await fails(unknown,{}, {observer(value){unknownSummary=value;}});
 assert.equal(unknownSummary.events.find(x=>x.kind==='throw').code,'UNKNOWN');
});

test('Q15_DIAGNOSTIC_OBSERVER_FAILURE_CANNOT_MASK_OR_SKIP_CLEANUP',async()=>{
 const env=fake({failOperation:1,stateClose(){throw new Error('cleanup secret');}});let calls=0,summary;
 await fails(env,{}, {clock(){throw new Error('clock secret');},wallClock(){throw new Error('wall secret');},observer(value){calls++;summary=value;assert.equal(env.log.stateClose,1);assert.equal(env.log.ownerEnd,1);throw new Error('observer secret');}});
 assert.equal(calls,1);assert.equal(summary.observerFailures,1);assert.equal(JSON.stringify(summary).includes('secret'),false);
});

test('Q16_CANCELLED_AND_EXPIRED_ORIGINAL_REQUEST_REJECTS',async()=>{
 for(const cancelled of [true,false]){
  const controller=new AbortController();if(cancelled)controller.abort();const options={deadline:Date.now()+(cancelled?5000:-1),signal:controller.signal};
  const env=fake();let callbackCalls=0,admissions=0,original;
  env.f.state.admission=function(callback,received){admissions++;assert.equal(this,env.f.state);assert.equal(received,options);try{checkBudget(received);}catch(error){original=error;throw error;}return callback();};
  env.f.kernel.enterprise=function(){return env.f.state.admission(()=>{callbackCalls++;},options);};
  let caught=false;try{await bootstrapEnterpriseFixture(env.f,{},quiet);}catch(error){caught=true;assert.equal(error,original);assert.equal(error.code,cancelled?'CANCELLED':'DEADLINE_EXCEEDED');}
  assert.equal(caught,true);assert.equal(admissions,1);assert.equal(callbackCalls,0);assert.equal(env.log.stateClose,1);assert.equal(env.log.ownerEnd,1);assert.equal(options.signal,controller.signal);
 }
});

test('Q17_INSTALL_FALSE_PATH_AND_NORMAL_CALL_SEMANTICS',async()=>{
 const env=fake();const scanner={},connections={},scopes=[{...scope,caseId:'custom-case'}];
 const result=await bootstrapEnterpriseFixture(env.f,{install:false,documentScanner:scanner,connections,enterpriseScopes:scopes},quiet);
 assert.equal(env.log.operations.length,0);assert.equal(env.log.queries.length,20);assert.equal(env.log.stateClose,0);assert.equal(env.log.ownerEnd,0);
 assert.equal(env.f.kernel.documentScanner,scanner);assert.equal(env.f.kernel.connections,connections);
 const grants=env.log.queries.filter(x=>x.sql.startsWith('INSERT INTO enterprise_grants'));
 assert.equal(grants.length,8);assert.deepEqual(JSON.parse(grants[0].args[0][1]),scopes);
 const body={},key='explicit-key',returned={};let calls=0;
 env.f.kernel.enterprise=function(credential,request,...args){calls++;assert.equal(this,env.f.kernel);assert.equal(credential,env.f.credentials.manager);assert.equal(request.operation,'read');assert.equal(request.body,body);assert.equal(request.key,key);assert.equal(args.length,0);return returned;};
 assert.equal(result.call('manager','read',body,key),returned);assert.equal(calls,1);
 const first=result.create(),second=result.create();assert.notEqual(first.id,second.id);assert.notEqual(first.fields,second.fields);assert.equal(first.scope,scope);
 assert.equal(result.create({id:'override'}).id,'override');assert.equal(first.packageId,result.manifest.id);assert.equal(operations.includes('publish'),true);
});
