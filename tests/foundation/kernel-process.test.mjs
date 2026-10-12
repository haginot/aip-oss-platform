import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { startCluster, fixture } from '../../scripts/foundation/runtime.mjs';
import { PostgresState } from '../../src/adapters/postgres.mjs';
import { RecoveryJournal } from '../../src/adapters/journal.mjs';
import { Kernel } from '../../src/kernel.mjs';
import {separateVolumes} from '../../scripts/foundation/volumes.mjs';
let cluster,volumes;
before(async () => { volumes=await separateVolumes();cluster = await startCluster({baseDirectory:volumes.db}); }); after(async () => { await cluster?.close();await volumes?.close(); });
for (const point of ['before-intent', 'after-intent', 'before-commit', 'after-commit', 'after-marker']) {
  test(`actual SIGKILL at ${point}: reopened DB/journal never infer acknowledgement`, async () => {
    const f = await fixture(cluster,{journalDirectory:volumes.journal}); let restarted;
    try {
      const request = f.request({ idempotencyKey: point });
      const config = { ...cluster.config, user: 'foundation_app', options: f.state.pool.options.options };
      const child = fork(new URL('../../scripts/foundation/kernel-process.mjs', import.meta.url), [], { stdio: ['ignore','pipe','pipe','ipc'] });
      const exited = once(child, 'exit'); const timer = setTimeout(() => child.kill('SIGTERM'), 10000);
      child.send({ config, journalPath: f.journal.path, credential: f.credentials.operator, request, stopAt: point });
      let exit; try { exit = await exited; } finally { clearTimeout(timer); }
      assert.deepEqual(exit, [null, 'SIGKILL']);
      restarted = new PostgresState(config);
      const journal = new RecoveryJournal(f.journal.path), kernel = new Kernel(restarted, journal);
      const committed = ['after-commit','after-marker'].includes(point);
      assert.equal((await kernel.get(f.credentials.operator, { id: 'stock' })).revision, committed ? 2 : 1);
      for (const table of ['actions','outbox','history']) assert.equal(Number((await f.owner.query(`SELECT count(*) FROM ${table}`)).rows[0].count), committed ? 1 : 0);
      const records = journal.records();
      if (point === 'before-intent') {
        assert.equal(records.length, 0); assert.equal((await kernel.submit(f.credentials.operator, request)).state, 'PENDING_EXTERNAL');
      } else if (point === 'after-marker') {
        assert.equal(records.at(-1).phase, 'COMMITTED');
        const replay = await kernel.submit(f.credentials.operator, request);
        assert.equal(replay.operationId, records[0].operationId); assert.equal(replay.actionId, records[0].actionId);
        assert.equal(Number((await f.owner.query('SELECT count(*) FROM outbox')).rows[0].count), 1);
      } else {
        assert.equal(records.at(-1).phase, 'INTENT'); assert.equal(journal.fenced(), true);
        await assert.rejects(kernel.submit(f.credentials.operator, request), e => e.code === 'INCONSISTENT_STATE');
        if (committed) await assert.rejects(kernel.consume(f.credentials.manager, { operationId: records[0].operationId }), e => e.code === 'INCONSISTENT_STATE');
      }
      const successfulAudit = (await f.owner.query("SELECT count(*) FROM audit WHERE record->>'kind'='PENDING_EXTERNAL'")).rows[0].count;
      assert.equal(Number(successfulAudit), point === 'before-intent' || committed ? 1 : 0);
    } finally { await restarted?.close(); await f.close(); }
  });
}
