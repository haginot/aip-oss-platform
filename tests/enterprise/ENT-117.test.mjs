import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {withFixture,restart,resource,denied,evidence,referenceCheck,restoreRegression} from './assurance-helper.mjs';
test('positive ENT-117 integrated assertions',async t=>t.test('ENT-117 AC-01 positive integer resources and period reservations',async t=>withFixture(async f=>{
 const b=resource();await f.call('manager','resourceCreate',b);const reserve=(reference,quantity,more={})=>f.call('operator','resourceReserve',{id:b.id,reference,quantity,currency:'JPY',unit:'minor',...more});
 await reserve('order-1',400);await f.call('operator','resourceRelease',{id:b.id,reference:'order-1'});assert.equal((await f.call('manager','assuranceRead',{id:b.id})).data.reserved,0);
 await t.test('ENT-117 AC-02 negative-authorization split threshold currency rounding duplicate concurrent allocation',async t=>t.test('negative-authorization ENT-117 boundary assertions',async()=>{
  await denied(()=>reserve('order-2',401));await denied(()=>reserve('bad',-1),'INVALID_ARGUMENT');await denied(()=>reserve('bad',0.1),'INVALID_ARGUMENT');await denied(()=>reserve('bad',10,{currency:'USD'}),'INVALID_ARGUMENT');await denied(()=>reserve('order-1',1),'CONFLICT');
  const results=await Promise.allSettled([reserve('race-1',300),reserve('race-2',300)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  await denied(()=>f.call('reader','assuranceRead',{id:b.id}));await denied(()=>f.call('other','assuranceRead',{id:b.id}),'NOT_FOUND');
 }));
 await t.test('ENT-117 AC-03 persistence failure-recovery audit rollback restart closed period',async t=>t.test('persistence ENT-117 stored state assertions',async t=>t.test('failure-recovery ENT-117 recovery assertions',async()=>{
  const before=await f.call('manager','assuranceRead',{id:b.id});f.kernel.fault=async p=>{if(p==='enterprise-before-audit')throw Error('injected');};await assert.rejects(()=>f.call('manager','resourceClose',{id:b.id}));f.kernel.fault=async()=>{};
  assert.deepEqual((await f.call('manager','assuranceRead',{id:b.id})).data,before.data);restart(f);assert.equal((await f.call('manager','assuranceRead',{id:b.id})).data.reserved,300);const expected=await referenceCheck({kind:'resource',currency:'JPY',version:'integer-v1',capacity:1000,threshold:800,entries:[{quantity:400,released:true},{quantity:300,released:false}]});assert.equal(expected.reserved,'300');assert.equal(expected.gross,'700');assert.equal(expected.allowed,true);
  await f.call('manager','resourceClose',{id:b.id});await denied(()=>reserve('late',1),'INVALID_STATE');evidence('resource',{record:await f.call('manager','assuranceRead',{id:b.id}),concurrentWinners:1});
 })));
})));

test('ENT-117 failure-recovery real schema restore commit response loss and SQL tampering',()=>restoreRegression('resource',resource(),'resourceCreate'));
test('ENT-117 audit INSERT failure rolls back resource state and scoped audit detects tampering',()=>withFixture(async f=>{
 const b=resource();await f.call('manager','resourceCreate',b);const before=await f.call('manager','assuranceRead',{id:b.id});
 for(const who of ['operator','reader'])await denied(()=>f.call(who,'assuranceAudit',{id:b.id}));for(const who of ['other','tenant2'])await denied(()=>f.call(who,'assuranceAudit',{id:b.id}),'NOT_FOUND');
 await f.owner.query('REVOKE INSERT ON audit FROM foundation_app');await assert.rejects(()=>f.call('manager','resourceClose',{id:b.id}));await f.owner.query('GRANT INSERT ON audit TO foundation_app');assert.deepEqual((await f.call('manager','assuranceRead',{id:b.id})).data,before.data);
 await f.owner.query('ALTER TABLE audit DISABLE TRIGGER USER');await f.owner.query("UPDATE audit SET hash='tampered' WHERE sequence=(SELECT min(sequence) FROM audit)");await f.owner.query('ALTER TABLE audit ENABLE TRIGGER USER');await denied(()=>f.call('manager','assuranceAudit',{id:b.id}),'INCONSISTENT_STATE');
}));
