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

// Retained API values outlive the selected business operation. Never derive a
// read target from an arbitrary user draft; only successful API values own it.
const otherScope={...scope,caseId:'ui-state-second-project'};
const strictScope={...otherScope,classification:'STRICT'};
const fields=['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'];
async function mixed(f,bScope,withPayment=true){
 const {call,body}=f;await call('operator','invoiceImport',body);
 const seed={scope:bScope,budgetId:'state-budget-'+randomUUID(),supplierIds:['state-supplier-a-'+randomUUID(),'state-supplier-b-'+randomUUID()]};
 await call('manager','resourceCreate',{id:seed.budgetId,scope:bScope,currency:'JPY',unit:'minor',capacity:2000,threshold:2000,periodEnd:'2099-01-01T00:00:00Z',calculationVersion:'integer-v1'});
 for(const id of seed.supplierIds)await call('publisher','supplierCreate',{id,scope:bScope,name:'Synthetic UI state supplier',relatedSubjects:[]});
 const po=await approvePurchase({call},await compareQuantity({call},seed));await call('manager','dispatch',{id:po.id});const ordered=await call('operator','purchaseRead',{id:po.id});await call('agent','purchaseReceive',receiptBody(po,ordered));
 const b={...body,id:'state-invoice-'+randomUUID(),purchaseId:po.id,number:'別表示合成請求-'+randomUUID(),supplierId:seed.supplierIds[0]};await call('operator','invoiceImport',b);
 const account={...f.account,id:'state-account-'+randomUUID(),scope:bScope,supplierId:seed.supplierIds[0]};await call('publisher','paymentAccountSet',account);
 const paymentId=withPayment?'state-payment-'+randomUUID():null;if(withPayment)await call('operator','paymentRequest',{id:paymentId,invoiceId:b.id,revision:1,accountId:account.id,amount:1200});
 return {b,account,paymentId,po};
}
async function listOpen(f,id){await f.page.evaluate(`document.querySelector('#cases button')?.textContent`);await f.page.until(`[...document.querySelectorAll('#cases button')].some(x=>x.textContent===${JSON.stringify(id)})`);await f.page.evaluate(`[...document.querySelectorAll('#cases button')].find(x=>x.textContent===${JSON.stringify(id)}).click()`);await f.page.until(`document.querySelector('#detail').dataset.id===${JSON.stringify(id)}`);}
async function observe(f,m){return {invoice:await f.call('operator','invoiceRead',{id:f.body.id}),payment:m.paymentId?await f.call('operator','paymentRead',{id:m.paymentId}):null,account:await f.call('operator','paymentAccountRead',{id:m.account.id}),ledger:await f.env.payments.ledger(),requests:f.env.payments.requests(),orderLedger:await f.env.effects.ledger(),orderRequests:f.env.effects.requests()};}
function cleared(dom){assert.equal(dom.hidden,true,'INV-R1 revoked retained record must clear all DOM/form values');assert.equal(dom.cases,0);assert.deepEqual(dom.datasets,[]);assert.ok(dom.controls.every(x=>x.value===''),JSON.stringify(dom.controls));for(const x of dom.controls.filter(x=>x.options)){assert.equal(x.selectedIndex,-1);assert.ok(x.options.every(o=>!o.selected));}assert.ok(Object.values(dom.sections).every(x=>x===''));}
for(const order of ['B-A','A-B'])for(const revocation of ['scope','classification'])for(const trigger of ['refresh','operation']){
 const aScope=revocation==='classification'&&order==='A-B'?{...scope,classification:'STRICT'}:scope;
 const bScope=revocation==='classification'&&order==='B-A'?strictScope:otherScope;
 test('INV-R1 retained DOM/form '+order+' '+revocation+' '+trigger,()=>fixture(async f=>{
  const {page,call,signIn,openInvoice,capture}=f,m=await mixed(f,bScope);
  await call('publisher','grant',{principal:'agent',scopes:[aScope,bScope],operations,fields});await signIn('agent');
  if(order==='B-A'){await listOpen(f,m.paymentId);await openInvoice();}else{await openInvoice();await listOpen(f,m.paymentId);}
  await page.fill('#account-id',f.account.id);await page.fill('#account-reference','synthetic:retained-draft');await page.fill('#payment-id','draft-'+randomUUID());await page.fill('#payment-amount','1200');
  assert.equal((await capture()).controls.find(x=>x.id==='payment-target').value,m.paymentId);
  const beforeDom=await capture(),before=await observe(f,m),revokedId=order==='B-A'?m.paymentId:f.body.id,deniedOp=order==='B-A'?'paymentRead':'invoiceRead',allowedOp=order==='B-A'?'invoiceRead':'paymentRead',allowedId=order==='B-A'?f.body.id:m.paymentId;
  await call('publisher','grant',{principal:'agent',scopes:revocation==='scope'?[order==='B-A'?aScope:bScope]:[aScope,bScope],operations,fields:revocation==='classification'?['PUBLIC','INTERNAL','CONFIDENTIAL']:fields});
  const denied=await f.probe('agent',deniedOp,{id:revokedId}),allowed=await f.probe('agent',allowedOp,{id:allowedId}),query=await f.probe('agent','query',{packageId:'enterprise-invoice',type:'InvoicePayment'});
  assert.equal(denied.status,revocation==='scope'?404:403);assert.deepEqual(denied.data,{error:{code:revocation==='scope'?'NOT_FOUND':'PERMISSION_DENIED'}});assert.equal(allowed.status,200);assert.equal(query.status,200);
  const n=await page.evaluate('window.invoiceHttp.length');await page.click(trigger==='refresh'?'#reload':order==='B-A'?'#open-payment':'#correct');
  if(trigger==='operation')await page.until(`document.querySelector('#message').textContent===${JSON.stringify(denied.data.error.code)}`);
  else await page.until(`document.querySelector('#detail').hidden||(window.invoiceHttp.slice(${n}).some(x=>x.request.operation==='query'&&x.status===200)&&window.invoiceHttp.slice(${n}).filter(x=>x.request.operation===${JSON.stringify(allowedOp)}&&x.status===200).length>=2)`);
  const afterDom=await capture(),after=await observe(f,m),browserHttp=await page.evaluate(`window.invoiceHttp.slice(${n})`);
  evidence('INV-R1-'+order+'-'+revocation+'-'+trigger,{beforeDom,afterDom,before,after,denied,allowed,query,browserHttp});
  assert.deepEqual(after,before);cleared(afterDom);assert.ok(browserHttp.some(x=>x.request.operation===deniedOp&&x.status===denied.status));
  for(const secret of [f.body.id,f.body.number,f.body.purchaseId,m.paymentId,m.account.id,'synthetic:retained-draft'])assert.equal(JSON.stringify(afterDom).includes(secret),false,secret);
  await call('publisher','grant',{principal:'agent',scopes:[aScope,bScope],operations,fields});const start=await page.evaluate('window.invoiceHttp.length');await page.click('#reload');await page.until('document.querySelector("#cases").children.length===1');assert.equal((await capture()).hidden,true);assert.equal((await page.evaluate(`window.invoiceHttp.slice(${start})`)).filter(x=>['invoiceRead','paymentRead','paymentAccountRead'].includes(x.request.operation)).length,0);await openInvoice();assert.equal((await capture()).hidden,false);assert.deepEqual(await observe(f,m),before);
  evidence('INV-R1-restored-'+order+'-'+revocation+'-'+trigger,{dom:await capture(),browserHttp:await page.evaluate('window.invoiceHttp'),business:await observe(f,m)});
 },{purchaseScope:aScope,enterpriseScopes:[aScope,bScope]}));
}

