import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withFixture} from './helpers.mjs';
import {connection,routed,conformance} from './connector-scenario.mjs';
test('ENT-603 AC-01 mail calendar selectable independent HTTP contracts',async t=>t.test('positive ENT-603 executable contract scenario',async t=>t.test('persistence ENT-603 executable contract scenario',()=>withFixture(async(f,cluster)=>{for(const domain of ['mail','calendar'])await conformance(f,cluster,domain);}))));
test('ENT-603 AC-02 UNKNOWN invitation cancellation and destination rejection',async t=>t.test('failure-recovery ENT-603 executable contract scenario',async t=>t.test('negative-authorization ENT-603 executable contract scenario',()=>withFixture(async(f,cluster)=>{
 const c=await connection(f,cluster,'calendar');try{const b=await routed(f,'calendar');c.registry.calendar.secrets['test-secret']='wrong';assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},c.port)).state,'UNKNOWN');assert.equal((await c.server.ledger()).length,0);c.registry.calendar.secrets['test-secret']='synthetic-secret';const observed=await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'reconcile'},c.port);assert.equal(observed.observation,'ABSENT');assert.equal(observed.requiresHumanReview,true);
 }finally{await c.server.close();}
}))));
test('ENT-603 AC-03 Google Microsoft production integrations explicitly unconnected',()=>withFixture(async f=>{const result=await f.call('manager','connectionList');assert.deepEqual(result.items,[]);assert.ok(result.unconnected.includes('Google'));assert.ok(result.unconnected.includes('Microsoft'));}));
