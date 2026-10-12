import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {startErp} from '../../scripts/foundation/erp.mjs';
import {FileSecrets,ServiceSecrets} from '../../src/secrets.mjs';
import {HttpWritebackPort,Writeback} from '../../src/writeback.mjs';
import {createGateway} from '../../src/gateway.mjs';
import {createClient} from '../../src/generated/client.mjs';
let cluster;before(async()=>{cluster=await startCluster();});after(async()=>{await cluster?.close();});
const code=c=>e=>e.code===c;
async function run(fn){const f=await fixture(cluster),erp=await startErp(cluster);try{const keyPath=join(cluster.directory,randomBytes(8).toString('hex'));await writeFile(keyPath,randomBytes(32),{mode:0o600});const cap=Object.freeze({}),provider=new FileSecrets(cluster.directory,keyPath,{capability:cap}),ref=await provider.inject(erp.token),access=new ServiceSecrets(provider,cap,f.kernel,[{ref,actor:'writeback-service',tenant:'t1',store:'s1'}]);f.kernel.writeback=new Writeback(f.kernel,new HttpWritebackPort(erp.url,()=>access.resolve(ref,f.credentials['writeback-service'])));await fn({...f,erp,access,provider,ref});}finally{await erp.close();await f.close();}}
test('per-reference service authorization and Audit gate actual outbound ERP delivery and identity revocation',()=>run(async f=>{
 await assert.rejects(f.access.resolve(f.ref,f.credentials.manager),code('PERMISSION_DENIED'));
 const other=await f.provider.inject(randomBytes(32).toString('hex'));await assert.rejects(f.access.resolve(other,f.credentials['writeback-service']),code('PERMISSION_DENIED'));
 const a=await f.kernel.submit(f.credentials.operator,f.request());assert.equal((await f.kernel.dispatch(f.credentials.manager,a)).state,'DELIVERED');
 const audit=(await f.owner.query("SELECT record FROM audit WHERE record->>'kind' IN ('SecretResolved','SecretDenied') ORDER BY sequence")).rows.map(r=>r.record);assert.ok(audit.some(r=>r.kind==='SecretResolved'&&r.actor==='writeback-service'&&r.reference===f.ref));assert.ok(audit.some(r=>r.kind==='SecretDenied'&&r.reference===other));assert.ok(!JSON.stringify(audit).includes(f.erp.token));
 await f.owner.query("UPDATE principals SET active=false WHERE id='writeback-service'");const b=await f.kernel.submit(f.credentials.operator,f.request({expectedRevision:2,input:{targetId:'stock',isolated:false}}));assert.equal((await f.kernel.dispatch(f.credentials.manager,b)).state,'UNKNOWN');assert.equal(f.erp.controller.applyRequests,1);
 await mkdir('evidence/generated/foundation',{recursive:true});await writeFile('evidence/generated/foundation/secret-access-trace.json',JSON.stringify({audit,revokedDelivery:'UNKNOWN',applyRequests:f.erp.controller.applyRequests},null,2)+'\n');
}));
test('Audit failure prevents secret release and external HTTP effect',()=>run(async f=>{
 const a=await f.kernel.submit(f.credentials.operator,f.request());await f.owner.query('REVOKE INSERT ON audit FROM foundation_app');
 await assert.rejects(f.access.resolve(f.ref,f.credentials['writeback-service']),code('UNAVAILABLE'));
 await assert.rejects(f.kernel.dispatch(f.credentials.manager,a),code('UNAVAILABLE'));assert.equal(f.erp.controller.applyRequests,0);
 await f.owner.query('GRANT INSERT ON audit TO foundation_app');
}));
test('redacted scoped operational observations expose unknown delivery and reject unauthorized/foreign views over HTTP',()=>run(async f=>{
 f.erp.controller.mode='lost-ack';const a=await f.kernel.submit(f.credentials.operator,f.request());await f.kernel.dispatch(f.credentials.manager,a);
 await f.owner.query("UPDATE outbox SET created_at=now()-interval '2 minutes' WHERE operation_id=$1",[a.operationId]);
 const server=createGateway(f.kernel);await new Promise(r=>server.listen(0,'127.0.0.1',r));try{const client=id=>createClient({url:`http://127.0.0.1:${server.address().port}`,tenant:'t1',token:f.credentials[id].token});const view=await client('manager').observe({});assert.ok(view.actions.some(r=>r.state==='PENDING_EXTERNAL'&&r.count===1));assert.ok(view.outbox.some(r=>r.state==='UNKNOWN'&&r.count===1));assert.ok(view.outbox.find(r=>r.state==='UNKNOWN').oldestAgeSeconds>=119);const foreign=await client('other').observe({});assert.equal(foreign.actions.length,0);assert.equal(foreign.outbox.length,0);await assert.rejects(client('operator').observe({}),code('PERMISSION_DENIED'));const text=JSON.stringify(view);for(const secret of [f.erp.token,'hidden-word',f.credentials.manager.token])assert.ok(!text.includes(secret));await writeFile('evidence/generated/foundation/observability-trace.json',JSON.stringify(view,null,2)+'\n');}finally{await new Promise(r=>server.close(r));}
}));
