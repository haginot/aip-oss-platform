// Real official launcher/worker/engine in an isolated project and central ledger.
// Only the provider is TAKT's deterministic mock. No live task or model is used.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const source=resolve(import.meta.dirname,'../..');
const put=(p,v)=>{fs.mkdirSync(resolve(p,'..'),{recursive:true});fs.writeFileSync(p,typeof v==='string'?v:JSON.stringify(v,null,2)+'\n');};
export async function launcherFixture(t){
 const temporary=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'enterprise-launcher-')));
 const root=join(temporary,'product'),global=join(temporary,'orchestrator');fs.mkdirSync(root);fs.mkdirSync(global);
 fs.symlinkSync(join(source,'node_modules'),join(root,'node_modules'),'dir');
 for(const p of ['context.mjs','evidence.mjs','runtime.mjs']){fs.mkdirSync(join(root,'scripts/enterprise'),{recursive:true});fs.copyFileSync(join(source,'scripts/enterprise',p),join(root,'scripts/enterprise',p));}
 put(join(root,'.takt/runtime.yaml'),{version:1,provider:{profiles:{fixture:{provider:'mock',model:'mock-model'}},defaults:{profile:'fixture'}},loop_analysis:{enabled:false,output:'file'}});
 put(join(root,'.takt/workflows/enterprise-lifecycle.yaml'),{
  name:'enterprise-lifecycle',initial_step:'design-architecture',max_steps:60,
  steps:[{name:'design-architecture',session_key:'fixture-architect',persona:'Synthetic architect',edit:true,instruction:'Synthetic launcher mechanics only.',output_contracts:{report:[{name:'architecture.md',format:'Synthetic report'}]},rules:[{condition:'Synthetic done',next:'COMPLETE'}]}]
 });
 put(join(temporary,'scenario.json'),[{content:'synthetic architecture',delay_ms:600},{content:'synthetic report',delay_ms:600},{content:'[STEP:1]',structured_output:{step:1}}]);
 const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:temporary,LANG:'en_US.UTF-8',TAKT_CONFIG_DIR:global,TAKT_MOCK_SCENARIO:join(temporary,'scenario.json'),TAKT_MOCK_CALL_LOG:join(temporary,'mock-calls.jsonl')};
 const driver=join(temporary,'driver.mjs');put(driver,`
import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const root=${JSON.stringify(root)},global=${JSON.stringify(global)},base=${JSON.stringify(join(source,'node_modules/takt/dist/'))};
const {parseLaunchRequest,launchWithNodeSpawn,openProjectRepository}=await import(pathToFileURL(base+'features/web-ui/launcher.js'));
const {registerProject}=await import(pathToFileURL(base+'infra/config/global/projectRegistry.js'));
const {currentContext}=await import(pathToFileURL(root+'/scripts/enterprise/context.mjs'));
const {requireTerminalQueueObservation}=await import(pathToFileURL(${JSON.stringify(join(source,'scripts/enterprise/runtime-queue.mjs'))}));
const project=await registerProject({globalConfigDirectory:global,projectDirectory:root,command:'isolated launcher fixture'});
const repository=await openProjectRepository(global,project);
const request=parseLaunchRequest({prompt:'Synthetic isolated migration launcher fixture',workflow:'enterprise-lifecycle',worktree:false,autoPr:false,draftPr:false});
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
async function run(request,duplicate,expectedStatus='completed'){
const started=await launchWithNodeSpawn({projectDirectory:root,globalConfigDirectory:global,request});
assert.equal(started.disposition,'started');assert.ok(started.pid>0);
let tasks,context,adopted,reused;const workerPids=new Set([started.pid]),contexts={};const deadline=Date.now()+25000;
while(Date.now()<deadline){
 tasks=await repository.readTasks();const task=tasks.find(x=>x.task===request.prompt);
 for(const x of tasks)if(x.activeExecution?.pid>0)workerPids.add(x.activeExecution.pid);
 try{const c=await currentContext(root);contexts[c.identity.runSlug]=c;if(c.identity.runSlug===task?.runId)context=c;}catch{}
 if(task?.status==='running'){adopted=task;
 if(duplicate&&!reused){reused=await launchWithNodeSpawn({projectDirectory:root,globalConfigDirectory:global,request});assert.equal(reused.disposition,'reused');assert.equal(reused.pid,started.pid);}}
 if(task&&tasks.every(x=>['completed','failed'].includes(x.status)))break;
 await new Promise(r=>setTimeout(r,50));
}
assert.ok(adopted,'actual worker adoption not observed');assert.equal(tasks.find(x=>x.taskId===adopted.taskId).status,expectedStatus,JSON.stringify(tasks));assert.ok(context,'actual currentContext session not observed');
while([...workerPids].some(alive)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
assert.equal([...workerPids].some(alive),false,'terminal task does not prove worker exit');
return {started,tasks,adopted,context,contexts,reused,workerPids:[...workerPids],workerExited:true};
}
const first=await run(request,true);
assert.equal(first.tasks.length,2);assert.ok(first.tasks.every(x=>x.status==='completed'));
const priorRoot=first.context.identity.runRoot,priorMeta=fs.readFileSync(priorRoot+'/meta.json');
const second=await run({...request,prompt:request.prompt+' second'},false);
assert.equal(second.tasks.length,3);assert.notEqual(first.adopted.taskId,second.adopted.taskId);assert.notEqual(first.context.identity.runSlug,second.context.identity.runSlug);
assert.deepEqual(fs.readFileSync(priorRoot+'/meta.json'),priorMeta);
assert.notEqual(first.context.providerSessionId,second.context.providerSessionId);
const reports=[first,second].map(r=>{const dir=r.context.identity.runRoot,meta=JSON.parse(fs.readFileSync(dir+'/meta.json')),report=fs.readFileSync(dir+'/reports/architecture.md','utf8');assert.equal(meta.status,'completed');assert.equal(meta.phase,2);assert.equal(meta.iterations,1);assert.equal(report.trim(),'synthetic report');return {runSlug:meta.runSlug,phase:meta.phase,status:meta.status,report};});
const {createWorkflowRunLifecycle}=await import(pathToFileURL(base+'features/tasks/execute/workflowRunLifecycle.js'));
const rejectedRoot=root+'/rejected-runs';const lifecycle=createWorkflowRunLifecycle({cwd:root,runPathsDirectory:rejectedRoot}).lifecycle;
await assert.rejects(lifecycle.beginRun({task:'synthetic',requestedRunSlug:first.context.identity.runSlug,resumeSource:{sourceRunSlug:first.context.identity.runSlug}}),/distinct source and target run slugs/);
assert.equal(fs.existsSync(rejectedRoot),false);
const queue=await requireTerminalQueueObservation(root,second.context.identity.runSlug);
assert.equal(queue.blockers.length,0);assert.equal(queue.tasks.length,3);
const limited=JSON.parse(fs.readFileSync(root+'/.takt/workflows/enterprise-lifecycle.yaml'));
limited.name='terminal-limit';limited.max_steps=1;limited.steps[0].rules[0].next='design-architecture';
fs.writeFileSync(root+'/.takt/workflows/terminal-limit.yaml',JSON.stringify(limited));
const failed=await run({...request,prompt:'Synthetic actual max-step terminal',workflow:'terminal-limit'},false,'failed');
const {terminalCases}=await import(pathToFileURL(${JSON.stringify(join(source,'tests/enterprise/runtime-terminal-fixture.mjs'))}));
const terminal=await terminalCases(root,global,second,failed);

fs.writeFileSync(${JSON.stringify(join(temporary,'result.json'))},JSON.stringify({first,second,failed,reports,queue,terminal,paths:repository.paths,sameRunRejectedBeforeWrite:true,priorMetaPreserved:true},null,2)+'\\n');
`);
 const q=spawnSync(process.execPath,[driver],{cwd:root,env,encoding:'utf8',timeout:65000});
 const output=process.env.ENTERPRISE_SUITE_OUTPUT;
 if(output){const dest=join(output,'central-launcher');fs.mkdirSync(dest,{recursive:true});for(const p of ['orchestrator','result.json','mock-calls.jsonl','scenario.json','driver.mjs'])if(fs.existsSync(join(temporary,p)))fs.cpSync(join(temporary,p),join(dest,p),{recursive:true});put(join(dest,'execution.json'),{argv:[process.execPath,driver],status:q.status,signal:q.signal,stdout:q.stdout,stderr:q.stderr});}
 // Never remove a directory beneath a still-running detached worker.
 const result=fs.existsSync(join(temporary,'result.json'))?JSON.parse(fs.readFileSync(join(temporary,'result.json'))):null;
 if(result?.first?.workerExited&&result?.second?.workerExited)t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
 assert.equal(q.status,0,q.stderr+'\nfixture retained at '+temporary);
 await t.test('official launcher reserves adopts and runs initial architecture',()=>{for(const r of [result.first,result.second]){assert.equal(r.context.step,'design-architecture');assert.equal(r.context.iteration,1);assert.equal(r.context.identity.runSlug,r.adopted.runId);assert.equal(r.context.providerSessionId.startsWith('mock-session-'),true);assert.equal(r.adopted.executionRequest,undefined);assert.equal(r.adopted.worktree,false);}});
 await t.test('reused worker response queues another task and automatically executes it',()=>{assert.equal(result.first.reused.pid,result.first.started.pid);assert.equal(result.first.tasks.length,2);assert.ok(result.first.tasks.every(x=>x.status==='completed'));assert.notEqual(result.first.tasks[0].runId,result.first.tasks[1].runId);assert.equal(result.first.workerPids.length,2);});
 await t.test('new central task starts a distinct run after the previous workers exit',()=>{assert.equal(result.first.workerExited,true);assert.equal(result.second.workerExited,true);assert.notEqual(result.first.context.identity.runSlug,result.second.context.identity.runSlug);assert.equal(result.second.tasks.length,3);});
 await t.test('same-run resume fails before creating any run directory',()=>{assert.equal(result.sameRunRejectedBeforeWrite,true);assert.equal(result.priorMetaPreserved,true);});
 await t.test('engine writes phase two reports with distinct provider sessions',()=>{assert.notEqual(result.first.context.providerSessionId,result.second.context.providerSessionId);assert.equal(result.reports.length,2);for(const r of result.reports){assert.equal(r.phase,2);assert.equal(r.report.trim(),'synthetic report');}});
 await t.test('real completed launcher tasks have a quiet ledger sample without launch authority',()=>{assert.equal(result.queue.sourceRunSlug,result.second.context.identity.runSlug);assert.equal(result.queue.sourceLedgerStatus,'completed');assert.equal(result.queue.tasks.length,3);assert.equal(result.queue.blockers.length,0);assert.equal(result.queue.enqueueExclusionProven,false);assert.equal(result.queue.sourceProcessExitProven,false);assert.equal(result.queue.launchAuthority,false);});
 for(const name of result.terminal.cases)await t.test('terminal publication: '+name,()=>assert.ok(result.terminal.cases.includes(name)));
 return result;
}
