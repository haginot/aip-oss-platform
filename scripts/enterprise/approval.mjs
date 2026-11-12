// Product-side approval pointers are untrusted. The orchestrator's completed
// review occurrence and provider session are the authority for their contents.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {confined,hash} from './evidence.mjs';
import {currentContext} from './context.mjs';
import {resolvePersonaSessionId} from '../../node_modules/takt/dist/infra/config/project/sessionStore.js';

// TAKT 0.70 compiles the named readonly capability into provider options;
// the source YAML's `capabilities` field is not in a published step. Check the
// complete compiled declaration, not an absent label or just edit:false.
// This is the workflow's no-edit contract, not proof of an OS sandbox mode.
export function validateReadonlyDefinition(definition,label) {
 assert.equal(definition?.kind,'agent',`${label} agent definition required`);
 assert.equal(definition.edit,false,`${label} must be readonly`);
 assert.equal(definition.allowGitCommit,false,`${label} commits forbidden`);
 assert.deepEqual(definition.capabilityProviderOptions,{
   claude:{allowedTools:['Read','Glob','Grep','Bash','WebSearch','WebFetch']},
   codex:{networkAccess:true},
   opencode:{allowedTools:['read','glob','grep','bash','websearch','webfetch'],networkAccess:true},
 },`${label} compiled readonly capability`);
}

export function batchAttestation(content) {
 const blocks=[...content.matchAll(/^```enterprise-batch-attestation\r?\n([\s\S]*?)^```\s*$/gm)];
 assert.equal(blocks.length,1,'single enterprise batch attestation required');
 return JSON.parse(blocks[0][1]);
}
export async function validateBatchReview(root,approval,run,issueIds,{historicalRunSlug,reportRaw,supersessionBatchId=run.batchId}={}) {
 const raw=reportRaw??readFileSync(confined(root,approval.report)),content=raw.toString('utf8'),att=batchAttestation(content);
 const context=await currentContext(root,{requireSession:false,historicalRunSlug});
 const expected={schemaVersion:1,verdict:'APPROVE',runSlug:context.identity.runSlug,
   workflowRef:context.identity.workflowRef,step:'review-foundation',sessionKey:'enterprise-batch-reviewer',
   providerSessionId:approval.session,batchId:run.batchId,runId:run.id,inputsDigest:run.inputs.digest,
   receiptHash:hash(JSON.stringify(run)),outputsDigest:hash(JSON.stringify(run.suites.map(s=>s.outputs)))};
 for(const [key,value] of Object.entries(expected)) assert.equal(att[key],value,`batch report ${key}`);
 assert.deepEqual([...att.approvedIssueIds].sort(),[...issueIds].sort(),'batch report Issue scope');
 assert.deepEqual(att.unresolvedFindings,[],'unresolved batch findings');
 const receiptPath=`evidence/enterprise/runs/${run.id}/receipt.json`;
 assert.equal(att.receiptSha256,hash(readFileSync(confined(root,receiptPath))),'batch report receipt bytes');
 assert.deepEqual(JSON.parse(readFileSync(confined(root,receiptPath))),run,'batch receipt identity');
 const definition=context.steps.find(s=>s.name==='review-foundation');
 assert.equal(definition?.sessionKey??definition?.session_key,'enterprise-batch-reviewer','batch reviewer key');
 validateReadonlyDefinition(definition,'batch reviewer');
 assert.ok(Number.isInteger(att.iteration)&&att.iteration>0,'batch review iteration required');
 const indices=context.records.flatMap((r,i)=>r.type==='step_start'&&r.step==='review-foundation'&&r.iteration===att.iteration?[i]:[]);
 assert.equal(indices.length,1,'batch review occurrence missing or ambiguous');
 const startIndex=indices[0],start=context.records[startIndex];
 assert.equal(start.workflow,context.identity.workflow,'batch review workflow');
 assert.equal(start.stack?.[0]?.workflow_ref,context.identity.workflowRef,'batch review workflow reference');
 assert.equal(start.provider,'codex','batch reviewer provider');assert.equal(start.model,'gpt-6-astra','batch reviewer Astra routing');
 assert.equal(start.providerOptions?.codex?.reasoningEffort,'high','batch reviewer reasoning routing');
 const session=resolvePersonaSessionId(context.sessions,JSON.stringify(['enterprise-batch-reviewer',start.provider,start.model]),start.provider);
 assert.ok(session,'batch reviewer session unavailable');assert.equal(att.providerSessionId,session,'batch reviewer actual provider session');
 assert.ok(![run.implementationSession,...context.builderSessions].includes(session),'separate reviewer provider session required');
 assert.ok(Date.parse(start.timestamp)>=Date.parse(run.finishedAt),'review must follow completed evidence');
 let end=context.records.findIndex((r,i)=>i>startIndex&&r.type==='step_start');if(end<0)end=context.records.length;
 const records=context.records.slice(startIndex+1,end);
 const relevant=r=>r.step===start.step&&r.iteration===start.iteration&&r.workflow===start.workflow&&JSON.stringify(r.stack)===JSON.stringify(start.stack);
 const phases=[1,2].map(phase=>records.flatMap((r,i)=>r.type==='phase_complete'&&r.phase===phase&&r.status==='done'&&relevant(r)?[i]:[]));
 const complete=records.findIndex(r=>r.type==='step_complete'&&r.status==='done'&&relevant(r));
 assert.ok(phases.every(p=>p.length===1)&&phases[1][0]>phases[0][0]&&complete>phases[1][0],'missing or incomplete batch review phases');
 const phase2=records[phases[1][0]].content;
 assert.ok(content===phase2||content===phase2+'\n','batch report differs from orchestrator report phase');
 assert.deepEqual(batchAttestation(records[phases[0][0]].content),att,'batch review phase attestation mismatch');
 // A later review of the same batch supersedes this approval, including a rejection
 // or an incomplete newer report. Reviews of other batches do not erase it.
 // Bootstrap authenticates the historical occurrence, not its current approval
 // validity. Preserve later failures as history; never import this approval into
 // the new run. Normal approval validation still rejects every superseding review.
 for(const record of historicalRunSlug?[]:context.records.slice(end)) {
   if(record.type!=='phase_complete'||record.step!=='review-foundation'||![1,2].includes(record.phase))continue;
   assert.ok(record.content?.includes('```enterprise-batch-attestation'),'later batch review scope unavailable');
   const later=batchAttestation(record.content);
   const blocks=[...record.content.matchAll(/^```enterprise-closure-attestation\r?\n([\s\S]*?)^```\s*$/gm)];
   assert.ok(blocks.length<=1,'later closure scope ambiguous');
   const scope=blocks.length?JSON.parse(blocks[0][1]).members.map(m=>m.batchId):[later.batchId];
   assert.ok(!scope.includes(supersessionBatchId),'batch approval superseded by later review');
 }
 const again=await currentContext(root,{requireSession:false,historicalRunSlug});
 assert.deepEqual(again,context,'concurrent batch review authority change');
 if(!reportRaw) assert.equal(hash(readFileSync(confined(root,approval.report))),hash(raw),'concurrent batch report change');
 return true;
}
