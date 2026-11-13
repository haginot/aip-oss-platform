import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fixture } from './helpers.mjs';

export async function withVolume(run) {
  assert.equal(process.platform, 'darwin', 'This integration requires a real macOS disk image');
  const base = fixture('volume');
  const stat = fs.statfsSync(base);
  assert(stat.bavail * stat.bsize > 160 * 1024 ** 2, 'Need 64 MiB image plus outer reserve; run serially');
  const image = join(base, 'bounded.sparseimage'), mount = join(base, 'mount');
  fs.mkdirSync(mount);
  const cmd = (args) => execFileSync('/usr/bin/hdiutil', args, { encoding: 'utf8', timeout: 60000 });
  let attached = false;
  try {
    cmd(['create', '-size', '64m', '-fs', 'APFS', '-type', 'SPARSE', '-volname', 'NativeControlsFixture', image]);
    try { cmd(['attach', '-nobrowse', '-noverify', '-mountpoint', mount, image]); }
    catch (error) {
      // A failed attach can still leave an owned device. Inspect only our image;
      // never print or change any other mount from the host inventory.
      const inventory = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], {
        input: cmd(['info', '-plist']), encoding: 'utf8', timeout: 10000,
      }));
      for (const entry of inventory.images ?? []) {
        if (entry['image-path'] !== image) continue;
        const device = entry['system-entities']?.find(e => e['dev-entry'])?.['dev-entry'];
        assert(device, 'Failed attach left an image without a detachable device');
        cmd(['detach', device]);
      }
      throw error;
    }
    attached = true;
    const capacity = fs.statfsSync(mount);
    assert(capacity.blocks * capacity.bsize <= 64 * 1024 ** 2);
    return await run({ base, mount, capacityBytes: capacity.blocks * capacity.bsize });
  } finally {
    // Never remove an image after a failed detach: keep ownership diagnosable.
    if (attached) cmd(['detach', mount]);
    fs.rmSync(image, { force: true });
    fs.rmdirSync(mount);
  }
}
