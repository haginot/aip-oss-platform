import {exact, fail, digest, typed} from './contracts.mjs';
import {authorize} from './security.mjs';

// Finite synthetic change-log profile. Source owns descriptive inventory fields;
// isolation remains exclusively owned by the Action Engine.
export async function ingest(kernel, credential, request, options) {
 return kernel.call(credential,'ingest',(u,c,d)=>ingestWithin(kernel,u,c,d,request),options);
}
export async function ingestWithin(kernel,u,c,d,request) {
  exact(request,['source','store','position','expectedPosition','record','releases'],['source','store','position','expectedPosition','record']);
  const {source,store,position,expectedPosition,record}=request;
  if(!/^[a-z][a-z0-9-]{0,63}$/.test(source)||typeof source!=='string'||!c.stores.includes(store))fail('PERMISSION_DENIED');
  if(!Number.isSafeInteger(position)||position<1||!Number.isSafeInteger(expectedPosition)||expectedPosition<0||position!==expectedPosition+1)fail('INVALID_ARGUMENT');
  exact(record,['id','deleted','name','quantity','unit','lotId','storeId','validAt'],['id','deleted','validAt']);
  if(typeof record.id!=='string'||!/^source:[a-z0-9:-]{1,100}$/.test(record.id)||typeof record.deleted!=='boolean'||typeof record.validAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(record.validAt)||!Number.isFinite(Date.parse(record.validAt)))fail('INVALID_ARGUMENT');
  const hash=digest(request);
  await u.sourceLock(c.tenant,store,source);
  const prior=await u.sourceReceipt(c.tenant,store,source,position);
  if(prior){if(prior.input_digest!==hash)fail('IDEMPOTENCY_MISMATCH');return prior.result;}
  const mode=(await u.continuity(c.tenant,store))?.mode??'NORMAL';
  if(mode!=='NORMAL')fail('CONTINUITY_RESTRICTED');
  if(await u.recoveryHold(c.tenant,store,record.id))fail('INCONSISTENT_STATE');
  const checkpoint=await u.sourceCheckpoint(c.tenant,store,source);
  if(Number(checkpoint?.position??0)!==expectedPosition)fail('SOURCE_GAP');
  // Transform errors do not advance the cursor. Quality failures are classified
  // and durably quarantined, so the next source position can correct them.
  if(!record.deleted){
   exact(record,['id','deleted','name','quantity','unit','lotId','storeId','validAt']);
   if(record.unit!=='each')fail('INVALID_UNIT');
   typed(record.name,{type:'string'});typed(record.quantity,{type:'integer'});
   if(typeof record.lotId!=='string'||typeof record.storeId!=='string')fail('INVALID_ARGUMENT');
  }
  const existing=await u.sourceObject(record.id);
  if(existing){authorize(c,existing);if(existing.source_owner!==source||existing.store!==store)fail('CONFLICT');}
  let reasons=[];
  if(!record.deleted){
   if(record.quantity<0)reasons.push('NEGATIVE_QUANTITY');
   for(const [id,type] of [[record.lotId,'Lot'],[record.storeId,'Store']]){
    const target=await u.object(id);
    if(!target||target.tenant!==c.tenant||target.store!==store||target.type!==type)reasons.push('INVALID_REFERENCE');
   }
  }else if(!existing)reasons.push('MISSING_TARGET');
  let released=null;
  if(request.releases!==undefined){
   if(!Number.isSafeInteger(request.releases)||request.releases>=position||request.releases<1)fail('INVALID_ARGUMENT');
   released=await u.sourceReceipt(c.tenant,store,source,request.releases);
   if(!released||released.result.state!=='QUARANTINED'||released.result.objectId!==record.id||reasons.length)fail('INVALID_ARGUMENT');
  }
  const sourcePosition=`${source}:${position}`;
  let revision=existing?.revision??null;
  if(!reasons.length){
   const fields=record.deleted?existing.fields:{name:record.name,quantity:record.quantity,isolated:existing?.fields.isolated??false,note:existing?.fields.note??null,secret:existing?.fields.secret??''};
   const changed=await u.ingestObject({id:record.id,tenant:c.tenant,store,source,sourcePosition,fields,deleted:record.deleted,validAt:record.validAt});revision=changed.revision;
   if(!record.deleted)await u.sourceLinks(record);
   await kernel.fault('after-source-object');
  }
  const result={state:reasons.length?'QUARANTINED':record.deleted?'DELETED':'APPLIED',source,position,objectId:record.id,revision,inputDigest:hash,ontologyVersion:d.ontologyVersion,transformVersion:'1.0.0',qualityVersion:'1.0.0',reasons,releases:request.releases??null,validAt:record.validAt};
  await u.saveSourceReceipt(c,store,source,position,hash,result);
  await kernel.fault('after-source-checkpoint');
  await u.audit({kind:'SourceIngested',...result,tenant:c.tenant,store,actor:c.actor,onBehalfOf:c.onBehalfOf,policyVersion:c.policyVersion});
  return result;
}
export function sourceStatus(kernel,credential,request,options){return kernel.call(credential,'ingest',async(u,c)=>{
 exact(request,['source','store','after','limit'],['source','store']);
 const {source,store,after=0,limit=100}=request;
 if(typeof source!=='string'||!c.stores.includes(store))fail('PERMISSION_DENIED');
 if(!Number.isSafeInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>100)fail('INVALID_ARGUMENT');
 return {checkpoint:Number((await u.sourceCheckpoint(c.tenant,store,source))?.position??0),items:await u.sourceReceipts(c.tenant,store,source,after,limit)};
},options);}
