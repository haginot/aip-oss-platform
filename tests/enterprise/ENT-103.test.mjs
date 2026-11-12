import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localEnvironment} from '../../scripts/enterprise/local.mjs';
import {login} from './http-helper.mjs';
import {withFixture,restart} from './helpers.mjs';
import {scope} from '../../scripts/enterprise/fixture.mjs';

test('ENT-103 AC-01 positive negative-authorization real OIDC signature issuer audience expiry nonce CSRF session revocation',async t=>t.test('positive ENT-103 executable contract scenario',async()=>{
 const env=await localEnvironment();try{
  const user=await login(env);assert.equal(user.response.status,302);assert.equal(user.identity.actor,'operator');assert.match(user.response.headers.get('set-cookie'),/HttpOnly/);
  assert.equal((await user.api('package',{id:'enterprise-foundation'})).status,200);
  assert.equal((await user.api('package',{id:'enterprise-foundation'},undefined,{'x-csrf-token':'wrong'})).status,403);
  assert.equal((await user.api('package',{id:'enterprise-foundation'},undefined,{origin:'http://evil.invalid'})).status,403);
  for(const claims of [{iss:'http://evil.invalid'},{aud:'wrong'},{exp:1},{nonce:'wrong'},{nbf:9999999999},{sub:'unmapped'}]){env.idp.claims(claims);assert.equal((await login(env)).response.status,403);}
  env.idp.claims({});env.idp.signatureInvalid(true);assert.equal((await login(env)).response.status,403);env.idp.signatureInvalid(false);
  assert.equal((await login(env,'operator',url=>{const u=new URL(url);u.searchParams.set('state','wrong');return u;})).response.status,403);
  assert.equal((await user.api('logout')).status,200);assert.equal((await user.api('package',{id:'enterprise-foundation'})).status,403);
 }finally{await env.close();}
}));
test('ENT-103 AC-02 positive negative-authorization tenant department case field search aggregate attachment export',async t=>t.test('negative-authorization ENT-103 executable contract scenario',()=>withFixture(async f=>{
 const b=f.create();await f.call('operator','create',b);const file=await f.call('operator','attach',{id:b.id,content:'synthetic confidential attachment'});
 assert.deepEqual((await f.call('reader','get',{id:b.id})).fields,{title:b.fields.title,currency:b.fields.currency});
 for(const who of ['other','tenant2']){for(const op of ['get','history'])await assert.rejects(f.call(who,op,{id:b.id}),{code:'NOT_FOUND'});await assert.rejects(f.call(who,'attachment',{id:b.id,hash:file.hash}),{code:'NOT_FOUND'});if(who==='other')assert.deepEqual(await f.call(who,'query',{packageId:'enterprise-foundation',type:'Case',aggregate:true}),{count:0});else await assert.rejects(f.call(who,'query',{packageId:'enterprise-foundation',type:'Case',aggregate:true}),{code:'NOT_FOUND'});}
 for(const mode of [{projection:['memo']},{search:{field:'memo',text:'synthetic'}},{search:{field:'memo',text:'synthetic'},aggregate:true},{projection:['memo'],export:true}])await assert.rejects(f.call('reader','query',{packageId:'enterprise-foundation',type:'Case',...mode}),{code:'PERMISSION_DENIED'});
 await assert.rejects(f.call('reader','attachment',{id:b.id,hash:file.hash}),{code:'PERMISSION_DENIED'});
 assert.equal((await f.call('operator','attachment',{id:b.id,hash:file.hash})).content,'synthetic confidential attachment');
 for(const field of ['departmentId','caseId','legalEntityId'])await assert.rejects(f.call('operator','create',f.create({scope:{...scope,[field]:'unauthorized'}})),{code:'NOT_FOUND'});
 assert.equal((await f.call('reader','query',{packageId:'enterprise-foundation',type:'Case',aggregate:true})).count,1);
})));
test('ENT-103 AC-03 persistence failure-recovery immediate role change termination and delegation revoke',async t=>t.test('persistence ENT-103 executable contract scenario',async t=>t.test('failure-recovery ENT-103 executable contract scenario',()=>withFixture(async f=>{
 const b=f.create();await f.call('operator','create',b);await f.call('publisher','grant',{principal:'reader',scopes:[],operations:['read','search'],fields:['INTERNAL']});restart(f);
 await assert.rejects(f.call('reader','get',{id:b.id}),{code:'NOT_FOUND'});
 await f.owner.query("UPDATE principals SET active=false WHERE id='operator'");await assert.rejects(f.call('operator','get',{id:b.id}),{code:'PERMISSION_DENIED'});
 await f.owner.query('UPDATE policy SET available=false');await assert.rejects(f.call('manager','get',{id:b.id}),{code:'UNAVAILABLE'});await f.owner.query('UPDATE policy SET available=true');assert.equal((await f.call('manager','get',{id:b.id})).id,b.id);
}))));

test('ENT-103 browser positive negative-authorization OIDC form approval UNKNOWN reconciliation field and department isolation',async()=>{
 const env=await localEnvironment();try{const {portalScenario}=await import('./browser-scenario.mjs');const result=await portalScenario(env);const {mkdir,writeFile}=await import('node:fs/promises');const output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';await mkdir(output,{recursive:true});await writeFile(output+'/browser.json',JSON.stringify(result,null,2)+'\n');}finally{await env.close();}
});

test('ENT-103 BF-40 history HTTP current classification purpose revocation restart and PostgreSQL restore',async()=>{
 const env=await localEnvironment(),records=[];const {mkdir,writeFile}=await import('node:fs/promises');const output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';
 const api=async(user,operation,body)=>{const response=await user.api(operation,body),result={operation,request:body,status:response.status,body:await response.json()};records.push(result);return result;};
 try{
  const {execFileSync}=await import('node:child_process'),{enterpriseGateway}=await import('../../src/enterprise/gateway.mjs');
  let operator=await login(env,'operator'),publisher=await login(env,'publisher'),reader=await login(env,'reader');
  const reconnect=async()=>{await env.gateway.close();restart(env.f);env.gateway=await enterpriseGateway(env.f.kernel,{issuer:env.idp.issuer});operator=await login(env,'operator');publisher=await login(env,'publisher');reader=await login(env,'reader');};
  const b=env.f.create();assert.equal((await api(operator,'create',b)).status,200);
  const grant=fields=>api(publisher,'grant',{principal:'reader',scopes:[scope],operations:['read','search'],fields});
  assert.equal((await grant(['INTERNAL','CONFIDENTIAL'])).status,200);
  const original=(await api(reader,'history',{id:b.id})).body.result.events;assert.equal(original.length,1);assert.ok(original[0].action_id);assert.ok(original[0].recorded_at);
  const persisted=async()=>({history:(await env.f.owner.query('SELECT * FROM history WHERE object_id=$1 ORDER BY revision',[b.id])).rows,instance:(await env.f.owner.query('SELECT * FROM enterprise_instances WHERE id=$1',[b.id])).rows,action:(await env.f.owner.query('SELECT * FROM actions WHERE id=$1',[original[0].action_id])).rows});
  const saved=await persisted(),audit=(await env.f.owner.query('SELECT * FROM audit ORDER BY sequence')).rows;
  const schema=(await env.f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',env.cluster.config.host,'-p',String(env.cluster.config.port),'-U',env.cluster.config.user,'-d',env.cluster.config.database];
  const dump=name=>{const path=env.cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};
  const restore=async path=>{await env.f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});};
  const snapshotReader=reader,before=dump('BF40-before'),classify=async(label,purposes)=>{const id=crypto.randomUUID();assert.equal((await api(operator,'informationCreate',{id,scope,source:{kind:'object',id:b.id,projection:['title']},label,purposes})).status,200);return id;};
  await classify('CONFIDENTIAL',['summary','disclosure']);const strictId=await classify('STRICT',['summary','disclosure']);
  const deniedGet=await api(reader,'get',{id:b.id,purpose:'summary'}),deniedHistory=await api(reader,'history',{id:b.id});
  assert.equal(deniedGet.status,403);assert.deepEqual(deniedHistory.body,{error:{code:'PERMISSION_DENIED'}});assert.equal(deniedHistory.status,403);
  const deny=async(user,body,code='PERMISSION_DENIED',status=403)=>{const start=(await env.f.owner.query('SELECT coalesce(max(sequence),0) n FROM audit')).rows[0].n;const r=await api(user,'history',body);assert.equal(r.status,status);assert.deepEqual(r.body,{error:{code}});assert.equal((await env.f.owner.query("SELECT * FROM audit WHERE sequence>$1 AND record->>'kind'='EnterpriseRead' AND record->>'operation'='history'",[start])).rows.length,0);};
  await deny(reader,{id:b.id,purpose:'summary'});
  for(const account of ['other','tenant2'])await deny(await login(env,account),{id:b.id,purpose:'summary'},'NOT_FOUND',404);
  assert.equal((await grant(['INTERNAL','CONFIDENTIAL','STRICT'])).status,200);
  await deny(reader,{id:b.id});for(const purpose of ['summary','disclosure'])assert.deepEqual((await api(reader,'history',{id:b.id,purpose})).body.result.events,original);
  await classify('STRICT',['disclosure']);await deny(reader,{id:b.id,purpose:'summary'});assert.deepEqual((await api(reader,'history',{id:b.id,purpose:'disclosure'})).body.result.events,original);
  const complete=dump('BF40-complete');await reconnect();await deny(reader,{id:b.id,purpose:'summary'});assert.deepEqual((await api(reader,'history',{id:b.id,purpose:'disclosure'})).body.result.events,original);
  const journal=JSON.stringify(env.f.kernel.journal.records());await restore(before);await deny(snapshotReader,{id:b.id,purpose:'summary'},'RECOVERING',400);assert.equal(JSON.stringify(env.f.kernel.journal.records()),journal);
  await restore(complete);await reconnect();assert.deepEqual((await api(reader,'history',{id:b.id,purpose:'disclosure'})).body.result.events,original);
  assert.equal((await grant(['INTERNAL','CONFIDENTIAL'])).status,200);await deny(reader,{id:b.id,purpose:'disclosure'});await reconnect();await deny(reader,{id:b.id,purpose:'disclosure'});
  await restore(complete);await reconnect();await deny(reader,{id:b.id,purpose:'disclosure'});assert.deepEqual((await api(publisher,'history',{id:b.id,purpose:'disclosure'})).body.result.events,original);
  await env.f.owner.query('DELETE FROM enterprise_controls WHERE id=$1',[strictId]);await deny(publisher,{id:b.id,purpose:'disclosure'},'RECOVERING',400);
  await restore(complete);assert.deepEqual(await persisted(),saved);assert.deepEqual((await env.f.owner.query('SELECT * FROM audit WHERE sequence<=$1 ORDER BY sequence',[audit.at(-1).sequence])).rows,audit);
  assert.equal((await env.f.owner.query('SELECT * FROM outbox')).rows.length,0);assert.equal((await env.effects.ledger()).length,0);
 }finally{await mkdir(output,{recursive:true});await writeFile(output+'/BF40-contract.json',JSON.stringify({records},null,2)+'\n');await env.gateway.close();await env.close();}
});

