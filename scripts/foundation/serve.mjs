import {seedStore} from '../demo/seed.mjs';
import {createContractClient} from '../../src/client-transport.mjs';
import {startScheduler} from '../../src/trigger.mjs';
import {startCluster,fixture} from './runtime.mjs';
import {FileSecrets,ServiceSecrets} from '../../src/secrets.mjs';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';import {join} from 'node:path';
import {createGateway} from '../../src/gateway.mjs';
import {startErp} from './erp.mjs';
import {Writeback,HttpWritebackPort} from '../../src/writeback.mjs';
const cluster=await startCluster();let f,server,erp,scheduler;
try {
 if(process.version!=='v22.23.3'||!cluster.version.startsWith('18.6'))throw Error('fixed-version bootstrap required');
 f=await fixture(cluster,{definitionPath:process.argv.includes('--store-demo')?'config/store-ontology.json':'config/ontology.json'});if(process.argv.includes('--store-demo'))await seedStore(f);erp=await startErp(cluster);
 if(process.argv.includes('--fail-after-erp'))throw Error('injected partial startup failure');
 const keyPath=join(cluster.directory,'synthetic-key');await writeFile(keyPath,randomBytes(32),{mode:0o600});
 const capability=Object.freeze({});const secrets=new FileSecrets(cluster.directory,keyPath,{capability}),ref=await secrets.inject(erp.token);
 const access=new ServiceSecrets(secrets,capability,f.kernel,[{ref,actor:'writeback-service',tenant:'t1',store:'s1'}]);
 f.kernel.writeback=new Writeback(f.kernel,new HttpWritebackPort(erp.url,options=>access.resolve(ref,f.credentials['writeback-service'],options)));server=createGateway(f.kernel);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 scheduler=startScheduler(f.kernel,f.credentials.manager,{onError:code=>console.error(JSON.stringify({schedulerError:code}))});
 const credentialsPath=join(cluster.directory,'synthetic-sessions.json');await writeFile(credentialsPath,JSON.stringify(f.credentials),{mode:0o600});
 const probe=createContractClient({url:`http://127.0.0.1:${server.address().port}`,tenant:'t1',token:f.credentials.manager.token},f.definition);
 const ontology=await probe.ontology();const stock=await probe.get({id:'stock'});await probe.observe({});
 if(process.argv.includes('--store-demo')){const recall=await probe.get({id:'recall'});if(recall.type!=='RecallCase'||stock.revision!==1)throw Error('demo precondition failed');}
 const runtimePlatform=process.argv.includes('--store-demo')?{postgresConfigure:execFileSync('pg_config',['--configure'],{encoding:'utf8'}).trim(),binaries:['postgres','psql','node'].map(binary=>{const path=execFileSync('which',[binary],{encoding:'utf8'}).trim();return {binary,path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex'),linkage:execFileSync('otool',['-L',path],{encoding:'utf8'})};})}:undefined;
 if(runtimePlatform){if(!runtimePlatform.postgresConfigure.includes('--without-icu')||!runtimePlatform.postgresConfigure.includes('--without-readline')||runtimePlatform.binaries.filter(b=>b.binary!=='node').some(b=>/homebrew|openssl|icu4c/.test(b.linkage)))throw Error('release runtime profile mismatch: use an empty dedicated mise data/cache');}
 console.log(JSON.stringify({runtimePlatform,health:'PASS',migration:'001-foundation',seed:process.argv.includes('--store-demo')?'store-seed:1':'seed:1',ontologyVersion:ontology.definition.ontologyVersion,demoPreflight:process.argv.includes('--store-demo')?'PASS':'foundation',url:`http://127.0.0.1:${server.address().port}/rpc`,credentialsPath,node:process.version,postgres:cluster.version,pinnedBootstrap:true,erpDatabase:erp.database,data:'synthetic-only'}));
 const stop=async()=>{await scheduler.close();await new Promise(resolve=>server.close(resolve));await erp.close();await f.close();await cluster.close();process.exit(0);};process.once('SIGINT',stop);process.once('SIGTERM',stop);if(process.argv.includes('--check'))await stop();
}catch(error){console.error(JSON.stringify({startupFailure:error.message,ownedDirectory:cluster.directory}));await scheduler?.close();await erp?.close();await f?.close();await cluster.close();throw error;}
