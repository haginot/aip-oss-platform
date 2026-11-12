import {seedProcurement} from './procurement-seed.mjs';
import {referencePublication} from './reference/publication.mjs';
import {referenceProposals} from './reference/proposals.mjs';
import {ProposalPort} from '../../src/enterprise/proposals.mjs';
// Disposable, loopback-only environment; all accounts and business values synthetic.
import {startCluster,enterpriseFixture,scope} from './fixture.mjs';
import {referenceOIDC} from './reference/oidc.mjs';
import {referenceEffects} from './reference/effects.mjs';
import {ConnectorPort} from '../../src/enterprise/connectors.mjs';
import {SyntheticPort} from '../../src/enterprise/worker.mjs';
import {enterpriseGateway} from '../../src/enterprise/gateway.mjs';
export async function localEnvironment({governance=false,procurement=false,fixtureOptions={}}={}){
 const cluster=await startCluster();let f,idp,effects,gateway,model,web,mail,purchasing;
 try{f=await enterpriseFixture(cluster,{...fixtureOptions,documentScanner:async bytes=>!bytes.toString().includes('SYNTHETIC-MALWARE')});idp=await referenceOIDC(cluster);effects=await referenceEffects(cluster,governance?{domain:'mail',secret:'local-synthetic-secret',destination:'local-inbox'}:{});
 if(procurement&&governance)throw Error('Procurement uses its loopback order port; start with --procurement only');
 if(procurement)purchasing=await seedProcurement(f);
 web=await referencePublication(cluster);mail=await referencePublication(cluster,{withdrawable:false});f.kernel.controlPorts={web:new SyntheticPort(web.url),mail:new SyntheticPort(mail.url),handoff:new SyntheticPort(web.url)};
 model=await referenceProposals();f.kernel.proposalPort=new ProposalPort(model.url);
 if(governance){f.kernel.connections={mail:{url:effects.url,secretRefs:['local-secret'],destinations:['local-inbox'],secrets:{'local-secret':'local-synthetic-secret'}}};await f.call('manager','connectionSet',{id:'local-mail',provider:'mail',secretRef:'local-secret',scope,destination:'local-inbox',active:true});}
 for(const principal of ['operator','manager','reviewer','publisher','reader','other','tenant2','agent'])await f.owner.query('INSERT INTO enterprise_oidc_subjects VALUES($1,$2,$2)',[idp.issuer,principal]);
 gateway=await enterpriseGateway(f.kernel,{issuer:idp.issuer,port:governance?new ConnectorPort(f.kernel.connections):new SyntheticPort(effects.url)});
 return {cluster,f,idp,effects,gateway,model,web,mail,purchasing,async close(){await web.close();await mail.close();await model.close();await gateway.close();await effects.close();await idp.close();await f.close();await cluster.close();}};
 }catch(error){await web?.close();await mail?.close();await model?.close();await gateway?.close();await effects?.close();await idp?.close();await f?.close();await cluster.close();throw error;}
}
if(process.argv[1]===import.meta.filename){const purchasing=process.argv.includes('--procurement'),env=await localEnvironment(purchasing?{procurement:true}:{governance:true});console.log(JSON.stringify({url:env.gateway.origin+(purchasing?'/procurement':''),syntheticOnly:true,postgres:env.cluster.version,...(purchasing?{purchasing:env.purchasing}: {})}));for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await env.close();process.exit(0);});}
