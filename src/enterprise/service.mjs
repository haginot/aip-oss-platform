import {invoice,invoicePermissions,invoiceReads,invoiceConsistent,invoiceApproval,invoiceGuard,invoiceReplay,financialType,isInvoice} from './invoice.mjs';
import {procurement,procurementRelease,procurementPermissions,procurementGuard,procurementReserve,procurementReplay,procurementConsistent,procurementVisible,isProcurement,procurementEffect} from './procurement.mjs';
import {commandAuditResource,caseResource} from './control-audit.mjs';
import {assurance,assurancePermissions,assuranceReads,assuranceReplay,assuranceRecovery} from './assurance.mjs';
import {sourcePolicy} from './information-policy.mjs';
import {controls,controlPermissions,controlReads,controlReplay} from './controls.mjs';
import {operations,operationsPermissions,externalRestoreAuthorization} from './operations.mjs';
import {administration,administrationPermissions,administrationReads,administrationReplay} from './administration.mjs';
import {propose,proposalContext} from './proposals.mjs';
import {recordGrant,checkAuthorityRecovery,migrateAuthority,checkCredentialRecovery,recordLogout} from './authority-recovery.mjs';
import {governance,governancePermissions,governanceReads,governanceReplayAuthorization} from './governance.mjs';
import {randomUUID} from 'node:crypto';
import {exact,fail,digest,tokenDigest} from '../contracts.mjs';
import {budget,checkBudget} from '../budget.mjs';
import {EnterpriseRepository} from '../adapters/enterprise.mjs';
import {authority,authorize,authorized,project} from './security.mjs';
import {validatePackage,fields,scope,id,deadline,approvalRoute} from './contracts.mjs';

