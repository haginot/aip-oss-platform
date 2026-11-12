// The existing invoiceCorrect kernel owns authorization, matching and durable replay.
import {exact,fail} from '../contracts.mjs';
import {id} from './contracts.mjs';
export async function invoicePublicCorrect(kernel,credential,request){
 exact(request,['contractVersion','packageId','type','operation','body','key']);
 if(request.contractVersion!=='2.0.0')fail('UNSUPPORTED_VERSION');
 if(request.packageId!=='ENT-202'||request.type!=='ENT202Case')fail('NOT_FOUND');
 if(request.operation!=='correct')fail('UNSUPPORTED_CAPABILITY');
 exact(request.body,['id','purchaseId','number','supplierId','amount','currency','quantity','unit','revision']);
 for(const v of [request.key,request.body.id,request.body.purchaseId,request.body.supplierId])id(v);
 for(const v of [request.body.amount,request.body.quantity,request.body.revision])if(!Number.isSafeInteger(v)||v<=0)fail('INVALID_ARGUMENT');
 for(const v of [request.body.number,request.body.unit])if(typeof v!=='string'||!v.trim()||v.length>200)fail('INVALID_ARGUMENT');
 if(!['JPY','USD','EUR'].includes(request.body.currency))fail('INVALID_ARGUMENT');
 const result=await kernel.enterprise(credential,{operation:'invoiceCorrect',body:request.body,key:request.key});
 return {contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',result};
}
