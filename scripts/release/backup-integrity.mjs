import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
export function verifyCheckpoint(dump,journal,checkpoint){const hash=x=>createHash('sha256').update(x).digest('hex');assert.equal(hash(dump),checkpoint.dump,'backup dump integrity mismatch');assert.equal(hash(journal),checkpoint.journal,'backup journal integrity mismatch');}
