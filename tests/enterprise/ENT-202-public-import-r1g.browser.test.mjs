import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {scenario,business,grant} from '../../fixtures/enterprise/ENT-202-public-import-r1g/support.mjs';
import {screen,cleared} from '../../fixtures/enterprise/ENT-202-public-import-r1g/browser-support.mjs';

for(const kind of ['scope','classification'])test('R1G delayed denied import plus revalidation transport failure after '+kind+' cancellation',()=>scenario('r1g-before-'+kind,async f=>{
 const key=randomUUID();
 await screen(f,'r1g-before-'+kind,async s=>{
  await s.select();await s.fill(key);
  // Deny the command while keeping reads available, then revoke reads while its response is held.
  const current=(await f.env.f.owner.query('SELECT operations FROM enterprise_grants WHERE principal=$1',['operator'])).rows[0];
  await grant(f,'operator',{operations:current.operations.filter(operation=>operation!=='action')});

  await s.page.evaluate(`window.r1gHeld=false;window.r1gRelease=null;window.r1gFailNextRead=false;const prior=window.fetch;window.fetch=async(...args)=>{if(window.r1gFailNextRead&&args[0]==='/api'){window.r1gFailNextRead=false;throw TypeError('controlled revalidation transport failure');}const response=await prior(...args);if(args[0]==='/enterprise/v2/rpc'&&[403,404].includes(response.status)&&!window.r1gHeld){window.r1gHeld=true;await new Promise(resolve=>window.r1gRelease=resolve);}return response;};`);
  await s.page.click('#import');await s.page.until('window.r1gHeld===true');
  await grant(f,'operator',kind==='scope'?{scopes:[]}:{fields:['PUBLIC','INTERNAL']});
  const before=await business(f);
  await s.page.evaluate('window.r1gFailNextRead=true;window.r1gRelease()');
  await s.page.until("document.querySelector('#message').textContent.includes('下書きは保持') || document.querySelector('#references').hidden===true");
  const dom=await s.capture();
  assert.ok(dom.http.some(x=>x.path==='/enterprise/v2/rpc'&&[403,404].includes(x.status)));
  cleared(dom,[f.po.id,f.body.id,key,f.body.number]);
  assert.deepEqual(await business(f),before);
 });
}));
