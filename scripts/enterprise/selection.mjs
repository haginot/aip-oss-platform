import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {confined,hash,inputs,validateLatest,validateApproval,validateReviewedRun} from './evidence.mjs';

const read=(root,path)=>JSON.parse(readFileSync(confined(root,path)));
// Batch order is part of the approved plan. Every earlier batch must be approved;
// truthy progress entries must not skip an unrelated, unapproved predecessor.
function prefix(plan,batchId) {
 const index=plan.batches.findIndex(b=>b.id===batchId);
 assert.ok(index>=0,'unknown active batch');
 const batches=plan.batches.slice(0,index+1);
 for(const [n,b] of batches.entries()) for(const id of b.dependsOnBatches)
   assert.ok(batches.slice(0,n).some(p=>p.id===id),'invalid selection dependency order');
 return batches;
}
const topology=batches=>batches.map(({id,issueIds,dependsOnBatches,stage,reviewStage})=>({id,issueIds,dependsOnBatches,stage,reviewStage}));

export async function createSelection(root,plan,batch,suitesFor,approvals) {
 const before=inputs(root),planText=readFileSync(confined(root,'work/enterprise/plan.json'),'utf8');
 assert.deepEqual(JSON.parse(planText),plan,'concurrent selection plan change');
 const predecessors=[];
 for(const prior of prefix(plan,batch.id).slice(0,-1)) {
   const run=validateLatest(root,prior.id,suitesFor(plan,prior.issueIds));
   const approval=approvals?.[prior.id];
   await validateApproval(root,approval,run,prior.issueIds);
   assert.equal(run.inputs.digest,before.digest,'selection entry input mismatch');
   predecessors.push({batchId:prior.id,runId:run.id,approval});
 }
 assert.deepEqual(inputs(root),before,'concurrent selection input change');
 return {schemaVersion:1,batchId:batch.id,inputsDigest:before.digest,planText,predecessors};
}

export async function validateSelection(root,plan,batch,progress,suitesFor) {
 const current=prefix(plan,batch.id);
 // The initial batch has no prerequisite to authenticate. This also permits
 // resuming legacy B00 state without treating its old status fields as authority.
 if(current.length===1)return;
 assert.ok(progress.entrySelection && progress.entrySelectionHash,'authenticated batch selection required');
 const raw=readFileSync(confined(root,progress.entrySelection));
 assert.equal(hash(raw),progress.entrySelectionHash,'changed batch selection');
 const selection=JSON.parse(raw);
 assert.equal(selection.schemaVersion,1,'selection schema');
 assert.equal(selection.batchId,batch.id,'selection batch mismatch');
 assert.equal(selection.inputsDigest,progress.entryInputs,'selection entry input mismatch');
 const entryPlan=JSON.parse(selection.planText),entryPrefix=prefix(entryPlan,batch.id);
 assert.deepEqual(topology(entryPrefix),topology(current),'selection plan topology changed');
 assert.deepEqual(selection.predecessors.map(p=>p.batchId),entryPrefix.slice(0,-1).map(b=>b.id),'selection prerequisite set');
 for(const [n,prerequisite] of selection.predecessors.entries()) {
   const prior=entryPrefix[n],run=read(root,`evidence/enterprise/runs/${prerequisite.runId}/receipt.json`);
   assert.equal(run.id,prerequisite.runId,'selection receipt identity');
   assert.equal(run.batchId,prior.id,'selection prerequisite batch');
   assert.equal(run.inputs.digest,selection.inputsDigest,'selection entry input mismatch');
   // The real independent attestation authenticates the entire receipt, including
   // this plan's byte hash and the suite definitions. Product hashes alone do not.
   assert.equal(run.inputs.entries.find(e=>e.path==='work/enterprise/plan.json')?.sha256,hash(selection.planText),'selection plan not reviewed');
   await validateReviewedRun(root,run,suitesFor(entryPlan,prior.issueIds),prerequisite.approval,prior.issueIds);
 }
 assert.equal(hash(readFileSync(confined(root,progress.entrySelection))),hash(raw),'concurrent batch selection change');
}
