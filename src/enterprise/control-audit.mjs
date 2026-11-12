import {digest,fail} from '../contracts.mjs';
import {authorized} from './security.mjs';

const commandKinds={informationCreate:'information',informationDerive:'information',rightGrant:'right',rightRevoke:'right',releaseCreate:'release',releaseApprove:'release',releaseWithdraw:'release',journeyCreate:'journey',handoffOffer:'journey',handoffAccept:'journey',handoffReject:'journey',journeyCancel:'journey',handoffCompensateApprove:'journey'};
const readOps=new Set(['controlRead','controlAudit','rightCheck']);
export const controlResource=(x,scope=x.scope)=>({namespace:'enterprise-control',tenant:x.tenant,kind:x.kind,id:x.id,scope,label:x.data.label??'CONFIDENTIAL'});
function commandResource(x,op,b){
 if(commandKinds[op]!==x.kind||b?.id!==x.id)return null;
 let scope=x.scope;
 if(op==='handoffOffer')scope=b.sequence===1?x.scope:x.data.steps.find(s=>s.sequence===b.sequence-1)?.scope;
 if(op==='handoffAccept'||op==='handoffReject')scope=x.data.steps.find(s=>s.eventId===b.eventId)?.scope??(x.data.offer?.eventId===b.eventId?x.data.recipientScope:null);
 if(op==='handoffCompensateApprove')scope=x.data.steps.find(s=>s.sequence===b.sequence)?.scope;
 return scope?controlResource(x,scope):null;
}
export const caseResource=o=>({namespace:'enterprise-case',tenant:o.tenant,kind:o.type,id:o.id});
const caseCommands=new Set(['invoiceImport','invoiceCorrect','paymentAccountSet','paymentRequest','paymentCancel','purchaseCreate','purchaseQuote','purchaseSelect','purchaseReceive','create','edit','vote','cancel','attach','documentUpload','documentHold','documentDelete','routeSet','definitionMigrate']);
const caseReads=new Set(['invoiceRead','invoiceAudit','paymentRead','paymentAccountRead','purchaseRead','get','history','attachment','documentRead','documentSearch','auditExport']);
export async function commandAuditResource(r,c,op,b){
 if(op==='definitionDraft'){const p=await r.package(c.tenant,b.id,b.version);if(!p)fail('INCONSISTENT_STATE');return {namespace:'enterprise-definition',tenant:c.tenant,kind:'Package',id:p.id,version:p.version,digest:p.digest};}
 if(caseCommands.has(op)||caseReads.has(op)){
  const o=await r.object(b.id);if(!o||o.tenant!==c.tenant)fail('INCONSISTENT_STATE');return caseResource(o);
 }
 if(!commandKinds[op]&&!readOps.has(op))return null;
 const x=await r.one('SELECT * FROM enterprise_controls WHERE tenant=$1 AND id=$2',[c.tenant,b.id]);if(!x)fail('INCONSISTENT_STATE');
 if(commandKinds[op])return commandResource(x,op,b);
 const scope=[x.scope,x.data.recipientScope,...(x.kind==='journey'?x.data.steps.map(s=>s.scope):[])].find(s=>s&&authorized(c,{tenant:x.tenant,store:null,enterprise_scope:s}));
 return scope?controlResource(x,scope):null;
}
function matches(x,b){return b?.namespace==='enterprise-control'&&b.tenant===x.tenant&&b.kind===x.kind&&b.id===x.id;}
function visible(c,b){return b?.scope&&authorized(c,{tenant:b.tenant,store:null,enterprise_scope:b.scope})&&(b.label==='PUBLIC'||c.fields.includes(b.label)||b.label==='STRICT'&&c.fields.includes('RESTRICTED'));}
// The global chain proves integrity, not access. Legacy command/external records
// are admitted only through persisted, typed Action/history/delivery links.
// Unbound historical reads/uncertainties cannot be attributed safely and are
// omitted; no actor lookup, caller tenant, or ID-only fallback is permitted.
// Shared provenance and current scope/classification boundary for both readers.
export async function controlHistory(r,c,x,history){
 const commands=new Map(),filteredHistory=[];
 for(const h of history){
  const a=await r.u.action(h.action_id),op=a?.request?.operation;
  if(!a||a.tenant!==x.tenant||a.request.body?.id!==x.id||h.event.event!==op||h.event.actor!==a.actor||h.event.subject!==a.subject||digest(a.request)!==a.digest)continue;
  const binding=commandResource(x,op,a.request.body);if(!binding)continue;
  commands.set(a.id,{a,binding});if(visible(c,binding))filteredHistory.push(h);
 }
 return {commands,history:filteredHistory};
}
export async function controlAudit(r,c,x,history){
 const rows=await r.query('SELECT previous_hash,hash,record FROM audit ORDER BY sequence');let prev='GENESIS';
 for(const row of rows){if(row.previous_hash!==prev||row.hash!==digest({previous:prev,record:row.record}))fail('INCONSISTENT_STATE');prev=row.hash;}
 const {commands,history:filteredHistory}=await controlHistory(r,c,x,history);
 const deliveries=new Map();
 for(const d of await r.query('SELECT * FROM enterprise_control_deliveries WHERE tenant=$1 AND id=$2',[x.tenant,x.id])){
  const a=await r.u.action(d.action_id),parent=commands.get(a?.request?.parentActionId),out=await r.u.outbox(d.operation_id);
  if(!a||a.tenant!==x.tenant||a.operation_id!==d.operation_id||a.request.operation!=='controlDelivery'||!parent||!out||digest(out.event)!==out.digest||out.digest!==d.digest||digest(d.event)!==d.digest||d.event.tenant!==x.tenant||d.event.kind!==x.kind||d.event.aggregateId!==x.id||d.event.actionId!==a.id||d.event.operationId!==d.operation_id||a.digest!==digest(d.event.payload))continue;
  deliveries.set(d.operation_id,{a,binding:controlResource(x,d.event.scope)});
 }
 const events=[];
 for(const {record:e} of rows){
  if(e.objectId!==x.id&&e.kind!=='EnterpriseRecovery')continue;
  let binding;
  if(e.kind==='EnterpriseCommand'){
   const v=commands.get(e.actionId);if(!v||e.operation!==v.a.request.operation||e.operationId!==v.a.operation_id||e.inputDigest!==v.a.digest||e.resultDigest!==digest(v.a.result)||e.actor!==v.a.actor||e.subject!==v.a.subject)continue;binding=v.binding;
  }else if(['ControlExternalIntent','ControlExternalObserved','ControlExternalUncertain'].includes(e.kind)){
   const v=deliveries.get(e.operationId);if(!v||e.actionId&&e.actionId!==v.a.id)continue;binding=v.binding;
  }else if(e.kind==='EnterpriseRecovery'){
   binding=[...commands.values()].find(v=>v.a.operation_id===e.operationId)?.binding;
  }else if(e.kind==='EnterpriseRead'&&readOps.has(e.operation)&&matches(x,e.resource)){
   binding=e.resource;
  }else continue;
  if(!binding||!matches(x,binding)||!visible(c,binding))continue;
  // If an explicit binding is present it must agree with the persisted link.
  // Labels may have strengthened; enforce both historical and current labels.
  if(e.resource&&(!matches(x,e.resource)||digest(e.resource.scope)!==digest(binding.scope)||!visible(c,e.resource)))continue;
  events.push(e);
 }
 return {id:x.id,history:filteredHistory,chainHead:prev,events};
}


