#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');

const roleIds = [
  'ingest', 'cdc', 'pipeline', 'transform', 'quality', 'identity-map', 'blob',
  'lake-table', 'analytics', 'ontology', 'object-api', 'object-store', 'graph',
  'text-search', 'retrieval', 'history', 'metrics', 'rules', 'compute', 'action',
  'workflow', 'writeback', 'event', 'stream', 'trigger', 'agent', 'model',
  'embedding', 'parse', 'ai-eval', 'guard', 'feature', 'identity',
  'relationship-auth', 'attribute-auth', 'delegation', 'secrets', 'metadata',
  'audit', 'observability', 'schema-release', 'deployment', 'gateway', 'cache',
  'recovery', 'business-ui', 'authoring-ui',
];

const mandatoryRoles = new Set([
  'ontology', 'object-api', 'object-store', 'action', 'identity', 'attribute-auth',
  'delegation', 'secrets', 'audit', 'observability', 'schema-release', 'deployment',
  'recovery', 'business-ui', 'authoring-ui',
]);

const acceptanceByStage = {
  implementation: ['AC-002', 'AC-003', 'AC-004'],
  demo: ['AC-005'],
  bcp: ['AC-006'],
  release: ['AC-001', 'AC-007', 'AC-008'],
};

class ValidationError extends Error {}

function fail(message) {
  throw new ValidationError(message);
}

function projectPath(path) {
  if (typeof path !== 'string' || path.trim() === '') fail('空のpathは使用できません');
  const absolute = resolve(projectRoot, path);
  if (absolute !== projectRoot && !absolute.startsWith(`${projectRoot}${sep}`)) {
    fail(`project外のpathは使用できません: ${path}`);
  }
  let ancestor = absolute;
  while (!existsSync(ancestor) && ancestor !== projectRoot) ancestor = dirname(ancestor);
  const actual = realpathSync(ancestor);
  const actualRoot = realpathSync(projectRoot);
  if (actual !== actualRoot && !actual.startsWith(`${actualRoot}${sep}`)) {
    fail(`symlink経由でproject外のpathは使用できません: ${path}`);
  }
  return absolute;
}

function readText(path) {
  const absolute = projectPath(path);
  if (!existsSync(absolute)) fail(`必須fileがありません: ${path}`);
  return readFileSync(absolute, 'utf8');
}

function requireText(path, minChars, { allowDraftLanguage = false } = {}) {
  const content = readText(path);
  if (content.trim().length < minChars) {
    fail(`${path} の内容が不足しています (${content.trim().length}/${minChars} chars)`);
  }
  if (!allowDraftLanguage && /\b(?:TODO|TBD|FIXME|CHANGEME)\b|要記入|未記入|<[^>\n]{2,80}>/iu.test(content)) {
    fail(`${path} に未解決のplaceholderがあります`);
  }
  return content;
}

function readJson(path) {
  const content = readText(path);
  try {
    return JSON.parse(content);
  } catch (error) {
    fail(`${path} が正しいJSONではありません: ${error.message}`);
  }
}

