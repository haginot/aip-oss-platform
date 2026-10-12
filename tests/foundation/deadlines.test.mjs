import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {startErp} from '../../scripts/foundation/erp.mjs';
import {Writeback,HttpWritebackPort} from '../../src/writeback.mjs';
import {createGateway} from '../../src/gateway.mjs';
import {createClient} from '../../src/generated/client.mjs';
let cluster;before(async()=>{cluster=await startCluster();});after(async()=>{await cluster?.close();});
const code=c=>e=>e.code===c;
async function run(fn){
 const f=await fixture(cluster),erp=await startErp(cluster),server=createGateway(f.kernel);
 f.kernel.writeback=new Writeback(f.kernel,new HttpWritebackPort(erp.url,erp.token));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}`;
 const client=createClient({url,tenant:'t1',token:f.credentials.manager.token});
 try{await fn({...f,erp,server,url,client});}finally{await new Promise(r=>server.close(r));await erp.close();await f.close();}
}
async function business(f){
 const rows={};for(const table of ['objects','actions','history','outbox','continuity','recovery_observations'])rows[table]=(await f.owner.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
 rows.journal=f.journal.records();rows.erp=(await f.erp.owner.query('SELECT * FROM ledger ORDER BY operation_id')).rows;return rows;
}
async function setup(f,method){
 const a=await f.client.submit(f.request());
 if(method==='compensate')await f.client.dispatch(a);
 if(method==='recover')await f.client.continuitySet({store:'s1',mode:'RECOVERING',expectedRevision:0});
 return method==='continuitySet'?{store:'s1',mode:'DEGRADED',expectedRevision:0}:method==='recover'?{store:'s1',checkpoint:'deadline-test'}:method==='compensate'?{actionId:a.actionId,expectedRevision:2,idempotencyKey:'compensation-deadline'}:a;
}
for(const method of ['dispatch','reconcile','continuitySet','recover','compensate'])for(const mode of ['expired','cancelled'])test(`${method} refuses ${mode} caller budget before any business or ERP effect`,()=>run(async f=>{
 const body=await setup(f,method),prior=await business(f),requests={...f.erp.controller},controller=new AbortController();
 if(mode==='cancelled')controller.abort();
 await assert.rejects(f.kernel[method](f.credentials.manager,body,{deadline:Date.now()+(mode==='expired'?-1:2000),signal:controller.signal}),code(mode==='expired'?'DEADLINE_EXCEEDED':'CANCELLED'));
 assert.deepEqual(await business(f),prior);assert.deepEqual(f.erp.controller,requests);
 assert.ok((await f.owner.query("SELECT 1 FROM audit WHERE record->>'kind'='Denied' AND record->>'code'=$1",[mode==='expired'?'DEADLINE_EXCEEDED':'CANCELLED'])).rowCount>0);
}));
test('HTTP admission wait consumes original deadline and never resurrects a new send budget',()=>run(async f=>{
 const body=await setup(f,'dispatch'),prior=await business(f),lock=await f.owner.connect();
 await lock.query('SELECT pg_advisory_lock(772341)');
 const pending=fetch(f.url+'/rpc',{method:'POST',headers:{authorization:`Bearer ${f.credentials.manager.token}`,'content-type':'application/json','x-timeout-ms':'100'},body:JSON.stringify({contractVersion:'1.0.0',requestId:'wait',traceId:'wait',tenant:'t1',operation:'dispatch',body})}).then(r=>r.json());
 try{await delay(300);}finally{await lock.query('SELECT pg_advisory_unlock(772341)');lock.release();}
 const result=await pending;assert.equal(result.error?.code,'DEADLINE_EXCEEDED');assert.deepEqual(await business(f),prior);assert.equal(f.erp.controller.applyRequests,0);
 // An explicit fresh call is the only operation allowed a new deadline.
 assert.equal((await f.client.dispatch(body)).state,'DELIVERED');assert.equal(f.erp.controller.applyRequests,1);
}));
async function until(fn){const end=Date.now()+3000;while(!await fn()){assert.ok(Date.now()<end,'observable operation did not reach barrier');await delay(10);}}
async function erpLock(f){const lock=await f.erp.owner.connect();await lock.query('SELECT pg_advisory_lock(772343)');return async()=>{await lock.query('SELECT pg_advisory_unlock(772343)');lock.release();};}
for(const mode of ['cancelled','expired'])test(`after lease ${mode} budget prevents HTTP; fresh reconciliation retains uncertainty`,()=>run(async f=>{
 const body=await setup(f,'dispatch'),controller=new AbortController();
 f.kernel.writeback.port=new HttpWritebackPort(f.erp.url,async()=>{if(mode==='cancelled')controller.abort();else await delay(200);return f.erp.token;});
 await assert.rejects(f.kernel.dispatch(f.credentials.manager,body,{deadline:Date.now()+(mode==='expired'?150:3000),signal:controller.signal}),code(mode==='expired'?'DEADLINE_EXCEEDED':'CANCELLED'));
 assert.equal(f.erp.controller.applyRequests,0);assert.equal((await f.owner.query('SELECT state FROM outbox')).rows[0].state,'SENDING');
 assert.ok(f.journal.records().some(r=>r.operationId===body.operationId&&r.phase==='SEND_STARTED'));
 f.kernel.writeback.port=new HttpWritebackPort(f.erp.url,f.erp.token);
 assert.equal((await f.client.reconcile(body)).state,'UNKNOWN');assert.equal((await f.client.dispatch(body)).state,'UNKNOWN');assert.equal(f.erp.controller.applyRequests,0);
}));
for(const mode of ['cancelled','expired'])test(`ERP in flight ${mode} is not a rollback claim; fresh ledger reconciliation resolves once`,()=>run(async f=>{
 const body=await setup(f,'dispatch'),controller=new AbortController(),unlock=await erpLock(f);
 const pending=assert.rejects(f.kernel.dispatch(f.credentials.manager,body,{deadline:Date.now()+(mode==='expired'?250:3000),signal:controller.signal}),code(mode==='expired'?'DEADLINE_EXCEEDED':'CANCELLED'));
 try{await until(()=>f.erp.controller.applyRequests===1);if(mode==='cancelled')controller.abort();await pending;assert.equal((await f.owner.query('SELECT state FROM outbox')).rows[0].state,'SENDING');}finally{await unlock();}
 await until(async()=>Number((await f.erp.owner.query('SELECT count(*) AS n FROM ledger')).rows[0].n)===1);
 assert.equal((await f.client.reconcile(body)).state,'DELIVERED');assert.equal((await f.client.dispatch(body)).state,'DUPLICATE');assert.equal(f.erp.controller.applyRequests,1);assert.equal((await f.client.status(body)).state,'SUCCEEDED');
}));
test('HTTP client disconnect cancels in-flight writeback while preserving uncertain delivery',()=>run(async f=>{
 const body=await setup(f,'dispatch'),controller=new AbortController(),unlock=await erpLock(f);
 const pending=fetch(f.url+'/rpc',{method:'POST',signal:controller.signal,headers:{authorization:`Bearer ${f.credentials.manager.token}`,'content-type':'application/json'},body:JSON.stringify({contractVersion:'1.0.0',requestId:'disconnect',traceId:'disconnect',tenant:'t1',operation:'dispatch',body})}).catch(e=>e);
 try{await until(()=>f.erp.controller.applyRequests===1);controller.abort();await pending;await until(async()=>(await f.owner.query("SELECT 1 FROM audit WHERE record->>'operation'='http' AND record->>'code'='CANCELLED'")).rowCount>0);assert.equal((await f.owner.query('SELECT state FROM outbox')).rows[0].state,'SENDING');}finally{await unlock();}
 await until(async()=>(await f.erp.owner.query('SELECT * FROM ledger')).rowCount===1);assert.equal((await f.client.reconcile(body)).state,'DELIVERED');assert.equal(f.erp.controller.applyRequests,1);
}));
test('recovery ledger wait uses caller cancellation and leaves classification unchanged',()=>run(async f=>{
 const a=await f.client.submit(f.request());await f.client.dispatch(a);await f.client.continuitySet({store:'s1',mode:'RECOVERING',expectedRevision:0});
 const prior=await business(f),controller=new AbortController(),unlock=await erpLock(f);
 const pending=assert.rejects(f.kernel.recover(f.credentials.manager,{store:'s1',checkpoint:'cancelled-ledger'},{deadline:Date.now()+3000,signal:controller.signal}),code('CANCELLED'));
 try{await until(()=>f.erp.controller.statusRequests===1);controller.abort();await pending;assert.deepEqual(await business(f),prior);}finally{await unlock();}
 const result=await f.client.recover({store:'s1',checkpoint:'cancelled-ledger'});assert.ok(result);
 assert.equal((await f.erp.owner.query('SELECT * FROM ledger')).rowCount,1);
}));
test('cancel blocked SQL Action before commit; rollback and same-key retry remain safe',()=>run(async f=>{
 const lock=await f.owner.connect(),controller=new AbortController(),request=f.request();await lock.query('BEGIN');await lock.query("UPDATE objects SET revision=revision WHERE id='stock'");
 const pending=assert.rejects(f.kernel.submit(f.credentials.manager,request,{deadline:Date.now()+3000,signal:controller.signal}),code('CANCELLED'));
 try{await until(()=>f.journal.records().some(r=>r.phase==='INTENT'));controller.abort();await pending;assert.equal((await f.owner.query('SELECT * FROM actions')).rowCount,0);assert.equal((await f.owner.query('SELECT * FROM outbox')).rowCount,0);assert.equal(f.journal.records().at(-1).phase,'ABORTED');}finally{await lock.query('ROLLBACK');lock.release();}
 const a=await f.client.submit(request);assert.equal(a.state,'PENDING_EXTERNAL');assert.equal((await f.client.submit(request)).actionId,a.actionId);
}));
test('other public control/read/authoring methods reject cancelled budget before effects',()=>run(async f=>{
 const controller=new AbortController();controller.abort();const prior=await business(f);
 for(const [method,body] of Object.entries({observe:{},ontology:{},status:{actionId:'missing'},approve:{actionId:'missing'},tool:{name:'objects.search',args:{}},definitionDiff:{version:'missing'},editCases:{version:'missing',cases:[]},draft:{definition:{}},review:{version:'missing'},publish:{version:'missing'},journalSnapshot:{store:'s1'},journalList:{snapshot:'missing'},consume:{operationId:'missing'},capability:{name:'model'},scheduleTick:{id:'missing'}})){
  await assert.rejects(f.kernel[method](f.credentials.manager,body,{deadline:Date.now()+2000,signal:controller.signal}),code('CANCELLED'),method);
 }
 assert.deepEqual(await business(f),prior);
}));
