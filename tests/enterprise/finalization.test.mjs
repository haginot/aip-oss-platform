import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawnSync,spawn} from 'node:child_process';
import {registerProject} from '../../node_modules/takt/dist/infra/config/global/projectRegistry.js';
import {resolveStatePaths,resolveRunPaths} from '../../node_modules/takt/dist/core/execution/locations.js';
import {prepareWorkflowExecutionBundle,publishWorkflowExecutionBundle} from '../../node_modules/takt/dist/features/tasks/execute/workflowExecutionBundle.js';
import {savePersonaSessions} from '../../node_modules/takt/dist/infra/config/project/sessionStore.js';
import {runSingleWorkflowIteration} from '../../node_modules/takt/dist/core/workflow/engine/WorkflowRunLoop.js';
import {createInitialState} from '../../node_modules/takt/dist/core/workflow/engine/state-manager.js';
import {runCommandQualityGate} from '../../node_modules/takt/dist/core/workflow/quality-gates/commandGateRunner.js';
import {hash,parseTap} from '../../scripts/enterprise/evidence.mjs';
import {normalizeWorkflowConfig} from '../../node_modules/takt/dist/infra/config/loaders/workflowParser.js';

import {fixture,put,read,tree} from './evidence-fixture.mjs';
import './batch-id.test.mjs';

function final(f,args=['final','--check-report'],success=true,pattern) {
 const before=tree(f.temporary),r=f.cli(args);assert.deepEqual(tree(f.temporary),before,'final filesystem bytes/dirs/mtime unchanged');
 assert.ok(!r.stderr.includes('FS_MUTATION'),r.stderr);assert.equal(r.status,success?0:1,r.stderr);if(pattern)assert.match(r.stderr,pattern);return r;
}
const latest=f=>read(join(f.root,'evidence/enterprise/releases/index.json')).attempts.at(-1);
const seal=f=>read(join(f.root,latest(f).sealPath));

