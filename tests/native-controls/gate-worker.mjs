import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const [runtime, root, command, timeout, result] = process.argv.slice(2);
const { runCommandQualityGate } = await import(pathToFileURL(runtime + '/dist/core/workflow/quality-gates/commandGateRunner.js'));
const out = await runCommandQualityGate({ projectRoot: root, gate: { type: 'command', command, timeoutMs: Number(timeout) } });
fs.writeFileSync(result, JSON.stringify(out));