test('ENT-103 BF-40 browser fresh history request after classification purpose restriction and grant revocation',async()=>{
 const env=await localEnvironment();const {browser}=await import('./browser-helper.mjs'),page=await browser();const {mkdir,writeFile}=await import('node:fs/promises');const output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';let result={};
 try{
  const operator=await login(env,'operator'),publisher=await login(env,'publisher'),b=env.f.create();assert.equal((await operator.api('create',b)).status,200);
  const grant=fields=>publisher.api('grant',{principal:'reader',scopes:[scope],operations:['read','search'],fields});assert.equal((await grant(['INTERNAL','CONFIDENTIAL'])).status,200);
  await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]','reader');await page.click('button');await page.until('document.querySelectorAll("#cases button").length===1');await page.click('#cases button');await page.until('document.querySelector("#record").dataset.id==='+JSON.stringify(b.id));
  await page.evaluate(`window.bf40=[];const originalFetch=window.fetch;window.fetch=async(...args)=>{const r=await originalFetch(...args);if(args[0]==='/api')window.bf40.push({request:JSON.parse(args[1].body),status:r.status,body:await r.clone().json()});return r;}`);
  const history=async()=>{const n=await page.evaluate('window.bf40.length');await page.click('#history');await page.until(`window.bf40.length>${n}`);await page.until('document.querySelector("#message").textContent.length>0');return page.evaluate('window.bf40.at(-1)');};
  assert.equal((await history()).status,200);await page.until('document.querySelector("#message").textContent.includes("版 1")');
  const classify=async(label,purposes)=>assert.equal((await operator.api('informationCreate',{id:crypto.randomUUID(),scope,source:{kind:'object',id:b.id,projection:['title']},label,purposes})).status,200);
  await classify('CONFIDENTIAL',['summary','disclosure']);await classify('STRICT',['summary','disclosure']);
  const denied=await history();await page.screenshot('BF40-classification');assert.equal(denied.status,403);assert.deepEqual(denied.body,{error:{code:'PERMISSION_DENIED'}});await page.until('document.querySelector("#message").textContent.includes("PERMISSION_DENIED")');assert.equal(await page.evaluate('document.querySelector("#message").textContent.includes("版 1")'),false);
  assert.equal((await grant(['INTERNAL','CONFIDENTIAL','STRICT'])).status,200);await page.click('#reload');await page.until('document.querySelectorAll("#cases button").length===1');await page.click('#cases button');assert.equal((await history()).status,200);await page.until('document.querySelector("#message").textContent.includes("版 1")');await page.screenshot('BF40-authorized');
  assert.equal((await grant(['INTERNAL','CONFIDENTIAL'])).status,200);assert.equal((await history()).status,403);await page.until('document.querySelector("#message").textContent.includes("PERMISSION_DENIED")');await page.screenshot('BF40-revoked');
  assert.equal((await grant(['INTERNAL','CONFIDENTIAL','STRICT'])).status,200);await classify('STRICT',['disclosure']);assert.equal((await history()).status,403);await page.until('document.querySelector("#message").textContent.includes("PERMISSION_DENIED")');await page.screenshot('BF40-purpose');
  assert.equal((await env.effects.ledger()).length,0);result.browser=await page.send('Browser.getVersion');result.externalEffects=0;
 }finally{result.records=await page.evaluate('window.bf40??[]');result.message=await page.evaluate('document.querySelector("#message")?.textContent');await mkdir(output,{recursive:true});await writeFile(output+'/BF40-browser.json',JSON.stringify(result,null,2)+'\n');await page.close();await env.close();}
});

test('ENT-103 negative-authorization publication cannot downgrade existing field search export protection',()=>withFixture(async f=>{
 const b=f.create();await f.call('operator','create',b);const p=structuredClone(f.manifest);p.version='2.0.0';p.types.Case.memo.classification='INTERNAL';await f.call('manager','install',{manifest:p});await f.call('reviewer','review',{id:p.id,version:p.version});await f.call('publisher','publish',{id:p.id,version:p.version});
 const result=await f.call('reader','query',{packageId:p.id,type:'Case',export:true});assert.equal(result.items[0].fields.memo,undefined);
 await assert.rejects(f.call('reader','query',{packageId:p.id,type:'Case',search:{field:'memo',text:'synthetic'},aggregate:true}),{code:'PERMISSION_DENIED'});
}));

test('ENT-103 negative-authorization replay after approval still checks current object scope',()=>withFixture(async f=>{
 const b=f.create(),key=crypto.randomUUID();await f.call('operator','create',b,key);
 for(const who of ['manager','reviewer','publisher'])await f.call(who,'vote',{id:b.id,revision:1,decision:'APPROVE'});
 await f.call('publisher','grant',{principal:'operator',scopes:[],operations:['read','search','action'],fields:['INTERNAL','CONFIDENTIAL','RESTRICTED']});
 await assert.rejects(f.call('operator','create',b,key),{code:'NOT_FOUND'});
}));

