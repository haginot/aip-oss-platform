// macOS launch boundary. The filesystem enforces capacity; no du polling.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifest, hashFile, patchSources, sha256, verifyUpstream } from './patch.mjs';
import { fileLimitCommand } from './file-limit.mjs';

// /bin/ps is the sealed-system, setuid Apple process inspector used by TAKT's
// unchanged identity module. Seatbelt otherwise refuses this exec. Exempt only
// this read-only executable; shells, Node, workers and gates retain the policy.
// This uses the process-exec/no-sandbox form in Apple's shipped system profiles.
export const boundedPolicy = `(version 1)
(allow default)
(deny file-write*)
(allow file-write* (literal "/dev/null") (subpath (param "ROOT")))
(allow process-exec (literal "/bin/ps") (with no-sandbox))`;

export function verifyCopy(runtime) {
  verifyUpstream(join(import.meta.dirname, '../../node_modules/takt'));
  const receipt = JSON.parse(fs.readFileSync(join(runtime, 'native-controls-receipt.json')));
  assert.equal(receipt.version, manifest.version);
  assert.deepEqual(receipt.source, manifest.files);
  const originals = Object.fromEntries(['dist/features/web-ui/central-worker.js', 'dist/core/workflow/quality-gates/commandGateRunner.js', 'dist/infra/task/project-execution-lock.js']
    .map(name => [name, fs.readFileSync(join(import.meta.dirname, '../../node_modules/takt', name), 'utf8')]));
  const expected = { ...manifest.files, ...Object.fromEntries(Object.entries(patchSources(originals)).map(([k, v]) => [k, sha256(v)])) };
  assert.deepEqual(receipt.runtime, expected, 'Runtime receipt does not match this repair');
  for (const [name, hash] of Object.entries(expected)) assert.equal(hashFile(join(runtime, name)), hash, `Runtime hash mismatch: ${name}`);
  return expected;
}

export function boundedSpawn({ volume, writeRoot = volume, cwd, args, environment = {} }) {
  assert.equal(process.platform, 'darwin', 'Hard confinement currently requires macOS');
  volume = fs.realpathSync(volume);
  writeRoot = fs.realpathSync(writeRoot);
  cwd = fs.realpathSync(cwd);
  assert(writeRoot === volume || writeRoot.startsWith(volume + '/'), 'Writable root must be on bounded volume');
  assert.equal(fs.statSync(writeRoot).dev, fs.statSync(volume).dev, 'Writable root must share bounded device');
  assert(cwd === writeRoot || cwd.startsWith(writeRoot + '/'), 'Execution directory must be inside writable root');
  assert.equal(fs.statSync(cwd).dev, fs.statSync(volume).dev, 'Execution directory must share bounded device');
  assert.notEqual(fs.statSync(volume).dev, fs.statSync(dirname(volume)).dev, 'Root must be a mounted volume');
  const stats = fs.statfsSync(volume);
  const capacityBytes = stats.blocks * stats.bsize;
  assert(capacityBytes > 0 && capacityBytes <= 20 * 1024 ** 3, 'Volume exceeds 20 GiB');
  assert(stats.bavail * stats.bsize >= 8 * 1024 ** 2, 'Bounded volume lacks startup reserve');
  for (const name of ['home', 'global', 'tmp', 'logs']) {
    const path = join(writeRoot, name);
    fs.mkdirSync(path, { recursive: true, mode: 0o700 });
    assert.equal(fs.realpathSync(path), path, 'Runtime directory must not be a symlink');
    assert.equal(fs.statSync(path).dev, fs.statSync(volume).dev, 'Runtime directory must share bounded device');
  }
  assert(Object.keys(environment).every(k => k === 'TAKT_MOCK_SCENARIO'), 'Unsupported environment override');
  if (environment.TAKT_MOCK_SCENARIO) assert(fs.realpathSync(environment.TAKT_MOCK_SCENARIO).startsWith(writeRoot + '/'));
  const env = { PATH: process.env.PATH, LANG: 'en_US.UTF-8', SHELL: '/bin/sh',
    HOME: join(writeRoot, 'home'), CFFIXED_USER_HOME: join(writeRoot, 'home'),
    TAKT_CONFIG_DIR: join(writeRoot, 'global'), TMPDIR: join(writeRoot, 'tmp'), TMP: join(writeRoot, 'tmp'), TEMP: join(writeRoot, 'tmp'), ...environment };
  const logPath = join(writeRoot, 'logs', `launch-${Date.now()}-${process.pid}.log`);
  const fd = fs.openSync(logPath, 'wx', 0o600);
  // Descendants inherit the kernel policy even if the launcher dies or they detach.
  let child;
  const limited = fileLimitCommand(process.execPath, args);
  try { child = spawn('/usr/bin/sandbox-exec', ['-p', boundedPolicy, '-D', 'ROOT=' + writeRoot, limited.executable, ...limited.args],
    { cwd, env, stdio: ['ignore', fd, fd] }); }
  finally { fs.closeSync(fd); }
  child.completion = new Promise((done, fail) => {
    child.once('error', fail);
    child.once('close', (code, signal) => done({ code, signal, capacityBytes, logPath }));
  });
  return child;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [volume, runtime, writeRoot, cwd, ...args] = process.argv.slice(2);
    assert(volume && runtime && writeRoot && cwd, 'Usage: node run-bounded.mjs VOLUME COPIED_TAKT WRITE_ROOT PROJECT [TAKT args...]');
    verifyCopy(resolve(runtime));
    const child = boundedSpawn({ volume, writeRoot, cwd, args: [join(resolve(runtime), 'bin/takt'), ...args] });
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
    const result = await child.completion;
    console.log(JSON.stringify(result));
    process.exitCode = result.code ?? 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
