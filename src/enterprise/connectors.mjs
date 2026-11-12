import {createHmac,timingSafeEqual} from 'node:crypto';
import {SyntheticPort} from './worker.mjs';
import {EnterpriseRepository} from '../adapters/enterprise.mjs';
import {digest,exact,fail} from '../contracts.mjs';
export const domains=['mail','calendar','accounting','hr','contract'];
// Configuration and secret values are process-owned. Commands can reference only registered names.
export class ConnectorPort extends SyntheticPort {
 constructor(registry,connection){super(connection?registry[connection.provider].url:'http://127.0.0.1:1');this.registry=registry;this.connection=connection;}
 async bind(u,object,instance){
  const r=new EnterpriseRepository(u),route=await r.one('SELECT * FROM enterprise_routes WHERE object_id=$1',[object.id]);
  if(!route||route.binding!==instance.binding)fail('STALE_APPROVAL');
  const c=await r.one('SELECT * FROM enterprise_connections WHERE tenant=$1 AND id=$2 FOR SHARE',[object.tenant,route.connection_id]);
  const cfg=c&&this.registry[c.provider];
  if(!c?.active||c.revision!==route.revision||digest(c.scope)!==digest(object.enterprise_scope)||!cfg?.secretRefs.includes(c.secret_ref)||!cfg.destinations.includes(c.destination)||!cfg.secrets[c.secret_ref]||!domains.includes(c.provider))fail('PERMISSION_DENIED');
  return new ConnectorPort(this.registry,c);
 }
 async request(method,path,body){
  const c=this.connection;if(!c)fail('PERMISSION_DENIED');const cfg=this.registry[c.provider];
  const response=await fetch(this.url+path,{method,redirect:'error',signal:AbortSignal.timeout(1500),headers:{'content-type':'application/json','authorization':'Bearer '+cfg.secrets[c.secret_ref],'x-destination':c.destination},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)fail('UNAVAILABLE');return response.json();
 }
 apply(operationId,event){
  const domain=this.connection.provider;
  const mapped={schemaVersion:1,domain,stableId:event.tenant+':'+domain+':'+event.aggregateId,revision:event.objectRevision,sourceOfTruth:'enterprise',changes:{title:event.fields.title,amount:event.fields.amount,currency:event.fields.currency},action:domain==='calendar'?'invite':domain==='mail'?'send':'upsert'};
  return this.request('POST','/effects',{operationId,event:mapped});
 }
}
export function webhookSignature(secret,timestamp,raw){return createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex');}
export async function receiveWebhook(k,tenant,connectionId,{timestamp,signature,raw}){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>65536||!/^\d+$/.test(timestamp??'')||Math.abs(k.clock()-Number(timestamp))>300000||! /^[0-9a-f]{64}$/.test(signature??''))fail('PERMISSION_DENIED');
 return k.state.transaction(async u=>{
  const r=new EnterpriseRepository(u),c=await r.one('SELECT * FROM enterprise_connections WHERE tenant=$1 AND id=$2 FOR UPDATE',[tenant,connectionId]);
  const secret=c&&k.connections[c.provider]?.secrets?.[c.secret_ref];if(!c?.active||!secret||!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(webhookSignature(secret,timestamp,raw),'hex')))fail('PERMISSION_DENIED');
  let b;try{b=JSON.parse(raw);}catch{fail('INVALID_ARGUMENT');}exact(b,['id','sequence','stableId','state']);if(typeof b.id!=='string'||!b.id.length||b.id.length>100||!Number.isSafeInteger(b.sequence)||b.sequence<1||typeof b.stableId!=='string'||!b.stableId.startsWith(tenant+':'+c.provider+':')||!['SUCCEEDED','COMPENSATED'].includes(b.state))fail('INVALID_ARGUMENT');
  const hash=digest(b),old=await r.one('SELECT * FROM enterprise_webhooks WHERE tenant=$1 AND connection_id=$2 AND event_id=$3',[tenant,connectionId,b.id]);
  if(old){if(old.digest!==hash)fail('CONFLICT');return {disposition:'DUPLICATE'};}
  const last=await r.one('SELECT max(sequence) AS n FROM enterprise_webhooks WHERE tenant=$1 AND connection_id=$2',[tenant,connectionId]);
  const disposition=b.sequence<=Number(last.n??0)?'OUT_OF_ORDER':'ACCEPTED';
  await r.query('INSERT INTO enterprise_webhooks VALUES($1,$2,$3,$4,$5,$6)',[tenant,connectionId,b.id,b.sequence,hash,disposition]);
  await u.audit({kind:'EnterpriseWebhook',tenant,connectionId,eventId:b.id,digest:hash,disposition});
  // Notifications never authorize workflow completion: reconciliation observes the independent ledger.
  return {disposition};
 });
}
