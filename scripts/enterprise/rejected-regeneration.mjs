// A rejected selection permits fresh machine evidence only. No projection or
// approval is written here; all authority comes from actual TAKT occurrences.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync,lstatSync} from 'node:fs';
import {relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {currentContext} from './context.mjs';
import {hash,confined,inputs,snapshot,validatePlan,validateRunEvidence,parseTap} from './evidence.mjs';
import {batchAttestation,validateReadonlyDefinition} from './approval.mjs';
import {closureAttestation,validateCandidate,createClosureCandidate} from './closure.mjs';
import {immutable,atomic,acquire} from './continuation.mjs';
import {execute,suitesFor} from './gate-execution.mjs';
import {resolvePersonaSessionId} from '../../node_modules/takt/dist/infra/config/project/sessionStore.js';
const progressPath='work/enterprise/progress.json',indexPath='evidence/enterprise/runs/index.json',contractPath='work/enterprise/REJECTED_REGENERATION.md',base='evidence/enterprise/recoveries';
const bytes=(r,p)=>readFileSync(confined(r,p)),read=(r,p)=>JSON.parse(bytes(r,p)),encode=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
const ref=(r,path)=>({path,sha256:hash(bytes(r,path))});
const receipt=id=>`evidence/enterprise/runs/${id}/receipt.json`;
const prefix=(p,id)=>{const n=p.batches.findIndex(b=>b.id===id);assert.ok(n>0,'recovery requires selected predecessor');return p.batches.slice(0,n+1);};
const topology=bs=>bs.map(({id,issueIds,dependsOnBatches,stage,reviewStage})=>({id,issueIds,dependsOnBatches,stage,reviewStage}));
const starts=(c,step)=>c.records.flatMap((r,i)=>r.type==='step_start'&&r.step===step?[i]:[]);
const revalidationContract='work/enterprise/REVIEW_REVALIDATION.md';
const keys=(x,names,label)=>assert.deepEqual(Object.keys(x).sort(),names.sort(),label);
function block(raw,name){const a=[...raw.matchAll(new RegExp('^```'+name+'\\r?\\n([\\s\\S]*?)^```\\s*$','gm'))];assert.equal(a.length,1,`single ${name} required`);return JSON.parse(a[0][1]);}
function canonical(c,step){const contracts=c.steps.find(s=>s.name===step)?.outputContracts;assert.equal(contracts?.length,1,'canonical contract required');return confined(c.identity.runRoot,relative(c.identity.runRoot,c.identity.reportDirectory)+'/'+contracts[0].name);}
// Private as-of occurrence authentication. This does not expose a historical
// approval escape hatch to selection, acceptance, sealing or callers.
function occurrence(c,i,name,key,latest=false){
 const s=c.records[i],def=c.steps.find(d=>d.name===s.step);validateReadonlyDefinition(def,s.step);assert.equal(def.sessionKey??def.session_key,key);
 assert.equal(s.workflow,c.identity.workflow);assert.equal(s.stack?.[0]?.workflow_ref,c.identity.workflowRef);
 assert.equal(s.provider,'codex');assert.equal(s.model,'gpt-6-astra','review Astra required');assert.equal(s.providerOptions?.codex?.reasoningEffort,'high');
 const session=resolvePersonaSessionId(c.sessions,JSON.stringify([key,s.provider,s.model]),s.provider);assert.ok(session,'review session missing');assert.ok(!c.builderSessions.includes(session),'independent session required');
 let end=c.records.findIndex((r,n)=>n>i&&r.type==='step_start');if(end<0)end=c.records.length;
 const rs=c.records.slice(i+1,end),relevant=r=>r.step===s.step&&r.iteration===s.iteration&&r.workflow===s.workflow&&JSON.stringify(r.stack)===JSON.stringify(s.stack);
 const phases=[1,2].map(p=>rs.flatMap((r,n)=>r.type==='phase_complete'&&r.phase===p&&r.status==='done'&&relevant(r)?[n]:[]));
 const done=rs.findIndex(r=>r.type==='step_complete'&&r.status==='done'&&relevant(r));
 assert.ok(phases.every(p=>p.length===1)&&phases[0][0]<phases[1][0]&&phases[1][0]<done,'incomplete review occurrence');
 const raw=rs[phases[1][0]].content,att=block(raw,name);assert.deepEqual(block(rs[phases[0][0]].content,name),att,'review phases differ');
 assert.ok(att.schemaVersion===1||(name==='enterprise-recovery-design-attestation'&&att.schemaVersion===2),'review schemaVersion');
 for(const [k,v] of Object.entries({runSlug:c.identity.runSlug,workflowRef:c.identity.workflowRef,step:s.step,iteration:s.iteration,sessionKey:key,providerSessionId:session}))assert.equal(att[k],v,`review ${k}`);
 if(latest){assert.equal(starts(c,s.step).at(-1),i,'review is not latest');const actual=readFileSync(canonical(c,s.step),'utf8');assert.ok(actual===raw||actual===raw+'\n','canonical report mismatch');}
 return {index:i,start:s,end,raw,reportSha256:hash(raw),att,phase1:rs[phases[0][0]].content};
}
function design(c,i,planText,contractHash,latest=false){
 assert.ok(Number.isInteger(i),'design approval missing');const d=occurrence(c,i,'enterprise-recovery-design-attestation','enterprise-architecture-reviewer',latest);
 for(const [k,v] of Object.entries({verdict:'APPROVE',permission:'EVIDENCE_REGENERATION_ONLY',contractPath,contractSha256:contractHash,planSha256:hash(planText)}))assert.equal(d.att[k],v,`design ${k}`);
 if(d.att.schemaVersion===2)keys(d.att,['schemaVersion','verdict','runSlug','workflowRef','step','iteration','sessionKey','providerSessionId','contractPath','contractSha256','planSha256','permission','unresolvedFindings','revalidation'],'design fields');
 assert.deepEqual(d.att.unresolvedFindings,[]);return d;
}
function review(root,c,i,latest=false){
 const j=occurrence(c,i,'enterprise-closure-attestation','enterprise-batch-reviewer',latest),a=j.att,l=batchAttestation(j.raw);
 assert.deepEqual(batchAttestation(j.phase1),l,'legacy phases differ');
 for(const k of ['schemaVersion','verdict','runSlug','workflowRef','step','iteration','sessionKey','providerSessionId','inputsDigest'])assert.deepEqual(l[k],a[k],`legacy ${k}`);
 assert.ok(['APPROVE','REQUEST_CHANGES'].includes(a.verdict),'unknown review verdict');
 const v=validateCandidate(root,a),candidate=v.candidate;assert.equal(a.activeBatchId,candidate.activeBatchId);assert.equal(a.inputsDigest,candidate.inputs.digest);
 assert.deepEqual(a.members.map(m=>m.batchId),candidate.members.map(m=>m.batchId),'review prefix mismatch');
 if(a.verdict==='REQUEST_CHANGES'){assert.ok(a.unresolvedFindings?.length&&l.unresolvedFindings?.length,'rejection finding required');assert.deepEqual(l.approvedIssueIds,[]);}
 else {assert.deepEqual(a.unresolvedFindings,[]);assert.deepEqual(l.unresolvedFindings,[]);}
 for(const [n,m] of a.members.entries()){
  const expected=candidate.members[n],run=v.runs[n];for(const k of ['batchId','runId','receiptHash','receiptSha256','outputsDigest'])assert.equal(m[k],expected[k],`review member ${k}`);
  assert.ok(![run.implementationSession,...c.builderSessions].includes(a.providerSessionId),'separate receipt builder required');
  assert.ok(Date.parse(j.start.timestamp)>=Date.parse(run.finishedAt),'review before receipt completion');
  if(a.verdict==='REQUEST_CHANGES')assert.deepEqual(m.approvedIssueIds,[]);else assert.deepEqual([...m.approvedIssueIds].sort(),[...expected.issueIds].sort());
  const known=new Set(run.suites.flatMap(s=>s.outputs.entries.map(e=>e.path))),seen=new Set();
  for(const e of m.issueEvidence??[]){assert.ok(expected.issueIds.includes(e.issueId)&&!seen.has(e.issueId),'unknown or repeated review Issue');seen.add(e.issueId);const issue=v.plan.issues.find(x=>x.id===e.issueId),acs=new Set();
   for(const d of e.decisions??[]){assert.ok(issue.acceptanceTests.some(x=>x.id===d.id)&&!acs.has(d.id),'unknown or repeated review AC');acs.add(d.id);for(const p of d.artifacts??[])assert.ok(known.has(p),'unknown review artifact');if(a.verdict==='APPROVE'){assert.equal(d.verdict,'APPROVE','closure AC not approved');assert.ok(d.artifacts?.length,'closure AC evidence required');}}
   if(a.verdict==='APPROVE')assert.deepEqual([...acs].sort(),issue.acceptanceTests.map(a=>a.id).sort(),'closure original AC decisions');
  }
  if(a.verdict==='APPROVE')assert.deepEqual([...seen].sort(),[...expected.issueIds].sort(),'closure original Issue decisions');
 }
 for(const k of ['batchId','runId','receiptHash','receiptSha256','outputsDigest','approvedIssueIds'])assert.deepEqual(l[k],a.members.at(-1)[k],'active legacy mismatch');
 return {...j,...v};
}
function retained(oldPlan,plan,active){
 assert.deepEqual(topology(prefix(plan,active)),topology(prefix(oldPlan,active)),'recovery topology changed');
 for(const b of prefix(oldPlan,active))for(const id of b.issueIds){
  const old=oldPlan.issues.find(x=>x.id===id),now=plan.issues.find(x=>x.id===id);assert.ok(now,'original Issue missing');
  assert.deepEqual(now.originalAcceptance,old.originalAcceptance,'original AC changed');
  for(const ac of old.acceptanceTests){const current=now.acceptanceTests.find(x=>x.id===ac.id);assert.ok(current,'original AC removed');const {suiteIds:oldSuites,...oldContract}=ac,{suiteIds:newSuites,...newContract}=current;assert.deepEqual(newContract,oldContract,'original AC changed');for(const id of oldSuites??[])assert.ok(newSuites?.includes(id),'original AC suite removed');}
  for(const s of old.suites.filter(s=>s.id!=='complete-machine-gate')){const n=now.suites.find(x=>x.id===s.id);assert.ok(n,'original suite removed');for(const a of s.requiredAssertions)assert.ok(n.requiredAssertions.includes(a),'original assertion removed');}
 }
}
// A distinct, private origin for ordinary prefix refresh before the first
// rejection. It confers no current approval and never rewrites schema-1 roots.
function ordinaryOrigin(root,c,s,approvals,j0,initializer){
 const plan=JSON.parse(s.planText),bs=prefix(plan,s.batchId),after=Math.max(...approvals.map(a=>a.index));
 const candidates=starts(c,'build-foundation').filter(i=>i>after&&i<j0.index);
 assert.equal(candidates.length,1,'ordinary origin requires one selecting builder occurrence');
 const bi=candidates[0],start=c.records[bi],def=c.steps.find(x=>x.name===start.step);
 assert.equal(def.edit,true);assert.equal(def.sessionKey??def.session_key,'enterprise-builder');
 assert.equal(start.provider,'codex');assert.equal(start.model,'gpt-6-astra');assert.equal(start.providerOptions?.codex?.reasoningEffort,'high');
 assert.equal(start.workflow,c.identity.workflow);assert.equal(start.stack?.[0]?.workflow_ref,c.identity.workflowRef);
 const session=resolvePersonaSessionId(c.sessions,JSON.stringify(['enterprise-builder',start.provider,start.model]),start.provider);assert.ok(session);
 assert.notEqual(session,j0.att.providerSessionId);
 const end=c.records.findIndex((r,i)=>i>bi&&r.type==='step_start'),rs=c.records.slice(bi+1,end<0?c.records.length:end);
 const relevant=r=>r.step===start.step&&r.iteration===start.iteration&&r.workflow===start.workflow&&JSON.stringify(r.stack)===JSON.stringify(start.stack);
 const phases=[1,2].map(n=>rs.filter(r=>r.type==='phase_complete'&&r.phase===n&&relevant(r)));
 assert.ok(phases.every(p=>p.length===1&&p[0].status==='done'),'ordinary builder phases incomplete');
 const [p1,p2]=phases.map(p=>p[0]);assert.ok(rs.indexOf(p1)<rs.indexOf(p2));
 const complete=rs.filter(r=>r.type==='step_complete'&&relevant(r));assert.equal(complete.length,1);assert.equal(complete[0].status,'done');assert.ok(rs.indexOf(complete[0])>rs.indexOf(p2));
 for(const p of [p1,p2]){assert.ok(typeof p.phaseExecutionId==='string'&&p.phaseExecutionId.length,'ordinary phase execution identity missing');assert.ok(Date.parse(p.timestamp)>=Date.parse(start.timestamp),'ordinary phase timestamp');}
 assert.notEqual(p1.phaseExecutionId,p2.phaseExecutionId);assert.ok(Date.parse(p2.timestamp)>=Date.parse(p1.timestamp));
 const mentioned=p=>[...new Set(p.content.match(/evidence\/enterprise\/closures\/[a-f0-9]{64}\/candidate\.json/g)??[])];
 const paths=mentioned(p1);assert.equal(paths.length,1,'ordinary reported candidate required');assert.deepEqual(mentioned(p2),paths,'ordinary builder candidate phases differ');
 const reportedRef={candidatePath:paths[0],candidateSha256:paths[0].split('/').at(-2)},v=validateCandidate(root,reportedRef),reported=v.candidate;
 assert.equal(reported.activeBatchId,s.batchId);assert.equal(reported.planText,s.planText,'ordinary plan changed');assert.ok(!reported.recovery);
 assert.deepEqual(reported.inputs,j0.candidate.inputs,'ordinary post-report inputs changed');
 for(const m of reported.members)for(const p of [p1,p2])assert.ok(p.content.includes(m.runId),'ordinary phase member missing');
 const old=read(root,receipt(s.predecessors[0].runId)).inputs,now=reported.inputs;
 assert.deepEqual(old.runtime,now.runtime,'ordinary runtime changed');
 assert.deepEqual(old.entries.map(e=>e.path),now.entries.map(e=>e.path),'ordinary input set changed');
 const delta=now.entries.filter((e,i)=>JSON.stringify(e)!==JSON.stringify(old.entries[i]));
 assert.ok(delta.length&&delta.every(e=>/^(src|tests)\//.test(e.path)),'ordinary refresh requires source/test change only');
 for(const path of ['scripts/enterprise/verify.mjs','scripts/enterprise/gate-execution.mjs'])assert.equal(now.entries.find(e=>e.path===path)?.sha256,hash(bytes(root,path)),'ordinary gate semantics changed');
 assert.ok(def.qualityGates?.some(g=>g.type==='command'&&/verify\.mjs['"]?\s+['"]?batch['"]?$/.test(g.command)),'ordinary frozen gate unavailable');
 const index=read(root,indexPath).runs;assert.equal(new Set(index.map(e=>e.id)).size,index.length,'ordinary duplicate index');
 const positions=s.predecessors.map(pr=>{const n=index.findIndex(e=>e.id===pr.runId&&e.batchId===pr.batchId);assert.ok(n>=0,'ordinary selected index missing');return n;});
 const boundary=Math.max(...positions)+1,indexPrefix=index.slice(0,boundary);
 for(const e of indexPrefix){assert.equal(e.path,receipt(e.id),'ordinary index prefix path');const r=read(root,e.path);assert.equal(r.id,e.id);assert.equal(r.batchId,e.batchId);}
 for(const pr of s.predecessors)assert.equal(indexPrefix.filter(e=>e.batchId===pr.batchId).at(-1)?.id,pr.runId,'ordinary stale selection prefix');
 const interval=[];let stopped=false,lastTime=Date.parse(start.timestamp);
 for(const e of index.slice(boundary)){
  const r=read(root,e.path);assert.equal(e.path,receipt(e.id));assert.equal(r.id,e.id);assert.equal(r.batchId,e.batchId);
  if(Date.parse(r.startedAt)>=Date.parse(j0.start.timestamp)){stopped=true;continue;}
  assert.ok(!stopped,'ordinary index order reversed');assert.ok(Date.parse(r.startedAt)>=lastTime,'ordinary receipt order');
  assert.ok(['passed','failed'].includes(r.status),'ordinary running receipt');assert.ok(Date.parse(r.finishedAt)>=Date.parse(r.startedAt)&&Date.parse(r.finishedAt)<=Date.parse(j0.start.timestamp),'ordinary receipt unfinished');lastTime=Date.parse(r.finishedAt);
  assert.equal(r.implementationSession,session,'ordinary receipt builder');assert.ok(bs.some(b=>b.id===r.batchId),'ordinary extra batch');
  if(!initializer)assert.ok([old.digest,now.digest].includes(r.inputs.digest),'ordinary unexplained input');
  if([old.digest,now.digest].includes(r.inputs.digest))assert.deepEqual(r.inputs,r.inputs.digest===old.digest?old:now,'ordinary manifest mismatch');
  const definitions=suitesFor(plan,bs.find(b=>b.id===r.batchId).issueIds);ordinaryReceipt(root,r,definitions);
  interval.push({entry:e,receipt:ref(root,e.path),run:r});
 }
 assert.ok(interval.length,'ordinary execution interval empty');
 // Every receipt in the selecting occurrence must be indexed, even a failed
 // gate with an otherwise successful subprocess. Phase references bind failed
 // receipts too; removing both the index entry and its file cannot erase them.
 const indexed=new Set(interval.map(x=>x.entry.id));
 for(const id of readdirSync(confined(root,'evidence/enterprise/runs'))){
  if(!existsSync(confined(root,receipt(id))))continue;
  const r=read(root,receipt(id));
  if(Date.parse(r.startedAt)>=Date.parse(start.timestamp)&&Date.parse(r.startedAt)<Date.parse(j0.start.timestamp))assert.ok(indexed.has(id),'ordinary unindexed receipt');
 }
 for(const p of [p1,p2])for(const id of new Set(p.content.match(/\b[0-9]{13}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/g)??[])){
  const r=read(root,receipt(id));if(Date.parse(r.startedAt)>=Date.parse(start.timestamp))assert.ok(indexed.has(id),'ordinary reported history missing');
 }

 const reportedEnd=Math.max(...reported.members.map(m=>{const n=interval.findIndex(e=>e.entry.id===m.runId);assert.ok(n>=0,'ordinary reported receipt missing');return n;}));
 const state=new Map(s.predecessors.map(pr=>[pr.batchId,read(root,receipt(pr.runId))]));let pending=[];
 for(const [n,x] of interval.entries()){
  const r=x.run;
  if(n>reportedEnd){assert.equal(r.batchId,s.batchId,'ordinary post-report predecessor replaced');assert.equal(r.status,'passed','ordinary post-report failed');assert.deepEqual(r.inputs,now);assert.ok(Date.parse(r.startedAt)>=Date.parse(p2.timestamp),'ordinary receipt before report boundary');}
  if(!pending.length)pending=bs.filter(b=>b.id===s.batchId||state.get(b.id)?.inputs.digest!==r.inputs.digest).map(b=>b.id);
  assert.equal(r.batchId,pending[0],'ordinary gate sequence');
  if(r.status==='failed')pending=[];else {state.set(r.batchId,r);pending.shift();}
  if(n===reportedEnd){assert.equal(pending.length,0,'ordinary reported incomplete gate');for(const m of reported.members)assert.equal(state.get(m.batchId)?.id,m.runId,'ordinary reported stale member');assert.ok(Date.parse(r.finishedAt)<=Date.parse(p1.timestamp),'ordinary report before evidence');}
 }
 assert.equal(pending.length,0,'ordinary terminal incomplete gate');
 for(const m of j0.candidate.members)assert.equal(state.get(m.batchId)?.id,m.runId,'ordinary rejection latest prefix');
 for(const m of reported.members.slice(0,-1))assert.equal(j0.candidate.members.find(x=>x.batchId===m.batchId)?.runId,m.runId,'ordinary post-report prefix replaced');
 const history=initializer&&interval.some(x=>![old.digest,now.digest].includes(x.run.inputs.digest))?initializer({root,c,s,j0,old,now,p1,p2,session,interval,reportedRef}):null;
 const references=new Map((history?.references??[]).map(e=>[e.path,e]));for(const x of interval){references.set(x.receipt.path,x.receipt);for(const suite of x.run.suites)for(const e of suite.outputs.entries)references.set(e.path,{path:e.path,sha256:e.sha256});}
 return {...(history?{initializerHistory:history}:{}),builder:{index:bi,start,session,definitionSha256:hash(JSON.stringify(def))},phases:[p1,p2].map(p=>({record:p,sha256:hash(JSON.stringify(p)),contentSha256:hash(p.content)})),completion:{record:complete[0],sha256:hash(JSON.stringify(complete[0]))},indexPrefix,interval:interval.map(({entry,receipt,run})=>({entry,receipt,status:run.status,inputs:run.inputs,outputsDigest:hash(JSON.stringify(run.suites.map(s=>s.outputs)))})),reported:reportedRef,rejected:{candidatePath:j0.att.candidatePath,candidateSha256:j0.att.candidateSha256},sourceChanges:delta,references:[...references.values()]};
}
// Version 2 is a history-only proof. The callback is supplied exclusively by
// new-run initialization; ordinary bootstrap/recovery/approval still use the
// original two-manifest rule. Phase-authenticated bytes, not a digest whitelist,
// explain intermediate edits. Concatenation supports saved append-only tests.
function initializerSnapshots({root,c,s,j0,old,now,p1,p2,session,interval,reportedRef},current){
 assert.notEqual(current.identity.runSlug,c.identity.runSlug,'initializer distinct run required');
 assert.equal(current.identity.project,c.identity.project);
 assert.equal(current.step,'build-foundation');assert.equal(current.sessionKey,'enterprise-builder');assert.equal(current.stepDefinition.edit,true);
 assert.equal(current.start.provider,'codex');assert.equal(current.start.model,'gpt-6-astra');assert.equal(current.start.providerOptions?.codex?.reasoningEffort,'high');assert.ok(current.providerSessionId);
 const d=design(current,starts(current,'review-architecture').at(-1),bytes(root,'work/enterprise/plan.json').toString(),hash(bytes(root,contractPath)),true);
 assert.ok(d.index<current.records.indexOf(current.start),'initializer design must precede writer');
 const historyContract='work/enterprise/RUN_ENTRY_HISTORY.md';
 assert.ok([d.phase1,d.raw].every(raw=>raw.includes(historyContract)&&raw.includes(hash(bytes(root,historyContract)))),'initializer history contract not reviewed');
 assert.equal(j0.index,starts(c,'review-foundation').at(-1),'initializer latest ordinary rejection required');
 assert.equal(c.records.findLastIndex(r=>r.type==='step_start'),j0.index,'initializer unknown later writer');
 review(root,c,j0.index,true);assert.ok(!j0.candidate.recovery&&!j0.att.recovery,'ordinary history has recovery authority');
 const paths=p=>[...new Set(p.content.match(/evidence\/enterprise\/[A-Za-z0-9_./-]+\/handoff\.json/g)??[])];
 const common=paths(p1).filter(path=>paths(p2).includes(path));assert.equal(common.length,1,'initializer phase-bound handoff required');
 const handoff=ref(root,common[0]),h=read(root,handoff.path);
 for(const p of [p1,p2])assert.ok(p.content.includes(handoff.sha256),'initializer handoff hash missing from phase');
 assert.equal(h.run,c.identity.runSlug);assert.equal(h.iteration,p1.iteration);assert.equal(h.builderSession,session);
 assert.equal(h.inputsDigest,now.digest);assert.equal(h.candidate.candidatePath,reportedRef.candidatePath);assert.equal(h.candidate.candidateSha256,reportedRef.candidateSha256);
 assert.ok(Array.isArray(h.references));assert.equal(new Set(h.references.map(e=>e.path)).size,h.references.length,'duplicate handoff reference');
 const refs=new Map([[handoff.path,handoff]]),available=[];
 // Only immutable local evidence and explicitly named source/test files can
 // supply bytes. Unchanged historical inputs inherit the selected approval;
 // each changed body in every snapshot must have an authenticated byte proof.
 for(const e of h.references){
  confined(root,e.path);assert.match(e.sha256,/^[a-f0-9]{64}$/);
  if(!e.path.startsWith(handoff.path.slice(0,-'handoff.json'.length))&&!/^(src|tests)\//.test(e.path))continue;
  const b=bytes(root,e.path);
  if(/^(src|tests)\//.test(e.path)&&hash(b)!==e.sha256)continue; // A later edit is not a historical snapshot.
  assert.equal(hash(b),e.sha256,'initializer changed handoff artifact');
  refs.set(e.path,{path:e.path,sha256:e.sha256});available.push({ref:e,bytes:b});
 }
 const snapshots=[old],seen=new Set([old.digest]);let previous=old;
 for(const {run}of interval){const m=run.inputs;
  assert.equal(m.digest,hash(JSON.stringify(m.runtime?{entries:m.entries,runtime:m.runtime}:m.entries)),'initializer manifest digest');
  assert.deepEqual(m.runtime,old.runtime,'initializer runtime drift');assert.deepEqual(m.entries.map(e=>e.path),old.entries.map(e=>e.path),'initializer input set drift');
  assert.equal(new Set(m.entries.map(e=>e.path)).size,m.entries.length,'initializer duplicate input');
  assert.equal(m.entries.find(e=>e.path==='work/enterprise/plan.json')?.sha256,hash(s.planText),'initializer plan drift');
  if(m.digest===previous.digest){assert.deepEqual(m,previous);continue;}
  assert.ok(!seen.has(m.digest),'initializer obsolete manifest rollback');seen.add(m.digest);
  const delta=m.entries.filter((e,i)=>!isDeepStrictEqual(e,previous.entries[i]));
  assert.ok(delta.length&&delta.every(e=>/^(src|tests)\//.test(e.path)),'initializer source/test changes only');
  const manifest=available.find(a=>{try{return isDeepStrictEqual(JSON.parse(a.bytes),m);}catch{return false;}});
  assert.ok(manifest,'initializer unexplained snapshot');snapshots.push(m);previous=m;
 }
 assert.deepEqual(previous,now,'initializer final snapshot mismatch');
 const changed=old.entries.filter((e,i)=>snapshots.some(m=>!isDeepStrictEqual(e,m.entries[i]))).map(e=>e.path),proofs=[];
 for(const m of snapshots)for(const path of changed){
  const e=m.entries.find(e=>e.path===path);assert.ok(Number.isInteger(e.bytes)&&e.bytes>=0);
  let parts=available.filter(a=>a.bytes.length===e.bytes&&hash(a.bytes)===e.sha256).slice(0,1);
  if(!parts.length){
   const bases=available.filter(a=>a.ref.path.split('/').at(-1)==='before-'+path.split('/').at(-1));
   const additions=available.filter(a=>a.ref.path.endsWith('.txt'));
   for(const a of bases)for(const b of additions)if(a.bytes.length+b.bytes.length===e.bytes&&hash(Buffer.concat([a.bytes,b.bytes]))===e.sha256){assert.equal(parts.length,0,'ambiguous source reconstruction');parts=[a,b];}
  }
  assert.ok(parts.length,'initializer source snapshot bytes missing: '+path+' '+m.digest);
  proofs.push({inputsDigest:m.digest,path,sha256:e.sha256,bytes:e.bytes,parts:parts.map(a=>a.ref)});
 }
 return {schemaVersion:2,historyOnly:true,currentApprovals:[],design:{identity:current.identity,start:d.start,writer:{start:current.start,session:current.providerSessionId},reportSha256:d.reportSha256,attestation:d.att,raw:d.raw,phase1:d.phase1},contract:ref(root,historyContract),handoff,snapshots,proofs,references:[...refs.values(),ref(root,historyContract),ref(root,contractPath)]};
}
function ordinaryReceipt(root,r,definitions){
 assert.ok(r.suites.length>0&&r.suites.length<=definitions.length,'ordinary suite prefix');
 let failure=null;
 for(const [n,s] of r.suites.entries()){
  const d=definitions[n];assert.equal(s.id,d.id);assert.equal(s.definitionHash,hash(JSON.stringify(d)));assert.deepEqual(s.argv,d.command);
  assert.equal(s.cwd,root);assert.ok(s.runtime?.node&&s.runtime?.executable);assert.ok(Date.parse(s.startedAt)>=Date.parse(r.startedAt)&&Date.parse(s.finishedAt)>=Date.parse(s.startedAt)&&Date.parse(s.finishedAt)<=Date.parse(r.finishedAt));
  assert.equal(hash(bytes(root,s.stdout)),s.stdoutHash);assert.equal(hash(bytes(root,s.stderr)),s.stderrHash);assert.deepEqual(snapshot(root,[s.outputDirectory]),s.outputs);
  assert.ok(s.exitCode===null||Number.isInteger(s.exitCode));assert.ok(s.signal===null||typeof s.signal==='string');
  if(s.exitCode!==0||s.signal||s.error)failure='subprocess';
  else if(s.inputsAfter!==r.inputs.digest)failure='changed input during run';
  else {let tap;try{tap=parseTap(bytes(root,s.stdout).toString(),d.requiredAssertions);}catch(e){failure=e.message;}if(tap)assert.deepEqual(s.tap,tap);}
  if(failure){assert.equal(n,r.suites.length-1,'ordinary suites after failure');assert.equal(r.status,'failed');}
 }
 if(r.status==='passed')validateRunEvidence(root,r,definitions);
 else {assert.ok(failure&&typeof r.error==='string'&&r.error.length,'ordinary failed diagnosis');if(failure!=='subprocess')assert.equal(r.error,failure,'ordinary gate failure diagnosis');}
}
function bootstrap(root,c,p,initializer){
 assert.equal(p.runBinding?.runSlug,c.identity.runSlug,'projection run mismatch');
 for(const k of ['project','workflowRef','bundleDigest'])assert.equal(p.runBinding[k],c.identity[k],`projection ${k}`);
 const selectionRaw=bytes(root,p.entrySelection).toString();assert.equal(hash(selectionRaw),p.entrySelectionHash,'changed original selection');const s=JSON.parse(selectionRaw),op=JSON.parse(s.planText);
 assert.equal(s.batchId,p.activeBatchId,'active selection mismatch');assert.equal(s.inputsDigest,p.entryInputs);assert.equal(s.schemaVersion,1);
 const bs=prefix(op,s.batchId);assert.deepEqual(s.predecessors.map(x=>x.batchId),bs.slice(0,-1).map(x=>x.id));
 const approvals=s.predecessors.map((pr,n)=>{
  const raw=bytes(root,pr.approval.report).toString();assert.equal(hash(raw),pr.approval.reportHash,'changed original approval');
  const att=batchAttestation(raw),i=starts(c,'review-foundation').find(i=>c.records[i].iteration===att.iteration);assert.ok(Number.isInteger(i),'original approval occurrence missing');
  const o=occurrence(c,i,'enterprise-batch-attestation','enterprise-batch-reviewer');assert.ok(raw===o.raw||raw===o.raw+'\n','original approval report mismatch');assert.equal(att.verdict,'APPROVE');assert.deepEqual(att.unresolvedFindings,[]);
  const r=read(root,receipt(pr.runId));validateRunEvidence(root,r,suitesFor(op,bs[n].issueIds));assert.equal(r.id,pr.runId);assert.equal(r.batchId,pr.batchId);assert.equal(r.inputs.digest,s.inputsDigest);assert.equal(r.inputs.entries.find(x=>x.path==='work/enterprise/plan.json')?.sha256,hash(s.planText));
  let m=att;
  if(pr.approval.closure){const j=review(root,c,i);assert.equal(j.att.verdict,'APPROVE');if(j.candidate.recovery)recoveredHistory(root,j.att,j.candidate,c);m=j.att.members.find(x=>x.batchId===pr.batchId);assert.ok(m);assert.equal(pr.approval.closure.candidatePath,j.att.candidatePath);assert.equal(pr.approval.closure.candidateSha256,j.att.candidateSha256);}
  else assert.equal(att.batchId,pr.batchId);
  assert.equal(m.runId,r.id);assert.equal(m.receiptHash,hash(JSON.stringify(r)));assert.equal(m.receiptSha256,hash(bytes(root,receipt(r.id))));assert.equal(m.outputsDigest,hash(JSON.stringify(r.suites.map(x=>x.outputs))));assert.deepEqual([...m.approvedIssueIds].sort(),[...bs[n].issueIds].sort());
  assert.equal(pr.approval.session,att.providerSessionId);assert.equal(pr.approval.receiptHash,m.receiptHash);assert.equal(pr.approval.inputsDigest,r.inputs.digest);assert.deepEqual([...pr.approval.issueIds].sort(),[...bs[n].issueIds].sort());assert.notEqual(att.providerSessionId,r.implementationSession);assert.ok(Date.parse(o.start.timestamp)>=Date.parse(r.finishedAt));
  return {index:i,reportRaw:raw,reportSha256:hash(raw),receipt:ref(root,receipt(r.id))};
 });
 const after=Math.max(...approvals.map(a=>a.index));
 const ji=starts(c,'review-foundation').find(i=>i>after);assert.ok(Number.isInteger(ji),'initial rejection missing');
 // The first later scoped review must be the authenticated rejection, never
 // an arbitrarily caller-chosen earlier checkpoint.
 const j0=review(root,c,ji);assert.equal(j0.att.verdict,'REQUEST_CHANGES','initial review is not rejection');assert.equal(j0.candidate.activeBatchId,s.batchId);assert.equal(j0.candidate.planText,s.planText,'initial rejection plan mismatch');
 const refreshed=JSON.stringify(j0.candidate.members.slice(0,-1).map(x=>x.runId))!==JSON.stringify(s.predecessors.map(x=>x.runId));
 assert.ok(!j0.candidate.recovery,'initial rejection cannot be descendant');
 const ordinaryRefresh=refreshed?ordinaryOrigin(root,c,s,approvals,j0,initializer):null;
 for(const a of approvals)for(const i of starts(c,'review-foundation').filter(i=>i>a.index&&i<ji)){const other=occurrence(c,i,'enterprise-batch-attestation','enterprise-batch-reviewer');assert.ok(!bs.some(b=>b.id===other.att.batchId),'approval already superseded');}
 const fixed={schemaVersion:1,identity:{runSlug:c.identity.runSlug,workflowRef:c.identity.workflowRef,bundleDigest:c.identity.bundleDigest},activeBatchId:s.batchId,selectionPath:p.entrySelection,selectionRaw,selectionSha256:hash(selectionRaw),planText:s.planText,topology:topology(bs),originalAC:op.issues.filter(x=>bs.some(b=>b.issueIds.includes(x.id))).map(x=>({id:x.id,originalAcceptance:x.originalAcceptance,acceptanceTests:x.acceptanceTests})),approvals,initialRejection:{index:ji,raw:j0.raw,reportSha256:j0.reportSha256,candidatePath:j0.att.candidatePath,candidateSha256:j0.att.candidateSha256}};
 if(ordinaryRefresh){fixed.schemaVersion=2;fixed.ordinaryRefresh=ordinaryRefresh;}
 return {fixed,rootId:hash(encode(fixed)),j0,oldPlan:op};
}
function lockAvailable(root,c){const path=confined(root,'evidence/enterprise/gate.lock');if(!existsSync(path))return;let l;try{l=JSON.parse(readFileSync(path));}catch{throw Error('gate writer active or unknown');}assert.equal(l.kind,'enterprise-run-initialization');assert.equal(l.runSlug,c.identity.runSlug);assert.ok(Number.isInteger(l.pid)&&l.pid>0);try{process.kill(l.pid,0);throw Error('gate writer active');}catch(e){if(e.code!=='ESRCH')throw e;}}
const names=(root,p)=>existsSync(confined(root,p))?readdirSync(confined(root,p)).filter(n=>!n.endsWith('.tmp')).sort():[];
function candidateRecovery(a){
 const common={rootId:a.h.rootId,attemptId:a.h.attemptId,headerPath:a.header.path,headerSha256:a.header.sha256};
 return a.h.schemaVersion===2?{schemaVersion:2,...common,authority:a.h.authority}:{...common,parentRejectionReportSha256:a.h.parent.reportSha256};
}
function expectedRecovery(a){const {headerPath,...r}=candidateRecovery(a);return {...r,resultPath:a.result.path,resultSha256:a.result.sha256};}
function reviewTarget(j,a){
 assert.equal(a.r?.status,'passed','review requires successful terminal');
 assert.equal(j.att.candidatePath,a.r.candidate.candidatePath);assert.equal(j.att.candidateSha256,a.r.candidate.candidateSha256);assert.ok(Date.parse(j.start.timestamp)>=Date.parse(a.r.finishedAt),'review before terminal result');
}
function reviewBinding(j,a){
 reviewTarget(j,a);assert.deepEqual(j.att.recovery,expectedRecovery(a),'review recovery binding');
}
const reviewRef=j=>({index:j.index,reportSha256:j.reportSha256,candidatePath:j.att.candidatePath,candidateSha256:j.att.candidateSha256});
function occurrenceRef(j){const a=j.att;return {runSlug:a.runSlug,workflowRef:a.workflowRef,iteration:a.iteration,step:a.step,sessionKey:a.sessionKey,providerSessionId:a.providerSessionId,startIndex:j.index,phases:[{phase:1,contentSha256:hash(j.phase1)},{phase:2,contentSha256:j.reportSha256}],reportSha256:j.reportSha256};}
function absentPath(root,path){
 assert.ok(typeof path==='string'&&path.length&&!path.includes('\\')&&!path.startsWith('/')&&path.split('/').every(p=>p&&p!=='.'&&p!=='..'),'invalid recovery path');
 confined(root,path);let p=root;
 for(const part of path.split('/')){p+='/'+part;try{assert.ok(!lstatSync(p).isSymbolicLink(),'recovery path symlink');}catch(e){if(e.code!=='ENOENT')throw e;}}
 assert.ok(!existsSync(confined(root,path)),'invalid recovery path exists');
}
// This order authenticates an invalid APPROVE without ever repairing it into
// an importable report. The same transition is checked by every history reader.
function revalidation(root,c,j,a,d,contractHash){
 reviewTarget(j,a);assert.equal(j.att.verdict,'APPROVE');
 const expected=expectedRecovery(a),actual=j.att.recovery;
 assert.ok(actual&&actual.resultPath!==expected.resultPath,'valid approval ends regeneration');
 assert.deepEqual({...actual,resultPath:expected.resultPath},expected,'review defect exceeds resultPath');
 absentPath(root,actual.resultPath);
 assert.equal(d.att.schemaVersion,2,'explicit revalidation order required');assert.ok(d.index>j.end-1,'design must follow completed invalid review');
 assert.equal(starts(c,'review-foundation').filter(i=>i<d.index).at(-1),j.index,'order skips a later review');
 assert.notEqual(d.att.providerSessionId,j.att.providerSessionId,'independent design and batch sessions required');
 const r={purpose:'REVALIDATE_INVALID_REVIEW_ONLY',contractPath:revalidationContract,contractSha256:contractHash,invalidReview:occurrenceRef(j),rootId:a.h.rootId,candidatePath:j.att.candidatePath,candidateSha256:j.att.candidateSha256,invalidRecovery:actual,expectedRecovery:expected,allowedDifference:'/recovery/resultPath',disposition:'KEEP_INVALID_REVIEW_AND_RERUN_FULL_PREFIX'};
 assert.match(contractHash??'',/^[a-f0-9]{64}$/,'revalidation contract missing');assert.deepEqual(d.att.revalidation,r,'revalidation order binding');
 assert.deepEqual(read(root,a.result.path.replace('result.json','published.json')),{sequence:a.h.sequence,header:a.header,result:a.result},'invalid review publication missing');
 return {kind:'DESIGN_REVALIDATION_ORDER',design:occurrenceRef(d),invalidReview:{...occurrenceRef(j),candidatePath:j.att.candidatePath,candidateSha256:j.att.candidateSha256},reviewedTerminal:a.result,invalidRecovery:actual,expectedRecovery:expected};
}
function authority(root,c,j,reviewed,d,contractHash){
 if(j.att.verdict==='REQUEST_CHANGES')return {kind:'SCOPED_REJECTION',review:reviewRef(j)};
 return revalidation(root,c,j,reviewed,d,contractHash);
}
// Read the entire chain; neither head nor a caller-selected report is authority.
function chain(root,c,boot,{acceptance=null}={}){
 const dir=`${base}/${boot.rootId}`,index=read(root,indexPath),found=names(root,base);
 for(const id of found){const f=read(root,`${base}/${id}/root.json`);assert.equal(id,hash(bytes(root,`${base}/${id}/root.json`)),'root digest mismatch');if(f.identity.runSlug===c.identity.runSlug&&f.selectionSha256===boot.fixed.selectionSha256)assert.equal(id,boot.rootId,'forked recovery root');}
 if(!existsSync(confined(root,dir))){assert.ok(starts(c,'review-foundation').at(-1)===boot.j0.index,'descendant recovery root missing');for(const m of boot.j0.candidate.members)assert.equal(index.runs.filter(e=>e.batchId===m.batchId).at(-1)?.id,m.runId,'unrecorded receipt before recovery root');return {dir,attempts:[],index};}
 assert.deepEqual(read(root,dir+'/root.json'),boot.fixed,'changed recovery root');
 const paths=names(root,dir+'/attempts'),attempts=paths.map(id=>{const path=`${dir}/attempts/${id}/header.json`,header=ref(root,path),h=read(root,path);assert.equal(h.attemptId,id);return {header,h};}).sort((a,b)=>a.h.sequence-b.h.sequence);
 const js=names(root,dir+'/journal');assert.ok(js.length<=attempts.length,'orphan journal');let parent=boot.j0,reviewed=null,prev=null,expectedIndex;
 for(const [n,a] of attempts.entries()){
  const {h}=a;assert.equal(h.sequence,n+1,'attempt sequence missing or forked');assert.equal(h.rootId,boot.rootId);assert.deepEqual(h.previous,prev,'terminal chain changed');
  const candidates=starts(c,'review-foundation').filter(i=>i>parent.index&&i<h.builder.startIndex);
  if(candidates.length){assert.equal(candidates.length,1,'unknown or skipped review');assert.ok(n>0&&attempts[n-1].r?.status==='passed','review without successful terminal');const j=review(root,c,candidates[0]);reviewTarget(j,attempts[n-1]);if(j.att.verdict==='REQUEST_CHANGES')reviewBinding(j,attempts[n-1]);parent=j;reviewed=attempts[n-1];}
  const di=starts(c,'review-architecture').filter(i=>i<h.builder.startIndex).at(-1),d=design(c,di,h.planText,h.contractSha256);assert.deepEqual(h.design,{index:di,reportSha256:d.reportSha256},'attempt design binding');
  assert.ok(h.schemaVersion===1||h.schemaVersion===2,'attempt schema');
  if(h.schemaVersion===1){assert.equal(parent.att.verdict,'REQUEST_CHANGES','approval ends regeneration');assert.ok(!('authority' in h));assert.deepEqual(h.parent,reviewRef(parent),'old rejection replay');}
  else {assert.ok(!('parent' in h),'typed authority cannot claim rejection parent');assert.deepEqual(h.authority,authority(root,c,parent,reviewed,d,h.inputs.entries.find(e=>e.path===revalidationContract)?.sha256),'attempt authority binding');}
  assert.equal(bytes(root,`${dir}/reports/${d.reportSha256}.md`).toString(),d.raw,'changed archived design');assert.equal(bytes(root,`${dir}/reports/${parent.reportSha256}.md`).toString(),parent.raw,'changed archived rejection');
  const s=c.records[h.builder.startIndex];assert.ok(s?.type==='step_start'&&s.step==='build-foundation');assert.deepEqual(h.builder.start,s,'builder occurrence mismatch');assert.equal(s.model,'gpt-6-astra');assert.equal(s.providerOptions?.codex?.reasoningEffort,'high');
  const session=resolvePersonaSessionId(c.sessions,JSON.stringify(['enterprise-builder',s.provider,s.model]),s.provider);assert.ok(session);assert.equal(h.builder.session,session);assert.ok(Date.parse(h.startedAt)>=Date.parse(s.timestamp));
  const plan=JSON.parse(h.planText);retained(boot.oldPlan,plan,boot.fixed.activeBatchId);if(n)retained(JSON.parse(attempts[n-1].h.planText),plan,boot.fixed.activeBatchId);
  assert.equal(h.inputs.entries.find(e=>e.path==='work/enterprise/plan.json')?.sha256,hash(h.planText));assert.equal(h.inputs.entries.find(e=>e.path===contractPath)?.sha256,h.contractSha256);
  assert.deepEqual(h.suites,prefix(plan,boot.fixed.activeBatchId).map(b=>({batchId:b.id,suites:suitesFor(plan,b.issueIds)})));
  if(expectedIndex)assert.deepEqual(h.indexPrefix,expectedIndex,'attempt index discontinuity');else assert.deepEqual(index.runs.slice(0,h.indexPrefix.length),h.indexPrefix,'old index changed');
  const storedResult=`${dir}/attempts/${h.attemptId}/result.json`,boundEnd=acceptance&&n===attempts.length-1&&existsSync(confined(root,storedResult))?h.indexPrefix.length+read(root,storedResult).receipts.length:index.runs.length;
  const next=attempts[n+1]?.h.indexPrefix.length??boundEnd,entries=index.runs.slice(h.indexPrefix.length,next);a.entries=entries;
  assert.ok(entries.length<=h.suites.length,'unrecorded or forked receipt');
  for(const [k,e] of entries.entries()){const r=read(root,e.path);assert.equal(e.path,receipt(e.id));assert.equal(e.batchId,h.suites[k].batchId);assert.equal(r.id,e.id);assert.equal(r.batchId,e.batchId);assert.equal(r.implementationSession,session);assert.deepEqual(r.inputs,h.inputs);assert.ok(Date.parse(r.startedAt)>=Date.parse(h.startedAt));}
  const rp=`${dir}/attempts/${h.attemptId}/result.json`;a.result=existsSync(confined(root,rp))?ref(root,rp):null;
  if(a.result){const r=read(root,rp);a.r=r;for(const e of entries)for(const suite of read(root,e.path).suites){assert.equal(hash(bytes(root,suite.stdout)),suite.stdoutHash,'changed retained stdout');assert.equal(hash(bytes(root,suite.stderr)),suite.stderrHash,'changed retained stderr');assert.deepEqual(snapshot(root,[suite.outputDirectory]),suite.outputs,'changed retained output');}assert.equal(r.headerSha256,a.header.sha256,'changed recovery header');assert.equal(r.startedAt,h.startedAt);assert.ok(['passed','failed'].includes(r.status));assert.deepEqual(r.receipts,entries.map(e=>({...ref(root,e.path),runId:e.id,outputsDigest:hash(JSON.stringify(read(root,e.path).suites.map(s=>s.outputs)))})),'terminal receipts changed');
   if(r.status==='passed'){assert.equal(r.exitCode,0);assert.equal(r.signal,null);assert.equal(entries.length,h.suites.length);const v=validateCandidate(root,r.candidate);assert.deepEqual(v.candidate.recovery,candidateRecovery(a));assert.deepEqual(v.candidate.inputs,h.inputs);assert.deepEqual(v.candidate.members.map(m=>m.runId),entries.map(e=>e.id));assert.ok(v.runs.every(run=>Date.parse(run.finishedAt)<=Date.parse(r.finishedAt)));}
   else assert.ok(!r.candidate,'failed candidate forbidden');
   const published=`${dir}/attempts/${h.attemptId}/published.json`;if(existsSync(confined(root,published)))assert.deepEqual(read(root,published),{sequence:h.sequence,header:a.header,result:a.result},'changed publication checkpoint');
   const jp=`${dir}/journal/${String(h.sequence).padStart(6,'0')}.json`;if(existsSync(confined(root,jp)))assert.deepEqual(read(root,jp),{sequence:h.sequence,header:a.header,result:a.result});else {assert.equal(n,attempts.length-1,'missing terminal journal');assert.ok(!existsSync(confined(root,`${dir}/attempts/${h.attemptId}/published.json`)),'published journal removed');}prev=a.result;
  }else assert.equal(n,attempts.length-1,'unterminated previous attempt');
  expectedIndex=[...h.indexPrefix,...entries];
 }
 if(acceptance)assert.deepEqual(index.runs.slice(0,expectedIndex?.length??index.runs.length),expectedIndex??index.runs);else assert.deepEqual(index.runs,expectedIndex??index.runs);
 const hp=dir+'/head.json',last=attempts.at(-1),lastJournal=js.at(-1);
 if(lastJournal){const expected=read(root,dir+'/journal/'+lastJournal);assert.ok(existsSync(confined(root,hp))||(last?.result&&last.h.sequence===1&&!existsSync(confined(root,`${dir}/attempts/${last.h.attemptId}/published.json`))),'missing head');if(existsSync(confined(root,hp))){const head=read(root,hp);if(JSON.stringify(head)!==JSON.stringify(expected)){assert.ok(last?.result&&expected.sequence===last.h.sequence&&head.sequence===expected.sequence-1&&!existsSync(confined(root,`${dir}/attempts/${last.h.attemptId}/published.json`)),'old head replay');assert.deepEqual(head,read(root,`${dir}/journal/${String(head.sequence).padStart(6,'0')}.json`));}}}
 else assert.ok(!existsSync(confined(root,hp)),'orphan head');
 // A missing last journal is a recoverable publication only if its immutable
 // result is unique. Earlier journal holes cannot be repaired from a stale head.
 assert.equal(js.length,attempts.filter(a=>a.result).length-(last?.result&&!existsSync(confined(root,`${dir}/journal/${String(last.h.sequence).padStart(6,'0')}.json`))?1:0),'journal missing');
 const later=starts(c,'review-foundation').filter(i=>i>parent.index);
 if(!acceptance)assert.ok(later.length<=1,'skipped latest review');let latest=parent,bridge=null;
 if(later.length){assert.ok(last?.r?.status==='passed','latest review has no terminal');latest=review(root,c,later[0],!acceptance||later.length===1);reviewed=last;assert.ok(existsSync(confined(root,`${dir}/attempts/${last.h.attemptId}/published.json`)),'reviewed publication checkpoint missing');reviewTarget(latest,last);}else review(root,c,parent.index,true);
 if(acceptance){assert.equal(latest.att.verdict,'APPROVE','current exact approval required');assert.deepEqual(latest.att,acceptance,'approval differs from terminal occurrence');reviewBinding(latest,last);}
 else if(latest.att.verdict==='APPROVE'&&!isDeepStrictEqual(latest.att.recovery,expectedRecovery(reviewed))){
  const di=starts(c,'review-architecture').at(-1),d=design(c,di,bytes(root,'work/enterprise/plan.json').toString(),hash(bytes(root,contractPath)),true);
  bridge=revalidation(root,c,latest,reviewed,d,hash(bytes(root,revalidationContract)));
 }else if(reviewed)reviewBinding(latest,reviewed);
 if(acceptance&&index.runs.length>(expectedIndex?.length??index.runs.length)){assert.equal(latest.att.verdict,'APPROVE','later receipts without approval');for(const e of index.runs.slice(expectedIndex.length)){const r=read(root,e.path);assert.equal(e.path,receipt(e.id));assert.equal(r.id,e.id);assert.equal(r.batchId,e.batchId);assert.ok(Date.parse(r.startedAt)>=Date.parse(latest.start.timestamp),'receipt before approval');}}
 return {dir,attempts,index,latest,reviewed,bridge};
}
function snapshotState(root,c,p,boot){return {inputs:inputs(root),planText:bytes(root,'work/enterprise/plan.json').toString(),contractSha256:hash(bytes(root,contractPath)),progress:bytes(root,progressPath).toString(),index:bytes(root,indexPath).toString(),selection:bytes(root,p.entrySelection).toString(),protected:snapshot(root,(read(root,'work/enterprise/plan.json').protectedFiles??[]).map(x=>x.path)),context:c};}
async function prepare(root){
 const c=await currentContext(root);assert.equal(c.step,'build-foundation');assert.equal(c.sessionKey,'enterprise-builder');assert.equal(c.stepDefinition.edit,true);assert.equal(c.start.provider,'codex');assert.equal(c.start.model,'gpt-6-astra','recovery builder Astra required');assert.equal(c.start.providerOptions?.codex?.reasoningEffort,'high');
 const p=read(root,progressPath),plan=read(root,'work/enterprise/plan.json');validatePlan(root,plan,read(root,'work/enterprise/backlog.json'));
 for(const f of plan.protectedFiles??[])assert.equal(hash(bytes(root,f.path)),f.sha256,'protected bytes changed');
 const d=design(c,starts(c,'review-architecture').at(-1),bytes(root,'work/enterprise/plan.json').toString(),hash(bytes(root,contractPath)),true);
 const boot=bootstrap(root,c,p);retained(boot.oldPlan,plan,p.activeBatchId);const ch=chain(root,c,boot),latest=ch.latest??review(root,c,boot.j0.index,true);assert.ok(latest.att.verdict==='REQUEST_CHANGES'||ch.bridge,'latest approval ends regeneration');assert.ok(d.index<c.records.lastIndexOf(c.start),'design must precede builder');
 if(ch.attempts.length)retained(JSON.parse(ch.attempts.at(-1).h.planText),plan,p.activeBatchId);
 lockAvailable(root,c);const state=snapshotState(root,c,p,boot);assert.deepEqual(await currentContext(root),c,'concurrent recovery authority');const auth=authority(root,c,latest,ch.reviewed,d,latest.att.verdict==='APPROVE'?hash(bytes(root,revalidationContract)):null);return {c,p,plan,d,boot,ch,latest,state,auth};
}
async function stable(root,x,{after=false}={}){
 assert.deepEqual(await currentContext(root),x.c,'concurrent recovery authority');assert.deepEqual(bootstrap(root,x.c,x.p).fixed,x.boot.fixed,'concurrent original authority');assert.equal(design(x.c,x.d.index,x.state.planText,x.state.contractSha256,true).reportSha256,x.d.reportSha256);assert.deepEqual(inputs(root),x.state.inputs,'concurrent recovery inputs');assert.equal(bytes(root,progressPath).toString(),x.state.progress,'concurrent recovery progress');assert.equal(bytes(root,x.p.entrySelection).toString(),x.state.selection);assert.deepEqual(snapshot(root,(x.plan.protectedFiles??[]).map(x=>x.path)),x.state.protected,'protected files changed');
 if(!after)assert.equal(bytes(root,indexPath).toString(),x.state.index,'concurrent recovery index');else assert.deepEqual(read(root,indexPath).runs.slice(0,x.ch.index.runs.length),x.ch.index.runs,'old index changed');
}
function terminal(root,dir,a){const entry={sequence:a.h.sequence,header:a.header,result:a.result};immutable(root,`${dir}/journal/${String(a.h.sequence).padStart(6,'0')}.json`,encode(entry));atomic(root,dir+'/head.json',encode(entry));immutable(root,`${dir}/attempts/${a.h.attemptId}/published.json`,encode(entry));}
function output(boot,a){return {status:'MACHINE_EVIDENCE_REGENERATED_REVIEW_REQUIRED',rootId:boot.rootId,attemptId:a.h.attemptId,resultPath:a.result.path,resultSha256:a.result.sha256,...a.r.candidate};}
export async function regenerateRejected(root){
 const x=await prepare(root),{c,p,plan,d,boot,ch,latest}=x,last=ch.attempts.at(-1);
 // Repeated frozen post-report gates keep the exact reviewed identity.
 if(last?.r?.status==='passed'&&JSON.stringify(last.h.schemaVersion===2?last.h.authority:{kind:'SCOPED_REJECTION',review:last.h.parent})===JSON.stringify(x.auth)&&last.h.inputs.digest===x.state.inputs.digest&&last.h.design.reportSha256===d.reportSha256){
  validateCandidate(root,last.r.candidate,{current:true});await stable(root,x);const hp=ch.dir+'/head.json';if(existsSync(confined(root,hp))&&read(root,hp).result?.sha256===last.result.sha256&&existsSync(confined(root,`${ch.dir}/attempts/${last.h.attemptId}/published.json`)))return output(boot,last);
 }
 const unlock=acquire(root,c);
 try{
  await stable(root,x);const fresh=chain(root,c,boot);assert.deepEqual(fresh,ch,'concurrent recovery chain');immutable(root,ch.dir+'/root.json',encode(boot.fixed));
  if(last?.result)terminal(root,ch.dir,last);
  if(last&&!last.result){
   const resultPath=`${ch.dir}/attempts/${last.h.attemptId}/result.json`,r={headerSha256:last.header.sha256,status:'failed',error:'interrupted process',exitCode:null,signal:'INTERRUPTED',startedAt:last.h.startedAt,finishedAt:new Date().toISOString(),receipts:last.entries.map(e=>({...ref(root,e.path),runId:e.id,outputsDigest:hash(JSON.stringify(read(root,e.path).suites.map(s=>s.outputs)))}))};immutable(root,resultPath,encode(r));last.result=ref(root,resultPath);last.r=r;terminal(root,ch.dir,last);
  }
  if(last?.r?.status==='passed'&&JSON.stringify(last.h.schemaVersion===2?last.h.authority:{kind:'SCOPED_REJECTION',review:last.h.parent})===JSON.stringify(x.auth)&&last.h.inputs.digest===x.state.inputs.digest&&last.h.design.reportSha256===d.reportSha256)return output(boot,last);
  const attemptId=randomUUID(),headerPath=`${ch.dir}/attempts/${attemptId}/header.json`;
  const h={schemaVersion:2,attemptId,sequence:ch.attempts.length+1,rootId:boot.rootId,previous:last?.result??null,authority:x.auth,design:{index:d.index,reportSha256:d.reportSha256},contractSha256:x.state.contractSha256,planText:x.state.planText,inputs:x.state.inputs,suites:prefix(plan,p.activeBatchId).map(b=>({batchId:b.id,suites:suitesFor(plan,b.issueIds)})),indexPrefix:read(root,indexPath).runs,builder:{startIndex:c.records.lastIndexOf(c.start),start:c.start,session:c.providerSessionId},startedAt:new Date().toISOString()};
  immutable(root,`${ch.dir}/reports/${latest.reportSha256}.md`,Buffer.from(latest.raw));immutable(root,`${ch.dir}/reports/${d.reportSha256}.md`,Buffer.from(d.raw));immutable(root,headerPath,encode(h));const a={h,header:ref(root,headerPath)};let candidate,error;
  try{for(const b of h.suites)execute(root,b.batchId,b.suites,c.providerSessionId);await stable(root,x,{after:true});chain(root,c,boot);candidate=createClosureCandidate(root,plan,p.activeBatchId,candidateRecovery(a));await stable(root,x,{after:true});}catch(e){error=e;}
  const entries=read(root,indexPath).runs.slice(h.indexPrefix.length),r={headerSha256:a.header.sha256,status:error?'failed':'passed',startedAt:h.startedAt,finishedAt:new Date().toISOString(),exitCode:error?1:0,signal:null,receipts:entries.map(e=>({...ref(root,e.path),runId:e.id,outputsDigest:hash(JSON.stringify(read(root,e.path).suites.map(s=>s.outputs)))})),...(error?{error:error.message}:{candidate})};
  const resultPath=`${ch.dir}/attempts/${attemptId}/result.json`;immutable(root,resultPath,encode(r));a.result=ref(root,resultPath);a.r=r;terminal(root,ch.dir,a);if(error)throw error;return output(boot,a);
 }finally{unlock();}
}
// Acceptance authenticates history after APPROVE; it does not require a current
// rejection or grant permission to run again. Existing closure checks still run.
function recoveredHistory(root,att,candidate,context){
 const p=read(root,progressPath),fixed=read(root,`${base}/${candidate.recovery.rootId}/root.json`),selection=JSON.parse(fixed.selectionRaw),boot=bootstrap(root,context,{...p,activeBatchId:candidate.activeBatchId,entrySelection:fixed.selectionPath,entrySelectionHash:fixed.selectionSha256,entryInputs:selection.inputsDigest}),ch=chain(root,context,boot,{acceptance:att}),last=ch.attempts.at(-1);
 assert.ok(last?.r?.status==='passed','recovery terminal missing');reviewBinding(ch.latest,last);assert.deepEqual(validateCandidate(root,last.r.candidate).candidate,candidate);return ch;
}
export async function validateRecoveryApproval(root,att,candidate,context){
 const ch=recoveredHistory(root,att,candidate,context);
 // The first exact APPROVE closes this chain. Later occurrences belong to the
 // ordinary member-scoped supersession checks, not regeneration permission.
 // Authenticate them before trusting their scope, including an unfinished start.
 const later=starts(context,'review-foundation').filter(i=>i>ch.latest.index);
 for(const i of later){
  const j=occurrence(context,i,'enterprise-batch-attestation','enterprise-batch-reviewer',i===later.at(-1)),a=j.att;
  if(j.raw.includes('```enterprise-closure-attestation')){review(root,context,i,i===later.at(-1));continue;}
  const plan=JSON.parse(candidate.planText),b=plan.batches.find(b=>b.id===a.batchId);assert.ok(b,'later review scope unavailable');
  assert.ok(['APPROVE','REQUEST_CHANGES'].includes(a.verdict),'unknown review verdict');
  assert.deepEqual([...a.approvedIssueIds].sort(),a.verdict==='APPROVE'?[...b.issueIds].sort():[],'later review Issue scope');
  assert.ok(Array.isArray(a.unresolvedFindings)&&(a.verdict==='APPROVE'?a.unresolvedFindings.length===0:a.unresolvedFindings.length>0),'later review findings');
  const raw=bytes(root,receipt(a.runId)),r=JSON.parse(raw);assert.equal(r.id,a.runId);assert.equal(r.batchId,a.batchId);assert.equal(a.receiptSha256,hash(raw),'later review receipt bytes');assert.equal(a.receiptHash,hash(JSON.stringify(r)));assert.equal(a.outputsDigest,hash(JSON.stringify(r.suites.map(s=>s.outputs))));assert.equal(a.inputsDigest,r.inputs.digest);
  assert.notEqual(r.implementationSession,a.providerSessionId);assert.ok(Date.parse(j.start.timestamp)>=Date.parse(r.finishedAt),'later review before receipt');
 }
 return true;
}

export function revalidationInitializationHistory(root,context,progress,raw){
 if(!raw.includes('```enterprise-closure-attestation'))return null;
 const att=closureAttestation(raw);if(!att.recovery)return null;
 const boot=bootstrap(root,context,progress),ch=chain(root,context,boot);
 return ch.bridge?rejectedInitializationHistory(root,context,progress):null;
}

// Only the new-run initializer consumes this history index. It authenticates a
// completed rejection, never an approval or permission to execute an old run.
export function rejectedInitializationHistory(root,context,progress,current){
 const initializer=current?args=>initializerSnapshots(args,current):undefined;
 const boot=bootstrap(root,context,progress,initializer),ch=chain(root,context,boot);
 const ordinary=boot.fixed.ordinaryRefresh?.initializerHistory;
 if(ordinary){assert.equal(ch.attempts.length,0,'initializer history cannot authorize recovery');assert.ok(!boot.j0.candidate.recovery);}

 const latest=ch.latest??review(root,context,boot.j0.index,true);
 assert.ok(latest.att.verdict==='REQUEST_CHANGES'||ch.bridge,'initialization rejection required');
 assert.equal(latest.index,starts(context,'review-foundation').at(-1),'latest rejection required');
 // The review binds its passed attempt, not a later unsuccessful execution.
 // This projection is private to initialization; current approval paths above
 // continue to require the exact successful terminal and current inputs.
 const reviewed=latest.att.recovery?ch.attempts.find(a=>a.h.attemptId===latest.att.recovery.attemptId):null;
 if(reviewed){assert.equal(reviewed.r?.status,'passed','reviewed terminal required');if(!ch.bridge)reviewBinding(latest,reviewed);}
 else assert.equal(latest.index,boot.j0.index,'reviewed attempt missing');
 const tail=ch.attempts.slice(reviewed?ch.attempts.indexOf(reviewed)+1:0);
 for(const a of ch.attempts){
  assert.ok(a.result&&a.r,'unterminated history attempt');
  const entry={sequence:a.h.sequence,header:a.header,result:a.result};
  assert.deepEqual(read(root,`${ch.dir}/journal/${String(a.h.sequence).padStart(6,'0')}.json`),entry,'history journal incomplete');
  assert.deepEqual(read(root,`${ch.dir}/attempts/${a.h.attemptId}/published.json`),entry,'history publication incomplete');
 }
 const last=ch.attempts.at(-1);
 if(last)assert.deepEqual(read(root,ch.dir+'/head.json'),{sequence:last.h.sequence,header:last.header,result:last.result},'history head incomplete');
 for(const a of tail){
  assert.equal(a.r.status,'failed','unreviewed successful tail');assert.ok(!a.r.candidate,'failed candidate forbidden');
  if(a.h.schemaVersion===1)assert.deepEqual(a.h.parent,reviewRef(latest),'failed tail parent');else assert.equal(a.h.authority.kind==='SCOPED_REJECTION'?a.h.authority.review.reportSha256:a.h.authority.invalidReview.reportSha256,latest.reportSha256,'failed tail authority');
  assert.ok(a.r.exitCode!==0&&(Number.isInteger(a.r.exitCode)||a.r.signal),'failed terminal execution required');
  assert.ok(typeof a.r.error==='string'&&a.r.error.length,'failed terminal diagnosis required');
  assert.ok(Date.parse(a.r.finishedAt)>=Date.parse(a.h.startedAt),'failed terminal timestamps');
  const manifest=a.h.inputs;
  assert.equal(manifest.digest,hash(JSON.stringify(manifest.runtime?{entries:manifest.entries,runtime:manifest.runtime}:manifest.entries)),'failed input manifest digest');
  assert.equal(new Set(manifest.entries.map(e=>e.path)).size,manifest.entries.length,'duplicate failed input');
  for(const e of manifest.entries){confined(root,e.path);assert.match(e.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isInteger(e.bytes)&&e.bytes>=0);}
  for(const [n,e] of a.entries.entries()){
   const run=read(root,e.path),definitions=a.h.suites[n].suites;
   assert.ok(['passed','failed'].includes(run.status),'running historical receipt');
   assert.ok(Date.parse(run.finishedAt)>=Date.parse(run.startedAt)&&Date.parse(run.finishedAt)<=Date.parse(a.r.finishedAt),'failed receipt timestamps');
   if(run.status==='passed'){validateRunEvidence(root,run,definitions);continue;}
   assert.equal(n,a.entries.length-1,'receipts after failed run');assert.ok(run.error,'failed receipt diagnosis required');
   assert.ok(run.suites.length<=definitions.length,'failed receipt suite prefix');
   for(const [k,s] of run.suites.entries()){
    const d=definitions[k];assert.equal(s.id,d.id,'failed suite order');assert.equal(s.definitionHash,hash(JSON.stringify(d)),'failed suite definition');assert.deepEqual(s.argv,d.command,'failed suite argv');
    assert.ok(s.cwd&&s.runtime?.node&&s.runtime?.executable,'failed execution metadata');assert.ok(Date.parse(s.startedAt)>=Date.parse(run.startedAt)&&Date.parse(s.finishedAt)>=Date.parse(s.startedAt)&&Date.parse(s.finishedAt)<=Date.parse(run.finishedAt),'failed suite timestamps');
    assert.ok(s.exitCode===null||Number.isInteger(s.exitCode),'failed suite exit');assert.ok(s.signal===null||typeof s.signal==='string','failed suite signal');assert.match(s.inputsAfter,/^[a-f0-9]{64}$/);
    // Only completed successes have TAP success summaries. Partial TAP is
    // retained verbatim and never synthesized into a successful assertion set.
    if(k<run.suites.length-1||s.tap){assert.equal(s.exitCode,0);assert.equal(s.signal,null);assert.ok(!s.error);assert.equal(s.inputsAfter,run.inputs.digest);assert.deepEqual(parseTap(bytes(root,s.stdout).toString(),d.requiredAssertions),s.tap);}
   }
  }
 }
 const describe=a=>({attemptId:a.h.attemptId,sequence:a.h.sequence,header:a.header,result:a.result,status:a.r.status,receipts:a.r.receipts});
 const references=new Set([indexPath,progress.entrySelection,boot.j0.att.candidatePath,latest.att.candidatePath]);
 const roots=new Set(),candidates=new Set();
 function retainCandidate(path){
  if(candidates.has(path))return;candidates.add(path);references.add(path);
  const c=read(root,path);if(c.recovery)retainRoot(c.recovery.rootId);
 }
 function retainSelection(s){for(const p of s.predecessors){references.add(p.approval.report);if(p.approval.closure)retainCandidate(p.approval.closure.candidatePath);}}
 function retainRoot(id){
  if(roots.has(id))return;roots.add(id);const dir=`${base}/${id}`;
  for(const e of snapshot(root,[dir]).entries)references.add(e.path);
  const fixed=read(root,dir+'/root.json');retainOrdinary(fixed);references.add(fixed.selectionPath);retainSelection(JSON.parse(fixed.selectionRaw));retainCandidate(fixed.initialRejection.candidatePath);
  for(const a of names(root,dir+'/attempts')){const result=read(root,`${dir}/attempts/${a}/result.json`);if(result.candidate)retainCandidate(result.candidate.candidatePath);}
 }
 function retainOrdinary(fixed){if(fixed.ordinaryRefresh){retainCandidate(fixed.ordinaryRefresh.reported.candidatePath);for(const e of fixed.ordinaryRefresh.references)references.add(e.path);}}
 retainOrdinary(boot.fixed);retainSelection(JSON.parse(boot.fixed.selectionRaw));retainCandidate(boot.j0.att.candidatePath);retainCandidate(latest.att.candidatePath);
 if(existsSync(confined(root,ch.dir)))retainRoot(boot.rootId);
 // Preserve all indexed receipts, including failed/partial ones, with their
 // output manifests. Outputs stay in place and are checked before projection.
 const outputRoots=new Set();
 for(const e of ch.index.runs){
  assert.equal(e.path,receipt(e.id),'historical receipt path');const r=read(root,e.path);assert.equal(r.id,e.id);assert.equal(r.batchId,e.batchId);references.add(e.path);
  for(const s of r.suites){
   assert.equal(hash(bytes(root,s.stdout)),s.stdoutHash,'changed historical stdout');assert.equal(hash(bytes(root,s.stderr)),s.stderrHash,'changed historical stderr');
   assert.deepEqual(snapshot(root,[s.outputDirectory]),s.outputs,'changed historical outputs');outputRoots.add(s.outputDirectory);
  }
 }
 const outputs=snapshot(root,[...outputRoots]);
 // Failed-tail and version-2 ordinary initialization archive all historical
 // output bytes, including earlier recovery roots, before the new projection.
 if(tail.length||ordinary)for(const e of outputs.entries)references.add(e.path);
 return {...(ordinary?{schemaVersion:2,ordinaryHistory:boot.fixed.ordinaryRefresh}:{}),historyOnly:true,currentApprovals:[],rootId:boot.rootId,attemptCount:ch.attempts.length,
  reviewedAttempt:reviewed?describe(reviewed):null,failedTail:tail.map(describe),latestIndex:ch.index.runs,
  latest:latest.att,...(ch.bridge?{revalidation:ch.bridge,revalidationReports:{invalidReview:latest.raw,design:occurrence(context,ch.bridge.design.startIndex,'enterprise-recovery-design-attestation','enterprise-architecture-reviewer').raw}}:{}),planSha256:hash(latest.candidate.planText),references:[...references].sort(),outputs};
}
