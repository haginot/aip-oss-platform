import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileLimitCommand } from '../../scripts/native-controls/file-limit.mjs';
import { fixture, runtime, verifyRuntime, isolatedEnv, quote } from './helpers.mjs';

test('kernel per-file refusal is inherited by the real gate and becomes a diagnosed failure', { skip: process.platform !== 'darwin' }, async () => {
  verifyRuntime();
  const base = fixture('file-limit'), file = join(base, 'fill.bin'), result = join(base, 'result.json');
  const command = 'exec ' + [process.execPath, join(import.meta.dirname, 'file-limit-payload.mjs'), file].map(quote).join(' ');
  const limited = fileLimitCommand(process.execPath, [join(import.meta.dirname, 'gate-worker.mjs'), runtime, base, command, '10000', result], 1024 * 1024);
  const child = spawn(limited.executable, limited.args, { cwd: base, env: isolatedEnv(base), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  const code = await new Promise((done, fail) => { child.once('error', fail); child.once('close', done); });
  try {
    assert.equal(code, 0, output);
    const out = JSON.parse(fs.readFileSync(result));
    assert.equal(out.ok, false);
    assert.equal(out.failure.exitCode, 23);
    assert.match(out.failure.stderr, /EFBIG/);
    assert.equal(fs.statSync(file).size, 1024 * 1024);
    assert(fs.existsSync(out.failure.outputLogPath));
    console.log('Per-file refusal evidence: ' + result);
  } finally { fs.rmSync(file, { force: true }); }
});
