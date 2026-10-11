import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { resolveRuntimeProviderFile } from '../node_modules/takt/dist/infra/config/runtime-provider/loader.js';
import { getGlobalConfigDir } from '../node_modules/takt/dist/infra/config/paths.js';
import { compileProviderEnvironment } from '../node_modules/takt/dist/infra/config/runtime-provider/environment.js';
import { resolveStepProviderModel } from '../node_modules/takt/dist/core/workflow/provider-resolution.js';
import { resolvePromotionRuntime } from '../node_modules/takt/dist/core/workflow/promotion/promotion-runtime.js';
import { resolveProfileScopedProviderOptionsLayers } from '../node_modules/takt/dist/infra/config/providerOptions.js';

// TAKT 0.70.0の実際のcompiler/resolverを使用する。更新時はrouting testも更新する。
export async function routes(root, { globalConfigDir = getGlobalConfigDir() } = {}) {
  const file = resolveRuntimeProviderFile({ globalConfigDir, projectConfigDir: resolve(root, '.takt') });
  const env = compileProviderEnvironment({ kind: 'runtime-v1', section: file.provider });
  const workflow = parse(readFileSync(resolve(root, '.takt/workflows/platform-lifecycle.yaml'), 'utf8'));
  const result = [];
  for (const step of workflow.steps) {
    const target = { ...step, personaDisplayName: step.persona };
    const initial = resolveStepProviderModel({ ...env, tagConflictPolicy: env.tagConflictPolicy, step: target });
    initial.providerOptions = resolveProfileScopedProviderOptionsLayers(target, env, initial.providerSource, true).at(-1)?.options ?? env.providerOptions;
    const progression = [];
    const efforts = [];
    for (const iteration of [1, 2, 3, 4]) {
      const promoted = await resolvePromotionRuntime({
        providerLadders: env.providerLadders,
        providerRoutingTagConflictPolicy: env.tagConflictPolicy,
        resolveStepProviderModel: () => initial,
      }, target, iteration, { providerInfo: initial });
      progression.push(promoted.providerInfo.model);
      efforts.push(promoted.providerInfo.providerOptions?.codex?.reasoningEffort);
    }
    result.push({ step: step.name, provider: initial.provider, model: initial.model, progression, efforts,
      providerOptions: initial.providerOptions });
  }
  return { steps: result, internalAgents: env.internalAgents, defaultModel: env.model, runtime: file };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await routes(resolve(import.meta.dirname, '..'));
  for (const step of result.steps) process.stdout.write(`${step.step}: ${step.progression.map((model, i) => `${model}/${step.efforts[i]}`).join(' -> ')}\n`);
  process.stdout.write(`loop-judge: ${result.internalAgents.loopJudge.model}\n`);
}
