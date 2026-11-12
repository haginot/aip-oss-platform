import test from 'node:test';
import assert from 'node:assert/strict';
import {scenario,evidence,ops,grant,business,audit,openBrowser,cleared,childGateway,createCase} from './ENT-201-public-read-support.mjs';

const visible=id=>`document.querySelector('#case-detail')?.dataset.id===${JSON.stringify(id)}`;
const failed="document.querySelector('#message')?.textContent.includes('参照できません')||document.querySelector('#message')?.textContent.includes('再ログイン')";
async function opened(f){const b=await openBrowser(f);await b.signIn();await b.list();await b.detail(f.po.id);return b;}
async function hold(page,operation='history'){
 await page.evaluate(`(()=>{window.holdNext=true;window.held=false;const workingFetch=window.fetch;window.fetch=async(...args)=>{const response=await workingFetch(...args);if(window.holdNext&&args[0]==='/enterprise/v2/rpc'&&JSON.parse(args[1].body).operation===${JSON.stringify(operation)}){window.holdNext=false;window.held=true;await new Promise(resolve=>window.releaseOld=resolve);}return response;};})()`);
 await page.click('#reload');await page.until('window.held===true');
}
async function release(page){await page.evaluate('window.releaseOld()');await page.evaluate('new Promise(resolve=>setTimeout(resolve,100))');}

