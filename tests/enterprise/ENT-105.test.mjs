import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {withFixture,ready,restart} from './helpers.mjs';
import {referenceEffects} from '../../scripts/enterprise/reference/effects.mjs';
import {SyntheticPort} from '../../src/enterprise/worker.mjs';
import {deadline} from '../../src/enterprise/contracts.mjs';
const child=(f,server,id,mode,crash)=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,['tests/enterprise/worker-child.mjs'],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',c=>stdout+=c);p.stderr.on('data',c=>stderr+=c);p.on('error',reject);p.on('close',code=>resolve({code,stdout,stderr}));const {host,port,user,database,options}=f.state.pool.options;p.stdin.end(JSON.stringify({config:{host,port,user,database,options},journal:f.journal.path,credential:f.credentials.manager,id,mode,url:server.url,crash}));});

test('ENT-105 BF-18 deadline crossed after preparation blocks dispatch and preserves ABSENT recovery',t=>withFixture(async(f,cluster)=>{
 const server=await referenceEffects(cluster),port=new SyntheticPort(server.url);try{
 const b=await ready(f),due=Date.parse((await f.call('operator','get',{id:b.id})).workflow.due);
 let now=due-1;f.kernel.clock=()=>now;
 f.kernel.fault=async point=>{if(point==='enterprise-before-send')now=due;};
 const result=await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},port);
 t.diagnostic(JSON.stringify({due,now,result,requests:server.requests(),ledger:await server.ledger()}));
 assert.deepEqual(result,{id:b.id,state:'UNKNOWN'});assert.deepEqual(server.requests(),[]);assert.deepEqual(await server.ledger(),[]);
 const audit=(await f.owner.query("SELECT record FROM audit WHERE record->>'id'=$1 AND record->>'kind' LIKE 'EnterpriseExternal%'",[b.id])).rows.map(x=>x.record);
 assert.equal(audit.filter(x=>x.kind==='EnterpriseExternalIntent').length,1);
 assert.equal(audit.filter(x=>x.kind==='EnterpriseExternalObserved').length,0);
 assert.equal(audit.find(x=>x.kind==='EnterpriseExternalUncertain').code,'INVALID_STATE');
 restart(f);f.kernel.clock=()=>due+1;
 assert.equal((await f.call('operator','get',{id:b.id})).workflow.state,'UNKNOWN');
 await assert.rejects(f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},port),{code:'INVALID_STATE'});
 for(let n=0;n<2;n++)assert.deepEqual(await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'reconcile'},port),{id:b.id,state:'UNKNOWN',observation:'ABSENT',requiresHumanReview:true});
 assert.deepEqual(server.requests().map(x=>x.method),['GET','GET']);assert.deepEqual(await server.ledger(),[]);
 }finally{await server.close();}
}));

test('ENT-105 BF-18 already expired preparation leaves READY and makes no external intent',()=>withFixture(async(f,cluster)=>{
 const server=await referenceEffects(cluster),port=new SyntheticPort(server.url);try{
 const b=await ready(f),due=Date.parse((await f.call('operator','get',{id:b.id})).workflow.due);f.kernel.clock=()=>due;
 await assert.rejects(f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},port),{code:'INVALID_STATE'});
 assert.equal((await f.call('operator','get',{id:b.id})).workflow.state,'READY');assert.deepEqual(server.requests(),[]);assert.deepEqual(await server.ledger(),[]);
 assert.equal((await f.owner.query("SELECT count(*)::int AS n FROM audit WHERE record->>'id'=$1 AND record->>'kind' LIKE 'EnterpriseExternal%'",[b.id])).rows[0].n,0);
 }finally{await server.close();}
}));

test('ENT-105 BF-18 valid dispatch before deadline and compensation after deadline',()=>withFixture(async(f,cluster)=>{
 const server=await referenceEffects(cluster),port=new SyntheticPort(server.url);try{
 const b=await ready(f),due=Date.parse((await f.call('operator','get',{id:b.id})).workflow.due);f.kernel.clock=()=>due-1;
 assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},port)).state,'SUCCEEDED');
 restart(f);f.kernel.clock=()=>due+1;
 assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'compensate'},port)).state,'COMPENSATED');
 assert.equal((await server.ledger())[0].applications,1);assert.equal((await server.ledger())[0].reversals,1);
 assert.deepEqual(server.requests().map(x=>x.path),['/effects','/compensations']);
 }finally{await server.close();}
}));

