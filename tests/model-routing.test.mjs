import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { routes } from '../scripts/model-routing.mjs';

const root = resolve(import.meta.dirname, '..');
const workflow = parse(readFileSync(resolve(root, '.takt/workflows/platform-lifecycle.yaml'), 'utf8'));
const isolatedGlobal = mkdtempSync(join(tmpdir(), 'aip-routing-global-'));
test.after(() => rmSync(isolatedGlobal, { recursive: true, force: true }));
const routing = await routes(root, { globalConfigDir: isolatedGlobal });
const step = (name) => routing.steps.find((item) => item.step === name);

test('the real TAKT compiler resolves every step without tag conflicts', () => {
  assert.equal(routing.steps.length, 14);
  assert.equal(routing.defaultModel, 'gpt-6-luna');
  assert.ok(routing.steps.every((item) => item.provider === 'codex'));
});

test('light planning starts on Luna and promotes to Sol, then Astra', () => {
  for (const name of ['frame-goal', 'plan-roadmap']) {
    assert.deepEqual(step(name).progression, ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-astra']);
    assert.deepEqual(step(name).efforts, ['low', 'medium', 'high', 'high']);
  }
});

test('implementation starts on Sol and uses Astra from its third visit', () => {
  for (const name of ['design-architecture', 'build-foundation', 'build-store-demo', 'build-bcp', 'harden-release']) {
    assert.deepEqual(step(name).progression, ['gpt-6.1-sol', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-astra']);
    assert.deepEqual(step(name).efforts, ['medium', 'medium', 'high', 'high']);
  }
});

test('architecture, security, BCP and final audits never downgrade from Astra', () => {
  for (const name of ['review-architecture', 'review-foundation', 'review-bcp', 'final-audit']) {
    assert.deepEqual(step(name).progression, Array(4).fill('gpt-6-astra'));
    assert.deepEqual(step(name).efforts, Array(4).fill('high'));
    const review = workflow.steps.find((item) => item.name === name);
    assert.equal(review.edit, false);
    assert.equal(review.capabilities, 'readonly');
    assert.ok(!workflow.steps.filter((item) => item.edit).some((item) => item.session_key === review.session_key));
  }
});

test('ordinary reviews and internal agents use their cost-conscious seats', () => {
  for (const name of ['review-goal', 'review-roadmap', 'review-store-demo']) {
    assert.deepEqual(step(name).progression, Array(4).fill('gpt-6.1-sol'));
    assert.deepEqual(step(name).efforts, Array(4).fill('high'));
  }
  assert.equal(routing.internalAgents.assistant.model, 'gpt-6-luna');
  assert.equal(routing.internalAgents.selector.model, 'gpt-6-luna');
  assert.equal(routing.internalAgents.loopJudge.model, 'gpt-6-astra');
  assert.equal(routing.internalAgents.completionRetryJudge.model, 'gpt-6.1-sol');
  for (const item of routing.steps) {
    assert.equal(item.providerOptions.codex.permissionControl, 'takt');
    assert.equal(item.providerOptions.codex.networkAccess, true);
  }
});

test('human stops and backward repair routes do not require a passing gate', () => {
  const indexes = new Map(workflow.steps.map((item, index) => [item.name, index]));
  for (const item of workflow.steps.filter((candidate) => candidate.quality_gates?.some((gate) => gate.type === 'command'))) {
    for (const rule of item.rules) {
      if (rule.next === 'ABORT' || indexes.get(rule.next) < indexes.get(item.name)) {
        assert.equal(rule.command_gates, 'skip', `${item.name} -> ${rule.next}`);
      }
    }
  }
});

test('completion is gated, bounded and isolated; reviewers do not share author sessions', () => {
  assert.equal(workflow.max_steps, 60);
  const final = workflow.steps.find((item) => item.name === 'final-audit');
  assert.equal(final.rules.filter((rule) => rule.next === 'COMPLETE').length, 1);
  assert.notEqual(final.rules.find((rule) => rule.next === 'COMPLETE').command_gates, 'skip');
  assert.ok(final.quality_gates.some((gate) => gate.type === 'command' && gate.command.endsWith(' final')));
  const sessions = workflow.steps.map((item) => item.session_key);
  assert.equal(new Set(sessions).size, sessions.length);
  const queue = parse(readFileSync(resolve(root, '.takt/tasks.yaml'), 'utf8'));
  for (const task of queue.tasks) {
    assert.equal(task.worktree, true);
    assert.equal(task.auto_pr, false);
  }
});
