import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {types} from 'node:util';
export const scope={legalEntityId:'synthetic-co',departmentId:'synthetic-corporate',caseId:'synthetic-project',classification:'CONFIDENTIAL'};
export const operations=['read','search','action','approve','worker','recovery','author','review','publish','records','audit','connect'];

const operationNames=new Set(['authorityMigrate','grant','documentMigrate','install','review','publish']);
const errorCodes=new Set(['CANCELLED','DEADLINE_EXCEEDED','INVALID_ARGUMENT','PERMISSION_DENIED','UNAVAILABLE','INCONSISTENT_STATE','RECOVERING','RETRYABLE_UNAVAILABLE','40001','40P01','57014','55P03']);
const journalMethods=['records','writeHead','append','latest','committed','fenced','snapshot','list'];
export const TRACE_LIMIT=96;
function ownValue(value,name){try{return Object.getOwnPropertyDescriptor(Object(value),name)?.value;}catch{return undefined;}}
function code(error){const value=ownValue(error,'code');return errorCodes.has(value)?value:'UNKNOWN';}

// All retained data is constructed here; invocation arguments/results are never copied.
// Native promises are observed without replacing them. Arbitrary thenables are not
// inspected: invoking their then here would change the original call semantics.
function diagnostics(f,{clock=()=>performance.now(),wallClock=()=>Date.now()}={}){
 const context=new AsyncLocalStorage(),undo=[],events=[],cleanup=[];
 let phase='migration',ordinal=0,dropped=0,last=0;
 const readClock=()=>{try{const n=clock();if(Number.isFinite(n))last=Math.max(last,Math.min(Number.MAX_SAFE_INTEGER,n));}catch{}return last;};
 const origin=readClock();
 const elapsed=()=>Math.max(0,readClock()-origin);
 const add=(base,kind,start,error)=>{
  if(events.length>=TRACE_LIMIT){dropped=Math.min(1e9,dropped+1);return;}
  const at=elapsed();
  const event={...base,kind,elapsedMs:at,durationMs:Math.max(0,at-start)};
  if(kind==='throw'||kind==='reject')event.code=code(error);
  if(base.deadline!==undefined){try{const now=wallClock();if(Number.isFinite(now))event.remainingMs=Math.min(Number.MAX_SAFE_INTEGER,Math.max(0,base.deadline-now));}catch{}}
  events.push(event);
 };
 const measure=(label,invoke,deadline)=>{
  const base={phase:label,operation:context.getStore()?.operation??'NONE',ordinal:ordinal=Math.min(1e9,ordinal+1)};
  if(Number.isFinite(deadline))base.deadline=deadline;
  const start=elapsed();add(base,'start',start);
  let result;
  try{result=invoke();}catch(error){add(base,'throw',start,error);throw error;}
  if(types.isPromise(result)&&Object.getPrototypeOf(result)===Promise.prototype&&!Object.hasOwn(result,'constructor')){
   // Both handlers return undefined. Return the identical promise, without awaiting
   // it here. Custom thenables and promise subclasses keep their own semantics.
   try{Promise.prototype.then.call(result,()=>{add(base,'resolve',start);},error=>{add(base,'reject',start,error);});}
   catch{add(base,'return',start);}
  }else add(base,'return',start);
  return result;
 };
 const patch=(target,name,wrap)=>{
  if(!target)return;
  const own=Object.getOwnPropertyDescriptor(target,name),original=target[name];
  if(typeof original!=='function')return;
  const replacement=wrap(original);
  const descriptor=own&&'value' in own?{...own,value:replacement}:{configurable:true,enumerable:own?.enumerable??false,writable:true,value:replacement};
  Object.defineProperty(target,name,descriptor);
  undo.push(()=>{if(own)Object.defineProperty(target,name,own);else delete target[name];});
 };
 return {
  phase(value){phase=value;},
  install(){
   patch(f.owner,'query',original=>function(...args){return measure(phase,()=>Reflect.apply(original,this,args));});
   patch(f.kernel,'enterprise',original=>function(...args){
    const value=ownValue(args[1],'operation'),operation=operationNames.has(value)?value:'UNKNOWN';
    return context.run({operation},()=>measure('enterprise',()=>Reflect.apply(original,this,args)));
   });
   for(const name of ['transaction','admission'])patch(f.state,name,original=>function(...args){
    const deadline=name==='transaction'?args[1]:ownValue(args[1],'deadline');
    if(typeof args[0]==='function'){
     const callback=args[0];
     args[0]=function(...callbackArgs){return measure(name==='admission'?'admission-acquired':'transaction-callback',()=>Reflect.apply(callback,this,callbackArgs),deadline);};
    }
    return measure(name==='admission'?'admission-wait':'transaction',()=>Reflect.apply(original,this,args),deadline);
   });
   for(const name of journalMethods)patch(f.journal,name,original=>function(...args){return measure('journal-'+name,()=>Reflect.apply(original,this,args));});
  },
  restore(){
   let failure;
   while(undo.length){try{undo.pop()();}catch(error){failure??=error;}}
   context.disable();
   if(failure)throw failure;
  },
  cleanup(name,outcome,error){
   const entry={phase:name,outcome};if(outcome==='reject')entry.code=code(error);
   if(cleanup.length<2)cleanup.push(entry);
   add({phase:name,operation:'NONE',ordinal:ordinal=Math.min(1e9,ordinal+1)},outcome,elapsed(),error);
  },
  summary(error){return {status:'ENTERPRISE_INITIALIZATION_FAILED',code:code(error),events:events.map(event=>({...event})),dropped,cleanup:cleanup.map(entry=>({...entry})),observerFailures:0};}
 };
}

