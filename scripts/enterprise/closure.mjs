// A candidate is only an evidence index. Approval is always an explicit,
// completed, independent orchestrator report, scoped separately to each member.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {hash,confined,inputs,validateLatest,validateRunEvidence,validatePlan} from './evidence.mjs';
import {currentContext} from './context.mjs';
import {batchAttestation,validateBatchReview} from './approval.mjs';
import {validateRecoveryApproval} from './rejected-regeneration.mjs';
import {immutable,atomic,acquire} from './continuation.mjs';
const bytes=(root,p)=>readFileSync(confined(root,p));
const read=(root,p)=>JSON.parse(bytes(root,p));
const encode=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
const receiptPath=id=>`evidence/enterprise/runs/${id}/receipt.json`;
function suitesFor(plan,ids){return [...new Map(ids.flatMap(id=>plan.issues.find(i=>i.id===id).suites).filter(s=>s.id!=='complete-machine-gate').map(s=>[s.id,s])).values()];}
function prefix(plan,id){const n=plan.batches.findIndex(b=>b.id===id);assert.ok(n>=0,'unknown closure active batch');return plan.batches.slice(0,n+1);}
export function closureAttestation(content){
 const blocks=[...content.matchAll(/^```enterprise-closure-attestation\r?\n([\s\S]*?)^```\s*$/gm)];
 assert.equal(blocks.length,1,'single enterprise closure attestation required');return JSON.parse(blocks[0][1]);
}
function member(root,plan,batch,run){return {batchId:batch.id,runId:run.id,receiptHash:hash(JSON.stringify(run)),receiptSha256:hash(bytes(root,receiptPath(run.id))),
 outputsDigest:hash(JSON.stringify(run.suites.map(s=>s.outputs))),builderSession:run.implementationSession,
 issueIds:batch.issueIds,issues:batch.issueIds.map(id=>plan.issues.find(i=>i.id===id)),suites:suitesFor(plan,batch.issueIds)};}
