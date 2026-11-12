#!/usr/bin/env node
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,openSync,closeSync,unlinkSync,realpathSync,fstatSync,statSync,fsyncSync,renameSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {hash,confined,inputs,snapshot,parseTap,validateRun,validateRunEvidence,validateLatest,validatePlan,validateApproval} from './evidence.mjs';
import {currentContext} from './context.mjs';
import {checkFinal,validateSealCandidate} from './finalization.mjs';
import {createSelection,validateSelection} from './selection.mjs';
import {initializeRun} from './continuation.mjs';
import {createClosureCandidate,importClosure} from './closure.mjs';
import {execute,suitesFor} from './gate-execution.mjs';
import {regenerateRejected} from './rejected-regeneration.mjs';

const read=(root,p)=>JSON.parse(readFileSync(confined(root,p)));
function save(root,path,value) {const p=confined(root,path);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,JSON.stringify(value,null,2)+'\n');}
export {suitesFor,execute} from './gate-execution.mjs';
// Only this module creates writer capabilities. Public callers provide data,
// never a context, a lock token or an alternate run identity.
const progressPath='work/enterprise/progress.json';
function checkpoint(root) {
  assert.ok(existsSync(confined(root,progressPath)),'writer progress missing');
  return {progress:readFileSync(confined(root,progressPath),'utf8'),plan:readFileSync(confined(root,'work/enterprise/plan.json'),'utf8'),inputs:inputs(root)};
}
function ownership(context,point,mode,implementationSession) {
  assert.equal(context.step,mode==='batch'?'build-foundation':'harden-release','writer step');
  assert.equal(context.stepDefinition.edit,true,'writer editable context');
  assert.equal(context.sessionKey,mode==='batch'?'enterprise-builder':'enterprise-release-engineer','writer session key');
  assert.ok(context.providerSessionId,'writer session required');
  if(implementationSession!==undefined)assert.equal(implementationSession,context.providerSessionId,'writer implementationSession');
  const progress=JSON.parse(point.progress),binding=progress.runBinding;
  assert.ok(binding && typeof binding==='object' && !Array.isArray(binding),'writer binding required');
  for(const key of ['project','runSlug','workflowRef','bundleDigest']) {
    assert.ok(typeof binding[key]==='string'&&binding[key].length>0,'writer binding '+key);
    assert.equal(binding[key],context.identity[key],'writer binding '+key);
  }
}
function equalCheckpoint(actual,expected) {
  for(const key of ['progress','plan','inputs'])assert.deepEqual(actual[key],expected[key],'writer checkpoint '+key);
}
async function preflight(root,mode,implementationSession) {
  const expected=checkpoint(root),context=await currentContext(root);
  ownership(context,expected,mode,implementationSession);equalCheckpoint(checkpoint(root),expected);
  return {root,mode,context,expected,session:context.providerSessionId};
}
function checkOwnedLock(cap) {
  if(cap.lock){const actual=statSync(cap.lock.path);assert.ok(actual.dev===cap.lock.dev&&actual.ino===cap.lock.ino&&actual.size===0,'writer lock changed');}
}
async function recheck(cap) {
  const context=await currentContext(cap.root);
  checkOwnedLock(cap);
  checkReleaseState(cap);
  assert.deepEqual(context,cap.context,'writer authority changed');
  const actual=checkpoint(cap.root);ownership(context,actual,cap.mode,cap.session);equalCheckpoint(actual,cap.expected);
}
function publishProgress(cap,progress) {
  equalCheckpoint(checkpoint(cap.root),cap.expected);
  const raw=JSON.stringify(progress,null,2)+'\n';
  save(cap.root,progressPath,progress);cap.expected.progress=raw;
  equalCheckpoint(checkpoint(cap.root),cap.expected);
}
async function locked(cap,operation) {
  await recheck(cap);
  const path=confined(cap.root,'evidence/enterprise/gate.lock');let fd,owned;
  try {
    // A collision must not touch the other owner's bytes or remove its lock.
    assert.ok(!existsSync(path),'writer lock already exists');
    mkdirSync(dirname(path),{recursive:true});fd=openSync(path,'wx');owned=fstatSync(fd);cap.lock={path,dev:owned.dev,ino:owned.ino};fsyncSync(fd);syncDirectory(dirname(path));
    await recheck(cap);return await operation(cap);
  } finally {
    if(fd!==undefined) {
      // Keep the descriptor open while identifying the inode. After a completed
      // release unlock this path may already belong to the next writer.
      try{if(!cap.unlocked&&existsSync(path)){const now=statSync(path);if(!cap.retainFence&&now.dev===owned.dev&&now.ino===owned.ino&&now.size===0){unlinkSync(path);syncDirectory(dirname(path));}}}
      finally{closeSync(fd);}
    }
  }
}
export async function runBatchGate(root,plan,batch,implementationSession,validateOnly=false) {
  assert.ok(arguments.length<=5,'writer authority overrides rejected');
  const cap=await preflight(root,'batch',implementationSession);
  assert.deepEqual(plan,JSON.parse(cap.expected.plan),'writer supplied plan');
  assert.deepEqual(batch,plan.batches.find(b=>b.id===batch.id),'writer supplied batch');
  return locked(cap,()=>runOwnedBatch(cap,plan,batch,validateOnly));
}
async function executeOwned(cap,batchId,suites) {
  await recheck(cap);
  const run=execute(cap.root,batchId,suites,cap.session);
  try {
    if(cap.release){
      const before=cap.release.runRaw===null?{schemaVersion:1,runs:[]}:JSON.parse(cap.release.runRaw);
      before.runs.push({id:run.id,batchId,path:`evidence/enterprise/runs/${run.id}/receipt.json`});
      const expected=JSON.stringify(before,null,2)+'\n';
      assert.equal(optionalRaw(cap.root,runIndexPath),expected,'writer run index changed during execution');
      cap.release.runRaw=expected;
    }
    await recheck(cap);}
  catch(error) {
    // Keep actual subprocess evidence. A failed writer checkpoint cannot leave
    // this new receipt eligible for ordinary latest-success validation.
    run.status='failed';run.error='writer checkpoint invalidated: '+error.message;run.finishedAt=new Date().toISOString();
    save(cap.root,`evidence/enterprise/runs/${run.id}/receipt.json`,run);
    throw error;
  }
  return run;
}
// Normal batch delivery must retain the exact validated predecessor receipts.
// Re-executing them on unchanged inputs replaces the independently reviewed
// receipt and makes a later selection reject its otherwise valid approval.
async function runOwnedBatch(cap,plan,batch,validateOnly=false) {
  const {root,session:implementationSession}=cap;
  await recheck(cap);
  const position=plan.batches.findIndex(b=>b.id===batch.id);
  assert.ok(position>=0,'unknown active batch');
  const runs=[];
  for(const b of plan.batches.slice(0,position+1)) {
    await recheck(cap);
    const suites=suitesFor(plan,b.issueIds);
    let run;
    if(validateOnly) run=validateLatest(root,b.id,suites);
    else if(b.id===batch.id) run=await executeOwned(cap,b.id,suites);
    else {
      const entry=read(root,'evidence/enterprise/runs/index.json').runs.filter(r=>r.batchId===b.id).at(-1);
      assert.ok(entry,'missing predecessor run');
      const prior=read(root,entry.path);
      assert.equal(prior.id,entry.id);assert.equal(prior.batchId,b.id);
      // Never hide a failed/running latest receipt or modified prior outputs.
      validateRunEvidence(root,prior,suites);
      // Authenticated selection may survive a source edit. In that case fresh
      // execution is required and its new receipt still needs independent review.
      run=prior.inputs.digest===inputs(root).digest?validateLatest(root,b.id,suites):await executeOwned(cap,b.id,suites);
    }
    await recheck(cap);
    runs.push({batchId:b.id,runId:run.id,receiptHash:hash(JSON.stringify(run)),inputsDigest:run.inputs.digest});
  }
  return runs;
}
export async function main(root,args,implementationSession) {
  assert.ok(arguments.length<=3,'writer authority overrides rejected');
  assert.ok(['batch','all'].includes(args[0]),'unknown mode');
  const cap=await preflight(root,args[0],implementationSession);
  return locked(cap,()=>mainOwned(cap,args));
}
async function mainOwned(cap,args) {
  const {root,session:implementationSession}=cap;
  await recheck(cap);
  const [mode,...rest]=args;assert.ok(['batch','all'].includes(mode),'usage: verify.mjs batch [--batch B00] [--validate-only] | all [--validate-only]');
  assert.ok(rest.every((v,i)=>v==='--batch'||v==='--validate-only'||(rest[i-1]==='--batch'&&/^B\d{2}[A-Z]?$/.test(v))),'unknown argument');
  const plan=read(root,'work/enterprise/plan.json'),progressPath='work/enterprise/progress.json';
  validatePlan(root,plan,read(root,'work/enterprise/backlog.json'));
  const requested=rest.includes('--batch')?rest[rest.indexOf('--batch')+1]:null;
  if(rest.includes('--batch')) assert.ok(plan.batches.some(b=>b.id===requested),'unknown batch');
  const progress=read(root,progressPath);
  let batch;
  if(mode==='batch') {
    if(progress.activeBatchId) {
      assert.ok(!requested||requested===progress.activeBatchId,'active batch swap');batch=plan.batches.find(b=>b.id===progress.activeBatchId);
      assert.ok(batch,'unknown active batch');
      await validateSelection(root,plan,batch,progress,suitesFor);
      await recheck(cap);
    }
    else {
      batch=plan.batches.find(b=>!progress.approvals[b.id]);assert.ok(batch,'no pending batch');assert.ok(!requested||requested===batch.id,'not earliest pending batch');
      const selection=await createSelection(root,plan,batch,suitesFor,progress.approvals);
      await recheck(cap);
      progress.entrySelection=`evidence/enterprise/selections/${randomUUID()}.json`;save(root,progress.entrySelection,selection);
      progress.entrySelectionHash=hash(readFileSync(confined(root,progress.entrySelection)));
      progress.activeBatchId=batch.id;progress.entryInputs=selection.inputsDigest;progress.entryApprovals=hash(JSON.stringify(progress.approvals));
      progress.selectedAt=new Date().toISOString();publishProgress(cap,progress);
    }
  } else batch={id:'all',issueIds:plan.issues.filter(i=>!i.children.length).map(i=>i.id)};
  assert.ok(batch,'unknown active batch');
  // All predecessors must still validate against the complete current inputs.
  // Release sealing deliberately performs its separate full fresh execution.
  const runs=mode==='batch'?await runOwnedBatch(cap,plan,batch,rest.includes('--validate-only')):[];
  if(mode==='all') for(const b of [...plan.batches,batch]) {
    await recheck(cap);
    const suites=suitesFor(plan,b.issueIds);
    const run=rest.includes('--validate-only')?validateLatest(root,b.id,suites):await executeOwned(cap,b.id,suites);
    await recheck(cap);
    runs.push({batchId:b.id,runId:run.id,receiptHash:hash(JSON.stringify(run)),inputsDigest:run.inputs.digest});
  }
  await recheck(cap);
  for(const id of batch.issueIds) progress.issues[id]={status:'READY_FOR_REVIEW',runs};
  progress.lastGate={mode,batchId:batch.id,status:'MACHINE_EVIDENCE_CURRENT',runs};publishProgress(cap,progress);
  if(mode==='batch') {await recheck(cap);progress.lastGate.closureCandidate=createClosureCandidate(root,plan,batch.id);publishProgress(cap,progress);}
  console.log(JSON.stringify(progress.lastGate));
  return progress.lastGate;
}

