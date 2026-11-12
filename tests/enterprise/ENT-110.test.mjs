import {test as nodeTest} from 'node:test';import assert from 'node:assert/strict';import {withFixture,restart,vote} from './helpers.mjs';
const draft=f=>({id:f.manifest.id,baseVersion:'1.0.0',version:'2.0.0',label:'変更後の申請',businessDays:3,quorum:1});
test('ENT-110 AC-01 positive persistence running version pin and new instance switch rollback',()=>withFixture(async f=>{
 const old=f.create();await f.call('operator','create',old);await f.call('manager','definitionDraft',draft(f));const ref={id:f.manifest.id,version:'2.0.0'};await f.call('reviewer','review',ref);await f.call('publisher','publish',ref);const fresh=f.create();await f.call('operator','create',fresh);restart(f);
 assert.equal((await f.call('operator','get',{id:old.id})).workflow.packageVersion,'1.0.0');assert.equal((await f.call('operator','get',{id:fresh.id})).workflow.packageVersion,'2.0.0');await f.call('publisher','publish',{...ref,version:'1.0.0'});assert.equal((await f.call('operator','package',{id:ref.id})).manifest.version,'1.0.0');
}));
test('ENT-110 AC-02 negative-authorization incompatible simulation separate review migration rollback failure-recovery',()=>withFixture(async f=>{
 const b=f.create();await f.call('operator','create',b);await f.call('manager','definitionDraft',draft(f));const ref={id:f.manifest.id,version:'2.0.0'};const sim=await f.call('reviewer','definitionSimulate',ref);assert.ok(sim.diff.length);assert.ok(sim.fixtures.every(x=>x.passed));await assert.rejects(f.call('manager','review',ref),{code:'PERMISSION_DENIED'});await f.call('reviewer','review',ref);await f.call('publisher','publish',ref);
 await assert.rejects(f.call('reader','definitionList',{id:ref.id}),{code:'PERMISSION_DENIED'});await assert.rejects(f.call('other','definitionMigrate',{id:b.id,version:'2.0.0',revision:1}),{code:'NOT_FOUND'});
 f.kernel.fault=async p=>{if(p==='definition-migration-before-audit')throw Error('injected rollback');};await assert.rejects(f.call('publisher','definitionMigrate',{id:b.id,version:'2.0.0',revision:1}),{code:'UNAVAILABLE'});restart(f);assert.equal((await f.call('operator','get',{id:b.id})).revision,1);
 await f.call('publisher','definitionMigrate',{id:b.id,version:'2.0.0',revision:1});await f.call('publisher','definitionMigrate',{id:b.id,version:'1.0.0',revision:2});assert.equal((await f.call('operator','get',{id:b.id})).revision,3);await vote(f,'manager',b.id,3);await assert.rejects(f.call('publisher','definitionMigrate',{id:b.id,version:'2.0.0',revision:3}),{code:'CONFLICT'});
 const p=structuredClone(f.manifest);p.version='3.0.0';p.types.Case.memo.classification='INTERNAL';await f.call('manager','install',{manifest:p});assert.ok((await f.call('reviewer','definitionSimulate',{id:p.id,version:p.version})).incompatible.includes('Case.memo'));await f.call('reviewer','review',{id:p.id,version:p.version});await f.call('publisher','publish',{id:p.id,version:p.version});const fresh=f.create();await f.call('publisher','publish',{id:p.id,version:'1.0.0'});await f.call('operator','create',fresh);await assert.rejects(f.call('publisher','definitionMigrate',{id:fresh.id,version:p.version,revision:1}),{code:'PERMISSION_DENIED'});
}));

function test(name,fn){const labels=['positive','negative-authorization','persistence','failure-recovery'].filter(x=>name.includes(x));return nodeTest(name,t=>{const run=(ctx,n)=>n===labels.length?fn(ctx):ctx.test(labels[n]+' '+name,child=>run(child,n+1));return run(t,0);});}