test('ENT-103 BF-15 classified attachment HTTP reads enforce classification and explicit purpose',async t=>{
 const env=await localEnvironment();try{
  const operator=await login(env,'operator'),publisher=await login(env,'publisher'),reader=await login(env,'reader');
  const api=async(user,op,body)=>{const r=await user.api(op,body);return {status:r.status,body:await r.json()};};
  const b=env.f.create(),content='synthetic BF-15 classified attachment';
  assert.equal((await api(operator,'create',b)).status,200);
  const attached=await api(operator,'attach',{id:b.id,content});assert.equal(attached.status,200);const ref={id:b.id,hash:attached.body.result.hash};
  assert.deepEqual(await api(operator,'attachment',ref),{status:200,body:{contractVersion:'2.0.0',result:{content}}});
  const controlId=crypto.randomUUID();assert.equal((await api(operator,'informationCreate',{id:controlId,scope,source:{kind:'object',id:b.id,projection:['title']},label:'CONFIDENTIAL',purposes:['summary']})).status,200);
  const control=(await env.f.owner.query('SELECT action_id FROM enterprise_controls WHERE id=$1',[controlId])).rows[0];
  assert.ok(env.f.kernel.journal.records().some(x=>x.actionId===control.action_id&&x.phase==='COMMITTED'));
  const grant=fields=>api(publisher,'grant',{principal:'reader',scopes:[scope],operations:['read','search'],fields});
  assert.equal((await grant(['INTERNAL','RESTRICTED'])).status,200);
  const start=(await env.f.owner.query('SELECT coalesce(max(sequence),0) n FROM audit')).rows[0].n;
  const deniedGet=await api(reader,'get',{id:b.id,purpose:'summary'}),withoutClassification=await api(reader,'attachment',ref);
  assert.equal((await grant(['INTERNAL','CONFIDENTIAL','RESTRICTED'])).status,200);
  const missingPurposeGet=await api(reader,'get',{id:b.id}),missingPurposeAttachment=await api(reader,'attachment',ref);
  const successAudit=(await env.f.owner.query("SELECT record FROM audit WHERE sequence>$1 AND record->>'kind'='EnterpriseRead' AND record->>'operation'='attachment' AND record->>'actor'='reader'",[start])).rows;
  t.diagnostic(JSON.stringify({deniedGet,withoutClassification,missingPurposeGet,missingPurposeAttachment,successAudit}));
  for(const result of [deniedGet,withoutClassification,missingPurposeGet,missingPurposeAttachment])assert.deepEqual(result,{status:403,body:{error:{code:'PERMISSION_DENIED'}}});
  assert.equal(successAudit.length,0);
  assert.deepEqual(await api(reader,'attachment',{...ref,purpose:'summary'}),{status:200,body:{contractVersion:'2.0.0',result:{content}}});
  assert.equal((await api(reader,'attachment',{...ref,purpose:'disclosure'})).status,403);
  assert.equal((await grant(['INTERNAL','RESTRICTED'])).status,200);
  assert.equal((await api(reader,'attachment',{...ref,purpose:'summary'})).status,403);
  assert.equal((await grant(['INTERNAL','CONFIDENTIAL'])).status,200);
  assert.equal((await api(reader,'attachment',{...ref,purpose:'summary'})).status,403);
  for(const who of ['other','tenant2'])assert.equal((await api(await login(env,who),'attachment',{...ref,purpose:'summary'})).status,404);
 }finally{await env.close();}
});

test('ENT-103 BF-15 attachment known hash cannot bypass strengthened policy restart or PostgreSQL restore',async()=>{
 const env=await localEnvironment();try{
  const {execFileSync}=await import('node:child_process');const {enterpriseGateway}=await import('../../src/enterprise/gateway.mjs');
  let operator=await login(env,'operator'),publisher=await login(env,'publisher'),reader=await login(env,'reader');
  const api=async(user,op,body)=>{const r=await user.api(op,body);return {status:r.status,body:await r.json()};};
  const reconnect=async()=>{await env.gateway.close();restart(env.f);env.gateway=await enterpriseGateway(env.f.kernel,{issuer:env.idp.issuer});operator=await login(env,'operator');publisher=await login(env,'publisher');reader=await login(env,'reader');};
  const b=env.f.create(),content='synthetic BF-15 restored attachment';assert.equal((await api(operator,'create',b)).status,200);
  const file=await api(operator,'attach',{id:b.id,content});assert.equal(file.status,200);const ref={id:b.id,hash:file.body.result.hash};
  assert.equal((await api(publisher,'grant',{principal:'reader',scopes:[scope],operations:['read','search'],fields:['INTERNAL','CONFIDENTIAL','RESTRICTED']})).status,200);
  const schema=(await env.f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',env.cluster.config.host,'-p',String(env.cluster.config.port),'-U',env.cluster.config.user,'-d',env.cluster.config.database];
  const dump=name=>{const path=env.cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};
  const restore=async path=>{await env.f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});};
  const snapshotReader=reader,before=dump('BF15-before-classification'),base={scope,source:{kind:'object',id:b.id,projection:['title']},label:'CONFIDENTIAL'};
  assert.equal((await api(operator,'informationCreate',{...base,id:crypto.randomUUID(),purposes:['summary','disclosure']})).status,200);
  assert.equal((await api(reader,'attachment',{...ref,purpose:'disclosure'})).body.result.content,content);
  assert.equal((await api(operator,'informationCreate',{...base,id:crypto.randomUUID(),label:'STRICT',purposes:['summary']})).status,200);
  const complete=dump('BF15-complete');await reconnect();
  assert.equal((await api(reader,'attachment',{...ref,purpose:'summary'})).body.result.content,content);
  assert.equal((await api(reader,'attachment',{...ref,purpose:'disclosure'})).status,403);
  assert.equal((await api(reader,'attachment',ref)).status,403);
  const journal=JSON.stringify(env.f.kernel.journal.records());await restore(before);
  const denied=await api(snapshotReader,'attachment',{...ref,purpose:'summary'});assert.equal(denied.body.error.code,'RECOVERING');assert.equal(denied.status,400);assert.equal(JSON.stringify(env.f.kernel.journal.records()),journal);
  await restore(complete);await reconnect();
  assert.equal((await api(reader,'attachment',{...ref,purpose:'summary'})).body.result.content,content);
  assert.equal((await api(reader,'attachment',{...ref,purpose:'disclosure'})).status,403);
  assert.equal((await api(publisher,'grant',{principal:'reader',scopes:[scope],operations:['search'],fields:['INTERNAL','CONFIDENTIAL','RESTRICTED']})).status,200);
  assert.equal((await api(reader,'attachment',{...ref,purpose:'summary'})).status,403);
 }finally{await env.gateway.close();await env.close();}
});