test('ENT-105 BF-18 external success with lost acknowledgement reconciles and compensates after deadline',()=>withFixture(async(f,cluster)=>{
 const server=await referenceEffects(cluster),port=new SyntheticPort(server.url);try{
 const b=await ready(f),due=Date.parse((await f.call('operator','get',{id:b.id})).workflow.due);f.kernel.clock=()=>due-1;server.fault('lost-ack');
 assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},port)).state,'UNKNOWN');
 restart(f);f.kernel.clock=()=>due+1;
 assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'reconcile'},port)).state,'SUCCEEDED');
 assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'compensate'},port)).state,'COMPENSATED');
 assert.equal((await server.ledger())[0].applications,1);assert.equal((await server.ledger())[0].reversals,1);
 assert.deepEqual(server.requests().map(x=>x.method),['POST','GET','POST']);
 }finally{await server.close();}
}));

test('ENT-105 BF-06 recovery after applicant and approver revocation never reapplies effect',()=>withFixture(async(f,cluster)=>{
 const server=await referenceEffects(cluster),port=new SyntheticPort(server.url);try{
 const b=await ready(f);assert.equal((await child(f,server,b.id,'dispatch','enterprise-after-send')).code,73);
 await f.owner.query("UPDATE principals SET active=false WHERE id IN ('operator','reviewer')");restart(f);
 assert.equal((await f.call('manager','get',{id:b.id})).workflow.state,'UNKNOWN');
 const result=await child(f,server,b.id,'reconcile');assert.equal(result.code,0,result.stderr);assert.equal(JSON.parse(result.stdout).state,'SUCCEEDED');
 assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'compensate'},port)).state,'COMPENSATED');
 assert.equal((await server.ledger())[0].applications,1);assert.equal((await server.ledger())[0].reversals,1);
 assert.deepEqual(server.requests().map(x=>[x.method,x.path.split('/')[1]]),[['POST','effects'],['GET','effects'],['POST','compensations']]);
 const observed=(await f.owner.query("SELECT record FROM audit WHERE record->>'kind'='EnterpriseExternalObserved'")).rows;
 assert.deepEqual(observed.map(x=>x.record.mode).sort(),['compensate','reconcile']);assert.ok(observed.every(x=>x.record.actor==='manager'));
 }finally{await server.close();}
}));

test('ENT-105 BF-06 recovery requires current scoped field authority and intact binding',()=>withFixture(async(f,cluster)=>{
 const server=await referenceEffects(cluster),port=new SyntheticPort(server.url);try{
 const b=await ready(f);server.fault('lost-ack');await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},port);
 const initialRequests=server.requests();
 for(const who of ['other','tenant2'])await assert.rejects(f.kernel.enterpriseWork(f.credentials[who],{id:b.id,mode:'reconcile'},port),{code:'NOT_FOUND'});
 await f.owner.query("UPDATE enterprise_grants SET operations='[\"worker\"]' WHERE principal='agent'");
 await assert.rejects(f.kernel.enterpriseWork(f.credentials.agent,{id:b.id,mode:'reconcile'},port),{code:'PERMISSION_DENIED'});
 await f.owner.query("UPDATE enterprise_grants SET operations='[\"recovery\"]',fields='[\"INTERNAL\"]' WHERE principal='agent'");
 await assert.rejects(f.kernel.enterpriseWork(f.credentials.agent,{id:b.id,mode:'reconcile'},port),{code:'PERMISSION_DENIED'});
 await f.owner.query("UPDATE objects SET fields=jsonb_set(fields,'{amount}','9999') WHERE id=$1",[b.id]);
 await assert.rejects(f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'reconcile'},port),{code:'STALE_APPROVAL'});
 assert.deepEqual(server.requests(),initialRequests);
 assert.equal((await server.ledger())[0].applications,1);assert.equal((await server.ledger())[0].reversals,0);
 }finally{await server.close();}
}));

