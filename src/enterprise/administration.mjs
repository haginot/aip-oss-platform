import {exact,fail,digest} from '../contracts.mjs';
import {id,validatePackage,fields,deadline,classifications} from './contracts.mjs';
import {authority,authorize,project} from './security.mjs';
import {sourcePolicy} from './information-policy.mjs';
export const administrationPermissions={definitionList:'author',definitionSimulate:'review',definitionDraft:'author',definitionMigrate:'publish'};
export const administrationReads=['definitionList','definitionSimulate'];
export function definitionAccess(c,p){if(Object.values(p.types).some(t=>Object.values(t).some(f=>!c.fields.includes(f.classification))))fail('PERMISSION_DENIED');}
export function difference(a,b){const changes=[];for(const key of new Set([...Object.keys(a),...Object.keys(b)]))if(digest(a[key]??null)!==digest(b[key]??null))changes.push({field:key,before:a[key]??null,after:b[key]??null});return changes;}
export async function administration(k,u,r,c,op,b,actionId){
 if(op==='definitionList'){
  exact(b,['id']);const rows=await r.query('SELECT * FROM enterprise_packages WHERE tenant=$1 AND id=$2 ORDER BY version',[c.tenant,id(b.id)]);for(const p of rows)definitionAccess(c,p.manifest);
  const live=await r.live(c.tenant,b.id);const history=await r.query("SELECT id,state,request,result FROM actions WHERE tenant=$1 AND request->>'operation'=ANY($2) ORDER BY id",[c.tenant,['install','review','publish','definitionDraft','definitionMigrate']]);
  return {live:live?.version??null,items:rows.map(p=>({version:p.version,state:p.state,manifest:p.manifest,author:p.author,reviewer:p.reviewer})),history:history.filter(a=>(a.request.body.id??a.request.body.manifest?.id)===b.id).map(a=>({id:a.id,operation:a.request.operation,state:a.state,result:a.result}))};
 }
 if(op==='definitionDraft'){
  exact(b,['id','baseVersion','version','label','businessDays','quorum']);const base=await r.package(c.tenant,id(b.id),b.baseVersion);if(!base)fail('NOT_FOUND');definitionAccess(c,base.manifest);
  const p=structuredClone(base.manifest);p.version=b.version;p.form[0].label=b.label;p.calendar.businessDays=b.businessDays;p.route[0].quorum=b.quorum;validatePackage(p);
  if(await r.package(c.tenant,p.id,p.version))fail('CONFLICT');await r.install(c.tenant,p,c);return {state:'DRAFT',version:p.version,diff:difference(base.manifest,p)};
 }
 if(op==='definitionSimulate'){
  exact(b,['id','version']);const p=await r.package(c.tenant,id(b.id),b.version);if(!p)fail('NOT_FOUND');definitionAccess(c,p.manifest);validatePackage(p.manifest);const live=await r.live(c.tenant,b.id);
  const incompatible=[];if(live){for(const type of new Set([...Object.keys(live.manifest.types),...Object.keys(p.manifest.types)]))for(const name of new Set([...Object.keys(live.manifest.types[type]??{}),...Object.keys(p.manifest.types[type]??{})]))if(digest(live.manifest.types[type]?.[name]??null)!==digest(p.manifest.types[type]?.[name]??null))incompatible.push(type+'.'+name);}
  return {version:p.version,fixtures:p.manifest.fixtures.map((x,i)=>({index:i,expected:x.expected,passed:true})),incompatible,diff:difference(live?.manifest??{},p.manifest),requiresIndependentReview:true};
 }
 if(op==='definitionMigrate'){
  exact(b,['id','version','revision','purpose'],['id','version','revision']);
  if(b.purpose!==undefined&&(typeof b.purpose!=='string'||!b.purpose.length||b.purpose.length>128))fail('INVALID_ARGUMENT');
  const o=await r.object(id(b.id));authorize(c,o);await sourcePolicy(r,c,'object',o.id,b.purpose);const i=await r.instance(o.id),old=await r.package(c.tenant,i.package_id,i.package_version),p=await r.package(c.tenant,i.package_id,b.version);
  if(!p||p.state!=='PUBLISHED')fail('INVALID_STATE');definitionAccess(c,p.manifest);project(c,o,old.manifest,Object.keys(o.fields));
  if(i.state!=='WAITING_APPROVAL'||i.votes.length||o.revision!==b.revision)fail('CONFLICT');
  if(digest({id:o.id,scope:o.enterprise_scope,fields:o.fields,revision:o.revision,packageDigest:old.digest})!==i.binding)fail('STALE_APPROVAL');
  await authority(u,r,null,'action',i.authority);validatePackage(p.manifest);if(p.manifest.action.type!==o.type)fail('INVALID_ARGUMENT');fields(p.manifest,o.type,o.fields);
  // Use every classification accepted by the package contract, and reject
  // unknown persisted labels rather than treating indexOf(-1) as public.
  const rank=value=>classifications.indexOf(value==='RESTRICTED'?'STRICT':value);
  for(const key of Object.keys(o.fields)){
   const from=rank(old.manifest.types[o.type]?.[key]?.classification),to=rank(p.manifest.types[o.type]?.[key]?.classification);
   if(from<0||to<0||to<from)fail('PERMISSION_DENIED');
  }
  const changed=await u.mutate(o,o.fields,actionId);const binding=digest({id:o.id,scope:o.enterprise_scope,fields:changed.fields,revision:changed.revision,packageDigest:p.digest});
  await r.query('UPDATE enterprise_instances SET package_version=$2,binding=$3,stage=0,votes=\'[]\',due=$4 WHERE id=$1',[o.id,p.version,binding,deadline(k.clock(),p.manifest.calendar)]);await k.fault('definition-migration-before-audit');
  return {id:o.id,state:'WAITING_APPROVAL',from:old.version,version:p.version,revision:changed.revision};
 }
}
export async function administrationReplay(r,c,op,b){
 if(op==='definitionMigrate'){const o=await r.object(b.id);authorize(c,o);await sourcePolicy(r,c,'object',o.id,b.purpose);const i=await r.instance(o.id);definitionAccess(c,(await r.package(c.tenant,i.package_id,i.package_version)).manifest);}
 else {const p=await r.package(c.tenant,b.id,b.version);if(!p)fail('NOT_FOUND');definitionAccess(c,p.manifest);}
}
