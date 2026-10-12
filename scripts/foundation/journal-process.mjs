import {RecoveryJournal} from '../../src/adapters/journal.mjs';
const [path,phase]=process.argv.slice(2);
const journal=new RecoveryJournal(path,{bootstrap:phase!=='inspect'});
if(phase==='inspect') {
  process.send({phase:journal.records().at(-1)?.phase,fenced:journal.fenced(),committed:journal.committed('process-op'),count:journal.records().length});
  process.disconnect();
} else {
  const record={tenant:'t1',store:'s1',subject:'operator',actor:'operator',onBehalfOf:null,idempotencyKey:'process-key',operationId:'process-op',phase:'INTENT'};
  journal.append(record);
  if(phase==='COMMITTED')journal.append({...record,phase:'COMMITTED'});
  process.send({durable:phase});
  // Parent kills this process only after append has returned from real fsync.
  setInterval(()=>{},1000);
}
