import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runtime, verifyRuntime, fixture, launch, isolatedEnv, until, alive, put } from './helpers.mjs';

test('explicit release retains live gate group, then permits admission while old owner is still alive', async () => {
  verifyRuntime();
  const { acquireProjectExecutionLock, getProjectExecutionOwner } = await import(pathToFileURL(join(runtime, 'dist/infra/task/project-execution-lock.js')));
  const base = fixture('release');
  const child = launch(join(import.meta.dirname, 'release-worker.mjs'), [runtime, base], isolatedEnv(base), base);
  let lock;
  try {
    await until('explicit release', () => fs.existsSync(join(base, 'released')));
    assert(alive(child.pid));
    assert.equal(getProjectExecutionOwner(base).executionFinished, true);
    assert.throws(() => acquireProjectExecutionLock(base, 'watch'), /already running/);
    const before = fs.statSync(join(base, 'gate.json.heartbeat')).size;
    await until('gate still writes', () => fs.statSync(join(base, 'gate.json.heartbeat')).size > before);
    put(join(base, 'release'), 'finish');
    await until('gate result', () => fs.existsSync(join(base, 'result.json')));
    assert.equal(JSON.parse(fs.readFileSync(join(base, 'result.json'))).ok, true);
    lock = await until('admission after group gone', () => {
      try { return acquireProjectExecutionLock(base, 'watch'); }
      catch (e) { if (/already running/.test(e.message)) return false; throw e; }
    });
    assert(alive(child.pid), 'Old worker remains alive but has explicitly finished');
    lock.release(); lock = undefined;
    put(join(base, 'done'), 'done');
    const exit = await child.done;
    assert.equal(exit.code, 0, exit.output);
  } finally {
    lock?.release();
    if (alive(child.pid)) child.kill('SIGKILL');
    await child.done;
  }
});
