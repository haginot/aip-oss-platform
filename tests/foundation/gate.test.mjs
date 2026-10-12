import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const gate = resolve('.takt/quality-gates/platform-gate.sh');
function environment(t) {
  const dir = mkdtempSync(join(tmpdir(), 'foundation-gate-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const marker = join(dir, 'ambient-node-used');
  writeFileSync(join(dir, 'node'), '#!/bin/sh\nprintf used > "$GATE_NODE_MARKER"\nexit 91\n', {mode: 0o700});
  return {dir, marker, env: {...process.env, GATE_NODE_MARKER: marker}};
}

test('quality gate selects pinned tools even when ambient node is unusable', t => {
  const {dir, marker, env} = environment(t);
  const result = spawnSync('/bin/bash', [gate, 'goal'], {
    env: {...env, PATH: `${dir}:${process.env.PATH}`}, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /platform validation passed/);
  assert.equal(existsSync(marker), false, 'ambient Node must never run');
});

test('missing mise fails instead of falling back to ambient node', t => {
  const {dir, marker, env} = environment(t);
  const result = spawnSync('/bin/bash', [gate, 'goal'], {
    env: {...env, PATH: `${dir}:/usr/bin:/bin`}, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 127, result.stderr);
  assert.match(result.stderr, /mise.*(?:not found|No such file)/);
  assert.equal(existsSync(marker), false);
});

test('failed tool selection preserves exit code and stops before validation', t => {
  const {dir, marker, env} = environment(t);
  const calls = join(dir, 'mise-calls');
  writeFileSync(join(dir, 'mise'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$GATE_MISE_CALLS"\nexit 37\n', {mode: 0o700});
  const result = spawnSync('/bin/bash', [gate, 'implementation'], {
    env: {...env, PATH: `${dir}:${process.env.PATH}`, GATE_MISE_CALLS: calls}, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 37, result.stderr);
  assert.equal(readFileSync(calls, 'utf8'), 'exec -- node scripts/platform-control.mjs run-stage implementation\n');
  assert.equal(existsSync(marker), false);
});
