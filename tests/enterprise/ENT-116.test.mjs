import {test as nodeTest} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {withControls,scope,work} from './control-helper.mjs';
const recipientScope={...scope,departmentId:'synthetic-hr'};
test('ENT-116 AC-01 positive persistence four journeys department handoff common ID',()=>withControls(async f=>{
 for(const flow of ['lead-to-cash','procure-to-pay','hire-to-retire','incident-to-resolution']){const id=randomUUID(),eventId=randomUUID();await f.call('operator','journeyCreate',{id,scope,flow});await f.call('operator','handoffOffer',{id,recipientScope,payload:{reference:'synthetic-reference',task:'合成・責任移管'},eventId,sequence:1});await f.call('other','handoffAccept',{id,eventId});assert.equal((await work(f,id,'handoff-1','dispatch','other')).state,'ACCEPTED');const v=await f.call('other','controlRead',{id});assert.equal(v.data.offer.payload.task,'合成・責任移管');assert.equal(v.data.author,undefined);}
}));
test('ENT-116 AC-02 negative-authorization duplicate gap cross entity and cancelled execution',()=>withControls(async f=>{
 const id=randomUUID(),eventId=randomUUID();await f.call('operator','journeyCreate',{id,scope,flow:'lead-to-cash'});const offer={id,recipientScope,payload:{reference:'synthetic-reference',task:'引継ぎ'},eventId,sequence:1};await assert.rejects(f.call('operator','handoffOffer',{...offer,sequence:2}),{code:'INVALID_STATE'});await assert.rejects(f.call('operator','handoffOffer',{...offer,recipientScope:{...recipientScope,legalEntityId:'foreign'}}),{code:'PERMISSION_DENIED'});await f.call('operator','handoffOffer',offer);assert.equal((await f.call('operator','handoffOffer',offer)).state,'DUPLICATE');await assert.rejects(f.call('manager','handoffAccept',{id,eventId}),{code:'NOT_FOUND'});await f.call('other','handoffAccept',{id,eventId});await f.call('operator','journeyCancel',{id});await assert.rejects(work(f,id,'handoff-1','dispatch','other'),{code:'INVALID_STATE'});
}));
test('ENT-116 AC-03 failure-recovery recipient effect lost ack and approved compensation',()=>withControls(async(f,{a})=>{
 const id=randomUUID(),eventId=randomUUID();await f.call('operator','journeyCreate',{id,scope,flow:'incident-to-resolution'});await f.call('operator','handoffOffer',{id,recipientScope,payload:{reference:'incident-1',task:'対応'},eventId,sequence:1});await f.call('other','handoffAccept',{id,eventId});a.loseNext();assert.equal((await work(f,id,'handoff-1','dispatch','other')).state,'UNKNOWN');await f.call('operator','journeyCancel',{id});assert.equal((await work(f,id,'handoff-1','reconcile','other')).state,'ACCEPTED');await assert.rejects(work(f,id,'handoff-1','withdraw','other'),{code:'INVALID_STATE'});await f.call('other','handoffCompensateApprove',{id,sequence:1});assert.equal((await work(f,id,'handoff-1','withdraw','other')).state,'WITHDRAWN');assert.equal((await a.ledger())[0].applied,1);
}));
test('ENT-116 multi-department sequence and cancellation survives restored state',()=>withControls(async f=>{
 const id=randomUUID(),eventId=randomUUID();await f.call('operator','journeyCreate',{id,scope,flow:'procure-to-pay'});await f.call('operator','handoffOffer',{id,recipientScope,payload:{reference:'procurement',task:'見積確認'},eventId,sequence:1});await f.call('other','handoffAccept',{id,eventId});await work(f,id,'handoff-1','dispatch','other');const second=randomUUID();await f.call('other','handoffOffer',{id,recipientScope:scope,payload:{reference:'invoice',task:'支払照合'},eventId:second,sequence:2});await f.call('manager','handoffAccept',{id,eventId:second});await work(f,id,'handoff-2');const old=(await f.owner.query('SELECT data FROM enterprise_controls WHERE id=$1',[id])).rows[0].data;await f.call('operator','journeyCancel',{id});await f.call('other','handoffCompensateApprove',{id,sequence:1});await assert.rejects(work(f,id,'handoff-1','withdraw','other'),{code:'INVALID_STATE'});await f.call('manager','handoffCompensateApprove',{id,sequence:2});await work(f,id,'handoff-2','withdraw');await work(f,id,'handoff-1','withdraw','other');await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[id,old]);await assert.rejects(f.call('manager','handoffOffer',{id,recipientScope,payload:{reference:'late',task:'中止後'},eventId:randomUUID(),sequence:3}),{code:'INVALID_STATE'});
}));

function test(name,fn){const labels=['positive','negative-authorization','persistence','failure-recovery'].filter(x=>name.includes(x));return nodeTest(name,t=>{const run=(ctx,n)=>n===labels.length?fn(ctx):ctx.test(labels[n]+' '+name,child=>run(child,n+1));return run(t,0);});}

async function cancelledJourney(f){
 const id=randomUUID(),eventId=randomUUID();await f.call('operator','journeyCreate',{id,scope,flow:'incident-to-resolution'});await f.call('operator','handoffOffer',{id,recipientScope,payload:{reference:'bf14-synthetic',task:'合成・補償認可'},eventId,sequence:1});await f.call('other','handoffAccept',{id,eventId});assert.equal((await work(f,id,'handoff-1','dispatch','other')).state,'ACCEPTED');await f.call('operator','journeyCancel',{id});return id;
}
async function grantRecipient(f,principal,fields=['INTERNAL'],scopes=[recipientScope],ops=['read','approve']){
 await f.owner.query("UPDATE enterprise_grants SET scopes=$1 WHERE principal='publisher'",[JSON.stringify([scope,recipientScope,{...recipientScope,caseId:'other-case'}])]);
 await f.call('publisher','grant',{principal,scopes,operations:ops,fields});
}
async function httpClient(f){
 const {enterpriseGateway}=await import('../../src/enterprise/gateway.mjs'),{tokenDigest}=await import('../../src/contracts.mjs');
 for(const who of ['reader','other','manager','operator','tenant2'])await f.owner.query('INSERT INTO enterprise_browser_sessions VALUES($1,$2) ON CONFLICT DO NOTHING',[tokenDigest(f.credentials[who].token),'bf14-csrf']);
 const gateway=await enterpriseGateway(f.kernel,{issuer:'http://127.0.0.1:1'});
 return {close:()=>gateway.close(),async call(who,operation,body,key=randomUUID()){const response=await fetch(gateway.origin+'/api',{method:'POST',headers:{cookie:'enterprise_session='+f.credentials[who].token,origin:gateway.origin,'content-type':'application/json','x-csrf-token':'bf14-csrf'},body:JSON.stringify({contractVersion:'2.0.0',operation,body,key})});return {status:response.status,body:await response.json()};}};
}
nodeTest('BF-14 public HTTP rejects first and repeated compensation approval without classification',()=>withControls(async(f,{a})=>{
 const id=await cancelledJourney(f);await grantRecipient(f,'reader');const http=await httpClient(f);try{
 assert.equal((await http.call('reader','controlRead',{id})).status,403);
 const before=(await f.owner.query('SELECT revision,data FROM enterprise_controls WHERE id=$1',[id])).rows[0],key=randomUUID(),requests=a.requests.length;
 const first=await http.call('reader','handoffCompensateApprove',{id,sequence:1},key),retry=await http.call('reader','handoffCompensateApprove',{id,sequence:1},key);
 const withdrawn=await http.call('other','controlWork',{id,channel:'handoff-1',mode:'withdraw'}),after=(await f.owner.query('SELECT revision,data FROM enterprise_controls WHERE id=$1',[id])).rows[0];
 const actions=(await f.owner.query('SELECT state FROM actions WHERE key=$1',['v2:'+key])).rows;
 const history=(await f.owner.query("SELECT event FROM enterprise_control_history WHERE id=$1 AND event->>'event'='handoffCompensateApprove'",[id])).rows;
 console.log(JSON.stringify({bf14:{first:first.status,retry:retry.status,worker:withdrawn,revisionBefore:before.revision,revisionAfter:after.revision,actions,approvalHistory:history.length,externalRequests:a.requests.length-requests,ledger:(await a.ledger()).map(x=>({applied:x.applied,withdrawn:x.withdrawn}))}}));
 assert.equal(first.status,403);assert.equal(retry.status,403);assert.deepEqual(after,before);assert.equal(actions.length,0);assert.equal(history.length,0);assert.equal((await f.owner.query("SELECT 1 FROM audit WHERE record->>'kind'='EnterpriseCommand' AND record->>'operation'='handoffCompensateApprove' AND record->>'objectId'=$1",[id])).rowCount,0);assert.equal((await f.owner.query("SELECT 1 FROM audit WHERE record->>'kind'='Denied' AND record->>'operation'='enterprise:handoffCompensateApprove' AND record->>'actor'='reader'")).rowCount,2);assert.equal(a.requests.length,requests);assert.equal((await a.ledger())[0].withdrawn,0);
 }finally{await http.close();}
}));

nodeTest('BF-14 exact recipient scope author delegation and replay boundaries',()=>withControls(async(f,{a})=>{
 const id=await cancelledJourney(f),body={id,sequence:1},requests=a.requests.length;
 const http=await httpClient(f);try{
 for(const who of ['manager','tenant2']){const r=await http.call(who,'handoffCompensateApprove',body);assert.equal(r.status,404);}
 await grantRecipient(f,'reader',['CONFIDENTIAL'],[{...recipientScope,caseId:'other-case'}]);assert.equal((await http.call('reader','handoffCompensateApprove',body)).status,404);
 await grantRecipient(f,'operator',['CONFIDENTIAL'],[scope,recipientScope],['read','action','approve']);assert.equal((await http.call('operator','handoffCompensateApprove',body)).status,403);
 await grantRecipient(f,'reader',['CONFIDENTIAL']);const delegation=randomUUID();await f.call('other','delegate',{id:delegation,actor:'reader',scopes:[recipientScope],operations:['approve'],expires:'2099-01-01T00:00:00Z'});
 await assert.rejects(f.kernel.enterprise({...f.credentials.reader,delegationId:delegation},{operation:'handoffCompensateApprove',body,key:randomUUID()}),{code:'PERMISSION_DENIED'});
 const key=randomUUID();assert.equal((await http.call('reader','handoffCompensateApprove',body,key)).status,200);assert.equal((await http.call('reader','handoffCompensateApprove',body,key)).status,200);
 assert.equal((await f.owner.query('SELECT 1 FROM actions WHERE key=$1',['v2:'+key])).rowCount,1);
 await grantRecipient(f,'reader',['CONFIDENTIAL'],[scope]);assert.equal((await http.call('reader','handoffCompensateApprove',body,key)).status,404);
 assert.equal(a.requests.length,requests);assert.equal((await a.ledger())[0].withdrawn,0);
 }finally{await http.close();}
}));

nodeTest('BF-14 legacy stored ineligible approval cannot authorize withdrawal or uncertain reconciliation',()=>withControls(async(f,{a})=>{
 const {authority}=await import('../../src/enterprise/security.mjs'),{EnterpriseRepository}=await import('../../src/adapters/enterprise.mjs');
 const id=await cancelledJourney(f),requests=a.requests.length;
 // Synthetic pre-fix data: current revisions deliberately match, so the worker
 // must reject the target permission rather than relying only on stale revision.
 for(const [fields,scopes] of [[['INTERNAL'],[recipientScope]],[['CONFIDENTIAL'],[scope]],[['CONFIDENTIAL'],[{...recipientScope,caseId:'other-case'}]]]){
  await grantRecipient(f,'reader',fields,scopes);const saved=await f.state.transaction(u=>authority(u,new EnterpriseRepository(u),f.credentials.reader,'approve'));
  await f.owner.query("UPDATE enterprise_controls SET data=jsonb_set(data,'{steps,0,compensationAuthority}',$2) WHERE id=$1",[id,JSON.stringify(saved)]);
  for(const [mode,state] of [['withdraw','ACCEPTED'],['reconcile','WITHDRAW_UNKNOWN']]){
   await f.owner.query('UPDATE enterprise_control_deliveries SET state=$2 WHERE id=$1',[id,state]);
   await assert.rejects(work(f,id,'handoff-1',mode,'other'),e=>['NOT_FOUND','PERMISSION_DENIED'].includes(e.code));
   assert.equal((await f.owner.query('SELECT state FROM enterprise_control_deliveries WHERE id=$1',[id])).rows[0].state,state);
  }
 }
 assert.equal(a.requests.length,requests);assert.equal((await a.ledger())[0].withdrawn,0);
}));

