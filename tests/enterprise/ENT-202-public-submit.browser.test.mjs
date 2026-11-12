import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {scenario,ready,evidence,business,grant,ops,ok,childGateway} from '../../fixtures/enterprise/ENT-202-public-submit-20261028/support.mjs';
import {screen,cleared} from '../../fixtures/enterprise/ENT-202-public-submit-20261028/browser-support.mjs';

test('public submit Japanese keyboard validation draft recovery and same-ID public detail with no send',()=>scenario('submit-browser-positive',async f=>{
 const b=await ready(f),key=randomUUID(),before=await business(f);await screen(f,async s=>{
  const {page}=s;await s.fill({...b,revision:b.revision+1},key);assert.equal(await page.evaluate('document.documentElement.lang'),'ja');await page.click('#check');await page.until("!document.querySelector('#references').hidden");assert.match((await s.capture()).source,/MATCHED/);
  await page.evaluate("document.querySelector('#submit').focus()");await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await page.until("document.querySelector('#message').textContent.includes('現在版')");const draft=await s.capture();assert.equal(draft.controls.find(x=>x.id==='payment-id').value,b.id);assert.equal(draft.controls.find(x=>x.id==='request-key').value,key);assert.deepEqual(await business(f),before);
  await page.fill('#revision',String(b.revision));await page.click('#submit');await page.until("document.querySelector('#message').textContent.includes('内容が変わ')");assert.deepEqual(await business(f),before);await page.fill('#request-key',randomUUID());await page.click('#submit');await page.until("!document.querySelector('#result').hidden");const submitted=await s.capture();assert.match(submitted.summary,new RegExp(b.id));assert.equal(await page.evaluate('document.activeElement.id'),'result-title');assert.ok(submitted.http.some(x=>x.request.operation==='submit'&&x.status===200));await page.click('#lookup');await page.until("document.querySelector('#summary').textContent.includes('caseId')");assert.equal((await ok(f,'get',{id:b.id})).id,b.id);
  await page.click('#detail');await page.until("document.querySelector('#message')?.textContent.includes('参照権限を確認できません')");const applicantDenied=await page.evaluate('document.documentElement.outerHTML');for(const secret of [b.id,f.body.id,f.account.id])assert.equal(applicantDenied.includes(secret),false);
  await s.signIn(f.env.gateway.origin,'manager');await page.navigate(f.env.gateway.origin+'/enterprise/cases/ENT-202/'+b.id);await page.until(`document.querySelector('#case-detail')?.dataset.id===${JSON.stringify(b.id)}`);const detail=await page.evaluate('document.body.textContent');assert.ok(detail.includes(b.id));assert.ok(detail.includes(f.body.id));assert.ok(detail.includes(f.account.id));evidence('keyboard-detail',{draft,submitted,applicantDenied,detail});
 });const after=await business(f);assert.equal(after.tables.enterprise_invoice.filter(x=>x.id===b.id).length,1);assert.deepEqual(after.paymentRequests,before.paymentRequests);assert.deepEqual(after.orderRequests,before.orderRequests);evidence('browser-business',{before,after});
}));

for(const kind of ['scope','classification','session','action'])test('public submit browser '+kind+' revocation clears every protected DOM and form control',()=>scenario('submit-browser-clear-'+kind,async f=>{
 const b=await ready(f),key=randomUUID();await screen(f,async s=>{
  await s.fill(b,key);await s.page.click('#check');await s.page.until("!document.querySelector('#references').hidden");
  if(kind==='session')await s.page.evaluate(`(async()=>fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':(await (await fetch('/session')).json()).csrf},body:JSON.stringify({contractVersion:'2.0.0',operation:'logout',body:{},key:crypto.randomUUID()})}))()`);
  else await grant(f,'operator',kind==='scope'?{scopes:[]}:kind==='classification'?{fields:['PUBLIC','INTERNAL']}:{operations:ops.filter(x=>x!=='action')});
  if(kind==='action')await s.page.click('#submit');else await s.page.click('#refresh');await s.page.until("document.querySelector('#message').textContent.includes('消去')");const dom=await s.capture();cleared(dom,[b.id,b.invoiceId,b.accountId,key,f.body.number]);assert.equal((await business(f)).tables.enterprise_invoice.some(x=>x.id===b.id),false);evidence('cleared',dom);
 });
}));

test('public submit browser delayed response cannot repaint after a newer denied authorization check',()=>scenario('submit-browser-late',async f=>{
 const b=await ready(f),key=randomUUID();await screen(f,async s=>{
  await s.fill(b,key);
  await s.page.evaluate(`window.priorFetch=window.fetch;window.releaseResponse=null;window.held=false;window.fetch=async(...args)=>{const r=await window.priorFetch(...args);if(args[0]==='/enterprise/v2/rpc'&&JSON.parse(args[1].body).operation==='submit'){window.held=true;await new Promise(resolve=>window.releaseResponse=resolve);}return r;}`);
  await s.page.click('#submit');await s.page.until('window.held');await grant(f,'operator',{scopes:[]});await s.page.click('#refresh');await s.page.until("document.querySelector('#message').textContent.includes('消去')");await s.page.evaluate('window.releaseResponse()');await s.page.until("!document.querySelector('#submit').disabled");cleared(await s.capture(),[b.id,b.invoiceId,b.accountId,key]);assert.equal((await business(f)).tables.enterprise_invoice.filter(x=>x.id===b.id).length,1);evidence('late-response',await s.capture());
 });
}));