test('ENT-105 BF-06 recovery revocation at I/O and unknown absence stay fail closed',()=>withFixture(async(f,cluster)=>{
 const server=await referenceEffects(cluster),port=new SyntheticPort(server.url);try{
 const b=await ready(f);server.fault('lost-ack');await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},port);
 const initialRequests=server.requests();
 f.kernel.fault=async point=>{if(point==='enterprise-before-send')await f.owner.query("UPDATE enterprise_grants SET active=false WHERE principal='agent'");};
 assert.equal((await f.kernel.enterpriseWork(f.credentials.agent,{id:b.id,mode:'reconcile'},port)).state,'UNKNOWN');assert.deepEqual(server.requests(),initialRequests);
 f.kernel.fault=async()=>{};
 const absent=await ready(f);f.kernel.fault=async point=>{if(point==='enterprise-before-send')throw Error('crash');};
 await f.kernel.enterpriseWork(f.credentials.manager,{id:absent.id,mode:'dispatch'},port);f.kernel.fault=async()=>{};
 await f.owner.query("UPDATE enterprise_grants SET active=false WHERE principal='operator'");
 assert.deepEqual(await f.kernel.enterpriseWork(f.credentials.manager,{id:absent.id,mode:'reconcile'},port),{id:absent.id,state:'UNKNOWN',observation:'ABSENT',requiresHumanReview:true});
 assert.equal((await server.ledger()).length,1);assert.equal(server.requests().filter(x=>x.method==='POST'&&x.path==='/effects').length,1);
 }finally{await server.close();}
}));

test('ENT-105 AC-01 positive persistence SLA business calendar timezone and one notification',async t=>t.test('positive ENT-105 executable contract scenario',async t=>t.test('persistence ENT-105 executable contract scenario',()=>withFixture(async f=>{
 const calendar={timezone:'Asia/Tokyo',weekdays:[1,2,3,4,5],holidays:['2026-10-12'],businessDays:1};assert.equal(deadline(Date.parse('2026-10-09T06:12:34.123Z'),calendar).toISOString(),'2026-10-12T15:00:00.000Z');
 assert.equal(deadline(Date.parse('2026-10-30T18:00:00Z'),{...calendar,timezone:'America/New_York',holidays:[]}).toISOString(),'2026-11-02T05:00:00.000Z');
 const b=f.create();await f.call('operator','create',b);restart(f);f.kernel.clock=()=>Date.now()+10*86400000;assert.deepEqual((await f.call('manager','tick')).expired,[b.id]);assert.deepEqual((await f.call('manager','tick')).expired,[]);assert.equal((await f.owner.query("SELECT count(*)::int AS n FROM audit WHERE record->>'kind'='EnterpriseSLAExpired'")).rows[0].n,1);assert.equal((await f.call('operator','get',{id:b.id})).workflow.state,'EXPIRED');
}))));
test('ENT-105 AC-02 failure-recovery real process death after external success resume without duplicate effects',async t=>t.test('failure-recovery ENT-105 executable contract scenario',()=>withFixture(async(f,cluster)=>{
 const server=await referenceEffects(cluster);try{const b=await ready(f);
 const crashed=await child(f,server,b.id,'dispatch','enterprise-after-send');assert.equal(crashed.code,73,crashed.stderr);restart(f);assert.equal((await f.call('operator','get',{id:b.id})).workflow.state,'UNKNOWN');
 const resumed=await child(f,server,b.id,'reconcile');assert.equal(resumed.code,0,resumed.stderr);assert.equal(JSON.parse(resumed.stdout).state,'SUCCEEDED');
 const repeated=await child(f,server,b.id,'dispatch');assert.equal(repeated.code,0,repeated.stderr);assert.equal(JSON.parse(repeated.stdout).state,'SUCCEEDED');assert.equal((await server.ledger())[0].applications,1);
 }finally{await server.close();}
})));
test('ENT-105 AC-03 positive failure-recovery lost acknowledgement UNKNOWN reconciliation compensation',()=>withFixture(async(f,cluster)=>{
 const server=await referenceEffects(cluster),port=new SyntheticPort(server.url);try{const b=await ready(f);server.fault('lost-ack');assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},port)).state,'UNKNOWN');
 await assert.rejects(f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},port),{code:'INVALID_STATE'});assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'reconcile'},port)).state,'SUCCEEDED');
 server.fault('lost-ack');assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'compensate'},port)).state,'COMPENSATING');restart(f);assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'reconcile'},port)).state,'COMPENSATED');assert.equal((await server.ledger())[0].reversals,1);
 const absent=await ready(f);f.kernel.fault=async point=>{if(point==='enterprise-before-send')throw Error('crash');};assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:absent.id,mode:'dispatch'},port)).state,'UNKNOWN');f.kernel.fault=async()=>{};assert.deepEqual(await f.kernel.enterpriseWork(f.credentials.manager,{id:absent.id,mode:'reconcile'},port),{id:absent.id,state:'UNKNOWN',observation:'ABSENT',requiresHumanReview:true});
 }finally{await server.close();}
}));
test('ENT-105 negative-authorization revocation before send and scope block effects',async t=>t.test('negative-authorization ENT-105 executable contract scenario',()=>withFixture(async(f,cluster)=>{
 const server=await referenceEffects(cluster),port=new SyntheticPort(server.url);try{const b=await ready(f);await assert.rejects(f.kernel.enterpriseWork(f.credentials.other,{id:b.id,mode:'dispatch'},port),{code:'NOT_FOUND'});
 f.kernel.fault=async point=>{if(point==='enterprise-before-send')await f.owner.query("UPDATE enterprise_grants SET active=false WHERE principal='operator'");};assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},port)).state,'UNKNOWN');assert.equal((await server.ledger()).length,0);
 }finally{await server.close();}
})));
test('ENT-105 failure-recovery submission commit acknowledgement journal reconciliation',()=>withFixture(async f=>{
 const b=f.create(),key=crypto.randomUUID();f.kernel.fault=async point=>{if(point==='enterprise-after-commit')throw Error('lost acknowledgement');};await assert.rejects(f.call('operator','create',b,key),{code:'UNAVAILABLE'});restart(f);await assert.rejects(f.call('operator','create',b,key),{code:'INCONSISTENT_STATE'});await assert.rejects(f.kernel.enterpriseRecover(f.credentials.other),{code:'NOT_FOUND'});assert.equal((await f.kernel.enterpriseRecover(f.credentials.manager)).recovered.length,1);assert.equal((await f.call('operator','create',b,key)).id,b.id);assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM objects WHERE id=$1',[b.id])).rows[0].n,1);
}));

