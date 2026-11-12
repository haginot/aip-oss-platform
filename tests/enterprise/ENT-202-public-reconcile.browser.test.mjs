import {completedSubmit,waitForSubmitCompletion,holdFollowupHistory,releaseHeldFetch,releaseFollowupHistory} from '../../fixtures/enterprise/ENT-202-public-reconcile-c2c/submit-completion.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {scenario,screen,business,grant,ops,unknown,reconciled,evidence,cleared,selected,actions,originalGrant,clearedWait,hold,release} from '../../fixtures/enterprise/ENT-202-public-reconcile-c2a/browser-support.mjs';
const finished=page=>page.until("document.querySelector('#message').textContent==='現在の支払結果を確認しました。'");
const stateParts=dom=>Object.fromEntries(['identity','state','summary','history','observation','hidden','resultHidden','controls','datasets','formValid'].map(k=>[k,dom[k]]));
const paymentPosts=f=>f.env.payments.requests().filter(x=>x.method==='POST').length;
const revoke=kind=>kind==='scope'?{scopes:[]}:{fields:['PUBLIC','INTERNAL']};

test('C2A UI01 real keyboard reconciles selected UNKNOWN once with exact dedicated request and fresh projection',()=>scenario('c2a-ui01',f=>screen(f,'ui01',async s=>{
 const before=await s.capture(),posts=paymentPosts(f);selected(before,f.paymentId);assert.match(before.state,/UNKNOWN.*HELD/);assert.ok(before.summary.includes(f.body.id));assert.ok(before.history.length>0);for(const operation of ['query','inspect','history','get'])assert.ok(before.http.some(x=>x.request?.operation===operation&&x.status===200));
 await s.keyboard();await finished(s.page);const after=await s.capture(),rows=actions(after);assert.equal(rows.length,1);assert.equal(rows[0].status,200);assert.deepEqual(rows[0].request,{contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',operation:'reconcile',body:{id:f.paymentId}});assert.match(after.observation,/SUCCEEDED/);assert.match(after.state,/SUCCEEDED.*HELD/);assert.equal(after.disabled,true);assert.equal((await f.payment(f.paymentId)).state,'SUCCEEDED');assert.equal(paymentPosts(f),posts);assert.equal(await s.page.evaluate('document.activeElement.id'),'result-title');
})));

test('C2A UI02 real ABSENT remains UNKNOWN HELD requiring human review with no resend/cancel controls',()=>scenario('c2a-ui02',f=>screen(f,'ui02',async s=>{
 const posts=paymentPosts(f);await s.submit();await finished(s.page);const dom=await s.capture();assert.equal(actions(dom)[0].data.result.reconciliation.observation,'ABSENT');assert.match(dom.observation,/ABSENT.*人による確認/);assert.match(dom.state,/UNKNOWN.*HELD/);assert.equal((await f.payment(f.paymentId)).state,'UNKNOWN');assert.equal(paymentPosts(f),posts);assert.equal((await f.env.payments.ledger()).length,0);assert.deepEqual(await s.page.evaluate("[...document.querySelectorAll('button')].map(x=>x.id)"),['refresh','load','reconcile']);assert.equal(dom.controls.length,1);
}),'absent'));

test('C2A UI03 lost committed response rereads current state and never automatically repeats operation',()=>scenario('c2a-ui03',f=>screen(f,'ui03',async s=>{
 await s.page.evaluate(`const prior=window.fetch;window.lost=false;window.fetch=async(...args)=>{const response=await prior(...args);if(args[0]==='/enterprise/v2/reconcile'&&!window.lost){window.lost=true;throw TypeError('controlled response loss');}return response;};`);const posts=paymentPosts(f);await s.submit();const dom=await s.capture();assert.equal(actions(dom).length,1);assert.equal(actions(dom)[0].status,200);assert.match(dom.state,/SUCCEEDED/);assert.equal(dom.resultHidden,true);assert.match(dom.message,/自動再送は行いません/);assert.equal(paymentPosts(f),posts);assert.equal(dom.disabled,true);
})));

test('C2A UI04 terminal INVALID_STATE reads current committed result and makes no automatic retry',()=>scenario('c2a-ui04',f=>screen(f,'ui04',async s=>{
 await reconciled(f,f.paymentId);const before=await business(f);await s.submit();const dom=await s.capture();assert.equal(actions(dom).length,1);assert.equal(actions(dom)[0].data.error.code,'INVALID_STATE');assert.match(dom.state,/SUCCEEDED/);assert.equal(dom.resultHidden,true);assert.equal(dom.disabled,true);const after=await business(f);assert.deepEqual(after.tables,before.tables);assert.deepEqual(after.paymentLedger,before.paymentLedger);assert.equal(paymentPosts(f),before.paymentRequests.filter(x=>x.method==='POST').length);
})));

test('C2A UI05 read revoked after actual successful reconcile clears every control and cannot display success',()=>scenario('c2a-ui05',f=>screen(f,'ui05',async s=>{
 await hold(s.page);await s.page.click('#reconcile');await s.page.until('window.gate.held');assert.equal((await f.payment(f.paymentId)).state,'SUCCEEDED');await grant(f,'manager',{scopes:[]});const before=await business(f);await release(s.page);await clearedWait(s.page);cleared(await s.capture(),[f.paymentId,f.body.id,f.po.id]);assert.deepEqual(await business(f),before);
})));

for(const kind of ['scope','classification'])test('C2A UI06 '+kind+' current read denial clears retained text datasets values options',()=>scenario('c2a-ui06-'+kind,f=>screen(f,'ui06-'+kind,async s=>{
 await grant(f,'manager',revoke(kind));const before=await business(f);await s.refresh();await clearedWait(s.page);const dom=await s.capture();cleared(dom,[f.paymentId,f.body.id,f.po.id]);assert.equal(actions(dom).length,0);assert.ok(dom.http.some(x=>x.request?.operation==='query'&&x.status===200&&x.data.result?.items.length===0));assert.deepEqual(await business(f),before);
})));

test('C2A UI07 current epoch read denial clears despite changed input generation',()=>scenario('c2a-ui07',f=>screen(f,'ui07',async s=>{
 await hold(s.page,{before:true});await s.page.click('#reconcile');await s.page.until('window.gate.held');await grant(f,'manager',{scopes:[]});const before=await business(f);await s.page.evaluate("document.querySelector('#payment-id').dispatchEvent(new Event('input',{bubbles:true}))");await release(s.page);await clearedWait(s.page);const dom=await s.capture();cleared(dom,[f.paymentId,f.body.id]);assert.equal(actions(dom).length,1);assert.equal(actions(dom)[0].status,404);assert.deepEqual(await business(f),before);
})));

test('C2A UI08 recovery-only denial retains only after fresh reads prove all retained information',()=>scenario('c2a-ui08',f=>screen(f,'ui08',async s=>{
 await grant(f,'manager',{operations:ops.filter(x=>x!=='recovery')});const before=await business(f);await s.submit();const dom=await s.capture(),action=actions(dom)[0];assert.equal(action.status,403);selected(dom,f.paymentId);assert.match(dom.state,/UNKNOWN/);assert.equal(dom.resultHidden,true);const index=dom.http.findIndex(x=>x.path==='/enterprise/v2/reconcile');for(const op of ['query','get','inspect','history'])assert.ok(dom.http.slice(index+1).some(x=>x.request?.operation===op&&x.status===200));assert.deepEqual(await business(f),before);
})));

test('C2A UI09 unverifiable post-denial reads clear even after an ordinary selection edit',()=>scenario('c2a-ui09',f=>screen(f,'ui09',async s=>{
 await s.page.evaluate(`window.gate={held:false,release:null,returned:false};const prior=window.fetch;window.fetch=async(...args)=>{if(args[0]==='/enterprise/v2/rpc'&&window.gate.returned)throw TypeError('controlled post-denial read transport');if(args[0]==='/enterprise/v2/reconcile'&&!window.gate.held){window.gate.held=true;await new Promise(r=>window.gate.release=r);}const response=await prior(...args);if(args[0]==='/enterprise/v2/reconcile')window.gate.returned=true;return response;};`);await s.page.click('#reconcile');await s.page.until('window.gate.held');await grant(f,'manager',{operations:ops.filter(x=>x!=='recovery')});const before=await business(f);await s.page.evaluate("document.querySelector('#payment-id').dispatchEvent(new Event('input',{bubbles:true}));window.gate.release()");await clearedWait(s.page);cleared(await s.capture(),[f.paymentId]);assert.deepEqual(await business(f),before);
})));

test('C2A UI10 stale denied read cannot erase authorized new epoch and real keyboard reentry reconciles',()=>scenario('c2a-ui10',f=>screen(f,'ui10',async s=>{
 const original=await originalGrant(f);
 await s.page.evaluate(`window.readGate={requestHeld:false,denialHeld:false,released:false};const prior=window.fetch;window.fetch=async(...args)=>{const match=args[0]==='/enterprise/v2/rpc'&&JSON.parse(args[1].body).operation==='get';if(match&&!window.readGate.requestHeld){window.readGate.requestHeld=true;await new Promise(r=>window.readGate.releaseRequest=r);const response=await prior(...args);window.readGate.status=response.status;window.readGate.denialHeld=true;await new Promise(r=>window.readGate.releaseDenial=r);window.readGate.released=true;return response;}return prior(...args);};`);
 await s.page.click('#refresh');await s.page.until('window.readGate.requestHeld');await grant(f,'manager',{fields:['PUBLIC','INTERNAL']});await s.page.evaluate('window.readGate.releaseRequest()');await s.page.until('window.readGate.denialHeld');assert.equal(await s.page.evaluate('window.readGate.status'),403);const denied=await s.capture();assert.ok(denied.http.some(x=>x.request?.operation==='get'&&x.status===403));await s.page.evaluate("window.dispatchEvent(new Event('pagehide'))");cleared(await s.capture(),[f.paymentId]);await grant(f,'manager',original);await s.refresh();await s.select();const before=await s.capture();selected(before,f.paymentId);await s.page.evaluate('window.readGate.releaseDenial()');await s.page.until('window.readGate.released');await s.page.evaluate('new Promise(r=>setTimeout(r,75))');const after=await s.capture();assert.deepEqual(stateParts(after),stateParts(before));assert.equal(after.disabled,false);await s.keyboard();await finished(s.page);assert.equal(actions(await s.capture()).length,1);assert.equal((await f.payment(f.paymentId)).state,'SUCCEEDED');
})));

test('C2A UI11 stale successful operation cannot revive explicitly cleared epoch',()=>scenario('c2a-ui11',f=>screen(f,'ui11',async s=>{
 await hold(s.page);await s.page.click('#reconcile');await s.page.until('window.gate.held');const before=await business(f);await s.page.evaluate("window.dispatchEvent(new Event('pagehide'))");cleared(await s.capture(),[f.paymentId]);await release(s.page);cleared(await s.capture(),[f.paymentId,f.body.id]);assert.deepEqual(await business(f),before);assert.equal(actions(await s.capture()).length,1);
})));

test('C2A UI12 stale denied operation cannot clear new authorized selection and explicit reentry succeeds',()=>scenario('c2a-ui12',f=>screen(f,'ui12',async s=>{
 const original=await originalGrant(f);await grant(f,'manager',{operations:ops.filter(x=>x!=='recovery')});await hold(s.page);await s.page.click('#reconcile');await s.page.until('window.gate.held');assert.equal(actions(await s.capture())[0].status,403);await s.page.evaluate("window.dispatchEvent(new Event('pagehide'))");await grant(f,'manager',original);await s.refresh();await s.select();const before=await s.capture();await release(s.page);const after=await s.capture();assert.deepEqual(stateParts(after),stateParts(before));assert.equal(after.disabled,false);await s.keyboard();await finished(s.page);assert.equal(actions(await s.capture()).length,2);assert.equal((await f.payment(f.paymentId)).state,'SUCCEEDED');
})));

test('C2A UI13 late successful read cannot revive or overwrite a new epoch',()=>scenario('c2a-ui13',f=>screen(f,'ui13',async s=>{
 await hold(s.page,{path:'/enterprise/v2/rpc',operation:'history'});await s.page.click('#refresh');await s.page.until('window.gate.held');await s.page.evaluate("window.dispatchEvent(new Event('pagehide'))");cleared(await s.capture(),[f.paymentId]);await s.refresh();await s.select();const before=await s.capture();await release(s.page);assert.deepEqual(stateParts(await s.capture()),stateParts(before));assert.equal(actions(await s.capture()).length,0);
})));

test('C2A UI14 operation A cannot appear in selection B after its handler completes and duplicate submit sends exactly one request',()=>scenario('c2a-ui14',async f=>{
 const a=f.paymentId,b=(await unknown(f,'lost-ack',{amount:600})).id;f.paymentId=a;
 await screen(f,'ui14',async s=>{
  const posts=paymentPosts(f);
  await hold(s.page,{before:true});await s.page.click('#reconcile');await s.page.until('window.gate.held');
  let proof=await s.page.evaluate('JSON.parse(JSON.stringify(window.reconcileSubmitProof))');
  assert.equal(proof.registrations,1);assert.equal(proof.invocations.length,1);const first=proof.invocations[0].id;
  assert.equal(proof.invocations[0].state,'pending');assert.equal(proof.invocations[0].returnedPromise,true);
  await s.page.evaluate("document.querySelector('#reconcile-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
  await waitForSubmitCompletion(s.page,first+1);
  await s.select(b);const before=await s.capture();selected(before,b);assert.equal(before.disabled,true);
  // Deterministic negative control: the actual A follow-up history response is
  // withheld after A's real response. Completion must remain false at this gate.
  await holdFollowupHistory(s.page,b);await releaseHeldFetch(s.page);await s.page.until('window.c2cFollowupGate.held');
  const delayed=await s.capture();proof=delayed.submitProof;
  assert.equal(proof.invocations.length,2);completedSubmit(proof,first+1);
  assert.equal(proof.invocations.find(row=>row.id===first).state,'pending');
  assert.throws(()=>completedSubmit(proof,first),/exact handler/);
  assert.equal(delayed.disabled,true);selected(delayed,b);assert.equal(actions(delayed).length,1);
  const delayedActionIndex=delayed.http.findIndex(row=>row.path==='/enterprise/v2/reconcile');
  const delayedReads=delayed.http.slice(delayedActionIndex+1);
  assert.equal(delayedReads.at(-1).request.operation,'history');assert.equal(delayedReads.at(-1).request.body.id,b);
  evidence('ui14--handler-delayed',{first,proof,dom:delayed,gate:await s.page.evaluate('JSON.parse(JSON.stringify(window.c2cFollowupGate))')});
  await releaseFollowupHistory(s.page);proof=await waitForSubmitCompletion(s.page,first);
  const dom=await s.capture();assert.equal(proof.invocations.length,2);completedSubmit(dom.submitProof,first);completedSubmit(dom.submitProof,first+1);
  const rows=actions(dom);assert.equal(rows.length,1);assert.equal(rows[0].status,200);assert.equal(rows[0].request.body.id,a);
  const actionIndex=dom.http.findIndex(row=>row.path==='/enterprise/v2/reconcile'),reads=dom.http.slice(actionIndex+1);
  assert.equal(reads[0].path,'/session');assert.equal(reads[0].status,200);
  assert.equal(reads[1].request.operation,'query');assert.equal(reads[1].status,200);
  const rpcReads=reads.slice(2);assert.equal(rpcReads.length,5);
  assert.deepEqual(rpcReads.slice(0,2).map(row=>row.request.operation),['get','get']);
  assert.deepEqual(new Set(rpcReads.slice(0,2).map(row=>row.request.body.id)),new Set([a,b]));
  assert.deepEqual(rpcReads.slice(2).map(row=>[row.request.operation,row.request.body.id]),[['inspect',b],['history',b],['get',b]]);
  for(const row of rpcReads){assert.equal(row.status,200);assert.equal(row.path,'/enterprise/v2/rpc');}
  selected(dom,b);assert.deepEqual(stateParts(dom),stateParts(before));assert.equal(dom.disabled,false);
  assert.ok(dom.datasets.some(row=>row.id===b));assert.equal(dom.resultHidden,true);assert.equal(dom.observation,'');assert.match(dom.state,/UNKNOWN.*HELD/);
  assert.equal((await f.payment(a)).state,'SUCCEEDED');assert.equal((await f.payment(b)).state,'UNKNOWN');assert.equal(paymentPosts(f),posts);
  // Handler settlement closes the operation, so this last capture is after all
  // of its reads and its finally, not merely after the transport was released.
  const final=await s.capture();assert.equal(actions(final).length,1);assert.equal(final.disabled,false);selected(final,b);
  evidence('ui14--handler-completed',{first,proof:final.submitProof,followupReads:reads,dom:final,paymentPostsBefore:posts,paymentPostsAfter:paymentPosts(f),gate:await s.page.evaluate('JSON.parse(JSON.stringify(window.c2cFollowupGate))')});
 });
},'lost-ack',{amount:600}));

test('C2A UI15 actual reload drops selection, focus rereads rights, expired session erases all retained data',()=>scenario('c2a-ui15',f=>screen(f,'ui15',async s=>{
 const before=await business(f);await s.page.send('Page.reload',{ignoreCache:true});await s.page.until("performance.getEntriesByType('navigation')[0]?.type==='reload'&&document.querySelector('#message')?.textContent==='現在の支払一覧を確認しました。'");let dom=await s.capture();assert.equal(dom.hidden,true);assert.equal(dom.controls[0].value,'');assert.equal(actions(dom).length,0);assert.equal(await s.page.evaluate('localStorage.length+sessionStorage.length'),0);await s.select();const count=(await s.capture()).http.length;await s.page.evaluate("document.querySelector('#message').textContent='';window.dispatchEvent(new Event('focus'))");await s.page.until("document.querySelector('#message').textContent.includes('現在情報')");dom=await s.capture();for(const op of ['query','get','history'])assert.ok(dom.http.slice(count).some(x=>x.request?.operation===op&&x.status===200));
 const cookies=await s.page.send('Network.getCookies',{urls:[f.env.gateway.origin]}),token=cookies.cookies.find(x=>x.name==='enterprise_session')?.value;assert.ok(token);const {tokenDigest}=await import('../../src/contracts.mjs');assert.equal((await f.env.f.owner.query('DELETE FROM enterprise_browser_sessions WHERE digest=$1 RETURNING digest',[tokenDigest(token)])).rowCount,1);await s.page.evaluate("window.dispatchEvent(new Event('focus'))");await clearedWait(s.page);cleared(await s.capture(),[f.paymentId,f.body.id]);assert.equal(actions(await s.capture()).length,0);assert.deepEqual(await business(f),before);
})));
