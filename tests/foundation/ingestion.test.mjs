import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {createGateway} from '../../src/gateway.mjs';
import {createClient} from '../../src/generated/client.mjs';
let cluster;before(async()=>{cluster=await startCluster();});after(async()=>{await cluster?.close();});
const code=c=>e=>e.code===c;
const change=(position=1,overrides={})=>({source:'inventory',store:'s1',position,expectedPosition:position-1,record:{id:'source:rice',deleted:false,name:'source rice',quantity:9,unit:'each',lotId:'lot',storeId:'store',validAt:'2026-10-12T00:00:00.000Z'},...overrides});
async function run(fn){const f=await fixture(cluster);try{await fn(f);}finally{await f.close();}}
test('HTTP source ingestion joins checkpoint, quality, links, authorized history, Action and Audit; quarantine release has lineage',()=>run(async f=>{
 const server=createGateway(f.kernel);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
 const client=createClient({url:`http://127.0.0.1:${server.address().port}`,tenant:'t1',token:f.credentials.manager.token});
 const first=change();const applied=await client.ingest(first);assert.equal(applied.state,'APPLIED');assert.deepEqual(await client.ingest(first),applied);
 await assert.rejects(client.ingest({...first,record:{...first.record,quantity:8}}),code('IDEMPOTENCY_MISMATCH'));
 const bad=change(2,{record:{...first.record,quantity:-1}});const quarantined=await client.ingest(bad);assert.equal(quarantined.state,'QUARANTINED');assert.equal((await client.get({id:first.record.id})).revision,1);
 const released=await client.ingest(change(3,{releases:2}));assert.equal(released.releases,2);assert.equal(released.revision,2);
 assert.ok((await client.traverse({id:'lot',link:'stock'})).items.some(o=>o.id===first.record.id));
 const action=await client.submit(f.request({input:{targetId:first.record.id,isolated:true},expectedRevision:2}));
 const history=await client.history({id:first.record.id});assert.equal(history.items.length,3);assert.equal(history.items[0].sourcePosition,'inventory:1');assert.equal(history.items[2].actionId,action.actionId);
 assert.equal((await client.sourceStatus({source:'inventory',store:'s1'})).checkpoint,3);
 const rows=(await f.owner.query('SELECT record FROM audit')).rows.map(r=>r.record);assert.ok(rows.some(r=>r.kind==='SourceIngested'&&r.position===3&&r.releases===2));assert.ok(rows.some(r=>r.actionId===action.actionId));
 const trace={source:first.source,applied,quarantined,released,action,history,audit:rows};await mkdir('evidence/generated/foundation',{recursive:true});await writeFile('evidence/generated/foundation/ingestion-trace.json',JSON.stringify(trace,null,2));
 }finally{await new Promise(r=>server.close(r));}
}));
test('source gap, transform error, cross-store scope and source owner conflict never advance checkpoint',()=>run(async f=>{
 await assert.rejects(f.kernel.ingest(f.credentials.operator,change()),code('PERMISSION_DENIED'));
 await assert.rejects(f.kernel.ingest(f.credentials.other,change()),code('PERMISSION_DENIED'));
 await assert.rejects(f.kernel.ingest(f.credentials.manager,change(2)),code('SOURCE_GAP'));
 await assert.rejects(f.kernel.ingest(f.credentials.manager,change(1,{record:{...change().record,unit:'kg'}})),code('INVALID_UNIT'));
 assert.equal((await f.kernel.sourceStatus(f.credentials.manager,{source:'inventory',store:'s1'})).checkpoint,0);
 await f.kernel.ingest(f.credentials.manager,change());
 await assert.rejects(f.kernel.ingest(f.credentials.manager,change(1,{source:'other-source'})),code('CONFLICT'));
 await assert.rejects(f.kernel.history(f.credentials.manager,{id:'source:rice',projection:['secret']}),code('PERMISSION_DENIED'));
}));
test('source transaction rolls back Object/history/checkpoint/receipt on both injected partial failure boundaries',()=>run(async f=>{
 for(const point of ['after-source-object','after-source-checkpoint']){
 f.kernel.fault=async p=>{if(p===point)throw Error('injected');};await assert.rejects(f.kernel.ingest(f.credentials.manager,change()));
 for(const table of ['source_checkpoints','source_receipts','history'])assert.equal((await f.owner.query(`SELECT count(*) FROM ${table}`)).rows[0].count,'0');
 assert.equal((await f.owner.query("SELECT count(*) FROM objects WHERE id='source:rice'")).rows[0].count,'0');
 }
 f.kernel.fault=async()=>{};assert.equal((await f.kernel.ingest(f.credentials.manager,change())).state,'APPLIED');
}));
test('parallel same source position serializes, tombstone hides query/link, resurrection preserves revision and Action ownership',()=>run(async f=>{
 const request=change();const results=await Promise.all([f.kernel.ingest(f.credentials.manager,request),f.kernel.ingest(f.credentials.manager,request)]);assert.deepEqual(results[0],results[1]);
 await f.kernel.submit(f.credentials.operator,f.request({input:{targetId:'source:rice',isolated:true},expectedRevision:1}));
 await f.kernel.ingest(f.credentials.manager,change(2));assert.equal((await f.kernel.get(f.credentials.operator,{id:'source:rice'})).fields.isolated,true);
 await f.kernel.ingest(f.credentials.manager,change(3,{record:{id:'source:rice',deleted:true,validAt:request.record.validAt}}));
 await assert.rejects(f.kernel.get(f.credentials.operator,{id:'source:rice'}),code('NOT_FOUND'));
 assert.ok(!(await f.kernel.traverse(f.credentials.operator,{id:'lot',link:'stock'})).items.some(o=>o.id==='source:rice'));
 assert.equal((await f.kernel.ingest(f.credentials.manager,change(4))).revision,5);
 await assert.rejects(f.state.transaction(u=>u.client.query('DELETE FROM source_receipts')));
 await assert.rejects(f.state.transaction(u=>u.client.query('DELETE FROM history')));
}));
