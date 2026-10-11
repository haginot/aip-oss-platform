import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CodexProvider } from '../node_modules/takt/dist/infra/providers/codex.js';
import { routes } from './model-routing.mjs';
import { selectCodex } from './codex-runtime.mjs';

const root = resolve(import.meta.dirname, '..');
const cli = selectCodex();
process.env.TAKT_CODEX_CLI_PATH = cli.path;
const routing = await routes(root);
const runtimeDigest = createHash('sha256').update(JSON.stringify(routing.runtime)).digest('hex');
const results = [];
const receipt = { schemaVersion: 1, checkedAt: new Date().toISOString(), transport: 'takt-codex-provider',
  cli: { path: cli.path, version: cli.version }, runtimeDigest, status: 'running', results };
const saveReceipt = () => writeFileSync(resolve(root, 'evidence/model-smoke.json'), `${JSON.stringify(receipt, null, 2)}\n`);
// 中断した接続確認で、以前の成功receiptを再利用しない。
saveReceipt();
const agent = new CodexProvider().setup({ name: 'platform-connection-check' });
// 実際のTAKT provider/SDKと採用effortを使う。初期化競合を避け、直列に確認する。
for (const name of ['frame-goal', 'build-foundation', 'review-goal', 'review-architecture']) {
  const step = routing.steps.find((item) => item.step === name);
  const model = step.model;
  let outcome;
  try {
    const response = await agent.call('Do not use tools or read files. Reply only READY.', {
      cwd: root, model, providerOptions: step.providerOptions, permissionMode: 'readonly',
      abortSignal: AbortSignal.timeout(60000),
    });
    outcome = { model, effort: step.efforts[0],
      status: response.status === 'done' && response.content.trim() === 'READY' ? 'passed' : 'failed',
      providerStatus: response.status,
      ...(response.providerUsage ? { usage: response.providerUsage } : {}),
      ...(response.status !== 'done' ? { error: response.error ?? response.content } : {}),
    };
  } catch (error) {
    outcome = { model, effort: step.efforts[0], status: 'failed', error: error.message };
  }
  results.push(outcome);
  saveReceipt();
  process.stdout.write(`${outcome.status.toUpperCase()} ${model}/${outcome.effort ?? 'unknown'} (TAKT provider)\n`);
}
receipt.checkedAt = new Date().toISOString();
receipt.status = results.every((result) => result.status === 'passed') ? 'passed' : 'failed';
saveReceipt();
if (receipt.status !== 'passed') process.exitCode = 1;
