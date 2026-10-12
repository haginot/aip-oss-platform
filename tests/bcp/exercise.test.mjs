import test from 'node:test';
import assert from 'node:assert/strict';
import {fork,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,stat,rename} from 'node:fs/promises';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {separateVolumes} from '../../scripts/foundation/volumes.mjs';
import {startErp} from '../../scripts/foundation/erp.mjs';
import {HttpWritebackPort,Writeback} from '../../src/writeback.mjs';
import {RecoveryJournal} from '../../src/adapters/journal.mjs';
import {createHash} from 'node:crypto';
import {createContractClient} from '../../src/client-transport.mjs';
import {seedStore} from '../../scripts/demo/seed.mjs';
import {digest} from '../../src/contracts.mjs';

const reports=[];
async function rpc(url,credential,operation,body={}) {
 const response=await fetch(url+'/rpc',{method:'POST',headers:{authorization:'Bearer '+credential.token,'content-type':'application/json'},body:JSON.stringify({contractVersion:'1.0.0',requestId:crypto.randomUUID(),traceId:crypto.randomUUID(),tenant:'t1',operation,body})});
 const result=await response.json();if(result.error)throw Object.assign(Error(result.error.code),result.error);return result.result;
}
async function child(f,cluster,erp,stopAt,journalPath=f.journal.path) {
 const p=fork(new URL('../../scripts/bcp/process.mjs',import.meta.url),[],{stdio:['ignore','ignore','pipe','ipc']});
 const ready=Promise.race([once(p,'message'),once(p,'exit').then(([c,s])=>{throw Error(`child boot failed ${c}/${s}`);})]);
 p.send({config:{...cluster.config,user:'foundation_app',options:f.state.pool.options.options},journalPath,url:erp.url,token:erp.token,stopAt});
 const timer=setTimeout(()=>p.kill('SIGKILL'),10000);try {const [message]=await ready;return {p,url:message.url};}finally{clearTimeout(timer);}
}
async function setup(fn,definitionPath) {
 const volumes=await separateVolumes();let cluster,f,erp;
 try {cluster=await startCluster({baseDirectory:volumes.db});f=await fixture(cluster,{journalDirectory:volumes.journal,...(definitionPath?{definitionPath}:{})});erp=await startErp(cluster);f.kernel.writeback=new Writeback(f.kernel,new HttpWritebackPort(erp.url,erp.token));await fn(f,cluster,erp,volumes);}
 finally {await erp?.close();await f?.close();await cluster?.close();await volumes.close();}
}
async function backup(f,cluster) {
 const schema=f.state.pool.options.options.match(/search_path=(\w+)/)[1];
 const args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U','foundation_owner','-d','postgres','-n',schema];
 const monotonic=performance.now(),at=new Date().toISOString();
 const sql=execFileSync('pg_dump',args,{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});
 return {schema,sql,hash:createHash('sha256').update(sql).digest('hex'),at,completedAt:new Date().toISOString(),monotonic};
}
async function restore(f,snapshot,cluster) {
 // Destruction is confined to the unique synthetic Kernel schema. ERP is a separate DB.
 await f.owner.query(`DROP SCHEMA ${snapshot.schema} CASCADE`);
 execFileSync('psql',['-X','-v','ON_ERROR_STOP=1','-h',cluster.config.host,'-p',String(cluster.config.port),'-U','foundation_owner','-d','postgres'],{input:snapshot.sql,encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});
}
async function integrity(f,erp) {
 const actions=(await f.owner.query('SELECT * FROM actions ORDER BY id')).rows;
 const outbox=(await f.owner.query('SELECT * FROM outbox ORDER BY operation_id')).rows;
 const audit=(await f.owner.query('SELECT * FROM audit ORDER BY sequence')).rows;
 let previous='GENESIS';for(const row of audit){assert.equal(row.previous_hash,previous);assert.equal(row.hash,digest({previous,record:row.record}));previous=row.hash;}
 const ledger=(await erp.owner.query('SELECT * FROM ledger ORDER BY operation_id')).rows;
 for(const entry of ledger) {
  const event=outbox.find(o=>o.operation_id===entry.operation_id)?.event??f.journal.records().filter(r=>r.operationId===entry.operation_id&&r.phase==='COMMITTED').at(-1)?.externalEvent;
  assert.ok(event,'ERP effect must trace to surviving Outbox or independent committed journal');
  assert.deepEqual(entry.payload,f.kernel.writeback.payload({event}));assert.equal(entry.digest,digest(entry.payload));
  const assertNoRestricted=value=>{if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){assert.notEqual(key,'secret');assertNoRestricted(child);}else assert.notEqual(value,'hidden-word');};
  assertNoRestricted(entry.payload);
 }
 for(const event of outbox){assert.ok(actions.some(a=>a.id===event.action_id&&a.operation_id===event.operation_id));assert.equal(event.digest,digest(event.event));if(event.state==='DELIVERED')assert.ok(ledger.some(l=>l.operation_id===event.operation_id));}
 const effects=(await erp.owner.query('SELECT * FROM effects')).rows;
 const effectCount=effects.reduce((n,e)=>n+e.sequence,0);
 assert.equal(effectCount,ledger.length);
 const telemetry=(await f.owner.query('SELECT * FROM telemetry ORDER BY sequence')).rows;
 return {actions,outbox,audit,telemetry,ledger,effects,journal:f.journal.records(),mutations:await mutations(f),objects:(await f.owner.query('SELECT * FROM objects ORDER BY id')).rows,duplicateEffectCount:effectCount-new Set(ledger.map(r=>r.operation_id)).size};
}

