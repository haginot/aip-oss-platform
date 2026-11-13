import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, basename } from 'node:path';
import { fixture } from './helpers.mjs';
import { enclosingBoundedVolume, withBoundedVolume, withVolume, VolumeAttachRefusal } from './volume.mjs';

const MiB = 1024 ** 2;

test('fixture selection rejects host root, oversized and exhausted mounts; accepts a bounded mount', () => {
  const inspect = ({ mount = '/', capacity = 64 * MiB, available = 32 * MiB } = {}) => ({
    realpathSync: () => '/volume/repo/work',
    statSync: path => ({ dev: mount !== '/' && (path === mount || path.startsWith(mount + '/')) ? 2 : 1 }),
    statfsSync: () => ({ blocks: capacity, bsize: 1, bavail: available }),
  });
  assert.equal(enclosingBoundedVolume('ignored', inspect()), undefined);
  assert.equal(enclosingBoundedVolume('ignored', inspect({ mount: '/volume', capacity: 21 * 1024 ** 3 })), undefined);
  assert.equal(enclosingBoundedVolume('ignored', inspect({ mount: '/volume', capacity: 0 })), undefined);
  assert.equal(enclosingBoundedVolume('ignored', inspect({ mount: '/volume', available: 7 * MiB })), undefined);
  assert.deepEqual(enclosingBoundedVolume('ignored', inspect({ mount: '/volume' })), { mount: '/volume', capacityBytes: 64 * MiB });
});

// These are explicitly simulated storage/command fault tests, not evidence of
// real mounts, confinement, process identity, providers or aggregate ENOSPC.
function simulatedHost(t, options = {}) {
  const root = fixture('volume-unit');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let image, mount, attached = false;
  const calls = [];
  const host = {
    platform: 'darwin',
    fixture: name => fs.mkdtempSync(join(root, name + '-')),
    fs: {
      ...fs,
      statSync: path => ({ dev: options.reuse && path.startsWith(root) ? 3
        : attached && !options.sameDevice && path === mount ? 2 : 1 }),
      statfsSync: path => ({ bsize: 1, blocks: path === mount ? options.capacity ?? 64 * MiB : 768 * MiB, bavail: 256 * MiB }),
    },
    execFileSync: (file, args, settings) => {
      if (basename(file) === 'plutil') return settings.input;
      calls.push(args);
      if (args[0] === 'create') {
        image = args.at(-1);
        fs.writeFileSync(image, 'simulated image');
        if (options.createError) throw options.createError;
      } else if (args[0] === 'attach') {
        mount = args.at(-2);
        attached = !options.attachError || !!options.partialAttach;
        if (options.attachError) throw options.attachError;
      } else if (args[0] === 'info') {
        if (options.inventoryError) throw options.inventoryError;
        return JSON.stringify({ images: [
          { 'image-path': '/unrelated.sparseimage', 'system-entities': [{ 'dev-entry': '/dev/unrelated' }] },
          ...(attached ? [{ 'image-path': image, 'system-entities': [{ 'dev-entry': '/dev/simulated' }] }] : []),
        ] });
      } else if (args[0] === 'detach') {
        assert([mount, '/dev/simulated'].includes(args[1]), 'Never detach an unrelated image');
        if (options.detachError) throw options.detachError;
        attached = false;
        // Model disappearance of mounted contents on detach.
        for (const name of fs.readdirSync(mount)) fs.rmSync(join(mount, name), { recursive: true, force: true });
      } else assert.fail('Unexpected hdiutil command');
      return '';
    },
  };
  return { host, calls, root,
    get image() { return image; }, get mount() { return mount; },
    evidence: () => JSON.parse(fs.readFileSync(join(image, '..', 'volume-lifecycle.json'))),
  };
}

test('ordinary host fixture provisions a private write root and detaches after awaited success', async t => {
  const fake = simulatedHost(t);
  assert.equal(await withBoundedVolume(async context => {
    assert.equal(context.owned, true);
    assert.equal(context.mount, fake.mount);
    assert.equal(context.writeRoot, join(fake.mount, 'work'));
    assert(!context.base.startsWith(context.mount + '/'), 'Evidence survives detach');
    assert.equal(context.capacityBytes, 64 * MiB);
    await Promise.resolve();
    fs.writeFileSync(join(context.writeRoot, 'marker'), 'callback completed');
    assert(!fake.calls.some(args => args[0] === 'detach'));
    return 42;
  }, fake.host), 42);
  assert(!fs.existsSync(fake.image));
  assert(!fs.existsSync(fake.mount));
  assert.equal(fake.evidence().cleanup, 'removed');
  assert.deepEqual(fake.calls.filter(args => args[0] === 'detach'), [['detach', fake.mount]]);
});

