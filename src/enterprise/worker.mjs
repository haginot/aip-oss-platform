import {invoiceConsistent,invoiceGuard,invoiceExecution,invoiceIntent,isInvoice} from './invoice.mjs';
import {procurementExecution,procurementGuard,procurementIntent,isProcurement} from './procurement.mjs';
import {sourcePolicy} from './information-policy.mjs';
import {checkAuthorityRecovery,checkCredentialRecovery} from './authority-recovery.mjs';
import {fail,digest,tokenDigest} from '../contracts.mjs';
import {EnterpriseRepository} from '../adapters/enterprise.mjs';
import {authority,authorize,project} from './security.mjs';
import {validateExecution,validateBinding} from './service.mjs';
import {budget} from '../budget.mjs';

// Only the installed independent synthetic server is reachable in this slice.
export class SyntheticPort {
 constructor(url){const u=new URL(url);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)fail('PERMISSION_DENIED');this.url=u.origin;}
 async request(method,path,body){const response=await fetch(this.url+path,{method,redirect:'error',signal:AbortSignal.timeout(1500),headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!response.ok)fail('UNAVAILABLE');return response.json();}
 apply(operationId,event){return this.request('POST','/effects',{operationId,event});}
 observe(operationId){return this.request('GET','/effects/'+encodeURIComponent(operationId));}
 reverse(operationId){return this.request('POST','/compensations',{operationId});}
}

