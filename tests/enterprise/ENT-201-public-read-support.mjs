import {seedProcurement} from '../../scripts/enterprise/procurement-seed.mjs';
import {publishQuantity} from '../../scripts/enterprise/procurement-quantity-seed.mjs';
// Slice-local runner support for isolated regressions and supervised evidence runs.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {after} from 'node:test';
import {browser as localBrowser} from './browser-helper.mjs';
import {isAbsolute,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {invoiceEnvironment} from '../../scripts/enterprise/invoice-local.mjs';
import {publishInvoice} from '../../scripts/enterprise/invoice-seed.mjs';
import {seedQuantity,compareQuantity,approvePurchase,receiptBody,scope} from '../../tests/enterprise/quantity-helper.mjs';
import {login} from '../../tests/enterprise/http-helper.mjs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {evidence as rawEvidence} from '../../tests/enterprise/assurance-helper.mjs';
export {scope,login};

const supervisedOutput=process.env.ENTERPRISE_SUITE_OUTPUT;
const output=supervisedOutput??mkdtempSync(join(tmpdir(),'enterprise-public-read-'));
if(!supervisedOutput)after(()=>rmSync(output,{recursive:true,force:true}));
const unitRoot='/Users/haginota/.takt/state/projects/1f55f464-a70a-4f4e-abd5-68720a923e59/supervision/20261027-takeover/ent201-ordered-preparation-20261101';
if(supervisedOutput&&(!isAbsolute(output)||!resolve(output).startsWith(unitRoot+'/')))throw Error('ENT-201 requires current-unit ENTERPRISE_SUITE_OUTPUT');
mkdirSync(output+'/profiles',{recursive:true});

let currentName='';
export function evidence(name,data){rawEvidence(currentName+'--'+name,data);}
export const uid=p=>p+'-'+randomUUID();
export const allFields=['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'];
export const ops=['read','search','action','approve','worker','recovery','author','review','publish','records','audit','connect'];
export async function scenario(name,run,options={}){
 currentName=name;const env=await invoiceEnvironment(options);const http=[];const children=[];
 try{
  const clients={};for(const who of ['operator','manager','reviewer','publisher','agent','reader','other','tenant2'])clients[who]=await login(env,who);
  const probe=async(who,operation,body={},key=randomUUID())=>{const startedAt=new Date().toISOString(),response=await clients[who].api(operation,body,key),data=await response.json();const row={who,operation,body,key,startedAt,finishedAt:new Date().toISOString(),status:response.status,data};http.push(row);return row;};
  const call=async(...a)=>{const x=await probe(...a);assert.equal(x.status,200,JSON.stringify(x));return x.data.result;};
  const deny=async(who,op,b,code,key)=>{const row=await probe(who,op,b,key);assert.equal(row.status,code==='NOT_FOUND'?404:code==='PERMISSION_DENIED'?403:400,JSON.stringify(row));assert.deepEqual(row.data,{error:{code}});return row;};
  await publishInvoice(env.f,call);const seed=await seedProcurement(env.f,call,options.purchaseScope??scope);const legacy={id:uid('legacy'),scope:seed.scope,title:'旧版数量不明',currency:'JPY',budgetId:seed.budgetId};await call('operator','purchaseCreate',legacy);await publishQuantity(env.f,call);const po=await approvePurchase({call},await compareQuantity({call},seed));
  await call('manager','dispatch',{id:po.id});const ordered=await call('operator','purchaseRead',{id:po.id});await call('agent','purchaseReceive',receiptBody(po,ordered));const source=await call('operator','purchaseRead',{id:po.id});
  const account={id:uid('account'),scope:seed.scope,supplierId:seed.supplierIds[0],currency:'JPY',syntheticReference:'synthetic:return-resubmit',revision:0};await call('publisher','paymentAccountSet',account);
  const body={id:uid('invoice'),purchaseId:po.id,number:uid('合成請求'),supplierId:seed.supplierIds[0],amount:1200,currency:'JPY',quantity:source.quantityContract.ordered.quantity,unit:source.quantityContract.ordered.unit};
  const invoice=()=>call('operator','invoiceRead',{id:body.id}),payment=id=>call('operator','paymentRead',{id}),request=async(more={})=>({id:uid('payment'),invoiceId:body.id,revision:(await invoice()).revision,accountId:account.id,amount:1200,...more});
  const vote=async(who,id,decision='APPROVE',key)=>{const p=await payment(id);return call(who,'vote',{id,revision:p.revision,decision},key);};
  const approve=async id=>{for(const who of ['manager','reviewer','publisher'])await vote(who,id);};
  const observe=async id=>({invoice:await invoice(),payment:await payment(id),ledger:await env.payments.ledger(),requests:env.payments.requests(),orderLedger:await env.effects.ledger(),orderRequests:env.effects.requests()});
  const f={env,http,clients,probe,call,deny,seed,legacy,po,source,account,body,invoice,payment,request,vote,approve,observe,children};
  await run(f);
 }finally{
  evidence(name+'-http',{http,paymentLedger:await env.payments.ledger(),orderLedger:await env.effects.ledger(),paymentRequests:env.payments.requests(),orderRequests:env.effects.requests(),postgres:env.cluster.version,runtime:process.version});
  const closed=await Promise.allSettled(children.map(child=>child.close()));try{await env.close();}finally{for(const row of closed)if(row.status==='rejected')throw row.reason;}
 }
}
export async function childGateway(f){
 const {host,port,user,database,options}=f.env.f.state.pool.options;
 const argv=['tests/enterprise/ENT-201-public-read-gateway.mjs'],startedAt=new Date().toISOString(),p=spawn(process.execPath,argv,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
 const exited=new Promise(resolve=>p.on('close',(code,signal)=>resolve({code,signal})));p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);
 const stop=async()=>{if(p.exitCode===null)p.kill('SIGTERM');return exited;};f.children.push({close:stop});
 const config=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('child startup timeout '+stderr)),15000);p.on('error',reject);p.on('close',code=>{clearTimeout(timer);reject(Error('child exited '+code+' '+stderr));});p.stdout.on('data',()=>{try{const row=JSON.parse(stdout.trim());if(row.origin){clearTimeout(timer);resolve(row);}}catch{}});p.stdin.end(JSON.stringify({config:{host,port,user,database,options},journal:f.env.f.journal.path,issuer:f.env.idp.issuer,url:f.env.payments.url}));});
 let closed=false;const child={...config,async close(){if(closed)return;closed=true;if(p.exitCode===null)p.kill('SIGTERM');const exit=await exited;evidence('process-'+p.pid,{argv:[process.execPath,...argv],cwd:process.cwd(),runtime:process.version,startedAt,finishedAt:new Date().toISOString(),stdout,stderr,...exit});assert.equal(exit.code,0,stderr);}};return child;
}

