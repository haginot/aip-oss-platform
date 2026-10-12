import {digest,fail,exact} from './contracts.mjs';
// Shared probe format for the SQL baseline and future persistent projection adapter.
export class AuthoritativeRetrieval {
 constructor(kernel){this.kernel=kernel;}
 async retrieve(credential,request,options){const result=await this.kernel.search(credential,request,options);return {...result,evidence:result.items.map(object=>({id:object.id,revision:object.revision,digest:digest(object),ontologyVersion:object.ontologyVersion,sourcePosition:object.sourcePosition}))};}
}
export async function compareProbe(baseline,candidate,credential,request,options){
 const result=await Promise.allSettled([baseline.retrieve(credential,request,options),candidate.retrieve(credential,request,options)]);
 const normalize=r=>r.status==='fulfilled'?{ok:true,value:r.value}:{ok:false,code:r.reason.code??'UNAVAILABLE'};
 const [left,right]=result.map(normalize);return {equal:digest(left)===digest(right),baseline:left,candidate:right};
}
