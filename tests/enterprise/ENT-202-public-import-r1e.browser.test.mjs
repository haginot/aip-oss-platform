import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {scenario,business,grant} from '../../fixtures/enterprise/ENT-202-public-import-r1e/support.mjs';
import {screen,cleared} from '../../fixtures/enterprise/ENT-202-public-import-r1e/browser-support.mjs';

for(const kind of ['scope','classification'])test('R1E delayed denied import plus revalidation transport failure after '+kind+' cancellation',()=>scenario('r1e-before-'+kind,async f=>{
 const key=randomUUID();
 await screen(f,'r1e-before-'+kind,async s=>{
  await s.select();await s.fill(key);
  // Deny the command while keeping reads available, then revoke reads while its response is held.
  const current=(await f.env.f.owner.query('SELECT operations FROM enterprise_grants WHERE principal=$1',['operator'])).rows[0];
  await grant(f,'operator',{operations:current.operations.filter(operation=>operation!=='action')});

  await s.page.evaluate(`window.r1eHeld=false;window.r1eRelease=null;window.r1eFailNextRead=false;const prior=window.fetch;window.fetch=async(...args)=>{if(window.r1eFailNextRead&&args[0]==='/api'){window.r1eFailNextRead=false;throw TypeError('controlled revalidation transport failure');}const response=await prior(...args);if(args[0]==='/enterprise/v2/rpc'&&[403,404].includes(response.status)&&!window.r1eHeld){window.r1eHeld=true;await new Promise(resolve=>window.r1eRelease=resolve);}return response;};`);
  await s.page.click('#import');await s.page.until('window.r1eHeld===true');
  await grant(f,'operator',kind==='scope'?{scopes:[]}:{fields:['PUBLIC','INTERNAL']});
  const before=await business(f);
  await s.page.evaluate('window.r1eFailNextRead=true;window.r1eRelease()');
  await s.page.until("document.querySelector('#message').textContent.includes('入力を消去')");
  const dom=await s.capture();
  assert.ok(dom.http.some(x=>x.path==='/enterprise/v2/rpc'&&[403,404].includes(x.status)));
  cleared(dom,[f.po.id,f.body.id,key,f.body.number]);
  assert.deepEqual(await business(f),before);
 });
}));
