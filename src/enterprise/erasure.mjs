import {randomUUID} from 'node:crypto';
import {fail,digest} from '../contracts.mjs';
import {authorized} from './security.mjs';

// RecoveryJournal and its durable head are outside the PostgreSQL backup boundary.
// StatePort admission serializes appends, including these irreversible erasure intents.
export function erasures(k,tenant){
 return witness(k).filter(x=>x.operationKind==='document-erasure'&&x.tenant===tenant);
}
function witness(k){
 try{return k.journal.records();}
 catch{fail('RECOVERING',{reason:'erasure-witness-unavailable'});}
}
export function requireErasureMigration(k,tenant){
 if(!witness(k).some(x=>x.operationKind==='document-erasure-checkpoint'&&x.tenant===tenant))
  fail('RECOVERING',{reason:'erasure-migration-required'});
}
export async function requireErasureCheckpoint(k,r,tenant){
 requireErasureMigration(k,tenant);
 for(const e of erasures(k,tenant)){
  if(!await r.one('SELECT 1 FROM enterprise_erasure WHERE tenant=$1 AND id=$2 AND version=$3',[tenant,e.documentId,e.version]))
   fail('RECOVERING',{reason:'erasure-checkpoint-not-applied'});
 }
}
export function recordErasure(k,tenant,d,scope,erasedAt=new Date(k.clock()).toISOString()){
 if(erasures(k,tenant).some(e=>e.documentId===d.id&&e.version===d.version))return;
 k.journal.append({operationKind:'document-erasure',phase:'COMMITTED',operationId:randomUUID(),tenant,documentId:d.id,version:d.version,objectId:d.object_id,scope,classification:d.classification,erasedAt});
}

// Explicit, admitted and audited migration. A restored snapshot cannot establish
// completeness: every durable committed submission must still exist in the DB.
export async function migrateErasures(k,r,c){
 const rows=witness(k),tenant=c.tenant;
 if(rows.some(x=>x.operationKind==='document-erasure-checkpoint'&&x.tenant===tenant))return {state:'MIGRATED'};
 const committed=new Map(rows.filter(x=>x.tenant===tenant&&x.contractVersion==='2.0.0'&&x.operationKind==='submission'&&x.phase==='COMMITTED').map(x=>[x.operationId,x]));
 const actions=await r.query("SELECT * FROM actions WHERE tenant=$1 AND key LIKE 'v2:%' AND state<>'STARTED'",[tenant]);
 const byOperation=new Map(actions.map(a=>[a.operation_id,a]));
 const incomplete=()=>fail('RECOVERING',{reason:'erasure-migration-history-incomplete'});
 for(const [operationId,j] of committed){
  const a=byOperation.get(operationId);
  if(!a||a.id!==j.actionId||a.digest!==j.canonicalDigest)incomplete();
 }
 for(const a of actions)if(!committed.has(a.operation_id))incomplete();
 const docs=await r.query('SELECT * FROM enterprise_documents WHERE tenant=$1 ORDER BY id,version',[tenant]);
 const erased=await r.query('SELECT * FROM enterprise_erasure WHERE tenant=$1 ORDER BY id,version',[tenant]);
 const deleted=actions.filter(a=>a.request.operation==='documentDelete');
 for(const a of deleted){
  if(digest(a.request)!==a.digest)incomplete();
  const b=a.request.body;
  if(!erased.some(e=>e.id===b.documentId&&e.version===b.version))incomplete();
 }
 const pending=[];
 for(const d of docs){
  const o=await r.object(d.object_id);
  if(!authorized(c,o)||!c.fields.includes(d.classification))fail('PERMISSION_DENIED');
  // Existing bytes must have a retained, journal-bound upload action too.
  if(!actions.some(a=>a.request.operation==='documentUpload'&&a.request.body.id===d.object_id&&a.request.body.documentId===d.id&&a.result.version===d.version))incomplete();
  if(d.state==='DELETED'&&!erased.some(e=>e.id===d.id&&e.version===d.version))incomplete();
 }
 for(const e of erased){
  const d=docs.find(d=>d.id===e.id&&d.version===e.version);
  if(!d||!deleted.some(a=>a.request.body.id===d.object_id&&a.request.body.documentId===e.id&&a.request.body.version===e.version))incomplete();
  pending.push({d,scope:(await r.object(d.object_id)).enterprise_scope,at:e.erased_at.toISOString()});
 }
 for(const {d,scope,at} of pending)recordErasure(k,tenant,d,scope,at);
 await k.fault('document-migration-before-checkpoint');
 k.journal.append({operationKind:'document-erasure-checkpoint',phase:'COMMITTED',operationId:randomUUID(),tenant,historyDigest:digest([...committed.values()]),erasuresDigest:digest(erasures(k,tenant)),at:new Date(k.clock()).toISOString()});
 return {state:'MIGRATED'};
}