test('INV-R1 valid mixed references keep drafts on 400 and readable self-approval 403 without selecting past payment',()=>fixture(async f=>{
 const {page,call,signIn,openInvoice,capture}=f,m=await mixed(f,otherScope);await signIn('operator');await openInvoice();await listOpen(f,m.paymentId);
 await page.fill('#number','訂正途中の正常な下書き');await page.fill('#account-id','unsubmitted-account-draft');await page.fill('#payment-target','unsubmitted-target-draft');const before=await capture(),business=await observe(f,m);let n=await page.evaluate('window.invoiceHttp.length');await page.click('#approve');await page.until(`document.querySelector('#message').textContent==='PERMISSION_DENIED'`);assert.deepEqual((await capture()).controls,before.controls);assert.deepEqual((await capture()).sections,before.sections);assert.ok((await page.evaluate(`window.invoiceHttp.slice(${n})`)).some(x=>x.request.operation==='paymentRead'&&x.status===200));
 await page.fill('#invoice-id','不正な ID');const draft=await capture();await page.click('#correct');await page.until(`document.querySelector('#message').textContent==='INVALID_ARGUMENT'`);assert.deepEqual((await capture()).controls,draft.controls);
 await openInvoice();assert.equal((await capture()).controls.find(x=>x.id==='payment-target').value,'unsubmitted-target-draft');
 for(const selector of ['#approve','#dispatch','#reconcile','#cancel']){n=await page.evaluate('window.invoiceHttp.length');await page.click(selector);await page.until(`window.invoiceHttp.length>${n}&&document.querySelector('#message').textContent!==''`);const http=await page.evaluate(`window.invoiceHttp.slice(${n})`);assert.equal('id' in http[0].request.body,false,'past payment must not become the business target');}
 assert.equal((await page.evaluate('window.invoiceHttp')).some(x=>['invoiceRead','paymentRead','paymentAccountRead'].includes(x.request.operation)&&['unsubmitted-account-draft','unsubmitted-target-draft'].includes(x.request.body.id)),false);assert.deepEqual(await observe(f,m),business);evidence('INV-R1-valid-drafts',{before,draft,after:await capture(),business,browserHttp:await page.evaluate('window.invoiceHttp')});
},{enterpriseScopes:[scope,otherScope]}));

