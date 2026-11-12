import {test as nodeTest} from 'node:test';import assert from 'node:assert/strict';import {withControls,release,approve,work} from './control-helper.mjs';
test('ENT-114 AC-01 positive persistence pinned approvals embargo correction',()=>withControls(async f=>{
 const x=await release(f,{embargo:'2099-01-01T00:00:00Z'});await approve(f,x.id);await assert.rejects(work(f,x.id),{code:'INVALID_STATE'});
 const y=await release(f);await approve(f,y.id);assert.equal((await work(f,y.id)).state,'ACCEPTED');const z=await release(f,{correctionOf:y.id});assert.equal((await f.call('manager','controlRead',{id:z.id})).data.correctionOf,y.id);assert.equal((await f.call('manager','controlRead',{id:y.id})).data.state,'ACCEPTED');
}));
test('ENT-114 AC-02 negative-authorization failure-recovery partial lost ack unsupported withdrawal',()=>withControls(async(f,{a})=>{
 const x=await release(f,{channels:['web','mail']});await assert.rejects(f.call('operator','releaseApprove',{id:x.id,role:'legal',revision:1,withdrawal:false}),{code:'PERMISSION_DENIED'});await approve(f,x.id);a.loseNext();assert.equal((await work(f,x.id)).state,'UNKNOWN');assert.equal((await work(f,x.id,'web','reconcile')).state,'ACCEPTED');assert.equal((await f.call('manager','controlRead',{id:x.id})).data.state,'PARTIAL');await work(f,x.id,'mail');await f.call('operator','releaseWithdraw',{id:x.id});await approve(f,x.id,true);assert.equal((await work(f,x.id,'web','withdraw')).state,'WITHDRAWN');assert.equal((await work(f,x.id,'mail','withdraw')).state,'WITHDRAW_UNSUPPORTED');assert.equal((await a.ledger())[0].applied,1);
}));
test('ENT-114 AC-03 audit and current approval revocation before send',()=>withControls(async(f,{a})=>{
 const x=await release(f);await approve(f,x.id);await f.owner.query("UPDATE enterprise_grants SET revision=revision+1 WHERE principal='reviewer'");await assert.rejects(work(f,x.id),{code:'STALE_APPROVAL'});assert.equal(a.requests.length,0);assert.ok((await f.call('manager','controlAudit',{id:x.id})).history.length===4);
}));
test('ENT-114 worker termination after external commit recovery without duplicate apply',()=>withControls(async(f,{a})=>{
 const {spawn}=await import('node:child_process');const x=await release(f);await approve(f,x.id);const {host,port,user,database,options}=f.state.pool.options;
 const exit=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['tests/enterprise/control-worker-child.mjs'],{stdio:['pipe','pipe','pipe']});let stderr='';child.stderr.on('data',x=>stderr+=x);child.on('error',reject);child.on('exit',code=>resolve({code,stderr}));child.stdin.end(JSON.stringify({config:{host,port,user,database,options},journal:f.journal.path,credential:f.credentials.manager,id:x.id,url:a.url}));});assert.equal(exit.code,73,exit.stderr);assert.equal((await f.call('manager','controlRead',{id:x.id})).deliveries[0].state,'UNKNOWN');assert.equal((await work(f,x.id,'web','reconcile')).state,'ACCEPTED');assert.equal((await a.ledger())[0].applied,1);
}));
test('ENT-114 restored READY delivery cannot resend after independent accepted effect',()=>withControls(async(f,{cluster,a})=>{
 const {execFileSync}=await import('node:child_process');const x=await release(f);await approve(f,x.id);const schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],path=cluster.directory+'/release-before.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);await work(f,x.id);await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});await assert.rejects(work(f,x.id),{code:'RECOVERING'});assert.equal((await work(f,x.id,'web','reconcile')).state,'ACCEPTED');assert.equal((await a.ledger())[0].applied,1);
}));

function test(name,fn){const labels=['positive','negative-authorization','persistence','failure-recovery'].filter(x=>name.includes(x));return nodeTest(name,t=>{const run=(ctx,n)=>n===labels.length?fn(ctx):ctx.test(labels[n]+' '+name,child=>run(child,n+1));return run(t,0);});}

