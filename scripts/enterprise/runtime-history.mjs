// R1a reference component. No complete H, initializer, runtime override or
// executable historical module is exposed by this preparation-only seam.
import assert from 'node:assert/strict';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {resolve,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {hash,inputs,confined} from './evidence.mjs';
import {currentContext} from './context.mjs';
import {inspectRuntimeReferenceHistory,inspectRuntimeInputHistory} from './runtime-preparation.mjs';

const key=c=>JSON.stringify([c.handoff,c.handoffSha256,c.pointer]);
function recoveryPath(root,path){
 assert.equal(typeof path,'string','recovery path required');
 assert.ok(path.startsWith('evidence/')&&!path.includes('\\'),'recovery path outside evidence');
 const absolute=resolve(root,path);
 assert.equal(relative(root,absolute),path,'recovery path must be canonical');
 assert.ok(absolute.startsWith(root+sep)&&!path.split('/').includes('..'),'recovery path escape');
 // lstat also rejects dangling symlinks, which existsSync alone would miss.
 let current=root;
 for(const part of path.split('/')){
  current=resolve(current,part);let stat;
  try{stat=lstatSync(current);}catch(e){if(e.code==='ENOENT')continue;throw e;}
  assert.ok(!stat.isSymbolicLink(),'recovery path symlink');
 }
 return absolute;
}
function observe(root,path,recovery=true){
 const absolute=recovery?recoveryPath(root,path):confined(root,path);let stat;
 try{stat=lstatSync(absolute);}catch(e){if(e.code==='ENOENT')return {path,missing:true};throw e;}
 assert.ok(stat.isFile(),'recovery regular file required');
 const raw=readFileSync(absolute);return {path,sha256:hash(raw),bytes:raw.length};
}

// Only this module constructs the reader, after the strict source adapter has
// authenticated the original consumers. The inventory supplies locations only.
// This data-only component deliberately cannot produce a validated complete H.
class HistoricalHistoryReader {
 constructor(root,history,inventory){this.root=root;this.history=history;this.inventory=inventory;}
 assessReferences(){
  const {root,history,inventory}=this;
  assert.deepEqual(Object.keys(inventory).sort(),['kind','locators','schemaVersion','sourceRunSlug'],'recovery locator inventory fields');
  assert.equal(inventory.schemaVersion,1,'recovery locator schema');
  assert.equal(inventory.kind,'UNTRUSTED_HISTORY_RECOVERY_LOCATORS','recovery locator kind');
  assert.equal(inventory.sourceRunSlug,history.sourceRunSlug,'recovery source run');
  assert.ok(Array.isArray(inventory.locators),'recovery locators required');
  const requirements=[...history.proofs,...history.missing];
  const consumers=new Map(requirements.map(r=>[key(r.consumer),r]));
  assert.equal(consumers.size,requirements.length,'duplicate authenticated consumer');
  const candidates=new Map(),observations=new Map(),seen=new Set();
  for(const l of inventory.locators){
   assert.deepEqual(Object.keys(l).sort(),['consumer','path'],'recovery locator fields');
   assert.ok(l.consumer&&typeof l.consumer==='object','recovery consumer required');
   assert.deepEqual(Object.keys(l.consumer).sort(),['handoff','handoffSha256','pointer'],'recovery consumer fields');
   const id=key(l.consumer);assert.ok(consumers.has(id),'recovery consumer not authenticated');
   const unique=id+'\0'+l.path;assert.ok(!seen.has(unique),'recovery locator duplicate');seen.add(unique);
   const observation=observations.get(l.path)??observe(root,l.path);observations.set(l.path,observation);
   const list=candidates.get(id)??[];list.push(observation);candidates.set(id,list);
  }
  const proofs=[...history.proofs],missing=[];
  for(const r of history.missing){
   const attempted=candidates.get(key(r.consumer))??[];
   const source=attempted.find(o=>o.sha256===r.sha256&&(r.bytes===undefined||o.bytes===r.bytes));
   if(source){const {searched,...requirement}=r;proofs.push({...requirement,source:{...source,basis:'AUTHENTICATED_CONSUMER_RAW_BYTES'}});}
   else missing.push({...r,searched:[...r.searched,...attempted]});
  }
  // Every attempted candidate is re-read, including absent and mismatched ones.
  for(const o of observations.values())assert.deepEqual(observe(root,o.path),o,'concurrent recovery bytes: '+o.path);
  return {complete:missing.length===0,proofs,missing,recoveryObservations:[...observations.values()]};
 }
}

// Source preparation entry only. The future target reader must authenticate
// source records independently, without impersonating this current builder.
export async function inspectRecoveredRuntimeReferences(root,inventoryPath){
 root=realpathSync(root);
 const context=await currentContext(root),history=await inspectRuntimeReferenceHistory(root);
 const path=recoveryPath(root,inventoryPath);assert.ok(lstatSync(path).isFile(),'recovery regular file required');
 const raw=readFileSync(path),inventory=JSON.parse(raw);
 const references=new HistoricalHistoryReader(root,history,inventory).assessReferences();
 // Preserve the existing source/context trust root across the new read interval.
 assert.deepEqual(await currentContext(root),context,'concurrent recovery context');
 assert.deepEqual(inputs(root),history.currentInputs,'concurrent recovery inputs');
 for(const h of history.handoffs)assert.equal(hash(readFileSync(recoveryPath(root,h.path))),h.sha256,'concurrent recovery handoff');
 for(const o of history.observations)assert.deepEqual(observe(root,o.path,false),o,'concurrent recovery source reference');
 for(const o of references.recoveryObservations)assert.deepEqual(observe(root,o.path),o,'concurrent recovery bytes: '+o.path);
 assert.deepEqual(readFileSync(recoveryPath(root,inventoryPath)),raw,'concurrent recovery inventory');
 return {schemaVersion:1,kind:'READ_ONLY_HISTORY_ASSESSMENT',sourceRunSlug:history.sourceRunSlug,iteration:history.iteration,designReportSha256:history.designReportSha256,currentInputs:history.currentInputs,
  inventory:{path:inventoryPath,sha256:hash(raw),bytes:raw.length},handoffs:history.handoffs,
  components:{references,runtimeDependencies:{status:'NOT_IMPLEMENTED'},executionOrigin:{status:'UNPROVEN_EXECUTION_ORIGIN',requiredRecord:'independently authenticated supervisor invocation bound to source occurrence and receipt'}},
  completeMigrationHistory:false,initializationAuthority:false,currentApprovals:[]};
}
// Enumerate each authenticated historical lock separately. This is a graph
// prerequisite only; absent installation/platform/artifact evidence stays absent.
export async function inspectRuntimeDependencyGraphs(root){
 const {assessDependencyGraph}=await import('./runtime-dependency-graph.mjs');
 root=realpathSync(root);const context=await currentContext(root),history=await inspectRuntimeInputHistory(root);
 const locks=new Map(),bindings=[];
 for(const {inputs:m,origins} of history.manifests){
  const expected=m.entries.find(e=>e.path==='package-lock.json');assert.ok(expected,'dependency graph historical lock missing');
  const proof=history.proofs.find(p=>p.inputsDigest===m.digest&&p.path===expected.path);assert.ok(proof,'dependency graph lock proof missing');
  const raw=readFileSync(confined(root,proof.source.path));assert.equal(hash(raw),expected.sha256,'dependency graph lock changed');assert.equal(raw.length,expected.bytes,'dependency graph lock length');
  assert.equal(proof.sha256,expected.sha256);assert.equal(proof.bytes,expected.bytes);
  if(!locks.has(expected.sha256))locks.set(expected.sha256,assessDependencyGraph(JSON.parse(raw)));
  bindings.push({inputsDigest:m.digest,origins,lock:{...expected,source:proof.source},graphSha256:hash(JSON.stringify(locks.get(expected.sha256)))});
 }
 for(const r of history.references){const raw=readFileSync(confined(root,r.path));assert.equal(hash(raw),r.sha256,'concurrent dependency graph reference');assert.equal(raw.length,r.bytes);}
 assert.deepEqual(await currentContext(root),context,'concurrent dependency graph context');assert.deepEqual(inputs(root),history.currentInputs,'concurrent dependency graph inputs');
 return {schemaVersion:1,kind:'READ_ONLY_HISTORY_ASSESSMENT',sourceRunSlug:history.sourceRunSlug,iteration:history.iteration,designReportSha256:history.designReportSha256,currentInputs:history.currentInputs,bindings,graphs:[...locks].map(([lockSha256,assessment])=>({lockSha256,assessment})),references:history.references,
  dependencyClosureIntegrityProven:false,completeMigrationHistory:false,initializationAuthority:false,currentApprovals:[],remaining:['PRESERVED_PACKAGE_METADATA_AND_ARTIFACTS','VERSION_CONSTRAINT_VALIDATION','AUTHENTICATED_PLATFORM_SELECTION','INSTALLED_SOURCE_HASHES','TARGET_PRIVATE_READER','EXECUTION_ORIGIN']};
}
// Each result remains bound to the exact historical lock and original graph.
export async function inspectRuntimeVersionConstraints(root){
 const {assessDependencyVersionConstraints}=await import('./runtime-version-constraints.mjs');
 root=realpathSync(root);const context=await currentContext(root),history=await inspectRuntimeDependencyGraphs(root),assessments=new Map();
 const bindings=history.bindings.map(b=>{
  if(!assessments.has(b.lock.sha256)){
   const raw=readFileSync(confined(root,b.lock.source.path));assert.equal(hash(raw),b.lock.sha256,'version constraint historical lock changed');assert.equal(raw.length,b.lock.bytes);
   assessments.set(b.lock.sha256,assessDependencyVersionConstraints(JSON.parse(raw)));
  }
  return {...b,versionAssessmentSha256:hash(JSON.stringify(assessments.get(b.lock.sha256)))};
 });
 for(const r of history.references){const raw=readFileSync(confined(root,r.path));assert.equal(hash(raw),r.sha256,'concurrent version constraint reference');assert.equal(raw.length,r.bytes);}
 assert.deepEqual(await currentContext(root),context,'concurrent version constraint context');assert.deepEqual(inputs(root),history.currentInputs,'concurrent version constraint inputs');
 return {...history,bindings,versionAssessments:[...assessments].map(([lockSha256,assessment])=>({lockSha256,assessment})),remaining:history.remaining.map(r=>r==='VERSION_CONSTRAINT_VALIDATION'?'UNSUPPORTED_VERSION_SYNTAX_AND_OPTIONAL_SELECTION':r)};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{
  const args=process.argv.slice(2);
  let result;
  if(args.length===2&&args[0]==='--inspect-references')result=await inspectRecoveredRuntimeReferences(process.cwd(),args[1]);
  else if(args.length===1&&args[0]==='--inspect-version-constraints')result=await inspectRuntimeVersionConstraints(process.cwd());
  else if(args.length===1&&args[0]==='--inspect-dependency-graphs')result=await inspectRuntimeDependencyGraphs(process.cwd());
  else throw Error('history preparation accepts only reference inventory or dependency graph assessment');
  console.log(JSON.stringify(result,null,2));
 }catch(error){console.error(error.stack);process.exitCode=1;}
}