test('ENT-105 BF-43 completed dispatch HTTP current policy field revocation and restore without duplicate effects',async()=>{
 const {localEnvironment}=await import('../../scripts/enterprise/local.mjs'),{login}=await import('./http-helper.mjs'),{scope}=await import('../../scripts/enterprise/fixture.mjs');
 const {mkdir,writeFile}=await import('node:fs/promises'),{execFileSync}=await import('node:child_process'),{enterpriseGateway}=await import('../../src/enterprise/gateway.mjs');
 const env=await localEnvironment(),records=[],checks=[],output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';
 const api=async(user,operation,body)=>{const r=await user.api(operation,body),x={operation,request:body,status:r.status,body:await r.json()};records.push(x);return x;};
 try{
  let operator,manager,publisher;const loginAll=async()=>{operator=await login(env,'operator');manager=await login(env,'manager');publisher=await login(env,'publisher');};await loginAll();
  const reconnect=async()=>{await env.gateway.close();restart(env.f);env.gateway=await enterpriseGateway(env.f.kernel,{issuer:env.idp.issuer,port:new SyntheticPort(env.effects.url)});await loginAll();};
  const createReady=async()=>{const b=env.f.create();assert.equal((await api(operator,'create',b)).status,200);for(const who of ['manager','reviewer','publisher'])assert.equal((await api(await login(env,who),'vote',{id:b.id,revision:1,decision:'APPROVE'})).status,200);return b;};
  const cases=[];for(const state of ['SUCCEEDED','COMPENSATED']){const b=await createReady();assert.equal((await api(manager,'dispatch',{id:b.id})).body.result.state,'SUCCEEDED');if(state==='COMPENSATED')assert.equal((await api(manager,'compensate',{id:b.id})).body.result.state,state);cases.push({b,state});}
  const stable=async()=>{const x={};for(const [table,order] of [['objects','id'],['actions','id'],['history','object_id,revision'],['enterprise_instances','id'],['outbox','operation_id']])x[table]=(await env.f.owner.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;return x;};
  const replay=async(user,b,state,code)=>{const before=await stable(),journal=env.f.kernel.journal.records(),requests=await env.effects.requests(),audit=(await env.f.owner.query('SELECT * FROM audit ORDER BY sequence')).rows,r=await api(user,'dispatch',{id:b.id}),after=await stable();checks.push({id:b.id,state,code:code??null,response:r,before,after});assert.deepEqual(after,before);assert.deepEqual(env.f.kernel.journal.records(),journal);assert.deepEqual(await env.effects.requests(),requests);assert.deepEqual((await env.f.owner.query('SELECT * FROM audit WHERE sequence<=$1 ORDER BY sequence',[audit.at(-1).sequence])).rows,audit);assert.equal((await env.f.owner.query("SELECT * FROM audit WHERE sequence>$1 AND record->>'kind' IN ('EnterpriseExternalIntent','EnterpriseExternalObserved','EnterpriseExternalUncertain')",[audit.at(-1).sequence])).rows.length,0);if(code){assert.equal(r.status,code==='NOT_FOUND'?404:code==='PERMISSION_DENIED'?403:400);assert.deepEqual(r.body,{error:{code}});}else{assert.equal(r.status,200);assert.deepEqual(r.body.result,{id:b.id,state});}return r;};
  for(const x of cases)await replay(manager,x.b,x.state);
  for(const who of ['other','tenant2'])for(const x of cases)await replay(await login(env,who),x.b,x.state,'NOT_FOUND');
  const grant=(fields,scopes=[scope])=>api(publisher,'grant',{principal:'manager',scopes,operations:['read','search','worker','recovery','approve'],fields});
  const all=['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'];
  const schema=(await env.f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',env.cluster.config.host,'-p',String(env.cluster.config.port),'-U',env.cluster.config.user,'-d',env.cluster.config.database];
  const dump=name=>{const file=env.cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+file]);return file;};
  const restore=async file=>{await env.f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+file],{stdio:'pipe'});};
  // Save both disclosure counterexamples before asserting either response.
  const preclassification=dump('BF43-unclassified'),oldManager=manager,classification=[];
  assert.equal((await grant(['INTERNAL','CONFIDENTIAL'])).status,200);
  for(const {b} of cases){const id=crypto.randomUUID();classification.push(id);assert.equal((await api(publisher,'informationCreate',{id,scope,source:{kind:'object',id:b.id,projection:['title']},label:'STRICT',purposes:['summary','disclosure']})).status,200);for(const op of ['get','history'])assert.equal((await api(manager,op,{id:b.id,purpose:'summary'})).status,403);}
  const saved=await stable(),journal=env.f.kernel.journal.records(),requests=await env.effects.requests();const denied=[];for(const {b} of cases)denied.push(await api(manager,'dispatch',{id:b.id}));checks.push({phase:'classified-terminal-responses',responses:denied,before:saved,after:await stable()});assert.deepEqual(await stable(),saved);assert.deepEqual(env.f.kernel.journal.records(),journal);assert.deepEqual(await env.effects.requests(),requests);for(const r of denied){assert.equal(r.status,403);assert.deepEqual(r.body,{error:{code:'PERMISSION_DENIED'}});}
  // Dispatch's existing policy forbids tagged sources even with full clearance;
  // granting read clearance must not silently authorize a dispatch response.
  assert.equal((await grant(all)).status,200);for(const {b,state} of cases){assert.equal((await api(manager,'get',{id:b.id,purpose:'summary'})).status,200);await replay(manager,b,state,'PERMISSION_DENIED');}
  const classified=dump('BF43-classified');await reconnect();for(const x of cases)await replay(manager,x.b,x.state,'PERMISSION_DENIED');
  await restore(preclassification);await replay(oldManager,cases[0].b,'SUCCEEDED','RECOVERING');await restore(classified);await reconnect();
  await env.f.owner.query('DELETE FROM enterprise_controls WHERE id=$1',[classification[0]]);await replay(manager,cases[0].b,'SUCCEEDED','RECOVERING');await restore(classified);await reconnect();
  // A current recovery operator can still compensate classified completed work.
  for(const principal of ['operator','reviewer'])assert.equal((await api(publisher,'grant',{principal,scopes:[],operations:[],fields:[]})).status,200);
  assert.equal((await api(manager,'compensate',{id:cases[0].b.id,purpose:'summary'})).body.result.state,'COMPENSATED');await replay(manager,cases[0].b,'COMPENSATED','PERMISSION_DENIED');
  // Field checks also apply to untagged terminal responses, including rollback.
  assert.equal((await api(publisher,'grant',{principal:'operator',scopes:[scope],operations:['read','search','action'],fields:all})).status,200);
  assert.equal((await api(publisher,'grant',{principal:'reviewer',scopes:[scope],operations:['read','search','approve'],fields:all})).status,200);
  const untagged=await createReady();assert.equal((await api(manager,'dispatch',{id:untagged.id})).body.result.state,'SUCCEEDED');const granted=dump('BF43-clearance');
  assert.equal((await grant(['INTERNAL'])).status,200);await replay(manager,untagged,'SUCCEEDED','PERMISSION_DENIED');await reconnect();await replay(manager,untagged,'SUCCEEDED','PERMISSION_DENIED');await restore(granted);await reconnect();await replay(manager,untagged,'SUCCEEDED','PERMISSION_DENIED');
  assert.equal((await grant(all)).status,200);await replay(manager,untagged,'SUCCEEDED');assert.equal((await grant(all,[])).status,200);await replay(manager,untagged,'SUCCEEDED','NOT_FOUND');
  const ledger=await env.effects.ledger();assert.equal(ledger.reduce((n,x)=>n+x.applications,0),3);assert.equal(ledger.reduce((n,x)=>n+x.reversals,0),2);checks.push({ledger});
 }finally{await mkdir(output,{recursive:true});await writeFile(output+'/BF43-contract.json',JSON.stringify({records,checks},null,2)+'\n');await env.gateway.close();await env.close();}
});

