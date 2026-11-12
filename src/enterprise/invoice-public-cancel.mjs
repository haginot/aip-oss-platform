// Public unsent-cancel vocabulary. The existing kernel owns admission,
// authorization, reservation release, audit, recovery and original-key replay.
import {exact,fail} from '../contracts.mjs';
import {id} from './contracts.mjs';
export async function invoicePublicCancel(kernel,credential,request){
 exact(request,['contractVersion','packageId','type','operation','body','key']);
 if(request.contractVersion!=='2.0.0')fail('UNSUPPORTED_VERSION');
 if(request.packageId!=='ENT-202'||request.type!=='ENT202Case')fail('NOT_FOUND');
 if(request.operation!=='cancel')fail('UNSUPPORTED_CAPABILITY');
 exact(request.body,['id','purpose'],['id']);
 id(request.key);id(request.body.id);
 if(Object.hasOwn(request.body,'purpose')&&(typeof request.body.purpose!=='string'||!request.body.purpose.length||request.body.purpose.length>128))fail('INVALID_ARGUMENT');
 let target;try{target=await kernel.enterprise(credential,{operation:'get',body:{id:request.body.id}});}catch(error){if(error.code==='UNSUPPORTED_CAPABILITY')fail('NOT_FOUND');throw error;}
 if(target.type!=='InvoicePayment'||target.workflow.packageId!=='enterprise-invoice')fail('NOT_FOUND');
 // purpose is optional public input, not a paymentCancel business field.
 // Only the canonical {id} body participates in existing durable replay.
 const result=await kernel.enterprise(credential,{operation:'paymentCancel',body:{id:request.body.id},key:request.key});
 return {contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',result};
}
