import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withFixture,restart} from './helpers.mjs';
import {scope} from '../../scripts/enterprise/fixture.mjs';
import {readFile} from 'node:fs/promises';

test('ENT-112 BF-05 additive provenance migration preserves legacy data without inventing author subject',()=>withFixture(async f=>{
 const p={...f.manifest,version:'2.0.0'};await f.call('manager','install',{manifest:p});
 await f.owner.query('ALTER TABLE enterprise_packages DROP COLUMN author_identity, DROP COLUMN reviewer_identity');
 await f.owner.query(await readFile(new URL('../../migrations/003-package-provenance.sql',import.meta.url),'utf8'));
 const row=(await f.owner.query('SELECT * FROM enterprise_packages WHERE version=$1',[p.version])).rows[0];assert.deepEqual(row.manifest,p);assert.equal(row.author,'manager');assert.equal(row.author_identity,null);
 await assert.rejects(f.call('reviewer','review',{id:p.id,version:p.version}),{code:'PERMISSION_DENIED'});
 await assert.rejects(f.call('publisher','publish',{id:p.id,version:'1.0.0'}),{code:'PERMISSION_DENIED'});
 assert.equal((await f.call('operator','package',{id:p.id})).manifest.version,'1.0.0');
}));

test('ENT-112 BF-05 delegated authorship and review preserve separation after restart',()=>withFixture(async f=>{
 await f.call('manager','delegate',{id:'package-proxy',actor:'agent',scopes:[scope],operations:['author','review'],expires:new Date(Date.now()+60000).toISOString()});
 const proxy={...f.credentials.agent,delegationId:'package-proxy'};
 const delegated=(operation,body)=>f.kernel.enterprise(proxy,{operation,body,key:crypto.randomUUID()});
 const p={...f.manifest,version:'2.0.0'},ref={id:p.id,version:p.version};
 await delegated('install',{manifest:p});restart(f);
 await assert.rejects(f.call('manager','review',ref),{code:'PERMISSION_DENIED'});
 await assert.rejects(f.call('agent','review',ref),{code:'PERMISSION_DENIED'});
 await assert.rejects(delegated('review',ref),{code:'PERMISSION_DENIED'});
 assert.equal((await f.owner.query('SELECT state FROM enterprise_packages WHERE version=$1',[p.version])).rows[0].state,'DRAFT');
 await f.call('reviewer','review',ref);await f.call('publisher','publish',ref);
 const stored=(await f.owner.query('SELECT author_identity,reviewer_identity FROM enterprise_packages WHERE version=$1',[p.version])).rows[0];
 assert.deepEqual(stored.author_identity,{actor:'agent',subject:'manager',delegationId:'package-proxy'});
 assert.deepEqual({actor:stored.reviewer_identity.actor,subject:stored.reviewer_identity.subject,delegationId:stored.reviewer_identity.delegationId},{actor:'reviewer',subject:'reviewer',delegationId:null});assert.equal(stored.reviewer_identity.authority.actor,'reviewer');assert.equal(stored.reviewer_identity.packageDigest,(await f.owner.query('SELECT digest FROM enterprise_packages WHERE version=$1',[p.version])).rows[0].digest);
 const direct={...p,version:'3.0.0'};await f.call('manager','install',{manifest:direct});
 await assert.rejects(delegated('review',{id:p.id,version:direct.version}),{code:'PERMISSION_DENIED'});
 await f.call('reviewer','review',{id:p.id,version:direct.version});
}));
test('ENT-112 AC-01 positive package includes typed form Action routes permissions fixtures version',async t=>t.test('positive ENT-112 executable contract scenario',()=>withFixture(async f=>{
 const {manifest:p}=await f.call('operator','package',{id:f.manifest.id});for(const key of ['types','form','action','route','permissions','fixtures','version'])assert.ok(p[key]);
 const invalid=structuredClone(p);invalid.version='2.0.0';invalid.fixtures[1].expected='valid';await assert.rejects(f.call('manager','install',{manifest:invalid}),{code:'SIMULATION_FAILED'});
})));
test('ENT-112 AC-02 negative-authorization public contract rejects SQL executable hooks and self review',async t=>t.test('negative-authorization ENT-112 executable contract scenario',()=>withFixture(async f=>{
 for(const key of ['sql','javascript','url','hook']){const p={...f.manifest,version:'2.0.0',[key]:'DROP TABLE objects'};await assert.rejects(f.call('manager','install',{manifest:p}),{code:'INVALID_ARGUMENT'});}
 const p={...f.manifest,version:'2.0.0'};await assert.rejects(f.call('operator','install',{manifest:p}),{code:'PERMISSION_DENIED'});await f.call('manager','install',{manifest:p});await assert.rejects(f.call('manager','review',{id:p.id,version:p.version}),{code:'PERMISSION_DENIED'});await assert.rejects(f.call('publisher','publish',{id:p.id,version:p.version}),{code:'PERMISSION_DENIED'});
})));
test('ENT-112 persistence failure-recovery pinned instances publication rollback and restart',async t=>t.test('persistence ENT-112 executable contract scenario',async t=>t.test('failure-recovery ENT-112 executable contract scenario',()=>withFixture(async f=>{
 const old=f.create();await f.call('operator','create',old);const p=structuredClone(f.manifest);p.version='2.0.0';p.form[0].label='New label';await f.call('manager','install',{manifest:p});await f.call('reviewer','review',{id:p.id,version:p.version});await f.call('publisher','publish',{id:p.id,version:p.version});restart(f);
 assert.equal((await f.call('operator','get',{id:old.id})).workflow.packageVersion,'1.0.0');assert.equal((await f.call('operator','package',{id:p.id})).manifest.version,'2.0.0');await f.call('publisher','publish',{id:p.id,version:'1.0.0'});assert.equal((await f.call('operator','package',{id:p.id})).manifest.version,'1.0.0');
 const records=(await f.owner.query("SELECT record FROM audit WHERE record->>'kind'='EnterpriseCommand'")).rows;assert.ok(records.length>=7);assert.ok(records.every(x=>!JSON.stringify(x).includes(f.credentials.operator.token)));
}))));