nodeTest('ENT-110 BF-16 STRICT downgrade public HTTP cannot expose existing fields through get query or AI',async t=>{
 const {localEnvironment}=await import('../../scripts/enterprise/local.mjs'),{login}=await import('./http-helper.mjs');
 const env=await localEnvironment();try{
  const users=Object.fromEntries(await Promise.all(['operator','manager','reviewer','publisher','reader'].map(async who=>[who,await login(env,who)])));
  const api=async(who,op,body,key)=>{const r=await users[who].api(op,body,key);return {status:r.status,body:await r.json()};};
  const publish=async(version,classification)=>{const p=structuredClone(env.f.manifest);p.version=version;p.types.Case.memo.classification=classification;
   for(const [who,op,body] of [['manager','install',{manifest:p}],['reviewer','review',{id:p.id,version}],['publisher','publish',{id:p.id,version}]])assert.equal((await api(who,op,body)).status,200);};
  await publish('2.0.0','STRICT');const b=env.f.create();b.fields.memo='synthetic BF-16 STRICT canary';assert.equal((await api('operator','create',b)).status,200);
  const get=()=>api('reader','get',{id:b.id,projection:['memo']});assert.equal((await get()).status,403);assert.equal((await api('reader','get',{id:b.id})).body.result.fields.memo,undefined);
  await publish('3.0.0','INTERNAL');
  const state=async()=>({object:(await env.f.owner.query('SELECT revision,fields FROM objects WHERE id=$1',[b.id])).rows[0],instance:(await env.f.owner.query('SELECT package_version,binding,votes FROM enterprise_instances WHERE id=$1',[b.id])).rows[0],audits:(await env.f.owner.query("SELECT record FROM audit WHERE record->>'operation'='definitionMigrate' AND record->>'kind'='EnterpriseCommand'")).rows});
  const before=await state(),key=crypto.randomUUID(),request={id:b.id,version:'3.0.0',revision:1};
  const migration=await api('publisher','definitionMigrate',request,key),after=await state(),read=await get();
  t.diagnostic(JSON.stringify({before,migration,after,read}));
  assert.deepEqual(migration,{status:403,body:{error:{code:'PERMISSION_DENIED'}}});assert.deepEqual(after,before);assert.equal(read.status,403);
  assert.equal((await api('publisher','definitionMigrate',request,key)).status,403);assert.deepEqual(await state(),before);
  for(const body of [{projection:['memo']},{search:{field:'memo',text:'synthetic'},aggregate:true},{projection:['memo'],export:true}])assert.equal((await api('reader','query',{packageId:b.packageId,type:'Case',...body})).status,403);
  assert.equal((await api('reader','query',{packageId:b.packageId,type:'Case',export:true})).body.result.items[0].fields.memo,undefined);
  const calls=env.model.requests.length;assert.equal((await api('reader','propose',{id:b.id,projection:['memo'],purpose:'summary',maxCost:10})).status,403);assert.equal(env.model.requests.length,calls);
  assert.equal((await api('reader','propose',{id:b.id,projection:['title'],purpose:'summary',maxCost:10})).status,200);assert.ok(!JSON.stringify(env.model.requests).includes(b.fields.memo));
 }finally{await env.close();}
});

