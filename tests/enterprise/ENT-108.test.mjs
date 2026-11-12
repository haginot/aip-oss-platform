import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withFixture} from './helpers.mjs';
import {connection,routed,workerChild} from './connector-scenario.mjs';
import {receiveWebhook,webhookSignature} from '../../src/enterprise/connectors.mjs';
import {localEnvironment} from '../../scripts/enterprise/local.mjs';
test('ENT-108 BF-07 unchanged connection saves preserve crash recovery and compensation',()=>withFixture(async(f,cluster)=>{
 const c=await connection(f,cluster,'mail');try{
  const b=await routed(f,'mail'),before=(await f.call('manager','connectionList')).items[0];
  const crashed=await workerChild(f,c.registry,b.id,'dispatch','enterprise-after-send');assert.equal(crashed.code,73,crashed.stderr);
  // A fresh request key and reordered JSON keys represent the same configuration.
  await f.call('manager','connectionSet',{...c.body,scope:Object.fromEntries(Object.entries(c.body.scope).reverse())});
  assert.equal((await f.call('manager','connectionList')).items[0].revision,before.revision);
  const deniedCount=c.server.requests().length;
  await assert.rejects(f.kernel.enterpriseWork(f.credentials.reader,{id:b.id,mode:'reconcile'},c.port),{code:'PERMISSION_DENIED'});
  assert.equal(c.server.requests().length,deniedCount);
  const resumed=await workerChild(f,c.registry,b.id,'reconcile');assert.equal(resumed.code,0,resumed.stderr);assert.equal(JSON.parse(resumed.stdout).state,'SUCCEEDED');
  await f.call('manager','connectionSet',c.body);
  const compensated=await workerChild(f,c.registry,b.id,'compensate');assert.equal(compensated.code,0,compensated.stderr);assert.equal(JSON.parse(compensated.stdout).state,'COMPENSATED');
  assert.deepEqual(c.server.requests().map(r=>r.method),['POST','GET','POST']);
  const [effect]=await c.server.ledger();assert.equal(effect.applications,1);assert.equal(effect.reversals,1);
 }finally{await c.server.close();}
}));
test('ENT-108 BF-07 material connection changes still reject pinned recovery',async t=>{
 for(const field of ['active','destination','secretRef','scope','provider'])await t.test(field,()=>withFixture(async(f,cluster)=>{
  const c=await connection(f,cluster,'mail');try{
   c.registry.mail.destinations.push('other-target');c.registry.mail.secretRefs.push('other-secret');c.registry.mail.secrets['other-secret']='synthetic-secret';c.registry.calendar=c.registry.mail;
   const b=await routed(f,'mail');c.server.fault('lost-ack');assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},c.port)).state,'UNKNOWN');
   const succeeded=await routed(f,'mail');assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:succeeded.id,mode:'dispatch'},c.port)).state,'SUCCEEDED');
   const before=(await f.call('manager','connectionList')).items[0],count=c.server.requests().length;
   const patches={active:false,destination:'other-target',secretRef:'other-secret',scope:{...c.body.scope,classification:'INTERNAL'},provider:'calendar'};
   if(field==='scope')await f.owner.query('UPDATE enterprise_grants SET scopes=$1 WHERE principal=$2',[JSON.stringify([c.body.scope,patches.scope]),'manager']);
   await f.call('manager','connectionSet',{...c.body,[field]:patches[field]});
   assert.equal(Number((await f.owner.query('SELECT revision FROM enterprise_connections WHERE id=$1',['mail'])).rows[0].revision),Number(before.revision)+1);
   for(const [mode,id] of [['reconcile',b.id],['compensate',succeeded.id]])await assert.rejects(f.kernel.enterpriseWork(f.credentials.manager,{id,mode},c.port),{code:'PERMISSION_DENIED'});
   assert.equal(c.server.requests().length,count);const ledger=await c.server.ledger();assert.equal(ledger.length,2);for(const effect of ledger){assert.equal(effect.applications,1);assert.equal(effect.reversals,0);}
  }finally{await c.server.close();}
 }));
});
test('ENT-108 HTTP signed webhook authenticates without browser credentials',async()=>{
 const env=await localEnvironment({governance:true});try{
  const timestamp=String(Date.now()),raw=JSON.stringify({id:'http-event',sequence:1,stableId:'t1:mail:synthetic-case',state:'SUCCEEDED'}),signature=webhookSignature('local-synthetic-secret',timestamp,raw);
  const send=sig=>fetch(env.gateway.origin+'/webhooks/t1/local-mail',{method:'POST',headers:{'content-type':'application/json','x-timestamp':timestamp,'x-signature':sig},body:raw});
  assert.equal((await send('0'.repeat(64))).status,403);const response=await send(signature);assert.equal(response.status,200);assert.equal((await response.json()).disposition,'ACCEPTED');assert.equal((await (await send(signature)).json()).disposition,'DUPLICATE');
 }finally{await env.close();}
});
test('ENT-108 AC-01 destination and credential references are scoped',async t=>t.test('negative-authorization ENT-108 executable contract scenario',()=>withFixture(async(f,cluster)=>{
 const c=await connection(f,cluster,'mail');try{for(const patch of [{destination:'http://evil.invalid'},{secretRef:'missing'},{provider:'https://evil.invalid'}])await assert.rejects(f.call('manager','connectionSet',{...c.body,...patch}));await assert.rejects(f.call('operator','connectionSet',c.body),{code:'PERMISSION_DENIED'});await assert.rejects(f.call('other','connectionSet',c.body),{code:'NOT_FOUND'});assert.equal(JSON.stringify(await f.call('manager','connectionList')).includes('synthetic-secret'),false);
 }finally{await c.server.close();}
})));
test('ENT-108 AC-02 signed webhook rejects forgery replay mutation and stale ordering',async t=>t.test('positive ENT-108 executable contract scenario',()=>withFixture(async(f,cluster)=>{
 const c=await connection(f,cluster,'mail');try{const b=await routed(f,'mail'),timestamp=String(Date.now()),event={id:'event-2',sequence:2,stableId:'t1:mail:'+b.id,state:'SUCCEEDED'};
 const send=e=>{const raw=JSON.stringify(e);return receiveWebhook(f.kernel,'t1','mail',{timestamp,raw,signature:webhookSignature('synthetic-secret',timestamp,raw)});};
 assert.equal((await send(event)).disposition,'ACCEPTED');assert.equal((await send(event)).disposition,'DUPLICATE');assert.equal((await send({...event,id:'event-1',sequence:1})).disposition,'OUT_OF_ORDER');await assert.rejects(send({...event,state:'COMPENSATED'}),{code:'CONFLICT'});
 await assert.rejects(receiveWebhook(f.kernel,'t1','mail',{timestamp,raw:JSON.stringify(event),signature:'0'.repeat(64)}),{code:'PERMISSION_DENIED'});assert.equal((await f.call('manager','get',{id:b.id})).workflow.state,'READY');
 }finally{await c.server.close();}
})));
test('ENT-108 AC-03 process crash recovery and connection revocation',async t=>t.test('persistence ENT-108 executable contract scenario',async t=>t.test('failure-recovery ENT-108 executable contract scenario',()=>withFixture(async(f,cluster)=>{
 const c=await connection(f,cluster,'mail');try{const b=await routed(f,'mail');const crashed=await workerChild(f,c.registry,b.id,'dispatch','enterprise-after-send');assert.equal(crashed.code,73,crashed.stderr);const resumed=await workerChild(f,c.registry,b.id,'reconcile');assert.equal(resumed.code,0,resumed.stderr);assert.equal(JSON.parse(resumed.stdout).state,'SUCCEEDED');assert.equal((await c.server.ledger())[0].applications,1);
 const next=await routed(f,'mail');await f.call('manager','connectionSet',{...c.body,active:false});await assert.rejects(f.kernel.enterpriseWork(f.credentials.manager,{id:next.id,mode:'dispatch'},c.port),{code:'PERMISSION_DENIED'});assert.equal((await c.server.ledger()).length,1);
 }finally{await c.server.close();}
}))));