test('clean WAN outage -> local quarantine -> lost ack / real SIGKILL -> destructive restore -> reconcile -> resend -> approved compensation',()=>setup(async(f,cluster,erp,volumes)=>{
 const started=performance.now(),timeline=[];const mark=event=>timeline.push({event,at:new Date().toISOString(),elapsedMs:performance.now()-started});
 // Real HTTP network boundary; broken TCP connections never reach synthetic ERP.
 let disconnected=true;const proxy=createServer(async(req,res)=>{if(disconnected){req.socket.destroy();return;}try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const r=await fetch(erp.url+req.url,{method:'POST',headers:{authorization:req.headers.authorization,'content-type':'application/json'},body:Buffer.concat(chunks)});res.writeHead(r.status);res.end(await r.text());}catch{req.socket.destroy();}});
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 const network={url:`http://127.0.0.1:${proxy.address().port}`,token:erp.token};let process1,process2;
 try {
  process1=await child(f,cluster,network,'after-external');const call=(op,body,who='manager')=>rpc(process1.url,f.credentials[who],op,body);
  const tFault=performance.now();mark('WAN-disconnected');
  await createContractClient({url:process1.url,token:f.credentials.manager.token,tenant:'t1'},f.definition).continuitySet({store:'s1',mode:'DEGRADED',expectedRevision:0});
  const request=f.request({idempotencyKey:'clean-isolate'}),a=await call('submit',request,'operator');
  await assert.rejects(call('dispatch',a),e=>e.code==='CONTINUITY_RESTRICTED');
  assert.equal(erp.controller.applyRequests,0);
  const queued=(await f.owner.query('SELECT event FROM outbox')).rows[0].event;
  await assert.rejects(new HttpWritebackPort(network.url,network.token).status(f.kernel.writeback.payload({event:queued})));assert.equal(erp.controller.statusRequests,0);
  await assert.rejects(call('submit',f.request({input:{targetId:'stock',isolated:false},expectedRevision:2}),'operator'),e=>e.code==='CONTINUITY_RESTRICTED');
  await assert.rejects(call('submit',f.request(),'reader'),e=>e.code==='PERMISSION_DENIED');
  const probe=await call('get',{id:'stock'},'operator');assert.equal(probe.fields.isolated,true);
  const localRtoMs=performance.now()-tFault;mark('degraded-read-and-isolation-probe-success');
  await f.owner.query('UPDATE policy SET available=false');await assert.rejects(call('get',{id:'stock'},'operator'),e=>e.code==='UNAVAILABLE');await f.owner.query('UPDATE policy SET available=true');
  const checkpoint=await backup(f,cluster);const beforeMutations=await mutations(f);const before=(await f.owner.query('SELECT id FROM actions')).rows.map(r=>r.id);
  // Restore transport and classify a never-sent queued operation before sending.
  disconnected=false;mark('WAN-restored');
  await call('continuitySet',{store:'s1',mode:'RECOVERING',expectedRevision:1});
  const unapplied=await call('recover',{store:'s1',checkpoint:'pre-send'});assert.equal(unapplied.results[0].classification,'unapplied');
  // ERP commits then drops ACK; worker dies before its result transaction commits.
  erp.controller.mode='lost-ack';const killed=once(process1.p,'exit');const crashStart=performance.now();
  await assert.rejects(call('dispatch',a));assert.deepEqual(await killed,[null,'SIGKILL']);mark('ERP-applied-ack-lost-process-SIGKILL');
  assert.equal(erp.controller.applyRequests,1);assert.equal((await f.owner.query('SELECT state FROM outbox')).rows[0].state,'SENDING');
  await restore(f,checkpoint,cluster);mark('Kernel-schema-destroyed-and-checkpoint-restored');
  assert.notEqual((await stat(cluster.directory)).dev,(await stat(f.journal.path)).dev);
  erp.controller.mode='normal';const recoveryStart=performance.now();mark('service-recovery-notification');process2=await child(f,cluster,network);const restarted=(op,body,who='manager')=>rpc(process2.url,f.credentials[who],op,body);
  await restarted('continuitySet',{store:'s1',mode:'RECOVERING',expectedRevision:1});
  const recovery=await restarted('recover',{store:'s1',checkpoint:checkpoint.hash});const classificationRtoMs=performance.now()-recoveryStart;
  assert.equal(recovery.unresolved.length,0);assert.equal(recovery.results[0].classification,'applied');
  assert.equal((await restarted('status',a,'operator')).state,'SUCCEEDED');
  assert.equal((await restarted('submit',request,'operator')).actionId,a.actionId);
  await assert.rejects(restarted('submit',{...request,input:{targetId:'stock',isolated:false}},'operator'),e=>e.code==='IDEMPOTENCY_MISMATCH');
  assert.equal((await restarted('dispatch',a)).state,'DUPLICATE');assert.equal(erp.controller.applyRequests,1);
  const bRequest=f.request({idempotencyKey:'post-recovery',input:{targetId:'stock2',isolated:true}}),b=await restarted('submit',bRequest,'operator');
  assert.equal((await restarted('dispatch',b)).state,'DELIVERED');assert.equal((await restarted('submit',bRequest,'operator')).actionId,b.actionId);
  const compensation=await restarted('compensate',{actionId:a.actionId,expectedRevision:2,idempotencyKey:'compensate-clean'},'operator');assert.equal(compensation.state,'PENDING_APPROVAL');
  assert.equal((await restarted('compensate',{actionId:a.actionId,expectedRevision:2,idempotencyKey:'compensate-clean'},'operator')).actionId,compensation.actionId);
  assert.equal((await restarted('get',{id:'stock'},'operator')).fields.isolated,true);
  await assert.rejects(restarted('approve',compensation,'operator'),e=>e.code==='PERMISSION_DENIED');
  await restarted('approve',compensation);assert.equal((await restarted('dispatch',compensation)).state,'DELIVERED');
  assert.equal((await restarted('get',{id:'stock'},'operator')).fields.isolated,false);mark('compensation-approved-and-delivered');
  const after=(await f.owner.query('SELECT id FROM actions')).rows.map(r=>r.id),lost=before.filter(id=>!after.includes(id));assert.deepEqual(lost,[]);
  const lostMutationRows=lostMutations(beforeMutations,await mutations(f));assert.deepEqual(lostMutationRows,[]);
  const trace=await integrity(f,erp);assert.equal(trace.ledger.length,3);assert.equal(new Set(trace.ledger.map(r=>r.operation_id)).size,3);
  assert.ok(trace.audit.some(r=>r.record.kind==='CompensationProposed'&&r.record.compensatesActionId===a.actionId));
  const restartRtoMs=performance.now()-crashStart;assert.ok(localRtoMs<120000&&restartRtoMs<120000&&classificationRtoMs<300000);assert.ok(crashStart-checkpoint.monotonic<60000);
  reports.push({scenario:'clean-recovery',status:'passed',seed:'foundation:1',devices:volumes.devices,timeline,backup:{sha256:checkpoint.hash,at:checkpoint.at,profile:'pg_dump complete Kernel schema / no WAL replay'},metrics:{lostMutationCount:lostMutationRows.length,lostMutations:lostMutationRows,localRpoLostCount:lost.length,localRpoLostIds:lost,backupAgeAtFaultMs:crashStart-checkpoint.monotonic,localRtoMs,restartAndContinuationRtoMs:restartRtoMs,classificationRtoMs,duplicateEffectCount:trace.duplicateEffectCount,externalApplyRequests:erp.controller.applyRequests,unresolvedCount:recovery.unresolved.length},recovery,trace});
 }finally{for(const c of [process1,process2])if(c?.p.connected){const exit=once(c.p,'exit');c.p.send('close');await exit;}await new Promise(resolve=>proxy.close(resolve));}
}));

