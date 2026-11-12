import {test as nodeTest} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {withControls,scope,source} from './control-helper.mjs';import {referenceProposals} from '../../scripts/enterprise/reference/proposals.mjs';import {ProposalPort} from '../../src/enterprise/proposals.mjs';import {restart} from './helpers.mjs';
test('ENT-113 AC-01 positive persistence document lineage search aggregate AI export notification',()=>withControls(async f=>{
 const model=await referenceProposals();f.kernel.proposalPort=new ProposalPort(model.url);try{
 const o=f.create();await f.call('operator','create',o);const doc=randomUUID(),info=randomUUID();await f.call('operator','documentUpload',{id:o.id,documentId:doc,name:'synthetic-source',mime:'text/plain',classification:'CONFIDENTIAL',content:'合成文書・機密の根拠',retainUntil:'2099-01-01T00:00:00Z'});await f.call('operator','informationCreate',{id:info,scope,source:{kind:'document',id:doc,objectId:o.id,version:1},label:'CONFIDENTIAL',purposes:['summary','disclosure']});const ids=[info];for(let n=0;n<2;n++)ids.push(await source(f));let current=ids;
 for(const transform of ['search','aggregate','ai','export','notification']){const key=randomUUID();await f.call('operator','informationDerive',{id:key,scope,sources:current,purpose:'summary',label:'CONFIDENTIAL',transform});current=transform==='search'?[key,...ids.slice(1)]:[key];}
 assert.equal(model.requests.length,1);restart(f);const got=await f.call('manager','controlRead',{id:current[0],purpose:'summary'});assert.equal(got.data.label,'CONFIDENTIAL');assert.equal(got.data.executionAllowed,false);assert.ok((await f.call('manager','controlAudit',{id:current[0]})).history.length);
 }finally{await model.close();}
}));
test('ENT-113 AC-02 negative-authorization no downgrade hidden count or purpose expansion',()=>withControls(async f=>{
 const key=await source(f),b={id:randomUUID(),scope,sources:[key],purpose:'summary',label:'CONFIDENTIAL',transform:'search'};
 await assert.rejects(f.call('operator','informationDerive',{...b,label:'PUBLIC'}),{code:'PERMISSION_DENIED'});await assert.rejects(f.call('operator','informationDerive',{...b,purpose:'advertising'}),{code:'PERMISSION_DENIED'});await assert.rejects(f.call('operator','informationDerive',{...b,transform:'aggregate'}),{code:'PERMISSION_DENIED'});
 assert.deepEqual((await f.call('reader','controlList',{kind:'information',purpose:'summary'})).items,[]);await assert.rejects(f.call('other','controlRead',{id:key,purpose:'summary'}),{code:'NOT_FOUND'});await assert.rejects(f.call('tenant2','controlRead',{id:key,purpose:'summary'}),{code:'NOT_FOUND'});
}));
test('ENT-113 AC-03 failure-recovery missing lineage and audit rollback',()=>withControls(async f=>{
 const key=await source(f);const row=await f.call('manager','controlRead',{id:key,purpose:'summary'});await f.owner.query('UPDATE objects SET revision=revision+1 WHERE id=$1',[row.data.sources[0].id]);await assert.rejects(f.call('manager','controlRead',{id:key,purpose:'summary'}),{code:'RECOVERING'});
 const original=f.create();await f.call('operator','create',original);const id=randomUUID();f.kernel.fault=async p=>{if(p==='enterprise-before-audit')throw Error('fault');};await assert.rejects(f.call('operator','informationCreate',{id,scope,source:{kind:'object',id:original.id,projection:['title']},label:'STRICT',purposes:['summary']}));assert.equal((await f.owner.query('SELECT 1 FROM enterprise_controls WHERE id=$1',[id])).rowCount,0);
}));
test('ENT-113 PUBLIC INTERNAL CONFIDENTIAL STRICT classification lattice with scoped public API',()=>withControls(async f=>{
 const {operations}=await import('../../scripts/enterprise/fixture.mjs');const p=structuredClone(f.manifest);p.id='classification-fixture';p.types.Case.title.classification='PUBLIC';await f.call('manager','install',{manifest:p});await f.call('reviewer','review',{id:p.id,version:p.version});await f.call('publisher','publish',{id:p.id,version:p.version});
 const publicScope={...scope,classification:'PUBLIC'};await f.owner.query('UPDATE enterprise_grants SET scopes=$1 WHERE principal=$2',[JSON.stringify([scope,publicScope]),'publisher']);await f.call('publisher','grant',{principal:'operator',scopes:[scope,publicScope],operations:['action','read','search'],fields:['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED']});
 const o=f.create({packageId:p.id,scope:publicScope});await f.call('operator','create',o);let key=randomUUID();await f.call('operator','informationCreate',{id:key,scope:publicScope,source:{kind:'object',id:o.id,projection:['title']},label:'PUBLIC',purposes:['summary']});for(const label of ['INTERNAL','CONFIDENTIAL','STRICT']){const next=randomUUID();await f.call('operator','informationDerive',{id:next,scope:publicScope,sources:[key],purpose:'summary',label,transform:'export'});key=next;}assert.equal((await f.call('operator','controlRead',{id:key,purpose:'summary'})).data.label,'STRICT');await assert.rejects(f.call('operator','informationDerive',{id:randomUUID(),scope:publicScope,sources:[key],purpose:'summary',label:'PUBLIC',transform:'notification'}),{code:'PERMISSION_DENIED'});
}));

