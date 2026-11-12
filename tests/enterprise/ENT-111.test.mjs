import {test as nodeTest} from 'node:test';import assert from 'node:assert/strict';import {execFileSync,spawn} from 'node:child_process';import {join} from 'node:path';import {mkdir,writeFile} from 'node:fs/promises';
import {withFixture,ready,restart} from './helpers.mjs';import {scope} from '../../scripts/enterprise/fixture.mjs';import {referenceEffects} from '../../scripts/enterprise/reference/effects.mjs';import {SyntheticPort} from '../../src/enterprise/worker.mjs';
const measurements=[];
async function loss(f,ids){const found=(await f.owner.query('SELECT id FROM objects WHERE id=ANY($1)',[ids])).rows.map(x=>x.id),missing=ids.filter(id=>!found.includes(id));assert.deepEqual(missing,[]);return {acknowledgedObjectIds:ids,missingAcknowledgedObjectIds:missing,rpoMissingAcknowledgedObjects:missing.length,rpoLossWindowMs:missing.length===0?0:null};}
async function artifact(){const path=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/B03-iteration-17';await mkdir(path,{recursive:true});await writeFile(path+'/recovery-measurements.json',JSON.stringify(measurements,null,2)+'\n');}
const child=(f,server,id)=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,['tests/enterprise/worker-child.mjs'],{stdio:['pipe','pipe','pipe']});let stderr='';p.stderr.on('data',x=>stderr+=x);p.on('error',reject);p.on('exit',code=>resolve({code,stderr}));const {host,port,user,database,options}=f.state.pool.options;p.stdin.end(JSON.stringify({config:{host,port,user,database,options},journal:f.journal.path,credential:f.credentials.manager,id,mode:'dispatch',url:server.url,crash:'enterprise-after-send'}));});
test('ENT-111 AC-01 positive persistence real schema restore includes workflow attachments approvals and independent external ledger',()=>withFixture(async(f,cluster)=>{
 const server=await referenceEffects(cluster),port=new SyntheticPort(server.url);try{
 const b=f.create();await f.call('operator','create',b);const attachment=await f.call('operator','attach',{id:b.id,content:'synthetic attachment'});for(const who of ['manager','reviewer','publisher'])await f.call(who,'vote',{id:b.id,revision:2,decision:'APPROVE'});
 const schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],path=join(cluster.directory,'enterprise.sql');execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);
 assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},port)).state,'SUCCEEDED');const start=performance.now();await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});restart(f);
 assert.equal((await f.call('operator','attachment',{id:b.id,hash:attachment.hash})).content,'synthetic attachment');const restored=await f.call('operator','get',{id:b.id});assert.equal(restored.workflow.votes.length,3);
 await assert.rejects(f.call('other','externalRestore',{id:b.id}),{code:'NOT_FOUND'});await f.call('manager','externalRestore',{id:b.id});assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'reconcile'},port)).state,'SUCCEEDED');assert.equal((await server.ledger())[0].applications,1);assert.equal(server.requests().filter(x=>x.method==='POST').length,1);
 measurements.push({fault:'schema-restore',rtoMs:performance.now()-start,...await loss(f,[b.id]),unresolved:(await f.call('manager','recoveryStatus')).unresolved,restoredVotes:3,externalApplications:1});await artifact();
 }finally{await server?.close();}
}));
test('ENT-111 AC-02 failure-recovery DB stop network response loss worker exit measured recovery',()=>withFixture(async(f,cluster)=>{
 let server,port;try{
 const b=await ready(f);const data=join(cluster.directory,'db');const poolErrors=[];for(const p of [f.owner,f.state.pool,cluster.admin])p.on('error',e=>poolErrors.push(e.code));const start=performance.now();execFileSync('pg_ctl',['-D',data,'-m','immediate','-w','stop']);await assert.rejects(f.call('operator','get',{id:b.id}));execFileSync('pg_ctl',['-D',data,'-l',join(cluster.directory,'postgres.log'),'-o',`-k ${cluster.config.host} -p ${cluster.config.port} -c listen_addresses=''`,'-w','start']);assert.equal((await f.call('operator','get',{id:b.id})).id,b.id);measurements.push({fault:'database-stop',rtoMs:performance.now()-start,...await loss(f,[b.id]),unresolved:(await f.call('manager','recoveryStatus')).unresolved,poolErrors});
 server=await referenceEffects(cluster);port=new SyntheticPort(server.url);const networkStart=performance.now();server.fault('lost-ack');assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},port)).state,'UNKNOWN');assert.equal((await f.call('manager','recoveryStatus')).unresolved,1);await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'reconcile'},port);measurements.push({fault:'response-loss',rtoMs:performance.now()-networkStart,...await loss(f,[b.id]),unresolved:(await f.call('manager','recoveryStatus')).unresolved});
 const next=await ready(f),workerStart=performance.now(),death=await child(f,server,next.id);assert.equal(death.code,73,death.stderr);restart(f);assert.equal((await f.call('manager','recoveryStatus')).unresolved,1);await f.kernel.enterpriseWork(f.credentials.manager,{id:next.id,mode:'reconcile'},port);measurements.push({fault:'worker-exit-after-send',rtoMs:performance.now()-workerStart,...await loss(f,[b.id,next.id]),unresolved:(await f.call('manager','recoveryStatus')).unresolved,workerExit:death.code});assert.ok((await server.ledger()).every(x=>x.applications===1));await artifact();
 }finally{await server?.close();}
}));
test('ENT-111 AC-03 negative-authorization restored erasures and revoked grants cannot resurrect access',()=>withFixture(async(f,cluster)=>{
 const b=f.create();await f.call('operator','create',b);const ref={id:b.id,documentId:'private',version:1};await f.call('operator','documentUpload',{id:b.id,documentId:'private',name:'synthetic.txt',mime:'text/plain',classification:'RESTRICTED',content:'synthetic private bytes',retainUntil:new Date(Date.now()+60000).toISOString()});
 const schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],path=join(cluster.directory,'before-revocation.sql');execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);
 await f.call('publisher','grant',{principal:'reader',scopes:[scope],operations:[],fields:[]});f.kernel.clock=()=>Date.now()+120000;await f.call('manager','documentDelete',ref);
 await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});restart(f);
 await assert.rejects(f.call('reader','get',{id:b.id}),{code:'PERMISSION_DENIED'});await assert.rejects(f.call('reader','authorityRestore',{}),{code:'PERMISSION_DENIED'});await assert.rejects(f.call('manager','documentRead',ref),{code:'RECOVERING'});await f.call('manager','documentRestore',{});await assert.rejects(f.call('manager','documentRead',ref),{code:'NOT_FOUND'});assert.equal((await f.owner.query('SELECT content FROM enterprise_documents')).rows[0].content,null);await assert.rejects(f.call('reader','get',{id:b.id}),{code:'PERMISSION_DENIED'});
},{documentScanner:async()=>true}));

function test(name,fn){const labels=['positive','negative-authorization','persistence','failure-recovery'].filter(x=>name.includes(x));return nodeTest(name,t=>{const run=(ctx,n)=>n===labels.length?fn(ctx):ctx.test(labels[n]+' '+name,child=>run(child,n+1));return run(t,0);});}
test('ENT-111 AC-03 failure-recovery legacy authority migration requires complete current history and logout stays revoked',()=>withFixture(async(f,cluster)=>{
 const {RecoveryJournal}=await import('../../src/adapters/journal.mjs');const b=f.create();await f.call('operator','create',b);const schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],before=join(cluster.directory,'legacy-before.sql'),current=join(cluster.directory,'legacy-current.sql');execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+before]);
 await f.call('publisher','grant',{principal:'reader',scopes:[scope],operations:[],fields:[]});
 const j=new RecoveryJournal(f.journal.path+'.legacy',{bootstrap:true});for(const {sequence,recordHash,previousHash,journalEpoch,...row} of f.journal.records())if(!['enterprise-grant','enterprise-authority-checkpoint'].includes(row.operationKind))j.append(row);f.journal=j;f.kernel.journal=j;
 execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+current]);const restore=async path=>{await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});};
 await restore(before);await assert.rejects(f.call('reader','get',{id:b.id}),{code:'RECOVERING'});await assert.rejects(f.call('publisher','authorityMigrate',{}),{code:'RECOVERING'});await restore(current);
 await assert.rejects(f.call('reader','authorityMigrate',{}),{code:'PERMISSION_DENIED'});
 await f.owner.query("UPDATE enterprise_grants SET scopes=$1 WHERE principal='publisher'",[JSON.stringify([scope,{...scope,departmentId:'synthetic-hr'}])]);
 f.kernel.fault=async point=>{if(point==='authority-migration-before-checkpoint')throw Error('migration interrupted');};await assert.rejects(f.call('publisher','authorityMigrate',{}),{code:'UNAVAILABLE'});await assert.rejects(f.call('operator','get',{id:b.id}),{code:'RECOVERING'});f.kernel.fault=async()=>{};await f.call('publisher','authorityMigrate',{});
 await restore(before);await assert.rejects(f.call('reader','get',{id:b.id}),{code:'PERMISSION_DENIED'});await f.call('manager','get',{id:b.id});
 // Restoring an unexpired session cannot undo the independent logout witness.
 await f.call('operator','logout',{});await restore(before);await assert.rejects(f.call('operator','get',{id:b.id}),{code:'PERMISSION_DENIED'});
}));

