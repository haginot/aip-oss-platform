import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Socket} from 'node:net';
import {performance} from 'node:perf_hooks';

const order = ['prepare', 'validate', 'check'];
const limit = 4096;
function send(channel, message) {
  const frame = JSON.stringify(message) + '\n';
  assert(Buffer.byteLength(frame) <= limit, 'oversized phase message');
  return new Promise((resolve, reject) => channel.write(frame, error => error ? reject(error) : resolve()));
}

function receive(channel, budget, message, fail) {
  let partial = Buffer.alloc(0);
  channel.on('data', chunk => {
    try {
      // Bound the cumulative bytes before allocating a frame or parsing JSON.
      budget -= chunk.length;
      assert(budget >= 0, 'phase channel exceeded byte budget');
      const bytes = Buffer.concat([partial, chunk]);
      let begin = 0;
      for (let end; (end = bytes.indexOf(10, begin)) !== -1; begin = end + 1) {
        assert(end - begin < limit, 'oversized phase message');
        const value = JSON.parse(bytes.toString('utf8', begin, end));
        assert(value && typeof value === 'object' && !Array.isArray(value), 'invalid phase message');
        message(value);
      }
      partial = bytes.subarray(begin);
      assert(partial.length < limit, 'oversized phase message');
    } catch (error) { fail(error); }
  });
  channel.on('error', fail);
  channel.once('end', () => { if (partial.length) fail(new Error('incomplete phase message')); });
}

// Each phase gets its own inherited socket, bound to the spawned child handle.
// The issuing state stays in the supervisor; receipts cannot advance a phase.
export function phaseAuthority(identity, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  const expiresAt = Date.now() + timeoutMs;
  const completed = [];
  let active, revoked;
  const live = () => {
    assert(!revoked, revoked);
    assert(performance.now() < deadline, 'phase authority expired');
  };
  return {
    revoke(reason) { revoked ??= reason; active?.reject(new Error(revoked)); },
    get completed() { return structuredClone(completed); },
    async run(role, binding, launch, onStarted) {
      live();
      assert(!active && role === order[completed.length], 'phase out of order');
      const proof = {role, sequence: completed.length + 1, identity,
        nonce: randomUUID(), expiresAt, binding};
      const child = launch();
      const channel = child.stdio[3];
      let result, started, invalid;
      let rejectPhase;
      const failed = new Promise((_, reject) => { rejectPhase = reject; });
      active = {reject: rejectPhase};
      const fail = error => { invalid ??= error; rejectPhase(invalid); };
      const timer = setTimeout(() => fail(new Error('phase authority expired')), Math.max(0, deadline - performance.now()));
      const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({code, signal})));
      child.once('error', fail);
      receive(channel, role === 'validate' ? 2 * limit : limit, ({type, value, ...presented}) => {
        live();
        assert.deepEqual(presented, proof, 'wrong phase identity, scope or nonce');
        assert(!result, 'phase replay');
        if (type === 'started') {
          assert(role === 'validate' && !started && Number.isSafeInteger(value?.pid) && value.pid > 0,
            'unexpected child start');
          started = value.pid;
          onStarted?.(started);
        } else {
          assert(type === 'result' && value && typeof value === 'object', 'invalid phase result');
          assert(role !== 'validate' || started === value.pid && !!started, 'validation child was not started');
          result = value;
        }
      }, fail);
      channel.once('end', () => { if (!result) fail(new Error(role + ' disconnected before result')); });
      try {
        // Observe failure immediately even if the socket write itself stalls.
        send(channel, {...proof, type: 'grant'}).catch(fail);
        const {code, signal} = await Promise.race([closed, failed]);
        live();
        assert(!invalid, invalid?.message);
        assert(!signal && code === 0 && result, `${role} did not close successfully (${signal ?? code})`);
        completed.push({role, pid: child.pid, closedAt: new Date().toISOString(), ...(started ? {runnerPid: started} : {})});
        return result;
      } catch (error) {
        revoked ??= 'previous phase did not close successfully';
        throw error;
      } finally {
        clearTimeout(timer);
        channel.destroy();
        active = undefined;
      }
    },
  };
}

export async function receivePhase(role, execute) {
  const channel = new Socket({fd: 3, readable: true, writable: true});
  try {
    await new Promise((resolve, reject) => {
      let accepted = false, finished = false;
      receive(channel, limit, async ({type, ...proof}) => {
        try {
          assert(!accepted && type === 'grant' && proof.role === role && Date.now() < proof.expiresAt,
            'invalid, replayed or expired phase grant');
          accepted = true;
          const value = await execute(proof.binding, value => send(channel, {...proof, type: 'started', value}));
          assert(Date.now() < proof.expiresAt, 'phase grant expired');
          await send(channel, {...proof, type: 'result', value});
          finished = true;
          channel.end(resolve);
        } catch (error) { reject(error); }
      }, reject);
      channel.once('end', () => { if (!finished) reject(new Error('phase authority disconnected')); });
    });
  } finally {
    channel.destroy();
  }
}