const permissions={...invoicePermissions,...procurementPermissions,...assurancePermissions,...controlPermissions,...operationsPermissions,...administrationPermissions,propose:'read',authorityRestore:'recovery',authorityMigrate:'recovery',...governancePermissions,package:'read',get:'read',query:'search',history:'read',attachment:'read',attach:'action',install:'author',review:'review',publish:'publish',create:'action',edit:'action',vote:'approve',cancel:'action',tick:'worker',grant:'publish',delegate:'action',logout:'read',recover:'recovery'};
const reads=new Set([...invoiceReads,'purchaseRead',...assuranceReads,...controlReads,'recoveryStatus',...administrationReads,...governanceReads,'package','get','query','history','attachment']);
const binding=(o,p)=>digest({id:o.id,scope:o.enterprise_scope,fields:o.fields,revision:o.revision,packageDigest:p.digest});
const view=(i,o)=>({id:o.id,revision:o.revision,state:i.state,stage:i.stage,due:i.due.toISOString(),packageId:i.package_id,packageVersion:i.package_version,votes:i.votes.map(v=>({actor:v.authority.actor,stage:v.stage,decision:v.decision}))});
async function instance(r,c,key){id(key);const o=await r.object(key);authorize(c,o);const i=await r.instance(key);if(!i)fail('NOT_FOUND');const p=await r.package(c.tenant,i.package_id,i.package_version);if(!p)fail('INCONSISTENT_STATE');return {o,i,p};}
export function validateBinding(i,o,p){
 if(!p||digest(p.manifest)!==p.digest||binding(o,p)!==i.binding)fail('STALE_APPROVAL');
}
export async function validateExecution(u,r,i,o,p){
 validateBinding(i,o,p);
 const original=await authority(u,r,null,'action',i.authority);authorize(original,o);
 for(const v of i.votes){const c=await authority(u,r,null,'approve',v.authority);authorize(c,o);}
 return original;
}
// A review is authority for one exact immutable package, never a reusable identity.
async function packageReview(u,r,p){
 const author=p?.author_identity,reviewer=p?.reviewer_identity;
 if(!author?.actor||!author.subject||author.actor!==p.author||!reviewer?.actor||!reviewer.subject||reviewer.actor!==p.reviewer||[reviewer.actor,reviewer.subject].some(x=>[author.actor,author.subject].includes(x))||!['REVIEWED','PUBLISHED'].includes(p.state))fail('PERMISSION_DENIED');
 if(!reviewer.authority||reviewer.authority.actor!==reviewer.actor||reviewer.authority.subject!==reviewer.subject||reviewer.authority.delegationId!==reviewer.delegationId||reviewer.packageDigest!==p.digest||digest(p.manifest)!==p.digest)fail('STALE_APPROVAL');
 await authority(u,r,null,'review',reviewer.authority);
 return digest(reviewer);
}
async function packageReplay(u,r,c,a){
 const p=await r.package(c.tenant,a.request.body.id,a.request.body.version);
 if(!p||a.result.reviewBinding!==await packageReview(u,r,p))fail('STALE_APPROVAL');
}
// Replay the immutable SLA result only while every referenced case remains
// visible. Deny the whole response: neither IDs nor a filtered count escape.
// tick still accepts an empty body, so tagged sources require a purpose that
// this command cannot supply, just as on its initial execution.
async function tickReplay(k,r,c,a){
 const ids=a.result?.expired;if(!Array.isArray(ids))fail('INCONSISTENT_STATE');
 for(const key of ids){const o=await r.object(key);authorize(c,o);if(o.type==='PurchaseRequest')await procurementReplay(k,r,c,'tick',{id:key});}
 for(const key of ids){const o=await r.object(key);if(financialType(o?.type)){const i=await r.instance(key),p=await r.package(c.tenant,i.package_id,i.package_version);await invoiceGuard(k,r.u,r,c,o,i,p,'tick');}await sourcePolicy(r,c,'object',key);}
}
async function run(k,u,r,c,op,b,actionId){
 // The purpose is part of the immutable command, including its idempotency digest.
 if(['create','edit','vote','cancel','attach'].includes(op)&&b?.purpose!==undefined&&(typeof b.purpose!=='string'||!b.purpose.length||b.purpose.length>128))fail('INVALID_ARGUMENT');
 if(invoicePermissions[op])return invoice(k,u,r,c,op,b,actionId);
 if(b?.id&&typeof b.id==='string'&&(governancePermissions[op]||administrationPermissions[op]||op==='propose')){const o=await r.object(b.id);if(financialType(o?.type)){authorize(c,o);if(o.type!=='InvoicePayment'||!['auditExport','propose'].includes(op))fail('PERMISSION_DENIED');const i=await r.instance(o.id),p=await r.package(c.tenant,i.package_id,i.package_version);await invoiceGuard(k,u,r,c,o,i,p,op);}}
 if(procurementPermissions[op])return procurement(k,u,r,c,op,b,actionId);
 if(op==='resourceRelease')await procurementRelease(k,r,c,b);
 if(assurancePermissions[op])return assurance(k,u,r,c,op,b,actionId);
 if(controlPermissions[op])return controls(k,u,r,c,op,b,actionId);
 if(operationsPermissions[op])return operations(k,u,r,c,op,b);
 if(op==='propose')return propose(k,r,c,b,actionId);
 if(op==='authorityMigrate'){exact(b,[]);return migrateAuthority(k,r,c,actionId);}
 if(op==='authorityRestore'){exact(b,[]);return {state:'RECOVERED'};}
 if((governancePermissions[op]||administrationPermissions[op])&&b?.id&&typeof b.id==='string'){
  const related=await r.object(b.id);if(related?.type==='PurchaseRequest')await procurementReplay(k,r,c,op,b);
 }
 if(administrationPermissions[op])return administration(k,u,r,c,op,b,actionId);
 if(governancePermissions[op])return governance(k,u,r,c,op,b);
 if(op==='package'){exact(b,['id']);const p=await r.live(c.tenant,id(b.id));if(!p)fail('NOT_FOUND');return {manifest:p.manifest,digest:p.digest};}
 if(op==='install'){exact(b,['manifest']);validatePackage(b.manifest);if(await r.package(c.tenant,b.manifest.id,b.manifest.version))fail('CONFLICT');await r.install(c.tenant,b.manifest,c);return {version:b.manifest.version,state:'DRAFT'};}
 if(op==='review'||op==='publish'){
  exact(b,['id','version']);const p=await r.package(c.tenant,id(b.id),b.version);if(!p)fail('NOT_FOUND');validatePackage(p.manifest);
  const author=p.author_identity;
  if(!author?.actor||!author.subject||author.actor!==p.author)fail('PERMISSION_DENIED');
  if(op==='review'){if([c.actor,c.subject].some(x=>[author.actor,author.subject].includes(x))||!['DRAFT','REVIEWED','PUBLISHED'].includes(p.state))fail('PERMISSION_DENIED');if(digest(p.manifest)!==p.digest)fail('STALE_APPROVAL');await r.review(p,c);return {state:p.state==='PUBLISHED'?'PUBLISHED':'REVIEWED',version:p.version,reviewBinding:digest((await r.package(c.tenant,p.id,p.version)).reviewer_identity)};}
  const reviewBinding=await packageReview(u,r,p);await r.publish(p);return {state:'PUBLISHED',version:p.version,reviewBinding};
 }
 if(op==='create'){
  exact(b,['id','packageId','scope','fields','purpose'],['id','packageId','scope','fields']);id(b.id);scope(b.scope);
  const p=await r.live(c.tenant,id(b.packageId));if(!p)fail('NOT_FOUND');if(isProcurement(p)||isInvoice(p))fail('UNSUPPORTED_CAPABILITY');fields(p.manifest,p.manifest.action.type,b.fields);
  const candidate={tenant:c.tenant,store:null,enterprise_scope:b.scope};authorize(c,candidate);
  if(Object.values(p.manifest.types[p.manifest.action.type]).some(f=>!c.fields.includes(f.classification)))fail('PERMISSION_DENIED');
  if(await r.object(b.id))fail('CONFLICT');
  const o=await r.create(c,{...b,type:p.manifest.action.type},actionId);
  await r.start(o,p,binding(o,p),c,actionId,deadline(k.clock(),p.manifest.calendar));
  return view(await r.instance(o.id),o);
 }
 if(op==='query'){
  exact(b,['packageId','type','projection','search','aggregate','export','purpose'],['packageId','type']);const p=await r.live(c.tenant,id(b.packageId));if(!p||!p.manifest.types[b.type])fail('NOT_FOUND');
  if(b.search){exact(b.search,['field','text']);if(typeof b.search.text!=='string')fail('INVALID_ARGUMENT');}
  if((isProcurement(p)||isInvoice(p))&&!c.fields.includes('CONFIDENTIAL'))return b.aggregate?{count:0}:{items:[]};
  const queryAuthority=(isProcurement(p)||isInvoice(p))?{...c,scopes:c.scopes.filter(s=>procurementVisible(c,{enterprise_scope:s}))}:c;
  const dummy={id:'schema',tenant:c.tenant,store:null,enterprise_scope:queryAuthority.scopes[0],type:b.type,revision:0,fields:{}};
  if(!queryAuthority.scopes.length)return b.aggregate?{count:0}:{items:[]};
  project(c,dummy,p.manifest,b.projection);if(b.search)project(c,dummy,p.manifest,[b.search.field]);
  const rows=await r.objects(queryAuthority,b.type,p.id,b.purpose);if(rows.length>1000)fail('RATE_LIMITED');
  const items=[];
  for(const o of rows){
   if(!authorized(c,o)||(o.type==='PurchaseRequest'||financialType(o.type))&&!procurementVisible(c,o))continue;try{await sourcePolicy(r,c,'object',o.id,b.purpose);}catch(e){if(e.code==='PERMISSION_DENIED')continue;throw e;}
   const i=await r.instance(o.id);if(!i||i.package_id!==p.id)continue;
   const pinned=await r.package(c.tenant,i.package_id,i.package_version);
   if(isProcurement(pinned)){if(!procurementVisible(c,o))continue;await procurementGuard(k,u,r,c,o,i,pinned,'query',b.purpose);}
   await invoiceGuard(k,u,r,c,o,i,pinned,'query');
   if(b.search)project(c,o,pinned.manifest,[b.search.field]);
   const item=project(c,o,pinned.manifest,b.projection);
   if(!b.search||String(o.fields[b.search.field]).includes(b.search.text))items.push(item);
  }
  return b.aggregate?{count:items.length}:{items};
 }
 if(['get','history','attachment','attach','edit','vote','cancel'].includes(op)){
  const {o,i,p}=await instance(r,c,b.id);
  await procurementGuard(k,u,r,c,o,i,p,op,b.purpose);await invoiceGuard(k,u,r,c,o,i,p,op);
  if(['attach','edit','vote','cancel'].includes(op))await sourcePolicy(r,c,'object',o.id,b.purpose);
  if(op==='attach'||op==='attachment'){
   if(!c.fields.includes('RESTRICTED'))fail('PERMISSION_DENIED');
   if(op==='attach'){exact(b,['id','content','purpose'],['id','content']);if(i.state!=='WAITING_APPROVAL'||i.votes.length||c.subject!==i.authority.subject)fail('PERMISSION_DENIED');if(typeof b.content!=='string'||Buffer.byteLength(b.content)>65536)fail('INVALID_ARGUMENT');const hash=digest(b.content);await r.query('INSERT INTO enterprise_attachments VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[o.id,hash,Buffer.from(b.content)]);await u.mutate(o,o.fields,actionId);const changed=await r.object(o.id);await r.query('UPDATE enterprise_instances SET binding=$2 WHERE id=$1',[i.id,binding(changed,p)]);return {id:o.id,hash};}
   exact(b,['id','hash','purpose'],['id','hash']);await sourcePolicy(r,c,'object',o.id,b.purpose);const row=await r.one('SELECT content FROM enterprise_attachments WHERE object_id=$1 AND hash=$2',[o.id,b.hash]);if(!row)fail('NOT_FOUND');return {content:row.content.toString()};
  }
  if(op==='get'){exact(b,['id','projection','purpose'],['id']);const informationPolicy=await sourcePolicy(r,c,'object',o.id,b.purpose);return {...(informationPolicy?{informationPolicy}:{}),...project(c,o,p.manifest,b.projection),workflow:view(i,o)};}
  if(op==='history'){exact(b,['id','purpose'],['id']);await sourcePolicy(r,c,'object',o.id,b.purpose);return {events:await r.events(o.id)};}
  if(op==='edit'){
   exact(b,['id','revision','fields','purpose'],['id','revision','fields']);if(i.state!=='WAITING_APPROVAL'||i.votes.length||c.subject!==i.authority.subject)fail('PERMISSION_DENIED');if(b.revision!==o.revision)fail('CONFLICT');fields(p.manifest,o.type,b.fields);
   project(c,o,p.manifest,Object.keys(b.fields));const changed=await u.mutate(o,b.fields,actionId);i.binding=binding(changed,p);await r.query('UPDATE enterprise_instances SET binding=$2 WHERE id=$1',[i.id,i.binding]);return view(i,changed);
  }
  if(op==='cancel'){exact(b,['id','purpose'],['id']);if(c.subject!==i.authority.subject||!['WAITING_APPROVAL','RETURNED','READY'].includes(i.state))fail('PERMISSION_DENIED');i.state='CANCELLED';await r.setInstance(i);await u.updateAction(i.action_id,i.state,{targetId:i.id});return view(i,o);}
  exact(b,['id','revision','decision','purpose'],['id','revision','decision']);if(!['APPROVE','RETURN'].includes(b.decision))fail('INVALID_ARGUMENT');
  if(i.state!=='WAITING_APPROVAL'||i.due.getTime()<=k.clock())fail('INVALID_STATE');if(o.revision!==b.revision)fail('CONFLICT');await validateExecution(u,r,i,o,p);
  if([c.actor,c.subject].some(x=>[i.authority.actor,i.authority.subject].includes(x)))fail('PERMISSION_DENIED');
  const stages=approvalRoute(p.manifest,o.fields),stage=stages[i.stage];if(!stage.approvers.includes(c.subject)||i.votes.some(v=>v.stage===i.stage&&(v.authority.subject===c.subject||v.authority.actor===c.actor)))fail('PERMISSION_DENIED');
  i.votes.push({authority:c,stage:i.stage,decision:b.decision});
  if(b.decision==='RETURN')i.state='RETURNED';else if(i.votes.filter(v=>v.stage===i.stage&&v.decision==='APPROVE').length>=stage.quorum){i.stage++;if(i.stage===stages.length)i.state='READY';}
  await r.setInstance(i);invoiceApproval(k,c,o,i,p,actionId);await u.updateAction(i.action_id,i.state,{targetId:i.id});
  if(i.state==='READY'){
   await procurementReserve(k,u,r,c,o,i,p,actionId);
   const a=await r.actionForInstance(i);await u.enqueue({... (isInvoice(p)?{operationKind:'invoice-payment',destination:'local-synthetic-payment'}:isProcurement(p)?procurementEffect(p):{}),contractVersion:'2.0.0',schemaVersion:p.version,operationId:a.operation_id,actionId:a.id,aggregateId:o.id,sequence:await u.nextSequence(o.id),tenant:c.tenant,scope:o.enterprise_scope,objectRevision:o.revision,fields:o.fields});
  }
  return view(i,o);
 }
 if(op==='tick'){
  exact(b,[]);const expired=[];for(const row of await r.due(k.clock())){const o=await r.object(row.id);if(!authorized(c,o)||(o.type==='PurchaseRequest'||financialType(o.type))&&!procurementVisible(c,o))continue;try{await sourcePolicy(r,c,'object',o.id,b.purpose);}catch(e){if(e.code==='PERMISSION_DENIED')continue;throw e;}const i=await r.instance(row.id);if(financialType(o.type)){const p=await r.package(c.tenant,i.package_id,i.package_version);await invoiceGuard(k,u,r,c,o,i,p,'tick');}i.state='EXPIRED';i.timer_fired=true;await r.setInstance(i);await u.updateAction(i.action_id,'EXPIRED',{targetId:i.id});await u.audit({kind:'EnterpriseSLAExpired',resource:caseResource(o),id:i.id,actor:c.actor});expired.push(i.id);}return {expired};
 }
 if(op==='grant'){
  exact(b,['principal','scopes','operations','fields']);const p=await u.principal(id(b.principal));if(!p||p.tenant!==c.tenant)fail('NOT_FOUND');
  if(!Array.isArray(b.scopes)||!Array.isArray(b.operations)||!Array.isArray(b.fields))fail('INVALID_ARGUMENT');b.scopes.forEach(scope);
  // Administrators may only delegate their own authority, never manufacture a boundary.
  if(b.scopes.some(s=>!c.scopes.some(t=>digest(t)===digest(s)))||b.operations.some(x=>!Object.values(permissions).includes(x))||b.fields.some(x=>!c.fields.includes(x)))fail('PERMISSION_DENIED');
  const own=await r.grant(c.actor);if(b.operations.some(x=>!own.operations.includes(x)))fail('PERMISSION_DENIED');
  recordGrant(k,c.tenant,b,actionId);await r.grantSet(p.id,b.scopes,b.operations,b.fields);return {principal:p.id};
 }
 if(op==='delegate'){
  exact(b,['id','actor','scopes','operations','expires']);id(b.id);const actor=await u.principal(id(b.actor));if(!actor?.active||actor.tenant!==c.tenant||c.delegationId)fail('PERMISSION_DENIED');
  if(!Array.isArray(b.scopes)||!Array.isArray(b.operations)||!b.operations.length||!Number.isFinite(Date.parse(b.expires))||Date.parse(b.expires)<=k.clock())fail('INVALID_ARGUMENT');b.scopes.forEach(scope);
  const grant=await r.grant(c.subject);if(b.scopes.some(s=>!c.scopes.some(t=>digest(t)===digest(s)))||b.operations.some(x=>!grant.operations.includes(x)))fail('PERMISSION_DENIED');
  const edges=await r.delegationEdges();const visit=(node,seen=new Set())=>{if(node===actor.id)return true;if(seen.has(node))return false;seen.add(node);return edges.filter(x=>x.actor===node).some(x=>visit(x.subject,seen));};if(visit(c.subject))fail('DELEGATION_CYCLE');
  await r.addDelegation({...b,subject:c.subject});return {delegationId:b.id};
 }
 if(op==='logout'){exact(b,[]);recordLogout(k,tokenDigest(c.token));await r.sessionRevoke(tokenDigest(c.token));return {state:'SIGNED_OUT'};}
 fail('UNSUPPORTED_CAPABILITY');
}

export async function enterprise(k,credential,request,options={}){
 let c;const op=request?.operation;
 try{
  options=budget(options);exact(request,['operation','body','key'],['operation','body']);const permission=permissions[op];if(!permission)fail('UNSUPPORTED_CAPABILITY');
  const transaction=(fn,executingActionId=null)=>k.state.transaction(async u=>{const r=new EnterpriseRepository(u);if(!credential||typeof credential.token!=='string')fail('PERMISSION_DENIED');checkCredentialRecovery(k,tokenDigest(credential.token));const principal=await u.identity(credential.token);if(!principal)fail('PERMISSION_DENIED');await checkAuthorityRecovery(k,r,principal.tenant,op==='authorityMigrate',null,executingActionId);c=await authority(u,r,credential,permission);await invoiceConsistent(k,r,c,executingActionId);return fn(u,r,c);},options.deadline,options.signal);
  if(reads.has(op))return await transaction(async(u,r,c)=>{const result=await run(k,u,r,c,op,request.body);await u.audit({kind:'EnterpriseRead',resource:await commandAuditResource(r,c,op,request.body),operation:op,objectId:request.body?.id??null,delegationId:c.delegationId,policyVersion:c.policyVersion,actor:c.actor,subject:c.subject,inputDigest:digest(request)});return result;});
  id(request.key);const key='v2:'+request.key,hash=digest(request);
  return await k.state.admission(async()=>{
   const previousAction=await transaction(async(u,r,c)=>{const a=await u.existing(c.tenant,c.subject,key);if(a){if(a.digest!==hash)fail('IDEMPOTENCY_MISMATCH');if((governancePermissions[op]||administrationPermissions[op])&&typeof a.request.body.id==='string'){const related=await r.object(a.request.body.id);if(related?.type==='PurchaseRequest')await procurementReplay(k,r,c,op,a.request.body);}if(invoicePermissions[op]){const replay=await invoiceReplay(k,u,r,c,op,a.request.body);if(op==='paymentRequest')a.result=replay;}else if(a.request.body?.id&&['create','edit','vote','cancel','attach',...Object.keys(governancePermissions),...Object.keys(administrationPermissions),'propose'].includes(op)){const o=await r.object(a.request.body.id);if(financialType(o?.type)){authorize(c,o);if(o.type==='InvoicePayment'){if(op==='vote'){const i=await r.instance(o.id),p=await r.package(c.tenant,i.package_id,i.package_version);await invoiceGuard(k,u,r,c,o,i,p,'vote');}else await invoiceReplay(k,u,r,c,'paymentRead',a.request.body);}else fail('PERMISSION_DENIED');}}if(op==='review'||op==='publish')await packageReplay(u,r,c,a);else if(op==='authorityMigrate')await checkAuthorityRecovery(k,r,c.tenant);else if(op==='tick')await tickReplay(k,r,c,a);else if(op==='externalRestore')await externalRestoreAuthorization(r,c,a.request.body);else if(procurementPermissions[op])await procurementReplay(k,r,c,op,a.request.body);else if(assurancePermissions[op])await assuranceReplay(k,r,c,op,a.request.body);else if(controlPermissions[op])await controlReplay(k,r,c,op,a.request.body);else if(op==='propose')await proposalContext(r,c,a.request.body);else if(administrationPermissions[op])await administrationReplay(r,c,op,a.request.body);else if(governancePermissions[op])await governanceReplayAuthorization(r,c,op,a.request.body,k);else if(a.request.body?.id&&['create','edit','vote','cancel','attach'].includes(op)){const replayObject=await r.object(a.request.body.id);authorize(c,replayObject);if(replayObject.type==='PurchaseRequest')await procurementReplay(k,r,c,op,a.request.body);await sourcePolicy(r,c,'object',a.request.body.id,a.request.body.purpose);if(op==='attach'&&!c.fields.includes('RESTRICTED'))fail('PERMISSION_DENIED');}}return a;});
   const previous=k.journal.latest(c.tenant,c.subject,key);
   if(previousAction){if(!previous||!k.journal.committed(previousAction.operation_id))fail('INCONSISTENT_STATE');return previousAction.result;}
   if(previous&&previous.canonicalDigest!==hash)fail('IDEMPOTENCY_MISMATCH');if(k.journal.fenced())fail('INCONSISTENT_STATE');
   const actionId=randomUUID(),operationId=randomUUID();const intent={informationRecoveryVersion:1,...(['informationCreate','informationDerive'].includes(op)?{informationControlId:request.body.id}:{}),operationKind:'submission',contractVersion:'2.0.0',phase:'INTENT',tenant:c.tenant,store:null,subject:c.subject,actor:c.actor,idempotencyKey:key,canonicalDigest:hash,actionId,operationId};
   checkBudget(options);k.journal.append(intent);let result;
   try{result=await transaction(async(u,r,c)=>{
    await u.saveAction({id:actionId,tenant:c.tenant,subject:c.subject,actor:c.actor,store:null,key,digest:hash,state:'STARTED',request:op==='documentUpload'?{...request,body:{...request.body,content:undefined,contentDigest:digest(request.body.content)}}:request,result:{},operation_id:operationId});
    await k.fault('enterprise-after-action');const result=await run(k,u,r,op==='logout'?{...c,token:credential.token}:c,op,request.body,actionId);
    await u.updateAction(actionId,result.state??'SUCCEEDED',result);await k.fault('enterprise-before-audit');
    await u.audit({kind:'EnterpriseCommand',resource:await commandAuditResource(r,c,op,request.body),operation:op,objectId:request.body?.id??null,delegationId:c.delegationId,policyVersion:c.policyVersion,reason:op,actionId,operationId,actor:c.actor,subject:c.subject,inputDigest:hash,resultDigest:digest(result)});return result;
   },actionId);}catch(error){if(!error.details?.commitUnknown)k.journal.append({...intent,phase:'ABORTED'});throw error;}
   await k.fault('enterprise-after-commit');k.journal.append({...intent,phase:'COMMITTED'});return result;
  },options);
 }catch(error){return k.reject(error,'enterprise:'+op,c);}
}

export async function recoverEnterprise(k,credential){
 return k.state.admission(async()=>{
  const latest=new Map();for(const row of k.journal.records())if(row.contractVersion==='2.0.0')latest.set(row.operationId,row);
  const recovered=[];for(const row of latest.values())if(row.phase==='INTENT'){
   const phase=await k.state.transaction(async u=>{const r=new EnterpriseRepository(u);if(!credential||typeof credential.token!=='string')fail('PERMISSION_DENIED');checkCredentialRecovery(k,tokenDigest(credential.token));const person=await u.identity(credential.token);if(!person)fail('PERMISSION_DENIED');const pending=await checkAuthorityRecovery(k,r,person.tenant,false,row.actionId);const c=await authority(u,r,credential,'recovery');await invoiceConsistent(k,r,c);if(pending.has(c.actor)||pending.has(c.subject))fail('PERMISSION_DENIED');if(c.tenant!==row.tenant)fail('PERMISSION_DENIED');const a=await u.action(row.actionId);if(a&&(a.digest!==row.canonicalDigest||a.operation_id!==row.operationId))fail('INCONSISTENT_STATE');if(row.operationKind==='submission'&&row.actionId){for(const v of k.journal.records().filter(v=>v.operationKind==='procurement-version'&&v.actionId===row.actionId))await procurementConsistent(k,r,c,v.id);}
   if(a&&assurancePermissions[a.request.operation])await assuranceRecovery(k,r,c,a.request.body);if(a?.request.operation==='externalRestore')await externalRestoreAuthorization(r,c,a.request.body);if(a?.request.operation==='propose')await proposalContext(r,c,a.request.body);if(['rightGrant','rightRevoke','journeyCreate','journeyCancel','handoffOffer','handoffAccept','handoffReject','handoffCompensateApprove'].includes(a?.request.operation))await controlReplay(k,r,c,a.request.operation,a.request.body);if(a&&administrationPermissions[a.request.operation])await administrationReplay(r,c,a.request.operation,a.request.body);if(a&&governancePermissions[a.request.operation])await governanceReplayAuthorization(r,c,a.request.operation,a.request.body,k);if(a?.request?.body?.id&&['create','edit','vote','cancel','attach'].includes(a.request.operation)){const o=await r.object(a.request.body.id);authorize(c,o);}// An absent Action may have been lost by restoring an older DB. It is not
   // proof that a durable authority intent never committed. Keep the fence until
   // the exact Action is recovered from a trusted complete database.
   if(!a&&k.journal.records().some(x=>x.tenant===row.tenant&&x.actionId===row.actionId&&['enterprise-grant','enterprise-authority-checkpoint','assurance-version','journey-cancellation'].includes(x.operationKind)))fail('RECOVERING');
   await u.audit({kind:'EnterpriseRecovery',operationId:row.operationId,actor:c.actor});return a?'COMMITTED':'ABORTED';});const {recordHash,previousHash,sequence,...record}=row;k.journal.append({...record,phase});recovered.push(row.operationId);
  }
  // With no pending submissions, committed invoice witnesses must still fence
  // older SQL. Pending authority recovery retains its existing per-Action path.
  if(!recovered.length&&k.journal.records().some(v=>v.operationKind==='invoice-version'))await k.state.transaction(async u=>{const r=new EnterpriseRepository(u);if(!credential||typeof credential.token!=='string')fail('PERMISSION_DENIED');checkCredentialRecovery(k,tokenDigest(credential.token));const person=await u.identity(credential.token);if(!person)fail('PERMISSION_DENIED');await checkAuthorityRecovery(k,r,person.tenant);const c=await authority(u,r,credential,'recovery');await invoiceConsistent(k,r,c);});
  return {recovered};
 },budget());
}
