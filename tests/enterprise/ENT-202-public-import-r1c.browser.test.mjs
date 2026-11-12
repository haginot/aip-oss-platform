import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {scenario,business,grant} from '../../fixtures/enterprise/ENT-202-public-import-20261028/support.mjs';
import {screen,cleared} from '../../fixtures/enterprise/ENT-202-public-import-20261028/browser-support.mjs';

for(const kind of ['scope','classification'])test('R1C delayed denied import plus transport failure after '+kind+' cancellation',()=>scenario('r1c-before-'+kind,async f=>{
 const key=randomUUID();
 await screen(f,'r1c-before-'+kind,async s=>{
  await s.select();await s.fill(key);
  // Deny the command while keeping reads available, then revoke reads while its response is held.
  const current=(await f.env.f.owner.query('SELECT operations FROM enterprise_grants WHERE principal=$1',['operator'])).rows[0];
  await grant(f,'operator',{operations:current.operations.filter(operation=>operation!=='action')});

  await s.page.evaluate(`window.r1cHeld=false;window.r1cRelease=null;window.r1cFailNextRead=false;const prior=window.fetch;window.fetch=async(...args)=>{if(window.r1cFailNextRead&&args[0]==='/api'){window.r1cFailNextRead=false;throw TypeError('controlled revalidation transport failure');}const response=await prior(...args);if(args[0]==='/enterprise/v2/rpc'&&[403,404].includes(response.status)&&!window.r1cHeld){window.r1cHeld=true;await new Promise(resolve=>window.r1cRelease=resolve);}return response;};`);
  await s.page.click('#import');await s.page.until('window.r1cHeld===true');
  await grant(f,'operator',kind==='scope'?{scopes:[]}:{fields:['PUBLIC','INTERNAL']});
  const before=await business(f);
  await s.page.evaluate('window.r1cFailNextRead=true;window.r1cRelease()');
  await s.page.until("document.querySelector('#message').textContent.includes('入力を消去')");
  const dom=await s.capture();
  assert.ok(dom.http.some(x=>x.path==='/enterprise/v2/rpc'&&[403,404].includes(x.status)));
  cleared(dom,[f.po.id,f.body.id,key,f.body.number]);
  assert.deepEqual(await business(f),before);
 });
}));