test('ENT-112 BF-20 publication rejects revoked principal delegation and changed or missing review proof',async t=>{
 for(const kind of ['principal inactive','delegation revoked','delegation expired','delegation subject changed','grant revision changed','legacy proof','manifest changed','digest changed'])await t.test(kind,()=>withFixture(async f=>{
  const p={...f.manifest,version:'2.0.0'},ref={id:p.id,version:p.version};await f.call('manager','install',{manifest:p});
  if(kind.startsWith('delegation')){
   await f.call('reviewer','delegate',{id:'review-proxy',actor:'agent',scopes:[scope],operations:['review'],expires:new Date(Date.now()+60000).toISOString()});
   await f.kernel.enterprise({...f.credentials.agent,delegationId:'review-proxy'},{operation:'review',body:ref,key:crypto.randomUUID()});
  }else await f.call('reviewer','review',ref);
  if(kind==='principal inactive')await f.owner.query("UPDATE principals SET active=false WHERE id='reviewer'");
  if(kind==='delegation revoked')await f.owner.query("UPDATE enterprise_delegations SET active=false WHERE id='review-proxy'");
  if(kind==='delegation expired')await f.owner.query("UPDATE enterprise_delegations SET expires=now()-interval '1 second' WHERE id='review-proxy'");
  if(kind==='delegation subject changed')await f.owner.query("UPDATE enterprise_delegations SET subject='publisher' WHERE id='review-proxy'");
  if(kind==='grant revision changed'){const g=(await f.owner.query("SELECT * FROM enterprise_grants WHERE principal='reviewer'")).rows[0];await f.call('publisher','grant',{principal:g.principal,scopes:g.scopes,operations:g.operations,fields:g.fields});}
  if(kind==='legacy proof')await f.owner.query("UPDATE enterprise_packages SET reviewer_identity=reviewer_identity-'authority'-'packageDigest' WHERE version='2.0.0'");
  if(kind==='manifest changed')await f.owner.query("UPDATE enterprise_packages SET manifest=jsonb_set(manifest,'{form,0,label}','\"changed\"') WHERE version='2.0.0'");
  if(kind==='digest changed')await f.owner.query("UPDATE enterprise_packages SET digest='changed' WHERE version='2.0.0'");
  const before=(await f.owner.query('SELECT * FROM enterprise_packages ORDER BY version')).rows;restart(f);const key=crypto.randomUUID();
  await assert.rejects(f.call('publisher','publish',ref,key),e=>['PERMISSION_DENIED','STALE_APPROVAL'].includes(e.code));
  assert.deepEqual((await f.owner.query('SELECT * FROM enterprise_packages ORDER BY version')).rows,before);assert.equal((await f.owner.query('SELECT version FROM enterprise_live')).rows[0].version,'1.0.0');assert.equal((await f.owner.query('SELECT * FROM actions WHERE key=$1',['v2:'+key])).rowCount,0);
  if(kind==='legacy proof'){await f.call('reviewer','review',ref);await f.call('publisher','publish',ref,key);assert.equal((await f.owner.query('SELECT version FROM enterprise_live')).rows[0].version,'2.0.0');}
 }));
});

