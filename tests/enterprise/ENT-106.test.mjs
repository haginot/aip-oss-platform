import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withFixture} from './helpers.mjs';
import {localEnvironment} from '../../scripts/enterprise/local.mjs';
import {mkdir,writeFile,readFile,rename} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

test('ENT-106 browser documents quarantine hold permissions audit and selectable connector',async()=>{
 const env=await localEnvironment({governance:true});try{const {governanceBrowser}=await import('./governance-browser.mjs');const result=await governanceBrowser(env),output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';await mkdir(output,{recursive:true});await writeFile(output+'/governance-browser.json',JSON.stringify(result,null,2)+'\n');}finally{await env.close();}
});

test('ENT-106 AC-01 positive negative-authorization document surfaces use object and field authorization',async t=>t.test('positive ENT-106 executable contract scenario',async t=>t.test('negative-authorization ENT-106 executable contract scenario',()=>withFixture(async f=>{
 const b=f.create();await f.call('operator','create',b);
 const upload={id:b.id,documentId:'doc',name:'synthetic.txt',mime:'text/plain',classification:'RESTRICTED',content:'synthetic confidential content',retainUntil:new Date(Date.now()+60000).toISOString()};
 assert.equal((await f.call('operator','documentUpload',upload)).state,'CLEAN');
 for(const mode of ['download','preview','export']){
  assert.equal((await f.call('manager','documentRead',{id:b.id,documentId:'doc',version:1,mode})).content,upload.content);
  await assert.rejects(f.call('reader','documentRead',{id:b.id,documentId:'doc',version:1,mode}),{code:'PERMISSION_DENIED'});
  await assert.rejects(f.call('other','documentRead',{id:b.id,documentId:'doc',version:1,mode}),{code:'NOT_FOUND'});
 }
 assert.equal((await f.call('reader','documentSearch',{id:b.id,text:'confidential'})).items.length,0);
 assert.equal((await f.call('manager','documentSearch',{id:b.id,text:'confidential'})).items.length,1);
 assert.equal(JSON.stringify((await f.owner.query('SELECT request FROM actions')).rows).includes(upload.content),false);
},{documentScanner:async()=>true}))));

test('ENT-106 AC-02 persistence failure-recovery quarantine version provenance MIME and size',async t=>t.test('persistence ENT-106 executable contract scenario',async t=>t.test('failure-recovery ENT-106 executable contract scenario',()=>withFixture(async f=>{
 const b=f.create();await f.call('operator','create',b);
 const upload={id:b.id,documentId:'doc',name:'synthetic.txt',mime:'text/plain',classification:'RESTRICTED',content:'clean',retainUntil:new Date(Date.now()+60000).toISOString()};
 const first=await f.call('operator','documentUpload',upload);
 f.kernel.documentScanner=async()=>{throw Error('scanner unavailable');};
 const second=await f.call('operator','documentUpload',{...upload,content:'unscanned'});assert.equal(second.state,'QUARANTINED');assert.equal(second.version,2);
 await assert.rejects(f.call('manager','documentRead',{id:b.id,documentId:'doc',version:2}),{code:'NOT_FOUND'});
 const rows=(await f.owner.query('SELECT * FROM enterprise_documents ORDER BY version')).rows;assert.equal(rows[1].provenance.previousHash,first.hash);assert.equal(rows[0].provenance.subject,'operator');
 for(const invalid of [{mime:'application/javascript'},{content:'x'.repeat(65537)}])await assert.rejects(f.call('operator','documentUpload',{...upload,...invalid}),{code:'INVALID_ARGUMENT'});
},{documentScanner:async()=>true}))));

test('ENT-106 AC-03 retention legal hold erasure survives restored document bytes',async()=>withFixture(async f=>{
 const b=f.create();await f.call('operator','create',b);const ref={id:b.id,documentId:'doc',version:1};
 await f.call('operator','documentUpload',{id:b.id,documentId:'doc',name:'synthetic.txt',mime:'text/plain',classification:'RESTRICTED',content:'backup content',retainUntil:new Date(Date.now()+60000).toISOString()});
 await assert.rejects(f.call('manager','documentDelete',ref),{code:'PERMISSION_DENIED'});
 f.kernel.clock=()=>Date.now()+120000;
 await f.call('manager','documentHold',{...ref,hold:true});await assert.rejects(f.call('manager','documentDelete',ref),{code:'PERMISSION_DENIED'});
 await f.call('manager','documentHold',{...ref,hold:false});await f.call('manager','documentDelete',ref);
 await f.owner.query("UPDATE enterprise_documents SET content=$1,state='CLEAN'",[Buffer.from('backup content')]);
 await assert.rejects(f.call('manager','documentRead',ref),{code:'NOT_FOUND'});
 assert.equal((await f.call('manager','documentRestore',{})).erased,1);
 assert.equal((await f.owner.query('SELECT content FROM enterprise_documents')).rows[0].content,null);
},{documentScanner:async()=>true}));

test('ENT-106 replay rechecks current field and object permissions',()=>withFixture(async f=>{
 const b=f.create();await f.call('operator','create',b);const upload={id:b.id,documentId:'replay-doc',name:'synthetic.txt',mime:'text/plain',classification:'RESTRICTED',content:'private text',retainUntil:new Date(Date.now()+60000).toISOString()},key=crypto.randomUUID();
 await f.call('operator','documentUpload',upload,key);
 await f.call('publisher','grant',{principal:'operator',scopes:[b.scope],operations:['action','read'],fields:['INTERNAL']});
 await assert.rejects(f.call('operator','documentUpload',upload,key),{code:'PERMISSION_DENIED'});
 const hold={id:b.id,documentId:'replay-doc',version:1,hold:true},holdKey=crypto.randomUUID();await f.call('manager','documentHold',hold,holdKey);
 await f.call('publisher','grant',{principal:'manager',scopes:[b.scope],operations:['records'],fields:['INTERNAL']});await assert.rejects(f.call('manager','documentHold',hold,holdKey),{code:'PERMISSION_DENIED'});
},{documentScanner:async()=>true}));


test('ENT-106 BF-11 real PostgreSQL backup restore loses tombstones and remains closed until journal reconciliation',()=>withFixture(async(f,cluster)=>{
 const b=f.create();await f.call('operator','create',b);
 const ref={id:b.id,documentId:'backup-doc',version:1};
 await f.call('operator','documentUpload',{id:b.id,documentId:ref.documentId,name:'backup.txt',mime:'text/plain',classification:'RESTRICTED',content:'synthetic backup secret',retainUntil:new Date(Date.now()+60000).toISOString()});
 const schema=(await f.owner.query('SELECT current_schema() AS name')).rows[0].name;
 const args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database];
 const backup=cluster.directory+'/before-erasure.sql';
 execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+backup],{timeout:30000});
 const staleJournal=await readFile(f.journal.path);
 f.kernel.clock=()=>Date.now()+120000;
 await f.call('manager','documentDelete',ref);
 const trustedJournal=await readFile(f.journal.path),trustedHead=await readFile(f.journal.headPath);
 await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);
 execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+backup],{timeout:30000,stdio:'pipe'});
 assert.equal((await f.owner.query('SELECT count(*) FROM enterprise_erasure')).rows[0].count,'0');
 assert.equal((await f.owner.query('SELECT content FROM enterprise_documents')).rows[0].content.toString(),'synthetic backup secret');
 const closed=async()=>{
  for(const mode of ['download','preview','export'])await assert.rejects(f.call('manager','documentRead',{...ref,mode}),{code:'RECOVERING'});
  await assert.rejects(f.call('manager','documentSearch',{id:b.id,text:'secret'}),{code:'RECOVERING'});
 };
 await closed();
 // The witness is outside the restored PostgreSQL snapshot. Never rebuild it from the restored DB.
 for(const corrupt of ['missing','tampered','stale','missing-head']){
  if(corrupt==='missing')await rename(f.journal.path,f.journal.path+'.saved');
  if(corrupt==='tampered')await writeFile(f.journal.path,Buffer.from(trustedJournal.toString().replace('backup-doc','tamper-doc')));
  if(corrupt==='stale')await writeFile(f.journal.path,staleJournal);
  if(corrupt==='missing-head')await rename(f.journal.headPath,f.journal.headPath+'.saved');
  await closed();
  await assert.rejects(f.call('manager','documentRestore',{}));
  if(corrupt==='missing')await rename(f.journal.path+'.saved',f.journal.path);
  if(corrupt==='missing-head')await rename(f.journal.headPath+'.saved',f.journal.headPath);
  await writeFile(f.journal.path,trustedJournal);await writeFile(f.journal.headPath,trustedHead);
 }
 // A different department cannot clear this tenant's recovery barrier.
 assert.equal((await f.call('other','documentRestore',{})).erased,0);await closed();
 let interrupted=false;f.kernel.fault=async point=>{if(point==='document-restore-after-erasure'){interrupted=true;throw Error('restore interrupted');}};
 await assert.rejects(f.call('manager','documentRestore',{}),{code:'UNAVAILABLE'});assert.equal(interrupted,true);
 assert.equal((await f.owner.query('SELECT count(*) FROM enterprise_erasure')).rows[0].count,'0');await closed();
 f.kernel.fault=async()=>{};
 assert.equal((await f.call('manager','documentRestore',{})).erased,1);
 assert.equal((await f.owner.query('SELECT content FROM enterprise_documents')).rows[0].content,null);
 assert.equal((await f.owner.query('SELECT count(*) FROM enterprise_erasure')).rows[0].count,'1');
 for(const mode of ['download','preview','export'])await assert.rejects(f.call('manager','documentRead',{...ref,mode}),{code:'NOT_FOUND'});
 assert.equal((await f.call('manager','documentSearch',{id:b.id})).items.length,0);
 assert.equal((await f.call('manager','documentRestore',{})).erased,1);
},{documentScanner:async()=>true}));

