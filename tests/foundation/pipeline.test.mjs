import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {createGateway} from '../../src/gateway.mjs';
import {createClient} from '../../src/generated/client.mjs';
let cluster;before(async()=>{cluster=await startCluster();});after(async()=>{await cluster?.close();});
const code=c=>e=>e.code===c;
const record={id:'source:rice',deleted:false,name:'rice',quantity:8,unit:'each',lotId:'lot',storeId:'store',validAt:'2026-10-12T00:00:00.000Z'};
const plan=()=>({id:'snapshot-tail',source:'inventory',store:'s1',jobVersion:'1.0.0',barrier:1,snapshot:[{position:1,record}],changes:[{position:1,record},{position:2,record:{id:record.id,deleted:true,validAt:record.validAt}}],dependencies:[]});
async function run(fn){const f=await fixture(cluster);try{await fn(f);}finally{await f.close();}}
test('HTTP snapshot/change overlap, duplicate start, delete and dependency use durable job/source receipts',()=>run(async f=>{
 const server=createGateway(f.kernel);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
 const client=createClient({url:`http://127.0.0.1:${server.address().port}`,tenant:'t1',token:f.credentials.manager.token});
 const p=plan(),starts=await Promise.all([client.pipelineStart(p),client.pipelineStart(p)]);assert.deepEqual(starts[0],starts[1]);
 await assert.rejects(client.pipelineStart({...p,barrier:0,snapshot:[]}),code('IDEMPOTENCY_MISMATCH'));
 await assert.rejects(client.pipelineStart({...p,id:'dependent',dependencies:[p.id]}),code('DEPENDENCY_PENDING'));
 const steps=[];for(let i=0;i<3;i++)steps.push(await client.pipelineStep({id:p.id}));
 assert.equal(steps[0].receipt.revision,1);assert.deepEqual(steps[0].receipt,steps[1].receipt);
 assert.equal(steps[2].state,'SUCCEEDED');assert.equal(steps[2].receipt.revision,2);
 await assert.rejects(client.get({id:record.id}),code('NOT_FOUND'));
 assert.equal((await client.history({id:record.id})).items.length,2);
 assert.equal((await client.sourceStatus({store:'s1',source:p.source})).checkpoint,2);
 const done=await client.pipelineStatus({id:p.id});assert.deepEqual(await client.pipelineStep({id:p.id}),done);
 assert.equal((await client.pipelineStart({...p,id:'dependent',dependencies:[p.id]})).state,'READY');
 const audit=(await f.owner.query("SELECT record FROM audit WHERE record->>'kind' IN ('PipelineCheckpoint','SourceIngested')")).rows;
 assert.equal(audit.filter(r=>r.record.kind==='PipelineCheckpoint').length,3);
 assert.equal(audit.filter(r=>r.record.kind==='SourceIngested').length,2);
 await mkdir('evidence/generated/foundation',{recursive:true});await writeFile('evidence/generated/foundation/pipeline-trace.json',JSON.stringify({starts,steps,done,audit},null,2));
 }finally{await new Promise(r=>server.close(r));}
}));
test('snapshot mismatch, source gap/reorder, cancellation and revoked scope reject without advancing state',()=>run(async f=>{
 const p=plan();
 for(const changes of [[{position:3,record}],[{position:2,record},{position:4,record}]])await assert.rejects(f.kernel.pipelineStart(f.credentials.manager,{...p,changes}),code('SOURCE_GAP'));
 await assert.rejects(f.kernel.pipelineStart(f.credentials.manager,{...p,changes:[{position:1,record:{...record,quantity:99}}]}),code('IDEMPOTENCY_MISMATCH'));
 await f.kernel.pipelineStart(f.credentials.manager,p);
 await assert.rejects(f.kernel.pipelineStep(f.credentials.other,{id:p.id}),code('PERMISSION_DENIED'));
 await assert.rejects(f.kernel.pipelineStep(f.credentials.operator,{id:p.id}),code('PERMISSION_DENIED'));
 await f.kernel.pipelineCancel(f.credentials.manager,{id:p.id});
 await assert.rejects(f.kernel.pipelineStep(f.credentials.manager,{id:p.id}),code('CANCELLED'));
 assert.equal((await f.kernel.sourceStatus(f.credentials.manager,{source:p.source,store:p.store})).checkpoint,0);
 assert.equal((await f.kernel.pipelineStart(f.credentials.manager,p)).state,'CANCELLED');
 await f.owner.query("UPDATE principals SET active=false WHERE id='manager'");
 await assert.rejects(f.kernel.pipelineStatus(f.credentials.manager,{id:p.id}),code('PERMISSION_DENIED'));
}));
for(const point of ['pipeline-before-checkpoint','pipeline-after-checkpoint'])test(`SIGKILL ${point}: restart from atomic checkpoint has no duplicate history or source effect`,()=>run(async f=>{
 const p=plan();await f.kernel.pipelineStart(f.credentials.manager,p);
 const child=fork(new URL('../../scripts/foundation/pipeline-process.mjs',import.meta.url),[],{stdio:['ignore','pipe','pipe','ipc']});
 const exited=once(child,'exit'),timer=setTimeout(()=>child.kill('SIGTERM'),10000);
 child.send({config:{...cluster.config,user:'foundation_app',options:f.state.pool.options.options},journalPath:f.journal.path,credential:f.credentials.manager,id:p.id,stopAt:point});
 try{assert.deepEqual(await exited,[null,'SIGKILL']);}finally{clearTimeout(timer);}
 const expected=point==='pipeline-after-checkpoint'?1:0;
 assert.equal((await f.kernel.pipelineStatus(f.credentials.manager,{id:p.id})).cursor,expected);
 for(const table of ['history','source_receipts'])assert.equal(Number((await f.owner.query(`SELECT count(*) FROM ${table}`)).rows[0].count),expected);
 for(let i=expected;i<3;i++)await f.kernel.pipelineStep(f.credentials.manager,{id:p.id});
 assert.equal((await f.kernel.pipelineStatus(f.credentials.manager,{id:p.id})).state,'SUCCEEDED');
 assert.equal((await f.owner.query('SELECT count(*) FROM history')).rows[0].count,'2');
 assert.equal((await f.owner.query('SELECT revision FROM objects WHERE id=$1',[record.id])).rows[0].revision,2);
}));
