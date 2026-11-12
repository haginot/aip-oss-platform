import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {invoiceEnvironment} from '../../scripts/enterprise/invoice-local.mjs';
import {publishInvoice} from '../../scripts/enterprise/invoice-seed.mjs';
import {seedQuantity,compareQuantity,approvePurchase,receiptBody,scope} from './quantity-helper.mjs';
import {operations} from '../../scripts/enterprise/fixture.mjs';
import {login} from './http-helper.mjs';
import {browser} from './browser-helper.mjs';
import {evidence} from './assurance-helper.mjs';

async function fixture(run,options={}){
 const env=await invoiceEnvironment(options);let page;const http=[];
 try{
  const clients={};for(const who of ['operator','manager','reviewer','publisher','agent','reader','other','tenant2'])clients[who]=await login(env,who);
  const probe=async(who,operation,body,key=randomUUID())=>{const response=await clients[who].api(operation,body,key),data=await response.json();const x={who,operation,body,key,status:response.status,data};http.push(x);return x;};
  const call=async(...args)=>{const x=await probe(...args);assert.equal(x.status,200,JSON.stringify(x));return x.data.result;};
  await publishInvoice(env.f,call);const seed=await seedQuantity(env.f,call,options.purchaseScope??scope),po=await approvePurchase({call},await compareQuantity({call},seed));await call('manager','dispatch',{id:po.id});const ordered=await call('operator','purchaseRead',{id:po.id});await call('agent','purchaseReceive',receiptBody(po,ordered));const source=await call('operator','purchaseRead',{id:po.id});
  const account={id:'browser-account-'+randomUUID(),scope:seed.scope,supplierId:seed.supplierIds[0],currency:'JPY',syntheticReference:'synthetic:browser-bank',revision:0};await call('publisher','paymentAccountSet',account);
  const body={id:'browser-invoice-'+randomUUID(),purchaseId:po.id,number:'合成会社の請求書-'+randomUUID(),supplierId:seed.supplierIds[0],amount:1200,currency:'JPY',quantity:7,unit:'台'};
  page=await browser();await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`const original=window.fetch;window.invoiceHttp=[];window.fetch=async(...a)=>{const r=await original(...a);if(a[0]==='/api'){const v={request:JSON.parse(a[1].body),status:r.status,data:await r.clone().json()};window.invoiceHttp.push(v);const saved=JSON.parse(sessionStorage.getItem('invoice-http')??'[]');saved.push(v);sessionStorage.setItem('invoice-http',JSON.stringify(saved));}return r;};`});
  const signIn=async who=>{await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]',who);await page.click('button');await page.until(`document.querySelector('#identity')?.textContent==='ログイン中: ${who}'`);await page.navigate(env.gateway.origin+'/invoice');await page.until(`document.querySelector('#identity')?.textContent==='ログイン中: ${who}'&&window.invoiceHttp.some(x=>x.request.operation==='query')`);};
  const state=s=>page.until(`document.querySelector('#detail').dataset.state===${JSON.stringify(s)}`);
  const openInvoice=async(id=body.id)=>{await page.fill('#invoice-target',id);await page.click('#open-invoice');await page.until(`document.querySelector('#detail').dataset.id===${JSON.stringify(id)}`);};
  const openPayment=async id=>{await page.fill('#payment-target',id);await page.click('#open-payment');await page.until(`document.querySelector('#detail').dataset.id===${JSON.stringify(id)}`);};
  const fillInvoice=async(b=body)=>{for(const [key,name] of [['id','invoice-id'],['purchaseId','purchase-id'],['number','number'],['supplierId','supplier-id'],['amount','amount'],['currency','currency'],['quantity','quantity'],['unit','unit']])await page.fill('#'+name,String(b[key]));};
  const capture=()=>page.evaluate(`({text:document.body.textContent,html:document.documentElement.outerHTML,hidden:document.querySelector('#detail').hidden,cases:document.querySelector('#cases').children.length,datasets:[...document.querySelectorAll('*')].filter(x=>Object.keys(x.dataset).length).map(x=>({...x.dataset})),controls:[...document.querySelectorAll('input,textarea,select')].map(x=>({id:x.id,value:x.value,selectedIndex:x.tagName==='SELECT'?x.selectedIndex:null,options:x.tagName==='SELECT'?[...x.options].map(o=>({value:o.value,selected:o.selected})):null})),sections:Object.fromEntries(['summary','approvals','history'].map(id=>[id,document.getElementById(id).innerHTML]))})`);
  await run({env,page,http,probe,call,seed,po,source,account,body,signIn,state,openInvoice,openPayment,fillInvoice,capture});
 }finally{if(page)evidence('browser-final-'+randomUUID(),{http,browserHttp:await page.evaluate("JSON.parse(sessionStorage.getItem('invoice-http')??'[]')").catch(()=>[]),browser:await page.send('Browser.getVersion'),dom:await page.evaluate('document.documentElement.outerHTML')});await page?.close();await env.close();}
}

