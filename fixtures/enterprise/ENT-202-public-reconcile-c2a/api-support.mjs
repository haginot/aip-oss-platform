import assert from 'node:assert/strict';
import {evidence} from '../ENT-202-public-read-20261028/support.mjs';
import {worker} from '../ENT-202-public-cancel-20261028/support.mjs';
export {scenario,evidence,business,audit,grant,ops,allFields,childGateway,login,ok,rpc} from '../ENT-202-public-read-20261028/support.mjs';
export {error} from '../ENT-202-public-submit-20261028/support.mjs';
export {worker};
export const envelope=id=>({contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',operation:'reconcile',body:{id}});
export async function reconcile(f,id,who='manager',options={}){
 const origin=options.origin??f.env.gateway.origin,c=options.client??f.clients[who],request=options.request??envelope(id),wireBody=options.raw??JSON.stringify(request);
 const headers={cookie:c.cookie,origin,'content-type':'application/json','x-csrf-token':c.identity.csrf,...options.headers};
 const startedAt=new Date().toISOString(),response=await fetch(origin+'/enterprise/v2/reconcile',{method:'POST',headers,body:wireBody});
 const row={startedAt,finishedAt:new Date().toISOString(),who,request,wireBody,requestGate:{origin:headers.origin,contentType:headers['content-type'],sessionCookiePresent:!!headers.cookie,csrfHeaderPresent:!!headers['x-csrf-token']},status:response.status,data:await response.json(),headers:Object.fromEntries(response.headers)};
 (f.reconcileHttp??=[]).push(row);evidence('reconcile-http',f.reconcileHttp);return row;
}
export async function reconciled(f,id,who='manager',options={}){const r=await reconcile(f,id,who,options);assert.equal(r.status,200,JSON.stringify(r));return r.data.result;}
export async function unknown(f,mode='lost-ack',overrides={}){
 if(!f.reconcileInvoiceImported){await f.call('operator','invoiceImport',f.body);f.reconcileInvoiceImported=true;}
 const p=await f.request(overrides);await f.call('operator','paymentRequest',p);await f.approve(p.id);
 const ready=await f.payment(p.id);let dispatch;
 if(mode==='absent'){dispatch=await worker(f,p.id,'enterprise-before-send');assert.equal(dispatch.code,73,dispatch.stderr);}
 else if(mode==='after-send-crash'){dispatch=await worker(f,p.id,'enterprise-after-send');assert.equal(dispatch.code,73,dispatch.stderr);}
 else{assert.equal(mode,'lost-ack');f.env.payments.fault('lost-ack');dispatch=await f.call('manager','dispatch',{id:p.id});}
 const payment=await f.payment(p.id);assert.equal(payment.state,'UNKNOWN');assert.equal(payment.reservation,'HELD');f.paymentId=p.id;
 evidence('prepared-'+p.id,{mode,request:p,ready,dispatch,payment,paymentLedger:await f.env.payments.ledger(),paymentRequests:f.env.payments.requests()});return p;
}
export async function saved(f,label,id){const p=await f.payment(id),db=await f.env.f.owner.query('SELECT * FROM outbox WHERE operation_id=$1',[p.operation.id]);const row={payment:p,outbox:db.rows,paymentLedger:await f.env.payments.ledger(),paymentRequests:f.env.payments.requests()};evidence(label,row);return row;}