test('ENT-106 BF-11 durable erasure intent survives deletion transaction rollback',()=>withFixture(async f=>{
 const b=f.create();await f.call('operator','create',b);const ref={id:b.id,documentId:'interrupted-delete',version:1};
 await f.call('operator','documentUpload',{id:b.id,documentId:ref.documentId,name:'delete.txt',mime:'text/plain',classification:'RESTRICTED',content:'synthetic content',retainUntil:new Date(Date.now()+60000).toISOString()});
 f.kernel.clock=()=>Date.now()+120000;
 f.kernel.fault=async point=>{if(point==='enterprise-before-audit')throw Error('audit unavailable');};
 await assert.rejects(f.call('manager','documentDelete',ref),{code:'UNAVAILABLE'});
 f.kernel.fault=async()=>{};
 assert.equal((await f.owner.query('SELECT count(*) FROM enterprise_erasure')).rows[0].count,'0');
 await assert.rejects(f.call('manager','documentRead',ref),{code:'RECOVERING'});
 assert.equal((await f.call('manager','documentRestore',{})).erased,1);
 assert.equal((await f.owner.query('SELECT content FROM enterprise_documents')).rows[0].content,null);
 // A snapshot older than the document can also consume the intent, without fabricating a document.
 await f.owner.query('DELETE FROM enterprise_documents');await f.owner.query('DELETE FROM enterprise_erasure');
 assert.equal((await f.call('manager','documentRestore',{})).erased,0);
 assert.equal((await f.owner.query('SELECT count(*) FROM enterprise_erasure')).rows[0].count,'1');
 assert.equal((await f.call('manager','documentSearch',{id:b.id})).items.length,0);
},{documentScanner:async()=>true}));

