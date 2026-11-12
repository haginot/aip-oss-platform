import quantityManifest from '../../config/enterprise/procurement-quantity.json' with {type:'json'};
import manifest from '../../config/enterprise/procurement.json' with {type:'json'};
import {exact,fail,digest} from '../contracts.mjs';
import {id,scope,fields,deadline,sameScope} from './contracts.mjs';
import {authority,authorize,procurementVisible} from './security.mjs';
import {sourcePolicy} from './information-policy.mjs';
import {assurance} from './assurance.mjs';

export const procurementPermissions={supplierCreate:'records',purchaseCreate:'action',purchaseQuote:'action',purchaseSelect:'action',purchaseRead:'read',purchaseReceive:'action'};
export const procurementManifest=manifest;
export const procurementQuantityManifest=quantityManifest;
const knownManifest=p=>[manifest,quantityManifest].some(m=>digest(m)===digest(p));
const quantified=p=>p.version===quantityManifest.version;
export const isProcurement=p=>p?.id===manifest.id||p?.manifest?.action?.type==='PurchaseRequest';
// Only this local effect contract is implemented for procurement.
export const procurementEffect=p=>({operationKind:'procurement-order',destination:'local-synthetic-procurement',packageId:p.id,packageVersion:p.version,packageDigest:p.digest});
export const purchaseBinding=(o,p)=>digest({id:o.id,scope:o.enterprise_scope,fields:o.fields,revision:o.revision,packageDigest:p.digest});
export function procurementPackage(p){
 if((p.id===manifest.id||p.action.type==='PurchaseRequest')&&!knownManifest(p))fail('UNSUPPORTED_VERSION');
}
const text=x=>{if(typeof x!=='string'||!x.trim()||x.length>500)fail('INVALID_ARGUMENT');return x;};
const positive=x=>{if(!Number.isSafeInteger(x)||x<=0)fail('INVALID_ARGUMENT');return x;};
const unit=x=>{if(typeof x!=='string'||!x.trim()||x!==x.trim()||x.length>40)fail('INVALID_ARGUMENT');return x;};
const overlap=(a,b)=>[a.actor,a.subject].some(x=>[b.actor,b.subject].includes(x));
export {procurementVisible} from './security.mjs';
function classified(c,o){if(!procurementVisible(c,o))fail('PERMISSION_DENIED');}

