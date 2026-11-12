import {PostgresState} from '../../src/adapters/postgres.mjs';
import {RecoveryJournal} from '../../src/adapters/journal.mjs';
import {Kernel} from '../../src/kernel.mjs';
import {enterpriseGateway} from '../../src/enterprise/gateway.mjs';
import {SyntheticPort} from '../../src/enterprise/worker.mjs';
let data='';for await(const chunk of process.stdin)data+=chunk;const b=JSON.parse(data);
const state=new PostgresState(b.config),kernel=new Kernel(state,new RecoveryJournal(b.journal)),gateway=await enterpriseGateway(kernel,{issuer:b.issuer,port:new SyntheticPort(b.url)});
process.on('SIGTERM',async()=>{await gateway.close();await state.close();process.exit(0);});

console.log(JSON.stringify({origin:gateway.origin,pid:process.pid}));