test('ENT-111 BF-12 aborted grant cannot resurrect revoked authority after rollback restart retry or backup restore',()=>withFixture(async(f,cluster)=>{
 const b=f.create();await f.call('operator','create',b);const deny={principal:'reader',scopes:[scope],operations:[],fields:[]},allow={...deny,operations:['read'],fields:['INTERNAL']};
 await f.call('publisher','grant',deny);await assert.rejects(f.call('reader','get',{id:b.id}),{code:'PERMISSION_DENIED'});
 const schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],path=join(cluster.directory,'revoked.sql');execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);
 const key=crypto.randomUUID();f.kernel.fault=async point=>{if(point==='enterprise-before-audit')throw Error('BF-12 audit rollback');};await assert.rejects(f.call('publisher','grant',allow,key),{code:'UNAVAILABLE'});f.kernel.fault=async()=>{};
 const aborted=f.journal.records().filter(x=>x.operationKind==='submission'&&x.idempotencyKey==='v2:'+key).at(-1);assert.equal(aborted.phase,'ABORTED');assert.equal((await f.owner.query('SELECT * FROM actions WHERE id=$1',[aborted.actionId])).rowCount,0);assert.deepEqual((await f.owner.query("SELECT operations FROM enterprise_grants WHERE principal='reader'")).rows[0].operations,[]);
 await assert.rejects(f.call('reader','get',{id:b.id}),{code:'PERMISSION_DENIED'});restart(f);await assert.rejects(f.call('reader','get',{id:b.id}),{code:'PERMISSION_DENIED'});
 await f.call('publisher','grant',allow,key);await f.call('reader','get',{id:b.id});await f.call('publisher','grant',deny);await assert.rejects(f.call('reader','get',{id:b.id}),{code:'PERMISSION_DENIED'});
 await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});restart(f);await assert.rejects(f.call('reader','get',{id:b.id}),{code:'PERMISSION_DENIED'});
}));

test('ENT-111 BF-12 process stop before grant commit stays fenced without independent commit evidence',()=>withFixture(async(f,cluster)=>{
 const b=f.create();await f.call('operator','create',b);const deny={principal:'reader',scopes:[scope],operations:[],fields:[]},allow={...deny,operations:['read','recovery'],fields:['INTERNAL']};await f.call('publisher','grant',deny);
 const key=crypto.randomUUID(),{host,port,user,database,options}=f.state.pool.options;
 const childCode=`import {PostgresState} from './src/adapters/postgres.mjs';import {RecoveryJournal} from './src/adapters/journal.mjs';import {Kernel} from './src/kernel.mjs';let data='';for await(const c of process.stdin)data+=c;const a=JSON.parse(data),s=new PostgresState(a.config),k=new Kernel(s,new RecoveryJournal(a.journal));k.fault=async p=>{if(p==='enterprise-before-audit')process.exit(74)};await k.enterprise(a.credential,a.request);process.exit(99);`;
 const death=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--input-type=module','-e',childCode],{stdio:['pipe','pipe','pipe']});let stderr='';p.stderr.on('data',x=>stderr+=x);p.on('error',reject);p.on('exit',code=>resolve({code,stderr}));p.stdin.end(JSON.stringify({config:{host,port,user,database,options},journal:f.journal.path,credential:f.credentials.publisher,request:{operation:'grant',body:allow,key}}));});assert.equal(death.code,74,death.stderr);
 const row=()=>f.journal.records().filter(x=>x.operationKind==='submission'&&x.idempotencyKey==='v2:'+key).at(-1);assert.equal(row().phase,'INTENT');assert.equal((await f.owner.query('SELECT * FROM actions WHERE id=$1',[row().actionId])).rowCount,0);restart(f);
 await assert.rejects(f.call('reader','get',{id:b.id}),{code:'RECOVERING'});await assert.rejects(f.kernel.enterpriseRecover(f.credentials.reader),{code:'PERMISSION_DENIED'});await assert.rejects(f.kernel.enterpriseRecover(f.credentials.manager),{code:'RECOVERING'});assert.equal(row().phase,'INTENT');restart(f);await assert.rejects(f.call('reader','get',{id:b.id}),{code:'RECOVERING'});await assert.rejects(f.call('publisher','grant',allow,key),{code:'RECOVERING'});
}));

test('ENT-111 BF-12 commit acknowledgement loss uses exact DB Action and retains same-key retry and later revocation',()=>withFixture(async f=>{
 const b=f.create();await f.call('operator','create',b);const deny={principal:'reader',scopes:[scope],operations:[],fields:[]},allow={...deny,operations:['read','recovery'],fields:['INTERNAL']};await f.call('publisher','grant',deny);
 const key=crypto.randomUUID(),row=()=>f.journal.records().filter(x=>x.operationKind==='submission'&&x.idempotencyKey==='v2:'+key).at(-1);
 f.kernel.fault=async point=>{if(point==='enterprise-after-commit')throw Error('BF-12 lost commit acknowledgement');};await assert.rejects(f.call('publisher','grant',allow,key),{code:'UNAVAILABLE'});assert.equal(row().phase,'INTENT');assert.equal((await f.owner.query('SELECT * FROM actions WHERE id=$1',[row().actionId])).rowCount,1);restart(f);
 await f.call('reader','get',{id:b.id});await assert.rejects(f.call('publisher','grant',allow,key),{code:'INCONSISTENT_STATE'});assert.equal((await f.kernel.enterpriseRecover(f.credentials.manager)).recovered.length,1);assert.equal(row().phase,'COMMITTED');await f.call('publisher','grant',allow,key);assert.equal((await f.owner.query('SELECT count(*)::int n FROM actions WHERE key=$1',['v2:'+key])).rows[0].n,1);
 await f.call('publisher','grant',deny);restart(f);await assert.rejects(f.call('reader','get',{id:b.id}),{code:'PERMISSION_DENIED'});
}));

test('ENT-111 BF-12 audit INSERT failure cannot turn an aborted grant into authority',()=>withFixture(async f=>{
 const b=f.create();await f.call('operator','create',b);await f.call('publisher','grant',{principal:'reader',scopes:[scope],operations:[],fields:[]});
 const key=crypto.randomUUID();await f.owner.query('REVOKE INSERT ON audit FROM foundation_app');try{await assert.rejects(f.call('publisher','grant',{principal:'reader',scopes:[scope],operations:['read'],fields:['INTERNAL']},key));}finally{await f.owner.query('GRANT INSERT ON audit TO foundation_app');}
 const row=f.journal.records().filter(x=>x.operationKind==='submission'&&x.idempotencyKey==='v2:'+key).at(-1);assert.equal(row.phase,'ABORTED');assert.equal((await f.owner.query('SELECT * FROM actions WHERE id=$1',[row.actionId])).rowCount,0);assert.deepEqual((await f.owner.query("SELECT operations FROM enterprise_grants WHERE principal='reader'")).rows[0].operations,[]);restart(f);await assert.rejects(f.call('reader','get',{id:b.id}),{code:'PERMISSION_DENIED'});
}));

test('ENT-111 BF-12 aborted migration checkpoint cannot enable access and migration retry commits a new checkpoint',()=>withFixture(async f=>{
 await f.owner.query("UPDATE enterprise_grants SET scopes=$1 WHERE principal='publisher'",[JSON.stringify([scope,{...scope,departmentId:'synthetic-hr'}])]);
 const key=crypto.randomUUID();f.kernel.fault=async point=>{if(point==='enterprise-before-audit')throw Error('migration checkpoint audit rollback');};await assert.rejects(f.call('publisher','authorityMigrate',{},key),{code:'UNAVAILABLE'});f.kernel.fault=async()=>{};
 const row=f.journal.records().filter(x=>x.operationKind==='submission'&&x.idempotencyKey==='v2:'+key).at(-1);assert.equal(row.phase,'ABORTED');assert.ok(f.journal.records().some(x=>x.operationKind==='enterprise-authority-checkpoint'&&x.actionId===row.actionId));restart(f);
 await assert.rejects(f.call('manager','authorityRestore',{}),{code:'RECOVERING'});await f.call('publisher','authorityMigrate',{},key);await f.call('manager','authorityRestore',{});assert.equal(f.journal.records().filter(x=>x.operationKind==='submission'&&x.idempotencyKey==='v2:'+key).at(-1).phase,'COMMITTED');
},{install:false}));

