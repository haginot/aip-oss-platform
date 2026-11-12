import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {scenario,evidence,pending,ok,business,grant,ops,childGateway,vote} from '../../fixtures/enterprise/ENT-202-public-cancel-20261028/support.mjs';
import {screen,cleared,enter} from '../../fixtures/enterprise/ENT-202-public-cancel-20261028/browser-support.mjs';

test('public cancellation Japanese keyboard validation recovery and explicit cancel releases without send',()=>scenario('cancel-browser-positive',async f=>{
 const p=await pending(f),before=await business(f);await screen(f,'positive',async s=>{
  assert.equal(await s.page.evaluate('document.documentElement.lang'),'ja');await s.page.click('#cancel');assert.equal((await s.capture()).http.some(x=>x.request.operation==='cancel'),false);await s.select(p.id);await s.fill('bad key');await enter(s.page,'#cancel');await s.page.until("document.querySelector('#message').textContent.includes('下書きは保持')");const invalid=await s.capture();assert.equal(invalid.controls.find(x=>x.id==='purpose').value,'請求・数量確認');assert.deepEqual(await business(f),before);
  await s.fill(randomUUID());await enter(s.page,'#cancel');await s.page.until("!document.querySelector('#result').hidden");const result=await s.capture();assert.equal(await s.page.evaluate('document.activeElement.id'),'result-title');assert.ok(result.http.some(x=>x.request.operation==='cancel'&&x.status===200));const view=await ok(f,'get',{id:p.id});assert.equal(view.workflow.state,'CANCELLED');assert.equal(view.payment.reservation,'RELEASED');assert.ok(result.source.includes(f.body.id));assert.ok(result.source.includes('7 台'));assert.ok(result.source.includes('状態: 取消済み'));assert.ok(result.summary.includes('予約: 解放済み'));assert.equal(result.controls.find(x=>x.id==='purpose').value,'請求・数量確認');assert.equal(f.env.payments.requests().length,0);evidence('keyboard',{invalid,result,before,after:await business(f)});
 });
}));
for(const state of ['RETURNED','READY'])test('public cancellation browser '+state+' shows current cancellation and existing votes',()=>scenario('cancel-browser-state-'+state,async f=>{
 const p=await pending(f);if(state==='RETURNED')await vote(f,p.id,'manager','return');else for(const actor of ['manager','reviewer','publisher'])await vote(f,p.id,actor);
 await screen(f,state,async s=>{await s.select(p.id);await s.fill(randomUUID());await enter(s.page,'#cancel');await s.page.until("!document.querySelector('#result').hidden");const view=await ok(f,'get',{id:p.id}),dom=await s.capture();assert.equal(view.workflow.state,'CANCELLED');assert.equal(view.payment.reservation,'RELEASED');assert.ok(dom.source.includes('状態: 取消済み'));assert.ok(dom.source.includes('manager（'+(state==='RETURNED'?'差戻し':'承認')));assert.equal(f.env.payments.requests().length,0);evidence('state',{state,view,dom});});
}));
for(const kind of ['scope','classification','session'])test('public cancel browser '+kind+' clears retained list references and every draft',()=>scenario('cancel-browser-clear-'+kind,async f=>{
 const p=await pending(f),key=randomUUID();await screen(f,kind,async s=>{await s.select(p.id);await s.fill(key);
 if(kind==='session')await s.page.evaluate(`(async()=>fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':(await (await fetch('/session')).json()).csrf},body:JSON.stringify({contractVersion:'2.0.0',operation:'logout',body:{},key:crypto.randomUUID()})}))()`);else await grant(f,'operator',kind==='scope'?{scopes:[]}:{fields:['PUBLIC','INTERNAL']});
 const before=await business(f);await s.page.click('#refresh');await s.page.until("document.querySelector('#message').textContent.includes('入力を消去')");const dom=await s.capture();cleared(dom,[p.id,f.body.id,f.account.id,key,f.body.number]);assert.deepEqual(await business(f),before);evidence('clear',{kind,dom,before,after:await business(f)});
 });
}));

