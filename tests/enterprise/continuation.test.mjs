import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fixture,put,read,tree} from './evidence-fixture.mjs';
import {hash} from '../../scripts/enterprise/evidence.mjs';
const progress=f=>join(f.root,'work/enterprise/progress.json');
const init=['batch','--initialize-run'];
function success(r){assert.equal(r.status,0,r.stderr);return r;}
function rejected(r,pattern){assert.notEqual(r.status,0,r.stdout);assert.match(r.stderr,pattern);assert.doesNotMatch(r.stderr,/FS_MUTATION/);}
async function createContinuation(t){
 const f=await fixture(t,{multi:true,selection:true,seal:false});
 const p=read(progress(f));p.activeBatchId=null;put(progress(f),p);
 f.context('build-foundation',3);success(f.cli(['batch','--batch','B01'],{readonly:false}));
 f.batchReport({iteration:4}, {batchId:'B01',iteration:4});f.context('build-foundation',5);
 const oldRun=f.nextRun();return {...f,oldRun};
}
// These tests run sequentially. Build the real CLI history once, then restore
// every product/orchestrator file and in-memory record before each fault. Keep
// directories in place: TAKT authenticates the runs directory's inode.
let preparedContinuation;
const historyCleanup=[];
after(()=>{for(const cleanup of historyCleanup)cleanup();});
function historyCheckpoint(f){
 const baseline=tree(f.temporary),known=new Set(baseline.map(e=>e.path));
 const files=new Map(baseline.filter(e=>fs.lstatSync(f.temporary+e.path).isFile()).map(e=>[e.path,fs.readFileSync(f.temporary+e.path)]));
 const links=new Map(baseline.filter(e=>fs.lstatSync(f.temporary+e.path).isSymbolicLink()).map(e=>[e.path,fs.readlinkSync(f.temporary+e.path)]));
 const records=structuredClone(f.records),sessions=structuredClone(f.sessions),env={...f.env};
 const shape=entries=>entries.map(({mtime,...entry})=>entry);
 return ()=>{
  for(const e of tree(f.temporary).reverse())if(!known.has(e.path))fs.rmSync(f.temporary+e.path,{recursive:true,force:true});
  for(const e of baseline){
   const path=f.temporary+e.path;
   if(files.has(e.path)){
    if(!fs.existsSync(path)||!fs.lstatSync(path).isFile()||!fs.readFileSync(path).equals(files.get(e.path))){fs.rmSync(path,{recursive:true,force:true});fs.writeFileSync(path,files.get(e.path));}
    fs.chmodSync(path,e.mode&0o777);
   }else if(links.has(e.path)){
    if(!fs.existsSync(path)||!fs.lstatSync(path).isSymbolicLink()||fs.readlinkSync(path)!==links.get(e.path)){fs.rmSync(path,{recursive:true,force:true});fs.symlinkSync(links.get(e.path),path);}
   }else fs.mkdirSync(path,{recursive:true});
  }
  f.records.splice(0,f.records.length,...structuredClone(records));
  for(const key of Object.keys(f.sessions))delete f.sessions[key];Object.assign(f.sessions,structuredClone(sessions));
  assert.deepEqual(shape(tree(f.temporary)),shape(baseline),'fixture files restored before each condition');
  for(const [path,target]of links)assert.equal(fs.readlinkSync(f.temporary+path),target);
  for(const key of Object.keys(f.env))delete f.env[key];Object.assign(f.env,env);
  assert.deepEqual(f.records,records);assert.deepEqual(f.sessions,sessions);assert.deepEqual(f.env,env);
 };
}
async function continuation(t){
 if(!preparedContinuation){const f=await createContinuation({after:cleanup=>historyCleanup.push(cleanup)});preparedContinuation={f,restore:historyCheckpoint(f)};}
 preparedContinuation.restore();return preparedContinuation.f;
}
test('continuation fixture reset restores writer faults and central context',async t=>{
 const f=await continuation(t),restore=historyCheckpoint(f),before=tree(f.temporary).map(({mtime,...e})=>e),inode=fs.statSync(f.paths.runsDirectory).ino;
 fs.appendFileSync(progress(f),'changed');fs.unlinkSync(f.run.metaAbs);put(join(f.root,'evidence/enterprise/gate.lock'),'unknown writer');
 f.records.push({type:'injected'});f.sessions.injected='wrong';f.env.TAKT_RUN_ID='wrong-run';
 restore();assert.deepEqual(tree(f.temporary).map(({mtime,...e})=>e),before);assert.equal(fs.statSync(f.paths.runsDirectory).ino,inode);
 success(f.cli(init,{readonly:false}));assert.deepEqual(read(progress(f)).approvals,{});restore();
});
function injected(f,code){
 const path=join(f.temporary,'injection.mjs');put(path,"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';\n"+code+'\nsyncBuiltinESMExports();');
 return spawnSync(process.execPath,['--import',path,join(f.root,'scripts/enterprise/verify.mjs'),...init],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20000});
}
test('old-run-selection-and-approval-rejected',async t=>{
 const f=await continuation(t),before=fs.readFileSync(progress(f));
 rejected(f.cli(['batch','--batch','B01'],{readonly:false}),/writer binding runSlug/);
 assert.deepEqual(fs.readFileSync(progress(f)),before);
 const p=read(progress(f));p.activeBatchId=null;put(progress(f),p);
 rejected(f.cli(['batch','--batch','B02'],{readonly:false}),/writer binding runSlug/);
});
test('trusted-new-run-bootstrap-preserves-history',async t=>{
 const f=await continuation(t),old=fs.readFileSync(progress(f)),oldRuns=tree(join(f.root,'evidence/enterprise/runs'));
 success(f.cli(init,{readonly:false}));const p=read(progress(f));
 assert.equal(p.runBinding.runSlug,'new-fixture-run');assert.equal(p.activeBatchId,'B00');assert.deepEqual(p.approvals,{});assert.deepEqual(p.issues,{});
 const manifest=read(join(f.root,p.history.manifest));assert.equal(manifest.oldRunSlug,'fixture-run');assert.equal(hash(fs.readFileSync(join(f.root,p.history.manifest))),p.history.sha256);
 assert.deepEqual(fs.readFileSync(join(f.root,p.history.manifest.replace('manifest.json','progress.json'))),old);
 assert.deepEqual(tree(join(f.root,'evidence/enterprise/runs')),oldRuns);
 const selection=read(join(f.root,p.entrySelection));assert.equal(selection.batchId,'B00');assert.deepEqual(selection.predecessors,[]);
 success(f.cli(['batch','--batch','B00'],{readonly:false}));assert.equal(read(progress(f)).issues['ENT-101'].status,'READY_FOR_REVIEW');
});
test('same-run-reinitialization-rejected',async t=>{
 const f=await continuation(t);success(f.cli(init,{readonly:false}));
 for(const batch of ['B00','B01']){const p=read(progress(f));p.activeBatchId=batch;put(progress(f),p);const before=tree(f.temporary);
 rejected(f.cli(init),/run already initialized/);assert.deepEqual(tree(f.temporary),before);}
});
test('unknown-context-bootstrap-zero-writes',async t=>{
 for(const mode of ['missing','contradictory','self-reported','readonly','mixed-history'])await t.test(mode,async t=>{
 const f=await continuation(t);
 if(mode==='missing')fs.unlinkSync(f.run.metaAbs);
 if(mode==='contradictory'){const meta=read(f.run.metaAbs);meta.currentIteration=99;put(f.run.metaAbs,meta);}
 if(mode==='self-reported'){const task=read(f.paths.tasksFile);task.tasks[0].status='completed';delete task.tasks[0].activeExecution;put(f.paths.tasksFile,task);f.env.TAKT_RUN_ID='new-fixture-run';}
 if(mode==='readonly')f.context('review-foundation',2);
 if(mode==='mixed-history'){const p=read(progress(f));p.approvals.B01.reportHash='0'.repeat(64);put(progress(f),p);}
 const before=tree(f.temporary);rejected(f.cli(init),/ENOENT|context|initialization requires|changed old review/);assert.deepEqual(tree(f.temporary),before);
 });
});
test('bootstrap-archive-failure-and-concurrent-change',async t=>{
 await t.test('archive failure',async t=>{
 const f=await continuation(t),before=fs.readFileSync(progress(f));
 const r=injected(f,"const original=fs.openSync;fs.openSync=function(p,...args){if(String(p).includes('/continuations/'))throw Error('INJECTED_ARCHIVE_FAILURE');return original.call(this,p,...args)};");
 rejected(r,/INJECTED_ARCHIVE_FAILURE/);assert.deepEqual(fs.readFileSync(progress(f)),before);
 success(f.cli(init,{readonly:false}));
 });
 await t.test('concurrent progress',async t=>{
 const f=await continuation(t),before=read(progress(f));
 const r=injected(f,"const original=fs.fsyncSync;let changed=false;fs.fsyncSync=function(...args){if(!changed){changed=true;const p='work/enterprise/progress.json';const value=JSON.parse(fs.readFileSync(p));value.concurrent='preserve';fs.writeFileSync(p,JSON.stringify(value));}return original.apply(this,args)};");
 rejected(r,/concurrent old progress change/);assert.deepEqual(read(progress(f)),{...before,concurrent:'preserve'});
 });
 await t.test('durable checkpoint interruption and recovery',async t=>{
 const f=await continuation(t),before=fs.readFileSync(progress(f));
 const r=injected(f,"fs.renameSync=function(){process.kill(process.pid,'SIGKILL')};");
 assert.equal(r.signal,'SIGKILL');assert.deepEqual(fs.readFileSync(progress(f)),before);
 const directory=join(f.root,'evidence/enterprise/continuations');const archives=fs.readdirSync(directory);assert.equal(archives.length,1);
 const checkpoint=fs.readFileSync(join(directory,archives[0],'manifest.json'));
 success(f.cli(init,{readonly:false}));assert.deepEqual(fs.readFileSync(join(directory,archives[0],'manifest.json')),checkpoint);assert.equal(fs.readdirSync(directory).length,1);
 });
 await t.test('concurrent progress after archive publication',async t=>{
 const f=await continuation(t),before=read(progress(f));
 const r=injected(f,"const original=fs.linkSync;fs.linkSync=function(p,d,...args){const result=original.call(this,p,d,...args);if(String(d).endsWith('/manifest.json')){const path='work/enterprise/progress.json';const value=JSON.parse(fs.readFileSync(path));value.concurrent='after-archive';fs.writeFileSync(path,JSON.stringify(value));}return result};");
 rejected(r,/concurrent old progress change/);assert.deepEqual(read(progress(f)),{...before,concurrent:'after-archive'});
 });
});
test('current-run-prefix-review-required',async t=>{
 const f=await continuation(t);success(f.cli(init,{readonly:false}));
 const clear=()=>{const p=read(progress(f));p.activeBatchId=null;put(progress(f),p);};
 clear();rejected(f.cli(['batch','--batch','B01'],{readonly:false}),/not earliest pending batch/);
 success(f.cli(['batch','--batch','B00'],{readonly:false}));clear();
 rejected(f.cli(['batch','--batch','B01'],{readonly:false}),/not earliest pending batch/);
 f.batchReport();f.context('build-foundation',3);success(f.cli(['batch','--batch','B01'],{readonly:false}));clear();
 rejected(f.cli(['batch','--batch','B02'],{readonly:false}),/not earliest pending batch/);
 f.batchReport({iteration:4}, {batchId:'B01',iteration:4});f.context('build-foundation',5);success(f.cli(['batch','--batch','B02'],{readonly:false}));
});
test('bootstrap-does-not-rewrite-old-run',async t=>{
 const f=await continuation(t);
 for(const path of ['evidence/generated/release/adapter-trace.json','evidence/model-smoke.json'])put(join(f.root,path),'protected synthetic bytes');
 const old=tree(f.oldRun.runRootAbs),reviews=tree(join(f.root,'evidence/enterprise/reviews')),selections=tree(join(f.root,'evidence/enterprise/selections'));
 const central=fs.readFileSync(f.paths.tasksFile),protectedBefore=['evidence/generated/release/adapter-trace.json','evidence/model-smoke.json'].map(p=>fs.readFileSync(join(f.root,p)));
 success(f.cli(init,{readonly:false}));assert.deepEqual(tree(f.oldRun.runRootAbs),old);assert.deepEqual(fs.readFileSync(f.paths.tasksFile),central);
 assert.deepEqual(tree(join(f.root,'evidence/enterprise/reviews')),reviews);assert.deepEqual(tree(join(f.root,'evidence/enterprise/selections')),selections);
 assert.deepEqual(['evidence/generated/release/adapter-trace.json','evidence/model-smoke.json'].map(p=>fs.readFileSync(join(f.root,p))),protectedBefore);
});