nodeTest('ENT-110 BF-16 all accepted field classifications reject lowering and permit equal or stronger HTTP migrations',async t=>{
 const {localEnvironment}=await import('../../scripts/enterprise/local.mjs'),{login}=await import('./http-helper.mjs');
 const {classifications}=await import('../../src/enterprise/contracts.mjs');
 // Explicit expected levels independent of the implementation comparison.
 const order=['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'];assert.deepEqual([...classifications].sort(),[...order].sort());
 const env=await localEnvironment();try{
  const users=Object.fromEntries(await Promise.all(['operator','manager','reviewer','publisher'].map(async who=>[who,await login(env,who)])));
  const api=async(who,op,body,key)=>{const r=await users[who].api(op,body,key);return {status:r.status,body:await r.json()};};
  for(const [n,label] of order.entries()){const p=structuredClone(env.f.manifest);p.version=`${n+2}.0.0`;p.types.Case.memo.classification=label;
   for(const [who,op,body] of [['manager','install',{manifest:p}],['reviewer','review',{id:p.id,version:p.version}],['publisher','publish',{id:p.id,version:p.version}]])assert.equal((await api(who,op,body)).status,200);}
  for(const [i,from] of order.entries())for(const [j,to] of order.entries())await t.test(`${from} -> ${to}`,async()=>{
   assert.equal((await api('publisher','publish',{id:env.f.manifest.id,version:`${i+2}.0.0`})).status,200);const b=env.f.create();assert.equal((await api('operator','create',b)).status,200);
   const state=async()=>({object:(await env.f.owner.query('SELECT revision,fields FROM objects WHERE id=$1',[b.id])).rows[0],instance:(await env.f.owner.query('SELECT package_version,binding FROM enterprise_instances WHERE id=$1',[b.id])).rows[0],audit:(await env.f.owner.query("SELECT count(*)::int n FROM audit WHERE record->>'operation'='definitionMigrate' AND record->>'kind'='EnterpriseCommand' AND record->>'objectId'=$1",[b.id])).rows[0].n});
   const before=await state(),key=crypto.randomUUID(),body={id:b.id,version:`${j+2}.0.0`,revision:1},r=await api('publisher','definitionMigrate',body,key);
   const lowering=Math.min(j,3)<Math.min(i,3);
   assert.equal(r.status,lowering?403:200);const after=await state();
   if(lowering)assert.deepEqual(after,before);else{assert.equal(after.object.revision,2);assert.deepEqual(after.object.fields,before.object.fields);assert.equal(after.instance.package_version,body.version);assert.equal(after.audit,1);assert.deepEqual(await api('publisher','definitionMigrate',body,key),r);assert.deepEqual(await state(),after);}
  });
 }finally{await env.close();}
});