export function createClosureCandidate(root,plan,activeBatchId,recovery){
 const before=inputs(root),planText=bytes(root,'work/enterprise/plan.json').toString();assert.deepEqual(JSON.parse(planText),plan);
 const members=prefix(plan,activeBatchId).map(b=>member(root,plan,b,validateLatest(root,b.id,suitesFor(plan,b.issueIds))));
 const candidate={schemaVersion:1,activeBatchId,inputs:before,planText,members,...(recovery?{recovery}:{})};
 assert.deepEqual(inputs(root),before,'concurrent closure inputs');
 const raw=encode(candidate),path=`evidence/enterprise/closures/${hash(raw)}/candidate.json`;immutable(root,path,raw);
 return {candidatePath:path,candidateSha256:hash(raw)};
}
export function validateCandidate(root,ref,{current=false}={}){
 const raw=bytes(root,ref.candidatePath);assert.equal(hash(raw),ref.candidateSha256,'changed closure candidate');
 const c=JSON.parse(raw),plan=JSON.parse(c.planText);assert.equal(c.schemaVersion,1,'closure candidate schema');
 const batches=prefix(plan,c.activeBatchId);assert.deepEqual(c.members.map(m=>m.batchId),batches.map(b=>b.id),'closure prefix incomplete');
 const runs=[];
 for(const [i,b] of batches.entries()){
  const m=c.members[i],run=read(root,receiptPath(m.runId));assert.equal(run.id,m.runId);assert.equal(run.batchId,b.id);
  assert.deepEqual(run.inputs,c.inputs,'mixed closure inputs');
  assert.equal(run.inputs.entries.find(e=>e.path==='work/enterprise/plan.json')?.sha256,hash(c.planText),'closure plan not evidenced');
  validateRunEvidence(root,run,suitesFor(plan,b.issueIds));assert.deepEqual(m,member(root,plan,b,run),'changed closure member');
  if(current)assert.equal(validateLatest(root,b.id,suitesFor(plan,b.issueIds)).id,run.id,'closure not latest');
  runs.push(run);
 }
 if(current){validatePlan(root,plan,read(root,'work/enterprise/backlog.json'));assert.deepEqual(inputs(root),c.inputs,'stale closure inputs');assert.equal(bytes(root,'work/enterprise/plan.json').toString(),c.planText,'stale closure plan');}
 return {candidate:c,plan,runs};
}
async function validateClosure(root,approval,{current=false,historicalRunSlug}={}){
 const raw=bytes(root,approval.report);assert.equal(hash(raw),approval.reportHash,'changed review report');
 const content=raw.toString(),att=closureAttestation(content),legacy=batchAttestation(content);
 const ref={candidatePath:att.candidatePath,candidateSha256:att.candidateSha256};
 const {candidate:c,plan,runs}=validateCandidate(root,ref,{current});
 const context=await currentContext(root,{requireSession:false,historicalRunSlug}),active=runs.at(-1),activeMember=c.members.at(-1);
 if(c.recovery)await validateRecoveryApproval(root,att,c,context);
 for(const [key,value] of Object.entries({schemaVersion:1,verdict:'APPROVE',runSlug:context.identity.runSlug,workflowRef:context.identity.workflowRef,
 step:'review-foundation',sessionKey:'enterprise-batch-reviewer',providerSessionId:approval.session,activeBatchId:c.activeBatchId,inputsDigest:c.inputs.digest}))assert.equal(att[key],value,`closure ${key}`);
 assert.equal(att.iteration,legacy.iteration,'closure iteration');assert.deepEqual(att.unresolvedFindings,[],'unresolved closure findings');
 assert.deepEqual(att.members.map(m=>m.batchId),c.members.map(m=>m.batchId),'closure missing prefix or duplicate member');
 // Reuse the strict logged legacy occurrence/phase/model/session checks for the
 // active member. Explicit checks below extend authority to every other member.
 await validateBatchReview(root,{...approval,session:att.providerSessionId},active,activeMember.issueIds,{supersessionBatchId:approval.closure?.batchId??c.activeBatchId,historicalRunSlug});
 const startIndex=context.records.findIndex(r=>r.type==='step_start'&&r.step==='review-foundation'&&r.iteration===att.iteration);
 assert.ok(startIndex>=0,'closure occurrence missing');let end=context.records.findIndex((r,i)=>i>startIndex&&r.type==='step_start');if(end<0)end=context.records.length;
 const occurrence=context.records.slice(startIndex+1,end);
 for(const phase of [1,2]){const record=occurrence.find(r=>r.type==='phase_complete'&&r.phase===phase&&r.step==='review-foundation'&&r.iteration===att.iteration);assert.deepEqual(closureAttestation(record.content),att,'closure phase mismatch');}
 for(const [i,m] of att.members.entries()){
  const expected=c.members[i],run=runs[i];
  for(const key of ['batchId','runId','receiptHash','receiptSha256','outputsDigest'])assert.equal(m[key],expected[key],`closure member ${key}`);
  assert.deepEqual([...m.approvedIssueIds].sort(),[...expected.issueIds].sort(),'closure Issue scope');
  assert.notEqual(run.implementationSession,att.providerSessionId,'closure separate builder session');
  assert.ok(Date.parse(context.records[startIndex].timestamp)>=Date.parse(run.finishedAt),'closure review before member completion');
  assert.deepEqual(m.issueEvidence.map(e=>e.issueId).sort(),[...expected.issueIds].sort(),'closure original Issue decisions');
  const artifacts=new Set(run.suites.flatMap(s=>s.outputs.entries.map(e=>e.path)));
  for(const decision of m.issueEvidence){
   const issue=plan.issues.find(i=>i.id===decision.issueId);
   assert.deepEqual(decision.decisions.map(d=>d.id).sort(),issue.acceptanceTests.map(a=>a.id).sort(),'closure original AC decisions');
   for(const d of decision.decisions){assert.equal(d.verdict,'APPROVE','closure AC not approved');assert.ok(d.artifacts?.length,'closure AC evidence required');for(const p of d.artifacts)assert.ok(artifacts.has(p),'closure unknown artifact');}
  }
 }
 for(const key of ['batchId','runId','receiptHash','receiptSha256','outputsDigest','approvedIssueIds'])assert.deepEqual(att.members.at(-1)[key],legacy[key],'closure active legacy mismatch');
 for(const record of historicalRunSlug?[]:context.records.slice(end)){
  if(record.type!=='phase_complete'||record.step!=='review-foundation'||![1,2].includes(record.phase))continue;
  const later=batchAttestation(record.content);
  const ids=record.content.includes('```enterprise-closure-attestation')?closureAttestation(record.content).members.map(m=>m.batchId):[later.batchId];
  const scoped=approval.closure?[approval.closure.batchId]:c.members.map(m=>m.batchId);
  assert.ok(!scoped.some(id=>ids.includes(id)),'closure member superseded');
 }
 assert.deepEqual(await currentContext(root,{requireSession:false,historicalRunSlug}),context,'concurrent closure authority');
 assert.equal(hash(bytes(root,approval.report)),hash(raw),'concurrent closure report');
 assert.deepEqual(validateCandidate(root,ref,{current}).candidate,c,'concurrent closure evidence');
 return {att,candidate:c,runs,ref};
}
export async function validateClosureApproval(root,approval,run,issueIds,options={}){
 const result=await validateClosure(root,approval,options);
 assert.deepEqual({candidatePath:approval.closure.candidatePath,candidateSha256:approval.closure.candidateSha256},result.ref,'closure pointer');
 const m=result.att.members.find(m=>m.batchId===approval.closure.batchId);assert.ok(m,'closure member missing');
 assert.equal(m.batchId,run.batchId);assert.equal(m.runId,run.id);assert.equal(m.receiptHash,hash(JSON.stringify(run)));
 assert.deepEqual([...m.approvedIssueIds].sort(),[...issueIds].sort());return true;
}
export async function importClosure(root){
 const context=await currentContext(root);assert.equal(context.step,'build-foundation','closure import requires builder');assert.equal(context.stepDefinition.edit,true);assert.equal(context.sessionKey,'enterprise-builder');
 // Use the published contract, not a report filename supplied by a caller.
 const contracts=context.steps.find(s=>s.name==='review-foundation').outputContracts;
 assert.equal(contracts?.length,1,'canonical closure report missing');
 const canonical=confined(context.identity.runRoot,relative(context.identity.runRoot,context.identity.reportDirectory)+'/'+contracts[0].name);
 const raw=readFileSync(canonical),att=closureAttestation(raw.toString()),reportHash=hash(raw),report=`evidence/enterprise/reviews/closure-${reportHash}.md`;
 const unlock=acquire(root,context);
 try{
  immutable(root,report,raw);
  const approval={report,reportHash,session:att.providerSessionId};
  const {candidate:c}=await validateClosure(root,approval,{current:true});
  const path='work/enterprise/progress.json',before=bytes(root,path),p=JSON.parse(before);
  const next=structuredClone(p);
  for(const m of att.members){next.approvals[m.batchId]={...approval,verdict:'APPROVE',issueIds:m.approvedIssueIds,inputsDigest:att.inputsDigest,receiptHash:m.receiptHash,
    closure:{candidatePath:att.candidatePath,candidateSha256:att.candidateSha256,batchId:m.batchId}};
    for(const id of m.approvedIssueIds)next.issues[id]={status:'VERIFIED',batchId:m.batchId,runId:m.runId,report,reportHash};
  }
  next.activeBatchId=null;
  if(p.activeBatchId===null){assert.deepEqual(p,next,'closure projection differs from completed import');return {status:'EXACT_CLOSURE_APPROVAL_ALREADY_IMPORTED',report,reportHash};}
  assert.equal(p.activeBatchId,c.activeBatchId,'closure active batch changed');
  const projection=encode(next),directory=`evidence/enterprise/closure-imports/${reportHash}-${hash(before)}`;
  immutable(root,directory+'/before.json',before);immutable(root,directory+'/projection.json',projection);
  immutable(root,directory+'/checkpoint.json',encode({report,reportHash,beforeHash:hash(before),projectionHash:hash(projection),candidatePath:att.candidatePath,candidateSha256:att.candidateSha256}));
  await validateClosure(root,approval,{current:true});
  assert.deepEqual(await currentContext(root),context,'concurrent closure writer context');
  assert.deepEqual(readFileSync(canonical),raw,'concurrent canonical closure report');assert.deepEqual(bytes(root,path),before,'concurrent closure progress');
  atomic(root,path,projection);
  return {status:'EXACT_CLOSURE_APPROVAL_IMPORTED',members:att.members.map(m=>m.batchId),report,reportHash};
 }finally{unlock();}
}
