import {test as nodeTest} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {withControls,rightBody,release,approve,work} from './control-helper.mjs';import {restart} from './helpers.mjs';
test('ENT-115 AC-01 positive persistence evidence version and finite usage boundaries',()=>withControls(async f=>{
 const b=rightBody();await f.call('manager','rightGrant',b);restart(f);const usage={id:b.id,purpose:'disclosure',channel:'web',region:'JP',indirect:false};assert.equal((await f.call('manager','rightCheck',usage)).state,'PERMITTED');for(const change of [{purpose:'marketing'},{region:'EU'},{channel:'social'},{indirect:true}])await assert.rejects(f.call('manager','rightCheck',{...usage,...change}),{code:'PERMISSION_DENIED'});assert.equal((await f.call('manager','controlRead',{id:b.id})).data.evidenceVersion,'fixture-v1');
}));
test('ENT-115 AC-02 negative-authorization queued revoke expiry and reimport rejection',()=>withControls(async(f,{a})=>{
 const x=await release(f);await approve(f,x.id);await f.call('manager','rightRevoke',{id:x.right.id});await assert.rejects(work(f,x.id),{code:'PERMISSION_DENIED'});assert.equal(a.requests.length,0);await assert.rejects(f.call('manager','rightGrant',{...x.right,id:randomUUID()}),{code:'PERMISSION_DENIED'});await assert.rejects(f.call('reader','rightRevoke',{id:x.right.id}),{code:'PERMISSION_DENIED'});
 const b={...rightBody(),material:'expired',expires:'2021-01-01T00:00:00Z'};await f.call('manager','rightGrant',b);await assert.rejects(f.call('manager','rightCheck',{id:b.id,purpose:'disclosure',channel:'web',region:'JP',indirect:false}),{code:'PERMISSION_DENIED'});
}));
test('ENT-115 AC-03 failure-recovery suppression survives transaction rollback and restored row',()=>withControls(async f=>{
 const b=rightBody();await f.call('manager','rightGrant',b);const old=(await f.owner.query('SELECT data FROM enterprise_controls WHERE id=$1',[b.id])).rows[0].data;f.kernel.fault=async p=>{if(p==='enterprise-before-audit')throw Error('audit failure');};await assert.rejects(f.call('manager','rightRevoke',{id:b.id}));restart(f);await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[b.id,old]);await assert.rejects(f.call('manager','rightCheck',{id:b.id,purpose:'disclosure',channel:'web',region:'JP',indirect:false}),{code:'PERMISSION_DENIED'});assert.ok(f.kernel.journal.records().some(x=>x.operationKind==='enterprise-suppression'));
}));
test('ENT-115 real PostgreSQL snapshot restore cannot revive revoked consent queued publication',()=>withControls(async(f,{cluster,a})=>{
 const {execFileSync}=await import('node:child_process');const x=await release(f);await approve(f,x.id);const schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],path=cluster.directory+'/consent-before.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);await f.call('manager','rightRevoke',{id:x.right.id});await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});
 const ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;assert.equal((await f.owner.query('SELECT data FROM enterprise_controls WHERE id=$1',[x.right.id])).rows[0].data.state,'GRANTED');await assert.rejects(work(f,x.id),{code:'PERMISSION_DENIED'});assert.equal(a.requests.length,0);await assert.rejects(f.call('manager','rightGrant',{...x.right,id:randomUUID()}),{code:'PERMISSION_DENIED'});
}));

function test(name,fn){const labels=['positive','negative-authorization','persistence','failure-recovery'].filter(x=>name.includes(x));return nodeTest(name,t=>{const run=(ctx,n)=>n===labels.length?fn(ctx):ctx.test(labels[n]+' '+name,child=>run(child,n+1));return run(t,0);});}