// BF-21: observation has its own current recovery authority. Saved publication
// votes still authorize every new external write, never an observation alone.
async function bf21Grant(f,principal,ops){
 const {scope,operations}=await import('../../scripts/enterprise/fixture.mjs');
 return f.call('publisher','grant',{principal,scopes:[scope],operations:ops??operations,fields:['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED']});
}
async function bf21Http(f){
 const {enterpriseGateway}=await import('../../src/enterprise/gateway.mjs'),{tokenDigest}=await import('../../src/contracts.mjs');
 for(const who of ['manager','reviewer','publisher','operator','reader','other','tenant2'])await f.owner.query('INSERT INTO enterprise_browser_sessions VALUES($1,$2) ON CONFLICT DO NOTHING',[tokenDigest(f.credentials[who].token),'bf21-csrf']);
 const gateway=await enterpriseGateway(f.kernel,{issuer:'http://127.0.0.1:1'});
 return {close:()=>gateway.close(),async call(who,operation,body){const response=await fetch(gateway.origin+'/api',{method:'POST',headers:{cookie:'enterprise_session='+f.credentials[who].token,origin:gateway.origin,'content-type':'application/json','x-csrf-token':'bf21-csrf'},body:JSON.stringify({contractVersion:'2.0.0',operation,body,key:crypto.randomUUID()})});return {status:response.status,body:await response.json()};}};
}
nodeTest('BF-21 public HTTP reconciles after approver revocation and withdraws with new independent votes',()=>withControls(async(f,{a,b})=>{
 const x=await release(f,{channels:['web','mail']});await approve(f,x.id);const http=await bf21Http(f);try{
 a.loseNext();assert.equal((await http.call('manager','controlWork',{id:x.id,channel:'web',mode:'dispatch'})).body.result.state,'UNKNOWN');
 const original=await f.call('manager','controlRead',{id:x.id});await bf21Grant(f,'reviewer',['read','search']);
 const requests=a.requests.length,observed=await http.call('manager','controlWork',{id:x.id,channel:'web',mode:'reconcile'});
 console.log(JSON.stringify({bf21:{observed,requests:a.requests.slice(requests),ledger:await a.ledger()}}));
 assert.equal(observed.status,200);assert.equal(observed.body.result.state,'ACCEPTED');assert.deepEqual(a.requests.slice(requests).map(r=>r.method),['GET']);
 const current=await f.call('manager','controlRead',{id:x.id});assert.equal(current.data.state,'PARTIAL');assert.deepEqual(current.data.approvals,original.data.approvals);assert.equal(current.deliveries[1].operation_id,original.deliveries[1].operation_id);
 assert.equal((await http.call('manager','controlWork',{id:x.id,channel:'mail',mode:'dispatch'})).status,403);assert.equal(b.requests.length,0);
 await bf21Grant(f,'reviewer');const stale=await http.call('manager','controlWork',{id:x.id,channel:'mail',mode:'dispatch'});assert.equal(stale.body.error.code,'STALE_APPROVAL');assert.equal(b.requests.length,0);
 assert.equal((await http.call('operator','releaseWithdraw',{id:x.id})).status,200);
 assert.equal((await http.call('manager','controlWork',{id:x.id,channel:'web',mode:'withdraw'})).status,403);
 // A different current PR approver replaces the revoked publication approver.
 await bf21Grant(f,'reader',['read','search','approve']);await f.owner.query("INSERT INTO enterprise_release_roles VALUES('t1','reader','pr')");
 for(const [who,role] of [['manager','legal'],['reader','pr'],['publisher','ir']]){const row=await f.call(who,'controlRead',{id:x.id});assert.equal((await http.call(who,'releaseApprove',{id:x.id,role,revision:row.revision,withdrawal:true})).status,200);}
 assert.equal((await http.call('manager','controlWork',{id:x.id,channel:'web',mode:'withdraw'})).body.result.state,'WITHDRAWN');
 assert.deepEqual((await a.ledger()).map(r=>({applied:r.applied,withdrawn:r.withdrawn})),[{applied:1,withdrawn:1}]);assert.equal(b.requests.length,0);
 const audit=await f.call('manager','controlAudit',{id:x.id});assert.ok(audit.events.some(e=>e.kind==='ControlExternalObserved'&&e.state==='ACCEPTED'));assert.ok(audit.events.some(e=>e.kind==='ControlExternalObserved'&&e.state==='WITHDRAWN'));
 }finally{await http.close();}
}));
nodeTest('BF-21 current recovery actor and fixed operation boundaries remain enforced',()=>withControls(async(f,{a,b})=>{
 const x=await release(f);await approve(f,x.id);a.loseNext();await work(f,x.id);await bf21Grant(f,'reviewer',['read']);
 const requests=a.requests.length;
 for(const who of ['reader','other','tenant2'])await assert.rejects(work(f,x.id,'web','reconcile',who),e=>['PERMISSION_DENIED','NOT_FOUND'].includes(e.code));
 const saved=f.kernel.controlPorts.web;f.kernel.controlPorts.web=f.kernel.controlPorts.mail;await assert.rejects(work(f,x.id,'web','reconcile'),{code:'PERMISSION_DENIED'});f.kernel.controlPorts.web=saved;
 const delivery=(await f.owner.query('SELECT * FROM enterprise_control_deliveries WHERE id=$1',[x.id])).rows[0];await f.owner.query("UPDATE enterprise_control_deliveries SET event=jsonb_set(event,'{payload,text}','\"changed\"') WHERE id=$1",[x.id]);await assert.rejects(work(f,x.id,'web','reconcile'),{code:'INCONSISTENT_STATE'});await f.owner.query('UPDATE enterprise_control_deliveries SET event=$2 WHERE id=$1',[x.id,delivery.event]);
 assert.equal(a.requests.length,requests);assert.equal(b.requests.length,0);
 f.kernel.fault=async p=>{if(p==='control-before-send')await f.owner.query("UPDATE enterprise_grants SET operations='[\"read\"]',revision=revision+1 WHERE principal='manager'");};
 const stopped=await work(f,x.id,'web','reconcile');assert.equal(stopped.code,'PERMISSION_DENIED');assert.equal(a.requests.length,requests);f.kernel.fault=async()=>{};await bf21Grant(f,'manager');assert.equal((await work(f,x.id,'web','reconcile')).state,'ACCEPTED');assert.equal((await a.ledger())[0].applied,1);
}));
nodeTest('BF-21 absent observation never dispatches after approval revision or restart',()=>withControls(async(f,{a})=>{
 const x=await release(f);await approve(f,x.id);f.kernel.fault=async p=>{if(p==='control-before-send')await f.owner.query("UPDATE enterprise_grants SET revision=revision+1 WHERE principal='reviewer'");};
 assert.equal((await work(f,x.id)).code,'STALE_APPROVAL');assert.equal(a.requests.length,0);
 const {restart}=await import('./helpers.mjs'),ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;
 for(let i=0;i<2;i++){const r=await work(f,x.id,'web','reconcile');assert.equal(r.observation,'ABSENT');assert.equal(r.requiresHumanReview,true);assert.equal(r.state,'UNKNOWN');}
 assert.ok(a.requests.every(r=>r.method==='GET'));assert.equal((await a.ledger()).length,0);await assert.rejects(work(f,x.id),{code:'STALE_APPROVAL'});
}));
nodeTest('BF-21 terminated worker and restored database retain revocation while observing exact effect',()=>withControls(async(f,{a,cluster})=>{
 const {spawn,execFileSync}=await import('node:child_process');const x=await release(f);await approve(f,x.id);
 const schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],path=cluster.directory+'/bf21-before.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);
 const {host,port,user,database,options}=f.state.pool.options;
 const exit=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['tests/enterprise/control-worker-child.mjs'],{stdio:['pipe','pipe','pipe']});let stderr='';child.stderr.on('data',x=>stderr+=x);child.on('error',reject);child.on('exit',code=>resolve({code,stderr}));child.stdin.end(JSON.stringify({config:{host,port,user,database,options},journal:f.journal.path,credential:f.credentials.manager,id:x.id,url:a.url}));});assert.equal(exit.code,73,exit.stderr);
 await bf21Grant(f,'reviewer',['read','search']);await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});
 const {restart}=await import('./helpers.mjs'),ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;
 const requests=a.requests.length;assert.equal((await work(f,x.id,'web','reconcile')).state,'ACCEPTED');assert.deepEqual(a.requests.slice(requests).map(r=>r.method),['GET']);assert.equal((await a.ledger())[0].applied,1);
 await assert.rejects(f.call('reviewer','releaseApprove',{id:x.id,role:'pr',revision:4,withdrawal:false}),{code:'PERMISSION_DENIED'});
}));
nodeTest('BF-21 lost withdrawal result can be observed after fresh withdrawal approver is revoked',()=>withControls(async(f,{a})=>{
 const x=await release(f);await approve(f,x.id);await work(f,x.id);await f.call('operator','releaseWithdraw',{id:x.id});await approve(f,x.id,true);
 f.kernel.fault=async p=>{if(p==='control-after-send')throw Error('lost withdrawal acknowledgement');};assert.equal((await work(f,x.id,'web','withdraw')).state,'WITHDRAW_UNKNOWN');f.kernel.fault=async()=>{};await bf21Grant(f,'reviewer',['read']);
 const requests=a.requests.length;assert.equal((await work(f,x.id,'web','reconcile')).state,'WITHDRAWN');assert.deepEqual(a.requests.slice(requests).map(r=>r.method),['GET']);assert.deepEqual((await a.ledger()).map(r=>({applied:r.applied,withdrawn:r.withdrawn})),[{applied:1,withdrawn:1}]);
}));