function writeJson(path, value) {
  const absolute = projectPath(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(path) {
  return sha256(readFileSync(projectPath(path)));
}

function validateSourceBaseline() {
  const baseline = readJson('architecture/SOURCE_BASELINE.json');
  if (baseline.schemaVersion !== 1 || baseline.runtimeDependency !== false) {
    fail('SOURCE_BASELINEのschemaVersionまたはruntimeDependencyが不正です');
  }
  if (!Array.isArray(baseline.files) || baseline.files.length < 4) {
    fail('SOURCE_BASELINEに設計出典が不足しています');
  }
  for (const source of baseline.files) {
    if (typeof source.path !== 'string' || !/^[a-f0-9]{64}$/u.test(source.sha256 ?? '')) {
      fail('SOURCE_BASELINEのpathまたはsha256が不正です');
    }
  }
}

function acceptanceIdsFromGoal() {
  const goal = requireText('PRODUCT_GOAL.md', 3000);
  const ids = [...new Set(goal.match(/AC-\d{3}/gu) ?? [])].sort();
  const expected = Array.from({ length: 9 }, (_, index) => `AC-${String(index + 1).padStart(3, '0')}`);
  if (JSON.stringify(ids) !== JSON.stringify(expected)) {
    fail(`PRODUCT_GOAL.mdの受入条件IDが不正です: ${ids.join(', ')}`);
  }
  return ids;
}

function validateGoal() {
  validateSourceBaseline();
  const goal = requireText('PRODUCT_GOAL.md', 3000);
  const concepts = ['完成の定義', 'アーキテクチャ上の不変条件', '範囲外', '証拠', '自律実行の境界', '停止条件'];
  for (const concept of concepts) {
    if (!goal.includes(concept)) fail(`PRODUCT_GOAL.mdに「${concept}」がありません`);
  }
  acceptanceIdsFromGoal();
}

function validateArchitecture() {
  validateGoal();
  requireText('docs/ARCHITECTURE_BASELINE.md', 3000);
  requireText('docs/DECISIONS.md', 1000);
  const composition = readJson('architecture/composition.json');
  if (composition.schemaVersion !== 1 || composition.status !== 'approved') {
    fail('compositionはschemaVersion 1かつstatus approvedである必要があります');
  }
  if (!Array.isArray(composition.roles)) fail('composition.rolesが配列ではありません');
  const actualIds = composition.roles.map((role) => role.id).sort();
  const expectedIds = [...roleIds].sort();
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    const missing = expectedIds.filter((id) => !actualIds.includes(id));
    const extra = actualIds.filter((id) => !expectedIds.includes(id));
    fail(`compositionの47責務が一致しません missing=[${missing}] extra=[${extra}]`);
  }
  const seen = new Set();
  for (const role of composition.roles) {
    if (seen.has(role.id)) fail(`composition roleが重複しています: ${role.id}`);
    seen.add(role.id);
    if (!['selected', 'provided', 'not-needed'].includes(role.status)) {
      fail(`${role.id}のstatusが未決定または不正です: ${role.status}`);
    }
    if (mandatoryRoles.has(role.id) && role.status === 'not-needed') {
      fail(`初版の必須責務をnot-neededにできません: ${role.id}`);
    }
    if (role.status === 'not-needed') {
      if (typeof role.reason !== 'string' || role.reason.trim().length < 20) {
        fail(`${role.id}をnot-neededにする理由が不足しています`);
      }
      continue;
    }
    for (const field of ['implementation', 'version', 'license', 'owner', 'reason']) {
      if (typeof role[field] !== 'string' || role[field].trim().length < 2) {
        fail(`${role.id}に${field}がありません`);
      }
    }
    for (const field of ['contracts', 'verification']) {
      if (!Array.isArray(role[field]) || role[field].length === 0 || role[field].some((item) => typeof item !== 'string' || item.trim() === '')) {
        fail(`${role.id}に${field}の具体的な項目がありません`);
      }
    }
  }
}

function validatePlan() {
  validateArchitecture();
  const goalIds = acceptanceIdsFromGoal();
  const roadmap = readJson('work/ROADMAP.json');
  if (roadmap.schemaVersion !== 1 || roadmap.status !== 'approved') {
    fail('ROADMAPはschemaVersion 1かつstatus approvedである必要があります');
  }
  if (!Array.isArray(roadmap.milestones) || roadmap.milestones.length < 5) {
    fail('ROADMAPには5件以上のmilestoneが必要です');
  }
  const ids = new Set();
  const covered = new Set();
  for (const milestone of roadmap.milestones) {
    if (typeof milestone.id !== 'string' || milestone.id.trim() === '' || ids.has(milestone.id)) fail(`milestone idが不正または重複しています: ${milestone.id}`);
    ids.add(milestone.id);
    if (!['planned', 'active', 'completed', 'blocked'].includes(milestone.status)) {
      fail(`${milestone.id}のstatusが不正です`);
    }
    if (!Array.isArray(milestone.dependsOn) || !Array.isArray(milestone.acceptanceCriteria) || !Array.isArray(milestone.outcomes) || milestone.outcomes.length === 0) {
      fail(`${milestone.id}のdependsOn、acceptanceCriteria、outcomesが不正です`);
    }
    if (milestone.outcomes.some((outcome) => typeof outcome !== 'string' || outcome.trim() === '')) fail(`${milestone.id}のoutcomeが空です`);
    for (const id of milestone.acceptanceCriteria) {
      if (!goalIds.includes(id)) fail(`${milestone.id}に未知の受入条件があります: ${id}`);
      covered.add(id);
    }
  }
  for (const milestone of roadmap.milestones) {
    for (const dependency of milestone.dependsOn) {
      if (!ids.has(dependency) || dependency === milestone.id) fail(`${milestone.id}のdependencyが不正です: ${dependency}`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(roadmap.milestones.map((milestone) => [milestone.id, milestone]));
  const visit = (id) => {
    if (visiting.has(id)) fail(`ROADMAPに循環依存があります: ${[...visiting, id].join(' -> ')}`);
    if (visited.has(id)) return;
    visiting.add(id);
    byId.get(id).dependsOn.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  ids.forEach(visit);
  const uncovered = goalIds.filter((id) => !covered.has(id));
  if (uncovered.length > 0) fail(`ROADMAPに未対応の受入条件があります: ${uncovered.join(', ')}`);
  requireText('work/DECISION_REQUESTS.md', 300);
}

const ignoredDirectories = new Set(['.git', 'node_modules', 'runs', 'worktrees', 'logs']);

function collectFiles(path) {
  const absolute = projectPath(path);
  if (absolute === projectRoot) fail('verification input/outputにproject rootは指定できません');
  if (!existsSync(absolute)) fail(`verification対象がありません: ${path}`);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) fail(`verification対象にsymlinkは使用できません: ${path}`);
  if (stat.isFile()) return [relative(projectRoot, absolute)];
  if (!stat.isDirectory()) return [];
  const output = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const child = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`verification対象にsymlinkは使用できません: ${relative(projectRoot, child)}`);
      if (entry.isDirectory()) walk(child);
      if (entry.isFile()) output.push(relative(projectRoot, child));
    }
  };
  walk(absolute);
  return output.sort();
}

function digestPaths(paths) {
  const files = [...new Set(paths.flatMap((path) => {
    const entries = collectFiles(path);
    if (entries.length === 0) fail(`verification対象にfileがありません: ${path}`);
    return entries;
  }))].sort();
  const entries = files.map((path) => ({ path, sha256: sha256File(path) }));
  const digest = sha256(Buffer.from(entries.map((entry) => `${entry.path}\0${entry.sha256}\n`).join(''), 'utf8'));
  return { digest, fileCount: entries.length, entries };
}

function validateSuiteDefinition(suite) {
  for (const field of ['id', 'stage', 'description']) {
    if (typeof suite[field] !== 'string' || suite[field].trim() === '') fail(`verification suiteに${field}がありません`);
  }
  if (!Array.isArray(suite.commands) || suite.commands.length === 0) fail(`${suite.id}にcommandsがありません`);
  for (const argv of suite.commands) {
    if (!Array.isArray(argv) || argv.length === 0 || argv.some((arg) => typeof arg !== 'string' || arg === '')) {
      fail(`${suite.id}のcommandは空でないargv配列である必要があります`);
    }
    if (['true', 'echo', 'printf'].includes(argv[0])) fail(`${suite.id}に検査しないcommandは使用できません: ${argv[0]}`);
    if (argv.join(' ').includes('platform-control.mjs run-stage')) fail(`${suite.id}からrun-stageを再帰呼び出しできません`);
  }
  if (!Array.isArray(suite.inputs) || suite.inputs.length === 0) fail(`${suite.id}にinputsがありません`);
  if (!Array.isArray(suite.outputs)) fail(`${suite.id}のoutputsが配列ではありません`);
  if (!Number.isInteger(suite.timeoutMs) || suite.timeoutMs < 1000 || suite.timeoutMs > 3_600_000) {
    fail(`${suite.id}のtimeoutMsが範囲外です`);
  }
}

function verificationPlan() {
  const plan = readJson('verification/plan.json');
  if (plan.schemaVersion !== 1 || !Array.isArray(plan.suites)) fail('verification planのschemaが不正です');
  const ids = new Set();
  for (const suite of plan.suites) {
    validateSuiteDefinition(suite);
    if (ids.has(suite.id)) fail(`verification suite idが重複しています: ${suite.id}`);
    ids.add(suite.id);
  }
  return plan;
}

function suiteDigest(suite) {
  return sha256(Buffer.from(JSON.stringify(suite), 'utf8'));
}

function saveRun(run) {
  const manifest = readJson('evidence/run-manifest.json');
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.runs)) fail('run manifestのschemaが不正です');
  const index = manifest.runs.findIndex((candidate) => candidate.id === run.id);
  if (index < 0) manifest.runs.push(run);
  else manifest.runs[index] = run;
  writeJson('evidence/run-manifest.json', manifest);
}

