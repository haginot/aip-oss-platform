import {budget} from './budget.mjs';
import {traceContext} from './telemetry.mjs';
import { createServer } from 'node:http';
import { exact,fail,PlatformError } from './contracts.mjs';
import { authenticate } from './security.mjs';
const operations={continuitySet:'recovery',recover:'recovery',compensate:'action',capabilities:'read',scheduleCreate:'worker',scheduleStatus:'worker',scheduleTick:'worker',identityResolve:'ingest',mappingDraft:'author',mappingReview:'review',mappingPublish:'publish',blobPut:'ingest',blobRead:'read',blobDelete:'ingest',analytics:'read',telemetry:'observe',pipelineStart:'ingest',pipelineStatus:'ingest',pipelineCancel:'ingest',pipelineStep:'ingest',ingest:'ingest',observe:'observe',sourceStatus:'ingest',ontology:'read',get:'read',history:'read',query:'read',traverse:'read',search:'search',validate:'action',submit:'action',status:'read',approve:'approve',tool:'tool',definitionDiff:'author',editCases:'author',draft:'author',review:'review',publish:'publish',journalSnapshot:'recovery',journalList:'recovery',consume:'worker',dispatch:'worker',reconcile:'worker',capability:'read'};
export async function invoke(kernel,credential,envelope,options={}) {
  let context;const started=performance.now();
  try {
    options=budget(options);
    exact(envelope,['contractVersion','requestId','tenant','traceId','operation','body']);
    if(envelope.contractVersion!=='1.0.0')fail('UNSUPPORTED_VERSION');
    for(const key of ['requestId','tenant','traceId'])if(typeof envelope[key]!=='string'||!envelope[key]||envelope[key].length>128)fail('INVALID_ARGUMENT');
    const operation=operations[envelope.operation];if(!operation)fail('UNSUPPORTED_CAPABILITY');
    await kernel.state.transaction(async u=>{context=await authenticate(u,credential,operation);if(envelope.operation==='query'&&envelope.body?.search!==undefined)context=await authenticate(u,credential,'search');if(context.tenant!==envelope.tenant)fail('PERMISSION_DENIED');},options.deadline,options.signal);
    const result=await traceContext.run({requestId:envelope.requestId,traceId:envelope.traceId},()=>kernel[envelope.operation](credential,envelope.body,options));
    await record('OK',result);
    return {contractVersion:'1.0.0',requestId:envelope.requestId,traceId:envelope.traceId,result};
  }catch(error){await record(error instanceof PlatformError?error.code:'UNAVAILABLE');return kernel.reject(error,'gateway');}
  async function record(code,result) {
    if(!context)return;
    const row={schemaVersion:'1.0.0',requestId:envelope.requestId,traceId:envelope.traceId,operation:envelope.operation,actor:context.actor,onBehalfOf:context.onBehalfOf,policyVersion:context.policyVersion,code,durationMs:Math.max(0,performance.now()-started),...(result?.actionId?{actionId:result.actionId}:{}),...(result?.operationId?{operationId:result.operationId}:{}),at:new Date().toISOString()};
    await kernel.state.transaction(u=>u.client.query('INSERT INTO telemetry(tenant,stores,record) VALUES($1,$2,$3)',[context.tenant,JSON.stringify(context.stores),row]));
  }
}
export function createGateway(kernel,{maxConcurrent=32,maxRequestsPerSecond=100}={}) {
  for(const n of [maxConcurrent,maxRequestsPerSecond])if(!Number.isSafeInteger(n)||n<1)fail('INVALID_ARGUMENT');
  let active=0,window=Date.now(),requests=0;
  const server=createServer(async(req,res)=>{
    const controller=new AbortController();req.on('aborted',()=>controller.abort());res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    let envelope,admitted=false;
    try {
      if(Date.now()-window>=1000){window=Date.now();requests=0;}
      if(active>=maxConcurrent||requests>=maxRequestsPerSecond)fail('RATE_LIMITED');
      active++;requests++;admitted=true;req.setTimeout(5000,()=>req.destroy());
      if(req.method!=='POST'||req.url!=='/rpc')fail('NOT_FOUND');
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>1048576)fail('INVALID_ARGUMENT');chunks.push(chunk);}
      try{envelope=JSON.parse(Buffer.concat(chunks));}catch{fail('INVALID_ARGUMENT');}
      const authorization=req.headers.authorization;
      if(typeof authorization!=='string'||!authorization.startsWith('Bearer '))fail('PERMISSION_DENIED');
      const credential={token:authorization.slice(7),...(req.headers['x-delegation-id']?{delegationId:req.headers['x-delegation-id']}: {})};
      const duration=req.headers['x-timeout-ms']===undefined?5000:Number(req.headers['x-timeout-ms']);
      if(!Number.isInteger(duration)||duration<1||duration>30000)fail('INVALID_ARGUMENT');
      const result=await invoke(kernel,credential,envelope,{deadline:Date.now()+duration,signal:controller.signal});
      const output=JSON.stringify(result);if(Buffer.byteLength(output)>4194304)fail('RATE_LIMITED');
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(output);
    }catch(error){
      let failure=error;try{await kernel.reject(error,'http');}catch(audited){failure=audited;}
      const code=failure instanceof PlatformError?failure.code:'UNAVAILABLE';
      const status=code==='RATE_LIMITED'?429:code==='NOT_FOUND'?404:code==='PERMISSION_DENIED'?403:['UNAVAILABLE','RETRYABLE_UNAVAILABLE'].includes(code)?503:409;
      res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({contractVersion:'1.0.0',requestId:envelope?.requestId??null,error:{code,retryable:['UNAVAILABLE','RETRYABLE_UNAVAILABLE','DEADLINE_EXCEEDED'].includes(code),...failure.details}}));
    }finally{if(admitted)active--;}
  });
  server.maxConnections=64;return server;
}
