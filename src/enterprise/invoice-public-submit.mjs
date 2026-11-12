// Public 2.0.0 vocabulary adapter. All business admission, authorization,
// idempotency, reservations and recovery remain owned by the existing kernel.
import {exact,fail} from '../contracts.mjs';
import {id} from './contracts.mjs';
export async function invoicePublicSubmit(kernel,credential,request){
 exact(request,['contractVersion','packageId','type','operation','body','key']);
 if(request.contractVersion!=='2.0.0')fail('UNSUPPORTED_VERSION');
 if(request.packageId!=='ENT-202'||request.type!=='ENT202Case')fail('NOT_FOUND');
 if(request.operation!=='submit')fail('UNSUPPORTED_CAPABILITY');
 exact(request.body,['id','invoiceId','revision','accountId','amount']);
 for(const value of [request.key,request.body.id,request.body.invoiceId,request.body.accountId])id(value);
 for(const value of [request.body.revision,request.body.amount])if(!Number.isSafeInteger(value)||value<=0)fail('INVALID_ARGUMENT');
 const result=await kernel.enterprise(credential,{operation:'paymentRequest',body:request.body,key:request.key});
 return {contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',result};
}
