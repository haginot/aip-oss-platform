// Preparation-only terminal publication observation. This does not establish
// process exit, writer exclusion, a launch lease, or historical runtime authority.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,resolve} from 'node:path';
import {getGlobalConfigDir} from '../../node_modules/takt/dist/infra/config/paths.js';
import {resolveStatePaths,resolveRunPaths} from '../../node_modules/takt/dist/core/execution/locations.js';
import {parseRunMeta} from '../../node_modules/takt/dist/core/workflow/run/run-meta.js';
import {loadWorkflowExecutionBundle} from '../../node_modules/takt/dist/features/tasks/execute/workflowExecutionBundle.js';
import {sanitizeTextForStorage} from '../../node_modules/takt/dist/features/tasks/execute/traceReportRedaction.js';
import {requireTerminalQueueObservation} from './runtime-queue.mjs';
import {hash,snapshot} from './evidence.mjs';
const directory=p=>{assert.equal(fs.realpathSync(p),p,'terminal directory alias');const s=fs.lstatSync(p);assert.ok(s.isDirectory()&&!s.isSymbolicLink(),'terminal directory required');return {dev:s.dev,ino:s.ino};};
const file=p=>{assert.equal(fs.realpathSync(p),p,'terminal file alias');assert.ok(fs.lstatSync(p).isFile(),'terminal regular file required');return fs.readFileSync(p);};
const time=v=>{assert.equal(typeof v,'string','terminal timestamp required');const n=Date.parse(v);assert.ok(Number.isFinite(n),'invalid terminal timestamp');return n;};
export async function inspectTerminalRun(root,sourceRunSlug){
 const queue=await requireTerminalQueueObservation(root,sourceRunSlug);
 const state=resolveStatePaths(resolve(getGlobalConfigDir()),queue.stateId),run=resolveRunPaths(state,sourceRunSlug);
 const task=queue.tasks.find(t=>t.taskId===queue.sourceTaskId);
 assert.equal(fs.realpathSync(task.worktreePath??queue.project),queue.project,'terminal checkout mismatch');
 const dirs=[run.runRootAbs,run.logsAbs],identities=dirs.map(directory),metaRaw=file(run.metaAbs),meta=parseRunMeta(JSON.parse(metaRaw));
 assert.equal(meta.runSlug,sourceRunSlug,'terminal run mapping');assert.equal(meta.workflow,task.workflow,'terminal workflow mapping');assert.equal(meta.task,task.task,'terminal task mapping');
 for(const [key,p] of [['runRoot',run.runRootAbs],['logsDirectory',run.logsAbs],['reportDirectory',run.reportsAbs],['contextDirectory',run.contextAbs]])assert.equal(resolve(state.stateDirectory,meta[key]),p,'terminal path mapping');
 assert.ok(['completed','failed','aborted'].includes(meta.status),'run metadata not terminal');
 assert.equal(queue.sourceLedgerStatus,meta.status==='completed'?'completed':'failed','ledger and run terminal disagree');
 assert.ok(Number.isSafeInteger(meta.iterations)&&meta.iterations>=0,'terminal iterations required');
 assert.ok(time(meta.endTime)>=time(meta.startTime),'terminal time order');
 const names=fs.readdirSync(run.logsAbs).filter(n=>n.endsWith('.jsonl')).sort();assert.equal(names.length,1,'ambiguous terminal log');
 const logPath=join(run.logsAbs,names[0]),logRaw=file(logPath),text=logRaw.toString('utf8');assert.ok(text.endsWith('\n'),'unterminated terminal log');
 const records=text.slice(0,-1).split('\n').map(JSON.parse);assert.ok(records.every(r=>r&&typeof r==='object'&&!Array.isArray(r)),'invalid terminal record');
 const starts=records.filter(r=>r.type==='workflow_start'),ends=records.filter(r=>['workflow_complete','workflow_abort'].includes(r.type));
 assert.equal(starts.length,1,'unique workflow start required');assert.equal(records[0],starts[0],'workflow start must be first');
 assert.equal(starts[0].task,meta.task,'terminal log task');assert.equal(starts[0].workflowName,meta.workflow,'terminal log workflow');assert.equal(starts[0].startTime,meta.startTime,'terminal log start time');
 assert.equal(ends.length,1,'unique terminal publication required');const end=ends[0];assert.equal(records.at(-1),end,'terminal publication must be last');
 assert.equal(end.type,meta.status==='completed'?'workflow_complete':'workflow_abort','terminal publication status');assert.equal(end.iterations,meta.iterations,'terminal publication iterations');assert.equal(end.endTime,meta.endTime,'terminal publication time');
 if(meta.status==='completed'){assert.equal(meta.failure,undefined,'completed run contains failure');assert.equal(end.reason,undefined,'completed publication contains failure');}
 else {assert.ok(typeof meta.reason==='string'&&meta.reason.length>0,'terminal failure reason required');assert.ok(end.reason===meta.reason||end.reason===sanitizeTextForStorage(meta.reason,false),'terminal failure reason mismatch');assert.equal(end.failureCategory,meta.failure?.failureCategory,'terminal failure category mismatch');}
 const bundle=loadWorkflowExecutionBundle(run),bundleSnapshot=snapshot(run.runRootAbs,['workflow-bundle']);assert.equal(bundle.rootWorkflow.name,meta.workflow,'terminal bundle workflow');
 const stepStarts=records.filter(r=>r.type==='step_start');assert.ok(stepStarts.length>0,'terminal executed occurrence required');
 const last=stepStarts.at(-1);assert.equal(last.step,meta.currentStep,'terminal current step');assert.equal(last.iteration,meta.currentIteration,'terminal current iteration');assert.ok(last.iteration<=meta.iterations,'terminal iteration boundary');
 for(const r of stepStarts){assert.equal(r.stack?.[0]?.workflow_ref,bundle.manifest.root.originalWorkflowRef,'terminal workflow reference');assert.ok(time(r.timestamp)>=time(meta.startTime)&&time(r.timestamp)<=time(meta.endTime),'terminal occurrence time');}
 const after=await requireTerminalQueueObservation(root,sourceRunSlug);assert.deepEqual(after.references,queue.references,'terminal queue changed');assert.deepEqual(after.tasks,queue.tasks,'terminal tasks changed');
 assert.deepEqual(dirs.map(directory),identities,'terminal directory changed');assert.deepEqual(fs.readdirSync(run.logsAbs).filter(n=>n.endsWith('.jsonl')).sort(),names,'terminal logs changed');
 assert.deepEqual(file(run.metaAbs),metaRaw,'terminal metadata changed');assert.deepEqual(file(logPath),logRaw,'terminal log changed');assert.deepEqual(snapshot(run.runRootAbs,['workflow-bundle']),bundleSnapshot,'terminal bundle changed');
 return {schemaVersion:1,kind:'TERMINAL_RUN_PUBLICATION_OBSERVATION',observedAt:new Date().toISOString(),sourceRunSlug,sourceTaskId:task.taskId,runStatus:meta.status,ledgerStatus:queue.sourceLedgerStatus,iterations:meta.iterations,terminalRecord:end,bundleDigest:bundleSnapshot.digest,references:[...queue.references,...[{path:run.metaAbs,raw:metaRaw},{path:logPath,raw:logRaw}].map(r=>({path:r.path,sha256:hash(r.raw),bytes:r.raw.length})),...bundleSnapshot.entries],launchAuthority:false,initializationAuthority:false,sourceProcessExitProven:false,exclusiveWriterProven:false,enqueueExclusionProven:false};
}
