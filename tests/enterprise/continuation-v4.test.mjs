import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture,put,read,tree} from './evidence-fixture.mjs';
import {savePersonaSessions} from '../../node_modules/takt/dist/infra/config/project/sessionStore.js';
import {hash} from '../../scripts/enterprise/evidence.mjs';
const init=['batch','--initialize-run'];
const progress=f=>join(f.root,'work/enterprise/progress.json');
const success=r=>assert.equal(r.status,0,r.stderr);
async function setup(t){
 const f=await fixture(t,{multi:true,selection:true,seal:false});
 let p=read(progress(f));p.activeBatchId=null;put(progress(f),p);f.context('build-foundation',3);
 success(f.cli(['batch','--batch','B01'],{readonly:false}));
 const review=f.batchReport({iteration:4},{batchId:'B01',iteration:4});
 p=read(progress(f));delete p.approvals.B01;put(progress(f),p);
 f.context('build-foundation',5);const oldRun=f.nextRun();return {...f,oldRun,review};
}
test('unimported-review-archived-with-real-provenance',async t=>{
 const f=await setup(t),old=tree(f.oldRun.runRootAbs),before=fs.readFileSync(progress(f));
 success(f.cli(init,{readonly:false}));const p=read(progress(f)),m=read(join(f.root,p.history.manifest));
 assert.equal(m.unimported.attestation.runId,f.review.reviewed.id);assert.equal(m.unimported.attestation.iteration,4);
 assert.equal(m.unimported.historyOnly,true);assert.deepEqual(m.unimported.currentApprovals,[]);
 assert.deepEqual(fs.readFileSync(join(f.root,p.history.manifest,'../unimported-review.md')),fs.readFileSync(join(f.oldRun.reportsAbs,'enterprise-04-review.md')));
 assert.equal(m.unimported.reportSha256,hash(fs.readFileSync(join(f.oldRun.reportsAbs,'enterprise-04-review.md'))));
 assert.deepEqual(fs.readFileSync(join(f.root,p.history.manifest,'../progress.json')),before);assert.deepEqual(tree(f.oldRun.runRootAbs),old);
});
test('unimported-review-never-current-approval',async t=>{
 const f=await setup(t);success(f.cli(init,{readonly:false}));const p=read(progress(f));
 assert.deepEqual(p.approvals,{});assert.deepEqual(p.issues,{});assert.equal(p.activeBatchId,'B00');
 const before=fs.readFileSync(progress(f));const r=f.cli(['batch','--batch','B01'],{readonly:false});assert.notEqual(r.status,0);assert.match(r.stderr,/active batch swap/);assert.deepEqual(fs.readFileSync(progress(f)),before);
});
test('scope-change-archives-old-selection-without-relabel',async t=>{
 const f=await setup(t),p=read(progress(f)),selected=fs.readFileSync(join(f.root,p.entrySelection));
 const path=join(f.root,'work/enterprise/plan.json'),plan=read(path);plan.scopeRevision='new-synthetic-scope';put(path,plan);
 success(f.cli(init,{readonly:false}));const next=read(progress(f)),manifest=read(join(f.root,next.history.manifest));
 assert.equal(JSON.parse(read(join(f.root,next.entrySelection)).planText).scopeRevision,'new-synthetic-scope');
 assert.deepEqual(fs.readFileSync(join(f.root,next.history.manifest,'../files',p.entrySelection)),selected);
 assert.equal(manifest.unimported.attestation.runSlug,'fixture-run');
});
test('archive-missing-tampered-or-concurrent-report-rejected',async t=>{
 for(const mode of ['missing','tampered','receipt','concurrent']) await t.test(mode,async t=>{
  const f=await setup(t),path=join(f.oldRun.reportsAbs,'enterprise-04-review.md'),before=fs.readFileSync(progress(f));
  if(mode==='missing')fs.unlinkSync(path);
  if(mode==='tampered')fs.appendFileSync(path,'changed');
  if(mode==='receipt')fs.appendFileSync(join(f.root,`evidence/enterprise/runs/${f.review.reviewed.id}/receipt.json`),' ');
  let r;
  if(mode==='concurrent'){
   const injection=join(f.temporary,'concurrent.mjs');put(injection,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const original=fs.linkSync;fs.linkSync=function(a,b,...rest){const value=original.call(this,a,b,...rest);if(String(b).endsWith('/manifest.json'))fs.appendFileSync(${JSON.stringify(path)},'changed');return value};syncBuiltinESMExports();`);
   r=spawnSync(process.execPath,['--import',injection,join(f.root,'scripts/enterprise/verify.mjs'),...init],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000});
  }else {const beforeTree=tree(f.temporary);r=f.cli(init);assert.deepEqual(tree(f.temporary),beforeTree);}
  assert.notEqual(r.status,0);assert.match(r.stderr,/ENOENT|differs from orchestrator|receipt bytes|concurrent old canonical/);assert.deepEqual(fs.readFileSync(progress(f)),before);
 });
});
test('model-profile-evidence-not-self-asserted',async t=>{
 for(const mode of ['model','effort','session','phase']) await t.test(mode,async t=>{
  const f=await setup(t),logs=join(f.oldRun.logsAbs,'fixture.jsonl'),records=fs.readFileSync(logs,'utf8').trim().split('\n').map(JSON.parse);
  const start=records.find(r=>r.type==='step_start'&&r.iteration===4);
  if(mode==='model')start.model='gpt-6.1-sol';if(mode==='effort')start.providerOptions.codex.reasoningEffort='medium';
  if(mode==='session'){f.sessions[JSON.stringify(['enterprise-batch-reviewer','codex','gpt-6-astra'])]='builder-session';savePersonaSessions(f.root,f.sessions,'codex',f.paths.sessionsDirectory);}
  if(mode==='phase')records.splice(records.findIndex(r=>r.type==='phase_complete'&&r.iteration===4&&r.phase===1),1);
  put(logs,records.map(r=>JSON.stringify(r)).join('\n')+'\n');const before=tree(f.temporary),r=f.cli(init);
  assert.notEqual(r.status,0);assert.match(r.stderr,/routing|missing or incomplete|actual provider session/);assert.deepEqual(tree(f.temporary),before);
 });
});

// New-run history fixtures use real CLI receipts and independent TAKT phases.
const fence=(name,a)=>'```'+name+'\n'+JSON.stringify(a)+'\n```';
function historyPhases(f,step,iteration,raw){
 f.context(step,iteration);
 for(const phase of [1,2])f.append({type:'phase_complete',step,iteration,workflow:f.workflow.name,stack:f.stack(step),phase,status:'done',content:raw});
 f.append({type:'step_complete',step,iteration,workflow:f.workflow.name,stack:f.stack(step),status:'done'});
 put(join(f.run.reportsAbs,step==='review-foundation'?'enterprise-04-review.md':'enterprise-02-review.md'),raw+'\n');
}
function rejectHistory(f,ref,iteration){
 const c=read(join(f.root,ref.candidatePath)),m=c.members.at(-1),common={schemaVersion:1,verdict:'REQUEST_CHANGES',runSlug:f.run.slug,workflowRef:f.workflowRef,step:'review-foundation',iteration,sessionKey:'enterprise-batch-reviewer',providerSessionId:'reviewer-session',inputsDigest:c.inputs.digest,unresolvedFindings:['BF-38 synthetic open finding']};
 const legacy={...common,batchId:m.batchId,runId:m.runId,receiptHash:m.receiptHash,receiptSha256:m.receiptSha256,outputsDigest:m.outputsDigest,approvedIssueIds:[]};
 const a={...common,activeBatchId:c.activeBatchId,candidatePath:ref.candidatePath,candidateSha256:ref.candidateSha256,members:c.members.map(m=>({batchId:m.batchId,runId:m.runId,receiptHash:m.receiptHash,receiptSha256:m.receiptSha256,outputsDigest:m.outputsDigest,approvedIssueIds:[],issueEvidence:m.issues.map(i=>({issueId:i.id,decisions:i.acceptanceTests.map(ac=>({id:ac.id,verdict:'REQUEST_CHANGES',artifacts:[read(join(f.root,`evidence/enterprise/runs/${m.runId}/receipt.json`)).suites[0].stdout]}))}))}))};
 if(c.recovery)a.recovery={...(c.recovery.schemaVersion===2?{schemaVersion:2}:{}),rootId:c.recovery.rootId,attemptId:c.recovery.attemptId,headerSha256:c.recovery.headerSha256,resultPath:ref.resultPath,resultSha256:ref.resultSha256,...(c.recovery.schemaVersion===2?{authority:c.recovery.authority}:{parentRejectionReportSha256:c.recovery.parentRejectionReportSha256})};
 historyPhases(f,'review-foundation',iteration,fence('enterprise-batch-attestation',legacy)+'\n'+fence('enterprise-closure-attestation',a));return a;
}
async function createRejectedSetup(t,{failedTail=false}={}){
 const f=await fixture(t,{multi:true,selection:true,seal:false,recovery:true});let p=read(progress(f));p.activeBatchId=null;put(progress(f),p);f.context('build-foundation',3);success(f.cli(['batch','--batch','B01'],{readonly:false}));
 const q=spawnSync(process.execPath,['--input-type=module','-e',"import {currentContext} from './scripts/enterprise/context.mjs';console.log(JSON.stringify((await currentContext(process.cwd())).identity))"],{cwd:f.root,env:f.env,encoding:'utf8'});success(q);p=read(progress(f));p.runBinding=JSON.parse(q.stdout);put(progress(f),p);
 const original=read(join(f.root,p.entrySelection));rejectHistory(f,p.lastGate.closureCandidate,4);put(join(f.root,'work/enterprise/REJECTED_REGENERATION.md'),'synthetic recovery contract');
 const attempts=[];
 for(const [n,di,bi,ri] of [[1,5,6,7],[2,8,9,10]]){
  const path=join(f.root,'work/enterprise/plan.json'),plan=read(path);plan.issues[0].suites[0].timeoutMs=n*10000;if(failedTail)for(const i of plan.issues)for(const s of i.suites)if(s.id==='audit-preparation')s.timeoutMs=n*10000;if(failedTail&&n===2)plan.issues[0].suites.push({...plan.issues[0].suites[0],id:'second-real-suite'});put(path,plan);
  const a={schemaVersion:1,verdict:'APPROVE',runSlug:f.run.slug,workflowRef:f.workflowRef,step:'review-architecture',iteration:di,sessionKey:'enterprise-architecture-reviewer',providerSessionId:'designer-session',contractPath:'work/enterprise/REJECTED_REGENERATION.md',contractSha256:hash(fs.readFileSync(join(f.root,'work/enterprise/REJECTED_REGENERATION.md'))),planSha256:hash(fs.readFileSync(path)),permission:'EVIDENCE_REGENERATION_ONLY',unresolvedFindings:[]};
  historyPhases(f,'review-architecture',di,fence('enterprise-recovery-design-attestation',a));f.context('build-foundation',bi);const r=f.cli(['batch','--recover-rejected'],{readonly:false});success(r);const ref=JSON.parse(r.stdout.trim().split('\n').at(-1));attempts.push(ref);rejectHistory(f,ref,ri);
 }
 const failed=[];
 if(failedTail){
  for(const iteration of [11,12]){
   fs.appendFileSync(join(f.root,'tests/assertion.test.mjs'),`test('real failed tail ${iteration}',()=>assert.equal(1,2));\n`);
   f.context('build-foundation',iteration);const execution=f.cli(['batch','--recover-rejected'],{readonly:false});assert.notEqual(execution.status,0);
   const dir=`evidence/enterprise/recoveries/${attempts.at(-1).rootId}`,head=read(join(f.root,dir,'head.json')),result=read(join(f.root,head.result.path));
   assert.equal(result.status,'failed');assert.equal(result.exitCode,1);assert.equal(result.candidate,undefined);
   const run=read(join(f.root,result.receipts[0].path));assert.equal(run.status,'failed');assert.equal(run.suites.length,1);assert.equal(run.suites[0].exitCode,1);
   failed.push({...head,execution});
  }
 }
 const oldRecords=structuredClone(f.records),oldRun=f.nextRun();return {...f,oldRun,oldRecords,attempts,failed,original};
}
// These tests run sequentially. Build the real CLI history once, then restore
// every product/orchestrator file and in-memory record before each fault. Keep
// directories in place: TAKT authenticates the runs directory's inode.
let preparedHistory;
const historyCleanup=[];
after(()=>{for(const cleanup of historyCleanup)cleanup();});
function historyCheckpoint(f){
 const baseline=tree(f.temporary),known=new Set(baseline.map(e=>e.path));
 const files=new Map(baseline.filter(e=>fs.lstatSync(f.temporary+e.path).isFile()).map(e=>[e.path,fs.readFileSync(f.temporary+e.path)]));
 const links=new Map(baseline.filter(e=>fs.lstatSync(f.temporary+e.path).isSymbolicLink()).map(e=>[e.path,fs.readlinkSync(f.temporary+e.path)]));
 const records=structuredClone(f.records),sessions=structuredClone(f.sessions);
 const shape=entries=>entries.map(({mtime,...entry})=>entry);
 return ()=>{
  for(const e of tree(f.temporary).reverse())if(!known.has(e.path))fs.rmSync(f.temporary+e.path,{recursive:true,force:true});
  for(const e of baseline){
   const path=f.temporary+e.path;
   if(files.has(e.path)){
    if(!fs.existsSync(path)||!fs.lstatSync(path).isFile()||!fs.readFileSync(path).equals(files.get(e.path))){fs.rmSync(path,{recursive:true,force:true});fs.writeFileSync(path,files.get(e.path));}
    fs.chmodSync(path,e.mode&0o777);
   }else if(links.has(e.path)){
    if(!fs.existsSync(path)||!fs.lstatSync(path).isSymbolicLink()||fs.readlinkSync(path)!==links.get(e.path)){fs.rmSync(path,{recursive:true,force:true});fs.symlinkSync(links.get(e.path),path);}
   }else fs.mkdirSync(path,{recursive:true});
  }
  f.records.splice(0,f.records.length,...structuredClone(records));
  for(const key of Object.keys(f.sessions))delete f.sessions[key];Object.assign(f.sessions,structuredClone(sessions));
  assert.deepEqual(shape(tree(f.temporary)),shape(baseline),'fixture files restored before each condition');
  for(const [path,target]of links)assert.equal(fs.readlinkSync(f.temporary+path),target);
  assert.deepEqual(f.records,records);assert.deepEqual(f.sessions,sessions);
 };
}
async function rejectedSetup(t,options={}){
 if(options.failedTail)return createRejectedSetup(t,options);
 if(!preparedHistory){const f=await createRejectedSetup({after:cleanup=>historyCleanup.push(cleanup)});preparedHistory={f,restore:historyCheckpoint(f)};}
 preparedHistory.restore();return preparedHistory.f;
}
test('history fixture reset removes fault residue before independent CLI cases',async t=>{
 const f=await rejectedSetup(t),restore=historyCheckpoint(f),before=tree(f.temporary).map(({mtime,...e})=>e),inode=fs.statSync(f.paths.runsDirectory).ino;
 fs.appendFileSync(progress(f),'changed');fs.unlinkSync(join(f.oldRun.reportsAbs,'enterprise-04-review.md'));
 put(join(f.root,'evidence/enterprise/extra/fault.json'),'fault');f.records.push({type:'injected'});f.sessions.injected='wrong';
 fs.unlinkSync(join(f.root,'node_modules'));fs.symlinkSync(f.global,join(f.root,'node_modules'));
 restore();assert.deepEqual(tree(f.temporary).map(({mtime,...e})=>e),before);assert.equal(fs.statSync(f.paths.runsDirectory).ino,inode);
 success(f.cli(init,{readonly:false}));assert.deepEqual(read(progress(f)).approvals,{});restore();
});
function zeroHistory(f){const before=tree(f.temporary),r=f.cli(init);assert.notEqual(r.status,0,r.stdout);assert.doesNotMatch(r.stderr,/FS_MUTATION/);assert.deepEqual(tree(f.temporary),before);return r;}
function alterHistory(f,fn){const path=join(f.oldRun.logsAbs,'fixture.jsonl'),records=fs.readFileSync(path,'utf8').trim().split('\n').map(JSON.parse);fn(records);put(path,records.map(r=>JSON.stringify(r)).join('\n')+'\n');}
function historyInject(f,body){const path=join(f.temporary,'history-inject.mjs');put(path,"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';"+body+';syncBuiltinESMExports();');return spawnSync(process.execPath,['--import',path,join(f.root,'scripts/enterprise/verify.mjs'),...init],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000});}
test('bootstrap-latest-recovery-rejection-own-plan-and-receipts',async t=>{
 const f=await rejectedSetup(t),old=tree(f.oldRun.runRootAbs),runs=tree(join(f.root,'evidence/enterprise/runs')),selected=fs.readFileSync(join(f.root,read(progress(f)).entrySelection));
 const c=read(join(f.root,f.attempts.at(-1).candidatePath));assert.notEqual(c.planText,f.original.planText);assert.notEqual(c.members[0].runId,f.original.predecessors[0].runId);
 success(f.cli(init,{readonly:false}));const p=read(progress(f));assert.equal(p.activeBatchId,'B00');assert.equal(p.runBinding.runSlug,f.run.slug);assert.deepEqual(p.approvals,{});assert.deepEqual(p.issues,{});assert.deepEqual(tree(f.oldRun.runRootAbs),old);assert.deepEqual(tree(join(f.root,'evidence/enterprise/runs')),runs);assert.deepEqual(fs.readFileSync(join(f.root,read(join(f.root,p.history.manifest,'../progress.json')).entrySelection)),selected);
 assert.notEqual(f.cli(init).status,0);assert.notEqual(f.cli(['batch','--batch','B01']).status,0);
});
test('bootstrap-rejection-canonical-phases-and-chain-required',async t=>{
 for(const kind of ['canonical','phase','run','session','finding','artifact'])await t.test(kind,async t=>{
  const f=await rejectedSetup(t);
  if(kind==='canonical')fs.appendFileSync(join(f.oldRun.reportsAbs,'enterprise-04-review.md'),'forged');
  else alterHistory(f,rs=>{for(const r of rs.filter(r=>r.iteration===10&&r.type==='phase_complete')){if(kind==='phase'&&r.phase===2)continue;r.content=r.content.replace(kind==='run'?'fixture-run':kind==='session'?'reviewer-session':kind==='finding'?'["BF-38 synthetic open finding"]':kind==='artifact'?'"artifacts":["evidence/':'REQUEST_CHANGES',kind==='run'?'other-run':kind==='session'?'builder-session':kind==='finding'?'[]':kind==='artifact'?'"artifacts":["unknown/':'APPROVE');}if(kind!=='phase')put(join(f.oldRun.reportsAbs,'enterprise-04-review.md'),rs.findLast(r=>r.iteration===10&&r.phase===2).content+'\n');});
  zeroHistory(f);
 });
});
test('bootstrap-history-only-rejection-keeps-findings-and-empty-approvals',async t=>{
 const f=await rejectedSetup(t);success(f.cli(init,{readonly:false}));const p=read(progress(f)),m=read(join(f.root,p.history.manifest));assert.equal(m.unimported.historyOnly,true);assert.deepEqual(m.unimported.currentApprovals,[]);assert.equal(m.unimported.attestation.verdict,'REQUEST_CHANGES');assert.deepEqual(m.unimported.attestation.unresolvedFindings,['BF-38 synthetic open finding']);assert.deepEqual(m.unimported.attestation.approvedIssueIds,[]);assert.deepEqual(p.issues,{});assert.equal(p.rootId,undefined);
 f.context('final-audit',2);const before=tree(f.temporary);assert.notEqual(f.cli(['all']).status,0);assert.deepEqual(tree(f.temporary),before);
});
test('bootstrap-recovery-chain-gap-fork-or-tamper-zero-writes',async t=>{
 for(const kind of ['journal','fork','header','output','terminal'])await t.test(kind,async t=>{
  const f=await rejectedSetup(t),a=f.attempts[0],dir=join(f.root,`evidence/enterprise/recoveries/${a.rootId}`);
  if(kind==='journal')fs.unlinkSync(join(dir,'journal/000001.json'));
  if(kind==='fork'){const h=read(join(f.root,a.resultPath.replace('result.json','header.json')));h.attemptId='fork';put(join(dir,'attempts/fork/header.json'),h);}
  if(kind==='header')fs.appendFileSync(join(f.root,a.resultPath.replace('result.json','header.json')),' ');
  if(kind==='terminal')fs.unlinkSync(join(f.root,a.resultPath));
  if(kind==='output'){const c=read(join(f.root,a.candidatePath)),r=read(join(f.root,`evidence/enterprise/runs/${c.members[0].runId}/receipt.json`));fs.appendFileSync(join(f.root,r.suites[0].stdout),'changed');}zeroHistory(f);
 });
});
test('bootstrap-incomplete-or-concurrent-latest-review-zero-writes',async t=>{
 for(const kind of ['incomplete','new-start','report','input','index'])await t.test(kind,async t=>{
  const f=await rejectedSetup(t),before=fs.readFileSync(progress(f));
  if(kind==='incomplete'||kind==='new-start'){alterHistory(f,rs=>{if(kind==='incomplete')rs.splice(rs.findIndex(r=>r.iteration===10&&r.type==='step_complete'),1);else rs.push({...rs.find(r=>r.iteration===10&&r.type==='step_start'),iteration:11});});zeroHistory(f);return;}
  const target=kind==='report'?join(f.oldRun.reportsAbs,'enterprise-04-review.md'):join(f.root,kind==='input'?'src/domain.mjs':'evidence/enterprise/runs/index.json');
  const r=historyInject(f,`const link=fs.linkSync;fs.linkSync=function(a,b,...xs){const r=link.call(this,a,b,...xs);if(String(b).endsWith('/gate.lock'))fs.appendFileSync(${JSON.stringify(target)},' ');return r;}`);assert.notEqual(r.status,0);assert.deepEqual(fs.readFileSync(progress(f)),before);assert.equal(fs.existsSync(join(f.root,'evidence/enterprise/continuations')),false);
 });
});
test('bootstrap-archives-complete-recovery-provenance-before-projection',async t=>{
 for(const kind of ['complete','interrupted','conflict','late-output'])await t.test(kind,async t=>{
  const f=await rejectedSetup(t),before=fs.readFileSync(progress(f));
  if(kind==='interrupted'||kind==='conflict'){const r=historyInject(f,"const link=fs.linkSync;fs.linkSync=function(a,b,...xs){const r=link.call(this,a,b,...xs);if(String(b).endsWith('/manifest.json'))process.kill(process.pid,'SIGKILL');return r;}");assert.equal(r.signal,'SIGKILL');assert.deepEqual(fs.readFileSync(progress(f)),before);
   if(kind==='conflict'){const d=fs.readdirSync(join(f.root,'evidence/enterprise/continuations'))[0];fs.appendFileSync(join(f.root,'evidence/enterprise/continuations',d,'manifest.json'),' ');assert.notEqual(f.cli(init,{readonly:false}).status,0);assert.deepEqual(fs.readFileSync(progress(f)),before);return;}}
  if(kind==='late-output'){const c=read(join(f.root,f.attempts.at(-1).candidatePath)),r=read(join(f.root,`evidence/enterprise/runs/${c.members[0].runId}/receipt.json`)),target=join(f.root,r.suites[0].stdout);const result=historyInject(f,`const link=fs.linkSync;fs.linkSync=function(a,b,...xs){const r=link.call(this,a,b,...xs);if(String(b).endsWith('/manifest.json'))fs.appendFileSync(${JSON.stringify(target)},'changed');return r;}`);assert.notEqual(result.status,0);assert.deepEqual(fs.readFileSync(progress(f)),before);return;}
  success(f.cli(init,{readonly:false}));const p=read(progress(f)),m=read(join(f.root,p.history.manifest)),archive=join(f.root,p.history.manifest,'..');
  for(const e of m.files.entries)assert.equal(hash(fs.readFileSync(join(archive,'files',e.path))),e.sha256);
  for(const a of f.attempts)for(const path of [a.candidatePath,a.resultPath,a.resultPath.replace('result.json','header.json'),a.resultPath.replace('result.json','published.json')])assert.ok(m.files.entries.some(e=>e.path===path),path);
  assert.ok(m.files.entries.some(e=>e.path.endsWith('/journal/000001.json')));assert.deepEqual(fs.readFileSync(join(archive,'progress.json')),before);
 });
});
test('bootstrap-old-approve-format-remains-strict',async t=>{
 const f=await setup(t);success(f.cli(init,{readonly:false}));assert.equal(read(join(f.root,read(progress(f)).history.manifest)).unimported.attestation.verdict,'APPROVE');
 const g=await setup(t);alterHistory(g,rs=>{for(const r of rs.filter(r=>r.iteration===4&&r.type==='phase_complete'))r.content=r.content.replace('"verdict": "APPROVE"','"verdict": "REQUEST_CHANGES"');put(join(g.oldRun.reportsAbs,'enterprise-04-review.md'),rs.findLast(r=>r.iteration===4&&r.phase===2).content+'\n');});zeroHistory(g);
});

test('BF-39 selection checkpoint bytes required before initial and resumed projection',async t=>{
 const f=await rejectedSetup(t),before=fs.readFileSync(progress(f)),old=tree(f.oldRun.runRootAbs),runs=tree(join(f.root,'evidence/enterprise/runs'));
 // Each condition starts from the same authenticated immutable old history.
 // Reset only this fixture's new projection/checkpoint, never old evidence.
 for(const mode of ['complete','resume','initial-change','initial-missing','resume-change','resume-missing','checkpoint-change','checkpoint-missing'])await t.test(mode,async t=>{
  assert.equal(fs.existsSync(join(f.root,'evidence/enterprise/gate.lock')),false);
  fs.writeFileSync(progress(f),before);fs.rmSync(join(f.root,'evidence/enterprise/continuations'),{recursive:true,force:true});
  assert.deepEqual(fs.readFileSync(progress(f)),before);assert.deepEqual(tree(f.oldRun.runRootAbs),old);assert.deepEqual(tree(join(f.root,'evidence/enterprise/runs')),runs);
  const resumed=mode.startsWith('resume')||mode.startsWith('checkpoint');
  if(resumed){const interrupted=historyInject(f,"const link=fs.linkSync;fs.linkSync=function(a,b,...xs){const r=link.call(this,a,b,...xs);if(String(b).endsWith('/manifest.json'))process.kill(process.pid,'SIGKILL');return r;}");assert.equal(interrupted.signal,'SIGKILL');assert.deepEqual(fs.readFileSync(progress(f)),before);}
  const archive=join(f.root,'evidence/enterprise/continuations',`${f.run.slug}-${hash(before)}`),selection=join(archive,'selection.json');
  const missing=mode.endsWith('missing'),fault=missing?'fs.unlinkSync(target)':'fs.appendFileSync(target," ")';
  if(mode.startsWith('checkpoint')){const target=selection;if(missing)fs.unlinkSync(target);else fs.appendFileSync(target,' ');}
  let result;
  if(mode.startsWith('initial'))result=historyInject(f,`const link=fs.linkSync;fs.linkSync=function(a,b,...xs){const r=link.call(this,a,b,...xs);if(String(b).endsWith('/manifest.json')){const target=${JSON.stringify(selection)};${fault};}return r;}`);
  else if(mode.startsWith('resume-'))result=historyInject(f,`let once=false;const read=fs.readFileSync;fs.readFileSync=function(p,...xs){if(!once&&String(p)===${JSON.stringify(join(archive,'manifest.json'))}){once=true;const target=${JSON.stringify(selection)};${fault};}return read.call(this,p,...xs);}`);
  else result=f.cli(init,{readonly:false});
  const actual=fs.existsSync(selection)?fs.readFileSync(selection):null,after=fs.readFileSync(progress(f)),p=JSON.parse(after),manifest=read(join(archive,'manifest.json'));
  if(process.env.ENTERPRISE_SUITE_OUTPUT)put(join(process.env.ENTERPRISE_SUITE_OUTPUT,`BF-39-${mode}.json`),{mode,status:result.status,signal:result.signal,stdout:result.stdout,stderr:result.stderr,oldProgressSha256:hash(before),newProgressSha256:hash(after),progressUnchanged:before.equals(after),selectionBytes:actual?.toString()??null,selectionSha256:actual?hash(actual):null,entrySelectionHash:p.entrySelectionHash,manifestSelectionHash:manifest.selectionSha256,newRunCommitted:p.runBinding?.runSlug===f.run.slug});
  assert.deepEqual(tree(f.oldRun.runRootAbs),old);assert.deepEqual(tree(join(f.root,'evidence/enterprise/runs')),runs);
  if(mode==='complete'||mode==='resume'){
   success(result);assert.equal(p.runBinding.runSlug,f.run.slug);assert.equal(hash(actual),p.entrySelectionHash);assert.equal(hash(actual),manifest.selectionSha256);assert.deepEqual(p.approvals,{});assert.deepEqual(p.issues,{});
  }else{
   assert.notEqual(result.status,0,'BF-39 mutated selection must reject before projection');assert.match(result.stderr,/selection checkpoint|initialization checkpoint|ENOENT/);assert.deepEqual(after,before,'BF-39 old projection retained');
   if(missing)assert.equal(actual,null,'missing checkpoint must not be recreated');else assert.notEqual(hash(actual),manifest.selectionSha256,'changed checkpoint must not be overwritten');
  }
 });
});

// One immutable authenticated history is shared; every condition restores its
// own initial projection and fault targets before exercising the real CLI.
test('failed-tail initializer executable acceptance',async t=>{
 const f=await rejectedSetup(t,{failedTail:true}),baseline=tree(f.temporary),saved=new Map(baseline.filter(e=>e.bytes).map(e=>[e.path,fs.readFileSync(f.temporary+e.path)])),records=structuredClone(f.records),before=fs.readFileSync(progress(f));
 const root=`evidence/enterprise/recoveries/${f.attempts.at(-1).rootId}`,last=f.failed.at(-1),first=f.failed[0],report=join(f.oldRun.reportsAbs,'enterprise-04-review.md'),results=[];
 const restore=()=>{const known=new Set(baseline.map(e=>e.path));for(const e of tree(f.temporary).reverse())if(!known.has(e.path))fs.rmSync(f.temporary+e.path,{recursive:true,force:true});for(const [p,b] of saved)if(!fs.existsSync(f.temporary+p)||!fs.readFileSync(f.temporary+p).equals(b))put(f.temporary+p,b.toString());f.records.splice(0,f.records.length,...structuredClone(records));};
 const record=(name,r)=>{results.push({name,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr,progressUnchanged:fs.readFileSync(progress(f)).equals(before)});if(process.env.ENTERPRISE_SUITE_OUTPUT)put(join(process.env.ENTERPRISE_SUITE_OUTPUT,'failed-tail-cli.json'),{failedExecutions:f.failed.map(x=>x.execution),results});};
 const reject=(name,mutate)=>{restore();mutate();const r=zeroHistory(f);record(name,r);};
 const target=(a,name)=>join(f.root,a.header.path.replace('header.json',name));
 await t.test('bootstrap-rejected-reviewed-attempt-with-failed-tail-history-only',()=>{
  restore();const old=tree(f.oldRun.runRootAbs),runs=tree(join(f.root,'evidence/enterprise/runs')),r=f.cli(init,{readonly:false});record('complete',r);success(r);
  const p=read(progress(f)),m=read(join(f.root,p.history.manifest)),h=m.unimported.recovery;
  assert.equal(h.reviewedAttempt.attemptId,f.attempts.at(-1).attemptId);assert.deepEqual(h.failedTail.map(x=>x.attemptId),f.failed.map(x=>read(join(f.root,x.header.path)).attemptId));assert.equal(h.latest.verdict,'REQUEST_CHANGES');assert.deepEqual(h.currentApprovals,[]);assert.equal(h.historyOnly,true);
  assert.equal(p.activeBatchId,'B00');assert.deepEqual(p.approvals,{});assert.deepEqual(p.issues,{});assert.equal(p.rootId,undefined);assert.deepEqual(tree(f.oldRun.runRootAbs),old);assert.deepEqual(tree(join(f.root,'evidence/enterprise/runs')),runs);
 });
 await t.test('bootstrap-failed-tail-each-header-parent-index-and-output-bound',()=>{
  for(const a of f.failed)for(const kind of ['header','parent','builder','design','inputs','suite','index','stdout','stderr','artifact','receipt'])reject(kind,()=>{
   const h=read(join(f.root,a.header.path)),r=read(target(a,'result.json')),rp=join(f.root,r.receipts[0].path),run=read(rp),s=run.suites[0];
   if(['header','parent','builder','design','inputs','suite','index'].includes(kind)){if(kind==='parent')(h.schemaVersion===2?h.authority.review:h.parent).reportSha256='0'.repeat(64);if(kind==='builder')h.builder.session='reviewer-session';if(kind==='design')h.design.index=0;if(kind==='inputs')h.inputs.digest='0'.repeat(64);if(kind==='suite')h.suites[0].suites[0].command=['false'];if(kind==='index')h.indexPrefix.pop();put(join(f.root,a.header.path),h);if(kind==='header')fs.appendFileSync(join(f.root,a.header.path),' ');}
   else if(kind==='receipt'){run.status='running';put(rp,run);}
   else {const path=kind==='artifact'?s.outputs.entries.find(e=>e.path.endsWith('actual.json')).path:s[kind];fs.appendFileSync(join(f.root,path),'changed');}
  });
 });
 await t.test('bootstrap-running-or-unterminated-tail-zero-writes',()=>{
  for(const kind of ['result','published','journal','head','running','live-writer','unknown-writer'])reject(kind,()=>{
   if(kind==='result'||kind==='published')fs.unlinkSync(target(last,kind+'.json'));
   if(kind==='journal')fs.unlinkSync(join(f.root,root,`journal/${String(last.sequence).padStart(6,'0')}.json`));
   if(kind==='head')fs.unlinkSync(join(f.root,root,'head.json'));
   if(kind==='running'){const p=target(last,'result.json'),r=read(p);r.status='running';put(p,r);}
   if(kind==='live-writer')put(join(f.root,'evidence/enterprise/gate.lock'),{kind:'enterprise-run-initialization',runSlug:f.run.slug,pid:process.pid});
   if(kind==='unknown-writer')put(join(f.root,'evidence/enterprise/gate.lock'),'unknown');
  });
 });
 await t.test('bootstrap-failed-tail-gap-fork-or-candidate-zero-writes',()=>{
  for(const kind of ['gap','fork','candidate','previous'])reject(kind,()=>{
   if(kind==='gap')fs.unlinkSync(join(f.root,root,`journal/${String(first.sequence).padStart(6,'0')}.json`));
   if(kind==='fork'){const h=read(join(f.root,last.header.path));h.attemptId='fork';put(join(f.root,root,'attempts/fork/header.json'),h);}
   if(kind==='candidate'){const p=target(last,'result.json'),r=read(p);r.candidate=f.attempts.at(-1);put(p,r);}
   if(kind==='previous'){const h=read(join(f.root,last.header.path));h.previous=first.header;put(join(f.root,last.header.path),h);}
  });
 });
 await t.test('bootstrap-later-review-or-concurrent-tail-zero-writes',()=>{
  for(const kind of ['later-review','unknown-review','incomplete-review'])reject(kind,()=>alterHistory(f,rs=>{if(kind==='incomplete-review')rs.splice(rs.findIndex(r=>r.iteration===10&&r.type==='step_complete'),1);else rs.push({...rs.find(r=>r.iteration===10&&r.type==='step_start'),iteration:13,...(kind==='unknown-review'?{model:'unknown'}:{})});}));
  for(const stage of ['gate.lock','manifest.json'])for(const kind of ['result','index','report','new-tail']){
   restore();const path=kind==='result'?target(last,'result.json'):kind==='index'?join(f.root,'evidence/enterprise/runs/index.json'):report;
   const effect=kind==='new-tail'?`fs.mkdirSync(${JSON.stringify(join(f.root,root,'attempts/concurrent'))});fs.copyFileSync(${JSON.stringify(join(f.root,last.header.path))},${JSON.stringify(join(f.root,root,'attempts/concurrent/header.json'))})`:`fs.appendFileSync(${JSON.stringify(path)},' ')`;
   const r=historyInject(f,`const link=fs.linkSync;fs.linkSync=function(a,b,...xs){const r=link.call(this,a,b,...xs);if(String(b).endsWith('/${stage}')){${effect};}return r;}`);record('concurrent-'+stage+'-'+kind,r);assert.notEqual(r.status,0);assert.deepEqual(fs.readFileSync(progress(f)),before);
  }
 });
 await t.test('bootstrap-failed-tail-durable-archive-and-resume',()=>{
  for(const kind of ['resume','archive-tamper','selection-missing','archive-write-failure']){
   restore();const interrupted=historyInject(f,kind==='archive-write-failure'?"const link=fs.linkSync;fs.linkSync=function(a,b,...xs){if(String(b).endsWith('/manifest.json'))throw Error('injected archive failure');return link.call(this,a,b,...xs);}":"const link=fs.linkSync;fs.linkSync=function(a,b,...xs){const r=link.call(this,a,b,...xs);if(String(b).endsWith('/manifest.json'))process.kill(process.pid,'SIGKILL');return r;}");record(kind+'-interrupted',interrupted);assert.deepEqual(fs.readFileSync(progress(f)),before);if(kind==='archive-write-failure'){assert.notEqual(interrupted.status,0);continue;}assert.equal(interrupted.signal,'SIGKILL');
   const archive=join(f.root,'evidence/enterprise/continuations',`${f.run.slug}-${hash(before)}`),m=read(join(archive,'manifest.json'));
   for(const e of m.files.entries)assert.equal(hash(fs.readFileSync(join(archive,'files',e.path))),e.sha256);
   for(const e of m.unimported.recovery.outputs.entries)assert.ok(m.files.entries.some(x=>x.path===e.path&&x.sha256===e.sha256));
   for(const a of f.failed)for(const name of ['header.json','result.json','published.json'])assert.ok(m.files.entries.some(e=>e.path===a.header.path.replace('header.json',name)));
   if(kind==='archive-tamper')fs.appendFileSync(join(archive,'files',last.result.path),'changed');if(kind==='selection-missing')fs.unlinkSync(join(archive,'selection.json'));
   const r=f.cli(init,{readonly:false});record(kind+'-resumed',r);if(kind==='resume'){success(r);const p=read(progress(f));assert.equal(hash(fs.readFileSync(join(f.root,p.entrySelection))),p.entrySelectionHash);assert.deepEqual(p.approvals,{});}else {assert.notEqual(r.status,0);assert.deepEqual(fs.readFileSync(progress(f)),before);}
  }
 });
 await t.test('bootstrap-failed-tail-no-old-approval-selection-or-seal-authority',()=>{
  restore();success(f.cli(init,{readonly:false}));
  for(const args of [init,['batch','--recover-rejected'],['batch','--import-closure']]){const before=tree(f.temporary),r=f.cli(args);record(args.join(' '),r);assert.notEqual(r.status,0);assert.doesNotMatch(r.stderr,/FS_MUTATION/);assert.deepEqual(tree(f.temporary),before);}
  // Ordinary writer commands acquire/release their existing lock before
  // rejecting; preserve file bytes/mtime and all projection/evidence records.
  {const before=tree(f.temporary).filter(e=>e.bytes),r=f.cli(['batch','--batch','B01'],{readonly:false});record('select-B01',r);assert.notEqual(r.status,0);assert.match(r.stderr,/active batch swap/);assert.deepEqual(tree(f.temporary).filter(e=>e.bytes),before);}
  // Sealing executes real fresh machine evidence before checking approvals.
  // Remove only this fixture's injected failing test cases so that the denial
  // proves the missing independent authority, not a machine-test failure.
  const path=join(f.root,'tests/assertion.test.mjs');put(path,fs.readFileSync(path,'utf8').replace(/^test\('real failed tail .*$/gm,''));
  const old=tree(f.oldRun.runRootAbs),rootBefore=tree(join(f.root,root));f.context('harden-release',2);
  const seal=f.cli(['all'],{readonly:false});record('seal-no-approval',seal);assert.notEqual(seal.status,0);assert.match(seal.stderr,/independent batch approval required/);assert.deepEqual(read(progress(f)).approvals,{});assert.ok(Object.values(read(progress(f)).issues).every(i=>i.status!=='VERIFIED'));assert.deepEqual(tree(f.oldRun.runRootAbs),old);assert.deepEqual(tree(join(f.root,root)),rootBefore);
  const release=read(join(f.root,'evidence/enterprise/releases/index.json'));assert.equal(release.attempts.at(-1).status,'failed');assert.ok(release.attempts.every(a=>!a.sealPath));
  f.context('final-audit',3);const finalBefore=tree(f.temporary),final=f.cli(['all']);record('readonly-final',final);assert.notEqual(final.status,0);assert.match(final.stderr,/latest release failed or running/);assert.deepEqual(tree(f.temporary),finalBefore);
 });
});

// Three source snapshots, two real missing-assertion failures and twelve real
// receipts in one selecting occurrence. Older completed recovery is retained.
async function ordinaryHistoryFixture(t){
 const f=await fixture(t,{multi:true,selection:true,seal:false,recovery:true}),path=p=>join(f.root,p);
 const pp='work/enterprise/plan.json',bp='work/enterprise/backlog.json',p=read(path(pp)),b=read(path(bp));
 const template=p.issues.find(i=>i.id==='ENT-101'),bt=b.items.find(i=>i.id==='ENT-101');
 const batches=Array.from({length:6},(_,n)=>({id:'B0'+n,issueIds:['ENT-'+(101+n)],stage:'build-foundation',reviewStage:'review-foundation',dependsOnBatches:n?['B0'+(n-1)]:[]}));
 p.batches=batches;p.issues=batches.map((batch,n)=>({...structuredClone(template),id:batch.issueIds[0],batchId:batch.id,acceptanceTests:template.acceptanceTests.map(ac=>({...ac,id:batch.issueIds[0]+'/AC-01'}))}));
 const parent={...b.items.find(i=>i.id==='ENT-700'),children:p.issues.map(i=>i.id)};b.items=[...p.issues.map(i=>({...bt,id:i.id})),parent];p.issues.push({...parent,originalAcceptance:parent.acceptance,sourceSpec:template.sourceSpec,sourceSpecSha256:template.sourceSpecSha256,acceptanceTests:[{id:'ENT-700/AC-01'}],suites:[]});
 const testPath='tests/ordinary.test.mjs',old="import test from 'node:test';import assert from 'node:assert/strict';test('wrong name',()=>assert.equal(4*3,12));\n",addition="test('still wrong name',()=>assert.equal(3*4,12));\n",good=old+"test('ordinary required assertion',()=>assert.equal(4*3,12));\n";
 p.issues.find(i=>i.batchId==='B04').suites=[{id:'ordinary-proof',path:testPath,command:[process.execPath,'--test','--test-reporter=tap',testPath],requiredAssertions:['ordinary required assertion']}];
 put(path(pp),p);put(path(bp),b);put(path(testPath),old);put(path('work/enterprise/REJECTED_REGENERATION.md'),'synthetic recovery contract');put(path('work/enterprise/RUN_ENTRY_HISTORY.md'),'synthetic initializer-only history contract');
 const designAt=(iteration)=>{const att={schemaVersion:1,verdict:'APPROVE',runSlug:f.run.slug,workflowRef:f.workflowRef,step:'review-architecture',iteration,sessionKey:'enterprise-architecture-reviewer',providerSessionId:'designer-session',contractPath:'work/enterprise/REJECTED_REGENERATION.md',contractSha256:hash(fs.readFileSync(path('work/enterprise/REJECTED_REGENERATION.md'))),planSha256:hash(fs.readFileSync(path(pp))),permission:'EVIDENCE_REGENERATION_ONLY',unresolvedFindings:[]};historyPhases(f,'review-architecture',iteration,'work/enterprise/RUN_ENTRY_HISTORY.md '+hash(fs.readFileSync(path('work/enterprise/RUN_ENTRY_HISTORY.md')))+'\n'+fence('enterprise-recovery-design-attestation',att));};
 const publish=(ref,iteration,verdict='REQUEST_CHANGES')=>{
  const c=read(path(ref.candidatePath)),last=c.members.at(-1),common={schemaVersion:1,verdict,runSlug:f.run.slug,workflowRef:f.workflowRef,step:'review-foundation',iteration,sessionKey:'enterprise-batch-reviewer',providerSessionId:'reviewer-session',inputsDigest:c.inputs.digest,unresolvedFindings:verdict==='APPROVE'?[]:['synthetic BF-61']};
  const members=c.members.map(m=>({batchId:m.batchId,runId:m.runId,receiptHash:m.receiptHash,receiptSha256:m.receiptSha256,outputsDigest:m.outputsDigest,approvedIssueIds:verdict==='APPROVE'?m.issueIds:[],issueEvidence:m.issues.map(i=>({issueId:i.id,decisions:i.acceptanceTests.map(ac=>({id:ac.id,verdict,artifacts:[read(path(`evidence/enterprise/runs/${m.runId}/receipt.json`)).suites[0].stdout]}))}))}));
  const att={...common,activeBatchId:c.activeBatchId,...ref,members};
  if(c.recovery){const r=c.recovery;att.recovery={...(r.schemaVersion===2?{schemaVersion:2}:{}),rootId:r.rootId,attemptId:r.attemptId,headerSha256:r.headerSha256,resultPath:ref.resultPath,resultSha256:ref.resultSha256,...(r.schemaVersion===2?{authority:r.authority}:{parentRejectionReportSha256:r.parentRejectionReportSha256})};}
  historyPhases(f,'review-foundation',iteration,fence('enterprise-batch-attestation',{...common,batchId:last.batchId,runId:last.runId,receiptHash:last.receiptHash,receiptSha256:last.receiptSha256,outputsDigest:last.outputsDigest,approvedIssueIds:verdict==='APPROVE'?last.issueIds:[]})+'\n'+fence('enterprise-closure-attestation',att));
 };
 const cli=args=>{const r=f.cli(args,{readonly:false});success(r);return JSON.parse(r.stdout.trim().split('\n').at(-1));};
 const clearActive=()=>{const p=read(progress(f));p.activeBatchId=null;put(progress(f),p);};
 for(let n=0;n<3;n++){if(n)clearActive();f.context('build-foundation',3+2*n);cli(['batch','--batch','B0'+n]);if(n===0)f.batchReport({iteration:4},{batchId:'B00',iteration:4});else{publish(read(progress(f)).lastGate.closureCandidate,4+2*n,'APPROVE');f.context('build-foundation',5+2*n);cli(['batch','--import-closure']);}}
 clearActive();f.context('build-foundation',9);cli(['batch','--batch','B03']);
 const q=spawnSync(process.execPath,['--input-type=module','-e',"import {currentContext} from './scripts/enterprise/context.mjs';console.log(JSON.stringify((await currentContext(process.cwd())).identity))"],{cwd:f.root,env:f.env,encoding:'utf8'});success(q);let pr=read(progress(f));pr.runBinding=JSON.parse(q.stdout);put(progress(f),pr);
 publish(pr.lastGate.closureCandidate,10);designAt(11);f.context('build-foundation',12);const recovered=cli(['batch','--recover-rejected']);publish(recovered,13,'APPROVE');f.context('build-foundation',15);cli(['batch','--import-closure']);
 const indexPath='evidence/enterprise/runs/index.json',boundary=read(path(indexPath)).runs.length;
 let r=f.cli(['batch','--batch','B04'],{readonly:false});assert.notEqual(r.status,0);assert.match(r.stderr,/missing assertion/);
 const ev='evidence/enterprise/ordinary-history',entries=()=>read(path(indexPath)).runs.slice(boundary),manifest=()=>read(path(entries().at(-1).path)).inputs;
 put(path(ev+'/old-inputs.json'),manifest());put(path(ev+'/before-ordinary.test.mjs'),old);
 put(path(testPath),old+addition);put(path(ev+'/addition.txt'),addition);
 r=f.cli(['batch'],{readonly:false});assert.notEqual(r.status,0);assert.match(r.stderr,/missing assertion/);put(path(ev+'/middle-inputs.json'),manifest());
 put(path(testPath),good);cli(['batch']);put(path(ev+'/final-inputs.json'),manifest());put(path(ev+'/final-source.mjs'),good);
 const reported=read(progress(f)).lastGate.closureCandidate;
 const refs=['old-inputs.json','middle-inputs.json','final-inputs.json','before-ordinary.test.mjs','addition.txt','final-source.mjs'].map(n=>({path:ev+'/'+n,sha256:hash(fs.readFileSync(path(ev+'/'+n)))}));
 const handoff={run:f.run.slug,iteration:15,builderSession:'builder-session',inputsDigest:manifest().digest,candidate:reported,references:refs};put(path(ev+'/handoff.json'),handoff);
 const content=reported.candidatePath+'\n'+entries().map(e=>e.id).join('\n')+'\n'+ev+'/handoff.json '+hash(fs.readFileSync(path(ev+'/handoff.json')));
 for(const phase of [1,2])f.append({type:'phase_complete',step:'build-foundation',iteration:15,workflow:f.workflow.name,stack:f.stack('build-foundation'),phase,phaseExecutionId:'ordinary-builder:15:'+phase,timestamp:new Date().toISOString(),status:'done',content});
 f.append({type:'step_complete',step:'build-foundation',iteration:15,workflow:f.workflow.name,stack:f.stack('build-foundation'),status:'done',timestamp:new Date().toISOString(),content});
 const {loadWorkflowExecutionBundle}=await import('../../node_modules/takt/dist/features/tasks/execute/workflowExecutionBundle.js'),{runCommandQualityGate}=await import('../../node_modules/takt/dist/core/workflow/quality-gates/commandGateRunner.js');
 const gate=await runCommandQualityGate({projectRoot:f.root,gate:loadWorkflowExecutionBundle(f.run).rootWorkflow.steps.find(s=>s.name==='build-foundation').qualityGates[0]});assert.equal(gate.ok,true,JSON.stringify(gate));
 const latest=read(progress(f)).lastGate.closureCandidate;publish(latest,16);const interval=entries();assert.equal(interval.length,12);
 const oldRecords=structuredClone(f.records),oldRun=f.nextRun();designAt(2);f.context('build-foundation',3);
 return Object.assign(f,{oldRun,oldRecords,interval,recovered,reported,latest,ev,testPath});
}

test('bootstrap ordinary version2 executable acceptance',async t=>{
 const f=await ordinaryHistoryFixture(t),restore=historyCheckpoint(f),path=p=>join(f.root,p),savedProgress=fs.readFileSync(progress(f)),old=tree(f.oldRun.runRootAbs);
 const record=(name,r)=>{if(process.env.ENTERPRISE_SUITE_OUTPUT){const dir=join(process.env.ENTERPRISE_SUITE_OUTPUT,'ordinary-history');put(join(dir,name+'.json'),{status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});}};
 const run=()=>{const r=f.cli(init,{readonly:false});record('initialize',r);success(r);return read(path(read(progress(f)).history.manifest));};
 const editOld=fn=>{const records=structuredClone(f.oldRecords);for(const r of records)fn(r);put(join(f.oldRun.logsAbs,'fixture.jsonl'),records.map(r=>JSON.stringify(r)).join('\n')+'\n');};
 const negative=(name,change)=>{restore();change();const before=tree(f.temporary),r=f.cli(init);record(name,r);assert.notEqual(r.status,0);assert.doesNotMatch(r.stderr,/FS_MUTATION/);assert.deepEqual(tree(f.temporary),before);};
 await t.test('bootstrap-ordinary-rejection-multiple-input-snapshots-history-only',()=>{restore();const m=run(),h=m.unimported.recovery;assert.equal(h.schemaVersion,2);assert.equal(h.historyOnly,true);assert.deepEqual(h.currentApprovals,[]);assert.equal(h.ordinaryHistory.initializerHistory.snapshots.length,3);assert.equal(h.attemptCount,0);assert.equal(h.reviewedAttempt,null);for(const e of h.outputs.entries)assert.ok(m.files.entries.some(x=>x.path===e.path&&x.sha256===e.sha256));assert.deepEqual(tree(f.oldRun.runRootAbs),old);});
 await t.test('bootstrap-ordinary-entire-twelve-receipt-interval-including-failures',()=>{restore();const h=run().unimported.recovery.ordinaryHistory;assert.equal(h.interval.length,12);assert.deepEqual(h.interval.filter(e=>e.status==='failed').map(e=>e.entry.id),[f.interval[0].id,f.interval[5].id]);for(const e of [f.interval[0],f.interval[5]])assert.equal(read(path(e.path)).suites[0].exitCode,0);assert.deepEqual(h.interval.map(e=>e.entry),f.interval);assert.equal(h.interval.at(-1).entry.id,read(path(f.latest.candidatePath)).members.at(-1).runId);});
 await t.test('bootstrap-ordinary-intermediate-source-test-only-no-plan-runtime-or-suite-drift',()=>{
  for(const kind of ['runtime','plan','digest','path-set','suite','body'])negative(kind,()=>{const e=f.interval[1],r=read(path(e.path));if(kind==='suite')r.suites[0].definitionHash='forged';else if(kind==='body'){fs.appendFileSync(path(f.ev+'/addition.txt'),'changed');return;}else{if(kind==='runtime')r.inputs.runtime.version='forged';if(kind==='plan')r.inputs.entries.find(e=>e.path==='work/enterprise/plan.json').sha256='0'.repeat(64);if(kind==='path-set')r.inputs.entries.pop();r.inputs.digest=kind==='digest'?'forged':hash(JSON.stringify({entries:r.inputs.entries,runtime:r.inputs.runtime}));}put(path(e.path),r);});
 });
 await t.test('bootstrap-ordinary-real-builder-phases-and-latest-independent-rejection',()=>{
  for(const kind of ['phase','phase-id','complete','model','handoff-hash','review','design'])negative(kind,()=>{if(kind==='design'){fs.appendFileSync(join(f.run.reportsAbs,'enterprise-02-review.md'),'forged');return;}editOld(r=>{if(r.iteration===15){if(kind==='phase'&&r.phase===2)r.content='missing';if(kind==='phase-id'&&r.phase===1)delete r.phaseExecutionId;if(kind==='complete'&&r.type==='step_complete')r.status='error';if(kind==='model'&&r.type==='step_start')r.model='gpt-6.1-sol';if(kind==='handoff-hash'&&r.phase===1)r.content=r.content.replace(hash(fs.readFileSync(path(f.ev+'/handoff.json'))),'unbound');}if(kind==='review'&&r.iteration===16&&r.phase===2)r.status='error';});});
 });
 await t.test('bootstrap-ordinary-reviewed-candidate-exact-latest-prefix-without-recovery',()=>{
  for(const kind of ['candidate','post-report','output','old-root'])negative(kind,()=>{if(kind==='candidate')fs.appendFileSync(path(f.latest.candidatePath),'changed');if(kind==='post-report'){const p='evidence/enterprise/runs/index.json',x=read(path(p));x.runs.pop();put(path(p),x);}if(kind==='output')fs.appendFileSync(path(read(path(f.interval[5].path)).suites[0].stdout),'changed');if(kind==='old-root')fs.appendFileSync(path(f.recovered.resultPath),'changed');});
 });
 await t.test('bootstrap-ordinary-gap-fork-unknown-writer-review-or-tamper-zero-writes',()=>{
  for(const kind of ['gap','fork','running','writer','lock','manifest','unknown-review','later-writer'])negative(kind,()=>{if(kind==='lock'){put(path('evidence/enterprise/gate.lock'),'unknown');return;}if(kind==='manifest'){fs.appendFileSync(path(f.ev+'/middle-inputs.json'),' ');return;}if(kind==='unknown-review'||kind==='later-writer'){const p=join(f.oldRun.logsAbs,'fixture.jsonl');fs.appendFileSync(p,JSON.stringify({...f.oldRecords.find(r=>r.type==='step_start'&&r.iteration===(kind==='later-writer'?15:16)),iteration:17})+'\n');return;}const p='evidence/enterprise/runs/index.json',x=read(path(p));if(kind==='gap')x.runs=x.runs.filter(e=>e.id!==f.interval[1].id);else if(kind==='fork')x.runs.push(x.runs.at(-1));else{const r=read(path(f.interval[1].path));if(kind==='running')r.status='running';else r.implementationSession='unknown';put(path(f.interval[1].path),r);}put(path(p),x);});
 });
 await t.test('bootstrap-ordinary-durable-archive-and-atomic-empty-current-projection',()=>{
  for(const point of ['lock','manifest','crash']){restore();const oldBefore=tree(f.oldRun.runRootAbs);const r=historyInject(f,point==='crash'?"const link=fs.linkSync;fs.linkSync=function(a,b,...xs){const r=link.call(this,a,b,...xs);if(String(b).endsWith('/manifest.json'))process.kill(process.pid,'SIGKILL');return r;}":`const link=fs.linkSync;fs.linkSync=function(a,b,...xs){const r=link.call(this,a,b,...xs);if(String(b).endsWith('/${point==='lock'?'gate.lock':'manifest.json'}'))fs.appendFileSync(${JSON.stringify(path(f.ev+'/addition.txt'))},'changed');return r;}`);record(point,r);assert.deepEqual(fs.readFileSync(progress(f)),savedProgress);if(point!=='crash'){assert.notEqual(r.status,0);continue;}assert.equal(r.signal,'SIGKILL');const m=run(),pr=read(progress(f));assert.deepEqual(pr.approvals,{});assert.deepEqual(pr.issues,{});assert.equal(pr.activeBatchId,'B00');const archive=pr.history.manifest.slice(0,-'manifest.json'.length);for(const e of m.files.entries)assert.equal(hash(fs.readFileSync(path(archive+'files/'+e.path))),e.sha256);assert.ok(m.files.entries.some(e=>e.path===f.recovered.resultPath));assert.deepEqual(tree(f.oldRun.runRootAbs),oldBefore);}
 });
 await t.test('bootstrap-ordinary-no-current-recovery-approval-selection-or-seal-authority',()=>{
  restore();const before=tree(f.temporary),r=spawnSync(process.execPath,['--import',f.guardPath,'--input-type=module','-e',"import fs from 'node:fs';import {currentContext} from './scripts/enterprise/context.mjs';import {rejectedInitializationHistory} from './scripts/enterprise/rejected-regeneration.mjs';rejectedInitializationHistory(process.cwd(),await currentContext(process.cwd(),{requireSession:false,historicalRunSlug:'fixture-run'}),JSON.parse(fs.readFileSync('work/enterprise/progress.json')));"],{cwd:f.root,env:f.env,encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/ordinary unexplained input/);assert.deepEqual(tree(f.temporary),before);
  run();for(const args of [init,['batch','--recover-rejected'],['batch','--import-closure']]){const before=tree(f.temporary),r=f.cli(args);record(args.join('-'),r);assert.notEqual(r.status,0);assert.doesNotMatch(r.stderr,/FS_MUTATION/);assert.deepEqual(tree(f.temporary),before);}
  const r2=f.cli(['batch','--batch','B01'],{readonly:false});assert.notEqual(r2.status,0);assert.match(r2.stderr,/active batch swap/);
  put(path(f.testPath),"import test from 'node:test';test('ordinary required assertion',()=>{});\n");f.context('harden-release',4);const seal=f.cli(['all'],{readonly:false});record('seal',seal);assert.notEqual(seal.status,0);assert.match(seal.stderr,/independent batch approval required/);assert.deepEqual(read(progress(f)).approvals,{});
  f.context('final-audit',5);const finalBefore=tree(f.temporary),final=f.cli(['all']);record('final',final);assert.notEqual(final.status,0);assert.doesNotMatch(final.stderr,/FS_MUTATION/);assert.deepEqual(tree(f.temporary),finalBefore);
 });
});
