import assert from 'node:assert/strict';
import { fork, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { hash, inputs, parseTap, snapshot } from './enterprise/evidence.mjs';
import { phaseAuthority, receivePhase } from './takt-ent201-authority.mjs';

const self = fileURLToPath(import.meta.url);
const gate = fileURLToPath(new URL('./takt-ent201-gate.mjs', import.meta.url));
const quota = 768 * 1024 ** 2;
const logLimit = 64 * 1024;
const receiptLimit = 256 * 1024;
const disk = '/usr/bin/hdiutil';

export async function launchEnt201(root, flags) {
  assert(flags.length === 0 || (flags.length === 1 && flags[0] === '--check-storage'),
    'launch ent201 [--check-storage]');
  const child = fork(self, [root, ...flags], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const forward = signal => child.kill(signal);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, forward);
  try {
    return await new Promise((done, fail) => {
      child.once('error', fail);
      child.once('exit', (code, signal) => done(code ?? (signal === 'SIGINT' ? 130 : 1)));
    });
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(signal, forward);
  }
}

function command(executable, args) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 ** 2 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${executable} ${args[0]}: ${result.stderr.trim()}`);
  return result.stdout;
}

function fingerprint(root) {
  const source = inputs(root).digest;
  const runtime = createHash('sha256');
  function visit(directory, relative) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = join(directory, entry.name);
      const key = join(relative, entry.name);
      if (entry.isDirectory()) visit(path, key);
      else if (entry.isSymbolicLink()) {
        const target = fs.realpathSync(path);
        assert(target.startsWith(join(root, 'node_modules') + '/'), 'dependency link escapes installed packages');
        runtime.update(JSON.stringify([key, fs.readlinkSync(path)]));
      } else {
        assert(entry.isFile(), 'unexpected installed dependency file type');
        runtime.update(JSON.stringify([key, createHash('sha256').update(fs.readFileSync(path)).digest('hex')]));
      }
    }
  }
  visit(join(root, 'node_modules'), '');
  return { source, packages: runtime.digest('hex') };
}

function toolPath(name) {
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(dir => dir.startsWith('/'))) {
    try {
      const path = fs.realpathSync(join(dir, name));
      fs.accessSync(path, fs.constants.X_OK);
      return path;
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) throw error;
    }
  }
  throw new Error(`Missing executable: ${name}. Run this entry with mise exec.`);
}

function browserPath() {
  if (process.env.ENTERPRISE_CHROME) return fs.realpathSync(process.env.ENTERPRISE_CHROME);
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  for (const name of fs.readdirSync(cache).filter(name => /^chromium_headless_shell-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-').at(-1)) - Number(a.split('-').at(-1)))) {
    const candidate = join(cache, name, 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
    if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
  }
  throw new Error('Set ENTERPRISE_CHROME to a local Chromium executable');
}

const quote = word => "'" + word.replaceAll("'", "'\\''") + "'";

function acceptanceSuites(root) {
  const plan = JSON.parse(fs.readFileSync(join(root, 'work/enterprise/plan.json')));
  const spec = plan.issues.find(issue => issue.id === 'ENT-201');
  return Object.fromEntries([
    ['api', 'contract', 'ENT-201.test.mjs'],
    ['browser', 'browser', 'ENT-201.browser.test.mjs'],
  ].map(([suite, id, file]) => {
    const contract = spec.suites.find(entry => entry.id === 'ENT-201.' + id);
    const path = 'tests/enterprise/' + file;
    assert.equal(contract.path, path, 'unexpected acceptance suite path');
    assert.deepEqual(contract.command, ['mise', 'exec', '--', 'node', '--test', '--test-reporter=tap', path],
      'unexpected acceptance suite command');
    assert(contract.requiredAssertions.length > 0, 'acceptance assertions are required');
    return [suite, contract];
  }));
}

function stage(root, volume, suites) {
  const config = 'language: en\nconcurrency: 1\nworkflow_command_gates:\n  custom_scripts: true\n';
  for (const dir of ['global', 'home', 'tmp', '.takt/workflows']) fs.mkdirSync(join(volume, dir), { recursive: true });
  fs.writeFileSync(join(volume, 'global/config.yaml'), config);
  fs.writeFileSync(join(volume, '.takt/config.yaml'), config);
  const chrome = suites.includes('browser') ? browserPath() : '';
  const chromium = chrome ? join(volume, 'chromium') : '';
  if (chrome) {
    // macOS rejects nested Seatbelt profiles. Chromium inherits the enclosing
    // write and network policy and only uses the local synthetic test servers.
    fs.writeFileSync(chromium, '#!/bin/sh\nexec ' + quote(chrome) + ' --no-sandbox "$@"\n', { mode: 0o700 });
  }
  const gates = suites.map(suite => ({
    type: 'command', name: 'ENT-201-' + suite, cwd: '.', timeout_ms: 600_000,
    command: 'exec ' + [process.execPath, gate, root, volume, suite, suite === 'browser' ? chromium : ''].map(quote).join(' ')
      + ' > ' + quote(join(volume, suite + '.log')) + ' 2>&1',
  }));
  // JSON is valid YAML. Each command is fixed to a repository-owned entry point.
  fs.writeFileSync(join(volume, '.takt/workflows/ent201-bounded.yaml'), JSON.stringify({
    name: 'ent201-bounded', max_steps: 1, initial_step: 'verify',
    steps: [{ name: 'verify', persona: 'coder', capabilities: 'readonly', edit: false,
      instruction: 'Report readiness to run the deterministic command gates.', quality_gates: gates,
      rules: [{ condition: 'ready', next: 'COMPLETE' }] }],
  }));
  return chrome;
}

const controls = (volume, suites) => snapshot(volume, [
  'global/config.yaml', '.takt/config.yaml', '.takt/workflows/ent201-bounded.yaml',
  ...(suites.includes('browser') ? ['chromium'] : []),
]).digest;

const taktArgs = (root, volume, storageOnly) => [
  join(root, 'node_modules/takt/bin/takt'),
  '--pipeline', '--skip-git', '--provider', 'mock', '--workflow', 'ent201-bounded',
  '--task', 'Run the bounded ENT-201 ' + (storageOnly ? 'storage qualification' : 'acceptance checks') + ' in ' + volume + '/',
];

function observe(volume, suites) {
  return Object.fromEntries(['takt', ...suites].map(suite => {
    const log = readLog(join(volume, suite + '.log'));
    const artifacts = ['api', 'browser'].includes(suite) ? snapshot(volume, [suite]) : null;
    return [suite, {log, artifacts}];
  }));
}

function resultDigest(observed) {
  return hash(JSON.stringify(Object.entries(observed).map(([suite, {log, artifacts}]) =>
    [suite, hash(log), artifacts?.digest ?? null])));
}

async function runPhase(role, root, volume, storageOnly) {
  const suites = storageOnly ? ['storage'] : ['api', 'browser'];
  await receivePhase(role, async (binding, started) => {
    assert.deepEqual(binding.inputs, fingerprint(root), 'phase source or installed packages changed');
    assert.equal(binding.controls, controls(volume, suites), 'staged TAKT workflow changed');
    if (role === 'prepare') return {inputs: binding.inputs, controls: binding.controls};
    if (role === 'check') {
      const digest = resultDigest(observe(volume, suites));
      assert.equal(digest, binding.resultDigest, 'validation evidence changed before check');
      return {inputs: binding.inputs, controls: binding.controls, resultDigest: digest};
    }
    assert.equal(role, 'validate');
    const child = spawn(process.execPath, taktArgs(root, volume, storageOnly), {stdio: ['ignore', 'inherit', 'inherit']});
    const exit = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({code, signal}));
    });
    await started({pid: child.pid});
    return {pid: child.pid, ...await exit};
  });
}

function mounted(path, baseDevice) {
  return fs.statSync(path, { throwIfNoEntry: false })?.dev !== baseDevice && fs.existsSync(path);
}

function running(volume, leader) {
  const processes = command('/bin/ps', ['-ww', '-U', String(process.getuid()), '-o', 'pid=,ppid=,state=,command='])
    .trim().split('\n').map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/))
    .filter(row => row && !row[3].startsWith('Z'));
  // TAKT command gates and pg_ctl can start separate sessions. The private
  // mount is present in their argv, even after the original parent has exited.
  const owned = new Set(processes.filter(row => +row[1] === leader || row[4].includes(volume + '/')
    || row[4].includes(' ' + volume + ' ')).map(row => +row[1]));
  for (let changed = true; changed;) {
    changed = false;
    for (const [, pid, parent] of processes) {
      if (owned.has(+parent) && !owned.has(+pid)) {
        owned.add(+pid);
        changed = true;
      }
    }
  }
  return owned;
}

async function stop(volume, leader) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const owned = running(volume, leader);
    if (!owned.size) return;
    for (const pid of owned) {
      try {
        process.kill(pid, attempt < 4 ? 'SIGTERM' : 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    await sleep(100);
  }
  assert.equal(running(volume, leader).size, 0, 'TAKT descendants are still running');
}

async function detach(volume) {
  for (let attempt = 0; ; attempt++) {
    try {
      command(disk, ['detach', volume]);
      return;
    } catch (error) {
      if (attempt === 5 || !/busy|unmount/i.test(error.message)) throw error;
      await sleep(200 * (attempt + 1));
    }
  }
}

function readLog(path) {
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert(stat.isFile() && stat.size <= logLimit, `invalid or oversized log: ${path}`);
    const buffer = Buffer.alloc(logLimit + 1);
    const size = fs.readSync(fd, buffer);
    assert.equal(size, stat.size, 'log changed while reading');
    return buffer.subarray(0, size).toString();
  } finally {
    fs.closeSync(fd);
  }
}

function record(state, active, name, receipt) {
  const temporary = join(active, name);
  const contents = JSON.stringify(receipt, null, 2) + '\n';
  assert(Buffer.byteLength(contents) <= receiptLimit, 'oversized ENT-201 receipt');
  fs.writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, join(state, name));
}

async function supervise(root, storageOnly) {
  assert.equal(process.platform, 'darwin', 'ENT-201 bounded runner requires macOS');
  root = fs.realpathSync(root);
  const state = join(fs.realpathSync(homedir()), '.local/state/aip-takt-ent201');
  fs.mkdirSync(state, { mode: 0o700, recursive: true });
  const info = fs.lstatSync(state);
  assert(info.isDirectory() && info.uid === process.getuid() && (info.mode & 0o077) === 0
    && fs.realpathSync(state) === state, 'expected a private canonical state directory');
  const space = fs.statfsSync(state);
  assert(space.bavail * space.bsize >= 30 * 1024 ** 3, 'at least 30 GiB free space is required');
  const active = join(state, 'active');
  fs.mkdirSync(active, { mode: 0o700 });
  const image = join(active, 'run.sparseimage');
  const suites = storageOnly ? ['storage'] : ['api', 'browser'];
  const identity = {runId: randomUUID(), taskId: 'ENT-201', executionId: randomUUID()};
  const authority = phaseAuthority(identity, 22 * 60_000);
  let scratch, volume, baseDevice, child, childExit, cancelled, receipt, failure;
  const cancel = reason => {
    cancelled ??= reason;
    authority.revoke(cancelled);
  };
  const onSignal = signal => cancel(signal);
  process.once('disconnect', () => cancel('launcher disconnected'));
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, onSignal);
  try {
    assert(process.connected, 'launcher disconnected');
    const before = fingerprint(root);
    const project = JSON.parse(fs.readFileSync(join(root, 'package.json')));
    assert.equal(process.versions.node, project.engines.node, 'use the repository mise Node version');
    const contracts = storageOnly ? null : acceptanceSuites(root);
    const pg = storageOnly ? null : toolPath('postgres');
    scratch = fs.mkdtempSync('/private/tmp/at-');
    volume = join(scratch, 'v');
    fs.mkdirSync(volume);
    baseDevice = fs.statSync(scratch).dev;
    fs.writeFileSync(join(active, 'mount'), volume + '\n', { mode: 0o600 });
    command(disk, ['create', '-size', '768m', '-fs', 'APFS', '-type', 'SPARSE', '-volname', 'AIPTAKT', image]);
    command(disk, ['attach', '-nobrowse', '-noverify', '-mountpoint', volume, image]);
    const stats = fs.statfsSync(volume);
    const capacityBytes = stats.blocks * stats.bsize;
    assert(mounted(volume, baseDevice) && capacityBytes > 0 && capacityBytes <= quota, 'invalid bounded mount');
    const chrome = stage(root, volume, suites);
    const policy = role => `(version 1)
      (allow default)
      (deny file-write*)
      (allow file-write* (literal "/dev/null"))
      ${role === 'validate' ? '(allow file-write* (subpath (param "VOLUME")))' : ''}
      (deny network*)
      ${role === 'validate' ? `(allow network* (local ip "localhost:*") (remote ip "localhost:*")
        (local unix-socket (subpath (param "VOLUME"))) (remote unix-socket (subpath (param "VOLUME"))))` : ''}`;
    const env = { PATH: [dirname(process.execPath), ...(pg ? [dirname(pg)] : []), '/usr/bin', '/bin'].join(delimiter),
      HOME: join(volume, 'home'), CFFIXED_USER_HOME: join(volume, 'home'), TMPDIR: join(volume, 'tmp'),
      TMP: join(volume, 'tmp'), TEMP: join(volume, 'tmp'), TAKT_CONFIG_DIR: join(volume, 'global'),
      LANG: 'en_US.UTF-8', SHELL: '/bin/sh' };
    const launch = role => () => {
      const log = fs.openSync(join(volume, (role === 'validate' ? 'takt' : role) + '.log'), 'wx', 0o600);
      try {
        child = spawn('/usr/bin/sandbox-exec', ['-p', policy(role), '-D', 'VOLUME=' + volume,
          process.execPath, self, '--phase', role, root, volume, storageOnly ? 'storage' : 'product'],
        {cwd: volume, env, detached: true, stdio: ['ignore', log, log, 'pipe']});
        childExit = new Promise(done => child.once('close', done));
        return child;
      } finally {
        fs.closeSync(log);
      }
    };
    await sleep(0); // Let a queued signal or IPC disconnect arrive after hdiutil.
    assert(!cancelled, cancelled);
    const binding = {inputs: before, controls: controls(volume, suites)};
    assert.deepEqual(await authority.run('prepare', binding, launch('prepare')), binding);
    const exit = await authority.run('validate', binding, launch('validate'), pid => {
      console.log(`ENT-201 TAKT pid ${pid}, writable volume ${volume}, ${capacityBytes} bytes`);
    });
    // Session leaders and any orphaned fixture processes must be gone before
    // the read-only checking phase can receive authority.
    await stop(volume);
    assert(!exit.signal, `TAKT terminated by ${exit.signal}`);
    assert.equal(exit.code, 0, 'TAKT command gate failed');
    const observed = observe(volume, suites);
    const checked = {...binding, resultDigest: resultDigest(observed)};
    assert.deepEqual(await authority.run('check', checked, launch('check')), checked);
    assert.deepEqual(fingerprint(root), before, 'read-only inputs changed during execution');
    assert.equal(controls(volume, suites), binding.controls, 'staged TAKT workflow changed');
    assert.equal(resultDigest(observe(volume, suites)), checked.resultDigest, 'checked evidence changed');
    const taktOutput = observed.takt.log;
    process.stdout.write(taktOutput);

    const usage = fs.statfsSync(volume);
    receipt = { time: new Date().toISOString(), root, inputs: before, capacityBytes,
      volumeUsedBytes: (usage.blocks - usage.bfree) * usage.bsize,
      imageAllocatedBytes: fs.statSync(image).blocks * 512,
      takt: project.devDependencies.takt, node: process.versions.node, provider: 'mock', exit: exit.code, taktOutput,
      authority: {origin: 'bounded-supervisor', identity, phases: authority.completed, controls: binding.controls, resultDigest: checked.resultDigest},
      ...(storageOnly ? {} : {formalAcceptance: 'pending-canonical-batch-and-independent-review'}),
      ...(pg ? { postgres: command(pg, ['--version']).trim(), chrome } : {}), suites: {} };
    for (const suite of suites) {
      let log;
      try {
        log = observed[suite].log;
        process.stdout.write(log);
        if (suite === 'storage') {
          const check = JSON.parse(log);
          assert.equal(check.error, 'ENOSPC');
          assert.equal(check.blockedSourceWrites, 2);
          receipt.suites.storage = { ...check, status: 'passed' };
        } else {
          const contract = contracts[suite];
          const argv = [process.execPath, ...contract.command.slice(4)];
          const tap = parseTap(log, contract.requiredAssertions);
          receipt.suites[suite] = { ...tap, status: 'passed', command: argv, log,
            suiteDefinitionSha256: hash(JSON.stringify(contract)), tapSha256: hash(log),
            artifacts: observed[suite].artifacts.entries };
        }
      } catch (error) {
        receipt.suites[suite] = { status: 'failed', error: error.message, log };
      }
    }
    assert(suites.every(suite => receipt.suites[suite].status === 'passed'), 'missing or invalid gate result');
  } catch (error) {
    failure = error;
  }

  try {
    if (volume && mounted(volume, baseDevice)) {
      await stop(volume, child?.exitCode === null && !child?.signalCode ? child?.pid : undefined);
      if (childExit) await childExit;
      await detach(volume);
    }
    if (scratch) {
      if (volume && fs.existsSync(volume)) fs.rmdirSync(volume);
      fs.rmdirSync(scratch);
    }
    fs.rmSync(image, { force: true });
    fs.rmSync(join(active, 'mount'), { force: true });
    try {
      failure ??= cancelled ? new Error(cancelled) : undefined;
      const summary = {time: new Date().toISOString(), root,
        authority: {origin: 'bounded-supervisor', identity, phases: authority.completed}, cleanup: 'complete'};
      const name = storageOnly ? 'storage.json' : 'latest.json';
      const failReceipt = error => ({...summary, status: 'failed', error: String(error.message).slice(0, 4096)});
      try {
        record(state, active, name, {...summary, ...receipt, status: failure ? 'failed' : 'passed',
          ...(failure ? {error: failReceipt(failure).error} : {})});
      } catch (error) {
        failure ??= error;
        fs.rmSync(join(active, name), {force: true});
        record(state, active, name, failReceipt(failure));
      }
    } finally {
      fs.rmSync(join(active, storageOnly ? 'storage.json' : 'latest.json'), {force: true});
      fs.rmdirSync(active);
    }
    if (volume) console.log('ENT-201 cleanup complete');
  } catch (error) {
    failure = failure ? new AggregateError([failure, error], 'TAKT and cleanup failed') : error;
  }
  if (failure) throw failure;
}

if (process.argv[1] && resolve(process.argv[1]) === self && (process.send || process.argv[2] === '--phase')) {
  try {
    if (process.argv[2] === '--phase') {
      await runPhase(process.argv[3], process.argv[4], process.argv[5], process.argv[6] === 'storage');
    } else {
      await supervise(process.argv[2], process.argv[3] === '--check-storage');
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (process.connected) process.disconnect();
  }
}