test('ENT-113 tagged roots block legacy read search AI and dispatch bypasses',()=>withControls(async f=>{
 const key=await source(f),row=await f.call('manager','controlRead',{id:key,purpose:'summary'}),objectId=row.data.sources[0].id;await assert.rejects(f.call('manager','get',{id:objectId}),{code:'PERMISSION_DENIED'});assert.ok((await f.call('manager','get',{id:objectId,purpose:'summary'})).informationPolicy);assert.equal((await f.call('manager','query',{packageId:f.manifest.id,type:'Case',aggregate:true})).count,0);await assert.rejects(f.call('manager','propose',{id:objectId,projection:['title'],purpose:'employment',maxCost:1}),{code:'PERMISSION_DENIED'});for(const who of ['manager','reviewer','publisher'])await f.call(who,'vote',{id:objectId,revision:1,decision:'APPROVE',purpose:'summary'});await assert.rejects(f.kernel.enterpriseWork(f.credentials.manager,{id:objectId,mode:'dispatch'},f.kernel.controlPorts.web),{code:'PERMISSION_DENIED'});
}));

function test(name,fn){const labels=['positive','negative-authorization','persistence','failure-recovery'].filter(x=>name.includes(x));return nodeTest(name,t=>{const run=(ctx,n)=>n===labels.length?fn(ctx):ctx.test(labels[n]+' '+name,child=>run(child,n+1));return run(t,0);});}

nodeTest('BF-13 committed classification lost by real PostgreSQL restore fences legacy surfaces',()=>withControls(async(f,{cluster,a})=>{
 const {execFileSync}=await import('node:child_process');
 const o=f.create();await f.call('operator','create',o);
 assert.equal((await f.call('reader','get',{id:o.id,projection:['title']})).fields.title,o.fields.title);
 const schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database];
 const dump=name=>{const path=cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};
 const restore=async path=>{await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});const ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;};
 const before=dump('classification-before'),id=randomUUID(),key=randomUUID();
 await f.call('operator','informationCreate',{id,scope,source:{kind:'object',id:o.id,projection:['title']},label:'STRICT',purposes:['summary']},key);
 const action=(await f.owner.query('SELECT action_id FROM enterprise_controls WHERE id=$1',[id])).rows[0].action_id;
 assert.ok(f.kernel.journal.records().some(x=>x.actionId===action&&x.phase==='COMMITTED'));
 await assert.rejects(f.call('reader','get',{id:o.id,projection:['title'],purpose:'summary'}),{code:'PERMISSION_DENIED'});
 assert.equal((await f.call('reader','query',{packageId:f.manifest.id,type:'Case',aggregate:true})).count,0);
 const complete=dump('classification-complete'),journal=JSON.stringify(f.kernel.journal.records());
 await restore(before);assert.equal((await f.owner.query('SELECT 1 FROM enterprise_controls WHERE id=$1',[id])).rowCount,0);assert.equal((await f.owner.query('SELECT 1 FROM actions WHERE id=$1',[action])).rowCount,0);assert.equal((await f.owner.query('SELECT 1 FROM objects WHERE id=$1',[o.id])).rowCount,1);
 for(const purpose of [undefined,'summary'])await assert.rejects(f.call('reader','get',{id:o.id,projection:['title'],...(purpose?{purpose}:{})}),{code:'RECOVERING'});
 for(const extra of [{},{aggregate:true},{export:true},{search:{field:'title',text:'Synthetic'}}])await assert.rejects(f.call('reader','query',{packageId:f.manifest.id,type:'Case',projection:['title'],...extra}),{code:'RECOVERING'});
 await assert.rejects(f.call('manager','propose',{id:o.id,projection:['title'],purpose:'summary',maxCost:1}),{code:'RECOVERING'});
 await assert.rejects(f.call('operator','informationDerive',{id:randomUUID(),scope,sources:[id],purpose:'summary',label:'STRICT',transform:'notification'}),{code:'RECOVERING'});
 await assert.rejects(f.kernel.enterpriseWork(f.credentials.manager,{id:o.id,mode:'dispatch'},f.kernel.controlPorts.web),{code:'RECOVERING'});
 assert.equal(a.requests.length,0);assert.equal(JSON.stringify(f.kernel.journal.records()),journal);
 await restore(complete);assert.equal((await f.call('manager','get',{id:o.id,projection:['title'],purpose:'summary'})).informationPolicy.label,'STRICT');await assert.rejects(f.call('reader','get',{id:o.id,purpose:'summary'}),{code:'PERMISSION_DENIED'});await assert.rejects(f.call('manager','get',{id:o.id}),{code:'PERMISSION_DENIED'});
}));