nodeTest('BF-14 approval revocation before preparation and immediately before I/O prevents external calls',()=>withControls(async(f,{a})=>{
 const id=await cancelledJourney(f),requests=a.requests.length;await grantRecipient(f,'reader',['CONFIDENTIAL']);await f.call('reader','handoffCompensateApprove',{id,sequence:1});
 await grantRecipient(f,'reader',['INTERNAL']);await assert.rejects(work(f,id,'handoff-1','withdraw','other'),{code:'STALE_APPROVAL'});assert.equal(a.requests.length,requests);
 await grantRecipient(f,'reader',['CONFIDENTIAL']);await f.call('reader','handoffCompensateApprove',{id,sequence:1});
 f.kernel.fault=async p=>{if(p==='control-before-send')await f.owner.query("UPDATE enterprise_grants SET fields='[\"INTERNAL\"]',revision=revision+1 WHERE principal='reader'");};
 const stopped=await work(f,id,'handoff-1','withdraw','other');assert.equal(stopped.state,'WITHDRAW_UNKNOWN');assert.equal(stopped.code,'STALE_APPROVAL');assert.equal(a.requests.length,requests);assert.equal((await a.ledger())[0].withdrawn,0);
 f.kernel.fault=async()=>{};await assert.rejects(work(f,id,'handoff-1','reconcile','other'),{code:'STALE_APPROVAL'});assert.equal(a.requests.length,requests);
 await f.call('other','handoffCompensateApprove',{id,sequence:1});assert.equal((await work(f,id,'handoff-1','reconcile','other')).state,'ACCEPTED');assert.equal((await work(f,id,'handoff-1','withdraw','other')).state,'WITHDRAWN');await assert.rejects(work(f,id,'handoff-1','withdraw','other'),{code:'INVALID_STATE'});
 assert.deepEqual((await a.ledger()).map(x=>({applied:x.applied,withdrawn:x.withdrawn})),[{applied:1,withdrawn:1}]);assert.equal(a.requests.filter(x=>x.path==='/compensations').length,1);
}));

async function bf23Journey(f){
 const id=randomUUID(),eventId=randomUUID();await f.call('operator','journeyCreate',{id,scope,flow:'incident-to-resolution'});await f.call('operator','handoffOffer',{id,recipientScope,payload:{reference:'bf23',task:'失効後の復旧'},eventId,sequence:1});await f.call('other','handoffAccept',{id,eventId});
 await grantRecipient(f,'reader',['CONFIDENTIAL'],[recipientScope],['read','search','approve','worker','recovery']);return id;
}
for(const invalidation of ['revocation','disabled','revision'])nodeTest('BF-23 HTTP lost result and fresh compensation after original recipient '+invalidation,()=>withControls(async(f,{a})=>{
 const id=await bf23Journey(f),http=await httpClient(f),body={id,channel:'handoff-1'};try{
 a.loseNext();assert.equal((await http.call('other','controlWork',{...body,mode:'dispatch'})).body.result.state,'UNKNOWN');
 const step=(await f.owner.query('SELECT data FROM enterprise_controls WHERE id=$1',[id])).rows[0].data.steps[0];
 if(invalidation==='disabled')await f.owner.query("UPDATE principals SET active=false WHERE id='other'");
 else await grantRecipient(f,'other',['CONFIDENTIAL'],[recipientScope],invalidation==='revocation'?['read']:['read','approve','worker','recovery']);
 const n=a.requests.length,r=await http.call('reader','controlWork',{...body,mode:'reconcile'});console.log(JSON.stringify({bf23:invalidation,response:r,requests:a.requests.slice(n),ledger:await a.ledger()}));
 assert.equal(r.status,200);assert.equal(r.body.result.state,'ACCEPTED');assert.deepEqual(a.requests.slice(n).map(x=>x.method),['GET']);assert.deepEqual((await f.owner.query('SELECT data FROM enterprise_controls WHERE id=$1',[id])).rows[0].data.steps[0],step);
 // No replacement of the original acceptance; new compensation is independent.
 assert.equal((await http.call('reader','handoffAccept',{id,eventId:step.eventId})).body.error.code,'INVALID_STATE');
 await f.call('operator','journeyCancel',{id});assert.equal((await http.call('reader','controlWork',{...body,mode:'withdraw'})).body.error.code,'INVALID_STATE');
 assert.equal((await http.call('reader','handoffCompensateApprove',{id,sequence:1})).status,200);
 f.kernel.fault=async p=>{if(p==='control-after-send')throw Error('lost compensation acknowledgement');};assert.equal((await http.call('reader','controlWork',{...body,mode:'withdraw'})).body.result.state,'WITHDRAW_UNKNOWN');f.kernel.fault=async()=>{};
 const q=a.requests.length;assert.equal((await http.call('reader','controlWork',{...body,mode:'reconcile'})).body.result.state,'WITHDRAWN');assert.deepEqual(a.requests.slice(q).map(x=>x.method),['GET']);
 assert.deepEqual((await a.ledger()).map(x=>({applied:x.applied,withdrawn:x.withdrawn})),[{applied:1,withdrawn:1}]);
 assert.equal((await http.call('reader','controlWork',{...body,mode:'withdraw'})).body.error.code,'INVALID_STATE');
 }finally{await http.close();}
}));
nodeTest('BF-23 current recovery authority fixed operation and recipient scope remain required',()=>withControls(async(f,{a,b})=>{
 const id=await bf23Journey(f);a.loseNext();await work(f,id,'handoff-1','dispatch','other');await grantRecipient(f,'other',['CONFIDENTIAL'],[recipientScope],['read']);const n=a.requests.length,http=await httpClient(f);
 try{
 for(const who of ['operator','manager','tenant2'])assert.ok([403,404].includes((await http.call(who,'controlWork',{id,channel:'handoff-1',mode:'reconcile'})).status));
 await grantRecipient(f,'reader',['INTERNAL'],[recipientScope],['read','recovery']);assert.equal((await http.call('reader','controlWork',{id,channel:'handoff-1',mode:'reconcile'})).status,403);
 await grantRecipient(f,'reader',['CONFIDENTIAL'],[recipientScope],['read','recovery']);
 const port=f.kernel.controlPorts.handoff;f.kernel.controlPorts.handoff=f.kernel.controlPorts.mail;await assert.rejects(work(f,id,'handoff-1','reconcile','reader'),{code:'PERMISSION_DENIED'});f.kernel.controlPorts.handoff=port;
 const d=(await f.owner.query('SELECT * FROM enterprise_control_deliveries WHERE id=$1',[id])).rows[0];await f.owner.query("UPDATE enterprise_control_deliveries SET event=jsonb_set(event,'{payload,sequence}','2') WHERE id=$1",[id]);await assert.rejects(work(f,id,'handoff-1','reconcile','reader'),{code:'INCONSISTENT_STATE'});await f.owner.query('UPDATE enterprise_control_deliveries SET event=$2 WHERE id=$1',[id,d.event]);
 assert.equal(a.requests.length,n);assert.equal(b.requests.length,0);
 f.kernel.fault=async p=>{if(p==='control-before-send')await f.owner.query("UPDATE enterprise_grants SET operations='[\"read\"]',revision=revision+1 WHERE principal='reader'");};const stopped=await work(f,id,'handoff-1','reconcile','reader');assert.equal(stopped.code,'PERMISSION_DENIED');assert.equal(a.requests.length,n);f.kernel.fault=async()=>{};
 await grantRecipient(f,'reader',['CONFIDENTIAL'],[recipientScope],['read','recovery']);assert.equal((await work(f,id,'handoff-1','reconcile','reader')).state,'ACCEPTED');
 }finally{await http.close();}
}));
nodeTest('BF-23 stale acceptance blocks dispatch and ABSENT requires human review after restart',()=>withControls(async(f,{a})=>{
 const id=await bf23Journey(f);await grantRecipient(f,'other',['CONFIDENTIAL'],[recipientScope],['read']);await assert.rejects(work(f,id,'handoff-1','dispatch','reader'),{code:'PERMISSION_DENIED'});
 await grantRecipient(f,'other',['CONFIDENTIAL'],[recipientScope],['read','approve','worker','recovery']);await assert.rejects(work(f,id,'handoff-1','dispatch','reader'),{code:'STALE_APPROVAL'});assert.equal(a.requests.length,0);
 // Separate valid acceptance: revoke between preparation and I/O.
 const id2=await bf23Journey(f);f.kernel.fault=async p=>{if(p==='control-before-send')await f.owner.query("UPDATE enterprise_grants SET revision=revision+1 WHERE principal='other'");};assert.equal((await work(f,id2,'handoff-1','dispatch','reader')).code,'STALE_APPROVAL');assert.equal(a.requests.length,0);
 const {restart}=await import('./helpers.mjs'),ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;
 for(let i=0;i<2;i++){const r=await work(f,id2,'handoff-1','reconcile','reader');assert.equal(r.state,'UNKNOWN');assert.equal(r.observation,'ABSENT');assert.equal(r.requiresHumanReview,true);}
 assert.ok(a.requests.every(r=>r.method==='GET'));assert.equal((await a.ledger()).length,0);
}));
nodeTest('BF-23 worker termination database restore and retry retain recipient revocation without duplicate effects',()=>withControls(async(f,{a,cluster})=>{
 const {spawn,execFileSync}=await import('node:child_process'),id=await bf23Journey(f),schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],path=cluster.directory+'/bf23.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);
 const {host,port,user,database,options}=f.state.pool.options;
 const childCode=`import {PostgresState} from './src/adapters/postgres.mjs';import {RecoveryJournal} from './src/adapters/journal.mjs';import {Kernel} from './src/kernel.mjs';import {SyntheticPort} from './src/enterprise/worker.mjs';let s='';for await(const c of process.stdin)s+=c;const b=JSON.parse(s),state=new PostgresState(b.config),k=new Kernel(state,new RecoveryJournal(b.journal),{fault:async p=>{if(p==='control-after-send')process.exit(73)}});k.controlPorts={handoff:new SyntheticPort(b.url)};try{await k.enterpriseControlWork(b.credential,{id:b.id,channel:'handoff-1',mode:'dispatch'})}finally{await state.close()}`;
 const exit=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',childCode],{stdio:['pipe','pipe','pipe']});let stderr='';child.stderr.on('data',x=>stderr+=x);child.on('error',reject);child.on('exit',code=>resolve({code,stderr}));child.stdin.end(JSON.stringify({config:{host,port,user,database,options},journal:f.journal.path,credential:f.credentials.other,id,url:a.url}));});assert.equal(exit.code,73,exit.stderr);
 await grantRecipient(f,'other',['CONFIDENTIAL'],[recipientScope],['read']);await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});
 const {restart}=await import('./helpers.mjs'),ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;const http=await httpClient(f),n=a.requests.length;try{
 for(let i=0;i<2;i++)assert.equal((await http.call('reader','controlWork',{id,channel:'handoff-1',mode:'reconcile'})).body.result.state,'ACCEPTED');assert.deepEqual(a.requests.slice(n).map(r=>r.method),['GET','GET']);
 assert.equal((await http.call('other','controlWork',{id,channel:'handoff-1',mode:'dispatch'})).status,403);
 await f.call('operator','journeyCancel',{id});await f.call('reader','handoffCompensateApprove',{id,sequence:1});assert.equal((await work(f,id,'handoff-1','withdraw','reader')).state,'WITHDRAWN');assert.deepEqual((await a.ledger()).map(x=>({applied:x.applied,withdrawn:x.withdrawn})),[{applied:1,withdrawn:1}]);
 }finally{await http.close();}
}));