test('ENT-103 BF-41 replay HTTP current policy preserves immutable Action digest result and idempotency across restore',async()=>{
 const env=await localEnvironment(),records=[];const {mkdir,writeFile}=await import('node:fs/promises');const output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';
 const api=async(user,operation,body,key=crypto.randomUUID())=>{const r=await user.api(operation,body,key),x={request:{operation,body,key},status:r.status,body:await r.json()};records.push(x);return x;};
 try{
  const {execFileSync}=await import('node:child_process'),{enterpriseGateway}=await import('../../src/enterprise/gateway.mjs');
  let operator=await login(env,'operator'),publisher=await login(env,'publisher');
  const reconnect=async()=>{await env.gateway.close();restart(env.f);env.gateway=await enterpriseGateway(env.f.kernel,{issuer:env.idp.issuer});operator=await login(env,'operator');publisher=await login(env,'publisher');};
  const grant=(principal,fields,scopes=[scope])=>api(publisher,'grant',{principal,scopes,operations:['read','search','action','approve'],fields});
  const classify=async(id,label,purposes)=>{const controlId=crypto.randomUUID();assert.equal((await api(publisher,'informationCreate',{id:controlId,scope,source:{kind:'object',id,projection:['title']},label,purposes})).status,200);return controlId;};
  const stable=async()=>({actions:(await env.f.owner.query('SELECT * FROM actions ORDER BY id')).rows,history:(await env.f.owner.query('SELECT * FROM history ORDER BY object_id,revision')).rows,instances:(await env.f.owner.query('SELECT * FROM enterprise_instances ORDER BY id')).rows,outbox:(await env.f.owner.query('SELECT * FROM outbox ORDER BY operation_id')).rows,journal:env.f.kernel.journal.records()});
  const replay=async(user,request,expected,code)=>{const before=await stable(),audit=(await env.f.owner.query('SELECT * FROM audit ORDER BY sequence')).rows;const r=await api(user,request.operation,request.body,request.key);if(code){assert.deepEqual(r.body,{error:{code}});assert.equal(r.status,code==='NOT_FOUND'?404:code==='PERMISSION_DENIED'?403:400);}else{assert.equal(r.status,200);assert.deepEqual(r.body,expected);}assert.deepEqual(await stable(),before);assert.deepEqual((await env.f.owner.query('SELECT * FROM audit WHERE sequence<=$1 ORDER BY sequence',[audit.at(-1).sequence])).rows,audit);assert.equal((await env.f.owner.query("SELECT * FROM audit WHERE sequence>$1 AND record->>'kind'='EnterpriseCommand'",[audit.at(-1).sequence])).rows.length,0);return r;};
  const legacy={operation:'create',body:env.f.create(),key:crypto.randomUUID()},created=await api(operator,legacy.operation,legacy.body,legacy.key);assert.equal(created.status,200);await replay(operator,legacy,created.body);
  await classify(legacy.body.id,'CONFIDENTIAL',['summary']);await classify(legacy.body.id,'STRICT',['summary']);assert.equal((await grant('operator',['INTERNAL','CONFIDENTIAL'])).status,200);
  for(const op of ['get','history'])assert.equal((await api(operator,op,{id:legacy.body.id,purpose:'summary'})).status,403);
  // The exact old request must be denied before any new command/purpose support is exercised.
  await replay(operator,legacy,null,'PERMISSION_DENIED');
  assert.equal((await grant('operator',['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'])).status,200);
  await replay(operator,legacy,null,'PERMISSION_DENIED');await replay(operator,{...legacy,body:{...legacy.body,purpose:'summary'}},null,'IDEMPOTENCY_MISMATCH');
  const requests=[];const command=async(user,operation,body)=>{const request={operation,body,key:crypto.randomUUID()},r=await api(user,operation,body,request.key);assert.equal(r.status,200,JSON.stringify(r));requests.push({user:user===operator?'operator':'manager',request,response:r.body});return r;};
  const b=env.f.create({purpose:'summary'});await command(operator,'create',b);await command(operator,'edit',{id:b.id,revision:1,fields:{...b.fields,title:'synthetic BF-41 edited'},purpose:'summary'});await command(operator,'attach',{id:b.id,content:'synthetic BF-41 attachment',purpose:'summary'});
  const manager=await login(env,'manager');await command(manager,'vote',{id:b.id,revision:3,decision:'APPROVE',purpose:'summary'});
  const cancelled=env.f.create({purpose:'summary'});await api(operator,'create',cancelled);await command(operator,'cancel',{id:cancelled.id,purpose:'summary'});
  // Existing vote/cancel transitions update the original Action result; replay must preserve that saved result too.
  for(const x of requests){const saved=(await env.f.owner.query('SELECT result FROM actions WHERE subject=$1 AND key=$2',[x.user,'v2:'+x.request.key])).rows[0];x.response={contractVersion:'2.0.0',result:saved.result};}
  const schema=(await env.f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',env.cluster.config.host,'-p',String(env.cluster.config.port),'-U',env.cluster.config.user,'-d',env.cluster.config.database];
  const dump=name=>{const path=env.cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};
  const restore=async path=>{await env.f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});};
  const snapshotOperator=operator,before=dump('BF41-before');let strictId;
  for(const id of [b.id,cancelled.id]){await classify(id,'CONFIDENTIAL',['summary','disclosure']);strictId=await classify(id,'STRICT',['summary','disclosure']);}
  for(const x of requests)await replay(x.user==='operator'?operator:manager,x.request,x.response);
  for(const principal of ['operator','manager'])assert.equal((await grant(principal,['INTERNAL','CONFIDENTIAL'])).status,200);
  for(const x of requests)await replay(x.user==='operator'?operator:manager,x.request,null,'PERMISSION_DENIED');
  for(const principal of ['operator','manager'])assert.equal((await grant(principal,['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'])).status,200);
  const valid=dump('BF41-valid');await reconnect();for(const x of requests)await replay(x.user==='operator'?operator:await login(env,'manager'),x.request,x.response);
  await replay(operator,{...requests[0].request,body:{...b,purpose:'disclosure'}},null,'IDEMPOTENCY_MISMATCH');
  const journal=JSON.stringify(env.f.kernel.journal.records());await restore(before);await replay(snapshotOperator,requests[0].request,null,'RECOVERING');assert.equal(JSON.stringify(env.f.kernel.journal.records()),journal);
  await restore(valid);await reconnect();await replay(operator,requests[0].request,requests[0].response);
  assert.equal((await grant('operator',['INTERNAL','CONFIDENTIAL'])).status,200);await replay(operator,requests[0].request,null,'PERMISSION_DENIED');await restore(valid);await reconnect();await replay(operator,requests[0].request,null,'PERMISSION_DENIED');
  assert.equal((await grant('operator',['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'])).status,200);await replay(operator,requests[0].request,requests[0].response);
  await classify(b.id,'STRICT',['disclosure']);await replay(operator,requests[0].request,null,'PERMISSION_DENIED');await reconnect();await replay(operator,requests[0].request,null,'PERMISSION_DENIED');
  const current=dump('BF41-current');assert.equal((await grant('operator',['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'],[])).status,200);await replay(operator,requests[0].request,null,'NOT_FOUND');
  await restore(current);await reconnect();await replay(operator,requests[0].request,null,'NOT_FOUND');
  await env.f.owner.query('DELETE FROM enterprise_controls WHERE id=$1',[strictId]);await replay(operator,requests[0].request,null,'RECOVERING');
  assert.equal((await env.effects.ledger()).length,0);assert.equal((await env.f.owner.query('SELECT * FROM outbox')).rows.length,0);
 }finally{await mkdir(output,{recursive:true});await writeFile(output+'/BF41-contract.json',JSON.stringify({records},null,2)+'\n');await env.gateway.close();await env.close();}
});

test('ENT-103 BF-41 browser original create request replay denies current classification revocation and purpose',async()=>{
 const env=await localEnvironment();const {browser}=await import('./browser-helper.mjs'),page=await browser();const {mkdir,writeFile}=await import('node:fs/promises');const output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';let result={};
 try{
  const publisher=await login(env,'publisher');await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]','operator');await page.click('button');await page.until('document.querySelector("#workspace")?.hidden===false');
  await page.evaluate(`window.bf41=[];const originalFetch=window.fetch;window.fetch=async(...args)=>{const r=await originalFetch(...args);if(args[0]==='/api')window.bf41.push({request:JSON.parse(args[1].body),status:r.status,body:await r.clone().json()});return r;}`);
  for(const [key,value] of Object.entries({title:'Synthetic BF-41 replay',amount:'1200',currency:'JPY',memo:'synthetic only'}))await page.fill('#field-'+key,value);await page.click('#create button');await page.until('document.querySelector("#record").dataset.state==="WAITING_APPROVAL"');
  const original=await page.evaluate('window.bf41.find(x=>x.request.operation==="create")'),id=original.request.body.id;
  const stable=async()=>({actions:(await env.f.owner.query('SELECT * FROM actions ORDER BY id')).rows,history:(await env.f.owner.query('SELECT * FROM history ORDER BY object_id,revision')).rows,instances:(await env.f.owner.query('SELECT * FROM enterprise_instances ORDER BY id')).rows,journal:env.f.kernel.journal.records()});
  const replay=async()=>{const before=await stable();const r=await page.evaluate(`(async()=>{const s=await (await fetch('/session')).json();const r=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrf},body:JSON.stringify(${JSON.stringify(original.request)})});const b=await r.json();document.querySelector('#message').textContent=JSON.stringify(b);return {status:r.status,body:b};})()`);assert.deepEqual(await stable(),before);return r;};
  assert.deepEqual((await replay()).body,original.body);
  const grant=fields=>publisher.api('grant',{principal:'operator',scopes:[scope],operations:['read','search','action'],fields});
  const classify=async(label,purposes)=>assert.equal((await publisher.api('informationCreate',{id:crypto.randomUUID(),scope,source:{kind:'object',id,projection:['title']},label,purposes})).status,200);
  await classify('CONFIDENTIAL',['summary','disclosure']);await classify('STRICT',['summary','disclosure']);assert.equal((await grant(['INTERNAL','CONFIDENTIAL'])).status,200);
  const denied=await replay();await page.screenshot('BF41-classification');assert.equal(denied.status,403);assert.deepEqual(denied.body,{error:{code:'PERMISSION_DENIED'}});
  assert.equal(original.request.body.purpose,'summary');assert.equal((await grant(['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'])).status,200);assert.deepEqual((await replay()).body,original.body);await page.screenshot('BF41-authorized');
  assert.equal((await grant(['INTERNAL','CONFIDENTIAL'])).status,200);assert.equal((await replay()).status,403);await page.screenshot('BF41-revoked');
  assert.equal((await grant(['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'])).status,200);await classify('STRICT',['disclosure']);assert.equal((await replay()).status,403);await page.screenshot('BF41-purpose');assert.equal((await env.effects.ledger()).length,0);result.browser=await page.send('Browser.getVersion');result.externalEffects=0;
 }finally{result.records=await page.evaluate('window.bf41??[]');await mkdir(output,{recursive:true});await writeFile(output+'/BF41-browser.json',JSON.stringify(result,null,2)+'\n');await page.close();await env.close();}
});