test('ENT-111 BF-12 restore after revocation commit acknowledgement loss cannot infer abort from an absent Action',()=>withFixture(async(f,cluster)=>{
 const b=f.create();await f.call('operator','create',b);await f.call('reader','get',{id:b.id});
 const schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],before=join(cluster.directory,'before-uncertain-revocation.sql'),current=join(cluster.directory,'committed-revocation.sql');
 execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+before]);
 const key=crypto.randomUUID(),deny={principal:'reader',scopes:[scope],operations:[],fields:[]};
 f.kernel.fault=async point=>{if(point==='enterprise-after-commit')throw Error('BF-12 revocation acknowledgement lost');};
 await assert.rejects(f.call('publisher','grant',deny,key),{code:'UNAVAILABLE'});
 const row=()=>f.journal.records().filter(x=>x.operationKind==='submission'&&x.idempotencyKey==='v2:'+key).at(-1);
 assert.equal(row().phase,'INTENT');assert.equal((await f.owner.query('SELECT * FROM actions WHERE id=$1',[row().actionId])).rowCount,1);
 assert.deepEqual((await f.owner.query("SELECT operations FROM enterprise_grants WHERE principal='reader'")).rows[0].operations,[]);
 execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+current]);
 const restore=async path=>{await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});restart(f);};
 const journalBefore=f.journal.records();await restore(before);assert.deepEqual(f.journal.records(),journalBefore);
 assert.equal((await f.owner.query('SELECT * FROM actions WHERE id=$1',[row().actionId])).rowCount,0);
 await assert.rejects(f.call('reader','get',{id:b.id}),{code:'RECOVERING'});
 await assert.rejects(f.kernel.enterpriseRecover(f.credentials.reader),{code:'PERMISSION_DENIED'});
 await assert.rejects(f.kernel.enterpriseRecover(f.credentials.manager),{code:'RECOVERING'});
 assert.equal(row().phase,'INTENT');assert.deepEqual(f.journal.records(),journalBefore);
 restart(f);await assert.rejects(f.call('reader','get',{id:b.id}),{code:'RECOVERING'});
 await assert.rejects(f.kernel.enterpriseRecover(f.credentials.manager),{code:'RECOVERING'});
 await assert.rejects(f.call('publisher','grant',deny,key),{code:'RECOVERING'});
 // A trusted complete DB containing the exact committed Action can resolve it.
 await restore(current);assert.equal((await f.kernel.enterpriseRecover(f.credentials.manager)).recovered.length,1);assert.equal(row().phase,'COMMITTED');
 await f.call('publisher','grant',deny,key);assert.equal((await f.owner.query('SELECT count(*)::int n FROM actions WHERE key=$1',['v2:'+key])).rows[0].n,1);
 await assert.rejects(f.call('reader','get',{id:b.id}),{code:'PERMISSION_DENIED'});
 await restore(before);await assert.rejects(f.call('reader','get',{id:b.id}),{code:'PERMISSION_DENIED'});
}));

async function bf46Environment(){
 const {localEnvironment}=await import('../../scripts/enterprise/local.mjs'),{login}=await import('./http-helper.mjs'),{operations}=await import('../../scripts/enterprise/fixture.mjs');
 const env=await localEnvironment(),records=[],checks=[],users={};for(const who of ['operator','manager','reviewer','publisher','other','tenant2'])users[who]=await login(env,who);
 const api=async(user,operation,body={})=>{const response=await user.api(operation,body),r={operation,request:body,status:response.status,body:await response.json()};records.push(r);return r;};
 const all=['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'],low=['PUBLIC','INTERNAL','CONFIDENTIAL'];
 const grant=async(fields=all,ops=operations,scopes=[scope])=>assert.equal((await api(users.publisher,'grant',{principal:'manager',fields,operations:ops,scopes})).status,200);
 const create=async()=>{const b=env.f.create();assert.equal((await api(users.operator,'create',b)).status,200);return b;};
 const waiting=await create(),unknown=await create(),compensating=await create();
 for(const b of [unknown,compensating])for(const who of ['manager','reviewer','publisher'])assert.equal((await api(users[who],'vote',{id:b.id,revision:1,decision:'APPROVE'})).status,200);
 env.effects.fault('lost-ack');assert.equal((await api(users.manager,'dispatch',{id:unknown.id})).body.result.state,'UNKNOWN');
 assert.equal((await api(users.manager,'dispatch',{id:compensating.id})).body.result.state,'SUCCEEDED');env.effects.fault('lost-ack');assert.equal((await api(users.manager,'compensate',{id:compensating.id})).body.result.state,'COMPENSATING');
 const cases=[waiting,unknown,compensating];
 const classify=async(b,purposes=['summary','disclosure'])=>{const id=crypto.randomUUID();assert.equal((await api(users.publisher,'informationCreate',{id,scope,source:{kind:'object',id:b.id,projection:['title']},label:'STRICT',purposes})).status,200);return id;};
 const snapshot=async()=>{const s={};for(const [table,order]of [['objects','id'],['enterprise_instances','id'],['history','object_id,revision'],['actions','id'],['outbox','operation_id']])s[table]=(await env.f.owner.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;s.journal=env.f.journal.records();s.requests=env.effects.requests();s.ledger=await env.effects.ledger();return s;};
 return {env,users,api,records,checks,all,low,grant,create,classify,snapshot,cases};
}

nodeTest('ENT-111 BF-46 HTTP recovery aggregates exclude currently protected cases across purpose revocation restart and restore',async()=>{
 const {env,users,api,records,checks,all,low,grant,create,classify,snapshot,cases}=await bf46Environment();
 const {login}=await import('./http-helper.mjs'),{enterpriseGateway}=await import('../../src/enterprise/gateway.mjs');
 const output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser',zero={instances:0,unresolved:0,waiting:0},full={instances:3,unresolved:2,waiting:1};
 try{
  const status=async(body={},expected=full,who='manager')=>{const before=await snapshot(),r=await api(users[who],'recoveryStatus',body),after=await snapshot();checks.push({name:'aggregate-state-preservation',before,r,after});assert.equal(r.status,200);assert.deepEqual(r.body.result,expected);assert.deepEqual(after,before);return r;};
  await status();const schema=(await env.f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',env.cluster.config.host,'-p',String(env.cluster.config.port),'-U',env.cluster.config.user,'-d',env.cluster.config.database];
  const dump=name=>{const path=join(env.cluster.directory,name+'.sql');execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};
  const restore=async path=>{await env.f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});};
  const reconnect=async()=>{await env.gateway.close();restart(env.f);env.gateway=await enterpriseGateway(env.f.kernel,{issuer:env.idp.issuer,port:new SyntheticPort(env.effects.url)});for(const who of Object.keys(users))users[who]=await login(env,who);};
  const oldUser=users.manager,beforeClassification=dump('before-classification');await grant(low);const classification=[];for(const b of cases)classification.push(await classify(b));
  for(const b of cases)for(const op of ['get','history'])assert.equal((await api(users.manager,op,{id:b.id,purpose:'summary'})).status,403);
  assert.deepEqual((await api(users.manager,'query',{packageId:cases[0].packageId,type:'Case',aggregate:true,purpose:'summary'})).body.result,{count:0});
  await status({},zero);await status({purpose:'summary'},zero);
  await grant(all);await status({},zero);await status({purpose:'other'},zero);await status({purpose:'summary'});await status({purpose:'disclosure'});
  for(const purpose of [null,1,'','x'.repeat(129)]){const r=await api(users.manager,'recoveryStatus',{purpose});assert.equal(r.status,400);assert.deepEqual(r.body,{error:{code:'INVALID_ARGUMENT'}});}
  assert.equal((await api(users.manager,'recoveryStatus',{extra:true})).status,400);
  await classify(cases[0],['disclosure']);await status({purpose:'summary'},{instances:2,unresolved:2,waiting:0});await status({purpose:'disclosure'});
  const visible=await create(),mixed={instances:4,unresolved:2,waiting:2},onlyVisible={instances:1,unresolved:0,waiting:1};await status({purpose:'disclosure'},mixed);
  const complete=dump('complete');await reconnect();await status({purpose:'disclosure'},mixed);await grant(low);await status({purpose:'disclosure'},onlyVisible);await reconnect();await status({purpose:'disclosure'},onlyVisible);
  await restore(complete);await reconnect();await status({purpose:'disclosure'},onlyVisible);await grant(all);await status({purpose:'disclosure'},mixed);const valid=dump('valid');
  await restore(beforeClassification);users.manager=oldUser;let r=await api(users.manager,'recoveryStatus',{purpose:'summary'});assert.deepEqual(r.body,{error:{code:'RECOVERING'}});assert.equal(r.status,400);await restore(valid);await reconnect();
  await env.f.owner.query('DELETE FROM enterprise_controls WHERE id=$1',[classification[0]]);r=await api(users.manager,'recoveryStatus',{purpose:'summary'});assert.deepEqual(r.body,{error:{code:'RECOVERING'}});assert.equal(r.status,400);await restore(valid);await reconnect();
  for(const who of ['other','tenant2'])await status({purpose:'disclosure'},zero,who);
  await grant(all,['read','search']);r=await api(users.manager,'recoveryStatus',{purpose:'disclosure'});assert.equal(r.status,403);assert.deepEqual(r.body,{error:{code:'PERMISSION_DENIED'}});await grant(all);
  await grant(all,undefined,[]);await status({purpose:'disclosure'},zero);await grant(all);await status({purpose:'disclosure'},mixed);
  // Reconciliation remains available to the authorized recovery operator.
  for(const b of cases.slice(1))assert.equal((await api(users.manager,'reconcile',{id:b.id,purpose:'disclosure'})).status,200);
  await status({purpose:'disclosure'},{instances:4,unresolved:0,waiting:2});
  checks.push({name:'reconciled-independent-effects',ledger:await env.effects.ledger(),requests:env.effects.requests(),visible:visible.id});assert.ok((await env.effects.ledger()).every(x=>x.applications===1));
 }finally{await mkdir(output,{recursive:true});await writeFile(output+'/BF46-contract.json',JSON.stringify({records,checks},null,2)+'\n');await env.gateway.close();await env.close();}
});

