import fs from 'node:fs'; import {setTimeout as sleep} from 'node:timers/promises'; import {acquireProjectExecutionLock} from "file:///private/tmp/aip-native-mlotYs/v/repo/.native-controls-runtime/takt/dist/infra/task/project-execution-lock.js";import {runCommandQualityGate} from "file:///private/tmp/aip-native-mlotYs/v/repo/.native-controls-runtime/takt/dist/core/workflow/quality-gates/commandGateRunner.js";
const base=process.argv[2],project=process.argv[3],command=process.argv[4];
const lock=acquireProjectExecutionLock(project,'run');fs.writeFileSync(base+'/ready',JSON.stringify(lock.owner));
while(!fs.existsSync(base+'/start'))await sleep(5);
await runCommandQualityGate({projectRoot:project,gate:{type:'command',command,timeoutMs:15000}});lock.release();