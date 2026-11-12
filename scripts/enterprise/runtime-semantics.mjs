// Read-only compatibility evidence. Neither a run initializer nor an approval
// reader calls this module. Equal configuration is not proof of engine behavior.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {basename,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {hash,snapshot} from './evidence.mjs';
import {runtimeIdentity} from './runtime.mjs';
import {buildRunPathsFromRunsDirectory} from '../../node_modules/takt/dist/core/workflow/run/run-paths.js';
import {loadWorkflowExecutionBundle} from '../../node_modules/takt/dist/features/tasks/execute/workflowExecutionBundle.js';
import {loadRuntimeProviderFileAt} from '../../node_modules/takt/dist/infra/config/runtime-provider/loader.js';
import {compileProviderEnvironment} from '../../node_modules/takt/dist/infra/config/runtime-provider/environment.js';
import {resolveStepProviderModel} from '../../node_modules/takt/dist/core/workflow/provider-resolution.js';
import {resolvePromotionRuntime} from '../../node_modules/takt/dist/core/workflow/promotion/promotion-runtime.js';
import {resolveProfileScopedProviderOptionsLayers} from '../../node_modules/takt/dist/infra/config/providerOptions.js';

const stepNames=['design-architecture','review-architecture','build-foundation','review-foundation','harden-release','final-audit'];
const json=value=>JSON.parse(JSON.stringify(value));

export async function inspectWorkflowSemantics(runRoot,policyPath){
 runRoot=resolve(runRoot);policyPath=resolve(policyPath);
 const before=snapshot(runRoot,['workflow-bundle']),policyRaw=readFileSync(policyPath);
 const paths=buildRunPathsFromRunsDirectory(dirname(runRoot),basename(runRoot));
 const loaded=loadWorkflowExecutionBundle(paths),workflow=loaded.rootWorkflow;
 assert.equal(loaded.workflows.length,1,'nested workflow comparison unsupported');
 assert.equal(workflow.name,'enterprise-lifecycle','enterprise workflow required');
 assert.deepEqual(workflow.steps.map(s=>s.name),stepNames,'exact six steps required');
 assert.equal(workflow.initialStep,stepNames[0],'initial architecture required');
 assert.equal(workflow.maxSteps,60,'bounded cap must be 60');
 // Compare every serialized field, including future/unknown fields. Only
 // machine-local materialized resource paths become content identities.
 const portable=json(workflow);
 for(const step of portable.steps){
  assert.ok(!step.parallel&&!step.arpeggio&&!step.teamLeader&&!step.dynamicFacets,'complex step comparison unsupported');
  assert.ok(step.kind===undefined||step.kind==='agent','agent step required');
  if(step.personaPath){
   const raw=readFileSync(step.personaPath),sha256=hash(raw);
   assert.equal(loaded.manifest.resources[sha256]?.kind,'prompt','bound persona resource required');
   step.personaPath={sha256,bytes:raw.length};
  }
 }
 assert.ok(!workflow.loopMonitors?.length,'loop monitor comparison unsupported');
 const policy=loadRuntimeProviderFileAt(policyPath);
 assert.ok(policy?.provider,'runtime policy required');
 assert.ok(!policy.provider.assignments&&!policy.provider.directories&&!policy.provider.auto_routing,'external routing indirection unsupported');
 const env=compileProviderEnvironment({kind:'runtime-v1',section:policy.provider}),routing=[];
 for(const step of workflow.steps){
  assert.ok(env.providerRouting?.steps?.[step.name],'explicit self-contained step routing required');
  const initial=resolveStepProviderModel({...env,tagConflictPolicy:env.tagConflictPolicy,step});
  initial.providerOptions=resolveProfileScopedProviderOptionsLayers(step,env,initial.providerSource,true).at(-1)?.options??env.providerOptions;
  assert.ok(initial.provider&&initial.model,'unresolved routing');
  // Cover every possible occurrence within the existing run cap, not just
  // today's model or the first promotion threshold.
  for(let occurrence=1;occurrence<=workflow.maxSteps;occurrence++){
   const promoted=await resolvePromotionRuntime({providerLadders:env.providerLadders,providerRoutingTagConflictPolicy:env.tagConflictPolicy,resolveStepProviderModel:()=>initial},step,occurrence,{providerInfo:initial});
   routing.push({step:step.name,occurrence,providerInfo:json(promoted.providerInfo)});
  }
 }
 assert.deepEqual(snapshot(runRoot,['workflow-bundle']),before,'bundle changed during comparison');
 assert.deepEqual(readFileSync(policyPath),policyRaw,'runtime policy changed during comparison');
 const semantics={workflow:portable,routing,runtimePolicySha256:hash(policyRaw)};
 return {schemaVersion:1,kind:'WORKFLOW_SEMANTICS_DIAGNOSTIC',initializationAuthority:false,currentApprovals:[],engineExecutionProven:false,
  runtime:runtimeIdentity(resolve(import.meta.dirname,'../..')),bundle:before,workflowRef:loaded.manifest.root.originalWorkflowRef,
  semantics,semanticsDigest:hash(JSON.stringify(semantics))};
}

export function compareWorkflowSemantics(source,target){
 for(const value of [source,target]){
  assert.equal(value.schemaVersion,1);assert.equal(value.kind,'WORKFLOW_SEMANTICS_DIAGNOSTIC');
  assert.equal(value.initializationAuthority,false);assert.deepEqual(value.currentApprovals,[]);assert.equal(value.engineExecutionProven,false);
  assert.equal(value.semanticsDigest,hash(JSON.stringify(value.semantics)),'changed semantic record');
 }
 assert.deepEqual(target.semantics,source.semantics,'workflow semantics or routing changed');
 return {kind:'WORKFLOW_SEMANTICS_EQUAL',initializationAuthority:false,currentApprovals:[],engineExecutionProven:false,
  sourceRuntime:source.runtime,targetRuntime:target.runtime,sourceBundle:source.bundle,targetBundle:target.bundle,
  semanticsDigest:source.semanticsDigest,stepCount:6,routingRows:source.semantics.routing.length};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{assert.equal(process.argv.length,4,'usage: runtime-semantics.mjs RUN_ROOT RUNTIME_YAML');console.log(JSON.stringify(await inspectWorkflowSemantics(process.argv[2],process.argv[3]),null,2));}
 catch(error){console.error(error.stack);process.exitCode=1;}
}
