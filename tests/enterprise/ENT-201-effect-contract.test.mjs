import test from 'node:test';
import assert from 'node:assert/strict';
import {scenario,evidence,childGateway} from '../../fixtures/enterprise/ENT-201-effect-contract-20261027/scenario.mjs';
import {assertContracts,purchaseScenario,persisted} from '../../fixtures/enterprise/ENT-201-effect-contract-20261027/contracts.mjs';

test('effect contract API exact PO payment origin quantity receipt and RETURN resubmit',()=>scenario('effect-api-chain',async f=>{
 const {call,body}=f;await call('operator','invoiceImport',body);const p1=await f.request();await call('operator','paymentRequest',p1);
 await f.vote('manager',p1.id,'RETURN');assert.equal((await f.payment(p1.id)).reservation,'HELD');await f.deny('manager','dispatch',{id:p1.id},'INVALID_STATE');
 await call('operator','paymentCancel',{id:p1.id});assert.equal((await f.payment(p1.id)).reservation,'RELEASED');
 const current=await f.invoice();await call('operator','invoiceCorrect',{...body,number:body.number+'-訂正',revision:current.revision});
 const p2=await f.request();await call('operator','paymentRequest',p2);await f.approve(p2.id);
 f.env.payments.fault('lost-ack');assert.equal((await call('manager','dispatch',{id:p2.id})).state,'UNKNOWN');assert.equal((await f.payment(p2.id)).reservation,'HELD');
 assert.equal((await call('manager','reconcile',{id:p2.id})).state,'SUCCEEDED');const complete=await f.observe(p2.id);
 const returned=await f.payment(p1.id);assert.equal(complete.ledger.some(x=>x.id===returned.operation.id),false);assert.notEqual((await f.payment(p1.id)).operation.id,complete.payment.operation.id);
 let gateway=await childGateway(f);f.children.push(gateway);const oldPid=gateway.pid;await gateway.close();gateway=await childGateway(f);f.children.push(gateway);assert.notEqual(oldPid,gateway.pid);
 const {login}=await import('./http-helper.mjs');const user=await login({...f.env,gateway},'operator');const response=await user.api('paymentRead',{id:p2.id});assert.equal(response.status,200);assert.equal((await response.json()).result.state,'SUCCEEDED');
 evidence('api-complete',{complete,p1:await f.payment(p1.id),p2:await f.payment(p2.id),restart:{oldPid,newPid:gateway.pid},audit:await call('manager','auditExport',{id:p2.id})});
 await assertContracts(f,complete);
}));

import {digest} from '../../src/contracts.mjs';
import {SyntheticPort} from '../../src/enterprise/worker.mjs';
import {connection} from './connector-scenario.mjs';
import {approvePurchase,receiptBody} from './quantity-helper.mjs';

