import { mkdirSync, openSync, closeSync, fsyncSync, writeSync, readFileSync, existsSync, statSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { digest, fail } from '../contracts.mjs';
// The admission lock in StatePort serializes cross-process writers before every append.
export class RecoveryJournal {
  constructor(path, {bootstrap=false}={}) {
    this.path = path; this.headPath=path+'.head';
    // Restart is read-only with respect to creation. Only an explicit new-store bootstrap may initialize both witnesses.
    const mainExists=existsSync(path),headExists=existsSync(this.headPath);
    if(!mainExists||!headExists) {if(!bootstrap||mainExists||headExists)fail('UNAVAILABLE');}
    mkdirSync(dirname(path),{recursive:true,mode:0o700});
    const directory = openSync(dirname(path),'r');
    try { const fd=openSync(path,'a',0o600); fsyncSync(fd); closeSync(fd); fsyncSync(directory); }
    finally { closeSync(directory); }
    if ((statSync(path).mode & 0o077) !== 0) fail('PERMISSION_DENIED');
    if(!existsSync(this.headPath)) {if(statSync(path).size!==0)fail('INCONSISTENT_STATE');this.writeHead({sequence:0,recordHash:'GENESIS'});}
    this.records();
  }
  records() {
    if (!existsSync(this.path)) fail('UNAVAILABLE');
    const content=readFileSync(this.path,'utf8');
    if (content && !content.endsWith('\n')) fail('INCONSISTENT_STATE');
    let previous='GENESIS';
    const rows=content.split('\n').filter(Boolean).map((line,index) => {
      let row; try { row=JSON.parse(line); } catch { fail('INCONSISTENT_STATE'); }
      const {recordHash,...body}=row;
      if (body.sequence!==index+1 || body.journalEpoch!=='foundation-1' || body.previousHash!==previous || digest(body)!==recordHash) fail('INCONSISTENT_STATE');
      previous=recordHash; return row;
    });
    if(!existsSync(this.headPath))fail('UNAVAILABLE');
    let head;try{head=JSON.parse(readFileSync(this.headPath,'utf8'));}catch{fail('INCONSISTENT_STATE');}
    if(head.sequence!==rows.length||head.recordHash!==(rows.at(-1)?.recordHash??'GENESIS'))fail('INCONSISTENT_STATE');
    return rows;
  }
  writeHead(head) {
    const temp=this.headPath+'.next',fd=openSync(temp,'w',0o600);
    try {writeSync(fd,JSON.stringify(head));fsyncSync(fd);}finally{closeSync(fd);}
    renameSync(temp,this.headPath);const directory=openSync(dirname(this.path),'r');
    try{fsyncSync(directory);}finally{closeSync(directory);}
  }
  append(record) {
    const rows=this.records();
    const body={...record,journalEpoch:'foundation-1',sequence:rows.length+1,previousHash:rows.at(-1)?.recordHash??'GENESIS'};
    const row={...body,recordHash:digest(body)};
    // Witness first: interrupted append or even whole-line tail loss fails closed.
    this.writeHead({sequence:row.sequence,recordHash:row.recordHash});
    const fd=openSync(this.path,'a');
    try { const buffer=Buffer.from(JSON.stringify(row)+'\n'); let offset=0; while(offset<buffer.length) offset+=writeSync(fd,buffer,offset,buffer.length-offset); fsyncSync(fd); }
    finally { closeSync(fd); }
    return row;
  }
  // Legacy approval records are identified by approvalActor, never by a user-key suffix.
  latest(tenant,subject,key) { return this.records().filter(r=>(r.operationKind??(r.approvalActor?'approval':'submission'))==='submission' && r.tenant===tenant && r.subject===subject && r.idempotencyKey===key).at(-1); }
  committed(operationId) {
    const rows=this.records().filter(r=>r.operationId===operationId&&r.operationKind!=='delivery'),last=rows.at(-1);
    // A confirmed approval rollback leaves the already committed submission intact.
    return last?.phase==='COMMITTED'||(last?.phase==='ABORTED'&&rows.some(r=>r.phase==='COMMITTED'));
  }
  fenced() { const latest=new Map();for(const row of this.records()) if(row.operationKind!=='delivery')latest.set(row.operationId,row.phase);return [...latest.values()].includes('INTENT'); }
  snapshot(ctx,store) {
    if (!ctx.stores.includes(store)) fail('PERMISSION_DENIED');
    const rows=this.records();
    return {tenant:ctx.tenant,store,epoch:'foundation-1',highWatermark:rows.length,chainDigest:rows.at(-1)?.recordHash??'GENESIS'};
  }
  list(ctx,snapshot,cursor=0,limit=100) {
    if (snapshot.tenant!==ctx.tenant || !ctx.stores.includes(snapshot.store)) fail('PERMISSION_DENIED');
    if (!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(cursor)||cursor<0) fail('INVALID_ARGUMENT');
    const rows=this.records();
    if (snapshot.epoch!=='foundation-1'||rows.length<snapshot.highWatermark||(rows[snapshot.highWatermark-1]?.recordHash??'GENESIS')!==snapshot.chainDigest) fail('INCONSISTENT_STATE');
    const scoped=rows.slice(0,snapshot.highWatermark).filter(r=>r.tenant===ctx.tenant && r.store===snapshot.store);
    return {records:scoped.slice(cursor,cursor+limit),nextCursor:cursor+limit<scoped.length?cursor+limit:null,complete:cursor+limit>=scoped.length};
  }
}