for(const kind of ['scope','classification'])for(const action of ['refresh','cancel'])test('PS-R1 public cancellation '+kind+' '+action+' denial clears even after actual input',()=>scenario('cancel-browser-PS-R1-'+kind+'-'+action,async f=>{
 const p=await pending(f),key=randomUUID();await screen(f,'PS-R1-'+kind+'-'+action,async s=>{
  await s.select(p.id);await s.fill(key);await grant(f,'operator',kind==='scope'?{scopes:[]}:{fields:['PUBLIC','INTERNAL']});const before=await business(f);
  await s.page.evaluate(`window.denialHeld=false;window.denialDelivered=false;window.releaseDenial=null;const prior=window.fetch;window.fetch=async(...args)=>{if(window.denialHeld&&!window.denialDelivered)throw TypeError('intervening refresh unavailable');const r=await prior(...args);if(!window.denialHeld&&[403,404].includes(r.status)){window.denialHeld=true;window.denialStatus=r.status;await new Promise(resolve=>window.releaseDenial=resolve);const json=r.json.bind(r);r.json=async()=>{const v=await json();setTimeout(()=>window.denialDelivered=true,0);return v;};}return r;};`);
  await s.page.click('#'+action);await s.page.until('window.denialHeld');assert.equal(await s.page.evaluate('window.denialStatus'),kind==='scope'?404:403);
  await s.page.evaluate("window.inputEvents=0;document.querySelector('#purpose').addEventListener('input',()=>window.inputEvents++);document.querySelector('#purpose').focus();document.querySelector('#purpose').select()");await s.page.send('Input.insertText',{text:'入力途中の訂正'});assert.equal(await s.page.evaluate('window.inputEvents'),1);await s.page.evaluate('window.releaseDenial()');await s.page.until('window.denialDelivered');const dom=await s.capture();cleared(dom,[p.id,f.body.id,f.account.id,key]);assert.deepEqual(await business(f),before);evidence('PS-R1',{kind,action,dom,before,after:await business(f)});
 });
}));

test('public cancellation readable nonapplicant refusal keeps authorized draft without cancellation',()=>scenario('cancel-browser-self',async f=>{
 const p=await pending(f,'manager','operator'),key=randomUUID(),before=await business(f);await screen(f,'self',async s=>{await s.select(p.id);await s.fill(key);await s.page.click('#cancel');await s.page.until("document.querySelector('#message').textContent.includes('下書きは保持')");const dom=await s.capture();assert.equal(dom.hidden,false);assert.ok(dom.identity);assert.equal(dom.controls.find(x=>x.id==='request-key').value,key);assert.equal(dom.controls.find(x=>x.id==='purpose').value,'請求・数量確認');assert.ok(dom.http.some(x=>x.request.operation==='cancel'&&x.status===400));assert.deepEqual(await business(f),before);evidence('self',{dom,before,after:await business(f)});},'manager');
}));

test('public cancellation late committed success cannot repaint after revoked read clears page',()=>scenario('cancel-browser-late',async f=>{
 const p=await pending(f),key=randomUUID();await screen(f,'late',async s=>{await s.select(p.id);await s.fill(key);
 await s.page.evaluate(`const prior=window.fetch;window.held=false;window.releaseResponse=null;window.fetch=async(...args)=>{const r=await prior(...args);if(args[0]==='/enterprise/v2/rpc'&&JSON.parse(args[1].body).operation==='cancel'){window.held=true;await new Promise(resolve=>window.releaseResponse=resolve);}return r;};`);
 await s.page.click('#cancel');await s.page.until('window.held');await grant(f,'operator',{scopes:[]});await s.page.click('#refresh');await s.page.until("document.querySelector('#message').textContent.includes('入力を消去')");await s.page.evaluate('window.releaseResponse()');await s.page.until("!document.querySelector('#cancel').disabled");cleared(await s.capture(),[p.id,f.body.id,f.account.id,key]);assert.equal((await ok(f,'get',{id:p.id},'manager')).workflow.state,'CANCELLED');evidence('late',{dom:await s.capture(),business:await business(f)});
 });
}));

test('public cancellation lost response explicit identical retry creates one cancellation and reload never posts',()=>scenario('cancel-browser-loss',async f=>{
 const p=await pending(f),key=randomUUID();await screen(f,'loss',async s=>{await s.select(p.id);await s.fill(key);await s.page.evaluate(`const prior=window.fetch;let armed=true;window.fetch=async(...args)=>{const r=await prior(...args);if(armed&&args[0]==='/enterprise/v2/rpc'&&JSON.parse(args[1].body).operation==='cancel'){armed=false;throw TypeError('synthetic response loss');}return r;};`);
 await s.page.click('#cancel');await s.page.until("document.querySelector('#message').textContent.includes('下書きは保持')");const before=await business(f);await s.page.click('#cancel');await s.page.until("!document.querySelector('#result').hidden");assert.deepEqual(await business(f),before);const dom=await s.capture(),rows=dom.http.filter(x=>x.request.operation==='cancel');assert.equal(rows.length,2);assert.deepEqual(rows[0].request,rows[1].request);await s.open();assert.equal((await s.capture()).http.some(x=>['cancel'].includes(x.request.operation)),false);assert.equal((await ok(f,'get',{id:p.id},'manager')).workflow.state,'CANCELLED');evidence('loss',{dom,before,after:await business(f)});
 });
}));

test('public cancellation browser actual restart and relogin needs explicit same original key replay',()=>scenario('cancel-browser-restart',async f=>{
 const p=await pending(f),key=randomUUID(),first=await childGateway(f);f.children.push(first);await screen(f,'restart',async s=>{await s.signIn('operator',first.origin);await s.open(first.origin);await s.select(p.id);await s.fill(key);await s.page.click('#cancel');await s.page.until("!document.querySelector('#result').hidden");await first.close();const second=await childGateway(f);f.children.push(second);assert.notEqual(first.pid,second.pid);await s.signIn('operator',second.origin);await s.open(second.origin);await s.select(p.id);await s.fill(key);const before=await business(f);await s.page.click('#cancel');await s.page.until("!document.querySelector('#result').hidden");assert.deepEqual(await business(f),before);evidence('restart',{first:{pid:first.pid,origin:first.origin},second:{pid:second.pid,origin:second.origin},dom:await s.capture(),before,after:await business(f)});});
}));