// This is the acquired-fixture seam used by production and by the fake-only tests.
// Foundation acquisition failures remain the foundation fixture's responsibility.
export async function bootstrapEnterpriseFixture(f,options={},controls={}){
 let trace;
 const cleanupResults=[];
 try{
  trace=diagnostics(f,controls);
  trace.install();
  const result=await initializeEnterpriseFixture(f,options,trace);
  trace.restore();
  return result;
 }catch(original){
  try{trace?.restore();}catch{/* Preserve the primary failure and still close both owners. */}
  const close=async(name,invoke)=>{
   try{await invoke();cleanupResults.push({phase:name,outcome:'resolve'});trace?.cleanup(name,'resolve');}
   catch(error){cleanupResults.push({phase:name,outcome:'reject',code:code(error)});trace?.cleanup(name,'reject',error);}
  };
  await Promise.all([close('state-close',()=>f.state.close()),close('owner-end',()=>f.owner.end())]);
  const summary=trace?.summary(original)??{status:'ENTERPRISE_INITIALIZATION_FAILED',code:code(original),events:[],dropped:0,cleanup:cleanupResults,observerFailures:0};
  try{(controls.observer??(value=>console.error(JSON.stringify(value))))(summary);}catch{summary.observerFailures=1;}
  throw original;
 }
}

async function initializeEnterpriseFixture(f,options,trace){
 trace.phase('migration');
 f.kernel.documentScanner=options.documentScanner;
 f.kernel.connections=options.connections??{};
 await f.owner.query(await readFile(new URL('../../migrations/002-enterprise.sql',import.meta.url),'utf8'));
 await f.owner.query(await readFile(new URL('../../migrations/003-package-provenance.sql',import.meta.url),'utf8'));
 await f.owner.query(await readFile(new URL('../../migrations/004-enterprise-governance.sql',import.meta.url),'utf8'));
 await f.owner.query(await readFile(new URL('../../migrations/005-enterprise-controls.sql',import.meta.url),'utf8'));
 await f.owner.query(await readFile(new URL('../../migrations/006-enterprise-assurance.sql',import.meta.url),'utf8'));
 await f.owner.query(await readFile(new URL('../../migrations/007-enterprise-procurement.sql',import.meta.url),'utf8'));
 trace.phase('seed');
 await f.owner.query('GRANT INSERT ON sessions TO foundation_app');
 const tables=(await f.owner.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename LIKE 'enterprise_%'")).rows;
 for(const {tablename} of tables)await f.owner.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${tablename} TO foundation_app`);
 for(const principal of ['operator','manager','reviewer','publisher','agent','reader','other','tenant2']){
  const scopes=principal==='other'?[{...scope,departmentId:'synthetic-hr'}]:(options.enterpriseScopes??[scope]);
  const ops=principal==='reader'?['read','search']:principal==='operator'?['read','search','action']:operations;
  const fields=principal==='reader'?['INTERNAL']:['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'];
  await f.owner.query('INSERT INTO enterprise_grants(principal,scopes,operations,fields) VALUES($1,$2,$3,$4)',[principal,JSON.stringify(scopes),JSON.stringify(ops),JSON.stringify(fields)]);
 }
 for(const [principal,role] of [['manager','legal'],['reviewer','pr'],['publisher','ir']])await f.owner.query('INSERT INTO enterprise_release_roles VALUES($1,$2,$3)',['t1',principal,role]);
 const manifest=JSON.parse(await readFile(new URL('../../config/enterprise/foundation.json',import.meta.url)));
 const call=(who,operation,body={},key=randomUUID())=>f.kernel.enterprise(f.credentials[who],{operation,body,key});
 trace.phase('bootstrap');
 if(options.install!==false){
 // A tenant recovery administrator covers all its departments during bootstrap.
 const original=(await f.owner.query("SELECT scopes FROM enterprise_grants WHERE principal='publisher'")).rows[0].scopes;
 await f.owner.query("UPDATE enterprise_grants SET scopes=$1 WHERE principal='publisher'",[JSON.stringify([...original,{...scope,departmentId:'synthetic-hr'}])]);
 await call('publisher','authorityMigrate',{});await call('tenant2','authorityMigrate',{});
 await call('publisher','grant',{principal:'publisher',scopes:original,operations,fields:['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED']});
 await call('manager','documentMigrate',{});await call('tenant2','documentMigrate',{});await call('manager','install',{manifest});await call('reviewer','review',{id:manifest.id,version:manifest.version});await call('publisher','publish',{id:manifest.id,version:manifest.version});}
 const create=(overrides={})=>({id:randomUUID(),packageId:manifest.id,scope,fields:structuredClone(manifest.fixtures[0].fields),...overrides});
 return {...f,manifest,call,create};
}