test('ENT-105 BF-43 browser fresh dispatch from open completed case rejects strengthened source policy',async()=>{
 const {localEnvironment}=await import('../../scripts/enterprise/local.mjs'),{login}=await import('./http-helper.mjs'),{scope}=await import('../../scripts/enterprise/fixture.mjs'),{browser}=await import('./browser-helper.mjs'),{mkdir,writeFile}=await import('node:fs/promises');
 const env=await localEnvironment(),page=await browser(),output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';let result={};
 try{
  const publisher=await login(env,'publisher'),operator=await login(env,'operator'),manager=await login(env,'manager'),b=env.f.create();assert.equal((await operator.api('create',b)).status,200);for(const who of ['manager','reviewer','publisher'])assert.equal((await (await login(env,who)).api('vote',{id:b.id,revision:1,decision:'APPROVE'})).status,200);assert.equal((await manager.api('dispatch',{id:b.id})).status,200);
  await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]','manager');await page.click('button');await page.until('document.querySelectorAll("#cases button").length===1');await page.click('#cases button');await page.until('document.querySelector("#record").dataset.state==="SUCCEEDED"');
  await page.evaluate(`window.bf43=[];const originalFetch=window.fetch;window.fetch=async(...args)=>{const r=await originalFetch(...args);if(args[0]==='/api')window.bf43.push({request:JSON.parse(args[1].body),status:r.status,body:await r.clone().json()});return r;}`);
  const click=async op=>{const n=await page.evaluate('window.bf43.length');await page.click('[data-operation="'+op+'"]');await page.until(`window.bf43.slice(${n}).some(x=>x.request.operation===${JSON.stringify(op)})`);await page.until('document.querySelector("#message").textContent.length>0');return page.evaluate(`window.bf43.slice(${n}).find(x=>x.request.operation===${JSON.stringify(op)})`);};
  assert.equal((await click('dispatch')).status,200);await page.until('document.querySelector("#record").dataset.state==="SUCCEEDED"');await page.screenshot('BF43-authorized');
  assert.equal((await publisher.api('grant',{principal:'manager',scopes:[scope],operations:['read','search','worker','recovery','approve'],fields:['INTERNAL','CONFIDENTIAL']})).status,200);
  assert.equal((await publisher.api('informationCreate',{id:crypto.randomUUID(),scope,source:{kind:'object',id:b.id,projection:['title']},label:'STRICT',purposes:['summary','disclosure']})).status,200);
  const denied=await click('dispatch');await page.until('document.querySelector("#message").textContent.includes("PERMISSION_DENIED")');await page.screenshot('BF43-classified');assert.equal(denied.status,403);assert.deepEqual(denied.body,{error:{code:'PERMISSION_DENIED'}});
  assert.equal((await publisher.api('grant',{principal:'manager',scopes:[scope],operations:['read','search','worker','recovery','approve'],fields:['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED']})).status,200);
  assert.equal((await click('compensate')).status,200);assert.equal((await click('dispatch')).status,403);await page.screenshot('BF43-compensated');
  result.ledger=await env.effects.ledger();assert.equal(result.ledger[0].applications,1);assert.equal(result.ledger[0].reversals,1);result.browser=await page.send('Browser.getVersion');
 }finally{result.records=await page.evaluate('window.bf43??[]');await mkdir(output,{recursive:true});await writeFile(output+'/BF43-browser.json',JSON.stringify(result,null,2)+'\n');await page.close();await env.close();}
});

