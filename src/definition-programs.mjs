import { exact, fail, canonical } from './contracts.mjs';
// Finite declarative operators only: definitions never execute supplied code.
export const defaults = Object.freeze({policy:{denyOperations:[]},rule:{minimumQuantity:null,allowRelease:true},workflow:{approvalAtQuantity:null}});
export function programs(definition) { return definition.programs ?? defaults; }
export function validatePrograms(value) {
  exact(value,['policy','rule','workflow']);
  exact(value.policy,['denyOperations']);
  if (!Array.isArray(value.policy.denyOperations) || value.policy.denyOperations.length>4 || new Set(value.policy.denyOperations).size!==value.policy.denyOperations.length || value.policy.denyOperations.some(op=>!['read','search','action','tool'].includes(op))) fail('INVALID_ARGUMENT');
  exact(value.rule,['minimumQuantity','allowRelease']);
  if ((value.rule.minimumQuantity!==null&&(!Number.isSafeInteger(value.rule.minimumQuantity)||value.rule.minimumQuantity<0))||typeof value.rule.allowRelease!=='boolean') fail('INVALID_ARGUMENT');
  exact(value.workflow,['approvalAtQuantity']);
  if (value.workflow.approvalAtQuantity!==null && (!Number.isSafeInteger(value.workflow.approvalAtQuantity)||value.workflow.approvalAtQuantity<0)) fail('INVALID_ARGUMENT');
}
export function versionPrograms(previous,next) {
  for (const name of ['policy','rule','workflow']) if (canonical(programs(previous)[name])!==canonical(programs(next)[name]) && previous[name+'Version']===next[name+'Version']) fail('UNVERSIONED_DEFINITION');
}
export function enforcePolicy(definition,operation) {
  if (programs(definition).policy.denyOperations.includes(operation)) fail('PERMISSION_DENIED');
}
export function decideAction(definition,object,input,requestedApproval=false) {
  const {rule,workflow}=programs(definition);
  if ((rule.minimumQuantity!==null&&(!Number.isSafeInteger(object.fields.quantity)||object.fields.quantity<rule.minimumQuantity))||(!input.isolated&&!rule.allowRelease)) fail('RULE_REJECTED');
  return requestedApproval || (workflow.approvalAtQuantity!==null && object.fields.quantity>=workflow.approvalAtQuantity) ? 'PENDING_APPROVAL' : 'PENDING_EXTERNAL';
}
