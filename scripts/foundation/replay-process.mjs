import {PostgresState} from '../../src/adapters/postgres.mjs';
import {RecoveryJournal} from '../../src/adapters/journal.mjs';
import {Kernel} from '../../src/kernel.mjs';
import {createGateway} from '../../src/gateway.mjs';
import {createClient} from '../../src/generated/client.mjs';
// Restart regression: a new process reopens durable DB/journal and uses the public HTTP client.
process.once('message',async({config,journalPath,credential,request})=>{
 const state=new PostgresState(config),server=createGateway(new Kernel(state,new RecoveryJournal(journalPath)));
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const client=createClient({url:`http://127.0.0.1:${server.address().port}`,tenant:'t1',...credential});
  process.send({result:await client.submit(request)});
 }catch(error){process.send({error:error.code??error.message});process.exitCode=1;}
 finally{await new Promise(resolve=>server.close(resolve));await state.close();process.disconnect();}
});