for(const point of ['paymentRead','paymentAccountRead'])test('BPR-01 cancel screen '+point+' final policy release clears all references',()=>scenario('cancel-browser-BPR01-'+point,async f=>{
 const p=await pending(f),key=randomUUID();await screen(f,'BPR01-'+point,async s=>{await s.select(p.id);await s.fill(key);const {armRestriction}=await import('../../fixtures/enterprise/ENT-202-public-read-20261028/bpr-01-support.mjs'),gate=armRestriction(f,p,point);
 try{await s.page.click('#refresh');await s.page.until("document.querySelector('#message').textContent.includes('入力を消去')");assert.ok(gate.change);const dom=await s.capture();cleared(dom,[p.id,f.body.id,f.account.id,key]);assert.deepEqual(await business(f),gate.change.after);evidence('BPR01',{point,change:gate.change,dom,after:await business(f)});}finally{gate.restore();}
 });
}));

for(const kind of ['scope','classification'])test('public cancellation delayed readable action denial rechecks '+kind+' before keeping draft',()=>scenario('cancel-browser-write-denial-'+kind,async f=>{
 const p=await pending(f),key=randomUUID();await grant(f,'operator',{operations:ops.filter(x=>x!=='action')});await screen(f,'write-denial-'+kind,async s=>{await s.select(p.id);await s.fill(key);await s.page.evaluate(`window.held=false;window.releaseResponse=null;const prior=window.fetch;window.fetch=async(...args)=>{const r=await prior(...args);if(args[0]==='/enterprise/v2/rpc'&&JSON.parse(args[1].body).operation==='cancel'){window.held=true;await new Promise(resolve=>window.releaseResponse=resolve);}return r;};`);
 await s.page.click('#cancel');await s.page.until('window.held');await grant(f,'operator',kind==='scope'?{scopes:[]}:{fields:['PUBLIC','INTERNAL']});const before=await business(f);await s.page.evaluate('window.releaseResponse()');await s.page.until("document.querySelector('#message').textContent.includes('入力を消去')");const dom=await s.capture();cleared(dom,[p.id,f.body.id,f.account.id,key]);assert.deepEqual(await business(f),before);evidence('write-denial',{kind,dom,before,after:await business(f)});
 });
}));


for(const kind of ['scope','classification','unavailable','late'])test('post cancellation inspection '+kind+' never exposes stale state',()=>scenario('cancel-browser-B1-post-'+kind,async f=>{
 const p=await pending(f),key=randomUUID();await screen(f,'B1-post-'+kind,async s=>{await s.select(p.id);await s.fill(key);
 await s.page.evaluate(`window.cancelCommitted=false;window.postHeld=false;window.releasePost=null;const prior=window.fetch;window.fetch=async(...args)=>{const op=args[0]==='/enterprise/v2/rpc'?JSON.parse(args[1].body).operation:null;if(op==='inspect'&&window.cancelCommitted){const held=${JSON.stringify(kind)}==='late'?await prior(...args):null;window.postHeld=true;await new Promise(resolve=>window.releasePost=resolve);if(${JSON.stringify(kind)}==='unavailable')throw TypeError('synthetic post cancellation read loss');if(held)return held;}const r=await prior(...args);if(op==='cancel'&&r.ok)window.cancelCommitted=true;return r;};`);
 await s.page.click('#cancel');await s.page.until('window.postHeld');const pendingDom=await s.capture();assert.equal(pendingDom.hidden,true);assert.equal(pendingDom.source,'');assert.equal(pendingDom.href,null);assert.deepEqual(pendingDom.datasets,[]);
 if(kind==='scope'||kind==='classification')await grant(f,'operator',kind==='scope'?{scopes:[]}:{fields:['PUBLIC','INTERNAL']});
 if(kind==='late'){await grant(f,'operator',{scopes:[]});await s.page.click('#refresh');await s.page.until("document.querySelector('#message').textContent.includes('入力を消去')");}
 await s.page.evaluate('window.releasePost()');await s.page.until("!document.querySelector('#cancel').disabled");const dom=await s.capture();evidence('B1-post',{kind,dom,pendingDom,business:await business(f)});
 if(kind==='unavailable'){assert.equal(dom.hidden,true);assert.equal(dom.source,'');assert.equal(dom.resultHidden,true);assert.equal(dom.controls.find(x=>x.id==='request-key').value,key);assert.equal(dom.controls.find(x=>x.id==='purpose').value,'請求・数量確認');}else cleared(dom,[p.id,f.body.id,f.account.id,key]);assert.equal((await ok(f,'get',{id:p.id},'manager')).workflow.state,'CANCELLED');
 });
}));