test('archive-partial-write-recovery-BF-08',async t=>{
 for(const target of ['progress.json','receipt.json','selection.json','manifest.json'])for(const length of [0,3])for(const fault of ['EIO','SIGKILL'])await t.test(target+' '+length+' bytes '+fault,async t=>{
  const f=await continuation(t),before=fs.readFileSync(progress(f));
  const r=injected(f,`
   const open=fs.openSync,write=fs.writeFileSync;const targets=new Set();
   fs.openSync=function(p,...args){const fd=open.call(this,p,...args);if(String(p).includes('/continuations/')&&String(p).includes(${JSON.stringify(target)}))targets.add(fd);return fd};
   fs.writeFileSync=function(fd,raw,...args){if(targets.has(fd)){targets.delete(fd);write.call(this,fd,Buffer.from(raw).subarray(0,${length}));${fault==='SIGKILL'?"process.kill(process.pid,'SIGKILL');":"throw Object.assign(Error('INJECTED_PARTIAL_EIO'),{code:'EIO'});"}}return write.call(this,fd,raw,...args)};
  `);
  if(fault==='SIGKILL')assert.equal(r.signal,'SIGKILL');else rejected(r,/INJECTED_PARTIAL_EIO/);
  assert.deepEqual(fs.readFileSync(progress(f)),before);
  const directory=join(f.root,'evidence/enterprise/continuations'),archives=fs.readdirSync(directory);assert.equal(archives.length,1);
  assert.equal(tree(directory).filter(e=>e.path.endsWith('/'+target)).length,0,'incomplete checkpoint must not be published');
  // A retry must recover without deleting files or altering any saved state.
  success(f.cli(init,{readonly:false}));assert.deepEqual(fs.readdirSync(directory),archives);
  const p=read(progress(f)),manifest=read(join(f.root,p.history.manifest));
  assert.equal(p.activeBatchId,'B00');assert.deepEqual(p.approvals,{});assert.deepEqual(p.issues,{});
  assert.deepEqual(fs.readFileSync(join(directory,archives[0],'progress.json')),before);
  assert.equal(hash(fs.readFileSync(join(f.root,p.history.manifest))),p.history.sha256);
  assert.equal(hash(fs.readFileSync(join(f.root,p.entrySelection))),manifest.selectionSha256);
  for(const entry of manifest.files.entries)assert.equal(hash(fs.readFileSync(join(directory,archives[0],'files',entry.path))),entry.sha256);
 });
});
test('completed-archive-tamper-remains-rejected-BF-08',async t=>{
 const f=await continuation(t),before=fs.readFileSync(progress(f));
 const r=injected(f,"fs.renameSync=function(){process.kill(process.pid,'SIGKILL')};");assert.equal(r.signal,'SIGKILL');
 const directory=join(f.root,'evidence/enterprise/continuations'),archive=fs.readdirSync(directory)[0],path=join(directory,archive,'progress.json');
 fs.appendFileSync(path,'tampered');const changed=fs.readFileSync(path);
 rejected(f.cli(init,{readonly:false}),/changed initialization checkpoint/);
 assert.deepEqual(fs.readFileSync(path),changed);assert.deepEqual(fs.readFileSync(progress(f)),before);
});