const releaseIndexPath='evidence/enterprise/releases/index.json';
const runIndexPath='evidence/enterprise/runs/index.json';
const optionalRaw=(root,path)=>existsSync(confined(root,path))?readFileSync(confined(root,path),'utf8'):null;
function syncDirectory(path){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
function checkReleaseState(cap){
  if(!cap.release)return;
  assert.equal(optionalRaw(cap.root,releaseIndexPath),cap.release.indexRaw,'writer release index changed');
  assert.equal(optionalRaw(cap.root,runIndexPath),cap.release.runRaw,'writer run index changed');
  if(cap.release.artifacts)assert.deepEqual(snapshot(cap.root,cap.release.artifactPaths),cap.release.artifacts,'writer release artifacts changed');
}
// Cooperative raw-index CAS, immutable history, durable atomic publication. The
// expected bytes advance only for this writer's own completed rename.
function appendRelease(cap,entry){
  checkOwnedLock(cap);
  const r=cap.release,path=confined(cap.root,releaseIndexPath);
  assert.equal(optionalRaw(cap.root,releaseIndexPath),r.indexRaw,'writer release index CAS');
  const index=r.indexRaw===null?{schemaVersion:1,attempts:[]}:JSON.parse(r.indexRaw);
  index.attempts.push(entry);const raw=JSON.stringify(index,null,2)+'\n';
  const temporary=path+'.'+randomUUID()+'.tmp';let fd;
  try {
    mkdirSync(dirname(path),{recursive:true});syncDirectory(dirname(dirname(path)));
    fd=openSync(temporary,'wx');writeFileSync(fd,raw);fsyncSync(fd);closeSync(fd);fd=undefined;
    checkOwnedLock(cap);assert.equal(optionalRaw(cap.root,releaseIndexPath),r.indexRaw,'writer release index CAS');
    if(entry.status!=='failed'){checkReleaseState(cap);equalCheckpoint(checkpoint(cap.root),cap.expected);}
    renameSync(temporary,path);r.indexRaw=raw;fsyncIndex();
  } catch(error){cap.retainFence=true;throw error;}
  finally{if(fd!==undefined)closeSync(fd);}
  function fsyncIndex(){syncDirectory(dirname(path));assert.equal(optionalRaw(cap.root,releaseIndexPath),raw,'writer release index readback');}
}
function stageSeal(cap,path,seal){
  checkOwnedLock(cap);checkReleaseState(cap);equalCheckpoint(checkpoint(cap.root),cap.expected);
  const p=confined(cap.root,path),raw=JSON.stringify(seal,null,2)+'\n';
  mkdirSync(dirname(p),{recursive:true});syncDirectory(dirname(dirname(p)));
  const fd=openSync(p,'wx');try{writeFileSync(fd,raw);fsyncSync(fd);}finally{closeSync(fd);}
  syncDirectory(dirname(p));assert.equal(readFileSync(p,'utf8'),raw,'seal staging readback');return hash(raw);
}
function priorReviewBatches(plan) {
 return plan.batches.filter(batch=>{
   if(batch.reviewStage==='final-audit') {
     assert.ok(['harden-release','final-audit'].includes(batch.stage),'invalid deferred review stage');
     assert.ok(batch.issueIds.every(id=>/^ENT-70[1-5]$/.test(id)),'implementation review cannot be deferred');return false;
   }
   assert.equal(batch.reviewStage,'review-foundation','unknown batch review stage');return true;
 });
}
function unlockRelease(cap){
  checkOwnedLock(cap);
  try{unlinkSync(cap.lock.path);syncDirectory(dirname(cap.lock.path));cap.unlocked=true;}
  catch(error){
    cap.retainFence=true;
    // A failed directory flush after unlink has an uncertain durable outcome.
    // Re-establish a fence exclusively; never replace a concurrent owner's lock.
    if(!existsSync(cap.lock.path)){
      const fd=openSync(cap.lock.path,'wx');
      try{const stat=fstatSync(fd);cap.lock={path:cap.lock.path,dev:stat.dev,ino:stat.ino};fsyncSync(fd);}finally{closeSync(fd);}
      syncDirectory(dirname(cap.lock.path));
    }
    throw error;
  }
}
// The entire mutating attempt is private to the real authenticated locked writer.
async function sealOwned(cap) {
 const {root,context}=cap,bytes=p=>readFileSync(confined(root,p));
 const releaseId=`${Date.now()}-${randomUUID()}`,sealPath=`evidence/enterprise/releases/${releaseId}/seal.json`;
 cap.release={indexRaw:optionalRaw(root,releaseIndexPath),runRaw:optionalRaw(root,runIndexPath)};
 try {
   await recheck(cap);
   appendRelease(cap,{releaseId,status:'running',startedAt:new Date().toISOString()});
   await mainOwned(cap,['all']);await recheck(cap);
   const plan=read(root,'work/enterprise/plan.json');validatePlan(root,plan,read(root,'work/enterprise/backlog.json'));
   const machineIndex=read(root,runIndexPath),receipts=[],outputPaths=[],approvals=[];
   const batches=[...plan.batches,{id:'all',issueIds:plan.issues.filter(i=>!i.children.length).map(i=>i.id)}];
   for(const batch of batches){
     const run=validateLatest(root,batch.id,suitesFor(plan,batch.issueIds)),entry=machineIndex.runs.filter(r=>r.batchId===batch.id).at(-1);
     receipts.push({batchId:batch.id,runId:run.id,path:entry.path,sha256:hash(bytes(entry.path)),legacyReceiptHash:hash(JSON.stringify(run))});
     outputPaths.push(...run.suites.map(s=>s.outputDirectory));
   }
   const progress=read(root,progressPath),reviewedBatches=[];
   for(const batch of priorReviewBatches(plan)){
     const approval=progress.approvals?.[batch.id];assert.ok(approval,'independent batch approval required');
     const entry=machineIndex.runs.filter(r=>r.batchId===batch.id).find(r=>hash(JSON.stringify(read(root,r.path)))===approval.receiptHash);
     assert.ok(entry,'review receipt missing');const reviewed=read(root,entry.path);
     outputPaths.push(...reviewed.suites.map(s=>s.outputDirectory));reviewedBatches.push({batch,approval,entry,reviewed});
   }
   cap.release.artifactPaths=[...outputPaths,...receipts.map(r=>r.path),...reviewedBatches.flatMap(r=>[r.entry.path,r.approval.report])];
   cap.release.artifacts=snapshot(root,cap.release.artifactPaths);
   for(const {batch,approval,entry,reviewed} of reviewedBatches){
     validateRun(root,reviewed,suitesFor(plan,batch.issueIds));await validateApproval(root,approval,reviewed,batch.issueIds);await recheck(cap);
     approvals.push({...approval,batchId:batch.id,receiptPath:entry.path,receiptSha256:hash(bytes(entry.path))});
   }
   // Required even when there are no independently reviewed predecessor batches.
   await recheck(cap);
   const seal={schemaVersion:1,releaseId,createdAt:new Date().toISOString(),context:context.identity,builderSessions:context.builderSessions,
     inputs:inputs(root),issues:plan.issues,planHash:hash(bytes('work/enterprise/plan.json')),
     coverageHash:hash(bytes('work/enterprise/coverage.json')),scopeRevision:read(root,'work/enterprise/scope-revision.json'),
     receipts,outputRoots:[...new Set(outputPaths)],outputs:snapshot(root,outputPaths),approvals,runIndex:machineIndex,releasePrefix:JSON.parse(cap.release.indexRaw),
     protectedFiles:snapshot(root,plan.protectedFiles.map(f=>f.path)),
     regressionIndex:plan.issues.flatMap(i=>i.suites.map(s=>({issueId:i.id,id:s.id,path:s.path}))),
     limitations:['Synthetic reference services only; no production effects.','GitHub destination pending.']};
   for(const p of plan.protectedFiles)assert.equal(seal.protectedFiles.entries.find(e=>e.path===p.path).sha256,p.sha256,'protected file changed');
   await recheck(cap);
   const sealDigest=stageSeal(cap,sealPath,seal);
   cap.release.artifactPaths.push(sealPath);cap.release.artifacts=snapshot(root,cap.release.artifactPaths);
   await validateSealCandidate(root,sealPath,sealDigest,suitesFor);await recheck(cap);
   appendRelease(cap,{releaseId,status:'passed',sealPath,sealDigest});
   await validateSealCandidate(root,sealPath,sealDigest,suitesFor);await recheck(cap);
   unlockRelease(cap);
   return {status:'MACHINE_EVIDENCE_SEALED',releaseId,releaseDigest:sealDigest};
 } catch(error){
   // Recording failure does not require the concurrently changed projection to
   // become ours again. Only the owned fence and exact index may be consumed.
   try{appendRelease(cap,{releaseId,status:'failed',error:error.message});}
   catch(recordError){cap.retainFence=true;throw new AggregateError([error,recordError],error.message+'; failure recording: '+recordError.message);}
   throw error;
 }
}

export async function dispatch(root,args) {
  if(args.length===1&&args[0]==='batch'){
    const context=await currentContext(root),request=`evidence/enterprise/preparation/${context.identity.runSlug}/request.json`;
    if([request,request.replace('request.json','recovery.lock'),request.replace('request.json','recovery-journal.json')].some(path=>existsSync(confined(root,path)))){
      const {inspectPreparationComponent}=await import('./runtime-preparation.mjs');
      const result=await inspectPreparationComponent(root);assert.ok(result,'preparation request disappeared');console.log(JSON.stringify(result));return result;
    }
  }
  if(args.includes('--recover-rejected')) {assert.deepEqual(args,['batch','--recover-rejected']);const result=await regenerateRejected(root);console.log(JSON.stringify(result));return result;}
  if(args.includes('--import-closure')) {assert.deepEqual(args,['batch','--import-closure']);const result=await importClosure(root);console.log(JSON.stringify(result));return result;}
  if(args.includes('--initialize-run')) {
    assert.deepEqual(args,['batch','--initialize-run'],'usage: batch --initialize-run');
    const result=await initializeRun(root,suitesFor);console.log(JSON.stringify(result));return result;
  }
  let mode=args[0],context;
  // Resolve legacy gates before any mkdir, lock, subprocess or progress update.
  if(mode==='all') {
    context=await currentContext(root);
    if(args.length===1) {
      if(context.step==='final-audit') {mode='final';args=['final','--check-report'];}
      else assert.equal(context.step,'harden-release','legacy all context unavailable');
    } else assert.deepEqual(args,['all','--seal'],'usage: all --seal');
    if(mode==='all') assert.equal(context.step,'harden-release','explicit seal during final rejected');
  }
  if(mode==='final') {
    assert.ok(args.length===2 && ['--check-seal','--check-report'].includes(args[1]),'usage: final --check-seal|--check-report');
    const result=await checkFinal(root,args[1]==='--check-report',suitesFor);console.log(JSON.stringify(result));return result;
  }
  assert.ok(['batch','all'].includes(mode),'unknown mode');
  const cap=await preflight(root,mode);context=cap.context;
  if(mode==='batch' && (args.length===1 || (args.length===3 && args[1]==='--batch'))) {
    const progress=read(root,'work/enterprise/progress.json'),plan=read(root,'work/enterprise/plan.json');
    if(progress.activeBatchId && (args.length===1 || args[2]===progress.activeBatchId)){
      try {await validateSelection(root,plan,plan.batches.find(b=>b.id===progress.activeBatchId),progress,suitesFor);}
      catch(error){if(error.message!=='batch approval superseded by later review' && error.message!=='closure member superseded')throw error;
        try{await recheck(cap);const result=await regenerateRejected(root);console.log(JSON.stringify(result));return result;}catch(recoveryError){throw Error(error.message+'; recovery: '+recoveryError.message);}}
    }
  }
  const result=await locked(cap,async()=>{
    if(mode==='batch') return mainOwned(cap,args);
    return sealOwned(cap);
  });
  // Delivery happens only after the durable validated publication and unlock.
  if(mode==='all')console.log(JSON.stringify(result));
  return result;
}
if(process.argv[1] && import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href) {
  const root=resolve(import.meta.dirname,'../..');
  try {await dispatch(root,process.argv.slice(2));}
  catch(error) {console.error(`enterprise-verify: ${error.message}`);process.exitCode=1;}
}
