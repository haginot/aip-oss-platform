import {isProcurement} from './procurement.mjs';
import {caseAuditEvents} from './control-audit.mjs';
import {sourcePolicy} from './information-policy.mjs';
import {exact,fail,digest} from '../contracts.mjs';
import {authorize,authorized} from './security.mjs';
import {id,scope} from './contracts.mjs';
import {erasures,recordErasure,requireErasureCheckpoint,requireErasureMigration,migrateErasures} from './erasure.mjs';
export const governancePermissions={documentMigrate:'records',documentUpload:'action',documentRead:'read',documentSearch:'search',documentHold:'records',documentDelete:'records',documentRestore:'records',auditExport:'audit',connectionSet:'connect',connectionList:'read',routeSet:'action'};
export const governanceReads=['documentRead','documentSearch','auditExport','connectionList'];
const meta=d=>({id:d.id,objectId:d.object_id,version:d.version,name:d.name,mime:d.mime,classification:d.classification,hash:d.hash,state:d.state,retainUntil:d.retain_until.toISOString(),legalHold:d.legal_hold,provenance:d.provenance});
async function target(r,c,objectId){const o=await r.object(id(objectId));authorize(c,o);return o;}
function docPermission(c,d){if(!c.fields.includes(d.classification))fail('PERMISSION_DENIED');}
export async function governanceReplayAuthorization(r,c,op,b,k){
 if(op.startsWith('document'))await requireErasureCheckpoint(k,r,c.tenant);
 if(op==='connectionSet'){
  authorize(c,{tenant:c.tenant,store:null,enterprise_scope:b.scope});
  const old=await r.one('SELECT * FROM enterprise_connections WHERE tenant=$1 AND id=$2',[c.tenant,b.id]);
  if(old)authorize(c,{tenant:old.tenant,store:null,enterprise_scope:old.scope});
 }else if(b.id){
  await target(r,c,b.id);
  if(op==='routeSet')await sourcePolicy(r,c,'object',b.id);
  if(b.classification)docPermission(c,b);
  if(op==='documentUpload')await sourcePolicy(r,c,'document',b.documentId);
  if(['documentHold','documentDelete'].includes(op)){
   const d=await r.one('SELECT * FROM enterprise_documents WHERE tenant=$1 AND object_id=$2 AND id=$3 AND version=$4',[c.tenant,b.id,b.documentId,b.version]);
   if(!d)fail('NOT_FOUND');docPermission(c,d);await sourcePolicy(r,c,'document',d.id);
  }
 }
}
export async function governance(k,u,r,c,op,b){
 if(op==='documentMigrate'){exact(b,[]);return migrateErasures(k,r,c);}
 if(op.startsWith('document')&&op!=='documentRestore')await requireErasureCheckpoint(k,r,c.tenant);
 if(op==='connectionList'){exact(b,[]);const rows=await r.query('SELECT * FROM enterprise_connections WHERE tenant=$1 ORDER BY id',[c.tenant]);return {items:rows.filter(x=>authorized(c,{tenant:x.tenant,store:null,enterprise_scope:x.scope})).map(({secret_ref,...x})=>x),unconnected:['Google','Microsoft','production accounting','production HR','production contract SaaS']};}
 if(op==='connectionSet'){
  exact(b,['id','provider','secretRef','scope','destination','active']);id(b.id);id(b.secretRef);scope(b.scope);id(b.destination);if(typeof b.active!=='boolean')fail('INVALID_ARGUMENT');
  authorize(c,{tenant:c.tenant,store:null,enterprise_scope:b.scope});
  const config=k.connections?.[b.provider];if(!config||!config.secretRefs.includes(b.secretRef)||!config.destinations.includes(b.destination))fail('PERMISSION_DENIED');
  const old=await r.one('SELECT * FROM enterprise_connections WHERE tenant=$1 AND id=$2 FOR UPDATE',[c.tenant,b.id]);if(old)authorize(c,{tenant:old.tenant,store:null,enterprise_scope:old.scope});
  await r.query('INSERT INTO enterprise_connections(tenant,id,provider,secret_ref,scope,destination,active) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant,id) DO UPDATE SET provider=$3,secret_ref=$4,scope=$5,destination=$6,active=$7,revision=enterprise_connections.revision+CASE WHEN (enterprise_connections.provider,enterprise_connections.secret_ref,enterprise_connections.scope,enterprise_connections.destination,enterprise_connections.active) IS DISTINCT FROM (EXCLUDED.provider,EXCLUDED.secret_ref,EXCLUDED.scope,EXCLUDED.destination,EXCLUDED.active) THEN 1 ELSE 0 END',[c.tenant,b.id,b.provider,b.secretRef,JSON.stringify(b.scope),b.destination,b.active]);return {id:b.id,state:b.active?'CONNECTED':'DISABLED'};
 }
 if(op==='routeSet'){
  exact(b,['id','connectionId']);const o=await target(r,c,b.id);await sourcePolicy(r,c,'object',o.id);const i=await r.instance(o.id);if(i.state!=='WAITING_APPROVAL'||i.votes.length||i.authority.subject!==c.subject)fail('PERMISSION_DENIED');
  const p=await r.package(c.tenant,i.package_id,i.package_version);if(isProcurement(p))fail('PERMISSION_DENIED');
  const connection=await r.one('SELECT * FROM enterprise_connections WHERE tenant=$1 AND id=$2 FOR SHARE',[c.tenant,id(b.connectionId)]);
  if(!connection?.active||digest(connection.scope)!==digest(o.enterprise_scope))fail('PERMISSION_DENIED');
  if(await r.one('SELECT * FROM enterprise_routes WHERE object_id=$1',[o.id]))fail('CONFLICT');
  await r.query('INSERT INTO enterprise_routes VALUES($1,$2,$3,$4)',[o.id,connection.id,connection.revision,i.binding]);return {id:o.id,connectionId:connection.id};
 }
 if(op==='auditExport'){
  exact(b,['id','purpose'],['id']);const o=await target(r,c,b.id);await sourcePolicy(r,c,'object',o.id,b.purpose);
  const i=await r.instance(o.id),p=await r.package(c.tenant,i.package_id,i.package_version);
  const rows=await r.query('SELECT previous_hash,hash,record FROM audit ORDER BY sequence');let previous='GENESIS';
  for(const row of rows){if(row.previous_hash!==previous||row.hash!==digest({previous,record:row.record}))fail('INCONSISTENT_STATE');previous=row.hash;}
  const events=await caseAuditEvents(r,o,i,p,rows);
  return {id:o.id,definition:{id:p.id,version:p.version,digest:p.digest},requester:{actor:i.authority.actor,subject:i.authority.subject,delegationId:i.authority.delegationId,policyVersion:i.authority.policyVersion},approvals:i.votes.map(x=>({actor:x.authority.actor,subject:x.authority.subject,delegationId:x.authority.delegationId,policyVersion:x.authority.policyVersion,stage:x.stage,decision:x.decision})),operationId:(await r.actionForInstance(i)).operation_id,chainHead:previous,events,integrity:'SHA256 chain; privileged database rewrite and external anchoring not covered'};
 }
 if(op==='documentSearch'){
  exact(b,['id','text','purpose'],['id']);await target(r,c,b.id);if(b.text!==undefined&&typeof b.text!=='string')fail('INVALID_ARGUMENT');
  const rows=await r.query('SELECT * FROM enterprise_documents WHERE tenant=$1 AND object_id=$2 ORDER BY id,version',[c.tenant,b.id]);
  const items=[];for(const d of rows){if(!c.fields.includes(d.classification))continue;try{await sourcePolicy(r,c,'document',d.id,b.purpose);}catch(e){if(e.code==='PERMISSION_DENIED')continue;throw e;}if(await r.one('SELECT 1 FROM enterprise_erasure WHERE tenant=$1 AND id=$2 AND version=$3',[c.tenant,d.id,d.version]))continue;if(d.state==='CLEAN'&&(!b.text||d.name.includes(b.text)||d.content.toString().includes(b.text)))items.push(meta(d));}return {items};
 }
 if(op==='documentRestore'){
  exact(b,[]);
  requireErasureMigration(k,c.tenant);
  // Verify the independently persisted checkpoint before any restored content is released.
  // A journal intent remains authoritative even if the original DB transaction rolled back.
  for(const e of erasures(k,c.tenant)){
   const d=await r.one('SELECT * FROM enterprise_documents WHERE tenant=$1 AND id=$2 AND version=$3 FOR UPDATE',[c.tenant,e.documentId,e.version]);
   const o=await r.object(e.objectId);
   if(!authorized(c,{tenant:c.tenant,store:null,enterprise_scope:e.scope})||!c.fields.includes(e.classification))continue;
   if(o&&!authorized(c,o))continue;
   if(d&&(d.object_id!==e.objectId||d.classification!==e.classification))fail('RECOVERING',{reason:'erasure-document-mismatch'});
   await r.query('INSERT INTO enterprise_erasure VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[c.tenant,e.documentId,e.version,e.erasedAt]);
  }
  const rows=await r.query('SELECT d.* FROM enterprise_documents d JOIN enterprise_erasure e USING(tenant,id,version) WHERE d.tenant=$1',[c.tenant]);let erased=0;
  for(const d of rows){const o=await r.object(d.object_id);if(!authorized(c,o)||!c.fields.includes(d.classification))continue;await r.query("UPDATE enterprise_documents SET content=NULL,state='DELETED' WHERE tenant=$1 AND id=$2 AND version=$3",[c.tenant,d.id,d.version]);await k.fault('document-restore-after-erasure');erased++;}return {erased};
 }
 if(op==='documentUpload'){
  exact(b,['id','documentId','name','mime','classification','content','retainUntil']);await target(r,c,b.id);id(b.documentId);id(b.name);
  if(!['text/plain','text/csv'].includes(b.mime)||!['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'].includes(b.classification)||typeof b.content!=='string'||Buffer.byteLength(b.content)>65536||!b.content.length||!Number.isFinite(Date.parse(b.retainUntil))||Date.parse(b.retainUntil)<k.clock())fail('INVALID_ARGUMENT');
  docPermission(c,b);const old=await r.one('SELECT * FROM enterprise_documents WHERE tenant=$1 AND id=$2 ORDER BY version DESC LIMIT 1 FOR UPDATE',[c.tenant,b.documentId]);if(old&&(old.object_id!==b.id||old.classification!==b.classification))fail('PERMISSION_DENIED');
  await sourcePolicy(r,c,'document',b.documentId);
  let clean=false;try{clean=await k.documentScanner?.(Buffer.from(b.content),b.mime)===true;}catch{}const version=(old?.version??0)+1,hash=digest(b.content),state=clean?'CLEAN':'QUARANTINED';
  const provenance={actor:c.actor,subject:c.subject,delegationId:c.delegationId,policyVersion:c.policyVersion,previousHash:old?.hash??null,at:new Date(k.clock()).toISOString()};
  await r.query('INSERT INTO enterprise_documents(tenant,object_id,id,version,name,mime,classification,hash,content,state,retain_until,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[c.tenant,b.id,b.documentId,version,b.name,b.mime,b.classification,hash,Buffer.from(b.content),state,b.retainUntil,JSON.stringify(provenance)]);return {id:b.documentId,version,hash,state};
 }
 if(['documentRead','documentDelete','documentHold'].includes(op)){
  exact(b,['id','documentId','version',...(op==='documentRead'?['mode','purpose']:op==='documentHold'?['hold']:[])],['id','documentId','version',...(op==='documentHold'?['hold']:[])]);await target(r,c,b.id);
  const d=await r.one('SELECT * FROM enterprise_documents WHERE tenant=$1 AND object_id=$2 AND id=$3 AND version=$4 FOR UPDATE',[c.tenant,b.id,id(b.documentId),b.version]);if(!d)fail('NOT_FOUND');docPermission(c,d);
  await sourcePolicy(r,c,'document',d.id,b.purpose);
  const erased=await r.one('SELECT 1 FROM enterprise_erasure WHERE tenant=$1 AND id=$2 AND version=$3',[c.tenant,d.id,d.version]);
  if(op==='documentHold'){if(typeof b.hold!=='boolean'||erased)fail('INVALID_ARGUMENT');await r.query('UPDATE enterprise_documents SET legal_hold=$4 WHERE tenant=$1 AND id=$2 AND version=$3',[c.tenant,d.id,d.version,b.hold]);return {legalHold:b.hold};}
  if(op==='documentDelete'){if(d.legal_hold||d.retain_until.getTime()>k.clock())fail('PERMISSION_DENIED');recordErasure(k,c.tenant,d,(await r.object(d.object_id)).enterprise_scope);await r.query('INSERT INTO enterprise_erasure VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[c.tenant,d.id,d.version,new Date(k.clock())]);await r.query("UPDATE enterprise_documents SET content=NULL,state='DELETED' WHERE tenant=$1 AND id=$2 AND version=$3",[c.tenant,d.id,d.version]);return {state:'DELETED'};}
  if(!['download','preview','export'].includes(b.mode??'download'))fail('INVALID_ARGUMENT');if(erased||d.state!=='CLEAN')fail('NOT_FOUND');if(digest(d.content.toString())!==d.hash)fail('INCONSISTENT_STATE');return {...meta(d),content:d.content.toString()};
 }
 fail('UNSUPPORTED_CAPABILITY');
}
