import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {join,resolve,dirname,basename,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawnSync,spawn} from 'node:child_process';
import {registerProject} from '../../node_modules/takt/dist/infra/config/global/projectRegistry.js';
import {resolveStatePaths,resolveRunPaths} from '../../node_modules/takt/dist/core/execution/locations.js';
import {prepareWorkflowExecutionBundle,publishWorkflowExecutionBundle,loadWorkflowExecutionBundle} from '../../node_modules/takt/dist/features/tasks/execute/workflowExecutionBundle.js';
import {savePersonaSessions} from '../../node_modules/takt/dist/infra/config/project/sessionStore.js';
import {runSingleWorkflowIteration} from '../../node_modules/takt/dist/core/workflow/engine/WorkflowRunLoop.js';
import {createInitialState} from '../../node_modules/takt/dist/core/workflow/engine/state-manager.js';
import {runCommandQualityGate} from '../../node_modules/takt/dist/core/workflow/quality-gates/commandGateRunner.js';
import {hash} from '../../scripts/enterprise/evidence.mjs';
import {normalizeWorkflowConfig} from '../../node_modules/takt/dist/infra/config/loaders/workflowParser.js';

const source=resolve(import.meta.dirname,'../..');
export function put(path,value) {fs.mkdirSync(dirname(path),{recursive:true});fs.writeFileSync(path,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');}
export const read=p=>JSON.parse(fs.readFileSync(p));
export function tree(root) {
 const entries=[];
 function walk(path) {const s=fs.lstatSync(path);entries.push({path:path.slice(root.length),mode:s.mode,mtime:s.mtimeMs,bytes:s.isFile()?hash(fs.readFileSync(path)):null});if(s.isDirectory())for(const n of fs.readdirSync(path).sort())walk(join(path,n));}
 walk(root);return entries;
}
// Blocks even a create-then-remove mutation, across sync/callback/promise APIs.
const guard=`import fs from 'node:fs';import childProcess from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const deny=name=>()=>{throw Error('FS_MUTATION:'+name)};
for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])childProcess[name]=deny('subprocess.'+name);
for(const name of ['appendFile','chmod','chown','copyFile','cp','fchmod','fchown','ftruncate','futimes','link','lchmod','lchown','lutimes','mkdir','mkdtemp','rename','rm','rmdir','symlink','truncate','unlink','utimes','write','writev','writeFile']) {
 for(const n of [name,name+'Sync']) if(fs[n])fs[n]=deny(n);
 if(fs.promises[name])fs.promises[name]=deny('promises.'+name);
}
for(const name of ['open','openSync']){const original=fs[name];fs[name]=function(path,flags,...rest){if(typeof flags==='number' ? (flags & (fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND))!==0 : flags!==undefined&&flags!=='r') return deny(name)();return original.call(this,path,flags,...rest)}}
const originalOpen=fs.promises.open;fs.promises.open=function(path,flags,...rest){if(typeof flags==='number' ? (flags & (fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND))!==0 : flags!==undefined&&flags!=='r')return deny('promises.open')();return originalOpen.call(this,path,flags,...rest)};
fs.createWriteStream=deny('createWriteStream');
const originalRead=fs.readFileSync;let reads=0;
fs.readFileSync=function(path,...rest){if(process.env.INJECT_CONCURRENT&&String(path).endsWith('/src/domain.mjs')&&++reads===6){process.stdout.write('CONCURRENT_READY\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500)}return originalRead.call(this,path,...rest)};
syncBuiltinESMExports();`;
export async function fixture(t,{seal=true,multi=false,selection=false,batchOverrides={},batchOptions={},reviewDefinition={},auditDefinition={},recovery=false,designHistory=false,evidenceBatches=false,compiledWorkflow}={}) {
 const temporary=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'enterprise-final-')));t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
 const root=join(temporary,'product'),global=join(temporary,'orchestrator');
 fs.mkdirSync(root);fs.mkdirSync(global);fs.symlinkSync(join(source,'node_modules'),join(root,'node_modules'),'dir');
 for(const p of ['scripts/enterprise','work/enterprise','.takt','evidence','src','tests'])fs.mkdirSync(join(root,p),{recursive:true});
 for(const name of ['verify.mjs','evidence.mjs','context.mjs','runtime.mjs','finalization.mjs','approval.mjs','selection.mjs','continuation.mjs','closure.mjs','rejected-regeneration.mjs','gate-execution.mjs'])fs.copyFileSync(join(source,'scripts/enterprise',name),join(root,'scripts/enterprise',name));
 for(const path of ['evidence/FAILURES.md','evidence/ACCEPTANCE_MATRIX.md','src/domain.mjs','work/enterprise/issues.md'])put(join(root,path),'synthetic fixture');
 const suite={id:'audit-preparation',path:'tests/assertion.test.mjs',command:[process.execPath,'--test','--test-reporter=tap','tests/assertion.test.mjs'],requiredAssertions:['real arithmetic assertion']};
 put(join(root,suite.path),"import test from 'node:test';import assert from 'node:assert/strict';import {mkdirSync,writeFileSync} from 'node:fs';test('real arithmetic assertion',()=>{assert.equal(6*7,42);mkdirSync(process.env.ENTERPRISE_SUITE_OUTPUT,{recursive:true});writeFileSync(process.env.ENTERPRISE_SUITE_OUTPUT+'/actual.json',JSON.stringify({actual:6*7}));});\n");
 const item={id:'ENT-705',parent:'ENT-700',children:[],dependsOn:[],acceptance:['synthetic acceptance']};
 const issue={...item,originalAcceptance:item.acceptance,batchId:'B00',sourceSpec:'work/enterprise/issues.md',sourceSpecSha256:hash('synthetic fixture'),acceptanceTests:[{id:'ENT-705/AC-01'}],suites:[suite,{id:'complete-machine-gate'}]};
 const parent={id:'ENT-700',parent:null,children:['ENT-705'],dependsOn:[],acceptance:['synthetic parent acceptance']};
 const parentIssue={...parent,originalAcceptance:parent.acceptance,sourceSpec:issue.sourceSpec,sourceSpecSha256:issue.sourceSpecSha256,acceptanceTests:[{id:'ENT-700/AC-01'}],suites:[]};
 put(join(root,'work/enterprise/plan.json'),{schemaVersion:1,sourceSnapshots:[],issues:[issue,parentIssue],batches:[{id:'B00',issueIds:['ENT-705'],stage:'final-audit',reviewStage:'final-audit',dependsOnBatches:[]}],protectedFiles:[]});
 put(join(root,'work/enterprise/backlog.json'),{items:[item,parent]});
 put(join(root,'work/enterprise/coverage.json'),{synthetic:true});put(join(root,'work/enterprise/scope-revision.json'),{revision:'synthetic'});
 put(join(root,'work/enterprise/progress.json'),{schemaVersion:1,activeBatchId:'B00',issues:{},approvals:{}});
 if(multi) {
  const plan=read(join(root,'work/enterprise/plan.json')),backlog=read(join(root,'work/enterprise/backlog.json'));
  const batches=[{id:'B00',issueIds:['ENT-101'],stage:'build-foundation',reviewStage:'review-foundation',dependsOnBatches:[]},
    {id:'B22',issueIds:['ENT-701','ENT-702','ENT-703','ENT-704'],stage:'harden-release',reviewStage:'final-audit',dependsOnBatches:['B00']},
    {id:'B23',issueIds:['ENT-705'],stage:'final-audit',reviewStage:'final-audit',dependsOnBatches:['B22']}];
  if(selection){batches[1].id='B01';batches[2].id='B02';batches[2].dependsOnBatches=['B01'];}
  const leaves=batches.flatMap(b=>b.issueIds.map(id=>({...item,id,parent:'ENT-700'})));
  const parent={...backlog.items[1],children:leaves.map(i=>i.id)};
  backlog.items=[...leaves,parent];
  plan.batches=batches;plan.issues=[...leaves.map(i=>({...issue,...i,batchId:batches.find(b=>b.issueIds.includes(i.id)).id,acceptanceTests:[{id:i.id+'/AC-01'}]})),{...parentIssue,...parent}];
  put(join(root,'work/enterprise/plan.json'),plan);put(join(root,'work/enterprise/backlog.json'),backlog);
 }
 if(evidenceBatches) {
  const plan=read(join(root,'work/enterprise/plan.json'));
  plan.batches=['B00','B01','B02'].map((id,n)=>({id,issueIds:[`ENT-${n}`],dependsOnBatches:n?[`B0${n-1}`]:[],stage:'build-foundation',reviewStage:'review-foundation'}));
  const leaves=[0,1,2].map(n=>({...item,id:`ENT-${n}`,parent:null}));
  plan.issues=leaves.map((i,n)=>({...issue,...i,batchId:`B0${n}`,suites:[{...suite,id:`suite-${n}`}]}));
  put(join(root,'work/enterprise/plan.json'),plan);put(join(root,'work/enterprise/backlog.json'),{items:leaves});
 }
 if(recovery){const p=read(join(root,'work/enterprise/plan.json'));for(const i of p.issues)for(const ac of i.acceptanceTests)Object.assign(ac,{text:i.originalAcceptance[0],suiteIds:i.suites.filter(s=>s.id!=='complete-machine-gate').map(s=>s.id),assertionName:ac.id,verification:'fixture real assertions'});put(join(root,'work/enterprise/plan.json'),p);}
 if(designHistory)fs.copyFileSync(join(source,'.takt/runtime.yaml'),join(root,'.takt/runtime.yaml'));
 const registered=await registerProject({globalConfigDirectory:global,projectDirectory:root,command:'synthetic fixture'});
 const paths=resolveStatePaths(global,registered.stateId);fs.mkdirSync(paths.runsDirectory,{recursive:true});fs.mkdirSync(paths.sessionsDirectory,{recursive:true});
 const run=resolveRunPaths(paths,'fixture-run'),now=new Date().toISOString(),runStat=fs.statSync(paths.runsDirectory);
 put(paths.stateFile,{version:1,stateId:registered.stateId,locationId:registered.locationId,canonicalDirectory:registered.canonicalDirectory,runsRootFingerprint:{dev:runStat.dev,ino:runStat.ino}});
 const task={taskId:randomUUID(),generation:0,attempt:1,status:'running',origin:'web',task:'synthetic finalization test',workflow:'enterprise-lifecycle',worktree:false,worktreePath:root,runId:run.slug,runIds:[run.slug],createdAt:now,updatedAt:now,activeExecution:{executionId:randomUUID(),runId:run.slug,ownerTokenHash:'0'.repeat(64),pid:process.pid,startTime:now,startedAt:now}};
 put(paths.tasksFile,{version:1,tasks:[task]});
 const workflowRef=compiledWorkflow?.originalWorkflowRef??('project:sha256:'+hash('synthetic-workflow'));
 const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
 const gateCommand=['env',`TAKT_CONFIG_DIR=${global}`,process.execPath,'scripts/enterprise/verify.mjs','batch'].map(quote).join(' ');
 const workflow=compiledWorkflow?.config??normalizeWorkflowConfig({name:'enterprise-lifecycle',initial_step:'harden-release',max_steps:5,steps:[
  {name:'harden-release',persona:'synthetic builder',session_key:'enterprise-release-engineer',edit:true,instruction:'fixture',rules:[]},
 {name:'final-audit',persona:'synthetic auditor',session_key:'enterprise-final-auditor',capabilities:'readonly',edit:false,instruction:'fixture',rules:[]},
 {name:'build-foundation',persona:'synthetic builder',session_key:'enterprise-builder',edit:true,instruction:'fixture',rules:[],...(recovery?{quality_gates:[{type:'command',name:'frozen-batch-gate',command:gateCommand,timeout_ms:20000}]}:{})},
 {name:'review-foundation',output_contracts:{report:[{name:'enterprise-04-review.md',format:'fixture'}]},persona:'synthetic reviewer',session_key:'enterprise-batch-reviewer',capabilities:'readonly',edit:false,instruction:'fixture',rules:[]},
 ...(designHistory?[{name:'design-architecture',output_contracts:{report:[{name:'enterprise-01-architecture.md',format:'fixture'}]},persona:'synthetic architect',session_key:'enterprise-architect',edit:true,instruction:'fixture',promotion:[{at:2}],rules:[]}]:[]),
 ...(recovery?[{name:'review-architecture',output_contracts:{report:[{name:'enterprise-02-review.md',format:'fixture'}]},persona:'synthetic designer',session_key:'enterprise-architecture-reviewer',capabilities:'readonly',edit:false,instruction:'fixture',rules:[]}]:[]),
 ]},root,{projectDir:root,lang:'ja'},undefined,undefined,undefined,undefined,undefined,{workflowCommandGatesPolicy:recovery?{customScripts:true}:undefined});
 Object.assign(workflow.steps.find(s=>s.name==='review-foundation'),reviewDefinition);
 Object.assign(workflow.steps.find(s=>s.name==='final-audit'),auditDefinition);
 const old=process.env.TAKT_CONFIG_DIR;process.env.TAKT_CONFIG_DIR=global;
 try {publishWorkflowExecutionBundle(run,compiledWorkflow?.prepared??prepareWorkflowExecutionBundle({rootWorkflow:workflow,workflowCallResolver:()=>null,projectCwd:root,lookupCwd:root,rootWorkflowRefOverride:workflowRef}));if(compiledWorkflow)Object.assign(workflow,loadWorkflowExecutionBundle(run).rootWorkflow);}
 finally {if(old===undefined)delete process.env.TAKT_CONFIG_DIR;else process.env.TAKT_CONFIG_DIR=old;}
 const sessions={};for(const [key,model,id] of [['enterprise-builder','gpt-6.1-sol','builder-session'],['enterprise-builder','gpt-6-astra','builder-session'],['enterprise-architecture-reviewer','gpt-6-astra','designer-session'],['enterprise-release-engineer','gpt-6.1-sol','release-session'],['enterprise-final-auditor','gpt-6-astra','auditor-session'],['enterprise-batch-reviewer','gpt-6-astra','reviewer-session']])sessions[JSON.stringify([key,'codex',model])]=id;
 if(designHistory)for(const model of ['gpt-6.1-sol','gpt-6-astra'])sessions[JSON.stringify(['enterprise-architect','codex',model])]='architect-session';
 savePersonaSessions(root,sessions,'codex',paths.sessionsDirectory);
 let log=join(run.logsAbs,'fixture.jsonl');put(log,'');const records=[];
 const append=r=>{records.push(r);put(log,records.map(r=>JSON.stringify(r)).join('\n')+'\n');};
 const stack=step=>[{workflow:workflow.name,workflow_ref:workflowRef,step,kind:'agent',occurrence:1}];
 function context(step,iteration=step==='final-audit'?2:1) {
  put(run.metaAbs,{runSlug:run.slug,workflow:workflow.name,status:'running',reportDirectory:run.reportsRel,currentStep:step,currentIteration:iteration});
  append({type:'step_start',timestamp:new Date().toISOString(),step,iteration,workflow:workflow.name,stack:stack(step),provider:'codex',model:(['final-audit','review-foundation','review-architecture'].includes(step)||(recovery&&step==='build-foundation'))?'gpt-6-astra':'gpt-6.1-sol',providerOptions:{codex:{reasoningEffort:(['final-audit','review-foundation','review-architecture'].includes(step)||(recovery&&step==='build-foundation'))?'high':'medium'}}});
 }
 context('harden-release');
 const guardPath=join(temporary,'guard.mjs');put(guardPath,guard);
 const env={...process.env,TAKT_CONFIG_DIR:global};delete env.NODE_TEST_CONTEXT;
 function cli(args,{readonly=true,...extra}={}) {
  return spawnSync(process.execPath,[...(readonly?['--import',guardPath]:[]),join(root,'scripts/enterprise/verify.mjs'),...args],{cwd:root,env:{...env,...extra},encoding:'utf8',timeout:20000});
 }
 // Resolve the real compiler/registry/session identity in its own process.
 // Test registries never replace the parent process's active TAKT context.
 const binding=spawnSync(process.execPath,['--input-type=module','-e',"import {currentContext} from './scripts/enterprise/context.mjs';console.log(JSON.stringify((await currentContext(process.cwd())).identity));"],{cwd:root,env,encoding:'utf8'});
 assert.equal(binding.status,0,binding.stderr);
 const initialProgress=read(join(root,'work/enterprise/progress.json'));initialProgress.runBinding=JSON.parse(binding.stdout);put(join(root,'work/enterprise/progress.json'),initialProgress);
 let reviewed,approval;
 function batchReport(overrides={},options={}) {
  const batchId=options.batchId??'B00',issueIds=read(join(root,'work/enterprise/plan.json')).batches.find(b=>b.id===batchId).issueIds;
  context('review-foundation',options.iteration??2);
  const receipt=read(join(root,'evidence/enterprise/runs/index.json')).runs.filter(r=>r.batchId===batchId).at(-1);
  reviewed=read(join(root,receipt.path));
  const att={schemaVersion:1,verdict:'APPROVE',runSlug:run.slug,workflowRef,step:'review-foundation',iteration:2,sessionKey:'enterprise-batch-reviewer',providerSessionId:'reviewer-session',batchId,runId:reviewed.id,inputsDigest:reviewed.inputs.digest,receiptHash:hash(JSON.stringify(reviewed)),receiptSha256:hash(fs.readFileSync(join(root,receipt.path))),outputsDigest:hash(JSON.stringify(reviewed.suites.map(s=>s.outputs))),approvedIssueIds:issueIds,unresolvedFindings:[],...overrides};
  const content=options.content??'```enterprise-batch-attestation\n'+JSON.stringify(att,null,2)+'\n```';
  for(const phase of [1,2]) append({type:'phase_complete',step:'review-foundation',iteration:options.iteration??2,workflow:workflow.name,stack:stack('review-foundation'),phase,status:'done',content:phase===1?(options.phase1??content):content});
  if(!options.incomplete)append({type:'step_complete',step:'review-foundation',iteration:options.iteration??2,workflow:workflow.name,stack:stack('review-foundation'),status:'done',content});
  put(join(run.reportsAbs,'enterprise-04-review.md'),content+'\n');
  const report=`evidence/enterprise/reviews/${batchId}.md`;put(join(root,report),content+'\n');
  approval={verdict:'APPROVE',session:att.providerSessionId,receiptHash:hash(JSON.stringify(reviewed)),inputsDigest:reviewed.inputs.digest,issueIds,report,reportHash:hash(fs.readFileSync(join(root,report)))};
  const progress=read(join(root,'work/enterprise/progress.json'));progress.approvals[batchId]=approval;put(join(root,'work/enterprise/progress.json'),progress);
  return {reviewed,approval,att,content};
 }
 if(multi) {context('build-foundation',1);const r=cli(['batch','--batch','B00'],{readonly:false});assert.equal(r.status,0,r.stderr);batchReport(batchOverrides,batchOptions);context('harden-release',3);}
 let sealed;
 if(seal){const result=cli(['all'],{readonly:false});assert.equal(result.status,0,result.stderr);sealed=JSON.parse(result.stdout.trim().split('\n').at(-1));}
 function attest(overrides={}) {
  const sealEntry=read(join(root,'evidence/enterprise/releases/index.json')).attempts.at(-1),s=read(join(root,sealEntry.sealPath));
  return {schemaVersion:1,verdict:'APPROVE',releaseId:sealed.releaseId,releaseDigest:sealed.releaseDigest,inputsDigest:s.inputs.digest,runSlug:run.slug,workflowRef,step:'final-audit',iteration:2,sessionKey:'enterprise-final-auditor',providerSessionId:'auditor-session',approvedLeafIds:s.issues.filter(i=>!i.children.length).map(i=>i.id),approvedParentIds:['ENT-700'],issueEvidence:s.issues.map(i=>({id:i.id,verdict:'APPROVE',acceptanceIds:i.acceptanceTests.map(a=>a.id),basis:['synthetic fixture assertion independently inspected'],...(i.children.length?{children:i.children,demonstration:'synthetic fixture demo'}:{receipts:[s.receipts.find(r=>r.batchId===i.batchId).path],outputs:[s.outputs.entries[0].path],negativeEvidence:[s.outputs.entries[0].path]})})),unresolvedFindings:[],productionLimitations:['Synthetic test only'],githubSynchronization:'PENDING_DESTINATION',...overrides};
 }
 function report(overrides={},options={}) {
  context('final-audit',options.iteration??2);const att=attest(overrides),content='```enterprise-attestation\n'+JSON.stringify(att,null,2)+'\n```';
  for(const phase of [1,2]) append({type:'phase_complete',step:'final-audit',iteration:options.iteration??2,workflow:workflow.name,stack:stack('final-audit'),phase,status:'done',content});
  if(!options.incomplete)append({type:'step_complete',step:'final-audit',iteration:options.iteration??2,workflow:workflow.name,stack:stack('final-audit'),status:'done',content});
  put(join(run.reportsAbs,'enterprise-06-final-audit.md'),content+'\n');return content;
 }
 function nextRun(slug='new-fixture-run') {
  const previous={...run};Object.assign(run,resolveRunPaths(paths,slug));
  const old=process.env.TAKT_CONFIG_DIR;process.env.TAKT_CONFIG_DIR=global;
  try{publishWorkflowExecutionBundle(run,compiledWorkflow?.prepared??prepareWorkflowExecutionBundle({rootWorkflow:workflow,workflowCallResolver:()=>null,projectCwd:root,lookupCwd:root,rootWorkflowRefOverride:workflowRef}));if(compiledWorkflow)Object.assign(workflow,loadWorkflowExecutionBundle(run).rootWorkflow);}
  finally{if(old===undefined)delete process.env.TAKT_CONFIG_DIR;else process.env.TAKT_CONFIG_DIR=old;}
  task.runId=slug;task.runIds.push(slug);task.attempt=task.runIds.length;task.activeExecution.runId=slug;put(paths.tasksFile,{version:1,tasks:[task]});
  records.length=0;log=join(run.logsAbs,'fixture.jsonl');put(log,'');context('build-foundation',1);return previous;
 }
 return {root,temporary,global,run,paths,task,workflow,workflowRef,stack,context,records,append,cli,report,attest,sessions,sealed,guardPath,env,batchReport,reviewed,approval,nextRun};
}

