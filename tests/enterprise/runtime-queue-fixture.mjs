import fs from 'node:fs';import assert from 'node:assert/strict';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {registerProject} from '../../node_modules/takt/dist/infra/config/global/projectRegistry.js';
import {openCentralTaskRepository} from '../../node_modules/takt/dist/infra/task/centralStateRepository.js';
import {inspectCentralQueue,requireTerminalQueueObservation} from '../../scripts/enterprise/runtime-queue.mjs';
export async function queueFixture(t){
 const temp=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'enterprise-queue-'))),root=join(temp,'project'),global=join(temp,'orchestrator');fs.mkdirSync(root);fs.mkdirSync(global);
 const old=process.env.TAKT_CONFIG_DIR;process.env.TAKT_CONFIG_DIR=global;const records=[];
 try{
 const project=await registerProject({globalConfigDirectory:global,projectDirectory:root,command:'isolated queue fixture'});
 const repo=await openCentralTaskRepository({globalConfigDirectory:global,...project});
 const request={task:'synthetic ledger only',workflow:'enterprise-lifecycle',worktree:false};
 const snapshot=()=>{const rows=[];function walk(p){const s=fs.lstatSync(p,{bigint:true});rows.push({p,mtime:String(s.mtimeNs),raw:s.isFile()?fs.readFileSync(p):null});if(s.isDirectory())for(const n of fs.readdirSync(p).sort())walk(join(p,n));}walk(global);return rows;};
 const observe=async()=>{const before=snapshot(),r=await inspectCentralQueue(root);assert.deepEqual(snapshot(),before);records.push(r);return r;};
 const deny=async(run,pattern)=>{const before=snapshot();await assert.rejects(requireTerminalQueueObservation(root,run),pattern);assert.deepEqual(snapshot(),before);};
 await t.test('empty initialized official ledger grants no launch lease',async()=>{const r=await observe();assert.equal(r.tasks.length,0);assert.equal(r.launchAuthority,false);assert.equal(r.enqueueExclusionProven,false);await deny('missing-source',/source run missing/);});
 const reservation=await repo.enqueueAndClaim(request);const auth={taskId:reservation.task.taskId,generation:reservation.task.generation,executionId:reservation.executionId,ownerToken:reservation.ownerToken};
 await t.test('starting reservation without a PID remains a blocker',async()=>{const r=await observe();assert.equal(r.blockers[0].status,'starting');assert.equal(r.tasks[0].activeExecution.pid,0);await deny(reservation.runId,/not terminal/);});
 const adopted=await repo.adopt({...auth,pid:process.pid});auth.generation=adopted.generation;
 await t.test('adopted execution remains a blocker',async()=>{const r=await observe();assert.equal(r.tasks[0].activeExecution.pid,process.pid);await deny(reservation.runId,/not terminal/);});
 await repo.forceFailTask(auth.taskId,'synthetic draining boundary');
 await t.test('failed status with a draining execution is rejected',async()=>{const r=await observe();assert.equal(r.tasks[0].status,'failed');assert.equal(r.blockers[0].draining,true);await deny(reservation.runId,/active pending or draining/);});
 await repo.requeueTask(auth.taskId);
 await t.test('scheduled requeue while draining is rejected',async()=>{const r=await observe();assert.equal(r.blockers[0].pendingRequeue,true);await deny(reservation.runId,/active pending or draining/);});
 await repo.terminal({...auth,status:'failed'});
 await t.test('drain acknowledgement producing pending is not terminal',async()=>{const r=await observe();assert.equal(r.tasks[0].status,'pending');assert.equal(r.tasks[0].runId,undefined);await deny(reservation.runId,/advanced to another run/);});
 const claimed=await repo.claimNextPending();
 await t.test('old source run cannot identify a later reservation',async()=>{await observe();await deny(reservation.runId,/advanced to another run/);});
 await repo.failStarting({taskId:claimed.task.taskId,generation:claimed.task.generation,executionId:claimed.executionId,ownerToken:claimed.ownerToken,message:'synthetic no worker launch'});
 await t.test('terminal ledger sample still does not prove process exit',async()=>{const r=await requireTerminalQueueObservation(root,claimed.runId);assert.equal(r.sourceLedgerStatus,'failed');assert.equal(r.sourceProcessExitProven,false);assert.equal(r.launchAuthority,false);records.push(r);});
 const unrelated=await repo.enqueueAndClaim({...request,task:'synthetic unrelated',worktree:true});
 await repo.enqueueOrReuse({...request,task:'synthetic pending'});
 await repo.failStarting({taskId:unrelated.task.taskId,generation:unrelated.task.generation,executionId:unrelated.executionId,ownerToken:unrelated.ownerToken,message:'synthetic no worker launch'});
 await t.test('unrelated pending task blocks a terminal source',async()=>{const r=await observe();assert.equal(r.blockers.length,1);assert.equal(r.blockers[0].status,'pending');await deny(claimed.runId,/active pending or draining/);});
 // Corrupt only this isolated ledger, retain exact bytes and restore after each case.
 for(const [name,mutate,pattern] of [
  ['duplicate task',d=>d.tasks.push(d.tasks[0]),/duplicate queue task/],
  ['shared run ownership',d=>{const x=d.tasks[1];x.runIds=d.tasks[0].runIds;x.attempt=x.runIds.length;x.runId=x.runIds.at(-1);},/ambiguous queue run ownership/],
  ['unknown status',d=>d.tasks[0].status='unknown',/status is invalid/]
 ])await t.test('reject '+name,async()=>{const raw=fs.readFileSync(repo.paths.tasksFile),d=JSON.parse(raw);try{mutate(d);fs.writeFileSync(repo.paths.tasksFile,JSON.stringify(d));await assert.rejects(inspectCentralQueue(root),pattern);}finally{fs.writeFileSync(repo.paths.tasksFile,raw);}});
 await t.test('missing ledger is not repaired into an empty queue',async()=>{const p=repo.paths.tasksFile;fs.renameSync(p,p+'.saved');try{await assert.rejects(inspectCentralQueue(root),/ENOENT/);assert.equal(fs.existsSync(p),false);}finally{fs.renameSync(p+'.saved',p);}});
 await t.test('state identity mismatch is rejected without repair',async()=>{const p=repo.paths.stateFile,raw=fs.readFileSync(p),d=JSON.parse(raw);try{d.locationId='0'.repeat(64);fs.writeFileSync(p,JSON.stringify(d));const before=snapshot();await assert.rejects(inspectCentralQueue(root),/queue location identity/);assert.deepEqual(snapshot(),before);}finally{fs.writeFileSync(p,raw);}});
 await t.test('symlink ledger is rejected',async()=>{const p=repo.paths.tasksFile;fs.renameSync(p,p+'.saved');fs.symlinkSync(p+'.saved',p);try{await assert.rejects(inspectCentralQueue(root),/queue file alias/);}finally{fs.unlinkSync(p);fs.renameSync(p+'.saved',p);}});
 await t.test('saved observation is not fresh project authority',async()=>{await assert.rejects(inspectCentralQueue(records[0]),/fresh project path/);});
 if(process.env.ENTERPRISE_SUITE_OUTPUT){const out=join(process.env.ENTERPRISE_SUITE_OUTPUT,'central-queue');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(join(out,'result.json'),JSON.stringify({records,ledgerOnly:true,launchAuthority:false,initializationAuthority:false},null,2)+'\n');fs.cpSync(global,join(out,'orchestrator'),{recursive:true});}
 }finally{if(old===undefined)delete process.env.TAKT_CONFIG_DIR;else process.env.TAKT_CONFIG_DIR=old;fs.rmSync(temp,{recursive:true,force:true});}
}