nodeTest('ENT-111 BF-46 authenticated browser public recovery aggregates honor current classification and purpose',async()=>{
 const {env,users,api,records,all,low,grant,classify,cases}=await bf46Environment();const {browser}=await import('./browser-helper.mjs');const page=await browser(),output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser',result={};
 try{
  await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]','manager');await page.click('button');await page.until('!!document.querySelector("#cases")');
  // Authenticated public API evidence, not a recovery-dashboard UI test.
  await page.evaluate(`window.bf46=[];window.recovery=async(body)=>{const session=await(await fetch('/session')).json();const response=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrf},body:JSON.stringify({contractVersion:'2.0.0',operation:'recoveryStatus',body})});const record={request:body,status:response.status,body:await response.json()};window.bf46.push(record);let output=document.querySelector('#bf46-result');if(!output){output=document.createElement('pre');output.id='bf46-result';document.body.prepend(output);}output.textContent=JSON.stringify(record,null,2);return record;};`);
  const full={instances:3,unresolved:2,waiting:1},zero={instances:0,unresolved:0,waiting:0},call=(body={})=>page.evaluate(`window.recovery(${JSON.stringify(body)})`);
  assert.deepEqual((await call()).body.result,full);await page.screenshot('BF46-unclassified');await grant(low);for(const b of cases)await classify(b,['summary']);
  for(const op of ['get','history'])assert.equal((await api(users.manager,op,{id:cases[0].id,purpose:'summary'})).status,403);
  const excluded=await call();await page.screenshot('BF46-classified');assert.deepEqual(excluded.body.result,zero);
  await grant(all);assert.deepEqual((await call({purpose:'summary'})).body.result,full);await page.screenshot('BF46-authorized');await grant(low);assert.deepEqual((await call({purpose:'summary'})).body.result,zero);await page.screenshot('BF46-revoked');result.browser=await page.send('Browser.getVersion');result.ledger=await env.effects.ledger();
 }finally{result.records=await page.evaluate('window.bf46??[]');result.setup=records;await mkdir(output,{recursive:true});await writeFile(output+'/BF46-browser.json',JSON.stringify(result,null,2)+'\n');await page.close();await env.close();}
});

async function bf47Environment(){
 const {localEnvironment}=await import('../../scripts/enterprise/local.mjs'),{login}=await import('./http-helper.mjs'),{operations}=await import('../../scripts/enterprise/fixture.mjs');
 const env=await localEnvironment(),records=[],checks=[],users={};for(const who of ['operator','manager','reviewer','publisher','other','tenant2'])users[who]=await login(env,who);
 const api=async(user,operation,body={},key=crypto.randomUUID())=>{const response=await user.api(operation,body,key),r={operation,request:body,key,status:response.status,body:await response.json()};records.push(r);return r;};
 const all=['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'],low=['PUBLIC','INTERNAL','CONFIDENTIAL'];
 const grant=async(fields=all,ops=operations,scopes=[scope],principal='manager')=>assert.equal((await api(users.publisher,'grant',{principal,fields,operations:ops,scopes})).status,200);
 // A new package isolates dynamic source classification from static field restrictions.
 const manifest=structuredClone(env.f.manifest);manifest.id='bf47-recovery';manifest.types.Case.memo.classification='CONFIDENTIAL';
 for(const [who,op,body]of [['manager','install',{manifest}],['reviewer','review',{id:manifest.id,version:manifest.version}],['publisher','publish',{id:manifest.id,version:manifest.version}]])assert.equal((await api(users[who],op,body)).status,200);
 const cases=[];for(let n=0;n<2;n++){const b=env.f.create({packageId:manifest.id});assert.equal((await api(users.operator,'create',b)).status,200);for(const who of ['manager','reviewer','publisher'])assert.equal((await api(users[who],'vote',{id:b.id,revision:1,decision:'APPROVE'})).status,200);assert.equal((await api(users.manager,'dispatch',{id:b.id})).body.result.state,'SUCCEEDED');cases.push(b);}
 const classify=async(b,purposes=['summary','disclosure'])=>{const id=crypto.randomUUID();assert.equal((await api(users.publisher,'informationCreate',{id,scope,source:{kind:'object',id:b.id,projection:['title']},label:'STRICT',purposes})).status,200);return id;};
 const snapshot=async()=>{const s={};for(const [table,order]of [['objects','id'],['enterprise_instances','id'],['history','object_id,revision'],['actions','id'],['outbox','operation_id']])s[table]=(await env.f.owner.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;s.requests=env.effects.requests();s.ledger=await env.effects.ledger();return s;};
 return {env,users,api,records,checks,all,low,grant,classify,snapshot,cases};
}

nodeTest('ENT-111 BF-47 HTTP external restore and replay enforce current source policy with recovery and rollback',async()=>{
 const {env,users,api,records,checks,all,low,grant,classify,snapshot,cases}=await bf47Environment();const [first,second]=cases;
 const {login}=await import('./http-helper.mjs'),{enterpriseGateway}=await import('../../src/enterprise/gateway.mjs');const output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';
 try{
  const call=(body,key,who='manager')=>api(users[who],'externalRestore',body,key),oldBody={id:first.id},oldKey=crypto.randomUUID();
  assert.equal((await call(oldBody,oldKey)).status,200);const beforeReplay=await snapshot();assert.equal((await call(oldBody,oldKey)).status,200);assert.deepEqual(await snapshot(),beforeReplay);assert.equal((await api(users.manager,'reconcile',oldBody)).body.result.state,'SUCCEEDED');
  const schema=(await env.f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',env.cluster.config.host,'-p',String(env.cluster.config.port),'-U',env.cluster.config.user,'-d',env.cluster.config.database];
  const dump=name=>{const path=join(env.cluster.directory,name+'.sql');execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};
  const restore=async path=>{await env.f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});};
  const reconnect=async()=>{await env.gateway.close();restart(env.f);env.gateway=await enterpriseGateway(env.f.kernel,{issuer:env.idp.issuer,port:new SyntheticPort(env.effects.url)});for(const who of Object.keys(users))users[who]=await login(env,who);};
  const oldUser=users.manager,beforeClassification=dump('bf47-before-classification'),classification=[];for(const b of cases)classification.push(await classify(b));await grant(low);
  for(const op of ['get','history'])assert.equal((await api(users.manager,op,{id:first.id,purpose:'summary'})).status,403);assert.deepEqual((await api(users.manager,'recoveryStatus',{purpose:'summary'})).body.result,{instances:0,unresolved:0,waiting:0});
  // Capture both counterexamples before asserting, including original Action/Outbox changes.
  const before=await snapshot(),fresh=await call({id:second.id}),replay=await call(oldBody,oldKey),after=await snapshot();checks.push({name:'classified-new-and-replay',before,fresh,replay,after});assert.equal(fresh.status,403);assert.equal(replay.status,403);assert.deepEqual(after,before);
  const denied=async(body,key,expected=403,code='PERMISSION_DENIED',who='manager')=>{const before=await snapshot(),r=await call(body,key,who),after=await snapshot();checks.push({name:'rejected-state-preservation',before,r,after});assert.equal(r.status,expected);assert.deepEqual(r.body,{error:{code}});assert.deepEqual(after,before);};
  await grant(all);await denied(oldBody,oldKey);await denied({id:second.id});await denied({id:second.id,purpose:'other'});
  for(const purpose of [null,1,'','x'.repeat(129)])await denied({id:first.id,purpose},undefined,400,'INVALID_ARGUMENT');await denied({id:first.id,purpose:'summary',extra:true},undefined,400,'INVALID_ARGUMENT');
  const body={id:first.id,purpose:'summary'},key=crypto.randomUUID();assert.equal((await call(body,key)).status,200);const stable=await snapshot();assert.equal((await call(body,key)).status,200);assert.deepEqual(await snapshot(),stable);await denied({...body,purpose:'disclosure'},key,400,'IDEMPOTENCY_MISMATCH');
  const complete=dump('bf47-before-revoke');await grant(low);await denied(body,key);await denied({id:second.id,purpose:'summary'});await reconnect();await denied(body,key);await restore(complete);await reconnect();await denied(body,key);await denied({id:second.id,purpose:'summary'});await grant(all);
  await classify(first,['disclosure']);await denied(body,key);await denied(body);const disclosure={id:first.id,purpose:'disclosure'},disclosureKey=crypto.randomUUID();assert.equal((await call(disclosure,disclosureKey)).status,200);assert.equal((await call(disclosure,disclosureKey)).status,200);
  for(const who of ['other','tenant2']){await denied(disclosure,undefined,404,'NOT_FOUND',who);await denied(disclosure,disclosureKey,404,'NOT_FOUND',who);}
  await grant(all,['read','search']);await denied(disclosure,disclosureKey);await denied(disclosure);await grant(['PUBLIC','INTERNAL','STRICT']);await denied(disclosure,disclosureKey);await denied(disclosure);await grant(all,undefined,[]);await denied(disclosure,disclosureKey,404,'NOT_FOUND');await denied(disclosure,undefined,404,'NOT_FOUND');await grant(all);
  const valid=dump('bf47-valid');await restore(beforeClassification);users.manager=oldUser;await denied(disclosure,disclosureKey,400,'RECOVERING');await denied(disclosure,undefined,400,'RECOVERING');await restore(valid);await reconnect();
  await env.f.owner.query('DELETE FROM enterprise_controls WHERE id=$1',[classification[0]]);await denied(disclosure,disclosureKey,400,'RECOVERING');await restore(valid);await reconnect();
  env.f.kernel.fault=async point=>{if(point==='enterprise-before-audit')throw Error('BF-47 restore audit rollback');};await denied({id:second.id,purpose:'summary'},undefined,400,'UNAVAILABLE');env.f.kernel.fault=async()=>{};
  await grant(low,undefined,[scope],'reviewer');const uncertainKey=crypto.randomUUID();env.f.kernel.fault=async point=>{if(point==='enterprise-after-commit')throw Error('BF-47 restore commit acknowledgement lost');};assert.equal((await call({id:second.id,purpose:'summary'},uncertainKey)).status,400);env.f.kernel.fault=async()=>{};
  const pending=env.f.journal.records(),pendingState=await snapshot();assert.equal((await api(users.reviewer,'recover')).status,403);assert.deepEqual(env.f.journal.records(),pending);assert.deepEqual(await snapshot(),pendingState);assert.equal((await api(users.manager,'recover')).status,200);assert.equal((await call({id:second.id,purpose:'summary'},uncertainKey)).status,200);
  // The applicant can lose authority without preventing a legitimate operator's reconciliation/compensation.
  await grant(low,['read','search'],[scope],'operator');assert.equal((await api(users.manager,'reconcile',{id:first.id,purpose:'disclosure'})).body.result.state,'SUCCEEDED');assert.equal((await api(users.manager,'compensate',{id:first.id,purpose:'disclosure'})).body.result.state,'COMPENSATED');
  const restoreKey=crypto.randomUUID();assert.equal((await call(disclosure,restoreKey)).status,200);assert.equal((await call(disclosure,restoreKey)).status,200);assert.equal((await api(users.manager,'reconcile',{id:first.id,purpose:'disclosure'})).body.result.state,'COMPENSATED');
  assert.equal((await call({id:second.id,purpose:'summary'})).status,200);assert.equal((await api(users.manager,'reconcile',{id:second.id,purpose:'summary'})).body.result.state,'SUCCEEDED');
  const ledger=await env.effects.ledger();checks.push({name:'authorized-recovery-after-applicant-revocation',ledger,requests:env.effects.requests()});assert.ok(ledger.every(x=>x.applications===1));assert.equal(ledger.reduce((n,x)=>n+x.reversals,0),1);
 }finally{await mkdir(output,{recursive:true});await writeFile(output+'/BF47-contract.json',JSON.stringify({records,checks},null,2)+'\n');await env.gateway.close();await env.close();}
});