// Dedicated preparation fixture: synthetic evidence with real registry and sessions.
export async function preparationComponentFixture(t,{frozen=false,suiteSource,reviewDefinition={},scopeMutation,legacyHistory=false,directProcess=false,sourceEngine=false}={}){
 const file=(f,p)=>join(f.root,p),ip=f=>file(f,"evidence/enterprise/runs/index.json"),mutate=(f,p,fn)=>{const v=read(file(f,p));fn(v);put(file(f,p),v);};
 const ok=r=>{assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 const fenced=(name,v)=>"```"+name+"\n"+JSON.stringify(v,null,2)+"\n```";
 const phases=(f,step,iteration,content)=>{f.context(step,iteration);for(const phase of [1,2])f.append({type:"phase_complete",timestamp:new Date().toISOString(),step,iteration,workflow:f.workflow.name,stack:f.stack(step),phase,status:"done",content});f.append({type:"step_complete",timestamp:new Date().toISOString(),step,iteration,workflow:f.workflow.name,stack:f.stack(step),status:"done",content});const name=f.workflow.steps.find(s=>s.name===step).outputContracts?.[0]?.name??"enterprise-03-build.md";put(join(f.run.reportsAbs,name),content+"\n");};
 let compiledWorkflow;
 if(frozen){const p=read(join(source,'work/enterprise/plan.json')),d=read(join(source,'fixtures/enterprise/preparation/routing-diagnosis.json'));assert.equal(hash(fs.readFileSync(join(source,'fixtures/enterprise/preparation/routing-diagnosis.json'))),p.preparationReview.routingDiagnosis.sha256);const ref=d.references.find(r=>r.path.includes('/workflow-bundle/objects/'));const bundle=join(source,'fixtures/enterprise/preparation/20261024121802-56fec935/workflow-bundle');const raw=fs.readFileSync(join(bundle,'objects',basename(ref.path)));assert.equal(hash(raw),ref.sha256);const object=JSON.parse(raw);const loaded=loadWorkflowExecutionBundle({slug:basename(dirname(bundle)),workflowBundleAbs:bundle,workflowBundleObjectsAbs:join(bundle,'objects'),workflowBundleResourcesAbs:join(bundle,'resources'),workflowBundleManifestAbs:join(bundle,'manifest.json'),workflowBundleManifestHashAbs:join(bundle,'manifest.sha256')});compiledWorkflow={...object,config:loaded.rootWorkflow,prepared:loaded.prepared};}
 const f=await fixture(t,{seal:false,recovery:true,compiledWorkflow,reviewDefinition});
 fs.copyFileSync(new URL('../../scripts/enterprise/runtime-preparation.mjs',import.meta.url),file(f,'scripts/enterprise/runtime-preparation.mjs'));
 const query=code=>ok(spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:f.root,env:f.env,encoding:'utf8'}));
 const sourceExecutor=sourceEngine?await sourceEngineFixture(f,sourceEngine):null;
 f.context('build-foundation',1);
 const sourceContext=query("import {currentContext} from './scripts/enterprise/context.mjs';console.log(JSON.stringify(await currentContext(process.cwd())));");
 const ref=path=>({path,sha256:hash(fs.readFileSync(file(f,path)))});
 put(file(f,'evidence/source-handoff.json'),{run:f.run.slug,iteration:sourceEngine?(sourceEngine.designHistory?4:2):1,builderSession:'builder-session',references:[]});
 const handoff=ref('evidence/source-handoff.json'),content=handoff.path+' '+handoff.sha256+(sourceEngine?.references?'\n```enterprise-source-observation\n'+JSON.stringify({references:sourceEngine.references})+'\n```':'');
 if(!sourceExecutor){ for(const phase of [1,2])f.append({type:'phase_complete',step:'build-foundation',iteration:1,workflow:f.workflow.name,stack:f.stack('build-foundation'),phase,phaseExecutionId:'source:'+phase,status:'done',content});
 f.append({type:'step_complete',step:'build-foundation',iteration:1,workflow:f.workflow.name,stack:f.stack('build-foundation'),status:'done'});
 const endTime=new Date().toISOString();
 f.append({type:'workflow_abort',iterations:1,reason:'Max steps reached',endTime});
 const sm={...read(f.run.metaAbs),status:'failed',reason:'Max steps reached',endTime,iterations:1};put(f.run.metaAbs,sm);
 }else await sourceExecutor(sourceContext.identity,content);
 const sm=read(f.run.metaAbs);
 put(file(f,'evidence/source-meta.json'),sm);put(file(f,'evidence/source-log.jsonl'),fs.readFileSync(sourceContext.identity.logPath,'utf8'));
 put(file(f,'evidence/selection.json'),{batchId:'B00',inputsDigest:'historical-only',planText:fs.readFileSync(file(f,'work/enterprise/plan.json'),'utf8')});
 mutate(f,'work/enterprise/progress.json',p=>Object.assign(p,{runBinding:sourceContext.identity,entrySelection:'evidence/selection.json',entrySelectionHash:ref('evidence/selection.json').sha256,entryInputs:'historical-only'}));
 put(ip(f),{runs:[]});
 const checkpoint={progress:ref('work/enterprise/progress.json'),index:ref('evidence/enterprise/runs/index.json'),selection:ref('evidence/selection.json')};
 f.oldRun=f.nextRun('preparation-run');f.sourceIdentity=sourceContext.identity;
 for(const p of ['PREPARATION_ENTRY','RUNTIME_DELIVERY','RUNTIME_CONTINUATION'])put(file(f,'work/enterprise/'+p+'.md'),'synthetic '+p);
 put(file(f,'evidence/entry.json'),{schemaVersion:1,runSlug:f.run.slug});
 if(suiteSource)put(file(f,'tests/assertion.test.mjs'),suiteSource);
 const runtime=sourceContext.identity.runtime;
 const entry={schemaVersion:1,contract:'work/enterprise/PREPARATION_ENTRY.md',runSlug:f.run.slug,sourceRunSlug:f.oldRun.slug,purpose:'PREPARE_SUCCESSOR_HISTORY_COMPONENTS',permission:'PREPARATION_AND_HISTORY_ONLY',attestation:'enterprise-continuation-preparation-attestation',runtimeVersion:runtime.version,isAuthorizedMigrationTarget:false,currentApprovals:[],initializationAuthority:false,targetLaunchAuthority:false,runtimeReplacementAuthority:false,sourceCheckpoint:checkpoint,latestHandoff:handoff,sourceMetaSnapshot:'evidence/source-meta.json',permittedPaths:['scripts/enterprise/runtime-preparation.mjs','tests/enterprise/rejected-regeneration.test.mjs'],increments:['P0','P1','P2','P3','R1b','R2','R3','R4']};
 const base='evidence/enterprise/preparation/'+f.run.slug;
 const command=directProcess?[process.execPath,'tests/assertion.test.mjs']:[process.execPath,'--test','--test-reporter=tap','tests/assertion.test.mjs'];
 // Existing control-profile regressions retain the exact approved historical definition.
 const scope=structuredClone(read(join(source,'fixtures/enterprise/preparation/control-scope.json')));
 scope.fullObligations=['real arithmetic assertion','synthetic retained history'];scope.requiredAssertions=['real arithmetic assertion'];scope.requiredControlAssertions=[];scope.caseIds=[];scope.failureHistoryCaseIds=[];scope.acceptanceCases=[];scope.reviewedCaseIds=['real arithmetic assertion'];scope.retainedObligations=[{assertion:'synthetic retained history',owner:'R1',dependsOn:[],reason:'Synthetic unaccepted history obligation for isolated scope boundary verification.',requiredAt:['R1','R4','B00_FULL_PRODUCT_GATE'],disposition:'REQUIRED_NOT_ACCEPTED',sourceSuite:'rejected-regeneration-regressions'}];delete scope.failedAttempt;delete scope.previousValidation;delete scope.historicalHandoff;
 put(file(f,scope.contract),'synthetic acceptance contract');

 put(file(f,'evidence/empty-journal.json'),{schemaVersion:1,events:[]});
 put(file(f,'evidence/empty-checkpoint.json'),{schemaVersion:1,kind:'PREPARATION_LEGACY_PREFIX_ASSESSMENT',runSlug:f.run.slug,attempts:[],journal:{...ref('evidence/empty-journal.json'),bytes:fs.statSync(file(f,'evidence/empty-journal.json')).size},inventory:[]});
 const failureHistory={schemaVersion:1,eventFormatVersion:2,checkpointMeaning:'CURRENT_ASSESSMENT_NOT_CONTEMPORANEOUS_MANIFEST',checkpoint:ref('evidence/empty-checkpoint.json'),legacyAttempts:[],nextAttemptMinimum:1,caseIds:[]};
 mutate(f,'work/enterprise/plan.json',p=>{p.preparationEntry={...entry,sealPublication:{fullRegressionCommand:command},subcaseAssertions:[]};p.issues[0].suites[0].requiredAssertions.push('synthetic retained history');p.failedIntervalRecovery??={};p.failedIntervalRecovery.runtimeContinuation={delivery:{workPackages:[{id:'R1',dependsOn:[],requiredAssertions:['synthetic retained history']},{id:'R2',dependsOn:['R1'],requiredAssertions:[]},{id:'R3',dependsOn:['R1','R2'],requiredAssertions:[]}]}};p.preparationReview={schemaVersion:2,enabledRunSlug:f.run.slug,namespace:base+'/',increment:'P0',productVerified:false,gateRunsSuites:false,gateWrites:[],caseIds:['real arithmetic assertion'],fullRegressionCommand:command,acceptanceScope:scope,failureHistory};if(legacyHistory)p.preparationReview.acceptanceScope.requiredControlAssertions=['synthetic retained history'];if(scopeMutation)scopeMutation(p.preparationReview.acceptanceScope,p);p.sourceSnapshots.push(ref(scope.contract));});
 f.reviewManifest=base+'/reviewed-inputs.json';
 const m=query("import {inputs} from './scripts/enterprise/evidence.mjs';console.log(JSON.stringify(inputs(process.cwd())));");put(file(f,f.reviewManifest),m);
 const c=query("import {currentContext} from './scripts/enterprise/context.mjs';console.log(JSON.stringify(await currentContext(process.cwd())));");
 f.successorAttestation={schemaVersion:1,verdict:'APPROVE',purpose:entry.purpose,permission:entry.permission,runSlug:f.run.slug,workflowRef:c.identity.workflowRef,bundleDigest:c.identity.bundleDigest,step:'review-architecture',iteration:2,sessionKey:'enterprise-architecture-reviewer',providerSessionId:'designer-session',runtimeVersion:runtime.version,contractPath:entry.contract,contractSha256:ref(entry.contract).sha256,runtimeDeliveryContract:ref('work/enterprise/RUNTIME_DELIVERY.md'),runtimeContinuationContract:ref('work/enterprise/RUNTIME_CONTINUATION.md'),planSha256:ref('work/enterprise/plan.json').sha256,inputsDigest:m.digest,entryManifest:ref('evidence/entry.json'),sourceRunSlug:f.oldRun.slug,sourceCheckpoint:checkpoint,latestSourceHandoff:handoff,sourceMetaSnapshot:ref('evidence/source-meta.json'),sourceLogSnapshot:ref('evidence/source-log.jsonl'),permittedIncrements:['P0','P1','P2','P3','R1b'],permittedPaths:entry.permittedPaths,currentApprovals:[],initializationAuthority:false,targetLaunchAuthority:false,runtimeReplacementAuthority:false,unresolvedFindings:[]};
 phases(f,'review-architecture',2,fenced('enterprise-continuation-preparation-attestation',f.successorAttestation));
 f.context('build-foundation',3);
 if(frozen){
  const bin=join(f.temporary,'environment-bin'),realMise=spawnSync('/bin/sh',['-c','command -v mise'],{encoding:'utf8'}).stdout.trim();assert.ok(realMise);
  const quote=v=>"'"+v.replaceAll("'","'\\''")+"'";
  // The real command runner intentionally strips TAKT_CONFIG_DIR. This isolated
  // environment launcher forwards the unchanged argv to the real mise binary;
  // it never fabricates exit codes, engine transitions or product context.
  put(join(bin,'mise'),'#!/bin/sh\nexport TAKT_CONFIG_DIR='+quote(f.global)+'\nexec '+quote(realMise)+' "$@"\n');fs.chmodSync(join(bin,'mise'),0o700);
  f.preparationRunGate=async(fn)=>{const prior=process.env.PATH;process.env.PATH=bin+':'+prior;try{return await fn();}finally{process.env.PATH=prior;}};
 }
 f.preparationBase=base;f.preparationPhases=(step,iteration,obj,tag)=>phases(f,step,iteration,fenced(tag,obj));
 f.preparationCLI=(args,{readonly=false,preloads=[]}={})=>spawnSync(process.execPath,[...(readonly?['--import',f.guardPath]:[]),...preloads.flatMap(p=>['--import',p]),file(f,'scripts/enterprise/runtime-preparation.mjs'),...args],{cwd:f.root,env:f.env,encoding:'utf8',timeout:30000});
 if(legacyHistory){
  const failed=f.preparationCLI(['--capture-component','P0']);assert.equal(failed.status,1,failed.stdout);assert.match(failed.stderr,/missing assertion: synthetic retained history/);
  f.records.splice(f.records.findLastIndex(r=>r.type==='step_start'),1);
  phases(f,'build-foundation',3,'Synthetic historical failed capture, preserved original outputs.');
  const jp=base+'/journal.json',jr=fs.readFileSync(file(f,jp),'utf8');put(file(f,'evidence/legacy-journal.json'),jr);
  const inventory=query("import {snapshot} from './scripts/enterprise/evidence.mjs';console.log(JSON.stringify(snapshot(process.cwd(),['"+base+"/attempts/1']).entries));");
  put(file(f,'evidence/legacy-handoff.json'),{references:inventory});
  put(file(f,'evidence/legacy-checkpoint.json'),{schemaVersion:1,kind:'PREPARATION_LEGACY_PREFIX_ASSESSMENT',runSlug:f.run.slug,attempts:[1],journal:{...ref('evidence/legacy-journal.json'),bytes:Buffer.byteLength(jr)},inventory});
  put(file(f,base+'/history/'+hash(jr)+'.journal.json'),jr);
  mutate(f,'work/enterprise/plan.json',p=>{p.preparationReview.acceptanceScope.requiredControlAssertions=[];p.preparationReview.failureHistory={...failureHistory,checkpoint:ref('evidence/legacy-checkpoint.json'),legacyAttempts:[1],nextAttemptMinimum:2};});
  const manifest=query("import {inputs} from './scripts/enterprise/evidence.mjs';console.log(JSON.stringify(inputs(process.cwd())));");put(file(f,f.reviewManifest),manifest);
  f.successorAttestation={...f.successorAttestation,iteration:5,planSha256:ref('work/enterprise/plan.json').sha256,inputsDigest:manifest.digest};
  phases(f,'review-architecture',5,fenced('enterprise-continuation-preparation-attestation',f.successorAttestation));f.context('build-foundation',6);
 }
 return f;
}

