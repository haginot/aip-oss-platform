import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {invoiceR1HEnvironment} from '../../../scripts/enterprise/invoice-r1h-external.mjs';
import {invoiceEnvironment} from '../../../scripts/enterprise/invoice-local.mjs';
import {compareQuantity,approvePurchase,receiptBody,scope} from '../../../tests/enterprise/quantity-helper.mjs';
import {seedQuantity} from '../../../scripts/enterprise/procurement-quantity-seed.mjs';
import {publishInvoice} from '../../../scripts/enterprise/invoice-seed.mjs';
import {login} from '../../../tests/enterprise/http-helper.mjs';

let caseName='setup';
function save(name,value){if(process.env.R1H_EVIDENCE){mkdirSync(process.env.R1H_EVIDENCE,{recursive:true});writeFileSync(process.env.R1H_EVIDENCE+'/'+caseName+'--'+name+'.json',JSON.stringify(value,null,2)+'\n');}}
export async function scenario(name,run){
 caseName=name;const env=await (process.env.R1H_EXTERNAL_POSTGRES==='1'?invoiceR1HEnvironment():invoiceEnvironment());let http=[];
 try{
  const clients={};for(const who of ['operator','manager','reviewer','publisher','agent','reader','other','tenant2'])clients[who]=await login(env,who);
  const call=async(who,operation,body={},key=randomUUID())=>{const startedAt=new Date().toISOString(),response=await clients[who].api(operation,body,key),data=await response.json(),row={startedAt,finishedAt:new Date().toISOString(),who,operation,body,key,status:response.status,data};http.push(row);if(!response.ok)throw Object.assign(Error(JSON.stringify(data)),{code:data.error?.code});return data.result;};
  await publishInvoice(env.f,call);const seed=await seedQuantity(env.f,call,scope),po=await approvePurchase({call},await compareQuantity({call},seed));await call('manager','dispatch',{id:po.id});const ordered=await call('operator','purchaseRead',{id:po.id});await call('agent','purchaseReceive',receiptBody(po,ordered));const source=await call('operator','purchaseRead',{id:po.id});
  const account={id:'account-'+randomUUID(),scope:seed.scope,supplierId:seed.supplierIds[0],currency:'JPY',syntheticReference:'synthetic:r1h-only',revision:0};await call('publisher','paymentAccountSet',account);
  const body={id:'invoice-'+randomUUID(),purchaseId:po.id,number:'R1H-'+randomUUID(),supplierId:seed.supplierIds[0],amount:1200,currency:'JPY',quantity:7,unit:'台'};
  await run({env,clients,http,call,seed,po,source,account,body});
 }finally{save('http',{http,postgres:env.cluster.version,runtime:process.version,effects:await env.effects.ledger(),payments:await env.payments.ledger(),requests:env.payments.requests()});await env.close();}
}
export async function business(f){return {invoices:(await f.env.f.owner.query('SELECT id,data FROM enterprise_invoice ORDER BY id')).rows,commands:(await f.env.f.owner.query("SELECT sequence,record,hash FROM audit ORDER BY sequence")).rows,effects:await f.env.effects.ledger(),payments:await f.env.payments.ledger(),requests:f.env.payments.requests()};}
export async function grant(f,who,change){const current=(await f.env.f.owner.query('SELECT scopes,operations,fields FROM enterprise_grants WHERE principal=$1',[who])).rows[0];await f.call('publisher','grant',{principal:who,...current,...change});}
export {scope};
