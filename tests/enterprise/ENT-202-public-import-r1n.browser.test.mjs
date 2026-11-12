import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {scenario,business,grant} from '../../fixtures/enterprise/ENT-202-public-import-r1j/support.mjs';
import {screen,cleared} from '../../fixtures/enterprise/ENT-202-public-import-r1j/browser-support.mjs';

for(const kind of ['scope','classification'])for(const currency of ['JPY','USD'])test('R1N '+kind+' stale denial preserves valid '+currency+' re-entry and explicit import',()=>scenario('r1n-'+kind+'-'+currency,async f=>{
 const name='r1n-'+kind+'-'+currency,key=randomUUID(),newKey=randomUUID(),expectedStatus=kind==='scope'?404:403,expectedCode=kind==='scope'?'NOT_FOUND':'PERMISSION_DENIED';
 const original=(await f.env.f.owner.query('SELECT scopes,operations,fields FROM enterprise_grants WHERE principal=$1',['operator'])).rows[0];
 const proof={name,kind,currency,key,newKey};
 try{await screen(f,name,async s=>{
  const state=async()=>({dom:await s.capture(),form:await s.page.evaluate(`({valid:document.querySelector('#import-form').checkValidity(),required:[...document.querySelectorAll('#import-form [required]')].map(x=>({id:x.id,value:x.value,valid:x.validity.valid})),buttonDisabled:document.querySelector('#import').disabled})`)});
  const expectedValues={'purchase-id':f.po.id,'invoice-id':f.body.id,number:f.body.number,'supplier-id':f.body.supplierId,amount:String(f.body.amount),currency,quantity:String(f.body.quantity),unit:f.body.unit,'request-key':newKey};
  const valid=snapshot=>{
   assert.equal(snapshot.form.valid,true,'fresh authorized form must be valid, including currency');
   assert.deepEqual(Object.fromEntries(snapshot.dom.controls.map(x=>[x.id,x.value])),expectedValues);
   assert.deepEqual(snapshot.dom.controls.find(x=>x.id==='currency').options,['','JPY','USD','EUR']);
   assert.equal(snapshot.form.required.length,9);assert.ok(snapshot.form.required.every(x=>x.value!==''&&x.valid));
   assert.equal(snapshot.dom.hidden,false);assert.ok(snapshot.dom.source.includes(f.po.id));assert.equal(snapshot.dom.resultHidden,true);assert.equal(snapshot.dom.summary,'');
  };
  await s.select();await s.fill(key);
  await s.page.evaluate(`window.r1n={held:false,release:null,failNextRead:false,inputFailure:false,rpcReturned:false,holdFollowup:true,followupHeld:false,releaseFollowup:null};const prior=window.fetch;window.fetch=async(...args)=>{const state=window.r1n;if(args[0]==='/api'&&state.failNextRead){state.failNextRead=false;state.inputFailure=true;throw TypeError('controlled input-refresh transport failure');}if(args[0]==='/enterprise/v2/rpc'&&!state.held){state.held=true;await new Promise(resolve=>state.release=resolve);}const response=await prior(...args);if(args[0]==='/enterprise/v2/rpc')state.rpcReturned=true;if(args[0]==='/api'&&state.rpcReturned&&state.holdFollowup&&[403,404].includes(response.status)){state.holdFollowup=false;state.followupHeld=true;await new Promise(resolve=>state.releaseFollowup=resolve);}return response;};`);
  await s.page.click('#import');await s.page.until('window.r1n.held===true');
  await grant(f,'operator',kind==='scope'?{scopes:[]}:{fields:['PUBLIC','INTERNAL']});
  proof.businessBefore=await business(f);
  await s.page.evaluate(`window.r1n.failNextRead=true;document.querySelector('#number').value+='-edited';document.querySelector('#number').dispatchEvent(new Event('input',{bubbles:true}));`);
  await s.page.until("window.r1n.inputFailure && document.querySelector('#message').textContent.includes('下書きは保持')");
  await s.page.evaluate('window.r1n.release()');await s.page.until('window.r1n.followupHeld===true');
  await s.page.evaluate("window.dispatchEvent(new Event('pagehide'))");
  proof.cleared=await s.capture();cleared(proof.cleared,[f.po.id,f.body.id,key,f.body.number]);
  await grant(f,'operator',original);
  await s.page.click('#refresh');await s.page.until("document.querySelector('#message').textContent.includes('現在の参照権限と発注')");
  proof.restoredCurrency=await s.page.evaluate(`({value:document.querySelector('#currency').value,options:[...document.querySelector('#currency').options].map(x=>x.value)})`);
  assert.equal(proof.restoredCurrency.value,'','authorized refresh does not silently choose a currency');
  await s.select();await s.fill(newKey);await s.page.fill('#currency',currency);
  proof.freshBeforeRefresh=await state();valid(proof.freshBeforeRefresh);
  // A normal input refresh must retain the explicitly selected non-default currency too.
  await s.page.evaluate("document.querySelector('#message').textContent='';document.querySelector('#currency').dispatchEvent(new Event('input',{bubbles:true}))");
  await s.page.until("document.querySelector('#message').textContent.includes('現在の参照権限と発注')");
  proof.beforeRelease=await state();valid(proof.beforeRelease);
  assert.deepEqual(proof.beforeRelease.dom.controls,proof.freshBeforeRefresh.dom.controls);
  await s.page.evaluate('window.r1n.releaseFollowup()');await s.page.until("document.querySelector('#import').disabled===false");
  proof.afterRelease=await state();valid(proof.afterRelease);assert.equal(proof.afterRelease.form.buttonDisabled,false);
  for(const field of ['controls','identity','source','summary','hidden','resultHidden','datasets'])assert.deepEqual(proof.afterRelease.dom[field],proof.beforeRelease.dom[field],'stale denial preserves '+field);
  const dom=proof.afterRelease.dom,rpcIndex=dom.http.findIndex(x=>x.path==='/enterprise/v2/rpc');
  assert.ok(rpcIndex>=0);assert.equal(dom.http[rpcIndex].status,expectedStatus);assert.equal(dom.http[rpcIndex].data.error?.code,expectedCode);
  const followup=dom.http.slice(rpcIndex+1).find(x=>x.path==='/api'&&x.request.operation==='purchaseRead'&&x.status===expectedStatus);assert.equal(followup?.data.error?.code,expectedCode);
  assert.equal(dom.http.filter(x=>x.path==='/enterprise/v2/rpc').length,1,'no automatic write retry before explicit click');
  proof.businessAfterRelease=await business(f);
  for(const field of ['invoices','effects','payments','requests'])assert.deepEqual(proof.businessAfterRelease[field],proof.businessBefore[field]);
  const importDenied=proof.businessAfterRelease.commands.slice(proof.businessBefore.commands.length).filter(x=>x.record.kind==='Denied'&&x.record.operation==='enterprise:invoiceImport');assert.equal(importDenied.length,1);assert.equal(importDenied[0].record.code,expectedCode);
  proof.explicitClickAt=new Date().toISOString();await s.page.click('#import');
  await s.page.until("document.querySelector('#message').textContent==='請求書を取り込みました。' && document.querySelector('#import').disabled===false");
  proof.afterExplicitImport=await state();const writes=proof.afterExplicitImport.dom.http.filter(x=>x.path==='/enterprise/v2/rpc');
  assert.equal(writes.length,2);assert.equal(writes[1].status,200);assert.equal(writes[1].request.key,newKey);assert.deepEqual(writes[1].request.body,{...f.body,currency});
  assert.equal(writes[1].data.result.id,f.body.id);assert.equal(writes[1].data.result.state,currency==='JPY'?'MATCHED':'QUARANTINED');
  proof.invoice=await f.call('operator','invoiceRead',{id:f.body.id});assert.deepEqual(proof.invoice.fields,{...f.body,currency});
  proof.businessAfterExplicitImport=await business(f);assert.equal(proof.businessAfterExplicitImport.invoices.length,proof.businessBefore.invoices.length+1);
  for(const field of ['effects','payments','requests'])assert.deepEqual(proof.businessAfterExplicitImport[field],proof.businessBefore[field]);
  proof.passed=true;
 });}finally{if(process.env.R1J_EVIDENCE){mkdirSync(process.env.R1J_EVIDENCE,{recursive:true});writeFileSync(process.env.R1J_EVIDENCE+'/'+name+'--reentry-proof.json',JSON.stringify(proof,null,2)+'\n');}}
}));
