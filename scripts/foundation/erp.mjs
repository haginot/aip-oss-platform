import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { digest, exact, fail } from '../../src/contracts.mjs';

// Synthetic ERP uses a different database and principal. Its ledger and effect
// commit together, independently of the Kernel transaction and Audit.
export async function startErp(cluster,{stores=['s1']}={}) {
  const database = 'erp_' + randomBytes(8).toString('hex');
  await cluster.admin.query(`CREATE DATABASE ${database}`);
  await cluster.admin.query(`REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC`);
  await cluster.admin.query(`GRANT CONNECT ON DATABASE ${database} TO synthetic_erp`);
  const owner = new pg.Pool({ ...cluster.config, database });
  await owner.query(`CREATE TABLE ledger(operation_id text PRIMARY KEY, digest text NOT NULL, payload jsonb NOT NULL);
    CREATE TABLE effects(tenant text, store text, aggregate_id text, sequence integer NOT NULL, isolated boolean NOT NULL, fields jsonb, PRIMARY KEY(tenant,store,aggregate_id));
    GRANT USAGE ON SCHEMA public TO synthetic_erp;
    GRANT SELECT,INSERT ON ledger TO synthetic_erp;
    GRANT SELECT,INSERT,UPDATE ON effects TO synthetic_erp;`);
  const pool = new pg.Pool({ ...cluster.config, database, user: 'synthetic_erp' });
  const token = randomBytes(32).toString('hex');
  const tokens=new Set([token]);
  const controller = { mode: 'normal', applyRequests: 0, statusRequests: 0 };
  const server = createServer(async (req, res) => {
    let client;
    try {
      if (req.method !== 'POST' || !['/apply', '/status'].includes(req.url) || !tokens.has(req.headers.authorization?.replace(/^Bearer /,''))) fail('PERMISSION_DENIED');
      const chunks = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; if (length > 8192) fail('INVALID_ARGUMENT'); chunks.push(chunk); }
      const p = JSON.parse(Buffer.concat(chunks));
      exact(p, ['contractVersion','operationId','actionId','tenant','store','aggregateId','sequence','isolated','actionType','fields'],['contractVersion','operationId','actionId','tenant','store','aggregateId','sequence','isolated']);
      if(p.actionType!==undefined&&(!['DetectRecallImpact','QuarantineInventory','CreateReplacementOrder','PublishCustomerNotice'].includes(p.actionType)||!p.fields||typeof p.fields!=='object'))fail('INVALID_ARGUMENT');
      if (p.contractVersion !== '1.0.0' || p.tenant !== 't1' || !stores.includes(p.store) || typeof p.isolated !== 'boolean' || !Number.isInteger(p.sequence) || p.sequence < 1 || ['operationId','actionId','aggregateId'].some(k => typeof p[k] !== 'string' || !p[k] || p[k].length > 128)) fail('INVALID_ARGUMENT');
      const hash = digest(p);
      if (req.url === '/apply') controller.applyRequests++; else controller.statusRequests++;
      client = await pool.connect(); await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(772343)');
      const prior = (await client.query('SELECT * FROM ledger WHERE operation_id=$1', [p.operationId])).rows[0];
      let state;
      if (prior) { if (prior.digest !== hash) fail('IDEMPOTENCY_MISMATCH'); state = req.url === '/status' ? 'APPLIED' : 'DUPLICATE'; }
      else if (req.url === '/status') state = 'UNKNOWN';
      else if (controller.mode === 'reject') state = 'REJECTED';
      else {
        const effect = (await client.query('SELECT * FROM effects WHERE tenant=$1 AND store=$2 AND aggregate_id=$3 FOR UPDATE', [p.tenant,p.store,p.aggregateId])).rows[0];
        if (p.sequence !== (effect?.sequence ?? 0) + 1) state = 'GAP';
        else {
          await client.query('INSERT INTO ledger VALUES($1,$2,$3)', [p.operationId,hash,p]);
          if (controller.mode === 'rollback') throw Error('injected ERP partial failure');
          await client.query('INSERT INTO effects VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant,store,aggregate_id) DO UPDATE SET sequence=excluded.sequence,isolated=excluded.isolated,fields=excluded.fields', [p.tenant,p.store,p.aggregateId,p.sequence,p.isolated,p.fields??null]);
          state = 'APPLIED';
        }
      }
      await client.query('COMMIT');
      if (controller.mode === 'lost-ack' && req.url === '/apply') { req.socket.destroy(); return; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ state, operationId: p.operationId, digest: hash }));
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      res.writeHead(error.code === 'PERMISSION_DENIED' ? 403 : 409, { 'content-type': 'application/json' }); res.end(JSON.stringify({ code: error.code ?? 'UNAVAILABLE' }));
    } finally { client?.release(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { database, owner, token, controller, tokens, url: `http://127.0.0.1:${server.address().port}`, async close() { await new Promise(resolve => server.close(resolve)); await pool.end(); await owner.end(); await cluster.admin.query(`DROP DATABASE ${database}`); } };
}
