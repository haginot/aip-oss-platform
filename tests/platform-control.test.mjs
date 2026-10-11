import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const controlSource = resolve('scripts/platform-control.mjs');

function write(root, path, content) {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

function run(root, ...args) {
  return spawnSync(process.execPath, ['scripts/platform-control.mjs', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aip-platform-control-'));
  write(root, 'scripts/platform-control.mjs', readFileSync(controlSource, 'utf8'));
  write(root, 'evidence/run-manifest.json', '{"schemaVersion":1,"runs":[]}\n');
  return root;
}

test('verification receipt becomes stale when an input changes', () => {
  const root = fixture();
  try {
    write(root, 'src/value.txt', 'one\n');
    write(
      root,
      'verification/plan.json',
      `${JSON.stringify({
        schemaVersion: 1,
        suites: [{
          id: 'fingerprint',
          stage: 'mechanism',
          description: 'records a deterministic input fingerprint',
          commands: [[process.execPath, '-e', 'process.exit(0)']],
          inputs: ['src'],
          outputs: [],
          timeoutMs: 5000,
        }],
      }, null, 2)}\n`,
    );

    const executed = run(root, 'run-stage', 'mechanism');
    assert.equal(executed.status, 0, executed.stderr);
    assert.equal(run(root, 'validate', 'mechanism').status, 0);

    write(root, 'src/value.txt', 'two\n');
    const stale = run(root, 'validate', 'mechanism');
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /入力が変更/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a failed command is recorded and never accepted as evidence', () => {
  const root = fixture();
  try {
    write(root, 'src/value.txt', 'input\n');
    write(
      root,
      'verification/plan.json',
      `${JSON.stringify({
        schemaVersion: 1,
        suites: [{
          id: 'failure',
          stage: 'mechanism',
          description: 'preserves negative execution evidence',
          commands: [[process.execPath, '-e', 'process.exit(7)']],
          inputs: ['src/value.txt'],
          outputs: [],
          timeoutMs: 5000,
        }],
      }, null, 2)}\n`,
    );

    const executed = run(root, 'run-stage', 'mechanism');
    assert.notEqual(executed.status, 0);
    const manifest = JSON.parse(readFileSync(join(root, 'evidence/run-manifest.json'), 'utf8'));
    assert.equal(manifest.runs.length, 1);
    assert.equal(manifest.runs[0].status, 'failed');
    assert.equal(manifest.runs[0].suites[0].commands[0].exitCode, 7);
    assert.notEqual(run(root, 'validate', 'mechanism').status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('no-op shell commands are rejected from the verification plan', () => {
  const root = fixture();
  try {
    write(root, 'src/value.txt', 'input\n');
    write(
      root,
      'verification/plan.json',
      `${JSON.stringify({
        schemaVersion: 1,
        suites: [{
          id: 'no-op',
          stage: 'mechanism',
          description: 'must not be accepted',
          commands: [['true']],
          inputs: ['src/value.txt'],
          outputs: [],
          timeoutMs: 5000,
        }],
      }, null, 2)}\n`,
    );
    const result = run(root, 'run-stage', 'mechanism');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /検査しないcommand/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
