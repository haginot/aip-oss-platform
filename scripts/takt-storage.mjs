import { spawnSync } from 'node:child_process';
import { realpathSync, statfsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const gib = 1024n ** 3n;
const minimumFree = 30n * gib;
const maximumRecords = 20n * gib;

function existingAncestor(path) {
  while (!statSync(path, { throwIfNoEntry: false })) path = dirname(path);
  return path;
}

export function checkTaktStorage(root) {
  const config = resolve(root, process.env.TAKT_CONFIG_DIR || resolve(homedir(), '.takt'));
  const paths = [config, resolve(root, '.takt'), resolve(root, 'evidence/enterprise')];
  for (const path of new Set(paths.map(existingAncestor))) {
    const { bavail, bsize } = statfsSync(path, { bigint: true });
    if (bavail * bsize < minimumFree) {
      throw new Error(`less than 30 GiB free on the filesystem for ${path}`);
    }
  }

  const existingPaths = paths
    .filter((path) => statSync(path, { throwIfNoEntry: false }))
    .map((path) => realpathSync(path));
  const directories = [...new Set(existingPaths)].sort();
  let total = 0n;
  for (const path of directories) {
    if (directories.some((parent) => path.startsWith(`${parent}/`))) continue;
    const usage = spawnSync('du', ['-skx', path], { encoding: 'utf8' });
    const blocks = usage.stdout?.match(/^(\d+)\s/u)?.[1];
    if (blocks) total += BigInt(blocks) * 1024n;
    if (total >= maximumRecords) {
      throw new Error(`TAKT records have reached 20 GiB across ${paths.join(', ')}`);
    }
    if (!blocks || usage.status !== 0) {
      throw new Error(`could not measure TAKT records under ${path}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    checkTaktStorage(resolve(process.argv[2] || '.'));
    process.stdout.write('TAKT storage check passed\n');
  } catch (error) {
    process.stderr.write(`TAKT storage check failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
