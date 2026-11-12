import {spawnSync} from 'node:child_process';import {mkdirSync,writeFileSync} from 'node:fs';
const suite=process.argv[2],groups={'full-release-regression':[],'clean-bootstrap':['tests/release/bootstrap.test.mjs'],'adapter-replacement':['tests/release/adapter.test.mjs'],'release-operations':['tests/release/operations.test.mjs','tests/release/supply-chain.test.mjs']};if(!groups[suite])throw Error('unknown release suite');
// The expanded enterprise regression already exceeds 29 minutes of cumulative
// test time before the history/containment cases. Use two isolated file workers
// and a finite 55-minute deadline; tests within each file keep their ordering.
// Keep 50 seconds in the controller for report and receipt publication.
const full=suite==='full-release-regression';
const timeoutMs=full?3300000:600000;
const r=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-concurrency='+ (full?2:1),...groups[suite]],{encoding:'utf8',env:{...process.env,...(suite==='adapter-replacement'?{AIP_RELEASE_WRITE_EVIDENCE:'1'}:{})},timeout:timeoutMs,maxBuffer:8e6}),stdout=r.stdout??'',count=n=>Number(stdout.match(new RegExp('^# '+n+' (\\d+)$','m'))?.[1]??0);
const report={suite,node:process.version,finishedAt:new Date().toISOString(),timeoutMs,exitCode:r.status??1,signal:r.signal,error:r.error?{code:r.error.code,message:r.error.message}:null,tests:count('tests'),passed:count('pass'),failed:count('fail'),skipped:count('skipped'),stdout,stderr:r.stderr??'',status:!r.error&&r.signal===null&&r.status===0&&count('tests')>0&&count('skipped')===0?'passed':'failed'};mkdirSync('evidence/generated/release',{recursive:true});writeFileSync(`evidence/generated/release/${suite}.json`,JSON.stringify(report,null,2)+'\n');console.log(`${suite}: ${report.status} ${report.passed}/${report.tests}`);process.exitCode=report.status==='passed'?0:1;