nodeTest('BF-13 document policy strengthening rollback and real restore preserve purpose restrictions',()=>withControls(async(f,{cluster})=>{
 const o=f.create(),doc=randomUUID(),first=randomUUID(),stronger=randomUUID();await f.call('operator','create',o);
 await f.call('operator','documentUpload',{id:o.id,documentId:doc,name:'synthetic-policy',mime:'text/plain',classification:'CONFIDENTIAL',content:'synthetic document',retainUntil:'2099-01-01T00:00:00Z'});
 const body={scope,source:{kind:'document',id:doc,objectId:o.id,version:1},label:'CONFIDENTIAL',purposes:['summary','disclosure']};
 await f.call('operator','informationCreate',{...body,id:first});
 const db=await snapshots(f,cluster),old=db.dump('document-weaker');
 f.kernel.fault=async p=>{if(p==='enterprise-before-audit')throw Error('classification audit rollback');};
 await assert.rejects(f.call('operator','informationCreate',{...body,id:stronger,label:'STRICT',purposes:['summary']}));
 f.kernel.fault=async()=>{};
 assert.equal((await f.call('manager','documentRead',{id:o.id,documentId:doc,version:1,purpose:'disclosure'})).content,'synthetic document');
 assert.ok(f.kernel.journal.records().some(x=>x.informationControlId===stronger&&x.phase==='ABORTED'));
 await f.call('operator','informationCreate',{...body,id:stronger,label:'STRICT',purposes:['summary']});
 await assert.rejects(f.call('manager','documentRead',{id:o.id,documentId:doc,version:1,purpose:'disclosure'}),{code:'PERMISSION_DENIED'});
 const complete=db.dump('document-stronger');await db.restore(old);
 for(const mode of ['download','preview','export'])await assert.rejects(f.call('manager','documentRead',{id:o.id,documentId:doc,version:1,purpose:'disclosure',mode}),{code:'RECOVERING'});
 await assert.rejects(f.call('manager','documentSearch',{id:o.id,text:'synthetic',purpose:'disclosure'}),{code:'RECOVERING'});
 await assert.rejects(f.call('manager','informationDerive',{id:randomUUID(),scope,sources:[first],purpose:'disclosure',label:'CONFIDENTIAL',transform:'ai'}),{code:'RECOVERING'});
 await db.restore(complete);
 assert.equal((await f.call('manager','documentRead',{id:o.id,documentId:doc,version:1,purpose:'summary'})).content,'synthetic document');
 await assert.rejects(f.call('manager','documentRead',{id:o.id,documentId:doc,version:1,purpose:'disclosure'}),{code:'PERMISSION_DENIED'});
}));

