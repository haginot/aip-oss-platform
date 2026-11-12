import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {scenario,business,grant} from '../../fixtures/enterprise/ENT-202-public-import-r1j/support.mjs';
import {screen,cleared} from '../../fixtures/enterprise/ENT-202-public-import-r1j/browser-support.mjs';

for(const kind of ['scope','classification'])for(const replaced of [false,true])test('R1M '+kind+' denied follow-up after input transport failure '+(replaced?'ignores cleared state replaced by fresh authorized input':'clears retained state'),()=>scenario('r1m-'+kind+'-'+replaced,async f=>{
 const key=randomUUID(),newKey=randomUUID(),expectedStatus=kind==='scope'?404:403,expectedCode=kind==='scope'?'NOT_FOUND':'PERMISSION_DENIED';
 const original=(await f.env.f.owner.query('SELECT scopes,operations,fields FROM enterprise_grants WHERE principal=$1',['operator'])).rows[0];
 await screen(f,'r1m-'+kind+'-'+replaced,async s=>{
  await s.select();await s.fill(key);
  await s.page.evaluate(`window.r1m={held:false,release:null,failNextRead:false,inputFailure:false,rpcReturned:false,holdFollowup:${replaced},followupHeld:false,releaseFollowup:null};const prior=window.fetch;window.fetch=async(...args)=>{const state=window.r1m;if(args[0]==='/api'&&state.failNextRead){state.failNextRead=false;state.inputFailure=true;throw TypeError('controlled input-refresh transport failure');}if(args[0]==='/enterprise/v2/rpc'&&!state.held){state.held=true;await new Promise(resolve=>state.release=resolve);}const response=await prior(...args);if(args[0]==='/enterprise/v2/rpc')state.rpcReturned=true;if(args[0]==='/api'&&state.rpcReturned&&state.holdFollowup&&[403,404].includes(response.status)){state.holdFollowup=false;state.followupHeld=true;await new Promise(resolve=>state.releaseFollowup=resolve);}return response;};`);
  await s.page.click('#import');await s.page.until('window.r1m.held===true');
  await grant(f,'operator',kind==='scope'?{scopes:[]}:{fields:['PUBLIC','INTERNAL']});
  const before=await business(f);
  await s.page.evaluate(`window.r1m.failNextRead=true;document.querySelector('#number').value+='-edited';document.querySelector('#number').dispatchEvent(new Event('input',{bubbles:true}));`);
  await s.page.until("window.r1m.inputFailure && document.querySelector('#message').textContent.includes('下書きは保持')");
  const retained=await s.capture();assert.equal(retained.hidden,false);assert.ok(retained.source.includes(f.po.id));assert.equal(retained.controls.find(x=>x.id==='request-key').value,key);
  await s.page.evaluate('window.r1m.release()');
  if(replaced){
   await s.page.until('window.r1m.followupHeld===true');
   // Clear the old document state through the production lifecycle handler, then
   // establish a fresh authorized selection before releasing its delayed denial.
   await s.page.evaluate("window.dispatchEvent(new Event('pagehide'))");
   cleared(await s.capture(),[f.po.id,f.body.id,key,f.body.number]);
   await grant(f,'operator',original);
   await s.page.click('#refresh');await s.page.until("document.querySelector('#message').textContent.includes('現在の参照権限と発注')");
   await s.select();await s.fill(newKey);
   await s.page.evaluate('window.r1m.releaseFollowup()');
  }
  await s.page.until("document.querySelector('#import').disabled===false");
  const dom=await s.capture(),rpcIndex=dom.http.findIndex(x=>x.path==='/enterprise/v2/rpc');
  assert.ok(rpcIndex>=0);assert.equal(dom.http[rpcIndex].status,expectedStatus);assert.equal(dom.http[rpcIndex].data.error?.code,expectedCode);
  const followup=dom.http.slice(rpcIndex+1).find(x=>x.path==='/api'&&x.request.operation==='purchaseRead'&&x.status===expectedStatus);
  assert.equal(followup?.data.error?.code,expectedCode);
  assert.equal(dom.http.filter(x=>x.path==='/enterprise/v2/rpc').length,1,'no automatic write retry');
  if(replaced){assert.equal(dom.hidden,false);assert.ok(dom.source.includes(f.po.id));assert.equal(dom.controls.find(x=>x.id==='request-key').value,newKey);assert.equal(dom.controls.find(x=>x.id==='number').value,f.body.number);assert.equal(dom.resultHidden,true);assert.equal(dom.summary,'');}
  else cleared(dom,[f.po.id,f.body.id,key,f.body.number]);
  const after=await business(f);
  for(const field of ['invoices','effects','payments','requests'])assert.deepEqual(after[field],before[field]);
  const importDenied=after.commands.slice(before.commands.length).filter(x=>x.record.kind==='Denied'&&x.record.operation==='enterprise:invoiceImport');
  assert.equal(importDenied.length,1);assert.equal(importDenied[0].record.code,expectedCode);
 });
}));
