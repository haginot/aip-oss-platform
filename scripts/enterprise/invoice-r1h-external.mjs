import pg from 'pg';
import {randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rm} from 'node:fs/promises';
import {enterpriseFixture} from './fixture.mjs';
import {initializeInvoice} from './invoice-seed.mjs';
import {referenceOIDC} from './reference/oidc.mjs';
import {referenceEffects} from './reference/effects.mjs';
import {referencePayments} from './reference/payments.mjs';
import {SyntheticPort} from '../../src/enterprise/worker.mjs';
import {enterpriseGateway} from '../../src/enterprise/gateway.mjs';

const {Pool}=pg;

export async function invoiceR1HEnvironment(options={}){
 const config={host:'/tmp/aip-ent202-r1h-pg14',port:25446,user:'foundation_owner',database:'postgres'};
 const admin=new Pool(config);
 const schema='r1h_'+randomBytes(10).toString('hex');
 const journalDirectory=join(tmpdir(),'aip-ent202-r1h-journal-'+schema);
 const cluster={directory:journalDirectory,config,admin,version:null,async close(){await admin.end();await rm(journalDirectory,{recursive:true,force:true});}};
 let f,idp,effects,payments,gateway;
 try{
  const identity=(await admin.query("SELECT current_user AS current_user,current_database() AS current_database,current_setting('server_version') AS server_version,current_setting('port') AS port,current_setting('unix_socket_directories') AS unix_socket_directories")).rows[0];
  if(identity.current_user!=='foundation_owner'||identity.current_database!=='postgres'||identity.server_version!=='14.20 (Homebrew)'||identity.port!=='25446'||identity.unix_socket_directories!=='/tmp/aip-ent202-r1h-pg14')throw Error('R1H PostgreSQL identity mismatch: '+JSON.stringify(identity));
  cluster.version=identity.server_version;
  f=await enterpriseFixture(cluster,{...options,journalDirectory});
  await initializeInvoice(f);
  idp=await referenceOIDC(cluster);
  effects=await referenceEffects(cluster);
  payments=await referencePayments(cluster,effects.url);
  for(const principal of ['operator','manager','reviewer','publisher','reader','other','tenant2','agent'])await f.owner.query('INSERT INTO enterprise_oidc_subjects VALUES($1,$2,$2)',[idp.issuer,principal]);
  gateway=await enterpriseGateway(f.kernel,{issuer:idp.issuer,port:new SyntheticPort(payments.url)});
  return {cluster,f,idp,effects,payments,gateway,async close(){await gateway.close();await payments.close();await effects.close();await idp.close();await f.close();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();await rm(journalDirectory,{recursive:true,force:true});}};
 }catch(error){
  await gateway?.close();await payments?.close();await effects?.close();await idp?.close();await f?.close();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(()=>{});
  await admin.end();await rm(journalDirectory,{recursive:true,force:true});
  throw error;
 }
}
