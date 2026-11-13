// Runs inside the real bounded filesystem/policy with a private mock-only config.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { put, quote, until, alive, launch } from './helpers.mjs';
const [runtime, base, outside, capacityMode = 'fill'] = process.argv.slice(2);
const load = name => import(pathToFileURL(join(runtime, 'dist', name)));
const { startWebUi } = await load('features/web-ui/index.js');
const { openProjectRepository } = await load('features/web-ui/launcher.js');
const { registerProject } = await load('infra/config/global/projectRegistry.js');
const { acquireProjectExecutionLock, getProjectExecutionOwner } = await load('infra/task/project-execution-lock.js');
const { getProcessIdentity, sameProcessIdentity } = await load('infra/task/process.js');
const global = process.env.TAKT_CONFIG_DIR;
put(join(global, 'config.yaml'), { workflow_command_gates: { custom_scripts: true } });
put(process.env.TAKT_MOCK_SCENARIO, [{ content: 'done', delay_ms: 50 }, { content: '[STEP:1]', structured_output: { step: 1 } }]);
const results = { checks: [], processes: [], capacityBytes: fs.statfsSync(base).blocks * fs.statfsSync(base).bsize,
  processIdentity: getProcessIdentity(process.pid) };
const identities = new Map();
function remember(pid) {
  const identity = getProcessIdentity(pid);
  if (identity) identities.set(pid, identity);
}
function kill(pid, signal) {
  assert(sameProcessIdentity(identities.get(pid), getProcessIdentity(pid)), 'Refusing to signal changed process identity');
  process.kill(pid, signal);
}
const projects = [];
for (const name of ['one', 'two']) {
  const root = join(base, name);
  put(join(root, '.takt/runtime.yaml'), { version: 1, provider: { profiles: { fixture: { provider: 'mock', model: 'mock-model' } }, defaults: { profile: 'fixture' } }, loop_analysis: { enabled: false, output: 'file' } });
  const project = await registerProject({ globalConfigDirectory: global, projectDirectory: root, command: 'native-control-fixture' });
  projects.push({ root, project, repo: await openProjectRepository(global, project) });
}
const [a, b] = projects;
let ui, token, lock;
async function request(path, body) {
  const response = await fetch(ui.origin + path, { method: body ? 'POST' : 'GET',
    headers: { origin: ui.origin, ...(token ? { 'x-takt-web-token': token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  return { status: response.status, body: await response.json() };
}
function workflow(p, name, mode = 'normal') {
  const marker = join(p.root, name + '.json'), release = join(p.root, name + '.release');
  const command = 'exec ' + [process.execPath, join(import.meta.dirname, 'http-gate.mjs'), mode, marker, release, outside].map(quote).join(' ');
  put(join(p.root, '.takt/workflows', name + '.yaml'), { name, initial_step: 'probe', max_steps: 2,
    steps: [{ name: 'probe', persona: 'Synthetic control fixture', edit: true, instruction: 'Control test only.',
      quality_gates: [{ type: 'command', name: 'actual-' + name, command, cwd: '.', timeout_ms: 20000 }],
      rules: [{ condition: 'Done', next: 'COMPLETE' }] }] });
  return { marker, release };
}
async function submit(p, name) {
  const response = await request('/api/tasks', { projectId: p.project.id, prompt: name, workflow: name, worktree: false, autoPr: false, draftPr: false });
  assert.equal(response.status, 202, JSON.stringify(response));
  if (response.body.pid) remember(response.body.pid);
  return response.body;
}
async function task(p, name) {
  const all = await p.repo.readTasks();
  for (const t of all) if (t.activeExecution?.pid) remember(t.activeExecution.pid);
  return all.find(t => t.task === name);
}
async function terminal(p, name, status, failure) {
  const out = await until('terminal ' + name, async () => {
    const t = await task(p, name);
    return ['completed', 'failed'].includes(t?.status) && t;
  });
  assert.equal(out.status, status, JSON.stringify(out.failure));
  if (failure) assert.equal(out.failure?.code, failure);
  results.checks.push({ name, status: out.status, failure: out.failure?.code, runId: out.runId });
  return out;
}
async function marker(path) {
  const out = await until('actual gate ' + path, () => fs.existsSync(path) && JSON.parse(fs.readFileSync(path)));
  for (const pid of [out.pid, out.guardian, out.descendant]) remember(pid);
  results.processes.push(out);
  return out;
}
try {
  assert(results.processIdentity, 'Native TAKT process start time must be available');
  ui = await startWebUi({ port: 0 });
  token = (await request('/api/session')).body.token;
  // Pause a freshly spawned genuine worker before admission, then queue via HTTP.
  const first = workflow(a, 'conflict-first'), next = workflow(a, 'conflict-successor');
  lock = acquireProjectExecutionLock(a.root, 'watch');
  const initial = await submit(a, 'conflict-first');
  kill(initial.pid, 'SIGSTOP');
  try {
    const queued = await submit(a, 'conflict-successor');
    assert.equal(queued.disposition, 'reused');
    assert.equal((await task(a, 'conflict-successor')).status, 'pending');
  } finally { kill(initial.pid, 'SIGCONT'); }
  await terminal(a, 'conflict-first', 'failed', 'project_execution_conflict');
  await terminal(a, 'conflict-successor', 'failed', 'project_execution_conflict');
  assert(!fs.existsSync(first.marker) && !fs.existsSync(next.marker));
  assert.equal(getProjectExecutionOwner(a.root).ownerId, lock.owner.ownerId);
  // Another project remains runnable while the first project's CLI lock is held.
  const other = workflow(b, 'independent');
  await submit(b, 'independent');
  await terminal(b, 'independent', 'completed');
  await marker(other.marker);
  lock.release(); lock = undefined;

  const hold = workflow(a, 'hold', 'hold'), follow = workflow(a, 'follow');
  await submit(a, 'hold');
  const held = await marker(hold.marker);
  const active = await task(a, 'hold');
  const heldOwner = getProjectExecutionOwner(a.root);
  assert.equal(heldOwner.pid, active.activeExecution.pid);
  assert(heldOwner.gateGroups.some(group => group.pid === held.guardian
    && sameProcessIdentity(group.processIdentity, getProcessIdentity(held.guardian))), 'Real group identity must be published before gate writes');
  for (const kind of ['run', 'watch']) {
    assert.throws(() => acquireProjectExecutionLock(a.root, kind), /already running/);
    const cli = launch(join(runtime, 'bin/takt'), [kind], process.env, a.root);
    const exit = await cli.done;
    assert.notEqual(exit.code, 0, exit.output);
    assert.match(exit.output, /already running/);
    results.checks.push({ name: 'real-cli-' + kind, code: exit.code });
  }
  assert.equal((await submit(a, 'follow')).disposition, 'reused');
  put(hold.release, 'release');
  const done = await terminal(a, 'hold', 'completed');
  const followed = await terminal(a, 'follow', 'completed');
  const follower = await marker(follow.marker);
  assert.notEqual(done.runId, followed.runId);
  assert.notEqual(held.guardian, follower.guardian);
  await until('normal group cleanup', () => !alive(held.pid) && !alive(held.descendant));

  for (const [signal, killGuardian] of [['SIGTERM', false], ['SIGKILL', false], ['SIGKILL', true]]) {
    const label = signal + (killGuardian ? '-guardian' : '');
    const name = 'crash-' + label;
    const gate = workflow(a, name, 'hold');
    await submit(a, name);
    const child = await marker(gate.marker);
    const current = await task(a, name);
    const pid = current.activeExecution.pid;
    const heartbeatPath = gate.marker + '.heartbeat';
    await until('old gate heartbeat started', () => fs.existsSync(heartbeatPath) && fs.statSync(heartbeatPath).size > 0);
    // Keep the real cleanup monitors paused, not the writing gate. This makes
    // the death-to-cleanup window deterministic without substituting identity.
    const children = execFileSync('/usr/bin/pgrep', ['-P', String(child.guardian)], { encoding: 'utf8' }).trim().split(/\s+/).map(Number);
    const sentinel = children.find(id => id !== child.pid);
    assert(sentinel, 'Actual guardian sentinel must be present');
    const command = execFileSync('/bin/ps', ['-p', String(sentinel), '-o', 'command='], { encoding: 'utf8' });
    assert(command.includes('native-gate-supervisor.mjs --sentinel ' + child.guardian));
    remember(sentinel);
    kill(child.guardian, 'SIGSTOP'); kill(sentinel, 'SIGSTOP');
    try {
      kill(pid, signal);
      await until('worker dead before lock retry', () => !alive(pid));
      if (killGuardian) {
        kill(child.guardian, 'SIGKILL');
        await until('original group leader dead', () => !alive(child.guardian));
      }
      const before = fs.statSync(heartbeatPath).size;
      for (const kind of ['run', 'watch']) assert.throws(() => acquireProjectExecutionLock(a.root, kind), /already running/);
      await until('old gate continues writing during refusal', () => fs.statSync(heartbeatPath).size > before, 1000);
      const after = fs.statSync(heartbeatPath).size;
      assert(after > before, 'Old gate must still be writing during refusal');
      const contender = workflow(a, 'during-cleanup-' + label);
      await submit(a, 'during-cleanup-' + label);
      await terminal(a, 'during-cleanup-' + label, 'failed', 'project_execution_conflict');
      assert(!fs.existsSync(contender.marker));
      results.cleanupExclusion ??= [];
      results.cleanupExclusion.push({ signal, killGuardian, worker: pid, guardian: child.guardian, sentinel, before, after, lockRefusedWhileWriting: true });
    } finally {
      for (const monitor of [child.guardian, sentinel]) if (alive(monitor)) kill(monitor, 'SIGCONT');
    }
    await until('crash cleanup ' + signal, () => !alive(pid) && !alive(child.pid) && !alive(child.descendant));
    await a.repo.reconcile();
    await terminal(a, name, 'failed', 'worker_crashed');
    // Native identity/lock recovery after a real dead owner, never a fake identity.
    lock = await until('lock reacquired after complete group cleanup', () => {
      try { return acquireProjectExecutionLock(a.root, 'run'); }
      catch (e) { if (/already running/.test(e.message)) return false; throw e; }
    });
    const finalHeartbeat = fs.readFileSync(gate.marker + '.heartbeat', 'utf8');
    await sleep(25);
    assert.equal(fs.readFileSync(gate.marker + '.heartbeat', 'utf8'), finalHeartbeat, 'No old writes while new lock is held');
    lock.release(); lock = undefined;
  }
  if (!['native-route', 'fill-only'].includes(capacityMode)) {
    const escape = workflow(a, 'write-confinement', 'escape');
    await submit(a, 'write-confinement');
    await terminal(a, 'write-confinement', 'completed');
    await marker(escape.marker);
    assert(!fs.existsSync(outside));
  }
  if (['fill', 'fill-only'].includes(capacityMode)) {
    assert(results.capacityBytes <= 128 * 1024 ** 2, 'Never fill the outer engineering volume');
    const full = workflow(a, 'capacity', 'capacity');
    await submit(a, 'capacity');
    await terminal(a, 'capacity', 'failed', 'workflow_failed');
    const capacity = await marker(full.marker);
    assert.equal(capacity.code, 'ENOSPC');
    assert(capacity.bytes > 16 * 1024 ** 2 && capacity.bytes <= results.capacityBytes);
    results.capacity = capacity;
  } else results.capacity = { unproven: 'Nested mount unavailable; outer volume must not be filled' };
  workflow(a, 'recovery-control');
  await submit(a, 'recovery-control');
  await terminal(a, 'recovery-control', 'completed');
  await until('all recorded processes stopped', () => [...identities.keys()].every(pid => !alive(pid)));
  results.ok = true;
} catch (error) {
  results.error = error.stack;
  process.exitCode = 1;
} finally {
  lock?.release();
  if (ui) { ui.server.closeAllConnections(); await new Promise(resolve => ui.server.close(resolve)); }
  for (const [pid, identity] of identities) if (alive(pid) && sameProcessIdentity(identity, getProcessIdentity(pid))) process.kill(pid, 'SIGKILL');
  await until('fixture cleanup', () => [...identities.keys()].every(pid => !alive(pid)));
  put(join(base, 'http-result.json'), results);
}
