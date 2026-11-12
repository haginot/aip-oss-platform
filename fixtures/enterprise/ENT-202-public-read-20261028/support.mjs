import assert from 'node:assert/strict';
import {scenario,evidence,scope,ops,allFields,childGateway} from '../ENT-202-return-resubmit-20261027122740-4651bfda/scenario.mjs';
import {login} from '../../../tests/enterprise/http-helper.mjs';
import {browser} from '../../../tests/enterprise/browser-helper.mjs';
export {scenario,evidence,scope,ops,allFields,childGateway,login};
export const envelope=(operation='query',body={})=>({contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',operation,body});
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
 const tables={};for(const table of ['objects','actions','outbox','history','enterprise_instances','enterprise_invoice','enterprise_procurement'])tables[table]=(await f.env.f.owner.query(`SELECT row_to_json(t) value FROM ${table} t ORDER BY row_to_json(t)::text`)).rows.map(x=>x.value);
 return {tables,paymentLedger:await f.env.payments.ledger(),paymentRequests:f.env.payments.requests(),orderLedger:await f.env.effects.ledger(),orderRequests:f.env.effects.requests()};
}
export async function audit(f){return (await f.env.f.owner.query('SELECT previous_hash,hash,record FROM audit ORDER BY sequence')).rows;}
export async function grant(f,who='manager',change={}){await f.call('publisher','grant',{principal:who,scopes:[f.seed.scope],operations:ops,fields:allFields,...change});}
export async function openBrowser(f){
 const page=await browser();
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`const nativeFetch=window.fetch;window.publicHttp=[];window.fetch=async(...args)=>{const r=await nativeFetch(...args);if(args[0]==='/enterprise/v2/rpc'){const row={request:JSON.parse(args[1].body),status:r.status,data:await r.clone().json()};window.publicHttp.push(row);}return r;};`});
 const signIn=async(who='manager',origin=f.env.gateway.origin)=>{await page.navigate(origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]',who);await page.click('button');await page.until(`document.querySelector('#identity')?.textContent==='ログイン中: ${who}'`);};
 const list=async(origin=f.env.gateway.origin)=>{await page.navigate(origin+'/enterprise/cases/ENT-202');await page.until("document.querySelector('#message')?.textContent.includes('最新の参照')||document.querySelector('#message')?.textContent.includes('ありません')");};
 const detail=async id=>{await page.evaluate(`document.querySelector('#case-list a[href$="/${id}"]').focus()`);await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await page.until(`document.querySelector('#case-detail')?.dataset.id===${JSON.stringify(id)}`);};
 const capture=()=>page.evaluate(`({html:document.documentElement.outerHTML,text:document.body.textContent,hidden:document.querySelector('#case-detail')?.hidden,cases:document.querySelector('#case-list')?.children.length,datasets:[...document.querySelectorAll('*')].filter(x=>Object.keys(x.dataset).length).map(x=>({...x.dataset})),controls:[...document.querySelectorAll('input,textarea,select')].map(x=>({id:x.id,value:x.value})),sections:Object.fromEntries(['identity','summary','quantity','binding','approvals','history'].map(id=>[id,document.getElementById(id)?.innerHTML])),http:window.publicHttp})`);
 return {page,signIn,list,detail,capture};
}
export function cleared(dom,secrets=[]){assert.equal(dom.hidden,true);assert.equal(dom.cases,0);assert.deepEqual(dom.datasets,[]);assert.ok(dom.controls.every(x=>x.value===''));assert.ok(Object.values(dom.sections).every(x=>x===''));for(const s of secrets)assert.equal(dom.html.includes(s),false,s);}