async function bf45Environment(){
 const {localEnvironment}=await import('../../scripts/enterprise/local.mjs'),{login}=await import('./http-helper.mjs'),{scope,operations}=await import('../../scripts/enterprise/fixture.mjs');
 const env=await localEnvironment(),records=[],checks=[];
 const api=async(user,operation,body,key)=>{const r=await user.api(operation,body,key),x={operation,request:body,key,status:r.status,body:await r.json()};records.push(x);return x;};
 const users={};for(const who of ['operator','manager','reviewer','publisher','other','tenant2'])users[who]=await login(env,who);
 const base=structuredClone(env.f.manifest);base.version='1.1.0';for(const type of Object.values(base.types))for(const field of Object.values(type))if(['STRICT','RESTRICTED'].includes(field.classification))field.classification='CONFIDENTIAL';
 for(const [who,op,body] of [['manager','install',{manifest:base}],['reviewer','review',{id:base.id,version:base.version}],['publisher','publish',{id:base.id,version:base.version}]])assert.equal((await api(users[who],op,body)).status,200);
 const p=structuredClone(base);p.version='2.0.0';p.calendar.businessDays=3;
 for(const [who,op,body] of [['manager','install',{manifest:p}],['reviewer','review',{id:p.id,version:p.version}],['publisher','publish',{id:p.id,version:p.version}],['publisher','publish',{id:p.id,version:'1.1.0'}]])assert.equal((await api(users[who],op,body)).status,200);
 const all=['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'],low=['PUBLIC','INTERNAL','CONFIDENTIAL'];
 const grant=async(fields=all,ops=operations,scopes=[scope],principal='manager')=>{const x=await api(users.publisher,'grant',{principal,fields,operations:ops,scopes});assert.equal(x.status,200);};
 const create=async()=>{const b=env.f.create();assert.equal((await api(users.operator,'create',b)).status,200);return b;};
 const classify=async(b,purposes=['summary','disclosure'])=>{const id=crypto.randomUUID();assert.equal((await api(users.publisher,'informationCreate',{id,scope,source:{kind:'object',id:b.id,projection:['title']},label:'STRICT',purposes})).status,200);return id;};
 const snapshot=async()=>{const state={};for(const [table,order]of [['objects','id'],['enterprise_instances','id'],['history','object_id,revision'],['actions','id'],['outbox','operation_id']])state[table]=(await env.f.owner.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;state.audit=(await env.f.owner.query("SELECT * FROM audit WHERE record->>'kind' NOT IN ('Denied','EnterpriseHTTPDenied') ORDER BY sequence")).rows;return state;};
 return {env,users,api,records,checks,all,low,grant,create,classify,snapshot};
}

nodeTest('ENT-110 BF-45 HTTP current source policy guards new migration and replay through revocation restart and restore',async()=>{
 const x=await bf45Environment(),{env,users,api,records,checks,all,low,grant,create,classify,snapshot}=x;
 const {execFileSync}=await import('node:child_process'),{mkdir,writeFile}=await import('node:fs/promises'),{login}=await import('./http-helper.mjs'),{enterpriseGateway}=await import('../../src/enterprise/gateway.mjs');
 const output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';
 try{
  const b=await create(),prior=await create(),priorKey=crypto.randomUUID(),priorRequest={id:prior.id,version:'2.0.0',revision:1};
  const success=await api(users.manager,'definitionMigrate',priorRequest,priorKey);assert.equal(success.status,200);const unchanged=await snapshot();assert.deepEqual(await api(users.manager,'definitionMigrate',priorRequest,priorKey),success);assert.deepEqual(await snapshot(),unchanged);
  const schema=(await env.f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',env.cluster.config.host,'-p',String(env.cluster.config.port),'-U',env.cluster.config.user,'-d',env.cluster.config.database];
  const dump=name=>{const path=env.cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};
  const restore=async path=>{await env.f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});};
  const reconnect=async()=>{await env.gateway.close();restart(env.f);env.gateway=await enterpriseGateway(env.f.kernel,{issuer:env.idp.issuer});for(const who of Object.keys(users))users[who]=await login(env,who);};
  const beforeUser=users.manager,beforeClassification=dump('before-classification');await grant(low);const classification=await classify(b);await classify(prior);
  for(const operation of ['get','history'])assert.equal((await api(users.manager,operation,{id:b.id,purpose:'summary'})).status,403);
  const request={id:b.id,version:'2.0.0',revision:1},key=crypto.randomUUID(),before=await snapshot();
  const fresh=await api(users.manager,'definitionMigrate',request,key),replay=await api(users.manager,'definitionMigrate',priorRequest,priorKey),after=await snapshot();
  checks.push({name:'classified-new-and-replay',before,fresh,replay,after});
  assert.equal(fresh.status,403);assert.equal(replay.status,403);assert.deepEqual(after,before);
  const deny=async(body,code='PERMISSION_DENIED',who='manager',key=crypto.randomUUID())=>{const before=await snapshot(),requests=env.effects.requests(),r=await api(users[who],'definitionMigrate',body,key),after=await snapshot();checks.push({name:'denial',before,r,after});assert.equal(r.status,code==='NOT_FOUND'?404:code==='PERMISSION_DENIED'?403:400);assert.deepEqual(r.body,{error:{code}});assert.deepEqual(after,before);assert.deepEqual(env.effects.requests(),requests);return r;};
  await deny({...request,purpose:'summary'});await grant(all);await deny(request);await deny({...request,purpose:'other'});
  for(const purpose of [null,1,'','x'.repeat(129)])await deny({...request,purpose},'INVALID_ARGUMENT');
  const allowed={...request,purpose:'summary'},allowedKey=crypto.randomUUID();assert.equal((await api(users.manager,'definitionMigrate',allowed,allowedKey)).status,200);
  const migrated=await snapshot();assert.equal((await api(users.manager,'definitionMigrate',allowed,allowedKey)).status,200);assert.deepEqual(await snapshot(),migrated);await deny({...allowed,purpose:'disclosure'},'IDEMPOTENCY_MISMATCH','manager',allowedKey);
  await classify(b,['disclosure']);await deny(allowed,'PERMISSION_DENIED','manager',allowedKey);const rollback={id:b.id,version:'1.1.0',revision:2,purpose:'disclosure'},rollbackKey=crypto.randomUUID();assert.equal((await api(users.manager,'definitionMigrate',rollback,rollbackKey)).status,200);
  const complete=dump('complete');await reconnect();assert.equal((await api(users.manager,'definitionMigrate',rollback,rollbackKey)).status,200);
  await grant(low);await deny(rollback,'PERMISSION_DENIED','manager',rollbackKey);await reconnect();await deny(rollback,'PERMISSION_DENIED','manager',rollbackKey);
  await restore(complete);await reconnect();await deny(rollback,'PERMISSION_DENIED','manager',rollbackKey);await grant(all);assert.equal((await api(users.manager,'definitionMigrate',rollback,rollbackKey)).status,200);
  const valid=dump('valid');await restore(beforeClassification);users.manager=beforeUser;await deny(rollback,'RECOVERING','manager',rollbackKey);await restore(valid);await reconnect();
  await env.f.owner.query('DELETE FROM enterprise_controls WHERE id=$1',[classification]);await deny(rollback,'RECOVERING','manager',rollbackKey);await restore(valid);await reconnect();
  for(const who of ['other','tenant2'])await deny(rollback,'NOT_FOUND',who);await grant(all,[],undefined);await deny(rollback,'PERMISSION_DENIED','manager',rollbackKey);await grant(all);await grant(['PUBLIC','INTERNAL']);await deny(rollback,'PERMISSION_DENIED','manager',rollbackKey);await grant(all);
  // Scope-only denial and original requester's revocation are independent controls.
  await grant(all,undefined,[]);await deny(rollback,'NOT_FOUND','manager',rollbackKey);await grant(all);
  const newRequest={id:b.id,version:'2.0.0',revision:3,purpose:'disclosure'};await grant(all,[],undefined,'operator');await deny(newRequest,'PERMISSION_DENIED');
  assert.deepEqual(await env.effects.ledger(),[]);checks.push({name:'no-external-effects',requests:env.effects.requests()});
 }finally{await mkdir(output,{recursive:true});await writeFile(output+'/BF45-contract.json',JSON.stringify({records,checks},null,2)+'\n');await env.gateway.close();await env.close();}
});

