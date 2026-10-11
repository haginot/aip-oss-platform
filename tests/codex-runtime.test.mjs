import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { selectCodex } from '../scripts/codex-runtime.mjs';
import { launchArgs } from '../scripts/launch.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'aip-codex-selection-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const executable = (directory, version) => {
    mkdirSync(join(root, directory));
    const path = join(root, directory, 'codex');
    writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' 'codex-cli ${version}'\n`);
    chmodSync(path, 0o755);
    return path;
  };
  return { root, executable };
}

test('launcher selects a newer bundled CLI instead of an old PATH installation', (t) => {
  const { root, executable } = fixture(t);
  executable('bin', '0.144.5');
  const app = executable('app', '0.162.0-alpha.17.2');
  assert.equal(selectCodex({ env: { PATH: join(root, 'bin') }, bundledPath: app }).path, app);
});

test('a newer PATH CLI is preserved instead of forcing the bundled binary', (t) => {
  const { root, executable } = fixture(t);
  const path = executable('bin', '0.170.0');
  const app = executable('app', '0.162.0-alpha.17.2');
  assert.equal(selectCodex({ env: { PATH: join(root, 'bin') }, bundledPath: app }).path, path);
});

test('explicit CLI selection is respected and is not silently replaced', (t) => {
  const { root, executable } = fixture(t);
  const explicit = executable('bin', '0.144.5');
  const app = executable('app', '0.162.0-alpha.17.2');
  assert.equal(selectCodex({ env: { PATH: join(root, 'bin'), TAKT_CODEX_CLI_PATH: explicit }, bundledPath: app }).path, explicit);
  assert.throws(() => selectCodex({ env: { TAKT_CODEX_CLI_PATH: join(root, 'missing') }, bundledPath: app }), /実行可能なCodex/u);
});

test('missing CLI produces an actionable error', (t) => {
  const { root } = fixture(t);
  assert.throws(() => selectCodex({ env: { PATH: join(root, 'missing') }, bundledPath: join(root, 'absent') }), /TAKT_CODEX_CLI_PATH/u);
});

test('run and start both use the isolated task queue rather than a direct workflow', () => {
  assert.deepEqual(launchArgs('run'), ['run']);
  assert.deepEqual(launchArgs('start', ['--dry-run']), ['run']);
});

test('explicit continuation is passed as a valid run or watch option', () => {
  assert.deepEqual(launchArgs('run', ['--ignore-exceed']), ['run', '--ignore-exceed']);
  assert.deepEqual(launchArgs('watch', ['--dry-run', '--ignore-exceed']), ['watch', '--ignore-exceed']);
});

test('launcher rejects provider overrides, pipeline mode and unknown flags', () => {
  assert.throws(() => launchArgs('pipeline'), /launch/u);
  assert.throws(() => launchArgs('run', ['--provider', 'mock']), /launch/u);
  assert.throws(() => launchArgs('start', ['--workflow', 'other']), /launch/u);
});
