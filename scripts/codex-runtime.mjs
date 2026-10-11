import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, resolve } from 'node:path';

const bundled = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const executable = (path) => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } };

export function selectCodex({ env = process.env, bundledPath = bundled } = {}) {
  const explicit = env.TAKT_CODEX_CLI_PATH;
  const fromPath = (env.PATH ?? '').split(delimiter).filter(Boolean).map((directory) => resolve(directory, 'codex')).find(executable);
  const candidates = explicit ? [resolve(explicit)] : [...new Set([bundledPath, fromPath].filter(Boolean))];
  const available = candidates.filter(executable).map((path) => {
    const version = spawnSync(path, ['--version'], { encoding: 'utf8', timeout: 10000 });
    const match = version.stdout?.match(/(\d+)\.(\d+)\.(\d+)([^\s]*)/u);
    return version.status === 0 && match ? { path, version: match[0], rank: match.slice(1, 4).map(Number) } : null;
  }).filter(Boolean);
  available.sort((a, b) => b.rank[0] - a.rank[0] || b.rank[1] - a.rank[1] || b.rank[2] - a.rank[2]);
  if (!available.length) throw new Error('実行可能なCodex CLIがありません。TAKT_CODEX_CLI_PATHで認証済みCLIを指定してください');
  return available[0];
}
