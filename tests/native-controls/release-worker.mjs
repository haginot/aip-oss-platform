import fs from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { quote, until } from './helpers.mjs';
const [runtime, base] = process.argv.slice(2);
const { acquireProjectExecutionLock } = await import(pathToFileURL(join(runtime, 'dist/infra/task/project-execution-lock.js')));
const { runCommandQualityGate } = await import(pathToFileURL(join(runtime, 'dist/core/workflow/quality-gates/commandGateRunner.js')));
const lock = acquireProjectExecutionLock(base, 'run');
const command = 'exec ' + [process.execPath, join(import.meta.dirname, 'http-gate.mjs'), 'hold', join(base, 'gate.json'), join(base, 'release'), 'unused'].map(quote).join(' ');
const pending = runCommandQualityGate({ projectRoot: base, gate: { type: 'command', command, timeoutMs: 15000 } });
await until('actual writing gate', () => fs.existsSync(join(base, 'gate.json.heartbeat')));
lock.release();
fs.writeFileSync(join(base, 'released'), 'released');
fs.writeFileSync(join(base, 'result.json'), JSON.stringify(await pending));
// Stay alive to prove finished ownership does not block after group cleanup.
while (!fs.existsSync(join(base, 'done'))) await sleep(5);
