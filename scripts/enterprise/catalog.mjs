import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '../..');
const catalog = JSON.parse(readFileSync(resolve(root, 'work/enterprise/backlog.json'), 'utf8'));
assert.equal(catalog.schemaVersion, 1);
const ids = new Map(catalog.items.map(item => [item.id, item]));
assert.equal(ids.size, catalog.items.length, 'Duplicate Issue IDs');
assert.equal(catalog.items.filter(i => !i.parent).length, 1, 'Exactly one initiative');
assert.equal(ids.get('ENT-000')?.kind, 'initiative');
const allowed = new Set(['OPEN', 'IN_PROGRESS', 'READY_FOR_REVIEW', 'VERIFIED', 'BLOCKED']);
for (const item of catalog.items) {
  assert.match(item.id, /^ENT-\d{3}$/);
  assert.ok(allowed.has(item.status), `${item.id}: unknown status`);
  assert.ok(item.acceptance.length > 0 && item.acceptance.every(s => typeof s === 'string' && s.trim()), `${item.id}: empty acceptance`);
  assert.ok(Array.isArray(item.evidence));
  assert.ok(!item.parent || ids.has(item.parent), `${item.id}: missing parent`);
  assert.deepEqual([...item.children].sort(), catalog.items.filter(i => i.parent === item.id).map(i => i.id).sort(), `${item.id}: inconsistent child links`);
  for (const dependency of item.dependsOn) assert.ok(ids.has(dependency), `${item.id}: missing dependency ${dependency}`);
  readFileSync(resolve(root, 'work/enterprise/issues', `${item.id}.md`));
}
function walk(id, edges, path = []) {
  assert.ok(!path.includes(id), `Cycle: ${[...path, id].join(' -> ')}`);
  for (const next of edges(ids.get(id))) walk(next, edges, [...path, id]);
}
for (const id of ids.keys()) {
  walk(id, item => item.parent ? [item.parent] : []);
  // Epic dependencies imply completion of their child issues.
  walk(id, item => [...item.dependsOn, ...item.children]);
}
console.log(JSON.stringify({status:'PASS', scope:'catalog structure only; not product verification', issues:ids.size, useCases:catalog.items.filter(i => i.kind === 'use-case').length}));