// Create the pre-checkpoint journal format while preserving every original submission.
// This fixture transformation precedes migration; restored DB tombstones are never injected.
async function legacyJournal(f){
 const {RecoveryJournal}=await import('../../src/adapters/journal.mjs');
 const rows=f.journal.records().filter(r=>!['document-erasure','document-erasure-checkpoint'].includes(r.operationKind));
 const path=f.journal.path+'.legacy-'+crypto.randomUUID(),j=new RecoveryJournal(path,{bootstrap:true});
 for(const {sequence,previousHash,recordHash,journalEpoch,...row} of rows)j.append(row);
 f.journal=j;f.kernel.journal=j;
}
test('ENT-106 BF-11 legacy migration rejects incomplete history and restores legacy deletions',()=>withFixture(async(f,cluster)=>{
 const b=f.create();await f.call('operator','create',b);const ref={id:b.id,documentId:'legacy-doc',version:1};
 await f.call('operator','documentUpload',{id:b.id,documentId:ref.documentId,name:'legacy.txt',mime:'text/plain',classification:'RESTRICTED',content:'legacy synthetic secret',retainUntil:new Date(Date.now()+60000).toISOString()});
 const schema=(await f.owner.query('SELECT current_schema() AS name')).rows[0].name;
 const args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database];
 const before=cluster.directory+'/legacy-before.sql',current=cluster.directory+'/legacy-current.sql';
 execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+before]);
 f.kernel.clock=()=>Date.now()+120000;await f.call('manager','documentDelete',ref);
 await legacyJournal(f);
 execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+current]);
 const restore=async path=>{await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});};
 const closed=async()=>{for(const mode of ['download','preview','export'])await assert.rejects(f.call('manager','documentRead',{...ref,mode}),{code:'RECOVERING'});await assert.rejects(f.call('manager','documentSearch',{id:b.id}),{code:'RECOVERING'});};
 await restore(before);await closed();
 await assert.rejects(f.call('manager','documentRestore',{}),{code:'RECOVERING'});
 await assert.rejects(f.call('manager','documentMigrate',{}),{code:'RECOVERING'});
 assert.equal(f.journal.records().some(r=>r.operationKind==='document-erasure-checkpoint'),false);
 await restore(current);
 const priorMigration=(await f.owner.query("SELECT request FROM actions WHERE request->>'operation'='documentMigrate' AND actor='manager'")).rows[0];
 if(priorMigration)await assert.rejects(f.call('manager','documentMigrate',{},priorMigration.request.key),{code:'RECOVERING'});
 await assert.rejects(f.call('reader','documentMigrate',{}),{code:'PERMISSION_DENIED'});
 await assert.rejects(f.call('other','documentMigrate',{}),{code:'PERMISSION_DENIED'});
 await f.call('publisher','grant',{principal:'manager',scopes:[b.scope],operations:['read','search','records'],fields:['INTERNAL']});
 await assert.rejects(f.call('manager','documentMigrate',{}),{code:'PERMISSION_DENIED'});
 await f.call('publisher','grant',{principal:'manager',scopes:[b.scope],operations:['read','search','records'],fields:['INTERNAL','CONFIDENTIAL','RESTRICTED']});
 // Refresh the authoritative dump after these committed grant operations.
 execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+current]);
 await rename(f.journal.path,f.journal.path+'.saved');
 await assert.rejects(f.call('manager','documentMigrate',{}));await closed();
 await rename(f.journal.path+'.saved',f.journal.path);
 // Missing source tombstones cannot be treated as an empty, completed migration.
 const removed=await f.owner.query('DELETE FROM enterprise_erasure RETURNING *');
 await assert.rejects(f.call('manager','documentMigrate',{}),{code:'RECOVERING'});
 assert.equal(removed.rowCount,1);await restore(current);
 f.kernel.fault=async point=>{if(point==='document-migration-before-checkpoint')throw Error('migration interrupted');};
 await assert.rejects(f.call('manager','documentMigrate',{}),{code:'UNAVAILABLE'});
 assert.equal(f.journal.records().some(r=>r.operationKind==='document-erasure-checkpoint'),false);
 await restore(before);await closed();await assert.rejects(f.call('manager','documentMigrate',{}),{code:'RECOVERING'});
 await restore(current);f.kernel.fault=async()=>{};
 assert.equal((await f.call('manager','documentMigrate',{})).state,'MIGRATED');
 assert.equal(f.journal.records().filter(r=>r.operationKind==='document-erasure').length,1);
 await restore(before);assert.equal((await f.owner.query('SELECT count(*) FROM enterprise_erasure')).rows[0].count,'0');await closed();
 assert.equal((await f.call('manager','documentRestore',{})).erased,1);
 assert.equal((await f.owner.query('SELECT content FROM enterprise_documents')).rows[0].content,null);
 await assert.rejects(f.call('manager','documentRead',ref),{code:'NOT_FOUND'});
 assert.equal((await f.call('manager','documentSearch',{id:b.id})).items.length,0);
},{documentScanner:async()=>true}));

