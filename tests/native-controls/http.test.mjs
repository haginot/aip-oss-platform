import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { runtime, verifyRuntime, put, fixture, isolatedEnv, launch } from './helpers.mjs';
import { withVolume, withBoundedVolume, VolumeAttachRefusal } from './volume.mjs';
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
  try {
    const refusal = await withBoundedVolume(async ({ base, mount, writeRoot, owned, capacityBytes }) => {
      const scenario = join(writeRoot, 'scenario.json');
      const outside = writeRoot + '-must-not-exist';
      put(scenario, []);
      const child = boundedSpawn({ volume: mount, writeRoot, cwd: writeRoot,
        args: [join(import.meta.dirname, 'http-fixture.mjs'), runtime, writeRoot, outside, 'no-fill'],
        environment: { TAKT_MOCK_SCENARIO: scenario } });
      const exit = await child.completion;
      const result = fs.existsSync(join(writeRoot, 'http-result.json')) ? JSON.parse(fs.readFileSync(join(writeRoot, 'http-result.json'))) : undefined;
      const log = fs.readFileSync(exit.logPath, 'utf8');
      // The owned mount is detached on return, so retain results outside it first.
      put(join(base, 'evidence.json'), { hashes, mount, writeRoot, owned, capacityBytes, exit, result, log });
      console.log('HTTP evidence: ' + join(base, 'evidence.json'));
      if (exit.code === 71 && log.includes('sandbox_apply: Operation not permitted')) {
        assert.equal(result, undefined, 'Refused confinement must not execute fixture');
        return 'Outer policy denied nested sandbox; implementation path is UNPROVEN. Evidence retained.';
      }
      assert.equal(exit.code, 0, JSON.stringify({ result, log }));
      assert.equal(result.ok, true);
      assert(!fs.existsSync(outside));
    });
    // Cleanup must finish successfully before a refusal can become a skip.
    if (refusal) t.skip(refusal);
  } catch (error) {
    if (error instanceof VolumeAttachRefusal) {
      t.skip('Bounded route UNPROVEN. ' + error.message);
      return;
    }
    throw error;
  }
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
    if (error instanceof VolumeAttachRefusal) {
      t.skip('Aggregate ENOSPC is UNPROVEN. ' + error.message);
      return;
    }
    throw error;
  }
});
