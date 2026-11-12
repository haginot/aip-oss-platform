import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {dirname} from 'node:path';
import {hash,confined,inputs,snapshot,parseTap,validateRun} from './evidence.mjs';
const read=(root,p)=>JSON.parse(readFileSync(confined(root,p)));
function save(root,path,value){const p=confined(root,path);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,JSON.stringify(value,null,2)+'\n');}
export function suitesFor(plan, ids) {
  const suites=new Map();
  for(const id of ids) {
    const issue=plan.issues.find(i=>i.id===id);assert.ok(issue && !issue.children.length,'unknown leaf');
    assert.ok(issue.suites.length,'empty suite');
    for(const suite of issue.suites) {
      // The all-gate is this orchestrator, not a recursively executed test.
      if(suite.id==='complete-machine-gate') continue;
      assert.ok(suite.command?.length && suite.requiredAssertions?.length,'empty suite');
      if(suites.has(suite.id)) assert.deepEqual(suites.get(suite.id),suite,'conflicting suite');
      suites.set(suite.id,suite);
    }
  }
  assert.ok(suites.size,'empty suite');return [...suites.values()];
}
export function execute(root,batchId,suites,implementationSession='TAKT-build-foundation') {
  const id=`${Date.now()}-${randomUUID()}`,directory=`evidence/enterprise/runs/${id}`;
  mkdirSync(confined(root,directory),{recursive:true});
  const indexPath='evidence/enterprise/runs/index.json';
  const index=existsSync(confined(root,indexPath))?read(root,indexPath):{schemaVersion:1,runs:[]};
  const run={schemaVersion:1,id,batchId,implementationSession,startedAt:new Date().toISOString(),status:'running',inputs:inputs(root),suites:[]};
  const receiptPath=`${directory}/receipt.json`;
  index.runs.push({id,batchId,path:receiptPath});save(root,indexPath,index);save(root,receiptPath,run);
  try {
    assert.ok(suites.length,'empty suite');
    for(const [n,suite] of suites.entries()) {
      assert.ok(existsSync(confined(root,suite.path)),`missing suite ${suite.path}`);
      const outputDirectory=`${directory}/suite-${n}`;mkdirSync(confined(root,outputDirectory));
      const stdout=`${outputDirectory}/stdout.tap`,stderr=`${outputDirectory}/stderr.log`;
      const out=openSync(confined(root,stdout),'w'),err=openSync(confined(root,stderr),'w');
      const startedAt=new Date().toISOString();
      process.stdout.write(`[${batchId}/${suite.id}] ${suite.command.join(' ')}\n`);
      let result;
      const env={...process.env,ENTERPRISE_SUITE_OUTPUT:confined(root,`${outputDirectory}/artifacts`)};
      delete env.NODE_TEST_CONTEXT;
      try {result=spawnSync(suite.command[0],suite.command.slice(1),{cwd:root,env,stdio:['ignore',out,err],timeout:suite.timeoutMs??3_600_000});}
      finally {closeSync(out);closeSync(err);}
      const text=readFileSync(confined(root,stdout),'utf8');
      const r={id:suite.id,definitionHash:hash(JSON.stringify(suite)),argv:suite.command,cwd:root,runtime:{node:process.version,executable:process.execPath},startedAt,finishedAt:new Date().toISOString(),exitCode:result.status,signal:result.signal,error:result.error?.message,stdout,stderr,stdoutHash:hash(text),stderrHash:hash(readFileSync(confined(root,stderr))),outputDirectory,outputs:snapshot(root,[outputDirectory]),inputsAfter:inputs(root).digest};
      run.suites.push(r);save(root,receiptPath,run);
      assert.equal(result.status,0,`nonzero exit ${suite.id}: ${result.status}; see ${stderr}`);
      assert.equal(result.signal,null,'signal');assert.ok(!result.error,'subprocess error');
      assert.equal(r.inputsAfter,run.inputs.digest,'changed input during run');
      r.tap=parseTap(text,suite.requiredAssertions);save(root,receiptPath,run);
    }
    run.status='passed';run.finishedAt=new Date().toISOString();validateRun(root,run,suites);
  } catch(error) {run.status='failed';run.error=error.message;run.finishedAt=new Date().toISOString();save(root,receiptPath,run);throw error;}
  save(root,receiptPath,run);return run;
}