test('ENT-112 BF-20 delegation expiry during publication rolls back before commit',()=>withFixture(async f=>{
 const p={...f.manifest,version:'2.0.0'},ref={id:p.id,version:p.version};await f.call('manager','install',{manifest:p});
 const expires=Date.now()+1200;await f.call('reviewer','delegate',{id:'short-review',actor:'agent',scopes:[scope],operations:['review'],expires:new Date(expires).toISOString()});await f.kernel.enterprise({...f.credentials.agent,delegationId:'short-review'},{operation:'review',body:ref,key:crypto.randomUUID()});
 f.kernel.fault=async point=>{if(point==='enterprise-before-audit')await new Promise(r=>setTimeout(r,Math.max(0,expires-Date.now()+30)));};const key=crypto.randomUUID();await assert.rejects(f.call('publisher','publish',ref,key),{code:'PERMISSION_DENIED'});assert.equal((await f.owner.query('SELECT version FROM enterprise_live')).rows[0].version,'1.0.0');assert.equal((await f.owner.query("SELECT state FROM enterprise_packages WHERE version='2.0.0'")).rows[0].state,'REVIEWED');assert.equal((await f.owner.query('SELECT * FROM actions WHERE key=$1',['v2:'+key])).rowCount,0);
}));

test('ENT-112 BF-20 valid delegated review publishes after restart and revoked subject blocks retry',()=>withFixture(async f=>{
 const p={...f.manifest,version:'2.0.0'},ref={id:p.id,version:p.version};await f.call('manager','install',{manifest:p});await f.call('reviewer','delegate',{id:'valid-review',actor:'agent',scopes:[scope],operations:['review'],expires:new Date(Date.now()+60000).toISOString()});
 await f.kernel.enterprise({...f.credentials.agent,delegationId:'valid-review'},{operation:'review',body:ref,key:crypto.randomUUID()});restart(f);const key=crypto.randomUUID();await f.call('publisher','publish',ref,key);assert.equal((await f.call('operator','package',{id:p.id})).manifest.version,p.version);
 await f.owner.query("UPDATE principals SET active=false WHERE id='reviewer'");await assert.rejects(f.call('publisher','publish',ref,key),{code:'PERMISSION_DENIED'});assert.equal((await f.owner.query('SELECT count(*)::int n FROM actions WHERE key=$1',['v2:'+key])).rows[0].n,1);
}));