async function bf22Edit(f,x,http){
 const source=(await f.owner.query('SELECT data FROM enterprise_controls WHERE id=$1',[x.info])).rows[0].data.sources[0];
 const o=await f.call('operator','get',{id:source.id,purpose:'disclosure'});
 const response=await http.call('operator','edit',{id:o.id,revision:o.revision,purpose:'disclosure',fields:{...o.fields,title:'BF-22 corrected source'}});assert.equal(response.status,200);return source.id;
}
nodeTest('BF-22 public edit after UNKNOWN permits fixed GET and fresh withdrawal but blocks new dispatch and derivation',()=>withControls(async(f,{a,b})=>{
 const x=await release(f,{channels:['web','mail']});await approve(f,x.id);const http=await bf21Http(f);try{
 a.loseNext();await work(f,x.id);const original=(await f.owner.query('SELECT * FROM enterprise_control_deliveries WHERE id=$1 AND channel=$2',[x.id,'web'])).rows[0];
 await bf22Edit(f,x,http);await bf21Grant(f,'reviewer',['read']);
 const n=a.requests.length,result=await http.call('manager','controlWork',{id:x.id,channel:'web',mode:'reconcile'});console.log(JSON.stringify({bf22:{result,requests:a.requests.slice(n),ledger:await a.ledger()}}));
 assert.equal(result.status,200);assert.equal(result.body.result.state,'ACCEPTED');assert.deepEqual(a.requests.slice(n).map(r=>r.method),['GET']);
 const row=await f.call('manager','controlRead',{id:x.id});assert.equal(row.data.state,'PARTIAL');assert.equal(row.publicationBasis.text,original.event.payload.text);assert.equal(row.publicationBasis.sourceDigest,original.event.payload.sourceDigest);assert.equal(JSON.stringify(row).includes('BF-22 corrected source'),false);
 assert.equal((await http.call('manager','controlWork',{id:x.id,channel:'mail',mode:'dispatch'})).body.error.code,'RECOVERING');assert.equal(b.requests.length,0);
 await assert.rejects(f.call('manager','controlRead',{id:x.info,purpose:'disclosure'}),{code:'RECOVERING'});
 const {scope}=await import('./control-helper.mjs');await assert.rejects(f.call('operator','informationDerive',{id:crypto.randomUUID(),scope,sources:[x.info],purpose:'disclosure',label:'CONFIDENTIAL',transform:'export'}),{code:'RECOVERING'});
 await f.call('operator','releaseWithdraw',{id:x.id});await assert.rejects(work(f,x.id,'web','withdraw'),{code:'PERMISSION_DENIED'});await bf21Grant(f,'reviewer');await approve(f,x.id,true);
 assert.equal((await work(f,x.id,'web','withdraw')).state,'WITHDRAWN');assert.deepEqual((await a.ledger()).map(r=>({applied:r.applied,withdrawn:r.withdrawn})),[{applied:1,withdrawn:1}]);assert.equal(b.requests.length,0);
 }finally{await http.close();}
}));
nodeTest('BF-22 corrected source keeps current field purpose tenant and snapshot integrity boundaries',()=>withControls(async(f,{a})=>{
 const x=await release(f);await approve(f,x.id);a.loseNext();await work(f,x.id);const http=await bf21Http(f);try{const objectId=await bf22Edit(f,x,http),n=a.requests.length;
 for(const who of ['reader','other','tenant2'])assert.notEqual((await http.call(who,'controlWork',{id:x.id,channel:'web',mode:'reconcile'})).status,200);
 const {scope}=await import('./control-helper.mjs'),{operations}=await import('../../scripts/enterprise/fixture.mjs');
 await f.call('publisher','grant',{principal:'manager',scopes:[scope],operations,fields:['CONFIDENTIAL']});await assert.rejects(work(f,x.id,'web','reconcile'),{code:'PERMISSION_DENIED'});await bf21Grant(f,'manager');
 const info=(await f.owner.query('SELECT data FROM enterprise_controls WHERE id=$1',[x.info])).rows[0].data;await f.owner.query("UPDATE enterprise_controls SET data=jsonb_set(data,'{text}','\"forged historical basis\"') WHERE id=$1",[x.info]);await assert.rejects(work(f,x.id,'web','reconcile'),{code:'RECOVERING'});await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[x.info,info]);
 assert.equal(a.requests.length,n);
 // A newer policy can strengthen the same root; observation must honor it.
 await f.call('operator','informationCreate',{id:crypto.randomUUID(),scope,source:{kind:'object',id:objectId,projection:['title']},label:'CONFIDENTIAL',purposes:['summary']});await assert.rejects(work(f,x.id,'web','reconcile'),{code:'PERMISSION_DENIED'});assert.equal(a.requests.length,n);
 }finally{await http.close();}
}));
nodeTest('BF-22 worker exit and restored corrected source observe same operation after restart without resend',()=>withControls(async(f,{a,cluster})=>{
 const {spawn,execFileSync}=await import('node:child_process');const x=await release(f);await approve(f,x.id);const {host,port,user,database,options}=f.state.pool.options;
 const exit=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['tests/enterprise/control-worker-child.mjs'],{stdio:['pipe','pipe','pipe']});let stderr='';child.stderr.on('data',x=>stderr+=x);child.on('error',reject);child.on('exit',code=>resolve({code,stderr}));child.stdin.end(JSON.stringify({config:{host,port,user,database,options},journal:f.journal.path,credential:f.credentials.manager,id:x.id,url:a.url}));});assert.equal(exit.code,73,exit.stderr);
 const http=await bf21Http(f);try{await bf22Edit(f,x,http);}finally{await http.close();}
 const schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],path=cluster.directory+'/bf22-corrected.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);await bf21Grant(f,'reviewer',['read']);await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});
 const {restart}=await import('./helpers.mjs'),ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;const n=a.requests.length;
 for(let i=0;i<2;i++)assert.equal((await work(f,x.id,'web','reconcile')).state,'ACCEPTED');assert.deepEqual(a.requests.slice(n).map(r=>r.method),['GET','GET']);assert.equal((await a.ledger())[0].applied,1);
}));
nodeTest('BF-22 accepted publication correction supports withdrawal observation and unsupported media without success forgery',()=>withControls(async(f,{a,b})=>{
 const x=await release(f,{channels:['web','mail']});await approve(f,x.id);await work(f,x.id);await work(f,x.id,'mail');const http=await bf21Http(f);try{await bf22Edit(f,x,http);}finally{await http.close();}
 await f.call('operator','releaseWithdraw',{id:x.id});await approve(f,x.id,true);f.kernel.fault=async p=>{if(p==='control-after-send')throw Error('lost reversal response');};assert.equal((await work(f,x.id,'web','withdraw')).state,'WITHDRAW_UNKNOWN');f.kernel.fault=async()=>{};
 assert.equal((await work(f,x.id,'web','reconcile')).state,'WITHDRAWN');assert.equal((await work(f,x.id,'mail','withdraw')).state,'WITHDRAW_UNSUPPORTED');assert.equal((await b.ledger())[0].withdrawn,0);assert.deepEqual((await a.ledger()).map(r=>({applied:r.applied,withdrawn:r.withdrawn})),[{applied:1,withdrawn:1}]);
}));
nodeTest('BF-22 source edit after unsent UNKNOWN remains ABSENT after restart with no auto resend',()=>withControls(async(f,{a})=>{
 const x=await release(f);await approve(f,x.id);f.kernel.fault=async p=>{if(p==='control-before-send')throw Error('interrupted before external request');};assert.equal((await work(f,x.id)).state,'UNKNOWN');f.kernel.fault=async()=>{};const http=await bf21Http(f);try{await bf22Edit(f,x,http);}finally{await http.close();}assert.equal(a.requests.length,0);
 const {restart}=await import('./helpers.mjs'),ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;
 for(let i=0;i<2;i++){const result=await work(f,x.id,'web','reconcile');assert.equal(result.state,'UNKNOWN');assert.equal(result.observation,'ABSENT');assert.equal(result.requiresHumanReview,true);}assert.ok(a.requests.every(r=>r.method==='GET'));assert.equal((await a.ledger()).length,0);
}));