export async function enterpriseWork(k,credential,{id,mode,purpose},port){
 if(!['dispatch','reconcile','compensate'].includes(mode)||!(port instanceof SyntheticPort)||purpose!==undefined&&(typeof purpose!=='string'||!purpose.length||purpose.length>128))fail('INVALID_ARGUMENT');
 let ctx;
 try{return await k.state.admission(async()=>{
  // Authorize before state or journal preconditions in BOTH transactions.
  const tx=fn=>k.state.transaction(async u=>{const r=new EnterpriseRepository(u);if(!credential||typeof credential.token!=='string')fail('PERMISSION_DENIED');checkCredentialRecovery(k,tokenDigest(credential.token));const person=await u.identity(credential.token);if(!person)fail('PERMISSION_DENIED');await checkAuthorityRecovery(k,r,person.tenant);ctx=await authority(u,r,credential,mode==='dispatch'?'worker':'recovery');await invoiceConsistent(k,r,ctx);const o=await r.object(id);authorize(ctx,o);await sourcePolicy(r,ctx,'object',o.id,mode==='dispatch'?null:purpose,{dispatch:mode==='dispatch'});const i=await r.instance(id);if(!i)fail('NOT_FOUND');const p=await r.package(ctx.tenant,i.package_id,i.package_version);project(ctx,o,p.manifest,Object.keys(o.fields));await procurementGuard(k,u,r,ctx,o,i,p,'get',mode==='dispatch'?null:purpose);await invoiceGuard(k,u,r,ctx,o,i,p,'get');const a=await r.actionForInstance(i);if(isProcurement(p)&&Object.getPrototypeOf(port)!==SyntheticPort.prototype)fail('PERMISSION_DENIED');return fn(u,r,o,i,p,a);});
  const validate=async(u,r,i,o,p,a)=>{
   if(mode==='dispatch'){await validateExecution(u,r,i,o,p);}else{validateBinding(i,o,p);}
   await procurementExecution(k,u,r,ctx,o,i,p,mode);await invoiceExecution(k,u,r,ctx,o,i,p,mode);
   project(ctx,o,p.manifest,Object.keys(o.fields));
   const event=await u.outbox(a.operation_id,true),e=event?.event;
   if(!e||digest(e)!==event.digest||e.operationId!==a.operation_id||e.actionId!==a.id||e.aggregateId!==o.id||e.tenant!==o.tenant||e.schemaVersion!==p.version||e.objectRevision!==o.revision||digest(e.scope)!==digest(o.enterprise_scope)||digest(e.fields)!==digest(o.fields))fail('INCONSISTENT_STATE');
   if(isInvoice(p)&&(e.operationKind!=='invoice-payment'||e.destination!=='local-synthetic-payment'||Object.getPrototypeOf(port)!==SyntheticPort.prototype))fail('PERMISSION_DENIED');
   const route=await r.one('SELECT * FROM enterprise_routes WHERE object_id=$1',[o.id]);
   if(route){if(typeof port.bind!=='function')fail('PERMISSION_DENIED');port=await port.bind(u,o,i);}else if(typeof port.bind==='function')fail('PERMISSION_DENIED');
   return e;
  };
  const prepared=await tx(async(u,r,o,i,p,a)=>{
   if(k.journal.fenced()||!k.journal.committed(a.operation_id))fail('INCONSISTENT_STATE');
   if(mode==='dispatch'&&['SUCCEEDED','COMPENSATED'].includes(i.state)){
    // The transaction entry already authorizes current source/field access.
    // Terminal replay must not re-execute or revalidate historical approvals
    // that legitimate recovery may have outlived.
    return {done:i.state};
   }
   if(mode==='dispatch'&&i.state!=='READY')fail('INVALID_STATE');
   if(mode==='reconcile'&&!['UNKNOWN','COMPENSATING'].includes(i.state))fail('INVALID_STATE');
   if(mode==='compensate'&&i.state!=='SUCCEEDED')fail('INVALID_STATE');
   const event=await validate(u,r,i,o,p,a);if(mode==='dispatch'&&i.due.getTime()<=k.clock())fail('INVALID_STATE');
   // Persist uncertainty BEFORE network I/O; a crash can only require observation.
   const state=mode==='compensate'?'COMPENSATING':i.state==='COMPENSATING'?'COMPENSATING':'UNKNOWN';
   if(mode==='dispatch'){procurementIntent(k,ctx,o,p,a);invoiceIntent(k,ctx,o,p,a);}
   await r.externalState(i,state);await r.setOutbox(a.operation_id,state);await u.audit({kind:'EnterpriseExternalIntent',mode,id,operationId:a.operation_id,actor:ctx.actor});
   return {operationId:a.operation_id,event,state};
  });
  if(prepared.done)return {id,state:prepared.done};
  try{
   await k.fault('enterprise-before-send');
   // Recheck current authority and hold its row locks across I/O. The durable
   // intent above survives both process death and rollback after external success.
   return await tx(async(u,r,o,i,p,a)=>{
    const event=await validate(u,r,i,o,p,a);if(digest(event)!==digest(prepared.event))fail('INCONSISTENT_STATE');
    if(i.state!==prepared.state||a.operation_id!==prepared.operationId)fail('INCONSISTENT_STATE');
    // Preparation and async authority/route checks can cross the deadline.
    // Stop new effects here, while keeping observation and compensation available.
    if(mode==='dispatch'&&i.due.getTime()<=k.clock())fail('INVALID_STATE');
    const receipt=isInvoice(p)?await port.request(mode==='dispatch'?'POST':'GET',mode==='dispatch'?'/payments':'/payments/'+encodeURIComponent(prepared.operationId),mode==='dispatch'?{operationId:prepared.operationId,event:prepared.event}:undefined):mode==='dispatch'?await port.apply(prepared.operationId,prepared.event):mode==='compensate'?await port.reverse(prepared.operationId):await port.observe(prepared.operationId);
    await k.fault('enterprise-after-send');
    if(isInvoice(p)&&receipt.state==='COMPENSATED')fail('INCONSISTENT_STATE');
    if(receipt.operationId!==prepared.operationId||!['SUCCEEDED','COMPENSATED','ABSENT'].includes(receipt.state))fail('INCONSISTENT_STATE');
    if(receipt.state==='ABSENT')return {id,state:prepared.state,observation:'ABSENT',requiresHumanReview:true};
    await r.externalState(i,receipt.state);await r.setOutbox(a.operation_id,receipt.state);await u.audit({kind:'EnterpriseExternalObserved',mode,id,operationId:a.operation_id,state:receipt.state,actor:ctx.actor});return {id,state:receipt.state};
   });
  }catch(error){await k.state.transaction(u=>u.audit({kind:'EnterpriseExternalUncertain',id,operationId:prepared.operationId,mode,code:error.code??'UNAVAILABLE'}));return {id,state:prepared.state};}
 },budget());}catch(error){return k.reject(error,'enterprise:'+mode,ctx);}
}
