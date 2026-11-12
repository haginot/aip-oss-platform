import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hash,validateApproval} from '../../scripts/enterprise/evidence.mjs';
const read=p=>readFileSync(p,'utf8');
test('ENT-101 AC-01 original acceptance and failed regressions retained',()=>{
 const goal=read('PRODUCT_GOAL.md');for(let n=1;n<=9;n++)assert.ok(goal.includes(`AC-00${n}`));
 const plan=JSON.parse(read('work/enterprise/plan.json'));for(const p of plan.sourceSnapshots.filter(p=>['PRODUCT_GOAL.md','evidence/FAILURES.md'].includes(p.path)))assert.equal(hash(readFileSync(p.path)),p.sha256);
 const old=JSON.parse(read('verification/plan.json'));assert.equal(old.suites.length,35);for(const id of ['review-regressions-foundation','authentication-expiry-foundation','worker-authority-expiry-foundation','bcp-exercise'])assert.ok(old.suites.some(s=>s.id===id));
 assert.ok(read('evidence/FAILURES.md').includes('B-FOUNDATION-008'));assert.ok(read('work/enterprise/DELIVERY.md').includes('14-final-audit.md'));
});
test('ENT-101 AC-02 protected dirty evidence remains byte-identical and baseline is rerunnable',()=>{
 const p=JSON.parse(read('work/enterprise/plan.json'));for(const file of p.protectedFiles)assert.equal(hash(readFileSync(file.path)),file.sha256);
 for(const path of ['scripts/enterprise/baseline.mjs','scripts/enterprise/verify.mjs','.takt/quality-gates/platform-gate.sh'])assert.ok(existsSync(path));
 assert.equal(p.branch,'codex/enterprise-workflows');
});
test('positive persistent original Action Outbox Audit integration remains assigned to real baseline',()=>{
 const p=JSON.parse(read('verification/plan.json'));for(const id of ['writeback-foundation','store-recall-procurement','bcp-exercise']) {const suite=p.suites.find(s=>s.id===id);assert.ok(suite.outputs.length>1);for(const input of suite.inputs.filter(p=>p.startsWith('tests/')))assert.ok(existsSync(input));}
});
test('negative-authorization implementer cannot approve their own machine receipt',async()=>{
 await assert.rejects(()=>validateApproval('.', {verdict:'APPROVE',session:'same'}, {implementationSession:'same'}, ['ENT-101']),/separate reviewer/);
});
test('persistence review evidence survives reload and report tampering is rejected',async()=>{
 const root=mkdtempSync(join(tmpdir(),'enterprise-review-'));try {mkdirSync(join(root,'evidence'));const run={implementationSession:'implementer',inputs:{digest:'source'}};
 writeFileSync(join(root,'evidence/review.md'),'independent findings');const approval={verdict:'APPROVE',session:'reviewer',inputsDigest:'source',receiptHash:hash(JSON.stringify(run)),issueIds:['ENT-101'],report:'evidence/review.md',reportHash:hash('independent findings')};writeFileSync(join(root,'evidence/review.json'),JSON.stringify(approval));await assert.rejects(()=>validateApproval(root,JSON.parse(readFileSync(join(root,'evidence/review.json'))),run,['ENT-101']),/single enterprise batch attestation/);writeFileSync(join(root,'evidence/review.md'),'replaced');await assert.rejects(()=>validateApproval(root,approval,run,['ENT-101']),/changed review report/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('failure-recovery baseline runs unchanged original release then final gates and retains failures',()=>{
 const source=read('scripts/enterprise/baseline.mjs');assert.ok(source.includes("['release','final']"));assert.ok(source.includes("report.status='failed'"));assert.ok(source.includes("join(output,'evidence')"));
});
