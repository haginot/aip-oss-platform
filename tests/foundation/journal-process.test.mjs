import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
const script=new URL('../../scripts/foundation/journal-process.mjs',import.meta.url);
function child(path,phase) {return fork(script,[path,phase],{stdio:['ignore','ignore','pipe','ipc']});}
async function message(p) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{p.kill('SIGKILL');reject(Error('journal child timed out'));},5000);
    p.once('message',value=>{clearTimeout(timer);resolve(value);});
    p.once('error',error=>{clearTimeout(timer);reject(error);});
    p.once('exit',(code,signal)=>{clearTimeout(timer);reject(Error(`journal child exited before observation: ${code}/${signal}`));});
  });
}
test('fsynced INTENT and COMMITTED survive actual SIGKILL and new process reopen',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'aip-journal-process-'));
  let writer,reader;
  try {
    for(const phase of ['INTENT','COMMITTED']) {
      const path=join(directory,phase,'journal.ndjson');
      writer=child(path,phase);const durable=await message(writer);assert.equal(durable.durable,phase);
      const exit=once(writer,'exit');writer.kill('SIGKILL');assert.deepEqual(await exit,[null,'SIGKILL']);
      reader=child(path,'inspect');const done=once(reader,'exit');const observed=await message(reader);
      assert.deepEqual(observed,{phase,fenced:phase==='INTENT',committed:phase==='COMMITTED',count:phase==='INTENT'?1:2});
      assert.deepEqual(await done,[0,null]);
    }
  } finally {writer?.kill('SIGKILL');reader?.kill('SIGKILL');rmSync(directory,{recursive:true,force:true});}
});
