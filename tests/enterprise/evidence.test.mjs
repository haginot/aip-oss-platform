import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execute} from '../../scripts/enterprise/verify.mjs';
import {validateLatest,validateApproval,validatePlan,parseTap,hash,inputs,snapshot,confined} from '../../scripts/enterprise/evidence.mjs';
import {spawnSync} from 'node:child_process';
import {fixture as authenticatedFixture} from './evidence-fixture.mjs';
import {materialize} from '../../scripts/enterprise/baseline.mjs';
function fixture(t,body="import test from 'node:test';import assert from 'node:assert/strict';test('actual fixture assertion',()=>assert.equal(2+2,4));") {
  const root=mkdtempSync(join(tmpdir(),'enterprise-evidence-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const p of ['work/enterprise','.takt','evidence','src','tests','scripts']) mkdirSync(join(root,p),{recursive:true});
  for(const p of ['evidence/FAILURES.md','evidence/ACCEPTANCE_MATRIX.md','src/domain.mjs','work/enterprise/plan.json'])writeFileSync(join(root,p),'original');
  writeFileSync(join(root,'tests/fixture.test.mjs'),body);
  const suite={id:'fixture',path:'tests/fixture.test.mjs',command:[process.execPath,'--test','--test-reporter=tap','tests/fixture.test.mjs'],requiredAssertions:['actual fixture assertion'],timeoutMs:15000};
  return {root,suite,run:()=>execute(root,'fixture',[suite]),validate:()=>validateLatest(root,'fixture',[suite])};
}
for(const [name,path] of [['stale-source','src/domain.mjs'],['stale-plan','work/enterprise/plan.json'],['stale-test','tests/fixture.test.mjs']]) test(name,t=>{
 const f=fixture(t);f.run();writeFileSync(join(f.root,path),'changed');assert.throws(f.validate,/stale source/);
});
test('changed-output',t=>{const f=fixture(t),r=f.run();writeFileSync(join(f.root,r.suites[0].stdout),'forged');assert.throws(f.validate,/changed output/);});
test('empty-suite',t=>{const f=fixture(t);assert.throws(()=>execute(f.root,'empty',[]),/empty suite/);});
test('missing-suite',t=>{const f=fixture(t);f.run();f.suite.id='missing';assert.throws(f.validate,/missing suite/);});
test('zero-assertions',()=>assert.throws(()=>parseTap('TAP version 13\n1..0\n# tests 0\n# pass 0'),/zero assertions/));
test('skip-or-cancel',t=>{const f=fixture(t,"import test from 'node:test';test.skip('actual fixture assertion',()=>{});");assert.throws(f.run,/zero assertions|TAP skipped|skip TAP/);});
test('nonzero-exit',t=>{const f=fixture(t,"import test from 'node:test';import assert from 'node:assert/strict';test('actual fixture assertion',()=>assert.fail('intentional failure'));");assert.throws(f.run,/nonzero exit/);assert.throws(f.validate,/latest run failed/);});
test('signal',t=>{const f=fixture(t,"process.kill(process.pid,'SIGKILL');");f.suite.command=[process.execPath,'tests/fixture.test.mjs'];assert.throws(f.run,/nonzero exit/);assert.throws(f.validate,/latest run failed/);});
for(const state of ['failed','running']) test(`latest-${state}`,t=>{
 const f=fixture(t);f.run();const index=JSON.parse(readFileSync(join(f.root,'evidence/enterprise/runs/index.json')));
 const path='evidence/enterprise/latest.json';writeFileSync(join(f.root,path),JSON.stringify({id:'later',batchId:'fixture',status:state}));index.runs.push({id:'later',batchId:'fixture',path});writeFileSync(join(f.root,'evidence/enterprise/runs/index.json'),JSON.stringify(index));assert.throws(f.validate,/latest run failed or running/);
});
test('changed-input-during-run',t=>{const f=fixture(t,"import test from 'node:test';import {writeFileSync} from 'node:fs';test('actual fixture assertion',()=>{writeFileSync('src/domain.mjs','mutated');});");assert.throws(f.run,/changed input during run/);});
test('path-escape',t=>{const f=fixture(t);assert.throws(()=>confined(f.root,'../escape'),/path escape/);symlinkSync(tmpdir(),join(f.root,'link'));assert.throws(()=>snapshot(f.root,['link']),/symlink/);});
test('forged-status',t=>{const f=fixture(t,"console.log(JSON.stringify({status:'PASS',tests:99}));");assert.throws(f.run,/zero assertions|missing assertion/);});
test('changed-review-report',async t=>{
 const f=fixture(t),run=f.run();writeFileSync(join(f.root,'evidence/review.md'),'APPROVE fixture');
 const a={verdict:'APPROVE',session:'independent-session',inputsDigest:run.inputs.digest,receiptHash:hash(JSON.stringify(run)),issueIds:['ENT-fixture'],report:'evidence/review.md',reportHash:hash('APPROVE fixture')};
 await assert.rejects(()=>validateApproval(f.root,a,run,['ENT-fixture']),/single enterprise batch attestation/);writeFileSync(join(f.root,'evidence/review.md'),'changed');await assert.rejects(()=>validateApproval(f.root,a,run,['ENT-fixture']),/changed review report/);
 a.session=run.implementationSession;await assert.rejects(()=>validateApproval(f.root,a,run,['ENT-fixture']),/separate reviewer/);
});
test('successful subprocess evidence validates and detects added authored input and artifact',t=>{
 const f=fixture(t),run=f.run();assert.equal(f.validate().id,run.id);writeFileSync(join(f.root,run.suites[0].outputDirectory,'extra'),'changed');assert.throws(f.validate,/changed output artifacts/);
 rmSync(join(f.root,run.suites[0].outputDirectory,'extra'));writeFileSync(join(f.root,'new-config.json'),'new');assert.throws(f.validate,/stale source/);
});
test('materialized inputs match and missing copy fails without rewriting original',t=>{
 const f=fixture(t),target=mkdtempSync(join(tmpdir(),'enterprise-copy-'));t.after(()=>rmSync(target,{recursive:true,force:true}));const before=inputs(f.root);materialize(f.root,target,before);assert.deepEqual(inputs(target),before);writeFileSync(join(target,'src/domain.mjs'),'different');assert.notDeepEqual(inputs(target),before);assert.deepEqual(inputs(f.root),before);
});
test('scope expansion, changed AC, Issue specification and architecture inputs require revised review',t=>{
 const f=fixture(t),item={id:'ENT-101',acceptance:['original AC'],parent:null,children:[],dependsOn:[]};
 const plan={issues:[{...item,originalAcceptance:item.acceptance,sourceSpec:'src/domain.mjs',sourceSpecSha256:hash('original')}],sourceSnapshots:[{path:'work/enterprise/plan.json',sha256:hash('original')}]};
 assert.equal(validatePlan(f.root,plan,{items:[item]}),true);
 assert.throws(()=>validatePlan(f.root,plan,{items:[item,{...item,id:'ENT-113'}]}),/scope changed/);
 assert.throws(()=>validatePlan(f.root,plan,{items:[{...item,acceptance:['weakened AC']}]}),/changed acceptance/);
 writeFileSync(join(f.root,'src/domain.mjs'),'changed');assert.throws(()=>validatePlan(f.root,plan,{items:[item]}),/stale Issue specification/);
 writeFileSync(join(f.root,'src/domain.mjs'),'original');writeFileSync(join(f.root,'work/enterprise/plan.json'),'changed');assert.throws(()=>validatePlan(f.root,plan,{items:[item]}),/stale architecture input/);
});

async function batchFixture(t) {
 const f=await authenticatedFixture(t,{seal:false,evidenceBatches:true});f.context('build-foundation');
 const plan=JSON.parse(readFileSync(join(f.root,'work/enterprise/plan.json')));
 const gate=async (n,validateOnly=false)=>{
  const code="import fs from 'node:fs';import {runBatchGate} from './scripts/enterprise/verify.mjs';const p=JSON.parse(fs.readFileSync('work/enterprise/plan.json'));console.log(JSON.stringify(await runBatchGate(process.cwd(),p,p.batches["+n+"],'builder-session',"+validateOnly+")));";
  const r=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000});
  assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout.trim().split('\n').at(-1));
 };
 return {...f,plan,gate};
}
test('batch transition retains exact predecessor review receipts and executes only active batch',async t=>{
 const f=await batchFixture(t),first=(await f.gate(0))[0],second=await f.gate(1),third=await f.gate(2);
 assert.deepEqual(second[0],first);
 assert.deepEqual(third.slice(0,2),second);
 const retry=await f.gate(2);assert.deepEqual(retry.slice(0,2),second);assert.notEqual(retry[2].runId,third[2].runId);
 const index=JSON.parse(readFileSync(join(f.root,'evidence/enterprise/runs/index.json')));
 assert.deepEqual(index.runs.map(r=>r.batchId),['B00','B01','B02','B02']);
});
for(const state of ['failed','running']) test(`batch transition rejects latest predecessor ${state} without fallback or active execution`,async t=>{
 const f=await batchFixture(t);await f.gate(0);
 const indexPath=join(f.root,'evidence/enterprise/runs/index.json'),index=JSON.parse(readFileSync(indexPath));
 const path='evidence/enterprise/newer.json';writeFileSync(join(f.root,path),JSON.stringify({id:'newer',batchId:'B00',status:state}));index.runs.push({id:'newer',batchId:'B00',path});writeFileSync(indexPath,JSON.stringify(index));
 const before=readFileSync(indexPath,'utf8');await assert.rejects(()=>f.gate(1),/latest run failed or running/);assert.equal(readFileSync(indexPath,'utf8'),before);
});
for(const corruption of ['stdout','artifacts']) test(`batch transition rejects predecessor ${corruption} change before active execution`,async t=>{
 const f=await batchFixture(t),first=(await f.gate(0))[0],indexPath=join(f.root,'evidence/enterprise/runs/index.json');
 const index=JSON.parse(readFileSync(indexPath)),run=JSON.parse(readFileSync(join(f.root,index.runs[0].path)));
 if(corruption==='source') writeFileSync(join(f.root,'src/domain.mjs'),'changed');
 else if(corruption==='stdout') writeFileSync(join(f.root,run.suites[0].stdout),'forged');
 else writeFileSync(join(f.root,run.suites[0].outputDirectory,'unexpected.txt'),'tampered');
 const before=readFileSync(indexPath,'utf8');await assert.rejects(()=>f.gate(1),/stale source|changed output/);assert.equal(readFileSync(indexPath,'utf8'),before);
});
test('validate-only batch transition does not create or replace receipts',async t=>{
 const f=await batchFixture(t);await f.gate(0);const completed=await f.gate(1),indexPath=join(f.root,'evidence/enterprise/runs/index.json'),before=readFileSync(indexPath,'utf8');
 assert.deepEqual(await f.gate(1,true),completed);assert.equal(readFileSync(indexPath,'utf8'),before);
});

test('batch transition reruns stale source predecessors and binds both receipts to new inputs',async t=>{
 const f=await batchFixture(t),before=(await f.gate(0))[0];writeFileSync(join(f.root,'src/domain.mjs'),'legitimate implementation change');
 const after=await f.gate(1);assert.notEqual(after[0].runId,before.runId);assert.notEqual(after[0].inputsDigest,before.inputsDigest);assert.equal(after[0].inputsDigest,after[1].inputsDigest);
 assert.deepEqual((await f.gate(2)).slice(0,2),after);
});
test('source change cannot hide tampered predecessor output or start active execution',async t=>{
 const f=await batchFixture(t);await f.gate(0);const indexPath=join(f.root,'evidence/enterprise/runs/index.json'),before=readFileSync(indexPath,'utf8'),index=JSON.parse(before),run=JSON.parse(readFileSync(join(f.root,index.runs[0].path)));
 writeFileSync(join(f.root,'src/domain.mjs'),'changed');writeFileSync(join(f.root,run.suites[0].stdout),'forged');await assert.rejects(()=>f.gate(1),/changed output/);assert.equal(readFileSync(indexPath,'utf8'),before);
});
