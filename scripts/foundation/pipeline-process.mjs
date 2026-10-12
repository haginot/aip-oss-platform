import {PostgresState} from '../../src/adapters/postgres.mjs';
import {RecoveryJournal} from '../../src/adapters/journal.mjs';
import {Kernel} from '../../src/kernel.mjs';
process.once('message',async({config,journalPath,credential,id,stopAt})=>{
 const state=new PostgresState(config);
 const kernel=new Kernel(state,new RecoveryJournal(journalPath),{fault:async point=>{if(point===stopAt)process.kill(process.pid,'SIGKILL');}});
 try{await kernel.pipelineStep(credential,{id});process.exitCode=2;}
 catch{process.exitCode=3;}
 finally{await state.close();process.disconnect();}
});
