import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withFixture,vote,restart,ready} from './helpers.mjs';
import {scope} from '../../scripts/enterprise/fixture.mjs';

test('ENT-104 AC-01 positive persistence serial parallel all quorum return cancel expiry',async t=>t.test('positive ENT-104 executable contract scenario',async t=>t.test('persistence ENT-104 executable contract scenario',()=>withFixture(async f=>{
 const b=f.create();await f.call('operator','create',b);assert.equal((await vote(f,'manager',b.id)).stage,0);restart(f);
 await assert.rejects(vote(f,'publisher',b.id),{code:'PERMISSION_DENIED'});assert.equal((await vote(f,'reviewer',b.id)).stage,1);assert.equal((await vote(f,'publisher',b.id)).state,'READY');
 const returned=f.create();await f.call('operator','create',returned);assert.equal((await vote(f,'manager',returned.id,1,'RETURN')).state,'RETURNED');assert.equal((await f.call('operator','cancel',{id:returned.id})).state,'CANCELLED');
 const expired=f.create();await f.call('operator','create',expired);f.kernel.clock=()=>Date.now()+10*86400000;assert.deepEqual((await f.call('manager','tick')).expired,[expired.id]);assert.deepEqual((await f.call('manager','tick')).expired,[]);
 const p=structuredClone(f.manifest);p.version='1.1.0';p.amountRoutes=[{currency:'JPY',minAmount:1000,route:[{approvers:['manager','reviewer'],quorum:1}]}];
 await f.call('manager','install',{manifest:p});await f.call('reviewer','review',{id:p.id,version:p.version});await f.call('publisher','publish',{id:p.id,version:p.version});f.kernel.clock=Date.now;
 const q=f.create();await f.call('operator','create',q);assert.equal((await vote(f,'reviewer',q.id)).state,'READY');
}))));
test('ENT-104 AC-02 positive amount currency definition and valid delegation binding',()=>withFixture(async f=>{
 await f.call('manager','delegate',{id:'approval-proxy',actor:'agent',scopes:[scope],operations:['approve'],expires:new Date(Date.now()+60000).toISOString()});
 const b=f.create();await f.call('operator','create',b);
 const delegated={...f.credentials.agent,delegationId:'approval-proxy'};
 await f.kernel.enterprise(delegated,{operation:'vote',key:crypto.randomUUID(),body:{id:b.id,revision:1,decision:'APPROVE'}});
 assert.equal((await f.call('operator','get',{id:b.id})).workflow.votes[0].actor,'agent');
 await f.owner.query("UPDATE enterprise_delegations SET active=false WHERE id='approval-proxy'");
 await assert.rejects(vote(f,'reviewer',b.id),{code:'PERMISSION_DENIED'});
 const changed=f.create();await f.call('operator','create',changed);await vote(f,'manager',changed.id);
 await f.owner.query("UPDATE objects SET fields=jsonb_set(fields,'{amount}','999999') WHERE id=$1",[changed.id]);await assert.rejects(vote(f,'reviewer',changed.id),{code:'STALE_APPROVAL'});
}));
test('ENT-104 AC-03 negative-authorization self approval edits cycles and revoked execution',async t=>t.test('negative-authorization ENT-104 executable contract scenario',()=>withFixture(async f=>{
 const self=f.create();await f.call('manager','create',self);await assert.rejects(vote(f,'manager',self.id),{code:'PERMISSION_DENIED'});
 const b=f.create();await f.call('operator','create',b);await vote(f,'manager',b.id);await assert.rejects(f.call('operator','edit',{id:b.id,revision:1,fields:{...b.fields,amount:2}}),{code:'PERMISSION_DENIED'});
 const args={scopes:[scope],operations:['action'],expires:new Date(Date.now()+60000).toISOString()};await f.call('operator','delegate',{...args,id:'d1',actor:'agent'});await assert.rejects(f.call('agent','delegate',{...args,id:'d2',actor:'operator'}),{code:'DELEGATION_CYCLE'});
 await f.call('publisher','grant',{principal:'manager',scopes:[],operations:[],fields:[]});await assert.rejects(vote(f,'reviewer',b.id),{code:'PERMISSION_DENIED'});
})));
test('ENT-104 failure-recovery atomic rollback and idempotent approval',async t=>t.test('failure-recovery ENT-104 executable contract scenario',()=>withFixture(async f=>{
 const b=f.create(),key=crypto.randomUUID();await f.call('operator','create',b);
 f.kernel.fault=async point=>{if(point==='enterprise-before-audit')throw Error('injected rollback');};
 await assert.rejects(f.call('manager','vote',{id:b.id,revision:1,decision:'APPROVE'},key),{code:'UNAVAILABLE'});
 assert.equal((await f.call('operator','get',{id:b.id})).workflow.votes.length,0);f.kernel.fault=async()=>{};
 const result=await f.call('manager','vote',{id:b.id,revision:1,decision:'APPROVE'},key);assert.deepEqual(await f.call('manager','vote',{id:b.id,revision:1,decision:'APPROVE'},key),result);assert.equal(result.votes.length,1);
})));
