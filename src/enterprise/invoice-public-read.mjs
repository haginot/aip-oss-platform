// ENT-202 is a read projection of an existing InvoicePayment. Its case ID is
// exactly the durable payment ID; no new business object or write is created.
import {exact,fail,digest} from '../contracts.mjs';
import {id} from './contracts.mjs';
const version='2.0.0',packageId='ENT-202',type='ENT202Case';
export const casePath='/enterprise/cases/ENT-202';
export function validatePublicRead(request){
 exact(request,['contractVersion','packageId','type','operation','body']);
 if(request.contractVersion!==version)fail('UNSUPPORTED_VERSION');
 if(request.packageId!==packageId||request.type!==type)fail('NOT_FOUND');
 if(!['query','get','history','inspect'].includes(request.operation))fail('UNSUPPORTED_CAPABILITY');
 exact(request.body,request.operation==='query'?[]:['id']);
 if(request.operation!=='query')id(request.body.id);
 return request;
}
export async function invoicePublicRead(kernel,credential,request){
 const {operation,body}=validatePublicRead(request);
 const read=(operation,body)=>kernel.enterprise(credential,{operation,body});
 const payment=async key=>{
  let p;try{p=await read('get',{id:key});}catch(error){if(error.code==='UNSUPPORTED_CAPABILITY')fail('NOT_FOUND');throw error;}
  if(p.type!=='InvoicePayment'||p.workflow.packageId!=='enterprise-invoice')fail('NOT_FOUND');
  const value=await read('paymentRead',{id:key});
  return {p,value};
 };
 const result=await (async()=>{
  if(operation==='query'){
   const rows=await read('query',{packageId:'enterprise-invoice',type:'InvoicePayment'});
   return {items:rows.items.map(p=>({id:p.id,type,revision:p.revision,scope:p.scope,fields:p.fields})),identity:'caseId = persisted InvoicePayment.id',coverage:'Existing payment workflows only; invoices without a payment are not enumerated'};
  }
  const {p,value:pay}=await payment(body.id);
  // Every relationship comes from the authorized persisted payment, never a
  // caller-selected invoice/PO/account. Each public read rechecks current rights.
  const invoice=await read('invoiceRead',{id:pay.fields.invoiceId});
  const purchase=await read('purchaseRead',{id:pay.fields.purchaseId});
  const account=await read('paymentAccountRead',{id:pay.fields.accountId});
  const definition=await read('package',{id:p.workflow.packageId});
  if(definition.manifest.version!==p.workflow.packageVersion)fail('UNSUPPORTED_VERSION');
  let history;
  if(operation==='history'){
   const events=await read('history',{id:body.id}),audit=await read('auditExport',{id:body.id}),invoiceAudit=await read('invoiceAudit',{id:invoice.id});
   history={...events,audit,invoiceAudit};
  }
  // Fail the entire response if any retained source was revoked or changed
  // while composing it. Never return a partial composite on a denied read.
  const latest=await payment(body.id),iv=await read('invoiceRead',{id:invoice.id}),po=await read('purchaseRead',{id:purchase.id}),ac=await read('paymentAccountRead',{id:account.id});
  for(const [before,after] of [[p,latest.p],[pay,latest.value],[invoice,iv],[purchase,po],[account,ac]])if(digest(before)!==digest(after))fail('CONFLICT');
  if(operation==='history'){
   // Audit authority is distinct from read authority. Check it again after
   // composing/revalidating the sources, immediately before releasing history.
   const invoiceAudit=await read('invoiceAudit',{id:invoice.id}),audit=await read('auditExport',{id:body.id});
   return {id:body.id,type,...history,invoiceAudit,audit};
  }
  // The intervening related reads do not check a policy attached only to the
  // payment. Finish with the public payment read: its transaction authorizes
  // the payment and its invoice, PO, account and supplier together. No further
  // public read may follow this release check for get/inspect.
  const release=await read('paymentRead',{id:body.id});
  if(digest(pay)!==digest(release))fail('CONFLICT');
  return {id:body.id,type,revision:p.revision,paymentRevision:pay.revision,workflow:p.workflow,payment:pay,invoice,purchase,account,definition:{id:p.workflow.packageId,version:p.workflow.packageVersion,digest:definition.digest},identity:{caseId:pay.id,paymentId:pay.id,invoiceId:invoice.id,purchaseId:purchase.id,accountId:account.id},coverage:'Read-only projection of an existing payment workflow'};
 })();
 return {contractVersion:version,packageId,type,result};
}
