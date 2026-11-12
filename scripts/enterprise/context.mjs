// Read-only adapter to TAKT's orchestrator-owned registry, bundle and session store.
// No product progress field or caller-supplied run/session ID is authoritative.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,realpathSync,lstatSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {parse} from 'yaml';
import {getGlobalConfigDir} from '../../node_modules/takt/dist/infra/config/paths.js';
import {resolveRegisteredProject,projectIdForCanonicalDirectory} from '../../node_modules/takt/dist/infra/config/global/projectRegistry.js';
import {resolveStatePaths,resolveRunPaths} from '../../node_modules/takt/dist/core/execution/locations.js';
import {parseCentralTasks} from '../../node_modules/takt/dist/infra/task/centralStateRepository.js';
import {loadWorkflowExecutionBundle} from '../../node_modules/takt/dist/features/tasks/execute/workflowExecutionBundle.js';
import {loadPersonaSessions,loadWorktreeSessions,resolvePersonaSessionId,getPersonaSessionsPath,getWorktreeSessionPath} from '../../node_modules/takt/dist/infra/config/project/sessionStore.js';
import {confined,hash,snapshot} from './evidence.mjs';

import {runtimeIdentity} from './runtime.mjs';
const json=path=>JSON.parse(readFileSync(path));
export async function currentContext(root,{requireSession=true,historicalRunSlug}={}) {
 root=realpathSync(root);
 const global=getGlobalConfigDir();
 const registered=await resolveRegisteredProject(global,projectIdForCanonicalDirectory(root));
 assert.ok(registered.available && registered.canonicalDirectory===root,'context project unavailable');
 const paths=resolveStatePaths(global,registered.stateId),state=json(paths.stateFile);
 assert.equal(state.stateId,registered.stateId,'context state identity');
 assert.equal(state.locationId,registered.locationId,'context location identity');
 assert.equal(state.canonicalDirectory,root,'context canonical project');
 const stat=lstatSync(paths.runsDirectory);
 assert.deepEqual(state.runsRootFingerprint,{dev:stat.dev,ino:stat.ino},'context runs root fingerprint');
 const tasks=parseCentralTasks(parse(readFileSync(paths.tasksFile,'utf8')));
 if(historicalRunSlug) assert.ok(/^[A-Za-z0-9_-]+$/.test(historicalRunSlug),'historical run identity');
 const candidates=tasks.filter(t=>(historicalRunSlug ? t.runIds?.includes(historicalRunSlug) : t.status==='running' && t.activeExecution?.runId===t.runId) && realpathSync(t.worktreePath??root)===root);
 assert.equal(candidates.length,1,'context unavailable or ambiguous active run');
 const task=candidates[0],run=resolveRunPaths(paths,historicalRunSlug??task.runId),meta=json(run.metaAbs);
 assert.equal(meta.runSlug,historicalRunSlug??task.runId,'context run mapping');
 if(!historicalRunSlug) assert.equal(meta.status,'running','context run not active');
 assert.equal(meta.workflow,task.workflow,'context workflow mapping');
 assert.equal(resolve(paths.stateDirectory,meta.reportDirectory),run.reportsAbs,'context report directory');
 const bundle=loadWorkflowExecutionBundle(run);
 assert.equal(bundle.rootWorkflow.name,task.workflow,'context effective workflow');
 const logNames=readdirSync(run.logsAbs).filter(n=>n.endsWith('.jsonl'));
 assert.equal(logNames.length,1,'context ambiguous log');
 const logPath=confined(run.runRootAbs,relative(run.runRootAbs,resolve(run.logsAbs,logNames[0])));
 const records=readFileSync(logPath,'utf8').trim().split('\n').map(JSON.parse);
 const start=records.filter(r=>r.type==='step_start').at(-1);
 assert.ok(start,'context missing step start');
 assert.equal(start.step,meta.currentStep,'context current step');
 assert.equal(start.iteration,meta.currentIteration,'context current iteration');
 assert.equal(start.workflow,meta.workflow,'context current workflow');
 const workflowRef=bundle.manifest.root.originalWorkflowRef;
 assert.equal(start.stack?.[0]?.workflow_ref,workflowRef,'context workflow reference');
 const step=bundle.rootWorkflow.steps.find(s=>s.name===start.step);
 assert.ok(step,'context unknown effective step');
 const sessions=task.worktree
   ?loadWorktreeSessions(root,root,start.provider,paths.sessionsDirectory)
   :loadPersonaSessions(root,start.provider,paths.sessionsDirectory);
 const sessionPath=task.worktree?getWorktreeSessionPath(root,root,paths.sessionsDirectory):getPersonaSessionsPath(root,paths.sessionsDirectory);
 const sessionKey=JSON.stringify([step.sessionKey??step.session_key,start.provider,start.model]);
 const providerSessionId=resolvePersonaSessionId(sessions,sessionKey,start.provider);
 if(requireSession) assert.ok(providerSessionId,'context provider session unavailable');
 const builderSessions=[...new Set(Object.entries(sessions).filter(([k])=>/enterprise-(builder|release)/.test(k)).map(([,v])=>v))].sort();
 const identity={project:root,stateId:registered.stateId,runSlug:historicalRunSlug??task.runId,runRoot:run.runRootAbs,
   workflow:meta.workflow,workflowRef,logPath,reportDirectory:run.reportsAbs,sessionPath,
   bundleDigest:snapshot(run.runRootAbs,['workflow-bundle']).digest,runtime:runtimeIdentity(root)};
 return {identity,step:start.step,iteration:start.iteration,providerSessionId,builderSessions,
   sessionKey:step.sessionKey??step.session_key,stepDefinition:step,start,records,sessions,steps:bundle.rootWorkflow.steps,
   // Rechecked at the end, including mutable orchestrator authority, not just product inputs.
   authority:{meta:hash(readFileSync(run.metaAbs)),tasks:hash(readFileSync(paths.tasksFile)),
     log:hash(readFileSync(logPath)),sessions:hash(readFileSync(sessionPath))}};
}
