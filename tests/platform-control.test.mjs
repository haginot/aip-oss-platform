import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

function prepared(t, overrides = {}) {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, 'src/value.txt', 'input\n');
  const suite = { id: 'regression', stage: 'mechanism', description: 'test receipt semantics',
    commands: [[process.execPath, '-e', 'process.exit(0)']], inputs: ['src'], outputs: [], timeoutMs: 5000,
    ...overrides };
  write(root, 'verification/plan.json', JSON.stringify({ schemaVersion: 1, suites: [suite] }));
  return root;
}

const manifest = (root) => JSON.parse(readFileSync(join(root, 'evidence/run-manifest.json'), 'utf8'));

test('a newer failed run invalidates an earlier pass with identical definitions and inputs', (t) => {
  const root = prepared(t, { commands: [[process.execPath, '-e', "process.exit(require('fs').existsSync('fail.flag') ? 9 : 0)"]] });
  assert.equal(run(root, 'run-stage', 'mechanism').status, 0);
  write(root, 'fail.flag', 'trigger'); // intentionally outside declared inputs
  assert.notEqual(run(root, 'run-stage', 'mechanism').status, 0);
  assert.deepEqual(manifest(root).runs.map((item) => item.status), ['passed', 'failed']);
  const result = run(root, 'validate', 'mechanism');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /最新receipt.*failed/u);
});

test('an interrupted latest run cannot reuse a previous pass', (t) => {
  const root = prepared(t);
  assert.equal(run(root, 'run-stage', 'mechanism').status, 0);
  const history = manifest(root);
  history.runs.push({ id: 'interrupted', stage: 'mechanism', status: 'running', suites: [] });
  write(root, 'evidence/run-manifest.json', JSON.stringify(history));
  const result = run(root, 'validate', 'mechanism');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /最新receipt.*running/u);
});

test('inputs are fingerprinted before execution and must not change during verification', (t) => {
  const root = prepared(t, { commands: [[process.execPath, '-e', "require('fs').writeFileSync('src/value.txt', 'changed')"]] });
  assert.notEqual(run(root, 'run-stage', 'mechanism').status, 0);
  const latest = manifest(root).runs.at(-1);
  assert.equal(latest.status, 'failed');
  assert.equal(latest.suites[0].commands[0].exitCode, 0);
  assert.match(latest.suites[0].error, /実行中に入力が変更/u);
});

test('missing outputs leave a failed receipt even when the command succeeds', (t) => {
  const root = prepared(t, { outputs: ['artifacts/missing.json'] });
  assert.notEqual(run(root, 'run-stage', 'mechanism').status, 0);
  assert.equal(manifest(root).runs.at(-1).status, 'failed');
  assert.match(manifest(root).runs.at(-1).suites[0].error, /verification対象がありません/u);
});

test('missing inputs leave a failed receipt before commands run', (t) => {
  const root = prepared(t, { inputs: ['missing'] });
  assert.notEqual(run(root, 'run-stage', 'mechanism').status, 0);
  const receipt = manifest(root).runs.at(-1);
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.suites[0].commands.length, 0);
});

test('changing an output invalidates its successful receipt', (t) => {
  const root = prepared(t, { outputs: ['artifacts/result.json'], commands: [[process.execPath, '-e',
    "require('fs').mkdirSync('artifacts'); require('fs').writeFileSync('artifacts/result.json', '{}')"]] });
  assert.equal(run(root, 'run-stage', 'mechanism').status, 0);
  write(root, 'artifacts/result.json', '{"modified":true}');
  assert.match(run(root, 'validate', 'mechanism').stderr, /出力artifactが変更/u);
});

test('changing a suite definition invalidates a successful receipt', (t) => {
  const root = prepared(t);
  assert.equal(run(root, 'run-stage', 'mechanism').status, 0);
  const plan = JSON.parse(readFileSync(join(root, 'verification/plan.json')));
  plan.suites[0].timeoutMs = 6000;
  write(root, 'verification/plan.json', JSON.stringify(plan));
  assert.match(run(root, 'validate', 'mechanism').stderr, /suite定義が変更/u);
});

test('incomplete or mismatched command receipts are rejected', (t) => {
  const root = prepared(t);
  assert.equal(run(root, 'run-stage', 'mechanism').status, 0);
  const history = manifest(root);
  history.runs[0].suites[0].commands[0].argv = ['different-command'];
  write(root, 'evidence/run-manifest.json', JSON.stringify(history));
  assert.match(run(root, 'validate', 'mechanism').stderr, /command成功記録が不正/u);
  history.runs[0].suites[0].commands = [];
  write(root, 'evidence/run-manifest.json', JSON.stringify(history));
  assert.notEqual(run(root, 'validate', 'mechanism').status, 0);
});

test('spawn errors are recorded as failed commands', (t) => {
  const root = prepared(t, { commands: [['/aip-platform-missing-executable']] });
  assert.notEqual(run(root, 'run-stage', 'mechanism').status, 0);
  const command = manifest(root).runs.at(-1).suites[0].commands[0];
  assert.notEqual(command.exitCode, 0);
  assert.match(command.error, /ENOENT/u);
});

test('timeout is a recorded failure rather than a pass', (t) => {
  const root = prepared(t, { timeoutMs: 1000, commands: [[process.execPath, '-e', 'while (true) {}']] });
  assert.notEqual(run(root, 'run-stage', 'mechanism').status, 0);
  assert.equal(manifest(root).runs.at(-1).status, 'failed');
  assert.match(manifest(root).runs.at(-1).suites[0].commands[0].error, /ETIMEDOUT/u);
});

