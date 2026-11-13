import fs from 'node:fs';
const [file] = process.argv.slice(2);
// Observe the kernel's refusal without terminating before the diagnostic prints.
process.on('SIGXFSZ', () => {});
const fd = fs.openSync(file, 'w');
let bytes = 0;
try {
  const chunk = Buffer.alloc(64 * 1024, 19);
  while (bytes < 4 * 1024 * 1024) bytes += fs.writeSync(fd, chunk);
  process.exitCode = 9;
} catch (error) {
  console.error(JSON.stringify({ code: error.code, bytes }));
  process.exitCode = error.code === 'EFBIG' ? 23 : 8;
} finally { fs.closeSync(fd); }
