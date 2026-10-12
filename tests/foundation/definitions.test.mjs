import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {createGateway} from '../../src/gateway.mjs';
import {createClient} from '../../src/generated/client.mjs';
import {generateClient} from '../../scripts/foundation/generate-client.mjs';
let cluster;before(async()=>{cluster=await startCluster();});after(async()=>{await cluster?.close();});
const code=expected=>e=>e.code===expected;
async function run(fn){const f=await fixture(cluster);try{await fn(f);}finally{await f.close();}}
test('immutable draft, distinct reviewer, simulation, publish, old key lookup and compatible rollback',()=>run(async f=>{
 const original=f.request({idempotencyKey:'old-key'});const old=await f.kernel.submit(f.credentials.operator,original);
 const definition=structuredClone(f.definition);definition.ontologyVersion='1.1.0';definition.types.InventoryPosition.fields.label={type:'string',nullable:true};
 assert.equal((await f.kernel.draft(f.credentials.manager,{definition})).version,'1.1.0');
 await assert.rejects(f.kernel.publish(f.credentials.publisher,{version:'1.1.0'}),code('PERMISSION_DENIED'));
 await assert.rejects(f.kernel.review(f.credentials.manager,{version:'1.1.0'}),code('PERMISSION_DENIED'));
 assert.equal((await f.kernel.review(f.credentials.reviewer,{version:'1.1.0'})).compatible,true);
 await f.kernel.publish(f.credentials.publisher,{version:'1.1.0'});
 assert.equal((await f.kernel.ontology(f.credentials.operator)).definition.ontologyVersion,'1.1.0');
 await assert.rejects(f.kernel.submit(f.credentials.operator,f.request()),code('UNSUPPORTED_VERSION'));
 assert.deepEqual(await f.kernel.submit(f.credentials.operator,original),old);
 await f.kernel.publish(f.credentials.publisher,{version:'1.0.0',rollback:true});
 assert.equal((await f.kernel.ontology(f.credentials.operator)).definition.ontologyVersion,'1.0.0');
 assert.equal((await f.kernel.get(f.credentials.operator,{id:'stock'})).revision,2);
}));
test('mixed generated HTTP clients enforce published versions, replay provenance and rollback',()=>run(async f=>{
 const server=createGateway(f.kernel);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const url=`http://127.0.0.1:${server.address().port}`,options={url,tenant:'t1',token:f.credentials.operator.token};
  const old=createClient(options),original=f.request({idempotencyKey:'mixed-old'}),a=await old.submit(original);
  const definition=structuredClone(f.definition);definition.ontologyVersion='1.1.0';definition.types.InventoryPosition.fields.label={type:'string',nullable:true};
  const admin=createClient({...options,token:f.credentials.manager.token}),reviewer=createClient({...options,token:f.credentials.reviewer.token}),publisher=createClient({...options,token:f.credentials.publisher.token});
  await admin.draft({definition});await reviewer.review({version:'1.1.0'});await publisher.publish({version:'1.1.0'});
  const runtime=generateClient(definition).runtime.replace("'../client-transport.mjs'",JSON.stringify(new URL('../../src/client-transport.mjs',import.meta.url).href));
  const generated=await import('data:text/javascript;base64,'+Buffer.from(runtime).toString('base64'));
  const current=generated.createClient(options);
  await assert.rejects(old.submit(f.request({expectedRevision:2})),code('UNSUPPORTED_VERSION'));
  assert.equal((await old.submit(original)).actionId,a.actionId);
  const b=await current.submit(f.request({ontologyVersion:'1.1.0',expectedRevision:2,input:{targetId:'stock',isolated:false}}));
  assert.equal(b.result.objectRevision,3);
  await publisher.publish({version:'1.0.0',rollback:true});
  await assert.rejects(current.submit(f.request({ontologyVersion:'1.1.0',expectedRevision:3})),code('UNSUPPORTED_VERSION'));
  assert.equal((await old.submit(f.request({expectedRevision:3}))).result.objectRevision,4);
 }finally{await new Promise(resolve=>server.close(resolve));}
}));
test('schema, rule or expected revision change invalidates approval without mutation',()=>run(async f=>{
 const a=await f.kernel.submit(f.credentials.operator,f.request({requireApproval:true}));
 await f.kernel.submit(f.credentials.operator,f.request());
 await assert.rejects(f.kernel.approve(f.credentials.manager,{actionId:a.actionId}),code('STALE_APPROVAL'));
 assert.equal((await f.kernel.status(f.credentials.operator,{actionId:a.actionId})).state,'PENDING_APPROVAL');
 assert.equal((await f.owner.query('SELECT count(*) FROM outbox')).rows[0].count,'1');
}));
