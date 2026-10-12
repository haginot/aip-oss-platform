import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {createGateway} from '../../src/gateway.mjs';
import {createContractClient} from '../../src/client-transport.mjs';
import {digest} from '../../src/contracts.mjs';
import {seedStore} from '../../scripts/demo/seed.mjs';
test('store retrieval corpus: ordered evidence, masking, delayed source, deletion, revocation and fail closed over HTTP',async()=>{
 const cluster=await startCluster();let f,server;
 try{
 f=await fixture(cluster,{definitionPath:'config/store-ontology.json'});await seedStore(f);
 server=createGateway(f.kernel);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const options={url:`http://127.0.0.1:${server.address().port}`,tenant:'t1'};
 const operator=createContractClient({...options,...f.credentials.operator},f.definition),manager=createContractClient({...options,...f.credentials.manager},f.definition);
 const corpus=JSON.parse(await readFile('config/store-retrieval-corpus.json','utf8')),probes=[];
 const initial=await operator.search(corpus.query);assert.deepEqual(initial.items.map(o=>o.id),corpus.expectedIds);
 for(const o of initial.items){assert.equal(o.type,'InventoryPosition');assert.equal(o.ontologyVersion,'1.1.0');assert.equal(o.revision,1);assert.equal(o.fields.secret,undefined);}
 probes.push({name:'initial',result:initial,evidence:initial.items.map(o=>({id:o.id,revision:o.revision,digest:digest(o),ontologyVersion:o.ontologyVersion}))});
 const event={source:'inventory',store:'s1',position:1,expectedPosition:0,record:{id:'source:rice',deleted:false,name:'source rice',quantity:9,unit:'each',lotId:'demo-lot',storeId:'store',validAt:'2026-10-12T00:00:00.000Z'}};
 await assert.rejects(manager.ingest({...event,position:2,expectedPosition:1}),{code:'SOURCE_GAP'});
 assert.equal((await manager.sourceStatus({source:'inventory',store:'s1'})).checkpoint,0);
 assert.deepEqual((await operator.search(corpus.query)).items.map(o=>o.id),corpus.expectedIds);
 await manager.ingest(event);const history=await operator.history({id:'source:rice'});assert.equal(history.items[0].sourcePosition,'inventory:1');
 const applied=await operator.search(corpus.query);assert.deepEqual(applied.items.map(o=>o.id),['source:rice','stock','stock2']);probes.push({name:'source-applied',result:applied,history});
 const old=await operator.get({id:'source:rice'});await manager.ingest({...event,position:2,expectedPosition:1,record:{...event.record,quantity:8}});assert.equal((await operator.get({id:'source:rice'})).revision,2);
 await assert.rejects(operator.submit({actionType:'SetIsolation',actionVersion:'1.0.0',ontologyVersion:'1.1.0',input:{targetId:'stock',isolated:true},expectedRevision:1,idempotencyKey:'old-evidence',evidence:[{id:old.id,revision:old.revision,digest:digest(old)}]}),{code:'INVALID_EVIDENCE'});
 await manager.ingest({...event,position:3,expectedPosition:2,record:{id:'source:rice',deleted:true,validAt:event.record.validAt}});
 assert.deepEqual((await operator.search(corpus.query)).items.map(o=>o.id),corpus.expectedIds);await assert.rejects(operator.get({id:'source:rice'}),{code:'NOT_FOUND'});
 await f.owner.query("UPDATE principals SET stores='[]' WHERE id='operator'");const revoked=await operator.search(corpus.query);assert.equal(revoked.count,0);probes.push({name:'revoked',result:revoked});
 await f.owner.query('UPDATE policy SET available=false');await assert.rejects(operator.search(corpus.query),{code:'UNAVAILABLE'});
 const audit=(await f.owner.query('SELECT record FROM audit ORDER BY sequence')).rows;
 await mkdir('evidence/generated/demo',{recursive:true});await writeFile('evidence/generated/demo/retrieval-corpus.json',JSON.stringify({corpus,probes,audit,checks:['SOURCE_GAP','tombstone','revocation','UNAVAILABLE']},null,2)+'\n');
 }finally{if(server)await new Promise(r=>server.close(r));await f?.close();await cluster.close();}
});
