import {fail,digest} from '../contracts.mjs';
const levels=['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT'];
export function recordInformation(k,tenant,x,actionId){
 k.journal.append({operationKind:'enterprise-information',tenant,actionId,id:x.id,policyDigest:digest({scope:x.scope,data:x.data})});
}
// A restored database must not turn a classified root back into an untagged one.
// Keep a tenant fence until the exact Action and immutable policy are recovered.
export async function checkInformationRecovery(k,r,tenant,executingActionId=null){
 let records;try{records=k.journal.records();}catch{fail('RECOVERING');}
 const submissions=new Map(),witnesses=new Map();
 for(const row of records)if(row.tenant===tenant){
  if(row.operationKind==='submission'&&row.contractVersion==='2.0.0')submissions.set(row.actionId,row);
  if(row.operationKind==='enterprise-information')witnesses.set(row.actionId,row);
 }
 for(const row of submissions.values()){
  if(row.actionId===executingActionId||row.phase==='ABORTED')continue;
  if(!['INTENT','COMMITTED'].includes(row.phase))fail('RECOVERING');
  // Legacy submissions did not identify classification commands. An absent
  // legacy Action is therefore not proof that no classification was committed.
  if(row.informationRecoveryVersion===1&&!row.informationControlId)continue;
  const a=await r.u.action(row.actionId);
  if(!a)fail('RECOVERING');
  if(a.tenant!==tenant||a.digest!==row.canonicalDigest||a.operation_id!==row.operationId||a.state==='STARTED')fail('RECOVERING');
  if(!['informationCreate','informationDerive'].includes(a.request.operation)){if(row.informationControlId)fail('RECOVERING');continue;}
  const id=a.request.body.id,x=await r.one('SELECT * FROM enterprise_controls WHERE tenant=$1 AND id=$2',[tenant,id]);
  if(!x||x.kind!=='information'||x.action_id!==a.id||x.revision!==1)fail('RECOVERING');
  const witness=witnesses.get(a.id);
  if(row.informationRecoveryVersion===1){
   if(row.informationControlId!==id||!witness||witness.id!==id||witness.policyDigest!==digest({scope:x.scope,data:x.data}))fail('RECOVERING');
  }else{
   // For pre-upgrade records require the original command and its saved history.
   const history=await r.one('SELECT event FROM enterprise_control_history WHERE tenant=$1 AND id=$2 AND revision=1 AND action_id=$3',[tenant,id,a.id]);
   if(!history||history.event.digest!==digest(x.data)||digest(x.scope)!==digest(a.request.body.scope)||x.data.label!==a.request.body.label)fail('RECOVERING');
   if(a.request.operation==='informationCreate'&&(digest(x.data.purposes)!==digest(a.request.body.purposes)||x.data.transform!=='source@1'))fail('RECOVERING');
  }
 }
}
// Tagged roots constrain existing public surfaces too; untagged v2 contracts are unchanged.
export async function sourcePolicy(r,c,kind,id,purpose,{dispatch=false}={}){
 const rows=await r.query("SELECT data FROM enterprise_controls WHERE tenant=$1 AND kind='information' AND data->>'transform'='source@1' AND data->'sources' @> $2::jsonb",[c.tenant,JSON.stringify([{kind,id}])]);if(!rows.length)return null;
 const label=levels[Math.max(...rows.map(x=>levels.indexOf(x.data.label)))],purposes=rows[0].data.purposes.filter(p=>rows.every(x=>x.data.purposes.includes(p)));
 if(dispatch||!purposes.includes(purpose)||label!=='PUBLIC'&&!c.fields.includes(label)&&!(label==='STRICT'&&c.fields.includes('RESTRICTED')))fail('PERMISSION_DENIED');return {label,purposes};
}