async function bf51Environment(){
 const {localEnvironment}=await import('../../scripts/enterprise/local.mjs'),{login}=await import('./http-helper.mjs'),{scope}=await import('../../scripts/enterprise/fixture.mjs');
 const env=await localEnvironment(),records=[],users={},all=['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'],low=['PUBLIC','INTERNAL','CONFIDENTIAL'];
 const api=async(who,operation,body={},key=crypto.randomUUID())=>{const r=await users[who].api(operation,body,key),x={who,operation,request:body,key,status:r.status,body:await r.json()};records.push(x);return x;};
 const loginAll=async()=>{for(const who of ['operator','manager','publisher','other','tenant2'])users[who]=await login(env,who);};await loginAll();
 const cases=[];for(let n=0;n<2;n++){const b=env.f.create();assert.equal((await api('operator','create',b)).status,200);cases.push(b);}
 const now=Date.now()+10*86400000;env.f.kernel.clock=()=>now;
 const key=crypto.randomUUID(),first=await api('manager','tick',{},key);assert.equal(first.status,200);assert.deepEqual([...first.body.result.expired].sort(),cases.map(b=>b.id).sort());
 const grant=async(fields=low,scopes=[scope],operations=['read','search','worker','recovery'])=>{const r=await api('publisher','grant',{principal:'manager',fields,scopes,operations});assert.equal(r.status,200);};
 const classify=async b=>{const id=crypto.randomUUID();assert.equal((await api('publisher','informationCreate',{id,scope,source:{kind:'object',id:b.id,projection:['title']},label:'STRICT',purposes:['summary']})).status,200);return id;};
 const stable=async()=>{const x={};for(const [table,order] of [['objects','id'],['enterprise_instances','id'],['history','object_id,revision'],['actions','id'],['outbox','operation_id']])x[table]=(await env.f.owner.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;x.journal=env.f.kernel.journal.records();x.requests=env.effects.requests();x.ledger=await env.effects.ledger();x.notifications=(await env.f.owner.query("SELECT record FROM audit WHERE record->>'kind'='EnterpriseSLAExpired' ORDER BY sequence")).rows;return x;};
 const reconnect=async()=>{const {enterpriseGateway}=await import('../../src/enterprise/gateway.mjs');await env.gateway.close();restart(env.f);env.f.kernel.clock=()=>now;env.gateway=await enterpriseGateway(env.f.kernel,{issuer:env.idp.issuer,port:new SyntheticPort(env.effects.url)});await loginAll();};
 return {env,users,api,records,cases,key,first,grant,classify,stable,reconnect,all,low,scope};
}

test('ENT-105 BF-51 tick replay checks current source and scope without reexecution across restart and restore',async()=>{
 const {env,api,records,cases,key,first,grant,classify,stable,reconnect,all,scope}=await bf51Environment(),checks=[],output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';
 const {mkdir,writeFile}=await import('node:fs/promises'),{execFileSync}=await import('node:child_process');
 try{
  const probe=async(name,code=null)=>{const before=await stable(),r=await api('manager','tick',{},key),after=await stable();checks.push({name,response:r,before,after});assert.deepEqual(after,before);if(code){assert.equal(r.status,code==='NOT_FOUND'?404:code==='PERMISSION_DENIED'?403:400);assert.deepEqual(r.body,{error:{code}});}else{assert.equal(r.status,200);assert.deepEqual(r.body,first.body);}return r;};
  await probe('unchanged-replay');await reconnect();await probe('restart-replay');assert.equal((await stable()).notifications.length,2);
  // Scope removal is made through the public grant API and restores cleanly.
  await grant(all,[]);assert.equal((await api('manager','get',{id:cases[0].id})).status,404);await probe('no-scope','NOT_FOUND');await grant(all);await probe('scope-restored');
  assert.equal((await api('other','grant',{principal:'manager',fields:all,scopes:[{...scope,departmentId:'synthetic-hr'}],operations:['read','search','worker','recovery']})).status,200);assert.equal((await api('manager','get',{id:cases[0].id})).status,404);await probe('moved-department','NOT_FOUND');await grant(all);
  for(const who of ['other','tenant2']){const r=await api(who,'tick',{},key);assert.equal(r.status,200);assert.deepEqual(r.body.result,{expired:[]});}
  await grant(all,[scope],['read','search']);await probe('worker-revoked','PERMISSION_DENIED');await grant(all);
  assert.deepEqual((await api('manager','tick',{purpose:'summary'},key)).body,{error:{code:'IDEMPOTENCY_MISMATCH'}});assert.deepEqual((await api('manager','tick',{purpose:'summary'})).body,{error:{code:'INVALID_ARGUMENT'}});
  const schema=(await env.f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',env.cluster.config.host,'-p',String(env.cluster.config.port),'-U',env.cluster.config.user,'-d',env.cluster.config.database];
  const dump=name=>{const file=env.cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+file]);return file;};
  const restore=async file=>{await env.f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+file],{stdio:'pipe'});};
  const unclassified=dump('bf51-before-classification');await grant();const classification=await classify(cases[1]);
  assert.equal((await api('manager','get',{id:cases[0].id})).status,200);for(const op of ['get','history'])assert.equal((await api('manager',op,{id:cases[1].id,purpose:'summary'})).status,403);
  await probe('mixed-visible-and-invisible-result','PERMISSION_DENIED');
  await grant(all);assert.equal((await api('manager','get',{id:cases[1].id,purpose:'summary'})).status,200);await probe('clearance-does-not-supply-purpose','PERMISSION_DENIED');
  const granted=dump('bf51-granted');await grant();await probe('classification-clearance-revoked','PERMISSION_DENIED');await reconnect();await probe('restart-denial','PERMISSION_DENIED');await restore(granted);await reconnect();await probe('restored-before-revocation','PERMISSION_DENIED');
  await grant(all);const classified=dump('bf51-classified');await restore(unclassified);await reconnect();await probe('restored-before-classification','RECOVERING');await restore(classified);await reconnect();await env.f.owner.query('DELETE FROM enterprise_controls WHERE id=$1',[classification]);await probe('classification-row-missing','RECOVERING');await restore(classified);await reconnect();
  await probe('classification-restored','PERMISSION_DENIED');assert.deepEqual((await api('manager','tick')).body.result,{expired:[]});assert.equal((await stable()).notifications.length,2);
  // A fresh command still expires eligible untagged work; replay never rescans it.
  const b=env.f.create();env.f.kernel.clock=()=>Date.now();assert.equal((await api('operator','create',b)).status,200);env.f.kernel.clock=()=>Date.now()+10*86400000;await probe('no-rescan-new-due-work','PERMISSION_DENIED');assert.equal((await api('manager','get',{id:b.id})).body.result.workflow.state,'WAITING_APPROVAL');assert.deepEqual((await api('manager','tick')).body.result,{expired:[b.id]});assert.equal((await stable()).notifications.length,3);
 }finally{await mkdir(output,{recursive:true});await writeFile(output+'/BF51-contract.json',JSON.stringify({cases,key,records,checks},null,2)+'\n');await env.gateway.close();await env.close();}
});

