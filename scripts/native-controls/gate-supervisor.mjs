// Installed beside commandGateRunner.js by patch.mjs. POSIX only.
// The group leader stays alive through cleanup, pinning its process-group ID.
// A second group member watches a private pipe, so killing the guardian alone
// still kills the command group. No PID scans, PID files, or PID reuse guesses.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const graceMs = 100;
if (process.argv[2] === '--sentinel') {
  const group = Number(process.argv[3]);
  if (!Number.isSafeInteger(group) || group <= 1 || process.ppid !== group) process.exit(1);
  let stopping = false;
  function stop() {
    if (stopping) return;
    stopping = true;
    process.kill(-group, 'SIGTERM');
    setTimeout(() => process.kill(-group, 'SIGKILL'), graceMs);
  }
  // Stay in the owned group until the final KILL, including during normal exit.
  process.on('SIGTERM', () => {});
  process.on('SIGINT', stop);
  process.on('SIGHUP', stop);
  process.stdin.on('end', stop);
  process.stdin.on('error', stop);
  process.on('disconnect', stop);
  process.stdin.resume();
  process.send({ type: 'ready' });
} else {
  let stopping = false;
  let command;
  let registered = false;
  let sentinelReady = false;
  function stop(code = 1) {
    if (stopping) return;
    stopping = true;
    // The runner waits for close (all group output pipes closed), not this message.
    if (process.connected) process.send({ type: 'gate-exit', code }, () => {});
    process.kill(-process.pid, 'SIGTERM');
    setTimeout(() => process.kill(-process.pid, 'SIGKILL'), graceMs);
  }
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => stop(1));
  process.on('disconnect', () => stop(1));
  process.stdin.on('end', () => stop(1));
  process.stdin.on('error', () => stop(1));
  process.stdin.resume();
  const sentinel = spawn(process.execPath, [self, '--sentinel', String(process.pid)], {
    detached: false, stdio: ['pipe', 'ignore', 'ignore', 'ipc'], env: process.env,
  });
  sentinel.once('error', () => stop(1));
  sentinel.once('exit', () => stop(1));
  // Require the sentinel to be alive and initialized BEFORE any user command.
  function start() {
    if (stopping || command || !registered || !sentinelReady) return;
    command = spawn('/bin/sh', ['-c', process.argv[2]], {
      detached: false, stdio: ['ignore', 'inherit', 'inherit'], env: process.env,
    });
    command.once('error', () => stop(1));
    command.once('exit', code => stop(Number.isInteger(code) ? code : 1));
  }
  process.once('message', message => {
    if (message?.type !== 'start') return stop(1);
    registered = true;
    start();
  });
  sentinel.once('message', message => {
    if (message?.type !== 'ready') return stop(1);
    sentinelReady = true;
    if (process.connected) process.send({ type: 'gate-ready' }, error => { if (error) stop(1); });
    start();
  });
}
