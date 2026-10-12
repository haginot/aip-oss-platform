import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { digest, tokenDigest } from '../../src/contracts.mjs';
import { PostgresState } from '../../src/adapters/postgres.mjs';
import { RecoveryJournal } from '../../src/adapters/journal.mjs';
import { Kernel } from '../../src/kernel.mjs';
const root=resolve(import.meta.dirname,'../..');
export async function startCluster({baseDirectory=tmpdir()}={}) {
  const directory=await mkdtemp(join(baseDirectory,'aip-foundation-'));
  // Unix socket paths have a platform length limit; mount paths may be long.
  const data=join(directory,'db'), socket=await mkdtemp(join(tmpdir(),'aip-socket-'));
  const port=20000+Math.floor(Math.random()*30000);
  const command=(name,args)=>execFileSync(name,args,{encoding:'utf8',timeout:30000});
  try {
    command('initdb',['-D',data,'-U','foundation_owner','-A','trust','--no-locale','-E','UTF8']);
    command('pg_ctl',['-D',data,'-l',join(directory,'postgres.log'),'-o',`-k ${socket} -p ${port} -c listen_addresses=''`,'-w','start']);
  } catch(error) { const log=await readFile(join(directory,'postgres.log'),'utf8').catch(()=>null);await rm(socket,{recursive:true,force:true});await rm(directory,{recursive:true,force:true});if(log)error.message+='\n'+log;throw error; }
  const config={host:socket,port,user:'foundation_owner',database:'postgres'};
  const admin=new pg.Pool(config);
  const version=(await admin.query('SHOW server_version')).rows[0].server_version;
  await admin.query('CREATE ROLE foundation_app LOGIN');
  await admin.query('CREATE ROLE synthetic_erp LOGIN');
  return {directory,config,admin,version,async close(){await admin.end();command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);await rm(socket,{recursive:true,force:true});await rm(directory,{recursive:true,force:true});}};
}
export async function fixture(cluster,{fault,journalDirectory=cluster.directory,definitionPath='config/ontology.json'}={}) {
  const schema='s_'+randomBytes(8).toString('hex');
  await cluster.admin.query(`CREATE SCHEMA ${schema}`);
  const owner=new pg.Pool({...cluster.config,options:`-c search_path=${schema},public`});
  await owner.query(await readFile(join(root,'migrations/001-foundation.sql'),'utf8'));
  const definition=JSON.parse(await readFile(join(root,definitionPath),'utf8'));
  await owner.query("INSERT INTO policy VALUES(1,'1.0.0',1,true)");
  await owner.query("INSERT INTO definitions(version,digest,body,author,reviewer,state,simulation) VALUES($1,$2,$3,'bootstrap','bootstrap-review','PUBLISHED',$4)",[definition.ontologyVersion,digest(definition),definition,{bootstrap:true,casesDigest:digest([]),casesRevision:0,digest:digest(definition)}]);
  await owner.query('INSERT INTO live_definition VALUES(1,$1)',[definition.ontologyVersion]);
  const credentials={};
  const permissions=['read','search','action','tool','approve','worker','recovery','author','review','publish','ingest','observe'];
  const users=[['operator','t1',['s1'],['read','search','action','tool']],['manager','t1',['s1'],permissions],['agent','t1',['s1','s2'],['read','search','action','tool']],['reader','t1',['s1'],['read','search','tool']],['other','t1',['s2'],permissions],['tenant2','t2',['s1'],permissions],['reviewer','t1',['s1'],permissions],['publisher','t1',['s1'],permissions],['writeback-service','t1',['s1'],['secret']]];
  for(const [id,tenant,stores,ops] of users) {
    await owner.query('INSERT INTO principals(id,tenant,stores,operations) VALUES($1,$2,$3,$4)',[id,tenant,JSON.stringify(stores),JSON.stringify(ops)]);
    const token=randomBytes(32).toString('hex');credentials[id]={token};
    await owner.query("INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",[tokenDigest(token),id]);
  }
  await owner.query("INSERT INTO delegations VALUES('delegation','agent','operator','kernel',$1,$2,now()+interval '1 hour',true)",[JSON.stringify(['s1']),JSON.stringify(['read','search','action','tool'])]);
  credentials.delegated={...credentials.agent,delegationId:'delegation'};
  for(const [id,tenant,store,type,fields] of [
    ['store','t1','s1','Store',{name:'Store One',secret:'private-store'}],
    ['lot','t1','s1','Lot',{name:'recall lot',secret:'private-lot'}],
    ['stock','t1','s1','InventoryPosition',{name:'rice recall',quantity:10,isolated:false,note:null,secret:'hidden-word'}],
    ['stock2','t1','s1','InventoryPosition',{name:'rice second',quantity:5,isolated:false,note:null,secret:'hidden-word'}],
    ['foreign','t1','s2','InventoryPosition',{name:'rice hidden',quantity:20,isolated:false,note:null,secret:'hidden-word'}],
    ['tenant-stock','t2','s1','InventoryPosition',{name:'rice tenant',quantity:30,isolated:false,note:null,secret:'hidden-word'}]]) {
    await owner.query('INSERT INTO objects(id,tenant,store,type,revision,fields,source_position) VALUES($1,$2,$3,$4,1,$5,$6)',[id,tenant,store,type,fields,'seed:1']);
  }
  await owner.query("INSERT INTO links VALUES('lot','stock','stock'),('lot','foreign','stock'),('store','stock','storeStock')");
  await owner.query(`GRANT USAGE ON SCHEMA ${schema} TO foundation_app`);
  await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO foundation_app`);
  await owner.query(`GRANT INSERT ON continuity,recovery_observations,schedules,schedule_fires,identity_maps,evidence_blobs,telemetry,pipeline_jobs,objects,links,source_checkpoints,source_receipts,actions,outbox,audit,history,inbox,projection,snapshots,definitions TO foundation_app`);
  // PostgreSQL requires UPDATE privilege for SELECT ... FOR SHARE, including
  // the policy and identity rows that are locked during authorization.
  await owner.query('GRANT UPDATE ON continuity,recovery_observations,schedules,schedule_fires,identity_maps,pipeline_jobs,source_checkpoints,policy,principals,sessions,delegations,objects,actions,outbox,projection,snapshots,definitions,live_definition TO foundation_app');
  await owner.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${schema} TO foundation_app`);
  await owner.query('GRANT DELETE ON links TO foundation_app');
  const state=new PostgresState({...cluster.config,user:'foundation_app',options:`-c search_path=${schema},public`});
  const journal=new RecoveryJournal(join(journalDirectory,schema,'journal.ndjson'),{bootstrap:true});
  const kernel=new Kernel(state,journal,{fault});
  return {owner,state,journal,kernel,credentials,definition,request(overrides={}){return {actionType:'SetIsolation',actionVersion:'1.0.0',ontologyVersion:'1.0.0',input:{targetId:'stock',isolated:true},expectedRevision:1,idempotencyKey:randomBytes(8).toString('hex'),evidence:[],...overrides};},async close(){await state.close();await owner.end();}};
}
