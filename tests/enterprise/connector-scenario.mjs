import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {scope} from '../../scripts/enterprise/fixture.mjs';
import {vote} from './helpers.mjs';
import {referenceEffects} from '../../scripts/enterprise/reference/effects.mjs';
import {ConnectorPort} from '../../src/enterprise/connectors.mjs';
export async function connection(f,cluster,domain){
 const server=await referenceEffects(cluster,{domain,secret:'synthetic-secret',destination:'synthetic-target'});
 const registry={[domain]:{url:server.url,secretRefs:['test-secret'],destinations:['synthetic-target'],secrets:{'test-secret':'synthetic-secret'}}};
 f.kernel.connections=registry;const body={id:domain,provider:domain,secretRef:'test-secret',scope,destination:'synthetic-target',active:true};
 try{await f.call('manager','connectionSet',body);}catch(error){await server.close();throw error;}return {server,registry,body,port:new ConnectorPort(registry)};
}
export async function routed(f,connectionId){const b=f.create();await f.call('operator','create',b);await f.call('operator','routeSet',{id:b.id,connectionId});for(const who of ['manager','reviewer','publisher'])await vote(f,who,b.id);return b;}
export const workerChild=(f,registry,id,mode,crash)=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,['tests/enterprise/worker-child.mjs'],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',c=>stdout+=c);p.stderr.on('data',c=>stderr+=c);p.on('error',reject);p.on('close',code=>resolve({code,stdout,stderr}));const {host,port,user,database,options}=f.state.pool.options;p.stdin.end(JSON.stringify({config:{host,port,user,database,options},journal:f.journal.path,credential:f.credentials.manager,id,mode,registry,crash}));});
export async function conformance(f,cluster,domain){const c=await connection(f,cluster,domain);try{
 const b=await routed(f,domain);c.server.fault('lost-ack');assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'dispatch'},c.port)).state,'UNKNOWN');
 assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'reconcile'},c.port)).state,'SUCCEEDED');
 assert.equal((await f.kernel.enterpriseWork(f.credentials.manager,{id:b.id,mode:'compensate'},c.port)).state,'COMPENSATED');
 const [effect]=await c.server.ledger();assert.equal(effect.applications,1);assert.equal(effect.reversals,1);assert.equal(effect.payload.domain,domain);assert.equal(effect.payload.sourceOfTruth,'enterprise');assert.equal(effect.payload.stableId,'t1:'+domain+':'+b.id);assert.equal(effect.payload.changes.title,b.fields.title);assert.equal(JSON.stringify(effect.payload).includes(b.fields.memo),false);return effect;
 }finally{await c.server.close();}}