// BF-54 uses real uploads and public classification; saved Actions are never seeded.
async function bf54Environment(){
 const {login}=await import('./http-helper.mjs'),{restart}=await import('./helpers.mjs'),{scope}=await import('../../scripts/enterprise/fixture.mjs');
 const env=await localEnvironment(),users={},records=[],checks=[];
 const api=async(who,operation,body={},key=crypto.randomUUID())=>{const user=users[who]??=await login(env,who),r=await user.api(operation,body,key),x={actor:who,request:{operation,body,key},status:r.status,body:await r.json()};records.push(x);return x;};
 const stable=async()=>{const x={};for(const [table,order]of [['objects','id'],['enterprise_instances','id'],['history','object_id,revision'],['actions','id'],['enterprise_documents','tenant,id,version'],['enterprise_erasure','tenant,id,version'],['outbox','operation_id']])x[table]=(await env.f.owner.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;return {...x,journal:env.f.kernel.journal.records(),requests:await env.effects.requests(),ledger:await env.effects.ledger()};};
 const unchanged=async(label,fn)=>{const before=await stable(),r=await fn(),after=await stable();checks.push({label,before,after});assert.deepEqual(after,before,label);return r;};
 const base=['PUBLIC','INTERNAL','CONFIDENTIAL'],all=[...base,'STRICT','RESTRICTED'];
 const grant=async(fields=base,scopes=[scope],operations=['read','search','action'])=>{const r=await api('publisher','grant',{principal:'operator',scopes,operations,fields});assert.equal(r.status,200,JSON.stringify(r));};
 const classify=async(b)=>{const id=crypto.randomUUID(),r=await api('publisher','informationCreate',{id,scope,source:{kind:'document',id:b.documentId,objectId:b.id,version:1},label:'STRICT',purposes:['summary']});assert.equal(r.status,200,JSON.stringify(r));return id;};
 const reconnect=async()=>{const {enterpriseGateway}=await import('../../src/enterprise/gateway.mjs');const scanner=env.f.kernel.documentScanner;await env.gateway.close();restart(env.f);env.f.kernel.documentScanner=scanner;env.gateway=await enterpriseGateway(env.f.kernel,{issuer:env.idp.issuer});for(const key of Object.keys(users))delete users[key];};
 const create=async()=>{await grant(all);const b=env.f.create();assert.equal((await api('operator','create',b)).status,200);await grant();const body={id:b.id,documentId:crypto.randomUUID(),name:'BF54-synthetic.txt',mime:'text/plain',classification:'CONFIDENTIAL',content:'synthetic BF-54 document',retainUntil:new Date(Date.now()+3600000).toISOString()},key=crypto.randomUUID(),first=await api('operator','documentUpload',body,key);assert.equal(first.status,200);assert.equal(first.body.result.state,'CLEAN');return {body,key,first};};
 return {env,users,scope,records,checks,api,unchanged,base,all,grant,classify,reconnect,create,async close(){await env.gateway.close();await env.close();}};
}

test('ENT-106 BF-54 document upload replay HTTP current policy scope revoke restart restore and immutable versions',async()=>{
 const f=await bf54Environment(),{env,api,unchanged,grant,base,all,classify,reconnect}=f,output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';
 try{
  const {body,key,first}=await f.create(),ref={id:body.id,documentId:body.documentId,version:1};
  const replay=async(code=null)=>{const r=await unchanged('documentUpload replay '+(code??'allowed'),()=>api('operator','documentUpload',body,key));assert.equal(r.status,code==='NOT_FOUND'?404:code==='PERMISSION_DENIED'?403:code?400:200,JSON.stringify(r));assert.deepEqual(r.body,code?{error:{code}}:first.body);return r;};
  await replay();const second=await api('operator','documentUpload',{...body,content:'synthetic second version'});assert.equal(second.body.result.version,2);await replay();
  const schema=(await env.f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',env.cluster.config.host,'-p',String(env.cluster.config.port),'-U',env.cluster.config.user,'-d',env.cluster.config.database];
  const dump=name=>{const path=env.cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};
  const restore=async path=>{await env.f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});};
  const preclassification=dump('BF54-preclassification'),snapshotOperator=f.users.operator,controlId=await classify(body);
  for(const mode of ['download','preview','export'])assert.equal((await api('operator','documentRead',{...ref,mode,purpose:'summary'})).status,403);
  assert.deepEqual((await api('operator','documentSearch',{id:body.id,purpose:'summary'})).body.result,{items:[]});
  // Prior code returns saved metadata although reading and searching both deny it.
  await replay('PERMISSION_DENIED');await reconnect();await replay('PERMISSION_DENIED');
  await grant(all);assert.equal((await api('operator','documentRead',{...ref,purpose:'summary'})).status,200);assert.equal((await api('operator','documentSearch',{id:body.id,purpose:'summary'})).body.result.items.length,2);await replay('PERMISSION_DENIED');
  const granted=dump('BF54-granted');await grant(base);await replay('PERMISSION_DENIED');await restore(granted);await reconnect();assert.equal((await api('operator','documentRead',{...ref,purpose:'summary'})).status,403);await replay('PERMISSION_DENIED');
  await grant(base,[]);await replay('NOT_FOUND');await grant();await replay('PERMISSION_DENIED');
  await grant(base,[f.scope],['read','search']);await replay('PERMISSION_DENIED');await grant();
  for(const who of ['other','tenant2','reader']){const r=await api(who,'documentUpload',body,key);assert.equal(r.status,who==='reader'?403:404);assert.ok(!r.body.result);}
  for(const change of [{content:'different content'},{purpose:'summary'}]){const r=await unchanged('changed request',()=>api('operator','documentUpload',{...body,...change},key));assert.equal(r.status,400);assert.equal(r.body.error.code,'IDEMPOTENCY_MISMATCH');}
  const invalid=await api('operator','documentUpload',{...body,purpose:'summary'});assert.equal(invalid.body.error.code,'INVALID_ARGUMENT');
  const current=dump('BF54-current');await restore(preclassification);f.users.operator=snapshotOperator;await replay('RECOVERING');await restore(current);await reconnect();await replay('PERMISSION_DENIED');
  assert.equal((await env.f.owner.query('DELETE FROM enterprise_controls WHERE id=$1',[controlId])).rowCount,1);await replay('RECOVERING');await restore(current);await reconnect();
  // A separate unclassified document retains static permission recovery and idempotency.
  const clean=await f.create(),cleanReplay=async code=>{const r=await unchanged('unclassified replay '+(code??'allowed'),()=>api('operator','documentUpload',clean.body,clean.key));assert.deepEqual(r.body,code?{error:{code}}:clean.first.body);assert.equal(r.status,code?403:200);};
  await grant(base.filter(x=>x!=='CONFIDENTIAL'));await cleanReplay('PERMISSION_DENIED');await grant();await cleanReplay();await reconnect();await cleanReplay();
  assert.equal((await env.f.owner.query('SELECT * FROM enterprise_documents')).rows.length,3);assert.equal((await env.effects.requests()).length,0);assert.equal((await env.effects.ledger()).length,0);
 }finally{await mkdir(output,{recursive:true});await writeFile(output+'/BF54-contract.json',JSON.stringify({records:f.records,checks:f.checks},null,2)+'\n');await f.close();}
});

