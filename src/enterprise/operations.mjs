import {exact,fail} from '../contracts.mjs';
import {authorize,project,authorized} from './security.mjs';
import {sourcePolicy} from './information-policy.mjs';
// Use the recovery operator's current authority for commands, replay and journal recovery.
export async function externalRestoreAuthorization(r,c,b){
 exact(b,['id','purpose'],['id']);if(b.purpose!==undefined&&(typeof b.purpose!=='string'||!b.purpose.length||b.purpose.length>128))fail('INVALID_ARGUMENT');
 const o=await r.object(b.id);authorize(c,o);await sourcePolicy(r,c,'object',o.id,b.purpose);
 const i=await r.instance(o.id),p=await r.package(c.tenant,i.package_id,i.package_version);project(c,o,p.manifest,Object.keys(o.fields));return {o,i};
}
export const operationsPermissions={recoveryStatus:'recovery',externalRestore:'recovery'};
export async function operations(k,u,r,c,op,b){
 if(op==='recoveryStatus'){
  exact(b,['purpose'],[]);if(b.purpose!==undefined&&(typeof b.purpose!=='string'||!b.purpose.length||b.purpose.length>128))fail('INVALID_ARGUMENT');
  const rows=await r.query('SELECT o.*,i.state FROM enterprise_instances i JOIN objects o ON o.id=i.id WHERE o.tenant=$1',[c.tenant]),visible=[];
  // As with query aggregates, protected cases contribute neither totals nor state counts.
  // Missing recovery evidence and other failures must still stop the whole request.
  for(const o of rows){if(!authorized(c,o))continue;try{await sourcePolicy(r,c,'object',o.id,b.purpose);}catch(e){if(e.code==='PERMISSION_DENIED')continue;throw e;}visible.push(o);}
  return {instances:visible.length,unresolved:visible.filter(o=>['UNKNOWN','COMPENSATING'].includes(o.state)).length,waiting:visible.filter(o=>o.state==='WAITING_APPROVAL').length};
 }
 const {o,i}=await externalRestoreAuthorization(r,c,b);
 if(!['READY','UNKNOWN','SUCCEEDED','COMPENSATING','COMPENSATED'].includes(i.state))fail('INVALID_STATE');const a=await r.actionForInstance(i);if(!await u.outbox(a.operation_id,true))fail('INCONSISTENT_STATE');
 await r.externalState(i,'UNKNOWN');await r.setOutbox(a.operation_id,'UNKNOWN');return {id:o.id,state:'UNKNOWN',requiresReconciliation:true};
}