test('bounded engineering fixture reuses its mount without owning or detaching it', async t => {
  const fake = simulatedHost(t, { reuse: true });
  let writeRoot;
  await withBoundedVolume(context => {
    assert.equal(context.owned, false);
    assert.equal(context.mount, fake.root);
    assert.equal(context.base, context.writeRoot);
    writeRoot = context.writeRoot;
  }, fake.host);
  assert(fs.existsSync(writeRoot));
  assert.deepEqual(fake.calls, []);
});

test('owned fixture detaches after callback failure and preserves the original failure', async t => {
  const fake = simulatedHost(t), failure = new Error('deliberate callback failure');
  await assert.rejects(withBoundedVolume(async () => { await Promise.resolve(); throw failure; }, fake.host), error => error === failure);
  assert(!fs.existsSync(fake.image));
  assert(!fs.existsSync(fake.mount));
  assert.equal(fake.evidence().phase, 'run');
  assert.equal(fake.evidence().cleanup, 'removed');
});

test('partial attach refusal detaches only its owned device before classifying environmental refusal', async t => {
  const refusal = Object.assign(new Error('attach refused'), { stderr: 'Permission denied' });
  const fake = simulatedHost(t, { attachError: refusal, partialAttach: true });
  await assert.rejects(withVolume(() => assert.fail('Must not run'), fake.host), error => error instanceof VolumeAttachRefusal && error.cause === refusal);
  assert.deepEqual(fake.calls.filter(args => args[0] === 'detach'), [['detach', '/dev/simulated']]);
  assert(!fs.existsSync(fake.image));
  assert.equal(fake.evidence().cleanup, 'removed');
});

test('cleanup failures retain ownership and cannot turn into environmental skips', async t => {
  for (const partialAttach of [false, true]) {
    const refusal = Object.assign(new Error('attach refused'), { stderr: 'Permission denied' });
    const fake = simulatedHost(t, { partialAttach, ...(partialAttach ? { attachError: refusal } : {}), detachError: new Error('device busy') });
    await assert.rejects(withVolume(() => { throw new Error('callback failed'); }, fake.host), error => {
      assert(error instanceof AggregateError);
      assert(!(error instanceof VolumeAttachRefusal));
      assert.equal(error.errors.length, 2);
      assert.equal(error.errors[1].message, 'device busy');
      return true;
    });
    assert(fs.existsSync(fake.image));
    assert(fs.existsSync(fake.mount));
    assert.equal(fake.evidence().cleanup, 'failed; ownership retained');
  }
});

test('unknown attach and inventory failures remain failures; only cleaned attach permission refusals qualify', async t => {
  for (const options of [
    { attachError: new Error('image corrupt') },
    { createError: Object.assign(new Error('create refused'), { stderr: 'Permission denied' }) },
    { attachError: Object.assign(new Error('attach refused'), { stderr: 'Permission denied' }), inventoryError: new Error('inventory unavailable') },
  ]) {
    const fake = simulatedHost(t, options);
    await assert.rejects(withVolume(() => assert.fail('Must not run'), fake.host), error => !(error instanceof VolumeAttachRefusal));
    assert.equal(fs.existsSync(fake.image), !!options.inventoryError);
  }
});

test('attached fixture rejects non-mount and oversized capacity before callback, then detaches', async t => {
  for (const options of [{ sameDevice: true }, { capacity: 65 * MiB }]) {
    const fake = simulatedHost(t, options);
    await assert.rejects(withVolume(() => assert.fail('Must not run'), fake.host), { code: 'ERR_ASSERTION' });
    assert(!fs.existsSync(fake.image));
    assert.equal(fake.evidence().phase, 'verify');
    assert.equal(fake.evidence().cleanup, 'removed');
  }
});

test('real owned image detaches even when the callback throws', { timeout: 120000, skip: process.platform !== 'darwin' }, async t => {
  const failure = new Error('intentional real-volume callback failure');
  let context;
  try {
    await withVolume(async volume => {
      context = volume;
      fs.writeFileSync(join(volume.mount, 'cleanup-probe'), 'actual mounted write');
      await Promise.resolve();
      throw failure;
    });
    assert.fail('The callback must reject');
  } catch (error) {
    if (error instanceof VolumeAttachRefusal) {
      assert.equal(context, undefined);
      t.skip('Real failure-path detach UNPROVEN. ' + error.message);
      return;
    }
    assert.equal(error, failure);
  }
  assert(context);
  assert(!fs.existsSync(context.mount));
  assert(!fs.existsSync(join(context.base, 'bounded.sparseimage')));
  const evidence = JSON.parse(fs.readFileSync(join(context.base, 'volume-lifecycle.json')));
  assert.equal(evidence.phase, 'run');
  assert.equal(evidence.cleanup, 'removed');
});
