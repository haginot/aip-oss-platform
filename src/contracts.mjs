import {storeActions} from './store-actions.mjs';
import { validatePrograms } from './definition-programs.mjs';
import { createHash } from 'node:crypto';
export class PlatformError extends Error {
  constructor(code, details = {}) { super(code); this.code = code; this.details = details; }
}
export const fail = (code, details) => { throw new PlatformError(code, details); };
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export const tokenDigest = token => createHash('sha256').update(token).digest('hex');
export function exact(value, allowed, required = allowed) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(value,k))) fail('INVALID_ARGUMENT');
}
export function typed(value, field) {
  if (value === null) { if (!field.nullable) fail('INVALID_ARGUMENT'); return; }
  if (field.type === 'integer' ? !Number.isSafeInteger(value) : typeof value !== field.type) fail('INVALID_ARGUMENT');
  if (typeof value === 'string' && value.length > 1024) fail('INVALID_ARGUMENT');
}
export function checkAction(request, definition) {
  exact(request, ['actionType','actionVersion','ontologyVersion','input','expectedRevision','idempotencyKey','evidence','requireApproval'], ['actionType','actionVersion','ontologyVersion','input','expectedRevision','idempotencyKey','evidence']);
  const action = definition.actions[request.actionType];
  if (!action || action.version !== request.actionVersion || request.ontologyVersion !== definition.ontologyVersion) fail('UNSUPPORTED_VERSION');
  exact(request.input, Object.keys(action.input));
  for (const [key, field] of Object.entries(action.input)) typed(request.input[key], field);
  if (!Number.isInteger(request.expectedRevision) || request.expectedRevision < 1 || typeof request.idempotencyKey !== 'string' || !/^[\w:-]{1,128}$/.test(request.idempotencyKey) || !Array.isArray(request.evidence) || request.evidence.length > 100 || (request.requireApproval !== undefined && typeof request.requireApproval !== 'boolean')) fail('INVALID_ARGUMENT');
  return action;
}
export function checkFilter(filter, fields, depth = 0) {
  if (!filter) return () => true;
  if (depth > 4) fail('INVALID_ARGUMENT');
  exact(filter, ['op','field','value','values','terms'], ['op']);
  if (filter.op === 'and') {
    exact(filter,['op','terms']);
    if (!Array.isArray(filter.terms) || filter.terms.length > 10) fail('INVALID_ARGUMENT');
    const children = filter.terms.map(f => checkFilter(f, fields, depth + 1));
    return data => children.every(f => f(data));
  }
  if (!fields[filter.field] || fields[filter.field].restricted) fail('PERMISSION_DENIED');
  if (filter.op === 'eq') { exact(filter,['op','field','value']); typed(filter.value,fields[filter.field]); return data => data[filter.field] === filter.value; }
  if (filter.op === 'in') {
    exact(filter,['op','field','values']);
    if (!Array.isArray(filter.values) || filter.values.length > 100 || filter.values.includes(null)) fail('INVALID_ARGUMENT');
    filter.values.forEach(v => typed(v,fields[filter.field]));
    return data => filter.values.includes(data[filter.field]);
  }
  fail('INVALID_ARGUMENT');
}
export function validateDefinition(body) {
  exact(body,['contractVersion','ontologyVersion','policyVersion','ruleVersion','workflowVersion','types','links','actions','programs'],['contractVersion','ontologyVersion','policyVersion','ruleVersion','workflowVersion','types','links','actions']);
  if(body.programs!==undefined) validatePrograms(body.programs);
  for (const key of ['ontologyVersion','policyVersion','ruleVersion','workflowVersion']) if (!/^\d+\.\d+\.\d+$/.test(body[key])) fail('INVALID_ARGUMENT');
  if (body.contractVersion !== '1.0.0' || !body.types.InventoryPosition || !body.actions.SetIsolation) fail('INVALID_ARGUMENT');
  for (const type of Object.values(body.types)) {
    exact(type,['fields']);
    for (const field of Object.values(type.fields)) {
      exact(field,['type','restricted','nullable','unit'],['type']);
      if (!['string','integer','boolean'].includes(field.type)) fail('INVALID_ARGUMENT');
    }
  }
  for (const link of Object.values(body.links)) {
    exact(link,['from','to']);
    if (!body.types[link.from] || !body.types[link.to]) fail('INVALID_ARGUMENT');
  }
  // Only the finite implemented Action registry is executable.
  const supported={SetIsolation:{version:'1.0.0',targetType:'InventoryPosition',input:{targetId:{type:'string'},isolated:{type:'boolean'}}},...storeActions};
  for(const [name,action] of Object.entries(body.actions))if(canonical(action)!==canonical(supported[name]))fail('UNSUPPORTED_CAPABILITY');
}
export function compatible(old, next) {
  validateDefinition(next);
  for (const [type, value] of Object.entries(old.types)) for (const [name, field] of Object.entries(value.fields)) {
    if (canonical(field) !== canonical(next.types[type]?.fields[name])) fail('INCOMPATIBLE_DEFINITION');
  }
  if (canonical(old.links) !== canonical(next.links) || canonical(old.actions) !== canonical(next.actions)) fail('INCOMPATIBLE_DEFINITION');
  for (const [type,value] of Object.entries(next.types)) for (const [name,field] of Object.entries(value.fields)) if (!old.types[type]?.fields[name] && !field.nullable) fail('INCOMPATIBLE_DEFINITION');
}
