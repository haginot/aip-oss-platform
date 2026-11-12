import test from 'node:test';
import assert from 'node:assert/strict';
import {scenario,evidence,ops,allFields,login,childGateway,envelope,rpc,ok,denied,business,audit,grant,createCase,compareCase,receiptBody,approvePurchase,policy,observed} from './ENT-201-public-read-support.mjs';

test('A01 durable query get inspect history and actual procurement states are read only',async()=>{
 await scenario('a01',async f=>{
  const p=await createCase(f),states=[];
  const see=async state=>{const value=await observed(f,'get',p.id);assert.equal(value.purchase.state,state);assert.equal(value.identity.purchaseId,p.id);assert.equal(value.type,'ENT201Case');assert.deepEqual(await observed(f,'inspect',p.id),value);const h=await observed(f,'history',p.id);assert.ok(Array.isArray(h.events));assert.ok(h.audit.events.length);assert.ok((await observed(f,'query')).items.some(x=>x.id===p.id));states.push(value);};
  await see('REQUESTED');const compared=await compareCase(f,p);await see('COMPARED');await approvePurchase(f,{...p,revision:compared.revision});await see('ORDER_READY');
  f.env.effects.fault('lost-ack');await f.call('manager','dispatch',{id:p.id});await see('UNKNOWN');await f.call('manager','reconcile',{id:p.id});await see('ORDER_CONFIRMED');const ordered=await f.call('operator','purchaseRead',{id:p.id});await f.call('agent','purchaseReceive',receiptBody(p,ordered));await see('RECEIVED');assert.equal(states.at(-1).purchase.receipt.actor,'agent');assert.equal(states.at(-1).purchase.quotes.length,2);assert.equal(states.at(-1).workflow.votes.length,3);evidence('states',states);
 });
});
test('A02 1.0 UNKNOWN and 1.1 pinned quantity and distinct revisions coexist after publication',async()=>{
 await scenario('a02',async f=>{
  const old=await observed(f,'inspect',f.legacy.id),known=await observed(f,'inspect');assert.equal(old.definition.version,'1.0.0');assert.equal(old.purchase.quantityContract.status,'UNKNOWN');assert.equal(old.purchase.quantityContract.requested,null);assert.equal(known.definition.version,'1.1.0');assert.notEqual(old.definition.digest,known.definition.digest);assert.deepEqual(known.purchase.package,{version:known.definition.version,digest:known.definition.digest});assert.equal(known.purchase.quantityContract.requested.quantity,7);assert.equal(known.purchase.quantityContract.received.quantity,7);assert.equal(known.fields.quoteVersion,2);assert.equal(known.purchase.order.objectRevision,known.revision-1);assert.equal(known.purchase.receipt.orderedRevision,known.purchase.order.objectRevision);assert.equal(known.purchase.receipt.packageDigest,known.definition.digest);evidence('versions',{old,known});
 });
});
test('A03 exact envelope body ID transport and namespace validation preserves ENT202Case denial',async()=>{
 await scenario('a03',async f=>{
  const before=await business(f);
  for(const request of [null,[],{}, {...envelope(),actor:'publisher'},{...envelope(),key:'write'},envelope('query',null),envelope('query',{id:f.po.id}),envelope('get',{}),envelope('get',{id:123}),envelope('get',{id:'../private'}),envelope('get',{id:f.po.id,purchaseId:f.po.id})])await denied(f,'query',{},'manager','INVALID_ARGUMENT',{request,raw:JSON.stringify(request)});
  for(const contractVersion of ['1.0.0','2.0.1',2,null])await denied(f,'query',{},'manager','UNSUPPORTED_VERSION',{request:{...envelope(),contractVersion}});
  for(const change of [{type:'ENT202Case'},{type:'PurchaseRequest'},{packageId:'enterprise-procurement'}])await denied(f,'query',{},'manager','NOT_FOUND',{request:{...envelope(),...change}});
  for(const headers of [{cookie:''},{origin:'https://invalid.example'},{'x-csrf-token':'invalid'},{'content-type':'text/plain'}])await denied(f,'query',{},'manager','PERMISSION_DENIED',{headers});
  for(const raw of ['{',' '.repeat(131073),JSON.stringify({...envelope(),body:{padding:'x'.repeat(131073)}})])await denied(f,'query',{},'manager','INVALID_ARGUMENT',{raw});assert.deepEqual(await business(f),before);
 });
});
test('A04 missing supplier invoice payment and unsafe deep links expose no retained fields',async()=>{
 await scenario('a04',async f=>{
  await f.call('operator','invoiceImport',f.body);const p=await f.request();await f.call('operator','paymentRequest',p);const before=await business(f);
  for(const id of ['missing-case',f.seed.supplierIds[0],f.body.id,p.id,f.account.id])for(const op of ['get','inspect','history'])await denied(f,op,{id},'manager','NOT_FOUND');
  for(const [part,status] of [[f.po.id,200],['missing-case',404],['bad%2Fid',400],['a/b',404],['%ZZ',400]]){const r=await fetch(f.env.gateway.origin+'/enterprise/cases/ENT-201/'+part,{headers:{cookie:f.clients.manager.cookie}});assert.equal(r.status,status);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(r.headers.get('cache-control'),'no-store');const body=await r.text();assert.equal(body.includes(f.po.title),false);evidence('route-'+encodeURIComponent(part),{status:r.status,body});}assert.deepEqual(await business(f),before);
 });
});
test('A05 current tenant department and classification filter and deny without broader grants',async()=>{
 await scenario('a05',async f=>{
  await denied(f,'query',{},'tenant2','NOT_FOUND');await denied(f,'get',{id:f.po.id},'tenant2','NOT_FOUND');assert.deepEqual((await ok(f,'query',{},'other')).items,[]);for(const op of ['get','inspect','history'])await denied(f,op,{id:f.po.id},'other','NOT_FOUND');
  for(const change of [{scopes:[]},{fields:['PUBLIC','INTERNAL']}]){await grant(f,'manager',change);assert.deepEqual((await ok(f)).items,[]);await denied(f,'get',{id:f.po.id},'manager',change.scopes?'NOT_FOUND':'PERMISSION_DENIED');await grant(f);}assert.equal((await ok(f,'get',{id:f.po.id})).id,f.po.id);
 });
});
test('A06 independent read search audit and session revocation and legitimate recovery',async()=>{
 await scenario('a06',async f=>{
  for(const permission of ['read','search','audit','session']){
   await ok(f,'history',{id:f.po.id});if(permission==='session')await f.call('manager','logout',{});else await grant(f,'manager',{operations:ops.filter(x=>x!==permission)});
   const before=await business(f);if(['read','search','session'].includes(permission))await denied(f,'query',{},'manager','PERMISSION_DENIED');else await ok(f);
   for(const op of ['get','inspect','history']){if(permission==='search'||permission==='audit'&&op!=='history')await ok(f,op,{id:f.po.id});else await denied(f,op,{id:f.po.id},'manager','PERMISSION_DENIED');}assert.deepEqual(await business(f),before);
   if(permission!=='session')await grant(f);f.clients.manager=await login(f.env,'manager');await ok(f,'history',{id:f.po.id});
  }
 });
});
test('A07 retained purchase source policy revokes public visibility through real kernel policy',async()=>{
 await scenario('a07',async f=>{await ok(f,'inspect',{id:f.po.id});await policy(f,f.po.id);const before=await business(f);for(const op of ['get','inspect','history'])await denied(f,op,{id:f.po.id},'manager','PERMISSION_DENIED');assert.equal((await ok(f)).items.some(x=>x.id===f.po.id),false);assert.deepEqual(await business(f),before);evidence('source-policy',{audit:await audit(f)});});
});
test('A08 real mid-composition and query revocation suppresses retained partial responses',async()=>{
 await scenario('a08',async f=>{
  const native=f.env.f.kernel.enterprise.bind(f.env.f.kernel);
  for(const operation of ['get','inspect','history','query'])for(const change of ['scope','classification','read']){
   let armed=true;f.env.f.kernel.enterprise=async(...args)=>{const value=await native(...args);if(armed&&args[1].operation===(operation==='query'?'query':'purchaseRead')){armed=false;await grant(f,'manager',change==='scope'?{scopes:[]}:change==='classification'?{fields:['PUBLIC','INTERNAL']}:{operations:ops.filter(x=>x!=='read')});}return value;};
   try{const response=await rpc(f,operation,operation==='query'?{}:{id:f.po.id});assert.notEqual(response.status,200,JSON.stringify(response));assert.deepEqual(Object.keys(response.data),['error']);assert.equal(JSON.stringify(response.data).includes(f.po.title),false);}finally{f.env.f.kernel.enterprise=native;await grant(f);}
  }
  let armed=true;f.env.f.kernel.enterprise=async(...args)=>{const value=await native(...args);if(armed&&args[1].operation==='purchaseRead'){armed=false;await policy(f,f.po.id);}return value;};try{await denied(f,'inspect',{id:f.po.id},'manager','PERMISSION_DENIED');}finally{f.env.f.kernel.enterprise=native;}
  armed=true;f.env.f.kernel.enterprise=async(...args)=>{const value=await native(...args);if(armed&&args[1].operation==='query'){armed=false;await policy(f,f.legacy.id);}return value;};try{const response=await rpc(f);assert.notEqual(response.status,200);assert.deepEqual(Object.keys(response.data),['error']);}finally{f.env.f.kernel.enterprise=native;}
 });
});
test('A09 actual concurrent quote selection and approval fail CONFLICT then fresh read recovers',async()=>{
 await scenario('a09',async f=>{
  const p=await createCase(f),compared=await compareCase(f,p),native=f.env.f.kernel.enterprise.bind(f.env.f.kernel);let armed=true;
  f.env.f.kernel.enterprise=async(...args)=>{const value=await native(...args);if(armed&&args[1].operation==='get'&&args[1].body.id===p.id){armed=false;await f.call('manager','vote',{id:p.id,revision:compared.revision,decision:'APPROVE'});}return value;};
  try{await denied(f,'inspect',{id:p.id},'manager','CONFLICT');const value=await ok(f,'inspect',{id:p.id});assert.equal(value.workflow.votes.length,1);assert.deepEqual(value.workflow.votes,value.purchase.workflow.votes);evidence('fresh-coherent',value);}finally{f.env.f.kernel.enterprise=native;}
 });
});
test('A10 final audit authority check rejects retained history and restoration recovers',async()=>{
 await scenario('a10',async f=>{const native=f.env.f.kernel.enterprise.bind(f.env.f.kernel);let armed=true,after;
  f.env.f.kernel.enterprise=async(...args)=>{const value=await native(...args);if(armed&&args[1].operation==='auditExport'){armed=false;await grant(f,'manager',{operations:ops.filter(x=>x!=='audit')});after=await business(f);}return value;};
  try{await denied(f,'history',{id:f.po.id},'manager','PERMISSION_DENIED');assert.deepEqual(await business(f),after);await grant(f);assert.ok((await ok(f,'history',{id:f.po.id})).audit.events.length);}finally{f.env.f.kernel.enterprise=native;}
 });
});
test('A11 distinct fully waited gateway children preserve SQL journal identity pinned data and current rights',async()=>{
 await scenario('a11',async f=>{const before=await business(f),first=await childGateway(f);f.children.push(first);let client=await login({...f.env,gateway:first},'manager');const prior=await ok(f,'inspect',{id:f.po.id},'manager',{origin:first.origin,client});await first.close();const second=await childGateway(f);f.children.push(second);assert.notEqual(first.pid,second.pid);client=await login({...f.env,gateway:second},'manager');const restored=await ok(f,'inspect',{id:f.po.id},'manager',{origin:second.origin,client});assert.deepEqual(restored,prior);await ok(f,'history',{id:f.po.id},'manager',{origin:second.origin,client});assert.deepEqual(await business(f),before);await grant(f,'manager',{scopes:[]});await denied(f,'get',{id:f.po.id},'manager','NOT_FOUND',{origin:second.origin,client});evidence('restart',{first:{pid:first.pid,origin:first.origin},second:{pid:second.pid,origin:second.origin},prior,restored});});
});
test('A12 public read retries and every unsupported write have zero business or external effects',async()=>{
 await scenario('a12',async f=>{const before=await business(f);for(let retry=0;retry<2;retry++)for(const op of ['query','get','inspect','history'])await ok(f,op,op==='query'?{}:{id:f.po.id});for(const op of ['create','validate','delegate','submit','approve','return','cancel','dispatch','reconcile'])await denied(f,op,{id:f.po.id},'manager','UNSUPPORTED_CAPABILITY');const after=await business(f);assert.deepEqual(after,before);evidence('no-effects',{before,after,audit:await audit(f)});});
});