test('same-R-review-and-final-gate',async t=>{const f=await fixture(t);f.report();const r=final(f);assert.equal(JSON.parse(r.stdout).releaseDigest,f.sealed.releaseDigest);});
test('changed-input-rejected',async t=>{const f=await fixture(t);f.report();put(join(f.root,'src/domain.mjs'),'changed');final(f,undefined,false,/changed input/);});
test('changed-receipt-rejected',async t=>{const f=await fixture(t);f.report();fs.appendFileSync(join(f.root,seal(f).receipts[0].path),' ');final(f,undefined,false,/changed receipt/);});
test('changed-output-rejected',async t=>{const f=await fixture(t);f.report();put(join(f.root,seal(f).outputs.entries[0].path),'forged');final(f,undefined,false,/changed output|changed stderr/);});
test('R-approved-R-prime-latest-rejected',async t=>{const f=await fixture(t);f.report();const old=f.attest();f.context('harden-release');const r=f.cli(['all','--seal'],{readonly:false});assert.equal(r.status,0,r.stderr);f.report({releaseId:old.releaseId,releaseDigest:old.releaseDigest});final(f,undefined,false,/report releaseId|report releaseDigest/);});
test('latest-failed-rejected',async t=>{const f=await fixture(t);f.report();f.context('harden-release');put(join(f.root,'tests/assertion.test.mjs'),"import test from 'node:test';test('real arithmetic assertion',()=>{throw Error('injected release failure')});\n");const failed=f.cli(['all','--seal'],{readonly:false});assert.equal(failed.status,1);assert.equal(latest(f).status,'failed');f.context('final-audit');final(f,undefined,false,/latest release failed or running/);});
test('latest-running-rejected',async t=>{const f=await fixture(t);f.report();const p=join(f.root,'evidence/enterprise/releases/index.json'),i=read(p);i.attempts.push({releaseId:'later',status:'running'});put(p,i);final(f,undefined,false,/latest release failed or running/);});
test('missing-or-incomplete-report-rejected',async t=>{const f=await fixture(t);f.context('final-audit');final(f,undefined,false,/ENOENT/);f.report({}, {incomplete:true});final(f,undefined,false,/missing or incomplete/);});
test('changed-review-report-rejected',async t=>{const f=await fixture(t);f.report();fs.appendFileSync(join(f.run.reportsAbs,'enterprise-06-final-audit.md'),'changed');final(f,undefined,false,/changed review report/);});
test('same-provider-session-rejected',async t=>{const f=await fixture(t);f.report({providerSessionId:'builder-session'});f.sessions[JSON.stringify(['enterprise-final-auditor','codex','gpt-6-astra'])]='builder-session';savePersonaSessions(f.root,f.sessions,'codex',f.paths.sessionsDirectory);final(f,undefined,false,/separate provider session/);});
test('wrong-run-or-stale-iteration-rejected',async t=>{const f=await fixture(t);f.report({runSlug:'other-run'});final(f,undefined,false,/report runSlug/);f.report({}, {iteration:3});final(f,undefined,false,/report iteration/);f.report();const p=f.records.findLast(r=>r.type==='phase_complete'&&r.phase===1);p.content=p.content.replace('"iteration": 2','"iteration": 1');f.append({type:'fixture-checkpoint'});final(f,undefined,false,/phase identity iteration/);});
test('self-asserted-session-rejected',async t=>{const f=await fixture(t);f.report({providerSessionId:'invented-provider-session'});final(f,undefined,false,/report providerSessionId/);});
test('final-success-zero-filesystem-writes',async t=>{const f=await fixture(t);f.report();final(f);});
test('final-failure-zero-filesystem-writes',async t=>{const f=await fixture(t);f.report({verdict:'REQUEST_CHANGES'});final(f,undefined,false,/final approval required/);});
test('ENT-705-no-preapproval-cycle',async t=>{const f=await fixture(t);assert.equal(seal(f).approvals.length,0);final(f,['final','--check-seal']);assert.equal(fs.existsSync(join(f.run.reportsAbs,'enterprise-06-final-audit.md')),false);});
test('legacy-all-final-dispatch-readonly',async t=>{const f=await fixture(t);f.report();assert.equal(JSON.parse(final(f,['all']).stdout).releaseDigest,f.sealed.releaseDigest);});
test('legacy-all-release-seals',async t=>{const f=await fixture(t);assert.equal(f.sealed.status,'MACHINE_EVIDENCE_SEALED');assert.equal(latest(f).sealDigest,f.sealed.releaseDigest);});
test('unknown-context-fails-before-write',async t=>{const f=await fixture(t);f.context('unknown');final(f,['all'],false,/unknown effective step|unknown effective|unknown/);});
test('explicit-seal-during-final-rejected',async t=>{const f=await fixture(t);f.report();final(f,['all','--seal'],false,/explicit seal during final/);});
test('concurrent-change-rejected',async t=>{
 const f=await fixture(t);f.report();
 const child=spawn(process.execPath,['--import',f.guardPath,join(f.root,'scripts/enterprise/verify.mjs'),'final','--check-report'],{cwd:f.root,env:{...f.env,INJECT_CONCURRENT:'1'},stdio:['ignore','pipe','pipe']});
 let out='',err='',injected=false;child.stdout.on('data',data=>{out+=data;if(!injected&&out.includes('CONCURRENT_READY')){injected=true;put(join(f.root,'src/domain.mjs'),'concurrent outside writer');}});child.stderr.on('data',data=>err+=data);
 const status=await new Promise(resolve=>child.on('exit',resolve));assert.ok(injected);assert.equal(status,1,err);assert.match(err,/concurrent input change/);assert.ok(!err.includes('FS_MUTATION'));
});
test('report-phase-before-command-gate',async t=>{
 const f=await fixture(t);const events=[];const step=f.workflow.steps[1];
 const state=createInitialState({...f.workflow,initialStep:'final-audit'},{projectCwd:f.root});state.iteration=1;
 const provider={provider:'codex',model:'gpt-6-astra'};
 // Real TAKT run loop, scripted provider boundary: report is persisted within runStep;
 // the real command-gate callback then launches the unchanged product CLI.
 const result=await runSingleWorkflowIteration({state,options:{projectCwd:f.root},getWorkflowName:()=>f.workflow.name,getTask:()=> 'synthetic fixture',getCurrentWorkflowStack:()=>f.stack(step.name),getCwd:()=>f.root,getMaxSteps:()=>5,getReportDir:()=>f.run.reportsAbs,abortRequested:()=>false,getStep:()=>step,
 applyRuntimeEnvironment:()=>{},loopDetectorCheck:()=>({count:0,isLoop:false}),cycleDetectorRecordAndCheck:()=>({triggered:false,cycleCount:0}),resolveDoneTransition:()=>({nextStep:'COMPLETE'}),
 resolveStepProviderModel:()=>provider,resolveStepProviderModelBeforeAutoRouting:()=>provider,resolveRuntimeForStep:()=>undefined,claimStepOccurrence:()=>{state.stepIterations.set(step.name,1);return 1;},setActiveStep:()=>undefined,cancelPendingStepActivation:()=>{},prepareNormalStepExecution:async()=>undefined,prepareInstruction:()=>({text:'fixture'}),buildPhase1Instruction:(_,s)=>s,
 runStep:async()=>{events.push('phase1');f.report();events.push('phase2-report-written');return {response:{persona:step.persona,status:'done',content:'fixture approval',timestamp:new Date()},instruction:'fixture'};},
 runQualityGates:async()=>{events.push('command-gate');const before=tree(f.temporary);const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";const command=['env',`TAKT_CONFIG_DIR=${f.global}`,process.execPath,'--import',f.guardPath,join(f.root,'scripts/enterprise/verify.mjs'),'all'].map(quote).join(' ');const result=await runCommandQualityGate({gate:{type:'command',command,timeoutMs:20000},projectRoot:f.root});assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(tree(f.temporary),before,'TAKT command gate preserves fixture');return result;},persistPreviousResponseSnapshot:()=>{},emit:()=>{},updateMaxSteps:()=>{},addUserInput:()=>{},
 });assert.equal(result.isComplete,true);assert.equal(result.nextStep,'COMPLETE');assert.deepEqual(events,['phase1','phase2-report-written','command-gate']);
});

// All approval-looking values below belong to isolated synthetic TAKT registries.
// Nothing in these fixtures approves product evidence or modifies the live run.
test('B22-seal-before-final-review-with-prior-batch',async t=>{
 const f=await fixture(t,{multi:true});const s=seal(f);
 assert.deepEqual(s.approvals.map(a=>a.batchId),['B00']);
 assert.notEqual(s.receipts.find(r=>r.batchId==='B00').runId,f.reviewed.id);
 for(const suite of f.reviewed.suites)assert.ok(s.outputRoots.includes(suite.outputDirectory));
 f.report();final(f);
 f.report({approvedLeafIds:['ENT-101','ENT-705']});final(f,undefined,false,/approved leaves/);
 f.report();final(f);
});
test('batch-review-authority-and-exact-scope',async t=>{
 const cases=[
  ['invented-session',{providerSessionId:'invented-reviewer-session'},{},/actual provider session/],
  ['design-only',{}, {content:'APPROVE — architecture only; no implementation approval'},/single enterprise batch attestation/],
  ['request-changes',{verdict:'REQUEST_CHANGES'},{},/batch report verdict/],
  ['wrong-run',{runSlug:'previous-run'},{},/batch report runSlug/],
  ['wrong-iteration',{iteration:99},{},/occurrence missing/],
  ['wrong-scope',{approvedIssueIds:['ENT-102']},{},/Issue scope/],
  ['wrong-receipt',{receiptSha256:'0'.repeat(64)},{},/receipt bytes/],
  ['wrong-output',{outputsDigest:'0'.repeat(64)},{},/outputsDigest/],
  ['unresolved',{unresolvedFindings:['BF-01']},{},/unresolved batch findings/],
  ['incomplete',{}, {incomplete:true},/incomplete batch review/],
  ['phase-mismatch',{}, {phase1:'architecture-only review'},/single enterprise batch attestation/],
 ];
 for(const [name,batchOverrides,batchOptions,pattern] of cases)await t.test(name,async t=>{
  const f=await fixture(t,{multi:true,seal:false,batchOverrides,batchOptions});
  const r=f.cli(['all'],{readonly:false});assert.equal(r.status,1,r.stdout);assert.match(r.stderr,pattern);
  assert.equal(latest(f).status,'failed');
 });
});
test('batch-review-report-tamper-and-supersession',async t=>{
 const f=await fixture(t,{multi:true,seal:false});
 // Rehashing a forged local report cannot make it the orchestrator's phase 2.
 const path=join(f.root,f.approval.report);fs.appendFileSync(path,'forged addition');
 const progressPath=join(f.root,'work/enterprise/progress.json'),progress=read(progressPath);
 progress.approvals.B00.reportHash=hash(fs.readFileSync(path));put(progressPath,progress);
 let r=f.cli(['all'],{readonly:false});assert.equal(r.status,1);assert.match(r.stderr,/differs from orchestrator/);
 fs.copyFileSync(join(f.run.reportsAbs,'enterprise-04-review.md'),path);
 progress.approvals.B00.reportHash=hash(fs.readFileSync(path));put(progressPath,progress);
 f.context('review-foundation',4);
 f.append({type:'phase_complete',step:'review-foundation',iteration:4,workflow:f.workflow.name,stack:f.stack('review-foundation'),phase:1,status:'done',content:'REQUEST_CHANGES: additional batch defect'});
 f.context('harden-release',5);r=f.cli(['all'],{readonly:false});assert.equal(r.status,1);assert.match(r.stderr,/later batch review scope unavailable/);
});
test('prior-batch-approval-required-for-seal',async t=>{
 const f=await fixture(t,{multi:true,seal:false});const path=join(f.root,'work/enterprise/progress.json'),p=read(path);p.approvals={};put(path,p);
 const r=f.cli(['all'],{readonly:false});assert.equal(r.status,1);assert.match(r.stderr,/independent batch approval required/);
});
test('reviewed-R1-output-tamper-after-R2-seal',async t=>{
 for(const kind of ['stdout','artifact','deleted-directory'])await t.test(kind,async t=>{
  const f=await fixture(t,{multi:true});f.report();const suite=f.reviewed.suites[0];
  if(kind==='deleted-directory')fs.rmSync(join(f.root,suite.outputDirectory),{recursive:true});
  else put(join(f.root,kind==='stdout'?suite.stdout:suite.outputDirectory+'/artifacts/actual.json'),'tampered reviewed output');
  final(f,undefined,false,/changed stdout|changed output|ENOENT/);
 });
});
test('reviewed-R1-output-tamper-before-R2-seal',async t=>{
 const f=await fixture(t,{multi:true,seal:false});put(join(f.root,f.reviewed.suites[0].stdout),'tampered');
 const r=f.cli(['all'],{readonly:false});assert.equal(r.status,1);assert.match(r.stderr,/changed output/);
});

function selectionProgress(f,change) {
 const path=join(f.root,'work/enterprise/progress.json'),p=read(path);change(p);put(path,p);return p;
}
function selectionAttempt(f,args,pattern) {
 const paths=['work/enterprise/progress.json','evidence/enterprise/runs/index.json'];
 const before=paths.map(p=>fs.readFileSync(join(f.root,p),'utf8'));
 const r=f.cli(args,{readonly:false});assert.equal(r.status,1,r.stdout);assert.match(r.stderr,pattern);
 assert.deepEqual(paths.map(p=>fs.readFileSync(join(f.root,p),'utf8')),before,'rejection preserves progress and run index');
 assert.ok(!r.stdout.includes('[B'),'rejection precedes suite execution');return r;
}
async function selectedFixture(t) {
 const f=await fixture(t,{multi:true,seal:false,selection:true});f.context('build-foundation',4);
 selectionProgress(f,p=>{p.activeBatchId=null;});
 const r=f.cli(['batch','--batch','B01'],{readonly:false});assert.equal(r.status,0,r.stderr);
 return f;
}
test('BF-04-forged-active-batch-rejected-before-evidence',async t=>{
 const f=await fixture(t,{multi:true,seal:false,selection:true});f.context('build-foundation',4);
 selectionProgress(f,p=>{p.activeBatchId='B01';p.approvals={};p.entryInputs='forged';p.entryApprovals='forged';});
 selectionAttempt(f,['batch','--batch','B01','--validate-only'],/authenticated batch selection required/);
 selectionAttempt(f,['batch','--batch','B01'],/authenticated batch selection required/);
 selectionProgress(f,p=>{p.activeBatchId=null;p.approvals={B00:{}};});
 selectionAttempt(f,['batch','--batch','B01'],/independent approval required/);
});
test('BF-04-authenticated-selection-resumes-after-edit-and-reload',async t=>{
 const f=await selectedFixture(t),p=read(join(f.root,'work/enterprise/progress.json'));
 const proof=fs.readFileSync(join(f.root,p.entrySelection),'utf8');
 assert.equal(JSON.parse(proof).predecessors[0].runId,f.reviewed.id);
 put(join(f.root,'src/domain.mjs'),'edited after authenticated selection');
 // A fresh process resumes B01 with its authentic old-input prerequisite, then
 // actually reruns both B00 and B01 against current inputs. No review cycle.
 const r=f.cli(['batch'],{readonly:false});assert.equal(r.status,0,r.stderr);
 const updated=read(join(f.root,'work/enterprise/progress.json'));
 assert.equal(updated.activeBatchId,'B01');assert.equal(updated.entrySelection,p.entrySelection);
 assert.equal(fs.readFileSync(join(f.root,p.entrySelection),'utf8'),proof);
 assert.deepEqual(updated.lastGate.runs.map(r=>r.batchId),['B00','B01']);
 assert.notEqual(updated.lastGate.runs[0].inputsDigest,f.reviewed.inputs.digest);
 assert.equal(updated.issues['ENT-701'].status,'READY_FOR_REVIEW');
 assert.equal(f.cli(['batch','--validate-only'],{readonly:false}).status,0);
 // Entry approval is historical; it cannot authorize starting a further batch.
 selectionProgress(f,p=>{p.activeBatchId=null;p.approvals.B01={verdict:'APPROVE'};});
 selectionAttempt(f,['batch','--batch','B02'],/stale review source/);
});
test('BF-04-selection-proof-tampering-rejected',async t=>{
 const f=await selectedFixture(t),original=read(join(f.root,'work/enterprise/progress.json'));
 const path=join(f.root,original.entrySelection),raw=fs.readFileSync(path,'utf8');
 const cases=[
  ['empty',()=>({}),/selection schema/],
  ['missing-predecessor',s=>({...s,predecessors:[]}),/selection prerequisite set/],
  ['wrong-batch',s=>({...s,batchId:'B02'}),/selection batch mismatch/],
  ['wrong-input',s=>({...s,inputsDigest:'forged'}),/selection entry input mismatch/],
  ['forged-approval',s=>({...s,predecessors:s.predecessors.map(p=>({...p,approval:{}}))}),/independent approval required/],
  ['forged-plan',s=>{const plan=JSON.parse(s.planText);plan.issues[0].originalAcceptance=['forged'];return {...s,planText:JSON.stringify(plan)};},/selection plan not reviewed/],
  ['forged-receipt',s=>({...s,predecessors:s.predecessors.map(p=>({...p,runId:'missing'}))}),/ENOENT/],
 ];
 for(const [name,mutate,pattern] of cases)await t.test(name,()=>{
   put(path,mutate(JSON.parse(raw)));put(join(f.root,'work/enterprise/progress.json'),{...original,entrySelectionHash:hash(fs.readFileSync(path))});
   selectionAttempt(f,['batch'],pattern);
 });
 fs.writeFileSync(path,raw);put(join(f.root,'work/enterprise/progress.json'),{...original,activeBatchId:'B02'});
 selectionAttempt(f,['batch'],/selection batch mismatch/);
 put(join(f.root,'work/enterprise/progress.json'),{...original,entrySelection:'evidence/enterprise/missing-selection.json'});
 selectionAttempt(f,['batch'],/ENOENT/);
 put(join(f.root,'work/enterprise/progress.json'),original);fs.appendFileSync(path,' ');
 selectionAttempt(f,['batch'],/changed batch selection/);
});
test('BF-04-selection-rechecks-authentic-review-and-old-output',async t=>{
 const f=await selectedFixture(t),p=read(join(f.root,'work/enterprise/progress.json'));
 const stdout=join(f.root,f.reviewed.suites[0].stdout),raw=fs.readFileSync(stdout);
 put(stdout,'tampered entry evidence');selectionAttempt(f,['batch'],/changed output/);fs.writeFileSync(stdout,raw);
 const selectionPath=join(f.root,p.entrySelection),s=read(selectionPath),reportPath=join(f.root,s.predecessors[0].approval.report);
 fs.appendFileSync(reportPath,'forged report');s.predecessors[0].approval.reportHash=hash(fs.readFileSync(reportPath));put(selectionPath,s);
 selectionProgress(f,p=>{p.entrySelectionHash=hash(fs.readFileSync(selectionPath));});
 selectionAttempt(f,['batch'],/differs from orchestrator/);
});

// Compile real TAKT YAML input before publishing the fixture bundle. A raw
// capabilities:'readonly' test double hid the production approval-consumption bug.
test('compiled-readonly-review-can-select-next-batch',async t=>{
 const f=await selectedFixture(t);
 const definition=f.workflow.steps.find(s=>s.name==='review-foundation');
 assert.equal(Object.hasOwn(definition,'capabilities'),false);
 assert.equal(definition.edit,false);
 assert.deepEqual(definition.capabilityProviderOptions.codex,{networkAccess:true});
 assert.equal(read(join(f.root,'work/enterprise/progress.json')).activeBatchId,'B01');
});
const invalidReviewDefinitions=[
 ['editable',{edit:true},/must be readonly/],
 ['missing-edit',{edit:undefined},/must be readonly/],
 ['commit-enabled',{allowGitCommit:true},/commits forbidden/],
 ['raw-label-only',{capabilities:'readonly',capabilityProviderOptions:undefined},/compiled readonly capability/],
 ['empty-capability',{capabilityProviderOptions:{}},/compiled readonly capability/],
 ['expanded-tools',{capabilityProviderOptions:{claude:{allowedTools:['Read','Write']},codex:{networkAccess:true}}},/compiled readonly capability/],
];
test('compiled-batch-review-rejects-invalid-readonly-definition',async t=>{
 for(const [name,reviewDefinition,pattern] of invalidReviewDefinitions)await t.test(name,async t=>{
  const f=await fixture(t,{multi:true,seal:false,selection:true,reviewDefinition});
  f.context('build-foundation',4);selectionProgress(f,p=>{p.activeBatchId=null;});
  selectionAttempt(f,['batch','--batch','B01'],pattern);
 });
});
test('compiled-final-review-rejects-invalid-readonly-definition',async t=>{
 for(const [name,auditDefinition,pattern] of invalidReviewDefinitions)await t.test(name,async t=>{
  const f=await fixture(t,{auditDefinition});f.report();final(f,undefined,false,pattern);
 });
});

test('MON-28-approved B00 and B01 remain valid through B02 selection and automatic gate retry',async t=>{
 const f=await selectedFixture(t),indexPath=join(f.root,'evidence/enterprise/runs/index.json');
 const latest=batchId=>{const e=read(indexPath).runs.filter(r=>r.batchId===batchId).at(-1);return {entry:e,bytes:fs.readFileSync(join(f.root,e.path),'utf8')};};
 const b00=latest('B00');assert.equal(b00.entry.id,f.reviewed.id);
 const b01=latest('B01');f.batchReport({iteration:5},{batchId:'B01',iteration:5});
 f.context('build-foundation',6);selectionProgress(f,p=>{p.activeBatchId=null;});
 for(let n=0;n<2;n++) {
  const result=f.cli(n?['batch']:['batch','--batch','B02'],{readonly:false});assert.equal(result.status,0,result.stderr);
  assert.deepEqual(latest('B00'),b00);assert.deepEqual(latest('B01'),b01);
 }
 const progress=read(join(f.root,'work/enterprise/progress.json')),proof=read(join(f.root,progress.entrySelection));
 assert.deepEqual(proof.predecessors.map(p=>p.runId),[b00.entry.id,b01.entry.id]);
 assert.equal(f.cli(['batch','--validate-only'],{readonly:false}).status,0);
});

// Ordinary writer ownership uses actual isolated TAKT registries and sessions.
// A refusal must precede even a transient lock; the existing FS guard observes it.
test('ordinary-writer-owned-entry-boundaries',async t=>{
 const direct=(f,entry,{readonly=false,session='builder-session',extra=[]}={})=>spawnSync(process.execPath,[...(readonly?['--import',f.guardPath]:[]),'--input-type=module','-e',`import fs from 'node:fs';import {main,runBatchGate} from './scripts/enterprise/verify.mjs';const p=JSON.parse(fs.readFileSync('work/enterprise/plan.json'));console.log(JSON.stringify(await ${entry==='main'?`main(process.cwd(),['batch'],${JSON.stringify(session)})`:`runBatchGate(process.cwd(),p,p.batches[0],${JSON.stringify(session)},false${extra.length?','+JSON.stringify(extra[0]):''})`}));`],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000});
 const refuse=(f,call,pattern)=>{const before=tree(f.temporary),r=call();assert.equal(r.status,1,r.stdout);assert.match(r.stderr,pattern);assert.doesNotMatch(r.stderr,/FS_MUTATION/);assert.deepEqual(tree(f.temporary),before);};
 for(const entry of ['cli','main','runBatchGate'])await t.test('O1-O5 owned '+entry,async t=>{
  const f=await fixture(t,{seal:false});f.context('build-foundation');const r=entry==='cli'?f.cli(['batch'],{readonly:false}):direct(f,entry);assert.equal(r.status,0,r.stderr);
  assert.equal(read(join(f.root,'evidence/enterprise/runs/index.json')).runs.length,1);assert.equal(fs.existsSync(join(f.root,'evidence/enterprise/gate.lock')),false);
 });
 for(const mode of ['batch','all','main','runBatchGate'])for(const variant of ['foreign','missing','malformed','project','workflowRef','bundleDigest','absent'])await t.test('O2-O5 '+mode+' rejects '+variant,async t=>{
  const f=await fixture(t,{seal:false});f.context(mode==='all'?'harden-release':'build-foundation');
  const p=join(f.root,'work/enterprise/progress.json'),v=read(p);
  if(variant==='foreign')v.runBinding.runSlug='foreign-run';else if(variant==='missing')delete v.runBinding;else if(variant==='malformed')v.runBinding=[];else if(variant!=='absent')v.runBinding[variant]='forged';
  if(variant==='absent')fs.unlinkSync(p);else put(p,v);
  refuse(f,()=>['main','runBatchGate'].includes(mode)?direct(f,mode,{readonly:true}):f.cli(mode==='all'?['all','--seal']:['batch','--batch','B00','--validate-only']),/writer (?:progress|binding)/);
 });
 for(const entry of ['main','runBatchGate'])await t.test('O4 supplied session '+entry,async t=>{const f=await fixture(t,{seal:false});f.context('build-foundation');refuse(f,()=>direct(f,entry,{readonly:true,session:'invented-session'}),/writer implementationSession/);});
 await t.test('O5 caller capability cannot bypass wrapper',async t=>{const f=await fixture(t,{seal:false});f.context('build-foundation');refuse(f,()=>direct(f,'runBatchGate',{readonly:true,extra:[{trusted:true}]}),/writer authority overrides/);});
 await t.test('O4 wrong step',async t=>{const f=await fixture(t,{seal:false});refuse(f,()=>f.cli(['batch']),/writer step/);});
 await t.test('O4 missing session',async t=>{const f=await fixture(t,{seal:false});f.context('build-foundation');for(const k of Object.keys(f.sessions))if(k.includes('enterprise-builder'))delete f.sessions[k];savePersonaSessions(f.root,f.sessions,'codex',f.paths.sessionsDirectory);refuse(f,()=>f.cli(['batch']),/session/);});
 await t.test('O2 foreign successor before selection',async t=>{const f=await fixture(t,{seal:false,evidenceBatches:true});f.context('build-foundation');selectionProgress(f,p=>{p.activeBatchId='B01';p.runBinding.runSlug='foreign';});refuse(f,()=>f.cli(['batch']),/writer binding runSlug/);});
 await t.test('O6 lock collision preserves owner',async t=>{const f=await fixture(t,{seal:false});f.context('build-foundation');put(join(f.root,'evidence/enterprise/gate.lock'),'existing owner');const before=tree(f.temporary),r=f.cli(['batch'],{readonly:false});assert.equal(r.status,1);assert.match(r.stderr,/EEXIST|writer lock/);assert.deepEqual(tree(f.temporary),before);});
 for(const kind of ['progress','plan','input','authority'])await t.test('O6 changed '+kind+' at lock acquisition refuses before receipts',async t=>{
  const f=await fixture(t,{seal:false});f.context('build-foundation');const paths={progress:join(f.root,'work/enterprise/progress.json'),plan:join(f.root,'work/enterprise/plan.json'),input:join(f.root,'src/domain.mjs'),authority:f.run.metaAbs};
  const injection=join(f.temporary,'lock-change.mjs');put(injection,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const open=fs.openSync;fs.openSync=function(p,...a){const fd=open.call(this,p,...a);if(String(p).endsWith('/gate.lock'))fs.appendFileSync(${JSON.stringify(paths[kind])},' ');return fd;};syncBuiltinESMExports();`);
  const r=spawnSync(process.execPath,['--import',injection,join(f.root,'scripts/enterprise/verify.mjs'),'batch'],{cwd:f.root,env:f.env,encoding:'utf8'});assert.equal(r.status,1,r.stdout);assert.match(r.stderr,/writer (?:checkpoint|authority)/);assert.equal(fs.existsSync(join(f.root,'evidence/enterprise/runs/index.json')),false);assert.equal(fs.existsSync(join(f.root,'evidence/enterprise/gate.lock')),false);assert.ok(fs.readFileSync(paths[kind],'utf8').endsWith(' '));
 });
 await t.test('O7 suite mutation retains evidence without progress or candidate publication',async t=>{
  const f=await fixture(t,{seal:false});f.context('build-foundation');const p=join(f.root,'work/enterprise/progress.json');const changed={...read(p),concurrent:'outside writer'};
  fs.appendFileSync(join(f.root,'tests/assertion.test.mjs'),`\nwriteFileSync('work/enterprise/progress.json',${JSON.stringify(JSON.stringify(changed))});\n`);
  const r=f.cli(['batch'],{readonly:false});assert.equal(r.status,1,r.stdout);assert.match(r.stderr,/writer checkpoint progress/);assert.deepEqual(read(p),changed);assert.equal(read(join(f.root,'evidence/enterprise/runs/index.json')).runs.length,1);assert.equal(fs.existsSync(join(f.root,'evidence/enterprise/closures')),false);assert.doesNotMatch(r.stdout,/MACHINE_EVIDENCE_CURRENT/);const receipt=read(join(f.root,read(join(f.root,'evidence/enterprise/runs/index.json')).runs[0].path));assert.equal(receipt.status,'failed');assert.match(receipt.error,/writer checkpoint invalidated/);assert.equal(receipt.suites[0].exitCode,0,'real successful subprocess evidence retained');
 });
});

// The seal implementation has an additional awaited approval boundary. Keep
// this regression failing until that publication path is independently reviewed.
test('ordinary-writer-seal-rechecks-projection-before-publication',async t=>{
 const f=await fixture(t,{multi:true,seal:false}),injection=join(f.temporary,'seal-approval-change.mjs');
 put(injection,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';let armed=false,changed=false;const write=fs.writeFileSync,read=fs.readFileSync;
 fs.writeFileSync=function(p,v,...a){const r=write.call(this,p,v,...a);if(String(p).endsWith('/work/enterprise/progress.json')){try{if(JSON.parse(v).lastGate?.mode==='all')armed=true;}catch{}}return r;};
 fs.readFileSync=function(p,...a){const r=read.call(this,p,...a);if(armed&&!changed&&String(p).endsWith('/evidence/enterprise/reviews/B00.md')){changed=true;write('work/enterprise/progress.json',read('work/enterprise/progress.json','utf8')+' ');process.stderr.write('INJECTED_SEAL_APPROVAL_WINDOW\\n');}return r;};syncBuiltinESMExports();`);
 const r=spawnSync(process.execPath,['--import',injection,join(f.root,'scripts/enterprise/verify.mjs'),'all','--seal'],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000});
 assert.match(r.stderr,/INJECTED_SEAL_APPROVAL_WINDOW/);assert.equal(r.status,1,r.stdout);assert.match(r.stderr,/writer checkpoint progress/);
 assert.ok(fs.readFileSync(join(f.root,'work/enterprise/progress.json'),'utf8').endsWith(' '),'concurrent bytes retained');
 const attempts=read(join(f.root,'evidence/enterprise/releases/index.json')).attempts;
 t.diagnostic(JSON.stringify({exitCode:r.status,attemptStatuses:attempts.map(a=>a.status),passedSealWritten:attempts.some(a=>a.status==='passed'),receipts:read(join(f.root,'evidence/enterprise/runs/index.json')).runs.length}));
 assert.equal(attempts.some(a=>a.status==='passed'),false,'no passed seal may be published after concurrent projection change');
});

// SP1-SP10: actual isolated writer/reader processes; injection stays in fixture
// preloads and is not a selectable production authority or fault API.
test('seal-publication-attempt-failure-boundary',async t=>{
 const run=(f,code)=>{
  const injection=join(f.temporary,'publication-fault.mjs');
  put(injection,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const read=fs.readFileSync,write=fs.writeFileSync,open=fs.openSync,rename=fs.renameSync,unlink=fs.unlinkSync;
const names=new Map();let armed=false,fired=false;
fs.openSync=function(p,...a){const fd=open.call(this,p,...a);names.set(fd,String(p));return fd;};
const path=p=>typeof p==='number'?names.get(p):String(p);
const index='evidence/enterprise/releases/index.json';
const status=()=>{try{return JSON.parse(read(index)).attempts.at(-1)?.status;}catch{return null;}};
const fire=()=>{fired=true;process.stderr.write('SP_INJECTED\\n');};
fs.writeFileSync=function(p,v,...a){const r=write.call(this,p,v,...a);if(path(p)?.endsWith('/work/enterprise/progress.json')){try{if(JSON.parse(v).lastGate?.mode==='all')armed=true;}catch{}}return r;};
${code}
syncBuiltinESMExports();`);
  return spawnSync(process.execPath,['--import',injection,join(f.root,'scripts/enterprise/verify.mjs'),'all','--seal'],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000});
 };
 const refuseFinal=f=>{f.context('final-audit',9);final(f,['final','--check-seal'],false,/writer active|latest release failed or running|release terminal duplication/);};
 await t.test('SP3 removed public writer cannot accept forged authority',async t=>{
  const f=await fixture(t,{seal:false}),before=tree(f.temporary);
  const r=spawnSync(process.execPath,['--import',f.guardPath,'--input-type=module','-e',`import * as api from './scripts/enterprise/finalization.mjs';if(typeof api.sealRelease==='function')await api.sealRelease(process.cwd(),{step:'harden-release'},()=>[],async()=>{},{trusted:true,checkpoint:()=>{}});else throw Error('NO_PUBLIC_SEAL_WRITER');`],{cwd:f.root,env:f.env,encoding:'utf8'});
  assert.equal(r.status,1);assert.match(r.stderr,/NO_PUBLIC_SEAL_WRITER/);assert.doesNotMatch(r.stderr,/FS_MUTATION/);assert.deepEqual(tree(f.temporary),before);
 });
 for(const multi of [true,false])for(const kind of ['progress','plan','input','authority'])await t.test(`SP2 ${multi?'approval':'no-prior-approval'} ${kind}`,async t=>{
  const f=await fixture(t,{multi,seal:false});
  const paths={progress:join(f.root,'work/enterprise/progress.json'),plan:join(f.root,'work/enterprise/plan.json'),input:join(f.root,'src/domain.mjs'),authority:f.run.metaAbs};
  const code=`fs.readFileSync=function(p,...a){const r=read.call(this,p,...a);if(armed&&!fired&&String(p).endsWith(${JSON.stringify(multi?'/evidence/enterprise/reviews/B00.md':'/work/enterprise/plan.json')})){fire();write(${JSON.stringify(paths[kind])},read(${JSON.stringify(paths[kind])},'utf8')+' ');}return r;};`;
  const r=run(f,code);assert.equal(r.status,1,r.stdout);assert.match(r.stderr,/SP_INJECTED/);assert.match(r.stderr,multi&&['plan','input'].includes(kind)?/stale source\/config\/test\/plan/:/writer (checkpoint|authority)/);assert.ok(fs.readFileSync(paths[kind],'utf8').endsWith(' '));
  assert.equal(read(join(f.root,'evidence/enterprise/releases/index.json')).attempts.some(a=>a.status==='passed'),false);refuseFinal(f);
 });
 for(const kind of ['release-index','run-index','lock'])await t.test('SP6 concurrent '+kind,async t=>{
  const f=await fixture(t,{multi:true,seal:false});
  const target=kind==='release-index'?'evidence/enterprise/releases/index.json':kind==='run-index'?'evidence/enterprise/runs/index.json':'evidence/enterprise/gate.lock';
  const r=run(f,`fs.readFileSync=function(p,...a){const r=read.call(this,p,...a);if(armed&&!fired&&String(p).endsWith('/evidence/enterprise/reviews/B00.md')){fire();write(${JSON.stringify(target)},read(${JSON.stringify(target)},'utf8')+' ');}return r;};`);
  assert.equal(r.status,1);assert.match(r.stderr,/SP_INJECTED/);assert.match(r.stderr,/writer (release|run|lock)/);assert.ok(fs.readFileSync(join(f.root,target),'utf8').endsWith(' '));refuseFinal(f);
 });
 for(const stage of ['before-stage','after-stage','before-terminal','post-terminal'])await t.test('SP4 '+stage,async t=>{
  const f=await fixture(t,{seal:false});
  const code=stage.includes('stage')?`fs.writeFileSync=function(p,v,...a){if(path(p)?.endsWith('/seal.json')&&!fired){fire();${stage==='after-stage'?'write.call(this,p,v,...a);':''}throw Error('SP_FAILURE');}return write.call(this,p,v,...a);};`
   :stage==='before-terminal'?`fs.renameSync=function(a,b,...rest){if(String(b).endsWith('/releases/index.json')&&JSON.parse(read(a)).attempts.at(-1).status==='passed'&&!fired){fire();throw Error('SP_FAILURE');}return rename.call(this,a,b,...rest);};`
   :`fs.readFileSync=function(p,...a){const r=read.call(this,p,...a);if(String(p).endsWith('/seal.json')&&status()==='passed'&&!fired){fire();throw Error('SP_FAILURE');}return r;};`;
  const r=run(f,code);assert.equal(r.status,1,r.stdout);assert.match(r.stderr,/SP_INJECTED/);assert.match(r.stderr,/SP_FAILURE/);
  const attempts=read(join(f.root,'evidence/enterprise/releases/index.json')).attempts;assert.equal(attempts.at(-1).status,'failed');
  if(stage==='post-terminal')assert.deepEqual(attempts.map(a=>a.status),['running','passed','failed']);
  assert.ok(read(join(f.root,'evidence/enterprise/runs/index.json')).runs.length);refuseFinal(f);
 });
 for(const stage of ['running','staged','durable-before-unlock'])await t.test('SP5 process killed '+stage,async t=>{
  const f=await fixture(t,{seal:false});
  const code=stage==='running'?`fs.renameSync=function(a,b,...rest){const r=rename.call(this,a,b,...rest);if(String(b).endsWith('/releases/index.json')&&status()==='running'){fire();process.kill(process.pid,'SIGKILL');}return r;};`
   :stage==='staged'?`fs.writeFileSync=function(p,v,...a){const r=write.call(this,p,v,...a);if(path(p)?.endsWith('/seal.json')){fire();process.kill(process.pid,'SIGKILL');}return r;};`
   :`fs.unlinkSync=function(p,...a){if(String(p).endsWith('/gate.lock')){fire();process.kill(process.pid,'SIGKILL');}return unlink.call(this,p,...a);};`;
  const r=run(f,code);assert.equal(r.signal,'SIGKILL',r.stderr);assert.match(r.stderr,/SP_INJECTED/);assert.ok(fs.existsSync(join(f.root,'evidence/enterprise/gate.lock')));refuseFinal(f);
 });
 for(const stage of ['failure-record','passed-write','failure-cas'])await t.test('SP7 retained fence '+stage,async t=>{
  const f=await fixture(t); // Older passed release must never be fallback.
  const code=`fs.renameSync=function(a,b,...rest){if(String(b).endsWith('/releases/index.json')){const s=JSON.parse(read(a)).attempts.at(-1).status;if(s==='passed'&&!fired){fire();${stage==='failure-cas'?"write(b,read(b,'utf8')+' ');":''}throw Error('SP_TERMINAL_FAILURE');}${stage==='failure-record'?"if(s==='failed')throw Error('SP_FAILURE_RECORD');":''}}return rename.call(this,a,b,...rest);};`;
  const r=run(f,code);assert.equal(r.status,1,r.stdout);assert.match(r.stderr,/SP_INJECTED/);assert.ok(fs.existsSync(join(f.root,'evidence/enterprise/gate.lock')),'unsafe publication retains own fence');refuseFinal(f);
 });
 for(const kind of ['progress','unlock','unlock-sync'])await t.test('SP4 post-commit '+kind,async t=>{
  const f=await fixture(t,{seal:false});
  const code=kind==='progress'?`fs.readFileSync=function(p,...a){const r=read.call(this,p,...a);if(String(p).endsWith('/seal.json')&&status()==='passed'&&!fired){fire();write('work/enterprise/progress.json',read('work/enterprise/progress.json','utf8')+' ');}return r;};`
   :kind==='unlock'?`fs.unlinkSync=function(p,...a){if(String(p).endsWith('/gate.lock')&&!fired){fire();throw Error('SP_UNLOCK_FAILURE');}return unlink.call(this,p,...a);};`
   :`let unlocked=false;fs.unlinkSync=function(p,...a){const r=unlink.call(this,p,...a);if(String(p).endsWith('/gate.lock'))unlocked=true;return r;};const sync=fs.fsyncSync;fs.fsyncSync=function(fd){if(unlocked&&!fired){fire();throw Error('SP_UNLOCK_SYNC_FAILURE');}return sync(fd);};`;
  const r=run(f,code);assert.equal(r.status,1,r.stdout);assert.match(r.stderr,/SP_INJECTED/);assert.match(r.stderr,kind==='progress'?/writer checkpoint progress/:/SP_UNLOCK/);
  assert.equal(latest(f).status,'failed');refuseFinal(f);
 });
 await t.test('SP3 read-only candidate is never final success',async t=>{
  const f=await fixture(t),e=latest(f),before=tree(f.temporary);
  const r=spawnSync(process.execPath,['--import',f.guardPath,'--input-type=module','-e',`import {validateSealCandidate} from './scripts/enterprise/finalization.mjs';import {suitesFor} from './scripts/enterprise/gate-execution.mjs';console.log(JSON.stringify(await validateSealCandidate(process.cwd(),${JSON.stringify(e.sealPath)},${JSON.stringify(e.sealDigest)},suitesFor)));`],{cwd:f.root,env:f.env,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).status,'SEAL_CANDIDATE_VALIDATED');assert.deepEqual(tree(f.temporary),before);
 });
 await t.test('SP6 completed unlock never inspects the next writer lock',async t=>{
  const f=await fixture(t,{seal:false});
  const r=run(f,`let released=false;fs.unlinkSync=function(p,...a){const r=unlink.call(this,p,...a);if(String(p).endsWith('/gate.lock')){fire();write(p,'');released=true;}return r;};const stat=fs.statSync;fs.statSync=function(p,...a){if(released&&String(p).endsWith('/gate.lock'))throw Error('NEXT_WRITER_LOCK_INSPECTED');return stat.call(this,p,...a);};`);
  assert.equal(r.status,0,r.stderr);assert.match(r.stderr,/SP_INJECTED/);assert.ok(fs.existsSync(join(f.root,'evidence/enterprise/gate.lock')));assert.equal(latest(f).status,'passed');refuseFinal(f);
 });
 await t.test('SP1 response loss after durable unlock remains committed',async t=>{
  const f=await fixture(t,{seal:false});const r=run(f,`fs.unlinkSync=function(p,...a){const r=unlink.call(this,p,...a);if(String(p).endsWith('/gate.lock')){fire();process.kill(process.pid,'SIGKILL');}return r;};`);
  assert.equal(r.signal,'SIGKILL');assert.match(r.stderr,/SP_INJECTED/);assert.equal(fs.existsSync(join(f.root,'evidence/enterprise/gate.lock')),false);final(f,['final','--check-seal']);
 });
});

test('preparation-component-capture-and-readonly-gate',async t=>{
 const {preparationComponentFixture}=await import('./evidence-fixture.mjs');const f=await preparationComponentFixture(t);
 const result=f.preparationCLI(['--capture-component','P0']);assert.equal(result.status,0,result.stderr);const candidate=JSON.parse(result.stdout);
 assert.equal(candidate.productVerified,false);assert.equal(candidate.purpose,'PREPARATION_COMPONENT_REVIEW');
 const before=tree(f.temporary),gate=f.cli(['batch']);assert.equal(gate.status,0,gate.stderr);assert.equal(JSON.parse(gate.stdout).kind,'PREPARATION_COMPONENT_READY');assert.deepEqual(tree(f.temporary),before);
});

const prepJSON=r=>{assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
function prepDecision(f,candidate,verdict='APPROVE',iteration=4){
 const r=read(join(f.root,candidate.receipt.path));
 return {schemaVersion:4,historyBinding:candidate.historyBinding,historyHead:candidate.historyHead,acceptanceScope:candidate.acceptanceScope,purpose:'PREPARATION_COMPONENT_REVIEW',permission:'IMPLEMENTATION_CONTRACT_TESTS_ONLY',verdict,runSlug:f.run.slug,workflowRef:candidate.workflowRef,bundleDigest:candidate.bundleDigest,step:'review-foundation',iteration,sessionKey:'enterprise-batch-reviewer',providerSessionId:'reviewer-session',increment:'P0',builderIteration:candidate.iteration,builderSessionId:candidate.providerSessionId,request:candidate.request,receipt:candidate.receipt,inputsDigest:candidate.inputsDigest,outputsDigest:r.outputs.digest,planSha256:r.planSha256,designReportSha256:candidate.designReportSha256,reviewedCaseIds:['real arithmetic assertion'],acceptedComponents:verdict==='APPROVE'?['P0-control']:[],approvedIssueIds:[],currentApprovals:[],actualHistoryCompleteness:'UNPROVEN',migrationAuthorization:'NONE',productVerified:false,initializationAuthority:false,targetLaunchAuthority:false,runtimeReplacementAuthority:false,unresolvedFindings:verdict==='APPROVE'?[]:['synthetic requested repair'],residualBlockers:r.definitions.scope.retainedObligations.map(x=>x.owner+': '+x.assertion+' REQUIRED_NOT_ACCEPTED; source history and migration unproven; no product approval')};
}
const prepComplete=(f,candidate,verdict='APPROVE',iteration=4)=>{
 f.preparationPhases('build-foundation',candidate.iteration,candidate,'enterprise-preparation-candidate');
 f.preparationPhases('review-foundation',iteration,prepDecision(f,candidate,verdict,iteration),'enterprise-batch-attestation');
};
const prepReport=f=>join(f.run.reportsAbs,f.workflow.steps.find(s=>s.name==='review-foundation').outputContracts[0].name);
const prepRefuse=(f,call,pattern)=>{const before=tree(f.temporary),r=call();assert.equal(r.status,1,r.stdout);if(pattern)assert.match(r.stderr,pattern);assert.doesNotMatch(r.stderr,/FS_MUTATION/);assert.deepEqual(tree(f.temporary),before);return r;};

test('preparation-review-contract-regressions',async t=>{
 const {preparationComponentFixture}=await import('./evidence-fixture.mjs');
 await t.test('PR1 real frozen engine capture gate review and dedicated import',prepEngineScenario);
 await t.test('PR2 explicit request never authorizes direct or flagged writers',async t=>{
  const f=await preparationComponentFixture(t);prepJSON(f.preparationCLI(['--capture-component','P0']));
  for(const args of [['batch','--batch','B00'],['batch','--validate-only'],['all','--seal']])prepRefuse(f,()=>f.cli(args),args[0]==='all'?/explicit seal during final rejected/:/writer binding runSlug/);
  for(const api of ['main','runBatchGate'])prepRefuse(f,()=>spawnSync(process.execPath,['--import',f.guardPath,'--input-type=module','-e',`import {${api}} from './scripts/enterprise/verify.mjs';import fs from 'node:fs';const p=JSON.parse(fs.readFileSync('work/enterprise/plan.json'));await ${api}(process.cwd(),${api==='main'?"['batch']":"p,p.batches[0]"});`],{cwd:f.root,env:f.env,encoding:'utf8'}),/writer binding/);
  f.context('build-foundation',5);prepRefuse(f,()=>f.cli(['batch']),/stale build/);
 });
 await t.test('PR3 tampered receipt output duplicate fields and latest journal reject readonly',async t=>{
  const f=await preparationComponentFixture(t),c=prepJSON(f.preparationCLI(['--capture-component','P0']));
  for(const p of [c.receipt.path,read(join(f.root,c.receipt.path)).stdout.path,f.preparationBase+'/journal.json']){const raw=fs.readFileSync(join(f.root,p));fs.appendFileSync(join(f.root,p),'changed');prepRefuse(f,()=>f.cli(['batch']));fs.writeFileSync(join(f.root,p),raw);}
  const p=join(f.root,c.request.path),raw=fs.readFileSync(p);fs.writeFileSync(p,raw.toString().replace('"schemaVersion": 3','"schemaVersion": 3, "schemaVersion": 3'));prepRefuse(f,()=>f.cli(['batch']),/duplicate preparation field/);
 });
 await t.test('PR4 mutation during subprocess retains failed evidence and concurrent progress',async t=>{
  const f=await preparationComponentFixture(t,{directProcess:true,suiteSource:"import test from 'node:test';import {writeFileSync} from 'node:fs';test('real arithmetic assertion',()=>{writeFileSync('work/enterprise/progress.json','concurrent writer');});"});
  const q=f.preparationCLI(['--capture-component','P0']);assert.equal(q.status,1);assert.match(q.stderr,/preparation source changed|successor source progress/);
  assert.equal(fs.readFileSync(join(f.root,'work/enterprise/progress.json'),'utf8'),'concurrent writer');
  assert.equal(read(join(f.root,f.preparationBase+'/attempts/1/execution.json')).exitCode,0);
  assert.deepEqual(read(join(f.root,f.preparationBase+'/journal.json')).events.map(e=>e.status),['RUNNING','FAILED']);
  assert.equal(fs.existsSync(join(f.root,f.preparationBase+'/request.json')),false);
 });
 await t.test('PR5 failed latest attempt and foreign fence prevent older fallback',async t=>{
  const f=await preparationComponentFixture(t),c=prepJSON(f.preparationCLI(['--capture-component','P0']));const p=join(f.root,f.preparationBase+'/journal.json'),j=read(p);j.events.push({...j.events[0],attempt:2,sequence:2,status:'RUNNING'});put(p,j);prepRefuse(f,()=>f.cli(['batch']),/latest failed or running|history descriptor attempt path|history unmapped attempt/);
  put(join(f.root,f.preparationBase+'/writer.lock'),'foreign owner');prepRefuse(f,()=>f.preparationCLI(['--capture-component','P0']),/fenced/);prepRefuse(f,()=>f.cli(['batch']),/fenced/);assert.ok(c);
 });
 await t.test('PR6 machine and design success cannot replace independent implementation review',async t=>{
  const f=await preparationComponentFixture(t);prepJSON(f.preparationCLI(['--capture-component','P0']));prepRefuse(f,()=>f.preparationCLI(['--inspect-component-review'],{readonly:true}),/incomplete preparation occurrence/);
 });
 await t.test('PR7 schema2 is rejected by unchanged product approval validator',async t=>{
  const f=await preparationComponentFixture(t),c=prepJSON(f.preparationCLI(['--capture-component','P0']));const report='evidence/schema2.md';put(join(f.root,report),'```enterprise-batch-attestation\n'+JSON.stringify(prepDecision(f,c))+'\n```');
  prepRefuse(f,()=>spawnSync(process.execPath,['--import',f.guardPath,'--input-type=module','-e',`import {validateBatchReview} from './scripts/enterprise/approval.mjs';await validateBatchReview(process.cwd(),{report:${JSON.stringify(report)},session:'reviewer-session'},{batchId:'B00',id:'no-product-receipt',inputs:{digest:'no-product-input'},suites:[]},[]);`],{cwd:f.root,env:f.env,encoding:'utf8'}),/batch report schemaVersion/);
  put(prepReport(f),fs.readFileSync(join(f.root,report),'utf8'));put(join(f.root,'evidence/schema2.json'),prepDecision(f,c));
  for(const args of [['batch','--import-closure'],['batch','--recover-rejected'],['all','--seal'],['final','--check-report']])prepRefuse(f,()=>f.cli(args));
  const code="import fs from 'node:fs';import {validateSelection} from './scripts/enterprise/selection.mjs';import {hash} from './scripts/enterprise/evidence.mjs';const plan=JSON.parse(fs.readFileSync('work/enterprise/plan.json'));plan.batches.push({id:'B01',dependsOnBatches:['B00']});await validateSelection(process.cwd(),plan,plan.batches[1],{entrySelection:'evidence/schema2.json',entrySelectionHash:hash(fs.readFileSync('evidence/schema2.json'))},()=>[]);";
  prepRefuse(f,()=>spawnSync(process.execPath,['--import',f.guardPath,'--input-type=module','-e',code],{cwd:f.root,env:f.env,encoding:'utf8'}),/selection schema/);
 });
 await t.test('PR8 absent and tampered requests fail actual frozen command runner',async t=>{
  for(const tamper of [false,true]){
   const f=await preparationComponentFixture(t,{frozen:true}),config=f.workflow;
   const {runQualityGates}=await import('../../node_modules/takt/dist/core/workflow/quality-gates/qualityGateRunner.js');
   const {WorkflowEngineStepCoordinator}=await import('../../node_modules/takt/dist/core/workflow/engine/WorkflowEngineStepCoordinator.js');
   if(tamper){prepJSON(f.preparationCLI(['--capture-component','P0']));fs.appendFileSync(join(f.root,f.preparationBase+'/request.json'),'bad');}
   const state=createInitialState(config,{projectCwd:f.root});state.currentStep='build-foundation';state.iteration=2;const coordinator=new WorkflowEngineStepCoordinator({}),provider={provider:'codex',model:'gpt-6-astra'};let gates=0;
   const result=await runSingleWorkflowIteration({state,options:{projectCwd:f.root},getWorkflowName:()=>config.name,getTask:()=> 'synthetic failed gate',getCurrentWorkflowStack:()=>f.stack(state.currentStep),getCwd:()=>f.root,getMaxSteps:()=>60,getReportDir:()=>f.run.reportsAbs,abortRequested:()=>false,getStep:name=>config.steps.find(s=>s.name===name),applyRuntimeEnvironment:()=>{},loopDetectorCheck:()=>({count:0,isLoop:false}),resolveDoneTransition:coordinator.resolveTransitionFromDone.bind(coordinator),resolveStepProviderModel:()=>provider,resolveStepProviderModelBeforeAutoRouting:()=>provider,resolveRuntimeForStep:()=>undefined,claimStepOccurrence:step=>{state.stepIterations.set(step.name,1);return 1;},setActiveStep:()=>undefined,cancelPendingStepActivation:()=>{},prepareNormalStepExecution:async()=>undefined,prepareInstruction:()=>({text:'synthetic'}),buildPhase1Instruction:(_,s)=>s,runStep:async step=>({response:{persona:step.persona,status:'done',content:'synthetic ready claim',matchedRuleIndex:0,timestamp:new Date()},instruction:'synthetic provider'}),runQualityGates:async options=>{gates++;return f.preparationRunGate(()=>runQualityGates(options));},persistPreviousResponseSnapshot:()=>{},emit:()=>{},updateMaxSteps:()=>{},addUserInput:()=>{}});
   assert.equal(gates,1);assert.equal(result.nextStep,'build-foundation');assert.equal(state.currentStep,'build-foundation');assert.equal(result.isComplete,false);assert.match(result.response.content,/Quality gate failed/);
  }
 });
 await t.test('PR9 incomplete builder candidate and unknown later review refuse',async t=>{
  const f=await preparationComponentFixture(t),c=prepJSON(f.preparationCLI(['--capture-component','P0']));
  const i=f.records.findLastIndex(r=>r.type==='step_start');f.records.splice(i,1);prepComplete(f,c);f.context('build-foundation',5);
  prepJSON(f.preparationCLI(['--inspect-component-review'],{readonly:true}));f.context('review-foundation',6);f.context('build-foundation',7);
  prepRefuse(f,()=>f.preparationCLI(['--import-component-review',prepReport(f)],{readonly:true}),/incomplete preparation occurrence/);
 });
 await t.test('PR10 rejection new capture approval and duplicate import preserve history',async t=>{
  const f=await preparationComponentFixture(t);let c=prepJSON(f.preparationCLI(['--capture-component','P0']));let i=f.records.findLastIndex(r=>r.type==='step_start');f.records.splice(i,1);prepComplete(f,c,'REQUEST_CHANGES');f.context('build-foundation',5);
  prepRefuse(f,()=>f.preparationCLI(['--import-component-review',prepReport(f)],{readonly:true}),/review rejected/);
  c=prepJSON(f.preparationCLI(['--capture-component','P0']));i=f.records.findLastIndex(r=>r.type==='step_start');f.records.splice(i,1);prepComplete(f,c,'APPROVE',6);f.context('build-foundation',7);
  const a=prepJSON(f.preparationCLI(['--import-component-review',prepReport(f)]));assert.equal(a.idempotent,false);const before=tree(f.temporary),again=prepJSON(f.preparationCLI(['--import-component-review',prepReport(f)],{readonly:true}));assert.equal(again.idempotent,true);assert.deepEqual(tree(f.temporary),before);assert.equal(read(join(f.root,f.preparationBase+'/journal.json')).events.length,4);
 });
 await t.test('PR11 symlink traversal overrides and readonly failure create no writes',async t=>{
  const f=await preparationComponentFixture(t);prepRefuse(f,()=>f.preparationCLI(['--capture-component','P0','--token','trusted'],{readonly:true}),/authority overrides/);
  const target=join(f.root,f.preparationBase+'/reviewed-inputs.json'),copy=join(f.temporary,'manifest.json');fs.renameSync(target,copy);fs.symlinkSync(copy,target);prepRefuse(f,()=>f.preparationCLI(['--capture-component','P0'],{readonly:true}),/symlink path escape/);
 });
 await t.test('PR12 source edit invalidates machine readiness without product promotion',async t=>{
  const f=await preparationComponentFixture(t);const c=prepJSON(f.preparationCLI(['--capture-component','P0']));f.records.splice(f.records.findLastIndex(r=>r.type==='step_start'),1);prepComplete(f,c);f.context('build-foundation',5);prepJSON(f.preparationCLI(['--import-component-review',prepReport(f)]));const acceptance=fs.readFileSync(join(f.root,f.preparationBase+'/acceptances.json'));fs.appendFileSync(join(f.root,'scripts/enterprise/runtime-preparation.mjs'),'\n// edited after capture\n');prepRefuse(f,()=>f.cli(['batch']),/request inputsDigest/);prepRefuse(f,()=>f.preparationCLI(['--import-component-review',prepReport(f)],{readonly:true}),/request inputsDigest/);assert.deepEqual(fs.readFileSync(join(f.root,f.preparationBase+'/acceptances.json')),acceptance);assert.equal(read(join(f.root,c.receipt.path)).productVerified,false);assert.deepEqual(read(join(f.root,'work/enterprise/progress.json')).approvals,{});
 });
});

test('preparation-publication-and-review-faults',async t=>{
 const {preparationComponentFixture}=await import('./evidence-fixture.mjs');
 for(const [name,body] of [
  ['failed',"test('real arithmetic assertion',()=>assert.fail('injected'))"],
  ['skipped',"test.skip('real arithmetic assertion',()=>{})"],
  ['missing',"test('other assertion',()=>assert.ok(true))"],
  ['empty',''],
  ['cancelled',"test('real arithmetic assertion',()=>new Promise(()=>{}))"],
 ])await t.test('PR3 actual '+name+' suite refuses capture',async t=>{
  const f=await preparationComponentFixture(t,{directProcess:true,suiteSource:"import test from 'node:test';import assert from 'node:assert/strict';"+body});
  const r=f.preparationCLI(['--capture-component','P0']);assert.equal(r.status,1);assert.match(r.stderr,/subprocess failed|zero assertions|missing assertion|TAP skipped/);
  assert.deepEqual(read(join(f.root,f.preparationBase+'/journal.json')).events.map(e=>e.status),['RUNNING','FAILED']);assert.equal(fs.existsSync(join(f.root,f.preparationBase+'/request.json')),false);
 });
 for(const mode of ['kill','failed-record','journal-conflict','request-conflict'])await t.test('PR5 actual '+mode+' preserves failure and blocks older success',async t=>{
  const f=await preparationComponentFixture(t);prepJSON(f.preparationCLI(['--capture-component','P0']));f.context('build-foundation',5);
  const hook=join(f.temporary,'fault.mjs');put(hook,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const original=fs.renameSync;let injected=false;fs.renameSync=function(a,b){if(!injected&&String(b).endsWith('/journal.json')&&JSON.parse(fs.readFileSync(a)).events.at(-1).status==='PASSED'){injected=true;${mode==='kill'?"process.kill(process.pid,'SIGKILL');":mode==='failed-record'?"throw Error('injected publication');":mode==='journal-conflict'?"fs.writeFileSync(b,'foreign journal');throw Error('injected conflict');":"fs.writeFileSync(String(b).replace('journal.json','request.json'),'foreign request');"}}${mode==='failed-record'?"if(injected&&String(b).endsWith('/journal.json'))throw Error('injected failed recording');":''}return original.apply(this,arguments);};syncBuiltinESMExports();`);
  const r=f.preparationCLI(['--capture-component','P0'],{preloads:[hook]});if(mode==='kill')assert.equal(r.signal,'SIGKILL');else assert.equal(r.status,1,r.stdout);
  if(mode==='request-conflict'){assert.equal(read(join(f.root,f.preparationBase+'/journal.json')).events.at(-1).status,'FAILED');prepRefuse(f,()=>f.cli(['batch']));}else{assert.equal(fs.existsSync(join(f.root,f.preparationBase+'/writer.lock')),true);prepRefuse(f,()=>f.cli(['batch']),/fenced/);}
  if(mode==='journal-conflict')assert.equal(fs.readFileSync(join(f.root,f.preparationBase+'/journal.json'),'utf8'),'foreign journal');
  if(mode==='request-conflict')assert.equal(fs.readFileSync(join(f.root,f.preparationBase+'/request.json'),'utf8'),'foreign request');
 });
 await t.test('PR10 completed capture response loss reconciles without subprocess or write',async t=>{
  const f=await preparationComponentFixture(t),c=prepJSON(f.preparationCLI(['--capture-component','P0'])),before=tree(f.temporary);
  assert.deepEqual(prepJSON(f.preparationCLI(['--capture-component','P0'],{readonly:true})),c);assert.deepEqual(tree(f.temporary),before);
 });
 for(const mode of ['same-session','model','phase','canonical','scope'])await t.test('PR6 '+mode+' component review refuses readonly',async t=>{
  const f=await preparationComponentFixture(t),c=prepJSON(f.preparationCLI(['--capture-component','P0']));f.records.splice(f.records.findLastIndex(r=>r.type==='step_start'),1);prepComplete(f,c);f.context('build-foundation',5);
  if(mode==='same-session'){f.sessions[JSON.stringify(['enterprise-batch-reviewer','codex','gpt-6-astra'])]='builder-session';savePersonaSessions(f.root,f.sessions,'codex',f.paths.sessionsDirectory);}
  if(mode==='model'){f.records.findLast(r=>r.type==='step_start'&&r.step==='review-foundation').model='gpt-6.1-sol';f.append({type:'test-flush'});}
  if(mode==='phase'||mode==='scope'){const r=f.records.find(r=>r.type==='phase_complete'&&r.step==='review-foundation');r.content=r.content.replace('"schemaVersion": 4','"schemaVersion": 99');f.append({type:'test-flush'});}
  if(mode==='canonical')fs.appendFileSync(prepReport(f),'tampered');
  prepRefuse(f,()=>f.preparationCLI(['--import-component-review',prepReport(f)],{readonly:true}));
 });
 await t.test('PR10 malformed review needs explicit real superseding occurrence',async t=>{
  const f=await preparationComponentFixture(t),c=prepJSON(f.preparationCLI(['--capture-component','P0']));f.records.splice(f.records.findLastIndex(r=>r.type==='step_start'),1);prepComplete(f,c);const old=f.records.filter(r=>r.type==='phase_complete'&&r.step==='review-foundation');for(const r of old)r.content='malformed independent review';f.append({type:'test-flush'});
  const marker='supersedes review-foundation:4:'+hash(JSON.stringify(old));f.preparationPhases('review-foundation',6,prepDecision(f,c,'APPROVE',6),'enterprise-batch-attestation');
  const corrected=f.records.filter(r=>r.type==='phase_complete'&&r.step==='review-foundation'&&r.iteration===6);for(const r of corrected)r.content=marker+'\n'+r.content;put(prepReport(f),corrected[1].content+'\n');f.context('build-foundation',7);
  const a=prepJSON(f.preparationCLI(['--import-component-review',prepReport(f)]));assert.equal(a.idempotent,false);assert.equal(a.attestation.iteration,6);
 });
 await t.test('PR4 import refuses concurrent receipt change and keeps fence',async t=>{
  const f=await preparationComponentFixture(t),c=prepJSON(f.preparationCLI(['--capture-component','P0']));f.records.splice(f.records.findLastIndex(r=>r.type==='step_start'),1);prepComplete(f,c);f.context('build-foundation',5);
  const hook=join(f.temporary,'fault.mjs');put(hook,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const original=fs.renameSync;fs.renameSync=function(a,b){const r=original.apply(this,arguments);if(String(b).endsWith('/acceptances.json'))fs.appendFileSync(${JSON.stringify(join(f.root,c.receipt.path))},'concurrent bytes');return r;};syncBuiltinESMExports();`);
  const r=f.preparationCLI(['--import-component-review',prepReport(f)],{preloads:[hook]});assert.equal(r.status,1);assert.match(r.stderr,/preparation artifact changed|import evidence changed/);assert.equal(fs.existsSync(join(f.root,f.preparationBase+'/writer.lock')),true);prepRefuse(f,()=>f.cli(['batch']),/fenced/);
 });
});

test('preparation-publication-checkpoints',async t=>{
 const {preparationComponentFixture}=await import('./evidence-fixture.mjs');
 for(const target of ['progress','plan','input','authority'])await t.test('PR4 '+target+' changes after request publication refuse',async t=>{
  const f=await preparationComponentFixture(t),path=target==='progress'?join(f.root,'work/enterprise/progress.json'):target==='plan'?join(f.root,'work/enterprise/plan.json'):target==='input'?join(f.root,'src/domain.mjs'):join(f.run.reportsAbs,f.workflow.steps.find(s=>s.name==='review-architecture').outputContracts[0].name);
  const hook=join(f.temporary,'publication-fault.mjs');put(hook,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const original=fs.renameSync;fs.renameSync=function(a,b){const r=original.apply(this,arguments);if(String(b).endsWith('/request.json'))fs.appendFileSync(${JSON.stringify(path)},'\nconcurrent mutation');return r;};syncBuiltinESMExports();`.replace("'\nconcurrent mutation'","'\\nconcurrent mutation'"));
  const r=f.preparationCLI(['--capture-component','P0'],{preloads:[hook]});assert.equal(r.status,1,r.stdout);assert.match(fs.readFileSync(path,'utf8'),/concurrent mutation$/);assert.equal(read(join(f.root,f.preparationBase+'/journal.json')).events.at(-1).status,'FAILED');prepRefuse(f,()=>f.cli(['batch']));
 });
 await t.test('PR11 direct callback override and traversal request refuse readonly',async t=>{
  const f=await preparationComponentFixture(t),c=prepJSON(f.preparationCLI(['--capture-component','P0']));
  prepRefuse(f,()=>spawnSync(process.execPath,['--import',f.guardPath,'--input-type=module','-e',"import {capturePreparationComponent} from './scripts/enterprise/runtime-preparation.mjs';await capturePreparationComponent(process.cwd(),'P0',()=>true);"],{cwd:f.root,env:f.env,encoding:'utf8'}),/overrides forbidden/);
  const p=join(f.root,c.request.path),request=read(p);request.receipt.path=f.preparationBase+'/../../../outside.json';put(p,request);prepRefuse(f,()=>f.cli(['batch']),/path escape/);
 });
 await t.test('PR2 foreign explicit request rejects without fallback',async t=>{
  const f=await preparationComponentFixture(t),c=prepJSON(f.preparationCLI(['--capture-component','P0']));const p=join(f.root,c.request.path),request=read(p);request.runSlug='foreign';put(p,request);prepRefuse(f,()=>f.cli(['batch']),/request runSlug/);
 });
 await t.test('PR6 reviewer candidate is authenticated and readonly',async t=>{
  const f=await preparationComponentFixture(t),c=prepJSON(f.preparationCLI(['--capture-component','P0']));f.records.splice(f.records.findLastIndex(r=>r.type==='step_start'),1);f.preparationPhases('build-foundation',3,c,'enterprise-preparation-candidate');f.context('review-foundation',4);const before=tree(f.temporary),r=prepJSON(f.preparationCLI(['--inspect-component-candidate'],{readonly:true}));assert.equal(r.kind,'PREPARATION_COMPONENT_FOR_REVIEW');assert.deepEqual(r.candidate,c);assert.deepEqual(tree(f.temporary),before);
 });
});