test('initializer-lock-partial-write-recovery-BF-09',async t=>{
 for(const length of [0,3])for(const fault of ['EIO','SIGKILL'])await t.test(length+' bytes '+fault,async t=>{
  const f=await continuation(t),before=fs.readFileSync(progress(f)),oldRuns=tree(join(f.root,'evidence/enterprise/runs'));
  const r=injected(f,`
   const open=fs.openSync,write=fs.writeFileSync;const targets=new Set();
   fs.openSync=function(p,...args){const fd=open.call(this,p,...args);if(String(p).includes('/gate.lock'))targets.add(fd);return fd};
   fs.writeFileSync=function(fd,raw,...args){if(targets.has(fd)){targets.delete(fd);write.call(this,fd,Buffer.from(raw).subarray(0,${length}));${fault==='SIGKILL'?"process.kill(process.pid,'SIGKILL');":"throw Object.assign(Error('INJECTED_LOCK_EIO'),{code:'EIO'});"}}return write.call(this,fd,raw,...args)};
  `);
  if(fault==='SIGKILL')assert.equal(r.signal,'SIGKILL');else rejected(r,/INJECTED_LOCK_EIO/);
  assert.deepEqual(fs.readFileSync(progress(f)),before);
  // No manual lock deletion: the real CLI must retry after either failure.
  success(f.cli(init,{readonly:false}));
  const p=read(progress(f)),manifest=read(join(f.root,p.history.manifest)),directory=join(f.root,p.history.manifest,'..');
  assert.equal(p.activeBatchId,'B00');assert.deepEqual(p.approvals,{});assert.deepEqual(p.issues,{});
  assert.deepEqual(fs.readFileSync(join(directory,'progress.json')),before);
  assert.equal(hash(fs.readFileSync(join(f.root,p.history.manifest))),p.history.sha256);
  assert.equal(hash(fs.readFileSync(join(f.root,p.entrySelection))),manifest.selectionSha256);
  for(const entry of manifest.files.entries)assert.equal(hash(fs.readFileSync(join(directory,'files',entry.path))),entry.sha256);
  assert.deepEqual(tree(join(f.root,'evidence/enterprise/runs')),oldRuns);
  assert.equal(fs.existsSync(join(f.root,'evidence/enterprise/gate.lock')),false);
 });
});
test('initializer-lock-ownership-boundaries-BF-09',async t=>{
 for(const mode of ['empty','partial','live','other-run'])await t.test(mode,async t=>{
  const f=await continuation(t),path=join(f.root,'evidence/enterprise/gate.lock');
  put(path,mode==='empty'?'':mode==='partial'?'{"k':{kind:'enterprise-run-initialization',runSlug:mode==='other-run'?'another-run':'new-fixture-run',pid:process.pid});
  const before=tree(f.temporary);
  rejected(f.cli(init,{readonly:false}),/gate writer active or unknown|initializer still active|other initializer lock/);
  assert.deepEqual(tree(f.temporary),before);
 });
 await t.test('interruption after complete lock publication',async t=>{
  const f=await continuation(t),before=fs.readFileSync(progress(f));
  const r=injected(f,"const link=fs.linkSync;fs.linkSync=function(p,d,...args){const result=link.call(this,p,d,...args);if(String(d).endsWith('/gate.lock'))process.kill(process.pid,'SIGKILL');return result};");
  assert.equal(r.signal,'SIGKILL');assert.deepEqual(fs.readFileSync(progress(f)),before);
  const owner=read(join(f.root,'evidence/enterprise/gate.lock'));assert.equal(owner.runSlug,'new-fixture-run');
  success(f.cli(init,{readonly:false}));assert.deepEqual(read(progress(f)).approvals,{});
 });
 await t.test('concurrent ordinary writer is not overwritten',async t=>{
  const f=await continuation(t),before=fs.readFileSync(progress(f));
  const r=injected(f,"const link=fs.linkSync;fs.linkSync=function(p,d,...args){if(String(d).endsWith('/gate.lock'))fs.writeFileSync(d,'',{flag:'wx'});return link.call(this,p,d,...args)};");
  rejected(r,/EEXIST/);assert.deepEqual(fs.readFileSync(progress(f)),before);
  assert.equal(fs.readFileSync(join(f.root,'evidence/enterprise/gate.lock'),'utf8'),'');
 });
});