async function bf24Offer(f,delegated=false){
 await grantRecipient(f,'operator',['CONFIDENTIAL'],[scope,recipientScope],['read','search','action','approve','worker','recovery']);
 await grantRecipient(f,'manager',['CONFIDENTIAL'],[scope,recipientScope],['read','search','action','approve','worker','recovery']);
 const id=randomUUID(),eventId=randomUUID(),body={id,eventId};await f.call('operator','journeyCreate',{id,scope,flow:'lead-to-cash'});
 const offer={id,recipientScope,eventId,sequence:1,payload:{reference:'bf24-synthetic',task:'委任時の独立受領'}};
 if(delegated){const delegationId=randomUUID();await f.call('operator','delegate',{id:delegationId,actor:'manager',scopes:[scope],operations:['action'],expires:'2099-01-01T00:00:00Z'});await f.kernel.enterprise({...f.credentials.manager,delegationId},{operation:'handoffOffer',body:offer,key:randomUUID()});}
 else await f.call('operator','handoffOffer',offer);
 return {id,eventId,body};
}
async function bf24Snapshot(f,id){return {record:(await f.owner.query('SELECT revision,data FROM enterprise_controls WHERE id=$1',[id])).rows,deliveries:(await f.owner.query('SELECT * FROM enterprise_control_deliveries WHERE id=$1',[id])).rows,actions:(await f.owner.query('SELECT * FROM actions ORDER BY id')).rows,outbox:(await f.owner.query('SELECT * FROM outbox ORDER BY operation_id')).rows,history:(await f.owner.query('SELECT * FROM enterprise_control_history WHERE id=$1 ORDER BY revision',[id])).rows,success:(await f.owner.query("SELECT record FROM audit WHERE record->>'kind'='EnterpriseCommand' AND record->>'objectId'=$1 ORDER BY sequence",[id])).rows};}
async function bf24Authority(f,credential){const {authority}=await import('../../src/enterprise/security.mjs'),{EnterpriseRepository}=await import('../../src/adapters/enterprise.mjs');return f.state.transaction(u=>authority(u,new EnterpriseRepository(u),credential,'approve'));}
nodeTest('BF-24 delegated self acceptance rejects without persisted effects and independent acceptance recovers',()=>withControls(async(f,{a})=>{
 const {id,body}=await bf24Offer(f),delegationId=randomUUID(),key=randomUUID();await f.call('operator','delegate',{id:delegationId,actor:'other',scopes:[recipientScope],operations:['approve'],expires:'2099-01-01T00:00:00Z'});
 const before=await bf24Snapshot(f,id);await assert.rejects(f.call('operator','handoffAccept',body),{code:'PERMISSION_DENIED'});
 for(let i=0;i<2;i++){let result,error;try{result=await f.kernel.enterprise({...f.credentials.other,delegationId},{operation:'handoffAccept',body,key});}catch(e){error=e.code;}console.log(JSON.stringify({bf24:'delegated-self',result,error,state:await bf24Snapshot(f,id),external:a.requests}));assert.equal(error,'PERMISSION_DENIED');}
 assert.deepEqual(await bf24Snapshot(f,id),before);const http=await httpClient(f);try{assert.equal((await http.call('other','controlWork',{id,channel:'handoff-1',mode:'dispatch'})).status,404);assert.equal(a.requests.length,0);assert.equal((await http.call('other','handoffAccept',body,key)).status,200);assert.equal((await http.call('other','handoffAccept',body,key)).status,200);assert.equal((await http.call('other','controlWork',{id,channel:'handoff-1',mode:'dispatch'})).body.result.state,'ACCEPTED');assert.equal((await a.ledger())[0].applied,1);}finally{await http.close();}
}));
nodeTest('BF-24 offer actor and subject both exclude recipient actor and subject',()=>withControls(async(f,{a})=>{
 const {id,body}=await bf24Offer(f,true);for(const who of ['operator','manager'])await assert.rejects(f.call(who,'handoffAccept',body),{code:'PERMISSION_DENIED'});
 const delegationId=randomUUID();await f.call('manager','delegate',{id:delegationId,actor:'other',scopes:[recipientScope],operations:['approve'],expires:'2099-01-01T00:00:00Z'});
 await assert.rejects(f.kernel.enterprise({...f.credentials.other,delegationId},{operation:'handoffAccept',body,key:randomUUID()}),{code:'PERMISSION_DENIED'});assert.equal((await bf24Snapshot(f,id)).deliveries.length,0);assert.equal(a.requests.length,0);
}));
nodeTest('BF-24 independent delegated acceptance persists and earlier step remains bound after next offer',()=>withControls(async(f,{a})=>{
 const {id,body}=await bf24Offer(f),delegationId=randomUUID(),key=randomUUID();await f.call('manager','delegate',{id:delegationId,actor:'other',scopes:[recipientScope],operations:['approve'],expires:'2099-01-01T00:00:00Z'});const credential={...f.credentials.other,delegationId},request={operation:'handoffAccept',body,key};
 assert.equal((await f.kernel.enterprise(credential,request)).state,'ACCEPTED');const {restart}=await import('./helpers.mjs'),ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;assert.equal((await f.kernel.enterprise(credential,request)).state,'ACCEPTED');
 await f.call('other','handoffOffer',{id,recipientScope:scope,eventId:randomUUID(),sequence:2,payload:{reference:'next',task:'次部門'}});
 assert.equal((await f.kernel.enterprise(credential,request)).state,'ACCEPTED');assert.equal((await work(f,id,'handoff-1','dispatch','other')).state,'ACCEPTED');assert.equal((await a.ledger())[0].applied,1);
}));
nodeTest('BF-24 stored self acceptance cannot replay or dispatch after restart and real restore but existing effect recovers',()=>withControls(async(f,{a,cluster})=>{
 const {id,body}=await bf24Offer(f),key=randomUUID();await f.call('other','handoffAccept',body,key);const delegationId=randomUUID();await f.call('operator','delegate',{id:delegationId,actor:'other',scopes:[recipientScope],operations:['approve'],expires:'2099-01-01T00:00:00Z'});
 const invalid=await bf24Authority(f,{...f.credentials.other,delegationId});await f.owner.query("UPDATE enterprise_controls SET data=jsonb_set(data,'{steps,0,authority}',$2) WHERE id=$1",[id,JSON.stringify(invalid)]);
 const {execFileSync}=await import('node:child_process'),schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],path=cluster.directory+'/bf24.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);
 const {restart}=await import('./helpers.mjs'),ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;
 for(let round=0;round<2;round++){
  const http=await httpClient(f);try{assert.equal((await http.call('other','handoffAccept',body,key)).status,403);assert.equal((await http.call('other','controlWork',{id,channel:'handoff-1',mode:'dispatch'})).status,403);assert.equal(a.requests.length,0);}finally{await http.close();}
  if(round===0){await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});restart(f);f.kernel.controlPorts=ports;}
 }
 // A synthetic legacy external effect already exists: observation and fresh
 // compensation must remain available, without accepting its old authority.
 const d=(await f.owner.query('SELECT * FROM enterprise_control_deliveries WHERE id=$1',[id])).rows[0];await ports.handoff.apply(d.operation_id,d.event);await f.owner.query("UPDATE enterprise_control_deliveries SET state='UNKNOWN' WHERE id=$1",[id]);
 assert.equal((await work(f,id,'handoff-1','reconcile','manager')).state,'ACCEPTED');await f.call('operator','journeyCancel',{id});await f.call('manager','handoffCompensateApprove',{id,sequence:1});assert.equal((await work(f,id,'handoff-1','withdraw','manager')).state,'WITHDRAWN');assert.deepEqual((await a.ledger()).map(x=>({applied:x.applied,withdrawn:x.withdrawn})),[{applied:1,withdrawn:1}]);
}));
nodeTest('BF-24 missing historical offer and final I/O separation failures prevent new effects',()=>withControls(async(f,{a})=>{
 const {id,body}=await bf24Offer(f),key=randomUUID();await f.call('other','handoffAccept',body,key);const saved=(await bf24Snapshot(f,id)).record[0].data;
 await f.owner.query("UPDATE enterprise_controls SET data=data #- '{steps,0,offerAuthority}' WHERE id=$1",[id]);await assert.rejects(f.call('other','handoffAccept',body,key),{code:'STALE_APPROVAL'});await assert.rejects(work(f,id,'handoff-1','dispatch','other'),{code:'STALE_APPROVAL'});assert.equal(a.requests.length,0);
 await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[id,saved]);
 f.kernel.fault=async p=>{if(p==='control-before-send')await f.owner.query("UPDATE enterprise_controls SET data=jsonb_set(data,'{steps,0,offerAuthority}',data#>'{steps,0,authority}') WHERE id=$1",[id]);};const stopped=await work(f,id,'handoff-1','dispatch','other');assert.equal(stopped.code,'PERMISSION_DENIED');assert.equal(stopped.state,'UNKNOWN');assert.equal(a.requests.length,0);f.kernel.fault=async()=>{};
 const result=await work(f,id,'handoff-1','reconcile','manager');assert.equal(result.observation,'ABSENT');assert.equal(result.requiresHumanReview,true);assert.ok(a.requests.every(r=>r.method==='GET'));
}));