test('ENT-106 BF-54 browser document upload replay denies current classification even with full clearance',async()=>{
 const f=await bf54Environment(),{env,api,grant,classify,all,unchanged}=f,{browser}=await import('./browser-helper.mjs'),page=await browser(),output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';let result={};
 try{
  const {body,key,first}=await f.create();
  await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]','operator');await page.click('button');await page.until('document.querySelector("#workspace")?.hidden===false');
  await page.evaluate('window.bf54=[];const display=document.createElement("pre");display.id="bf54";document.body.prepend(display)');
  const replay=()=>unchanged('browser document replay',()=>page.evaluate(`(async()=>{const s=await(await fetch('/session')).json();const request=${JSON.stringify({contractVersion:'2.0.0',operation:'documentUpload',body,key})};const r=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrf},body:JSON.stringify(request)});const x={request,status:r.status,body:await r.json()};window.bf54.push(x);document.querySelector('#bf54').textContent=JSON.stringify(window.bf54,null,2);return x;})()`));
  assert.deepEqual((await replay()).body,first.body);await page.screenshot('BF54-authorized-replay');
  await classify(body);assert.equal((await api('operator','documentRead',{id:body.id,documentId:body.documentId,version:1,purpose:'summary'})).status,403);assert.deepEqual((await api('operator','documentSearch',{id:body.id,purpose:'summary'})).body.result,{items:[]});
  const denied=await replay();await page.screenshot('BF54-classified-replay');assert.equal(denied.status,403);assert.deepEqual(denied.body,{error:{code:'PERMISSION_DENIED'}});
  await grant(all);assert.equal((await api('operator','documentRead',{id:body.id,documentId:body.documentId,version:1,purpose:'summary'})).status,200);assert.equal((await replay()).status,403);await page.screenshot('BF54-full-clearance-denied');
  await grant(all,[]);assert.equal((await replay()).status,404);await page.screenshot('BF54-scope-revoked');result.browser=await page.send('Browser.getVersion');
 }finally{result.records=await page.evaluate('window.bf54??[]');result.http=f.records;result.checks=f.checks;await mkdir(output,{recursive:true});await writeFile(output+'/BF54-browser.json',JSON.stringify(result,null,2)+'\n');await page.close();await f.close();}
});

