import {fail,digest} from '../contracts.mjs';
import {sameScope} from './contracts.mjs';
export async function authority(u,r,credential,operation,saved){
 const policy=await u.policy();if(!policy?.available)fail('UNAVAILABLE');
 let actor,subject,delegation;
 if(saved){actor=await u.principal(saved.actor);subject=await u.principal(saved.subject);}
 else {if(!credential||typeof credential.token!=='string'||Object.keys(credential).some(k=>!['token','delegationId'].includes(k)))fail('PERMISSION_DENIED');actor=await u.identity(credential.token);if(actor)u.requireAuthorityUntil(actor.expires);subject=actor;}
 if(!actor?.active||!subject?.active)fail('PERMISSION_DENIED');
 const delegationId=saved?.delegationId??credential?.delegationId;
 if(delegationId){delegation=await r.delegation(delegationId);if(!delegation?.active||delegation.actor!==actor.id)fail('PERMISSION_DENIED');u.requireAuthorityUntil(delegation.expires);subject=await u.principal(delegation.subject);if(!subject?.active||!delegation.operations.includes(operation))fail('PERMISSION_DENIED');}
 if(actor.tenant!==subject.tenant||(!delegation&&actor.id!==subject.id))fail('PERMISSION_DENIED');
 const a=await r.grant(actor.id),s=await r.grant(subject.id);
 if(!a?.active||!s?.active||!a.operations.includes(operation)||!s.operations.includes(operation))fail('PERMISSION_DENIED');
 const c={actor:actor.id,subject:subject.id,tenant:actor.tenant,delegationId:delegation?.id??null,scopes:a.scopes.filter(x=>s.scopes.some(y=>sameScope(x,y))&&(!delegation||delegation.scopes.some(y=>sameScope(x,y)))),fields:a.fields.filter(x=>s.fields.includes(x)),revision:digest([a.revision,s.revision,policy.epoch]),policyVersion:policy.version};
 c.revision=digest([c.revision,c.scopes,c.fields,delegation?{actor:delegation.actor,subject:delegation.subject,expires:delegation.expires,operations:delegation.operations}:null]);
 if(saved&&(saved.tenant!==c.tenant||saved.subject!==c.subject||saved.revision!==c.revision))fail('STALE_APPROVAL');return c;
}
export function authorized(c,o){return !!o&&o.store===null&&o.tenant===c.tenant&&c.scopes.some(s=>sameScope(s,o.enterprise_scope));}
export function authorize(c,o){if(!authorized(c,o))fail('NOT_FOUND');}
// Purchase fields are CONFIDENTIAL, while their containing scope can be stricter.
// Apply both checks to every projection, including indirect proposal/source reads.
export function procurementVisible(c,o){const label=o.enterprise_scope.classification;return c.fields.includes('CONFIDENTIAL')&&(label==='PUBLIC'||c.fields.includes(label)||label==='STRICT'&&c.fields.includes('RESTRICTED'));}
export function project(c,o,p,projection){
 authorize(c,o);if(['PurchaseRequest','InvoiceRecord','SyntheticPaymentAccount','InvoicePayment'].includes(o.type)&&!procurementVisible(c,o))fail('PERMISSION_DENIED');const fs=p.types[o.type];if(!fs)fail('UNSUPPORTED_VERSION');
 const names=projection??Object.keys(fs).filter(k=>c.fields.includes(fs[k].classification));
 if(!Array.isArray(names)||names.some(k=>!fs[k]))fail('INVALID_ARGUMENT');
 if(names.some(k=>!c.fields.includes(fs[k].classification)))fail('PERMISSION_DENIED');
 return {id:o.id,type:o.type,revision:o.revision,scope:o.enterprise_scope,fields:Object.fromEntries(names.map(k=>[k,o.fields[k]]))};
}