test('real-browser-interaction ENT-202 invoice exception separated multistage approval synthetic payment and result reconciliation',async t=>fixture(async f=>{
 const {env,page,call,body,account,signIn,state,openInvoice,openPayment,fillInvoice,capture}=f,paymentId='browser-payment-'+randomUUID();
 await signIn('operator');await fillInvoice({...body,id:'不正な ID',amount:1199});
 await t.test('japanese-keyboard-error-recovery Japanese invoice input invalid ID correction quarantine and amount correction',async()=>{
  await page.click('#import button[type=submit]');await page.until('document.querySelector("#message").textContent.includes("INVALID_ARGUMENT")');assert.equal(await page.evaluate('document.querySelector("#number").value'),body.number);
  await page.evaluate('document.querySelector("#invoice-id").focus();document.querySelector("#invoice-id").select()');await page.send('Input.insertText',{text:body.id});await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await state('QUARANTINED');assert.match(await page.evaluate('document.querySelector("#summary").textContent'),/AMOUNT_MISMATCH/);
  await page.fill('#account-id',account.id);await page.fill('#payment-id',paymentId);await page.fill('#payment-amount','1200');const before=await capture();await page.click('#request button');await page.until('document.querySelector("#message").textContent.includes("INVALID_STATE")');assert.deepEqual((await capture()).controls,before.controls);
  await page.evaluate('document.querySelector("#amount").focus();document.querySelector("#amount").select()');await page.send('Input.insertText',{text:'1200'});await page.click('#correct');await state('MATCHED');assert.equal((await call('operator','invoiceRead',{id:body.id})).revision,2);await page.screenshot('invoice-01-matched');
 });
 await page.click('#request button');await state('WAITING_APPROVAL');const beforeSelf=await capture();await page.click('#approve');await page.until('document.querySelector("#message").textContent.includes("PERMISSION_DENIED")');assert.deepEqual((await capture()).controls,beforeSelf.controls);assert.deepEqual((await capture()).sections,beforeSelf.sections);
 for(const [index,who] of ['manager','reviewer','publisher'].entries()){await signIn(who);await openPayment(paymentId);await page.click('#approve');await page.until(`document.querySelector('#approvals').children.length===${index+1}`);}await state('READY');
 env.payments.fault('lost-ack');await page.click('#dispatch');await state('UNKNOWN');await page.screenshot('invoice-02-unknown');
 await page.click('#dispatch');await page.until('document.querySelector("#message").textContent.includes("INVALID_STATE")');await state('UNKNOWN');await page.click('#reconcile');await state('SUCCEEDED');await page.screenshot('invoice-03-succeeded');
 await t.test('persistent-history-after-reload current invoice reasons payment votes reservation and ledger survive reload and relogin',async()=>{
  await signIn('operator');await openInvoice();await state('MATCHED');assert.equal(await page.evaluate('document.querySelector("#history").children.length'),2);await openPayment(paymentId);await state('SUCCEEDED');assert.equal(await page.evaluate('document.querySelector("#approvals").children.length'),3);assert.equal(await page.evaluate('document.querySelector("#history").children.length'),1);
  await page.click('#reload');await state('SUCCEEDED');const r=await call('operator','paymentRead',{id:paymentId});assert.equal(r.reservation,'HELD');assert.equal(r.fields.invoiceRevision,2);assert.equal(r.fields.accountRevision,1);
 });
 await t.test('forbidden-data-absent-in-response-and-dom initial reader other department and other tenant',async()=>{
  for(const who of ['reader','other','tenant2']){await signIn(who);assert.equal(await page.evaluate('document.querySelector("#cases").children.length'),0);const response=await f.probe(who,'paymentRead',{id:paymentId});assert.equal(response.status,who==='reader'?403:404);assert.deepEqual(response.data,{error:{code:who==='reader'?'PERMISSION_DENIED':'NOT_FOUND'}});const dom=await capture();for(const secret of [body.id,body.number,body.purchaseId,paymentId,account.id])assert.equal(JSON.stringify(dom).includes(secret),false);}
 });
 const record=await call('operator','invoiceRead',{id:body.id}),payment=await call('operator','paymentRead',{id:paymentId}),ledger=await env.payments.ledger();assert.equal(ledger.length,1);assert.equal(ledger[0].applications,1);assert.equal(ledger[0].payload.fields.purchaseId,body.purchaseId);assert.equal(ledger[0].payload.fields.invoiceId,body.id);assert.equal(ledger[0].payload.fields.amount,1200);assert.equal(record.source.receipt.actor,'agent');assert.equal(record.source.receipt.receivedQuantity,7);assert.deepEqual(env.payments.requests().map(x=>x.method),['POST','GET']);
 evidence('invoice-browser-complete',{record,payment,ledger,source:f.source,http:f.http,requests:env.payments.requests(),orderLedger:await env.effects.ledger(),browser:await page.send('Browser.getVersion'),executable:page.executable,postgres:env.cluster.version});
}));