test('checkpoint-before-commit restore discovers lost applied operation only from independent journal, no resend, durable manual key/target hold',()=>setup(async(f,cluster,erp)=>{
 const checkpoint=await backup(f,cluster);const request=f.request({idempotencyKey:'lost-local'}),a=await f.kernel.submit(f.credentials.operator,request);erp.controller.mode='lost-ack';await f.kernel.dispatch(f.credentials.manager,a);
 const requestsBeforeRecovery=erp.controller.applyRequests,beforeMutations=await mutations(f);const observedBefore=(await f.owner.query('SELECT id FROM actions')).rows.map(r=>r.id),fault=performance.now();await restore(f,checkpoint,cluster);
 await f.kernel.continuitySet(f.credentials.manager,{store:'s1',mode:'RECOVERING',expectedRevision:0});
 const survivingBeforeRecovery=(await f.owner.query('SELECT id FROM actions')).rows.map(r=>r.id);
 const independentlyLost=observedBefore.filter(id=>!survivingBeforeRecovery.includes(id)),lostMutationRows=lostMutations(beforeMutations,await mutations(f));assert.equal(lostMutationRows.length,1);
 const recovery=await f.kernel.recover(f.credentials.manager,{store:'s1',checkpoint:checkpoint.hash});
 assert.equal(recovery.results.length,1);const r=recovery.results[0];assert.equal(r.operationId,a.operationId);assert.equal(r.external,'APPLIED');assert.equal(r.lostLocalCommit,true);assert.equal(recovery.unresolved.length,1);
 assert.equal(erp.controller.applyRequests,1);assert.equal((await f.kernel.submit(f.credentials.operator,request)).actionId,a.actionId);
 await assert.rejects(f.kernel.submit(f.credentials.operator,f.request()),e=>e.code==='INCONSISTENT_STATE');
 await assert.rejects(f.kernel.dispatch(f.credentials.manager,a),e=>e.code==='NOT_FOUND');
 assert.equal((await f.kernel.get(f.credentials.operator,{id:'stock'})).revision,1);assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM history')).rows[0].n,0);
 const trace=await integrity(f,erp);assert.ok(!trace.audit.some(r=>r.record.kind==='PENDING_EXTERNAL'));assert.equal(trace.actions[0].state,'MANUAL_REVIEW');
 const lost=observedBefore.filter(id=>recovery.results.some(r=>r.actionId===id&&r.lostLocalCommit));assert.deepEqual(lost,independentlyLost);assert.deepEqual(lost,[a.actionId]);assert.ok(fault-checkpoint.monotonic<60000);assert.ok(performance.now()-fault<300000);
 reports.push({scenario:'lost-local-commit',status:'passed',backup:{sha256:checkpoint.hash,at:checkpoint.at},metrics:{lostMutationCount:lostMutationRows.length,lostMutations:lostMutationRows,restoreClassificationRtoMs:performance.now()-fault,backupRpoMs:fault-checkpoint.monotonic,lostCount:lost.length,lostIds:lost,duplicateEffectCount:trace.duplicateEffectCount,resendCount:erp.controller.applyRequests-requestsBeforeRecovery,unresolvedCount:recovery.unresolved.length},recovery,trace});
}));