async function bf25Collision(f,id,foreign=true){
 if(foreign){await f.owner.query("INSERT INTO principals(id,tenant,stores,operations) VALUES('bf25-foreign-actor','t2','[]','[]') ON CONFLICT DO NOTHING");}
 await f.call(foreign?'tenant2':'manager','delegate',{id,actor:foreign?'bf25-foreign-actor':'reader',scopes:[scope],operations:['read'],expires:'2099-01-01T00:00:00Z'});
 return (await f.owner.query("SELECT record FROM audit WHERE record->>'operation'='delegate' AND record->>'objectId'=$1 ORDER BY sequence DESC LIMIT 1",[id])).rows[0].record;
}
nodeTest('BF-25 shared audit excludes foreign tenant and same tenant different resource IDs over HTTP',()=>withControls(async f=>{
 const {source,rightBody,release}=await import('./control-helper.mjs');
 const journey=randomUUID();await f.call('operator','journeyCreate',{id:journey,scope,flow:'lead-to-cash'});const right=rightBody();await f.call('manager','rightGrant',right);
 const targets=[{id:journey,kind:'journey'},{id:right.id,kind:'right'},{id:await source(f),kind:'information'},{id:(await release(f)).id,kind:'release'}],http=await httpClient(f);
 try{for(const [i,x] of targets.entries()){
  const foreign=await bf25Collision(f,x.id,i%2===0),before=(await f.owner.query('SELECT previous_hash,hash,record FROM audit ORDER BY sequence')).rows;
  const response=await http.call('manager','controlAudit',{id:x.id,purpose:'summary'});assert.equal(response.status,200);const result=response.body.result;
  console.log(JSON.stringify({bf25:x.kind,foreignAction:foreign.actionId,events:result.events}));
  assert.ok(result.events.some(e=>e.kind==='EnterpriseCommand'&&e.operation!=='delegate'));
  assert.equal(JSON.stringify(result).includes(foreign.actionId),false);assert.equal(JSON.stringify(result).includes(foreign.inputDigest),false);assert.equal(result.events.some(e=>e.operation==='delegate'),false);
  assert.deepEqual((await f.owner.query('SELECT previous_hash,hash,record FROM audit ORDER BY sequence LIMIT $1',[before.length])).rows,before);
  assert.equal((await http.call('tenant2','controlAudit',{id:x.id,purpose:'summary'})).status,404);
 }}finally{await http.close();}
}));
nodeTest('BF-25 legacy proven commands and external recovery remain visible without unrelated metadata',()=>withControls(async(f,{a})=>{
 const id=await bf23Journey(f);await grantRecipient(f,'manager',['CONFIDENTIAL'],[scope,recipientScope],['read','audit','recovery']);a.loseNext();await work(f,id,'handoff-1','dispatch','other');await work(f,id,'handoff-1','reconcile','reader');
 const own=(await f.owner.query("SELECT record FROM audit WHERE record->>'operation'='journeyCreate' AND record->>'objectId'=$1",[id])).rows[0].record;
 const {resource,...legacy}=own;await f.state.transaction(u=>u.audit({...legacy,legacyWitness:'BF25-proven'}));
 await f.state.transaction(u=>u.audit({kind:'EnterpriseRead',operation:'controlRead',objectId:id,actor:'bf25-unproven',inputDigest:'bf25-unproven-digest'}));
 const external=(await f.owner.query("SELECT record FROM audit WHERE record->>'kind'='ControlExternalObserved' AND record->>'objectId'=$1",[id])).rows[0].record;const {resource:oldBinding,...legacyExternal}=external;await f.state.transaction(u=>u.audit({...legacyExternal,legacyWitness:'BF25-external'}));await f.call('manager','controlRead',{id});
 const result=await f.call('manager','controlAudit',{id});assert.ok(result.events.some(e=>e.legacyWitness==='BF25-external'));assert.ok(result.events.some(e=>e.kind==='EnterpriseRead'&&e.operation==='controlRead'));assert.ok(result.events.some(e=>e.legacyWitness==='BF25-proven'));assert.ok(result.events.some(e=>e.kind==='ControlExternalIntent'));assert.ok(result.events.some(e=>e.kind==='ControlExternalUncertain'));assert.ok(result.events.some(e=>e.kind==='ControlExternalObserved'));assert.equal(JSON.stringify(result).includes('bf25-unproven'),false);
 assert.equal((await a.ledger())[0].applied,1);
}));
nodeTest('BF-25 audit authorization per event scope classification revocation restart and real restore',()=>withControls(async(f,{cluster})=>{
 const id=await bf23Journey(f),foreign=await bf25Collision(f,id),http=await httpClient(f);
 try{
  const origin=(await http.call('manager','controlAudit',{id})).body.result;assert.ok(origin.events.some(e=>e.operation==='journeyCreate'));assert.equal(origin.events.some(e=>e.operation==='handoffAccept'),false);assert.equal(origin.history.some(e=>e.event.event==='handoffAccept'),false);
  const recipient=(await http.call('other','controlAudit',{id})).body.result;assert.ok(recipient.events.some(e=>e.operation==='handoffAccept'));assert.equal(recipient.events.some(e=>e.operation==='journeyCreate'),false);
  await grantRecipient(f,'reader',['CONFIDENTIAL'],[scope],['read','audit']);assert.equal((await http.call('reader','controlAudit',{id})).status,200);
  const {execFileSync}=await import('node:child_process'),schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],path=cluster.directory+'/bf25.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);
  await grantRecipient(f,'reader',['INTERNAL'],[scope],['read','audit']);assert.equal((await http.call('reader','controlAudit',{id})).status,403);
  await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});
 }finally{await http.close();}
 const {restart}=await import('./helpers.mjs'),ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;const restored=await httpClient(f);try{
  assert.equal((await restored.call('reader','controlAudit',{id})).status,403);
  const result=await restored.call('manager','controlAudit',{id});assert.equal(result.status,200);assert.equal(JSON.stringify(result).includes(foreign.actionId),false);assert.ok(result.body.result.events.some(e=>e.operation==='journeyCreate'));
  await grantRecipient(f,'reader',['CONFIDENTIAL'],[{...recipientScope,caseId:'other-case'}],['read','audit']);assert.equal((await restored.call('reader','controlAudit',{id})).status,404);
 }finally{await restored.close();}
}));
nodeTest('BF-25 audit chain tampering and audit write failure do not return successful reads',()=>withControls(async f=>{
 const id=randomUUID();await f.call('operator','journeyCreate',{id,scope,flow:'lead-to-cash'});const http=await httpClient(f);try{
 await f.owner.query("CREATE FUNCTION bf25_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.record->>'operation'='controlAudit' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER bf25_audit_failure BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION bf25_fail_audit()");
 assert.notEqual((await http.call('manager','controlAudit',{id})).status,200);await f.owner.query('DROP TRIGGER bf25_audit_failure ON audit');assert.equal((await http.call('manager','controlAudit',{id})).status,200);
 await f.owner.query("INSERT INTO audit(previous_hash,hash,record) VALUES('bf25-invalid-predecessor','bf25-invalid-hash','{\"kind\":\"synthetic-corruption\"}')");const bad=await http.call('manager','controlAudit',{id});assert.equal(bad.body.error.code,'INCONSISTENT_STATE');assert.equal(bad.body.result,undefined);
 }finally{await http.close();}
}));

async function bf26Journey(f,http){
 const id=randomUUID(),eventId=randomUUID();
 for(const [who,operation,body] of [['operator','journeyCreate',{id,scope,flow:'lead-to-cash'}],['operator','handoffOffer',{id,recipientScope,eventId,sequence:1,payload:{reference:'bf26',task:'部門別の進捗'}}],['other','handoffAccept',{id,eventId}]])assert.equal((await http.call(who,operation,body)).status,200);
 return id;
}
function bf26Progress(result,ops){
 assert.deepEqual(result.history.map(h=>h.event.event),ops);
 for(const h of result.history){assert.deepEqual(Object.keys(h).sort(),['event','revision']);assert.deepEqual(Object.keys(h.event),['event']);}
 assert.equal(result.historyMode,'progress');
 assert.equal(result.data.author,undefined);assert.equal(result.action_id,undefined);
 assert.ok((result.data.steps??[]).every(s=>!s.authority&&!s.offerAuthority&&!s.compensationAuthority));assert.equal(result.data.offer?.authority,undefined);
}
nodeTest('BF-26 HTTP origin and recipient detail cannot bypass scoped audit while business progress remains visible',()=>withControls(async(f,{a})=>{
 const http=await httpClient(f);try{
 const id=await bf26Journey(f,http),stored=(await f.owner.query('SELECT revision,action_id,event FROM enterprise_control_history WHERE id=$1 ORDER BY revision',[id])).rows;
 for(const [who,ops] of [['manager',['journeyCreate','handoffOffer']],['other',['handoffAccept']]]){
  const audit=await http.call(who,'controlAudit',{id}),detail=await http.call(who,'controlRead',{id});assert.equal(audit.status,200);assert.equal(detail.status,200);
  console.log(JSON.stringify({bf26:who,auditHistory:audit.body.result.history,detail:detail.body.result}));
  assert.deepEqual(audit.body.result.history.map(h=>h.event.event),ops);bf26Progress(detail.body.result,ops);
  for(const h of stored){assert.equal(JSON.stringify(detail).includes(h.action_id),false);assert.equal(JSON.stringify(detail).includes(h.event.digest),false);}
  assert.equal(detail.body.result.data.state,'ACCEPTED');assert.equal(detail.body.result.data.offer.payload.task,'部門別の進捗');
 }
 assert.equal((await http.call('operator','controlAudit',{id})).status,403);bf26Progress((await http.call('operator','controlRead',{id})).body.result,['journeyCreate','handoffOffer']);
 await grantRecipient(f,'reader',['CONFIDENTIAL'],[recipientScope],['read']);assert.equal((await http.call('reader','controlAudit',{id})).status,403);bf26Progress((await http.call('reader','controlRead',{id})).body.result,['handoffAccept']);assert.equal(a.requests.length,0);
 }finally{await http.close();}
}));
nodeTest('BF-26 later handoff restart and restored grants cannot revive restricted detail history',()=>withControls(async(f,{cluster})=>{
 let http=await httpClient(f);const {restart}=await import('./helpers.mjs');try{
 const id=await bf26Journey(f,http),next=randomUUID();assert.equal((await http.call('other','handoffOffer',{id,recipientScope:scope,eventId:next,sequence:2,payload:{reference:'bf26-next',task:'次工程'}})).status,200);assert.equal((await http.call('manager','handoffAccept',{id,eventId:next})).status,200);
 bf26Progress((await http.call('manager','controlRead',{id})).body.result,['journeyCreate','handoffOffer','handoffAccept']);
 await grantRecipient(f,'reader',['CONFIDENTIAL'],[scope,recipientScope],['read','audit']);const all=await http.call('reader','controlAudit',{id});assert.equal(all.body.result.history.length,5);
 const {execFileSync}=await import('node:child_process'),schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],path=cluster.directory+'/bf26.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);
 await grantRecipient(f,'reader',['CONFIDENTIAL'],[scope],['read']);await http.close();await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});const ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;http=await httpClient(f);
 assert.equal((await http.call('reader','controlAudit',{id})).status,403);bf26Progress((await http.call('reader','controlRead',{id})).body.result,['journeyCreate','handoffOffer','handoffAccept']);
 for(const [fields,scopes,ops,status] of [[['INTERNAL'],[scope],['read'],403],[['CONFIDENTIAL'],[{...recipientScope,caseId:'other-case'}],['read'],404],[['CONFIDENTIAL'],[scope],['search'],403]]){await grantRecipient(f,'reader',fields,scopes,ops);const r=await http.call('reader','controlRead',{id});assert.equal(r.status,status);assert.equal(r.body.result,undefined);}
 assert.equal((await http.call('tenant2','controlRead',{id})).status,404);
 }finally{await http.close();}
}));
nodeTest('BF-26 unproven history is excluded by both readers and failed read audit stays fail closed',()=>withControls(async f=>{
 const http=await httpClient(f);try{
 const id=await bf26Journey(f,http),stored=(await f.owner.query('SELECT * FROM enterprise_control_history WHERE id=$1 ORDER BY revision',[id])).rows;
 const collision=await bf25Collision(f,id);await f.owner.query('INSERT INTO enterprise_control_history VALUES($1,$2,$3,$4,$5)',['t1',id,99,collision.actionId,JSON.stringify({event:'journeyCreate',actor:collision.actor,subject:collision.subject,digest:'bf26-unproven'})]);
 for(const who of ['manager','other'])for(const op of ['controlRead','controlAudit']){const v=await http.call(who,op,{id});assert.equal(v.status,200);assert.equal(v.body.result.history.some(h=>h.revision===99),false);assert.equal(JSON.stringify(v).includes(collision.actionId),false);}
 assert.deepEqual((await f.owner.query('SELECT * FROM enterprise_control_history WHERE id=$1 AND revision<99 ORDER BY revision',[id])).rows,stored);
 await f.owner.query("CREATE FUNCTION bf26_fail_read_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.record->>'operation'='controlRead' THEN RAISE EXCEPTION 'synthetic read audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER bf26_read_audit_failure BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION bf26_fail_read_audit()");const failed=await http.call('manager','controlRead',{id});assert.notEqual(failed.status,200);assert.equal(failed.body.result,undefined);await f.owner.query('DROP TRIGGER bf26_read_audit_failure ON audit');bf26Progress((await http.call('manager','controlRead',{id})).body.result,['journeyCreate','handoffOffer']);
 }finally{await http.close();}
}));