nodeTest('ENT-111 BF-47 authenticated browser external restore and replay reject classified and revoked requests',async()=>{
 const {env,users,api,records,all,low,grant,classify,cases}=await bf47Environment();const {browser}=await import('./browser-helper.mjs');const page=await browser(),output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser',result={};
 try{
  await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]','manager');await page.click('button');await page.until('!!document.querySelector("#cases")');
  // Actual authenticated public API responses; this is not a recovery form test.
  await page.evaluate(`window.bf47=[];window.restoreCase=async(body,key)=>{const session=await(await fetch('/session')).json();const response=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrf},body:JSON.stringify({contractVersion:'2.0.0',operation:'externalRestore',body,key})});const record={request:body,key,status:response.status,body:await response.json()};window.bf47.push(record);let output=document.querySelector('#bf47-result');if(!output){output=document.createElement('pre');output.id='bf47-result';document.body.prepend(output);}output.textContent=JSON.stringify(record,null,2);return record;};`);
  const call=(body,key=crypto.randomUUID())=>page.evaluate(`window.restoreCase(${JSON.stringify(body)},${JSON.stringify(key)})`),body={id:cases[0].id},key=crypto.randomUUID();
  assert.equal((await call(body,key)).status,200);await page.screenshot('BF47-unclassified');await api(users.manager,'reconcile',body);for(const b of cases)await classify(b,['summary']);await grant(low);
  const fresh=await call({id:cases[1].id});await page.screenshot('BF47-classified-new');const replay=await call(body,key);await page.screenshot('BF47-classified-replay');assert.equal(fresh.status,403);assert.equal(replay.status,403);
  await grant(all);const allowed={...body,purpose:'summary'},allowedKey=crypto.randomUUID();assert.equal((await call(allowed,allowedKey)).status,200);await page.screenshot('BF47-authorized');await grant(low);assert.equal((await call(allowed,allowedKey)).status,403);await page.screenshot('BF47-revoked');result.browser=await page.send('Browser.getVersion');result.ledger=await env.effects.ledger();
 }finally{result.records=await page.evaluate('window.bf47??[]');result.setup=records;await mkdir(output,{recursive:true});await writeFile(output+'/BF47-browser.json',JSON.stringify(result,null,2)+'\n');await page.close();await env.close();}
});

nodeTest('ENT-111 BF-48 HTTP direct reconciliation and compensation enforce current operator policy before intent and I/O',async()=>{
 const {env,users,api,records,checks,all,low,grant,classify,snapshot,cases}=await bf47Environment();const [first,second]=cases,output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';
 const {login}=await import('./http-helper.mjs'),{enterpriseGateway}=await import('../../src/enterprise/gateway.mjs');
 try{
  assert.equal((await api(users.manager,'externalRestore',{id:first.id})).status,200);
  const schema=(await env.f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',env.cluster.config.host,'-p',String(env.cluster.config.port),'-U',env.cluster.config.user,'-d',env.cluster.config.database];
  const dump=name=>{const path=join(env.cluster.directory,name+'.sql');execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};
  const restore=async path=>{await env.f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});};
  const reconnect=async()=>{await env.gateway.close();restart(env.f);env.gateway=await enterpriseGateway(env.f.kernel,{issuer:env.idp.issuer,port:new SyntheticPort(env.effects.url)});for(const who of Object.keys(users))users[who]=await login(env,who);};
  const preclassification=dump('bf48-before'),oldUser=users.manager,classification=[];await grant(low);
  for(const b of cases){classification.push(await classify(b));for(const op of ['get','history'])assert.equal((await api(users.manager,op,{id:b.id,purpose:'summary'})).status,403);}
  const before=await snapshot(),responses=[];for(const [op,b]of [['reconcile',first],['compensate',second]])responses.push(await api(users.manager,op,{id:b.id}));checks.push({name:'classified-direct-counterexamples',before,after:await snapshot(),responses});
  for(const r of responses)assert.equal(r.status,403);assert.deepEqual(await snapshot(),before);
  const pairs=[['reconcile',first],['compensate',second]];
  const denied=async(purpose='summary',code='PERMISSION_DENIED',who='manager',extra={})=>{for(const [op,b]of pairs){const before=await snapshot(),journal=env.f.kernel.journal.records(),r=await api(users[who],op,{id:b.id,...(purpose===false?{}:{purpose}),...extra});checks.push({name:'direct-denial',operation:op,response:r,before,after:await snapshot()});assert.equal(r.status,code==='NOT_FOUND'?404:code==='PERMISSION_DENIED'?403:400);assert.equal(r.body.error.code,code);assert.deepEqual(await snapshot(),before);assert.deepEqual(env.f.kernel.journal.records(),journal);}};
  await denied();await grant(all);await denied(false);await denied('export');for(const purpose of [null,7,'','x'.repeat(129)])await denied(purpose,'INVALID_ARGUMENT');await denied('summary','INVALID_ARGUMENT','manager',{unexpected:true});
  await classify(first,['disclosure']);await classify(second,['disclosure']);await denied('summary');
  for(const who of ['other','tenant2'])await denied('disclosure','NOT_FOUND',who);
  await grant(all,undefined,[]);await denied('disclosure','NOT_FOUND');await grant(all,['read','search']);await denied('disclosure');await grant(['PUBLIC','INTERNAL','STRICT']);await denied('disclosure');await grant(all);
  const granted=dump('bf48-granted');await grant(low);await denied('disclosure');await reconnect();await denied('disclosure');await restore(granted);await reconnect();await denied('disclosure');await grant(all);const valid=dump('bf48-valid');
  await restore(preclassification);users.manager=oldUser;await denied('disclosure','RECOVERING');await restore(valid);await reconnect();await env.f.owner.query('DELETE FROM enterprise_controls WHERE id=$1',[classification[0]]);await denied('disclosure','RECOVERING');await restore(valid);await reconnect();
  // Owner-connection fault injection models policy storage changing after durable
  // intent. Public writers serialize through admission; these races deliberately
  // bypass that lock, and assert the injected DB mutation actually committed.
  for(const [op,b]of pairs){const requests=env.effects.requests(),ledger=await env.effects.ledger();let changed=false;env.f.kernel.fault=async point=>{if(point==='enterprise-before-send'&&!changed){const q=await env.f.owner.query("INSERT INTO enterprise_controls(tenant,id,kind,scope,revision,data,action_id) SELECT tenant,$1,kind,scope,revision,jsonb_set(data,'{purposes}','[\"summary\"]'::jsonb),action_id FROM enterprise_controls WHERE id=$2",[crypto.randomUUID(),classification[cases.indexOf(b)]]);assert.equal(q.rowCount,1);changed=true;}};const r=await api(users.manager,op,{id:b.id,purpose:'disclosure'});env.f.kernel.fault=async()=>{};assert.equal(changed,true,'late policy mutation committed');assert.equal(r.status,200);assert.equal(r.body.result.state,op==='reconcile'?'UNKNOWN':'COMPENSATING');assert.deepEqual(env.effects.requests(),requests);assert.deepEqual(await env.effects.ledger(),ledger);checks.push({name:'late-classification-stops-io',operation:op,response:r,requests,ledger});}
  // Independent policy journal retains the strengthened restrictions. Use a
  // separate case for late grant revocation and legitimate recovery.
  const fresh=env.f.create({packageId:'bf47-recovery'});assert.equal((await api(users.operator,'create',fresh)).status,200);for(const who of ['manager','reviewer','publisher'])assert.equal((await api(users[who],'vote',{id:fresh.id,revision:1,decision:'APPROVE'})).status,200);assert.equal((await api(users.manager,'dispatch',{id:fresh.id})).body.result.state,'SUCCEEDED');await classify(fresh,['summary']);
  for(const mode of ['compensate','reconcile']){await grant(all);let changed=false;const requests=env.effects.requests(),ledger=await env.effects.ledger();env.f.kernel.fault=async point=>{if(point==='enterprise-before-send'&&!changed){const q=await env.f.owner.query("UPDATE enterprise_grants SET fields=$1,revision=revision+1 WHERE principal='manager'",[JSON.stringify(low)]);assert.equal(q.rowCount,1);changed=true;}};const r=await api(users.manager,mode,{id:fresh.id,purpose:'summary'});env.f.kernel.fault=async()=>{};assert.equal(changed,true,'late policy mutation committed');assert.equal(r.status,200);assert.equal(r.body.result.state,'COMPENSATING');assert.deepEqual(env.effects.requests(),requests);assert.deepEqual(await env.effects.ledger(),ledger);checks.push({name:'late-revocation-stops-io',mode,response:r,requests,ledger});}
  await grant(all);await grant(low,['read','search'],[scope],'operator');await grant(low,['read','search'],[scope],'reviewer');assert.equal((await api(users.manager,'reconcile',{id:fresh.id,purpose:'summary'})).body.result.state,'SUCCEEDED');assert.equal((await api(users.manager,'compensate',{id:fresh.id,purpose:'summary'})).body.result.state,'COMPENSATED');assert.ok((await env.effects.ledger()).every(x=>x.applications===1));checks.push({name:'authorized-after-applicant-and-reviewer-revocation',ledger:await env.effects.ledger()});
 }finally{env.f.kernel.fault=async()=>{};await mkdir(output,{recursive:true});await writeFile(output+'/BF48-contract.json',JSON.stringify({records,checks},null,2)+'\n');await env.gateway.close();await env.close();}
});

