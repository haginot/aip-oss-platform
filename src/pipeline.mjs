import {exact, fail, digest} from './contracts.mjs';
import {ingestWithin} from './ingestion.mjs';

// The synthetic snapshot is an immutable log prefix through a declared barrier.
// Changes may replay that prefix, but cannot rewrite it or skip its successor.
function validatePlan(r) {
 exact(r,['id','source','store','jobVersion','barrier','snapshot','changes','dependencies']);
 if(!/^[a-z][a-z0-9-]{0,63}$/.test(r.id)||typeof r.id!=='string'||typeof r.source!=='string'||!/^[-a-zA-Z0-9_]{1,64}$/.test(r.source)||!Number.isSafeInteger(r.barrier)||r.barrier<0||r.jobVersion!=='1.0.0')fail('INVALID_ARGUMENT');
 if(!Array.isArray(r.snapshot)||!Array.isArray(r.changes)||!Array.isArray(r.dependencies)||r.dependencies.length>10||r.dependencies.some(x=>typeof x!=='string'||x===r.id)||r.snapshot.length!==r.barrier||r.snapshot.length+r.changes.length>100)fail('INVALID_ARGUMENT');
 for(const item of [...r.snapshot,...r.changes]) {
  exact(item,['position','record','releases'],['position','record']);
  if(!Number.isSafeInteger(item.position)||item.position<1)fail('INVALID_ARGUMENT');
 }
 let last=r.barrier;
 const seen=new Map();
 for(const [i,item] of r.snapshot.entries()) {
  if(item.position!==i+1)fail('SOURCE_GAP');seen.set(item.position,digest(item));
 }
 for(const item of r.changes) {
  if(seen.has(item.position)){if(seen.get(item.position)!==digest(item))fail('IDEMPOTENCY_MISMATCH');}
  else {if(item.position!==last+1)fail('SOURCE_GAP');last=item.position;seen.set(last,digest(item));}
 }

}
const view=j=>({id:j.id,state:j.state,cursor:j.cursor,total:j.plan.snapshot.length+j.plan.changes.length,inputDigest:j.input_digest,jobVersion:j.plan.jobVersion,barrier:j.plan.barrier});
async function locked(u,c,id) {
 const j=await u.one('SELECT * FROM pipeline_jobs WHERE tenant=$1 AND id=$2 FOR UPDATE',[c.tenant,id]);
 if(!j||!c.stores.includes(j.store)||j.actor!==c.actor||j.subject!==c.subject||j.delegation_id!==c.delegationId)fail('PERMISSION_DENIED');
 return j;
}
export function pipelineStart(k,credential,r,options) {return k.call(credential,'ingest',async(u,c)=>{
 validatePlan(r);if(!c.stores.includes(r.store))fail('PERMISSION_DENIED');
 await u.sourceLock(c.tenant,r.store,'pipeline:'+r.id);
 const old=await u.one('SELECT * FROM pipeline_jobs WHERE tenant=$1 AND id=$2',[c.tenant,r.id]);
 if(old){await locked(u,c,r.id);if(old.input_digest!==digest(r))fail('IDEMPOTENCY_MISMATCH');return view(old);}
 for(const id of r.dependencies){const dep=await locked(u,c,id);if(dep.state!=='SUCCEEDED')fail('DEPENDENCY_PENDING');}
 const j=await u.one("INSERT INTO pipeline_jobs(tenant,id,store,actor,subject,delegation_id,input_digest,plan,state,cursor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'READY',0) RETURNING *",[c.tenant,r.id,r.store,c.actor,c.subject,c.delegationId,digest(r),r]);
 await u.audit({kind:'PipelineStarted',tenant:c.tenant,store:r.store,actor:c.actor,onBehalfOf:c.onBehalfOf,jobId:r.id,inputDigest:j.input_digest});return view(j);
},options);}
export function pipelineStatus(k,credential,r,options){return k.call(credential,'ingest',async(u,c)=>{exact(r,['id']);return view(await locked(u,c,r.id));},options);}
export function pipelineCancel(k,credential,r,options){return k.call(credential,'ingest',async(u,c)=>{
 exact(r,['id']);const j=await locked(u,c,r.id);
 if(j.state==='SUCCEEDED')fail('CONFLICT');
 await u.client.query("UPDATE pipeline_jobs SET state='CANCELLED' WHERE tenant=$1 AND id=$2",[c.tenant,j.id]);
 await u.audit({kind:'PipelineCancelled',tenant:c.tenant,store:j.store,actor:c.actor,jobId:j.id,cursor:j.cursor});return view({...j,state:'CANCELLED'});
},options);}
export async function pipelineStep(k,credential,r,options) {
 const result=await k.call(credential,'ingest',async(u,c,d)=>{
  exact(r,['id']);const j=await locked(u,c,r.id);
  if(j.state==='CANCELLED')fail('CANCELLED');if(j.state==='SUCCEEDED')return view(j);
  const entries=[...j.plan.snapshot,...j.plan.changes],entry=entries[j.cursor];
  let receipt=null;
  if(entry)receipt=await ingestWithin(k,u,c,d,{source:j.plan.source,store:j.store,position:entry.position,expectedPosition:entry.position-1,record:entry.record,...(entry.releases===undefined?{}:{releases:entry.releases})});
  await k.fault('pipeline-before-checkpoint');
  const cursor=j.cursor+(entry?1:0),state=cursor===entries.length?'SUCCEEDED':'RUNNING';
  await u.client.query('UPDATE pipeline_jobs SET cursor=$3,state=$4 WHERE tenant=$1 AND id=$2',[c.tenant,j.id,cursor,state]);
  await u.audit({kind:'PipelineCheckpoint',tenant:c.tenant,store:j.store,actor:c.actor,jobId:j.id,inputDigest:j.input_digest,cursor,state,sourcePosition:receipt?.position??null});
  return {...view({...j,cursor,state}),receipt};
 },options);
 // Fault after commit represents loss of the caller's acknowledgement.
 await k.fault('pipeline-after-checkpoint');return result;
}