for(const retained of ['account','list'])test('INV-R1 '+retained+' API-derived values remain revalidated after switching invoice',()=>fixture(async f=>{
 const {page,call,signIn,openInvoice,capture}=f,m=await mixed(f,otherScope,retained!=='account');await signIn('publisher');
 if(retained==='account'){
  await openInvoice(m.b.id);await page.fill('#account-id',m.account.id);await page.fill('#account-reference','synthetic:updated-state-bank');await page.fill('#account-revision','1');await page.click('#account button');await page.until(`document.querySelector('#account-revision').value==='2'`);
 }
 await openInvoice();const beforeDom=await capture(),before=await observe(f,m);await call('manager','grant',{principal:'publisher',scopes:[scope],operations,fields});
 const n=await page.evaluate('window.invoiceHttp.length');if(retained==='account')await page.click('#reload');else {await page.fill('#invoice-id','missing-readable-invoice');await page.click('#correct');}
 await page.until(`document.querySelector('#detail').hidden||document.querySelector('#message').textContent==='NOT_FOUND'||(window.invoiceHttp.slice(${n}).some(x=>x.request.operation==='query'&&x.status===200)&&window.invoiceHttp.slice(${n}).filter(x=>x.request.operation==='invoiceRead'&&x.status===200).length>=2)`);const afterDom=await capture(),after=await observe(f,m),browserHttp=await page.evaluate(`window.invoiceHttp.slice(${n})`);evidence('INV-R1-'+retained,{beforeDom,afterDom,before,after,browserHttp});assert.deepEqual(after,before);cleared(afterDom);
},{enterpriseScopes:[scope,otherScope]}));