nodeTest('ENT-111 BF-48 authenticated browser direct recovery rejects classified operators',async()=>{
 const {env,users,api,records,all,low,grant,classify,cases}=await bf47Environment(),{browser}=await import('./browser-helper.mjs');const page=await browser(),output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser',result={};
 try{
  await api(users.manager,'externalRestore',{id:cases[0].id});await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]','manager');await page.click('button');await page.until('!!document.querySelector("#cases")');
  await page.evaluate(`window.bf48=[];window.recoveryRequest=async(operation,body)=>{const session=await(await fetch('/session')).json(),response=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrf},body:JSON.stringify({contractVersion:'2.0.0',operation,body,key:crypto.randomUUID()})});const r={operation,request:body,status:response.status,body:await response.json()};window.bf48.push(r);let out=document.querySelector('#bf48-result');if(!out){out=document.createElement('pre');out.id='bf48-result';document.body.prepend(out);}out.textContent=JSON.stringify(r,null,2);return r;};`);
  const call=(op,b,purpose)=>page.evaluate(`window.recoveryRequest(${JSON.stringify(op)},${JSON.stringify({id:b.id,...(purpose?{purpose}:{})})})`);
  for(const b of cases)await classify(b,['summary']);await grant(low);
  const a=await call('reconcile',cases[0]);await page.screenshot('BF48-classified-reconcile');const b=await call('compensate',cases[1]);await page.screenshot('BF48-classified-compensate');assert.equal(a.status,403);assert.equal(b.status,403);
  await grant(all);assert.equal((await call('reconcile',cases[0],'summary')).status,200);await page.screenshot('BF48-authorized-reconcile');assert.equal((await call('compensate',cases[1],'summary')).status,200);await page.screenshot('BF48-authorized-compensate');await api(users.manager,'externalRestore',{id:cases[0].id,purpose:'summary'});await grant(low);assert.equal((await call('reconcile',cases[0],'summary')).status,403);await page.screenshot('BF48-revoked');result.browser=await page.send('Browser.getVersion');result.ledger=await env.effects.ledger();
 }finally{result.records=await page.evaluate('window.bf48??[]');result.setup=records;await mkdir(output,{recursive:true});await writeFile(output+'/BF48-browser.json',JSON.stringify(result,null,2)+'\n');await page.close();await env.close();}
});

nodeTest('ENT-111 BF-48 portal recovery buttons send purpose and enforce current source clearance',async()=>{
 const {localEnvironment}=await import('../../scripts/enterprise/local.mjs'),{login}=await import('./http-helper.mjs'),{browser}=await import('./browser-helper.mjs'),{operations}=await import('../../scripts/enterprise/fixture.mjs');const env=await localEnvironment(),page=await browser(),output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser',result={};
 try{
  const users={};for(const who of ['operator','manager','reviewer','publisher'])users[who]=await login(env,who);
  const manifest=structuredClone(env.f.manifest);manifest.version='1.1.0';manifest.types.Case.memo.classification='CONFIDENTIAL';
  for(const [who,op,body]of [['manager','install',{manifest}],['reviewer','review',{id:manifest.id,version:manifest.version}],['publisher','publish',{id:manifest.id,version:manifest.version}]])assert.equal((await users[who].api(op,body)).status,200);
  const b=env.f.create();assert.equal((await users.operator.api('create',b)).status,200);for(const who of ['manager','reviewer','publisher'])assert.equal((await users[who].api('vote',{id:b.id,revision:1,decision:'APPROVE'})).status,200);env.effects.fault('lost-ack');assert.equal((await(await users.manager.api('dispatch',{id:b.id})).json()).result.state,'UNKNOWN');
  await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]','manager');await page.click('button');await page.until('document.querySelectorAll("#cases button").length===1');await page.click('#cases button');await page.until('document.querySelector("#record").dataset.state==="UNKNOWN"');
  await page.evaluate(`window.bf48ui=[];const originalFetch=window.fetch;window.fetch=async(...args)=>{const r=await originalFetch(...args);if(args[0]==='/api')window.bf48ui.push({request:JSON.parse(args[1].body),status:r.status,body:await r.clone().json()});return r;}`);
  const click=async op=>{const n=await page.evaluate('window.bf48ui.length');await page.evaluate('document.querySelector("#message").textContent=""');await page.click('[data-operation="'+op+'"]');await page.until(`window.bf48ui.slice(${n}).some(x=>x.request.operation===${JSON.stringify(op)})`);await page.until('document.querySelector("#message").textContent.length>0');return page.evaluate(`window.bf48ui.slice(${n}).find(x=>x.request.operation===${JSON.stringify(op)})`);};
  const grant=async fields=>assert.equal((await users.publisher.api('grant',{principal:'manager',fields,operations,scopes:[scope]})).status,200),all=['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'],low=['PUBLIC','INTERNAL','CONFIDENTIAL'];
  await grant(low);assert.equal((await users.manager.api('get',{id:b.id,purpose:'summary'})).status,200);assert.equal((await users.publisher.api('informationCreate',{id:crypto.randomUUID(),scope,source:{kind:'object',id:b.id,projection:['title']},label:'STRICT',purposes:['summary']})).status,200);
  let r=await click('reconcile');assert.equal(r.status,403);assert.equal(r.request.body.purpose,'summary');await page.screenshot('BF48-ui-reconcile-denied');await grant(all);assert.equal((await click('reconcile')).status,200);await page.until('document.querySelector("#record").dataset.state==="SUCCEEDED"');await page.screenshot('BF48-ui-reconciled');
  await grant(low);r=await click('compensate');assert.equal(r.status,403);assert.equal(r.request.body.purpose,'summary');await page.screenshot('BF48-ui-compensate-denied');await grant(all);assert.equal((await click('compensate')).status,200);await page.until('document.querySelector("#record").dataset.state==="COMPENSATED"');await page.screenshot('BF48-ui-compensated');result.browser=await page.send('Browser.getVersion');result.ledger=await env.effects.ledger();assert.equal(result.ledger[0].applications,1);assert.equal(result.ledger[0].reversals,1);
 }finally{result.records=await page.evaluate('window.bf48ui??[]');await mkdir(output,{recursive:true});await writeFile(output+'/BF48-ui.json',JSON.stringify(result,null,2)+'\n');await page.close();await env.close();}
});