const sourceProducerProgram="// Isolated execution probe. Only provider replies are synthetic; engine,\n// compiler, phase/report execution and record factories are the installed TAKT.\nimport {mock} from 'node:test';\nimport assert from 'node:assert/strict';\nimport * as fs from 'node:fs';\nimport {resolve,join} from 'node:path';\nimport {generateKeyPairSync,sign,createHash} from 'node:crypto';\nimport {pathToFileURL} from 'node:url';\nconst spec=JSON.parse(fs.readFileSync(process.argv[2]));\nconst repository=spec.repository;\nconst modulePath=p=>pathToFileURL(join(repository,'node_modules/takt/dist',p)).href;\nconst hash=b=>createHash('sha256').update(b).digest('hex');\nconst keys=generateKeyPairSync('ed25519'),executions=[],events=[],calls=[];\nlet active,reply;\nconst answer=async(persona,task,options)=>{\n options.onPromptResolved?.({systemPrompt:'synthetic provider',userInstruction:task});\n assert.ok(active,'provider call must belong to an active engine occurrence');\n reply={persona:persona??active.step.name,status:'done',content:spec.contents?.[active.step.name]??spec.content,sessionId:spec.sameSession?'synthetic-shared':(options.sessionId??('synthetic-'+active.step.name)),timestamp:new Date()};\n calls.push({iteration:active.iteration,step:active.step.name,sessionId:reply.sessionId,contentSha256:hash(reply.content)});\n return reply;\n};\nmock.module(modulePath('agents/runner.js'),{namedExports:{runAgent:answer,AgentRunner:class {run(...a){return answer(...a)}runCustom(...a){return answer(...a)}}}});\nconst {WorkflowEngine}=await import(modulePath('core/workflow/engine/WorkflowEngine.js'));\nconst {loadWorkflowExecutionBundle}=await import(modulePath('features/tasks/execute/workflowExecutionBundle.js'));\nconst {savePersonaSessions}=await import(modulePath('infra/config/project/sessionStore.js'));\nconst savedSessions={};\nconst factory=await import(modulePath('features/tasks/execute/sessionLoggerRecordFactory.js'));\nconst config=loadWorkflowExecutionBundle(spec.run).rootWorkflow;\nconst identity=spec.identity;\nconst producerRaw=fs.readFileSync(import.meta.filename),producerSha256=hash(producerRaw);\nfunction recordSourceExecution(phase,phaseExecutionId,content,status){\n assert.ok(reply&&phase<3);assert.equal(reply.content,content);assert.equal(reply.status,status);\n const payload={runSlug:identity.runSlug,workflowRef:identity.workflowRef,bundleDigest:identity.bundleDigest,iteration:active.iteration,step:active.step.name,phase,phaseExecutionId,provider:active.providerInfo.provider,model:active.providerInfo.model,providerSessionId:reply.sessionId,status,contentSha256:hash(content),producerSha256};\n executions.push({payload,signature:sign(null,Buffer.from(JSON.stringify(payload)),keys.privateKey).toString('base64')});\n}\nconst engine=new WorkflowEngine(config,spec.root,'synthetic source execution',{projectCwd:spec.root,provider:'codex',model:'gpt-6-astra',providerOptions:{codex:{reasoningEffort:'high'}},startStep:spec.startStep??'build-foundation',maxStepsOverride:spec.maxSteps??1,reportDirName:spec.run.slug,runPathsDirectory:spec.runsDirectory,skipWorktreeRuntimeProtection:true,workflowBundleResourceRoot:spec.run.workflowBundleResourcesAbs,workflowRef:identity.workflowRef,structuredCaller:{judgeStatus:async(instruction,tag,candidates,options)=>{options.onStructuredPromptResolved?.({systemPrompt:'synthetic judgment',userInstruction:instruction});return {candidateIndex:0,method:'structured_output'};},evaluateCondition:async()=>0},onSessionUpdate:(key,id)=>{savedSessions[key]=id;savePersonaSessions(spec.root,savedSessions,'codex',spec.sessionsDirectory);fs.writeFileSync(spec.sessionOutput,JSON.stringify({key,id}));}});\nengine.on('step:start',(step,iteration,instruction,providerInfo,workflowName,resumeStepName,stepIteration,stack)=>{active={step,iteration,providerInfo,stack};events.push(factory.buildStepStartRecord(step,iteration,instruction,stack,x=>x,providerInfo));});\nengine.on('phase:start',(s,p,n,i,parts,id,it,stack)=>events.push(factory.buildPhaseStartRecord(s,p,n,i,parts,stack,id,it,x=>x)));\nengine.on('phase:complete',(s,p,n,c,status,error,id,it,stack)=>{events.push(factory.buildPhaseCompleteRecord(s,p,n,c,status,error,stack,id,it,new Date().toISOString(),x=>x));if(p<3)recordSourceExecution(p,id,c,status);});\nengine.on('step:complete',(s,r,i,name,stack)=>events.push(factory.buildStepCompleteRecord(s,r,i,active.iteration,stack,x=>x)));\nengine.on('workflow:abort',(state,reason)=>events.push(factory.buildWorkflowAbortRecord(state,reason,x=>x)));\nconst result=await engine.run();\nfs.writeFileSync(spec.output,JSON.stringify({schemaVersion:1,realEngine:true,syntheticProviderReplies:true,result,events,calls,sessionProvenance:{schemaVersion:1,kind:'TAKT_BOUND_PROVIDER_EXECUTION_V1',publicKey:keys.publicKey.export({type:'spki',format:'pem'}),producer:{path:spec.producerPath,sha256:producerSha256,bytes:producerRaw.length,entryPoint:'recordSourceExecution'}},executions},null,2)+'\\n');\n";