export const envelope=(operation='query',body={})=>({contractVersion:'2.0.0',packageId:'ENT-201',type:'ENT201Case',operation,body});
export async function ready(f){await f.call('operator','invoiceImport',f.body);const p=await f.request();await f.call('operator','paymentRequest',p);return p;}
export async function rpc(f,operation='query',body={},who='manager',options={}){
 const origin=options.origin??f.env.gateway.origin,c=options.client??f.clients[who],request=Object.hasOwn(options,'request')?options.request:envelope(operation,body),startedAt=new Date().toISOString();
 const response=await fetch(origin+'/enterprise/v2/rpc',{method:'POST',headers:{cookie:c.cookie,origin,'content-type':'application/json','x-csrf-token':c.identity.csrf,...options.headers},body:options.raw??JSON.stringify(request)}),data=await response.json();
 const row={startedAt,finishedAt:new Date().toISOString(),who,request,wireBody:options.raw??JSON.stringify(request),requestGate:{origin:options.headers?.origin??origin,contentType:options.headers?.['content-type']??'application/json',sessionCookiePresent:Boolean(options.headers?.cookie??c.cookie),csrfHeaderPresent:Boolean(options.headers?.['x-csrf-token']??c.identity.csrf)},status:response.status,data,headers:Object.fromEntries(response.headers)};f.publicHttp??=[];f.publicHttp.push(row);evidence('public-http',f.publicHttp);return row;
}
export async function ok(...args){const r=await rpc(...args);assert.equal(r.status,200,JSON.stringify(r));return r.data.result;}
export async function denied(f,operation,body,who,code,options={}){const r=await rpc(f,operation,body,who,options);assert.equal(r.status,code==='NOT_FOUND'?404:code==='PERMISSION_DENIED'?403:400,JSON.stringify(r));assert.deepEqual(r.data,{error:{code}});return r;}
export async function business(f){
 // Test-only owner observation. Product projections use only Kernel public reads.
 const tables={};for(const table of ['objects','actions','outbox','history','enterprise_instances','enterprise_invoice','enterprise_procurement','enterprise_assurance','enterprise_assurance_history','enterprise_controls','enterprise_control_history','enterprise_attachments','enterprise_documents','enterprise_erasure','enterprise_routes','enterprise_control_deliveries','enterprise_handoff_inbox','enterprise_packages','enterprise_live'])tables[table]=(await f.env.f.owner.query(`SELECT row_to_json(t) value FROM ${table} t ORDER BY row_to_json(t)::text`)).rows.map(x=>x.value);
 return {tables,paymentLedger:await f.env.payments.ledger(),paymentRequests:f.env.payments.requests(),orderLedger:await f.env.effects.ledger(),orderRequests:f.env.effects.requests()};
}
export async function audit(f){return (await f.env.f.owner.query('SELECT previous_hash,hash,record FROM audit ORDER BY sequence')).rows;}
export async function grant(f,who='manager',change={}){await f.call('publisher','grant',{principal:who,scopes:[f.seed.scope],operations:ops,fields:allFields,...change});}
export async function openBrowser(f){
 const page=await browser();
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`const nativeFetch=window.fetch;window.publicHttp=[];window.fetch=async(...args)=>{const r=await nativeFetch(...args);if(args[0]==='/enterprise/v2/rpc'){const row={request:JSON.parse(args[1].body),status:r.status,data:await r.clone().json()};window.publicHttp.push(row);}return r;};`});
 const signIn=async(who='manager',origin=f.env.gateway.origin)=>{await page.navigate(origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]',who);await page.click('button');await page.until(`document.querySelector('#identity')?.textContent==='ログイン中: ${who}'`);};
 const list=async(origin=f.env.gateway.origin)=>{await page.navigate(origin+'/enterprise/cases/ENT-201');await page.until("document.querySelector('#message')?.textContent.includes('最新の参照')||document.querySelector('#message')?.textContent.includes('ありません')");};
 const detail=async id=>{await page.evaluate(`document.querySelector('#case-list a[href$="/${id}"]').focus()`);await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await page.until(`document.querySelector('#case-detail')?.dataset.id===${JSON.stringify(id)}`);};
 const capture=()=>page.evaluate(`({html:document.documentElement.outerHTML,text:document.body.textContent,hidden:document.querySelector('#case-detail')?.hidden,cases:document.querySelector('#case-list')?.children.length,datasets:[...document.querySelectorAll('*')].filter(x=>Object.keys(x.dataset).length).map(x=>({...x.dataset})),controls:[...document.querySelectorAll('input,textarea,select')].map(x=>({id:x.id,value:x.value})),sections:Object.fromEntries(['identity','summary','quantity','binding','approvals','history'].map(id=>[id,document.getElementById(id)?.innerHTML])),http:window.publicHttp})`);
 return {page,signIn,list,detail,capture};
}
export function cleared(dom,secrets=[]){assert.equal(dom.hidden,true);assert.equal(dom.cases,0);assert.deepEqual(dom.datasets,[]);assert.ok(dom.controls.every(x=>x.value===''));assert.ok(Object.values(dom.sections).every(x=>x===''));for(const s of secrets)assert.equal(dom.html.includes(s),false,s);}