test('preparation-authority-prewrite-refusals',async t=>{
 const {preparationComponentFixture}=await import('./evidence-fixture.mjs');
 await t.test('PR6 writable reviewer cannot approve component',async t=>{
  const f=await preparationComponentFixture(t,{reviewDefinition:{edit:true}}),c=prepJSON(f.preparationCLI(['--capture-component','P0']));f.records.splice(f.records.findLastIndex(r=>r.type==='step_start'),1);prepComplete(f,c);f.context('build-foundation',5);prepRefuse(f,()=>f.preparationCLI(['--import-component-review',prepReport(f)],{readonly:true}),/must be readonly/);
 });
 for(const mode of ['missing-approval','wrong-step'])await t.test('PR2 '+mode+' capture refuses before writes',async t=>{
  const f=await preparationComponentFixture(t);
  if(mode==='missing-approval')fs.unlinkSync(join(f.run.reportsAbs,f.workflow.steps.find(s=>s.name==='review-architecture').outputContracts[0].name));else f.context('review-foundation',4);
  prepRefuse(f,()=>f.preparationCLI(['--capture-component','P0'],{readonly:true}));assert.equal(fs.existsSync(join(f.root,f.preparationBase+'/journal.json')),false);
 });
});

async function prepEngineScenario(t,{legacy=false,sourceProfile=false}={}){
  const {preparationComponentFixture,sourceProvenanceFixture}=await import('./evidence-fixture.mjs');
  const f=sourceProfile?await sourceProvenanceFixture(t,{frozen:true}):legacy?await legacyThreeFixture(t,{frozen:true}):await preparationComponentFixture(t,{frozen:true});
  const {loadWorkflowExecutionBundle}=await import('../../node_modules/takt/dist/features/tasks/execute/workflowExecutionBundle.js');
  const {WorkflowEngineStepCoordinator}=await import('../../node_modules/takt/dist/core/workflow/engine/WorkflowEngineStepCoordinator.js');
  const {runQualityGates}=await import('../../node_modules/takt/dist/core/workflow/quality-gates/qualityGateRunner.js');
  const config=loadWorkflowExecutionBundle(f.run).rootWorkflow;
  assert.deepEqual(config.steps,f.workflow.steps,'compiled frozen definitions retained');
  const productPaths=['work/enterprise/progress.json','evidence/enterprise/runs/index.json','evidence/selection.json'],preserved=()=>productPaths.map(p=>({raw:fs.readFileSync(join(f.root,p),'utf8'),mtime:fs.statSync(join(f.root,p)).mtimeMs})),before=preserved();
  const events=[],state=createInitialState(config,{projectCwd:f.root});state.currentStep='build-foundation';state.iteration=sourceProfile?6:legacy?8:2;let candidate;
  const provider={provider:'codex',model:'gpt-6-astra'},coordinator=new WorkflowEngineStepCoordinator({});
  const deps={state,options:{projectCwd:f.root,childProcessEnv:f.env},getWorkflowName:()=>config.name,getTask:()=> 'synthetic preparation provider',getCurrentWorkflowStack:()=>f.stack(state.currentStep),getCwd:()=>f.root,getMaxSteps:()=>60,getReportDir:()=>f.run.reportsAbs,abortRequested:()=>false,getStep:name=>config.steps.find(s=>s.name===name),applyRuntimeEnvironment:()=>{},loopDetectorCheck:()=>({count:0,isLoop:false}),resolveDoneTransition:coordinator.resolveTransitionFromDone.bind(coordinator),resolveStepProviderModel:()=>provider,resolveStepProviderModelBeforeAutoRouting:()=>provider,resolveRuntimeForStep:()=>undefined,claimStepOccurrence:step=>{state.stepIterations.set(step.name,1);return 1;},setActiveStep:()=>undefined,cancelPendingStepActivation:()=>{},prepareNormalStepExecution:async()=>undefined,prepareInstruction:()=>({text:'synthetic provider only'}),buildPhase1Instruction:(_,s)=>s,
   runStep:async step=>{
    if(step.name==='build-foundation'){
     candidate=prepJSON(f.preparationCLI(['--capture-component','P0']));
     // Synthetic provider content; actual engine decides the next step and runs
     // the unchanged frozen command after both persisted report phases.
     const start=f.records.findLastIndex(r=>r.type==='step_start');f.records.splice(start,1);
     f.preparationPhases(step.name,state.iteration,candidate,'enterprise-preparation-candidate');
    }else f.preparationPhases(step.name,state.iteration,sourceProfile?sourceDecision(f,candidate,state.iteration):prepDecision(f,candidate,'APPROVE',state.iteration),'enterprise-batch-attestation');
    events.push({kind:'phases',step:step.name,iteration:state.iteration});return {response:{persona:step.persona,status:'done',content:'synthetic independent component response',matchedRuleIndex:0,timestamp:new Date()},instruction:'synthetic provider'};
   },
   runQualityGates:async options=>{const r=await f.preparationRunGate(()=>runQualityGates(options));if(!r.ok){const log=r.response.content.match(/Output log: (.+)/);if(log)t.diagnostic(fs.readFileSync(join(f.root,log[1]),'utf8'));}events.push({kind:'real-command-gate',step:options.step.name,ok:r.ok});return r;},persistPreviousResponseSnapshot:()=>{},emit:()=>{},updateMaxSteps:()=>{},addUserInput:()=>{}
  };
  const b=await runSingleWorkflowIteration(deps);assert.equal(b.nextStep,'review-foundation',JSON.stringify(b));assert.equal(b.isComplete,false);
  const r=await runSingleWorkflowIteration(deps);assert.equal(r.nextStep,'build-foundation');assert.equal(r.isComplete,false);
  f.context('build-foundation',sourceProfile?9:legacy?11:5);
  const accepted=prepJSON(f.preparationCLI(['--import-component-review',prepReport(f)]));assert.equal(accepted.kind,'PREPARATION_COMPONENT_ACCEPTANCE');assert.equal(accepted.productVerified,false);assert.equal(accepted.schemaVersion,3);assert.deepEqual(accepted.acceptanceScope,candidate.acceptanceScope);assert.deepEqual(accepted.attestation.acceptedComponents,sourceProfile?['P0-control','P0-source-provenance']:['P0-control']);assert.deepEqual(read(join(f.root,candidate.receipt.path)).definitions.required,['real arithmetic assertion']);assert.deepEqual(preserved(),before);
  assert.deepEqual(events.map(e=>[e.kind,e.step]),[['phases','build-foundation'],['real-command-gate','build-foundation'],['phases','review-foundation'],['real-command-gate','review-foundation']]);
  const output=process.env.ENTERPRISE_SUITE_OUTPUT;if(output){put(join(output,sourceProfile?'source-provenance-engine.json':'preparation-engine.json'),{events,build:b,review:r,candidate,accepted,syntheticProvider:true,realEngine:true,productVerified:false});}

}