test('unknown ledger, INTENT crash, journal corruption/unavailability and cross-scope recovery all retain fences',()=>setup(async(f,cluster,erp)=>{
 const a=await f.kernel.submit(f.credentials.operator,f.request()),beforeMutations=await mutations(f);erp.controller.mode='rollback';assert.equal((await f.kernel.dispatch(f.credentials.manager,a)).state,'UNKNOWN');erp.controller.mode='normal';
 await f.kernel.continuitySet(f.credentials.manager,{store:'s1',mode:'RECOVERING',expectedRevision:0});const recovery=await f.kernel.recover(f.credentials.manager,{store:'s1',checkpoint:'unknown-ledger'});assert.equal(recovery.unresolved.length,1);assert.equal(recovery.unresolved[0].reason,'unknown-external-outcome');
 await assert.rejects(f.kernel.dispatch(f.credentials.manager,a),e=>e.code==='INCONSISTENT_STATE');assert.equal(erp.controller.applyRequests,1);
 await assert.rejects(f.kernel.recover(f.credentials.tenant2,{store:'s1',checkpoint:'cross-tenant'}),e=>e.code==='INCONSISTENT_STATE');
 await assert.rejects(f.kernel.journalSnapshot(f.credentials.other,{store:'s1'}),e=>e.code==='PERMISSION_DENIED');
 await f.kernel.continuitySet(f.credentials.manager,{store:'s1',mode:'RECOVERING',expectedRevision:2});
 const original=await readFile(f.journal.path,'utf8');await writeFile(f.journal.path,original.slice(0,-2));
 await assert.rejects(f.kernel.recover(f.credentials.manager,{store:'s1',checkpoint:'corrupt'}),e=>e.code==='INCONSISTENT_STATE');
 assert.equal((await f.owner.query('SELECT mode FROM continuity')).rows[0].mode,'RECOVERING');await writeFile(f.journal.path,original);
 await writeFile(f.journal.path,original.slice(0,original.trimEnd().lastIndexOf('\n')+1));
 await assert.rejects(f.kernel.recover(f.credentials.manager,{store:'s1',checkpoint:'whole-record-loss'}),e=>e.code==='INCONSISTENT_STATE');
 await writeFile(f.journal.path,original);
 await rename(f.journal.path,f.journal.path+'.held');assert.throws(()=>new RecoveryJournal(f.journal.path),e=>e.code==='UNAVAILABLE');await assert.rejects(f.kernel.recover(f.credentials.manager,{store:'s1',checkpoint:'unavailable'}),e=>e.code==='UNAVAILABLE');await rename(f.journal.path+'.held',f.journal.path);
 const snap=await f.kernel.journalSnapshot(f.credentials.manager,{store:'s1'});await assert.rejects(f.kernel.journalList(f.credentials.tenant2,{snapshot:snap}),e=>e.code==='PERMISSION_DENIED');
 await f.kernel.recover(f.credentials.manager,{store:'s1',checkpoint:'before-intent'});
 const crashing=await child(f,cluster,erp,'after-intent');const exit=once(crashing.p,'exit');
 await assert.rejects(rpc(crashing.url,f.credentials.operator,'submit',f.request({input:{targetId:'stock2',isolated:true},idempotencyKey:'intent'})));
 assert.deepEqual(await exit,[null,'SIGKILL']);
 const crashed=f.journal.records().at(-1);assert.equal(crashed.phase,'INTENT');
 assert.equal((await f.owner.query('SELECT * FROM actions WHERE id=$1',[crashed.actionId])).rows.length,0);
 await f.kernel.continuitySet(f.credentials.manager,{store:'s1',mode:'RECOVERING',expectedRevision:4});
 const intentRecovery=await f.kernel.recover(f.credentials.manager,{store:'s1',checkpoint:'intent'});assert.equal(intentRecovery.fenced,true);assert.ok(intentRecovery.unresolved.some(r=>r.reason==='unconfirmed-intent'));
 await assert.rejects(f.kernel.submit(f.credentials.operator,f.request({input:{targetId:'stock2',isolated:true}})),e=>e.code==='INCONSISTENT_STATE');
 const trace=await integrity(f,erp),lost=lostMutations(beforeMutations,trace.mutations);assert.deepEqual(lost,[]);
 assert.equal(trace.mutations.length,beforeMutations.length);assert.equal(erp.controller.applyRequests,1);assert.equal(intentRecovery.unresolved.length,2);
 reports.push({scenario:'manual-and-fences',status:'passed',metrics:{lostMutationCount:lost.length,lostMutations:lost,resendCount:erp.controller.applyRequests-1,duplicateEffectCount:trace.duplicateEffectCount,unresolvedCount:intentRecovery.unresolved.length},recovery:intentRecovery,trace});
}));

