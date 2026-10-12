import test from 'node:test';import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {IndexedPostgresState,refreshProjection,catchUpProjection,AdapterSwitch} from '../../src/adapters/indexed-postgres.mjs';
import {seedStore} from '../../scripts/demo/seed.mjs';
import {Kernel} from '../../src/kernel.mjs';
import {AuthoritativeRetrieval,compareProbe} from '../../src/retrieval.mjs';
test('persistent index: shadow semantics, corruption fence, cutover, commit/retry, stale index and rollback',async()=>{
 const cluster=await startCluster();let f;try{
 f=await fixture(cluster,{definitionPath:'config/store-ontology.json'});await seedStore(f);await f.owner.query(await readFile('migrations/002-search-projection.sql','utf8'));await refreshProjection(f.owner);
 const candidate=new IndexedPostgresState(f.state),k=new Kernel(candidate,f.journal),route=new AdapterSwitch(f.kernel,f.state,candidate);
 const corpus=[['operator',{type:'InventoryPosition',search:'rice'}],['reader',{type:'InventoryPosition',projection:['name','quantity']}],['delegated',{type:'InventoryPosition'}],['other',{type:'InventoryPosition'}],['tenant2',{type:'InventoryPosition'}],['operator',{type:'NoSuchType'}],['operator',{type:'InventoryPosition',projection:['secret']}]];
 const shadow=()=>Promise.all(corpus.map(([actor,q])=>compareProbe(new AuthoritativeRetrieval(f.kernel),new AuthoritativeRetrieval(k),f.credentials[actor],q)));
 const good=await shadow();assert.ok(good.every(p=>p.equal));assert.equal(good[0].candidate.value.items[0].ontologyVersion,'1.1.0');assert.equal(good[0].candidate.value.items[0].fields.secret,undefined);
 await f.owner.query("UPDATE search_projection SET payload=jsonb_set(payload,'{fields,quantity}','999') WHERE id='stock'");const bad=await shadow();assert.ok(bad.some(p=>!p.equal));assert.throws(()=>route.cutover(bad),{code:'INCONSISTENT_STATE'});assert.equal(f.kernel.state,f.state);
 await refreshProjection(f.owner);route.cutover(await shadow());assert.equal(f.kernel.state,candidate);
 const request=f.request({ontologyVersion:'1.1.0',idempotencyKey:'adapter-retry'}),action=await f.kernel.submit(f.credentials.operator,request);assert.equal((await f.kernel.submit(f.credentials.operator,request)).actionId,action.actionId);
 await assert.rejects(f.kernel.submit(f.credentials.operator,{...request,input:{targetId:'stock',isolated:false}}),{code:'IDEMPOTENCY_MISMATCH'});
 await assert.rejects(f.kernel.search(f.credentials.operator,{type:'InventoryPosition'}),{code:'INCONSISTENT_STATE'});
 await refreshProjection(f.owner);const reopened=new Kernel(new IndexedPostgresState(f.state),f.journal);assert.equal((await reopened.search(f.credentials.operator,{type:'InventoryPosition'})).items.find(o=>o.id==='stock').revision,2);
 route.rollback();assert.equal((await f.kernel.get(f.credentials.operator,{id:'stock'})).revision,2);assert.equal((await f.kernel.submit(f.credentials.operator,request)).actionId,action.actionId);
 assert.equal(Number((await f.owner.query('SELECT count(*) FROM outbox')).rows[0].count),1);
 const storeCorpus=JSON.parse(await readFile('config/store-retrieval-corpus.json','utf8'));assert.deepEqual((await k.search(f.credentials.operator,storeCorpus.query)).items.map(o=>o.id),storeCorpus.expectedIds);
 const event={source:'inventory',store:'s1',position:1,expectedPosition:0,record:{id:'source:rice',deleted:false,name:'source rice',quantity:9,unit:'each',lotId:'demo-lot',storeId:'store',validAt:'2026-10-12T00:00:00.000Z'}};
 await assert.rejects(f.kernel.ingest(f.credentials.manager,{...event,position:2,expectedPosition:1}),{code:'SOURCE_GAP'});
 await f.kernel.ingest(f.credentials.manager,event);await f.kernel.ingest(f.credentials.manager,event);await catchUpProjection(f.owner);await catchUpProjection(f.owner);assert.ok((await shadow()).every(p=>p.equal));
 const oldCheckpoint=(await f.owner.query('SELECT position FROM search_projection_checkpoint')).rows[0];
 await f.kernel.ingest(f.credentials.manager,{...event,position:2,expectedPosition:1,record:{id:'source:rice',deleted:true,validAt:event.record.validAt}});
 await assert.rejects(catchUpProjection(f.owner,{fault:async()=>{throw Error('migration interrupted');}}),/migration interrupted/);assert.deepEqual((await f.owner.query('SELECT position FROM search_projection_checkpoint')).rows[0],oldCheckpoint);await assert.rejects(k.search(f.credentials.operator,storeCorpus.query),{code:'INCONSISTENT_STATE'});
 await catchUpProjection(f.owner);assert.equal((await f.owner.query("SELECT (payload->>'deleted')::boolean AS tombstone FROM search_projection WHERE id='source:rice'")).rows[0].tombstone,true);assert.ok((await shadow()).every(p=>p.equal));
 await f.owner.query("UPDATE outbox SET sequence=2 WHERE operation_id=$1",[action.operationId]);await assert.rejects(catchUpProjection(f.owner),{code:'INCONSISTENT_STATE'});await f.owner.query("UPDATE outbox SET sequence=1 WHERE operation_id=$1",[action.operationId]);
 await f.owner.query('DELETE FROM search_projection_checkpoint');await assert.rejects(k.search(f.credentials.operator,storeCorpus.query),{code:'INCONSISTENT_STATE'});await catchUpProjection(f.owner);
 await f.owner.query("UPDATE principals SET stores='[]' WHERE id='operator'");const revoked=await shadow();assert.ok(revoked.every(p=>p.equal));assert.equal(revoked[0].candidate.value.count,0);
 await assert.rejects(k.search(f.credentials.manager,storeCorpus.query,{deadline:Date.now()-1}),{code:'DEADLINE_EXCEEDED'});
 await f.owner.query('UPDATE policy SET available=false');assert.ok((await shadow()).every(p=>p.equal));await assert.rejects(k.search(f.credentials.operator,{type:'InventoryPosition'}),{code:'UNAVAILABLE'});
 await mkdir('evidence/generated/release',{recursive:true});await writeFile('evidence/generated/release/adapter-trace.json',JSON.stringify({shadow:good,corruption:bad,storeCorpus,catchUpReplay:true,gapRejected:true,tombstone:true,migrationInterruption:true,revocation:true,timeout:true,checkpointRequired:true,cutover:true,reopenRevision:2,rollbackRevision:2,retryActionId:action.actionId,outboxCount:1,policyFailClosed:true},null,2)+'\n');
 }finally{await f?.close();await cluster.close();}
});