// BF-34: stored execution authority is not a public detail projection.
nodeTest('BF-34 public HTTP limits author and approval display across restore and withdrawal',()=>withControls(async(f,{a,b,cluster})=>{
 const {scope,operations}=await import('../../scripts/enterprise/fixture.mjs'),{execFileSync}=await import('node:child_process');
 const secret={...scope,departmentId:'bf34-secret-department',caseId:'bf34-unrelated-strict-case',classification:'STRICT'},fields=['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'];
 await f.owner.query("UPDATE enterprise_grants SET scopes=$1 WHERE principal='publisher'",[JSON.stringify([scope,secret])]);
 const grant=(principal,ops=operations,labels=fields)=>f.call('publisher','grant',{principal,scopes:principal==='reader'?[scope]:[scope,secret],operations:ops,fields:labels});
 for(const who of ['operator','manager','reviewer','publisher'])await grant(who);
 await grant('reader',['read','search'],['INTERNAL','CONFIDENTIAL']);const http=await bf21Http(f);
 const client={...f,call:async(who,op,body)=>{const r=await http.call(who,op,body);assert.equal(r.status,200,JSON.stringify(r));return r.body.result;}};
 const clean=r=>{const text=JSON.stringify(r);for(const marker of [secret.caseId,secret.departmentId,'"authority"','"scopes"','"fields"','"policyVersion"','"delegationId"','"binding"'])assert.equal(text.includes(marker),false,marker);};
 try{
 const hidden=f.create({scope:secret});await client.call('operator','create',hidden);assert.equal((await http.call('reader','get',{id:hidden.id})).status,404);
 const x=await release(client,{channels:['web','mail']});assert.equal((await http.call('operator','releaseApprove',{id:x.id,role:'legal',revision:1,withdrawal:false})).status,403);await approve(client,x.id);assert.equal((await http.call('reader','controlAudit',{id:x.id})).status,403);
 const saved=()=>f.owner.query('SELECT data FROM enterprise_controls WHERE id=$1',[x.id]).then(r=>r.rows[0].data),original=await saved();assert.ok(original.author.scopes.some(s=>s.caseId===secret.caseId));assert.ok(original.approvals.every(v=>v.authority.scopes.some(s=>s.caseId===secret.caseId)&&v.binding));
 const first=await http.call('reader','controlRead',{id:x.id});console.log(JSON.stringify({bf34BeforeOrAfter:first}));assert.equal(first.status,200);clean(first);assert.deepEqual(first.body.result.data.author,{subject:'operator'});assert.deepEqual(first.body.result.data.approvals,[{role:'legal',subject:'manager'},{role:'pr',subject:'reviewer'},{role:'ir',subject:'publisher'}]);assert.ok(first.body.result.publicationBasis.text);assert.equal(first.body.result.historyMode,'progress');assert.deepEqual(await saved(),original);
 await grant('reader',['read','search','audit'],['INTERNAL','CONFIDENTIAL']);const audit=await http.call('reader','controlAudit',{id:x.id});assert.equal(audit.status,200);assert.ok(audit.body.result.events.length);assert.equal(JSON.stringify(audit).includes(secret.caseId),false);assert.equal(JSON.stringify(audit).includes(secret.departmentId),false);clean(await http.call('reader','controlRead',{id:x.id}));assert.deepEqual(await saved(),original);
 a.loseNext();assert.equal((await http.call('manager','controlWork',{id:x.id,channel:'web',mode:'dispatch'})).body.result.state,'UNKNOWN');await grant('reviewer',['read','search']);
 const n=a.requests.length;assert.equal((await http.call('manager','controlWork',{id:x.id,channel:'web',mode:'reconcile'})).body.result.state,'ACCEPTED');assert.deepEqual(a.requests.slice(n).map(v=>v.method),['GET']);assert.equal((await http.call('manager','controlWork',{id:x.id,channel:'mail',mode:'dispatch'})).status,403);assert.equal(b.requests.length,0);assert.deepEqual((await saved()).approvals,original.approvals);
 await client.call('operator','releaseWithdraw',{id:x.id});await grant('reviewer');await approve(client,x.id,true);const withdrawal=await saved();assert.ok(withdrawal.withdrawalApprovals.every(v=>v.authority.scopes.some(s=>s.caseId===secret.caseId)&&v.binding));const projected=await http.call('reader','controlRead',{id:x.id});clean(projected);assert.deepEqual(projected.body.result.data.withdrawalApprovals,first.body.result.data.approvals);
 const schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database],path=cluster.directory+'/bf34-before-revocation.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);
 await grant('reader',['read','search','audit'],['INTERNAL']);assert.equal((await http.call('reader','controlRead',{id:x.id})).status,403);assert.equal((await http.call('reader','controlAudit',{id:x.id})).status,403);
 await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});const {restart}=await import('./helpers.mjs'),ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;
 // A fresh gateway uses the restarted kernel; the independent revocation journal survives.
 const restarted=await bf21Http(f);try{assert.equal((await restarted.call('reader','controlRead',{id:x.id})).status,403);assert.equal((await restarted.call('reader','controlAudit',{id:x.id})).status,403);const r=await restarted.call('manager','controlRead',{id:x.id});assert.equal(r.status,200);clean(r);assert.deepEqual(await saved(),withdrawal);
 f.kernel.fault=async p=>{if(p==='control-after-send')throw Error('BF-34 lost withdrawal response');};assert.equal((await restarted.call('manager','controlWork',{id:x.id,channel:'web',mode:'withdraw'})).body.result.state,'WITHDRAW_UNKNOWN');f.kernel.fault=async()=>{};const n=a.requests.length;assert.equal((await restarted.call('manager','controlWork',{id:x.id,channel:'web',mode:'reconcile'})).body.result.state,'WITHDRAWN');assert.deepEqual(a.requests.slice(n).map(v=>v.method),['GET']);clean(await restarted.call('manager','controlRead',{id:x.id}));assert.deepEqual((await saved()).withdrawalApprovals,withdrawal.withdrawalApprovals);
 assert.deepEqual((await a.ledger()).map(v=>({applied:v.applied,withdrawn:v.withdrawn})),[{applied:1,withdrawn:1}]);console.log(JSON.stringify({bf34Ledger:await a.ledger(),requests:a.requests}));
 }finally{await restarted.close();}
 }finally{await http.close();}
}));