// Reuse the durable recovery journal; no separate receipt or approval mechanism.
// A committed version missing from an older SQL snapshot is a fence, not permission
// to recreate an order. An aborted transaction's version is ignored.
export async function procurementConsistent(k,r,c,key){
 const records=k.journal.records();let latest;
 for(const v of records)if(v.operationKind==='procurement-version'&&v.tenant===c.tenant&&v.id===key){
  const terminal=records.filter(y=>y.actionId===v.actionId&&y.operationKind==='submission').at(-1);
  if(terminal?.phase!=='ABORTED')latest=v;
 }
 const row=await r.procurement(c.tenant,key);
 if(latest&&(!row||row.revision!==latest.revision||row.action_id!==latest.actionId||digest({kind:row.kind,data:row.data})!==latest.digest))fail('RECOVERING');
 return row;
}
async function save(k,r,c,x,actionId){
 x.revision++;
 k.journal.append({operationKind:'procurement-version',tenant:c.tenant,id:x.id,revision:x.revision,digest:digest({kind:x.kind,data:x.data}),actionId});
 await r.saveProcurement(x,actionId);
}
async function target(k,r,c,key,purpose){
 id(key);const o=await r.object(key);authorize(c,o);classified(c,o);await sourcePolicy(r,c,'object',key,purpose);
 const x=await procurementConsistent(k,r,c,key);if(!x||x.kind!=='purchase'||o.type!=='PurchaseRequest')fail('NOT_FOUND');
 const i=await r.instance(key),p=i&&await r.package(c.tenant,i.package_id,i.package_version);
 const intent=k.journal.records().filter(v=>v.operationKind==='procurement-external-intent'&&v.tenant===c.tenant&&v.id===key).at(-1);
 if(intent){
  const origin=i&&await r.actionForInstance(i),out=origin&&await r.u.outbox(origin.operation_id);
  if(!origin||origin.operation_id!==intent.orderOperationId||!['UNKNOWN','SUCCEEDED','COMPENSATING','COMPENSATED'].includes(i.state)||out?.state!==i.state)fail('RECOVERING');
 }
 if(!i||!p||p.id!==p.manifest.id||p.version!==p.manifest.version||!knownManifest(p.manifest)||digest(p.manifest)!==p.digest||purchaseBinding(o,p)!==i.binding||digest(o.fields)!==x.data.fieldsDigest||digest(o.enterprise_scope)!==x.data.scopeDigest)fail('STALE_APPROVAL');
 if(await r.one('SELECT 1 FROM enterprise_routes WHERE object_id=$1',[o.id]))fail('PERMISSION_DENIED');
 const origin=await r.actionForInstance(i),out=await r.u.outbox(origin.operation_id);
 if(out)orderPayload(o,p,origin,out,x.data.receipt);
 else if(['UNKNOWN','SUCCEEDED','COMPENSATING','COMPENSATED'].includes(i.state)||x.data.reserved)fail('INCONSISTENT_STATE');
 return {o,i,p,x};
}
async function suppliers(k,r,c,o,i,x){
 const identities=[i.authority,...i.votes.map(v=>v.authority)];
 for(const quote of x.data.quotes){
  const supplier=await r.object(quote.supplierId);authorize(c,supplier);classified(c,supplier);await sourcePolicy(r,c,'object',supplier.id);
  const s=await procurementConsistent(k,r,c,supplier.id);
  if(s?.kind!=='supplier'||digest(s.data)!==quote.supplierDigest||s.data.scopeDigest!==digest(supplier.enterprise_scope)||overlap(s.data.author,i.authority)||s.data.relatedSubjects.some(who=>identities.some(a=>[a.actor,a.subject].includes(who))))fail('PERMISSION_DENIED');
  if(!sameScope(supplier.enterprise_scope,o.enterprise_scope))fail('PERMISSION_DENIED');
 }
}
async function reservation(k,u,r,c,o,i,x){
 const b=await assurance(k,u,r,c,'assuranceRead',{id:o.fields.budgetId});
 const item=b.data.reservations?.find(y=>y.reference===o.id);
 if(b.kind!=='resource'||!sameScope(b.scope,o.enterprise_scope)||b.data.unit!=='minor'||b.data.currency!==o.fields.currency||b.data.state!=='OPEN'||Date.parse(b.data.periodEnd)<=k.clock()||!item||item.state!=='RESERVED'||item.actor!==i.authority.subject||item.quantity!==o.fields.amount||item.currency!==o.fields.currency)fail('INVALID_STATE');
}
export async function procurementGuard(k,u,r,c,o,i,p,op,purpose){
 if(!isProcurement(p))return;
 const {x}=await target(k,r,c,o.id,purpose);
 if(['edit','attach'].includes(op)||op==='cancel'&&x.data.reserved)fail('PERMISSION_DENIED');
 if(op==='vote'){
  if(x.data.phase!=='COMPARED')fail('INVALID_STATE');
  await suppliers(k,r,c,o,i,x);
  // Include the proposed approver in the related-party check before the vote.
  await suppliers(k,r,c,o,{...i,votes:[...i.votes,{authority:c}]},x);
 }
}
export async function procurementReserve(k,u,r,c,o,i,p,actionId){
 if(!isProcurement(p))return;
 const {x}=await target(k,r,c,o.id);
 if(x.data.reserved||x.data.phase!=='COMPARED')fail('INVALID_STATE');
 const original=await authority(u,r,null,'action',i.authority);authorize(original,o);
 await suppliers(k,r,c,o,i,x);
 const b=await assurance(k,u,r,original,'assuranceRead',{id:o.fields.budgetId});
 if(b.kind!=='resource'||!sameScope(b.scope,o.enterprise_scope)||b.data.unit!=='minor')fail('INVALID_ARGUMENT');
 await assurance(k,u,r,original,'resourceReserve',{id:o.fields.budgetId,reference:o.id,quantity:o.fields.amount,currency:o.fields.currency,unit:'minor'},actionId);
 x.data.reserved=true;await save(k,r,c,x,actionId);
}
// This witness uses the existing fsynced journal outside the SQL restore boundary.
// No submission phase/operationId is added: it is a fence, not an approval receipt.
export function procurementIntent(k,c,o,p,a){
 if(!isProcurement(p))return;
 k.journal.append({operationKind:'procurement-external-intent',tenant:c.tenant,id:o.id,orderOperationId:a.operation_id});
}
export async function procurementExecution(k,u,r,c,o,i,p,mode){
 if(!isProcurement(p))return;
 const {x}=await target(k,r,c,o.id);
 if(mode==='compensate')fail('UNSUPPORTED_CAPABILITY');
 if(!x.data.reserved||x.data.phase!=='COMPARED')fail('INVALID_STATE');
 // Observation is still allowed after expiry/revocation/release. It never sends
 // a new order. Receipt and all new effects require the current reservation.
 if(mode==='dispatch'){
  await suppliers(k,r,c,o,i,x);await reservation(k,u,r,c,o,i,x);
  if(i.due.getTime()<=k.clock())fail('INVALID_STATE');
 }
}
export async function procurementReplay(k,r,c,op,b){
 if(op==='supplierCreate'){
  const o=await r.object(b.id);authorize(c,o);classified(c,o);await sourcePolicy(r,c,'object',o.id);
  if(!(await procurementConsistent(k,r,c,b.id)))fail('RECOVERING');return;
 }
 await target(k,r,c,b.id);
}
// The receipt references the immutable approved order event, not the post-receipt revision.
function orderPayload(o,p,origin,out,receipt){
 const e=out?.event,body=origin?.request?.body;
 // Never infer missing markers or rebrand a historical/generic effect as local.
 if(!e||!origin||origin.request.operation!=='purchaseCreate'||body?.id!==o.id||origin.tenant!==o.tenant||digest(body.scope)!==digest(o.enterprise_scope)||['title','currency','budgetId'].some(key=>body[key]!==o.fields[key])||(body.packageVersion??manifest.version)!==p.version||out.operation_id!==origin.operation_id||out.action_id!==origin.id||out.aggregate_id!==o.id||e.sequence!==out.sequence||digest(e)!==out.digest||e.contractVersion!=='2.0.0'||e.operationKind!=='procurement-order'||e.destination!=='local-synthetic-procurement'||e.packageId!==p.id||e.packageVersion!==p.version||e.packageDigest!==p.digest||e.operationId!==origin.operation_id||e.actionId!==origin.id||e.aggregateId!==o.id||e.tenant!==o.tenant||e.schemaVersion!==p.version||e.objectRevision!==(receipt?(receipt.orderedRevision??o.revision-1):o.revision)||digest(e.scope)!==digest(o.enterprise_scope)||digest(e.fields)!==digest(o.fields))fail('INCONSISTENT_STATE');
 if(quantified(p)){
  positive(e.fields.quantity);unit(e.fields.unit);positive(e.fields.quoteVersion);
  if(body.quantity!==e.fields.quantity||body.unit!==e.fields.unit)fail('INCONSISTENT_STATE');
  if(receipt&&(receipt.actionId!==origin.id||receipt.packageVersion!==p.version||receipt.packageDigest!==p.digest||receipt.payloadDigest!==out.digest||receipt.receivedQuantity!==e.fields.quantity||receipt.unit!==e.fields.unit))fail('INCONSISTENT_STATE');
 }
 if(receipt&&receipt.operationId!==origin.operation_id)fail('INCONSISTENT_STATE');
 return e;
}
export async function procurement(k,u,r,c,op,b,actionId){
 if(op==='supplierCreate'){
  exact(b,['id','scope','name','relatedSubjects']);id(b.id);scope(b.scope);text(b.name);
  if(c.delegationId||!Array.isArray(b.relatedSubjects)||b.relatedSubjects.length>30)fail('INVALID_ARGUMENT');b.relatedSubjects.forEach(id);
  const candidate={tenant:c.tenant,store:null,enterprise_scope:b.scope};authorize(c,candidate);classified(c,candidate);
  if(await procurementConsistent(k,r,c,b.id)||await r.object(b.id))fail('CONFLICT');
  await r.create(c,{id:b.id,type:'ProcurementSupplier',scope:b.scope,fields:{name:b.name}},actionId);
  await save(k,r,c,{id:b.id,tenant:c.tenant,kind:'supplier',revision:0,data:{scopeDigest:digest(b.scope),name:b.name,relatedSubjects:b.relatedSubjects,author:c}},actionId);
  return {id:b.id,state:'REGISTERED'};
 }
 if(op==='purchaseCreate'){
  exact(b,['id','scope','title','currency','budgetId','packageVersion','quantity','unit'],['id','scope','title','currency','budgetId']);id(b.id);id(b.budgetId);scope(b.scope);text(b.title);
  if(!['JPY','USD','EUR'].includes(b.currency))fail('INVALID_ARGUMENT');
  const candidate={tenant:c.tenant,store:null,enterprise_scope:b.scope};authorize(c,candidate);classified(c,candidate);
  if(await procurementConsistent(k,r,c,b.id)||await r.object(b.id))fail('CONFLICT');
  const version=b.packageVersion===undefined?manifest.version:b.packageVersion;
  const expected=[manifest,quantityManifest].find(m=>m.version===version);if(!expected)fail('UNSUPPORTED_VERSION');
  if(expected===quantityManifest){positive(b.quantity);unit(b.unit);}else if('quantity' in b||'unit' in b)fail('INVALID_ARGUMENT');
  const p=await r.package(c.tenant,manifest.id,version);if(!p||p.state!=='PUBLISHED'||p.digest!==digest(expected)||digest(p.manifest)!==p.digest)fail('UNSUPPORTED_VERSION');
  const budget=await assurance(k,u,r,c,'assuranceRead',{id:b.budgetId});
  if(budget.kind!=='resource'||!sameScope(budget.scope,b.scope)||budget.data.unit!=='minor'||budget.data.currency!==b.currency)fail('INVALID_ARGUMENT');
  if(budget.data.state!=='OPEN'||Date.parse(budget.data.periodEnd)<=k.clock())fail('INVALID_STATE');
  const values={title:b.title,amount:0,currency:b.currency,budgetId:b.budgetId,supplierId:'',quoteId:'',comparisonDigest:digest([]),...(quantified(p)?{quantity:b.quantity,unit:b.unit,quoteVersion:0}:{})};fields(p.manifest,'PurchaseRequest',values);
  const o=await r.create(c,{id:b.id,type:'PurchaseRequest',scope:b.scope,fields:values},actionId);
  await r.start(o,p,purchaseBinding(o,p),c,actionId,deadline(k.clock(),p.manifest.calendar));
  await save(k,r,c,{id:o.id,tenant:c.tenant,kind:'purchase',revision:0,data:{scopeDigest:digest(b.scope),phase:'REQUESTED',quotes:[],selection:null,reserved:false,receipt:null,fieldsDigest:digest(o.fields)}},actionId);
  return {id:o.id,revision:1,state:'REQUESTED'};
 }
 const {o,i,p,x}=await target(k,r,c,b.id);
 if(op==='purchaseRead'){
  exact(b,['id']);const origin=await r.actionForInstance(i),out=await u.outbox(origin.operation_id);
  if(quantified(p)&&out)orderPayload(o,p,origin,out,x.data.receipt);
  const confirmed=i.state==='SUCCEEDED';
  const quantityContract=quantified(p)?{status:'KNOWN',requested:{quantity:o.fields.quantity,unit:o.fields.unit},ordered:confirmed?{quantity:out.event.fields.quantity,unit:out.event.fields.unit}:null,received:x.data.receipt?{quantity:x.data.receipt.receivedQuantity,unit:x.data.receipt.unit}:null,matchEligible:confirmed&&!!x.data.receipt}:{status:'UNKNOWN',requested:null,ordered:null,received:null,matchEligible:false};
  return {id:o.id,revision:o.revision,fields:o.fields,...x.data,package:{version:p.version,digest:p.digest},quantityContract,state:x.data.receipt?'RECEIVED':i.state==='SUCCEEDED'?'ORDER_CONFIRMED':i.state==='READY'?'ORDER_READY':i.state==='WAITING_APPROVAL'?x.data.phase:i.state,workflow:{state:i.state,stage:i.stage,votes:i.votes.map(v=>({actor:v.authority.actor,stage:v.stage,decision:v.decision})),due:i.due.toISOString()},order:{actionId:origin.id,operationId:origin.operation_id,...(out?{schemaVersion:out.event.schemaVersion,objectRevision:out.event.objectRevision,payloadDigest:out.digest}:{})},history:await r.events(o.id)};
 }
 if(op==='purchaseReceive'){
  exact(b,['id','revision','orderOperationId','note',...(quantified(p)?['receivedQuantity','unit']:[])]);text(b.note);
  if(c.delegationId||overlap(c,i.authority)||i.votes.some(v=>overlap(c,v.authority)))fail('PERMISSION_DENIED');
  if(b.revision!==o.revision)fail('CONFLICT');
  const origin=await r.actionForInstance(i),out=await u.outbox(origin.operation_id);
  if(x.data.receipt||i.state!=='SUCCEEDED'||out?.state!=='SUCCEEDED'||b.orderOperationId!==origin.operation_id||!k.journal.committed(origin.operation_id))fail('INVALID_STATE');
  let quantityReceipt={};
  if(quantified(p)){
   positive(b.receivedQuantity);unit(b.unit);const event=orderPayload(o,p,origin,out);
   if(b.receivedQuantity!==event.fields.quantity||b.unit!==event.fields.unit)fail('INVALID_ARGUMENT');
   quantityReceipt={receivedQuantity:b.receivedQuantity,unit:b.unit,actionId:origin.id,orderedRevision:event.objectRevision,packageVersion:p.version,packageDigest:p.digest,payloadDigest:out.digest};
  }
  await reservation(k,u,r,c,o,i,x);
  x.data.receipt={...quantityReceipt,actor:c.actor,subject:c.subject,note:b.note,operationId:origin.operation_id,at:new Date(k.clock()).toISOString()};
  await u.mutate(o,o.fields,actionId);const changed=await r.object(o.id);x.data.fieldsDigest=digest(changed.fields);await r.bindInstance(o.id,purchaseBinding(changed,p));
  await save(k,r,c,x,actionId);return {id:o.id,revision:changed.revision,state:'RECEIVED',receipt:x.data.receipt};
 }
 if(i.state!=='WAITING_APPROVAL'||i.votes.length||i.due.getTime()<=k.clock()||!overlap(c,i.authority))fail('PERMISSION_DENIED');
 if(op==='purchaseQuote'){
  exact(b,['id','revision','quoteId','supplierId','amount','currency',...(quantified(p)?['quantity','unit','quoteVersion']:[])]);
  if(quantified(p)){positive(b.quantity);positive(b.quoteVersion);unit(b.unit);if(b.quantity!==o.fields.quantity||b.unit!==o.fields.unit)fail('INVALID_ARGUMENT');}id(b.quoteId);id(b.supplierId);positive(b.amount);
  if(b.revision!==o.revision)fail('CONFLICT');if(b.currency!==o.fields.currency)fail('INVALID_ARGUMENT');
  if(x.data.quotes.length>=10||x.data.quotes.some(q=>q.quoteId===b.quoteId||q.supplierId===b.supplierId))fail('CONFLICT');
  const supplier=await r.object(b.supplierId);authorize(c,supplier);classified(c,supplier);await sourcePolicy(r,c,'object',supplier.id);
  const s=await procurementConsistent(k,r,c,supplier.id);if(s?.kind!=='supplier'||s.data.scopeDigest!==digest(supplier.enterprise_scope)||!sameScope(supplier.enterprise_scope,o.enterprise_scope)||overlap(s.data.author,i.authority)||s.data.relatedSubjects.some(who=>[i.authority.actor,i.authority.subject].includes(who)))fail('PERMISSION_DENIED');
  x.data.quotes.push({quoteId:b.quoteId,supplierId:b.supplierId,amount:b.amount,currency:b.currency,...(quantified(p)?{quantity:b.quantity,unit:b.unit,quoteVersion:b.quoteVersion}:{}),supplierDigest:digest(s.data)});x.data.selection=null;x.data.phase='REQUESTED';
 }else if(op==='purchaseSelect'){
  exact(b,['id','revision','quoteId','reason']);text(b.reason);
  if(b.revision!==o.revision)fail('CONFLICT');const chosen=x.data.quotes.find(q=>q.quoteId===b.quoteId);
  if(!chosen||x.data.quotes.length<2)fail('INVALID_STATE');
  await suppliers(k,r,c,o,i,x);x.data.selection={quoteId:chosen.quoteId,reason:b.reason};x.data.phase='COMPARED';
 }else fail('UNSUPPORTED_CAPABILITY');
 const chosen=x.data.quotes.find(q=>q.quoteId===x.data.selection?.quoteId);
 const values={...o.fields,amount:chosen?.amount??0,supplierId:chosen?.supplierId??'',quoteId:chosen?.quoteId??'',comparisonDigest:digest({quotes:x.data.quotes,selection:x.data.selection}),...(quantified(p)?{quoteVersion:chosen?.quoteVersion??0}:{})};
 await u.mutate(o,values,actionId);const changed=await r.object(o.id);x.data.fieldsDigest=digest(changed.fields);await r.bindInstance(o.id,purchaseBinding(changed,p));
 await save(k,r,c,x,actionId);return {id:o.id,revision:changed.revision,state:x.data.phase};
}

// Release is permitted before transmission and then blocks dispatch. Once an
// external intent exists, freeing that money could fund a second purchase while
// the first order is applied or uncertain. Keep the reservation until a separate
// cancellation/settlement contract exists (outside this bounded slice).
export async function procurementRelease(k,r,c,b){
 if(typeof b?.reference!=='string')return;
 const o=await r.object(b.reference);if(o?.tenant!==c.tenant||o.type!=='PurchaseRequest')return;
 const {i,x}=await target(k,r,c,o.id);
 if(x.data.reserved&&['UNKNOWN','SUCCEEDED','COMPENSATING','COMPENSATED'].includes(i.state))fail('INVALID_STATE');
}
