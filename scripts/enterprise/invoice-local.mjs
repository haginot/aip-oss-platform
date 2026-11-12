// Disposable synthetic environment using the real public gateway and OIDC.
import {startCluster,enterpriseFixture} from './fixture.mjs';
import {referenceOIDC} from './reference/oidc.mjs';
import {referenceEffects} from './reference/effects.mjs';
import {referencePayments} from './reference/payments.mjs';
import {SyntheticPort} from '../../src/enterprise/worker.mjs';
import {enterpriseGateway} from '../../src/enterprise/gateway.mjs';
import {seedQuantity} from './procurement-quantity-seed.mjs';
import {initializeInvoice,publishInvoice} from './invoice-seed.mjs';
export async function invoiceEnvironment(options={}){
 const cluster=await startCluster();let f,idp,effects,payments,gateway;
 try{
  f=await enterpriseFixture(cluster,options);await initializeInvoice(f);idp=await referenceOIDC(cluster);effects=await referenceEffects(cluster);payments=await referencePayments(cluster,effects.url);
  for(const principal of ['operator','manager','reviewer','publisher','reader','other','tenant2','agent'])await f.owner.query('INSERT INTO enterprise_oidc_subjects VALUES($1,$2,$2)',[idp.issuer,principal]);
  gateway=await enterpriseGateway(f.kernel,{issuer:idp.issuer,port:new SyntheticPort(payments.url)});
  return {cluster,f,idp,effects,payments,gateway,async close(){await gateway.close();await payments.close();await effects.close();await idp.close();await f.close();await cluster.close();}};
 }catch(e){await gateway?.close();await payments?.close();await effects?.close();await idp?.close();await f?.close();await cluster.close();throw e;}
}
if(process.argv[1]===import.meta.filename){const env=await invoiceEnvironment();let purchasing;try{await publishInvoice(env.f);purchasing=await seedQuantity(env.f);}catch(error){await env.close();throw error;}console.log(JSON.stringify({url:env.gateway.origin+'/invoice',syntheticOnly:true,postgres:env.cluster.version,purchasing}));for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await env.close();process.exit(0);});}
