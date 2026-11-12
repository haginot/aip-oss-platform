// Mutations below affect only stopped synthetic launcher runs, never live state.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {inspectTerminalRun} from '../../scripts/enterprise/runtime-terminal.mjs';
import {tree} from './evidence-fixture.mjs';
async function readonly(operation){
 const saved=[],patch=(o,k,v)=>{if(typeof o[k]==='function'){saved.push([o,k,o[k]]);o[k]=v;}};
 const deny=k=>()=>{throw Error('FS_MUTATION:'+k);};
 for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])patch(cp,k,deny(k));
 for(const k of ['appendFile','chmod','chown','copyFile','cp','fchmod','fchown','ftruncate','futimes','link','lchmod','lchown','lutimes','mkdir','mkdtemp','rename','rm','rmdir','symlink','truncate','unlink','utimes','write','writev','writeFile']){
  for(const key of [k,k+'Sync'])patch(fs,key,deny(key));patch(fs.promises,k,deny(k));
 }
 patch(fs,'createWriteStream',deny('createWriteStream'));
 for(const [o,k] of [[fs,'open'],[fs,'openSync'],[fs.promises,'open']]){const original=o[k];patch(o,k,function(p,flags,...args){assert.ok(typeof flags==='number'?(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND))===0:flags===undefined||flags==='r','FS_MUTATION:open');return original.call(this,p,flags,...args);});}
 syncBuiltinESMExports();try{return await operation();}finally{for(const [o,k,v] of saved.reverse())o[k]=v;syncBuiltinESMExports();}
}
export async function terminalCases(root,global,completed,failed){
 const cases=[],observe=slug=>inspectTerminalRun(root,slug);
 const positive=await readonly(()=>observe(completed.context.identity.runSlug)),negative=await readonly(()=>observe(failed.context.identity.runSlug));
 assert.equal(positive.runStatus,'completed');assert.equal(negative.terminalRecord.type,'workflow_abort');assert.match(negative.terminalRecord.reason,/Max steps reached/);
 for(const v of [positive,negative])for(const key of ['launchAuthority','initializationAuthority','sourceProcessExitProven','exclusiveWriterProven','enqueueExclusionProven'])assert.equal(v[key],false);
 cases.push('completed and real limit-aborted engine publications match ledger without authority');
 const slug=positive.sourceRunSlug,metaPath=completed.context.identity.runRoot+'/meta.json',logPath=completed.context.identity.logPath;
 const metaRaw=fs.readFileSync(metaPath),logRaw=fs.readFileSync(logPath),meta=JSON.parse(metaRaw),records=logRaw.toString().trim().split('\n').map(JSON.parse);
 const check=async()=>{const before=tree(global);try{return await readonly(()=>observe(slug));}finally{assert.deepEqual(tree(global),before,'observation wrote central state');}};
 await check();cases.push('terminal success preserves central files and mtimes');
 for(const [name,change,pattern] of [
  ['running metadata',m=>m.status='running',/metadata not terminal/],
  ['ledger metadata disagreement',m=>m.status='failed',/terminal disagree/],
  ['wrong task',m=>m.task='other task',/task mapping/],
  ['wrong run',m=>m.runSlug='other-run',/run mapping/],
  ['wrong workflow',m=>m.workflow='other',/workflow mapping/],
  ['escaped log path',m=>m.logsDirectory='/tmp',/path mapping/],
  ['missing end time',m=>delete m.endTime,/timestamp required/],
  ['reversed times',m=>m.endTime='2000-01-01T00:00:00.000Z',/time order/],
  ['changed iteration',m=>m.iterations++,/publication iterations/]
 ]){const changed=structuredClone(meta);change(changed);fs.writeFileSync(metaPath,JSON.stringify(changed));try{await assert.rejects(check(),e=>{assert.doesNotMatch(e.message,/FS_MUTATION/);assert.match(e.message,pattern);return true;});cases.push(name+' rejected');}finally{fs.writeFileSync(metaPath,metaRaw);}}
 for(const [name,change,pattern] of [
  ['missing terminal',r=>r.pop(),/unique terminal publication/],
  ['duplicate terminal',r=>r.push({...r.at(-1)}),/unique terminal publication/],
  ['activity after terminal',r=>r.push({...r[1]}),/must be last/],
  ['mismatched log identity',r=>r[0].task='other',/log task/],
  ['wrong terminal status',r=>r.at(-1).type='workflow_abort',/publication status/],
  ['wrong terminal time',r=>r.at(-1).endTime='2000-01-01T00:00:00Z',/publication time/],
  ['wrong workflow reference',r=>r.find(x=>x.type==='step_start').stack[0].workflow_ref='project:sha256:'+'0'.repeat(64),/workflow reference/]
 ]){const changed=structuredClone(records);change(changed);fs.writeFileSync(logPath,changed.map(x=>JSON.stringify(x)).join('\n')+'\n');try{await assert.rejects(check(),e=>{assert.doesNotMatch(e.message,/FS_MUTATION/);assert.match(e.message,pattern);return true;});cases.push(name+' rejected');}finally{fs.writeFileSync(logPath,logRaw);}}
 fs.writeFileSync(logPath,logRaw.subarray(0,-1));try{await assert.rejects(check(),/unterminated terminal log/);cases.push('unterminated log rejected');}finally{fs.writeFileSync(logPath,logRaw);}
 fs.renameSync(logPath,logPath+'.original');fs.symlinkSync(logPath+'.original',logPath);try{await assert.rejects(check(),/file alias/);cases.push('symlink log rejected');}finally{fs.unlinkSync(logPath);fs.renameSync(logPath+'.original',logPath);}
 fs.writeFileSync(logPath+'.extra.jsonl',logRaw);try{await assert.rejects(check(),/ambiguous terminal log/);cases.push('multiple logs rejected');}finally{fs.unlinkSync(logPath+'.extra.jsonl');}
 await assert.rejects(observe({...positive}),/source run locator/);cases.push('saved diagnostic rejected as fresh run locator');
 const after=await check();assert.deepEqual(after.references,positive.references);return {positive,negative,cases,syntheticOnly:true};
}
