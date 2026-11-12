import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';

const [root, volume, suite, chrome] = process.argv.slice(2);
const mib = 1024 ** 2;

function checkStorage() {
  // Opening an existing input for writing must fail even when no bytes are written.
  for (const source of ['package.json', 'node_modules/pg/package.json']) {
    assert.throws(() => closeSync(openSync(join(root, source), 'r+')), { code: 'EPERM' });
  }
  const fd = openSync(join(volume, 'capacity.log'), 'wx');
  // APFS must allocate the bytes. A sparse truncate would not test the limit.
  const block = Buffer.alloc(mib, 0x5a);
  let bytes = 0;
  try {
    while (bytes < 768 * mib) {
      bytes += writeSync(fd, block);
    }
    assert.fail('log writes exceeded the usable volume capacity');
  } catch (error) {
    assert.equal(error.code, 'ENOSPC');
    assert(bytes > 700 * mib, 'expected the quota to reject a near-capacity write');
    console.log(JSON.stringify({ blockedSourceWrites: 2, error: error.code, logBytes: bytes }));
  } finally {
    closeSync(fd);
  }
}

if (suite === 'storage') {
  checkStorage();
} else {
  assert(['api', 'browser'].includes(suite));
  const test = suite === 'api' ? 'ENT-201.test.mjs' : 'ENT-201.browser.test.mjs';
  const output = join(volume, suite);
  mkdirSync(output);
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/enterprise/' + test], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, HOME: join(volume, 'home'), CFFIXED_USER_HOME: join(volume, 'home'),
      ENTERPRISE_SUITE_OUTPUT: output, ENTERPRISE_CHROME: chrome, LANG: 'en_US.UTF-8' },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
