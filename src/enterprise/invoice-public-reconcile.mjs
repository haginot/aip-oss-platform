// Reconciliation observes the persisted operation; it never creates a payment.
import {exact,fail} from '../contracts.mjs';
import {id} from './contracts.mjs';
import {invoicePublicRead} from './invoice-public-read.mjs';

export async function invoicePublicReconcile(kernel,credential,request,configuredExternalPort){
 exact(request,['contractVersion','packageId','type','operation','body']);
 if(request.contractVersion!=='2.0.0')fail('UNSUPPORTED_VERSION');
 if(request.packageId!=='ENT-202'||request.type!=='ENT202Case')fail('NOT_FOUND');
 if(request.operation!=='reconcile')fail('UNSUPPORTED_CAPABILITY');
 exact(request.body,['id']);id(request.body.id);
 const requested=request.body.id;
 const read=()=>invoicePublicRead(kernel,credential,{contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',operation:'get',body:{id:requested}});
 const binding=view=>{
  const p=view?.result?.payment,identity=view?.result?.identity,operation=p?.operation;
  if(view?.result?.id!==requested||p?.id!==requested||identity?.paymentId!==requested||identity?.caseId!==requested||typeof operation?.id!=='string'||!operation.id||typeof operation?.payloadDigest!=='string'||!operation.payloadDigest)fail('CONFLICT');
  return {id:operation.id,digest:operation.payloadDigest};
 };
 const before=await read(),original=binding(before);
 const worked=await kernel.enterpriseWork(credential,{id:requested,mode:'reconcile'},configuredExternalPort);
 // This fresh projection owns final current authorization, including related sources.
 const after=await read(),current=binding(after),payment=after.result.payment;
 if(current.id!==original.id||current.digest!==original.digest||payment.reservation!=='HELD'||!['UNKNOWN','SUCCEEDED'].includes(payment.state))fail('CONFLICT');
 const observation=payment.state==='SUCCEEDED'?'SUCCEEDED':worked?.id===requested&&worked?.state==='UNKNOWN'&&worked?.observation==='ABSENT'?'ABSENT':'UNKNOWN';
 return {...after,result:{...after.result,reconciliation:{observation,requiresHumanReview:observation!=='SUCCEEDED'}}};
}
