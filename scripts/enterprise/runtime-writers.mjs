// Preparation-only observation of explicitly named regular files. No caller can
// turn an empty descriptor sample into source quiescence or launch authority.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

export function parseOpenDescriptors(result){
 assert.equal(result.signal,null,'writer observation signal');
 assert.ok(!result.error,'writer observation error');
 assert.equal(result.stderr,'','writer observation stderr');
 assert.ok(result.status===0||result.status===1,'writer observation exit');
 assert.equal(typeof result.stdout,'string');
 if(result.status===1){assert.equal(result.stdout,'','ambiguous empty observation');return [];}
 assert.ok(result.stdout.endsWith('\n')&&result.stdout.length>1,'missing descriptor output');
 let pid,entry;const entries=[];
 for(const line of result.stdout.slice(0,-1).split('\n')){
  const field=line[0],value=line.slice(1);
  if(field==='p'){assert.match(value,/^[1-9]\d*$/);pid=Number(value);assert.ok(Number.isSafeInteger(pid));entry=undefined;}
  else if(field==='f'){assert.ok(pid,'descriptor without process');assert.match(value,/^\d+$/,'unsupported descriptor');entry={pid,fd:value};entries.push(entry);}
  else if(field==='a'){assert.ok(entry&&!entry.access,'ambiguous descriptor access');assert.match(value,/^[rwu]$/,'unknown descriptor access');entry.access=value;}
  else assert.fail('unknown descriptor field');
 }
 assert.ok(entries.length,'missing file descriptors');
 assert.ok(entries.every(e=>e.access),'missing descriptor access');
 assert.equal(new Set(entries.map(e=>`${e.pid}:${e.fd}`)).size,entries.length,'duplicate descriptor');
 return entries;
}
const identity=p=>{const s=fs.lstatSync(p,{bigint:true});assert.ok(s.isFile()&&!s.isSymbolicLink(),'regular file required');return {dev:String(s.dev),ino:String(s.ino)};};
export function inspectOpenWriters(paths){
 assert.ok(Array.isArray(paths)&&paths.length>0&&paths.length<=64,'bounded explicit file set required');
 assert.ok(paths.every(p=>typeof p==='string'&&!/[\r\n\0]/.test(p)),'invalid file path');
 const files=paths.map(p=>resolve(p));assert.equal(new Set(files).size,files.length,'duplicate observed file');
 const before=files.map(identity),startedAt=new Date().toISOString(),observations=[];
 for(const [i,file] of files.entries()){
  // Absolute executable, no shell, no inherited locale or lsof option overrides.
  const argv=['-n','-P','-F','pfa','--',file];
  const result=spawnSync('/usr/sbin/lsof',argv,{encoding:'utf8',env:{PATH:'/usr/bin:/bin:/usr/sbin',LC_ALL:'C'},timeout:5000,maxBuffer:1024*1024});
  const descriptors=parseOpenDescriptors(result);
  assert.deepEqual(identity(file),before[i],'observed file replaced');
  observations.push({file,identity:before[i],argv,exitCode:result.status,signal:result.signal,stdout:result.stdout,stderr:result.stderr,descriptors});
 }
 assert.deepEqual(files.map(identity),before,'observed files replaced');
 return {schemaVersion:1,kind:'EXPLICIT_FILE_WRITER_OBSERVATION',startedAt,finishedAt:new Date().toISOString(),observations,
  writers:observations.flatMap(o=>o.descriptors.filter(d=>d.access!=='r').map(d=>({file:o.file,...d}))),
  initializationAuthority:false,launchAuthority:false,exclusiveWriterProven:false,completeProcessInventory:false};
}
export function requireNoObservedWriters(observation){
 // This guard only performs a fresh OS sample. Saved JSON is never accepted.
 assert.ok(Array.isArray(observation),'fresh file paths required');
 const result=inspectOpenWriters(observation);
 assert.equal(result.writers.length,0,'observed file writer remains live');
 return result;
}
