import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {scenario,evidence,pending,ok,business,grant,ops,childGateway,vote} from '../../fixtures/enterprise/ENT-202-public-approve-20261028/support.mjs';
import {screen,cleared,enter} from '../../fixtures/enterprise/ENT-202-public-approve-20261028/browser-support.mjs';

test('public approval Japanese keyboard current case inspection validation recovery and explicit approval without send',()=>scenario('approve-browser-positive',async f=>{
 const p=await pending(f),before=await business(f);await screen(f,'positive',async s=>{
  assert.equal(await s.page.evaluate('document.documentElement.lang'),'ja');await s.page.click('#approve');assert.equal((await s.capture()).http.some(x=>x.request.operation==='approve'),false);await s.select(p.id);await s.fill(randomUUID());await s.page.fill('#revision','2');await enter(s.page,'#approve');await s.page.until("document.querySelector('#message').textContent.includes('現在版を確認')");const invalid=await s.capture();assert.equal(invalid.controls.find(x=>x.id==='purpose').value,'請求・数量確認');assert.deepEqual(await business(f),before);
  await s.page.fill('#revision','1');await s.page.fill('#request-key',randomUUID());await enter(s.page,'#approve');await s.page.until("!document.querySelector('#result').hidden");const result=await s.capture();assert.equal(await s.page.evaluate('document.activeElement.id'),'result-title');assert.ok(result.http.some(x=>x.request.operation==='approve'&&x.status===200));assert.equal((await ok(f,'get',{id:p.id})).workflow.votes.length,1);assert.ok(result.source.includes(f.body.id));assert.ok(result.source.includes('台'));assert.ok(result.source.includes('manager（承認・段階 1）'));assert.equal(result.source.includes('未投票'),false);assert.ok(result.source.includes('状態: 承認待ち'));assert.equal(result.controls.find(x=>x.id==='purpose').value,'請求・数量確認');assert.equal(f.env.payments.requests().length,0);evidence('keyboard',{invalid,result,before,after:await business(f)});
 });
}));

test('public return browser retains HELD and does not dispatch',()=>scenario('approve-browser-return',async f=>{
 const p=await pending(f);await screen(f,'return',async s=>{await s.select(p.id);await s.fill(randomUUID());await enter(s.page,'#return');await s.page.until("!document.querySelector('#result').hidden");const view=await ok(f,'get',{id:p.id});assert.equal(view.workflow.state,'RETURNED');assert.equal(view.payment.reservation,'HELD');assert.equal(f.env.payments.requests().length,0);const dom=await s.capture();evidence('returned',{view,dom});assert.equal(dom.hidden,false);assert.ok(dom.source.includes('状態: 差戻し'));assert.ok(dom.source.includes('承認段階: 差戻し'));assert.ok(dom.source.includes('manager（差戻し・段階 1）'));assert.equal(dom.source.includes('未投票'),false);assert.equal(dom.controls.find(x=>x.id==='purpose').value,'請求・数量確認');});
}));

for(const kind of ['scope','classification','session'])test('public approve browser '+kind+' clears retained list references and every draft',()=>scenario('approve-browser-clear-'+kind,async f=>{
 const p=await pending(f),key=randomUUID();await screen(f,kind,async s=>{await s.select(p.id);await s.fill(key);
 if(kind==='session')await s.page.evaluate(`(async()=>fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':(await (await fetch('/session')).json()).csrf},body:JSON.stringify({contractVersion:'2.0.0',operation:'logout',body:{},key:crypto.randomUUID()})}))()`);else await grant(f,'manager',kind==='scope'?{scopes:[]}:{fields:['PUBLIC','INTERNAL']});
 const before=await business(f);await s.page.click('#refresh');await s.page.until("document.querySelector('#message').textContent.includes('入力を消去')");const dom=await s.capture();cleared(dom,[p.id,f.body.id,f.account.id,key,f.body.number]);assert.deepEqual(await business(f),before);evidence('clear',{kind,dom,before,after:await business(f)});
 });
}));

