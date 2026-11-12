import {exact,fail,digest} from '../contracts.mjs';
import {id,scope,deadline} from './contracts.mjs';
import {authorize,authorized,authority} from './security.mjs';
export const assurancePermissions={assuranceAudit:'audit',assuranceRead:'read',assuranceList:'search',resourceCreate:'records',resourceReserve:'action',resourceRelease:'action',resourceClose:'records',slaCreate:'action',slaTick:'worker',emergencyRequest:'action',emergencyApprove:'approve',emergencyUse:'action',emergencyReview:'review',policyCreate:'author',policyApprove:'review',policyApply:'action',coverageCreate:'author',coverageDiscover:'author',coverageExclude:'review',coverageCheck:'read'};
export const assuranceReads=['assuranceAudit','assuranceRead','assuranceList','coverageCheck'];
const kinds=['resource','sla','policy','coverage'];
function visible(c,x){authorize(c,{tenant:x.tenant,store:null,enterprise_scope:x.scope});if(!c.fields.includes('CONFIDENTIAL')||(x.scope.classification&&!c.fields.includes(x.scope.classification)))fail('PERMISSION_DENIED');}
const integer=(n,min=1)=>{if(!Number.isSafeInteger(n)||n<min)fail('INVALID_ARGUMENT');return n;};
const text=x=>{if(typeof x!=='string'||!x.trim()||x.length>500)fail('INVALID_ARGUMENT');return x;};
const time=x=>{if(typeof x!=='string'||!Number.isFinite(Date.parse(x)))fail('INVALID_ARGUMENT');return Date.parse(x);};
const independent=(c,author)=>{if(c.delegationId||c.actor!==c.subject||[author.actor,author.subject].includes(c.actor))fail('PERMISSION_DENIED');};
// Journal is outside the SQL restore boundary. Missing exact committed rows fence
// operations, rather than inferring that an old snapshot never spent a resource.
async function consistent(k,r,c,key){
 const records=k.journal.records(),latest=new Map();
 for(const v of records)if(v.operationKind==='assurance-version'&&v.tenant===c.tenant&&(key===undefined||v.id===key)){
  const terminal=records.filter(y=>y.actionId===v.actionId&&y.operationKind==='submission').at(-1);
  if(terminal?.phase==='ABORTED')continue;
  latest.set(v.id,v);
 }
 for(const v of latest.values()){const row=await r.one('SELECT * FROM enterprise_assurance WHERE tenant=$1 AND id=$2',[c.tenant,v.id]);if(!row||row.revision!==v.revision||digest({kind:row.kind,scope:row.scope,data:row.data})!==v.digest||row.action_id!==v.actionId)fail('RECOVERING');}
}
async function row(k,r,c,key,kind){id(key);const x=await r.one('SELECT * FROM enterprise_assurance WHERE tenant=$1 AND id=$2 FOR UPDATE',[c.tenant,key]);if(x)visible(c,x);await consistent(k,r,c,key);if(!x||kind&&x.kind!==kind)fail('NOT_FOUND');return x;}
async function create(k,r,c,b,kind){id(b.id);scope(b.scope);const x={id:b.id,tenant:c.tenant,kind,scope:b.scope,revision:0,data:{}};visible(c,x);await consistent(k,r,c,b.id);if(await r.one('SELECT 1 FROM enterprise_assurance WHERE tenant=$1 AND id=$2',[c.tenant,b.id]))fail('CONFLICT');return x;}
async function save(k,u,r,c,x,actionId,op){
 if(!x.revision)await r.create(c,{id:x.id,type:'AssuranceRecord',scope:x.scope,fields:{}},actionId);
 x.revision++;k.journal.append({operationKind:'assurance-version',tenant:c.tenant,id:x.id,revision:x.revision,digest:digest({kind:x.kind,scope:x.scope,data:x.data}),actionId});
 await r.query('INSERT INTO enterprise_assurance VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant,id) DO UPDATE SET revision=$5,data=$6,action_id=$7',[c.tenant,x.id,x.kind,JSON.stringify(x.scope),x.revision,JSON.stringify(x.data),actionId]);
 await r.query('INSERT INTO enterprise_assurance_history VALUES($1,$2,$3,$4,$5)',[c.tenant,x.id,x.revision,actionId,JSON.stringify({operation:op,actor:c.actor,subject:c.subject,digest:digest(x.data),policyVersion:c.policyVersion})]);
 return {id:x.id,revision:x.revision,state:x.data.state};
}
export async function assuranceReplay(k,r,c,op,b){
 if(b.scope)visible(c,{tenant:c.tenant,scope:b.scope});
 const x=await row(k,r,c,b.id);
 if(['emergencyApprove','emergencyReview','policyApprove','coverageExclude'].includes(op))independent(c,x.data.author);
 if(op==='emergencyUse')await emergency(k,r,c,x,true);
 if(op==='policyApply')await policyApplicable(k,r,x,b);
}
export async function assuranceRecovery(k,r,c,b){await row(k,r,c,b.id);}
async function emergency(k,r,c,x,replay=false){const e=x.data.emergency;if(!e||e.subject!==c.subject||c.delegationId||(!replay&&e.used)||time(e.expires)<=k.clock()||!e.approval)fail('PERMISSION_DENIED');await authority(r.u,r,null,'approve',e.approval);return e;}
// A saved success is returnable only while its policy and reviewer remain valid.
// Keep this check free of record/history mutations for idempotent replay.
async function policyApplicable(k,r,x,b){
 exact(b,['id','jurisdiction','industry','version','requirements']);const d=x.data;
 if(x.kind!=='policy'||d.state!=='REVIEWED'||!d.approval||time(d.effective)>k.clock()||time(d.expires)<=k.clock()||b.jurisdiction!==d.jurisdiction||b.industry!==d.industry||b.version!==d.version||digest(b.requirements)!==digest(d.requirements))fail('UNSUPPORTED_CAPABILITY');
 await authority(r.u,r,null,'review',d.approval.authority);
}
export async function assurance(k,u,r,c,op,b,actionId){
 if(op==='assuranceList'){
  exact(b,['kind']);await consistent(k,r,c);if(!kinds.includes(b.kind))fail('INVALID_ARGUMENT');const rows=await r.query('SELECT * FROM enterprise_assurance WHERE tenant=$1 AND kind=$2 ORDER BY id',[c.tenant,b.kind]);const items=[];
  for(const x of rows){if(!authorized(c,{tenant:x.tenant,store:null,enterprise_scope:x.scope})||!c.fields.includes('CONFIDENTIAL')||(x.scope.classification&&!c.fields.includes(x.scope.classification)))continue;await consistent(k,r,c,x.id);items.push({id:x.id,revision:x.revision,state:x.data.state});}return {items};
 }
 if(op==='assuranceAudit'){
  exact(b,['id']);const x=await row(k,r,c,b.id),rows=await r.query('SELECT previous_hash,hash,record FROM audit ORDER BY sequence');let previous='GENESIS';
  for(const a of rows){if(a.previous_hash!==previous||a.hash!==digest({previous,record:a.record}))fail('INCONSISTENT_STATE');previous=a.hash;}
  return {id:x.id,chainHead:previous,events:rows.filter(a=>a.record.objectId===x.id).map(a=>({hash:a.hash,record:a.record})),integrity:'Local hash chain; privileged full rewrite is not covered'};
 }
 if(op==='assuranceRead'){exact(b,['id']);const x=await row(k,r,c,b.id);return {...x,history:await r.query('SELECT revision,event,action_id FROM enterprise_assurance_history WHERE tenant=$1 AND id=$2 ORDER BY revision',[c.tenant,b.id])};}
 let x;
 if(op==='resourceCreate'){
  exact(b,['id','scope','currency','unit','capacity','threshold','periodEnd','calculationVersion']);
  if(!['JPY','USD','EUR'].includes(b.currency)||!['minor','item','hour'].includes(b.unit)||b.calculationVersion!=='integer-v1'||time(b.periodEnd)<=k.clock())fail('INVALID_ARGUMENT');integer(b.capacity);integer(b.threshold);if(b.threshold>b.capacity)fail('INVALID_ARGUMENT');
  x=await create(k,r,c,b,'resource');x.data={...b,state:'OPEN',reserved:0,reservations:[],author:c};
 }else if(op==='resourceReserve'){
  exact(b,['id','reference','quantity','currency','unit']);x=await row(k,r,c,b.id,'resource');id(b.reference);integer(b.quantity);const d=x.data;
  if(d.state!=='OPEN'||time(d.periodEnd)<=k.clock())fail('INVALID_STATE');if(b.currency!==d.currency||b.unit!==d.unit)fail('INVALID_ARGUMENT');
  if(d.reservations.some(y=>y.reference===b.reference))fail('CONFLICT');
  // Threshold applies to the entire account and period, not caller-provided groups.
  const total=d.reservations.reduce((n,y)=>n+y.quantity,0)+b.quantity;
  if(!Number.isSafeInteger(total)||total>d.threshold||d.reserved+b.quantity>d.capacity)fail('PERMISSION_DENIED');
  d.reserved+=b.quantity;d.reservations.push({...b,actor:c.subject,state:'RESERVED'});
 }else if(op==='resourceRelease'){
  exact(b,['id','reference']);x=await row(k,r,c,b.id,'resource');if(x.data.state!=='OPEN'||time(x.data.periodEnd)<=k.clock())fail('INVALID_STATE');const item=x.data.reservations.find(y=>y.reference===b.reference);if(!item||item.actor!==c.subject||item.state!=='RESERVED')fail('PERMISSION_DENIED');item.state='RELEASED';x.data.reserved-=item.quantity;
 }else if(op==='resourceClose'){exact(b,['id']);x=await row(k,r,c,b.id,'resource');x.data.state='CLOSED';
 }else if(op==='slaCreate'){
  exact(b,['id','scope','priority','holidays','businessDays']);if(!['NORMAL','URGENT'].includes(b.priority)||!Array.isArray(b.holidays)||b.holidays.length>30||b.holidays.some(v=>!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))))fail('INVALID_ARGUMENT');integer(b.businessDays);if(b.businessDays>30)fail('INVALID_ARGUMENT');
  x=await create(k,r,c,b,'sla');const calendar={timezone:'UTC',weekdays:[1,2,3,4,5],holidays:b.holidays,businessDays:b.priority==='URGENT'?1:b.businessDays};x.data={state:'OPEN',author:c,priority:b.priority,calendar,started:new Date(k.clock()).toISOString(),due:deadline(k.clock(),calendar).toISOString(),emergency:null};
 }else if(op==='slaTick'){
  exact(b,['id']);x=await row(k,r,c,b.id,'sla');if(time(x.data.due)>k.clock()||x.data.state!=='OPEN')fail('INVALID_STATE');x.data.state='ESCALATED';x.data.escalated=new Date(k.clock()).toISOString();
  // Durable internal notification, contains no confidential task payload.
  const a=await u.action(actionId);await u.enqueue({contractVersion:'2.0.0',kind:'sla-escalation',operationId:a.operation_id,actionId,aggregateId:x.id,sequence:await u.nextSequence(x.id),tenant:c.tenant,scope:x.scope});
 }else if(op==='emergencyRequest'){
  exact(b,['id','reason','expires']);x=await row(k,r,c,b.id,'sla');text(b.reason);if(c.delegationId||c.subject!==x.data.author.subject||x.data.emergency||time(b.expires)<=k.clock()||time(b.expires)>k.clock()+3600000)fail('PERMISSION_DENIED');x.data.emergency={reason:b.reason,expires:b.expires,subject:c.subject,approval:null,used:false,review:null};
 }else if(op==='emergencyApprove'){
  exact(b,['id']);x=await row(k,r,c,b.id,'sla');independent(c,x.data.author);if(!x.data.emergency||x.data.emergency.approval||time(x.data.emergency.expires)<=k.clock())fail('INVALID_STATE');x.data.emergency.approval=c;
 }else if(op==='emergencyUse'){
  exact(b,['id']);x=await row(k,r,c,b.id,'sla');const e=await emergency(k,r,c,x);e.used=true;e.usedAt=new Date(k.clock()).toISOString();x.data.state='EMERGENCY_REVIEW_REQUIRED';const a=await u.action(actionId);await u.enqueue({contractVersion:'2.0.0',kind:'sla-emergency-escalation',operationId:a.operation_id,actionId,aggregateId:x.id,sequence:await u.nextSequence(x.id),tenant:c.tenant,scope:x.scope});
 }else if(op==='emergencyReview'){
  exact(b,['id','decision','reason']);x=await row(k,r,c,b.id,'sla');independent(c,x.data.author);const e=x.data.emergency;if(!e?.used||e.review||e.approval.actor===c.actor||!['ACCEPT','REJECT'].includes(b.decision))fail('PERMISSION_DENIED');text(b.reason);e.review={decision:b.decision,reason:b.reason,authority:c};x.data.state=b.decision==='ACCEPT'?'REVIEWED':'REMEDIATION_REQUIRED';
 }else if(op==='policyCreate'){
  exact(b,['id','scope','jurisdiction','industry','version','effective','expires','evidence','owner','requirements']);for(const v of [b.jurisdiction,b.industry,b.version,b.owner])id(v);text(b.evidence);if(time(b.effective)>=time(b.expires)||!Array.isArray(b.requirements)||!b.requirements.length||b.requirements.length>20||new Set(b.requirements).size!==b.requirements.length)fail('INVALID_ARGUMENT');b.requirements.forEach(id);
  x=await create(k,r,c,b,'policy');x.data={...b,state:'DRAFT',author:c,approval:null,applications:[],legalComplianceClaim:false};
 }else if(op==='policyApprove'){
  exact(b,['id','evidence']);x=await row(k,r,c,b.id,'policy');independent(c,x.data.author);if(c.subject!==x.data.owner||x.data.state!=='DRAFT')fail('PERMISSION_DENIED');text(b.evidence);x.data.approval={authority:c,evidence:b.evidence};x.data.state='REVIEWED';
 }else if(op==='policyApply'){
  exact(b,['id','jurisdiction','industry','version','requirements']);x=await row(k,r,c,b.id,'policy');const d=x.data;
  await policyApplicable(k,r,x,b);d.applications.push({actor:c.subject,version:d.version,requirementsDigest:digest(d.requirements),at:new Date(k.clock()).toISOString(),legalComplianceClaim:false});
 }else if(op==='coverageCreate'){
  exact(b,['id','scope','departments','lifecycles','classifications','effects','exceptions']);x=await create(k,r,c,b,'coverage');const dimensions=['departments','lifecycles','classifications','effects','exceptions'];let cells=[{}];
  for(const name of dimensions){const vs=b[name];if(!Array.isArray(vs)||!vs.length||new Set(vs).size!==vs.length)fail('INVALID_ARGUMENT');vs.forEach(id);cells=cells.flatMap(cell=>vs.map(v=>({...cell,[name]:v})));if(cells.length>100)fail('INVALID_ARGUMENT');}
  x.data={state:'GAPS',author:c,cells:cells.map((cell,i)=>({...cell,issueId:'LOCAL-'+x.id+'-'+(i+1),state:'OPEN',reason:null,review:null}))};
 }else if(op==='coverageDiscover'){
  exact(b,['id','cell']);x=await row(k,r,c,b.id,'coverage');exact(b.cell,['departments','lifecycles','classifications','effects','exceptions']);Object.values(b.cell).forEach(id);if(x.data.cells.some(y=>Object.keys(b.cell).every(n=>y[n]===b.cell[n])))fail('CONFLICT');if(x.data.cells.length>=100)fail('INVALID_ARGUMENT');x.data.cells.push({...b.cell,issueId:'LOCAL-'+x.id+'-'+(x.data.cells.length+1),state:'OPEN',reason:null,review:null});x.data.state='GAPS';
 }else if(op==='coverageExclude'){
  exact(b,['id','issueId','reason']);x=await row(k,r,c,b.id,'coverage');independent(c,x.data.author);text(b.reason);const cell=x.data.cells.find(v=>v.issueId===b.issueId);if(!cell||cell.state!=='OPEN')fail('INVALID_STATE');cell.state='EXCLUDED';cell.reason=b.reason;cell.review=c;
 }else if(op==='coverageCheck'){
  exact(b,['id']);x=await row(k,r,c,b.id,'coverage');for(const cell of x.data.cells)if(cell.review)await authority(u,r,null,'review',cell.review);return {id:x.id,complete:false,openIssues:x.data.cells.filter(y=>y.state==='OPEN').map(y=>y.issueId),excluded:x.data.cells.filter(y=>y.state==='EXCLUDED').length,reason:'Implementation and independent evidence required; count or exclusion is not completion'};
 }else fail('UNSUPPORTED_CAPABILITY');
 return save(k,u,r,c,x,actionId,op);
}
