import test from 'node:test';import assert from 'node:assert/strict';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {AuthoritativeRetrieval} from '../../src/retrieval.mjs';
import {digest} from '../../src/contracts.mjs';
test('authoritative retrieval corpus checks ID/order/type/version/revision/mask/denial/deletion/watermark',async()=>{
 const cluster=await startCluster();let f;try{
 f=await fixture(cluster);const adapter=new AuthoritativeRetrieval(f.kernel);
 const result=await adapter.retrieve(f.credentials.operator,{type:'InventoryPosition',search:'rice'});
 assert.deepEqual(result.items.map(x=>x.id),['stock','stock2']);assert.equal(result.watermark,'authoritative');
 for(const [index,object] of result.items.entries()){assert.equal(object.type,'InventoryPosition');assert.equal(object.ontologyVersion,'1.0.0');assert.equal(object.revision,1);assert.equal(object.fields.secret,undefined);assert.equal(result.evidence[index].digest,digest(object));}
 await f.owner.query("DELETE FROM objects WHERE id='stock2'");assert.equal((await adapter.retrieve(f.credentials.operator,{type:'InventoryPosition',search:'rice'})).count,1);
 await f.owner.query("UPDATE principals SET stores='[]' WHERE id='operator'");assert.equal((await adapter.retrieve(f.credentials.operator,{type:'InventoryPosition',search:'rice'})).count,0);
 await f.owner.query('UPDATE policy SET available=false');await assert.rejects(adapter.retrieve(f.credentials.operator,{type:'InventoryPosition'}),e=>e.code==='UNAVAILABLE');
 }finally{await f?.close();await cluster.close();}
});