for(const revocation of ['scope','classification'])for(const trigger of ['operation','refresh']){
 test('forbidden-data-absent-in-response-and-dom ENT-202 '+revocation+' '+trigger,()=>fixture(async f=>{
  const {env,page,call,body,signIn,openInvoice,openPayment,fillInvoice,capture}=f;await call('operator','invoiceImport',body);const paymentId='revoke-payment-'+randomUUID();await call('operator','paymentRequest',{id:paymentId,invoiceId:body.id,revision:1,accountId:f.account.id,amount:1200});
  await signIn('agent');await openInvoice();await openPayment(paymentId);await fillInvoice(body);await page.fill('#account-id',f.account.id);await page.fill('#account-reference','synthetic:protected-reference');await page.fill('#payment-id',paymentId);await page.fill('#payment-amount','1200');
  const beforeDom=await capture(),before={invoice:await call('publisher','invoiceRead',{id:body.id}),payment:await call('publisher','paymentRead',{id:paymentId}),ledger:await env.payments.ledger(),requests:env.payments.requests()};
  await call('publisher','grant',{principal:'agent',scopes:revocation==='scope'?[]:[scope],operations,fields:revocation==='scope'?['PUBLIC','INTERNAL','CONFIDENTIAL']:['PUBLIC','INTERNAL']});
  const code=revocation==='scope'?'NOT_FOUND':'PERMISSION_DENIED';const reads=[];for(const [op,id] of [['invoiceRead',body.id],['paymentRead',paymentId],['paymentAccountRead',f.account.id],['get',paymentId],['history',paymentId],['auditExport',paymentId]]){const x=await f.probe('agent',op,{id});assert.equal(x.status,revocation==='scope'?404:403);assert.deepEqual(x.data,{error:{code}});reads.push(x);}
  const n=await page.evaluate('window.invoiceHttp.length');await page.click(trigger==='operation'?'#approve':'#reload');await page.until(`window.invoiceHttp.length>${n}&&document.querySelector('#detail').hidden`);const afterDom=await capture();
  const after={invoice:await call('publisher','invoiceRead',{id:body.id}),payment:await call('publisher','paymentRead',{id:paymentId}),ledger:await env.payments.ledger(),requests:env.payments.requests()};
  evidence('invoice-revocation-'+revocation+'-'+trigger,{beforeDom,afterDom,before,after,reads,browserHttp:await page.evaluate('window.invoiceHttp')});
  assert.deepEqual(after,before);assert.equal(afterDom.hidden,true);assert.equal(afterDom.cases,0);assert.deepEqual(afterDom.datasets,[]);assert.ok(afterDom.controls.every(x=>x.value===''),JSON.stringify(afterDom.controls));for(const x of afterDom.controls.filter(x=>x.options)){assert.equal(x.selectedIndex,-1);assert.ok(x.options.every(v=>!v.selected));}assert.ok(Object.values(afterDom.sections).every(x=>x===''));for(const secret of [body.id,body.number,body.purchaseId,f.account.id,paymentId,'synthetic:protected-reference'])assert.equal(JSON.stringify(afterDom).includes(secret),false,secret);
  await call('publisher','grant',{principal:'agent',scopes:[scope],operations,fields:['PUBLIC','INTERNAL','CONFIDENTIAL']});const start=await page.evaluate('window.invoiceHttp.length');await page.click('#reload');await page.until('document.querySelector("#cases").children.length===1');assert.equal(await page.evaluate('document.querySelector("#detail").hidden'),true);assert.equal((await page.evaluate(`window.invoiceHttp.slice(${start})`)).filter(x=>['paymentRead','invoiceRead'].includes(x.request.operation)).length,0);await openPayment(paymentId);assert.equal(await page.evaluate('document.querySelector("#detail").hidden'),false);await page.screenshot('invoice-revocation-'+revocation+'-'+trigger);
 }));
}