// BF-60: route assignment and replay share the case's current information policy.
async function bf60Environment(){
 const {login}=await import('./http-helper.mjs'),{scope}=await import('../../scripts/enterprise/fixture.mjs');
 const env=await localEnvironment({governance:true}),users={},records=[],checks=[];
 const all=['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'],base=all.slice(0,3),ops=['read','search','action'];
 const logins=async()=>{for(const who of ['operator','manager','reviewer','publisher','reader','other','tenant2'])users[who]=await login(env,who);};await logins();
 const api=async(who,operation,body={},key=crypto.randomUUID())=>{const r=await users[who].api(operation,body,key),x={who,request:{operation,body,key},status:r.status,body:await r.json()};records.push(x);return x;};
 const ok=async(...args)=>{const r=await api(...args);assert.equal(r.status,200,JSON.stringify(r));return r;};
 const grant=(fields=base,scopes=[scope],operations=ops)=>ok('publisher','grant',{principal:'operator',scopes,operations,fields});
 const create=async id=>{const b=env.f.create({id});await ok('operator','create',b);return {id:b.id,connectionId:'local-mail'};};
 const classify=async b=>{const id=crypto.randomUUID();await ok('publisher','informationCreate',{id,scope,source:{kind:'object',id:b.id,projection:['title']},label:'STRICT',purposes:['summary']});return id;};
 const snapshot=async()=>{const state={};for(const [table,order]of [['objects','id'],['actions','id'],['enterprise_instances','id'],['history','object_id,revision'],['outbox','operation_id'],['enterprise_routes','object_id'],['enterprise_connections','tenant,id']])state[table]=(await env.f.owner.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;return {state,requests:await env.effects.requests(),ledger:await env.effects.ledger()};};
 const observe=async(label,fn)=>{const before=await snapshot(),journalBefore=env.f.kernel.journal.records(),auditBefore=(await env.f.owner.query('SELECT * FROM audit ORDER BY sequence')).rows,response=await fn(),after=await snapshot(),journalAfter=env.f.kernel.journal.records(),auditAfter=(await env.f.owner.query('SELECT * FROM audit ORDER BY sequence')).rows;const x={label,response,before,after,journalBefore,journalAfter,auditBefore,auditAfter};checks.push(x);return x;};
 const check=(x,status=403,code='PERMISSION_DENIED')=>{assert.equal(x.response.status,status,JSON.stringify(x.response));if(status!==200)assert.deepEqual(x.response.body,{error:{code}});assert.deepEqual(x.after,x.before,x.label);assert.deepEqual(x.journalAfter.slice(0,x.journalBefore.length),x.journalBefore);const added=x.journalAfter.slice(x.journalBefore.length);assert.ok(added.length===0||added.length===2);if(added.length){assert.deepEqual(added.map(e=>e.phase),['INTENT','ABORTED']);assert.equal(added[0].operationId,added[1].operationId);}assert.deepEqual(x.auditAfter.slice(0,x.auditBefore.length),x.auditBefore);assert.equal(x.auditAfter.slice(x.auditBefore.length).some(e=>e.record.kind==='EnterpriseCommand'),false);return x.response;};
 const deny=async(label,fn,status=403,code='PERMISSION_DENIED')=>check(await observe(label,fn),status,code);
 const reconnect=async()=>{const {restart}=await import('./helpers.mjs'),{enterpriseGateway}=await import('../../src/enterprise/gateway.mjs'),{ConnectorPort}=await import('../../src/enterprise/connectors.mjs'),connections=env.f.kernel.connections;await env.gateway.close();restart(env.f);env.f.kernel.connections=connections;env.gateway=await enterpriseGateway(env.f.kernel,{issuer:env.idp.issuer,port:new ConnectorPort(connections)});await logins();};
 return {env,users,api,ok,grant,all,base,scope,create,classify,snapshot,observe,check,deny,reconnect,records,checks,close:async()=>{await env.gateway.close();await env.close();}};
}

test('ENT-108 BF-60 HTTP route new and replay current policy restart restore no external effect',async()=>{
 const f=await bf60Environment(),{env,api,ok,grant,create,classify,deny,all,base}=f,{execFileSync}=await import('node:child_process'),{mkdir,writeFile}=await import('node:fs/promises'),output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';
 try{
  const prior=await create('bf60-prior'),fresh=await create('bf60-fresh'),clean=await create('bf60-clean'),voted=await create('bf60-voted'),ready=await create('bf60-ready'),key=crypto.randomUUID();
  const first=await ok('operator','routeSet',prior,key);assert.deepEqual((await deny('normal replay',()=>api('operator','routeSet',prior,key),200)).body,first.body);
  await ok('operator','routeSet',ready);for(const who of ['manager','reviewer','publisher'])await ok(who,'vote',{id:ready.id,revision:1,decision:'APPROVE'});
  await classify(ready);await deny('classified worker dispatch',()=>api('manager','dispatch',{id:ready.id}));
  await ok('manager','vote',{id:voted.id,revision:1,decision:'APPROVE'});await grant();
  const schema=(await env.f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',env.cluster.config.host,'-p',String(env.cluster.config.port),'-U',env.cluster.config.user,'-d',env.cluster.config.database];
  const dump=name=>{const p=env.cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+p]);return p;},restore=async p=>{await env.f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+p],{stdio:'pipe'});};
  const pre=dump('BF60-pre'),preUser=f.users.operator;await classify(prior);const controlId=await classify(fresh);
  for(const op of ['get','history'])assert.equal((await api('operator',op,{id:fresh.id,purpose:'summary'})).status,403);
  // Preserve both old-code observations before asserting either rejection.
  const replay=await f.observe('classified replay',()=>api('operator','routeSet',prior,key));const added=await f.observe('classified fresh',()=>api('operator','routeSet',fresh));f.check(replay);f.check(added);
  const both=async(status=403,code='PERMISSION_DENIED')=>{await deny('route replay '+code,()=>api('operator','routeSet',prior,key),status,code);await deny('route fresh '+code,()=>api('operator','routeSet',fresh),status,code);};
  await f.reconnect();await both();await grant(all);assert.equal((await api('operator','get',{id:fresh.id,purpose:'summary'})).status,200);await both();
  const granted=dump('BF60-granted');await grant();await both();await restore(granted);await f.reconnect();assert.equal((await api('operator','get',{id:fresh.id,purpose:'summary'})).status,403);await both();
  await grant(base,[]);await both(404,'NOT_FOUND');await grant();await both();await grant(base,[f.scope],['read','search']);await both();await grant();
  for(const who of ['other','tenant2','reader'])await deny('foreign route '+who,()=>api(who,'routeSet',fresh),who==='reader'?403:404,who==='reader'?'PERMISSION_DENIED':'NOT_FOUND');
  await deny('purpose changes replay',()=>api('operator','routeSet',{...prior,purpose:'summary'},key),400,'IDEMPOTENCY_MISMATCH');await deny('purpose unsupported new',()=>api('operator','routeSet',{...fresh,purpose:'summary'}),400,'INVALID_ARGUMENT');
  const current=dump('BF60-current');await restore(pre);f.users.operator=preUser;await both(400,'RECOVERING');await restore(current);await f.reconnect();await both();
  assert.equal((await env.f.owner.query('DELETE FROM enterprise_controls WHERE id=$1',[controlId])).rowCount,1);await both(400,'RECOVERING');await restore(current);await f.reconnect();await both();
  // Untagged controls keep all prior ownership, route conflict and connection rules.
  await deny('non-requester',()=>api('manager','routeSet',clean));await deny('after vote',()=>api('operator','routeSet',voted));
  const connection={id:'local-mail',provider:'mail',secretRef:'local-secret',scope:f.scope,destination:'local-inbox',active:true};
  await ok('manager','connectionSet',{...connection,active:false});await deny('disabled connection',()=>api('operator','routeSet',clean));await ok('manager','connectionSet',connection);
  // Synthetic provisioning gives the connection administrator both scopes; route requests stay on the original scope.
  await env.f.owner.query('UPDATE enterprise_grants SET scopes=$1 WHERE principal=$2',[JSON.stringify([f.scope,{...f.scope,classification:'INTERNAL'}]),'manager']);
  await ok('manager','connectionSet',{...connection,scope:{...f.scope,classification:'INTERNAL'}});await deny('connection scope mismatch',()=>api('operator','routeSet',clean));await ok('manager','connectionSet',connection);
  await grant(base,[]);await deny('unclassified scope revoked',()=>api('operator','routeSet',clean),404,'NOT_FOUND');await grant();
  const cleanKey=crypto.randomUUID(),saved=await ok('operator','routeSet',clean,cleanKey);await deny('route conflict',()=>api('operator','routeSet',clean),400,'CONFLICT');await f.reconnect();assert.deepEqual((await deny('restarted legitimate replay',()=>api('operator','routeSet',clean,cleanKey),200)).body,saved.body);
  // Replay does not re-execute or repin the route after connection changes.
  await ok('manager','connectionSet',{...connection,active:false});assert.deepEqual((await deny('saved replay with revoked connection',()=>api('operator','routeSet',clean,cleanKey),200)).body,saved.body);
  assert.equal((await env.effects.requests()).length,0);assert.equal((await env.effects.ledger()).length,0);
 }finally{await mkdir(output,{recursive:true});await writeFile(output+'/BF60-contract.json',JSON.stringify({records:f.records,checks:f.checks},null,2)+'\n');await f.close();}
});