test('normalized project-root aliases are rejected as verification inputs', (t) => {
  const root = prepared(t, { inputs: ['src/..'] });
  assert.match(run(root, 'run-stage', 'mechanism').stderr, /project rootは指定できません/u);
  assert.equal(manifest(root).runs.at(-1).status, 'failed');
});

test('a declared directory must contain actual verification files', (t) => {
  const root = prepared(t, { inputs: ['empty'] });
  mkdirSync(join(root, 'empty'));
  assert.match(run(root, 'run-stage', 'mechanism').stderr, /fileがありません/u);
});

test('nonempty inputs cannot hide another declared empty input directory', (t) => {
  const root = prepared(t, { inputs: ['src', 'empty'] });
  mkdirSync(join(root, 'empty'));
  const result = run(root, 'run-stage', 'mechanism');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fileがありません: empty/u);
  assert.equal(manifest(root).runs.at(-1).suites[0].commands.length, 0);
});

test('nonempty outputs cannot hide another declared empty output directory', (t) => {
  const root = prepared(t, { outputs: ['src/value.txt', 'empty'] });
  mkdirSync(join(root, 'empty'));
  const result = run(root, 'run-stage', 'mechanism');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fileがありません: empty/u);
  assert.equal(manifest(root).runs.at(-1).status, 'failed');
});

test('a parent symlink cannot escape the project boundary', (t) => {
  const root = prepared(t, { inputs: ['escape/value.txt'] });
  const outside = mkdtempSync(join(tmpdir(), 'aip-platform-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  write(outside, 'value.txt', 'outside');
  symlinkSync(outside, join(root, 'escape'));
  assert.match(run(root, 'run-stage', 'mechanism').stderr, /project外/u);
});

test('symlinks inside input trees are not fingerprinted as regular files', (t) => {
  const root = prepared(t);
  symlinkSync(join(root, 'src/value.txt'), join(root, 'src/link.txt'));
  assert.match(run(root, 'run-stage', 'mechanism').stderr, /symlinkは使用できません/u);
});

function approvedPlan(t) {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ['PRODUCT_GOAL.md', 'architecture/SOURCE_BASELINE.json', 'docs/ARCHITECTURE_BASELINE.md', 'work/DECISION_REQUESTS.md']) {
    write(root, path, readFileSync(resolve(path), 'utf8'));
  }
  write(root, 'docs/DECISIONS.md', 'Verified architecture decision. '.repeat(60));
  const composition = JSON.parse(readFileSync(resolve('architecture/composition.json')));
  composition.status = 'approved';
  for (const role of composition.roles) Object.assign(role, { status: 'provided', implementation: 'Test fixture',
    version: '1.0.0', license: 'MIT', owner: 'Platform team', reason: 'Test fixture provides every required role',
    contracts: ['Versioned public contract'], verification: ['Executable contract test'] });
  write(root, 'architecture/composition.json', JSON.stringify(composition));
  const roadmap = JSON.parse(readFileSync(resolve('work/ROADMAP.json')));
  roadmap.status = 'approved';
  const save = () => write(root, 'work/ROADMAP.json', JSON.stringify(roadmap));
  save();
  return { root, roadmap, save };
}

test('an approved complete acyclic roadmap is accepted', (t) => {
  const { root } = approvedPlan(t);
  const result = run(root, 'validate', 'plan');
  assert.equal(result.status, 0, result.stderr);
});

test('roadmap cycles are rejected even if every AC is covered', (t) => {
  const { root, roadmap, save } = approvedPlan(t);
  roadmap.milestones[1].dependsOn = [roadmap.milestones[2].id];
  roadmap.milestones[2].dependsOn = [roadmap.milestones[1].id];
  save();
  assert.match(run(root, 'validate', 'plan').stderr, /循環依存/u);
});

test('unknown roadmap acceptance criteria are rejected', (t) => {
  const { root, roadmap, save } = approvedPlan(t);
  roadmap.milestones[0].acceptanceCriteria.push('AC-999');
  save();
  assert.match(run(root, 'validate', 'plan').stderr, /未知の受入条件/u);
});

test('roadmap outcomes must be nonempty text', (t) => {
  const { root, roadmap, save } = approvedPlan(t);
  roadmap.milestones[0].outcomes = [' '];
  save();
  assert.match(run(root, 'validate', 'plan').stderr, /outcomeが空/u);
});

test('a roadmap cannot omit any goal acceptance criterion', (t) => {
  const { root, roadmap, save } = approvedPlan(t);
  for (const milestone of roadmap.milestones) milestone.acceptanceCriteria = milestone.acceptanceCriteria.filter((id) => id !== 'AC-006');
  save();
  assert.match(run(root, 'validate', 'plan').stderr, /未対応の受入条件.*AC-006/u);
});

test('self and unknown dependencies are rejected before traversal', (t) => {
  const { root, roadmap, save } = approvedPlan(t);
  for (const dependency of [roadmap.milestones[0].id, 'missing-milestone']) {
    roadmap.milestones[0].dependsOn = [dependency];
    save();
    assert.match(run(root, 'validate', 'plan').stderr, /dependencyが不正/u);
  }
});
