import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const groups={
 'worker-authority-expiry-foundation':['tests/foundation/worker-authority-expiry.test.mjs'],
 'authentication-expiry-foundation':['tests/foundation/authentication-expiry.test.mjs'],
 'deadlines-foundation':['tests/foundation/deadlines.test.mjs'],
 'publication-objects-foundation':['tests/foundation/publication-objects.test.mjs'],
 'authoring-concurrency-foundation':['tests/foundation/authoring-concurrency.test.mjs'],
 'review-regressions-foundation':['tests/foundation/review-regressions.test.mjs'],
 'pipeline-foundation':['tests/foundation/pipeline.test.mjs'],
 'data-services-foundation':['tests/foundation/data-services.test.mjs'],
 'trigger-foundation':['tests/foundation/trigger.test.mjs'],
 'boundary-foundation':['tests/foundation/boundaries.test.mjs'],
 'ingestion-foundation':['tests/foundation/ingestion.test.mjs'],
 'operations-foundation':['tests/foundation/operations.test.mjs'],
 'foundation-local-contracts':['tests/foundation/gate.test.mjs','tests/foundation/contracts.test.mjs','tests/foundation/client.test.mjs','tests/foundation/client-types.test.mjs','tests/foundation/journal-process.test.mjs'],
 'kernel-contracts':['tests/foundation/contracts.test.mjs','tests/foundation/client.test.mjs','tests/foundation/kernel.test.mjs','tests/foundation/history.test.mjs'],
 'authorization-delegation':['tests/foundation/security.test.mjs'],
 'definition-lifecycle':['tests/foundation/client.test.mjs','tests/foundation/client-types.test.mjs','tests/foundation/definitions.test.mjs','tests/foundation/programs.test.mjs','tests/foundation/authoring.test.mjs'],
 'recovery-journal-foundation':['tests/foundation/contracts.test.mjs','tests/foundation/journal-process.test.mjs','tests/foundation/kernel.test.mjs'],
 'foundation-bootstrap':['tests/foundation/bootstrap.test.mjs'],
 'retrieval-comparison-foundation':['tests/foundation/retrieval.test.mjs'],
 'writeback-foundation':['tests/foundation/writeback.test.mjs'],
 'retention-foundation':['tests/foundation/retention.test.mjs'],
 'secrets-foundation':['tests/foundation/secrets.test.mjs'],
 'process-volume-foundation':['tests/foundation/kernel-process.test.mjs','tests/foundation/volumes.test.mjs'],
};
const suite=process.argv[2];if(!groups[suite])throw Error('unknown suite');
const output=resolve('evidence/generated/foundation',suite+'.json');mkdirSync(resolve('evidence/generated/foundation'),{recursive:true});
const startedAt=new Date().toISOString();
const result=spawnSync(process.execPath,['--test','--test-reporter=tap',...groups[suite]],{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
const stdout=result.stdout??'',stderr=result.stderr??'';
const count=name=>Number(stdout.match(new RegExp('^# '+name+' (\\d+)$','m'))?.[1]??0);
const report={schemaVersion:1,suite,startedAt,finishedAt:new Date().toISOString(),node:process.version,exitCode:result.status??1,tests:count('tests'),passed:count('pass'),failed:count('fail'),skipped:count('skipped'),status:result.status===0&&count('tests')>0&&count('skipped')===0?'passed':'failed',stdout,stderr,...(result.error?{error:result.error.message}:{})};
writeFileSync(output,JSON.stringify(report,null,2)+'\n');
process.stdout.write(`${suite}: ${report.status}, ${report.passed}/${report.tests} passed, ${report.failed} failed, ${report.skipped} skipped; ${output}\n`);
process.exitCode=report.status==='passed'?0:1;
