// Optional operator entrypoint when the enclosing engineering policy cannot
// mount nested disk images or apply a second sandbox. Never creates host mounts.
// Usage: node tests/native-controls/external-proof.mjs OWNED_64_MIB_MOUNT COPIED_TAKT
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { boundedSpawn, verifyCopy } from '../../scripts/native-controls/run-bounded.mjs';
import { hashFile, root } from '../../scripts/native-controls/patch.mjs';
const [mountArg, runtimeArg] = process.argv.slice(2);
assert(mountArg && runtimeArg, 'Supply an already owned 64–128 MiB mount and patched runtime');
const mount = fs.realpathSync(mountArg), runtime = resolve(runtimeArg);
assert.notEqual(fs.statSync(mount).dev, fs.statSync(dirname(mount)).dev);
const stat = fs.statfsSync(mount);
assert(stat.blocks * stat.bsize <= 128 * 1024 ** 2, 'Refuse to fill a larger volume');
assert(stat.bavail * stat.bsize >= 32 * 1024 ** 2, 'Need room for the actual aggregate capacity probe');
const hashes = verifyCopy(runtime);
const files = ['scripts/native-controls', 'tests/native-controls'].flatMap(dir =>
  fs.readdirSync(join(root, dir)).filter(name => /\.(mjs|json|md)$/.test(name)).map(name => join(dir, name)));
const sourceHashes = Object.fromEntries(files.map(name => [name, hashFile(join(root, name))]));
const base = fs.mkdtempSync(join(mount, 'native-proof-'));
const scenario = join(base, 'scenario.json');
fs.writeFileSync(scenario, '[]');
const outside = base + '-must-not-exist';
const child = boundedSpawn({ volume: mount, writeRoot: base, cwd: base,
  args: [join(import.meta.dirname, 'http-fixture.mjs'), runtime, base, outside, 'fill'],
  environment: { TAKT_MOCK_SCENARIO: scenario } });
const exit = await child.completion;
const resultPath = join(base, 'http-result.json');
const result = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath)) : undefined;
const log = fs.readFileSync(exit.logPath, 'utf8');
const sourcesUnchanged = files.every(name => sourceHashes[name] === hashFile(join(root, name)));
const evidence = { time: new Date().toISOString(), hashes, sourceHashes, sourcesUnchanged, exit, result, log,
  escapedWrite: fs.existsSync(outside), fixture: base, formalEnterpriseAcceptance: false };
console.log(JSON.stringify(evidence, null, 2));
process.exitCode = exit.code === 0 && result?.ok === true && result?.capacity?.code === 'ENOSPC'
  && !evidence.escapedWrite && sourcesUnchanged ? 0 : 1;
