import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {localEnvironment} from '../../scripts/enterprise/local.mjs';
import {operations} from '../../scripts/enterprise/fixture.mjs';
import {browser} from './browser-helper.mjs';
import {login} from './http-helper.mjs';
import {seedQuantity,scope,compareQuantity,approvePurchase} from './quantity-helper.mjs';
import {evidence} from './assurance-helper.mjs';

// Additive cases: existing quantity/API/browser tests and their fixtures stay intact.
async function fixture(run){
 const env=await localEnvironment();let page;const http=[];
 try{
  const clients={};for(const who of ['operator','manager','reviewer','publisher','agent'])clients[who]=await login(env,who);
  const probe=async(who,operation,body,key=randomUUID())=>{const response=await clients[who].api(operation,body,key),data=await response.json();const result={who,operation,body,key,status:response.status,data};http.push(result);return result;};
  const call=async(...args)=>{const r=await probe(...args);assert.equal(r.status,200,JSON.stringify(r));return r.data.result;};
  const seed=await seedQuantity(env.f,call);seed.budgetId='clear-usd-'+randomUUID();
  await call('manager','resourceCreate',{id:seed.budgetId,scope,currency:'USD',unit:'minor',capacity:2000,threshold:2000,periodEnd:'2099-01-01T00:00:00Z',calculationVersion:'integer-v1'});
  page=await browser();
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`const nativeFetch=window.fetch;window.clearHttp=[];window.fetch=async(...args)=>{const r=await nativeFetch(...args);if(args[0]==='/api')window.clearHttp.push({request:JSON.parse(args[1].body),status:r.status,data:await r.clone().json()});return r;};`});
  const signIn=async who=>{await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]',who);await page.click('button');await page.until(`document.querySelector('#identity')?.textContent==='ログイン中: ${who}'`);await page.navigate(env.gateway.origin+'/procurement');await page.until(`document.querySelector('#identity')?.textContent==='ログイン中: ${who}' && !document.querySelector('#create-quantity').disabled && window.clearHttp.some(x=>x.request.operation==='query')`);};
  const capture=()=>page.evaluate(`({text:document.body.textContent,html:document.documentElement.outerHTML,hidden:document.querySelector('#detail').hidden,cases:document.querySelector('#cases').children.length,datasets:[...document.querySelectorAll('*')].filter(x=>Object.keys(x.dataset).length).map(x=>({id:x.id,data:{...x.dataset}})),controls:[...document.querySelectorAll('input,textarea,select')].map(x=>({id:x.id,type:x.type,value:x.value,hidden:x.hidden,selectedIndex:x.tagName==='SELECT'?x.selectedIndex:null,options:x.tagName==='SELECT'?[...x.options].map(o=>({value:o.value,selected:o.selected})):null})),sections:Object.fromEntries(['summary','state','quotes','approvals','history','audit-result'].map(id=>[id,document.getElementById(id).innerHTML]))})`);
  const snapshot=async id=>({record:await call('publisher','purchaseRead',{id}),ledger:await env.effects.ledger(),requests:structuredClone(env.effects.requests())});
  const open=async id=>{await page.fill('#target',id);await page.click('#open');await page.until(`document.querySelector('#detail').dataset.id===${JSON.stringify(id)}`);};
  const fillCreate=async(id,title,unit)=>{for(const [selector,value] of [['#new-id',id],['#title',title],['#budget',seed.budgetId],['#currency','USD'],['#quantity','7'],['#unit',unit]])await page.fill(selector,value);};
  await run({env,page,http,probe,call,seed,signIn,capture,snapshot,open,fillCreate});
 }finally{await page?.close();await env.close();}
}
function assertCleared(dom,secrets){
 assert.equal(dom.hidden,true);assert.equal(dom.cases,0);assert.deepEqual(dom.datasets,[]);
 assert.ok(dom.controls.every(x=>x.value===''),JSON.stringify(dom.controls));
 for(const c of dom.controls.filter(x=>x.options)){assert.equal(c.selectedIndex,-1);assert.ok(c.options.every(o=>!o.selected));}
 assert.ok(Object.values(dom.sections).every(x=>x===''),JSON.stringify(dom.sections));
 for(const secret of secrets)assert.equal(JSON.stringify(dom).includes(secret),false,secret);
}
for(const [revocation,trigger,creator] of [['scope','operation',false],['classification','refresh',true],['scope','refresh',false],['classification','operation',false]]){
 const name=`authorization-clear-${revocation}-${trigger}`;
 test('forbidden-data-absent-in-response-and-dom '+name,()=>fixture(async f=>{
  const {env,page,http,call,probe,seed,signIn,capture,snapshot,open,fillCreate}=f;
  const unit='消去単位-'+randomUUID().slice(0,8),title='消去購買-'+randomUUID(),note='保存禁止検収-'+randomUUID();
  let id='clear-'+randomUUID();const who=creator?'operator':'agent';
  if(!creator){const b=await compareQuantity({call},seed,{currency:'USD',title,unit});id=b.id;await approvePurchase({call},b);await call('publisher','dispatch',{id});}
  await signIn(who);await fillCreate(id,title,unit);
  if(creator){await page.click('#create button');await page.until('document.querySelector("#detail").dataset.state==="REQUESTED"');}
  else{await open(id);await page.fill('#received-quantity','7');await page.fill('#received-unit',unit);await page.fill('#receipt-note',note);await page.click('#audit');await page.until('document.querySelector("#audit-result").textContent.length>0');}
  const beforeDom=await capture(),before=await snapshot(id);assert.equal(before.record.fields.currency,'USD');assert.equal(before.record.fields.quantity,7);assert.equal(beforeDom.controls.find(x=>x.id==='currency').value,'USD');
  await page.screenshot(name+'-before');
  const grant={principal:who,scopes:revocation==='scope'?[]:[scope],operations:who==='operator'?['read','search','action']:operations,fields:revocation==='scope'?['PUBLIC','INTERNAL','CONFIDENTIAL']:['PUBLIC','INTERNAL']};
  await call('publisher','grant',grant);
  const expectedStatus=revocation==='scope'?404:403,code=revocation==='scope'?'NOT_FOUND':'PERMISSION_DENIED';
  const read=await probe(who,'purchaseRead',{id}),search=await probe(who,'query',{packageId:'enterprise-procurement',type:'PurchaseRequest'});
  const n=await page.evaluate('window.clearHttp.length');
  if(trigger==='operation'){await page.click('#receive button');await page.until(`document.querySelector('#message').textContent.includes('${code}')`);}
  else{await page.click('#reload');await page.until(`window.clearHttp.length>${n} && document.querySelector('#cases').children.length===0`);}
  const revokedDom=await capture(),browserHttp=await page.evaluate('window.clearHttp'),after=await snapshot(id);
  await page.screenshot(name+'-revoked');
  // Persist real HTTP, current values (including hidden/select), DOM and ledger even
  // when the following regression assertion fails against the pre-fix source.
  evidence(name,{grant,beforeDom,revokedDom,before,after,read,search,http,browserHttp,browser:await page.send('Browser.getVersion'),executable:page.executable,postgres:env.cluster.version});
  assert.equal(read.status,expectedStatus);assert.deepEqual(read.data,{error:{code}});assert.equal(search.status,200);assert.deepEqual(search.data.result,{items:[]});assert.deepEqual(after,before);
  if(trigger==='operation'){const mutations=browserHttp.slice(n).filter(x=>x.request.operation==='purchaseReceive');assert.equal(mutations.length,1);assert.equal(mutations[0].status,expectedStatus);assert.deepEqual(mutations[0].data,{error:{code}});}
  assertCleared(revokedDom,[id,title,unit,note,seed.budgetId,...seed.supplierIds]);
  // Restoring the grant and reloading must not resurrect the module's selected
  // record. A new explicit open is required; load must not issue purchaseRead.
  await call('publisher','grant',{principal:who,scopes:[scope],operations:who==='operator'?['read','search','action']:operations,fields:['PUBLIC','INTERNAL','CONFIDENTIAL']});
  const restoreStart=await page.evaluate('window.clearHttp.length');await page.click('#reload');await page.until('document.querySelector("#cases").children.length===1');
  const restored=await capture(),restoreHttp=await page.evaluate(`window.clearHttp.slice(${restoreStart})`);evidence(name+'-restored',{restored,restoreHttp});
  assert.equal(restored.hidden,true);assert.deepEqual(restored.datasets,[]);assert.ok(restored.controls.every(x=>x.value===''));assert.equal(restoreHttp.filter(x=>x.request.operation==='purchaseRead').length,0);
  await open(id);assert.equal(await page.evaluate('document.querySelector("#detail").hidden'),false);
 }));
}

