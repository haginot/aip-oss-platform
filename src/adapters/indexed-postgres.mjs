import {digest,fail} from '../contracts.mjs';
// Persistent derived read state; every response checks the same SQL snapshot.
// The canonical scan is intentional: this reference adapter makes no speed claim.
export class IndexedPostgresState {
 constructor(authoritative){this.authoritative=authoritative;}
 admission(fn,options){return this.authoritative.admission(fn,options);}
 transaction(fn,deadline,signal){return this.authoritative.transaction(u=>fn(new Proxy(u,{get(target,key){
  if(key==='objects')return async(type,tenant)=>{
   const checkpoint=await target.one('SELECT position FROM search_projection_checkpoint WHERE id=1');if(!checkpoint)fail('INCONSISTENT_STATE');
   const r=await target.one(`SELECT
    (SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM (SELECT * FROM objects WHERE type=$1 AND tenant=$2 AND NOT deleted ORDER BY id LIMIT 1001) o) AS canonical,
    (SELECT coalesce(jsonb_agg(payload ORDER BY id),'[]') FROM (SELECT * FROM search_projection WHERE payload->>'type'=$1 AND payload->>'tenant'=$2 AND NOT (payload->>'deleted')::boolean ORDER BY id LIMIT 1001) p) AS indexed`,[type,tenant]);
   if(digest(r.canonical)!==digest(r.indexed))fail('INCONSISTENT_STATE');return r.indexed;
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }})),deadline,signal);}
}
export async function refreshProjection(owner,{fault=async()=>{}}={}){
 await owner.query('BEGIN');try{
  // Writer fence and atomic checkpoint/backfill; interruption leaves the previous index intact.
  await owner.query('LOCK TABLE objects,outbox,source_receipts,source_checkpoints IN SHARE MODE');
  const events=(await owner.query('SELECT aggregate_id,sequence,event,digest FROM outbox ORDER BY aggregate_id,sequence')).rows;
  const sequences=new Map();for(const e of events){if(Number(e.sequence)!==(sequences.get(e.aggregate_id)??0)+1||digest(e.event)!==e.digest)fail('INCONSISTENT_STATE');sequences.set(e.aggregate_id,Number(e.sequence));}
  const sources=(await owner.query('SELECT tenant,store,source,position FROM source_checkpoints ORDER BY tenant,store,source')).rows;
  for(const c of sources){const r=(await owner.query('SELECT count(*)::int AS n,min(position) AS first,max(position) AS last FROM source_receipts WHERE tenant=$1 AND store=$2 AND source=$3',[c.tenant,c.store,c.source])).rows[0];if(r.n!==Number(c.position)||Number(r.first)!==1||Number(r.last)!==Number(c.position))fail('INCONSISTENT_STATE');}
  await owner.query('TRUNCATE search_projection');
  // Keep source revision and tombstones, rather than erasing deleted history from the index.
  await owner.query('INSERT INTO search_projection SELECT id,to_jsonb(o) FROM objects o');
  await fault();
  await owner.query('INSERT INTO search_projection_checkpoint VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET position=excluded.position',[{sources,outbox:Object.fromEntries(sequences)}]);
  await owner.query('COMMIT');
 }catch(e){await owner.query('ROLLBACK');throw e;}
}
// Catch-up is a bounded synthetic snapshot replay under the writer fence. Repeating it is idempotent.
export const catchUpProjection=refreshProjection;
export class AdapterSwitch {
 constructor(kernel,baseline,candidate){Object.assign(this,{kernel,baseline,candidate});}
 cutover(probes){if(!Array.isArray(probes)||probes.length===0||probes.some(p=>!p.equal))fail('INCONSISTENT_STATE');this.kernel.state=this.candidate;}
 rollback(){this.kernel.state=this.baseline;}
}