test('store degraded quarantine preserves approval, bounds and procurement prohibition through common Kernel',()=>setup(async(f,cluster,erp)=>{
 await seedStore(f);
 const request=async(type,input,key)=>{
  const target=await f.kernel.get(f.credentials.operator,{id:input.targetId});
  const objects=await Promise.all(['recall','demo-lot','stock','stock2'].map(id=>f.kernel.get(f.credentials.operator,{id})));
  return {actionType:type,actionVersion:'1.0.0',ontologyVersion:'1.1.0',input,expectedRevision:target.revision,idempotencyKey:key,evidence:objects.map(o=>({id:o.id,revision:o.revision,digest:digest(o)}))};
 };
 const detected=await f.kernel.submit(f.credentials.operator,await request('DetectRecallImpact',{targetId:'recall'},'store-detect'));
 assert.equal((await f.kernel.dispatch(f.credentials.manager,detected)).state,'DELIVERED');
 const fault=performance.now();await f.kernel.continuitySet(f.credentials.manager,{store:'s1',mode:'DEGRADED',expectedRevision:0});
 const isolateRequest={...await request('QuarantineInventory',{targetId:'stock',caseId:'recall'},'store-isolate'),requireApproval:true};
 const a=await f.kernel.submit(f.credentials.operator,isolateRequest);assert.equal(a.state,'PENDING_APPROVAL');
 assert.equal((await f.kernel.get(f.credentials.operator,{id:'stock'})).fields.isolated,false);
 await assert.rejects(f.kernel.approve(f.credentials.operator,a),e=>e.code==='PERMISSION_DENIED');
 assert.equal((await f.kernel.approve(f.credentials.manager,a)).state,'PENDING_EXTERNAL');
 assert.equal((await f.kernel.get(f.credentials.operator,{id:'stock'})).fields.isolated,true);
 const localRtoMs=performance.now()-fault;assert.ok(localRtoMs<120000);
 await assert.rejects(f.kernel.dispatch(f.credentials.manager,a),e=>e.code==='CONTINUITY_RESTRICTED');
 await assert.rejects(f.kernel.submit(f.credentials.operator,await request('CreateReplacementOrder',{targetId:'recall',candidateId:'replacement',quantity:15},'blocked-order')),e=>e.code==='CONTINUITY_RESTRICTED');
 await f.owner.query("UPDATE objects SET fields=jsonb_set(fields,'{quantity}','101') WHERE id='stock'");
 await assert.rejects(f.kernel.validate(f.credentials.operator,await request('QuarantineInventory',{targetId:'stock',caseId:'recall'},'over-bound')),e=>e.code==='CONTINUITY_RESTRICTED');
 await f.owner.query("UPDATE objects SET fields=jsonb_set(fields,'{quantity}','10') WHERE id='stock'");
 const checkpoint=await backup(f,cluster),beforeMutations=await mutations(f);
 await f.kernel.continuitySet(f.credentials.manager,{store:'s1',mode:'RECOVERING',expectedRevision:1});
 const recovery=await f.kernel.recover(f.credentials.manager,{store:'s1',checkpoint:'store-degraded'});
 assert.equal(recovery.unresolved.length,0);assert.equal((await f.kernel.dispatch(f.credentials.manager,a)).state,'DELIVERED');
 // Replay from a pre-send DB checkpoint while the independent ERP already has
 // the projected payload. Recovery must use that same digest after restart.
 await restore(f,checkpoint,cluster);let restarted;
 const recoveryStart=performance.now();
 try {
  restarted=await child(f,cluster,erp);const call=(op,body)=>rpc(restarted.url,f.credentials.manager,op,body);
  await call('continuitySet',{store:'s1',mode:'RECOVERING',expectedRevision:1});
  // The restored pending Action must remain identifiable in persisted denials
  // while RECOVERING fences both worker paths, before ERP classification.
  const requestsBeforeClassification={apply:erp.controller.applyRequests,status:erp.controller.statusRequests};
  for(const operation of ['dispatch','reconcile'])await assert.rejects(call(operation,a),e=>e.code==='INCONSISTENT_STATE');
  assert.equal(erp.controller.applyRequests,requestsBeforeClassification.apply);assert.equal(erp.controller.statusRequests,requestsBeforeClassification.status);
  assert.equal((await call('status',a)).state,'PENDING_EXTERNAL');
  const confirmed=await call('recover',{store:'s1',checkpoint:checkpoint.hash});
  const classificationRtoMs=performance.now()-recoveryStart;assert.ok(classificationRtoMs<300000);
  assert.equal(confirmed.unresolved.length,0);assert.equal(confirmed.results.find(r=>r.actionId===a.actionId).classification,'applied');
  assert.equal((await call('dispatch',a)).state,'DUPLICATE');
  const trace=await integrity(f,erp);assert.equal(erp.controller.applyRequests,2);
  const event=trace.outbox.find(o=>o.action_id===a.actionId),entry=trace.ledger.find(l=>l.operation_id===a.operationId);
  const saved=trace.actions.find(action=>action.id===a.actionId),denialEvidence=[];
  for(const operation of ['dispatch','reconcile']) {
   const matches=trace.audit.filter(row=>row.record.kind==='Denied'&&row.record.operation==='worker'&&row.record.workerOperation===operation&&row.record.actionId===a.actionId&&row.record.code==='INCONSISTENT_STATE');
   assert.equal(matches.length,1);const {sequence,record}=matches[0];
   assert.equal(record.operationId,a.operationId);assert.equal(record.actionType,saved.request.actionType);assert.equal(record.targetId,saved.request.input.targetId);
   assert.equal(record.actor,'manager');assert.equal(record.originalActor,saved.actor);assert.equal(record.originalSubject,saved.subject);assert.equal(record.originalDelegationId,saved.request.delegationId??null);
   assert.equal(record.inputDigest,saved.digest);assert.deepEqual(record.evidence,saved.request.evidence);
   assert.deepEqual(record.originalVersions,{ontology:saved.request.ontologyVersion,policy:saved.request.policyVersion,rule:saved.request.ruleVersion,workflow:saved.request.workflowVersion});
   const observations=trace.telemetry.filter(row=>row.record.requestId===record.requestId);assert.equal(observations.length,1);
   assert.equal(observations[0].record.traceId,record.traceId);assert.equal(observations[0].record.operation,operation);assert.equal(observations[0].record.code,record.code);
   denialEvidence.push({auditSequence:sequence,actionId:record.actionId,operationId:record.operationId,workerOperation:operation,requestId:record.requestId,traceId:record.traceId,code:record.code});
  }
  assert.equal(event.event.fields.secret,'hidden-word');assert.equal(trace.objects.find(o=>o.id==='stock').fields.secret,'hidden-word');
  assert.deepEqual(entry.payload.fields,{isolated:true});assert.equal(event.state,'DELIVERED');
  const lost=lostMutations(beforeMutations,trace.mutations);assert.deepEqual(lost,[]);
  reports.push({scenario:'store-degraded',status:'passed',backup:{sha256:checkpoint.hash,at:checkpoint.at},metrics:{localRtoMs,classificationRtoMs,lostMutationCount:lost.length,lostMutations:lost,resendCount:erp.controller.applyRequests-2,duplicateEffectCount:trace.duplicateEffectCount,unresolvedCount:confirmed.unresolved.length},recovery,confirmed,denialEvidence,exportEvidence:{actionId:a.actionId,operationId:a.operationId,internalRestrictedFieldRetained:true,externalFields:entry.payload.fields,payloadDigest:entry.digest},trace});
 }finally{await closeChild(restarted);}
},'config/store-ontology.json'));