export async function createCase(f,more={}){
 const budgetId=uid('budget');await f.call('manager','resourceCreate',{id:budgetId,scope:f.seed.scope,currency:'JPY',unit:'minor',capacity:10000,threshold:10000,periodEnd:'2099-01-01T00:00:00Z',calculationVersion:'integer-v1'});
 const body={id:uid('purchase'),scope:f.seed.scope,title:'合成購買・公開参照',currency:'JPY',budgetId,packageVersion:'1.1.0',quantity:7,unit:'台',...more};
 await f.call('operator','purchaseCreate',body);return body;
}
export async function compareCase(f,p){
 let current=await f.call('operator','purchaseRead',{id:p.id});
 for(const [index,supplierId] of f.seed.supplierIds.slice(0,2).entries())current=await f.call('operator','purchaseQuote',{id:p.id,revision:current.revision,quoteId:'q'+index,supplierId,amount:index?1400:1200,currency:'JPY',quantity:7,unit:'台',quoteVersion:index?3:2});
 return f.call('operator','purchaseSelect',{id:p.id,revision:current.revision,quoteId:'q0',reason:'同一数量・総額比較'});
}
export async function policy(f,id){return f.call('publisher','informationCreate',{id:uid('policy'),scope:f.seed.scope,source:{kind:'object',id,projection:['title']},label:'STRICT',purposes:['procurement-review']});}
export async function observed(f,operation='get',id=f.po.id){const before=await business(f),value=await ok(f,operation,operation==='query'?{}:{id});assert.deepEqual(await business(f),before);return value;}
export {receiptBody,approvePurchase};