test('ENT-115 negative-authorization exact subject material and complete lineage coverage',()=>withControls(async(f,{a})=>{
 const {source,scope}=await import('./control-helper.mjs');const info=await source(f),info2=await source(f),material='object:'+(await f.call('manager','controlRead',{id:info,purpose:'disclosure'})).data.sources[0].id,material2='object:'+(await f.call('manager','controlRead',{id:info2,purpose:'disclosure'})).data.sources[0].id;
 const wrong=rightBody();await f.call('manager','rightGrant',wrong);const base={scope,source:info,subject:wrong.subject,purpose:'disclosure',rights:[wrong.id],channels:['web'],region:'JP',indirect:false,embargo:'2020-01-01T00:00:00Z'};
 await assert.rejects(f.call('operator','releaseCreate',{...base,id:randomUUID()}),{code:'PERMISSION_DENIED'});
 const right={...rightBody(),material};await f.call('manager','rightGrant',right);
 await assert.rejects(f.call('operator','releaseCreate',{...base,id:randomUUID(),rights:[right.id],subject:'unrelated-subject'}),{code:'PERMISSION_DENIED'});
 const derived=randomUUID();await f.call('operator','informationDerive',{id:derived,scope,sources:[info,info2],purpose:'disclosure',label:'CONFIDENTIAL',transform:'export'});
 await assert.rejects(f.call('operator','releaseCreate',{...base,id:randomUUID(),source:derived,rights:[right.id]}),{code:'PERMISSION_DENIED'});
 const right2={...rightBody(),material:material2};await f.call('manager','rightGrant',right2);const id=randomUUID();await f.call('operator','releaseCreate',{...base,id,source:derived,rights:[right.id,right2.id]});await approve(f,id);assert.equal((await work(f,id)).state,'ACCEPTED');assert.equal((await a.ledger())[0].applied,1);
}));
test('ENT-115 failure-recovery current rights checked again immediately before I/O',()=>withControls(async(f,{a})=>{
 const x=await release(f);await approve(f,x.id);f.kernel.fault=async point=>{if(point==='control-before-send')f.kernel.clock=()=>Date.parse('2100-01-01T00:00:00Z');};const result=await work(f,x.id);assert.equal(result.state,'UNKNOWN');assert.equal(result.code,'PERMISSION_DENIED');assert.equal(a.requests.length,0);assert.equal((await work(f,x.id,'web','reconcile')).observation,'ABSENT');assert.equal((await a.ledger()).length,0);
}));

