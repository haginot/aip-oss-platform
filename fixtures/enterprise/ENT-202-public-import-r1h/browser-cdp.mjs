import {browser as localBrowser} from '../../../tests/enterprise/browser-helper.mjs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function supervisedBrowser(){
 const manifestPath=process.env.R1H_BROWSER_MANIFEST;
 if(!manifestPath)return localBrowser();
 const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
 if(manifest.status!=='RUNNING'||manifest.syntheticOnly!==true||manifest.endpoint!=='http://127.0.0.1:25447')throw Error('R1H browser attestation mismatch');
 const version=await (await fetch(manifest.endpoint+'/json/version')).json();
 if(version.Browser!==manifest.version.Browser||version['Protocol-Version']!==manifest.version['Protocol-Version'])throw Error('R1H live CDP version mismatch');
 const target=await (await fetch(manifest.endpoint+'/json/new?about:blank',{method:'PUT'})).json();
 if(new URL(target.webSocketDebuggerUrl).port!=='25447')throw Error('R1H target escaped attested CDP endpoint');
 const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 let sequence=0;const pending=new Map();
 ws.onmessage=event=>{const data=JSON.parse(event.data);if(data.id){const p=pending.get(data.id);if(p){pending.delete(data.id);clearTimeout(p.timer);data.error?p.reject(Error(JSON.stringify(data.error))):p.resolve(data.result);}}};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const until=async expression=>{const end=Date.now()+10000;let last;while(Date.now()<end){try{last=await evaluate(expression);if(last)return last;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('Browser condition timeout: '+expression+' last='+JSON.stringify(last));};
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1100,height:1000,deviceScaleFactor:1,mobile:false});
 return {executable:manifest.executable,manifest,send,evaluate,until,async navigate(url){await send('Page.navigate',{url});await until('document.readyState === "complete"');},async click(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);},async fill(selector,value){await evaluate(`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(value)}`);},async screenshot(name){const output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser';await mkdir(output,{recursive:true});const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(join(output,name+'.png'),Buffer.from(data,'base64'));},async close(){try{await fetch(manifest.endpoint+'/json/close/'+target.id);}finally{ws.close();}}};
}
