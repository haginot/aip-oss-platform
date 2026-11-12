import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {localEnvironment} from '../../scripts/enterprise/local.mjs';
import {browser} from './browser-helper.mjs';
import {login} from './http-helper.mjs';
import {seedQuantity} from './quantity-helper.mjs';
import {evidence} from './assurance-helper.mjs';

test('real-browser-interaction ENT-201 quantity 1.1.0 purchase through independent full receipt using durable synthetic HTTP',async t=>{
 const env=await localEnvironment();let page;const http=[],dom=[];
 try{
  const clients={};for(const who of ['operator','manager','reviewer','publisher','agent'])clients[who]=await login(env,who);
  const call=async(who,op,body,key=randomUUID())=>{const response=await clients[who].api(op,body,key),data=await response.json();http.push({who,operation:op,body,key,status:response.status,data});assert.equal(response.status,200,JSON.stringify(data));return data.result;};
  const seed=await seedQuantity(env.f,call),id='browser-quantity-'+randomUUID();page=await browser();
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`const nativeFetch=window.fetch;window.fetch=async(...args)=>{const response=await nativeFetch(...args);if(args[0]==='/api'){const records=JSON.parse(sessionStorage.getItem('procurement-http')??'[]');records.push({request:JSON.parse(args[1].body),status:response.status,body:await response.clone().json()});sessionStorage.setItem('procurement-http',JSON.stringify(records));}return response;};`});
  const signIn=async who=>{await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]',who);await page.click('button');await page.until(`document.querySelector('#identity')?.textContent==='ログイン中: ${who}'`);await page.navigate(env.gateway.origin+'/procurement');await page.until(`document.querySelector('#identity')?.textContent==='ログイン中: ${who}'`);};
  const open=async()=>{await page.fill('#target',id);await page.click('#open');await page.until(`document.querySelector('#detail').dataset.id===${JSON.stringify(id)}`);};
  const state=async expected=>page.until(`document.querySelector('#detail').dataset.state===${JSON.stringify(expected)}`);
  await signIn('operator');await page.fill('#title','');await page.evaluate('document.querySelector("#title").focus()');await page.send('Input.insertText',{text:'合成会社の備品購入・日本語数量'});await page.fill('#budget',seed.budgetId);await page.until('!document.querySelector("#create-quantity").disabled');await page.fill('#quantity','0');await page.fill('#unit','合成計測単位');
  await t.test('japanese-keyboard-error-recovery Japanese title and invalid quantity corrected by keyboard',async()=>{
   await page.fill('#new-id',id);await page.click('#create button');await page.until('document.querySelector("#message").textContent.includes("INVALID_ARGUMENT")');assert.equal(await page.evaluate('document.querySelector("#quantity").value'),'0');assert.equal(await page.evaluate('document.querySelector("#unit").value'),'合成計測単位');
   await page.evaluate('document.querySelector("#quantity").focus();document.querySelector("#quantity").select()');await page.send('Input.insertText',{text:'7'});
   await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await state('REQUESTED');
  });
  for(const [index,supplierId] of seed.supplierIds.slice(0,2).entries()){
   await page.fill('#quote-quantity-value','7');await page.fill('#quote-unit','合成計測単位');await page.fill('#quote-version',index?'3':'2');await page.fill('#quote-id','q'+index);await page.fill('#supplier',supplierId);await page.fill('#amount',index?'1400':'-1');await page.click('#quote button');
   if(index===0){await page.until('document.querySelector("#message").textContent.includes("INVALID_ARGUMENT")');await page.fill('#amount','1200');await page.click('#quote button');}
   await page.until(`document.querySelector('#quotes').children.length===${index+1}`);
  }
  assert.match(await page.evaluate('document.querySelector("#quotes").textContent'),/7合成計測単位2/);
  await page.fill('#chosen','q0');await page.fill('#reason','同一仕様の相見積を比較し、総額の低い見積を選定');await page.click('#selection button');await state('COMPARED');
  await page.click('#approve');await page.until('document.querySelector("#message").textContent.includes("PERMISSION_DENIED")');assert.equal(await page.evaluate('document.querySelector("#detail").hidden'),false);assert.equal(await page.evaluate('document.querySelector("#quantity").value'),'7');assert.equal(await page.evaluate('document.querySelector("#unit").value'),'合成計測単位');await page.screenshot('01-compared');
  for(const [index,who] of ['manager','reviewer','publisher'].entries()){
   await signIn(who);await open();await page.click('#approve');await page.until(`document.querySelector('#approvals').children.length===${index+1}`);
  }
  await state('ORDER_READY');env.effects.fault('lost-ack');await page.click('#dispatch');await state('UNKNOWN');await page.screenshot('02-order-unknown');await page.click('#reconcile');await state('ORDER_CONFIRMED');
  await page.fill('#received-quantity','7');await page.fill('#received-unit','合成計測単位');await page.fill('#receipt-note','承認者による受領は拒否');await page.click('#receive button');await page.until('document.querySelector("#message").textContent.includes("PERMISSION_DENIED")');
  await signIn('agent');await open();await page.fill('#received-quantity','6');await page.fill('#received-unit','合成計測単位');await page.fill('#receipt-note','独立担当者が実数量を検査');await page.click('#receive button');await page.until('document.querySelector("#message").textContent.includes("INVALID_ARGUMENT")');assert.equal(await page.evaluate('document.querySelector("#detail").dataset.state'),'ORDER_CONFIRMED');
  await page.fill('#received-quantity','7');await page.fill('#received-unit','不一致単位');await page.click('#receive button');await page.until('document.querySelector("#message").textContent.includes("INVALID_ARGUMENT")');
  await page.fill('#received-unit','合成計測単位');await page.click('#receive button');await state('RECEIVED');dom.push({phase:'received',html:await page.evaluate('document.documentElement.outerHTML'),summary:await page.evaluate('document.querySelector("#summary").textContent')});await page.screenshot('03-received');
  await t.test('persistent-history-after-reload quantity version independent receipt and original operation survive reload',async()=>{
   await page.navigate(env.gateway.origin+'/procurement');await page.until('document.querySelector("#identity").textContent.includes("agent")');await open();await state('RECEIVED');assert.equal(await page.evaluate('document.querySelector("#history").children.length'),5);const summary=await page.evaluate('document.querySelector("#summary").textContent');assert.match(summary,/独立担当者/);assert.match(summary,/検収数量・単位7 合成計測単位/);assert.match(summary,/発注数量・単位7 合成計測単位/);assert.match(summary,/数量照合可能はい/);assert.match(summary,/選定見積版2/);dom.push({phase:'reload',summary,history:await page.evaluate('document.querySelector("#history").textContent')});
  });
  await t.test('forbidden-data-absent-in-response-and-dom reader and other department denied',async()=>{
   for(const who of ['reader','other','tenant2']){
    await signIn(who);await page.until('document.querySelector("#cases").children.length===0');
    const probe=await page.evaluate(`(async()=>{const s=await(await fetch('/session')).json(),r=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrf},body:JSON.stringify({contractVersion:'2.0.0',operation:'purchaseRead',body:{id:${JSON.stringify(id)}}})});return {status:r.status,text:await r.text(),dom:document.body.textContent}})()`);
    dom.push({phase:'denied',who,...probe});assert.equal(probe.status,who==='reader'?403:404);for(const value of [id,seed.budgetId,seed.supplierIds[0],'独立担当者','合成計測単位']){assert.equal(probe.text.includes(value),false);assert.equal(probe.dom.includes(value),false);}
   }await page.screenshot('04-forbidden');
  });
  const record=await call('operator','purchaseRead',{id}),ledger=await env.effects.ledger();assert.equal(record.state,'RECEIVED');assert.equal(record.package.version,'1.1.0');assert.equal(record.quantityContract.matchEligible,true);assert.deepEqual(record.quantityContract.received,{quantity:7,unit:'合成計測単位'});assert.equal(record.receipt.operationId,record.order.operationId);assert.equal(record.receipt.orderedRevision,record.order.objectRevision);assert.equal(ledger.length,1);assert.equal(ledger[0].applications,1);assert.equal(ledger[0].payload.fields.amount,1200);assert.equal(ledger[0].payload.fields.quantity,7);assert.equal(ledger[0].payload.fields.unit,'合成計測単位');assert.equal(ledger[0].payload.fields.quoteVersion,2);assert.equal(ledger[0].payload.operationId,record.receipt.operationId);assert.equal(ledger[0].payload.schemaVersion,'1.1.0');assert.equal(ledger[0].payload.fields.supplierId,seed.supplierIds[0]);assert.equal(ledger[0].payload.fields.quoteId,'q0');assert.equal(ledger[0].payload.aggregateId,id);
  const audit=await call('manager','auditExport',{id});assert.ok(audit.events.some(e=>e.record.operation==='purchaseReceive'));evidence('quantity-browser-complete',{browser:await page.send('Browser.getVersion'),executable:page.executable,http,dom,browserHttp:await page.evaluate("JSON.parse(sessionStorage.getItem('procurement-http'))"),record,ledger,audit,externalRequests:env.effects.requests(),postgres:env.cluster.version});
 }finally{await page?.close();await env.close();}
});

