import {exact,fail,digest} from './contracts.mjs';
import {authorize} from './security.mjs';
const valid=s=>typeof s==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(s);
export const naturalId=(tenant,store,source,key)=>'source:'+digest({tenant,store,source,type:'InventoryPosition',key});
function scope(c,r){if(!valid(r.source)||!c.stores.includes(r.store)||!valid(r.version))fail('PERMISSION_DENIED');}
async function targets(u,c,entries,store){for(const objectId of Object.values(entries)){const o=await u.object(objectId);authorize(c,o);if(o.type!=='InventoryPosition'||o.store!==store)fail('INVALID_ARGUMENT');}}
export function identityResolve(k,credential,r,options){return k.call(credential,'ingest',async(u,c)=>{
 exact(r,['source','store','key','version']);scope(c,r);if(!valid(r.key))fail('INVALID_ARGUMENT');
 let objectId=naturalId(c.tenant,r.store,r.source,r.key),mappingDigest=digest({algorithm:'namespaced-sha256-v1'});
 if(r.version!=='base-v1'){
  const m=await u.one("SELECT * FROM identity_maps WHERE tenant=$1 AND store=$2 AND source=$3 AND version=$4 AND state='PUBLISHED'",[c.tenant,r.store,r.source,r.version]);if(!m)fail('UNSUPPORTED_VERSION');
  objectId=m.entries[r.key]??objectId;mappingDigest=m.digest;
  if(m.entries[r.key])authorize(c,await u.object(objectId));
 }
 return {objectId,source:r.source,key:r.key,version:r.version,mappingDigest,confidence:'explicit'};
},options);}
export function mappingDraft(k,credential,r,options){return k.call(credential,'author',async(u,c)=>{
 exact(r,['source','store','version','entries']);scope(c,r);
 if(r.version==='base-v1'||!r.entries||Array.isArray(r.entries)||Object.keys(r.entries).length>100||Object.keys(r.entries).some(key=>!valid(key)))fail('INVALID_ARGUMENT');
 await targets(u,c,r.entries,r.store);
 await u.sourceLock(c.tenant,r.store,'mapping:'+r.source+':'+r.version);
 const old=await u.one('SELECT * FROM identity_maps WHERE tenant=$1 AND store=$2 AND source=$3 AND version=$4',[c.tenant,r.store,r.source,r.version]);
 if(old)fail('CONFLICT');
 await u.client.query("INSERT INTO identity_maps(tenant,store,source,version,entries,digest,author,state) VALUES($1,$2,$3,$4,$5,$6,$7,'DRAFT')",[c.tenant,r.store,r.source,r.version,r.entries,digest(r),c.actor]);
 await u.audit({kind:'MappingDraft',tenant:c.tenant,store:r.store,source:r.source,version:r.version,digest:digest(r),actor:c.actor});return {version:r.version,digest:digest(r),state:'DRAFT'};
},options);}
async function load(u,c,r){exact(r,['source','store','version']);scope(c,r);const m=await u.one('SELECT * FROM identity_maps WHERE tenant=$1 AND store=$2 AND source=$3 AND version=$4 FOR UPDATE',[c.tenant,r.store,r.source,r.version]);if(!m)fail('NOT_FOUND');await targets(u,c,m.entries,r.store);return m;}
export function mappingReview(k,credential,r,options){return k.call(credential,'review',async(u,c)=>{
 const m=await load(u,c,r);if(m.author===c.actor||m.state!=='DRAFT')fail('PERMISSION_DENIED');
 await u.client.query("UPDATE identity_maps SET reviewer=$5,state='REVIEWED' WHERE tenant=$1 AND store=$2 AND source=$3 AND version=$4",[c.tenant,r.store,r.source,r.version,c.actor]);
 await u.audit({kind:'MappingReviewed',tenant:c.tenant,store:r.store,actor:c.actor,version:r.version,digest:m.digest});return {state:'REVIEWED',digest:m.digest};
},options);}
export function mappingPublish(k,credential,r,options){return k.call(credential,'publish',async(u,c)=>{
 const m=await load(u,c,r);if(!m.reviewer||m.state!=='REVIEWED'||m.author===c.actor)fail('PERMISSION_DENIED');
 await u.client.query("UPDATE identity_maps SET state='PUBLISHED' WHERE tenant=$1 AND store=$2 AND source=$3 AND version=$4",[c.tenant,r.store,r.source,r.version]);
 await u.audit({kind:'MappingPublished',tenant:c.tenant,store:r.store,actor:c.actor,version:r.version,digest:m.digest,author:m.author,reviewer:m.reviewer});return {state:'PUBLISHED',digest:m.digest};
},options);}
