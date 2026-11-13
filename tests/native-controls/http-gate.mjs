import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
const [mode, marker, release, outside] = process.argv.slice(2);
if (mode === 'descendant') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else {
  const child = spawn(process.execPath, [import.meta.filename, 'descendant'], { stdio: 'ignore' });
  fs.writeFileSync(marker, JSON.stringify({ pid: process.pid, guardian: process.ppid, descendant: child.pid }));
  if (mode === 'escape') {
    const alias = join(dirname(marker), 'escape-link');
    fs.symlinkSync(outside, alias);
    for (const target of [outside, alias]) {
      try { fs.writeFileSync(target, 'escaped'); process.exit(8); }
      catch (e) { console.log('WRITE_DENIED=' + e.code); if (!['EPERM', 'EACCES'].includes(e.code)) process.exit(9); }
    }
    fs.unlinkSync(alias);
    process.exit(0);
  }
  if (mode === 'capacity') {
    const file = release;
    const fd = fs.openSync(file, 'w');
    let bytes = 0;
    try {
      const chunk = Buffer.alloc(1024 * 1024, 42);
      while (bytes < 128 * 1024 * 1024) bytes += fs.writeSync(fd, chunk);
      process.exitCode = 8;
    } catch (e) {
      fs.closeSync(fd);
      fs.unlinkSync(file); // restore ledger headroom before publishing failure
      fs.writeFileSync(marker, JSON.stringify({ pid: process.pid, guardian: process.ppid, descendant: child.pid, code: e.code, bytes }));
      console.error('CAPACITY_REFUSED=' + e.code);
      process.exit(e.code === 'ENOSPC' ? 23 : 9);
    }
    process.exit(8);
  }
  if (mode === 'normal') { console.log('ACTUAL_HTTP_GATE'); process.exit(0); }
  process.on('SIGTERM', () => {});
  setInterval(() => fs.appendFileSync(marker + '.heartbeat', '.'), 1);
  setInterval(() => { if (fs.existsSync(release)) process.exit(0); }, 25);
}