async function bf33Authority(f,classification='STRICT'){
 const {scope,operations}=await import('../../scripts/enterprise/fixture.mjs'),strict={...scope,classification};
 await f.owner.query("UPDATE enterprise_grants SET scopes=$1 WHERE principal='publisher'",[JSON.stringify([scope,strict])]);
 const grant=(principal,fields)=>f.call('publisher','grant',{principal,scopes:[strict,scope],operations,fields});
 await grant('manager',['CONFIDENTIAL','STRICT','RESTRICTED']);await grant('reader',['CONFIDENTIAL']);return {strict,grant};
}
async function bf33Http(f){
 const {enterpriseGateway}=await import('../../src/enterprise/gateway.mjs'),{tokenDigest}=await import('../../src/contracts.mjs');
 for(const who of ['reader','manager','tenant2'])await f.owner.query('INSERT INTO enterprise_browser_sessions VALUES($1,$2) ON CONFLICT DO NOTHING',[tokenDigest(f.credentials[who].token),'bf33-csrf']);
 const gateway=await enterpriseGateway(f.kernel,{issuer:'http://127.0.0.1:1'});
 return {close:()=>gateway.close(),async call(who,operation,body,key=randomUUID()){const r=await fetch(gateway.origin+'/api',{method:'POST',headers:{cookie:'enterprise_session='+f.credentials[who].token,origin:gateway.origin,'content-type':'application/json','x-csrf-token':'bf33-csrf'},body:JSON.stringify({contractVersion:'2.0.0',operation,body,key})});return {status:r.status,body:await r.json()};}};
}
for(const classification of ['STRICT','RESTRICTED'])nodeTest('BF-33 HTTP rights retain '+classification+' and revoked classification survives PostgreSQL restore',()=>withControls(async(f,{cluster,a})=>{
 const {strict,grant}=await bf33Authority(f,classification),b={...rightBody(),scope:strict,subject:'bf33-secret-subject',material:'bf33-secret-material',evidenceVersion:'bf33-secret-evidence'},key=randomUUID(),usage={id:b.id,purpose:'disclosure',channel:'web',region:'JP',indirect:false};let http=await bf33Http(f);
 try{
 assert.equal((await http.call('manager','rightGrant',b,key)).status,200);
 const observed={list:await http.call('reader','controlList',{kind:'right'}),read:await http.call('reader','controlRead',{id:b.id}),check:await http.call('reader','rightCheck',usage)};console.log('BF-33 classification observation',JSON.stringify({classification,...observed}));
 assert.equal(observed.read.status,403);assert.equal(observed.check.status,403);assert.deepEqual(observed.list.body.result.items,[]);
 for(const op of ['controlAudit','rightRevoke'])assert.equal((await http.call('reader',op,{id:b.id})).status,403);
 assert.equal((await http.call('reader','rightGrant',{...b,id:randomUUID()})).status,403);
 assert.equal((await http.call('tenant2','controlRead',{id:b.id})).status,404);
 const saved=(await f.owner.query('SELECT data FROM enterprise_controls WHERE id=$1',[b.id])).rows[0].data;assert.equal(saved.label,'STRICT');assert.equal(saved.scope.classification,classification);
 assert.equal((await http.call('manager','rightCheck',usage)).body.result.state,'PERMITTED');assert.equal((await http.call('manager','rightGrant',b,key)).status,200);
 const audit=await http.call('manager','controlAudit',{id:b.id});assert.equal(audit.status,200);assert.match(JSON.stringify(audit.body),/STRICT/);
 for(const change of [{purpose:'marketing'},{region:'EU'},{channel:'social'},{indirect:true}])assert.equal((await http.call('manager','rightCheck',{...usage,...change})).status,403);
 const {execFileSync}=await import('node:child_process'),schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],path=cluster.directory+'/bf33-before.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);
 await grant('manager',['CONFIDENTIAL']);assert.equal((await http.call('manager','rightGrant',b,key)).status,403);await http.close();await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});const ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;http=await bf33Http(f);
 for(const [op,body] of [['controlRead',{id:b.id}],['controlAudit',{id:b.id}],['rightCheck',usage],['rightRevoke',{id:b.id}],['rightGrant',b]])assert.equal((await http.call('manager',op,body,op==='rightGrant'?key:randomUUID())).status,403);
 await grant('reader',['CONFIDENTIAL','RESTRICTED']);assert.equal((await http.call('reader','rightCheck',usage)).status,200);assert.equal((await http.call('reader','rightRevoke',{id:b.id})).status,200);assert.equal((await http.call('reader','rightCheck',usage)).status,403);assert.equal((await http.call('reader','rightGrant',{...b,id:randomUUID()})).status,403);assert.equal(a.requests.length,0);
 }finally{await http.close();}
}));

