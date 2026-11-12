// Official central launcher and engine; isolated ledger, deterministic provider.
// This proves six-step mechanics, not business acceptance or production sandboxing.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const source=resolve(import.meta.dirname,'../..');
const put=(p,v)=>{fs.mkdirSync(resolve(p,'..'),{recursive:true});fs.writeFileSync(p,typeof v==='string'?v:JSON.stringify(v,null,2)+'\n');};
const names=['design-architecture','review-architecture','build-foundation','review-foundation','harden-release','final-audit'];
export async function engineFixture(t){
 for(const mode of ['success','nonzero','timeout'])await t.test('official six-step engine '+mode,async()=>{
  const temporary=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'enterprise-engine-'))),root=join(temporary,'product'),global=join(temporary,'orchestrator');
  fs.mkdirSync(root);fs.mkdirSync(global);fs.symlinkSync(join(source,'node_modules'),join(root,'node_modules'),'dir');
  for(const p of ['context.mjs','evidence.mjs','runtime.mjs']){fs.mkdirSync(join(root,'scripts/enterprise'),{recursive:true});fs.copyFileSync(join(source,'scripts/enterprise',p),join(root,'scripts/enterprise',p));}
  put(join(root,'.takt/runtime.yaml'),{version:1,provider:{profiles:{fixture:{provider:'mock',model:'mock-model'}},defaults:{profile:'fixture'}},loop_analysis:{enabled:false,output:'file'}});
  put(join(root,'.takt/config.yaml'),{workflow_command_gates:{custom_scripts:true}});
  const steps=names.map((name,i)=>({name,session_key:'engine-'+name,persona:'Synthetic '+name,edit:i%2===0,capabilities:i%2===0?'edit':'readonly',instruction:'Synthetic engine mechanics only: '+name,quality_gates:[{type:'command',name:'observed-'+name,command:'node gate.mjs '+name,cwd:'.',timeout_ms:mode==='timeout'&&i===2?1500:15000}],output_contracts:{report:[{name:name+'.md',format:'Synthetic report'}]},rules:[{condition:'Synthetic done',next:names[i+1]??'COMPLETE'}]}));
  put(join(root,'.takt/workflows/enterprise-lifecycle.yaml'),{name:'enterprise-lifecycle',initial_step:names[0],max_steps:60,steps});
  const sequence=names.flatMap(n=>mode!=='success'&&n==='build-foundation'?[n,n]:[n]);
  put(join(temporary,'scenario.json'),sequence.flatMap(n=>[{content:'phase-one '+n,delay_ms:150},{content:'report '+n,delay_ms:150}]));
  put(join(root,'gate.mjs'),`
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
process.env.TAKT_CONFIG_DIR=${JSON.stringify(global)};
const {currentContext}=await import('./scripts/enterprise/context.mjs');
const step=process.argv[2],context=await currentContext(process.cwd());assert.equal(context.step,step);
const report=fs.readFileSync(context.identity.reportDirectory+'/'+step+'.md','utf8');assert.equal(report.trim(),'report '+step);
const events=fs.existsSync('gate-events.jsonl')?fs.readFileSync('gate-events.jsonl','utf8').trim().split('\\n').map(JSON.parse):[];
const first=step==='build-foundation'&&!events.some(e=>e.step===step),failure=first?${JSON.stringify(mode)}:'success';
fs.appendFileSync('gate-events.jsonl',JSON.stringify({step,iteration:context.iteration,run:context.identity.runSlug,session:context.providerSessionId,reportHash:createHash('sha256').update(report).digest('hex'),failure,pid:process.pid,at:new Date().toISOString()})+'\\n');
if(failure==='nonzero'){console.error('SYNTHETIC_GATE_FAILURE_17');process.exitCode=17;}
else if(failure==='timeout'){console.error('SYNTHETIC_GATE_TIMEOUT');setInterval(()=>{},1000);}
`);
  const driver=join(temporary,'driver.mjs');put(driver,`
import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const root=${JSON.stringify(root)},global=${JSON.stringify(global)},base=${JSON.stringify(join(source,'node_modules/takt/dist/'))},names=${JSON.stringify(names)},sequence=${JSON.stringify(sequence)},mode=${JSON.stringify(mode)};
const {parseLaunchRequest,launchWithNodeSpawn,openProjectRepository}=await import(pathToFileURL(base+'features/web-ui/launcher.js'));
const {registerProject}=await import(pathToFileURL(base+'infra/config/global/projectRegistry.js'));
const {currentContext}=await import(pathToFileURL(root+'/scripts/enterprise/context.mjs'));
const project=await registerProject({globalConfigDirectory:global,projectDirectory:root,command:'isolated six-step fixture'}),repository=await openProjectRepository(global,project);
assert.deepEqual(await repository.readTasks(),[]);
const request=parseLaunchRequest({prompt:'Synthetic six-step '+mode,workflow:'enterprise-lifecycle',worktree:false,autoPr:false,draftPr:false});
const started=await launchWithNodeSpawn({projectDirectory:root,globalConfigDirectory:global,request});assert.equal(started.disposition,'started');
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
let tasks,adopted;const deadline=Date.now()+60000;
while(Date.now()<deadline){tasks=await repository.readTasks();assert.equal(tasks.length,1,'unexpected queued successor');if(tasks[0].status==='running')adopted=tasks[0];if(['completed','failed'].includes(tasks[0].status))break;await new Promise(r=>setTimeout(r,40));}
assert.ok(adopted,'adoption missing');assert.equal(tasks[0].status,'completed',JSON.stringify(tasks));
while(alive(started.pid)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,40));assert.equal(alive(started.pid),false,'worker still live');
const context=await currentContext(root,{historicalRunSlug:tasks[0].runId}),records=context.records,starts=records.filter(r=>r.type==='step_start');
assert.deepEqual(starts.map(r=>r.step),sequence);assert.deepEqual(starts.map(r=>r.iteration),sequence.map((_,i)=>i+1));
const gates=fs.readFileSync(root+'/gate-events.jsonl','utf8').trim().split('\\n').map(JSON.parse);assert.deepEqual(gates.map(g=>g.step),sequence);
for(const g of gates){assert.equal(g.run,context.identity.runSlug);assert.equal(alive(g.pid),false,'gate process still live');const p1=records.findIndex(r=>r.type==='phase_complete'&&r.phase===1&&r.iteration===g.iteration),p2=records.findIndex(r=>r.type==='phase_complete'&&r.phase===2&&r.iteration===g.iteration),done=records.findIndex(r=>r.type==='step_complete'&&r.iteration===g.iteration);assert.ok(p1>=0&&p2>p1&&done>p2,'phase/report/complete ordering');assert.equal(records[p2].content,'report '+g.step);assert.ok(Date.parse(g.at)>=Date.parse(records[p2].timestamp));}
const sessions=names.map(n=>gates.find(g=>g.step===n).session);assert.equal(new Set(sessions).size,6,'review/build sessions shared');
if(mode!=='success'){const build=gates.filter(g=>g.step==='build-foundation');assert.equal(build.length,2);assert.equal(build[0].session,build[1].session);assert.equal(build[0].failure,mode);assert.equal(build[1].failure,'success');}
const reports=Object.fromEntries(names.map(n=>[n,fs.readFileSync(context.identity.reportDirectory+'/'+n+'.md','utf8')]));
for(const n of names)assert.equal(reports[n].trim(),'report '+n);
const meta=JSON.parse(fs.readFileSync(context.identity.runRoot+'/meta.json'));assert.equal(meta.status,'completed');assert.equal(meta.iterations,sequence.length);assert.equal(meta.phase,2);
assert.equal(fs.existsSync(root+'/.git'),false);assert.equal(process.env.TAKT_NOTIFY_WEBHOOK,undefined);
const gateLogs=root+'/.takt/quality-gates/logs';const failures=fs.existsSync(gateLogs)?fs.readdirSync(gateLogs).map(n=>({name:n,body:fs.readFileSync(gateLogs+'/'+n,'utf8')})):[];
if(mode==='success')assert.equal(failures.length,0);else assert.ok(failures.some(x=>x.body.includes(mode==='nonzero'?'SYNTHETIC_GATE_FAILURE_17':'SYNTHETIC_GATE_TIMEOUT')));
fs.writeFileSync(${JSON.stringify(join(temporary,'result.json'))},JSON.stringify({mode,started,adopted,tasks,context,gates,reports,meta,failures,workerExited:true,initializationAuthority:false,productApproval:false},null,2)+'\\n');
`);
  const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:temporary,LANG:'en_US.UTF-8',TAKT_CONFIG_DIR:global,TAKT_MOCK_SCENARIO:join(temporary,'scenario.json'),TAKT_MOCK_CALL_LOG:join(temporary,'mock-calls.jsonl')};
  const q=spawnSync(process.execPath,[driver],{cwd:root,env,encoding:'utf8',timeout:80000});
  const output=process.env.ENTERPRISE_SUITE_OUTPUT;
  if(output){const dest=join(output,'six-step-engine',mode);fs.mkdirSync(dest,{recursive:true});for(const p of ['orchestrator','result.json','mock-calls.jsonl','scenario.json','driver.mjs','product/gate-events.jsonl','product/gate.mjs','product/.takt'])if(fs.existsSync(join(temporary,p)))fs.cpSync(join(temporary,p),join(dest,p),{recursive:true});put(join(dest,'execution.json'),{argv:[process.execPath,driver],status:q.status,signal:q.signal,stdout:q.stdout,stderr:q.stderr,temporary});}
  const result=fs.existsSync(join(temporary,'result.json'))?JSON.parse(fs.readFileSync(join(temporary,'result.json'))):null;
  if(result?.workerExited)t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
  assert.equal(q.status,0,q.stderr+'\nfixture retained at '+temporary);assert.equal(result.gates.length,sequence.length);
 });
}
