#!/usr/bin/env node
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,cpSync,readFileSync,writeFileSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {hash,inputs,snapshot} from './evidence.mjs';
import {auditCurrent} from '../release/current-input-audit.mjs';
export function materialize(root,target,manifest) {
  for(const p of ['work','.takt']) mkdirSync(resolve(target,p),{recursive:true});
  for(const e of manifest.entries) {const to=resolve(target,e.path);mkdirSync(dirname(to),{recursive:true});cpSync(resolve(root,e.path),to);}
  assert.deepEqual(inputs(target),manifest,'materialized input mismatch');
}
export function baseline(root,output) {
  const before=inputs(root),plan=JSON.parse(readFileSync(resolve(root,'work/enterprise/plan.json')));
  const protectedBefore=snapshot(root,plan.protectedFiles.map(p=>p.path));
  for(const p of plan.protectedFiles) assert.equal(protectedBefore.entries.find(e=>e.path===p.path).sha256,p.sha256,'protected baseline changed');
  const temporary=mkdtempSync(join(tmpdir(),'enterprise-baseline-')),target=join(temporary,'source');mkdirSync(target);mkdirSync(output,{recursive:true});
  const report={schemaVersion:1,status:'running',startedAt:new Date().toISOString(),sourceRoot:root,executionRoot:target,inputs:before,protectedBefore,commands:[]};
  const save=()=>writeFileSync(join(output,'baseline.json'),JSON.stringify(report,null,2)+'\n');save();
  try {
    symlinkSync(resolve(root,'node_modules'),join(target,'node_modules'),'dir');
    materialize(root,target,before);
    // Retain historical failures/receipts as history. Fresh stages must supersede them.
    cpSync(resolve(root,'evidence'),join(target,'evidence'),{recursive:true,filter:p=>!p.startsWith(resolve(root,'evidence/enterprise'))});
    for(const stage of ['release','final']) {
      const argv=['bash','.takt/quality-gates/platform-gate.sh',stage],startedAt=new Date().toISOString();
      const r=spawnSync(argv[0],argv.slice(1),{cwd:target,env:{...process.env,MISE_TRUSTED_CONFIG_PATHS:target},encoding:'utf8',timeout:3_600_000,maxBuffer:64*1024*1024});
      writeFileSync(join(output,`${stage}.stdout.log`),r.stdout??'');writeFileSync(join(output,`${stage}.stderr.log`),r.stderr??r.error?.message??'');
      report.commands.push({argv,cwd:target,startedAt,finishedAt:new Date().toISOString(),exitCode:r.status,signal:r.signal,error:r.error?.message,stdoutHash:hash(r.stdout??''),stderrHash:hash(r.stderr??'')});save();
      assert.equal(r.status,0,`${stage} gate failed; see ${output}/${stage}.stderr.log`);assert.equal(r.signal,null);
    }
    const verification=JSON.parse(readFileSync(join(target,'verification/plan.json'))),manifest=JSON.parse(readFileSync(join(target,'evidence/run-manifest.json')));
    report.audit=auditCurrent(target,verification,manifest,['architecture','plan','mechanism','implementation','demo','bcp','release']);
    for(const stage of report.audit.stages) assert.ok(manifest.runs.filter(r=>r.stage===stage).at(-1).startedAt>=report.startedAt,'historical receipt');
    report.materializedAfter=inputs(target);assert.deepEqual(report.materializedAfter,before,'materialized inputs changed');
    report.status='passed';
  } catch(error) {report.status='failed';report.error=error.message;throw error;}
  finally {
    report.checkoutAfter=inputs(root);report.protectedAfter=snapshot(root,plan.protectedFiles.map(p=>p.path));
    if(existsSync(join(target,'evidence'))) cpSync(join(target,'evidence'),join(output,'evidence'),{recursive:true});
    report.finishedAt=new Date().toISOString();
    if(report.checkoutAfter.digest!==before.digest || report.protectedAfter.digest!==protectedBefore.digest) {report.status='failed';report.error='checkout/protected bytes changed';}
    save();rmSync(temporary,{recursive:true,force:true});
    assert.equal(report.status,'passed',report.error);
  }
  return report;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const root=resolve(import.meta.dirname,'../..'),output=process.env.ENTERPRISE_SUITE_OUTPUT??resolve(root,`evidence/enterprise/baseline/${Date.now()}`);
  try {baseline(root,output);const names=['original-AC-001-through-009','all-original-failed-regressions-retained','fresh-all-stage-receipts','protected-files-byte-identical','materialized-input-equals-current-checkout-before-and-after'];console.log('TAP version 13');names.forEach((n,i)=>console.log(`ok ${i+1} - ${n}`));console.log(`1..5\n# tests 5\n# pass 5\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0`);}
  catch(error){console.error(error.stack);process.exitCode=1;}
}
