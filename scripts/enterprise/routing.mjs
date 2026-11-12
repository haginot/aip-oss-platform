import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {parse} from 'yaml';
import {resolveRuntimeProviderFile} from '../../node_modules/takt/dist/infra/config/runtime-provider/loader.js';
import {getGlobalConfigDir} from '../../node_modules/takt/dist/infra/config/paths.js';
import {compileProviderEnvironment} from '../../node_modules/takt/dist/infra/config/runtime-provider/environment.js';
import {resolveStepProviderModel} from '../../node_modules/takt/dist/core/workflow/provider-resolution.js';
import {resolvePromotionRuntime} from '../../node_modules/takt/dist/core/workflow/promotion/promotion-runtime.js';
import {resolveProfileScopedProviderOptionsLayers} from '../../node_modules/takt/dist/infra/config/providerOptions.js';

// Inspect enterprise workflow with TAKT's real compiler/resolvers. No model calls or smoke writes.
const root=resolve(import.meta.dirname,'../..');
const runtime=resolveRuntimeProviderFile({globalConfigDir:getGlobalConfigDir(),projectConfigDir:resolve(root,'.takt')});
const env=compileProviderEnvironment({kind:'runtime-v1',section:runtime.provider});
const workflow=parse(readFileSync(resolve(root,'.takt/workflows/enterprise-lifecycle.yaml'),'utf8'));
const steps=[];
for(const step of workflow.steps) {
  const target={...step,personaDisplayName:step.persona};
  const initial=resolveStepProviderModel({...env,tagConflictPolicy:env.tagConflictPolicy,step:target});
  initial.providerOptions=resolveProfileScopedProviderOptionsLayers(target,env,initial.providerSource,true).at(-1)?.options??env.providerOptions;
  const progression=[];
  for(const iteration of [1,2,3,4]) {
    const result=await resolvePromotionRuntime({providerLadders:env.providerLadders,
      providerRoutingTagConflictPolicy:env.tagConflictPolicy,resolveStepProviderModel:()=>initial},target,iteration,{providerInfo:initial});
    progression.push({iteration,model:result.providerInfo.model,effort:result.providerInfo.providerOptions?.codex?.reasoningEffort});
  }
  steps.push({step:step.name,session:step.session_key,capabilities:step.capabilities,edit:step.edit,provider:initial.provider,progression});
}
const smoke=JSON.parse(readFileSync(resolve(root,'evidence/model-smoke.json'),'utf8'));
const runtimeDigest=createHash('sha256').update(JSON.stringify(runtime)).digest('hex');
console.log(JSON.stringify({scope:'routing resolution, not live model smoke',runtimeDigest,steps,
  savedSmoke:{path:'evidence/model-smoke.json',checkedAt:smoke.checkedAt,status:smoke.status,
    configurations:smoke.results.map(({model,effort,status})=>({model,effort,status})),runtimeMatches:smoke.runtimeDigest===runtimeDigest}},null,2));
