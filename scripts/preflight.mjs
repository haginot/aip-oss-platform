#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { constants, accessSync, existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { parse } from 'yaml';
import { routes } from './model-routing.mjs';
import { selectCodex } from './codex-runtime.mjs';

const root = resolve(import.meta.dirname, '..');
const strict = process.argv.includes('--strict');
const errors = [];
const check = async (name, operation) => {
  try { await operation(); process.stdout.write(`PASS ${name}\n`); }
  catch (error) { errors.push(`${name}: ${error.message}`); }
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000 });
let cli;
let routing;

await check('Node/TAKT', () => {
  const [major, minor] = process.versions.node.split('.').map(Number);
  assert(major > 22 || (major === 22 && minor >= 22), 'Node.js 22.22以上が必要です');
  assert(existsSync(resolve(root, 'node_modules/.bin/takt')), 'npm ciを実行してください');
  assert(JSON.parse(readFileSync(resolve(root, 'node_modules/takt/package.json'))).version === '0.70.0', 'TAKTは検証済みの0.70.0に固定してください');
});
await check('Git/隔離実行入力', () => {
  assert(git('rev-parse', '--verify', 'HEAD').status === 0, '初回commitが必要です');
  if (!strict) return;
  const dynamic = new Set(['.takt/tasks.yaml', 'evidence/run-manifest.json', 'evidence/model-smoke.json']);
  const state = git('status', '--porcelain', '--untracked-files=normal');
  assert(state.status === 0, 'Git状態を取得できません');
  const dirty = state.stdout.trimEnd().split('\n').filter(Boolean).filter((line) => !dynamic.has(line.slice(3)));
  assert(dirty.length === 0, `隔離cloneに渡す成果物をcommitしてください: ${dirty.join(', ')}`);
});
await check('設計出典の実hash', () => {
  const baseline = JSON.parse(readFileSync(resolve(root, 'architecture/SOURCE_BASELINE.json')));
  const directory = resolve(baseline.sourceDirectory);
  for (const file of baseline.files) {
    const path = resolve(directory, file.path);
    assert(path.startsWith(`${directory}${sep}`), '設計出典pathが不正です');
    const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
    assert(hash === file.sha256, `設計出典が変更されています: ${file.path}`);
  }
});
await check('Queue/品質gate', () => {
  const queue = parse(readFileSync(resolve(root, '.takt/tasks.yaml'), 'utf8'));
  assert(Array.isArray(queue.tasks), 'queueが配列ではありません');
  const pending = queue.tasks.filter((task) => task.status === 'pending');
  if (strict) assert(pending.length > 0, 'pending taskがありません。takt listから再開位置を確認してください');
  for (const task of pending) {
    assert(task.worktree === true && task.auto_pr === false && task.workflow === 'platform-lifecycle', '隔離実行・自動PR無効・workflowを確認してください');
    assert(existsSync(resolve(root, task.task_dir, 'order.md')), 'task orderがありません');
  }
  accessSync(resolve(root, '.takt/quality-gates/platform-gate.sh'), constants.X_OK);
});
await check('モデル配分', async () => {
  for (const key of ['TAKT_PROVIDER', 'TAKT_MODEL', 'TAKT_RUNTIME_ASSIGNMENT', 'TAKT_RUNTIME_FILE']) {
    assert(!process.env[key], `${key}でプロジェクトのモデル配分を上書きしないでください`);
  }
  routing = await routes(root);
  assert(routing.steps.length === 14, '14工程が必要です');
  for (const name of ['review-architecture', 'review-foundation', 'review-bcp', 'final-audit']) {
    assert(routing.steps.find((step) => step.step === name)?.model === 'gpt-6-astra', `${name}はAstraで監査してください`);
  }
});
await check('Codex認証', () => {
  cli = selectCodex();
  const auth = spawnSync(cli.path, ['login', 'status'], { encoding: 'utf8', timeout: 15000 });
  assert(auth.status === 0, `選択CLIで認証してください: ${cli.path}`);
  process.stdout.write(`CLI ${cli.version}: ${cli.path}\n`);
});
await check('モデル接続receipt', () => {
  assert(cli && routing, 'CLIとモデル配分の検査を先に解決してください');
  const path = resolve(root, 'evidence/model-smoke.json');
  assert(existsSync(path), 'npm run platform:modelsを実行してください');
  const receipt = JSON.parse(readFileSync(path));
  const digest = createHash('sha256').update(JSON.stringify(routing.runtime)).digest('hex');
  assert(receipt.schemaVersion === 1 && receipt.transport === 'takt-codex-provider' && receipt.status === 'passed' && receipt.runtimeDigest === digest && receipt.cli.path === cli.path && receipt.cli.version === cli.version, 'モデル配分またはCLI変更後はplatform:modelsを再実行してください');
  const age = Date.now() - Date.parse(receipt.checkedAt);
  assert(Number.isFinite(age) && age >= 0 && age < 86400000, '接続確認は24時間有効です。platform:modelsを再実行してください');
  for (const name of ['frame-goal', 'build-foundation', 'review-goal', 'review-architecture']) {
    const step = routing.steps.find((item) => item.step === name);
    const model = step.model;
    const effort = step.efforts[0];
    assert(receipt.results.some((item) => item.model === model && item.effort === effort && item.status === 'passed'), `${model}/${effort}の接続未確認です`);
  }
});
await check('機械検証の最新receipt', () => {
  const result = spawnSync(process.execPath, ['scripts/platform-control.mjs', 'validate', 'mechanism'], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert(result.status === 0, result.stderr.trim() || 'npm run verify:mechanismを実行してください');
});
if (errors.length) {
  process.stderr.write(`preflight failed:\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
  process.exitCode = 1;
} else process.stdout.write(`preflight passed${strict ? ' (isolated launch ready)' : ' (local checks; commit状態はstrictで確認)'}\n`);