const secondScope={...scope,caseId:'synthetic-second-project'};
for(const trigger of ['refresh','operation'])test('forbidden-data-absent-in-response-and-dom INV-R1 mixed scope invoice and payment '+trigger,()=>fixture(async f=>{
 const {env,page,call,body,signIn,openInvoice,openPayment,capture}=f;
 await call('operator','invoiceImport',body);
 const seed={scope:secondScope,budgetId:'mixed-budget-'+randomUUID(),supplierIds:['mixed-supplier-a-'+randomUUID(),'mixed-supplier-b-'+randomUUID()]};
 await call('manager','resourceCreate',{id:seed.budgetId,scope:secondScope,currency:'JPY',unit:'minor',capacity:2000,threshold:2000,periodEnd:'2099-01-01T00:00:00Z',calculationVersion:'integer-v1'});
 for(const id of seed.supplierIds)await call('publisher','supplierCreate',{id,scope:secondScope,name:'Synthetic mixed scope supplier',relatedSubjects:[]});
 const po=await approvePurchase({call},await compareQuantity({call},seed));await call('manager','dispatch',{id:po.id});const ordered=await call('operator','purchaseRead',{id:po.id});await call('agent','purchaseReceive',receiptBody(po,ordered));
 const b={...body,id:'mixed-invoice-'+randomUUID(),purchaseId:po.id,number:'別scope合成請求-'+randomUUID(),supplierId:seed.supplierIds[0]};await call('operator','invoiceImport',b);
 const account={...f.account,id:'mixed-account-'+randomUUID(),scope:secondScope,supplierId:seed.supplierIds[0]};await call('publisher','paymentAccountSet',account);
 const paymentId='mixed-payment-'+randomUUID();await call('operator','paymentRequest',{id:paymentId,invoiceId:b.id,revision:1,accountId:account.id,amount:1200});
 await signIn('agent');await openInvoice();await page.fill('#account-id',f.account.id);await page.fill('#account-reference','synthetic:old-scope-reference');await page.fill('#payment-id','old-scope-payment');await openPayment(paymentId);
 const beforeDom=await capture(),observe=async()=>({invoice:await call('publisher','invoiceRead',{id:body.id}),payment:await call('publisher','paymentRead',{id:paymentId}),ledger:await env.payments.ledger(),requests:env.payments.requests(),orderLedger:await env.effects.ledger(),orderRequests:env.effects.requests()});const before=await observe();
 await call('publisher','grant',{principal:'agent',scopes:[secondScope],operations,fields:['PUBLIC','INTERNAL','CONFIDENTIAL']});
 const denied=await f.probe('agent','invoiceRead',{id:body.id});assert.equal(denied.status,404);assert.deepEqual(denied.data,{error:{code:'NOT_FOUND'}});const allowed=await f.probe('agent','paymentRead',{id:paymentId});assert.equal(allowed.status,200);
 const n=await page.evaluate('window.invoiceHttp.length');await page.click(trigger==='refresh'?'#reload':'#correct');
 await page.until(`window.invoiceHttp.length>${n}&&(document.querySelector('#detail').hidden||window.invoiceHttp.slice(${n}).some(x=>x.request.operation==='paymentRead'))`);
 if(trigger==='operation')await page.until(`document.querySelector('#message').textContent==='NOT_FOUND'`);
 const afterDom=await capture(),after=await observe(),browserHttp=await page.evaluate(`window.invoiceHttp.slice(${n})`);
 evidence('INV-R1-'+trigger,{beforeDom,afterDom,before,after,denied,allowed,browserHttp});
 assert.deepEqual(after,before);assert.equal(afterDom.hidden,true,'INV-R1 revoked invoice must clear even while payment in another scope remains readable');assert.equal(afterDom.cases,0);assert.deepEqual(afterDom.datasets,[]);assert.ok(afterDom.controls.every(x=>x.value===''),JSON.stringify(afterDom.controls));for(const x of afterDom.controls.filter(x=>x.options)){assert.equal(x.selectedIndex,-1);assert.ok(x.options.every(o=>!o.selected));}assert.ok(Object.values(afterDom.sections).every(x=>x===''));for(const secret of [body.id,body.number,body.purchaseId,f.account.id,'synthetic:old-scope-reference'])assert.equal(JSON.stringify(afterDom).includes(secret),false,secret);
 assert.ok(browserHttp.some(x=>x.request.operation==='invoiceRead'&&x.status===404));if(trigger==='operation')assert.equal(browserHttp.filter(x=>x.request.operation==='invoiceCorrect').length,1);
 await call('publisher','grant',{principal:'agent',scopes:[scope,secondScope],operations,fields:['PUBLIC','INTERNAL','CONFIDENTIAL']});const start=await page.evaluate('window.invoiceHttp.length');await page.click('#reload');await page.until('document.querySelector("#cases").children.length===1');assert.equal((await capture()).hidden,true);assert.equal((await page.evaluate(`window.invoiceHttp.slice(${start})`)).filter(x=>['invoiceRead','paymentRead'].includes(x.request.operation)).length,0);
 // Both lexical references must be gone: a new action cannot resurrect or use A/B.
 const cleared=await page.evaluate('window.invoiceHttp.length');await page.evaluate(`document.querySelector('#account').dispatchEvent(new Event('submit',{cancelable:true}))`);await page.until(`document.querySelector('#message').textContent==='請求を開いてください'`);assert.equal(await page.evaluate('window.invoiceHttp.length'),cleared);await page.click('#approve');await page.until(`window.invoiceHttp.length>${cleared}`);const vote=(await page.evaluate(`window.invoiceHttp.slice(${cleared})`)).find(x=>x.request.operation==='vote');assert.ok(vote);assert.equal('id' in vote.request.body,false);assert.equal((await capture()).hidden,true);await openInvoice();assert.equal((await capture()).hidden,false);
 evidence('INV-R1-restored-'+trigger,{dom:await capture(),business:await observe(),browserHttp:await page.evaluate('window.invoiceHttp'),browser:await page.send('Browser.getVersion')});await page.screenshot('INV-R1-'+trigger);
},{enterpriseScopes:[scope,secondScope]}));
