// Preparation-only central ledger observation. No locks, repair, reconcile,
// enqueue, process termination or initialization. A quiet sample is not a lease.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,resolve} from 'node:path';
import {getGlobalConfigDir} from '../../node_modules/takt/dist/infra/config/paths.js';
import {resolveRegisteredProject,projectIdForCanonicalDirectory} from '../../node_modules/takt/dist/infra/config/global/projectRegistry.js';
import {resolveStatePaths} from '../../node_modules/takt/dist/core/execution/locations.js';
import {parseCentralTasks} from '../../node_modules/takt/dist/infra/task/centralStateRepository.js';
import {hash} from './evidence.mjs';
const fingerprint=p=>{const s=fs.lstatSync(p);assert.ok(s.isDirectory()&&!s.isSymbolicLink(),'queue directory identity');assert.equal(fs.realpathSync(p),p,'queue directory alias');return {dev:s.dev,ino:s.ino};};
const file=p=>{assert.equal(fs.realpathSync(p),p,'queue file alias');const s=fs.lstatSync(p);assert.ok(s.isFile()&&!s.isSymbolicLink(),'queue regular file required');return fs.readFileSync(p);};
export async function inspectCentralQueue(root){
 assert.equal(typeof root,'string','fresh project path required');root=fs.realpathSync(root);
 const global=resolve(getGlobalConfigDir()),locationId=projectIdForCanonicalDirectory(root),registryPath=join(global,'projects',locationId+'.json');
 const registry=file(registryPath),registered=await resolveRegisteredProject(global,locationId);
 assert.equal(registered.available,true);assert.equal(registered.canonicalDirectory,root);
 const paths=resolveStatePaths(global,registered.stateId),dirs=[root,paths.stateDirectory,paths.runsDirectory],identities=dirs.map(fingerprint);
 const stateRaw=file(paths.stateFile),tasksRaw=file(paths.tasksFile),state=JSON.parse(stateRaw);
 assert.equal(state.version,1,'queue state schema');assert.equal(state.stateId,registered.stateId,'queue state identity');assert.equal(state.locationId,locationId,'queue location identity');assert.equal(state.canonicalDirectory,root);
 assert.deepEqual(registered.fingerprint,identities[0]);assert.deepEqual(state.fingerprint,identities[0]);assert.deepEqual(state.runsRootFingerprint,identities[2]);
 const tasks=parseCentralTasks(JSON.parse(tasksRaw));
 assert.equal(new Set(tasks.map(t=>t.taskId)).size,tasks.length,'duplicate queue task');
 const runIds=tasks.flatMap(t=>t.runIds);assert.equal(new Set(runIds).size,runIds.length,'ambiguous queue run ownership');
 const blockers=tasks.filter(t=>!['completed','failed'].includes(t.status)||t.activeExecution||t.drainingExecution||t.requeueAfterDrain);
 // A task in another worktree still shares this registered project's queue.
 const references=[{path:registryPath,raw:registry},{path:paths.stateFile,raw:stateRaw},{path:paths.tasksFile,raw:tasksRaw}];
 assert.deepEqual(await resolveRegisteredProject(global,locationId),registered,'queue registration changed');
 assert.deepEqual(dirs.map(fingerprint),identities,'queue directory changed');
 for(const r of references)assert.deepEqual(file(r.path),r.raw,'queue authority changed');
 return {schemaVersion:1,kind:'CENTRAL_QUEUE_OBSERVATION',observedAt:new Date().toISOString(),project:root,stateId:registered.stateId,tasks,blockers: blockers.map(t=>({taskId:t.taskId,status:t.status,runId:t.runId,active:!!t.activeExecution,draining:!!t.drainingExecution,pendingRequeue:!!t.requeueAfterDrain})),references:references.map(r=>({path:r.path,sha256:hash(r.raw),bytes:r.raw.length})),launchAuthority:false,initializationAuthority:false,enqueueExclusionProven:false,sourceProcessExitProven:false,exclusiveWriterProven:false};
}
export async function requireTerminalQueueObservation(root,sourceRunSlug){
 assert.equal(typeof sourceRunSlug,'string','source run locator required');assert.match(sourceRunSlug,/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
 const observation=await inspectCentralQueue(root),owners=observation.tasks.filter(t=>t.runIds.includes(sourceRunSlug));
 assert.equal(owners.length,1,'source run missing or ambiguous');
 const source=owners[0];assert.equal(source.runId,sourceRunSlug,'source task advanced to another run');
 assert.ok(['completed','failed'].includes(source.status),'source ledger not terminal');
 assert.equal(observation.blockers.length,0,'central queue active pending or draining');
 return {...observation,sourceTaskId:source.taskId,sourceRunSlug,sourceLedgerStatus:source.status};
}
