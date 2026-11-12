import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {scenario,business,grant} from '../../fixtures/enterprise/ENT-202-public-import-r1j/support.mjs';
import {screen,cleared} from '../../fixtures/enterprise/ENT-202-public-import-r1j/browser-support.mjs';

for(const kind of ['scope','classification'])test('R1J holds import before send, then denied import plus failed revalidation after '+kind+' cancellation',()=>scenario('r1j-before-'+kind,async f=>{
 const key=randomUUID();
 await screen(f,'r1j-before-'+kind,async s=>{
  await s.select();await s.fill(key);
  await s.page.evaluate(`window.r1jHeld=false;window.r1jRelease=null;window.r1jFailNextRead=false;const prior=window.fetch;window.fetch=async(...args)=>{if(window.r1jFailNextRead&&args[0]==='/api'){window.r1jFailNextRead=false;throw TypeError('controlled revalidation transport failure');}if(args[0]==='/enterprise/v2/rpc'&&!window.r1jHeld){window.r1jHeld=true;await new Promise(resolve=>window.r1jRelease=resolve);}return prior(...args);};`);
  await s.page.click('#import');await s.page.until('window.r1jHeld===true');
  await grant(f,'operator',kind==='scope'?{scopes:[]}:{fields:['PUBLIC','INTERNAL']});
  const before=await business(f);
  await s.page.evaluate('window.r1jFailNextRead=true;window.r1jRelease()');
  await s.page.until("document.querySelector('#message').textContent.includes('下書きは保持') || document.querySelector('#references').hidden===true");
  const dom=await s.capture();
  const expectedStatus=kind==='scope'?404:403,expectedCode=kind==='scope'?'NOT_FOUND':'PERMISSION_DENIED';
  const denial=dom.http.find(x=>x.path==='/enterprise/v2/rpc');
  assert.equal(denial?.status,expectedStatus);assert.equal(denial?.data.error?.code,expectedCode);
  cleared(dom,[f.po.id,f.body.id,key,f.body.number]);
  const after=await business(f);
  for(const field of ['invoices','effects','payments','requests'])assert.deepEqual(after[field],before[field]);
  assert.equal(after.commands.length,before.commands.length+2);
  assert.equal(after.commands.at(-2).record.kind,'Denied');
  assert.equal(after.commands.at(-2).record.operation,'enterprise:invoiceImport');
  assert.equal(after.commands.at(-2).record.code,expectedCode);
  assert.equal(after.commands.at(-1).record.kind,'EnterpriseHTTPDenied');
  assert.equal(after.commands.at(-1).record.code,after.commands.at(-2).record.code);
 });
}));
