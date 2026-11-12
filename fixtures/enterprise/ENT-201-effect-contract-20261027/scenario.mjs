// Slice-local runner support; existing helpers and seeds remain byte-identical.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {invoiceEnvironment} from '../../../scripts/enterprise/invoice-local.mjs';
import {publishInvoice} from '../../../scripts/enterprise/invoice-seed.mjs';
import {seedQuantity,compareQuantity,approvePurchase,receiptBody,scope} from '../../../tests/enterprise/quantity-helper.mjs';
import {login} from '../../../tests/enterprise/http-helper.mjs';
import {browser} from '../../../tests/enterprise/browser-helper.mjs';
import {evidence as rawEvidence} from '../../../tests/enterprise/assurance-helper.mjs';
export {scope};
let currentName='';
export function evidence(name,data){rawEvidence(currentName+'--'+name,data);}
export const uid=p=>p+'-'+randomUUID();
export const allFields=['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'];
export const ops=['read','search','action','approve','worker','recovery','author','review','publish','records','audit','connect'];
export async function scenario(name,run,options={}){
 currentName=name;const env=await invoiceEnvironment(options);const http=[];let page;const children=[];
 try{
  const clients={};for(const who of ['operator','manager','reviewer','publisher','agent','reader','other','tenant2'])clients[who]=await login(env,who);
  const probe=async(who,operation,body={},key=randomUUID())=>{const startedAt=new Date().toISOString(),response=await clients[who].api(operation,body,key),data=await response.json();const row={who,operation,body,key,startedAt,finishedAt:new Date().toISOString(),status:response.status,data};http.push(row);return row;};
  const call=async(...a)=>{const x=await probe(...a);assert.equal(x.status,200,JSON.stringify(x));return x.data.result;};
  const deny=async(who,op,b,code,key)=>{const row=await probe(who,op,b,key);assert.equal(row.status,code==='NOT_FOUND'?404:code==='PERMISSION_DENIED'?403:400,JSON.stringify(row));assert.deepEqual(row.data,{error:{code}});return row;};
  await publishInvoice(env.f,call);const seed=await seedQuantity(env.f,call,options.purchaseScope??scope),po=await approvePurchase({call},await compareQuantity({call},seed));
  await call('manager','dispatch',{id:po.id});const ordered=await call('operator','purchaseRead',{id:po.id});await call('agent','purchaseReceive',receiptBody(po,ordered));const source=await call('operator','purchaseRead',{id:po.id});
  const account={id:uid('account'),scope:seed.scope,supplierId:seed.supplierIds[0],currency:'JPY',syntheticReference:'synthetic:return-resubmit',revision:0};await call('publisher','paymentAccountSet',account);
  const body={id:uid('invoice'),purchaseId:po.id,number:uid('合成請求'),supplierId:seed.supplierIds[0],amount:1200,currency:'JPY',quantity:source.quantityContract.ordered.quantity,unit:source.quantityContract.ordered.unit};
  const invoice=()=>call('operator','invoiceRead',{id:body.id}),payment=id=>call('operator','paymentRead',{id}),request=async(more={})=>({id:uid('payment'),invoiceId:body.id,revision:(await invoice()).revision,accountId:account.id,amount:1200,...more});
  const vote=async(who,id,decision='APPROVE',key)=>{const p=await payment(id);return call(who,'vote',{id,revision:p.revision,decision},key);};
  const approve=async id=>{for(const who of ['manager','reviewer','publisher'])await vote(who,id);};
  const observe=async id=>({invoice:await invoice(),payment:await payment(id),ledger:await env.payments.ledger(),requests:env.payments.requests(),orderLedger:await env.effects.ledger(),orderRequests:env.effects.requests()});
  const f={env,http,clients,probe,call,deny,seed,po,source,account,body,invoice,payment,request,vote,approve,observe,children};
  if(options.browser){
   page=await browser();f.page=page;
   await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`const original=window.fetch;window.invoiceHttp=[];window.fetch=async(...a)=>{const r=await original(...a);if(a[0]==='/api'){const x={request:JSON.parse(a[1].body),status:r.status,data:await r.clone().json()};window.invoiceHttp.push(x);const saved=JSON.parse(sessionStorage.getItem('return-http')??'[]');saved.push(x);sessionStorage.setItem('return-http',JSON.stringify(saved));}return r;};`});
   f.signIn=async(who,origin=env.gateway.origin)=>{await page.navigate(origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]',who);await page.click('button');await page.until(`document.querySelector('#identity')?.textContent==='ログイン中: ${who}'`);await page.navigate(origin+'/invoice');await page.until(`document.querySelector('#identity')?.textContent==='ログイン中: ${who}'&&window.invoiceHttp.some(x=>x.request.operation==='query')`);};
   f.state=s=>page.until(`document.querySelector('#detail').dataset.state===${JSON.stringify(s)}`);
   f.openInvoice=async(id=body.id)=>{await page.fill('#invoice-target',id);await page.click('#open-invoice');await page.until(`document.querySelector('#detail').dataset.id===${JSON.stringify(id)}`);};
   f.openPayment=async id=>{await page.fill('#payment-target',id);await page.click('#open-payment');await page.until(`document.querySelector('#detail').dataset.id===${JSON.stringify(id)}`);};
   f.fillInvoice=async(b=body)=>{for(const [key,id] of [['id','invoice-id'],['purchaseId','purchase-id'],['number','number'],['supplierId','supplier-id'],['amount','amount'],['currency','currency'],['quantity','quantity'],['unit','unit']])await page.fill('#'+id,String(b[key]));};
   f.capture=()=>page.evaluate(`({html:document.documentElement.outerHTML,hidden:document.querySelector('#detail').hidden,cases:document.querySelector('#cases').children.length,datasets:[...document.querySelectorAll('*')].filter(x=>Object.keys(x.dataset).length).map(x=>({...x.dataset})),controls:[...document.querySelectorAll('input,textarea,select')].map(x=>({id:x.id,value:x.value,selectedIndex:x.tagName==='SELECT'?x.selectedIndex:null,options:x.tagName==='SELECT'?[...x.options].map(o=>({value:o.value,selected:o.selected})):null})),sections:Object.fromEntries(['summary','approvals','history'].map(id=>[id,document.getElementById(id).innerHTML]))})`);
  }
  await run(f);
 }finally{
  if(page)evidence(name+'-browser-final',{dom:await page.evaluate('document.documentElement.outerHTML').catch(String),http:await page.evaluate("JSON.parse(sessionStorage.getItem('return-http')??'[]')").catch(()=>[]),browser:await page.send('Browser.getVersion').catch(String),executable:page.executable});
  evidence(name+'-http',{http,paymentLedger:await env.payments.ledger(),orderLedger:await env.effects.ledger(),paymentRequests:env.payments.requests(),orderRequests:env.effects.requests(),postgres:env.cluster.version,runtime:process.version});
  await page?.close();for(const child of children)await child.close();await env.close();
 }
}
export function cleared(dom){assert.equal(dom.hidden,true);assert.equal(dom.cases,0);assert.deepEqual(dom.datasets,[]);assert.ok(dom.controls.every(x=>x.value===''));for(const x of dom.controls.filter(x=>x.options)){assert.equal(x.selectedIndex,-1);assert.ok(x.options.every(o=>!o.selected));}assert.ok(Object.values(dom.sections).every(x=>x===''));}
export async function childGateway(f){
 const {host,port,user,database,options}=f.env.f.state.pool.options;
 const argv=['fixtures/enterprise/ENT-201-effect-contract-20261027/gateway-child.mjs'],startedAt=new Date().toISOString(),p=spawn(process.execPath,argv,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
 const exited=new Promise(resolve=>p.on('exit',(code,signal)=>resolve({code,signal})));p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);
 const config=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('child startup timeout '+stderr)),15000);p.on('error',reject);p.on('exit',code=>{clearTimeout(timer);reject(Error('child exited '+code+' '+stderr));});p.stdout.on('data',()=>{try{const row=JSON.parse(stdout.trim());if(row.origin){clearTimeout(timer);resolve(row);}}catch{}});p.stdin.end(JSON.stringify({config:{host,port,user,database,options},journal:f.env.f.journal.path,issuer:f.env.idp.issuer,url:f.env.payments.url}));});
 let closed=false;const child={...config,async close(){if(closed)return;closed=true;if(p.exitCode===null)p.kill('SIGTERM');const exit=await exited;evidence('process-'+p.pid,{argv:[process.execPath,...argv],cwd:process.cwd(),runtime:process.version,startedAt,finishedAt:new Date().toISOString(),stdout,stderr,...exit});assert.equal(exit.code,0,stderr);}};return child;
}