test('preparation-acceptance-scope-regressions',async t=>{
 const {preparationComponentFixture}=await import('./evidence-fixture.mjs');
 const capture=f=>prepJSON(f.preparationCLI(['--capture-component','P0']));
 const finish=(f,c,decision=prepDecision(f,c))=>{f.records.splice(f.records.findLastIndex(r=>r.type==='step_start'),1);f.preparationPhases('build-foundation',c.iteration,c,'enterprise-preparation-candidate');f.preparationPhases('review-foundation',4,decision,'enterprise-batch-attestation');f.context('build-foundation',5);};
 await t.test('AS1 scoped capture through frozen engine phases and import',prepEngineScenario);
 await t.test('AS2 positive passing totals cannot replace a missing mandatory name',async t=>{
  const f=await preparationComponentFixture(t,{directProcess:true,suiteSource:"import test from 'node:test';test('different passing assertion',()=>{});"}),r=f.preparationCLI(['--capture-component','P0']);assert.equal(r.status,1);assert.match(r.stderr,/missing assertion: real arithmetic assertion/);const e=read(join(f.root,f.preparationBase+'/attempts/1/execution.json'));assert.equal(e.exitCode,0);assert.equal(read(join(f.root,f.preparationBase+'/journal.json')).events.at(-1).status,'FAILED');assert.equal(fs.existsSync(join(f.root,f.preparationBase+'/request.json')),false);
 });
 await t.test('AS3 retained ownership partition and activation are authenticated before writes',async t=>{
  for(const mutate of [s=>s.retainedObligations.pop(),s=>s.retainedObligations.push(s.retainedObligations[0]),s=>s.retainedObligations[0].assertion='unknown',s=>s.retainedObligations[0].owner='R2',s=>s.retainedObligations[0].dependsOn=['R0'],s=>s.retainedObligations[0].requiredAt=['R1'],s=>s.requiredAssertions.push(s.retainedObligations[0].assertion)]){
   const f=await preparationComponentFixture(t,{scopeMutation:mutate});prepRefuse(f,()=>f.preparationCLI(['--capture-component','P0'],{readonly:true}),/preparation retained|preparation partition/);
  }
 });
 await t.test('AS4 absent retained work grants control readiness only',async t=>{
  const f=await preparationComponentFixture(t),c=capture(f),r=read(join(f.root,c.receipt.path));assert.equal(r.definitions.required.includes('synthetic retained history'),false);assert.throws(()=>parseTap(fs.readFileSync(join(f.root,r.stdout.path),'utf8'),r.definitions.scope.fullObligations),/missing assertion: synthetic retained history/);
  finish(f,c);const a=prepJSON(f.preparationCLI(['--import-component-review',prepReport(f)]));assert.deepEqual(a.attestation.acceptedComponents,['P0-control']);assert.deepEqual(a.attestation.approvedIssueIds,[]);assert.equal(a.attestation.actualHistoryCompleteness,'UNPROVEN');assert.equal(a.attestation.migrationAuthorization,'NONE');assert.equal(a.productVerified,false);assert.deepEqual(read(join(f.root,'work/enterprise/progress.json')).approvals,{});
 });
 await t.test('AS5 executed retained failures cancellation skip and todo refuse',async t=>{
  for(const body of ["test('synthetic retained history',()=>{throw Error('retained failure')})","test.skip('synthetic retained history',()=>{})","test.todo('synthetic retained history')","test('synthetic retained history',()=>new Promise(()=>{}))"]){
   const f=await preparationComponentFixture(t,{directProcess:true,suiteSource:"import test from 'node:test';test('real arithmetic assertion',()=>{});"+body}),r=f.preparationCLI(['--capture-component','P0']);assert.equal(r.status,1);assert.match(r.stderr,/subprocess failed|zero assertions or incomplete TAP|TAP skipped|TAP todo/);assert.equal(read(join(f.root,f.preparationBase+'/journal.json')).events.at(-1).status,'FAILED');assert.equal(fs.existsSync(join(f.root,f.preparationBase+'/request.json')),false);
  }
 });
 await t.test('AS6 caller exclusions profiles raw scope and omitted binding refuse',async t=>{
  const f=await preparationComponentFixture(t);prepRefuse(f,()=>f.preparationCLI(['--capture-component','P0','--exclude','real arithmetic assertion'],{readonly:true}),/authority overrides/);
  const bad=await preparationComponentFixture(t,{scopeMutation:s=>s.automaticSelectionFromTap=true});prepRefuse(bad,()=>bad.preparationCLI(['--capture-component','P0'],{readonly:true}),/automaticSelectionFromTap/);
  const c=capture(f),scopePath=join(f.root,f.preparationBase+'/attempts/1/scope.json'),raw=fs.readFileSync(scopePath);fs.appendFileSync(scopePath,' ');prepRefuse(f,()=>f.cli(['batch']),/raw scope|preparation history bytes/);fs.writeFileSync(scopePath,raw);
  const req=read(join(f.root,c.request.path));delete req.acceptanceScope;put(join(f.root,c.request.path),req);prepRefuse(f,()=>f.cli(['batch']),/request fields/);
 });
 await t.test('AS7 legacy failed raw history and original cause survive a fresh greater attempt',async t=>{
  const f=await preparationComponentFixture(t,{legacyHistory:true}),jp=join(f.root,f.preparationBase+'/journal.json'),old=fs.readFileSync(jp),oldTap=fs.readFileSync(join(f.root,f.preparationBase+'/attempts/1/output/stdout.tap')),c=capture(f),r=read(join(f.root,c.receipt.path)),j=read(jp);assert.equal(r.attempt,2);assert.deepEqual(j.events.slice(0,2),JSON.parse(old).events);assert.deepEqual(j.events.map(e=>e.status),['RUNNING','FAILED','RUNNING','PASSED']);assert.deepEqual(fs.readFileSync(join(f.root,f.preparationBase+'/history/'+hash(old)+'.journal.json')),old);assert.deepEqual(fs.readFileSync(join(f.root,f.preparationBase+'/attempts/1/output/stdout.tap')),oldTap);assert.equal(r.execution.exitCode,0);assert.notEqual(r.stdout.path,f.preparationBase+'/attempts/1/output/stdout.tap');assert.throws(()=>parseTap(oldTap.toString(),read(join(f.root,f.preparationBase+'/attempts/1/definitions.json')).required),/missing assertion: synthetic retained history/);
  j.events[1].error='promoted';put(jp,j);prepRefuse(f,()=>f.cli(['batch']),/legacy event changed/);
 });
 await t.test('AS8 both phases canonical scope and exact component prevent broader import',async t=>{
  for(const change of [a=>a.acceptanceScope.mandatoryDigest='0'.repeat(64),a=>a.acceptedComponents=['P0'],a=>a.residualBlockers=['nothing remaining']]){const f=await preparationComponentFixture(t),c=capture(f),a=structuredClone(prepDecision(f,c));change(a);finish(f,c,a);prepRefuse(f,()=>f.preparationCLI(['--import-component-review',prepReport(f)],{readonly:true}),/review acceptanceScope|component scope|retained review disclosure/);}

 });
 await t.test('AS9 legacy schemas are not upgraded into current readiness or review',async t=>{
  for(const oldVersion of [1,2])for(const target of ['request','receipt','candidate','review']){const f=await preparationComponentFixture(t),c=capture(f),journal=fs.readFileSync(join(f.root,f.preparationBase+'/journal.json'));
   if(target==='request'){const p=join(f.root,c.request.path),a=read(p);a.schemaVersion=oldVersion;put(p,a);prepRefuse(f,()=>f.cli(['batch']),/request schemaVersion/);}
   else if(target==='receipt'){const p=join(f.root,c.receipt.path),a=read(p);a.schemaVersion=oldVersion;put(p,a);const ref={path:c.receipt.path,sha256:hash(fs.readFileSync(p))},rp=join(f.root,c.request.path),req=read(rp),jp=join(f.root,f.preparationBase+'/journal.json'),j=read(jp);req.receipt=ref;j.events.at(-1).receipt=ref;put(rp,req);put(jp,j);prepRefuse(f,()=>f.cli(['batch']),/preparation receipt schemaVersion/);put(jp,JSON.parse(journal));}
   else if(target==='candidate'){const old={...c,schemaVersion:oldVersion};finish(f,old);prepRefuse(f,()=>f.preparationCLI(['--import-component-review',prepReport(f)],{readonly:true}),/builder candidate/);}
   else{const a={...prepDecision(f,c),schemaVersion:oldVersion+1};finish(f,c,a);prepRefuse(f,()=>f.preparationCLI(['--import-component-review',prepReport(f)],{readonly:true}),/review schemaVersion/);}
   assert.deepEqual(fs.readFileSync(join(f.root,f.preparationBase+'/journal.json')),journal);
  }
 });
 await t.test('AS10 later profiles and edits cannot reuse control acceptance',async t=>{
  for(const change of [s=>s.profileId='R1-v1',s=>s.requiredAssertions=[]]){const f=await preparationComponentFixture(t,{scopeMutation:change});prepRefuse(f,()=>f.preparationCLI(['--capture-component','P0'],{readonly:true}),/preparation profile|preparation partition/);}
  const f=await preparationComponentFixture(t),c=capture(f);finish(f,c);prepJSON(f.preparationCLI(['--import-component-review',prepReport(f)]));const p=join(f.root,'work/enterprise/plan.json'),plan=read(p);plan.preparationReview.acceptanceScope.requiredControlAssertions.push('later required control');put(p,plan);prepRefuse(f,()=>f.preparationCLI(['--import-component-review',prepReport(f)],{readonly:true}),/plan|source|input/);
 });
 await t.test('AS11 product full obligations and consumers reject both preparation schemas',async t=>{
  const f=await preparationComponentFixture(t,{legacyHistory:true}),c=capture(f),r=read(join(f.root,c.receipt.path)),legacy=fs.readFileSync(join(f.root,f.preparationBase+'/attempts/1/output/stdout.tap'));assert.throws(()=>parseTap(fs.readFileSync(join(f.root,r.stdout.path),'utf8'),r.definitions.scope.fullObligations),/missing assertion/);
  for(const schemaVersion of [2,3,4]){const report='evidence/prep-schema-'+schemaVersion+'.md';put(join(f.root,report),'```enterprise-batch-attestation\n'+JSON.stringify({...prepDecision(f,c),schemaVersion})+'\n```');prepRefuse(f,()=>spawnSync(process.execPath,['--import',f.guardPath,'--input-type=module','-e',`import {validateBatchReview} from './scripts/enterprise/approval.mjs';await validateBatchReview(process.cwd(),{report:${JSON.stringify(report)},session:'reviewer-session'},{batchId:'B00',id:'absent',inputs:{digest:'absent'},suites:[]},[]);`],{cwd:f.root,env:f.env,encoding:'utf8'}),/batch report schemaVersion/);put(prepReport(f),fs.readFileSync(join(f.root,report),'utf8'));for(const args of [['batch','--validate-only'],['batch','--import-closure'],['batch','--recover-rejected'],['all','--seal'],['final','--check-report']])prepRefuse(f,()=>f.cli(args));}
  assert.deepEqual(fs.readFileSync(join(f.root,f.preparationBase+'/attempts/1/output/stdout.tap')),legacy);
 });
 await t.test('AS12 profile mutation and duplicate terminal refuse without fallback',async t=>{
  const source="import test from 'node:test';import fs from 'node:fs';test('real arithmetic assertion',()=>{const p='work/enterprise/plan.json',v=JSON.parse(fs.readFileSync(p));v.preparationReview.acceptanceScope.reason='concurrent mutation';fs.writeFileSync(p,JSON.stringify(v));});",f=await preparationComponentFixture(t,{suiteSource:source}),r=f.preparationCLI(['--capture-component','P0']);assert.equal(r.status,1);assert.match(r.stderr,/inputs changed|source changed|plan/);assert.equal(read(join(f.root,f.preparationBase+'/journal.json')).events.at(-1).status,'FAILED');assert.equal(fs.existsSync(join(f.root,f.preparationBase+'/request.json')),false);
  const missing=await preparationComponentFixture(t);capture(missing);missing.context('build-foundation',5);const mp=join(missing.root,missing.preparationBase+'/journal.json'),mj=read(mp);mj.events[1]={...mj.events[1]};delete mj.events[1].acceptanceScope;put(mp,mj);prepRefuse(missing,()=>missing.preparationCLI(['--capture-component','P0'],{readonly:true}),/journal scope missing/);
  const g=await preparationComponentFixture(t),c=capture(g),before=tree(g.temporary),again=prepJSON(g.preparationCLI(['--capture-component','P0'],{readonly:true}));assert.deepEqual(again,c);assert.deepEqual(tree(g.temporary),before);const p=join(g.root,g.preparationBase+'/journal.json'),j=read(p);j.events.push(j.events.at(-1));put(p,j);prepRefuse(g,()=>g.cli(['batch']),/duplicate terminal/);
 });
});