test('BF-42-new-edit-attach-vote-cancel-current-purpose-after-fix ENT-103 BF-42 fresh commands HTTP enforce current purpose before mutation with recovery and replay consistency',async()=>{
 const env=await localEnvironment(),records=[],checks=[];const {mkdir,writeFile}=await import('node:fs/promises');const output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';
 const api=async(user,operation,body,key=crypto.randomUUID())=>{const r=await user.api(operation,body,key),x={request:{operation,body,key},status:r.status,body:await r.json()};records.push(x);return x;};
 try{
  const {execFileSync}=await import('node:child_process'),{enterpriseGateway}=await import('../../src/enterprise/gateway.mjs');
  let operator=await login(env,'operator'),publisher=await login(env,'publisher'),manager=await login(env,'manager');
  const reconnect=async()=>{await env.gateway.close();restart(env.f);env.gateway=await enterpriseGateway(env.f.kernel,{issuer:env.idp.issuer});operator=await login(env,'operator');publisher=await login(env,'publisher');manager=await login(env,'manager');};
  const classify=async(id,purposes)=>{const controlId=crypto.randomUUID();const r=await api(publisher,'informationCreate',{id:controlId,scope,source:{kind:'object',id,projection:['title']},label:'STRICT',purposes});assert.equal(r.status,200,JSON.stringify(r));return controlId;};
  const stable=async()=>{const x={};for(const [table,order] of [['objects','id'],['actions','id'],['history','object_id,revision'],['enterprise_instances','id'],['enterprise_attachments','object_id,hash'],['outbox','operation_id']])x[table]=(await env.f.owner.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;return x;};
  const deny=async(user,operation,body,code='PERMISSION_DENIED',key=crypto.randomUUID())=>{
   const before=await stable(),journal=env.f.kernel.journal.records(),audit=(await env.f.owner.query('SELECT * FROM audit ORDER BY sequence')).rows,r=await api(user,operation,body,key),after=await stable();
   checks.push({operation,key,code,status:r.status,unchanged:JSON.stringify(before)===JSON.stringify(after),before,after});
   assert.deepEqual(r.body,{error:{code}});assert.equal(r.status,code==='NOT_FOUND'?404:code==='PERMISSION_DENIED'?403:400);assert.deepEqual(after,before);
   const afterJournal=env.f.kernel.journal.records();assert.deepEqual(afterJournal.slice(0,journal.length),journal);const added=afterJournal.slice(journal.length);assert.ok(added.every(x=>x.operationKind==='submission'&&['INTENT','ABORTED'].includes(x.phase)));if(added.length)assert.equal(added.at(-1).phase,'ABORTED');
   assert.deepEqual((await env.f.owner.query('SELECT * FROM audit WHERE sequence<=$1 ORDER BY sequence',[audit.at(-1).sequence])).rows,audit);assert.equal((await env.f.owner.query("SELECT * FROM audit WHERE sequence>$1 AND record->>'kind'='EnterpriseCommand'",[audit.at(-1).sequence])).rows.length,0);
  };
  const cases=[];for(const operation of ['edit','attach','vote','cancel']){const b=env.f.create({purpose:'summary'});assert.equal((await api(operator,'create',b)).status,200);cases.push({operation,b,body:operation==='edit'?{id:b.id,revision:1,fields:{...b.fields,title:'synthetic BF-42 edit'}}:operation==='attach'?{id:b.id,content:'synthetic BF-42 attachment'}:operation==='vote'?{id:b.id,revision:1,decision:'APPROVE'}:{id:b.id}});}
  const schema=(await env.f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',env.cluster.config.host,'-p',String(env.cluster.config.port),'-U',env.cluster.config.user,'-d',env.cluster.config.database];
  const dump=name=>{const path=env.cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};
  const restore=async path=>{await env.f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});};
  const snapshotOperator=operator,beforeClassification=dump('BF42-before');
  for(const x of cases){await classify(x.b.id,['summary','disclosure']);await classify(x.b.id,['disclosure']);}
  for(const operation of ['get','history'])assert.equal((await api(operator,operation,{id:cases[0].b.id,purpose:'summary'})).status,403);
  // This first fresh edit reproduces BF-42 before the implementation change.
  for(const x of cases){const user=x.operation==='vote'?manager:operator;await deny(user,x.operation,{...x.body,purpose:'summary'});await deny(user,x.operation,x.body);}
  const accepted=[];for(const x of cases){const user=x.operation==='vote'?manager:operator,key=crypto.randomUUID(),body={...x.body,purpose:'disclosure'},r=await api(user,x.operation,body,key);assert.equal(r.status,200,JSON.stringify(r));accepted.push({x,key,body,response:r.body});const saved=await stable(),journal=env.f.kernel.journal.records();assert.deepEqual((await api(user,x.operation,body,key)).body,r.body);assert.deepEqual(await stable(),saved);assert.deepEqual(env.f.kernel.journal.records(),journal);await deny(user,x.operation,{...body,purpose:'summary'},'IDEMPOTENCY_MISMATCH',key);}
  assert.equal(accepted[0].response.result.revision,2);assert.equal(accepted[3].response.result.state,'CANCELLED');
  const valid=dump('BF42-valid');await reconnect();for(const a of accepted)assert.deepEqual((await api(a.x.operation==='vote'?manager:operator,a.x.operation,a.body,a.key)).body,a.response);
  await restore(beforeClassification);await deny(snapshotOperator,'edit',{...cases[0].body,purpose:'disclosure'},'RECOVERING');await restore(valid);await reconnect();
  // Keep fresh, otherwise valid targets for all four operations after clearance loss.
  const fresh=[];for(const x of cases){const b=env.f.create({purpose:'disclosure'});assert.equal((await api(operator,'create',b)).status,200);await classify(b.id,['disclosure']);fresh.push({...x,body:{...x.body,id:b.id}});}
  const granted=dump('BF42-granted');
  for(const principal of ['operator','manager'])assert.equal((await api(publisher,'grant',{principal,scopes:[scope],operations:['read','search','action','approve'],fields:['INTERNAL','CONFIDENTIAL','RESTRICTED'].filter(x=>x!=='RESTRICTED')})).status,200);
  for(const x of fresh)await deny(x.operation==='vote'?manager:operator,x.operation,{...x.body,purpose:'disclosure'});
  await reconnect();await deny(operator,'edit',{...fresh[0].body,purpose:'disclosure'});await restore(granted);await reconnect();for(const x of fresh)await deny(x.operation==='vote'?manager:operator,x.operation,{...x.body,purpose:'disclosure'});
  assert.equal((await api(publisher,'grant',{principal:'operator',scopes:[scope],operations:['read','search','action'],fields:['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED']})).status,200);
  const allowed=await api(operator,'edit',{...fresh[0].body,purpose:'disclosure'});assert.equal(allowed.status,200);await deny(operator,'edit',{...fresh[0].body,revision:2,purpose:'summary'});await reconnect();await deny(operator,'edit',{...fresh[0].body,revision:2,purpose:'summary'});
  const control=(await env.f.owner.query("SELECT id FROM enterprise_controls WHERE kind='information' ORDER BY id LIMIT 1")).rows[0];await env.f.owner.query('DELETE FROM enterprise_controls WHERE id=$1',[control.id]);await deny(operator,'edit',{...fresh[0].body,revision:2,purpose:'disclosure'},'RECOVERING');
  assert.equal((await env.effects.ledger()).length,0);assert.equal((await env.f.owner.query('SELECT * FROM outbox')).rows.length,0);
 }finally{await mkdir(output,{recursive:true});await writeFile(output+'/BF42-contract.json',JSON.stringify({records,checks},null,2)+'\n');await env.gateway.close();await env.close();}
});

test('BF-42-original-purpose-replay-and-authorized-edit-retained ENT-103 BF-42 browser explicit fresh edit API denies forbidden purpose and permits disclosed edit',async()=>{
 const env=await localEnvironment();const {browser}=await import('./browser-helper.mjs'),page=await browser();const {mkdir,writeFile}=await import('node:fs/promises');const output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';let result={};
 try{
  const publisher=await login(env,'publisher');await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]','operator');await page.click('button');await page.until('document.querySelector("#workspace")?.hidden===false');
  await page.evaluate(`window.bf42=[];const originalFetch=window.fetch;window.fetch=async(...args)=>{const r=await originalFetch(...args);if(args[0]==='/api')window.bf42.push({request:JSON.parse(args[1].body),status:r.status,body:await r.clone().json()});return r;}`);
  for(const [key,value] of Object.entries({title:'Synthetic BF-42 edit',amount:'1200',currency:'JPY',memo:'synthetic only'}))await page.fill('#field-'+key,value);await page.click('#create button');await page.until('document.querySelector("#record").dataset.state==="WAITING_APPROVAL"');
  const original=await page.evaluate('window.bf42.find(x=>x.request.operation==="create")'),b=original.request.body;
  for(const purposes of [['summary','disclosure'],['disclosure']])assert.equal((await publisher.api('informationCreate',{id:crypto.randomUUID(),scope,source:{kind:'object',id:b.id,projection:['title']},label:'STRICT',purposes})).status,200);
  const request=async(body,key=crypto.randomUUID())=>page.evaluate(`(async()=>{const s=await (await fetch('/session')).json();const r=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrf},body:JSON.stringify(${JSON.stringify({contractVersion:'2.0.0',operation:'edit',body,key})})});const b=await r.json();document.querySelector('#message').textContent=JSON.stringify(b);return {status:r.status,body:b};})()`);
  const persisted=async()=>({object:(await env.f.owner.query('SELECT * FROM objects WHERE id=$1',[b.id])).rows,instance:(await env.f.owner.query('SELECT * FROM enterprise_instances WHERE id=$1',[b.id])).rows,history:(await env.f.owner.query('SELECT * FROM history WHERE object_id=$1 ORDER BY revision',[b.id])).rows});
  const body={id:b.id,revision:1,fields:{...b.fields,title:'synthetic BF-42 allowed edit'},purpose:'summary'},before=await persisted(),denied=await request(body);result.before=before;result.afterDenied=await persisted();await page.screenshot('BF42-purpose');assert.equal(denied.status,403);assert.deepEqual(denied.body,{error:{code:'PERMISSION_DENIED'}});assert.deepEqual(result.afterDenied,before);
  const key=crypto.randomUUID(),allowedBody={...body,purpose:'disclosure'},allowed=await request(allowedBody,key);assert.equal(allowed.status,200);assert.equal(allowed.body.result.revision,2);await page.screenshot('BF42-authorized');const saved=await persisted();assert.deepEqual(await request(allowedBody,key),allowed);assert.deepEqual(await persisted(),saved);
  const revoke=await publisher.api('grant',{principal:'operator',scopes:[scope],operations:['read','search','action'],fields:['INTERNAL','CONFIDENTIAL']});assert.equal(revoke.status,200);assert.equal((await request({...allowedBody,revision:2})).status,403);assert.equal((await request(allowedBody,key)).status,403);assert.deepEqual(await persisted(),saved);await page.screenshot('BF42-revoked');
  result.browser=await page.send('Browser.getVersion');result.externalEffects=(await env.effects.ledger()).length;assert.equal(result.externalEffects,0);
 }finally{result.records=await page.evaluate('window.bf42??[]');await mkdir(output,{recursive:true});await writeFile(output+'/BF42-browser.json',JSON.stringify(result,null,2)+'\n');await page.close();await env.close();}
});

