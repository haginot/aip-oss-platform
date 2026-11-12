import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readdirSync,readFileSync,realpathSync} from 'node:fs';
import {resolve,relative,sep,isAbsolute} from 'node:path';
import {runtimeIdentity} from './runtime.mjs';

export const hash = value => createHash('sha256').update(value).digest('hex');
export function validatePlan(root,plan,catalog) {
  assert.deepEqual(plan.issues.map(i=>i.id).sort(),catalog.items.map(i=>i.id).sort(),'scope changed: revise architecture/plan and obtain independent review');
  for(const item of catalog.items) {
    const issue=plan.issues.find(i=>i.id===item.id);
    assert.deepEqual(issue.originalAcceptance,item.acceptance,`changed acceptance ${item.id}`);
    for(const field of ['parent','children','dependsOn']) assert.deepEqual(issue[field],item[field],`changed ${field} ${item.id}`);
    assert.equal(hash(readFileSync(confined(root,issue.sourceSpec))),issue.sourceSpecSha256,`stale Issue specification ${item.id}`);
  }
  for(const source of plan.sourceSnapshots) assert.equal(hash(readFileSync(confined(root,source.path))),source.sha256,`stale architecture input ${source.path}`);
  return true;
}
export function confined(root, path) {
  assert.equal(typeof path,'string','path required');
  assert.ok(path && !isAbsolute(path) && !path.split(/[\\/]/).includes('..'),'path escape');
  const base=realpathSync(root), target=resolve(base,path);
  assert.ok(target.startsWith(base+sep),'path escape');
  let current=base;
  for(const component of relative(base,target).split(sep)) {
    current=resolve(current,component);
    if(existsSync(current)) assert.ok(!lstatSync(current).isSymbolicLink(),'symlink path escape');
  }
  return target;
}
export function snapshot(root, paths) {
  const entries=[];
  function visit(path) {
    const absolute=confined(root,path), stat=lstatSync(absolute);
    assert.ok(!stat.isSymbolicLink(),'symlink path escape');
    if(stat.isDirectory()) for(const name of readdirSync(absolute).sort()) visit(`${path}/${name}`);
    else {assert.ok(stat.isFile(),'regular file required');entries.push({path,sha256:hash(readFileSync(absolute)),bytes:stat.size});}
  }
  paths.forEach(visit);
  const unique=[...new Map(entries.map(e=>[e.path,e])).values()].sort((a,b)=>a.path.localeCompare(b.path,'en'));
  return {digest:hash(JSON.stringify(unique)),entries:unique};
}
// Explicit authored roots; generated evidence and mutable review/progress are separate layers.
// Unknown top-level authored files are included too. Runtime caches are never source inputs.
export function inputs(root) {
  const excluded=new Set(['.git','node_modules','.cache','.release-runtime','evidence','work','.takt','coverage','dist','build']);
  const paths=readdirSync(root).filter(p=>!excluded.has(p));
  function authored(path) {
    for(const name of readdirSync(confined(root,path))) {
      const p=`${path}/${name}`;
      if(['runs','worktrees','logs','persona_sessions.json'].includes(name)) continue;
      if(p==='work/enterprise/progress.json') continue;
      if(lstatSync(confined(root,p)).isDirectory()) authored(p); else paths.push(p);
    }
  }
  authored('work');authored('.takt');
  paths.push('evidence/FAILURES.md','evidence/ACCEPTANCE_MATRIX.md');
  const result=snapshot(root,paths);
  if(existsSync(resolve(root,'node_modules/takt/package.json'))) {
    const runtime=runtimeIdentity(root);
    return {...result,runtime,digest:hash(JSON.stringify({entries:result.entries,runtime}))};
  }
  return result;
}
export function parseTap(stdout, required=[]) {
  const count=name=>Number(stdout.match(new RegExp(`^# ${name} (\\d+)$`,'m'))?.[1]??NaN);
  const tests=count('tests'),passed=count('pass');
  assert.ok(tests>0 && passed===tests,'zero assertions or incomplete TAP');
  for(const name of ['fail','cancelled','skipped','todo']) assert.equal(count(name),0,`TAP ${name}`);
  assert.ok(!/^\s*not ok\b/m.test(stdout) && !/^\s*ok \d+[^\n]*# (?:SKIP|TODO)\b/im.test(stdout),'failed/skip TAP');
  const assertions=[...stdout.matchAll(/^\s*ok \d+ - (.+)$/gm)].map(m=>m[1]);
  assert.ok(assertions.length>=tests,'missing TAP assertions');
  for(const name of required) assert.ok(assertions.some(a=>a===name || a.startsWith(name+' ')),`missing assertion: ${name}`);
  return {tests,passed,assertions};
}
export function validateRun(root, run, suites) {
  assert.equal(run.status,'passed','latest run failed or running');
  assert.equal(run.inputs.digest,inputs(root).digest,'stale source/config/test/plan');
  assert.deepEqual(run.inputs,inputs(root),'changed input manifest');
  return validateRunEvidence(root,run,suites);
}
// Historical evidence is usable only as an authenticated entry prerequisite,
// never as current machine evidence. Keep the public current-run check strict.
export async function validateReviewedRun(root,run,suites,approval,issueIds) {
  await validateApproval(root,approval,run,issueIds);
  return validateRunEvidence(root,run,suites);
}
export function validateRunEvidence(root,run,suites) {
  assert.equal(run.status,'passed','latest run failed or running');
  assert.ok(suites.length,'empty suite');
  assert.equal(run.suites.length,suites.length,'missing suite');
  for(const suite of suites) {
    const receipt=run.suites.find(s=>s.id===suite.id);
    assert.ok(receipt,'missing suite');assert.equal(receipt.definitionHash,hash(JSON.stringify(suite)),'stale suite definition');
    assert.equal(receipt.exitCode,0,'nonzero exit');assert.equal(receipt.signal,null,'signal');assert.ok(!receipt.error,'subprocess error');
    assert.deepEqual(receipt.argv,suite.command,'changed argv');
    assert.ok(receipt.finishedAt && receipt.startedAt && receipt.cwd && receipt.runtime,'execution metadata missing');
    assert.equal(receipt.inputsAfter,run.inputs.digest,'changed input during run');
    const out=readFileSync(confined(root,receipt.stdout),'utf8'),err=readFileSync(confined(root,receipt.stderr));
    assert.equal(hash(out),receipt.stdoutHash,'changed output');assert.equal(hash(err),receipt.stderrHash,'changed stderr');
    assert.deepEqual(parseTap(out,suite.requiredAssertions),receipt.tap,'forged status/assertions');
    assert.deepEqual(snapshot(root,[receipt.outputDirectory]),receipt.outputs,'changed output artifacts');
  }
  return run;
}
export function validateLatest(root, batchId, suites) {
  const index=JSON.parse(readFileSync(confined(root,'evidence/enterprise/runs/index.json')));
  const latest=index.runs.filter(r=>r.batchId===batchId).at(-1);assert.ok(latest,'missing suite run');
  const run=JSON.parse(readFileSync(confined(root,latest.path)));
  assert.equal(run.id,latest.id);assert.equal(run.batchId,batchId);return validateRun(root,run,suites);
}
export async function validateApproval(root, approval, run, issueIds) {
  assert.equal(approval?.verdict,'APPROVE','independent approval required');
  assert.ok(approval.session && approval.session!==run.implementationSession,'separate reviewer session required');
  assert.equal(approval.inputsDigest,run.inputs.digest,'stale review source');
  assert.equal(approval.receiptHash,hash(JSON.stringify(run)),'stale review receipt');
  assert.deepEqual([...approval.issueIds].sort(),[...issueIds].sort(),'review scope');
  assert.equal(hash(readFileSync(confined(root,approval.report))),approval.reportHash,'changed review report');
  if(approval.closure) {
    const {validateClosureApproval}=await import('./closure.mjs');
    await validateClosureApproval(root,approval,run,issueIds);
  } else {
    const {validateBatchReview}=await import('./approval.mjs');
    await validateBatchReview(root,approval,run,issueIds);
  }
  return true;
}
