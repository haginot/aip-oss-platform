import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {hash,confined,inputs,snapshot,validatePlan,validateLatest,validateRun,validateApproval} from './evidence.mjs';
import {currentContext} from './context.mjs';
import {validateReadonlyDefinition} from './approval.mjs';

const indexPath='evidence/enterprise/releases/index.json';
const runIndexPath='evidence/enterprise/runs/index.json';
const bytes=(root,p)=>readFileSync(confined(root,p));
const read=(root,p)=>JSON.parse(bytes(root,p));
// Only implementation batches are reviewed before sealing. Release/audit leaves
// remain mandatory machine evidence and are approved by the subsequent final report.
function priorReviewBatches(plan) {
 return plan.batches.filter(batch=>{
   if(batch.reviewStage==='final-audit') {
     assert.ok(['harden-release','final-audit'].includes(batch.stage),'invalid deferred review stage');
     assert.ok(batch.issueIds.every(id=>/^ENT-70[1-5]$/.test(id)),'implementation review cannot be deferred');
     return false;
   }
   assert.equal(batch.reviewStage,'review-foundation','unknown batch review stage');return true;
 });
}
const sameSet=(actual,expected,label)=>assert.deepEqual([...actual].sort(),[...expected].sort(),label);
function reportAttestation(content) {
 const matches=[...content.matchAll(/^```enterprise-attestation\r?\n([\s\S]*?)^```\s*$/gm)];
 assert.equal(matches.length,1,'single enterprise attestation required');
 return JSON.parse(matches[0][1]);
}
function validateReport(root,seal,digest,context) {
 assert.equal(context.step,'final-audit','final report context');
 assert.equal(context.sessionKey,'enterprise-final-auditor','auditor session key');
 assert.equal(context.start.provider,'codex','auditor provider');
 assert.equal(context.start.model,'gpt-6-astra','auditor Astra routing');
 assert.equal(context.start.providerOptions?.codex?.reasoningEffort,'high','auditor reasoning routing');
 validateReadonlyDefinition(context.stepDefinition,'auditor');
 assert.ok(![...seal.builderSessions,...context.builderSessions].includes(context.providerSessionId),'separate provider session required');
 const path=confined(context.identity.runRoot,relative(context.identity.runRoot,context.identity.reportDirectory)+'/enterprise-06-final-audit.md');
 const raw=readFileSync(path),content=raw.toString('utf8'),att=reportAttestation(content);
 assert.equal(att.schemaVersion,1);assert.equal(att.verdict,'APPROVE','final approval required');
 for(const [key,value] of Object.entries({releaseId:seal.releaseId,releaseDigest:digest,inputsDigest:seal.inputs.digest,
   runSlug:context.identity.runSlug,workflowRef:context.identity.workflowRef,step:'final-audit',iteration:context.iteration,
   sessionKey:'enterprise-final-auditor',providerSessionId:context.providerSessionId})) assert.equal(att[key],value,`report ${key}`);
 assert.deepEqual(att.unresolvedFindings,[],'unresolved findings');
 assert.ok(Array.isArray(att.productionLimitations),'production limitations required');
 assert.equal(att.githubSynchronization,'PENDING_DESTINATION','GitHub destination pending');
 const leaves=seal.issues.filter(i=>!i.children.length),parents=seal.issues.filter(i=>i.children.length);
 sameSet(att.approvedLeafIds,leaves.map(i=>i.id),'approved leaves');sameSet(att.approvedParentIds,parents.map(i=>i.id),'approved parents');
 sameSet(att.issueEvidence.map(i=>i.id),seal.issues.map(i=>i.id),'issue evidence scope');
 for(const issue of seal.issues) {
   const row=att.issueEvidence.find(i=>i.id===issue.id);assert.equal(row.verdict,'APPROVE',`Issue approval ${issue.id}`);
   sameSet(row.acceptanceIds,issue.acceptanceTests.map(a=>a.id),'original acceptance IDs');
   assert.ok(Array.isArray(row.basis)&&row.basis.length&&row.basis.every(s=>typeof s==='string'&&s.trim()),'review basis required');
   if(issue.children.length) {sameSet(row.children,issue.children,'parent children');assert.ok(row.demonstration?.trim(),'parent demonstration required');}
   else {
     assert.ok(row.receipts?.length && row.outputs?.length,'leaf evidence required');
     for(const p of row.receipts) assert.ok(seal.receipts.some(r=>r.path===p && (r.batchId===issue.batchId||r.batchId==='all')),'unknown receipt reference');
     for(const p of row.outputs) assert.ok(seal.outputs.entries.some(e=>e.path===p),'unknown output reference');
     assert.ok(row.negativeEvidence?.length,'negative evidence required');
     if(issue.suites.some(s=>/browser/i.test(s.id))) assert.ok(row.browserEvidence?.length,'browser evidence required');
     for(const p of [...row.negativeEvidence,...(row.browserEvidence??[])]) assert.ok(row.outputs.includes(p),'counterexample/browser output reference required');
   }
 }
 const records=context.records;
 const startIndex=records.findLastIndex(r=>r.type==='step_start');
 const occurrence=records.slice(startIndex+1);
 const relevant=r=>r.step==='final-audit'&&r.iteration===context.iteration&&r.workflow===context.identity.workflow&&r.stack?.[0]?.workflow_ref===context.identity.workflowRef;
 const phases=[1,2].map(phase=>occurrence.findIndex(r=>r.type==='phase_complete'&&r.phase===phase&&r.status==='done'&&relevant(r)));
 const complete=occurrence.findIndex(r=>r.type==='step_complete'&&r.status==='done'&&relevant(r));
 assert.ok(phases[0]>=0 && phases[1]>phases[0] && complete>phases[1],'missing or incomplete current report phases');
 const phase2=occurrence[phases[1]].content;
 assert.ok(content===phase2||content===phase2+'\n','changed review report');
 const phase1=reportAttestation(occurrence[phases[0]].content);
 for(const key of ['schemaVersion','releaseId','releaseDigest','inputsDigest','verdict','runSlug','workflowRef','step','iteration','sessionKey','providerSessionId']) assert.equal(phase1[key],att[key],`phase identity ${key}`);
 sameSet(phase1.approvedLeafIds,att.approvedLeafIds,'phase leaf scope');
 sameSet(phase1.approvedParentIds,att.approvedParentIds,'phase parent scope');
 return {reportPath:path,reportSha256:hash(raw),attestation:att};
}
export async function checkFinal(root,checkReport,suitesFor) {
 return checkSealed(root,checkReport,suitesFor,false);
}
// This is data validation only. A staged candidate grants no final authority,
// and no caller callback, context or token can cause writes in this module.
export async function validateSealCandidate(root,sealPath,sealDigest,suitesFor) {
 return checkSealed(root,false,suitesFor,{sealPath,sealDigest});
}
async function checkSealed(root,checkReport,suitesFor,candidate) {
 if(!candidate) assert.ok(!existsSync(confined(root,'evidence/enterprise/gate.lock')),'writer active');
 const context=await currentContext(root);
 assert.ok(['harden-release','final-audit'].includes(context.step),'final context unavailable');
 const indexRaw=bytes(root,indexPath),index=JSON.parse(indexRaw),last=index.attempts.at(-1);
 const staged=candidate&&last?.status==='running';
 const terminal=staged?{...candidate,releaseId:last.releaseId}:last;
 if(!staged)assert.equal(terminal?.status,'passed','latest release failed or running');
 if(candidate){assert.equal(terminal.sealPath,candidate.sealPath,'candidate path');assert.equal(terminal.sealDigest,candidate.sealDigest,'candidate digest');}
 const sealBytes=bytes(root,terminal.sealPath),seal=JSON.parse(sealBytes),digest=hash(sealBytes);
 assert.equal(digest,terminal.sealDigest,'changed seal');assert.equal(seal.releaseId,terminal.releaseId,'release identity');
 assert.deepEqual(index.attempts.at(staged?-1:-2),seal.releasePrefix.attempts.at(-1),'release attempt identity');
 assert.equal(index.attempts.filter(a=>a.releaseId===seal.releaseId).length,staged?1:2,'release terminal duplication');
 assert.deepEqual(staged?index:{...index,attempts:index.attempts.slice(0,-1)},seal.releasePrefix,'release prefix changed');
 assert.deepEqual(context.identity,seal.context,'release context changed');
 const plan=read(root,'work/enterprise/plan.json');validatePlan(root,plan,read(root,'work/enterprise/backlog.json'));
 assert.deepEqual(seal.issues,plan.issues,'sealed Issue contract changed');
 assert.deepEqual(inputs(root),seal.inputs,'changed input');assert.equal(hash(bytes(root,'work/enterprise/plan.json')),seal.planHash,'changed plan');
 assert.equal(hash(bytes(root,'work/enterprise/coverage.json')),seal.coverageHash,'changed coverage');
 assert.deepEqual(read(root,runIndexPath),seal.runIndex,'latest machine run index changed');
 const expected=[...plan.batches,{id:'all',issueIds:plan.issues.filter(i=>!i.children.length).map(i=>i.id)}];
 sameSet(seal.receipts.map(r=>r.batchId),expected.map(b=>b.id),'sealed batches');
 for(const batch of expected) {
   const r=seal.receipts.find(r=>r.batchId===batch.id);assert.equal(hash(bytes(root,r.path)),r.sha256,'changed receipt');
   assert.equal(validateLatest(root,batch.id,suitesFor(plan,batch.issueIds)).id,r.runId,'latest machine run changed');
 }
 sameSet(seal.approvals.map(a=>a.batchId),priorReviewBatches(plan).map(b=>b.id),'sealed approval batches');
 for(const approval of seal.approvals) {
   assert.equal(hash(bytes(root,approval.receiptPath)),approval.receiptSha256,'changed reviewed receipt');
   const batch=plan.batches.find(b=>b.id===approval.batchId),reviewed=read(root,approval.receiptPath);
   assert.equal(reviewed.batchId,batch.id,'reviewed batch identity');
   validateRun(root,reviewed,suitesFor(plan,batch.issueIds));
   await validateApproval(root,approval,reviewed,batch.issueIds);
   for(const suite of reviewed.suites) assert.ok(seal.outputRoots.includes(suite.outputDirectory),'reviewed output missing from seal');
 }
 assert.deepEqual(snapshot(root,seal.outputRoots),seal.outputs,'changed output');
 assert.deepEqual(snapshot(root,seal.protectedFiles.entries.map(e=>e.path)),seal.protectedFiles,'protected file changed');
 const report=checkReport?validateReport(root,seal,digest,context):{};
 // Re-read every authority and every byte after validation. No lock or regeneration here.
 const again=await currentContext(root);assert.deepEqual(again,context,'concurrent context change');
 assert.deepEqual(inputs(root),seal.inputs,'concurrent input change');
 assert.deepEqual(bytes(root,indexPath),indexRaw,'concurrent release index change');
 assert.deepEqual(read(root,runIndexPath),seal.runIndex,'concurrent machine index change');
 assert.equal(hash(bytes(root,terminal.sealPath)),digest,'concurrent seal change');
 for(const r of seal.receipts) assert.equal(hash(bytes(root,r.path)),r.sha256,'concurrent receipt change');
 assert.deepEqual(snapshot(root,seal.outputRoots),seal.outputs,'concurrent output change');
 for(const a of seal.approvals) {assert.equal(hash(bytes(root,a.report)),a.reportHash,'concurrent review change');assert.equal(hash(bytes(root,a.receiptPath)),a.receiptSha256,'concurrent reviewed receipt change');}
 assert.deepEqual(snapshot(root,seal.protectedFiles.entries.map(e=>e.path)),seal.protectedFiles,'concurrent protected change');
 if(checkReport) assert.equal(hash(readFileSync(report.reportPath)),report.reportSha256,'concurrent report change');
 if(!candidate) assert.ok(!existsSync(confined(root,'evidence/enterprise/gate.lock')),'writer active');
 return {status:candidate?'SEAL_CANDIDATE_VALIDATED':checkReport?'FINAL_INDEPENDENT_APPROVAL_CURRENT':'SEALED_EVIDENCE_CURRENT',releaseId:seal.releaseId,releaseDigest:digest,inputsDigest:seal.inputs.digest,...(checkReport?{reportSha256:report.reportSha256}: {})};
}