nodeTest('BF-13 commit response loss then old DB restore cannot abort classification intent',()=>withControls(async(f,{cluster})=>{
 const o=f.create();await f.call('operator','create',o);const db=await snapshots(f,cluster),old=db.dump('intent-before'),id=randomUUID(),key=randomUUID(),body={id,scope,source:{kind:'object',id:o.id,projection:['title']},label:'STRICT',purposes:['summary']};
 f.kernel.fault=async p=>{if(p==='enterprise-after-commit')throw Error('lost commit response');};await assert.rejects(f.call('operator','informationCreate',body,key));f.kernel.fault=async()=>{};
 assert.equal(f.kernel.journal.records().filter(x=>x.informationControlId===id).at(-1).phase,'INTENT');
 const complete=db.dump('intent-complete');await db.restore(old);const journal=JSON.stringify(f.kernel.journal.records());
 for(let n=0;n<2;n++){await assert.rejects(f.kernel.enterpriseRecover(f.credentials.manager),{code:'RECOVERING'});await assert.rejects(f.call('reader','get',{id:o.id,projection:['title']}),{code:'RECOVERING'});await assert.rejects(f.call('operator','informationCreate',body,key),{code:'RECOVERING'});restart(f);}
 assert.equal(JSON.stringify(f.kernel.journal.records()),journal);
 await db.restore(complete);await f.kernel.enterpriseRecover(f.credentials.manager);assert.equal(f.kernel.journal.records().filter(x=>x.informationControlId===id).at(-1).phase,'COMMITTED');
 await f.call('operator','informationCreate',body,key);assert.equal((await f.owner.query('SELECT 1 FROM actions WHERE key=$1',['v2:'+key])).rowCount,1);await assert.rejects(f.call('reader','get',{id:o.id,purpose:'summary'}),{code:'PERMISSION_DENIED'});
}));

nodeTest('BF-13 pre-upgrade journal cannot certify missing legacy classification as unclassified',()=>withControls(async(f,{cluster})=>{
 const {RecoveryJournal}=await import('../../src/adapters/journal.mjs');const o=f.create();await f.call('operator','create',o);const db=await snapshots(f,cluster),old=db.dump('legacy-before'),id=randomUUID();
 await f.call('operator','informationCreate',{id,scope,source:{kind:'object',id:o.id,projection:['title']},label:'STRICT',purposes:['summary']});
 const legacy=new RecoveryJournal(cluster.directory+'/legacy-classification.jsonl',{bootstrap:true});
 for(const record of f.kernel.journal.records()){if(record.operationKind==='enterprise-information')continue;const {informationRecoveryVersion,informationControlId,recordHash,previousHash,sequence,...body}=record;legacy.append(body);}
 f.journal=legacy;restart(f);await assert.rejects(f.call('reader','get',{id:o.id,purpose:'summary'}),{code:'PERMISSION_DENIED'});
 const complete=db.dump('legacy-complete');await db.restore(old);await assert.rejects(f.call('reader','get',{id:o.id,projection:['title']}),{code:'RECOVERING'});await db.restore(complete);assert.equal((await f.call('manager','get',{id:o.id,purpose:'summary'})).informationPolicy.label,'STRICT');
}));

async function snapshots(f,cluster){
 const {execFileSync}=await import('node:child_process'),schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database];
 return {dump(name){const path=cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;},async restore(path){await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});const ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;}};
}

