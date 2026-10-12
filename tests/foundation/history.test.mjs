import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {createGateway} from '../../src/gateway.mjs';
import {createClient} from '../../src/generated/client.mjs';
let cluster;before(async()=>{cluster=await startCluster();});after(async()=>{await cluster?.close();});
async function run(fn){const f=await fixture(cluster);try{await fn(f);}finally{await f.close();}}
const code=c=>e=>e.code===c;
test('bounded generated HTTP history joins immutable revisions to original Actions and redacts restricted columns',()=>run(async f=>{
 const a=await f.kernel.submit(f.credentials.operator,f.request());
 const b=await f.kernel.submit(f.credentials.operator,f.request({expectedRevision:2,input:{targetId:'stock',isolated:false}}));
 const server=createGateway(f.kernel);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const client=createClient({url:`http://127.0.0.1:${server.address().port}`,tenant:'t1',token:f.credentials.operator.token});
  const first=await client.history({id:'stock',limit:1});assert.equal(first.items.length,1);assert.equal(first.nextRevision,2);
  assert.equal(first.items[0].actionId,a.actionId);assert.equal(first.items[0].fields.isolated,true);assert.equal(first.items[0].fields.secret,undefined);
  const next=await client.history({id:'stock',afterRevision:first.nextRevision,projection:['isolated']});
  assert.equal(next.nextRevision,null);assert.equal(next.items[0].revision,3);assert.equal(next.items[0].actionId,b.actionId);assert.deepEqual(next.items[0].fields,{isolated:false});
  assert.equal((await f.kernel.get(f.credentials.operator,{id:'stock'})).revision,3);
  const asOf=await client.history({id:'stock',asOfRevision:2});assert.equal(asOf.items.length,1);assert.equal(asOf.items[0].revision,2);assert.equal(asOf.nextRevision,null);
 }finally{await new Promise(resolve=>server.close(resolve));}
}));
test('history rejects row scope, secret projection, malformed bounds and permission loss even on empty pages',()=>run(async f=>{
 await f.kernel.submit(f.credentials.operator,f.request());
 await assert.rejects(f.kernel.history(f.credentials.other,{id:'stock'}),code('NOT_FOUND'));
 await assert.rejects(f.kernel.history(f.credentials.tenant2,{id:'stock'}),code('NOT_FOUND'));
 await assert.rejects(f.kernel.history(f.credentials.operator,{id:'stock',afterRevision:100,projection:['secret']}),code('PERMISSION_DENIED'));
 for(const request of [{id:'stock',limit:101},{id:'stock',afterRevision:-1},{id:'stock',afterRevision:1.5},{id:'stock',asOfRevision:-1},{id:'stock',afterRevision:3,asOfRevision:2},{id:'stock',actor:'manager'}])await assert.rejects(f.kernel.history(f.credentials.operator,request),code('INVALID_ARGUMENT'));
 await f.owner.query("UPDATE delegations SET active=false WHERE id='delegation'");
 await assert.rejects(f.kernel.history(f.credentials.delegated,{id:'stock'}),code('PERMISSION_DENIED'));
 await f.owner.query('UPDATE policy SET available=false');
 await assert.rejects(f.kernel.history(f.credentials.operator,{id:'stock'}),code('UNAVAILABLE'));
}));
test('rollback and conflict cannot create extra history revisions',()=>run(async f=>{
 f.kernel.fault=async point=>{if(point==='before-commit')throw Error('transaction fault');};
 await assert.rejects(f.kernel.submit(f.credentials.operator,f.request()));f.kernel.fault=async()=>{};
 assert.equal((await f.kernel.history(f.credentials.operator,{id:'stock'})).items.length,0);
 await f.kernel.submit(f.credentials.operator,f.request());
 assert.equal((await f.kernel.submit(f.credentials.operator,f.request())).state,'CONFLICT');
 const rows=(await f.kernel.history(f.credentials.operator,{id:'stock'})).items;assert.equal(rows.length,1);assert.equal(rows[0].revision,2);
}));
