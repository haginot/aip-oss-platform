import assert from 'node:assert/strict';
import {browser} from '../../../tests/enterprise/browser-helper.mjs';
import {evidence} from './support.mjs';
export async function screen(f,run){
 const page=await browser();
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`const nativeFetch=window.fetch;window.submitHttp=[];window.fetch=async(...args)=>{const r=await nativeFetch(...args);if(['/api','/enterprise/v2/rpc'].includes(args[0]))window.submitHttp.push({request:JSON.parse(args[1].body),status:r.status,data:await r.clone().json()});return r;};`});
 const signIn=async(origin=f.env.gateway.origin,who='operator')=>{await page.navigate(origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]',who);await page.click('button');await page.until(`document.querySelector('#identity')?.textContent===${JSON.stringify('ログイン中: '+who)}`);};
 const open=async(origin=f.env.gateway.origin)=>{await page.navigate(origin+'/enterprise/ENT-202-submit');await page.until("document.querySelector('#identity')?.textContent==='ログイン中: operator'");};
 const fill=async(b,key)=>{for(const [id,value] of Object.entries({'payment-id':b.id,'invoice-id':b.invoiceId,revision:b.revision,'account-id':b.accountId,amount:b.amount,'request-key':key}))await page.fill('#'+id,String(value));};
 const capture=()=>page.evaluate(`({html:document.documentElement.outerHTML,text:document.body.textContent,identity:document.querySelector('#identity')?.textContent,resultHidden:document.querySelector('#result')?.hidden,sourceHidden:document.querySelector('#references')?.hidden,summary:document.querySelector('#summary')?.textContent,source:document.querySelector('#source')?.textContent,href:document.querySelector('#detail')?.getAttribute('href'),controls:[...document.querySelectorAll('input,textarea,select')].map(x=>({id:x.id,value:x.value})),datasets:[...document.querySelectorAll('*')].filter(x=>Object.keys(x.dataset).length).map(x=>({...x.dataset})),http:window.submitHttp})`);
 try{await signIn();await open();await run({page,signIn,open,fill,capture});}
 finally{evidence('browser-final',{dom:await capture().catch(String),browser:await page.send('Browser.getVersion').catch(String),executable:page.executable});await page.screenshot('submit-final').catch(()=>{});await page.close();}
}
export function cleared(dom,secrets=[]){assert.equal(dom.identity,'');assert.equal(dom.resultHidden,true);assert.equal(dom.sourceHidden,true);assert.equal(dom.summary,'');assert.equal(dom.source,'');assert.equal(dom.href,null);assert.deepEqual(dom.datasets,[]);assert.ok(dom.controls.every(x=>x.value===''));for(const s of secrets)assert.equal(dom.html.includes(s),false,s);}