nodeTest('BF-37 publication list enforces current lineage policy without changing approval basis after restore',()=>withControls(async(f,{a,b,cluster})=>{
 const {scope,operations}=await import('../../scripts/enterprise/fixture.mjs'),{source,rightBody}=await import('./control-helper.mjs'),{mkdir,writeFile}=await import('node:fs/promises'),{execFileSync}=await import('node:child_process'),{restart}=await import('./helpers.mjs');
 const output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser',trace=[];let http=await bf21Http(f);
 const call=async(who,op,body)=>{const r=await http.call(who,op,body);trace.push({who,op,body,...r});return r;},client={...f,call:async(who,op,body)=>{const r=await call(who,op,body);assert.equal(r.status,200,JSON.stringify(r));return r.body.result;}};
 const grant=(who,fields)=>client.call('publisher','grant',{principal:who,scopes:[scope],operations:who==='reader'?['read','search','audit']:operations,fields});
 const fields=['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'];
 const rows=()=>f.owner.query('SELECT id,revision,data FROM enterprise_controls WHERE kind=\'release\' ORDER BY id').then(r=>r.rows);
 const dump=name=>{const path=cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};
 const schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database];
 const restore=async path=>{await http.close();await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});const ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;http=await bf21Http(f);};
 const listed=async who=>{const r=await call(who,'controlList',{kind:'release'});assert.equal(r.status,200,JSON.stringify(r));return r.body.result.items;};
 try{
 await grant('operator',fields);await grant('manager',fields);await grant('reader',['INTERNAL','CONFIDENTIAL']);
 const x=await release(client),safe=await release(client);await approve(client,x.id);
 // A second publication uses two independent roots through a derived source.
 const p=await source(client),q=crypto.randomUUID(),doc=crypto.randomUUID(),object=f.create(),derived=crypto.randomUUID(),multi=crypto.randomUUID(),rights=[];
 await client.call('operator','create',object);await client.call('operator','documentUpload',{id:object.id,documentId:doc,name:'bf37-material',mime:'text/plain',classification:'CONFIDENTIAL',content:'synthetic BF-37 document',retainUntil:'2099-01-01T00:00:00Z'});await client.call('operator','informationCreate',{id:q,scope,source:{kind:'document',id:doc,objectId:object.id,version:1},label:'CONFIDENTIAL',purposes:['summary','disclosure']});
 await client.call('operator','informationDerive',{id:derived,scope,sources:[p,q],purpose:'disclosure',label:'CONFIDENTIAL',transform:'export'});
 for(const id of [p,q]){const root=(await client.call('manager','controlRead',{id,purpose:'disclosure'})).data.sources[0],right={...rightBody(),material:root.kind+':'+root.id};await client.call('manager','rightGrant',right);rights.push(right.id);}
 await client.call('operator','releaseCreate',{id:multi,scope,source:derived,subject:'synthetic-subject',purpose:'disclosure',channels:['web'],rights,region:'JP',indirect:false,embargo:'2020-01-01T00:00:00Z'});
 assert.equal((await call('reader','controlRead',{id:x.id})).status,200);assert.equal((await listed('reader')).length,3);const original=await rows(),old=dump('bf37-before-policy');
 const strengthen=async(info,label,purposes)=>{const {digest,...root}=(await client.call('manager','controlRead',{id:info,purpose:'disclosure'})).data.sources[0];return client.call('operator','informationCreate',{id:crypto.randomUUID(),scope,source:root,label,purposes});};
 await strengthen(x.info,'STRICT',['summary','disclosure']);assert.equal((await call('reader','controlRead',{id:x.id})).status,403);assert.equal((await call('manager','controlRead',{id:x.id})).status,200);
 const initial=await listed('reader');await mkdir(output,{recursive:true});await writeFile(output+'/bf37-initial.json',JSON.stringify({id:x.id,safe:safe.id,multi,initial,trace,original},null,2));
 assert.equal(initial.some(v=>v.id===x.id),false,'fresh list must not disclose strengthened publication');assert.ok(initial.some(v=>v.id===safe.id));assert.equal((await listed('manager')).find(v=>v.id===x.id).label,'STRICT');assert.deepEqual(await rows(),original);
 await strengthen(q,'STRICT',['summary','disclosure']);assert.equal((await listed('reader')).some(v=>v.id===multi),false);assert.equal((await listed('manager')).find(v=>v.id===multi).label,'STRICT');
 // Per-row basis corruption must neither fall back to a stale label nor hide a valid neighbor.
 await f.owner.query("UPDATE enterprise_controls SET data=jsonb_set(data,'{sourceDigest}','\"bf37-corrupt\"') WHERE id=$1",[x.id]);assert.equal((await listed('manager')).some(v=>v.id===x.id),false);assert.ok((await listed('manager')).some(v=>v.id===safe.id));await f.owner.query('UPDATE enterprise_controls SET data=$2 WHERE id=$1',[x.id,original.find(v=>v.id===x.id).data]);
 await strengthen(q,'STRICT',['summary']);assert.equal((await call('manager','controlRead',{id:multi})).status,403);assert.equal((await listed('manager')).some(v=>v.id===multi),false);assert.ok((await listed('reader')).some(v=>v.id===safe.id));
 for(const who of ['other','tenant2'])assert.deepEqual(await listed(who),[]);
 const complete=dump('bf37-complete');await restore(old);for(const who of ['reader','manager']){const r=await call(who,'controlList',{kind:'release'});assert.equal(r.body.error.code,'RECOVERING');assert.equal(JSON.stringify(r).includes(x.id),false);}await restore(complete);
 assert.equal((await listed('reader')).some(v=>v.id===x.id),false);assert.ok((await listed('manager')).some(v=>v.id===x.id));
 await grant('reader',fields);assert.ok((await listed('reader')).some(v=>v.id===x.id));const beforeRevoke=dump('bf37-before-revoke');await grant('reader',['INTERNAL','CONFIDENTIAL']);await restore(beforeRevoke);assert.equal((await listed('reader')).some(v=>v.id===x.id),false);assert.equal((await call('reader','controlRead',{id:x.id})).status,403);assert.ok((await listed('reader')).some(v=>v.id===safe.id));assert.deepEqual(await rows(),original);
 // Missing and inconsistent basis fail closed. Restore exact bytes afterwards.
 await f.owner.query('DELETE FROM enterprise_controls WHERE id=$1',[x.info]);assert.equal((await call('manager','controlList',{kind:'release'})).body.error.code,'RECOVERING');await restore(beforeRevoke);
 assert.ok((await listed('manager')).some(v=>v.id===x.id));assert.equal((await call('reader','controlRead',{id:x.id})).status,403);
 // Current legitimate approvers and exact-effect observation still work.
 a.loseNext();assert.equal((await call('manager','controlWork',{id:x.id,channel:'web',mode:'dispatch'})).body.result.state,'UNKNOWN');assert.equal((await call('manager','controlWork',{id:x.id,channel:'web',mode:'reconcile'})).body.result.state,'ACCEPTED');await client.call('operator','releaseWithdraw',{id:x.id});await approve(client,x.id,true);assert.equal((await call('manager','controlWork',{id:x.id,channel:'web',mode:'withdraw'})).body.result.state,'WITHDRAWN');assert.deepEqual((await a.ledger()).map(v=>({applied:v.applied,withdrawn:v.withdrawn})),[{applied:1,withdrawn:1}]);assert.equal(b.requests.length,0);
 }finally{await mkdir(output,{recursive:true});await writeFile(output+'/bf37-http.json',JSON.stringify({trace,requests:a.requests,ledger:await a.ledger()},null,2));await http.close();}
}));

