import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
import {fixture,put,read,tree} from './evidence-fixture.mjs';import {hash} from '../../scripts/enterprise/evidence.mjs';import {savePersonaSessions} from '../../node_modules/takt/dist/infra/config/project/sessionStore.js';
const pp=f=>join(f.root,'work/enterprise/progress.json'),init=['batch','--import-closure'];
const success=r=>assert.equal(r.status,0,r.stderr);const reject=(r,re)=>{assert.notEqual(r.status,0,r.stdout);assert.match(r.stderr,re);};
async function setup(t){
 const f=await fixture(t,{multi:true,selection:true,seal:false}),p=read(pp(f));p.activeBatchId=null;put(pp(f),p);f.context('build-foundation',3);success(f.cli(['batch','--batch','B01'],{readonly:false}));
 const ref=read(pp(f)).lastGate.closureCandidate,c=read(join(f.root,ref.candidatePath)),active=c.members.at(-1);
 const legacy={schemaVersion:1,verdict:'APPROVE',runSlug:'fixture-run',workflowRef:f.workflowRef,step:'review-foundation',iteration:4,sessionKey:'enterprise-batch-reviewer',providerSessionId:'reviewer-session',
 batchId:active.batchId,runId:active.runId,inputsDigest:c.inputs.digest,receiptHash:active.receiptHash,receiptSha256:active.receiptSha256,outputsDigest:active.outputsDigest,approvedIssueIds:active.issueIds,unresolvedFindings:[]};
 const att={schemaVersion:1,verdict:'APPROVE',runSlug:'fixture-run',workflowRef:f.workflowRef,step:'review-foundation',iteration:4,sessionKey:'enterprise-batch-reviewer',providerSessionId:'reviewer-session',activeBatchId:c.activeBatchId,inputsDigest:c.inputs.digest,...ref,
 members:c.members.map(m=>({batchId:m.batchId,runId:m.runId,receiptHash:m.receiptHash,receiptSha256:m.receiptSha256,outputsDigest:m.outputsDigest,approvedIssueIds:m.issueIds,
 issueEvidence:m.issues.map(i=>({issueId:i.id,decisions:i.acceptanceTests.map(a=>({id:a.id,verdict:'APPROVE',artifacts:[read(join(f.root,`evidence/enterprise/runs/${m.runId}/receipt.json`)).suites[0].stdout]}))}))})),unresolvedFindings:[]};
 function publish(edit=x=>x,{phase1}={}){
  edit(att,legacy);const content='```enterprise-batch-attestation\n'+JSON.stringify(legacy)+'\n```\n```enterprise-closure-attestation\n'+JSON.stringify(att)+'\n```';
  f.batchReport(legacy,{batchId:'B01',iteration:4,content,...(phase1?{phase1}: {})});f.context('build-foundation',5);return content;
 }
 return {...f,c,ref,att,legacy,publish};
}
const latest=(f,b)=>read(join(f.root,'evidence/enterprise/runs/index.json')).runs.filter(r=>r.batchId===b).at(-1);
function rebindMember(f,b,change){
 const e=latest(f,b),r=read(join(f.root,e.path));change(r);put(join(f.root,e.path),r);
 const m=f.c.members.find(m=>m.batchId===b),a=f.att.members.find(m=>m.batchId===b);
 m.receiptHash=hash(JSON.stringify(r));m.receiptSha256=hash(fs.readFileSync(join(f.root,e.path)));m.builderSession=r.implementationSession;
 a.receiptHash=m.receiptHash;a.receiptSha256=m.receiptSha256;
 put(join(f.root,f.ref.candidatePath),f.c);f.ref.candidateSha256=hash(fs.readFileSync(join(f.root,f.ref.candidatePath)));f.att.candidateSha256=f.ref.candidateSha256;
}
function unchanged(f,pattern){const before=fs.readFileSync(pp(f)),r=f.cli(init,{readonly:false});reject(r,pattern);assert.deepEqual(fs.readFileSync(pp(f)),before);}
test('closure-exact-current-multi-batch-approval',async t=>{
 const f=await setup(t);f.publish();success(f.cli(init,{readonly:false}));const p=read(pp(f));assert.equal(p.activeBatchId,null);
 assert.deepEqual(Object.keys(p.approvals).sort(),['B00','B01']);for(const id of f.att.members.flatMap(m=>m.approvedIssueIds))assert.equal(p.issues[id].status,'VERIFIED');
 success(f.cli(['batch','--batch','B02'],{readonly:false}));
 // Authenticated entry survives a source edit; previous reviewed outputs remain bound.
 fs.appendFileSync(join(f.root,'src/domain.mjs'),'changed');success(f.cli(['batch','--batch','B02'],{readonly:false}));
});
test('closure-stale-or-mixed-inputs-rejected',async t=>{
 for(const kind of ['source','candidate','attestation'])await t.test(kind,async t=>{
 const f=await setup(t);f.publish(a=>{if(kind==='attestation')a.inputsDigest='bad';});
 if(kind==='source')fs.appendFileSync(join(f.root,'src/domain.mjs'),'changed');
 if(kind==='candidate'){const c=read(join(f.root,f.ref.candidatePath));c.inputs.digest='mixed';put(join(f.root,f.ref.candidatePath),c);}
 unchanged(f,/stale|changed closure candidate|closure inputsDigest/);
 });
});
test('closure-missing-prefix-or-issue-rejected',async t=>{
 for(const kind of ['prefix','issue','AC','artifact','active'])await t.test(kind,async t=>{const f=await setup(t);f.publish(a=>{
 if(kind==='prefix')a.members.shift();if(kind==='issue')a.members[0].approvedIssueIds=[];if(kind==='AC')a.members[0].issueEvidence[0].decisions=[];
 if(kind==='artifact')a.members[0].issueEvidence[0].decisions[0].artifacts=['unknown'];if(kind==='active')a.members.at(-1).runId='wrong';});
 unchanged(f,/closure missing prefix|closure Issue scope|closure original AC|closure unknown artifact|closure member runId/);});
});
test('closure-changed-receipt-output-or-report-rejected',async t=>{
 for(const kind of ['receipt','output','report','phase'])await t.test(kind,async t=>{const f=await setup(t);f.publish(x=>x,{...(kind==='phase'?{phase1:'```enterprise-batch-attestation\n'+JSON.stringify(f.legacy)+'\n```'}:{})});
 const entry=latest(f,'B00'),r=read(join(f.root,entry.path));
 if(kind==='receipt')fs.appendFileSync(join(f.root,entry.path),' ');if(kind==='output')fs.appendFileSync(join(f.root,r.suites[0].stdout),'changed');
 if(kind==='report')fs.appendFileSync(join(f.run.reportsAbs,'enterprise-04-review.md'),'changed');unchanged(f,/changed closure member|changed output|differs from orchestrator|single enterprise closure/);
 });
});
test('closure-latest-failed-running-or-review-rejected',async t=>{
 for(const kind of ['failed','running','review'])await t.test(kind,async t=>{const f=await setup(t);f.publish();
 if(kind==='review'){f.batchReport({iteration:6,verdict:'REQUEST_CHANGES',approvedIssueIds:[]},{iteration:6});f.context('build-foundation',7);}
 else{const entry=latest(f,'B00'),r=read(join(f.root,entry.path)),path='evidence/enterprise/runs/newest/receipt.json';put(join(f.root,path),{...r,id:'newest',status:kind});const ix=read(join(f.root,'evidence/enterprise/runs/index.json'));ix.runs.push({id:'newest',batchId:'B00',path});put(join(f.root,'evidence/enterprise/runs/index.json'),ix);}
 unchanged(f,/latest run failed or running|single enterprise closure/);});
});
test('closure-real-distinct-Astra-session-required',async t=>{
 for(const kind of ['session','model','effort','builder'])await t.test(kind,async t=>{const f=await setup(t);if(kind==='builder')rebindMember(f,'B00',r=>{r.implementationSession='reviewer-session';});f.publish();
 if(kind==='session'){f.sessions[JSON.stringify(['enterprise-batch-reviewer','codex','gpt-6-astra'])]='builder-session';savePersonaSessions(f.root,f.sessions,'codex',f.paths.sessionsDirectory);}
 if(kind==='model'||kind==='effort'){const r=f.records.find(r=>r.type==='step_start'&&r.iteration===4);if(kind==='model')r.model='gpt-6.1-sol';else r.providerOptions.codex.reasoningEffort='medium';f.append({type:'fixture-boundary'});}
 unchanged(f,/actual provider session|routing|closure separate builder session/);});
});
test('closure-review-after-all-receipts',async t=>{const f=await setup(t);rebindMember(f,'B00',r=>{r.finishedAt='2099-01-01T00:00:00Z';});f.publish();unchanged(f,/closure review before member completion/);});
test('closure-atomic-import-and-crash-recovery',async t=>{
 for(const kind of ['crash','after-commit','archive','concurrent'])await t.test(kind,async t=>{
 const f=await setup(t);f.publish();const before=fs.readFileSync(pp(f)),inject=join(f.temporary,'fault.mjs');
 const code=kind==='after-commit'?"const rename=fs.renameSync;fs.renameSync=function(...args){rename.apply(this,args);process.kill(process.pid,'SIGKILL')};":kind==='crash'?"fs.renameSync=function(){process.kill(process.pid,'SIGKILL')};":kind==='archive'?"const open=fs.openSync;fs.openSync=function(p,...a){if(String(p).includes('/closure-imports/'))throw Error('ARCHIVE_FAILURE');return open.call(this,p,...a)};":"const link=fs.linkSync;fs.linkSync=function(a,b,...rest){const r=link.call(this,a,b,...rest);if(String(b).endsWith('/checkpoint.json')){const p='work/enterprise/progress.json';const x=JSON.parse(fs.readFileSync(p));x.concurrent=true;fs.writeFileSync(p,JSON.stringify(x));}return r};";
 put(inject,"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';"+code+'syncBuiltinESMExports();');
 const r=spawnSync(process.execPath,['--import',inject,join(f.root,'scripts/enterprise/verify.mjs'),...init],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000});
 if(['crash','after-commit'].includes(kind))assert.equal(r.signal,'SIGKILL');else reject(r,/ARCHIVE_FAILURE|concurrent closure progress/);
 if(kind==='after-commit'){const committed=fs.readFileSync(pp(f));success(f.cli(init,{readonly:false}));assert.deepEqual(fs.readFileSync(pp(f)),committed);return;}
 const p=read(pp(f));assert.deepEqual(p.approvals,JSON.parse(before).approvals);assert.deepEqual(p.issues,JSON.parse(before).issues);
 if(kind==='concurrent')assert.equal(p.concurrent,true);else{assert.deepEqual(fs.readFileSync(pp(f)),before);success(f.cli(init,{readonly:false}));assert.equal(read(pp(f)).activeBatchId,null);}
 });
});
test('closure-no-historical-approval-promotion',async t=>{const f=await setup(t);f.publish();success(f.cli(init,{readonly:false}));f.nextRun();const p=read(pp(f));p.activeBatchId=null;put(pp(f),p);const before=tree(f.temporary);reject(f.cli(['batch','--batch','B02'],{readonly:false}),/writer binding runSlug/);assert.deepEqual(tree(f.temporary),before);});
test('closure-legacy-single-batch-remains-strict',async t=>{const f=await fixture(t,{multi:true,selection:true,seal:false});const p=read(pp(f));p.activeBatchId=null;put(pp(f),p);f.context('build-foundation',3);success(f.cli(['batch','--batch','B01'],{readonly:false}));const p2=read(pp(f));p2.activeBatchId=null;put(pp(f),p2);reject(f.cli(['batch','--batch','B02'],{readonly:false}),/not earliest pending batch/);});

test('closure-final-seal-readonly-member-binding',async t=>{
 const f=await setup(t);f.publish();success(f.cli(init,{readonly:false}));f.context('harden-release',6);success(f.cli(['all','--seal'],{readonly:false}));
 f.context('final-audit',7);const before=tree(f.temporary);success(f.cli(['final','--check-seal']));assert.deepEqual(tree(f.temporary),before);
 fs.appendFileSync(join(f.root,f.ref.candidatePath),' ');const changed=tree(f.temporary);reject(f.cli(['final','--check-seal']),/changed closure candidate/);assert.deepEqual(tree(f.temporary),changed);
});

test('closure-approved-history-can-initialize-without-current-promotion',async t=>{
 const f=await setup(t);f.publish();success(f.cli(init,{readonly:false}));
 // A stopped run keeps its last active batch and exact selection as history.
 const p=read(pp(f));p.activeBatchId='B01';put(pp(f),p);const old=f.nextRun();const before=tree(old.runRootAbs);
 success(f.cli(['batch','--initialize-run'],{readonly:false}));const next=read(pp(f));assert.deepEqual(next.approvals,{});assert.deepEqual(next.issues,{});assert.equal(next.activeBatchId,'B00');assert.deepEqual(tree(old.runRootAbs),before);
});