// Generated source records come from a fresh native engine. Only its provider
// responses are synthetic; no public production reader receives a test adapter.
async function sourceEngineFixture(f,options={}){
 let config=normalizeWorkflowConfig({name:'enterprise-lifecycle',initial_step:'build-foundation',max_steps:2,steps:[{name:'build-foundation',persona:'synthetic source builder',session_key:'enterprise-builder',edit:true,instruction:'Return the supplied source observation.',output_contracts:{report:[{name:'source.md',format:'Return the supplied body exactly.'}]},rules:[{condition:'observation finished',next:'review-foundation'},{condition:'observation failed',next:'review-foundation'}]},{name:'review-foundation',persona:'synthetic independent source reviewer',session_key:'enterprise-batch-reviewer',capabilities:'readonly',edit:false,instruction:'Return the supplied source observation.',output_contracts:{report:[{name:'source-review.md',format:'Return the supplied body exactly.'}]},rules:[{condition:'observation inspected',next:'build-foundation'},{condition:'observation rejected',next:'build-foundation'}]}]},f.root,{projectDir:f.root,lang:'en'});
 if(options.designHistory){const build=config.steps[0],review=config.steps[1];config={...config,initialStep:'design-architecture',steps:[{...build,name:'design-architecture',sessionKey:'enterprise-architect',outputContracts:[{...build.outputContracts[0],name:'source-design.md'}],rules:build.rules.map(r=>({...r,next:'review-architecture'}))},{...review,name:'review-architecture',sessionKey:'enterprise-architecture-reviewer',outputContracts:[{...review.outputContracts[0],name:'source-order.md'}],rules:review.rules.map(r=>({...r,next:'build-foundation'}))},...config.steps]};}
 const prepared=prepareWorkflowExecutionBundle({rootWorkflow:config,workflowCallResolver:()=>null,projectCwd:f.root,lookupCwd:f.root,rootWorkflowRefOverride:f.workflowRef});
 // Only this isolated, not-yet-executed fixture bundle is replaced.
 fs.rmSync(f.run.workflowBundleAbs,{recursive:true});publishWorkflowExecutionBundle(f.run,prepared);
 const path='tests/source-producer.mjs';put(join(f.root,path),sourceProducerProgram);
 return async(identity,content)=>{
  const output=join(f.temporary,'source-engine.json'),spec={repository:source,maxSteps:options.designHistory?4:2,startStep:options.designHistory?'design-architecture':'build-foundation',sameSession:options.sameSession===true,root:f.root,run:f.run,runsDirectory:f.paths.runsDirectory,sessionsDirectory:f.paths.sessionsDirectory,identity,content,producerPath:path,sessionOutput:join(f.temporary,'source-session-update.json'),output};
  const specPath=join(f.temporary,'source-engine-spec.json');
  if(options.designHistory){const planPath='evidence/source-original-plan.json',contractPath='work/enterprise/REJECTED_REGENERATION.md';put(join(f.root,planPath),fs.readFileSync(join(f.root,'work/enterprise/plan.json'),'utf8'));put(join(f.root,contractPath),'synthetic original source contract');const ref=p=>({path:p,sha256:hash(fs.readFileSync(join(f.root,p)))});const order={schemaVersion:1,runSlug:f.run.slug,workflowRef:identity.workflowRef,iteration:2,step:'review-architecture',sessionKey:'enterprise-architecture-reviewer',verdict:'APPROVE',permission:'EVIDENCE_REGENERATION_ONLY',unresolvedFindings:[],planSha256:ref(planPath).sha256,contractPath,contractSha256:ref(contractPath).sha256,originalPlan:ref(planPath)};options.orderMutation?.(order,f);spec.contents={'review-architecture':'```enterprise-recovery-design-attestation\n'+JSON.stringify(order)+'\n```'};}put(specPath,spec);
  const child=spawnSync(process.execPath,['--experimental-test-module-mocks',join(f.root,path),specPath],{cwd:f.root,env:f.env,encoding:'utf8',timeout:30000});assert.equal(child.status,0,child.stderr);
  const result=read(output);assert.equal(result.result.iteration,spec.maxSteps);assert.equal(result.result.status,'aborted');assert.ok(result.events.some(x=>x.type==='step_complete'&&x.status==='done'));assert.equal(result.events.at(-1).reason,'Max steps reached');assert.deepEqual(result.events.filter(x=>x.type==='phase_complete').map(x=>x.phase),Array.from({length:spec.maxSteps},()=>[1,2,3]).flat());
  options.mutate?.(result,f);
  const executionPath='sessions/source-executions.json';put(join(dirname(f.run.metaAbs),executionPath),{schemaVersion:1,records:result.executions});
  const raw=fs.readFileSync(join(dirname(f.run.metaAbs),executionPath));result.sessionProvenance.records={path:executionPath,sha256:hash(raw),bytes:raw.length};
  f.records.splice(0,f.records.length);f.append({type:'workflow_start',workflowName:f.workflow.name});for(const r of result.events)f.append(r);
  const terminal=result.events.at(-1);put(f.run.metaAbs,{...read(f.run.metaAbs),status:'failed',reason:terminal.reason,endTime:terminal.endTime,iterations:spec.maxSteps,currentIteration:spec.maxSteps,currentStep:'review-foundation',sessionProvenance:result.sessionProvenance});
  if(options.missingProducer){const m=read(f.run.metaAbs);delete m.sessionProvenance;put(f.run.metaAbs,m);}
  f.sourceEngineResult=result;
  savePersonaSessions(f.root,f.sessions,'codex',f.paths.sessionsDirectory);
 };
}