async function bf49Environment(){
 const f=await bf47Environment(),{env,users,api,cases}=f;
 assert.equal((await api(users.manager,'compensate',{id:cases[1].id})).body.result.state,'COMPENSATED');
 const states=[{...cases[0],state:'SUCCEEDED'},{...cases[1],state:'COMPENSATED'}];
 for(const state of ['WAITING_APPROVAL','READY','UNKNOWN','COMPENSATING']){
  const b=env.f.create({packageId:'bf47-recovery'});assert.equal((await api(users.operator,'create',b)).status,200);
  if(state!=='WAITING_APPROVAL')for(const who of ['manager','reviewer','publisher'])assert.equal((await api(users[who],'vote',{id:b.id,revision:1,decision:'APPROVE'})).status,200);
  if(state==='UNKNOWN'){env.effects.fault('lost-ack');assert.equal((await api(users.manager,'dispatch',{id:b.id})).body.result.state,state);}
  if(state==='COMPENSATING'){assert.equal((await api(users.manager,'dispatch',{id:b.id})).body.result.state,'SUCCEEDED');env.effects.fault('lost-ack');assert.equal((await api(users.manager,'compensate',{id:b.id})).body.result.state,state);}
  states.push({...b,state});
 }
 for(const b of states)assert.equal((await api(users.manager,'get',{id:b.id})).body.result.workflow.state,b.state);
 return {...f,states};
}

nodeTest('ENT-111 BF-49 HTTP protected recovery errors do not reveal state across classification purpose revocation restart and restore',async()=>{
 const {env,users,api,records,checks,states,all,low,grant,classify,snapshot}=await bf49Environment(),output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';
 const {login}=await import('./http-helper.mjs'),{enterpriseGateway}=await import('../../src/enterprise/gateway.mjs');
 try{
  const schema=(await env.f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',env.cluster.config.host,'-p',String(env.cluster.config.port),'-U',env.cluster.config.user,'-d',env.cluster.config.database];
  const dump=name=>{const path=join(env.cluster.directory,name+'.sql');execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};
  const restore=async path=>{await env.f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});};
  const reconnect=async()=>{await env.gateway.close();restart(env.f);env.gateway=await enterpriseGateway(env.f.kernel,{issuer:env.idp.issuer,port:new SyntheticPort(env.effects.url)});for(const who of Object.keys(users))users[who]=await login(env,who);};
  const beforeClassification=dump('bf49-before-classification'),oldUser=users.manager;await grant(low);const classifications=[];for(const b of states)classifications.push(await classify(b,['summary']));
  for(const b of states)for(const op of ['get','history'])assert.equal((await api(users.manager,op,{id:b.id,purpose:'summary'})).status,403);
  const denied=async(name,{purpose='summary',code='PERMISSION_DENIED',who='manager'}={})=>{
   const before=await snapshot(),journal=env.f.kernel.journal.records(),responses=[];
   for(const b of states)for(const op of ['reconcile','compensate'])responses.push({state:b.state,...await api(users[who],op,{id:b.id,...(purpose===null?{}:{purpose})})});
   const after=await snapshot();checks.push({name,before,after,responses});assert.deepEqual(after,before);assert.deepEqual(env.f.kernel.journal.records(),journal);
   for(const r of responses){assert.equal(r.status,code==='NOT_FOUND'?404:code==='PERMISSION_DENIED'?403:400,`${name} ${r.state} ${r.operation}`);assert.deepEqual(r.body,{error:{code}});}
  };
  await denied('classification-strengthened');await grant(all);await denied('purpose-omitted',{purpose:null});await denied('purpose-not-permitted',{purpose:'export'});
  // Visible subjects retain state validation; invalid operations do not mutate.
  const before=await snapshot();for(const b of states)for(const op of ['reconcile','compensate'])if(op==='reconcile'?!['UNKNOWN','COMPENSATING'].includes(b.state):b.state!=='SUCCEEDED'){const r=await api(users.manager,op,{id:b.id,purpose:'summary'});assert.equal(r.status,400);assert.equal(r.body.error.code,'INVALID_STATE');}assert.deepEqual(await snapshot(),before);
  for(const who of ['other','tenant2'])await denied('scope-'+who,{code:'NOT_FOUND',who});await grant(all,undefined,[]);await denied('no-scope',{code:'NOT_FOUND'});await grant(all,['read','search']);await denied('no-recovery-operation');await grant(['PUBLIC','INTERNAL','STRICT']);await denied('static-field-denied');await grant(all);
  const granted=dump('bf49-before-revoke');await grant(low);await denied('revoked');await reconnect();await denied('restarted');await restore(granted);await reconnect();await denied('restored-before-revocation');await grant(all);const valid=dump('bf49-valid');
  await restore(beforeClassification);users.manager=oldUser;await denied('restored-before-classification',{code:'RECOVERING'});await restore(valid);await reconnect();await env.f.owner.query('DELETE FROM enterprise_controls WHERE id=$1',[classifications[0]]);await denied('missing-classification',{code:'RECOVERING'});await restore(valid);await reconnect();
  await grant(low,['read','search'],[scope],'operator');await grant(low,['read','search'],[scope],'reviewer');
  for(const b of states.filter(x=>['UNKNOWN','COMPENSATING'].includes(x.state))){const r=await api(users.manager,'reconcile',{id:b.id,purpose:'summary'});assert.equal(r.status,200);assert.equal(r.body.result.state,b.state==='UNKNOWN'?'SUCCEEDED':'COMPENSATED');}
  assert.equal((await api(users.manager,'compensate',{id:states[0].id,purpose:'summary'})).body.result.state,'COMPENSATED');assert.ok((await env.effects.ledger()).every(x=>x.applications===1));checks.push({name:'legitimate-recovery-after-applicant-reviewer-revocation',ledger:await env.effects.ledger()});
 }finally{await mkdir(output,{recursive:true});await writeFile(output+'/BF49-contract.json',JSON.stringify({states:states.map(({id,state})=>({id,state})),records,checks},null,2)+'\n');await env.gateway.close();await env.close();}
});

nodeTest('ENT-111 BF-49 authenticated browser recovery response is uniform for protected state matrix',async()=>{
 const {env,users,api,records,states,all,low,grant,classify}=await bf49Environment(),{browser}=await import('./browser-helper.mjs'),page=await browser(),output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser',result={};
 try{
  await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]','manager');await page.click('button');await page.until('!!document.querySelector("#cases")');
  for(const b of states)await classify(b,['summary']);await grant(low);
  await page.evaluate(`window.bf49=[];window.probeRecovery=async(operation,body,state)=>{const session=await(await fetch('/session')).json(),response=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrf},body:JSON.stringify({contractVersion:'2.0.0',operation,body,key:crypto.randomUUID()})});const r={state,operation,request:body,status:response.status,body:await response.json()};window.bf49.push(r);let out=document.querySelector('#bf49-result');if(!out){out=document.createElement('pre');out.id='bf49-result';document.body.prepend(out);}out.textContent=JSON.stringify(window.bf49,null,2);return r;};`);
  const responses=[];for(const b of states)for(const op of ['reconcile','compensate'])responses.push(await page.evaluate(`window.probeRecovery(${JSON.stringify(op)},${JSON.stringify({id:b.id,purpose:'summary'})},${JSON.stringify(b.state)})`));await page.screenshot('BF49-protected-matrix');for(const r of responses){assert.equal(r.status,403);assert.deepEqual(r.body,{error:{code:'PERMISSION_DENIED'}});}
  await grant(all);const invalid=await page.evaluate(`window.probeRecovery('reconcile',${JSON.stringify({id:states[0].id,purpose:'summary'})},'SUCCEEDED')`);assert.equal(invalid.status,400);assert.equal(invalid.body.error.code,'INVALID_STATE');await page.screenshot('BF49-authorized-invalid-state');
  const unknown=states.find(x=>x.state==='UNKNOWN');const allowed=await page.evaluate(`window.probeRecovery('reconcile',${JSON.stringify({id:unknown.id,purpose:'summary'})},'UNKNOWN')`);assert.equal(allowed.status,200);assert.equal(allowed.body.result.state,'SUCCEEDED');await page.screenshot('BF49-authorized-reconciled');result.browser=await page.send('Browser.getVersion');result.ledger=await env.effects.ledger();
 }finally{result.records=await page.evaluate('window.bf49??[]');result.setup=records;await mkdir(output,{recursive:true});await writeFile(output+'/BF49-browser.json',JSON.stringify(result,null,2)+'\n');await page.close();await env.close();}
});

