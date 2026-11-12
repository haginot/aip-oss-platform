import {supervisedBrowser} from './browser-cdp.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';

export async function screen(f,name,run){
 const page=await supervisedBrowser();
 try{
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.r1hHttp=[];const native=window.fetch;window.fetch=async(...args)=>{const r=await native(...args);if(['/api','/enterprise/v2/rpc'].includes(args[0]))window.r1hHttp.push({path:args[0],request:JSON.parse(args[1].body),status:r.status,data:await r.clone().json()});return r;};`});
  await signIn(page,f.env.gateway.origin,'operator');
  await page.navigate(f.env.gateway.origin+'/enterprise/ENT-202-import');
  await page.until("document.querySelector('#message')?.textContent.includes('現在の参照権限と発注')");
  const select=async()=>{await page.fill('#purchase-id',f.po.id);await page.evaluate("document.querySelector('#purchase-id').dispatchEvent(new Event('change',{bubbles:true}))");await page.until(`document.querySelector('#references').dataset.id===${JSON.stringify(f.po.id)}`);};
  const fill=async key=>{for(const [field,id] of [['id','invoice-id'],['number','number'],['supplierId','supplier-id'],['amount','amount'],['currency','currency'],['quantity','quantity'],['unit','unit']])await page.fill('#'+id,String(f.body[field]));await page.fill('#request-key',key);};
  const capture=()=>page.evaluate(`({html:document.documentElement.outerHTML,source:document.querySelector('#source').textContent,summary:document.querySelector('#summary').textContent,identity:document.querySelector('#identity').textContent,hidden:document.querySelector('#references').hidden,resultHidden:document.querySelector('#result').hidden,controls:[...document.querySelectorAll('input,select')].map(x=>({id:x.id,value:x.value,options:x.tagName==='SELECT'?[...x.options].map(o=>o.value):null})),datasets:[...document.querySelectorAll('*')].filter(x=>Object.keys(x.dataset).length).map(x=>({...x.dataset})),http:window.r1hHttp})`);
  await run({page,select,fill,capture});
 }finally{
  const record={dom:await page.evaluate('document.documentElement.outerHTML').catch(String),http:await page.evaluate('window.r1hHttp').catch(String),browser:await page.send('Browser.getVersion').catch(String),executable:page.executable,manifest:page.manifest};
  if(process.env.R1H_EVIDENCE){mkdirSync(process.env.R1H_EVIDENCE,{recursive:true});writeFileSync(process.env.R1H_EVIDENCE+'/'+name+'--browser.json',JSON.stringify(record,null,2)+'\n');}
  await page.screenshot('r1h-'+name);await page.close();
 }
}

async function signIn(page,origin,who){await page.navigate(origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]',who);await page.click('button');await page.until(`document.querySelector('#identity')?.textContent==='ログイン中: ${who}'`);}
export function cleared(dom,secrets=[]){if(dom.identity!==''||dom.source!==''||dom.summary!==''||dom.hidden!==true||dom.resultHidden!==true||dom.datasets.length||dom.controls.some(x=>x.value!==''||(x.options&&x.options.length)))throw Error('retained browser state: '+JSON.stringify(dom));for(const value of secrets)if(dom.html.includes(value))throw Error('secret remains in DOM: '+value);}