// BF-55: new keys must not bypass the policy protecting an existing document.
async function bf55Checks(f){
 let scans=0;const scanner=f.env.f.kernel.documentScanner;f.env.f.kernel.documentScanner=async(...args)=>{scans++;return scanner(...args);};
 const stable=async()=>{const x={};for(const [table,order]of [['objects','id'],['enterprise_instances','id'],['history','object_id,revision'],['actions','id'],['enterprise_documents','tenant,id,version'],['enterprise_erasure','tenant,id,version'],['outbox','operation_id']])x[table]=(await f.env.f.owner.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;return {...x,scans,requests:await f.env.effects.requests(),ledger:await f.env.effects.ledger()};};
 const checks=[];
 const denied=async(label,fn,status=403,code='PERMISSION_DENIED')=>{const before=await stable(),journalBefore=f.env.f.kernel.journal.records(),r=await fn(),after=await stable(),journalAfter=f.env.f.kernel.journal.records();checks.push({label,response:r,before,after,journalBefore,journalAfter});assert.equal(r.status,status,JSON.stringify(r));assert.deepEqual(r.body,{error:{code}});assert.deepEqual(after,before,label);assert.deepEqual(journalAfter.slice(0,journalBefore.length),journalBefore);const appended=journalAfter.slice(journalBefore.length);assert.ok(appended.length===0||appended.length===2);if(appended.length){assert.deepEqual(appended.map(x=>x.phase),['INTENT','ABORTED']);assert.equal(appended[0].operationId,appended[1].operationId);}return r;};
 return {stable,denied,checks};
}

test('ENT-106 BF-55 new-key document version HTTP current policy scanner boundary restart restore',async()=>{
 const f=await bf54Environment(),{env,api,grant,base,all,classify,reconnect}=f,c=await bf55Checks(f),output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';
 try{
  const {body,key,first}=await f.create(),ref={id:body.id,documentId:body.documentId,version:1};
  const second=await api('operator','documentUpload',{...body,content:'BF55 authorized version two'});assert.equal(second.status,200);assert.equal(second.body.result.version,2);assert.deepEqual((await api('operator','documentUpload',body,key)).body,first.body);
  const docs=(await c.stable()).enterprise_documents;assert.equal(docs[1].provenance.previousHash,first.body.result.hash);
  const schema=(await env.f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',env.cluster.config.host,'-p',String(env.cluster.config.port),'-U',env.cluster.config.user,'-d',env.cluster.config.database];
  const dump=name=>{const p=env.cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+p]);return p;},restore=async p=>{await env.f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+p],{stdio:'pipe'});};
  const pre=dump('BF55-before-classification'),preUser=f.users.operator,controlId=await classify(body);
  for(const mode of ['download','preview','export'])assert.equal((await api('operator','documentRead',{...ref,mode,purpose:'summary'})).status,403);
  assert.deepEqual((await api('operator','documentSearch',{id:body.id,purpose:'summary'})).body.result,{items:[]});assert.equal((await api('operator','documentUpload',body,key)).status,403);
  const next=async(status=403,code='PERMISSION_DENIED',who='operator',change={})=>c.denied('new document version '+who+' '+code,()=>api(who,'documentUpload',{...body,content:'BF55 synthetic next version',...change}),status,code);
  // Before the fix this request creates v3, calls the scanner and commits an Action.
  await next();await reconnect();await next();
  await grant(all);assert.equal((await api('operator','documentRead',{...ref,purpose:'summary'})).status,200);await next();
  const granted=dump('BF55-granted');await grant(base);await next();await restore(granted);await reconnect();assert.equal((await api('operator','documentRead',{...ref,purpose:'summary'})).status,403);await next();
  await grant(base,[]);await next(404,'NOT_FOUND');await grant();await next();
  await grant(base,[f.scope],['read','search']);await next();await grant();
  await grant(base.filter(x=>x!=='CONFIDENTIAL'));await next();await grant();
  for(const who of ['other','tenant2','reader'])await next(who==='reader'?403:404,who==='reader'?'PERMISSION_DENIED':'NOT_FOUND',who);
  await next(400,'INVALID_ARGUMENT','operator',{purpose:'summary'});
  const current=dump('BF55-current');await restore(pre);f.users.operator=preUser;await next(400,'RECOVERING');await restore(current);await reconnect();await next();
  assert.equal((await env.f.owner.query('DELETE FROM enterprise_controls WHERE id=$1',[controlId])).rowCount,1);await next(400,'RECOVERING');await restore(current);await reconnect();await next();
  // Independent untagged document: static revocation and recovery, then scanner failure.
  const clean=await f.create();await grant(base.filter(x=>x!=='CONFIDENTIAL'));await c.denied('untagged static denial',()=>api('operator','documentUpload',{...clean.body,content:'BF55 untagged second'}));await grant();
  const added=await api('operator','documentUpload',{...clean.body,content:'BF55 untagged second'});assert.equal(added.status,200);assert.equal(added.body.result.version,2);await reconnect();assert.deepEqual((await api('operator','documentUpload',clean.body,clean.key)).body,clean.first.body);
  env.f.kernel.documentScanner=async()=>{throw Error('BF55 scanner unavailable');};const quarantined=await api('operator','documentUpload',{...clean.body,content:'BF55 quarantined third'});assert.equal(quarantined.body.result.state,'QUARANTINED');assert.equal(quarantined.body.result.version,3);assert.equal((await api('operator','documentRead',{id:clean.body.id,documentId:clean.body.documentId,version:3})).status,404);
  const final=await c.stable();assert.equal(final.enterprise_documents.length,5);assert.equal(final.requests.length,0);assert.equal(final.ledger.length,0);
 }finally{await mkdir(output,{recursive:true});await writeFile(output+'/BF55-contract.json',JSON.stringify({records:f.records,checks:c.checks},null,2)+'\n');await f.close();}
});

test('ENT-106 BF-55 browser new document version denies classification before scanner and persistence',async()=>{
 const f=await bf54Environment(),{env,api,grant,classify,all}=f,c=await bf55Checks(f),{browser}=await import('./browser-helper.mjs'),page=await browser(),output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';let result={};
 try{
  const {body}=await f.create();await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]','operator');await page.click('button');await page.until('document.querySelector("#workspace")?.hidden===false');
  await page.evaluate('window.bf55=[];const d=document.createElement("pre");d.id="bf55";document.body.prepend(d)');
  const upload=()=>page.evaluate(`(async()=>{const s=await(await fetch('/session')).json(),request=${JSON.stringify({contractVersion:'2.0.0',operation:'documentUpload',body:{...body,content:'BF55 browser next version'}})};request.key=crypto.randomUUID();const r=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrf},body:JSON.stringify(request)});const x={request,status:r.status,body:await r.json()};window.bf55.push(x);document.querySelector('#bf55').textContent=JSON.stringify(window.bf55,null,2);return x;})()`);
  const second=await upload();assert.equal(second.status,200);assert.equal(second.body.result.version,2);await page.screenshot('BF55-authorized-version');
  await classify(body);assert.equal((await api('operator','documentRead',{id:body.id,documentId:body.documentId,version:1,purpose:'summary'})).status,403);assert.deepEqual((await api('operator','documentSearch',{id:body.id,purpose:'summary'})).body.result,{items:[]});
  await c.denied('browser classified new version',async()=>{const r=await upload();await page.screenshot('BF55-classified-version');return r;});
  await grant(all);assert.equal((await api('operator','documentRead',{id:body.id,documentId:body.documentId,version:1,purpose:'summary'})).status,200);await c.denied('browser full clearance',upload);await page.screenshot('BF55-full-clearance-denied');
  await grant(all,[]);await c.denied('browser scope revoked',upload,404,'NOT_FOUND');await page.screenshot('BF55-scope-revoked');result.browser=await page.send('Browser.getVersion');
 }finally{result.records=await page.evaluate('window.bf55??[]');result.http=f.records;result.checks=c.checks;await mkdir(output,{recursive:true});await writeFile(output+'/BF55-browser.json',JSON.stringify(result,null,2)+'\n');await page.close();await f.close();}
});