function runStage(stage) {
  const plan = verificationPlan();
  const suites = plan.suites.filter((suite) => suite.stage === stage);
  if (suites.length === 0) fail(`stage ${stage} のverification suiteがありません`);
  const startedAt = new Date().toISOString();
  const run = {
    id: `${startedAt.replace(/[-:.TZ]/gu, '')}-${stage}-${randomBytes(3).toString('hex')}`,
    stage,
    startedAt,
    finishedAt: null,
    status: 'running',
    suites: [],
  };
  saveRun(run);
  let passed = true;
  for (const suite of suites) {
    process.stdout.write(`\n[${suite.id}] ${suite.description}\n`);
    const commandResults = [];
    let inputs;
    let outputs;
    let suiteError;
    try {
      inputs = digestPaths(suite.inputs);
      for (const argv of suite.commands) {
        const commandStarted = Date.now();
        process.stdout.write(`$ ${argv.join(' ')}\n`);
        const result = spawnSync(argv[0], argv.slice(1), {
          cwd: projectRoot,
          encoding: 'utf8',
          timeout: suite.timeoutMs,
          env: process.env,
          maxBuffer: 16 * 1024 * 1024,
        });
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
        const exitCode = result.status ?? 1;
        commandResults.push({
          argv,
          exitCode,
          durationMs: Date.now() - commandStarted,
          stdoutSha256: sha256(Buffer.from(result.stdout ?? '', 'utf8')),
          stderrSha256: sha256(Buffer.from(result.stderr ?? result.error?.message ?? '', 'utf8')),
          ...(result.error ? { error: result.error.message } : {}),
        });
        if (exitCode !== 0 || result.error) {
          passed = false;
          break;
        }
      }
      if (inputs.digest !== digestPaths(suite.inputs).digest) fail(`${suite.id}の実行中に入力が変更されています`);
      outputs = digestPaths(suite.outputs);
    } catch (error) {
      passed = false;
      suiteError = error.message;
      process.stderr.write(`${suiteError}\n`);
    }
    run.suites.push({
      id: suite.id,
      status: !suiteError && commandResults.length === suite.commands.length && commandResults.every((command) => command.exitCode === 0 && !command.error) ? 'passed' : 'failed',
      planDigest: suiteDigest(suite),
      inputs: inputs ? { digest: inputs.digest, fileCount: inputs.fileCount } : null,
      outputs: outputs ? { digest: outputs.digest, fileCount: outputs.fileCount, artifacts: outputs.entries } : null,
      commands: commandResults,
      ...(suiteError ? { error: suiteError } : {}),
    });
    saveRun(run);
    if (!passed) break;
  }
  run.finishedAt = new Date().toISOString();
  run.status = passed && run.suites.length === suites.length ? 'passed' : 'failed';
  saveRun(run);
  if (run.status !== 'passed') fail(`verification stage failed: ${stage} (${run.id})`);
  process.stdout.write(`verification stage passed: ${stage} (${run.id})\n`);
}