// Validate the global chain separately. Historical commands need a persisted,
// typed Action link; never infer tenant from an actor's current membership.
// Legacy unbound reads/SLA/uncertainty are omitted without rewriting the chain.
export async function caseAuditEvents(r,o,i,p,rows){
 const matches=b=>b?.namespace==='enterprise-case'&&b.tenant===o.tenant&&b.kind===o.type&&b.id===o.id;
 const actions=new Map((await r.query('SELECT * FROM actions WHERE tenant=$1',[o.tenant])).map(a=>[a.id,a]));
 const definitions=new Map([[p.version,p]]),migrations=new Map();
 const linked=(x,a)=>a&&a.state!=='STARTED'&&x.operation===a.request?.operation&&x.operationId===a.operation_id&&x.inputDigest===a.digest&&x.actor===a.actor&&x.subject===a.subject;
 // Keep original hash/record bytes. Join migration metadata from the persisted
 // successful Action, including legacy events whose resource was null.
 for(const {record:x} of rows){
  const a=actions.get(x.actionId),b=a?.request?.body,v=a?.result;
  if(x.kind!=='EnterpriseCommand'||x.operation!=='definitionMigrate'||!linked(x,a)||digest(a.request)!==a.digest||x.resultDigest!==digest(v)||b.id!==o.id||x.objectId!==o.id||x.resource&&!matches(x.resource))continue;
  if(v?.id!==o.id||v.state!=='WAITING_APPROVAL'||v.version!==b.version||!Number.isInteger(b.revision)||v.revision!==b.revision+1||typeof v.from!=='string')continue;
  const from=await r.package(o.tenant,i.package_id,v.from),to=await r.package(o.tenant,i.package_id,v.version);
  if(!from||!to)continue;
  definitions.set(from.version,from);definitions.set(to.version,to);
  migrations.set(x,{packageId:i.package_id,from:{version:from.version,digest:from.digest},to:{version:to.version,digest:to.digest},revision:v.revision});
 }
 // A draft creates a package version, not a case. Validate the finite edit
 // against both immutable manifests before traversing its base-version lineage.
 const drafts=new Map();
 for(const {record:x} of rows){
  const a=actions.get(x.actionId),b=a?.request?.body,v=a?.result;
  if(x.kind!=='EnterpriseCommand'||x.operation!=='definitionDraft'||!linked(x,a)||digest(a.request)!==a.digest||x.resultDigest!==digest(v)||b.id!==i.package_id||x.objectId!==i.package_id||v?.state!=='DRAFT'||v.version!==b.version)continue;
  const base=await r.package(o.tenant,b.id,b.baseVersion),target=await r.package(o.tenant,b.id,b.version);if(!base||!target||digest(base.manifest)!==base.digest||digest(target.manifest)!==target.digest)continue;
  const binding={namespace:'enterprise-definition',tenant:o.tenant,kind:'Package',id:b.id,version:b.version,digest:target.digest};if(x.resource&&digest(x.resource)!==digest(binding))continue;
  const expected=structuredClone(base.manifest);expected.version=b.version;expected.form[0].label=b.label;expected.calendar.businessDays=b.businessDays;expected.route[0].quorum=b.quorum;if(digest(expected)!==target.digest)continue;
  const diff=[...new Set([...Object.keys(base.manifest),...Object.keys(expected)])].filter(k=>digest(base.manifest[k]??null)!==digest(expected[k]??null)).map(k=>({field:k,before:base.manifest[k]??null,after:expected[k]??null}));if(digest(v.diff)!==digest(diff))continue;
  drafts.set(x,{base,target});
 }
 let expanded=true;while(expanded){expanded=false;for(const {base,target} of drafts.values())if(definitions.has(target.version)&&!definitions.has(base.version)){definitions.set(base.version,base);expanded=true;}}
 const draftActions=new Set([...drafts].filter(([,d])=>definitions.has(d.target.version)).map(([x])=>x.actionId));
 const command=a=>{
  const op=a?.request?.operation,b=a?.request?.body;
  if(!a||!b||a.state==='STARTED'||op!=='documentUpload'&&digest(a.request)!==a.digest)return false;
  if(caseCommands.has(op))return b.id===o.id;
  if(op==='definitionDraft')return draftActions.has(a.id);
  const definition=definitions.get(b.manifest?.version??b.version);
  if(op==='install')return b.manifest?.id===p.id&&definition&&digest(b.manifest)===definition.digest;
  return ['review','publish'].includes(op)&&b.id===p.id&&!!definition;
 };
 const origin=actions.get(i.action_id),out=origin&&await r.u.outbox(origin.operation_id),e=out?.event;
 const external=['create','purchaseCreate','paymentRequest'].includes(origin?.request?.operation)&&origin.request.body.id===o.id&&e&&digest(e)===out.digest&&e.tenant===o.tenant&&e.aggregateId===o.id&&e.actionId===origin.id&&e.operationId===origin.operation_id&&e.schemaVersion===i.package_version;
 const events=[];
 for(const row of rows){
  const x=row.record;let accepted=false;
  if(x.kind==='EnterpriseCommand'){
   const a=actions.get(x.actionId);
   accepted=command(a)&&linked(x,a);
   if(x.operation==='definitionMigrate')accepted=accepted&&migrations.has(x);
   if(accepted&&caseCommands.has(x.operation)&&x.objectId!==o.id)accepted=false;
   if(x.operation==='definitionDraft')accepted=accepted&&drafts.has(x);
   else if(accepted&&x.resource&&!matches(x.resource))accepted=false;
  }else if(x.kind==='EnterpriseRead'){
   accepted=caseReads.has(x.operation)&&x.objectId===o.id&&matches(x.resource);
  }else if(['EnterpriseExternalIntent','EnterpriseExternalObserved','EnterpriseExternalUncertain'].includes(x.kind)){
   accepted=external&&x.id===o.id&&x.operationId===origin.operation_id;
  }else if(x.kind==='EnterpriseSLAExpired'){
   accepted=x.id===o.id&&matches(x.resource);
  }else if(x.kind==='EnterpriseRecovery'){
   accepted=[...actions.values()].some(a=>command(a)&&a.operation_id===x.operationId);
  }
  if(accepted){
   const a=actions.get(x.actionId),definition=x.kind==='EnterpriseCommand'&&['install','definitionDraft','review','publish'].includes(x.operation)&&definitions.get(a.request.body.manifest?.version??a.request.body.version);
   events.push({hash:row.hash,record:x,...(drafts.has(x)?{definitionDerivation:{baseVersion:drafts.get(x).base.version,baseDigest:drafts.get(x).base.digest}}:{}),...(migrations.has(x)?{definitionMigration:migrations.get(x)}:{}),...(definition?{definitionVersion:{id:definition.id,version:definition.version,digest:definition.digest}}:{})});
  }
 }
 return events;
}