async function closeChild(c) {if(c?.p.connected){const exit=once(c.p,'exit');c.p.send('close');await exit;}}
async function mutations(f) {return (await f.owner.query('SELECT object_id,revision,action_id,fields FROM history ORDER BY object_id,revision')).rows;}
function lostMutations(before,after) {return before.filter(b=>!after.some(a=>digest(a)===digest(b)));}

test('B-BCP-001: restored pre-send attempt zero plus unreachable ledger stays held until confirmed, never resends',()=>setup(async(f,cluster,erp)=>{
 const request=f.request({idempotencyKey:'restored-send'}),a=await f.kernel.submit(f.credentials.operator,request),checkpoint=await backup(f,cluster);
 const before=await mutations(f);let disconnected=false;
 const proxy=createServer(async(req,res)=>{if(disconnected){req.socket.destroy();return;}try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const r=await fetch(erp.url+req.url,{method:'POST',headers:{authorization:req.headers.authorization,'content-type':'application/json'},body:Buffer.concat(chunks)});res.writeHead(r.status);res.end(await r.text());}catch{req.socket.destroy();}});
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));const network={url:`http://127.0.0.1:${proxy.address().port}`,token:erp.token};let killedProcess,restarted;
 try {
  killedProcess=await child(f,cluster,network,'after-external');erp.controller.mode='lost-ack';const exit=once(killedProcess.p,'exit'),fault=performance.now();
  await assert.rejects(rpc(killedProcess.url,f.credentials.manager,'dispatch',a));assert.deepEqual(await exit,[null,'SIGKILL']);
  assert.equal(erp.controller.applyRequests,1);assert.ok(f.journal.records().some(r=>r.operationId===a.operationId&&r.phase==='SEND_STARTED'));await restore(f,checkpoint,cluster);
  assert.equal((await f.owner.query('SELECT attempt FROM outbox')).rows[0].attempt,0);
  disconnected=true;const recoveryStart=performance.now();restarted=await child(f,cluster,network);
  const call=(op,body,who='manager')=>rpc(restarted.url,f.credentials[who],op,body);
  await call('continuitySet',{store:'s1',mode:'RECOVERING',expectedRevision:0});
  const recovery=await call('recover',{store:'s1',checkpoint:checkpoint.hash});const heldRtoMs=performance.now()-recoveryStart;
  assert.equal(recovery.results[0].external,'UNKNOWN');assert.equal(recovery.unresolved.length,1);assert.equal(recovery.results[0].classification,'manual');
  await assert.rejects(call('dispatch',a),e=>e.code==='INCONSISTENT_STATE');
  await assert.rejects(call('submit',f.request({expectedRevision:2,input:{targetId:'stock',isolated:false}}),'operator'),e=>e.code==='INCONSISTENT_STATE');
  assert.equal(erp.controller.applyRequests,1);
  disconnected=false;erp.controller.mode='normal';await call('continuitySet',{store:'s1',mode:'RECOVERING',expectedRevision:2});
  const confirmed=await call('recover',{store:'s1',checkpoint:checkpoint.hash});assert.equal(confirmed.unresolved.length,0);assert.equal(confirmed.results[0].classification,'applied');
  assert.equal((await call('dispatch',a)).state,'DUPLICATE');assert.equal(erp.controller.applyRequests,1);
  const lost=lostMutations(before,await mutations(f));assert.equal(lost.length,0);const trace=await integrity(f,erp);assert.ok(heldRtoMs<300000&&fault-checkpoint.monotonic<60000);
  reports.push({scenario:'restored-send-unknown',status:'passed',metrics:{backupRpoMs:fault-checkpoint.monotonic,classificationRtoMs:heldRtoMs,lostMutationCount:lost.length,lostMutations:lost,resendCount:erp.controller.applyRequests-1,duplicateEffectCount:trace.duplicateEffectCount,heldUnresolvedCount:recovery.unresolved.length,unresolvedCount:confirmed.unresolved.length},recovery,confirmed,trace});
 }finally{await closeChild(killedProcess);await closeChild(restarted);await new Promise(resolve=>proxy.close(resolve));}
}));

