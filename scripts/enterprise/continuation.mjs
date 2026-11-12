// New-run projection writer. Historical approvals establish provenance only;
// they never authorize a current batch or become current approval pointers.
import assert from 'node:assert/strict';
import {existsSync,readFileSync,mkdirSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,unlinkSync,linkSync} from 'node:fs';
import {dirname,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {currentContext} from './context.mjs';
import {batchAttestation,validateBatchReview} from './approval.mjs';
import {hash,confined,inputs,snapshot,validatePlan,validateRunEvidence} from './evidence.mjs';
import {createSelection} from './selection.mjs';

const progressPath='work/enterprise/progress.json';
const bytes=(root,p)=>readFileSync(confined(root,p));
const read=(root,p)=>JSON.parse(bytes(root,p));
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
function syncDirectory(path) {const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
export function immutable(root,path,raw) {
 const absolute=confined(root,path);mkdirSync(dirname(absolute),{recursive:true});
 if(existsSync(absolute)){assert.deepEqual(readFileSync(absolute),raw,'changed initialization checkpoint');return;}
 // Never expose a partially written checkpoint. Publish a fully synced inode
 // with a no-clobber link; a crash can leave only an unreferenced temporary.
 const temporary=absolute+'.'+randomUUID()+'.tmp';
 try {
   const fd=openSync(temporary,'wx');try{writeFileSync(fd,raw);fsyncSync(fd);}finally{closeSync(fd);}
   try{linkSync(temporary,absolute);}catch(error){
     if(error.code!=='EEXIST')throw error;
     assert.deepEqual(readFileSync(absolute),raw,'changed initialization checkpoint');
   }
   syncDirectory(dirname(absolute));
 } finally {
   if(existsSync(temporary)){unlinkSync(temporary);syncDirectory(dirname(absolute));}
 }
}
export function atomic(root,path,raw) {
 // Stage outside authored work/: a crash must not turn the temporary projection
 // into a new source input and invalidate the durable recovery checkpoint.
 const absolute=confined(root,path),temporary=confined(root,'evidence/enterprise/progress-'+randomUUID()+'.tmp');
 const fd=openSync(temporary,'wx');try{writeFileSync(fd,raw);fsyncSync(fd);}finally{closeSync(fd);}
 try{renameSync(temporary,absolute);syncDirectory(dirname(absolute));}
 finally{if(existsSync(temporary))unlinkSync(temporary);}
}
function trustedWriter(context) {
 assert.equal(context.step,'build-foundation','initialization requires build-foundation');
 assert.equal(context.sessionKey,'enterprise-builder','initialization builder session');
 assert.equal(context.stepDefinition.edit,true,'initialization requires writable context');
 assert.ok(context.providerSessionId,'initialization provider session unavailable');
 assert.ok(context.start.provider==='codex' && ['gpt-6.1-sol','gpt-6-sol','gpt-6-astra'].includes(context.start.model),'initialization runtime routing');
}
// All provenance checks are read-only and precede even lock/directory creation.
export async function prepareInitialization(root) {
 const context=await currentContext(root);trustedWriter(context);
 const raw=bytes(root,progressPath),progress=JSON.parse(raw);
 assert.notEqual(progress.runBinding?.runSlug,context.identity.runSlug,'run already initialized; active batch retained');
 const plan=read(root,'work/enterprise/plan.json');validatePlan(root,plan,read(root,'work/enterprise/backlog.json'));
 assert.ok(progress.entrySelection && progress.entrySelectionHash,'old selection provenance missing');
 const selectionRaw=bytes(root,progress.entrySelection);assert.equal(hash(selectionRaw),progress.entrySelectionHash,'changed old selection');
 const selection=JSON.parse(selectionRaw),oldPlan=JSON.parse(selection.planText);
 const active=oldPlan.batches.findIndex(b=>b.id===progress.activeBatchId);
 assert.ok(active>0 && selection.batchId===progress.activeBatchId,'old selection batch provenance');
 assert.deepEqual(selection.predecessors.map(p=>p.batchId),oldPlan.batches.slice(0,active).map(b=>b.id),'old selection prerequisite set');
 const pointers=[...selection.predecessors.map(p=>({approval:p.approval,runId:p.runId,batchId:p.batchId})),
   ...Object.entries(progress.approvals??{}).map(([batchId,approval])=>({approval,batchId}))];
 assert.ok(pointers.length,'old review provenance missing');
 const references=new Set([progress.entrySelection,'evidence/enterprise/runs/index.json']);let oldRun;
 for(const {approval,runId,batchId} of pointers) {
   assert.equal(approval?.verdict,'APPROVE','old review approval missing');
   const report=bytes(root,approval.report);assert.equal(hash(report),approval.reportHash,'changed old review report');
   let att=batchAttestation(report.toString());
   if(approval.closure){
     const {closureAttestation}=await import('./closure.mjs');const closure=closureAttestation(report.toString());
     const member=closure.members.find(m=>m.batchId===batchId);assert.ok(member,'old closure member missing');
     att={...closure,...member};references.add(approval.closure.candidatePath);
   }
   assert.ok(att.runSlug && att.runSlug!==context.identity.runSlug,'old approval must belong to a different run');
   oldRun??=att.runSlug;assert.equal(att.runSlug,oldRun,'mixed old review provenance');
   assert.equal(att.batchId,batchId,'old review batch identity');
   if(runId)assert.equal(att.runId,runId,'old selection receipt identity');
   const path=`evidence/enterprise/runs/${att.runId}/receipt.json`,run=read(root,path);
   assert.equal(run.id,att.runId,'old receipt identity');assert.equal(run.batchId,batchId,'old receipt batch');
   assert.equal(run.status,'passed','old reviewed receipt failed');
   assert.equal(approval.receiptHash,hash(JSON.stringify(run)),'old review receipt hash');
   assert.equal(approval.inputsDigest,run.inputs.digest,'old review inputs');
   assert.notEqual(approval.session,run.implementationSession,'old self approval');
   assert.deepEqual([...approval.issueIds].sort(),[...att.approvedIssueIds].sort(),'old approval Issue scope');
   if(approval.closure){const {validateClosureApproval}=await import('./closure.mjs');await validateClosureApproval(root,approval,run,approval.issueIds,{historicalRunSlug:oldRun});}
   else await validateBatchReview(root,approval,run,approval.issueIds,{historicalRunSlug:oldRun});
   if(runId)assert.equal(run.inputs.entries.find(e=>e.path==='work/enterprise/plan.json')?.sha256,hash(selection.planText),'old selection plan not reviewed');
   for(const suite of run.suites) {
     assert.equal(suite.exitCode,0,'old suite failed');assert.equal(suite.signal,null,'old suite signal');
     assert.equal(hash(bytes(root,suite.stdout)),suite.stdoutHash,'changed old stdout');
     assert.equal(hash(bytes(root,suite.stderr)),suite.stderrHash,'changed old stderr');
     assert.deepEqual(snapshot(root,[suite.outputDirectory]),suite.outputs,'changed old artifacts');
   }
   references.add(path);references.add(approval.report);
 }
 if(progress.runBinding)assert.equal(progress.runBinding.runSlug,oldRun,'old projection run provenance');
 // Resolve the latest completed canonical review even if no progress pointer
 // imported it. Central report bytes are never copied into current approvals.
 const historical=await currentContext(root,{requireSession:false,historicalRunSlug:oldRun});
 const latest=historical.records.filter(r=>r.type==='step_start'&&r.step==='review-foundation').at(-1);
 assert.ok(latest,'old latest review missing');
 const definition=historical.steps.find(s=>s.name==='review-foundation');
 const contracts=definition.outputContracts?.filter(o=>o.name?.endsWith('.md'))??[];
 assert.equal(contracts.length,1,'old canonical report contract missing or ambiguous');
 const canonical=confined(historical.identity.runRoot,relative(historical.identity.runRoot,historical.identity.reportDirectory)+'/'+contracts[0].name);
 const reportRaw=readFileSync(canonical),att=batchAttestation(reportRaw.toString());
 assert.equal(att.iteration,latest.iteration,'old canonical review is not latest');
 assert.equal(att.batchId,progress.activeBatchId,'old canonical review active scope');
 const receiptPath=`evidence/enterprise/runs/${att.runId}/receipt.json`,reviewed=read(root,receiptPath);
 let rejectionHistory;
 if(att.verdict==='APPROVE'){
   const {revalidationInitializationHistory}=await import('./rejected-regeneration.mjs');
   rejectionHistory=revalidationInitializationHistory(root,historical,progress,reportRaw.toString());
 }
 if(att.verdict==='REQUEST_CHANGES'||rejectionHistory){
   assert.equal(context.start.model,'gpt-6-astra','rejection initialization requires Astra');
   assert.equal(context.start.providerOptions?.codex?.reasoningEffort,'high','rejection initialization requires high effort');
   const {rejectedInitializationHistory}=await import('./rejected-regeneration.mjs');
   rejectionHistory=rejectedInitializationHistory(root,historical,progress,context);
   for(const path of rejectionHistory.references)references.add(path);
 }else{
 const batch=oldPlan.batches.find(b=>b.id===att.batchId);
 assert.ok(batch,'old canonical batch missing from original plan');
 assert.equal(reviewed.inputs.entries.find(e=>e.path==='work/enterprise/plan.json')?.sha256,hash(selection.planText),'old canonical plan not reviewed');
 const suites=[...new Map(batch.issueIds.flatMap(id=>oldPlan.issues.find(i=>i.id===id).suites).filter(s=>s.id!=='complete-machine-gate').map(s=>[s.id,s])).values()];
 validateRunEvidence(root,reviewed,suites);
 const pointer={verdict:att.verdict,session:att.providerSessionId,issueIds:att.approvedIssueIds,inputsDigest:att.inputsDigest,receiptHash:att.receiptHash};
 await validateBatchReview(root,pointer,reviewed,batch.issueIds,{historicalRunSlug:oldRun,reportRaw});
 }
 const latestIndex=read(root,'evidence/enterprise/runs/index.json').runs.filter(r=>r.batchId===att.batchId).at(-1);
 if(!rejectionHistory?.failedTail.length)assert.equal(latestIndex?.id,reviewed.id,'old canonical receipt is not latest');
 else assert.deepEqual(read(root,'evidence/enterprise/runs/index.json').runs,rejectionHistory.latestIndex,'changed authenticated failed tail index');
 references.add(receiptPath);
 const unimported={historyOnly:true,currentApprovals:[],reportSha256:hash(reportRaw),receiptPath,receiptSha256:hash(bytes(root,receiptPath)),
   attestation:att,canonical,authority:historical.authority,...(rejectionHistory?{recovery:rejectionHistory}:{})};
 // Refuse unknown/live writers before mkdir or lock publication. A dead lock
 // from this new-run initializer remains resumable through acquire's CAS.
 const lock=confined(root,'evidence/enterprise/gate.lock');
 if(existsSync(lock)){
  let owner;try{owner=JSON.parse(readFileSync(lock));}catch{throw Error('gate writer active or unknown');}
  assert.equal(owner.kind,'enterprise-run-initialization','gate writer active or unknown');assert.equal(owner.runSlug,context.identity.runSlug,'other initializer lock');assert.ok(Number.isInteger(owner.pid)&&owner.pid>0,'invalid initializer lock');
  try{process.kill(owner.pid,0);throw Error('initializer still active');}catch(e){if(e.code!=='ESRCH')throw e;}
 }
 const before=inputs(root),files=snapshot(root,[...references]);
 assert.deepEqual(await currentContext(root),context,'concurrent initialization authority change');
 assert.deepEqual(bytes(root,progressPath),raw,'concurrent old progress change');
 return {context,raw,oldRun,before,files,plan,unimported,reportRaw,historical};
}
// Serialize stale-lock replacement on the stable directory inode. The kernel
// releases flock even if the helper dies; no second persistent lock can become
// stale. Ordinary gate writers still compete through exclusive creation/link.
const recoverLock=`import os, sys, json, base64, fcntl
gate, temporary, expected, run = sys.argv[1:]
directory = os.open(os.path.dirname(gate), os.O_RDONLY)
try:
    try:
        fcntl.flock(directory, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise RuntimeError('initializer recovery busy')
    with open(gate, 'rb') as stream:
        raw = stream.read()
    if raw != base64.b64decode(expected):
        raise RuntimeError('concurrent initializer lock change')
    owner = json.loads(raw)
    if owner.get('kind') != 'enterprise-run-initialization' or owner.get('runSlug') != run:
        raise RuntimeError('invalid initializer lock')
    pid = owner.get('pid')
    if type(pid) is not int or pid <= 0:
        raise RuntimeError('invalid initializer lock')
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        pass
    else:
        raise RuntimeError('initializer still active')
    os.unlink(gate)
    os.link(temporary, gate)
    os.fsync(directory)
finally:
    os.close(directory)
`;
// A dead initializer may leave this lock. Only our exact, parseable lock format
// can be recovered; an ordinary batch writer's empty lock is never removed.
export function acquire(root,context) {
 const path=confined(root,'evidence/enterprise/gate.lock');mkdirSync(dirname(path),{recursive:true});let stale;
 if(existsSync(path)) {
   const raw=readFileSync(path);let owner;try{owner=JSON.parse(raw);}catch{throw Error('gate writer active or unknown');}
   assert.equal(owner.kind,'enterprise-run-initialization','gate writer active or unknown');
   assert.equal(owner.runSlug,context.identity.runSlug,'other initializer lock');
   assert.ok(Number.isInteger(owner.pid)&&owner.pid>0,'invalid initializer lock');
   try{process.kill(owner.pid,0);throw Error('initializer still active');}catch(error){if(error.code!=='ESRCH')throw error;}
   assert.deepEqual(readFileSync(path),raw,'concurrent initializer lock change');stale=raw;
 }
 // Publish only a complete, durable owner record. A partial write or a killed
 // staging writer must never leave an unparseable canonical gate lock.
 const raw=encode({kind:'enterprise-run-initialization',pid:process.pid,runSlug:context.identity.runSlug});
 const temporary=`${path}.${randomUUID()}.tmp`;let fd,published=false;
 const release=()=>{assert.deepEqual(readFileSync(path),raw,'concurrent initializer lock change');unlinkSync(path);syncDirectory(dirname(path));};
 try {
   fd=openSync(temporary,'wx');writeFileSync(fd,raw);fsyncSync(fd);closeSync(fd);fd=undefined;
   // link is exclusive: a batch writer arriving after our ownership check wins.
   if(stale) {
     const result=spawnSync('python3',['-c',recoverLock,path,temporary,stale.toString('base64'),context.identity.runSlug],{encoding:'utf8',timeout:10000});
     assert.equal(result.status,0,'initializer recovery failed: '+(result.error?.message??result.stderr??result.signal));
   } else linkSync(temporary,path);
   published=true;syncDirectory(dirname(path));
 } catch(error) {
   if(published)release();
   throw error;
 } finally {
   if(fd!==undefined)closeSync(fd);
   if(existsSync(temporary))unlinkSync(temporary);
 }
 return release;
}
async function stableInitialization(root,prepared){
 const {context,raw,oldRun,before,files,unimported,reportRaw,historical}=prepared;
 assert.deepEqual(bytes(root,progressPath),raw,'concurrent old progress change');
 assert.deepEqual(inputs(root),before,'concurrent initialization input change');
 assert.deepEqual(snapshot(root,files.entries.map(e=>e.path)),files,'concurrent old evidence change');
 assert.deepEqual(readFileSync(unimported.canonical),reportRaw,'concurrent old canonical report change');
 assert.deepEqual(await currentContext(root,{requireSession:false,historicalRunSlug:oldRun}),historical,'concurrent historical authority change');
 assert.deepEqual(await currentContext(root),context,'concurrent initialization authority change');
 if(unimported.recovery){
   const {rejectedInitializationHistory}=await import('./rejected-regeneration.mjs');
   assert.deepEqual(rejectedInitializationHistory(root,historical,JSON.parse(raw),context),unimported.recovery,'concurrent recovery history change');
 }
}
export async function initializeRun(root,suitesFor) {
 const prepared=await prepareInitialization(root),{context,raw,oldRun,before,files,plan,unimported,reportRaw,historical}=prepared;
 const unlock=acquire(root,context);
 try {
   assert.deepEqual(bytes(root,progressPath),raw,'concurrent old progress change');
   assert.deepEqual(inputs(root),before,'concurrent initialization input change');
   await stableInitialization(root,prepared);
   const archive=`evidence/enterprise/continuations/${context.identity.runSlug}-${hash(raw)}`;
   immutable(root,`${archive}/progress.json`,raw);
   immutable(root,`${archive}/unimported-review.md`,reportRaw);
   // Immutable copies of every authority pointer and receipt; original runs,
   // outputs and indexes remain in place and are fingerprinted, never deleted.
   for(const entry of files.entries)immutable(root,`${archive}/files/${entry.path}`,bytes(root,entry.path));
   const selection=await createSelection(root,plan,plan.batches[0],suitesFor,{});
   assert.equal(plan.batches[0].id,'B00','initial batch must be B00');
   const selectionPath=`${archive}/selection.json`,selectionRaw=encode(selection);
   // A published manifest is a complete checkpoint: do not repair a missing
   // or changed selection silently when resuming it.
   if(existsSync(confined(root,`${archive}/manifest.json`)))
     assert.deepEqual(bytes(root,selectionPath),selectionRaw,'changed selection checkpoint');
   immutable(root,selectionPath,selectionRaw);
   const manifest={schemaVersion:1,oldRunSlug:oldRun,newRunSlug:context.identity.runSlug,
     workflowRef:context.identity.workflowRef,providerSessionId:context.providerSessionId,
     progressSha256:hash(raw),inputsDigest:before.digest,files,selectionSha256:hash(selectionRaw),unimported};
   const manifestRaw=encode(manifest);immutable(root,`${archive}/manifest.json`,manifestRaw);
   // A completed durable manifest is the resume checkpoint. Reread all of it
   // before the sole atomic projection replacement (including after a crash).
   assert.deepEqual(bytes(root,`${archive}/manifest.json`),manifestRaw);
   assert.deepEqual(bytes(root,`${archive}/progress.json`),raw);
   for(const entry of files.entries)assert.equal(hash(bytes(root,`${archive}/files/${entry.path}`)),entry.sha256,'changed archive bytes');
   assert.deepEqual(snapshot(root,files.entries.map(e=>e.path)),files,'concurrent old evidence change');
   assert.deepEqual(readFileSync(unimported.canonical),reportRaw,'concurrent old canonical report change');
   assert.deepEqual(bytes(root,`${archive}/unimported-review.md`),reportRaw,'changed archived canonical report');
   assert.deepEqual(await currentContext(root,{requireSession:false,historicalRunSlug:oldRun}),historical,'concurrent historical authority change');
   assert.deepEqual(await currentContext(root),context,'concurrent initialization authority change');
   assert.deepEqual(inputs(root),before,'concurrent initialization input change');
   assert.deepEqual(bytes(root,progressPath),raw,'concurrent old progress change');
   await stableInitialization(root,prepared);
   const checkpointRaw=bytes(root,`${archive}/manifest.json`),selectionBytes=bytes(root,selectionPath);
   assert.deepEqual(checkpointRaw,manifestRaw,'changed initialization checkpoint');
   assert.deepEqual(selectionBytes,selectionRaw,'changed selection checkpoint');
   assert.equal(hash(selectionBytes),JSON.parse(checkpointRaw).selectionSha256,'selection checkpoint hash');
   const projection={schemaVersion:1,runBinding:context.identity,history:{manifest:`${archive}/manifest.json`,sha256:hash(manifestRaw)},
     activeBatchId:'B00',issues:{},approvals:{},entrySelection:selectionPath,entrySelectionHash:hash(selectionRaw),
     entryInputs:selection.inputsDigest,entryApprovals:hash(JSON.stringify({})),selectedAt:new Date().toISOString()};
   atomic(root,progressPath,encode(projection));
   return {status:'RUN_INITIALIZED_REQUIRES_FRESH_B00',runSlug:context.identity.runSlug,oldRunSlug:oldRun,history:projection.history};
 } finally {unlock();}
}