nodeTest('BF-27 historical recipient can discover only its own recovery step after a later handoff',()=>withControls(async(f,{a,cluster})=>{
 let http=await httpClient(f);try{
 const id=await bf26Journey(f,http);a.loseNext();assert.equal((await http.call('other','controlWork',{id,channel:'handoff-1',mode:'dispatch'})).body.result.state,'UNKNOWN');
 const next=randomUUID();assert.equal((await http.call('other','handoffOffer',{id,recipientScope:scope,eventId:next,sequence:2,payload:{reference:'bf27-private',task:'後続部門だけの内容'}})).status,200);assert.equal((await http.call('manager','handoffAccept',{id,eventId:next})).status,200);assert.equal((await http.call('manager','controlWork',{id,channel:'handoff-2',mode:'dispatch'})).body.result.state,'ACCEPTED');
 const detail=await http.call('other','controlRead',{id});console.log(JSON.stringify({bf27Historical:detail}));assert.equal(detail.status,200);assert.deepEqual(detail.body.result.data.recoverySteps.map(s=>s.sequence),[1]);assert.equal(detail.body.result.data.offer.sequence,1);assert.equal(JSON.stringify(detail).includes('後続部門だけの内容'),false);assert.equal((await http.call('other','controlList',{kind:'journey'})).body.result.items.some(x=>x.id===id),true);
 const operation=(await f.owner.query("SELECT operation_id FROM enterprise_control_deliveries WHERE id=$1 AND channel='handoff-1'",[id])).rows[0].operation_id;
 await f.call('operator','journeyCancel',{id});await f.call('other','handoffCompensateApprove',{id,sequence:1});const requests=a.requests.length;assert.equal((await http.call('other','controlWork',{id,channel:'handoff-1',mode:'withdraw'})).status,400);assert.equal(a.requests.length,requests);assert.equal((await http.call('other','controlWork',{id,channel:'handoff-2',mode:'reconcile'})).status,404);
 await f.call('manager','handoffCompensateApprove',{id,sequence:2});assert.equal((await work(f,id,'handoff-2','withdraw')).state,'WITHDRAWN');
 await grantRecipient(f,'reader',['CONFIDENTIAL'],[recipientScope],['read','search','recovery']);assert.equal((await http.call('reader','controlRead',{id})).status,200);
 const {execFileSync}=await import('node:child_process'),schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],path=cluster.directory+'/bf27.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);
 await grantRecipient(f,'reader',['INTERNAL'],[recipientScope],['read','search','recovery']);
 await http.close();await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});const {restart}=await import('./helpers.mjs'),ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;http=await httpClient(f);
 assert.equal((await http.call('reader','controlRead',{id})).status,403);assert.equal((await http.call('tenant2','controlRead',{id})).status,404);assert.equal((await http.call('other','controlRead',{id})).status,200);
 for(let n=0;n<2;n++)assert.equal((await http.call('other','controlWork',{id,channel:'handoff-1',mode:'reconcile'})).body.result.state,'ACCEPTED');
 f.kernel.fault=async p=>{if(p==='control-after-send')throw Error('bf27 lost compensation acknowledgement');};assert.equal((await http.call('other','controlWork',{id,channel:'handoff-1',mode:'withdraw'})).body.result.state,'WITHDRAW_UNKNOWN');f.kernel.fault=async()=>{};assert.equal((await http.call('other','controlWork',{id,channel:'handoff-1',mode:'reconcile'})).body.result.state,'WITHDRAWN');
 const ledger=await a.ledger();assert.equal(ledger.length,2);assert.ok(ledger.every(x=>x.applied===1&&x.withdrawn===1));assert.equal((await f.owner.query("SELECT operation_id FROM enterprise_control_deliveries WHERE id=$1 AND channel='handoff-1'",[id])).rows[0].operation_id,operation);console.log(JSON.stringify({bf27Recovered:ledger}));
 }finally{await http.close();}
}));
nodeTest('BF-27 older ABSENT operation remains selectable without resend and current scope still controls recovery',()=>withControls(async(f,{a})=>{
 const http=await httpClient(f);try{
 const id=await bf26Journey(f,http);f.kernel.fault=async p=>{if(p==='control-before-send')throw Error('bf27 before network');};assert.equal((await work(f,id,'handoff-1','dispatch','other')).state,'UNKNOWN');f.kernel.fault=async()=>{};
 const next=randomUUID();await f.call('other','handoffOffer',{id,recipientScope:scope,eventId:next,sequence:2,payload:{reference:'second',task:'second scope only'}});await f.call('manager','handoffAccept',{id,eventId:next});await work(f,id,'handoff-2');
 const n=a.requests.length;
 for(let i=0;i<2;i++){const result=await http.call('other','controlWork',{id,channel:'handoff-1',mode:'reconcile'});assert.equal(result.body.result.observation,'ABSENT');assert.equal(result.body.result.requiresHumanReview,true);assert.equal(result.body.result.state,'UNKNOWN');}
 assert.deepEqual(a.requests.slice(n).map(r=>r.method),['GET','GET']);assert.equal((await a.ledger()).length,1);assert.equal((await http.call('other','controlRead',{id})).body.result.data.recoverySteps[0].state,'UNKNOWN');
 await grantRecipient(f,'reader',['CONFIDENTIAL'],[{...recipientScope,caseId:'other-case'}],['read','search','recovery']);assert.equal((await http.call('reader','controlRead',{id})).status,404);assert.equal((await http.call('reader','controlList',{kind:'journey'})).body.result.items.length,0);
 const calls=a.requests.length;assert.equal((await http.call('reader','controlWork',{id,channel:'handoff-1',mode:'reconcile'})).status,404);assert.equal(a.requests.length,calls);
 }finally{await http.close();}
}));

nodeTest('BF-28 committed cancellation survives pre-cancel PostgreSQL restore without revoked author replay',()=>withControls(async(f,{a,cluster})=>{
 let http=await httpClient(f);try{
 const id=await bf26Journey(f,http);await work(f,id,'handoff-1','dispatch','other');const next=randomUUID();await f.call('other','handoffOffer',{id,recipientScope:scope,eventId:next,sequence:2,payload:{reference:'bf28',task:'second'}});await f.call('manager','handoffAccept',{id,eventId:next});await work(f,id,'handoff-2');
 const {execFileSync}=await import('node:child_process'),{restart}=await import('./helpers.mjs'),schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],path=cluster.directory+'/bf28-before-cancel.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);
 const cancelled=await http.call('operator','journeyCancel',{id});assert.equal(cancelled.status,200);assert.equal(cancelled.body.result.state,'CANCELLED');const cancellation=(await f.owner.query("SELECT * FROM actions WHERE request->>'operation'='journeyCancel' AND request->'body'->>'id'=$1",[id])).rows[0];assert.ok(f.kernel.journal.committed(cancellation.operation_id));assert.equal((await f.owner.query("SELECT 1 FROM audit WHERE record->>'actionId'=$1",[cancellation.id])).rowCount,1);
 await grantRecipient(f,'operator',['CONFIDENTIAL'],[scope],['read','search']);
 const restore=async()=>{await http.close();await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});const ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;http=await httpClient(f);};await restore();
 assert.equal((await f.owner.query('SELECT data FROM enterprise_controls WHERE id=$1',[id])).rows[0].data.state,'ACCEPTED');assert.equal((await f.owner.query('SELECT 1 FROM actions WHERE id=$1',[cancellation.id])).rowCount,0);
 assert.equal((await http.call('operator','journeyCancel',{id})).status,403);assert.equal((await http.call('manager','controlRead',{id})).body.result.data.state,'CANCELLED');
 await grantRecipient(f,'reader',['INTERNAL'],[recipientScope],['read','approve','recovery']);assert.equal((await http.call('reader','handoffCompensateApprove',{id,sequence:1})).status,403);
 await grantRecipient(f,'reader',['CONFIDENTIAL'],[{...recipientScope,caseId:'other-case'}],['read','approve','recovery']);assert.equal((await http.call('reader','handoffCompensateApprove',{id,sequence:1})).status,404);assert.equal((await http.call('tenant2','handoffCompensateApprove',{id,sequence:1})).status,404);
 const approved=await http.call('manager','handoffCompensateApprove',{id,sequence:2});console.log(JSON.stringify({bf28RestoredApproval:approved,cancellationOperation:cancellation.operation_id}));assert.equal(approved.status,200);
 assert.equal((await http.call('other','handoffCompensateApprove',{id,sequence:1})).status,200);const n=a.requests.length;assert.equal((await http.call('other','controlWork',{id,channel:'handoff-1',mode:'withdraw'})).status,400);assert.equal(a.requests.length,n);assert.equal((await http.call('manager','controlWork',{id,channel:'handoff-2',mode:'dispatch'})).status,400);
 assert.equal((await work(f,id,'handoff-2','withdraw')).state,'WITHDRAWN');f.kernel.fault=async p=>{if(p==='control-after-send')throw Error('BF28 lost reverse result');};assert.equal((await work(f,id,'handoff-1','withdraw','other')).state,'WITHDRAW_UNKNOWN');f.kernel.fault=async()=>{};assert.equal((await work(f,id,'handoff-1','reconcile','other')).state,'WITHDRAWN');
 await restore();assert.equal((await http.call('operator','journeyCancel',{id})).status,403);for(const [who,sequence] of [['manager',2],['other',1]]){assert.equal((await http.call(who,'handoffCompensateApprove',{id,sequence})).status,200);assert.equal((await http.call(who,'controlWork',{id,channel:'handoff-'+sequence,mode:'reconcile'})).body.result.state,'WITHDRAWN');}
 const ledger=await a.ledger();assert.equal(ledger.length,2);assert.ok(ledger.every(x=>x.applied===1&&x.withdrawn===1));assert.deepEqual(a.requests.filter(x=>x.path==='/compensations').map(r=>ledger.find(e=>e.id===r.id).payload.payload.sequence),[2,1]);console.log(JSON.stringify({bf28Ledger:ledger}));
 }finally{await http.close();}
}));
nodeTest('BF-28 incomplete aborted missing and misbound cancellation proofs never authorize compensation',()=>withControls(async(f,{a,cluster})=>{
 const http=await httpClient(f);try{
 const make=async()=>{const id=await bf26Journey(f,http);await work(f,id,'handoff-1','dispatch','other');return id;};
 const aborted=await make();f.kernel.fault=async p=>{if(p==='enterprise-before-audit')throw Error('BF28 abort cancellation');};assert.notEqual((await http.call('operator','journeyCancel',{id:aborted})).status,200);f.kernel.fault=async()=>{};
 assert.equal((await http.call('other','controlRead',{id:aborted})).body.result.data.state,'ACCEPTED');assert.equal((await http.call('other','handoffCompensateApprove',{id:aborted,sequence:1})).body.error.code,'INVALID_STATE');
 const pending=await make();f.kernel.fault=async p=>{if(p==='enterprise-after-commit')throw Error('BF28 missing completion');};assert.notEqual((await http.call('operator','journeyCancel',{id:pending})).status,200);f.kernel.fault=async()=>{};
 assert.equal((await http.call('other','controlRead',{id:pending})).body.error.code,'RECOVERING');assert.equal((await http.call('other','handoffCompensateApprove',{id:pending,sequence:1})).body.error.code,'RECOVERING');
 await f.kernel.enterpriseRecover(f.credentials.manager);assert.equal((await http.call('other','handoffCompensateApprove',{id:pending,sequence:1})).status,200);
 const unproven=await make();await f.owner.query("UPDATE enterprise_controls SET data=jsonb_set(data,'{state}','\"CANCELLED\"') WHERE id=$1",[unproven]);assert.equal((await http.call('other','handoffCompensateApprove',{id:unproven,sequence:1})).body.error.code,'RECOVERING');
 const wrong=await make(),w=f.kernel.journal.records().find(r=>r.operationKind==='journey-cancellation'&&r.id===pending),{recordHash,previousHash,sequence,...copy}=w;f.kernel.journal.append({...copy,id:wrong});assert.equal((await http.call('other','handoffCompensateApprove',{id:wrong,sequence:1})).body.error.code,'RECOVERING');
 const foreign=await make();f.kernel.journal.append({...copy,id:foreign,tenant:'t2'});assert.equal((await http.call('other','handoffCompensateApprove',{id:foreign,sequence:1})).body.error.code,'INVALID_STATE');
 const lost=await make(),{execFileSync}=await import('node:child_process'),schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],dump=cluster.directory+'/bf28-pending.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+dump]);
 f.kernel.fault=async p=>{if(p==='enterprise-after-commit')throw Error('BF28 pending then restore');};assert.notEqual((await http.call('operator','journeyCancel',{id:lost})).status,200);f.kernel.fault=async()=>{};await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+dump],{stdio:'pipe'});
 await assert.rejects(f.kernel.enterpriseRecover(f.credentials.manager),{code:'RECOVERING'});assert.equal((await http.call('other','handoffCompensateApprove',{id:lost,sequence:1})).body.error.code,'RECOVERING');assert.ok((await a.ledger()).every(e=>e.applied===1&&e.withdrawn===0));
 }finally{await http.close();}
}));

