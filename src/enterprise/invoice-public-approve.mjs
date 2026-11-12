// Public vocabulary only; vote owns authorization, transaction, audit and replay.
import {exact,fail} from '../contracts.mjs';
import {id} from './contracts.mjs';
export async function invoicePublicApprove(kernel,credential,request){
 exact(request,['contractVersion','packageId','type','operation','body','key']);
 if(request.contractVersion!=='2.0.0')fail('UNSUPPORTED_VERSION');
 if(request.packageId!=='ENT-202'||request.type!=='ENT202Case')fail('NOT_FOUND');
 if(!['approve','return'].includes(request.operation))fail('UNSUPPORTED_CAPABILITY');
 exact(request.body,['id','revision','purpose'],['id','revision']);
 id(request.key);id(request.body.id);
 if(!Number.isSafeInteger(request.body.revision)||request.body.revision<=0)fail('INVALID_ARGUMENT');
 if(Object.hasOwn(request.body,'purpose')&&(typeof request.body.purpose!=='string'||!request.body.purpose.length||request.body.purpose.length>128))fail('INVALID_ARGUMENT');
 let target;try{target=await kernel.enterprise(credential,{operation:'get',body:{id:request.body.id}});}catch(error){if(error.code==='UNSUPPORTED_CAPABILITY')fail('NOT_FOUND');throw error;}
 if(target.type!=='InvoicePayment'||target.workflow.packageId!=='enterprise-invoice')fail('NOT_FOUND');
 const result=await kernel.enterprise(credential,{operation:'vote',body:{...request.body,decision:request.operation==='approve'?'APPROVE':'RETURN'},key:request.key});
 return {contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',result};
}
