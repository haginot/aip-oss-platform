import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { runtime, verifyRuntime, fixture, quote, until, alive, isolatedEnv, launch } from './helpers.mjs';

test('real command gate owns and reaps its process group', async t => {
  verifyRuntime();
  const { getProcessIdentity, sameProcessIdentity } = await import(pathToFileURL(join(runtime, 'dist/infra/task/process.js')));
  for (const mode of ['normal', 'verbose', 'failure', 'timeout', 'worker-term', 'worker-kill', 'guardian-kill']) {
    await t.test(mode, async () => {
      const base = fixture('gate-' + mode);
      const marker = join(base, 'marker.json'), result = join(base, 'result.json');
      const command = 'exec ' + [process.execPath, fileURLToPath(new URL('./gate-payload.mjs', import.meta.url)), mode, marker].map(quote).join(' ');
      const worker = launch(fileURLToPath(new URL('./gate-worker.mjs', import.meta.url)),
        [runtime, base, command, mode === 'timeout' ? '500' : '10000', result], isolatedEnv(base), base);
      let gate;
      const identities = new Map();
      const signal = (pid, value) => {
        assert(sameProcessIdentity(identities.get(pid), getProcessIdentity(pid)), 'Refusing to signal changed process');
        process.kill(pid, value);
      };
      try {
        identities.set(worker.pid, getProcessIdentity(worker.pid));
        gate = await until('actual gate marker', () => fs.existsSync(marker) && JSON.parse(fs.readFileSync(marker)));
        for (const pid of [gate.pid, gate.parent, gate.descendant]) identities.set(pid, getProcessIdentity(pid));
        if (mode === 'worker-term') signal(worker.pid, 'SIGTERM');
        if (mode === 'worker-kill') signal(worker.pid, 'SIGKILL');
        if (mode === 'guardian-kill') signal(gate.parent, 'SIGKILL');
        await until('guardian, gate and SIGTERM-resistant descendant reaped', () => !alive(gate.parent) && !alive(gate.pid) && !alive(gate.descendant));
        const exit = await worker.done;
        if (mode.startsWith('worker-')) assert.equal(exit.signal, mode === 'worker-term' ? 'SIGTERM' : 'SIGKILL');
        else {
          assert.equal(exit.code, 0, exit.output);
          const out = JSON.parse(fs.readFileSync(result));
          assert.equal(out.ok, ['normal', 'verbose'].includes(mode), JSON.stringify(out));
          if (mode === 'normal') assert.match(out.stdout, /real gate success/);
          if (mode === 'verbose') { assert.match(out.stdout, /OUTPUT TRUNCATED/); assert(out.stdout.length < 66000); }
          if (mode === 'failure') assert.equal(out.failure.exitCode, 7);
          if (mode === 'timeout') assert.equal(out.failure.timedOut, true);
        }
      } finally {
        if (alive(worker.pid)) signal(worker.pid, 'SIGKILL');
        // Failure cleanup is explicit and cannot count as successful product cleanup.
        for (const pid of [gate?.pid, gate?.descendant]) if (pid && alive(pid)) signal(pid, 'SIGKILL');
      }
    });
  }
});
