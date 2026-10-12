import {budget,checkBudget} from './budget.mjs';
import {continuitySet,recover,compensate,checkContinuity} from './continuity.mjs';
import {storeEffect,decideStoreAction} from './store-actions.mjs';
import {scheduleCreate,scheduleStatus,scheduleTick} from './trigger.mjs';
import {identityResolve,mappingDraft,mappingReview,mappingPublish} from './identity-map.mjs';
import {blobPut,blobRead,blobDelete,analytics} from './data-services.mjs';
import {telemetry} from './telemetry.mjs';
import {pipelineStart,pipelineStatus,pipelineCancel,pipelineStep} from './pipeline.mjs';
import {ingest,sourceStatus} from './ingestion.mjs';
import { decideAction, enforcePolicy, versionPrograms } from './definition-programs.mjs';
import { randomUUID } from 'node:crypto';
import { PlatformError, fail, digest, canonical, exact, checkAction, checkFilter, validateDefinition, compatible } from './contracts.mjs';
import { authenticate, actionContext, authorize, canRead, project } from './security.mjs';
import { Writeback } from './writeback.mjs';

const auditedRejections=new WeakSet();

export class Kernel {
  constructor(state,journal,{fault=async()=>{},clock=Date.now,writebackPort}={}) { this.state=state; this.journal=journal; this.clock=clock; this.fault=fault; this.writeback=writebackPort?new Writeback(this,writebackPort):null; }
  continuitySet(credential,body,options) {return this.withBudget('continuitySet',options,b=>continuitySet(this,credential,body,b));}
  recover(credential,body,options) {return this.withBudget('recover',options,b=>recover(this,credential,body,b));}
  compensate(credential,body,options) {return this.withBudget('compensate',options,b=>compensate(this,credential,body,b));}
  scheduleCreate(credential,body,options) {return scheduleCreate(this,credential,body,options);}
  scheduleStatus(credential,body,options) {return scheduleStatus(this,credential,body,options);}
  scheduleTick(credential,body,options) {return this.withBudget('scheduleTick',options,b=>scheduleTick(this,credential,body,b));}
  pipelineStart(credential,body,options) {return pipelineStart(this,credential,body,options);}
  pipelineStatus(credential,body,options) {return pipelineStatus(this,credential,body,options);}
  pipelineCancel(credential,body,options) {return pipelineCancel(this,credential,body,options);}
  pipelineStep(credential,body,options) {return pipelineStep(this,credential,body,options);}
  blobPut(credential,body,options) {return blobPut(this,credential,body,options);}
  blobRead(credential,body,options) {return blobRead(this,credential,body,options);}
  blobDelete(credential,body,options) {return blobDelete(this,credential,body,options);}
  analytics(credential,body,options) {return analytics(this,credential,body,options);}
  telemetry(credential,body,options) {return telemetry(this,credential,body,options);}
  identityResolve(credential,body,options) {return identityResolve(this,credential,body,options);}
  mappingDraft(credential,body,options) {return mappingDraft(this,credential,body,options);}
  mappingReview(credential,body,options) {return mappingReview(this,credential,body,options);}
  mappingPublish(credential,body,options) {return mappingPublish(this,credential,body,options);}
  ingest(credential,body,options) { return ingest(this,credential,body,options); }
  sourceStatus(credential,body,options) { return sourceStatus(this,credential,body,options); }
  dispatch(credential,body,options) {return this.withBudget('dispatch',options,b=>{if(this.writeback)return this.writeback.dispatch(credential,body,b);return this.call(credential,'worker',()=>fail('UNSUPPORTED_CAPABILITY'),b);});}
  reconcile(credential,body,options) {return this.withBudget('reconcile',options,b=>{if(this.writeback)return this.writeback.reconcile(credential,body,b);return this.call(credential,'worker',()=>fail('UNSUPPORTED_CAPABILITY'),b);});}
  async withBudget(operation,options,fn) {try{return await fn(budget(options));}catch(error){if(auditedRejections.has(error))throw error;return this.reject(error,operation);}}
  async reject(error,operation,ctx,request) {
    const code=error instanceof PlatformError?error.code:'UNAVAILABLE';
    try {
      await this.state.transaction(u=>u.audit({kind:'Denied',operation,code,actor:ctx?.actor??'unverified',onBehalfOf:ctx?.onBehalfOf??null,policyVersion:ctx?.policyVersion??null,ontologyVersion:ctx?.ontologyVersion??null,ruleVersion:ctx?.ruleVersion??null,workflowVersion:ctx?.workflowVersion??null,...(ctx?.savedActionEvidence??{}),...(request?{actionType:request.actionType,targetId:request.input?.targetId,inputDigest:digest(request)}:{})}));
    } catch { fail('UNAVAILABLE'); }
    if (error instanceof PlatformError) {auditedRejections.add(error);throw error;}
    fail(code);
  }
  async call(credential,operation,fn,options={}) {
    let ctx;
    try {
      options=budget(options);
      return await this.state.transaction(async u=>{
        // Serialize publishers before shared Policy/live-definition locks: two
        // publishers must never both hold SHARE while trying to upgrade Policy.
        if(operation==='publish')await u.publicationLock();
        ctx=await authenticate(u,credential,operation);
        const definition=await u.definition();ctx.ontologyVersion=definition.version;ctx.ruleVersion=definition.body.ruleVersion;ctx.workflowVersion=definition.body.workflowVersion;
        const result=await fn(u,ctx,definition.body);
        if (options.signal?.aborted) fail('CANCELLED');
        await u.audit({kind:'ReadOrControl',operation,actor:ctx.actor,onBehalfOf:ctx.onBehalfOf,policyVersion:ctx.policyVersion,ontologyVersion:definition.version,ruleVersion:definition.body.ruleVersion,workflowVersion:definition.body.workflowVersion,...(ctx.actionRequest?{actionType:ctx.actionRequest.actionType,targetId:ctx.actionRequest.input.targetId,inputDigest:digest(ctx.actionRequest)}:{})});
        return result;
      },options.deadline,options.signal);
    } catch(error) { return this.reject(error,operation,ctx,ctx?.actionRequest); }
  }
  observe(credential,request={},options) {exact(request,[]);return this.call(credential,'observe',async(u,c,d)=>({...await u.observations(c),ontologyVersion:d.ontologyVersion,policyVersion:c.policyVersion}),options);}
  ontology(credential,body,options) { return this.call(credential,'read',async(u,c,d)=>({definition:d,digest:digest(d)}),options); }
  get(credential,{id,projection},options) {
    return this.call(credential,'read',async(u,c,d)=>{const o=await u.object(id);authorize(c,o,true);return project(c,o,d,projection);},options);
  }
  history(credential,request,options) {
    return this.call(credential,'read',async(u,c,d)=>{
      exact(request,['id','afterRevision','asOfRevision','limit','projection'],['id']);
      const afterRevision=request.afterRevision??0,asOfRevision=request.asOfRevision??2147483647,limit=request.limit??100;
      if(typeof request.id!=='string'||!Number.isSafeInteger(afterRevision)||afterRevision<0||!Number.isSafeInteger(asOfRevision)||asOfRevision<afterRevision||asOfRevision>2147483647||!Number.isInteger(limit)||limit<1||limit>100)fail('INVALID_ARGUMENT');
      const object=await u.sourceObject(request.id);authorize(c,object,true);
      // Validate projection even when there are no historical rows.
      project(c,object,d,request.projection);
      const rows=await u.history(request.id,afterRevision,limit+1,asOfRevision);
      const items=rows.slice(0,limit).map(row=>({...project(c,{...object,revision:row.revision,fields:row.fields,source_position:row.source_position??'action:'+row.action_id},d,request.projection),actionId:row.action_id,validAt:row.valid_at,recordedAt:row.recorded_at,deleted:row.deleted}));
      return {items,nextRevision:rows.length>limit?items.at(-1).revision:null,ontologyVersion:d.ontologyVersion,policyVersion:c.policyVersion};
    },options);
  }
  async readQuery(u,c,d,request) {
    exact(request,['type','filter','projection','limit','cursor','order','search'],['type']);
    const fields=d.types[request.type]?.fields;
    if (!fields) fail('INVALID_ARGUMENT');
    project(c,{type:request.type,fields:{}},d,request.projection);
    const limit=request.limit??100;
    if (!Number.isInteger(limit)||limit<1||limit>100) fail('INVALID_ARGUMENT');
    const filter=checkFilter(request.filter,fields);
    if (request.search!==undefined && (typeof request.search!=='string'||request.search.length>256)) fail('INVALID_ARGUMENT');
    if(request.order) exact(request.order,['field','direction'],['field','direction']);
    if (request.order && (request.order.direction!=='asc'||!fields[request.order.field]||fields[request.order.field].restricted)) fail('INVALID_ARGUMENT');
    const query={...request};delete query.cursor;delete query.limit;
    const queryDigest=digest({query,actor:c.actor,subject:c.subject,delegation:c.delegationId,stores:c.stores,secretAccess:c.secretAccess});
    let items,snapshotId,offset=0;
    if (request.cursor) {
      exact(request.cursor,['snapshot','offset']);
      if (!Number.isInteger(request.cursor.offset)||request.cursor.offset<0) fail('INVALID_ARGUMENT');
      const snapshot=await u.getSnapshot(request.cursor.snapshot);
      if (!snapshot||snapshot.subject!==c.subject||snapshot.query_digest!==queryDigest||snapshot.policy_epoch!==c.policyEpoch||snapshot.ontology_version!==d.ontologyVersion||snapshot.expires.getTime()<=Date.now()) fail('INCONSISTENT_STATE');
      items=snapshot.items;offset=request.cursor.offset;snapshotId=snapshot.id;
      // Apply current row scope at every page; never return removed or revoked objects.
      for (const item of items) { const current=await u.object(item.id); if (!canRead(c,current)) fail('INCONSISTENT_STATE'); }
    } else {
      const objects=await u.objects(request.type,c.tenant);
      if (objects.length>1000) fail('RATE_LIMITED');
      items=objects.filter(o=>canRead(c,o)&&filter(o.fields)).map(o=>project(c,o,d));
      if (request.search) items=items.filter(o=>Object.values(o.fields).some(v=>typeof v==='string'&&v.includes(request.search)));
      if (request.order) {const key=request.order.field;items.sort((a,b)=>a.fields[key]===b.fields[key]?a.id.localeCompare(b.id):a.fields[key]===null?1:b.fields[key]===null?-1:a.fields[key]<b.fields[key]?-1:1);}
      items=items.map(item=>{const object=objects.find(o=>o.id===item.id);return project(c,object,d,request.projection);});
      snapshotId=randomUUID();
      await u.snapshot({id:snapshotId,subject:c.subject,query_digest:queryDigest,policy_epoch:c.policyEpoch,ontology_version:d.ontologyVersion,items,expires:new Date(Date.now()+300000)});
    }
    return {items:items.slice(offset,offset+limit),count:items.length,nextCursor:offset+limit<items.length?{snapshot:snapshotId,offset:offset+limit}:null,ontologyVersion:d.ontologyVersion,policyVersion:c.policyVersion,watermark:'authoritative'};
  }
  query(credential,request,options) { return this.call(credential,'read',async(u,c,d)=>{if(request?.search!==undefined)c=await authenticate(u,credential,'search');return this.readQuery(u,c,d,request);},options); }
  search(credential,request,options) { return this.call(credential,'search',(u,c,d)=>this.readQuery(u,c,d,request),options); }
  traverse(credential,{id,link,depth=1,projection},options) {
    return this.call(credential,'read',async(u,c,d)=>{
      if (!d.links[link]||!Number.isInteger(depth)||depth<1||depth>2) fail('INVALID_ARGUMENT');
      project(c,{type:d.links[link].to,fields:{}},d,projection);
      const root=await u.object(id);authorize(c,root,true);
      if (root.type!==d.links[link].from) fail('INVALID_ARGUMENT');
      let frontier=[root],items=[];const seen=new Set([id]);
      for(let hop=0;hop<depth;hop++) {
        const next=[];
        for(const node of frontier) for(const endpoint of await u.endpoints(node.id,link)) {
          if (!canRead(c,endpoint)||seen.has(endpoint.id)) continue;
          if(endpoint.type!==d.links[link].to)fail('INCONSISTENT_STATE');
          seen.add(endpoint.id);next.push(endpoint);items.push(project(c,endpoint,d,projection));
          if (seen.size>1000) fail('RATE_LIMITED');
        }
        frontier=next;
      }
      return {items,ontologyVersion:d.ontologyVersion};
    },options);
  }
  async verifyEvidence(u,c,d,request,lock=false) {
    for(const ref of [...request.evidence].sort((a,b)=>String(a.id).localeCompare(String(b.id)))) {
      exact(ref,['id','revision','digest']);
      const object=await u.object(ref.id,lock);authorize(c,object,true);
      if (object.revision!==ref.revision||digest(project(c,object,d))!==ref.digest) fail('INVALID_EVIDENCE');
    }
  }
  validate(credential,request,options) {
    return this.call(credential,'action',async(u,c,d)=>{
      const type=checkAction(request,d);const object=await u.object(request.input.targetId);authorize(c,object);
      if(object.type!==type.targetType) fail('INVALID_ARGUMENT');
      await checkContinuity(u,c,object,request);
      c.actionRequest=request;
      await this.verifyEvidence(u,c,d,request);
      if(object.revision!==request.expectedRevision) fail('CONFLICT');
      const effect=await storeEffect(u,c,d,request,object,this.clock());
      decideStoreAction(d,object,request,effect);
      return {state:'PROPOSED',digest:digest(request),ontologyVersion:d.ontologyVersion};
    },options);
  }
  async submit(credential,request,options={}) {
    let ctx;
    try {
      options=budget(options);
      return await this.state.admission(async()=>{
        const prepared=await this.state.transaction(async u=>{
          ctx=await authenticate(u,credential,'action');const definition=await u.definition();ctx.ontologyVersion=definition.version;ctx.ruleVersion=definition.body.ruleVersion;ctx.workflowVersion=definition.body.workflowVersion;
          const existing=await u.existing(ctx.tenant,ctx.subject,request.idempotencyKey);
          const schema=existing?await u.getDefinition(request.ontologyVersion):definition;
          if(!schema) fail('UNSUPPORTED_VERSION');
          const type=checkAction(request,schema.body);
          const object=await u.object(request.input.targetId);authorize(ctx,object);
          if(object.type!==type.targetType) fail('INVALID_ARGUMENT');
          if(!existing) await checkContinuity(u,ctx,object,request);
          if(!existing) await this.verifyEvidence(u,ctx,definition.body,request);
          const hash=digest({tenant:ctx.tenant,subject:ctx.subject,actionType:request.actionType,actionVersion:request.actionVersion,ontologyVersion:request.ontologyVersion,input:request.input,expectedRevision:request.expectedRevision,evidence:request.evidence,requireApproval:request.requireApproval??false});
          if(existing&&(existing.digest!==hash || (existing.request.compensatesActionId??null)!==(options.compensation?.actionId??null))) fail('IDEMPOTENCY_MISMATCH');
          return {ctx,definition:definition.body,object,hash,existing};
        },options.deadline,options.signal);
        if(options.signal?.aborted) fail('CANCELLED');
        const previous=this.journal.latest(ctx.tenant,ctx.subject,request.idempotencyKey);
        if(previous&&previous.canonicalDigest!==prepared.hash) fail('IDEMPOTENCY_MISMATCH');
        if(prepared.existing) {
          if(!previous||previous.actionId!==prepared.existing.id||previous.operationId!==prepared.existing.operation_id||previous.phase!=='COMMITTED'||!this.journal.committed(prepared.existing.operation_id)) fail('INCONSISTENT_STATE',{actionId:prepared.existing.id});
          return this.response(prepared.existing);
        }
        if(previous&&previous.phase!=='ABORTED') fail('INCONSISTENT_STATE',{actionId:previous.actionId});
        if(this.journal.fenced()) fail('INCONSISTENT_STATE');
        await this.fault('before-intent');
        const actionId=previous?.actionId??randomUUID(),operationId=previous?.operationId??randomUUID();
        const intent={phase:'INTENT',tenant:ctx.tenant,store:prepared.object.store,subject:ctx.subject,actor:ctx.actor,onBehalfOf:ctx.onBehalfOf,delegationId:ctx.delegationId,idempotencyKey:request.idempotencyKey,canonicalDigest:prepared.hash,actionId,operationId,typedInput:request,expectedRevisions:{[prepared.object.id]:request.expectedRevision},evidenceRefs:request.evidence,definitionVersions:{ontology:prepared.definition.ontologyVersion,policy:ctx.policyVersion,rule:prepared.definition.ruleVersion,workflow:prepared.definition.workflowVersion},target:'synthetic-erp',payloadDigest:digest(request.input)};
        intent.operationKind='submission';
        if(options.compensation)intent.compensation=options.compensation;
        checkBudget(options);this.journal.append(intent);
        let action;
        try {
          await this.fault('after-intent');
          action=await this.state.transaction(async u=>{
            const current=await authenticate(u,credential,'action');
            if(current.actor!==ctx.actor||current.subject!==ctx.subject||current.tenant!==ctx.tenant||current.delegationId!==ctx.delegationId) fail('PERMISSION_DENIED');
            const live=await u.definition();checkAction(request,live.body);
            const object=await u.object(request.input.targetId,true);authorize(current,object);
            await checkContinuity(u,current,object,request);
            await this.verifyEvidence(u,current,live.body,request,true);
            const effect=object.revision===request.expectedRevision?await storeEffect(u,current,live.body,request,object,this.clock()):null;
            let state=object.revision!==request.expectedRevision?'CONFLICT':decideStoreAction(live.body,object,request,effect);
            const record={id:actionId,tenant:current.tenant,subject:current.subject,actor:current.actor,store:object.store,key:request.idempotencyKey,digest:prepared.hash,state,request:{...request,delegationId:current.delegationId,policyEpoch:current.policyEpoch,policyVersion:current.policyVersion,ruleVersion:live.body.ruleVersion,workflowVersion:live.body.workflowVersion},result:{targetId:object.id,objectRevision:object.revision},operation_id:operationId};
            if(options.compensation){
              const original=await u.action(options.compensation.actionId);
              if(!original||original.tenant!==current.tenant||original.store!==object.store||original.state!=='SUCCEEDED'||original.operation_id!==options.compensation.operationId||original.request.actionType!=='SetIsolation'||original.request.input.targetId!==object.id||!original.request.input.isolated||request.input.isolated!==false||request.requireApproval!==true)fail('MANUAL_REVIEW_REQUIRED');
              record.request.compensatesActionId=original.id;record.request.compensatesOperationId=original.operation_id;
              await u.audit({kind:'CompensationProposed',actor:current.actor,actionId,operationId,compensatesActionId:original.id,compensatesOperationId:original.operation_id});
            }
            await u.saveAction(record);await this.fault('after-action');
            if(state==='PENDING_EXTERNAL') {
              const changed=await u.mutate(object,effect?.fields??{...object.fields,isolated:request.input.isolated},actionId);record.result.objectRevision=changed.revision;
              await this.fault('after-object');
              await u.enqueue({contractVersion:'1.0.0',schemaVersion:live.version,operationId,actionId,aggregateId:object.id,tenant:current.tenant,store:object.store,sequence:await u.nextSequence(object.id),objectRevision:changed.revision,actor:current.actor,onBehalfOf:current.onBehalfOf,causationId:actionId,correlationId:actionId,actionType:request.actionType,fields:changed.fields});
              await this.fault('after-outbox');
              await u.updateAction(actionId,state,record.result);
            }
            await this.fault('before-audit');
            await u.audit({kind:state,actionId,operationId,actor:current.actor,onBehalfOf:current.onBehalfOf,policyVersion:current.policyVersion,ontologyVersion:live.version,ruleVersion:live.body.ruleVersion,workflowVersion:live.body.workflowVersion,inputDigest:prepared.hash,evidence:request.evidence,objectRevision:record.result.objectRevision});
            await this.fault('before-commit');
            if(options.signal?.aborted) fail('CANCELLED');
            return await u.action(actionId);
          },options.deadline,options.signal);
        } catch(error) { if(!error.details?.commitUnknown)this.journal.append({...intent,phase:'ABORTED'}); throw error; }
        // A failure here leaves a real commit and no durable acknowledgement. Fence replays/dispatch.
        await this.fault('after-commit');
        const externalEvent=await this.state.transaction(u=>u.outbox(operationId));
        this.journal.append({...intent,phase:'COMMITTED',deliveryProtocol:'journal-send-v1',commitRevisions:action.result,externalEvent:externalEvent?.event??null,committedAt:new Date().toISOString()});
        await this.fault('after-marker');
        return this.response(action);
      },options);
    } catch(error) { return this.reject(error,'submit',ctx,request); }
  }
  response(action) { return {actionId:action.id,state:action.state,revision:action.revision,operationId:action.operation_id,result:action.result}; }
  status(credential,{actionId},options) {
    return this.call(credential,'read',async(u,c)=>{const a=await u.action(actionId);if(!a||a.tenant!==c.tenant||!c.stores.includes(a.store)) fail('NOT_FOUND');return this.response(a);},options);
  }
  savedActionEvidence(action) {
    return {actionId:action.id,operationId:action.operation_id,actionType:action.request.actionType,targetId:action.request.input.targetId,inputDigest:action.digest,evidence:action.request.evidence,originalActor:action.actor,originalSubject:action.subject,originalDelegationId:action.request.delegationId??null,originalVersions:{ontology:action.request.ontologyVersion,policy:action.request.policyVersion,rule:action.request.ruleVersion,workflow:action.request.workflowVersion}};
  }
  approve(credential,{actionId},options) {
    return this.withBudget('approve',options,options=>this.state.admission(async()=>{
      const prepared=await this.call(credential,'approve',async(u,c)=>{const a=await u.action(actionId);if(!a||a.tenant!==c.tenant||!c.stores.includes(a.store))fail('NOT_FOUND');c.savedActionEvidence=this.savedActionEvidence(a);if(a.actor===c.actor||a.state!=='PENDING_APPROVAL')fail('PERMISSION_DENIED');return {a,c};},options);
      if(this.journal.fenced()) fail('INCONSISTENT_STATE');
      const {a,c}=prepared;
      const submission=this.journal.latest(a.tenant,a.subject,a.key);
      if(!submission||submission.phase!=='COMMITTED'||submission.actionId!==a.id||submission.operationId!==a.operation_id||submission.canonicalDigest!==a.digest)fail('INCONSISTENT_STATE');
      const intent={...submission,operationKind:'approval',phase:'INTENT',approvalActor:c.actor};
      delete intent.recordHash;delete intent.previousHash;delete intent.sequence;
      checkBudget(options);this.journal.append(intent);
      let response;try {response=await this.call(credential,'approve',async(u,c,d)=>{
      const a=await u.action(actionId,true);
      if(!a||a.tenant!==c.tenant||!c.stores.includes(a.store)) fail('NOT_FOUND');
      c.savedActionEvidence=this.savedActionEvidence(a);
      if(a.actor===c.actor||a.state!=='PENDING_APPROVAL') fail('PERMISSION_DENIED');
      const object=await u.object(a.request.input.targetId,true);authorize(c,object);
      await checkContinuity(u,c,object,a.request);
      const original=await actionContext(u,a,c);
      if(a.request.ontologyVersion!==d.ontologyVersion||a.request.ruleVersion!==d.ruleVersion||a.request.workflowVersion!==d.workflowVersion||a.request.policyVersion!==c.policyVersion||a.request.policyEpoch!==c.policyEpoch||object.revision!==a.request.expectedRevision) fail('STALE_APPROVAL');
      enforcePolicy(d,'action');const effect=await storeEffect(u,original,d,a.request,object,this.clock());decideStoreAction(d,object,a.request,effect);
      await this.verifyEvidence(u,original,d,a.request,true);
      await this.fault('approval-after-evidence');
      const changed=await u.mutate(object,effect?.fields??{...object.fields,isolated:a.request.input.isolated},a.id);
      await u.enqueue({contractVersion:'1.0.0',schemaVersion:d.ontologyVersion,operationId:a.operation_id,actionId:a.id,aggregateId:object.id,tenant:c.tenant,store:object.store,sequence:await u.nextSequence(object.id),objectRevision:changed.revision,actor:a.actor,onBehalfOf:a.subject===a.actor?null:a.subject,causationId:a.id,correlationId:a.id,actionType:a.request.actionType,fields:changed.fields});
      const result={targetId:object.id,objectRevision:changed.revision,approver:c.actor};
      await u.updateAction(a.id,'PENDING_EXTERNAL',result);
      await u.audit({kind:'ApprovedCommit',actionId:a.id,operationId:a.operation_id,actor:c.actor,onBehalfOf:c.onBehalfOf,ontologyVersion:d.ontologyVersion,policyVersion:c.policyVersion,ruleVersion:d.ruleVersion,workflowVersion:d.workflowVersion,evidence:a.request.evidence,objectRevision:changed.revision,inputDigest:a.digest});
      return this.response(await u.action(a.id));
      },options);}catch(error){if(!error.details?.commitUnknown)this.journal.append({...intent,phase:'ABORTED'});throw error;}
      const externalEvent=await this.state.transaction(u=>u.outbox(a.operation_id));
      this.journal.append({...intent,phase:'COMMITTED',deliveryProtocol:'journal-send-v1',commitRevisions:response.result,externalEvent:externalEvent?.event??null,committedAt:new Date().toISOString()});return response;
    },options));
  }
  tool(credential,{name,args},options) {
    return this.call(credential,'tool',async(u,c,d)=>{
      if(name==='objects.search') {
        // Tool permission is intersected with the underlying operation permission.
        const searchContext=await authenticate(u,credential,'search');return this.readQuery(u,searchContext,d,args);
      }
      if(name!=='actions.propose') fail('PERMISSION_DENIED');
      await authenticate(u,credential,'action');checkAction(args,d);
      if(!args.evidence.length) fail('INVALID_EVIDENCE');
      await this.verifyEvidence(u,c,d,args);
      const object=await u.object(args.input.targetId);authorize(c,object);
      decideAction(d,object,args.input,true);
      if(!args.evidence.some(e=>e.id===object.id)||object.revision!==args.expectedRevision) fail('INVALID_EVIDENCE');
      return {state:'PROPOSED',proposal:{...args,requireApproval:true},evidenceIds:args.evidence.map(e=>e.id),policyVersion:c.policyVersion,ontologyVersion:d.ontologyVersion};
    },options);
  }
  definitionDiff(credential,{version},options) {return this.call(credential,'author',async(u,c,d)=>{
    const row=await u.getDefinition(version);if(!row)fail('NOT_FOUND');
    const changes=[];const walk=(a,b,path)=>{if(canonical(a)===canonical(b))return;if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))walk(a[key]??null,b[key]??null,path+'/'+key);}else changes.push({path,before:a??null,after:b??null});};walk(d,row.body,'');return {version,baselineDigest:digest(d),digest:row.digest,changes,cases:row.cases};
  },options);}
  editCases(credential,{version,cases},options) {return this.call(credential,'author',async(u,c)=>{
    const row=await u.getDefinition(version);if(!row||row.author!==c.actor||!['DRAFT','REVIEWED'].includes(row.state))fail('PERMISSION_DENIED');
    if(!Array.isArray(cases)||cases.length>100)fail('INVALID_ARGUMENT');
    for(const sample of cases){exact(sample,['id','isolated','expected']);if(typeof sample.id!=='string'||typeof sample.isolated!=='boolean'||!['PENDING_APPROVAL','PENDING_EXTERNAL','PERMISSION_DENIED','RULE_REJECTED'].includes(sample.expected))fail('INVALID_ARGUMENT');const object=await u.object(sample.id);authorize(c,object);if(object.type!=='InventoryPosition')fail('INVALID_ARGUMENT');}
    await u.editCases(row,cases);return {version,casesDigest:digest(cases),state:'DRAFT'};
  },options);}
  draft(credential,{definition},options) { return this.call(credential,'author',async(u,c,d)=>{validateDefinition(definition);compatible(d,definition);versionPrograms(d,definition);await u.saveDefinition(definition,c.actor);return {version:definition.ontologyVersion,digest:digest(definition),diff:canonical(d)===canonical(definition)?'same':'changed'};},options); }
  review(credential,{version},options) { return this.call(credential,'review',async(u,c,d)=>{
    const row=await u.getDefinition(version);if(!row||row.author===c.actor||row.state!=='DRAFT') fail('PERMISSION_DENIED');compatible(d,row.body);
    await this.fault('review-after-definition');
    const objects=await u.objects('InventoryPosition',c.tenant);if(objects.length>1000) fail('RATE_LIMITED');
    for(const o of objects.filter(o=>canRead(c,o))) for(const [name,field] of Object.entries(row.body.types[o.type].fields)) if(!Object.hasOwn(o.fields,name)&&!field.nullable) fail('INCOMPATIBLE_DEFINITION');
    const scoped=objects.filter(o=>canRead(c,o));
    const decisions=[];for(const object of scoped)for(const isolated of [true,false]){let state;try{enforcePolicy(row.body,'action');state=decideAction(row.body,object,{isolated});}catch(error){if(!(error instanceof PlatformError))throw error;state=error.code;}decisions.push({id:object.id,revision:object.revision,isolated,state});}
    const caseResults=[];for(const sample of row.cases){const object=await u.object(sample.id);authorize(c,object);let actual;try{enforcePolicy(row.body,'action');actual=decideAction(row.body,object,sample);}catch(error){if(!(error instanceof PlatformError))throw error;actual=error.code;}caseResults.push({...sample,revision:object.revision,actual,passed:actual===sample.expected});}
    if(caseResults.some(sample=>!sample.passed))fail('SIMULATION_FAILED');
    const simulation={casesDigest:digest(row.cases),casesRevision:row.cases_revision,caseResults,objectsChecked:scoped.length,digest:row.digest,baselineDigest:digest(d),compatible:true,decisions};await u.reviewDefinition(row,c.actor,simulation);return simulation;
  },options); }
  publish(credential,{version,rollback=false},options) { return this.call(credential,'publish',async(u,c,d)=>{
    const row=await u.getDefinition(version);if(!row||!row.reviewer||!row.simulation||!['REVIEWED','PUBLISHED'].includes(row.state)) fail('PERMISSION_DENIED');
    await this.fault('publish-after-definition');
    // Drain existing authorized transactions before locking any Object or
    // definition row. Actions acquire Policy SHARE before Object UPDATE.
    await u.policy(true);
    if(rollback&&row.state!=='PUBLISHED')fail('PERMISSION_DENIED');
    if(row.simulation.casesDigest!==digest(row.cases)||row.simulation.casesRevision!==row.cases_revision||row.simulation.digest!==row.digest)fail('STALE_REVIEW');
    if(!rollback&&row.state==='REVIEWED'&&row.simulation.baselineDigest!==digest(d))fail('STALE_REVIEW');
    if(!rollback){
      const references=[...(row.simulation.decisions??[]),...(row.simulation.caseResults??[])].sort((a,b)=>a.id.localeCompare(b.id));
      for(const decision of references){const object=await u.object(decision.id,true);authorize(c,object);if(object.revision!==decision.revision)fail('STALE_REVIEW');}
    }
    await this.fault('publish-after-objects');
    if(rollback) compatible(row.body,d);else compatible(d,row.body);
    await u.publish(row);await this.fault('publish-before-audit');return {version,digest:row.digest,reviewer:row.reviewer,rollback};
  },options); }
  journalSnapshot(credential,{store},options) { return this.call(credential,'recovery',async(u,c)=>this.journal.snapshot(c,store),options); }
  journalList(credential,{snapshot,cursor,limit},options) { return this.call(credential,'recovery',async(u,c)=>this.journal.list(c,snapshot,cursor,limit),options); }
  consume(credential,{operationId},options) {
    return this.call(credential,'worker',async(u,c)=>{
      const event=await u.outbox(operationId,true);if(!event) fail('NOT_FOUND');
      if(event.event.tenant!==c.tenant||!c.stores.includes(event.event.store)) fail('PERMISSION_DENIED');
      if(!this.journal.committed(operationId)) fail('INCONSISTENT_STATE');
      const live=await u.definition();enforcePolicy(live.body,'action');
      const original=await u.action(event.action_id);const principal=await u.principal(original.actor),subject=await u.principal(original.subject);
      if(!principal?.active||!subject?.active||!principal.operations.includes('action')||!subject.operations.includes('action')||!principal.stores.includes(original.store)||!subject.stores.includes(original.store)) fail('PERMISSION_DENIED');
      if(original.request.delegationId){const delegation=await u.delegation(original.request.delegationId);if(!delegation?.active||delegation.expires.getTime()<=Date.now()||delegation.actor!==original.actor||delegation.subject!==original.subject||delegation.audience!=='kernel'||!delegation.operations.includes('action')||!delegation.stores.includes(original.store))fail('PERMISSION_DENIED');u.requireAuthorityUntil(delegation.expires);}
      const prior=await u.inbox(operationId);
      if(prior) {if(prior.digest!==event.digest) fail('IDEMPOTENCY_MISMATCH');return {state:'DUPLICATE'};}
      if(digest(event.event)!==event.digest) {await u.finish(operationId,'DEAD_LETTER');await u.audit({kind:'PoisonEvent',operationId,actor:c.actor,reason:'digest-mismatch'});return {state:'DEAD_LETTER'};}
      const projection=await u.projection(event.aggregate_id);
      if(event.sequence!==(projection?.sequence??0)+1) return {state:'GAP'};
      await u.consume(event.event,event.digest);await this.fault('after-inbox');
      // Projection Inbox acknowledgement is independent of ERP writeback.
      await u.audit({kind:'Consumed',operationId,actionId:event.action_id,actor:c.actor,objectRevision:event.event.objectRevision});
      return {state:'DELIVERED',sequence:event.sequence};
    },options);
  }
  capabilities(credential,body={},options) {return this.call(credential,'read',()=>{exact(body,[]);return {version:'1.0.0',unavailable:['model','agent','embedding','parse','feature','stream','cache','lake-table']};},options);}
  capability(credential,{name},options) { return this.call(credential,'read',async()=>{if(['model','agent','embedding','parse','feature','stream','cache','lake-table'].includes(name)) fail('UNSUPPORTED_CAPABILITY');fail('INVALID_ARGUMENT');},options); }
}