export async function sourceProvenanceFixture(t,{frozen=false,sourceOptions=true}={}){
 const f=await preparationComponentFixture(t,{frozen,sourceEngine:sourceOptions}),base=f.preparationBase,file=p=>join(f.root,p),ref=p=>{const b=fs.readFileSync(file(p));return {path:p,sha256:hash(b),bytes:b.length};},ok=r=>{assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 const c=ok(f.preparationCLI(['--capture-component','P0'])),receipt=read(file(c.receipt.path));
 f.records.splice(f.records.findLastIndex(r=>r.type==='step_start'),1);f.preparationPhases('build-foundation',3,c,'enterprise-preparation-candidate');
 const decision={schemaVersion:4,historyBinding:c.historyBinding,historyHead:c.historyHead,acceptanceScope:c.acceptanceScope,purpose:'PREPARATION_COMPONENT_REVIEW',permission:'IMPLEMENTATION_CONTRACT_TESTS_ONLY',verdict:'APPROVE',runSlug:f.run.slug,workflowRef:c.workflowRef,bundleDigest:c.bundleDigest,step:'review-foundation',iteration:4,sessionKey:'enterprise-batch-reviewer',providerSessionId:'reviewer-session',increment:'P0',builderIteration:3,builderSessionId:c.providerSessionId,request:c.request,receipt:c.receipt,inputsDigest:c.inputsDigest,outputsDigest:receipt.outputs.digest,planSha256:receipt.planSha256,designReportSha256:c.designReportSha256,reviewedCaseIds:receipt.definitions.scope.reviewedCaseIds,acceptedComponents:['P0-control'],approvedIssueIds:[],currentApprovals:[],actualHistoryCompleteness:'UNPROVEN',migrationAuthorization:'NONE',productVerified:false,initializationAuthority:false,targetLaunchAuthority:false,runtimeReplacementAuthority:false,unresolvedFindings:[],residualBlockers:receipt.definitions.scope.retainedObligations.map(x=>x.owner+': '+x.assertion+' REQUIRED_NOT_ACCEPTED; source history and migration unproven; no product approval')};
 f.preparationPhases('review-foundation',4,decision,'enterprise-batch-attestation');f.context('build-foundation',5);
 const report=join(f.run.reportsAbs,f.workflow.steps.find(s=>s.name==='review-foundation').outputContracts[0].name),accepted=ok(f.preparationCLI(['--import-component-review',report]));
 const ledger=read(file(base+'/acceptances.json')),stored=ledger.acceptances[0];
 const paths=[base+'/acceptances.json',stored.report,base+'/request.json',base+'/journal.json',c.receipt.path,base+'/attempts/1/scope.json'];
 const references=paths.map((originalPath,i)=>{const copy='evidence/source-predecessor/'+i+'.raw';put(file(copy),fs.readFileSync(file(originalPath),'utf8'));return {...ref(copy),originalPath};});
 const hp='evidence/source-import-handoff.json';put(file(hp),{references:paths.map(ref)});
 f.records.splice(f.records.findLastIndex(r=>r.type==='step_start'),1);f.preparationPhases('build-foundation',5,{handoff:ref(hp)},'synthetic-import-observation');
 const anchor='evidence/source-predecessor/anchor.json';put(file(anchor),{schemaVersion:1,kind:'PREPARATION_ACCEPTED_COMPONENT_ANCHOR',runSlug:f.run.slug,currentAuthority:false,productVerified:false,acceptedComponents:['P0-control'],attempt:1,historyHead:c.historyHead,reportSha256:stored.reportSha256,reviewIteration:4,importIteration:5,handoff:ref(hp),references});
 const p=read(file('work/enterprise/plan.json')),d=structuredClone(read(join(source,'work/enterprise/plan.json')).preparationReview.acceptanceScope.sourceProvenanceDefinition),scope=p.preparationReview.acceptanceScope;
 Object.assign(d,{profileId:'P0-source-provenance-v1',sourceRunSlug:f.oldRun.slug,sourceCheckpoint:p.preparationEntry.sourceCheckpoint,sourceMeta:ref('evidence/source-meta.json'),sourceLog:ref('evidence/source-log.jsonl'),predecessor:ref(anchor),nextAttemptMinimum:2,caseIds:[],acceptanceCases:[],fullRegressionCommand:p.preparationReview.fullRegressionCommand});
 Object.assign(scope,{profileId:'P0-source-provenance-v1',componentId:'P0-source-provenance',acceptedComponents:['P0-control','P0-source-provenance'],sourceProvenanceDefinition:d,sourceProvenanceCaseIds:[]});
 put(file('work/enterprise/plan.json'),p);
 const q=spawnSync(process.execPath,['--input-type=module','-e',"import {inputs} from './scripts/enterprise/evidence.mjs';console.log(JSON.stringify(inputs(process.cwd())));"],{cwd:f.root,env:f.env,encoding:'utf8'}),manifest=ok(q);
 f.reviewManifest=base+'/reviewed-inputs.'+manifest.digest+'.json';put(file(f.reviewManifest),manifest);
 f.successorAttestation={...f.successorAttestation,iteration:6,planSha256:ref('work/enterprise/plan.json').sha256,inputsDigest:manifest.digest};
 f.preparationPhases('review-architecture',6,f.successorAttestation,'enterprise-continuation-preparation-attestation');f.context('build-foundation',7);
 f.predecessorCandidate=c;f.predecessorAcceptance=accepted;
 const output=process.env.ENTERPRISE_SUITE_OUTPUT;
 if(output){const directory=join(output,'source-fixtures',randomUUID());let sequence=0;put(join(directory,'native-execution.json'),f.sourceEngineResult);put(join(directory,'synthetic-context.json'),{syntheticProviderReplies:true,syntheticPreparationReview:true,realNativeSourceEngine:true,sourceIdentity:f.sourceIdentity,predecessorCandidate:c,predecessorAcceptance:accepted,plan:p});for(const [name,path] of [['producer.mjs',join(f.root,'tests/source-producer.mjs')],['source-meta.json',f.oldRun.metaAbs],['source-log.jsonl',f.sourceIdentity.logPath]])put(join(directory,name),fs.readFileSync(path,'utf8'));
  for(const key of ['preparationCLI','cli']){const run=f[key];f[key]=(...args)=>{const startedAt=new Date().toISOString(),r=run(...args);put(join(directory,String(++sequence).padStart(3,'0')+'-'+key+'.json'),{args,startedAt,finishedAt:new Date().toISOString(),status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});return r;};}
 }
 return f;
}

// Produces an actual incomplete capture. Only design/report replies are
// synthetic. The shutdown inspection error is deliberately injected; no
// fabricated terminal or proof of stopped descendants is created.
// Real native family for handle/census tests. IPC identities are assertions for
// the test only; the recovery port obtains its own native observations.
export async function recoveryNativeProcessTree(path){
 const program=`const fs=require('node:fs'),{spawn}=require('node:child_process');const level=Number(process.argv[2]),fd=fs.openSync(process.argv[1],'r');let child;const own={pid:process.pid,ppid:process.ppid,level};
 const close=()=>{fs.closeSync(fd);process.disconnect();};
 if(level<2){child=spawn(process.execPath,['-e',process.env.RECOVERY_TREE_PROGRAM,process.argv[1],String(level+1)],{env:process.env,detached:level===1,stdio:['ignore','ignore','inherit','ipc']});child.on('message',rows=>process.send([own,...rows]));child.once('exit',close);}else process.send([own]);
 process.on('message',m=>{if(m==='stop'){if(child)child.send('stop');else close();}});`;
 const child=spawn(process.execPath,['-e',program,path,'0'],{env:{...process.env,RECOVERY_TREE_PROGRAM:program},detached:true,stdio:['ignore','ignore','pipe','ipc']});
 let stderr='';child.stderr.on('data',b=>{stderr+=b});
 const ended=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 const stop=async()=>{if(child.connected)child.send('stop');const result=await ended;assert.deepEqual(result,{code:0,signal:null},stderr);};
 try{
  const identities=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('native family startup timeout: '+stderr)),10000);child.once('message',rows=>{clearTimeout(timer);resolve(rows)});child.once('error',e=>{clearTimeout(timer);reject(e)});child.once('exit',()=>{clearTimeout(timer);reject(Error('native family exited: '+stderr))});});
  assert.equal(identities.length,3);return {identities,stop};
 }catch(error){if(child.connected)child.send('stop');await ended;throw error;}
}
export async function captureRecoveryPreflightFixture(t,{priorFailed=false,suiteSource}={}){
 assert.ok(!(priorFailed&&suiteSource),'custom capture and prior failure are separate fixtures');
 const f=await preparationComponentFixture(t,priorFailed?{suiteSource:"import test from 'node:test';import assert from 'node:assert/strict';test('real arithmetic assertion',()=>assert.equal(1,2));"}:{suiteSource}),file=p=>join(f.root,p),base=f.preparationBase;
 const ref=p=>{const b=fs.readFileSync(file(p));return {path:p,sha256:hash(b),bytes:b.length};};
 if(priorFailed){
  const first=f.preparationCLI(['--capture-component','P0']);assert.equal(first.status,1,first.stdout);
  assert.equal(read(file(base+'/journal.json')).events.at(-1).status,'FAILED',first.stderr);
 }
 const hook=join(f.temporary,'recovery-EPERM.mjs');put(hook,`const kill=process.kill;process.kill=function(pid,sig){if(pid<0&&sig===0){const e=Error('isolated shutdown inspection EPERM');e.code='EPERM';throw e}return kill.apply(this,arguments)};`);
 const captured=f.preparationCLI(['--capture-component','P0'],{preloads:[hook]});assert.equal(captured.status,1);assert.match(captured.stderr,/EPERM/);
 const attempt=priorFailed?2:1,dir=base+'/attempts/'+attempt,anchorPath='evidence/recovery-anchor.json';
 const oldReport=join(f.run.reportsAbs,f.workflow.steps.find(s=>s.name==='review-architecture').outputContracts[0].name);
 f.records.splice(f.records.findLastIndex(r=>r.type==='step_start'),1);
 f.preparationPhases('build-foundation',3,{kind:'INCOMPLETE_CAPTURE',historicalOutcome:'UNKNOWN'},'enterprise-incomplete-capture');
 const references=[];
 for(const [i,originalPath] of [base+'/journal.json',base+'/writer.lock',dir+'/start.json',dir+'/scope.json',oldReport].entries()){
  const path='evidence/recovery-originals/'+i+'.json';fs.mkdirSync(dirname(file(path)),{recursive:true});fs.copyFileSync(isAbsolute(originalPath)?originalPath:file(originalPath),file(path));references.push({originalPath,...ref(path)});
 }
 const snap=spawnSync(process.execPath,['--input-type=module','-e',`import {snapshot} from './scripts/enterprise/evidence.mjs';console.log(JSON.stringify(snapshot(process.cwd(),${JSON.stringify([dir,base+'/journal.json',base+'/writer.lock'])}).entries));`],{cwd:f.root,env:f.env,encoding:'utf8'});assert.equal(snap.status,0,snap.stderr);
 put(file('evidence/recovery-inventory.json'),{kind:'PRESENT_INCOMPLETE_CAPTURE_OBSERVATION',observedAt:new Date().toISOString(),notFailureManifest:true,doesNotProveProducerShutdown:true,references:JSON.parse(snap.stdout)});
 put(file('evidence/recovery-handoff.json'),{historicalOutcome:'UNKNOWN',references:JSON.parse(snap.stdout)});
 const anchor={schemaVersion:1,kind:'INCOMPLETE_CAPTURE_RECOVERY_ANCHOR',observedAt:new Date().toISOString(),iteration:4,runSlug:f.run.slug,attempt,originalStatus:'RUNNING',currentAuthority:false,quiescenceProven:false,historicalOutcome:'UNKNOWN',productVerified:false,references,partialInventory:ref('evidence/recovery-inventory.json'),historicalHandoff:ref('evidence/recovery-handoff.json'),absentAtObservation:['execution.json','inputs-after.json','diagnostic.txt','failure.json','receipt.json']};put(file(anchorPath),anchor);
 const real=legacyRecoveryDefinition;
 const plan=read(file('work/enterprise/plan.json'));plan.preparationReview.acceptanceScope.profileId='P0-source-provenance-v2';plan.preparationReview.acceptanceScope.captureRecoveryDefinition={...real,anchor:ref(anchorPath),nextAttemptMinimum:attempt+1};
 put(file(real.contract),legacyRecoveryContract);plan.sourceSnapshots.push({path:real.contract,sha256:ref(real.contract).sha256});put(file('work/enterprise/plan.json'),plan);
 f.recoveryRefresh=()=>{
  const plan=read(file('work/enterprise/plan.json'));plan.preparationReview.acceptanceScope.captureRecoveryDefinition.anchor=ref(anchorPath);put(file('work/enterprise/plan.json'),plan);
  const r=spawnSync(process.execPath,['--input-type=module','-e',"import {inputs} from './scripts/enterprise/evidence.mjs';console.log(JSON.stringify(inputs(process.cwd())));"],{cwd:f.root,env:f.env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);const manifest=JSON.parse(r.stdout);
  f.reviewManifest=base+'/reviewed-inputs.'+manifest.digest+'.json';put(file(f.reviewManifest),manifest);
  const a={...f.successorAttestation,iteration:5,planSha256:ref('work/enterprise/plan.json').sha256,inputsDigest:manifest.digest};
  const idx=f.records.findIndex(r=>r.type==='step_start'&&r.iteration===5);if(idx>=0)f.records.splice(idx);
  f.preparationPhases('review-architecture',5,a,'enterprise-continuation-preparation-attestation');f.context('build-foundation',6);
 };
 f.recoveryRefresh();f.recoveryAnchorPath=anchorPath;f.incompleteCaptureResult=captured;
 // Only this recovery observation fixture admits these exact native read
 // commands. The final/audit guard and every filesystem mutation trap remain
 // unchanged; no shell, arbitrary PID command, or proof callback is admitted.
 const nativeCalls=[['/usr/sbin/sysctl',['-n','kern.uuid']],['/usr/sbin/sysctl',['-n','kern.bootsessionuuid']],['/bin/ps',['-A','-o','pid=,ppid=,pgid=,uid=,lstart=,stat=']],['/usr/sbin/lsof',['-nP','-F0pftDin','+D',file(dir)]]];
 const trap="for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])childProcess[name]=deny('subprocess.'+name);";
 const allow=`const nativeSpawnSync=childProcess.spawnSync,allowed=${JSON.stringify(nativeCalls)};${trap}\nchildProcess.spawnSync=function(file,args,options){if(options?.shell||!allowed.some(([p,a])=>p===file&&JSON.stringify(a)===JSON.stringify(args)))return deny('subprocess.spawnSync')();return nativeSpawnSync.call(this,file,args,options)};`;
 assert.ok(guard.includes(trap));f.guardPath=join(f.temporary,'native-recovery-guard.mjs');put(f.guardPath,guard.replace(trap,allow));return f;
}

// Frozen v2 recovery fixture definition and contract from iteration44 fixed inputs.
// Future production profiles must not silently change the legacy recovery suite.
// Synthetic fixture authority only; neither this definition nor its anchor authorizes a real recovery.
const legacyRecoveryDefinition={
  "schemaVersion": 1,
  "status": "PLANNED_PENDING_INDEPENDENT_REVIEW",
  "contract": "work/enterprise/PREPARATION_CAPTURE_RECOVERY.md",
  "profileId": "P0-source-provenance-v2",
  "anchor": {
    "path": "evidence/enterprise/design-run56fec935-iteration36/recovery-anchor.json",
    "sha256": "205aa2b752e6fd3a17984225fd73b216cc61fa03a47a0b314d684844391e0fb8",
    "bytes": 5137
  },
  "authority": "FRESH_REAL_P_A_P_EXACT_INCOMPLETE_TAIL_ONLY",
  "entry": "--recover-preparation-capture",
  "terminal": "RECOVERED_ABORTED",
  "terminalEventFormatVersion": 3,
  "ordinaryEventFormatVersion": 2,
  "quiescence": "PRESENT_COMPLETE_SCOPED_PRODUCER_COVERAGE_AND_ADMISSION_EXCLUSION",
  "actualQuiescence": "UNPROVEN",
  "storage": "PREPARATION_RECOVERIES_AND_APPEND_ONLY_RECOVERY_JOURNAL",
  "phases": [
    "AUTHENTICATED",
    "FENCED",
    "QUIESCENCE_PROVEN",
    "SNAPSHOT_DURABLE",
    "ABORT_COMMITTED",
    "OLD_FENCE_RELEASED",
    "COMPLETE"
  ],
  "validatorConsumers": [
    "capture",
    "gate",
    "candidate",
    "review",
    "import"
  ],
  "implementationPaths": [
    "scripts/enterprise/runtime-preparation.mjs",
    "scripts/enterprise/verify.mjs",
    "tests/enterprise/finalization.test.mjs",
    "tests/enterprise/evidence-fixture.mjs"
  ],
  "caseIds": [
    "CR1",
    "CR2",
    "CR3",
    "CR4",
    "CR5",
    "CR6",
    "CR7",
    "CR8",
    "CR9",
    "CR10",
    "CR11",
    "CR12"
  ],
  "acceptanceCases": [
    {
      "id": "CR1",
      "acceptance": "Real isolated capture interrupted with original RUNNING/fence and partial output is recovered under a fresh independent A_P; raw original events/files remain and new abort terminal alone grants no readiness."
    },
    {
      "id": "CR2",
      "acceptance": "Wrong/stale A_P, run/session/occurrence, anchor, old closure, start, original approval or foreign fence rejects before mutation through the explicit entry; normal entry cannot recover."
    },
    {
      "id": "CR3",
      "acceptance": "Real live parent/child/grandchild, escaped process group, open output handle, PID reuse, incomplete producer coverage and inaccessible inspection deny; only present complete scoped quiescence passes."
    },
    {
      "id": "CR4",
      "acceptance": "EPERM is never swallowed as ESRCH; later ESRCH is not historical proof; missing execution/failure/inputs-after remain unknown or absent-at-observation, with original stop operation/error retained."
    },
    {
      "id": "CR5",
      "acceptance": "Missing/extra/empty/modified partial files, changed journal/fence/authority/input and symlink/path escape are rejected before and after asynchronous boundaries; concurrent bytes remain untouched."
    },
    {
      "id": "CR6",
      "acceptance": "Inject fsync/rename/CAS/readback failures at intent, inventory, terminal, old-fence release and completion; preserve blocking evidence and fences, no old successful request fallback."
    },
    {
      "id": "CR7",
      "acceptance": "SIGKILL the real recovery worker at each phase including abort-after-commit and before/after old-fence removal; no implicit lock stealing and no new capture until authenticated complete recovery."
    },
    {
      "id": "CR8",
      "acceptance": "Two actual recovery/capture/import writers contend; one admission owner only, no replacement fence deletion, no duplicate abort or attempt number reuse; readers remain zero-write."
    },
    {
      "id": "CR9",
      "acceptance": "All five readers reject tampered recovery assessment, missing quiescence proof, changed original bytes, closure substitution, partial recovery, stale response and product privilege escalation."
    },
    {
      "id": "CR10",
      "acceptance": "Complete recovery plus response loss permits read-only identical requery; no second abort, no file/mtime changes, no historical result reuse; interrupted ownership remains blocked without new authority."
    },
    {
      "id": "CR11",
      "acceptance": "Fresh actual fixed-engine capture8+ runs all295 names, independent review and prep-only import; failed new capture preserves recovered history; old profiles and all29 obligations remain."
    },
    {
      "id": "CR12",
      "acceptance": "Actual-style evidence gap leaves RUNNING/fence unchanged despite isolated295 success; missing producer coverage cannot be promoted by scans, timestamps, hash stability, caller JSON or legacy checkpoint expansion."
    }
  ],
  "fullRegressionCommand": [
    "mise",
    "exec",
    "--",
    "node",
    "--test",
    "--test-reporter=tap",
    "tests/enterprise/evidence.test.mjs",
    "tests/enterprise/finalization.test.mjs",
    "tests/enterprise/continuation.test.mjs",
    "tests/enterprise/continuation-v4.test.mjs",
    "tests/enterprise/rejected-regeneration.test.mjs",
    "tests/enterprise/closure-review.test.mjs"
  ],
  "nextAttemptMinimum": 8,
  "closureDomain": "PREP_HISTORY_RECOVERY_V1",
  "missingEvidenceDisposition": "UNKNOWN_AT_FAILURE_OR_ABSENT_AT_RECOVERY_OBSERVATION",
  "freshIndependentApproval": true,
  "preserveOriginalRunning": true,
  "preserveAllPartialBytes": true,
  "verifyCompletedOriginalBuilder": true,
  "realNativeProcessProof": true,
  "escapedDescendantsCovered": true,
  "privateRecoveryGuard": true,
  "sharedAdmissionFence": true,
  "atomicDurableCASReadback": true,
  "archiveOriginalFence": true,
  "allReaderIntegration": true,
  "beforeAfterAwaitChecks": true,
  "fixedEngineRetest": true,
  "freshFullCapture": true,
  "cumulative295": true,
  "responseLossReadOnly": true,
  "retainFenceOnUnknown": true,
  "futureProducerObservationsBeforeStop": true,
  "automaticRecovery": false,
  "forceUnlock": false,
  "pidAbsenceSufficient": false,
  "historicalEvidenceBackfill": false,
  "repackageStandaloneSuccess": false,
  "latestAbortReady": false,
  "oldRequestFallback": false,
  "productWrites": false,
  "sourceWrites": false,
  "completeH": false,
  "initializationAuthority": false,
  "targetLaunchAuthority": false,
  "runtimeReplacementAuthority": false,
  "acceptedRemainingObligations": false
};
const legacyRecoveryContract="# Incomplete preparation capture recovery\n\n## Decision and bounded authority — iteration36\n\nThis is a proposed recovery protocol, not recovery permission or an executed recovery. Actual P=20261024121802-56fec935 attempt7 remains RUNNING with its original writer fence. A_P33 authorized source Adapter implementation, not this transition. Authenticate a fresh completed independent A_P binding this contract, plan, the exact recovery anchor, real P builder/session, source checkpoint, input inventory and the same fifteen permitted implementation paths. Keep old source S and all product state unchanged. Implement only in runtime-preparation.mjs, verify.mjs and existing permitted fixture/tests; do not edit central registry, workflow bundle, runtime, initializer or product approval consumers.\n\nThe anchor records present preserved bytes and iteration35 evidence: original RUNNING/start/scope/definitions/frozen inputs, fence, previous closure, A_P33 and completed builder35, stop operation, outer capture failure, partial-output inventory and absent artifacts. Its observedAt is current observation time. It is neither a contemporaneous execution record nor proof that producers stopped. Preserve attempts1–6 and exact attempt6 acceptance. Keep attempt7's original RUNNING event and all original bytes. No synthesized execution.json, diagnostic.txt, failure.json, inputs-after.json, receipt or successful TAP may be inserted into attempt7.\n\nThe observed cause includes deliberate input changes to fix a reproduced missing-plan-hash validation gap, the implementing agent's SIGTERM to the verified obsolete child group, and subsequent `kill EPERM` in shutdown/failure recording. The corrected standalone1288-pass run is separate evidence. Later ESRCH does not establish the earlier EPERM cause or earlier quiescence. The cause remains unresolved unless actual further evidence explains it.\n\n## Recovery authority and present quiescence\n\nExpose one explicit `--recover-preparation-capture` entry on the preparation CLI, no recovery in ordinary batch/capture/readers. The target comes exclusively from the reviewed plan anchor, not a caller-supplied PID, force flag, token, historical context or arbitrary lock path. Authenticate actual builder and fresh A_P before any filesystem mutation through a private successor guard that intentionally permits inspection of this exact incomplete tail. This guard validates all complete prior attempts under their frozen definitions, exact start/frozen input of the pending attempt, completed original builder35 and A_P33, and every anchor reference. It does not call the normal fenced readiness guard with a bypass option. Refuse extra/missing/ambiguous tail events or any unbound file. Old A_P33 cannot authorize recovery.\n\nRecovery requires present scoped quiescence, not just a dead PID. A private ProducerStatePort records the host/boot identity, actual recovery invocation, observation times, native process identities/start identities, parent/descendant/group relationships, relevant open handles and admission exclusion. Derive the producer set from inspectable capture/spawn/stop records and process lineage, covering descendants that can write the old attempt; do not silently assume detached children stayed in the group. Verify the old parent is terminated and cannot resume. PID reuse, inaccessible process/open-handle inspection, EPERM, missing producer coverage or an ambiguous escaped descendant yields UNPROVEN and zero recovery publication. Do not signal a process solely because its numeric PID/PGID matches an old record. This entry does not authorize broad process termination.\n\nTake and recheck this observation under an exclusive recovery admission fence shared by all preparation mutation entries. All capture/import/recovery entries must check that fence before and after acquiring their ordinary writer lock and before any publication. All five readiness readers reject a pending recovery fence. The existing writer.lock remains in place until the final release stage. Admission exclusion covers cooperating preparation writers in this P namespace only; it does not prove global host exclusion, source writer shutdown or protection against an administrator. Process enumeration plus a stable hash interval without complete producer coverage is insufficient. The actual attempt7 evidence currently does not establish this proof; if the implementation cannot obtain it, leave the actual fence and blocker intact while testing the protocol in isolated processes.\n\nAfter quiescence, read all existing attempt7 artifacts, record exact hashes/lengths and actual observed existence states, freeze a complete recovery inventory outside attempts/7, then reread the complete set. Historical missing artifacts are `ABSENT_AT_RECOVERY_OBSERVATION` or `UNKNOWN_AT_FAILURE`, never `NOT_PRODUCED_AT_FAILURE`. Preserve zero-byte/partial files separately. Evidence conflict/change/extra artifact refuses. No recovery record certifies the original subprocess exit or failure-time completion. Historical original input and corrected current input remain distinct.\n\n## Durable transition and recovery state machine\n\nStore recovery evidence only under P/recoveries/<recoveryId>/ plus P/recovery.lock and an append-only P/recovery-journal.json. recoveryId is derived from the anchored run, attempt, original start hash, original fence hash, prior journal hash and new A_P hash, so retries identify one operation. The lock carries immutable owner/inode identity. A concurrent or orphan recovery owner is never stolen by TTL, PID absence or a generic force flag. An interrupted owner needs an explicit newly authenticated assessment and fresh design-bound authorization; until then deny. No automatic cleanup is permitted.\n\nPhases: AUTHENTICATED -> FENCED -> QUIESCENCE_PROVEN -> SNAPSHOT_DURABLE -> ABORT_COMMITTED -> OLD_FENCE_RELEASED -> COMPLETE. Persist a recovery intent before changes, and exact originals in immutable archive. Each transition appends the actual verified phase, expected raw journal/index/fence, current approval/input identity, and references to completed earlier phases. CAS under the admission fence, fsync file and directory, atomic rename and readback apply. Unknown/torn or conflicting phase records deny. A reader may inspect incomplete recovery but cannot call it complete or release either fence.\n\nPublish a distinct `RECOVERED_ABORTED` terminal, eventFormatVersion3, for exactly the original pending attempt. It is not PASSED or the old contemporaneous FAILED event. It contains the same attempt/sequence, original RUNNING/start hash, priorClosure, recoveryId, immutable recoveryAssessment reference, new authorization identity and recovery closure. The immutable assessment binds original journal/fence/start, all partial artifact references and absence observations, actual quiescence proof, new A_P and completed original occurrence, current recovery executor, preserved EPERM/stop records and explicit unknown outcome. No cycle: assessment references the pre-transition journal and previous recovery phases, never its own terminal or later release.\n\nCompute the closure as SHA256(UTF8(JSON.stringify(['PREP_HISTORY_RECOVERY_V1', priorClosure, attempt, startSha256, recoveryAssessmentSha256, recoveryAuthorizationSha256, 'RECOVERED_ABORTED']))). Require exact event fields and recompute every reference. Ordinary PASSED/FAILED remain eventFormatVersion2 under their original schema/closure; old checkpoints are unchanged. New start8+ binds this recovery closure. Do not reset sequence, truncate events or adopt attempt7 as an expanded legacy exception.\n\nAfter commit/readback and revalidation of authority, quiescence and raw files, archive and compare the original writer fence by identity/inode and exact bytes, then remove only that anchored fence under the admission fence. Never overwrite a replacement writer.lock. Record OLD_FENCE_RELEASED durably, revalidate, record COMPLETE and release only the owned recovery fence. Capture cannot start before that release and complete validation. Crash at any earlier phase retains a blocking fence or recovery intent; do not return readiness even if the abort terminal exists. If failure recording fails, retain fences and partial evidence. An error after abort commit never rewrites it as a successful capture. No fallible post-unlock validation may retroactively change the operation; after durable completion/unlock, response loss is resolved by authenticated read-only requery, not reappending or rewriting history.\n\nA completed recovery permits a new capture only. Latest RECOVERED_ABORTED is non-ready; readonly gate, candidate, review and import refuse old request6 fallback. Capture validates the complete recovery chain and starts a new attempt8+ with current fixed inputs and actual subprocesses. If those inputs change or the new attempt fails, preserve that new failure independently. The1288 standalone outputs cannot be wrapped into attempt7 or attempt8 receipts.\n\n## Profile, schemas, integration and activation\n\nNew fixed profile `P0-source-provenance-v2` retains all283 names and adds CR1–CR12, total295. acceptedComponents on APPROVE remains exactly [\"P0-control\",\"P0-source-provenance\"]; the recovery protocol is a required control within that scope, not approval of complete history or a product Issue. All29 REQUIRED_NOT_ACCEPTED obligations remain at their R1/R2/R3 owners, R4 and full B00. Scope schema2, request/receipt/candidate3, review4, acceptance3 remain shape versions; complete definition bytes now bind captureRecoveryDefinition, recoveryCaseIds and recovery protocol. Explicit old-profile readers retain original definitions/component sets. Existing AS/FH/SA assertions and fixtures remain, new profile cases are additive. No generic schema coercion or optional omission of recovery history.\n\nCapture, gate, candidate, review and import use the same private full-prefix validator. It validates all recovery phases, original evidence, quiescence proof limits and RECOVERED_ABORTED links before/after awaits and publication. request/receipt scope/definition hash binds the recovery definition; historyBinding/historyHead transitively bind the recovery terminal. Both builder/reviewer Phases and dedicated import verify that same complete chain, fresh input, real occurrence/session and independent reviewer. Keep product schema1 and its rejection of all preparation schemas unchanged. EPERM remains an error; ESRCH only means absence at that observation. Retain both original shutdown and failure-recording errors. Future producers must persist inspectable spawn/exit observations before shutdown verification; old missing observations must not be backfilled.\n\nBefore using the real recovery entry, authenticate fresh A_P and run the full isolated CR cases, source cases and all existing suites on fixed source/test bytes. Positive fixtures must use real parent/child/grandchild processes and native observation, including escaped groups/open output handles; only model replies/design fixtures may be synthetic. A self-authored quiescence JSON or stubbed success is not sufficient. Then an actual recovery must independently establish its own quiescence and CAS checks. An isolated success cannot authorize actual fence release when proof is missing. After an authorized actual recovery, require fresh full capture8+, separate implementation review and exact import. No product/source write, initialization, runtime replacement, target launch, complete H, D_T, B05, release or COMPLETE authority follows.\n\n## Acceptance cases (planned, not executed)\n\nCR1: Real isolated capture interrupted with original RUNNING/fence and partial output is recovered under a fresh independent A_P; raw original events/files remain and new abort terminal alone grants no readiness.\nCR2: Wrong/stale A_P, run/session/occurrence, anchor, old closure, start, original approval or foreign fence rejects before mutation through the explicit entry; normal entry cannot recover.\nCR3: Real live parent/child/grandchild, escaped process group, open output handle, PID reuse, incomplete producer coverage and inaccessible inspection deny; only present complete scoped quiescence passes.\nCR4: EPERM is never swallowed as ESRCH; later ESRCH is not historical proof; missing execution/failure/inputs-after remain unknown or absent-at-observation, with original stop operation/error retained.\nCR5: Missing/extra/empty/modified partial files, changed journal/fence/authority/input and symlink/path escape are rejected before and after asynchronous boundaries; concurrent bytes remain untouched.\nCR6: Inject fsync/rename/CAS/readback failures at intent, inventory, terminal, old-fence release and completion; preserve blocking evidence and fences, no old successful request fallback.\nCR7: SIGKILL the real recovery worker at each phase including abort-after-commit and before/after old-fence removal; no implicit lock stealing and no new capture until authenticated complete recovery.\nCR8: Two actual recovery/capture/import writers contend; one admission owner only, no replacement fence deletion, no duplicate abort or attempt number reuse; readers remain zero-write.\nCR9: All five readers reject tampered recovery assessment, missing quiescence proof, changed original bytes, closure substitution, partial recovery, stale response and product privilege escalation.\nCR10: Complete recovery plus response loss permits read-only identical requery; no second abort, no file/mtime changes, no historical result reuse; interrupted ownership remains blocked without new authority.\nCR11: Fresh actual fixed-engine capture8+ runs all295 names, independent review and prep-only import; failed new capture preserves recovered history; old profiles and all29 obligations remain.\nCR12: Actual-style evidence gap leaves RUNNING/fence unchanged despite isolated295 success; missing producer coverage cannot be promoted by scans, timestamps, hash stability, caller JSON or legacy checkpoint expansion.\n";