for(const pendingFirst of [false,true])nodeTest('BF-29 committed and pending cancellations survive pre-cancel restore pendingFirst='+pendingFirst,()=>withControls(async(f,{a,cluster})=>{
 let http=await httpClient(f);try{
 const id=await bf26Journey(f,http);await work(f,id,'handoff-1','dispatch','other');const next=randomUUID();await f.call('other','handoffOffer',{id,recipientScope:scope,eventId:next,sequence:2,payload:{reference:'bf29',task:'second'}});await f.call('manager','handoffAccept',{id,eventId:next});await work(f,id,'handoff-2');
 const {execFileSync}=await import('node:child_process'),{restart}=await import('./helpers.mjs'),schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],path=cluster.directory+'/bf29-before-cancel.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);
 const pendingKey=randomUUID(),pendingCancel=async()=>{f.kernel.fault=async p=>{if(p==='enterprise-after-commit')throw Error('BF29 pending repeat');};assert.notEqual((await http.call('operator','journeyCancel',{id},pendingKey)).status,200);f.kernel.fault=async()=>{};};if(pendingFirst)await pendingCancel();
 const cancelled=await http.call('operator','journeyCancel',{id});assert.equal(cancelled.status,200);assert.equal(cancelled.body.result.state,'CANCELLED');const cancellation=(await f.owner.query("SELECT * FROM actions WHERE request->>'operation'='journeyCancel' AND request->'body'->>'id'=$1",[id])).rows.find(a=>a.key!=='v2:'+pendingKey);assert.ok(f.kernel.journal.committed(cancellation.operation_id));assert.equal((await f.owner.query("SELECT 1 FROM audit WHERE record->>'actionId'=$1",[cancellation.id])).rowCount,1);
 if(!pendingFirst)await pendingCancel();const pending=f.kernel.journal.records().find(s=>s.operationKind==='submission'&&s.idempotencyKey==='v2:'+pendingKey),pendingRecords=()=>f.kernel.journal.records().filter(s=>s.actionId===pending.actionId);const retainedPending=JSON.stringify(pendingRecords());assert.equal(pendingRecords().filter(s=>s.operationKind==='submission').at(-1).phase,'INTENT');
 await grantRecipient(f,'operator',['CONFIDENTIAL'],[scope],['read','search']);
 const restore=async()=>{await http.close();await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});const ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;http=await httpClient(f);};await restore();
 assert.equal((await f.owner.query('SELECT data FROM enterprise_controls WHERE id=$1',[id])).rows[0].data.state,'ACCEPTED');assert.equal((await f.owner.query('SELECT 1 FROM actions WHERE id=$1',[cancellation.id])).rowCount,0);
 assert.equal((await f.owner.query('SELECT 1 FROM actions WHERE id=$1',[pending.actionId])).rowCount,0);await assert.rejects(f.kernel.enterpriseRecover(f.credentials.manager),{code:'RECOVERING'});assert.equal(JSON.stringify(pendingRecords()),retainedPending);const listing=await http.call('manager','controlList',{kind:'journey'});console.log(JSON.stringify({bf29List:listing,pendingFirst}));assert.equal(listing.status,200);assert.ok(listing.body.result.items.some(x=>x.id===id&&x.state==='CANCELLED'));
 assert.equal((await http.call('operator','journeyCancel',{id})).status,403);assert.equal((await http.call('manager','controlRead',{id})).body.result.data.state,'CANCELLED');
 await grantRecipient(f,'reader',['INTERNAL'],[recipientScope],['read','approve','recovery']);assert.equal((await http.call('reader','handoffCompensateApprove',{id,sequence:1})).status,403);
 await grantRecipient(f,'reader',['CONFIDENTIAL'],[{...recipientScope,caseId:'other-case'}],['read','approve','recovery']);assert.equal((await http.call('reader','handoffCompensateApprove',{id,sequence:1})).status,404);assert.equal((await http.call('tenant2','handoffCompensateApprove',{id,sequence:1})).status,404);
 const approved=await http.call('manager','handoffCompensateApprove',{id,sequence:2});console.log(JSON.stringify({bf29RestoredApproval:approved,cancellationOperation:cancellation.operation_id}));assert.equal(approved.status,200);
 assert.equal((await http.call('other','handoffCompensateApprove',{id,sequence:1})).status,200);const n=a.requests.length;assert.equal((await http.call('other','controlWork',{id,channel:'handoff-1',mode:'withdraw'})).status,400);assert.equal(a.requests.length,n);assert.equal((await http.call('manager','controlWork',{id,channel:'handoff-2',mode:'dispatch'})).status,400);
 assert.equal((await work(f,id,'handoff-2','withdraw')).state,'WITHDRAWN');f.kernel.fault=async p=>{if(p==='control-after-send')throw Error('BF29 lost reverse result');};assert.equal((await work(f,id,'handoff-1','withdraw','other')).state,'WITHDRAW_UNKNOWN');f.kernel.fault=async()=>{};assert.equal((await work(f,id,'handoff-1','reconcile','other')).state,'WITHDRAWN');
 await restore();assert.equal((await http.call('operator','journeyCancel',{id})).status,403);for(const [who,sequence] of [['manager',2],['other',1]]){assert.equal((await http.call(who,'handoffCompensateApprove',{id,sequence})).status,200);assert.equal((await http.call(who,'controlWork',{id,channel:'handoff-'+sequence,mode:'reconcile'})).body.result.state,'WITHDRAWN');}
 const ledger=await a.ledger();assert.equal(ledger.length,2);assert.ok(ledger.every(x=>x.applied===1&&x.withdrawn===1));assert.deepEqual(a.requests.filter(x=>x.path==='/compensations').map(r=>ledger.find(e=>e.id===r.id).payload.payload.sequence),[2,1]);assert.equal(JSON.stringify(pendingRecords()),retainedPending);console.log(JSON.stringify({bf29Ledger:ledger,pendingFirst,pending:pendingRecords()}));
 }finally{await http.close();}
}));

nodeTest('BF-30 three departments isolate downstream payload before and after receipt, revocation and PostgreSQL restore',()=>withControls(async(f,{a,cluster})=>{
 const third={...scope,departmentId:'synthetic-finance'},fields=['CONFIDENTIAL'],ops=['read','search','action','approve','worker','recovery','audit'];
 const grant=async(who,scopes,labels=fields)=>{await f.owner.query("UPDATE enterprise_grants SET scopes=$1 WHERE principal='publisher'",[JSON.stringify([scope,recipientScope,third,{...third,caseId:'unrelated'}])]);await f.call('publisher','grant',{principal:who,scopes,operations:ops,fields:labels});};
 await grant('manager',[third]);await grant('reader',[{...third,caseId:'unrelated'}]);let http=await httpClient(f);
 const first={reference:'bf30-origin-reference',task:'AからBへの合成引継ぎ'},secret={reference:'bf30-b-c-reference',task:'BからCだけの合成機密本文'};
 const ok=async(who,op,body)=>{const v=await http.call(who,op,body);assert.equal(v.status,200,JSON.stringify(v));return v.body.result;};
 const absent=v=>{for(const s of Object.values(secret))assert.equal(JSON.stringify(v).includes(s),false,'BF-30 origin must not read downstream payload: '+s);};
 try{
 const id=randomUUID(),one=randomUUID(),two=randomUUID();await ok('operator','journeyCreate',{id,scope,flow:'lead-to-cash'});await ok('operator','handoffOffer',{id,recipientScope,eventId:one,sequence:1,payload:first});assert.deepEqual((await ok('operator','controlRead',{id})).data.offer.payload,first);await ok('other','handoffAccept',{id,eventId:one});a.loseNext();assert.equal((await ok('other','controlWork',{id,channel:'handoff-1',mode:'dispatch'})).state,'UNKNOWN');
 await ok('other','handoffOffer',{id,recipientScope:third,eventId:two,sequence:2,payload:secret});
 const origin=await ok('operator','controlRead',{id});console.log(JSON.stringify({bf30OriginBeforeReceipt:origin}));absent(origin);assert.equal(origin.data.state,'OFFERED');assert.deepEqual(origin.data.recoverySteps,[]);
 assert.deepEqual((await ok('other','controlRead',{id})).data.offer.payload,secret,'pending sender can read its own offer');assert.deepEqual((await ok('manager','controlRead',{id})).data.offer.payload,secret);
 await ok('manager','handoffAccept',{id,eventId:two});await ok('manager','controlWork',{id,channel:'handoff-2',mode:'dispatch'});absent(await ok('operator','controlRead',{id}));const past=await ok('other','controlRead',{id});absent(past);assert.deepEqual(past.data.offer.payload,first);assert.deepEqual(past.data.recoverySteps.map(s=>s.sequence),[1]);assert.deepEqual((await ok('manager','controlRead',{id})).data.recoverySteps[0].payload,secret);
 assert.equal((await http.call('reader','controlRead',{id})).status,404);assert.equal((await http.call('tenant2','controlRead',{id})).status,404);
 await grant('reader',[scope]);const audit=await ok('reader','controlAudit',{id});assert.deepEqual(audit.history.map(h=>h.event.event),['journeyCreate','handoffOffer']);absent(audit);
 await grant('reader',[scope,third]);assert.deepEqual((await ok('reader','controlRead',{id})).data.offer.payload,secret);
 const {execFileSync}=await import('node:child_process'),schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],path=cluster.directory+'/bf30.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);
 await grant('reader',[scope]);absent(await ok('reader','controlRead',{id}));await grant('manager',[third],['INTERNAL']);assert.equal((await http.call('manager','controlRead',{id})).status,403);
 await http.close();await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});const {restart}=await import('./helpers.mjs'),ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;http=await httpClient(f);
 absent(await ok('reader','controlRead',{id}));assert.equal((await http.call('manager','controlRead',{id})).status,403);await grant('manager',[third]);await ok('operator','journeyCancel',{id});await ok('other','handoffCompensateApprove',{id,sequence:1});const n=a.requests.length;assert.equal((await http.call('other','controlWork',{id,channel:'handoff-1',mode:'withdraw'})).status,400);assert.equal(a.requests.length,n);
 await ok('manager','handoffCompensateApprove',{id,sequence:2});assert.equal((await ok('manager','controlWork',{id,channel:'handoff-2',mode:'withdraw'})).state,'WITHDRAWN');const start=a.requests.length;for(let i=0;i<2;i++)assert.equal((await ok('other','controlWork',{id,channel:'handoff-1',mode:'reconcile'})).state,'ACCEPTED');assert.deepEqual(a.requests.slice(start).map(r=>r.method),['GET','GET']);assert.equal((await ok('other','controlWork',{id,channel:'handoff-1',mode:'withdraw'})).state,'WITHDRAWN');
 const ledger=await a.ledger();assert.equal(ledger.length,2);assert.ok(ledger.every(e=>e.applied===1&&e.withdrawn===1));assert.deepEqual(a.requests.filter(r=>r.path==='/compensations').map(r=>ledger.find(e=>e.id===r.id).payload.payload.sequence),[2,1]);absent(await ok('reader','controlRead',{id}));console.log(JSON.stringify({bf30Ledger:ledger,requests:a.requests}));
 }finally{await http.close();}
}));

