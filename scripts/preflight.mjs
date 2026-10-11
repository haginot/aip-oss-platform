#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { constants, accessSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const errors = [];

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 22)) {
  errors.push(`Node.js 22.22以上が必要です（現在 ${process.versions.node}）`);
}

if (!existsSync(resolve(root, 'node_modules/.bin/takt'))) {
  errors.push('TAKTが未installです。npm installを実行してください');
}

const gitRepo = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8' });
if (gitRepo.status !== 0 || gitRepo.stdout.trim() !== 'true') {
  errors.push('TAKTの隔離taskに必要なGit repositoryがありません');
} else {
  const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (head.status !== 0) errors.push('TAKTの隔離taskに必要な初回commitがありません');
}

for (const path of [
  'PRODUCT_GOAL.md',
  '.takt/workflows/platform-lifecycle.yaml',
  '.takt/tasks.yaml',
  'verification/plan.json',
]) {
  if (!existsSync(resolve(root, path))) errors.push(`必須fileがありません: ${path}`);
}

const gatePath = resolve(root, '.takt/quality-gates/platform-gate.sh');
try {
  accessSync(gatePath, constants.X_OK);
} catch {
  errors.push('quality gateに実行権限がありません: .takt/quality-gates/platform-gate.sh');
}

const taskFile = resolve(root, '.takt/tasks.yaml');
if (existsSync(taskFile)) {
  const taskConfig = readFileSync(taskFile, 'utf8');
  for (const required of [
    'worktree: true',
    'auto_pr: false',
    'status: pending',
    'workflow: platform-lifecycle',
  ]) {
    if (!taskConfig.includes(required)) errors.push(`初期TAKT taskの設定が不足しています: ${required}`);
  }
}

if (errors.length > 0) {
  process.stderr.write('preflight failed:\n');
  errors.forEach((error) => process.stderr.write(`- ${error}\n`));
  process.exitCode = 1;
} else {
  process.stdout.write(`preflight passed (Node.js ${process.versions.node}, Git HEADあり, TAKT install済み)\n`);
}
