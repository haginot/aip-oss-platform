import test from 'node:test';import assert from 'node:assert/strict';import {withFixture,restart,coverage,denied,evidence,referenceCheck,restoreRegression} from './assurance-helper.mjs';
test('positive ENT-120 integrated assertions',async t=>t.test('ENT-120 AC-01 positive coverage Cartesian cells and local gap issues',async t=>withFixture(async f=>{
 const b=coverage();await f.call('manager','coverageCreate',b);let status=await f.call('manager','coverageCheck',{id:b.id});const expected=await referenceCheck({kind:'coverage',dimensions:[b.departments,b.lifecycles,b.classifications,b.effects,b.exceptions]});assert.equal(status.openIssues.length,expected.cells);assert.equal(status.complete,expected.complete);
 await t.test('ENT-120 AC-02 negative-authorization count completion unsupported exclusion',async t=>t.test('negative-authorization ENT-120 boundary assertions',async()=>{
  await denied(()=>f.call('manager','coverageExclude',{id:b.id,issueId:status.openIssues[0],reason:'self'}));await denied(()=>f.call('reviewer','coverageExclude',{id:b.id,issueId:status.openIssues[0],reason:''}),'INVALID_ARGUMENT');await denied(()=>f.call('reader','assuranceRead',{id:b.id}));await denied(()=>f.call('other','assuranceRead',{id:b.id}),'NOT_FOUND');
  await f.call('reviewer','coverageExclude',{id:b.id,issueId:status.openIssues[0],reason:'synthetic company does not perform this activity'});assert.equal((await f.call('manager','coverageCheck',{id:b.id})).complete,false);
 }));
 await t.test('ENT-120 AC-03 persistence failure-recovery new workflow registration and rollback',async t=>t.test('persistence ENT-120 stored state assertions',async t=>t.test('failure-recovery ENT-120 recovery assertions',async()=>{
  const cell={departments:'hr',lifecycles:'transfer',classifications:'STRICT',effects:'mail',exceptions:'cancel'};
  f.kernel.fault=async p=>{if(p==='enterprise-before-audit')throw Error('audit failure');};await assert.rejects(()=>f.call('manager','coverageDiscover',{id:b.id,cell}));f.kernel.fault=async()=>{};assert.equal((await f.call('manager','coverageCheck',{id:b.id})).openIssues.length,3);await f.call('manager','coverageDiscover',{id:b.id,cell});await denied(()=>f.call('manager','coverageDiscover',{id:b.id,cell}),'CONFLICT');restart(f);status=await f.call('manager','coverageCheck',{id:b.id});assert.equal(status.openIssues.length,4);assert.equal(status.excluded,1);assert.equal(status.complete,false);evidence('coverage',await f.call('manager','assuranceRead',{id:b.id}));
 })));
})));

test('ENT-120 failure-recovery real schema restore commit response loss and SQL tampering',()=>restoreRegression('coverage',coverage(),'coverageCreate'));
