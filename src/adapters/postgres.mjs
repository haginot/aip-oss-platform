import {budget,checkBudget,checkout} from '../budget.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {traceContext} from '../telemetry.mjs';
import pg from 'pg';
import { PlatformError, digest, fail, tokenDigest } from '../contracts.mjs';
export class PostgresState {
  constructor(config) { this.pool = new pg.Pool(config); }
  async close() { await this.pool.end(); }
  async transaction(fn, deadline, signal) {
    const options=budget({deadline,signal});
    for(let attempt=0;attempt<3;attempt++) {
      try { return await this.attempt(fn,options); } catch(error) {
        if(!['40001','40P01'].includes(error.code)) throw error;
        checkBudget(options);
        if(attempt===2) fail('RETRYABLE_UNAVAILABLE');
      }
    }
  }
  async attempt(fn,options) {
    const client = await checkout(this.pool,options);
    let committing=false,cancelling,authorityUntil=Infinity;
    const checkAuthority=()=>{if(Date.now()>=authorityUntil)fail('PERMISSION_DENIED');};
    // A separate connection cancels a blocked query without waiting for a pool
    // slot held by this transaction. Join it before rollback/releasing the PID.
    const cancel=()=>{if(committing||cancelling)return;const control=new pg.Client({...this.pool.options,connectionTimeoutMillis:1000});
      cancelling=(async()=>{try{await control.connect();await control.query('SELECT pg_cancel_backend($1)',[client.processID]);}catch{/* statement_timeout remains the deadline backstop */}finally{await control.end();}})();};
    options.signal?.addEventListener('abort',cancel,{once:true});
    const timer=setTimeout(cancel,Math.max(1,options.deadline-Date.now()));
    const stop=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);};
    try {
      checkBudget(options);await client.query('BEGIN');
      const scoped={requireAuthorityUntil:expires=>{
        const at=expires.getTime();
        if(!Number.isFinite(at))fail('PERMISSION_DENIED');
        authorityUntil=Math.min(authorityUntil,at);checkAuthority();
      },query:async(...args)=>{
        checkBudget(options);checkAuthority();
        await client.query("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true)",[String(Math.max(1,options.deadline-Date.now()))]);
        checkBudget(options);checkAuthority();
        const result=await client.query(...args);
        checkBudget(options);checkAuthority();return result;
      }};
      const result = await fn(new UnitOfWork(scoped));
      checkBudget(options);checkAuthority();
      // Cancellation after this point cannot be reported as a safe rollback.
      committing=true;stop();await client.query('COMMIT');
      return result;
    } catch (error) {
      stop();await cancelling;
      await client.query('ROLLBACK').catch(() => {});
      if(committing&&!['40001','40P01','57014'].includes(error.code)) throw new PlatformError('INCONSISTENT_STATE',{commitUnknown:true});
      if(!committing)checkBudget(options);
      if (error.code === '57014' || error.code === '55P03') fail('DEADLINE_EXCEEDED');
      throw error;
    } finally { stop();await cancelling;client.release(); }
  }
  async admission(fn,options={}) {
    options=budget(options);const client=await checkout(this.pool,options);let locked=false;
    try {
      while(!locked){checkBudget(options);locked=(await client.query('SELECT pg_try_advisory_lock(772341) AS locked')).rows[0].locked;
        if(!locked)await delay(Math.min(10,Math.max(1,options.deadline-Date.now())));}
      checkBudget(options);return await fn();
    } finally {if(locked)await client.query('SELECT pg_advisory_unlock(772341)');client.release();}
  }
}
class UnitOfWork {
  constructor(client) { this.client = client; }
  // SQL locks preserve revocation state, but cannot stop wall-clock expiry.
  requireAuthorityUntil(expires) { this.client.requireAuthorityUntil(expires); }
  async one(sql, values=[]) { return (await this.client.query(sql,values)).rows[0]; }
  async continuity(tenant,store) { return this.one('SELECT * FROM continuity WHERE tenant=$1 AND store=$2 FOR SHARE',[tenant,store]); }
  async recoveryHold(tenant,store,target) { return this.one("SELECT * FROM recovery_observations WHERE tenant=$1 AND store=$2 AND record->>'targetId'=$3 AND record->>'classification'='manual'",[tenant,store,target]); }
  async publicationLock() { await this.client.query('SELECT pg_advisory_xact_lock(772343)'); }
  async policy(exclusive=false) { return this.one(`SELECT * FROM policy WHERE id=1 FOR ${exclusive?'UPDATE':'SHARE'}`); }
  async identity(token) {
    return this.one('SELECT p.*, s.expires FROM sessions s JOIN principals p ON p.id=s.principal WHERE s.digest=$1 FOR SHARE OF p,s', [tokenDigest(token)]);
  }
  async principal(id) { return this.one('SELECT * FROM principals WHERE id=$1 FOR SHARE',[id]); }
  async delegation(id) { return this.one('SELECT * FROM delegations WHERE id=$1 FOR SHARE',[id]); }
  async definition() { return this.one('SELECT d.* FROM live_definition l JOIN definitions d ON d.version=l.version WHERE l.id=1 FOR SHARE OF l'); }
  async getDefinition(version) { return this.one('SELECT * FROM definitions WHERE version=$1',[version]); }
  async saveDefinition(body,author) { await this.client.query('INSERT INTO definitions(version,digest,body,author,reviewer,state,simulation) VALUES ($1,$2,$3,$4,NULL,\'DRAFT\',NULL)',[body.ontologyVersion,digest(body),body,author]); }
  async editCases(row,cases) {
    const changed=await this.one("UPDATE definitions SET cases=$2,cases_revision=cases_revision+1,reviewer=NULL,simulation=NULL,state='DRAFT' WHERE version=$1 AND author=$3 AND state IN ('DRAFT','REVIEWED') AND cases_revision=$4 RETURNING version",[row.version,JSON.stringify(cases),row.author,row.cases_revision]);
    if(!changed)fail('STALE_REVIEW');
  }
  async reviewDefinition(row, reviewer, simulation) {
    // CAS is evaluated against the committed row, including edits that restore the same cases.
    const changed=await this.one("UPDATE definitions SET state='REVIEWED',reviewer=$2,simulation=$3 WHERE version=$1 AND state='DRAFT' AND cases_revision=$4 AND cases=$5 AND digest=$6 RETURNING version",[row.version,reviewer,simulation,row.cases_revision,JSON.stringify(row.cases),row.digest]);
    if(!changed)fail('STALE_REVIEW');
  }
  async publish(row) {
    // Acquire the definition row by CAS before changing the live pointer or Policy epoch.
    // The row remains locked through the same transaction's Audit and commit.
    const changed=await this.one("UPDATE definitions SET state='PUBLISHED' WHERE version=$1 AND state=$2 AND cases_revision=$3 AND cases=$4 AND digest=$5 AND reviewer=$6 AND simulation=$7 RETURNING version",[row.version,row.state,row.cases_revision,JSON.stringify(row.cases),row.digest,row.reviewer,row.simulation]);
    if(!changed)fail('STALE_REVIEW');
    await this.client.query('UPDATE policy SET version=$1,epoch=epoch+1 WHERE id=1',[row.body.policyVersion]);
    await this.client.query('UPDATE live_definition SET version=$1 WHERE id=1',[row.version]);
  }
  async object(id, lock=false) { return this.one(`SELECT * FROM objects WHERE id=$1 AND NOT deleted${lock?' FOR UPDATE':''}`,[id]); }
  async objects(type,tenant) { return (await this.client.query('SELECT * FROM objects WHERE type=$1 AND tenant=$2 AND NOT deleted ORDER BY id LIMIT 1001',[type,tenant])).rows; }
  async history(id,afterRevision,limit,asOfRevision) { return (await this.client.query('SELECT * FROM history WHERE object_id=$1 AND revision>$2 AND revision<=$4 ORDER BY revision LIMIT $3',[id,afterRevision,limit,asOfRevision])).rows; }
  async endpoints(id,link) { return (await this.client.query('SELECT o.* FROM links l JOIN objects o ON o.id=l.target WHERE l.source=$1 AND l.type=$2 AND NOT o.deleted ORDER BY o.id LIMIT 1001',[id,link])).rows; }
  async observations(c) {
    const actions=(await this.client.query('SELECT state,count(*)::int AS count FROM actions WHERE tenant=$1 AND store=ANY($2) GROUP BY state ORDER BY state',[c.tenant,c.stores])).rows;
    const outbox=(await this.client.query("SELECT o.state,count(*)::int AS count, GREATEST(0,EXTRACT(EPOCH FROM (now()-MIN(o.created_at))))::float8 AS \"oldestAgeSeconds\" FROM outbox o JOIN actions a ON a.id=o.action_id WHERE a.tenant=$1 AND a.store=ANY($2) GROUP BY o.state ORDER BY o.state",[c.tenant,c.stores])).rows;
    const sources=(await this.client.query('SELECT source,store,position FROM source_checkpoints WHERE tenant=$1 AND store=ANY($2) ORDER BY source,store LIMIT 100',[c.tenant,c.stores])).rows.map(r=>({...r,position:Number(r.position)}));
    return {actions,outbox,sources};
  }
  async sourceLock(tenant,store,source) { await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([tenant,store,source])]); }
  async sourceObject(id) { return this.one('SELECT * FROM objects WHERE id=$1 FOR UPDATE',[id]); }
  async sourceCheckpoint(tenant,store,source) { return this.one('SELECT * FROM source_checkpoints WHERE tenant=$1 AND store=$2 AND source=$3',[tenant,store,source]); }
  async sourceReceipt(tenant,store,source,position) { return this.one('SELECT * FROM source_receipts WHERE tenant=$1 AND store=$2 AND source=$3 AND position=$4',[tenant,store,source,position]); }
  async sourceReceipts(tenant,store,source,after,limit) { return (await this.client.query('SELECT result FROM source_receipts WHERE tenant=$1 AND store=$2 AND source=$3 AND position>$4 ORDER BY position LIMIT $5',[tenant,store,source,after,limit])).rows.map(r=>r.result); }
  async saveSourceReceipt(c,store,source,position,hash,result) {
    await this.client.query('INSERT INTO source_receipts VALUES($1,$2,$3,$4,$5,$6)',[c.tenant,store,source,position,hash,result]);
    await this.client.query('INSERT INTO source_checkpoints VALUES($1,$2,$3,$4) ON CONFLICT(tenant,store,source) DO UPDATE SET position=excluded.position',[c.tenant,store,source,position]);
  }
  async ingestObject(o) {
    const result=await this.one("INSERT INTO objects(id,tenant,store,type,revision,fields,source_position,deleted,source_owner) VALUES($1,$2,$3,'InventoryPosition',1,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET revision=objects.revision+1,fields=excluded.fields,source_position=excluded.source_position,deleted=excluded.deleted,updated_at=now() RETURNING *",[o.id,o.tenant,o.store,o.fields,o.sourcePosition,o.deleted,o.source]);
    await this.client.query('INSERT INTO history(object_id,revision,fields,source_position,valid_at,deleted) VALUES($1,$2,$3,$4,$5,$6)',[o.id,result.revision,o.fields,o.sourcePosition,o.validAt,o.deleted]);return result;
  }
  async sourceLinks(record) {
    await this.client.query("DELETE FROM links WHERE target=$1 AND type IN ('stock','storeStock')",[record.id]);
    await this.client.query("INSERT INTO links VALUES($1,$3,'stock'),($2,$3,'storeStock')",[record.lotId,record.storeId,record.id]);
  }
  async nextSequence(id) { return (await this.one('SELECT coalesce(max(sequence),0)+1 AS value FROM outbox WHERE aggregate_id=$1',[id])).value; }
  async existing(tenant,subject,key) { return this.one('SELECT * FROM actions WHERE tenant=$1 AND subject=$2 AND key=$3',[tenant,subject,key]); }
  async action(id, lock=false) { return this.one(`SELECT * FROM actions WHERE id=$1${lock?' FOR UPDATE':''}`,[id]); }
  async saveAction(a) { await this.client.query('INSERT INTO actions VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,$11)',[a.id,a.tenant,a.subject,a.actor,a.store,a.key,a.digest,a.state,a.request,a.result,a.operation_id]); }
  async updateAction(id,state,result) { await this.client.query('UPDATE actions SET state=$2,revision=revision+1,result=$3 WHERE id=$1',[id,state,result]); }
  async mutate(object,fields,actionId) {
    const result = await this.one('UPDATE objects SET fields=$3,revision=revision+1,source_position=$4,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING *',[object.id,object.revision,fields,`action:${actionId}`]);
    if (!result) fail('CONFLICT');
    await this.client.query('INSERT INTO history(object_id,revision,fields,action_id) VALUES ($1,$2,$3,$4)',[object.id,result.revision,fields,actionId]);
    return result;
  }
  async enqueue(event) { await this.client.query('INSERT INTO outbox(operation_id,action_id,aggregate_id,sequence,event,digest) VALUES($1,$2,$3,$4,$5,$6)',[event.operationId,event.actionId,event.aggregateId,event.sequence,event,digest(event)]); }
  async audit(record) {
    record={...record,...traceContext.getStore(),at:new Date().toISOString()};
    // Serialize hash-chain append independently of sequence allocation and concurrent read audits.
    await this.client.query('SELECT pg_advisory_xact_lock(772342)');
    const last = await this.one('SELECT hash FROM audit ORDER BY sequence DESC LIMIT 1');
    const previous = last?.hash ?? 'GENESIS';
    const hash = digest({previous,record});
    await this.client.query('INSERT INTO audit(previous_hash,hash,record) VALUES($1,$2,$3)',[previous,hash,record]);
    return hash;
  }
  async snapshot(data) { await this.client.query('INSERT INTO snapshots VALUES($1,$2,$3,$4,$5,$6,$7)',[data.id,data.subject,data.query_digest,data.policy_epoch,data.ontology_version,JSON.stringify(data.items),data.expires]); }
  async getSnapshot(id) { return this.one('SELECT * FROM snapshots WHERE id=$1 FOR SHARE',[id]); }
  async outbox(operationId,lock=false) { return this.one(`SELECT * FROM outbox WHERE operation_id=$1${lock?' FOR UPDATE':''}`,[operationId]); }
  async inbox(operationId) { return this.one('SELECT * FROM inbox WHERE operation_id=$1',[operationId]); }
  async projection(id) { return this.one('SELECT * FROM projection WHERE aggregate_id=$1 FOR UPDATE',[id]); }
  async consume(event,hash) {
    await this.client.query('INSERT INTO inbox VALUES ($1,$2)',[event.operationId,hash]);
    await this.client.query('INSERT INTO projection VALUES($1,$2,$3) ON CONFLICT(aggregate_id) DO UPDATE SET sequence=excluded.sequence, fields=excluded.fields',[event.aggregateId,event.sequence,event.fields]);
  }
  async lease(operationId,owner) {
    return this.one("UPDATE outbox SET lease_owner=$2,lease_until=now()+interval '5 seconds',attempt=attempt+1 WHERE operation_id=$1 AND state='PENDING' AND (lease_until IS NULL OR lease_until<now()) RETURNING *",[operationId,owner]);
  }
  async sending(operationId) { await this.client.query("UPDATE outbox SET state='SENDING' WHERE operation_id=$1",[operationId]); }
  async finish(operationId,state) { await this.client.query('UPDATE outbox SET state=$2,lease_until=NULL,lease_owner=NULL WHERE operation_id=$1',[operationId,state]); }
}