nodeTest('BF-33 persisted rights classification fences submission recovery and publication immediately before send',()=>withControls(async(f,{a})=>{
 const {strict,grant}=await bf33Authority(f),b={...rightBody(),scope:strict},key=randomUUID();
 f.kernel.fault=async p=>{if(p==='enterprise-after-commit')throw Error('BF-33 completion lost');};await assert.rejects(f.call('manager','rightGrant',b,key));f.kernel.fault=async()=>{};
 const saved=(await f.owner.query('SELECT data FROM enterprise_controls WHERE id=$1',[b.id])).rows[0].data,http=await bf33Http(f),usage={id:b.id,purpose:'disclosure',channel:'web',region:'JP',indirect:false},journal=f.kernel.journal.records();
 try{
 for(const bad of [{...saved,label:'CONFIDENTIAL'},{...saved,scope:{...strict,classification:'CONFIDENTIAL'}},{...saved,scope:null}]){
 await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[b.id,bad]);assert.deepEqual((await http.call('manager','controlList',{kind:'right'})).body.result.items,[]);
 for(const [op,body] of [['controlRead',{id:b.id}],['controlAudit',{id:b.id}],['rightCheck',usage],['rightRevoke',{id:b.id}],['rightGrant',b]]){const v=await http.call('manager',op,body,op==='rightGrant'?key:randomUUID());assert.equal(v.body.error?.code,'INCONSISTENT_STATE',JSON.stringify(v));}
 await assert.rejects(f.kernel.enterpriseRecover(f.credentials.manager),{code:'INCONSISTENT_STATE'});assert.deepEqual(f.kernel.journal.records(),journal);
 }
 await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[b.id,saved]);await assert.rejects(f.kernel.enterpriseRecover(f.credentials.reader),{code:'PERMISSION_DENIED'});await f.kernel.enterpriseRecover(f.credentials.manager);assert.equal((await http.call('manager','rightGrant',b,key)).status,200);
 const revokeKey=randomUUID();f.kernel.fault=async p=>{if(p==='enterprise-after-commit')throw Error('BF-33 revoke completion lost');};await assert.rejects(f.call('manager','rightRevoke',{id:b.id},revokeKey));f.kernel.fault=async()=>{};
 const revoked=(await f.owner.query('SELECT data FROM enterprise_controls WHERE id=$1',[b.id])).rows[0].data;await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[b.id,{...revoked,label:'CONFIDENTIAL'}]);const pending=f.kernel.journal.records();await assert.rejects(f.kernel.enterpriseRecover(f.credentials.manager),{code:'INCONSISTENT_STATE'});assert.deepEqual(f.kernel.journal.records(),pending);
 await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[b.id,revoked]);await assert.rejects(f.kernel.enterpriseRecover(f.credentials.reader),{code:'PERMISSION_DENIED'});await f.kernel.enterpriseRecover(f.credentials.manager);assert.equal((await http.call('manager','rightCheck',usage)).status,403);
 }finally{await http.close();}
 // A real STRICT source and right feed the existing independently approved
 // publication path. Rights classification is checked again at the I/O fence.
 for(const principal of ['operator','manager','reviewer','publisher'])await grant(principal,['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED']);
 const object=f.create({scope:strict});await f.call('operator','create',object);const info=randomUUID();await f.call('operator','informationCreate',{id:info,scope:strict,source:{kind:'object',id:object.id,projection:['title']},label:'STRICT',purposes:['disclosure']});
 const right={...rightBody(),scope:strict,material:'object:'+object.id};await f.call('manager','rightGrant',right);const id=randomUUID(),body={id,scope:strict,source:info,subject:right.subject,purpose:'disclosure',rights:[right.id],channels:['web'],region:'JP',indirect:false,embargo:'2020-01-01T00:00:00Z'};
 await f.call('operator','releaseCreate',body);await approve(f,id);const good=(await f.owner.query('SELECT data FROM enterprise_controls WHERE id=$1',[right.id])).rows[0].data;
 await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[right.id,{...good,label:'CONFIDENTIAL'}]);await assert.rejects(f.call('operator','releaseCreate',{...body,id:randomUUID()}),{code:'INCONSISTENT_STATE'});await assert.rejects(work(f,id),{code:'INCONSISTENT_STATE'});assert.equal(a.requests.length,0);await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[right.id,good]);
 f.kernel.fault=async point=>{if(point==='control-before-send')await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[right.id,{...good,label:'CONFIDENTIAL'}]);};const result=await work(f,id);assert.equal(result.state,'UNKNOWN');assert.equal(result.code,'INCONSISTENT_STATE');assert.equal(a.requests.length,0);f.kernel.fault=async()=>{};
 await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[right.id,good]);const n=a.requests.length,reconciled=await work(f,id,'web','reconcile');assert.equal(reconciled.observation,'ABSENT');assert.equal(reconciled.state,'UNKNOWN');assert.equal(reconciled.requiresHumanReview,true);assert.deepEqual(a.requests.slice(n).map(r=>r.method),['GET']);assert.equal((await a.ledger()).length,0);
 // A separate normal operation proves the guard permits valid STRICT use.
 const normal=randomUUID();await f.call('operator','releaseCreate',{...body,id:normal});await approve(f,normal);assert.equal((await work(f,normal)).state,'ACCEPTED');assert.equal((await a.ledger())[0].applied,1);await f.call('operator','releaseWithdraw',{id:normal});await approve(f,normal,true);assert.equal((await work(f,normal,'web','withdraw')).state,'WITHDRAWN');assert.equal((await a.ledger())[0].withdrawn,1);console.log(JSON.stringify({bf33Publication:{result,reconciled,ledger:await a.ledger(),requests:a.requests}}));
}));
