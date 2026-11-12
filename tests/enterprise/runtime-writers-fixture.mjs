import fs from 'node:fs';import assert from 'node:assert/strict';import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {inspectOpenWriters,requireNoObservedWriters,parseOpenDescriptors} from '../../scripts/enterprise/runtime-writers.mjs';
export async function writersFixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'enterprise-writers-'))),file=join(root,'protected'),results=[];
 fs.writeFileSync(file,'synthetic');
 const script=join(root,'child.mjs');fs.writeFileSync(script,"import fs from 'node:fs';const fd=fs.openSync(process.argv[2],process.argv[3]);if(process.argv[3]!=='r')setInterval(()=>fs.writeSync(fd,'tick\\n'),20);process.send({pid:process.pid});setTimeout(()=>process.exit(0),8000);");
 const snapshot=()=>fs.readdirSync(root).map(p=>{const s=fs.statSync(join(root,p),{bigint:true});return {p,raw:fs.readFileSync(join(root,p)),mtime:String(s.mtimeNs)};});
 await t.test('fresh empty descriptor observation has no launch authority',()=>{const before=snapshot(),r=requireNoObservedWriters([file]);assert.equal(r.writers.length,0);assert.equal(r.launchAuthority,false);assert.equal(r.exclusiveWriterProven,false);assert.deepEqual(snapshot(),before);results.push(r);});
 for(const mode of ['r','a'])await t.test(mode==='r'?'readonly descriptor is not a writer':'detached writer outside ancestry blocks observed-file guard',async()=>{
  const child=spawn(process.execPath,[script,file,mode],{cwd:tmpdir(),detached:true,stdio:['ignore','ignore','ignore','ipc']});const done=once(child,'exit');
  try{
   const [ready]=await once(child,'message');assert.equal(ready.pid,child.pid);
   const before=mode==='r'?snapshot():null,r=inspectOpenWriters([file]);assert.ok(r.observations[0].descriptors.some(d=>d.pid===child.pid));
   if(mode==='r'){assert.equal(r.writers.length,0);requireNoObservedWriters([file]);assert.deepEqual(snapshot(),before);}
   else{assert.ok(r.writers.some(d=>d.pid===child.pid));assert.throws(()=>requireNoObservedWriters([file]),/writer remains live/);}
   results.push(r);
  }finally{child.kill('SIGKILL');await done;}
  const r=requireNoObservedWriters([file]);assert.equal(r.writers.length,0);results.push(r);
 });
 const good={status:0,signal:null,stdout:'p123\nf4\naw\n',stderr:''};
 for(const [name,patch,pattern] of [
  ['nonzero exit',{status:2},/observation exit/],['timeout error',{error:{code:'ETIMEDOUT'}},/observation error/],['signal',{signal:'SIGTERM'},/observation signal/],['partial permission failure',{stderr:'permission denied'},/observation stderr/],['partial output on exit one',{status:1},/ambiguous empty/],['missing access',{stdout:'p123\nf4\n'},/missing descriptor access/],['unknown access',{stdout:'p123\nf4\na?\n'},/unknown descriptor access/],['duplicate descriptor',{stdout:'p123\nf4\naw\nf4\naw\n'},/duplicate descriptor/],['unknown field',{stdout:'p123\nxanything\n'},/unknown descriptor field/]
 ])await t.test('reject '+name,()=>assert.throws(()=>parseOpenDescriptors({...good,...patch}),pattern));
 await t.test('reject omitted duplicate symlink and missing file sets',()=>{
  assert.throws(()=>inspectOpenWriters([]),/explicit file set/);assert.throws(()=>inspectOpenWriters([file,file]),/duplicate observed/);
  fs.symlinkSync(file,join(root,'link'));assert.throws(()=>inspectOpenWriters([join(root,'link')]),/regular file/);assert.throws(()=>inspectOpenWriters([join(root,'missing')]),/ENOENT/);
 });
 await t.test('saved diagnostic cannot be replayed as a fresh guard',()=>assert.throws(()=>requireNoObservedWriters(results[0]),/fresh file paths/));
 if(process.env.ENTERPRISE_SUITE_OUTPUT){const out=join(process.env.ENTERPRISE_SUITE_OUTPUT,'open-writers');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(join(out,'result.json'),JSON.stringify({results,initializationAuthority:false,launchAuthority:false},null,2)+'\n');}
 fs.rmSync(root,{recursive:true,force:true});
}