nodeTest('BF-38-current-lineage-audit-denied-before-fix real HTTP regression',t=>withControls(async(f,{a,b,cluster})=>{
 const {scope,operations}=await import('../../scripts/enterprise/fixture.mjs'),{mkdir,writeFile}=await import('node:fs/promises'),{execFileSync}=await import('node:child_process'),{restart}=await import('./helpers.mjs');
 const output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser',trace=[],checks=[];let http=await bf21Http(f);
 const call=async(who,op,body)=>{const result=await http.call(who,op,body);trace.push({who,op,body,...result});return result;};
 const client={...f,call:async(who,op,body)=>{const r=await call(who,op,body);assert.equal(r.status,200,JSON.stringify(r));return r.body.result;}};
 const all=['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'],base=['INTERNAL','CONFIDENTIAL'];
 const grant=(fields,ops=['read','search','audit'],scopes=[scope])=>client.call('publisher','grant',{principal:'reader',scopes,operations:ops,fields});
 const snapshot=async()=>{const state={};for(const [table,order] of [['objects','id'],['actions','id'],['enterprise_instances','id'],['history','object_id,revision'],['outbox','operation_id'],['enterprise_controls','tenant,id'],['enterprise_control_history','tenant,id,revision'],['enterprise_control_deliveries','tenant,id,channel']])state[table]=(await f.owner.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;return {state,journal:f.kernel.journal.records(),requests:a.requests,mailRequests:b.requests,ledger:await a.ledger()};};
 const observe=async(label,who,op,body)=>{const before=await snapshot(),auditBefore=(await f.owner.query('SELECT * FROM audit ORDER BY sequence')).rows,response=await call(who,op,body),after=await snapshot(),auditAfter=(await f.owner.query('SELECT * FROM audit ORDER BY sequence')).rows;checks.push({label,response,before,after,auditBefore,auditAfter});assert.deepEqual(after,before,label+' business state');assert.deepEqual(auditAfter.slice(0,auditBefore.length),auditBefore,'immutable audit prefix');return response;};
 const schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database];
 const dump=name=>{const path=cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};
 const reconnect=async()=>{await http.close();const ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;http=await bf21Http(f);};
 const restore=async path=>{await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});await reconnect();};
 try{
 for(const who of ['operator','manager'])await client.call('publisher','grant',{principal:who,scopes:[scope],operations,fields:all});await grant(base);
 const x=await release(client),safe=await release(client);await approve(client,x.id);
 const original=await observe('authorized baseline','reader','controlAudit',{id:x.id});assert.equal(original.status,200);assert.ok(original.body.result.events.some(e=>e.operation==='releaseCreate'));assert.equal(original.body.result.history.length,4);
 const root=(await client.call('manager','controlRead',{id:x.info,purpose:'disclosure'})).data.sources[0],beforePolicy=dump('bf38-before-policy');
 await client.call('operator','informationCreate',{id:crypto.randomUUID(),scope,source:{kind:root.kind,id:root.id,projection:root.projection},label:'STRICT',purposes:['summary','disclosure']});
 const list=await observe('classified list','reader','controlList',{kind:'release'});assert.equal(list.status,200);assert.ok(!list.body.result.items.some(v=>v.id===x.id));assert.ok(list.body.result.items.some(v=>v.id===safe.id));
 assert.equal((await observe('classified detail','reader','controlRead',{id:x.id})).status,403);
 const denied=await observe('classified audit','reader','controlAudit',{id:x.id,purpose:'summary'});await mkdir(output,{recursive:true});await writeFile(output+'/BF38-initial.json',JSON.stringify({id:x.id,denied,trace,checks},null,2));await t.test('BF-38-current-lineage-audit-boundary-after-fix',()=>{assert.equal(denied.status,403,'current lineage must guard audit');assert.equal(denied.body.result,undefined);});
 assert.equal((await observe('safe neighbor','reader','controlAudit',{id:safe.id})).status,200);
 await grant(all);const permitted=await observe('clearance restored','reader','controlAudit',{id:x.id});await t.test('BF-38-authorized-audit-and-immutable-history-retained',()=>{assert.equal(permitted.status,200);assert.deepEqual(permitted.body.result.history,original.body.result.history);for(const event of original.body.result.events)assert.ok(permitted.body.result.events.some(v=>JSON.stringify(v)===JSON.stringify(event)));});
 const current=dump('bf38-current');await grant(base);await reconnect();assert.equal((await observe('restart denied','reader','controlAudit',{id:x.id})).status,403);await restore(current);assert.equal((await observe('old grant restored denied','reader','controlAudit',{id:x.id})).status,403);
 await restore(beforePolicy);assert.equal((await observe('classification absent','reader','controlAudit',{id:x.id})).body.error.code,'RECOVERING');await restore(current);assert.equal((await observe('classification restored','reader','controlAudit',{id:x.id})).status,403);
 await grant(all,['read','search']);assert.equal((await observe('audit permission removed','reader','controlAudit',{id:x.id})).status,403);await grant(all,['read','search','audit'],[]);assert.equal((await observe('scope removed','reader','controlAudit',{id:x.id})).status,404);await grant(all);
 for(const who of ['other','tenant2'])assert.equal((await observe('foreign '+who,who,'controlAudit',{id:x.id})).status,404);
 // Historical publication basis may differ from live source content. Audit
 // still needs current lineage authority, but must not rewrite past evidence.
 const object=await client.call('operator','get',{id:root.id,purpose:'disclosure'});await client.call('operator','edit',{id:object.id,revision:object.revision,purpose:'disclosure',fields:{...object.fields,title:'BF38 changed live title'}});
 assert.equal((await observe('historical basis retained','reader','controlAudit',{id:x.id})).status,200);
 await client.call('operator','informationCreate',{id:crypto.randomUUID(),scope,source:{kind:'object',id:root.id,projection:['title']},label:'STRICT',purposes:['summary']});
 assert.equal((await observe('stored disclosure purpose denied','reader','controlRead',{id:x.id,purpose:'summary'})).status,403);assert.equal((await observe('purpose cannot override publication','reader','controlAudit',{id:x.id,purpose:'summary'})).status,403);
 assert.equal((await observe('neighbor still authorized','reader','controlAudit',{id:safe.id})).status,200);assert.equal(a.requests.length,0);assert.equal(b.requests.length,0);
 }finally{await mkdir(output,{recursive:true});await writeFile(output+'/BF38-contract.json',JSON.stringify({trace,checks,requests:a.requests,mailRequests:b.requests,ledger:await a.ledger()},null,2));await http.close();}
}));

