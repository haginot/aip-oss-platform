import {fail} from './contracts.mjs';
import {decideAction} from './definition-programs.mjs';
import {authorize} from './security.mjs';
const string={type:'string'}, integer={type:'integer'};
export const storeActions={
 DetectRecallImpact:{version:'1.0.0',targetType:'RecallCase',input:{targetId:string}},
 QuarantineInventory:{version:'1.0.0',targetType:'InventoryPosition',input:{targetId:string,caseId:string}},
 CreateReplacementOrder:{version:'1.0.0',targetType:'RecallCase',input:{targetId:string,candidateId:string,quantity:integer}},
 PublishCustomerNotice:{version:'1.0.0',targetType:'RecallCase',input:{targetId:string,message:string}}
};
// Fixed executable rules, versioned by the store profile ruleVersion. Every
// dependency is authorized and revision/digest checked by the common Kernel.
export async function storeEffect(u,c,d,request,object,now=Date.now()) {
 const name=request.actionType;if(!storeActions[name])return null;
 const input=request.input;
 async function ref(id){const row=await u.object(id,true);authorize(c,row);if(!request.evidence.some(e=>e.id===id))fail('INVALID_EVIDENCE');return row;}
 const recall=name==='QuarantineInventory'?await ref(input.caseId):object;
 if(recall.type!=='RecallCase')fail('RULE_REJECTED');
 if(now>recall.fields.deadline)fail('RECALL_EXPIRED');
 const lot=await ref(recall.fields.lotId);if(lot.type!=='Lot')fail('RULE_REJECTED');
 const stocks=await u.endpoints(lot.id,'stock');
 if(!stocks.length||stocks.length>100)fail('RULE_REJECTED');
 const rows=[];for(const stock of stocks.sort((a,b)=>a.id.localeCompare(b.id))){const row=await ref(stock.id);if(row.type!=='InventoryPosition')fail('RULE_REJECTED');rows.push(row);}
 const f=recall.fields;
 if(name==='DetectRecallImpact'){
  if(f.phase!=='OPEN'||rows.some(r=>!Number.isSafeInteger(r.fields.quantity)||r.fields.quantity<0)||!Number.isSafeInteger(rows.reduce((n,r)=>n+r.fields.quantity,0)))fail('RULE_REJECTED');
  return {fields:{...f,phase:'DETECTED',affectedIds:JSON.stringify(rows.map(r=>r.id)),affectedStores:JSON.stringify([...new Set(rows.map(r=>r.store))]),affectedQuantity:rows.reduce((n,r)=>n+r.fields.quantity,0)},approval:false};
 }
 if(f.phase==='OPEN')fail('QUARANTINE_REQUIRED');
 if(JSON.stringify(rows.map(r=>r.id))!==f.affectedIds)fail('STALE_IMPACT');
 if(name==='QuarantineInventory'){
  if(f.phase!=='DETECTED'||!rows.some(r=>r.id===object.id)||object.fields.isolated)fail('RULE_REJECTED');
  return {fields:{...object.fields,isolated:true},approval:false};
 }
 if(rows.some(r=>!r.fields.isolated))fail('QUARANTINE_REQUIRED');
 // A local commit is not proof of external isolation. Require delivered latest
 // isolation events before replenishment or customer notification.
 for(const row of rows){const event=await u.one('SELECT * FROM outbox WHERE aggregate_id=$1 ORDER BY sequence DESC LIMIT 1',[row.id]);if(!event||event.state!=='DELIVERED'||event.event.objectRevision!==row.revision)fail('EXTERNAL_PENDING');}
 if(name==='CreateReplacementOrder'){
  const candidate=await ref(input.candidateId);
  const allowed=await u.endpoints(lot.id,'replacement');
  if(f.phase!=='DETECTED'||!allowed.some(r=>r.id===candidate.id)||candidate.type!=='ReplacementCandidate'||!candidate.fields.available||candidate.fields.recalled||input.quantity<1||input.quantity>candidate.fields.capacity||input.quantity>f.affectedQuantity)fail('RULE_REJECTED');
  const amount=input.quantity*candidate.fields.unitPrice;if(!Number.isSafeInteger(candidate.fields.unitPrice)||candidate.fields.unitPrice<1||!Number.isSafeInteger(amount))fail('RULE_REJECTED');
  return {fields:{...f,phase:'REPLACEMENT_ORDERED',candidateId:candidate.id,orderQuantity:input.quantity,orderAmount:amount},approval:amount>=10000};
 }
 if(f.phase!=='REPLACEMENT_ORDERED'||!input.message.trim())fail('RULE_REJECTED');
 const order=await u.one('SELECT * FROM outbox WHERE aggregate_id=$1 ORDER BY sequence DESC LIMIT 1',[recall.id]);
 if(!order||order.state!=='DELIVERED'||order.event.objectRevision!==recall.revision)fail('EXTERNAL_PENDING');
 return {fields:{...f,phase:'CUSTOMER_NOTIFIED',customerMessage:input.message,customerCount:f.soldQuantity},approval:false};
}

// Store constraints can add approval, but cannot bypass published programs.
// Public quantity means affected inventory for impact/notice, target inventory
// for quarantine, and requested units for procurement. None releases isolation.
export function decideStoreAction(d,object,request,effect){
 if(!effect)return decideAction(d,object,request.input,request.requireApproval);
 const quantity=request.actionType==='QuarantineInventory'?object.fields.quantity:
  request.actionType==='CreateReplacementOrder'?request.input.quantity:effect.fields.affectedQuantity;
 return decideAction(d,{fields:{quantity}},{isolated:true},effect.approval||request.requireApproval);
}