test('effect contract API rejects missing and forged markers and every origin/package/payload binding before read receive or send',()=>purchaseScenario('effect-api-corruption',async f=>{
 const original=await persisted(f,f.po.id),out=original.outbox,q=(sql,args)=>f.env.f.owner.query(sql,args);
 const variants=[
  ['missing-both',e=>{delete e.operationKind;delete e.destination;}],
  ['missing-kind',e=>{delete e.operationKind;}],['missing-destination',e=>{delete e.destination;}],
  ['payment-kind',e=>{e.operationKind='invoice-payment';}],['payment-destination',e=>{e.destination='local-synthetic-payment';}],
  ...['packageId','packageVersion','packageDigest','operationId','actionId','aggregateId','tenant','schemaVersion','contractVersion'].map(k=>[k,e=>{e[k]='different-'+e[k];}]),
  ['revision',e=>{e.objectRevision++;}],['sequence',e=>{e.sequence++;}],
  ['scope',e=>{e.scope={...e.scope,region:'different'};}],['quantity',e=>{e.fields.quantity=1;}],['unit',e=>{e.fields.unit='個';}],['quote-version',e=>{e.fields.quoteVersion++;}],
  ['payload-digest',e=>{},'wrong-digest']
 ];const results=[];
 for(const [name,mutate,badDigest] of variants){
  const event=structuredClone(out.event);mutate(event);const changedDigest=badDigest??digest(event);
  await q('UPDATE outbox SET event=$2,digest=$3 WHERE operation_id=$1',[out.operation_id,JSON.stringify(event),changedDigest]);
  try{
   const read=await f.deny('operator','purchaseRead',{id:f.po.id}),send=await f.deny('manager','dispatch',{id:f.po.id});
   const receipt=await f.deny('agent','purchaseReceive',receiptBody(f.po,{revision:original.object.revision,order:{operationId:out.operation_id}}));
   assert.deepEqual(await f.env.effects.ledger(),[]);assert.deepEqual(f.env.effects.requests(),[]);
   const after=await persisted(f,f.po.id);assert.equal(after.instance.state,'READY');assert.deepEqual(after.outbox.event,event);assert.equal(after.outbox.digest,changedDigest);
   results.push({name,event,digest:changedDigest,read,send,receipt,outboxState:after.outbox.state,requests:[],ledger:[]});
  }finally{await q('UPDATE outbox SET event=$2,digest=$3 WHERE operation_id=$1',[out.operation_id,JSON.stringify(out.event),out.digest]);}
 }
 for(const [name,mutate] of [['origin-object',r=>{r.body.id='other-public-origin';}],['origin-operation',r=>{r.operation='paymentRequest';}],['origin-package',r=>{r.body.packageVersion='1.0.0';}],['origin-quantity',r=>{r.body.quantity=1;}],['origin-unit',r=>{r.body.unit='個';}],['origin-scope',r=>{r.body.scope={...r.body.scope,region:'different'};}],['origin-title',r=>{r.body.title='other origin';}],['origin-budget',r=>{r.body.budgetId='other-budget';}],['origin-currency',r=>{r.body.currency='USD';}]]){
  const request=structuredClone(original.action.request);mutate(request);await q('UPDATE actions SET request=$2 WHERE id=$1',[original.action.id,JSON.stringify(request)]);
  try{await f.deny('operator','purchaseRead',{id:f.po.id});await f.deny('manager','dispatch',{id:f.po.id});assert.deepEqual(f.env.effects.requests(),[]);results.push({name,request,requests:[]});}
  finally{await q('UPDATE actions SET request=$2 WHERE id=$1',[original.action.id,JSON.stringify(original.action.request)]);}
 }
 assert.equal((await f.call('manager','dispatch',{id:f.po.id})).state,'SUCCEEDED');
 const source=await f.call('operator','purchaseRead',{id:f.po.id});await f.call('agent','purchaseReceive',receiptBody(f.po,source));
 const appliedLedger=await f.env.effects.ledger();const historical=await persisted(f,f.po.id),missing=structuredClone(out.event);delete missing.operationKind;delete missing.destination;
 await q('UPDATE outbox SET event=$2,digest=$3 WHERE operation_id=$1',[out.operation_id,JSON.stringify(missing),digest(missing)]);
 await f.deny('operator','purchaseRead',{id:f.po.id});await f.deny('manager','dispatch',{id:f.po.id});await f.deny('agent','purchaseReceive',receiptBody(f.po,source));
 const retained=await persisted(f,f.po.id);assert.deepEqual(retained.outbox.event,missing);assert.equal(retained.outbox.digest,digest(missing));assert.deepEqual(await f.env.effects.ledger(),appliedLedger);assert.equal(f.env.effects.requests().length,1);
 f.record('corruptions',{original,results,historical,retained,ledger:await f.env.effects.ledger(),requests:f.env.effects.requests()});
}));

