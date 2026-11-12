import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import test from 'node:test';
import {phaseAuthority} from '../../scripts/takt-ent201-authority.mjs';

const identity = {runId:'run',taskId:'ENT-201',executionId:'execution'};
const binding = {inputs:{source:'source',packages:'packages'},controls:'workflow'};
function launch(t, body) {
  return () => {
    const child = spawn(process.execPath, ['-e', `
      const socket = new (require('node:net').Socket)({fd:3,readable:true,writable:true});
      const reply = (proof,type,value) => JSON.stringify({...proof,type,value})+'\\n';
      socket.once('data', data=>{
        const {type,...proof}=JSON.parse(data);
        ${body}
      });`], {stdio:['ignore','ignore','inherit','pipe']});
    const closed = once(child,'close');
    t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await closed; });
    return child;
  };
}

test('ENT-201 phase grant requires actual process closure and has a fresh role and nonce',async t=>{
  const auth=phaseAuthority(identity,5_000);
  const preparing=auth.run('prepare',binding,launch(t,`
    socket.write(reply(proof,'result',proof.binding));
    setTimeout(()=>socket.end(),250);
  `));
  await assert.rejects(auth.run('validate',binding,()=>assert.fail('launched before preparation closed')),/out of order/);
  assert.deepEqual(await preparing,binding);
  assert.deepEqual(auth.completed.map(p=>p.role),['prepare']);
  await auth.run('validate',binding,launch(t,`
    socket.write(reply(proof,'started',{pid:process.pid}));
    socket.end(reply(proof,'result',{pid:process.pid,code:0}));
  `));
  await auth.run('check',binding,launch(t,"socket.end(reply(proof,'result',proof.binding));"));
  assert.deepEqual(auth.completed.map(p=>p.role),['prepare','validate','check']);
  await assert.rejects(auth.run('check',binding,()=>assert.fail('launched replay')),/out of order/);
});

const cases = [
  ['wrong identity', "socket.end(reply({...proof,identity:{...proof.identity,runId:'old'}},'result',proof.binding));", /wrong phase identity/],
  ['wrong nonce', "socket.end(reply({...proof,nonce:'old'},'result',proof.binding));", /wrong phase identity/],
  ['replay', "const msg=reply(proof,'result',proof.binding); socket.end(msg+msg);", /phase replay/],
  ['oversized frame', "socket.end(Buffer.alloc(4097,32));", /phase channel exceeded byte budget/],
  ['disconnect', 'socket.end();', /disconnected before result/],
  ['nonzero exit after valid result', "process.exitCode=2; socket.end(reply(proof,'result',proof.binding));", /did not close successfully/],
  ['expiry', "socket.write(reply(proof,'result',proof.binding)); setTimeout(()=>socket.end(),2500);", /expired/],
];
for (const [name,body,expected] of cases) test('ENT-201 phase rejects '+name,async t=>{
  const auth=phaseAuthority(identity,name==='expiry'?150:5_000);
  await assert.rejects(auth.run('prepare',binding,launch(t,body)),expected);
  assert.deepEqual(auth.completed,[]);
  await assert.rejects(auth.run('prepare',binding,()=>assert.fail('failed scope was reused')),/did not close successfully/);
});

test('ENT-201 parent revocation invalidates an in-flight phase',async t=>{
  const auth=phaseAuthority(identity,5_000);
  const pending=auth.run('prepare',binding,launch(t,'setTimeout(()=>socket.end(),2500);'));
  auth.revoke('launcher disconnected');
  await assert.rejects(pending,/launcher disconnected/);
  assert.deepEqual(auth.completed,[]);
});
