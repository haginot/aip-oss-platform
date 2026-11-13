import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { root, prepare, manifest, patchSources, hashFile, sha256, verifyUpstream } from '../../scripts/native-controls/patch.mjs';

export const cache = join(root, '.native-controls-runtime');
export const runtime = join(cache, 'takt');
export const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
export const put = (p, x) => {
  fs.mkdirSync(join(p, '..'), { recursive: true });
  fs.writeFileSync(p, typeof x === 'string' ? x : JSON.stringify(x, null, 2) + '\n');
};
export function verifyRuntime() {
  verifyUpstream(join(root, 'node_modules/takt'));
  if (!fs.existsSync(runtime)) prepare();
  const originals = Object.fromEntries(['dist/features/web-ui/central-worker.js', 'dist/core/workflow/quality-gates/commandGateRunner.js', 'dist/infra/task/project-execution-lock.js']
    .map(name => [name, fs.readFileSync(join(root, 'node_modules/takt', name), 'utf8')]));
  const expected = { ...manifest.files, ...Object.fromEntries(Object.entries(patchSources(originals)).map(([k, v]) => [k, sha256(v)])) };
  for (const [file, hash] of Object.entries(expected)) assert.equal(hashFile(join(runtime, file)), hash, `Stale copied runtime: ${file}; remove disposable copy and prepare again`);
  return expected;
}
export function fixture(name) {
  fs.mkdirSync(cache, { recursive: true });
  return fs.mkdtempSync(join(cache, name + '-'));
}
export async function until(label, inspect, ms = 12000) {
  const deadline = Date.now() + ms;
  do { const value = await inspect(); if (value) return value; await sleep(25); } while (Date.now() < deadline);
  throw new Error(label + ' timed out');
}
export function alive(pid) {
  try { return !execFileSync('/bin/ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().startsWith('Z'); }
  catch (e) { if (e.status === 1) return false; throw e; }
}
export function isolatedEnv(base) {
  for (const p of ['home', 'global', 'tmp']) fs.mkdirSync(join(base, p), { recursive: true });
  return { PATH: process.env.PATH, HOME: join(base, 'home'), CFFIXED_USER_HOME: join(base, 'home'),
    TAKT_CONFIG_DIR: join(base, 'global'), TMPDIR: join(base, 'tmp'), TMP: join(base, 'tmp'), TEMP: join(base, 'tmp'),
    LANG: 'en_US.UTF-8', SHELL: '/bin/sh', TAKT_MOCK_SCENARIO: join(base, 'scenario.json') };
}
export function launch(file, args, env, cwd) {
  const child = spawn(process.execPath, [file, ...args], { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const s of [child.stdout, child.stderr]) s.on('data', x => { output = (output + x).slice(-131072); });
  child.done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, output }));
  });
  return child;
}