// Pause actual CLI processes at the old recovery race: A has read the stale
// owner twice, B publishes its own lock, then A resumes its acquisition.
test('initializer-lock-concurrent-reclaim-BF-10',async t=>{
 const f=await continuation(t),before=fs.readFileSync(progress(f)),oldRuns=tree(join(f.root,'evidence/enterprise/runs'));
 const gate=join(f.root,'evidence/enterprise/gate.lock');
 const dead=spawnSync(process.execPath,['-e','']);assert.equal(dead.status,0);
 assert.throws(()=>process.kill(dead.pid,0),{code:'ESRCH'});
 put(gate,{kind:'enterprise-run-initialization',pid:dead.pid,runSlug:'new-fixture-run'});
 const marker=name=>join(f.temporary,name);
 const children=[];
 const start=(name,code)=>{
  const injection=marker(name+'.mjs');
  put(injection,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
   const mark=n=>fs.writeFileSync(${JSON.stringify(f.temporary)}+'/'+n,'');
   const wait=n=>{const end=Date.now()+15000;while(!fs.existsSync(${JSON.stringify(f.temporary)}+'/'+n)){if(Date.now()>end)throw Error('barrier timeout '+n);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10)}};
   ${code}\nsyncBuiltinESMExports();`);
  const child=spawn(process.execPath,['--import',injection,join(f.root,'scripts/enterprise/verify.mjs'),...init],{cwd:f.root,env:f.env,stdio:['ignore','pipe','pipe']});
  const result={child,stdout:'',stderr:'',done:false};children.push(result);
  child.stdout.on('data',b=>result.stdout+=b);child.stderr.on('data',b=>result.stderr+=b);
  result.completion=new Promise(resolve=>child.on('close',(status,signal)=>{Object.assign(result,{status,signal,done:true});resolve(result)}));return result;
 };
 const until=async predicate=>{const end=Date.now()+15000;while(!predicate()){assert.ok(Date.now()<end,'process barrier timeout: '+children.map(c=>c.stderr).join('\n'));await new Promise(resolve=>setTimeout(resolve,10));}};
 try {
  const a=start('A',`const read=fs.readFileSync,open=fs.openSync;let reads=0;
   fs.readFileSync=function(p,...args){const raw=read.call(this,p,...args);if(String(p).endsWith('/gate.lock')&&++reads===2){mark('A-read');wait('A-resume')}return raw};
   fs.openSync=function(p,...args){if(String(p).includes('/continuations/')){mark('A-entered');wait('finish')}return open.call(this,p,...args)};`);
  await until(()=>fs.existsSync(marker('A-read'))||a.done);assert.equal(a.done,false,a.stderr);
  const b=start('B',`const open=fs.openSync;let paused=false;
   fs.openSync=function(p,...args){if(!paused&&String(p).includes('/continuations/')){paused=true;mark('B-entered');wait('finish')}return open.call(this,p,...args)};`);
  await until(()=>fs.existsSync(marker('B-entered'))||b.done);assert.equal(b.done,false,b.stderr);
  const owner=fs.readFileSync(gate);assert.equal(JSON.parse(owner).pid,b.child.pid);
  put(marker('A-resume'),'');await until(()=>a.done||fs.existsSync(marker('A-entered')));
  assert.equal(fs.existsSync(marker('A-entered')),false,'both initializers entered the critical section');
  rejected(await a.completion,/concurrent initializer lock change|recovery busy|initializer still active/);
  assert.deepEqual(fs.readFileSync(gate),owner,'loser must preserve the live winner lock');
  assert.deepEqual(fs.readFileSync(progress(f)),before);
  put(marker('finish'),'');success(await b.completion);
  const p=read(progress(f)),manifest=read(join(f.root,p.history.manifest));
  assert.deepEqual(p.approvals,{});assert.deepEqual(p.issues,{});
  assert.equal(hash(fs.readFileSync(join(f.root,p.history.manifest))),p.history.sha256);
  assert.equal(hash(fs.readFileSync(join(f.root,p.entrySelection))),manifest.selectionSha256);
  assert.deepEqual(fs.readFileSync(join(f.root,p.history.manifest,'../progress.json')),before);
  for(const entry of manifest.files.entries)assert.equal(hash(fs.readFileSync(join(f.root,p.history.manifest,'../files',entry.path))),entry.sha256);
  assert.deepEqual(tree(join(f.root,'evidence/enterprise/runs')),oldRuns);assert.equal(fs.existsSync(gate),false);
 } finally {
  put(marker('A-resume'),'');put(marker('finish'),'');
  for(const c of children)if(!c.done)c.child.kill('SIGKILL');
  await Promise.all(children.map(c=>c.completion));
 }
});

test('initializer-lock-recovery-interruption-BF-10',async t=>{
 for(const point of ['before-unlink','after-unlink','after-link'])for(const fault of ['EIO','SIGKILL'])await t.test(point+' '+fault,async t=>{
  const f=await continuation(t),before=fs.readFileSync(progress(f)),oldRuns=tree(join(f.root,'evidence/enterprise/runs'));
  const gate=join(f.root,'evidence/enterprise/gate.lock'),dead=spawnSync(process.execPath,['-e','']);assert.equal(dead.status,0);
  put(gate,{kind:'enterprise-run-initialization',pid:dead.pid,runSlug:'new-fixture-run'});
  const statement=fault==='EIO'?"raise OSError('INJECTED_RECOVERY_EIO')":"os.kill(os.getpid(), 9)";
  const anchor=point==='after-link'?'    os.fsync(directory)':'    os.unlink(gate)';
  const replacement=point==='after-unlink'?anchor+'\n    '+statement:'    '+statement+'\n'+anchor;
  const r=injected(f,`import cp from 'node:child_process';const spawn=cp.spawnSync;
   cp.spawnSync=function(command,args,...rest){if(command==='python3'){args=[...args];args[1]=args[1].replace(${JSON.stringify(anchor)},${JSON.stringify(replacement)})}return spawn.call(this,command,args,...rest)};`);
  rejected(r,/initializer recovery failed/);assert.deepEqual(fs.readFileSync(progress(f)),before);
  success(f.cli(init,{readonly:false}));
  const p=read(progress(f)),manifest=read(join(f.root,p.history.manifest));
  assert.deepEqual(p.approvals,{});assert.deepEqual(p.issues,{});
  assert.equal(hash(fs.readFileSync(join(f.root,p.history.manifest))),p.history.sha256);
  for(const entry of manifest.files.entries)assert.equal(hash(fs.readFileSync(join(f.root,p.history.manifest,'../files',entry.path))),entry.sha256);
  assert.deepEqual(tree(join(f.root,'evidence/enterprise/runs')),oldRuns);assert.equal(fs.existsSync(gate),false);
 });
 await t.test('ordinary writer wins recovery publication gap',async t=>{
  const f=await continuation(t),before=fs.readFileSync(progress(f)),gate=join(f.root,'evidence/enterprise/gate.lock');
  const dead=spawnSync(process.execPath,['-e','']);assert.equal(dead.status,0);
  put(gate,{kind:'enterprise-run-initialization',pid:dead.pid,runSlug:'new-fixture-run'});
  const r=injected(f,`import cp from 'node:child_process';const spawn=cp.spawnSync;
   cp.spawnSync=function(command,args,...rest){if(command==='python3'){args=[...args];args[1]=args[1].replace('    os.link(temporary, gate)',"    with open(gate, 'x') as writer: writer.write('ordinary-writer')\\n    os.link(temporary, gate)")}return spawn.call(this,command,args,...rest)};`);
  rejected(r,/FileExistsError/);assert.deepEqual(fs.readFileSync(progress(f)),before);
  assert.equal(fs.readFileSync(gate,'utf8'),'ordinary-writer');
 });
});
