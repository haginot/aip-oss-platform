import {PostgresState} from '../../src/adapters/postgres.mjs';
import {RecoveryJournal} from '../../src/adapters/journal.mjs';
import {Kernel} from '../../src/kernel.mjs';
import {ConnectorPort} from '../../src/enterprise/connectors.mjs';
import {SyntheticPort} from '../../src/enterprise/worker.mjs';
let data='';for await(const chunk of process.stdin)data+=chunk;const request=JSON.parse(data);
const state=new PostgresState(request.config),kernel=new Kernel(state,new RecoveryJournal(request.journal),{fault:async point=>{if(point===request.crash)process.exit(73);}});
try{const result=await kernel.enterpriseWork(request.credential,{id:request.id,mode:request.mode},request.registry?new ConnectorPort(request.registry):new SyntheticPort(request.url));console.log(JSON.stringify(result));}finally{await state.close();}