function validateStageEvidence(stage) {
  const plan = verificationPlan();
  const suites = plan.suites.filter((suite) => suite.stage === stage);
  if (suites.length === 0) fail(`stage ${stage} のverification suiteがありません`);
  const manifest = readJson('evidence/run-manifest.json');
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.runs)) fail('run manifestのschemaが不正です');
  const run = [...manifest.runs].reverse().find((candidate) => candidate.stage === stage);
  if (!run || run.status !== 'passed') fail(`stage ${stage} の最新receiptが成功ではありません: ${run?.status ?? '未実行'}`);
  for (const suite of suites) {
    const receipt = run.suites?.find((candidate) => candidate.id === suite.id && candidate.status === 'passed');
    if (!receipt) fail(`${run.id}にsuite ${suite.id}の成功記録がありません`);
    if (!Array.isArray(receipt.commands) || receipt.commands.length !== suite.commands.length || receipt.commands.some((command, index) => command.exitCode !== 0 || command.error || JSON.stringify(command.argv) !== JSON.stringify(suite.commands[index]))) {
      fail(`${suite.id}のcommand成功記録が不正です`);
    }
    if (receipt.planDigest !== suiteDigest(suite)) fail(`${suite.id}は成功後にsuite定義が変更されています`);
    const inputs = digestPaths(suite.inputs);
    if (receipt.inputs?.digest !== inputs.digest) fail(`${suite.id}は成功後に入力が変更されています`);
    const outputs = suite.outputs.length > 0 ? digestPaths(suite.outputs) : { digest: sha256(Buffer.alloc(0)) };
    if (receipt.outputs?.digest !== outputs.digest) fail(`${suite.id}は成功後に出力artifactが変更されています`);
  }
}

