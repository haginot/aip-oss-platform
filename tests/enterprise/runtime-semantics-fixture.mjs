import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture,put,tree} from './evidence-fixture.mjs';
import {inspectWorkflowSemantics,compareWorkflowSemantics} from '../../scripts/enterprise/runtime-semantics.mjs';
import {hash} from '../../scripts/enterprise/evidence.mjs';
import {normalizeWorkflowConfig} from '../../node_modules/takt/dist/infra/config/loaders/workflowParser.js';
import {buildRunPathsFromRunsDirectory} from '../../node_modules/takt/dist/core/workflow/run/run-paths.js';
import {prepareWorkflowExecutionBundle,publishWorkflowExecutionBundle} from '../../node_modules/takt/dist/features/tasks/execute/workflowExecutionBundle.js';

export async function semanticsFixture(t){
 const f=await fixture(t,{seal:false}),runs=join(f.temporary,'semantic-runs'),policy=join(f.temporary,'routing.yaml');
 const names=['design-architecture','review-architecture','build-foundation','review-foundation','harden-release','final-audit'];
 const policyObject={version:1,provider:{profiles:{base:{provider:'codex',model:'gpt-6.1-sol',options:{reasoning_effort:'medium'}},critical:{provider:'codex',model:'gpt-6-astra',options:{reasoning_effort:'high'}}},defaults:{profile:'base'},targets:{steps:Object.fromEntries(names.map(n=>[n,{ladder:['base','critical']}]))}}};
 put(policy,policyObject);
 const raw={name:'enterprise-lifecycle',initial_step:names[0],max_steps:60,steps:names.map((name,i)=>({name,persona:'synthetic '+name,session_key:'session-'+i,edit:i%2===0,capabilities:i%2===0?'edit':'readonly',promotion:[{at:3}],instruction:'synthetic instruction '+i,quality_gates:[{type:'command',name:'synthetic-gate',command:'node --version',timeout_ms:20000}],output_contracts:{report:[{name:'report-'+i+'.md',format:'synthetic'}]},rules:[{condition:'done',next:names[i+1]??'COMPLETE'}]}))};
 const config=normalizeWorkflowConfig(raw,f.root,{projectDir:f.root,lang:'ja'},undefined,undefined,undefined,undefined,undefined,{workflowCommandGatesPolicy:{customScripts:true}});
 let sequence=0;
 function publish(change=()=>{}){
  const workflow=structuredClone(config);change(workflow);
  const paths=buildRunPathsFromRunsDirectory(runs,'case-'+sequence++);
  publishWorkflowExecutionBundle(paths,prepareWorkflowExecutionBundle({rootWorkflow:workflow,workflowCallResolver:()=>null,projectCwd:f.root,lookupCwd:f.root,rootWorkflowRefOverride:'project:sha256:'+hash('semantic-fixture')}));return paths;
 }
 const original=publish(),source=await inspectWorkflowSemantics(original.runRootAbs,policy);
 await t.test('all six steps and sixty occurrences retain gate capability session and promotion',async()=>{
  const relocated=publish(),target=await inspectWorkflowSemantics(relocated.runRootAbs,policy),result=compareWorkflowSemantics(source,target);
  assert.equal(result.routingRows,360);assert.equal(result.initializationAuthority,false);assert.equal(result.engineExecutionProven,false);
  for(const name of names){const rows=source.semantics.routing.filter(r=>r.step===name);assert.equal(rows[1].providerInfo.model,'gpt-6.1-sol');assert.equal(rows[2].providerInfo.model,'gpt-6-astra');assert.equal(rows[59].providerInfo.providerOptions.codex.reasoningEffort,'high');}
 });
 for(const [name,change] of [
  ['instruction',w=>w.steps[0].instruction='changed'],
  ['persona bytes',w=>w.steps[0].persona='changed persona'],
  ['capability',w=>w.steps[1].capabilityProviderOptions.codex.networkAccess=false],
  ['Git permission',w=>w.steps[1].allowGitCommit=true],
  ['edit',w=>w.steps[1].edit=true],
  ['session',w=>w.steps[1].sessionKey='same-builder'],
  ['gate command',w=>w.steps[2].qualityGates[0].command='node --help'],
  ['gate timeout',w=>w.steps[2].qualityGates[0].timeoutMs=1],
  ['rule transition',w=>w.steps[2].rules[0].next='COMPLETE'],
  ['gate skip',w=>w.steps[2].rules[0].commandGates='skip'],
  ['promotion threshold',w=>w.steps[0].promotion[0].at=4],
  ['report',w=>w.steps[1].outputContracts[0].name='another.md'],
  ['unknown field',w=>w.steps[0].futureSetting='unknown']
 ])await t.test('changed '+name+' rejected even with a valid new bundle hash',async()=>{
  const changed=publish(change),target=await inspectWorkflowSemantics(changed.runRootAbs,policy);
  assert.throws(()=>compareWorkflowSemantics(source,target),/workflow semantics or routing changed/);
 });
 for(const [name,change,expected] of [
  ['cap',w=>w.maxSteps=61,/bounded cap/],
  ['initial step',w=>w.initialStep='build-foundation',/initial architecture/],
  ['missing step',w=>w.steps.pop(),/exact six steps/],
  ['reordered steps',w=>w.steps.reverse(),/exact six steps/]
 ])await t.test(name+' rejected',async()=>{const changed=publish(change);await assert.rejects(inspectWorkflowSemantics(changed.runRootAbs,policy),expected);});
 await t.test('changed resolved effort rejected',async()=>{
  const altered=structuredClone(policyObject);altered.provider.profiles.critical.options.reasoning_effort='low';const other=join(f.temporary,'other.yaml');put(other,altered);
  const target=await inspectWorkflowSemantics(original.runRootAbs,other);assert.equal(target.semantics.routing[2].providerInfo.providerOptions.codex.reasoningEffort,'low');assert.throws(()=>compareWorkflowSemantics(source,target),/workflow semantics or routing changed/);
 });
 await t.test('unrecorded routing indirection rejected',async()=>{
  const altered=structuredClone(policyObject);delete altered.provider.targets.steps['final-audit'];const other=join(f.temporary,'missing-route.yaml');put(other,altered);await assert.rejects(inspectWorkflowSemantics(original.runRootAbs,other),/explicit self-contained step routing/);
 });
 await t.test('semantic record tamper and authority injection rejected',()=>{
  const altered=structuredClone(source);altered.semantics.routing[0].providerInfo.model='forged';assert.throws(()=>compareWorkflowSemantics(source,altered),/changed semantic record/);
  for(const key of ['initializationAuthority','engineExecutionProven']){const x=structuredClone(source);x[key]=true;assert.throws(()=>compareWorkflowSemantics(source,x));}
 });
 await t.test('real CLI success and corrupt bundle failure perform zero writes',()=>{
  const cli=resolve(import.meta.dirname,'../../scripts/enterprise/runtime-semantics.mjs');
  const run=()=>spawnSync(process.execPath,['--import',f.guardPath,cli,original.runRootAbs,policy],{encoding:'utf8',timeout:20000});
  let before=tree(runs),q=run();assert.equal(q.status,0,q.stderr);assert.equal(JSON.parse(q.stdout).semantics.routing.length,360);assert.deepEqual(tree(runs),before);
  const resource=join(original.workflowBundleResourcesAbs,fs.readdirSync(original.workflowBundleResourcesAbs)[0]);fs.appendFileSync(resource,'corrupt');before=tree(runs);q=run();assert.equal(q.status,1);assert.match(q.stderr,/size does not match|integrity validation/);assert.doesNotMatch(q.stderr,/FS_MUTATION/);assert.deepEqual(tree(runs),before);
 });
 if(process.env.ENTERPRISE_SUITE_OUTPUT)put(join(process.env.ENTERPRISE_SUITE_OUTPUT,'workflow-semantics','fixture.json'),source);
}
