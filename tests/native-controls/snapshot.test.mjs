import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { runtime, verifyRuntime, fixture, launch, isolatedEnv, until, alive, put } from './helpers.mjs';

for (const mode of ['run', 'watch', 'inspect']) test(`stale pre-registration snapshot cannot reclaim live gate: ${mode}`, { timeout: 40000 }, async () => {
  verifyRuntime();
  const { acquireProjectExecutionLock } = await import(pathToFileURL(join(runtime, 'dist/infra/task/project-execution-lock.js')));
  const { getProcessIdentity, sameProcessIdentity } = await import(pathToFileURL(join(runtime, 'dist/infra/task/process.js')));
  const base = fixture('snapshot-' + mode), env = isolatedEnv(base);
  const read = name => JSON.parse(fs.readFileSync(join(base, name)));
  const heartbeat = () => fs.statSync(join(base, 'gate.json.heartbeat')).size;
  const worker = launch(join(import.meta.dirname, 'snapshot-worker.mjs'), [runtime, base], env, base);
  let contender, marker, lock;
  const monitors = [];
  const signal = (entry, value) => {
    if (sameProcessIdentity(entry.identity, getProcessIdentity(entry.pid))) process.kill(entry.pid, value);
  };
  const evidence = { mode };
  try {
    await until('worker owns lock', () => fs.existsSync(join(base, 'ready.json')));
    const owner = read('ready.json');
    contender = launch(join(import.meta.dirname, 'snapshot-contender.mjs'), [runtime, base, owner.ownerId, mode], env, base);
    await until('old snapshot held', () => fs.existsSync(join(base, 'snapshot.json')));
    evidence.oldSnapshot = read('snapshot.json');
    assert.equal(evidence.oldSnapshot.gateGroups, undefined);
    put(join(base, 'start'), 'start');
    await until('writing gate', () => fs.existsSync(join(base, 'gate.json.heartbeat')) && heartbeat() > 0);
    marker = read('gate.json');
    evidence.published = JSON.parse(fs.readFileSync(join(base, '.takt/execution.lock', `owner-${owner.ownerId}.json`)));
    assert.equal(evidence.published.gateGroups[0].pid, marker.guardian);
    const children = execFileSync('/usr/bin/pgrep', ['-P', String(marker.guardian)], { encoding: 'utf8' }).trim().split(/\s+/).map(Number);
    const sentinel = children.find(pid => pid !== marker.pid && execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).includes('--sentinel ' + marker.guardian));
    assert(sentinel, 'actual sentinel found');
    for (const pid of [marker.guardian, sentinel]) {
      const entry = { pid, identity: getProcessIdentity(pid) };
      assert(entry.identity);
      monitors.push(entry); signal(entry, 'SIGSTOP');
    }
    worker.kill('SIGKILL'); await worker.done;
    put(join(base, 'resume'), 'resume');
    await until('contender result', () => fs.existsSync(join(base, 'admission.json')));
    evidence.admission = read('admission.json');
    evidence.before = heartbeat();
    await until('old gate still writes', () => heartbeat() > evidence.before + 10);
    evidence.after = heartbeat();
    put(join(base, 'evidence.json'), evidence);
    if (mode === 'inspect') assert.equal(evidence.admission.owner?.ownerId, owner.ownerId, 'inspection must preserve and report the live gate owner');
    else {
      assert.equal(evidence.admission.acquired, false, 'stale snapshot must not acquire while old gate writes');
      assert.match(evidence.admission.error, /already running/);
    }
    assert(fs.existsSync(join(base, '.takt/execution.lock', `owner-${owner.ownerId}.json`)), 'newly published record retained');
    for (const entry of monitors) signal(entry, 'SIGCONT');
    await until('gate cleanup', () => !alive(marker.pid) && !alive(marker.descendant));
    lock = await until('reacquire after cleanup', () => {
      try { return acquireProjectExecutionLock(base, 'run'); }
      catch (error) { if (/already running/.test(error.message)) return false; throw error; }
    });
    const afterCleanup = heartbeat(); await sleep(30);
    assert.equal(heartbeat(), afterCleanup);
    lock.release(); lock = undefined;
    evidence.reacquiredAfterCleanup = true;
    put(join(base, 'evidence.json'), evidence);
  } finally {
    lock?.release();
    put(join(base, 'resume'), 'resume'); put(join(base, 'done'), 'done');
    if (alive(worker.pid)) worker.kill('SIGKILL');
    for (const entry of monitors) signal(entry, 'SIGCONT');
    await worker.done;
    if (contender) await contender.done;
    if (marker) await until('final cleanup', () => !alive(marker.pid) && !alive(marker.descendant));
    console.log('Snapshot evidence: ' + join(base, 'evidence.json'));
  }
});
