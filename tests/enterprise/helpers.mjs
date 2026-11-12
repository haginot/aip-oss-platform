import {startCluster,enterpriseFixture} from '../../scripts/enterprise/fixture.mjs';
import {Kernel} from '../../src/kernel.mjs';
import {RecoveryJournal} from '../../src/adapters/journal.mjs';
export async function withFixture(fn,options={}){const cluster=await startCluster();let f;try{f=await enterpriseFixture(cluster,options);await fn(f,cluster);}finally{await f?.close();await cluster.close();}}
export const vote=(f,who,id,revision=1,decision='APPROVE')=>f.call(who,'vote',{id,revision,decision});
export async function ready(f,body=f.create()){await f.call('operator','create',body);await vote(f,'manager',body.id);await vote(f,'reviewer',body.id);await vote(f,'publisher',body.id);return body;}
export function restart(f){f.kernel=new Kernel(f.state,new RecoveryJournal(f.journal.path));f.call=(who,operation,body={},key=crypto.randomUUID())=>f.kernel.enterprise(f.credentials[who],{operation,body,key});}
