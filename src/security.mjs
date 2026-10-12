import { enforcePolicy } from './definition-programs.mjs';
import { fail } from './contracts.mjs';
export async function authenticate(uow, credential, operation) {
  const policy = await uow.policy();
  if (!policy || !policy.available) fail('UNAVAILABLE');
  if (!credential || typeof credential.token !== 'string' || Object.keys(credential).some(k => !['token','delegationId'].includes(k))) fail('PERMISSION_DENIED');
  const principal = await uow.identity(credential.token);
  if (!principal || !principal.active) fail('PERMISSION_DENIED');
  uow.requireAuthorityUntil(principal.expires);
  let subject = principal;
  let delegation;
  if (credential.delegationId) {
    delegation = await uow.delegation(credential.delegationId);
    if (!delegation || !delegation.active || delegation.actor !== principal.id || delegation.audience !== 'kernel') fail('PERMISSION_DENIED');
    uow.requireAuthorityUntil(delegation.expires);
    subject = await uow.principal(delegation.subject);
    if (!subject?.active || subject.tenant !== principal.tenant || !delegation.operations.includes(operation)) fail('PERMISSION_DENIED');
  }
  const definition=await uow.definition(); enforcePolicy(definition.body,operation);
  if (!principal.operations.includes(operation) || !subject.operations.includes(operation)) fail('PERMISSION_DENIED');
  const stores = principal.stores.filter(s => subject.stores.includes(s) && (!delegation || delegation.stores.includes(s)));
  return {actor:principal.id,onBehalfOf:delegation?subject.id:null,subject:subject.id,tenant:principal.tenant,stores,secretAccess:principal.secret_access && subject.secret_access,policyVersion:policy.version,policyEpoch:policy.epoch,delegationId:delegation?.id ?? null};
}
export const canRead = (ctx,object) => object && object.tenant === ctx.tenant && ctx.stores.includes(object.store);
// Reconstitute a persisted Action's original authority, not the approver's scope.
// Principal/delegation rows stay share-locked through the caller's transaction.
export async function actionContext(uow,action,policy) {
  const actor=await uow.principal(action.actor),subject=await uow.principal(action.subject);
  if(!actor?.active||!subject?.active||actor.tenant!==action.tenant||subject.tenant!==action.tenant||!actor.operations.includes('action')||!subject.operations.includes('action'))fail('PERMISSION_DENIED');
  let delegation;
  if(action.request.delegationId){
    delegation=await uow.delegation(action.request.delegationId);
    if(!delegation?.active||delegation.actor!==actor.id||delegation.subject!==subject.id||delegation.audience!=='kernel'||!delegation.operations.includes('action'))fail('PERMISSION_DENIED');
    uow.requireAuthorityUntil(delegation.expires);
  }else if(actor.id!==subject.id)fail('PERMISSION_DENIED');
  const stores=actor.stores.filter(s=>subject.stores.includes(s)&&(!delegation||delegation.stores.includes(s)));
  if(!stores.includes(action.store))fail('PERMISSION_DENIED');
  return {actor:actor.id,subject:subject.id,onBehalfOf:delegation?subject.id:null,tenant:action.tenant,stores,secretAccess:actor.secret_access&&subject.secret_access,policyVersion:policy.policyVersion,policyEpoch:policy.policyEpoch,delegationId:delegation?.id??null};
}
export function authorize(ctx,object,hidden=false) { if (!canRead(ctx,object)) fail(hidden?'NOT_FOUND':'PERMISSION_DENIED'); }
export function project(ctx,object,definition,projection) {
  const fields = definition.types[object.type]?.fields;
  if (!fields) fail('INCONSISTENT_STATE');
  const names = projection ?? Object.keys(fields).filter(k => !fields[k].restricted || ctx.secretAccess);
  if (!Array.isArray(names) || names.length > 100 || names.some(k => !fields[k])) fail('INVALID_ARGUMENT');
  if (names.some(k => fields[k].restricted && !ctx.secretAccess)) fail('PERMISSION_DENIED');
  return {id:object.id,type:object.type,revision:object.revision,ontologyVersion:definition.ontologyVersion,policyVersion:ctx.policyVersion,sourcePosition:object.source_position,freshness:'authoritative',fields:Object.fromEntries(names.filter(k => Object.hasOwn(object.fields,k)).map(k => [k,object.fields[k]]))};
}
