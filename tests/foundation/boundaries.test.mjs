import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {createGateway} from '../../src/gateway.mjs';
import {createClient} from '../../src/generated/client.mjs';
let cluster;before(async()=>{cluster=await startCluster();});after(async()=>{await cluster?.close();});
async function run(fn,options){const f=await fixture(cluster),server=createGateway(f.kernel,options);await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`,c=createClient({url,tenant:'t1',...f.credentials.operator});try{await fn(f,c,url,server);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await f.close();}}
test('advertised unavailable capabilities reject through real HTTP with no business side effects',()=>run(async(f,c)=>{
 const profile=await c.capabilities();assert.deepEqual(profile.unavailable,['model','agent','embedding','parse','feature','stream','cache','lake-table']);
 for(const name of profile.unavailable)await assert.rejects(c.capability({name}),{code:'UNSUPPORTED_CAPABILITY'});
 await assert.rejects(c.capability({name:'unknown'}),{code:'INVALID_ARGUMENT'});
 assert.equal((await f.owner.query('SELECT count(*) FROM actions')).rows[0].count,'0');assert.equal((await f.owner.query('SELECT count(*) FROM outbox')).rows[0].count,'0');
 assert.equal((await c.get({id:'stock'})).revision,1);
 assert.ok(Number((await f.owner.query("SELECT count(*) FROM audit WHERE record->>'code'='UNSUPPORTED_CAPABILITY'")).rows[0].count)>=8);
}));
test('typed link rejects corruption and out-of-budget depth; empty links still enforce column authorization',()=>run(async(f,c)=>{
 await assert.rejects(c.traverse({id:'lot',link:'stock',depth:3}),{code:'INVALID_ARGUMENT'});
 await f.owner.query("DELETE FROM links WHERE source='lot'");
 await assert.rejects(c.traverse({id:'lot',link:'stock',projection:['secret']}),{code:'PERMISSION_DENIED'});
 await f.owner.query("INSERT INTO links(source,target,type) VALUES('lot','store','stock')");
 await assert.rejects(c.traverse({id:'lot',link:'stock'}),{code:'INCONSISTENT_STATE'});
}));
test('HTTP admission limits concurrent slow requests and request rate before mutation',()=>run(async(f,c,url,server)=>{
 const arrived=new Promise(r=>server.once('request',r));const slow=request(new URL('/rpc',url),{method:'POST',headers:{'content-length':100}});slow.on('error',()=>{});slow.write('{');await arrived;
 try{await assert.rejects(c.get({id:'stock'}),{code:'RATE_LIMITED'});}finally{slow.destroy();}
 assert.equal((await f.owner.query('SELECT count(*) FROM actions')).rows[0].count,'0');
},{maxConcurrent:1,maxRequestsPerSecond:100}));
test('HTTP request-rate budget is enforced independently of concurrency',()=>run(async(f,c)=>{
 assert.equal((await c.get({id:'stock'})).revision,1);await assert.rejects(c.submit(f.request()),{code:'RATE_LIMITED'});
 assert.equal((await f.owner.query('SELECT count(*) FROM actions')).rows[0].count,'0');
},{maxRequestsPerSecond:1}));
test('HTTP malformed/oversize/version/deadline inputs cannot mutate business state',()=>run(async(f,c,url)=>{
 for(const body of ['{','"'+ 'x'.repeat(1048576)+'"']){
  const response=await fetch(url+'/rpc',{method:'POST',body});assert.equal((await response.json()).error.code,'INVALID_ARGUMENT');
 }
 const base={contractVersion:'1.0.0',requestId:'boundary',traceId:'boundary',tenant:'t1',operation:'get',body:{id:'stock'}};
 for(const [body,timeout,expected] of [[{...base,contractVersion:'9'},'1000','UNSUPPORTED_VERSION'],[base,'0','INVALID_ARGUMENT']]){
  const response=await fetch(url+'/rpc',{method:'POST',headers:{authorization:`Bearer ${f.credentials.operator.token}`,'x-timeout-ms':timeout},body:JSON.stringify(body)});assert.equal((await response.json()).error.code,expected);
 }
 await assert.rejects(f.kernel.traverse(f.credentials.operator,{id:'lot',link:'stock'},{deadline:Date.now()-1}),{code:'DEADLINE_EXCEEDED'});
 assert.equal((await f.owner.query('SELECT count(*) FROM actions')).rows[0].count,'0');
}));
