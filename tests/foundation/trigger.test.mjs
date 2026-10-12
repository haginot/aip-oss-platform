import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {Kernel} from '../../src/kernel.mjs';
import {startScheduler} from '../../src/trigger.mjs';
import {createGateway} from '../../src/gateway.mjs';
import {createClient} from '../../src/generated/client.mjs';
import {startErp} from '../../scripts/foundation/erp.mjs';
import {Writeback,HttpWritebackPort} from '../../src/writeback.mjs';
let cluster;before(async()=>{cluster=await startCluster();});after(async()=>{await cluster?.close();});
const code=c=>e=>e.code===c;
async function run(fn){const f=await fixture(cluster),server=createGateway(f.kernel);await new Promise(r=>server.listen(0,'127.0.0.1',r));const client=createClient({url:`http://127.0.0.1:${server.address().port}`,tenant:'t1',...f.credentials.manager});try{await fn(f,client);}finally{await new Promise(r=>server.close(r));await f.close();}}
const plan=operationId=>({id:'catchup',version:'1.0.0',operationId,kind:'consume',startAt:1000,intervalMs:100,missedRun:'coalesce'});
test('public durable scheduler coalesces forward clock jump, refuses duplicate/backward fire and reauthorizes',()=>run(async(f,c)=>{
 const a=await f.kernel.submit(f.credentials.operator,f.request());const p=plan(a.operationId);f.kernel.clock=()=>990;
 const first=await c.scheduleCreate(p);assert.deepEqual(await c.scheduleCreate(p),first);
 await assert.rejects(c.scheduleCreate({...p,intervalMs:200}),code('IDEMPOTENCY_MISMATCH'));
 assert.equal((await c.scheduleTick({id:p.id})).state,'NOT_DUE');f.kernel.clock=()=>1350;
 const fire=await c.scheduleTick({id:p.id});assert.equal(fire.result.state,'DELIVERED');
 const status=await c.scheduleStatus({id:p.id});assert.equal(status.nextAt,1400);assert.equal(Number(status.fires[0].missed),3);
 const dup=await Promise.all([c.scheduleTick({id:p.id}),c.scheduleTick({id:p.id})]);assert.ok(dup.every(x=>x.state==='NOT_DUE'));
 f.kernel.clock=()=>900;assert.equal((await c.scheduleTick({id:p.id})).state,'NOT_DUE');
 await assert.rejects(f.kernel.scheduleTick(f.credentials.other,{id:p.id}),code('PERMISSION_DENIED'));
 await f.owner.query("UPDATE principals SET active=false WHERE id='operator'");f.kernel.clock=()=>1400;
 await assert.rejects(c.scheduleTick({id:p.id}),code('PERMISSION_DENIED'));
 assert.equal((await f.owner.query('SELECT count(*) FROM inbox')).rows[0].count,'1');
}));
test('failure between effect and fire acknowledgement resumes same fire ID with Inbox duplicate suppression',()=>run(async(f,c)=>{
 const a=await f.kernel.submit(f.credentials.operator,f.request());await c.scheduleCreate(plan(a.operationId));f.kernel.clock=()=>1000;
 f.kernel.fault=async point=>{if(point==='trigger-after-effect')throw Error('worker lost after commit');};
 await assert.rejects(c.scheduleTick({id:'catchup'}),code('UNAVAILABLE'));
 const before=await c.scheduleStatus({id:'catchup'});assert.equal(before.fires[0].state,'PENDING');
 const reopened=new Kernel(f.state,f.journal,{clock:()=>1000});
 const result=await reopened.scheduleTick(f.credentials.manager,{id:'catchup'});assert.equal(result.fireId,before.fires[0].fire_id);assert.equal(result.result.state,'DUPLICATE');
 assert.equal((await f.owner.query('SELECT count(*) FROM inbox')).rows[0].count,'1');assert.equal((await f.owner.query('SELECT count(*) FROM schedule_fires')).rows[0].count,'1');
}));
test('launcher timer actually advances a persisted schedule without client tick',()=>run(async(f,c)=>{
 const a=await f.kernel.submit(f.credentials.operator,f.request());await c.scheduleCreate({...plan(a.operationId),startAt:Date.now()});
 const errors=[],runner=startScheduler(f.kernel,f.credentials.manager,{intervalMs:20,onError:e=>errors.push(e)});
 try{const deadline=Date.now()+2000;while(Date.now()<deadline){if((await c.scheduleStatus({id:'catchup'})).fires.some(x=>x.state==='DONE'))break;await new Promise(r=>setTimeout(r,20));}assert.equal((await f.owner.query('SELECT count(*) FROM inbox')).rows[0].count,'1');assert.deepEqual(errors,[]);}finally{await runner.close();}
}));
test('reconcile schedule retains UNKNOWN until real ERP ledger resolves original operation',()=>run(async(f,c)=>{
 const erp=await startErp(cluster);try{
 f.kernel.writeback=new Writeback(f.kernel,new HttpWritebackPort(erp.url,()=>erp.token));
 const a=await f.kernel.submit(f.credentials.operator,f.request());erp.controller.mode='lost-ack';
 assert.equal((await f.kernel.dispatch(f.credentials.manager,{operationId:a.operationId})).state,'UNKNOWN');
 await c.scheduleCreate({...plan(a.operationId),kind:'reconcile'});f.kernel.clock=()=>1000;
 const result=await c.scheduleTick({id:'catchup'});assert.equal(result.state,'DONE');assert.equal((await f.kernel.status(f.credentials.manager,{actionId:a.actionId})).state,'SUCCEEDED');
 }finally{await erp.close();}
}));
