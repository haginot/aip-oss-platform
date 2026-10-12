import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {startErp} from '../../scripts/foundation/erp.mjs';
import {Writeback,HttpWritebackPort} from '../../src/writeback.mjs';
import {FileSecrets} from '../../src/secrets.mjs';
let cluster;before(async()=>{cluster=await startCluster();});after(async()=>{await cluster?.close();});
const code=c=>e=>e.code===c;
async function run(fn){const f=await fixture(cluster),erp=await startErp(cluster);try{const keyPath=join(cluster.directory,randomBytes(8).toString('hex')+'.key');await writeFile(keyPath,randomBytes(32),{mode:0o600});let now=Date.now();const capability=Object.freeze({}),secrets=new FileSecrets(cluster.directory,keyPath,{capability,clock:()=>now}),ref=await secrets.inject(erp.token);const port=new HttpWritebackPort(erp.url,()=>secrets.resolve(ref,capability));f.kernel.writeback=new Writeback(f.kernel,port);await fn({...f,erp,keyPath,capability,secrets,ref,port,advance(ms){now+=ms;}});}finally{await erp.close();await f.close();}}
test('encrypted opaque reference is injected into actual ERP HTTP writeback; unauthorized resolution rejects',()=>run(async f=>{
 const file=await readFile(f.secrets.path(f.ref),'utf8');assert.ok(!file.includes(f.erp.token));
 for(const impostor of ['writeback','manager',{},null])await assert.rejects(f.secrets.resolve(f.ref,impostor),code('PERMISSION_DENIED'));
 await assert.rejects(f.secrets.resolve('../key',f.capability),code('INVALID_ARGUMENT'));
 const a=await f.kernel.submit(f.credentials.operator,f.request());assert.equal((await f.kernel.dispatch(f.credentials.manager,a)).state,'DELIVERED');
 const audit=JSON.stringify((await f.owner.query('SELECT record FROM audit')).rows),outbox=JSON.stringify((await f.owner.query('SELECT event FROM outbox')).rows),journal=await readFile(f.journal.path,'utf8');
 for(const text of [audit,outbox,journal]){assert.ok(!text.includes(f.erp.token));assert.ok(!text.includes((await readFile(f.keyPath)).toString('hex')));}
 assert.equal((await f.kernel.status(f.credentials.operator,a)).state,'SUCCEEDED');
}));
test('rotation overlap, expiration and remote old-token revocation preserve one ERP effect per operation',()=>run(async f=>{
 const next=randomBytes(32).toString('hex');f.erp.tokens.add(next);await f.secrets.rotate(f.ref,next,1000,f.capability);
 assert.equal(await f.secrets.resolve(f.ref,f.capability,{previous:true}),f.erp.token);assert.equal(await f.secrets.resolve(f.ref,f.capability),next);
 const a=await f.kernel.submit(f.credentials.operator,f.request());assert.equal((await f.kernel.dispatch(f.credentials.manager,a)).state,'DELIVERED');
 f.advance(1000);f.erp.tokens.delete(f.erp.token);await assert.rejects(f.secrets.resolve(f.ref,f.capability,{previous:true}),code('PERMISSION_DENIED'));
 const payload=(await f.erp.owner.query('SELECT payload FROM ledger')).rows[0].payload;await assert.rejects(new HttpWritebackPort(f.erp.url,f.erp.token).apply(payload));
 assert.equal((await f.port.apply(payload)).state,'DUPLICATE');assert.equal((await f.erp.owner.query('SELECT count(*) FROM ledger')).rows[0].count,'1');
}));
test('unsafe permissions, wrong key and modified ciphertext reject; missing secret holds unknown without HTTP',()=>run(async f=>{
 await chmod(f.keyPath,0o644);await assert.rejects(f.secrets.resolve(f.ref,f.capability),code('PERMISSION_DENIED'));await chmod(f.keyPath,0o600);
 await writeFile(f.keyPath,randomBytes(32));await assert.rejects(f.secrets.resolve(f.ref,f.capability),code('PERMISSION_DENIED'));
 const a=await f.kernel.submit(f.credentials.operator,f.request());assert.equal((await f.kernel.dispatch(f.credentials.manager,a)).state,'UNKNOWN');assert.equal(f.erp.controller.applyRequests,0);
 assert.equal((await f.kernel.status(f.credentials.operator,a)).state,'PENDING_EXTERNAL');
 const path=f.secrets.path(f.ref),row=JSON.parse(await readFile(path,'utf8'));row.active.tag='00'.repeat(16);await writeFile(path,JSON.stringify(row));await assert.rejects(f.secrets.resolve(f.ref,f.capability),code('PERMISSION_DENIED'));
 assert.equal((await f.kernel.dispatch(f.credentials.manager,a)).state,'UNKNOWN');assert.equal(f.erp.controller.applyRequests,0);
}));