test('B-BCP-002: pending checkpoint retains Action identity but loses approved commit, detects mutation loss and holds target',()=>setup(async(f,cluster,erp)=>{
 const request=f.request({idempotencyKey:'lost-approval',requireApproval:true}),a=await f.kernel.submit(f.credentials.operator,request);assert.equal(a.state,'PENDING_APPROVAL');
 const checkpoint=await backup(f,cluster);let crashing,restarted;
 try {
  crashing=await child(f,cluster,erp,'after-external');await rpc(crashing.url,f.credentials.manager,'approve',a);
  const before=await mutations(f);assert.equal(before.length,1);const beforeIds=(await f.owner.query('SELECT id FROM actions')).rows.map(r=>r.id);
  erp.controller.mode='lost-ack';const exit=once(crashing.p,'exit'),fault=performance.now();await assert.rejects(rpc(crashing.url,f.credentials.manager,'dispatch',a));assert.deepEqual(await exit,[null,'SIGKILL']);
  await restore(f,checkpoint,cluster);const restoredMutations=await mutations(f),lost=lostMutations(before,restoredMutations);
  const afterIds=(await f.owner.query('SELECT id FROM actions')).rows.map(r=>r.id);assert.equal(beforeIds.filter(id=>!afterIds.includes(id)).length,0);assert.equal(lost.length,1);
  restarted=await child(f,cluster,erp);const call=(op,body,who='manager')=>rpc(restarted.url,f.credentials[who],op,body);
  await call('continuitySet',{store:'s1',mode:'RECOVERING',expectedRevision:0});const recovery=await call('recover',{store:'s1',checkpoint:checkpoint.hash});
  assert.equal(recovery.unresolved.length,1);assert.equal(recovery.results[0].lostLocalCommit,true);assert.equal(recovery.results[0].reason,'lost-approved-commit');assert.equal(recovery.results[0].external,'APPLIED');
  assert.equal((await call('status',a,'operator')).state,'MANUAL_REVIEW');assert.equal((await call('submit',request,'operator')).actionId,a.actionId);
  await assert.rejects(call('approve',a),e=>e.code==='PERMISSION_DENIED');await assert.rejects(call('dispatch',a),e=>e.code==='NOT_FOUND');
  await assert.rejects(call('submit',f.request(),'operator'),e=>e.code==='INCONSISTENT_STATE');
  const object=await call('get',{id:'stock'},'operator');assert.equal(object.revision,1);assert.equal(object.fields.isolated,false);
  assert.deepEqual(await mutations(f),restoredMutations);const trace=await integrity(f,erp);assert.ok(!trace.audit.some(r=>r.record.kind==='ApprovedCommit'));assert.equal(trace.effects[0].isolated,true);assert.equal(erp.controller.applyRequests,1);
  const rto=performance.now()-fault;assert.ok(rto<300000&&fault-checkpoint.monotonic<60000);
  reports.push({scenario:'lost-approved-commit',status:'passed',metrics:{backupRpoMs:fault-checkpoint.monotonic,restoreClassificationRtoMs:rto,lostActionIdCount:0,lostMutationCount:lost.length,lostMutations:lost,resendCount:erp.controller.applyRequests-1,duplicateEffectCount:trace.duplicateEffectCount,unresolvedCount:recovery.unresolved.length},recovery,trace});
 }finally{await closeChild(crashing);await closeChild(restarted);}
}));

