import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { root, manifest, prepare, verifyUpstream, hashFile } from '../../scripts/native-controls/patch.mjs';
import { verifyCopy, boundedSpawn } from '../../scripts/native-controls/run-bounded.mjs';
import { fixture, put, runtime, verifyRuntime } from './helpers.mjs';

test('hash-pinned recipe rejects wrong versions, changed upstream, existing targets and changed runtimes', () => {
  verifyRuntime();
  verifyUpstream(join(root, 'node_modules/takt'));
  const base = fixture('patch'), source = join(base, 'source');
  for (const name of Object.keys(manifest.files)) put(join(source, name), fs.readFileSync(join(root, 'node_modules/takt', name), 'utf8'));
  const copy = join(base, 'copy');
  const receipt = prepare(source, copy);
  assert.deepEqual(verifyCopy(copy), verifyCopy(runtime));
  assert.equal(receipt.runtime['dist/infra/task/process.js'], manifest.files['dist/infra/task/process.js']);
  assert.notEqual(receipt.runtime['dist/infra/task/project-execution-lock.js'], manifest.files['dist/infra/task/project-execution-lock.js']);
  assert.throws(() => prepare(source, copy), /already exists/);
  const packagePath = join(source, 'package.json'), original = fs.readFileSync(packagePath, 'utf8');
  put(packagePath, JSON.stringify({ version: '0.71.1' }));
  assert.throws(() => prepare(source, join(base, 'wrong-version')), /Unsupported TAKT version/);
  put(packagePath, original);
  const worker = 'dist/features/web-ui/central-worker.js';
  fs.appendFileSync(join(source, worker), '\n// unexpected change');
  assert.throws(() => prepare(source, join(base, 'wrong-hash')), /Upstream hash mismatch/);
  assert(!fs.existsSync(join(base, 'wrong-hash')));
  fs.appendFileSync(join(copy, worker), '\n// unexpected change');
  assert.throws(() => verifyCopy(copy), /Runtime hash mismatch/);
  for (const [name, hash] of Object.entries(manifest.files)) assert.equal(hashFile(join(root, 'node_modules/takt', name)), hash);
});

test('bounded launcher refuses ordinary directories before executing anything', { skip: process.platform !== 'darwin' }, () => {
  const base = fixture('not-a-mount');
  assert.throws(() => boundedSpawn({ volume: base, cwd: base, args: ['-e', 'process.exit(99)'] }), /mounted volume/);
  assert(!fs.existsSync(join(base, 'logs')));
});
