import {runtimeFiles} from '../../scripts/enterprise/runtime.mjs';import {createHash} from 'node:crypto';import {gzipSync} from 'node:zlib';import {createRequire} from 'node:module';const {Header}=createRequire(new URL('../../node_modules/takt/package.json',import.meta.url))('tar');
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {join} from 'node:path';import {spawnSync,spawn} from 'node:child_process';
import {fixture,put,read,tree} from './evidence-fixture.mjs';import {hash} from '../../scripts/enterprise/evidence.mjs';
import {savePersonaSessions} from '../../node_modules/takt/dist/infra/config/project/sessionStore.js';
import {loadWorkflowExecutionBundle} from '../../node_modules/takt/dist/features/tasks/execute/workflowExecutionBundle.js';
import {runSingleWorkflowIteration} from '../../node_modules/takt/dist/core/workflow/engine/WorkflowRunLoop.js';
import {createInitialState} from '../../node_modules/takt/dist/core/workflow/engine/state-manager.js';
import {runCommandQualityGate} from '../../node_modules/takt/dist/core/workflow/quality-gates/commandGateRunner.js';
const recovery=['batch','--recover-rejected'],pp=f=>join(f.root,'work/enterprise/progress.json'),ip=f=>join(f.root,'evidence/enterprise/runs/index.json');
const ok=r=>{assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout.trim().split('\n').at(-1));};
const fail=(r,re=/./)=>{assert.notEqual(r.status,0,r.stdout);assert.match(r.stderr,re);assert.doesNotMatch(r.stderr,/FS_MUTATION/);};
function unchanged(f,args=recovery,re=/./){const before=tree(f.temporary);fail(f.cli(args),re);assert.deepEqual(tree(f.temporary),before);}
const file=(f,p)=>join(f.root,p),mutate=(f,p,fn)=>{const x=read(file(f,p));fn(x);put(file(f,p),x);};
function phases(f,step,iteration,content,{incomplete=false,phase1=content}={}){f.context(step,iteration);for(const phase of [1,2])f.append({type:'phase_complete',step,iteration,workflow:f.workflow.name,stack:f.stack(step),phase,status:'done',content:phase===1?phase1:content});if(!incomplete)f.append({type:'step_complete',step,iteration,workflow:f.workflow.name,stack:f.stack(step),status:'done'});put(join(f.run.reportsAbs,step==='review-foundation'?'enterprise-04-review.md':'enterprise-02-review.md'),content+'\n');}
const fenced=(name,a)=>'```'+name+'\n'+JSON.stringify(a)+'\n```';
function design(f,iteration=5,edit=()=>{}){const a={schemaVersion:1,verdict:'APPROVE',runSlug:f.run.slug,workflowRef:f.workflowRef,step:'review-architecture',iteration,sessionKey:'enterprise-architecture-reviewer',providerSessionId:'designer-session',contractPath:'work/enterprise/REJECTED_REGENERATION.md',contractSha256:hash(fs.readFileSync(file(f,'work/enterprise/REJECTED_REGENERATION.md'))),planSha256:hash(fs.readFileSync(file(f,'work/enterprise/plan.json'))),permission:'EVIDENCE_REGENERATION_ONLY',unresolvedFindings:[]};edit(a);phases(f,'review-architecture',iteration,fenced('enterprise-recovery-design-attestation',a));}
function publish(f,ref,iteration=4,verdict='REQUEST_CHANGES',edit=()=>{},options={}){
 const c=read(file(f,ref.candidatePath)),active=c.members.at(-1),findings=verdict==='APPROVE'?[]:['synthetic finding'];
 const common={schemaVersion:1,verdict,runSlug:f.run.slug,workflowRef:f.workflowRef,step:'review-foundation',iteration,sessionKey:'enterprise-batch-reviewer',providerSessionId:'reviewer-session',inputsDigest:c.inputs.digest,unresolvedFindings:findings};
 const l={...common,batchId:active.batchId,runId:active.runId,receiptHash:active.receiptHash,receiptSha256:active.receiptSha256,outputsDigest:active.outputsDigest,approvedIssueIds:verdict==='APPROVE'?active.issueIds:[]};
 const a={...common,activeBatchId:c.activeBatchId,candidatePath:ref.candidatePath,candidateSha256:ref.candidateSha256,members:c.members.map(m=>({batchId:m.batchId,runId:m.runId,receiptHash:m.receiptHash,receiptSha256:m.receiptSha256,outputsDigest:m.outputsDigest,approvedIssueIds:verdict==='APPROVE'?m.issueIds:[],issueEvidence:m.issues.map(i=>({issueId:i.id,decisions:i.acceptanceTests.map(ac=>({id:ac.id,verdict,artifacts:[read(file(f,`evidence/enterprise/runs/${m.runId}/receipt.json`)).suites[0].stdout]}))}))}))};
 if(c.recovery){const r=c.recovery;a.recovery={...(r.schemaVersion===2?{schemaVersion:2}:{}),rootId:r.rootId,attemptId:r.attemptId,headerSha256:r.headerSha256,resultPath:ref.resultPath,resultSha256:ref.resultSha256,...(r.schemaVersion===2?{authority:r.authority}:{parentRejectionReportSha256:r.parentRejectionReportSha256})};}
 edit(a,l);const raw=fenced('enterprise-batch-attestation',l)+'\n'+fenced('enterprise-closure-attestation',a);phases(f,'review-foundation',iteration,raw,options);return a;
}
async function setup(t,{protectedFixture=false}={}){
 const f=await fixture(t,{multi:true,selection:true,seal:false,recovery:true});const p=read(pp(f));p.activeBatchId=null;put(pp(f),p);f.context('build-foundation',3);ok(f.cli(['batch','--batch','B01'],{readonly:false}));
 // Actual registry context supplies the projection identity; it is not an env claim.
 const code="import {currentContext} from './scripts/enterprise/context.mjs'; console.log(JSON.stringify((await currentContext(process.cwd())).identity));";
 const q=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:f.root,env:f.env,encoding:'utf8'});assert.equal(q.status,0,q.stderr);mutate(f,'work/enterprise/progress.json',p=>p.runBinding=JSON.parse(q.stdout));
 f.ref=read(pp(f)).lastGate.closureCandidate;publish(f,f.ref);if(protectedFixture){put(file(f,'evidence/protected.json'),'protected synthetic bytes');mutate(f,'work/enterprise/plan.json',p=>p.protectedFiles=[{path:'evidence/protected.json',sha256:hash('protected synthetic bytes')}]);}put(file(f,'work/enterprise/REJECTED_REGENERATION.md'),'fixture contract');design(f);f.context('build-foundation',6);return f;
}
const run=f=>ok(f.cli(recovery,{readonly:false}));
const attempt=(f,r)=>read(file(f,r.resultPath.replace('result.json','header.json')));
const latest=(f,b)=>read(ip(f)).runs.filter(r=>r.batchId===b).at(-1);
function inject(f,code,args=recovery){const path=join(f.temporary,'inject.mjs');put(path,"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';"+code+';syncBuiltinESMExports();');return spawnSync(process.execPath,['--import',path,file(f,'scripts/enterprise/verify.mjs'),...args],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000});}
test('recovery-exact-rejection-regenerates-prefix-only',async t=>{const f=await setup(t),before=read(ip(f)),r=run(f);assert.equal(r.status,'MACHINE_EVIDENCE_REGENERATED_REVIEW_REQUIRED');assert.deepEqual(read(ip(f)).runs.slice(before.runs.length).map(e=>e.batchId),['B00','B01']);assert.equal(read(file(f,r.resultPath)).status,'passed');});
test('recovery-current-design-approval-required',async t=>{for(const k of ['hash','self','canonical','incomplete'])await t.test(k,async t=>{const f=await setup(t);if(k==='hash')fs.appendFileSync(file(f,'work/enterprise/REJECTED_REGENERATION.md'),'changed');if(k==='self')design(f,7,a=>a.providerSessionId='builder-session');if(k==='canonical')fs.appendFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'),'forged');if(k==='incomplete')f.context('review-architecture',7);if(['self','incomplete'].includes(k))f.context('build-foundation',8);unchanged(f);});});
test('recovery-forged-or-incomplete-rejection-zero-writes',async t=>{for(const k of ['canonical','phase','incomplete'])await t.test(k,async t=>{const f=await setup(t);if(k==='canonical')fs.appendFileSync(join(f.run.reportsAbs,'enterprise-04-review.md'),'forged');else{const rec=f.records.find(r=>r.step==='review-foundation'&&r.iteration===4&&r.type===(k==='phase'?'phase_complete':'step_complete'));if(k==='phase')rec.content=rec.content.replace('REQUEST_CHANGES','APPROVE');else rec.status='error';f.append({type:'boundary'});}unchanged(f);});});
test('recovery-historical-selection-and-output-tamper-rejected',async t=>{for(const k of ['selection','output','report'])await t.test(k,async t=>{const f=await setup(t),p=read(pp(f)),s=read(file(f,p.entrySelection));let path=k==='selection'?p.entrySelection:k==='report'?s.predecessors[0].approval.report:read(file(f,`evidence/enterprise/runs/${s.predecessors[0].runId}/receipt.json`)).suites[0].stdout;fs.appendFileSync(file(f,path),'changed');unchanged(f);});});
test('recovery-wrong-run-session-or-active-rejected',async t=>{for(const k of ['run','active','session','model'])await t.test(k,async t=>{const f=await setup(t);if(k==='run')mutate(f,'work/enterprise/progress.json',p=>p.runBinding.runSlug='wrong');if(k==='active')mutate(f,'work/enterprise/progress.json',p=>p.activeBatchId='B02');if(k==='session'){f.sessions[JSON.stringify(['enterprise-batch-reviewer','codex','gpt-6-astra'])]='builder-session';savePersonaSessions(f.root,f.sessions,'codex',f.paths.sessionsDirectory);}if(k==='model'){f.records.at(-1).model='gpt-6.1-sol';f.append({type:'boundary'});}unchanged(f);});});
test('recovery-unknown-or-later-review-rejected',async t=>{const f=await setup(t);phases(f,'review-foundation',7,'unknown scope');f.context('build-foundation',8);unchanged(f);});
test('recovery-topology-or-AC-change-rejected',async t=>{for(const k of ['topology','AC','AC-text','AC-suite','assertion'])await t.test(k,async t=>{const f=await setup(t);mutate(f,'work/enterprise/plan.json',p=>{if(k==='topology')p.batches[1].stage='build-foundation';if(k==='AC')p.issues[0].acceptanceTests=[];if(k==='AC-text')p.issues[0].acceptanceTests[0].text='weakened';if(k==='AC-suite')p.issues[0].acceptanceTests[0].suiteIds=[];if(k==='assertion')p.issues[0].suites[0].requiredAssertions=['changed'];});design(f,7);f.context('build-foundation',8);unchanged(f);});});
test('recovery-rejection-member-receipt-and-finding-binding',async t=>{for(const k of ['member','receipt','finding','artifact','AC'])await t.test(k,async t=>{const f=await setup(t);const change=(a,l)=>{if(k==='member')a.members.shift();if(k==='receipt')a.members[0].runId='arbitrary';if(k==='finding'){a.unresolvedFindings=[];l.unresolvedFindings=[];}if(k==='artifact')a.members[0].issueEvidence[0].decisions[0].artifacts=['unknown'];if(k==='AC')a.members[0].issueEvidence[0].decisions[0].id='unknown';};
 // Replace the original synthetic occurrence's phase content, preserving its timestamp.
 const oldRecords=[...f.records];publish(f,f.ref,9,'REQUEST_CHANGES',change);const raw=f.records.find(r=>r.iteration===9&&r.type==='phase_complete').content.replaceAll('"iteration":9','"iteration":4');f.records.splice(0,f.records.length,...oldRecords);for(const r of f.records.filter(r=>r.iteration===4&&r.type==='phase_complete'))r.content=raw;f.append({type:'boundary'});put(join(f.run.reportsAbs,'enterprise-04-review.md'),raw+'\n');f.context('build-foundation',10);unchanged(f);});});
test('recovery-source-change-reruns-whole-prefix',async t=>{const f=await setup(t),a=run(f),before=read(ip(f)).runs.length;fs.appendFileSync(file(f,'src/domain.mjs'),'new input');const b=run(f);assert.notEqual(a.attemptId,b.attemptId);assert.equal(read(ip(f)).runs.length,before+2);assert.deepEqual(attempt(f,b).previous,{path:a.resultPath,sha256:a.resultSha256});});
test('recovery-latest-failed-running-no-success-fallback',async t=>{for(const status of ['failed','running'])await t.test(status,async t=>{const f=await setup(t);run(f);const e=latest(f,'B01'),r=read(file(f,e.path));r.status=status;put(file(f,e.path),r);unchanged(f);});});
test('recovery-concurrent-authority-input-or-writer-rejected',async t=>{for(const k of ['ordinary','live','input','authority'])await t.test(k,async t=>{const f=await setup(t),before=fs.readFileSync(pp(f));if(k==='ordinary'||k==='live'){put(file(f,'evidence/enterprise/gate.lock'),k==='ordinary'?'':{kind:'enterprise-run-initialization',pid:process.pid,runSlug:f.run.slug});unchanged(f);return;}
 const target=k==='input'?file(f,'src/domain.mjs'):join(f.run.logsAbs,'fixture.jsonl');const addition=k==='input'?'changed':'\n';const r=inject(f,`const link=fs.linkSync;fs.linkSync=function(a,b,...xs){const r=link.call(this,a,b,...xs);if(String(b).endsWith('/gate.lock'))fs.appendFileSync(${JSON.stringify(target)},${JSON.stringify(addition)});return r;}`);assert.notEqual(r.status,0);assert.deepEqual(fs.readFileSync(pp(f)),before);assert.ok(!fs.existsSync(file(f,'evidence/enterprise/recoveries')));});});
test('recovery-interruption-retains-failure-without-approval',async t=>{for(const point of ['header','receipt'])await t.test(point,async t=>{const f=await setup(t),before=fs.readFileSync(pp(f));const code=point==='header'?"const link=fs.linkSync;fs.linkSync=function(a,b,...xs){const r=link.call(this,a,b,...xs);if(String(b).endsWith('/header.json'))process.kill(process.pid,'SIGKILL');return r;}":"const write=fs.writeFileSync;fs.writeFileSync=function(p,...xs){const r=write.call(this,p,...xs);if(String(p).includes('/runs/')&&String(p).endsWith('/receipt.json'))process.kill(process.pid,'SIGKILL');return r;}";const killed=inject(f,code);assert.equal(killed.signal,'SIGKILL');const r=run(f),h=attempt(f,r),prior=read(file(f,h.previous.path));assert.equal(prior.status,'failed');assert.equal(prior.signal,'INTERRUPTED');if(point==='receipt'){assert.equal(prior.receipts.length,1);assert.equal(read(file(f,prior.receipts[0].path)).status,'running');}assert.deepEqual(fs.readFileSync(pp(f)),before);});});
test('recovery-idempotent-post-report-gate-same-receipts',async t=>{const f=await setup(t),a=run(f),before=tree(f.temporary);const b=ok(f.cli(['batch']));assert.deepEqual(a,b);assert.deepEqual(tree(f.temporary),before);});
test('recovery-progress-selection-old-evidence-protected-unchanged',async t=>{const f=await setup(t),p=read(pp(f)),old=read(ip(f)).runs.map(e=>[e.path,fs.readFileSync(file(f,e.path))]),before=fs.readFileSync(pp(f)),sel=fs.readFileSync(file(f,p.entrySelection)),central=tree(f.run.runRootAbs);run(f);assert.deepEqual(fs.readFileSync(pp(f)),before);assert.deepEqual(fs.readFileSync(file(f,p.entrySelection)),sel);assert.deepEqual(tree(f.run.runRootAbs),central);for(const [path,raw]of old)assert.deepEqual(fs.readFileSync(file(f,path)),raw);});
test('recovery-no-dependent-selection-or-seal-before-new-review',async t=>{const f=await setup(t);run(f);fail(f.cli(['batch','--batch','B02'],{readonly:false}),/active batch swap/);f.context('harden-release',7);fail(f.cli(['all','--seal'],{readonly:false}),/superseded|stale/);f.context('final-audit',8);unchanged(f,['final','--check-seal']);});
test('recovery-real-cli-and-frozen-engine-gate',async t=>{const f=await setup(t),before=read(ip(f)).runs.length,events=[],step=loadWorkflowExecutionBundle(f.run).rootWorkflow.steps.find(s=>s.name==='build-foundation');assert.match(step.qualityGates[0].command,/verify.mjs' 'batch'$/);
 const state=createInitialState({...f.workflow,initialStep:step.name},{projectCwd:f.root});state.iteration=5;const provider={provider:'codex',model:'gpt-6-astra'};
 const result=await runSingleWorkflowIteration({state,options:{projectCwd:f.root},getWorkflowName:()=>f.workflow.name,getTask:()=> 'recovery fixture',getCurrentWorkflowStack:()=>f.stack(step.name),getCwd:()=>f.root,getMaxSteps:()=>60,getReportDir:()=>f.run.reportsAbs,abortRequested:()=>false,getStep:()=>step,
 applyRuntimeEnvironment:()=>{},loopDetectorCheck:()=>({count:0,isLoop:false}),cycleDetectorRecordAndCheck:()=>({triggered:false,cycleCount:0}),resolveDoneTransition:()=>({nextStep:'COMPLETE'}),resolveStepProviderModel:()=>provider,resolveStepProviderModelBeforeAutoRouting:()=>provider,resolveRuntimeForStep:()=>undefined,claimStepOccurrence:()=>{state.stepIterations.set(step.name,1);return 1;},setActiveStep:()=>undefined,cancelPendingStepActivation:()=>{},prepareNormalStepExecution:async()=>undefined,prepareInstruction:()=>({text:'fixture'}),buildPhase1Instruction:(_,s)=>s,
 runStep:async()=>{events.push('report');put(join(f.run.reportsAbs,'build-report.md'),'synthetic builder result');return {response:{persona:step.persona,status:'done',content:'synthetic builder result',timestamp:new Date()},instruction:'fixture'};},
 runQualityGates:async()=>{events.push('gate');const r=await runCommandQualityGate({projectRoot:f.root,gate:step.qualityGates[0]});assert.equal(r.ok,true,JSON.stringify(r));return r;},persistPreviousResponseSnapshot:()=>{},emit:()=>{},updateMaxSteps:()=>{},addUserInput:()=>{}});
 assert.equal(result.isComplete,true);assert.deepEqual(events,['report','gate']);assert.equal(read(ip(f)).runs.length,before+2);
});
test('recovery-exact-fresh-review-import-then-normal-selection',async t=>{const f=await setup(t),r=run(f);publish(f,r,7,'APPROVE');f.context('build-foundation',8);ok(f.cli(['batch','--import-closure'],{readonly:false}));assert.equal(read(pp(f)).activeBatchId,null);ok(f.cli(['batch','--batch','B02'],{readonly:false}));ok(f.cli(['batch','--batch','B02'],{readonly:false}));});
test('recovery-legacy-init-and-readonly-final-remain-strict',async t=>{const f=await setup(t);run(f);unchanged(f,['batch','--initialize-run'],/already initialized/);f.context('final-audit',7);unchanged(f,['all']);});
function updatePlan(f){const p=read(file(f,'work/enterprise/plan.json'));const s={id:'added-proof',path:'tests/extra.test.mjs',command:[process.execPath,'--test','tests/extra.test.mjs'],requiredAssertions:['extra arithmetic']};put(file(f,s.path),"import test from 'node:test';import assert from 'node:assert/strict';test('extra arithmetic',()=>assert.equal(3*9,27));");p.issues[0].suites.push(s);for(const ac of p.issues[0].acceptanceTests)ac.suiteIds.push(s.id);put(file(f,'work/enterprise/plan.json'),p);}
test('recovery-two-rejections-new-receipts-new-plan-then-exact-import',async t=>{const f=await setup(t),p0=fs.readFileSync(file(f,'work/enterprise/plan.json'));updatePlan(f);design(f,7);f.context('build-foundation',8);const a=run(f),before=fs.readFileSync(pp(f));publish(f,a,9);fs.appendFileSync(file(f,'src/domain.mjs'),'second');mutate(f,'work/enterprise/plan.json',p=>p.issues[0].suites.at(-1).timeoutMs=10000);design(f,10);f.context('build-foundation',11);const b=ok(f.cli(['batch'],{readonly:false}));assert.notEqual(attempt(f,a).planText,attempt(f,b).planText);assert.notEqual(attempt(f,a).planText,p0.toString());assert.notEqual(a.candidatePath,b.candidatePath);assert.deepEqual(fs.readFileSync(pp(f)),before);publish(f,b,12,'APPROVE');f.context('build-foundation',13);ok(f.cli(['batch','--import-closure'],{readonly:false}));ok(f.cli(['batch','--batch','B02'],{readonly:false}));});
test('recovery-root-equality-only-at-bootstrap',async t=>{const f=await setup(t),a=run(f),root=read(file(f,`evidence/enterprise/recoveries/${a.rootId}/root.json`));publish(f,a,7);f.context('build-foundation',8);const b=run(f);assert.equal(a.rootId,b.rootId);assert.notEqual(read(file(f,a.candidatePath)).members[0].runId,JSON.parse(root.selectionRaw).predecessors[0].runId);});
test('recovery-descendant-rejection-binds-producing-attempt',async t=>{for(const k of ['missing','result','parent'])await t.test(k,async t=>{const f=await setup(t),a=run(f);publish(f,a,7,'REQUEST_CHANGES',x=>{if(k==='missing')delete x.recovery;else if(k==='result')x.recovery.resultSha256='bad';else x.recovery.parentRejectionReportSha256='old';});f.context('build-foundation',8);unchanged(f);});});
test('recovery-chain-missing-mixed-tampered-or-forked-zero-writes',async t=>{for(const k of ['header','journal','head','fork','output'])await t.test(k,async t=>{const f=await setup(t),a=run(f),h=attempt(f,a),dir=`evidence/enterprise/recoveries/${a.rootId}`;if(k==='header')fs.appendFileSync(file(f,a.resultPath.replace('result.json','header.json')),' ');if(k==='journal')fs.rmSync(file(f,dir+'/journal/000001.json'));if(k==='head')fs.rmSync(file(f,dir+'/head.json'));if(k==='fork'){const copy={...h,attemptId:'fork'};put(file(f,dir+'/attempts/fork/header.json'),copy);}if(k==='output'){const r=read(file(f,latest(f,'B00').path));fs.appendFileSync(file(f,r.suites[0].stdout),'changed');}unchanged(f);});});
test('recovery-old-rejection-or-head-replay-rejected',async t=>{for(const k of ['head','report'])await t.test(k,async t=>{const f=await setup(t),a=run(f),head=file(f,`evidence/enterprise/recoveries/${a.rootId}/head.json`),old=fs.readFileSync(head),raw=fs.readFileSync(join(f.run.reportsAbs,'enterprise-04-review.md'));publish(f,a,7);f.context('build-foundation',8);run(f);if(k==='head')fs.writeFileSync(head,old);else fs.writeFileSync(join(f.run.reportsAbs,'enterprise-04-review.md'),raw);unchanged(f);});});
test('recovery-plan-suite-change-requires-matching-design-approval',async t=>{const f=await setup(t);run(f);updatePlan(f);unchanged(f);design(f,7);f.context('build-foundation',8);run(f);});
test('recovery-latest-incomplete-review-blocks-descendant-attempt',async t=>{const f=await setup(t),a=run(f);publish(f,a,7,'REQUEST_CHANGES',()=>{},{incomplete:true});f.context('build-foundation',8);unchanged(f);});
test('recovery-same-parent-failed-attempt-retry-retains-chain',async t=>{const f=await setup(t);const path=file(f,'tests/assertion.test.mjs'),raw=fs.readFileSync(path);fs.appendFileSync(path,"\nthrow Error('ACTUAL_SUITE_FAILURE');");fail(f.cli(recovery,{readonly:false}),/nonzero exit/);fs.writeFileSync(path,raw);const a=run(f),h=attempt(f,a);assert.equal(read(file(f,h.previous.path)).status,'failed');assert.equal(h.sequence,2);});
test('recovery-terminal-publication-crash-and-concurrent-head',async t=>{for(const point of ['result.json','000001.json','head.json'])await t.test(point,async t=>{const f=await setup(t),before=fs.readFileSync(pp(f));const code=point==='head.json'?"const rename=fs.renameSync;fs.renameSync=function(a,b,...xs){const r=rename.call(this,a,b,...xs);if(String(b).endsWith('/head.json'))process.kill(process.pid,'SIGKILL');return r;}":`const link=fs.linkSync;fs.linkSync=function(a,b,...xs){const r=link.call(this,a,b,...xs);if(String(b).endsWith('/${point}'))process.kill(process.pid,'SIGKILL');return r;}`;const r=inject(f,code);assert.equal(r.signal,'SIGKILL');const index=fs.readFileSync(ip(f));run(f);assert.deepEqual(fs.readFileSync(ip(f)),index);assert.deepEqual(fs.readFileSync(pp(f)),before);});});
test('recovery-approval-import-validates-chain-without-rejection-authority',async t=>{const f=await setup(t),a=run(f);publish(f,a,7,'APPROVE');f.context('build-foundation',8);unchanged(f,recovery,/approval ends/);ok(f.cli(['batch','--import-closure'],{readonly:false}));assert.ok(Object.values(read(pp(f)).issues).every(x=>x.status==='VERIFIED'));});

// BF-19: a new review occurrence must not be interpreted as another rejection
// in an already approved regeneration chain. All post-approval authority is
// still authenticated, and only explicitly scoped members are superseded.
async function approvedThenB02(t){const f=await setup(t),r=run(f);publish(f,r,7,'APPROVE');f.context('build-foundation',8);ok(f.cli(['batch','--import-closure'],{readonly:false}));ok(f.cli(['batch','--batch','B02'],{readonly:false}));return f;}
function validateEntry(f){const before=tree(f.temporary);const r=spawnSync(process.execPath,['--import',f.guardPath,'--input-type=module','-e',`import fs from 'node:fs';import {validateApproval} from './scripts/enterprise/evidence.mjs';import {validateSelection} from './scripts/enterprise/selection.mjs';import {suitesFor} from './scripts/enterprise/gate-execution.mjs';const read=p=>JSON.parse(fs.readFileSync(p));const p=read('work/enterprise/progress.json'),plan=read('work/enterprise/plan.json'),s=read(p.entrySelection);for(const pr of s.predecessors){const b=plan.batches.find(b=>b.id===pr.batchId);await validateApproval(process.cwd(),pr.approval,read('evidence/enterprise/runs/'+pr.runId+'/receipt.json'),b.issueIds);}await validateSelection(process.cwd(),plan,plan.batches.find(b=>b.id==='B02'),p,suitesFor);console.log('ENTRY_VALID');`],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000});assert.deepEqual(tree(f.temporary),before);return r;}
function laterLegacy(f,{incomplete=false,edit=()=>{}}={}){const ref=read(pp(f)).lastGate.closureCandidate,c=read(file(f,ref.candidatePath)),m=c.members.at(-1);const a={schemaVersion:1,verdict:'REQUEST_CHANGES',runSlug:f.run.slug,workflowRef:f.workflowRef,step:'review-foundation',iteration:9,sessionKey:'enterprise-batch-reviewer',providerSessionId:'reviewer-session',batchId:m.batchId,runId:m.runId,inputsDigest:c.inputs.digest,receiptHash:m.receiptHash,receiptSha256:m.receiptSha256,outputsDigest:m.outputsDigest,approvedIssueIds:[],unresolvedFindings:['B02 only']};edit(a);phases(f,'review-foundation',9,fenced('enterprise-batch-attestation',a),{incomplete});}
test('BF-19 approved history authenticates later review scope and lifecycle',async t=>{
 // Generate the authenticated history once. Every condition restores exactly
 // the same files and in-memory log before injecting its own fault. Preserve
 // existing directories: the registry binds the runs directory's inode.
 const prepared=await approvedThenB02(t),savedTree=tree(prepared.temporary),savedRecords=structuredClone(prepared.records);
 const savedFiles=new Map(savedTree.filter(e=>fs.lstatSync(prepared.temporary+e.path).isFile()).map(e=>[e.path,fs.readFileSync(prepared.temporary+e.path)]));
 const savedLinks=new Map(savedTree.filter(e=>fs.lstatSync(prepared.temporary+e.path).isSymbolicLink()).map(e=>[e.path,fs.readlinkSync(prepared.temporary+e.path)]));
 const paths=new Set(savedTree.map(e=>e.path)),shape=entries=>entries.map(({mtime,...e})=>e);
 const restore=()=>{
  for(const e of tree(prepared.temporary).reverse())if(!paths.has(e.path))fs.rmSync(prepared.temporary+e.path,{recursive:true,force:true});
  for(const [path,bytes] of savedFiles){const target=prepared.temporary+path;if(!fs.existsSync(target)||!fs.readFileSync(target).equals(bytes))fs.writeFileSync(target,bytes);}
  prepared.records.splice(0,prepared.records.length,...structuredClone(savedRecords));
  assert.deepEqual(shape(tree(prepared.temporary)),shape(savedTree));
  for(const [path,target] of savedLinks)assert.equal(fs.readlinkSync(prepared.temporary+path),target);
  assert.deepEqual(prepared.records,savedRecords);return prepared;
 };
 await t.test('completed B02-only review preserves prior approvals and normal resume',async t=>{const f=restore();laterLegacy(f);f.context('build-foundation',10);const r=validateEntry(f);assert.equal(r.status,0,r.stderr);ok(f.cli(['batch','--batch','B02'],{readonly:false}));});
 for(const kind of ['started','incomplete','unknown','session','phase','chain','canonical','receipt','unknown-batch'])await t.test(kind+' fails closed without writes',async t=>{const f=restore();if(kind==='started')f.context('review-foundation',9);else if(kind==='unknown')phases(f,'review-foundation',9,'unknown scope');else laterLegacy(f,{incomplete:kind==='incomplete',edit:a=>{if(kind==='session')a.providerSessionId='builder-session';if(kind==='receipt')a.receiptSha256='forged';if(kind==='unknown-batch')a.batchId='UNKNOWN';}});if(kind==='phase'){const r=f.records.find(r=>r.iteration===9&&r.type==='phase_complete'&&r.phase===1);r.content=r.content.replace('REQUEST_CHANGES','APPROVE');f.append({type:'boundary'});}if(kind==='canonical')fs.appendFileSync(join(f.run.reportsAbs,'enterprise-04-review.md'),'forged');if(kind==='chain'){const p=read(pp(f)),c=read(file(f,p.approvals.B00.closure.candidatePath));fs.appendFileSync(file(f,c.recovery.headerPath),' ');}f.context('build-foundation',10);fail(validateEntry(f),/incomplete|scope|attestation|session|phases|header|changed|canonical|receipt/i);});
 await t.test('scoped rejection reaches normal dispatch and regenerates B00 through B02',async t=>{const f=restore(),p=fs.readFileSync(pp(f));publish(f,read(pp(f)).lastGate.closureCandidate,9);f.context('build-foundation',10);fail(validateEntry(f),/batch approval superseded by later review|closure member superseded/);const before=read(ip(f)).runs.length,r=ok(f.cli(['batch'],{readonly:false}));assert.equal(r.status,'MACHINE_EVIDENCE_REGENERATED_REVIEW_REQUIRED');assert.deepEqual(read(ip(f)).runs.slice(before).map(r=>r.batchId),['B00','B01','B02']);assert.deepEqual(fs.readFileSync(pp(f)),p);});
});

// Ordinary S -> G -> J0 origin uses real CLI receipts, including a gate-level
// missing-assertion failure whose subprocess itself exited successfully.
async function refreshSetup(t){
 const f=await fixture(t,{multi:true,selection:true,seal:false,recovery:true});
 const path='tests/ordinary.test.mjs',bad="import test from 'node:test';test('wrong assertion',()=>{});\n",good="import test from 'node:test';import assert from 'node:assert/strict';test('ordinary required assertion',()=>assert.equal(7*8,56));\n";
 put(file(f,path),bad);mutate(f,'work/enterprise/plan.json',p=>{for(const i of p.issues.filter(i=>i.batchId==='B01'))i.suites=[{id:'ordinary-proof',path,command:[process.execPath,'--test','--test-reporter=tap',path],requiredAssertions:['ordinary required assertion']}];});
 f.context('build-foundation',3);ok(f.cli(['batch','--batch','B00'],{readonly:false}));f.batchReport({iteration:4},{iteration:4});
 mutate(f,'work/enterprise/progress.json',p=>p.activeBatchId=null);f.context('build-foundation',5);
 fail(f.cli(['batch','--batch','B01'],{readonly:false}),/missing assertion/);f.failed=latest(f,'B01');assert.equal(read(file(f,f.failed.path)).suites[0].exitCode,0);
 put(file(f,path),good);ok(f.cli(['batch'],{readonly:false}));f.reported=read(pp(f)).lastGate.closureCandidate;
 const code="import {currentContext} from './scripts/enterprise/context.mjs';console.log(JSON.stringify((await currentContext(process.cwd())).identity));";
 const q=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:f.root,env:f.env,encoding:'utf8'});assert.equal(q.status,0,q.stderr);mutate(f,'work/enterprise/progress.json',p=>p.runBinding=JSON.parse(q.stdout));
 const c=read(file(f,f.reported.candidatePath)),content=f.failed.id+'\n'+f.reported.candidatePath+'\n'+c.members.map(m=>m.runId).join('\n');
 for(const phase of [1,2])f.append({type:'phase_complete',step:'build-foundation',iteration:5,workflow:f.workflow.name,stack:f.stack('build-foundation'),phase,phaseExecutionId:'builder:5:'+phase,timestamp:new Date().toISOString(),status:'done',content});
 f.append({type:'step_complete',step:'build-foundation',iteration:5,workflow:f.workflow.name,stack:f.stack('build-foundation'),status:'done',timestamp:f.records.find(r=>r.step==='build-foundation'&&r.iteration===5).timestamp,content});
 const step=loadWorkflowExecutionBundle(f.run).rootWorkflow.steps.find(s=>s.name==='build-foundation');const gate=await runCommandQualityGate({projectRoot:f.root,gate:step.qualityGates[0]});assert.equal(gate.ok,true,JSON.stringify(gate));
 f.ref=read(pp(f)).lastGate.closureCandidate;assert.notEqual(f.ref.candidatePath,f.reported.candidatePath);publish(f,f.ref,6);put(file(f,'work/enterprise/REJECTED_REGENERATION.md'),'ordinary fixture contract');design(f,9);f.context('build-foundation',10);return f;
}
function restorePoint(f){const original=tree(f.temporary),records=structuredClone(f.records),sessions=structuredClone(f.sessions),files=new Map(original.filter(e=>fs.lstatSync(f.temporary+e.path).isFile()).map(e=>[e.path,fs.readFileSync(f.temporary+e.path)])),paths=new Set(original.map(e=>e.path));return()=>{for(const e of tree(f.temporary).reverse())if(!paths.has(e.path))fs.rmSync(f.temporary+e.path,{recursive:true,force:true});for(const [p,b]of files)if(!fs.existsSync(f.temporary+p)||!fs.readFileSync(f.temporary+p).equals(b))fs.writeFileSync(f.temporary+p,b);f.records.splice(0,f.records.length,...structuredClone(records));for(const k of Object.keys(f.sessions))delete f.sessions[k];Object.assign(f.sessions,structuredClone(sessions));return f;};}
function editBuilder(f,fn){for(const r of f.records.filter(r=>r.iteration===5))fn(r);f.append({type:'boundary'});}
test('recovery-refresh executable acceptance',async t=>{
 const shared=await refreshSetup(t),restore=restorePoint(shared);
 const refreshFixture=()=>{restore();return shared;};
await t.test('recovery-refresh-authenticated-selection-to-ordinary-candidate-to-first-rejection',async t=>{const f=refreshFixture(),before=fs.readFileSync(pp(f)),r=run(f),fixed=read(file(f,`evidence/enterprise/recoveries/${r.rootId}/root.json`));assert.equal(fixed.schemaVersion,2);assert.deepEqual(fixed.ordinaryRefresh.interval.map(x=>x.status),['failed','passed','passed','passed']);assert.deepEqual(fixed.ordinaryRefresh.interval.map(x=>x.entry.batchId),['B01','B00','B01','B01']);assert.deepEqual(fs.readFileSync(pp(f)),before);});
await t.test('recovery-refresh-original-approval-and-plan-equality-remain-strict',async t=>{const f=refreshFixture(),restore=restorePoint(f);for(const kind of ['approval','selection','plan'])await t.test(kind,()=>{restore();const p=read(pp(f)),s=read(file(f,p.entrySelection));if(kind==='approval')fs.appendFileSync(file(f,s.predecessors[0].approval.report),'changed');if(kind==='selection')fs.appendFileSync(file(f,p.entrySelection),' ');if(kind==='plan')mutate(f,'work/enterprise/plan.json',p=>p.issues[0].originalAcceptance=['changed']);unchanged(f);});});
await t.test('recovery-refresh-builder-phases-session-and-independent-rejection-required',async t=>{const f=refreshFixture(),restore=restorePoint(f);for(const kind of ['phase','id','complete','model','review'])await t.test(kind,()=>{restore();editBuilder(f,r=>{if(kind==='phase'&&r.phase===2)r.content='unknown';if(kind==='id'&&r.phase===1)delete r.phaseExecutionId;if(kind==='complete'&&r.type==='step_complete')r.status='error';if(kind==='model'&&r.type==='step_start')r.model='gpt-6.1-sol';});if(kind==='review'){f.sessions[JSON.stringify(['enterprise-batch-reviewer','codex','gpt-6-astra'])]='builder-session';savePersonaSessions(f.root,f.sessions,'codex',f.paths.sessionsDirectory);}unchanged(f);});});
await t.test('recovery-refresh-entire-index-interval-including-failed-and-post-report-runs',async t=>{const f=refreshFixture(),restore=restorePoint(f);for(const kind of ['failed-output','failed-exit','failed-missing','failed-erased','prefix','duplicate','reverse','post-missing'])await t.test(kind,()=>{restore();if(kind==='failed-output')fs.appendFileSync(file(f,read(file(f,f.failed.path)).suites[0].stdout),'changed');else if(kind==='failed-exit')mutate(f,f.failed.path,r=>r.error='invented failure');else mutate(f,'evidence/enterprise/runs/index.json',x=>{if(kind==='failed-missing'||kind==='failed-erased'){x.runs=x.runs.filter(e=>e.id!==f.failed.id);if(kind==='failed-erased')fs.rmSync(file(f,f.failed.path));}if(kind==='prefix')x.runs[0].batchId='forged';if(kind==='duplicate')x.runs.push(x.runs.at(-1));if(kind==='reverse')x.runs.splice(-4,4,...x.runs.slice(-4).reverse());if(kind==='post-missing')x.runs.pop();});unchanged(f);});});
await t.test('recovery-refresh-missing-mixed-forked-running-or-tampered-zero-writes',async t=>{const f=refreshFixture(),restore=restorePoint(f);for(const kind of ['running','writer','manifest','missing','extra'])await t.test(kind,()=>{restore();if(kind==='missing')fs.rmSync(file(f,f.failed.path));else if(kind==='extra')mutate(f,'evidence/enterprise/runs/index.json',x=>x.runs.push({...x.runs.at(-1),id:'extra'}));else mutate(f,f.failed.path,r=>{if(kind==='running')r.status='running';if(kind==='writer')r.implementationSession='other';if(kind==='manifest')r.inputs.digest='forged';});unchanged(f);});});
await t.test('recovery-refresh-candidate-latest-prefix-and-source-output-binding',async t=>{const f=refreshFixture(),restore=restorePoint(f);for(const kind of ['candidate','output','stale'])await t.test(kind,()=>{restore();if(kind==='candidate')fs.appendFileSync(file(f,f.reported.candidatePath),' ');if(kind==='output')fs.appendFileSync(file(f,read(file(f,latest(f,'B00').path)).suites[0].stdout),'changed');if(kind==='stale'){publish(f,f.reported,11);f.context('build-foundation',12);}unchanged(f);});});
await t.test('recovery-refresh-legacy-equal-root-and-new-version-no-root-rewrite',async t=>{const legacy=await setup(t),a=run(legacy);assert.equal(read(file(legacy,`evidence/enterprise/recoveries/${a.rootId}/root.json`)).schemaVersion,1);const f=refreshFixture(),b=run(f),path=`evidence/enterprise/recoveries/${b.rootId}/root.json`;mutate(f,path,r=>r.schemaVersion=1);unchanged(f);});
await t.test('recovery-refresh-readonly-design-and-builder-provenance-no-authority',async t=>{const f=refreshFixture();design(f,11,a=>a.contractSha256='wrong');f.context('build-foundation',12);unchanged(f);});
await t.test('recovery-refresh-concurrent-publication-and-idempotent-post-report',async t=>{const f=refreshFixture(),before=fs.readFileSync(pp(f)),restore=restorePoint(f);
 for(const target of [f.failed.path,'src/domain.mjs','evidence/enterprise/runs/index.json']){restore();const r=inject(f,`const link=fs.linkSync;fs.linkSync=function(a,b,...xs){const r=link.call(this,a,b,...xs);if(String(b).endsWith('/gate.lock'))fs.appendFileSync(${JSON.stringify(file(f,target))},' ');return r;}`);assert.notEqual(r.status,0);assert.deepEqual(fs.readFileSync(pp(f)),before);assert.ok(!fs.existsSync(file(f,'evidence/enterprise/recoveries')));assert.ok(!fs.existsSync(file(f,'evidence/enterprise/gate.lock')));}restore();const killed=inject(f,"const link=fs.linkSync;fs.linkSync=function(a,b,...xs){const r=link.call(this,a,b,...xs);if(String(b).endsWith('/result.json'))process.kill(process.pid,'SIGKILL');return r;}");assert.equal(killed.signal,'SIGKILL');const r=run(f),index=fs.readFileSync(ip(f));assert.deepEqual(ok(f.cli(['batch'])),r);assert.deepEqual(fs.readFileSync(ip(f)),index);assert.deepEqual(fs.readFileSync(pp(f)),before);});
await t.test('recovery-refresh-new-prefix-receipts-exact-review-import-before-next-batch',async t=>{const f=refreshFixture();let r=run(f);for(const iteration of [11,13]){publish(f,r,iteration);fs.appendFileSync(file(f,'src/domain.mjs'),' changed');f.context('build-foundation',iteration+1);const next=run(f);assert.notEqual(next.attemptId,r.attemptId);r=next;}publish(f,r,15,'APPROVE');f.context('build-foundation',16);ok(f.cli(['batch','--import-closure'],{readonly:false}));ok(f.cli(['batch','--batch','B02'],{readonly:false}));});
await t.test('recovery-refresh-initializer-history-only-and-final-zero-write',async t=>{const f=refreshFixture(),r=run(f);publish(f,r,11);f.context('build-foundation',12);const q=spawnSync(process.execPath,['--import',f.guardPath,'--input-type=module','-e',"import fs from 'node:fs';import {currentContext} from './scripts/enterprise/context.mjs';import {rejectedInitializationHistory} from './scripts/enterprise/rejected-regeneration.mjs';const h=rejectedInitializationHistory(process.cwd(),await currentContext(process.cwd()),JSON.parse(fs.readFileSync('work/enterprise/progress.json')));console.log(JSON.stringify({historyOnly:h.historyOnly,approvals:h.currentApprovals}));"],{cwd:f.root,env:f.env,encoding:'utf8'});assert.deepEqual(ok(q),{historyOnly:true,approvals:[]});unchanged(f,['batch','--initialize-run'],/already initialized/);f.context('final-audit',13);unchanged(f,['all']);});
await t.test('recovery-refresh-real-cli-frozen-gate-and-independent-bf43-review',async t=>{const f=refreshFixture(),before=fs.readFileSync(pp(f)),step=loadWorkflowExecutionBundle(f.run).rootWorkflow.steps.find(s=>s.name==='build-foundation');const gate=await runCommandQualityGate({projectRoot:f.root,gate:step.qualityGates[0]});assert.equal(gate.ok,true,JSON.stringify(gate));assert.deepEqual(fs.readFileSync(pp(f)),before);fail(f.cli(['batch','--batch','B02'],{readonly:false}),/active batch swap/);});
});

function revalidationOrder(f,r,iteration=8,edit=()=>{}){
 const startIndex=f.records.findLastIndex(r=>r.type==='step_start'&&r.step==='review-foundation'),s=f.records[startIndex],ps=f.records.slice(startIndex+1).filter(r=>r.type==='phase_complete'&&r.step===s.step&&r.iteration===s.iteration),raw=ps.find(p=>p.phase===2).content;
 const a=JSON.parse(raw.match(/```enterprise-closure-attestation\n([\s\S]*?)\n```/)[1]);
 const expected={...a.recovery,resultPath:r.resultPath};
 design(f,iteration,d=>{d.schemaVersion=2;d.revalidation={purpose:'REVALIDATE_INVALID_REVIEW_ONLY',contractPath:'work/enterprise/REVIEW_REVALIDATION.md',contractSha256:hash(fs.readFileSync(file(f,'work/enterprise/REVIEW_REVALIDATION.md'))),invalidReview:{runSlug:f.run.slug,workflowRef:f.workflowRef,iteration:s.iteration,step:s.step,sessionKey:a.sessionKey,providerSessionId:a.providerSessionId,startIndex,phases:[1,2].map(phase=>({phase,contentSha256:hash(ps.find(p=>p.phase===phase).content)})),reportSha256:hash(raw)},rootId:r.rootId,candidatePath:r.candidatePath,candidateSha256:r.candidateSha256,invalidRecovery:a.recovery,expectedRecovery:expected,allowedDifference:'/recovery/resultPath',disposition:'KEEP_INVALID_REVIEW_AND_RERUN_FULL_PREFIX'};edit(d);});
}
function editReview(f,edit){
 const start=f.records.findLastIndex(r=>r.type==='step_start'&&r.step==='review-foundation'),s=f.records[start];let last;
 for(const p of f.records.slice(start+1).filter(r=>r.type==='phase_complete'&&r.step===s.step)){
  const a=JSON.parse(p.content.match(/```enterprise-closure-attestation\n([\s\S]*?)\n```/)[1]),l=JSON.parse(p.content.match(/```enterprise-batch-attestation\n([\s\S]*?)\n```/)[1]);edit(a,l,p);p.content=fenced('enterprise-batch-attestation',l)+'\n'+fenced('enterprise-closure-attestation',a);last=p.content;
 }
 f.append({type:'boundary'});put(join(f.run.reportsAbs,'enterprise-04-review.md'),last+'\n');
}
function historyOnly(f){return spawnSync(process.execPath,['--import',f.guardPath,'--input-type=module','-e',"import fs from 'node:fs';import {currentContext} from './scripts/enterprise/context.mjs';import {rejectedInitializationHistory} from './scripts/enterprise/rejected-regeneration.mjs';const h=rejectedInitializationHistory(process.cwd(),await currentContext(process.cwd()),JSON.parse(fs.readFileSync('work/enterprise/progress.json')));console.log(JSON.stringify(h));"],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000});}
test('recovery-revalidation executable acceptance',async t=>{
 const f=await setup(t,{protectedFixture:true}),old=run(f);put(file(f,'work/enterprise/REVIEW_REVALIDATION.md'),'fixture revalidation contract');publish(f,old,7,'APPROVE',a=>a.recovery.resultPath='evidence/nonexistent-result.json');
 const reset=restorePoint(f),ordered=(edit=()=>{})=>{reset();revalidationOrder(f,old,8,edit);f.context('build-foundation',9);return f;};
 await t.test('recovery-revalidation-original-malformed-approve-rejected-and-preserved',()=>{reset();f.context('build-foundation',9);unchanged(f,recovery);const p=fs.readFileSync(pp(f)),raw=fs.readFileSync(join(f.run.reportsAbs,'enterprise-04-review.md'));fail(f.cli(['batch','--import-closure'],{readonly:false}));assert.deepEqual(fs.readFileSync(pp(f)),p);assert.deepEqual(fs.readFileSync(join(f.run.reportsAbs,'enterprise-04-review.md')),raw);});
 await t.test('recovery-revalidation-explicit-independent-design-order-required',async t=>{for(const kind of ['generic','purpose','self','missing','canonical'])await t.test(kind,()=>{reset();if(kind==='generic')design(f,8);else if(kind!=='missing')revalidationOrder(f,old,8,d=>{if(kind==='purpose')d.revalidation.purpose='APPROVE';if(kind==='self')d.providerSessionId='builder-session';});if(kind==='canonical')fs.appendFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'),'forged');f.context('build-foundation',9);unchanged(f);});});
 await t.test('recovery-revalidation-only-result-path-defect-accepted',async t=>{for(const kind of ['hash','extra','missing','valid'])await t.test(kind,()=>{reset();editReview(f,a=>{if(kind==='hash')a.recovery.resultSha256='wrong';if(kind==='extra')a.recovery.extra=true;if(kind==='missing')delete a.recovery.headerSha256;if(kind==='valid')a.recovery.resultPath=old.resultPath;});revalidationOrder(f,old,8);f.context('build-foundation',9);unchanged(f);});ordered();const r=run(f);assert.notEqual(r.attemptId,old.attemptId);});
 await t.test('recovery-revalidation-real-phases-sessions-and-all-AC-binding',async t=>{for(const kind of ['issue','AC','verdict','artifact','findings','phase','incomplete','session'])await t.test(kind,()=>{reset();editReview(f,(a,l,p)=>{if(kind==='issue')a.members[0].issueEvidence=[];if(kind==='AC')a.members[0].issueEvidence[0].decisions=[];if(kind==='verdict')a.members[0].issueEvidence[0].decisions[0].verdict='REQUEST_CHANGES';if(kind==='artifact')a.members[0].issueEvidence[0].decisions[0].artifacts=[];if(kind==='findings')l.unresolvedFindings=['unresolved'];if(kind==='phase'&&p.phase===1)a.recovery.resultPath='evidence/other.json';});if(kind==='incomplete'){f.records.find(r=>r.iteration===7&&r.type==='step_complete').status='error';f.append({type:'boundary'});}revalidationOrder(f,old,8,d=>{if(kind==='session')d.providerSessionId='reviewer-session';});f.context('build-foundation',9);unchanged(f);});});
 await t.test('recovery-revalidation-invalid-or-existing-path-zero-writes',async t=>{for(const path of ['../escape.json','/tmp/escape.json','evidence/../alias.json','evidence//alias.json','evidence/foreign.json','evidence/link/missing.json'])await t.test(path,()=>{reset();put(file(f,'evidence/foreign.json'),'foreign');fs.symlinkSync(file(f,'work'),file(f,'evidence/link'));editReview(f,a=>a.recovery.resultPath=path);revalidationOrder(f,old);f.context('build-foundation',9);unchanged(f);});});
 await t.test('recovery-revalidation-original-root-and-full-history-strict',async t=>{for(const kind of ['root','header','journal','receipt','output','selection'])await t.test(kind,()=>{ordered();const p=read(pp(f)),r=read(file(f,latest(f,'B00').path));const path=kind==='root'?`evidence/enterprise/recoveries/${old.rootId}/root.json`:kind==='header'?old.resultPath.replace('result.json','header.json'):kind==='journal'?`evidence/enterprise/recoveries/${old.rootId}/journal/000001.json`:kind==='receipt'?latest(f,'B00').path:kind==='output'?r.suites[0].stdout:p.entrySelection;fs.appendFileSync(file(f,path),'changed');unchanged(f);});});
 await t.test('recovery-revalidation-full-prefix-new-receipts-before-fresh-review',()=>{ordered();const n=read(ip(f)).runs.length,r=run(f);assert.deepEqual(read(ip(f)).runs.slice(n).map(e=>e.batchId),['B00','B01']);assert.notEqual(r.candidatePath,old.candidatePath);assert.notDeepEqual(read(file(f,r.candidatePath)).members.map(m=>m.runId),read(file(f,old.candidatePath)).members.map(m=>m.runId));fail(f.cli(['batch','--batch','B02'],{readonly:false}),/active batch swap/);});
 await t.test('recovery-revalidation-versioned-authority-no-fake-rejection-or-hash-cycle',()=>{ordered();const r=run(f),h=attempt(f,r),c=read(file(f,r.candidatePath));assert.equal(h.schemaVersion,2);assert.equal(h.authority.kind,'DESIGN_REVALIDATION_ORDER');assert.equal(h.parent,undefined);assert.equal(c.recovery.resultSha256,undefined);assert.equal(c.recovery.parentRejectionReportSha256,undefined);assert.deepEqual(c.recovery.authority,h.authority);assert.equal(h.authority.reviewedTerminal.path,old.resultPath);mutate(f,r.resultPath.replace('result.json','header.json'),h=>h.authority.extra=true);unchanged(f);});
 await t.test('recovery-revalidation-new-rejection-and-second-invalid-review-chain',()=>{ordered();const a=run(f);publish(f,a,10);design(f,11);f.context('build-foundation',12);const b=run(f);assert.equal(attempt(f,b).authority.kind,'SCOPED_REJECTION');publish(f,b,13,'APPROVE',a=>a.recovery.resultPath='evidence/second-missing.json');f.context('build-foundation',14);unchanged(f);revalidationOrder(f,b,15);f.context('build-foundation',16);const c=run(f);assert.equal(attempt(f,c).authority.invalidReview.iteration,13);publish(f,c,17,'APPROVE');f.context('build-foundation',18);ok(f.cli(['batch','--import-closure'],{readonly:false}));});
 await t.test('recovery-revalidation-later-incomplete-review-and-order-replay-rejected',async t=>{for(const kind of ['incomplete','unknown','old-order','later-design'])await t.test(kind,()=>{ordered();const a=run(f);if(kind==='incomplete')f.context('review-foundation',10);if(kind==='unknown')phases(f,'review-foundation',10,'unknown scope');if(kind==='old-order'){publish(f,a,10,'APPROVE',a=>a.recovery.resultPath='evidence/new-missing.json');}if(kind==='later-design')f.context('review-architecture',10);f.context('build-foundation',11);unchanged(f);});});
 await t.test('recovery-revalidation-changed-plan-new-design-order-required',()=>{ordered();const a=run(f);updatePlan(f);unchanged(f);revalidationOrder(f,old,10);f.context('build-foundation',11);const b=run(f);assert.notEqual(attempt(f,a).design.reportSha256,attempt(f,b).design.reportSha256);assert.equal(attempt(f,b).authority.invalidReview.iteration,7);});
 await t.test('recovery-revalidation-crash-concurrent-authority-and-input-failure-retained',async t=>{
  for(const kind of ['input','authority','index'])await t.test('lock '+kind,()=>{ordered();const n=read(ip(f)).runs.length,target=kind==='input'?file(f,'src/domain.mjs'):kind==='authority'?join(f.run.logsAbs,'fixture.jsonl'):ip(f);const q=inject(f,`const link=fs.linkSync;fs.linkSync=function(a,b,...xs){const r=link.call(this,a,b,...xs);if(String(b).endsWith('/gate.lock'))fs.appendFileSync(${JSON.stringify(target)},' ');return r;}`);assert.notEqual(q.status,0);assert.equal(fs.readdirSync(file(f,`evidence/enterprise/recoveries/${old.rootId}/attempts`)).length,1);assert.ok(!fs.existsSync(file(f,'evidence/enterprise/gate.lock')));});
  ordered();const killed=inject(f,"const link=fs.linkSync;fs.linkSync=function(a,b,...xs){const r=link.call(this,a,b,...xs);if(String(b).endsWith('/header.json'))process.kill(process.pid,'SIGKILL');return r;}");assert.equal(killed.signal,'SIGKILL');const r=run(f);assert.equal(read(file(f,attempt(f,r).previous.path)).signal,'INTERRUPTED');
  ordered();fs.appendFileSync(file(f,'tests/assertion.test.mjs'),"\nthrow Error('actual failure');");fail(f.cli(recovery,{readonly:false}));const dirs=fs.readdirSync(file(f,`evidence/enterprise/recoveries/${old.rootId}/attempts`));assert.equal(dirs.length,2);assert.ok(dirs.some(id=>read(file(f,`evidence/enterprise/recoveries/${old.rootId}/attempts/${id}/result.json`)).status==='failed'));
 });
 await t.test('recovery-revalidation-idempotent-frozen-post-report-gate',async()=>{ordered();const step=loadWorkflowExecutionBundle(f.run).rootWorkflow.steps.find(s=>s.name==='build-foundation');const gate=await runCommandQualityGate({projectRoot:f.root,gate:step.qualityGates[0]});assert.equal(gate.ok,true,JSON.stringify(gate));const before=tree(f.temporary),a=ok(f.cli(['batch'])),b=ok(f.cli(recovery));assert.deepEqual(a,b);assert.deepEqual(tree(f.temporary),before);});
 await t.test('recovery-revalidation-exact-import-only-then-normal-selection',()=>{ordered();const r=run(f);publish(f,r,10,'APPROVE');f.context('build-foundation',11);unchanged(f,recovery,/approval ends/);ok(f.cli(['batch','--import-closure'],{readonly:false}));assert.equal(read(pp(f)).activeBatchId,null);ok(f.cli(['batch','--batch','B02'],{readonly:false}));ok(f.cli(['batch','--batch','B02'],{readonly:false}));});
 await t.test('recovery-revalidation-progress-old-evidence-and-protected-bytes-unchanged',()=>{ordered();const p=read(pp(f)),paths=[pp(f),file(f,'evidence/protected.json'),file(f,p.entrySelection),file(f,old.resultPath),file(f,`evidence/enterprise/recoveries/${old.rootId}/root.json`)],before=paths.map(p=>({bytes:fs.readFileSync(p),mtime:fs.statSync(p).mtimeMs})),central=tree(f.run.runRootAbs);run(f);assert.deepEqual(tree(f.run.runRootAbs),central);for(const [i,p]of paths.entries()){assert.deepEqual(fs.readFileSync(p),before[i].bytes);assert.equal(fs.statSync(p).mtimeMs,before[i].mtime);}});
 await t.test('recovery-revalidation-history-only-initialization-and-final-zero-write',()=>{ordered();const h=ok(historyOnly(f));assert.equal(h.historyOnly,true);assert.deepEqual(h.currentApprovals,[]);assert.equal(h.revalidation.kind,'DESIGN_REVALIDATION_ORDER');fs.appendFileSync(file(f,'tests/assertion.test.mjs'),"\nthrow Error('failed tail');");fail(f.cli(recovery,{readonly:false}));const tail=ok(historyOnly(f));assert.equal(tail.failedTail.length,1);unchanged(f,['batch','--initialize-run'],/already initialized/);f.context('final-audit',10);unchanged(f,['all']);f.nextRun();ok(f.cli(['batch','--initialize-run'],{readonly:false}));assert.deepEqual(read(pp(f)).approvals,{});});
});


// Source preparation has no archive/launch/approval authority. These tests use
// actual CLI receipts and orchestrator fixtures, without a manufactured B01
// success candidate or a REQUEST_CHANGES after the approved predecessor.
async function preparationFixture(t,options={}){
 const f=await fixture(t,{multi:true,selection:true,seal:false,recovery:true,...options});
 fs.copyFileSync(new URL('../../scripts/enterprise/runtime-preparation.mjs',import.meta.url),file(f,'scripts/enterprise/runtime-preparation.mjs'));
 put(file(f,'package.json'),{private:true});put(file(f,'package-lock.json'),{lockfileVersion:3});
 if(options.runtimePackages){const {version}=JSON.parse(fs.readFileSync(new URL('../../node_modules/takt/package.json',import.meta.url)));put(file(f,'package.json'),{private:true,devDependencies:{takt:version}});put(file(f,'package-lock.json'),{lockfileVersion:3,packages:{'node_modules/takt':{version,...(options.runtimeLockDeclarations??{}),...(options.runtimeDistribution?{integrity:'sha512-'+createHash('sha512').update(options.runtimeDistribution).digest('base64')}: {})},...(options.runtimeDependencyPackages??{})}});}
 put(file(f,'work/enterprise/REJECTED_REGENERATION.md'),'rejection fixture');put(file(f,'work/enterprise/FAILED_INTERVAL_RECOVERY.md'),'source preparation fixture');put(file(f,'work/enterprise/RUNTIME_CONTINUATION.md'),'distinct target fixture');
 put(file(f,'tests/failure.test.mjs'),"import test from 'node:test';test('unexpected assertion',()=>{});\n");
 mutate(f,'work/enterprise/plan.json',p=>{for(const i of p.issues.filter(i=>i.batchId==='B01'))i.suites=[{id:'failure-proof',path:'tests/failure.test.mjs',command:[process.execPath,'--test','--test-reporter=tap','tests/failure.test.mjs'],requiredAssertions:['required missing assertion']}];});
 f.context('build-foundation',3);ok(f.cli(['batch','--batch','B00'],{readonly:false}));const ref=read(pp(f)).lastGate.closureCandidate;
 const a=publish(f,ref,4,'APPROVE');f.context('build-foundation',5);ok(f.cli(['batch','--import-closure'],{readonly:false}));
 fail(f.cli(['batch','--batch','B01'],{readonly:false}),/missing assertion/);
 const gateFailure=latest(f,'B01');fs.appendFileSync(file(f,'tests/assertion.test.mjs'),"\nthrow Error('actual subprocess failure');\n");
 const reportFailures=content=>{for(const phase of [1,2])f.append({type:'phase_complete',step:'build-foundation',iteration:5,workflow:f.workflow.name,stack:f.stack('build-foundation'),phase,phaseExecutionId:'build:5:'+phase,status:'done',timestamp:new Date().toISOString(),content});};
 if(options.postReportFailure)reportFailures('fixture report before subprocess execution '+gateFailure.id);
 const q=spawnSync(process.execPath,['--input-type=module','-e',"import fs from 'node:fs';import {execute,suitesFor} from './scripts/enterprise/gate-execution.mjs';const p=JSON.parse(fs.readFileSync('work/enterprise/plan.json'));execute(process.cwd(),'B00',suitesFor(p,p.batches[0].issueIds),'builder-session');"],{cwd:f.root,env:f.env,encoding:'utf8'});assert.equal(q.status,1);const processFailure=latest(f,'B00');
 const builder=f.records.findLastIndex(r=>r.type==='step_start'&&r.step==='build-foundation');
 if(!options.postReportFailure)reportFailures('fixture failed runs '+gateFailure.id+' '+processFailure.id);
 f.append({type:'step_complete',step:'build-foundation',iteration:5,workflow:f.workflow.name,stack:f.stack('build-foundation'),status:'done'});
 const c=ok(spawnSync(process.execPath,['--input-type=module','-e',"import {currentContext} from './scripts/enterprise/context.mjs';console.log(JSON.stringify(await currentContext(process.cwd())));"],{cwd:f.root,env:f.env,encoding:'utf8'}));
 mutate(f,'work/enterprise/progress.json',p=>p.runBinding=c.identity);
 const rawRef=path=>({path,sha256:hash(fs.readFileSync(file(f,path)))}),runtime=c.identity.runtime,next=structuredClone(runtime);next.version='synthetic-next';
 put(file(f,'evidence/probe.json'),{oldRuntime:runtime,nextRuntime:next,runtimeDifferences:[]});put(file(f,'evidence/next-package.json'),{private:true});put(file(f,'evidence/next-lock.json'),{lockfileVersion:3});put(file(f,'evidence/handoff.json'),{fixture:true});
 const p=read(pp(f)),bs=c.records.filter(r=>r.step==='build-foundation'&&r.iteration===5&&r.type==='phase_complete'),rs=c.records.filter(r=>r.step==='review-foundation'&&r.iteration===4&&r.type==='phase_complete'),reportPath=p.approvals.B00.report;
 f.preparation={schemaVersion:2,verdict:'APPROVE',purpose:'PREPARE_DISTINCT_RUN_CONTINUATION',permission:'PREPARATION_AND_HISTORY_ONLY',runSlug:f.run.slug,workflowRef:f.workflowRef,bundleDigest:c.identity.bundleDigest,step:'review-architecture',iteration:6,sessionKey:'enterprise-architecture-reviewer',providerSessionId:'designer-session',contractPath:'work/enterprise/FAILED_INTERVAL_RECOVERY.md',contractSha256:rawRef('work/enterprise/FAILED_INTERVAL_RECOVERY.md').sha256,runtimeContinuationContract:rawRef('work/enterprise/RUNTIME_CONTINUATION.md'),planSha256:rawRef('work/enterprise/plan.json').sha256,inputsDigest:'fixture-design-input',activeBatchId:'B01',prefixBatchIds:['B00','B01'],sourceProgress:rawRef('work/enterprise/progress.json'),entrySelection:rawRef(p.entrySelection),sourceIndex:{...rawRef('evidence/enterprise/runs/index.json'),entryCount:read(ip(f)).runs.length},latestFoundationReview:{iteration:4,sessionKey:'enterprise-batch-reviewer',providerSessionId:'reviewer-session',phase1Sha256:hash(rs[0].content),phase2Sha256:hash(rs[1].content),reportPath,reportSha256:rawRef(reportPath).sha256,...ref,approvedBatchIds:['B00']},subsequentBuilderOccurrences:[{iteration:5,startIndex:builder,providerSessionId:'builder-session',phase1ExecutionId:bs[0].phaseExecutionId,phase1Sha256:hash(bs[0].content),phase2ExecutionId:bs[1].phaseExecutionId,phase2Sha256:hash(bs[1].content)}],failedReceipts:[gateFailure,processFailure].map((e,i)=>({...rawRef(e.path),batchId:e.batchId,inputsDigest:read(file(f,e.path)).inputs.digest,failureKind:i?'SUBPROCESS_FAILURE':'GATE_VALIDATION_FAILURE'})),retainedBuilderHandoff:rawRef('evidence/handoff.json'),runtimeCandidate:{identitySourcePath:'evidence/probe.json',identitySourceSha256:rawRef('evidence/probe.json').sha256,fromVersion:runtime.version,fromRuntimeIdentitySha256:hash(JSON.stringify(runtime)),fromPackageSha256:rawRef('package.json').sha256,fromLockSha256:rawRef('package-lock.json').sha256,toVersion:next.version,toRuntimeIdentitySha256:hash(JSON.stringify(next)),toPackagePath:'evidence/next-package.json',toPackageSha256:rawRef('evidence/next-package.json').sha256,toLockPath:'evidence/next-lock.json',toLockSha256:rawRef('evidence/next-lock.json').sha256},unresolvedFindings:[]};
 phases(f,'review-architecture',6,fenced('enterprise-failed-interval-design-attestation',f.preparation));f.context('build-foundation',7);return f;
}
function preparationRead(f){const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-preparation.mjs')],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000});assert.deepEqual(tree(f.temporary),before);return q;}
test('runtime source preparation diagnostic',async t=>{
 const f=await preparationFixture(t),reset=restorePoint(f);
 await t.test('source order authenticates approved prefix and two real failed receipts without writes',()=>{const q=preparationRead(f);assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.equal(r.initializationAuthority,false);assert.deepEqual(r.currentApprovals,[]);assert.deepEqual(r.failures.map(x=>x.kind),['GATE_VALIDATION_FAILURE','SUBPROCESS_FAILURE']);assert.ok(r.remaining.includes('PRIVATE_HISTORY_ARCHIVE_AND_ATOMIC_INITIALIZATION'));});
 for(const kind of ['phase','canonical','incomplete','self','permission','plan','contract','runtime','package','selection','index','receipt','output','builder','later-review','lock','target'])await t.test('source preparation rejects '+kind+' without writes',()=>{
  reset();if(['permission','self','target'].includes(kind)){const a=structuredClone(f.preparation);if(kind==='permission')a.permission='INITIALIZE';if(kind==='self')a.providerSessionId='builder-session';if(kind==='target')a.targetRunSlug='invented';for(const r of f.records.filter(r=>r.step==='review-architecture'&&r.type==='phase_complete'))r.content=fenced('enterprise-failed-interval-design-attestation',a);f.append({type:'boundary'});put(join(f.run.reportsAbs,'enterprise-02-review.md'),fenced('enterprise-failed-interval-design-attestation',a)+'\n');}
  else if(kind==='phase'){f.records.find(r=>r.step==='review-architecture'&&r.phase===1).content='missing';f.append({type:'boundary'});}
  else if(kind==='incomplete'){f.records.find(r=>r.step==='review-architecture'&&r.type==='step_complete').status='error';f.append({type:'boundary'});}
  else if(kind==='builder'){f.records[f.preparation.subsequentBuilderOccurrences[0].startIndex].model='gpt-6.1-sol';f.append({type:'boundary'});}
  else if(kind==='later-review'){f.context('review-foundation',8);f.context('build-foundation',9);}
  else if(kind==='lock')put(file(f,'evidence/enterprise/gate.lock'),{pid:process.pid});
  else {const paths={canonical:join(f.run.reportsAbs,'enterprise-02-review.md'),plan:file(f,'work/enterprise/plan.json'),contract:file(f,'work/enterprise/RUNTIME_CONTINUATION.md'),runtime:file(f,'evidence/probe.json'),package:file(f,'package.json'),selection:file(f,f.preparation.entrySelection.path),index:ip(f),receipt:file(f,f.preparation.failedReceipts[0].path),output:file(f,read(file(f,f.preparation.failedReceipts[0].path)).suites[0].stdout)};fs.appendFileSync(paths[kind],' ');}
  fail(preparationRead(f));
 });
 await t.test('source preparation is not initializer or normal regeneration authority',()=>{reset();unchanged(f,['batch','--initialize-run'],/already initialized/);unchanged(f,['batch','--recover-rejected'],/single enterprise-recovery-design-attestation required/);f.nextRun('uninitialized-preparation-run');const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,'--input-type=module','-e',"import fs from 'node:fs';import {runBatchGate} from './scripts/enterprise/verify.mjs';const p=JSON.parse(fs.readFileSync('work/enterprise/plan.json'));await runBatchGate(process.cwd(),p,p.batches.find(b=>b.id==='B01'),'builder-session',true);"],{cwd:f.root,env:f.env,encoding:'utf8'});fail(q,/writer binding runSlug/);assert.deepEqual(tree(f.temporary),before);});
});

test('runtime historical failure diagnostics',async t=>{
 const f=await preparationFixture(t),selection=read(file(f,read(pp(f)).entrySelection)),plan=JSON.parse(selection.planText),reset=restorePoint(f);
 const inspect=(index,edit=()=>{})=>{const ref=f.preparation.failedReceipts[index],r=read(file(f,ref.path));edit(r);put(file(f,'evidence/inspect.json'),r);const code="import fs from 'node:fs';import {inspectFailedReceipt} from './scripts/enterprise/runtime-preparation.mjs';import {suitesFor} from './scripts/enterprise/gate-execution.mjs';const r=JSON.parse(fs.readFileSync('evidence/inspect.json')),p=JSON.parse(JSON.parse(fs.readFileSync('"+read(pp(f)).entrySelection+"')).planText);console.log(JSON.stringify(inspectFailedReceipt(process.cwd(),r,suitesFor(p,p.batches.find(b=>b.id===r.batchId).issueIds))));";const before=tree(f.temporary),result=spawnSync(process.execPath,['--import',f.guardPath,'--input-type=module','-e',code],{cwd:f.root,env:f.env,encoding:'utf8'});assert.deepEqual(tree(f.temporary),before);return result;};
 await t.test('runtime-continuation-subprocess-nonzero-preserved',()=>{assert.equal(ok(inspect(1)).kind,'SUBPROCESS_FAILURE');});
 await t.test('runtime-continuation-exit-zero-missing-assertion-preserved',()=>{assert.equal(ok(inspect(0)).kind,'GATE_VALIDATION_FAILURE');});
 await t.test('runtime-continuation-failed-without-reproducible-cause-rejected',()=>{const passed=read(file(f,'evidence/enterprise/runs/'+selection.predecessors[0].runId+'/receipt.json'));fail(inspect(0,r=>{Object.assign(r,passed,{status:'failed',error:'invented failure'});}),/failed receipt without reproducible cause/);});
 for(const kind of ['running','unfinished','exit','error','argv','runtime','inputs','output','extra-suite','tap'])await t.test('failed receipt rejects '+kind,()=>{reset();fail(inspect(0,r=>{if(kind==='running')r.status='running';if(kind==='unfinished')delete r.finishedAt;if(kind==='exit')r.suites[0].exitCode=1;if(kind==='error')r.suites[0].error='invented';if(kind==='argv')r.suites[0].argv=['true'];if(kind==='runtime')delete r.suites[0].runtime;if(kind==='inputs')r.inputs.digest='invented';if(kind==='output')fs.appendFileSync(file(f,r.suites[0].stdout),'changed');if(kind==='extra-suite')r.suites.push(r.suites[0]);if(kind==='tap')r.suites[0].inputsAfter='changed';}));});
});

// Completed source reports bind full byte copies, not a digest allowlist. The
// fixture still uses real CLI failures; history verification never runs a gate.
async function inputHistoryFixture(t,options={}){
 const f=await preparationFixture(t,options),old=read(file(f,f.preparation.failedReceipts[0].path)).inputs,now=read(file(f,f.preparation.failedReceipts[1].path)).inputs;
 const references=[];
 for(const m of [old,now])for(const e of m.entries){
  let raw=fs.readFileSync(file(f,e.path));
  if(hash(raw)!==e.sha256&&e.path==='tests/assertion.test.mjs')raw=Buffer.from(raw.toString().replace("\nthrow Error('actual subprocess failure');\n",''));
  assert.equal(hash(raw),e.sha256);
  const path='evidence/enterprise/history-builder5/copies/'+m.digest+'/'+e.path;put(file(f,path),raw.toString());references.push({path,sha256:e.sha256,bytes:e.bytes});
 }
 const path='evidence/enterprise/history-builder5/handoff.json';
 put(file(f,path),{schemaVersion:1,run:f.run.slug,iteration:5,builderSession:'builder-session',inputsDigest:now.digest,references});
 const sha256=hash(fs.readFileSync(file(f,path)));
 for(const p of f.records.filter(r=>r.type==='phase_complete'&&r.step==='build-foundation'&&r.iteration===5))p.content+='\n'+path+'\n'+sha256;
 const a=f.preparation,b=a.subsequentBuilderOccurrences[0];
 for(const phase of [1,2])b['phase'+phase+'Sha256']=hash(f.records.find(r=>r.type==='phase_complete'&&r.step==='build-foundation'&&r.iteration===5&&r.phase===phase).content);
 a.retainedBuilderHandoff={path,sha256};
 for(const p of f.records.filter(r=>r.type==='phase_complete'&&r.step==='review-architecture'&&r.iteration===6))p.content=fenced('enterprise-failed-interval-design-attestation',a);
 put(join(f.run.reportsAbs,'enterprise-02-review.md'),fenced('enterprise-failed-interval-design-attestation',a)+'\n');f.append({type:'boundary'});
 const q=spawnSync(process.execPath,['--input-type=module','-e',"import {inputs} from './scripts/enterprise/evidence.mjs';console.log(JSON.stringify(inputs(process.cwd())));"],{cwd:f.root,env:f.env,encoding:'utf8'}),m=ok(q),d='evidence/enterprise/history-builder7';
 const snapshots=m.entries.map(e=>{const copy=d+'/copies/'+e.path;put(file(f,copy),fs.readFileSync(file(f,e.path),'utf8'));return {...e,copy};});
 f.historyPath=d+'/handoff.json';put(file(f,f.historyPath),{schemaVersion:1,run:f.run.slug,iteration:7,builderSession:'builder-session',inputs:m,snapshots,references:snapshots.map(e=>({path:e.copy,sha256:e.sha256,bytes:e.bytes}))});
 const content=f.historyPath+'\n'+hash(fs.readFileSync(file(f,f.historyPath)));
 for(const phase of [1,2])f.append({type:'phase_complete',step:'build-foundation',iteration:7,workflow:f.workflow.name,stack:f.stack('build-foundation'),phase,phaseExecutionId:'history:7:'+phase,status:'done',timestamp:new Date().toISOString(),content});
 f.append({type:'step_complete',step:'build-foundation',iteration:7,workflow:f.workflow.name,stack:f.stack('build-foundation'),status:'done'});f.context('build-foundation',8);return f;
}
function rebindHistory(f,edit){mutate(f,f.historyPath,edit);const content=f.historyPath+'\n'+hash(fs.readFileSync(file(f,f.historyPath)));for(const p of f.records.filter(r=>r.iteration===7&&r.type==='phase_complete'))p.content=content;f.append({type:'boundary'});}
function inputHistoryRead(f){const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-preparation.mjs'),'--input-history'],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000});assert.deepEqual(tree(f.temporary),before);return q;}
test('runtime source input byte provenance',async t=>{
 const f=await inputHistoryFixture(t),reset=restorePoint(f);
 await t.test('phase-bound copies prove reviewed and failed inputs without current approval',()=>{const q=inputHistoryRead(f);assert.equal(q.status,0,q.stderr);const h=JSON.parse(q.stdout);assert.equal(h.handoffs.length,2);assert.equal(h.manifests.length,2);assert.equal(h.proofs.length,h.manifests.reduce((n,m)=>n+m.inputs.entries.length,0));assert.equal(h.completeMigrationHistory,false);assert.equal(h.initializationAuthority,false);assert.deepEqual(h.currentApprovals,[]);});
 await t.test('later source edit uses immutable copies without relabeling current inputs',()=>{reset();fs.appendFileSync(file(f,'src/domain.mjs'),'later edit');const q=inputHistoryRead(f);assert.equal(q.status,0,q.stderr);const h=JSON.parse(q.stdout);assert.ok(h.manifests.every(m=>m.inputs.digest!==h.currentInputs.digest));assert.ok(h.proofs.every(p=>p.source.path.startsWith('evidence/enterprise/')));});
 for(const kind of ['phase-path','phase-hash','phase-id','phase-time','unfinished','run','iteration','session','digest','runtime','duplicate-input','copy-missing','copy-tampered','coverage','copy-reference','copy-escape','duplicate-reference','length','relocation-escape','unrecorded-copy','handoff-tampered'])await t.test('historical input rejects '+kind+' without writes',()=>{
  reset();
  if(kind.startsWith('phase-')){const p=f.records.find(r=>r.iteration===7&&r.type==='phase_complete'&&r.phase===1);if(kind==='phase-path')p.content='unbound';if(kind==='phase-hash')p.content=f.historyPath;if(kind==='phase-id')delete p.phaseExecutionId;if(kind==='phase-time')p.timestamp='1970-01-01';f.append({type:'boundary'});}
  else if(kind==='unfinished'){f.records.find(r=>r.iteration===7&&r.type==='step_complete').status='error';f.append({type:'boundary'});}
  else if(kind==='handoff-tampered')fs.appendFileSync(file(f,f.historyPath),' ');
  else if(kind==='copy-missing'||kind==='copy-tampered'){const h=read(file(f,f.historyPath)),p=file(f,h.snapshots[0].copy);if(kind==='copy-missing')fs.rmSync(p);else fs.appendFileSync(p,'x');}
  else if(kind==='unrecorded-copy'){
   // An arbitrary file with matching bytes is not a report-bound byte source.
   const h=read(file(f,f.preparation.retainedBuilderHandoff.path)),m=read(file(f,f.preparation.failedReceipts[0].path)).inputs,e=m.entries.find(e=>e.path==='tests/assertion.test.mjs'),r=h.references.find(r=>r.sha256===e.sha256);
   put(file(f,'evidence/unrecorded-old-input'),fs.readFileSync(file(f,r.path),'utf8'));for(const ref of h.references.filter(r=>r.sha256===e.sha256))fs.rmSync(file(f,ref.path));
  }else rebindHistory(f,h=>{
   if(kind==='run')h.run='other';if(kind==='iteration')h.iteration=99;if(kind==='session')h.builderSession='other';if(kind==='digest')h.inputs.digest='f'.repeat(64);if(kind==='runtime')h.inputs.runtime.version='other';
   if(kind==='duplicate-input'){h.inputs.entries.push(h.inputs.entries[0]);h.inputs.digest=hash(JSON.stringify({entries:h.inputs.entries,runtime:h.inputs.runtime}));}
   if(kind==='coverage')h.snapshots.pop();if(kind==='copy-reference')h.references.shift();if(kind==='copy-escape')h.snapshots[0].copy='../escape';if(kind==='duplicate-reference')h.references.push(h.references[0]);if(kind==='length')h.references[0].bytes=-1;
   if(kind==='relocation-escape')h.historyPreservation={relocatedReferences:[{path:'src/domain.mjs',actualPath:'/etc/passwd',sha256:'a'.repeat(64),bytes:1}]};
  });
  const diagnostics={'phase-path':/phase-bound builder handoff/,'phase-hash':/hash missing from phase/,'phase-id':/phase execution required/,'phase-time':/phase timestamp/,unfinished:/incomplete preparation occurrence/,run:/handoff run/,iteration:/handoff iteration/,session:/handoff session/,digest:/history input digest/,runtime:/historical input runtime drift/,'duplicate-input':/duplicate historical input/,'copy-missing':/ENOENT/,'copy-tampered':/changed history bytes/,coverage:/snapshot coverage/,'copy-reference':/snapshot reference missing/,'copy-escape':/snapshot outside handoff directory/,'duplicate-reference':/duplicate handoff reference/,length:/history reference length/,'relocation-escape':/relocation outside evidence/,'unrecorded-copy':/historical input bytes unavailable/,'handoff-tampered':/hash missing from phase/};
  fail(inputHistoryRead(f),diagnostics[kind]);
 });
 await t.test('history diagnostic cannot initialize or bypass failed normal receipt',()=>{reset();unchanged(f,['batch','--initialize-run'],/already initialized/);unchanged(f,['batch','--recover-rejected'],/single enterprise-recovery-design-attestation required/);});
});

// Design snapshots are untrusted locators. Real phase digests and the frozen
// engine's project-policy resolver supply their identity and routing checks.
async function designHistoryFixture(t,base,iterations=[7,8]){
 const f=base??await preparationFixture(t,{designHistory:true});f.records.pop();
 const entries=[];
 for(const [n,iteration]of iterations.entries()){
  put(file(f,'work/enterprise/design-history-fixture.md'),'design revision '+iteration);
  const m=ok(spawnSync(process.execPath,['--input-type=module','-e',"import {inputs} from './scripts/enterprise/evidence.mjs';console.log(JSON.stringify(inputs(process.cwd())));"],{cwd:f.root,env:f.env,encoding:'utf8'}));
  const snapshots=m.entries.map(e=>{const copy=`evidence/enterprise/design-${iteration}/copies/${e.path}`;fs.mkdirSync(join(file(f,copy),'..'),{recursive:true});fs.copyFileSync(file(f,e.path),file(f,copy));return {...e,copy};});
  f.context('design-architecture',iteration);const startIndex=f.records.length-1,start=f.records[startIndex];start.stack[0].occurrence=n+1;start.model=n?'gpt-6-astra':'gpt-6.1-sol';start.providerOptions.codex.reasoningEffort=n?'high':'medium';start.providerSource=start.modelSource=n?'promotion':'provider_routing.steps';
  const content='```text\ninputsDigest\n'+m.digest+'\n```',timestamp=new Date().toISOString();
  for(const phase of [1,2])f.append({type:'phase_complete',step:start.step,iteration,workflow:f.workflow.name,stack:structuredClone(start.stack),phase,phaseExecutionId:`design:${iteration}:${phase}`,status:'done',timestamp,content});
  f.append({type:'step_complete',step:start.step,iteration,workflow:f.workflow.name,stack:structuredClone(start.stack),status:'done',timestamp:start.timestamp});
  put(join(f.run.reportsAbs,'enterprise-01-architecture.md'),content+'\n');entries.push({startIndex,inputs:m,snapshots});
 }
 f.designInventory='evidence/enterprise/design-byte-inventory.json';put(file(f,f.designInventory),{schemaVersion:1,kind:'UNTRUSTED_DESIGN_BYTE_INVENTORY',run:f.run.slug,entries});f.context('build-foundation',iterations.at(-1)+1);return f;
}
function designHistoryRead(f){const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-preparation.mjs'),'--design-history',f.designInventory],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000});assert.deepEqual(tree(f.temporary),before);return q;}
test('runtime source design byte provenance',async t=>{
 const f=await designHistoryFixture(t),reset=restorePoint(f);
 await t.test('phase-bound design snapshots resolve Sol then promoted Astra without initialization authority',()=>{const q=designHistoryRead(f);assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.deepEqual(r.designs.map(d=>d.routing),[{provider:'codex',model:'gpt-6.1-sol',effort:'medium'},{provider:'codex',model:'gpt-6-astra',effort:'high'}]);assert.equal(r.initializationAuthority,false);assert.equal(r.completeMigrationHistory,false);assert.deepEqual(r.currentApprovals,[]);assert.equal(r.designs.length,2);assert.ok(r.designs[1].canonical);assert.equal(r.designs[0].canonical,undefined);});
 await t.test('later edit never replaces authenticated design bytes',()=>{reset();fs.appendFileSync(file(f,'work/enterprise/design-history-fixture.md'),'later');const q=designHistoryRead(f);assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.ok(r.designs.every(d=>d.inputs.digest!==r.currentInputs.digest));});
 const cases={run:/design inventory run/,missing:/complete design occurrence inventory/,duplicate:/complete design occurrence inventory/,digest:/design manifest digest/,runtime:/design historical runtime drift/,coverage:/design snapshot coverage/,'copy-missing':/ENOENT/,'copy-tampered':/changed design snapshot/,'copy-escape':/design copy outside evidence/,'phase-unbound':/single explicit design inputsDigest/,'phase-digest':/phase design digest/,'phase-duplicate':/single explicit design inputsDigest/,'phase-id':/design phase execution required/,'phase-id-reuse':/design phase execution reused/,'phase-time':/design phase timestamp/,'phase-order':/preparation phase order/,incomplete:/incomplete preparation occurrence/,model:/occurrence model/,effort:/occurrence effort/,source:/design model source/,count:/design occurrence count/,'done-time':/design response timestamp/,canonical:/design canonical report mismatch/,session:/design session aliases builder/};
 for(const [kind,re]of Object.entries(cases))await t.test('design history rejects '+kind+' without writes',()=>{
  reset();const inv=read(file(f,f.designInventory)),entry=inv.entries[0],start=f.records[entry.startIndex],phases=f.records.filter(r=>r.type==='phase_complete'&&r.step==='design-architecture'&&r.iteration===7),p=phases[0];
  if(kind==='run')inv.run='other';if(kind==='missing')inv.entries.pop();if(kind==='duplicate')inv.entries.push(inv.entries[0]);if(kind==='digest')entry.inputs.digest='f'.repeat(64);if(kind==='runtime')entry.inputs.runtime.version='other';if(kind==='coverage')entry.snapshots.pop();if(kind==='copy-escape')entry.snapshots[0].copy='/tmp/escape';
  if(kind==='copy-missing')fs.rmSync(file(f,entry.snapshots[0].copy));if(kind==='copy-tampered')fs.appendFileSync(file(f,entry.snapshots[0].copy),'x');
  if(kind==='phase-unbound')p.content=entry.inputs.digest;if(kind==='phase-digest')p.content=p.content.replace(entry.inputs.digest,'e'.repeat(64));if(kind==='phase-duplicate')p.content+='\n'+p.content;if(kind==='phase-id')delete p.phaseExecutionId;if(kind==='phase-id-reuse')phases[1].phaseExecutionId=p.phaseExecutionId;if(kind==='phase-time')p.timestamp='1970-01-01';if(kind==='phase-order'){const a=f.records.indexOf(p),b=f.records.indexOf(phases[1]);[f.records[a],f.records[b]]=[f.records[b],f.records[a]];}
  const done=f.records.find(r=>r.type==='step_complete'&&r.step===start.step&&r.iteration===7);if(kind==='incomplete')done.status='error';if(kind==='done-time')done.timestamp='1970-01-01';
  if(kind==='model')start.model='gpt-6-astra';if(kind==='effort')start.providerOptions.codex.reasoningEffort='low';if(kind==='source')start.modelSource='cli';if(kind==='count')start.stack[0].occurrence=3;
  if(kind==='canonical')fs.appendFileSync(join(f.run.reportsAbs,'enterprise-01-architecture.md'),'changed');if(kind==='session'){f.sessions[JSON.stringify(['enterprise-architect','codex','gpt-6.1-sol'])]='builder-session';savePersonaSessions(f.root,f.sessions,'codex',f.paths.sessionsDirectory);}
  put(file(f,f.designInventory),inv);f.append({type:'boundary'});fail(designHistoryRead(f),re);
 });
 await t.test('design diagnostic cannot grant same-run initialization or regeneration',()=>{reset();unchanged(f,['batch','--initialize-run'],/already initialized/);unchanged(f,['batch','--recover-rejected'],/single enterprise-recovery-design-attestation required/);});
});

function transitionRead(f){const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-preparation.mjs'),'--transitions',f.designInventory],{cwd:f.root,env:f.env,encoding:'utf8',timeout:30000});assert.deepEqual(tree(f.temporary),before);return q;}
test('runtime source checkpoint transitions',async t=>{
 const f=await designHistoryFixture(t,await inputHistoryFixture(t,{designHistory:true}),[8,9]);
 for(const p of f.records.filter(r=>r.step==='review-architecture'&&r.type==='phase_complete')){p.phaseExecutionId='review:'+p.iteration+':'+p.phase;p.timestamp=f.records.find(r=>r.type==='step_start'&&r.step===p.step&&r.iteration===p.iteration).timestamp;}f.append({type:'boundary'});const reset=restorePoint(f);
 await t.test('ordered real failed receipts and completed builder design endpoints preserve exact deltas',()=>{
  const q=transitionRead(f);assert.equal(q.status,0,q.stderr);const h=JSON.parse(q.stdout);
  assert.deepEqual(h.checkpoints.map(c=>c.kind),['REVIEWED_PREFIX','FAILED_RECEIPT','FAILED_RECEIPT','BUILDER_ENDPOINT','BUILDER_ENDPOINT','DESIGN_ENDPOINT','DESIGN_ENDPOINT']);
  assert.deepEqual(h.observations.map(o=>o.iteration),[5,6,7,8,9]);assert.deepEqual(h.transitions[1].changes.map(c=>c.path),['tests/assertion.test.mjs']);assert.equal(h.transitions[0].changes.length,0);
  assert.ok(h.transitions.at(-2).changes.some(c=>c.path==='work/enterprise/design-history-fixture.md'&&c.before===null&&c.after));
  assert.ok(h.transitions.at(-1).changes.some(c=>c.path==='work/enterprise/design-history-fixture.md'&&c.before&&c.after));
  assert.equal(h.currentBuilder.status,'OPEN_UNATTESTED_ENDPOINT');assert.equal(h.exclusiveWriterProven,false);assert.equal(h.initializationAuthority,false);assert.equal(h.completeMigrationHistory,false);assert.deepEqual(h.currentApprovals,[]);
 });
 await t.test('current unfinished edit is never presented as a completed historical endpoint',()=>{reset();fs.appendFileSync(file(f,'src/domain.mjs'),'open edit');const q=transitionRead(f);assert.equal(q.status,0,q.stderr);const h=JSON.parse(q.stdout);assert.ok(h.checkpoints.every(c=>c.inputsDigest!==h.currentInputs.digest));});
 for(const [kind,re]of Object.entries({endpoint:/transition builder endpoint manifest missing/,conflict:/conflicting builder endpoint digest/,iteration:/transition iteration order/,time:/transition occurrence time order/,reuse:/transition phase execution reused/,'review-time':/transition phase time order/,'review-id':/transition phase execution missing/,'receipt-late':/transition receipt after reported endpoint unsupported/,unknown:/unknown transition/,review:/incomplete preparation occurrence/}))await t.test('transition rejects '+kind+' before writes',()=>{
  reset();
  if(kind==='endpoint')rebindHistory(f,h=>{delete h.inputs;delete h.inputsDigest;});
  if(kind==='conflict')rebindHistory(f,h=>{h.inputsDigest='a'.repeat(64);});
  if(kind==='iteration'){const a=structuredClone(f.preparation);a.iteration=7.5;for(const r of f.records.filter(r=>r.step==='review-architecture'&&r.iteration===6)){r.iteration=7.5;if(r.type==='phase_complete')r.content=fenced('enterprise-failed-interval-design-attestation',a);}put(join(f.run.reportsAbs,'enterprise-02-review.md'),fenced('enterprise-failed-interval-design-attestation',a)+'\n');}
  if(kind==='time')f.records.find(r=>r.type==='step_start'&&r.iteration===7).timestamp='1970-01-01';
  if(kind==='reuse')f.records.find(r=>r.type==='phase_complete'&&r.iteration===7&&r.phase===1).phaseExecutionId=f.records.find(r=>r.type==='phase_complete'&&r.iteration===5&&r.phase===1).phaseExecutionId;
  if(kind==='receipt-late')for(const p of f.records.filter(r=>r.type==='phase_complete'&&r.iteration===5))p.timestamp=f.records.find(r=>r.type==='step_start'&&r.iteration===5).timestamp;
  if(kind==='review-time')f.records.find(r=>r.type==='phase_complete'&&r.iteration===6&&r.phase===1).timestamp='1970-01-01';
  if(kind==='review-id')delete f.records.find(r=>r.type==='phase_complete'&&r.iteration===6&&r.phase===1).phaseExecutionId;
  if(kind==='unknown'){const i=f.records.findIndex(r=>r.type==='step_start'&&r.iteration===10),s=structuredClone(f.records[i]);s.step='unregistered-writer';s.iteration=9.5;f.records.splice(i,0,s);}
  if(kind==='review'){/* D_S remains complete; an additional unfinished review is not accepted. */const i=f.records.findIndex(r=>r.type==='step_start'&&r.iteration===8),s=structuredClone(f.records.find(r=>r.type==='step_start'&&r.iteration===6));s.iteration=7.5;f.records.splice(i,0,s);}
  f.append({type:'boundary'});fail(transitionRead(f),re);
 });
 await t.test('checkpoint diagnostic cannot initialize or regenerate current failed prefix',()=>{reset();unchanged(f,['batch','--initialize-run'],/already initialized/);unchanged(f,['batch','--recover-rejected'],/single enterprise-recovery-design-attestation required/);});
});

// Official central process mechanics, with a synthetic provider only.
test('runtime continuation official launcher mechanics',async t=>{
 const {launcherFixture}=await import('./runtime-launcher-fixture.mjs');await launcherFixture(t);
});

test('runtime continuation six-step semantic comparison',async t=>{
 const {semanticsFixture}=await import('./runtime-semantics-fixture.mjs');await semanticsFixture(t);
});

test('runtime continuation official six-step engine gates',async t=>{
 const {engineFixture}=await import('./runtime-engine-fixture.mjs');await engineFixture(t);
});

test('runtime continuation command gate descendant quiescence',async t=>{
 const {processFixture}=await import('./runtime-process-fixture.mjs');await processFixture(t);
});

test('runtime continuation observed file writer boundary',async t=>{const {writersFixture}=await import('./runtime-writers-fixture.mjs');await writersFixture(t);});

test('runtime continuation central queue boundary',async t=>{const {queueFixture}=await import('./runtime-queue-fixture.mjs');await queueFixture(t);});

test('R1 historical evidence reference closure',async t=>{
 const f=await inputHistoryFixture(t),reset=restorePoint(f);
 const parsed=q=>{assert.equal(q.status,0,q.stderr);return JSON.parse(q.stdout);};
 const inspect=(strict=true)=>{
  const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-preparation.mjs'),strict?'--reference-history':'--inspect-references'],{cwd:f.root,env:f.env,encoding:'utf8',timeout:30000});
  assert.deepEqual(tree(f.temporary),before);return q;
 };
 const logical='evidence/enterprise/old-observation.json',copy='evidence/enterprise/history-builder7/old-copy.json',raw='original observation\n';
 const reference={path:logical,sha256:hash(raw),bytes:Buffer.byteLength(raw)};
 await t.test('phase-bound reference bytes verified without projection authority',()=>{const r=parsed(inspect());assert.equal(r.referenceBytesComplete,true);assert.equal(r.completeMigrationHistory,false);assert.equal(r.initializationAuthority,false);assert.deepEqual(r.currentApprovals,[]);assert.ok(r.proofs.length);});
 await t.test('missing non-input evidence refuses even when input snapshots pass',()=>{reset();rebindHistory(f,h=>h.references.push(reference));assert.equal(inputHistoryRead(f).status,0);fail(inspect(),/historical reference bytes unavailable/);const r=parsed(inspect(false));assert.equal(r.referenceBytesComplete,false);assert.equal(r.missing[0].path,logical);assert.match(r.missing[0].consumer.pointer,/references/);});
 await t.test('recorded immutable copy resolves changed original bytes',()=>{reset();put(file(f,logical),'changed');put(file(f,copy),raw);rebindHistory(f,h=>h.references.push(reference,{...reference,path:copy}));const r=parsed(inspect());const p=r.proofs.find(p=>p.path===logical);assert.equal(p.source.path,copy);assert.equal(p.source.sha256,reference.sha256);});
 await t.test('matching unrecorded file never supplies historical authority',()=>{reset();put(file(f,copy),raw);rebindHistory(f,h=>h.references.push(reference));fail(inspect(),/historical reference bytes unavailable/);});
 await t.test('acknowledged historical difference is still required',()=>{reset();rebindHistory(f,h=>h.historyPreservation={historicalDifferences:[{path:logical,sha256:reference.sha256,actualSha256:hash('changed')}]});const r=parsed(inspect(false));assert.equal(r.missing.length,1);assert.match(r.missing[0].consumer.pointer,/historicalDifferences/);fail(inspect(),/historical reference bytes unavailable/);});
 await t.test('acknowledged preimage resolves only through phase-bound copy',()=>{reset();put(file(f,copy),raw);rebindHistory(f,h=>{h.historyPreservation={historicalDifferences:[reference]};h.references.push({...reference,path:copy});});assert.equal(parsed(inspect()).referenceBytesComplete,true);});
 await t.test('tampered copy does not resolve preimage',()=>{reset();put(file(f,copy),raw+'tampered');rebindHistory(f,h=>h.references.push(reference,{...reference,path:copy}));fail(inspect(),/historical reference bytes unavailable/);});
 await t.test('symlink copy is rejected before reads or writes',()=>{reset();put(file(f,logical),raw);fs.symlinkSync(file(f,logical),file(f,copy));rebindHistory(f,h=>h.references.push({...reference,path:copy}));fail(inspect(),/symlink/);});
 await t.test('unsafe acknowledged path is rejected',()=>{reset();rebindHistory(f,h=>h.historyPreservation={historicalDifferences:[{...reference,path:'../escape'}]});fail(inspect(),/path|escape|relative/);});
 await t.test('malformed acknowledged hash is rejected',()=>{reset();rebindHistory(f,h=>h.historyPreservation={historicalDifferences:[{...reference,sha256:'unknown'}]});fail(inspect(),/historical reference hash/);});
 await t.test('active writer still blocks reference history',()=>{reset();put(file(f,'evidence/enterprise/gate.lock'),{pid:process.pid});fail(inspect(),/writer active or unknown/);});
});

// A real execution after the two report phases. The independent design binds
// its failed receipt; chronological placement never certifies automatic origin.
test('runtime post-report failed receipt ordering',async t=>{
 const f=await designHistoryFixture(t,await inputHistoryFixture(t,{designHistory:true,postReportFailure:true}),[8,9]);
 for(const p of f.records.filter(r=>r.step==='review-architecture'&&r.type==='phase_complete')){p.phaseExecutionId='review:'+p.iteration+':'+p.phase;p.timestamp=f.records.find(r=>r.type==='step_start'&&r.step===p.step&&r.iteration===p.iteration).timestamp;}f.append({type:'boundary'});const reset=restorePoint(f);
 const report=()=>f.records.filter(r=>r.type==='phase_complete'&&r.iteration===5);
 const post=()=>read(file(f,f.preparation.failedReceipts[1].path));
 const rebindEndpoint=digest=>{const path=f.preparation.retainedBuilderHandoff.path;mutate(f,path,h=>h.inputsDigest=digest);const sha256=hash(fs.readFileSync(file(f,path)));for(const p of report())p.content='reported endpoint\n'+path+'\n'+sha256;const a=f.preparation;a.retainedBuilderHandoff.sha256=sha256;for(const p of report())a.subsequentBuilderOccurrences[0]['phase'+p.phase+'Sha256']=hash(p.content);for(const p of f.records.filter(r=>r.type==='phase_complete'&&r.iteration===6))p.content=fenced('enterprise-failed-interval-design-attestation',a);put(join(f.run.reportsAbs,'enterprise-02-review.md'),fenced('enterprise-failed-interval-design-attestation',a)+'\n');f.append({type:'boundary'});};
 await t.test('actual subprocess failure follows report endpoint with unchanged inputs',()=>{const r=post();assert.ok(Date.parse(r.startedAt)>=Date.parse(report()[1].timestamp));const q=transitionRead(f);assert.equal(q.status,0,q.stderr);const h=JSON.parse(q.stdout);assert.deepEqual(h.checkpoints.map(c=>c.kind),['REVIEWED_PREFIX','FAILED_RECEIPT','BUILDER_ENDPOINT','FAILED_RECEIPT','BUILDER_ENDPOINT','DESIGN_ENDPOINT','DESIGN_ENDPOINT']);const c=h.checkpoints[3];assert.equal(c.receipt,f.preparation.failedReceipts[1].path);assert.equal(c.reportRelation,'AFTER_REPORT');assert.equal(c.automaticGateOriginProven,false);assert.equal(h.checkpoints[1].reportRelation,'BEFORE_REPORT');assert.equal(c.inputsDigest,h.checkpoints[2].inputsDigest);assert.deepEqual(h.transitions[2].changes,[]);assert.equal(h.initializationAuthority,false);assert.equal(h.completeMigrationHistory,false);assert.equal(h.exclusiveWriterProven,false);assert.deepEqual(h.currentApprovals,[]);});
 await t.test('post-report changed input is not attributed to the completed builder',()=>{reset();rebindEndpoint(read(file(f,f.preparation.failedReceipts[0].path)).inputs.digest);fail(transitionRead(f),/transition receipt after reported endpoint unsupported/);});
 await t.test('receipt spanning the report boundary is rejected',()=>{reset();const r=post();report()[1].timestamp=r.finishedAt;f.append({type:'boundary'});fail(transitionRead(f),/transition receipt overlaps report phases/);});
 await t.test('receipt between phase one and phase two is rejected',()=>{reset();report()[1].timestamp=new Date(Date.parse(post().finishedAt)+1).toISOString();f.append({type:'boundary'});fail(transitionRead(f),/transition receipt overlaps report phases/);});
 await t.test('unattested post-report receipt bytes are rejected',()=>{reset();fs.appendFileSync(file(f,f.preparation.failedReceipts[1].path),' ');fail(transitionRead(f));});
 await t.test('post-report ordering does not authorize initializer or regeneration',()=>{reset();unchanged(f,['batch','--initialize-run'],/already initialized/);unchanged(f,['batch','--recover-rejected'],/single enterprise-recovery-design-attestation required/);});
});

// R1 failure provenance must preserve the controller's per-receipt namespace
// and sequential execution contract, even if relocated bytes still hash-match.
test('runtime historical failure output ownership and sequence',async t=>{
 const f=await preparationFixture(t),reset=restorePoint(f);
 const selection=read(file(f,read(pp(f)).entrySelection)),plan=JSON.parse(selection.planText);
 const definitions=index=>{const r=read(file(f,f.preparation.failedReceipts[index].path));return plan.issues.filter(i=>plan.batches.find(b=>b.id===r.batchId).issueIds.includes(i.id)).flatMap(i=>i.suites).filter((s,i,a)=>a.findIndex(x=>x.id===s.id)===i);};
 const inspect=(r,defs)=>{put(file(f,'evidence/failure-inspection.json'),{r,defs});const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,'--input-type=module','-e',"import fs from 'node:fs';import {inspectFailedReceipt} from './scripts/enterprise/runtime-preparation.mjs';const {r,defs}=JSON.parse(fs.readFileSync('evidence/failure-inspection.json'));console.log(JSON.stringify(inspectFailedReceipt(process.cwd(),r,defs)));"],{cwd:f.root,env:f.env,encoding:'utf8'});assert.deepEqual(tree(f.temporary),before);return q;};
 const original=()=>read(file(f,f.preparation.failedReceipts[0].path));
 const relocate=(r,directory)=>{const s=r.suites[0];fs.cpSync(file(f,s.outputDirectory),file(f,directory),{recursive:true});const prior=s.outputDirectory;s.outputDirectory=directory;s.stdout=directory+'/stdout.tap';s.stderr=directory+'/stderr.log';s.outputs.entries=s.outputs.entries.map(e=>({...e,path:directory+e.path.slice(prior.length)}));s.outputs.digest=hash(JSON.stringify(s.outputs.entries));};
 await t.test('both real failure causes retain canonical output ownership',()=>{assert.equal(ok(inspect(original(),definitions(0))).kind,'GATE_VALIDATION_FAILURE');const r=read(file(f,f.preparation.failedReceipts[1].path));assert.equal(ok(inspect(r,definitions(1))).kind,'SUBPROCESS_FAILURE');});
 for(const kind of ['other-receipt','wrong-suite-index','stdout-outside','stderr-alias','changed-run-id'])await t.test('reject '+kind+' despite matching output bytes',()=>{
  reset();const r=original(),s=r.suites[0];
  if(kind==='other-receipt')relocate(r,'evidence/enterprise/runs/9999999999999-00000000-0000-4000-8000-000000000000/suite-0');
  if(kind==='wrong-suite-index')relocate(r,`evidence/enterprise/runs/${r.id}/suite-1`);
  if(kind==='stdout-outside'){const p='evidence/reused-stdout.tap';fs.copyFileSync(file(f,s.stdout),file(f,p));s.stdout=p;}
  if(kind==='stderr-alias'){s.stderr=s.stdout;s.stderrHash=s.stdoutHash;}
  if(kind==='changed-run-id')r.id='9999999999999-00000000-0000-4000-8000-000000000000';
  fail(inspect(r,definitions(0)),/failed (output directory|stdout path|stderr path)/);
 });
 await t.test('source preparation rejects attested relocated failure outputs',()=>{
  reset();const r=original();relocate(r,`evidence/enterprise/runs/${r.id}/suite-7`);const ref=f.preparation.failedReceipts[0];put(file(f,ref.path),r);
  const a=structuredClone(f.preparation);a.failedReceipts[0].sha256=hash(fs.readFileSync(file(f,ref.path)));const content=fenced('enterprise-failed-interval-design-attestation',a);
  for(const p of f.records.filter(r=>r.step==='review-architecture'&&r.type==='phase_complete'))p.content=content;
  f.append({type:'boundary'});put(join(f.run.reportsAbs,'enterprise-02-review.md'),content+'\n');
  fail(preparationRead(f),/failed output directory/);
 });
 reset();const second=definitions(0)[0],first={...second,id:'preceding-success',requiredAssertions:['unexpected assertion']},defs=[first,second];
 put(file(f,'evidence/sequence-definitions.json'),defs);
 const execution=spawnSync(process.execPath,['--input-type=module','-e',"import fs from 'node:fs';import {execute} from './scripts/enterprise/gate-execution.mjs';execute(process.cwd(),'B01',JSON.parse(fs.readFileSync('evidence/sequence-definitions.json')),'builder-session');"],{cwd:f.root,env:f.env,encoding:'utf8'});assert.equal(execution.status,1,execution.stderr);
 const ordered=read(file(f,latest(f,'B01').path));assert.equal(ordered.suites.length,2);
 await t.test('real sequential success then assertion failure is preserved',()=>{assert.equal(ok(inspect(ordered,defs)).kind,'GATE_VALIDATION_FAILURE');});
 await t.test('overlapping suites cannot form a historical execution',()=>{const r=structuredClone(ordered);r.suites[1].startedAt=r.suites[0].startedAt;fail(inspect(r,defs),/failed suite execution order/);});
 await t.test('duplicate suite identities cannot form a historical execution',()=>{const r=structuredClone(ordered),d=structuredClone(defs);d[1].id=d[0].id;r.suites[1].id=d[1].id;r.suites[1].definitionHash=hash(JSON.stringify(d[1]));fail(inspect(r,d),/duplicate failed suite/);});
});

test('runtime failed receipt input contract',async t=>{
 const f=await preparationFixture(t),reset=restorePoint(f);
 await t.test('own plan bytes and suite sources preserve both real failure kinds',()=>{const q=preparationRead(f);assert.equal(q.status,0,q.stderr);assert.deepEqual(JSON.parse(q.stdout).failures.map(x=>x.kind),['GATE_VALIDATION_FAILURE','SUBPROCESS_FAILURE']);});
 for(const kind of ['duplicate','alias','length','hash','order','plan-length','suite-source'])await t.test('attested failed input rejects '+kind,()=>{
  reset();const a=structuredClone(f.preparation),ref=a.failedReceipts[0],r=read(file(f,ref.path)),entries=r.inputs.entries;
  const plan=entries.find(e=>e.path==='work/enterprise/plan.json'),source=entries.find(e=>e.path==='tests/failure.test.mjs');assert.ok(plan&&source);
  if(kind==='duplicate')entries.push({...plan});
  if(kind==='alias')source.path='tests/./failure.test.mjs';
  if(kind==='length')source.bytes=-1;
  if(kind==='hash')source.sha256='not-a-sha256';
  if(kind==='order')entries.reverse();
  if(kind==='plan-length')plan.bytes++;
  if(kind==='suite-source')entries.splice(entries.indexOf(source),1);
  r.inputs.digest=hash(JSON.stringify({entries,runtime:r.inputs.runtime}));for(const s of r.suites)s.inputsAfter=r.inputs.digest;
  put(file(f,ref.path),r);ref.sha256=hash(fs.readFileSync(file(f,ref.path)));ref.inputsDigest=r.inputs.digest;
  const content=fenced('enterprise-failed-interval-design-attestation',a);
  for(const p of f.records.filter(r=>r.step==='review-architecture'&&r.type==='phase_complete'))p.content=content;
  f.append({type:'boundary'});put(join(f.run.reportsAbs,'enterprise-02-review.md'),content+'\n');
  fail(preparationRead(f),/failed (input|plan|suite source)/);
 });
});

// Historical runtime copies are verified as data under the source order. They
// neither replace installed modules nor authorize initialization/approval.
test('runtime source byte preservation',async t=>{
 const f=await preparationFixture(t,{runtimePackages:true}),runtime=read(file(f,'evidence/probe.json')).oldRuntime;
 const inventoryPath='evidence/enterprise/runtime-copies/inventory.json',dir='evidence/enterprise/runtime-copies/';
 const report=fs.readFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'));
 const inventory={schemaVersion:1,kind:'UNTRUSTED_RUNTIME_BYTE_INVENTORY',run:f.run.slug,designReportSha256:hash(report),sources:[],project:{}};
 for(const [n,s] of runtime.sources.entries()){
  const source=join(f.root,'node_modules/takt',s.path==='package.json'?'package.json':'dist/'+s.path),copy=dir+'source-'+n;
  const raw=fs.readFileSync(source);assert.equal(hash(raw),s.sha256);put(file(f,copy),raw.toString());inventory.sources.push({path:s.path,copy});
 }
 for(const name of ['package.json','package-lock.json']){const copy=dir+'project-'+name;put(file(f,copy),fs.readFileSync(file(f,name)).toString());inventory.project[name]=copy;}
 put(file(f,inventoryPath),inventory);const reset=restorePoint(f);
 const inspect=()=>{const before=tree(f.temporary),r=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-preparation.mjs'),'--runtime-bytes',inventoryPath],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000});assert.deepEqual(tree(f.temporary),before);return r;};
 await t.test('runtime bytes bind all sixteen sources and project package lock with zero writes',()=>{
  const q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.deepEqual(r.runtime,runtime);assert.equal(r.sources.length,16);assert.equal(r.references.length,19);assert.equal(r.runtimeIdentityBytesComplete,true);assert.equal(r.distributionIntegrityProven,false);assert.equal(r.completeMigrationHistory,false);assert.equal(r.initializationAuthority,false);assert.deepEqual(r.currentApprovals,[]);
 });
 for(const kind of ['missing','duplicate','order','source-bytes','project-lock','symlink','escape','alias','run','design','live-fallback'])await t.test('runtime byte inventory rejects '+kind,()=>{
  reset();const inv=read(file(f,inventoryPath));
  if(kind==='missing')inv.sources.pop();
  if(kind==='duplicate')inv.sources[1]=inv.sources[0];
  if(kind==='order')inv.sources.reverse();
  if(kind==='source-bytes')fs.appendFileSync(file(f,inv.sources[1].copy),'changed');
  if(kind==='project-lock')fs.appendFileSync(file(f,inv.project['package-lock.json']),' ');
  if(kind==='symlink'){const p=file(f,inv.sources[0].copy);fs.unlinkSync(p);fs.symlinkSync(file(f,'node_modules/takt/package.json'),p);}
  if(kind==='escape')inv.sources[0].copy='../package.json';
  if(kind==='alias')inv.sources[0].copy=dir+'./source-0';
  if(kind==='run')inv.run='another-run';
  if(kind==='design')inv.designReportSha256='0'.repeat(64);
  if(kind==='live-fallback')fs.unlinkSync(file(f,inv.sources[0].copy));
  put(file(f,inventoryPath),inv);fail(inspect());
 });
 await t.test('runtime byte inventory cannot select caller runtime or initialization authority',()=>{
  reset();mutate(f,inventoryPath,inv=>{inv.runtime={version:'invented',sources:[]};inv.initializationAuthority=true;});const q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.deepEqual(r.runtime,runtime);assert.equal(r.initializationAuthority,false);unchanged(f,['batch','--initialize-run'],/already initialized/);unchanged(f,['batch','--recover-rejected'],/single enterprise-recovery-design-attestation required/);
 });
});

// Synthetic archives contain real runtime identity bytes, but use an isolated
// synthetic lock/D_S. The live distribution is checked separately as evidence.
function runtimeArchive(change=()=>{}){
 const entries=runtimeFiles.map(p=>({path:p==='package.json'?'package/package.json':p.startsWith('../')?'package/'+p.slice(3):'package/dist/'+p,raw:fs.readFileSync(new URL('../../node_modules/takt/'+(p==='package.json'?p:'dist/'+p),import.meta.url))}));
 change(entries);const chunks=[];
 for(const e of entries){const raw=e.raw??Buffer.alloc(0),header=new Header({path:e.path,type:e.type??'File',size:raw.length,mode:0o644,...(e.linkpath?{linkpath:e.linkpath}: {})});assert.equal(header.encode(),false,'fixture header must fit ustar');chunks.push(header.block,raw,Buffer.alloc((512-raw.length%512)%512));}
 chunks.push(Buffer.alloc(1024));return gzipSync(Buffer.concat(chunks));
}

async function distributionFixture(t,raw=runtimeArchive()){
 const f=await preparationFixture(t,{runtimePackages:true,runtimeDistribution:raw}),runtime=read(file(f,'evidence/probe.json')).oldRuntime,dir='evidence/enterprise/distribution/';
 const inventory={schemaVersion:1,kind:'UNTRUSTED_RUNTIME_BYTE_INVENTORY',run:f.run.slug,designReportSha256:hash(fs.readFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'))),sources:[],project:{},distribution:{copy:dir+'source.tgz'}};
 for(const [n,s] of runtime.sources.entries()){const copy=dir+'source-'+n;put(file(f,copy),fs.readFileSync(file(f,'node_modules/takt/'+(s.path==='package.json'?s.path:'dist/'+s.path))).toString());inventory.sources.push({path:s.path,copy});}
 for(const name of ['package.json','package-lock.json']){const copy=dir+'project-'+name;put(file(f,copy),fs.readFileSync(file(f,name)).toString());inventory.project[name]=copy;}
 fs.writeFileSync(file(f,inventory.distribution.copy),raw);const inventoryPath=dir+'inventory.json';put(file(f,inventoryPath),inventory);
 const inspect=()=>{const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-preparation.mjs'),'--runtime-distribution',inventoryPath],{cwd:f.root,env:f.env,encoding:'utf8',timeout:30000});assert.deepEqual(tree(f.temporary),before);return q;};
 return {f,inspect,inventoryPath,inventory,runtime};
}
test('runtime distribution integrity and identity binding',async t=>{
 const {f,inspect,inventoryPath,inventory,runtime}=await distributionFixture(t),reset=restorePoint(f);
 await t.test('saved gzip artifact matches authenticated lock and every runtime source without extraction',()=>{const q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.deepEqual(r.runtime,runtime);assert.equal(r.distribution.entries.length,16);assert.equal(r.distributionIntegrityProven,true);assert.equal(r.dependencyClosureIntegrityProven,false);assert.equal(r.initializationAuthority,false);assert.equal(r.completeMigrationHistory,false);assert.deepEqual(r.currentApprovals,[]);});
 for(const kind of ['bytes','missing','symlink','escape','alias','caller-integrity'])await t.test('runtime distribution refuses '+kind,()=>{
  reset();const copy=file(f,inventory.distribution.copy);
  if(kind==='bytes')fs.appendFileSync(copy,'changed');
  if(kind==='missing')fs.unlinkSync(copy);
  if(kind==='symlink'){fs.renameSync(copy,copy+'.saved');fs.symlinkSync(copy+'.saved',copy);}
  if(kind==='escape')mutate(f,inventoryPath,x=>x.distribution.copy='../source.tgz');
  if(kind==='alias')mutate(f,inventoryPath,x=>x.distribution.copy=x.distribution.copy.replace('source.tgz','./source.tgz'));
  if(kind==='caller-integrity'){fs.appendFileSync(copy,'changed');mutate(f,inventoryPath,x=>x.distribution.integrity='sha512-'+createHash('sha512').update(fs.readFileSync(copy)).digest('base64'));}
  fail(inspect());
 });
 for(const kind of ['identity-bytes','identity-missing','duplicate','path','link','invalid-tar'])await t.test('authenticated artifact still rejects '+kind,async t=>{
  const raw=kind==='invalid-tar'?gzipSync(Buffer.from('not a tar archive')):runtimeArchive(entries=>{
   if(kind==='identity-bytes')entries[1].raw=Buffer.from('wrong runtime bytes');
   if(kind==='identity-missing')entries.pop();
   if(kind==='duplicate')entries.push(entries[1]);
   if(kind==='path')entries.push({path:'package/../outside',raw:Buffer.from('outside')});
   if(kind==='link')entries.push({path:'package/link',type:'SymbolicLink',linkpath:'../outside'});
  });const x=await distributionFixture(t,raw);fail(x.inspect(),/runtime distribution|archive/);
 });
});

// Historical package metadata is independently phase-bound. Equal current
// runtime bytes do not certify the lock recorded by an older input manifest.
test('historical input distribution binding',async t=>{
 const archive=runtimeArchive(),f=await inputHistoryFixture(t,{runtimePackages:true,runtimeDistribution:archive}),runtime=read(file(f,'evidence/probe.json')).oldRuntime,dir='evidence/enterprise/input-distribution/';
 const inv={schemaVersion:1,kind:'UNTRUSTED_RUNTIME_BYTE_INVENTORY',run:f.run.slug,designReportSha256:hash(fs.readFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'))),sources:[],project:{},distribution:{copy:dir+'source.tgz'}};
 for(const [n,s] of runtime.sources.entries()){const copy=dir+'source-'+n;put(file(f,copy),fs.readFileSync(file(f,'node_modules/takt/'+(s.path==='package.json'?s.path:'dist/'+s.path))).toString());inv.sources.push({path:s.path,copy});}
 for(const name of ['package.json','package-lock.json']){const copy=dir+'project-'+name;put(file(f,copy),fs.readFileSync(file(f,name)).toString());inv.project[name]=copy;}
 fs.writeFileSync(file(f,inv.distribution.copy),archive);const inventoryPath=dir+'inventory.json';put(file(f,inventoryPath),inv);const reset=restorePoint(f);
 const inspect=()=>{const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-preparation.mjs'),'--input-distributions',inventoryPath],{cwd:f.root,env:f.env,encoding:'utf8',timeout:30000});assert.deepEqual(tree(f.temporary),before);return q;};
 const historicalEdit=(path,edit)=>rebindHistory(f,h=>{
  const entry=h.inputs.entries.find(e=>e.path===path),copy=h.snapshots.find(e=>e.path===path).copy;
  if(edit){const value=read(file(f,copy));edit(value);put(file(f,copy),value);const raw=fs.readFileSync(file(f,copy));for(const e of [entry,h.snapshots.find(e=>e.path===path),h.references.find(e=>e.path===copy)]){e.sha256=hash(raw);e.bytes=raw.length;}}
  else{h.inputs.entries=h.inputs.entries.filter(e=>e.path!==path);h.snapshots=h.snapshots.filter(e=>e.path!==path);h.references=h.references.filter(e=>e.path!==copy);}
  h.inputs.digest=hash(JSON.stringify({entries:h.inputs.entries,runtime:h.inputs.runtime}));
 });
 await t.test('all saved receipt and builder inputs bind to verified artifact without authority',()=>{
  const q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout),origins=r.bindings.flatMap(b=>b.origins);
  assert.equal(r.bindings.length,2);assert.equal(origins.filter(o=>o.kind==='FAILED_RECEIPT').length,2);assert.equal(origins.filter(o=>o.kind==='REVIEWED_PREFIX').length,1);assert.equal(origins.filter(o=>o.kind==='BUILDER_SNAPSHOT').length,1);
  assert.ok(r.bindings.every(b=>b.identitySourceCount===16&&b.lock.source.handoff));assert.equal(r.historicalManifestDistributionBindingsComplete,true);assert.equal(r.initializationAuthority,false);assert.equal(r.completeMigrationHistory,false);assert.deepEqual(r.currentApprovals,[]);
 });
 await t.test('historical lock with different metadata uses its own preserved bytes',()=>{
  reset();historicalEdit('package-lock.json',p=>p.historicalFixture='different from current project lock');const q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout),b=r.bindings.find(b=>b.origins.some(o=>o.kind==='BUILDER_SNAPSHOT'));assert.notEqual(b.lock.sha256,hash(fs.readFileSync(file(f,'package-lock.json'))));
 });
 for(const kind of ['pin','version','integrity','missing-package','missing-lock'])await t.test('phase-bound historical manifest rejects '+kind,()=>{
  reset();if(kind==='pin')historicalEdit('package.json',p=>p.devDependencies.takt='unrelated');
  if(kind==='version')historicalEdit('package-lock.json',p=>p.packages['node_modules/takt'].version='unrelated');
  if(kind==='integrity')historicalEdit('package-lock.json',p=>p.packages['node_modules/takt'].integrity='sha512-'+Buffer.alloc(64).toString('base64'));
  if(kind==='missing-package')historicalEdit('package.json');if(kind==='missing-lock')historicalEdit('package-lock.json');
  const generic=inputHistoryRead(f);assert.equal(generic.status,0,generic.stderr);fail(inspect(),/historical manifest|historical runtime input missing/);
 });
 await t.test('missing historical lock copy cannot fall back to current lock',()=>{
  reset();const h=read(file(f,f.historyPath));fs.unlinkSync(file(f,h.snapshots.find(e=>e.path==='package-lock.json').copy));assert.ok(fs.existsSync(file(f,'package-lock.json')));fail(inspect(),/ENOENT/);
 });
});

// Design occurrences bind their own historical package metadata, independently
// of receipt snapshots and the current package/lock.
test('historical design distribution binding',async t=>{
 const archive=runtimeArchive(),f=await designHistoryFixture(t,await preparationFixture(t,{designHistory:true,runtimePackages:true,runtimeDistribution:archive})),runtime=read(file(f,'evidence/probe.json')).oldRuntime,dir='evidence/enterprise/design-distribution/';
 const inv={schemaVersion:1,kind:'UNTRUSTED_RUNTIME_BYTE_INVENTORY',run:f.run.slug,designReportSha256:hash(fs.readFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'))),sources:[],project:{},distribution:{copy:dir+'source.tgz'}};
 for(const [n,s] of runtime.sources.entries()){const copy=dir+'source-'+n;put(file(f,copy),fs.readFileSync(file(f,'node_modules/takt/'+(s.path==='package.json'?s.path:'dist/'+s.path))).toString());inv.sources.push({path:s.path,copy});}
 for(const name of ['package.json','package-lock.json']){const copy=dir+'project-'+name;put(file(f,copy),fs.readFileSync(file(f,name)).toString());inv.project[name]=copy;}
 fs.writeFileSync(file(f,inv.distribution.copy),archive);const inventoryPath=dir+'inventory.json';put(file(f,inventoryPath),inv);const reset=restorePoint(f);
 const inspect=()=>{const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-preparation.mjs'),'--design-distributions',f.designInventory,inventoryPath],{cwd:f.root,env:f.env,encoding:'utf8',timeout:30000});assert.deepEqual(tree(f.temporary),before);return q;};
 const historicalEdit=(path,edit)=>{
  const inventory=read(file(f,f.designInventory)),d=inventory.entries[0],oldDigest=d.inputs.digest,entry=d.inputs.entries.find(e=>e.path===path),snapshot=d.snapshots.find(e=>e.path===path);
  if(edit){const value=read(file(f,snapshot.copy));edit(value);put(file(f,snapshot.copy),value);const raw=fs.readFileSync(file(f,snapshot.copy));for(const e of [entry,snapshot]){e.sha256=hash(raw);e.bytes=raw.length;}}
  else{d.inputs.entries=d.inputs.entries.filter(e=>e.path!==path);d.snapshots=d.snapshots.filter(e=>e.path!==path);}
  d.inputs.digest=hash(JSON.stringify({entries:d.inputs.entries,runtime:d.inputs.runtime}));
  for(const p of f.records.filter(r=>r.type==='phase_complete'&&r.step==='design-architecture'&&r.iteration===7))p.content=p.content.replace(oldDigest,d.inputs.digest);
  put(file(f,f.designInventory),inventory);f.append({type:'boundary'});
 };
 await t.test('every design occurrence preserves phase routing and binds without authority',()=>{
  const q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.equal(r.bindings.length,2);assert.deepEqual(r.bindings.map(b=>b.routing.model),['gpt-6.1-sol','gpt-6-astra']);assert.ok(r.bindings.every(b=>b.identitySourceCount===16&&b.phases.length===2&&b.package.source.startIndex===b.startIndex));assert.equal(r.designManifestDistributionBindingsComplete,true);assert.equal(r.initializationAuthority,false);assert.equal(r.completeMigrationHistory,false);assert.equal(r.automaticGateOriginProven,false);assert.deepEqual(r.currentApprovals,[]);
 });
 await t.test('old design lock metadata is read from its own snapshot',()=>{
  reset();historicalEdit('package-lock.json',p=>p.historicalDesign='distinct from current lock');const q=inspect();assert.equal(q.status,0,q.stderr);assert.notEqual(JSON.parse(q.stdout).bindings[0].lock.sha256,hash(fs.readFileSync(file(f,'package-lock.json'))));
 });
 for(const kind of ['pin','version','integrity','missing-package','missing-lock'])await t.test('phase-bound design rejects '+kind,()=>{
  reset();if(kind==='pin')historicalEdit('package.json',p=>p.devDependencies.takt='unrelated');
  if(kind==='version')historicalEdit('package-lock.json',p=>p.packages['node_modules/takt'].version='unrelated');
  if(kind==='integrity')historicalEdit('package-lock.json',p=>p.packages['node_modules/takt'].integrity='sha512-'+Buffer.alloc(64).toString('base64'));
  if(kind==='missing-package')historicalEdit('package.json');if(kind==='missing-lock')historicalEdit('package-lock.json');
  const generic=designHistoryRead(f);assert.equal(generic.status,0,generic.stderr);fail(inspect(),/design manifest|design runtime input missing/);
 });
 await t.test('missing old design lock never falls back to current lock',()=>{
  reset();const d=read(file(f,f.designInventory)).entries[0];fs.unlinkSync(file(f,d.snapshots.find(e=>e.path==='package-lock.json').copy));assert.ok(fs.existsSync(file(f,'package-lock.json')));fail(inspect(),/ENOENT/);
 });
 await t.test('inventory cannot omit an actual design occurrence',()=>{
  reset();mutate(f,f.designInventory,x=>x.entries.shift());fail(inspect(),/complete design occurrence inventory/);
 });
});

// Hash-consistent manifests must still match the canonical path representation
// emitted by inputs(): aliases cannot create a second identity for one source.
test('canonical builder and design historical manifests',async t=>{
 for(const origin of ['builder','design']){
  const f=origin==='builder'?await inputHistoryFixture(t):await designHistoryFixture(t),reset=restorePoint(f),inspect=()=>origin==='builder'?inputHistoryRead(f):designHistoryRead(f);
  await t.test(origin+' canonical snapshot remains readable without authority',()=>{const q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.equal(r.initializationAuthority,false);assert.equal(r.completeMigrationHistory,false);assert.deepEqual(r.currentApprovals,[]);});
  for(const kind of ['alias','duplicate-alias','order'])await t.test(origin+' rejects hash-consistent '+kind,()=>{
   reset();const edit=h=>{
    const previous=h.inputs.digest;
    if(kind==='order'){h.inputs.entries.reverse();h.snapshots.reverse();}
    else{
     const entry=h.inputs.entries.find(e=>e.path==='package.json'),snapshot=h.snapshots.find(e=>e.path==='package.json');
     if(kind==='alias'){entry.path='./package.json';snapshot.path=entry.path;}
     else{const e={...entry,path:'./package.json'},s={...snapshot,...e,copy:snapshot.copy+'.alias'};put(file(f,s.copy),fs.readFileSync(file(f,snapshot.copy)).toString());h.inputs.entries.push(e);h.snapshots.push(s);if(h.references)h.references.push({path:s.copy,sha256:s.sha256,bytes:s.bytes});}
    }
    h.inputs.digest=hash(JSON.stringify({entries:h.inputs.entries,runtime:h.inputs.runtime}));return previous;
   };
   if(origin==='builder')rebindHistory(f,edit);
   else{const inv=read(file(f,f.designInventory)),d=inv.entries[0],old=edit(d);for(const p of f.records.filter(r=>r.type==='phase_complete'&&r.step==='design-architecture'&&r.iteration===7))p.content=p.content.replace(old,d.inputs.digest);put(file(f,f.designInventory),inv);f.append({type:'boundary'});}
   fail(inspect(),/historical input noncanonical path|historical input order/);
  });
 }
});

// An unindexed receipt cannot exempt itself from history by claiming an old,
// missing, or invalid timestamp. The authenticated index owns membership.
test('runtime source unindexed receipt timestamps cannot hide history',async t=>{
 const f=await preparationFixture(t),reset=restorePoint(f);
 await t.test('indexed reviewed prefix and failed tail remain readable',()=>{const q=preparationRead(f);assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.equal(r.initializationAuthority,false);assert.deepEqual(r.currentApprovals,[]);assert.deepEqual(r.failures.map(x=>x.kind),['GATE_VALIDATION_FAILURE','SUBPROCESS_FAILURE']);});
 for(const kind of ['past','missing','invalid','null','running-past'])await t.test('reject unindexed '+kind,()=>{
  reset();const r=read(file(f,f.preparation.failedReceipts[0].path));r.id='unindexed-fixture';
  if(kind==='missing')delete r.startedAt;
  else r.startedAt=kind==='invalid'?'not-a-timestamp':kind==='null'?null:'2000-01-01T00:00:00.000Z';
  if(kind==='running-past'){r.status='running';delete r.finishedAt;}
  put(file(f,'evidence/enterprise/runs/'+r.id+'/receipt.json'),r);
  fail(preparationRead(f),/unindexed source receipt/);
 });
});

test('runtime indexed historical receipt membership',async t=>{
 const f=await preparationFixture(t),idx=read(ip(f)),selected=read(file(f,read(pp(f)).entrySelection)).predecessors.map(x=>x.runId),entry=idx.runs.find(e=>!selected.includes(e.id)&&!f.preparation.failedReceipts.some(r=>r.path===e.path));assert.ok(entry,'fixture needs an older unselected receipt');const reset=restorePoint(f);
 await t.test('all indexed receipts exist without granting current approval',()=>{const q=preparationRead(f);assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.equal(r.initializationAuthority,false);assert.deepEqual(r.currentApprovals,[]);});
 for(const kind of ['missing','id','batch','running','path'])await t.test('indexed historical receipt rejects '+kind,()=>{
  reset();if(kind==='missing')fs.rmSync(file(f,entry.path));
  else if(kind==='path'){
   mutate(f,'evidence/enterprise/runs/index.json',x=>x.runs.find(e=>e.id===entry.id).path='evidence/enterprise/runs/'+entry.id+'/./receipt.json');
   const a=structuredClone(f.preparation);a.sourceIndex.sha256=hash(fs.readFileSync(ip(f)));const raw=fenced('enterprise-failed-interval-design-attestation',a);
   for(const r of f.records.filter(r=>r.step==='review-architecture'&&r.type==='phase_complete'))r.content=raw;f.append({type:'boundary'});put(join(f.run.reportsAbs,'enterprise-02-review.md'),raw+'\n');
  }else mutate(f,entry.path,r=>{if(kind==='id')r.id='another-id';if(kind==='batch')r.batchId='B99';if(kind==='running'){r.status='running';delete r.finishedAt;}});
  fail(preparationRead(f),/indexed historical receipt/);
 });
});

// R1a recovery locators never choose the expected bytes or grant acceptance.
test('R1a authenticated consumer recovery reader',async t=>{
 const f=await inputHistoryFixture(t);
 const modulePath=new URL('../../scripts/enterprise/runtime-history.mjs',import.meta.url);
 if(fs.existsSync(modulePath))fs.copyFileSync(modulePath,file(f,'scripts/enterprise/runtime-history.mjs'));
 const logical='evidence/enterprise/lost-raw.json',copy='evidence/enterprise/recovery/original.json',raw='{"original":true}\n',reference={path:logical,sha256:hash(raw),bytes:Buffer.byteLength(raw)};
 rebindHistory(f,h=>h.historyPreservation={historicalDifferences:[reference]});
 const consumer=()=>({handoff:f.historyPath,handoffSha256:hash(fs.readFileSync(file(f,f.historyPath))),pointer:'/historyPreservation/historicalDifferences/0'});
 const inventoryPath='evidence/enterprise/recovery/inventory.json';
 const inventory=()=>({schemaVersion:1,kind:'UNTRUSTED_HISTORY_RECOVERY_LOCATORS',sourceRunSlug:f.run.slug,locators:[{consumer:consumer(),path:copy}]});
 put(file(f,copy),raw);put(file(f,inventoryPath),inventory());const reset=restorePoint(f);
 const inspect=()=>{const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-history.mjs'),'--inspect-references',inventoryPath],{cwd:f.root,env:f.env,encoding:'utf8',timeout:30000});assert.deepEqual(tree(f.temporary),before);return q;};
 const result=()=>{const q=inspect();assert.equal(q.status,0,q.stderr);return JSON.parse(q.stdout);};
 await t.test('R1-03 raw backup resolves authenticated consumer without authority',()=>{const r=result();assert.equal(r.kind,'READ_ONLY_HISTORY_ASSESSMENT');assert.equal(r.components.references.complete,true);const p=r.components.references.proofs.find(p=>p.path===logical);assert.equal(p.source.path,copy);assert.equal(p.sha256,reference.sha256);assert.deepEqual(p.consumer, {...consumer(),iteration:7});assert.equal(r.initializationAuthority,false);assert.deepEqual(r.currentApprovals,[]);assert.equal(r.completeMigrationHistory,false);assert.equal(r.components.runtimeDependencies.status,'NOT_IMPLEMENTED');assert.equal(r.components.executionOrigin.status,'UNPROVEN_EXECUTION_ORIGIN');});
 await t.test('R1-03 reformatted JSON is not the old preimage',()=>{reset();put(file(f,copy),'{ "original": true }\n');const r=result();assert.equal(r.components.references.complete,false);assert.equal(r.components.references.missing.length,1);assert.equal(r.components.references.missing[0].sha256,reference.sha256);assert.equal(r.components.references.missing[0].searched[0].path,copy);});
 await t.test('R1-03 missing backup retains exact searched locator',()=>{reset();fs.rmSync(file(f,copy));const r=result();assert.equal(r.components.references.missing[0].searched[0].missing,true);});
 for(const kind of ['expected-hash','consumer-hash','consumer-pointer','source-run','escape','alias','symlink','dangling-symlink','directory'])await t.test('R1-03 rejects recovery '+kind,()=>{
  reset();
  if(kind==='symlink'||kind==='dangling-symlink'){fs.rmSync(file(f,copy));fs.symlinkSync(file(f,kind==='symlink'?inventoryPath:'evidence/nonexistent'),file(f,copy));}
  else if(kind==='directory'){fs.rmSync(file(f,copy));fs.mkdirSync(file(f,copy));}
  else mutate(f,inventoryPath,i=>{const l=i.locators[0];if(kind==='expected-hash')l.sha256=hash('replacement');if(kind==='consumer-hash')l.consumer.handoffSha256='0'.repeat(64);if(kind==='consumer-pointer')l.consumer.pointer='/not-authenticated';if(kind==='source-run')i.sourceRunSlug='other';if(kind==='escape')l.path='../escape';if(kind==='alias')l.path=copy.replace('/original','/./original');});
  try{fail(inspect(),/recovery (locator|consumer|source|path)|symlink|regular file/);}
  finally{if(['symlink','dangling-symlink','directory'].includes(kind)){fs.rmSync(file(f,copy),{recursive:true,force:true});put(file(f,copy),raw);}}
 });
 await t.test('R1-02 exact two missing identities preserve 28 consumers',()=>{
  reset();const identities=[{path:'evidence/enterprise/architecture-observation-iteration13.json',sha256:'c6937ad9fff017ffaf72b839e4db65f1bab673443c63f4c1d4b3e9d9b09d08df'},{path:'evidence/enterprise/design-iteration13/checks.json',sha256:'3a2141210d08be5b88d0bf4bdf0ea2db1534c0f6e023c191e2faeddeda86f352'}];
  rebindHistory(f,h=>h.historyPreservation={historicalDifferences:Array.from({length:14},()=>identities).flat()});put(file(f,inventoryPath),{...inventory(),locators:[]});
  const r=result(),missing=r.components.references.missing;assert.equal(missing.length,28);assert.equal(new Set(missing.map(x=>x.sha256)).size,2);assert.equal(new Set(missing.map(x=>x.consumer.pointer)).size,28);assert.ok(missing.every(x=>x.searched.length===0));assert.equal(r.completeMigrationHistory,false);
 });
 await t.test('R1-03 unattested handoff cannot supply a caller chosen hash',()=>{reset();fs.appendFileSync(file(f,f.historyPath),' ');fail(inspect(),/hash missing from phase/);});
 await t.test('R1-03 recovered assessment cannot select or initialize',()=>{reset();result();unchanged(f,['batch','--initialize-run'],/already initialized/);unchanged(f,['batch','--recover-rejected'],/single enterprise-recovery-design-attestation required/);});
 await t.test('R1-03 duplicate locator is rejected',()=>{reset();mutate(f,inventoryPath,i=>i.locators.push(i.locators[0]));fail(inspect(),/recovery locator duplicate/);});
 await t.test('R1-03 expected byte length remains anchored in consumer',()=>{reset();rebindHistory(f,h=>h.historyPreservation.historicalDifferences[0].bytes++);put(file(f,inventoryPath),inventory());assert.equal(result().components.references.complete,false);});
 await t.test('R1-03 bytes changing during recovery are refused',async()=>{
  reset();const hook=join(f.temporary,'recovery-race.mjs');
  put(hook,"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const read=fs.readFileSync;let once=false;fs.readFileSync=function(path,...args){const raw=read.call(this,path,...args);if(!once&&String(path).endsWith('/recovery/original.json')){once=true;process.stdout.write('RECOVERY_RACE_READY\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,700);}return raw;};syncBuiltinESMExports();");
  const before=tree(f.temporary),{spawn}=await import('node:child_process');
  const child=spawn(process.execPath,['--import',f.guardPath,'--import',hook,file(f,'scripts/enterprise/runtime-history.mjs'),'--inspect-references',inventoryPath],{cwd:f.root,env:f.env,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',changed=false;const timer=setTimeout(()=>child.kill('SIGKILL'),30000);
  child.stdout.on('data',data=>{stdout+=data;if(!changed&&stdout.includes('RECOVERY_RACE_READY')){changed=true;fs.appendFileSync(file(f,copy),'changed by concurrent test writer');}});child.stderr.on('data',data=>stderr+=data);
  const status=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);}).finally(()=>clearTimeout(timer));
  assert.ok(changed);fail({status,stderr},/concurrent recovery bytes/);
  const omitCopy=entries=>entries.filter(e=>e.path!=='/product/'+copy);assert.deepEqual(omitCopy(tree(f.temporary)),omitCopy(before));
 });
});

// R1a lock graph is a prerequisite inventory, never dependency integrity/H.
test('R1a historical dependency graph assessment',async t=>{
 const load=async()=>await import('../../scripts/enterprise/runtime-dependency-graph.mjs');
 const fixtureLock=()=>({lockfileVersion:3,packages:{'':{name:'synthetic'},
  'node_modules/takt':{version:'0.71.0',dependencies:{a:'^1',shared:'^2','@scope/tool':'1'},optionalDependencies:{native:'1'},peerDependencies:{host:'^1'}},
  'node_modules/a':{version:'1.0.0',dependencies:{shared:'^1'},peerDependencies:{host:'^1'}},
  'node_modules/a/node_modules/shared':{version:'1.0.0',dependencies:{a:'^1'}},
  'node_modules/shared':{version:'2.0.0'},'node_modules/@scope/tool':{version:'1.0.0',dependencies:{shared:'^2'}},
  'node_modules/host':{version:'1.0.0'},'node_modules/native':{version:'1.0.0',os:['linux'],cpu:['x64'],optional:true}
 }});
 await t.test('R1-01 graph preserves nested hoisted scoped peer optional and cyclic edges without authority',async()=>{
  const {assessDependencyGraph}=await load(),lock=fixtureLock(),before=JSON.stringify(lock),r=assessDependencyGraph(lock);
  assert.equal(JSON.stringify(lock),before);assert.equal(r.packages.length,7);
  assert.equal(r.edges.find(e=>e.from==='node_modules/a'&&e.name==='shared').to,'node_modules/a/node_modules/shared');
  assert.equal(r.edges.find(e=>e.from==='node_modules/@scope/tool').to,'node_modules/shared');
  assert.equal(r.edges.find(e=>e.from==='node_modules/a'&&e.kind==='peer').to,'node_modules/host');
  assert.equal(r.packages.find(p=>p.path==='node_modules/native').platform.os[0],'linux');
  assert.equal(r.platformSelectionProven,false);assert.equal(r.dependencyClosureIntegrityProven,false);assert.equal(r.initializationAuthority,false);assert.deepEqual(r.currentApprovals,[]);
 });
 await t.test('R1-05 absent optional and optional peer remain unresolved obligations',async()=>{
  const {assessDependencyGraph}=await load(),lock=fixtureLock();delete lock.packages['node_modules/native'];lock.packages['node_modules/takt'].peerDependencies.absent='*';lock.packages['node_modules/takt'].peerDependenciesMeta={absent:{optional:true}};
  const r=assessDependencyGraph(lock);assert.equal(r.unresolved.length,2);assert.deepEqual(r.unresolved.map(e=>e.name).sort(),['absent','native']);assert.ok(r.unresolved.every(e=>e.searched.length>0));assert.equal(r.dependencyClosureIntegrityProven,false);
 });
 for(const kind of ['schema','link','missing-required','missing-peer','alias-path','invalid-name','invalid-map','invalid-range','invalid-platform','invalid-peer-meta','bundled-format'])await t.test('R1-05 dependency graph rejects '+kind,async()=>{
  const {assessDependencyGraph}=await load(),lock=fixtureLock(),p=lock.packages['node_modules/takt'];
  if(kind==='schema')lock.lockfileVersion=1;
  if(kind==='link')lock.packages['node_modules/a'].link=true;
  if(kind==='missing-required')delete lock.packages['node_modules/a'];
  if(kind==='missing-peer')delete lock.packages['node_modules/host'];
  if(kind==='alias-path')lock.packages['node_modules/./a']=lock.packages['node_modules/a'];
  if(kind==='invalid-name')p.dependencies['../outside']='1';
  if(kind==='invalid-map')p.dependencies=[];
  if(kind==='invalid-range')p.dependencies.a=null;
  if(kind==='invalid-platform')lock.packages['node_modules/native'].os='linux';
  if(kind==='invalid-peer-meta')p.peerDependenciesMeta={ghost:{optional:true}};
  if(kind==='bundled-format')p.bundleDependencies=true;
  assert.throws(()=>assessDependencyGraph(lock),/dependency graph.*(lock|node_modules)/);
 });
 await t.test('R1-05 peers cannot resolve from their own nested node_modules',async()=>{
  const {assessDependencyGraph}=await load(),lock=fixtureLock();delete lock.packages['node_modules/host'];lock.packages['node_modules/a/node_modules/host']={version:'1.0.0'};assert.throws(()=>assessDependencyGraph(lock),/unresolved.*host/);
 });
 await t.test('R1-05 optional override retains declaration without double counting regular edge',async()=>{
  const {assessDependencyGraph}=await load(),lock=fixtureLock();lock.packages['node_modules/takt'].dependencies.native='0';const r=assessDependencyGraph(lock);assert.equal(r.edges.filter(e=>e.from==='node_modules/takt'&&e.name==='native').length,1);assert.equal(r.edges.find(e=>e.name==='native').spec,'1');
 });
});

test('R1a dependency graph source CLI binding',async t=>{
 const f=await inputHistoryFixture(t,{runtimePackages:true});
 for(const p of ['runtime-history.mjs','runtime-dependency-graph.mjs'])fs.copyFileSync(new URL('../../scripts/enterprise/'+p,import.meta.url),file(f,'scripts/enterprise/'+p));
 const reset=restorePoint(f);
 const inspect=(args=['--inspect-dependency-graphs'])=>{const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-history.mjs'),...args],{cwd:f.root,env:f.env,encoding:'utf8',timeout:30000});assert.deepEqual(tree(f.temporary),before);return q;};
 await t.test('R1-01 each original lock is bound to its manifest in readonly assessment',()=>{const q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.equal(r.bindings.length,2);assert.equal(r.graphs.length,1);assert.ok(r.bindings.every(b=>b.lock.source.path.startsWith('evidence/enterprise/')));assert.equal(r.graphs[0].assessment.packages[0].path,'node_modules/takt');assert.equal(r.dependencyClosureIntegrityProven,false);assert.equal(r.initializationAuthority,false);assert.deepEqual(r.currentApprovals,[]);});
 await t.test('R1-05 altered original lock copy refuses before writes',()=>{reset();const h=read(file(f,f.historyPath)),s=h.snapshots.find(s=>s.path==='package-lock.json');fs.appendFileSync(file(f,s.copy),' ');fail(inspect(),/changed history/);});
 await t.test('R1-05 current source cannot impersonate target reader',()=>{reset();f.context('design-architecture',9);fail(inspect());});
 await t.test('R1-05 CLI cannot accept complete or runtime override flags',()=>{reset();fail(inspect(['--inspect-dependency-graphs','--complete']),/accepts only/);});
});

// Read archived package JSON only after authenticating each historical lock's
// distribution. This is metadata evidence, not installed dependency integrity.
test('R1a archived package metadata binding',async t=>{
 const setup=async(t,change=()=>{})=>{
  const raw=runtimeArchive(entries=>{entries.push({path:'package/node_modules/debug/package.json',raw:Buffer.from(JSON.stringify({name:'debug',version:'4.4.3',dependencies:{ms:'^2.1.3'},peerDependenciesMeta:{'supports-color':{optional:true}}}))});change(entries);});
  const f=await inputHistoryFixture(t,{runtimePackages:true,runtimeDistribution:raw}),runtime=read(file(f,'evidence/probe.json')).oldRuntime,dir='evidence/enterprise/metadata/';
  const inv={schemaVersion:1,kind:'UNTRUSTED_RUNTIME_BYTE_INVENTORY',run:f.run.slug,designReportSha256:hash(fs.readFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'))),sources:[],project:{},distribution:{copy:dir+'source.tgz'}};
  for(const [n,s] of runtime.sources.entries()){const copy=dir+'source-'+n;put(file(f,copy),fs.readFileSync(file(f,'node_modules/takt/'+(s.path==='package.json'?s.path:'dist/'+s.path))).toString());inv.sources.push({path:s.path,copy});}
  for(const name of ['package.json','package-lock.json']){const copy=dir+'project-'+name;put(file(f,copy),fs.readFileSync(file(f,name)).toString());inv.project[name]=copy;}
  fs.writeFileSync(file(f,inv.distribution.copy),raw);const inventoryPath=dir+'inventory.json';put(file(f,inventoryPath),inv);
  const inspect=()=>{const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-preparation.mjs'),'--package-metadata',inventoryPath],{cwd:f.root,env:f.env,encoding:'utf8',timeout:30000});assert.deepEqual(tree(f.temporary),before);return q;};return {f,inspect,inv};
 };
 await t.test('R1-01 archived metadata binds original locks and preserves unresolved locations without authority',async t=>{
  const {inspect}=await setup(t),q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.equal(r.bindings.length,2);assert.equal(r.packages.length,2);assert.equal(r.packages.find(p=>p.metadata.name==='debug').metadata.peerDependenciesMeta['supports-color'].optional,true);assert.equal(r.unresolved.length,2);assert.ok(r.unresolved.every(p=>p.reason==='LOCK_PACKAGE_LOCATION_UNAVAILABLE'));assert.equal(r.dependencyClosureIntegrityProven,false);assert.equal(r.initializationAuthority,false);assert.deepEqual(r.currentApprovals,[]);
 });
 for(const kind of ['invalid-json','invalid-utf8','array','wrong-name','missing-version','oversize','duplicate','link'])await t.test('R1-05 authenticated package archive rejects '+kind,async t=>{
  const {inspect}=await setup(t,entries=>{const e=entries.at(-1);
   if(kind==='invalid-json')e.raw=Buffer.from('{');if(kind==='invalid-utf8')e.raw=Buffer.from([0xff]);if(kind==='array')e.raw=Buffer.from('[]');if(kind==='wrong-name')e.raw=Buffer.from('{"name":"other","version":"4.4.3"}');if(kind==='missing-version')e.raw=Buffer.from('{"name":"debug"}');if(kind==='oversize')e.raw=Buffer.alloc(1024*1024+1,32);if(kind==='duplicate')entries.push({...e});if(kind==='link'){e.type='SymbolicLink';e.linkpath='../../outside';e.raw=Buffer.alloc(0);}
  });fail(inspect(),/package metadata|runtime distribution|JSON|encoded data/);
 });
 await t.test('R1-05 archived metadata refuses changed raw artifact before parsing',async t=>{const {f,inspect,inv}=await setup(t);fs.appendFileSync(file(f,inv.distribution.copy),'changed');fail(inspect(),/integrity mismatch/);});
 await t.test('R1-05 package version is checked against each original lock',async t=>{
  const {f,inspect}=await setup(t);rebindHistory(f,h=>{const s=h.snapshots.find(s=>s.path==='package-lock.json'),value=read(file(f,s.copy));value.packages['node_modules/takt/node_modules/debug']={version:'0.0.1',inBundle:true};put(file(f,s.copy),value);const raw=fs.readFileSync(file(f,s.copy));for(const e of [s,h.inputs.entries.find(e=>e.path===s.path),h.references.find(e=>e.path===s.copy)]){e.sha256=hash(raw);e.bytes=raw.length;}h.inputs.digest=hash(JSON.stringify({entries:h.inputs.entries,runtime:h.inputs.runtime}));});fail(inspect(),/package metadata version mismatch.*debug/);
 });
});

// Declaration equality is a prerequisite, never semver satisfaction or origin.
test('R1a archived dependency declaration consistency',async t=>{
 const load=async()=>{const m=await import('../../scripts/enterprise/runtime-preparation.mjs');assert.equal(typeof m.assessPackageDependencyDeclarations,'function');return m.assessPackageDependencyDeclarations;};
 const pkg=()=>({dependencies:{a:'^1',b:'npm:other@2'},optionalDependencies:{native:'~3'},peerDependencies:{host:'>=4'},peerDependenciesMeta:{host:{optional:true}}});
 await t.test('R1-01 dependency declarations match independently of map order without mutation or authority',async()=>{const assess=await load(),a=pkg(),b=pkg();b.dependencies={b:'npm:other@2',a:'^1'};const before=JSON.stringify([a,b]),r=assess(a,b,'node_modules/takt');assert.equal(JSON.stringify([a,b]),before);assert.equal(r.declarations.dependencies.a,'^1');assert.equal(r.declarations.dependencies.b,'npm:other@2');assert.equal(r.unresolved.length,0);assert.equal(r.versionConstraintsProven,false);assert.equal(r.dependencyClosureIntegrityProven,false);assert.equal(r.initializationAuthority,false);assert.deepEqual(r.currentApprovals,[]);});
 await t.test('R1-05 matching nondeclaring peer metadata remains an unresolved obligation without invented edge',async()=>{const assess=await load(),a=pkg();a.peerDependenciesMeta.ghost={optional:true};const r=assess(a,structuredClone(a),'node_modules/takt');assert.equal(r.unresolved[0].reason,'PEER_DECLARATION_UNAVAILABLE');assert.equal(r.unresolved[0].name,'ghost');assert.equal(r.declarations.peerDependencies.ghost,undefined);});
 for(const kind of ['dependency-range','missing-dependency','optional-kind','peer-range','peer-option','invalid-map','invalid-name','invalid-spec','invalid-peer-meta'])await t.test('R1-05 archived dependency declarations reject '+kind,async()=>{const assess=await load(),a=pkg(),b=pkg();
  if(kind==='dependency-range')b.dependencies.a='^2';if(kind==='missing-dependency')delete b.dependencies.a;if(kind==='optional-kind'){b.dependencies.native=b.optionalDependencies.native;delete b.optionalDependencies.native;}if(kind==='peer-range')b.peerDependencies.host='>=5';if(kind==='peer-option')b.peerDependenciesMeta.host.optional=false;
  if(kind==='invalid-map')a.dependencies=b.dependencies=[];if(kind==='invalid-name')a.dependencies['../escape']=b.dependencies['../escape']='1';if(kind==='invalid-spec')a.dependencies.a=b.dependencies.a=null;if(kind==='invalid-peer-meta')a.peerDependenciesMeta.host=b.peerDependenciesMeta.host={optional:'yes'};
  assert.throws(()=>assess(a,b,'node_modules/takt'),/dependency declarations.*node_modules\/takt/);
 });
});
test('R1a archived dependency declarations source CLI',async t=>{
 const raw=runtimeArchive(),actual=JSON.parse(fs.readFileSync(new URL('../../node_modules/takt/package.json',import.meta.url))),fields=['dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta'],decl=Object.fromEntries(fields.filter(k=>actual[k]!==undefined).map(k=>[k,actual[k]]));
 const f=await inputHistoryFixture(t,{runtimePackages:true,runtimeDistribution:raw,runtimeLockDeclarations:decl}),runtime=read(file(f,'evidence/probe.json')).oldRuntime,dir='evidence/enterprise/declarations/';
 const inv={schemaVersion:1,kind:'UNTRUSTED_RUNTIME_BYTE_INVENTORY',run:f.run.slug,designReportSha256:hash(fs.readFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'))),sources:[],project:{},distribution:{copy:dir+'source.tgz'}};
 for(const [n,s]of runtime.sources.entries()){const copy=dir+'source-'+n;put(file(f,copy),fs.readFileSync(file(f,'node_modules/takt/'+(s.path==='package.json'?s.path:'dist/'+s.path))).toString());inv.sources.push({path:s.path,copy});}
 for(const name of ['package.json','package-lock.json']){const copy=dir+'project-'+name;put(file(f,copy),fs.readFileSync(file(f,name)).toString());inv.project[name]=copy;}
 fs.writeFileSync(file(f,inv.distribution.copy),raw);const inventoryPath=dir+'inventory.json';put(file(f,inventoryPath),inv);const reset=restorePoint(f);
 const inspect=()=>{const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-preparation.mjs'),'--dependency-declarations',inventoryPath],{cwd:f.root,env:f.env,encoding:'utf8',timeout:30000});assert.deepEqual(tree(f.temporary),before);return q;};
 await t.test('R1-01 authenticated archive declarations bind every original manifest lock readonly',()=>{const q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.equal(r.bindings.length,2);assert.ok(r.bindings.every(b=>b.declarations.length===1));assert.equal(r.bindings[0].declarations[0].assessment.declarations.dependencies[Object.keys(actual.dependencies)[0]],Object.values(actual.dependencies)[0]);assert.equal(r.dependencyClosureIntegrityProven,false);assert.equal(r.initializationAuthority,false);assert.deepEqual(r.currentApprovals,[]);});
 await t.test('R1-05 authenticated historical lock range disagreement rejects before writes',()=>{reset();rebindHistory(f,h=>{const s=h.snapshots.find(s=>s.path==='package-lock.json'),l=read(file(f,s.copy));l.packages['node_modules/takt'].dependencies[Object.keys(actual.dependencies)[0]]='999.0.0';put(file(f,s.copy),l);const raw=fs.readFileSync(file(f,s.copy));for(const e of [s,h.inputs.entries.find(e=>e.path===s.path),h.references.find(e=>e.path===s.copy)]){e.sha256=hash(raw);e.bytes=raw.length;}h.inputs.digest=hash(JSON.stringify({entries:h.inputs.entries,runtime:h.inputs.runtime}));});fail(inspect(),/dependency declarations.*dependencies.*mismatch/);});
 await t.test('R1-05 declaration CLI rejects changed artifact before interpreting declarations',()=>{reset();fs.appendFileSync(file(f,inv.distribution.copy),'changed');fail(inspect(),/integrity mismatch/);});
});

// Design occurrences have their own phase-authenticated locks. Builder or
// receipt metadata success cannot substitute for these independent bindings.
test('R1a archived design dependency declarations',async t=>{
 const archive=runtimeArchive(entries=>entries.push({path:'package/node_modules/ghost/package.json',raw:Buffer.from('{"name":"ghost","version":"1.0.0"}')}));
 const actual=JSON.parse(fs.readFileSync(new URL('../../node_modules/takt/package.json',import.meta.url))),fields=['dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta'],decl=Object.fromEntries(fields.filter(k=>actual[k]!==undefined).map(k=>[k,actual[k]]));
 const f=await designHistoryFixture(t,await preparationFixture(t,{designHistory:true,runtimePackages:true,runtimeDistribution:archive,runtimeLockDeclarations:decl})),runtime=read(file(f,'evidence/probe.json')).oldRuntime,dir='evidence/enterprise/design-metadata/';
 const inv={schemaVersion:1,kind:'UNTRUSTED_RUNTIME_BYTE_INVENTORY',run:f.run.slug,designReportSha256:hash(fs.readFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'))),sources:[],project:{},distribution:{copy:dir+'source.tgz'}};
 for(const [n,s] of runtime.sources.entries()){const copy=dir+'source-'+n;put(file(f,copy),fs.readFileSync(file(f,'node_modules/takt/'+(s.path==='package.json'?s.path:'dist/'+s.path))).toString());inv.sources.push({path:s.path,copy});}
 for(const name of ['package.json','package-lock.json']){const copy=dir+'project-'+name;put(file(f,copy),fs.readFileSync(file(f,name)).toString());inv.project[name]=copy;}
 fs.writeFileSync(file(f,inv.distribution.copy),archive);const inventoryPath=dir+'inventory.json';put(file(f,inventoryPath),inv);const reset=restorePoint(f);
 const inspect=(args=['--design-dependency-declarations',f.designInventory,inventoryPath])=>{const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-preparation.mjs'),...args],{cwd:f.root,env:f.env,encoding:'utf8',timeout:30000});assert.deepEqual(tree(f.temporary),before);return q;};
 const editLock=(edit)=>{
  const inventory=read(file(f,f.designInventory)),d=inventory.entries[0],old=d.inputs.digest,s=d.snapshots.find(s=>s.path==='package-lock.json'),value=read(file(f,s.copy));edit(value);put(file(f,s.copy),value);const raw=fs.readFileSync(file(f,s.copy));for(const e of [s,d.inputs.entries.find(e=>e.path===s.path)]){e.sha256=hash(raw);e.bytes=raw.length;}d.inputs.digest=hash(JSON.stringify({entries:d.inputs.entries,runtime:d.inputs.runtime}));
  for(const p of f.records.filter(r=>r.type==='phase_complete'&&r.step==='design-architecture'&&r.iteration===7))p.content=p.content.replace(old,d.inputs.digest);put(file(f,f.designInventory),inventory);f.append({type:'boundary'});
 };
 await t.test('R1-01 every design occurrence binds archived declarations and preserves routing and missing locations',()=>{
  const q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.equal(r.component,'ARCHIVED_DESIGN_DEPENDENCY_DECLARATIONS');assert.equal(r.bindings.length,2);assert.deepEqual(r.bindings.map(b=>b.routing.model),['gpt-6.1-sol','gpt-6-astra']);assert.ok(r.bindings.every(b=>b.phases.length===2&&b.lock.source.startIndex===b.startIndex&&b.declarations.length===1));assert.equal(r.unresolved.filter(u=>u.reason==='LOCK_PACKAGE_LOCATION_UNAVAILABLE').length,2);assert.equal(r.dependencyClosureIntegrityProven,false);assert.equal(r.versionConstraintsProven,false);assert.equal(r.initializationAuthority,false);assert.deepEqual(r.currentApprovals,[]);
 });
 await t.test('R1-01 design metadata uses a distinct original lock and retains missing location obligations',()=>{
  reset();editLock(l=>{l.packages['node_modules/takt/node_modules/ghost']={version:'1.0.0'};l.designOnly=true;});const q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.equal(r.bindings[0].declarations.length,2);assert.equal(r.bindings[1].declarations.length,1);assert.notEqual(r.bindings[0].lock.sha256,r.bindings[1].lock.sha256);assert.equal(r.unresolved.length,1);
 });
 for(const kind of ['range','version','missing-lock','changed-copy','omit-occurrence','phase-digest','artifact','authority-flag'])await t.test('R1-05 design metadata rejects '+kind+' without writes',()=>{
  reset();
  if(kind==='range')editLock(l=>{l.packages['node_modules/takt'].dependencies[Object.keys(actual.dependencies)[0]]='999.0.0';});
  if(kind==='version')editLock(l=>{l.packages['node_modules/takt/node_modules/ghost']={version:'2.0.0'};});
  if(kind==='missing-lock'||kind==='changed-copy'){const d=read(file(f,f.designInventory)).entries[0],p=file(f,d.snapshots.find(s=>s.path==='package-lock.json').copy);if(kind==='missing-lock')fs.unlinkSync(p);else fs.appendFileSync(p,' ');}
  if(kind==='omit-occurrence')mutate(f,f.designInventory,i=>i.entries.shift());
  if(kind==='phase-digest'){f.records.find(r=>r.type==='phase_complete'&&r.step==='design-architecture'&&r.iteration===7).content='wrong';f.append({type:'boundary'});}
  if(kind==='artifact')fs.appendFileSync(file(f,inv.distribution.copy),'changed');
  const q=kind==='authority-flag'?inspect(['--design-dependency-declarations',f.designInventory,inventoryPath,'--complete']):inspect();
  const errors={range:/dependency declarations.*mismatch/,version:/package metadata version mismatch/, 'missing-lock':/ENOENT/,'changed-copy':/changed design snapshot/,'omit-occurrence':/complete design occurrence inventory/,'phase-digest':/design inputsDigest/ ,artifact:/integrity mismatch/,'authority-flag':/no authority overrides/};fail(q,errors[kind]);
 });
});

// Stable full-version range subset only; unsupported syntax cannot be coerced.
test('R1a stable dependency version constraints',async t=>{
 const load=()=>import('../../scripts/enterprise/runtime-version-constraints.mjs');
 const lock=(spec,version='1.2.3')=>({lockfileVersion:3,packages:{'node_modules/takt':{version:'0.71.0',dependencies:{a:spec}},'node_modules/a':{version}}});
 await t.test('R1-01 stable comparison boundaries AND OR caret and tilde',async()=>{
  const {assessDependencyVersionConstraints:assess}=await load();
  const cases=[['1.2.3','1.2.3',true],['=1.2.3','1.2.4',false],['>1.2.3','1.2.3',false],['>=1.2.3','1.2.3',true],['<1.2.3','1.2.3',false],['<=1.2.3','1.2.3',true],['^1.2.3','1.99.0',true],['^1.2.3','2.0.0',false],['^0.2.3','0.2.99',true],['^0.2.3','0.3.0',false],['^0.0.3','0.0.4',false],['^0.0.0','0.0.0',true],['^0.0.0','0.0.1',false],['~1.2.3','1.2.99',true],['~1.2.3','1.3.0',false],['>=1.2.3 <2.0.0','1.9.0',true],['>=1.2.3 <2.0.0','2.0.0',false],['1.2.3 || >=3.0.0 <4.0.0','3.5.0',true],['1.2.3 || >=3.0.0 <4.0.0','2.0.0',false],['*','0.0.0',true],['>=1.2.9','1.2.10',true]];
  for(const [spec,v,pass] of cases){const x=lock(spec,v),before=JSON.stringify(x);if(pass){const r=assess(x);assert.equal(r.checks[0].version,v);assert.equal(r.resolvedConstraintsSatisfied,true);assert.equal(r.initializationAuthority,false);assert.equal(r.dependencyClosureIntegrityProven,false);assert.deepEqual(r.currentApprovals,[]);}else assert.throws(()=>assess(x),/version constraint.*node_modules\/takt.*a.*unsatisfied/);assert.equal(JSON.stringify(x),before);}
 });
 for(const spec of ['^1','1.2','1.x','npm:a@1.2.3','file:../a','latest','1.2.3-alpha','1.2.3+build','1.0.0 - 2.0.0','01.2.3','>= 1.2.3','1.2.3 ||','* || npm:a@1.2.3'])await t.test('R1-05 unsupported range rejects '+spec,async()=>{const {assessDependencyVersionConstraints:assess}=await load();assert.throws(()=>assess(lock(spec)),/version constraint.*node_modules\/takt.*unsupported/);});
 await t.test('R1-05 unsupported installed version refuses even with wildcard',async()=>{const {assessDependencyVersionConstraints:assess}=await load();for(const v of ['v1.2.3','1.2.3-beta','1.2.3+build','01.2.3','9007199254740992.0.0'])assert.throws(()=>assess(lock('*',v)),/version constraint.*node_modules\/a.*unsupported/);});
 await t.test('R1-01 actual nested target peer and optional versions are checked',async()=>{const {assessDependencyVersionConstraints:assess}=await load(),x=lock('^1.2.3');x.packages['node_modules/a'].dependencies={b:'~2.3.4'};x.packages['node_modules/a/node_modules/b']={version:'2.3.9'};x.packages['node_modules/b']={version:'9.0.0'};x.packages['node_modules/a'].peerDependencies={b:'^9.0.0'};x.packages['node_modules/takt'].optionalDependencies={opt:'1.0.0'};x.packages['node_modules/opt']={version:'1.0.0'};const r=assess(x);assert.equal(r.checks.length,4);assert.equal(r.checks.find(e=>e.from==='node_modules/a'&&e.kind==='dependency').version,'2.3.9');assert.equal(r.checks.find(e=>e.kind==='peer').version,'9.0.0');x.packages['node_modules/opt'].version='2.0.0';assert.throws(()=>assess(x),/opt.*unsatisfied/);});
 await t.test('R1-05 absent optional remains unresolved and its range still validated',async()=>{const {assessDependencyVersionConstraints:assess}=await load(),x=lock('^1.2.3');x.packages['node_modules/takt'].optionalDependencies={missing:'~2.0.0'};const r=assess(x);assert.equal(r.unresolved.length,1);assert.equal(r.versionConstraintsProven,false);assert.equal(r.platformSelectionProven,false);x.packages['node_modules/takt'].optionalDependencies.missing='npm:x@1.0.0';assert.throws(()=>assess(x),/missing.*unsupported/);});
 await t.test('R1-05 orphan peer metadata keeps strict graph refusal',async()=>{const {assessDependencyVersionConstraints:assess}=await load(),x=lock('^1.2.3');x.packages['node_modules/a'].peerDependenciesMeta={ghost:{optional:true}};assert.throws(()=>assess(x),/unsupported peer metadata/);});
});

test('R1a version constraint source CLI binding',async t=>{
 const f=await inputHistoryFixture(t,{runtimePackages:true});
 for(const p of ['runtime-history.mjs','runtime-dependency-graph.mjs','runtime-version-constraints.mjs']){const source=new URL('../../scripts/enterprise/'+p,import.meta.url);if(fs.existsSync(source))fs.copyFileSync(source,file(f,'scripts/enterprise/'+p));}
 const reset=restorePoint(f),inspect=(args=['--inspect-version-constraints'])=>{const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-history.mjs'),...args],{cwd:f.root,env:f.env,encoding:'utf8',timeout:30000});assert.deepEqual(tree(f.temporary),before);return q;};
 await t.test('R1-01 each historical lock retains authenticated manifest binding',()=>{const q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.equal(r.bindings.length,2);assert.equal(r.versionAssessments.length,1);assert.ok(r.bindings.every(b=>b.versionAssessmentSha256===hash(JSON.stringify(r.versionAssessments[0].assessment))));assert.equal(r.initializationAuthority,false);assert.deepEqual(r.currentApprovals,[]);assert.equal(r.dependencyClosureIntegrityProven,false);});
 await t.test('R1-05 changed old lock refuses instead of using current lock',()=>{reset();const h=read(file(f,f.historyPath)),s=h.snapshots.find(s=>s.path==='package-lock.json');fs.appendFileSync(file(f,s.copy),' ');fail(inspect(),/changed history/);});
 await t.test('R1-05 version CLI cannot grant complete authority',()=>{reset();fail(inspect(['--inspect-version-constraints','--complete']),/accepts only/);});
 await t.test('R1-05 version CLI requires actual source builder context',()=>{reset();f.context('design-architecture',9);fail(inspect());});
});


// Join actual graph edges to authenticated archive metadata and each old lock.
test('R1a archived graph constraints source CLI',async t=>{
 const setup=async(t,kind='valid')=>{
  const actual=JSON.parse(fs.readFileSync(new URL('../../node_modules/takt/package.json',import.meta.url))),fields=['dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta'],decl=Object.fromEntries(fields.filter(k=>actual[k]!==undefined).map(k=>[k,actual[k]]));
  const prefix='node_modules/takt/',first=Object.keys(actual.dependencies)[0],location=prefix+'node_modules/'+first,pkgs={};
  for(const [name,spec]of Object.entries(actual.dependencies)){assert.match(spec,/^[~^]?\d+\.\d+\.\d+$/);pkgs[prefix+'node_modules/'+name]={name,version:spec.replace(/^[~^]/,'')};}
  Object.assign(pkgs[location],{dependencies:{'fixture-leaf':'^1.0.0'},optionalDependencies:{'fixture-optional':'~2.1.0'},peerDependencies:{ajv:'^6.0.0'}});
  pkgs[location+'/node_modules/fixture-leaf']={name:'fixture-leaf',version:kind==='range'?'2.0.0':'1.2.0'};
  pkgs[location+'/node_modules/fixture-optional']={name:'fixture-optional',version:'2.1.3'};
  if(kind==='optional-absent')delete pkgs[location+'/node_modules/fixture-optional'];
  if(kind==='orphan-peer')pkgs[location].peerDependenciesMeta={ghost:{optional:true}};
  const archive=runtimeArchive(entries=>{for(const [loc,p]of Object.entries(pkgs))if(!(kind==='missing-metadata'&&p.name==='fixture-leaf'))entries.push({path:'package/'+loc.slice(prefix.length)+'/package.json',raw:Buffer.from(JSON.stringify(p))});});
  const locked=structuredClone(pkgs);if(kind==='declaration')locked[location].dependencies['fixture-leaf']='^2.0.0';
  const f=await inputHistoryFixture(t,{runtimePackages:true,runtimeDistribution:archive,runtimeLockDeclarations:decl,runtimeDependencyPackages:locked});
  for(const n of ['runtime-version-constraints.mjs','runtime-dependency-graph.mjs'])fs.copyFileSync(new URL('../../scripts/enterprise/'+n,import.meta.url),file(f,'scripts/enterprise/'+n));
  const runtime=read(file(f,'evidence/probe.json')).oldRuntime,dir='evidence/enterprise/constraints/';
  const inv={schemaVersion:1,kind:'UNTRUSTED_RUNTIME_BYTE_INVENTORY',run:f.run.slug,designReportSha256:hash(fs.readFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'))),sources:[],project:{},distribution:{copy:dir+'source.tgz'}};
  for(const [n,s]of runtime.sources.entries()){const copy=dir+'source-'+n;put(file(f,copy),fs.readFileSync(file(f,'node_modules/takt/'+(s.path==='package.json'?s.path:'dist/'+s.path))).toString());inv.sources.push({path:s.path,copy});}
  for(const name of ['package.json','package-lock.json']){const copy=dir+'project-'+name;put(file(f,copy),fs.readFileSync(file(f,name)).toString());inv.project[name]=copy;}
  fs.writeFileSync(file(f,inv.distribution.copy),archive);const inventoryPath=dir+'inventory.json';put(file(f,inventoryPath),inv);
  const inspect=(args=['--dependency-constraints',inventoryPath])=>{const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-preparation.mjs'),...args],{cwd:f.root,env:f.env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});assert.deepEqual(tree(f.temporary),before);return q;};
  return {f,inspect,inventoryPath,inv,location,first,count:Object.keys(actual.dependencies).length+3};
 };
 await t.test('R1-01 archived graph joins nested peer optional edges and raw proofs for every original lock',async t=>{
  const {inspect,location,count}=await setup(t),q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.equal(r.component,'ARCHIVED_GRAPH_VERSION_CONSTRAINTS');assert.equal(r.bindings.length,2);
  for(const b of r.bindings){assert.equal(b.constraintAssessment.checks.length,count);assert.equal(b.constraintAssessment.unresolved.length,0);assert.equal(b.constraintAssessment.versionConstraintsProven,true);assert.equal(b.constraintAssessmentSha256,hash(JSON.stringify(b.constraintAssessment)));assert.equal(b.graphPackages.length,count);assert.ok(b.graphPackages.every(p=>p.sha256&&p.bytes>0&&p.metadataPath));const peer=b.constraintAssessment.checks.find(e=>e.from===location&&e.kind==='peer');assert.equal(peer.to,'node_modules/takt/node_modules/ajv');assert.equal(b.constraintAssessment.checks.find(e=>e.name==='fixture-leaf').to,location+'/node_modules/fixture-leaf');}
  assert.equal(r.dependencyClosureIntegrityProven,false);assert.equal(r.platformSelectionProven,false);assert.equal(r.completeMigrationHistory,false);assert.equal(r.initializationAuthority,false);assert.deepEqual(r.currentApprovals,[]);
 });
 await t.test('R1-05 integrated optional absence remains unresolved in each historical binding',async t=>{const {inspect}=await setup(t,'optional-absent'),q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.equal(r.unresolved.length,2);assert.ok(r.bindings.every(b=>b.constraintAssessment.versionConstraintsProven===false));assert.ok(r.unresolved.every(u=>u.reason==='OPTIONAL_SELECTION_UNPROVEN'&&u.inputsDigest));});
 for(const [kind,re]of [['range',/version constraint.*unsatisfied.*fixture-leaf/],['declaration',/dependency declarations.*mismatch/],['missing-metadata',/graph package metadata unavailable.*fixture-leaf/],['orphan-peer',/unsupported peer metadata/]])await t.test('R1-05 integrated authenticated inputs reject '+kind+' before writes',async t=>{const {inspect}=await setup(t,kind);fail(inspect(),re);});
 await t.test('R1-05 integrated historical lock cannot change an archived dependency version',async t=>{const {f,inspect,location}=await setup(t);rebindHistory(f,h=>{const s=h.snapshots.find(s=>s.path==='package-lock.json'),l=read(file(f,s.copy));l.packages[location+'/node_modules/fixture-leaf'].version='1.3.0';put(file(f,s.copy),l);const raw=fs.readFileSync(file(f,s.copy));for(const e of [s,h.inputs.entries.find(e=>e.path===s.path),h.references.find(e=>e.path===s.copy)]){e.sha256=hash(raw);e.bytes=raw.length;}h.inputs.digest=hash(JSON.stringify({entries:h.inputs.entries,runtime:h.inputs.runtime}));});fail(inspect(),/package metadata version mismatch.*fixture-leaf/);});
 await t.test('R1-05 integrated artifact alteration refuses before parsing',async t=>{const {f,inspect,inv}=await setup(t);fs.appendFileSync(file(f,inv.distribution.copy),'changed');fail(inspect(),/integrity mismatch/);});
 await t.test('R1-05 integrated constraints cannot grant complete authority',async t=>{const {inspect,inventoryPath}=await setup(t);fail(inspect(['--dependency-constraints',inventoryPath,'--complete']),/no authority overrides/);});
});

// Design graph constraints must bind every design's own phase-authenticated lock.
test('R1a archived design graph constraints source CLI',async t=>{
 const setup=async(t,kind='valid')=>{
  const actual=JSON.parse(fs.readFileSync(new URL('../../node_modules/takt/package.json',import.meta.url))),fields=['dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta'],decl=Object.fromEntries(fields.filter(k=>actual[k]!==undefined).map(k=>[k,actual[k]]));
  const prefix='node_modules/takt/',first=Object.keys(actual.dependencies)[0],location=prefix+'node_modules/'+first,pkgs={};
  for(const [name,spec]of Object.entries(actual.dependencies)){assert.match(spec,/^[~^]?\d+\.\d+\.\d+$/);pkgs[prefix+'node_modules/'+name]={name,version:spec.replace(/^[~^]/,'')};}
  Object.assign(pkgs[location],{dependencies:{'fixture-leaf':'^1.0.0'},optionalDependencies:{'fixture-optional':'~2.1.0'},peerDependencies:{ajv:'^6.0.0'}});
  pkgs[location+'/node_modules/fixture-leaf']={name:'fixture-leaf',version:kind==='range'?'2.0.0':'1.2.0'};
  pkgs[location+'/node_modules/fixture-optional']={name:'fixture-optional',version:'2.1.3'};
  if(kind==='optional-absent')delete pkgs[location+'/node_modules/fixture-optional'];
  if(kind==='orphan-peer')pkgs[location].peerDependenciesMeta={ghost:{optional:true}};
  const archive=runtimeArchive(entries=>{for(const [loc,p]of Object.entries(pkgs))if(!(kind==='missing-metadata'&&p.name==='fixture-leaf'))entries.push({path:'package/'+loc.slice(prefix.length)+'/package.json',raw:Buffer.from(JSON.stringify(p))});});
  const locked=structuredClone(pkgs);if(kind==='declaration')locked[location].dependencies['fixture-leaf']='^2.0.0';
  const f=await designHistoryFixture(t,await preparationFixture(t,{designHistory:true,runtimePackages:true,runtimeDistribution:archive,runtimeLockDeclarations:decl,runtimeDependencyPackages:locked}));
  for(const n of ['runtime-version-constraints.mjs','runtime-dependency-graph.mjs'])fs.copyFileSync(new URL('../../scripts/enterprise/'+n,import.meta.url),file(f,'scripts/enterprise/'+n));
  const runtime=read(file(f,'evidence/probe.json')).oldRuntime,dir='evidence/enterprise/constraints/';
  const inv={schemaVersion:1,kind:'UNTRUSTED_RUNTIME_BYTE_INVENTORY',run:f.run.slug,designReportSha256:hash(fs.readFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'))),sources:[],project:{},distribution:{copy:dir+'source.tgz'}};
  for(const [n,s]of runtime.sources.entries()){const copy=dir+'source-'+n;put(file(f,copy),fs.readFileSync(file(f,'node_modules/takt/'+(s.path==='package.json'?s.path:'dist/'+s.path))).toString());inv.sources.push({path:s.path,copy});}
  for(const name of ['package.json','package-lock.json']){const copy=dir+'project-'+name;put(file(f,copy),fs.readFileSync(file(f,name)).toString());inv.project[name]=copy;}
  fs.writeFileSync(file(f,inv.distribution.copy),archive);const inventoryPath=dir+'inventory.json';put(file(f,inventoryPath),inv);
  const inspect=(args=['--design-dependency-constraints',f.designInventory,inventoryPath])=>{const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-preparation.mjs'),...args],{cwd:f.root,env:f.env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});assert.deepEqual(tree(f.temporary),before);return q;};
  return {f,inspect,inventoryPath,inv,location,first,count:Object.keys(actual.dependencies).length+3};
 };

 const editLock=(f,edit)=>{
  const inventory=read(file(f,f.designInventory)),d=inventory.entries[0],old=d.inputs.digest,s=d.snapshots.find(s=>s.path==='package-lock.json'),l=read(file(f,s.copy));edit(l);put(file(f,s.copy),l);const raw=fs.readFileSync(file(f,s.copy));
  for(const e of [s,d.inputs.entries.find(e=>e.path===s.path)]){e.sha256=hash(raw);e.bytes=raw.length;}d.inputs.digest=hash(JSON.stringify({entries:d.inputs.entries,runtime:d.inputs.runtime}));
  for(const phase of f.records.filter(r=>r.type==='phase_complete'&&r.step==='design-architecture'&&r.iteration===7))phase.content=phase.content.replace(old,d.inputs.digest);
  put(file(f,f.designInventory),inventory);f.append({type:'boundary'});
 };
 await t.test('R1-01 design graph constraints retain occurrence routing own locks and nonempty edges',async t=>{
  const {f,inspect,location,count}=await setup(t);editLock(f,l=>{delete l.packages[location+'/node_modules/fixture-optional'];});
  const q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.equal(r.component,'ARCHIVED_DESIGN_GRAPH_VERSION_CONSTRAINTS');assert.equal(r.bindings.length,2);assert.deepEqual(r.bindings.map(b=>b.routing.model),['gpt-6.1-sol','gpt-6-astra']);assert.notEqual(r.bindings[0].lock.sha256,r.bindings[1].lock.sha256);
  for(const [n,b] of r.bindings.entries()){assert.equal(b.phases.length,2);assert.equal(b.lock.source.startIndex,b.startIndex);assert.equal(b.constraintAssessmentSha256,hash(JSON.stringify(b.constraintAssessment)));assert.equal(b.constraintAssessment.checks.length,count-(n===0?1:0));assert.equal(b.graphPackages.length,count-(n===0?1:0));assert.ok(b.graphPackages.every(p=>p.sha256&&p.bytes>0&&p.metadataPath));assert.equal(b.constraintAssessment.checks.find(e=>e.kind==='peer').to,'node_modules/takt/node_modules/ajv');assert.equal(b.constraintAssessment.checks.find(e=>e.name==='fixture-leaf').to,location+'/node_modules/fixture-leaf');}
  assert.equal(r.bindings[0].constraintAssessment.versionConstraintsProven,false);assert.equal(r.bindings[1].constraintAssessment.versionConstraintsProven,true);assert.equal(r.unresolved.length,2);assert.ok(r.unresolved.every(u=>u.inputsDigest===r.bindings[0].inputsDigest));assert.deepEqual(r.unresolved.map(u=>u.reason).sort(),['LOCK_PACKAGE_LOCATION_UNAVAILABLE','OPTIONAL_SELECTION_UNPROVEN']);
  for(const key of ['dependencyClosureIntegrityProven','platformSelectionProven','completeMigrationHistory','initializationAuthority'])assert.equal(r[key],false);assert.deepEqual(r.currentApprovals,[]);
 });
 for(const [kind,re]of [['range',/version constraint.*unsatisfied.*fixture-leaf/],['declaration',/dependency declarations.*mismatch/],['missing-metadata',/graph package metadata unavailable.*fixture-leaf/],['orphan-peer',/unsupported peer metadata/]])await t.test('R1-05 design graph authenticated inputs reject '+kind+' without writes',async t=>{const {inspect}=await setup(t,kind);fail(inspect(),re);});
 await t.test('R1-05 design graph rejects rebound original version despite current valid lock',async t=>{const {f,inspect,location}=await setup(t);editLock(f,l=>{l.packages[location+'/node_modules/fixture-leaf'].version='1.3.0';});fail(inspect(),/package metadata version mismatch.*fixture-leaf/);});
 for(const kind of ['missing-lock','omit-occurrence','phase-digest','artifact','authority'])await t.test('R1-05 design graph rejects '+kind+' without writes',async t=>{
  const {f,inspect,inventoryPath,inv}=await setup(t);
  if(kind==='missing-lock'){const d=read(file(f,f.designInventory)).entries[0];fs.unlinkSync(file(f,d.snapshots.find(s=>s.path==='package-lock.json').copy));}
  if(kind==='omit-occurrence')mutate(f,f.designInventory,i=>i.entries.shift());
  if(kind==='phase-digest'){f.records.find(r=>r.type==='phase_complete'&&r.step==='design-architecture'&&r.iteration===7).content='wrong';f.append({type:'boundary'});}
  if(kind==='artifact')fs.appendFileSync(file(f,inv.distribution.copy),'changed');
  const q=kind==='authority'?inspect(['--design-dependency-constraints',f.designInventory,inventoryPath,'--complete']):inspect();
  fail(q,{'missing-lock':/ENOENT/,'omit-occurrence':/complete design occurrence inventory/,'phase-digest':/design inputsDigest/,artifact:/integrity mismatch/,authority:/no authority overrides/}[kind]);
 });
});

// Platform declarations must be authenticated before any historical selection.
// Equal declarations alone do not authenticate the machine used at the time.
test('R1a archived platform declaration consistency',async t=>{
 const {assessPackageDependencyDeclarations:assess}=await import('../../scripts/enterprise/runtime-preparation.mjs');
 const location='node_modules/takt/node_modules/native',pkg=()=>({os:['linux','!win32'],cpu:['arm64','x64'],libc:['glibc','!musl']});
 await t.test('R1-01 platform lists match without order mutation or platform authority',()=>{const a=pkg(),b=pkg();for(const f of ['os','cpu','libc'])b[f].reverse();const before=JSON.stringify([a,b]),r=assess(a,b,location);assert.equal(JSON.stringify([a,b]),before);assert.deepEqual(r.platformDeclarations,{os:['!win32','linux'],cpu:['arm64','x64'],libc:['!musl','glibc']});assert.equal(r.platformSelectionProven,false);assert.equal(r.dependencyClosureIntegrityProven,false);assert.equal(r.initializationAuthority,false);assert.deepEqual(r.currentApprovals,[]);});
 await t.test('R1-01 absent platform fields retain absence without assuming host platform',()=>{const r=assess({}, {},location);assert.deepEqual(r.platformDeclarations,{os:null,cpu:null,libc:null});assert.equal(r.platformSelectionProven,false);});
 for(const field of ['os','cpu','libc'])for(const kind of ['different','missing'])await t.test('R1-05 platform '+field+' rejects '+kind,()=>{const a=pkg(),b=pkg();if(kind==='missing')delete b[field];else b[field]=['other'];assert.throws(()=>assess(a,b,location),new RegExp('dependency declarations.*native/'+field+'.*mismatch'));});
 for(const [kind,value]of [['string','linux'],['empty',[]],['duplicate',['linux','linux']],['invalid',['../linux']],['non-string',[1]],['null',null]])await t.test('R1-05 authenticated matching platform values reject '+kind,()=>{const a={os:value},b=structuredClone(a);assert.throws(()=>assess(a,b,location),/dependency declarations.*native\/os.*platform/);});
});
test('R1a archived platform declarations source CLI',async t=>{
 const setup=async(t,invalid=false)=>{
  const actual=JSON.parse(fs.readFileSync(new URL('../../node_modules/takt/package.json',import.meta.url))),fields=['dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta'],decl=Object.fromEntries(fields.filter(k=>actual[k]!==undefined).map(k=>[k,actual[k]]));
  const location='node_modules/takt/node_modules/fixture-platform',metadata={name:'fixture-platform',version:'1.0.0',os:invalid?'linux':['linux','!win32'],cpu:['arm64','x64'],libc:['glibc']};
  const raw=runtimeArchive(entries=>entries.push({path:'package/node_modules/fixture-platform/package.json',raw:Buffer.from(JSON.stringify(metadata))}));
  const f=await inputHistoryFixture(t,{runtimePackages:true,runtimeDistribution:raw,runtimeLockDeclarations:decl,runtimeDependencyPackages:{[location]:metadata}}),runtime=read(file(f,'evidence/probe.json')).oldRuntime,dir='evidence/enterprise/platform/';
  const inv={schemaVersion:1,kind:'UNTRUSTED_RUNTIME_BYTE_INVENTORY',run:f.run.slug,designReportSha256:hash(fs.readFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'))),sources:[],project:{},distribution:{copy:dir+'source.tgz'}};
  for(const [n,s]of runtime.sources.entries()){const copy=dir+'source-'+n;put(file(f,copy),fs.readFileSync(file(f,'node_modules/takt/'+(s.path==='package.json'?s.path:'dist/'+s.path))).toString());inv.sources.push({path:s.path,copy});}
  for(const name of ['package.json','package-lock.json']){const copy=dir+'project-'+name;put(file(f,copy),fs.readFileSync(file(f,name)).toString());inv.project[name]=copy;}
  fs.writeFileSync(file(f,inv.distribution.copy),raw);const inventoryPath=dir+'inventory.json';put(file(f,inventoryPath),inv);
  const inspect=()=>{const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-preparation.mjs'),'--dependency-declarations',inventoryPath],{cwd:f.root,env:f.env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});assert.deepEqual(tree(f.temporary),before);return q;};return {f,inspect,location,inv};
 };
 await t.test('R1-01 archived nonempty platform declarations bind each original lock',async t=>{const {inspect,location}=await setup(t),q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.equal(r.bindings.length,2);for(const b of r.bindings){const d=b.declarations.find(d=>d.location===location);assert.ok(d.sha256&&d.bytes>0);assert.deepEqual(d.assessment.platformDeclarations,{os:['!win32','linux'],cpu:['arm64','x64'],libc:['glibc']});assert.equal(d.assessment.platformSelectionProven,false);}assert.equal(r.platformSelectionProven,false);assert.equal(r.initializationAuthority,false);assert.deepEqual(r.currentApprovals,[]);});
 for(const field of ['os','cpu','libc'])await t.test('R1-05 rebound historical '+field+' mismatch refuses readonly',async t=>{const {f,inspect,location}=await setup(t);rebindHistory(f,h=>{const s=h.snapshots.find(s=>s.path==='package-lock.json'),l=read(file(f,s.copy));l.packages[location][field]=['other'];put(file(f,s.copy),l);const raw=fs.readFileSync(file(f,s.copy));for(const e of [s,h.inputs.entries.find(e=>e.path===s.path),h.references.find(e=>e.path===s.copy)]){e.sha256=hash(raw);e.bytes=raw.length;}h.inputs.digest=hash(JSON.stringify({entries:h.inputs.entries,runtime:h.inputs.runtime}));});fail(inspect(),new RegExp('dependency declarations.*'+field+'.*mismatch'));});
 await t.test('R1-05 authenticated archive and lock matching invalid platform refuse readonly',async t=>{const {inspect}=await setup(t,true);fail(inspect(),/dependency declarations.*os.*platform/);});
 await t.test('R1-05 platform archive tampering refuses integrity before interpretation',async t=>{const {f,inspect,inv}=await setup(t);fs.appendFileSync(file(f,inv.distribution.copy),'changed');fail(inspect(),/integrity mismatch/);});
});

// Explicit bundle declarations bind direct bundled metadata, not installation
// contents or a complete transitive dependency closure.
test('R1a archived bundled declarations data',async t=>{
 const mod=await import('../../scripts/enterprise/runtime-preparation.mjs'),assess=(...a)=>mod.assessBundledDependencyDeclarations(...a),location='node_modules/takt';
 const pkg=()=>({dependencies:{a:'^1.0.0'},optionalDependencies:{b:'^2.0.0'},bundleDependencies:['b','a']});
 await t.test('R1-01 explicit direct and optional names compare without mutation',()=>{const a=pkg(),b=pkg();b.bundleDependencies.reverse();const before=JSON.stringify([a,b]);assert.deepEqual(assess(a,b,location).names,['a','b']);assert.equal(JSON.stringify([a,b]),before);assert.equal(assess(a,b,location).bundledClosureIntegrityProven,false);});
 await t.test('R1-01 absent bundle declarations remain empty',()=>assert.deepEqual(assess({}, {},location).names,[]));
 for(const kind of ['mismatch','missing','boolean','duplicate','invalid','undeclared','alias'])await t.test('R1-05 explicit bundle declaration rejects '+kind,()=>{const a=pkg(),b=pkg();if(kind==='mismatch')b.bundleDependencies=['a'];if(kind==='missing')delete b.bundleDependencies;if(kind==='boolean')a.bundleDependencies=b.bundleDependencies=true;if(kind==='duplicate')a.bundleDependencies=b.bundleDependencies=['a','a'];if(kind==='invalid')a.bundleDependencies=b.bundleDependencies=['../a'];if(kind==='undeclared')a.bundleDependencies=b.bundleDependencies=['c'];if(kind==='alias')a.bundledDependencies=b.bundledDependencies=['a'];assert.throws(()=>assess(a,b,location),/bundled declarations.*node_modules\/takt.*bundle/);});
});
test('R1a archived bundled declarations source CLI',async t=>{
 const setup=async(t,missingMetadata=false)=>{
  const actual=JSON.parse(fs.readFileSync(new URL('../../node_modules/takt/package.json',import.meta.url))),fields=['dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta','bundleDependencies'],decl=Object.fromEntries(fields.filter(k=>actual[k]!==undefined).map(k=>[k,actual[k]]));
  assert.ok(actual.bundleDependencies.length>0);const names=actual.bundleDependencies,location='node_modules/takt/node_modules/'+names[0];
  const packages=Object.fromEntries(names.map(name=>['node_modules/takt/node_modules/'+name,{name,version:'1.0.0',inBundle:true}]));
  const raw=runtimeArchive(entries=>{for(const [i,name]of names.entries())if(!(missingMetadata&&i===0))entries.push({path:'package/node_modules/'+name+'/package.json',raw:Buffer.from(JSON.stringify({name,version:'1.0.0'}))});});
  const f=await inputHistoryFixture(t,{runtimePackages:true,runtimeDistribution:raw,runtimeLockDeclarations:decl,runtimeDependencyPackages:packages}),runtime=read(file(f,'evidence/probe.json')).oldRuntime,dir='evidence/enterprise/bundles/';
  const inv={schemaVersion:1,kind:'UNTRUSTED_RUNTIME_BYTE_INVENTORY',run:f.run.slug,designReportSha256:hash(fs.readFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'))),sources:[],project:{},distribution:{copy:dir+'source.tgz'}};
  for(const [n,s]of runtime.sources.entries()){const copy=dir+'source-'+n;put(file(f,copy),fs.readFileSync(file(f,'node_modules/takt/'+(s.path==='package.json'?s.path:'dist/'+s.path))).toString());inv.sources.push({path:s.path,copy});}
  for(const name of ['package.json','package-lock.json']){const copy=dir+'project-'+name;put(file(f,copy),fs.readFileSync(file(f,name)).toString());inv.project[name]=copy;}
  fs.writeFileSync(file(f,inv.distribution.copy),raw);const inventoryPath=dir+'inventory.json';put(file(f,inventoryPath),inv);
  const inspect=(extra=[])=>{const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-preparation.mjs'),'--bundled-declarations',inventoryPath,...extra],{cwd:f.root,env:f.env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});assert.deepEqual(tree(f.temporary),before);return q;};return {f,inspect,location,inv,names};
 };
 await t.test('R1-01 explicit bundles bind metadata to both authenticated original locks',async t=>{const {inspect,names}=await setup(t),q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.equal(r.bindings.length,2);for(const b of r.bindings){assert.equal(b.bundledPackages.length,names.length);for(const p of b.bundledPackages){assert.equal(p.owner,'node_modules/takt');assert.ok(p.sha256&&p.bytes>0);assert.equal(p.artifact.path,b.distribution.path);assert.equal(p.inBundle,true);}}assert.equal(r.bundledClosureIntegrityProven,false);assert.equal(r.initializationAuthority,false);assert.deepEqual(r.currentApprovals,[]);});
 for(const kind of ['declaration','missing-lock','inBundle','version'])await t.test('R1-05 rebound original bundled lock rejects '+kind,async t=>{const {f,inspect,location}=await setup(t);rebindHistory(f,h=>{const s=h.snapshots.find(s=>s.path==='package-lock.json'),l=read(file(f,s.copy));if(kind==='declaration')l.packages['node_modules/takt'].bundleDependencies=[];if(kind==='missing-lock')delete l.packages[location];if(kind==='inBundle')l.packages[location].inBundle=false;if(kind==='version')l.packages[location].version='2.0.0';put(file(f,s.copy),l);const raw=fs.readFileSync(file(f,s.copy));for(const e of [s,h.inputs.entries.find(e=>e.path===s.path),h.references.find(e=>e.path===s.copy)]){e.sha256=hash(raw);e.bytes=raw.length;}h.inputs.digest=hash(JSON.stringify({entries:h.inputs.entries,runtime:h.inputs.runtime}));});fail(inspect(),{declaration:/bundled declarations.*mismatch/,'missing-lock':/bundled package lock unavailable/,inBundle:/bundled package inBundle required/,version:/metadata.*version|version.*metadata/}[kind]);});
 await t.test('R1-05 declared bundled package without archive metadata refuses',async t=>{const {inspect}=await setup(t,true);fail(inspect(),/bundled package metadata unavailable/);});
 await t.test('R1-05 bundled archive tampering refuses integrity',async t=>{const {f,inspect,inv}=await setup(t);fs.appendFileSync(file(f,inv.distribution.copy),'changed');fail(inspect(),/integrity mismatch/);});
 await t.test('R1-05 bundled inspection cannot grant complete authority',async t=>{const {inspect}=await setup(t);fail(inspect(['--complete']),/no authority overrides/);});
});

// Design bundle declarations use each authenticated phase's original lock.
test('R1a archived design bundled declarations source CLI',async t=>{
 const setup=async(t,missingMetadata=false)=>{
  const actual=JSON.parse(fs.readFileSync(new URL('../../node_modules/takt/package.json',import.meta.url))),fields=['dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta','bundleDependencies'],decl=Object.fromEntries(fields.filter(k=>actual[k]!==undefined).map(k=>[k,actual[k]]));
  assert.ok(actual.bundleDependencies.length>0);const names=actual.bundleDependencies,location='node_modules/takt/node_modules/'+names[0];
  const packages=Object.fromEntries(names.map(name=>['node_modules/takt/node_modules/'+name,{name,version:'1.0.0',inBundle:true}]));
  packages['node_modules/takt/node_modules/fixture-extra']={name:'fixture-extra',version:'1.0.0'};
  const raw=runtimeArchive(entries=>{entries.push({path:'package/node_modules/fixture-extra/package.json',raw:Buffer.from(JSON.stringify({name:'fixture-extra',version:'1.0.0'}))});for(const [i,name]of names.entries())if(!(missingMetadata&&i===0))entries.push({path:'package/node_modules/'+name+'/package.json',raw:Buffer.from(JSON.stringify({name,version:'1.0.0'}))});});
  const f=await designHistoryFixture(t,await preparationFixture(t,{designHistory:true,runtimePackages:true,runtimeDistribution:raw,runtimeLockDeclarations:decl,runtimeDependencyPackages:packages})),runtime=read(file(f,'evidence/probe.json')).oldRuntime,dir='evidence/enterprise/bundles/';
  const inv={schemaVersion:1,kind:'UNTRUSTED_RUNTIME_BYTE_INVENTORY',run:f.run.slug,designReportSha256:hash(fs.readFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'))),sources:[],project:{},distribution:{copy:dir+'source.tgz'}};
  for(const [n,s]of runtime.sources.entries()){const copy=dir+'source-'+n;put(file(f,copy),fs.readFileSync(file(f,'node_modules/takt/'+(s.path==='package.json'?s.path:'dist/'+s.path))).toString());inv.sources.push({path:s.path,copy});}
  for(const name of ['package.json','package-lock.json']){const copy=dir+'project-'+name;put(file(f,copy),fs.readFileSync(file(f,name)).toString());inv.project[name]=copy;}
  fs.writeFileSync(file(f,inv.distribution.copy),raw);const inventoryPath=dir+'inventory.json';put(file(f,inventoryPath),inv);
  const inspect=(extra=[])=>{const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-preparation.mjs'),'--design-bundled-declarations',f.designInventory,inventoryPath,...extra],{cwd:f.root,env:f.env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});assert.deepEqual(tree(f.temporary),before);return q;};return {f,inspect,location,inv,names};
 };
 const editLock=(f,edit)=>{
  const inventory=read(file(f,f.designInventory)),d=inventory.entries[0],old=d.inputs.digest,s=d.snapshots.find(s=>s.path==='package-lock.json'),l=read(file(f,s.copy));edit(l);put(file(f,s.copy),l);const raw=fs.readFileSync(file(f,s.copy));
  for(const e of [s,d.inputs.entries.find(e=>e.path===s.path)]){e.sha256=hash(raw);e.bytes=raw.length;}d.inputs.digest=hash(JSON.stringify({entries:d.inputs.entries,runtime:d.inputs.runtime}));
  for(const phase of f.records.filter(r=>r.type==='phase_complete'&&r.step==='design-architecture'&&r.iteration===7))phase.content=phase.content.replace(old,d.inputs.digest);
  put(file(f,f.designInventory),inventory);f.append({type:'boundary'});
 };

 await t.test('R1-01 design bundles bind distinct occurrence locks without substituting current lock',async t=>{
  const {f,inspect,names}=await setup(t);editLock(f,l=>{delete l.packages['node_modules/takt/node_modules/fixture-extra'];});
  const q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.equal(r.component,'ARCHIVED_DESIGN_BUNDLED_DECLARATIONS');assert.equal(r.bindings.length,2);assert.deepEqual(r.bindings.map(b=>b.routing.model),['gpt-6.1-sol','gpt-6-astra']);assert.notEqual(r.bindings[0].lock.sha256,r.bindings[1].lock.sha256);
  for(const b of r.bindings){assert.equal(b.phases.length,2);assert.equal(b.lock.source.startIndex,b.startIndex);assert.equal(b.bundledPackages.length,names.length);assert.deepEqual(b.bundledDeclarations.find(d=>d.location==='node_modules/takt').assessment.names,[...names].sort());for(const p of b.bundledPackages){assert.equal(p.owner,'node_modules/takt');assert.ok(p.sha256&&p.bytes>0);assert.deepEqual(p.artifact,b.distribution);assert.equal(p.inBundle,true);}}
  assert.equal(r.unresolved.length,1);assert.equal(r.unresolved[0].reason,'LOCK_PACKAGE_LOCATION_UNAVAILABLE');assert.equal(r.unresolved[0].inputsDigest,r.bindings[0].inputsDigest);
  for(const key of ['bundledClosureIntegrityProven','dependencyClosureIntegrityProven','platformSelectionProven','completeMigrationHistory','initializationAuthority'])assert.equal(r[key],false);assert.deepEqual(r.currentApprovals,[]);
 });
 for(const kind of ['declaration','missing-package','inBundle','version'])await t.test('R1-05 design bundles reject rebound original '+kind,async t=>{
  const {f,inspect,location}=await setup(t);editLock(f,l=>{if(kind==='declaration')l.packages['node_modules/takt'].bundleDependencies=[];if(kind==='missing-package')delete l.packages[location];if(kind==='inBundle')delete l.packages[location].inBundle;if(kind==='version')l.packages[location].version='2.0.0';});
  fail(inspect(),{declaration:/bundled declarations.*mismatch/,'missing-package':/bundled package lock unavailable/,inBundle:/bundled package inBundle required/,version:/package metadata version mismatch/}[kind]);
 });
 await t.test('R1-05 design bundled package without archive metadata refuses',async t=>{const {inspect}=await setup(t,true);fail(inspect(),/bundled package metadata unavailable/);});
 for(const kind of ['missing-lock','omit-occurrence','phase-digest','artifact','authority'])await t.test('R1-05 design bundles reject '+kind+' without writes',async t=>{
  const {f,inspect,inv}=await setup(t);
  if(kind==='missing-lock'){const d=read(file(f,f.designInventory)).entries[0];fs.unlinkSync(file(f,d.snapshots.find(s=>s.path==='package-lock.json').copy));}
  if(kind==='omit-occurrence')mutate(f,f.designInventory,i=>i.entries.shift());
  if(kind==='phase-digest'){f.records.find(r=>r.type==='phase_complete'&&r.step==='design-architecture'&&r.iteration===7).content='wrong';f.append({type:'boundary'});}
  if(kind==='artifact')fs.appendFileSync(file(f,inv.distribution.copy),'changed');
  fail(inspect(kind==='authority'?['--complete']:[]),{'missing-lock':/ENOENT/,'omit-occurrence':/complete design occurrence inventory/,'phase-digest':/design inputsDigest/,artifact:/integrity mismatch/,authority:/no authority overrides/}[kind]);
 });
});

// Compose direct bundles and graph ranges without changing the earlier public entry points.
// Join actual graph edges to authenticated archive metadata and each old lock.
test('R1a composed bundle graph constraints source CLI',async t=>{
 const setup=async(t,kind='valid')=>{
  const actual=JSON.parse(fs.readFileSync(new URL('../../node_modules/takt/package.json',import.meta.url))),fields=['bundleDependencies','dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta'],decl=Object.fromEntries(fields.filter(k=>actual[k]!==undefined).map(k=>[k,actual[k]]));
  const prefix='node_modules/takt/',first=Object.keys(actual.dependencies)[0],location=prefix+'node_modules/'+first,pkgs={};
  for(const [name,spec]of Object.entries(actual.dependencies)){assert.match(spec,/^[~^]?\d+\.\d+\.\d+$/);pkgs[prefix+'node_modules/'+name]={name,version:spec.replace(/^[~^]/,'')};}
  Object.assign(pkgs[location],{dependencies:{'fixture-leaf':'^1.0.0'},optionalDependencies:{'fixture-optional':'~2.1.0'},peerDependencies:{ajv:'^6.0.0'}});
  pkgs[location+'/node_modules/fixture-leaf']={name:'fixture-leaf',version:kind==='range'?'2.0.0':'1.2.0'};
  pkgs[location+'/node_modules/fixture-optional']={name:'fixture-optional',version:'2.1.3'};
  if(kind==='optional-absent')delete pkgs[location+'/node_modules/fixture-optional'];
  if(kind==='orphan-peer')pkgs[location].peerDependenciesMeta={ghost:{optional:true}};
  for(const name of actual.bundleDependencies)pkgs[prefix+'node_modules/'+name].inBundle=true;
  if(kind==='bundle-range')pkgs[prefix+'node_modules/react'].version='99.0.0';
  const archive=runtimeArchive(entries=>{for(const [loc,p]of Object.entries(pkgs))if(!(kind==='missing-metadata'&&p.name==='fixture-leaf')&&!(kind==='bundle-metadata'&&p.name==='react'))entries.push({path:'package/'+loc.slice(prefix.length)+'/package.json',raw:Buffer.from(JSON.stringify(p))});});
  const locked=structuredClone(pkgs);if(kind==='bundle-flag')delete locked[prefix+'node_modules/react'].inBundle;if(kind==='bundle-declaration')decl.bundleDependencies=decl.bundleDependencies.filter(n=>n!=='react');if(kind==='declaration')locked[location].dependencies['fixture-leaf']='^2.0.0';
  const f=await inputHistoryFixture(t,{runtimePackages:true,runtimeDistribution:archive,runtimeLockDeclarations:decl,runtimeDependencyPackages:locked});
  for(const n of ['runtime-version-constraints.mjs','runtime-dependency-graph.mjs'])fs.copyFileSync(new URL('../../scripts/enterprise/'+n,import.meta.url),file(f,'scripts/enterprise/'+n));
  const runtime=read(file(f,'evidence/probe.json')).oldRuntime,dir='evidence/enterprise/constraints/';
  const inv={schemaVersion:1,kind:'UNTRUSTED_RUNTIME_BYTE_INVENTORY',run:f.run.slug,designReportSha256:hash(fs.readFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'))),sources:[],project:{},distribution:{copy:dir+'source.tgz'}};
  for(const [n,s]of runtime.sources.entries()){const copy=dir+'source-'+n;put(file(f,copy),fs.readFileSync(file(f,'node_modules/takt/'+(s.path==='package.json'?s.path:'dist/'+s.path))).toString());inv.sources.push({path:s.path,copy});}
  for(const name of ['package.json','package-lock.json']){const copy=dir+'project-'+name;put(file(f,copy),fs.readFileSync(file(f,name)).toString());inv.project[name]=copy;}
  fs.writeFileSync(file(f,inv.distribution.copy),archive);const inventoryPath=dir+'inventory.json';put(file(f,inventoryPath),inv);
  const inspect=(args=['--bundled-constraints',inventoryPath])=>{const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-preparation.mjs'),...args],{cwd:f.root,env:f.env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});assert.deepEqual(tree(f.temporary),before);return q;};
  return {f,inspect,inventoryPath,inv,location,first,bundleNames:[...actual.bundleDependencies],count:Object.keys(actual.dependencies).length+3};
 };
 await t.test('R1-01 composed archived graph joins nested peer optional edges and raw proofs for every original lock',async t=>{
  const {inspect,location,count,bundleNames}=await setup(t),q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.equal(r.component,'ARCHIVED_BUNDLED_GRAPH_CONSTRAINTS');assert.equal(r.bindings.length,2);assert.equal(r.bundledClosureIntegrityProven,false);for(const b of r.bindings){assert.deepEqual(b.bundledPackages.map(p=>p.name).sort(),[...bundleNames].sort());for(const p of b.bundledPackages){assert.equal(p.inBundle,true);const g=b.graphPackages.find(g=>g.location===p.location);assert.equal(g.sha256,p.sha256);assert.deepEqual(g.artifact,p.artifact);assert.ok(b.constraintAssessment.checks.some(c=>c.to===p.location));}}
  for(const b of r.bindings){assert.equal(b.constraintAssessment.checks.length,count);assert.equal(b.constraintAssessment.unresolved.length,0);assert.equal(b.constraintAssessment.versionConstraintsProven,true);assert.equal(b.constraintAssessmentSha256,hash(JSON.stringify(b.constraintAssessment)));assert.equal(b.graphPackages.length,count);assert.ok(b.graphPackages.every(p=>p.sha256&&p.bytes>0&&p.metadataPath));const peer=b.constraintAssessment.checks.find(e=>e.from===location&&e.kind==='peer');assert.equal(peer.to,'node_modules/takt/node_modules/ajv');assert.equal(b.constraintAssessment.checks.find(e=>e.name==='fixture-leaf').to,location+'/node_modules/fixture-leaf');}
  assert.equal(r.dependencyClosureIntegrityProven,false);assert.equal(r.platformSelectionProven,false);assert.equal(r.completeMigrationHistory,false);assert.equal(r.initializationAuthority,false);assert.deepEqual(r.currentApprovals,[]);
 });
 await t.test('R1-05 composed integrated optional absence remains unresolved in each historical binding',async t=>{const {inspect}=await setup(t,'optional-absent'),q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.equal(r.unresolved.length,2);assert.ok(r.bindings.every(b=>b.constraintAssessment.versionConstraintsProven===false));assert.ok(r.unresolved.every(u=>u.reason==='OPTIONAL_SELECTION_UNPROVEN'&&u.inputsDigest));});
 for(const [kind,re]of [['bundle-range',/version constraint.*unsatisfied.*react/],['bundle-flag',/bundled package inBundle required/],['bundle-declaration',/bundleDependencies: archive\/lock mismatch/],['bundle-metadata',/bundled package metadata unavailable/],['range',/version constraint.*unsatisfied.*fixture-leaf/],['declaration',/dependency declarations.*mismatch/],['missing-metadata',/graph package metadata unavailable.*fixture-leaf/],['orphan-peer',/unsupported peer metadata/]])await t.test('R1-05 composed integrated authenticated inputs reject '+kind+' before writes',async t=>{const {inspect}=await setup(t,kind);fail(inspect(),re);});
 await t.test('R1-05 composed integrated historical lock cannot change an archived dependency version',async t=>{const {f,inspect,location}=await setup(t);rebindHistory(f,h=>{const s=h.snapshots.find(s=>s.path==='package-lock.json'),l=read(file(f,s.copy));l.packages[location+'/node_modules/fixture-leaf'].version='1.3.0';put(file(f,s.copy),l);const raw=fs.readFileSync(file(f,s.copy));for(const e of [s,h.inputs.entries.find(e=>e.path===s.path),h.references.find(e=>e.path===s.copy)]){e.sha256=hash(raw);e.bytes=raw.length;}h.inputs.digest=hash(JSON.stringify({entries:h.inputs.entries,runtime:h.inputs.runtime}));});fail(inspect(),/package metadata version mismatch.*fixture-leaf/);});
 await t.test('R1-05 composed integrated artifact alteration refuses before parsing',async t=>{const {f,inspect,inv}=await setup(t);fs.appendFileSync(file(f,inv.distribution.copy),'changed');fail(inspect(),/integrity mismatch/);});
 await t.test('R1-05 composed integrated constraints cannot grant complete authority',async t=>{const {inspect,inventoryPath}=await setup(t);fail(inspect(['--bundled-constraints',inventoryPath,'--complete']),/no authority overrides/);});
});

// Design graph constraints must bind every design's own phase-authenticated lock.
test('R1a composed design bundle graph constraints source CLI',async t=>{
 const setup=async(t,kind='valid')=>{
  const actual=JSON.parse(fs.readFileSync(new URL('../../node_modules/takt/package.json',import.meta.url))),fields=['bundleDependencies','dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta'],decl=Object.fromEntries(fields.filter(k=>actual[k]!==undefined).map(k=>[k,actual[k]]));
  const prefix='node_modules/takt/',first=Object.keys(actual.dependencies)[0],location=prefix+'node_modules/'+first,pkgs={};
  for(const [name,spec]of Object.entries(actual.dependencies)){assert.match(spec,/^[~^]?\d+\.\d+\.\d+$/);pkgs[prefix+'node_modules/'+name]={name,version:spec.replace(/^[~^]/,'')};}
  Object.assign(pkgs[location],{dependencies:{'fixture-leaf':'^1.0.0'},optionalDependencies:{'fixture-optional':'~2.1.0'},peerDependencies:{ajv:'^6.0.0'}});
  pkgs[location+'/node_modules/fixture-leaf']={name:'fixture-leaf',version:kind==='range'?'2.0.0':'1.2.0'};
  pkgs[location+'/node_modules/fixture-optional']={name:'fixture-optional',version:'2.1.3'};
  if(kind==='optional-absent')delete pkgs[location+'/node_modules/fixture-optional'];
  if(kind==='orphan-peer')pkgs[location].peerDependenciesMeta={ghost:{optional:true}};
  for(const name of actual.bundleDependencies)pkgs[prefix+'node_modules/'+name].inBundle=true;
  if(kind==='bundle-range')pkgs[prefix+'node_modules/react'].version='99.0.0';
  const archive=runtimeArchive(entries=>{for(const [loc,p]of Object.entries(pkgs))if(!(kind==='missing-metadata'&&p.name==='fixture-leaf')&&!(kind==='bundle-metadata'&&p.name==='react'))entries.push({path:'package/'+loc.slice(prefix.length)+'/package.json',raw:Buffer.from(JSON.stringify(p))});});
  const locked=structuredClone(pkgs);if(kind==='bundle-flag')delete locked[prefix+'node_modules/react'].inBundle;if(kind==='bundle-declaration')decl.bundleDependencies=decl.bundleDependencies.filter(n=>n!=='react');if(kind==='declaration')locked[location].dependencies['fixture-leaf']='^2.0.0';
  const f=await designHistoryFixture(t,await preparationFixture(t,{designHistory:true,runtimePackages:true,runtimeDistribution:archive,runtimeLockDeclarations:decl,runtimeDependencyPackages:locked}));
  for(const n of ['runtime-version-constraints.mjs','runtime-dependency-graph.mjs'])fs.copyFileSync(new URL('../../scripts/enterprise/'+n,import.meta.url),file(f,'scripts/enterprise/'+n));
  const runtime=read(file(f,'evidence/probe.json')).oldRuntime,dir='evidence/enterprise/constraints/';
  const inv={schemaVersion:1,kind:'UNTRUSTED_RUNTIME_BYTE_INVENTORY',run:f.run.slug,designReportSha256:hash(fs.readFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'))),sources:[],project:{},distribution:{copy:dir+'source.tgz'}};
  for(const [n,s]of runtime.sources.entries()){const copy=dir+'source-'+n;put(file(f,copy),fs.readFileSync(file(f,'node_modules/takt/'+(s.path==='package.json'?s.path:'dist/'+s.path))).toString());inv.sources.push({path:s.path,copy});}
  for(const name of ['package.json','package-lock.json']){const copy=dir+'project-'+name;put(file(f,copy),fs.readFileSync(file(f,name)).toString());inv.project[name]=copy;}
  fs.writeFileSync(file(f,inv.distribution.copy),archive);const inventoryPath=dir+'inventory.json';put(file(f,inventoryPath),inv);
  const inspect=(args=['--design-bundled-constraints',f.designInventory,inventoryPath])=>{const before=tree(f.temporary),q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-preparation.mjs'),...args],{cwd:f.root,env:f.env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});assert.deepEqual(tree(f.temporary),before);return q;};
  return {f,inspect,inventoryPath,inv,location,first,bundleNames:[...actual.bundleDependencies],count:Object.keys(actual.dependencies).length+3};
 };

 const editLock=(f,edit)=>{
  const inventory=read(file(f,f.designInventory)),d=inventory.entries[0],old=d.inputs.digest,s=d.snapshots.find(s=>s.path==='package-lock.json'),l=read(file(f,s.copy));edit(l);put(file(f,s.copy),l);const raw=fs.readFileSync(file(f,s.copy));
  for(const e of [s,d.inputs.entries.find(e=>e.path===s.path)]){e.sha256=hash(raw);e.bytes=raw.length;}d.inputs.digest=hash(JSON.stringify({entries:d.inputs.entries,runtime:d.inputs.runtime}));
  for(const phase of f.records.filter(r=>r.type==='phase_complete'&&r.step==='design-architecture'&&r.iteration===7))phase.content=phase.content.replace(old,d.inputs.digest);
  put(file(f,f.designInventory),inventory);f.append({type:'boundary'});
 };
 await t.test('R1-01 composed design graph constraints retain occurrence routing own locks and nonempty edges',async t=>{
  const {f,inspect,location,count,bundleNames}=await setup(t);editLock(f,l=>{delete l.packages[location+'/node_modules/fixture-optional'];});
  const q=inspect();assert.equal(q.status,0,q.stderr);const r=JSON.parse(q.stdout);assert.equal(r.component,'ARCHIVED_DESIGN_BUNDLED_GRAPH_CONSTRAINTS');assert.equal(r.bindings.length,2);assert.equal(r.bundledClosureIntegrityProven,false);for(const b of r.bindings){assert.deepEqual(b.bundledPackages.map(p=>p.name).sort(),[...bundleNames].sort());for(const p of b.bundledPackages){assert.equal(p.inBundle,true);const g=b.graphPackages.find(g=>g.location===p.location);assert.equal(g.sha256,p.sha256);assert.deepEqual(g.artifact,p.artifact);assert.ok(b.constraintAssessment.checks.some(c=>c.to===p.location));}}assert.deepEqual(r.bindings.map(b=>b.routing.model),['gpt-6.1-sol','gpt-6-astra']);assert.notEqual(r.bindings[0].lock.sha256,r.bindings[1].lock.sha256);
  for(const [n,b] of r.bindings.entries()){assert.equal(b.phases.length,2);assert.equal(b.lock.source.startIndex,b.startIndex);assert.equal(b.constraintAssessmentSha256,hash(JSON.stringify(b.constraintAssessment)));assert.equal(b.constraintAssessment.checks.length,count-(n===0?1:0));assert.equal(b.graphPackages.length,count-(n===0?1:0));assert.ok(b.graphPackages.every(p=>p.sha256&&p.bytes>0&&p.metadataPath));assert.equal(b.constraintAssessment.checks.find(e=>e.kind==='peer').to,'node_modules/takt/node_modules/ajv');assert.equal(b.constraintAssessment.checks.find(e=>e.name==='fixture-leaf').to,location+'/node_modules/fixture-leaf');}
  assert.equal(r.bindings[0].constraintAssessment.versionConstraintsProven,false);assert.equal(r.bindings[1].constraintAssessment.versionConstraintsProven,true);assert.equal(r.unresolved.length,2);assert.ok(r.unresolved.every(u=>u.inputsDigest===r.bindings[0].inputsDigest));assert.deepEqual(r.unresolved.map(u=>u.reason).sort(),['LOCK_PACKAGE_LOCATION_UNAVAILABLE','OPTIONAL_SELECTION_UNPROVEN']);
  for(const key of ['dependencyClosureIntegrityProven','platformSelectionProven','completeMigrationHistory','initializationAuthority'])assert.equal(r[key],false);assert.deepEqual(r.currentApprovals,[]);
 });
 for(const [kind,re]of [['bundle-range',/version constraint.*unsatisfied.*react/],['bundle-flag',/bundled package inBundle required/],['bundle-declaration',/bundleDependencies: archive\/lock mismatch/],['bundle-metadata',/bundled package metadata unavailable/],['range',/version constraint.*unsatisfied.*fixture-leaf/],['declaration',/dependency declarations.*mismatch/],['missing-metadata',/graph package metadata unavailable.*fixture-leaf/],['orphan-peer',/unsupported peer metadata/]])await t.test('R1-05 composed design graph authenticated inputs reject '+kind+' without writes',async t=>{const {inspect}=await setup(t,kind);fail(inspect(),re);});
 await t.test('R1-05 composed design graph rejects rebound original version despite current valid lock',async t=>{const {f,inspect,location}=await setup(t);editLock(f,l=>{l.packages[location+'/node_modules/fixture-leaf'].version='1.3.0';});fail(inspect(),/package metadata version mismatch.*fixture-leaf/);});
 for(const kind of ['missing-lock','omit-occurrence','phase-digest','artifact','authority'])await t.test('R1-05 composed design graph rejects '+kind+' without writes',async t=>{
  const {f,inspect,inventoryPath,inv}=await setup(t);
  if(kind==='missing-lock'){const d=read(file(f,f.designInventory)).entries[0];fs.unlinkSync(file(f,d.snapshots.find(s=>s.path==='package-lock.json').copy));}
  if(kind==='omit-occurrence')mutate(f,f.designInventory,i=>i.entries.shift());
  if(kind==='phase-digest'){f.records.find(r=>r.type==='phase_complete'&&r.step==='design-architecture'&&r.iteration===7).content='wrong';f.append({type:'boundary'});}
  if(kind==='artifact')fs.appendFileSync(file(f,inv.distribution.copy),'changed');
  const q=kind==='authority'?inspect(['--design-bundled-constraints',f.designInventory,inventoryPath,'--complete']):inspect();
  fail(q,{'missing-lock':/ENOENT/,'omit-occurrence':/complete design occurrence inventory/,'phase-digest':/design inputsDigest/,artifact:/integrity mismatch/,authority:/no authority overrides/}[kind]);
 });
});


test('runtime-platform-eligibility-data-only-component',async t=>{
 const api=await import('../../scripts/enterprise/runtime-preparation.mjs');
 const location='node_modules/takt/node_modules/platform-fixture',host={os:'linux',cpu:'x64',libc:'glibc'};
 const evaluate=(pkg={},environment=host,archive=pkg)=>api.assessPackagePlatformEligibility(pkg,archive,location,environment);
 for(const [name,pkg,environment,eligible] of [
  ['undeclared',{},host,true],['positive-match',{os:['linux'],cpu:['x64'],libc:['glibc']},host,true],
  ['os-denied',{os:['darwin']},host,false],['cpu-denied',{cpu:['arm64']},host,false],['libc-denied',{libc:['musl']},host,false],
  ['negative-only-match',{os:['!win32']},host,true],['negative-only-denied',{os:['!linux']},host,false],
  ['deny-wins',{os:['linux','!linux']},host,false],['mixed-positive-required',{os:['darwin','!win32']},host,false],
  ['mixed-positive-match',{os:['linux','!win32']},host,true],['singleton-any',{os:['any'],cpu:['any'],libc:['any']},host,true],
  ['mixed-any-is-literal',{os:['any','!win32']},host,false],['unknown-libc-unrestricted',{}, {os:'darwin',cpu:'arm64',libc:null},true]
 ])await t.test(name,()=>{const result=evaluate(pkg,environment);assert.equal(result.eligible,eligible);assert.equal(result.platformSelectionProven,false);assert.equal(result.hostPlatformAuthenticated,false);assert.equal(result.dependencyClosureIntegrityProven,false);assert.equal(result.initializationAuthority,false);assert.deepEqual(result.currentApprovals,[]);assert.equal(result.checks.length,3);});
 await t.test('order-independent-and-no-input-mutation',()=>{const pkg=Object.freeze({os:Object.freeze(['!win32','linux']),cpu:Object.freeze(['x64'])}),archive={os:['linux','!win32'],cpu:['x64']};const before=JSON.stringify([pkg,archive,host]);assert.equal(evaluate(pkg,Object.freeze({...host}),archive).eligible,true);assert.equal(JSON.stringify([pkg,archive,host]),before);});
 for(const [name,pkg,environment,archive,re] of [
  ['declaration-mismatch',{os:['linux']},host,{os:['darwin']},/os.*mismatch/],
  ['missing-environment',{},undefined,{},/explicit platform/],['missing-os',{}, {cpu:'x64',libc:'glibc'}, {},/os/],
  ['missing-cpu',{}, {os:'linux',libc:'glibc'}, {},/cpu/],['unknown-libc',{libc:['any']},{os:'linux',cpu:'x64',libc:null},{libc:['any']},/libc.*unavailable/],
  ['no-short-circuit',{os:['darwin'],libc:['glibc']},{os:'linux',cpu:'x64',libc:null},{os:['darwin'],libc:['glibc']},/libc.*unavailable/],
  ['forged-authority',{}, {...host,platformSelectionProven:true},{},/unsupported platform field/],
  ['wildcard-host',{}, {...host,os:'any'},{},/os/],['negated-host',{}, {...host,cpu:'!arm64'},{},/cpu/],
  ['string-declaration',{os:'linux'},host,{os:'linux'},/platform list/],['empty-declaration',{os:[]},host,{os:[]},/platform list/],
  ['duplicate-declaration',{os:['linux','linux']},host,{os:['linux','linux']},/duplicate/],
  ['bad-selector',{os:['linux *']},host,{os:['linux *']},/invalid platform selector/]
 ])await t.test(name,()=>assert.throws(()=>api.assessPackagePlatformEligibility(pkg,archive,location,environment),re));
 await t.test('peer-obligations-remain',()=>{const pkg={peerDependenciesMeta:{optionalPeer:{optional:true}}};const result=evaluate(pkg);assert.equal(result.eligible,true);assert.equal(result.unresolved[0].reason,'PEER_DECLARATION_UNAVAILABLE');assert.equal(result.completeMigrationHistory,false);});
});

// Full history output must not require one V8-sized string or discard proofs.
test('runtime-json-stream-output',async t=>{
 const api=await import('../../scripts/enterprise/runtime-preparation.mjs');
 const {Writable}=await import('node:stream');const {constants}=await import('node:buffer');
 const collect=async value=>{const chunks=[];await api.writeRuntimeJson(value,new Writable({write(c,e,done){chunks.push(Buffer.from(c));done();}}));return Buffer.concat(chunks).toString('utf8');};
 await t.test('exact-pretty-json-shape-and-false-authority',async()=>{const value={kind:'SOURCE_REFERENCE_HISTORY',initializationAuthority:false,currentApprovals:[],completeMigrationHistory:false,proofs:[{path:'evidence/a',source:{sha256:'a'.repeat(64)}}],missing:[{consumer:{pointer:'/references/1'},searched:[]}],optional:undefined};assert.equal(await collect(value),JSON.stringify(value,null,2)+'\n');});
 await t.test('unicode-escaping-and-chunk-boundaries',async()=>{const value={text:'a'.repeat(65532)+'😀日本語\n\t"\\\ud800',values:['😀'.repeat(40000)]};assert.equal(await collect(value),JSON.stringify(value,null,2)+'\n');});
 await t.test('shared-objects-not-cycles-and-frozen-inputs',async()=>{const row=Object.freeze({a:Object.freeze([1,null,false])}),value=Object.freeze([row,row]);assert.equal(await collect(value),JSON.stringify(value,null,2)+'\n');});
 await t.test('empty-containers-and-scalar-json-semantics',async()=>{for(const value of [null,true,0,'',[],{},[undefined,NaN,Infinity,-0],{a:undefined,b:NaN}])assert.equal(await collect(value),JSON.stringify(value,null,2)+'\n');});
 await t.test('slow-sink-backpressure-and-final-flush',async()=>{const value=Array.from({length:1000},(_,i)=>({i,text:'x'.repeat(1000)})),d=createHash('sha256');let writes=0,maxQueued=0,finished=false;const sink=new Writable({highWaterMark:1024,write(c,e,done){writes++;maxQueued=Math.max(maxQueued,this.writableLength);d.update(c);setImmediate(done);},final(done){setImmediate(()=>{finished=true;done();});}});await api.writeRuntimeJson(value,sink);assert.equal(d.digest('hex'),hash(JSON.stringify(value,null,2)+'\n'));assert.ok(writes>1);assert.ok(maxQueued<=65536);assert.equal(finished,true);});
 await t.test('sink-write-error-propagates',async()=>{const sink=new Writable({write(c,e,done){done(new Error('synthetic sink failure'));}});await assert.rejects(()=>api.writeRuntimeJson({rows:Array(10000).fill('row')},sink),/synthetic sink failure/);});
 await t.test('sink-final-error-propagates',async()=>{const sink=new Writable({write(c,e,done){done();},final(done){done(new Error('synthetic final failure'));}});await assert.rejects(()=>api.writeRuntimeJson({ok:true},sink),/synthetic final failure/);});
 await t.test('cycle-rejected',async()=>{const value={};value.self=value;await assert.rejects(()=>collect(value),/circular/i);});
 await t.test('bigint-rejected',async()=>{await assert.rejects(()=>collect({value:1n}),/BigInt/i);});
 await t.test('full-output-larger-than-v8-string-limit',async()=>{const row='x'.repeat(16384),count=Math.ceil(constants.MAX_STRING_LENGTH/row.length)+1,rows=Array(count).fill(row),expected=createHash('sha256'),actual=createHash('sha256');expected.update('[\n');for(let i=0;i<count;i++)expected.update('  '+JSON.stringify(row)+(i===count-1?'\n':',\n'));expected.update(']\n');let bytes=0,maxChunk=0;await api.writeRuntimeJson(rows,new Writable({write(c,e,done){bytes+=c.length;maxChunk=Math.max(maxChunk,c.length);actual.update(c);done();}}));assert.ok(bytes>constants.MAX_STRING_LENGTH);assert.ok(maxChunk<=65536);assert.equal(actual.digest('hex'),expected.digest('hex'));});
});

// P0: independent successor authority, never an alias for the source guard.
// Uses the real TAKT compiler, registry, phase records and session store.
async function successorPreparationFixture(t){
 const f=await fixture(t,{seal:false,recovery:true});
 fs.copyFileSync(new URL('../../scripts/enterprise/runtime-preparation.mjs',import.meta.url),file(f,'scripts/enterprise/runtime-preparation.mjs'));
 const query=code=>ok(spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:f.root,env:f.env,encoding:'utf8'}));
 f.context('build-foundation',1);
 const source=query("import {currentContext} from './scripts/enterprise/context.mjs';console.log(JSON.stringify(await currentContext(process.cwd())));");
 const ref=path=>({path,sha256:hash(fs.readFileSync(file(f,path)))});
 put(file(f,'evidence/source-handoff.json'),{run:f.run.slug,iteration:1,builderSession:'builder-session',references:[]});
 const handoff=ref('evidence/source-handoff.json'),content=handoff.path+' '+handoff.sha256;
 for(const phase of [1,2])f.append({type:'phase_complete',step:'build-foundation',iteration:1,workflow:f.workflow.name,stack:f.stack('build-foundation'),phase,phaseExecutionId:'source:'+phase,status:'done',content});
 f.append({type:'step_complete',step:'build-foundation',iteration:1,workflow:f.workflow.name,stack:f.stack('build-foundation'),status:'done'});
 const endTime=new Date().toISOString();
 f.append({type:'workflow_abort',iterations:1,reason:'Max steps reached',endTime});
 const sm={...read(f.run.metaAbs),status:'failed',reason:'Max steps reached',endTime,iterations:1};put(f.run.metaAbs,sm);
 put(file(f,'evidence/source-meta.json'),sm);put(file(f,'evidence/source-log.jsonl'),fs.readFileSync(source.identity.logPath,'utf8'));
 put(file(f,'evidence/selection.json'),{batchId:'B00',inputsDigest:'historical-only',planText:fs.readFileSync(file(f,'work/enterprise/plan.json'),'utf8')});
 mutate(f,'work/enterprise/progress.json',p=>Object.assign(p,{runBinding:source.identity,entrySelection:'evidence/selection.json',entrySelectionHash:ref('evidence/selection.json').sha256,entryInputs:'historical-only'}));
 put(ip(f),{runs:[]});
 const checkpoint={progress:ref('work/enterprise/progress.json'),index:ref('evidence/enterprise/runs/index.json'),selection:ref('evidence/selection.json')};
 f.oldRun=f.nextRun('preparation-run');f.sourceIdentity=source.identity;
 for(const p of ['PREPARATION_ENTRY','RUNTIME_DELIVERY','RUNTIME_CONTINUATION'])put(file(f,'work/enterprise/'+p+'.md'),'synthetic '+p);
 put(file(f,'evidence/entry.json'),{schemaVersion:1,runSlug:f.run.slug});
 const runtime=source.identity.runtime;
 const entry={schemaVersion:1,contract:'work/enterprise/PREPARATION_ENTRY.md',runSlug:f.run.slug,sourceRunSlug:f.oldRun.slug,purpose:'PREPARE_SUCCESSOR_HISTORY_COMPONENTS',permission:'PREPARATION_AND_HISTORY_ONLY',attestation:'enterprise-continuation-preparation-attestation',runtimeVersion:runtime.version,isAuthorizedMigrationTarget:false,currentApprovals:[],initializationAuthority:false,targetLaunchAuthority:false,runtimeReplacementAuthority:false,sourceCheckpoint:checkpoint,latestHandoff:handoff,sourceMetaSnapshot:'evidence/source-meta.json',permittedPaths:['scripts/enterprise/runtime-preparation.mjs','tests/enterprise/rejected-regeneration.test.mjs'],increments:['P0','P1','P2','P3','R1b','R2','R3','R4']};
 mutate(f,'work/enterprise/plan.json',p=>p.preparationEntry=entry);
 f.reviewManifest='evidence/review-inputs.json';
 const m=query("import {inputs} from './scripts/enterprise/evidence.mjs';console.log(JSON.stringify(inputs(process.cwd())));");put(file(f,f.reviewManifest),m);
 const c=query("import {currentContext} from './scripts/enterprise/context.mjs';console.log(JSON.stringify(await currentContext(process.cwd())));");
 f.successorAttestation={schemaVersion:1,verdict:'APPROVE',purpose:entry.purpose,permission:entry.permission,runSlug:f.run.slug,workflowRef:c.identity.workflowRef,bundleDigest:c.identity.bundleDigest,step:'review-architecture',iteration:2,sessionKey:'enterprise-architecture-reviewer',providerSessionId:'designer-session',runtimeVersion:runtime.version,contractPath:entry.contract,contractSha256:ref(entry.contract).sha256,runtimeDeliveryContract:ref('work/enterprise/RUNTIME_DELIVERY.md'),runtimeContinuationContract:ref('work/enterprise/RUNTIME_CONTINUATION.md'),planSha256:ref('work/enterprise/plan.json').sha256,inputsDigest:m.digest,entryManifest:ref('evidence/entry.json'),sourceRunSlug:f.oldRun.slug,sourceCheckpoint:checkpoint,latestSourceHandoff:handoff,sourceMetaSnapshot:ref('evidence/source-meta.json'),sourceLogSnapshot:ref('evidence/source-log.jsonl'),permittedIncrements:['P0','P1','P2','P3','R1b'],permittedPaths:entry.permittedPaths,currentApprovals:[],initializationAuthority:false,targetLaunchAuthority:false,runtimeReplacementAuthority:false,unresolvedFindings:[]};
 phases(f,'review-architecture',2,fenced('enterprise-continuation-preparation-attestation',f.successorAttestation));
 f.context('build-foundation',3);
 return f;
}
function successorRead(f,extra=[]){
 const before=tree(f.temporary);
 const q=spawnSync(process.execPath,['--import',f.guardPath,file(f,'scripts/enterprise/runtime-preparation.mjs'),'--successor-preparation',f.reviewManifest,...extra],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000});
 assert.deepEqual(tree(f.temporary),before);return q;
}
function rewriteSuccessorAttestation(f,edit){
 const a=structuredClone(f.successorAttestation);edit(a);const text=fenced('enterprise-continuation-preparation-attestation',a);
 for(const r of f.records.filter(r=>r.step==='review-architecture'&&r.type==='phase_complete'))r.content=text;
 f.append({type:'boundary'});put(join(f.run.reportsAbs,'enterprise-02-review.md'),text+'\n');
}
test('successor-preparation-independent-authority-guard',async t=>{
 const f=await successorPreparationFixture(t),reset=restorePoint(f);
 await t.test('real compiler phase and session authority keeps source separate',()=>{
  const r=JSON.parse(successorRead(f).stdout);assert.equal(r.preparationRunSlug,'preparation-run');assert.equal(r.sourceRunSlug,'fixture-run');
  assert.equal(r.preparationAuthorityAuthenticated,true);assert.equal(r.sourceCheckpointBound,true);
  for(const k of ['completeMigrationHistory','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority','historicalSessionsAuthenticated','exclusiveWriterProven'])assert.equal(r[k],false);
  assert.deepEqual(r.currentApprovals,[]);assert.equal(r.sourceTerminal.iterations,1);
 });
 for(const kind of ['foreign-run','old-purpose','same-session','permission','launch','extra-authority','wrong-runtime','paths','checkpoint-hash','manifest-digest'])await t.test(kind+' is rejected without writes',()=>{
  reset();rewriteSuccessorAttestation(f,a=>{
   if(kind==='foreign-run')a.runSlug=f.oldRun.slug;
   if(kind==='old-purpose')a.purpose='PREPARE_DISTINCT_RUN_CONTINUATION';
   if(kind==='same-session')a.providerSessionId='builder-session';
   if(kind==='permission')a.permission='INITIALIZE';
   if(kind==='launch')a.targetLaunchAuthority=true;
   if(kind==='extra-authority')a.targetRunSlug='invented';
   if(kind==='wrong-runtime')a.runtimeVersion='unknown';
   if(kind==='paths')a.permittedPaths.push('src/domain.mjs');
   if(kind==='checkpoint-hash')a.sourceCheckpoint.progress.sha256='0'.repeat(64);
   if(kind==='manifest-digest')a.inputsDigest='0'.repeat(64);
  });fail(successorRead(f),/successor|preparation|independent|changed/i);
 });
 for(const kind of ['incomplete','phase','canonical','later-review','review-order','actual-session','writer-routing','source-impersonation'])await t.test(kind+' is rejected without writes',()=>{
  reset();
  if(kind==='incomplete'){f.records.find(r=>r.type==='step_complete'&&r.step==='review-architecture').status='error';f.append({type:'boundary'});}
  if(kind==='phase'){f.records.find(r=>r.type==='phase_complete'&&r.step==='review-architecture').content+='\ninvalid';const r=f.records.find(r=>r.type==='phase_complete'&&r.step==='review-architecture');r.content=r.content.replace('APPROVE','REQUEST_CHANGES');f.append({type:'boundary'});}
  if(kind==='canonical')fs.appendFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'),'changed');
  if(kind==='later-review'){f.context('review-architecture',4);f.context('build-foundation',5);}
  if(kind==='review-order'){const i=f.records.findIndex(r=>r.type==='phase_complete'&&r.step==='review-architecture');[f.records[i],f.records[i+1]]=[f.records[i+1],f.records[i]];f.append({type:'boundary'});}
  if(kind==='actual-session'){const s={...f.sessions,[JSON.stringify(['enterprise-architecture-reviewer','codex','gpt-6-astra'])]:'builder-session'};savePersonaSessions(f.root,s,'codex',f.paths.sessionsDirectory);}
  if(kind==='writer-routing'){f.records.findLast(r=>r.type==='step_start').model='gpt-6.1-sol';f.append({type:'boundary'});}
  if(kind==='source-impersonation'){mutate(f,'work/enterprise/progress.json',p=>p.runBinding.runSlug=f.run.slug);}
  fail(successorRead(f));
 });
 for(const path of ['work/enterprise/PREPARATION_ENTRY.md','work/enterprise/plan.json','work/enterprise/progress.json','evidence/enterprise/runs/index.json','evidence/selection.json','evidence/source-handoff.json','evidence/source-meta.json','evidence/source-log.jsonl','evidence/entry.json','src/domain.mjs'])
 await t.test('changed '+path+' is rejected without writes',()=>{reset();fs.appendFileSync(file(f,path),' ');fail(successorRead(f));});
 await t.test('live source checkpoint differs from attested snapshot',()=>{reset();fs.appendFileSync(f.oldRun.metaAbs,' ');fail(successorRead(f),/source.*checkpoint|changed/i);});
 await t.test('live source log differs from attested snapshot',()=>{reset();fs.appendFileSync(f.sourceIdentity.logPath,'\n');fail(successorRead(f),/source.*checkpoint|changed/i);});
 await t.test('review input manifest tamper',()=>{reset();mutate(f,f.reviewManifest,m=>m.entries.pop());fail(successorRead(f),/manifest/);});
 await t.test('allowed implementation edit has no approval or origin authority',()=>{
  reset();fs.appendFileSync(file(f,'scripts/enterprise/runtime-preparation.mjs'),'\n// permitted fixture edit\n');
  const r=JSON.parse(successorRead(f).stdout);assert.deepEqual(r.changedPaths,['scripts/enterprise/runtime-preparation.mjs']);assert.equal(r.executionOriginProven,false);assert.deepEqual(r.currentApprovals,[]);
 });
 await t.test('fixture and authority CLI overrides rejected',()=>{reset();fail(successorRead(f,['--fixture']),/authority overrides/);});
 await t.test('active gate writer blocks preparation without writes',()=>{reset();put(file(f,'evidence/enterprise/gate.lock'),'synthetic writer');fail(successorRead(f),/gate writer/);});
 await t.test('checkpoint changes during assessment invalidate diagnostic',()=>{
  reset();const hook=join(f.temporary,'changed-read.mjs');
  put(hook,"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const read=fs.readFileSync;let count=0;fs.readFileSync=function(path,...args){const value=read.call(this,path,...args);if(String(path)==="+JSON.stringify(pp(f))+"&&++count>1)return Buffer.concat([Buffer.from(value),Buffer.from(' ')]);return value;};syncBuiltinESMExports();");
  const before=tree(f.temporary),r=spawnSync(process.execPath,['--import',f.guardPath,'--import',hook,file(f,'scripts/enterprise/runtime-preparation.mjs'),'--successor-preparation',f.reviewManifest],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000});
  fail(r,/concurrent successor reference/);assert.equal(r.stdout,'');assert.deepEqual(tree(f.temporary),before);
 });
 await t.test('legacy source guard and ordinary gate still refuse successor',t=>{
  reset();fail(preparationRead(f));const progress=fs.readFileSync(pp(f)),selection=fs.readFileSync(file(f,'evidence/selection.json')),before=read(ip(f)).runs.length;
  const result=f.cli(['batch'],{readonly:false}),after=read(pp(f));
  t.diagnostic(JSON.stringify({kind:'FOREIGN_RUN_B00_GATE_REPRODUCTION',currentRun:f.run.slug,progressRun:after.runBinding.runSlug,exitCode:result.status,progressChanged:hash(progress)!==hash(fs.readFileSync(pp(f))),newReceipts:read(ip(f)).runs.length-before,gateStatus:after.lastGate?.status,stdout:result.stdout,stderr:result.stderr}));
  fail(result,/run|context|bound|binding|preparation|selection/i);assert.deepEqual(fs.readFileSync(pp(f)),progress);assert.deepEqual(fs.readFileSync(file(f,'evidence/selection.json')),selection);
 });
});

// Q's read-only boundary uses three real isolated registry runs. This first
// slice does not claim QR3 diagnostic publication, QR5 native or QR6 writers.
async function componentDevelopmentFixture(t,{regressions=false}={}){
 const f=await successorPreparationFixture(t),query=code=>ok(spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:f.root,env:f.env,encoding:'utf8'}));
 const ref=path=>({path,sha256:hash(fs.readFileSync(file(f,path)))}),predecessor=f.run.slug,source=f.oldRun.slug;
 const terminal={type:'workflow_abort',iterations:3,reason:'Max steps reached',endTime:new Date().toISOString()};f.append(terminal);
 put(f.run.metaAbs,{...read(f.run.metaAbs),status:'failed',iterations:3,reason:terminal.reason,endTime:terminal.endTime});
 const prep=`evidence/enterprise/preparation/${predecessor}`;
 for(const [p,v]of Object.entries({'journal.json':{schemaVersion:1,events:[{attempt:7,status:'RUNNING'}]},'writer.lock':{runSlug:predecessor,owner:'predecessor-owner'},'request.json':{attempt:7},'acceptances.json':{historical:true},'attempts/7/start.json':{attempt:7}}))put(file(f,prep+'/'+p),v);
 put(join(f.run.reportsAbs,'build.md'),'synthetic predecessor build');
 const originalPaths=[f.run.metaAbs,join(f.run.logsAbs,'fixture.jsonl'),join(f.run.reportsAbs,'build.md'),join(f.run.reportsAbs,'enterprise-02-review.md'),...['journal.json','writer.lock','request.json','acceptances.json','attempts/7/start.json'].map(p=>prep+'/'+p)];
 const refs=originalPaths.map((originalPath,i)=>{const raw=fs.readFileSync(originalPath.startsWith('/')?originalPath:file(f,originalPath)),path=`evidence/restart-checkpoint/${i}.json`;put(file(f,path),raw.toString());return {...ref(path),bytes:raw.length,originalPath};});
 f.predecessor=f.nextRun('component-run');f.prep=prep;
 put(file(f,'work/enterprise/PREPARATION_RESTART.md'),'synthetic restart contract');
 put(file(f,'evidence/restart-checkpoint.json'),{schemaVersion:1,kind:'PREPARATION_PREDECESSOR_CHECKPOINT',runSlug:f.run.slug,predecessorRunSlug:predecessor,sourceRunSlug:source,references:refs,terminal:{status:'failed',iterations:3,reason:terminal.reason,endTime:terminal.endTime,log:terminal},allWritersStopped:false,hostExclusionProven:false,completeH:false,initializationAuthority:false,currentApprovals:[]});
 if(regressions){
  for(const name of componentRegressionFiles)put(file(f,'tests/enterprise/'+name),"import test from 'node:test';import assert from 'node:assert/strict';test("+JSON.stringify('isolated '+name)+",()=>assert.equal(2+2,4));\n");
  for(const name of ['adapter-trace','model-smoke'])put(file(f,'evidence/'+name+'.json'),{synthetic:name});
  mutate(f,'work/enterprise/plan.json',p=>p.protectedFiles=['adapter-trace','model-smoke'].map(name=>ref('evidence/'+name+'.json')));
 }
 const paths=['work/enterprise/progress.json','evidence/enterprise/runs/index.json','evidence/selection.json',...(regressions?['evidence/adapter-trace.json','evidence/model-smoke.json']:[])];
 const entries=paths.map((path,i)=>{const raw=fs.readFileSync(file(f,path)),copy=`evidence/restart-entry/${i}.json`;put(file(f,copy),raw.toString());return {...ref(path),bytes:raw.length,copy};});
 put(file(f,'evidence/restart-entry.json'),{schemaVersion:1,runSlug:f.run.slug,entries});
 const permittedPaths=['scripts/enterprise/runtime-preparation.mjs','scripts/enterprise/preparation-producer-linux.c','tests/enterprise/rejected-regeneration.test.mjs','tests/enterprise/evidence-fixture.mjs','tests/enterprise/continuation.test.mjs','tests/enterprise/continuation-v4.test.mjs'];
 const denied={captureAuthority:false,recoveryAuthority:false,initializationAuthority:false,targetLaunchAuthority:false,runtimeReplacementAuthority:false};
 const entry={schemaVersion:1,contract:'work/enterprise/PREPARATION_RESTART.md',runSlug:f.run.slug,predecessorRunSlug:predecessor,sourceRunSlug:source,purpose:'PREPARE_CONTAINMENT_COMPONENTS',permission:'IMPLEMENTATION_AND_ISOLATED_TESTS_ONLY',attestation:'enterprise-preparation-restart-attestation',runtimeVersion:f.successorAttestation.runtimeVersion,permittedPaths,currentApprovals:[],...denied,ordinaryBatchAuthority:false,completeH:false,entrySnapshot:'evidence/restart-entry.json',sourceCheckpoint:ref('evidence/restart-checkpoint.json'),diagnosticNamespace:`evidence/enterprise/component-development/${f.run.slug}/`};
 if(regressions)entry.regressionCommand=['mise','exec','--','node','--test','--test-reporter=tap',...componentRegressionFiles.map(n=>'tests/enterprise/'+n)];
 mutate(f,'work/enterprise/plan.json',p=>p.preparationRestart=entry);
 const m=query("import {inputs} from './scripts/enterprise/evidence.mjs';console.log(JSON.stringify(inputs(process.cwd())));");put(file(f,'evidence/restart-inputs.json'),m);
 const c=query("import {currentContext} from './scripts/enterprise/context.mjs';console.log(JSON.stringify(await currentContext(process.cwd())));");
 f.restartAttestation={schemaVersion:1,verdict:'APPROVE',purpose:entry.purpose,permission:entry.permission,runSlug:f.run.slug,workflowRef:c.identity.workflowRef,bundleDigest:c.identity.bundleDigest,step:'review-architecture',iteration:2,sessionKey:'enterprise-architecture-reviewer',providerSessionId:'designer-session',runtimeVersion:c.identity.runtime.version,runtimeIdentity:c.identity.runtime,contractPath:entry.contract,contractSha256:ref(entry.contract).sha256,planSha256:ref('work/enterprise/plan.json').sha256,reviewInputsDigest:m.digest,reviewInputsManifest:ref('evidence/restart-inputs.json'),entryManifest:ref(entry.entrySnapshot),sourceCheckpoint:entry.sourceCheckpoint,permittedPaths,currentApprovals:[],...denied};
 phases(f,'review-architecture',2,fenced('enterprise-preparation-restart-attestation',f.restartAttestation));f.context('build-foundation',3);return f;
}
function componentDevelopmentRead(f,args=['--inspect-component-development'],imports=[]){
 const before=tree(f.temporary),r=spawnSync(process.execPath,['--import',f.guardPath,...imports.flatMap(p=>['--import',p]),file(f,'scripts/enterprise/runtime-preparation.mjs'),...args],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000});
 assert.deepEqual(tree(f.temporary),before);assert.doesNotMatch(r.stderr,/FS_MUTATION/);return r;
}
function rewriteRestartAttestation(f,edit){
 const a=structuredClone(f.restartAttestation);edit(a);const text=fenced('enterprise-preparation-restart-attestation',a);
 for(const r of f.records.filter(r=>r.step==='review-architecture'&&r.type==='phase_complete'))r.content=text;
 f.append({type:'boundary'});put(join(f.run.reportsAbs,'enterprise-02-review.md'),text+'\n');
}
test('component-development-readonly-authority-boundary',async t=>{
 const f=await componentDevelopmentFixture(t),reset=restorePoint(f);
 await t.test('QR1 real compiler context independent sessions and completed phases',()=>{
  const result=componentDevelopmentRead(f);assert.equal(result.status,0,result.stderr);const r=JSON.parse(result.stdout);assert.equal(r.runSlug,'component-run');assert.equal(r.implementationAuthorityAuthenticated,true);assert.equal(r.sourceCheckpointBound,true);assert.deepEqual(r.changedPaths,[]);assert.equal(r.builderSession,'builder-session');assert.equal(r.reviewSession,'designer-session');
  for(const k of ['captureAuthority','recoveryAuthority','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority','ordinaryBatchAuthority','completeH','nativeAcceptance'])assert.equal(r[k],false);assert.deepEqual(r.currentApprovals,[]);
 });
 const mutations=[
  ['predecessor run',a=>a.runSlug=f.predecessor.slug,/restart runSlug/],['foreign bundle',a=>a.bundleDigest='0'.repeat(64),/restart bundleDigest/],['foreign workflow',a=>a.workflowRef='other',/restart workflowRef/],
  ['old permission',a=>a.permission='PREPARATION_AND_HISTORY_ONLY',/restart permission/],['same claimed session',a=>a.providerSessionId='builder-session',/restart providerSessionId/],
  ['unknown schema',a=>a.schemaVersion=2,/restart schemaVersion/],['public trust token',a=>a.authorityToken='allow',/restart attestation fields/],
  ['runtime identity',a=>a.runtimeIdentity.version='unknown',/restart runtime identity/],['checkpoint digest',a=>a.sourceCheckpoint.sha256='0'.repeat(64),/restart source checkpoint locator/],
  ['unreviewed permitted path',a=>a.permittedPaths.push('src/domain.mjs'),/restart plan permittedPaths/],
  ...['captureAuthority','recoveryAuthority','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority'].map(k=>[k,a=>a[k]=true,new RegExp('restart '+k)])
 ];
 for(const [name,edit,re]of mutations)await t.test('QR2 '+name+' refuses before output or lock',()=>{reset();rewriteRestartAttestation(f,edit);const r=componentDevelopmentRead(f);fail(r,re);assert.equal(r.stdout,'');});
 for(const kind of ['incomplete','phase','canonical','actual-session','builder-model','builder-effort','review-model','review-effort'])await t.test('QR2 '+kind+' provenance',()=>{
  reset();let re=/preparation|restart|context|independent/;
  if(kind==='incomplete'){f.records.find(r=>r.type==='step_complete'&&r.step==='review-architecture').status='error';re=/incomplete preparation occurrence/;}
  if(kind==='phase'){f.records.find(r=>r.type==='phase_complete'&&r.step==='review-architecture').content=fenced('enterprise-preparation-restart-attestation',{...f.restartAttestation,verdict:'REQUEST_CHANGES'});re=/restart review phases differ/;}
  if(kind==='canonical'){fs.appendFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'),'changed');re=/restart canonical report mismatch/;}
  if(kind==='actual-session'){savePersonaSessions(f.root,{...f.sessions,[JSON.stringify(['enterprise-architecture-reviewer','codex','gpt-6-astra'])]:'builder-session'},'codex',f.paths.sessionsDirectory);re=/independent review session/;}
  if(kind.startsWith('builder-')||kind.startsWith('review-')){const r=f.records.findLast(r=>r.type==='step_start'&&r.step===(kind.startsWith('builder')?'build-foundation':'review-architecture'));if(kind.endsWith('model'))r.model='gpt-6.1-sol';else r.providerOptions.codex.reasoningEffort='low';}
  f.append({type:'boundary'});fail(componentDevelopmentRead(f),re);
 });
 for(const path of ['work/enterprise/PREPARATION_RESTART.md','work/enterprise/plan.json','src/domain.mjs','evidence/restart-inputs.json','evidence/restart-entry.json','evidence/restart-checkpoint.json','work/enterprise/progress.json','evidence/enterprise/runs/index.json','evidence/selection.json'])await t.test('QR3 changed '+path,()=>{reset();fs.appendFileSync(file(f,path),' ');fail(componentDevelopmentRead(f),/restart changed reference|restart unreviewed input/);});
 await t.test('QR3 permitted source edit remains implementation-only',()=>{reset();fs.appendFileSync(file(f,'scripts/enterprise/runtime-preparation.mjs'),'\n// isolated permitted edit\n');const result=componentDevelopmentRead(f);assert.equal(result.status,0,result.stderr);const r=JSON.parse(result.stdout);assert.deepEqual(r.changedPaths,['scripts/enterprise/runtime-preparation.mjs']);assert.equal(r.captureAuthority,false);});
 await t.test('QR3 missing checkpoint fails closed',()=>{reset();fs.unlinkSync(file(f,'evidence/restart-checkpoint.json'));fail(componentDevelopmentRead(f),/ENOENT/);});
 await t.test('QR3 changed live predecessor is not repaired from copy',()=>{reset();fs.appendFileSync(f.predecessor.metaAbs,' ');fail(componentDevelopmentRead(f),/restart original checkpoint changed/);});
 await t.test('QR3 checkpoint changes after await prevent publication',()=>{
  reset();const hook=join(f.temporary,'restart-concurrent.mjs');put(hook,"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const read=fs.readFileSync;let n=0;fs.readFileSync=function(p,...a){const r=read.call(this,p,...a);return String(p)==="+JSON.stringify(file(f,'evidence/restart-checkpoint.json'))+"&&++n>=3?Buffer.concat([Buffer.from(r),Buffer.from(' ')]):r;};syncBuiltinESMExports();");const r=componentDevelopmentRead(f,['--inspect-component-development'],[hook]);fail(r,/restart concurrent reference/);assert.equal(r.stdout,'');
 });
 for(const arg of ['--capture-component','--recover-preparation-capture','--import-component-review','--initialize-run','--activate-backend','--fixture'])await t.test('QR4 no operation or token override '+arg,()=>{reset();fail(componentDevelopmentRead(f,['--inspect-component-development',arg]),/preparation accepts no authority overrides/);});
 for(const path of [f.prep+'/attempts/8',f.prep+'/recovery.lock',f.prep+'/attempts/7/receipt.json','evidence/enterprise/preparation/component-run'])await t.test('QR4 forbidden state '+path,()=>{reset();put(file(f,path),'synthetic bypass');fail(componentDevelopmentRead(f),/restart forbidden state exists/);});
 await t.test('QR4 old successor approval cannot authenticate new entry',()=>{reset();rewriteSuccessorAttestation(f,()=>{});fail(componentDevelopmentRead(f),/single enterprise-preparation-restart-attestation/);});
 await t.test('QR4 new entry does not relax old successor guard',()=>{reset();fail(successorRead(f),/single enterprise-continuation-preparation-attestation/);});
 await t.test('QR4 implementation guard is not a public capability API',async()=>{const api=await import('../../scripts/enterprise/runtime-preparation.mjs');assert.equal(api.inspectComponentDevelopment,undefined);});
 await t.test('QR3 active product writer rejected without touching fence',()=>{reset();put(file(f,'evidence/enterprise/gate.lock'),'other writer');fail(componentDevelopmentRead(f),/restart gate writer active/);});
});

const componentRegressionFiles=['evidence.test.mjs','ENT-101.test.mjs','finalization.test.mjs','continuation.test.mjs','continuation-v4.test.mjs','rejected-regeneration.test.mjs','closure-review.test.mjs'];
function componentWrite(f,hook){return spawnSync(process.execPath,[...(hook?['--import',hook]:[]),file(f,'scripts/enterprise/runtime-preparation.mjs'),'--test-component-development'],{cwd:f.root,env:f.env,encoding:'utf8',timeout:90000});}
function componentHook(f,name,code){const p=join(f.temporary,name+'.mjs');put(p,code+'\n');return p;}
function componentOutputs(f){const p=file(f,'evidence/enterprise/component-development/'+f.run.slug);return fs.existsSync(p)?fs.readdirSync(p).map(n=>join(p,n)):[];}
function componentPreserved(f){const prefix='/'+f.root.slice(f.temporary.length+1)+'/evidence/enterprise/component-development';return tree(f.temporary).filter(e=>e.bytes!==null&&!e.path.startsWith(prefix));}
test('component-development-diagnostic-writer-boundary',async t=>{
 const f=await componentDevelopmentFixture(t,{regressions:true}),reset=restorePoint(f);
 await t.test('QR3 QR6 real fixed seven-file command records exact immutable diagnostics only',()=>{
  const before=componentPreserved(f),r=componentWrite(f);assert.equal(r.status,0,r.stderr);const d=JSON.parse(r.stdout),base=file(f,d.execution.path).replace(/\/execution.json$/,'');
  assert.equal(d.kind,'ISOLATED_COMPONENT_REGRESSION_DIAGNOSTIC');assert.equal(d.tap.tests,7);assert.equal(read(join(base,'execution.json')).status,0);assert.equal(fs.existsSync(join(base,'failure.json')),false);
  for(const k of ['captureAuthority','recoveryAuthority','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority','ordinaryBatchAuthority','completeH','nativeAcceptance'])assert.equal(d[k],false);assert.deepEqual(d.currentApprovals,[]);
  for(const ref of d.artifacts){const raw=fs.readFileSync(file(f,ref.path));assert.equal(hash(raw),ref.sha256);assert.equal(raw.length,ref.bytes);}
  const first=tree(base);const again=componentWrite(f);assert.equal(again.status,0,again.stderr);assert.deepEqual(tree(base),first);assert.equal(componentOutputs(f).length,2);
  assert.deepEqual(componentPreserved(f),before);
 });

 for(const arg of ['--output=/tmp/elsewhere','--command=true','--capture-component','--recover-preparation-capture','--initialize-run','--fixture','--authority-token=allow'])await t.test('QR2 QR4 writer refuses override '+arg,()=>{reset();fail(componentDevelopmentRead(f,['--test-component-development',arg]),/preparation accepts no authority overrides/);assert.deepEqual(componentOutputs(f),[]);});
 await t.test('QR2 forged approval refuses before mkdir and subprocess',()=>{reset();rewriteRestartAttestation(f,a=>a.runSlug='old-run');fail(componentDevelopmentRead(f,['--test-component-development']),/restart runSlug/);assert.deepEqual(componentOutputs(f),[]);});
 await t.test('QR3 reviewed command cannot become arbitrary subprocess',()=>{
  reset();mutate(f,'work/enterprise/plan.json',p=>p.preparationRestart.regressionCommand=['node','-e','process.exit(0)']);
  const m=ok(spawnSync(process.execPath,['--input-type=module','-e',"import {inputs} from './scripts/enterprise/evidence.mjs';console.log(JSON.stringify(inputs(process.cwd())));"],{cwd:f.root,env:f.env,encoding:'utf8'}));put(file(f,'evidence/restart-inputs.json'),m);
  rewriteRestartAttestation(f,a=>{a.planSha256=hash(fs.readFileSync(file(f,'work/enterprise/plan.json')));a.reviewInputsDigest=m.digest;a.reviewInputsManifest.sha256=hash(fs.readFileSync(file(f,'evidence/restart-inputs.json')));});
  fail(componentDevelopmentRead(f,['--test-component-development']),/component fixed regression command/);assert.deepEqual(componentOutputs(f),[]);
 });
 await t.test('QR3 caller Node environment override refuses without output',()=>{
  reset();const before=tree(f.temporary),r=spawnSync(process.execPath,[file(f,'scripts/enterprise/runtime-preparation.mjs'),'--test-component-development'],{cwd:f.root,env:{...f.env,NODE_OPTIONS:'--no-warnings'},encoding:'utf8'});fail(r,/component Node environment override/);assert.deepEqual(tree(f.temporary),before);
 });
 for(const mode of ['fail','skip'])await t.test('QR6 '+mode+' regression retains command evidence and never reports success',()=>{
  reset();put(file(f,'tests/enterprise/rejected-regeneration.test.mjs'),mode==='fail'?"import test from 'node:test';test('deliberate failure',()=>{throw Error('synthetic failure');});":"import test from 'node:test';test.skip('deliberate skip',()=>{});");
  const before=componentPreserved(f),r=componentWrite(f);fail(r,mode==='fail'?/component tests failed/:/zero assertions or incomplete TAP|TAP skipped|failed\/skip TAP/);const [base]=componentOutputs(f);assert.equal(fs.existsSync(join(base,'diagnostic.json')),false);assert.equal(read(join(base,'failure.json')).complete,false);assert.equal(read(join(base,'execution.json')).status,mode==='fail'?1:0);assert.ok(fs.statSync(join(base,'stdout.tap')).size>0);assert.deepEqual(componentPreserved(f),before);
 });
 const uuid='11111111-1111-4111-8111-111111111111',fixed="import crypto from 'node:crypto';import {syncBuiltinESMExports} from 'node:module';crypto.randomUUID=()=>"+JSON.stringify(uuid)+";syncBuiltinESMExports();";
 await t.test('QR6 exclusive invocation refuses an existing owner without overwriting bytes',()=>{
  reset();const hook=componentHook(f,'fixed-owner',fixed),first=componentWrite(f,hook);assert.equal(first.status,0,first.stderr);const before=tree(f.temporary),again=componentWrite(f,hook);fail(again,/EEXIST/);assert.deepEqual(tree(f.temporary),before);
 });
 await t.test('QR6 simultaneous contenders have exactly one owner and preserve the loser evidence boundary',async()=>{
  reset();const hook=componentHook(f,'contenders',fixed),run=()=>new Promise(resolveResult=>{const c=spawn(process.execPath,['--import',hook,file(f,'scripts/enterprise/runtime-preparation.mjs'),'--test-component-development'],{cwd:f.root,env:f.env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';c.stdout.on('data',b=>stdout+=b);c.stderr.on('data',b=>stderr+=b);c.once('close',status=>resolveResult({status,stdout,stderr}));});
  const before=componentPreserved(f),results=await Promise.all([run(),run()]);assert.deepEqual(results.map(r=>r.status).sort(),[0,1]);assert.match(results.find(r=>r.status===1).stderr,/EEXIST/);assert.equal(componentOutputs(f).length,1);assert.equal(fs.existsSync(join(componentOutputs(f)[0],'failure.json')),false);assert.deepEqual(componentPreserved(f),before);
 });
 for(const change of ['checkpoint','context','input','owner'])await t.test('QR3 QR6 '+change+' changes during child execution forbid publication',()=>{
  reset();let fault;
  if(change==='checkpoint')fault="fs.appendFileSync("+JSON.stringify(file(f,'evidence/restart-checkpoint.json'))+",' ');";
  if(change==='context')fault="fs.appendFileSync("+JSON.stringify(join(f.run.logsAbs,'fixture.jsonl'))+",JSON.stringify({type:'boundary',reason:'concurrent writer'})+'\\n');";
  if(change==='input')fault="fs.appendFileSync("+JSON.stringify(file(f,'tests/enterprise/continuation.test.mjs'))+",'\\n// changed during tests\\n');";
  if(change==='owner')fault="const base="+JSON.stringify(file(f,'evidence/enterprise/component-development/'+f.run.slug))+";const p=base+'/'+fs.readdirSync(base)[0]+'/owner.json';fs.writeFileSync(p,'foreign owner');";
  const hook=componentHook(f,'fault-'+change,"import fs from 'node:fs';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const spawn=cp.spawn;cp.spawn=function(...args){const c=spawn(...args);"+fault+"return c;};syncBuiltinESMExports();"),r=componentWrite(f,hook);
  fail(r,/restart changed reference|component authority changed|component artifact (changed|length)/);const [base]=componentOutputs(f);assert.equal(fs.existsSync(join(base,'diagnostic.json')),false);assert.equal(fs.existsSync(join(base,'failure.json')),false);assert.ok(fs.existsSync(join(base,'start.json')));assert.ok(fs.existsSync(join(base,'stdout.tap')));if(change==='owner')assert.equal(fs.readFileSync(join(base,'owner.json'),'utf8'),'foreign owner');
 });
 for(const boundary of ['stdout.tap','diagnostic.json'])await t.test('QR6 SIGKILL at '+boundary+' retains partial bytes and next invocation cannot adopt them',()=>{
  reset();const hook=componentHook(f,'interrupt-'+boundary,"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const open=fs.openSync;fs.openSync=function(p,...a){if(String(p).endsWith('/"+boundary+"')&&a[0]==='wx')process.kill(process.pid,'SIGKILL');return open(p,...a);};syncBuiltinESMExports();"),before=componentPreserved(f),r=componentWrite(f,hook);assert.equal(r.signal,'SIGKILL');assert.equal(r.status,null);const [base]=componentOutputs(f);assert.ok(fs.existsSync(join(base,'owner.json')));assert.ok(fs.existsSync(join(base,'start.json')));assert.equal(fs.existsSync(join(base,'diagnostic.json')),false);const partial=tree(base);const next=componentWrite(f);assert.equal(next.status,0,next.stderr);assert.deepEqual(tree(base),partial);assert.deepEqual(componentPreserved(f),before);
 });
 await t.test('QR6 SIGTERM during isolated command is not a successful diagnostic',()=>{
  reset();const hook=componentHook(f,'term',"import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const spawn=cp.spawn;cp.spawn=function(...a){const c=spawn(...a);process.kill(process.pid,'SIGTERM');return c;};syncBuiltinESMExports();"),r=componentWrite(f,hook);fail(r,/component interrupted/);const [base]=componentOutputs(f);assert.equal(read(join(base,'execution.json')).interrupted,'SIGTERM');assert.equal(fs.existsSync(join(base,'diagnostic.json')),false);assert.equal(read(join(base,'failure.json')).complete,false);
 });
 await t.test('QR6 stream fsync failure is retained and cannot become a success',()=>{
  reset();const hook=componentHook(f,'fsync-failure',"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const open=fs.openSync,sync=fs.fsyncSync;let target;fs.openSync=function(p,...a){const fd=open(p,...a);if(String(p).endsWith('/stdout.tap')&&a[0]==='wx')target=fd;return fd;};fs.fsyncSync=function(fd){if(fd===target)throw Error('synthetic stream fsync failure');return sync(fd);};syncBuiltinESMExports();"),r=componentWrite(f,hook);fail(r,/synthetic stream fsync failure/);const [base]=componentOutputs(f);assert.ok(fs.statSync(join(base,'stdout.tap')).size>0);assert.equal(fs.existsSync(join(base,'diagnostic.json')),false);assert.equal(read(join(base,'failure.json')).complete,false);
 });

 await t.test('QR6 asynchronous stream write failure cannot publish a successful diagnostic',()=>{
  reset();const hook=componentHook(f,'write-failure',"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const open=fs.openSync,write=fs.writeFileSync;let target;fs.openSync=function(p,...a){const fd=open(p,...a);if(String(p).endsWith('/stdout.tap')&&a[0]==='wx')target=fd;return fd;};fs.writeFileSync=function(fd,...a){if(fd===target)throw Error('synthetic stream write failure');return write(fd,...a);};syncBuiltinESMExports();"),r=componentWrite(f,hook);fail(r,/synthetic stream write failure/);const [base]=componentOutputs(f);assert.equal(fs.existsSync(join(base,'diagnostic.json')),false);assert.equal(read(join(base,'failure.json')).complete,false);
 });
 await t.test('QR3 output changed immediately before publication is not accepted',()=>{
  reset();const hook=componentHook(f,'publish-race',"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const open=fs.openSync;fs.openSync=function(p,...a){if(String(p).endsWith('/diagnostic.json')&&a[0]==='wx')fs.appendFileSync(String(p).replace(/diagnostic.json$/,'stdout.tap'),'tampered');return open(p,...a);};syncBuiltinESMExports();"),r=componentWrite(f,hook);fail(r,/component artifact (changed|length)/);assert.equal(r.stdout,'');const [base]=componentOutputs(f);assert.equal(fs.existsSync(join(base,'failure.json')),false);assert.ok(fs.existsSync(join(base,'diagnostic.json')),'published partial must remain, never be deleted or treated as acceptance');const d=read(join(base,'diagnostic.json')),ref=d.artifacts.find(r=>r.path.endsWith('/stdout.tap'));assert.notEqual(ref.sha256,hash(fs.readFileSync(join(base,'stdout.tap'))));
 });
 await t.test('QR3 symlink diagnostic namespace refuses outside writes',()=>{
  reset();const parent=file(f,'evidence/enterprise/component-development');fs.mkdirSync(parent);const outside=join(f.temporary,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,join(parent,f.run.slug));const before=tree(f.temporary),r=componentWrite(f);fail(r,/symlink|escape/);assert.deepEqual(tree(f.temporary),before);
 });
 await t.test('QR4 runner remains private and exposes no accepted-component capability',async()=>{const api=await import('../../scripts/enterprise/runtime-preparation.mjs');assert.equal(api.testComponentDevelopment,undefined);});
});

// C1 storage component only: real compiled syscalls in disposable directories.
// No fixture record is a protected supervisor, membership proof or GO authority.
test('producer-admission-durable-storage-component',async t=>{
 const {tmpdir}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-admission-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);const harness=String.raw`
#define _GNU_SOURCE
#include <unistd.h>
#include <stdlib.h>
#include <signal.h>
#include <fcntl.h>
#include <errno.h>
#include <string.h>
#include <sys/stat.h>
static int sync_count = 0, write_count = 0, storage_fd;
static unsigned char written[75];
static const char *fault;
static int test_sync(int fd) {
 ++sync_count;
 if (fault && !strncmp(fault,"sync-fail-",10) && sync_count == atoi(fault+10)) { errno=EIO; return -1; }
 int r=fsync(fd);
 if (fault && ((!strcmp(fault,"history-replace-2") && sync_count==2) ||
               (!strcmp(fault,"history-replace-4") && sync_count==4) ||
               (!strcmp(fault,"intent-replace-4") && sync_count==4))) {
  const char *name=!strcmp(fault,"intent-replace-4")?"admitted.intent":"prepared.intent";
  char saved[75]; int old=openat(storage_fd,name,O_RDONLY|O_NOFOLLOW);
  if(old<0 || read(old,saved,sizeof(saved))!=(ssize_t)sizeof(saved)) _exit(90);
  if(unlinkat(storage_fd,name,0)<0) _exit(91);
  int other=openat(storage_fd,name,O_WRONLY|O_CREAT|O_EXCL,0600);
  if(other<0 || write(other,saved,sizeof(saved))!=(ssize_t)sizeof(saved)) _exit(92);
  close(other);close(old);
 }
 if (fault && ((!strcmp(fault,"directory-mode-2") && sync_count==2) ||
               (!strcmp(fault,"directory-mode-4") && sync_count==4))) {
  if(fchmod(storage_fd,0755)<0) _exit(93);
 }
 if (fault && sync_count==2 && !strcmp(fault,"unexpected-file-2")) {
  int extra=openat(storage_fd,"unexpected",O_WRONLY|O_CREAT|O_EXCL,0600);
  if(extra<0) _exit(94);
  close(extra);
 }
 if (fault && sync_count==1 && !strcmp(fault,"replace")) {
  if(unlinkat(storage_fd,"prepared.intent",0)<0) return -1;
  int other=openat(storage_fd,"prepared.intent",O_WRONLY|O_CREAT|O_EXCL,0600);
  if(other<0) return -1;
  if(write(other,written,75)!=75) { close(other); errno=EIO; return -1; }
  close(other);
 }
 if (fault && sync_count==1 && !strcmp(fault,"readback-change")) {
  if(pwrite(fd,"X",1,0)!=1) return -1;
 }
 if (fault && !strcmp(fault,"kill-intent") && sync_count == 2) raise(SIGKILL);
 if (fault && !strcmp(fault,"kill-commit") && sync_count == 4) raise(SIGKILL);
 return r;
}
static ssize_t test_write(int fd,const void *b,size_t n) {
 ++write_count;
 if(n==75) memcpy(written,b,75);
 if (fault && !strcmp(fault,"write-fail")) { if (write_count==1) return write(fd,b,5); errno=ENOSPC; return -1; }
 if (fault && !strcmp(fault,"eintr") && write_count==1) { errno=EINTR; return -1; }
 if (fault && !strcmp(fault,"short-write") && n>3) n=3;
 if (fault && !strcmp(fault,"kill-empty")) raise(SIGKILL);
 return write(fd,b,n);
}
static int test_fcntl(int fd,int cmd,int arg) {
 if(fault && !strcmp(fault,"pin-fail")) { errno=EMFILE; return -1; }
 return fcntl(fd,cmd,arg);
}
#define fcntl test_fcntl
#define fsync test_sync
#define write test_write
#define main preflight_main
#include "helper.c"
#undef main
#undef write
#undef fsync
#undef fcntl
static int descriptor_count(void) {
 int count=0;
 for(int fd=0;fd<1024;++fd) if(fcntl(fd,F_GETFD)>=0) ++count;
 return count;
}
int main(int argc,char **argv) {
 if(argc!=7) return 64;
 fault=argv[6]; int fd=open(argv[1],O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);
 if(fd<0) return 65;
 storage_fd=fd;
 int before_count=descriptor_count();
 int phase=-1,result;
 if(!strcmp(argv[2],"inspect")) result=pd_admission_inspect(fd,argv[5],&phase);
 else result=pd_admission_append(fd,argv[5],atoi(argv[3]),atoi(argv[4]));
 int error=result<0?errno:0;
 if(descriptor_count()!=before_count) return 95;
 close(fd);
 printf("{\"result\":%d,\"errno\":%d,\"phase\":%d}\n",result,error,phase);
 return result<0?2:0;
}
`;
 fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'storage-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};
 const binding='a'.repeat(64),store=()=>{const p=fs.mkdtempSync(join(dir,'store-'));fs.chmodSync(p,0o700);return p;};
 const args=(p,op='inspect',previous=0,next=0,key=binding,fault='none')=>[p,op,String(previous),String(next),key,fault];
 const run=(...a)=>{const r=spawnSync(binary,args(...a),{env,encoding:'utf8',timeout:5000});assert.equal(r.error,undefined);evidence.invocations.push({argv:args(...a),status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});return r;};
 const success=(...a)=>{const r=run(...a);assert.equal(r.status,0,r.stderr+r.stdout);return JSON.parse(r.stdout);};
 const rejected=(...a)=>{const p=a[0],before=tree(p),r=run(...a);assert.equal(r.status,2,r.stderr+r.stdout);assert.notEqual(JSON.parse(r.stdout).errno,0);assert.deepEqual(tree(p),before);return JSON.parse(r.stdout);};
 await t.test('PREPARED ADMITTED CLOSED persist across processes and readonly requery',()=>{
  const p=store();assert.equal(success(p).phase,0);
  for(const [a,b]of [[0,1],[1,2],[2,3]]){success(p,'append',a,b);const before=tree(p);assert.equal(success(p).phase,b);assert.deepEqual(tree(p),before);}
  rejected(p,'append',1,2);rejected(p,'append',0,1);assert.equal(fs.readdirSync(p).length,6);
 });
 await t.test('close PREPARED permanently prevents later admission',()=>{const p=store();success(p,'append',0,1);success(p,'append',1,3);assert.equal(success(p).phase,3);rejected(p,'append',1,2);});
 for(const [name,key]of [['different generation','b'.repeat(64)],['invalid binding','not-a-digest'],['upper case','A'.repeat(64)]])await t.test(name,()=>{const p=store();success(p,'append',0,1);rejected(p,'append',1,2,key);});
 for(const [a,b]of [[0,2],[0,3],[2,1],[3,2],[1,1],[4,5]])await t.test(`illegal transition ${a} to ${b}`,()=>{rejected(store(),'append',a,b);});
 for(const mode of [0o755,0o770,0o1700])await t.test('store permissions '+mode.toString(8),()=>{const p=store();fs.chmodSync(p,mode);rejected(p,'append',0,1);});
 for(const kind of ['truncate','change','symlink','hardlink','permissions','unknown','missing-intent','missing-commit','missing-prepared'])await t.test('corrupt history '+kind,()=>{
  const p=store();success(p,'append',0,1);const file=join(p,'prepared.intent');
  if(kind==='truncate')fs.truncateSync(file,3);
  if(kind==='change'){const bytes=fs.readFileSync(file);bytes[10]=98;fs.writeFileSync(file,bytes);}
  if(kind==='symlink'){fs.unlinkSync(file);fs.symlinkSync(join(p,'prepared.commit'),file);}
  if(kind==='hardlink')fs.linkSync(file,join(dir,'link-'+fs.readdirSync(dir).length));
  if(kind==='permissions')fs.chmodSync(file,0o644);
  if(kind==='unknown')fs.writeFileSync(join(p,'unexplained'),'');
  if(kind==='missing-intent')fs.unlinkSync(file);
  if(kind==='missing-commit')fs.unlinkSync(join(p,'prepared.commit'));
  if(kind==='missing-prepared'){success(p,'append',1,2);fs.unlinkSync(file);fs.unlinkSync(join(p,'prepared.commit'));}
  rejected(p);rejected(p,'append',1,2);
 });
 for(const fault of ['eintr','short-write'])await t.test('bounded record handles '+fault,()=>{const p=store();success(p,'append',0,1,binding,fault);assert.equal(success(p).phase,1);});
 for(const fault of ['write-fail','sync-fail-1','sync-fail-2','sync-fail-3','sync-fail-4','replace','readback-change','kill-empty','kill-intent','kill-commit'])await t.test('interrupted storage retains bytes '+fault,async()=>{
  const p=store(),r=run(p,'append',0,1,binding,fault);
  if(fault.startsWith('kill-'))assert.equal(r.signal,'SIGKILL');else {assert.equal(r.status,2);const {constants}=await import('node:os');assert.equal(JSON.parse(r.stdout).errno,constants.errno[fault==='write-fail'?'ENOSPC':fault==='replace'?'ESTALE':'EIO']);}
  assert.ok(fs.existsSync(join(p,'prepared.intent')));const before=tree(p);
  if(['kill-commit','sync-fail-3','sync-fail-4'].includes(fault))assert.equal(success(p).phase,1);else rejected(p);
  rejected(p,'append',0,1);assert.deepEqual(tree(p),before);
 });
 await t.test('two independent owners cannot both append one transition',async()=>{
  const p=store();const launch=()=>new Promise(resolveResult=>{const c=spawn(binary,args(p,'append',0,1),{env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';c.stdout.on('data',b=>stdout+=b);c.stderr.on('data',b=>stderr+=b);c.on('error',e=>resolveResult({error:e}));c.on('close',(status,signal)=>resolveResult({status,signal,stdout,stderr}));});
  const results=await Promise.all([launch(),launch()]);assert.deepEqual(results.map(r=>r.status).sort(),[0,2]);assert.equal(success(p).phase,1);assert.equal(fs.readdirSync(p).length,2);evidence.invocations.push({concurrent:results});
 });
 await t.test('descriptor exhaustion retains empty intent without leaking descriptors',async()=>{
  const p=store(),r=run(p,'append',0,1,binding,'pin-fail');assert.equal(r.status,2,r.stderr+r.stdout);
  const {constants}=await import('node:os');assert.equal(JSON.parse(r.stdout).errno,constants.errno.EMFILE);
  assert.equal(fs.statSync(join(p,'prepared.intent')).size,0);assert.equal(fs.existsSync(join(p,'prepared.commit')),false);
  rejected(p,'append',0,1);
 });
 for(const fault of ['history-replace-2','history-replace-4','intent-replace-4','directory-mode-2','directory-mode-4','unexpected-file-2'])await t.test('transition rejects concurrent checkpoint mutation '+fault,async()=>{
  const p=store();success(p,'append',0,1);const prior=fs.readFileSync(join(p,'prepared.intent'));
  const r=run(p,'append',1,2,binding,fault);assert.equal(r.status,2,r.stderr+r.stdout);
  const {constants}=await import('node:os');assert.equal(JSON.parse(r.stdout).errno,constants.errno[fault.startsWith('directory-')?'EPERM':fault.startsWith('unexpected-')?'EINVAL':'ESTALE']);
  assert.deepEqual(fs.readFileSync(join(p,'prepared.intent')),prior);
  assert.ok(fs.existsSync(join(p,'admitted.intent')));
  assert.equal(fs.existsSync(join(p,'admitted.commit')),fault.endsWith('-4'));
  if(fault==='unexpected-file-2')assert.ok(fs.existsSync(join(p,'unexpected')));
 });
 // Executed evidence is in TAP even when this seven-file command has no suite output directory.
 t.diagnostic(JSON.stringify(evidence));
});


test('producer-fd-inheritance-component',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-fds-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);
 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <dirent.h>
#include <sys/socket.h>
#include <sys/resource.h>
#include <sys/wait.h>
static const char *fault;
static int extra_fd=-1;
static int scan_round=0, input_fd=-1;
static DIR *test_fdopendir(int fd) {++scan_round;return fdopendir(fd);}
static struct dirent *test_readdir(DIR *d) {
 if(fault && (!strcmp(fault,"scan-fail") || (!strcmp(fault,"final-scan-fail") && scan_round==2))) {errno=EIO;return NULL;}
 return readdir(d);
}
static int test_close(int fd) {
 if(fault && !strcmp(fault,"close-fail") && fd==extra_fd) {errno=EIO;return -1;}
 if(fault && fd==extra_fd && !strcmp(fault,"close-eintr")) {if(close(fd)<0)_exit(81);errno=EINTR;return -1;}
 int r=close(fd);
 if(fault && fd==extra_fd && !strcmp(fault,"replace-during-close")) {int pair[2];if(socketpair(AF_UNIX,SOCK_STREAM,0,pair)<0 || dup2(pair[0],input_fd)<0)_exit(82);close(pair[0]);close(pair[1]);}
 return r;
}
static int test_fcntl(int fd,int cmd,int arg) {
 if(fault && !strcmp(fault,"flags-fail") && cmd==F_SETFD) {errno=EIO;return -1;}
 return fcntl(fd,cmd,arg);
}
#define close test_close
#define fcntl test_fcntl
#define readdir test_readdir
#define fdopendir test_fdopendir
#define main preflight_main
#include "helper.c"
#undef main
#undef fdopendir
#undef readdir
#undef fcntl
#undef close
static void result(int fd,int r,int error,int untouched,int execed) {
 char b[256];int n=snprintf(b,sizeof(b),"{\"result\":%d,\"errno\":%d,\"untouched\":%d,\"execed\":%d}\n",r,error,untouched,execed);
 if(n<0 || write(fd,b,(size_t)n)!=n) _exit(88);
}
int main(int argc,char **argv) {
 if(argc==5 && !strcmp(argv[1],"--probe")) {
  int input=atoi(argv[2]),go=atoi(argv[3]),out=atoi(argv[4]);
  char b[16]={0},g=0;int fds[PD_FD_SCAN_MAX];size_t count=0;
  if(read(input,b,7)!=7 || memcmp(b,"fixture",7) || read(go,&g,1)!=1 || g!='G') return 89;
  if(pd_fd_snapshot(fds,&count)<0 || count!=3) return 90;
  for(size_t i=0;i<count;++i)if(fds[i]!=input && fds[i]!=go && fds[i]!=out)return 91;
  result(out,0,0,0,1);return 0;
 }
 if(argc!=4)return 64;
 fault=argv[1];int report[2],go[2],sock[2];
 if(pipe(report)<0 || pipe(go)<0 || socketpair(AF_UNIX,SOCK_STREAM,0,sock)<0)return 65;
 if(write(go[1],"G",1)!=1)return 66;
 pid_t pid=fork();if(pid<0)return 67;
 if(pid==0) {
  int input=open(argv[2],O_RDONLY|O_CLOEXEC),rw=open(argv[3],O_RDWR|O_CLOEXEC);
  if(input<0 || rw<0)_exit(68);
  extra_fd=rw; input_fd=input;
  int high=fcntl(rw,F_DUPFD,128);if(high<128)_exit(69);
  for(int i=0;i<2;++i)if(fcntl(report[i],F_SETFD,FD_CLOEXEC)<0 || fcntl(go[i],F_SETFD,FD_CLOEXEC)<0)_exit(70);
  struct pd_fd_entry keep[3]={{.fd=input,.role=PD_INPUT_READ},{.fd=go[0],.role=PD_PIPE_READ},{.fd=report[1],.role=PD_PIPE_WRITE}};
  if(!strcmp(fault,"writable-input"))keep[0].fd=rw;
  if(!strcmp(fault,"socket-input"))keep[0].fd=sock[0];
  if(!strcmp(fault,"directory-input"))keep[0].fd=open(".",O_RDONLY|O_DIRECTORY);
  if(!strcmp(fault,"device-input"))keep[0].fd=open("/dev/null",O_RDONLY);
  if(!strcmp(fault,"wrong-pipe-direction"))keep[1].fd=go[1];
  for(int i=0;i<3;++i)if(fstat(keep[i].fd,&keep[i].identity)<0)_exit(71);
  if(!strcmp(fault,"stale-identity"))++keep[0].identity.st_ino;
  if(!strcmp(fault,"stale-size"))++keep[0].identity.st_size;
  if(!strcmp(fault,"unknown-role"))keep[0].role=99;
  if(!strcmp(fault,"duplicate"))keep[0]=keep[1];
  if(!strcmp(fault,"closed"))close(input);
  if(!strcmp(fault,"negative"))keep[0].fd=-1;
  if(!strcmp(fault,"low-limit")) {struct rlimit lim;if(getrlimit(RLIMIT_NOFILE,&lim)<0)_exit(72);lim.rlim_cur=64;if(setrlimit(RLIMIT_NOFILE,&lim)<0)_exit(73);}
  int r=pd_fd_prepare_exec(!strcmp(fault,"null")?NULL:keep,!strcmp(fault,"too-many")?65:3),error=r<0?errno:0;
  if(r<0) {
   int untouched=fcntl(rw,F_GETFD)>=0 && (fcntl(report[1],F_GETFD)&FD_CLOEXEC)!=0;
   result(report[1],r,error,untouched,0);_exit(2);
  }
  char a[24],b[24],c[24];snprintf(a,sizeof(a),"%d",input);snprintf(b,sizeof(b),"%d",go[0]);snprintf(c,sizeof(c),"%d",report[1]);
  execl(argv[0],argv[0],"--probe",a,b,c,(char *)NULL);_exit(74);
 }
 close(report[1]);close(go[0]);close(go[1]);close(sock[0]);close(sock[1]);
 char b[512];ssize_t n;while((n=read(report[0],b,sizeof(b)))>0)if(write(1,b,(size_t)n)!=n)return 75;
 if(n<0)return 76;
 close(report[0]);int status;if(waitpid(pid,&status,0)!=pid)return 77;
 return WIFEXITED(status)?WEXITSTATUS(status):78;
}
`;
 fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'fds-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'FD_INHERITANCE',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};
 const input=join(dir,'input'),protectedOutput=join(dir,'host-output');fs.writeFileSync(input,'fixture');fs.writeFileSync(protectedOutput,'preserve');
 const run=fault=>{const before=tree(dir),r=spawnSync(binary,[fault,input,protectedOutput],{env,encoding:'utf8',timeout:5000});assert.equal(r.error,undefined);assert.deepEqual(tree(dir),before);evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});return r;};
 for(const name of ['normal','low-limit'])await t.test('exec inherits only inventoried readonly input and pipes '+name,()=>{const r=run(name);assert.equal(r.status,0,r.stderr+r.stdout);assert.deepEqual(JSON.parse(r.stdout),{result:0,errno:0,untouched:0,execed:1});});
 for(const [name,error]of [['writable-input','EPERM'],['socket-input','EPERM'],['directory-input','EPERM'],['device-input','EPERM'],['wrong-pipe-direction','EPERM'],['stale-identity','ESTALE'],['stale-size','ESTALE'],['unknown-role','EPERM'],['duplicate','EINVAL'],['closed','EBADF'],['negative','EBADF'],['null','EINVAL'],['too-many','EINVAL'],['scan-fail','EIO']])await t.test('reject inventory before descriptor changes '+name,()=>{const r=run(name);assert.equal(r.status,2,r.stderr+r.stdout);assert.deepEqual(JSON.parse(r.stdout),{result:-1,errno:constants.errno[error],untouched:1,execed:0});});
 for(const [name,error] of [['close-fail','EIO'],['flags-fail','EIO'],['close-eintr','EINTR'],['replace-during-close','EPERM'],['final-scan-fail','EIO']])await t.test('partial FD preparation never execs '+name,()=>{const r=run(name);assert.equal(r.status,2,r.stderr+r.stdout);const j=JSON.parse(r.stdout);assert.equal(j.result,-1);assert.equal(j.errno,constants.errno[error]);assert.equal(j.execed,0);});
 t.diagnostic(JSON.stringify(evidence));
});


test('producer-go-channel-component',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-go-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);
 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <signal.h>
#include <poll.h>
#include <time.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
static const char *fault;
static int gate=-1, polls=0, reads=0;
static int test_poll(struct pollfd *fds,nfds_t n,int timeout) {
 ++polls;
 if(!strcmp(fault,"poll-error")){errno=EIO;return -1;}
 if(!strcmp(fault,"poll-eintr") && polls==1){errno=EINTR;return -1;}
 if(!strcmp(fault,"interrupt-timeout")){struct timespec delay={0,10000000};nanosleep(&delay,NULL);errno=EINTR;return -1;}
 int r=poll(fds,n,timeout);
 if(!strcmp(fault,"replace-pipe")){int pair[2];if(pipe(pair)<0 || dup2(pair[0],gate)<0)_exit(81);close(pair[0]);close(pair[1]);}
 if(!strcmp(fault,"change-flags"))fcntl(gate,F_SETFL,0);
 return r;
}
static ssize_t test_read(int fd,void *b,size_t n) {
 if(fd==gate){++reads;
  if(!strcmp(fault,"read-error")){errno=EIO;return -1;}
  if(!strcmp(fault,"read-eintr") && reads==1){errno=EINTR;return -1;}
  if(!strcmp(fault,"read-eagain") && reads==1){errno=EAGAIN;return -1;}
 }
 return read(fd,b,n);
}
static int test_clock(clockid_t clock,struct timespec *out) {
 if(!strcmp(fault,"clock-error")){errno=EIO;return -1;}
 return clock_gettime(clock,out);
}
static int test_close(int fd) {int r=close(fd);if(fd==gate && !strcmp(fault,"close-error")){errno=EIO;return -1;}return r;}
#define poll test_poll
#define read test_read
#define clock_gettime test_clock
#define close test_close
#define main preflight_main
#include "helper.c"
#undef main
#undef close
#undef clock_gettime
#undef read
#undef poll
static void report(int out,int result,int error,int replay,int execed) {
 char b[256];int n=snprintf(b,sizeof(b),"{\"result\":%d,\"errno\":%d,\"replayErrno\":%d,\"execed\":%d}\n",result,error,replay,execed);
 if(n<0 || write(out,b,(size_t)n)!=n)_exit(82);
}
int main(int argc,char **argv) {
 if(argc==5 && !strcmp(argv[1],"--probe")){int fd=atoi(argv[2]);if(fcntl(atoi(argv[3]),F_GETFD)>=0 || errno!=EBADF)return 83;report(fd,0,0,atoi(argv[4]),1);return 0;}
 if(argc!=2)return 64;fault=argv[1];signal(SIGPIPE,SIG_IGN);
 int channel[2],output[2];if(pipe(channel)<0 || pipe(output)<0)return 65;
 pid_t child=fork();if(child<0)return 66;
 if(child==0){
  close(channel[1]);close(output[0]);gate=channel[0];
  if(fcntl(gate,F_SETFL,O_NONBLOCK)<0 || fcntl(gate,F_SETFD,FD_CLOEXEC)<0)_exit(67);
  struct pd_fd_entry entry={.fd=gate,.role=PD_PIPE_READ};if(fstat(gate,&entry.identity)<0)_exit(68);
  char binding[65];memset(binding,'a',64);binding[64]=0;
  if(!strcmp(fault,"blocking"))fcntl(gate,F_SETFL,0);
  if(!strcmp(fault,"inheritable"))fcntl(gate,F_SETFD,0);
  if(!strcmp(fault,"wrong-role"))entry.role=PD_PIPE_WRITE;
  if(!strcmp(fault,"stale"))++entry.identity.st_ino;
  if(!strcmp(fault,"invalid-binding"))binding[0]='X';
  if(write(output[1],"R",1)!=1)_exit(69);
  int limit=(!strcmp(fault,"silent")||!strcmp(fault,"unclosed")||!strcmp(fault,"interrupt-timeout"))?150:1500;
  if(!strcmp(fault,"zero-timeout"))limit=0;
  if(!strcmp(fault,"long-timeout"))limit=60001;
  int r=pd_go_wait(!strcmp(fault,"null-channel")?NULL:&entry,binding,limit),error=r<0?errno:0;
  if(r<0){report(output[1],r,error,0,0);_exit(2);}
  if(pd_go_wait(&entry,binding,limit)!=-1)_exit(70);int replay=errno;
  char a[24],b[24],c[24];snprintf(a,sizeof(a),"%d",output[1]);snprintf(b,sizeof(b),"%d",gate);snprintf(c,sizeof(c),"%d",replay);
  execl(argv[0],argv[0],"--probe",a,b,c,(char *)NULL);_exit(71);
 }
 close(channel[0]);close(output[1]);char ready;if(read(output[0],&ready,1)!=1 || ready!='R')return 72;
 char frame[PD_GO_SIZE];memcpy(frame,"PDGO1\n",6);memset(frame+6,'a',64);frame[70]='\n';
 if(!strcmp(fault,"wrong-binding"))frame[6]='b';
 if(!strcmp(fault,"unknown-version"))frame[4]='2';
 if(!strcmp(fault,"normal") || !strcmp(fault,"fragmented")){
  struct pollfd p={.fd=output[0],.events=POLLIN};if(poll(&p,1,40)!=0)return 73;
  if(!strcmp(fault,"fragmented")){for(int i=0;i<PD_GO_SIZE;++i){if(write(channel[1],frame+i,1)!=1)return 74;if(i==19 && poll(&p,1,40)!=0)return 84;}}
  else if(write(channel[1],frame,sizeof(frame))!=sizeof(frame))return 75;
  /* Even a complete frame cannot release the child until supervisor EOF. */
  if(poll(&p,1,40)!=0)return 76;
 }else if(!strcmp(fault,"publisher-killed")){
  pid_t publisher=fork();if(publisher<0)return 85;
  if(publisher==0){close(output[0]);for(;;)pause();}
  if(kill(publisher,SIGKILL)<0)return 86;int status;
  if(waitpid(publisher,&status,0)!=publisher || !WIFSIGNALED(status) || WTERMSIG(status)!=SIGKILL)return 87;
 }else if(strcmp(fault,"silent") && strcmp(fault,"empty")){
  size_t size=!strcmp(fault,"partial")?20:sizeof(frame);(void)write(channel[1],frame,size);
  if(!strcmp(fault,"duplicate"))(void)write(channel[1],frame,sizeof(frame));
  if(!strcmp(fault,"trailing"))(void)write(channel[1],"x",1);
 }
 int held=!strcmp(fault,"silent")||!strcmp(fault,"unclosed")||!strcmp(fault,"interrupt-timeout");if(!held)close(channel[1]);
 char b[512];ssize_t n;while((n=read(output[0],b,sizeof(b)))>0)if(write(1,b,(size_t)n)!=n)return 77;
 if(n<0)return 78;if(held)close(channel[1]);close(output[0]);int status;
 if(waitpid(child,&status,0)!=child)return 79;return WIFEXITED(status)?WEXITSTATUS(status):80;
}
`;
 fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'go-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'GO_CHANNEL',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};
 const run=fault=>{const before=tree(dir),r=spawnSync(binary,[fault],{env,encoding:'utf8',timeout:5000});assert.equal(r.error,undefined);assert.deepEqual(tree(dir),before);evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});return r;};
 for(const name of ['normal','fragmented','poll-eintr','read-eintr','read-eagain'])await t.test('exact GO frame and EOF releases only once '+name,()=>{const r=run(name);assert.equal(r.status,0,r.stderr+r.stdout);assert.deepEqual(JSON.parse(r.stdout),{result:0,errno:0,replayErrno:constants.errno.EBADF,execed:1});});
 for(const [name,error]of [['publisher-killed','EPROTO'],['empty','EPROTO'],['partial','EPROTO'],['duplicate','EPROTO'],['trailing','EPROTO'],['wrong-binding','EPROTO'],['unknown-version','EPROTO'],['silent','ETIMEDOUT'],['unclosed','ETIMEDOUT'],['interrupt-timeout','ETIMEDOUT'],['blocking','EPERM'],['inheritable','EPERM'],['wrong-role','EINVAL'],['stale','ESTALE'],['invalid-binding','EINVAL'],['zero-timeout','EINVAL'],['long-timeout','EINVAL'],['null-channel','EINVAL'],['poll-error','EIO'],['read-error','EIO'],['clock-error','EIO'],['close-error','EIO'],['replace-pipe','ESTALE'],['change-flags','EPERM']])await t.test('setup refuses without exec '+name,()=>{const r=run(name);assert.equal(r.status,2,r.stderr+r.stdout);assert.deepEqual(JSON.parse(r.stdout),{result:-1,errno:constants.errno[error],replayErrno:0,execed:0});});
 t.diagnostic(JSON.stringify(evidence));
});

test('producer-setup-channel-integration',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-setup-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);
 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <signal.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <sys/resource.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
static const char *fault,*replacement;
static int gate=-1,out=-1,input=-1,host=-1,sock=-1,host_directory_fd=-1,high=-1,started=0;
static int test_poll(struct pollfd *,nfds_t,int);
static int test_close(int fd) {
 int r=close(fd);
 if(fd==host && !strcmp(fault,"filter-close-error")){errno=EIO;return -1;}
 if(fd==gate){
  if(!strcmp(fault,"post-go-extra")){if(open(replacement,O_RDONLY)<0)_exit(81);}
  if(!strcmp(fault,"post-go-flags"))fcntl(input,F_SETFD,FD_CLOEXEC);
  if(!strcmp(fault,"post-go-replace")){int f=open(replacement,O_RDONLY);if(f<0 || dup2(f,input)<0)_exit(82);if(f!=input)close(f);}
  if(!strcmp(fault,"go-close-error")){errno=EIO;return -1;}
 }
 return r;
}
#define poll test_poll
#define close test_close
#define main preflight_main
#include "helper.c"
#undef main
#undef close
#undef poll
static int test_poll(struct pollfd *fds,nfds_t n,int timeout) {
 if(!started){
  int list[PD_FD_SCAN_MAX];size_t count=0;
  if(pd_fd_snapshot(list,&count)<0 || count!=3)_exit(83);
  if(!(fcntl(gate,F_GETFD)&FD_CLOEXEC) || (fcntl(input,F_GETFD)&FD_CLOEXEC) || (fcntl(out,F_GETFD)&FD_CLOEXEC))_exit(84);
  int denied[]={host,sock,host_directory_fd,high};
  for(size_t i=0;i<4;++i)if(fcntl(denied[i],F_GETFD)>=0 || errno!=EBADF)_exit(85);
  if(write(out,"R",1)!=1)_exit(86);started=1;
 }
 if(!strcmp(fault,"wait-error")){errno=EIO;return -1;}
 return poll(fds,n,timeout);
}
static void report(int fd,int result,int error,int execed,int before) {
 char b[256];int n=snprintf(b,sizeof(b),"{\"result\":%d,\"errno\":%d,\"execed\":%d,\"preGoChecked\":%d}\n",result,error,execed,before);
 if(n<0 || write(fd,b,(size_t)n)!=n)_exit(87);
}
int main(int argc,char **argv) {
 if(argc==5 && !strcmp(argv[1],"--probe")){
  out=atoi(argv[2]);input=atoi(argv[3]);gate=atoi(argv[4]);
  if(fcntl(gate,F_GETFD)>=0 || errno!=EBADF)return 88;
  int list[PD_FD_SCAN_MAX];size_t count=0;if(pd_fd_snapshot(list,&count)<0 || count!=2)return 89;
  char b[5];if(read(input,b,5)!=5 || memcmp(b,"hello",5))return 90;
  report(out,0,0,1,1);return 0;
 }
 if(argc!=6)return 64;fault=argv[1];replacement=argv[3];signal(SIGPIPE,SIG_IGN);
 int channel[2],output[2];if(pipe(channel)<0 || pipe(output)<0)return 65;
 pid_t child=fork();if(child<0)return 66;
 if(child==0){
  close(output[0]);gate=channel[0];out=output[1];
  if(fcntl(gate,F_SETFL,O_NONBLOCK)<0 || fcntl(gate,F_SETFD,FD_CLOEXEC)<0)_exit(67);
  input=open(argv[2],O_RDONLY|O_CLOEXEC);host=open(argv[4],O_WRONLY);sock=socket(AF_UNIX,SOCK_STREAM,0);host_directory_fd=open(argv[5],O_RDONLY|O_DIRECTORY);
  if(input<0 || host<0 || sock<0 || host_directory_fd<0)_exit(68);
  high=fcntl(host,F_DUPFD,128);if(high<128)_exit(69);
  struct rlimit limit;if(getrlimit(RLIMIT_NOFILE,&limit)<0)_exit(70);limit.rlim_cur=64;if(setrlimit(RLIMIT_NOFILE,&limit)<0)_exit(71);
  struct pd_fd_entry work[2]={{.fd=input,.role=PD_INPUT_READ},{.fd=out,.role=PD_PIPE_WRITE}},control={.fd=gate,.role=PD_PIPE_READ},sender={.fd=channel[1],.role=PD_PIPE_WRITE};
  if(fstat(sender.fd,&sender.identity)<0)_exit(91);
  if(fstat(input,&work[0].identity)<0 || fstat(out,&work[1].identity)<0 || fstat(gate,&control.identity)<0)_exit(72);
  char binding[65];memset(binding,'a',64);binding[64]=0;size_t count=2;int timeout=1000;
  if(!strcmp(fault,"alias-read")){work[0].fd=dup(gate);work[0].role=PD_PIPE_READ;fstat(work[0].fd,&work[0].identity);}
  if(!strcmp(fault,"alias-write")){work[0].fd=channel[1];work[0].role=PD_PIPE_WRITE;fstat(work[0].fd,&work[0].identity);}
  if(!strcmp(fault,"alias-write-dup")){work[0].fd=dup(channel[1]);work[0].role=PD_PIPE_WRITE;fstat(work[0].fd,&work[0].identity);}
  if(!strcmp(fault,"same-channel"))work[0]=control;
  if(!strcmp(fault,"stale-sender"))++sender.identity.st_ino;
  if(!strcmp(fault,"bad-sender-role"))sender.role=PD_PIPE_READ;
  if(!strcmp(fault,"stale-input"))++work[0].identity.st_ino;
  if(!strcmp(fault,"bad-binding"))binding[0]='X';
  if(!strcmp(fault,"count-overflow"))count=64;
  if(!strcmp(fault,"bad-timeout"))timeout=0;
  if(!strcmp(fault,"timeout"))timeout=100;
  if(!strcmp(fault,"blocking-control"))fcntl(gate,F_SETFL,0);
  if(!strcmp(fault,"inherited-control"))fcntl(gate,F_SETFD,0);
  int result,error;
  if(!strcmp(fault,"old-composition")){
   struct pd_fd_entry combined[3]={work[0],work[1],control};
   result=pd_fd_prepare_exec(combined,3);if(!result)result=pd_go_wait(&control,binding,timeout);
  }else result=pd_setup_wait(!strcmp(fault,"null-workload")?NULL:work,count,!strcmp(fault,"null-control")?NULL:&control,!strcmp(fault,"null-sender")?NULL:&sender,binding,timeout);
  error=result<0?errno:0;
  if(result<0){report(out,result,error,0,started);_exit(2);}
  char a[24],b[24],c[24];snprintf(a,sizeof(a),"%d",out);snprintf(b,sizeof(b),"%d",input);snprintf(c,sizeof(c),"%d",gate);
  execl(argv[0],argv[0],"--probe",a,b,c,(char *)NULL);_exit(73);
 }
 close(channel[0]);close(output[1]);char first;if(read(output[0],&first,1)!=1)return 74;
 if(first=='R'){
  struct pollfd p={.fd=output[0],.events=POLLIN};
  if(!strcmp(fault,"normal") && poll(&p,1,30)!=0)return 75;
  char frame[PD_GO_SIZE];memcpy(frame,"PDGO1\n",6);memset(frame+6,'a',64);frame[70]='\n';
  if(!strcmp(fault,"wrong-binding"))frame[6]='b';
  if(strcmp(fault,"timeout") && strcmp(fault,"empty")){
   (void)write(channel[1],frame,!strcmp(fault,"partial")?20:sizeof(frame));
   if(!strcmp(fault,"duplicate"))(void)write(channel[1],frame,sizeof(frame));
  }
  if(!strcmp(fault,"normal") && poll(&p,1,30)!=0)return 76;
 }else if(write(1,&first,1)!=1)return 77;
 if(strcmp(fault,"timeout"))close(channel[1]);
 char b[512];ssize_t n;while((n=read(output[0],b,sizeof(b)))>0)if(write(1,b,(size_t)n)!=n)return 78;
 if(!strcmp(fault,"timeout"))close(channel[1]);close(output[0]);int status;
 if(n<0 || waitpid(child,&status,0)!=child)return 79;return WIFEXITED(status)?WEXITSTATUS(status):80;
}
`;
 for(const name of ['input','replacement','host-output'])fs.writeFileSync(join(dir,name),'hello');
 fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'setup-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'SETUP_FD_GO',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};
 const run=fault=>{const before=tree(dir),r=spawnSync(binary,[fault,join(dir,'input'),join(dir,'replacement'),join(dir,'host-output'),dir],{env,encoding:'utf8',timeout:5000});assert.equal(r.error,undefined);assert.deepEqual(tree(dir),before);evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});return r;};

 await t.test('closes host descriptors before GO and exec inherits only workload FDs',()=>{const r=run('normal');assert.equal(r.status,0,r.stderr+r.stdout);assert.deepEqual(JSON.parse(r.stdout),{result:0,errno:0,execed:1,preGoChecked:1});});
 for(const [name,error,before]of [
  ['old-composition','EPERM',0],['alias-read','EINVAL',0],['alias-write','EINVAL',0],['alias-write-dup','EINVAL',0],['same-channel','EINVAL',0],
  ['stale-input','ESTALE',0],['bad-binding','EINVAL',0],['count-overflow','EINVAL',0],['bad-timeout','EINVAL',0],
  ['null-sender','EINVAL',0],['bad-sender-role','EINVAL',0],['stale-sender','ESTALE',0],['null-workload','EINVAL',0],['null-control','EINVAL',0],['blocking-control','EPERM',0],['inherited-control','EPERM',0],
  ['filter-close-error','EIO',0],['wait-error','EIO',1],['timeout','ETIMEDOUT',1],['empty','EPROTO',1],
  ['partial','EPROTO',1],['duplicate','EPROTO',1],['wrong-binding','EPROTO',1],['go-close-error','EIO',1],
  ['post-go-extra','ESTALE',1],['post-go-flags','ESTALE',1],['post-go-replace','ESTALE',1]
 ])await t.test('integrated setup refuses without exec '+name,()=>{const r=run(name);assert.equal(r.status,2,r.stderr+r.stdout);assert.deepEqual(JSON.parse(r.stdout),{result:-1,errno:constants.errno[error],execed:0,preGoChecked:before});});
 t.diagnostic(JSON.stringify(evidence));
});

test('producer-control-pipe-construction',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-control-pipe-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);

 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <stdarg.h>
#include <signal.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
static int active=0,fail_fcntl=0,fail_stat=0,nfcntl=0,nstat=0,closes=0;
static const char *fault;
static int test_pipe(int fds[2]) {
 if(active && !strcmp(fault,"pipe")){errno=EMFILE;return -1;}
 return pipe(fds);
}
static int test_fcntl(int fd,int op,...) {
 va_list ap;va_start(ap,op);int arg=va_arg(ap,int);va_end(ap);
 if(active && ++nfcntl==fail_fcntl){errno=EIO;return -1;}
 if(active && !strcmp(fault,"drop-cloexec") && op==F_SETFD)return 0;
 if(active && !strcmp(fault,"drop-nonblock") && op==F_SETFL)return 0;
 if(active && !strcmp(fault,"sender-cloexec") && nfcntl==6)return 0;
 if(active && !strcmp(fault,"sender-nonblock") && nfcntl==8)return 0;
 return fcntl(fd,op,arg);
}
static int test_fstat(int fd,struct stat *out) {
 if(active && ++nstat==fail_stat){errno=EIO;return -1;}
 return fstat(fd,out);
}
static int test_close(int fd) {
 if(active)++closes;
 if(active && !strcmp(fault,"cleanup-eintr") && closes==1){errno=EINTR;return -1;}
 int r=close(fd);
 if(active && !strcmp(fault,"cleanup-error")){errno=EBADF;return -1;}
 return r;
}
#define pipe test_pipe
#define fcntl test_fcntl
#define fstat test_fstat
#define close test_close
#define main preflight_main
#include "helper.c"
#undef main
#undef close
#undef fstat
#undef fcntl
#undef pipe
int main(int argc,char **argv) {
 if(argc==4 && !strcmp(argv[1],"--probe")){
  int input=atoi(argv[2]),out=atoi(argv[3]),fds[PD_FD_SCAN_MAX];size_t count=0;char b[5];
  if(pd_fd_snapshot(fds,&count)<0 || count!=2 || read(input,b,5)!=5 || memcmp(b,"hello",5))return 80;
  if(write(out,"OK",2)!=2)return 81;return 0;
 }
 if(argc!=3)return 64;fault=argv[1];signal(SIGPIPE,SIG_IGN);
 if(!strncmp(fault,"fcntl-",6))fail_fcntl=atoi(fault+6);
 if(!strncmp(fault,"stat-",5))fail_stat=atoi(fault+5);
 if(!strcmp(fault,"cleanup-error") || !strcmp(fault,"cleanup-eintr"))fail_fcntl=2;
 int fds[PD_FD_SCAN_MAX];size_t before=0,after=0;if(pd_fd_snapshot(fds,&before)<0)return 65;
 struct pd_control_pipe pair;memset(&pair,0x5a,sizeof(pair));pair.receiver.fd=pair.sender.fd=-1;
 if(!strcmp(fault,"occupied"))pair.receiver.fd=1;
 struct pd_control_pipe original=pair;active=1;
 int result=pd_control_pipe_open(!strcmp(fault,"null")?NULL:&pair),error=result<0?errno:0;active=0;
 if(result<0){
  if(memcmp(&pair,&original,sizeof(pair)) || pd_fd_snapshot(fds,&after)<0 || after!=before+(!strcmp(fault,"cleanup-eintr")?1:0))return 66;
  printf("{\"result\":-1,\"errno\":%d,\"closes\":%d,\"unchanged\":true}\n",error,closes);return 2;
 }
 if(pd_go_channel_valid(&pair.receiver)<0 || pd_fd_matches(&pair.sender)<0)return 67;
 if(!(fcntl(pair.sender.fd,F_GETFD)&FD_CLOEXEC) || !(fcntl(pair.sender.fd,F_GETFL)&O_NONBLOCK))return 68;
 if(pd_fd_snapshot(fds,&after)<0 || after!=before+2)return 69;
 int output[2];if(pipe(output)<0)return 70;
 pid_t child=fork();if(child<0)return 71;
 if(child==0){
  close(output[0]);int input=open(argv[2],O_RDONLY|O_CLOEXEC);if(input<0)_exit(72);
  struct pd_fd_entry work[2]={{.fd=input,.role=PD_INPUT_READ},{.fd=output[1],.role=PD_PIPE_WRITE}};
  if(fstat(input,&work[0].identity)<0 || fstat(output[1],&work[1].identity)<0)_exit(73);
  char binding[65];memset(binding,'a',64);binding[64]=0;
  if(pd_setup_wait(work,2,&pair.receiver,&pair.sender,binding,1000)<0)_exit(74);
  char a[24],b[24];snprintf(a,sizeof(a),"%d",input);snprintf(b,sizeof(b),"%d",output[1]);
  execl(argv[0],argv[0],"--probe",a,b,(char *)NULL);_exit(75);
 }
 close(output[1]);close(pair.receiver.fd);
 char frame[PD_GO_SIZE];memcpy(frame,"PDGO1\n",6);memset(frame+6,'a',64);frame[70]='\n';
 if(write(pair.sender.fd,frame,sizeof(frame))!=sizeof(frame))return 76;close(pair.sender.fd);
 char got[2];ssize_t n=read(output[0],got,2);close(output[0]);int status;
 if(waitpid(child,&status,0)!=child || !WIFEXITED(status) || WEXITSTATUS(status)!=0 || n!=2 || memcmp(got,"OK",2))return 77;
 if(pd_fd_snapshot(fds,&after)<0 || before!=after)return 78;
 puts("{\"result\":0,\"execed\":true,\"fdCountRestored\":true}");return 0;
}
`;
 fs.writeFileSync(join(dir,'input'),'hello');fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'pipe-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'CONTROL_PIPE',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};

 const run=fault=>{const before=tree(dir),r=spawnSync(binary,[fault,join(dir,'input')],{env,encoding:'utf8',timeout:5000});assert.equal(r.error,undefined);assert.deepEqual(tree(dir),before);evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});return r;};
 await t.test('internally created pipe connects FD filtering GO and real exec',()=>{const r=run('normal');assert.equal(r.status,0,r.stdout+r.stderr);assert.deepEqual(JSON.parse(r.stdout),{result:0,execed:true,fdCountRestored:true});});
 const faults=[['pipe','EMFILE',0],['null','EINVAL',0],['occupied','EINVAL',0],['drop-cloexec','EPERM',2],['drop-nonblock','EPERM',2],['cleanup-error','EIO',2],['cleanup-eintr','EIO',2],['sender-cloexec','EPERM',2],['sender-nonblock','EPERM',2]];
 for(let i=1;i<=14;i++)faults.push(['fcntl-'+i,'EIO',2]);
 for(let i=1;i<=4;i++)faults.push(['stat-'+i,'EIO',2]);
 for(const [fault,error,closes]of faults)await t.test('pipe construction refuses without publishing endpoints '+fault,()=>{const r=run(fault);assert.equal(r.status,2,r.stdout+r.stderr);assert.deepEqual(JSON.parse(r.stdout),{result:-1,errno:constants.errno[error],closes,unchanged:true});});
 t.diagnostic(JSON.stringify(evidence));
});
test('producer-go-publication-component',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-go-publication-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);


 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <stdarg.h>
#include <sys/stat.h>
#include <signal.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
static int active=0,writes=0,closes=0,nfcntl=0;
static const char *fault;
static ssize_t test_write(int fd,const void *b,size_t n) {
 if(active){
  ++writes;
  if(!strcmp(fault,"write-error") || !strcmp(fault,"double-error")){errno=EIO;return -1;}
  if(!strcmp(fault,"eintr")){errno=EINTR;return -1;}
  if(!strcmp(fault,"eagain")){errno=EAGAIN;return -1;}
  if(!strcmp(fault,"zero"))return 0;
  if(!strcmp(fault,"short"))return write(fd,b,5);
 }
 return write(fd,b,n);
}
static int test_close(int fd) {
 if(active){
  ++closes;
  if(!strcmp(fault,"close-eintr")){errno=EINTR;return -1;}
  int r=close(fd);
  if(!strcmp(fault,"close-error") || !strcmp(fault,"double-error")){errno=EBADF;return -1;}
  return r;
 }
 return close(fd);
}
static int test_sigaction(int sig,const struct sigaction *a,struct sigaction *old) {
 if(active && !strcmp(fault,"signal-error")){errno=EIO;return -1;}
 return sigaction(sig,a,old);
}
static int test_fstat(int fd,struct stat *out) {
 if(active && !strcmp(fault,"stat-error")){errno=EIO;return -1;}
 return fstat(fd,out);
}
static int test_fcntl(int fd,int op,...) {
 va_list ap;va_start(ap,op);int arg=va_arg(ap,int);va_end(ap);
 if(active && !strncmp(fault,"fcntl-",6) && ++nfcntl==atoi(fault+6)){errno=EIO;return -1;}
 return fcntl(fd,op,arg);
}
#define fstat test_fstat
#define fcntl test_fcntl
#define write test_write
#define close test_close
#define sigaction(...) test_sigaction(__VA_ARGS__)
#define main preflight_main
#include "helper.c"
#undef main
#undef fcntl
#undef fstat
#undef sigaction
#undef close
#undef write
int main(int argc,char **argv) {
 if(argc==3 && !strcmp(argv[1],"--probe")){
  int out=atoi(argv[2]),fds[PD_FD_SCAN_MAX];size_t count=0;
  if(pd_fd_snapshot(fds,&count)<0 || count!=1)return 80;
  return write(out,"OK",2)==2?0:81;
 }
 if(argc!=2)return 64;fault=argv[1];signal(SIGPIPE,SIG_IGN);
 char binding[65];memset(binding,'a',64);binding[64]=0;
 struct pd_control_pipe pair={.receiver={.fd=-1},.sender={.fd=-1}};
 if(pd_control_pipe_open(&pair)<0)return 65;
 int sender=pair.sender.fd,output[2];if(pipe(output)<0)return 66;
 pid_t child=fork();if(child<0)return 67;
 if(!child){
  struct pd_fd_entry work={.fd=output[1],.role=PD_PIPE_WRITE};
  if(fstat(output[1],&work.identity)<0)_exit(68);
  if(!strcmp(fault,"broken-pipe"))_exit(2);
  if(pd_setup_wait(&work,1,&pair.receiver,&pair.sender,binding,1000)<0)_exit(2);
  char fd[24];snprintf(fd,sizeof(fd),"%d",output[1]);
  execl(argv[0],argv[0],"--probe",fd,(char*)NULL);_exit(69);
 }
 close(output[1]);close(pair.receiver.fd);
 int status=0;
 if(!strcmp(fault,"broken-pipe") && waitpid(child,&status,0)!=child)return 70;
 if(!strcmp(fault,"signal-default"))signal(SIGPIPE,SIG_DFL);
 if(!strcmp(fault,"blocking"))fcntl(sender,F_SETFL,fcntl(sender,F_GETFL)&~O_NONBLOCK);
 if(!strcmp(fault,"inherited"))fcntl(sender,F_SETFD,0);
 if(!strcmp(fault,"stale"))++pair.sender.identity.st_ino;
 if(!strcmp(fault,"role"))pair.sender.role=PD_PIPE_READ;
 struct sigaction before_signal,after_signal;if(sigaction(SIGPIPE,NULL,&before_signal)<0)return 75;
 enum pd_go_delivery delivery=PD_GO_COMPLETE;active=1;
 int result=pd_go_publish(!strcmp(fault,"null-sender")?NULL:&pair.sender,
    !strcmp(fault,"binding")?"invalid":binding,!strcmp(fault,"null-result")?NULL:&delivery);
 int error=result<0?errno:0;active=0;
 if(sigaction(SIGPIPE,NULL,&after_signal)<0 || before_signal.sa_handler!=after_signal.sa_handler)return 76;
 if(pair.sender.fd==-1 && strcmp(fault,"close-eintr") && (fcntl(sender,F_GETFD)!=-1 || errno!=EBADF))return 77;
 int consumed=pair.sender.fd==-1,write_count=writes,close_count=closes;
 if(consumed){
  enum pd_go_delivery again;active=1;
  if(pd_go_publish(&pair.sender,binding,&again)!=-1 || errno!=EBADF || again!=PD_GO_NOT_ATTEMPTED || writes!=write_count || closes!=close_count)return 71;
  active=0;
 }
 /* Rejected validation closes the unused writer here, outside the primitive.
  * close-eintr intentionally leaves it open until the child times out. */
 if(!consumed)close(sender);
 char got[2];ssize_t n=read(output[0],got,2);close(output[0]);
 if(strcmp(fault,"broken-pipe") && waitpid(child,&status,0)!=child)return 72;
 if(!WIFEXITED(status))return 73;
 int execed=WEXITSTATUS(status)==0 && n==2 && !memcmp(got,"OK",2);
 if(!execed && (WEXITSTATUS(status)!=2 || n!=0))return 74;
 printf("{\"result\":%d,\"errno\":%d,\"delivery\":%d,\"consumed\":%d,\"writes\":%d,\"closes\":%d,\"execed\":%d}\n",result,error,delivery,consumed,writes,closes,execed);
 return result<0?2:0;
}
`;
 fs.writeFileSync(join(dir,'input'),'hello');fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'pipe-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'GO_PUBLICATION',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};

 const run=fault=>{const before=tree(dir),r=spawnSync(binary,[fault],{env,encoding:'utf8',timeout:5000});assert.equal(r.error,undefined);assert.deepEqual(tree(dir),before);evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});return r;};

 await t.test('one-shot publication completes through setup and real exec',()=>{const r=run('normal');assert.equal(r.status,0,r.stdout+r.stderr);assert.deepEqual(JSON.parse(r.stdout),{result:0,errno:0,delivery:2,consumed:1,writes:1,closes:1,execed:1});});
 const faults=[
  ['write-error','EIO',1,1,0],['short','EIO',1,1,0],['zero','EIO',1,1,0],
  ['eintr','EINTR',1,1,0],['eagain','EAGAIN',1,1,0],['broken-pipe','EPIPE',1,1,0],
  ['double-error','EIO',1,1,0],['close-error','EBADF',1,1,1],['close-eintr','EINTR',1,1,0],
  ['stat-error','EIO',0,0,0],['fcntl-1','EIO',0,0,0],['fcntl-2','EIO',0,0,0],['fcntl-3','EIO',0,0,0],['signal-default','EPERM',0,0,0],['signal-error','EIO',0,0,0],['blocking','EPERM',0,0,0],
  ['inherited','EPERM',0,0,0],['stale','ESTALE',0,0,0],['role','EINVAL',0,0,0],
  ['binding','EINVAL',0,0,0],['null-sender','EINVAL',0,0,0],['null-result','EINVAL',2,0,0]
 ];
 for(const [fault,error,delivery,consumed,execed]of faults)await t.test('GO publication preserves delivery uncertainty and refuses retry '+fault,()=>{
  const r=run(fault);assert.equal(r.status,2,r.stdout+r.stderr);
  assert.deepEqual(JSON.parse(r.stdout),{result:-1,errno:constants.errno[error],delivery,consumed,writes:consumed,closes:consumed,execed});
 });
 t.diagnostic(JSON.stringify(evidence));
});

test('producer-admission-go-integration',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-admission-go-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);



 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <sys/wait.h>
#include <signal.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
static int active=0,syncs=0,sender_fd=-1,store_fd=-1,sent=0,cleanup_fault=0;
static const char *fault,*store_path;
static char binding[65];
static void before_send(void);
static int test_fsync(int fd){
 if(active){
  ++syncs;
  if(!strncmp(fault,"sync-",5) && syncs==atoi(fault+5)){errno=EIO;return -1;}
  if(!strcmp(fault,"replace-commit") && syncs==4){
   char bytes[75];int in=openat(store_fd,"admitted.commit",O_RDONLY),out;
   if(in<0 || read(in,bytes,sizeof(bytes))!=sizeof(bytes) || close(in)<0 || unlinkat(store_fd,"admitted.commit",0)<0)_exit(88);
   out=openat(store_fd,"admitted.commit",O_WRONLY|O_CREAT|O_EXCL,0600);
   if(out<0 || write(out,bytes,sizeof(bytes))!=sizeof(bytes) || fsync(out)<0 || close(out)<0)_exit(89);
  }
 }
 return fsync(fd);
}
static ssize_t test_write(int fd,const void *b,size_t n){
 if(active && fd==sender_fd){
  before_send();++sent;
  if(!strcmp(fault,"kill-before")){kill(getpid(),SIGKILL);_exit(90);}
  if(!strcmp(fault,"write-error") || !strcmp(fault,"double-error")){errno=EIO;return -1;}
 }
 return write(fd,b,n);
}
static int test_close(int fd){
 int r=close(fd);
 if(active && fd==sender_fd){
  if(!strcmp(fault,"kill-after")){kill(getpid(),SIGKILL);_exit(91);}
  if(!strcmp(fault,"close-error") || !strcmp(fault,"double-error")){errno=EBADF;return -1;}
 }
 if(active && sent && fd!=sender_fd && !strcmp(fault,"cleanup-error") && !cleanup_fault++){errno=EBADF;return -1;}
 return r;
}
static int test_flock(int fd,int op){
 int r=flock(fd,op);
 if(active && op==LOCK_UN && !strcmp(fault,"unlock-error")){errno=EIO;return -1;}
 return r;
}
#define fsync test_fsync
#define write test_write
#define close test_close
#define flock test_flock
#define main preflight_main
#include "helper.c"
#undef main
#undef fsync
#undef write
#undef close
#undef flock
static void before_send(void){
 int phase=-1;
 if(syncs!=4 || pd_scan(store_fd,binding,&phase)<0 || phase!=PD_ADMITTED)_exit(82);
 /* Independent open description must not close admission during GO write. */
 pid_t contender=fork();if(contender<0)_exit(83);
 if(!contender){
  active=0;int other=open(store_path,O_RDONLY|O_DIRECTORY|O_CLOEXEC);
  if(other<0)_exit(84);
  int r=pd_admission_append(other,binding,PD_ADMITTED,PD_CLOSED),e=errno;
  close(other);_exit(r==-1 && (e==EWOULDBLOCK || e==EAGAIN)?0:85);
 }
 int status;if(waitpid(contender,&status,0)!=contender || !WIFEXITED(status) || WEXITSTATUS(status))_exit(86);
}
int main(int argc,char **argv){
 if(argc==3 && !strcmp(argv[1],"--probe")){
  int out=atoi(argv[2]),fds[PD_FD_SCAN_MAX];size_t count=0;
  if(pd_fd_snapshot(fds,&count)<0 || count!=1 || fds[0]!=out)return 80;
  return write(out,"OK",2)==2?0:81;
 }
 if(argc!=3)return 64;fault=argv[1];store_path=argv[2];signal(SIGPIPE,SIG_IGN);
 memset(binding,'a',64);binding[64]=0;
 store_fd=open(store_path,O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(store_fd<0)return 65;
 if(strcmp(fault,"retry") && strcmp(fault,"empty")){
  if(pd_admission_append(store_fd,binding,PD_EMPTY,PD_PREPARED)<0)return 66;
  if(!strcmp(fault,"admitted") && pd_admission_append(store_fd,binding,PD_PREPARED,PD_ADMITTED)<0)return 67;
  if(!strcmp(fault,"closed") && pd_admission_append(store_fd,binding,PD_PREPARED,PD_CLOSED)<0)return 68;
 }
 struct pd_control_pipe pair={.receiver={.fd=-1},.sender={.fd=-1}};
 if(pd_control_pipe_open(&pair)<0)return 69;sender_fd=pair.sender.fd;
 int output[2];if(pipe(output)<0)return 70;
 pid_t child=fork();if(child<0)return 71;
 if(!child){
  struct pd_fd_entry work={.fd=output[1],.role=PD_PIPE_WRITE};
  if(fstat(work.fd,&work.identity)<0)_exit(72);
  if(pd_setup_wait(&work,1,&pair.receiver,&pair.sender,binding,1000)<0)_exit(2);
  char fd[24];snprintf(fd,sizeof(fd),"%d",work.fd);
  execl(argv[0],argv[0],"--probe",fd,(char*)NULL);_exit(73);
 }
 close(output[1]);close(pair.receiver.fd);
 int crashing=!strncmp(fault,"kill-",5);pid_t publisher=0;
 if(crashing){publisher=fork();if(publisher<0)return 74;}
 int held_lock=-1;
 if(!strcmp(fault,"lock-busy")){
  held_lock=open(store_path,O_RDONLY|O_DIRECTORY|O_CLOEXEC);
  if(held_lock<0 || flock(held_lock,LOCK_EX|LOCK_NB)<0)return 78;
 }
 int initial_fds[PD_FD_SCAN_MAX];size_t initial_count=0;
 if(pd_fd_snapshot(initial_fds,&initial_count)<0)return 79;
 int result=0,error=0;enum pd_go_delivery delivery=PD_GO_NOT_ATTEMPTED;
 if(!crashing || !publisher){
  if(!strcmp(fault,"signal-default"))signal(SIGPIPE,SIG_DFL);
  active=1;
  result=pd_admission_publish(store_fd,!strcmp(fault,"binding")?"invalid":binding,
    !strcmp(fault,"null-sender")?NULL:&pair.sender,!strcmp(fault,"null-result")?NULL:&delivery);
  error=result<0?errno:0;active=0;
  if(crashing)_exit(87);
 }
 if(!crashing){
  int final_fds[PD_FD_SCAN_MAX];size_t final_count=0;
  if(pd_fd_snapshot(final_fds,&final_count)<0 || final_count!=initial_count-(pair.sender.fd<0?1U:0U))return 92;
 }
 if(held_lock>=0)close(held_lock);
 if(crashing || pair.sender.fd>=0)close(sender_fd);
 close(store_fd);
 int killed=0,status;
 if(crashing){if(waitpid(publisher,&status,0)!=publisher || !WIFSIGNALED(status) || WTERMSIG(status)!=SIGKILL)return 75;killed=1;}
 char got[2];ssize_t n=read(output[0],got,2);close(output[0]);
 if(waitpid(child,&status,0)!=child || !WIFEXITED(status))return 76;
 int execed=WEXITSTATUS(status)==0 && n==2 && !memcmp(got,"OK",2);
 if(!execed && (WEXITSTATUS(status)!=2 || n!=0))return 77;
 if(crashing){printf("{\"killed\":%d,\"execed\":%d}\n",killed,execed);return 0;}
 printf("{\"result\":%d,\"errno\":%d,\"delivery\":%d,\"sent\":%d,\"execed\":%d}\n",result,error,delivery,sent,execed);
 return result<0?2:0;
}
`;
 fs.writeFileSync(join(dir,'input'),'hello');fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'pipe-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'ADMISSION_GO',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};


 let serial=0;
 const invoke=(fault,store)=>{const r=spawnSync(binary,[fault,store],{env,encoding:'utf8',timeout:5000});evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);assert.equal(r.signal,null);return r;};
 const run=fault=>{const store=join(dir,'store-'+serial++);fs.mkdirSync(store,{mode:0o700});const r=invoke(fault,store);return {r,store};};
 const retry=(store,expected)=>{const before=tree(store),r=invoke('retry',store);assert.equal(r.status,2,r.stdout+r.stderr);assert.deepEqual(JSON.parse(r.stdout),{result:-1,errno:constants.errno[expected],delivery:0,sent:0,execed:0});assert.deepEqual(tree(store),before);};
 await t.test('fresh durable admission holds exclusion through GO and real exec then refuses new-process retry',()=>{
  const {r,store}=run('normal');assert.equal(r.status,0,r.stdout+r.stderr);assert.deepEqual(JSON.parse(r.stdout),{result:0,errno:0,delivery:2,sent:1,execed:1});assert.deepEqual(fs.readdirSync(store).sort(),['admitted.commit','admitted.intent','prepared.commit','prepared.intent']);retry(store,'ESTALE');
 });
 for(let i=1;i<=4;i++)await t.test('admission fsync failure never sends GO or retries sync-'+i,()=>{
  const {r,store}=run('sync-'+i);assert.equal(r.status,2,r.stdout+r.stderr);assert.deepEqual(JSON.parse(r.stdout),{result:-1,errno:constants.errno.EIO,delivery:0,sent:0,execed:0});assert.ok(fs.existsSync(join(store,'admitted.intent')));retry(store,i<=2?'EINPROGRESS':'ESTALE');
 });
 for(const [fault,error,delivery,sent,execed]of [
  ['replace-commit','ESTALE',0,0,0],['lock-busy','EWOULDBLOCK',0,0,0],['empty','ESTALE',0,0,0],['admitted','ESTALE',0,0,0],['closed','ESTALE',0,0,0],
  ['write-error','EIO',1,1,0],['double-error','EIO',1,1,0],['close-error','EBADF',1,1,1],
  ['cleanup-error','EBADF',2,1,1],['unlock-error','EIO',2,1,1],['signal-default','EPERM',0,0,0],
  ['binding','EINVAL',0,0,0],['null-sender','EINVAL',0,0,0],['null-result','EINVAL',0,0,0]
 ])await t.test('admission and GO retain records and delivery state '+fault,()=>{
  const {r,store}=run(fault);assert.equal(r.status,2,r.stdout+r.stderr);assert.deepEqual(JSON.parse(r.stdout),{result:-1,errno:constants.errno[error],delivery,sent,execed});
  if(!['binding','null-sender','null-result','lock-busy'].includes(fault))retry(store,'ESTALE');
  if(fault==='lock-busy')assert.deepEqual(fs.readdirSync(store).sort(),['prepared.commit','prepared.intent']);
 });
 for(const [fault,execed]of [['kill-before',0],['kill-after',1]])await t.test('publisher SIGKILL preserves ADMITTED without replay '+fault,()=>{
  const {r,store}=run(fault);assert.equal(r.status,0,r.stdout+r.stderr);assert.deepEqual(JSON.parse(r.stdout),{killed:1,execed});assert.ok(fs.existsSync(join(store,'admitted.commit')));retry(store,'ESTALE');
 });
 t.diagnostic(JSON.stringify(evidence));
});

test('producer-pending-admission-cancel',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-admission-cancel-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);



 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <sys/wait.h>
#include <signal.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
static int active=0,syncs=0,sender_fd=-1,store_fd=-1,closes=0,cleanup_fault=0,writes=0;
static const char *fault,*store_path;
static char binding[65];
static void before_close(void);
static int test_fsync(int fd){
 if(active){
  ++syncs;
  if(!strncmp(fault,"sync-",5) && syncs==atoi(fault+5)){errno=EIO;return -1;}
  if(!strcmp(fault,"kill-sync") && syncs==2){kill(getpid(),SIGKILL);_exit(88);}
  if(!strcmp(fault,"replace-commit") && syncs==4){
   char bytes[75];int in=openat(store_fd,"closed.commit",O_RDONLY),out;
   if(in<0 || read(in,bytes,sizeof(bytes))!=sizeof(bytes) || close(in)<0 || unlinkat(store_fd,"closed.commit",0)<0)_exit(89);
   out=openat(store_fd,"closed.commit",O_WRONLY|O_CREAT|O_EXCL,0600);
   if(out<0 || write(out,bytes,sizeof(bytes))!=sizeof(bytes) || fsync(out)<0 || close(out)<0)_exit(90);
  }
  if(!strcmp(fault,"sender-replaced") && syncs==4){
   int p[2];if(pipe(p)<0 || dup2(p[1],sender_fd)<0 || close(p[0])<0 || close(p[1])<0)_exit(91);
  }
 }
 return fsync(fd);
}
static ssize_t test_write(int fd,const void *b,size_t n){if(active && fd==sender_fd)++writes;return write(fd,b,n);}
static int test_close(int fd){
 if(active && fd==sender_fd){
  before_close();++closes;
  if(!strcmp(fault,"kill-before")){kill(getpid(),SIGKILL);_exit(92);}
  if(!strcmp(fault,"close-eintr")){errno=EINTR;return -1;}
 }
 int r=close(fd);
 if(active && fd==sender_fd){
  if(!strcmp(fault,"kill-after")){kill(getpid(),SIGKILL);_exit(93);}
  if(!strcmp(fault,"close-error") || !strcmp(fault,"double-error")){errno=EBADF;return -1;}
 }
 if(active && closes && fd!=sender_fd && (!strcmp(fault,"cleanup-error") || !strcmp(fault,"double-error")) && !cleanup_fault++){errno=EIO;return -1;}
 return r;
}
static int test_flock(int fd,int op){int r=flock(fd,op);if(active && op==LOCK_UN && !strcmp(fault,"unlock-error")){errno=EIO;return -1;}return r;}
#define fsync test_fsync
#define write test_write
#define close test_close
#define flock test_flock
#define main preflight_main
#include "helper.c"
#undef main
#undef fsync
#undef write
#undef close
#undef flock
static void before_close(void){
 int phase=-1;if(syncs!=4 || pd_scan(store_fd,binding,&phase)<0 || phase!=PD_CLOSED)_exit(82);
 pid_t contender=fork();if(contender<0)_exit(83);
 if(!contender){
  active=0;int other=open(store_path,O_RDONLY|O_DIRECTORY|O_CLOEXEC);
  if(other<0)_exit(84);
  struct pd_control_pipe pair={.receiver={.fd=-1},.sender={.fd=-1}};
  if(pd_control_pipe_open(&pair)<0)_exit(85);
  enum pd_go_delivery delivery;int r=pd_admission_publish(other,binding,&pair.sender,&delivery),e=errno;
  _exit(r==-1 && (e==EWOULDBLOCK || e==EAGAIN) && delivery==PD_GO_NOT_ATTEMPTED?0:86);
 }
 int status;if(waitpid(contender,&status,0)!=contender || !WIFEXITED(status) || WEXITSTATUS(status))_exit(87);
}
int main(int argc,char **argv){
 if(argc==3 && !strcmp(argv[1],"--probe")){int out=atoi(argv[2]);return write(out,"EXEC",4)==4?0:81;}
 if(argc!=3)return 64;fault=argv[1];store_path=argv[2];signal(SIGPIPE,SIG_IGN);
 memset(binding,'a',64);binding[64]=0;
 store_fd=open(store_path,O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(store_fd<0)return 65;
 if(strcmp(fault,"retry") && strcmp(fault,"publish-retry") && strcmp(fault,"empty")){
  if(pd_admission_append(store_fd,binding,PD_EMPTY,PD_PREPARED)<0)return 66;
  if(!strcmp(fault,"admitted") && pd_admission_append(store_fd,binding,PD_PREPARED,PD_ADMITTED)<0)return 67;
  if(!strcmp(fault,"closed") && pd_admission_append(store_fd,binding,PD_PREPARED,PD_CLOSED)<0)return 68;
 }
 struct pd_control_pipe pair={.receiver={.fd=-1},.sender={.fd=-1}};
 if(pd_control_pipe_open(&pair)<0)return 69;sender_fd=pair.sender.fd;
 int output[2];if(pipe(output)<0)return 70;
 pid_t child=fork();if(child<0)return 71;
 if(!child){
  struct pd_fd_entry work={.fd=output[1],.role=PD_PIPE_WRITE};if(fstat(work.fd,&work.identity)<0)_exit(72);
  if(pd_setup_wait(&work,1,&pair.receiver,&pair.sender,binding,500)<0)_exit(errno==EPROTO?2:errno==ETIMEDOUT?3:4);
  char fd[24];snprintf(fd,sizeof(fd),"%d",work.fd);execl(argv[0],argv[0],"--probe",fd,(char*)NULL);_exit(73);
 }
 close(output[1]);close(pair.receiver.fd);
 if(!strcmp(fault,"publish-wins")){
  enum pd_go_delivery delivery;
  if(pd_admission_publish(store_fd,binding,&pair.sender,&delivery)<0 || delivery!=PD_GO_COMPLETE)return 96;
  struct pd_control_pipe replacement={.receiver={.fd=-1},.sender={.fd=-1}};
  if(pd_control_pipe_open(&replacement)<0 || close(replacement.receiver.fd)<0)return 97;
  pair.sender=replacement.sender;sender_fd=pair.sender.fd;
 }
 if(!strcmp(fault,"blocking"))fcntl(sender_fd,F_SETFL,fcntl(sender_fd,F_GETFL)&~O_NONBLOCK);
 if(!strcmp(fault,"inheritable"))fcntl(sender_fd,F_SETFD,0);
 if(!strcmp(fault,"stale"))pair.sender.identity.st_ino++;
 if(!strcmp(fault,"role"))pair.sender.role=PD_PIPE_READ;
 int held_lock=-1;if(!strcmp(fault,"lock-busy")){held_lock=open(store_path,O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(held_lock<0 || flock(held_lock,LOCK_EX|LOCK_NB)<0)return 78;}
 int crashing=!strncmp(fault,"kill-",5);pid_t publisher=0;if(crashing){publisher=fork();if(publisher<0)return 74;}
 int initial_fds[PD_FD_SCAN_MAX];size_t initial_count=0;if(pd_fd_snapshot(initial_fds,&initial_count)<0)return 79;
 int result=0,error=0;
 if(!crashing || !publisher){
  active=1;
  if(!strcmp(fault,"publish-retry")){enum pd_go_delivery delivery;result=pd_admission_publish(store_fd,binding,&pair.sender,&delivery);}
  else result=pd_admission_cancel(store_fd,!strcmp(fault,"binding")?"invalid":binding,!strcmp(fault,"null-sender")?NULL:&pair.sender);
  error=result<0?errno:0;active=0;if(crashing)_exit(94);
 }
 int consumed=pair.sender.fd<0;
 if(!crashing){int final_fds[PD_FD_SCAN_MAX];size_t final_count=0;if(pd_fd_snapshot(final_fds,&final_count)<0 || final_count!=initial_count-(consumed && strcmp(fault,"close-eintr")?1U:0U))return 95;}
 if(held_lock>=0)close(held_lock);
 if(crashing || !consumed)close(sender_fd);
 close(store_fd);int killed=0,status;
 if(crashing){if(waitpid(publisher,&status,0)!=publisher || !WIFSIGNALED(status) || WTERMSIG(status)!=SIGKILL)return 75;killed=1;}
 char got[4];ssize_t n=read(output[0],got,4);close(output[0]);
 if(waitpid(child,&status,0)!=child || !WIFEXITED(status))return 76;
 int child_exit=WEXITSTATUS(status),execed=child_exit==0 && n==4 && !memcmp(got,"EXEC",4);
 if(!execed && (n!=0 || (child_exit!=2 && child_exit!=3)))return 77;
 if(crashing){printf("{\"killed\":%d,\"execed\":%d}\n",killed,execed);return 0;}
 printf("{\"result\":%d,\"errno\":%d,\"consumed\":%d,\"closes\":%d,\"writes\":%d,\"execed\":%d,\"childExit\":%d}\n",result,error,consumed,closes,writes,execed,child_exit);
 return result<0?2:0;
}
`;
 fs.writeFileSync(join(dir,'input'),'hello');fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'pipe-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'ADMISSION_CANCEL',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};



 let serial=0;
 const invoke=(fault,store)=>{const r=spawnSync(binary,[fault,store],{env,encoding:'utf8',timeout:5000});evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);assert.equal(r.signal,null);return r;};
 const run=fault=>{const store=join(dir,'store-'+serial++);fs.mkdirSync(store,{mode:0o700});return {r:invoke(fault,store),store};};
 const retry=(store,error)=>{for(const mode of ['retry','publish-retry']){const before=tree(store),r=invoke(mode,store);assert.equal(r.status,2,r.stdout+r.stderr);const v=JSON.parse(r.stdout);assert.equal(v.errno,constants.errno[error]);assert.equal(v.writes,0);assert.equal(v.execed,0);assert.equal(v.consumed,0);assert.equal(v.closes,0);assert.deepEqual(tree(store),before);}};
 await t.test('PREPARED cancellation persists CLOSED before closing sender under exclusion and setup refuses exec',()=>{
  const {r,store}=run('normal');assert.equal(r.status,0,r.stdout+r.stderr);assert.deepEqual(JSON.parse(r.stdout),{result:0,errno:0,consumed:1,closes:1,writes:0,execed:0,childExit:2});assert.deepEqual(fs.readdirSync(store).sort(),['closed.commit','closed.intent','prepared.commit','prepared.intent']);retry(store,'ESTALE');
 });
 await t.test('GO winner executes and cancellation rejects ADMITTED without claiming workload stop',()=>{
  const {r,store}=run('publish-wins');assert.equal(r.status,2,r.stdout+r.stderr);assert.deepEqual(JSON.parse(r.stdout),{result:-1,errno:constants.errno.ESTALE,consumed:0,closes:0,writes:0,execed:1,childExit:0});assert.deepEqual(fs.readdirSync(store).sort(),['admitted.commit','admitted.intent','prepared.commit','prepared.intent']);retry(store,'ESTALE');
 });
 for(let i=1;i<=4;i++)await t.test('cancellation fsync failure preserves partial records without consuming sender sync-'+i,()=>{
  const {r,store}=run('sync-'+i);assert.equal(r.status,2,r.stdout+r.stderr);assert.deepEqual(JSON.parse(r.stdout),{result:-1,errno:constants.errno.EIO,consumed:0,closes:0,writes:0,execed:0,childExit:2});assert.ok(fs.existsSync(join(store,'closed.intent')));retry(store,i<=2?'EINPROGRESS':'ESTALE');
 });
 for(const [fault,error,consumed,closes,childExit]of [
  ['replace-commit','ESTALE',0,0,2],['sender-replaced','ESTALE',0,0,2],['lock-busy','EWOULDBLOCK',0,0,2],
  ['empty','ESTALE',0,0,2],['admitted','ESTALE',0,0,2],['closed','ESTALE',0,0,2],
  ['close-error','EBADF',1,1,2],['double-error','EBADF',1,1,2],['close-eintr','EINTR',1,1,3],
  ['cleanup-error','EIO',1,1,2],['unlock-error','EIO',1,1,2],
  ['binding','EINVAL',0,0,2],['null-sender','EINVAL',0,0,2],['blocking','EPERM',0,0,2],['inheritable','EPERM',0,0,2],['stale','ESTALE',0,0,2],['role','EINVAL',0,0,2]
 ])await t.test('pending cancellation refuses or preserves first error '+fault,()=>{
  const {r,store}=run(fault);assert.equal(r.status,2,r.stdout+r.stderr);assert.deepEqual(JSON.parse(r.stdout),{result:-1,errno:constants.errno[error],consumed,closes,writes:0,execed:0,childExit});
  if(!['binding','null-sender','lock-busy','blocking','inheritable','stale','role'].includes(fault))retry(store,'ESTALE');
  else assert.deepEqual(fs.readdirSync(store).sort(),['prepared.commit','prepared.intent']);
 });
 for(const [fault,error]of [['kill-sync','EINPROGRESS'],['kill-before','ESTALE'],['kill-after','ESTALE']])await t.test('cancel worker SIGKILL never permits fresh-process GO '+fault,()=>{
  const {r,store}=run(fault);assert.equal(r.status,0,r.stdout+r.stderr);assert.deepEqual(JSON.parse(r.stdout),{killed:1,execed:0});retry(store,error);
 });
 t.diagnostic(JSON.stringify(evidence));
});

test('producer-setup-child-reaping',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-setup-reaping-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);



 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include <signal.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
static const char *fault;
static int active=0,waits=0,sleeps=0,clocks=0,reaped=0,queries=0;
static pid_t expected;
static pid_t test_waitpid(pid_t p,int *s,int options){
 if(active){
  ++waits;if(p!=expected || options!=WNOHANG)_exit(81);
  if(!strcmp(fault,"wait-error")){errno=EIO;return -1;}
  if(!strcmp(fault,"wait-storm") || (!strcmp(fault,"wait-eintr") && waits<=2)){errno=EINTR;return -1;}
  if(!strcmp(fault,"nonterminal")){*s=(SIGSTOP<<8)|0x7f;return p;}
 }
 pid_t r=waitpid(p,s,options);if(active && r>0)reaped=1;return r;
}
static int test_clock(clockid_t id,struct timespec *t){
 if(active){
  ++clocks;
  if(!strcmp(fault,"clock-start") || (!strcmp(fault,"clock-later") && clocks==3) || (!strcmp(fault,"post-reap-clock") && reaped)){errno=EIO;return -1;}
 }
 int r=clock_gettime(id,t);if(active && !strcmp(fault,"clock-backward") && clocks==2)t->tv_sec=0;return r;
}
static int test_sleep(const struct timespec *t,struct timespec *r){
 if(active){
  ++sleeps;
  if(!strcmp(fault,"sleep-error")){errno=EIO;return -1;}
  if(!strcmp(fault,"sleep-eintr")){errno=EINTR;return -1;}
 }
 return nanosleep(t,r);
}
static int test_sigaction(int sig,const struct sigaction *a,struct sigaction *old){
 if(active){++queries;if(sig!=SIGCHLD || a!=NULL)_exit(82);if(!strcmp(fault,"sigaction-error")){errno=EIO;return -1;}}
 return sigaction(sig,a,old);
}
#define waitpid test_waitpid
#define clock_gettime test_clock
#define nanosleep test_sleep
#define sigaction(s,a,o) test_sigaction(s,a,o)
#define main preflight_main
#include "helper.c"
#undef main
#undef waitpid
#undef clock_gettime
#undef nanosleep
#undef sigaction
static void handler(int sig){(void)sig;}
int main(int argc,char **argv){
 if(argc==2 && !strcmp(argv[1],"--probe"))return 17;
 if(argc!=3)return 64;fault=argv[1];signal(SIGPIPE,SIG_IGN);
 struct sigaction original={0},chosen={0};sigaction(SIGCHLD,NULL,&original);chosen.sa_handler=SIG_DFL;sigemptyset(&chosen.sa_mask);if(sigaction(SIGCHLD,&chosen,NULL)<0)return 65;
 int trigger[2];if(pipe(trigger)<0)return 66;
 struct pd_control_pipe pair={.receiver={.fd=-1},.sender={.fd=-1}};if(pd_control_pipe_open(&pair)<0)return 67;
 char binding[65];memset(binding,'a',64);binding[64]=0;
 int integrated=!strcmp(fault,"cancel") || !strcmp(fault,"go");
 int live=strcmp(fault,"normal") && strcmp(fault,"wait-eintr") && strcmp(fault,"post-reap-clock") && strcmp(fault,"already-reaped") && strcmp(fault,"signal") && !integrated;
 pid_t child=fork();if(child<0)return 68;
 if(!child){
  close(trigger[1]);
  if(integrated){
   if(pd_setup_wait(NULL,0,&pair.receiver,&pair.sender,binding,1000)<0)_exit(errno==EPROTO?42:80);
   execl(argv[0],argv[0],"--probe",(char*)NULL);_exit(83);
  }
  close(pair.receiver.fd);close(pair.sender.fd);
  if(live || !strcmp(fault,"signal")){char byte;(void)read(trigger[0],&byte,1);}
  _exit(17);
 }
 close(trigger[0]);close(pair.receiver.fd);
 if(!strcmp(fault,"signal")){if(kill(child,SIGKILL)<0)return 69;}
 if(integrated){
  int store=open(argv[2],O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(store<0 || pd_admission_append(store,binding,PD_EMPTY,PD_PREPARED)<0)return 70;
  if(!strcmp(fault,"cancel")){if(pd_admission_cancel(store,binding,&pair.sender)<0)return 71;}
  else{enum pd_go_delivery d;if(pd_admission_publish(store,binding,&pair.sender,&d)<0 || d!=PD_GO_COMPLETE)return 72;}
  close(store);
 }else close(pair.sender.fd);
 int actual_status=0;if(!strcmp(fault,"already-reaped") && waitpid(child,&actual_status,0)!=child)return 73;
 int other_pipe[2];if(pipe(other_pipe)<0)return 85;
 pid_t unrelated=fork();if(unrelated<0)return 74;if(!unrelated){close(other_pipe[1]);char byte;(void)read(other_pipe[0],&byte,1);_exit(55);}
 close(other_pipe[0]);
 if(!strcmp(fault,"stopped")){int stopped;if(kill(child,SIGSTOP)<0 || waitpid(child,&stopped,WUNTRACED)!=child || !WIFSTOPPED(stopped) || WSTOPSIG(stopped)!=SIGSTOP)return 86;}
 pid_t handle=child;
 if(!strcmp(fault,"zero"))handle=0;if(!strcmp(fault,"negative"))handle=-1;
 if(!strcmp(fault,"self"))handle=getpid();if(!strcmp(fault,"foreign"))handle=getppid();expected=handle;
 if(!strcmp(fault,"ignore"))chosen.sa_handler=SIG_IGN;
 if(!strcmp(fault,"handler"))chosen.sa_handler=handler;
 if(!strcmp(fault,"auto-reap"))chosen.sa_flags=SA_NOCLDWAIT;
 if(sigaction(SIGCHLD,&chosen,NULL)<0)return 75;
 struct sigaction before,after;sigaction(SIGCHLD,NULL,&before);
 int fds[PD_FD_SCAN_MAX];size_t count=0,final_count=0;if(pd_fd_snapshot(fds,&count)<0)return 76;
 int timeout=live?60:1000;if(!strcmp(fault,"zero-timeout"))timeout=0;if(!strcmp(fault,"large-timeout"))timeout=60001;
 int status=12345;struct timespec start,finish;clock_gettime(CLOCK_MONOTONIC,&start);
 active=1;int r=pd_setup_reap(!strcmp(fault,"null-child")?NULL:&handle,timeout,!strcmp(fault,"null-status")?NULL:&status),error=r<0?errno:0;active=0;
 int initially_consumed=handle==-1;
 clock_gettime(CLOCK_MONOTONIC,&finish);sigaction(SIGCHLD,NULL,&after);
 if(before.sa_handler!=after.sa_handler || before.sa_flags!=after.sa_flags || pd_fd_snapshot(fds,&final_count)<0 || count!=final_count)return 77;
 chosen.sa_handler=SIG_DFL;chosen.sa_flags=0;sigaction(SIGCHLD,&chosen,NULL);
 close(other_pipe[1]);int other_status;if(waitpid(unrelated,&other_status,0)!=unrelated || !WIFEXITED(other_status) || WEXITSTATUS(other_status)!=55)return 78;
 if(!strcmp(fault,"stopped") && kill(child,SIGCONT)<0)return 87;
 close(trigger[1]);
 int requery=-9,requery_status=12345;
 if(!strcmp(fault,"timeout") || !strcmp(fault,"stopped")){
  active=1;requery=pd_setup_reap(&handle,1000,&requery_status);active=0;
  if(requery || !WIFEXITED(requery_status) || WEXITSTATUS(requery_status)!=17)return 88;
 }
 if(!reaped && strcmp(fault,"already-reaped")){if(waitpid(child,&actual_status,0)!=child)return 79;}
 if(reaped){errno=0;if(waitpid(child,&actual_status,WNOHANG)!=-1 || errno!=ECHILD)return 84;}
 int retry_status=23456,retry=-9,retry_error=0;
 if(!r){active=1;retry=pd_setup_reap(&handle,100,&retry_status);retry_error=errno;active=0;}
 long elapsed=(finish.tv_sec-start.tv_sec)*1000+(finish.tv_nsec-start.tv_nsec)/1000000;
 printf("{\"result\":%d,\"errno\":%d,\"consumed\":%d,\"status\":%d,\"exited\":%d,\"exit\":%d,\"signal\":%d,\"waits\":%d,\"sleeps\":%d,\"queries\":%d,\"elapsed\":%ld,\"retry\":%d,\"retryErrno\":%d,\"retryStatus\":%d,\"requery\":%d,\"requeryStatus\":%d}\n",r,error,initially_consumed,status,!r&&WIFEXITED(status),!r&&WIFEXITED(status)?WEXITSTATUS(status):-1,!r&&WIFSIGNALED(status)?WTERMSIG(status):0,waits,sleeps,queries,elapsed,retry,retry_error,retry_status,requery,requery_status);
 sigaction(SIGCHLD,&original,NULL);return r<0?2:0;
}
`;
 fs.writeFileSync(join(dir,'input'),'hello');fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'pipe-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'SETUP_REAP',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};




 let serial=0;
 const run=fault=>{const store=join(dir,'store-'+serial++);fs.mkdirSync(store,{mode:0o700});const r=spawnSync(binary,[fault,store],{env,encoding:'utf8',timeout:5000});evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.ok([0,2].includes(r.status),r.stdout+r.stderr+' exit '+r.status);return {r,v:JSON.parse(r.stdout),store};};
 for(const [fault,exit,signal]of [['normal',17,0],['wait-eintr',17,0],['post-reap-clock',17,0],['signal',-1,constants.signals.SIGKILL],['cancel',42,0],['go',17,0]])await t.test('exact direct child terminal status is retained and consumed '+fault,()=>{
  const {r,v,store}=run(fault);assert.equal(r.status,0);assert.equal(v.result,0);assert.equal(v.errno,0);assert.equal(v.consumed,1);assert.equal(v.exit,exit);assert.equal(v.signal,signal);assert.equal(v.retry,-1);assert.equal(v.retryErrno,constants.errno.EINVAL);assert.equal(v.retryStatus,23456);
  if(fault==='cancel')assert.deepEqual(fs.readdirSync(store).sort(),['closed.commit','closed.intent','prepared.commit','prepared.intent']);
  else if(fault==='go')assert.deepEqual(fs.readdirSync(store).sort(),['admitted.commit','admitted.intent','prepared.commit','prepared.intent']);
  else assert.deepEqual(fs.readdirSync(store),[]);
 });
 for(const [fault,error,consumed]of [
  ['timeout','ETIMEDOUT',0],['stopped','ETIMEDOUT',0],['wait-storm','ETIMEDOUT',0],['sleep-eintr','ETIMEDOUT',0],
  ['wait-error','EIO',0],['clock-start','EIO',0],['clock-later','EIO',0],['clock-backward','ESTALE',0],['sleep-error','EIO',0],['sigaction-error','EIO',0],
  ['nonterminal','EPROTO',0],['already-reaped','ECHILD',1],['foreign','ECHILD',1],
  ['ignore','EPERM',0],['handler','EPERM',0],['auto-reap','EPERM',0],
  ['zero','EINVAL',0],['negative','EINVAL',1],['self','EINVAL',0],['null-child','EINVAL',0],['null-status','EINVAL',0],['zero-timeout','EINVAL',0],['large-timeout','EINVAL',0]
 ])await t.test('reaping refuses without inventing terminal status '+fault,()=>{
  const {r,v,store}=run(fault);assert.equal(r.status,2);assert.equal(v.result,-1);assert.equal(v.errno,constants.errno[error]);assert.equal(v.consumed,consumed);assert.equal(v.status,12345);assert.equal(v.signal,0);assert.equal(v.exit,-1);assert.deepEqual(fs.readdirSync(store),[]);
  if(['timeout','stopped'].includes(fault)){assert.equal(v.requery,0);assert.notEqual(v.requeryStatus,12345);}
  if(error==='ETIMEDOUT'){assert.ok(v.elapsed>=40,v.elapsed);assert.ok(v.elapsed<1500,v.elapsed);assert.ok(v.waits>0);}
  if(['EINVAL','EPERM'].includes(error) || fault==='sigaction-error' || fault==='clock-start' || fault==='clock-backward')assert.equal(v.waits,0);
 });
 t.diagnostic(JSON.stringify(evidence));
});

test('producer-cancel-reap-integration',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-cancel-reap-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);



 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include <sys/file.h>
#include <fcntl.h>
#include <signal.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
static const char *fault;
static int active=0,target=-1,syncs=0,closes=0,waits=0,reaped=0;
static pid_t expected;
static const char *store_path;
static int lock_checked=0;
static int test_fsync(int fd){
 if(active){++syncs;if(!strncmp(fault,"fsync-",6) && syncs==atoi(fault+6)){errno=EIO;return -1;}}
 return fsync(fd);
}
static int test_close(int fd){
 if(active && fd==target){++closes;
  if(!strcmp(fault,"close-eintr")){errno=EINTR;return -1;}
  if(!strcmp(fault,"close-error") || !strcmp(fault,"both-errors")){int r=close(fd);if(r<0)_exit(80);errno=EIO;return -1;}
 }
 return close(fd);
}
static int test_flock(int fd,int operation){
 if(active && operation==LOCK_UN && !strcmp(fault,"unlock-error")){errno=EIO;return -1;}
 return flock(fd,operation);
}
static pid_t test_waitpid(pid_t p,int *s,int options){
 if(active){++waits;if(p!=expected || options!=WNOHANG)_exit(81);
  if(!strcmp(fault,"lock-released") && !lock_checked){
   int fd=open(store_path,O_RDONLY|O_DIRECTORY|O_CLOEXEC);
   if(fd<0 || flock(fd,LOCK_EX|LOCK_NB)<0)_exit(83);
   if(flock(fd,LOCK_UN)<0 || close(fd)<0)_exit(84);lock_checked=1;
  }
  if(!strcmp(fault,"unlock-error") && !lock_checked){
   int fd=open(store_path,O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(fd<0)_exit(87);
   errno=0;if(flock(fd,LOCK_EX|LOCK_NB)!=-1 || errno!=EWOULDBLOCK)_exit(88);
   if(close(fd)<0)_exit(89);lock_checked=1;
  }
  if(!strcmp(fault,"wait-error") || !strcmp(fault,"both-errors")){errno=EACCES;return -1;}
 }
 pid_t r=waitpid(p,s,options);if(active && r>0)reaped=1;return r;
}
#define flock test_flock
#define fsync test_fsync
#define close test_close
#define waitpid test_waitpid
#define main preflight_main
#include "helper.c"
#undef main
#undef flock
#undef fsync
#undef close
#undef waitpid
static void handler(int sig){(void)sig;}
int main(int argc,char **argv){
 if(argc==2 && !strcmp(argv[1],"--probe"))return 17;
 if(argc!=3)return 64;fault=argv[1];store_path=argv[2];signal(SIGPIPE,SIG_IGN);
 struct sigaction original={0},chosen={0},before,after;sigaction(SIGCHLD,NULL,&original);chosen.sa_handler=SIG_DFL;sigemptyset(&chosen.sa_mask);if(sigaction(SIGCHLD,&chosen,NULL)<0)return 65;
 int store=open(argv[2],O_RDONLY|O_DIRECTORY|O_CLOEXEC);char binding[65];memset(binding,'a',64);binding[64]=0;
 if(store<0 || pd_admission_append(store,binding,PD_EMPTY,PD_PREPARED)<0)return 66;
 struct pd_control_pipe pair={.receiver={.fd=-1},.sender={.fd=-1}};if(pd_control_pipe_open(&pair)<0)return 67;
 int trigger[2];if(pipe(trigger)<0)return 68;
 int live=!strcmp(fault,"timeout") || !strcmp(fault,"signal");
 pid_t child=fork();if(child<0)return 69;
 if(!child){
  if(!strcmp(fault,"already-reaped"))_exit(17);
  if(live){close(trigger[1]);close(pair.sender.fd);char byte;(void)read(trigger[0],&byte,1);_exit(19);}
  if(pd_setup_wait(NULL,0,&pair.receiver,&pair.sender,binding,500)<0)_exit(errno==EPROTO?42:43);
  execl(argv[0],argv[0],"--probe",(char*)NULL);_exit(82);
 }
 close(trigger[0]);close(pair.receiver.fd);
 if(!strcmp(fault,"already-reaped")){int status;if(waitpid(child,&status,0)!=child)return 85;}
 if(!strcmp(fault,"signal") && kill(child,SIGKILL)<0)return 70;
 if(!strcmp(fault,"admitted")){
  enum pd_go_delivery d;if(pd_admission_publish(store,binding,&pair.sender,&d)<0 || d!=PD_GO_COMPLETE)return 71;
  pair.receiver.fd=-1;if(pd_control_pipe_open(&pair)<0)return 72;close(pair.receiver.fd);
 }
 int lock=-1;if(!strcmp(fault,"lock")){lock=open(argv[2],O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(lock<0 || flock(lock,LOCK_EX|LOCK_NB)<0)return 73;}
 target=pair.sender.fd;pid_t handle=child;
 if(!strcmp(fault,"zero"))handle=0;if(!strcmp(fault,"self"))handle=getpid();expected=handle;
 if(!strcmp(fault,"ignore"))chosen.sa_handler=SIG_IGN;
 if(!strcmp(fault,"handler"))chosen.sa_handler=handler;
 if(!strcmp(fault,"auto-reap"))chosen.sa_flags=SA_NOCLDWAIT;
 sigaction(SIGCHLD,&chosen,NULL);sigaction(SIGCHLD,NULL,&before);
 if(!strcmp(fault,"binding"))binding[0]='z';
 if(!strcmp(fault,"blocking")){int f=fcntl(target,F_GETFL,0);fcntl(target,F_SETFL,f&~O_NONBLOCK);}
 int timeout=(!strcmp(fault,"timeout") || !strcmp(fault,"close-eintr") || !strcmp(fault,"lock"))?50:1000;
 if(!strcmp(fault,"zero-timeout"))timeout=0;if(!strcmp(fault,"large-timeout"))timeout=60001;
 struct pd_cancel_reap_result result={9,9,9,9,9,9};
 int fds[PD_FD_SCAN_MAX];size_t count,final_count;if(pd_fd_snapshot(fds,&count)<0)return 74;
 active=1;int r=pd_setup_cancel_reap(store,binding,!strcmp(fault,"null-sender")?NULL:&pair.sender,!strcmp(fault,"null-child")?NULL:&handle,timeout,!strcmp(fault,"null-result")?NULL:&result),error=r<0?errno:0;active=0;
 sigaction(SIGCHLD,NULL,&after);if(before.sa_handler!=after.sa_handler || before.sa_flags!=after.sa_flags)return 75;
 if(pd_fd_snapshot(fds,&final_count)<0)return 76;
 int sender_open=fcntl(target,F_GETFD,0)>=0;
 if(count-final_count!=(size_t)(sender_open?0:1))return 77;
 chosen.sa_handler=SIG_DFL;chosen.sa_flags=0;sigaction(SIGCHLD,&chosen,NULL);
 if(lock>=0){flock(lock,LOCK_UN);close(lock);}
 if(sender_open)close(target);
 close(trigger[1]);int actual=0;
 if(!reaped && strcmp(fault,"already-reaped")){if(waitpid(child,&actual,0)!=child)return 78;}else{errno=0;if(waitpid(child,&actual,WNOHANG)!=-1 || errno!=ECHILD)return 79;}
 if(!strcmp(fault,"unlock-error") && flock(store,LOCK_UN)<0)return 90;
 int phase=-1;binding[0]='a';int inspected=pd_admission_inspect(store,binding,&phase),inspect_error=inspected<0?errno:0;
 printf("{\"result\":%d,\"errno\":%d,\"cancelAttempted\":%d,\"cancelError\":%d,\"reapAttempted\":%d,\"reapError\":%d,\"statusValid\":%d,\"exit\":%d,\"signal\":%d,\"consumed\":%d,\"senderConsumed\":%d,\"senderOpen\":%d,\"syncs\":%d,\"closes\":%d,\"waits\":%d,\"phase\":%d,\"inspectError\":%d}\n",r,error,result.cancel_attempted,result.cancel_error,result.reap_attempted,result.reap_error,result.status_valid,result.status_valid==1&&WIFEXITED(result.status)?WEXITSTATUS(result.status):-1,result.status_valid==1&&WIFSIGNALED(result.status)?WTERMSIG(result.status):0,handle==-1,pair.sender.fd==-1,sender_open,syncs,closes,waits,phase,inspect_error);
 if((!strcmp(fault,"lock-released") || !strcmp(fault,"unlock-error")) && !lock_checked)return 86;
 close(store);sigaction(SIGCHLD,&original,NULL);return r<0?2:0;
}
`;
 fs.writeFileSync(join(dir,'input'),'hello');fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'pipe-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'CANCEL_REAP',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};





 let serial=0;
 const run=fault=>{const store=join(dir,'store-'+serial++);fs.mkdirSync(store,{mode:0o700});const r=spawnSync(binary,[fault,store],{env,encoding:'utf8',timeout:5000});evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.ok([0,2].includes(r.status),r.stdout+r.stderr+' exit '+r.status);return {r,v:JSON.parse(r.stdout),store};};
 for(const [fault,exit,signal]of [['normal',42,0],['lock-released',42,0],['signal',-1,constants.signals.SIGKILL]])await t.test('cancellation and exact child terminal observation compose '+fault,()=>{
  const {r,v}=run(fault);assert.equal(r.status,0);assert.equal(v.cancelError,0);assert.equal(v.reapError,0);assert.equal(v.statusValid,1);assert.equal(v.exit,exit);assert.equal(v.signal,signal);assert.equal(v.consumed,1);assert.equal(v.senderConsumed,1);assert.equal(v.phase,3);assert.equal(v.syncs,4);assert.equal(v.closes,1);
 });
 for(const [fault,ce,re,valid,exit]of [
  ['fsync-1','EIO',null,1,43],['fsync-2','EIO',null,1,43],['fsync-3','EIO',null,1,43],['fsync-4','EIO',null,1,43],
  ['already-reaped',null,'ECHILD',0,-1],['unlock-error','EIO',null,1,42],['close-error','EIO',null,1,42],['both-errors','EIO','EACCES',0,-1],['wait-error',null,'EACCES',0,-1],
  ['close-eintr','EINTR','ETIMEDOUT',0,-1],['timeout',null,'ETIMEDOUT',0,-1],['lock','EWOULDBLOCK','ETIMEDOUT',0,-1],['admitted','ESTALE',null,1,17]
 ])await t.test('cancellation and reaping errors remain independent '+fault,()=>{
  const {r,v,store}=run(fault);assert.equal(r.status,2);assert.equal(v.cancelAttempted,1);assert.equal(v.reapAttempted,1);assert.equal(v.cancelError,ce?constants.errno[ce]:0);assert.equal(v.reapError,re?constants.errno[re]:0);assert.equal(v.errno,constants.errno[ce||re]);assert.equal(v.statusValid,valid);assert.equal(v.exit,exit);assert.equal(v.consumed,fault==='already-reaped'?1:valid);
  if(fault.startsWith('fsync-')){assert.equal(v.senderConsumed,0);assert.equal(v.closes,0);assert.ok(fs.existsSync(join(store,'closed.intent')));}
  if(fault==='close-eintr'){assert.equal(v.senderConsumed,1);assert.equal(v.senderOpen,1);assert.equal(v.closes,1);}
  if(fault==='admitted'){assert.equal(v.phase,2);assert.equal(v.syncs,0);assert.equal(v.senderConsumed,0);assert.equal(fs.existsSync(join(store,'closed.intent')),false);}
 });
 for(const [fault,error]of [['zero','EINVAL'],['self','EINVAL'],['null-child','EINVAL'],['null-result','EINVAL'],['null-sender','EINVAL'],['zero-timeout','EINVAL'],['large-timeout','EINVAL'],['binding','EINVAL'],['blocking','EPERM'],['ignore','EPERM'],['handler','EPERM'],['auto-reap','EPERM']])await t.test('prevalidation refuses before storage or wait '+fault,()=>{
  const {r,v,store}=run(fault);assert.equal(r.status,2);assert.equal(v.errno,constants.errno[error]);assert.equal(v.syncs,0);assert.equal(v.closes,0);assert.equal(v.waits,0);assert.equal(v.senderConsumed,0);assert.equal(v.consumed,0);assert.equal(v.phase,1);
  if(fault!=='null-result'){assert.equal(v.cancelAttempted,0);assert.equal(v.reapAttempted,0);assert.equal(v.statusValid,0);}
  assert.deepEqual(fs.readdirSync(store).sort(),['prepared.commit','prepared.intent']);
 });
 t.diagnostic(JSON.stringify(evidence));
});

test('producer-setup-reservation-integration',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-reserve-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);



 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include <sys/file.h>
#include <fcntl.h>
#include <signal.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
static const char *fault;
static int active=0,opened[2]={-1,-1},pipes=0,syncs=0,closes[2]={0,0};
static int test_pipe(int fds[2]){
 if(active){++pipes;if(!strcmp(fault,"pipe")){errno=EMFILE;return -1;}}
 int r=pipe(fds);if(active && !r){opened[0]=fds[0];opened[1]=fds[1];}return r;
}
static int test_fsync(int fd){
 if(active){++syncs;
  if((!strncmp(fault,"fsync-",6) && syncs==atoi(fault+6)) || (!strcmp(fault,"cleanup-eintr") && syncs==1)){errno=EIO;return -1;}
 }
 int r=fsync(fd);
 if(active && !r && ((!strcmp(fault,"crash-intent") && syncs==2) || (!strcmp(fault,"crash-commit") && syncs==4)))kill(getpid(),SIGKILL);
 return r;
}
static int test_close(int fd){
 if(active)for(int i=0;i<2;++i)if(fd==opened[i]){++closes[i];if(!strcmp(fault,"cleanup-eintr")){errno=EINTR;return -1;}}
 return close(fd);
}
static int test_flock(int fd,int op){if(active && op==LOCK_UN && !strcmp(fault,"unlock")){errno=EIO;return -1;}return flock(fd,op);}
#define pipe test_pipe
#define fsync test_fsync
#define close test_close
#define flock test_flock
#define main preflight_main
#include "helper.c"
#undef main
#undef pipe
#undef fsync
#undef close
#undef flock
int main(int argc,char **argv){
 if(argc==2 && !strcmp(argv[1],"--probe"))return 17;
 if(argc!=3)return 64;fault=argv[1];signal(SIGPIPE,SIG_IGN);
 int store=open(argv[2],O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(store<0)return 65;
 char binding[65];memset(binding,'a',64);binding[64]=0;
 if(!strcmp(fault,"prepared") || !strcmp(fault,"admitted") || !strcmp(fault,"closed")){
  if(pd_admission_append(store,binding,PD_EMPTY,PD_PREPARED)<0)return 66;
  if(!strcmp(fault,"admitted") && pd_admission_append(store,binding,PD_PREPARED,PD_ADMITTED)<0)return 67;
  if(!strcmp(fault,"closed") && pd_admission_append(store,binding,PD_PREPARED,PD_CLOSED)<0)return 68;
 }
 if(!strcmp(fault,"torn")){int fd=openat(store,"prepared.intent",O_CREAT|O_EXCL|O_WRONLY,0600);if(fd<0)return 69;close(fd);}
 int other=-1;if(!strcmp(fault,"lock")){other=open(argv[2],O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(other<0 || flock(other,LOCK_EX|LOCK_NB)<0)return 70;}
 struct pd_control_pipe result;memset(&result,0x5a,sizeof(result));result.receiver.fd=-1;result.sender.fd=-1;
 if(!strcmp(fault,"occupied"))result.sender.fd=store;
 struct pd_control_pipe before=result;
 if(!strcmp(fault,"binding"))binding[0]='z';
 if(!strcmp(fault,"directory"))fchmod(store,0755);
 int fds[PD_FD_SCAN_MAX];size_t first,last;if(pd_fd_snapshot(fds,&first)<0)return 71;
 active=1;int r=pd_setup_reserve(store,binding,!strcmp(fault,"null")?NULL:&result),error=r<0?errno:0;active=0;
 if(pd_fd_snapshot(fds,&last)<0)return 72;
 int unchanged=!memcmp(&before,&result,sizeof(result));
 int open_count=0;for(int i=0;i<2;++i)if(opened[i]>=0 && fcntl(opened[i],F_GETFD,0)>=0)++open_count;
 if((int)last-(int)first!=open_count)return 73;
 int child_exit=-1,retry=-1,phase=-1,inspect_error=0;
 if(other>=0){flock(other,LOCK_UN);close(other);}
 if(!strcmp(fault,"unlock") && flock(store,LOCK_UN)<0)return 74;
 if(!strcmp(fault,"directory"))fchmod(store,0700);binding[0]='a';
 if(pd_admission_inspect(store,binding,&phase)<0)inspect_error=errno;
 if(!r){
  if(syncs!=4 || phase!=PD_PREPARED || pd_go_channel_valid(&result.receiver)<0 || pd_pending_sender_valid(&result.sender)<0)return 75;
  pid_t child=fork();if(child<0)return 76;
  if(!child){if(pd_setup_wait(NULL,0,&result.receiver,&result.sender,binding,1000)<0)_exit(42);execl(argv[0],argv[0],"--probe",(char*)NULL);_exit(90);}
  close(result.receiver.fd);
  if(!strcmp(fault,"cancel")){struct pd_cancel_reap_result observed;if(pd_setup_cancel_reap(store,binding,&result.sender,&child,1000,&observed)<0 || !observed.status_valid)return 77;child_exit=WIFEXITED(observed.status)?WEXITSTATUS(observed.status):-1;}
  else {enum pd_go_delivery delivery;if(pd_admission_publish(store,binding,&result.sender,&delivery)<0 || delivery!=PD_GO_COMPLETE)return 78;int status;if(pd_setup_reap(&child,1000,&status)<0)return 79;child_exit=WIFEXITED(status)?WEXITSTATUS(status):-1;}
 }else for(int i=0;i<2;++i)if(opened[i]>=0 && fcntl(opened[i],F_GETFD,0)>=0)close(opened[i]);
 if(syncs || !strcmp(fault,"retry")){
  struct pd_control_pipe next={.receiver={.fd=-1},.sender={.fd=-1}};
  retry=pd_setup_reserve(store,binding,&next);if(retry==0)return 80;
  if(next.receiver.fd!=-1 || next.sender.fd!=-1)return 81;
 }
 printf("{\"result\":%d,\"errno\":%d,\"unchanged\":%d,\"pipes\":%d,\"syncs\":%d,\"closeRead\":%d,\"closeWrite\":%d,\"open\":%d,\"phase\":%d,\"inspectError\":%d,\"childExit\":%d,\"retry\":%d}\n",r,error,unchanged,pipes,syncs,closes[0],closes[1],open_count,phase,inspect_error,child_exit,retry);
 close(store);return r<0?2:0;
}
`;
 fs.writeFileSync(join(dir,'input'),'hello');fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'pipe-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'SETUP_RESERVE',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};





 let serial=0;
 const run=(fault,store)=>{const r=spawnSync(binary,[fault,store],{env,encoding:'utf8',timeout:5000});evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);return r;};
 const fresh=()=>{const store=join(dir,'store-'+serial++);fs.mkdirSync(store,{mode:0o700});return store;};
 for(const [fault,exit]of [['normal',17],['cancel',42]])await t.test('durable reservation precedes fork and '+fault,()=>{
  const r=run(fault,fresh());assert.equal(r.status,0,r.stdout+r.stderr);const v=JSON.parse(r.stdout);assert.equal(v.syncs,4);assert.equal(v.pipes,1);assert.equal(v.phase,1);assert.equal(v.open,2);assert.equal(v.childExit,exit);assert.equal(v.retry,-1);
 });
 for(const [fault,error]of [['pipe','EMFILE'],['fsync-1','EIO'],['fsync-2','EIO'],['fsync-3','EIO'],['fsync-4','EIO'],['unlock','EIO'],['cleanup-eintr','EIO'],['prepared','ESTALE'],['admitted','ESTALE'],['closed','ESTALE'],['torn','EINVAL'],['lock','EWOULDBLOCK']])await t.test('reservation failure preserves result and records '+fault,()=>{
  const store=fresh(),r=run(fault,store);assert.equal(r.status,2,r.stdout+r.stderr);const v=JSON.parse(r.stdout);assert.equal(v.errno,constants.errno[error]);assert.equal(v.unchanged,1);assert.equal(v.childExit,-1);assert.equal(v.open,fault==='cleanup-eintr'?2:0);
  assert.equal(v.closeRead,fault==='pipe'?0:1);assert.equal(v.closeWrite,fault==='pipe'?0:1);
  if(fault.startsWith('fsync-') || fault==='cleanup-eintr' || fault==='unlock'){assert.ok(fs.existsSync(join(store,'prepared.intent')));assert.equal(v.retry,-1);}
 });
 for(const [fault,error]of [['null','EINVAL'],['occupied','EINVAL'],['binding','EINVAL'],['directory','EPERM']])await t.test('invalid reservation refuses before pipe or storage '+fault,()=>{
  const store=fresh(),r=run(fault,store);assert.equal(r.status,2,r.stdout+r.stderr);const v=JSON.parse(r.stdout);assert.equal(v.errno,constants.errno[error]);assert.equal(v.unchanged,1);assert.equal(v.pipes,0);assert.equal(v.syncs,0);assert.deepEqual(fs.readdirSync(store),[]);
 });
 for(const fault of ['crash-intent','crash-commit'])await t.test('reservation crash preserves state and refuses new process '+fault,()=>{
  const store=fresh(),r=run(fault,store);assert.equal(r.status,null);assert.equal(r.signal,'SIGKILL');
  const snapshot=()=>fs.readdirSync(store).sort().map(n=>({name:n,bytes:fs.readFileSync(join(store,n)).toString('hex'),mtime:fs.statSync(join(store,n)).mtimeMs}));const before=snapshot();assert.ok(before.length>0);
  const retry=run('retry',store);assert.equal(retry.status,2,retry.stdout+retry.stderr);const v=JSON.parse(retry.stdout);assert.equal(v.unchanged,1);assert.equal(v.childExit,-1);assert.equal(v.open,0);assert.deepEqual(snapshot(),before);
 });
 t.diagnostic(JSON.stringify(evidence));
});

test('producer-setup-fork-handoff',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-fork-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);



 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <signal.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
static const char *fault;
static int active=0,forks=0,closes=0,receiver=-1;
static pid_t test_fork(void){
 ++forks;
 if(!strcmp(fault,"fork-eagain")){errno=EAGAIN;return -1;}
 if(!strcmp(fault,"fork-eintr")){errno=EINTR;return -1;}
 return fork();
}
static int test_close(int fd){
 if(active && fd==receiver){++closes;
  if(!strcmp(fault,"close-eintr")){errno=EINTR;return -1;}
  if(!strcmp(fault,"close-eio")){int r=close(fd);if(r<0)return r;errno=EIO;return -1;}
 }
 return close(fd);
}
static int test_sigaction(int sig,const struct sigaction *in,struct sigaction *out){
 if(active && !strcmp(fault,"sigaction")){errno=EACCES;return -1;}
 return sigaction(sig,in,out);
}
#define fork test_fork
#define close test_close
#define sigaction(...) test_sigaction(__VA_ARGS__)
#define main preflight_main
#include "helper.c"
#undef main
#undef fork
#undef close
#undef sigaction
static void handler(int sig){(void)sig;}
int main(int argc,char **argv){
 if(argc==2 && !strcmp(argv[1],"--probe"))return 17;
 if(argc!=3)return 64;fault=argv[1];signal(SIGPIPE,SIG_IGN);
 int store=open(argv[2],O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(store<0)return 65;
 char binding[65];memset(binding,'a',64);binding[64]=0;
 struct pd_control_pipe pair={.receiver={.fd=-1},.sender={.fd=-1}};
 if(pd_setup_reserve(store,binding,&pair)<0)return 66;
 receiver=pair.receiver.fd;int sender=pair.sender.fd;pid_t child=-1;
 if(!strcmp(fault,"occupied"))child=1;
 if(!strcmp(fault,"same"))pair.receiver.fd=pair.sender.fd;
 if(!strcmp(fault,"role"))pair.receiver.role=PD_PIPE_WRITE;
 if(!strcmp(fault,"identity"))pair.receiver.identity.st_ino++;
 if(!strcmp(fault,"reader-blocking"))fcntl(receiver,F_SETFL,fcntl(receiver,F_GETFL)&~O_NONBLOCK);
 if(!strcmp(fault,"sender-blocking"))fcntl(sender,F_SETFL,fcntl(sender,F_GETFL)&~O_NONBLOCK);
 if(!strcmp(fault,"sender-inherited"))fcntl(sender,F_SETFD,0);
 struct sigaction action;memset(&action,0,sizeof(action));sigemptyset(&action.sa_mask);action.sa_handler=SIG_DFL;
 if(!strcmp(fault,"sig-ignore"))action.sa_handler=SIG_IGN;
 if(!strcmp(fault,"sig-handler"))action.sa_handler=handler;
 if(!strcmp(fault,"sig-autoreap"))action.sa_flags=SA_NOCLDWAIT;
 if(sigaction(SIGCHLD,&action,NULL)<0 || sigaction(SIGCHLD,NULL,&action)<0)return 67;
 struct pd_control_pipe before=pair;pid_t previous=child;
 int fds[PD_FD_SCAN_MAX];size_t initial,after;if(pd_fd_snapshot(fds,&initial)<0)return 68;
 active=1;int r=pd_setup_fork(!strcmp(fault,"null-pair")?NULL:&pair,!strcmp(fault,"null-child")?NULL:&child),error=r<0?errno:0;active=0;
 if(!r){
  if(child!=-1 || pair.receiver.fd!=receiver || pair.sender.fd!=sender)_exit(91);
  if(pd_setup_wait(NULL,0,&pair.receiver,&pair.sender,binding,1000)<0)_exit(42);
  execl(argv[0],argv[0],"--probe",(char*)NULL);_exit(90);
 }
 struct sigaction observed;if(sigaction(SIGCHLD,NULL,&observed)<0)return 69;
 if(observed.sa_handler!=action.sa_handler || (observed.sa_flags&SA_NOCLDWAIT)!=(action.sa_flags&SA_NOCLDWAIT))return 70;
 if(pd_fd_snapshot(fds,&after)<0)return 71;
 int receiver_open=fcntl(receiver,F_GETFD)>=0;
 if((int)after-(int)initial!=(receiver_open?0:-1))return 72;
 int unchanged=!memcmp(&before,&pair,sizeof(pair)),exit=-1,retry=-2,retained=child>0 && child!=previous;
 if(retained){
  if(pair.receiver.fd!=-1 || pair.sender.fd!=sender || closes!=1 || forks!=1)return 73;
  pid_t second=-1;retry=pd_setup_fork(&pair,&second);if(retry!=-1 || second!=-1 || forks!=1)return 74;
  if(r<0 || !strcmp(fault,"cancel")){
   struct pd_cancel_reap_result result;
   if(pd_setup_cancel_reap(store,binding,&pair.sender,&child,1500,&result)<0 || !result.status_valid || !WIFEXITED(result.status))return 75;
   exit=WEXITSTATUS(result.status);
  }else{
   enum pd_go_delivery delivery;if(pd_admission_publish(store,binding,&pair.sender,&delivery)<0 || delivery!=PD_GO_COMPLETE)return 76;
   int status;if(pd_setup_reap(&child,1500,&status)<0 || !WIFEXITED(status))return 77;exit=WEXITSTATUS(status);
  }
 }else if(child!=previous || !unchanged || closes)return 78;
 if(fcntl(receiver,F_GETFD)>=0)close(receiver);
 if(fcntl(sender,F_GETFD)>=0)close(sender);
 printf("{\"result\":%d,\"errno\":%d,\"forks\":%d,\"closes\":%d,\"unchanged\":%d,\"retained\":%d,\"receiverOpen\":%d,\"exit\":%d,\"retry\":%d}\n",r,error,forks,closes,unchanged,retained,receiver_open,exit,retry);
 close(store);return r<0?2:0;
}
`;
 fs.writeFileSync(join(dir,'input'),'hello');fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'pipe-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'SETUP_FORK',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};





 let serial=0;
 const run=fault=>{const store=join(dir,'store-'+serial++);fs.mkdirSync(store,{mode:0o700});const r=spawnSync(binary,[fault,store],{env,encoding:'utf8',timeout:5000});evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);assert.equal(r.signal,null);return {r,v:JSON.parse(r.stdout),store};};
 for(const [fault,exit]of [['normal',17],['cancel',42]])await t.test('real fork retains child ownership through '+fault,()=>{
  const {r,v}=run(fault);assert.equal(r.status,0,r.stderr);assert.equal(v.result,1);assert.equal(v.forks,1);assert.equal(v.closes,1);assert.equal(v.retained,1);assert.equal(v.receiverOpen,0);assert.equal(v.exit,exit);assert.equal(v.retry,-1);
 });
 for(const [fault,error]of [['close-eio','EIO'],['close-eintr','EINTR']])await t.test('parent close failure retains actual child for cancellation '+fault,()=>{
  const {r,v}=run(fault);assert.equal(r.status,2,r.stderr);assert.equal(v.errno,constants.errno[error]);assert.equal(v.forks,1);assert.equal(v.closes,1);assert.equal(v.retained,1);assert.equal(v.receiverOpen,fault==='close-eintr'?1:0);assert.equal(v.exit,42);assert.equal(v.retry,-1);
 });
 for(const [fault,error]of [['fork-eagain','EAGAIN'],['fork-eintr','EINTR']])await t.test('fork failure leaves both endpoints and child output unchanged '+fault,()=>{
  const {r,v,store}=run(fault);assert.equal(r.status,2,r.stderr);assert.equal(v.errno,constants.errno[error]);assert.equal(v.forks,1);assert.equal(v.closes,0);assert.equal(v.unchanged,1);assert.equal(v.retained,0);assert.equal(v.receiverOpen,1);assert.equal(v.exit,-1);assert.deepEqual(fs.readdirSync(store).sort(),['prepared.commit','prepared.intent']);
 });
 for(const [fault,error]of [['null-pair','EINVAL'],['null-child','EINVAL'],['occupied','EINVAL'],['same','EINVAL'],['role','EINVAL'],['identity','ESTALE'],['reader-blocking','EPERM'],['sender-blocking','EPERM'],['sender-inherited','EPERM'],['sig-ignore','EPERM'],['sig-handler','EPERM'],['sig-autoreap','EPERM'],['sigaction','EACCES']])await t.test('fork prevalidation refuses without child or close '+fault,()=>{
  const {r,v,store}=run(fault);assert.equal(r.status,2,r.stderr);assert.equal(v.errno,constants.errno[error]);assert.equal(v.forks,0);assert.equal(v.closes,0);assert.equal(v.unchanged,1);assert.equal(v.retained,0);assert.equal(v.exit,-1);assert.deepEqual(fs.readdirSync(store).sort(),['prepared.commit','prepared.intent']);
 });
 t.diagnostic(JSON.stringify(evidence));
});

test('producer-reserve-fork-integration',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-begin-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);



 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include <sys/file.h>
#include <fcntl.h>
#include <signal.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
static const char *fault;
static int active=0,pipes=0,syncs=0,forks=0,reads=0,opened[2]={-1,-1},closes[2]={0,0};
static int test_pipe(int fd[2]){
 if(active){++pipes;if(!strcmp(fault,"pipe")){errno=EMFILE;return -1;}}
 int r=pipe(fd);if(active && !r){opened[0]=fd[0];opened[1]=fd[1];}return r;
}
static int test_fsync(int fd){
 if(active){++syncs;if(!strncmp(fault,"fsync-",6) && syncs==atoi(fault+6)){errno=EIO;return -1;}}
 return fsync(fd);
}
static pid_t test_fork(void){
 ++forks;if(syncs!=4)_exit(81);
 if(!strcmp(fault,"fork-eagain")){errno=EAGAIN;return -1;}
 if(!strcmp(fault,"fork-eintr")){errno=EINTR;return -1;}
 return fork();
}
static int test_close(int fd){
 if(active)for(int i=0;i<2;++i)if(fd==opened[i]){
  ++closes[i];if(i==0 && forks && !strcmp(fault,"close-eintr")){errno=EINTR;return -1;}
  if(i==0 && forks && !strcmp(fault,"close-eio")){int r=close(fd);if(r<0)return r;errno=EIO;return -1;}
 }
 return close(fd);
}
static int test_flock(int fd,int op){if(active && op==LOCK_UN && !strcmp(fault,"unlock")){errno=EIO;return -1;}return flock(fd,op);}
static int test_sigaction(int sig,const struct sigaction *in,struct sigaction *out){
 if(active){++reads;if(!strcmp(fault,"sigaction")){errno=EACCES;return -1;}}
 int r=sigaction(sig,in,out);
 if(active && !r && reads==2 && !strcmp(fault,"policy-changed") && out)out->sa_handler=SIG_IGN;
 return r;
}
#define pipe test_pipe
#define fsync test_fsync
#define fork test_fork
#define close test_close
#define flock test_flock
#define sigaction(...) test_sigaction(__VA_ARGS__)
#define main preflight_main
#include "helper.c"
#undef main
#undef pipe
#undef fsync
#undef fork
#undef close
#undef flock
#undef sigaction
static void handler(int sig){(void)sig;}
int main(int argc,char **argv){
 if(argc==2 && !strcmp(argv[1],"--probe"))return 17;
 if(argc!=3)return 64;fault=argv[1];signal(SIGPIPE,SIG_IGN);
 int store=open(argv[2],O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(store<0)return 65;
 char binding[65];memset(binding,'a',64);binding[64]=0;
 struct pd_control_pipe pair;memset(&pair,0x5a,sizeof(pair));pair.receiver.fd=-1;pair.sender.fd=-1;pid_t child=-1;
 if(!strcmp(fault,"occupied-child"))child=1;
 if(!strcmp(fault,"occupied-reader"))pair.receiver.fd=store;
 if(!strcmp(fault,"occupied-sender"))pair.sender.fd=store;
 if(!strcmp(fault,"binding"))binding[0]='z';
 if(!strcmp(fault,"directory"))fchmod(store,0755);
 if(!strcmp(fault,"prepared") && pd_admission_append(store,binding,PD_EMPTY,PD_PREPARED)<0)return 66;
 struct sigaction action;memset(&action,0,sizeof(action));sigemptyset(&action.sa_mask);action.sa_handler=SIG_DFL;
 if(!strcmp(fault,"sig-ignore"))action.sa_handler=SIG_IGN;
 if(!strcmp(fault,"sig-handler"))action.sa_handler=handler;
 if(!strcmp(fault,"sig-autoreap"))action.sa_flags=SA_NOCLDWAIT;
 if(sigaction(SIGCHLD,&action,NULL)<0 || sigaction(SIGCHLD,NULL,&action)<0)return 67;
 struct pd_control_pipe before=pair;pid_t previous=child;
 int fds[PD_FD_SCAN_MAX];size_t initial,after;if(pd_fd_snapshot(fds,&initial)<0)return 68;
 active=1;int r=pd_setup_begin(store,binding,!strcmp(fault,"null-pair")?NULL:&pair,!strcmp(fault,"null-child")?NULL:&child),error=r<0?errno:0;active=0;
 if(!r){
  if(child!=-1 || pair.receiver.fd!=opened[0] || pair.sender.fd!=opened[1])_exit(91);
  if(pd_setup_wait(NULL,0,&pair.receiver,&pair.sender,binding,1500)<0)_exit(42);
  execl(argv[0],argv[0],"--probe",(char*)NULL);_exit(90);
 }
 struct sigaction observed;if(sigaction(SIGCHLD,NULL,&observed)<0)return 69;
 if(observed.sa_handler!=action.sa_handler || (observed.sa_flags&SA_NOCLDWAIT)!=(action.sa_flags&SA_NOCLDWAIT))return 70;
 int open_count=0;for(int i=0;i<2;++i)if(opened[i]>=0 && fcntl(opened[i],F_GETFD)>=0)++open_count;
 if(pd_fd_snapshot(fds,&after)<0 || (int)after-(int)initial!=open_count)return 71;
 int unchanged=!memcmp(&before,&pair,sizeof(pair)),exit=-1,retry=0,retained=child>0 && child!=previous,phase=-1;
 if(!strcmp(fault,"unlock") && flock(store,LOCK_UN)<0)return 72;
 if(!strcmp(fault,"directory"))fchmod(store,0700);binding[0]='a';
 int inspect=pd_admission_inspect(store,binding,&phase);
 if(syncs==4 && (inspect<0 || phase!=PD_PREPARED))return 73;
 if(syncs || !strcmp(fault,"prepared")){
  struct pd_control_pipe next={.receiver={.fd=-1},.sender={.fd=-1}};pid_t other=-1;int calls=forks;
  retry=pd_setup_begin(store,binding,&next,&other);
  if(retry!=-1 || other!=-1 || next.receiver.fd!=-1 || next.sender.fd!=-1 || calls!=forks)return 74;
 }
 if(retained){
  if(pair.receiver.fd!=-1 || pair.sender.fd!=opened[1] || closes[0]!=1 || forks!=1)return 75;
  if(r<0 || !strcmp(fault,"cancel")){
   struct pd_cancel_reap_result result;if(pd_setup_cancel_reap(store,binding,&pair.sender,&child,2000,&result)<0 || !result.status_valid || !WIFEXITED(result.status))return 76;exit=WEXITSTATUS(result.status);
  }else{
   enum pd_go_delivery delivery;if(pd_admission_publish(store,binding,&pair.sender,&delivery)<0 || delivery!=PD_GO_COMPLETE)return 77;
   int status;if(pd_setup_reap(&child,2000,&status)<0 || !WIFEXITED(status))return 78;exit=WEXITSTATUS(status);
  }
 }else if(pair.sender.fd>=0 && pair.sender.fd!=store){
  if(child!=previous || pd_admission_cancel(store,binding,&pair.sender)<0)return 79;
 }
 for(int i=0;i<2;++i)if(opened[i]>=0 && fcntl(opened[i],F_GETFD)>=0)close(opened[i]);
 if(pd_fd_snapshot(fds,&after)<0 || after!=initial)return 80;
 printf("{\"result\":%d,\"errno\":%d,\"forks\":%d,\"pipes\":%d,\"syncs\":%d,\"closeRead\":%d,\"closeWrite\":%d,\"unchanged\":%d,\"retained\":%d,\"open\":%d,\"phase\":%d,\"exit\":%d,\"retry\":%d}\n",r,error,forks,pipes,syncs,closes[0],closes[1],unchanged,retained,open_count,phase,exit,retry);
 close(store);return r<0?2:0;
}
`;
 fs.writeFileSync(join(dir,'input'),'hello');fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'pipe-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'SETUP_BEGIN',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};





 let serial=0;
 const run=fault=>{const store=join(dir,'store-'+serial++);fs.mkdirSync(store,{mode:0o700});const r=spawnSync(binary,[fault,store],{env,encoding:'utf8',timeout:6000});evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.ok(r.stdout,r.stderr+' harness exit '+r.status);return {r,v:JSON.parse(r.stdout),store};};
 for(const [fault,exit]of [['normal',17],['cancel',42]])await t.test('durable begin reaches actual child through '+fault,()=>{
  const {r,v}=run(fault);assert.equal(r.status,0,r.stderr);assert.equal(v.result,1);assert.equal(v.syncs,4);assert.equal(v.forks,1);assert.equal(v.retained,1);assert.equal(v.open,1);assert.equal(v.phase,1);assert.equal(v.exit,exit);assert.equal(v.retry,-1);
 });
 for(const [fault,error]of [['close-eio','EIO'],['close-eintr','EINTR']])await t.test('begin preserves generated child after parent cleanup failure '+fault,()=>{
  const {r,v}=run(fault);assert.equal(r.status,2);assert.equal(v.errno,constants.errno[error]);assert.equal(v.retained,1);assert.equal(v.forks,1);assert.equal(v.closeRead,1);assert.equal(v.open,fault==='close-eintr'?2:1);assert.equal(v.exit,42);assert.equal(v.retry,-1);
 });
 for(const [fault,error,forks]of [['fork-eagain','EAGAIN',1],['fork-eintr','EINTR',1],['policy-changed','EPERM',0]])await t.test('begin retains durable reservation for cancellation after '+fault,()=>{
  const {r,v,store}=run(fault);assert.equal(r.status,2);assert.equal(v.errno,constants.errno[error]);assert.equal(v.forks,forks);assert.equal(v.syncs,4);assert.equal(v.open,2);assert.equal(v.unchanged,0);assert.equal(v.retained,0);assert.equal(v.closeRead,0);assert.equal(v.closeWrite,0);assert.equal(v.phase,1);assert.equal(v.exit,-1);assert.equal(v.retry,-1);assert.deepEqual(fs.readdirSync(store).sort(),['closed.commit','closed.intent','prepared.commit','prepared.intent']);
 });
 for(const [fault,error]of [['pipe','EMFILE'],['fsync-1','EIO'],['fsync-2','EIO'],['fsync-3','EIO'],['fsync-4','EIO'],['unlock','EIO'],['prepared','ESTALE']])await t.test('begin reservation failure cannot fork '+fault,()=>{
  const {r,v,store}=run(fault);assert.equal(r.status,2);assert.equal(v.errno,constants.errno[error]);assert.equal(v.forks,0);assert.equal(v.unchanged,1);assert.equal(v.retained,0);assert.equal(v.open,0);assert.equal(v.exit,-1);assert.equal(v.closeRead,fault==='pipe'?0:1);assert.equal(v.closeWrite,fault==='pipe'?0:1);
  if(fault!=='pipe'){assert.equal(v.retry,-1);assert.ok(fs.existsSync(join(store,'prepared.intent')));}else assert.deepEqual(fs.readdirSync(store),[]);
 });
 for(const [fault,error]of [['null-pair','EINVAL'],['null-child','EINVAL'],['occupied-child','EINVAL'],['occupied-reader','EINVAL'],['occupied-sender','EINVAL'],['binding','EINVAL'],['directory','EPERM'],['sig-ignore','EPERM'],['sig-handler','EPERM'],['sig-autoreap','EPERM'],['sigaction','EACCES']])await t.test('begin rejects before reservation or fork '+fault,()=>{
  const {r,v,store}=run(fault);assert.equal(r.status,2);assert.equal(v.errno,constants.errno[error]);assert.equal(v.forks,0);assert.equal(v.pipes,0);assert.equal(v.syncs,0);assert.equal(v.unchanged,1);assert.equal(v.open,0);assert.equal(v.retained,0);assert.deepEqual(fs.readdirSync(store),[]);
 });
 t.diagnostic(JSON.stringify(evidence));
});

test('producer-reserved-cancellation',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-unforked-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);



 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include <sys/file.h>
#include <fcntl.h>
#include <signal.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
static const char *fault,*store_path;
static int active=0,syncs=0,ends[2],calls[2]={0,0},lock_checked=0,forks=0;
static void replace_receiver(void);
static int test_fsync(int fd){
 if(active){++syncs;if(!strncmp(fault,"fsync-",6) && syncs==atoi(fault+6)){errno=EIO;return -1;}}
 int r=fsync(fd);
 if(active && !r){
  if(syncs==4 && !strcmp(fault,"replace"))replace_receiver();
  if((syncs==2 && !strcmp(fault,"crash-intent")) || (syncs==4 && !strcmp(fault,"crash-commit")))kill(getpid(),SIGKILL);
 }
 return r;
}
static int test_close(int fd){
 if(active)for(int i=0;i<2;++i)if(fd==ends[i]){
  ++calls[i];if(syncs!=4)_exit(81);
  if(!i && !strcmp(fault,"lock")){
   pid_t child=fork();if(child<0)_exit(82);
   if(!child){int dir=open(store_path,O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(dir<0)_exit(83);int got=flock(dir,LOCK_EX|LOCK_NB),e=errno;close(dir);_exit(got<0 && e==EWOULDBLOCK?0:84);}
   int st;if(waitpid(child,&st,0)!=child || !WIFEXITED(st) || WEXITSTATUS(st))_exit(85);lock_checked=1;
  }
  if((!i && !strcmp(fault,"read-eintr")) || (i && !strcmp(fault,"write-eintr")) || !strcmp(fault,"both-eintr")){errno=EINTR;return -1;}
  if((!i && (!strcmp(fault,"read-eio") || !strcmp(fault,"both-errors"))) || (i && (!strcmp(fault,"write-eio") || !strcmp(fault,"both-errors")))){int r=close(fd);if(r<0)return r;errno=i && !strcmp(fault,"both-errors")?ENOSPC:EIO;return -1;}
 }
 return close(fd);
}
static int test_flock(int fd,int op){if(active && op==LOCK_UN && !strcmp(fault,"unlock")){errno=EIO;return -1;}return flock(fd,op);}
static pid_t test_fork(void){++forks;if(!strcmp(fault,"fork-failure")){errno=EAGAIN;return -1;}return fork();}
#define fsync test_fsync
#define close test_close
#define flock test_flock
#define fork test_fork
#define main preflight_main
#include "helper.c"
#undef main
#undef fsync
#undef close
#undef flock
#undef fork
static void replace_receiver(void){int p[2];if(pipe(p)<0)_exit(86);if(dup2(p[0],ends[0])<0)_exit(87);close(p[0]);close(p[1]);}
int main(int argc,char **argv){
 if(argc!=3)return 64;fault=argv[1];store_path=argv[2];signal(SIGPIPE,SIG_IGN);
 int store=open(store_path,O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(store<0)return 65;
 int fds[PD_FD_SCAN_MAX];size_t initial,after;if(pd_fd_snapshot(fds,&initial)<0)return 66;
 char binding[65];memset(binding,'a',64);binding[64]=0;
 struct pd_control_pipe pair={.receiver={.fd=-1},.sender={.fd=-1}};
 if(!strcmp(fault,"retry")){if(pd_control_pipe_open(&pair)<0)return 67;}
 else if(!strcmp(fault,"fork-failure")){pid_t child=-1;if(pd_setup_begin(store,binding,&pair,&child)!=-1 || errno!=EAGAIN || child!=-1 || forks!=1)return 68;}
 else if(pd_setup_reserve(store,binding,&pair)<0)return 69;
 ends[0]=pair.receiver.fd;ends[1]=pair.sender.fd;
 if(!strcmp(fault,"admitted") && pd_admission_append(store,binding,PD_PREPARED,PD_ADMITTED)<0)return 70;
 if(!strcmp(fault,"closed") && pd_admission_append(store,binding,PD_PREPARED,PD_CLOSED)<0)return 71;
 if(!strcmp(fault,"binding"))binding[0]='z';
 if(!strcmp(fault,"identity"))pair.receiver.identity.st_ino++;
 if(!strcmp(fault,"same"))pair.receiver.fd=pair.sender.fd;
 if(!strcmp(fault,"blocking"))fcntl(ends[0],F_SETFL,fcntl(ends[0],F_GETFL)&~O_NONBLOCK);
 if(!strcmp(fault,"inherited"))fcntl(ends[1],F_SETFD,0);
 if(!strcmp(fault,"directory"))fchmod(store,0755);
 struct pd_control_pipe before=pair;struct pd_reserved_cancel_result result={0};
 active=1;int r=pd_setup_cancel_reserved(store,binding,!strcmp(fault,"null-pair")?NULL:&pair,!strcmp(fault,"null-result")?NULL:&result),error=r<0?errno:0;active=0;
 int open_count=0;for(int i=0;i<2;++i)if(fcntl(ends[i],F_GETFD)>=0)++open_count;
 if(pd_fd_snapshot(fds,&after)<0 || after!=initial+(size_t)open_count)return 72;
 if(!strcmp(fault,"unlock") && flock(store,LOCK_UN)<0)return 73;
 if(!strcmp(fault,"directory"))fchmod(store,0700);binding[0]='a';
 int phase=-1;int inspected=pd_admission_inspect(store,binding,&phase),inspect_error=inspected<0?errno:0;
 if(result.close_attempted && (pair.receiver.fd!=-1 || pair.sender.fd!=-1 || calls[0]!=1 || calls[1]!=1))return 74;
 if(!result.close_attempted && memcmp(&before,&pair,sizeof(pair)))return 75;
 int retry=0;if(syncs || !strcmp(fault,"retry")){
  struct pd_control_pipe other={.receiver={.fd=-1},.sender={.fd=-1}};if(pd_control_pipe_open(&other)<0)return 76;
  enum pd_go_delivery delivery;retry=pd_admission_publish(store,binding,&other.sender,&delivery);
  if(retry!=-1 || delivery!=PD_GO_NOT_ATTEMPTED || other.sender.fd<0)return 77;
  close(other.receiver.fd);close(other.sender.fd);
 }
 for(int i=0;i<2;++i)if(fcntl(ends[i],F_GETFD)>=0)close(ends[i]);
 if(pd_fd_snapshot(fds,&after)<0 || after!=initial)return 78;
 printf("{\"result\":%d,\"errno\":%d,\"syncs\":%d,\"readCalls\":%d,\"writeCalls\":%d,\"attempted\":%d,\"readError\":%d,\"writeError\":%d,\"open\":%d,\"phase\":%d,\"inspectError\":%d,\"retry\":%d,\"lockChecked\":%d,\"forks\":%d}\n",r,error,syncs,calls[0],calls[1],result.close_attempted,result.receiver_error,result.sender_error,open_count,phase,inspect_error,retry,lock_checked,forks);
 close(store);return r<0?2:0;
}
`;
 fs.writeFileSync(join(dir,'input'),'hello');fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'pipe-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'RESERVED_CANCEL',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};





 let serial=0;
 const fresh=()=>{const store=join(dir,'store-'+serial++);fs.mkdirSync(store,{mode:0o700});return store;};
 const invoke=(fault,store)=>{const r=spawnSync(binary,[fault,store],{env,encoding:'utf8',timeout:5000});evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);return r;};
 const run=fault=>{const store=fresh(),r=invoke(fault,store);assert.equal(r.signal,null);assert.ok(r.stdout,r.stderr+' harness exit '+r.status);return {r,v:JSON.parse(r.stdout),store};};
 const snapshot=store=>fs.readdirSync(store).sort().map(n=>({name:n,bytes:fs.readFileSync(join(store,n)).toString('hex'),mtime:fs.statSync(join(store,n)).mtimeMs}));
 for(const fault of ['normal','fork-failure','lock'])await t.test('unforked cancellation durably closes both endpoints '+fault,()=>{
  const {r,v,store}=run(fault);assert.equal(r.status,0);assert.equal(v.syncs,4);assert.equal(v.attempted,1);assert.equal(v.readCalls,1);assert.equal(v.writeCalls,1);assert.equal(v.open,0);assert.equal(v.phase,3);assert.equal(v.retry,-1);assert.equal(v.lockChecked,fault==='lock'?1:0);assert.equal(v.forks,fault==='fork-failure'?1:0);
  const before=snapshot(store),again=invoke('retry',store);assert.equal(again.status,2);const a=JSON.parse(again.stdout);assert.equal(a.errno,constants.errno.ESTALE);assert.equal(a.attempted,0);assert.equal(a.retry,-1);assert.deepEqual(snapshot(store),before);
 });
 for(const [fault,re,we,open]of [['read-eio','EIO',null,0],['write-eio',null,'EIO',0],['both-errors','EIO','ENOSPC',0],['read-eintr','EINTR',null,1],['write-eintr',null,'EINTR',1],['both-eintr','EINTR','EINTR',2]])await t.test('both closes attempted once and separate errors retained '+fault,()=>{
  const {r,v}=run(fault);assert.equal(r.status,2);assert.equal(v.readError,re?constants.errno[re]:0);assert.equal(v.writeError,we?constants.errno[we]:0);assert.equal(v.errno,constants.errno[re||we]);assert.equal(v.readCalls,1);assert.equal(v.writeCalls,1);assert.equal(v.attempted,1);assert.equal(v.open,open);assert.equal(v.phase,3);assert.equal(v.retry,-1);
 });
 for(const n of [1,2,3,4])await t.test('CLOSED persistence failure leaves both endpoints owned fsync-'+n,()=>{
  const {r,v,store}=run('fsync-'+n);assert.equal(r.status,2);assert.equal(v.errno,constants.errno.EIO);assert.equal(v.syncs,n);assert.equal(v.attempted,0);assert.equal(v.readCalls,0);assert.equal(v.writeCalls,0);assert.equal(v.open,2);assert.equal(v.retry,-1);assert.ok(fs.existsSync(join(store,'closed.intent')));
 });
 for(const [fault,error]of [['replace','ESTALE'],['admitted','ESTALE'],['closed','ESTALE'],['null-pair','EINVAL'],['null-result','EINVAL'],['same','EINVAL'],['binding','EINVAL'],['identity','ESTALE'],['blocking','EPERM'],['inherited','EPERM'],['directory','EPERM']])await t.test('unforked cancellation rejects before endpoint consumption '+fault,()=>{
  const {r,v}=run(fault);assert.equal(r.status,2);assert.equal(v.errno,constants.errno[error]);assert.equal(v.attempted,0);assert.equal(v.readCalls,0);assert.equal(v.writeCalls,0);assert.equal(v.open,2);if(fault==='replace')assert.equal(v.phase,3);else assert.equal(v.syncs,0);
 });
 await t.test('unlock failure retains CLOSED and consumed handles',()=>{const {r,v}=run('unlock');assert.equal(r.status,2);assert.equal(v.errno,constants.errno.EIO);assert.equal(v.attempted,1);assert.equal(v.open,0);assert.equal(v.phase,3);assert.equal(v.retry,-1);});
 for(const fault of ['crash-intent','crash-commit'])await t.test('unforked cancellation crash retains records and denies fresh GO '+fault,()=>{
  const store=fresh(),r=invoke(fault,store);assert.equal(r.status,null);assert.equal(r.signal,'SIGKILL');const before=snapshot(store);assert.ok(before.some(v=>v.name==='closed.intent'));
  const again=invoke('retry',store);assert.equal(again.status,2,again.stdout+again.stderr);const v=JSON.parse(again.stdout);assert.equal(v.attempted,0);assert.equal(v.retry,-1);assert.deepEqual(snapshot(store),before);
 });
 t.diagnostic(JSON.stringify(evidence));
});

test('producer-setup-owner-lifecycle',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-owner-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);



 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <signal.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
static const char *fault;
static int active=0,forks=0,syncs=0,pipes=0,ends[2]={-1,-1},closes[2]={0,0};
static dev_t pipe_device[2];static ino_t pipe_inode[2];
static int test_pipe(int fds[2]){
 if(active){++pipes;if(!strcmp(fault,"pipe")){errno=EMFILE;return -1;}}
 int r=pipe(fds);if(active && !r){ends[0]=fds[0];ends[1]=fds[1];for(int i=0;i<2;++i){struct stat st;if(fstat(fds[i],&st)<0)_exit(82);pipe_device[i]=st.st_dev;pipe_inode[i]=st.st_ino;}}return r;
}
static int test_fsync(int fd){
 if(active)++syncs;
 if((active==1 && !strncmp(fault,"fsync-",6) && syncs==atoi(fault+6)) ||
    (active==2 && !strcmp(fault,"cancel-fsync"))){errno=EIO;return -1;}
 return fsync(fd);
}
static pid_t test_fork(void){
 ++forks;if(syncs!=4)_exit(81);
 if(!strcmp(fault,"fork-eagain") || !strcmp(fault,"reserved-closes") || !strcmp(fault,"cancel-fsync")){errno=EAGAIN;return -1;}
 return fork();
}
static int test_close(int fd){
 struct stat st;int original=active && fstat(fd,&st)==0 && S_ISFIFO(st.st_mode);
 if(original)for(int i=0;i<2;++i)if(fd==ends[i] && st.st_dev==pipe_device[i] && st.st_ino==pipe_inode[i]){
  ++closes[i];
  if((active==1 && forks && !i && !strcmp(fault,"parent-eintr")) ||
     (active==2 && !strcmp(fault,"reserved-closes"))){errno=EINTR;return -1;}
  if(active==1 && forks && !i && !strcmp(fault,"parent-eio")){int r=close(fd);if(r<0)return r;errno=EIO;return -1;}
 }
 return close(fd);
}
static pid_t test_waitpid(pid_t pid,int *status,int flags){if(active==2 && !strcmp(fault,"wait-error")){errno=EACCES;return -1;}return waitpid(pid,status,flags);}
#define pipe(fds) test_pipe(fds)
#define fsync test_fsync
#define fork test_fork
#define close test_close
#define waitpid test_waitpid
#define PD_LEGACY_OWNER_TEST 1
#define main preflight_main
#include "helper.c"
#undef main
#undef pipe
#undef fsync
#undef fork
#undef close
#undef waitpid
int main(int argc,char **argv){
 if(argc==2 && !strcmp(argv[1],"--probe"))return 17;
 if(argc!=4)return 64;fault=argv[1];signal(SIGPIPE,SIG_IGN);
 int dir=open(argv[2],O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(dir<0)return 65;
 int fds[PD_FD_SCAN_MAX];size_t initial,after;if(pd_fd_snapshot(fds,&initial)<0)return 66;
 char binding[65];memset(binding,'a',64);binding[64]=0;
 struct pd_setup_owner owner=PD_SETUP_OWNER_INITIALIZER;
 if(!strcmp(fault,"bad-binding"))binding[0]='z';
 if(!strcmp(fault,"occupied"))owner.child=1;
 active=1;int begun=pd_setup_owner_begin(dir,binding,!strcmp(fault,"null-owner")?NULL:&owner),begin_error=begun<0?errno:0;active=0;
 if(!begun){
  struct pd_setup_cleanup denied;
  if(owner.stage!=PD_SETUP_CHILD || owner.owner==getpid() ||
     pd_setup_owner_cancel(&owner,1000,&denied)!=-1 || errno!=EPERM || denied.attempted)_exit(91);
  if(pd_setup_wait(NULL,0,&owner.pipe.receiver,&owner.pipe.sender,owner.binding,2000)<0)_exit(42);
  execl(argv[0],argv[0],"--probe",(char*)NULL);_exit(90);
 }
 int begin_stage=owner.stage,begin_forks=forks,begin_syncs=syncs,begin_pipes=pipes;
 pid_t created=owner.child>0 && strcmp(fault,"occupied")?owner.child:-1;
 struct pd_setup_owner saved=owner;
 if(owner.stage!=PD_SETUP_NEW){int calls=forks;
  if(pd_setup_owner_begin(dir,binding,&owner)!=-1 || errno!=EINVAL || calls!=forks || memcmp(&owner,&saved,sizeof(owner)))return 67;
 }
 if(!strcmp(fault,"binding-copy"))memset(binding,'b',64);
 int copied=0;
 if(!strcmp(fault,"other-process")){
  pid_t c=fork();if(c<0)return 68;if(!c){struct pd_setup_cleanup out;int r=pd_setup_owner_cancel(&owner,1000,&out);_exit(r==-1 && errno==EPERM && !out.attempted?0:92);}
  int st;if(waitpid(c,&st,0)!=c || !WIFEXITED(st) || WEXITSTATUS(st))return 69;copied=1;
 }
 if(!strcmp(fault,"executed")){enum pd_go_delivery delivery;if(pd_admission_publish(dir,owner.binding,&owner.pipe.sender,&delivery)<0 || delivery!=PD_GO_COMPLETE)return 70;}
 if(!strcmp(fault,"admitted") && pd_admission_append(dir,owner.binding,PD_PREPARED,PD_ADMITTED)<0)return 78;
 int pre_error=0;
 if(!strcmp(fault,"bad-timeout") || !strcmp(fault,"null-result")){
  struct pd_setup_cleanup out;int r=pd_setup_owner_cancel(&owner,0,!strcmp(fault,"null-result")?NULL:&out);pre_error=errno;
  if(r!=-1 || memcmp(&saved,&owner,sizeof(owner)))return 71;
 }
 int backup=-1;
 if(!strcmp(fault,"store-replaced")){
  backup=fcntl(dir,F_DUPFD_CLOEXEC,3);int other=open(argv[3],O_RDONLY|O_DIRECTORY|O_CLOEXEC);
  if(backup<0 || other<0 || dup2(other,dir)<0)return 72;close(other);
 }
 struct pd_setup_cleanup cleanup;active=2;int cancelled=pd_setup_owner_cancel(&owner,2500,&cleanup),cancel_error=cancelled<0?errno:0;active=0;
 int final_stage=owner.stage,status_valid=cleanup.child.status_valid,exit_status=status_valid && WIFEXITED(cleanup.child.status)?WEXITSTATUS(cleanup.child.status):-1;
 int retained=created>0 && owner.child==created;
 int read_close=closes[0],write_close=closes[1],retry_error=0;
 if(cleanup.attempted){
  saved=owner;int calls=syncs;struct pd_setup_cleanup next;
  if(pd_setup_owner_cancel(&owner,2500,&next)!=-1 || errno!=ESTALE || next.attempted || calls!=syncs || memcmp(&saved,&owner,sizeof(owner)))return 73;
  retry_error=errno;
 }
 if(backup>=0){if(dup2(backup,dir)<0)return 74;close(backup);}
 for(int i=0;i<2;++i)if(ends[i]>=0 && fcntl(ends[i],F_GETFD)>=0)close(ends[i]);
 if(created>0 && owner.child>0){int st;if(waitpid(created,&st,0)!=created)return 75;}
 if(pd_fd_snapshot(fds,&after)<0 || after!=initial)return 76;
 if(owner.begin_error!=begin_error && begin_stage!=PD_SETUP_NEW)return 77;
 printf("{\"begun\":%d,\"beginError\":%d,\"beginStage\":%d,\"forks\":%d,\"syncs\":%d,\"pipes\":%d,\"cancelled\":%d,\"cancelError\":%d,\"attempted\":%d,\"finalStage\":%d,\"reservedAttempt\":%d,\"readError\":%d,\"writeError\":%d,\"childAttempt\":%d,\"reapError\":%d,\"statusValid\":%d,\"exit\":%d,\"retained\":%d,\"readCloses\":%d,\"writeCloses\":%d,\"retryError\":%d,\"copyRejected\":%d,\"preError\":%d}\n",begun,begin_error,begin_stage,begin_forks,begin_syncs,begin_pipes,cancelled,cancel_error,cleanup.attempted,final_stage,cleanup.reserved.close_attempted,cleanup.reserved.receiver_error,cleanup.reserved.sender_error,cleanup.child.cancel_attempted,cleanup.child.reap_error,status_valid,exit_status,retained,read_close,write_close,retry_error,copied,pre_error);
 close(dir);return 0;
}
`;
 fs.writeFileSync(join(dir,'input'),'hello');fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'pipe-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'SETUP_OWNER',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};






 let serial=0;
 const run=fault=>{const store=join(dir,'store-'+serial++),other=store+'-other';fs.mkdirSync(store,{mode:0o700});fs.mkdirSync(other,{mode:0o700});const r=spawnSync(binary,[fault,store,other],{env,encoding:'utf8',timeout:8000});evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr+' harness '+r.stdout);return {v:JSON.parse(r.stdout),store,other};};
 for(const fault of ['normal','binding-copy','other-process','bad-timeout','null-result'])await t.test('owner routes actual child cancellation and rejects reuse '+fault,()=>{
  const {v}=run(fault);assert.equal(v.begun,1);assert.equal(v.beginStage,3);assert.equal(v.forks,1);assert.equal(v.syncs,4);assert.equal(v.cancelled,0);assert.equal(v.finalStage,5);assert.equal(v.childAttempt,1);assert.equal(v.reservedAttempt,0);assert.equal(v.statusValid,1);assert.equal(v.exit,42);assert.equal(v.retryError,constants.errno.ESTALE);assert.equal(v.copyRejected,fault==='other-process'?1:0);assert.equal(v.preError,['bad-timeout','null-result'].includes(fault)?constants.errno.EINVAL:0);
 });
 await t.test('owner routes failed fork to unforked reservation cancellation',()=>{const {v}=run('fork-eagain');assert.equal(v.begun,-1);assert.equal(v.beginError,constants.errno.EAGAIN);assert.equal(v.beginStage,2);assert.equal(v.forks,1);assert.equal(v.cancelled,0);assert.equal(v.finalStage,5);assert.equal(v.reservedAttempt,1);assert.equal(v.childAttempt,0);assert.equal(v.statusValid,0);});
 for(const [fault,error]of [['parent-eio','EIO'],['parent-eintr','EINTR']])await t.test('owner retains parent cleanup error while reaping actual child '+fault,()=>{
  const {v}=run(fault);assert.equal(v.begun,-1);assert.equal(v.beginError,constants.errno[error]);assert.equal(v.beginStage,3);assert.equal(v.forks,1);assert.equal(v.cancelled,0);assert.equal(v.finalStage,5);assert.equal(v.exit,42);assert.equal(v.readCloses,1);assert.equal(v.childAttempt,1);
 });
 for(const fault of ['pipe','fsync-1','fsync-2','fsync-3','fsync-4'])await t.test('unresolved reservation never retries begin or chooses cancellation '+fault,()=>{
  const {v}=run(fault);assert.equal(v.begun,-1);assert.equal(v.beginError,constants.errno[fault==='pipe'?'EMFILE':'EIO']);assert.equal(v.beginStage,1);assert.equal(v.forks,0);assert.equal(v.cancelled,-1);assert.equal(v.cancelError,constants.errno.ESTALE);assert.equal(v.attempted,0);assert.equal(v.finalStage,1);
 });
 for(const fault of ['null-owner','occupied','bad-binding'])await t.test('invalid owner begin has no reservation or fork '+fault,()=>{
  const {v,store}=run(fault);assert.equal(v.begun,-1);assert.equal(v.beginError,constants.errno.EINVAL);assert.equal(v.beginStage,0);assert.equal(v.forks,0);assert.equal(v.pipes,0);assert.equal(v.attempted,0);assert.deepEqual(fs.readdirSync(store),[]);
 });
 await t.test('borrowed store replacement rejects before cancellation and retains child',()=>{const {v,store,other}=run('store-replaced');assert.equal(v.cancelError,constants.errno.ESTALE);assert.equal(v.attempted,0);assert.equal(v.finalStage,3);assert.equal(v.retained,1);assert.deepEqual(fs.readdirSync(other),[]);assert.deepEqual(fs.readdirSync(store).sort(),['prepared.commit','prepared.intent']);});
 await t.test('both reserved close errors stay distinct and cancellation is single attempt',()=>{const {v}=run('reserved-closes');assert.equal(v.beginError,constants.errno.EAGAIN);assert.equal(v.cancelError,constants.errno.EINTR);assert.equal(v.readError,constants.errno.EINTR);assert.equal(v.writeError,constants.errno.EINTR);assert.equal(v.finalStage,6);assert.equal(v.readCloses,1);assert.equal(v.writeCloses,1);assert.equal(v.retryError,constants.errno.ESTALE);});
 await t.test('cancellation persistence error retains reservation handles and refuses retry',()=>{const {v,store}=run('cancel-fsync');assert.equal(v.beginError,constants.errno.EAGAIN);assert.equal(v.cancelError,constants.errno.EIO);assert.equal(v.finalStage,6);assert.equal(v.reservedAttempt,0);assert.equal(v.readCloses,0);assert.equal(v.writeCloses,0);assert.ok(fs.existsSync(join(store,'closed.intent')));assert.equal(v.retryError,constants.errno.ESTALE);});
 await t.test('reaping error retains original child without inventing status or retrying',()=>{const {v}=run('wait-error');assert.equal(v.cancelError,constants.errno.EACCES);assert.equal(v.reapError,constants.errno.EACCES);assert.equal(v.statusValid,0);assert.equal(v.retained,1);assert.equal(v.finalStage,6);assert.equal(v.retryError,constants.errno.ESTALE);});
 await t.test('admitted cancellation refusal remains failure after setup child timeout',()=>{const {v}=run('admitted');assert.equal(v.cancelError,constants.errno.ESTALE);assert.equal(v.statusValid,1);assert.equal(v.exit,42);assert.equal(v.finalStage,6);assert.equal(v.retryError,constants.errno.ESTALE);});
 await t.test('consumed GO sender refuses cancellation without inventing exit status',()=>{const {v}=run('executed');assert.equal(v.cancelled,-1);assert.equal(v.attempted,1);assert.equal(v.childAttempt,0);assert.equal(v.statusValid,0);assert.equal(v.retained,1);assert.equal(v.finalStage,6);assert.equal(v.retryError,constants.errno.ESTALE);});
 t.diagnostic(JSON.stringify(evidence));
});

test('producer-owner-retained-child-reaping',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-owner-reap-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);



 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <signal.h>
#include <time.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
static const char *fault;
static int active,mutations,waits,clocks,parent_created;
static pid_t test_waitpid(pid_t pid,int *status,int options){
 if(active==1 || (active==2 && !strcmp(fault,"wait-error"))){errno=EACCES;return -1;}
 if(active==2)++waits;return waitpid(pid,status,options);
}
static int test_clock_gettime(clockid_t id,struct timespec *t){if(active==2){++clocks;if(!strcmp(fault,"clock-error")){errno=EIO;return -1;}}return clock_gettime(id,t);}
static int test_sigaction(int sig,const struct sigaction *a,struct sigaction *old){
 if(active==2 && !strcmp(fault,"sig-read")){errno=EIO;return -1;}return sigaction(sig,a,old);
}
static int test_close(int fd){if(active==2)++mutations;
 if(active==3 && parent_created && !strcmp(fault,"begin-error")){int r=close(fd);if(r<0)return r;errno=EIO;return -1;}return close(fd);}
static ssize_t test_write(int fd,const void *p,size_t n){if(active==2)++mutations;return write(fd,p,n);}
static int test_fsync(int fd){if(active==2)++mutations;return fsync(fd);}
static int test_flock(int fd,int op){if(active==2)++mutations;return flock(fd,op);}
static pid_t test_fork(void){if(active==2)++mutations;pid_t p=fork();if(p>0)parent_created=1;return p;}
#define waitpid test_waitpid
#define clock_gettime test_clock_gettime
#define sigaction(sig,a,b) test_sigaction(sig,a,b)
#define close test_close
#define write test_write
#define fsync test_fsync
#define flock test_flock
#define fork test_fork
#define PD_LEGACY_OWNER_TEST 1
#define main preflight_main
#include "helper.c"
#undef main
#undef waitpid
#undef clock_gettime
#undef sigaction
#undef close
#undef write
#undef fsync
#undef flock
#undef fork
static void handler(int sig){(void)sig;}
int main(int argc,char **argv){
 if(argc==2 && !strcmp(argv[1],"--probe"))return 17;
 if(argc!=3)return 64;fault=argv[1];signal(SIGPIPE,SIG_IGN);
 int dir=open(argv[2],O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(dir<0)return 65;
 int fds[PD_FD_SCAN_MAX];size_t initial,after;if(pd_fd_snapshot(fds,&initial)<0)return 66;
 int gate[2];if(pipe(gate)<0)return 67;
 struct pd_setup_owner owner=PD_SETUP_OWNER_INITIALIZER;
 char binding[65];memset(binding,'a',64);binding[64]=0;
 active=3;int begun=pd_setup_owner_begin(dir,binding,&owner);active=0;if(begun<0 && (strcmp(fault,"begin-error") || owner.child<=0 || owner.begin_error!=EIO))return 68;
 if(!begun){
  struct pd_setup_observation denied;if(pd_setup_owner_reap(&owner,100,&denied)!=-1 || errno!=EPERM || denied.attempted)_exit(90);
  close(gate[1]);char c;if(read(gate[0],&c,1)!=1)_exit(91);close(gate[0]);
  if(pd_setup_wait(NULL,0,&owner.pipe.receiver,&owner.pipe.sender,owner.binding,1000)<0)_exit(42);
  execl(argv[0],argv[0],"--probe",(char*)NULL);_exit(92);
 }
 close(gate[0]);pid_t created=owner.child;
 int go=!strcmp(fault,"executed");
 if(go){enum pd_go_delivery delivery;if(pd_admission_publish(dir,binding,&owner.pipe.sender,&delivery)<0 || delivery!=PD_GO_COMPLETE)return 69;}
 struct pd_setup_cleanup cleanup;active=1;int cancelled=pd_setup_owner_cancel(&owner,100,&cleanup),cancel_error=errno;active=0;
 if(cancelled!=-1 || owner.stage!=PD_SETUP_CANCEL_FAILED || owner.child!=created || cleanup.child.status_valid)return 70;
 struct pd_setup_cleanup cleanup_saved=cleanup;
 /* Preserve a prior error without relying on cancellation to rewrite it. */
 int begin_error=owner.begin_error;
 pid_t sibling=-1;
 if(!strcmp(fault,"sibling")){sibling=fork();if(sibling<0)return 71;if(!sibling)_exit(23);}
 int inherited=0;
 if(!strcmp(fault,"inherited")){
  pid_t other=fork();if(other<0)return 72;if(!other){struct pd_setup_observation out;int r=pd_setup_owner_reap(&owner,100,&out);_exit(r==-1 && errno==EPERM && !out.attempted?0:93);}
  int st;if(waitpid(other,&st,0)!=other || !WIFEXITED(st) || WEXITSTATUS(st))return 73;inherited=1;
 }
 int released=0;
 if(strcmp(fault,"timeout") && strcmp(fault,"signal")){if(write(gate[1],"x",1)!=1)return 74;close(gate[1]);released=1;}
 if(!strcmp(fault,"signal")){if(kill(created,SIGSTOP)<0)return 75;int st;if(waitpid(created,&st,WUNTRACED)!=created || !WIFSTOPPED(st))return 76;if(kill(created,SIGKILL)<0)return 77;}
 if(!strcmp(fault,"echild")){int st;if(waitpid(created,&st,0)!=created)return 78;}
 struct sigaction original,chosen,current;memset(&chosen,0,sizeof(chosen));sigemptyset(&chosen.sa_mask);
 if(sigaction(SIGCHLD,NULL,&original)<0)return 79;
 if(!strcmp(fault,"sig-ignore") || !strcmp(fault,"sig-handler") || !strcmp(fault,"sig-auto")){
  chosen.sa_handler=!strcmp(fault,"sig-ignore")?SIG_IGN:!strcmp(fault,"sig-handler")?handler:SIG_DFL;
  if(!strcmp(fault,"sig-auto"))chosen.sa_flags=SA_NOCLDWAIT;
  if(sigaction(SIGCHLD,&chosen,NULL)<0)return 80;
 }
 if(sigaction(SIGCHLD,NULL,&chosen)<0)return 81;
 enum pd_setup_stage saved_stage=owner.stage;
 if(!strcmp(fault,"wrong-stage"))owner.stage=PD_SETUP_PARENT;
 if(!strcmp(fault,"no-child"))owner.child=-1;
 struct pd_setup_owner saved=owner;
 struct pd_checkpoint checkpoint;pd_checkpoint_init(&checkpoint);if(pd_checkpoint_capture(dir,&checkpoint)<0)return 82;
 struct pd_setup_observation result={0};active=2;
 int r=pd_setup_owner_reap(!strcmp(fault,"null-owner")?NULL:&owner,!strcmp(fault,"bad-timeout")?0:(!strcmp(fault,"timeout")?20:2500),!strcmp(fault,"null-result")?NULL:&result),error=r<0?errno:0;active=0;
 if(pd_checkpoint_check(dir,&checkpoint)<0 || pd_checkpoint_close(&checkpoint)<0)return 83;
 if(sigaction(SIGCHLD,NULL,&current)<0 || chosen.sa_handler!=current.sa_handler || chosen.sa_flags!=current.sa_flags)return 84;
 if(sigaction(SIGCHLD,&original,NULL)<0)return 85;
 int retained=owner.child==created,consumed=owner.child==-1;
 if(owner.stage!=saved.stage || owner.begin_error!=begin_error || memcmp(&cleanup,&cleanup_saved,sizeof(cleanup)))return 86;
 struct pd_setup_owner without_child=owner;without_child.child=saved.child;if(memcmp(&saved,&without_child,sizeof(saved)))return 87;
 int status_valid=result.status_valid,exit_code=status_valid && WIFEXITED(result.status)?WEXITSTATUS(result.status):-1,signum=status_valid && WIFSIGNALED(result.status)?WTERMSIG(result.status):0;
 int next_error=0,next_exit=-1;
 if(!released){if(strcmp(fault,"signal") && write(gate[1],"x",1)!=1)return 88;close(gate[1]);}
 if(!strcmp(fault,"timeout") || !strcmp(fault,"wait-error") || !strcmp(fault,"clock-error")){
  fault="normal";struct pd_setup_observation next;active=2;int n=pd_setup_owner_reap(&owner,2500,&next);active=0;
  if(n<0 || !next.status_valid || !WIFEXITED(next.status))return 89;next_exit=WEXITSTATUS(next.status);
 }
 if(owner.child==-1 && strcmp(argv[1],"no-child")){
  struct pd_setup_observation next;active=2;int n=pd_setup_owner_reap(&owner,100,&next);next_error=errno;active=0;
  if(n!=-1 || next.attempted || next.status_valid)return 94;
 }
 owner.stage=saved_stage;
 struct pd_setup_cleanup retry;if(pd_setup_owner_cancel(&owner,100,&retry)!=-1 || errno!=ESTALE || retry.attempted)return 95;
 /* Fixture cleanup only; the operation above never closes remaining FDs. */
 if(owner.pipe.sender.fd>=0){close(owner.pipe.sender.fd);owner.pipe.sender.fd=-1;}
 int st;if(owner.child>0 || !strcmp(argv[1],"no-child")){
  pid_t w=waitpid(created,&st,0);if(w!=created && !(w<0 && errno==ECHILD && (!strcmp(argv[1],"sig-ignore") || !strcmp(argv[1],"sig-auto"))))return 96;
 }
 int sibling_exit=-1;if(sibling>0){if(waitpid(sibling,&st,0)!=sibling || !WIFEXITED(st))return 97;sibling_exit=WEXITSTATUS(st);}
 if(pd_fd_snapshot(fds,&after)<0 || initial!=after)return 98;
 printf("{\"cancelError\":%d,\"r\":%d,\"error\":%d,\"attempted\":%d,\"resultError\":%d,\"valid\":%d,\"exit\":%d,\"signal\":%d,\"retained\":%d,\"consumed\":%d,\"mutations\":%d,\"waits\":%d,\"clocks\":%d,\"nextError\":%d,\"nextExit\":%d,\"inherited\":%d,\"siblingExit\":%d}\n",cancel_error,r,error,result.attempted,result.error,status_valid,exit_code,signum,retained,consumed,mutations,waits,clocks,next_error,next_exit,inherited,sibling_exit);
 close(dir);return 0;
}
`;
 fs.writeFileSync(join(dir,'input'),'hello');fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'pipe-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'OWNER_REAP',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};







 let serial=0;
 const run=fault=>{const store=join(dir,'store-'+serial++);fs.mkdirSync(store,{mode:0o700});const r=spawnSync(binary,[fault,store],{env,encoding:'utf8',timeout:8000});evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr+' harness '+r.stdout);const v=JSON.parse(r.stdout);assert.equal(v.mutations,0);return v;};
 for(const fault of ['normal','inherited','sibling','begin-error'])await t.test('failed cancellation remains failed after actual retained child reaping '+fault,()=>{const v=run(fault);assert.equal(v.cancelError,constants.errno.EACCES);assert.equal(v.r,0);assert.equal(v.valid,1);assert.equal(v.exit,42);assert.equal(v.consumed,1);assert.equal(v.nextError,constants.errno.EINVAL);assert.equal(v.inherited,fault==='inherited'?1:0);assert.equal(v.siblingExit,fault==='sibling'?23:-1);});
 for(const fault of ['executed'])await t.test('consumed GO cancellation refusal still permits actual exit observation '+fault,()=>{const v=run(fault);assert.equal(v.cancelError,constants.errno.EBADF);assert.equal(v.r,0);assert.equal(v.valid,1);assert.equal(v.exit,17);assert.equal(v.consumed,1);});
 await t.test('retained child signal termination is observed without issuing stop from owner reap',()=>{const v=run('signal');assert.equal(v.r,0);assert.equal(v.valid,1);assert.equal(v.signal,constants.signals.SIGKILL);assert.equal(v.exit,-1);});
 for(const [fault,code]of [['timeout','ETIMEDOUT'],['wait-error','EACCES'],['clock-error','EIO']])await t.test('failed observation retains handle for later explicit wait '+fault,()=>{const v=run(fault);assert.equal(v.r,-1);assert.equal(v.error,constants.errno[code]);assert.equal(v.resultError,v.error);assert.equal(v.attempted,1);assert.equal(v.valid,0);assert.equal(v.retained,1);assert.equal(v.nextExit,42);});
 await t.test('ECHILD invalidates retained handle without reconstructing exit',()=>{const v=run('echild');assert.equal(v.r,-1);assert.equal(v.error,constants.errno.ECHILD);assert.equal(v.valid,0);assert.equal(v.consumed,1);assert.equal(v.nextError,constants.errno.EINVAL);});
 for(const [fault,code]of [['null-owner','EINVAL'],['null-result','EINVAL'],['bad-timeout','EINVAL'],['wrong-stage','ESTALE'],['no-child','EINVAL'],['sig-ignore','EPERM'],['sig-handler','EPERM'],['sig-auto','EPERM'],['sig-read','EIO']])await t.test('owner observation prevalidation refuses before wait '+fault,()=>{const v=run(fault);assert.equal(v.r,-1);assert.equal(v.error,constants.errno[code]);assert.equal(v.attempted,0);assert.equal(v.valid,0);assert.equal(v.waits,0);assert.equal(v.clocks,0);});
 t.diagnostic(JSON.stringify(evidence));
});

test('producer-owner-admission-publication',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-owner-publish-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);



 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <fcntl.h>
#include <signal.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
static const char *fault;
static int active,syncs,writes,closes,sender=-1,parent_created;
static int test_fsync(int fd){if(active==1){++syncs;if(!strncmp(fault,"fsync-",6) && syncs==atoi(fault+6)){errno=EIO;return -1;}}return fsync(fd);}
static ssize_t test_write(int fd,const void *b,size_t n){
 if(active && fd==sender){++writes;if(!strcmp(fault,"write-eio")){errno=EIO;return -1;}if(!strcmp(fault,"write-eintr")){errno=EINTR;return -1;}if(!strcmp(fault,"short"))return write(fd,b,n-1);}return write(fd,b,n);
}
static int test_close(int fd){
 if(active==2 && parent_created && !strcmp(fault,"begin-error")){int r=close(fd);if(r<0)return r;errno=EIO;return -1;}
 if(active==1 && fd==sender){++closes;if(!strcmp(fault,"close-eintr")){errno=EINTR;return -1;}int r=close(fd);if(r<0)return r;if(!strcmp(fault,"close-eio")){errno=EIO;return -1;}return 0;}return close(fd);
}
static int test_flock(int fd,int op){if(active==1 && op==LOCK_UN && !strcmp(fault,"unlock")){errno=EIO;return -1;}return flock(fd,op);}
static pid_t test_fork(void){pid_t p=fork();if(p>0)parent_created=1;return p;}
#define fsync test_fsync
#define write test_write
#define close test_close
#define flock test_flock
#define fork test_fork
#define PD_LEGACY_OWNER_TEST 1
#define main preflight_main
#include "helper.c"
#undef main
#undef fsync
#undef write
#undef close
#undef flock
#undef fork
int main(int argc,char **argv){
 if(argc==2 && !strcmp(argv[1],"--probe"))return 17;
 if(argc!=3)return 64;fault=argv[1];signal(SIGPIPE,SIG_IGN);
 int dir=open(argv[2],O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(dir<0)return 65;
 int fds[PD_FD_SCAN_MAX];size_t initial,after;if(pd_fd_snapshot(fds,&initial)<0)return 66;
 int gate[2];if(pipe(gate)<0)return 67;
 char binding[65];memset(binding,'a',64);binding[64]=0;
 struct pd_setup_owner owner=PD_SETUP_OWNER_INITIALIZER;
 active=2;int begun=pd_setup_owner_begin(dir,binding,&owner);active=0;
 if(begun<0 && (strcmp(fault,"begin-error") || owner.child<=0 || owner.begin_error!=EIO))return 68;
 if(!begun){
  struct pd_setup_publication deny;if(pd_setup_owner_publish(&owner,&deny)!=-1 || errno!=EPERM || deny.attempted)_exit(90);
  close(gate[1]);char c;if(read(gate[0],&c,1)!=1)_exit(91);close(gate[0]);
  if(pd_setup_wait(NULL,0,&owner.pipe.receiver,&owner.pipe.sender,owner.binding,2000)<0)_exit(42);
  execl(argv[0],argv[0],"--probe",(char*)NULL);_exit(92);
 }
 close(gate[0]);pid_t created=owner.child;sender=owner.pipe.sender.fd;
 int saved_dir=dup(dir);if(saved_dir<0)return 69;
 if(!strcmp(fault,"binding-copy"))memset(binding,'b',64);
 if(!strcmp(fault,"inherited")){
  pid_t p=fork();if(p<0)return 70;if(!p){struct pd_setup_publication v;int r=pd_setup_owner_publish(&owner,&v);_exit(r==-1 && errno==EPERM && !v.attempted?0:93);}int st;if(waitpid(p,&st,0)!=p || !WIFEXITED(st) || WEXITSTATUS(st))return 71;
 }
 if(!strcmp(fault,"admitted") || !strcmp(fault,"closed"))if(pd_admission_append(dir,owner.binding,PD_PREPARED,!strcmp(fault,"admitted")?PD_ADMITTED:PD_CLOSED)<0)return 72;
 if(!strcmp(fault,"replace-store")){if(mkdirat(dir,"other",0700)<0)return 73;int other=openat(dir,"other",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(other<0 || dup2(other,dir)!=dir)return 74;close(other);}
 if(!strcmp(fault,"wrong-stage"))owner.stage=PD_SETUP_RESERVED;
 if(!strcmp(fault,"stale-sender"))++owner.pipe.sender.identity.st_ino;
 if(!strcmp(fault,"sigpipe"))signal(SIGPIPE,SIG_DFL);
 struct pd_setup_publication result={0};active=1;
 int r=pd_setup_owner_publish(!strcmp(fault,"null-owner")?NULL:&owner,!strcmp(fault,"null-result")?NULL:&result),error=r<0?errno:0;active=0;
 signal(SIGPIPE,SIG_IGN);
 int fsyncs=syncs,go_writes=writes,go_closes=closes;
 enum pd_setup_stage stage=owner.stage;int begin_error=owner.begin_error;
 if(owner.child!=created)return 75;
 struct pd_setup_publication saved=result;
 if(result.attempted){
  struct pd_setup_publication retry;active=1;int again=pd_setup_owner_publish(&owner,&retry),e=errno;active=0;
  if(again!=-1 || e!=ESTALE || retry.attempted || syncs!=fsyncs || writes!=go_writes || closes!=go_closes)return 76;
  struct pd_setup_cleanup cleanup;if(pd_setup_owner_cancel(&owner,100,&cleanup)!=-1 || errno!=ESTALE || cleanup.attempted)return 77;
 }
 /* Only fixture teardown closes an unconsumed or deliberately leaked sender. */
 int residual=fcntl(sender,F_GETFD)>=0;
 if(residual && close(sender)<0)return 78;
 if(write(gate[1],"x",1)!=1)return 79;close(gate[1]);
 struct pd_setup_observation observed={0};int st=0;
 if(result.attempted){if(pd_setup_owner_reap(&owner,2500,&observed)<0 || !observed.status_valid)return 80;st=observed.status;if(owner.stage!=stage || owner.begin_error!=begin_error || memcmp(&saved,&result,sizeof(saved)))return 81;}
 else if(waitpid(created,&st,0)!=created)return 82;
 if(!WIFEXITED(st))return 83;
 if(!strcmp(fault,"unlock")){int other=open(argv[2],O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(other<0)return 84;if(flock(other,LOCK_EX|LOCK_NB)!=-1 || (errno!=EWOULDBLOCK && errno!=EAGAIN))return 86;close(other);}
 int phase=-1,scan=0;if(strcmp(fault,"replace-store"))scan=pd_admission_inspect(saved_dir,owner.binding,&phase);
 close(saved_dir);
 if(pd_fd_snapshot(fds,&after)<0 || initial!=after)return 85;
 printf("{\"r\":%d,\"error\":%d,\"attempted\":%d,\"resultError\":%d,\"delivery\":%d,\"stage\":%d,\"beginError\":%d,\"syncs\":%d,\"writes\":%d,\"closes\":%d,\"residual\":%d,\"exit\":%d,\"phase\":%d,\"scan\":%d,\"observed\":%d}\n",r,error,result.attempted,result.error,result.delivery,stage,begin_error,fsyncs,go_writes,go_closes,residual,WEXITSTATUS(st),phase,scan,observed.status_valid);
 close(dir);return 0;
}
`;
 fs.writeFileSync(join(dir,'input'),'hello');fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'pipe-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'OWNER_PUBLISH',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};








 let serial=0;
 const run=fault=>{const store=join(dir,'store-'+serial++);fs.mkdirSync(store,{mode:0o700});const r=spawnSync(binary,[fault,store],{env,encoding:'utf8',timeout:8000});evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr+' harness '+r.stdout);return JSON.parse(r.stdout);};
 for(const fault of ['normal','binding-copy','inherited'])await t.test('owner publication durably admits original binding before actual exec '+fault,()=>{const v=run(fault);assert.equal(v.r,0);assert.equal(v.attempted,1);assert.equal(v.delivery,2);assert.equal(v.syncs,4);assert.equal(v.writes,1);assert.equal(v.closes,1);assert.equal(v.exit,17);assert.equal(v.phase,2);assert.equal(v.observed,1);});
 for(let i=1;i<=4;i++)await t.test('owner publication preserves failed admission without GO or retry fsync '+i,()=>{const v=run('fsync-'+i);assert.equal(v.r,-1);assert.equal(v.error,constants.errno.EIO);assert.equal(v.resultError,v.error);assert.equal(v.attempted,1);assert.equal(v.delivery,0);assert.equal(v.writes,0);assert.equal(v.closes,0);assert.equal(v.residual,1);assert.equal(v.exit,42);assert.equal(v.observed,1);});
 for(const [fault,code]of [['write-eio','EIO'],['write-eintr','EINTR'],['short','EIO'],['close-eio','EIO'],['close-eintr','EINTR'],['unlock','EIO']])await t.test('owner retains publication failure and delivery independently from child exit '+fault,()=>{const v=run(fault);assert.equal(v.r,-1);assert.equal(v.error,constants.errno[code]);assert.equal(v.resultError,v.error);assert.equal(v.attempted,1);assert.equal(v.delivery,fault==='unlock'?2:1);assert.equal(v.phase,2);assert.equal(v.writes,1);assert.equal(v.closes,1);assert.equal(v.residual,fault==='close-eintr'?1:0);assert.equal(v.exit,['close-eio','close-eintr','unlock'].includes(fault)?17:42);assert.equal(v.observed,1);});
 for(const [fault,code,phase]of [['sigpipe','EPERM',2],['admitted','ESTALE',2],['closed','ESTALE',3]])await t.test('owner refuses transport but retains non-replayable publication attempt '+fault,()=>{const v=run(fault);assert.equal(v.r,-1);assert.equal(v.error,constants.errno[code]);assert.equal(v.attempted,1);assert.equal(v.delivery,0);assert.equal(v.writes,0);assert.equal(v.closes,0);assert.equal(v.exit,42);assert.equal(v.phase,phase);});
 for(const [fault,code]of [['null-owner','EINVAL'],['null-result','EINVAL'],['begin-error','EPERM'],['wrong-stage','ESTALE'],['replace-store','ESTALE'],['stale-sender','ESTALE']])await t.test('owner publication prevalidation refuses before storage and GO '+fault,()=>{const v=run(fault);assert.equal(v.r,-1);assert.equal(v.error,constants.errno[code]);assert.equal(v.attempted,0);assert.equal(v.writes,0);assert.equal(v.syncs,0);assert.equal(v.closes,0);assert.equal(v.exit,42);if(fault==='begin-error')assert.equal(v.beginError,constants.errno.EIO);});
 t.diagnostic(JSON.stringify(evidence));
});

test('producer-owner-child-wait',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-owner-child-wait-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);



 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <signal.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
static const char *fault;
static int active,watched=-1,close_calls;
static int test_close(int fd){if(active && fd==watched){++close_calls;if(!strcmp(fault,"close-eintr")){errno=EINTR;return -1;}}return close(fd);}
static int test_clock(clockid_t id,struct timespec *t){if(active && !strcmp(fault,"clock-error")){errno=EIO;return -1;}return clock_gettime(id,t);}
#define close test_close
#define clock_gettime test_clock
#define PD_LEGACY_OWNER_TEST 1
#define main preflight_main
#include "helper.c"
#undef main
#undef close
#undef clock_gettime
struct answer {int r,error,attempted,result_error,stage,retry_error,store_closed,inherited,closes,residual;};
int main(int argc,char **argv){
 if(argc==5 && !strcmp(argv[1],"--probe")){
  char b[5];int input=atoi(argv[2]),report=atoi(argv[3]),control=atoi(argv[4]);
  int fds[PD_FD_SCAN_MAX];size_t n;if(pd_fd_snapshot(fds,&n)<0 || n!=2)return 91;
  for(size_t j=0;j<n;j++)if(fds[j]!=input && fds[j]!=report)return 103;
  if(fcntl(input,F_GETFD)&FD_CLOEXEC || fcntl(report,F_GETFD)&FD_CLOEXEC)return 104;
  if(read(input,b,5)!=5 || memcmp(b,"hello",5) || fcntl(control,F_GETFD)!=-1 || errno!=EBADF)return 92;
  return 17;
 }
 if(argc!=3)return 64;fault=argv[1];signal(SIGPIPE,SIG_IGN);
 int store=open(argv[2],O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(store<0)return 65;
 int fds[PD_FD_SCAN_MAX];size_t initial,after;if(pd_fd_snapshot(fds,&initial)<0)return 66;
 int gate[2],report[2];if(pipe(gate)<0 || pipe(report)<0)return 67;
 char file[4096];if(snprintf(file,sizeof(file),"%s/../input",argv[2])<0)return 68;
 int input=open(file,O_RDONLY|O_CLOEXEC);if(input<0)return 69;
 char binding[65];memset(binding,'a',64);binding[64]=0;
 struct pd_setup_owner owner=PD_SETUP_OWNER_INITIALIZER;
 int begun=pd_setup_owner_begin(store,binding,&owner);if(begun<0)return 70;
 if(!begun){
  close(report[0]);close(gate[1]);char c;if(read(gate[0],&c,1)!=1)_exit(93);close(gate[0]);
  struct pd_fd_entry keep[2]={{.fd=input,.role=PD_INPUT_READ},{.fd=report[1],.role=PD_PIPE_WRITE}};
  for(int i=0;i<2;i++)if(fstat(keep[i].fd,&keep[i].identity)<0)_exit(94);
  struct answer a={0};int control=owner.pipe.receiver.fd;watched=owner.pipe.sender.fd;
  if(!strcmp(fault,"binding-copy"))memset(binding,'b',64);
  if(!strcmp(fault,"inherited")){
   pid_t g=fork();if(g<0)_exit(95);if(!g){struct pd_setup_wait_result deny;int r=pd_setup_owner_wait(&owner,keep,2,500,&deny);_exit(r==-1 && errno==EPERM && !deny.attempted?0:96);}int st;if(waitpid(g,&st,0)!=g || !WIFEXITED(st) || WEXITSTATUS(st))_exit(97);a.inherited=1;
  }
  if(!strcmp(fault,"wrong-stage"))owner.stage=PD_SETUP_PARENT;
  if(!strcmp(fault,"begin-error"))owner.begin_error=EIO;
  if(!strcmp(fault,"wrong-child"))owner.child=getpid();
  if(!strcmp(fault,"stale-control"))++owner.pipe.receiver.identity.st_ino;
  if(!strcmp(fault,"alias"))keep[0]=owner.pipe.receiver;
  struct pd_setup_wait_result result={0};active=1;
  a.r=pd_setup_owner_wait(!strcmp(fault,"null-owner")?NULL:&owner,keep,2,!strcmp(fault,"bad-timeout")?0:150,!strcmp(fault,"null-result")?NULL:&result);a.error=a.r<0?errno:0;active=0;
  a.attempted=result.attempted;a.result_error=result.error;a.stage=owner.stage;a.closes=close_calls;a.residual=fcntl(watched,F_GETFD)>=0;
  a.store_closed=fcntl(store,F_GETFD)==-1 && errno==EBADF;
  if(result.attempted){struct pd_setup_wait_result retry;int r=pd_setup_owner_wait(&owner,keep,2,150,&retry);a.retry_error=errno;if(r!=-1 || a.retry_error!=ESTALE || retry.attempted)_exit(98);if(owner.pipe.receiver.fd!=-1 || owner.pipe.sender.fd!=-1 || owner.store!=-1)_exit(99);}
  if(write(report[1],&a,sizeof(a))!=(ssize_t)sizeof(a))_exit(100);
  if(a.r<0)_exit(42);
  char i[24],r[24],cfd[24];snprintf(i,sizeof(i),"%d",input);snprintf(r,sizeof(r),"%d",report[1]);snprintf(cfd,sizeof(cfd),"%d",control);
  execl(argv[0],argv[0],"--probe",i,r,cfd,(char*)NULL);_exit(101);
 }
 close(gate[0]);close(report[1]);close(input);
 struct pd_setup_wait_result deny;if(pd_setup_owner_wait(&owner,NULL,0,150,&deny)!=-1 || errno!=EPERM || deny.attempted)return 71;
 if(!strcmp(fault,"eof")){if(pd_admission_cancel(store,owner.binding,&owner.pipe.sender)<0)return 72;}
 else if(strcmp(fault,"timeout")){struct pd_setup_publication pub;if(pd_setup_owner_publish(&owner,&pub)<0)return 73;}
 if(write(gate[1],"x",1)!=1)return 74;close(gate[1]);
 struct answer a;size_t used=0;while(used<sizeof(a)){ssize_t n=read(report[0],(char*)&a+used,sizeof(a)-used);if(n<=0)return 75;used+=(size_t)n;}close(report[0]);
 if(owner.pipe.sender.fd>=0)close(owner.pipe.sender.fd);
 int st;if(waitpid(owner.child,&st,0)!=owner.child || !WIFEXITED(st))return 76;
 if(pd_fd_snapshot(fds,&after)<0 || after!=initial)return 77;
 printf("{\"r\":%d,\"error\":%d,\"attempted\":%d,\"resultError\":%d,\"stage\":%d,\"retryError\":%d,\"storeClosed\":%d,\"inherited\":%d,\"closes\":%d,\"residual\":%d,\"exit\":%d}\n",a.r,a.error,a.attempted,a.result_error,a.stage,a.retry_error,a.store_closed,a.inherited,a.closes,a.residual,WEXITSTATUS(st));
 close(store);return 0;
}
`;
 fs.writeFileSync(join(dir,'input'),'hello');fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'pipe-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'OWNER_WAIT',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};









 let serial=0;
 const run=fault=>{const store=join(dir,'store-'+serial++);fs.mkdirSync(store,{mode:0o700});const r=spawnSync(binary,[fault,store],{env,encoding:'utf8',timeout:8000});evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr+' harness '+r.stdout);return JSON.parse(r.stdout);};
 for(const fault of ['normal','binding-copy','inherited'])await t.test('original setup child waits once and execs with exact retained FD set '+fault,()=>{const v=run(fault);assert.equal(v.r,0);assert.equal(v.attempted,1);assert.equal(v.stage,9);assert.equal(v.retryError,constants.errno.ESTALE);assert.equal(v.storeClosed,1);assert.equal(v.exit,17);assert.equal(v.inherited,fault==='inherited'?1:0);});
 for(const [fault,code]of [['eof','EPROTO'],['timeout','ETIMEDOUT'],['close-eintr','EINTR'],['clock-error','EIO'],['stale-control','ESTALE'],['alias','EINVAL']])await t.test('child wait failure consumes opportunity without exec or retry '+fault,()=>{const v=run(fault);assert.equal(v.r,-1);assert.equal(v.error,constants.errno[code]);assert.equal(v.resultError,v.error);assert.equal(v.attempted,1);assert.equal(v.stage,10);assert.equal(v.retryError,constants.errno.ESTALE);assert.equal(v.exit,42);if(fault==='close-eintr'){assert.equal(v.closes,1);assert.equal(v.residual,1);}});
 for(const [fault,code]of [['null-owner','EINVAL'],['null-result','EINVAL'],['bad-timeout','EINVAL'],['wrong-stage','ESTALE'],['begin-error','EPERM'],['wrong-child','EPERM']])await t.test('child wait prevalidation refuses before FD filtering '+fault,()=>{const v=run(fault);assert.equal(v.r,-1);assert.equal(v.error,constants.errno[code]);assert.equal(v.attempted,0);assert.equal(v.closes,0);assert.equal(v.storeClosed,0);assert.equal(v.exit,42);});
 t.diagnostic(JSON.stringify(evidence));
});

test('producer-owner-admission-closure',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-owner-admission-closure-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);



 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <signal.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
static const char *fault,*store_path;
static int active,syncs,go_writes,lock_probes;
static int test_sync(int);
static int test_lock(int,int);
static ssize_t test_write(int,const void*,size_t);
#define fsync test_sync
#define flock test_lock
#define write test_write
#define PD_LEGACY_OWNER_TEST 1
#define main preflight_main
#include "helper.c"
#undef main
#undef fsync
#undef flock
#undef write
static int test_lock(int fd,int op){
 if(active==1 && !strcmp(fault,"prepared") && (op&LOCK_EX)){errno=EAGAIN;return -1;}
 if(active==2 && !strcmp(fault,"lock") && (op&LOCK_EX)){errno=EAGAIN;return -1;}
 if(active==2 && !strcmp(fault,"unlock") && op==LOCK_UN){errno=EIO;return -1;}
 return flock(fd,op);
}
static ssize_t test_write(int fd,const void *b,size_t n){
 if(active==2 && n==PD_GO_SIZE)++go_writes;
 if(active==1 && !strcmp(fault,"unknown") && n==PD_GO_SIZE){errno=EIO;return -1;}
 return write(fd,b,n);
}
static int test_sync(int fd){
 if(active==1 && !strcmp(fault,"partial")){errno=EIO;return -1;}
 if(active==2){
  ++syncs;
  if(!strcmp(fault,"exclusion")){
   pid_t p=fork();if(p<0)return -1;
   if(!p){int d=open(store_path,O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(d<0)_exit(90);int r=flock(d,LOCK_EX|LOCK_NB),e=errno;close(d);_exit(r==-1 && (e==EWOULDBLOCK || e==EAGAIN)?0:91);}
   int st;if(waitpid(p,&st,0)!=p || !WIFEXITED(st) || WEXITSTATUS(st)){errno=EIO;return -1;}++lock_probes;
  }
  if(!strncmp(fault,"sync",4) && syncs==atoi(fault+4)){errno=EIO;return -1;}
 }
 return fsync(fd);
}
int main(int argc,char **argv){
 if(argc==2 && !strcmp(argv[1],"--probe"))return 17;
 if(argc!=3)return 64;fault=argv[1];store_path=argv[2];signal(SIGPIPE,SIG_IGN);
 int store=open(store_path,O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(store<0)return 65;
 int fds[PD_FD_SCAN_MAX];size_t initial,after;if(pd_fd_snapshot(fds,&initial)<0)return 66;
 int gate[2];if(pipe(gate)<0)return 67;
 char binding[65];memset(binding,'a',64);binding[64]=0;
 struct pd_setup_owner owner=PD_SETUP_OWNER_INITIALIZER;
 int begun=pd_setup_owner_begin(store,binding,&owner);if(begun<0)return 68;
 if(!begun){
  struct pd_setup_closure denied;if(pd_setup_owner_close_admission(&owner,&denied)!=-1 || errno!=EPERM || denied.attempted)_exit(93);
  close(gate[1]);char c;if(read(gate[0],&c,1)!=1)_exit(94);close(gate[0]);
  struct pd_setup_wait_result result;if(pd_setup_owner_wait(&owner,NULL,0,1000,&result)<0)_exit(42);
  execl(argv[0],argv[0],"--probe",(char*)NULL);_exit(95);
 }
 close(gate[0]);active=1;struct pd_setup_publication publication;int pub=pd_setup_owner_publish(&owner,&publication);active=0;
 int pub_failed=!strcmp(fault,"prepared")||!strcmp(fault,"unknown")||!strcmp(fault,"partial");if((pub<0)!=pub_failed)return 69;
 struct pd_setup_publication saved_publication=publication;
 if(!strcmp(fault,"inherited")){
  pid_t g=fork();if(g<0)return 70;if(!g){struct pd_setup_closure denied;int r=pd_setup_owner_close_admission(&owner,&denied);_exit(r==-1 && errno==EPERM && !denied.attempted?0:96);}int st;if(waitpid(g,&st,0)!=g || !WIFEXITED(st) || WEXITSTATUS(st))return 71;
 }
 if(!strcmp(fault,"already-closed") && pd_admission_append(store,owner.binding,PD_ADMITTED,PD_CLOSED)<0)return 72;
 if(!strcmp(fault,"binding-copy"))memset(binding,'b',64);
 int other=-1;if(!strcmp(fault,"store-replaced")){char path[4096];snprintf(path,sizeof(path),"%s/../other",store_path);if(mkdir(path,0700)<0)return 73;other=open(path,O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(other<0)return 74;owner.store=other;}
 enum pd_setup_stage original_stage=owner.stage;if(!strcmp(fault,"wrong-stage"))owner.stage=PD_SETUP_PARENT;
 if(!strcmp(fault,"bad-binding"))owner.binding[0]='z';
 struct pd_setup_owner before=owner;
 struct pd_setup_closure result={.previous=-1};active=2;
 int r=pd_setup_owner_close_admission(!strcmp(fault,"null-owner")?NULL:&owner,!strcmp(fault,"null-result")?NULL:&result),error=r<0?errno:0;active=0;
 before.closure=owner.closure;if(memcmp(&before,&owner,sizeof(owner)) || memcmp(&saved_publication,&publication,sizeof(publication)))return 75;
 int closure=owner.closure,retry_error=0;
 if(result.attempted){int old_sync=syncs;struct pd_setup_closure retry;active=2;int rr=pd_setup_owner_close_admission(&owner,&retry);retry_error=errno;active=0;if(rr!=-1 || retry_error!=ESTALE || retry.attempted || old_sync!=syncs)return 76;}
 owner.stage=original_stage;owner.store=store;owner.binding[0]='a';if(other>=0)close(other);
 int state=-1,scan=pd_scan(store,owner.binding,&state),scan_error=scan<0?errno:0;
 int retained_lock=0;if(!strcmp(fault,"unlock")){int d=open(store_path,O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(d<0)return 77;int lk=flock(d,LOCK_EX|LOCK_NB);retained_lock=lk<0 && (errno==EWOULDBLOCK||errno==EAGAIN);close(d);if(flock(store,LOCK_UN)<0)return 78;}
 /* Fresh process/store description and pipe cannot replay persisted closure. */
 if(state==PD_CLOSED || scan_error==EINPROGRESS){
  pid_t replay=fork();if(replay<0)return 85;
  if(!replay){
   int d=open(store_path,O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(d<0)_exit(97);
   struct pd_control_pipe pair={.receiver={.fd=-1},.sender={.fd=-1}};
   if(pd_control_pipe_open(&pair)<0)_exit(98);
   enum pd_go_delivery delivery;int rr=pd_admission_publish(d,owner.binding,&pair.sender,&delivery),e=errno;
   int valid=rr==-1 && e==(state==PD_CLOSED?ESTALE:EINPROGRESS) && delivery==PD_GO_NOT_ATTEMPTED && pair.sender.fd>=0;
   close(pair.receiver.fd);close(pair.sender.fd);close(d);_exit(valid?0:99);
  }
  int replay_status;if(waitpid(replay,&replay_status,0)!=replay || !WIFEXITED(replay_status) || WEXITSTATUS(replay_status))return 86;
 }
 struct pd_setup_publication again;if(pd_setup_owner_publish(&owner,&again)!=-1 || errno!=ESTALE || again.attempted)return 79;
 struct pd_setup_cleanup cancel;if(pd_setup_owner_cancel(&owner,100,&cancel)!=-1 || errno!=ESTALE || cancel.attempted)return 80;
 if(owner.pipe.sender.fd>=0)close(owner.pipe.sender.fd);
 if(write(gate[1],"x",1)!=1)return 81;close(gate[1]);
 struct pd_setup_observation observed;if(pd_setup_owner_reap(&owner,2000,&observed)<0 || !observed.status_valid || !WIFEXITED(observed.status))return 82;
 if(owner.stage!=original_stage || (int)owner.closure!=closure || memcmp(&saved_publication,&publication,sizeof(publication)))return 83;
 if(pd_fd_snapshot(fds,&after)<0 || after!=initial)return 84;
 printf("{\"r\":%d,\"error\":%d,\"attempted\":%d,\"resultError\":%d,\"previous\":%d,\"closure\":%d,\"retryError\":%d,\"syncs\":%d,\"goWrites\":%d,\"probes\":%d,\"state\":%d,\"scanError\":%d,\"retainedLock\":%d,\"publicationError\":%d,\"delivery\":%d,\"exit\":%d}\n",r,error,result.attempted,result.error,result.previous,closure,retry_error,syncs,go_writes,lock_probes,state,scan_error,retained_lock,publication.error,publication.delivery,WEXITSTATUS(observed.status));
 close(store);return 0;
}
`;
 fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'pipe-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'OWNER_CLOSE',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};










 let serial=0;
 const run=fault=>{const store=join(dir,'store-'+serial++);fs.mkdirSync(store,{mode:0o700});const r=spawnSync(binary,[fault,store],{env,encoding:'utf8',timeout:8000});evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr+' harness '+r.stdout);return JSON.parse(r.stdout);};
 for(const fault of ['normal','binding-copy','inherited','exclusion','prepared','unknown'])await t.test('close original admission without repairing publication or stopping child '+fault,()=>{const v=run(fault);assert.equal(v.r,0);assert.equal(v.attempted,1);assert.equal(v.closure,2);assert.equal(v.state,3);assert.equal(v.previous,fault==='prepared'?1:2);assert.equal(v.syncs,4);assert.equal(v.retryError,constants.errno.ESTALE);assert.equal(v.goWrites,0);assert.equal(v.exit,['prepared','unknown'].includes(fault)?42:17);if(fault==='exclusion')assert.equal(v.probes,4);if(fault==='unknown'){assert.equal(v.publicationError,constants.errno.EIO);assert.equal(v.delivery,1);}});
 for(const fault of ['sync1','sync2','sync3','sync4','unlock','lock','partial','already-closed'])await t.test('failed closure preserves records owner and original publication '+fault,()=>{const v=run(fault);assert.equal(v.r,-1);assert.equal(v.attempted,1);assert.equal(v.closure,1);assert.equal(v.resultError,v.error);assert.equal(v.retryError,constants.errno.ESTALE);assert.equal(v.goWrites,0);assert.equal(v.error,constants.errno[fault==='lock'?'EAGAIN':fault==='partial'?'EINPROGRESS':fault==='already-closed'?'ESTALE':'EIO']);if(fault==='unlock'){assert.equal(v.state,3);assert.equal(v.retainedLock,1);}if(fault==='partial')assert.equal(v.scanError,constants.errno.EINPROGRESS);});
 for(const [fault,code]of [['null-owner','EINVAL'],['null-result','EINVAL'],['wrong-stage','ESTALE'],['bad-binding','EINVAL'],['store-replaced','ESTALE']])await t.test('refuse before closing admission '+fault,()=>{const v=run(fault);assert.equal(v.r,-1);assert.equal(v.error,constants.errno[code]);assert.equal(v.attempted,0);assert.equal(v.closure,0);assert.equal(v.syncs,0);assert.equal(v.goWrites,0);assert.equal(v.state,2);assert.equal(v.exit,17);});
 t.diagnostic(JSON.stringify(evidence));
});
test('producer-owner-closed-sender-release',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-owner-closed-sender-release-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);



 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <signal.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
static const char *fault,*store_path;
static int active,sender_fd=-1,closes,writes,syncs,probes;
static int test_close(int);
static int test_lock(int,int);
static ssize_t test_write(int,const void*,size_t);
static int test_sync(int);
#define close test_close
#define flock test_lock
#define write test_write
#define fsync test_sync
#define PD_LEGACY_OWNER_TEST 1
#define main preflight_main
#include "helper.c"
#undef main
#undef close
#undef flock
#undef write
#undef fsync
static int test_lock(int fd,int op){
 if(active==1 && strcmp(fault,"admitted") && strcmp(fault,"consumed") && (op&LOCK_EX)){errno=EAGAIN;return -1;}
 if(active==2 && !strcmp(fault,"lock") && (op&LOCK_EX)){errno=EAGAIN;return -1;}
 if(active==2 && (!strcmp(fault,"unlock") || !strcmp(fault,"both-errors")) && op==LOCK_UN){errno=ENOSPC;return -1;}
 return flock(fd,op);
}
static ssize_t test_write(int fd,const void *b,size_t n){if(active==2)++writes;return write(fd,b,n);}
static int test_sync(int fd){if(active==2)++syncs;return fsync(fd);}
static int test_close(int fd){
 if(active==2 && fd==sender_fd){
  ++closes;
  if(!strcmp(fault,"exclusion")){
   pid_t p=fork();if(p<0)return -1;
   if(!p){int d=open(store_path,O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(d<0)_exit(90);int r=flock(d,LOCK_EX|LOCK_NB),e=errno;close(d);_exit(r==-1 && (e==EWOULDBLOCK||e==EAGAIN)?0:91);}
   int st;if(waitpid(p,&st,0)!=p || !WIFEXITED(st)||WEXITSTATUS(st)){errno=EIO;return -1;}++probes;
  }
  if(!strcmp(fault,"close-eintr")){errno=EINTR;return -1;}
  if(!strcmp(fault,"close-eio") || !strcmp(fault,"both-errors")){(void)close(fd);errno=EIO;return -1;}
 }
 return close(fd);
}
int main(int argc,char **argv){
 if(argc==2 && !strcmp(argv[1],"--probe"))return 17;
 if(argc!=3)return 64;fault=argv[1];store_path=argv[2];signal(SIGPIPE,SIG_IGN);
 int store=open(store_path,O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(store<0)return 65;
 int fds[PD_FD_SCAN_MAX];size_t initial,after;if(pd_fd_snapshot(fds,&initial)<0)return 66;
 int gate[2];if(pipe(gate)<0)return 67;
 char binding[65];memset(binding,'a',64);binding[64]=0;
 struct pd_setup_owner owner=PD_SETUP_OWNER_INITIALIZER;
 int begun=pd_setup_owner_begin(store,binding,&owner);if(begun<0)return 68;
 if(!begun){
  struct pd_sender_release_result denied;if(pd_setup_owner_release_sender(&owner,&denied)!=-1 || errno!=EPERM || denied.attempted)_exit(92);
  close(gate[1]);char c;if(read(gate[0],&c,1)!=1)_exit(93);close(gate[0]);
  struct pd_setup_wait_result result;if(pd_setup_owner_wait(&owner,NULL,0,1000,&result)<0)_exit(42);
  execl(argv[0],argv[0],"--probe",(char*)NULL);_exit(94);
 }
 close(gate[0]);if(!strcmp(fault,"admitted"))signal(SIGPIPE,SIG_DFL);
 active=1;struct pd_setup_publication publication;int pub=pd_setup_owner_publish(&owner,&publication);active=0;signal(SIGPIPE,SIG_IGN);
 if((pub==0)!=(!strcmp(fault,"consumed")))return 69;
 struct pd_setup_closure closure;if(pd_setup_owner_close_admission(&owner,&closure)<0)return 70;
 struct pd_setup_publication saved_publication=publication;struct pd_setup_closure saved_closure=closure;
 if(!strcmp(fault,"inherited")){
  pid_t p=fork();if(p<0)return 71;if(!p){struct pd_sender_release_result r;int x=pd_setup_owner_release_sender(&owner,&r);_exit(x==-1&&errno==EPERM&&!r.attempted?0:95);}int st;if(waitpid(p,&st,0)!=p||!WIFEXITED(st)||WEXITSTATUS(st))return 72;
 }
 sender_fd=owner.pipe.sender.fd;struct pd_fd_entry original_sender=owner.pipe.sender;
 if(!strcmp(fault,"binding-copy"))memset(binding,'b',64);
 if(!strcmp(fault,"partial")){if(unlinkat(store,"closed.commit",0)<0)return 73;}
 if(!strcmp(fault,"not-closed")){if(unlinkat(store,"closed.intent",0)<0||unlinkat(store,"closed.commit",0)<0)return 74;}
 if(!strcmp(fault,"changed-record")){int fd=openat(store,"closed.intent",O_WRONLY);if(fd<0||pwrite(fd,"z",1,9)!=1)return 75;close(fd);}
 struct pd_checkpoint original_records;pd_checkpoint_init(&original_records);if(pd_checkpoint_capture(store,&original_records)<0)return 76;
 int other=-1;if(!strcmp(fault,"store-replaced")){char path[4096];snprintf(path,sizeof(path),"%s/../other",store_path);if(mkdir(path,0700)<0)return 77;other=open(path,O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(other<0)return 78;owner.store=other;}
 enum pd_setup_stage original_stage=owner.stage;int original_closure=(int)owner.closure;
 if(!strcmp(fault,"wrong-stage"))owner.stage=PD_SETUP_PARENT;
 if(!strcmp(fault,"close-failed"))owner.closure=PD_SETUP_CLOSE_FAILED;
 if(!strcmp(fault,"close-new"))owner.closure=PD_SETUP_CLOSE_NEW;
 if(!strcmp(fault,"bad-binding"))owner.binding[0]='z';
 if(!strcmp(fault,"old-identity"))++owner.pipe.sender.identity.st_ino;
 if(!strcmp(fault,"blocking")){int f=fcntl(sender_fd,F_GETFL);if(f<0||fcntl(sender_fd,F_SETFL,f&~O_NONBLOCK)<0)return 79;}
 if(!strcmp(fault,"inheritable")&&fcntl(sender_fd,F_SETFD,0)<0)return 80;
 struct pd_setup_owner before=owner;struct pd_sender_release_result result={0};active=2;
 int r=pd_setup_owner_release_sender(!strcmp(fault,"null-owner")?NULL:&owner,!strcmp(fault,"null-result")?NULL:&result),error=r<0?errno:0;active=0;
 before.sender_release_attempted=owner.sender_release_attempted;before.pipe.sender.fd=owner.pipe.sender.fd;
 if(memcmp(&before,&owner,sizeof(owner))||memcmp(&publication,&saved_publication,sizeof(publication))||memcmp(&closure,&saved_closure,sizeof(closure)))return 81;
 int retry_error=0;if(result.attempted){int prior=closes;struct pd_sender_release_result retry;active=2;int rr=pd_setup_owner_release_sender(&owner,&retry);retry_error=errno;active=0;if(rr!=-1||retry_error!=ESTALE||retry.attempted||closes!=prior)return 82;}
 if(pd_checkpoint_check(store,&original_records)<0||pd_checkpoint_close(&original_records)<0)return 83;
 int retained=sender_fd>=0 && fcntl(sender_fd,F_GETFD)>=0;
 if(sender_fd>=0 && retained)close(sender_fd);
 if(other>=0)close(other);
 int retained_lock=0;if(!strcmp(fault,"unlock")||!strcmp(fault,"both-errors")){int d=open(store_path,O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(d<0)return 84;int lk=flock(d,LOCK_EX|LOCK_NB);retained_lock=lk<0&&(errno==EWOULDBLOCK||errno==EAGAIN);close(d);if(flock(store,LOCK_UN)<0)return 85;}
 owner.stage=original_stage;owner.closure=original_closure;owner.store=store;owner.binding[0]='a';
 owner.pipe.sender.identity=original_sender.identity;
 if(write(gate[1],"x",1)!=1)return 86;close(gate[1]);
 struct pd_setup_observation observed;if(pd_setup_owner_reap(&owner,2000,&observed)<0||!observed.status_valid||!WIFEXITED(observed.status))return 87;
 if(memcmp(&publication,&saved_publication,sizeof(publication))||memcmp(&closure,&saved_closure,sizeof(closure)))return 88;
 if(pd_fd_snapshot(fds,&after)<0||after!=initial)return 89;
 printf("{\"r\":%d,\"error\":%d,\"attempted\":%d,\"closeAttempted\":%d,\"closeError\":%d,\"cleanupError\":%d,\"resultError\":%d,\"closes\":%d,\"writes\":%d,\"syncs\":%d,\"probes\":%d,\"retained\":%d,\"retainedLock\":%d,\"retryError\":%d,\"exit\":%d}\n",r,error,result.attempted,result.close_attempted,result.close_error,result.cleanup_error,result.error,closes,writes,syncs,probes,retained,retained_lock,retry_error,WEXITSTATUS(observed.status));
 close(store);return 0;
}
`;
 fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'pipe-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'SENDER_RELEASE',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};











 let serial=0;
 const run=fault=>{const store=join(dir,'store-'+serial++);fs.mkdirSync(store,{mode:0o700});const r=spawnSync(binary,[fault,store],{env,encoding:'utf8',timeout:8000});evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr+' harness '+r.stdout);const v=JSON.parse(r.stdout);assert.equal(v.writes,0);assert.equal(v.syncs,0);return v;};
 for(const fault of ['normal','admitted','binding-copy','exclusion','inherited'])await t.test('release retained sender after original closure '+fault,()=>{const v=run(fault);assert.equal(v.r,0);assert.equal(v.attempted,1);assert.equal(v.closeAttempted,1);assert.equal(v.closes,1);assert.equal(v.retained,0);assert.equal(v.exit,42);assert.equal(v.retryError,constants.errno.ESTALE);if(fault==='exclusion')assert.equal(v.probes,1);});
 for(const [fault,code]of [['close-eio','EIO'],['close-eintr','EINTR'],['both-errors','EIO'],['unlock','ENOSPC'],['lock','EAGAIN'],['partial','EINPROGRESS'],['not-closed','ESTALE'],['changed-record','EINVAL']])await t.test('preserve failed release and original outcomes '+fault,()=>{const v=run(fault);assert.equal(v.r,-1);assert.equal(v.error,constants.errno[code]);assert.equal(v.resultError,v.error);assert.equal(v.attempted,1);assert.equal(v.retryError,constants.errno.ESTALE);assert.equal(v.exit,42);const close=['close-eio','close-eintr','both-errors','unlock'].includes(fault);assert.equal(v.closes,close?1:0);assert.equal(v.closeAttempted,close?1:0);assert.equal(v.retained,!close||fault==='close-eintr'?1:0);if(['both-errors','unlock'].includes(fault)){assert.equal(v.cleanupError,constants.errno.ENOSPC);assert.equal(v.retainedLock,1);}if(fault.startsWith('close-')||fault==='both-errors')assert.equal(v.closeError,constants.errno[code]);});
 for(const [fault,code]of [['null-owner','EINVAL'],['null-result','EINVAL'],['wrong-stage','ESTALE'],['close-failed','ESTALE'],['close-new','ESTALE'],['bad-binding','EINVAL'],['store-replaced','ESTALE'],['old-identity','ESTALE'],['blocking','EPERM'],['inheritable','EPERM'],['consumed','EBADF']])await t.test('refuse before sender release '+fault,()=>{const v=run(fault);assert.equal(v.r,-1);assert.equal(v.error,constants.errno[code]);assert.equal(v.attempted,0);assert.equal(v.closes,0);assert.equal(v.exit,fault==='consumed'?17:42);});
 t.diagnostic(JSON.stringify(evidence));
});

test('producer-sender-release-history-race',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-sender-release-history-race-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);



 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <signal.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <stdarg.h>
static const char *fault;
static int active,opens,mutated,sender_fd=-1,closes,writes,syncs;
static int test_openat(int,const char*,int,...);
static int test_close(int);
static int test_lock(int,int);
static ssize_t test_write(int,const void*,size_t);
static int test_sync(int);
#define openat test_openat
#define close test_close
#define flock test_lock
#define write test_write
#define fsync test_sync
#define PD_LEGACY_OWNER_TEST 1
#define main preflight_main
#include "helper.c"
#undef main
#undef openat
#undef close
#undef flock
#undef write
#undef fsync
static struct pd_checkpoint changed;
static int test_openat(int dir,const char *name,int flags,...){
 mode_t mode=0;if(flags&O_CREAT){va_list ap;va_start(ap,flags);mode=(mode_t)va_arg(ap,int);va_end(ap);}
 if(active==2 && !strcmp(name,"prepared.intent")){
  ++opens;int trigger=!strncmp(fault,"before-",7)?2:5;
  if(strcmp(fault,"normal") && !mutated && opens==trigger){
   mutated=1;active=0;
   if(strstr(fault,"prepared")){if(unlinkat(dir,"closed.intent",0)<0||unlinkat(dir,"closed.commit",0)<0)_exit(101);}
   else if(strstr(fault,"partial")){if(unlinkat(dir,"closed.commit",0)<0)_exit(102);}
   else if(strstr(fault,"binding")){
    for(int i=0;i<2;i++){int fd=openat(dir,i?"closed.commit":"closed.intent",O_WRONLY);if(fd<0||pwrite(fd,"b",1,9)!=1||close(fd)<0)_exit(103);}
   }else if(strstr(fault,"replace")){
    char raw[PD_RECORD_SIZE];int fd=openat(dir,"closed.intent",O_RDONLY);if(fd<0||read(fd,raw,sizeof(raw))!=(ssize_t)sizeof(raw)||close(fd)<0||unlinkat(dir,"closed.intent",0)<0)_exit(104);
    fd=openat(dir,"closed.intent",O_WRONLY|O_CREAT|O_EXCL,0600);if(fd<0||write(fd,raw,sizeof(raw))!=(ssize_t)sizeof(raw)||close(fd)<0)_exit(105);
   }
   pd_checkpoint_init(&changed);if(pd_checkpoint_capture(dir,&changed)<0)_exit(106);active=2;
  }
 }
 return (flags&O_CREAT)?openat(dir,name,flags,mode):openat(dir,name,flags);
}
static int test_close(int fd){if(active==2&&fd==sender_fd)++closes;return close(fd);}
static int test_lock(int fd,int op){if(active==1&&(op&LOCK_EX)){errno=EAGAIN;return -1;}return flock(fd,op);}
static ssize_t test_write(int fd,const void*b,size_t n){if(active==2)++writes;return write(fd,b,n);}
static int test_sync(int fd){if(active==2)++syncs;return fsync(fd);}
int main(int argc,char **argv){
 if(argc!=3)return 64;fault=argv[1];signal(SIGPIPE,SIG_IGN);
 int store=open(argv[2],O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(store<0)return 65;
 int fds[PD_FD_SCAN_MAX];size_t initial,after;if(pd_fd_snapshot(fds,&initial)<0)return 66;
 int gate[2];if(pipe(gate)<0)return 67;
 char binding[65];memset(binding,'a',64);binding[64]=0;
 struct pd_setup_owner owner=PD_SETUP_OWNER_INITIALIZER;int begun=pd_setup_owner_begin(store,binding,&owner);if(begun<0)return 68;
 if(!begun){close(gate[1]);char c;if(read(gate[0],&c,1)!=1)_exit(91);close(gate[0]);struct pd_setup_wait_result w;if(pd_setup_owner_wait(&owner,NULL,0,1000,&w)<0)_exit(42);_exit(92);}
 close(gate[0]);struct pd_setup_publication publication;active=1;int pub=pd_setup_owner_publish(&owner,&publication);active=0;if(pub!=-1||errno!=EAGAIN)return 69;
 struct pd_setup_closure closure;if(pd_setup_owner_close_admission(&owner,&closure)<0)return 70;
 struct pd_setup_owner before=owner;struct pd_setup_publication saved_pub=publication;struct pd_setup_closure saved_close=closure;
 sender_fd=owner.pipe.sender.fd;struct pd_sender_release_result result;active=2;int r=pd_setup_owner_release_sender(&owner,&result),error=r<0?errno:0;active=0;
 int retained=fcntl(sender_fd,F_GETFD)>=0;
 before.sender_release_attempted=owner.sender_release_attempted;before.pipe.sender.fd=owner.pipe.sender.fd;
 if(memcmp(&before,&owner,sizeof(owner))||memcmp(&publication,&saved_pub,sizeof(publication))||memcmp(&closure,&saved_close,sizeof(closure)))return 71;
 if(mutated && (pd_checkpoint_check(store,&changed)<0||pd_checkpoint_close(&changed)<0))return 72;
 int phase=-1,scan=pd_scan(store,binding,&phase),scan_error=scan<0?errno:0;
 struct pd_sender_release_result retry;int prior=closes;active=2;int rr=pd_setup_owner_release_sender(&owner,&retry),retry_error=errno;active=0;
 if(rr!=-1||retry_error!=ESTALE||retry.attempted||closes!=prior)return 73;
 int d=open(argv[2],O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(d<0||flock(d,LOCK_EX|LOCK_NB)<0||flock(d,LOCK_UN)<0||close(d)<0)return 74;
 if(retained && close(sender_fd)<0)return 75;
 if(write(gate[1],"x",1)!=1||close(gate[1])<0)return 76;
 struct pd_setup_observation observed;if(pd_setup_owner_reap(&owner,2000,&observed)<0||!observed.status_valid||!WIFEXITED(observed.status)||WEXITSTATUS(observed.status)!=42)return 77;
 if(pd_fd_snapshot(fds,&after)<0||after!=initial)return 78;
 printf("{\"r\":%d,\"error\":%d,\"attempted\":%d,\"closeAttempted\":%d,\"closeError\":%d,\"cleanupError\":%d,\"resultError\":%d,\"closes\":%d,\"writes\":%d,\"syncs\":%d,\"retained\":%d,\"mutated\":%d,\"opens\":%d,\"phase\":%d,\"scanError\":%d,\"retryError\":%d,\"exit\":42}\n",r,error,result.attempted,result.close_attempted,result.close_error,result.cleanup_error,result.error,closes,writes,syncs,retained,mutated,opens,phase,scan_error,retry_error);
 close(store);return 0;
}
`;
 fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'pipe-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'SENDER_RELEASE_HISTORY',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};












 let serial=0;
 const run=fault=>{const store=join(dir,'store-'+serial++);fs.mkdirSync(store,{mode:0o700});const r=spawnSync(binary,[fault,store],{env,encoding:'utf8',timeout:8000});evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr+' harness '+r.stdout);return JSON.parse(r.stdout);};
 for(const [fault,code]of [['normal',null],['before-prepared','ESTALE'],['before-partial','EINPROGRESS'],['before-binding','EINVAL'],['after-replace','ESTALE'],['after-partial','EINPROGRESS']])await t.test('pin and validate CLOSED before irreversible sender close '+fault,()=>{
  const v=run(fault);assert.equal(v.mutated,code?1:0);assert.equal(v.writes,0);assert.equal(v.syncs,0);assert.equal(v.attempted,1);assert.equal(v.exit,42);assert.equal(v.retryError,constants.errno.ESTALE);
  assert.equal(v.r,code?-1:0);assert.equal(v.error,code?constants.errno[code]:0);assert.equal(v.resultError,v.error);assert.equal(v.closeAttempted,code?0:1);assert.equal(v.closes,code?0:1);assert.equal(v.retained,code?1:0);assert.equal(v.closeError,0);assert.equal(v.cleanupError,0);
 });
 t.diagnostic(JSON.stringify(evidence));
});

// QI1/QI2: an independently completed amendment, not a widened v1 token.
async function componentAmendmentFixture(t){
 const f=await componentDevelopmentFixture(t,{regressions:true});
 const ref=path=>({path,sha256:hash(fs.readFileSync(file(f,path)))}),old=structuredClone(f.restartAttestation),entry=read(file(f,'evidence/restart-entry.json'));
 const savedPaths=[...old.permittedPaths,'tests/enterprise/finalization.test.mjs','scripts/enterprise/verify.mjs','work/enterprise/plan.json',old.contractPath];
 for(const path of savedPaths){if(!fs.existsSync(file(f,path)))put(file(f,path),'// synthetic source\n');const raw=fs.readFileSync(file(f,path)),copy='evidence/amendment-entry/'+path;put(file(f,copy),raw.toString());entry.entries.push({...ref(path),bytes:raw.length,copy});}
 put(file(f,'evidence/amendment-entry.json'),entry);
 put(file(f,'evidence/historical-review.md'),fs.readFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'),'utf8'));
 for(const path of ['work/enterprise/PREPARATION_PRODUCER_CONTAINMENT.md','work/enterprise/PREPARATION_CAPTURE_RECOVERY.md','evidence/reassessment.json','evidence/validation.json'])put(file(f,path),'synthetic frozen diagnostic');
 const references=[...savedPaths.slice(0,8).map(sourcePath=>{const e=entry.entries.find(e=>e.path===sourcePath);return {path:e.copy,sha256:e.sha256,bytes:e.bytes,sourcePath};}),...['work/enterprise/PREPARATION_PRODUCER_CONTAINMENT.md','work/enterprise/PREPARATION_CAPTURE_RECOVERY.md','evidence/reassessment.json','evidence/validation.json','evidence/historical-review.md','evidence/amendment-entry.json'].map(path=>({...ref(path),bytes:fs.statSync(file(f,path)).size}))];
 put(file(f,'evidence/integration-checkpoint.json'),{schemaVersion:1,kind:'INTEGRATION_SOURCE_CHECKPOINT_NOT_AUTHORITY',runSlug:f.run.slug,iteration:3,sourceCheckpoint:old.sourceCheckpoint,references,previousReviewOriginalPath:join(f.run.reportsAbs,'enterprise-02-review.md'),historicalDesignApprovalOnly:true,nativeAccepted:false,captureAuthority:false,recoveryAuthority:false,completeH:false});
 put(file(f,old.contractPath),'synthetic schema 2 contract');
 mutate(f,'work/enterprise/plan.json',p=>{const e=p.preparationRestart;e.schemaVersion=2;e.permittedPaths.push('tests/enterprise/finalization.test.mjs');e.entrySnapshot='evidence/amendment-entry.json';e.integrationCheckpoint=ref('evidence/integration-checkpoint.json');e.historicalVersion1={schemaVersion:1,permittedPaths:old.permittedPaths,contract:ref('evidence/amendment-entry/'+old.contractPath),review:ref('evidence/historical-review.md'),currentAmendmentAuthority:false};});
 const m=ok(spawnSync(process.execPath,['--input-type=module','-e',"import {inputs} from './scripts/enterprise/evidence.mjs';console.log(JSON.stringify(inputs(process.cwd())));"],{cwd:f.root,env:f.env,encoding:'utf8'}));put(file(f,'evidence/amendment-inputs.json'),m);
 f.restartAttestation={...old,schemaVersion:2,iteration:4,contractSha256:ref(old.contractPath).sha256,planSha256:ref('work/enterprise/plan.json').sha256,reviewInputsDigest:m.digest,reviewInputsManifest:ref('evidence/amendment-inputs.json'),entryManifest:ref('evidence/amendment-entry.json'),permittedPaths:[...old.permittedPaths,'tests/enterprise/finalization.test.mjs']};
 phases(f,'review-architecture',4,fenced('enterprise-preparation-restart-attestation',f.restartAttestation));f.context('build-foundation',5);return f;
}
function rewriteAmendment(f,edit){
 const a=structuredClone(f.restartAttestation);edit(a);const text=fenced('enterprise-preparation-restart-attestation',a);
 for(const r of f.records.filter(r=>r.step==='review-architecture'&&r.iteration===4&&r.type==='phase_complete'))r.content=text;
 f.append({type:'boundary'});put(join(f.run.reportsAbs,'enterprise-02-review.md'),text+'\n');
}
function rebindAmendmentFixture(f,edit=()=>{}){
 const m=ok(spawnSync(process.execPath,['--input-type=module','-e',"import {inputs} from './scripts/enterprise/evidence.mjs';console.log(JSON.stringify(inputs(process.cwd())));"],{cwd:f.root,env:f.env,encoding:'utf8'}));put(file(f,'evidence/amendment-inputs.json'),m);
 rewriteAmendment(f,a=>{a.planSha256=hash(fs.readFileSync(file(f,'work/enterprise/plan.json')));a.reviewInputsDigest=m.digest;a.reviewInputsManifest.sha256=hash(fs.readFileSync(file(f,'evidence/amendment-inputs.json')));edit(a);});
}
test('component-development-versioned-amendment-boundary',async t=>{
 const f=await componentAmendmentFixture(t),reset=restorePoint(f);
 await t.test('QI1 schema2 exact seven paths and immutable checkpoint authorize only component work',()=>{const result=componentDevelopmentRead(f);assert.equal(result.status,0,result.stderr);const r=JSON.parse(result.stdout);assert.equal(r.implementationAuthorityAuthenticated,true);assert.equal(r.nativeAcceptance,false);assert.equal(r.ordinaryBatchAuthority,false);assert.deepEqual(r.changedPaths,[]);assert.ok(r.references.some(x=>x.path==='evidence/integration-checkpoint.json'));});
 await t.test('QI1 permitted finalization edit does not change frozen source copies',()=>{reset();const before=fs.readFileSync(file(f,'evidence/amendment-entry/tests/enterprise/finalization.test.mjs'));fs.appendFileSync(file(f,'tests/enterprise/finalization.test.mjs'),'\n// allowed amendment\n');const result=componentDevelopmentRead(f);assert.equal(result.status,0,result.stderr);const r=JSON.parse(result.stdout);assert.deepEqual(r.changedPaths,['tests/enterprise/finalization.test.mjs']);assert.deepEqual(fs.readFileSync(file(f,'evidence/amendment-entry/tests/enterprise/finalization.test.mjs')),before);});
 for(const [name,version,count]of [['schema1 with seven',1,7],['schema2 with six',2,6],['schema2 with eight',2,8]])await t.test('QI2 '+name+' refuses exact path set before writes',()=>{reset();const paths=f.restartAttestation.permittedPaths.slice(0,count);if(count===8)paths.push('scripts/enterprise/verify.mjs');mutate(f,'work/enterprise/plan.json',p=>{p.preparationRestart.schemaVersion=version;p.preparationRestart.permittedPaths=paths;});rebindAmendmentFixture(f,a=>{a.schemaVersion=version;a.permittedPaths=paths;});fail(componentDevelopmentRead(f,['--test-component-development']),/restart exact (six|seven) paths/);assert.deepEqual(componentOutputs(f),[]);});
 for(const [name,edit,re]of [['unknown version',a=>a.schemaVersion=3,/restart schemaVersion/],['unknown field',a=>a.authorityToken='allow',/restart attestation fields/],['foreign run',a=>a.runSlug='other',/restart runSlug/],['foreign bundle',a=>a.bundleDigest='0'.repeat(64),/restart bundleDigest/],['same session claim',a=>a.providerSessionId='builder-session',/restart providerSessionId/],...['captureAuthority','recoveryAuthority','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority'].map(k=>[k,a=>a[k]=true,new RegExp('restart '+k)])])await t.test('QI2 '+name+' refuses before diagnostic writes',()=>{reset();rewriteAmendment(f,edit);fail(componentDevelopmentRead(f,['--test-component-development']),re);assert.deepEqual(componentOutputs(f),[]);});
 for(const path of ['evidence/integration-checkpoint.json','evidence/amendment-entry/scripts/enterprise/runtime-preparation.mjs','evidence/historical-review.md','evidence/restart-checkpoint.json','scripts/enterprise/verify.mjs'])await t.test('QI2 changed '+path+' refuses before diagnostic writes',()=>{reset();fs.appendFileSync(file(f,path),' ');fail(componentDevelopmentRead(f,['--test-component-development']),/restart changed reference|restart unreviewed input/);assert.deepEqual(componentOutputs(f),[]);});
 await t.test('QI2 unfinished amendment cannot fall back to completed schema1',()=>{reset();f.records.find(r=>r.type==='step_complete'&&r.step==='review-architecture'&&r.iteration===4).status='error';f.append({type:'boundary'});fail(componentDevelopmentRead(f,['--test-component-development']),/incomplete preparation occurrence/);});
 await t.test('QI2 old schema1 block cannot authorize current contract and plan',()=>{reset();const a=JSON.parse(fs.readFileSync(file(f,'evidence/historical-review.md'),'utf8').match(/```enterprise-preparation-restart-attestation\n([\s\S]*?)\n```/)[1]);rewriteAmendment(f,x=>Object.assign(x,a,{iteration:4}));fail(componentDevelopmentRead(f,['--test-component-development']),/restart changed reference/);});
 for(const kind of ['phase','canonical','actual-session','builder-model','builder-effort','review-model','review-effort'])await t.test('QI2 schema2 '+kind+' provenance refuses before writes',()=>{
  reset();let re=/preparation|restart|context|independent/;
  if(kind==='phase')f.records.find(r=>r.type==='phase_complete'&&r.step==='review-architecture'&&r.iteration===4).content=fenced('enterprise-preparation-restart-attestation',{...f.restartAttestation,verdict:'REQUEST_CHANGES'});
  if(kind==='canonical')fs.appendFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'),'changed');
  if(kind==='actual-session')savePersonaSessions(f.root,{...f.sessions,[JSON.stringify(['enterprise-architecture-reviewer','codex','gpt-6-astra'])]:'builder-session'},'codex',f.paths.sessionsDirectory);
  if(kind.startsWith('builder-')||kind.startsWith('review-')){const r=f.records.findLast(r=>r.type==='step_start'&&r.step===(kind.startsWith('builder')?'build-foundation':'review-architecture'));if(kind.endsWith('model'))r.model='gpt-6.1-sol';else r.providerOptions.codex.reasoningEffort='low';}
  f.append({type:'boundary'});fail(componentDevelopmentRead(f,['--test-component-development']),re);assert.deepEqual(componentOutputs(f),[]);
 });
 for(const arg of ['--capture-component','--recover-preparation-capture','--import-component-review','--initialize-run','--activate-backend','--authority-token=allow'])await t.test('QI2 schema2 rejects operation override '+arg,()=>{reset();fail(componentDevelopmentRead(f,['--test-component-development',arg]),/preparation accepts no authority overrides/);assert.deepEqual(componentOutputs(f),[]);});
 for(const fault of ['missing','unknown-field','wrong-source','wrong-length'])await t.test('QI2 plan-bound integration '+fault+' is structurally rejected',()=>{
  reset();if(fault==='missing')mutate(f,'work/enterprise/plan.json',p=>delete p.preparationRestart.integrationCheckpoint);
  else {mutate(f,'evidence/integration-checkpoint.json',c=>{if(fault==='unknown-field')c.trust=true;if(fault==='wrong-source')c.references[0].sourcePath='scripts/enterprise/verify.mjs';if(fault==='wrong-length')c.references[0].bytes++;});mutate(f,'work/enterprise/plan.json',p=>p.preparationRestart.integrationCheckpoint.sha256=hash(fs.readFileSync(file(f,'evidence/integration-checkpoint.json'))));}
  rebindAmendmentFixture(f);fail(componentDevelopmentRead(f,['--test-component-development']),/restart integration|Cannot convert undefined/);assert.deepEqual(componentOutputs(f),[]);
 });
 await t.test('QI6 immutable copy changes after await forbid publication',()=>{reset();const target=file(f,'evidence/amendment-entry/scripts/enterprise/runtime-preparation.mjs'),hook=componentHook(f,'amendment-await',"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const read=fs.readFileSync;let n=0;fs.readFileSync=function(p,...a){const b=read(p,...a);return String(p)==="+JSON.stringify(target)+"&&++n>=3?Buffer.concat([Buffer.from(b),Buffer.from(' ')]):b;};syncBuiltinESMExports();");fail(componentDevelopmentRead(f,['--inspect-component-development'],[hook]),/restart concurrent reference/);});
 await t.test('QI6 schema2 diagnostic writer executes fixed seven files without product authority',()=>{reset();const before=componentPreserved(f),r=componentWrite(f);assert.equal(r.status,0,r.stderr);const d=JSON.parse(r.stdout);assert.equal(d.tap.tests,7);assert.equal(d.nativeAcceptance,false);assert.equal(d.ordinaryBatchAuthority,false);assert.deepEqual(d.currentApprovals,[]);assert.deepEqual(componentPreserved(f),before);});
 await t.test('QI6 changed integration copy during child forbids successful publication',()=>{reset();const target=file(f,'evidence/amendment-entry/scripts/enterprise/runtime-preparation.mjs'),hook=componentHook(f,'amendment-child',"import fs from 'node:fs';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const spawn=cp.spawn;cp.spawn=function(...a){const c=spawn(...a);fs.appendFileSync("+JSON.stringify(target)+",' ');return c;};syncBuiltinESMExports();");fail(componentWrite(f,hook),/restart changed reference/);const [base]=componentOutputs(f);assert.ok(base);assert.ok(fs.existsSync(join(base,'start.json')));assert.equal(fs.existsSync(join(base,'diagnostic.json')),false);assert.equal(fs.existsSync(join(base,'failure.json')),false);});
});

test('producer-descriptor-durable-pin',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-descriptor-pin-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);
 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
static const char *fault;
static int active,writes,syncs,reads,closes,unlocks,leaked=-1,heldfd=-1;
static ssize_t test_write(int,const void*,size_t);
static ssize_t test_pread(int,void*,size_t,off_t);
static int test_sync(int);
static int test_close(int);
static int test_lock(int,int);
#define write test_write
#define pread test_pread
#define fsync test_sync
#define close test_close
#define flock test_lock
#define main preflight_main
#include "helper.c"
#undef main
#undef write
#undef pread
#undef fsync
#undef close
#undef flock
static ssize_t test_write(int fd,const void *b,size_t n){
 if(active){++writes;if(!strcmp(fault,"write-error")||!strcmp(fault,"combined-create")){errno=EIO;return -1;}
  if(!strcmp(fault,"zero-write"))return 0;
  if(!strcmp(fault,"partial-write")&&writes==1)return write(fd,b,3);
  if(!strcmp(fault,"partial-write")&&writes==2){errno=ENOSPC;return -1;}
  if(!strcmp(fault,"short-eintr")&&writes==1){errno=EINTR;return -1;}
  if(!strcmp(fault,"short-eintr")&&n>3)n=3;
 }
 return write(fd,b,n);
}
static ssize_t test_pread(int fd,void*b,size_t n,off_t off){
 if(active){++reads;if(!strcmp(fault,"read-error")){errno=EIO;return -1;}
  if(!strcmp(fault,"read-eof"))return 0;
  if(!strcmp(fault,"read-eintr")&&reads==1){errno=EINTR;return -1;}
  if(!strcmp(fault,"read-short")&&n>7)n=7;
  if(!strcmp(fault,"read-mutate")&&reads==1){if(pwrite(fd,"!",1,0)!=1)_exit(90);}
 }
 return pread(fd,b,n,off);
}
static int test_sync(int fd){if(active){++syncs;if((!strcmp(fault,"file-sync")&&syncs==1)||(!strcmp(fault,"directory-sync")&&syncs==2)){errno=EIO;return -1;}}return fsync(fd);}
static int test_close(int fd){if(active){++closes;if(!strcmp(fault,"combined-create")||!strcmp(fault,"close-eintr")||!strcmp(fault,"combined-release")){leaked=fd;errno=EINTR;return -1;}}return close(fd);}
static int test_lock(int fd,int op){if(active){if(op&LOCK_UN){++unlocks;if(!strcmp(fault,"combined-create")||!strcmp(fault,"unlock")||!strcmp(fault,"combined-release")){errno=ENOSPC;return -1;}}else if(!strcmp(fault,"lock")){errno=EAGAIN;return -1;}}return flock(fd,op);}
static int competition(const char *path){
 pid_t p=fork();if(p<0)return -1;if(!p){int fd=open(path,O_RDONLY|O_DIRECTORY);if(fd<0)_exit(80);int r=flock(fd,LOCK_EX|LOCK_NB),e=errno;close(fd);_exit(r<0&&(e==EAGAIN||e==EWOULDBLOCK)?0:81);}
 int status;if(waitpid(p,&status,0)!=p||!WIFEXITED(status))return -1;return WEXITSTATUS(status);
}
int main(int argc,char **argv){
 if(argc!=3)return 64;fault=argv[1];int dir=open(argv[2],O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(dir<0)return 65;
 int fds[PD_FD_SCAN_MAX];size_t before,after;if(pd_fd_snapshot(fds,&before)<0)return 66;
 static unsigned char bytes[PD_DESCRIPTOR_MAX];for(size_t i=0;i<sizeof(bytes);i++)bytes[i]=(unsigned char)(i%251);
 struct pd_descriptor_pin pin=PD_DESCRIPTOR_INITIALIZER;size_t length=!strcmp(fault,"max")?sizeof(bytes):8193;
 if(!strcmp(fault,"existing")){int f=openat(dir,"descriptor",O_WRONLY|O_CREAT|O_EXCL,0600);if(f<0||write(f,"old",3)!=3||close(f)<0)return 67;}
 if(!strcmp(fault,"symlink")&&symlinkat("missing",dir,"descriptor")<0)return 68;
 if(!strcmp(fault,"bad-directory")&&fchmod(dir,0755)<0)return 69;
 if(!strcmp(fault,"empty"))length=0;if(!strcmp(fault,"oversize"))length=PD_DESCRIPTOR_MAX+1;
 const void *input=!strcmp(fault,"null-bytes")?NULL:bytes;
 active=1;int r=pd_descriptor_create(dir,input,length,&pin),error=r<0?errno:0;active=0;
 int retained=pin.fd>=0,check=0,check_error=0,release=0,release_error=0,retry_error=0,child=0,locked=0;
 int write_count=writes,sync_count=syncs,read_count=reads;
 if(!r){
  heldfd=pin.fd;locked=competition(argv[2]);if(locked)return 70;
  if(!strcmp(fault,"caller-buffer"))memset(bytes,42,sizeof(bytes));
  if(!strcmp(fault,"change-content")&&pwrite(pin.fd,"!",1,0)!=1)return 71;
  if(!strcmp(fault,"truncate")&&ftruncate(pin.fd,1)<0)return 72;
  if(!strcmp(fault,"mode")&&fchmod(pin.fd,0644)<0)return 73;
  if(!strcmp(fault,"hardlink")&&linkat(dir,"descriptor",dir,"alias",0)<0)return 74;
  if(!strcmp(fault,"cloexec")&&fcntl(pin.fd,F_SETFD,0)<0)return 75;
  if(!strcmp(fault,"replace")){
   if(unlinkat(dir,"descriptor",0)<0)return 76;int f=openat(dir,"descriptor",O_WRONLY|O_CREAT|O_EXCL,0600);if(f<0||write(f,pin.bytes,pin.length)!=(ssize_t)pin.length||close(f)<0)return 77;
  }
  if(!strcmp(fault,"inherited")){
   pid_t p=fork();if(p<0)return 78;if(!p){if(pd_descriptor_check(&pin)!=-1||errno!=EPERM||pd_descriptor_release(&pin)!=-1||errno!=EPERM)_exit(85);_exit(0);}int status;if(waitpid(p,&status,0)!=p||!WIFEXITED(status))return 79;child=WEXITSTATUS(status);
  }
  int old_writes=writes,old_syncs=syncs;active=1;check=pd_descriptor_check(&pin);check_error=check<0?errno:0;active=0;
  if(writes!=old_writes||syncs!=old_syncs)return 82;
  active=1;release=pd_descriptor_release(&pin);release_error=release<0?errno:0;active=0;
  if(pd_descriptor_release(&pin)!=-1||errno!=ESTALE)return 83;
 }else if(pin.owner){if(pd_descriptor_create(dir,bytes,10,&pin)!=-1||errno!=EINVAL)return 84;}
 if(pin.owner){struct pd_descriptor_pin again=PD_DESCRIPTOR_INITIALIZER;
  if(!strcmp(fault,"lock")){/* lock failed before creation, but the original object remains consumed. */}
  else {int other=open(argv[2],O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(other<0)return 92;
   if(pd_descriptor_create(other,bytes,10,&again)!=-1)return 86;retry_error=errno;if(close(other)<0)return 93;}
 }
 if(leaked>=0&&close(leaked)<0)return 87;
 if(pin.unlock_error){if(competition(argv[2]))return 88;if(flock(dir,LOCK_UN)<0)return 89;}
 if(pd_fd_snapshot(fds,&after)<0||after!=before)return 91;
 struct stat st;int exists=fstatat(dir,"descriptor",&st,AT_SYMLINK_NOFOLLOW)==0;
 printf("{\"r\":%d,\"error\":%d,\"writes\":%d,\"syncs\":%d,\"reads\":%d,\"retained\":%d,\"check\":%d,\"checkError\":%d,\"release\":%d,\"releaseError\":%d,\"closeError\":%d,\"unlockError\":%d,\"retryError\":%d,\"child\":%d,\"closes\":%d,\"exists\":%d,\"size\":%lld,\"leaked\":%d}\n",r,error,write_count,sync_count,read_count,retained,check,check_error,release,release_error,pin.close_error,pin.unlock_error,retry_error,child,closes,exists,exists?(long long)st.st_size:0,leaked>=0);
 close(dir);return 0;
}
`;
 fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'descriptor-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'DESCRIPTOR_PIN',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};
 let serial=0;
 const run=fault=>{const store=join(dir,'store-'+serial++);fs.mkdirSync(store,{mode:0o700});const r=spawnSync(binary,[fault,store],{env,encoding:'utf8',timeout:8000});evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr+' harness '+r.stdout);return JSON.parse(r.stdout);};
 for(const fault of ['normal','max','short-eintr','read-eintr','read-short','caller-buffer','inherited'])await t.test('durable descriptor pin '+fault,()=>{
  const v=run(fault);assert.equal(v.r,0);assert.equal(v.syncs,2);assert.equal(v.retained,1);assert.equal(v.check,0);assert.equal(v.release,0);assert.equal(v.retryError,constants.errno.EEXIST);assert.equal(v.child,0);assert.equal(v.size,fault==='max'?65536:8193);assert.equal(v.closes,1);
 });
 for(const [fault,code]of [['lock','EAGAIN'],['write-error','EIO'],['zero-write','EIO'],['partial-write','ENOSPC'],['file-sync','EIO'],['directory-sync','EIO'],['read-error','EIO'],['read-eof','EIO'],['read-mutate','ESTALE'],['existing','EEXIST'],['symlink','EEXIST'],['combined-create','EIO']])await t.test('descriptor creation failure preserves partial bytes '+fault,()=>{
  const v=run(fault);assert.equal(v.r,-1);assert.equal(v.error,constants.errno[code]);assert.equal(v.retained,0);assert.equal(v.exists,fault==='lock'?0:1);if(fault==='partial-write')assert.equal(v.size,3);if(fault==='existing')assert.equal(v.size,3);if(fault==='combined-create'){assert.equal(v.closeError,constants.errno.EINTR);assert.equal(v.unlockError,constants.errno.ENOSPC);assert.equal(v.leaked,1);}
 });
 for(const [fault,code]of [['empty','EINVAL'],['oversize','EINVAL'],['null-bytes','EINVAL'],['bad-directory','EPERM']])await t.test('descriptor prevalidation performs no write '+fault,()=>{
  const v=run(fault);assert.equal(v.r,-1);assert.equal(v.error,constants.errno[code]);assert.equal(v.writes,0);assert.equal(v.syncs,0);assert.equal(v.exists,0);
 });
 for(const fault of ['change-content','truncate','mode','hardlink','replace','cloexec'])await t.test('held descriptor detects changed bytes or identity '+fault,()=>{
  const v=run(fault);assert.equal(v.r,0);assert.equal(v.check,-1);assert.equal(v.checkError,constants.errno[fault==='cloexec'?'EPERM':'ESTALE']);assert.equal(v.release,0);assert.equal(v.exists,1);
 });
 for(const fault of ['close-eintr','unlock','combined-release'])await t.test('descriptor release retains cleanup errors '+fault,()=>{
  const v=run(fault);assert.equal(v.r,0);assert.equal(v.release,-1);assert.equal(v.releaseError,constants.errno[fault==='unlock'?'ENOSPC':'EINTR']);assert.equal(v.closeError,fault==='unlock'?0:constants.errno.EINTR);assert.equal(v.unlockError,fault==='close-eintr'?0:constants.errno.ENOSPC);assert.equal(v.closes,1);
 });
 t.diagnostic(JSON.stringify(evidence));
});

test('producer-descriptor-reservation-binding',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-descriptor-binding-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);
 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
static const char *fault;
static int active,writes,syncs,forks,reads;
static ssize_t test_write(int,const void*,size_t);
static ssize_t test_pread(int,void*,size_t,off_t);
static int test_sync(int);
static pid_t test_fork(void);
#define write test_write
#define pread test_pread
#define fsync test_sync
#define fork test_fork
#define PD_LEGACY_OWNER_TEST 1
#define main preflight_main
#include "helper.c"
#undef main
#undef write
#undef pread
#undef fsync
#undef fork
static ssize_t test_write(int fd,const void*b,size_t n){if(active)++writes;return write(fd,b,n);}
static ssize_t test_pread(int fd,void*b,size_t n,off_t off){if(active){++reads;if(!strcmp(fault,"read-error")){errno=EIO;return -1;}if(!strcmp(fault,"read-eof"))return 0;if(!strcmp(fault,"second-read-error")&&reads==2){errno=EIO;return -1;}if(!strcmp(fault,"second-read-change")&&reads==2&&pwrite(fd,"!",1,0)!=1)_exit(85);}return pread(fd,b,n,off);}
static int test_sync(int fd){if(active){++syncs;if(!strcmp(fault,"begin-sync-error")){errno=EIO;return -1;}}return fsync(fd);}
static pid_t test_fork(void){if(active){++forks;if(!strcmp(fault,"begin-fork-error")){errno=EAGAIN;return -1;}}return fork();}
int main(int argc,char**argv){
 if(argc!=4)return 64;fault=argv[1];size_t length=(size_t)strtoul(argv[3],NULL,10);if(!length||length>PD_DESCRIPTOR_MAX)return 65;
 int dir=open(argv[2],O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(dir<0)return 66;
 if(mkdirat(dir,"admission",0700)<0)return 67;int ad=openat(dir,"admission",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(ad<0)return 68;
 int fds[PD_FD_SCAN_MAX];size_t before,after;if(pd_fd_snapshot(fds,&before)<0)return 69;
 static unsigned char bytes[PD_DESCRIPTOR_MAX];for(size_t i=0;i<length;i++)bytes[i]=(unsigned char)(i%251);if(length==3)memcpy(bytes,"abc",3);
 struct pd_descriptor_pin pin=PD_DESCRIPTOR_INITIALIZER;if(pd_descriptor_create(dir,bytes,length,&pin)<0)return 70;
 char binding[65];memset(binding,'?',64);binding[64]=0;
 struct pd_setup_owner owner=PD_SETUP_OWNER_INITIALIZER;
 if(!strcmp(fault,"change-content")&&pwrite(pin.fd,"!",1,0)!=1)return 71;
 if(!strcmp(fault,"replace")){if(unlinkat(dir,"descriptor",0)<0)return 72;int f=openat(dir,"descriptor",O_CREAT|O_EXCL|O_WRONLY,0600);if(f<0||write(f,bytes,length)!=(ssize_t)length||close(f)<0)return 73;}
 if(!strcmp(fault,"released")&&pd_descriptor_release(&pin)<0)return 74;
 if(!strcmp(fault,"begin-caller-changed"))memset(bytes,42,length);
 int begin=!strncmp(fault,"begin-",6),alias=-1,target=ad,r,error,phase=0,child_status=-1;
 if(!strcmp(fault,"begin-same-dir"))target=dir;
 if(!strcmp(fault,"begin-alias-dir")){alias=open(argv[2],O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(alias<0)return 75;target=alias;}
 if(!strcmp(fault,"begin-invalid-dir"))target=-1;
 if(!strcmp(fault,"begin-invalid-owner"))owner.stage=PD_SETUP_CANCELLED;
 if(!strcmp(fault,"inherited")){
  pid_t p=fork();if(p<0)return 76;if(!p){active=1;int a=pd_descriptor_binding(&pin,binding),e=errno;int b=pd_setup_owner_begin_descriptor(ad,&pin,&owner),f=errno;_exit(a==-1&&e==EPERM&&b==-1&&f==EPERM&&!writes&&!forks&&binding[0]=='?'?0:77);}int st;if(waitpid(p,&st,0)!=p||!WIFEXITED(st)||WEXITSTATUS(st))return 78;
 }
 /* Acknowledge the child's PREPARED observation before parent cancellation. */
 int ack[2]={-1,-1};if(begin&&pipe(ack)<0)return 89;
 active=1;
 r=begin?pd_setup_owner_begin_descriptor(target,&pin,&owner):pd_descriptor_binding(!strcmp(fault,"null-pin")?NULL:&pin,!strcmp(fault,"null-out")?NULL:binding);
 error=r<0?errno:0;active=0;
 if(begin&&r==0){int ready=0;if(close(ack[0])<0||pd_scan(ad,owner.binding,&ready)<0||ready!=PD_PREPARED)_exit(86);if(write(ack[1],"P",1)!=1||close(ack[1])<0)_exit(90);_exit(42);}
 if(begin){
  if(close(ack[1])<0)return 91;
  if(r==1){struct pollfd p={.fd=ack[0],.events=POLLIN};int ready;do{ready=poll(&p,1,2000);}while(ready<0&&errno==EINTR);char value=0;if(ready<=0||read(ack[0],&value,1)!=1||value!='P')return 92;}
  if(close(ack[0])<0)return 93;
 }
 if(!begin&&r<0&&strcmp(fault,"null-out")&&strcmp(fault,"second-read-error")&&strcmp(fault,"second-read-change")){
  active=1;int denied=pd_setup_owner_begin_descriptor(ad,!strcmp(fault,"null-pin")?NULL:&pin,&owner);int denied_error=errno;active=0;
  if(denied!=-1||denied_error!=error||owner.stage!=PD_SETUP_NEW)return 87;
  if(denied==0)_exit(88);
 }
 int operation_writes=writes,operation_syncs=syncs,operation_forks=forks;
 if(begin&&owner.owner){memcpy(binding,owner.binding,65);
  if(owner.pipe.sender.fd>=0&&owner.pipe.receiver.fd>=0){struct pd_setup_cleanup c;if(pd_scan(ad,binding,&phase)<0||pd_setup_owner_cancel(&owner,2000,&c)<0)return 79;}
  else if(owner.child>0){struct pd_setup_cleanup c;if(pd_scan(ad,binding,&phase)<0||pd_setup_owner_cancel(&owner,2000,&c)<0)return 80;child_status=c.child.status;}
  if(pd_setup_owner_begin_descriptor(ad,&pin,&owner)!=-1||errno!=EINVAL)return 81;
 }
 if(alias>=0&&close(alias)<0)return 82;
 if(pin.state==PD_DESCRIPTOR_HELD&&pd_descriptor_release(&pin)<0)return 83;
 if(pd_fd_snapshot(fds,&after)<0||before!=after)return 84;
 printf("{\"r\":%d,\"error\":%d,\"binding\":\"%s\",\"writes\":%d,\"syncs\":%d,\"forks\":%d,\"phase\":%d,\"beginError\":%d,\"childStatus\":%d}\n",r,error,binding,operation_writes,operation_syncs,operation_forks,phase,owner.begin_error,child_status);
 close(ad);close(dir);return 0;
}
`;
 fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'descriptor-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'DESCRIPTOR_BINDING',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};

 let serial=0;
 const run=(fault,length=129)=>{const store=join(dir,'store-'+serial++);fs.mkdirSync(store,{mode:0o700});const r=spawnSync(binary,[fault,store,String(length)],{env,encoding:'utf8',timeout:8000});evidence.invocations.push({fault,length,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr+' harness '+r.stdout);return JSON.parse(r.stdout);};
 const expected=length=>{const bytes=Buffer.alloc(length);for(let i=0;i<length;i++)bytes[i]=i%251;if(length===3)bytes.write('abc');return hash(bytes);};
 for(const length of [1,3,55,56,63,64,65,119,120,127,128,129,4096,4097,65536])await t.test('descriptor SHA256 agrees with independent Node oracle length '+length,()=>{const v=run('digest',length);assert.equal(v.r,0);assert.equal(v.binding,expected(length));assert.equal(v.writes,0);assert.equal(v.syncs,0);assert.equal(v.forks,0);});
 for(const fault of ['begin-normal','begin-caller-changed','begin-fork-error','begin-sync-error'])await t.test('descriptor-derived reservation retains original outcome '+fault,()=>{const v=run(fault);assert.equal(v.binding,expected(129));assert.equal(v.r,fault==='begin-normal'||fault==='begin-caller-changed'?1:-1);assert.equal(v.phase,fault==='begin-sync-error'?0:1);assert.equal(v.forks,fault==='begin-sync-error'?0:1);assert.equal(v.beginError,fault==='begin-fork-error'?constants.errno.EAGAIN:fault==='begin-sync-error'?constants.errno.EIO:0);if(v.r===1)assert.equal(v.childStatus,42<<8);});
 for(const [fault,code]of [['change-content','ESTALE'],['replace','ESTALE'],['released','ESTALE'],['null-pin','EINVAL'],['null-out','EINVAL'],['read-error','EIO'],['read-eof','EIO'],['second-read-error','EIO'],['second-read-change','ESTALE'],['begin-same-dir','EINVAL'],['begin-alias-dir','EINVAL'],['begin-invalid-dir','EBADF'],['begin-invalid-owner','EINVAL']])await t.test('descriptor binding refuses before reservation '+fault,()=>{const v=run(fault);assert.equal(v.r,-1);assert.equal(v.error,constants.errno[code]);assert.equal(v.binding,'?'.repeat(64));assert.equal(v.writes,0);assert.equal(v.syncs,0);assert.equal(v.forks,0);});
 await t.test('inherited descriptor cannot derive binding or reserve',()=>{const v=run('inherited');assert.equal(v.r,0);assert.equal(v.binding,expected(129));assert.equal(v.writes,0);assert.equal(v.forks,0);});
 t.diagnostic(JSON.stringify(evidence));
});

test('producer-descriptor-publication-boundary',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'producer-descriptor-publication-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc');
 const compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 fs.writeFileSync(join(dir,'helper.c'),raw);
 const harness=String.raw`
#define _GNU_SOURCE
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
static const char *fault;
static int active,ad,dd,df,sender,writes,syncs,reads,go_writes,changes,probes;
static ssize_t test_write(int,const void*,size_t);
static ssize_t test_pread(int,void*,size_t,off_t);
static int test_sync(int);
static int test_close(int);
static int test_flock(int,int);
#define write test_write
#define pread test_pread
#define fsync test_sync
#define close test_close
#define flock test_flock
#define PD_LEGACY_OWNER_TEST 1
#define main preflight_main
#include "helper.c"
#undef main
#undef write
#undef pread
#undef fsync
#undef close
#undef flock
static void probe(void){int f=openat(ad,".",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(f<0)_exit(100);if(flock(f,LOCK_EX|LOCK_NB)!=-1||(errno!=EWOULDBLOCK&&errno!=EAGAIN))_exit(101);if(close(f)<0)_exit(102);++probes;}
static void change(void){if(pwrite(df,"!",1,0)!=1)_exit(103);++changes;}
static ssize_t test_write(int fd,const void*b,size_t n){if(active){++writes;if(fd==sender){++go_writes;probe();if(!strcmp(fault,"short-go"))return write(fd,b,1);}}return write(fd,b,n);}
static ssize_t test_pread(int fd,void*b,size_t n,off_t off){if(active&&fd==df){++reads;if(reads==3){probe();if(!strcmp(fault,"post-read-error")){errno=EIO;return -1;}if(!strcmp(fault,"post-read-change"))change();if(!strcmp(fault,"post-admission-change")){int f=openat(ad,"ADMITTED.commit",O_WRONLY);if(f<0||pwrite(f,"!",1,12)!=1||close(f)<0)_exit(104);++changes;}}if(reads==1&&!strcmp(fault,"pre-read-error")){errno=EIO;return -1;}}return pread(fd,b,n,off);}
static int test_sync(int fd){if(active){++syncs;if(!strcmp(fault,"sync-error")){errno=EIO;return -1;}if((!strcmp(fault,"during-sync1")&&syncs==1)||((!strcmp(fault,"during-sync4")||!strcmp(fault,"combined"))&&syncs==4))change();if(!strcmp(fault,"during-replace")&&syncs==4){char b[3];if(pread(df,b,3,0)!=3||unlinkat(dd,"descriptor",0)<0)_exit(105);int f=openat(dd,"descriptor",O_CREAT|O_EXCL|O_WRONLY,0600);if(f<0||write(f,b,3)!=3||close(f)<0)_exit(106);++changes;}}return fsync(fd);}
static int test_close(int fd){int r=close(fd);if(active&&fd==sender&&!strcmp(fault,"close-error")){errno=EIO;return -1;}return r;}
static int test_flock(int fd,int op){if(active&&fd==ad&&op==LOCK_UN&&(!strcmp(fault,"unlock")||!strcmp(fault,"combined"))){errno=ENOSPC;return -1;}return flock(fd,op);}
int main(int argc,char**argv){
 if(argc!=3)return 64;fault=argv[1];int root=open(argv[2],O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(root<0)return 65;
 if(mkdirat(root,"descriptor-dir",0700)<0||mkdirat(root,"admission",0700)<0||mkdirat(root,"other",0700)<0)return 66;
 dd=openat(root,"descriptor-dir",O_RDONLY|O_DIRECTORY|O_CLOEXEC);ad=openat(root,"admission",O_RDONLY|O_DIRECTORY|O_CLOEXEC);int other=openat(root,"other",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(dd<0||ad<0||other<0)return 67;
 int fds[PD_FD_SCAN_MAX];size_t before,after;if(pd_fd_snapshot(fds,&before)<0)return 68;
 struct pd_descriptor_pin pin=PD_DESCRIPTOR_INITIALIZER;if(pd_descriptor_create(dd,"abc",3,&pin)<0)return 69;df=pin.fd;
 struct pd_setup_owner owner=PD_SETUP_OWNER_INITIALIZER;int began=pd_setup_owner_begin_descriptor(ad,&pin,&owner);if(began<0)return 70;
 if(!began){struct pd_setup_wait_result r;int v=pd_setup_owner_wait(&owner,NULL,0,2000,&r);_exit(v==0?17:42);}
 sender=owner.pipe.sender.fd;char original_binding[65];memcpy(original_binding,owner.binding,65);
 signal(SIGPIPE,SIG_IGN);
 if(!strcmp(fault,"inherited")){pid_t p=fork();if(p<0)return 71;if(!p){struct pd_descriptor_publication x;active=1;int r=pd_setup_owner_publish_descriptor(&owner,&pin,&x);_exit(r==-1&&errno==EPERM&&!x.attempted&&!writes?0:72);}int st;if(waitpid(p,&st,0)!=p||!WIFEXITED(st)||WEXITSTATUS(st))return 73;}
 if(!strcmp(fault,"pre-content"))change();
 if(!strcmp(fault,"released")&&pd_descriptor_release(&pin)<0)return 74;
 struct pd_descriptor_pin replacement=PD_DESCRIPTOR_INITIALIZER;
 if(!strcmp(fault,"different-binding")&&pd_descriptor_create(other,"xyz",3,&replacement)<0)return 75;
 if(!strcmp(fault,"wrong-stage"))owner.stage=PD_SETUP_CANCELLED;
 if(!strcmp(fault,"begin-error"))owner.begin_error=EIO;
 if(!strcmp(fault,"closure"))owner.closure=PD_SETUP_CLOSED;
 if(!strcmp(fault,"same-directory")){owner.store=dd;owner.store_identity=pin.directory;}
 if(!strcmp(fault,"store-replaced"))owner.store=other;
 if(!strcmp(fault,"already-admitted")&&pd_admission_append(ad,owner.binding,PD_PREPARED,PD_ADMITTED)<0)return 76;
 struct pd_descriptor_publication result={0};active=1;
 int r=pd_setup_owner_publish_descriptor(!strcmp(fault,"null-owner")?NULL:&owner,!strcmp(fault,"null-pin")?NULL:!strcmp(fault,"different-binding")?&replacement:&pin,!strcmp(fault,"null-result")?NULL:&result),error=r<0?errno:0;active=0;
 int saved_writes=writes,saved_syncs=syncs,saved_go=go_writes,phase=-1,scan_error=0;
 if(pd_scan(ad,original_binding,&phase)<0)scan_error=errno;
 int held_lock=0,f=openat(ad,".",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(f<0)return 77;if(flock(f,LOCK_EX|LOCK_NB)<0){if(errno!=EWOULDBLOCK&&errno!=EAGAIN)return 78;held_lock=1;}else if(flock(f,LOCK_UN)<0)return 79;close(f);
 int descriptor_lock=-1;if(pin.state==PD_DESCRIPTOR_HELD){f=openat(dd,".",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(f<0)return 80;descriptor_lock=flock(f,LOCK_EX|LOCK_NB)<0&&(errno==EWOULDBLOCK||errno==EAGAIN);close(f);if(!descriptor_lock)return 81;}
 if(result.attempted){struct pd_descriptor_publication again;struct pd_setup_publication legacy;active=1;if(pd_setup_owner_publish_descriptor(&owner,&pin,&again)!=-1||errno!=ESTALE||again.attempted)return 82;if(pd_setup_owner_publish(&owner,&legacy)!=-1||errno!=ESTALE||legacy.attempted)return 83;active=0;if(writes!=saved_writes||go_writes!=saved_go)return 84;}
 /* Fixture reconciliation is separate from publication. Never retry consumed FDs. */
 if(held_lock&&flock(ad,LOCK_UN)<0)return 85;
 if(owner.pipe.sender.fd>=0){if(close(owner.pipe.sender.fd)<0)return 86;owner.pipe.sender.fd=-1;}
 int st;if(waitpid(owner.child,&st,0)!=owner.child||!WIFEXITED(st))return 87;
 if(pin.state==PD_DESCRIPTOR_HELD&&pd_descriptor_release(&pin)<0)return 88;
 if(replacement.state==PD_DESCRIPTOR_HELD&&pd_descriptor_release(&replacement)<0)return 89;
 if(pd_fd_snapshot(fds,&after)<0||before!=after)return 90;
 printf("{\"r\":%d,\"error\":%d,\"attempted\":%d,\"resultError\":%d,\"cleanupError\":%d,\"delivery\":%d,\"writes\":%d,\"syncs\":%d,\"goWrites\":%d,\"phase\":%d,\"scanError\":%d,\"changes\":%d,\"probes\":%d,\"heldLock\":%d,\"descriptorLock\":%d,\"exit\":%d}\n",r,error,result.attempted,result.error,result.cleanup_error,result.delivery,saved_writes,saved_syncs,saved_go,phase,scan_error,changes,probes,held_lock,descriptor_lock,WEXITSTATUS(st));
 close(other);close(ad);close(dd);close(root);return 0;
}
`;
 fs.writeFileSync(join(dir,'harness.c'),harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){
  const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  const path=fs.realpathSync(r.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'));
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 const binary=join(dir,'descriptor-test');argv.push(join(dir,'harness.c'),'-o',binary);
 const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const evidence={component:'DESCRIPTOR_PUBLICATION',sourceSha256:hash(raw),harnessSha256:hash(harness),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),nativeAcceptance:false,platform:process.platform,invocations:[]};


 let serial=0;
 const run=fault=>{const store=join(dir,'store-'+serial++);fs.mkdirSync(store,{mode:0o700});const r=spawnSync(binary,[fault,store],{env,encoding:'utf8',timeout:8000});evidence.invocations.push({fault,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr+' harness '+r.stdout);return JSON.parse(r.stdout);};
 for(const fault of ['normal','inherited'])await t.test('descriptor-bound publication completes local GO '+fault,()=>{const v=run(fault);assert.equal(v.r,0);assert.equal(v.attempted,1);assert.equal(v.delivery,2);assert.equal(v.phase,2);assert.equal(v.syncs,4);assert.equal(v.goWrites,1);assert.equal(v.exit,17);assert.equal(v.descriptorLock,1);assert.equal(v.probes,2);});
 for(const [fault,code] of [['pre-content','ESTALE'],['pre-read-error','EIO'],['released','ESTALE'],['different-binding','ESTALE']])await t.test('descriptor mismatch consumes publication before storage '+fault,()=>{const v=run(fault);assert.equal(v.r,-1);assert.equal(v.error,constants.errno[code]);assert.equal(v.resultError,v.error);assert.equal(v.attempted,1);assert.equal(v.delivery,0);assert.equal(v.writes,0);assert.equal(v.syncs,0);assert.equal(v.phase,1);assert.equal(v.exit,42);});
 for(const [fault,code] of [['during-sync1','ESTALE'],['during-sync4','ESTALE'],['during-replace','ESTALE'],['post-read-error','EIO'],['post-read-change','ESTALE'],['post-admission-change','ESTALE']])await t.test('post-admission recheck refuses GO and retains history '+fault,()=>{const v=run(fault);assert.equal(v.r,-1);assert.equal(v.error,constants.errno[code]);assert.equal(v.attempted,1);assert.equal(v.delivery,0);assert.equal(v.goWrites,0);assert.equal(v.syncs,4);assert.equal(v.exit,42);assert.equal(v.descriptorLock,1);if(fault==='post-admission-change')assert.equal(v.scanError,constants.errno.EINVAL);else assert.equal(v.phase,2);if(fault!=='post-read-error')assert.equal(v.changes,1);});
 for(const [fault,code] of [['null-owner','EINVAL'],['null-pin','EINVAL'],['null-result','EINVAL'],['wrong-stage','ESTALE'],['closure','ESTALE'],['begin-error','EPERM'],['same-directory','EINVAL'],['store-replaced','ESTALE']])await t.test('descriptor publication rejects invalid owner before attempt '+fault,()=>{const v=run(fault);assert.equal(v.r,-1);assert.equal(v.error,constants.errno[code]);assert.equal(v.attempted,0);assert.equal(v.writes,0);assert.equal(v.syncs,0);assert.equal(v.goWrites,0);assert.equal(v.phase,1);assert.equal(v.exit,42);});
 for(const fault of ['sync-error','already-admitted','short-go','close-error','unlock','combined'])await t.test('descriptor publication preserves storage transport and cleanup errors '+fault,()=>{const v=run(fault);assert.equal(v.r,-1);assert.equal(v.attempted,1);assert.equal(v.error,constants.errno[fault==='already-admitted'?'ESTALE':fault==='unlock'?'ENOSPC':fault==='combined'?'ESTALE':'EIO']);assert.equal(v.resultError,v.error);assert.equal(v.goWrites,['short-go','close-error','unlock'].includes(fault)?1:0);assert.equal(v.delivery,fault==='unlock'?2:['short-go','close-error'].includes(fault)?1:0);assert.equal(v.exit,['close-error','unlock'].includes(fault)?17:42);assert.equal(v.cleanupError,['unlock','combined'].includes(fault)?constants.errno.ENOSPC:0);assert.equal(v.heldLock,['unlock','combined'].includes(fault)?1:0);if(fault==='sync-error')assert.equal(v.scanError,constants.errno.EINPROGRESS);else assert.equal(v.phase,2);});
 t.diagnostic(JSON.stringify(evidence));
});

// Schema3 is a separately completed design, never a reinterpretation of v2.
async function componentReviewAuthorityFixture(t){
 const f=await componentAmendmentFixture(t),ref=path=>({path,sha256:hash(fs.readFileSync(file(f,path)))}),old=structuredClone(f.restartAttestation);
 put(file(f,'evidence/schema2-review.md'),fs.readFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'),'utf8'));
 const capture=(path,prefix)=>{const raw=fs.readFileSync(file(f,path)),copy=prefix+'/'+path;put(file(f,copy),raw.toString());return {...ref(path),bytes:raw.length,copy};};
 const previous=read(file(f,'evidence/amendment-entry.json'));previous.entries=previous.entries.filter(e=>!['work/enterprise/plan.json',old.contractPath].includes(e.path));previous.entries.push(...['work/enterprise/plan.json',old.contractPath].map(p=>capture(p,'evidence/schema2-completed')));
 put(file(f,'evidence/schema2-completed-entry.json'),previous);
 const checkpoint=read(file(f,'evidence/integration-checkpoint.json'));checkpoint.iteration=4;checkpoint.references=checkpoint.references.filter(r=>r.path!=='evidence/amendment-entry.json');checkpoint.references.push({...ref('evidence/schema2-completed-entry.json'),bytes:fs.statSync(file(f,'evidence/schema2-completed-entry.json')).size});put(file(f,'evidence/prior-integration.json'),checkpoint);
 // An unapproved intervening schema2 proposal, with its own entry checkpoint.
 mutate(f,'work/enterprise/plan.json',p=>{p.preparationRestart.entrySnapshot='evidence/schema2-completed-entry.json';p.preparationRestart.integrationCheckpoint=ref('evidence/prior-integration.json');});put(file(f,old.contractPath),'synthetic unapproved schema2 proposal');
 const entry=read(file(f,'evidence/restart-entry.json'));entry.entries.push(...[...old.permittedPaths,'scripts/enterprise/verify.mjs','work/enterprise/plan.json',old.contractPath].map(p=>capture(p,'evidence/schema3-entry')));put(file(f,'evidence/schema3-entry.json'),entry);
 const integration=read(file(f,'evidence/integration-checkpoint.json'));integration.iteration=5;integration.references=entry.entries.filter(e=>[...old.permittedPaths,'scripts/enterprise/verify.mjs'].includes(e.path)).map(e=>({path:e.copy,sha256:e.sha256,bytes:e.bytes,sourcePath:e.path}));integration.references.push(...['work/enterprise/PREPARATION_PRODUCER_CONTAINMENT.md','work/enterprise/PREPARATION_CAPTURE_RECOVERY.md','evidence/reassessment.json','evidence/validation.json','evidence/schema2-review.md','evidence/schema3-entry.json'].map(path=>({...ref(path),bytes:fs.statSync(file(f,path)).size})));put(file(f,'evidence/schema3-integration.json'),integration);
 put(file(f,old.contractPath),'synthetic schema3 contract');for(const path of ['work/enterprise/PREPARATION_DESCRIPTOR.md','work/enterprise/PREPARATION_COMPONENT_REVIEW.md'])put(file(f,path),'synthetic reviewed contract');
 mutate(f,'work/enterprise/plan.json',p=>{const e=p.preparationRestart;e.schemaVersion=3;e.permission='IMPLEMENTATION_AND_ISOLATED_REVIEW_ONLY';e.componentReviewAuthority=true;e.permittedPaths.push('scripts/enterprise/verify.mjs');e.entrySnapshot='evidence/schema3-entry.json';e.integrationCheckpoint=ref('evidence/schema3-integration.json');e.previousIntegrationCheckpoint=ref('evidence/prior-integration.json');e.historicalVersion2={schemaVersion:2,permittedPaths:old.permittedPaths,proposalPlan:ref('evidence/schema3-entry/work/enterprise/plan.json'),contract:ref('evidence/schema3-entry/'+old.contractPath),completedReview:ref('evidence/schema2-review.md'),proposalApproved:false,currentAmendmentAuthority:false};e.componentReview={contract:ref('work/enterprise/PREPARATION_COMPONENT_REVIEW.md')};e.descriptorIntegration={contract:ref('work/enterprise/PREPARATION_DESCRIPTOR.md')};});
 const m=ok(spawnSync(process.execPath,['--input-type=module','-e',"import {inputs} from './scripts/enterprise/evidence.mjs';console.log(JSON.stringify(inputs(process.cwd())));"],{cwd:f.root,env:f.env,encoding:'utf8'}));put(file(f,'evidence/schema3-inputs.json'),m);
 f.restartAttestation={...old,schemaVersion:3,iteration:6,permission:'IMPLEMENTATION_AND_ISOLATED_REVIEW_ONLY',componentReviewAuthority:true,contractSha256:ref(old.contractPath).sha256,planSha256:ref('work/enterprise/plan.json').sha256,reviewInputsDigest:m.digest,reviewInputsManifest:ref('evidence/schema3-inputs.json'),entryManifest:ref('evidence/schema3-entry.json'),permittedPaths:[...old.permittedPaths,'scripts/enterprise/verify.mjs']};
 phases(f,'review-architecture',6,fenced('enterprise-preparation-restart-attestation',f.restartAttestation));f.context('build-foundation',7);return f;
}
function rewriteSchema3(f,edit,{rebind=false}={}){
 const a=structuredClone(f.restartAttestation);if(rebind){const m=ok(spawnSync(process.execPath,['--input-type=module','-e',"import {inputs} from './scripts/enterprise/evidence.mjs';console.log(JSON.stringify(inputs(process.cwd())));"],{cwd:f.root,env:f.env,encoding:'utf8'}));put(file(f,'evidence/schema3-inputs.json'),m);a.planSha256=hash(fs.readFileSync(file(f,'work/enterprise/plan.json')));a.reviewInputsDigest=m.digest;a.reviewInputsManifest.sha256=hash(fs.readFileSync(file(f,'evidence/schema3-inputs.json')));}
 edit(a);const text=fenced('enterprise-preparation-restart-attestation',a);for(const r of f.records.filter(r=>r.step==='review-architecture'&&r.iteration===6&&r.type==='phase_complete'))r.content=text;f.append({type:'boundary'});put(join(f.run.reportsAbs,'enterprise-02-review.md'),text+'\n');
}
test('component-development-schema3-authority-boundary',async t=>{
 const f=await componentReviewAuthorityFixture(t),reset=restorePoint(f);
 await t.test('schema3 exact eight paths authenticate without implementation acceptance',()=>{const r=componentDevelopmentRead(f);assert.equal(r.status,0,r.stderr);const d=JSON.parse(r.stdout);assert.equal(d.permission,'IMPLEMENTATION_AND_ISOLATED_REVIEW_ONLY');assert.equal(d.ordinaryBatchAuthority,false);assert.equal(d.nativeAcceptance,false);assert.deepEqual(d.currentApprovals,[]);assert.deepEqual(d.changedPaths,[]);});
 await t.test('schema3 permits verify edit while frozen copies remain exact',()=>{reset();fs.appendFileSync(file(f,'scripts/enterprise/verify.mjs'),'\n// permitted\n');const r=componentDevelopmentRead(f);assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout).changedPaths,['scripts/enterprise/verify.mjs']);});
 for(const [name,edit,re]of [['permission',a=>a.permission='IMPLEMENTATION_AND_ISOLATED_TESTS_ONLY',/restart permission/],['review authority',a=>a.componentReviewAuthority=false,/componentReviewAuthority/],['missing authority',a=>delete a.componentReviewAuthority,/attestation fields/],['unknown schema',a=>a.schemaVersion=4,/schemaVersion|attestation fields/],['extra field',a=>a.force=true,/attestation fields/],['foreign run',a=>a.runSlug='foreign',/restart runSlug/],['foreign bundle',a=>a.bundleDigest='0'.repeat(64),/restart bundleDigest/],['wrong runtime',a=>a.runtimeIdentity.version='wrong',/runtime identity/],...['captureAuthority','recoveryAuthority','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority'].map(k=>[k,a=>a[k]=true,new RegExp('restart '+k)])])await t.test('schema3 refuses '+name+' before writes',()=>{reset();rewriteSchema3(f,edit);fail(componentDevelopmentRead(f,['--test-component-development']),re);assert.deepEqual(componentOutputs(f),[]);});
 for(const count of [7,9])await t.test('schema3 exact paths reject count '+count,()=>{reset();const paths=f.restartAttestation.permittedPaths.slice(0,count);if(count===9)paths.push('scripts/enterprise/context.mjs');mutate(f,'work/enterprise/plan.json',p=>p.preparationRestart.permittedPaths=paths);rewriteSchema3(f,a=>a.permittedPaths=paths,{rebind:true});fail(componentDevelopmentRead(f),/restart exact eight paths/);});
 for(const path of ['evidence/schema3-integration.json','evidence/schema3-entry/scripts/enterprise/verify.mjs','evidence/schema2-review.md','evidence/schema2-completed/work/enterprise/plan.json','evidence/historical-review.md','evidence/restart-inputs.json','evidence/restart-checkpoint.json','src/domain.mjs'])await t.test('schema3 refuses changed '+path,()=>{reset();fs.appendFileSync(file(f,path),' ');fail(componentDevelopmentRead(f),/restart changed reference|restart unreviewed input/);});
 for(const kind of ['phase','canonical','unfinished','session','model','effort'])await t.test('schema3 current provenance '+kind+' refuses',()=>{reset();if(kind==='canonical')fs.appendFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'),'change');if(kind==='phase')f.records.find(r=>r.type==='phase_complete'&&r.iteration===6).content+='\n```enterprise-preparation-restart-attestation\n{}\n```';if(kind==='unfinished')f.records.find(r=>r.type==='step_complete'&&r.iteration===6).status='error';if(kind==='session')savePersonaSessions(f.root,{...f.sessions,[JSON.stringify(['enterprise-architecture-reviewer','codex','gpt-6-astra'])]:'builder-session'},'codex',f.paths.sessionsDirectory);if(kind==='model')f.records.findLast(r=>r.type==='step_start').model='gpt-6.1-sol';if(kind==='effort')f.records.findLast(r=>r.type==='step_start').providerOptions.codex.reasoningEffort='low';f.append({type:'boundary'});fail(componentDevelopmentRead(f),/restart|preparation|independent|context/);});
 for(const version of [1,2])await t.test('schema3 authenticates completed historical schema'+version,()=>{reset();f.records.find(r=>r.type==='step_complete'&&r.step==='review-architecture'&&r.iteration===(version===1?2:4)).status='error';f.append({type:'boundary'});fail(componentDevelopmentRead(f),/incomplete preparation occurrence/);});
 for(const flag of ['proposalApproved','currentAmendmentAuthority'])await t.test('schema3 rejects historical proposal '+flag,()=>{reset();mutate(f,'work/enterprise/plan.json',p=>p.preparationRestart.historicalVersion2[flag]=true);rewriteSchema3(f,()=>{},{rebind:true});fail(componentDevelopmentRead(f),/restart historical/);});
 await t.test('schema3 rechecks immutable copies after await',()=>{reset();const target=file(f,'evidence/schema3-entry/scripts/enterprise/verify.mjs'),hook=componentHook(f,'schema3-await',"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const read=fs.readFileSync;let n=0;fs.readFileSync=function(p,...a){const b=read(p,...a);return String(p)==="+JSON.stringify(target)+"&&++n>=3?Buffer.concat([Buffer.from(b),Buffer.from(' ')]):b;};syncBuiltinESMExports();");fail(componentDevelopmentRead(f,['--inspect-component-development'],[hook]),/restart concurrent reference/);});

 for(const kind of ['duplicate','mixed'])await t.test('schema3 rejects '+kind+' attestation encoding',()=>{reset();let text=fenced('enterprise-preparation-restart-attestation',f.restartAttestation);text=kind==='duplicate'?text.replace('"schemaVersion":3','"schemaVersion":3,"schemaVersion":3'):text+'\n```enterprise-batch-attestation\n{}\n```';for(const r of f.records.filter(r=>r.type==='phase_complete'&&r.iteration===6))r.content=text;f.append({type:'boundary'});put(join(f.run.reportsAbs,'enterprise-02-review.md'),text+'\n');fail(componentDevelopmentRead(f),/duplicate preparation field|mixed preparation/);});
 for(const kind of ['old-permission','old-paths','old-phase','proposal-as-approval'])await t.test('schema3 rejects historical '+kind,()=>{reset();if(kind==='old-phase'){f.records.find(r=>r.type==='phase_complete'&&r.iteration===4).content=f.records.find(r=>r.type==='phase_complete'&&r.iteration===4).content.replace('APPROVE','REQUEST_CHANGES');f.append({type:'boundary'});}else{const path='evidence/schema2-review.md',raw=fs.readFileSync(file(f,path),'utf8'),a=JSON.parse(raw.match(/```enterprise-preparation-restart-attestation\n([\s\S]*?)\n```/)[1]);if(kind==='old-permission')a.permission='IMPLEMENTATION_AND_ISOLATED_REVIEW_ONLY';if(kind==='old-paths')a.permittedPaths.push('scripts/enterprise/verify.mjs');if(kind==='proposal-as-approval')a.planSha256=hash(fs.readFileSync(file(f,'evidence/schema3-entry/work/enterprise/plan.json')));put(file(f,path),fenced('enterprise-preparation-restart-attestation',a)+'\n');mutate(f,'evidence/schema3-integration.json',c=>{const r=c.references.find(r=>r.path===path);r.sha256=hash(fs.readFileSync(file(f,path)));r.bytes=fs.statSync(file(f,path)).size;});mutate(f,'work/enterprise/plan.json',p=>{p.preparationRestart.historicalVersion2.completedReview.sha256=hash(fs.readFileSync(file(f,path)));p.preparationRestart.integrationCheckpoint.sha256=hash(fs.readFileSync(file(f,'evidence/schema3-integration.json')));});rewriteSchema3(f,()=>{},{rebind:true});}fail(componentDevelopmentRead(f),/restart historical/);});
 await t.test('schema3 diagnostics remain separate from review evidence',()=>{reset();const before=componentPreserved(f),r=componentWrite(f);assert.equal(r.status,0,r.stderr);const d=JSON.parse(r.stdout);assert.equal(d.kind,'ISOLATED_COMPONENT_REGRESSION_DIAGNOSTIC');assert.equal(d.tap.tests,7);assert.deepEqual(componentPreserved(f),before);assert.equal(fs.existsSync(file(f,'evidence/enterprise/component-development/'+f.run.slug+'/review-evidence')),false);});
});

// Synthetic record graphs exercise the reader, never execution or approval.
function componentGraphFixture(f,statuses=['FAILED','PASSED']){
 const purpose='Q_COMPONENT_IMPLEMENTATION_REVIEW',base=`evidence/enterprise/component-development/${f.run.slug}/review-evidence`,identity={runSlug:f.run.slug,workflowRef:'synthetic-workflow',bundleDigest:'b'.repeat(64),builderIteration:7,builderSessionId:'builder-session'},events=[];
 const ref=path=>{const b=fs.readFileSync(file(f,path));return {path,sha256:hash(b),bytes:b.length};};
 const save=(path,v)=>{put(file(f,path),typeof v==='string'?v:JSON.stringify(v,null,2)+'\n');return ref(path);};
 const head=(previousHead,sequence,start,terminal)=>hash(JSON.stringify({previousHead,sequence,start,terminal}));
 let previousHead='0'.repeat(64),last;
 for(const [offset,status]of statuses.entries()){
  const sequence=offset+1,dir=base+'/invocations/'+sequence,output=dir+'/outputs/';
  const scope=save(dir+'/scope.json',{synthetic:true}),designReport=save(dir+'/design.md','synthetic design'),plan=save(dir+'/plan.json',{synthetic:true}),inputsBefore=save(dir+'/inputs-before.json',{synthetic:true}),inputsAfter=save(dir+'/inputs-after.json',{synthetic:true});
  const inputsDigest='a'.repeat(64),command=['synthetic-test-only'];
  const start=save(dir+'/start.json',{schemaVersion:1,purpose,identity,sequence,priorHistoryHead:previousHead,scope,designReport,plan,inputsBefore,command});events.push({sequence,status:'STARTED',start,priorHead:previousHead});
  const execution=save(output+'execution.json',{status:status==='PASSED'?0:1,synthetic:true}),stdout=save(output+'stdout.tap','synthetic output\n'),stderr=save(output+'stderr.log',status==='FAILED'?'original failure\n':'');
  const diagnostic=status==='FAILED'?save(output+'failure.json',{message:'original failure',synthetic:true}):null;
  const entries=[execution,stdout,stderr,...(diagnostic?[diagnostic]:[])].sort((a,b)=>a.path.localeCompare(b.path,'en'));
  const outputInventory=save(dir+'/output-inventory.json',{schemaVersion:1,purpose,entries,digest:hash(JSON.stringify(entries))});
  const receipt=status==='PASSED'?save(dir+'/receipt.json',{schemaVersion:1,kind:'Q_COMPONENT_EVIDENCE',purpose,identity,scope,designReport,plan,inputsBefore,inputsAfter,inputsDigest,command,execution,stdout,stderr,outputInventory,outputsDigest:hash(JSON.stringify(entries)),priorHistoryHead:previousHead,start,result:'PASSED',productVerified:false,nativeAccepted:false}):null;
  const terminal=save(dir+'/terminal.json',{schemaVersion:1,purpose,sequence,start,previousHead,status,receipt,diagnostic,outputInventory});
  const next=head(previousHead,sequence,start,terminal);events.push({sequence,status,start,terminal,head:next});previousHead=next;
  last={sequence,dir,start,terminal,receipt,scope,designReport,identity,inputsDigest};
 }
 save(base+'/journal.json',{schemaVersion:1,purpose,events});
 const journalPrefix=save(last.dir+'/journal-prefix.json',{schemaVersion:1,purpose,events});
 save(base+'/request.json',{schemaVersion:1,purpose,identity,scope:last.scope,designReport:last.designReport,receipt:last.receipt,inputsDigest:last.inputsDigest,historyBinding:{journalPrefix,head:previousHead,sequence:2,start:last.start,terminal:last.terminal},productVerified:false});
 return {base,purpose,identity,ref,save,head,last};
}
function componentGraphRead(f,imports=[]){
 const code="import fs from 'node:fs';import assert from 'node:assert/strict';import {resolve,relative} from 'node:path';import {hash,confined} from './scripts/enterprise/evidence.mjs';const s=fs.readFileSync('scripts/enterprise/runtime-preparation.mjs','utf8');const p=s.slice(s.indexOf('function strictPreparationJSON('),s.indexOf('const prepRead='));const body=s.slice(s.indexOf('// Q component immutable record graph.'),s.indexOf('// Fixed, reviewed portable regression operation.'));assert.ok(body.includes('function readComponentEvidenceGraph('),'component graph reader missing');const fn=new Function('assert','readFileSync','existsSync','readdirSync','lstatSync','relative','resolve','confined','hash',p+body+';return readComponentEvidenceGraph;')(assert,fs.readFileSync,fs.existsSync,fs.readdirSync,fs.lstatSync,relative,resolve,confined,hash);console.log(JSON.stringify(fn(process.cwd(),"+JSON.stringify(f.run.slug)+")));";
 const before=tree(f.temporary),r=spawnSync(process.execPath,['--import',f.guardPath,...imports.flatMap(p=>['--import',p]),'--input-type=module','-e',code],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000});assert.deepEqual(tree(f.temporary),before);assert.doesNotMatch(r.stderr,/FS_MUTATION/);return r;
}
test('component-development-record-graph-boundary',async t=>{
 const f=await componentReviewAuthorityFixture(t),g=componentGraphFixture(f),reset=restorePoint(f),p=n=>g.base+'/'+n;
 const reject=()=>{const r=componentGraphRead(f);assert.doesNotMatch(r.stderr,/reader missing/);fail(r,/component graph|preparation field|symlink|path escape|ENOENT/);};
 await t.test('complete latest graph retains failed artifacts without authority',()=>{const r=componentGraphRead(f);assert.equal(r.status,0,r.stderr);const d=JSON.parse(r.stdout);assert.equal(d.sequence,2);assert.equal(d.kind,'Q_COMPONENT_RECORD_GRAPH');assert.equal(d.reviewReady,false);assert.equal(d.productVerified,false);assert.equal(d.nativeAccepted,false);assert.ok(d.references.some(x=>x.path.endsWith('/1/outputs/failure.json')));});
 for(const path of ['invocations/1/outputs/stderr.log','invocations/1/outputs/failure.json','invocations/1/start.json','invocations/2/outputs/stdout.tap','invocations/2/inputs-after.json','invocations/2/scope.json','invocations/2/journal-prefix.json'])await t.test('changed immutable graph bytes refuse '+path,()=>{reset();fs.appendFileSync(file(f,p(path)),' ');reject();});
 for(const name of ['writer.lock','intent.json'])await t.test('live or torn '+name+' refuses',()=>{reset();put(file(f,p(name)),'{');reject();});
 for(const [name,edit]of [['unknown schema',j=>j.schemaVersion=2],['unknown field',j=>j.force=true],['wrong purpose',j=>j.purpose='PRODUCT'],['sequence gap',j=>j.events[2].sequence=3],['branch',j=>j.events[2].priorHead='f'.repeat(64)],['duplicate terminal',j=>j.events.push(j.events[3])],['missing terminal',j=>j.events.pop()],['wrong terminal head',j=>j.events[3].head='e'.repeat(64)],['wrong start link',j=>j.events[3].start=j.events[0].start]])await t.test('journal refuses '+name,()=>{reset();mutate(f,p('journal.json'),edit);reject();});
 for(const [name,edit]of [['wrong run',r=>r.identity.runSlug='other'],['stale request',r=>r.historyBinding.sequence=1],['product authority',r=>r.productVerified=true],['extra authority',r=>r.captureAuthority=true],['path escape',r=>r.receipt.path='../receipt.json'],['foreign namespace',r=>r.receipt.path='evidence/foreign.json'],['wrong byte length',r=>r.receipt.bytes++],['unknown ref field',r=>r.receipt.force=true]])await t.test('request refuses '+name,()=>{reset();mutate(f,p('request.json'),edit);reject();});
 await t.test('duplicate JSON fields refuse',()=>{reset();const path=file(f,p('request.json')),raw=fs.readFileSync(path,'utf8');put(path,raw.replace('"schemaVersion": 1','"schemaVersion": 1, "schemaVersion": 1'));reject();});
 await t.test('symlink output refuses even with matching bytes',()=>{reset();const path=file(f,p('invocations/2/outputs/stdout.tap'));fs.renameSync(path,path+'.original');fs.symlinkSync(path+'.original',path);try{reject();}finally{fs.unlinkSync(path);fs.renameSync(path+'.original',path);}});
 await t.test('unexplained later invocation refuses',()=>{reset();put(file(f,p('invocations/3/start.json')),'{}');reject();});
 await t.test('unlisted output refuses',()=>{reset();put(file(f,p('invocations/2/outputs/unlisted.log')),'partial');reject();});
 await t.test('record changed during final recheck refuses',()=>{reset();const target=file(f,p('invocations/1/outputs/stderr.log')),hook=componentHook(f,'graph-change',"import fs from 'node:fs';import {syncBuiltinESMExports}from'node:module';const read=fs.readFileSync;let n=0;fs.readFileSync=function(p,...a){const b=read(p,...a);return String(p)==="+JSON.stringify(target)+"&&++n>=2?Buffer.from('X'+Buffer.from(b).toString().slice(1)):b;};syncBuiltinESMExports();");fail(componentGraphRead(f,[hook]),/component graph changed/);});
 // Recompute graph references after semantic mutations, so hash mismatch is
 // not a substitute for receipt/terminal validation.
 const rebind=()=>{
  const j=read(file(f,p('journal.json')));let previousHead='0'.repeat(64);
  for(let i=0;i<j.events.length;i+=2){const begin=j.events[i],end=j.events[i+1],dir=p('invocations/'+begin.sequence);let start=read(file(f,dir+'/start.json'));start.priorHistoryHead=previousHead;begin.start=g.save(dir+'/start.json',start);begin.priorHead=previousHead;
   const terminal=read(file(f,dir+'/terminal.json')),inv=read(file(f,dir+'/output-inventory.json'));inv.entries=inv.entries.map(r=>g.ref(r.path));inv.digest=hash(JSON.stringify(inv.entries));terminal.outputInventory=g.save(dir+'/output-inventory.json',inv);
   if(terminal.receipt){const r=read(file(f,terminal.receipt.path));for(const key of ['execution','stdout','stderr','inputsAfter'])r[key]=g.ref(r[key].path);r.start=begin.start;r.priorHistoryHead=previousHead;r.outputInventory=terminal.outputInventory;r.outputsDigest=inv.digest;terminal.receipt=g.save(terminal.receipt.path,r);}
   if(terminal.diagnostic)terminal.diagnostic=g.ref(terminal.diagnostic.path);terminal.start=begin.start;terminal.previousHead=previousHead;end.start=begin.start;end.status=terminal.status;end.terminal=g.save(dir+'/terminal.json',terminal);end.head=g.head(previousHead,begin.sequence,begin.start,end.terminal);previousHead=end.head;
  }
  g.save(p('journal.json'),j);const r=read(file(f,p('request.json'))),last=j.events.at(-1);r.receipt=read(file(f,last.terminal.path)).receipt;r.historyBinding={journalPrefix:g.save(p('invocations/2/journal-prefix.json'),j),head:previousHead,sequence:last.sequence,start:last.start,terminal:last.terminal};g.save(p('request.json'),r);
 };
 for(const [name,edit]of [['product authority',r=>r.productVerified=true],['native authority',r=>r.nativeAccepted=true],['extra field',r=>r.acceptedComponents=['Q-I1a']],['identity mismatch',r=>r.identity.builderSessionId='other'],['command mismatch',r=>r.command=['other']],['foreign scope',r=>r.scope=g.ref(p('invocations/1/scope.json'))],['unknown kind',r=>r.kind='ISOLATED_COMPONENT_REGRESSION_DIAGNOSTIC']])await t.test('rehashed receipt refuses '+name,()=>{reset();mutate(f,p('invocations/2/receipt.json'),edit);rebind();reject();});
 await t.test('latest FAILED cannot fall back to an earlier success',()=>{reset();fs.rmSync(file(f,g.base),{recursive:true});componentGraphFixture(f,['PASSED','FAILED']);fail(componentGraphRead(f),/component graph latest FAILED/);});
 await t.test('failed terminal cannot omit its diagnostic',()=>{reset();mutate(f,p('invocations/1/terminal.json'),r=>r.diagnostic=null);rebind();fail(componentGraphRead(f),/component graph failed diagnostic missing/);});
 await t.test('failed terminal cannot claim a receipt',()=>{reset();mutate(f,p('invocations/1/terminal.json'),r=>r.receipt=g.ref(p('invocations/2/receipt.json')));const j=read(file(f,p('journal.json')));j.events[1].terminal=g.ref(p('invocations/1/terminal.json'));g.save(p('journal.json'),j);fail(componentGraphRead(f),/component graph failed receipt/);});
 await t.test('rehashed duplicate inventory entries refuse',()=>{reset();mutate(f,p('invocations/1/output-inventory.json'),r=>r.entries.push(r.entries[0]));rebind();fail(componentGraphRead(f),/component graph duplicate output/);});
 await t.test('rehashed inventory outside output namespace refuses',()=>{reset();mutate(f,p('invocations/1/output-inventory.json'),r=>{r.entries=[g.ref(p('invocations/1/scope.json'))];});rebind();fail(componentGraphRead(f),/component graph output namespace/);});
 await t.test('unexplained output appearing during read refuses',()=>{reset();const target=file(f,p('invocations/2/outputs')),hook=componentHook(f,'graph-list-change',"import fs from 'node:fs';import {syncBuiltinESMExports}from'node:module';const list=fs.readdirSync;let n=0;fs.readdirSync=function(p,...a){const b=list(p,...a);return String(p)==="+JSON.stringify(target)+"&&++n>=2?[...b,'late.log']:b;};syncBuiltinESMExports();");fail(componentGraphRead(f,[hook]),/component graph changed directory/);});

});


// Execution records here are synthetic metadata, not proof of a real invocation.
function componentExecutionFixture(f){
 const g=componentGraphFixture(f),dir=g.last.dir,command=['mise','exec','--','node','--test','--test-reporter=tap','tests/enterprise/evidence.test.mjs','tests/enterprise/ENT-101.test.mjs','tests/enterprise/finalization.test.mjs','tests/enterprise/continuation.test.mjs','tests/enterprise/continuation-v4.test.mjs','tests/enterprise/rejected-regeneration.test.mjs','tests/enterprise/closure-review.test.mjs'];
 const manifest=inputs(f.root);g.save(dir+'/plan.json',fs.readFileSync(file(f,'work/enterprise/plan.json'),'utf8'));g.save(dir+'/inputs-before.json',manifest);g.save(dir+'/inputs-after.json',manifest);
 g.save(dir+'/outputs/stdout.tap','TAP version 13\n# Subtest: synthetic case\nok 1 - synthetic case\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n');
 g.save(dir+'/outputs/execution.json',{schemaVersion:1,invocation:'invocation-00000000-0000-4000-8000-000000000000',startedAt:'2026-01-01T00:00:00.000Z',finishedAt:'2026-01-01T00:00:01.000Z',status:0,signal:null,error:null,interrupted:null,requestedArgv:command,actualArgv:[process.execPath,...command.slice(4)],inputsDigest:manifest.digest,outputs:[g.ref(dir+'/outputs/stdout.tap'),g.ref(dir+'/outputs/stderr.log')]});
 mutate(f,dir+'/start.json',s=>{s.plan=g.ref(dir+'/plan.json');s.inputsBefore=g.ref(dir+'/inputs-before.json');s.command=command;});
 mutate(f,dir+'/receipt.json',r=>{r.plan=g.ref(dir+'/plan.json');r.inputsBefore=g.ref(dir+'/inputs-before.json');r.inputsDigest=manifest.digest;r.command=command;});
 mutate(f,g.base+'/request.json',r=>r.inputsDigest=manifest.digest);
 const rebind=()=>{
  const j=read(file(f,g.base+'/journal.json'));let previousHead='0'.repeat(64);
  for(let i=0;i<j.events.length;i+=2){const begin=j.events[i],end=j.events[i+1],d=g.base+'/invocations/'+begin.sequence,start=read(file(f,d+'/start.json'));start.priorHistoryHead=previousHead;for(const k of ['plan','inputsBefore'])start[k]=g.ref(start[k].path);begin.start=g.save(d+'/start.json',start);begin.priorHead=previousHead;
   const terminal=read(file(f,d+'/terminal.json')),inv=read(file(f,d+'/output-inventory.json'));inv.entries=inv.entries.map(r=>g.ref(r.path));inv.digest=hash(JSON.stringify(inv.entries));terminal.outputInventory=g.save(d+'/output-inventory.json',inv);
   if(terminal.receipt){const r=read(file(f,terminal.receipt.path));for(const k of ['plan','inputsBefore','inputsAfter','execution','stdout','stderr'])r[k]=g.ref(r[k].path);r.start=begin.start;r.priorHistoryHead=previousHead;r.outputInventory=terminal.outputInventory;r.outputsDigest=inv.digest;terminal.receipt=g.save(terminal.receipt.path,r);}
   if(terminal.diagnostic)terminal.diagnostic=g.ref(terminal.diagnostic.path);terminal.start=begin.start;terminal.previousHead=previousHead;end.start=begin.start;end.terminal=g.save(d+'/terminal.json',terminal);end.head=g.head(previousHead,begin.sequence,begin.start,end.terminal);previousHead=end.head;
  }
  g.save(g.base+'/journal.json',j);const r=read(file(f,g.base+'/request.json')),last=j.events.at(-1);r.receipt=read(file(f,last.terminal.path)).receipt;r.historyBinding={journalPrefix:g.save(dir+'/journal-prefix.json',j),head:previousHead,sequence:last.sequence,start:last.start,terminal:last.terminal};g.save(g.base+'/request.json',r);
 };
 rebind();return {...g,dir,command,manifest,rebind};
}
function componentExecutionRead(f,imports=[]){
 const code="import fs from 'node:fs';import assert from 'node:assert/strict';import {resolve,relative}from'node:path';import {hash,confined,inputs,parseTap}from'./scripts/enterprise/evidence.mjs';const s=fs.readFileSync('scripts/enterprise/runtime-preparation.mjs','utf8'),p=s.slice(s.indexOf('function strictPreparationJSON('),s.indexOf('const prepRead=')),body=s.slice(s.indexOf('// Q component immutable record graph.'),s.indexOf('async function testComponentDevelopment('));assert.ok(body.includes('function readComponentEvidenceExecution('),'component execution reader missing');const fn=new Function('assert','readFileSync','existsSync','readdirSync','lstatSync','relative','resolve','confined','hash','inputs','parseTap',p+body+';return readComponentEvidenceExecution;')(assert,fs.readFileSync,fs.existsSync,fs.readdirSync,fs.lstatSync,relative,resolve,confined,hash,inputs,parseTap);console.log(JSON.stringify(fn(process.cwd(),"+JSON.stringify(f.run.slug)+")));";
 const before=tree(f.temporary),r=spawnSync(process.execPath,['--import',f.guardPath,...imports.flatMap(p=>['--import',p]),'--input-type=module','-e',code],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000});assert.deepEqual(tree(f.temporary),before);assert.doesNotMatch(r.stderr,/FS_MUTATION/);return r;
}
test('component-development-execution-consistency-boundary',async t=>{
 const f=await componentReviewAuthorityFixture(t),g=componentExecutionFixture(f),reset=restorePoint(f),ep=g.dir+'/outputs/execution.json',tap=g.dir+'/outputs/stdout.tap';
 const reject=(pattern=/component execution/)=>{g.rebind();const r=componentExecutionRead(f);assert.doesNotMatch(r.stderr,/reader missing/);fail(r,pattern);};
 await t.test('consistent metadata remains unapproved and unauthenticated',()=>{const r=componentExecutionRead(f);assert.equal(r.status,0,r.stderr);const d=JSON.parse(r.stdout);assert.equal(d.kind,'Q_COMPONENT_EXECUTION_CONSISTENCY');assert.equal(d.tap.tests,1);assert.equal(d.reviewReady,false);assert.equal(d.productVerified,false);assert.equal(d.nativeAccepted,false);assert.equal(d.provenanceAuthenticated,false);});
 for(const [name,edit]of [['nonzero exit',e=>e.status=1],['signal',e=>e.signal='SIGTERM'],['spawn error',e=>e.error='EIO'],['interruption',e=>e.interrupted='SIGINT'],['unknown field',e=>e.approved=true],['schema',e=>e.schemaVersion=2],['invocation format',e=>e.invocation='receipt'],['invalid time',e=>e.startedAt='yesterday'],['reversed time',e=>e.finishedAt='2025-01-01T00:00:00.000Z'],['requested filter',e=>e.requestedArgv.push('--test-name-pattern=pass')],['actual filter',e=>e.actualArgv.push('--test-name-pattern=pass')],['foreign node',e=>e.actualArgv[0]='/other/node'],['input digest',e=>e.inputsDigest='b'.repeat(64)],['output omission',e=>e.outputs.pop()],['output duplicate',e=>e.outputs.push(e.outputs[0])],['output hash',e=>e.outputs[0].sha256='c'.repeat(64)]])await t.test('rehashed execution refuses '+name,()=>{reset();mutate(f,ep,edit);reject();});
 for(const name of ['inputs-before.json','inputs-after.json'])await t.test('rehashed stale manifest refuses '+name,()=>{reset();mutate(f,g.dir+'/'+name,m=>m.digest='d'.repeat(64));reject();});
 await t.test('current source edits invalidate saved inputs',()=>{reset();fs.appendFileSync(file(f,'scripts/enterprise/verify.mjs'),'\n// later edit\n');reject();});
 await t.test('rehashed saved plan change refuses',()=>{reset();mutate(f,g.dir+'/plan.json',p=>p.extra=true);reject();});
 const updateTap=s=>{g.save(tap,s);mutate(f,ep,e=>e.outputs[0]=g.ref(tap));};
 for(const [name,edit]of [['empty',s=>''],['failed case',s=>s.replace('ok 1 -','not ok 1 -')],['skip',s=>s.replace('ok 1 - synthetic case','ok 1 - synthetic case # SKIP')],['todo',s=>s.replace('ok 1 - synthetic case','ok 1 - synthetic case # TODO')],['bail out',s=>s+'Bail out! failure\n'],['duplicate summary',s=>s+'# tests 1\n'],['missing summary',s=>s.replace('# cancelled 0\n','')],['extra assertion',s=>s.replace('1..1','ok 2 - hidden\n1..1')],['pass mismatch',s=>s.replace('# pass 1','# pass 2')]])await t.test('rehashed TAP refuses '+name,()=>{reset();updateTap(edit(fs.readFileSync(file(f,tap),'utf8')));reject(/component execution|TAP/);});
 await t.test('second graph read detects output change',()=>{reset();const target=file(f,tap),hook=componentHook(f,'execution-read-change',"import fs from 'node:fs';import {syncBuiltinESMExports}from'node:module';const read=fs.readFileSync;let n=0;fs.readFileSync=function(p,...a){const b=read(p,...a);return String(p)==="+JSON.stringify(target)+"&&++n>=6?Buffer.from('X'+Buffer.from(b).toString().slice(1)):b;};syncBuiltinESMExports();");const r=componentExecutionRead(f,[hook]);assert.doesNotMatch(r.stderr,/reader missing/);fail(r,/component graph reference hash mismatch/);});
});
import {inputs} from '../../scripts/enterprise/evidence.mjs';

// The graph is synthetic. TAP is produced by an actual isolated Node test
// subprocess, then mutated and rehashed to exercise structural validation.
test('component-development-tap-hierarchy-boundary',async t=>{
 const f=await componentReviewAuthorityFixture(t),g=componentExecutionFixture(f),ep=g.dir+'/outputs/execution.json',tap=g.dir+'/outputs/stdout.tap';
 const fixture=join(f.temporary,'tap-structure-fixture.mjs');put(fixture,"import test from 'node:test';test('parent',async t=>{await t.test('duplicate',()=>{});await t.test('nested',async t=>{await t.test('leaf',()=>{});});await t.test('duplicate',()=>{});});test('sibling',()=>{});\n");
 const actual=spawnSync(process.execPath,['--test','--test-reporter=tap',fixture],{env:f.env,encoding:'utf8',timeout:20000});assert.equal(actual.status,0,actual.stderr);
 const update=s=>{g.save(tap,s);mutate(f,ep,e=>e.outputs[0]=g.ref(tap));g.rebind();};update(actual.stdout);const reset=restorePoint(f);
 await t.test('real Node nested TAP retains repeated names and no authority',()=>{const r=componentExecutionRead(f);assert.equal(r.status,0,r.stderr);const d=JSON.parse(r.stdout);assert.equal(d.tap.tests,6);assert.equal(d.reviewReady,false);assert.equal(d.provenanceAuthenticated,false);assert.equal(d.productVerified,false);assert.equal(d.nativeAccepted,false);assert.equal(d.tapStructure.nodes.length,6);assert.equal(d.tapStructure.nodes.filter(x=>x.name==='duplicate').length,2);assert.deepEqual(d.tapStructure.nodes.find(x=>x.name==='leaf').path,[1,2,1]);});
 const changes=[
 ['missing version',s=>s.replace('TAP version 13\n','')],
 ['duplicate version',s=>s.replace('TAP version 13\n','TAP version 13\nTAP version 13\n')],
 ['missing root plan',s=>s.replace(/^1\.\.2\n/m,'')],
 ['wrong root plan',s=>s.replace(/^1\.\.2$/m,'1..3')],
 ['duplicate root plan',s=>s.replace(/^1\.\.2$/m,'1..2\n1..2')],
 ['missing child plan',s=>s.replace(/^    1\.\.3\n/m,'')],
 ['wrong child plan',s=>s.replace(/^    1\.\.3$/m,'    1..4')],
 ['missing nested plan',s=>s.replace(/^        1\.\.1\n/m,'')],
 ['duplicate nested plan',s=>s.replace(/^        1\.\.1$/m,'        1..1\n        1..1')],
 ['zero nested plan',s=>s.replace(/^        1\.\.1$/m,'        1..0')],
 ['duplicate ordinal',s=>s.replace('ok 3 - duplicate','ok 1 - duplicate')],
 ['gap ordinal',s=>s.replace('ok 3 - duplicate','ok 4 - duplicate')],
 ['noncanonical ordinal',s=>s.replace('ok 3 - duplicate','ok 03 - duplicate')],
 ['foreign header name',s=>s.replace('# Subtest: leaf','# Subtest: other')],
 ['foreign result name',s=>s.replace('ok 1 - leaf','ok 1 - other')],
 ['missing header',s=>s.replace(/^        # Subtest: leaf\n/m,'')],
 ['wrong header depth',s=>s.replace('        # Subtest: leaf','    # Subtest: leaf')],
 ['wrong result depth',s=>s.replace('        ok 1 - leaf','    ok 1 - leaf')],
 ['unclosed header',s=>s+'# Subtest: unfinished\n'],
 ['non-comment output',s=>s.replace('TAP version 13\n','TAP version 13\nUNEXPECTED\n')],
 ['unfinished diagnostics',s=>s.replace(/^          \.\.\.\n/m,'')],
 ['diagnostic indentation',s=>s.replace('          duration_ms:','        duration_ms:')],
 ['nested summary',s=>s.replace('    1..3','    # tests 4\n    1..3')],
 ['unsafe plan number',s=>s.replace(/^1\.\.2$/m,'1..9007199254740993')],
 ['summary before plan',s=>s.replace(/^1\.\.2\n/m,'').replace('# tests 6','1..2\n# tests 6').replace(/^# Subtest: parent/m,'# pass 6\n# Subtest: parent').replace(/^# pass 6\n(?!# Subtest)/m,'')],
 ];
 for(const [name,edit]of changes)await t.test('rehashed TAP hierarchy rejects '+name,()=>{reset();const changed=edit(actual.stdout);assert.notEqual(changed,actual.stdout,'mutation must be applied');update(changed);const r=componentExecutionRead(f);assert.doesNotMatch(r.stderr,/reader missing/);fail(r,/component TAP structure/);});
});

// A second schema3 approval retains the first approval and its own snapshots.
async function componentReapprovalFixture(t){
 const f=await componentReviewAuthorityFixture(t),ref=path=>({path,sha256:hash(fs.readFileSync(file(f,path)))}),r3=path=>({...ref(path),bytes:fs.statSync(file(f,path)).size}),old=structuredClone(f.restartAttestation);
 put(file(f,'evidence/schema3-review.md'),fs.readFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'),'utf8'));
 const entry=read(file(f,'evidence/schema3-entry.json'));
 const paths=[...old.permittedPaths,'work/enterprise/plan.json',old.contractPath,'work/enterprise/PREPARATION_DESCRIPTOR.md','work/enterprise/PREPARATION_COMPONENT_REVIEW.md'];
 entry.entries=entry.entries.filter(e=>!paths.includes(e.path));for(const path of paths){const copy='evidence/reapproval-entry/'+path;put(file(f,copy),fs.readFileSync(file(f,path),'utf8'));entry.entries.push({...r3(path),copy});}put(file(f,'evidence/reapproval-entry.json'),entry);
 const checkpoint=read(file(f,'evidence/schema3-integration.json'));checkpoint.iteration=7;for(const k of ['previousReviewOriginalPath','historicalDesignApprovalOnly','nativeAccepted','captureAuthority','recoveryAuthority','completeH'])delete checkpoint[k];checkpoint.references=entry.entries.filter(e=>old.permittedPaths.includes(e.path)).map(e=>({path:e.copy,sha256:e.sha256,bytes:e.bytes,sourcePath:e.path}));checkpoint.references.push(...['work/enterprise/PREPARATION_PRODUCER_CONTAINMENT.md','work/enterprise/PREPARATION_CAPTURE_RECOVERY.md','evidence/reassessment.json','evidence/validation.json','evidence/schema3-review.md','evidence/reapproval-entry.json'].map(r3));put(file(f,'evidence/reapproval-checkpoint.json'),checkpoint);
 put(file(f,old.contractPath),'synthetic reapproved schema3 contract');put(file(f,'work/enterprise/PREPARATION_COMPONENT_REVIEW.md'),'synthetic revised component contract');
 mutate(f,'work/enterprise/plan.json',p=>{const e=p.preparationRestart;e.entrySnapshot='evidence/reapproval-entry.json';e.previousIntegrationCheckpoint=e.integrationCheckpoint;e.integrationCheckpoint=ref('evidence/reapproval-checkpoint.json');e.componentReview.contract=r3('work/enterprise/PREPARATION_COMPONENT_REVIEW.md');e.integrationDelivery={historicalReview:r3('evidence/schema3-review.md')};});
 const m=ok(spawnSync(process.execPath,['--input-type=module','-e',"import {inputs} from './scripts/enterprise/evidence.mjs';console.log(JSON.stringify(inputs(process.cwd())));"],{cwd:f.root,env:f.env,encoding:'utf8'}));put(file(f,'evidence/reapproval-inputs.json'),m);
 f.reapproval={...old,iteration:8,contractSha256:ref(old.contractPath).sha256,planSha256:ref('work/enterprise/plan.json').sha256,reviewInputsDigest:m.digest,reviewInputsManifest:ref('evidence/reapproval-inputs.json'),entryManifest:ref('evidence/reapproval-entry.json')};phases(f,'review-architecture',8,fenced('enterprise-preparation-restart-attestation',f.reapproval));f.context('build-foundation',9);return f;
}
function rewriteReapproval(f,edit=()=>{}){
 const a=structuredClone(f.reapproval),ref=path=>({path,sha256:hash(fs.readFileSync(file(f,path)))});
 const m=ok(spawnSync(process.execPath,['--input-type=module','-e',"import {inputs} from './scripts/enterprise/evidence.mjs';console.log(JSON.stringify(inputs(process.cwd())));"],{cwd:f.root,env:f.env,encoding:'utf8'}));put(file(f,'evidence/reapproval-inputs.json'),m);Object.assign(a,{planSha256:ref('work/enterprise/plan.json').sha256,reviewInputsDigest:m.digest,reviewInputsManifest:ref('evidence/reapproval-inputs.json')});edit(a);
 const text=fenced('enterprise-preparation-restart-attestation',a);for(const r of f.records.filter(r=>r.type==='phase_complete'&&r.iteration===8))r.content=text;f.append({type:'boundary'});put(join(f.run.reportsAbs,'enterprise-02-review.md'),text+'\n');
}
test('component-development-schema3-reapproval-boundary',async t=>{
 const f=await componentReapprovalFixture(t),reset=restorePoint(f),ref=path=>({path,sha256:hash(fs.readFileSync(file(f,path))),bytes:fs.statSync(file(f,path)).size});
 await t.test('reapproval authenticates original schema3 and schema2 schema1 without promotion',()=>{const r=componentDevelopmentRead(f);assert.equal(r.status,0,r.stderr);const v=JSON.parse(r.stdout);assert.equal(v.iteration,9);assert.equal(v.ordinaryBatchAuthority,false);assert.equal(v.nativeAcceptance,false);assert.deepEqual(v.currentApprovals,[]);});
 await t.test('reapproval permits reviewed source edit while retaining old approved bytes',()=>{reset();fs.appendFileSync(file(f,'scripts/enterprise/verify.mjs'),'\n// allowed\n');const r=componentDevelopmentRead(f);assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout).changedPaths,['scripts/enterprise/verify.mjs']);});
 for(const kind of ['unfinished','phase','model','effort','order','duplicate-field','mixed-kind'])await t.test('reapproval rejects prior schema3 '+kind,()=>{reset();if(kind==='unfinished')f.records.find(r=>r.type==='step_complete'&&r.iteration===6).status='error';if(kind==='phase')f.records.find(r=>r.type==='phase_complete'&&r.iteration===6).content=f.records.find(r=>r.type==='phase_complete'&&r.iteration===6).content.replace('APPROVE','REQUEST_CHANGES');if(kind==='model')f.records.find(r=>r.type==='step_start'&&r.iteration===6).model='gpt-6.1-sol';if(kind==='effort')f.records.find(r=>r.type==='step_start'&&r.iteration===6).providerOptions.codex.reasoningEffort='low';if(kind==='order'){const start=f.records.find(r=>r.type==='step_start'&&r.iteration===6);f.records.splice(f.records.indexOf(start),1);f.records.push(start);}if(['duplicate-field','mixed-kind'].includes(kind)){let text=fs.readFileSync(file(f,'evidence/schema3-review.md'),'utf8');text=kind==='duplicate-field'?text.replace('"schemaVersion":3','"schemaVersion":3,"schemaVersion":3'):text+'\n```enterprise-batch-attestation\n{}\n```\n';put(file(f,'evidence/schema3-review.md'),text);for(const r of f.records.filter(r=>r.type==='phase_complete'&&r.iteration===6))r.content=text.trimEnd();mutate(f,'evidence/reapproval-checkpoint.json',p=>Object.assign(p.references.find(r=>r.path==='evidence/schema3-review.md'),ref('evidence/schema3-review.md')));mutate(f,'work/enterprise/plan.json',p=>{p.preparationRestart.integrationCheckpoint={path:'evidence/reapproval-checkpoint.json',sha256:ref('evidence/reapproval-checkpoint.json').sha256};p.preparationRestart.integrationDelivery.historicalReview=ref('evidence/schema3-review.md');});rewriteReapproval(f);}f.append({type:'boundary'});fail(componentDevelopmentRead(f),/reapproval|preparation|occurrence|restart historical/);});
 for(const path of ['evidence/schema3-review.md','evidence/reapproval-entry/work/enterprise/plan.json','evidence/reapproval-entry/work/enterprise/PREPARATION_COMPONENT_REVIEW.md','evidence/schema3-inputs.json','evidence/schema3-entry.json','evidence/schema3-integration.json','evidence/schema2-review.md'])await t.test('reapproval refuses changed historical bytes '+path,()=>{reset();fs.appendFileSync(file(f,path),' ');fail(componentDevelopmentRead(f),/restart changed reference|reapproval|restart historical/);});
 for(const kind of ['missing-review','wrong-length','extra-ref-field','wrong-previous-checkpoint','changed-old-proposal','missing-checkpoint-review','extra-contract-field','wrong-contract-length'])await t.test('reapproval rejects rehashed '+kind,()=>{reset();mutate(f,'work/enterprise/plan.json',p=>{const e=p.preparationRestart;if(kind==='missing-review')delete e.integrationDelivery;if(kind==='wrong-length')e.integrationDelivery.historicalReview.bytes++;if(kind==='extra-ref-field')e.integrationDelivery.historicalReview.force=true;if(kind==='wrong-previous-checkpoint')e.previousIntegrationCheckpoint={...e.sourceCheckpoint};if(kind==='changed-old-proposal')e.historicalVersion2.proposalApproved=true;if(kind==='extra-contract-field')e.componentReview.contract.force=true;if(kind==='wrong-contract-length')e.componentReview.contract.bytes++;if(kind==='missing-checkpoint-review'){mutate(f,'evidence/reapproval-checkpoint.json',c=>{const i=c.references.findIndex(r=>r.path==='evidence/schema3-review.md');c.references[i]=ref('evidence/schema2-review.md');});e.integrationCheckpoint={path:'evidence/reapproval-checkpoint.json',sha256:ref('evidence/reapproval-checkpoint.json').sha256};}});rewriteReapproval(f);fail(componentDevelopmentRead(f),/reapproval|restart historical|restart schema3|restart integration fields/);});
 for(const [name,edit,re]of [['permission',a=>a.permission='IMPLEMENTATION_AND_ISOLATED_TESTS_ONLY',/restart reapproval permission/],['paths',a=>a.permittedPaths.pop(),/restart reapproval permittedPaths/],['authority',a=>a.captureAuthority=true,/restart reapproval captureAuthority/],['session',a=>a.providerSessionId='other-reviewer',/restart reapproval reviewer session/],['unknown field',a=>a.force=true,/restart reapproval attestation fields/]])await t.test('reapproval rejects rehashed old approval '+name,()=>{reset();const raw=fs.readFileSync(file(f,'evidence/schema3-review.md'),'utf8'),a=JSON.parse(raw.match(/```enterprise-preparation-restart-attestation\n([\s\S]*?)\n```/)[1]);edit(a);put(file(f,'evidence/schema3-review.md'),fenced('enterprise-preparation-restart-attestation',a)+'\n');mutate(f,'evidence/reapproval-checkpoint.json',p=>Object.assign(p.references.find(r=>r.path==='evidence/schema3-review.md'),ref('evidence/schema3-review.md')));mutate(f,'work/enterprise/plan.json',p=>{p.preparationRestart.integrationDelivery.historicalReview=ref('evidence/schema3-review.md');p.preparationRestart.integrationCheckpoint={path:'evidence/reapproval-checkpoint.json',sha256:ref('evidence/reapproval-checkpoint.json').sha256};});rewriteReapproval(f);fail(componentDevelopmentRead(f),re);});
 for(const k of ['captureAuthority','unknown'])await t.test('reapproval refuses extra checkpoint '+k,()=>{reset();mutate(f,'evidence/reapproval-checkpoint.json',p=>p[k]=true);mutate(f,'work/enterprise/plan.json',p=>p.preparationRestart.integrationCheckpoint={path:'evidence/reapproval-checkpoint.json',sha256:ref('evidence/reapproval-checkpoint.json').sha256});rewriteReapproval(f);fail(componentDevelopmentRead(f),/restart integration fields/);});
 await t.test('reapproval rechecks old component contract after await',()=>{reset();const target=file(f,'evidence/reapproval-entry/work/enterprise/PREPARATION_COMPONENT_REVIEW.md'),hook=componentHook(f,'reapproval-await',"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const read=fs.readFileSync;let n=0;fs.readFileSync=function(p,...args){const b=read(p,...args);return String(p)==="+JSON.stringify(target)+"&&++n>=4?Buffer.concat([Buffer.from(b),Buffer.from(' ')]):b;};syncBuiltinESMExports();");fail(componentDevelopmentRead(f,['--inspect-component-development'],[hook]),/restart concurrent reference/);});
});


// Independent PDESC001 corpus. These are portable data, not authenticated intent.
test('component-development-descriptor-codec-boundary',async t=>{
 const {tmpdir}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'pdesc001-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source),js=fs.readFileSync('scripts/enterprise/runtime-preparation.mjs','utf8');
 assert.ok(js.includes('function encodeComponentDescriptor('),'PDESC001 encoder missing');
 assert.ok(raw.includes('pd_intent_decode('),'PDESC001 decoder missing');
 const body=js.slice(js.indexOf('// PDESC001 portable data codec.'),js.indexOf('// End PDESC001 portable data codec.'));
 const encode=new Function('assert','Buffer',body+';return encodeComponentDescriptor;')(assert,Buffer);
 const names=['runSlug','projectIdentity','workflowRef','workflowBundleBytes','builderOccurrence','builderSession','designReview','plan','reviewInputs','currentInputs','sourceCheckpoint','scopeDefinition','invocationId','domainGeneration','command','hostIdentity','supervisorIdentity','helperSource','helperBuild','helperBinary','policy','inputInventory','outputStore','admissionStore'];
 const record=Object.fromEntries(names.map((n,i)=>[n,Buffer.alloc(32,i+1)]));
 Object.assign(record,{runSlug:'fixture-q',workflowRef:'project:sha256:fixture',builderSession:'fixture-builder',invocationId:'invocation-fixture-1',command:{executable:Buffer.alloc(32,51),argv:['helper','café','日本語'],env:[['LANG','C'],['TZ','']],cwd:'/sandbox'},policy:{digest:Buffer.alloc(32,52),limits:[1n,9007199254740993n,18446744073709551615n,32n,4096n]}});
 // Independent wire oracle uses literal widths/hex, not the implementation's codec.
 const u16=n=>Buffer.from(n.toString(16).padStart(4,'0'),'hex'),u32=n=>Buffer.from(n.toString(16).padStart(8,'0'),'hex'),lp=b=>Buffer.concat([u32(b.length),b]),vector=xs=>Buffer.concat([u16(xs.length),...xs.map(lp)]);
 const command=r=>Buffer.concat([r.executable,lp(vector(r.argv.map(x=>Buffer.from(x)))),lp(vector(r.env.map(([k,v])=>Buffer.concat([lp(Buffer.from(k)),lp(Buffer.from(v))])))),lp(Buffer.from(r.cwd))]);
 const policy=r=>Buffer.concat([r.digest,...r.limits.map(x=>Buffer.from(x.toString(16).padStart(16,'0'),'hex'))]);
 const fields=names.map((n,i)=>({tag:i+1,b:n==='command'?command(record[n]):n==='policy'?policy(record[n]):Buffer.isBuffer(record[n])?record[n]:Buffer.from(record[n])}));
 const wire=fs=>{const body=Buffer.concat(fs.map(({tag,b})=>Buffer.concat([u16(tag),u32(b.length),b])));return Buffer.concat([Buffer.from('PDESC001'),u32(body.length+16),Buffer.from('00180000','hex'),body]);};
 const fixed=wire(fields);assert.equal(hash(fixed),'ca4b1d6a51ada4f89076974165f0eaddb8ed0a172d3d7677407ffe1e4c7f2b2a');
 const compiler=process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc',compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 const harness=String.raw`
#include <stdlib.h>
#define main helper_main
#include "${source}"
#undef main
int main(int argc,char **argv){
 if(argc!=3)return 90;
 FILE *f=fopen(argv[1],"rb");if(!f)return 91;
 unsigned char b[65537];size_t n=fread(b,1,sizeof(b),f);if(ferror(f)||fclose(f))return 92;
 struct pd_intent d;memset(&d,0x7a,sizeof(d));struct pd_intent prior=d;
 int r=pd_intent_decode(b,n,&d),e=r?errno:0;
 if(r){if(memcmp(&d,&prior,sizeof(d)))return 93;printf("{\"decoded\":false,\"error\":%d}\n",e);return 0;}
 if(strcmp(argv[2],"decode")){
  int dir=open(argv[2],O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(dir<0)return 94;
  struct pd_descriptor_pin pin=PD_DESCRIPTOR_INITIALIZER;
  if(pd_descriptor_create(dir,b,n,&pin)<0)return 95;
  struct pd_setup_owner owner=PD_SETUP_OWNER_INITIALIZER;
  int denied=pd_setup_owner_begin_descriptor(dir,&pin,&owner),reason=errno;
  struct pd_descriptor_publication result;
  int published=pd_setup_owner_publish_descriptor(&owner,&pin,&result),publish_reason=errno;
  if(pd_descriptor_release(&pin)<0||close(dir))return 96;
  printf("{\"decoded\":true,\"begin\":%d,\"beginError\":%d,\"publish\":%d,\"publishError\":%d,\"stage\":%d,\"attempted\":%d}\n",denied,reason,published,publish_reason,owner.stage,result.attempted);return 0;
 }
 printf("{\"decoded\":true,\"fields\":[");
 for(unsigned i=0;i<24;i++){if(i)putchar(',');putchar('"');for(size_t j=0;j<d.fields[i].n;j++)printf("%02x",d.fields[i].p[j]);putchar('"');}
 printf("],\"argc\":%u,\"envc\":%u,\"limits\":[",d.argc,d.envc);
 for(unsigned i=0;i<5;i++)printf("%s\"%llu\"",i?",":"",(unsigned long long)d.limits[i]);
 printf("]}\n");return 0;
}
`;
 const hpath=join(dir,'harness.c');fs.writeFileSync(hpath,harness);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){const s=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(s.status,0,s.stderr);const path=fs.realpathSync(s.stdout.trim());sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);}
 const binary=join(dir,'codec');argv.push(hpath,'-o',binary);const built=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(built.status,0,built.stderr);
 const evidence={component:'PDESC001_DATA_CODEC_NOT_AUTHORITY',sourceSha256:hash(raw),jsSha256:hash(js),harness,compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),fixedVector:fixed.toString('hex'),nativeAccepted:false,invocations:[]};
 let serial=0;
 const run=(b,store=false)=>{const path=join(dir,'input-'+serial++);fs.writeFileSync(path,b);let target='decode';if(store){target=join(dir,'store-'+serial);fs.mkdirSync(target,{mode:0o700});}const before=tree(dir),r=spawnSync(binary,[path,target],{env,encoding:'utf8',timeout:5000});evidence.invocations.push({sha256:hash(b),bytes:b.length,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);if(!store)assert.deepEqual(tree(dir),before);else assert.deepEqual(fs.readdirSync(target),['descriptor']);return JSON.parse(r.stdout);};
 await t.test('independent all24 vector matches JS and real C with exact u64 values',()=>{assert.deepEqual(encode(record),fixed);const d=run(encode(record));assert.equal(d.decoded,true);assert.deepEqual(d.fields,fields.map(f=>f.b.toString('hex')));assert.equal(d.argc,3);assert.equal(d.envc,2);assert.deepEqual(d.limits,record.policy.limits.map(String));assert.deepEqual(wire(d.fields.map((hex,i)=>({tag:i+1,b:Buffer.from(hex,'hex')}))),fixed);});
 const rejects=[];
 for(let i=0;i<24;i++){
  rejects.push(['missing tag '+(i+1),()=>wire(fields.filter((_,j)=>j!==i))]);
  rejects.push(['duplicate tag '+(i+1),()=>wire([...fields.slice(0,i),fields[i],...fields.slice(i)])]);
  rejects.push(['unknown tag '+(i+1),()=>wire(fields.map((f,j)=>j===i?{...f,tag:25}:f))]);
  rejects.push(['reordered tag '+(i+1),()=>{const a=[...fields],j=(i+1)%24;[a[i],a[j]]=[a[j],a[i]];return wire(a);}]);
 }
 const change=(i,b)=>wire(fields.map((f,j)=>j===i?{...f,b}:f));
 for(const [n,offset,value]of [['magic',0,0],['count',13,23],['flags',15,1],['total length',11,0]])rejects.push([n,()=>{const b=Buffer.from(fixed);b[offset]=value;return b;}]);
 for(const n of [0,1,7,15,16,17,fixed.length-1])rejects.push(['truncated '+n,()=>fixed.subarray(0,n)]);
 rejects.push(['trailing byte',()=>Buffer.concat([fixed,Buffer.from([0])])],['field length overflow',()=>{const b=Buffer.from(fixed);b.writeUInt32BE(0xffffffff,18);return b;}]);
 for(const b of [Buffer.from([0]),Buffer.from([31]),Buffer.from([127]),Buffer.from([0xc0,0xaf]),Buffer.from([0xed,0xa0,0x80]),Buffer.from([0xf4,0x90,0x80,0x80]),Buffer.from([0xe2,0x82]),Buffer.from([0x80]),Buffer.alloc(0),Buffer.alloc(257,65),Buffer.from('has space')])rejects.push(['invalid identity '+b.toString('hex'),()=>change(0,b)]);
 for(const i of [1,3,4,6,7,8,9,10,11,13,15,16,17,18,19,21,22,23])for(const size of [0,31,33])rejects.push(['hash tag '+(i+1)+' width '+size,()=>change(i,Buffer.alloc(size))]);
 for(const [n,c]of [['no argv',{...record.command,argv:[]}],['too many env',{...record.command,env:Array.from({length:65},(_,i)=>['K'+String(i).padStart(2,'0'),''])}],['too many argv',{...record.command,argv:Array(129).fill('x')}],['empty arg',{...record.command,argv:['']}],['long arg',{...record.command,argv:['x'.repeat(1025)]}],['invalid utf8',{...record.command,argv:['\u0000']}],['duplicate env',{...record.command,env:[['A','1'],['A','2']]}],['unordered env',{...record.command,env:[['Z',''],['A','']]}],['bad env name',{...record.command,env:[['a','']]}],['PATH resolution',{...record.command,env:[['PATH','/bin']]}],['LD loader',{...record.command,env:[['LD_PRELOAD','x']]}],['DYLD loader',{...record.command,env:[['DYLD_X','x']]}],['relative cwd',{...record.command,cwd:'sandbox'}],['empty component',{...record.command,cwd:'/a//b'}],['dot component',{...record.command,cwd:'/a/./b'}],['dotdot component',{...record.command,cwd:'/a/../b'}],['trailing separator',{...record.command,cwd:'/a/'}]])rejects.push([n,()=>change(14,command(c))]);
 for(let i=0;i<5;i++)rejects.push(['zero policy limit '+i,()=>{const p=policy(record.policy);p.fill(0,32+i*8,40+i*8);return change(20,p);}]);
 rejects.push(['policy short',()=>change(20,policy(record.policy).subarray(0,71))],['policy trailing',()=>change(20,Buffer.concat([policy(record.policy),Buffer.from([0])]))]);
 for(const [n,b]of [['utf8 overlong',Buffer.from('c0af','hex')],['utf8 surrogate',Buffer.from('eda080','hex')],['utf8 above max',Buffer.from('f4908080','hex')],['utf8 lone continuation',Buffer.from('80','hex')],['utf8 truncated',Buffer.from('e282','hex')]])rejects.push([n,()=>change(14,Buffer.concat([record.command.executable,lp(vector([b])),lp(vector([])),lp(Buffer.from('/'))]))]);
 rejects.push(['argv vector trailing',()=>change(14,Buffer.concat([record.command.executable,lp(Buffer.concat([vector([Buffer.from('x')]),Buffer.from([0])])),lp(vector([])),lp(Buffer.from('/'))]))]);
 for(const [name,make]of rejects)await t.test('PDESC001 rejects '+name,()=>{assert.equal(run(make()).decoded,false);});
 await t.test('PDESC001 inclusive 65536 and overflow before side effects',()=>{const r={...record,command:{...record.command,argv:Array(62).fill('a'.repeat(1024))}};const short=encode(r),remaining=65536-short.length-4;r.command.argv.push('b'.repeat(remaining));const limit=encode(r);assert.equal(limit.length,65536);assert.equal(run(limit).decoded,true);r.command.argv[r.command.argv.length-1]+='x';assert.throws(()=>encode(r),/PDESC001/);const extra=Buffer.concat([limit,Buffer.from([0])]);extra.writeUInt32BE(extra.length,8);assert.equal(run(extra).decoded,false);});
 for(const [name,edit]of [['number coercion',r=>r.policy.limits[0]=1],['zero',r=>r.policy.limits[0]=0n],['overflow',r=>r.policy.limits[0]=1n<<64n],['surrogate',r=>r.command.argv[0]='\ud800'],['extra field',r=>r.futurePid=42],['missing field',r=>delete r.plan],['bad hash',r=>r.plan=Buffer.alloc(31)],['extra command',r=>r.command.force=true],['extra policy',r=>r.policy.applied=true]])await t.test('JS PDESC001 refuses '+name,()=>{const r=structuredClone(record);for(const n of names)if(Buffer.isBuffer(record[n]))r[n]=Buffer.from(r[n]);r.command.executable=Buffer.from(r.command.executable);r.policy.digest=Buffer.from(r.policy.digest);edit(r);assert.throws(()=>encode(r),/PDESC001/);});
 await t.test('JS vector limits are checked before traversing oversized inputs',()=>{for(const field of ['argv','env']){const r={...record,command:{...record.command,[field]:Array(field==='argv'?129:65)}};Object.defineProperty(r.command[field],0,{get(){throw Error('unbounded traversal');}});assert.throws(()=>encode(r),/PDESC001 command vectors/);}});
 await t.test('PDESC001 valid text boundaries preserve UTF8 without normalization',()=>{const r={...record,runSlug:'a'.repeat(256),command:{...record.command,argv:['é','e\u0301','😀','x'.repeat(1024)],env:[],cwd:'/'}};const d=run(encode(r));assert.equal(d.decoded,true);assert.equal(d.argc,4);assert.equal(d.envc,0);});
 await t.test('PDESC001 cannot use opaque reservation or publisher without semantic native integration',()=>{const v=run(fixed,true);assert.equal(v.begin,-1);assert.equal(v.beginError,1);assert.equal(v.publish,-1);assert.equal(v.publishError,1);assert.equal(v.stage,0);assert.equal(v.attempted,0);});
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 t.diagnostic(JSON.stringify(evidence));
});

// This partial authority boundary authenticates thirteen fields only. It is
// deliberately not the complete DS3/DS4/DS8 or an INTENT_MATCHED result.
test('component-development-descriptor-authority-bindings',async t=>{
 const f=await componentReviewAuthorityFixture(t),reset=restorePoint(f);
 const moduleCode=String.raw`
import fs from 'node:fs';import assert from 'node:assert/strict';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {hash,inputs,snapshot} from './scripts/enterprise/evidence.mjs';import {currentContext} from './scripts/enterprise/context.mjs';
const url=pathToFileURL(resolve('scripts/enterprise/runtime-preparation.mjs'));let source=fs.readFileSync(url,'utf8');
assert.ok(source.includes('async function readComponentDescriptorAuthority('),'descriptor authority reader missing');
source=source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g,(_,q,p)=>'from '+JSON.stringify(new URL(p,url).href)).replaceAll('import.meta.url',JSON.stringify(url.href));
const m=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {readComponentDescriptorAuthority,verifyComponentDescriptorAuthority,encodeComponentDescriptor};').toString('base64'));
const root=process.cwd(),names=['runSlug','projectIdentity','workflowRef','workflowBundleBytes','builderOccurrence','builderSession','designReview','plan','reviewInputs','currentInputs','sourceCheckpoint','scopeDefinition','invocationId','domainGeneration','command','hostIdentity','supervisorIdentity','helperSource','helperBuild','helperBinary','policy','inputInventory','outputStore','admissionStore'];
const record=Object.fromEntries(names.map((n,i)=>[n,Buffer.alloc(32,i+1)]));Object.assign(record,{runSlug:'fixture-q',workflowRef:'fixture:workflow',builderSession:'fixture-builder',invocationId:'invocation-fixture',command:{executable:Buffer.alloc(32,51),argv:['helper'],env:[],cwd:'/sandbox'},policy:{digest:Buffer.alloc(32,52),limits:[1n,2n,3n,4n,5n]}});
const authority=await m.readComponentDescriptorAuthority(root);for(const [key,v]of Object.entries(authority.bindings))record[key]=['runSlug','workflowRef','builderSession'].includes(key)?v:Buffer.from(v,'hex');
`;
 const run=(code,imports=[])=>{const before=tree(f.temporary),r=spawnSync(process.execPath,['--import',f.guardPath,...imports.flatMap(p=>['--import',p]),'--input-type=module','-e',moduleCode+code],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000});assert.deepEqual(tree(f.temporary),before);assert.doesNotMatch(r.stderr,/FS_MUTATION/);return r;};
 await t.test('actual guard and raw occurrence bind thirteen fields without intent or launch authority',()=>{
  const r=run(String.raw`
const c=await currentContext(root),p=JSON.parse(fs.readFileSync('work/enterprise/plan.json')),a=JSON.parse(fs.readFileSync(c.identity.reportDirectory+'/enterprise-02-review.md','utf8').match(/\x60\x60\x60enterprise-preparation-restart-attestation\n([\s\S]*?)\n\x60\x60\x60/)[1]);
const lines=fs.readFileSync(c.identity.logPath,'utf8').trim().split('\n'),line=lines.findLast(l=>JSON.parse(l).type==='step_start');
assert.equal(authority.bindings.builderOccurrence,hash(line));assert.equal(authority.bindings.projectIdentity,hash(JSON.stringify({project:c.identity.project,stateId:c.identity.stateId})));assert.equal(authority.bindings.workflowBundleBytes,snapshot(c.identity.runRoot,['workflow-bundle']).digest);assert.equal(authority.bindings.plan,hash(fs.readFileSync('work/enterprise/plan.json')));assert.equal(authority.bindings.currentInputs,inputs(root).digest);assert.equal(authority.bindings.reviewInputs,a.reviewInputsDigest);assert.equal(authority.bindings.sourceCheckpoint,p.preparationRestart.sourceCheckpoint.sha256);assert.equal(authority.bindings.helperSource,hash(fs.readFileSync('scripts/enterprise/preparation-producer-linux.c')));
console.log(JSON.stringify(await m.verifyComponentDescriptorAuthority(root,record)));
`);assert.equal(r.status,0,r.stderr);const v=JSON.parse(r.stdout);assert.equal(v.checkedFields.length,13);assert.equal(v.authorityBindingsMatched,true);for(const key of ['intentMatched','provenanceAuthenticated','reviewReady','launchAuthority','nativePolicyApplied','generationQuiescent'])assert.equal(v[key],false);
 });
 const keys=['runSlug','projectIdentity','workflowRef','workflowBundleBytes','builderOccurrence','builderSession','designReview','plan','reviewInputs','currentInputs','sourceCheckpoint','scopeDefinition','helperSource'];
 for(const key of keys)await t.test('authentic sources reject changed descriptor '+key,()=>{reset();const r=run(`record[${JSON.stringify(key)}]=typeof record[${JSON.stringify(key)}]==='string'?'other':Buffer.alloc(32,255);await m.verifyComponentDescriptorAuthority(root,record);`);fail(r,new RegExp('descriptor authority mismatch: '+key));});
 await t.test('caller expected-value pair cannot replace authenticated sources',()=>{reset();const r=run("const fake={...authority,bindings:{...authority.bindings,runSlug:'other'}};record.runSlug='other';await m.verifyComponentDescriptorAuthority(root,record,fake);");fail(r,/descriptor authority arguments/);});
 await t.test('caller cannot inject context into authority reader',()=>{reset();fail(run("await m.readComponentDescriptorAuthority(root,authority);"),/descriptor authority arguments/);});
 await t.test('stale helper hash cannot replace the current authenticated helper hash',()=>{reset();const path=file(f,'scripts/enterprise/preparation-producer-linux.c'),old=hash(fs.readFileSync(path));fs.appendFileSync(path,'\n/* permitted implementation change */\n');const r=run(`record.helperSource=Buffer.from(${JSON.stringify(old)},'hex');await m.verifyComponentDescriptorAuthority(root,record);`);fail(r,/descriptor authority mismatch: helperSource/);});
 await t.test('unreviewed source change rejects before reading descriptor authority',()=>{reset();fs.appendFileSync(file(f,'src/domain.mjs'),'changed');fail(run(''),/restart unreviewed input change/);});
 await t.test('unfinished review cannot construct matching authority fields',()=>{reset();f.records.find(r=>r.type==='step_complete'&&r.iteration===6).status='error';f.append({type:'boundary'});fail(run(''),/incomplete preparation occurrence/);});
 await t.test('same builder and reviewer session cannot construct matching authority fields',()=>{reset();savePersonaSessions(f.root,{...f.sessions,[JSON.stringify(['enterprise-architecture-reviewer','codex','gpt-6-astra'])]:'builder-session'},'codex',f.paths.sessionsDirectory);fail(run(''),/independent|session/);});
 await t.test('mutation of descriptor during authority await rejects',()=>{reset();fail(run("const pending=m.verifyComponentDescriptorAuthority(root,record);record.command.argv.push('changed');await pending;"),/descriptor changed during authority check/);});
 await t.test('format-valid command remains explicitly unauthenticated',()=>{reset();const r=run("record.command.argv=['unapproved-command'];console.log(JSON.stringify(await m.verifyComponentDescriptorAuthority(root,record)));");assert.equal(r.status,0,r.stderr);const v=JSON.parse(r.stdout);assert.equal(v.intentMatched,false);assert.equal(v.provenanceAuthenticated,false);assert.equal(v.launchAuthority,false);assert.ok(v.remainingFields.includes('command'));});
 await t.test('authenticated fixture fields survive JS encoding and real C decoding without intent authority',()=>{
  reset();fs.copyFileSync(new URL('../../scripts/enterprise/preparation-producer-linux.c',import.meta.url),file(f,'scripts/enterprise/preparation-producer-linux.c'));
  const r=run("const result=await m.verifyComponentDescriptorAuthority(root,record);console.log(JSON.stringify({result,bindings:authority.bindings,wire:m.encodeComponentDescriptor(record).toString('hex')}));");assert.equal(r.status,0,r.stderr);const encoded=JSON.parse(r.stdout);
  const dir=join(f.temporary,'authority-c-decoder');fs.mkdirSync(dir);const source=fs.realpathSync(file(f,'scripts/enterprise/preparation-producer-linux.c')),sourceRaw=fs.readFileSync(source);
  assert.equal(hash(sourceRaw),encoded.bindings.helperSource);
  const harness=String.raw`
#define main helper_main
#include "${source}"
#undef main
int main(void){
 unsigned char b[65537];size_t n=fread(b,1,sizeof(b),stdin);if(ferror(stdin))return 90;
 struct pd_intent d;if(pd_intent_decode(b,n,&d))return 91;
 for(unsigned i=0;i<24;i++){for(size_t j=0;j<d.fields[i].n;j++)printf("%02x",d.fields[i].p[j]);putchar('\n');}
 return 0;
}
`;
  const path=join(dir,'harness.c'),binary=join(dir,'decoder'),compiler=process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc',compilerRaw=fs.readFileSync(compiler),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};fs.writeFileSync(path,harness);
  const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
  if(process.platform==='darwin'){const s=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(s.status,0,s.stderr);const path=fs.realpathSync(s.stdout.trim());sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);}
  argv.push(path,'-o',binary);const compiled=spawnSync(compiler,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
  const before=tree(f.temporary),decoded=spawnSync(binary,[],{env,input:Buffer.from(encoded.wire,'hex'),timeout:10000});assert.equal(decoded.status,0,decoded.stderr.toString());assert.equal(decoded.signal,null);assert.deepEqual(tree(f.temporary),before);
  const fields=decoded.stdout.toString().trim().split('\n');assert.equal(fields.length,24);
  const tags={runSlug:1,projectIdentity:2,workflowRef:3,workflowBundleBytes:4,builderOccurrence:5,builderSession:6,designReview:7,plan:8,reviewInputs:9,currentInputs:10,sourceCheckpoint:11,scopeDefinition:12,helperSource:18};
  for(const [key,tag]of Object.entries(tags))assert.equal(fields[tag-1],['runSlug','workflowRef','builderSession'].includes(key)?Buffer.from(encoded.bindings[key]).toString('hex'):encoded.bindings[key]);
  assert.deepEqual(fs.readFileSync(source),sourceRaw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);assert.equal(encoded.result.intentMatched,false);
  t.diagnostic(JSON.stringify({component:'PARTIAL_DESCRIPTOR_AUTHORITY_TO_C',platform:process.platform,sourceSha256:hash(sourceRaw),harness,compiler:{path:compiler,sha256:hash(compilerRaw),argv,sdk,status:compiled.status,stdout:compiled.stdout,stderr:compiled.stderr},binarySha256:hash(fs.readFileSync(binary)),wire:encoded.wire,decodedFields:fields,status:decoded.status,intentMatched:false,nativeAcceptance:false}));
 });
});

// These tests distinguish normal-build refusal from historical primitive tests.
// They do not authenticate intent or claim DS5's full semantic integration.
test('component-development-legacy-owner-build-isolation',async t=>{
 const {tmpdir,constants}=await import('node:os'),{resolve}=await import('node:path');
 const dir=fs.mkdtempSync(join(tmpdir(),'owner-build-isolation-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=resolve('scripts/enterprise/preparation-producer-linux.c'),raw=fs.readFileSync(source);
 // Reuse the independently specified fixed vector, not a saved successful run.
 const definition=fs.readFileSync(import.meta.filename,'utf8'),section=definition.slice(definition.indexOf("test('component-development-descriptor-codec-boundary'"));
 const vectorSource=section.slice(section.indexOf(' const names='),section.indexOf(' const compiler='));
 const wire=new Function('assert','Buffer','hash',vectorSource+';return fixed;')(assert,Buffer,hash);
 assert.equal(hash(wire),'ca4b1d6a51ada4f89076974165f0eaddb8ed0a172d3d7677407ffe1e4c7f2b2a');
 fs.writeFileSync(join(dir,'wire'),wire);fs.writeFileSync(join(dir,'helper.c'),raw);
 const compiler=fs.realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc'),compilerRaw=fs.readFileSync(compiler);
 const env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compiler,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 const harness=String.raw`
#include <stdlib.h>
#define main helper_main
#include "helper.c"
#undef main
int main(int argc,char **argv){
 if(argc!=5)return 90;
 int root=open(argv[1],O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(root<0)return 91;
 if(mkdirat(root,"descriptor",0700)||mkdirat(root,"admission",0700))return 92;
 int dd=openat(root,"descriptor",O_RDONLY|O_DIRECTORY|O_CLOEXEC),ad=openat(root,"admission",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(dd<0||ad<0)return 93;
 unsigned char bytes[65537];FILE*f=fopen(argv[2],"rb");if(!f)return 94;size_t n=fread(bytes,1,sizeof(bytes),f);if(ferror(f)||fclose(f))return 95;
 int typed=!strcmp(argv[3],"typed");if(!typed){memcpy(bytes,"abc",3);n=3;}
 struct pd_descriptor_pin pin=PD_DESCRIPTOR_INITIALIZER;if(pd_descriptor_create(dd,bytes,n,&pin)<0)return 96;
 struct pd_setup_owner owner=PD_SETUP_OWNER_INITIALIZER;char binding[65];if(pd_descriptor_binding(&pin,binding)<0)return 97;
 int r=-2,error=0,attempted=0,delivery=0,status=-1;
 if(!strcmp(argv[4],"begin")||!strcmp(argv[4],"begin-descriptor")){
  r=!strcmp(argv[4],"begin")?pd_setup_owner_begin(ad,binding,&owner):pd_setup_owner_begin_descriptor(ad,&pin,&owner);error=r<0?errno:0;
  if(!r){struct pd_setup_wait_result w;_exit(pd_setup_owner_wait(&owner,NULL,0,2000,&w)==0?17:42);}
 }else{
  /* Establish a real original-parent precondition using low-level transport.
   * This is fixture preparation, never a semantic owner constructor. */
  owner.owner=getpid();owner.store=ad;if(fstat(ad,&owner.store_identity))return 98;memcpy(owner.binding,binding,65);
  int begun=pd_setup_begin(ad,binding,&owner.pipe,&owner.child);if(begun<0)return 99;
  if(!begun){owner.stage=PD_SETUP_CHILD;owner.setup_process=getpid();struct pd_setup_wait_result w;_exit(pd_setup_owner_wait(&owner,NULL,0,2000,&w)==0?17:42);}
  owner.stage=PD_SETUP_PARENT;
  if(signal(SIGPIPE,SIG_IGN)==SIG_ERR)return 100;
  if(!strcmp(argv[4],"publish")){struct pd_setup_publication p;r=pd_setup_owner_publish(&owner,&p);error=r<0?errno:0;attempted=p.attempted;delivery=p.delivery;}
  else{struct pd_descriptor_publication p;r=pd_setup_owner_publish_descriptor(&owner,&pin,&p);error=r<0?errno:0;attempted=p.attempted;delivery=p.delivery;}
 }
 int phase=-1,stage=owner.stage;if(pd_scan(ad,binding,&phase))return 101;
 if(owner.stage==PD_SETUP_PARENT){struct pd_setup_cleanup c;if(pd_setup_owner_cancel(&owner,3000,&c))return 102;status=c.child.status;}
 else if(owner.stage==PD_SETUP_PUBLISHED){struct pd_setup_observation o;if(pd_setup_owner_reap(&owner,3000,&o)||!o.status_valid)return 103;status=o.status;}
 if(pd_descriptor_release(&pin)||close(ad)||close(dd)||close(root))return 104;
 printf("{\"r\":%d,\"error\":%d,\"attempted\":%d,\"delivery\":%d,\"phase\":%d,\"stage\":%d,\"childExit\":%d}\n",r,error,attempted,delivery,phase,stage,status<0?-1:WEXITSTATUS(status));return 0;
}
`;
 fs.writeFileSync(join(dir,'harness.c'),harness);
 const flags=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];let sdk=null;
 if(process.platform==='darwin'){const r=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);sdk={path:r.stdout.trim(),settingsSha256:hash(fs.readFileSync(join(r.stdout.trim(),'SDKSettings.json')))};flags.push('-isysroot',sdk.path);}
 const evidence={scope:'LEGACY_OWNER_BUILD_ISOLATION_NOT_SEMANTIC_ACCEPTANCE',sourceSha256:hash(raw),harness,wire:wire.toString('hex'),compiler:{path:compiler,sha256:hash(compilerRaw),version:version.stdout,sdk},builds:[],runs:[],nativeAccepted:false};
 const compile=(name,args,expected=0)=>{const r=spawnSync(compiler,[...flags,...args],{env,encoding:'utf8',timeout:30000});evidence.builds.push({name,argv:[...flags,...args],status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.status,expected,r.stderr);};
 for(const [name,extra]of [['normal',[]],['legacy',['-DPD_LEGACY_OWNER_TEST=1']]]){compile(name,[...extra,join(dir,'harness.c'),'-o',join(dir,name)]);evidence.builds.at(-1).binarySha256=hash(fs.readFileSync(join(dir,name)));}
 let serial=0;
 const run=(build,data,operation)=>{const store=join(dir,'store-'+serial++);fs.mkdirSync(store,{mode:0o700});const r=spawnSync(join(dir,build),[store,join(dir,'wire'),data,operation],{env:{...env,PD_LEGACY_OWNER_TEST:'1'},encoding:'utf8',timeout:8000});evidence.runs.push({build,data,operation,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr+' '+r.stdout);return JSON.parse(r.stdout);};
 for(const data of ['typed','opaque'])for(const op of ['begin','begin-descriptor','publish','publish-descriptor'])await t.test('normal build refuses '+data+' '+op+' despite legacy environment',()=>{
  const v=run('normal',data,op);assert.equal(v.r,-1);assert.equal(v.error,constants.errno.EPERM);assert.equal(v.attempted,0);assert.equal(v.delivery,0);
  assert.equal(v.phase,op.startsWith('begin')?0:1);assert.equal(v.stage,op.startsWith('begin')?0:3);assert.equal(v.childExit,op.startsWith('begin')?-1:42);
 });
 for(const op of ['begin','begin-descriptor','publish','publish-descriptor'])await t.test('compile-time legacy opaque positive '+op,()=>{const v=run('legacy','opaque',op);assert.equal(v.r,op.startsWith('begin')?1:0);assert.equal(v.phase,op.startsWith('begin')?1:2);assert.equal(v.childExit,op.startsWith('begin')?42:17);});
 await t.test('historical raw typed behavior exists only in explicit legacy harness',()=>{const v=run('legacy','typed','publish');assert.equal(v.r,0);assert.equal(v.phase,2);assert.equal(v.childExit,17);});
 await t.test('legacy macro cannot compile the normal helper entry',()=>{const r=spawnSync(compiler,[...flags,'-DPD_LEGACY_OWNER_TEST=1',join(dir,'helper.c'),'-o',join(dir,'forbidden')],{env,encoding:'utf8',timeout:30000});evidence.builds.push({name:'forbidden-normal-entry',status:r.status,stdout:r.stdout,stderr:r.stderr});assert.notEqual(r.status,0);assert.match(r.stderr,/PD_LEGACY_OWNER_TEST requires an isolated harness/);assert.equal(fs.existsSync(join(dir,'forbidden')),false);});
 await t.test('normal CLI remains inspection-only with legacy env and flag',()=>{
  compile('cli',[join(dir,'helper.c'),'-o',join(dir,'cli')]);
  const before=tree(dir);for(const [args,status]of [[['--inspect-host'],78],[['--legacy-owner-test'],64],[['--launch'],64]]){const r=spawnSync(join(dir,'cli'),args,{env:{...env,PD_LEGACY_OWNER_TEST:'1'},encoding:'utf8',timeout:5000});evidence.runs.push({args,status:r.status,stdout:r.stdout,stderr:r.stderr});assert.equal(r.status,status);if(status===78){const v=JSON.parse(r.stdout);assert.equal(v.workloadStarted,false);assert.equal(v.backendAuthenticated,false);}}assert.deepEqual(tree(dir),before);
 });
 assert.deepEqual(fs.readFileSync(source),raw);assert.deepEqual(fs.readFileSync(compiler),compilerRaw);t.diagnostic(JSON.stringify(evidence));
});

// Construction evidence is private and portable. These tests do not complete
// the C semantic owner/publication chain or authenticate a native launch.
test('component-development-descriptor-owned-sources',async t=>{
 const f=await componentReviewAuthorityFixture(t);
 fs.copyFileSync(new URL('../../scripts/enterprise/preparation-producer-linux.c',import.meta.url),file(f,'scripts/enterprise/preparation-producer-linux.c'));
 const code=String.raw`
import fs from 'node:fs';import crypto from 'node:crypto';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import assert from 'node:assert/strict';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {hash,inputs} from './scripts/enterprise/evidence.mjs';
const url=pathToFileURL(resolve('scripts/enterprise/runtime-preparation.mjs'));let source=fs.readFileSync(url,'utf8');assert.ok(source.includes('async function constructComponentDescriptor('),'owned descriptor constructor missing');
source=source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g,(_,q,p)=>'from '+JSON.stringify(new URL(p,url).href)).replaceAll('import.meta.url',JSON.stringify(url.href));
const m=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {constructComponentDescriptor,verifyOwnedComponentDescriptor,closeComponentDescriptor};\n//# sourceURL=owned-descriptor-fixture.mjs').toString('base64'));
const readonly=async(h,record)=>{
 const restores=[];let mutations=0;
 const patch=(obj,key)=>{const old=obj[key];restores.push(()=>obj[key]=old);obj[key]=()=>{mutations++;throw Error('UNEXPECTED_VERIFIER_EFFECT '+key);};};
 for(const key of ['writeFileSync','writeSync','mkdirSync','renameSync','unlinkSync','rmSync','rmdirSync','chmodSync','chownSync','linkSync','symlinkSync','truncateSync','ftruncateSync','fsyncSync'])patch(fs,key);
 for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])patch(cp,key);
 const open=fs.openSync;restores.push(()=>fs.openSync=open);fs.openSync=(p,flags,...xs)=>{if(typeof flags==='string'?flags!=='r':(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND))!==0){mutations++;throw Error('UNEXPECTED_VERIFIER_EFFECT open');}return open(p,flags,...xs);};syncBuiltinESMExports();
 try{return await m.verifyOwnedComponentDescriptor(h,record);}finally{for(const restore of restores.reverse())restore();syncBuiltinESMExports();assert.equal(mutations,0);}
};
const before=inputs(process.cwd()),h=await m.constructComponentDescriptor(process.cwd()),results=[];
try{
 const good=await readonly(h,h.record);assert.equal(good.checkedFields.length,24);assert.equal(good.intentMatched,false);assert.equal(good.launchAuthority,false);
 results.push({name:'all sources acquired',pass:true});
 const root=resolve(h.diagnosticPath),read=n=>fs.readFileSync(root+'/'+n),json=n=>JSON.parse(read(n));
 assert.equal(h.record.helperBuild.toString('hex'),hash(read('build.json')));assert.equal(h.record.hostIdentity.toString('hex'),hash(read('host.json')));assert.equal(h.record.inputInventory.toString('hex'),hash(read('inventory.json')));
 const build=json('build.json');assert.equal(build.status,0);assert.equal(build.signal,null);assert.equal(build.error,null);assert.equal(build.binary.sha256,h.record.helperBinary.toString('hex'));assert.equal(json('host.json').status,78);assert.equal(json('host.json').observation.backendAuthenticated,false);
 const inv=json('inventory.json');assert.equal(inv.entries.length,before.entries.length);for(const e of inv.entries){const b=fs.readFileSync(e.copy.path);assert.equal(hash(b),e.sha256);assert.equal(b.length,e.bytes);}
 const out=json('output-store.json'),adm=json('admission-store.json');assert.notDeepEqual([out.identity.dev,out.identity.ino],[adm.identity.dev,adm.identity.ino]);assert.equal(out.generation,h.record.domainGeneration.toString('hex'));assert.equal(adm.invocation,h.record.invocationId);
 results.push({name:'raw evidence and held identities',pass:true});
 for(const key of Object.keys(h.record)){
  const r=structuredClone(h.record); // restore Buffer/BigInt types without JSON coercion
  for(const k of Object.keys(h.record))r[k]=Buffer.isBuffer(h.record[k])?Buffer.from(h.record[k]):h.record[k];
  if(key==='command')r.command={...h.record.command,argv:['other']};else if(key==='policy')r.policy={...h.record.policy,limits:[...h.record.policy.limits.slice(0,4),99n]};else if(Buffer.isBuffer(r[key]))r[key]=Buffer.alloc(32,255);else r[key]='other';
  await assert.rejects(readonly(h,r),new RegExp('owned descriptor mismatch: '+key));results.push({name:'field '+key,pass:true});
 }
 for(const [name,change]of [['executable',c=>c.executable=Buffer.alloc(32,8)],['argv',c=>c.argv=['node','--help']],['env',c=>c.env=[['LANG','other']]],['cwd',c=>c.cwd='/other']]){const r={...h.record,command:{...h.record.command,argv:[...h.record.command.argv],env:h.record.command.env.map(x=>[...x])}};change(r.command);await assert.rejects(readonly(h,r),/owned descriptor mismatch: command/);results.push({name:'command '+name,pass:true});}
 await assert.rejects(readonly({...h},h.record),/owned descriptor handle/);results.push({name:'forged handle',pass:true});
 await assert.rejects(m.constructComponentDescriptor(process.cwd(),{}),/constructor arguments/);results.push({name:'caller sources forbidden',pass:true});
 // Recompute descriptor binding after tampering with a retained raw source. The
 // independently held original must still reject it before field comparison.
 const policyPath=root+'/policy.json',policyRaw=read('policy.json');fs.appendFileSync(policyPath,' ');try{await assert.rejects(readonly(h,{...h.record,policy:{...h.record.policy,digest:Buffer.from(hash(read('policy.json')),'hex')}}),/owned source changed/);}finally{fs.writeFileSync(policyPath,policyRaw);}results.push({name:'self-consistent policy forgery',pass:true});
 const extra=root+'/input/extra';fs.writeFileSync(extra,'x');try{await assert.rejects(readonly(h,h.record),/owned inventory changed/);}finally{fs.unlinkSync(extra);}results.push({name:'unreferenced input',pass:true});
 const original=root+'/output',moved=root+'/output-moved';fs.renameSync(original,moved);fs.mkdirSync(original,{mode:0o700});try{await assert.rejects(readonly(h,h.record),/owned directory changed/);}finally{fs.rmdirSync(original);fs.renameSync(moved,original);}results.push({name:'same-path store replacement',pass:true});
 const copy=inv.entries[0].copy.path,copyRaw=fs.readFileSync(copy);fs.writeFileSync(copy,Buffer.from('changed'));try{await assert.rejects(readonly(h,h.record),/owned source changed/);}finally{fs.writeFileSync(copy,copyRaw);}results.push({name:'input copy mutation',pass:true});
 const pending=readonly(h,h.record);h.record.command.argv.push('racing');try{await assert.rejects(pending,/descriptor changed during owned check/);}finally{h.record.command.argv.pop();}results.push({name:'descriptor await mutation',pass:true});

 for(const name of ['owner.json','definition.json','supervisor.json','build.json','host.json','inventory.json','output-store.json','admission-store.json','descriptor-store.json','command-executable.json','descriptor.bin','helper']){const path=root+'/'+name,raw=read(name);fs.appendFileSync(path,' ');try{await assert.rejects(readonly(h,h.record),/owned source changed/);}finally{fs.writeFileSync(path,raw);}results.push({name:'retained source '+name,pass:true});}
 // Real C consumer of the acquired descriptor. The external harness has no
 // semantic expected-value authority and cannot create a production owner.
 const decodeDir=fs.mkdtempSync(resolve(process.cwd(),'..')+'/owned-decode-'),harnessPath=decodeDir+'/harness.c',binaryPath=decodeDir+'/decoder';
 const harness='#define main helper_main\n#include '+JSON.stringify(build.source.path)+'\n#undef main\nint main(void){unsigned char b[65537];size_t n=fread(b,1,sizeof(b),stdin);struct pd_intent d;if(ferror(stdin)||pd_intent_decode(b,n,&d))return 91;for(unsigned i=0;i<24;i++){for(size_t j=0;j<d.fields[i].n;j++)printf("%02x",d.fields[i].p[j]);putchar(10);}return 0;}\n';
 fs.writeFileSync(harnessPath,harness);const argv=build.argv.slice(1);argv[argv.indexOf(build.source.path)]=harnessPath;argv[argv.indexOf(build.binary.path)]=binaryPath;
 const compiled=cp.spawnSync(build.argv[0],argv,{env:build.environment,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 const decoded=cp.spawnSync(binaryPath,[],{input:h.wire,env:{LANG:'C',LC_ALL:'C'},timeout:10000});assert.equal(decoded.status,0,decoded.stderr.toString());const fields=decoded.stdout.toString().trim().split('\n');assert.equal(fields.length,24);let offset=16;for(let i=0;i<24;i++){assert.equal(h.wire.readUInt16BE(offset),i+1);const n=h.wire.readUInt32BE(offset+2);assert.equal(fields[i],h.wire.subarray(offset+6,offset+6+n).toString('hex'));offset+=6+n;}assert.equal(offset,h.wire.length);
 results.push({name:'owned sources through JS and real C decoder',pass:true});
 const cEvidence={harness,compiler:build.argv[0],compilerSha256:build.compiler.sha256,argv,status:compiled.status,stdout:compiled.stdout,stderr:compiled.stderr,binarySha256:hash(fs.readFileSync(binaryPath)),wireSha256:hash(h.wire),decodedFields:fields,status:decoded.status};
 assert.deepEqual(inputs(process.cwd()),before);await readonly(h,h.record);

 const second=await m.constructComponentDescriptor(process.cwd());try{assert.notEqual(second.record.invocationId,h.record.invocationId);assert.notDeepEqual(second.record.domainGeneration,h.record.domainGeneration);}finally{m.closeComponentDescriptor(second);}results.push({name:'fresh generation',pass:true});
 const random=crypto.randomBytes;crypto.randomBytes=()=>Buffer.from(h.record.domainGeneration);syncBuiltinESMExports();const ownerBefore=read('owner.json');try{await assert.rejects(m.constructComponentDescriptor(process.cwd()),/EEXIST/);}finally{crypto.randomBytes=random;syncBuiltinESMExports();}assert.deepEqual(read('owner.json'),ownerBefore);assert.equal(fs.existsSync(root+'/failure.json'),false);results.push({name:'generation collision preserves existing owner',pass:true});
 const cPath=resolve('scripts/enterprise/preparation-producer-linux.c'),cRaw=fs.readFileSync(cPath);const prior=new Set(fs.readdirSync(resolve(h.diagnosticPath,'..')));fs.appendFileSync(cPath,'\n#error intentional_constructor_failure\n');try{await assert.rejects(m.constructComponentDescriptor(process.cwd()),/owned compiler failed/);}finally{fs.writeFileSync(cPath,cRaw);}const failed=fs.readdirSync(resolve(h.diagnosticPath,'..')).filter(p=>!prior.has(p));assert.equal(failed.length,1);const failureRoot=resolve(h.diagnosticPath,'..',failed[0]),failure=JSON.parse(fs.readFileSync(failureRoot+'/failure.json')),failedBuild=JSON.parse(fs.readFileSync(failureRoot+'/compiler-execution.json'));assert.equal(failedBuild.status,1);assert.equal(failure.kind,'INTENT_SOURCE_ACQUISITION_FAILED');assert.equal(fs.existsSync(failureRoot+'/descriptor.bin'),false);results.push({name:'failed compile retained without descriptor',pass:true});
 assert.deepEqual(inputs(process.cwd()),before);await readonly(h,h.record);
 console.log(JSON.stringify({results,good,build,cEvidence,failure,failedBuild,host:json('host.json'),inventoryEntries:inv.entries.length,wireSha256:hash(h.wire),output:out,admission:adm,inputsDigest:before.digest}));
}finally{m.closeComponentDescriptor(h);}
await assert.rejects(readonly(h,h.record),/owned descriptor closed/);
`;
 const r=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:f.root,env:f.env,encoding:'utf8',timeout:120000,maxBuffer:8e6});
 assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout);
 for(const check of result.results)await t.test(check.name,()=>assert.equal(check.pass,true));
 await t.test('source acquisition has no semantic owner or native approval',()=>{for(const key of ['intentMatched','reviewReady','launchAuthority','nativePolicyApplied','generationQuiescent'])assert.equal(result.good[key],false);});
 t.diagnostic(JSON.stringify(result));
});

test('component-development-descriptor-projection',async t=>{
 const f=await componentReviewAuthorityFixture(t);
 fs.copyFileSync(new URL('../../scripts/enterprise/preparation-producer-linux.c',import.meta.url),file(f,'scripts/enterprise/preparation-producer-linux.c'));
 const code=String.raw`
import fs from 'node:fs';import assert from 'node:assert/strict';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {hash,inputs} from './scripts/enterprise/evidence.mjs';
const url=pathToFileURL(resolve('scripts/enterprise/runtime-preparation.mjs'));let source=fs.readFileSync(url,'utf8');source=source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g,(_,q,p)=>'from '+JSON.stringify(new URL(p,url).href)).replaceAll('import.meta.url',JSON.stringify(url.href));
const m=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {constructComponentDescriptor,verifyOwnedComponentDescriptor,closeComponentDescriptor};\n//# sourceURL=projection-fixture.mjs').toString('base64'));
const before=inputs(process.cwd()),h=await m.constructComponentDescriptor(process.cwd()),results=[];
try{
 const root=resolve(h.diagnosticPath),read=n=>fs.readFileSync(root+'/'+n),json=n=>JSON.parse(read(n));
 assert.ok(fs.existsSync(root+'/command-projection.json'),'command projection missing');
 const p=json('command-projection.json'),inventory=json('inventory.json'),owner=json('owner.json');
 const v=await m.verifyOwnedComponentDescriptor(h,h.record);assert.equal(v.intentMatched,false);assert.equal(v.launchAuthority,false);
 assert.equal(p.kind,'PORTABLE_COMMAND_PROJECTION');assert.equal(p.nativeApplied,false);assert.equal(p.invocationId,owner.invocationId);assert.equal(p.generation,owner.generation);
 results.push({name:'projection bound to invocation without native authority',pass:true});
 assert.deepEqual(h.record.command.argv,['/bin/node','--version']);assert.equal(h.record.command.cwd,'/work');assert.deepEqual(h.record.command.env,[['LANG','C'],['LC_ALL','C']]);
 assert.deepEqual(p.entries.map(x=>[x.role,x.sandboxPath]),[['root','/'],['executable','/bin/node'],['cwd','/work'],['inputs','/input'],['output','/output']]);results.push({name:'exact command and finite projection roles',pass:true});
 const exe=p.entries.find(x=>x.role==='executable'),cwd=p.entries.find(x=>x.role==='cwd');assert.equal(exe.source.path,root+'/sandbox/bin/node');assert.equal(cwd.source.path,root+'/sandbox/work');
 assert.equal(hash(fs.readFileSync(exe.source.path)),h.record.command.executable.toString('hex'));assert.equal(exe.source.bytes,fs.statSync(fs.realpathSync(process.execPath)).size);assert.notEqual(exe.source.path,fs.realpathSync(process.execPath));
 assert.notDeepEqual([exe.source.identity.dev,exe.source.identity.ino],[String(fs.statSync(process.execPath).dev),String(fs.statSync(process.execPath).ino)]);results.push({name:'executable is distinct held byte copy',pass:true});
 assert.equal(inventory.commandProjection.sha256,hash(read('command-projection.json')));assert.equal(inventory.commandProjection.bytes,read('command-projection.json').length);assert.equal(h.record.inputInventory.toString('hex'),hash(read('inventory.json')));results.push({name:'projection raw bytes bound through input inventory',pass:true});
 const dirs=p.entries.filter(x=>x.role!=='executable');assert.equal(new Set(dirs.map(x=>x.source.identity.dev+':'+x.source.identity.ino)).size,4);for(const d of dirs){const st=fs.lstatSync(d.source.path);assert.ok(st.isDirectory()&&!st.isSymbolicLink());assert.equal(String(st.ino),d.source.identity.ino);}results.push({name:'held distinct directories',pass:true});
 for(const [role,change]of [['executable',x=>x.source.sha256='f'.repeat(64)],['cwd',x=>x.sandboxPath='/elsewhere'],['root',x=>x.source.path='/'],['inputs',x=>x.source.path=cwd.source.path],['output',x=>x.source.identity={...dirs[0].source.identity}]]){
  const raw=read('command-projection.json'),changed=JSON.parse(raw);change(changed.entries.find(x=>x.role===role));fs.writeFileSync(root+'/command-projection.json',JSON.stringify(changed));try{await assert.rejects(m.verifyOwnedComponentDescriptor(h,h.record),/owned source changed/);}finally{fs.writeFileSync(root+'/command-projection.json',raw);}results.push({name:'projection source tamper '+role,pass:true});
 }
 // Rehash both inventory and descriptor after changing the projection. Held
 // independent raw sources must reject this self-consistent replacement.
 const pRaw=read('command-projection.json'),iRaw=read('inventory.json');fs.appendFileSync(root+'/command-projection.json',' ');const forged=JSON.parse(iRaw);forged.commandProjection.sha256=hash(read('command-projection.json'));forged.commandProjection.bytes=read('command-projection.json').length;fs.writeFileSync(root+'/inventory.json',JSON.stringify(forged));try{await assert.rejects(m.verifyOwnedComponentDescriptor(h,{...h.record,inputInventory:Buffer.from(hash(read('inventory.json')),'hex')}),/owned source changed/);}finally{fs.writeFileSync(root+'/inventory.json',iRaw);fs.writeFileSync(root+'/command-projection.json',pRaw);}results.push({name:'rehashed projection inventory forgery',pass:true});
 const exeRaw=fs.readFileSync(exe.source.path);fs.writeFileSync(exe.source.path,'changed');try{await assert.rejects(m.verifyOwnedComponentDescriptor(h,h.record),/owned source changed/);}finally{fs.writeFileSync(exe.source.path,exeRaw);}results.push({name:'projected executable bytes changed',pass:true});
 for(const role of ['root','cwd','inputs','output']){
  const d=p.entries.find(x=>x.role===role).source.path,moved=d+'-old';fs.renameSync(d,moved);fs.mkdirSync(d,{mode:0o700});try{await assert.rejects(m.verifyOwnedComponentDescriptor(h,h.record),/owned directory changed/);}finally{fs.rmdirSync(d);fs.renameSync(moved,d);}results.push({name:'same path directory replacement '+role,pass:true});
 }
 const extra=root+'/sandbox/work/extra';fs.writeFileSync(extra,'x');try{await assert.rejects(m.verifyOwnedComponentDescriptor(h,h.record),/owned inventory changed/);}finally{fs.unlinkSync(extra);}results.push({name:'unexpected cwd content',pass:true});
 fs.renameSync(exe.source.path,exe.source.path+'-old');fs.symlinkSync(fs.realpathSync(process.execPath),exe.source.path);try{await assert.rejects(m.verifyOwnedComponentDescriptor(h,h.record),/owned source symlink path/);}finally{fs.unlinkSync(exe.source.path);fs.renameSync(exe.source.path+'-old',exe.source.path);}results.push({name:'host executable symlink substitution',pass:true});
 await m.verifyOwnedComponentDescriptor(h,h.record);assert.deepEqual(inputs(process.cwd()),before);
 console.log(JSON.stringify({results,projection:p,inventoryProjection:inventory.commandProjection,wireSha256:hash(h.wire),inputsDigest:before.digest,intentMatched:false,launchAuthority:false}));
}finally{m.closeComponentDescriptor(h);}
`;
 const r=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:f.root,env:f.env,encoding:'utf8',timeout:120000,maxBuffer:8e6});assert.equal(r.status,0,r.stderr);
 const result=JSON.parse(r.stdout);for(const check of result.results)await t.test(check.name,()=>assert.equal(check.pass,true));t.diagnostic(JSON.stringify(result));
});


test('component-development-owned-c-comparison',async t=>{
 const f=await componentReviewAuthorityFixture(t);
 fs.copyFileSync(new URL('../../scripts/enterprise/preparation-producer-linux.c',import.meta.url),file(f,'scripts/enterprise/preparation-producer-linux.c'));
 const code=String.raw`
import fs from 'node:fs';import cp from 'node:child_process';import assert from 'node:assert/strict';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {hash,inputs} from './scripts/enterprise/evidence.mjs';
const url=pathToFileURL(resolve('scripts/enterprise/runtime-preparation.mjs'));let source=fs.readFileSync(url,'utf8');assert.ok(source.includes('async function compareOwnedComponentDescriptor('),'owned C comparison missing');
source=source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g,(_,q,p)=>'from '+JSON.stringify(new URL(p,url).href)).replaceAll('import.meta.url',JSON.stringify(url.href));
const m=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {constructComponentDescriptor,verifyOwnedComponentDescriptor,closeComponentDescriptor,compareOwnedComponentDescriptor,validateComponentIntentDefinition,encodeComponentDescriptor};').toString('base64'));
const before=inputs(process.cwd()),h=await m.constructComponentDescriptor(process.cwd()),results=[];
try{
 const root=resolve(h.diagnosticPath),definition=JSON.parse(fs.readFileSync(root+'/definition.json'));
 assert.equal(m.validateComponentIntentDefinition(definition),true);
 const result=await m.compareOwnedComponentDescriptor(h);assert.equal(result.cFieldsMatched,true);assert.equal(result.intentMatched,false);assert.equal(result.launchAuthority,false);results.push({name:'real guard owned expectation inherited FDs and C comparison',pass:true});
 const build=JSON.parse(fs.readFileSync(root+'/comparison-build.json'));
 const temp=fs.mkdtempSync(resolve(process.cwd(),'..')+'/intent-comparison-');
 const expected=fs.openSync(root+'/expected.bin','r');
 const compare=(wire,alias=false)=>{const path=temp+'/candidate';fs.writeFileSync(path,wire);const candidate=fs.openSync(path,'r');try{return cp.spawnSync(build.binary.path,[],{env:{LANG:'C',LC_ALL:'C'},encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe',expected,alias?expected:candidate]});}finally{fs.closeSync(candidate);}};
 try{
  assert.equal(compare(h.wire).status,0);results.push({name:'independently held expected bytes positive',pass:true});
  for(const key of Object.keys(h.record)){
   const r={...h.record};if(key==='command')r.command={...r.command,argv:['/bin/node','--help']};else if(key==='policy')r.policy={...r.policy,limits:[1n,...r.policy.limits.slice(1)]};else if(Buffer.isBuffer(r[key]))r[key]=Buffer.alloc(32,255);else r[key]='other';
   const x=compare(m.encodeComponentDescriptor(r));assert.equal(x.status,1,x.stderr);assert.match(x.stderr,/C_INTENT_MISMATCH/);results.push({name:'C typed field '+key,pass:true});
  }
  for(const [name,change]of [['executable',r=>r.command.executable=Buffer.alloc(32,7)],['argv-count',r=>r.command.argv.push('extra')],['env-name',r=>r.command.env=[['LC_ALL','C']]],['env-value',r=>r.command.env=[['LANG','other'],['LC_ALL','C']]],['cwd',r=>r.command.cwd='/elsewhere'],...Array.from({length:5},(_,i)=>['policy-limit-'+i,r=>r.policy.limits[i]+=1n])]){
   const r={...h.record,command:{...h.record.command,argv:[...h.record.command.argv],env:h.record.command.env.map(x=>[...x])},policy:{...h.record.policy,limits:[...h.record.policy.limits]}};change(r);assert.equal(compare(m.encodeComponentDescriptor(r)).status,1);results.push({name:'C subfield '+name,pass:true});
  }
  assert.equal(compare(h.wire,true).status,1);results.push({name:'same expected and candidate inode rejected',pass:true});
  assert.equal(compare(h.wire.subarray(0,h.wire.length-1)).status,1);results.push({name:'truncated candidate rejected',pass:true});
  fs.writeFileSync(temp+'/candidate',h.wire);
  const writable=fs.openSync(temp+'/candidate','r+');try{const r=cp.spawnSync(build.binary.path,[],{encoding:'utf8',stdio:['ignore','pipe','pipe',expected,writable]});assert.equal(r.status,1);}finally{fs.closeSync(writable);}results.push({name:'writable candidate FD rejected',pass:true});
  const wide={...h.record,policy:{...h.record.policy,limits:[9007199254740993n,...h.record.policy.limits.slice(1)]}},wideWire=m.encodeComponentDescriptor(wide),widePath=temp+'/wide-expected';fs.writeFileSync(widePath,wideWire);const wideFD=fs.openSync(widePath,'r');
  try{for(const [name,delta,status]of [['exact',0n,0],['adjacent',1n,1]]){const r={...wide,policy:{...wide.policy,limits:[wide.policy.limits[0]+delta,...wide.policy.limits.slice(1)]}},path=temp+'/wide-candidate';fs.writeFileSync(path,m.encodeComponentDescriptor(r));const fd=fs.openSync(path,'r');try{assert.equal(cp.spawnSync(build.binary.path,[],{encoding:'utf8',stdio:['ignore','pipe','pipe',wideFD,fd]}).status,status);}finally{fs.closeSync(fd);}results.push({name:'uint64 above 2^53 '+name,pass:true});}}finally{fs.closeSync(wideFD);}

 }finally{fs.closeSync(expected);}
 for(const [name,change]of [['supervisor-placeholder',d=>d.supervisor.role='UNAVAILABLE'],['policy-placeholder',d=>d.policy.syscalls='version-probe-allowlist-required'],['unknown-field',d=>d.policy.allowAll=true],['zero-limit',d=>d.policy.limits[0]='0'],['unknown-syscall',d=>d.policy.syscalls.allow.push('made_up')],['privileged-uid',d=>d.policy.credentials.uid=0],['writable-input',d=>d.policy.mounts.find(x=>x.path==='/input').access='rw'],['unbounded-supervisor',d=>d.supervisor.onDeadline='ignore'],['cwd-outside-projection',d=>d.command.cwd='/host']]){
  const d=structuredClone(definition);change(d);assert.throws(()=>m.validateComponentIntentDefinition(d),/intent definition/);results.push({name:'definition '+name,pass:true});
 }
 const expectedRaw=fs.readFileSync(root+'/expected.bin');fs.appendFileSync(root+'/expected.bin','x');try{await assert.rejects(m.compareOwnedComponentDescriptor(h),/owned source changed/);}finally{fs.writeFileSync(root+'/expected.bin',expectedRaw);}results.push({name:'held expected source tampering rejected',pass:true});
 await assert.rejects(m.compareOwnedComponentDescriptor({...h}),/owned descriptor handle/);results.push({name:'serialized comparison cannot recreate handle',pass:true});
 await assert.rejects(m.compareOwnedComponentDescriptor(h,{}),/comparison arguments/);results.push({name:'caller expected injection rejected',pass:true});
 await m.verifyOwnedComponentDescriptor(h,h.record);assert.deepEqual(inputs(process.cwd()),before);
 console.log(JSON.stringify({results,result,build,definition,wireSha256:hash(h.wire),inputsDigest:before.digest}));
}finally{m.closeComponentDescriptor(h);}
`;
 const r=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:f.root,env:f.env,encoding:'utf8',timeout:120000,maxBuffer:8e6});assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout);
 for(const row of result.results)await t.test(row.name,()=>assert.equal(row.pass,true));t.diagnostic(JSON.stringify(result));
});

// A separately registered successor run authenticates its own completed review.
// The predecessor's approvals and plan remain frozen data, never current context.
async function componentContinuationFixture(t){
 const f=await componentReviewAuthorityFixture(t),ref=path=>({path,sha256:hash(fs.readFileSync(file(f,path)))}),old=structuredClone(f.restartAttestation),oldPlan=read(file(f,'work/enterprise/plan.json'));
 const terminal={type:'workflow_abort',iterations:7,reason:'Workflow aborted by step transition',endTime:new Date().toISOString()};f.append(terminal);put(f.run.metaAbs,{...read(f.run.metaAbs),status:'failed',iterations:7,reason:terminal.reason,endTime:terminal.endTime});
 for(const n of ['architecture.md','implementation.md'])put(join(f.run.reportsAbs,n),'synthetic predecessor '+n);
 const originals=[f.run.metaAbs,join(f.run.logsAbs,'fixture.jsonl'),...['architecture.md','implementation.md','enterprise-02-review.md'].map(n=>join(f.run.reportsAbs,n))];
 const references=originals.map((path,i)=>{const raw=fs.readFileSync(path),copy='evidence/continuation-copy/'+i;put(file(f,copy),raw.toString());return{path,copy,sha256:hash(raw),bytes:raw.length};});
 f.componentPredecessor=f.nextRun('continued-component-run');
 put(file(f,'evidence/continuation-checkpoint.json'),{schemaVersion:1,kind:'READONLY_PREDECESSOR_DATA_NOT_AUTHORITY',runSlug:f.run.slug,predecessorRunSlug:f.componentPredecessor.slug,references,currentApprovals:[],allWritersStopped:false,hostExclusionProven:false,completeH:false});
 const saved=read(file(f,oldPlan.preparationRestart.entrySnapshot));saved.runSlug=f.run.slug;saved.entries=saved.entries.filter(e=>!['work/enterprise/plan.json',...old.permittedPaths].includes(e.path));
 for(const path of ['work/enterprise/plan.json',...old.permittedPaths]){const raw=fs.readFileSync(file(f,path)),copy='evidence/continuation-entry/'+path;put(file(f,copy),raw.toString());saved.entries.push({...ref(path),bytes:raw.length,copy});}put(file(f,'evidence/continuation-entry.json'),saved);
 const entry={schemaVersion:4,runSlug:f.run.slug,contract:'work/enterprise/COMPONENT_CONTINUATION.md',purpose:old.purpose,permission:old.permission,attestation:'enterprise-preparation-restart-attestation',predecessorRunSlug:f.componentPredecessor.slug,sourceRunSlug:oldPlan.preparationRestart.sourceRunSlug,entrySnapshot:'evidence/continuation-entry.json',predecessorCheckpoint:'evidence/continuation-checkpoint.json',permittedPaths:old.permittedPaths,diagnosticNamespace:`evidence/enterprise/component-development/${f.run.slug}/`,sourceCheckpoint:old.sourceCheckpoint,currentApprovals:[],componentReviewAuthority:true,authorityTransferred:false,productVerified:false,nativeAccepted:false,completeH:false,...Object.fromEntries(['captureAuthority','recoveryAuthority','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority'].map(k=>[k,false]))};
 put(file(f,entry.contract),'synthetic independent continuation contract');mutate(f,'work/enterprise/plan.json',p=>{p.historicalRuntime=p.runtime;p.componentContinuation=entry;});
 const m=ok(spawnSync(process.execPath,['--input-type=module','-e',"import {inputs} from './scripts/enterprise/evidence.mjs';console.log(JSON.stringify(inputs(process.cwd())));"],{cwd:f.root,env:f.env,encoding:'utf8'}));put(file(f,'evidence/continuation-inputs.json'),m);
 f.restartAttestation={...old,schemaVersion:4,runSlug:f.run.slug,iteration:2,contractPath:entry.contract,contractSha256:ref(entry.contract).sha256,planSha256:ref('work/enterprise/plan.json').sha256,reviewInputsDigest:m.digest,reviewInputsManifest:ref('evidence/continuation-inputs.json'),entryManifest:ref(entry.entrySnapshot),continuationCheckpoint:{...ref(entry.predecessorCheckpoint),bytes:fs.statSync(file(f,entry.predecessorCheckpoint)).size}};
 phases(f,'review-architecture',2,fenced('enterprise-preparation-restart-attestation',f.restartAttestation));f.context('build-foundation',3);return f;
}
test('component-development-schema4-continuation-authority',async t=>{
 const f=await componentContinuationFixture(t),reset=restorePoint(f),inspect=()=>{const r=componentDevelopmentRead(f);assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 await t.test('RC1 current registered run authenticates schema4 without transferred authority',()=>{const r=inspect();assert.equal(r.runSlug,f.run.slug);assert.equal(r.continuationCheckpointBound,true);assert.equal(r.implementationAuthorityAuthenticated,true);for(const k of ['ordinaryBatchAuthority','completeH','nativeAcceptance','targetLaunchAuthority','recoveryAuthority'])assert.equal(r[k],false);assert.deepEqual(r.currentApprovals,[]);assert.deepEqual(componentOutputs(f),[]);});
 for(const [name,edit,re]of [['old schema3',a=>{a.schemaVersion=3;delete a.continuationCheckpoint;},/restart contractPath/],['old approval run',a=>a.runSlug=f.componentPredecessor.slug,/restart runSlug/],['unknown schema',a=>a.schemaVersion=5,/attestation fields|schemaVersion/],['extra authority',a=>a.force=true,/attestation fields/],['capture authority',a=>a.captureAuthority=true,/restart captureAuthority/],['foreign bundle',a=>a.bundleDigest='0'.repeat(64),/restart bundleDigest/],['same claimed session',a=>a.providerSessionId='builder-session',/restart providerSessionId/],['runtime',a=>a.runtimeIdentity.version='wrong',/runtime identity/],['extra path',a=>a.permittedPaths.push('scripts/enterprise/context.mjs'),/plan permittedPaths/],['checkpoint length',a=>a.continuationCheckpoint.bytes++,/continuation checkpoint length/]])await t.test('RC2 rejects '+name+' without writes',()=>{reset();rewriteRestartAttestation(f,edit);fail(componentDevelopmentRead(f),re);assert.deepEqual(componentOutputs(f),[]);});
 for(const path of ['evidence/continuation-checkpoint.json','evidence/continuation-entry/work/enterprise/plan.json','evidence/continuation-copy/0','evidence/restart-checkpoint.json','work/enterprise/progress.json'])await t.test('RC2 rejects changed '+path,()=>{reset();fs.appendFileSync(file(f,path),' ');fail(componentDevelopmentRead(f),/restart changed reference|restart unreviewed input/);});
 await t.test('RC2 rejects live Q mutation without restoring from checkpoint',()=>{reset();fs.appendFileSync(f.componentPredecessor.metaAbs,' ');fail(componentDevelopmentRead(f),/continuation original changed/);});
 for(const kind of ['unfinished','phase','canonical','actual-session'])await t.test('RC2 rejects '+kind,()=>{reset();if(kind==='unfinished')f.records.find(r=>r.type==='step_complete'&&r.step==='review-architecture').status='error';if(kind==='phase')f.records.find(r=>r.type==='phase_complete').content+='\n```enterprise-batch-attestation\n{}\n```';if(kind==='canonical')fs.appendFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'),'changed');if(kind==='actual-session')savePersonaSessions(f.root,{...f.sessions,[JSON.stringify(['enterprise-architecture-reviewer','codex','gpt-6-astra'])]:'builder-session'},'codex',f.paths.sessionsDirectory);f.append({type:'boundary'});fail(componentDevelopmentRead(f),/incomplete preparation|mixed preparation|canonical report|independent review/);});
 await t.test('RC1 permitted source edit does not require old bytes as current source',()=>{reset();fs.appendFileSync(file(f,'scripts/enterprise/verify.mjs'),'\n// allowed edit\n');const r=inspect();assert.deepEqual(r.changedPaths,['scripts/enterprise/verify.mjs']);assert.equal(r.targetLaunchAuthority,false);});
 await t.test('RC2 checkpoint change after await refuses readonly',()=>{reset();const path=file(f,'evidence/continuation-checkpoint.json'),hook=componentHook(f,'continuation-await',"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const read=fs.readFileSync;let n=0;fs.readFileSync=function(p,...args){const b=read(p,...args);return String(p)==="+JSON.stringify(path)+"&&++n>=2?Buffer.concat([b,Buffer.from(' ')]):b;};syncBuiltinESMExports();");fail(componentDevelopmentRead(f,['--inspect-component-development'],[hook]),/restart concurrent reference/);});
 // Rebind deliberately modified fixtures as a new synthetic review so these
 // cases reach semantic history checks rather than just raw-hash rejection.
 const rebind=()=>{const m=ok(spawnSync(process.execPath,['--input-type=module','-e',"import {inputs} from './scripts/enterprise/evidence.mjs';console.log(JSON.stringify(inputs(process.cwd())));"],{cwd:f.root,env:f.env,encoding:'utf8'}));put(file(f,'evidence/continuation-inputs.json'),m);rewriteRestartAttestation(f,a=>{a.planSha256=hash(fs.readFileSync(file(f,'work/enterprise/plan.json')));a.reviewInputsDigest=m.digest;a.reviewInputsManifest.sha256=hash(fs.readFileSync(file(f,a.reviewInputsManifest.path)));const raw=fs.readFileSync(file(f,a.continuationCheckpoint.path));a.continuationCheckpoint.sha256=hash(raw);a.continuationCheckpoint.bytes=raw.length;});};
 for(const [key,edit]of [['preparationRestart',p=>p.preparationRestart.currentApprovals=['forged']],['historicalRuntime',p=>p.historicalRuntime={version:'forged'}],['sourceCheckpoint',p=>p.componentContinuation.sourceCheckpoint.sha256='0'.repeat(64)]])await t.test('RC2 rehashed review cannot transfer frozen '+key,()=>{reset();mutate(f,'work/enterprise/plan.json',edit);rebind();fail(componentDevelopmentRead(f),/continuation frozen|continuation inherited checkpoint/);});
 for(const [name,edit,re]of [['extra checkpoint authority',c=>c.force=true,/continuation checkpoint fields/],['duplicated predecessor',c=>c.references[1]=c.references[0],/continuation duplicate reference/],['transferred approvals',c=>c.currentApprovals=['forged'],/continuation historical approvals/],['writer stopped claim',c=>c.allWritersStopped=true,/continuation checkpoint allWritersStopped/]])await t.test('RC2 rehashed checkpoint rejects '+name,()=>{reset();mutate(f,'evidence/continuation-checkpoint.json',edit);rebind();fail(componentDevelopmentRead(f),re);});
 await t.test('RC2 R authority cannot enter Q descriptor constructor',()=>{reset();const code=String.raw`import fs from 'node:fs';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';const url=pathToFileURL(resolve('scripts/enterprise/runtime-preparation.mjs'));let source=fs.readFileSync(url,'utf8');source=source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g,(_,q,p)=>'from '+JSON.stringify(new URL(p,url).href)).replaceAll('import.meta.url',JSON.stringify(url.href));const m=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {readComponentDescriptorAuthority};').toString('base64'));await m.readComponentDescriptorAuthority(process.cwd());`;const before=tree(f.temporary),r=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:f.root,env:f.env,encoding:'utf8',maxBuffer:4e6});fail(r,/R semantic descriptor route not implemented/);assert.deepEqual(tree(f.temporary),before);});
});

// Synthetic orchestration history stays in this fixture. The production guard
// still obtains its context from the real registered fixture runtime.
async function amendedContinuationFixture(t){
 const f=await componentContinuationFixture(t),ref=path=>{const b=fs.readFileSync(file(f,path));return {path,sha256:hash(b),bytes:b.length};};
 const approve=(iteration,replace=false)=>{
  const plan=read(file(f,'work/enterprise/plan.json')),entry=plan.componentContinuation;
  const m=ok(spawnSync(process.execPath,['--input-type=module','-e',"import {inputs} from './scripts/enterprise/evidence.mjs';console.log(JSON.stringify(inputs(process.cwd())));"],{cwd:f.root,env:f.env,encoding:'utf8'}));
  const path=`evidence/amendment-inputs-${iteration}.json`;put(file(f,path),m);
  const a={...f.restartAttestation,iteration,planSha256:ref('work/enterprise/plan.json').sha256,contractSha256:ref(entry.contract).sha256,reviewInputsDigest:m.digest,reviewInputsManifest:{path,sha256:ref(path).sha256}};
  const text=fenced('enterprise-preparation-restart-attestation',a);
  if(replace){for(const r of f.records.filter(r=>r.type==='phase_complete'&&r.step==='review-architecture'&&r.iteration===iteration))r.content=text;f.append({type:'boundary'});put(join(f.run.reportsAbs,'enterprise-02-review.md'),text+'\n');}
  else{phases(f,'review-architecture',iteration,text);f.context('build-foundation',iteration+1);}
  f.restartAttestation=a;
  for(const r of f.records.filter(r=>r.type==='step_start'))r.providerOptions.codex.permissionControl='takt';f.append({type:'boundary'});
 };
 put(file(f,'.takt/config.yaml'),'reviewed: old\n');approve(2,true);const oldConfig=ref('.takt/config.yaml');put(file(f,'.takt/config.yaml'),'reviewed: new\n');
 const snapshot=iteration=>{
  const paths=['.takt/config.yaml','scripts/enterprise/runtime-preparation.mjs','scripts/enterprise/preparation-producer-linux.c','tests/enterprise/rejected-regeneration.test.mjs','work/enterprise/plan.json','work/enterprise/COMPONENT_CONTINUATION.md',join(f.run.reportsAbs,'enterprise-02-review.md')];
  const entries=paths.map((path,i)=>{const b=fs.readFileSync(path.startsWith('/')?path:file(f,path)),copy=`evidence/amendment-entry-${iteration}/${i}`;put(file(f,copy),b.toString());return {path,copy,sha256:hash(b),bytes:b.length};});
  const path=`evidence/amendment-entry-${iteration}.json`;put(file(f,path),{schemaVersion:1,runSlug:f.run.slug,entries});return {path,entries};
 };
 const e4=snapshot(4),config=ref('.takt/config.yaml'),projection={service_tier:'fast',features:{fast_mode:true}};
 const c4={schemaVersion:1,kind:'REASSESSMENT_DATA_NOT_AUTHORITY',runSlug:f.run.slug,iteration:4,entrySnapshot:e4.path,references:e4.entries,reviewedConfig:{sha256:oldConfig.sha256,bytes:oldConfig.bytes},proposedConfig:config,changeActor:'UNCONFIRMED',changeReason:'UNCONFIRMED',profileProjection:{profile:'takt-fast',value:projection},actualAuthorityAccepted:false,implementationAccepted:false,focusedTests:32,fullRegressionExecuted:false,implementationTurnsConsumed:1,milestonesReset:false};
 put(file(f,'evidence/amendment4.json'),c4);mutate(f,'work/enterprise/plan.json',p=>{p.componentContinuation.reassessment={iteration:4,entrySnapshot:e4.path,checkpoint:ref('evidence/amendment4.json'),currentConfig:config,configEditable:false};p.componentContinuation.caseConditions={DS1:['independent-fixed-vectors']};});approve(5);
 const e8=snapshot(8),profile=join(f.temporary,'provider.toml');put(profile,'[profiles.takt-fast]\nservice_tier="fast"\n[profiles.takt-fast.features]\nfast_mode=true\n');const st=fs.statSync(profile),b=fs.readFileSync(profile);
 const c8={schemaVersion:1,kind:'INTEGRATION_REASSESSMENT_DATA_NOT_AUTHORITY',runSlug:f.run.slug,iteration:8,entrySnapshot:e8.path,references:e8.entries,previousReassessment:read(file(f,'work/enterprise/plan.json')).componentContinuation.reassessment,implementationTurnsConsumed:3,missedMilestone:{name:'M1',dueCumulativeTurn:2,status:'MISSED'},conditions:[{id:'DS1',condition:'independent-fixed-vectors',status:'NOT_ACCEPTED'}],existingGuardComplete:false,semanticRouteImplemented:false,writerImplemented:false,implementationAccepted:false,productVerified:false,profileSource:{kind:'NON_SECRET_PROFILE_SOURCE_BINDING_NOT_ACTIVATION',path:profile,sha256:hash(b),bytes:b.length,identity:{device:st.dev,inode:st.ino},profile:'takt-fast',projection,activationProven:false}};
 put(file(f,'evidence/amendment8.json'),c8);mutate(f,'work/enterprise/plan.json',p=>p.componentContinuation.integrationReassessment={iteration:8,entrySnapshot:e8.path,checkpoint:ref('evidence/amendment8.json'),implementationTurnsConsumed:3,previousM1DueTurn:2,previousM1Status:'MISSED'});put(file(f,'work/enterprise/COMPONENT_CONTINUATION.md'),'## Occurrence8 — synthetic amended contract\n');approve(9);
 f.amendmentApprove=()=>approve(9,true);f.profile=profile;f.amendmentRef=ref;return f;
}
test('component-development-schema4-amendment-checkpoints',async t=>{
 const f=await amendedContinuationFixture(t),reset=restorePoint(f);
 const inspect=()=>{const r=componentDevelopmentRead(f);assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 await t.test('RC1 amended actual fixture reader binds both checkpoints with absent activation options',()=>{const r=inspect();for(const p of ['evidence/amendment4.json','evidence/amendment8.json','.takt/config.yaml'])assert.ok(r.references.some(r=>r.path===p));assert.equal(r.targetLaunchAuthority,false);assert.equal(r.nativeAcceptance,false);});
 const rehash=(path,edit)=>{mutate(f,path,edit);mutate(f,'work/enterprise/plan.json',p=>p.componentContinuation[path.endsWith('4.json')?'reassessment':'integrationReassessment'].checkpoint=f.amendmentRef(path));f.amendmentApprove();};
 for(const [label,edit,re]of [
  ['wrong run',c=>c.runSlug='other',/amendment run/],['future occurrence',c=>c.iteration=10,/amendment iteration/],['duplicate reference',c=>c.references.push(c.references[0]),/duplicate reference/],['missing config',c=>c.references=c.references.filter(r=>r.path!=='.takt/config.yaml'),/missing reference/],['conflicting copy',c=>c.references[0].copy=c.references[1].copy,/duplicate copy/],['rehashed source',c=>{const r=c.references.find(r=>r.path==='scripts/enterprise/runtime-preparation.mjs');put(file(f,r.copy),'forged');r.sha256=hash('forged');r.bytes=6;},/conflicting frozen reference/],['extra authority',c=>c.authority=true,/checkpoint fields/],['accepted condition',c=>c.conditions[0].status='ACCEPTED',/amendment conditions/],['replaced prior checkpoint',c=>c.previousReassessment.checkpoint.sha256='0'.repeat(64),/retained reassessment/],['profile model override',c=>c.profileSource.projection.model='other',/profile overrides/],['profile permission override',c=>c.profileSource.projection.features.permissionControl='none',/profile overrides/],['profile value',c=>c.profileSource.projection.service_tier='other',/profile overrides/],['profile identity',c=>c.profileSource.identity.inode++,/profile identity/],['profile activation claim',c=>c.profileSource.activationProven=true,/true !== false/]
 ])await t.test('RC2 rehashed integration rejects '+label,()=>{reset();rehash('evidence/amendment8.json',edit);fail(componentDevelopmentRead(f),re);});
 await t.test('RC2 rehashed reassessment rejects retroactive acceptance',()=>{reset();rehash('evidence/amendment4.json',c=>c.actualAuthorityAccepted=true);fail(componentDevelopmentRead(f),/amendment actualAuthorityAccepted/);});
 await t.test('RC2 config byte drift refuses readonly',()=>{reset();fs.appendFileSync(file(f,'.takt/config.yaml'),' ');fail(componentDevelopmentRead(f),/unreviewed input/);});
 await t.test('RC2 profile unrelated byte drift refuses readonly',()=>{reset();fs.appendFileSync(f.profile,'# unrelated\n');fail(componentDevelopmentRead(f),/profile length/);});
 for(const [key,value]of [['fastMode',false],['configProfile','other'],['permissionControl','none']])await t.test('RC2 recorded incompatible '+key,()=>{reset();f.records.findLast(r=>r.type==='step_start').providerOptions.codex[key]=value;f.append({type:'boundary'});fail(componentDevelopmentRead(f),/amendment actual|amendment permission/);});
 await t.test('RC1 recorded compatible options remain separate from native authority',()=>{reset();Object.assign(f.records.findLast(r=>r.type==='step_start').providerOptions.codex,{fastMode:true,configProfile:'takt-fast'});f.append({type:'boundary'});assert.equal(inspect().targetLaunchAuthority,false);});
 for(const target of ['evidence/amendment4.json','evidence/amendment8.json'])await t.test('RC2 rereads '+target+' across await',()=>{reset();const path=file(f,target),hook=componentHook(f,'amendment-race',"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const read=fs.readFileSync;let n=0;fs.readFileSync=function(p,...a){const b=read(p,...a);return String(p)==="+JSON.stringify(path)+"&&++n>=3?Buffer.concat([b,Buffer.from(' ')]):b;};syncBuiltinESMExports();");fail(componentDevelopmentRead(f,['--inspect-component-development'],[hook]),/concurrent reference/);});
 await t.test('RC2 profile source reread refuses transient replacement',()=>{reset();const hook=componentHook(f,'profile-race',"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const read=fs.readFileSync;let n=0;fs.readFileSync=function(p,...a){const b=read(p,...a);return String(p)==="+JSON.stringify(f.profile)+"&&++n>=3?Buffer.concat([b,Buffer.from(' ')]):b;};syncBuiltinESMExports();");fail(componentDevelopmentRead(f,['--inspect-component-development'],[hook]),/profile length/);});
 await t.test('RC2 missing amendment cannot fall back to old guard',()=>{reset();mutate(f,'work/enterprise/plan.json',p=>delete p.componentContinuation.reassessment);f.amendmentApprove();fail(componentDevelopmentRead(f),/amendment required by reviewed contract/);});
 await t.test('RC2 removing both amendments cannot downgrade reviewed contract',()=>{reset();mutate(f,'work/enterprise/plan.json',p=>{delete p.componentContinuation.reassessment;delete p.componentContinuation.integrationReassessment;});f.amendmentApprove();fail(componentDevelopmentRead(f),/amendment required by reviewed contract/);});
 await t.test('RC2 rehashed entry cannot substitute historical reviewed plan',()=>{reset();const cp=read(file(f,'evidence/amendment8.json')),r=cp.references.find(r=>r.path==='work/enterprise/plan.json');fs.appendFileSync(file(f,r.copy),' ');r.sha256=hash(fs.readFileSync(file(f,r.copy)));r.bytes++;put(file(f,'evidence/amendment8.json'),cp);mutate(f,cp.entrySnapshot,e=>e.entries[e.entries.findIndex(e=>e.path===r.path)]=r);rehash('evidence/amendment8.json',()=>{});fail(componentDevelopmentRead(f),/amendment historical plan/);});
 await t.test('RC2 old review cannot authorize amended inputs',()=>{reset();const old=f.records.find(r=>r.type==='phase_complete'&&r.step==='review-architecture'&&r.iteration===5).content;for(const r of f.records.filter(r=>r.type==='phase_complete'&&r.step==='review-architecture'&&r.iteration===9))r.content=old;f.append({type:'boundary'});put(join(f.run.reportsAbs,'enterprise-02-review.md'),old+'\n');fail(componentDevelopmentRead(f),/restart iteration/);});
 await t.test('RC2 profile file identity must match even with identical bytes',()=>{reset();const hook=componentHook(f,'profile-identity',"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const stat=fs.lstatSync;fs.lstatSync=function(p,...a){const s=stat(p,...a);if(String(p)==="+JSON.stringify(f.profile)+")s.ino++;return s;};syncBuiltinESMExports();");fail(componentDevelopmentRead(f,['--inspect-component-development'],[hook]),/profile identity/);});
});

// Independent RSP1 vector, followed by the actual retained process composition.
// These are portable progress checks, not DS/QV acceptance or native authority.
test('producer-semantic-reservation-wire',async t=>{
 const f=await fixture(t),source=fs.realpathSync('scripts/enterprise/preparation-producer-linux.c');
 const hex='52535031010101000000000000000001'+'000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'+'11'.repeat(32)+'22'.repeat(32)+'33'.repeat(32)+'44'.repeat(32)+'55'.repeat(32);
 const vector=Buffer.from(hex,'hex');assert.equal(vector.length,208);
 const program=`#define main helper_main\n#include ${JSON.stringify(source)}\n#undef main\nint main(void){unsigned char v[208]={${[...vector].join(',')}},r[209];memcpy(r,v,208);r[5]=2;if(pd_rsp_reply(v,r,208)<0)return 1;for(unsigned i=0;i<208;i++){r[i]^=1;if(pd_rsp_reply(v,r,208)==0)return 2;r[i]^=1;}for(unsigned n=0;n<208;n++)if(pd_rsp_reply(v,r,n)==0)return 3;if(pd_rsp_reply(v,r,209)==0)return 4;puts("208 mutations and 209 length boundaries rejected");return 0;}\n`;
 const src=join(f.temporary,'rsp.c'),bin=join(f.temporary,'rsp');put(src,program);
 const build=spawnSync('cc',['-std=c11','-Wall','-Wextra','-Werror','-pedantic',src,'-o',bin],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
 await t.test('independent fixed RSP1 vector and every single-byte response mutation',()=>{const r=spawnSync(bin,[],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'208 mutations and 209 length boundaries rejected\n');});
 const code=String.raw`import fs from 'node:fs';import assert from 'node:assert/strict';const source=fs.readFileSync('scripts/enterprise/runtime-preparation.mjs','utf8');const body=source.slice(source.indexOf('function decodeRProtocolFrame('),source.indexOf('// Only this private composition'));const decode=new Function('assert',body+';return decodeRProtocolFrame;')(assert);const raw=Buffer.from(process.argv[1],'hex'),x=decode(raw);assert.equal(x.sequence,1n);assert.equal(x.stage,1);assert.equal(x.direction,1);assert.equal(x.invocation.toString('hex'),'11'.repeat(32));assert.equal(x.generation.toString('hex'),'22'.repeat(32));assert.equal(x.authority.toString('hex'),'55'.repeat(32));for(const [offset,value]of [[0,0],[4,2],[5,0],[5,4],[6,0],[6,6],[7,1],[15,0]]){const b=Buffer.from(raw);b[offset]=value;assert.throws(()=>decode(b));}for(const b of [raw.subarray(1),Buffer.concat([raw,Buffer.from([0])])])assert.throws(()=>decode(b));console.log('fixed vector decoded; invalid headers and lengths refused');`;
 await t.test('JS independently decodes the fixed vector and rejects invalid headers',()=>{const r=spawnSync(process.execPath,['--input-type=module','-e',code,hex],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);});
});

test('component-development-r-retained-reservation',async t=>{
 const f=await amendedContinuationFixture(t),actual=read('work/enterprise/plan.json').componentContinuation;
 fs.copyFileSync(new URL('../../scripts/enterprise/preparation-producer-linux.c',import.meta.url),file(f,'scripts/enterprise/preparation-producer-linux.c'));
 mutate(f,'work/enterprise/plan.json',p=>{for(const key of ['scope','recordSchemaVersion','recordPurpose','decisionSchemaVersion','restartCases','deliveryAmendment'])p.componentContinuation[key]=structuredClone(actual[key]);});f.amendmentApprove();
 const reset=restorePoint(f);
 const code=String.raw`
import fs from 'node:fs';import assert from 'node:assert/strict';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {hash,inputs} from './scripts/enterprise/evidence.mjs';
process.setUncaughtExceptionCaptureCallback(e=>{console.error(e.message);console.error(JSON.stringify({actual:e.actual,expected:e.expected,diagnostic:e.diagnostic}));process.exitCode=1;});
const scenario=process.argv[1],url=pathToFileURL(resolve('scripts/enterprise/runtime-preparation.mjs'));let source=fs.readFileSync(url,'utf8');source=source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g,(_,q,p)=>'from '+JSON.stringify(new URL(p,url).href)).replaceAll('import.meta.url',JSON.stringify(url.href));
const m=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {constructComponentDescriptor,readComponentDescriptorAuthority,reserveOwnedComponentDescriptor,abortOwnedComponentReservation,closeComponentDescriptor,rProtocolCompatibility};').toString('base64'));
const before=inputs(process.cwd()),authority=await m.readComponentDescriptorAuthority(process.cwd()),plan=JSON.parse(fs.readFileSync('work/enterprise/plan.json')),p=plan.componentContinuation,ref=r=>({path:r.path,sha256:hash(fs.readFileSync(r.path)),bytes:fs.statSync(r.path).size});
const scope={schemaVersion:p.schemaVersion,runSlug:p.runSlug,scope:p.scope,recordSchemaVersion:p.recordSchemaVersion,recordPurpose:p.recordPurpose,decisionSchemaVersion:p.decisionSchemaVersion,caseConditions:p.caseConditions,restartCases:p.restartCases,sourceCheckpoint:ref(p.sourceCheckpoint),predecessorCheckpoint:ref({path:p.predecessorCheckpoint}),reassessmentCheckpoint:ref(p.reassessment.checkpoint),integrationCheckpoint:ref(p.integrationReassessment.checkpoint)};
assert.equal(authority.kind,'R_COMPONENT_DESCRIPTOR_AUTHORITY_DATA');assert.equal(authority.bindings.scopeDefinition,hash(JSON.stringify(scope)));assert.equal(authority.bindings.runSlug,p.runSlug);
const h=await m.constructComponentDescriptor(process.cwd()),base=resolve(h.diagnosticPath);let captured,seen=[],changed=false,owner;
const spawn=cp.spawn;cp.spawn=function(...args){assert.equal(args[2].argv0,'/bridge');assert.equal(args[2].cwd,'/');assert.deepEqual(args[2].env,{LANG:'C',LC_ALL:'C'});if(scenario==='argv-mismatch'){args[2].argv0='/wrong';changed=true;}const child=spawn(...args);captured=child;const channel=child.stdio[8];if(channel){channel.on('data',raw=>{if(raw.length!==208)return;seen.push(raw[6]);if(scenario==='candidate-stage'+raw[6]){const path=base+'/descriptor.bin',b=fs.readFileSync(path);b[b.length-1]^=1;fs.writeFileSync(path,b);changed=true;}});const write=channel.write.bind(channel);channel.write=function(raw,...rest){if(scenario==='c-source-stage'+raw[6]){const path=base+'/expected.bin',b=fs.readFileSync(path);b[b.length-1]^=1;fs.writeFileSync(path,b);changed=true;}if(scenario==='eof-stage'+raw[6]){changed=true;channel.end();return true;}if(scenario==='short-reply'){changed=true;channel.end(raw.subarray(0,100));return true;}if(scenario==='reply-stage'+raw[6]){raw=Buffer.from(raw);raw[80]^=1;changed=true;}if(scenario==='duplicate-reply'&&!changed){raw=Buffer.concat([raw,raw]);changed=true;}return write(raw,...rest);};}return child;};syncBuiltinESMExports();
try{
 if(scenario==='positive'){
  owner=await m.reserveOwnedComponentDescriptor(h);assert.equal(owner.launchAuthority,false);assert.equal(owner.reviewReady,false);assert.deepEqual(seen,[1,2]);assert.equal(captured.exitCode,null);assert.ok(fs.existsSync(base+'/admission/prepared.commit'));assert.ok(!fs.existsSync(base+'/admission/admitted.commit'));
  const pinned=fs.readFileSync(base+'/descriptor/descriptor');assert.deepEqual(pinned,h.wire);
  await assert.rejects(m.abortOwnedComponentReservation({...owner}),/retained reservation handle/);assert.throws(()=>m.closeComponentDescriptor(h),/retained bridge must close/);await assert.rejects(m.reserveOwnedComponentDescriptor(h),/reservation one use/);
  const result=await m.abortOwnedComponentReservation(owner);assert.equal(result.status,1);assert.equal(result.signal,null);assert.equal(result.failure,null);assert.match(result.stderr,/cancel=0 pinClose=0 stage=5/);assert.ok(fs.existsSync(base+'/admission/closed.commit'));assert.equal(captured.exitCode,1);assert.notEqual(result.events[0].challenge,result.events[1].challenge);await assert.rejects(m.abortOwnedComponentReservation(owner),/abort one use/);
  const image=fs.readFileSync(base+'/helper'),compatibility=JSON.parse(fs.readFileSync(base+'/compatibility.json'));assert.equal(compatibility.abi,'arm64');image[4]^=1;assert.throws(()=>m.rProtocolCompatibility(image,compatibility.hostVersion),/Mach-O ABI/);
  console.log(JSON.stringify({scenario,seen,result,scope:authority.bindings.scopeDefinition,positive:true}));
 }else{
  let error;try{await m.reserveOwnedComponentDescriptor(h);}catch(e){error=e;}assert.ok(error,'negative must refuse');assert.ok(changed);assert.equal(error.diagnostic.status,scenario==='argv-mismatch'?64:1);assert.ok(!fs.existsSync(base+'/admission/prepared.commit'));assert.ok(!fs.existsSync(base+'/descriptor/descriptor'));assert.ok(!fs.existsSync(base+'/admission/admitted.commit'));assert.deepEqual(seen,scenario==='argv-mismatch'?[]:scenario.endsWith('2')?[1,2]:[1]);
  if(scenario.startsWith('candidate'))assert.match(error.message,/owned source changed/);else assert.match(error.diagnostic.stderr,scenario==='argv-mismatch'?/R_BRIDGE_ARGV_REFUSED/:/R_BRIDGE_ERROR/);
  console.log(JSON.stringify({scenario,seen,refusal:error.message,diagnostic:error.diagnostic}));
 }
 assert.deepEqual(inputs(process.cwd()),before);
}finally{m.closeComponentDescriptor(h);}
`;
 for(const scenario of ['positive','candidate-stage1','candidate-stage2','c-source-stage1','c-source-stage2','reply-stage1','reply-stage2','duplicate-reply','eof-stage1','eof-stage2','short-reply','argv-mismatch'])await t.test('R retained reservation '+scenario,()=>{reset();const r=spawnSync(process.execPath,['--input-type=module','-e',code,scenario],{cwd:f.root,env:f.env,encoding:'utf8',timeout:120000,maxBuffer:8e6});assert.equal(r.status,0,r.stderr.slice(-5000));const result=JSON.parse(r.stdout);t.diagnostic(JSON.stringify(result));});
});

test('component-development-r-retained-publication',async t=>{
 const f=await amendedContinuationFixture(t),actual=read('work/enterprise/plan.json').componentContinuation;
 const originalC=fs.readFileSync(new URL('../../scripts/enterprise/preparation-producer-linux.c',import.meta.url),'utf8');
 fs.writeFileSync(file(f,'scripts/enterprise/preparation-producer-linux.c'),originalC);
 mutate(f,'work/enterprise/plan.json',p=>{for(const key of ['scope','recordSchemaVersion','recordPurpose','decisionSchemaVersion','restartCases','deliveryAmendment'])p.componentContinuation[key]=structuredClone(actual[key]);});f.amendmentApprove();
 const reset=restorePoint(f);
 const code=String.raw`
import fs from 'node:fs';import assert from 'node:assert/strict';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {inputs} from './scripts/enterprise/evidence.mjs';
process.setUncaughtExceptionCaptureCallback(e=>{console.error(e.message);console.error(JSON.stringify({actual:e.actual,expected:e.expected,diagnostic:e.diagnostic}));process.exitCode=1;});
const scenario=process.argv[1],stage=scenario==='primary-cleanup'?4:Number(scenario.slice(-1)),url=pathToFileURL(resolve('scripts/enterprise/runtime-preparation.mjs'));let source=fs.readFileSync(url,'utf8');source=source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g,(_,q,p)=>'from '+JSON.stringify(new URL(p,url).href)).replaceAll('import.meta.url',JSON.stringify(url.href));
const m=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {constructComponentDescriptor,reserveOwnedComponentDescriptor,publishOwnedComponentReservation,abortOwnedComponentReservation,closeComponentDescriptor};').toString('base64'));
const before=inputs(process.cwd()),h=await m.constructComponentDescriptor(process.cwd()),base=resolve(h.diagnosticPath);let captured,seen=[],injected=false,prior,originalConfig;const drift=()=>{originalConfig=fs.readFileSync('.takt/config.yaml');fs.appendFileSync('.takt/config.yaml','\n# injected drift\n');injected=true;};
const spawn=cp.spawn;cp.spawn=function(...args){const child=spawn(...args);captured=child;if(scenario==='completion-drift')child.on('close',drift);const channel=child.stdio[8];if(channel){channel.on('data',raw=>{if(raw.length!==208)return;const at=raw[6];seen.push(at);if(at>=3){assert.ok(fs.existsSync(base+'/admission/prepared.commit'));assert.equal(fs.existsSync(base+'/admission/admitted.commit'),at>=4,'challenge follows durable admission');}if(at===stage&&scenario.startsWith('authority'))drift();if(at===stage&&scenario.startsWith('candidate')){const p=base+'/descriptor.bin',b=fs.readFileSync(p);b[b.length-1]^=1;fs.writeFileSync(p,b);injected=true;}if(at===stage&&scenario.startsWith('helper-death')){injected=true;child.kill('SIGKILL');}});
const write=channel.write.bind(channel);channel.write=function(raw,...rest){const at=raw[6];if(at===stage){
 if((scenario.startsWith('expected')||scenario==='primary-cleanup')){const p=base+'/expected.bin',b=fs.readFileSync(p);b[b.length-1]^=1;fs.writeFileSync(p,b);injected=true;}
 if(scenario.startsWith('checkpoint')){const p=base+'/admission/'+(at>=4?'admitted':'prepared')+'.commit',b=fs.readFileSync(p);fs.renameSync(p,p+'.original');fs.writeFileSync(p,b);fs.unlinkSync(p+'.original');injected=true;}
 if(scenario.startsWith('descriptor-pin')){const p=base+'/descriptor/descriptor',b=fs.readFileSync(p);b[b.length-1]^=1;fs.writeFileSync(p,b);injected=true;}
 if(scenario.startsWith('eof')){injected=true;channel.end();return true;}
 if(scenario.startsWith('timeout')){injected=true;return true;}
 if(scenario.startsWith('short-reply')){injected=true;channel.end(raw.subarray(0,100));return true;}
 if(scenario.startsWith('old-reply')){injected=true;raw=prior;}
 if(scenario.startsWith('future-reply')){injected=true;raw=Buffer.from(raw);raw.writeBigUInt64BE(raw.readBigUInt64BE(8)+1n,8);}
 if(scenario.startsWith('duplicate')){injected=true;raw=Buffer.concat([raw,raw]);}
 }prior=Buffer.from(raw);return write(raw,...rest);};}return child;};syncBuiltinESMExports();
try{
 const owner=await m.reserveOwnedComponentDescriptor(h);assert.equal(captured.exitCode,null);assert.equal(owner.launchAuthority,false);assert.equal(owner.reviewReady,false);
 await assert.rejects(m.publishOwnedComponentReservation({...owner}),/retained reservation handle/);
 const pending=m.publishOwnedComponentReservation(owner);await assert.rejects(m.publishOwnedComponentReservation(owner),/publication one use/);await assert.rejects(m.abortOwnedComponentReservation(owner),/abort one use/);
 let result,rejection;try{result=await pending;}catch(e){rejection=e;result=e.diagnostic;}if(scenario==='completion-drift'){assert.ok(rejection);assert.match(rejection.message,/owned source changed: .*\.takt\/config\.yaml/);assert.equal(result.status,0);assert.ok(result.stdout.includes('R_PUBLISHED'));}else assert.ok(!rejection,rejection?.message);
 if(scenario==='positive'){
  assert.deepEqual(seen,[1,2,3,4,5]);assert.equal(result.status,0);assert.equal(result.signal,null);assert.equal(result.failure,null);assert.equal(result.stdout,'R_RESERVED\nR_PUBLISHED\n');
  assert.match(result.stderr,/attempted=1 delivery=2 closure=0 sender=0 observation=0 statusValid=1 status=0/);assert.ok(fs.existsSync(base+'/admission/admitted.commit'));assert.ok(fs.existsSync(base+'/admission/closed.commit'));assert.equal(new Set(result.events.map(e=>e.challenge)).size,5);
 }else if(scenario!=='completion-drift'){
  const faultSource=['short-go','lost-child-result','checkpoint-close','admission-unlock','go-close','closure-write','reservation-replace','lost-owner-result','primary-cleanup','admission-interrupt'].includes(scenario);
  assert.ok(injected||faultSource,'fault reached intended boundary');assert.notEqual(result.status,0);assert.ok(!result.stdout.includes('R_PUBLISHED'));assert.equal(result.nativeAcceptance,false);assert.equal(result.launchAuthority,false);
  if(!faultSource){assert.deepEqual(seen,Array.from({length:stage},(_,i)=>i+1));assert.equal(fs.existsSync(base+'/admission/admitted.commit'),stage>=4);}
  if(scenario==='reservation-replace'){assert.deepEqual(seen,[1,2]);assert.ok(!fs.existsSync(base+'/admission/admitted.commit'));}
  if(scenario.startsWith('authority'))assert.match(result.failure,/owned source changed: .*\.takt\/config\.yaml/);
  if(scenario.startsWith('candidate'))assert.match(result.failure,/owned source changed/);
  if(scenario==='lost-owner-result'){assert.equal(result.status,73);assert.deepEqual(seen,[1,2,3,4,5]);assert.match(result.stderr,/delivery=2.*statusValid=1 status=0/);}
  if(scenario==='admission-interrupt'){assert.equal(result.status,75);assert.deepEqual(seen,[1,2,3]);assert.ok(fs.existsSync(base+'/admission/admitted.intent'));assert.ok(!fs.existsSync(base+'/admission/admitted.commit'));assert.ok(!fs.existsSync(base+'/admission/closed.commit'));}
  if(scenario==='primary-cleanup'){assert.deepEqual(seen,[1,2,3,4]);assert.match(result.stderr,/primary=70 checkpoint=5 unlock=5/);assert.match(result.stderr,/attempted=1 delivery=0/);}
  if(scenario==='short-go'){assert.match(result.stderr,/attempted=1 delivery=1/);assert.match(result.stderr,/statusValid=1 status=18176/);}
  if(scenario==='lost-child-result')assert.match(result.stderr,/delivery=2.*statusValid=1 status=18432/);
  if(scenario==='checkpoint-close')assert.match(result.stderr,/checkpoint=5/);
  if(scenario==='admission-unlock')assert.match(result.stderr,/unlock=5/);
  if(scenario==='go-close')assert.match(result.stderr,/attempted=1 delivery=1/);
  if(scenario==='closure-write')assert.match(result.stderr,/closure=5/);
 }
 if(originalConfig)fs.writeFileSync('.takt/config.yaml',originalConfig);assert.deepEqual(inputs(process.cwd()),before);console.log(JSON.stringify({scenario,seen,injected,result}));
}finally{m.closeComponentDescriptor(h);}
`;
 const scenarios=['positive',...[3,4,5].flatMap(n=>['authority','candidate','expected','checkpoint','descriptor-pin','eof','short-reply','old-reply','future-reply','duplicate','helper-death'].map(s=>s+n)),'timeout4','short-go','lost-child-result','checkpoint-close','admission-unlock','go-close','closure-write','reservation-replace','lost-owner-result','completion-drift','primary-cleanup','admission-interrupt'];
 for(const scenario of scenarios)await t.test('R retained publication '+scenario,()=>{
  reset();let c=originalC;
  // These compile-time fixture mutations exercise real storage/pipe syscalls;
  // there is no production runtime fault selector or legacy-owner fallback.
  const replacement={
   'admission-interrupt':['int fd = openat(dir, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);','if(!strcmp(name,"admitted.commit"))_exit(75);\n    int fd = openat(dir, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);'],
   'primary-cleanup':['if(pd_checkpoint_close(&checkpoint)<0&&!s->checkpoint_error)s->checkpoint_error=errno;','if(pd_checkpoint_close(&checkpoint)<0&&!s->checkpoint_error)s->checkpoint_error=errno; else {s->checkpoint_error=EIO;s->unlock_error=EIO;}'],
   'reservation-replace':['pd_semantic_publication(&s);','char saved[PD_RECORD_SIZE]; if(pd_read_record(6,"prepared.commit",saved)!=1)return 1; int swapped=openat(6,"swap",O_CREAT|O_EXCL|O_WRONLY,0600); if(swapped<0||write(swapped,saved,sizeof(saved))!=sizeof(saved)||close(swapped)<0||renameat(6,"swap",6,"prepared.commit")<0)return 1; pd_semantic_publication(&s);'],
   'lost-owner-result':['{puts("R_PUBLISHED");fflush(stdout);}','{_exit(73);}'],
   'short-go':['ssize_t n = write(fd, frame, sizeof(frame));','ssize_t n = write(fd, frame, 7);'],
   'lost-child-result':['_exit(ok?0:71);','_exit(ok?72:71);'],
   'checkpoint-close':['if(pd_checkpoint_close(&checkpoint)<0&&!s->checkpoint_error)s->checkpoint_error=errno;','if(pd_checkpoint_close(&checkpoint)<0&&!s->checkpoint_error)s->checkpoint_error=errno; else if(s->publication_attempted)s->checkpoint_error=EIO;'],
   'admission-unlock':['if(flock(s->admission_dir,LOCK_UN)<0)s->unlock_error=errno;','if(flock(s->admission_dir,LOCK_UN)<0)s->unlock_error=errno; else s->unlock_error=EIO;'],
   'go-close':['if (close(fd) < 0 && !error) error = errno;\n    if (error) return pd_error(error);\n    *delivery = PD_GO_COMPLETE;','if (close(fd) < 0 && !error) error = errno;\n    if (!error) error = EIO;\n    if (error) return pd_error(error);\n    *delivery = PD_GO_COMPLETE;'],
   'closure-write':['int fd = openat(dir, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);','if(!strcmp(name,"closed.intent"))return pd_error(EIO);\n    int fd = openat(dir, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);']
  }[scenario];
  if(replacement){assert.equal(c.split(replacement[0]).length,2);c=c.replace(...replacement);fs.writeFileSync(file(f,'scripts/enterprise/preparation-producer-linux.c'),c);f.amendmentApprove();}
  const r=spawnSync(process.execPath,['--input-type=module','-e',code,scenario],{cwd:f.root,env:f.env,encoding:'utf8',timeout:120000,maxBuffer:8e6});assert.equal(r.status,0,r.stderr.slice(-6000));t.diagnostic(r.stdout.trim());
 });
});

// R typed evidence fixture: synthetic corpus and model records, actual runtime
// context/guard/child command/filesystem. Never an R checkout candidate.
async function rEvidenceFixture(t){
 const f=await amendedContinuationFixture(t),actual=read('work/enterprise/plan.json').componentContinuation;
 mutate(f,'work/enterprise/plan.json',p=>{for(const key of ['scope','recordSchemaVersion','recordPurpose','decisionSchemaVersion','restartCases','regressionCommand','caseConditions'])p.componentContinuation[key]=structuredClone(actual[key]);});
 mutate(f,'evidence/amendment8.json',c=>c.conditions=Object.entries(actual.caseConditions).flatMap(([id,cs])=>cs.map(condition=>({id,condition,status:'NOT_ACCEPTED'}))));
 mutate(f,'work/enterprise/plan.json',p=>p.componentContinuation.integrationReassessment.checkpoint=f.amendmentRef('evidence/amendment8.json'));
 const conditions=Object.entries(actual.caseConditions).flatMap(([caseId,keys])=>keys.map(conditionKey=>({caseId,conditionKey}))),bindings=conditions.map((c,i)=>({...c,variants:[{variantId:'synthetic-'+i,testPath:[{ordinal:7,name:'synthetic R corpus'},{ordinal:i+1,name:'synthetic condition '+i}],expectedBoundary:'synthetic fixture assertion',oracle:'synthetic fixture expected equality'}]}));
 for(const path of actual.regressionCommand.slice(6))put(file(f,path),"import test from 'node:test';import assert from 'node:assert/strict';test('synthetic auxiliary',()=>assert.equal(1,1));\n");
 const source="import test from 'node:test';import assert from 'node:assert/strict';\n/* R_COMPONENT_BINDINGS_V1\n"+JSON.stringify(bindings)+'\nEND_R_COMPONENT_BINDINGS */\n'+"test('synthetic R corpus',async t=>{for(let i=0;i<85;i++)await t.test('synthetic condition '+i,()=>assert.equal(i,i));});\n";
 put(file(f,'tests/enterprise/rejected-regeneration.test.mjs'),source);f.amendmentApprove();f.rBindings=bindings;return f;
}
const rEvidenceProgram=String.raw`
import fs from 'node:fs';import assert from 'node:assert/strict';import cp from 'node:child_process';import {syncBuiltinESMExports}from'node:module';import {resolve}from'node:path';import {pathToFileURL}from'node:url';
const url=pathToFileURL(resolve('scripts/enterprise/runtime-preparation.mjs'));let source=fs.readFileSync(url,'utf8');source=source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g,(_,q,p)=>'from '+JSON.stringify(new URL(p,url).href)).replaceAll('import.meta.url',JSON.stringify(url.href));
const m=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {constructRComponentEvidence,writeRComponentEvidence,readRComponentEvidenceGraph,readComponentEvidenceGraph,inspectRComponentEvidenceConsistency,rComponentScope,rComponentCoverage};').toString('base64'));
const mode=process.argv[1],run=process.argv[2],base='evidence/enterprise/component-development/'+run+'/review-evidence';
if(mode==='consistency'){for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[key]=()=>{throw Error('READONLY_SUBPROCESS');};syncBuiltinESMExports();console.log(JSON.stringify(await m.inspectRComponentEvidenceConsistency(process.cwd())));}
else if(mode==='read'||mode==='q-read'){console.log(JSON.stringify((mode==='read'?m.readRComponentEvidenceGraph:m.readComponentEvidenceGraph)(process.cwd(),run)));}
else{
 const owner=await m.constructRComponentEvidence(process.cwd());
 if(mode==='preflight'){console.log('PREFLIGHT_ONLY');}
 else if(mode==='forged'){await assert.rejects(m.writeRComponentEvidence({...owner}),/private one-use/);assert.ok(!fs.existsSync(base));console.log('FORGED_REFUSED');}
 else{
  let injected=false;const spawn=cp.spawn,write=fs.writeFileSync,rename=fs.renameSync,sync=fs.fsyncSync;
  if(mode==='interrupt')cp.spawn=function(...args){const c=spawn(...args);process.kill(process.pid,'SIGTERM');injected=true;return c;};
  if(mode==='write-failure')fs.writeFileSync=function(p,...args){if(typeof p==='number'&&!injected&&fs.existsSync(base+'/journal.json')){const j=JSON.parse(fs.readFileSync(base+'/journal.json'));if(j.events.length===1&&String(args[0]).includes('TAP version')){injected=true;throw Object.assign(new Error('synthetic stream failure'),{code:'EIO'});}}return write(p,...args);};
  if(mode==='rename-failure')fs.renameSync=function(p,...args){if(String(p).endsWith('/journal.pending')&&!injected){injected=true;throw Object.assign(new Error('synthetic rename failure'),{code:'EIO'});}return rename(p,...args);};
  if(mode==='fsync-failure')fs.fsyncSync=function(fd){if(!injected&&fs.existsSync(base+'/journal.pending')){injected=true;throw Object.assign(new Error('synthetic fsync failure'),{code:'EIO'});}return sync(fd);};
  if(mode==='lock-change')cp.spawn=function(...args){const c=spawn(...args);fs.appendFileSync(base+'/writer.lock',' ');injected=true;return c;};
  if(mode==='output-replace')cp.spawn=function(...args){const c=spawn(...args),p=base+'/invocations/1/outputs/stdout.tap';fs.renameSync(p,p+'.original');fs.writeFileSync(p,'');injected=true;return c;};
  if(mode==='request-failure')fs.writeFileSync=function(p,...args){if(!injected&&String(args[0]).includes('"historyBinding"')){injected=true;throw Object.assign(new Error('synthetic request failure'),{code:'EIO'});}return write(p,...args);};
  syncBuiltinESMExports();
  try{const result=await m.writeRComponentEvidence(owner);assert.equal(mode,'positive');assert.equal(result.reviewReady,false);assert.equal(result.provenanceAuthenticated,false);assert.equal(result.productVerified,false);assert.ok(!fs.existsSync(base+'/writer.lock'));await assert.rejects(m.writeRComponentEvidence(owner),/private one-use/);console.log(JSON.stringify(result));}
  catch(e){if(mode==='positive')throw e;assert.ok(injected||mode==='test-failure'||mode==='coverage-failure',e.message);assert.ok(fs.existsSync(base+'/writer.lock'));const journal=fs.existsSync(base+'/journal.json')?JSON.parse(fs.readFileSync(base+'/journal.json')):null;console.log(JSON.stringify({mode,injected,message:e.message,failureRecording:e.failureRecording??null,journal,fence:true,request:fs.existsSync(base+'/request.json')}));}
 }
}
`;
function runREvidence(f,mode,{readonly=false}={}){const before=readonly?tree(f.temporary):null;const r=spawnSync(process.execPath,[...(readonly?['--import',f.guardPath]:[]),'--input-type=module','-e',rEvidenceProgram,mode,f.run.slug],{cwd:f.root,env:f.env,encoding:'utf8',timeout:60000,maxBuffer:4e6});if(readonly){assert.deepEqual(tree(f.temporary),before);assert.doesNotMatch(r.stderr,/FS_MUTATION/);}return r;}
test('component-development-r-typed-evidence',async t=>{
 const f=await rEvidenceFixture(t),reset=restorePoint(f),base='evidence/enterprise/component-development/'+f.run.slug+'/review-evidence';
 const table=edit=>{const p=file(f,'tests/enterprise/rejected-regeneration.test.mjs'),raw=fs.readFileSync(p,'utf8'),rows=structuredClone(f.rBindings);edit(rows);fs.writeFileSync(p,raw.replace(JSON.stringify(f.rBindings),JSON.stringify(rows)));};
 await t.test('private full-corpus transaction uses actual seven-file subprocess and readback',()=>{const r=runREvidence(f,'positive');assert.equal(r.status,0,r.stderr);const g=JSON.parse(r.stdout);assert.equal(g.kind,'R_COMPONENT_TRANSACTION_DIAGNOSTIC');assert.equal(g.schemaVersion,2);const execution=read(file(f,base+'/invocations/1/outputs/execution.json'));assert.equal(execution.status,0);assert.equal(execution.requestedArgv.length,13);assert.equal(execution.actualArgv[0],process.execPath);assert.equal(Number(fs.readFileSync(file(f,base+'/invocations/1/outputs/stdout.tap'),'utf8').match(/^# tests (\d+)$/m)[1]),92);const q=runREvidence(f,'q-read',{readonly:true});fail(q,/component graph schema/);const r2=runREvidence(f,'read',{readonly:true});assert.equal(r2.status,0,r2.stderr);assert.equal(JSON.parse(r2.stdout).reviewReady,false);});
 const snapshot=mode=>{const files=[];const visit=p=>{for(const name of fs.readdirSync(file(f,p)).sort()){const q=p+'/'+name,st=fs.lstatSync(file(f,q));if(st.isDirectory())visit(q);else if(st.isFile()&&!st.isSymbolicLink()){const b=fs.readFileSync(file(f,q));files.push({path:q,sha256:hash(b),bytes:b.length,data:b.toString('base64')});}}};if(fs.existsSync(file(f,base)))visit(base);const sources=read(file(f,'work/enterprise/plan.json')).componentContinuation.regressionCommand.slice(6).map(p=>{const b=fs.readFileSync(file(f,p));return{path:p,sha256:hash(b),bytes:b.length,data:b.toString('base64')};});t.diagnostic(JSON.stringify({kind:'SYNTHETIC_R_TRANSACTION_ARTIFACTS',mode,files,sources,realCheckoutCandidate:false}));};
 snapshot('positive');
 const successful=restorePoint(f);
 await t.test('current builder consistency reads without writes or subprocess and remains unapproved',()=>{const r=runREvidence(f,'consistency',{readonly:true});assert.equal(r.status,0,r.stderr);const d=JSON.parse(r.stdout);assert.equal(d.currentBuilderContextAuthenticated,true);assert.equal(d.provenanceAuthenticated,false);assert.equal(d.reviewReady,false);});
 const rebind=()=>{
  const ref=p=>{const b=fs.readFileSync(file(f,p));return {path:p,sha256:hash(b),bytes:b.length};},save=(p,v)=>{put(file(f,p),JSON.stringify(v,null,2)+'\n');return ref(p);};
  const dir=base+'/invocations/1',j=read(file(f,base+'/journal.json')),start=read(file(f,dir+'/start.json'));
  for(const k of ['scope','designReport','plan','inputsBefore'])start[k]=ref(start[k].path);j.events[0].start=save(dir+'/start.json',start);
  const inv=read(file(f,dir+'/output-inventory.json'));inv.entries=inv.entries.map(r=>ref(r.path));inv.digest=hash(JSON.stringify(inv.entries));const inventory=save(dir+'/output-inventory.json',inv);
  const r=read(file(f,dir+'/receipt.json'));for(const k of ['identity','scope','designReport','plan','inputsBefore','command'])r[k]=start[k];for(const k of ['execution','stdout','stderr','inputsAfter'])r[k]=ref(r[k].path);r.start=j.events[0].start;r.outputInventory=inventory;r.outputsDigest=inv.digest;
  const terminal=read(file(f,dir+'/terminal.json'));terminal.start=r.start;terminal.receipt=save(dir+'/receipt.json',r);terminal.outputInventory=inventory;j.events[1].start=r.start;j.events[1].terminal=save(dir+'/terminal.json',terminal);j.events[1].head=hash(JSON.stringify({previousHead:j.events[0].priorHead,sequence:1,start:r.start,terminal:j.events[1].terminal}));save(base+'/journal.json',j);
  const request=read(file(f,base+'/request.json'));for(const k of ['identity','scope','designReport','inputsDigest'])request[k]=r[k];request.receipt=terminal.receipt;request.historyBinding={journalPrefix:save(dir+'/journal-prefix.json',j),head:j.events[1].head,sequence:1,start:r.start,terminal:j.events[1].terminal};save(base+'/request.json',request);
 };
 for(const [name,edit]of [['exit',e=>e.status=1],['wrong command',e=>e.actualArgv.push('--test-name-pattern=pass')],['reversed time',e=>e.finishedAt='2020-01-01T00:00:00.000Z'],['missing output',e=>e.outputs.pop()],['unknown field',e=>e.accepted=true]])await t.test('rehashed R execution rejects '+name,()=>{successful();mutate(f,base+'/invocations/1/outputs/execution.json',edit);rebind();const graph=runREvidence(f,'read',{readonly:true});assert.equal(graph.status,0,graph.stderr);fail(runREvidence(f,'consistency',{readonly:true}),/component execution/);});
 for(const [name,edit]of [['invented builder',s=>s.identity.builderIteration++],['foreign session',s=>s.identity.builderSessionId='foreign-session']])await t.test('rehashed R provenance rejects '+name,()=>{successful();mutate(f,base+'/invocations/1/start.json',edit);rebind();assert.equal(runREvidence(f,'read',{readonly:true}).status,0);fail(runREvidence(f,'consistency',{readonly:true}),/R reader current builder identity/);});
 await t.test('rehashed R scope cannot replace the pre-execution source map',()=>{successful();mutate(f,base+'/invocations/1/scope.json',s=>s.caseBindings[0].variants[0].oracle='changed self-consistent oracle');rebind();assert.equal(runREvidence(f,'read',{readonly:true}).status,0);fail(runREvidence(f,'consistency',{readonly:true}),/R execution scope differs/);});
 await t.test('renamed successful TAP leaf with recomputed references still refuses',()=>{successful();const p=base+'/invocations/1/outputs/stdout.tap';put(file(f,p),fs.readFileSync(file(f,p),'utf8').replaceAll('synthetic condition 0','renamed condition 0'));const b=fs.readFileSync(file(f,p));mutate(f,base+'/invocations/1/outputs/execution.json',e=>e.outputs[0]={path:p,sha256:hash(b),bytes:b.length});rebind();assert.equal(runREvidence(f,'read',{readonly:true}).status,0);fail(runREvidence(f,'consistency',{readonly:true}),/R scope renamed or reparented/);});
 for(const extra of ['orphan.json','invocations/1/unknown.json','invocations/1/empty/extra.json'])await t.test('closed R namespace rejects '+extra,()=>{successful();put(file(f,base+'/'+extra),'{}');fail(runREvidence(f,'read',{readonly:true}),/unreferenced immutable|unexpected directory/);});
 await t.test('R purpose cannot be read as Q even with schema changed',()=>{successful();mutate(f,base+'/journal.json',j=>j.schemaVersion=1);fail(runREvidence(f,'read',{readonly:true}),/component graph schema/);});
 await t.test('existing completed namespace is not rewritten by a new transaction',()=>{successful();const before=tree(file(f,base));const r=runREvidence(f,'positive');fail(r,/existing history requires validated continuation/);assert.deepEqual(tree(file(f,base)),before);});
 await t.test('copied private owner refuses without writes',()=>{reset();const r=runREvidence(f,'forged');assert.equal(r.status,0,r.stderr);});
 for(const [name,edit]of [['missing condition',r=>r.pop()],['reordered condition',r=>r.reverse()],['empty variants',r=>r[0].variants=[]],['collapsed variants',r=>r[0].variants.push({...r[0].variants[0],variantId:'other'})],['unknown field',r=>r[0].force=true],['parent-only path',r=>r[0].variants[0].testPath.pop()],['wildcard oracle',r=>r[0].variants[0].oracle='*']])await t.test('scope refuses '+name+' before writes',()=>{reset();table(edit);fail(runREvidence(f,'preflight',{readonly:true}),/R scope/);assert.ok(!fs.existsSync(file(f,base)));});
 for(const mode of ['interrupt','write-failure','rename-failure','request-failure','fsync-failure','lock-change','output-replace','test-failure','coverage-failure'])await t.test('actual transaction preserves failure '+mode,()=>{reset();if(mode==='test-failure')fs.appendFileSync(file(f,'tests/enterprise/rejected-regeneration.test.mjs'),"\ntest('synthetic failure',()=>{throw Error('injected test failure');});\n");if(mode==='coverage-failure')table(r=>r[0].variants[0].testPath[1].name='nonexistent child');const r=runREvidence(f,mode);assert.equal(r.status,0,r.stderr);const d=JSON.parse(r.stdout);snapshot(mode);assert.equal(d.fence,true);if(['test-failure','coverage-failure','interrupt','write-failure'].includes(mode)){assert.equal(d.journal.events.at(-1).status,'FAILED');assert.ok(fs.existsSync(file(f,base+'/invocations/1/outputs/failure.json')));}fail(runREvidence(f,'read',{readonly:true}),/incomplete marker/);});
});

// These are synthetic historical graphs assembled from two actual isolated
// transactions. Assembly grants no writer continuation or fence-clear authority.
test('component-development-r-history-execution',async t=>{
 const f=await rEvidenceFixture(t),reset=restorePoint(f),base='evidence/enterprise/component-development/'+f.run.slug+'/review-evidence',first=base+'/invocations/1',second=base+'/invocations/2';
 const collect=p=>{const result=[];for(const n of fs.readdirSync(file(f,p)).sort()){const q=p+'/'+n,st=fs.lstatSync(file(f,q));if(st.isDirectory())result.push(...collect(q));else result.push({path:q,data:fs.readFileSync(file(f,q)).toString('base64')});}return result;};
 fs.appendFileSync(file(f,'tests/enterprise/rejected-regeneration.test.mjs'),"\ntest('synthetic historical failure',()=>{throw Error('historical synthetic failure');});\n");
 const failed=runREvidence(f,'test-failure');assert.equal(failed.status,0,failed.stderr);const failedFiles=collect(first);assert.equal(JSON.parse(failed.stdout).journal.events.at(-1).status,'FAILED');
 reset();const passed=runREvidence(f,'positive');assert.equal(passed.status,0,passed.stderr);const passedFiles=collect(first);
 fs.rmSync(file(f,base),{recursive:true});
 const rawPut=(p,b)=>{put(file(f,p),'');fs.writeFileSync(file(f,p),b);};
 for(const entry of passedFiles){const p=entry.path.replace(first,second),b=Buffer.from(entry.data,'base64');rawPut(p,p.endsWith('.json')?b.toString().replaceAll(first+'/',second+'/'):b);}
 for(const entry of failedFiles)rawPut(entry.path,Buffer.from(entry.data,'base64'));
 const ref=p=>{const b=fs.readFileSync(file(f,p));return {path:p,sha256:hash(b),bytes:b.length};},save=(p,v)=>{put(file(f,p),JSON.stringify(v,null,2)+'\n');return ref(p);};
 const rebind=()=>{
  const events=[];let head='0'.repeat(64),latest;
  for(const sequence of [1,2]){
   const dir=base+'/invocations/'+sequence,start=read(file(f,dir+'/start.json'));start.sequence=sequence;start.priorHistoryHead=head;
   for(const k of ['scope','designReport','plan','inputsBefore'])start[k]=ref(start[k].path);const startRef=save(dir+'/start.json',start);
   const e=read(file(f,dir+'/outputs/execution.json'));e.outputs=e.outputs.map(r=>ref(r.path));const execution=save(dir+'/outputs/execution.json',e);
   const terminal=read(file(f,dir+'/terminal.json'));terminal.sequence=sequence;terminal.previousHead=head;terminal.start=startRef;
   if(terminal.status==='FAILED'){const d=read(file(f,terminal.diagnostic.path));d.execution=execution;d.inputsAfter=ref(d.inputsAfter.path);terminal.diagnostic=save(terminal.diagnostic.path,d);}
   const inventory=read(file(f,dir+'/output-inventory.json'));inventory.entries=inventory.entries.map(r=>ref(r.path));inventory.digest=hash(JSON.stringify(inventory.entries));terminal.outputInventory=save(dir+'/output-inventory.json',inventory);
   if(terminal.status==='PASSED'){
    const r=read(file(f,dir+'/receipt.json'));for(const k of ['identity','scope','designReport','plan','inputsBefore','command'])r[k]=start[k];r.start=startRef;r.priorHistoryHead=head;r.outputInventory=terminal.outputInventory;r.outputsDigest=inventory.digest;
    for(const k of ['execution','stdout','stderr','inputsAfter'])r[k]=ref(r[k].path);terminal.receipt=save(dir+'/receipt.json',r);latest=r;
   }
   const terminalRef=save(dir+'/terminal.json',terminal),next=hash(JSON.stringify({previousHead:head,sequence,start:startRef,terminal:terminalRef}));
   events.push({sequence,status:'STARTED',start:startRef,priorHead:head},{sequence,status:terminal.status,start:startRef,terminal:terminalRef,head:next});head=next;
   if(fs.existsSync(file(f,dir+'/journal-prefix.json')))save(dir+'/journal-prefix.json',{schemaVersion:2,purpose:start.purpose,events:[...events]});
  }
  const journal={schemaVersion:2,purpose:'R_COMPONENT_IMPLEMENTATION_REVIEW',events};save(base+'/journal.json',journal);
  save(base+'/request.json',{schemaVersion:2,purpose:journal.purpose,identity:latest.identity,scope:latest.scope,designReport:latest.designReport,receipt:ref(second+'/receipt.json'),inputsDigest:latest.inputsDigest,historyBinding:{journalPrefix:ref(second+'/journal-prefix.json'),head,sequence:2,start:events[2].start,terminal:events[3].terminal},productVerified:false});
 };
 rebind();const restore=restorePoint(f);
 const program=rEvidenceProgram.replace('rComponentCoverage};','rComponentCoverage,readRComponentHistoryExecution};').replace("if(mode==='consistency')","if(mode==='history'){for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[key]=()=>{throw Error('READONLY_SUBPROCESS');};syncBuiltinESMExports();console.log(JSON.stringify(m.readRComponentHistoryExecution(process.cwd(),run)));}else if(mode==='consistency')");
 const history=()=>{const before=tree(f.temporary);const r=spawnSync(process.execPath,['--import',f.guardPath,'--input-type=module','-e',program,'history',f.run.slug],{cwd:f.root,env:f.env,encoding:'utf8',timeout:60000,maxBuffer:4e6});assert.deepEqual(tree(f.temporary),before);assert.doesNotMatch(r.stderr,/FS_MUTATION|READONLY_SUBPROCESS/);return r;};
 await t.test('failed then passed execution uses each historical input and remains unapproved',()=>{
  const r=history();assert.equal(r.status,0,r.stderr);const d=JSON.parse(r.stdout);assert.deepEqual(d.invocations.map(x=>x.status),['FAILED','PASSED']);assert.notEqual(d.invocations[0].inputDigest,d.invocations[1].inputDigest);assert.match(d.invocations[0].reproducedCause,/R writer test failure/);assert.equal(d.provenanceAuthenticated,false);assert.equal(d.reviewReady,false);
  const current=runREvidence(f,'consistency',{readonly:true});assert.equal(current.status,0,current.stderr);assert.equal(JSON.parse(current.stdout).history.invocations.length,2);
 });
 t.diagnostic(JSON.stringify({kind:'SYNTHETIC_R_HISTORY_EXECUTION_ARTIFACTS',realCheckoutCandidate:false,assembledHistory:true,transactions:[{kind:'failed',files:failedFiles},{kind:'passed',files:passedFiles}],assembled:collect(base)}));
 const cases=[
  ['historical command',first+'/outputs/execution.json',e=>e.actualArgv.push('--test-name-pattern=pass'),/R history actual command/],
  ['historical input digest',first+'/outputs/execution.json',e=>e.inputsDigest='0'.repeat(64),/R history execution input digest/],
  ['historical reversed time',first+'/outputs/execution.json',e=>e.finishedAt='2020-01-01T00:00:00.000Z',/R history reversed time/],
  ['historical output omitted',first+'/outputs/execution.json',e=>e.outputs.pop(),/R history execution outputs/],
  ['historical unknown field',first+'/outputs/execution.json',e=>e.approved=true,/R history execution fields/],
  ['historical invalid status',first+'/outputs/execution.json',e=>e.status=-1,/R history status/],
  ['historical exit and signal',first+'/outputs/execution.json',e=>e.signal='SIGTERM',/R history exit and signal conflict/],
  ['historical invalid interruption',first+'/outputs/execution.json',e=>e.interrupted='FORCE',/R history interruption/],
  ['historical failure rewritten',first+'/outputs/failure.json',e=>e.message='unrelated saved error',/R history failure cause mismatch/],
  ['historical failure suppressed',first+'/outputs/execution.json',e=>e.status=0,/R history failure cause mismatch/],
  ['historical manifest digest',first+'/inputs-before.json',m=>m.digest='0'.repeat(64),/R history manifest digest/],
  ['historical manifest field',first+'/inputs-before.json',m=>m.approved=true,/R history manifest fields/],
  ['historical duplicate input',first+'/inputs-before.json',m=>m.entries.splice(1,0,m.entries[0]),/R history duplicate inputs/],
  ['historical saved plan',first+'/plan.json',p=>p.extra='altered',/R history saved plan input/],
  ['historical scope plan',first+'/scope.json',s=>s.planDefinition.sha256='0'.repeat(64),/R history scope plan binding/],
  ['historical scope identity',first+'/scope.json',s=>s.scopeId='foreign',/R history scope identity/],
  ['historical missing condition',first+'/scope.json',s=>s.caseBindings.pop(),/R history scope condition count/],
  ['historical unknown scope field',first+'/scope.json',s=>s.accepted=true,/R history scope fields/],
  ['historical source binding',first+'/scope.json',s=>s.caseBindings[0].variants[0].source.sha256='0'.repeat(64),/R history scope source/],
  ['historical contract binding',first+'/scope.json',s=>s.contracts[0].sha256='0'.repeat(64),/R history scope contracts/],
  ['historical empty variant',first+'/scope.json',s=>s.caseBindings[0].variants=[],/R history scope empty variants/],
  ['historical collapsed variant',first+'/scope.json',s=>s.caseBindings[0].variants.push({...s.caseBindings[0].variants[0],variantId:'other'}),/R history scope collapsed variants/],
  ['historical reordered condition',first+'/scope.json',s=>s.caseBindings.reverse(),/R history scope condition order/],
  ['duplicate invocation',second+'/outputs/execution.json',e=>e.invocation=read(file(f,first+'/outputs/execution.json')).invocation,/R history reused invocation/],
  ['overlapping invocation',second+'/outputs/execution.json',e=>e.startedAt=read(file(f,first+'/outputs/execution.json')).startedAt,/R history overlapping execution/]
 ];
 for(const [name,path,edit,expected]of cases)await t.test('rehash cannot hide '+name,()=>{restore();mutate(f,path,edit);rebind();const graph=runREvidence(f,'read',{readonly:true});assert.equal(graph.status,0,graph.stderr);fail(history(),expected);});
 await t.test('current execution consumer refuses corruption only in prior execution',()=>{restore();mutate(f,first+'/outputs/execution.json',e=>e.inputsDigest='0'.repeat(64));rebind();fail(runREvidence(f,'consistency',{readonly:true}),/R history execution input digest/);});
 await t.test('latest successful outputs cannot replace prior failed outputs',()=>{restore();rawPut(first+'/outputs/stdout.tap',fs.readFileSync(file(f,second+'/outputs/stdout.tap')));mutate(f,first+'/outputs/execution.json',e=>e.status=0);rebind();fail(history(),/R history failure cause not reproduced/);});
 await t.test('rehash cannot hide input drift after a failed execution',()=>{restore();mutate(f,first+'/inputs-after.json',m=>{m.entries[0].sha256='0'.repeat(64);m.digest=hash(JSON.stringify({entries:m.entries,runtime:m.runtime}));});rebind();fail(history(),/R history completed invocation input drift/);});
 // A second synthetic graph exercises historical PASSED, independently of
 // the current PASSED record. Times/identity below are fixture metadata only.
 restore();fs.rmSync(file(f,first),{recursive:true});for(const entry of collect(second)){const p=entry.path.replace(second,first),b=Buffer.from(entry.data,'base64');rawPut(p,p.endsWith('.json')?b.toString().replaceAll(second+'/',first+'/'):b);}
 mutate(f,first+'/outputs/execution.json',e=>{e.invocation='invocation-00000000-0000-4000-8000-000000000001';e.startedAt='2020-01-01T00:00:00.000Z';e.finishedAt='2020-01-01T00:00:01.000Z';});rebind();const restorePass=restorePoint(f);
 await t.test('two successful executions are each inspected without granting provenance',()=>{const r=history();assert.equal(r.status,0,r.stderr);const d=JSON.parse(r.stdout);assert.deepEqual(d.invocations.map(x=>x.status),['PASSED','PASSED']);assert.equal(d.provenanceAuthenticated,false);});
 await t.test('historical PASS with nonzero exit refuses behind a valid latest PASS',()=>{restorePass();mutate(f,first+'/outputs/execution.json',e=>e.status=1);rebind();assert.equal(runREvidence(f,'read',{readonly:true}).status,0);fail(history(),/R history historical PASS failed execution/);});
 await t.test('historical PASS with renamed leaf refuses behind a valid latest PASS',()=>{restorePass();const p=first+'/outputs/stdout.tap';rawPut(p,fs.readFileSync(file(f,p),'utf8').replaceAll('synthetic condition 0','renamed historical condition'));rebind();assert.equal(runREvidence(f,'read',{readonly:true}).status,0);fail(history(),/R history historical PASS failed execution/);});
 await t.test('historical PASS receipt cannot claim another input digest',()=>{restorePass();mutate(f,first+'/receipt.json',r=>r.inputsDigest='0'.repeat(64));rebind();assert.equal(runREvidence(f,'read',{readonly:true}).status,0);fail(history(),/R history receipt input digest/);});
 await t.test('current input is rechecked after the actual history reader returns',()=>{
  restorePass();const before=fs.readFileSync(file(f,'.takt/config.yaml'));
  const code=String.raw`import fs from 'node:fs';import assert from 'node:assert/strict';import {resolve}from'node:path';import {pathToFileURL}from'node:url';
const url=pathToFileURL(resolve('scripts/enterprise/runtime-preparation.mjs'));let source=fs.readFileSync(url,'utf8');const marker="return {kind:'R_COMPONENT_HISTORY_EXECUTION_CONSISTENCY'";assert.equal(source.split(marker).length,2);
source=source.replace(marker,"writeFileSync(resolve(root,'.takt/config.yaml'),Buffer.concat([readFileSync(resolve(root,'.takt/config.yaml')),Buffer.from('\\n')]));"+marker).replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g,(_,q,p)=>'from '+JSON.stringify(new URL(p,url).href)).replaceAll('import.meta.url',JSON.stringify(url.href));
try{const m=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {readRComponentEvidenceExecution};').toString('base64'));assert.throws(()=>m.readRComponentEvidenceExecution(process.cwd(),process.argv[1]),/component execution changed current inputs/);console.log('POST_HISTORY_INPUT_DRIFT_REFUSED');}catch(e){console.error(e.message);process.exitCode=1;}`;
  const r=spawnSync(process.execPath,['--input-type=module','-e',code,f.run.slug],{cwd:f.root,env:f.env,encoding:'utf8',timeout:60000,maxBuffer:4e6});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'POST_HISTORY_INPUT_DRIFT_REFUSED');assert.deepEqual(fs.readFileSync(file(f,'.takt/config.yaml')),Buffer.concat([before,Buffer.from('\n')]));
 });
});

// U role acquisition primitives. These isolated fixtures do not impersonate
// a live U occurrence, an executed T engine, or an accepted component scope.
test('component-development-u-runtime-roles',async t=>{
 const {pathToFileURL}=await import('node:url'),{resolve}=await import('node:path'),{tmpdir}=await import('node:os');
 const url=pathToFileURL(resolve('scripts/enterprise/runtime-preparation.mjs'));
 let source=fs.readFileSync(url,'utf8');source=source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g,(_,q,p)=>'from '+JSON.stringify(new URL(p,url).href)).replaceAll('import.meta.url',JSON.stringify(url.href));
 const m=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {validateURoleManifest,validateUWorkerTuple,uCollectDistribution,holdUDistribution,uFile};\n//# sourceURL=u-role-primitives-fixture.mjs').toString('base64'));
 const roles=read(resolve('evidence/enterprise/design-run01d1feb5-iteration7/runtime-roles.json')),context={identity:{runSlug:roles.runSlug,runtime:structuredClone(roles.helper.identity)}};
 await t.test('U distinct pinned helper and executor roles accepted without launch or memory proof',()=>{assert.equal(roles.helper.identity.version,'0.71.0');assert.equal(roles.executorOrigin.identity.version,'0.70.0');m.validateURoleManifest(roles,context);assert.equal(roles.isolatedEngine.actualEngineExecuted,false);assert.ok(roles.missingProofs.includes('LOADED_MEMORY_BYTES'));});
 for(const [name,edit,re]of [
  ['unknown top field',r=>r.authority=true,/role fields/],['old schema',r=>r.schemaVersion=4,/role schema/],['foreign run',r=>r.runSlug='other',/role run/],['helper substitution',r=>r.helper.identity=r.executorOrigin.identity,/helper identity/],['role swap',r=>r.executorOrigin.inventoryRole='helper',/executor role/],['caller override',r=>r.mapping.callerOverrideAllowed=true,/role mapping/],['helper-only engine',r=>r.isolatedEngine.sourceInventoryRole='helper',/T source role/],['different engine inventory',r=>r.isolatedEngine.sourceInventory.sha256='0'.repeat(64),/T source inventory/],['PATH Node',r=>r.isolatedEngine.entryCommand[0]='node',/T command/],['claimed engine execution',r=>r.isolatedEngine.actualEngineExecuted=true,/T not executed/],['launch proof claim',r=>r.evidenceLevel='LAUNCH_AUTHENTICATED',/proof level/],['missing proof erased',r=>r.missingProofs=[],/missing proofs/],['extra executor option',r=>r.executorOrigin.model='other',/executor fields/],['missing identity source',r=>r.executorOrigin.identity.sources.pop(),/sixteen legacy/],['unknown identity field',r=>r.executorOrigin.identity.sources[0].trusted=true,/identity source fields/],['missing collector source',r=>r.executorOrigin.sourceRefs.splice(4,1),/origin source count/],['foreign collector',r=>r.executorOrigin.sourceRefs[4].path='/other/collector.js',/origin source path/],['unknown Node field',r=>r.executorOrigin.nodeExecutable.trusted=true,/Node reference/]
 ])await t.test('U strict role refusal '+name,()=>{const r=structuredClone(roles);edit(r);assert.throws(()=>m.validateURoleManifest(r,context),re);});
 const central={taskId:'fixture-task',status:'running',generation:54,runId:'fixture-U',executionId:'fixture-execution',pid:123,processIdentity:{startTime:'fixture start'},startedAt:'2026-10-26T19:05:43.525Z'},worker={pid:123,executable:'/fixed/node',script:'/fixed/node_modules/takt/dist/features/web-ui/worker-entry.js',cwd:'/fixture',started:'fixture start'},argv=[worker.executable,worker.script,'--state-id','fixture-state','--task-id',central.taskId,'--generation','53','--execution-id',central.executionId];
 await t.test('U exact reservation adoption tuple',()=>m.validateUWorkerTuple('/fixture','fixture-state',central,worker,argv));
 for(const [name,edit,re]of [
  ['PID reuse',(c,w)=>w.started='new start',/start time/],['wrong PID',(c,w)=>w.pid++,/worker pid/],['wrong cwd',(c,w)=>w.cwd='/elsewhere',/worker cwd/],['generation override',c=>c.generation++,/adoption tuple/],['execution override',c=>c.executionId='other',/adoption tuple/],['inactive task',c=>c.status='done',/adopted execution/],['launcher override',(c,w,a)=>a[1]='/other/worker.js',/adoption tuple/],['extra argv',(c,w,a)=>a.push('--allow'),/adoption tuple/],['unknown central field',c=>c.owner='token',/central tuple fields/]
 ])await t.test('U worker tuple refusal '+name,()=>{const c=structuredClone(central),w=structuredClone(worker),a=[...argv];edit(c,w,a);assert.throws(()=>m.validateUWorkerTuple('/fixture','fixture-state',c,w,a),re);});
 const temp=fs.mkdtempSync(join(tmpdir(),'enterprise-u-roles-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));let sequence=0;
 const distribution=()=>{const root=join(temp,String(++sequence));put(join(root,'package.json'),{name:'fixture-executor',version:'1.0.0',dependencies:{dep:'1'},optionalDependencies:{absent:'1'},exports:'./collector.js'});put(join(root,'collector.js'),'export const limit=128;\n');put(join(root,'node_modules/dep/package.json'),{name:'dep',version:'1.0.0'});put(join(root,'node_modules/dep/index.js'),'export default 1;\n');return root;};
 await t.test('U dependency closure resolves real files and records absent optional dependency without writes',()=>{const root=distribution(),before=tree(root),got=m.uCollectDistribution(root);assert.equal(got.inventory.packages.length,2);assert.equal(got.inventory.fileCount,4);assert.deepEqual(got.inventory.edges.map(e=>[e.name,e.optional]),[['dep',false]]);assert.deepEqual(got.inventory.missing.map(e=>[e.name,e.optional]),[['absent',true]]);m.holdUDistribution(root,got.inventory).recheck();assert.deepEqual(tree(root),before);});
 for(const [name,edit]of [
  ['collector bytes',root=>fs.appendFileSync(join(root,'collector.js'),'// changed')],
  ['dependency bytes',root=>fs.appendFileSync(join(root,'node_modules/dep/index.js'),'// changed')],
  ['added package file',root=>put(join(root,'extra.js'),'new')],
  ['optional dependency appeared',root=>put(join(root,'node_modules/absent/package.json'),{name:'absent',version:'1'})],
  ['exports changed',root=>{const p=join(root,'package.json'),v=read(p);v.exports='./other.js';put(p,v);}],
  ['same bytes new inode',root=>{const p=join(root,'collector.js'),b=fs.readFileSync(p);fs.renameSync(p,p+'.old');put(p,b);fs.unlinkSync(p+'.old');}],
  ['file mode changed',root=>fs.chmodSync(join(root,'collector.js'),0o755)],
  ['dependency removed',root=>fs.rmSync(join(root,'node_modules/dep'),{recursive:true})]
 ])await t.test('U held closure refuses after await '+name,async()=>{const root=distribution(),expected=m.uCollectDistribution(root).inventory,owner=m.holdUDistribution(root,expected);await Promise.resolve();edit(root);const before=tree(root);assert.throws(()=>owner.recheck(),/U held source|U dependency closure|ENOENT/);assert.deepEqual(tree(root),before);});
 await t.test('U required unresolved dependency refuses',()=>{const root=distribution();fs.rmSync(join(root,'node_modules/dep'),{recursive:true});assert.throws(()=>m.uCollectDistribution(root),/required dependency missing/);});
 await t.test('U stale inventory cannot be reacquired as current',()=>{const root=distribution(),expected=m.uCollectDistribution(root).inventory;fs.appendFileSync(join(root,'collector.js'),'changed');assert.throws(()=>m.holdUDistribution(root,expected),/distribution\/resolution changed/);});
 await t.test('U symlink destination and bytes are pinned',()=>{const root=distribution();put(join(root,'target.js'),'a');fs.symlinkSync('target.js',join(root,'link.js'));const expected=m.uCollectDistribution(root).inventory;assert.ok(expected.packages[0].files.find(r=>r.relative==='link.js').targetRef);const owner=m.holdUDistribution(root,expected);fs.unlinkSync(join(root,'link.js'));fs.symlinkSync('collector.js',join(root,'link.js'));assert.throws(()=>owner.recheck(),/dependency closure changed/);});
 await t.test('U unresolved directory symlink refuses',()=>{const root=distribution();fs.symlinkSync('node_modules/dep',join(root,'linked-dir'));assert.throws(()=>m.uCollectDistribution(root),/unresolved directory dependency/);});
});

test('component-development-u-predecessor-history',async t=>{
 const {pathToFileURL}=await import('node:url'),{resolve}=await import('node:path'),url=pathToFileURL(resolve('scripts/enterprise/runtime-preparation.mjs'));let source=fs.readFileSync(url,'utf8');source=source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g,(_,q,p)=>'from '+JSON.stringify(new URL(p,url).href)).replaceAll('import.meta.url',JSON.stringify(url.href));const m=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {validateUPredecessorLog};').toString('base64'));
 const meta={status:'failed',iterations:16,reason:'Step execution failed: spawnSync git ENOBUFS',endTime:'fixture-end'},phase={type:'phase_complete',step:'build-foundation',iteration:16,phase:1,status:'done',content:'partial work'},history={terminalReason:meta.reason,step16Phase2Complete:false,canonicalImplementationIteration:15,buildTurnsConsumed:8,M1Misses:[2,4],M2Status:'MISSED'},records=[{type:'phase_complete',step:'build-foundation',iteration:15,phase:2,status:'done',content:'historical iteration15'},phase,{type:'workflow_abort',iterations:16,reason:meta.reason,endTime:meta.endTime}];
 await t.test('U interrupted R retains Phase1 and historical canonical report',()=>m.validateUPredecessorLog(meta,records,[phase],history,'historical iteration15\n'));
 for(const [name,change,re]of [
  ['fabricated phase2',(v)=>{v.records.splice(2,0,{...v.phase,phase:2});v.phases.push({...v.phase,phase:2});},/phase count/],['fabricated complete step',v=>v.records.splice(2,0,{type:'step_complete',step:'build-foundation',iteration:16}),/incomplete step/],['copied phase output',v=>v.phases[0].content='forged',/phase source/],['terminal success',v=>v.meta.status='done',/terminal status/],['different terminal cause',v=>v.records.at(-1).reason='other',/terminal reason/],['new canonical from Phase1',v=>v.canonical='partial work',/canonical remains/],['erased deadline miss',v=>v.history.M1Misses=[],/deep-equal/],['reset build count',v=>v.history.buildTurnsConsumed=0,/0 !== 8/]
 ])await t.test('U history refuses '+name,()=>{const v={meta:structuredClone(meta),records:structuredClone(records),phase:structuredClone(phase),phases:[structuredClone(phase)],history:structuredClone(history),canonical:'historical iteration15'};change(v);assert.throws(()=>m.validateUPredecessorLog(v.meta,v.records,v.phases,v.history,v.canonical),re);});
});

// Deterministic clock boundaries are isolated from the real-U/full-inventory run.
test('component-development-u-finite-owner-budget',async t=>{
 const {tmpdir}=await import('node:os');const dir=fs.mkdtempSync(join(tmpdir(),'u-owner-budget-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=fs.realpathSync('scripts/enterprise/preparation-producer-linux.c');
 const runtime=fs.readFileSync('scripts/enterprise/runtime-preparation.mjs','utf8');
 const definition=JSON.parse(JSON.parse(runtime.match(/^const uHostProtocolDefinition=(.*);$/m)[1]));
 const digest=hash(JSON.stringify(definition.policy,null,2)+'\n');
 const harness=String.raw`
#include <stdlib.h>
#include <time.h>
#include <poll.h>
#include <errno.h>
static long long now_ns,poll_advance;static int interrupt_once;
static int fixture_clock(clockid_t c,struct timespec *t){(void)c;t->tv_sec=now_ns/1000000000LL;t->tv_nsec=now_ns%1000000000LL;return 0;}
static int fixture_poll(struct pollfd *p,nfds_t n,int ms){(void)n;(void)ms;now_ns+=poll_advance;if(interrupt_once){interrupt_once=0;errno=EINTR;return -1;}p->revents=p->events;return 1;}
#define clock_gettime fixture_clock
#define poll fixture_poll
#define PD_U_HOST_PROTOCOL_V1 1
#define main helper_main
#include SOURCE
#undef main
int main(int argc,char **argv){
 if(argc!=2)return 90;int scenario=atoi(argv[1]);
 struct pd_semantic_reservation s={.process=getpid(),.start={100,0},.challenge_start={1100,0},.challenge_active=1};
 now_ns=1100000000000LL;
 if(scenario==0){now_ns=1339999999999LL;return pd_semantic_remaining(&s)==1?0:1;}
 if(scenario==1||scenario==2){now_ns=1340000000000LL+(scenario-1);return pd_semantic_remaining(&s)<0&&errno==ETIMEDOUT?0:2;}
 if(scenario==3){now_ns=1339999999999LL;poll_advance=1;return pd_rsp_wait(&s,POLLIN)<0&&errno==ETIMEDOUT?0:3;}
 if(scenario==4){s.challenge_start.tv_sec=1300;now_ns=1359999999999LL;return pd_semantic_remaining(&s)==1?0:4;}
 if(scenario==5||scenario==6){s.challenge_start.tv_sec=1300;now_ns=1360000000000LL+(scenario-5);return pd_semantic_remaining(&s)<0&&errno==ETIMEDOUT?0:5;}
 if(scenario==7){now_ns=1339999999999LL;poll_advance=1;interrupt_once=1;return pd_rsp_wait(&s,POLLIN)<0&&errno==ETIMEDOUT?0:7;}
 if(scenario==8){now_ns=99999999999LL;return pd_semantic_remaining(&s)<0&&errno==ESTALE?0:8;}
 if(scenario==9){s.challenge_active=0;now_ns=1260000000000LL;return pd_semantic_remaining(&s)==100000?0:9;}
 if(scenario==10){s.challenge_start.tv_sec=1340;now_ns=1360000000000LL;return pd_semantic_remaining(&s)<0&&errno==ETIMEDOUT?0:10;}
 if(scenario>=11&&scenario<=18){unsigned char digest[32]={DIGEST};struct pd_intent d={.policy={digest,32},.limits={1260000,1000,134217728,1,65536}};
  if(scenario==11)return pd_u_policy(&d)==0?0:11;
  if(scenario==12)digest[0]^=1;
  if(scenario>=13&&scenario<=17)d.limits[scenario-13]++;
  if(scenario==18)d.limits[0]=10000;
  return pd_u_policy(&d)<0&&errno==EPERM?0:12;
 }
 return 99;
}
`.replace('SOURCE',JSON.stringify(source)).replace('DIGEST',[...Buffer.from(digest,'hex')].join(','));
 const src=join(dir,'clock.c'),bin=join(dir,'clock');fs.writeFileSync(src,harness);
 const compiled=spawnSync('cc',['-std=c11','-Wall','-Wextra','-Werror','-pedantic',src,'-o',bin],{encoding:'utf8'});assert.equal(compiled.status,0,compiled.stderr);
 const names=['stage just before','stage exactly at','stage after','ready at expiry','global just before','global exactly at','global after','EINTR consumes deadline','backward clock','no legacy sixty-second cap','new stage cannot reset global','fixed policy hash positive','forged policy hash','forged wall','forged cpu','forged memory','forged child count','forged output cap','R limits cannot select U'];
 for(let i=0;i<names.length;i++)await t.test(names[i],()=>{const r=spawnSync(bin,[String(i)],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);});
 await t.test('fixed JS profile includes all timing and no runtime duration input',()=>{assert.equal(definition.purpose,'U_HOST_PROTOCOL_V1');assert.deepEqual(definition.policy.timing,{ownerMs:1260000,challengeMs:240000,watchdogMs:1261000,cleanupMs:1000,clock:'CLOCK_MONOTONIC',childDeadline:'inherited-owner-start',reset:false});assert.deepEqual(definition.policy.limits,['1260000','1000','134217728','1','65536']);});
 t.diagnostic(JSON.stringify({harness,compiler:compiled.args??['cc','-std=c11','-Wall','-Wextra','-Werror','-pedantic',src,'-o',bin],compilerStatus:compiled.status,binarySha256:hash(fs.readFileSync(bin)),sourceSha256:hash(fs.readFileSync(source)),policySha256:digest,fixtureClock:true,realUAcceptance:false}));
});

// Actual registry/compiler/context/session readers, with a synthetic U review
// envelope. This does not validate U raw role references, history or all 85 cases.
test('component-development-u-review-envelope',async t=>{
 const f=await componentDevelopmentFixture(t);
 Object.assign(f.restartAttestation,{schemaVersion:5,permission:'IMPLEMENTATION_AND_ISOLATED_REVIEW_ONLY',contractPath:'work/enterprise/COMPONENT_SUCCESSOR.md',componentReviewAuthority:true,runtimeRoles:{path:'evidence/roles.json',sha256:'0'.repeat(64),bytes:1},continuationCheckpoint:{path:'evidence/continuation.json',sha256:'0'.repeat(64),bytes:1}});
 rewriteRestartAttestation(f,()=>{});
 for(const r of f.records.filter(r=>r.type==='step_start'))Object.assign(r.providerOptions.codex,{permissionControl:'takt',fastMode:true});f.append({type:'boundary'});
 const probe=join(f.temporary,'u-review-envelope.mjs');
 put(probe,`import fs from 'node:fs';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
 for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[k]=()=>{throw new Error('SUBPROCESS_FORBIDDEN '+k)};syncBuiltinESMExports();
 const url=pathToFileURL(resolve('scripts/enterprise/runtime-preparation.mjs'));let source=fs.readFileSync(url,'utf8');source=source.replace(/from (['"])(\\.{1,2}\\/[^'"]+)\\1/g,(_,q,p)=>'from '+JSON.stringify(new URL(p,url).href)).replaceAll('import.meta.url',JSON.stringify(url.href));
 const {readUSuccessorReview}=await import('data:text/javascript;base64,'+Buffer.from(source+'\\nexport {readUSuccessorReview};\\n//# sourceURL=u-review-envelope-fixture.mjs').toString('base64'));
 const {currentContext}=await import(pathToFileURL(resolve('scripts/enterprise/context.mjs')));const context=await currentContext(process.cwd());const r=readUSuccessorReview(context);console.log(JSON.stringify({scope:'REVIEW_ENVELOPE_ONLY',runSlug:r.a.runSlug,iteration:r.review.start.iteration,builderSession:context.providerSessionId,reviewSession:r.review.session,schema:r.a.schemaVersion}));`);
 const reset=restorePoint(f),invoke=()=>{const before=tree(f.temporary),r=spawnSync(process.execPath,['--import',f.guardPath,probe],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000,maxBuffer:4*1024*1024});assert.deepEqual(tree(f.temporary),before);assert.doesNotMatch(r.stderr,/FS_MUTATION|SUBPROCESS_FORBIDDEN/);return r;};
 await t.test('U actual completed review envelope without writer or subprocess',()=>assert.deepEqual(ok(invoke()),{scope:'REVIEW_ENVELOPE_ONLY',runSlug:f.run.slug,iteration:2,builderSession:'builder-session',reviewSession:'designer-session',schema:5}));
 for(const [name,edit,re]of [
  ['R schema',a=>a.schemaVersion=4,/U attestation schemaVersion/],['foreign run',a=>a.runSlug='foreign',/U attestation runSlug/],['foreign workflow',a=>a.workflowRef='foreign',/U attestation workflowRef/],['foreign bundle',a=>a.bundleDigest='0'.repeat(64),/U attestation bundleDigest/],['wrong occurrence',a=>a.iteration++,/U attestation iteration/],['wrong step',a=>a.step='review-foundation',/U attestation step/],['wrong session key',a=>a.sessionKey='enterprise-builder',/U attestation sessionKey/],['claimed self review',a=>a.providerSessionId='builder-session',/U attestation providerSessionId/],['old permission',a=>a.permission='IMPLEMENTATION_AND_ISOLATED_TESTS_ONLY',/U attestation permission/],['old contract',a=>a.contractPath='work/enterprise/COMPONENT_CONTINUATION.md',/U attestation contractPath/],['unknown field',a=>a.token='trusted',/attestation fields/],['missing roles',a=>delete a.runtimeRoles,/attestation fields/],['changed helper',a=>a.runtimeIdentity.version='other',/U H identity/],['product approval',a=>a.currentApprovals=['VERIFIED'],/strictly deep-equal/],
  ...['captureAuthority','recoveryAuthority','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority'].map(k=>[k,a=>a[k]=true,new RegExp('U attestation '+k)])
 ])await t.test('U envelope refuses '+name,()=>{reset();rewriteRestartAttestation(f,edit);const r=invoke();fail(r,re);assert.equal(r.stdout,'');});
 for(const role of ['builder','review'])for(const field of ['model','effort','permission','profile','fastMode'])await t.test('U actual '+role+' '+field,()=>{
  reset();const r=f.records.findLast(r=>r.type==='step_start'&&r.step===(role==='builder'?'build-foundation':'review-architecture'));
  if(field==='model')r.model='gpt-6.1-sol';else r.providerOptions.codex[{effort:'reasoningEffort',permission:'permissionControl',profile:'configProfile',fastMode:'fastMode'}[field]]=field==='fastMode'?false:'invalid';f.append({type:'boundary'});fail(invoke(),/AssertionError|context|occurrence/);
 });
 for(const kind of ['missing-phase2','duplicate-phase2','incomplete','phase-order','phase-content','canonical','actual-self-review','latest-incomplete'])await t.test('U actual review rejects '+kind,()=>{
  reset();const records=f.records,find=type=>records.findIndex(r=>r.step==='review-architecture'&&r.type===type&&(type!=='phase_complete'||r.phase===2));
  if(kind==='missing-phase2')records.splice(find('phase_complete'),1);
  if(kind==='duplicate-phase2')records.splice(find('phase_complete'),0,structuredClone(records[find('phase_complete')]));
  if(kind==='incomplete')records[find('step_complete')].status='error';
  if(kind==='phase-order'){const i=find('phase_complete');[records[i-1],records[i]]=[records[i],records[i-1]];}
  if(kind==='phase-content')records.find(r=>r.type==='phase_complete'&&r.phase===1&&r.step==='review-architecture').content=fenced('enterprise-preparation-restart-attestation',{...f.restartAttestation,verdict:'REQUEST_CHANGES'});
  if(kind==='canonical')fs.appendFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'),'changed');
  if(kind==='actual-self-review')savePersonaSessions(f.root,{...f.sessions,[JSON.stringify(['enterprise-architecture-reviewer','codex','gpt-6-astra'])]:'builder-session'},'codex',f.paths.sessionsDirectory);
  if(kind==='latest-incomplete'){f.context('review-architecture',4);f.context('build-foundation',5);}
  f.append({type:'boundary'});fail(invoke(),/incomplete preparation occurrence|preparation phase order|U review phases|U canonical report|independent review session/);
 });
 for(const kind of ['duplicate-key','two-blocks'])await t.test('U review raw framing rejects '+kind,()=>{
  reset();let raw=fenced('enterprise-preparation-restart-attestation',f.restartAttestation);raw=kind==='two-blocks'?raw+'\n'+raw:raw.replace('"schemaVersion":5','"schemaVersion":4,"schemaVersion":5');for(const r of f.records.filter(r=>r.type==='phase_complete'&&r.step==='review-architecture'))r.content=raw;put(join(f.run.reportsAbs,'enterprise-02-review.md'),raw+'\n');f.append({type:'boundary'});fail(invoke(),/duplicate preparation field|mixed preparation attestation blocks/);
 });
 await t.test('U envelope helper is not an exported authority capability',async()=>{assert.equal((await import('../../scripts/enterprise/runtime-preparation.mjs')).readUSuccessorReview,undefined);});
});

// Storage-only U fixtures: actual fixed Node subprocesses and durable files,
// synthetic scope/identity/authentication. No real U origin or candidate claim.
test('component-development-u-continuing-transaction',async t=>{
 const {tmpdir}=await import('node:os');
 const program=String.raw`
import fs from 'node:fs';import cp from 'node:child_process';import assert from 'node:assert/strict';import {resolve,dirname} from 'node:path';import {pathToFileURL} from 'node:url';import {syncBuiltinESMExports} from 'node:module';import {createHash} from 'node:crypto';
const [root,mode]=process.argv.slice(1),url=pathToFileURL(resolve('scripts/enterprise/runtime-preparation.mjs')),hash=b=>createHash('sha256').update(b).digest('hex');
let source=fs.readFileSync(url,'utf8').replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g,(_,q,p)=>'from '+JSON.stringify(new URL(p,url).href)).replaceAll('import.meta.url',JSON.stringify(url.href));
const m=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {uInvocationOwners,writeUComponentInvocation,readUInvocationHistory,componentRegressionCommand};\n//# sourceURL=u-transaction-storage-fixture.mjs').toString('base64'));
const base='evidence/transaction',abs=p=>resolve(root,p),put=(p,v)=>{fs.mkdirSync(dirname(abs(p)),{recursive:true});fs.writeFileSync(abs(p),typeof v==='string'?v:JSON.stringify(v,null,2)+'\n');},read=p=>JSON.parse(fs.readFileSync(abs(p),'utf8'));
const paths=m.componentRegressionCommand.slice(6);for(const p of paths)put(p,"import test from 'node:test';import assert from 'node:assert/strict';test('synthetic auxiliary',()=>assert.equal(2+2,4));\n");
const corpus='tests/enterprise/rejected-regeneration.test.mjs';put(corpus,"import test from 'node:test';import assert from 'node:assert/strict';test('synthetic U transaction',async t=>{for(let i=0;i<85;i++)await t.test('fixture leaf '+i,()=>assert.ok(i>=0));});\n");
const scope={scopeId:'U-I1a-v1',caseBindings:Array.from({length:85},(_,i)=>({variants:[{variantId:'fixture-'+i,testPath:[{ordinal:7,name:'synthetic U transaction'},{ordinal:i+1,name:'fixture leaf '+i}]}]}))};
let authCalls=0,hook=()=>{},injected=false;const authenticate=async()=>{authCalls++;await Promise.resolve();hook();};
const make=()=>{const owner=Object.freeze({});m.uInvocationOwners.set(owner,{root,base,binding:{identity:{node:process.execPath,runSlug:'synthetic-storage-only'},inputs:{digest:hash(fs.readFileSync(abs(corpus)))},scope},authenticate,used:false});return owner;};
const artifacts=()=>{const all=[];const walk=p=>{for(const n of fs.readdirSync(abs(p)).sort()){const q=p+'/'+n,s=fs.lstatSync(abs(q));if(s.isDirectory())walk(q);else if(s.isFile()){const b=fs.readFileSync(abs(q));all.push({path:q,sha256:hash(b),bytes:b.length,data:b.toString('base64')});}}};if(fs.existsSync(abs(base)))walk(base);for(const p of paths){const b=fs.readFileSync(abs(p));all.push({path:p,sha256:hash(b),bytes:b.length,data:b.toString('base64')});}return all;};
let result,error=null;const call=async()=>{try{return await m.writeUComponentInvocation(make());}catch(e){return {failure:e.message,recordingError:e.recordingError??null,cleanupErrors:e.cleanupErrors??[],transaction:e.transaction??null};}};
try{
 if(mode==='forged'){await assert.rejects(m.writeUComponentInvocation({}),/private one-use/);assert.ok(!fs.existsSync(abs(base)));result={refused:true};}
 else if(mode==='one-use'){const owner=make();result=await m.writeUComponentInvocation(owner);await assert.rejects(m.writeUComponentInvocation(owner),/private one-use/);await assert.rejects(m.writeUComponentInvocation({...owner}),/private one-use/);}
 else if(mode==='positive'||mode==='failed-then-pass'){
  if(mode==='failed-then-pass')fs.appendFileSync(abs(corpus),"test('intentional failure',()=>assert.fail('synthetic failure'));\n");
  const first=await call();if(mode==='failed-then-pass'){assert.match(first.failure,/child exit/);assert.equal(first.transaction.invocations[0].status,'FAILED');assert.ok(!fs.existsSync(abs(base+'/writer.lock')));fs.writeFileSync(abs(corpus),fs.readFileSync(abs(corpus),'utf8').replace("test('intentional failure',()=>assert.fail('synthetic failure'));\n",''));}else assert.equal(first.sequence,1,first.failure);
  const prior=artifacts().filter(x=>x.path.startsWith(base+'/invocations/1/'));result=await m.writeUComponentInvocation(make());assert.equal(result.sequence,2);assert.deepEqual(result.invocations.map(x=>x.status),[mode==='positive'?'PASSED':'FAILED','PASSED']);assert.deepEqual(artifacts().filter(x=>x.path.startsWith(base+'/invocations/1/')),prior);
 }else if(mode==='history-snapshot-drift'||mode==='history-snapshot-inode'){
  await m.writeUComponentInvocation(make());const originalRead=fs.readFileSync;let reads=0;
  fs.readFileSync=(p,...args)=>{const b=originalRead(p,...args);if(String(p).endsWith('/'+base+'/journal.json')&&++reads===2){if(mode==='history-snapshot-drift')fs.appendFileSync(p,' ');else{fs.renameSync(p,p+'.old');fs.writeFileSync(p,b,{mode:0o600});fs.unlinkSync(p+'.old');}injected=true;}return b;};syncBuiltinESMExports();
  result=await call();assert.ok(injected,'snapshot race reached');assert.match(result.failure,/U transaction (pin reference|snapshot identity|pin identity)/);assert.ok(!fs.existsSync(abs(base+'/invocations/2')));assert.ok(!fs.existsSync(abs(base+'/writer.lock')));
 }else if(mode.startsWith('readonly-')){
  await m.writeUComponentInvocation(make());if(mode==='readonly-reject')put(base+'/unreferenced.json',{});const before=artifacts();
  for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[k]=()=>{throw Error('READONLY_SUBPROCESS');};
  for(const k of ['appendFile','chmod','chown','copyFile','cp','ftruncate','futimes','link','mkdir','mkdtemp','rename','rm','rmdir','symlink','truncate','unlink','utimes','write','writev','writeFile'])for(const n of [k,k+'Sync'])if(fs[n])fs[n]=()=>{throw Error('READONLY_WRITE');};
  const open=fs.openSync;fs.openSync=(p,flags,...rest)=>{assert.equal(flags,'r','readonly open flags');return open(p,flags,...rest);};syncBuiltinESMExports();
  if(mode==='readonly-success'){result=m.readUInvocationHistory(root,base);assert.equal(result.sequence,1);}else{assert.throws(()=>m.readUInvocationHistory(root,base),/unreferenced or missing file/);result={refused:true};}assert.deepEqual(artifacts(),before);
 }else if(mode.startsWith('history-')){
  await m.writeUComponentInvocation(make());const before=artifacts();
  if(mode==='history-lock')put(base+'/writer.lock','foreign');
  if(mode==='history-started'){const j=read(base+'/journal.json');j.events.pop();put(base+'/journal.json',j);}
  if(mode==='history-metadata')put(base+'/extra.json',{});
  if(mode==='history-directory')fs.mkdirSync(abs(base+'/empty'));
  if(mode==='history-symlink')fs.symlinkSync(abs(corpus),abs(base+'/alias'));
  if(mode==='history-missing')fs.unlinkSync(abs(base+'/invocations/1/outputs/stderr.log'));
  if(mode==='history-terminal')fs.unlinkSync(abs(base+'/invocations/1/terminal.json'));
  if(mode==='history-head'){const j=read(base+'/journal.json');j.events[1].head='0'.repeat(64);put(base+'/journal.json',j);}
  if(mode==='history-fake-pass'){
   const p=base+'/invocations/1',ref=q=>{const b=fs.readFileSync(abs(q));return {path:q,sha256:hash(b),bytes:b.length};},save=(q,v)=>{put(q,v);return ref(q);};
   const e=read(p+'/outputs/execution.json');e.status=7;const er=save(p+'/outputs/execution.json',e),inv=read(p+'/inventory.json');inv.entries=inv.entries.map(r=>ref(r.path));inv.digest=hash(JSON.stringify(inv.entries));const ir=save(p+'/inventory.json',inv),term=read(p+'/terminal.json');term.execution=er;term.inventory=ir;const tr=save(p+'/terminal.json',term),j=read(base+'/journal.json');j.events[1].terminal=tr;j.events[1].head=hash(JSON.stringify({previousHead:term.previousHead,sequence:1,start:term.start,terminal:tr}));put(base+'/journal.json',j);
  }
  const changed=artifacts();result=await call();assert.ok(result.failure,'must refuse altered history');assert.deepEqual(artifacts(),changed,'refusal must not repair');
 }else{
  const original={spawn:cp.spawn,write:fs.writeFileSync,sync:fs.fsyncSync,rename:fs.renameSync,read:fs.readFileSync};
  const fault=()=>Object.assign(new Error('injected '+mode),{code:'EIO'});
  if(mode==='pre-spawn')hook=()=>{if(!injected&&fs.existsSync(abs(base+'/journal.json'))){injected=true;throw fault();}};
  if(mode==='authority-lost')hook=()=>{if(fs.existsSync(abs(base+'/journal.json'))){injected=true;throw fault();}};
  if(mode==='post-terminal-authority')hook=()=>{if(fs.existsSync(abs(base+'/journal.json'))&&read(base+'/journal.json').events.length===2){injected=true;throw fault();}};
  if(mode==='post-terminal-metadata')hook=()=>{if(!injected&&fs.existsSync(abs(base+'/journal.json'))&&read(base+'/journal.json').events.length===2){injected=true;put(base+'/unexpected.json',{});}};
  if(mode==='start-rename')fs.renameSync=(p,...a)=>{if(String(p).endsWith('/journal.pending')&&!injected){injected=true;throw fault();}return original.rename(p,...a);};
  if(mode==='start-fsync')fs.fsyncSync=fd=>{if(fs.existsSync(abs(base+'/journal.pending'))&&!injected){injected=true;throw fault();}return original.sync(fd);};
  if(mode==='release-fsync')fs.fsyncSync=fd=>{if(!injected&&fs.existsSync(abs(base+'/invocations/1/terminal.json'))&&!fs.existsSync(abs(base+'/writer.lock'))){injected=true;throw fault();}return original.sync(fd);};
  if(mode==='start-readback')fs.readFileSync=(p,...a)=>{const r=original.read(p,...a);if(String(p).endsWith('/start.json')&&!injected){injected=true;return Buffer.from('altered readback');}return r;};
  if(mode==='stream'||mode==='stream-cleanup')fs.writeFileSync=(p,...a)=>{if(typeof p==='number'&&String(a[0]).includes('TAP version')&&!injected){injected=true;throw fault();}return original.write(p,...a);};
  if(mode==='stream-cleanup'){const open=fs.openSync,close=fs.closeSync,fds=new Set();fs.openSync=(p,...a)=>{const fd=open(p,...a);if(a[0]==='wx'&&/outputs\/(stdout.tap|stderr.log)$/.test(String(p)))fds.add(fd);return fd;};fs.closeSync=fd=>{if(fds.has(fd))throw Error('injected cleanup close');return close(fd);};}
  if(mode==='terminal-write')fs.writeFileSync=(p,...a)=>{if(String(a[0]).includes('"previousHead"')&&!injected){injected=true;throw fault();}return original.write(p,...a);};
  if(['lock-drift','journal-drift','output-inode','output-bytes','competing','child-signal','spawn'].includes(mode))cp.spawn=(...a)=>{
   if(mode==='spawn'){injected=true;throw fault();}
   assert.equal(read(base+'/journal.json').events.at(-1).status,'STARTED');assert.ok(fs.existsSync(abs(base+'/invocations/1/start.json')),'STARTED precedes spawn');const c=original.spawn(...a);injected=true;
   if(mode==='lock-drift')fs.appendFileSync(abs(base+'/writer.lock'),' ');
   if(mode==='journal-drift')fs.appendFileSync(abs(base+'/journal.json'),' ');
   if(mode==='output-inode'){const p=abs(base+'/invocations/1/outputs/stdout.tap');fs.renameSync(p,p+'.old');fs.writeFileSync(p,'');}
   if(mode==='output-bytes')c.on('close',()=>fs.appendFileSync(abs(base+'/invocations/1/outputs/stdout.tap'),'changed after EOF'));
   if(mode==='competing')m.writeUComponentInvocation(make()).then(()=>{throw Error('competing writer accepted');},e=>assert.match(e.message,/active or unresolved writer/));
   if(mode==='child-signal')c.kill('SIGTERM');return c;
  };
  syncBuiltinESMExports();result=await call();assert.ok(injected,'injection reached boundary');
  if(mode==='competing')assert.equal(result.sequence,1,result.failure);else assert.ok(result.failure,'injection must refuse');
  if(mode==='pre-spawn'){assert.equal(result.transaction.invocations[0].status,'FAILED');const term=read(base+'/invocations/1/terminal.json');assert.equal(term.cause.stage,'PRE_SPAWN');assert.equal(term.execution,null);assert.deepEqual(read(base+'/invocations/1/inventory.json').entries,[]);}
  if(mode==='authority-lost'){assert.match(result.failure,/injected authority-lost/);assert.match(result.recordingError,/injected authority-lost/);}
  if(mode==='stream-cleanup'){assert.match(result.failure,/injected stream-cleanup/);assert.match(result.recordingError,/output completion unknown/);assert.equal(result.cleanupErrors.length,2);}
  if(!['pre-spawn','competing','child-signal'].includes(mode))assert.ok(fs.existsSync(abs(base+'/writer.lock')),'unknown closure retains fence');
 }
 if(result?.kind){assert.equal(result.provenanceAuthenticated,false);assert.equal(result.reviewReady,false);assert.equal(result.productVerified,false);}
}catch(e){error=e.message;process.exitCode=1;}finally{console.log(JSON.stringify({mode,result,error,authCalls,artifacts:artifacts(),syntheticAuthentication:true,actualUCandidate:false}));}
`;
 const modes=['positive','failed-then-pass','one-use','forged','readonly-success','readonly-reject','history-snapshot-drift','history-snapshot-inode','history-lock','history-started','history-metadata','history-directory','history-symlink','history-missing','history-terminal','history-head','history-fake-pass','pre-spawn','authority-lost','post-terminal-authority','post-terminal-metadata','start-rename','start-fsync','start-readback','stream','stream-cleanup','terminal-write','lock-drift','journal-drift','output-inode','output-bytes','release-fsync','competing','child-signal','spawn'];
 for(const mode of modes)await t.test('U transaction '+mode,()=>{
  const root=fs.mkdtempSync(join(tmpdir(),'u-transaction-')),env={...process.env};delete env.NODE_TEST_CONTEXT;fs.mkdirSync(join(root,'evidence'));try{const r=spawnSync(process.execPath,['--input-type=module','-e',program,root,mode],{cwd:process.cwd(),env,encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024});t.diagnostic(r.stdout.trim());const d=r.stdout?JSON.parse(r.stdout):null;assert.equal(r.status,0,r.stderr.slice(-3000)+'\n'+d?.error);assert.equal(d.error,null);}finally{fs.rmSync(root,{recursive:true,force:true});}
 });
});