for(const kind of ['scope','classification'])for(const action of ['refresh','approve','return'])test('PS-R1 public approval '+kind+' '+action+' denial clears even after actual input',()=>scenario('approve-browser-PS-R1-'+kind+'-'+action,async f=>{
 const p=await pending(f),key=randomUUID();await screen(f,'PS-R1-'+kind+'-'+action,async s=>{
  await s.select(p.id);await s.fill(key);await grant(f,'manager',kind==='scope'?{scopes:[]}:{fields:['PUBLIC','INTERNAL']});const before=await business(f);
  await s.page.evaluate(`window.denialHeld=false;window.denialDelivered=false;window.releaseDenial=null;const prior=window.fetch;window.fetch=async(...args)=>{if(window.denialHeld&&!window.denialDelivered)throw TypeError('intervening refresh unavailable');const r=await prior(...args);if(!window.denialHeld&&[403,404].includes(r.status)){window.denialHeld=true;window.denialStatus=r.status;await new Promise(resolve=>window.releaseDenial=resolve);const json=r.json.bind(r);r.json=async()=>{const v=await json();setTimeout(()=>window.denialDelivered=true,0);return v;};}return r;};`);
  await s.page.click('#'+action);await s.page.until('window.denialHeld');assert.equal(await s.page.evaluate('window.denialStatus'),kind==='scope'?404:403);
  await s.page.evaluate("window.inputEvents=0;document.querySelector('#purpose').addEventListener('input',()=>window.inputEvents++);document.querySelector('#purpose').focus();document.querySelector('#purpose').select()");await s.page.send('Input.insertText',{text:'入力途中の訂正'});assert.equal(await s.page.evaluate('window.inputEvents'),1);await s.page.evaluate('window.releaseDenial()');await s.page.until('window.denialDelivered');const dom=await s.capture();cleared(dom,[p.id,f.body.id,f.account.id,key]);assert.deepEqual(await business(f),before);evidence('PS-R1',{kind,action,dom,before,after:await business(f)});
 });
}));

test('public approval readable self approval refusal keeps authorized draft and never votes',()=>scenario('approve-browser-self',async f=>{
 const p=await pending(f,'manager','operator'),key=randomUUID(),before=await business(f);await screen(f,'self',async s=>{await s.select(p.id);await s.fill(key);await s.page.click('#approve');await s.page.until("document.querySelector('#message').textContent.includes('下書きは保持')");const dom=await s.capture();assert.equal(dom.hidden,false);assert.ok(dom.identity);assert.equal(dom.controls.find(x=>x.id==='request-key').value,key);assert.equal(dom.controls.find(x=>x.id==='purpose').value,'請求・数量確認');assert.ok(dom.http.some(x=>x.request.operation==='approve'&&x.status===403));assert.deepEqual(await business(f),before);evidence('self',{dom,before,after:await business(f)});});
}));

test('public approval late committed success cannot repaint after revoked read clears page',()=>scenario('approve-browser-late',async f=>{
 const p=await pending(f),key=randomUUID();await screen(f,'late',async s=>{await s.select(p.id);await s.fill(key);
 await s.page.evaluate(`const prior=window.fetch;window.held=false;window.releaseResponse=null;window.fetch=async(...args)=>{const r=await prior(...args);if(args[0]==='/enterprise/v2/rpc'&&JSON.parse(args[1].body).operation==='approve'){window.held=true;await new Promise(resolve=>window.releaseResponse=resolve);}return r;};`);
 await s.page.click('#approve');await s.page.until('window.held');await grant(f,'manager',{scopes:[]});await s.page.click('#refresh');await s.page.until("document.querySelector('#message').textContent.includes('入力を消去')");await s.page.evaluate('window.releaseResponse()');await s.page.until("!document.querySelector('#approve').disabled");cleared(await s.capture(),[p.id,f.body.id,f.account.id,key]);assert.equal((await f.payment(p.id)).workflow.votes.length,1);evidence('late',{dom:await s.capture(),business:await business(f)});
 });
}));

