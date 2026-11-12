import {fail,digest} from '../contracts.mjs';
import {checkInformationRecovery} from './information-policy.mjs';
function records(k){try{return k.journal.records();}catch{fail('RECOVERING');}}
export function recordGrant(k,tenant,b,actionId){k.journal.append({operationKind:'enterprise-grant',tenant,...b,actionId});}
export function recordLogout(k,hash){k.journal.append({operationKind:'enterprise-logout',tokenHash:hash});}
export function checkCredentialRecovery(k,hash){if(records(k).some(x=>(x.operationKind==='enterprise-logout'||(x.operationKind==='enterprise-session-expiry'&&Date.parse(x.expires)<=Date.now()))&&x.tokenHash===hash))fail('PERMISSION_DENIED');}
export async function migrateAuthority(k,r,c,actionId){
 const rows=records(k);for(const x of rows)if(x.operationKind==='enterprise-authority-checkpoint'&&x.tenant===c.tenant){const submission=rows.filter(s=>s.operationKind==='submission'&&s.contractVersion==='2.0.0'&&s.tenant===c.tenant&&s.actionId===x.actionId).at(-1);if(submission?.phase==='COMMITTED')return {state:'MIGRATED'};}
 const committed=rows.filter(x=>x.operationKind==='submission'&&x.contractVersion==='2.0.0'&&x.phase==='COMMITTED'&&x.tenant===c.tenant);
 for(const row of committed){const a=await r.u.action(row.actionId);if(!a||a.digest!==row.canonicalDigest||a.operation_id!==row.operationId)fail('RECOVERING');}
 const decisions=await r.query("SELECT * FROM actions WHERE tenant=$1 AND request->>'operation'='grant' AND state<>'STARTED'",[c.tenant]);
 for(const a of decisions)if(!committed.some(x=>x.actionId===a.id&&x.canonicalDigest===a.digest))fail('RECOVERING');
 const grants=await r.query('SELECT g.*,p.active AS principal_active FROM enterprise_grants g JOIN principals p ON p.id=g.principal WHERE p.tenant=$1',[c.tenant]);
 // Only a fully scoped recovery administrator may attest the current authority set.
 const own=await r.grant(c.actor);for(const g of grants)if(g.scopes.some(s=>!c.scopes.some(t=>digest(s)===digest(t)))||g.fields.some(f=>!c.fields.includes(f))||g.operations.some(op=>!own.operations.includes(op)))fail('PERMISSION_DENIED');
 for(const g of grants)recordGrant(k,c.tenant,{principal:g.principal,scopes:g.scopes,operations:g.active&&g.principal_active?g.operations:[],fields:g.fields},actionId);
 const sessions=await r.query('SELECT s.digest,s.expires FROM sessions s JOIN principals p ON p.id=s.principal WHERE p.tenant=$1',[c.tenant]);for(const s of sessions)k.journal.append({operationKind:'enterprise-session-expiry',tenant:c.tenant,tokenHash:s.digest,expires:s.expires.toISOString()});
 await k.fault('authority-migration-before-checkpoint');k.journal.append({operationKind:'enterprise-authority-checkpoint',tenant:c.tenant,actionId,historyDigest:digest(committed)});return {state:'MIGRATED'};
}
// A durable intent is not a committed authority decision. Bind each witness to
// its submission outcome; an existing exact Action is DB commit evidence only.
export async function checkAuthorityRecovery(k,r,tenant,allowMigration=false,resolvingActionId=null,executingActionId=null){
 await checkInformationRecovery(k,r,tenant,executingActionId);
 const rows=records(k),submissions=new Map(),states=new Map(),pending=new Set();
 for(const row of rows)if(row.operationKind==='submission'&&row.contractVersion==='2.0.0'&&row.tenant===tenant)submissions.set(row.actionId,row);
 const state=async row=>{
  if(states.has(row.actionId))return states.get(row.actionId);
  const submission=submissions.get(row.actionId);if(!submission)fail('RECOVERING');
  if(submission.phase==='ABORTED'){states.set(row.actionId,'ABORTED');return 'ABORTED';}
  const a=await r.u.action(row.actionId);
  if(a&&(a.tenant!==tenant||a.digest!==submission.canonicalDigest||a.operation_id!==submission.operationId||!['grant','authorityMigrate'].includes(a.request.operation)||a.state==='STARTED'))fail('INCONSISTENT_STATE');
  const result=submission.phase==='COMMITTED'?'COMMITTED':submission.phase==='INTENT'?(a?'PRESENT':'PENDING'):null;
  if(!result)fail('RECOVERING');states.set(row.actionId,result);return result;
 };
 let checkpoint=false;
 for(const row of rows)if(row.operationKind==='enterprise-authority-checkpoint'&&row.tenant===tenant){const s=await state(row);if(s==='COMMITTED'||s==='PRESENT')checkpoint=true;}
 if(!checkpoint){if(allowMigration)return pending;fail('RECOVERING');}
 const latest=new Map();
 for(const row of rows)if(row.operationKind==='enterprise-grant'&&row.tenant===tenant){
  const s=await state(row);if(s==='ABORTED')continue;
  if(s==='PENDING'){
   // Only explicit recovery may resolve this exact absent Action. Its target
   // cannot use the uncertain grant to authorize that recovery.
   if(row.actionId!==resolvingActionId)fail('RECOVERING');pending.add(row.principal);continue;
  }
  latest.set(row.principal,row);
 }
 for(const row of latest.values()){
  const g=await r.grant(row.principal),a=await r.u.action(row.actionId);if(a)continue;if(!g)fail('RECOVERING');
  if(digest([g.scopes,g.operations,g.fields])!==digest([row.scopes,row.operations,row.fields])){
   await r.query('UPDATE enterprise_grants SET scopes=$2,operations=$3,fields=$4,revision=revision+1 WHERE principal=$1',[row.principal,JSON.stringify(row.scopes),JSON.stringify(row.operations),JSON.stringify(row.fields)]);
   await r.u.audit({kind:'EnterpriseAuthorityRestored',principal:row.principal,decisionActionId:row.actionId});
  }
 }
 return pending;
}