test('ENT-108 BF-60 browser actual route button denies current classification before route persistence',async()=>{
 const f=await bf60Environment(),{api,ok,grant,create,classify,env}=f,{browser}=await import('./browser-helper.mjs'),page=await browser(),{mkdir,writeFile}=await import('node:fs/promises'),output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser',result={};
 try{
  const b=await create('bf60-browser-classified'),normal=await create('bf60-browser-normal');await grant();
  await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]','operator');await page.click('button');await page.until('document.querySelectorAll("#cases button").length===2');
  const open=async id=>{await page.evaluate(`Array.from(document.querySelectorAll('#cases tr')).find(x=>x.textContent.includes(${JSON.stringify(id)})).querySelector('button').click()`);await page.until(`document.querySelector('#record').dataset.id===${JSON.stringify(id)} && document.querySelector('#connection').options.length>0`);};
  await open(normal.id);await page.evaluate(`window.bf60=[];const original=window.fetch;window.fetch=async(...args)=>{const r=await original(...args);if(args[0]==='/api')window.bf60.push({request:JSON.parse(args[1].body),status:r.status,body:await r.clone().json()});return r;};`);
  const click=async()=>{const n=await page.evaluate('window.bf60.length');await page.click('#route');await page.until(`window.bf60.slice(${n}).some(x=>x.request.operation==='routeSet')`);return page.evaluate(`window.bf60.slice(${n}).find(x=>x.request.operation==='routeSet')`);};
  assert.equal((await click()).status,200);await page.until(`document.querySelector('#message').textContent.includes('接続先を固定')`);await page.screenshot('BF60-authorized-route');
  await open(b.id);await classify(b);for(const op of ['get','history'])assert.equal((await api('operator',op,{id:b.id,purpose:'summary'})).status,403);
  const denied=await f.observe('actual button classified',click);await page.screenshot('BF60-classified-route');f.check(denied);
  await grant(f.all);assert.equal((await api('operator','get',{id:b.id,purpose:'summary'})).status,200);await f.deny('actual button full clearance',click);await page.screenshot('BF60-full-clearance');
  await grant(f.all,[]);await f.deny('actual button scope revoked',click,404,'NOT_FOUND');await page.screenshot('BF60-scope-revoked');await grant();await f.deny('actual button scope restored classified',click);
  assert.equal((await env.effects.requests()).length,0);assert.equal((await env.effects.ledger()).length,0);result.browser=await page.send('Browser.getVersion');
 }finally{result.records=await page.evaluate('window.bf60??[]');result.http=f.records;result.checks=f.checks;await mkdir(output,{recursive:true});await writeFile(output+'/BF60-browser.json',JSON.stringify(result,null,2)+'\n');await page.close();await f.close();}
});
