import {localEnvironment} from './local.mjs';
import {seedQuantity} from './procurement-quantity-seed.mjs';
// Loopback-only disposable PostgreSQL, OIDC, gateway and durable synthetic ledger.
const env=await localEnvironment();
try{
 const purchasing=await seedQuantity(env.f);
 console.log(JSON.stringify({url:env.gateway.origin+'/procurement',syntheticOnly:true,postgres:env.cluster.version,packageVersion:'1.1.0',purchasing}));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await env.close();process.exit(0);});
}catch(error){await env.close();throw error;}
