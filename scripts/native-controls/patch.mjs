import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(import.meta.dirname, '../..');
export const manifest = JSON.parse(fs.readFileSync(new URL('./upstream.json', import.meta.url)));
export const sha256 = data => createHash('sha256').update(data).digest('hex');
export const hashFile = path => sha256(fs.readFileSync(path));
const worker = 'dist/features/web-ui/central-worker.js';
const gate = 'dist/core/workflow/quality-gates/commandGateRunner.js';
const supervisor = 'dist/core/workflow/quality-gates/native-gate-supervisor.mjs';
const lock = 'dist/infra/task/project-execution-lock.js';
const groups = 'dist/infra/task/native-gate-groups.mjs';

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, `Patch anchor must be unique: ${before}`);
  return source.replace(before, after);
}

export function patchSources(originals) {
  let w = originals[worker];
  w = "import { acquireProjectExecutionLock, ProjectExecutionAlreadyRunningError } from '../../infra/task/project-execution-lock.js';\n" + w;
  w = replaceOnce(w, '    let terminalized = false;', '    let terminalized = false;\n    let executionLock;');
  w = replaceOnce(w, '        let executionCwd = repository.locations.projectDirectory;',
    `        // Authoritative admission in EVERY worker, including queue successors.
        // Never use a read-owner/check-then-spawn decision as the execution gate.
        executionLock = acquireProjectExecutionLock(repository.locations.projectDirectory, 'run');
        executionLock.updateState('running');
        let executionCwd = repository.locations.projectDirectory;`);
  w = replaceOnce(w, "failure: { code: 'worker_failed', message: error instanceof Error ? error.message : String(error) },",
    "failure: { code: error instanceof ProjectExecutionAlreadyRunningError ? 'project_execution_conflict' : 'worker_failed', message: error instanceof Error ? error.message : String(error) },");
  w = replaceOnce(w, '        throw error;\n    }\n}\nexport async function runCentralWorkerFromEnvironment',
    `        throw error;
    }
    finally {
        // Release before runCentralTask claims/spawns a successor. On SIGKILL the
        // existing lock retains registered gate groups through crash cleanup.
        executionLock?.release();
    }
}
export async function runCentralWorkerFromEnvironment`);

  let g = originals[gate];
  g = "import { fileURLToPath } from 'node:url';\nimport { registerProjectExecutionGate, waitForProjectExecutionGate } from '../../../infra/task/native-gate-groups.mjs';\n" + g;
  g = replaceOnce(g, `        const child = spawn(gate.command, {
            cwd,
            shell: true,
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: buildCommandGateEnv(process.env, childProcessEnv),
        });`, `        // POSIX guardian owns a process group and an independent pipe sentinel.
        // stdin is a private lifetime pipe: worker death closes it in the kernel.
        const owned = process.platform !== 'win32';
        const child = spawn(owned ? process.execPath : gate.command,
            owned ? [fileURLToPath(new URL('./native-gate-supervisor.mjs', import.meta.url)), gate.command] : [], {
            cwd,
            shell: !owned,
            detached: owned,
            stdio: owned ? ['pipe', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
            env: buildCommandGateEnv(process.env, childProcessEnv),
        });
        let ownedExitCode;
        let registered = false;
        child.on('message', message => {
            if (message?.type === 'gate-exit' && Number.isInteger(message.code)) ownedExitCode = message.code;
            if (!owned || registered || message?.type !== 'gate-ready') return;
            try {
                registerProjectExecutionGate(child.pid);
                registered = true;
                child.send({ type: 'start' }, error => { if (error) child.stdin.end(); });
            } catch (error) {
                stderr = error.message;
                child.stdin.end(); // No start message: the guardian never runs user code.
            }
        });`);
  g = replaceOnce(g, "        child.on('close', (code) => {\n            clearTimers();",
    `        child.on('close', async (code) => {
            if (owned) code = ownedExitCode ?? 1;
            clearTimers();
            try { if (owned) await waitForProjectExecutionGate(child.pid); }
            catch (error) { code = 1; stderr = appendStderr(stderr, error.message); }`);

  let l = originals[lock];
  l = replaceOnce(l, "import { isRecordedProcessAlive } from '../fs/file-lock.js';",
    "import { isExecutionOwnerActive, parseGateGroups, isGateGroupAlive, registerExecutionLock, unregisterExecutionLock } from './native-gate-groups.mjs';");
  l = replaceOnce(l, '    const identity = raw.processIdentity;', `    const identity = raw.processIdentity;
    if (raw.revision !== undefined && (typeof raw.revision !== 'string' || !UUID.test(raw.revision)))
        throw new Error('Invalid project execution owner revision');
    if (raw.executionFinished !== undefined && typeof raw.executionFinished !== 'boolean')
        throw new Error('Invalid project execution completion state');`);
  l = replaceOnce(l, '        processIdentity: { startTime: identity.startTime },', `        processIdentity: { startTime: identity.startTime },
        ...(raw.revision === undefined ? {} : { revision: raw.revision }),
        ...(raw.gateGroups === undefined ? {} : { gateGroups: parseGateGroups(raw.gateGroups) }),
        ...(raw.executionFinished === undefined ? {} : { executionFinished: raw.executionFinished }),`);
  l = replaceOnce(l, 'function recoverOwner(directory, nextOwnerId) {\n    const snapshot = readOwner(directory);', `// A snapshot read BEFORE the worker dies may omit its last gate publication.
// First prove this owner inactive, THEN read the record again. A dead owner
// cannot publish again; a live executionFinished owner is terminal by contract.
// Compare the complete revision and directory, retrying if either changed.
// A plain reread before the liveness check would still have the B2 race.
function readSettledOwner(directory) {
    for (let attempt = 0; attempt < ACQUISITION_ATTEMPTS; attempt++) {
        const snapshot = readOwner(directory);
        if (snapshot === undefined) return undefined;
        if (isExecutionOwnerActive(snapshot.owner)) return { ...snapshot, active: true };
        const confirmed = readOwner(directory);
        if (confirmed === undefined) return undefined;
        if (confirmed.directoryIdentity.dev === snapshot.directoryIdentity.dev
            && confirmed.directoryIdentity.ino === snapshot.directoryIdentity.ino
            && JSON.stringify(confirmed.owner) === JSON.stringify(snapshot.owner)) {
            return { ...confirmed, active: false };
        }
    }
    throw new Error('Project execution owner changed during recovery; lock retained');
}
function recoverOwner(directory, nextOwnerId) {
    const snapshot = readSettledOwner(directory);`);
  l = replaceOnce(l, 'isRecordedProcessAlive(owner.pid, owner.processIdentity)', 'snapshot.active');
  l = replaceOnce(l, `    const directory = join(cwd, '.takt', LOCK_DIRECTORY);
    const snapshot = readOwner(directory);`, `    const directory = join(cwd, '.takt', LOCK_DIRECTORY);
    const snapshot = readSettledOwner(directory);`);
  l = replaceOnce(l, 'isRecordedProcessAlive(snapshot.owner.pid, snapshot.owner.processIdentity)', 'snapshot.active');
  l = replaceOnce(l, '        ownerId: randomUUID(), pid: process.pid,', '        ownerId: randomUUID(), revision: randomUUID(), pid: process.pid,');
  l = replaceOnce(l, '    let released = false;\n    return {', '    let released = false;\n    const handle = {');
  l = replaceOnce(l, '        updateState(state) {', `        registerGate(group) {
            handle.updateState(owner.state, { gateGroups: [...(owner.gateGroups ?? []).filter(isGateGroupAlive), group] });
        },
        updateState(state, nativeFields = {}) {`);
  l = replaceOnce(l, "            if (released)\n                throw new Error('Project execution lock is already released');", "            if (released || owner.executionFinished === true)\n                throw new Error('Project execution lock is already released');");
  l = replaceOnce(l, '            const updated = { ...owner, state };', '            const updated = { ...owner, ...nativeFields, state, revision: randomUUID() };');
  l = replaceOnce(l, '            removeOwner(directory, { owner, directoryIdentity });\n            released = true;', `            if (owner.gateGroups?.length) handle.updateState('stopping', { executionFinished: true });
            // Explicit release and dead-worker recovery use the SAME group barrier.
            if (!(owner.gateGroups ?? []).some(isGateGroupAlive)) removeOwner(directory, { owner, directoryIdentity });
            unregisterExecutionLock(handle);
            released = true;`);
  l = replaceOnce(l, '    };\n}\n//# sourceMappingURL=project-execution-lock.js.map', `    };
    registerExecutionLock(handle);
    return handle;
}
//# sourceMappingURL=project-execution-lock.js.map`);
  return { [worker]: w, [gate]: g, [lock]: l,
    [groups]: fs.readFileSync(new URL('./gate-groups.mjs', import.meta.url), 'utf8'),
    [supervisor]: fs.readFileSync(new URL('./gate-supervisor.mjs', import.meta.url), 'utf8') };
}