// BF-61: a historical vote is not authority to return its saved result or to
// accept another vote after the publication's source boundary has changed.
nodeTest('BF-61-current-lineage-new-and-replayed-approval-denied-before-fix public HTTP',t=>withControls(async(f,{a,b,cluster})=>{
 const {scope,operations}=await import('../../scripts/enterprise/fixture.mjs'),{mkdir,writeFile}=await import('node:fs/promises'),{execFileSync}=await import('node:child_process'),{restart}=await import('./helpers.mjs'),{enterpriseGateway}=await import('../../src/enterprise/gateway.mjs'),{tokenDigest}=await import('../../src/contracts.mjs');
 const output=process.env.ENTERPRISE_SUITE_OUTPUT??'evidence/enterprise/browser',trace=[],checks=[],all=['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'],base=['INTERNAL','CONFIDENTIAL'];let gateway;
 const connect=async()=>{for(const who of ['operator','manager','reviewer','publisher','other','tenant2'])await f.owner.query('INSERT INTO enterprise_browser_sessions VALUES($1,$2) ON CONFLICT DO NOTHING',[tokenDigest(f.credentials[who].token),'bf61-csrf']);gateway=await enterpriseGateway(f.kernel,{issuer:'http://127.0.0.1:1'});};await connect();
 const call=async(who,operation,body,key=crypto.randomUUID())=>{const request={contractVersion:'2.0.0',operation,body,key},r=await fetch(gateway.origin+'/api',{method:'POST',headers:{cookie:'enterprise_session='+f.credentials[who].token,origin:gateway.origin,'content-type':'application/json','x-csrf-token':'bf61-csrf'},body:JSON.stringify(request)}),result={status:r.status,body:await r.json()};trace.push({who,request,...result});return result;};
 const client={...f,call:async(who,op,body,key)=>{const r=await call(who,op,body,key);assert.equal(r.status,200,JSON.stringify(r));return r.body.result;}};
 const grant=(who,fields=all,scopes=[scope],ops=operations)=>client.call('publisher','grant',{principal:who,scopes,operations:ops,fields});
 const snapshot=async()=>{const state={};for(const [table,order] of [['objects','id'],['actions','id'],['enterprise_instances','id'],['history','object_id,revision'],['outbox','operation_id'],['enterprise_controls','tenant,id'],['enterprise_control_history','tenant,id,revision'],['enterprise_control_deliveries','tenant,id,channel']])state[table]=(await f.owner.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;return JSON.parse(JSON.stringify({state,journal:f.kernel.journal.records(),audit:(await f.owner.query('SELECT * FROM audit ORDER BY sequence')).rows,requests:a.requests,mailRequests:b.requests,ledger:await a.ledger()}));};
 const observe=async(label,who,op,body,key)=>{const before=await snapshot(),response=await call(who,op,body,key),after=await snapshot(),check={label,response,before,after};checks.push(check);return check;};
 const unchanged=c=>{assert.deepEqual(c.after.state,c.before.state,c.label+' business state');for(const n of ['requests','mailRequests','ledger'])assert.deepEqual(c.after[n],c.before[n],c.label+' '+n);assert.deepEqual(c.after.audit.slice(0,c.before.audit.length),c.before.audit);assert.deepEqual(c.after.journal.slice(0,c.before.journal.length),c.before.journal);assert.ok(c.after.journal.slice(c.before.journal.length).every(v=>['INTENT','ABORTED'].includes(v.phase)),c.label+' only aborted intents may append');};
 const denied=async(label,who,body,key,status=403)=>{const c=await observe(label,who,'releaseApprove',body,key);assert.equal(c.response.status,status,JSON.stringify(c.response));assert.equal(c.response.body.result,undefined);unchanged(c);return c;};
 const vote=(id,role,revision,withdrawal=false)=>({id,role,revision,withdrawal});
 const schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database];
 const dump=name=>{const path=cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};
 const reconnect=async()=>{await gateway.close();const ports=f.kernel.controlPorts;restart(f);f.kernel.controlPorts=ports;await connect();};
 const restore=async path=>{await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});await reconnect();};
 const classify=async(x,purposes=['summary','disclosure'])=>{const root=(await client.call('operator','controlRead',{id:x.info,purpose:'summary'})).data.sources[0];await client.call('operator','informationCreate',{id:crypto.randomUUID(),scope,source:{kind:root.kind,id:root.id,projection:root.projection},label:'STRICT',purposes});return root;};
 try{
 await grant('manager',base);await grant('reviewer',base);
 const x=await release(client),y=await release(client),safe=await release(client);
 // Establish a real accepted publication before exercising withdrawal votes.
 await approve(client,y.id);assert.equal((await client.call('manager','controlWork',{id:y.id,channel:'web',mode:'dispatch'})).state,'ACCEPTED');await client.call('operator','releaseWithdraw',{id:y.id});
 const xb=vote(x.id,'legal',1),yb=vote(y.id,'legal',(await client.call('manager','controlRead',{id:y.id})).revision,true),xkey=crypto.randomUUID(),ykey=crypto.randomUUID();
 const xr=await client.call('manager','releaseApprove',xb,xkey),yr=await client.call('manager','releaseApprove',yb,ykey);
 const original=(await client.call('operator','controlRead',{id:x.id})).data,withdrawalOriginal=(await client.call('operator','controlRead',{id:y.id})).data;
 const normalReplay=await observe('authorized initial replay','manager','releaseApprove',xb,xkey);assert.deepEqual(normalReplay.response.body.result,xr);unchanged(normalReplay);
 const beforePolicy=dump('bf61-before-policy');const root=await classify(x);await classify(y);
 assert.equal((await call('manager','controlRead',{id:x.id})).status,403);assert.equal((await call('manager','controlAudit',{id:x.id})).status,403);
 const initial=[];
 for(const [label,who,body,key] of [['release replay','manager',xb,xkey],['new release vote','reviewer',vote(x.id,'pr',xr.revision)],['withdrawal replay','manager',yb,ykey],['new withdrawal vote','reviewer',vote(y.id,'pr',yr.revision,true)]])initial.push(await observe(label,who,'releaseApprove',body,key));
 await mkdir(output,{recursive:true});await writeFile(output+'/BF61-initial.json',JSON.stringify({x,y,initial,trace},null,2));
 await t.test('BF-61-new-release-and-withdrawal-votes-current-boundary-after-fix',()=>{for(const c of initial){assert.equal(c.response.status,403,c.label+' must reject the approval request itself');assert.equal(c.response.body.result,undefined);unchanged(c);}});
 if(initial.some(c=>c.response.status!==403))return;
 await t.test('BF-61-original-purpose-replay-immutable-history-and-legitimate-withdrawal-retained',async()=>{
 const current=dump('bf61-current');await reconnect();await denied('restart replay','manager',xb,xkey);await denied('restart new vote','reviewer',vote(x.id,'pr',xr.revision));
 await restore(beforePolicy);const missing=await denied('classification absent after restore','manager',xb,xkey,400);assert.equal(missing.response.body.error.code,'RECOVERING');await restore(current);await denied('restored current classification','manager',xb,xkey);
 await grant('manager');const restoredGrant=dump('bf61-before-revocation');const replay=await observe('clearance restored replay','manager','releaseApprove',xb,xkey);assert.equal(replay.response.status,200);assert.deepEqual(replay.response.body.result,xr);unchanged(replay);
 await grant('manager',base);await restore(restoredGrant);await denied('old grant restored remains revoked','manager',xb,xkey);await grant('manager');
 await grant('reviewer',all,[]);await denied('scope revoked new vote','reviewer',vote(x.id,'pr',xr.revision),undefined,404);await grant('reviewer',all,[scope],['read','search']);await denied('approve permission revoked','reviewer',vote(x.id,'pr',xr.revision));await grant('reviewer');
 for(const who of ['other','tenant2'])await denied('foreign '+who,who,vote(x.id,'pr',xr.revision),undefined,404);
 // Live content changes do not rewrite historical publication or vote bindings.
 const object=await client.call('operator','get',{id:root.id,purpose:'disclosure'});await client.call('operator','edit',{id:object.id,revision:object.revision,purpose:'disclosure',fields:{...object.fields,title:'BF61 corrected live source'}});
 const historical=await observe('historical result after live correction','manager','releaseApprove',xb,xkey);assert.deepEqual(historical.response.body.result,xr);unchanged(historical);
 assert.deepEqual((await client.call('operator','controlRead',{id:x.id})).data,original);
 await client.call('reviewer','releaseApprove',vote(x.id,'pr',xr.revision));const priorIr=(await client.call('publisher','controlRead',{id:x.id})).revision;
 await grant('publisher',base);await denied('final IR vote cannot enqueue','publisher',vote(x.id,'ir',priorIr));await client.call('manager','grant',{principal:'publisher',scopes:[scope],operations,fields:all});
 await client.call('operator','informationCreate',{id:crypto.randomUUID(),scope,source:{kind:root.kind,id:root.id,projection:root.projection},label:'STRICT',purposes:['summary']});await denied('saved disclosure purpose replay','manager',xb,xkey);await denied('saved disclosure purpose new vote','publisher',vote(x.id,'ir',priorIr));
 const alternate=await observe('request purpose cannot replace original','manager','releaseApprove',{...xb,purpose:'summary'},xkey);assert.notEqual(alternate.response.status,200);unchanged(alternate);
 const safeRead=await client.call('manager','controlRead',{id:safe.id});await client.call('manager','releaseApprove',vote(safe.id,'legal',safeRead.revision));
 // Correcting live content must not strand an otherwise authorized withdrawal.
 const yroot=(await client.call('operator','controlRead',{id:y.info,purpose:'disclosure'})).data.sources[0],yo=await client.call('operator','get',{id:yroot.id,purpose:'disclosure'});await client.call('operator','edit',{id:yo.id,revision:yo.revision,purpose:'disclosure',fields:{...yo.fields,title:'BF61 withdrawal source correction'}});
 const oldWithdrawal=await observe('authorized withdrawal replay','manager','releaseApprove',yb,ykey);assert.equal(oldWithdrawal.response.status,200);assert.deepEqual(oldWithdrawal.response.body.result,yr);unchanged(oldWithdrawal);
 const ybefore=await client.call('operator','controlRead',{id:y.id});assert.deepEqual(ybefore.data,withdrawalOriginal);await client.call('reviewer','releaseApprove',vote(y.id,'pr',ybefore.revision,true));const ynow=await client.call('publisher','controlRead',{id:y.id});await client.call('publisher','releaseApprove',vote(y.id,'ir',ynow.revision,true));
 assert.notEqual((await call('manager','controlWork',{id:y.id,channel:'web',mode:'withdraw'})).status,200,'historical revoked vote cannot authorize external withdrawal');
 const z=await release(client);await approve(client,z.id);await client.call('manager','controlWork',{id:z.id,channel:'web',mode:'dispatch'});await client.call('operator','releaseWithdraw',{id:z.id});const zr=(await client.call('operator','controlRead',{id:z.info,purpose:'disclosure'})).data.sources[0],zo=await client.call('operator','get',{id:zr.id,purpose:'disclosure'});await client.call('operator','edit',{id:zo.id,revision:zo.revision,purpose:'disclosure',fields:{...zo.fields,title:'corrected before legitimate withdrawal'}});await approve(client,z.id,true);assert.equal((await client.call('manager','controlWork',{id:z.id,channel:'web',mode:'withdraw'})).state,'WITHDRAWN');const ledger=await a.ledger();assert.equal(ledger.length,2);assert.ok(ledger.every(v=>v.applied===1));assert.equal(ledger.reduce((n,v)=>n+v.withdrawn,0),1);
 });
 }finally{await mkdir(output,{recursive:true});await writeFile(output+'/BF61-contract.json',JSON.stringify({trace,checks,requests:a.requests,mailRequests:b.requests,ledger:await a.ledger()},null,2));await gateway.close();}
}));
