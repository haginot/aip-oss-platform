import test from 'node:test';
import assert from 'node:assert/strict';
import {scenario,evidence,ops,childGateway,ready,business,audit,grant,openBrowser,cleared} from '../../fixtures/enterprise/ENT-202-public-read-20261028/support.mjs';

test('public case browser Japanese keyboard real bindings history no financial controls and recoverable network error',()=>scenario('public-browser-positive',async f=>{
 const p=await ready(f);await f.approve(p.id);const before=await business(f),b=await openBrowser(f);const {page,signIn,list,detail,capture}=b;
 try{
  await signIn();await list();assert.equal(await page.evaluate('document.documentElement.lang'),'ja');assert.equal(await page.evaluate("document.querySelectorAll('#case-list a').length"),1);await detail(p.id);
  const dom=await capture();for(const value of [p.id,f.body.id,f.body.number,f.po.id,f.account.id,'台','独立全量検収','agent','operationId','invoice-payment','payloadDigest','objectRevision','EnterpriseCommand'])assert.ok(dom.text.includes(value),value);
  assert.match(dom.text,/"請求数量": 7/);assert.equal(await page.evaluate("document.activeElement.id"),'detail-title');assert.equal(await page.evaluate("document.querySelectorAll('form,input,textarea,select').length"),0);assert.equal(await page.evaluate("document.querySelectorAll('button').length"),1);
  const negatives=await page.evaluate(`(async()=>{const s=await(await fetch('/session')).json();const results=[];for(const [operation,body] of [['get',{id:'missing-case'}],['query',{id:'invalid-query'}],['dispatch',{id:${JSON.stringify(p.id)}}]]){const r=await fetch('/enterprise/v2/rpc',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrf},body:JSON.stringify({contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',operation,body})});results.push({operation,status:r.status,data:await r.json()});}return results;})()`);assert.deepEqual(negatives.map(x=>x.status),[404,400,400]);evidence('browser-api-negatives',negatives);const http=await page.evaluate('window.publicHttp');assert.ok(http.some(x=>x.request.operation==='history'&&x.status===200));assert.ok(http.filter(x=>x.status===200).every(x=>['query','get','inspect','history'].includes(x.request.operation)));assert.ok(http.find(x=>x.request.operation==='dispatch').data.error.code==='UNSUPPORTED_CAPABILITY');await page.screenshot('public-case-keyboard-detail');
  await page.evaluate(`window.failNext=true;const working=window.fetch;window.fetch=(...args)=>{if(window.failNext&&args[0]==='/enterprise/v2/rpc'){window.failNext=false;return Promise.reject(Error('test network interruption'));}return working(...args);}`);
  await page.click('#reload');await page.until("document.querySelector('#message').textContent.includes('取得できませんでした')");const failed=await capture();cleared(failed,[p.id,f.body.number,f.account.id]);await page.click('#reload');await page.until(`document.querySelector('#case-detail').dataset.id===${JSON.stringify(p.id)}`);
  assert.deepEqual(await business(f),before);evidence('browser-contract',{dom,failed,recovered:await capture(),before,after:await business(f),audit:await audit(f),browser:await page.send('Browser.getVersion'),executable:page.executable});
 }finally{await page.close();}
}));

for(const revocation of ['scope','classification','audit','session'])test('public case browser '+revocation+' revocation clears full DOM and restores after current login',()=>scenario('public-browser-'+revocation,async f=>{
 const p=await ready(f),b=await openBrowser(f),{page,signIn,list,detail,capture}=b;
 try{
  await signIn();await list();await detail(p.id);const beforeDom=await capture();
  if(revocation==='session'){
   const result=await page.evaluate(`(async()=>{const s=await(await fetch('/session')).json();const r=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrf},body:JSON.stringify({contractVersion:'2.0.0',operation:'logout',body:{},key:crypto.randomUUID()})});return r.status;})()`);assert.equal(result,200);
  }else await grant(f,'manager',revocation==='scope'?{scopes:[]}:revocation==='classification'?{fields:['PUBLIC','INTERNAL']}:{operations:ops.filter(x=>x!=='audit')});
  const before=await business(f);await page.click('#reload');await page.until("document.querySelector('#message').textContent.includes('参照できません')||document.querySelector('#message').textContent.includes('再ログイン')");const afterDom=await capture();cleared(afterDom,[p.id,f.body.id,f.body.number,f.po.id,f.account.id]);assert.deepEqual(await business(f),before);
  if(revocation!=='session')await grant(f);await signIn();await list();await detail(p.id);const restored=await capture();assert.ok(restored.text.includes(f.body.number));evidence('browser-revocation',{revocation,beforeDom,afterDom,restored,before,after:await business(f),audit:await audit(f)});
 }finally{await page.close();}
}));