test('B-BCP-003: restart rejects both missing journal witnesses and a new empty path without auto bootstrap',()=>setup(async(f,cluster,erp)=>{
 const a=await f.kernel.submit(f.credentials.operator,f.request());const before=await mutations(f);
 await rename(f.journal.path,f.journal.path+'.held');await rename(f.journal.headPath,f.journal.headPath+'.held');
 const refusals=[];async function refused(path) {let c;try{c=await child(f,cluster,erp,undefined,path);}catch(error){assert.match(error.message,/child boot failed 1\/null/);refusals.push({path,reason:error.message});return;}finally{await closeChild(c);}assert.fail('restart silently bootstrapped a missing journal');}
 try {
  await refused(f.journal.path);await assert.rejects(readFile(f.journal.path),e=>e.code==='ENOENT');await assert.rejects(readFile(f.journal.headPath),e=>e.code==='ENOENT');
  const emptyPath=f.journal.path+'.new-empty-path';await refused(emptyPath);await assert.rejects(readFile(emptyPath),e=>e.code==='ENOENT');
  await assert.rejects(f.kernel.submit(f.credentials.operator,f.request({input:{targetId:'stock2',isolated:true}})),e=>e.code==='UNAVAILABLE');
  await assert.rejects(f.kernel.dispatch(f.credentials.manager,a),e=>e.code==='UNAVAILABLE');
  assert.equal(erp.controller.applyRequests,0);assert.deepEqual(await mutations(f),before);
  assert.equal((await f.owner.query('SELECT mode FROM continuity')).rows.length,0);
 }finally{await rename(f.journal.path+'.held',f.journal.path);await rename(f.journal.headPath+'.held',f.journal.headPath);}
 const trace=await integrity(f,erp);reports.push({scenario:'missing-journal-restart',status:'passed',metrics:{bootRefusalCount:refusals.length,lostMutationCount:lostMutations(before,trace.mutations).length,resendCount:erp.controller.applyRequests,duplicateEffectCount:trace.duplicateEffectCount,unresolvedCount:trace.actions.filter(a=>a.state!=='SUCCEEDED').length},refusals,trace});
}));

test('export complete machine-readable BCP measurements',async()=>{
 assert.equal(reports.length,7);assert.ok(reports.some(r=>r.scenario==='clean-recovery'&&r.metrics.unresolvedCount===0));
 await mkdir('evidence/generated/bcp',{recursive:true});await writeFile('evidence/generated/bcp/exercise.json',JSON.stringify({schemaVersion:1,clock:'performance.now monotonic controller / UTC timestamps',scope:'local synthetic PostgreSQL 18.6, independent ERP DB/HTTP, separate APFS DB/journal volumes',reports},null,2)+'\n');
});
