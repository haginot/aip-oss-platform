import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {localEnvironment} from '../../scripts/enterprise/local.mjs';
import {browser} from './browser-helper.mjs';
import {login} from './http-helper.mjs';
import {seedProcurement} from './procurement-helper.mjs';
import {evidence} from './assurance-helper.mjs';

test('real-browser-interaction ENT-201 purchase through receipt using durable synthetic HTTP',async t=>{
 const env=await localEnvironment();let page;const http=[];
 try{
  const clients={};for(const who of ['operator','manager','reviewer','publisher','agent'])clients[who]=await login(env,who);
  const call=async(who,op,body,key)=>{const response=await clients[who].api(op,body,key),data=await response.json();http.push({who,operation:op,status:response.status,data});assert.equal(response.status,200,JSON.stringify(data));return data.result;};
  const seed=await seedProcurement(env.f,call),id='browser-purchase-'+randomUUID();page=await browser();
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`const nativeFetch=window.fetch;window.fetch=async(...args)=>{const response=await nativeFetch(...args);if(args[0]==='/api'){const records=JSON.parse(sessionStorage.getItem('procurement-http')??'[]');records.push({request:JSON.parse(args[1].body),status:response.status,body:await response.clone().json()});sessionStorage.setItem('procurement-http',JSON.stringify(records));}return response;};`});
  const signIn=async who=>{await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]',who);await page.click('button');await page.until(`document.querySelector('#identity')?.textContent==='ログイン中: ${who}'`);await page.navigate(env.gateway.origin+'/procurement');await page.until(`document.querySelector('#identity')?.textContent==='ログイン中: ${who}'`);};
  const open=async()=>{await page.fill('#target',id);await page.click('#open');await page.until(`document.querySelector('#detail').dataset.id===${JSON.stringify(id)}`);};
  const state=async expected=>page.until(`document.querySelector('#detail').dataset.state===${JSON.stringify(expected)}`);
  await signIn('operator');await page.fill('#title','合成会社の備品購入・日本語');await page.fill('#budget',seed.budgetId);
  await t.test('japanese-keyboard-error-recovery invalid purchase ID corrected by keyboard',async()=>{
   await page.fill('#new-id','不正な ID');await page.click('#create button');await page.until('document.querySelector("#message").textContent.includes("INVALID_ARGUMENT")');
   await page.evaluate('document.querySelector("#new-id").focus();document.querySelector("#new-id").select()');await page.send('Input.insertText',{text:id});
   await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await state('REQUESTED');
  });
  for(const [index,supplierId] of seed.supplierIds.slice(0,2).entries()){
   await page.fill('#quote-id','q'+index);await page.fill('#supplier',supplierId);await page.fill('#amount',index?'1400':'-1');await page.click('#quote button');
   if(index===0){await page.until('document.querySelector("#message").textContent.includes("INVALID_ARGUMENT")');await page.fill('#amount','1200');await page.click('#quote button');}
   await page.until(`document.querySelector('#quotes').children.length===${index+1}`);
  }
  await page.fill('#chosen','q0');await page.fill('#reason','同一仕様の相見積を比較し、総額の低い見積を選定');await page.click('#selection button');await state('COMPARED');
  await page.click('#approve');await page.until('document.querySelector("#message").textContent.includes("PERMISSION_DENIED")');await page.screenshot('01-compared');
  for(const [index,who] of ['manager','reviewer','publisher'].entries()){
   await signIn(who);await open();await page.click('#approve');await page.until(`document.querySelector('#approvals').children.length===${index+1}`);
  }
  await state('ORDER_READY');env.effects.fault('lost-ack');await page.click('#dispatch');await state('UNKNOWN');await page.screenshot('02-order-unknown');await page.click('#reconcile');await state('ORDER_CONFIRMED');
  await page.fill('#receipt-note','承認者による受領は拒否');await page.click('#receive button');await page.until('document.querySelector("#message").textContent.includes("PERMISSION_DENIED")');
  await signIn('agent');await open();await page.fill('#receipt-note','独立担当者が全量・仕様を確認');await page.click('#receive button');await state('RECEIVED');await page.screenshot('03-received');
  await t.test('persistent-history-after-reload purchase receipt and comparison survive reload',async()=>{
   await page.navigate(env.gateway.origin+'/procurement');await page.until('document.querySelector("#identity").textContent.includes("agent")');await open();await state('RECEIVED');assert.equal(await page.evaluate('document.querySelector("#history").children.length'),5);assert.match(await page.evaluate('document.querySelector("#summary").textContent'),/独立担当者/);
  });
  await t.test('forbidden-data-absent-in-response-and-dom reader and other department denied',async()=>{
   for(const who of ['reader','other','tenant2']){
    await signIn(who);await page.until('document.querySelector("#cases").children.length===0');
    const probe=await page.evaluate(`(async()=>{const s=await(await fetch('/session')).json(),r=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrf},body:JSON.stringify({contractVersion:'2.0.0',operation:'purchaseRead',body:{id:${JSON.stringify(id)}}})});return {status:r.status,text:await r.text(),dom:document.body.textContent}})()`);
    assert.equal(probe.status,who==='reader'?403:404);for(const value of [id,seed.budgetId,seed.supplierIds[0],'独立担当者']){assert.equal(probe.text.includes(value),false);assert.equal(probe.dom.includes(value),false);}
   }await page.screenshot('04-forbidden');
  });
  const record=await call('operator','purchaseRead',{id}),ledger=await env.effects.ledger();assert.equal(record.state,'RECEIVED');assert.equal(ledger.length,1);assert.equal(ledger[0].applications,1);assert.equal(ledger[0].payload.fields.amount,1200);assert.equal(ledger[0].payload.fields.supplierId,seed.supplierIds[0]);assert.equal(ledger[0].payload.fields.quoteId,'q0');assert.equal(ledger[0].payload.aggregateId,id);
  const audit=await call('manager','auditExport',{id});assert.ok(audit.events.some(e=>e.record.operation==='purchaseReceive'));evidence('browser-complete',{browser:await page.send('Browser.getVersion'),executable:page.executable,http,browserHttp:await page.evaluate("JSON.parse(sessionStorage.getItem('procurement-http'))"),record,ledger,audit,externalRequests:env.effects.requests(),postgres:env.cluster.version});
 }finally{await page?.close();await env.close();}
});