test('forbidden-data-absent-in-response-and-dom ENT-201 quantity R2 STRICT read and refresh after classification revocation',async()=>{
 const {scope,compareQuantity}=await import('./quantity-helper.mjs');const strict={...scope,classification:'STRICT'};
 const env=await localEnvironment({fixtureOptions:{enterpriseScopes:[scope,strict]}});let page;const http=[],dom=[];
 try{
  const clients={};for(const who of ['operator','manager','reviewer','publisher','reader'])clients[who]=await login(env,who);
  const call=async(who,operation,body,key=randomUUID())=>{const response=await clients[who].api(operation,body,key),data=await response.json();http.push({who,operation,body,key,status:response.status,data});assert.equal(response.status,200,JSON.stringify(data));return data.result;};
  const seed=await seedQuantity(env.f,call,strict),b=await compareQuantity({call},seed,{unit:'分類保護単位'});
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
  const revokedDom=await page.evaluate('({text:document.body.textContent,html:document.documentElement.outerHTML,detailDataset:{...document.querySelector("#detail").dataset},values:[...document.querySelectorAll("#detail input,#detail textarea,#target")].map(x=>x.value)})');
  for(const value of [b.id,b.title,seed.budgetId,seed.supplierIds[0],'分類保護単位'])assert.equal(JSON.stringify(revokedDom).includes(value),false);
  assert.ok(revokedDom.values.every(x=>x===''));assert.deepEqual(revokedDom.detailDataset,{});dom.push({phase:'revoked',...revokedDom});
  assert.equal(await page.evaluate('document.querySelector("#target").value'),'');await page.screenshot('R2-revoked-cleared');
  // A fresh denied detail attempt also leaves neither the old detail nor list behind.
  await page.fill('#target',b.id);await page.click('#open');await page.until('document.querySelector("#message").textContent.includes("PERMISSION_DENIED")');
  assert.equal(await page.evaluate('document.querySelector("#summary").textContent'),'');assert.equal(await page.evaluate('document.querySelector("#detail").hidden'),true);
  await grant(['CONFIDENTIAL','STRICT']);await page.click('#reload');await page.until('document.querySelector("#cases").children.length===1');await page.click('#cases button');await page.until('document.querySelector("#detail").dataset.state==="COMPARED"');
  const clearedDom=await page.evaluate('document.body.textContent');
  evidence('quantity-R2-browser-classification',{http,dom,scope:strict,record:b,revokedDomCleared:true,restoredRead:true,restoredDom:clearedDom,browser:await page.send('Browser.getVersion'),executable:page.executable});
 }finally{await page?.close();await env.close();}
});

