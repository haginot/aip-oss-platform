import test from 'node:test';import assert from 'node:assert/strict';import {withFixture,restart,sla,denied,evidence,referenceCheck,restoreRegression} from './assurance-helper.mjs';
test('positive ENT-118 integrated assertions',async t=>t.test('ENT-118 AC-01 positive holiday SLA and bounded emergency review',async t=>withFixture(async f=>{
 const now=Date.parse('2026-10-22T10:00:00Z');f.kernel.clock=()=>now;const b=sla();await f.call('operator','slaCreate',b);const expected=await referenceCheck({kind:'sla',start:new Date(now).toISOString(),priority:b.priority,days:b.businessDays,holidays:b.holidays});assert.equal((await f.call('manager','assuranceRead',{id:b.id})).data.due,expected.due);
 await t.test('ENT-118 AC-02 negative-authorization permanent emergency self approval and tamper',async t=>t.test('negative-authorization ENT-118 boundary assertions',async()=>{
  await denied(()=>f.call('operator','emergencyRequest',{id:b.id,reason:'incident',expires:'2099-01-01T00:00:00Z'}));
  await f.call('operator','emergencyRequest',{id:b.id,reason:'synthetic incident',expires:new Date(now+600000).toISOString()});
  await denied(()=>f.call('manager','emergencyApprove',{id:b.id,due:'2099'}),'INVALID_ARGUMENT');await denied(()=>f.call('operator','emergencyApprove',{id:b.id}));await denied(()=>f.call('reader','assuranceRead',{id:b.id}));
  await f.call('manager','emergencyApprove',{id:b.id});const useKey=crypto.randomUUID();await f.call('operator','emergencyUse',{id:b.id},useKey);await f.call('operator','emergencyUse',{id:b.id},useKey);assert.equal((await f.owner.query("SELECT 1 FROM outbox WHERE event->>'kind'='sla-emergency-escalation'")).rowCount,1);await denied(()=>f.call('manager','emergencyReview',{id:b.id,decision:'ACCEPT',reason:'self'}));await f.call('reviewer','emergencyReview',{id:b.id,decision:'ACCEPT',reason:'independent incident assessment'});
 }));
 await t.test('ENT-118 AC-03 persistence failure-recovery expiry escalation audit',async t=>t.test('persistence ENT-118 stored state assertions',async t=>t.test('failure-recovery ENT-118 recovery assertions',async()=>{
  restart(f);assert.equal((await f.call('manager','assuranceRead',{id:b.id})).data.state,'REVIEWED');await denied(()=>f.call('operator','emergencyUse',{id:b.id}));
  const urgent={...sla(),priority:'URGENT',holidays:[]};await f.call('operator','slaCreate',urgent);f.kernel.clock=()=>Date.parse('2098-01-01');await f.call('manager','slaTick',{id:urgent.id});await denied(()=>f.call('manager','slaTick',{id:urgent.id}),'INVALID_STATE');assert.equal((await f.owner.query("SELECT 1 FROM outbox WHERE event->>'kind'='sla-escalation'")).rowCount,1);evidence('sla',await f.call('manager','assuranceRead',{id:b.id}));
 })));
})));

test('ENT-118 failure-recovery real schema restore commit response loss and SQL tampering',()=>restoreRegression('sla',sla(),'slaCreate'));

test('ENT-118 expiry and delegated self approval cannot extend emergency authority',()=>withFixture(async f=>{
 const b=sla(),now=Date.now();f.kernel.clock=()=>now;await f.call('operator','slaCreate',b);await f.call('operator','emergencyRequest',{id:b.id,reason:'incident',expires:new Date(now+1000).toISOString()});await f.call('manager','emergencyApprove',{id:b.id});f.kernel.clock=()=>now+1001;await denied(()=>f.call('operator','emergencyUse',{id:b.id}));assert.equal((await f.owner.query("SELECT 1 FROM outbox WHERE event->>'kind'='sla-emergency-escalation'")).rowCount,0);
 const d=crypto.randomUUID();await f.call('manager','delegate',{id:d,actor:'agent',scopes:[b.scope],operations:['approve'],expires:'2099-01-01T00:00:00Z'});await denied(()=>f.kernel.enterprise({...f.credentials.agent,delegationId:d},{operation:'emergencyApprove',body:{id:b.id},key:crypto.randomUUID()}));
}));
