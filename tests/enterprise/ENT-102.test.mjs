import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {startCluster,enterpriseFixture} from '../../scripts/enterprise/fixture.mjs';
import {validatePackage} from '../../src/enterprise/contracts.mjs';

test('ENT-102 AC-01 positive versioned legal entity department case employment position classification',async t=>t.test('positive ENT-102 executable contract scenario',async()=>{
 const p=JSON.parse(await readFile(new URL('../../config/enterprise/foundation.json',import.meta.url)));
 assert.equal(validatePackage(p).version,'1.0.0');for(const type of ['LegalEntity','Department','Case','Employment','Position','Classification'])assert.ok(p.types[type]);
 const bad=structuredClone(p);delete bad.types.Employment;assert.throws(()=>validatePackage(bad),{code:'INVALID_ARGUMENT'});
}));
test('ENT-102 AC-02 persistence failure-recovery Store coexistence migration and guarded rollback',async t=>t.test('persistence ENT-102 executable contract scenario',async t=>t.test('failure-recovery ENT-102 executable contract scenario',async()=>{
 const cluster=await startCluster();let f;
 try{f=await enterpriseFixture(cluster,{install:false});
  const old=await f.kernel.get(f.credentials.operator,{id:'stock'});assert.equal(old.fields.quantity,10);
  await f.owner.query(await readFile(new URL('../../migrations/002-enterprise-down.sql',import.meta.url),'utf8'));
  assert.equal((await f.kernel.get(f.credentials.operator,{id:'stock'})).fields.quantity,10);assert.equal((await f.owner.query("SELECT to_regclass('enterprise_assurance') absent")).rows[0].absent,null);
  await f.owner.query(await readFile(new URL('../../migrations/002-enterprise.sql',import.meta.url),'utf8'));
  await assert.rejects(f.owner.query("INSERT INTO objects(id,tenant,store,type,revision,fields,source_position) VALUES('invalid','t1',NULL,'Case',1,'{}','test')"),/object_scope_exclusive/);
 }finally{await f?.close();await cluster.close();}
})));
test('ENT-102 negative-authorization enterprise object cannot be read through Store contract',async t=>t.test('negative-authorization ENT-102 executable contract scenario',async()=>{
 const cluster=await startCluster();let f;try{f=await enterpriseFixture(cluster);const body=f.create();await f.call('operator','create',body);await assert.rejects(f.kernel.get(f.credentials.manager,{id:body.id}),{code:'NOT_FOUND'});assert.equal((await f.call('operator','get',{id:body.id})).fields.title,body.fields.title);
 await assert.rejects(f.owner.query(await readFile(new URL('../../migrations/002-enterprise-down.sql',import.meta.url),'utf8')),/archived before rollback/);
 }finally{await f?.close();await cluster.close();}
}));