function acceptanceMatrix() {
  const lines = readText('evidence/ACCEPTANCE_MATRIX.md').split(/\r?\n/u);
  const rows = new Map();
  for (const line of lines) {
    if (!/^\|\s*AC-\d{3}\s*\|/u.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 4) fail(`ACCEPTANCE_MATRIXの行が不正です: ${line}`);
    const [id, status, evidence, residualRisk] = cells;
    if (rows.has(id)) fail(`ACCEPTANCE_MATRIXのIDが重複しています: ${id}`);
    if (!['PASS', 'READY_FOR_REVIEW', 'NOT_RUN', 'FAIL', 'BLOCKED'].includes(status)) {
      fail(`${id}のstatusが不正です: ${status}`);
    }
    rows.set(id, { status, evidence, residualRisk });
  }
  const expected = acceptanceIdsFromGoal();
  if (rows.size !== expected.length || expected.some((id) => !rows.has(id))) {
    fail('ACCEPTANCE_MATRIXにAC-001〜AC-009が一意に必要です');
  }
  return rows;
}

function requireAcceptancePass(ids) {
  const matrix = acceptanceMatrix();
  for (const id of ids) {
    const row = matrix.get(id);
    if (row.status !== 'PASS') fail(`${id}がPASSではありません: ${row.status}`);
    if (['', 'なし', '—', '-'].includes(row.evidence)) fail(`${id}のevidenceがありません`);
  }
}

function validateImplementation() {
  validatePlan();
  requireText('docs/IMPLEMENTATION.md', 1200);
  validateStageEvidence('implementation');
  requireAcceptancePass(acceptanceByStage.implementation);
}

function validateDemo() {
  validateImplementation();
  requireText('docs/DEMO_SCENARIOS.md', 2500);
  requireText('docs/DEMO_RUNBOOK.md', 1200);
  validateStageEvidence('demo');
  requireAcceptancePass(acceptanceByStage.demo);
}

function validateBcp() {
  validateDemo();
  requireText('ops/BCP.md', 1800);
  validateStageEvidence('bcp');
  requireAcceptancePass(acceptanceByStage.bcp);
}

function validateRelease() {
  validateBcp();
  requireText('docs/RELEASE.md', 1600);
  validateStageEvidence('release');
  requireAcceptancePass(acceptanceByStage.release);
}

function validateFinal() {
  validateStageEvidence('mechanism');
  validateRelease();
  const matrix = acceptanceMatrix();
  for (const id of acceptanceIdsFromGoal().filter((candidate) => candidate !== 'AC-009')) {
    if (matrix.get(id).status !== 'PASS') fail(`${id}が最終監査可能な状態ではありません`);
  }
  const finalStatus = matrix.get('AC-009').status;
  if (!['READY_FOR_REVIEW', 'PASS'].includes(finalStatus)) {
    fail(`AC-009はREADY_FOR_REVIEWまたはPASSである必要があります: ${finalStatus}`);
  }
  if (['', 'なし', '—', '-'].includes(matrix.get('AC-009').evidence)) {
    fail('AC-009に機械監査のevidenceがありません');
  }
}

const validators = {
  goal: validateGoal,
  architecture: validateArchitecture,
  'architecture-receipt': () => { validateArchitecture(); validateStageEvidence('architecture'); },
  plan: validatePlan,
  mechanism: () => validateStageEvidence('mechanism'),
  implementation: validateImplementation,
  demo: validateDemo,
  bcp: validateBcp,
  release: validateRelease,
  final: validateFinal,
};

function status() {
  const stages = ['goal', 'architecture', 'plan', 'mechanism', 'implementation', 'demo', 'bcp', 'release', 'final'];
  let firstFailure = null;
  for (const stage of stages) {
    try {
      validators[stage]();
      process.stdout.write(`PASS  ${stage}\n`);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      process.stdout.write(`WAIT  ${stage}: ${error.message}\n`);
      firstFailure ??= stage;
    }
  }
  process.stdout.write(`\ncurrent boundary: ${firstFailure ?? 'machine-ready for final independent audit'}\n`);
}

function usage() {
  process.stdout.write('platform-control commands:\n\n');
  process.stdout.write(`  validate <${Object.keys(validators).join('|')}>\n`);
  process.stdout.write('  run-stage <mechanism|architecture|implementation|demo|bcp|release>\n');
  process.stdout.write('  status\n');
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'validate') {
    const stage = args[0];
    if (!validators[stage]) fail(`未知のvalidation stageです: ${stage ?? '(none)'}`);
    validators[stage]();
    process.stdout.write(`platform validation passed: ${stage}\n`);
  } else if (command === 'run-stage') {
    const stage = args[0];
    if (!stage) fail('run-stageにstageが必要です');
    runStage(stage);
  } else if (command === 'status') {
    status();
  } else {
    usage();
    if (command) process.exitCode = 1;
  }
} catch (error) {
  if (error instanceof ValidationError) {
    process.stderr.write(`platform-control: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