// QTY-R1: retain actual create values until revocation, and exercise a denied
// mutation without refreshing first. Both paths must purge all protected UI.
for(const scenario of ['creator-refresh','receiver-operation'])test('forbidden-data-absent-in-response-and-dom QTY-R1 '+scenario,async()=>{
 const {scope,compareQuantity,approvePurchase}=await import('./quantity-helper.mjs');
 const {operations}=await import('../../scripts/enterprise/fixture.mjs');
 const env=await localEnvironment();let page;const http=[];
 try{
  const clients={};for(const who of ['operator','manager','reviewer','publisher','agent'])clients[who]=await login(env,who);
  const call=async(who,operation,body,key=randomUUID())=>{const response=await clients[who].api(operation,body,key),data=await response.json();http.push({who,operation,body,key,status:response.status,data});assert.equal(response.status,200,JSON.stringify(data));return data.result;};
  const seed=await seedQuantity(env.f,call),who=scenario==='creator-refresh'?'operator':'agent',unit='取消保護単位-'+randomUUID().slice(0,8),title='取消保護購買-'+randomUUID();
  let id='revoke-quantity-'+randomUUID();
  if(scenario==='receiver-operation'){
   const b=await compareQuantity({call},seed,{unit,title});id=b.id;await approvePurchase({call},b);await call('publisher','dispatch',{id});
  }
  page=await browser();await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`const nativeFetch=window.fetch;window.fetch=async(...args)=>{const response=await nativeFetch(...args);if(args[0]==='/api'){const records=JSON.parse(sessionStorage.getItem('qty-r1-http')??'[]');records.push({request:JSON.parse(args[1].body),status:response.status,body:await response.clone().json()});sessionStorage.setItem('qty-r1-http',JSON.stringify(records));}return response;};`});
  await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]',who);await page.click('button');await page.until(`document.querySelector('#identity')?.textContent==='ログイン中: ${who}'`);
  await page.navigate(env.gateway.origin+'/procurement');await page.until(`document.querySelector('#identity')?.textContent==='ログイン中: ${who}'`);
  if(scenario==='creator-refresh'){
   await page.until('!document.querySelector("#create-quantity").disabled');for(const [selector,value] of [['#new-id',id],['#title',title],['#budget',seed.budgetId],['#quantity','7'],['#unit',unit]])await page.fill(selector,value);
   await page.click('#create button');await page.until('document.querySelector("#detail").dataset.state==="REQUESTED"');
   assert.equal(await page.evaluate('document.querySelector("#quantity").value'),'7');assert.equal(await page.evaluate('document.querySelector("#unit").value'),unit);
  }else{
   await page.fill('#target',id);await page.click('#open');await page.until('document.querySelector("#detail").dataset.state==="ORDER_CONFIRMED"');
   await page.fill('#received-quantity','7');await page.fill('#received-unit',unit);await page.fill('#receipt-note','取消後には保存されない検収入力');
  }
  const capture=()=>page.evaluate('({text:document.body.textContent,html:document.documentElement.outerHTML,dataset:{...document.querySelector("#detail").dataset},values:[...document.querySelectorAll("input,textarea")].map(x=>({id:x.id,value:x.value})),hidden:document.querySelector("#detail").hidden,cases:document.querySelector("#cases").children.length})');
  const beforeDom=await capture(),before=await call('publisher','purchaseRead',{id}),ledgerBefore=await env.effects.ledger(),requestsBefore=env.effects.requests();
  await page.screenshot('QTY-R1-'+scenario+'-before');
  await call('publisher','grant',{principal:who,scopes:[scope],operations:who==='operator'?['read','search','action']:operations,fields:['PUBLIC','INTERNAL']});
  if(scenario==='creator-refresh'){await page.click('#reload');await page.until('document.querySelector("#cases").children.length===0 && document.querySelector("#detail").hidden');}
  else{await page.click('#receive button');await page.until('document.querySelector("#message").textContent.includes("PERMISSION_DENIED")');}
  const revokedDom=await capture(),browserHttp=await page.evaluate("JSON.parse(sessionStorage.getItem('qty-r1-http'))"),after=await call('publisher','purchaseRead',{id}),ledgerAfter=await env.effects.ledger();
  const response=await clients[who].api('query',{packageId:'enterprise-procurement',type:'PurchaseRequest'}),search=await response.json();assert.equal(response.status,200);assert.deepEqual(search.result,{items:[]});
  const denied=await clients[who].api('purchaseRead',{id}),deniedBody=await denied.json();assert.equal(denied.status,403);assert.deepEqual(deniedBody,{error:{code:'PERMISSION_DENIED'}});
  await page.screenshot('QTY-R1-'+scenario+'-revoked');
  evidence('QTY-R1-'+scenario,{beforeDom,revokedDom,browserHttp,http,search,deniedBody,before,after,ledgerBefore,ledgerAfter,requestsBefore,requestsAfter:env.effects.requests(),browser:await page.send('Browser.getVersion')});
  assert.deepEqual(after,before);assert.deepEqual(ledgerAfter,ledgerBefore);assert.deepEqual(env.effects.requests(),requestsBefore);
  if(scenario==='receiver-operation')assert.ok(browserHttp.some(x=>x.request.operation==='purchaseReceive'&&x.status===403&&JSON.stringify(x.body)===JSON.stringify({error:{code:'PERMISSION_DENIED'}})));
  assert.equal(revokedDom.hidden,true);assert.equal(revokedDom.cases,0);assert.deepEqual(revokedDom.dataset,{});assert.ok(revokedDom.values.every(x=>x.value===''),JSON.stringify(revokedDom.values));
  for(const value of [id,title,unit,seed.budgetId,seed.supplierIds[0],'取消後には保存されない検収入力'])assert.equal(JSON.stringify(revokedDom).includes(value),false,value);
 }finally{await page?.close();await env.close();}
});