test('real-browser-interaction ENT-201 R2 STRICT read and refresh after classification revocation',async()=>{
 const {scope,comparePurchase}=await import('./procurement-helper.mjs');const strict={...scope,classification:'STRICT'};
 const env=await localEnvironment({fixtureOptions:{enterpriseScopes:[scope,strict]}});let page;const http=[];
 try{
  const clients={};for(const who of ['operator','manager','reviewer','publisher','reader'])clients[who]=await login(env,who);
  const call=async(who,operation,body,key=randomUUID())=>{const response=await clients[who].api(operation,body,key),data=await response.json();http.push({who,operation,body,key,status:response.status,data});assert.equal(response.status,200,JSON.stringify(data));return data.result;};
  const seed=await seedProcurement(env.f,call,strict),b=await comparePurchase({call},seed);
  const grant=fields=>call('publisher','grant',{principal:'reader',scopes:[strict],operations:['read','search'],fields});
  await grant(['CONFIDENTIAL','STRICT']);page=await browser();
  await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]','reader');await page.click('button');await page.until('document.querySelector("#identity")?.textContent==="ログイン中: reader"');
  await page.navigate(env.gateway.origin+'/procurement');await page.until('document.querySelector("#cases").children.length===1');await page.click('#cases button');await page.until('document.querySelector("#detail").dataset.state==="COMPARED"');
  assert.equal(await page.evaluate(`document.querySelector('#summary').textContent.includes(${JSON.stringify(seed.budgetId)})`),true);await page.screenshot('R2-authorized');
  await grant(['CONFIDENTIAL']);
  const probe=async(operation,body)=>{const response=await clients.reader.api(operation,body),data=await response.json();const record={operation,body,status:response.status,data};http.push(record);return record;};
  for(const operation of ['purchaseRead','get','history']){const r=await probe(operation,{id:b.id});assert.equal(r.status,403);assert.deepEqual(r.data,{error:{code:'PERMISSION_DENIED'}});}
  const proposal=await probe('propose',{id:b.id,projection:['title'],purpose:'summary',maxCost:1});assert.equal(proposal.status,403);assert.deepEqual(proposal.data,{error:{code:'PERMISSION_DENIED'}});
  for(const body of [{packageId:'enterprise-procurement',type:'PurchaseRequest'},{packageId:'enterprise-procurement',type:'PurchaseRequest',projection:['title'],search:{field:'title',text:b.title},export:true}]){
   const r=await probe('query',body);assert.equal(r.status,200);assert.deepEqual(r.data.result,{items:[]});
  }
  const aggregate=await probe('query',{packageId:'enterprise-procurement',type:'PurchaseRequest',aggregate:true});assert.deepEqual(aggregate.data.result,{count:0});
  await page.click('#reload');await page.until('document.querySelector("#cases").children.length===0 && document.querySelector("#detail").hidden');
  for(const value of [b.id,b.title,seed.budgetId,seed.supplierIds[0]])assert.equal(await page.evaluate(`document.body.textContent.includes(${JSON.stringify(value)})`),false);
  assert.equal(await page.evaluate('document.querySelector("#target").value'),'');await page.screenshot('R2-revoked-cleared');
  // A fresh denied detail attempt also leaves neither the old detail nor list behind.
  await page.fill('#target',b.id);await page.click('#open');await page.until('document.querySelector("#message").textContent.includes("PERMISSION_DENIED")');
  assert.equal(await page.evaluate('document.querySelector("#summary").textContent'),'');assert.equal(await page.evaluate('document.querySelector("#detail").hidden'),true);
  await grant(['CONFIDENTIAL','STRICT']);await page.click('#reload');await page.until('document.querySelector("#cases").children.length===1');await page.click('#cases button');await page.until('document.querySelector("#detail").dataset.state==="COMPARED"');
  evidence('R2-browser-classification',{http,scope:strict,record:b,revokedDomCleared:true,restoredRead:true,browser:await page.send('Browser.getVersion'),executable:page.executable});
 }finally{await page?.close();await env.close();}
});