test('effect contract API refuses procurement route and connector before effects while retaining approved event',()=>purchaseScenario('effect-api-route',async f=>{
 const c=await connection(f.env.f,f.env.cluster,'mail');
 try{
  await f.deny('operator','routeSet',{id:f.po.id,connectionId:c.body.id},'PERMISSION_DENIED');
  assert.equal((await f.env.f.owner.query('SELECT * FROM enterprise_routes WHERE object_id=$1',[f.po.id])).rowCount,0);
  await approvePurchase({call:f.call},f.po);const original=await persisted(f,f.po.id);
  const work=port=>f.env.f.kernel.enterpriseWork(f.env.f.credentials.manager,{id:f.po.id,mode:'dispatch'},port);
  class ForgedLocal extends SyntheticPort{}
  for(const port of [c.port,new ForgedLocal(f.env.payments.url)])await assert.rejects(work(port),{code:'PERMISSION_DENIED'});
  await f.env.f.owner.query('INSERT INTO enterprise_routes VALUES($1,$2,$3,$4)',[f.po.id,c.body.id,1,original.instance.binding]);
  await f.deny('operator','purchaseRead',{id:f.po.id},'PERMISSION_DENIED');await f.deny('agent','purchaseReceive',receiptBody(f.po,{revision:original.object.revision,order:{operationId:original.outbox.operation_id}}),'PERMISSION_DENIED');
  await f.deny('manager','dispatch',{id:f.po.id},'PERMISSION_DENIED');await assert.rejects(work(c.port),{code:'PERMISSION_DENIED'});
  assert.deepEqual(c.server.requests(),[]);assert.deepEqual(f.env.effects.requests(),[]);assert.deepEqual(await c.server.ledger(),[]);assert.deepEqual(await f.env.effects.ledger(),[]);
  assert.deepEqual((await persisted(f,f.po.id)).outbox,original.outbox);
  f.record('rejected',{original,current:await persisted(f,f.po.id),externalRequests:c.server.requests(),externalLedger:await c.server.ledger()});
 }finally{await c.server.close();}
},{approved:false}));

test('effect contract API rechecks binding in send transaction and UNKNOWN ABSENT never retries POST',()=>purchaseScenario('effect-api-before-send',async f=>{
 const original=await persisted(f,f.po.id),out=original.outbox;
 f.env.f.kernel.fault=async point=>{if(point==='enterprise-before-send'){const event={...out.event,destination:'local-synthetic-payment'};await f.env.f.owner.query('UPDATE outbox SET event=$2,digest=$3 WHERE operation_id=$1',[out.operation_id,JSON.stringify(event),digest(event)]);}};
 assert.equal((await f.call('manager','dispatch',{id:f.po.id})).state,'UNKNOWN');f.env.f.kernel.fault=async()=>{};
 assert.deepEqual(f.env.effects.requests(),[]);assert.deepEqual(await f.env.effects.ledger(),[]);
 const held=await f.call('operator','assuranceRead',{id:f.seed.budgetId});assert.equal(held.data.reservations.find(x=>x.reference===f.po.id).state,'RESERVED');
 await f.deny('manager','reconcile',{id:f.po.id});
 await f.env.f.owner.query('UPDATE outbox SET event=$2,digest=$3 WHERE operation_id=$1',[out.operation_id,JSON.stringify(out.event),out.digest]);
 const absent=await f.call('manager','reconcile',{id:f.po.id});assert.deepEqual(absent,{id:f.po.id,state:'UNKNOWN',observation:'ABSENT',requiresHumanReview:true});
 await f.deny('manager','dispatch',{id:f.po.id},'INVALID_STATE');
 assert.deepEqual(f.env.effects.requests(),[{method:'GET',path:'/effects/'+out.operation_id}]);assert.deepEqual(await f.env.effects.ledger(),[]);
 const after=await persisted(f,f.po.id);assert.equal(after.instance.state,'UNKNOWN');assert.equal(after.outbox.state,'UNKNOWN');
 f.record('held-absent',{original,held,absent,after,requests:f.env.effects.requests()});
}));

