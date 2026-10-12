import test from 'node:test';
import assert from 'node:assert/strict';
import {separateVolumes} from '../../scripts/foundation/volumes.mjs';
import {startCluster,fixture} from '../../scripts/foundation/runtime.mjs';
import {RecoveryJournal} from '../../src/adapters/journal.mjs';
import {stat} from 'node:fs/promises';
test('journal survives disposal of actual independently mounted PostgreSQL volume',async()=>{
 const volumes=await separateVolumes();let cluster,f;
 try {
  cluster=await startCluster({baseDirectory:volumes.db});f=await fixture(cluster,{journalDirectory:volumes.journal});
  const a=await f.kernel.submit(f.credentials.operator,f.request());const path=f.journal.path;
  assert.notEqual((await stat(cluster.directory)).dev,(await stat(path)).dev);
  await f.close();f=null;await cluster.close();cluster=null;
  const reopened=new RecoveryJournal(path);
  assert.equal(reopened.committed(a.operationId),true);
  assert.equal(reopened.records()[0].actionId,a.actionId);
  assert.equal(reopened.records().at(-1).phase,'COMMITTED');
 }finally{await f?.close();await cluster?.close();await volumes.close();}
});