// BF-56: records authority does not bypass the document's current source policy.
async function bf56Environment(){
 const f=await bf54Environment(),ops=['read','search','action','records'];
 const grant=(fields=f.base,scopes=[f.scope],operations=ops)=>f.grant(fields,scopes,operations);
 const create=async()=>{await grant(f.all);const b=f.env.f.create();assert.equal((await f.api('operator','create',b)).status,200);await grant();const body={id:b.id,documentId:crypto.randomUUID(),name:'BF56-synthetic.txt',mime:'text/plain',classification:'CONFIDENTIAL',content:'BF56 synthetic content',retainUntil:new Date(Date.now()+60000).toISOString()};assert.equal((await f.api('operator','documentUpload',body)).status,200);return body;};
 const reconnect=async()=>{const clock=f.env.f.kernel.clock;await f.reconnect();f.env.f.kernel.clock=clock;};
 const classify=async(b,version=1)=>{const id=crypto.randomUUID(),r=await f.api('publisher','informationCreate',{id,scope:f.scope,source:{kind:'document',id:b.documentId,objectId:b.id,version},label:'STRICT',purposes:['summary']});assert.equal(r.status,200,JSON.stringify(r));return id;};
 return {...f,grant,create,reconnect,classify};
}

test('ENT-106 BF-56 document hold delete fresh and replay HTTP current policy erasure boundary restore',async()=>{
 const f=await bf56Environment(),{env,api,grant,base,all,classify,reconnect}=f,c=await bf55Checks(f),output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser',observations=[];
 try{
  const body=await f.create(),ref={id:body.id,documentId:body.documentId,version:1},on={...ref,hold:true},off={...ref,hold:false},holdKey=crypto.randomUUID();
  assert.equal((await api('operator','documentDelete',ref)).status,403);assert.equal((await api('operator','documentHold',on,holdKey)).status,200);
  const clean=await f.create(),cleanRef={id:clean.id,documentId:clean.documentId,version:1};assert.equal((await api('operator','documentUpload',{...clean,content:'BF56 second live version'})).body.result.version,2);
  env.f.kernel.clock=()=>Date.now()+120000;
  assert.equal((await api('operator','documentDelete',ref)).status,403);
  const deleteKey=crypto.randomUUID(),deleted=await api('operator','documentDelete',cleanRef,deleteKey);assert.equal(deleted.status,200);assert.deepEqual((await f.unchanged('legitimate delete replay',()=>api('operator','documentDelete',cleanRef,deleteKey))).body,deleted.body);
  const schema=(await env.f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',env.cluster.config.host,'-p',String(env.cluster.config.port),'-U',env.cluster.config.user,'-d',env.cluster.config.database];
  const dump=name=>{const p=env.cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+p]);return p;},restore=async p=>{await env.f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+p],{stdio:'pipe'});};
  const pre=dump('BF56-preclassification'),preUser=f.users.operator,controlId=await classify(body);await classify(clean,2);
  assert.equal((await api('operator','documentRead',{...ref,purpose:'summary'})).status,403);assert.deepEqual((await api('operator','documentSearch',{id:body.id,purpose:'summary'})).body.result,{items:[]});
  // Record every vulnerable path before asserting, so old-code deletion is observable.
  for(const [operation,b,key]of [['documentHold',on,holdKey],['documentHold',off,crypto.randomUUID()],['documentDelete',ref,crypto.randomUUID()],['documentDelete',cleanRef,deleteKey]]){const before=await c.stable(),journalBefore=env.f.kernel.journal.records(),r=await api('operator',operation,b,key),after=await c.stable(),journalAfter=env.f.kernel.journal.records();observations.push({operation,response:r,before,after,journalBefore,journalAfter});}
  for(const x of observations){assert.equal(x.response.status,403,JSON.stringify(x.response));assert.deepEqual(x.after,x.before);const appended=x.journalAfter.slice(x.journalBefore.length);assert.deepEqual(x.journalAfter.slice(0,x.journalBefore.length),x.journalBefore);assert.ok(appended.length===0||appended.length===2);if(appended.length)assert.deepEqual(appended.map(e=>e.phase),['INTENT','ABORTED']);}
  const denyAll=async(status=403,code='PERMISSION_DENIED',who='operator')=>{for(const [op,b,key]of [['documentHold',on,holdKey],['documentHold',off,crypto.randomUUID()],['documentHold',on,crypto.randomUUID()],['documentDelete',ref,crypto.randomUUID()],['documentDelete',cleanRef,deleteKey]])await c.denied(op+' '+who+' '+code,()=>api(who,op,b,key),status,code);};
  await reconnect();await denyAll();await grant(all);assert.equal((await api('operator','documentRead',{...ref,purpose:'summary'})).status,200);await denyAll();
  const granted=dump('BF56-granted');await grant(base);await denyAll();await restore(granted);await reconnect();assert.equal((await api('operator','documentRead',{...ref,purpose:'summary'})).status,403);await denyAll();
  await grant(base,[]);await denyAll(404,'NOT_FOUND');await grant();await denyAll();
  await grant(base,[f.scope],['read','search','action']);await denyAll();await grant(base.filter(x=>x!=='CONFIDENTIAL'));await denyAll();await grant();
  for(const who of ['other','tenant2','reader'])await denyAll(who==='reader'?403:404,who==='reader'?'PERMISSION_DENIED':'NOT_FOUND',who);
  for(const [op,b,key]of [['documentHold',on,holdKey],['documentDelete',cleanRef,deleteKey]]){await c.denied('changed purpose replay',()=>api('operator',op,{...b,purpose:'summary'},key),400,'IDEMPOTENCY_MISMATCH');await c.denied('new purpose invalid',()=>api('operator',op,{...b,purpose:'summary'}),400,'INVALID_ARGUMENT');}
  const current=dump('BF56-current');await restore(pre);f.users.operator=preUser;await denyAll(400,'RECOVERING');await restore(current);await reconnect();await denyAll();
  assert.equal((await env.f.owner.query('DELETE FROM enterprise_controls WHERE id=$1',[controlId])).rowCount,1);await denyAll(400,'RECOVERING');await restore(current);await reconnect();
  // Simulated restored bytes/tombstone loss: reapply an already legitimate erasure,
  // even though the surviving version was subsequently classified. No new deletion.
  await env.f.owner.query("UPDATE enterprise_documents SET content=$1,state='CLEAN' WHERE id=$2 AND version=1",[Buffer.from(clean.content),clean.documentId]);await env.f.owner.query('DELETE FROM enterprise_erasure WHERE id=$1',[clean.documentId]);
  assert.equal((await api('operator','documentRead',{...cleanRef,purpose:'summary'})).body.error.code,'RECOVERING');const restored=await api('operator','documentRestore',{});assert.equal(restored.status,200);assert.equal(restored.body.result.erased,1);assert.equal((await env.f.owner.query('SELECT content FROM enterprise_documents WHERE id=$1 AND version=1',[clean.documentId])).rows[0].content,null);await denyAll();
  // Untagged records retain reversible holds, denial while held and actual erasure.
  env.f.kernel.clock=()=>Date.now();const other=await f.create(),r={id:other.id,documentId:other.documentId,version:1},k=crypto.randomUUID(),h={...r,hold:true};assert.equal((await api('operator','documentHold',h,k)).status,200);await grant(base.filter(x=>x!=='CONFIDENTIAL'));await c.denied('untagged static hold replay',()=>api('operator','documentHold',h,k));await grant();assert.equal((await f.unchanged('untagged hold replay',()=>api('operator','documentHold',h,k))).status,200);env.f.kernel.clock=()=>Date.now()+120000;assert.equal((await api('operator','documentDelete',r)).status,403);assert.equal((await api('operator','documentHold',{...r,hold:false})).status,200);const dk=crypto.randomUUID();assert.equal((await api('operator','documentDelete',r,dk)).status,200);await reconnect();assert.equal((await f.unchanged('deleted replay after restart',()=>api('operator','documentDelete',r,dk))).status,200);
  assert.equal((await env.effects.requests()).length,0);assert.equal((await env.effects.ledger()).length,0);
 }finally{await mkdir(output,{recursive:true});await writeFile(output+'/BF56-contract.json',JSON.stringify({records:f.records,observations,checks:c.checks,replayChecks:f.checks},null,2)+'\n');await f.close();}
});

