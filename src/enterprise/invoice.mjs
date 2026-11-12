import manifest from '../../config/enterprise/invoice.json' with {type:'json'};
import {exact,fail,digest} from '../contracts.mjs';
import {id,scope,sameScope,deadline} from './contracts.mjs';
import {authority,authorize,procurementVisible} from './security.mjs';
import {sourcePolicy} from './information-policy.mjs';
import {procurement,procurementConsistent} from './procurement.mjs';
import {InvoiceRepository} from '../adapters/invoice.mjs';
export const invoiceManifest=manifest;
export const invoicePermissions={invoiceImport:'action',invoiceCorrect:'action',invoiceRead:'read',invoiceAudit:'audit',paymentAccountSet:'records',paymentAccountRead:'read',paymentRequest:'action',paymentRead:'read',paymentCancel:'action'};
export const invoiceReads=['invoiceRead','invoiceAudit','paymentAccountRead','paymentRead'];
export const financialType=t=>['InvoiceRecord','SyntheticPaymentAccount','InvoicePayment'].includes(t);
export const isInvoice=p=>p?.id===manifest.id||p?.manifest?.action?.type==='InvoicePayment';
export function invoicePackage(p){if((p.id===manifest.id||p.action.type==='InvoicePayment')&&digest(p)!==digest(manifest))fail('UNSUPPORTED_VERSION');}
const identity=c=>({actor:c.actor,subject:c.subject,delegationId:c.delegationId,policyVersion:c.policyVersion});
const overlap=(a,b)=>[a.actor,a.subject].some(x=>[b.actor,b.subject].includes(x));
const positive=n=>{if(!Number.isSafeInteger(n)||n<=0)fail('INVALID_ARGUMENT');};
const text=s=>{if(typeof s!=='string'||!s.trim()||s.length>200)fail('INVALID_ARGUMENT');};
const number=s=>{text(s);return s.normalize('NFKC').trim().toUpperCase();};
const binding=(o,p)=>digest({id:o.id,scope:o.enterprise_scope,fields:o.fields,revision:o.revision,packageDigest:p.digest});
function classified(c,o){if(!procurementVisible(c,o))fail('PERMISSION_DENIED');}
// A tenant-wide witness check also fences missing invoices/reservations after SQL
// restore, including attempts to evade a missing ID with a new request ID.
export async function invoiceConsistent(k,r,c,executingActionId=null){
 const records=k.journal.records(),latest=new Map(),repo=new InvoiceRepository(r);
 for(const v of records)if(v.tenant===c.tenant&&v.operationKind==='invoice-version'){
  const terminal=records.filter(y=>y.actionId===v.actionId&&y.operationKind==='submission').at(-1);
  if(v.actionId!==executingActionId&&terminal?.phase!=='ABORTED')latest.set(v.id,v);
 }
 for(const v of latest.values()){
  const x=await repo.get(c.tenant,v.id),o=await r.object(v.id);
  if(!x||!o||o.deleted||o.type!==({invoice:'InvoiceRecord',account:'SyntheticPaymentAccount',payment:'InvoicePayment'})[x.kind]||x.action_id!==v.actionId||x.revision!==v.revision||digest({kind:x.kind,data:x.data,fields:o.fields,scope:o.enterprise_scope,revision:o.revision})!==v.digest)fail('RECOVERING');
 }
 const approvals=new Map();for(const v of records)if(v.tenant===c.tenant&&v.operationKind==='invoice-approval'){const terminal=records.filter(y=>y.actionId===v.actionId&&y.operationKind==='submission').at(-1);if(v.actionId!==executingActionId&&terminal?.phase!=='ABORTED')approvals.set(v.id,v);}
 for(const v of approvals.values()){const i=await r.instance(v.id);if(!i||digest({binding:i.binding,stage:i.stage,votes:i.votes})!==v.digest)fail('RECOVERING');}
 for(const v of records)if(v.tenant===c.tenant&&v.operationKind==='invoice-external-intent'){
  const i=await r.instance(v.id),a=i&&await r.actionForInstance(i),out=a&&await r.u.outbox(a.operation_id);
  if(!i||a?.operation_id!==v.paymentOperationId||!['UNKNOWN','SUCCEEDED'].includes(i.state)||out?.state!==i.state)fail('RECOVERING');
 }
}
async function save(k,r,c,x,o,actionId){
 x.revision++;
 k.journal.append({operationKind:'invoice-version',tenant:c.tenant,id:x.id,revision:x.revision,actionId,digest:digest({kind:x.kind,data:x.data,fields:o.fields,scope:o.enterprise_scope,revision:o.revision})});
 await new InvoiceRepository(r).save(x,actionId);
}
async function target(k,r,c,key,kind){
 id(key);const o=await r.object(key);authorize(c,o);classified(c,o);await sourcePolicy(r,c,'object',key);
 const x=await new InvoiceRepository(r).get(c.tenant,key);if(!x||x.kind!==kind)fail('NOT_FOUND');if(kind==='account'){const supplier=await r.object(x.data.supplierId);authorize(c,supplier);classified(c,supplier);await sourcePolicy(r,c,'object',supplier.id);await procurementConsistent(k,r,c,supplier.id);}return {o,x};
}
async function source(k,u,r,c,purchaseId){
 await authority(u,r,null,'read',c);
 const value=await procurement(k,u,r,c,'purchaseRead',{id:purchaseId});
 const o=await r.object(purchaseId);authorize(c,o);classified(c,o);
 return {value,scope:o.enterprise_scope};
}
const sourceBinding=v=>({id:v.id,revision:v.revision,fields:v.fields,package:v.package,order:v.order,receipt:v.receipt,quantityContract:v.quantityContract});
const sourceDigest=v=>digest(sourceBinding(v));
function compare(b,v){
 const reasons=[];
 for(const f of ['amount','currency','supplierId','quantity','unit'])if(b[f]!==v.fields[f])reasons.push(f.toUpperCase()+'_MISMATCH');
 if(!v.quantityContract.matchEligible||v.quantityContract.status!=='KNOWN'||!v.receipt)reasons.push('RECEIPT_NOT_ELIGIBLE');
 return reasons;
}
async function paymentTarget(k,u,r,c,key,{current=true}={}){
 const {o,x}=await target(k,r,c,key,'payment'),{o:io,x:ix}=await target(k,r,c,x.data.invoiceId,'invoice');
 const src=await source(k,u,r,c,ix.data.purchaseId);
 if(!sameScope(o.enterprise_scope,io.enterprise_scope)||!sameScope(src.scope,io.enterprise_scope)||sourceDigest(src.value)!==o.fields.sourceDigest)fail('STALE_APPROVAL');
 const i=await r.instance(key),p=i&&await r.package(c.tenant,i.package_id,i.package_version);
 if(!i||!p||!isInvoice(p)||p.digest!==digest(manifest)||digest(p.manifest)!==p.digest||binding(o,p)!==i.binding||digest(x.data.fields)!==digest(o.fields)||!['HELD','RELEASED'].includes(x.data.reservation))fail('STALE_APPROVAL');
 const {o:ao,x:ax}=await target(k,r,c,o.fields.accountId,'account');
 if(current){
  if(ix.revision!==o.fields.invoiceRevision||ix.data.state!=='MATCHED'||ax.revision!==o.fields.accountRevision||digest(ax.data)!==o.fields.accountDigest||!sameScope(ao.enterprise_scope,o.enterprise_scope))fail('STALE_APPROVAL');
 }
 return {o,x,i,p,ix};
}
export async function invoiceGuard(k,u,r,c,o,i,p,op){
 if(!financialType(o.type))return;
 classified(c,o);
 if(o.type!=='InvoicePayment')fail('UNSUPPORTED_CAPABILITY');
 if(['edit','attach','cancel','routeSet','definitionMigrate','documentUpload','documentHold','documentDelete'].includes(op))fail('PERMISSION_DENIED');
 const v=await paymentTarget(k,u,r,c,o.id,{current:op==='vote'});
 if(op==='vote'){
  if(overlap(c,v.ix.data.author)||overlap(c,v.x.data.author)||[v.ix.data.source.receipt.actor,v.ix.data.source.receipt.subject].some(w=>[c.actor,c.subject].includes(w)))fail('PERMISSION_DENIED');
 }
}
export function invoiceApproval(k,c,o,i,p,actionId){if(isInvoice(p))k.journal.append({operationKind:'invoice-approval',tenant:c.tenant,id:o.id,actionId,digest:digest({binding:i.binding,stage:i.stage,votes:i.votes})});}
export function invoiceIntent(k,c,o,p,a){if(isInvoice(p))k.journal.append({operationKind:'invoice-external-intent',tenant:c.tenant,id:o.id,paymentOperationId:a.operation_id});}
export async function invoiceExecution(k,u,r,c,o,i,p,mode){
 if(!isInvoice(p))return;
 if(mode==='compensate')fail('UNSUPPORTED_CAPABILITY');
 const v=await paymentTarget(k,u,r,c,o.id,{current:mode==='dispatch'});if(v.x.data.reservation!=='HELD')fail('INVALID_STATE');
 if(o.fields.operationKind!=='invoice-payment'||o.fields.destination!=='local-synthetic-payment')fail('INCONSISTENT_STATE');
 if(await r.one('SELECT 1 FROM enterprise_routes WHERE object_id=$1',[o.id]))fail('PERMISSION_DENIED');
}
export async function invoiceReplay(k,u,r,c,op,b){
 if(op==='paymentAccountSet'||op==='paymentAccountRead')await target(k,r,c,b.id,'account');
 else if(['paymentRequest','paymentCancel','paymentRead','vote'].includes(op)){const v=await paymentTarget(k,u,r,c,b.id,{current:false});if(op==='paymentRequest')return v.x.data.submissionResult;}
 else {const {x}=await target(k,r,c,b.id,'invoice');await source(k,u,r,c,x.data.purchaseId);}
}
export async function invoice(k,u,r,c,op,b,actionId){
 const repo=new InvoiceRepository(r);
 if(op==='paymentAccountSet'){
  exact(b,['id','scope','supplierId','currency','syntheticReference','revision']);id(b.id);id(b.supplierId);scope(b.scope);if(c.delegationId)fail('PERMISSION_DENIED');
  if(!['JPY','USD','EUR'].includes(b.currency)||typeof b.syntheticReference!=='string'||!/^synthetic:[-a-zA-Z0-9_.:]{1,100}$/.test(b.syntheticReference))fail('INVALID_ARGUMENT');
  const supplier=await r.object(b.supplierId);authorize(c,supplier);classified(c,supplier);await sourcePolicy(r,c,'object',supplier.id);
  const s=await procurementConsistent(k,r,c,b.supplierId);if(s?.kind!=='supplier'||!sameScope(supplier.enterprise_scope,b.scope))fail('INVALID_ARGUMENT');
  const old=await repo.get(c.tenant,b.id);let o;
  if(old){
   const v=await target(k,r,c,b.id,'account');o=v.o;
   if(b.revision!==old.revision)fail('CONFLICT');
   if(old.data.supplierId!==b.supplierId||old.data.currency!==b.currency||!sameScope(o.enterprise_scope,b.scope))fail('INVALID_ARGUMENT');
  }else{
   if(b.revision!==0||await r.object(b.id))fail('CONFLICT');authorize(c,{tenant:c.tenant,store:null,enterprise_scope:b.scope});classified(c,{enterprise_scope:b.scope});
   o=await r.create(c,{id:b.id,type:'SyntheticPaymentAccount',scope:b.scope,fields:{supplierId:b.supplierId,currency:b.currency,syntheticReference:b.syntheticReference}},actionId);
  }
  const data={supplierId:b.supplierId,currency:b.currency,syntheticReference:b.syntheticReference,author:identity(c)};
  if(old){await u.mutate(o,{supplierId:b.supplierId,currency:b.currency,syntheticReference:b.syntheticReference},actionId);o=await r.object(b.id);}
  const x={id:b.id,tenant:c.tenant,kind:'account',revision:old?.revision??0,data};await save(k,r,c,x,o,actionId);return {id:b.id,revision:x.revision,state:'REGISTERED'};
 }
 if(op==='invoiceImport'||op==='invoiceCorrect'){
  const keys=['id','purchaseId','number','supplierId','amount','currency','quantity','unit'];exact(b,op==='invoiceImport'?keys:[...keys,'revision']);id(b.id);id(b.purchaseId);id(b.supplierId);positive(b.amount);positive(b.quantity);text(b.unit);if(!['JPY','USD','EUR'].includes(b.currency))fail('INVALID_ARGUMENT');const normalizedNumber=number(b.number);
  const src=await source(k,u,r,c,b.purchaseId);let o,x;
  if(op==='invoiceImport'){
   if(await r.object(b.id)||await repo.get(c.tenant,b.id)||await repo.duplicate(c.tenant,b.supplierId,normalizedNumber))fail('CONFLICT');
   o=await r.create(c,{id:b.id,type:'InvoiceRecord',scope:src.scope,fields:{...b}},actionId);x={id:b.id,tenant:c.tenant,kind:'invoice',revision:0,data:{author:identity(c)}};
  }else{
   ({o,x}=await target(k,r,c,b.id,'invoice'));
   if(c.delegationId||!overlap(c,x.data.author))fail('PERMISSION_DENIED');if(b.revision!==x.revision)fail('CONFLICT');
   if(b.purchaseId!==x.data.purchaseId)fail('INVALID_ARGUMENT');const duplicate=await repo.duplicate(c.tenant,b.supplierId,normalizedNumber);if(duplicate&&duplicate.id!==b.id)fail('CONFLICT');
   if((await repo.payments(c.tenant)).some(p=>p.data.invoiceId===b.id&&p.data.reservation==='HELD'))fail('INVALID_STATE');
   const {revision,...f}=b;await u.mutate(o,f,actionId);o=await r.object(b.id);
  }
  const reasons=compare(b,src.value);x.data={...x.data,purchaseId:b.purchaseId,supplierId:b.supplierId,normalizedNumber,state:reasons.length?'QUARANTINED':'MATCHED',reasons,source:sourceBinding(src.value)};
  await save(k,r,c,x,o,actionId);return {id:b.id,revision:x.revision,state:x.data.state,reasons};
 }
 if(['invoiceRead','paymentAccountRead','paymentRead','invoiceAudit'].includes(op)){
  exact(b,['id']);const kind=op==='paymentAccountRead'?'account':op==='paymentRead'?'payment':'invoice';
  const {o,x}=kind==='payment'?await paymentTarget(k,u,r,c,b.id,{current:false}):await target(k,r,c,b.id,kind);
  if(kind==='invoice')await source(k,u,r,c,x.data.purchaseId);
  if(op==='invoiceAudit'){
   const rows=await r.query('SELECT previous_hash,hash,record FROM audit ORDER BY sequence');let prev='GENESIS';for(const row of rows){if(row.previous_hash!==prev||row.hash!==digest({previous:prev,record:row.record}))fail('INCONSISTENT_STATE');prev=row.hash;}
   return {id:o.id,chainHead:prev,events:rows.filter(z=>z.record.resource?.namespace==='enterprise-case'&&z.record.resource.tenant===c.tenant&&z.record.resource.id===o.id)};
  }
  const i=kind==='payment'?await r.instance(o.id):null,a=i&&await r.actionForInstance(i),out=a&&await u.outbox(a.operation_id);
  return {id:o.id,revision:x.revision,fields:o.fields,scope:o.enterprise_scope,...x.data,history:await r.events(o.id),...(i?{state:i.state,workflow:{stage:i.stage,votes:i.votes.map(v=>({actor:v.authority.actor,subject:v.authority.subject,stage:v.stage,decision:v.decision}))},operation:{id:a.operation_id,actionId:a.id,payloadDigest:out?.digest}}:{})};
 }
 if(op==='paymentRequest'){
  exact(b,['id','invoiceId','revision','accountId','amount']);id(b.id);id(b.invoiceId);id(b.accountId);positive(b.amount);if(c.delegationId)fail('PERMISSION_DENIED');
  const {o:io,x:ix}=await target(k,r,c,b.invoiceId,'invoice'),src=await source(k,u,r,c,ix.data.purchaseId);
  if(b.revision!==ix.revision)fail('CONFLICT');
  if(ix.data.state!=='MATCHED'||compare(io.fields,src.value).length||sourceDigest(src.value)!==digest(ix.data.source))fail('INVALID_STATE');
  const {o:ao,x:ax}=await target(k,r,c,b.accountId,'account');if(ax.data.supplierId!==ix.data.supplierId||ax.data.currency!==io.fields.currency||!sameScope(ao.enterprise_scope,io.enterprise_scope))fail('INVALID_ARGUMENT');
  // source() holds the PO row lock; both invoice and PO totals include uncertain
  // and settled payments. A lost acknowledgement never releases funds.
  const payments=await repo.payments(c.tenant),held=payments.filter(p=>p.data.reservation==='HELD');
  for(const [key,max] of [['invoiceId',io.fields.amount],['purchaseId',src.value.fields.amount]]){
   const targetId=key==='invoiceId'?io.id:ix.data.purchaseId;let remaining=max;
   for(const p of held.filter(p=>p.data[key]===targetId))remaining-=p.data.fields.amount;
   if(b.amount>remaining)fail('CONFLICT');
  }
  if(await r.object(b.id))fail('CONFLICT');
  const p=await r.package(c.tenant,manifest.id,manifest.version);if(!p||p.state!=='PUBLISHED'||p.digest!==digest(manifest)||digest(p.manifest)!==p.digest)fail('UNSUPPORTED_VERSION');
  const f={invoiceId:io.id,invoiceRevision:ix.revision,purchaseId:ix.data.purchaseId,sourceDigest:sourceDigest(src.value),supplierId:ix.data.supplierId,amount:b.amount,currency:io.fields.currency,accountId:ao.id,accountRevision:ax.revision,accountDigest:digest(ax.data),syntheticReference:ax.data.syntheticReference,operationKind:'invoice-payment',destination:'local-synthetic-payment'};
  const o=await r.create(c,{id:b.id,type:'InvoicePayment',scope:io.enterprise_scope,fields:f},actionId);
  await r.start(o,p,binding(o,p),c,actionId,deadline(k.clock(),p.manifest.calendar));
  const x={id:b.id,tenant:c.tenant,kind:'payment',revision:0,data:{invoiceId:io.id,purchaseId:ix.data.purchaseId,fields:f,author:identity(c),reservation:'HELD',submissionResult:{id:b.id,revision:1,state:'WAITING_APPROVAL'},accountSnapshot:ax.data}};
  await save(k,r,c,x,o,actionId);return {id:b.id,revision:o.revision,state:'WAITING_APPROVAL'};
 }
 if(op==='paymentCancel'){
  exact(b,['id']);const {o,x,i}=await paymentTarget(k,u,r,c,b.id,{current:false});
  if(!overlap(c,x.data.author)||!['WAITING_APPROVAL','RETURNED','READY','EXPIRED'].includes(i.state)||k.journal.records().some(v=>v.operationKind==='invoice-external-intent'&&v.tenant===c.tenant&&v.id===b.id))fail('INVALID_STATE');
  i.state='CANCELLED';await r.setInstance(i);await u.updateAction(i.action_id,'CANCELLED',{targetId:o.id});
  const a=await r.actionForInstance(i);if(await u.outbox(a.operation_id))await r.setOutbox(a.operation_id,'CANCELLED');
  x.data.reservation='RELEASED';await save(k,r,c,x,o,actionId);return {id:o.id,state:'CANCELLED'};
 }
 fail('UNSUPPORTED_CAPABILITY');
}
