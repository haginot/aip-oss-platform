import {randomUUID} from 'node:crypto';
import {checkAction,PlatformError} from './contracts.mjs';

// No automatic retry: a transport failure during submit may follow a committed Action.
export function createContractClient({url,token,tenant,delegationId,timeoutMs=5000},definition) {
  const endpoint=new URL('/rpc',url);
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new PlatformError('INVALID_ARGUMENT');
  async function call(operation,body={},options={}) {
    if(['submit','validate'].includes(operation))checkAction(body,definition);
    const requestId=randomUUID(),traceId=randomUUID();
    const deadline=AbortSignal.timeout(timeoutMs);
    const signal=options.signal?AbortSignal.any([deadline,options.signal]):deadline;
    let response,reply;
    try {
      response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`,'x-timeout-ms':String(timeoutMs),...(delegationId?{'x-delegation-id':delegationId}:{})},body:JSON.stringify({contractVersion:'1.0.0',requestId,traceId,tenant,operation,body}),signal});
      reply=await response.json();
    }catch {throw new PlatformError('TRANSPORT_UNKNOWN',{requestId,operation});}
    if(reply?.error)throw new PlatformError(reply.error.code,{requestId,operation,retryable:reply.error.retryable});
    if(!response.ok||reply?.contractVersion!=='1.0.0'||reply.requestId!==requestId||reply.traceId!==traceId||!Object.hasOwn(reply,'result'))throw new PlatformError('INCONSISTENT_STATE',{requestId,operation});
    return reply.result;
  }
  return Object.freeze(Object.fromEntries(['continuitySet','recover','compensate','capabilities','capability','scheduleCreate','scheduleStatus','scheduleTick','identityResolve','mappingDraft','mappingReview','mappingPublish','blobPut','blobRead','blobDelete','analytics','telemetry','pipelineStart','pipelineStatus','pipelineCancel','pipelineStep','ingest','observe','sourceStatus','ontology','get','history','query','search','traverse','validate','submit','status','approve','dispatch','reconcile','definitionDiff','editCases','draft','review','publish','tool'].map(operation=>[operation,(body,options)=>operation==='ontology'?call(operation,{},body):call(operation,body,options)])));
}
