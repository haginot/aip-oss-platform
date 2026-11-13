import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fixture } from './helpers.mjs';

// Storage/command injection is only for lifecycle unit tests. HTTP integrations
// always use the real filesystem, hdiutil and boundedSpawn.
const system = { fs, execFileSync, fixture, platform: process.platform };

export function enclosingBoundedVolume(directory, disk = fs) {
  let mount = disk.realpathSync(directory);
  while (dirname(mount) !== mount) {
    if (disk.statSync(mount).dev !== disk.statSync(dirname(mount)).dev) {
      const stat = disk.statfsSync(mount), capacityBytes = stat.blocks * stat.bsize;
      if (capacityBytes > 0 && capacityBytes <= 20 * 1024 ** 3 && stat.bavail * stat.bsize >= 8 * 1024 ** 2)
        return { mount, capacityBytes };
      return undefined;
    }
    mount = dirname(mount);
  }
  // In particular, / is never a dedicated fixture mount.
  return undefined;
}

export async function withBoundedVolume(run, host = system) {
  const base = host.fixture('http-bounded');
  const enclosing = enclosingBoundedVolume(base, host.fs);
  if (enclosing) return run({ base, ...enclosing, writeRoot: base, owned: false });
  return withVolume(async context => {
    const writeRoot = join(context.mount, 'work');
    host.fs.mkdirSync(writeRoot);
    return run({ ...context, writeRoot, owned: true });
  }, host);
}

export class VolumeAttachRefusal extends Error {}

export async function withVolume(run, host = system) {
  const { fs: disk, execFileSync: execute } = host;
  assert.equal(host.platform, 'darwin', 'This integration requires a real macOS disk image');
  const base = host.fixture('volume');
  const stat = disk.statfsSync(base);
  assert(stat.bavail * stat.bsize > 160 * 1024 ** 2, 'Need 64 MiB image plus outer reserve; run serially');
  const image = join(base, 'bounded.sparseimage'), mount = join(base, 'mount');
  disk.mkdirSync(mount);
  const cmd = (args) => execute('/usr/bin/hdiutil', args, { encoding: 'utf8', timeout: 60000 });
  const ownedImages = () => {
    const inventory = JSON.parse(execute('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], {
      input: cmd(['info', '-plist']), encoding: 'utf8', timeout: 10000,
    }));
    return (inventory.images ?? []).filter(entry => entry['image-path'] === image);
  };
  const evidence = { image, mount, phase: 'create', cleanup: 'pending' };
  let attachAttempted = false, attached = false, failure, result;
  try {
    cmd(['create', '-size', '64m', '-fs', 'APFS', '-type', 'SPARSE', '-volname', 'NativeControlsFixture', image]);
    evidence.phase = 'attach';
    attachAttempted = true;
    cmd(['attach', '-nobrowse', '-noverify', '-mountpoint', mount, image]);
    attached = true;
    evidence.phase = 'verify';
    assert.notEqual(disk.statSync(mount).dev, disk.statSync(base).dev, 'Fixture must be a real mounted filesystem');
    const capacity = disk.statfsSync(mount);
    evidence.capacityBytes = capacity.blocks * capacity.bsize;
    assert(evidence.capacityBytes > 0 && evidence.capacityBytes <= 64 * 1024 ** 2);
    evidence.phase = 'run';
    result = await run({ base, mount, capacityBytes: evidence.capacityBytes });
    evidence.phase = 'complete';
  } catch (error) {
    failure = error;
    evidence.error = { message: error.message, stderr: String(error.stderr ?? '') };
  } finally {
    try {
      if (attached) cmd(['detach', mount]);
      if (attachAttempted) {
        // Failed attach may leave a device. Never detach unrelated images, or
        // remove our backing file if inventory/cleanup cannot be confirmed.
        for (const entry of ownedImages()) {
          const device = entry['system-entities']?.find(e => e['dev-entry'])?.['dev-entry'];
          assert(device, 'Owned image has no detachable device');
          cmd(['detach', device]);
        }
        assert.equal(ownedImages().length, 0, 'Owned image remains attached');
      }
      disk.rmSync(image, { force: true });
      disk.rmdirSync(mount);
      evidence.cleanup = 'removed';
    } catch (error) {
      evidence.cleanup = 'failed; ownership retained';
      evidence.cleanupError = error.message;
      failure = new AggregateError([failure, error].filter(Boolean), `Volume cleanup failed; inspect ${base}`);
    } finally {
      disk.writeFileSync(join(base, 'volume-lifecycle.json'), JSON.stringify(evidence, null, 2) + '\n');
      console.log('Volume lifecycle evidence: ' + join(base, 'volume-lifecycle.json'));
    }
  }
  if (failure) {
    if (evidence.phase === 'attach' && evidence.cleanup === 'removed'
      && /アクセス権がありません|Permission denied/.test(evidence.error.stderr))
      throw new VolumeAttachRefusal(`Image attachment denied; cleaned up. Evidence: ${base}`, { cause: failure });
    throw failure;
  }
  return result;
}
