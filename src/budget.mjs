import {fail,PlatformError} from './contracts.mjs';
// A budget is created once at the public boundary, never after a wait/retry.
export function budget(options={}) {
 const result={...options,deadline:options.deadline??Date.now()+5000};
 if(!Number.isFinite(result.deadline)||result.deadline>Date.now()+30000)fail('INVALID_ARGUMENT');
 checkBudget(result);return result;
}
export function checkBudget({deadline,signal}) {
 if(signal?.aborted)fail('CANCELLED');
 if(Date.now()>=deadline)fail('DEADLINE_EXCEEDED');
}
// Do not leak a late pool checkout when the caller has already stopped waiting.
export function checkout(pool,options) {
 checkBudget(options);
 return new Promise((resolve,reject)=>{
  let done=false;
  const finish=(error,client)=>{if(done){client?.release();return;}done=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);error?reject(error):resolve(client);};
  const abort=()=>finish(new PlatformError('CANCELLED'));
  const timer=setTimeout(()=>finish(new PlatformError('DEADLINE_EXCEEDED')),Math.max(1,options.deadline-Date.now()));
  options.signal?.addEventListener('abort',abort,{once:true});
  pool.connect().then(client=>finish(null,client),error=>finish(error));
 });
}