nodeTest('BF-30 offer content must match the persisted tenant journey sequence and inbox digest',()=>withControls(async f=>{
 const http=await httpClient(f);try{
 const id=await bf26Journey(f,http),stored=(await f.owner.query('SELECT data FROM enterprise_controls WHERE id=$1',[id])).rows[0].data;
 for(const mutate of [d=>{d.offer.payload.task='unbound body';},d=>{d.offer.id=randomUUID();},d=>{d.offer.sequence=2;},d=>{d.recipientScope={...recipientScope,departmentId:'synthetic-finance'};}]){
  const data=structuredClone(stored);mutate(data);await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[id,data]);const v=await http.call('operator','controlRead',{id});assert.equal(v.status,400);assert.equal(v.body.error.code,'INCONSISTENT_STATE');assert.equal(v.body.result,undefined);
 }
 await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[id,stored]);assert.equal((await http.call('operator','controlRead',{id})).status,200);
 const inbox=(await f.owner.query('SELECT * FROM enterprise_handoff_inbox WHERE journey_id=$1',[id])).rows[0];await f.owner.query('UPDATE enterprise_handoff_inbox SET tenant=$2 WHERE journey_id=$1',[id,'t2']);assert.equal((await http.call('operator','controlRead',{id})).body.error.code,'INCONSISTENT_STATE');await f.owner.query('UPDATE enterprise_handoff_inbox SET tenant=$2 WHERE journey_id=$1',[id,inbox.tenant]);assert.equal((await http.call('other','controlRead',{id})).status,200);
 }finally{await http.close();}
}));

for(const sequence of [1,2])nodeTest('BF-31 HTTP cross-case offer denied at step '+sequence+' with retries restore and reverse recovery',()=>withControls(async(f,{a,cluster})=>{
 const third={...scope,departmentId:'synthetic-finance'},foreign={...recipientScope,caseId:'bf31-foreign'},ops=['read','search','action','approve','worker','recovery','audit'];
 const grant=async(who,scopes,fields=['CONFIDENTIAL'])=>{await f.owner.query("UPDATE enterprise_grants SET scopes=$1 WHERE principal='publisher'",[JSON.stringify([scope,recipientScope,third,foreign,{...third,caseId:foreign.caseId}])]);await f.call('publisher','grant',{principal:who,scopes,operations:ops,fields});};
 await grant('reader',[foreign]);await grant('manager',[third]);let http=await httpClient(f);const ok=async(who,op,b,key)=>{const v=await http.call(who,op,b,key);assert.equal(v.status,200,JSON.stringify(v));return v.body.result;};
 try{
 const id=randomUUID(),first=randomUUID(),payload={reference:'bf31-case-secret-ref',task:'案件A限定の合成本文'};await ok('operator','journeyCreate',{id,scope,flow:'lead-to-cash'});
 if(sequence===2){await ok('operator','handoffOffer',{id,recipientScope,eventId:first,sequence:1,payload});await ok('other','handoffAccept',{id,eventId:first});a.loseNext();assert.equal((await ok('other','controlWork',{id,channel:'handoff-1',mode:'dispatch'})).state,'UNKNOWN');}
 const sender=sequence===1?'operator':'other',eventId=randomUUID(),bad={id,recipientScope:sequence===1?foreign:{...third,caseId:foreign.caseId},eventId,sequence,payload};if(sequence===2)await grant('reader',[bad.recipientScope]);
 const snapshot=async()=>({row:(await f.owner.query('SELECT revision,data FROM enterprise_controls WHERE id=$1',[id])).rows,inbox:(await f.owner.query('SELECT * FROM enterprise_handoff_inbox WHERE journey_id=$1 ORDER BY sequence',[id])).rows,history:(await f.owner.query('SELECT * FROM enterprise_control_history WHERE id=$1 ORDER BY revision',[id])).rows,outbox:(await f.owner.query("SELECT * FROM outbox WHERE event->>'aggregateId'=$1 ORDER BY operation_id",[id])).rows});
 assert.equal((await http.call('reader','controlRead',{id})).status,404);const prior=await snapshot(),n=a.requests.length,key=randomUUID(),result=await http.call(sender,'handoffOffer',bad,key);
 if(result.status===200)console.log(JSON.stringify({bf31Before:{result,recipient:await http.call('reader','controlRead',{id}),stored:await snapshot()}}));assert.equal(result.status,403,'cross-case offer must be rejected before payload persistence');
 for(const retryKey of [key,randomUUID()])assert.equal((await http.call(sender,'handoffOffer',bad,retryKey)).status,403);assert.deepEqual(await snapshot(),prior);assert.equal((await f.owner.query('SELECT 1 FROM actions WHERE key=$1',['v2:'+key])).rowCount,0);assert.equal(a.requests.length,n);
 assert.equal((await http.call('reader','controlList',{kind:'journey'})).body.result.items.length,0);for(const op of ['controlRead','controlAudit'])assert.equal((await http.call('reader',op,{id})).status,404);assert.equal((await http.call('reader','handoffAccept',{id,eventId})).status,400);
 const goodKey=randomUUID(),good={...bad,recipientScope:sequence===1?recipientScope:third},recipient=sequence===1?'other':'manager';await ok(sender,'handoffOffer',good,goodKey);await ok(sender,'handoffOffer',good,goodKey);await ok(recipient,'handoffAccept',{id,eventId});await ok(recipient,'controlWork',{id,channel:'handoff-'+sequence,mode:'dispatch'});
 const {execFileSync}=await import('node:child_process'),schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],path=cluster.directory+'/bf31.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);
 await grant(sender,sequence===1?[scope]:[recipientScope],['INTERNAL']);assert.equal((await http.call(sender,'handoffOffer',good,goodKey)).status,403);await http.close();await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});const {restart}=await import('./helpers.mjs'),ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;http=await httpClient(f);
 assert.equal((await http.call(sender,'handoffOffer',good,goodKey)).status,403);assert.equal((await http.call('reader','controlRead',{id})).status,404);await grant(sender,sequence===1?[scope]:[recipientScope]);assert.equal((await http.call(sender,'handoffOffer',bad)).status,404);
 await ok('operator','journeyCancel',{id});if(sequence===2){await ok('other','handoffCompensateApprove',{id,sequence:1});const before=a.requests.length;assert.equal((await http.call('other','controlWork',{id,channel:'handoff-1',mode:'withdraw'})).status,400);assert.equal(a.requests.length,before);}
 await ok(recipient,'handoffCompensateApprove',{id,sequence});await ok(recipient,'controlWork',{id,channel:'handoff-'+sequence,mode:'withdraw'});if(sequence===2){for(let i=0;i<2;i++)assert.equal((await ok('other','controlWork',{id,channel:'handoff-1',mode:'reconcile'})).state,'ACCEPTED');await ok('other','controlWork',{id,channel:'handoff-1',mode:'withdraw'});}
 const ledger=await a.ledger();assert.equal(ledger.length,sequence);assert.ok(ledger.every(e=>e.applied===1&&e.withdrawn===1));assert.deepEqual(a.requests.filter(r=>r.path==='/compensations').map(r=>ledger.find(e=>e.id===r.id).payload.payload.sequence),sequence===2?[2,1]:[1]);console.log(JSON.stringify({bf31:sequence,ledger,requests:a.requests}));
 }finally{await http.close();}
}));

nodeTest('BF-31 persisted cross-case route cannot disclose accept replay recover or dispatch',()=>withControls(async(f,{a})=>{
 await f.owner.query("UPDATE enterprise_grants SET scopes=$1 WHERE principal='publisher'",[JSON.stringify([scope,recipientScope])]);for(const who of ['operator','other'])await f.call('publisher','grant',{principal:who,scopes:[who==='operator'?scope:recipientScope],operations:['read','search','action','approve','worker','recovery','audit'],fields:['CONFIDENTIAL']});
 const id=randomUUID(),eventId=randomUUID(),key=randomUUID(),body={id,recipientScope,eventId,sequence:1,payload:{reference:'bf31-legacy-reference',task:'案件境界の保存済み合成本文'}};
 await f.call('operator','journeyCreate',{id,scope,flow:'lead-to-cash'});f.kernel.fault=async point=>{if(point==='enterprise-after-commit')throw new Error('BF-31 lost submission completion');};await assert.rejects(f.call('operator','handoffOffer',body,key));f.kernel.fault=async()=>{};
 const offered=(await f.owner.query('SELECT scope,data FROM enterprise_controls WHERE id=$1',[id])).rows[0],foreign={...scope,caseId:'bf31-legacy-foreign'},http=await httpClient(f);
 // Simulate a pre-fix stored route crossing cases without weakening request,
 // inbox, Action or Outbox digests: only the journey's origin case differs.
 await f.owner.query('UPDATE enterprise_controls SET scope=$2 WHERE id=$1',[id,foreign]);const journal=f.kernel.journal.records(),requests=a.requests.length;
 try{
 for(const who of ['operator','other']){assert.deepEqual((await http.call(who,'controlList',{kind:'journey'})).body.result.items,[]);for(const op of ['controlRead','controlAudit']){const v=await http.call(who,op,{id});assert.equal(v.body.error.code,'INCONSISTENT_STATE');assert.equal(v.body.result,undefined);assert.ok(!JSON.stringify(v).includes(body.payload.task));}}
 for(const op of ['handoffAccept','handoffReject'])assert.equal((await http.call('other',op,{id,eventId})).body.error.code,'INCONSISTENT_STATE');assert.equal((await http.call('operator','handoffOffer',body,key)).body.error.code,'INCONSISTENT_STATE');
 await assert.rejects(f.kernel.enterpriseRecover(f.credentials.operator),{code:'INCONSISTENT_STATE'});assert.deepEqual(f.kernel.journal.records(),journal);assert.equal(a.requests.length,requests);
 // Restoring the authentic same-case route permits normal submission recovery.
 await f.owner.query('UPDATE enterprise_controls SET scope=$2 WHERE id=$1',[id,offered.scope]);await f.kernel.enterpriseRecover(f.credentials.operator);await f.call('other','handoffAccept',{id,eventId});
 const accepted=(await f.owner.query('SELECT data FROM enterprise_controls WHERE id=$1',[id])).rows[0].data;
 for(const field of ['recipientScope','offer','steps']){const changed=structuredClone(accepted);if(field==='recipientScope')changed.recipientScope.caseId=foreign.caseId;else if(field==='offer')changed.offer.recipientScope.caseId=foreign.caseId;else changed.steps[0].scope.caseId=foreign.caseId;await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[id,changed]);for(const mode of ['dispatch','reconcile','withdraw'])await assert.rejects(work(f,id,'handoff-1',mode,'other'),{code:'INCONSISTENT_STATE'});assert.equal((await http.call('other','controlRead',{id})).body.error.code,'INCONSISTENT_STATE');assert.equal(a.requests.length,requests);}
 await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[id,accepted]);f.kernel.fault=async point=>{if(point==='control-before-send')await f.owner.query('UPDATE enterprise_controls SET scope=$2 WHERE id=$1',[id,foreign]);};const blocked=await work(f,id,'handoff-1','dispatch','other');assert.equal(blocked.state,'UNKNOWN');assert.equal(blocked.code,'INCONSISTENT_STATE');assert.equal(a.requests.length,requests);f.kernel.fault=async()=>{};
 await f.owner.query('UPDATE enterprise_controls SET scope=$2 WHERE id=$1',[id,offered.scope]);const absent=await work(f,id,'handoff-1','reconcile','other');assert.equal(absent.observation,'ABSENT');assert.equal(absent.requiresHumanReview,true);assert.equal((await a.ledger()).length,0);assert.ok(a.requests.every(r=>r.method==='GET'));console.log(JSON.stringify({bf31Persisted:{blocked,absent,requests:a.requests}}));
 }finally{await http.close();}
}));