import {spawn} from 'node:child_process';
test('effect contract API real worker death preserves explicit immutable operation across process restart and manual GET',()=>purchaseScenario('effect-api-worker-death',async f=>{
 const before=await persisted(f,f.po.id),command=[process.execPath,'tests/enterprise/worker-child.mjs'];
 const child=(mode,crash)=>new Promise((resolve,reject)=>{
  const startedAt=new Date().toISOString(),p=spawn(command[0],command.slice(1),{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);p.on('error',reject);p.on('close',(exitCode,signal)=>resolve({pid:p.pid,argv:command,cwd:process.cwd(),runtime:process.version,startedAt,finishedAt:new Date().toISOString(),exitCode,signal,stdout,stderr}));
  const {host,port,user,database,options}=f.env.f.state.pool.options;p.stdin.end(JSON.stringify({config:{host,port,user,database,options},journal:f.env.f.journal.path,credential:f.env.f.credentials.manager,id:f.po.id,mode,url:f.env.effects.url,crash}));
 });
 const died=await child('dispatch','enterprise-after-send');assert.equal(died.exitCode,73,died.stderr);assert.equal(died.signal,null);
 const unknown=await persisted(f,f.po.id);assert.equal(unknown.instance.state,'UNKNOWN');assert.equal(unknown.outbox.state,'UNKNOWN');assert.deepEqual(unknown.outbox.event,before.outbox.event);
 const held=await f.call('operator','assuranceRead',{id:f.seed.budgetId});assert.equal(held.data.reservations.find(x=>x.reference===f.po.id).state,'RESERVED');
 await f.deny('manager','dispatch',{id:f.po.id},'INVALID_STATE');
 const restarted=await child('reconcile');assert.equal(restarted.exitCode,0,restarted.stderr);assert.equal(restarted.signal,null);assert.notEqual(died.pid,restarted.pid);assert.equal(JSON.parse(restarted.stdout).state,'SUCCEEDED');
 const after=await persisted(f,f.po.id),ledger=await f.env.effects.ledger();assert.equal(after.instance.state,'SUCCEEDED');assert.deepEqual(after.outbox.event,before.outbox.event);assert.equal(after.outbox.digest,before.outbox.digest);assert.equal(ledger.length,1);assert.equal(ledger[0].applications,1);assert.deepEqual(ledger[0].payload,before.outbox.event);assert.equal(ledger[0].payload.operationKind,'procurement-order');assert.equal(ledger[0].payload.destination,'local-synthetic-procurement');assert.deepEqual(f.env.effects.requests(),[{method:'POST',path:'/effects'},{method:'GET',path:'/effects/'+before.outbox.operation_id}]);
 f.record('restart',{before,died,unknown,held,restarted,after,ledger,requests:f.env.effects.requests(),source:await f.call('operator','purchaseRead',{id:f.po.id})});
}));

test('effect contract API route introduced after durable intent is refused in send transaction without connector or local POST',()=>purchaseScenario('effect-api-route-race',async f=>{
 const c=await connection(f.env.f,f.env.cluster,'mail'),before=await persisted(f,f.po.id);
 try{
  f.env.f.kernel.fault=async point=>{if(point==='enterprise-before-send')await f.env.f.owner.query('INSERT INTO enterprise_routes VALUES($1,$2,$3,$4)',[f.po.id,c.body.id,1,before.instance.binding]);};
  const unknown=await f.call('manager','dispatch',{id:f.po.id});assert.equal(unknown.state,'UNKNOWN');f.env.f.kernel.fault=async()=>{};
  await f.deny('operator','purchaseRead',{id:f.po.id},'PERMISSION_DENIED');await f.deny('manager','reconcile',{id:f.po.id},'PERMISSION_DENIED');
  assert.deepEqual(f.env.effects.requests(),[]);assert.deepEqual(c.server.requests(),[]);assert.deepEqual(await c.server.ledger(),[]);assert.deepEqual(await f.env.effects.ledger(),[]);
  const held=await f.call('operator','assuranceRead',{id:f.seed.budgetId});assert.equal(held.data.reservations.find(x=>x.reference===f.po.id).state,'RESERVED');
  const after=await persisted(f,f.po.id);assert.equal(after.instance.state,'UNKNOWN');assert.deepEqual(after.outbox.event,before.outbox.event);assert.equal(after.outbox.digest,before.outbox.digest);
  f.record('route-race',{before,unknown,held,after,connectorRequests:c.server.requests(),localRequests:f.env.effects.requests()});
 }finally{await c.server.close();}
}));