export function verifyUpstream(source) {
  assert.equal(JSON.parse(fs.readFileSync(join(source, 'package.json'))).version, manifest.version, 'Unsupported TAKT version');
  for (const [name, expected] of Object.entries(manifest.files)) {
    assert.equal(hashFile(join(source, name)), expected, `Upstream hash mismatch: ${name}`);
  }
}

export function prepare(source = join(root, 'node_modules/takt'), destination = join(root, '.native-controls-runtime/takt')) {
  source = fs.realpathSync(source);
  destination = resolve(destination);
  // Never patch the shared install, an existing tree, or a symlinked parent.
  const parent = dirname(destination);
  fs.mkdirSync(parent, { recursive: true });
  const canonicalParent = fs.realpathSync(parent);
  assert(canonicalParent.startsWith(fs.realpathSync(root) + '/'), 'Copy destination must be inside this checkout');
  assert.equal(parent, canonicalParent, 'Copy destination parent must not contain symlinks');
  assert(!fs.existsSync(destination), 'Copy destination already exists; choose a fresh directory');
  assert(!source.startsWith(destination + '/') && !destination.startsWith(source + '/'), 'Source and copy must be disjoint');
  verifyUpstream(source);
  const originals = Object.fromEntries([worker, gate, lock].map(name => [name, fs.readFileSync(join(source, name), 'utf8')]));
  const replacements = patchSources(originals);
  fs.cpSync(source, destination, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
  verifyUpstream(destination);
  for (const [name, content] of Object.entries(replacements)) fs.writeFileSync(join(destination, name), content);
  const receipt = { schemaVersion: 1, version: manifest.version,
    source: manifest.files, patchSha256: hashFile(fileURLToPath(import.meta.url)),
    runtime: Object.fromEntries([...new Set([...Object.keys(manifest.files), ...Object.keys(replacements)])]
      .map(name => [name, hashFile(join(destination, name))])) };
  fs.writeFileSync(join(destination, 'native-controls-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  verifyUpstream(source);
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(prepare(process.argv[2], process.argv[3]), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