// RF-P0-01: every negative starts from actual captured failure + success,
// then changes one earlier artifact. Synthetic agents never synthesize exits.
function recordHistoryCalls(f){
 f.historyTrace=[];for(const method of ['preparationCLI','cli']){const call=f[method];f[method]=(...args)=>{const startedAt=new Date().toISOString(),r=call(...args);f.historyTrace.push({method,args,startedAt,finishedAt:new Date().toISOString(),status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});return r;};}return f;
}
function saveHistoryEvidence(f,label){
 const out=process.env.ENTERPRISE_SUITE_OUTPUT;if(!out)return;const path=join(out,'preparation-failure-history',label);fs.mkdirSync(path,{recursive:true});fs.cpSync(join(f.root,f.preparationBase),join(path,f.preparationBase),{recursive:true});put(join(path,'execution-context.json'),{synthetic:true,productVerified:false,originalRoot:f.root,records:f.records,commands:f.historyTrace??[]});
}
async function failureHistoryFixture(t){
 const {preparationComponentFixture}=await import('./evidence-fixture.mjs');
 const f=await preparationComponentFixture(t,{directProcess:true,suiteSource:"import test from 'node:test';import fs from 'node:fs';test('real arithmetic assertion',()=>{fs.mkdirSync(process.env.ENTERPRISE_SUITE_OUTPUT,{recursive:true});fs.writeFileSync(process.env.ENTERPRISE_SUITE_OUTPUT+'/actual.json',JSON.stringify({value:42}));if(process.env.FH_FAIL==='1'){process.stderr.write('actual failing stderr\\n');throw Error('real failure');}});"});
 recordHistoryCalls(f);f.env.FH_FAIL='1';const failed=f.preparationCLI(['--capture-component','P0']);assert.equal(failed.status,1,failed.stdout);assert.match(failed.stderr,/preparation subprocess failed/);
 const journal=()=>read(join(f.root,f.preparationBase+'/journal.json'));assert.equal(journal().events.at(-1).status,'FAILED');
 f.env.FH_FAIL='0';f.context('build-foundation',5);const candidate=prepJSON(f.preparationCLI(['--capture-component','P0']));assert.equal(read(join(f.root,candidate.receipt.path)).attempt,2);assert.deepEqual(journal().events.map(e=>e.status),['RUNNING','FAILED','RUNNING','PASSED']);
 prepJSON(f.cli(['batch']));assert.deepEqual(prepJSON(f.preparationCLI(['--capture-component','P0'],{readonly:true})),candidate);
 f.records.splice(f.records.findLastIndex(r=>r.type==='step_start'),1);f.preparationPhases('build-foundation',5,candidate,'enterprise-preparation-candidate');f.context('review-foundation',6);prepJSON(f.preparationCLI(['--inspect-component-candidate'],{readonly:true}));f.records.splice(f.records.findLastIndex(r=>r.type==='step_start'),1);f.preparationPhases('review-foundation',6,prepDecision(f,candidate,'APPROVE',6),'enterprise-batch-attestation');f.context('build-foundation',7);
 prepJSON(f.preparationCLI(['--inspect-component-review'],{readonly:true}));prepJSON(f.preparationCLI(['--import-component-review',prepReport(f)]));
 f.historyCandidate=candidate;return f;
}
function historyConsumers(f){return [
 ['capture',()=>f.preparationCLI(['--capture-component','P0'],{readonly:true})],
 ['gate',()=>f.cli(['batch'])],
 ['candidate',()=>f.preparationCLI(['--inspect-component-candidate'],{readonly:true})],
 ['review',()=>f.preparationCLI(['--inspect-component-review'],{readonly:true})],
 ['import',()=>f.preparationCLI(['--import-component-review',prepReport(f)],{readonly:true})],
];}
function historyMutation(f,path,mode,operation){
 const p=join(f.root,path),raw=fs.readFileSync(p);try{if(mode==='missing')fs.unlinkSync(p);else fs.writeFileSync(p,mode==='empty'?'':Buffer.concat([raw,Buffer.from('changed')]));operation();}finally{fs.writeFileSync(p,raw);}
}
async function legacyThreeFixture(t,{frozen=false}={}){
 const {preparationComponentFixture}=await import('./evidence-fixture.mjs'),{snapshot,inputs}=await import('../../scripts/enterprise/evidence.mjs');
 const f=await preparationComponentFixture(t,{frozen,legacyHistory:true,suiteSource:"import test from 'node:test';test('real arithmetic assertion',()=>{if(process.env.LEGACY_FAIL==='1')throw Error('secondary subprocess failure');});"});
 f.env.LEGACY_FAIL='1';const failed=f.preparationCLI(['--capture-component','P0']);assert.equal(failed.status,1);assert.match(failed.stderr,/subprocess failed/);f.env.LEGACY_FAIL='0';
 const old=prepJSON(f.preparationCLI(['--capture-component','P0']));assert.equal(read(join(f.root,old.receipt.path)).attempt,3);
 f.records.splice(f.records.findLastIndex(r=>r.type==='step_start'),1);f.preparationPhases('build-foundation',6,old,'enterprise-preparation-candidate');const rejected=prepDecision(f,old,'REQUEST_CHANGES',7);rejected.unresolvedFindings=['RF-P0-01'];f.preparationPhases('review-foundation',7,rejected,'enterprise-batch-attestation');
 const ref=p=>({path:p,sha256:hash(fs.readFileSync(join(f.root,p))),bytes:fs.statSync(join(f.root,p)).size}),base=f.preparationBase;
 for(const [p,raw] of [['assessed-journal.json',fs.readFileSync(join(f.root,base+'/journal.json'))],['assessed-request.json',fs.readFileSync(join(f.root,base+'/request.json'))],['assessed-review.md',fs.readFileSync(prepReport(f))],['assessed-design.md',fs.readFileSync(join(f.run.reportsAbs,f.workflow.steps.find(s=>s.name==='review-architecture').outputContracts[0].name))]])fs.writeFileSync(join(f.root,'evidence',p),raw);
 const checkpoint={schemaVersion:1,kind:'PREPARATION_LEGACY_PREFIX_ASSESSMENT',runSlug:f.run.slug,attempts:[1,2,3],journal:ref('evidence/assessed-journal.json'),request:ref('evidence/assessed-request.json'),review:ref('evidence/assessed-review.md'),originalDesignApproval:ref('evidence/assessed-design.md'),inventory:snapshot(f.root,[base]).entries};put(join(f.root,'evidence/assessed-checkpoint.json'),checkpoint);
 const plan=read(join(f.root,'work/enterprise/plan.json'));plan.preparationReview.failureHistory={...plan.preparationReview.failureHistory,checkpoint:ref('evidence/assessed-checkpoint.json'),legacyAttempts:[1,2,3],nextAttemptMinimum:4,rejection:checkpoint.review,historicalApproval:checkpoint.originalDesignApproval,finding:'RF-P0-01'};put(join(f.root,'work/enterprise/plan.json'),plan);
 const manifest=inputs(f.root),manifestPath=base+'/reviewed-inputs.'+manifest.digest+'.json';put(join(f.root,manifestPath),manifest);f.successorAttestation={...f.successorAttestation,iteration:8,planSha256:ref('work/enterprise/plan.json').sha256,inputsDigest:manifest.digest};f.preparationPhases('review-architecture',8,f.successorAttestation,'enterprise-continuation-preparation-attestation');f.context('build-foundation',9);
 f.assessedCheckpoint=checkpoint;f.assessedCandidate=old;return f;
}
test('preparation-failure-history-regressions',async t=>{
 await t.test('FH1 real failed subprocess then new success retains full evidence',async t=>{const f=await failureHistoryFixture(t),j=read(join(f.root,f.preparationBase+'/journal.json'));assert.equal(read(join(f.root,f.preparationBase+'/attempts/1/execution.json')).exitCode,1);assert.equal(j.events[1].failureManifest.bytes,fs.statSync(join(f.root,j.events[1].failureManifest.path)).size);assert.equal(f.historyCandidate.schemaVersion,3);assert.equal(f.historyCandidate.productVerified,false);saveHistoryEvidence(f,'FH1');});
 await t.test('FH2 every consumer rejects missing empty changed old output and diagnosis',async t=>{
  const f=await failureHistoryFixture(t),dir=f.preparationBase+'/attempts/1';
  for(const path of [dir+'/output/stdout.tap',dir+'/output/stderr.log',dir+'/diagnostic.txt'])for(const mode of ['missing','empty','changed'])await t.test(path.split('/').at(-1)+' '+mode,()=>historyMutation(f,path,mode,()=>{for(const [name,call] of historyConsumers(f))prepRefuse(f,call,/history|ENOENT/);}));
  const p=join(f.root,f.preparationBase+'/journal.json'),raw=fs.readFileSync(p),j=JSON.parse(raw);j.events[1].error='replaced diagnostic';put(p,j);for(const [name,call] of historyConsumers(f))prepRefuse(f,call,/history failure diagnostic/);fs.writeFileSync(p,raw);
 });
 await t.test('FH3 every consumer verifies old definitions inputs execution frozen artifacts',async t=>{
  const f=await failureHistoryFixture(t),dir=f.preparationBase+'/attempts/1';
  for(const p of ['scope.json','definitions.json','inputs.json','execution.json','frozen/src/domain.mjs','output/artifacts/actual.json'])for(const mode of ['missing','changed'])await t.test(p+' '+mode,()=>historyMutation(f,dir+'/'+p,mode,()=>{for(const [name,call] of historyConsumers(f))prepRefuse(f,call,/history|ENOENT/);}));
 });
 await t.test('FH4 successor binding rejects replaced manifest pointer and reordered history',async t=>{
  const f=await failureHistoryFixture(t),jp=join(f.root,f.preparationBase+'/journal.json'),raw=fs.readFileSync(jp),j=JSON.parse(raw),fp=join(f.root,j.events[1].failureManifest.path),fr=fs.readFileSync(fp);
  const v=JSON.parse(fr);v.code='Reclassified';put(fp,v);j.events[1].failureManifest={...j.events[1].failureManifest,sha256:hash(fs.readFileSync(fp)),bytes:fs.statSync(fp).size};j.events[1].terminalClosure=hash(JSON.stringify(['PREP_HISTORY_TERMINAL_V1',v.priorClosure,1,j.events[0].startDescriptor.sha256,'FAILED',null,j.events[1].failureManifest.sha256]));put(jp,j);for(const [name,call] of historyConsumers(f))prepRefuse(f,call,/history prior closure/);fs.writeFileSync(fp,fr);fs.writeFileSync(jp,raw);
  for(const mutate of [j=>j.events.splice(1,1),j=>j.events.reverse(),j=>j.events[2].priorClosure='0'.repeat(64),j=>j.events[0].runSlug='foreign',j=>j.events[1].attempt=99]){const j=JSON.parse(raw);mutate(j);put(jp,j);for(const [name,call] of historyConsumers(f))prepRefuse(f,call,/history|journal|incomplete previous attempt/);fs.writeFileSync(jp,raw);}
 });
 await t.test('FH5 approved legacy prefix adoption preserves bytes and refuses altered checkpoint',async t=>{
  const f=await legacyThreeFixture(t),cp=f.assessedCheckpoint,base=f.preparationBase,old=fs.readFileSync(join(f.root,base+'/journal.json'));
  for(const path of ['evidence/assessed-checkpoint.json',cp.originalDesignApproval.path,cp.review.path,base+'/attempts/2/output/stdout.tap'])for(const mode of ['missing','changed'])historyMutation(f,path,mode,()=>prepRefuse(f,()=>f.preparationCLI(['--capture-component','P0'],{readonly:true}),/history|ENOENT/));
  const jp=join(f.root,base+'/journal.json'),j=JSON.parse(old);j.events.push({...j.events[0],attempt:4,sequence:4});put(jp,j);prepRefuse(f,()=>f.preparationCLI(['--capture-component','P0'],{readonly:true}),/history|adoption/);fs.writeFileSync(jp,old);
  prepRefuse(f,()=>f.cli(['batch']),/request planSha256|request designReportSha256|receipt inputs|request inputsDigest/);
  const c=prepJSON(f.preparationCLI(['--capture-component','P0']));assert.deepEqual(read(jp).events.slice(0,6),JSON.parse(old).events);assert.equal(read(join(f.root,c.receipt.path)).attempt,4);assert.deepEqual(fs.readFileSync(join(f.root,base+'/history/'+c.historyBinding.checkpointSha256+'/journal.json')),old);assert.match(fs.readFileSync(join(f.root,cp.review.path),'utf8'),/REQUEST_CHANGES/);saveHistoryEvidence(f,'FH5');
 });
 await t.test('FH6 pre-spawn and partial process output keep distinct existence states',async t=>{
  const {preparationComponentFixture}=await import('./evidence-fixture.mjs');
  for(const mode of ['pre-spawn','zero','partial']){
   const f=await preparationComponentFixture(t,{directProcess:true,suiteSource:mode==='zero'?"process.exit(9);":mode==='partial'?"process.stdout.write('partial TAP without summary\\n');process.stderr.write('actual stderr\\n');process.exit(9);":undefined}),hook=join(f.temporary,'pre-spawn.mjs');
   put(hook,"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const open=fs.openSync;fs.openSync=function(p,...a){if(String(p).endsWith('/output/stdout.tap'))throw Error('before spawn');return open.call(this,p,...a);};syncBuiltinESMExports();");
   const r=f.preparationCLI(['--capture-component','P0'],{preloads:mode==='pre-spawn'?[hook]:[]});assert.equal(r.status,1);const j=read(join(f.root,f.preparationBase+'/journal.json')),m=read(join(f.root,j.events.at(-1).failureManifest.path));assert.equal(j.events.at(-1).status,'FAILED');
   if(mode==='pre-spawn'){assert.equal(m.execution,null);assert.equal(m.existence.find(x=>x.path.endsWith('stdout.tap')).state,'NOT_PRODUCED');}else{assert.equal(read(join(f.root,m.execution.path)).exitCode,9);const raw=fs.readFileSync(join(f.root,f.preparationBase+'/attempts/1/output/stdout.tap'),'utf8');if(mode==='partial')assert.match(raw,/partial TAP/);else assert.equal(raw,'');}
  }
 });
 await t.test('FH6 managed descendant cannot mutate a frozen failure after parent exit',async t=>{
  const {preparationComponentFixture}=await import('./evidence-fixture.mjs');
  const source="import {spawn} from 'node:child_process';import fs from 'node:fs';fs.mkdirSync(process.env.ENTERPRISE_SUITE_OUTPUT,{recursive:true});const child=spawn(process.execPath,['-e',\"require('fs').writeFileSync(process.env.ENTERPRISE_SUITE_OUTPUT+'/producer-started','started');setTimeout(()=>require('fs').writeFileSync(process.env.ENTERPRISE_SUITE_OUTPUT+'/late','late'),10000);\"],{stdio:'ignore'});while(!fs.existsSync(process.env.ENTERPRISE_SUITE_OUTPUT+'/producer-started'))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);child.unref();process.exit(9);";
  const f=await preparationComponentFixture(t,{directProcess:true,suiteSource:source}),r=f.preparationCLI(['--capture-component','P0']);assert.equal(r.status,1);const dir=f.preparationBase+'/attempts/1',execution=read(join(f.root,dir+'/execution.json'));assert.deepEqual(execution.producers,{remaining:true,stopped:true});assert.equal(execution.exitCode,9);assert.equal(fs.existsSync(join(f.root,dir+'/output/artifacts/late')),false);assert.equal(read(join(f.root,f.preparationBase+'/journal.json')).events.at(-1).status,'FAILED');saveHistoryEvidence(f,'FH6-producer-stop');
 });
 await t.test('FH7 changed inputs retain primary diagnostic and secondary subprocess failure',async t=>{
  const {preparationComponentFixture}=await import('./evidence-fixture.mjs');
  for(const fail of [false,true]){const f=await preparationComponentFixture(t,{directProcess:true,suiteSource:"import test from 'node:test';import fs from 'node:fs';test('real arithmetic assertion',()=>{fs.appendFileSync('src/domain.mjs','changed');"+(fail?"throw Error('secondary failure');":"")+"});"});const r=f.preparationCLI(['--capture-component','P0']);assert.equal(r.status,1);const j=read(join(f.root,f.preparationBase+'/journal.json')),m=read(join(f.root,j.events.at(-1).failureManifest.path));assert.match(j.events.at(-1).error,/preparation inputs changed/);assert.equal(read(join(f.root,m.execution.path)).exitCode,fail?1:0);assert.notEqual(read(join(f.root,m.inputsAfter.path)).digest,read(join(f.root,f.preparationBase+'/attempts/1/inputs.json')).digest);}
 });
 await t.test('FH8 failed manifest and terminal persistence retain owned fences',async t=>{
  const {preparationComponentFixture}=await import('./evidence-fixture.mjs');
  for(const mode of ['manifest-open','manifest-fsync','manifest-readback','journal-fsync','terminal-rename','terminal-readback','journal-CAS','foreign-lock']){
   const f=await failureHistoryFixture(t);f.env.FH_FAIL='1';const hook=join(f.temporary,'fault.mjs');
   const inject=mode==='journal-fsync'?"const paths=new Map();fs.openSync=function(p,...a){const fd=open.call(this,p,...a);paths.set(fd,String(p));return fd;};fs.fsyncSync=function(fd){const p=paths.get(fd);if(p?.includes('/journal.json.')&&JSON.parse(read(p)).events.at(-1).status==='FAILED')throw Error('injected journal fsync');return sync(fd);};":mode==='manifest-readback'?"fs.readFileSync=function(p,...a){if(String(p).endsWith('/attempts/3/failure.json'))throw Error('injected manifest readback');return read(p,...a);};":mode==='manifest-open'?"fs.openSync=function(p,...a){if(String(p).endsWith('/attempts/3/failure.json'))throw Error('injected manifest open');return open.call(this,p,...a);};":mode==='manifest-fsync'?"fs.openSync=function(p,...a){const fd=open.call(this,p,...a);if(String(p).endsWith('/attempts/3/failure.json'))target=fd;return fd;};fs.fsyncSync=function(fd){if(fd===target)throw Error('injected fsync');return sync(fd);};":mode==='terminal-readback'?"fs.renameSync=function(a,b){const result=rename(a,b);if(String(b).endsWith('/journal.json')&&JSON.parse(read(b)).events.at(-1).status==='FAILED')bad=true;return result;};fs.readFileSync=function(p,...a){if(bad&&String(p).endsWith('/journal.json'))throw Error('injected readback');return read(p,...a);};":mode==='terminal-rename'?"fs.renameSync=function(a,b){if(String(b).endsWith('/journal.json')&&JSON.parse(read(a)).events.at(-1).status==='FAILED')throw Error('injected terminal rename');return rename(a,b);};":mode==='journal-CAS'?"fs.openSync=function(p,...a){if(String(p).endsWith('/attempts/3/failure.json'))write(String(p).replace(/attempts\\/3\\/failure.json$/,'journal.json'),'foreign journal');return open.call(this,p,...a);};":"fs.openSync=function(p,...a){if(String(p).endsWith('/attempts/3/failure.json'))write(String(p).replace(/attempts\\/3\\/failure.json$/,'writer.lock'),'foreign lock');return open.call(this,p,...a);};";
   put(hook,"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const open=fs.openSync,read=fs.readFileSync,write=fs.writeFileSync,rename=fs.renameSync,sync=fs.fsyncSync;let target,bad=false;"+inject+"syncBuiltinESMExports();");const r=f.preparationCLI(['--capture-component','P0'],{preloads:[hook]});assert.equal(r.status,1);assert.equal(fs.existsSync(join(f.root,f.preparationBase+'/writer.lock')),true,mode+': '+r.stderr);for(const [name,call] of historyConsumers(f))prepRefuse(f,call,/fenced/);if(mode==='foreign-lock')assert.equal(fs.readFileSync(join(f.root,f.preparationBase+'/writer.lock'),'utf8'),'foreign lock');if(mode==='journal-CAS')assert.equal(fs.readFileSync(join(f.root,f.preparationBase+'/journal.json'),'utf8'),'foreign journal');saveHistoryEvidence(f,'FH8-'+mode);
  }
 });
 await t.test('FH9 real SIGKILL leaves incomplete attempts fenced',async t=>{
  const {preparationComponentFixture}=await import('./evidence-fixture.mjs');
  for(const stage of ['before-running','partial-output','terminal']){
   const f=await preparationComponentFixture(t,{directProcess:true,suiteSource:stage==='partial-output'?"process.stdout.write('partial');process.kill(process.ppid,'SIGKILL');process.exit(7);":undefined}),hook=join(f.temporary,'kill.mjs');
   put(hook,"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const rename=fs.renameSync;fs.renameSync=function(a,b){if(String(b)==="+JSON.stringify(join(f.root,f.preparationBase+'/journal.json'))+"){const e=JSON.parse(fs.readFileSync(a)).events.at(-1);if(e.status==="+JSON.stringify(stage==='before-running'?'RUNNING':'PASSED')+"){if(e.status==='PASSED')rename(a,b);process.kill(process.pid,'SIGKILL');}}return rename(a,b);};syncBuiltinESMExports();");
   const r=f.preparationCLI(['--capture-component','P0'],{preloads:stage==='partial-output'?[]:[hook]});assert.equal(r.signal,'SIGKILL',JSON.stringify({stage,status:r.status,stderr:r.stderr}));assert.equal(fs.existsSync(join(f.root,f.preparationBase+'/writer.lock')),true);prepRefuse(f,()=>f.preparationCLI(['--capture-component','P0'],{readonly:true}),/fenced|EEXIST/);saveHistoryEvidence(f,'FH9-'+stage);
  }
 });
 await t.test('FH10 prior evidence mutation at capture await rejects publication',async t=>{
  const f=await failureHistoryFixture(t),hook=join(f.temporary,'concurrent.mjs'),path=join(f.root,f.preparationBase+'/attempts/1/diagnostic.txt');
  put(hook,"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const rename=fs.renameSync;fs.renameSync=function(a,b){const r=rename(a,b);if(String(b).endsWith('/journal.json')&&JSON.parse(fs.readFileSync(b)).events.at(-1).status==='RUNNING')fs.appendFileSync("+JSON.stringify(path)+",'concurrent');return r;};syncBuiltinESMExports();");const r=f.preparationCLI(['--capture-component','P0'],{preloads:[hook]});assert.equal(r.status,1);assert.match(r.stderr,/history/);assert.equal(fs.existsSync(join(f.root,f.preparationBase+'/writer.lock')),true);for(const [name,call] of historyConsumers(f))prepRefuse(f,call,/history|fenced/);saveHistoryEvidence(f,'FH10-capture');
 });
 for(const boundary of ['review-await','import-await','import-published'])await t.test('FH10 '+boundary+' refuses changed predecessor',async t=>{
  const f=await failureHistoryFixture(t),path=join(f.root,f.preparationBase+'/attempts/1/diagnostic.txt'),hook=join(f.temporary,'boundary.mjs');
  fs.unlinkSync(join(f.root,f.preparationBase+'/acceptances.json'));
  const inject=boundary==='import-published'?"const rename=fs.renameSync;fs.renameSync=function(a,b){const result=rename(a,b);if(String(b).endsWith('/acceptances.json'))fs.appendFileSync("+JSON.stringify(path)+",'concurrent');return result;};":"const read=fs.readFileSync;let once=false;fs.readFileSync=function(p,...a){const result=read(p,...a);if(!once&&String(p)==="+JSON.stringify(prepReport(f))+"){once=true;queueMicrotask(()=>fs.appendFileSync("+JSON.stringify(path)+",'concurrent'));}return result;};";
  put(hook,"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';"+inject+"syncBuiltinESMExports();");const args=boundary==='review-await'?['--inspect-component-review']:['--import-component-review',prepReport(f)],result=f.preparationCLI(args,{preloads:[hook]});assert.equal(result.status,1);assert.match(result.stderr,/history/);assert.match(fs.readFileSync(path,'utf8'),/concurrent$/);assert.equal(fs.existsSync(join(f.root,f.preparationBase+'/acceptances.json')),boundary==='import-published');if(boundary==='import-published')assert.ok(fs.existsSync(join(f.root,f.preparationBase+'/writer.lock')));for(const [name,call] of historyConsumers(f))prepRefuse(f,call,/history|fenced/);saveHistoryEvidence(f,'FH10-'+boundary);
 });
 await t.test('FH11 exact history head binds both phases and idempotent dedicated import',async t=>{
  const f=await failureHistoryFixture(t),r=prepJSON(f.preparationCLI(['--import-component-review',prepReport(f)],{readonly:true}));assert.equal(r.schemaVersion,3);assert.equal(r.attestation.schemaVersion,4);assert.deepEqual(r.historyHead,f.historyCandidate.historyHead);assert.deepEqual(r.historyBinding,f.historyCandidate.historyBinding);assert.equal(r.idempotent,true);
  const records=f.records.filter(x=>x.type==='phase_complete'&&x.step==='review-foundation');for(const x of records){const a=prepDecision(f,f.historyCandidate,'APPROVE',6);a.historyHead.terminalClosure='0'.repeat(64);x.content='```enterprise-batch-attestation\n'+JSON.stringify(a)+'\n```';}put(prepReport(f),records.at(-1).content+'\n');f.append({type:'test-flush'});prepRefuse(f,()=>f.preparationCLI(['--import-component-review',prepReport(f)],{readonly:true}),/review historyHead/);
 });
 await t.test('FH12 fresh history schema through real frozen engine and command runner',t=>prepEngineScenario(t,{legacy:true}));
});

// RF-P0-02: each consumer first accepts a real captured success in its own
// authenticated phase, then must reject missing or modified post-execution bytes.
test('preparation-success-inputs-regressions',async t=>{
 const {preparationComponentFixture}=await import('./evidence-fixture.mjs');
 const f=recordHistoryCalls(await preparationComponentFixture(t));
 const check=async(label,call,paths)=>{
  prepJSON(call());
  for(const path of paths)for(const mode of ['missing','empty','changed'])await t.test(label+' '+path.split('/').at(-2)+' '+mode,()=>historyMutation(f,path,mode,()=>prepRefuse(f,call,/history.*inputs-after|ENOENT.*inputs-after/)));
  prepJSON(call());
 };
 const postPaths=[];
 for(const iteration of [3,5]){
  const candidate=prepJSON(f.preparationCLI(['--capture-component','P0']));
  const receipt=read(join(f.root,candidate.receipt.path));postPaths.push(f.preparationBase+'/attempts/'+receipt.attempt+'/inputs-after.json');
  const postRef=receipt.frozen.entries.find(ref=>ref.path===postPaths.at(-1));assert.ok(postRef,'post-input raw reference');assert.equal(postRef.sha256,hash(fs.readFileSync(join(f.root,postRef.path))));assert.equal(postRef.bytes,fs.statSync(join(f.root,postRef.path)).size);
  await check('capture',()=>f.preparationCLI(['--capture-component','P0'],{readonly:true}),postPaths);
  await check('gate',()=>f.cli(['batch']),postPaths);
  f.records.splice(f.records.findLastIndex(r=>r.type==='step_start'),1);f.preparationPhases('build-foundation',iteration,candidate,'enterprise-preparation-candidate');f.context('review-foundation',iteration+1);
  await check('candidate',()=>f.preparationCLI(['--inspect-component-candidate'],{readonly:true}),postPaths);
  f.records.splice(f.records.findLastIndex(r=>r.type==='step_start'),1);f.preparationPhases('review-foundation',iteration+1,prepDecision(f,candidate,'APPROVE',iteration+1),'enterprise-batch-attestation');f.context('build-foundation',iteration+2);
  await check('review',()=>f.preparationCLI(['--inspect-component-review'],{readonly:true}),postPaths);
  // The first real import establishes an authenticated idempotent positive.
  prepJSON(f.preparationCLI(['--import-component-review',prepReport(f)]));
  await check('import',()=>f.preparationCLI(['--import-component-review',prepReport(f)],{readonly:true}),postPaths);
  for(const path of postPaths)for(const mode of ['missing','empty','changed'])await t.test('next capture '+path.split('/').at(-2)+' '+mode,()=>historyMutation(f,path,mode,()=>prepRefuse(f,()=>f.preparationCLI(['--capture-component','P0'],{readonly:true}),/history.*inputs-after|ENOENT.*inputs-after/)));
 }
 saveHistoryEvidence(f,'RF-P0-02');
});

function sourceDecision(f,c,iteration=8){const a=prepDecision(f,c,'APPROVE',iteration);a.acceptedComponents=['P0-control','P0-source-provenance'];a.reviewedCaseIds=read(join(f.root,c.receipt.path)).definitions.scope.reviewedCaseIds;return a;}
function sourceFinish(f,c){f.records.splice(f.records.findLastIndex(r=>r.type==='step_start'),1);f.preparationPhases('build-foundation',c.iteration,c,'enterprise-preparation-candidate');f.preparationPhases('review-foundation',8,sourceDecision(f,c),'enterprise-batch-attestation');f.context('build-foundation',9);}

