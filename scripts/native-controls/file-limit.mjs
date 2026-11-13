import assert from 'node:assert/strict';

// Supplemental per-file limit, NOT an aggregate filesystem quota. macOS /bin/sh
// uses 1024-byte units for -f (verified with a real write refusal in the test).
// Lower soft before hard, since lowering hard below current soft is invalid.
export function fileLimitCommand(executable, args, bytes = 64 * 1024 ** 2) {
  assert.equal(process.platform, 'darwin', 'File-limit launcher currently supports macOS');
  assert(Number.isSafeInteger(bytes) && bytes >= 1024 && bytes % 1024 === 0 && bytes <= 64 * 1024 ** 2);
  return { executable: '/bin/sh', args: ['-c',
    `ulimit -S -f ${bytes / 1024} && ulimit -H -f ${bytes / 1024} || exit 70; exec "$@"`,
    'takt-file-limit', executable, ...args] };
}