nodeTest('ENT-111 BF-50 HTTP dispatch authorization precedes state and journal checks across classification revocation restart and restore',async()=>{
 const {env,users,api,records,checks,states,all,low,grant,classify,snapshot}=await bf49Environment(),output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';
 const {login}=await import('./http-helper.mjs'),{enterpriseGateway}=await import('../../src/enterprise/gateway.mjs');
 try{
  // Untagged contracts: terminal replay is inert, invalid states stay invalid,
  // and a separately approved READY object still executes exactly once.
  const before=await snapshot(),journal=env.f.kernel.journal.records();
  for(const b of states.filter(x=>x.state!=='READY')){const r=await api(users.manager,'dispatch',{id:b.id});if(['SUCCEEDED','COMPENSATED'].includes(b.state)){assert.equal(r.status,200);assert.deepEqual(r.body.result,{id:b.id,state:b.state});}else{assert.equal(r.status,400);assert.deepEqual(r.body,{error:{code:'INVALID_STATE'}});}}
  assert.deepEqual(await snapshot(),before);assert.deepEqual(env.f.kernel.journal.records(),journal);
  const createReady=async()=>{const b=env.f.create({packageId:'bf47-recovery'});assert.equal((await api(users.operator,'create',b)).status,200);for(const who of ['manager','reviewer','publisher'])assert.equal((await api(users[who],'vote',{id:b.id,revision:1,decision:'APPROVE'})).status,200);return b;};
  const normal=await createReady();assert.equal((await api(users.manager,'dispatch',{id:normal.id})).body.result.state,'SUCCEEDED');const completed=await snapshot();assert.equal((await api(users.manager,'dispatch',{id:normal.id})).body.result.state,'SUCCEEDED');assert.deepEqual(await snapshot(),completed);
  const matrix=async(name,code='PERMISSION_DENIED',who='manager',assertResponse=true)=>{
   const before=await snapshot(),journal=env.f.kernel.journal.records(),responses=[];for(const b of states)responses.push({state:b.state,...await api(users[who],'dispatch',{id:b.id})});const after=await snapshot();checks.push({name,before,after,responses});assert.deepEqual(after,before);assert.deepEqual(env.f.kernel.journal.records(),journal);
   if(assertResponse)for(const r of responses){assert.equal(r.status,code==='NOT_FOUND'?404:code==='PERMISSION_DENIED'?403:400,`${name} ${r.state}`);assert.deepEqual(r.body,{error:{code}});}return responses;
  };
  await grant(['PUBLIC','INTERNAL']);const staticResponses=await matrix('untagged-static-field-denial','PERMISSION_DENIED','manager',false);await grant(all);
  const schema=(await env.f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',env.cluster.config.host,'-p',String(env.cluster.config.port),'-U',env.cluster.config.user,'-d',env.cluster.config.database];
  const dump=name=>{const path=join(env.cluster.directory,name+'.sql');execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};
  const restore=async path=>{await env.f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});};
  const reconnect=async()=>{await env.gateway.close();restart(env.f);env.gateway=await enterpriseGateway(env.f.kernel,{issuer:env.idp.issuer,port:new SyntheticPort(env.effects.url)});for(const who of Object.keys(users))users[who]=await login(env,who);};
  const preclassification=dump('bf50-before-classification'),oldUser=users.manager,classifications=[];await grant(low);for(const b of states)classifications.push(await classify(b,['summary']));
  for(const b of states)for(const op of ['get','history'])assert.equal((await api(users.manager,op,{id:b.id,purpose:'summary'})).status,403);
  await matrix('classification-strengthened');for(const r of staticResponses){assert.equal(r.status,403);assert.deepEqual(r.body,{error:{code:'PERMISSION_DENIED'}});}
  // Dispatch remains forbidden for all classified roots, even to a reader with
  // full clearance. No purpose parameter silently broadens the dispatch contract.
  await grant(all);for(const b of states)assert.equal((await api(users.manager,'get',{id:b.id,purpose:'summary'})).status,200);await matrix('full-clearance-still-cannot-dispatch');
  assert.deepEqual((await api(users.manager,'dispatch',{id:states[0].id,purpose:'summary'})).body,{error:{code:'INVALID_ARGUMENT'}});
  for(const who of ['other','tenant2'])await matrix('scope-'+who,'NOT_FOUND',who);await grant(all,undefined,[]);await matrix('no-scope','NOT_FOUND');await grant(all,['read','search']);await matrix('no-worker-operation');await grant(all);
  const granted=dump('bf50-before-revoke');await grant(low);await matrix('revoked');await reconnect();await matrix('restarted');await restore(granted);await reconnect();await matrix('restored-before-revocation');await grant(all);const valid=dump('bf50-valid');
  await restore(preclassification);users.manager=oldUser;await matrix('restored-before-classification','RECOVERING');await restore(valid);await reconnect();await env.f.owner.query('DELETE FROM enterprise_controls WHERE id=$1',[classifications[0]]);await matrix('missing-classification','RECOVERING');await restore(valid);await reconnect();
  // Explicit owner-DB fault injection bypasses admission after intent. Assert
  // the committed policy change, no external I/O, and durable uncertainty.
  const late=await createReady(),requests=env.effects.requests(),ledger=await env.effects.ledger();let changed=false;
  env.f.kernel.fault=async point=>{if(point==='enterprise-before-send'&&!changed){const q=await env.f.owner.query("INSERT INTO enterprise_controls(tenant,id,kind,scope,revision,data,action_id) SELECT tenant,$1,kind,scope,revision,jsonb_set(data,'{sources}', $2::jsonb),action_id FROM enterprise_controls WHERE id=$3",[crypto.randomUUID(),JSON.stringify([{kind:'object',id:late.id,projection:['title']}]),classifications[0]]);assert.equal(q.rowCount,1);changed=true;}};
  const uncertain=await api(users.manager,'dispatch',{id:late.id});env.f.kernel.fault=async()=>{};assert.equal(changed,true);assert.equal(uncertain.status,200);assert.equal(uncertain.body.result.state,'UNKNOWN');assert.deepEqual(env.effects.requests(),requests);assert.deepEqual(await env.effects.ledger(),ledger);checks.push({name:'committed-late-classification-stops-io',response:uncertain,requests,ledger});
  await grant(low,['read','search'],[scope],'operator');await grant(low,['read','search'],[scope],'reviewer');for(const b of states.filter(x=>['UNKNOWN','COMPENSATING'].includes(x.state)))assert.equal((await api(users.manager,'reconcile',{id:b.id,purpose:'summary'})).body.result.state,b.state==='UNKNOWN'?'SUCCEEDED':'COMPENSATED');assert.equal((await api(users.manager,'compensate',{id:states[0].id,purpose:'summary'})).body.result.state,'COMPENSATED');assert.ok((await env.effects.ledger()).every(x=>x.applications===1));checks.push({name:'legitimate-recovery-after-revocation',ledger:await env.effects.ledger()});
 }finally{env.f.kernel.fault=async()=>{};await mkdir(output,{recursive:true});await writeFile(output+'/BF50-contract.json',JSON.stringify({states:states.map(({id,state})=>({id,state})),records,checks},null,2)+'\n');await env.gateway.close();await env.close();}
});

nodeTest('ENT-111 BF-50 authenticated browser dispatch errors are uniform for all protected states',async()=>{
 const {env,users,api,records,states,all,low,grant,classify}=await bf49Environment(),{browser}=await import('./browser-helper.mjs'),page=await browser(),output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser',result={};
 try{
  await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]','manager');await page.click('button');await page.until('!!document.querySelector("#cases")');
  await page.evaluate(`window.bf50=[];window.probeDispatch=async(body,state)=>{const session=await(await fetch('/session')).json(),response=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrf},body:JSON.stringify({contractVersion:'2.0.0',operation:'dispatch',body,key:crypto.randomUUID()})});const r={state,request:body,status:response.status,body:await response.json()};window.bf50.push(r);let out=document.querySelector('#bf50-result');if(!out){out=document.createElement('pre');out.id='bf50-result';document.body.prepend(out);}out.textContent=JSON.stringify(window.bf50,null,2);return r;};`);
  const call=b=>page.evaluate(`window.probeDispatch(${JSON.stringify({id:b.id})},${JSON.stringify(b.state)})`);
  assert.equal((await call(states[0])).status,200);const invalid=await call(states.find(x=>x.state==='UNKNOWN'));assert.equal(invalid.status,400);assert.equal(invalid.body.error.code,'INVALID_STATE');await page.screenshot('BF50-unclassified-controls');
  for(const b of states)await classify(b,['summary']);await grant(low);const denied=[];for(const b of states)denied.push(await call(b));await page.screenshot('BF50-protected-matrix');for(const r of denied){assert.equal(r.status,403);assert.deepEqual(r.body,{error:{code:'PERMISSION_DENIED'}});}
  await grant(all);for(const b of states){assert.equal((await api(users.manager,'get',{id:b.id,purpose:'summary'})).status,200);assert.equal((await call(b)).status,403);}await page.screenshot('BF50-full-clearance-still-denied');result.browser=await page.send('Browser.getVersion');result.ledger=await env.effects.ledger();
 }finally{result.records=await page.evaluate('window.bf50??[]');result.setup=records;await mkdir(output,{recursive:true});await writeFile(output+'/BF50-browser.json',JSON.stringify(result,null,2)+'\n');await page.close();await env.close();}
});