test('public case browser delayed old successful response cannot repaint newer denial',()=>scenario('public-browser-race',async f=>{
 const p=await ready(f),{page,signIn,list,detail,capture}=await openBrowser(f);
 try{
  await signIn();await list();await detail(p.id);
  await page.evaluate(`const savedFetch=window.fetch;window.holdNext=true;window.fetch=async(...args)=>{const r=await savedFetch(...args);if(window.holdNext&&args[0]==='/enterprise/v2/rpc'&&JSON.parse(args[1].body).operation==='history'){window.holdNext=false;window.held=true;await new Promise(resolve=>window.releaseOld=resolve);}return r;};`);
  await page.click('#reload');await page.until('window.held===true');await grant(f,'manager',{scopes:[]});const before=await business(f);await page.click('#reload');await page.until("document.querySelector('#message').textContent.includes('参照できません')");await page.evaluate('window.releaseOld()');await page.evaluate('new Promise(resolve=>setTimeout(resolve,100))');const dom=await capture();cleared(dom,[p.id,f.body.number,f.po.id,f.account.id]);assert.deepEqual(await business(f),before);evidence('stale-response-denial',{dom,before,after:await business(f)});
 }finally{await page.close();}
}));

test('public case browser unknown route safely rejects and actual process restart relogin restores persisted case',()=>scenario('public-browser-restart',async f=>{
 const p=await ready(f),before=await business(f),{page,signIn,list,detail,capture}=await openBrowser(f);
 try{
  const first=await childGateway(f);f.children.push(first);await signIn('manager',first.origin);await list(first.origin);await detail(p.id);const prior=await capture();await first.close();
  const second=await childGateway(f);f.children.push(second);assert.notEqual(first.pid,second.pid);await signIn('manager',second.origin);await list(second.origin);await detail(p.id);const restored=await capture();assert.ok(restored.text.includes(f.body.number));for(const key of ['summary','quantity','binding','approvals'])assert.deepEqual(restored.sections[key],prior.sections[key]);assert.ok(restored.sections.history.includes('paymentRequest'));
  await page.navigate(second.origin+'/enterprise/cases/ENT-202/missing-case');await page.until("document.body.textContent.includes('NOT_FOUND')");const unknown=await page.evaluate('document.documentElement.outerHTML');for(const value of [p.id,f.body.number,f.account.id])assert.equal(unknown.includes(value),false);assert.equal(await page.evaluate("!!document.querySelector('form')"),false);
  await list(second.origin);await detail(p.id);assert.deepEqual(await business(f),before);evidence('browser-real-restart',{first:{pid:first.pid,origin:first.origin},second:{pid:second.pid,origin:second.origin},prior,restored,unknown,before,after:await business(f),audit:await audit(f),browser:await page.send('Browser.getVersion'),executable:page.executable});
 }finally{await page.close();}
}));

test('public case browser audit revocation during history composition clears all retained DOM before disclosure',()=>scenario('public-browser-audit-release',async f=>{
 const p=await ready(f),{page,signIn,list,detail,capture}=await openBrowser(f),native=f.env.f.kernel.enterprise.bind(f.env.f.kernel);let armed=false,afterGrant;
 try{
  await signIn();await list();await detail(p.id);const beforeDom=await capture();armed=true;
  f.env.f.kernel.enterprise=async(...args)=>{const result=await native(...args);if(armed&&args[1].operation==='invoiceAudit'){armed=false;await grant(f,'manager',{operations:ops.filter(x=>x!=='audit')});afterGrant=await business(f);}return result;};
  await page.click('#reload');await page.until("document.querySelector('#message').textContent.includes('再ログイン')");const afterDom=await capture();cleared(afterDom,[p.id,f.body.id,f.body.number,f.po.id,f.account.id]);assert.ok(afterDom.http.some(x=>x.request.operation==='history'&&x.status===403));assert.deepEqual(await business(f),afterGrant);evidence('browser-audit-final-authorization',{beforeDom,afterDom,afterGrant,audit:await audit(f)});
 }finally{f.env.f.kernel.enterprise=native;await page.close();}
}));

import {browserRestriction} from '../../fixtures/enterprise/ENT-202-public-read-20261028/bpr-01-support.mjs';
for(const point of ['paymentRead','paymentAccountRead'])test('BPR-01 browser payment-only classification after second '+point+' denies inspect and clears retained DOM',()=>scenario('bpr01-browser-'+point,f=>browserRestriction(f,point)));
