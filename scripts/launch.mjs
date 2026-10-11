import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { selectCodex } from './codex-runtime.mjs';

const root = resolve(import.meta.dirname, '..');
export function launchArgs(mode, flags = []) {
  if (!['run', 'watch', 'start'].includes(mode) || flags.some((flag) => !['--dry-run', '--ignore-exceed'].includes(flag))) {
    throw new Error('launch <run|watch|start> [--dry-run] [--ignore-exceed]');
  }
  // Every project entry point uses the reviewed, isolated queue; no direct interactive run.
  const args = [mode === 'start' ? 'run' : mode];
  if (flags.includes('--ignore-exceed')) args.push('--ignore-exceed');
  return args;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode = 'run', ...flags] = process.argv.slice(2);
  const args = launchArgs(mode, flags);
  const cli = selectCodex();
  const env = { ...process.env, TAKT_CODEX_CLI_PATH: cli.path };
  const checked = spawnSync(process.execPath, ['scripts/preflight.mjs', '--strict'], { cwd: root, env, stdio: 'inherit' });
  if (checked.status !== 0) process.exit(checked.status ?? 1);
  process.stdout.write(`TAKT ${args.join(' ')} / Codex ${cli.version}\n`);
  if (!flags.includes('--dry-run')) {
    const result = spawnSync(resolve(root, 'node_modules/.bin/takt'), args, { cwd: root, env, stdio: 'inherit' });
    process.exitCode = result.status ?? 1;
  }
}
