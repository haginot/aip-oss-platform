import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { runtime, verifyRuntime, put, fixture, isolatedEnv, launch } from './helpers.mjs';
import { withVolume } from './volume.mjs';
import { boundedSpawn, verifyCopy } from '../../scripts/native-controls/run-bounded.mjs';

test('official HTTP -> real central workers -> gates in an isolated process', { timeout: 120000 }, async () => {
  verifyRuntime();
  const hashes = verifyCopy(runtime), base = fixture('http-native');
  const child = launch(join(import.meta.dirname, 'http-fixture.mjs'), [runtime, base, join(base, 'unused'), 'native-route'], isolatedEnv(base), base);
  const exit = await child.done;
  const result = fs.existsSync(join(base, 'http-result.json')) ? JSON.parse(fs.readFileSync(join(base, 'http-result.json'))) : undefined;
  put(join(base, 'evidence.json'), { hashes, exit, result });
  console.log('Native HTTP evidence: ' + join(base, 'evidence.json'));
  assert.equal(exit.code, 0, JSON.stringify({ result, output: exit.output }));
  assert.equal(result.ok, true);
});

test('official HTTP -> real central workers -> gates in the bounded launch path', { timeout: 120000, skip: process.platform !== 'darwin' }, async t => {
  verifyRuntime();
  const hashes = verifyCopy(runtime);
  const base = fixture('http');
  let volume = base;
  while (fs.statSync(volume).dev === fs.statSync(dirname(volume)).dev && dirname(volume) !== volume) volume = dirname(volume);
  const scenario = join(base, 'scenario.json');
  put(scenario, []);
  const child = boundedSpawn({ volume, writeRoot: base, cwd: base,
    args: [join(import.meta.dirname, 'http-fixture.mjs'), runtime, base, join(dirname(base), 'must-not-exist-' + process.pid), 'no-fill'],
    environment: { TAKT_MOCK_SCENARIO: scenario } });
  const exit = await child.completion;
  const result = fs.existsSync(join(base, 'http-result.json')) ? JSON.parse(fs.readFileSync(join(base, 'http-result.json'))) : undefined;
  const log = fs.readFileSync(exit.logPath, 'utf8');
  put(join(base, 'evidence.json'), { hashes, exit, result, log });
  console.log('HTTP evidence: ' + join(base, 'evidence.json'));
  if (exit.code === 71 && log.includes('sandbox_apply: Operation not permitted')) {
    assert.equal(result, undefined, 'Refused confinement must not execute fixture');
    t.skip('Outer policy denied nested sandbox; implementation path is UNPROVEN. Evidence retained.');
    return;
  }
  assert.equal(exit.code, 0, JSON.stringify({ result, log }));
  assert.equal(result.ok, true);
});

test('real 64 MiB filesystem capacity refusal through HTTP gate', { timeout: 120000, skip: process.platform !== 'darwin' }, async t => {
  verifyRuntime();
  const hashes = verifyCopy(runtime);
  try { await withVolume(async ({ base, mount, capacityBytes }) => {
    const scenario = join(mount, 'scenario.json');
    put(scenario, []);
    // Test aggregate filesystem capacity independently of nested Seatbelt support.
    const child = launch(join(import.meta.dirname, 'http-fixture.mjs'),
      [runtime, mount, join(base, 'must-not-exist'), 'fill-only'], isolatedEnv(mount), mount);
    const exit = await child.done;
    const result = fs.existsSync(join(mount, 'http-result.json')) ? JSON.parse(fs.readFileSync(join(mount, 'http-result.json'))) : undefined;
    const log = exit.output;
    put(join(base, 'evidence.json'), { hashes, capacityBytes, exit, result, log });
    console.log('HTTP evidence: ' + join(base, 'evidence.json'));
    assert.equal(exit.code, 0, JSON.stringify({ result, log }));
    assert.equal(result.ok, true);
    assert(!fs.existsSync(join(base, 'must-not-exist')));
  }); } catch (error) {
    if (error.message.includes('hdiutil attach') && /アクセス権がありません|Permission denied/.test(String(error.stderr))) {
      t.skip('Outer environment denied real image mount; aggregate ENOSPC is UNPROVEN. Image removed.');
      return;
    }
    throw error;
  }
});
