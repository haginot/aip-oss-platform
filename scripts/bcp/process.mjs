import {Kernel} from '../../src/kernel.mjs';
import {PostgresState} from '../../src/adapters/postgres.mjs';
import {RecoveryJournal} from '../../src/adapters/journal.mjs';
import {HttpWritebackPort} from '../../src/writeback.mjs';
import {createGateway} from '../../src/gateway.mjs';
process.once('message',async({config,journalPath,url,token,stopAt})=>{
 const state=new PostgresState(config);
 const kernel=new Kernel(state,new RecoveryJournal(journalPath),{writebackPort:new HttpWritebackPort(url,token),fault:async point=>{if(point===stopAt)process.kill(process.pid,'SIGKILL');}});
 const server=createGateway(kernel);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 process.send({url:`http://127.0.0.1:${server.address().port}`});
 process.on('message',async message=>{if(message==='close'){await new Promise(resolve=>server.close(resolve));await state.close();process.disconnect();}});
});
