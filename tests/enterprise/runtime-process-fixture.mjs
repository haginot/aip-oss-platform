// Real command gate process groups and disk writers; no business or model calls.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCommandQualityGate} from '../../node_modules/takt/dist/core/workflow/quality-gates/commandGateRunner.js';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
export async function processFixture(t){
 const base=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'enterprise-process-'))),observations=[];
 // Each child has its own 8-second safety fuse. Failure cleanup only targets
 // these synthetic PIDs, never a live TAKT worker or an unobserved process.
 for(const mode of ['normal','nonzero','timeout','resistant'])await t.test('official gate child writer '+mode,async()=>{
  const root=join(base,mode);fs.mkdirSync(root);
  const child=`import fs from 'node:fs';
const mode=${JSON.stringify(mode)},file='heartbeat.jsonl';
fs.writeFileSync('child.json',JSON.stringify({pid:process.pid,ppid:process.ppid}));
if(mode==='resistant')process.on('SIGTERM',()=>fs.appendFileSync('signals.txt','SIGTERM\\n'));
fs.appendFileSync(file,'ready\\n');const timer=setInterval(()=>fs.appendFileSync(file,'tick\\n'),20);
setTimeout(()=>{clearInterval(timer);process.exit(88);},8000);
if(mode==='normal'||mode==='nonzero')setTimeout(()=>{clearInterval(timer);process.exit(mode==='normal'?0:19);},150);
`;
  const parent=`import fs from 'node:fs';import {spawn} from 'node:child_process';
fs.writeFileSync('parent.json',JSON.stringify({pid:process.pid,ppid:process.ppid}));
${mode==='resistant'?"process.on('SIGTERM',()=>fs.appendFileSync('parent-signals.txt','SIGTERM\\n'));":''}
const p=spawn(process.execPath,['child.mjs'],{stdio:'inherit'});p.on('exit',(code,signal)=>{if(signal)process.exit(70);else process.exit(code);});
`;
  fs.writeFileSync(join(root,'child.mjs'),child);fs.writeFileSync(join(root,'parent.mjs'),parent);
  let result,record;
  try{
   const started=Date.now();result=await runCommandQualityGate({projectRoot:root,gate:{name:'child-writer-'+mode,type:'command',command:quote(process.execPath)+' parent.mjs',cwd:'.',timeoutMs:1500}});
   const returned=Date.now(),p=JSON.parse(fs.readFileSync(join(root,'parent.json'))),c=JSON.parse(fs.readFileSync(join(root,'child.json')));
   assert.equal(c.ppid,p.pid,'writer must be a real gate descendant');
   // A successful return is not sufficient: inspect the observed processes
   // and require a stable file after the command runner has settled.
   const deadline=Date.now()+1500;while((alive(p.pid)||alive(c.pid))&&Date.now()<deadline)await sleep(20);
   assert.equal(alive(p.pid),false,'parent remains live');assert.equal(alive(c.pid),false,'child writer remains live');
   const file=join(root,'heartbeat.jsonl'),raw=fs.readFileSync(file),mtime=String(fs.statSync(file,{bigint:true}).mtimeNs);
   assert.match(raw.toString(),/^ready\n/);await sleep(120);assert.deepEqual(fs.readFileSync(file),raw,'write after gate settled');assert.equal(String(fs.statSync(file,{bigint:true}).mtimeNs),mtime);
   if(mode==='normal')assert.equal(result.ok,true);
   else{assert.equal(result.ok,false);assert.equal(result.failure.timedOut,['timeout','resistant'].includes(mode));if(mode==='nonzero')assert.equal(result.failure.exitCode,19);else{assert.equal(result.failure.timeoutMs,1500);assert.ok(returned-started<6000,'safety fuse is not a timeout proof');}}
   if(mode==='resistant'){assert.match(fs.readFileSync(join(root,'signals.txt'),'utf8'),/SIGTERM/);assert.match(fs.readFileSync(join(root,'parent-signals.txt'),'utf8'),/SIGTERM/);}
   record={mode,result,parent:p,child:c,startedAt:new Date(started).toISOString(),returnedAt:new Date(returned).toISOString(),elapsedMs:returned-started,heartbeatBytes:raw.length,heartbeatMtimeNs:mtime,writerStopped:true,stableAfterReturnMs:120,initializationAuthority:false};observations.push(record);
  }finally{
   // Preserve the actual result before cleanup, even if an assertion failed.
   fs.writeFileSync(join(root,'result.json'),JSON.stringify(record??{mode,result,failed:true},null,2)+'\n');
   for(const name of ['child.json','parent.json'])if(fs.existsSync(join(root,name))){const {pid}=JSON.parse(fs.readFileSync(join(root,name)));if(alive(pid))try{process.kill(pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}}
   if(process.env.ENTERPRISE_SUITE_OUTPUT)fs.cpSync(root,join(process.env.ENTERPRISE_SUITE_OUTPUT,'gate-processes',mode),{recursive:true});
  }
 });
 await t.test('successful gate is not proof of detached writer quiescence',async()=>{
  const root=join(base,'detached');fs.mkdirSync(root);
  fs.writeFileSync(join(root,'child.mjs'),"import fs from 'node:fs';fs.writeFileSync('child.json',JSON.stringify({pid:process.pid}));fs.appendFileSync('heartbeat','ready\\n');setInterval(()=>fs.appendFileSync('heartbeat','tick\\n'),20);setTimeout(()=>process.exit(88),8000);");
  fs.writeFileSync(join(root,'parent.mjs'),"import fs from 'node:fs';import {spawn} from 'node:child_process';const p=spawn(process.execPath,['child.mjs'],{detached:true,stdio:'ignore'});p.unref();const deadline=Date.now()+1000;while(!fs.existsSync('heartbeat')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));if(!fs.existsSync('heartbeat'))process.exit(71);");
  let record,pid;
  try{
   const r=await runCommandQualityGate({projectRoot:root,gate:{type:'command',name:'detached',command:quote(process.execPath)+' parent.mjs',cwd:'.',timeoutMs:1500}});
   pid=JSON.parse(fs.readFileSync(join(root,'child.json'))).pid;assert.equal(r.ok,true);assert.equal(alive(pid),true,'counterexample requires a live writer');
   const first=fs.readFileSync(join(root,'heartbeat'));await sleep(120);const later=fs.readFileSync(join(root,'heartbeat'));assert.ok(later.length>first.length,'counterexample must perform a post-return write');
   record={mode:'detached',result:r,pid,writerStoppedAtGateReturn:false,heartbeatBytesAtReturn:first.length,heartbeatBytesLater:later.length,initializationAuthority:false};observations.push(record);
  }finally{
   if(pid&&alive(pid))process.kill(pid,'SIGKILL');
   const deadline=Date.now()+1500;while(pid&&alive(pid)&&Date.now()<deadline)await sleep(20);if(pid)assert.equal(alive(pid),false,'synthetic detached writer cleanup');
   fs.writeFileSync(join(root,'result.json'),JSON.stringify({...record,cleanupConfirmed:pid!==undefined&&!alive(pid)},null,2)+'\n');
   if(process.env.ENTERPRISE_SUITE_OUTPUT)fs.cpSync(root,join(process.env.ENTERPRISE_SUITE_OUTPUT,'gate-processes','detached'),{recursive:true});
  }
 });
 await t.test('official gate refuses escaped cwd before spawning writer',async()=>{
  const root=join(base,'escape');fs.mkdirSync(root);const outside=join(base,'outside');fs.mkdirSync(outside);
  fs.writeFileSync(join(outside,'write.mjs'),"import fs from 'node:fs';fs.writeFileSync('forbidden','write');");
  const r=await runCommandQualityGate({projectRoot:root,gate:{type:'command',name:'escape',command:quote(process.execPath)+' write.mjs',cwd:outside,timeoutMs:1500}});
  assert.equal(r.ok,false);assert.match(r.failure.stderr,/cwd must stay inside/);assert.equal(fs.existsSync(join(outside,'forbidden')),false);
  observations.push({mode:'escape',result:r,writerStarted:false});
 });
 if(process.env.ENTERPRISE_SUITE_OUTPUT)fs.writeFileSync(join(process.env.ENTERPRISE_SUITE_OUTPUT,'gate-processes','summary.json'),JSON.stringify({observations,productApproval:false,initializationAuthority:false},null,2)+'\n');
 fs.rmSync(base,{recursive:true,force:true});
}
