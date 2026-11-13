import fs from 'node:fs';
import { spawn } from 'node:child_process';
const [mode, marker] = process.argv.slice(2);
if (mode === 'grandchild') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
  process.send({ ready: true });
} else {
  const descendant = spawn(process.execPath, [import.meta.filename, 'grandchild'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  await new Promise(resolve => descendant.once('message', resolve));
  fs.writeFileSync(marker, JSON.stringify({ pid: process.pid, parent: process.ppid, descendant: descendant.pid }));
  if (mode === 'normal') { console.log('real gate success'); process.exit(0); }
  if (mode === 'verbose') { process.stdout.write('x'.repeat(96 * 1024), () => process.exit(0)); }
  if (mode === 'failure') process.exit(7);
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
}
