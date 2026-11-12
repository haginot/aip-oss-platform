import assert from 'node:assert/strict';

// Browser test observation only: preserve the actual listener return value and
// record settlement of that exact Promise, after the async handler's finally.
export function installSubmitCompletionObserver(){
 const proof={version:1,registrations:0,invocations:[]};
 window.reconcileSubmitProof=proof;
 const original=EventTarget.prototype.addEventListener;
 EventTarget.prototype.addEventListener=function(type,listener,options){
  if(type!=='submit'||this.id!=='reconcile-form'||typeof listener!=='function')return original.call(this,type,listener,options);
  proof.registrations++;
  return original.call(this,type,function(...args){
   const row={id:proof.invocations.length+1,state:'pending',startedAt:new Date().toISOString(),returnedPromise:false};proof.invocations.push(row);
   let result;
   try{result=listener.apply(this,args);}catch(error){row.state='rejected';row.finishedAt=new Date().toISOString();row.error=String(error);throw error;}
   row.returnedPromise=!!result&&typeof result.then==='function';
   if(!row.returnedPromise){row.state='non-promise';row.finishedAt=new Date().toISOString();return result;}
   result.then(()=>{row.state='fulfilled';row.finishedAt=new Date().toISOString();},error=>{row.state='rejected';row.finishedAt=new Date().toISOString();row.error=String(error);});
   return result;
  },options);
 };
}
export const submitCompletionSource='('+installSubmitCompletionObserver.toString()+')()';
export function completedSubmit(proof,id){
 assert.equal(proof?.registrations,1,'Exactly one real submit listener must be observed');
 const row=proof.invocations.find(value=>value.id===id);
 assert.ok(row,'Exact submit invocation must exist');
 assert.equal(row.returnedPromise,true,'The real async handler Promise is required');
 assert.equal(row.state,'fulfilled','The exact handler, including finally, must have fulfilled');
 assert.ok(row.finishedAt,'Handler settlement timestamp is required');
 return row;
}
export async function waitForSubmitCompletion(page,id){
 assert.ok(Number.isSafeInteger(id)&&id>0);
 // until throws on timeout. Elapsed time is never treated as completion.
 await page.until(`window.reconcileSubmitProof?.invocations.find(row=>row.id===${id})?.state!=='pending'&&!!window.reconcileSubmitProof?.invocations.find(row=>row.id===${id})`);
 const proof=await page.evaluate('JSON.parse(JSON.stringify(window.reconcileSubmitProof))');
 completedSubmit(proof,id);return proof;
}
export async function holdFollowupHistory(page,id){
 // The original A fetch is already inside the earlier hold wrapper. A later
 // fetch wrapper cannot observe that invocation's response. Bind to that exact
 // live held request, then gate only its subsequent matching history response.
 await page.evaluate(`(()=>{const heldRequest=window.gate;const pending=window.reconcileSubmitProof?.invocations.filter(row=>row.state==='pending'&&row.returnedPromise);if(!heldRequest||heldRequest.held!==true||heldRequest.released!==false||typeof heldRequest.release!=='function'||pending?.length!==1)throw new Error('Expected one pending submit and its existing held request');const gate={armed:true,armedFrom:'existing-held-request',submitId:pending[0].id,held:false,released:false,paymentId:${JSON.stringify(id)}};window.c2cFollowupGate=gate;const prior=window.fetch;window.fetch=async(...args)=>{const response=await prior(...args);if(heldRequest.released===true&&!gate.held&&args[0]==='/enterprise/v2/rpc'){const request=JSON.parse(args[1].body);if(request.operation==='history'&&request.body.id===gate.paymentId){gate.held=true;gate.heldAt=new Date().toISOString();await new Promise(resolve=>gate.release=resolve);gate.released=true;gate.releasedAt=new Date().toISOString();}}return response;};})()`);
}
export async function releaseHeldFetch(page){
 await page.evaluate('window.gate.release()');await page.until('window.gate.released');
}
export async function releaseFollowupHistory(page){
 await page.evaluate('window.c2cFollowupGate.release()');await page.until('window.c2cFollowupGate.released');
}