nodeTest('ENT-110 BF-45 authenticated browser public migration API rechecks current policy on replay',async()=>{
 const {env,users,api,records,grant,create,classify,all,low}=await bf45Environment();
 const {browser}=await import('./browser-helper.mjs'),{mkdir,writeFile}=await import('node:fs/promises');const page=await browser(),output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser',result={};
 try{
  const b=await create();await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]','manager');await page.click('button');await page.until('!!document.querySelector("#cases")');
  // This is an authenticated public API check, not a migration-form test.
  await page.evaluate(`window.bf45=[];window.migrate=async(body,key)=>{const session=await(await fetch('/session')).json();const response=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrf},body:JSON.stringify({contractVersion:'2.0.0',operation:'definitionMigrate',body,key})});const record={request:body,key,status:response.status,body:await response.json()};window.bf45.push(record);let output=document.querySelector('#bf45-result');if(!output){output=document.createElement('pre');output.id='bf45-result';document.body.prepend(output);}output.textContent=JSON.stringify(record,null,2);return record;};`);
  const request={id:b.id,version:'2.0.0',revision:1},key=crypto.randomUUID(),call=(body=request,k=key)=>page.evaluate(`window.migrate(${JSON.stringify(body)},${JSON.stringify(k)})`);
  assert.equal((await call()).status,200);await page.screenshot('BF45-unclassified');await grant(low);await classify(b,['summary']);for(const op of ['get','history'])assert.equal((await api(users.manager,op,{id:b.id,purpose:'summary'})).status,403);
  const denied=await call();await page.screenshot('BF45-classified-replay');assert.equal(denied.status,403);assert.deepEqual(denied.body,{error:{code:'PERMISSION_DENIED'}});
  await grant(all);const rollback={id:b.id,version:'1.1.0',revision:2,purpose:'summary'},rollbackKey=crypto.randomUUID();assert.equal((await call(rollback,rollbackKey)).status,200);await page.screenshot('BF45-authorized');await grant(low);assert.equal((await call(rollback,rollbackKey)).status,403);await page.screenshot('BF45-revoked');
  assert.equal((await env.f.owner.query('SELECT revision FROM objects WHERE id=$1',[b.id])).rows[0].revision,3);assert.deepEqual(await env.effects.ledger(),[]);result.browser=await page.send('Browser.getVersion');
 }finally{result.records=await page.evaluate('window.bf45??[]');result.setup=records;await mkdir(output,{recursive:true});await writeFile(output+'/BF45-browser.json',JSON.stringify(result,null,2)+'\n');await page.close();await env.close();}
});
