import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,put,read} from './evidence-fixture.mjs';

const progressPath='work/enterprise/progress.json';
function rejected(f,args,pattern){
 const before=readFileSync(join(f.root,progressPath));
 const result=f.cli(args,{readonly:false});
 assert.equal(result.status,1,result.stdout);assert.match(result.stderr,pattern);
 assert.deepEqual(readFileSync(join(f.root,progressPath)),before);
 assert.ok(!result.stdout.includes('[B'),'no suite executes on rejection');
}
test('AR4-N01 planned suffixed batch IDs use authenticated selection and resume',async t=>{
 for(const id of ['B05A','B05B','B21A','B21B','B21C','B21D','B21E'])await t.test(id,async t=>{
  const f=await fixture(t,{seal:false});
  const path=join(f.root,'work/enterprise/plan.json'),plan=read(path);
  plan.batches[0].id=id;plan.issues[0].batchId=id;put(path,plan);
  put(join(f.root,progressPath),{schemaVersion:1,activeBatchId:null,issues:{},approvals:{},runBinding:read(join(f.root,progressPath)).runBinding});
  f.context('build-foundation',1);
  const selected=f.cli(['batch','--batch',id],{readonly:false});assert.equal(selected.status,0,selected.stderr);
  const p=read(join(f.root,progressPath));assert.equal(p.activeBatchId,id);
  assert.equal(read(join(f.root,p.entrySelection)).batchId,id);
  const resumed=f.cli(['batch','--batch',id,'--validate-only'],{readonly:false});assert.equal(resumed.status,0,resumed.stderr);
 });
});
test('AR4-N01 unknown IDs and skipped predecessors cannot select a batch',async t=>{
 const f=await fixture(t,{seal:false});f.context('build-foundation',1);
 const planPath=join(f.root,'work/enterprise/plan.json'),plan=read(planPath);
 const next={...plan.issues[0],id:'ENT-706',batchId:'B05A',acceptanceTests:[{id:'ENT-706/AC-01'}]};
 plan.issues.push(next);plan.issues.find(i=>i.id==='ENT-700').children.push(next.id);
 plan.batches.push({...plan.batches[0],id:'B05A',issueIds:[next.id],dependsOnBatches:['B00']});put(planPath,plan);
 const backlogPath=join(f.root,'work/enterprise/backlog.json'),backlog=read(backlogPath);
 backlog.items.push({id:next.id,parent:next.parent,children:next.children,dependsOn:next.dependsOn,acceptance:next.originalAcceptance});
 backlog.items.find(i=>i.id==='ENT-700').children.push(next.id);put(backlogPath,backlog);
 const empty={schemaVersion:1,activeBatchId:null,issues:{},approvals:{},runBinding:read(join(f.root,progressPath)).runBinding};put(join(f.root,progressPath),empty);
 rejected(f,['batch','--batch','B99Z'],/unknown batch/);
 rejected(f,['batch','--batch','B05A'],/not earliest pending batch/);
 put(join(f.root,progressPath),{...empty,approvals:{B00:{}}});
 rejected(f,['batch','--batch','B05A'],/missing run|ENOENT|independent approval/);
 put(join(f.root,progressPath),{...empty,activeBatchId:'B00'});
 rejected(f,['batch','--batch','B05A'],/active batch swap/);
});
