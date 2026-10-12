import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {generateClient,writeClient} from '../../scripts/foundation/generate-client.mjs';
import {createClient,definition} from '../../src/generated/client.mjs';

test('generated runtime and declarations reproduce the versioned Ontology and reject source drift',()=>{
  writeClient({check:true});
  const changed=structuredClone(definition);changed.ontologyVersion='1.1.0';
  const result=generateClient(changed);
  assert.notEqual(result.runtime,readFileSync(new URL('../../src/generated/client.mjs',import.meta.url),'utf8'));
  assert.match(result.declarations,/ontologyVersion: "1.1.0"/);
});

// This exercises real HTTP serialization only; the echo server is not a Kernel or AC proof.
test('client wire envelope binds opaque credentials and validates responses without retrying unknown success',async()=>{
  const requests=[];let mode='echo';
  const server=createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);
    const envelope=JSON.parse(Buffer.concat(chunks));requests.push({envelope,headers:req.headers});
    if(mode==='disconnect'){req.socket.destroy();return;}
    if(mode==='denied'){res.writeHead(403).end(JSON.stringify({error:{code:'PERMISSION_DENIED',retryable:false}}));return;}
    res.end(JSON.stringify({...envelope,requestId:mode==='wrong-id'?'another-request':envelope.requestId,result:{wire:true}}));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const client=createClient({url:`http://127.0.0.1:${server.address().port}`,token:'synthetic-token',tenant:'t1',delegationId:'d1'});
    assert.deepEqual(await client.get({id:'stock'}),{wire:true});
    assert.equal(requests[0].headers.authorization,'Bearer synthetic-token');
    assert.equal(requests[0].headers['x-delegation-id'],'d1');
    assert.equal(requests[0].envelope.tenant,'t1');assert.equal(requests[0].envelope.operation,'get');
    assert.ok(!Object.hasOwn(requests[0].envelope,'actor'));
    const request={actionType:'SetIsolation',actionVersion:'1.0.0',ontologyVersion:'1.0.0',input:{targetId:'stock',isolated:true},expectedRevision:1,idempotencyKey:'client-key',evidence:[]};
    await assert.rejects(client.submit({...request,input:{targetId:'stock',isolated:'true'}}),{code:'INVALID_ARGUMENT'});
    await assert.rejects(client.submit({...request,ontologyVersion:'9.0.0'}),{code:'UNSUPPORTED_VERSION'});
    assert.equal(requests.length,1,'invalid typed inputs never reach HTTP');
    mode='wrong-id';await assert.rejects(client.get({id:'stock'}),{code:'INCONSISTENT_STATE'});
    mode='denied';await assert.rejects(client.get({id:'stock'}),{code:'PERMISSION_DENIED'});
    mode='disconnect';await assert.rejects(client.submit(request),{code:'TRANSPORT_UNKNOWN'});
    assert.equal(requests.length,4,'transport failure must not retry a possibly committed Action');
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