test('public approval lost response explicit identical retry creates one vote and reload never posts',()=>scenario('approve-browser-loss',async f=>{
 const p=await pending(f),key=randomUUID();await screen(f,'loss',async s=>{await s.select(p.id);await s.fill(key);await s.page.evaluate(`const prior=window.fetch;let armed=true;window.fetch=async(...args)=>{const r=await prior(...args);if(armed&&args[0]==='/enterprise/v2/rpc'&&JSON.parse(args[1].body).operation==='approve'){armed=false;throw TypeError('synthetic response loss');}return r;};`);
 await s.page.click('#approve');await s.page.until("document.querySelector('#message').textContent.includes('下書きは保持')");const before=await business(f);await s.page.click('#approve');await s.page.until("!document.querySelector('#result').hidden");assert.deepEqual(await business(f),before);const dom=await s.capture(),rows=dom.http.filter(x=>x.request.operation==='approve');assert.equal(rows.length,2);assert.deepEqual(rows[0].request,rows[1].request);await s.open();assert.equal((await s.capture()).http.some(x=>['approve','return'].includes(x.request.operation)),false);assert.equal((await f.payment(p.id)).workflow.votes.length,1);evidence('loss',{dom,before,after:await business(f)});
 });
}));

test('public approval browser actual restart and relogin needs explicit same original key replay',()=>scenario('approve-browser-restart',async f=>{
 const p=await pending(f),key=randomUUID(),first=await childGateway(f);f.children.push(first);await screen(f,'restart',async s=>{await s.signIn('manager',first.origin);await s.open(first.origin);await s.select(p.id);await s.fill(key);await s.page.click('#approve');await s.page.until("!document.querySelector('#result').hidden");await first.close();const second=await childGateway(f);f.children.push(second);assert.notEqual(first.pid,second.pid);await s.signIn('manager',second.origin);await s.open(second.origin);await s.select(p.id);await s.fill(key);const before=await business(f);await s.page.click('#approve');await s.page.until("!document.querySelector('#result').hidden");assert.deepEqual(await business(f),before);evidence('restart',{first:{pid:first.pid,origin:first.origin},second:{pid:second.pid,origin:second.origin},dom:await s.capture(),before,after:await business(f)});});
}));

for(const point of ['paymentRead','paymentAccountRead'])test('BPR-01 approval screen '+point+' final policy release clears all references',()=>scenario('approve-browser-BPR01-'+point,async f=>{
 const p=await pending(f),key=randomUUID();await screen(f,'BPR01-'+point,async s=>{await s.select(p.id);await s.fill(key);const {armRestriction}=await import('../../fixtures/enterprise/ENT-202-public-read-20261028/bpr-01-support.mjs'),gate=armRestriction(f,p,point);
 try{await s.page.click('#refresh');await s.page.until("document.querySelector('#message').textContent.includes('入力を消去')");assert.ok(gate.change);const dom=await s.capture();cleared(dom,[p.id,f.body.id,f.account.id,key]);assert.deepEqual(await business(f),gate.change.after);evidence('BPR01',{point,change:gate.change,dom,after:await business(f)});}finally{gate.restore();}
 });
}));

for(const kind of ['scope','classification'])test('public approval delayed readable vote denial rechecks '+kind+' before keeping draft',()=>scenario('approve-browser-write-denial-'+kind,async f=>{
 const p=await pending(f,'manager','operator'),key=randomUUID();await screen(f,'write-denial-'+kind,async s=>{await s.select(p.id);await s.fill(key);await s.page.evaluate(`window.held=false;window.releaseResponse=null;const prior=window.fetch;window.fetch=async(...args)=>{const r=await prior(...args);if(args[0]==='/enterprise/v2/rpc'&&JSON.parse(args[1].body).operation==='approve'){window.held=true;await new Promise(resolve=>window.releaseResponse=resolve);}return r;};`);
 await s.page.click('#approve');await s.page.until('window.held');await grant(f,'manager',kind==='scope'?{scopes:[]}:{fields:['PUBLIC','INTERNAL']});const before=await business(f);await s.page.evaluate('window.releaseResponse()');await s.page.until("document.querySelector('#message').textContent.includes('入力を消去')");const dom=await s.capture();cleared(dom,[p.id,f.body.id,f.account.id,key]);assert.deepEqual(await business(f),before);evidence('write-denial',{kind,dom,before,after:await business(f)});
 });
}));