// Reconstruct only the missing BF-42 guard in a disposable checkout. The same
// real PostgreSQL/HTTP/browser assertions must fail there; never mutate the
// running product or accept an unrelated child-process failure as the oracle.
test('BF-42-new-edit-current-purpose-denied-before-fix isolated negative control',async()=>{
 const {cpSync,mkdtempSync,readFileSync,writeFileSync,mkdirSync,symlinkSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os'),{resolve,join}=await import('node:path'),{spawnSync}=await import('node:child_process'),{createHash}=await import('node:crypto');
 const root=resolve(import.meta.dirname,'../..'),isolated=mkdtempSync(join(tmpdir(),'enterprise-bf42-before-'));
 const output=resolve(process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser','BF42-before-fix');mkdirSync(output,{recursive:true});
 const sha=x=>createHash('sha256').update(x).digest('hex'),source=readFileSync(join(root,'src/enterprise/service.mjs'),'utf8');
 const guard="  if(['attach','edit','vote','cancel'].includes(op))await sourcePolicy(r,c,'object',o.id,b.purpose);\n";
 assert.equal(source.split(guard).length,2,'exactly one current fresh-command guard');
 const before=source.replace(guard,'');
 try{
  for(const dir of ['src','scripts','tests','config','migrations'])cpSync(join(root,dir),join(isolated,dir),{recursive:true});
  cpSync(join(root,'package.json'),join(isolated,'package.json'));symlinkSync(join(root,'node_modules'),join(isolated,'node_modules'),'dir');
  writeFileSync(join(isolated,'src/enterprise/service.mjs'),before);
  writeFileSync(join(output,'service-before.mjs'),before);writeFileSync(join(output,'service-current.mjs'),source);
  const argv=['--test','--test-reporter=tap','--test-name-pattern=^(BF-42-new-edit-attach-vote-cancel-current-purpose-after-fix|BF-42-original-purpose-replay-and-authorized-edit-retained) ','tests/enterprise/ENT-103.test.mjs'];
  const env={...process.env,ENTERPRISE_SUITE_OUTPUT:output};delete env.NODE_TEST_CONTEXT;
  const startedAt=new Date().toISOString(),r=spawnSync(process.execPath,argv,{cwd:isolated,env,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});
  writeFileSync(join(output,'stdout.tap'),r.stdout??'');writeFileSync(join(output,'stderr.log'),r.stderr??'');
  writeFileSync(join(output,'execution.json'),JSON.stringify({argv,startedAt,finishedAt:new Date().toISOString(),exitCode:r.status,signal:r.signal,error:r.error?.code??null,sourceSha256:sha(source),beforeSourceSha256:sha(before),testSha256:sha(readFileSync(import.meta.filename)),stdoutSha256:sha(r.stdout??''),stderrSha256:sha(r.stderr??''),mutation:guard.trim(),syntheticOnly:true},null,2)+'\n');
  assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,1,r.stderr);assert.match(r.stdout,/^# tests 2$/m);assert.match(r.stdout,/^# fail 2$/m);assert.match(r.stdout,/^# pass 0$/m);
  for(const name of ['BF-42-new-edit-attach-vote-cancel-current-purpose-after-fix','BF-42-original-purpose-replay-and-authorized-edit-retained'])assert.match(r.stdout,new RegExp('^not ok \\d+ - '+name,'m'));
  const contract=JSON.parse(readFileSync(join(output,'BF42-contract.json'))),browser=JSON.parse(readFileSync(join(output,'BF42-browser.json')));
  const x=contract.records.find(r=>r.request.operation==='edit');assert.equal(x.request.body.purpose,'summary');assert.equal(x.status,200);assert.equal(x.body.result.revision,2);assert.equal(contract.checks[0].unchanged,false);
  assert.deepEqual(contract.records.filter(r=>['get','history'].includes(r.request.operation)).map(r=>r.status),[403,403]);
  const y=browser.records.find(r=>r.request.operation==='edit');assert.equal(y.request.body.purpose,'summary');assert.equal(y.status,200);assert.equal(y.body.result.revision,2);
  assert.equal(browser.before.object[0].revision,1);assert.equal(browser.afterDenied.object[0].revision,2);assert.notEqual(browser.before.instance[0].binding,browser.afterDenied.instance[0].binding);
 }finally{rmSync(isolated,{recursive:true,force:true});assert.equal(readFileSync(join(root,'src/enterprise/service.mjs'),'utf8'),source);}
});

// BF-52 exercises the legacy attachment command over the public HTTP boundary.
// Snapshot business rows separately from denial audits and authority changes.
async function bf52Environment(){
 const env=await localEnvironment(),records=[],checks=[],users={};
 const api=async(who,operation,body={},key=crypto.randomUUID())=>{const user=users[who]??=await login(env,who),r=await user.api(operation,body,key),x={actor:who,request:{operation,body,key},status:r.status,body:await r.json()};records.push(x);return x;};
 const stable=async()=>{const x={};for(const [table,order]of [['objects','id'],['enterprise_instances','id'],['history','object_id,revision'],['actions','id'],['enterprise_attachments','object_id,hash'],['outbox','operation_id']])x[table]=(await env.f.owner.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;return {...x,journal:env.f.kernel.journal.records(),requests:await env.effects.requests(),ledger:await env.effects.ledger()};};
 const unchanged=async(label,fn)=>{const before=await stable(),r=await fn(),after=await stable();checks.push({label,before,after});assert.deepEqual(after,before,label);return r;};
 const all=['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'];
 const grant=async(fields=all,scopes=[scope],operations=['read','search','action'])=>{const r=await api('publisher','grant',{principal:'operator',scopes,operations,fields});assert.equal(r.status,200,JSON.stringify(r));};
 const reconnect=async()=>{const {enterpriseGateway}=await import('../../src/enterprise/gateway.mjs');await env.gateway.close();restart(env.f);env.gateway=await enterpriseGateway(env.f.kernel,{issuer:env.idp.issuer});for(const key of Object.keys(users))delete users[key];};
 return {env,users,records,checks,api,stable,unchanged,all,grant,reconnect,async close(){await env.gateway.close();await env.close();}};
}

test('ENT-103 BF-52 attachment replay HTTP current RESTRICTED scope purpose revoke restart restore and immutable result',async()=>{
 const f=await bf52Environment(),{env,api,unchanged,all,grant,reconnect}=f;const {mkdir,writeFile}=await import('node:fs/promises'),output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';
 try{
  const b=env.f.create(),body={id:b.id,content:'synthetic BF-52 attachment'},key=crypto.randomUUID();assert.equal((await api('operator','create',b)).status,200);
  const first=await api('operator','attach',body,key);assert.equal(first.status,200);assert.equal(first.body.result.id,b.id);const ref={id:b.id,hash:first.body.result.hash};
  const replay=async(code=null)=>{const r=await unchanged('attach replay '+(code??'allowed'),()=>api('operator','attach',body,key));assert.equal(r.status,code==='NOT_FOUND'?404:code==='PERMISSION_DENIED'?403:code?400:200,JSON.stringify(r));assert.deepEqual(r.body,code?{error:{code}}:first.body);return r;};
  await replay();assert.equal((await api('operator','attachment',ref)).body.result.content,body.content);
  const {execFileSync}=await import('node:child_process'),schema=(await env.f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',env.cluster.config.host,'-p',String(env.cluster.config.port),'-U',env.cluster.config.user,'-d',env.cluster.config.database];
  const dump=name=>{const path=env.cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};
  const restore=async path=>{await env.f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});};
  const granted=dump('BF52-granted');await grant(all.filter(x=>x!=='RESTRICTED'));
  assert.equal((await api('operator','attachment',ref)).status,403);assert.equal((await api('operator','attach',body)).status,403);
  // Before the fix, this returns the saved id/hash despite both controls denying.
  await replay('PERMISSION_DENIED');await reconnect();await replay('PERMISSION_DENIED');await restore(granted);await reconnect();await replay('PERMISSION_DENIED');
  await grant();await replay();assert.equal((await api('operator','attachment',ref)).body.result.content,body.content);
  // Use a newly submitted case after grant changes so original approval authority is current.
  const voted=env.f.create(),votedKey=crypto.randomUUID(),votedBody={id:voted.id,content:'synthetic BF-52 approved replay'};assert.equal((await api('operator','create',voted)).status,200);
  const votedFirst=await api('operator','attach',votedBody,votedKey);assert.equal(votedFirst.status,200);
  assert.equal((await api('manager','vote',{id:voted.id,revision:2,decision:'APPROVE'})).status,200);
  const votedReplay=()=>unchanged('replay after vote or cancellation',()=>api('operator','attach',votedBody,votedKey));assert.deepEqual((await votedReplay()).body,votedFirst.body);
  assert.equal((await api('operator','cancel',{id:voted.id})).status,200);assert.deepEqual((await votedReplay()).body,votedFirst.body);assert.equal((await api('operator','get',{id:voted.id})).body.result.workflow.state,'CANCELLED');
  const saved=(await env.f.owner.query('SELECT * FROM actions WHERE subject=$1 AND key=$2',['operator','v2:'+key])).rows[0];assert.deepEqual(saved.result,first.body.result);
  await grant(all,[]);await replay('NOT_FOUND');await grant();await replay();
  await grant(all,[scope],['read','search']);await replay('PERMISSION_DENIED');await grant();
  for(const who of ['other','tenant2','manager']){const r=await api(who,'attach',body,key);assert.equal(r.status,who==='manager'?403:404);assert.ok(!r.body.result);}
  const changed=await unchanged('same key changed content',()=>api('operator','attach',{...body,content:'different synthetic content'},key));assert.equal(changed.body.error.code,'IDEMPOTENCY_MISMATCH');
  const b2=env.f.create();assert.equal((await api('operator','create',b2)).status,200);const body2={id:b2.id,content:'synthetic BF-52 purpose-bound attachment',purpose:'summary'},key2=crypto.randomUUID(),first2=await api('operator','attach',body2,key2);assert.equal(first2.status,200);
  const snapshotOperator=f.users.operator,preclassification=dump('BF52-preclassification');
  const classify=async(id,purposes)=>{const controlId=crypto.randomUUID();assert.equal((await api('publisher','informationCreate',{id:controlId,scope,source:{kind:'object',id,projection:['title']},label:'STRICT',purposes})).status,200);return controlId;};
  await classify(b.id,['summary']);await classify(b2.id,['summary','disclosure']);await replay('PERMISSION_DENIED');
  const replay2=async(code=null)=>{const r=await unchanged('purpose-bound replay '+(code??'allowed'),()=>api('operator','attach',body2,key2));assert.equal(r.status,code==='RECOVERING'?400:code?403:200);assert.deepEqual(r.body,code?{error:{code}}:first2.body);};
  await replay2();await grant(all.filter(x=>x!=='RESTRICTED'));assert.equal((await api('operator','get',{id:b2.id,purpose:'summary'})).status,200);await replay2('PERMISSION_DENIED');await grant();await replay2();
  const controlId=await classify(b2.id,['disclosure']);await replay2('PERMISSION_DENIED');
  const mismatch=await unchanged('same key changed purpose',()=>api('operator','attach',{...body2,purpose:'disclosure'},key2));assert.equal(mismatch.body.error.code,'IDEMPOTENCY_MISMATCH');
  const current=dump('BF52-current');await reconnect();await replay2('PERMISSION_DENIED');await restore(preclassification);f.users.operator=snapshotOperator;await replay('RECOVERING');await restore(current);await reconnect();await replay2('PERMISSION_DENIED');
  await env.f.owner.query('DELETE FROM enterprise_controls WHERE id=$1',[controlId]);await replay2('RECOVERING');await restore(current);
  assert.equal((await env.f.owner.query('SELECT * FROM enterprise_attachments')).rows.length,3);assert.equal((await env.effects.ledger()).length,0);assert.equal((await env.effects.requests()).length,0);
 }finally{await mkdir(output,{recursive:true});await writeFile(output+'/BF52-contract.json',JSON.stringify({records:f.records,checks:f.checks},null,2)+'\n');await f.close();}
});

test('ENT-103 BF-52 browser fresh attachment replay denies revoked RESTRICTED and permits restored authority',async()=>{
 const f=await bf52Environment(),{env,api,grant,all,unchanged}=f;const {browser}=await import('./browser-helper.mjs'),page=await browser(),{mkdir,writeFile}=await import('node:fs/promises'),output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';let result={};
 try{
  const b=env.f.create(),body={id:b.id,content:'synthetic BF-52 browser attachment'},key=crypto.randomUUID();assert.equal((await api('operator','create',b)).status,200);const first=await api('operator','attach',body,key);assert.equal(first.status,200);
  await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]','operator');await page.click('button');await page.until('document.querySelector("#workspace")?.hidden===false');
  await page.evaluate('window.bf52=[];const display=document.createElement("pre");display.id="bf52";document.body.prepend(display)');
  const replay=()=>unchanged('browser replay',()=>page.evaluate(`(async()=>{const s=await(await fetch('/session')).json();const request=${JSON.stringify({contractVersion:'2.0.0',operation:'attach',body,key})};const r=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrf},body:JSON.stringify(request)});const x={request,status:r.status,body:await r.json()};window.bf52.push(x);document.querySelector('#bf52').textContent=JSON.stringify(window.bf52,null,2);return x;})()`));
  assert.deepEqual((await replay()).body,first.body);await page.screenshot('BF52-authorized-replay');
  await grant(all.filter(x=>x!=='RESTRICTED'));assert.equal((await api('operator','attachment',{id:b.id,hash:first.body.result.hash})).status,403);assert.equal((await api('operator','attach',body)).status,403);
  const denied=await replay();await page.screenshot('BF52-restricted-revoked');assert.equal(denied.status,403);assert.deepEqual(denied.body,{error:{code:'PERMISSION_DENIED'}});
  await grant();assert.deepEqual((await replay()).body,first.body);await page.screenshot('BF52-authority-restored');await grant(all,[]);assert.equal((await replay()).status,404);await page.screenshot('BF52-scope-revoked');
  result.browser=await page.send('Browser.getVersion');assert.equal((await env.effects.ledger()).length,0);
 }finally{result.records=await page.evaluate('window.bf52??[]');result.http=f.records;result.checks=f.checks;await mkdir(output,{recursive:true});await writeFile(output+'/BF52-browser.json',JSON.stringify(result,null,2)+'\n');await page.close();await f.close();}
});
// BF-53 uses public creation/classification, not fabricated query rows. Database
// snapshots below are fault controls; read audits are deliberately excluded.
test('ENT-103 BF-53 authorized query limit HTTP and actual reload UI ignore hidden rows and retain resource boundary',async()=>{
 const f=await bf52Environment(),{env,api,reconnect}=f,{digest}=await import('../../src/contracts.mjs'),{mkdir,writeFile}=await import('node:fs/promises');
 const output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser',checks=[],observations=[],failures=[],hr={...scope,departmentId:'synthetic-hr'};let page;
 const stable=async()=>{const tables={};for(const [t,order]of [['objects','id'],['enterprise_instances','id'],['actions','id'],['history','object_id,revision'],['outbox','operation_id']]){const rows=(await env.f.owner.query(`SELECT * FROM ${t} ORDER BY ${order}`)).rows;tables[t]={count:rows.length,digest:digest(rows)};}return {...tables,journal:digest(env.f.kernel.journal.records()),requests:await env.effects.requests(),ledger:await env.effects.ledger()};};
 const base={packageId:'enterprise-foundation',type:'Case',projection:['title'],purpose:'summary'};
 const variants=[{}, {aggregate:true}, {search:{field:'title',text:'no-such-BF53-title'}}, {export:true}];
 const matrix=async(label,ids,code=null)=>{const before=await stable(),responses=[];for(const extra of variants)responses.push(await api('reader','query',{...base,...extra}));const after=await stable();checks.push({label,before,after});observations.push({label,responses});assert.deepEqual(after,before);for(let n=0;n<responses.length;n++){const x=responses[n];assert.equal(x.status,code?400:200,JSON.stringify({label,n,x}));if(code)assert.deepEqual(x.body,{error:{code}});else if(n===1)assert.equal(x.body.result.count,ids.length);else assert.deepEqual(x.body.result.items.map(o=>o.id).sort(),n===2?[]:[...ids].sort());}return responses;};
 const grant=async(scopes=[scope],fields=['INTERNAL'])=>assert.equal((await api(scopes.some(s=>s.departmentId===hr.departmentId)?'other':'publisher','grant',{principal:'reader',scopes,fields,operations:['read','search']})).status,200);
 try{
  // Keep public fixture creation cheap without changing any product deadline.
  const p=structuredClone(env.f.manifest);p.version='53.0.0';p.calendar={timezone:'UTC',weekdays:[1,2,3,4,5,6,7],holidays:[],businessDays:1};
  for(const [who,op,b]of [['manager','install',{manifest:p}],['reviewer','review',{id:p.id,version:p.version}],['publisher','publish',{id:p.id,version:p.version}]])assert.equal((await api(who,op,b)).status,200);
  env.f.kernel.clock=()=>Date.parse('2026-10-23T23:59:00Z');
  const hidden=[];const add=async(who,s,id)=>{const b=env.f.create({scope:s,id});assert.equal((await api(who,'create',b)).status,200);return b.id;};
  for(let n=0;n<1000;n++)hidden.push(await add('other',hr,'a-bf53-'+String(n).padStart(4,'0')));
  assert.equal((await api('reader','get',{id:hidden[0]})).status,404);await matrix('1000 other-department rows',[]);
  hidden.push(await add('other',hr,'a-bf53-1000'));
  // Save all four public responses before asserting, including the old failure.
  await matrix('1001 other-department rows',[]).catch(e=>failures.push(e));
  const visible=await add('operator',scope,'z-bf53-visible');await matrix('visible sorts after 1001 hidden rows',[visible]).catch(e=>failures.push(e));
  const {browser}=await import('./browser-helper.mjs');page=await browser();await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]','reader');await page.click('button');await page.until('document.querySelector("#workspace")?.hidden===false');
  await page.evaluate(`window.bf53=[];const originalFetch=window.fetch;window.fetch=async(...args)=>{const r=await originalFetch(...args);if(args[0]==='/api')window.bf53.push({request:JSON.parse(args[1].body),status:r.status,body:await r.clone().json()});return r;}`);
  const reload=async(ids,name)=>{const before=await stable(),n=await page.evaluate('window.bf53.length');await page.click('#reload');await page.until(`window.bf53.length>${n}`);const r=await page.evaluate('window.bf53.at(-1)');await page.screenshot(name);assert.equal(r.status,200);assert.deepEqual(r.body.result.items.map(x=>x.id).sort(),[...ids].sort());await page.until('document.querySelectorAll("#cases button").length==='+ids.length);assert.deepEqual(await stable(),before);};
  await reload([visible],'BF53-visible-after-hidden').catch(e=>failures.push(e));assert.equal(failures.length,0,failures.map(e=>e.message).join('\n'));
  for(const extra of variants.slice(1)){const x=await page.evaluate(`(async()=>{const s=await(await fetch('/session')).json();const r=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrf},body:JSON.stringify(${JSON.stringify({contractVersion:'2.0.0',operation:'query',body:{...base,...extra}})})});return {status:r.status,body:await r.json()};})()`);assert.equal(x.status,200);}
  await grant([]);await reload([],'BF53-scope-revoked');await grant();await reload([visible],'BF53-scope-restored');
  await reconnect();env.f.kernel.clock=()=>Date.parse('2026-10-23T23:59:00Z');await matrix('restart still one visible',[visible]);
  // Legitimately published other-package and other-type cases must not consume
  // this package's candidate allowance, even when their scope is visible.
  for(const typed of [false,true]){const alternate=structuredClone(p);alternate.id=typed?'bf53-other-type':'bf53-other-package';if(typed){alternate.types.OtherCase=alternate.types.Case;alternate.action.type='OtherCase';}for(const [who,op,b]of [['manager','install',{manifest:alternate}],['reviewer','review',{id:alternate.id,version:alternate.version}],['publisher','publish',{id:alternate.id,version:alternate.version}]])assert.equal((await api(who,op,b)).status,200);assert.equal((await api('other','create',env.f.create({packageId:alternate.id,scope:hr,id:'b-bf53-'+alternate.id}))).status,200);}
  // Whole-scope visibility, not a truncated prefix: 1000 is allowed, 1001 denied.
  await grant([hr]);await matrix('1001 authorized rows resource limit',[], 'RATE_LIMITED');
  await env.f.owner.query('UPDATE objects SET deleted=true WHERE id=$1',[hidden[1000]]);
  await matrix('1000 authorized rows and one deleted',hidden.slice(0,1000));
  await env.f.owner.query('UPDATE objects SET deleted=false WHERE id=$1',[hidden[1000]]);
  // Public policy transition plus an explicitly separate classification scale fixture.
  const {execFileSync}=await import('node:child_process'),schema=(await env.f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',env.cluster.config.host,'-p',String(env.cluster.config.port),'-U',env.cluster.config.user,'-d',env.cluster.config.database];
  const dump=name=>{const path=env.cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};
  const restore=async path=>{await env.f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});};
  const savedReader=f.users.reader,beforeClassification=dump('BF53-before-classification');
  const policyId=crypto.randomUUID();assert.equal((await api('other','informationCreate',{id:policyId,scope:hr,source:{kind:'object',id:hidden[0],projection:['title']},label:'STRICT',purposes:['summary','disclosure']})).status,200);
  // Explicit scale fixture, not 1000 claimed public classification operations.
  // Only the first policy exercises command/journal provenance and restoration;
  // the remaining restrictive rows exercise SQL eligibility at the 1001 boundary.
  const seed=await env.f.owner.query(`INSERT INTO enterprise_controls(tenant,id,kind,scope,revision,data,action_id)
   SELECT tenant,'bf53-scale-policy-'||n,kind,scope,revision,
    jsonb_set(data,'{sources}',jsonb_build_array(jsonb_build_object('kind','object','id',v,'projection',jsonb_build_array('title')))),action_id
   FROM enterprise_controls CROSS JOIN unnest($2::text[]) WITH ORDINALITY AS seeded(v,n)
   WHERE id=$1 RETURNING id`,[policyId,hidden.slice(1)]);assert.equal(seed.rowCount,1000);observations.push({label:'explicit DB classification scale fixture',publicPolicy:policyId,seededPolicyCount:seed.rowCount});
  assert.equal((await api('reader','get',{id:hidden[0],purpose:'summary'})).status,403);
  await matrix('1001 same-scope STRICT hidden rows',[]);
  const hrVisible=await add('other',hr,'z-bf53-hr-visible');await matrix('one visible plus 1001 policy-hidden rows',[hrVisible]);
  await grant([hr],['INTERNAL','STRICT']);await matrix('authorized classified resource limit',[],'RATE_LIMITED');
  await grant([hr]);await matrix('revocation immediately excludes all classified rows',[hrVisible]);
  const current=dump('BF53-current');await reconnect();await matrix('restart retains current classification',[hrVisible]);
  await restore(beforeClassification);f.users.reader=savedReader;await matrix('restored database missing policies',[],'RECOVERING');await restore(current);await reconnect();await matrix('restored complete classification',[hrVisible]);
  for(const extra of [{projection:['memo']},{search:{field:'memo',text:'synthetic'}}])assert.equal((await api('reader','query',{...base,...extra})).status,403);
  assert.equal((await env.effects.requests()).length,0);assert.equal((await env.effects.ledger()).length,0);
 }finally{const browser=page?{version:await page.send('Browser.getVersion'),records:await page.evaluate('window.bf53??[]')}:null;await mkdir(output,{recursive:true});await writeFile(output+'/BF53-contract.json',JSON.stringify({records:f.records,observations,checks,browser,limitations:['1000 restrictive policy rows are DB scale fixtures, not public classification provenance','Deleted-row control is direct fixture DB update','Restore is schema-only; journal remains outside restore','Timing side channels not measured']},null,2)+'\n');await page?.close();await f.close();}
});
