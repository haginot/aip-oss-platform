import {controlResource} from './control-audit.mjs';
import {fail,digest,exact,tokenDigest} from '../contracts.mjs';
import {budget} from '../budget.mjs';
import {EnterpriseRepository} from '../adapters/enterprise.mjs';
import {authority,authorize} from './security.mjs';
import {checkAuthorityRecovery,checkCredentialRecovery} from './authority-recovery.mjs';
import {controlRow,information,publicationInformation,checkReleaseRights,releaseBinding,journeyCancelled,recoverJourneyCancellation,compensationApproval,handoffSeparation} from './controls.mjs';
import {SyntheticPort} from './worker.mjs';
export async function controlWork(k,credential,b){
 exact(b,['id','channel','mode']);if(!['dispatch','reconcile','withdraw'].includes(b.mode))fail('INVALID_ARGUMENT');
 let ctx;
 try{return await k.state.admission(async()=>{
  const tx=fn=>k.state.transaction(async u=>{
   const r=new EnterpriseRepository(u);checkCredentialRecovery(k,tokenDigest(credential.token));const p=await u.identity(credential.token);if(!p)fail('PERMISSION_DENIED');await checkAuthorityRecovery(k,r,p.tenant);ctx=await authority(u,r,credential,b.mode==='dispatch'?'worker':'recovery');
   const x=await controlRow(r,ctx,b.id),d=await r.one('SELECT * FROM enterprise_control_deliveries WHERE tenant=$1 AND id=$2 AND channel=$3 FOR UPDATE',[ctx.tenant,b.id,b.channel]);if(!d)fail('NOT_FOUND');
   const scope=x.kind==='journey'?d.event.scope:x.scope;authorize(ctx,{tenant:ctx.tenant,store:null,enterprise_scope:scope});if(x.data.label!=='PUBLIC'&&!ctx.fields.includes(x.data.label)&&!(x.data.label==='STRICT'&&ctx.fields.includes('RESTRICTED')))fail('PERMISSION_DENIED');
   const out=await u.outbox(d.operation_id,true);if(!out||digest(out.event)!==out.digest||out.digest!==d.digest||digest(d.event)!==d.digest||d.event.operationId!==d.operation_id||d.event.actionId!==d.action_id||d.event.aggregateId!==x.id)fail('INCONSISTENT_STATE');
   const a=await u.action(d.action_id),parent=a&&await u.action(a.request.parentActionId);if(!a||!parent||!k.journal.committed(parent.operation_id))fail('RECOVERING');
   const port=k.controlPorts?.[x.kind==='journey'?'handoff':b.channel];if(!(port instanceof SyntheticPort)||d.event.destinationDigest!==digest(port.url))fail('PERMISSION_DENIED');
   if(x.kind==='release'){
    const src=b.mode==='dispatch'?await information(r,ctx,await controlRow(r,ctx,x.data.source,'information'),k,x.data.purpose):await publicationInformation(r,ctx,x,k);if(digest(src.data)!==x.data.sourceDigest)fail('STALE_APPROVAL');
    if(a.digest!==digest(d.event.payload)||digest(d.event.payload)!==digest({source:x.data.source,text:src.data.text,sourceDigest:x.data.sourceDigest,purpose:x.data.purpose,region:x.data.region,correctionOf:x.data.correctionOf??null}))fail('INCONSISTENT_STATE');
    // Observing the fixed operation is authorized by the current recovery actor,
    // not by former publication/withdrawal voters. Observation sends no payload
    // and cannot authorize another apply/reverse. All external writes retain the
    // live vote checks, including the second transaction immediately before I/O.
    if(b.mode!=='reconcile'){
     const votes=b.mode==='withdraw'?x.data.withdrawalApprovals:x.data.approvals;if(votes?.length!==3)fail('PERMISSION_DENIED');
     for(const v of votes){const ac=await authority(u,r,null,'approve',v.authority);authorize(ac,{tenant:ctx.tenant,store:null,enterprise_scope:x.scope});if(v.binding!==releaseBinding(x.data)||!await r.one('SELECT 1 FROM enterprise_release_roles WHERE tenant=$1 AND principal=$2 AND role=$3',[ctx.tenant,ac.subject,v.role]))fail('STALE_APPROVAL');}
    }
    if(b.mode==='dispatch'){
     const author=await authority(u,r,null,'action',x.data.author);authorize(author,{tenant:ctx.tenant,store:null,enterprise_scope:x.scope});
     if(!['SCHEDULED','PARTIAL'].includes(x.data.state)||Date.parse(x.data.embargo)>k.clock())fail('INVALID_STATE');
     await checkReleaseRights(k,r,ctx,x.data,src,b.channel);
    }
    if(b.mode==='withdraw'&&!['WITHDRAW_APPROVED','WITHDRAW_PARTIAL'].includes(x.data.state))fail('INVALID_STATE');
   }else if(x.kind==='journey'){
    const step=x.data.steps.find(s=>s.sequence===d.event.payload.sequence);if(!step||digest(step.scope)!==digest(d.event.scope)||d.event.channel!==b.channel||b.channel!=='handoff-'+step.sequence||d.event.payload.correlationId!==x.id||a.digest!==digest(d.event.payload))fail('INCONSISTENT_STATE');
    // Acceptance authorizes a new handoff, not recovery of an existing effect.
    // Current recovery authority is checked above in both transactions. Reverse
    // and uncertain reverse observation still require the fresh, independent
    // compensation approval below, including the BF-14 legacy-data boundaries.
    if(b.mode==='dispatch'){handoffSeparation(step.authority,step.offerAuthority);const accepted=await authority(u,r,null,'approve',step.authority);authorize(accepted,{tenant:ctx.tenant,store:null,enterprise_scope:step.scope});}
    if(b.mode==='dispatch'&&(x.data.state==='CANCELLED'||journeyCancelled(k,ctx.tenant,x.id)))fail('INVALID_STATE');
    if(b.mode==='withdraw'||d.state==='WITHDRAW_UNKNOWN'){await recoverJourneyCancellation(k,r,x);if(x.data.state!=='CANCELLED'||!step.compensationAuthority)fail('INVALID_STATE');compensationApproval(await authority(u,r,null,'approve',step.compensationAuthority),x,step.sequence);const later=await r.query("SELECT event,state FROM enterprise_control_deliveries WHERE tenant=$1 AND id=$2",[ctx.tenant,x.id]);if(later.some(y=>y.event.payload.sequence>step.sequence&&!['WITHDRAWN','READY'].includes(y.state)))fail('INVALID_STATE');}
   }else fail('INVALID_ARGUMENT');
   return fn(u,r,x,d,port);
  });
  const prepared=await tx(async(u,r,x,d)=>{
   const witness=k.journal.records().some(z=>z.operationKind==='control-delivery'&&z.operationId===d.operation_id);
   if(b.mode==='dispatch'&&d.state!=='READY')fail('INVALID_STATE');if(b.mode==='dispatch'&&witness)fail('RECOVERING');
   if(b.mode==='reconcile'&&!['UNKNOWN','WITHDRAW_UNKNOWN'].includes(d.state)&&!witness)fail('INVALID_STATE');
   if(b.mode==='withdraw'&&d.state!=='ACCEPTED')fail('INVALID_STATE');
   const state=b.mode==='withdraw'||d.state==='WITHDRAW_UNKNOWN'?'WITHDRAW_UNKNOWN':'UNKNOWN';
   k.journal.append({operationKind:'control-delivery',tenant:ctx.tenant,operationId:d.operation_id,recordDigest:d.digest,mode:b.mode,state});
   await r.query('UPDATE enterprise_control_deliveries SET state=$4 WHERE tenant=$1 AND id=$2 AND channel=$3',[ctx.tenant,x.id,b.channel,state]);await r.query('UPDATE outbox SET state=$2 WHERE operation_id=$1',[d.operation_id,state]);await u.updateAction(d.action_id,state,{id:x.id,channel:b.channel,state});await u.audit({kind:'ControlExternalIntent',resource:controlResource(x,d.event.scope),actionId:d.action_id,objectId:x.id,operationId:d.operation_id,actor:ctx.actor,mode:b.mode});return {state,digest:d.digest,resource:controlResource(x,d.event.scope),actionId:d.action_id,operationId:d.operation_id};
  });
  try{
   await k.fault('control-before-send');
   return await tx(async(u,r,x,d,port)=>{
    if(d.digest!==prepared.digest||d.state!==prepared.state)fail('INCONSISTENT_STATE');
    const receipt=b.mode==='dispatch'?await port.apply(d.operation_id,d.event):b.mode==='withdraw'?await port.reverse(d.operation_id):await port.observe(d.operation_id);await k.fault('control-after-send');
    if(receipt.operationId!==d.operation_id||!['SUCCEEDED','COMPENSATED','ABSENT','UNSUPPORTED'].includes(receipt.state))fail('INCONSISTENT_STATE');
    if(receipt.state==='ABSENT')return {id:x.id,state:prepared.state,observation:'ABSENT',requiresHumanReview:true};
    const state={SUCCEEDED:'ACCEPTED',COMPENSATED:'WITHDRAWN',UNSUPPORTED:'WITHDRAW_UNSUPPORTED'}[receipt.state];
    await r.query('UPDATE enterprise_control_deliveries SET state=$4,receipt=$5 WHERE tenant=$1 AND id=$2 AND channel=$3',[ctx.tenant,x.id,b.channel,state,JSON.stringify(receipt)]);await r.query('UPDATE outbox SET state=$2 WHERE operation_id=$1',[d.operation_id,state]);await u.updateAction(d.action_id,state,{id:x.id,channel:b.channel,state});
    const all=await r.query('SELECT state FROM enterprise_control_deliveries WHERE tenant=$1 AND id=$2',[ctx.tenant,x.id]);
    if(x.kind==='release'){x.data.state=all.every(y=>y.state==='ACCEPTED')?'ACCEPTED':all.every(y=>y.state==='WITHDRAWN')?'WITHDRAWN':all.some(y=>y.state.startsWith('WITHDRAW'))?'WITHDRAW_PARTIAL':'PARTIAL';await r.query('UPDATE enterprise_controls SET data=$3 WHERE tenant=$1 AND id=$2',[ctx.tenant,x.id,JSON.stringify(x.data)]);}
    await u.audit({kind:'ControlExternalObserved',resource:controlResource(x,d.event.scope),actionId:d.action_id,objectId:x.id,operationId:d.operation_id,actor:ctx.actor,state,receiptDigest:digest(receipt)});return {id:x.id,channel:b.channel,state,residualExposure:state==='WITHDRAW_UNSUPPORTED'};
   });
  }catch(error){await k.state.transaction(u=>u.audit({kind:'ControlExternalUncertain',resource:prepared.resource,actionId:prepared.actionId,operationId:prepared.operationId,objectId:b.id,code:error.code??'UNAVAILABLE'}));return {id:b.id,state:prepared.state,code:error.code??'UNAVAILABLE'};}
 },budget());}catch(error){return k.reject(error,'enterprise:controlWork',ctx);}
}