async function browser(){
 if(!supervisedOutput)return localBrowser();
 const executable=process.env.ENTERPRISE_CHROME;if(!executable)throw Error('ENTERPRISE_CHROME required');
 const directory=await mkdtemp(join(output,'profiles/chrome-'));
 const child=spawn(executable,['--headless','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+directory,'about:blank']);
 const exited=new Promise((resolve,reject)=>{child.once('close',(code,signal)=>resolve({code,signal}));child.once('error',reject);});let ws,stderr='',closed=false;
 const close=async()=>{if(closed)return;closed=true;ws?.close();if(child.exitCode===null)child.kill('SIGTERM');const exit=await exited;await rm(directory,{recursive:true,force:true});evidence('browser-process-'+child.pid,{pid:child.pid,executable,profile:directory,exit,stderr});};
 try{
 const endpoint=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Chromium startup timeout '+stderr)),15000);child.stderr.on('data',data=>{stderr+=data;const url=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];if(url){clearTimeout(timer);resolve(url);}});child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);reject(Error('Chromium startup exit '+code));});});
 const port=new URL(endpoint).port,target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});let sequence=0;const pending=new Map();
 ws.onmessage=event=>{const data=JSON.parse(event.data);if(data.id){const p=pending.get(data.id);if(p){pending.delete(data.id);clearTimeout(p.timer);data.error?p.reject(Error(JSON.stringify(data.error))):p.resolve(data.result);}}};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const until=async expression=>{const end=Date.now()+10000;let last;while(Date.now()<end){try{last=await evaluate(expression);if(last)return last;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('Browser condition timeout '+expression+' last='+JSON.stringify(last));};
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1100,height:1000,deviceScaleFactor:1,mobile:false});
 return {executable,pid:child.pid,send,evaluate,until,async navigate(url){await send('Page.navigate',{url});await until('document.readyState === "complete"');},async click(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);},async fill(selector,value){await evaluate(`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(value)}`);},async screenshot(name){const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(join(output,name+'.png'),Buffer.from(data,'base64'));},close};
 }catch(error){await close();throw error;}
}
