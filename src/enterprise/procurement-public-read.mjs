// Public alias of durable PurchaseRequest. Authorization and pinned-package
// verification belong to the kernel; this adapter never opens a repository.
import {exact,fail,digest} from '../contracts.mjs';
import {id} from './contracts.mjs';
export const procurementCasePath='/enterprise/cases/ENT-201';
const type='ENT201Case',packageId='ENT-201',contractVersion='2.0.0';
export function validateProcurementRead(request){
 exact(request,['contractVersion','packageId','type','operation','body']);
 if(request.contractVersion!==contractVersion)fail('UNSUPPORTED_VERSION');
 if(request.packageId!==packageId||request.type!==type)fail('NOT_FOUND');
 if(!['query','get','inspect','history'].includes(request.operation))fail('UNSUPPORTED_CAPABILITY');
 exact(request.body,request.operation==='query'?[]:['id']);
 if(request.operation!=='query')id(request.body.id);
 return request;
}
export async function procurementPublicRead(kernel,credential,request){
 const {operation,body}=validateProcurementRead(request);
 const read=(operation,body)=>kernel.enterprise(credential,{operation,body});
 const same=(a,b)=>{if(digest(a)!==digest(b))fail('CONFLICT');};
 const purchase=async key=>{
  let object;try{object=await read('get',{id:key});}catch(e){if(e.code==='UNSUPPORTED_CAPABILITY')fail('NOT_FOUND');throw e;}
  if(object.type!=='PurchaseRequest'||object.workflow?.packageId!=='enterprise-procurement')fail('NOT_FOUND');
  const value=await read('purchaseRead',{id:key});
  if(value.id!==object.id||value.revision!==object.revision||digest(value.fields)!==digest(object.fields)||value.package.version!==object.workflow.packageVersion)fail('CONFLICT');
  const {state,stage,due,votes}=object.workflow;same({state,stage,due,votes},value.workflow);
  return {object,value};
 };
 let result;
 if(operation==='query'){
  const query=()=>read('query',{packageId:'enterprise-procurement',type:'PurchaseRequest'});
  const rows=await query(),retained=[];
  for(const row of rows.items){const p=await purchase(row.id);same(row,{id:p.object.id,type:p.object.type,revision:p.object.revision,scope:p.object.scope,fields:p.object.fields});retained.push(p);}
  for(const p of retained)same(p,await purchase(p.object.id));
  same(rows,await query());
  result={items:rows.items.map(row=>({...row,type})),identity:'caseId = persisted PurchaseRequest.id'};
 }else{
  const first=await purchase(body.id);let events,audit;
  if(operation==='history'){events=await read('history',{id:body.id});same(events.events,first.value.history);audit=await read('auditExport',{id:body.id});}
  same(first,await purchase(body.id));
  if(operation==='history'){
   same(events,await read('history',{id:body.id}));
   // Audit permission is independent, and this is the final release read.
   const releaseAudit=await read('auditExport',{id:body.id});
   const businessAudit=value=>value.events.filter(row=>row.record.kind!=='EnterpriseRead');
   same(businessAudit(audit),businessAudit(releaseAudit));
   same(releaseAudit.definition,{id:first.object.workflow.packageId,version:first.value.package.version,digest:first.value.package.digest});
   same(releaseAudit.approvals.map(({actor,stage,decision})=>({actor,stage,decision})),first.object.workflow.votes);
   audit=releaseAudit;
   result={id:body.id,type,...events,audit};
  }else{
   const release=await read('purchaseRead',{id:body.id});same(first.value,release);
   const {object:p,value}=first;
   result={id:p.id,type,revision:p.revision,scope:p.scope,fields:p.fields,workflow:p.workflow,purchase:value,definition:{id:p.workflow.packageId,version:value.package.version,digest:value.package.digest},identity:{caseId:p.id,purchaseId:p.id}};
  }
 }
 return {contractVersion,packageId,type,result};
}