test('ENT-106 BF-56 browser document hold release delete and replay deny current classification',async()=>{
 const f=await bf56Environment(),{env,api,grant,all,classify}=f,c=await bf55Checks(f),{browser}=await import('./browser-helper.mjs'),page=await browser(),output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser',observations=[];let result={};
 try{
  const b=await f.create(),ref={id:b.id,documentId:b.documentId,version:1},key=crypto.randomUUID(),on={...ref,hold:true};env.f.kernel.clock=()=>Date.now()+120000;
  await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]','operator');await page.click('button');await page.until('document.querySelector("#workspace")?.hidden===false');await page.evaluate('window.bf56=[];const d=document.createElement("pre");d.id="bf56";document.body.prepend(d)');
  const request=(operation,body,k=crypto.randomUUID())=>page.evaluate(`(async()=>{const s=await(await fetch('/session')).json(),request=${JSON.stringify({contractVersion:'2.0.0',operation,body,key:k})};const r=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrf},body:JSON.stringify(request)});const x={request,status:r.status,body:await r.json()};window.bf56.push(x);document.querySelector('#bf56').textContent=JSON.stringify(window.bf56,null,2);return x;})()`);
  assert.equal((await request('documentHold',on,key)).status,200);await page.screenshot('BF56-authorized-hold');await classify(b);assert.equal((await api('operator','documentRead',{...ref,purpose:'summary'})).status,403);
  for(const [op,body,k]of [['documentHold',on,key],['documentHold',{...ref,hold:false},crypto.randomUUID()],['documentDelete',ref,crypto.randomUUID()]]){const before=await c.stable(),r=await request(op,body,k),after=await c.stable();observations.push({response:r,before,after});}await page.screenshot('BF56-classified-records');for(const x of observations){assert.equal(x.response.status,403);assert.deepEqual(x.after,x.before);}
  await grant(all);assert.equal((await api('operator','documentRead',{...ref,purpose:'summary'})).status,200);await c.denied('browser full clearance hold',()=>request('documentHold',{...ref,hold:false}));await c.denied('browser full clearance delete',()=>request('documentDelete',ref));await page.screenshot('BF56-full-clearance-denied');
  await grant(all,[]);await c.denied('browser scope hold',()=>request('documentHold',on,key),404,'NOT_FOUND');await c.denied('browser scope delete',()=>request('documentDelete',ref),404,'NOT_FOUND');await page.screenshot('BF56-scope-revoked');result.browser=await page.send('Browser.getVersion');
 }finally{result.records=await page.evaluate('window.bf56??[]');result.http=f.records;result.observations=observations;result.checks=c.checks;await mkdir(output,{recursive:true});await writeFile(output+'/BF56-browser.json',JSON.stringify(result,null,2)+'\n');await page.close();await f.close();}
});