for(const sequence of [1,2])nodeTest('BF-32 HTTP classification cannot fall at step '+sequence+' and strict recovery survives restore',()=>withControls(async(f,{a,cluster})=>{
 const origin={...scope,classification:sequence===1?'STRICT':'RESTRICTED'},second={...recipientScope,classification:'STRICT'},third={...scope,departmentId:'synthetic-finance',classification:'STRICT'},low={...(sequence===1?second:third),classification:'CONFIDENTIAL'},ops=['read','search','action','approve','worker','recovery','audit'];
 const grant=async(who,scopes,fields=['CONFIDENTIAL','STRICT'])=>{await f.owner.query("UPDATE enterprise_grants SET scopes=$1 WHERE principal='publisher'",[JSON.stringify([origin,second,third,low])]);await f.call('publisher','grant',{principal:who,scopes,operations:ops,fields});};
 await grant('operator',[origin],['CONFIDENTIAL','RESTRICTED']);await grant('other',[second],['CONFIDENTIAL','STRICT']);await grant('manager',[third],['CONFIDENTIAL','RESTRICTED']);await grant('reader',[low],['CONFIDENTIAL']);let http=await httpClient(f);const ok=async(who,op,b,key)=>{const v=await http.call(who,op,b,key);assert.equal(v.status,200,JSON.stringify(v));return v.body.result;};
 try{
 const id=randomUUID(),payload={reference:'bf32-strict-reference',task:'厳秘の合成引継ぎ本文'};await ok('operator','journeyCreate',{id,scope:origin,flow:'incident-to-resolution'});
 if(sequence===2){const eventId=randomUUID();await ok('operator','handoffOffer',{id,recipientScope:second,eventId,sequence:1,payload});await ok('other','handoffAccept',{id,eventId});a.loseNext();assert.equal((await ok('other','controlWork',{id,channel:'handoff-1',mode:'dispatch'})).state,'UNKNOWN');}
 const sender=sequence===1?'operator':'other',recipient=sequence===1?'other':'manager',target=sequence===1?second:third,eventId=randomUUID(),bad={id,recipientScope:low,eventId,sequence,payload},key=randomUUID();
 const snapshot=async()=>({row:(await f.owner.query('SELECT revision,data FROM enterprise_controls WHERE id=$1',[id])).rows,inbox:(await f.owner.query('SELECT * FROM enterprise_handoff_inbox WHERE journey_id=$1 ORDER BY sequence',[id])).rows,history:(await f.owner.query('SELECT * FROM enterprise_control_history WHERE id=$1 ORDER BY revision',[id])).rows,outbox:(await f.owner.query("SELECT * FROM outbox WHERE event->>'aggregateId'=$1 ORDER BY operation_id",[id])).rows});
 const before=await snapshot(),requests=a.requests.length,denied=await http.call(sender,'handoffOffer',bad,key);
 if(denied.status===200)console.log(JSON.stringify({bf32Before:{sequence,denied,reader:await http.call('reader','controlRead',{id}),accept:await http.call('reader','handoffAccept',{id,eventId}),stored:await snapshot()}}));assert.equal(denied.status,403,'classification downgrade must not persist or disclose');
 for(const retry of [key,randomUUID()])assert.equal((await http.call(sender,'handoffOffer',bad,retry)).status,403);assert.deepEqual(await snapshot(),before);assert.equal(a.requests.length,requests);assert.equal((await f.owner.query('SELECT 1 FROM actions WHERE key=$1',['v2:'+key])).rowCount,0);assert.equal(before.row[0].data.label,'STRICT');
 const good={...bad,recipientScope:target},goodKey=randomUUID();await ok(sender,'handoffOffer',good,goodKey);await ok(sender,'handoffOffer',good,goodKey);
 // A matching organization scope alone is insufficient without strict fields.
 await grant('reader',[target],['CONFIDENTIAL']);assert.deepEqual((await ok('reader','controlList',{kind:'journey'})).items,[]);for(const op of ['controlRead','controlAudit','handoffAccept'])assert.equal((await http.call('reader',op,op==='handoffAccept'?{id,eventId}:{id})).status,403);
 assert.equal((await ok(recipient,'controlRead',{id})).data.offer.payload.task,payload.task);await ok(recipient,'handoffAccept',{id,eventId});await ok(recipient,'controlWork',{id,channel:'handoff-'+sequence,mode:'dispatch'});
 const {execFileSync}=await import('node:child_process'),schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],path=cluster.directory+'/bf32.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);
 await grant(sender,[sequence===1?origin:second],['CONFIDENTIAL']);assert.equal((await http.call(sender,'handoffOffer',good,goodKey)).status,403);await http.close();await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});const {restart}=await import('./helpers.mjs'),ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;http=await httpClient(f);
 assert.equal((await http.call(sender,'handoffOffer',good,goodKey)).status,403);assert.equal((await http.call('reader','controlRead',{id})).status,403);await grant(sender,[sequence===1?origin:second],['CONFIDENTIAL','RESTRICTED']);
 await ok('operator','journeyCancel',{id});if(sequence===2){await ok('other','handoffCompensateApprove',{id,sequence:1});const n=a.requests.length;assert.equal((await http.call('other','controlWork',{id,channel:'handoff-1',mode:'withdraw'})).status,400);assert.equal(a.requests.length,n);}
 await ok(recipient,'handoffCompensateApprove',{id,sequence});await ok(recipient,'controlWork',{id,channel:'handoff-'+sequence,mode:'withdraw'});if(sequence===2){for(let n=0;n<2;n++)assert.equal((await ok('other','controlWork',{id,channel:'handoff-1',mode:'reconcile'})).state,'ACCEPTED');await ok('other','controlWork',{id,channel:'handoff-1',mode:'withdraw'});}
 const ledger=await a.ledger();assert.equal(ledger.length,sequence);assert.ok(ledger.every(e=>e.applied===1&&e.withdrawn===1&&e.payload.scope.classification==='STRICT'));assert.deepEqual(a.requests.filter(r=>r.path==='/compensations').map(r=>ledger.find(e=>e.id===r.id).payload.payload.sequence),sequence===2?[2,1]:[1]);const audit=(await f.owner.query("SELECT record FROM audit WHERE record->>'objectId'=$1 AND record ? 'resource'",[id])).rows;assert.ok(audit.length>0);assert.ok(audit.every(e=>e.record.resource.label==='STRICT'));console.log(JSON.stringify({bf32:{sequence,ledger,auditLabels:audit.map(e=>e.record.resource.label),requests:a.requests}}));
 }finally{await http.close();}
}));

nodeTest('BF-32 persisted classification mismatch stops read accept replay recovery and final send',()=>withControls(async(f,{a})=>{
 const origin={...scope,classification:'STRICT'},target={...recipientScope,classification:'RESTRICTED'},ops=['read','search','action','approve','worker','recovery','audit'];
 await f.owner.query("UPDATE enterprise_grants SET scopes=$1 WHERE principal='publisher'",[JSON.stringify([origin,target])]);for(const [who,scopes,fields] of [['operator',[origin],['STRICT']],['other',[target],['RESTRICTED']],['reader',[origin],['CONFIDENTIAL']]])await f.call('publisher','grant',{principal:who,scopes,operations:ops,fields});
 await assert.rejects(f.call('reader','journeyCreate',{id:randomUUID(),scope:origin,flow:'lead-to-cash'}),{code:'PERMISSION_DENIED'});
 const id=randomUUID(),eventId=randomUUID(),key=randomUUID(),body={id,recipientScope:target,eventId,sequence:1,payload:{reference:'bf32-legacy-reference',task:'分類を保持する合成本文'}};
 await f.call('operator','journeyCreate',{id,scope:origin,flow:'lead-to-cash'});f.kernel.fault=async point=>{if(point==='enterprise-after-commit')throw Error('BF-32 missing completion');};await assert.rejects(f.call('operator','handoffOffer',body,key));f.kernel.fault=async()=>{};
 const offered=(await f.owner.query('SELECT data FROM enterprise_controls WHERE id=$1',[id])).rows[0].data,old=structuredClone(offered);old.label='CONFIDENTIAL';old.recipientScope.classification='CONFIDENTIAL';old.offer.recipientScope.classification='CONFIDENTIAL';await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[id,old]);const journal=f.kernel.journal.records(),http=await httpClient(f);
 try{
 for(const who of ['operator','other','reader']){assert.deepEqual((await http.call(who,'controlList',{kind:'journey'})).body.result.items,[]);for(const op of ['controlRead','controlAudit']){const v=await http.call(who,op,{id});assert.equal(v.body.error.code,'INCONSISTENT_STATE');assert.equal(v.body.result,undefined);assert.ok(!JSON.stringify(v).includes(body.payload.task));}}
 for(const op of ['handoffAccept','handoffReject'])assert.equal((await http.call('other',op,{id,eventId})).body.error.code,'INCONSISTENT_STATE');assert.equal((await http.call('operator','handoffOffer',body,key)).body.error.code,'INCONSISTENT_STATE');await assert.rejects(f.kernel.enterpriseRecover(f.credentials.operator),{code:'INCONSISTENT_STATE'});assert.deepEqual(f.kernel.journal.records(),journal);assert.equal(a.requests.length,0);
 await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[id,offered]);await f.kernel.enterpriseRecover(f.credentials.operator);
 const acceptKey=randomUUID();f.kernel.fault=async point=>{if(point==='enterprise-after-commit')throw Error('BF-32 acceptance completion loss');};await assert.rejects(f.call('other','handoffAccept',{id,eventId},acceptKey));f.kernel.fault=async()=>{};const accepted=(await f.owner.query('SELECT data FROM enterprise_controls WHERE id=$1',[id])).rows[0].data;
 for(const field of ['label','recipientScope','offer','steps']){const changed=structuredClone(accepted);if(field==='label')changed.label='CONFIDENTIAL';else if(field==='recipientScope')changed.recipientScope.classification='CONFIDENTIAL';else if(field==='offer')changed.offer.recipientScope.classification='CONFIDENTIAL';else changed.steps[0].scope.classification='CONFIDENTIAL';await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[id,changed]);for(const mode of ['dispatch','reconcile','withdraw'])await assert.rejects(work(f,id,'handoff-1',mode,'other'),{code:'INCONSISTENT_STATE'});await assert.rejects(f.kernel.enterpriseRecover(f.credentials.other),{code:'INCONSISTENT_STATE'});assert.equal((await http.call('other','handoffAccept',{id,eventId},acceptKey)).body.error.code,'INCONSISTENT_STATE');assert.equal(a.requests.length,0);}
 await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[id,accepted]);await f.kernel.enterpriseRecover(f.credentials.other);f.kernel.fault=async point=>{if(point==='control-before-send'){const changed=structuredClone(accepted);changed.label='CONFIDENTIAL';await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[id,changed]);}};const blocked=await work(f,id,'handoff-1','dispatch','other');assert.equal(blocked.state,'UNKNOWN');assert.equal(blocked.code,'INCONSISTENT_STATE');assert.equal(a.requests.length,0);f.kernel.fault=async()=>{};
 await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[id,accepted]);const absent=await work(f,id,'handoff-1','reconcile','other');assert.equal(absent.observation,'ABSENT');assert.equal(absent.requiresHumanReview,true);assert.equal((await a.ledger()).length,0);assert.ok(a.requests.every(r=>r.method==='GET'));console.log(JSON.stringify({bf32Persisted:{blocked,absent,requests:a.requests}}));
 }finally{await http.close();}
}));
