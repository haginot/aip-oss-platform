import test from 'node:test';import assert from 'node:assert/strict';import {withFixture,restart,policy,denied,evidence,referenceCheck,restoreRegression} from './assurance-helper.mjs';
test('positive ENT-119 integrated assertions',async t=>t.test('ENT-119 AC-01 positive versioned applicability without legal claim',async t=>withFixture(async f=>{
 const b=policy();await f.call('manager','policyCreate',b);const apply=(more={})=>f.call('operator','policyApply',{id:b.id,jurisdiction:b.jurisdiction,industry:b.industry,version:b.version,requirements:b.requirements,...more});
 await t.test('ENT-119 AC-02 negative-authorization unknown jurisdiction mixed version unreviewed',async t=>t.test('negative-authorization ENT-119 boundary assertions',async()=>{
  await denied(()=>apply(),'UNSUPPORTED_CAPABILITY');await denied(()=>f.call('manager','policyApprove',{id:b.id,evidence:'self'}));await denied(()=>f.call('publisher','policyApprove',{id:b.id,evidence:'not-owner'}));
  await f.call('reviewer','policyApprove',{id:b.id,evidence:'synthetic accountable-owner review'});await denied(()=>apply({jurisdiction:'UNKNOWN'}),'UNSUPPORTED_CAPABILITY');await denied(()=>apply({version:'0.9.0'}),'UNSUPPORTED_CAPABILITY');await denied(()=>apply({requirements:[]}),'UNSUPPORTED_CAPABILITY');await denied(()=>f.call('reader','assuranceRead',{id:b.id}));await apply();
 }));
 await t.test('ENT-119 AC-03 persistence failure-recovery policy rollback and restart',async t=>t.test('persistence ENT-119 stored state assertions',async t=>t.test('failure-recovery ENT-119 recovery assertions',async()=>{
  const before=await f.call('manager','assuranceRead',{id:b.id});f.kernel.fault=async p=>{if(p==='enterprise-before-audit')throw Error('audit failure');};await assert.rejects(()=>apply());restart(f);const after=await f.call('manager','assuranceRead',{id:b.id});assert.deepEqual(after.data,before.data);assert.equal(after.data.legalComplianceClaim,false);assert.equal(after.data.applications.length,1);const expected=await referenceCheck({kind:'policy',jurisdiction:b.jurisdiction,industry:b.industry,version:b.version,requirements:b.requirements,reviewed:true});assert.equal(expected.supported,true);assert.equal(after.data.legalComplianceClaim,expected.legalComplianceClaim);evidence('policy',after);
 })));
})));

test('ENT-119 failure-recovery real schema restore commit response loss and SQL tampering',()=>restoreRegression('policy',policy(),'policyCreate'));

for(const scenario of ['revoked-review','changed-review-revision','expired-policy'])test(`ENT-119 BF-17 public HTTP replay ${scenario} after restart and exact schema restore`,async t=>{
 const {localEnvironment}=await import('../../scripts/enterprise/local.mjs'),{login}=await import('./http-helper.mjs');
 const {enterpriseGateway}=await import('../../src/enterprise/gateway.mjs'),{execFileSync}=await import('node:child_process');
 const env=await localEnvironment(),restartedGateways=[];try{
  let now=Date.now();env.f.kernel.clock=()=>now;
  const users=Object.fromEntries(await Promise.all(['manager','reviewer','operator','publisher','reader','other'].map(async who=>[who,await login(env,who)])));
  const api=async(who,op,body,key)=>{const response=await users[who].api(op,body,key);return {status:response.status,body:await response.json()};};
  const b={...policy(),expires:new Date(now+120000).toISOString()},key=crypto.randomUUID(),body={id:b.id,jurisdiction:b.jurisdiction,industry:b.industry,version:b.version,requirements:b.requirements};
  assert.equal((await api('manager','policyCreate',b)).status,200);
  assert.equal((await api('reviewer','policyApprove',{id:b.id,evidence:'synthetic BF-17 independent owner review'})).status,200);
  const applied=await api('operator','policyApply',body,key);assert.equal(applied.status,200);
  const state=async()=>({record:(await env.f.owner.query('SELECT * FROM enterprise_assurance WHERE id=$1',[b.id])).rows,history:(await env.f.owner.query('SELECT * FROM enterprise_assurance_history WHERE id=$1 ORDER BY revision',[b.id])).rows,actions:(await env.f.owner.query("SELECT * FROM actions WHERE request->'body'->>'id'=$1 ORDER BY id",[b.id])).rows,audit:(await env.f.owner.query("SELECT record FROM audit WHERE record->>'objectId'=$1 AND record->>'kind'='EnterpriseCommand' ORDER BY sequence",[b.id])).rows});
  const before=await state();assert.equal(before.record[0].data.applications.length,1);
  assert.deepEqual(await api('operator','policyApply',body,key),applied);assert.deepEqual(await state(),before);
  assert.equal((await api('operator','policyApply',{...body,version:'other-version'},key)).body.error.code,'IDEMPOTENCY_MISMATCH');
  for(const [who,code] of [['reader','PERMISSION_DENIED'],['other','NOT_FOUND']])assert.equal((await api(who,'policyApply',body)).body.error.code,code);
  if(scenario==='expired-policy')now=Date.parse(b.expires);
  else{
   const grant=(await env.f.owner.query("SELECT * FROM enterprise_grants WHERE principal='reviewer'")).rows[0];
   assert.equal((await api('publisher','grant',{principal:'reviewer',scopes:grant.scopes,operations:scenario==='revoked-review'?grant.operations.filter(x=>x!=='review'):grant.operations,fields:scenario==='changed-review-revision'?grant.fields.filter(x=>x!=='PUBLIC'):grant.fields})).status,200);
  }
  const code=scenario==='expired-policy'?'UNSUPPORTED_CAPABILITY':scenario==='revoked-review'?'PERMISSION_DENIED':'STALE_APPROVAL',status=code==='PERMISSION_DENIED'?403:400;
  const checks=[];
  const refuses=async phase=>{
   const fresh=await api('operator','policyApply',body),replay=await api('operator','policyApply',body,key),after=await state();
   checks.push({phase,fresh,replay,stateUnchanged:JSON.stringify(after)===JSON.stringify(before)});t.diagnostic(JSON.stringify({scenario,...checks.at(-1)}));
   assert.deepEqual(fresh,{status,body:{error:{code}}});assert.deepEqual(replay,fresh);assert.deepEqual(after,before);
  };
  await refuses('current');
  const reopen=async()=>{restart(env.f);env.f.kernel.clock=()=>now;env.gateway=await enterpriseGateway(env.f.kernel,{issuer:env.idp.issuer});restartedGateways.push(env.gateway);};
  await reopen();await refuses('restarted');
  const schema=(await env.f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',env.cluster.config.host,'-p',String(env.cluster.config.port),'-U',env.cluster.config.user,'-d',env.cluster.config.database],dump=env.cluster.directory+'/bf17-exact.sql';
  execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+dump]);
  const journal=JSON.stringify(env.f.kernel.journal.records());await env.f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+dump],{stdio:'pipe'});
  await reopen();assert.equal(JSON.stringify(env.f.kernel.journal.records()),journal);await refuses('exact-schema-restored');
  evidence('bf17-'+scenario,{scenario,checks,validReplayUnchanged:true,idempotencyMismatchDenied:true,realSchemaRestore:true,recordRevision:before.record[0].revision,applications:1,history:before.history.length,actions:before.actions.length,successfulAudits:before.audit.length});
 }finally{for(const gateway of restartedGateways)await gateway.close();await env.close();}
});