test('B01 Japanese keyboard list detail real quantity approval receipt history reload and legacy UNKNOWN',async()=>{
 await scenario('b01',async f=>{const b=await opened(f),{page}=b;try{
  const before=await business(f),dom=await b.capture();assert.equal(await page.evaluate('document.documentElement.lang'),'ja');assert.equal(await page.evaluate('document.activeElement.id'),'detail-title');
  for(const text of [f.po.id,'購買状態: RECEIVED','quantity','台','agent','quoteVersion','payloadDigest','EnterpriseCommand'])assert.ok(dom.text.includes(text),text);
  assert.match(dom.sections.quantity,/"quantity": 7/);assert.ok(dom.sections.approvals.includes('manager'));assert.ok(dom.sections.approvals.includes('reviewer'));assert.ok(dom.sections.approvals.includes('publisher'));
  assert.equal(await page.evaluate("document.querySelectorAll('form,input,textarea,select').length"),0);assert.equal(await page.evaluate("document.querySelectorAll('button').length"),1);
  await page.click('#reload');await page.until(visible(f.po.id));await page.screenshot('B01-quantity-approval-receipt');await b.list();await b.detail(f.legacy.id);assert.match((await b.capture()).sections.quantity,/不明（旧版・推定なし）/);await page.screenshot('B01-legacy-unknown');assert.deepEqual(await business(f),before);evidence('keyboard-bindings',{dom,legacy:await b.capture(),browser:await page.send('Browser.getVersion'),executable:page.executable});
 }finally{await page.close();}});
});
test('B02 current scope classification read search audit and session revocation erase every sensitive DOM value',async()=>{
 await scenario('b02',async f=>{const b=await opened(f),{page}=b;try{
  for(const permission of ['scope','classification','read','search','audit','session']){
   if(permission==='session')assert.equal(await page.evaluate(`(async()=>{const s=await(await fetch('/session')).json();return (await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrf},body:JSON.stringify({contractVersion:'2.0.0',operation:'logout',body:{},key:crypto.randomUUID()})})).status;})()`),200);
   else await grant(f,'manager',permission==='scope'?{scopes:[]}:permission==='classification'?{fields:['PUBLIC','INTERNAL']}:{operations:ops.filter(x=>x!==permission)});
   const before=await business(f);await page.click('#reload');await page.until(failed);const dom=await b.capture();cleared(dom,[f.po.id,f.po.title,f.legacy.id]);assert.equal(await page.evaluate("document.querySelector('#state').textContent"),'');assert.deepEqual(await business(f),before);evidence('revocation-'+permission,dom);
   if(permission!=='session')await grant(f);await b.signIn();await b.list();await b.detail(f.po.id);
  }
 }finally{await page.close();}});
});
test('B03 actual network failure clears retained case and explicit Japanese reload recovers without writes',async()=>{
 await scenario('b03',async f=>{const b=await opened(f),{page}=b;try{
  const before=await business(f);await page.evaluate(`window.failNext=true;const working=window.fetch;window.fetch=(...args)=>{if(window.failNext&&args[0]==='/enterprise/v2/rpc'){window.failNext=false;return Promise.reject(Error('owned network failure'));}return working(...args);};`);await page.click('#reload');await page.until("document.querySelector('#message').textContent.includes('取得できませんでした')");const dom=await b.capture();cleared(dom,[f.po.id,f.po.title]);assert.match(dom.text,/最新の情報を取得/);await page.screenshot('B03-network-failure');await page.click('#reload');await page.until(visible(f.po.id));assert.deepEqual(await business(f),before);evidence('network',{failed:dom,recovered:await b.capture(),before,after:await business(f)});
 }finally{await page.close();}});
});
test('B04 delayed old successful history and detail cannot repaint newer denial or different identity',async()=>{
 await scenario('b04',async f=>{const b=await opened(f),{page}=b;try{
  await hold(page);await grant(f,'manager',{scopes:[]});await page.click('#reload');await page.until(failed);await release(page);cleared(await b.capture(),[f.po.id,f.legacy.id]);await grant(f);await page.click('#reload');await page.until(visible(f.po.id));
  await hold(page,'inspect');await page.evaluate(`history.pushState({},'',${JSON.stringify('/enterprise/cases/ENT-201/'+f.legacy.id)})`);await page.click('#reload');await page.until(visible(f.legacy.id));const current=await b.capture();await release(page);const final=await b.capture();assert.equal(await page.evaluate("document.querySelector('#case-detail').dataset.id"),f.legacy.id);assert.equal(final.sections.summary,current.sections.summary);assert.equal(final.sections.binding.includes(f.po.id),false);evidence('stale-generation',{current,final});
 }finally{await page.close();}});
});
test('B05 refresh and pagehide erase before response and focus uses current authority with generation fence',async()=>{
 await scenario('b05',async f=>{const b=await opened(f),{page}=b;try{
  await hold(page);const pending=await b.capture();cleared(pending,[f.po.id,f.po.title]);await page.evaluate("window.dispatchEvent(new Event('pagehide'))");const hidden=await b.capture();cleared(hidden,[f.po.id]);await release(page);cleared(await b.capture(),[f.po.id]);await page.evaluate("window.dispatchEvent(new Event('focus'))");await page.until(visible(f.po.id));await grant(f,'manager',{operations:ops.filter(x=>x!=='audit')});await page.evaluate("window.dispatchEvent(new Event('focus'))");await page.until(failed);cleared(await b.capture(),[f.po.id]);evidence('lifecycle',{pending,hidden,denied:await b.capture()});
 }finally{await page.close();}});
});
test('B06 missing cross-type malformed deep links are safe and keyboard navigation recovers authorized list',async()=>{
 await scenario('b06',async f=>{const b=await opened(f),{page}=b;try{
  for(const id of ['missing-case',f.seed.supplierIds[0],'bad%2Fid','bad/route','%ZZ']){await page.navigate(f.env.gateway.origin+'/enterprise/cases/ENT-201/'+id);await page.until("document.body.textContent.includes('error')");const html=await page.evaluate('document.documentElement.outerHTML');for(const secret of [f.po.id,f.po.title,f.legacy.id])assert.equal(html.includes(secret),false);assert.equal(await page.evaluate("document.querySelectorAll('form,input').length"),0);evidence('safe-link-'+encodeURIComponent(id),{html});await b.list();await b.detail(f.po.id);assert.equal(await page.evaluate('document.activeElement.id'),'detail-title');}
 }finally{await page.close();}});
});
test('B07 actual fully closed distinct gateway PIDs preserve durable browser identity definition and history after relogin',async()=>{
 await scenario('b07',async f=>{const b=await openBrowser(f),{page}=b;try{
  const before=await business(f),first=await childGateway(f);f.children.push(first);await b.signIn('manager',first.origin);await b.list(first.origin);await b.detail(f.po.id);const prior=await b.capture();await first.close();const second=await childGateway(f);f.children.push(second);assert.notEqual(first.pid,second.pid);await b.signIn('manager',second.origin);await b.list(second.origin);await b.detail(f.po.id);const restored=await b.capture();for(const key of ['summary','quantity','binding','approvals'])assert.deepEqual(restored.sections[key],prior.sections[key]);assert.ok(restored.sections.history.includes('purchaseCreate'));assert.deepEqual(await business(f),before);await page.screenshot('B07-real-gateway-restart');evidence('restart',{first:{pid:first.pid,origin:first.origin},second:{pid:second.pid,origin:second.origin},prior,restored,before,after:await business(f)});
 }finally{await page.close();}});
});
test('B08 captured public HTTP DOM screenshots and complete business snapshots prove read-only behavior',async()=>{
 await scenario('b08',async f=>{const b=await openBrowser(f),{page}=b;try{
  await b.signIn();await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`const captureFetch=window.fetch;window.allRequests=[];window.fetch=(...args)=>{window.allRequests.push({url:String(args[0]),method:args[1]?.method??'GET',body:args[1]?.body});return captureFetch(...args);};`});const before=await business(f);await b.list();await b.detail(f.po.id);await page.click('#reload');await page.until(visible(f.po.id));const dom=await b.capture(),requests=await page.evaluate('window.allRequests');assert.ok(requests.length);assert.ok(requests.every(x=>['/session','/enterprise/v2/rpc'].includes(x.url)));for(const row of requests.filter(x=>x.method==='POST')){assert.equal(row.url,'/enterprise/v2/rpc');const body=JSON.parse(row.body);assert.equal(body.packageId,'ENT-201');assert.equal(body.type,'ENT201Case');assert.ok(['query','get','inspect','history'].includes(body.operation));assert.equal(Object.hasOwn(body,'key'),false);}assert.ok(dom.http.some(x=>x.request.operation==='history'&&x.status===200));assert.deepEqual(await business(f),before);await page.screenshot('B08-public-read-only');evidence('observed-read-only',{requests,dom,before,after:await business(f),audit:await audit(f),browser:await page.send('Browser.getVersion'),executable:page.executable});
 }finally{await page.close();}});
});