test('preparation-source-provenance-regressions',async t=>{
 const {sourceProvenanceFixture}=await import('./evidence-fixture.mjs');
 const inspect=f=>f.preparationCLI(['--inspect-source-provenance'],{readonly:true}),capture=f=>prepJSON(f.preparationCLI(['--capture-component','P0']));
 await t.test('SA1',async t=>{
  const f=await sourceProvenanceFixture(t),before=tree(f.temporary),a=prepJSON(inspect(f));assert.deepEqual(tree(f.temporary),before);assert.equal(a.sourceIdentity.runSlug,f.oldRun.slug);assert.notEqual(a.sourceIdentity.runSlug,f.run.slug);assert.equal(f.sourceEngineResult.realEngine,true);assert.equal(f.sourceEngineResult.result.iteration,2);assert.deepEqual(a.occurrences.map(o=>o.sessionBinding),['AUTHENTICATED','AUTHENTICATED']);assert.notEqual(a.occurrences[0].providerSessionId,a.occurrences[1].providerSessionId);assert.equal(a.completeH,false);assert.equal(a.targetLaunchAuthority,false);
 });
 await t.test('SA2',async t=>{
  for(const target of ['meta','bundle','checkpoint'])await t.test(target,async t=>{const f=await sourceProvenanceFixture(t);prepJSON(inspect(f));const path=target==='meta'?f.oldRun.metaAbs:target==='bundle'?join(f.oldRun.workflowBundleAbs,'manifest.json'):join(f.root,'work/enterprise/progress.json');fs.appendFileSync(path,' ');prepRefuse(f,()=>inspect(f),/source|successor|changed/);});
 });
 await t.test('SA3',async t=>{
  for(const mode of ['missing','duplicate','unfinished','reordered','forked','unknown'])await t.test(mode,async t=>{
   const f=await sourceProvenanceFixture(t,{sourceOptions:{mutate:r=>{const i=r.events.findIndex(x=>x.type==='phase_complete');if(mode==='missing')r.events.splice(i,1);if(mode==='duplicate')r.events.splice(i,0,structuredClone(r.events[i]));if(mode==='unfinished')r.events[i].status='error';if(mode==='reordered')[r.events[i-1],r.events[i]]=[r.events[i],r.events[i-1]];if(mode==='forked')r.events[i].phaseExecutionId+=':fork';if(mode==='unknown')r.events.splice(i,0,{...r.events[i],type:'unknown_review_activity'});}}});
   prepRefuse(f,()=>inspect(f),/source missing|source incomplete|source phase|source unknown/);
  });
 });
 await t.test('SA4',async t=>{
  const missing=await sourceProvenanceFixture(t,{sourceOptions:{missingProducer:true}}),a=prepJSON(inspect(missing));assert.ok(a.occurrences.every(o=>o.sessionBinding==='UNPROVEN'));assert.equal(a.unresolved.filter(x=>x.reason==='SAVED_PRODUCER_BOUND_SESSION_RECORD_REQUIRED').length,2);missing.sessions[JSON.stringify(['enterprise-builder','codex','gpt-6.1-sol'])]='invented-source-id';savePersonaSessions(missing.root,missing.sessions,'codex',missing.paths.sessionsDirectory);assert.ok(prepJSON(inspect(missing)).occurrences.every(o=>o.sessionBinding==='UNPROVEN'));
  const same=await sourceProvenanceFixture(t,{sourceOptions:{sameSession:true}});prepRefuse(same,()=>inspect(same),/source independent reviewer aliases writer/);
  const bad=await sourceProvenanceFixture(t,{sourceOptions:{mutate:r=>{r.executions[0].payload.providerSessionId='self-asserted';}}});prepRefuse(bad,()=>inspect(bad),/source producer signature/);
 });
 await t.test('SA5',async t=>{
  const f=await sourceProvenanceFixture(t,{sourceOptions:{designHistory:true}}),a=prepJSON(inspect(f));assert.equal(a.referenceAudit.orders[0].definitionStatus,'BOUND_ORIGINAL_BYTES');assert.equal(a.referenceAudit.orders[0].originalPlan.schemaVersion,1);assert.notEqual(a.referenceAudit.orders[0].originalPlan.sha256,hash(fs.readFileSync(join(f.root,'work/enterprise/plan.json'))));assert.ok(a.occurrences.every(o=>o.originalDefinition==='UNPROVEN'));const path=join(f.oldRun.reportsAbs,'source-review.md');fs.appendFileSync(path,'foreign approval');prepRefuse(f,()=>inspect(f),/source canonical phase report/);
  for(const mode of ['foreign','stale','uncompleted'])await t.test(mode,async t=>{
   const f=await sourceProvenanceFixture(t,{sourceOptions:{missingProducer:true,mutate:(r,f)=>{const v={runSlug:mode==='foreign'?'foreign':f.run.slug,iteration:mode==='stale'?99:1,planSha256:'0'.repeat(64),schemaVersion:1};const content='```enterprise-recovery-design-attestation\n'+JSON.stringify(v)+'\n```';for(const x of r.events.filter(e=>e.iteration===1&&e.type==='phase_complete'&&e.phase<3))x.content=content;put(join(f.run.reportsAbs,'source.md'),content+'\n');}}});prepRefuse(f,()=>inspect(f),/source foreign|source stale|source design order role/);
  });
 });
 await t.test('source original order required fields cannot become unproven',async t=>{
  for(const field of ['planSha256','contractSha256','runSlug','workflowRef','iteration'])await t.test(field,async t=>{
   const f=await sourceProvenanceFixture(t,{sourceOptions:{designHistory:true,orderMutation:o=>delete o[field]}});prepRefuse(f,()=>inspect(f),/source original (plan hash|contract hash|order run|order workflow|order iteration)/);
  });
 });
 await t.test('source named path and hash pairs retain each consumer',async t=>{
  const f=await sourceProvenanceFixture(t,{sourceOptions:{designHistory:true,orderMutation:o=>{o.previousReport={reportPath:'evidence/missing-report.md',reportSha256:'b'.repeat(64)};}}}),a=prepJSON(inspect(f));
  const retained=a.unresolved.filter(x=>x.expectedHash==='b'.repeat(64));assert.equal(retained.length,1);assert.equal(retained[0].pointer,'/blocks/0/previousReport/reportPath');assert.equal(retained[0].disposition,'UNPROVEN');
 });
 await t.test('SA6',async t=>{
  const f=await sourceProvenanceFixture(t);prepJSON(inspect(f));const target=join(f.oldRun.reportsAbs,'source.md'),raw=fs.readFileSync(target),copy=join(f.temporary,'redirect.md');fs.writeFileSync(copy,raw);fs.unlinkSync(target);fs.symlinkSync(copy,target);prepRefuse(f,()=>inspect(f),/symlink|escape|canonical/);
  const g=await sourceProvenanceFixture(t),hook=join(g.temporary,'changed-read.mjs'),path=join(g.oldRun.reportsAbs,'source.md');put(hook,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';let n=0;const read=fs.readFileSync;fs.readFileSync=function(p,...a){const b=read.call(this,p,...a);if(String(p)===${JSON.stringify(path)}&&++n>1)return Buffer.concat([Buffer.from(b),Buffer.from('changed')]);return b};syncBuiltinESMExports();`);prepRefuse(g,()=>g.preparationCLI(['--inspect-source-provenance'],{readonly:true,preloads:[hook]}),/source canonical|source dependencies/);
 });
 await t.test('SA7',async t=>{
  const f=await sourceProvenanceFixture(t);prepJSON(inspect(f));
  for(const expression of ["inspectSourceProvenance(process.cwd(),{historicalRunSlug:'source-run'})","inspectSourceProvenance(process.cwd(),()=>true)","inspectRuntimePreparation(process.cwd())"]){prepRefuse(f,()=>spawnSync(process.execPath,['--import',f.guardPath,'--input-type=module','-e',"import {inspectSourceProvenance,inspectRuntimePreparation} from './scripts/enterprise/runtime-preparation.mjs';await "+expression],{cwd:f.root,env:f.env,encoding:'utf8'}),/override|source|attestation|design|binding/);}
  prepRefuse(f,()=>f.preparationCLI(['--inspect-source-provenance','--source','foreign'],{readonly:true}),/override/);
 });
 await t.test('SA8',async t=>{
  const refs=[{path:'evidence/missing-source-a.json',sha256:'a'.repeat(64)},{path:'evidence/missing-source-b.json',sha256:'a'.repeat(64)}],f=await sourceProvenanceFixture(t,{sourceOptions:{missingProducer:true,references:refs}}),a=prepJSON(inspect(f));assert.equal(a.referenceAudit.obligations.length,4);assert.equal(a.referenceAudit.consumers.length,2);assert.equal(a.unresolved.filter(x=>x.expectedHash==='a'.repeat(64)).length,4);assert.equal(a.actualSourceProvenance,'UNPROVEN');assert.equal(a.actualHistoryCompleteness,'UNPROVEN');assert.ok(a.unresolved.some(x=>x.reason==='DECLARATION_IS_NOT_HISTORICAL_INSTALLATION_OR_HOST_PROOF'));assert.ok(a.unresolved.some(x=>x.reason==='TERMINAL_IS_NOT_WRITER_EXCLUSION'));assert.ok(a.unresolved.every(x=>typeof x.pointer==='string'&&x.disposition==='UNPROVEN'));assert.equal(a.completeH,false);
 });
 await t.test('SA9',async t=>{
  const f=await sourceProvenanceFixture(t),c=capture(f),r=read(join(f.root,c.receipt.path));assert.equal(c.acceptanceScope.profileId,'P0-source-provenance-v1');assert.notEqual(c.acceptanceScope.definitionSha256,f.predecessorCandidate.acceptanceScope.definitionSha256);assert.deepEqual(r.definitions.required,['real arithmetic assertion']);assert.equal(r.definitions.scope.retainedObligations[0].disposition,'REQUIRED_NOT_ACCEPTED');sourceFinish(f,c);const bad=sourceDecision(f,c);bad.acceptedComponents=['P0-control'];for(const x of f.records.filter(x=>x.step==='review-foundation'&&x.iteration===8&&x.type==='phase_complete'))x.content='```enterprise-batch-attestation\n'+JSON.stringify(bad,null,2)+'\n```';f.append({type:'test-flush'});put(prepReport(f),f.records.findLast(x=>x.step==='review-foundation'&&x.type==='phase_complete').content+'\n');prepRefuse(f,()=>f.preparationCLI(['--import-component-review',prepReport(f)],{readonly:true}),/component scope/);
 });
 await t.test('SA10',async t=>{
  const f=await sourceProvenanceFixture(t),jp=join(f.root,f.preparationBase+'/journal.json'),old=read(jp),ledger=fs.readFileSync(join(f.root,f.preparationBase+'/acceptances.json'));prepRefuse(f,()=>f.cli(['batch']),/stale build|request|scope/);const c=capture(f);assert.equal(c.historyHead.attempt,2);assert.deepEqual(read(jp).events.slice(0,old.events.length),old.events);assert.deepEqual(fs.readFileSync(join(f.root,f.preparationBase+'/acceptances.json')),ledger);assert.equal(read(join(f.root,f.predecessorCandidate.receipt.path)).acceptanceScope.profileId,'P0-control-v2');
 });
 await t.test('SA11',async t=>{
  const f=await sourceProvenanceFixture(t,{sourceOptions:{missingProducer:true}}),c=capture(f),path=join(f.root,f.preparationBase+'/attempts/2/output/source-provenance/assessment.json'),raw=fs.readFileSync(path),assessment=JSON.parse(raw);assert.equal(assessment.actualSourceProvenance,'UNPROVEN');
  const check=call=>{prepJSON(call());for(const mode of ['missing','omitted','false-auth','inventory','authority']){if(mode==='missing')fs.unlinkSync(path);else{const a=structuredClone(assessment);if(mode==='omitted')a.unresolved=[];if(mode==='false-auth')a.actualSourceProvenance='AUTHENTICATED';if(mode==='inventory')a.inventory.pop();if(mode==='authority')a.completeH=a.productVerified=a.targetLaunchAuthority=true;put(path,a);}prepRefuse(f,call,/source|artifact|history|ENOENT/);fs.writeFileSync(path,raw);}prepJSON(call());};
  check(()=>f.preparationCLI(['--capture-component','P0'],{readonly:true}));check(()=>f.cli(['batch']));f.records.splice(f.records.findLastIndex(x=>x.type==='step_start'),1);f.preparationPhases('build-foundation',7,c,'enterprise-preparation-candidate');f.context('review-foundation',8);check(()=>f.preparationCLI(['--inspect-component-candidate'],{readonly:true}));f.records.splice(f.records.findLastIndex(x=>x.type==='step_start'),1);f.preparationPhases('review-foundation',8,sourceDecision(f,c),'enterprise-batch-attestation');f.context('build-foundation',9);check(()=>f.preparationCLI(['--inspect-component-review'],{readonly:true}));prepJSON(f.preparationCLI(['--import-component-review',prepReport(f)]));check(()=>f.preparationCLI(['--import-component-review',prepReport(f)],{readonly:true}));
 });
 await t.test('SA12',async t=>{
  await t.test('fresh fixed engine and real command gates',async t=>prepEngineScenario(t,{sourceProfile:true}));
  for(const mode of ['kill','CAS'])await t.test('new profile '+mode+' publication preserves fence',async t=>{const f=await sourceProvenanceFixture(t),journal=join(f.root,f.preparationBase+'/journal.json'),hook=join(f.temporary,'source-publication.mjs');put(hook,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const rename=fs.renameSync;fs.renameSync=function(a,b){if(String(b)===${JSON.stringify(journal)}&&JSON.parse(fs.readFileSync(a)).events.at(-1).status==='PASSED'&&JSON.parse(fs.readFileSync(a)).events.at(-1).attempt===2){${mode==='kill'?"process.kill(process.pid,'SIGKILL');":"fs.writeFileSync(b,'competing journal');throw Error('CAS changed');"}}return rename.apply(this,arguments)};syncBuiltinESMExports();`);const r=f.preparationCLI(['--capture-component','P0'],{preloads:[hook]});if(mode==='kill')assert.equal(r.signal,'SIGKILL');else assert.equal(r.status,1);assert.equal(fs.existsSync(join(f.root,f.preparationBase+'/writer.lock')),true);prepRefuse(f,()=>f.cli(['batch']),/fenced/);if(mode==='CAS')assert.equal(fs.readFileSync(journal,'utf8'),'competing journal');});
  await t.test('lost response and foreign fence preserve evidence',async t=>{const f=await sourceProvenanceFixture(t),c=capture(f),before=tree(f.temporary);assert.deepEqual(prepJSON(f.preparationCLI(['--capture-component','P0'],{readonly:true})),c);assert.deepEqual(tree(f.temporary),before);put(join(f.root,f.preparationBase+'/writer.lock'),'foreign writer');prepRefuse(f,()=>f.preparationCLI(['--capture-component','P0'],{readonly:true}),/fenced/);assert.equal(fs.readFileSync(join(f.root,f.preparationBase+'/writer.lock'),'utf8'),'foreign writer');});
 });
});

// Recovery admission and producer observations are prerequisites, not CR1-CR12
// completion. These tests deliberately grant no quiescence/recovery authority.
test('preparation-recovery-prerequisites',async t=>{
 const {preparationComponentFixture}=await import('./evidence-fixture.mjs');
 await t.test('all five consumers reject recovery fence and orphan intent without writes',async t=>{
  const f=await failureHistoryFixture(t);
  for(const marker of ['recovery.lock','recovery-journal.json']){
   const path=join(f.root,f.preparationBase,marker);put(path,'incomplete recovery');
   for(const [name,call] of historyConsumers(f))await t.test(marker+' '+name,()=>prepRefuse(f,call,/preparation recovery fenced/));
   fs.unlinkSync(path);
  }
  prepJSON(f.preparationCLI(['--inspect-component-review'],{readonly:true}));
  saveHistoryEvidence(f,'recovery-admission');
 });
 await t.test('fence is checked before first capture without request',async t=>{
  const f=await preparationComponentFixture(t);put(join(f.root,f.preparationBase,'recovery.lock'),'orphan owner');
  prepRefuse(f,()=>f.cli(['batch']),/preparation recovery fenced/);
  prepRefuse(f,()=>f.preparationCLI(['--capture-component','P0'],{readonly:true}),/preparation recovery fenced/);
 });
 await t.test('spawn and exit are durable before shutdown inspection fails',async t=>{
  const f=recordHistoryCalls(await preparationComponentFixture(t)),hook=join(f.temporary,'stop-denied.mjs');
  put(hook,`const kill=process.kill;process.kill=function(pid,signal){if(pid<0&&signal===0){const error=new Error('native inspection denied');error.code='EPERM';throw error}return kill.apply(this,arguments)};`);
  const result=f.preparationCLI(['--capture-component','P0'],{preloads:[hook]});assert.equal(result.status,1);assert.match(result.stderr,/native inspection denied/);
  const dir=join(f.root,f.preparationBase,'attempts/1'),observations=join(dir,'output/producer-observations');
  const start=read(join(observations,'spawn.json')),exit=read(join(observations,'exit.json'));
  assert.equal(start.kind,'PREPARATION_PRODUCER_SPAWN_OBSERVATION');assert.ok(start.pid>0);assert.ok(start.parentPid>0);assert.equal(start.completeProducerCoverage,false);assert.equal(start.quiescenceProven,false);
  assert.equal(exit.kind,'PREPARATION_PRODUCER_EXIT_OBSERVATION');assert.equal(exit.pid,start.pid);assert.equal(exit.exitCode,0);assert.equal(exit.signal,null);assert.equal(exit.quiescenceProven,false);
  assert.equal(read(join(observations,'stop-error-1.json')).code,'EPERM');assert.equal(read(join(observations,'stop-error-2.json')).code,'EPERM');
  assert.equal(read(join(f.root,f.preparationBase,'journal.json')).events.at(-1).status,'RUNNING');assert.ok(fs.existsSync(join(f.root,f.preparationBase,'writer.lock')));
  for(const absent of ['execution.json','failure.json','receipt.json'])assert.equal(fs.existsSync(join(dir,absent)),false);
  prepRefuse(f,()=>f.preparationCLI(['--capture-component','P0'],{readonly:true}),/preparation writer fenced/);saveHistoryEvidence(f,'producer-EPERM');
 });
 await t.test('normal capture authenticates native observations as outputs',async t=>{
  const f=recordHistoryCalls(await preparationComponentFixture(t)),candidate=prepJSON(f.preparationCLI(['--capture-component','P0'])),receipt=read(join(f.root,candidate.receipt.path));
  const paths=receipt.outputs.entries.filter(x=>x.path.includes('/producer-observations/'));assert.deepEqual(paths.map(x=>x.path.split('/').at(-1)),['exit.json','spawn.json']);
  prepJSON(f.cli(['batch']));const spawnPath=paths.find(x=>x.path.endsWith('/spawn.json')).path;
  historyMutation(f,spawnPath,'changed',()=>prepRefuse(f,()=>f.cli(['batch']),/history bytes|outputs changed/));
  prepJSON(f.cli(['batch']));saveHistoryEvidence(f,'producer-normal');
 });
 for(const operation of ['capture','import'])await t.test('recovery fence arriving after '+operation+' lock retains both owners',async t=>{
  const f=operation==='capture'?recordHistoryCalls(await preparationComponentFixture(t)):await failureHistoryFixture(t);
  const lock=join(f.root,f.preparationBase,'writer.lock'),marker=join(f.root,f.preparationBase,'recovery.lock'),hook=join(f.temporary,'admission-race.mjs');
  // A real ordinary lock acquisition is the synchronization boundary. The
  // contender's bytes must survive; this does not pretend to prove quiescence.
  put(hook,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const open=fs.openSync;fs.openSync=function(path,...args){const fd=open.call(this,path,...args);if(String(path)===${JSON.stringify(lock)}&&args[0]==='wx')fs.writeFileSync(${JSON.stringify(marker)},'competing recovery');return fd};syncBuiltinESMExports();`);
  if(operation==='import')fs.unlinkSync(join(f.root,f.preparationBase,'acceptances.json'));
  const jp=join(f.root,f.preparationBase,'journal.json'),before=fs.existsSync(jp)?fs.readFileSync(jp):null;
  const args=operation==='capture'?['--capture-component','P0']:['--import-component-review',prepReport(f)];
  const r=f.preparationCLI(args,{preloads:[hook]});assert.equal(r.status,1);assert.match(r.stderr,/preparation recovery fenced/);
  assert.equal(fs.readFileSync(marker,'utf8'),'competing recovery');assert.ok(fs.existsSync(lock));
  assert.deepEqual(fs.existsSync(jp)?fs.readFileSync(jp):null,before);assert.equal(fs.existsSync(join(f.root,f.preparationBase,'acceptances.json')),false);
  prepRefuse(f,()=>f.cli(['batch']),/preparation recovery fenced/);saveHistoryEvidence(f,'admission-race-'+operation);
 });
 await t.test('producer observation durability failure cannot publish a successful receipt',async t=>{
  const f=recordHistoryCalls(await preparationComponentFixture(t,{directProcess:true,suiteSource:'setInterval(()=>{},1000);'})),hook=join(f.temporary,'observation-fsync.mjs');
  put(hook,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const open=fs.openSync,close=fs.closeSync,flush=fs.fsyncSync,tracked=new Set();fs.openSync=function(p,...a){const fd=open.call(this,p,...a);if(String(p).endsWith('/producer-observations/spawn.json'))tracked.add(fd);return fd};fs.closeSync=function(fd){tracked.delete(fd);return close.call(this,fd)};fs.fsyncSync=function(fd){if(tracked.has(fd))throw Error('producer observation fsync failure');return flush.call(this,fd)};syncBuiltinESMExports();`);
  const r=f.preparationCLI(['--capture-component','P0'],{preloads:[hook]});assert.equal(r.status,1);assert.match(r.stderr,/producer observation fsync failure/);
  const exit=read(join(f.root,f.preparationBase,'attempts/1/output/producer-observations/exit.json'));assert.equal(exit.signal,'SIGTERM');assert.equal(exit.exitCode,null);
  assert.throws(()=>process.kill(-exit.pid,0),error=>error.code==='ESRCH');
  assert.ok(fs.existsSync(join(f.root,f.preparationBase,'writer.lock')));assert.equal(fs.existsSync(join(f.root,f.preparationBase,'request.json')),false);assert.equal(fs.existsSync(join(f.root,f.preparationBase,'attempts/1/receipt.json')),false);
  prepRefuse(f,()=>f.preparationCLI(['--capture-component','P0'],{readonly:true}),/writer fenced/);saveHistoryEvidence(f,'observation-fsync');
 });

});


function recoveryWriteGuard(f){
 if(f.recoveryWriteGuard)return f.recoveryWriteGuard;
 const base=join(f.root,f.preparationBase),path=join(f.temporary,'scoped-recovery-guard.mjs');
 let source=fs.readFileSync(f.guardPath,'utf8');
 source=source.replace("const deny=name=>", "const nativeRecoveryFS={openSync:fs.openSync,closeSync:fs.closeSync,writeFileSync:fs.writeFileSync,mkdirSync:fs.mkdirSync,renameSync:fs.renameSync};\nconst deny=name=>");
 source+=`\nconst recoveryBase=${JSON.stringify(base)},writeFDs=new Set(),readOpen=fs.openSync;
const archive=p=>typeof p==='string'&&p.startsWith(recoveryBase+'/recoveries/')&&/^[a-f0-9]{64}\\/(authorization|producer-observation)\\.json$/.test(p.slice((recoveryBase+'/recoveries/').length));
const temp=p=>typeof p==='string'&&p.startsWith(recoveryBase+'/recovery-journal.json.')&&/^[a-f0-9-]+\\.tmp$/.test(p.slice((recoveryBase+'/recovery-journal.json.').length));
fs.openSync=function(p,flags,...rest){if(flags==='wx'&&(p===recoveryBase+'/recovery.lock'||archive(p)||temp(p))){const fd=nativeRecoveryFS.openSync(p,flags,...rest);writeFDs.add(fd);return fd;}return readOpen(p,flags,...rest)};
fs.closeSync=function(fd){writeFDs.delete(fd);return nativeRecoveryFS.closeSync(fd)};
fs.writeFileSync=function(fd,...rest){if(!writeFDs.has(fd))return deny('unscoped recovery write')();return nativeRecoveryFS.writeFileSync(fd,...rest)};
fs.mkdirSync=function(p,...rest){if(p!==recoveryBase+'/recoveries'&&!(typeof p==='string'&&p.startsWith(recoveryBase+'/recoveries/')&&/^[a-f0-9]{64}$/.test(p.slice((recoveryBase+'/recoveries/').length))))return deny('unscoped recovery mkdir')();return nativeRecoveryFS.mkdirSync(p,...rest)};
fs.renameSync=function(a,b){if(!temp(a)||b!==recoveryBase+'/recovery-journal.json')return deny('unscoped recovery rename')();return nativeRecoveryFS.renameSync(a,b)};
syncBuiltinESMExports();`;
 put(path,source);f.recoveryWriteGuard=path;return path;
}

// Preserve every original file and directory except the admission namespace's
// own directory mtime. Only the explicit recovery CLI may add these new records.
function recoveryOriginalTree(f){
 const prefix=join(f.root,f.preparationBase).slice(f.temporary.length);
 return tree(f.temporary).filter(e=>!['/recovery.lock','/recovery-journal.json'].some(n=>e.path===prefix+n)&&e.path!==prefix+'/recoveries'&&!e.path.startsWith(prefix+'/recoveries/')).map(e=>e.path===prefix?{...e,mtime:null}:e);
}

test('preparation-recovery-preflight',async t=>{
 const {captureRecoveryPreflightFixture}=await import('./evidence-fixture.mjs');
 const call=f=>f.preparationCLI(['--recover-preparation-capture'],{preloads:[recoveryWriteGuard(f)]});
 await t.test('authenticates a real incomplete tail without publishing a recovery terminal',async t=>{
  const f=recordHistoryCalls(await captureRecoveryPreflightFixture(t)),guard=recoveryWriteGuard(f),before=recoveryOriginalTree(f),r=call(f);
  assert.equal(r.status,1,r.stdout);assert.match(r.stderr,/PREPARATION_RECOVERY_UNPROVEN/);assert.doesNotMatch(r.stderr,/FS_MUTATION/);assert.deepEqual(recoveryOriginalTree(f),before);
  const value=JSON.parse(r.stderr.trim().split('\n').at(-1));assert.equal(value.recovery.originalTailAuthenticated,true);assert.equal(value.recovery.authorityAuthenticated,true);assert.equal(value.recovery.recoveryPerformed,false);assert.equal(value.recovery.quiescenceProven,false);assert.equal(value.recovery.historicalOutcome,'UNKNOWN');
  assert.equal(read(join(f.root,f.preparationBase,'journal.json')).events.at(-1).status,'RUNNING');
  for(const name of ['attempts/1/failure.json','attempts/1/receipt.json'])assert.equal(fs.existsSync(join(f.root,f.preparationBase,name)),false);
  saveHistoryEvidence(f,'recovery-preflight-unproven');
 });

 await t.test('authenticates the complete failed prefix and rejects its changed diagnostic',async t=>{
  const f=recordHistoryCalls(await captureRecoveryPreflightFixture(t,{priorFailed:true}));recoveryWriteGuard(f);
  const p=join(f.root,f.preparationBase,'attempts/1/diagnostic.txt'),before=fs.readFileSync(p);
  fs.appendFileSync(p,'changed');prepRefuse(f,()=>call(f),/history bytes/);fs.writeFileSync(p,before);
  const hook=join(f.temporary,'prior-diagnostic-race.mjs');
  put(hook,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const read=fs.readFileSync;let n=0;fs.readFileSync=function(p,...a){const b=read.call(this,p,...a);if(String(p)===${JSON.stringify(p)}&&++n>=4)return Buffer.concat([Buffer.from(b),Buffer.from('concurrent')]);return b};syncBuiltinESMExports();`);
  prepRefuse(f,()=>f.preparationCLI(['--recover-preparation-capture'],{readonly:true,preloads:[hook]}),/history bytes/);assert.match(call(f).stderr,/PREPARATION_RECOVERY_UNPROVEN/);saveHistoryEvidence(f,'recovery-failed-prefix');
 });

 for(const [name,change,pattern] of [
  ['anchor-run',(f,a)=>{a.runSlug='foreign';},/recovery anchor run/],
  ['anchor-attempt',(f,a)=>{a.attempt=2;},/recovery next sequence/],
  ['anchor-proof-claim',(f,a)=>{a.quiescenceProven=true;},/AssertionError/],
  ['anchor-absence',(f,a)=>{a.absentAtObservation.pop();},/recovery absent observations/],
  ['anchor-duplicate-original',(f,a)=>{a.references.push(a.references[0]);},/recovery duplicate original/],
  ['original-builder-incomplete',(f,a)=>{f.records.splice(f.records.findIndex(r=>r.type==='step_complete'&&r.iteration===3),1);},/incomplete preparation occurrence/],
  ['original-approval-phase',(f,a)=>{f.records.find(r=>r.type==='phase_complete'&&r.step==='review-architecture'&&r.phase===1).content='different phase';},/single enterprise-continuation-preparation-attestation/],
  ['prior-closure',(f,a)=>{const path=join(f.root,f.preparationBase,'journal.json'),j=read(path);j.events.at(-1).priorClosure='a'.repeat(64);put(path,j);},/history bytes/],
 ])await t.test(name+' rejects in an otherwise authorized context',async t=>{
  const f=recordHistoryCalls(await captureRecoveryPreflightFixture(t));recoveryWriteGuard(f);const path=join(f.root,f.recoveryAnchorPath),a=read(path);change(f,a);put(path,a);f.recoveryRefresh();prepRefuse(f,()=>call(f),pattern);saveHistoryEvidence(f,'recovery-'+name);
 });
 for(const mode of ['missing','empty','changed','extra','symlink'])await t.test('partial artifact '+mode+' refuses without writes',async t=>{
  const f=recordHistoryCalls(await captureRecoveryPreflightFixture(t));recoveryWriteGuard(f);const p=join(f.root,f.preparationBase,'attempts/1/output/stdout.tap');
  if(mode==='missing')fs.unlinkSync(p);if(mode==='empty')fs.writeFileSync(p,'');if(mode==='changed')fs.appendFileSync(p,'changed');if(mode==='extra')put(join(f.root,f.preparationBase,'attempts/1/unbound.bin'),'extra');if(mode==='symlink'){const target=join(f.temporary,'elsewhere.tap');fs.copyFileSync(p,target);fs.unlinkSync(p);fs.symlinkSync(target,p);}
  prepRefuse(f,()=>call(f),/history bytes|ENOENT|symlink|partial inventory changed/);saveHistoryEvidence(f,'recovery-partial-'+mode);
 });
 for(const marker of ['recovery.lock','recovery-journal.json'])await t.test(marker+' cannot be stolen by explicit entry',async t=>{
  const f=await captureRecoveryPreflightFixture(t);recoveryWriteGuard(f);put(join(f.root,f.preparationBase,marker),'orphan recovery');prepRefuse(f,()=>call(f),/recovery fenced/);
 });
 await t.test('foreign replacement writer fence remains untouched',async t=>{
  const f=await captureRecoveryPreflightFixture(t);recoveryWriteGuard(f);put(join(f.root,f.preparationBase,'writer.lock'),{owner:'foreign'});prepRefuse(f,()=>call(f),/history bytes/);
 });
 await t.test('extra caller arguments and stale current approval cannot select a target',async t=>{
  const f=await captureRecoveryPreflightFixture(t);recoveryWriteGuard(f);prepRefuse(f,()=>f.preparationCLI(['--recover-preparation-capture','--force'],{readonly:true}),/no authority overrides/);
  const path=join(f.root,'work/enterprise/plan.json');fs.appendFileSync(path,' ');prepRefuse(f,()=>call(f),/changed successor reference/);
 });
 await t.test('input change across authority await refuses',async t=>{
  const f=await captureRecoveryPreflightFixture(t),hook=join(f.temporary,'recovery-input-race.mjs'),path=join(f.root,f.preparationBase,'attempts/1/output/stdout.tap');
  // Change a referenced read after the initial authenticated inventory. This
  // runs in memory so neither a historical byte nor the fixture tree is edited.
  put(hook,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const read=fs.readFileSync;let n=0;fs.readFileSync=function(p,...a){const b=read.call(this,p,...a);if(String(p)===${JSON.stringify(path)}&&++n>=3)return Buffer.concat([Buffer.from(b),Buffer.from('concurrent')]);return b};syncBuiltinESMExports();`);
  prepRefuse(f,()=>f.preparationCLI(['--recover-preparation-capture'],{readonly:true,preloads:[hook]}),/history bytes|partial changed/);
 });
});

// Native observations are prerequisites, not CR acceptance or a stop proof.
test('preparation-recovery-native-observation',async t=>{
 const {captureRecoveryPreflightFixture,recoveryNativeProcessTree}=await import('./evidence-fixture.mjs');
 const observe=(f,preloads=[])=>{
  const guard=recoveryWriteGuard(f),before=recoveryOriginalTree(f),r=f.preparationCLI(['--recover-preparation-capture'],{preloads:[guard,...preloads]});
  assert.equal(r.status,1,r.stderr);assert.match(r.stderr,/PREPARATION_RECOVERY_UNPROVEN/);assert.doesNotMatch(r.stderr,/FS_MUTATION/);assert.deepEqual(recoveryOriginalTree(f),before);
  const v=JSON.parse(r.stderr.trim().split('\n').at(-1)).recovery;
  assert.equal(v.recoveryPerformed,false);assert.equal(v.quiescenceProven,false);assert.equal(v.completeProducerCoverage,false);
  const p=v.producerState;assert.equal(p.kind,'PREPARATION_NATIVE_PRODUCER_OBSERVATION');assert.equal(p.quiescenceProven,false);assert.equal(p.completeProducerCoverage,false);assert.deepEqual(p.signalsSent,[]);
  assert.ok(p.reasons.includes('COMPLETE_PRODUCER_COVERAGE_UNPROVEN'));assert.equal(p.exclusiveRecoveryAdmissionHeld,true);assert.ok(!p.reasons.includes('EXCLUSIVE_RECOVERY_ADMISSION_NOT_HELD'));return p;
 };
 await t.test('real native identity and empty handles remain unproven',async t=>{
  const f=recordHistoryCalls(await captureRecoveryPreflightFixture(t)),p=observe(f);
  assert.equal(p.platform,'darwin');assert.equal(p.commands.length,8);assert.deepEqual(p.hostIdentity,p.endHostIdentity);assert.ok(p.hostIdentity.host&&p.hostIdentity.boot);
  for(const s of p.scans){assert.equal(s.censusAvailable,true);assert.equal(s.handlesAvailable,true);assert.deepEqual(s.openHandles,[]);assert.equal(s.invocation.pid,p.invocation.pid);assert.equal(s.invocation.uid,p.invocation.uid);assert.ok(s.invocation.startTime);}
  assert.ok(p.reasons.includes('HISTORICAL_PROCESS_START_IDENTITY_UNPROVEN'));saveHistoryEvidence(f,'native-empty-unproven');
 });
 await t.test('real parent child and escaped grandchild open handles are observed without signals',async t=>{
  const f=recordHistoryCalls(await captureRecoveryPreflightFixture(t)),target=join(f.root,f.preparationBase,'attempts/1/output/stdout.tap');
  const family=await recoveryNativeProcessTree(target);
  try{
   const p=observe(f),ids=family.identities;
   for(const s of p.scans){for(const id of ids){assert.ok(s.openHandles.some(h=>h.pid===id.pid&&h.name===target),JSON.stringify(s));const process=s.processes.find(x=>x.pid===id.pid);assert.ok(process);assert.equal(process.ppid,id.ppid);}}
   const rows=p.scans[0].processes,parent=rows.find(x=>x.pid===ids[0].pid),child=rows.find(x=>x.pid===ids[1].pid),grandchild=rows.find(x=>x.pid===ids[2].pid);
   assert.equal(child.pgid,parent.pgid);assert.notEqual(grandchild.pgid,child.pgid);assert.equal(grandchild.pgid,grandchild.pid);
   assert.ok(p.reasons.includes('RELEVANT_OPEN_HANDLES_PRESENT'));saveHistoryEvidence(f,'native-live-family');
  }finally{await family.stop();}
  prepRefuse(f,()=>f.preparationCLI(['--recover-preparation-capture'],{readonly:true}),/recovery fenced/);
  const fresh=recordHistoryCalls(await captureRecoveryPreflightFixture(t)),stopped=observe(fresh);assert.deepEqual(stopped.scans.map(s=>s.openHandles),[[],[]]);assert.equal(stopped.quiescenceProven,false);saveHistoryEvidence(fresh,'native-family-exited-unproven');
 });
 for(const [name,inject,reason] of [
  ['ps-EPERM',"if(file==='/bin/ps'){const e=Error('native census EPERM');e.code='EPERM';throw e;}",'NATIVE_INSPECTION_FAILED'],
  ['lsof-EPERM',"if(file==='/usr/sbin/lsof')return {status:1,signal:null,stdout:'',stderr:'EPERM: inaccessible handle inventory'};",'NATIVE_INSPECTION_FAILED'],
  ['lsof-warning',"if(file==='/usr/sbin/lsof')return {status:0,signal:null,stdout:'',stderr:'WARNING: incomplete inventory'};",'NATIVE_INSPECTION_FAILED'],
  ['timeout',"if(file==='/bin/ps'){const error=Error('inspection timed out');error.code='ETIMEDOUT';return {status:null,signal:'SIGTERM',error,stdout:'',stderr:''};}",'NATIVE_INSPECTION_FAILED'],
  ['buffer-limit',"if(file==='/usr/sbin/lsof'){const error=Error('bounded observation exceeded');error.code='ENOBUFS';return {status:null,signal:'SIGTERM',error,stdout:'partial',stderr:''};}",'NATIVE_INSPECTION_FAILED'],
  ['ps-malformed',"if(file==='/bin/ps')return {...native(file,args,options),stdout:'not a process record\\n'};",'PROCESS_CENSUS_MALFORMED'],
  ['ps-empty',"if(file==='/bin/ps')return {...native(file,args,options),stdout:''};",'PROCESS_CENSUS_INCOMPLETE'],
  ['lsof-malformed',"if(file==='/usr/sbin/lsof')return {status:0,signal:null,stderr:'',stdout:'p123\\0f4\\0nmissing type and inode\\0'};",'OPEN_HANDLE_OUTPUT_MALFORMED'],
  ['boot-changed',"if(file==='/usr/sbin/sysctl'&&args[1]==='kern.bootsessionuuid'&&++boot===2)return {...native(file,args,options),stdout:'00000000-0000-0000-0000-000000000000\\n'};",'HOST_BOOT_IDENTITY_CHANGED'],
  ['host-unavailable',"if(file==='/usr/sbin/sysctl')return {status:1,signal:null,stdout:'',stderr:'identity unavailable'};",'HOST_BOOT_IDENTITY_UNAVAILABLE'],
  ['invocation-start-changed',"if(file==='/bin/ps'&&++census===2){const r=native(file,args,options);r.stdout=r.stdout.split('\\n').map(s=>s.trim().startsWith(process.pid+' ')?s.replace(/\\d{2}:\\d{2}:\\d{2}/,'00:00:00'):s).join('\\n');return r;}",'NATIVE_OBSERVATION_CHANGED'],
 ])await t.test(name+' cannot certify quiescence',async t=>{
  const f=recordHistoryCalls(await captureRecoveryPreflightFixture(t)),hook=join(f.temporary,'native-fault.mjs');
  put(hook,`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const native=cp.spawnSync;let boot=0,census=0;cp.spawnSync=function(file,args,options){${inject}return native.call(this,file,args,options)};syncBuiltinESMExports();`);
  const p=observe(f,[hook]);assert.ok(p.reasons.includes(reason),JSON.stringify(p.reasons));saveHistoryEvidence(f,'native-'+name);
 });
 await t.test('invalid authority refuses before native inspection',async t=>{
  const f=await captureRecoveryPreflightFixture(t),hook=join(f.temporary,'native-must-not-run.mjs');
  put(hook,"import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';cp.spawnSync=()=>{throw Error('NATIVE_REACHED_BEFORE_AUTHORITY')};syncBuiltinESMExports();");
  fs.appendFileSync(join(f.root,f.preparationBase,'writer.lock'),' ');
  const r=f.preparationCLI(['--recover-preparation-capture'],{readonly:true,preloads:[hook]});assert.equal(r.status,1);assert.match(r.stderr,/history bytes/);assert.doesNotMatch(r.stderr,/NATIVE_REACHED_BEFORE_AUTHORITY/);
 });
 await t.test('a reused recorded PID never authenticates a historical producer',async t=>{
  const f=recordHistoryCalls(await captureRecoveryPreflightFixture(t)),s=read(join(f.root,f.preparationBase,'attempts/1/output/producer-observations/spawn.json')),hook=join(f.temporary,'reused-pid.mjs');
  put(hook,`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const native=cp.spawnSync;cp.spawnSync=function(file,args,options){const r=native.call(this,file,args,options);if(file==='/bin/ps'){r.stdout=r.stdout.split('\\n').filter(s=>!s.trim().startsWith(${JSON.stringify(String(s.pid)+' ')})).join('\\n')+'\\n'+${JSON.stringify(String(s.pid))}+' 1 '+${JSON.stringify(String(s.pid))}+' '+process.getuid()+' Sun Oct 25 00:00:00 2099 S\\n';}return r};syncBuiltinESMExports();`);
  const p=observe(f,[hook]);assert.ok(p.reasons.includes('RECORDED_PID_OR_GROUP_PRESENT'));assert.ok(p.reasons.includes('HISTORICAL_PROCESS_START_IDENTITY_UNPROVEN'));assert.equal(p.historicalLineageAuthenticated,false);saveHistoryEvidence(f,'native-reused-pid');
 });
 await t.test('partial evidence changed during native inspection refuses on recheck',async t=>{
  const f=await captureRecoveryPreflightFixture(t),path=join(f.root,f.preparationBase,'attempts/1/output/stdout.tap'),hook=join(f.temporary,'native-read-race.mjs');
  put(hook,`import cp from 'node:child_process';import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const native=cp.spawnSync,read=fs.readFileSync;let inspected=false;cp.spawnSync=function(...a){inspected=true;return native.apply(this,a)};fs.readFileSync=function(p,...a){const raw=read.call(this,p,...a);return inspected&&String(p)===${JSON.stringify(path)}?Buffer.concat([Buffer.from(raw),Buffer.from('changed after observation')]):raw};syncBuiltinESMExports();`);
  const before=recoveryOriginalTree(f),r=f.preparationCLI(['--recover-preparation-capture'],{preloads:[hook]});assert.equal(r.status,1);assert.match(r.stderr,/history bytes|partial changed/);assert.deepEqual(recoveryOriginalTree(f),before);assert.ok(fs.existsSync(join(f.root,f.preparationBase,'recovery.lock')));
 });
 await t.test('native guard does not admit a shell or arbitrary command',async t=>{
  const f=await captureRecoveryPreflightFixture(t),r=spawnSync(process.execPath,['--import',f.guardPath,'--input-type=module','-e',"import {spawnSync} from 'node:child_process';for(const [p,a,o] of [['/bin/sh',['-c','true'],{}],['/bin/ps',['-A'],{shell:true}]]){try{spawnSync(p,a,o);process.exitCode=2}catch(e){if(!e.message.startsWith('FS_MUTATION:'))throw e}}"],{cwd:f.root,env:f.env,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
 });
});

test('preparation-recovery-admission',async t=>{
 const {captureRecoveryPreflightFixture}=await import('./evidence-fixture.mjs');
 await t.test('authenticated admission persists two phases and retains both fences on missing proof',async t=>{
  const f=recordHistoryCalls(await captureRecoveryPreflightFixture(t)),base=join(f.root,f.preparationBase);
  const old=tree(join(base,'attempts')),journal=fs.readFileSync(join(base,'journal.json')),fence=fs.readFileSync(join(base,'writer.lock'));
  const r=f.preparationCLI(['--recover-preparation-capture']);assert.equal(r.status,1);assert.match(r.stderr,/PREPARATION_RECOVERY_UNPROVEN/);
  const value=JSON.parse(r.stderr.trim().split('\n').at(-1)).recovery,lock=read(join(base,'recovery.lock')),j=read(join(base,'recovery-journal.json'));
  assert.equal(value.recoveryPerformed,false);assert.equal(value.quiescenceProven,false);assert.equal(value.completeProducerCoverage,false);
  assert.deepEqual(j.events.map(e=>e.phase),['AUTHENTICATED','FENCED']);assert.equal(j.recoveryId,lock.recoveryId);
  for(const e of j.events){assert.equal(e.owner,lock.owner);assert.equal(e.recoveryId,lock.recoveryId);assert.equal(e.inputsDigest,value.inputsDigest);}
  const p=read(join(f.root,value.observation.path));assert.equal(hash(fs.readFileSync(join(f.root,value.observation.path))),value.observation.sha256);
  assert.equal(p.exclusiveRecoveryAdmissionHeld,true);assert.equal(p.quiescenceProven,false);assert.ok(p.reasons.includes('COMPLETE_PRODUCER_COVERAGE_UNPROVEN'));
  assert.ok(!p.reasons.includes('EXCLUSIVE_RECOVERY_ADMISSION_NOT_HELD'));
  assert.deepEqual(tree(join(base,'attempts')),old);assert.deepEqual(fs.readFileSync(join(base,'journal.json')),journal);assert.deepEqual(fs.readFileSync(join(base,'writer.lock')),fence);
  for(const invoke of [()=>f.preparationCLI(['--recover-preparation-capture'],{readonly:true}),()=>f.preparationCLI(['--capture-component','P0'],{readonly:true}),()=>f.cli(['batch'])])prepRefuse(f,invoke,/recovery fenced/);
  saveHistoryEvidence(f,'recovery-admission-unproven');
 }); for(const mode of ['lock-fsync','intent-fsync','intent-rename','intent-CAS','intent-readback','authorization-fsync','observation-fsync','foreign-owner'])await t.test(mode+' retains blocking admission without rewriting original evidence',async t=>{
  const f=recordHistoryCalls(await captureRecoveryPreflightFixture(t)),base=join(f.root,f.preparationBase),hook=join(f.temporary,'admission-fault.mjs');
  const originals=tree(join(base,'attempts')),journal=fs.readFileSync(join(base,'journal.json')),writer=fs.readFileSync(join(base,'writer.lock'));
  put(hook,`import fs from 'node:fs';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const base=${JSON.stringify(base)},mode=${JSON.stringify(mode)},open=fs.openSync,close=fs.closeSync,flush=fs.fsyncSync,rename=fs.renameSync,read=fs.readFileSync,native=cp.spawnSync,paths=new Map();let injected=false,published=false;
fs.openSync=function(p,...a){const fd=open.call(this,p,...a);paths.set(fd,String(p));return fd};fs.closeSync=function(fd){paths.delete(fd);return close.call(this,fd)};
fs.fsyncSync=function(fd){const p=paths.get(fd)||'';if(!injected){
 const matched=(mode==='lock-fsync'&&p===base+'/recovery.lock')||(mode==='intent-fsync'&&p.startsWith(base+'/recovery-journal.json.')&&p.endsWith('.tmp'))||(mode==='authorization-fsync'&&p.endsWith('/authorization.json'))||(mode==='observation-fsync'&&p.endsWith('/producer-observation.json'));
 if(matched){injected=true;throw Error('injected '+mode)}
 if(mode==='intent-CAS'&&p.startsWith(base+'/recovery-journal.json.')&&p.endsWith('.tmp')){injected=true;fs.writeFileSync(base+'/recovery-journal.json','concurrent intent');}
 }return flush.call(this,fd)};
fs.renameSync=function(a,b){if(String(b)===base+'/recovery-journal.json'){if(mode==='intent-rename'&&!injected){injected=true;throw Error('injected intent-rename')}const r=rename.call(this,a,b);published=true;return r;}return rename.call(this,a,b)};
fs.readFileSync=function(p,...a){const r=read.call(this,p,...a);if(mode==='intent-readback'&&published&&String(p)===base+'/recovery-journal.json')return typeof r==='string'?r+'changed':Buffer.concat([r,Buffer.from('changed')]);return r};
cp.spawnSync=function(...a){if(mode==='foreign-owner'&&!injected){injected=true;fs.writeFileSync(base+'/foreign-owner','replacement owner');rename(base+'/foreign-owner',base+'/recovery.lock');}return native.apply(this,a)};syncBuiltinESMExports();`);
  const r=f.preparationCLI(['--recover-preparation-capture'],{preloads:[hook]});assert.equal(r.status,1);assert.match(r.stderr,/injected|recovery intent CAS|recovery admission owner changed/);assert.doesNotMatch(r.stderr,/PREPARATION_RECOVERY_UNPROVEN/);
  assert.deepEqual(tree(join(base,'attempts')),originals);assert.deepEqual(fs.readFileSync(join(base,'journal.json')),journal);assert.deepEqual(fs.readFileSync(join(base,'writer.lock')),writer);assert.ok(fs.existsSync(join(base,'recovery.lock')));
  if(mode==='foreign-owner')assert.equal(fs.readFileSync(join(base,'recovery.lock'),'utf8'),'replacement owner');
  if(mode==='intent-CAS')assert.equal(fs.readFileSync(join(base,'recovery-journal.json'),'utf8'),'concurrent intent');
  prepRefuse(f,()=>f.preparationCLI(['--recover-preparation-capture'],{readonly:true}),/recovery fenced/);prepRefuse(f,()=>f.cli(['batch']),/recovery fenced/);saveHistoryEvidence(f,'recovery-admission-'+mode);
 });
 await t.test('live owner excludes competing recovery and all readers; SIGKILL never grants takeover',async t=>{
  const f=recordHistoryCalls(await captureRecoveryPreflightFixture(t)),base=join(f.root,f.preparationBase),hook=join(f.temporary,'admission-pause.mjs'),ready=join(f.temporary,'owner-ready');
  put(hook,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const rename=fs.renameSync;fs.renameSync=function(a,b){const value=String(b)===${JSON.stringify(join(base,'recovery-journal.json'))}?JSON.parse(fs.readFileSync(a)):null;const r=rename.call(this,a,b);if(value?.events.at(-1).phase==='FENCED'){fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));for(;;)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000);}return r};syncBuiltinESMExports();`);
  const argv=['--import',hook,join(f.root,'scripts/enterprise/runtime-preparation.mjs'),'--recover-preparation-capture'],startedAt=new Date().toISOString();
  const child=spawn(process.execPath,argv,{cwd:f.root,env:f.env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  try{
   const limit=Date.now()+15000;while(!fs.existsSync(ready)&&Date.now()<limit){assert.equal(child.exitCode,null,stderr);await new Promise(r=>setTimeout(r,20));}assert.ok(fs.existsSync(ready),stderr);
   const before=tree(base);
   for(const args of [['--recover-preparation-capture'],['--capture-component','P0'],['--inspect-component-candidate'],['--inspect-component-review'],['--import-component-review',prepReport(f)]]){
    const r=f.preparationCLI(args,{readonly:true});assert.equal(r.status,1);assert.match(r.stderr,/recovery fenced/);assert.deepEqual(tree(base),before);
   }
   prepRefuse(f,()=>f.cli(['batch']),/recovery fenced/);assert.equal(child.kill('SIGKILL'),true);const outcome=await exited;assert.equal(outcome.signal,'SIGKILL');
   f.historyTrace.push({method:'actual-recovery-worker',argv,startedAt,finishedAt:new Date().toISOString(),...outcome,stdout,stderr});
   assert.deepEqual(tree(base),before);prepRefuse(f,()=>f.preparationCLI(['--recover-preparation-capture'],{readonly:true}),/recovery fenced/);
   assert.equal(read(join(base,'journal.json')).events.at(-1).status,'RUNNING');assert.deepEqual(read(join(base,'recovery-journal.json')).events.map(e=>e.phase),['AUTHENTICATED','FENCED']);saveHistoryEvidence(f,'recovery-live-owner-SIGKILL');
  }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;}
 });

});

test('preparation-recovery-archive-integrity',async t=>{
 const {captureRecoveryPreflightFixture}=await import('./evidence-fixture.mjs');
 for(const mode of ['authorization-content','authorization-missing','authorization-symlink','authorization-replaced','authorization-rewritten','authorization-after-FENCED','observation-after-readback','extra-artifact'])await t.test(mode+' refuses without adopting changed archive',async t=>{
  const f=recordHistoryCalls(await captureRecoveryPreflightFixture(t)),base=join(f.root,f.preparationBase),hook=join(f.temporary,'archive-race.mjs');
  put(hook,`import fs from 'node:fs';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const base=${JSON.stringify(base)},mode=${JSON.stringify(mode)},read=fs.readFileSync,rename=fs.renameSync,native=cp.spawnSync;let changed=false,held;
const change=()=>{if(changed)return;changed=true;const id=JSON.parse(read(base+'/recovery.lock')).recoveryId,dir=base+'/recoveries/'+id,p=dir+'/'+(mode==='observation-after-readback'?'producer-observation.json':'authorization.json'),raw=read(p),st=fs.statSync(p);held=fs.openSync(p,'r');
 if(mode==='authorization-missing')fs.unlinkSync(p);
 else if(mode==='authorization-symlink'){fs.writeFileSync(base+'/outside-archive',raw);fs.unlinkSync(p);fs.symlinkSync(base+'/outside-archive',p);}
 else if(mode==='authorization-replaced'){fs.writeFileSync(p+'.next',raw);fs.utimesSync(p+'.next',st.atime,st.mtime);rename(p+'.next',p);}
 else if(mode==='authorization-rewritten'){fs.writeFileSync(p,raw);fs.utimesSync(p,st.atime,st.mtime);}
 else if(mode==='extra-artifact')fs.writeFileSync(dir+'/unbound.json','{}');
 else fs.writeFileSync(p,Buffer.concat([raw,Buffer.from('changed archive')]));
};
cp.spawnSync=function(...a){if(!['authorization-after-FENCED','observation-after-readback'].includes(mode))change();return native.apply(this,a)};
fs.renameSync=function(a,b){const r=rename.call(this,a,b);if(mode==='authorization-after-FENCED'&&String(b)===base+'/recovery-journal.json'&&JSON.parse(read(b)).events.at(-1).phase==='FENCED')change();return r};
fs.readFileSync=function(p,...a){const r=read.call(this,p,...a);if(mode==='observation-after-readback'&&String(p).endsWith('/producer-observation.json'))change();return r};
process.once('exit',()=>{if(held!==undefined)fs.closeSync(held)});syncBuiltinESMExports();`);
  const original=recoveryOriginalTree(f),r=f.preparationCLI(['--recover-preparation-capture'],{preloads:[hook]});assert.equal(r.status,1);
  assert.match(r.stderr,/recovery archive|ENOENT|symlink/);assert.doesNotMatch(r.stderr,/PREPARATION_RECOVERY_UNPROVEN/);
  // The fault only changes the new recovery archive. Original capture evidence
  // and both blocking owners survive; no repair or terminal is synthesized.
  if(mode==='authorization-symlink')fs.unlinkSync(join(base,'outside-archive'));
  assert.deepEqual(recoveryOriginalTree(f),original);assert.ok(fs.existsSync(join(base,'recovery.lock')));
  assert.equal(read(join(base,'journal.json')).events.at(-1).status,'RUNNING');
  assert.deepEqual(read(join(base,'recovery-journal.json')).events.map(e=>e.phase),['AUTHENTICATED','FENCED']);
  const after=tree(base);prepRefuse(f,()=>f.preparationCLI(['--recover-preparation-capture'],{readonly:true}),/recovery fenced/);assert.deepEqual(tree(base),after);
  saveHistoryEvidence(f,'recovery-archive-'+mode);
 });
});

test('preparation-recovery-fence-identity',async t=>{
 const {captureRecoveryPreflightFixture}=await import('./evidence-fixture.mjs');
 for(const mode of ['replace-during-first-read','rewrite-and-restore-mtime','replace-during-native'])await t.test(mode+' refuses without adopting the changed fence',async t=>{
  const f=recordHistoryCalls(await captureRecoveryPreflightFixture(t)),path=join(f.root,f.preparationBase,'writer.lock');
  fs.utimesSync(path,new Date(0),new Date(0));
  const original=fs.readFileSync(path),before=fs.statSync(path,{bigint:true}),hook=join(f.temporary,'fence-identity-race.mjs');
  // Fault injection changes only this isolated fence. Keep the old descriptor
  // open so a replacement cannot coincidentally reuse its inode. Preserve raw
  // bytes and mtime to distinguish object identity from content validation.
  put(hook,`import fs from 'node:fs';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const path=${JSON.stringify(path)},mode=${JSON.stringify(mode)},read=fs.readFileSync,native=cp.spawnSync;let changed=false,held;
const change=()=>{if(changed)return;changed=true;const raw=read(path),st=fs.statSync(path);held=fs.openSync(path,'r');
 if(mode==='rewrite-and-restore-mtime'){fs.writeFileSync(path,raw);fs.utimesSync(path,st.atime,st.mtime);}
 else {const next=path+'.replacement';fs.writeFileSync(next,raw);fs.utimesSync(next,st.atime,st.mtime);fs.renameSync(next,path);}
};
fs.readFileSync=function(p,...args){const raw=read.call(this,p,...args);if(String(p)===path&&mode!=='replace-during-native')change();return raw};
cp.spawnSync=function(...args){if(mode==='replace-during-native')change();return native.apply(this,args)};
process.once('exit',()=>{if(held!==undefined)fs.closeSync(held)});syncBuiltinESMExports();`);
  const r=f.preparationCLI(['--recover-preparation-capture'],{preloads:[hook]});
  assert.equal(r.status,1);assert.match(r.stderr,/recovery fence identity changed/);
  assert.doesNotMatch(r.stderr,/PREPARATION_RECOVERY_NOT_IMPLEMENTED/);
  const after=fs.statSync(path,{bigint:true});assert.deepEqual(fs.readFileSync(path),original);assert.equal(after.mtimeNs,before.mtimeNs);
  if(mode==='rewrite-and-restore-mtime'){assert.equal(after.ino,before.ino);assert.notEqual(after.ctimeNs,before.ctimeNs);}else assert.notEqual(after.ino,before.ino);
  assert.equal(read(join(f.root,f.preparationBase,'journal.json')).events.at(-1).status,'RUNNING');
  for(const name of ['attempts/1/failure.json','attempts/1/receipt.json'])assert.equal(fs.existsSync(join(f.root,f.preparationBase,name)),false);
  for(const name of ['recovery.lock','recovery-journal.json'])assert.equal(fs.existsSync(join(f.root,f.preparationBase,name)),mode==='replace-during-native');
  saveHistoryEvidence(f,'recovery-fence-'+mode);
 });
});

// A real capture descendant can escape its group, close all attempt handles,
// and later reopen an output. Empty native snapshots must never certify it.
test('preparation-recovery-latent-escaped-producer',async t=>{
 const {captureRecoveryPreflightFixture}=await import('./evidence-fixture.mjs');
 const control=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'enterprise-latent-producer-')));
 const ready=join(control,'ready.json'),command=join(control,'command'),done=join(control,'done.json');
 const waitFor=async(path)=>{const end=Date.now()+10000;while(!fs.existsSync(path)){assert.ok(Date.now()<end,'latent producer acknowledgement timeout');await new Promise(r=>setTimeout(r,20));}return read(path);};
 t.after(async()=>{try{put(command,'stop');if(fs.existsSync(ready))await waitFor(done);}finally{fs.rmSync(control,{recursive:true,force:true});}});
 const program=`const fs=require('node:fs');const target=process.argv[1],control=process.argv[2],started=Date.now();fs.writeFileSync(control+'/ready.json',JSON.stringify({pid:process.pid,parentPid:process.ppid,target}));const timer=setInterval(()=>{let action;try{action=fs.readFileSync(control+'/command','utf8')}catch{}if(action==='write'){fs.appendFileSync(target,'\\nlate isolated producer write\\n');fs.writeFileSync(control+'/done.json',JSON.stringify({pid:process.pid,parentPid:process.ppid,wrote:true}));clearInterval(timer);}else if(action==='stop'||Date.now()-started>60000){fs.writeFileSync(control+'/done.json',JSON.stringify({pid:process.pid,wrote:false}));clearInterval(timer);}},20);`;
 const suiteSource=`import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {spawn} from 'node:child_process';test('real arithmetic assertion',async()=>{const control=${JSON.stringify(control)},target=process.env.ENTERPRISE_SUITE_OUTPUT+'/latent-output.txt';fs.mkdirSync(process.env.ENTERPRISE_SUITE_OUTPUT,{recursive:true});fs.writeFileSync(target,'original isolated output');const child=spawn(process.execPath,['-e',${JSON.stringify(program)},target,control],{cwd:control,detached:true,stdio:'ignore'});child.unref();const end=Date.now()+10000;while(!fs.existsSync(control+'/ready.json')){assert.ok(Date.now()<end);await new Promise(r=>setTimeout(r,20));}assert.equal(6*7,42);});`;
 const f=recordHistoryCalls(await captureRecoveryPreflightFixture(t,{suiteSource})),id=await waitFor(ready),guard=recoveryWriteGuard(f);
 const original=recoveryOriginalTree(f),raw=fs.readFileSync(id.target),r=f.preparationCLI(['--recover-preparation-capture'],{preloads:[guard]});
 assert.equal(r.status,1,r.stderr);assert.match(r.stderr,/PREPARATION_RECOVERY_UNPROVEN/);assert.doesNotMatch(r.stderr,/FS_MUTATION/);
 assert.deepEqual(recoveryOriginalTree(f),original,'recovery did not change historical files');
 const value=JSON.parse(r.stderr.trim().split('\n').at(-1)).recovery,p=value.producerState;
 assert.equal(p.completeProducerCoverage,false);assert.equal(p.quiescenceProven,false);assert.equal(value.recoveryPerformed,false);assert.equal(p.exclusiveRecoveryAdmissionHeld,true);
 assert.ok(p.reasons.includes('COMPLETE_PRODUCER_COVERAGE_UNPROVEN'));assert.deepEqual(p.signalsSent,[]);
 for(const scan of p.scans){assert.equal(scan.censusAvailable,true);assert.equal(scan.handleInspectionSucceeded,true);assert.deepEqual(scan.openHandles,[]);assert.ok(!scan.processes.some(row=>row.pid===id.pid));}
 const censuses=p.commands.filter(c=>c.command==='/bin/ps');assert.equal(censuses.length,2);
 for(const census of censuses){const row=census.stdout.split('\n').find(line=>Number(line.trim().split(/\s+/)[0])===id.pid);assert.ok(row,'escaped producer present in native census');const fields=row.trim().split(/\s+/);assert.equal(Number(fields[2]),id.pid,'new detached group');assert.notEqual(Number(fields[1]),id.parentPid,'original parent terminated and descendant reparented');}
 assert.equal(fs.existsSync(done),false);assert.deepEqual(fs.readFileSync(id.target),raw);
 saveHistoryEvidence(f,'latent-producer-before-late-write');
 put(command,'write');const acknowledgement=await waitFor(done);assert.equal(acknowledgement.pid,id.pid);assert.equal(acknowledgement.wrote,true);
 assert.equal(fs.readFileSync(id.target,'utf8'),raw.toString()+'\nlate isolated producer write\n');
 assert.equal(read(join(f.root,f.preparationBase,'journal.json')).events.at(-1).status,'RUNNING');
 for(const name of ['writer.lock','recovery.lock','recovery-journal.json'])assert.ok(fs.existsSync(join(f.root,f.preparationBase,name)));
 prepRefuse(f,()=>f.preparationCLI(['--capture-component','P0'],{readonly:true}),/recovery fenced/);
 saveHistoryEvidence(f,'latent-producer-after-late-write');
 const stoppedBy=Date.now()+10000;let absent=false;while(!absent){try{process.kill(id.pid,0);}catch(e){assert.equal(e.code,'ESRCH');absent=true;}if(!absent){assert.ok(Date.now()<stoppedBy,'isolated descendant did not exit');await new Promise(r=>setTimeout(r,20));}}
 const output=process.env.ENTERPRISE_SUITE_OUTPUT;if(output)put(join(output,'latent-producer-observation.json'),{syntheticDesignReplies:true,realCaptureAndDescendant:true,nativeCommandsStubbed:false,originalCaptureExit:f.incompleteCaptureResult.status,recoveryExit:r.status,descendantAbsentObservedAt:new Date().toISOString(),producerIdentity:id,acknowledgement,observation:p,oldOutputSha256:hash(raw),newOutputSha256:hash(fs.readFileSync(id.target)),meaning:'Empty handles and selected process lists do not prove complete producer quiescence; this fixture does not describe actual attempt7.',productVerified:false});
});

// An approved prospective helper does not exist in the review manifest yet.
// These are authority tests only: the source text is never compiled or run,
// and the synthetic approval does not establish a native producer boundary.
test('preparation-containment-new-source-authority',async t=>{
 const {preparationComponentFixture}=await import('./evidence-fixture.mjs');
 const helper='scripts/enterprise/preparation-producer-linux.c';
 const definition=read(resolve('work/enterprise/plan.json')).preparationReview.acceptanceScope.producerContainmentDefinition;
 const make=async(t,mode)=>preparationComponentFixture(t,{scopeMutation:(s,p)=>{
  if(mode!=='unlisted')p.preparationEntry.permittedPaths.push(helper);
  if(mode==='deleted-permitted-input')p.preparationEntry.permittedPaths.push('tests/assertion.test.mjs');
  if(mode!=='legacy'){
   s.profileId='P0-source-provenance-v3';s.producerContainmentDefinition=structuredClone(definition);
   if(mode==='wrong-profile')s.profileId='P0-source-provenance-v2';
   if(mode==='wrong-definition-profile')s.producerContainmentDefinition.profileId='P0-source-provenance-v2';
   if(mode==='omitted-definition-path')s.producerContainmentDefinition.implementationPaths=s.producerContainmentDefinition.implementationPaths.filter(p=>p!==helper);
  }
 }});
 let sequence=0;
 const inspect=f=>{const argv=['--successor-preparation',f.reviewManifest],startedAt=new Date().toISOString(),r=f.preparationCLI(argv,{readonly:true});
  if(process.env.ENTERPRISE_SUITE_OUTPUT)put(join(process.env.ENTERPRISE_SUITE_OUTPUT,'new-source-authority',String(++sequence)+'.json'),{syntheticApproval:true,nativeAcceptance:false,argv,cwd:f.root,startedAt,finishedAt:new Date().toISOString(),status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});
  return r;};
 await t.test('explicit new helper is bound to current bytes without granting execution',async t=>{
  const f=await make(t);assert.equal(inspect(f).status,0);
  put(join(f.root,helper),'/* approved new source, not native proof */\n');
  const before=tree(f.temporary),r=inspect(f);assert.equal(r.status,0,r.stderr);assert.deepEqual(tree(f.temporary),before);
  const a=JSON.parse(r.stdout);assert.deepEqual(a.changedPaths,[helper]);
  const raw=fs.readFileSync(join(f.root,helper));assert.deepEqual(a.currentInputs.entries.find(e=>e.path===helper),{path:helper,sha256:hash(raw),bytes:raw.length});
  assert.equal(a.executionOriginProven,false);assert.equal(a.exclusiveWriterProven,false);assert.deepEqual(a.currentApprovals,[]);
  fs.appendFileSync(join(f.root,'scripts/enterprise/runtime-preparation.mjs'),'\n// permitted implementation change\n');
  const changed=inspect(f);assert.equal(changed.status,0,changed.stderr);assert.deepEqual(JSON.parse(changed.stdout).changedPaths,[helper,'scripts/enterprise/runtime-preparation.mjs']);
 });
 for(const mode of ['unlisted','omitted-definition-path','legacy','unlisted-sibling','deleted-reviewed-input','deleted-permitted-input','wrong-profile','wrong-definition-profile','symlink'])await t.test(mode,async t=>{
  const f=await make(t,mode),file=join(f.root,helper);
  put(file,'/* no execution authority */\n');
  if(mode==='unlisted-sibling')put(join(f.root,'scripts/enterprise/unreviewed-producer.c'),'/* unapproved */\n');
  if(mode==='deleted-reviewed-input')fs.unlinkSync(join(f.root,'src/domain.mjs'));
  if(mode==='deleted-permitted-input')fs.unlinkSync(join(f.root,'tests/assertion.test.mjs'));
  if(mode==='symlink'){fs.unlinkSync(file);fs.symlinkSync(join(f.root,'src/domain.mjs'),file);}
  const before=tree(f.temporary),r=inspect(f);assert.equal(r.status,1,r.stdout);assert.match(r.stderr,/successor input|unreviewed input|symlink|escape/);assert.ok(!r.stderr.includes('FS_MUTATION'),r.stderr);assert.deepEqual(tree(f.temporary),before);
 });
});

test('preparation-containment-definition-and-launch-refusal',async t=>{
 const {preparationComponentFixture}=await import('./evidence-fixture.mjs');
 const real=read(resolve('work/enterprise/plan.json'));
 const make=mutation=>preparationComponentFixture(t,{scopeMutation:(s,p)=>{
  const command=p.preparationReview.fullRegressionCommand;
  Object.assign(s,structuredClone(real.preparationReview.acceptanceScope));
  p.preparationReview.caseIds=structuredClone(real.preparationReview.caseIds);
  p.preparationReview.failureHistory.caseIds=[...s.failureHistoryCaseIds];
  p.issues[0].suites[0].requiredAssertions=[...s.fullObligations];
  p.failedIntervalRecovery.runtimeContinuation.delivery.workPackages=structuredClone(real.failedIntervalRecovery.runtimeContinuation.delivery.workPackages);
  p.preparationEntry.ordinaryGateOwnership=structuredClone(real.preparationEntry.ordinaryGateOwnership);
  p.preparationEntry.sealPublication.acceptanceCases=structuredClone(real.preparationEntry.sealPublication.acceptanceCases);
  Object.assign(s.sourceProvenanceDefinition,{sourceRunSlug:p.preparationEntry.sourceRunSlug,sourceCheckpoint:p.preparationEntry.sourceCheckpoint,fullRegressionCommand:command});
  s.captureRecoveryDefinition.fullRegressionCommand=command;s.producerContainmentDefinition.fullRegressionCommand=command;
  mutation?.(s,p);
 }});
 let sequence=0;
 const inspect=(f,args=['--capture-component','P0'])=>{
  const before=tree(f.temporary),r=f.preparationCLI(args,{readonly:true});
  assert.deepEqual(tree(f.temporary),before);assert.equal(r.status,1,r.stdout);assert.ok(!r.stderr.includes('FS_MUTATION'),r.stderr);
  if(process.env.ENTERPRISE_SUITE_OUTPUT)put(join(process.env.ENTERPRISE_SUITE_OUTPUT,'containment-definition',String(++sequence)+'.json'),{args,status:r.status,stdout:r.stdout,stderr:r.stderr,syntheticApproval:true,nativeAcceptance:false});
  return r;
 };
 await t.test('valid cumulative definition refuses before lock or workload',async()=>{
  const f=await make();
  for(const args of [['--capture-component','P0'],['--import-component-review','absent-report.md']]){
   const r=inspect(f,args);assert.match(r.stderr,/PREPARATION_PRODUCER_BACKEND_UNAUTHENTICATED/);assert.match(r.stderr,/mandatoryAssertions=303/);assert.match(r.stderr,/nativeProbePerformed=false/);
  }
  assert.equal(fs.existsSync(join(f.root,f.preparationBase,'writer.lock')),false);
  assert.equal(fs.existsSync(join(f.root,f.preparationBase,'attempts')),false);
  for(const args of [['--inspect-component-candidate'],['--inspect-component-review']])assert.match(inspect(f,args).stderr,/ENOENT/);
 });
 const cases=[
  ['missing definition',s=>delete s.producerContainmentDefinition,/containment definition/],
  ['wrong version',s=>s.producerContainmentDefinition.schemaVersion=2,/containment definition/],
  ['wrong profile',s=>s.producerContainmentDefinition.profileId='P0-source-provenance-v2',/containment profile/],
  ['missing PC',s=>s.producerContainmentCaseIds.pop(),/containment case/],
  ['duplicate PC',s=>s.producerContainmentDefinition.caseIds[7]='PC1',/containment case/],
  ['missing CR',s=>s.recoveryCaseIds.pop(),/recovery case/],
  ['missing consumer',s=>s.producerContainmentDefinition.validatorConsumers.pop(),/containment consumers/],
  ['different command',s=>s.producerContainmentDefinition.fullRegressionCommand=['node'],/containment command/],
  ['scan fallback',s=>s.producerContainmentDefinition.scanProofFallback=true,/containment scanProofFallback/],
  ['automatic provisioning',s=>s.producerContainmentDefinition.autoProvision=true,/containment autoProvision/],
  ['actual7 adoption',s=>s.producerContainmentDefinition.actual7Adoption=true,/containment actual7Adoption/],
  ['missing admission',s=>s.producerContainmentDefinition.durableAdmission=false,/containment durableAdmission/],
  ['missing native positive',s=>s.producerContainmentDefinition.realNativePositiveRequired=false,/containment realNativePositiveRequired/],
  ['caller backend claim',s=>s.producerContainmentDefinition.backendAvailability='AVAILABLE',/containment backendAvailability/],
  ['missing reviewed PC',s=>s.reviewedCaseIds.pop(),/preparation review case scope/],
  ['missing retained obligation',s=>s.retainedObligations.pop(),/preparation retained count/],
  ['missing cumulative control',s=>s.requiredControlAssertions.pop(),/containment cumulative mandatory/],
 ];
 for(const [name,mutation,pattern] of cases)await t.test(name,async()=>{const f=await make(mutation);const r=inspect(f);assert.match(r.stderr,pattern);assert.ok(!r.stderr.includes('PREPARATION_PRODUCER_BACKEND_UNAUTHENTICATED'),r.stderr);});
});

test('preparation-native-helper-readonly-preflight',async t=>{
 // This tests the executable diagnostic, NOT native containment/PC acceptance.
 // A compiler is required; absence is a failure, never SKIP or a mock binary.
 const source=resolve('scripts/enterprise/preparation-producer-linux.c');
 const compiler=process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc';
 const sourceBytes=fs.readFileSync(source),compilerReal=fs.realpathSync(compiler),compilerBytes=fs.readFileSync(compilerReal);
 const dir=fs.mkdtempSync(join(tmpdir(),'preparation-native-preflight-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const copied=join(dir,'helper.c'),binary=join(dir,'helper');fs.writeFileSync(copied,sourceBytes);
 const env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:dir};
 const version=spawnSync(compilerReal,['--version'],{env,encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
 const argv=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];
 let sdk=null;
 if(process.platform==='darwin'){
  const found=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{env,encoding:'utf8',timeout:30000});assert.equal(found.status,0,found.stderr);
  const path=fs.realpathSync(found.stdout.trim());assert.ok(path.startsWith('/Library/Developer/CommandLineTools/SDKs/'),'unexpected SDK location');
  sdk={path,settingsSha256:hash(fs.readFileSync(join(path,'SDKSettings.json')))};argv.push('-isysroot',path);
 }
 argv.push(copied,'-o',binary);
 const compiled=spawnSync(compilerReal,argv,{env,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
 assert.deepEqual(fs.readFileSync(compilerReal),compilerBytes,'compiler changed during compilation');assert.deepEqual(fs.readFileSync(source),sourceBytes);
 if(sdk)assert.equal(hash(fs.readFileSync(join(sdk.path,'SDKSettings.json'))),sdk.settingsSha256);
 const receipt={sourceSha256:hash(sourceBytes),compiler:{path:compilerReal,sha256:hash(compilerBytes),version:version.stdout,argv,sdk},binarySha256:hash(fs.readFileSync(binary)),platform:process.platform,architecture:process.arch,nativeAcceptance:false,invocations:[]};
 const invoke=(args,extra={})=>{
  const before=tree(dir),r=spawnSync(binary,args,{cwd:dir,env:{...env,...extra.env},input:extra.input,encoding:'utf8',timeout:5000,maxBuffer:65536});
  assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.deepEqual(tree(dir),before,'native diagnostic must not change files');
  receipt.invocations.push({args,status:r.status,stdout:r.stdout,stderr:r.stderr});return r;
 };
 await t.test('real compiled preflight never grants backend authority',()=>{
  const r=invoke(['--inspect-host']);assert.equal(r.status,78);const d=JSON.parse(r.stdout);
  assert.equal(d.schemaVersion,1);assert.equal(d.kind,'PREPARATION_NATIVE_PREFLIGHT');assert.equal(d.backendAuthenticated,false);assert.equal(d.workloadStarted,false);assert.equal(d.authority,'NONE');
  assert.equal(d.reason,process.platform==='linux'?'NATIVE_AUTHENTICATION_INCOMPLETE':'UNSUPPORTED_PLATFORM');
  assert.equal(d.nativeInterfaceObservationPerformed,process.platform==='linux');assert.equal(d.capabilityProbeComplete,false);
  assert.deepEqual(d.unverified,['PROTECTED_SUPERVISOR','AUTHORIZED_DOMAIN','NAMESPACE_POLICY','CREDENTIAL_FD_SYSCALL_POLICY','DURABLE_ADMISSION','NATIVE_LAUNCH_PROTOCOL']);
 });
 await t.test('caller claims in environment or stdin cannot authorize launch',()=>{
  const r=invoke(['--inspect-host'],{env:{PREPARATION_BACKEND:'AVAILABLE',PRODUCER_AUTHORITY:'true'},input:'{"backendAuthenticated":true,"command":["touch","forbidden"]}'});
  assert.equal(r.status,78);assert.equal(JSON.parse(r.stdout).backendAuthenticated,false);assert.equal(fs.existsSync(join(dir,'forbidden')),false);
 });
 for(const [name,args] of [['no operation',[]],['launch command',['--launch','/usr/bin/touch','forbidden']],['caller cgroup',['--inspect-host','--cgroup','/tmp/fake']],['extra argument',['--inspect-host','--inspect-host']],['public token',['--token','trusted']]])await t.test(name,()=>{
  const r=invoke(args);assert.equal(r.status,64);assert.equal(r.stdout,'');assert.match(r.stderr,/PREPARATION_NATIVE_ARGUMENT_REJECTED/);assert.equal(fs.existsSync(join(dir,'forbidden')),false);
 });
 if(process.env.ENTERPRISE_SUITE_OUTPUT){const out=join(process.env.ENTERPRISE_SUITE_OUTPUT,'native-preflight');fs.mkdirSync(out,{recursive:true});fs.copyFileSync(binary,join(out,'helper'));fs.copyFileSync(copied,join(out,'helper.c'));put(join(out,'execution.json'),receipt);}
});