test('public submit browser lost response preserves explicit same-body retry and reload never automatically posts',()=>scenario('submit-browser-loss',async f=>{
 const b=await ready(f),key=randomUUID();await screen(f,async s=>{
  await s.fill(b,key);await s.page.evaluate(`const prior=window.fetch;let armed=true;window.fetch=async(...args)=>{const r=await prior(...args);if(armed&&args[0]==='/enterprise/v2/rpc'&&JSON.parse(args[1].body).operation==='submit'){armed=false;throw TypeError('synthetic response loss');}return r;};`);
  await s.page.click('#submit');await s.page.until("document.querySelector('#message').textContent.includes('下書き')");const lost=await s.capture();assert.equal(lost.controls.find(x=>x.id==='request-key').value,key);const before=await business(f);await s.page.click('#submit');await s.page.until("!document.querySelector('#result').hidden");assert.deepEqual(await business(f),before);const after=await s.capture(),requests=after.http.filter(x=>x.request.operation==='submit');assert.equal(requests.length,2);assert.deepEqual(requests[0].request,requests[1].request);
  await s.open();assert.equal((await s.capture()).http.filter(x=>x.request.operation==='submit').length,0);assert.ok((await s.capture()).controls.every(x=>x.value===''));assert.deepEqual(await business(f),before);evidence('response-loss',{lost,after,before,final:await business(f)});
 });
}));

test('public submit browser actual restart and relogin require explicit same key resubmission',()=>scenario('submit-browser-restart',async f=>{
 const b=await ready(f),key=randomUUID(),first=await childGateway(f);f.children.push(first);await screen(f,async s=>{
  await s.signIn(first.origin);await s.open(first.origin);await s.fill(b,key);await s.page.click('#submit');await s.page.until("!document.querySelector('#result').hidden");await first.close();const second=await childGateway(f);f.children.push(second);assert.notEqual(first.pid,second.pid);await s.signIn(second.origin);await s.open(second.origin);assert.equal((await s.capture()).http.length,0);const before=await business(f);await s.fill(b,key);await s.page.click('#submit');await s.page.until("!document.querySelector('#result').hidden");assert.deepEqual(await business(f),before);evidence('restart',{first:{pid:first.pid,origin:first.origin},second:{pid:second.pid,origin:second.origin},dom:await s.capture(),before,after:await business(f)});
 });
}));

// PS-R1: editing a draft must invalidate stale successes, never discard a
// real authorization denial already received by the same page/session.
for(const kind of ['classification','scope'])for(const action of ['refresh','submit','lookup'])test('PS-R1 public submit '+kind+' denied '+action+' clears draft even after an intervening input',()=>scenario('submit-browser-PS-R1-'+kind+'-'+action,async f=>{
 const b=await ready(f),key=randomUUID();await screen(f,async s=>{
  await s.fill(b,key);if(action==='lookup'){await s.page.click('#submit');await s.page.until("!document.querySelector('#result').hidden");}
  await s.page.click('#check');await s.page.until("!document.querySelector('#references').hidden");const visible=await s.capture();assert.ok(visible.identity);assert.ok(visible.source.includes(b.invoiceId));
  await grant(f,'operator',kind==='scope'?{scopes:[]}:{fields:['PUBLIC','INTERNAL']});const before=await business(f);
  await s.page.evaluate(`window.denialHeld=false;window.denialDelivered=false;window.releaseDenial=null;const originalFetch=window.fetch;window.fetch=async(...args)=>{const r=await originalFetch(...args);if(!window.denialHeld&&[403,404].includes(r.status)){window.denialHeld=true;window.denialStatus=r.status;await new Promise(resolve=>window.releaseDenial=resolve);const json=r.json.bind(r);r.json=async()=>{const value=await json();setTimeout(()=>window.denialDelivered=true,0);return value;};}return r;};`);
  await s.page.click('#'+action);await s.page.until('window.denialHeld');assert.equal(await s.page.evaluate('window.denialStatus'),kind==='scope'?404:403);
  await s.page.evaluate("window.inputEvents=0;document.querySelector('#amount').addEventListener('input',()=>window.inputEvents++);document.querySelector('#amount').focus();document.querySelector('#amount').select();");await s.page.send('Input.insertText',{text:String(b.amount-1)});assert.equal(await s.page.evaluate('window.inputEvents'),1);const edited=await s.capture();assert.equal(edited.controls.find(x=>x.id==='amount').value,String(b.amount-1));assert.ok(edited.identity);
  await s.page.evaluate('window.releaseDenial()');await s.page.until('window.denialDelivered');const denied=await s.capture();evidence('PS-R1',{kind,action,visible,edited,denied,before,after:await business(f)});
  assert.deepEqual(await business(f),before);assert.ok(denied.http.some(x=>x.status===(kind==='scope'?404:403)));cleared(denied,[b.id,b.invoiceId,b.accountId,key,f.body.number]);assert.match(denied.text,/入力を消去/);
 });
}));
