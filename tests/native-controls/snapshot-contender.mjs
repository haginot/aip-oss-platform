import fs from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import { put, until } from './helpers.mjs';
const [runtime, base, ownerId, mode] = process.argv.slice(2);
const original = fs.readFileSync;
let paused = false;
// Scheduling barrier only: retain the exact bytes read from the real descriptor.
// No identity, filesystem result, lock implementation or gate result is mocked.
fs.readFileSync = function (...args) {
  const value = original.apply(this, args);
  if (!paused && typeof args[0] === 'number' && value.toString().includes(ownerId)) {
    paused = true;
    put(join(base, 'snapshot.json'), value.toString());
    while (!fs.existsSync(join(base, 'resume'))) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
  return value;
};
syncBuiltinESMExports();
const { acquireProjectExecutionLock, getProjectExecutionOwner } = await import(pathToFileURL(join(runtime, 'dist/infra/task/project-execution-lock.js')));
let lock;
try {
  if (mode === 'inspect') {
    put(join(base, 'admission.json'), { owner: getProjectExecutionOwner(base) ?? null });
  } else {
    lock = acquireProjectExecutionLock(base, mode);
    put(join(base, 'admission.json'), { acquired: true, owner: lock.owner });
  }
} catch (error) {
  put(join(base, 'admission.json'), { acquired: false, error: error.message });
}
await until('contender done', () => fs.existsSync(join(base, 'done')));
lock?.release();
