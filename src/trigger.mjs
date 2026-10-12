import {exact,fail,digest} from './contracts.mjs';

function bind(c,row){if(!row)fail('NOT_FOUND');if(!c.stores.includes(row.store)||row.actor!==c.actor||row.subject!==c.subject||row.delegation_id!==c.delegationId)fail('PERMISSION_DENIED');}
async function schedule(u,c,id){const row=await u.one('SELECT * FROM schedules WHERE tenant=$1 AND id=$2 FOR UPDATE',[c.tenant,id]);bind(c,row);return row;}
export function scheduleCreate(k,credential,r,options){return k.call(credential,'worker',async(u,c)=>{
 exact(r,['id','version','operationId','kind','startAt','intervalMs','missedRun']);
 if(typeof r.id!=='string'||!/^[-\w]{1,100}$/.test(r.id)||r.version!=='1.0.0'||!['consume','reconcile'].includes(r.kind)||!Number.isSafeInteger(r.startAt)||r.startAt<0||!Number.isSafeInteger(r.intervalMs)||r.intervalMs<100||r.intervalMs>86400000||r.missedRun!=='coalesce')fail('INVALID_ARGUMENT');
 const event=await u.outbox(r.operationId);if(!event||event.event.tenant!==c.tenant||!c.stores.includes(event.event.store))fail('PERMISSION_DENIED');
 const hash=digest(r);await u.client.query('INSERT INTO schedules(tenant,id,store,actor,subject,delegation_id,digest,plan,next_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING',[c.tenant,r.id,event.event.store,c.actor,c.subject,c.delegationId,hash,r,r.startAt]);
 const row=await schedule(u,c,r.id);if(row.digest!==hash)fail('IDEMPOTENCY_MISMATCH');return {id:row.id,version:row.plan.version,nextAt:Number(row.next_at),inputDigest:row.digest};
},options);}
export function scheduleStatus(k,credential,r,options){return k.call(credential,'worker',async(u,c)=>{exact(r,['id']);const row=await schedule(u,c,r.id);return {id:row.id,nextAt:Number(row.next_at),fires:(await u.client.query('SELECT fire_id,slot,missed,state,result FROM schedule_fires WHERE tenant=$1 AND schedule_id=$2 ORDER BY slot DESC LIMIT 100',[c.tenant,row.id])).rows};},options);}
export async function scheduleTick(k,credential,r,options){
 const fire=await k.call(credential,'worker',async(u,c)=>{
  exact(r,['id']);const row=await schedule(u,c,r.id);
  // A pending fire survives worker failure. Replay uses the same business operation ID.
  const pending=await u.one("SELECT * FROM schedule_fires WHERE tenant=$1 AND schedule_id=$2 AND state='PENDING' ORDER BY slot LIMIT 1",[c.tenant,row.id]);
  if(pending)return {...pending,plan:row.plan};
  const now=k.clock(),next=Number(row.next_at);if(!Number.isSafeInteger(now)||now<next)return null;
  const missed=Math.floor((now-next)/row.plan.intervalMs),slot=next+missed*row.plan.intervalMs,nextAt=slot+row.plan.intervalMs;if(!Number.isSafeInteger(nextAt))fail('INVALID_ARGUMENT');
  const fireId=digest({tenant:c.tenant,id:row.id,version:row.plan.version,slot});
  await u.client.query("INSERT INTO schedule_fires(tenant,schedule_id,fire_id,slot,missed,state) VALUES($1,$2,$3,$4,$5,'PENDING')",[c.tenant,row.id,fireId,slot,missed]);
  await u.client.query('UPDATE schedules SET next_at=$3 WHERE tenant=$1 AND id=$2',[c.tenant,row.id,nextAt]);
  await u.audit({kind:'TriggerFired',actor:c.actor,onBehalfOf:c.onBehalfOf,fireId,scheduleId:row.id,slot,missed,operationId:row.plan.operationId});
  return {fire_id:fireId,plan:row.plan};
 },options);
 if(!fire)return {state:'NOT_DUE'};
 // Reauthorization happens in the original worker operation as well as acknowledgement.
 const result=await k[fire.plan.kind](credential,{operationId:fire.plan.operationId},options);
 await k.fault('trigger-after-effect');
 return k.call(credential,'worker',async(u,c)=>{
  await schedule(u,c,r.id);
  const retry=['GAP','UNKNOWN','SENDING','RETRY','PENDING'].includes(result.state);
  await u.client.query('UPDATE schedule_fires SET state=$3,result=$4 WHERE tenant=$1 AND fire_id=$2',[c.tenant,fire.fire_id,retry?'PENDING':'DONE',result]);
  await u.audit({kind:'TriggerResult',actor:c.actor,fireId:fire.fire_id,operationId:fire.plan.operationId,result});
  return {fireId:fire.fire_id,state:retry?'PENDING':'DONE',result};
 },options);
}

// Credentials are injected by the trusted launcher, never stored with schedules.
export function startScheduler(kernel,credential,{intervalMs=1000,onError=()=>{}}={}) {
 let stopped=false,timer,pending=Promise.resolve();
 const poll=async()=>{
  try {
   const ids=await kernel.call(credential,'worker',async(u,c)=>{const rows=(await u.client.query('SELECT id,store,delegation_id FROM schedules WHERE tenant=$1 AND actor=$2 AND subject=$3 ORDER BY id LIMIT 101',[c.tenant,c.actor,c.subject])).rows;if(rows.length>100)fail('RATE_LIMITED');return rows.filter(r=>c.stores.includes(r.store)&&r.delegation_id===c.delegationId).map(r=>r.id);});
   for(const id of ids){if(stopped)break;try{await kernel.scheduleTick(credential,{id});}catch(e){onError(e.code??'UNAVAILABLE');}}
  }catch(e){onError(e.code??'UNAVAILABLE');}
  if(!stopped)timer=setTimeout(()=>{pending=poll();},intervalMs);
 };
 pending=poll();return {async close(){stopped=true;clearTimeout(timer);await pending;}};
}
