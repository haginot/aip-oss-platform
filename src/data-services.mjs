import {createHash} from 'node:crypto';
import {exact,fail,digest} from './contracts.mjs';
import {authorize,canRead} from './security.mjs';

export function blobPut(k,credential,r,options){return k.call(credential,'ingest',async(u,c)=>{
 exact(r,['objectId','base64','sha256']);
 const object=await u.object(r.objectId);authorize(c,object);
 if(typeof r.base64!=='string'||r.base64.length>87384||typeof r.sha256!=='string')fail('INVALID_ARGUMENT');
 const bytes=Buffer.from(r.base64,'base64');
 if(bytes.length>65536||bytes.toString('base64')!==r.base64)fail('INVALID_ARGUMENT');
 const hash=createHash('sha256').update(bytes).digest('hex');if(hash!==r.sha256)fail('HASH_MISMATCH');
 await u.client.query('INSERT INTO evidence_blobs(tenant,store,object_id,hash,content) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[c.tenant,object.store,object.id,hash,bytes]);
 const result={uri:`blob:${object.id}:${hash}`,objectId:object.id,sha256:hash,version:hash,size:bytes.length,retention:'indefinite-hold'};
 await u.audit({kind:'BlobStored',tenant:c.tenant,store:object.store,actor:c.actor,...result});return result;
},options);}
export function blobRead(k,credential,r,options){return k.call(credential,'read',async(u,c)=>{
 exact(r,['objectId','sha256','start','end'],['objectId','sha256']);
 const object=await u.object(r.objectId);authorize(c,object,true);
 const row=await u.one('SELECT content FROM evidence_blobs WHERE tenant=$1 AND object_id=$2 AND hash=$3',[c.tenant,object.id,r.sha256]);if(!row)fail('NOT_FOUND');
 const start=r.start??0,end=r.end??row.content.length;
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>row.content.length)fail('INVALID_ARGUMENT');
 if(createHash('sha256').update(row.content).digest('hex')!==r.sha256)fail('INCONSISTENT_STATE');
 return {base64:row.content.subarray(start,end).toString('base64'),sha256:r.sha256,version:r.sha256,start,end,size:row.content.length,retention:'indefinite-hold'};
},options);}
export function blobDelete(k,credential,r,options){return k.call(credential,'ingest',async(u,c)=>{exact(r,['objectId','sha256']);authorize(c,await u.object(r.objectId));fail('RETENTION_HOLD');},options);}

export function analytics(k,credential,r,options){return k.call(credential,'read',async(u,c,d)=>{
 exact(r,['template','version','ontologyVersion','store']);
 if(r.template!=='inventory-summary')fail('UNSUPPORTED_CAPABILITY');if(r.version!=='1.0.0'||r.ontologyVersion!==d.ontologyVersion)fail('UNSUPPORTED_VERSION');
 if(!c.stores.includes(r.store))fail('PERMISSION_DENIED');
 const objects=await u.objects('InventoryPosition',c.tenant);if(objects.length>1000)fail('RATE_LIMITED');
 const rows=objects.filter(o=>canRead(c,o)&&o.store===r.store);
 let quantity=0,isolatedQuantity=0;
 for(const row of rows){quantity+=row.fields.quantity;if(row.fields.isolated)isolatedQuantity+=row.fields.quantity;if(!Number.isSafeInteger(quantity)||!Number.isSafeInteger(isolatedQuantity))fail('INVALID_ARGUMENT');}
 const lineage=rows.map(o=>({id:o.id,revision:o.revision,sourcePosition:o.source_position}));
 return {template:r.template,version:r.version,ontologyVersion:d.ontologyVersion,policyVersion:c.policyVersion,grain:'store',store:r.store,timeSemantics:'current-recorded-snapshot',unit:'each',count:rows.length,quantity,isolatedQuantity,snapshot:digest(lineage),lineage};
},options);}
