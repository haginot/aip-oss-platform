import {controlAudit,controlHistory} from './control-audit.mjs';
import {sourcePolicy,recordInformation} from './information-policy.mjs';
import {randomUUID} from 'node:crypto';
import {exact,fail,digest} from '../contracts.mjs';
import {id,scope as validScope} from './contracts.mjs';
import {authorize,authority,authorized,project} from './security.mjs';
import {governance} from './governance.mjs';
import {ProposalPort} from './proposals.mjs';
export const controlPermissions={informationCreate:'action',informationDerive:'action',controlRead:'read',controlList:'search',controlAudit:'audit',rightGrant:'records',rightRevoke:'records',rightCheck:'read',releaseCreate:'action',releaseApprove:'approve',releaseWithdraw:'action',journeyCreate:'action',handoffOffer:'action',handoffAccept:'approve',handoffReject:'approve',journeyCancel:'action',handoffCompensateApprove:'approve'};
export const controlReads=['controlRead','controlList','controlAudit','rightCheck'];
const labels=['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT'],fieldLabel=x=>x==='RESTRICTED'?'STRICT':x;
const permits=(c,label)=>label==='PUBLIC'||(c.fields.includes(label)||label==='STRICT'&&c.fields.includes('RESTRICTED'));
const scopes=c=>({tenant:c.tenant,store:null});
const list=(v)=>{if(!Array.isArray(v)||!v.length||v.length>20||new Set(v).size!==v.length)fail('INVALID_ARGUMENT');v.forEach(id);return v;};
const time=v=>{if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))fail('INVALID_ARGUMENT');return Date.parse(v);};
const same=(a,b)=>digest(a)===digest(b);
export const journeyCancelled=(k,tenant,id)=>k.journal.records().some(x=>x.operationKind==='journey-cancellation'&&x.tenant===tenant&&x.id===id);
// A cancellation witness fences new effects immediately. Only its exact,
// completed submission can establish CANCELLED for compensation after restore.
// Keep the proof outside the restored DB; never reconstruct lost approvals.
export async function recoverJourneyCancellation(k,r,x){
 if(x.kind!=='journey')return x;
 const records=k.journal.records(),witnesses=records.filter(w=>w.operationKind==='journey-cancellation'&&w.tenant===x.tenant&&w.id===x.id);let committed=false,unresolved=false;
 for(const w of witnesses){
  const submissions=records.filter(s=>s.operationKind==='submission'&&s.contractVersion==='2.0.0'&&s.tenant===x.tenant&&s.actionId===w.actionId),terminal=submissions.at(-1);
  // A separate unfinished request cannot undo an independently proven cancel.
  // Keep its submission unresolved; it is never used as cancellation proof.
  if(!terminal||terminal.phase==='INTENT'){unresolved=true;continue;}
  if(terminal.phase==='ABORTED')continue;if(terminal.phase!=='COMMITTED')fail('RECOVERING');
  const a=await r.u.action(w.actionId),proof=w.cancellationVersion===1?w:a;
  // Legacy witnesses require their original committed Action. Missing evidence
  // cannot be inferred from the displayed state or from an actor's new grant.
  if(!proof)fail('RECOVERING');
  const request=proof.request,result=proof.result,operationId=w.cancellationVersion===1?w.operationId:a.operation_id,requestDigest=w.cancellationVersion===1?w.canonicalDigest:a.digest;
  if(proof.tenant!==x.tenant||request?.operation!=='journeyCancel'||request.body?.id!==x.id||digest(request)!==requestDigest||terminal.canonicalDigest!==requestDigest||terminal.operationId!==operationId||terminal.idempotencyKey!=='v2:'+request.key||terminal.subject!==x.data.author.subject||result?.id!==x.id||result.kind!=='journey'||result.state!=='CANCELLED'||!Number.isSafeInteger(result.revision)||result.revision<1)fail('RECOVERING');
  if(w.cancellationVersion===1&&(w.authorDigest!==digest(x.data.author)||!same(w.scope,x.scope)))fail('RECOVERING');
  if(a&&(a.tenant!==x.tenant||a.operation_id!==operationId||a.digest!==requestDigest||!same(a.request,request)||!same(a.result,result)||a.state!=='CANCELLED'))fail('RECOVERING');
  committed=true;
 }
 if(committed)x.data.state='CANCELLED';else if(unresolved||x.data.state==='CANCELLED')fail('RECOVERING');
 return x;
}
// Department handoffs stay within the original legal entity and case.
// Validate persisted routes too, so old cross-case offers cannot be read,
// accepted, replayed or dispatched after an upgrade or database restore.
const sameJourneyCase=(root,target)=>Boolean(target)&&root.legalEntityId===target.legalEntityId&&root.caseId===target.caseId;
// Ordinary handoffs do not reclassify information. Preserve the existing
// CONFIDENTIAL floor and propagate STRICT (including the RESTRICTED alias).
// A lower persisted label or route is evidence of inconsistency, not a grant.
const scopeLabel=s=>labels[Math.max(labels.indexOf('CONFIDENTIAL'),labels.indexOf(fieldLabel(s?.classification)))];
const journeyRecipientValid=(x,s)=>sameJourneyCase(x.scope,s)&&fieldLabel(s.classification)===x.data.label;
const journeyBoundaryValid=x=>x.kind!=='journey'||x.data.label===scopeLabel(x.scope)&&[x.data.recipientScope,x.data.offer?.recipientScope,...x.data.steps.map(s=>s.scope)].filter(Boolean).every(s=>journeyRecipientValid(x,s));
// Rights retain their originating scope and classification even when old rows
// are restored. Inconsistent rows are quarantined, never silently relabeled.
const controlBoundaryValid=x=>journeyBoundaryValid(x)&&(x.kind!=='right'||x.data.label===scopeLabel(x.scope)&&Boolean(x.data.scope)&&same(x.scope,x.data.scope));
export async function controlRow(r,c,key,kind){const x=await r.one('SELECT * FROM enterprise_controls WHERE tenant=$1 AND id=$2 FOR UPDATE',[c.tenant,id(key)]);if(!x||kind&&x.kind!==kind)fail('NOT_FOUND');if(!controlBoundaryValid(x))fail('INCONSISTENT_STATE');return x;}
function visible(c,x){authorize(c,{...scopes(c),enterprise_scope:x.scope});if(!permits(c,x.data.label??'CONFIDENTIAL'))fail('PERMISSION_DENIED');}
async function save(r,c,x,actionId,event){
 const old=await r.one('SELECT * FROM enterprise_controls WHERE tenant=$1 AND id=$2 FOR UPDATE',[c.tenant,x.id]);
 if(old&&old.kind!==x.kind)fail('CONFLICT');if(!old)await r.create(c,{id:x.id,type:'ControlRecord',scope:x.scope,fields:{}},actionId);x.revision=(old?.revision??0)+1;
 await r.query('INSERT INTO enterprise_controls(tenant,id,kind,scope,revision,data,action_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant,id) DO UPDATE SET revision=$5,data=$6,action_id=$7',[c.tenant,x.id,x.kind,JSON.stringify(x.scope),x.revision,JSON.stringify(x.data),actionId]);
 await r.query('INSERT INTO enterprise_control_history VALUES($1,$2,$3,$4,$5)',[c.tenant,x.id,x.revision,actionId,JSON.stringify({event,actor:c.actor,subject:c.subject,policyVersion:c.policyVersion,digest:digest(x.data)})]);return {id:x.id,kind:x.kind,revision:x.revision,state:x.data.state??'SAVED'};
}
function fresh(x){if(x)fail('CONFLICT');}
async function newRecord(r,c,b,kind){id(b.id);validScope(b.scope);authorize(c,{...scopes(c),enterprise_scope:b.scope});fresh(await r.one('SELECT 1 FROM enterprise_controls WHERE tenant=$1 AND id=$2',[c.tenant,b.id]));return {id:b.id,kind,scope:b.scope,data:{}};}
// Lineage is checked recursively on every use, including after database restore.
export async function information(r,c,x,k,purpose){return checkInformation(r,c,x,k,purpose,true);}
// Historical publication basis remains immutable, but current read permissions
// are rechecked. Only live object content freshness is irrelevant to recovery.
export async function publicationInformation(r,c,x,k,policy){
 const source=await checkInformation(r,c,await controlRow(r,c,x.data.source,'information'),k,x.data.purpose,false,new Set(),policy);
 if(digest(source.data)!==x.data.sourceDigest)fail('STALE_APPROVAL');return source;
}
async function checkInformation(r,c,x,k,purpose,fresh,seen=new Set(),policy){
 const include=label=>{if(policy)policy.label=labels[Math.max(labels.indexOf(policy.label),labels.indexOf(fieldLabel(label)))];};include(x.data.label);
 visible(c,x);if(x.kind!=='information'||seen.has(x.id)||seen.size>32)fail('RECOVERING');seen.add(x.id);
 if(!x.data.purposes.includes(purpose))fail('PERMISSION_DENIED');
 if(!x.data.sources.length)fail('RECOVERING');
 for(const s of x.data.sources){
  if(s.kind==='information'){const parent=await controlRow(r,c,s.id,'information');if(digest(parent.data)!==s.digest)fail('RECOVERING');await checkInformation(r,c,parent,k,purpose,fresh,new Set(seen),policy);}
  else if(s.kind==='object'){const o=await r.object(s.id);authorize(c,o);const i=await r.instance(o.id),p=await r.package(c.tenant,i.package_id,i.package_version);const v=project(c,o,p.manifest,s.projection);const current=await sourcePolicy(r,c,'object',o.id,purpose);if(current)include(current.label);if(fresh&&digest(v)!==s.digest)fail('RECOVERING');}
  else if(s.kind==='document'){const d=await governance(k,r.u,r,c,'documentRead',{id:s.objectId,documentId:s.id,version:s.version,purpose});if(d.hash!==s.digest)fail('RECOVERING');include(d.classification);if(policy){const current=await sourcePolicy(r,c,'document',s.id,purpose);if(current)include(current.label);}}
  else fail('RECOVERING');
 }
 return x;
}
function suppressed(k,tenant,subject,material,purpose){return k.journal.records().some(x=>x.operationKind==='enterprise-suppression'&&x.tenant===tenant&&x.subjectId===subject&&x.material===material&&x.purposes.includes(purpose));}
export async function checkRight(k,r,c,key,usage){
 const x=await controlRow(r,c,key,'right');visible(c,x);const d=x.data;
 if(d.state!=='GRANTED'||suppressed(k,c.tenant,d.subject,d.material,usage.purpose)||time(d.expires)<=k.clock()||time(d.starts)>k.clock()||!d.purposes.includes(usage.purpose)||!d.media.includes(usage.channel)||!d.regions.includes(usage.region)||usage.indirect&&!d.indirect)fail('PERMISSION_DENIED');return x;
}
// Every root material must have a live permission for the declared subject.
export async function checkReleaseRights(k,r,c,data,source,channel){
 const roots=new Set(),visit=async (x,seen=new Set())=>{if(seen.has(x.id)||seen.size>32)fail('RECOVERING');seen.add(x.id);for(const s of x.data.sources){if(s.kind==='information')await visit(await controlRow(r,c,s.id,'information'),new Set(seen));else roots.add(s.kind+':'+s.id);}};
 await visit(source);id(data.subject);const covered=new Set();
 for(const key of data.rights){const right=await checkRight(k,r,c,key,{...data,channel});if(right.data.subject!==data.subject||!roots.has(right.data.material))fail('PERMISSION_DENIED');covered.add(right.data.material);}
 if(!roots.size||[...roots].some(root=>!covered.has(root)))fail('PERMISSION_DENIED');
}
// The approving principal must independently cover this exact recipient step.
// Reuse for first execution, replay and the worker's final I/O check.
export function compensationApproval(c,x,sequence){
 const step=x.data.steps.find(s=>s.sequence===sequence);if(!step||x.data.state!=='CANCELLED')fail('INVALID_STATE');
 authorize(c,{tenant:x.tenant,store:null,enterprise_scope:step.scope});
 if(!permits(c,x.data.label)||c.delegationId||c.actor!==c.subject||[x.data.author.actor,x.data.author.subject].includes(c.actor))fail('PERMISSION_DENIED');
 return step;
}
// Both the acting principal and the represented principal must be independent.
export function handoffSeparation(recipient,offer){
 if(!offer?.actor||!offer.subject||!recipient?.actor||!recipient.subject)fail('STALE_APPROVAL');
 if([recipient.actor,recipient.subject].some(p=>[offer.actor,offer.subject].includes(p)))fail('PERMISSION_DENIED');
}
export async function controlReplay(k,r,c,op,b){
 if(op==='handoffOffer'){const x=await controlRow(r,c,b.id,'journey'),sender=b.sequence===1?x.scope:x.data.steps.find(s=>s.sequence===b.sequence-1)?.scope;if(!journeyRecipientValid(x,b.recipientScope)||!sender)fail('PERMISSION_DENIED');authorize(c,{...scopes(c),enterprise_scope:sender});if(!permits(c,x.data.label))fail('PERMISSION_DENIED');return;}
 if(op==='handoffAccept'){
  const x=await controlRow(r,c,b.id,'journey'),step=x.data.steps.find(s=>s.eventId===b.eventId);if(!step)fail('STALE_APPROVAL');
  authorize(c,{...scopes(c),enterprise_scope:step.scope});if(!permits(c,x.data.label))fail('PERMISSION_DENIED');
  handoffSeparation(step.authority,step.offerAuthority);handoffSeparation(c,step.offerAuthority);
  if(['actor','subject','delegationId'].some(n=>c[n]!==step.authority[n]))fail('STALE_APPROVAL');
  await authority(r.u,r,null,'approve',step.authority);return;
 }

 if(op==='handoffCompensateApprove'){const x=await controlRow(r,c,b.id,'journey');await recoverJourneyCancellation(k,r,x);compensationApproval(c,x,b.sequence);return;}
 if(b.scope)authorize(c,{...scopes(c),enterprise_scope:b.scope});
 if(b.id){const x=await controlRow(r,c,b.id);if(x.kind==='journey'){if(!permits(c,x.data.label))fail('PERMISSION_DENIED');if(![x.scope,x.data.recipientScope,...(['controlRead','controlAudit'].includes(op)?x.data.steps.map(s=>s.scope):[])].some(s=>s&&authorized(c,{...scopes(c),enterprise_scope:s})))fail('NOT_FOUND');}else visible(c,x);if(op==='rightGrant'&&x.data.purposes.some(p=>suppressed(k,c.tenant,x.data.subject,x.data.material,p)))fail('PERMISSION_DENIED');if(x.kind==='information')await information(r,c,x,k,b.purpose??x.data.purposes[0]);if(op==='releaseApprove')await publicationInformation(r,c,x,k);}
}
export async function controls(k,u,r,c,op,b,actionId){
 if(op==='controlList'){
  exact(b,['kind','purpose'],['kind']);if(!['information','right','release','journey'].includes(b.kind))fail('INVALID_ARGUMENT');const rows=await r.query('SELECT * FROM enterprise_controls WHERE tenant=$1 AND kind=$2 ORDER BY id',[c.tenant,b.kind]);const items=[];
  for(const x of rows){if(!controlBoundaryValid(x))continue;if(!(authorized(c,{...scopes(c),enterprise_scope:x.scope})||x.kind==='journey'&&[x.data.recipientScope,...x.data.steps.map(s=>s.scope)].some(s=>s&&authorized(c,{...scopes(c),enterprise_scope:s})))||!permits(c,x.data.label??'CONFIDENTIAL'))continue;const policy={label:x.data.label};
   if(x.kind==='information'){
    if(!b.purpose||!x.data.purposes.includes(b.purpose))continue;
    // Source selectors must omit inaccessible roots without blocking other rows.
    // Tenant-wide recovery fences still run before this projection.
    try{await information(r,c,x,k,b.purpose);}catch(e){if(['PERMISSION_DENIED','NOT_FOUND'].includes(e.code))continue;throw e;}
   }
   if(x.kind==='release'){
    // Use the same immutable basis and current lineage boundary as detail reads.
    // A denied/broken row cannot reveal its ID or block unrelated publications.
    // The current label is a projection; persisted approvals are never relabeled.
    try{await publicationInformation(r,c,x,k,policy);}catch(e){if(['PERMISSION_DENIED','NOT_FOUND','RECOVERING','STALE_APPROVAL','INCONSISTENT_STATE'].includes(e.code))continue;throw e;}
   }
   await recoverJourneyCancellation(k,r,x);items.push({id:x.id,revision:x.revision,kind:x.kind,state:x.data.state??'SAVED',label:policy.label});}return {items};
 }
 if(op==='controlRead'||op==='controlAudit'){
  exact(b,['id','purpose'],['id']);await controlReplay(k,r,c,op,b);const x=await controlRow(r,c,b.id);
  let history=await r.query('SELECT revision,action_id,event FROM enterprise_control_history WHERE tenant=$1 AND id=$2 ORDER BY revision',[c.tenant,x.id]);
  if(op==='controlAudit'){
   // Immutable audit history does not grant access to its publication's current
   // information lineage. Apply the same boundary as detail and list reads.
   if(x.kind==='release')await publicationInformation(r,c,x,k);
   return controlAudit(r,c,x,history);
  }
  // Normal progress contains only an operation name and revision, never raw
  // audit identity, policy or digest. Both paths use the same proven binding.
  history=(await controlHistory(r,c,x,history)).history.map(h=>({revision:h.revision,event:{event:h.event.event}}));
  await recoverJourneyCancellation(k,r,x);
  if(x.kind==='right'&&x.data.purposes.some(p=>suppressed(k,c.tenant,x.data.subject,x.data.material,p)))x.data.state='REVOKED';
  const deliveries=await r.query('SELECT * FROM enterprise_control_deliveries WHERE tenant=$1 AND id=$2 ORDER BY channel',[c.tenant,x.id]);
  if(x.kind==='journey'){
   const d=x.data,allowed=s=>s&&authorized(c,{...scopes(c),enterprise_scope:s}),origin=allowed(x.scope),recoverySteps=[];
   for(const step of d.steps){
    if(!allowed(step.scope))continue;
    const delivery=deliveries.find(v=>v.channel==='handoff-'+step.sequence);
    if(!delivery||digest(delivery.event)!==delivery.digest||delivery.event.tenant!==x.tenant||delivery.event.aggregateId!==x.id||delivery.event.kind!=='journey'||delivery.event.channel!==delivery.channel||delivery.event.operationId!==delivery.operation_id||delivery.event.actionId!==delivery.action_id||delivery.event.payload.sequence!==step.sequence||delivery.event.payload.correlationId!==x.id||!same(delivery.event.scope,step.scope))fail('INCONSISTENT_STATE');
    const payload=delivery.event.payload.payload;
    recoverySteps.push({sequence:step.sequence,eventId:step.eventId,scope:step.scope,channel:delivery.channel,state:delivery.state,payload:{reference:payload.reference,task:payload.task}});
   }
   // Origin progress is not a grant to subsequent departments' content.
   // A pending sender can inspect its proposal; after transfer, historical
   // recipients retain only their own accepted step. The first offer remains
   // visible to its origin, which actually supplied that content.
   let offer=recoverySteps.at(-1);
   if(d.offer){
    const {authority:offerAuthority,...request}=d.offer;
    const inbox=await r.one('SELECT * FROM enterprise_handoff_inbox WHERE tenant=$1 AND event_id=$2',[x.tenant,d.offer.eventId]);
    const sender=d.offer.sequence===1?x.scope:d.steps.find(s=>s.sequence===d.offer.sequence-1)?.scope;
    if(!inbox||request.id!==x.id||inbox.journey_id!==x.id||inbox.sequence!==request.sequence||inbox.digest!==digest(request)||!same(request.recipientScope,d.recipientScope)||!sender)fail('INCONSISTENT_STATE');
    if(allowed(d.recipientScope)||allowed(sender)&&(d.state==='OFFERED'||d.offer.sequence===1))offer={eventId:request.eventId,sequence:request.sequence,payload:{reference:request.payload.reference,task:request.payload.task}};
   }
   return {id:x.id,kind:x.kind,revision:x.revision,...(origin?{scope:x.scope}:{}),data:{flow:d.flow,...(origin?{label:d.label}:{}),state:d.state,sequence:d.sequence,steps:(origin?d.steps:d.steps.filter(s=>allowed(s.scope))).map(s=>({scope:s.scope,eventId:s.eventId,sequence:s.sequence})),recoverySteps,...(offer?{offer:{eventId:offer.eventId,sequence:offer.sequence,payload:offer.payload}}:{})},history,historyMode:'progress',deliveries:deliveries.filter(v=>origin||recoverySteps.some(s=>s.channel===v.channel)).map(v=>({channel:v.channel,state:v.state}))};
  }
  // Execution authority remains persisted for binding and revocation checks.
  // Only business display fields cross the ordinary read boundary, including
  // for auditors; audit permission is not access to unrelated grant scopes.
  if(x.kind==='release'){
   const d=x.data,basis=await publicationInformation(r,c,x,k),approval=v=>({role:v.role,subject:v.authority.subject});
   return {id:x.id,kind:x.kind,scope:x.scope,revision:x.revision,data:{id:x.id,scope:x.scope,label:d.label,state:d.state,version:d.version,source:d.source,sourceDigest:d.sourceDigest,subject:d.subject,purpose:d.purpose,channels:d.channels,rights:d.rights,region:d.region,indirect:d.indirect,embargo:d.embargo,...(d.correctionOf?{correctionOf:d.correctionOf}:{}),author:{subject:d.author.subject},approvals:d.approvals.map(approval),...(d.withdrawalApprovals?{withdrawalApprovals:d.withdrawalApprovals.map(approval)}:{})},history,historyMode:'progress',deliveries:deliveries.map(({channel,operation_id,state,receipt})=>({channel,operation_id,state,receipt})),publicationBasis:{text:basis.data.text,source:basis.id,sourceDigest:d.sourceDigest,historical:true}};
  }
  return {...x,history,historyMode:'progress',deliveries:deliveries.map(({channel,operation_id,state,receipt})=>({channel,operation_id,state,receipt}))};
 }
 if(op==='informationCreate'){
  exact(b,['id','scope','source','label','purposes']);const x=await newRecord(r,c,b,'information');list(b.purposes);if(!labels.includes(b.label)||!permits(c,b.label))fail('PERMISSION_DENIED');let source,text,minimum;
  if(b.source.kind==='object'){
   exact(b.source,['kind','id','projection']);const o=await r.object(id(b.source.id));authorize(c,o);if(!same(o.enterprise_scope,b.scope))fail('PERMISSION_DENIED');const i=await r.instance(o.id),p=await r.package(c.tenant,i.package_id,i.package_version),v=project(c,o,p.manifest,b.source.projection);
   for(const purpose of b.purposes)await sourcePolicy(r,c,'object',o.id,purpose);minimum=Math.max(...Object.keys(v.fields).map(n=>labels.indexOf(fieldLabel(p.manifest.types[o.type][n].classification))),labels.indexOf(fieldLabel(o.enterprise_scope.classification)));text=JSON.stringify(v.fields);source={...b.source,digest:digest(v)};
  }else if(b.source.kind==='document'){
   exact(b.source,['kind','id','objectId','version']);const o=await r.object(b.source.objectId);authorize(c,o);if(!same(o.enterprise_scope,b.scope))fail('PERMISSION_DENIED');const d=await governance(k,u,r,c,'documentRead',{id:o.id,documentId:b.source.id,version:b.source.version,purpose:b.purposes[0]});for(const purpose of b.purposes)await sourcePolicy(r,c,'document',b.source.id,purpose);minimum=Math.max(labels.indexOf(fieldLabel(d.classification)),labels.indexOf(fieldLabel(o.enterprise_scope.classification)));text=d.content;source={...b.source,digest:d.hash};
  }else fail('INVALID_ARGUMENT');
  for(const purpose of b.purposes){const policy=await sourcePolicy(r,c,source.kind,source.id,purpose);if(policy)minimum=Math.max(minimum,labels.indexOf(policy.label));}if(labels.indexOf(b.label)<minimum)fail('PERMISSION_DENIED');x.data={label:b.label,purposes:b.purposes,sources:[source],transform:'source@1',text,state:'CLASSIFIED'};recordInformation(k,c.tenant,x,actionId);return save(r,c,x,actionId,op);
 }
 if(op==='informationDerive'){
  exact(b,['id','scope','sources','purpose','label','transform']);const x=await newRecord(r,c,b,'information');list(b.sources);id(b.purpose);if(!['search','aggregate','ai','export','notification'].includes(b.transform))fail('INVALID_ARGUMENT');
  const parents=[];for(const key of b.sources){const p=await information(r,c,await controlRow(r,c,key,'information'),k,b.purpose);if(!same(p.scope,b.scope))fail('PERMISSION_DENIED');parents.push(p);}
  const required=labels[Math.max(...parents.map(p=>labels.indexOf(p.data.label)))];if(!labels.includes(b.label)||labels.indexOf(b.label)<labels.indexOf(required)||!permits(c,b.label))fail('PERMISSION_DENIED');
  const purposes=parents[0].data.purposes.filter(p=>parents.every(x=>x.data.purposes.includes(p)));let text=parents.map(p=>p.data.text).join('\n');
  if(b.transform==='aggregate'){const roots=new Set();const visit=async p=>{for(const s of p.data.sources){if(s.kind==='information')await visit(await controlRow(r,c,s.id,'information'));else roots.add(s.kind+':'+s.id);}};for(const p of parents)await visit(p);if(roots.size<3)fail('PERMISSION_DENIED');text=JSON.stringify({count:roots.size,minimumGroup:3});}
  if(b.transform==='ai'){
   if(!(k.proposalPort instanceof ProposalPort))fail('UNAVAILABLE');const reference={id:b.id,digest:digest(parents.map(p=>p.data)),revision:1};
   const spent=k.journal.records().filter(x=>x.operationKind==='proposal-budget'&&x.tenant===c.tenant).reduce((a,x)=>a+x.maxCost,0);if(spent+10>1000)fail('RATE_LIMITED');k.journal.append({operationKind:'proposal-budget',tenant:c.tenant,actionId,maxCost:10});
   const response=await k.proposalPort.propose({purpose:b.purpose,source:{fields:{text}},reference,maxCost:10,allowedTools:[]});exact(response,['text','references','tools','cost']);if(typeof response.text!=='string'||response.text.length>2000||!same(response.references,[reference])||!same(response.tools,[])||!Number.isSafeInteger(response.cost)||response.cost<0||response.cost>10)fail('INVALID_ARGUMENT');text=response.text;
  }
  if(text.length>65536)fail('INVALID_ARGUMENT');x.data={label:b.label,purposes,sources:parents.map(p=>({kind:'information',id:p.id,digest:digest(p.data)})),transform:b.transform+'@1',text,state:'DERIVED',executionAllowed:false};recordInformation(k,c.tenant,x,actionId);return save(r,c,x,actionId,op);
 }
 if(op==='rightGrant'){
  exact(b,['id','scope','subject','material','purposes','media','regions','starts','expires','indirect','evidenceVersion']);const x=await newRecord(r,c,b,'right');id(b.subject);id(b.material);id(b.evidenceVersion);list(b.purposes);list(b.media);list(b.regions);if(time(b.starts)>=time(b.expires)||typeof b.indirect!=='boolean')fail('INVALID_ARGUMENT');if(b.purposes.some(p=>suppressed(k,c.tenant,b.subject,b.material,p)))fail('PERMISSION_DENIED');const label=scopeLabel(x.scope);if(!permits(c,label))fail('PERMISSION_DENIED');x.data={...b,label,state:'GRANTED'};return save(r,c,x,actionId,op);
 }
 if(op==='rightRevoke'){
  exact(b,['id']);const x=await controlRow(r,c,b.id,'right');visible(c,x);k.journal.append({operationKind:'enterprise-suppression',tenant:c.tenant,subjectId:x.data.subject,material:x.data.material,purposes:x.data.purposes,actionId});x.data.state='REVOKED';return save(r,c,x,actionId,op);
 }
 if(op==='rightCheck'){exact(b,['id','purpose','channel','region','indirect']);await checkRight(k,r,c,b.id,b);return {state:'PERMITTED'};}
 if(op==='releaseCreate'){
  exact(b,['id','scope','source','subject','purpose','channels','rights','region','indirect','embargo','correctionOf'],['id','scope','source','subject','purpose','channels','rights','region','indirect','embargo']);const x=await newRecord(r,c,b,'release'),s=await information(r,c,await controlRow(r,c,b.source,'information'),k,b.purpose);if(!same(s.scope,b.scope))fail('PERMISSION_DENIED');list(b.channels);list(b.rights);id(b.region);time(b.embargo);if(typeof b.indirect!=='boolean')fail('INVALID_ARGUMENT');
  for(const channel of b.channels){if(!k.controlPorts?.[channel])fail('PERMISSION_DENIED');await checkReleaseRights(k,r,c,b,s,channel);}
  if(b.correctionOf){const old=await controlRow(r,c,b.correctionOf,'release');visible(c,old);if(!['ACCEPTED','PARTIAL'].includes(old.data.state))fail('INVALID_STATE');}
  x.data={...b,label:s.data.label,sourceDigest:digest(s.data),author:c,approvals:[],state:'DRAFT',version:1};return save(r,c,x,actionId,op);
 }
 if(op==='releaseApprove'){
  exact(b,['id','role','revision','withdrawal']);const x=await controlRow(r,c,b.id,'release');visible(c,x);await publicationInformation(r,c,x,k);if(x.revision!==b.revision)fail('CONFLICT');const mode=b.withdrawal?'withdrawalApprovals':'approvals';if(!['DRAFT','REVIEWED','WITHDRAW_REQUESTED'].includes(x.data.state)||Boolean(b.withdrawal)!==(x.data.state==='WITHDRAW_REQUESTED'))fail('INVALID_STATE');
  const roles=await r.query('SELECT role FROM enterprise_release_roles WHERE tenant=$1 AND principal=$2',[c.tenant,c.subject]);if(!roles.some(y=>y.role===b.role)||c.actor!==c.subject||[x.data.author.actor,x.data.author.subject].includes(c.actor)||x.data[mode].some(v=>v.role===b.role||v.authority.actor===c.actor))fail('PERMISSION_DENIED');
  x.data[mode].push({role:b.role,authority:c,binding:releaseBinding(x.data)});if(x.data[mode].length===3){x.data.state=b.withdrawal?'WITHDRAW_APPROVED':'SCHEDULED';if(!b.withdrawal)for(const channel of x.data.channels)await enqueue(k,r,u,c,x,channel,actionId,{source:x.data.source,text:(await controlRow(r,c,x.data.source,'information')).data.text,sourceDigest:x.data.sourceDigest,purpose:x.data.purpose,region:x.data.region,correctionOf:x.data.correctionOf??null});}
  return save(r,c,x,actionId,op);
 }
 if(op==='releaseWithdraw'){
  exact(b,['id']);const x=await controlRow(r,c,b.id,'release');visible(c,x);if(!['ACCEPTED','PARTIAL'].includes(x.data.state)||c.subject!==x.data.author.subject)fail('PERMISSION_DENIED');x.data.state='WITHDRAW_REQUESTED';x.data.withdrawalApprovals=[];return save(r,c,x,actionId,op);
 }
 if(op==='journeyCreate'){
  exact(b,['id','scope','flow']);const x=await newRecord(r,c,b,'journey');if(!['lead-to-cash','procure-to-pay','hire-to-retire','incident-to-resolution'].includes(b.flow))fail('INVALID_ARGUMENT');const label=scopeLabel(x.scope);if(!permits(c,label))fail('PERMISSION_DENIED');x.data={flow:b.flow,label,state:'OPEN',author:c,sequence:0,steps:[]};return save(r,c,x,actionId,op);
 }
 if(op==='handoffOffer'){
  exact(b,['id','recipientScope','payload','eventId','sequence']);const x=await controlRow(r,c,b.id,'journey');const current=x.data.steps.at(-1)?.scope??x.scope;authorize(c,{...scopes(c),enterprise_scope:current});if(!permits(c,x.data.label))fail('PERMISSION_DENIED');validScope(b.recipientScope);exact(b.payload,['reference','task']);id(b.payload.reference);if(typeof b.payload.task!=='string'||b.payload.task.length<1||b.payload.task.length>200)fail('INVALID_ARGUMENT');id(b.eventId);
  if(!journeyRecipientValid(x,b.recipientScope)||current.departmentId===b.recipientScope.departmentId)fail('PERMISSION_DENIED');
  const existing=await r.one('SELECT * FROM enterprise_handoff_inbox WHERE tenant=$1 AND event_id=$2',[c.tenant,b.eventId]);if(existing){if(existing.digest!==digest(b))fail('CONFLICT');return {id:x.id,state:'DUPLICATE'};}
  if(journeyCancelled(k,c.tenant,x.id)||!['OPEN','ACCEPTED'].includes(x.data.state)||b.sequence!==x.data.sequence+1)fail('INVALID_STATE');
  x.data.recipientScope=b.recipientScope;x.data.offer={...b,authority:c};x.data.state='OFFERED';
  await r.query('INSERT INTO enterprise_handoff_inbox VALUES($1,$2,$3,$4,$5)',[c.tenant,b.eventId,x.id,b.sequence,digest(b)]);await u.enqueue({contractVersion:'2.0.0',operationId:(await u.action(actionId)).operation_id,actionId,aggregateId:x.id,sequence:await u.nextSequence(x.id),kind:'handoff',correlationId:x.id,payload:b.payload,recipientScope:b.recipientScope});return save(r,c,x,actionId,op);
 }
 if(op==='handoffAccept'||op==='handoffReject'){
  exact(b,['id','eventId']);const x=await controlRow(r,c,b.id,'journey');if(journeyCancelled(k,c.tenant,x.id)||x.data.state!=='OFFERED'||x.data.offer.eventId!==b.eventId)fail('INVALID_STATE');authorize(c,{...scopes(c),enterprise_scope:x.data.recipientScope});if(!permits(c,x.data.label))fail('PERMISSION_DENIED');handoffSeparation(c,x.data.offer.authority);await authority(u,r,null,'action',x.data.offer.authority);
  x.data.state=op==='handoffAccept'?'ACCEPTED':'REJECTED';x.data.sequence=x.data.offer.sequence;
  if(op==='handoffAccept'){x.data.steps.push({scope:x.data.recipientScope,authority:c,offerAuthority:x.data.offer.authority,eventId:b.eventId,sequence:x.data.sequence});await enqueue(k,r,u,c,x,'handoff-'+x.data.sequence,actionId,{correlationId:x.id,sequence:x.data.sequence,payload:x.data.offer.payload});}
  return save(r,c,x,actionId,op);
 }
 if(op==='handoffCompensateApprove'){exact(b,['id','sequence']);const x=await controlRow(r,c,b.id,'journey');await recoverJourneyCancellation(k,r,x);const step=compensationApproval(c,x,b.sequence);step.compensationAuthority=c;return save(r,c,x,actionId,op);}
 if(op==='journeyCancel'){
  exact(b,['id']);const x=await controlRow(r,c,b.id,'journey');visible(c,x);if(c.subject!==x.data.author.subject)fail('PERMISSION_DENIED');x.data.state='CANCELLED';const result=await save(r,c,x,actionId,op),a=await u.action(actionId);k.journal.append({operationKind:'journey-cancellation',cancellationVersion:1,tenant:c.tenant,id:x.id,actionId,operationId:a.operation_id,canonicalDigest:a.digest,request:a.request,result,scope:x.scope,authorDigest:digest(x.data.author)});return result;
 }
 fail('UNSUPPORTED_CAPABILITY');
}
export function releaseBinding(d){const {approvals,withdrawalApprovals,state,...content}=d;return digest(content);}
async function enqueue(k,r,u,c,x,channel,actionId,payload){
 const parentActionId=actionId;actionId=randomUUID();const operationId=randomUUID();await u.saveAction({id:actionId,tenant:c.tenant,subject:c.subject,actor:c.actor,store:null,key:'control:'+operationId,digest:digest(payload),state:'READY',request:{operation:'controlDelivery',parentActionId},result:{},operation_id:operationId});const event={contractVersion:'2.0.0',operationId,actionId,aggregateId:x.id,sequence:await u.nextSequence(x.id),tenant:c.tenant,scope:x.kind==='journey'?x.data.recipientScope:x.scope,kind:x.kind,channel,destinationDigest:digest(k.controlPorts?.[x.kind==='journey'?'handoff':channel]?.url??null),payload};await u.enqueue(event);
 await r.query('INSERT INTO enterprise_control_deliveries VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL)',[c.tenant,x.id,channel,operationId,actionId,JSON.stringify(event),digest(event),'READY']);
}
