import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,appendFileSync,writeFileSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {checkAction,checkFilter,compatible,validateDefinition,digest} from '../../src/contracts.mjs';
import {RecoveryJournal} from '../../src/adapters/journal.mjs';
const definition=JSON.parse(readFileSync(new URL('../../config/ontology.json',import.meta.url)));
const request={actionType:'SetIsolation',actionVersion:'1.0.0',ontologyVersion:'1.0.0',input:{targetId:'stock',isolated:true},expectedRevision:1,idempotencyKey:'key',evidence:[]};
const code=expected=>e=>e.code===expected;
test('canonical digest is stable while typed input, actor injection and unsupported version are rejected',()=>{
 validateDefinition(definition);checkAction(request,definition);assert.equal(digest({b:2,a:1}),digest({a:1,b:2}));
 for(const bad of [{...request,actor:'admin'},{...request,input:{targetId:'stock',isolated:'true'}},{...request,input:{targetId:'stock',isolated:true,sql:'x'}},{...request,expectedRevision:0},{...request,idempotencyKey:''}])assert.throws(()=>checkAction(bad,definition),code('INVALID_ARGUMENT'));
 assert.throws(()=>checkAction({...request,ontologyVersion:'9.0.0'},definition),code('UNSUPPORTED_VERSION'));
});
test('finite typed query rejects arbitrary expressions, restricted filters and unbounded inputs',()=>{
 const fields=definition.types.InventoryPosition.fields;
 assert.ok(checkFilter({op:'and',terms:[{op:'eq',field:'note',value:null},{op:'in',field:'quantity',values:[10]}]},fields)({note:null,quantity:10}));
 assert.throws(()=>checkFilter({op:'sql',field:'name',value:'x'},fields),code('INVALID_ARGUMENT'));
 assert.throws(()=>checkFilter({op:'eq',field:'secret',value:'x'},fields),code('PERMISSION_DENIED'));
 assert.throws(()=>checkFilter({op:'in',field:'quantity',values:Array(101).fill(10)},fields),code('INVALID_ARGUMENT'));
 assert.throws(()=>checkFilter({op:'eq',field:'quantity',value:1.5},fields),code('INVALID_ARGUMENT'));
});
test('compatibility preserves type, unit, field, action semantics and optional additions',()=>{
 const next=structuredClone(definition);next.ontologyVersion='1.1.0';next.types.InventoryPosition.fields.label={type:'string',nullable:true};compatible(definition,next);
 for(const mutate of [d=>delete d.types.InventoryPosition.fields.quantity,d=>d.types.InventoryPosition.fields.quantity.unit='kg',d=>d.types.InventoryPosition.fields.quantity.type='string']){
 const bad=structuredClone(definition);mutate(bad);assert.throws(()=>compatible(definition,bad),code('INCOMPATIBLE_DEFINITION'));}
 const bad=structuredClone(definition);bad.actions.RunSQL={version:'1.0.0'};assert.throws(()=>validateDefinition(bad),code('UNSUPPORTED_CAPABILITY'));
});
test('real fsync journal survives reopen, enumerates scoped stable snapshot and denies cross scope',()=>{
 const directory=mkdtempSync(join(tmpdir(),'aip-journal-'));const path=join(directory,'journal.ndjson');
 try {const journal=new RecoveryJournal(path,{bootstrap:true});const record={tenant:'t1',store:'s1',subject:'operator',actor:'operator',onBehalfOf:null,idempotencyKey:'key',canonicalDigest:digest(request),actionId:'a',operationId:'op',typedInput:request,expectedRevisions:{stock:1},evidenceRefs:[],definitionVersions:{ontology:'1.0.0'},target:'synthetic-erp',payloadDigest:digest(request.input),phase:'INTENT'};
 journal.append(record);assert.ok(journal.fenced());journal.append({...record,phase:'COMMITTED',commitRevisions:{stock:2}});assert.ok(!journal.fenced());assert.equal(statSync(path).mode&0o077,0);
 const reopened=new RecoveryJournal(path);assert.equal(reopened.latest('t1','operator','key').actionId,'a');assert.ok(reopened.committed('op'));
 const ctx={tenant:'t1',stores:['s1']};const snapshot=reopened.snapshot(ctx,'s1');reopened.append({...record,idempotencyKey:'next',operationId:'next',phase:'INTENT'});
 const first=reopened.list(ctx,snapshot,0,1);assert.equal(first.complete,false);const second=reopened.list(ctx,snapshot,first.nextCursor,1);assert.equal(second.complete,true);assert.equal(second.records.length,1);
 assert.throws(()=>reopened.list({tenant:'t2',stores:['s1']},snapshot),code('PERMISSION_DENIED'));
 appendFileSync(path,'partial');assert.throws(()=>new RecoveryJournal(path),code('INCONSISTENT_STATE'));
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('journal hash tampering, truncation and gap fail closed',()=>{
 const directory=mkdtempSync(join(tmpdir(),'aip-journal-'));const path=join(directory,'j');
 try{const journal=new RecoveryJournal(path,{bootstrap:true});const row=journal.append({tenant:'t1',store:'s1',operationId:'op',phase:'INTENT'});
 writeFileSync(path,JSON.stringify({...row,phase:'COMMITTED'})+'\n');assert.throws(()=>new RecoveryJournal(path),code('INCONSISTENT_STATE'));
 writeFileSync(path,JSON.stringify({...row,sequence:2})+'\n');assert.throws(()=>new RecoveryJournal(path),code('INCONSISTENT_STATE'));
 }finally{rmSync(directory,{recursive:true,force:true});}
});
