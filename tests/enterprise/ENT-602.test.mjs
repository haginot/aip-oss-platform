import {test as nodeTest} from 'node:test';import assert from 'node:assert/strict';import {localEnvironment} from '../../scripts/enterprise/local.mjs';import {login} from './http-helper.mjs';
test('ENT-602 AC-01 positive persistence public HTTP definition diff simulation separate review publication rollback',async()=>{
 const env=await localEnvironment();try{const author=await login(env,'manager'),reviewer=await login(env,'reviewer'),publisher=await login(env,'publisher');const id=env.f.manifest.id,ref={id,version:'2.0.0'};
 assert.equal((await author.api('definitionDraft',{id,baseVersion:'1.0.0',version:'2.0.0',label:'日本語の件名',businessDays:3,quorum:1})).status,200);
 assert.equal((await author.api('review',ref)).status,403);const sim=await (await reviewer.api('definitionSimulate',ref)).json();assert.equal(sim.result.fixtures.length,2);assert.ok(sim.result.diff.length);
 assert.equal((await reviewer.api('review',ref)).status,200);assert.equal((await publisher.api('publish',ref)).status,200);assert.equal((await publisher.api('publish',{id,version:'1.0.0'})).status,200);
 const again=await login(env,'manager'),data=await (await again.api('definitionList',{id})).json();assert.equal(data.result.live,'1.0.0');assert.ok(data.result.history.some(x=>x.operation==='definitionDraft'));
 }finally{await env.close();}
});
test('ENT-602 AC-02 negative-authorization failure-recovery finite authoring rejects arbitrary code SQL and invalid versions without saving',async()=>{
 const env=await localEnvironment();try{const author=await login(env,'manager'),reader=await login(env,'reader'),id=env.f.manifest.id;
 assert.equal((await reader.api('definitionList',{id})).status,403);const body={id,baseVersion:'1.0.0',version:'2.0.0',label:'表示名',businessDays:3,quorum:1};
 for(const extra of [{sql:'DROP TABLE actions'},{javascript:'process.exit()'},{url:'https://example.invalid'},{version:'invalid'},{quorum:99}])assert.equal((await author.api('definitionDraft',{...body,...extra})).status,400);
 assert.equal((await author.api('definitionDraft',body)).status,200);const data=await (await author.api('definitionList',{id})).json();assert.equal(data.result.items.length,2);
 }finally{await env.close();}
});

function test(name,fn){const labels=['positive','negative-authorization','persistence','failure-recovery'].filter(x=>name.includes(x));return nodeTest(name,t=>{const run=(ctx,n)=>n===labels.length?fn(ctx):ctx.test(labels[n]+' '+name,child=>run(child,n+1));return run(t,0);});}

// BF-20 exercises the same public HTTP route used by the administration UI.
nodeTest('ENT-602 BF-20 revoked reviewer cannot publish and fresh review restores publication',async()=>{
 const env=await localEnvironment();try{
 const author=await login(env,'manager'),reviewer=await login(env,'reviewer'),publisher=await login(env,'publisher'),ref={id:env.f.manifest.id,version:'2.0.0'};
 assert.equal((await author.api('definitionDraft',{id:ref.id,baseVersion:'1.0.0',version:ref.version,label:'BF-20',businessDays:3,quorum:1})).status,200);
 const reviewKey=crypto.randomUUID();assert.equal((await reviewer.api('review',ref,reviewKey)).status,200);
 const grant=(await env.f.owner.query("SELECT * FROM enterprise_grants WHERE principal='reviewer'")).rows[0];
 const set=operations=>publisher.api('grant',{principal:'reviewer',scopes:grant.scopes,operations,fields:grant.fields});
 assert.equal((await set(grant.operations.filter(x=>x!=='review'))).status,200);
 const state=async()=>({packages:(await env.f.owner.query('SELECT * FROM enterprise_packages ORDER BY version')).rows,live:(await env.f.owner.query('SELECT * FROM enterprise_live')).rows,actions:(await env.f.owner.query("SELECT * FROM actions WHERE request->>'operation'='publish' ORDER BY id")).rows,audit:(await env.f.owner.query("SELECT * FROM audit WHERE record->>'kind'='EnterpriseCommand' AND record->>'operation'='publish' ORDER BY sequence")).rows});
 const before=await state(),key=crypto.randomUUID();const denied=await publisher.api('publish',ref,key);assert.equal(denied.status,403,JSON.stringify(await denied.json()));assert.deepEqual(await state(),before);
 assert.equal((await set(grant.operations)).status,200);
 // Restoring the permission does not revive the old revision or its same-key review.
 const stale=await publisher.api('publish',ref,key);assert.equal(stale.status,400);assert.equal((await stale.json()).error.code,'STALE_APPROVAL');const replay=await reviewer.api('review',ref,reviewKey);assert.equal(replay.status,400);assert.equal((await replay.json()).error.code,'STALE_APPROVAL');
 assert.equal((await reviewer.api('review',ref)).status,200);assert.equal((await publisher.api('publish',ref,key)).status,200);
 assert.equal((await publisher.api('publish',ref,key)).status,200);
 assert.equal((await set(grant.operations.filter(x=>x!=='review'))).status,200);assert.equal((await publisher.api('publish',ref,key)).status,403);
 }finally{await env.close();}
});

nodeTest('ENT-602 BF-20 restored database cannot revive reviewer and renewed review permits rollback',async()=>{
 const {execFileSync}=await import('node:child_process'),{join}=await import('node:path'),{restart}=await import('./helpers.mjs'),{enterpriseGateway}=await import('../../src/enterprise/gateway.mjs');
 const env=await localEnvironment();let gateway;try{
 const ref={id:env.f.manifest.id,version:'2.0.0'};await env.f.call('manager','install',{manifest:{...env.f.manifest,version:ref.version}});await env.f.call('reviewer','review',ref);
 const schema=(await env.f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',env.cluster.config.host,'-p',String(env.cluster.config.port),'-U',env.cluster.config.user,'-d',env.cluster.config.database],path=join(env.cluster.directory,'before-review-revocation.sql');execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);
 const g=(await env.f.owner.query("SELECT * FROM enterprise_grants WHERE principal='reviewer'")).rows[0],grant={principal:g.principal,scopes:g.scopes,operations:g.operations,fields:g.fields};await env.f.call('publisher','grant',{...grant,operations:g.operations.filter(x=>x!=='review')});
 await env.f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});restart(env.f);
 gateway=await enterpriseGateway(env.f.kernel,{issuer:env.idp.issuer});const publisher=await login({...env,gateway},'publisher');const denied=await publisher.api('publish',ref);assert.equal(denied.status,403);assert.equal((await denied.json()).error.code,'PERMISSION_DENIED');assert.equal((await env.f.owner.query('SELECT version FROM enterprise_live')).rows[0].version,'1.0.0');
 await env.f.call('publisher','grant',grant);const reviewer=await login({...env,gateway},'reviewer');assert.equal((await reviewer.api('review',ref)).status,200);assert.equal((await publisher.api('publish',ref)).status,200);
 const old={...ref,version:'1.0.0'};assert.equal((await publisher.api('publish',old)).status,400);assert.equal((await reviewer.api('review',old)).status,200);assert.equal((await publisher.api('publish',old)).status,200);assert.equal((await env.f.owner.query('SELECT version FROM enterprise_live')).rows[0].version,'1.0.0');
 }finally{await gateway?.close();await env.close();}
});
