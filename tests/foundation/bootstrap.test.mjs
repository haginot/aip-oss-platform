import test from 'node:test';import assert from 'node:assert/strict';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {invoke} from '../../src/gateway.mjs';
import {createGateway} from '../../src/gateway.mjs';
import {createClient} from '../../src/generated/client.mjs';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {readFile,stat} from 'node:fs/promises';
import {dirname} from 'node:path';
test('empty isolated database migrates, seeds and probes public contract; fixed versions are mandatory',async()=>{
 const cluster=await startCluster();let f,server;
 try{assert.equal(process.version,'v22.23.3','Pinned Node bootstrap required');assert.match(cluster.version,/^18\.6(?:\D|$)/,'Pinned PostgreSQL bootstrap required');
 f=await fixture(cluster);const reply=await invoke(f.kernel,f.credentials.operator,{contractVersion:'1.0.0',requestId:'bootstrap',traceId:'bootstrap',tenant:'t1',operation:'get',body:{id:'stock'}});assert.equal(reply.result.revision,1);
 server=createGateway(f.kernel);server.listen(0,'127.0.0.1');await once(server,'listening');
 const client=createClient({url:`http://127.0.0.1:${server.address().port}`,token:f.credentials.operator.token,tenant:'t1'});
 assert.equal((await client.get({id:'stock'})).revision,1);
 const request=f.request();const committed=await client.submit(request);
 assert.equal(committed.state,'PENDING_EXTERNAL');assert.equal(committed.result.objectRevision,2);
 assert.equal((await client.submit(request)).actionId,committed.actionId);
 await assert.rejects(client.submit({...request,input:{...request.input,isolated:!request.input.isolated}}),{code:'IDEMPOTENCY_MISMATCH'});
 assert.equal((await client.status({actionId:committed.actionId})).actionId,committed.actionId);
 assert.equal((await client.get({id:'stock'})).revision,2);
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await f?.close();await cluster.close();}
});
test('documented serve entry boots isolated Kernel and ERP, completes HTTP Action and disposes its data', {timeout:30000}, async()=>{
 const child=spawn(process.execPath,['scripts/foundation/serve.mjs'],{stdio:['ignore','pipe','pipe']});
 const exited=once(child,'exit');let stderr='',line='',info;
 child.stderr.on('data',chunk=>{stderr+=chunk;});
 try {
  info=await new Promise((resolve,reject)=>{
   child.stdout.on('data',chunk=>{line+=chunk;if(line.includes('\n')){try{resolve(JSON.parse(line.split('\n')[0]));}catch(error){reject(error);}}});
   child.once('error',reject);child.once('exit',code=>reject(Error(`serve exited ${code}: ${stderr}`)));
  });
  assert.equal(info.node,'v22.23.3');assert.match(info.postgres,/^18\.6(?:\D|$)/);assert.equal(info.pinnedBootstrap,true);
  assert.equal((await stat(info.credentialsPath)).mode&0o777,0o600);
  const credentials=JSON.parse(await readFile(info.credentialsPath,'utf8'));
  const operator=createClient({url:info.url,tenant:'t1',token:credentials.operator.token});
  const manager=createClient({url:info.url,tenant:'t1',token:credentials.manager.token});
  const action=await operator.submit({actionType:'SetIsolation',actionVersion:'1.0.0',ontologyVersion:'1.0.0',input:{targetId:'stock',isolated:true},expectedRevision:1,idempotencyKey:'serve-smoke',evidence:[]});
  assert.equal((await manager.dispatch(action)).state,'DELIVERED');
  assert.equal((await operator.status(action)).state,'SUCCEEDED');
 }finally{child.kill('SIGTERM');const [code,signal]=await exited;assert.equal(code,0,stderr);assert.equal(signal,null);}
 await assert.rejects(stat(dirname(info.credentialsPath)),{code:'ENOENT'});
});

test('partial startup failure after real ERP creation cleans only owned resources and exits nonzero',async()=>{
 const child=spawn(process.execPath,['scripts/foundation/serve.mjs','--fail-after-erp'],{stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
 const [code,signal]=await once(child,'exit');assert.equal(code,1);assert.equal(signal,null);
 const diagnostic=JSON.parse(stderr.split('\n').find(line=>line.startsWith('{')));assert.equal(diagnostic.startupFailure,'injected partial startup failure');
 await assert.rejects(stat(diagnostic.ownedDirectory),{code:'ENOENT'});
});