test('ENT-105 BF-51 authenticated browser tick same-key replay denies newly classified saved result',async()=>{
 const {env,api,records,cases,key,grant,classify}=await bf51Environment(),{browser}=await import('./browser-helper.mjs'),page=await browser(),{mkdir,writeFile}=await import('node:fs/promises'),output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser',result={};
 try{
  await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]','manager');await page.click('button');await page.until('!!document.querySelector("#cases")');
  await page.evaluate(`window.bf51=[];window.probeTick=async key=>{const s=await(await fetch('/session')).json(),response=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrf},body:JSON.stringify({contractVersion:'2.0.0',operation:'tick',body:{},key})});const r={status:response.status,body:await response.json()};window.bf51.push(r);let out=document.querySelector('#bf51-result');if(!out){out=document.createElement('pre');out.id='bf51-result';document.body.prepend(out);}out.textContent=JSON.stringify(window.bf51,null,2);return r;};`);
  const replay=()=>page.evaluate(`window.probeTick(${JSON.stringify(key)})`);assert.equal((await replay()).status,200);await page.screenshot('BF51-authorized-replay');await grant();await classify(cases[1]);const denied=await replay();await page.screenshot('BF51-classified-replay');assert.equal(denied.status,403);assert.deepEqual(denied.body,{error:{code:'PERMISSION_DENIED'}});await grant(undefined,[]);assert.equal((await replay()).status,404);await page.screenshot('BF51-scope-revoked');result.browser=await page.send('Browser.getVersion');
 }finally{result.records=await page.evaluate('window.bf51??[]');result.setup=records;await mkdir(output,{recursive:true});await writeFile(output+'/BF51-browser.json',JSON.stringify(result,null,2)+'\n');await page.close();await env.close();}
});