test('real-browser-interaction authorization-clear correctable input and readable self approval preserve values without effects',()=>fixture(async f=>{
 const {env,page,http,call,seed,signIn,capture,snapshot,open,fillCreate}=f;
 const unit='訂正可能単位',b=await compareQuantity({call},seed,{currency:'USD',unit});
 await signIn('operator');await open(b.id);await fillCreate(b.id,b.title,unit);await page.fill('#reason','保持する訂正理由');
 const beforeDom=await capture(),before=await snapshot(b.id),n=await page.evaluate('window.clearHttp.length');
 await page.click('#approve');await page.until('document.querySelector("#message").textContent.includes("PERMISSION_DENIED")');
 const deniedDom=await capture(),after=await snapshot(b.id),deniedHttp=await page.evaluate(`window.clearHttp.slice(${n})`);
 evidence('authorization-clear-readable-self-approval',{http,beforeDom,deniedDom,before,after,deniedHttp});
 assert.deepEqual(after,before);assert.deepEqual(deniedDom.controls,beforeDom.controls);assert.deepEqual(deniedDom.sections,beforeDom.sections);assert.equal(deniedDom.hidden,false);assert.equal(deniedHttp.filter(x=>x.request.operation==='vote').length,1);assert.ok(deniedHttp.some(x=>x.request.operation==='vote'&&x.status===403));assert.ok(deniedHttp.some(x=>x.request.operation==='purchaseRead'&&x.status===200));
 await approvePurchase({call},b);await call('publisher','dispatch',{id:b.id});await signIn('agent');await open(b.id);await fillCreate(b.id,b.title,unit);
 await page.fill('#received-quantity','6');await page.fill('#received-unit',unit);await page.fill('#receipt-note','訂正して全量を受領');
 const invalidBeforeDom=await capture(),invalidBefore=await snapshot(b.id),start=await page.evaluate('window.clearHttp.length');
 await page.click('#receive button');await page.until('document.querySelector("#message").textContent.includes("INVALID_ARGUMENT")');
 const invalidAfterDom=await capture(),invalidAfter=await snapshot(b.id),invalidHttp=await page.evaluate(`window.clearHttp.slice(${start})`);
 evidence('authorization-clear-correctable-receipt',{http,invalidBeforeDom,invalidAfterDom,invalidBefore,invalidAfter,invalidHttp,browser:await page.send('Browser.getVersion')});
 assert.deepEqual(invalidAfter,invalidBefore);assert.deepEqual(invalidAfterDom.controls,invalidBeforeDom.controls);assert.deepEqual(invalidAfterDom.sections,invalidBeforeDom.sections);assert.ok(invalidHttp.some(x=>x.request.operation==='purchaseReceive'&&x.status===400));
 await page.fill('#received-quantity','7');await page.click('#receive button');await page.until('document.querySelector("#detail").dataset.state==="RECEIVED"');
 const corrected=await snapshot(b.id);evidence('authorization-clear-corrected-receipt',{corrected,dom:await capture(),http,browserHttp:await page.evaluate('window.clearHttp')});
 assert.equal(corrected.record.receipt.receivedQuantity,7);assert.equal(corrected.record.receipt.unit,unit);assert.equal(corrected.record.receipt.actor,'agent');assert.equal(corrected.record.history.length,invalidBefore.record.history.length+1);assert.deepEqual(corrected.ledger,invalidBefore.ledger);assert.deepEqual(corrected.requests,invalidBefore.requests);
}));