test('B1 final approval displays current READY details and preserves original draft key',()=>scenario('approve-browser-B1-final',async f=>{
 const p=await pending(f);await vote(f,p.id,'manager');await vote(f,p.id,'reviewer');const key=randomUUID();
 await screen(f,'B1-final',async s=>{await s.select(p.id);await s.fill(key);await s.page.click('#approve');await s.page.until("!document.querySelector('#result').hidden");const dom=await s.capture(),view=await ok(f,'get',{id:p.id});evidence('B1-final',{dom,view});assert.equal(view.workflow.state,'READY');assert.ok(dom.source.includes('状態: 承認完了'));assert.ok(dom.source.includes('承認段階: 承認完了'));assert.ok(dom.source.includes('publisher（承認・段階 2）'));assert.ok(dom.summary.includes('状態: 承認完了'));assert.equal(dom.controls.find(x=>x.id==='request-key').value,key);assert.equal(dom.controls.find(x=>x.id==='purpose').value,'請求・数量確認');assert.equal(f.env.payments.requests().length,0);},'publisher');
}));

for(const kind of ['scope','classification','unavailable','late'])test('B1 post vote inspection '+kind+' never exposes stale state',()=>scenario('approve-browser-B1-post-'+kind,async f=>{
 const p=await pending(f),key=randomUUID();await screen(f,'B1-post-'+kind,async s=>{await s.select(p.id);await s.fill(key);
 await s.page.evaluate(`window.voteCommitted=false;window.postHeld=false;window.releasePost=null;const prior=window.fetch;window.fetch=async(...args)=>{const op=args[0]==='/enterprise/v2/rpc'?JSON.parse(args[1].body).operation:null;if(op==='inspect'&&window.voteCommitted){const held=${JSON.stringify(kind)}==='late'?await prior(...args):null;window.postHeld=true;await new Promise(resolve=>window.releasePost=resolve);if(${JSON.stringify(kind)}==='unavailable')throw TypeError('synthetic post vote read loss');if(held)return held;}const r=await prior(...args);if(op==='approve'&&r.ok)window.voteCommitted=true;return r;};`);
 await s.page.click('#approve');await s.page.until('window.postHeld');const pendingDom=await s.capture();assert.equal(pendingDom.hidden,true);assert.equal(pendingDom.source,'');assert.equal(pendingDom.href,null);assert.deepEqual(pendingDom.datasets,[]);
 if(kind==='scope'||kind==='classification')await grant(f,'manager',kind==='scope'?{scopes:[]}:{fields:['PUBLIC','INTERNAL']});
 if(kind==='late'){await grant(f,'manager',{scopes:[]});await s.page.click('#refresh');await s.page.until("document.querySelector('#message').textContent.includes('入力を消去')");}
 await s.page.evaluate('window.releasePost()');await s.page.until("!document.querySelector('#approve').disabled");const dom=await s.capture();evidence('B1-post',{kind,dom,pendingDom,business:await business(f)});
 if(kind==='unavailable'){assert.equal(dom.hidden,true);assert.equal(dom.source,'');assert.equal(dom.resultHidden,true);assert.equal(dom.controls.find(x=>x.id==='request-key').value,key);assert.equal(dom.controls.find(x=>x.id==='purpose').value,'請求・数量確認');}else cleared(dom,[p.id,f.body.id,f.account.id,key]);assert.equal((await f.payment(p.id)).workflow.votes.length,1);
 });
}));