nodeTest('BF-36 AI derivation binds authorized purpose to real model HTTP and preserves lineage recovery',async()=>{
 const {localEnvironment}=await import('../../scripts/enterprise/local.mjs'),{tokenDigest}=await import('../../src/contracts.mjs'),{mkdir,writeFile}=await import('node:fs/promises');
 const env=await localEnvironment(),f=env.f,trace=[],output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';
 let gateway=env.gateway;
 const api=async(who,operation,body,key=randomUUID())=>{const r=await fetch(gateway.origin+'/api',{method:'POST',headers:{cookie:'enterprise_session='+f.credentials[who].token,origin:gateway.origin,'content-type':'application/json','x-csrf-token':'bf36'},body:JSON.stringify({contractVersion:'2.0.0',operation,body,key})});const result={status:r.status,body:await r.json()};trace.push({who,operation,body,key,...result});return result;};
 const row=async id=>(await f.owner.query('SELECT * FROM enterprise_controls WHERE id=$1',[id])).rows[0];
 const rejected=async(body,code,who='operator',key=randomUUID())=>{const n=env.model.requests.length,r=await api(who,'informationDerive',body,key);assert.equal(r.body.error.code,code,JSON.stringify(r));assert.equal(env.model.requests.length,n);};
 try{
  for(const who of ['operator','manager','reader','other','tenant2'])await f.owner.query('INSERT INTO enterprise_browser_sessions VALUES($1,$2)',[tokenDigest(f.credentials[who].token),'bf36']);
  const parents=[];for(const purposes of [['disclosure'],['summary','disclosure']]){const o=f.create();o.fields.title='BF36 synthetic purpose canary '+parents.length;await f.call('operator','create',o);const id=randomUUID();assert.equal((await api('operator','informationCreate',{id,scope,source:{kind:'object',id:o.id,projection:['title']},label:'STRICT',purposes})).status,200);parents.push({id,o,purposes});}
  const body={id:randomUUID(),scope,sources:parents.map(p=>p.id),purpose:'disclosure',label:'STRICT',transform:'ai'},key=randomUUID();
  await rejected({...body,id:randomUUID(),purpose:'summary'},'PERMISSION_DENIED');
  const derived=await api('operator','informationDerive',body,key);assert.equal(derived.status,200);assert.equal(env.model.requests.length,1);
  await mkdir(output,{recursive:true});await writeFile(output+'/bf36-initial.json',JSON.stringify({trace,model:env.model.requests,row:await row(body.id)},null,2));
  assert.equal(env.model.requests[0].purpose,'disclosure','model purpose must equal the purpose authorized for every parent');assert.match(env.model.requests[0].source.fields.text,/BF36 synthetic purpose canary 0/);assert.match(env.model.requests[0].source.fields.text,/BF36 synthetic purpose canary 1/);assert.deepEqual(env.model.requests[0].allowedTools,[]);assert.equal(env.model.requests[0].maxCost,10);
  assert.deepEqual((await row(body.id)).data.purposes,['disclosure']);assert.equal((await row(body.id)).data.executionAllowed,false);assert.equal((await row(body.id)).data.label,'STRICT');
  assert.deepEqual(await api('operator','informationDerive',body,key),derived);assert.equal(env.model.requests.length,1);
  for(const who of ['reader','other','tenant2'])await rejected({...body,id:randomUUID()},who==='reader'?'PERMISSION_DENIED':'NOT_FOUND',who);
  for(const mode of ['tool','grounding','type','cost','down']){env.model.mode(mode);const bad={...body,id:randomUUID()},n=env.model.requests.length,r=await api('operator','informationDerive',bad);assert.equal(r.body.error.code,mode==='down'?'UNAVAILABLE':'INVALID_ARGUMENT');assert.equal(env.model.requests.length,n+1);assert.equal(env.model.requests.at(-1).purpose,'disclosure');assert.equal(await row(bad.id),undefined);}env.model.mode('normal');
  // A strengthened root policy invalidates both a new derivation and a replay,
  // before any additional model request; no summary purpose is added to parent 0.
  const second=parents[1];assert.equal((await api('operator','informationCreate',{id:randomUUID(),scope,source:{kind:'object',id:second.o.id,projection:['title']},label:'STRICT',purposes:['summary']})).status,200);
  await rejected({...body,id:randomUUID()},'PERMISSION_DENIED');await rejected(body,'PERMISSION_DENIED','operator',key);
  // A separate disclosure-only root exercises live revocation and real restore.
  const fresh={...body,id:randomUUID(),sources:[parents[0].id]},freshKey=randomUUID();assert.equal((await api('operator','informationDerive',fresh,freshKey)).status,200);
  const db=await snapshots(f,env.cluster),before=db.dump('bf36-before-revocation');
  await f.call('publisher','grant',{principal:'operator',scopes:[scope],operations:['read','search','action'],fields:['PUBLIC','INTERNAL','CONFIDENTIAL']});
  await rejected({...fresh,id:randomUUID()},'PERMISSION_DENIED');await rejected(fresh,'PERMISSION_DENIED','operator',freshKey);
  await gateway.close();await db.restore(before);f.kernel.proposalPort=new ProposalPort(env.model.url);const {enterpriseGateway}=await import('../../src/enterprise/gateway.mjs');gateway=await enterpriseGateway(f.kernel,{issuer:env.idp.issuer});
  await rejected({...fresh,id:randomUUID()},'PERMISSION_DENIED');await rejected(fresh,'PERMISSION_DENIED','operator',freshKey);
  assert.equal((await api('manager','informationDerive',{...fresh,id:randomUUID()})).status,200);assert.equal(env.model.requests.at(-1).purpose,'disclosure');
  // Loss of the committed classification is fenced by the independent journal.
  await f.owner.query('DELETE FROM enterprise_controls WHERE id=$1',[parents[0].id]);await rejected({...fresh,id:randomUUID()},'RECOVERING','manager');
  assert.equal(env.web.requests.length,0);assert.equal((await f.owner.query('SELECT count(*)::int n FROM outbox')).rows[0].n,0);
 }finally{await mkdir(output,{recursive:true});await writeFile(output+'/bf36-http.json',JSON.stringify({trace,model:env.model.requests,journal:f.kernel.journal.records(),external:env.web.requests},null,2));if(gateway!==env.gateway)await gateway.close();await env.close();}
});
