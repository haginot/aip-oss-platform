// Source preparation and separately typed component evidence. This is NOT H,
// a product initializer, runtime installer, or product evidence authority.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync,mkdirSync,openSync,closeSync,writeFileSync,fsyncSync,renameSync,unlinkSync,statSync,fstatSync,lstatSync,readSync,realpathSync,readlinkSync,constants as fsConstants} from 'node:fs';
import {relative,resolve,isAbsolute,dirname} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID,randomBytes,createPublicKey,verify as verifySignature} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {Readable,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {currentContext} from './context.mjs';
const {parse:parseYaml}=createRequire(new URL('../../node_modules/takt/package.json',import.meta.url))('yaml');
import {getGlobalConfigDir} from '../../node_modules/takt/dist/infra/config/paths.js';
import {resolveStatePaths} from '../../node_modules/takt/dist/core/execution/locations.js';
import {loadWorkflowExecutionBundle} from '../../node_modules/takt/dist/features/tasks/execute/workflowExecutionBundle.js';
import {hash,confined,inputs,snapshot,parseTap,validatePlan} from './evidence.mjs';
import {validateReadonlyDefinition} from './approval.mjs';
import {validateCandidate,closureAttestation,validateClosureApproval} from './closure.mjs';
import {suitesFor} from './gate-execution.mjs';
import {runtimeFiles} from './runtime.mjs';
import {resolvePersonaSessionId} from '../../node_modules/takt/dist/infra/config/project/sessionStore.js';
import {loadRuntimeProviderFileAt} from '../../node_modules/takt/dist/infra/config/runtime-provider/loader.js';
import {compileProviderEnvironment} from '../../node_modules/takt/dist/infra/config/runtime-provider/environment.js';
import {resolveStepProviderModel} from '../../node_modules/takt/dist/core/workflow/provider-resolution.js';
import {resolvePromotionRuntime} from '../../node_modules/takt/dist/core/workflow/promotion/promotion-runtime.js';
import {resolveProfileScopedProviderOptionsLayers} from '../../node_modules/takt/dist/infra/config/providerOptions.js';

const bytes=(root,path)=>readFileSync(confined(root,path));
function canonicalHistoricalInputs(root,entries){
 for(const e of entries){
  assert.equal(relative(root,confined(root,e.path)),e.path,'historical input noncanonical path');
  assert.ok(!e.path.includes('\\'),'historical input noncanonical path');
 }
 const paths=entries.map(e=>e.path);
 assert.deepEqual(paths,[...paths].sort((a,b)=>a.localeCompare(b,'en')),'historical input order');
}
// The locked runtime may retain tar nested below its package rather than
// hoisting it into the project root. Do not add or substitute a dependency.
const {Parser}=createRequire(new URL('../../node_modules/takt/package.json',import.meta.url))('tar');
const read=(root,path)=>JSON.parse(bytes(root,path));
const receiptPath=id=>`evidence/enterprise/runs/${id}/receipt.json`;
function block(raw,name){
 const matches=[...raw.matchAll(new RegExp('^```'+name+'\\r?\\n([\\s\\S]*?)^```\\s*$','gm'))];
 assert.equal(matches.length,1,`single ${name} required`);return JSON.parse(matches[0][1]);
}
function completed(context,index,key,readonly=true,routing={provider:'codex',model:'gpt-6-astra',effort:'high'}){
 const start=context.records[index];assert.equal(start?.type,'step_start','missing occurrence');
 const def=context.steps.find(s=>s.name===start.step);assert.equal(def?.sessionKey??def?.session_key,key);
 if(readonly)validateReadonlyDefinition(def,'preparation review');else assert.equal(def.edit,true);
 assert.equal(start.provider,routing.provider,'occurrence provider');assert.equal(start.model,routing.model,'occurrence model');assert.equal(start.providerOptions?.codex?.reasoningEffort,routing.effort,'occurrence effort');
 assert.equal(start.workflow,context.identity.workflow);assert.equal(start.stack?.[0]?.workflow_ref,context.identity.workflowRef);
 const session=resolvePersonaSessionId(context.sessions,JSON.stringify([key,start.provider,start.model]),start.provider);assert.ok(session);
 if(readonly)assert.ok(!context.builderSessions.includes(session),'independent review session required');
 let end=context.records.findIndex((r,i)=>i>index&&r.type==='step_start');if(end<0)end=context.records.length;
 const records=context.records.slice(index+1,end),same=r=>r.step===start.step&&r.iteration===start.iteration&&r.workflow===start.workflow&&JSON.stringify(r.stack)===JSON.stringify(start.stack);
 const phases=[1,2].map(phase=>records.filter(r=>r.type==='phase_complete'&&r.phase===phase&&same(r)));
 const done=records.filter(r=>r.type==='step_complete'&&same(r));
 assert.ok(phases.every(p=>p.length===1&&p[0].status==='done')&&done.length===1&&done[0].status==='done','incomplete preparation occurrence');
 const [p1,p2]=phases.map(p=>p[0]);assert.ok(records.indexOf(p1)<records.indexOf(p2)&&records.indexOf(p2)<records.indexOf(done[0]),'preparation phase order');
 return {start,index,end,session,phases:[p1,p2],definition:def};
}

// Diagnostic only: a matching cause is not approval or proof of provenance.
// The source assessment below separately authenticates the plan, raw receipt,
// occurrence, index, and source runtime before using this result.
export function inspectFailedReceipt(root,run,definitions){
 assert.equal(run.schemaVersion,1);assert.equal(run.status,'failed','completed failed receipt required');
 assert.ok(Number.isFinite(Date.parse(run.startedAt))&&Date.parse(run.finishedAt)>=Date.parse(run.startedAt),'unfinished failed receipt');
 assert.ok(run.suites.length>0&&run.suites.length<=definitions.length,'failed suite prefix');
 assert.equal(run.inputs.digest,hash(JSON.stringify({entries:run.inputs.entries,runtime:run.inputs.runtime})),'failed manifest digest');
 assert.equal(new Set(definitions.map(s=>s.id)).size,definitions.length,'duplicate failed suite definition');
 assert.equal(new Set(run.suites.map(s=>s.id)).size,run.suites.length,'duplicate failed suite execution');
 let cause,previousFinish=Date.parse(run.startedAt);
 for(const [n,suite] of run.suites.entries()){
  const definition=definitions[n];assert.equal(suite.id,definition.id);assert.equal(suite.definitionHash,hash(JSON.stringify(definition)));assert.deepEqual(suite.argv,definition.command);
  assert.equal(suite.cwd,root);assert.ok(suite.runtime?.node&&suite.runtime?.executable,'execution runtime required');
  assert.ok(Date.parse(suite.startedAt)>=Date.parse(run.startedAt)&&Date.parse(suite.finishedAt)>=Date.parse(suite.startedAt)&&Date.parse(suite.finishedAt)<=Date.parse(run.finishedAt),'failed execution timestamps');
  assert.ok(Date.parse(suite.startedAt)>=previousFinish,'failed suite execution order');previousFinish=Date.parse(suite.finishedAt);
  // execute() stores each sequential suite in its own receipt namespace.
  // Equal hashes in another receipt/location do not establish that ownership.
  const directory=`evidence/enterprise/runs/${run.id}/suite-${n}`;
  assert.equal(suite.outputDirectory,directory,'failed output directory');
  assert.equal(suite.stdout,`${directory}/stdout.tap`,'failed stdout path');
  assert.equal(suite.stderr,`${directory}/stderr.log`,'failed stderr path');
  const out=bytes(root,suite.stdout),err=bytes(root,suite.stderr);assert.equal(hash(out),suite.stdoutHash,'changed failed stdout');assert.equal(hash(err),suite.stderrHash,'changed failed stderr');
  assert.deepEqual(snapshot(root,[suite.outputDirectory]),suite.outputs,'changed failed artifacts');
  assert.ok(suite.exitCode===null||Number.isInteger(suite.exitCode));assert.ok(suite.signal===null||typeof suite.signal==='string');
  let error,tap,kind='GATE_VALIDATION_FAILURE';
  // Replay the controller's assertions, preserving its exact diagnostic.
  try{
   if(suite.exitCode!==0||suite.signal||suite.error)kind='SUBPROCESS_FAILURE';
   assert.equal(suite.exitCode,0,`nonzero exit ${suite.id}: ${suite.exitCode}; see ${suite.stderr}`);
   assert.equal(suite.signal,null,'signal');assert.ok(!suite.error,'subprocess error');
   assert.equal(suite.inputsAfter,run.inputs.digest,'changed input during run');
   tap=parseTap(out.toString(),definition.requiredAssertions);
  }catch(e){error=e.message;}
  // A corrupted stored TAP summary is not a historical subprocess/gate cause.
  if(tap)assert.deepEqual(suite.tap,tap,'recorded TAP mismatch');
  if(error){assert.equal(n,run.suites.length-1,'suite after failed boundary');cause={kind,suiteId:suite.id,error};}
 }
 assert.ok(cause,'failed receipt without reproducible cause');assert.equal(run.error,cause.error,'failed diagnosis mismatch');
 return cause;
}

// The authenticated selection supplies historical plan bytes, not today's
// plan or a caller-selected suite list. Validate the receipt's manifest before
// deriving its batch definitions. This does not certify every source preimage;
// that remains the separate historical byte reader's responsibility.
function failedReceiptDefinitions(root,run,planText){
 const entries=run.inputs?.entries;
 assert.ok(Array.isArray(entries)&&entries.length,'failed input manifest required');
 assert.equal(new Set(entries.map(e=>e.path)).size,entries.length,'failed input duplicate path');
 for(const e of entries){
  const absolute=confined(root,e.path);
  assert.equal(relative(root,absolute),e.path,'failed input noncanonical path');
  assert.ok(!e.path.includes('\\'),'failed input path separator');
  assert.match(e.sha256,/^[a-f0-9]{64}$/,'failed input hash');
  assert.ok(Number.isSafeInteger(e.bytes)&&e.bytes>=0,'failed input length');
 }
 assert.deepEqual(entries.map(e=>e.path),entries.map(e=>e.path).sort((a,b)=>a.localeCompare(b,'en')),'failed input order');
 const raw=Buffer.from(planText),entry=entries.find(e=>e.path==='work/enterprise/plan.json');
 assert.ok(entry,'failed plan input missing');assert.equal(entry.sha256,hash(raw),'failed plan bytes');assert.equal(entry.bytes,raw.length,'failed plan length');
 const plan=JSON.parse(raw),batches=plan.batches.filter(b=>b.id===run.batchId);
 assert.equal(batches.length,1,'failed plan batch identity');
 const definitions=suitesFor(plan,batches[0].issueIds);
 for(const suite of definitions)assert.ok(entries.some(e=>e.path===suite.path),'failed suite source missing from inputs: '+suite.path);
 return definitions;
}

// P0 successor authority boundary. This does not authenticate source sessions,
// receipt provenance or complete history. No historicalRunSlug, injected context
// or caller-selected adapter can impersonate the source writer here.
export async function inspectSuccessorPreparation(root,reviewManifestPath){
 assert.equal(arguments.length,2,'successor accepts no authority overrides');
 return successorAuthority(root,reviewManifestPath);
}
// Historical builder selection is private and only used after matching the
// current orchestrator's persisted candidate. Never exposed as an override.
async function successorAuthority(root,reviewManifestPath,builderIndex){
 root=resolve(root);const actual=await currentContext(root),before=inputs(root);
 let context=actual;
 if(builderIndex!==undefined){
  const b=completed(actual,builderIndex,'enterprise-builder',false);
  context={...actual,start:b.start,step:b.start.step,iteration:b.start.iteration,sessionKey:'enterprise-builder',providerSessionId:b.session,stepDefinition:b.definition};
 }
 assert.equal(context.step,'build-foundation','successor builder step');
 assert.equal(context.sessionKey,'enterprise-builder','successor builder key');
 assert.equal(context.stepDefinition.edit,true,'successor editable builder');
 assert.equal(context.start.provider,'codex','successor builder provider');
 assert.equal(context.start.model,'gpt-6-astra','successor builder model');
 assert.equal(context.start.providerOptions?.codex?.reasoningEffort,'high','successor builder effort');
 assert.ok(!existsSync(confined(root,'evidence/enterprise/gate.lock')),'successor gate writer active or unknown');
 const index=context.records.findLastIndex(r=>r.type==='step_start'&&r.step==='review-architecture');
 const review=completed(context,index,'enterprise-architecture-reviewer');
 assert.ok(review.end<=context.records.indexOf(context.start),'successor review must precede builder');
 assert.notEqual(review.session,context.providerSessionId,'successor independent reviewer');
 const a=block(review.phases[1].content,'enterprise-continuation-preparation-attestation');
 assert.deepEqual(block(review.phases[0].content,'enterprise-continuation-preparation-attestation'),a,'successor review phases differ');
 const fields=['schemaVersion','verdict','purpose','permission','runSlug','workflowRef','bundleDigest','step','iteration','sessionKey','providerSessionId','runtimeVersion','contractPath','contractSha256','runtimeDeliveryContract','runtimeContinuationContract','planSha256','inputsDigest','entryManifest','sourceRunSlug','sourceCheckpoint','latestSourceHandoff','sourceMetaSnapshot','sourceLogSnapshot','permittedIncrements','permittedPaths','currentApprovals','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority','unresolvedFindings'];
 assert.deepEqual(Object.keys(a).sort(),fields.sort(),'successor attestation fields');
 for(const [key,value] of Object.entries({schemaVersion:1,verdict:'APPROVE',purpose:'PREPARE_SUCCESSOR_HISTORY_COMPONENTS',permission:'PREPARATION_AND_HISTORY_ONLY',runSlug:context.identity.runSlug,workflowRef:context.identity.workflowRef,bundleDigest:context.identity.bundleDigest,step:'review-architecture',iteration:review.start.iteration,sessionKey:'enterprise-architecture-reviewer',providerSessionId:review.session,runtimeVersion:context.identity.runtime.version,contractPath:'work/enterprise/PREPARATION_ENTRY.md',initializationAuthority:false,targetLaunchAuthority:false,runtimeReplacementAuthority:false}))assert.equal(a[key],value,'successor '+key);
 assert.deepEqual(a.currentApprovals,[],'successor current approvals');assert.deepEqual(a.unresolvedFindings,[],'successor unresolved design findings');
 assert.equal(review.definition.outputContracts?.length,1,'successor report contract');
 const canonical=confined(context.identity.runRoot,relative(context.identity.runRoot,context.identity.reportDirectory)+'/'+review.definition.outputContracts[0].name),reportRaw=readFileSync(canonical);
 assert.ok(reportRaw.toString()===review.phases[1].content||reportRaw.toString()===review.phases[1].content+'\n','successor canonical report mismatch');
 const references=new Map();
 const bind=(ref)=>{
  assert.deepEqual(Object.keys(ref).sort(),['path','sha256'],'successor reference fields');
  assert.equal(relative(root,confined(root,ref.path)),ref.path,'successor canonical reference');
  assert.ok(!ref.path.includes('\\'),'successor reference separator');assert.match(ref.sha256,/^[a-f0-9]{64}$/,'successor reference hash');
  const raw=bytes(root,ref.path);assert.equal(hash(raw),ref.sha256,'changed successor reference: '+ref.path);
  const entry={...ref,bytes:raw.length};if(references.has(ref.path))assert.deepEqual(references.get(ref.path),entry,'successor conflicting reference');references.set(ref.path,entry);return raw;
 };
 bind({path:a.contractPath,sha256:a.contractSha256});
 for(const [field,path] of [['runtimeDeliveryContract','work/enterprise/RUNTIME_DELIVERY.md'],['runtimeContinuationContract','work/enterprise/RUNTIME_CONTINUATION.md']]){assert.equal(a[field].path,path,'successor contract path');bind(a[field]);}
 const plan=JSON.parse(bind({path:'work/enterprise/plan.json',sha256:a.planSha256}));validatePlan(root,plan,read(root,'work/enterprise/backlog.json'));
 const entry=plan.preparationEntry;assert.ok(entry,'successor preparation plan required');
 for(const key of ['schemaVersion','runSlug','sourceRunSlug','purpose','permission','runtimeVersion','currentApprovals','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority','permittedPaths'])assert.deepEqual(a[key],entry[key],'successor plan '+key);
 assert.equal(entry.contract,a.contractPath);assert.equal(entry.attestation,'enterprise-continuation-preparation-attestation');assert.equal(entry.isAuthorizedMigrationTarget,false,'successor is not migration target');
 assert.deepEqual(a.permittedIncrements,['P0','P1','P2','P3','R1b'],'successor permitted increments');
 assert.ok(a.permittedIncrements.every(v=>entry.increments.includes(v)),'successor plan increments');
 assert.ok(Array.isArray(a.permittedPaths)&&a.permittedPaths.length>0&&new Set(a.permittedPaths).size===a.permittedPaths.length,'successor permitted paths');
 assert.match(a.sourceRunSlug,/^[A-Za-z0-9_-]+$/,'successor source run');assert.notEqual(a.sourceRunSlug,a.runSlug,'successor cannot impersonate source');
 // The locator is untrusted. Its complete manifest digest must be the exact
 // digest independently approved in A_P. Later edits are limited to named paths.
 assert.ok(typeof reviewManifestPath==='string'&&reviewManifestPath.startsWith('evidence/'),'successor review manifest locator');
 const manifestRaw=bytes(root,reviewManifestPath),manifest=JSON.parse(manifestRaw);
 assert.ok(Array.isArray(manifest.entries)&&manifest.entries.length,'successor review manifest entries');
 assert.equal(manifest.digest,hash(JSON.stringify({entries:manifest.entries,runtime:manifest.runtime})),'successor review manifest digest');
 assert.equal(manifest.digest,a.inputsDigest,'successor review manifest authority');
 canonicalHistoricalInputs(root,manifest.entries);
 assert.equal(new Set(manifest.entries.map(e=>e.path)).size,manifest.entries.length,'successor manifest duplicate');
 assert.deepEqual(manifest.runtime,before.runtime,'successor reviewed runtime changed');
 // The prospective native helper is explicitly approved before it exists.
 // Preserve every reviewed input, and allow only this reviewed new source path
 // to enter the manifest. This grants source preparation, never native launch.
 const reviewedEntries=new Map(manifest.entries.map(e=>[e.path,e]));
 const currentEntries=new Map(before.entries.map(e=>[e.path,e]));
 for(const e of manifest.entries)assert.ok(currentEntries.has(e.path),'successor input removed: '+e.path);
 const containment=plan.preparationReview?.acceptanceScope?.producerContainmentDefinition;
 for(const e of before.entries)if(!reviewedEntries.has(e.path)){
  assert.ok(e.path==='scripts/enterprise/preparation-producer-linux.c'&&
   a.permittedPaths.includes(e.path)&&
   plan.preparationReview?.acceptanceScope?.profileId==='P0-source-provenance-v3'&&
   containment?.schemaVersion===1&&containment.profileId==='P0-source-provenance-v3'&&
   containment.implementationPaths?.includes(e.path),'successor input addition not approved: '+e.path);
 }
 const changedPaths=[];
 for(const e of before.entries)if(JSON.stringify(e)!==JSON.stringify(reviewedEntries.get(e.path))){assert.ok(a.permittedPaths.includes(e.path),'successor unreviewed input change: '+e.path);changedPaths.push(e.path);}
 bind({path:reviewManifestPath,sha256:hash(manifestRaw)});
 const preserved=JSON.parse(bind(a.entryManifest));assert.equal(preserved.schemaVersion,1);assert.equal(preserved.runSlug,a.runSlug,'successor entry manifest run');
 assert.deepEqual(a.sourceCheckpoint,entry.sourceCheckpoint,'successor checkpoint contract');
 assert.deepEqual(Object.keys(a.sourceCheckpoint).sort(),['index','progress','selection'],'successor checkpoint fields');
 assert.equal(a.sourceCheckpoint.progress.path,'work/enterprise/progress.json');assert.equal(a.sourceCheckpoint.index.path,'evidence/enterprise/runs/index.json');
 const progress=JSON.parse(bind(a.sourceCheckpoint.progress));bind(a.sourceCheckpoint.index);
 assert.equal(progress.runBinding?.runSlug,a.sourceRunSlug,'successor source progress run');
 assert.equal(progress.entrySelection,a.sourceCheckpoint.selection.path);assert.equal(progress.entrySelectionHash,a.sourceCheckpoint.selection.sha256);
 const selection=JSON.parse(bind(a.sourceCheckpoint.selection));assert.equal(selection.batchId,progress.activeBatchId);assert.equal(selection.inputsDigest,progress.entryInputs);
 assert.deepEqual(a.latestSourceHandoff,entry.latestHandoff,'successor latest source handoff');
 const handoff=JSON.parse(bind(a.latestSourceHandoff));assert.equal(handoff.run,a.sourceRunSlug,'successor handoff run');
 assert.equal(a.sourceMetaSnapshot.path,entry.sourceMetaSnapshot,'successor source meta locator');
 const metaRaw=bind(a.sourceMetaSnapshot),logRaw=bind(a.sourceLogSnapshot),meta=JSON.parse(metaRaw),records=logRaw.toString().trim().split('\n').map(JSON.parse);
 assert.equal(meta.runSlug,a.sourceRunSlug,'successor terminal run');assert.equal(meta.status,'failed','successor source terminal required');assert.equal(meta.reason,'Max steps reached','successor source terminal reason');
 assert.ok(Number.isFinite(Date.parse(meta.endTime)),'successor terminal time');
 const terminal=records.at(-1);assert.equal(terminal?.type,'workflow_abort','successor terminal log required');assert.equal(terminal.reason,meta.reason);assert.equal(terminal.endTime,meta.endTime);assert.equal(terminal.iterations,meta.iterations);
 assert.equal(handoff.iteration,meta.currentIteration,'successor terminal handoff iteration');
 // Anchor the reviewed snapshots to the real sibling source run, never the
 // mutable current persona session store or a forged historical currentContext.
 const sourceRoot=confined(resolve(context.identity.runRoot,'..'),a.sourceRunSlug);
 const sourceMeta=confined(sourceRoot,'meta.json'),logs=confined(sourceRoot,'logs');
 const names=readdirSync(logs).filter(n=>n.endsWith('.jsonl'));assert.equal(names.length,1,'successor source log ambiguous');
 const sourceLog=confined(sourceRoot,'logs/'+names[0]);
 const recheck=async()=>{
  for(const r of references.values()){const raw=bytes(root,r.path);assert.equal(hash(raw),r.sha256,'concurrent successor reference: '+r.path);assert.equal(raw.length,r.bytes);}
  assert.deepEqual(readFileSync(sourceMeta),metaRaw,'successor source meta checkpoint changed');assert.deepEqual(readFileSync(sourceLog),logRaw,'successor source log checkpoint changed');
  assert.deepEqual(readFileSync(canonical),reportRaw,'concurrent successor canonical report');
  assert.deepEqual(await currentContext(root),actual,'concurrent successor authority');assert.deepEqual(inputs(root),before,'concurrent successor inputs');
  assert.ok(!existsSync(confined(root,'evidence/enterprise/gate.lock')),'successor gate writer active or unknown');
 };
 await recheck();await recheck();
 return {schemaVersion:1,kind:'SUCCESSOR_PREPARATION_AUTHORITY_DIAGNOSTIC',preparationRunSlug:a.runSlug,sourceRunSlug:a.sourceRunSlug,iteration:context.iteration,builderSession:context.providerSessionId,reviewSession:review.session,designReportSha256:hash(reportRaw),reviewInputsDigest:a.inputsDigest,currentInputs:before,changedPaths,references:[...references.values()],sourceTerminal:{iterations:meta.iterations,endTime:meta.endTime,reason:meta.reason},preparationAuthorityAuthenticated:true,sourceCheckpointBound:true,historicalSessionsAuthenticated:false,executionOriginProven:false,exclusiveWriterProven:false,completeMigrationHistory:false,initializationAuthority:false,targetLaunchAuthority:false,runtimeReplacementAuthority:false,currentApprovals:[],remaining:['SOURCE_HISTORICAL_SESSION_PLAN_RUNTIME_ADAPTER','COMPLETE_HISTORICAL_BYTES_AND_DEPENDENCIES','EXECUTION_ORIGIN','SOURCE_WRITER_QUIESCENCE_AND_HOST_EXCLUSION','TARGET_DESIGN_AND_INITIALIZATION']};
}

// Q's independent implementation boundary. Deliberately private and read-only:
// the returned JSON is a diagnostic, never a capability accepted by a writer.
// The diagnostic runner below re-authenticates privately; it never accepts this JSON as a token.
async function inspectComponentDevelopment(root){
 root=resolve(root);const context=await currentContext(root),before=inputs(root);
 assert.equal(context.step,'build-foundation','restart builder step');
 assert.equal(context.sessionKey,'enterprise-builder','restart builder key');
 assert.equal(context.stepDefinition.edit,true,'restart editable builder');
 assert.equal(context.start.provider,'codex','restart builder provider');
 assert.equal(context.start.model,'gpt-6-astra','restart builder model');
 assert.equal(context.start.providerOptions?.codex?.reasoningEffort,'high','restart builder effort');
 const index=context.records.findLastIndex(r=>r.type==='step_start'&&r.step==='review-architecture');
 const review=completed(context,index,'enterprise-architecture-reviewer');
 assert.ok(review.end<=context.records.indexOf(context.start),'restart review must precede builder');
 assert.notEqual(review.session,context.providerSessionId,'restart independent reviewer');
 const a=block(review.phases[1].content,'enterprise-preparation-restart-attestation');
 assert.deepEqual(block(review.phases[0].content,'enterprise-preparation-restart-attestation'),a,'restart review phases differ');
 if(a.schemaVersion===5){assert.ok(a.runtimeRoles&&a.contractPath==='work/enterprise/COMPONENT_SUCCESSOR.md','restart schemaVersion5 attestation fields');return inspectSuccessorDevelopment(root);}
 const continuation=a.schemaVersion===4;
 if(a.schemaVersion===3||continuation)for(const phase of review.phases)assert.deepEqual(prepBlock(phase.content,'enterprise-preparation-restart-attestation'),a,'restart strict schema3 phases');
 const parse=(a.schemaVersion===3||continuation)?strictPreparationJSON:JSON.parse;
 const fields=['schemaVersion','verdict','purpose','permission','runSlug','workflowRef','bundleDigest','step','iteration','sessionKey','providerSessionId','runtimeVersion','runtimeIdentity','contractPath','contractSha256','planSha256','reviewInputsDigest','reviewInputsManifest','entryManifest','sourceCheckpoint','permittedPaths','currentApprovals','captureAuthority','recoveryAuthority','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority'];
 assert.deepEqual(Object.keys(a).sort(),(continuation?[...fields,'componentReviewAuthority','continuationCheckpoint']:a.schemaVersion===3?[...fields,'componentReviewAuthority']:fields).sort(),a.schemaVersion===3?'restart schemaVersion 3 attestation fields':'restart attestation fields');
 assert.ok([1,2,3,4].includes(a.schemaVersion),'restart schemaVersion');
 if(a.schemaVersion===3||continuation)assert.equal(a.componentReviewAuthority,true,'restart componentReviewAuthority');
 const denied=['captureAuthority','recoveryAuthority','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority'];
 for(const [k,v] of Object.entries({verdict:'APPROVE',purpose:'PREPARE_CONTAINMENT_COMPONENTS',permission:(a.schemaVersion===3||continuation)?'IMPLEMENTATION_AND_ISOLATED_REVIEW_ONLY':'IMPLEMENTATION_AND_ISOLATED_TESTS_ONLY',runSlug:context.identity.runSlug,workflowRef:context.identity.workflowRef,bundleDigest:context.identity.bundleDigest,step:'review-architecture',iteration:review.start.iteration,sessionKey:'enterprise-architecture-reviewer',providerSessionId:review.session,runtimeVersion:context.identity.runtime.version,contractPath:continuation?'work/enterprise/COMPONENT_CONTINUATION.md':'work/enterprise/PREPARATION_RESTART.md',...Object.fromEntries(denied.map(k=>[k,false]))}))assert.equal(a[k],v,'restart '+k);
 assert.deepEqual(a.currentApprovals,[],'restart current approvals');
 assert.deepEqual(a.runtimeIdentity,context.identity.runtime,'restart runtime identity');
 assert.equal(review.definition.outputContracts?.length,1,'restart report contract');
 const canonical=confined(context.identity.runRoot,relative(context.identity.runRoot,context.identity.reportDirectory)+'/'+review.definition.outputContracts[0].name),reportRaw=readFileSync(canonical);
 assert.ok(reportRaw.toString()===review.phases[1].content||reportRaw.toString()===review.phases[1].content+'\n','restart canonical report mismatch');
 const references=new Map(),originals=new Map();
 const bind=ref=>{
  assert.deepEqual(Object.keys(ref).sort(),['path','sha256'],'restart reference fields');
  assert.equal(relative(root,confined(root,ref.path)),ref.path,'restart canonical reference');assert.ok(!ref.path.includes('\\'),'restart reference separator');
  assert.match(ref.sha256,/^[a-f0-9]{64}$/,'restart reference hash');
  const raw=bytes(root,ref.path);assert.equal(hash(raw),ref.sha256,'restart changed reference: '+ref.path);
  const entry={...ref,bytes:raw.length};if(references.has(ref.path))assert.deepEqual(references.get(ref.path),entry,'restart conflicting reference');references.set(ref.path,entry);return raw;
 };
 bind({path:a.contractPath,sha256:a.contractSha256});
 const plan=parse(bind({path:'work/enterprise/plan.json',sha256:a.planSha256}));validatePlan(root,plan,read(root,'work/enterprise/backlog.json'));
 const entry=continuation?plan.componentContinuation:plan.preparationRestart;assert.ok(entry,'restart plan required');
 if(continuation&&bytes(root,a.contractPath).toString().includes('## Occurrence8'))assert.ok(entry.reassessment&&entry.integrationReassessment,'amendment required by reviewed contract');
 for(const k of ['schemaVersion','runSlug','purpose','permission',...(continuation?[]:['runtimeVersion']),'permittedPaths','currentApprovals',...denied])assert.deepEqual(a[k],entry[k],k==='schemaVersion'?'restart schemaVersion plan':'restart plan '+k);
 if(a.schemaVersion===3||continuation)assert.equal(entry.componentReviewAuthority,true,'restart plan componentReviewAuthority');
 assert.equal(entry.contract,a.contractPath);assert.equal(entry.attestation,'enterprise-preparation-restart-attestation');
 if(continuation){for(const k of ['authorityTransferred','productVerified','nativeAccepted'])assert.equal(entry[k],false,'continuation plan '+k);}else assert.equal(entry.ordinaryBatchAuthority,false);assert.equal(entry.completeH,false);
 const permitted=['scripts/enterprise/runtime-preparation.mjs','scripts/enterprise/preparation-producer-linux.c','tests/enterprise/rejected-regeneration.test.mjs','tests/enterprise/evidence-fixture.mjs','tests/enterprise/continuation.test.mjs','tests/enterprise/continuation-v4.test.mjs'];
 const legacyPermitted=[...permitted];
 if(a.schemaVersion>=2)permitted.push('tests/enterprise/finalization.test.mjs');
 if(a.schemaVersion===3||continuation)permitted.push('scripts/enterprise/verify.mjs');
 assert.deepEqual(a.permittedPaths,permitted,a.schemaVersion===1?'restart exact six paths':a.schemaVersion===2?'restart exact seven paths':'restart exact eight paths');
 for(const slug of [a.runSlug,entry.predecessorRunSlug,entry.sourceRunSlug])assert.match(slug,/^[A-Za-z0-9_-]+$/,'restart run identity');
 assert.equal(new Set([a.runSlug,entry.predecessorRunSlug,entry.sourceRunSlug]).size,3,'restart separate Q P S');
 assert.equal(entry.diagnosticNamespace,`evidence/enterprise/component-development/${a.runSlug}/`,'restart diagnostic namespace');
 const manifest=parse(bind(a.reviewInputsManifest));
 assert.ok(Array.isArray(manifest.entries)&&manifest.entries.length,'restart review manifest entries');
 assert.equal(manifest.digest,hash(JSON.stringify({entries:manifest.entries,runtime:manifest.runtime})),'restart manifest digest');
 assert.equal(manifest.digest,a.reviewInputsDigest,'restart reviewed digest');
 canonicalHistoricalInputs(root,manifest.entries);assert.equal(new Set(manifest.entries.map(e=>e.path)).size,manifest.entries.length,'restart duplicate input');
 assert.deepEqual(manifest.runtime,before.runtime,'restart reviewed runtime changed');
 const reviewed=new Map(manifest.entries.map(e=>[e.path,e])),current=new Map(before.entries.map(e=>[e.path,e]));
 for(const e of manifest.entries)assert.ok(current.has(e.path),'restart input removed: '+e.path);
 const changedPaths=[];
 for(const e of before.entries)if(JSON.stringify(e)!==JSON.stringify(reviewed.get(e.path))){assert.ok(permitted.includes(e.path),'restart unreviewed input change: '+e.path);changedPaths.push(e.path);}
 assert.equal(a.entryManifest.path,entry.entrySnapshot,'restart entry locator');
 const saved=parse(bind(a.entryManifest));assert.equal(saved.schemaVersion,1);assert.equal(saved.runSlug,a.runSlug,'restart entry run');
 assert.ok(Array.isArray(saved.entries),'restart entry entries');assert.equal(new Set(saved.entries.map(e=>e.path)).size,saved.entries.length,'restart duplicate entry');
 // The amendment binds frozen copies, not the future bytes of allowed sources.
 // All bound references join checkRaw(), so the same check runs after awaits
 // and every diagnostic-writer authentication. The old report is history only.
 if(a.schemaVersion>=2&&!continuation){
  const integration=parse(bind(entry.integrationCheckpoint));
  const reapproval=a.schemaVersion===3&&entry.integrationDelivery!==undefined;
  assert.deepEqual(Object.keys(integration).sort(),['schemaVersion','kind','runSlug','iteration','sourceCheckpoint','references',...(reapproval?[]:['previousReviewOriginalPath','historicalDesignApprovalOnly','nativeAccepted','captureAuthority','recoveryAuthority','completeH'])].sort(),'restart integration fields');
  for(const [k,v]of Object.entries({schemaVersion:1,kind:'INTEGRATION_SOURCE_CHECKPOINT_NOT_AUTHORITY',runSlug:a.runSlug,...(reapproval?{}:{historicalDesignApprovalOnly:true,nativeAccepted:false,captureAuthority:false,recoveryAuthority:false,completeH:false})}))assert.equal(integration[k],v,'restart integration '+k);
  assert.ok(Number.isSafeInteger(integration.iteration)&&integration.iteration>0&&integration.iteration<review.start.iteration,'restart integration iteration');
  assert.deepEqual(integration.sourceCheckpoint,a.sourceCheckpoint,'restart integration predecessor checkpoint');
  if(!reapproval)assert.equal(integration.previousReviewOriginalPath,canonical,'restart historical report original path');
  assert.equal(integration.references?.length,14,'restart integration references');
  assert.equal(new Set(integration.references.map(r=>r.path)).size,14,'restart duplicate integration reference');
  const sourcePaths=[];
  for(const r of integration.references){
   assert.deepEqual(Object.keys(r).sort(),(r.sourcePath===undefined?['path','sha256','bytes']:['path','sha256','bytes','sourcePath']).sort(),'restart integration reference fields');
   const raw=bind({path:r.path,sha256:r.sha256});assert.ok(Number.isSafeInteger(r.bytes)&&r.bytes>=0,'restart integration reference length');assert.equal(raw.length,r.bytes,'restart integration length');
   if(r.sourcePath!==undefined){
    sourcePaths.push(r.sourcePath);const old=saved.entries.find(e=>e.path===r.sourcePath);assert.ok(old,'restart integration source checkpoint');
    assert.equal(r.path,old.copy,'restart integration frozen source path');assert.equal(r.sha256,old.sha256,'restart integration frozen source hash');assert.equal(r.bytes,old.bytes,'restart integration frozen source length');
   }
  }
  assert.deepEqual(sourcePaths,a.schemaVersion===3?permitted:[...permitted,'scripts/enterprise/verify.mjs'],'restart integration exact source paths');
  if(a.schemaVersion===3){
   authenticateComponentHistoryV3({root,context,index,review,a,entry,saved,integration,canonical,fields,legacyPermitted,bind});
  }else{
  const historical=entry.historicalVersion1;
  assert.deepEqual(Object.keys(historical).sort(),['schemaVersion','permittedPaths','contract','review','currentAmendmentAuthority'].sort(),'restart historical definition fields');
  assert.equal(historical.schemaVersion,1);assert.equal(historical.currentAmendmentAuthority,false);assert.deepEqual(historical.permittedPaths,legacyPermitted,'restart historical six paths');
  const oldReport=bind(historical.review),old=block(oldReport.toString(),'enterprise-preparation-restart-attestation');
  assert.deepEqual(Object.keys(old).sort(),fields.sort(),'restart historical attestation fields');
  assert.equal(old.schemaVersion,1,'restart historical schema');assert.deepEqual(old.permittedPaths,legacyPermitted,'restart historical permitted paths');
  assert.ok(old.iteration<review.start.iteration,'restart historical review order');
  const historicalIndex=context.records.findLastIndex(r=>r.type==='step_start'&&r.step==='review-architecture'&&r.iteration===old.iteration),prior=completed(context,historicalIndex,'enterprise-architecture-reviewer');
  assert.ok(prior.end<=index,'restart historical occurrence order');
  for(const phase of prior.phases)assert.deepEqual(block(phase.content,'enterprise-preparation-restart-attestation'),old,'restart historical phases');
  assert.ok(oldReport.toString()===prior.phases[1].content||oldReport.toString()===prior.phases[1].content+'\n','restart historical canonical copy');
  for(const k of ['verdict','purpose','permission','runSlug','workflowRef','bundleDigest','step','sessionKey','runtimeVersion','runtimeIdentity','contractPath','sourceCheckpoint','currentApprovals',...denied])assert.deepEqual(old[k],a[k],'restart historical '+k);
  assert.equal(old.providerSessionId,prior.session,'restart historical session');
  const oldContract=saved.entries.find(e=>e.path===old.contractPath),oldPlan=saved.entries.find(e=>e.path==='work/enterprise/plan.json');
  assert.ok(oldContract&&oldPlan,'restart historical contract and plan');
  assert.deepEqual(historical.contract,{path:oldContract.copy,sha256:old.contractSha256},'restart historical contract binding');
  assert.equal(bind(historical.contract).length,oldContract.bytes,'restart historical contract length');assert.equal(oldContract.sha256,old.contractSha256);
  assert.equal(oldPlan.sha256,old.planSha256,'restart historical plan binding');
  const planRaw=bind({path:oldPlan.copy,sha256:old.planSha256});assert.equal(planRaw.length,oldPlan.bytes);const previous=parse(planRaw).preparationRestart;
  assert.equal(previous.schemaVersion,1);assert.deepEqual(previous.permittedPaths,legacyPermitted,'restart historical plan six paths');
  const oldInputs=parse(bind(old.reviewInputsManifest));assert.equal(oldInputs.digest,old.reviewInputsDigest,'restart historical input authority');assert.equal(oldInputs.digest,hash(JSON.stringify({entries:oldInputs.entries,runtime:oldInputs.runtime})),'restart historical input digest');
  bind(old.entryManifest);
  for(const path of [historical.review.path,a.entryManifest.path,'work/enterprise/PREPARATION_PRODUCER_CONTAINMENT.md','work/enterprise/PREPARATION_CAPTURE_RECOVERY.md'])assert.ok(integration.references.some(r=>r.path===path),'restart integration missing reference: '+path);
  }
 }
 const externalChecks=[];
 const checkpointEntry=continuation?authenticateComponentContinuationV4({root,context,a,entry,plan,saved,bind,originals,permitted,review,externalChecks}):entry;
 const preserve=path=>{
  const e=saved.entries.find(e=>e.path===path);assert.ok(e,'restart missing entry checkpoint: '+path);
  const raw=bind({path,sha256:e.sha256});assert.equal(raw.length,e.bytes,'restart entry length');
  assert.deepEqual(bind({path:e.copy,sha256:e.sha256}),raw,'restart entry copy');return parse(raw);
 };
 const progress=preserve('work/enterprise/progress.json');preserve('evidence/enterprise/runs/index.json');
 assert.equal(progress.runBinding?.runSlug,entry.sourceRunSlug,'restart source progress run');
 const selection=preserve(progress.entrySelection);assert.equal(progress.entrySelectionHash,references.get(progress.entrySelection).sha256,'restart selection hash');
 assert.equal(selection.batchId,progress.activeBatchId);assert.equal(selection.inputsDigest,progress.entryInputs);
 for(const p of plan.protectedFiles){const e=saved.entries.find(e=>e.path===p.path);assert.ok(e,'restart protected checkpoint');assert.equal(e.sha256,p.sha256);const raw=bind({path:e.path,sha256:e.sha256});assert.equal(raw.length,e.bytes);assert.deepEqual(bind({path:e.copy,sha256:e.sha256}),raw);}
 assert.deepEqual(a.sourceCheckpoint,entry.sourceCheckpoint,'restart source checkpoint locator');
 const checkpoint=parse(bind(a.sourceCheckpoint));
 for(const [k,v] of Object.entries({schemaVersion:1,kind:'PREPARATION_PREDECESSOR_CHECKPOINT',runSlug:checkpointEntry.runSlug,predecessorRunSlug:checkpointEntry.predecessorRunSlug,sourceRunSlug:checkpointEntry.sourceRunSlug,allWritersStopped:false,hostExclusionProven:false,completeH:false,initializationAuthority:false}))assert.equal(checkpoint[k],v,'restart checkpoint '+k);
 assert.deepEqual(checkpoint.currentApprovals,[]);assert.equal(checkpoint.references?.length,9,'restart nine predecessor references');
 const predecessorRoot=confined(resolve(context.identity.runRoot,'..'),checkpointEntry.predecessorRunSlug),prep=`evidence/enterprise/preparation/${checkpointEntry.predecessorRunSlug}`;
 for(const ref of checkpoint.references){
  assert.deepEqual(Object.keys(ref).sort(),['bytes','originalPath','path','sha256'],'restart checkpoint reference fields');
  const raw=bind({path:ref.path,sha256:ref.sha256});assert.equal(raw.length,ref.bytes,'restart checkpoint length');
  const original=isAbsolute(ref.originalPath)?confined(predecessorRoot,relative(predecessorRoot,ref.originalPath)):confined(root,ref.originalPath);
  if(!isAbsolute(ref.originalPath))assert.ok(ref.originalPath.startsWith(prep+'/'),'restart predecessor namespace');
  assert.ok(!originals.has(original),'restart duplicate original');assert.deepEqual(readFileSync(original),raw,'restart original checkpoint changed: '+ref.originalPath);originals.set(original,raw);
 }
 const meta=JSON.parse(originals.get(confined(predecessorRoot,'meta.json')));
 assert.equal(meta.runSlug,checkpointEntry.predecessorRunSlug);assert.equal(meta.status,'failed');assert.equal(meta.reason,'Max steps reached');
 const logs=[...originals].filter(([p])=>relative(predecessorRoot,p).startsWith('logs/')&&p.endsWith('.jsonl'));assert.equal(logs.length,1,'restart predecessor log');
 const terminal=JSON.parse(logs[0][1].toString().trim().split('\n').at(-1));
 assert.equal(terminal.type,'workflow_abort');assert.equal(terminal.reason,meta.reason);assert.equal(terminal.endTime,meta.endTime);assert.equal(terminal.iterations,meta.iterations);
 assert.deepEqual(checkpoint.terminal,{status:meta.status,iterations:meta.iterations,reason:meta.reason,endTime:meta.endTime,log:terminal},'restart terminal checkpoint');
 for(const path of ['journal.json','writer.lock','request.json','acceptances.json','attempts/7/start.json'])assert.ok(originals.has(confined(root,prep+'/'+path)),'restart predecessor reference missing: '+path);
 const last=JSON.parse(originals.get(confined(root,prep+'/journal.json'))).events?.at(-1);
 assert.equal(last?.attempt,7,'restart predecessor attempt');assert.equal(last.status,'RUNNING','restart predecessor running fence');
 assert.equal(JSON.parse(originals.get(confined(root,prep+'/writer.lock'))).runSlug,checkpointEntry.predecessorRunSlug,'restart predecessor lock run');
 // A read-only assessment never creates Q capture state or closes P's fence.
 const absent=[`evidence/enterprise/preparation/${a.runSlug}`,...['attempts/8','recovery.lock','recovery-journal.json',...['execution.json','inputs-after.json','diagnostic.txt','failure.json','receipt.json'].map(n=>'attempts/7/'+n)].map(n=>prep+'/'+n)];
 const checkRaw=()=>{
  for(const check of externalChecks)check();
  for(const r of references.values()){const raw=bytes(root,r.path);assert.equal(hash(raw),r.sha256,'restart concurrent reference: '+r.path);assert.equal(raw.length,r.bytes);}
  for(const [path,raw] of originals)assert.deepEqual(readFileSync(path),raw,'restart concurrent original: '+path);
  assert.deepEqual(readFileSync(canonical),reportRaw,'restart concurrent canonical report');
  assert.deepEqual(inputs(root),before,'restart concurrent inputs');
  for(const p of absent)assert.ok(!existsSync(confined(root,p)),'restart forbidden state exists: '+p);
  assert.ok(!existsSync(confined(root,'evidence/enterprise/gate.lock')),'restart gate writer active or unknown');
 };
 checkRaw();assert.deepEqual(await currentContext(root),context,'restart concurrent authority');checkRaw();
 return {schemaVersion:1,kind:'COMPONENT_DEVELOPMENT_AUTHORITY_DIAGNOSTIC',authorityFingerprint:hash(JSON.stringify(context)),runSlug:a.runSlug,iteration:context.iteration,builderSession:context.providerSessionId,reviewSession:review.session,designReportSha256:hash(reportRaw),reviewInputsDigest:manifest.digest,currentInputs:before,changedPaths,sourceCheckpointBound:true,...(continuation?{continuationCheckpointBound:true}:{}),implementationAuthorityAuthenticated:true,permission:a.permission,diagnosticNamespace:entry.diagnosticNamespace,references:[...references.values()],...Object.fromEntries(denied.map(k=>[k,false])),ordinaryBatchAuthority:false,completeH:false,nativeAcceptance:false,currentApprovals:[]};
}



// U keeps H's legacy meaning. These private acquisition helpers perform only
// reads and fixed OS observations; readonly gate/review consumers must not call
// them. A disk/process witness is never an executable owner or a launch proof.
function uExact(value,keys,label){assert.ok(value&&typeof value==='object'&&!Array.isArray(value),'U '+label);assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),'U '+label);}
function uFile(path){
 const before=lstatSync(path);assert.ok(before.isFile()&&!before.isSymbolicLink(),'U regular file');const raw=readFileSync(path),after=lstatSync(path);
 const identity=s=>({device:s.dev,inode:s.ino,size:s.size,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs});assert.deepEqual(identity(after),identity(before),'U file changed during read');
 return {path,realpath:realpathSync(path),sha256:hash(raw),bytes:raw.length,identity:identity(after)};
}
function uCentralTuple(root,context){
 const path=resolveStatePaths(getGlobalConfigDir(),context.identity.stateId).tasksFile,source=uFile(path),doc=parseYaml(readFileSync(path,'utf8')),tasks=Array.isArray(doc)?doc:doc.tasks;
 assert.ok(Array.isArray(tasks),'U task list');const selected=tasks.filter(t=>t.status==='running'&&t.runId===context.identity.runSlug&&t.activeExecution?.runId===t.runId&&realpathSync(t.worktreePath??root)===root);assert.equal(selected.length,1,'U active execution ambiguous');
 const t=selected[0],a=t.activeExecution;assert.ok(Number.isSafeInteger(t.generation)&&t.generation>0,'U central generation');assert.ok(Number.isSafeInteger(a.pid)&&a.pid>1,'U central pid');
 assert.deepEqual(uFile(path),source,'U central changed during read');
 return {source,tuple:{taskId:t.taskId,status:t.status,generation:t.generation,runId:t.runId,executionId:a.executionId,pid:a.pid,processIdentity:a.processIdentity,startedAt:a.startedAt}};
}
function uObserveWorker(root,context,central){
 const command=(path,args)=>{const r=spawnSync(path,args,{encoding:'utf8',timeout:10000,maxBuffer:65536,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LC_ALL:'C'}});assert.ok(!r.error&&r.status===0&&r.signal===null,'U OS observation failed');return r.stdout.trim();};
 let pid=process.pid,found=false;const seen=new Set();
 for(let n=0;n<32&&pid>1;n++){assert.ok(!seen.has(pid),'U ancestor cycle');seen.add(pid);if(pid===central.pid){found=true;break;}const parent=command('/bin/ps',['-p',String(pid),'-o','ppid=']);assert.match(parent,/^[0-9]+$/,'U missing ancestor');pid=Number(parent);}
 assert.ok(found,'U worker is not current ancestor');
 const started=command('/bin/ps',['-p',String(pid),'-o','lstart=']),comm=command('/bin/ps',['-p',String(pid),'-o','comm=']);
 // The reviewed launcher emits this exact public argv (no token). Reject
 // ambiguous shell quoting/extra arguments rather than guess another origin.
 const argv=command('/bin/ps',['-p',String(pid),'-o','command=']).split(/\s+/);
 assert.equal(argv.length,10,'U worker argv shape');assert.equal(argv[0],comm,'U worker executable');assert.ok(argv[1].endsWith('/node_modules/takt/dist/features/web-ui/worker-entry.js'),'U worker entry');
 const cwdRows=command('/usr/sbin/lsof',['-a','-p',String(pid),'-d','cwd','-Fn']).split('\n').filter(s=>s.startsWith('n'));assert.equal(cwdRows.length,1,'U worker cwd ambiguous');
 const worker={pid,executable:argv[0],script:argv[1],cwd:cwdRows[0].slice(1),started};
 validateUWorkerTuple(root,context.identity.stateId,central,worker,argv);
 assert.equal(command('/bin/ps',['-p',String(pid),'-o','lstart=']),started,'U worker identity changed');return {worker,launchGeneration:Number(argv[7])};
}
function validateUWorkerTuple(root,stateId,central,worker,argv){
 uExact(worker,['pid','executable','script','cwd','started'],'worker fields');uExact(central,['taskId','status','generation','runId','executionId','pid','processIdentity','startedAt'],'central tuple fields');uExact(central.processIdentity,['startTime'],'process identity');
 assert.equal(central.status,'running','U adopted execution');assert.equal(worker.pid,central.pid,'U worker pid');assert.equal(worker.started,central.processIdentity.startTime,'U worker start time');assert.equal(worker.cwd,root,'U worker cwd');
 assert.ok(Number.isSafeInteger(central.generation)&&central.generation>0,'U adopted generation');
 assert.deepEqual(argv,[worker.executable,worker.script,'--state-id',stateId,'--task-id',central.taskId,'--generation',String(central.generation-1),'--execution-id',central.executionId],'U reservation adoption tuple');
 assert.ok(Number.isFinite(Date.parse(central.startedAt)),'U execution start');
}
function uCollectDistribution(root){
 const queue=[root],seen=new Set(),packages=[],edges=[],missing=[],identities=[];
 const ref=path=>{const r=uFile(path);identities.push(r);return {path,bytes:r.bytes,sha256:r.sha256};};
 while(queue.length){
  const logical=queue.shift(),r=realpathSync(logical);if(seen.has(r))continue;seen.add(r);const p=strictPreparationJSON(readFileSync(resolve(r,'package.json'))),files=[];
  const walk=d=>{for(const name of readdirSync(d).sort()){if(name==='node_modules')continue;const path=resolve(d,name),s=lstatSync(path);if(s.isDirectory())walk(path);else if(s.isFile())files.push({...ref(path),relative:relative(r,path),mode:s.mode});else if(s.isSymbolicLink()){const target=realpathSync(path);assert.ok(statSync(target).isFile(),'U unresolved directory dependency');files.push({path,relative:relative(r,path),link:readlinkSync(path),target,targetRef:ref(target)});}else assert.fail('U unknown distribution file type');}};walk(r);
  packages.push({root:r,logicalRoot:logical,name:p.name,version:p.version,files});
  for(const [name,range]of Object.entries({...p.dependencies,...p.optionalDependencies,...p.peerDependencies})){
   assert.match(name,/^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/,'U dependency name');let at=r,found;
   while(true){const candidate=resolve(at,'node_modules',name);if(existsSync(resolve(candidate,'package.json'))){found=candidate;break;}const parent=dirname(at);if(parent===at)break;at=parent;}
   const optional=!!p.optionalDependencies?.[name]||!!p.peerDependenciesMeta?.[name]?.optional;
   if(found){edges.push({from:r,name,range,to:realpathSync(found),logical:found,optional});queue.push(found);}else missing.push({from:r,name,range,optional});
  }
 }
 const inventory={root:realpathSync(root),packages,edges,missing,completeRequiredClosure:missing.every(e=>e.optional),fileCount:packages.reduce((n,p)=>n+p.files.length,0)};
 assert.equal(inventory.completeRequiredClosure,true,'U required dependency missing');return {inventory,identities};
}
function holdUDistribution(root,expected){
 const got=uCollectDistribution(root);assert.deepEqual(got.inventory,expected,'U distribution/resolution changed');
 return {inventory:got.inventory,recheck(){for(const f of got.identities)assert.deepEqual(uFile(f.path),f,'U held source identity/bytes changed');assert.deepEqual(uCollectDistribution(root).inventory,got.inventory,'U dependency closure changed after acquisition');}};
}
function validateURoleManifest(roles,context){
 uExact(roles,['schemaVersion','purpose','runSlug','helper','executorOrigin','isolatedEngine','mapping','evidenceLevel','missingProofs'],'role fields');assert.equal(roles.schemaVersion,1,'U role schema');assert.equal(roles.purpose,'U_RUNTIME_ROLES_V1','U role purpose');assert.equal(roles.runSlug,context.identity.runSlug,'U role run');
 uExact(roles.helper,['identity','distributionInventory','inventoryRole','legacyContextRoleOnly'],'helper fields');assert.deepEqual(roles.helper.identity,context.identity.runtime,'U helper identity');assert.equal(roles.helper.inventoryRole,'helper','U helper role');assert.equal(roles.helper.legacyContextRoleOnly,true);
 uExact(roles.executorOrigin,['observation','identity','distributionInventory','inventoryRole','nodeExecutable','sourceRefs'],'executor fields');assert.equal(roles.executorOrigin.inventoryRole,'executor','U executor role');assert.deepEqual(roles.executorOrigin.distributionInventory,roles.helper.distributionInventory,'U shared inventory');
 uExact(roles.isolatedEngine,['sourceInventory','sourceInventoryRole','entryCommand','copyNotYetCreated','relocationMustPreserveBytesAndResolution','syntheticProviderOnly','actualEngineExecuted'],'engine fields');assert.deepEqual(roles.isolatedEngine.sourceInventory,roles.executorOrigin.distributionInventory,'U T source inventory');assert.equal(roles.isolatedEngine.sourceInventoryRole,'executor','U T source role');
 assert.deepEqual(roles.isolatedEngine.entryCommand,[roles.executorOrigin.nodeExecutable.path,'--test','--test-reporter=tap','tests/enterprise/finalization.test.mjs'],'U T command');
 for(const k of ['copyNotYetCreated','relocationMustPreserveBytesAndResolution','syntheticProviderOnly'])assert.equal(roles.isolatedEngine[k],true,'U T '+k);assert.equal(roles.isolatedEngine.actualEngineExecuted,false,'U T not executed');
 for(const identity of [roles.helper.identity,roles.executorOrigin.identity]){uExact(identity,['version','sources'],'identity fields');assert.equal(identity.sources.length,16,'U sixteen legacy identity sources');assert.deepEqual(identity.sources.map(r=>r.path),context.identity.runtime.sources.map(r=>r.path),'U identity source paths');for(const r of identity.sources){uExact(r,['path','sha256'],'identity source fields');assert.match(r.sha256,/^[a-f0-9]{64}$/);}}
 for(const r of [roles.helper.distributionInventory,roles.executorOrigin.distributionInventory,roles.executorOrigin.observation,roles.isolatedEngine.sourceInventory]){uExact(r,['path','sha256','bytes'],'role reference');assert.match(r.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(r.bytes)&&r.bytes>0);}
 uExact(roles.executorOrigin.nodeExecutable,['path','sha256','bytes'],'Node reference');assert.ok(isAbsolute(roles.executorOrigin.nodeExecutable.path));assert.match(roles.executorOrigin.nodeExecutable.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(roles.executorOrigin.nodeExecutable.bytes)&&roles.executorOrigin.nodeExecutable.bytes>0);
 const sourcePaths=['features/web-ui/worker-entry.js','features/web-ui/central-worker.js','features/web-ui/central-worker-spawn.js','features/tasks/execute/workflowExecutionApi.js','core/workflow/review-scope.js','core/workflow/engine/WorkflowEngineSetup.js','core/workflow/engine/OptionsBuilder.js','infra/task/process.js'];
 assert.equal(roles.executorOrigin.sourceRefs.length,sourcePaths.length,'U origin source count');for(const [i,r]of roles.executorOrigin.sourceRefs.entries()){uExact(r,['path','copy','bytes','sha256'],'origin source fields');assert.ok(isAbsolute(r.path)&&r.path.endsWith('/dist/'+sourcePaths[i]),'U origin source path');assert.match(r.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(r.bytes)&&r.bytes>0);}
 assert.deepEqual(roles.mapping,{helperEqualsExecutorRequired:false,testCopyMatchesExecutorInventoryRequired:true,callerOverrideAllowed:false},'U role mapping');
 assert.equal(roles.evidenceLevel,'CENTRAL_PROCESS_TUPLE_AND_OS_ORIGIN_WITH_CURRENT_DISK_SNAPSHOT','U proof level');assert.deepEqual(roles.missingProofs,['LAUNCH_TIME_DISTRIBUTION_MANIFEST','LOADED_MEMORY_BYTES','ISOLATED_ENGINE_AND_ACTUAL_U_COMPONENT_ACCEPTANCE'],'U missing proofs');
}
function acquireURuntimeRoles(root,context,roles,sized){
 assert.equal(arguments.length,4,'U acquisition arguments');validateURoleManifest(roles,context);const expected=strictPreparationJSON(sized(roles.executorOrigin.distributionInventory)),observation=strictPreparationJSON(sized(roles.executorOrigin.observation));
 const central=uCentralTuple(root,context),origin=uObserveWorker(root,context,central.tuple);assert.deepEqual(origin.worker,observation.worker,'U reviewed origin');assert.deepEqual(central.tuple,observation.taskProjection,'U reviewed central tuple');
 const executorRoot=resolve(dirname(origin.worker.script),'../../..');assert.equal(executorRoot,expected.executor.root,'U executor package root');assert.equal(realpathSync(resolve(root,'node_modules/takt')),expected.helper.root,'U helper package root');
 const snapshots={},held=[],distributions=[];
 for(const name of ['executor','helper']){const pinned=holdUDistribution(name==='executor'?executorRoot:resolve(root,'node_modules/takt'),expected[name]);snapshots[name]=pinned.inventory;distributions.push(pinned);}
 const ext=roles.executorOrigin;for(const r of [ext.nodeExecutable,...expected.locks,...ext.sourceRefs]){const f=uFile(r.path);assert.equal(f.sha256,r.sha256,'U origin source hash');assert.equal(f.bytes,r.bytes,'U origin source length');held.push(f);if(r.copy)assert.deepEqual(sized({path:r.copy,sha256:r.sha256,bytes:r.bytes}),readFileSync(r.path),'U source copy');}
 assert.equal(ext.nodeExecutable.path,origin.worker.executable,'U Node executable');assert.deepEqual(expected.nodeExecutable,ext.nodeExecutable,'U inventory Node');
 for(const [name,identity]of [['executor',ext.identity],['helper',roles.helper.identity]]){assert.equal(identity.version,strictPreparationJSON(readFileSync(resolve(snapshots[name].root,'package.json'))).version,'U role version');assert.deepEqual(identity.sources.map(s=>s.path),context.identity.runtime.sources.map(s=>s.path),'U legacy identity fields');for(const r of identity.sources){const path=resolve(snapshots[name].root,r.path==='package.json'?r.path:'dist/'+r.path);assert.equal(hash(readFileSync(path)),r.sha256,'U role identity source');}}
 // Full inventory equality covers the reviewed adoption implementation, not
 // a generic +/- generation exception or a caller-selected launcher.
 const recheck=()=>{assert.deepEqual(uCentralTuple(root,context),central,'U public central drift');assert.deepEqual(uObserveWorker(root,context,central.tuple),origin,'U origin drift');for(const f of held)assert.deepEqual(uFile(f.path),f,'U held source identity/bytes changed');for(const distribution of distributions)distribution.recheck();};
 recheck();return {recheck,summary:{kind:'U_ROLE_ACQUISITION_CURRENT_DISK_ONLY',worker:origin.worker,launchGeneration:origin.launchGeneration,centralGeneration:central.tuple.generation,executionId:central.tuple.executionId,taskSource:central.source,executorFiles:snapshots.executor.fileCount,helperFiles:snapshots.helper.fileCount,executorPackages:snapshots.executor.packages.length,helperPackages:snapshots.helper.packages.length,loadedBytesAuthenticated:false,launchTimeDistributionAuthenticated:false,isolatedEngineExecuted:false}};
}

function validateUPredecessorLog(meta,records,phase16,history,canonical){
 assert.equal(meta.status,'failed','U predecessor terminal status');assert.equal(meta.iterations,16,'U predecessor terminal iteration');assert.equal(meta.reason,history.terminalReason,'U predecessor terminal reason');
 const terminal=records.at(-1);for(const [k,v]of Object.entries({type:'workflow_abort',reason:meta.reason,endTime:meta.endTime,iterations:meta.iterations}))assert.deepEqual(terminal[k],v,'U predecessor terminal '+k);
 const phases=records.filter(r=>r.type==='phase_complete'&&r.step==='build-foundation'&&r.iteration===16);assert.deepEqual(phase16,phases,'U predecessor phase source');assert.equal(phases.length,1,'U predecessor phase count');assert.equal(phases[0].phase,1,'U predecessor missing Phase2 must remain missing');assert.equal(phases[0].status,'done');assert.ok(!records.some(r=>r.type==='step_complete'&&r.step==='build-foundation'&&r.iteration===16),'U predecessor incomplete step');
 const prior=records.filter(r=>r.type==='phase_complete'&&r.step==='build-foundation'&&r.iteration===15&&r.phase===2);assert.equal(prior.length,1,'U predecessor canonical phase');assert.equal(prior[0].status,'done');assert.ok(canonical===prior[0].content||canonical===prior[0].content+'\n','U predecessor canonical remains iteration15');
 assert.equal(history.step16Phase2Complete,false);assert.equal(history.canonicalImplementationIteration,15);assert.equal(history.buildTurnsConsumed,8);assert.deepEqual(history.M1Misses,[2,4]);assert.equal(history.M2Status,'MISSED');
}
// Validates only the current review envelope. Raw references, runtime roles and
// post-await checks remain mandatory in inspectSuccessorDevelopment below.
function readUSuccessorReview(context){
 const index=context.records.findLastIndex(r=>r.type==='step_start'&&r.step==='review-architecture'),review=completed(context,index,'enterprise-architecture-reviewer');
 assert.equal(context.step,'build-foundation','U builder step');assert.equal(context.sessionKey,'enterprise-builder','U builder key');assert.equal(context.stepDefinition.edit,true,'U editable builder');assert.equal(context.start.provider,'codex');assert.equal(context.start.model,'gpt-6-astra');assert.equal(context.start.providerOptions?.codex?.reasoningEffort,'high');assert.equal(context.start.providerOptions?.codex?.permissionControl,'takt');assert.equal(context.start.providerOptions?.codex?.configProfile,undefined,'U unexpected profile');
 for(const start of [context.start,review.start]){const options=start.providerOptions?.codex;assert.equal(options?.permissionControl,'takt','U actual permission');assert.equal(options?.configProfile,undefined,'U unexpected profile');if(options.fastMode!==undefined)assert.equal(options.fastMode,true,'U actual fastMode');}
 assert.ok(review.end<=context.records.indexOf(context.start),'U review order');assert.notEqual(review.session,context.providerSessionId,'U independent session');
 const a=prepBlock(review.phases[1].content,'enterprise-preparation-restart-attestation');assert.deepEqual(prepBlock(review.phases[0].content,'enterprise-preparation-restart-attestation'),a,'U review phases');
 const denied=['captureAuthority','recoveryAuthority','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority'];
 uExact(a,['schemaVersion','verdict','purpose','permission','runSlug','workflowRef','bundleDigest','step','iteration','sessionKey','providerSessionId','runtimeVersion','runtimeIdentity','runtimeRoles','contractPath','contractSha256','planSha256','reviewInputsDigest','reviewInputsManifest','entryManifest','sourceCheckpoint','continuationCheckpoint','permittedPaths','currentApprovals','componentReviewAuthority',...denied],'attestation fields');
 for(const [k,v]of Object.entries({schemaVersion:5,verdict:'APPROVE',purpose:'PREPARE_CONTAINMENT_COMPONENTS',permission:'IMPLEMENTATION_AND_ISOLATED_REVIEW_ONLY',runSlug:context.identity.runSlug,workflowRef:context.identity.workflowRef,bundleDigest:context.identity.bundleDigest,step:'review-architecture',iteration:review.start.iteration,sessionKey:'enterprise-architecture-reviewer',providerSessionId:review.session,runtimeVersion:context.identity.runtime.version,contractPath:'work/enterprise/COMPONENT_SUCCESSOR.md',componentReviewAuthority:true,...Object.fromEntries(denied.map(k=>[k,false]))}))assert.equal(a[k],v,'U attestation '+k);
 assert.deepEqual(a.currentApprovals,[]);assert.deepEqual(a.runtimeIdentity,context.identity.runtime,'U H identity');assert.equal(review.definition.outputContracts.length,1);const canonical=confined(context.identity.reportDirectory,review.definition.outputContracts[0].name),report=readFileSync(canonical);assert.ok(report.toString()===review.phases[1].content||report.toString()===review.phases[1].content+'\n','U canonical report');
 return {review,a,denied,canonical,report};
}
async function inspectSuccessorDevelopment(root){
 root=realpathSync(root);const context=await currentContext(root),before=inputs(root),{review,a,denied,canonical,report}=readUSuccessorReview(context);
 const references=new Map(),originals=new Map(),bind=r=>{uExact(r,['path','sha256'],'reference');assert.equal(relative(root,confined(root,r.path)),r.path,'U canonical reference');const b=bytes(root,r.path);assert.match(r.sha256,/^[a-f0-9]{64}$/);assert.equal(hash(b),r.sha256,'U reference changed');const ref={...r,bytes:b.length};if(references.has(r.path))assert.deepEqual(references.get(r.path),ref,'U conflicting reference');references.set(r.path,ref);return b;},sized=r=>{uExact(r,['path','sha256','bytes'],'sized reference');const b=bind({path:r.path,sha256:r.sha256});assert.equal(b.length,r.bytes,'U reference length');return b;};
 bind({path:a.contractPath,sha256:a.contractSha256});const plan=strictPreparationJSON(bind({path:'work/enterprise/plan.json',sha256:a.planSha256})),entry=plan.componentSuccessor;validatePlan(root,plan,read(root,'work/enterprise/backlog.json'));
 for(const k of ['schemaVersion','runSlug','purpose','permission','permittedPaths','currentApprovals','componentReviewAuthority',...denied])assert.deepEqual(entry[k],a[k],'U plan '+k);assert.equal(entry.contract,a.contractPath);assert.equal(entry.attestation,'enterprise-preparation-restart-attestation');assert.equal(entry.diagnosticNamespace,`evidence/enterprise/component-development/${a.runSlug}/`);for(const k of ['authorityTransferred','productVerified','nativeAccepted','completeH','configurationEditable','runtimeConfigurationEditable'])assert.equal(entry[k],false,'U plan '+k);
 const permitted=['scripts/enterprise/runtime-preparation.mjs','scripts/enterprise/preparation-producer-linux.c','tests/enterprise/rejected-regeneration.test.mjs','tests/enterprise/evidence-fixture.mjs','tests/enterprise/continuation.test.mjs','tests/enterprise/continuation-v4.test.mjs','tests/enterprise/finalization.test.mjs','scripts/enterprise/verify.mjs'];assert.deepEqual(a.permittedPaths,permitted,'U exact paths');
 const manifest=strictPreparationJSON(bind(a.reviewInputsManifest));assert.equal(manifest.digest,hash(JSON.stringify({entries:manifest.entries,runtime:manifest.runtime})));assert.equal(manifest.digest,a.reviewInputsDigest);assert.deepEqual(manifest.runtime,before.runtime);canonicalHistoricalInputs(root,manifest.entries);assert.equal(new Set(manifest.entries.map(e=>e.path)).size,manifest.entries.length);const changedPaths=[];for(const e of manifest.entries)assert.ok(before.entries.some(n=>n.path===e.path),'U removed input');for(const e of before.entries)if(JSON.stringify(e)!==JSON.stringify(manifest.entries.find(r=>r.path===e.path))){assert.ok(permitted.includes(e.path),'U unreviewed input: '+e.path);changedPaths.push(e.path);}
 assert.equal(a.entryManifest.path,entry.entrySnapshot);const saved=strictPreparationJSON(bind(a.entryManifest));assert.equal(saved.runSlug,a.runSlug);const frozen=p=>{const r=saved.entries.find(e=>e.path===p);assert.ok(r,'U frozen reference');return sized({path:r.copy,sha256:r.sha256,bytes:r.bytes});};const previous=strictPreparationJSON(frozen('work/enterprise/plan.json'));
 assert.deepEqual(plan.componentContinuation,previous.componentContinuation,'U frozen R plan');assert.deepEqual(plan.preparationRestart,previous.preparationRestart,'U frozen Q plan');assert.deepEqual(plan.predecessorRuntime,previous.runtime,'U predecessor runtime');for(const p of permitted)frozen(p);
 assert.deepEqual(a.continuationCheckpoint,entry.predecessorCheckpoint);const cp=strictPreparationJSON(sized(a.continuationCheckpoint));uExact(cp,['schemaVersion','kind','runSlug','predecessorRunSlug','references','currentApprovals','allWritersStopped','hostExclusionProven','completeH'],'predecessor fields');assert.equal(cp.schemaVersion,1);assert.equal(cp.kind,'READONLY_PREDECESSOR_DATA_NOT_AUTHORITY');assert.equal(cp.runSlug,a.runSlug);assert.equal(cp.predecessorRunSlug,entry.predecessorRunSlug);assert.deepEqual(cp.currentApprovals,[]);for(const k of ['allWritersStopped','hostExclusionProven','completeH'])assert.equal(cp[k],false);assert.equal(cp.references.length,17);
 const oldRoot=confined(dirname(context.identity.runRoot),entry.predecessorRunSlug);for(const r of cp.references){uExact(r,['path','copy','sha256','bytes','mtimeMs'],'predecessor reference');const path=isAbsolute(r.path)?confined(oldRoot,relative(oldRoot,r.path)):confined(root,r.path);if(!isAbsolute(r.path))assert.ok(r.path.startsWith(`evidence/enterprise/component-development/${entry.predecessorRunSlug}/`));assert.ok(!originals.has(path),'U duplicate predecessor');const b=sized({path:r.copy,sha256:r.sha256,bytes:r.bytes});assert.deepEqual(readFileSync(path),b,'U predecessor changed');originals.set(path,b);}
 const meta=strictPreparationJSON(originals.get(resolve(oldRoot,'meta.json')));assert.equal(meta.runSlug,entry.predecessorRunSlug);assert.equal(meta.status,'failed');assert.equal(meta.reason,entry.history.terminalReason);assert.equal(meta.iterations,16);const predecessorPhases=strictPreparationJSON(sized(entry.predecessorPhase16)),logs=[...originals].filter(([p])=>/^logs\/[^/]+\.jsonl$/.test(relative(oldRoot,p)));assert.equal(logs.length,1,'U predecessor log count');validateUPredecessorLog(meta,logs[0][1].toString().trim().split('\n').map(line=>strictPreparationJSON(line)),predecessorPhases,entry.history,originals.get(resolve(oldRoot,'reports/enterprise-03-implementation.md')).toString());
 assert.deepEqual(a.sourceCheckpoint,previous.componentContinuation.sourceCheckpoint);const pcp=strictPreparationJSON(bind(a.sourceCheckpoint));assert.equal(pcp.references.length,9);for(const r of pcp.references){const b=sized({path:r.path,sha256:r.sha256,bytes:r.bytes});assert.deepEqual(readFileSync(r.originalPath),b,'U P checkpoint changed');originals.set(resolve(r.originalPath),b);}
 for(const p of ['work/enterprise/progress.json','evidence/enterprise/runs/index.json',...plan.protectedFiles.map(r=>r.path)]){const b=frozen(p);assert.deepEqual(bytes(root,p),b,'U preserved product source');originals.set(resolve(root,p),b);}const progress=read(root,'work/enterprise/progress.json');assert.deepEqual(bytes(root,progress.entrySelection),frozen(progress.entrySelection),'U product selection');originals.set(resolve(root,progress.entrySelection),bytes(root,progress.entrySelection));
 sized(entry.configuration);sized(entry.runtimeConfiguration);const repair=entry.runtimeRepairContract;assert.ok(manifest.entries.some(e=>e.path===repair),'U repair input');bind({path:repair,sha256:manifest.entries.find(e=>e.path===repair).sha256});
 const roles=strictPreparationJSON(sized(a.runtimeRoles)),acquired=acquireURuntimeRoles(root,context,roles,sized);
 const check=()=>{for(const r of references.values())sized(r);for(const [p,b]of originals)assert.deepEqual(readFileSync(p),b,'U original changed');assert.deepEqual(readFileSync(canonical),report,'U canonical changed');assert.deepEqual(inputs(root),before,'U inputs changed');acquired.recheck();};
 check();assert.deepEqual(await currentContext(root),context,'U context changed');check();
 return {schemaVersion:1,kind:'U_COMPONENT_DEVELOPMENT_AUTHORITY_DIAGNOSTIC',runSlug:a.runSlug,iteration:context.iteration,builderSession:context.providerSessionId,reviewSession:review.session,designReportSha256:hash(report),reviewInputsDigest:manifest.digest,currentInputs:before,changedPaths,references:[...references.values()],runtimeRoles:a.runtimeRoles,origin:acquired.summary,implementationAuthorityAuthenticated:true,permission:a.permission,diagnosticNamespace:entry.diagnosticNamespace,componentReviewAuthority:true,...Object.fromEntries(denied.map(k=>[k,false])),ordinaryBatchAuthority:false,completeH:false,nativeAcceptance:false,currentApprovals:[]};
}

// R authenticates a new completed review. Frozen Q bytes establish history,
// never a substitute current context, approval, or executable capability.
function authenticateComponentContinuationV4({root,context,a,entry,plan,saved,bind,originals,permitted,review,externalChecks}){
 const exact=(value,keys,label)=>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value),'continuation '+label);assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),'continuation '+label);};
 const sized=ref=>{exact(ref,['path','sha256','bytes'],'reference fields');assert.ok(Number.isSafeInteger(ref.bytes)&&ref.bytes>=0,'continuation reference size');const raw=bind({path:ref.path,sha256:ref.sha256});assert.equal(raw.length,ref.bytes,'continuation checkpoint length');return raw;};
 assert.equal(a.continuationCheckpoint?.path,entry.predecessorCheckpoint,'continuation checkpoint locator');
 const checkpoint=strictPreparationJSON(sized(a.continuationCheckpoint));
 exact(checkpoint,['schemaVersion','kind','runSlug','predecessorRunSlug','references','currentApprovals','allWritersStopped','hostExclusionProven','completeH'],'checkpoint fields');
 for(const [k,v]of Object.entries({schemaVersion:1,kind:'READONLY_PREDECESSOR_DATA_NOT_AUTHORITY',runSlug:a.runSlug,predecessorRunSlug:entry.predecessorRunSlug,allWritersStopped:false,hostExclusionProven:false,completeH:false}))assert.equal(checkpoint[k],v,'continuation checkpoint '+k);
 assert.deepEqual(checkpoint.currentApprovals,[],'continuation historical approvals');
 assert.equal(checkpoint.references?.length,5,'continuation five references');
 const predecessorRoot=confined(resolve(context.identity.runRoot,'..'),entry.predecessorRunSlug),local=new Map(),copies=new Set();
 for(const ref of checkpoint.references){
  exact(ref,['path','copy','sha256','bytes',...(ref.mtimeMs===undefined?[]:['mtimeMs'])],'checkpoint reference fields');
  assert.ok(isAbsolute(ref.path),'continuation original absolute path');
  const path=confined(predecessorRoot,relative(predecessorRoot,ref.path));assert.equal(path,ref.path,'continuation canonical original');
  assert.ok(!local.has(path)&&!copies.has(ref.copy),'continuation duplicate reference');copies.add(ref.copy);
  const raw=sized({path:ref.copy,sha256:ref.sha256,bytes:ref.bytes});assert.deepEqual(readFileSync(path),raw,'continuation original changed: '+path);local.set(path,raw);originals.set(path,raw);
 }
 const metaPath=confined(predecessorRoot,'meta.json');assert.ok(local.has(metaPath),'continuation predecessor meta');const meta=strictPreparationJSON(local.get(metaPath));
 assert.equal(meta.runSlug,entry.predecessorRunSlug,'continuation terminal run');assert.equal(meta.status,'failed','continuation terminal status');assert.equal(meta.reason,'Workflow aborted by step transition','continuation terminal reason');
 assert.ok(Number.isSafeInteger(meta.iterations)&&meta.iterations>0,'continuation terminal iteration');
 const logs=[...local].filter(([p])=>/^logs\/[^/]+\.jsonl$/.test(relative(predecessorRoot,p))),reports=[...local.keys()].filter(p=>/^reports\/[^/]+\.md$/.test(relative(predecessorRoot,p)));
 assert.equal(logs.length,1,'continuation predecessor log');assert.equal(reports.length,3,'continuation predecessor reports');
 const terminal=strictPreparationJSON(logs[0][1].toString().trim().split('\n').at(-1));
 for(const [k,v]of Object.entries({type:'workflow_abort',reason:meta.reason,endTime:meta.endTime,iterations:meta.iterations}))assert.deepEqual(terminal[k],v,'continuation terminal '+k);
 const frozen=path=>{const ref=saved.entries.find(e=>e.path===path);assert.ok(ref,'continuation frozen source missing: '+path);return sized({path:ref.copy,sha256:ref.sha256,bytes:ref.bytes});};
 const previous=strictPreparationJSON(frozen('work/enterprise/plan.json'));
 for(const k of ['preparationRestart','preparationEntry','preparationReview'])assert.deepEqual(plan[k],previous[k],'continuation frozen '+k);
 assert.deepEqual(plan.historicalRuntime,previous.runtime,'continuation frozen runtime');
 assert.equal(previous.preparationRestart?.runSlug,entry.predecessorRunSlug,'continuation frozen predecessor run');
 assert.equal(previous.preparationRestart?.schemaVersion,3,'continuation frozen predecessor schema');
 assert.deepEqual(entry.sourceCheckpoint,previous.preparationRestart.sourceCheckpoint,'continuation inherited checkpoint');
 assert.equal(entry.sourceRunSlug,previous.preparationRestart.sourceRunSlug,'continuation source run');
 for(const path of permitted)frozen(path);
 if(entry.reassessment!==undefined||entry.integrationReassessment!==undefined){
  authenticateContinuationAmendments({root,context,a,entry,bind,review,externalChecks});
 }
 return previous.preparationRestart;
}

// Prospective R amendments are authenticated through the completed review's
// raw plan, never through a caller checkpoint or a refreshed global profile.
// Old unamended schema4 records retain their own historical contract.
function authenticateContinuationAmendments({root,context,a,entry,bind,review,externalChecks}){
 const exact=(v,keys,label)=>{assert.ok(v&&typeof v==='object'&&!Array.isArray(v),'amendment '+label);assert.deepEqual(Object.keys(v).sort(),[...keys].sort(),'amendment '+label);};
 const sized=r=>{exact(r,['path','sha256','bytes'],'reference');assert.ok(Number.isSafeInteger(r.bytes)&&r.bytes>=0,'amendment size');const b=bind({path:r.path,sha256:r.sha256});assert.equal(b.length,r.bytes,'amendment length');return b;};
 const readPinned=path=>{const raw=bytes(root,path);bind({path,sha256:hash(raw)});return strictPreparationJSON(raw);};
 const canonical=confined(context.identity.runRoot,relative(context.identity.runRoot,context.identity.reportDirectory)+'/'+review.definition.outputContracts[0].name);
 const projection={service_tier:'fast',features:{fast_mode:true}};
 let previousIteration=0,reassessment;
 for(const [name,kind]of [['reassessment','REASSESSMENT_DATA_NOT_AUTHORITY'],['integrationReassessment','INTEGRATION_REASSESSMENT_DATA_NOT_AUTHORITY']]){
  const spec=entry[name];assert.ok(spec,'amendment missing '+name);
  const cp=strictPreparationJSON(sized(spec.checkpoint));
  const keys=name==='reassessment'?['schemaVersion','kind','runSlug','iteration','entrySnapshot','references','reviewedConfig','proposedConfig','changeActor','changeReason','profileProjection','actualAuthorityAccepted','implementationAccepted','focusedTests','fullRegressionExecuted','implementationTurnsConsumed','milestonesReset']:['schemaVersion','kind','runSlug','iteration','entrySnapshot','references','previousReassessment','implementationTurnsConsumed','missedMilestone','conditions','existingGuardComplete','semanticRouteImplemented','writerImplemented','implementationAccepted','productVerified','profileSource'];
  exact(cp,keys,'checkpoint fields');
  assert.equal(cp.schemaVersion,1,'amendment schema');assert.equal(cp.kind,kind,'amendment kind');assert.equal(cp.runSlug,a.runSlug,'amendment run');assert.equal(cp.iteration,spec.iteration,'amendment iteration');
  assert.ok(Number.isSafeInteger(cp.iteration)&&cp.iteration>previousIteration&&cp.iteration<review.start.iteration,'amendment occurrence order');previousIteration=cp.iteration;
  assert.equal(cp.entrySnapshot,spec.entrySnapshot,'amendment entry locator');
  const snapshot=readPinned(cp.entrySnapshot);exact(snapshot,['schemaVersion','runSlug','entries'],'entry fields');assert.equal(snapshot.schemaVersion,1);assert.equal(snapshot.runSlug,a.runSlug,'amendment entry run');
  assert.ok(Array.isArray(snapshot.entries)&&Array.isArray(cp.references),'amendment references');
  assert.equal(new Set(snapshot.entries.map(r=>r.path)).size,snapshot.entries.length,'amendment duplicate entry');
  assert.equal(new Set(cp.references.map(r=>r.path)).size,cp.references.length,'amendment duplicate reference');
  assert.equal(new Set(cp.references.map(r=>r.copy)).size,cp.references.length,'amendment duplicate copy');
  const frozen=path=>{const r=snapshot.entries.find(r=>r.path===path);assert.ok(r,'amendment missing frozen '+path);return sized({path:r.copy,sha256:r.sha256,bytes:r.bytes});};
  for(const r of cp.references){exact(r,['path','copy','sha256','bytes',...(r.mtimeMs===undefined?[]:['mtimeMs'])],'frozen reference');assert.deepEqual(snapshot.entries.find(e=>e.path===r.path),r,'amendment conflicting frozen reference');frozen(r.path);}
  for(const p of ['.takt/config.yaml','scripts/enterprise/runtime-preparation.mjs','tests/enterprise/rejected-regeneration.test.mjs',canonical])assert.ok(cp.references.some(r=>r.path===p),'amendment missing reference '+p);
  const oldRaw=frozen(canonical),old=prepBlock(oldRaw.toString(),'enterprise-preparation-restart-attestation');
  assert.equal(old.schemaVersion,4,'amendment historical schema');assert.equal(old.runSlug,a.runSlug,'amendment historical run');assert.ok(old.iteration<cp.iteration,'amendment historical order');
  for(const k of ['verdict','purpose','permission','workflowRef','bundleDigest','runtimeIdentity','sourceCheckpoint','continuationCheckpoint','permittedPaths','componentReviewAuthority','currentApprovals','captureAuthority','recoveryAuthority','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority'])assert.deepEqual(old[k],a[k],'amendment historical '+k);
  const oldIndex=context.records.findLastIndex(r=>r.type==='step_start'&&r.step==='review-architecture'&&r.iteration===old.iteration),prior=completed(context,oldIndex,'enterprise-architecture-reviewer');
  assert.ok(prior.end<=review.index,'amendment historical occurrence order');assert.equal(old.providerSessionId,prior.session,'amendment historical session');
  for(const phase of prior.phases)assert.deepEqual(prepBlock(phase.content,'enterprise-preparation-restart-attestation'),old,'amendment historical phases');
  assert.ok(oldRaw.toString()===prior.phases[1].content||oldRaw.toString()===prior.phases[1].content+'\n','amendment historical canonical');
  assert.equal(hash(frozen('work/enterprise/plan.json')),old.planSha256,'amendment historical plan');assert.equal(hash(frozen(old.contractPath)),old.contractSha256,'amendment historical contract');
  const oldManifest=strictPreparationJSON(bind(old.reviewInputsManifest));assert.equal(oldManifest.digest,old.reviewInputsDigest,'amendment historical input binding');assert.equal(oldManifest.digest,hash(JSON.stringify({entries:oldManifest.entries,runtime:oldManifest.runtime})),'amendment historical input digest');
  assert.equal(cp.implementationAccepted,false,'amendment no implementation approval');
  if(name==='reassessment'){
   for(const k of ['actualAuthorityAccepted','fullRegressionExecuted','milestonesReset'])assert.equal(cp[k],false,'amendment '+k);
   assert.equal(spec.configEditable,false,'amendment config not editable');assert.deepEqual(cp.proposedConfig,spec.currentConfig,'amendment current config');assert.equal(cp.proposedConfig.path,'.takt/config.yaml','amendment config path');sized(cp.proposedConfig);
   assert.deepEqual(cp.profileProjection,{profile:'takt-fast',value:projection},'amendment profile projection');
   const oldConfig=oldManifest.entries.find(r=>r.path==='.takt/config.yaml');assert.ok(oldConfig,'amendment historical config');assert.deepEqual(cp.reviewedConfig,{sha256:oldConfig.sha256,bytes:oldConfig.bytes},'amendment reviewed config');
   reassessment=cp;
  }else{
   for(const p of ['work/enterprise/plan.json',a.contractPath,'scripts/enterprise/preparation-producer-linux.c'])assert.ok(cp.references.some(r=>r.path===p),'amendment missing integration reference '+p);
   assert.deepEqual(cp.previousReassessment,entry.reassessment,'amendment retained reassessment');
   const oldPlan=strictPreparationJSON(frozen('work/enterprise/plan.json'));assert.deepEqual(oldPlan.componentContinuation.reassessment,entry.reassessment,'amendment frozen reassessment');
   assert.equal(cp.implementationTurnsConsumed,spec.implementationTurnsConsumed,'amendment consumed turns');assert.deepEqual(cp.missedMilestone,{name:'M1',dueCumulativeTurn:spec.previousM1DueTurn,status:spec.previousM1Status},'amendment missed milestone');
   for(const k of ['existingGuardComplete','semanticRouteImplemented','writerImplemented','productVerified'])assert.equal(cp[k],false,'amendment historical '+k);
   assert.deepEqual(cp.conditions,Object.entries(entry.caseConditions).flatMap(([id,cs])=>cs.map(condition=>({id,condition,status:'NOT_ACCEPTED'}))),'amendment conditions');
   const ps=cp.profileSource;exact(ps,['kind','path','sha256','bytes','identity','profile','projection','activationProven'],'profile source');exact(ps.identity,['device','inode'],'profile identity');
   assert.equal(ps.kind,'NON_SECRET_PROFILE_SOURCE_BINDING_NOT_ACTIVATION');assert.equal(ps.profile,'takt-fast');assert.equal(ps.activationProven,false);assert.deepEqual(ps.projection,projection,'amendment profile overrides');assert.deepEqual(ps.projection,reassessment.profileProjection.value);
   assert.ok(isAbsolute(ps.path)&&realpathSync(ps.path)===ps.path,'amendment profile canonical path');assert.match(ps.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(ps.bytes)&&ps.bytes>0);
   const check=()=>{const before=lstatSync(ps.path);assert.ok(before.isFile(),'amendment profile regular file');assert.deepEqual({device:before.dev,inode:before.ino},ps.identity,'amendment profile identity');const raw=readFileSync(ps.path),after=lstatSync(ps.path);assert.deepEqual({device:after.dev,inode:after.ino},ps.identity,'amendment profile replaced');assert.equal(raw.length,ps.bytes,'amendment profile length');assert.equal(hash(raw),ps.sha256,'amendment profile bytes');};
   check();externalChecks.push(check); // No raw global configuration enters evidence.
  }
 }
 for(const start of [context.start,review.start]){
  const options=start.providerOptions?.codex;
  assert.equal(options?.permissionControl,'takt','amendment permission control');
  if(options.fastMode!==undefined)assert.equal(options.fastMode,true,'amendment actual fastMode');
  if(options.configProfile!==undefined)assert.equal(options.configProfile,'takt-fast','amendment actual configProfile');
 }
}

// Reapprovals authenticate the previous schema3 occurrence against its own
// saved definition. Snapshot resolution is private and limited to contracts;
// it never substitutes the current context, approval or source checkpoint.
function authenticateComponentReapprovalV3(args,planRaw){
 const {root,context,index,review,a,entry,saved,integration,canonical,fields,legacyPermitted,bind}=args;
 const exact=(v,keys,label)=>{assert.ok(v&&typeof v==='object'&&!Array.isArray(v),'restart reapproval '+label);assert.deepEqual(Object.keys(v).sort(),[...keys].sort(),'restart reapproval '+label);};
 const bindSized=ref=>{exact(ref,['path','sha256','bytes'],'sized reference fields');assert.ok(Number.isSafeInteger(ref.bytes)&&ref.bytes>=0,'restart reapproval reference size');const raw=bind({path:ref.path,sha256:ref.sha256});assert.equal(raw.length,ref.bytes,'restart reapproval reference length');return raw;};
 const savedRaw=path=>{const matches=saved.entries.filter(e=>e.path===path);assert.equal(matches.length,1,'restart reapproval saved definition');const e=matches[0];return bindSized({path:e.copy,sha256:e.sha256,bytes:e.bytes});};
 const reference=entry.integrationDelivery?.historicalReview,raw=bindSized(reference),old=prepBlock(raw.toString(),'enterprise-preparation-restart-attestation');
 exact(old,[...fields,'componentReviewAuthority'],'attestation fields');assert.equal(old.schemaVersion,3,'restart reapproval schema');
 for(const k of ['verdict','purpose','permission','runSlug','workflowRef','bundleDigest','step','sessionKey','runtimeVersion','runtimeIdentity','contractPath','sourceCheckpoint','permittedPaths','currentApprovals','componentReviewAuthority','captureAuthority','recoveryAuthority','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority'])assert.deepEqual(old[k],a[k],'restart reapproval '+k);
 assert.ok(Number.isSafeInteger(old.iteration)&&old.iteration<review.start.iteration,'restart reapproval iteration');
 const occurrences=context.records.map((r,i)=>({r,i})).filter(({r})=>r.type==='step_start'&&r.step==='review-architecture'&&r.iteration===old.iteration);assert.equal(occurrences.length,1,'restart reapproval unique occurrence');
 const prior=completed(context,occurrences[0].i,'enterprise-architecture-reviewer');assert.ok(prior.end<=index,'restart reapproval occurrence order');assert.equal(old.providerSessionId,prior.session,'restart reapproval reviewer session');
 for(const phase of prior.phases)assert.deepEqual(prepBlock(phase.content,'enterprise-preparation-restart-attestation'),old,'restart reapproval phases');
 assert.ok(raw.toString()===prior.phases[1].content||raw.toString()===prior.phases[1].content+'\n','restart reapproval canonical copy');
 assert.equal(hash(planRaw),old.planSha256,'restart reapproval approved plan');assert.equal(hash(savedRaw(old.contractPath)),old.contractSha256,'restart reapproval approved contract');
 const p=strictPreparationJSON(planRaw).preparationRestart;
 for(const k of ['schemaVersion','permission','runSlug','permittedPaths','currentApprovals','componentReviewAuthority','captureAuthority','recoveryAuthority','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority'])assert.deepEqual(p[k],old[k],'restart reapproval old plan '+k);
 assert.equal(p.entrySnapshot,old.entryManifest.path,'restart reapproval old entry');assert.deepEqual(p.sourceCheckpoint,old.sourceCheckpoint);assert.equal(p.contract,old.contractPath);assert.equal(p.ordinaryBatchAuthority,false);assert.equal(p.completeH,false);
 for(const key of ['historicalVersion1','historicalVersion2'])assert.deepEqual(entry[key],p[key],'restart reapproval retained '+key);
 assert.deepEqual(entry.previousIntegrationCheckpoint,p.integrationCheckpoint,'restart reapproval previous checkpoint');
 const m=strictPreparationJSON(bind(old.reviewInputsManifest));assert.equal(m.digest,hash(JSON.stringify({entries:m.entries,runtime:m.runtime})),'restart reapproval manifest digest');assert.equal(m.digest,old.reviewInputsDigest);assert.deepEqual(m.runtime,old.runtimeIdentity);canonicalHistoricalInputs(root,m.entries);assert.equal(new Set(m.entries.map(e=>e.path)).size,m.entries.length,'restart reapproval duplicate input');
 // These raw definitions were present in the historical invocation inputs.
 for(const path of ['work/enterprise/plan.json',old.contractPath,'work/enterprise/PREPARATION_DESCRIPTOR.md','work/enterprise/PREPARATION_COMPONENT_REVIEW.md']){const b=savedRaw(path),e=m.entries.find(e=>e.path===path);assert.ok(e,'restart reapproval reviewed definition');assert.equal(e.sha256,hash(b),'restart reapproval definition hash');assert.equal(e.bytes,b.length,'restart reapproval definition bytes');}
 const previousSaved=strictPreparationJSON(bind(old.entryManifest));assert.equal(previousSaved.schemaVersion,1);assert.equal(previousSaved.runSlug,a.runSlug);assert.ok(Array.isArray(previousSaved.entries));assert.equal(new Set(previousSaved.entries.map(e=>e.path)).size,previousSaved.entries.length,'restart reapproval duplicate entry');
 const previous=strictPreparationJSON(bind(p.integrationCheckpoint));
 exact(previous,['schemaVersion','kind','runSlug','iteration','sourceCheckpoint','references',...(p.integrationDelivery?[]:['previousReviewOriginalPath','historicalDesignApprovalOnly','nativeAccepted','captureAuthority','recoveryAuthority','completeH'])],'checkpoint fields');
 for(const [k,v]of Object.entries({schemaVersion:1,kind:'INTEGRATION_SOURCE_CHECKPOINT_NOT_AUTHORITY',runSlug:a.runSlug,...(p.integrationDelivery?{}:{previousReviewOriginalPath:canonical,historicalDesignApprovalOnly:true,nativeAccepted:false,captureAuthority:false,recoveryAuthority:false,completeH:false})}))assert.equal(previous[k],v,'restart reapproval checkpoint '+k);
 assert.deepEqual(previous.sourceCheckpoint,a.sourceCheckpoint);assert.ok(Number.isSafeInteger(previous.iteration)&&previous.iteration>0&&previous.iteration<old.iteration&&old.iteration<=integration.iteration,'restart reapproval checkpoint order');
 assert.equal(previous.references?.length,14);assert.equal(new Set(previous.references.map(r=>r.path)).size,14,'restart reapproval duplicate checkpoint reference');
 const sourcePaths=[];for(const r of previous.references){exact(r,r.sourcePath===undefined?['path','sha256','bytes']:['path','sha256','bytes','sourcePath'],'checkpoint reference fields');const b=bindSized({path:r.path,sha256:r.sha256,bytes:r.bytes});if(r.sourcePath!==undefined){sourcePaths.push(r.sourcePath);const e=previousSaved.entries.find(e=>e.path===r.sourcePath);assert.ok(e,'restart reapproval checkpoint source');assert.equal(r.path,e.copy);assert.equal(r.sha256,e.sha256);assert.equal(b.length,e.bytes);}}
 assert.deepEqual(sourcePaths,old.permittedPaths,'restart reapproval checkpoint paths');
 for(const path of [reference.path,a.entryManifest.path,'work/enterprise/PREPARATION_PRODUCER_CONTAINMENT.md','work/enterprise/PREPARATION_CAPTURE_RECOVERY.md'])assert.ok(integration.references.some(r=>r.path===path),'restart reapproval missing checkpoint reference: '+path);
 const contractPaths=['work/enterprise/PREPARATION_DESCRIPTOR.md','work/enterprise/PREPARATION_COMPONENT_REVIEW.md'];
 const historicalBind=ref=>{if(!contractPaths.includes(ref.path))return bind(ref);exact(ref,['path','sha256'],'historical contract reference');const b=savedRaw(ref.path);assert.equal(hash(b),ref.sha256,'restart reapproval historical contract hash');return b;};
 authenticateComponentHistoryV3({...args,index:prior.index,review:prior,a:old,entry:p,saved:previousSaved,integration:previous,bind:historicalBind});
 assert.equal(entry.descriptorIntegration?.contract?.path,contractPaths[0],'restart schema3 descriptor contract path');bind(entry.descriptorIntegration.contract);
 assert.equal(entry.componentReview?.contract?.path,contractPaths[1],'restart schema3 component contract path');bindSized(entry.componentReview.contract);
}

// Authenticate historical bytes through completed occurrences and their own
// manifests. The intervening proposal is retained but cannot grant authority.
// Every read joins the current guard's raw-reference rechecks after awaits.
function authenticateComponentHistoryV3({root,context,index,review,a,entry,saved,integration,canonical,fields,legacyPermitted,bind}){
 const exact=(v,keys,label)=>assert.deepEqual(Object.keys(v).sort(),keys.sort(),'restart historical '+label);
 const refEntry=(manifest,path)=>{const e=manifest.entries.find(e=>e.path===path);assert.ok(e,'restart historical missing saved '+path);const raw=bind({path:e.copy,sha256:e.sha256});assert.equal(raw.length,e.bytes,'restart historical saved length');return raw;};
 const manifest=ref=>{const m=strictPreparationJSON(bind(ref));assert.equal(m.schemaVersion,1);assert.equal(m.runSlug,a.runSlug);assert.ok(Array.isArray(m.entries));assert.equal(new Set(m.entries.map(e=>e.path)).size,m.entries.length,'restart historical duplicate entry');return m;};
 const savedPlan=refEntry(saved,'work/enterprise/plan.json');
 if(strictPreparationJSON(savedPlan).preparationRestart?.schemaVersion===3)return authenticateComponentReapprovalV3({root,context,index,review,a,entry,saved,integration,canonical,fields,legacyPermitted,bind},savedPlan);
 const h=entry.historicalVersion2;
 exact(h,['schemaVersion','permittedPaths','proposalPlan','contract','completedReview','proposalApproved','currentAmendmentAuthority'],'schema2 definition fields');
 assert.equal(h.schemaVersion,2);assert.equal(h.proposalApproved,false,'restart historical proposalApproved');assert.equal(h.currentAmendmentAuthority,false,'restart historical currentAmendmentAuthority');assert.deepEqual(h.permittedPaths,[...legacyPermitted,'tests/enterprise/finalization.test.mjs']);
 const proposalRaw=bind(h.proposalPlan),proposal=strictPreparationJSON(proposalRaw).preparationRestart;
 assert.deepEqual(proposalRaw,refEntry(saved,'work/enterprise/plan.json'),'restart historical proposal plan');
 assert.deepEqual(bind(h.contract),refEntry(saved,a.contractPath),'restart historical proposal contract');
 assert.equal(proposal.schemaVersion,2);assert.deepEqual(proposal.permittedPaths,h.permittedPaths);assert.equal(proposal.permission,'IMPLEMENTATION_AND_ISOLATED_TESTS_ONLY');
 assert.deepEqual(proposal.integrationCheckpoint,entry.previousIntegrationCheckpoint,'restart historical previous integration');
 const previous=strictPreparationJSON(bind(entry.previousIntegrationCheckpoint));
 assert.equal(previous.kind,'INTEGRATION_SOURCE_CHECKPOINT_NOT_AUTHORITY');assert.equal(previous.runSlug,a.runSlug);assert.equal(previous.previousReviewOriginalPath,canonical);assert.deepEqual(previous.sourceCheckpoint,a.sourceCheckpoint);
 assert.ok(previous.iteration<integration.iteration,'restart historical checkpoint order');
 assert.equal(previous.references?.length,14);assert.equal(new Set(previous.references.map(r=>r.path)).size,14,'restart historical duplicate checkpoint reference');
 for(const r of previous.references){exact(r,r.sourcePath===undefined?['path','sha256','bytes']:['path','sha256','bytes','sourcePath'],'checkpoint reference');assert.equal(bind({path:r.path,sha256:r.sha256}).length,r.bytes,'restart historical checkpoint length');}
 const priorEntry=previous.references.find(r=>r.path===proposal.entrySnapshot);assert.ok(priorEntry,'restart historical proposal entry');
 const approvedSnapshot=manifest({path:priorEntry.path,sha256:priorEntry.sha256});
 const historicalReview=(reference,version,expectedPaths,snapshot,beforeIndex)=>{
  const raw=bind(reference),old=block(raw.toString(),'enterprise-preparation-restart-attestation');exact(old,fields,'attestation fields');
  assert.equal(old.schemaVersion,version,'restart historical schemaVersion');assert.equal(old.permission,'IMPLEMENTATION_AND_ISOLATED_TESTS_ONLY','restart historical permission');assert.deepEqual(old.permittedPaths,expectedPaths,'restart historical paths');
  for(const key of ['verdict','purpose','runSlug','workflowRef','bundleDigest','step','sessionKey','runtimeVersion','runtimeIdentity','contractPath','sourceCheckpoint','currentApprovals','captureAuthority','recoveryAuthority','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority'])assert.deepEqual(old[key],a[key],'restart historical '+key);
  const i=context.records.findLastIndex(r=>r.type==='step_start'&&r.step==='review-architecture'&&r.iteration===old.iteration),prior=completed(context,i,'enterprise-architecture-reviewer');
  assert.ok(prior.end<=beforeIndex,'restart historical review order');assert.equal(old.providerSessionId,prior.session,'restart historical session');
  for(const phase of prior.phases)assert.deepEqual(block(phase.content,'enterprise-preparation-restart-attestation'),old,'restart historical phases');
  assert.ok(raw.toString()===prior.phases[1].content||raw.toString()===prior.phases[1].content+'\n','restart historical canonical copy');
  const planRaw=refEntry(snapshot,'work/enterprise/plan.json'),contractRaw=refEntry(snapshot,old.contractPath);
  assert.equal(hash(planRaw),old.planSha256,'restart historical approved plan');assert.equal(hash(contractRaw),old.contractSha256,'restart historical approved contract');
  const p=strictPreparationJSON(planRaw).preparationRestart;
  for(const key of ['schemaVersion','permission','runSlug','permittedPaths','currentApprovals','captureAuthority','recoveryAuthority','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority'])assert.deepEqual(p[key],old[key],'restart historical approved plan '+key);
  assert.equal(p.entrySnapshot,old.entryManifest.path);assert.deepEqual(p.sourceCheckpoint,old.sourceCheckpoint);
  const m=strictPreparationJSON(bind(old.reviewInputsManifest));assert.equal(m.digest,hash(JSON.stringify({entries:m.entries,runtime:m.runtime})),'restart historical manifest digest');assert.equal(m.digest,old.reviewInputsDigest);assert.deepEqual(m.runtime,old.runtimeIdentity);canonicalHistoricalInputs(root,m.entries);assert.equal(new Set(m.entries.map(e=>e.path)).size,m.entries.length);
  for(const [path,bytes]of [['work/enterprise/plan.json',planRaw],[old.contractPath,contractRaw]]){const e=m.entries.find(e=>e.path===path);assert.ok(e);assert.equal(e.sha256,hash(bytes));assert.equal(e.bytes,bytes.length);}
  return {old,plan:p,entry:manifest(old.entryManifest),index:i};
 };
 const v2=historicalReview(h.completedReview,2,h.permittedPaths,approvedSnapshot,index);
 assert.notEqual(hash(proposalRaw),v2.old.planSha256,'restart historical proposal is not approved plan');
 const v1=entry.historicalVersion1;exact(v1,['schemaVersion','permittedPaths','contract','review','currentAmendmentAuthority'],'schema1 definition fields');assert.equal(v1.schemaVersion,1);assert.equal(v1.currentAmendmentAuthority,false);assert.deepEqual(v1.permittedPaths,legacyPermitted);assert.deepEqual(v2.plan.historicalVersion1,v1,'restart historical retained schema1 definition');
 const old1=historicalReview(v1.review,1,legacyPermitted,v2.entry,v2.index);assert.equal(hash(bind(v1.contract)),old1.old.contractSha256);
 // Preserve the original schema2 checkpoint as well as the current proposal.
 const original=strictPreparationJSON(bind(v2.plan.integrationCheckpoint));assert.equal(original.references?.length,14);assert.deepEqual(original.sourceCheckpoint,a.sourceCheckpoint);assert.equal(original.runSlug,a.runSlug);assert.equal(original.previousReviewOriginalPath,canonical);
 for(const r of original.references){assert.equal(bind({path:r.path,sha256:r.sha256}).length,r.bytes,'restart historical original checkpoint length');if(r.sourcePath!==undefined)assert.deepEqual(bind({path:r.path,sha256:r.sha256}),refEntry(v2.entry,r.sourcePath),'restart historical original source copy');}
 for(const path of [h.completedReview.path,a.entryManifest.path,'work/enterprise/PREPARATION_PRODUCER_CONTAINMENT.md','work/enterprise/PREPARATION_CAPTURE_RECOVERY.md'])assert.ok(integration.references.some(r=>r.path===path),'restart integration missing reference: '+path);
 for(const [key,path]of [['descriptorIntegration','work/enterprise/PREPARATION_DESCRIPTOR.md'],['componentReview','work/enterprise/PREPARATION_COMPONENT_REVIEW.md']]){assert.equal(entry[key]?.contract?.path,path,'restart schema3 contract path');bind(entry[key].contract);}
}

// PDESC001 portable data codec. This encoder is module-private and data-only.
// Its caller must independently authenticate every input before it can be an
// intent constructor. No guard, authority flag, launch, or persistence is implied.
function encodeComponentDescriptor(record){
 const keys=['runSlug','projectIdentity','workflowRef','workflowBundleBytes','builderOccurrence','builderSession','designReview','plan','reviewInputs','currentInputs','sourceCheckpoint','scopeDefinition','invocationId','domainGeneration','command','hostIdentity','supervisorIdentity','helperSource','helperBuild','helperBinary','policy','inputInventory','outputStore','admissionStore'];
 const exact=(v,k)=>assert.ok(v&&typeof v==='object'&&!Array.isArray(v)&&JSON.stringify(Object.keys(v).sort())===JSON.stringify([...k].sort()),'PDESC001 exact fields');
 const join=xs=>{const length=xs.reduce((n,x)=>n+x.length,0);assert.ok(length<=65536,'PDESC001 length limit');return Buffer.concat(xs,length);};
 const uint=(v,n)=>{assert.ok(Number.isSafeInteger(v)&&v>=0&&v<2**(8*n),'PDESC001 length integer');const b=Buffer.alloc(n);b.writeUIntBE(v,0,n);return b;};
 const text=(s,empty=false,identity=false)=>{assert.equal(typeof s,'string','PDESC001 text');assert.ok(s.length<=(identity?256:1024),'PDESC001 text allocation bound');const b=Buffer.from(s,'utf8');assert.ok(b.toString('utf8')===s&&b.length>=(empty?0:1)&&b.length<=(identity?256:1024)&&!/[\x00-\x1f\x7f]/u.test(s),'PDESC001 strict text');if(identity)assert.match(s,/^[A-Za-z0-9._:/-]+$/,'PDESC001 identity');return b;};
 const digest=v=>{assert.ok(Buffer.isBuffer(v)&&v.length===32,'PDESC001 hash width');return Buffer.from(v);};
 const lp=b=>join([uint(b.length,4),b]);
 const vector=(a,min,max)=>{assert.ok(Array.isArray(a)&&a.length>=min&&a.length<=max,'PDESC001 vector count');return join([uint(a.length,2),...a.map(lp)]);};
 const command=c=>{
  exact(c,['executable','argv','env','cwd']);assert.ok(Array.isArray(c.argv)&&c.argv.length>=1&&c.argv.length<=128&&Array.isArray(c.env)&&c.env.length<=64,'PDESC001 command vectors');
  let previous='';const env=c.env.map(pair=>{assert.ok(Array.isArray(pair)&&pair.length===2,'PDESC001 env pair');const [k,v]=pair;assert.equal(typeof k,'string','PDESC001 env name');assert.match(k,/^[A-Z_][A-Z0-9_]*$/,'PDESC001 env name');assert.ok(k>previous&&k!=='PATH'&&!k.startsWith('LD_')&&!k.startsWith('DYLD_'),'PDESC001 env order or loader');previous=k;return join([lp(text(k)),lp(text(v,true))]);});
  const cwd=text(c.cwd);assert.ok(c.cwd==='/'||(c.cwd.startsWith('/')&&c.cwd.slice(1).split('/').every(x=>x!==''&&x!=='.'&&x!=='..')),'PDESC001 sandbox cwd');
  return join([digest(c.executable),lp(vector(c.argv.map(v=>text(v)),1,128)),lp(vector(env,0,64)),lp(cwd)]);
 };
 const policy=p=>{exact(p,['digest','limits']);assert.ok(Array.isArray(p.limits)&&p.limits.length===5,'PDESC001 policy limits');return join([digest(p.digest),...p.limits.map(v=>{assert.ok(typeof v==='bigint'&&v>0n&&v<=(1n<<64n)-1n,'PDESC001 policy u64');const b=Buffer.alloc(8);b.writeBigUInt64BE(v);return b;})]);};
 exact(record,keys);
 const fields=keys.map((k,i)=>{const b=k==='command'?command(record[k]):k==='policy'?policy(record[k]):[1,3,6,13].includes(i+1)?text(record[k],false,true):digest(record[k]);return join([uint(i+1,2),lp(b)]);});
 const total=16+fields.reduce((n,b)=>n+b.length,0);assert.ok(total<=65536,'PDESC001 length limit');
 return join([Buffer.from('PDESC001'),uint(total,4),uint(24,2),uint(0,2),...fields]);
}
// End PDESC001 portable data codec.

// Partial PDESC001 authority binding. These values are re-derived from the
// authenticated checkout and occurrence; this is not an intent constructor.
async function readComponentDescriptorAuthority(root){
 assert.equal(arguments.length,1,'descriptor authority arguments');root=resolve(root);
 const authority=await inspectComponentDevelopment(root),context=await currentContext(root);
 const isU=authority.kind==='U_COMPONENT_DEVELOPMENT_AUTHORITY_DIAGNOSTIC';
 assert.equal(authority.permission,'IMPLEMENTATION_AND_ISOLATED_REVIEW_ONLY','descriptor schema3 authority');
 if(!isU)assert.equal(hash(JSON.stringify(context)),authority.authorityFingerprint,'descriptor authority context changed');
 const authorityFingerprint=isU?hash(JSON.stringify({context,runtimeRoles:authority.runtimeRoles})):authority.authorityFingerprint;
 const planRaw=bytes(root,'work/enterprise/plan.json'),plan=strictPreparationJSON(planRaw),isR=authority.continuationCheckpointBound===true,entry=isU?plan.componentSuccessor:isR?plan.componentContinuation:plan.preparationRestart;
 let scopeDefinition;
 if(isU){
  assert.equal(entry.schemaVersion,5);assert.equal(entry.runSlug,context.identity.runSlug);assert.equal(entry.scope,'U-I1a-v1');
  const reference=r=>{assert.deepEqual(Object.keys(r).sort(),['bytes','path','sha256']);const raw=bytes(root,r.path);assert.equal(hash(raw),r.sha256,'U descriptor reference hash');assert.equal(raw.length,r.bytes,'U descriptor reference length');return {path:r.path,sha256:r.sha256,bytes:r.bytes};};
  scopeDefinition={schemaVersion:entry.schemaVersion,runSlug:entry.runSlug,scope:entry.scope,recordSchemaVersion:entry.recordSchemaVersion,candidateSchemaVersion:entry.candidateSchemaVersion,decisionSchemaVersion:entry.decisionSchemaVersion,caseConditions:entry.caseConditions,restartCases:entry.restartCases,predecessorCheckpoint:reference(entry.predecessorCheckpoint),runtimeRoles:reference(authority.runtimeRoles)};
 }else if(isR){
  // Historical R fixtures without the retained-bridge amendment still refuse.
  // Selection comes only from the independently authenticated current raw plan.
  assert.equal(entry.deliveryAmendment?.fixture?.profile,'R_HOST_PROTOCOL_V1','R semantic descriptor route not implemented');
  assert.equal(entry.schemaVersion,4);assert.equal(entry.runSlug,context.identity.runSlug);assert.equal(entry.scope,'R-I1a-v1');
  const checkpoint=r=>{const raw=bytes(root,r.path);assert.equal(hash(raw),r.sha256,'R descriptor checkpoint hash');if(r.bytes!==undefined)assert.equal(raw.length,r.bytes,'R descriptor checkpoint length');return {path:r.path,sha256:r.sha256,bytes:raw.length};};
  const predecessor=authority.references.find(r=>r.path===entry.predecessorCheckpoint);assert.ok(predecessor,'R descriptor predecessor binding');
  scopeDefinition={schemaVersion:entry.schemaVersion,runSlug:entry.runSlug,scope:entry.scope,recordSchemaVersion:entry.recordSchemaVersion,recordPurpose:entry.recordPurpose,decisionSchemaVersion:entry.decisionSchemaVersion,caseConditions:entry.caseConditions,restartCases:entry.restartCases,sourceCheckpoint:checkpoint(entry.sourceCheckpoint),predecessorCheckpoint:checkpoint(predecessor),reassessmentCheckpoint:checkpoint(entry.reassessment.checkpoint),integrationCheckpoint:checkpoint(entry.integrationReassessment.checkpoint)};
 }else scopeDefinition={descriptorIntegration:entry.descriptorIntegration,componentReview:entry.componentReview,integrationDelivery:entry.integrationDelivery};
 const logRaw=readFileSync(context.identity.logPath);assert.equal(hash(logRaw),context.authority.log,'descriptor occurrence log changed');
 const lines=logRaw.toString('utf8').split('\n').filter(line=>line.trim());
 const records=lines.map(line=>strictPreparationJSON(line));assert.deepEqual(records,context.records,'descriptor occurrence records changed');
 const index=context.records.findLastIndex(r=>r.type==='step_start');assert.ok(index>=0);assert.deepEqual(records[index],context.start,'descriptor current occurrence');
 const helper=authority.currentInputs.entries.find(e=>e.path==='scripts/enterprise/preparation-producer-linux.c');assert.ok(helper,'descriptor helper input missing');
 assert.equal(hash(bytes(root,helper.path)),helper.sha256,'descriptor helper input changed');
 assert.equal(hash(planRaw),authority.currentInputs.entries.find(e=>e.path==='work/enterprise/plan.json')?.sha256,'descriptor plan input changed');
 const bindings={runSlug:context.identity.runSlug,projectIdentity:hash(JSON.stringify({project:context.identity.project,stateId:context.identity.stateId})),workflowRef:context.identity.workflowRef,workflowBundleBytes:context.identity.bundleDigest,builderOccurrence:hash(lines[index]),builderSession:context.providerSessionId,designReview:authority.designReportSha256,plan:hash(planRaw),reviewInputs:authority.reviewInputsDigest,currentInputs:authority.currentInputs.digest,sourceCheckpoint:(isU?entry.predecessorCheckpoint:entry.sourceCheckpoint).sha256,scopeDefinition:hash(JSON.stringify(scopeDefinition)),helperSource:helper.sha256};
 // Re-authenticate after all asynchronous context reads. No caller-supplied
 // authority JSON or expected descriptor is accepted as a capability.
 const after=await inspectComponentDevelopment(root);assert.deepEqual(after,authority,'descriptor authority changed during read');
 if(isU)assert.deepEqual(await currentContext(root),context,'U descriptor context changed during read');
 assert.deepEqual(readFileSync(context.identity.logPath),logRaw,'descriptor occurrence bytes changed');
 assert.deepEqual(bytes(root,'work/enterprise/plan.json'),planRaw,'descriptor plan bytes changed');
 assert.equal(inputs(root).digest,authority.currentInputs.digest,'descriptor inputs changed during read');
 return {kind:isU?'U_COMPONENT_DESCRIPTOR_AUTHORITY_DATA':isR?'R_COMPONENT_DESCRIPTOR_AUTHORITY_DATA':'Q_COMPONENT_DESCRIPTOR_AUTHORITY_DATA',bindings,authorityFingerprint,intentMatched:false,launchAuthority:false};
}
async function verifyComponentDescriptorAuthority(root,record){
 assert.equal(arguments.length,2,'descriptor authority arguments');
 const before=encodeComponentDescriptor(record),authority=await readComponentDescriptorAuthority(root);
 assert.deepEqual(encodeComponentDescriptor(record),before,'descriptor changed during authority check');
 const identities=['runSlug','workflowRef','builderSession'];
 for(const [key,value]of Object.entries(authority.bindings))assert.deepEqual(record[key],identities.includes(key)?value:Buffer.from(value,'hex'),'descriptor authority mismatch: '+key);
 return {kind:authority.kind.replace('_DATA','_BINDINGS'),checkedFields:Object.keys(authority.bindings),authorityBindingsMatched:true,descriptorSha256:hash(before),remainingFields:['invocationId','domainGeneration','command','hostIdentity','supervisorIdentity','helperBuild','helperBinary','policy','inputInventory','outputStore','admissionStore'],intentMatched:false,provenanceAuthenticated:false,reviewReady:false,launchAuthority:false,nativePolicyApplied:false,generationQuiescent:false};
}
// End partial PDESC001 authority binding.

// Private owned acquisition of the remaining PDESC001 sources. No public CLI
// invokes this constructor. The handle is local to this module/process, not a
// serializable authority. R retains a C reservation owner; publication remains
// unimplemented. Q keeps its comparison-only diagnostic behavior.
const componentDescriptorHandles=new WeakMap();
const rHostProtocolDefinition=JSON.stringify({schemaVersion:1,purpose:'R_HOST_PROTOCOL_V1',command:{argv:['/bridge'],env:[['LANG','C'],['LC_ALL','C']],cwd:'/'},supervisor:{role:'retained-private-C-owner',protocol:'RSP1',commandRole:'WAITING_PROTOCOL_CHILD_ONLY',nativeAuthority:false},policy:{limits:['10000','1000','134217728','1','65536'],stores:'owner-created-only',inheritedFDs:[0,1,2,3,4,5,6,7,8],workloadExec:false,network:false,enforced:['wall-deadline','bounded-output','at-most-one-waiting-child'],nativePending:['cpu','memory','credentials','mounts','namespaces','syscalls'],nativeEnforcement:false}});
const uHostProtocolDefinition="{\"schemaVersion\":1,\"purpose\":\"U_HOST_PROTOCOL_V1\",\"command\":{\"argv\":[\"/bridge\"],\"env\":[[\"LANG\",\"C\"],[\"LC_ALL\",\"C\"]],\"cwd\":\"/\"},\"supervisor\":{\"role\":\"retained-private-C-owner\",\"protocol\":\"RSP1\",\"commandRole\":\"WAITING_PROTOCOL_CHILD_ONLY\",\"nativeAuthority\":false},\"policy\":{\"profile\":\"U_HOST_PROTOCOL_V1\",\"limits\":[\"1260000\",\"1000\",\"134217728\",\"1\",\"65536\"],\"timing\":{\"ownerMs\":1260000,\"challengeMs\":240000,\"watchdogMs\":1261000,\"cleanupMs\":1000,\"clock\":\"CLOCK_MONOTONIC\",\"childDeadline\":\"inherited-owner-start\",\"reset\":false},\"stores\":\"owner-created-only\",\"inheritedFDs\":[0,1,2,3,4,5,6,7,8],\"workloadExec\":false,\"network\":false,\"enforced\":[\"wall-deadline\",\"bounded-output\",\"at-most-one-waiting-child\"],\"nativePending\":[\"cpu\",\"memory\",\"credentials\",\"mounts\",\"namespaces\",\"syscalls\"],\"nativeEnforcement\":false}}";
const rReservationHarness=String.raw`
#define main helper_main
#include "input/scripts/enterprise/preparation-producer-linux.c"
#undef main
int main(int argc,char **argv){
 if(argc==2&&!strcmp(argv[1],"--inspect-host"))return helper_main(argc,argv);
 if(argc!=1||strcmp(argv[0],"/bridge")){fputs("R_BRIDGE_ARGV_REFUSED\n",stderr);return 64;}
 struct sigaction sa;memset(&sa,0,sizeof(sa));sa.sa_handler=SIG_IGN;
 if(sigaction(SIGPIPE,&sa,NULL)<0)return 1;
 long max=sysconf(_SC_OPEN_MAX);if(max<0||max>1048576)return 1;
 for(int fd=9;fd<max;fd++)(void)close(fd);
 if(pd_semantic_reserve_bridge()<0){fprintf(stderr,"R_BRIDGE_ERROR:%d\n",errno);return 1;}return 0;
}
`;
// Independently inspect the held image, not the descriptor's claimed host.
// This initial portable fixture supports this explicitly checked ABI only.
function rProtocolCompatibility(raw,version){
 assert.equal(process.platform,'darwin','R protocol unsupported host OS');assert.equal(process.arch,'arm64','R protocol unsupported host architecture');
 assert.ok(raw.length>=32&&raw.readUInt32LE(0)===0xfeedfacf&&raw.readUInt32LE(4)===0x0100000c&&raw.readUInt32LE(12)===2,'R protocol Mach-O ABI');
 const count=raw.readUInt32LE(16),size=raw.readUInt32LE(20);assert.ok(count>0&&count<1024&&size<=raw.length-32,'R protocol load commands');
 let offset=32,loader=null,minimum=null;const libraries=[];
 for(let i=0;i<count;i++){
  assert.ok(offset+8<=32+size,'R protocol command header');const cmd=raw.readUInt32LE(offset),n=raw.readUInt32LE(offset+4);assert.ok(n>=8&&n%8===0&&offset+n<=32+size,'R protocol command bounds');
  if(cmd===0xe||cmd===0xc){assert.ok(n>=24,'R protocol loader command');const at=raw.readUInt32LE(offset+8);assert.ok(at>=12&&at<n,'R protocol loader path');const end=raw.indexOf(0,offset+at);assert.ok(end>=offset+at&&end<offset+n,'R protocol loader terminator');const value=raw.subarray(offset+at,end).toString('utf8');if(cmd===0xe){assert.equal(loader,null);loader=value;}else libraries.push(value);}
  if(cmd===0x32){assert.ok(n>=24);assert.equal(minimum,null);assert.equal(raw.readUInt32LE(offset+8),1,'R protocol target platform');minimum=raw.readUInt32LE(offset+12);}
  assert.ok(![0x18,0x80000018,0x1f,0x8000001f,0x8000001c,0x20,0x80000023].includes(cmd),'R protocol unsupported dynamic dependency');offset+=n;
 }
 assert.equal(offset,32+size);assert.equal(loader,'/usr/lib/dyld');assert.deepEqual(libraries,['/usr/lib/libSystem.B.dylib']);assert.ok(minimum!==null);
 assert.match(version,/^\d+\.\d+(?:\.\d+)?$/);const v=version.split('.').map(Number),host=v[0]*65536+v[1]*256+(v[2]??0);assert.ok(minimum<=host,'R protocol minimum OS');
 return {os:process.platform,architecture:process.arch,format:'Mach-O64',abi:'arm64',loader,libraries,minimumOS:minimum,hostVersion:version,role:'WAITING_PROTOCOL_CHILD_ONLY',nativePolicyApplied:false};
}
const componentIntentDefinition=String.raw`{"schemaVersion":1,"purpose":"PORTABLE_VERSION_PROBE","command":{"argv":["/bin/node","--version"],"env":[["LANG","C"],["LC_ALL","C"]],"cwd":"/work"},"supervisor":{"role":"isolated-version-probe-controller","protocol":"PDESC001","owns":["child","admission","output-writer"],"onDeadline":"terminate-generation-and-drain","onChildExit":"wait-for-generation-empty-and-writer-eof","onUnknown":"retain-fence-and-diagnostics","nativeAuthority":false},"policy":{"limits":["10000","1000","134217728","1","65536"],"credentials":{"uid":65534,"gid":65534,"supplementaryGroups":[],"capabilities":[],"noNewPrivileges":true},"mounts":[{"path":"/","access":"ro","executable":false},{"path":"/bin/node","access":"ro","executable":true},{"path":"/work","access":"ro","executable":false},{"path":"/input","access":"ro","executable":false},{"path":"/output","access":"rw","executable":false}],"fds":{"inherited":[0,1,2],"stdin":"eof","stdout":"bounded-parent-pipe","stderr":"bounded-parent-pipe","closeOthers":true},"ipc":{"network":"deny","unixSockets":"deny","sysv":"deny","posixMessageQueues":"deny"},"namespaces":{"user":"private","mount":"private","pid":"private","network":"private","ipc":"private","uts":"private"},"syscalls":{"abi":"linux-aarch64","default":"deny","allow":["brk","clock_gettime","close","exit","exit_group","fstat","futex","getegid","geteuid","getgid","getpid","getrandom","gettid","getuid","lseek","mmap","mprotect","munmap","newfstatat","openat","pread64","prlimit64","read","readlinkat","rseq","rt_sigaction","rt_sigprocmask","rt_sigreturn","set_robust_list","set_tid_address","sigaltstack","uname","write"]},"nativeEnforcement":false}}`;
// A concrete intended profile, not proof that this host/executable can apply it.
// Exact supported values and nested keys prevent an unknown default/placeholder
// from becoming eligible merely by recomputing its hash.
function validateComponentIntentDefinition(definition){
 assert.equal(arguments.length,1,'intent definition arguments');
 assert.deepEqual(definition,JSON.parse(componentIntentDefinition),'intent definition unsupported or incomplete');
 assert.ok(definition.policy.limits.every(v=>/^[1-9][0-9]*$/.test(v)&&BigInt(v)<=18446744073709551615n),'intent definition finite limits');
 assert.equal(definition.command.argv[0],definition.policy.mounts.find(m=>m.executable).path,'intent definition executable projection');
 assert.ok(definition.policy.mounts.some(m=>m.path===definition.command.cwd&&m.access==='ro'),'intent definition cwd projection');
 assert.equal(definition.policy.mounts.filter(m=>m.access==='rw').length,1,'intent definition output isolation');
 return true;
}
const componentComparisonHarness=String.raw`
#define main helper_main
#include "input/scripts/enterprise/preparation-producer-linux.c"
#undef main
int main(void){if(pd_intent_compare_fds(3,4)<0){fprintf(stderr,"C_INTENT_MISMATCH:%d\n",errno);return 1;}puts("C_FIELDS_MATCHED");return 0;}
`;

function componentOwnedIdentity(s){return {dev:String(s.dev),ino:String(s.ino),uid:String(s.uid),gid:String(s.gid),mode:s.mode,...(s.isDirectory()?{}:{nlink:String(s.nlink)})};}
function componentOwnedRead(fd){
 const before=fstatSync(fd);assert.ok(before.isFile()&&before.size<=268435456,'owned source size/type');
 const b=Buffer.alloc(before.size);let n=0;while(n<b.length){const count=readSync(fd,b,n,b.length-n,n);assert.ok(count>0,'owned source short read');n+=count;}
 assert.deepEqual(componentOwnedIdentity(fstatSync(fd)),componentOwnedIdentity(before),'owned source identity during read');assert.equal(fstatSync(fd).size,b.length,'owned source size during read');return b;
}
function componentOwnedPaths(path){
 const out=[];const walk=p=>{for(const n of readdirSync(p).sort()){const q=p+'/'+n,s=lstatSync(q);assert.ok(!s.isSymbolicLink(),'owned inventory symlink');out.push(q);if(s.isDirectory())walk(q);else assert.ok(s.isFile(),'owned inventory type');}};walk(path);return out;
}
function componentCheckOwned(s){
 assert.ok(!s.closed,'owned descriptor closed');
 for(const d of s.directories){const st=lstatSync(d.path);assert.ok(st.isDirectory()&&!st.isSymbolicLink(),'owned directory type');assert.deepEqual(componentOwnedIdentity(st),d.identity,'owned directory changed: '+d.path);assert.deepEqual(componentOwnedIdentity(fstatSync(d.fd)),d.identity,'owned directory fd changed');}
 for(const f of s.files){assert.equal(realpathSync(f.path),f.path,'owned source symlink path');const st=lstatSync(f.path);assert.ok(st.isFile()&&!st.isSymbolicLink(),'owned source type');assert.deepEqual(componentOwnedIdentity(st),f.identity,'owned source identity changed: '+f.path);const b=componentOwnedRead(f.fd);assert.equal(b.length,f.bytes,'owned source changed: '+f.path);assert.equal(hash(b),f.sha256,'owned source changed: '+f.path);}
 if(s.paths){
  const managed=new Set(s.bridgeStarted?['descriptor/descriptor',...['prepared','admitted','closed'].flatMap(n=>['intent','commit'].map(k=>'admission/'+n+'.'+k))].map(p=>s.base+'/'+p):[]);
  assert.deepEqual(componentOwnedPaths(s.base).filter(p=>!managed.has(p)),s.paths,'owned inventory changed');
 }
}
// This is a held projection intent, not a mounted sandbox or launch proof.
// Derive every host-side identity from private acquisition, never the descriptor.
function componentCommandProjection(s){
 const reference=f=>({path:f.path,identity:f.identity,sha256:f.sha256,bytes:f.bytes});
 const directory=(role,sandboxPath,suffix)=>{const d=s.directories.find(x=>x.path===s.base+suffix);assert.ok(d,'owned projection directory missing: '+role);return {role,sandboxPath,source:{path:d.path,identity:d.identity}};};
 const owner=strictPreparationJSON(componentOwnedRead(s.records.get('owner.json').fd));
 if(s.rProtocol)return {schemaVersion:1,kind:s.uProtocol?'U_HOST_PROTOCOL_PROJECTION':'R_HOST_PROTOCOL_PROJECTION',invocationId:owner.invocationId,generation:owner.generation,definitionSha256:s.records.get('definition.json').sha256,image:reference(s.binary),cwd:'/',waitingChild:'fork-of-held-bridge-image',nativeApplied:false};
 return {schemaVersion:1,kind:'PORTABLE_COMMAND_PROJECTION',invocationId:owner.invocationId,generation:owner.generation,definitionSha256:s.records.get('definition.json').sha256,originalExecutable:reference(s.originalExecutable),entries:[directory('root','/','/sandbox'),{role:'executable',sandboxPath:'/bin/node',source:reference(s.executable)},directory('cwd','/work','/sandbox/work'),directory('inputs','/input','/input'),directory('output','/output','/output')],nativeApplied:false};
}
function componentCheckProjection(s,inventory){
 const file=s.records.get('command-projection.json');assert.ok(file,'owned command projection missing');
 const raw=componentOwnedRead(file.fd),projection=strictPreparationJSON(raw);
 assert.deepEqual(projection,componentCommandProjection(s),'owned command projection changed');
 if(s.rProtocol){assert.deepEqual(inventory.commandProjection,{path:file.path,sha256:hash(raw),bytes:raw.length});return;}
 assert.equal(s.executable.path,s.base+'/sandbox/bin/node','owned executable projection path');
 assert.equal(s.executable.sha256,s.originalExecutable.sha256,'owned executable projection bytes');
 assert.equal(s.executable.bytes,s.originalExecutable.bytes,'owned executable projection size');
 assert.notDeepEqual([s.executable.identity.dev,s.executable.identity.ino],[s.originalExecutable.identity.dev,s.originalExecutable.identity.ino],'owned executable projection aliases source');
 const directories=projection.entries.filter(e=>e.role!=='executable');
 assert.equal(new Set(directories.map(e=>e.source.identity.dev+':'+e.source.identity.ino)).size,directories.length,'owned projection aliases directories');
 assert.deepEqual(inventory.commandProjection,{path:file.path,sha256:hash(raw),bytes:raw.length},'owned inventory projection binding');
}
function componentExpectedOwned(s,authority){
 const raw=name=>{const f=s.records.get(name);assert.ok(f,'owned missing source: '+name);return componentOwnedRead(f.fd);},json=name=>strictPreparationJSON(raw(name)),h=name=>Buffer.from(hash(raw(name)),'hex');
 const owner=json('owner.json'),definition=json('definition.json'),build=json('build.json'),host=json('host.json'),inventory=json('inventory.json'),output=json('output-store.json'),admission=json('admission-store.json');
 assert.equal(owner.runSlug,authority.bindings.runSlug);assert.equal(owner.builderOccurrence,authority.bindings.builderOccurrence);assert.equal(owner.inputsDigest,authority.bindings.currentInputs);
 assert.deepEqual(raw('definition.json'),Buffer.from(s.uProtocol?uHostProtocolDefinition:s.rProtocol?rHostProtocolDefinition:componentIntentDefinition),'owned private definition changed');
 if(s.rProtocol){assert.deepEqual(json('compatibility.json'),rProtocolCompatibility(componentOwnedRead(s.binary.fd),raw('host-version.stdout').toString().trim()));assert.equal(s.executable,s.binary);}else validateComponentIntentDefinition(definition);
 assert.equal(build.status,0);assert.equal(build.signal,null);assert.equal(build.error,null);assert.equal(build.source.sha256,authority.bindings.helperSource);assert.equal(build.binary.sha256,s.binary.sha256);assert.equal(host.status,78);assert.equal(host.binarySha256,s.binary.sha256);assert.equal(host.observation.backendAuthenticated,false);assert.equal(host.observation.workloadStarted,false);
 componentCheckProjection(s,inventory);
 assert.equal(inventory.inputsDigest,authority.bindings.currentInputs);assert.deepEqual(inventory.entries.map(e=>({path:e.path,sha256:e.sha256,bytes:e.bytes})),s.inputs.entries);
 for(const [role,store]of [['output',output],['admission',admission]]){assert.equal(store.role,role);assert.equal(store.runSlug,owner.runSlug);assert.equal(store.invocation,owner.invocationId);assert.equal(store.generation,owner.generation);assert.deepEqual(store.identity,s.directories.find(d=>d.path===store.path)?.identity);}
 assert.notDeepEqual([output.identity.dev,output.identity.ino],[admission.identity.dev,admission.identity.ino],'owned stores alias');
 const record=Object.fromEntries(Object.entries(authority.bindings).map(([k,v])=>[k,['runSlug','workflowRef','builderSession'].includes(k)?v:Buffer.from(v,'hex')]));
 return {...record,invocationId:owner.invocationId,domainGeneration:Buffer.from(owner.generation,'hex'),command:{...definition.command,executable:Buffer.from(s.executable.sha256,'hex')},hostIdentity:h('host.json'),supervisorIdentity:h('supervisor.json'),helperBuild:h('build.json'),helperBinary:Buffer.from(s.binary.sha256,'hex'),policy:{digest:h('policy.json'),limits:json('policy.json').limits.map(BigInt)},inputInventory:h('inventory.json'),outputStore:h('output-store.json'),admissionStore:h('admission-store.json')};
}
async function constructComponentDescriptor(root){
 assert.equal(arguments.length,1,'descriptor constructor arguments');root=realpathSync(root);
 const authority=await readComponentDescriptorAuthority(root),guard=await inspectComponentDevelopment(root);
 assert.equal(authority.bindings.currentInputs,guard.currentInputs.digest,'owned current inputs');
 assert.ok(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'owned Node environment override');
 const uProtocol=authority.kind==='U_COMPONENT_DESCRIPTOR_AUTHORITY_DATA',rProtocol=uProtocol||authority.kind==='R_COMPONENT_DESCRIPTOR_AUTHORITY_DATA';
 if(!rProtocol)validateComponentIntentDefinition(JSON.parse(componentIntentDefinition));
 const generation=randomBytes(32).toString('hex'),id='intent-'+generation,namespace=guard.diagnosticNamespace.replace(/\/$/,''),base=confined(root,namespace+'/'+id);
 const s={root,base,files:[],directories:[],records:new Map(),closed:false,authority,inputs:guard.currentInputs,rProtocol,uProtocol};
 const holdDirectory=path=>{const st=lstatSync(path);assert.ok(st.isDirectory()&&!st.isSymbolicLink(),'owned directory type');const fd=openSync(path,fsConstants.O_RDONLY|fsConstants.O_DIRECTORY|fsConstants.O_NOFOLLOW);const d={path,fd,identity:componentOwnedIdentity(fstatSync(fd))};s.directories.push(d);assert.deepEqual(d.identity,componentOwnedIdentity(st));return d;};
 const makeDirectory=path=>{mkdirSync(path,{mode:0o700});prepSyncDir(dirname(path));return holdDirectory(path);};
 const holdFile=path=>{assert.equal(realpathSync(path),path,'owned source symlink path');const fd=openSync(path,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW);let kept=false;try{const st=fstatSync(fd);assert.ok(st.isFile(),'owned source file');assert.equal(st.nlink,1,'owned source hardlink');const b=componentOwnedRead(fd),f={path,fd,identity:componentOwnedIdentity(st),sha256:hash(b),bytes:b.length};assert.deepEqual(componentOwnedIdentity(lstatSync(path)),f.identity);s.files.push(f);kept=true;return f;}finally{if(!kept)closeSync(fd);}};
 const ref=f=>({path:f.path,identity:f.identity,sha256:f.sha256,bytes:f.bytes});
 const save=(name,value)=>{componentCheckOwned(s);const path=base+'/'+name,raw=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,2)+'\n'),fd=openSync(path,'wx',0o600);try{writeFileSync(fd,raw);fsyncSync(fd);}finally{closeSync(fd);}prepSyncDir(base);const f=holdFile(path);assert.equal(f.sha256,hash(raw),'owned write readback');s.records.set(name,f);return f;};
 const run=(name,executable,argv,env)=>{
  componentCheckOwned(s);const startedAt=new Date().toISOString(),r=spawnSync(executable,argv,{cwd:base,env,encoding:'utf8',timeout:30000,maxBuffer:2097152,stdio:['ignore','pipe','pipe']});
  const stdout=save(name+'.stdout',Buffer.from(r.stdout??'')),stderr=save(name+'.stderr',Buffer.from(r.stderr??''));
  return {argv:[executable,...argv],environment:env,cwd:base,startedAt,finishedAt:new Date().toISOString(),status:r.status,signal:r.signal,error:r.error?{code:r.error.code,message:r.error.message}:null,stdout:ref(stdout),stderr:ref(stderr)};
 };
 try{
  // Shared ancestors are checked but never treated as newly owned storage.
  let path=root;for(const part of namespace.split('/')){path+='/'+part;if(!existsSync(path))mkdirSync(path,{mode:0o700});assert.equal(realpathSync(path),path,'owned namespace symlink');holdDirectory(path);}
  assert.deepEqual(await readComponentDescriptorAuthority(root),authority,'owned authority before allocation');mkdirSync(base,{mode:0o700});s.created=true;prepSyncDir(dirname(base));holdDirectory(base);
  save('owner.json',{schemaVersion:1,kind:'PORTABLE_INTENT_SOURCE_OWNER',runSlug:guard.runSlug,invocationId:id,generation,builderOccurrence:authority.bindings.builderOccurrence,builderSession:guard.builderSession,inputsDigest:guard.currentInputs.digest});
  save('start.json',{kind:'INTENT_SOURCE_ACQUISITION_STARTED',invocationId:id,startedAt:new Date().toISOString(),launchAuthority:false});
  save('definition.json',Buffer.from(uProtocol?uHostProtocolDefinition:rProtocol?rHostProtocolDefinition:componentIntentDefinition));const definition=JSON.parse(uProtocol?uHostProtocolDefinition:rProtocol?rHostProtocolDefinition:componentIntentDefinition);
  save('policy.json',definition.policy);save('supervisor.json',{definition:definition.supervisor,invocationId:id,generation});
  for(const name of ['input','output','admission','descriptor','scratch'])makeDirectory(base+'/'+name);
  const directories=new Set([base+'/input']),copied=[];
  for(const e of guard.currentInputs.entries){const original=holdFile(confined(root,e.path));assert.equal(original.sha256,e.sha256,'owned input hash');assert.equal(original.bytes,e.bytes,'owned input length');const target=base+'/input/'+e.path;let parent=base+'/input';for(const part of e.path.split('/').slice(0,-1)){parent+='/'+part;if(!directories.has(parent)){makeDirectory(parent);directories.add(parent);}}
   const fd=openSync(target,'wx',0o600);try{writeFileSync(fd,componentOwnedRead(original.fd));fsyncSync(fd);}finally{closeSync(fd);}prepSyncDir(dirname(target));const copy=holdFile(target);assert.equal(copy.sha256,e.sha256);copied.push({...e,copy:ref(copy)});
  }
  // Inventory is fixed after the executable/cwd projection, before descriptor.
  // The projection contains no descriptor or future runtime result reference.
  for(const role of ['output','admission','descriptor']){const d=s.directories.find(d=>d.path===base+'/'+role);save(role+'-store.json',{role,runSlug:guard.runSlug,invocation:id,generation,path:d.path,identity:d.identity});}
  if(!rProtocol){s.originalExecutable=holdFile(realpathSync(process.execPath));
  for(const suffix of ['/sandbox','/sandbox/bin','/sandbox/work'])makeDirectory(base+suffix);
  const executablePath=base+'/sandbox/bin/node',executableFD=openSync(executablePath,'wx',0o700);
  try{writeFileSync(executableFD,componentOwnedRead(s.originalExecutable.fd));fsyncSync(executableFD);}finally{closeSync(executableFD);}prepSyncDir(dirname(executablePath));
  s.executable=holdFile(executablePath);assert.equal(s.executable.sha256,s.originalExecutable.sha256,'owned executable copy changed');assert.equal(s.executable.bytes,s.originalExecutable.bytes,'owned executable copy size');
  save('command-executable.json',ref(s.executable));
  const projection=save('command-projection.json',componentCommandProjection(s));
  save('inventory.json',{inputsDigest:guard.currentInputs.digest,entries:copied,commandProjection:{path:projection.path,sha256:projection.sha256,bytes:projection.bytes}});}
  const compilerPath=realpathSync(process.platform==='darwin'?'/Library/Developer/CommandLineTools/usr/bin/clang':'/usr/bin/cc'),compiler=holdFile(compilerPath),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:base+'/scratch'},flags=['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-O2'];
  let sdk=null;
  if(process.platform==='darwin'){const xcrun=holdFile(realpathSync('/usr/bin/xcrun')),r=run('sdk',xcrun.path,['--sdk','macosx','--show-sdk-path'],env);save('sdk-execution.json',{...r,executable:ref(xcrun)});assert.equal(r.status,0,'owned SDK discovery failed');const sdkPath=realpathSync(readFileSync(r.stdout.path,'utf8').trim()),settings=holdFile(sdkPath+'/SDKSettings.json');sdk={path:sdkPath,settings:ref(settings)};flags.push('-isysroot',sdkPath);}
  const source=s.files.find(f=>f.path===base+'/input/scripts/enterprise/preparation-producer-linux.c'),binaryPath=base+'/helper';
  const harness=rProtocol?save('reservation-harness.c',Buffer.from((uProtocol?'#define PD_U_HOST_PROTOCOL_V1 1\n':'')+rReservationHarness)):null;
  const build=run('compile',compiler.path,[...flags,harness?.path??source.path,'-o',binaryPath],env);save('compiler-execution.json',{...build,compiler:ref(compiler),sdk,source:ref(source),...(harness?{harness:ref(harness)}:{})});
  assert.equal(build.error,null,'owned compiler error');assert.equal(build.signal,null,'owned compiler signal');assert.equal(build.status,0,'owned compiler failed');
  s.binary=holdFile(binaryPath);const binaryFD=openSync(binaryPath,'r');try{fsyncSync(binaryFD);}finally{closeSync(binaryFD);}prepSyncDir(base);
  save('build.json',{...build,compiler:ref(compiler),sdk,source:ref(source),binary:ref(s.binary)});
  if(rProtocol){
   const versionTool=holdFile(realpathSync('/usr/bin/sw_vers')),version=run('host-version',versionTool.path,['-productVersion'],env);assert.equal(version.status,0,'R host version observation');save('host-version.json',{...version,tool:ref(versionTool)});
   save('compatibility.json',rProtocolCompatibility(componentOwnedRead(s.binary.fd),readFileSync(version.stdout.path,'utf8').trim()));
   s.executable=s.binary;const projection=save('command-projection.json',componentCommandProjection(s));
   save('inventory.json',{inputsDigest:guard.currentInputs.digest,entries:copied,commandProjection:{path:projection.path,sha256:projection.sha256,bytes:projection.bytes}});
   save('authority-fingerprint.bin',Buffer.from(authority.authorityFingerprint,'hex'));
  }
  const host=run('host',binaryPath,['--inspect-host'],env);assert.equal(host.status,78,'owned host observation status');assert.equal(host.signal,null);assert.equal(host.error,null);const observation=strictPreparationJSON(componentOwnedRead(s.records.get('host.stdout').fd));assert.equal(observation.kind,'PREPARATION_NATIVE_PREFLIGHT');assert.equal(observation.backendAuthenticated,false);assert.equal(observation.workloadStarted,false);
  save('host.json',{...host,binarySha256:s.binary.sha256,observation,nativeAuthentication:false});
  const comparisonSource=save('comparison-harness.c',Buffer.from(componentComparisonHarness)),comparisonPath=base+'/comparison-helper';
  const comparisonBuild=run('comparison-compile',compiler.path,[...flags,comparisonSource.path,'-o',comparisonPath],env);
  save('comparison-compiler-execution.json',{...comparisonBuild,compiler:ref(compiler),sdk,source:ref(comparisonSource),includedSource:ref(source)});
  assert.equal(comparisonBuild.error,null,'owned comparison compiler error');assert.equal(comparisonBuild.signal,null);assert.equal(comparisonBuild.status,0,'owned comparison compiler failed');
  s.comparator=holdFile(comparisonPath);const comparisonFD=openSync(comparisonPath,'r');try{fsyncSync(comparisonFD);}finally{closeSync(comparisonFD);}prepSyncDir(base);
  save('comparison-build.json',{...comparisonBuild,compiler:ref(compiler),sdk,source:ref(comparisonSource),includedSource:ref(source),binary:ref(s.comparator)});
  componentCheckOwned(s);assert.deepEqual(await readComponentDescriptorAuthority(root),authority,'owned authority after acquisition');componentCheckOwned(s);
  const expected=componentExpectedOwned(s,authority);save('expected.bin',encodeComponentDescriptor(expected));
  const record=componentExpectedOwned(s,authority),wire=encodeComponentDescriptor(record);save('descriptor.bin',wire);
  s.paths=componentOwnedPaths(base);componentCheckOwned(s);
  const handle={record,wire:Buffer.from(wire),diagnosticPath:relative(root,base),intentMatched:false,launchAuthority:false};componentDescriptorHandles.set(handle,s);return handle;
 }catch(error){
  // Keep incomplete acquisition and the exact primary error; never remove a
  // failed invocation or retry it with a fresh identity inside this operation.
  if(s.created)try{save('failure.json',{kind:'INTENT_SOURCE_ACQUISITION_FAILED',message:error.message,launchAuthority:false});}catch(cleanup){error.diagnosticFailure=cleanup.message;}
  for(const f of [...s.files,...s.directories].reverse())try{closeSync(f.fd);}catch(cleanup){(error.closeFailures??=[]).push(cleanup.message);}s.closed=true;throw error;
 }
}
async function verifyOwnedComponentDescriptor(handle,record){
 assert.equal(arguments.length,2,'owned descriptor arguments');const s=componentDescriptorHandles.get(handle);assert.ok(s,'owned descriptor handle');componentCheckOwned(s);
 const before=encodeComponentDescriptor(record),authority=await readComponentDescriptorAuthority(s.root);
 assert.deepEqual(encodeComponentDescriptor(record),before,'descriptor changed during owned check');assert.deepEqual(authority,s.authority,'owned authority changed');componentCheckOwned(s);
 const expected=componentExpectedOwned(s,authority);for(const key of Object.keys(expected))assert.deepEqual(record[key],expected[key],'owned descriptor mismatch: '+key);
 assert.deepEqual(before,componentOwnedRead(s.records.get('descriptor.bin').fd),'owned descriptor bytes mismatch');
 return {kind:'OWNED_COMPONENT_DESCRIPTOR_SOURCES',checkedFields:Object.keys(expected),sourceBindingsMatched:true,descriptorSha256:hash(before),intentMatched:false,reviewReady:false,launchAuthority:false,nativePolicyApplied:false,generationQuiescent:false,remaining:['C independent semantic comparison','retained semantic owner','reservation and publication revalidation']};
}
// Private data comparison only. The parent authenticates acquired sources;
// C compares inherited held bytes and cannot authenticate TAKT by itself.
// No serialized comparison result is a setup owner or publication authority.
async function compareOwnedComponentDescriptor(handle){
 assert.equal(arguments.length,1,'owned comparison arguments');
 const s=componentDescriptorHandles.get(handle);assert.ok(s,'owned descriptor handle');
 await verifyOwnedComponentDescriptor(handle,handle.record);
 const authority=await readComponentDescriptorAuthority(s.root);assert.deepEqual(authority,s.authority,'owned comparison authority');componentCheckOwned(s);
 const expected=encodeComponentDescriptor(componentExpectedOwned(s,authority)),expectedFile=s.records.get('expected.bin'),descriptorFile=s.records.get('descriptor.bin');
 assert.deepEqual(componentOwnedRead(expectedFile.fd),expected,'owned comparison independent expectations');
 const run=spawnSync(s.comparator.path,[],{env:{LANG:'C',LC_ALL:'C'},encoding:'utf8',timeout:10000,maxBuffer:65536,stdio:['ignore','pipe','pipe',expectedFile.fd,descriptorFile.fd]});
 componentCheckOwned(s);await verifyOwnedComponentDescriptor(handle,handle.record);componentCheckOwned(s);
 assert.equal(run.error,undefined,'owned comparison subprocess error');assert.equal(run.signal,null,'owned comparison signal');assert.equal(run.status,0,'owned C fields differ: '+run.stderr);assert.equal(run.stdout,'C_FIELDS_MATCHED\n');assert.equal(run.stderr,'');
 return {kind:'C_OWNED_DESCRIPTOR_FIELDS',cFieldsMatched:true,checkedFields:Object.keys(componentExpectedOwned(s,authority)),descriptorSha256:descriptorFile.sha256,expectedSha256:expectedFile.sha256,comparisonBinarySha256:s.comparator.sha256,status:run.status,stdout:run.stdout,stderr:run.stderr,intentMatched:false,reviewReady:false,launchAuthority:false,nativePolicyApplied:false,generationQuiescent:false,remaining:['retained semantic owner','reservation and publication revalidation','native executable ABI and loader projection unverified']};
}
function closeComponentDescriptor(handle){
 assert.equal(arguments.length,1,'owned close arguments');const s=componentDescriptorHandles.get(handle);assert.ok(s,'owned descriptor handle');assert.ok(!s.bridgeStarted||s.bridgeClosed,'retained bridge must close before sources');if(s.closed)return;s.closed=true;const errors=[];for(const f of [...s.files,...s.directories].reverse())try{closeSync(f.fd);}catch(e){errors.push(e);}if(errors.length)throw new AggregateError(errors,'owned descriptor close');
}
const componentReservationHandles=new WeakMap();
function decodeRProtocolFrame(raw){
 assert.ok(Buffer.isBuffer(raw)&&raw.length===208,'RSP1 frame length');assert.equal(raw.toString('ascii',0,4),'RSP1','RSP1 magic');assert.equal(raw[4],1,'RSP1 version');assert.ok(raw[5]>=1&&raw[5]<=3,'RSP1 direction');assert.ok(raw[6]>=1&&raw[6]<=5,'RSP1 stage');assert.equal(raw[7],0,'RSP1 flags');assert.ok(raw.readBigUInt64BE(8)>0n,'RSP1 sequence');
 return {direction:raw[5],stage:raw[6],sequence:raw.readBigUInt64BE(8),challenge:Buffer.from(raw.subarray(16,48)),invocation:Buffer.from(raw.subarray(48,80)),generation:Buffer.from(raw.subarray(80,112)),descriptor:Buffer.from(raw.subarray(112,144)),expected:Buffer.from(raw.subarray(144,176)),authority:Buffer.from(raw.subarray(176,208))};
}
// Only this private composition can bind a running C process to source handles.
// R_RESERVED is an observation, never a capability or permission to publish.
async function reserveOwnedComponentDescriptor(handle){
 assert.equal(arguments.length,1,'reservation arguments');const s=componentDescriptorHandles.get(handle);assert.ok(s&&s.rProtocol,'R owned descriptor handle');assert.ok(!s.bridgeStarted,'reservation one use');
 await verifyOwnedComponentDescriptor(handle,handle.record);componentCheckOwned(s);
 const expected=s.records.get('expected.bin'),candidate=s.records.get('descriptor.bin'),fingerprint=s.records.get('authority-fingerprint.bin');
 const stores=['descriptor','admission'].map(role=>s.directories.find(d=>d.path===s.base+'/'+role));assert.ok(stores.every(Boolean));
 for(const d of stores)assert.deepEqual(readdirSync(d.path),[],'reservation pristine store');
 s.bridgeStarted=true;const monotonicStart=process.hrtime.bigint();
 const child=spawn(s.binary.path,[],{argv0:'/bridge',cwd:'/',env:{LANG:'C',LC_ALL:'C'},stdio:['ignore','pipe','pipe',expected.fd,candidate.fd,stores[0].fd,stores[1].fd,fingerprint.fd,'pipe']});
 const channel=child.stdio[8],state={child,channel,s,handle,events:[],stdout:[],stderr:[],bytes:0,failure:null,closed:false,pending:false,sequence:0n,challenge:null};
 state.publicationRequest=new Promise(resolve=>{state.requestPublication=resolve;});
 let resolveReady,rejectReady;const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
 const fail=error=>{state.failure??=error.message;channel.destroy();};
 const checkDeadline=stageStart=>{if(!s.uProtocol)return;const now=process.hrtime.bigint();assert.ok(now>=monotonicStart&&now-monotonicStart<1260000000000n,'U owner deadline');if(stageStart!==undefined)assert.ok(now>=stageStart&&now-stageStart<240000000000n,'U challenge deadline');};
 const timer=setTimeout(()=>{fail(new Error(s.uProtocol?'U reservation owner deadline':'R reservation owner deadline'));child.kill('SIGTERM');},s.uProtocol?1261000:11000);
 state.completion=new Promise(resolve=>child.on('close',(status,signal)=>{clearTimeout(timer);state.closed=true;s.bridgeClosed=true;state.requestPublication(false);const result={status,signal,failure:state.failure,events:state.events,stdout:Buffer.concat(state.stdout).toString(),stderr:Buffer.concat(state.stderr).toString(),nativeAcceptance:false,launchAuthority:false};resolve(result);rejectReady(Object.assign(new Error(state.failure??'R bridge closed before reservation'),{diagnostic:result}));}));
 child.on('error',fail);channel.on('error',fail);
 const capture=(target,b)=>{state.bytes+=b.length;if(state.bytes>65536){fail(new Error('R protocol output bound'));return false;}target.push(Buffer.from(b));return true;};
 child.stderr.on('data',b=>capture(state.stderr,b));
 child.stdout.on('data',b=>{if(!capture(state.stdout,b))return;const out=Buffer.concat(state.stdout).toString();if(!'R_RESERVED\nR_PUBLISHED\n'.startsWith(out)){fail(new Error('R unexpected bridge output'));return;}if(!state.ready&&out.startsWith('R_RESERVED\n')){if(state.sequence!==2n){fail(new Error('R premature reservation'));return;}state.ready=true;const owner=Object.freeze({kind:s.uProtocol?'U_PRIVATE_RESERVED_HANDLE':'R_PRIVATE_RESERVED_HANDLE',launchAuthority:false,reviewReady:false});componentReservationHandles.set(owner,state);resolveReady(owner);}});
 let buffer=Buffer.alloc(0),stageReceived;
 channel.on('data',b=>{
  if(state.pending){fail(new Error('RSP1 unsolicited pipelined frame'));return;}
  if(!buffer.length)stageReceived=process.hrtime.bigint();
  buffer=Buffer.concat([buffer,b]);if(buffer.length>208){fail(new Error('RSP1 oversized or trailing frame'));return;}if(buffer.length<208)return;
  const raw=buffer;buffer=Buffer.alloc(0);state.pending=true;
  (async()=>{
   checkDeadline(stageReceived);const frame=decodeRProtocolFrame(raw);assert.equal(frame.direction,1);assert.equal(frame.sequence,state.sequence+1n,'RSP1 order');assert.equal(frame.stage,Number(frame.sequence),'RSP1 publication stage');assert.ok(frame.stage<=5,'RSP1 future stage');assert.notDeepEqual(frame.challenge,state.challenge,'RSP1 fresh challenge');
   for(const [key,value]of Object.entries({invocation:Buffer.from(hash(Buffer.from(handle.record.invocationId)),'hex'),generation:handle.record.domainGeneration,descriptor:Buffer.from(candidate.sha256,'hex'),expected:Buffer.from(expected.sha256,'hex'),authority:Buffer.from(s.authority.authorityFingerprint,'hex')}))assert.deepEqual(frame[key],value,'RSP1 '+key);
   // Withhold stage3's grant until the original private owner requests publication.
   // EOF/abort never becomes a publication command or a grant to a future stage.
   if(frame.stage===3&&!await state.publicationRequest){state.pending=false;return;}
   if(frame.stage>=3)assert.ok(state.publishRequested&&!state.abortRequested,'R publication consumed');
   checkDeadline(stageReceived);const authStarted=process.hrtime.bigint();
   await verifyOwnedComponentDescriptor(handle,handle.record);checkDeadline(stageReceived);componentCheckOwned(s);assert.ok(!state.closed&&!state.failure,'RSP1 owner lost during await');
   const reply=Buffer.from(raw);reply[5]=2;state.sequence=frame.sequence;state.challenge=frame.challenge;state.events.push({stage:frame.stage,sequence:Number(frame.sequence),challenge:frame.challenge.toString('hex'),authorityFingerprint:s.authority.authorityFingerprint,...(s.uProtocol?{ownerElapsedMs:Number(process.hrtime.bigint()-monotonicStart)/1e6,stageElapsedMs:Number(process.hrtime.bigint()-stageReceived)/1e6,authenticationMs:Number(process.hrtime.bigint()-authStarted)/1e6}:{} )});
   // Write one exact response, then permit the next C-issued challenge.
   checkDeadline(stageReceived);state.pending=false;channel.write(reply,error=>{if(error)fail(error);});
  })().catch(fail);
 });
 channel.on('end',()=>{if(buffer.length)fail(new Error('RSP1 truncated frame'));});
 try{return await ready;}catch(error){error.diagnostic=await state.completion;throw error;}
}
async function abortOwnedComponentReservation(owner){
 assert.equal(arguments.length,1,'reservation abort arguments');const state=componentReservationHandles.get(owner);assert.ok(state,'retained reservation handle');assert.ok(!state.abortRequested&&!state.publishRequested,'reservation abort one use');state.abortRequested=true;state.requestPublication(false);state.channel.end();
 const result=await state.completion;componentCheckOwned(state.s);return result;
}
async function publishOwnedComponentReservation(owner){
 assert.equal(arguments.length,1,'publication arguments');const state=componentReservationHandles.get(owner);assert.ok(state,'retained reservation handle');
 assert.ok(!state.publishRequested&&!state.abortRequested&&!state.closed,'publication one use');
 state.publishRequested=true;state.requestPublication(true);
 const result=await state.completion;
 // Preserve failure diagnostics even when retained sources were the rejected mutation.
 // A result never grants product/native acceptance or permits a second publication.
 if(result.status===0){try{await verifyOwnedComponentDescriptor(state.handle,state.handle.record);componentCheckOwned(state.s);assert.equal(result.failure,null);assert.equal(result.stdout,'R_RESERVED\nR_PUBLISHED\n');assert.deepEqual(result.events.map(x=>x.stage),[1,2,3,4,5]);}catch(error){error.diagnostic=result;throw error;}}
 return result;
}
// End private owned source acquisition.


// Q component immutable record graph. This module-private reader deliberately
// grants no readiness: execution/scope/occurrence authentication must be joined
// by the dedicated consumer before any live dispatch is enabled.
function readComponentEvidenceGraph(root,runSlug){return readComponentRecordGraph(root,runSlug,false);}
function readRComponentEvidenceGraph(root,runSlug){return readComponentRecordGraph(root,runSlug,true);}
function readComponentRecordGraph(root,runSlug,continuation,ownedLockFd=null){
 root=resolve(root);assert.match(runSlug,/^[A-Za-z0-9_-]+$/,'component graph run');
 const schemaVersion=continuation?2:1,purpose=continuation?'R_COMPONENT_IMPLEMENTATION_REVIEW':'Q_COMPONENT_IMPLEMENTATION_REVIEW',base=`evidence/enterprise/component-development/${runSlug}/review-evidence`,seen=new Map(),listings=new Map();
 const exact=(v,keys,label)=>{assert.ok(v&&typeof v==='object'&&!Array.isArray(v),'component graph '+label);assert.deepEqual(Object.keys(v).sort(),[...keys].sort(),'component graph '+label+' fields');};
 const digest=(v,label)=>assert.match(v,/^[a-f0-9]{64}$/,'component graph '+label);
 const positive=(v,label)=>assert.ok(Number.isSafeInteger(v)&&v>0,'component graph '+label);
 const pathOf=path=>{assert.equal(typeof path,'string','component graph path');assert.ok((path===base||path.startsWith(base+'/'))&&!path.includes('\\'),'component graph namespace');const absolute=confined(root,path);assert.equal(relative(root,absolute),path,'component graph canonical path');return absolute;};
 const raw=path=>{const absolute=pathOf(path),s=lstatSync(absolute);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1,'component graph regular unique file');const b=readFileSync(absolute),r={path,sha256:hash(b),bytes:b.length};assert.equal(s.size,b.length,'component graph size');const identity={dev:s.dev,ino:s.ino,mode:s.mode};if(seen.has(path)){assert.deepEqual(seen.get(path).reference,r,'component graph changed bytes');assert.deepEqual(seen.get(path).identity,identity,'component graph changed identity');}else seen.set(path,{reference:r,identity});return b;};
 const listing=path=>{const absolute=pathOf(path),s=lstatSync(absolute);assert.ok(s.isDirectory(),'component graph directory type');const record={names:readdirSync(absolute).sort(),dev:s.dev,ino:s.ino,mode:s.mode};if(listings.has(path))assert.deepEqual(record,listings.get(path),'component graph changed directory');else listings.set(path,record);return record.names;};
 const reference=r=>{exact(r,['path','sha256','bytes'],'reference');digest(r.sha256,'reference hash');assert.ok(Number.isSafeInteger(r.bytes)&&r.bytes>=0,'component graph reference length');const b=raw(r.path);assert.equal(hash(b),r.sha256,'component graph reference hash mismatch');assert.equal(b.length,r.bytes,'component graph reference byte mismatch');return b;};
 const json=r=>strictPreparationJSON(reference(r));
 const named=(r,path)=>{assert.equal(r?.path,path,'component graph record path');return json(r);};
 const header=v=>{assert.equal(v.schemaVersion,schemaVersion,'component graph schema');assert.equal(v.purpose,purpose,'component graph purpose');};
 const identity=v=>{exact(v,['runSlug','workflowRef','bundleDigest','builderIteration','builderSessionId'],'identity');assert.equal(v.runSlug,runSlug,'component graph identity run');digest(v.bundleDigest,'bundle');positive(v.builderIteration,'builder iteration');for(const key of ['workflowRef','builderSessionId'])assert.ok(typeof v[key]==='string'&&v[key].length>0,'component graph '+key);};
 const markers=()=>{for(const name of ['writer.lock','intent.json']){const p=base+'/'+name;if(name==='writer.lock'&&ownedLockFd!==null){const st=lstatSync(pathOf(p)),owned=fstatSync(ownedLockFd);assert.equal(st.dev,owned.dev,'component graph owned lock');assert.equal(st.ino,owned.ino,'component graph owned lock');raw(p);}else assert.ok(!existsSync(pathOf(p)),'component graph incomplete marker '+name);}};
 markers();const journal=strictPreparationJSON(raw(base+'/journal.json'));exact(journal,['schemaVersion','purpose','events'],'journal');header(journal);assert.ok(Array.isArray(journal.events)&&journal.events.length>0,'component graph empty history');
 let head='0'.repeat(64),sequence=0,latest;
 const directories=[];
 for(let i=0;i<journal.events.length;i+=2){
  const begin=journal.events[i];exact(begin,['sequence','status','start','priorHead'],'start event');assert.equal(begin.status,'STARTED','component graph start status');positive(begin.sequence,'sequence');assert.equal(begin.sequence,++sequence,'component graph sequence gap');assert.equal(begin.priorHead,head,'component graph history branch');
  const dir=base+'/invocations/'+sequence;directories.push(String(sequence));
  const start=named(begin.start,dir+'/start.json');exact(start,['schemaVersion','purpose','identity','sequence','priorHistoryHead','scope','designReport','plan','inputsBefore','command'],'start');header(start);identity(start.identity);assert.equal(start.sequence,sequence,'component graph start sequence');assert.equal(start.priorHistoryHead,head,'component graph start history');
  for(const [key,name]of [['scope','scope.json'],['designReport','design.md'],['plan','plan.json'],['inputsBefore','inputs-before.json']]){assert.equal(start[key]?.path,dir+'/'+name,'component graph start '+key+' path');reference(start[key]);}
  assert.ok(Array.isArray(start.command)&&start.command.length>0&&start.command.every(x=>typeof x==='string'&&x.length>0),'component graph command');
  const end=journal.events[i+1];assert.ok(end,'component graph latest STARTED');exact(end,['sequence','status','start','terminal','head'],'terminal event');assert.equal(end.sequence,sequence,'component graph terminal sequence');assert.ok(['PASSED','FAILED'].includes(end.status),'component graph terminal status');assert.deepEqual(end.start,begin.start,'component graph terminal start');
  const terminal=named(end.terminal,dir+'/terminal.json');exact(terminal,['schemaVersion','purpose','sequence','start','previousHead','status','receipt','diagnostic','outputInventory'],'terminal');header(terminal);assert.equal(terminal.sequence,sequence,'component graph terminal sequence');assert.deepEqual(terminal.start,begin.start,'component graph terminal descriptor');assert.equal(terminal.previousHead,head,'component graph terminal previous head');assert.equal(terminal.status,end.status,'component graph status mismatch');
  const inventory=named(terminal.outputInventory,dir+'/output-inventory.json');exact(inventory,['schemaVersion','purpose','entries','digest'],'inventory');header(inventory);assert.ok(Array.isArray(inventory.entries)&&inventory.entries.length>0,'component graph empty inventory');
  const outputPaths=inventory.entries.map(r=>r.path);assert.equal(new Set(outputPaths).size,outputPaths.length,'component graph duplicate output');assert.deepEqual(outputPaths,[...outputPaths].sort((a,b)=>a.localeCompare(b,'en')),'component graph inventory order');assert.equal(inventory.digest,hash(JSON.stringify(inventory.entries)),'component graph inventory digest');
  for(const r of inventory.entries){assert.ok(r.path.startsWith(dir+'/outputs/'),'component graph output namespace');reference(r);}
  const files=[];const visit=path=>{for(const name of listing(path)){const p=path+'/'+name,s=lstatSync(pathOf(p));assert.ok(!s.isSymbolicLink(),'component graph output symlink');if(s.isDirectory())visit(p);else{assert.ok(s.isFile(),'component graph output type');files.push(p);}}};visit(dir+'/outputs');assert.deepEqual(files.sort((a,b)=>a.localeCompare(b,'en')),outputPaths,'component graph unexplained output');
  const inventoried=r=>{reference(r);assert.deepEqual(inventory.entries.find(e=>e.path===r.path),r,'component graph missing output reference');};
  let receipt=null;
  if(end.status==='PASSED'){
   assert.equal(terminal.diagnostic,null,'component graph passed diagnostic');receipt=named(terminal.receipt,dir+'/receipt.json');
   exact(receipt,['schemaVersion','kind','purpose','identity','scope','designReport','plan','inputsBefore','inputsAfter','inputsDigest','command','execution','stdout','stderr','outputInventory','outputsDigest','priorHistoryHead','start','result','productVerified','nativeAccepted'],'receipt');header(receipt);assert.equal(receipt.kind,continuation?'R_COMPONENT_EVIDENCE':'Q_COMPONENT_EVIDENCE','component graph receipt kind');assert.equal(receipt.result,'PASSED','component graph receipt result');assert.equal(receipt.productVerified,false,'component graph product authority');assert.equal(receipt.nativeAccepted,false,'component graph native authority');
   for(const key of ['identity','scope','designReport','plan','inputsBefore','command'])assert.deepEqual(receipt[key],start[key],'component graph receipt '+key);digest(receipt.inputsDigest,'inputs digest');assert.equal(receipt.priorHistoryHead,head,'component graph receipt history');assert.deepEqual(receipt.start,begin.start,'component graph receipt start');
   assert.equal(receipt.inputsAfter?.path,dir+'/inputs-after.json','component graph inputsAfter path');reference(receipt.inputsAfter);assert.deepEqual(receipt.outputInventory,terminal.outputInventory,'component graph receipt inventory');assert.equal(receipt.outputsDigest,inventory.digest,'component graph outputs digest');
   for(const [key,name]of [['execution','execution.json'],['stdout','stdout.tap'],['stderr','stderr.log']]){assert.equal(receipt[key]?.path,dir+'/outputs/'+name,'component graph '+key+' path');inventoried(receipt[key]);}
  }else{
   assert.equal(terminal.receipt,null,'component graph failed receipt');assert.ok(terminal.diagnostic,'component graph failed diagnostic missing');inventoried(terminal.diagnostic);
  }
  if(continuation){
   // Every immutable metadata file has a typed edge, including failures and
   // historical journal prefixes. No extension/filename exemption is allowed.
   if(end.status==='FAILED'){
    const failure=json(terminal.diagnostic);exact(failure,['schemaVersion','purpose','message','spawnAttempted','execution','inputsAfter'],'failure');header(failure);
    assert.ok(typeof failure.message==='string'&&failure.message.length>0,'component graph failure cause');assert.equal(typeof failure.spawnAttempted,'boolean','component graph spawn state');
    named(failure.inputsAfter,dir+'/inputs-after.json');
    if(failure.spawnAttempted){assert.ok(failure.execution,'component graph attempted spawn missing execution');inventoried(failure.execution);}else assert.equal(failure.execution,null,'component graph unspawned execution');
   }
   if(existsSync(pathOf(dir+'/journal-prefix.json'))){const old=strictPreparationJSON(raw(dir+'/journal-prefix.json'));assert.deepEqual(old,{schemaVersion,purpose,events:journal.events.slice(0,i+2)},'component graph historical prefix');}
  }
  const next=hash(JSON.stringify({previousHead:head,sequence,start:begin.start,terminal:end.terminal}));assert.equal(end.head,next,'component graph terminal head');head=next;latest={begin,end,terminal,receipt,dir};
 }
 assert.deepEqual(listing(base+'/invocations'),directories.sort(),'component graph unexplained invocation');
 assert.equal(latest.end.status,'PASSED','component graph latest FAILED');
 const request=strictPreparationJSON(raw(base+'/request.json'));exact(request,['schemaVersion','purpose','identity','scope','designReport','receipt','inputsDigest','historyBinding','productVerified'],'request');header(request);identity(request.identity);assert.equal(request.productVerified,false,'component graph request authority');
 for(const key of ['identity','scope','designReport','inputsDigest'])assert.deepEqual(request[key],latest.receipt[key],'component graph request '+key);assert.deepEqual(request.receipt,latest.terminal.receipt,'component graph latest receipt');reference(request.receipt);
 const binding=request.historyBinding;exact(binding,['journalPrefix','head','sequence','start','terminal'],'history binding');assert.equal(binding.sequence,sequence,'component graph stale request sequence');assert.equal(binding.head,head,'component graph request head');assert.deepEqual(binding.start,latest.begin.start,'component graph request start');assert.deepEqual(binding.terminal,latest.end.terminal,'component graph request terminal');
 const prefix=named(binding.journalPrefix,latest.dir+'/journal-prefix.json');assert.deepEqual(prefix,journal,'component graph request prefix');
 if(continuation){
  const all=[];const closed=path=>{for(const name of listing(path)){const p=path+'/'+name,s=lstatSync(pathOf(p));assert.ok(!s.isSymbolicLink(),'component graph metadata symlink');if(s.isDirectory()){assert.ok(p===base+'/invocations'||directories.some(n=>p===base+'/invocations/'+n||p.startsWith(base+'/invocations/'+n+'/outputs')),'component graph unexpected directory');closed(p);}else{assert.ok(s.isFile(),'component graph metadata type');all.push(p);}}};
  closed(base);assert.deepEqual(all.sort(),[...seen.keys()].sort(),'component graph unreferenced immutable metadata');
 }
 // No awaits or writes here. Callers must reauthenticate authority and rerun
 // this reader after their awaits; retained hashes are not a trust token.
 for(const path of [...seen.keys()])raw(path);for(const path of [...listings.keys()])listing(path);markers();
 return {schemaVersion,kind:continuation?'R_COMPONENT_RECORD_GRAPH':'Q_COMPONENT_RECORD_GRAPH',runSlug,sequence,historyHead:head,request:{path:base+'/request.json',...seen.get(base+'/request.json').reference},references:[...seen.values()].map(x=>x.reference),reviewReady:false,productVerified:false,nativeAccepted:false};
}

// Q component execution consistency. This private layer validates saved
// metadata against current inputs, not provenance or the complete review scope.
function readComponentEvidenceExecution(root,runSlug){return readComponentRecordExecution(root,runSlug,false);}
function readRComponentEvidenceExecution(root,runSlug){return readComponentRecordExecution(root,runSlug,true);}
function readComponentRecordExecution(root,runSlug,continuation){
 root=resolve(root);assert.ok(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'component execution Node environment override');
 const graphReader=continuation?readRComponentEvidenceGraph:readComponentEvidenceGraph,graph=graphReader(root,runSlug),current=inputs(root),seen=new Map();
 const raw=r=>{assert.deepEqual(graph.references.find(x=>x.path===r.path),r,'component execution unverified reference');const path=confined(root,r.path),s=lstatSync(path);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1,'component execution regular file');const b=readFileSync(path);assert.equal(hash(b),r.sha256,'component execution changed bytes');assert.equal(b.length,r.bytes,'component execution changed length');const identity={dev:s.dev,ino:s.ino,mode:s.mode};if(seen.has(r.path))assert.deepEqual(identity,seen.get(r.path).identity,'component execution changed identity');else seen.set(r.path,{reference:r,identity});return b;};
 const json=r=>strictPreparationJSON(raw(r)),request=json(graph.request),receipt=json(request.receipt);
 assert.deepEqual(json(receipt.inputsBefore),current,'component execution stale before inputs');assert.deepEqual(json(receipt.inputsAfter),current,'component execution stale after inputs');assert.equal(receipt.inputsDigest,current.digest,'component execution receipt inputs digest');
 assert.deepEqual(raw(receipt.plan),readFileSync(confined(root,'work/enterprise/plan.json')),'component execution saved plan');
 const plan=json(receipt.plan);assert.deepEqual((continuation?plan.componentContinuation:plan.preparationRestart)?.regressionCommand,componentRegressionCommand,'component execution plan command');assert.deepEqual(receipt.command,componentRegressionCommand,'component execution receipt command');
 const execution=json(receipt.execution);
 assert.deepEqual(Object.keys(execution).sort(),['schemaVersion','invocation','startedAt','finishedAt','status','signal','error','interrupted','requestedArgv','actualArgv','inputsDigest','outputs'].sort(),'component execution fields');
 assert.equal(execution.schemaVersion,1,'component execution schema');assert.match(execution.invocation,/^invocation-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,'component execution invocation');
 for(const key of ['startedAt','finishedAt']){const value=execution[key];assert.ok(typeof value==='string'&&Number.isFinite(Date.parse(value)),'component execution time');assert.equal(new Date(value).toISOString(),value,'component execution canonical time');}
 assert.ok(execution.finishedAt>=execution.startedAt,'component execution time order');assert.equal(execution.status,0,'component execution exit');for(const key of ['signal','error','interrupted'])assert.equal(execution[key],null,'component execution '+key);
 assert.deepEqual(execution.requestedArgv,componentRegressionCommand,'component execution requested argv');assert.deepEqual(execution.actualArgv,[process.execPath,...componentRegressionCommand.slice(4)],'component execution actual argv');assert.equal(execution.inputsDigest,current.digest,'component execution inputs digest');assert.deepEqual(execution.outputs,[receipt.stdout,receipt.stderr],'component execution output references');
 const stdout=raw(receipt.stdout).toString('utf8');raw(receipt.stderr);
 for(const name of ['tests','pass','fail','cancelled','skipped','todo'])assert.equal([...stdout.matchAll(new RegExp('^# '+name+' \\d+$','gm'))].length,1,'component execution unique TAP '+name);
 assert.ok(!/^\s*Bail out!/im.test(stdout),'component execution TAP bailout');const tap=parseTap(stdout);assert.equal(tap.assertions.length,tap.tests,'component execution TAP assertion count');const tapStructure=componentTapStructure(stdout);assert.equal(tapStructure.nodes.length,tap.tests,'component TAP structure total');
 // No saved hashes are capabilities. Re-read the entire history and all current
 // inputs before returning; asynchronous consumers must authenticate and repeat.
 if(continuation){assert.deepEqual(json(receipt.scope),rComponentScope(root,plan,current),'R execution scope differs from pre-execution source');rComponentCoverage(json(receipt.scope),stdout);}
 const history=continuation?readRComponentHistoryExecution(root,runSlug):null;
 for(const value of seen.values())raw(value.reference);assert.deepEqual(graphReader(root,runSlug),graph,'component execution changed graph');assert.deepEqual(inputs(root),current,'component execution changed current inputs');
 return {...(history?{history}:{}),schemaVersion:continuation?2:1,kind:continuation?'R_COMPONENT_EXECUTION_CONSISTENCY':'Q_COMPONENT_EXECUTION_CONSISTENCY',runSlug,sequence:graph.sequence,historyHead:graph.historyHead,request:graph.request,inputsDigest:current.digest,execution:receipt.execution,tap,tapStructure,provenanceAuthenticated:false,reviewReady:false,productVerified:false,nativeAccepted:false};
}

// Revalidate every stored R execution against its own immutable inputs. This
// is history consistency, not authenticated producer provenance or a gate.
function readRComponentHistoryExecution(root,runSlug){
 root=resolve(root);assert.ok(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'R history Node environment override');
 const graph=readRComponentEvidenceGraph(root,runSlug),refs=new Map(graph.references.map(r=>[r.path,r]));
 const raw=p=>{const r=refs.get(p);assert.ok(r,'R history missing reference');const b=bytes(root,p);assert.equal(hash(b),r.sha256,'R history changed reference');assert.equal(b.length,r.bytes,'R history changed length');return b;};
 const json=p=>strictPreparationJSON(raw(p)),base=`evidence/enterprise/component-development/${runSlug}/review-evidence`,journal=json(base+'/journal.json'),invocations=[],ids=new Set();let previousFinish=null;
 const manifest=p=>{const m=json(p);assert.deepEqual(Object.keys(m).sort(),['digest','entries','runtime'],'R history manifest fields');assert.ok(Array.isArray(m.entries)&&m.entries.length,'R history empty inputs');canonicalHistoricalInputs(root,m.entries);assert.equal(new Set(m.entries.map(e=>e.path)).size,m.entries.length,'R history duplicate inputs');for(const e of m.entries){assert.deepEqual(Object.keys(e).sort(),['bytes','path','sha256'],'R history input fields');assert.match(e.sha256,/^[a-f0-9]{64}$/,'R history input hash');assert.ok(Number.isSafeInteger(e.bytes)&&e.bytes>=0,'R history input length');}assert.equal(m.digest,hash(JSON.stringify({entries:m.entries,runtime:m.runtime})),'R history manifest digest');return m;};
 for(let i=0;i<journal.events.length;i+=2){
  const begin=journal.events[i],end=journal.events[i+1],start=json(begin.start.path),terminal=json(end.terminal.path),before=manifest(start.inputsBefore.path),planBytes=raw(start.plan.path),planEntry=before.entries.find(e=>e.path==='work/enterprise/plan.json');
  assert.equal(planEntry?.sha256,hash(planBytes),'R history saved plan input');assert.equal(planEntry?.bytes,planBytes.length,'R history saved plan length');
  const plan=strictPreparationJSON(planBytes);assert.deepEqual(plan.componentContinuation?.regressionCommand,componentRegressionCommand,'R history plan command');assert.deepEqual(start.command,componentRegressionCommand,'R history start command');
  const receipt=end.status==='PASSED'?json(terminal.receipt.path):null,failure=end.status==='FAILED'?json(terminal.diagnostic.path):null;
  const after=manifest((receipt??failure).inputsAfter.path),scope=json(start.scope.path);assert.deepEqual(after,before,'R history completed invocation input drift');
  assert.equal(scope.scopeId,plan.componentContinuation.scope,'R history scope identity');assert.deepEqual(scope.planDefinition,{path:'work/enterprise/plan.json',sha256:hash(planBytes),bytes:planBytes.length},'R history scope plan binding');
  validateRHistoricalScope(scope,plan,before);
  // A pre-spawn failure has no execution to validate. Without the dedicated
  // failure-origin consumer it cannot support a ready history.
  assert.ok(!failure||failure.spawnAttempted,'R history unspawned cause requires provenance');
  const executionRef=receipt?receipt.execution:failure.execution,e=json(executionRef.path);
  assert.deepEqual(Object.keys(e).sort(),['schemaVersion','invocation','startedAt','finishedAt','status','signal','error','interrupted','requestedArgv','actualArgv','inputsDigest','outputs'].sort(),'R history execution fields');assert.equal(e.schemaVersion,1,'R history execution schema');
  assert.match(e.invocation,/^invocation-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,'R history invocation');assert.ok(!ids.has(e.invocation),'R history reused invocation');ids.add(e.invocation);
  for(const k of ['startedAt','finishedAt']){assert.ok(typeof e[k]==='string'&&Number.isFinite(Date.parse(e[k])),'R history execution time');assert.equal(new Date(e[k]).toISOString(),e[k],'R history canonical time');}assert.ok(e.finishedAt>=e.startedAt,'R history reversed time');assert.ok(previousFinish===null||e.startedAt>=previousFinish,'R history overlapping execution');previousFinish=e.finishedAt;
  assert.deepEqual(e.requestedArgv,componentRegressionCommand,'R history requested command');assert.deepEqual(e.actualArgv,[process.execPath,...componentRegressionCommand.slice(4)],'R history actual command');assert.equal(e.inputsDigest,before.digest,'R history execution input digest');
  const dir=base+'/invocations/'+begin.sequence,stdout=refs.get(dir+'/outputs/stdout.tap'),stderr=refs.get(dir+'/outputs/stderr.log');assert.deepEqual(e.outputs,[stdout,stderr],'R history execution outputs');assert.ok(stdout&&stderr,'R history missing output');const tap=raw(stdout.path).toString('utf8');raw(stderr.path);
  assert.ok(e.status===null||(Number.isInteger(e.status)&&e.status>=0&&e.status<=255),'R history status');assert.ok(e.signal===null||typeof e.signal==='string','R history signal');assert.ok(e.interrupted===null||['SIGINT','SIGTERM'].includes(e.interrupted),'R history interruption');assert.ok(!(e.status!==null&&e.signal!==null),'R history exit and signal conflict');
  if(e.error!==null){assert.deepEqual(Object.keys(e.error).sort(),['code','message'],'R history spawn error fields');assert.ok(typeof e.error.message==='string'&&e.error.message.length>0,'R history spawn error message');assert.ok(e.error.code===null||typeof e.error.code==='string','R history spawn error code');}
  let cause=null;
  // Replay the ordered completed-subprocess checks used by the writer. Other
  // storage/stream/authority failures require additional provenance and refuse.
  try{assert.equal(e.interrupted,null,'R writer interrupted');assert.equal(e.error,null,'R writer spawn error');assert.equal(e.signal,null,'R writer signal');assert.equal(e.status,0,'R writer test failure');rComponentCoverage(scope,tap);}catch(error){cause=error.message;}
  if(receipt){assert.equal(cause,null,'R history historical PASS failed execution');assert.deepEqual(after,before,'R history passed input drift');assert.equal(receipt.inputsDigest,before.digest,'R history receipt input digest');}
  else{assert.ok(cause,'R history failure cause not reproduced');assert.equal(failure.message,cause,'R history failure cause mismatch');}
  invocations.push({sequence:begin.sequence,status:end.status,identity:start.identity,inputDigest:before.digest,afterDigest:after.digest,execution:executionRef,reproducedCause:cause});
 }
 assert.deepEqual(readRComponentEvidenceGraph(root,runSlug),graph,'R history graph changed');
 return {kind:'R_COMPONENT_HISTORY_EXECUTION_CONSISTENCY',invocations,provenanceAuthenticated:false,reviewReady:false};
}

// Bind stored scope structure to its own stored manifest and plan. Authentic
// source preimages, test meaning and historical producer authority are separate
// mandatory consumers; these hash/structure checks cannot grant readiness.
function validateRHistoricalScope(scope,plan,manifest){
 const exact=(v,keys)=>assert.deepEqual(Object.keys(v).sort(),keys.sort(),'R history scope fields');
 exact(scope,['schemaVersion','scopeId','planDefinition','contracts','caseIds','caseBindings','regressionCommand','residualBlockers']);assert.equal(scope.schemaVersion,1,'R history scope schema');
 const p=plan.componentContinuation;assert.equal(p.recordSchemaVersion,2,'R history scope record schema');assert.equal(p.recordPurpose,'R_COMPONENT_IMPLEMENTATION_REVIEW','R history scope purpose');
 const reference=path=>{const r=manifest.entries.find(e=>e.path===path);assert.ok(r,'R history scope missing input');return r;};
 assert.deepEqual(scope.contracts,[reference(p.contract),reference('work/enterprise/PREPARATION_COMPONENT_REVIEW.md')],'R history scope contracts');
 assert.deepEqual(scope.regressionCommand,componentRegressionCommand,'R history scope command');assert.deepEqual(scope.caseIds,Object.keys(p.caseConditions),'R history scope cases');
 assert.deepEqual(scope.residualBlockers,['I1b','I2','I3','native303','residual29','completeH','P7','productAcceptance'],'R history scope residual obligations');
 const conditions=Object.entries(p.caseConditions).flatMap(([caseId,keys])=>keys.map(conditionKey=>({caseId,conditionKey})));assert.equal(conditions.length,85,'R history scope registry');assert.equal(scope.caseBindings.length,conditions.length,'R history scope condition count');
 for(const [i,row]of scope.caseBindings.entries()){
  exact(row,['caseId','conditionKey','variants']);assert.deepEqual({caseId:row.caseId,conditionKey:row.conditionKey},conditions[i],'R history scope condition order');assert.ok(Array.isArray(row.variants)&&row.variants.length,'R history scope empty variants');const ids=new Set(),paths=new Set();
  for(const v of row.variants){
   exact(v,['variantId','source','testPath','expectedBoundary','oracle']);assert.deepEqual(v.source,reference('tests/enterprise/rejected-regeneration.test.mjs'),'R history scope source');
   for(const k of ['variantId','expectedBoundary','oracle'])assert.ok(typeof v[k]==='string'&&v[k].trim()===v[k]&&v[k].length>0&&!/[\r\n*]/.test(v[k]),'R history scope concrete '+k);
   assert.ok(!ids.has(v.variantId),'R history scope duplicate variant');ids.add(v.variantId);assert.ok(Array.isArray(v.testPath)&&v.testPath.length>=2,'R history scope child path');
   for(const part of v.testPath){exact(part,['ordinal','name']);assert.ok(Number.isSafeInteger(part.ordinal)&&part.ordinal>0,'R history scope ordinal');assert.ok(typeof part.name==='string'&&part.name.length>0&&!/[\r\n]/.test(part.name),'R history scope name');}
   const key=JSON.stringify(v.testPath);assert.ok(!paths.has(key),'R history scope collapsed variants');paths.add(key);
  }
 }
}

// Parse only the successful, complete hierarchical Node TAP emitted by the
// fixed regression command. Names are not identities: retain ordinal paths and
// repeated names. This proves structure, never required-case coverage/provenance.
function componentTapStructure(stdout){
 const root={indent:-4,path:[],children:[],plan:null},stack=[root],nodes=[];
 let version=false,diagnostic=null,last=null;
 const require=(ok,message)=>assert.ok(ok,'component TAP structure '+message);
 const integer=text=>{require(/^(0|[1-9][0-9]*)$/.test(text),'canonical number');const n=Number(text);require(Number.isSafeInteger(n),'safe number');return n;};
 for(const [offset,line]of stdout.split(/\r?\n/).entries()){
  if(!line.trim())continue;
  require(!line.includes('\t'),'tabs');
  const indent=line.length-line.trimStart().length,text=line.slice(indent),top=stack.at(-1);
  if(diagnostic){
   require(indent===diagnostic.indent,'diagnostic indentation');
   if(text==='...'){diagnostic=null;continue;}
   const field=text.match(/^(duration_ms|type): (.+)$/);require(field,'diagnostic field');require(!diagnostic.fields.has(field[1]),'duplicate diagnostic field');diagnostic.fields.add(field[1]);
   if(field[1]==='duration_ms')require(/^[0-9]+(?:\.[0-9]+)?$/.test(field[2])&&Number.isFinite(Number(field[2])),'duration');
   else require(["'test'","'suite'"].includes(field[2]),'test type');
   continue;
  }
  if(text==='TAP version 13'){require(!version&&offset===0&&indent===0,'version');version=true;continue;}
  require(version,'missing version');
  if(text==='---'){require(last&&!last.diagnostic&&indent===last.indent+2,'diagnostic owner');last.diagnostic=true;diagnostic={indent,fields:new Set()};continue;}
  let match=text.match(/^# Subtest: (.+)$/);
  if(match){
   require(indent===top.indent+4&&top.plan===null,'subtest depth or closed plan');
   const name=match[1],path=[...top.path,top.children.length+1];stack.push({indent,name,path,children:[],plan:null});last=null;continue;
  }
  match=text.match(/^ok ([0-9]+) - (.+)$/);
  if(match){
   require(stack.length>1&&indent===top.indent,'result without matching header');
   const parent=stack.at(-2);require(integer(match[1])===parent.children.length+1,'result ordinal');require(match[2]===top.name,'result name');
   require(top.children.length===0?top.plan===null:top.plan===top.children.length,'missing child plan');
   const node={name:top.name,path:top.path,childCount:top.children.length};nodes.push(node);stack.pop();parent.children.push(node);last={indent,diagnostic:false};continue;
  }
  match=text.match(/^1\.\.([0-9]+)$/);
  if(match){require(indent===top.indent+4&&top.plan===null,'plan depth or duplicate');const n=integer(match[1]);require(n>0&&n===top.children.length,'plan count');top.plan=n;last=null;continue;}
  match=text.match(/^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) (.+)$/);
  if(match){require(top===root&&root.plan!==null&&indent===0,'summary before root plan');last=null;continue;}
  // Ordinary test diagnostic comments carry no execution authority. Reserved
  // TAP syntax and indented summary-looking lines cannot be hidden as comments.
  if(text.startsWith('# ')){require(indent===top.indent+4,'comment depth');continue;}
  require(false,'unexpected line '+(offset+1));
 }
 require(version&&!diagnostic&&stack.length===1&&root.plan!==null,'incomplete stream');
 return {schemaVersion:1,rootCount:root.children.length,nodes};
}

// R evidence construction is private. The test-source binding table is fixed
// before STARTED, never inferred from passing output or accepted from a caller.
// Private U storage primitive. Only isolated fixtures currently construct its
// owners: live activation still requires the complete U scope, historical
// provenance and T engine. A closed transaction is NOT a review candidate.
const uInvocationOwners=new WeakMap();
const uTransactionPurpose='SUCCESSOR_COMPONENT_IMPLEMENTATION_REVIEW';
function uTransactionFiles(root,base){
 const files=[],directories=[],identities=[],identity=st=>({dev:st.dev,ino:st.ino,mode:st.mode});
 const walk=p=>{const absolute=confined(root,p),st=lstatSync(absolute);assert.ok(st.isDirectory()&&!st.isSymbolicLink(),'U transaction directory');directories.push(p);identities.push({path:p,identity:identity(st)});
  for(const name of readdirSync(absolute).sort()){const q=p+'/'+name,s=lstatSync(confined(root,q));assert.ok(!s.isSymbolicLink(),'U transaction symlink');if(s.isDirectory())walk(q);else{assert.ok(s.isFile(),'U transaction regular file');const b=bytes(root,q);assert.deepEqual(identity(lstatSync(confined(root,q))),identity(s),'U transaction snapshot identity');files.push({path:q,sha256:hash(b),bytes:b.length});identities.push({path:q,identity:identity(s)});}}
 };walk(base);return {files,directories,identities};
}
function readUInvocationHistory(root,base,ownedLock=null){
 const exact=(x,keys)=>assert.deepEqual(Object.keys(x).sort(),[...keys].sort(),'U history fields');
 const references=new Map(),get=r=>{exact(r,['path','sha256','bytes']);assert.ok(r.path.startsWith(base+'/'),'U history reference scope');const b=bytes(root,r.path);assert.equal(hash(b),r.sha256,'U history reference hash');assert.equal(b.length,r.bytes,'U history reference length');references.set(r.path,r);return strictPreparationJSON(b);};
 if(ownedLock===null)assert.ok(!existsSync(confined(root,base+'/writer.lock')),'U history active or unresolved writer');
 else{const a=lstatSync(confined(root,base+'/writer.lock')),b=fstatSync(ownedLock);assert.ok(a.isFile()&&!a.isSymbolicLink()&&a.dev===b.dev&&a.ino===b.ino,'U history owned lock');}
 const raw=bytes(root,base+'/journal.json'),journal=strictPreparationJSON(raw);exact(journal,['schemaVersion','purpose','events']);assert.equal(journal.schemaVersion,3,'U history schema');assert.equal(journal.purpose,uTransactionPurpose,'U history purpose');assert.ok(Array.isArray(journal.events)&&journal.events.length>0&&journal.events.length%2===0,'U history unfinished STARTED');
 references.set(base+'/journal.json',{path:base+'/journal.json',sha256:hash(raw),bytes:raw.length});
 let head='0'.repeat(64);const invocations=[],directories=[base,base+'/invocations'];
 for(let i=0;i<journal.events.length;i+=2){
  const first=journal.events[i],last=journal.events[i+1],sequence=i/2+1,dir=base+'/invocations/'+sequence;directories.push(dir,dir+'/outputs');
  exact(first,['sequence','status','start','priorHead']);exact(last,['sequence','status','start','terminal','head']);assert.equal(first.sequence,sequence,'U history sequence');assert.equal(last.sequence,sequence,'U history sequence');assert.equal(first.status,'STARTED','U history start event');assert.equal(first.priorHead,head,'U history prior head');assert.deepEqual(last.start,first.start,'U history event start');assert.equal(first.start.path,dir+'/start.json','U history start path');assert.equal(last.terminal.path,dir+'/terminal.json','U history terminal path');
  const start=get(first.start);exact(start,['schemaVersion','purpose','sequence','priorHead','binding','command']);assert.equal(start.schemaVersion,3);assert.equal(start.purpose,uTransactionPurpose);assert.equal(start.sequence,sequence);assert.equal(start.priorHead,head);assert.deepEqual(start.command,componentRegressionCommand,'U history fixed command');assert.equal(start.binding.path,dir+'/binding.json');const binding=get(start.binding);
  exact(binding,['identity','inputs','scope']);assert.equal(binding.scope.scopeId,'U-I1a-v1','U history scope');
  const terminal=get(last.terminal);exact(terminal,['schemaVersion','purpose','sequence','start','previousHead','status','cause','execution','inventory']);assert.equal(terminal.schemaVersion,3);assert.equal(terminal.purpose,uTransactionPurpose);assert.equal(terminal.sequence,sequence);assert.deepEqual(terminal.start,first.start);assert.equal(terminal.previousHead,head);assert.equal(last.status,terminal.status);assert.ok(['PASSED','FAILED'].includes(terminal.status),'U history terminal status');
  assert.equal(terminal.inventory.path,dir+'/inventory.json');const inventory=get(terminal.inventory);exact(inventory,['entries','digest']);assert.equal(inventory.digest,hash(JSON.stringify(inventory.entries)),'U history inventory digest');
  let execution=null;
  if(terminal.execution!==null){assert.equal(terminal.execution.path,dir+'/outputs/execution.json');execution=get(terminal.execution);exact(execution,['actualArgv','status','signal','error','startedAt','finishedAt','stdout','stderr','streamsClosed']);assert.deepEqual(execution.actualArgv,[binding.identity.node,...componentRegressionCommand.slice(4)],'U history actual command');assert.ok(Number.isFinite(Date.parse(execution.startedAt))&&Date.parse(execution.finishedAt)>=Date.parse(execution.startedAt),'U history execution time');assert.equal(execution.streamsClosed,true,'U history output completion');assert.ok(execution.status===null||(Number.isInteger(execution.status)&&execution.status>=0),'U history exit');assert.ok(execution.signal===null||/^SIG[A-Z0-9]+$/.test(execution.signal),'U history signal');assert.ok(execution.status===null||execution.signal===null,'U history exit signal conflict');
   for(const [key,name]of [['stdout','stdout.tap'],['stderr','stderr.log']]){const ref=execution[key];exact(ref,['path','sha256','bytes']);assert.equal(ref.path,dir+'/outputs/'+name);const b=bytes(root,ref.path);assert.equal(hash(b),ref.sha256,'U history output hash');assert.equal(b.length,ref.bytes);references.set(ref.path,ref);}
  }
  const expected=execution?[terminal.execution,execution.stderr,execution.stdout].sort((a,b)=>a.path.localeCompare(b.path,'en')):[];assert.deepEqual(inventory.entries,expected,'U history closed outputs');
  if(terminal.status==='PASSED'){assert.equal(terminal.cause,null);assert.ok(execution,'U history PASS execution');assert.equal(execution.status,0,'U history PASS exit');assert.equal(execution.signal,null);assert.equal(execution.error,null);rComponentCoverage(binding.scope,bytes(root,execution.stdout.path).toString());}
  else{exact(terminal.cause,['stage','message']);assert.ok(['PRE_SPAWN','SPAWN','PROCESS_EXIT_OR_SIGNAL','STDOUT_OR_STDERR','PERSISTENCE_OR_READBACK','INPUT_OR_AUTHORITY_DRIFT','CLOSURE_OR_PUBLICATION'].includes(terminal.cause.stage),'U history failure stage');assert.ok(typeof terminal.cause.message==='string'&&terminal.cause.message.length>0);if(terminal.cause.stage==='PRE_SPAWN')assert.equal(execution,null,'U history pre-spawn has no execution');}
  head=hash(JSON.stringify({previousHead:head,sequence,start:first.start,terminal:last.terminal}));assert.equal(last.head,head,'U history terminal head');invocations.push({sequence,status:terminal.status,binding,cause:terminal.cause});
 }
 const actual=uTransactionFiles(root,base);if(ownedLock!==null){actual.files=actual.files.filter(r=>r.path!==base+'/writer.lock');actual.identities=actual.identities.filter(r=>r.path!==base+'/writer.lock');}assert.deepEqual(actual.files,[...references.values()].sort((a,b)=>a.path.localeCompare(b.path,'en')),'U history unreferenced or missing file');assert.deepEqual(actual.directories.sort(),directories.sort(),'U history unexpected directory');
 return {schemaVersion:3,kind:'U_COMPONENT_TRANSACTION_DIAGNOSTIC',head,sequence:invocations.length,journal,invocations,files:actual.files,identities:actual.identities,provenanceAuthenticated:false,reviewReady:false,productVerified:false};
}
async function writeUComponentInvocation(owner){
 assert.equal(arguments.length,1,'U transaction arguments');const s=uInvocationOwners.get(owner);assert.ok(s&&!s.used,'U transaction private one-use owner');s.used=true;
 const {root,base,binding,authenticate}=s,lock=base+'/writer.lock',pins=new Map(),dirs=new Map(),streams=new Map(),meters=new Map();let lockFd=null,journalRaw=null,journal={schemaVersion:3,purpose:uTransactionPurpose,events:[]},head='0'.repeat(64),sequence=1,dir,start,execution=null,stage='PRE_SPAWN',primary=null,reported=null;
 const identity=st=>({dev:st.dev,ino:st.ino,mode:st.mode}),path=p=>confined(root,p),ref=p=>{const b=bytes(root,p);return {path:p,sha256:hash(b),bytes:b.length};};
 const pin=(p,expected=null,expectedIdentity=null)=>{const id=identity(lstatSync(path(p))),reference=ref(p);assert.deepEqual(identity(lstatSync(path(p))),id,'U transaction pin identity');if(expected!==null)assert.deepEqual(reference,expected,'U transaction pin reference');if(expectedIdentity!==null)assert.deepEqual(id,expectedIdentity,'U transaction pin identity');pins.set(p,{identity:id,reference});};
 const check=()=>{for(const [p,id]of dirs)assert.deepEqual(identity(lstatSync(path(p))),id,'U transaction directory identity');for(const [p,v]of pins){assert.deepEqual(identity(lstatSync(path(p))),v.identity,'U transaction file identity');assert.deepEqual(ref(p),v.reference,'U transaction changed bytes');}for(const [p,fd]of streams)assert.deepEqual(identity(lstatSync(path(p))),identity(fstatSync(fd)),'U transaction stream identity');if(lockFd!==null)assert.deepEqual(identity(lstatSync(path(lock))),identity(fstatSync(lockFd)),'U transaction lock identity');if(dirs.has(base)){const actual=uTransactionFiles(root,base);assert.deepEqual(actual.files.map(x=>x.path).sort(),[...pins.keys(),...streams.keys()].sort(),'U transaction unreferenced file');assert.deepEqual(actual.directories.sort(),[...dirs.keys()].filter(p=>p===base||p.startsWith(base+'/')).sort(),'U transaction unexpected directory');}};
 const verify=async()=>{check();await authenticate();check();};
 const mkdir=p=>{check();mkdirSync(path(p),{mode:0o700});dirs.set(p,identity(lstatSync(path(p))));prepSyncDir(dirname(path(p)));};
 const save=(p,value)=>{check();const raw=Buffer.from(JSON.stringify(value,null,2)+'\n'),fd=openSync(path(p),'wx',0o600),id=identity(fstatSync(fd));try{writeFileSync(fd,raw);fsyncSync(fd);assert.deepEqual(bytes(root,p),raw,'U transaction readback');assert.deepEqual(identity(lstatSync(path(p))),id,'U transaction write identity');}finally{closeSync(fd);}pin(p,{path:p,sha256:hash(raw),bytes:raw.length},id);prepSyncDir(dirname(path(p)));return ref(p);};
 const cas=events=>{check();const p=base+'/journal.json';assert.deepEqual(existsSync(path(p))?bytes(root,p):null,journalRaw,'U transaction head CAS');const next={schemaVersion:3,purpose:uTransactionPurpose,events};save(base+'/journal.pending',next);check();assert.deepEqual(existsSync(path(p))?bytes(root,p):null,journalRaw,'U transaction head CAS');const pending=pins.get(base+'/journal.pending');renameSync(path(base+'/journal.pending'),path(p));pins.delete(base+'/journal.pending');pin(p,{...pending.reference,path:p},pending.identity);prepSyncDir(path(base));journalRaw=Buffer.from(JSON.stringify(next,null,2)+'\n');assert.deepEqual(bytes(root,p),journalRaw,'U transaction journal readback');journal=next;};
 try{
  await authenticate();assert.equal(binding.scope.scopeId,'U-I1a-v1','U transaction full scope');assert.equal(binding.identity.node,process.execPath,'U transaction fixed Node');
  if(existsSync(path(base))){const history=readUInvocationHistory(root,base);journal=history.journal;journalRaw=bytes(root,base+'/journal.json');head=history.head;sequence=history.sequence+1;const observed=new Map(history.identities.map(r=>[r.path,r.identity]));for(const r of history.files)pin(r.path,r,observed.get(r.path));for(const [p,id]of observed)if(!pins.has(p)){assert.deepEqual(identity(lstatSync(path(p))),id,'U transaction pinned directory');dirs.set(p,id);}}
  else{const parent=dirname(base);assert.ok(lstatSync(path(parent)).isDirectory(),'U transaction existing parent');mkdir(base);mkdir(base+'/invocations');}
  await verify();lockFd=openSync(path(lock),'wx',0o600);const lockRaw=Buffer.from(JSON.stringify({nonce:randomUUID(),sequence,head}));writeFileSync(lockFd,lockRaw);fsyncSync(lockFd);pin(lock,{path:lock,sha256:hash(lockRaw),bytes:lockRaw.length},identity(fstatSync(lockFd)));prepSyncDir(path(base));await verify();
  dir=base+'/invocations/'+sequence;mkdir(dir);mkdir(dir+'/outputs');const bindingRef=save(dir+'/binding.json',binding);start=save(dir+'/start.json',{schemaVersion:3,purpose:uTransactionPurpose,sequence,priorHead:head,binding:bindingRef,command:componentRegressionCommand});cas([...journal.events,{sequence,status:'STARTED',start,priorHead:head}]);
  await verify();stage='SPAWN';const startedAt=new Date().toISOString();for(const n of ['stdout.tap','stderr.log']){const p=dir+'/outputs/'+n;streams.set(p,openSync(path(p),'wx',0o600));meters.set(p,{hash:createHash('sha256'),bytes:0});}
  const child=spawn(process.execPath,componentRegressionCommand.slice(4),{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});
  const closed=new Promise(r=>{let error=null;child.on('error',e=>error={code:e.code??null,message:e.message});child.once('close',(status,signal)=>r({status,signal,error}));});
  const destination=p=>new Writable({write(chunk,encoding,done){try{writeFileSync(streams.get(p),chunk);meters.get(p).hash.update(chunk);meters.get(p).bytes+=chunk.length;done();}catch(error){done(error);}}});
  const outcomes=await Promise.allSettled([closed,pipeline(child.stdout,destination(dir+'/outputs/stdout.tap')),pipeline(child.stderr,destination(dir+'/outputs/stderr.log'))]);
  stage='STDOUT_OR_STDERR';for(const x of outcomes)if(x.status==='rejected')throw x.reason;const result=outcomes[0].value;
  stage='PERSISTENCE_OR_READBACK';check();for(const [p,fd]of streams){fsyncSync(fd);const id=identity(fstatSync(fd)),reference=ref(p),meter=meters.get(p);assert.deepEqual(identity(lstatSync(path(p))),id,'U transaction output readback identity');assert.equal(reference.sha256,meter.hash.digest('hex'),'U transaction output readback bytes');assert.equal(reference.bytes,meter.bytes,'U transaction output readback length');pins.set(p,{identity:id,reference});closeSync(fd);streams.delete(p);}prepSyncDir(path(dir+'/outputs'));
  execution=save(dir+'/outputs/execution.json',{actualArgv:[process.execPath,...componentRegressionCommand.slice(4)],...result,startedAt,finishedAt:new Date().toISOString(),stdout:ref(dir+'/outputs/stdout.tap'),stderr:ref(dir+'/outputs/stderr.log'),streamsClosed:true});
  stage=result.error?'SPAWN':'PROCESS_EXIT_OR_SIGNAL';assert.equal(result.error,null,'U transaction spawn failure');assert.equal(result.signal,null,'U transaction child signal');assert.equal(result.status,0,'U transaction child exit');rComponentCoverage(binding.scope,bytes(root,dir+'/outputs/stdout.tap').toString());
 }catch(error){primary=error;}
 if(lockFd===null){if(primary)throw primary;throw Error('U transaction missing lock');}
 try{
  // Never close a partial producer, lost lock or changed authority by assertion.
  // Failure to prove closure leaves STARTED and the owned fence in place.
  const previousStage=stage;stage='INPUT_OR_AUTHORITY_DRIFT';await verify();stage=previousStage;assert.ok(start,'U transaction STARTED missing');assert.equal(streams.size,0,'U transaction output completion unknown');
  const entries=execution?[execution,ref(dir+'/outputs/stderr.log'),ref(dir+'/outputs/stdout.tap')].sort((a,b)=>a.path.localeCompare(b.path,'en')):[];
  const inventory=save(dir+'/inventory.json',{entries,digest:hash(JSON.stringify(entries))});
  await verify();const status=primary?'FAILED':'PASSED',terminal=save(dir+'/terminal.json',{schemaVersion:3,purpose:uTransactionPurpose,sequence,start,previousHead:head,status,cause:primary?{stage,message:primary.message}:null,execution,inventory});
  const next=hash(JSON.stringify({previousHead:head,sequence,start,terminal}));cas([...journal.events,{sequence,status,start,terminal,head:next}]);await verify();check();
  const result=readUInvocationHistory(root,base,lockFd);await verify();assert.deepEqual(readUInvocationHistory(root,base,lockFd),result,'U transaction return drift');
  // Release only after closure checks. Failed release durability restores a
  // fence exclusively; it never overwrites another writer's lock.
  const lockBytes=bytes(root,lock);closeSync(lockFd);lockFd=null;unlinkSync(path(lock));pins.delete(lock);
  try{prepSyncDir(path(base));}catch(error){try{const fd=openSync(path(lock),'wx',0o600);try{writeFileSync(fd,lockBytes);fsyncSync(fd);}finally{closeSync(fd);}}catch(fenceError){error.fenceError=fenceError.message;}throw error;}
  assert.deepEqual(readUInvocationHistory(root,base),result,'U transaction return drift');
  if(primary){primary.transaction=result;throw primary;}return result;
 }catch(error){reported=primary??error;if(primary&&error!==primary)primary.recordingError=error.message;throw reported;}
 finally{const cleanup=[];for(const [p,fd]of streams)try{closeSync(fd);}catch(e){cleanup.push({path:p,message:e.message});}if(lockFd!==null)try{closeSync(lockFd);}catch(e){cleanup.push({path:lock,message:e.message});}if(cleanup.length){if(reported)reported.cleanupErrors=cleanup;else throw Object.assign(Error('U transaction cleanup incomplete'),{cleanupErrors:cleanup});}}
}
const rComponentOwners=new WeakMap();
function rComponentScope(root,plan,manifest){
 const p=plan.componentContinuation;assert.equal(p?.scope,'R-I1a-v1','R scope identity');
 assert.equal(p.recordSchemaVersion,2,'R scope record schema');assert.equal(p.recordPurpose,'R_COMPONENT_IMPLEMENTATION_REVIEW','R scope purpose');
 assert.deepEqual(p.regressionCommand,componentRegressionCommand,'R scope fixed command');
 const path='tests/enterprise/rejected-regeneration.test.mjs',raw=bytes(root,path),entry=manifest.entries.find(e=>e.path===path);
 assert.equal(entry?.sha256,hash(raw),'R scope source input');
 const matches=[...raw.toString().matchAll(/\/\* R_COMPONENT_BINDINGS_V1\n([\s\S]*?)\nEND_R_COMPONENT_BINDINGS \*\//g)];
 assert.equal(matches.length,1,'R scope complete pre-execution binding table missing');
 const bindings=strictPreparationJSON(matches[0][1]),conditions=Object.entries(p.caseConditions).flatMap(([caseId,keys])=>keys.map(conditionKey=>({caseId,conditionKey})));
 assert.equal(conditions.length,85,'R scope full condition registry');assert.equal(bindings.length,conditions.length,'R scope missing conditions');
 const exact=(o,keys)=>assert.deepEqual(Object.keys(o).sort(),keys.sort(),'R scope fields');
 for(const [i,row]of bindings.entries()){
  exact(row,['caseId','conditionKey','variants']);assert.deepEqual({caseId:row.caseId,conditionKey:row.conditionKey},conditions[i],'R scope condition order');
  assert.ok(Array.isArray(row.variants)&&row.variants.length,'R scope empty variants');const ids=new Set(),paths=new Set();
  for(const v of row.variants){exact(v,['variantId','testPath','expectedBoundary','oracle']);for(const k of ['variantId','expectedBoundary','oracle'])assert.ok(typeof v[k]==='string'&&v[k].trim()===v[k]&&v[k].length>0&&!/[\r\n*]/.test(v[k]),'R scope concrete '+k);
   assert.ok(!ids.has(v.variantId),'R scope duplicate variant');ids.add(v.variantId);
   assert.ok(Array.isArray(v.testPath)&&v.testPath.length>=2,'R scope child path');for(const part of v.testPath){exact(part,['ordinal','name']);assert.ok(Number.isSafeInteger(part.ordinal)&&part.ordinal>0,'R scope ordinal');assert.ok(typeof part.name==='string'&&part.name.length>0&&!/[\r\n]/.test(part.name),'R scope name');}
   const key=JSON.stringify(v.testPath);assert.ok(!paths.has(key),'R scope collapsed variants');paths.add(key);
  }
 }
 const ref=path=>{const b=bytes(root,path);return {path,sha256:hash(b),bytes:b.length};};
 return {schemaVersion:1,scopeId:p.scope,planDefinition:ref('work/enterprise/plan.json'),contracts:[ref(p.contract),ref('work/enterprise/PREPARATION_COMPONENT_REVIEW.md')],caseIds:Object.keys(p.caseConditions),caseBindings:bindings.map(row=>({...row,variants:row.variants.map(v=>({...v,source:ref(path)}))})),regressionCommand:componentRegressionCommand,residualBlockers:['I1b','I2','I3','native303','residual29','completeH','P7','productAcceptance']};
}
function rComponentCoverage(scope,stdout){
 const parsed=componentTapStructure(stdout),tap=parseTap(stdout);assert.equal(parsed.nodes.length,tap.tests,'R scope TAP count');
 for(const row of scope.caseBindings)for(const v of row.variants){
  const ordinals=v.testPath.map(x=>x.ordinal),node=parsed.nodes.find(n=>JSON.stringify(n.path)===JSON.stringify(ordinals));assert.ok(node&&node.childCount===0,'R scope missing leaf '+v.variantId);
  for(let i=0;i<v.testPath.length;i++){const n=parsed.nodes.find(n=>JSON.stringify(n.path)===JSON.stringify(ordinals.slice(0,i+1)));assert.equal(n?.name,v.testPath[i].name,'R scope renamed or reparented leaf '+v.variantId);}
 }
 return {tap,structure:parsed};
}
async function constructRComponentEvidence(root){
 assert.equal(arguments.length,1,'R writer accepts no scope or authority override');assert.ok(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'R writer Node environment override');root=resolve(root);
 const authority=await inspectComponentDevelopment(root);assert.notEqual(authority.kind,'U_COMPONENT_DEVELOPMENT_AUTHORITY_DIAGNOSTIC','U writer route not implemented');assert.equal(authority.continuationCheckpointBound,true,'R writer current authority');
 const context=await currentContext(root),manifest=inputs(root),plan=read(root,'work/enterprise/plan.json');
 assert.equal(context.identity.runSlug,authority.runSlug,'R writer context');assert.deepEqual(manifest,authority.currentInputs,'R writer current inputs');
 const scope=rComponentScope(root,plan,manifest),review=completed(context,context.records.findLastIndex(r=>r.type==='step_start'&&r.step==='review-architecture'),'enterprise-architecture-reviewer');
 const design=readFileSync(confined(context.identity.runRoot,relative(context.identity.runRoot,context.identity.reportDirectory)+'/'+review.definition.outputContracts[0].name));
 assert.equal(hash(design),authority.designReportSha256,'R writer design bytes');
 assert.deepEqual(await inspectComponentDevelopment(root),authority,'R writer await authority');assert.deepEqual(inputs(root),manifest,'R writer await inputs');assert.deepEqual(rComponentScope(root,plan,manifest),scope,'R writer await scope');
 const owner=Object.freeze({});rComponentOwners.set(owner,{root,authority,context,manifest,plan,scope,design,used:false});return owner;
}
// This low-level transaction remains private until the fixed-engine and full
// history/provenance consumer are connected. A successful transaction is not a
// candidate, gate result, review, or product acceptance.
async function writeRComponentEvidence(owner){
 assert.equal(arguments.length,1,'R writer arguments');const s=rComponentOwners.get(owner);assert.ok(s&&!s.used,'R writer private one-use owner');s.used=true;
 const {root,authority,context,manifest,scope,design}=s,purpose='R_COMPONENT_IMPLEMENTATION_REVIEW',schemaVersion=2;
 const base=authority.diagnosticNamespace.replace(/\/$/,'')+'/review-evidence',lock=base+'/writer.lock',held=new Map(),dirs=new Map(),streams=new Map();let lockFd=null,journalRaw=null,interrupted=null,spawnAttempted=false,execution=null;
 const inode=st=>({dev:st.dev,ino:st.ino,mode:st.mode});
 const path=p=>confined(root,p),ref=p=>{const b=readFileSync(path(p));return {path:p,sha256:hash(b),bytes:b.length};};
 const check=()=>{for(const [p,st]of dirs)assert.deepEqual(inode(lstatSync(path(p))),st,'R writer directory identity');for(const [p,v]of held){assert.deepEqual(inode(lstatSync(path(p))),v.identity,'R writer file identity');assert.deepEqual(ref(p),v.reference,'R writer changed bytes');}for(const [p,fd]of streams)assert.deepEqual(inode(lstatSync(path(p))),inode(fstatSync(fd)),'R writer output ownership');if(lockFd!==null)assert.deepEqual(inode(lstatSync(path(lock))),inode(fstatSync(lockFd)),'R writer lock ownership');};
 const authenticate=async()=>{assert.deepEqual(await inspectComponentDevelopment(root),authority,'R writer authority drift');assert.deepEqual(inputs(root),manifest,'R writer input drift');check();};
 const durable=(p,b)=>{check();const fd=openSync(path(p),'wx',0o600);try{writeFileSync(fd,b);fsyncSync(fd);held.set(p,{reference:ref(p),identity:inode(fstatSync(fd))});assert.deepEqual(readFileSync(path(p)),b,'R writer readback');}finally{closeSync(fd);}prepSyncDir(dirname(path(p)));return held.get(p).reference;};
 const save=(p,v)=>durable(p,Buffer.from(JSON.stringify(v,null,2)+'\n'));
 const mkdir=p=>{check();mkdirSync(path(p),{mode:0o700});dirs.set(p,inode(lstatSync(path(p))));prepSyncDir(dirname(path(p)));};
 const publishJournal=value=>{
  check();const p=base+'/journal.json';if(journalRaw===null)assert.ok(!existsSync(path(p)),'R writer journal appeared');else assert.deepEqual(readFileSync(path(p)),journalRaw,'R writer journal CAS');
  const next=Buffer.from(JSON.stringify(value,null,2)+'\n'),tmp=base+'/journal.pending';durable(tmp,next);check();
  if(journalRaw!==null)assert.deepEqual(readFileSync(path(p)),journalRaw,'R writer journal CAS');else assert.ok(!existsSync(path(p)),'R writer journal appeared');
  renameSync(path(tmp),path(p));held.delete(tmp);held.set(p,{reference:ref(p),identity:inode(lstatSync(path(p)))});prepSyncDir(path(base));assert.deepEqual(readFileSync(path(p)),next,'R writer journal readback');journalRaw=next;
 };
 const onInt=()=>{interrupted='SIGINT';},onTerm=()=>{interrupted='SIGTERM';};
 let dir,start,identity,events=[],priorHead='0'.repeat(64),sequence=1;
 try{
  await authenticate();const parts=base.split('/');for(let i=1;i<=parts.length;i++){await authenticate();const p=parts.slice(0,i).join('/');if(!existsSync(path(p)))mkdir(p);else{const st=lstatSync(path(p));assert.ok(st.isDirectory()&&!st.isSymbolicLink(),'R writer namespace');dirs.set(p,inode(st));}}
  await authenticate();assert.deepEqual(readdirSync(path(base)),[],'R writer existing history requires validated continuation');lockFd=openSync(path(lock),'wx',0o600);writeFileSync(lockFd,JSON.stringify({schemaVersion,purpose,runSlug:authority.runSlug,builderIteration:authority.iteration,builderSessionId:authority.builderSession,nonce:randomUUID()}));fsyncSync(lockFd);held.set(lock,{reference:ref(lock),identity:inode(fstatSync(lockFd))});prepSyncDir(path(base));
  // Continuation of a partial/failed namespace requires the complete history
  // consumer. Do not select an old success, clear its fence or overwrite it.
  assert.deepEqual(readdirSync(path(base)).sort(),['writer.lock'],'R writer existing history requires validated continuation');
  mkdir(base+'/invocations');dir=base+'/invocations/1';mkdir(dir);mkdir(dir+'/outputs');
  identity={runSlug:authority.runSlug,workflowRef:context.identity.workflowRef,bundleDigest:context.identity.bundleDigest,builderIteration:authority.iteration,builderSessionId:authority.builderSession};
  const scopeRef=save(dir+'/scope.json',scope),designReport=durable(dir+'/design.md',design),plan=durable(dir+'/plan.json',bytes(root,'work/enterprise/plan.json')),inputsBefore=save(dir+'/inputs-before.json',manifest);
  start=save(dir+'/start.json',{schemaVersion,purpose,identity,sequence,priorHistoryHead:priorHead,scope:scopeRef,designReport,plan,inputsBefore,command:componentRegressionCommand});
  events=[{sequence,status:'STARTED',start,priorHead}];await authenticate();publishJournal({schemaVersion,purpose,events});
  process.on('SIGINT',onInt);process.on('SIGTERM',onTerm);
  for(const n of ['stdout.tap','stderr.log'])streams.set(dir+'/outputs/'+n,openSync(path(dir+'/outputs/'+n),'wx',0o600));
  await authenticate();assert.equal(interrupted,null,'R writer interrupted before spawn');
  const startedAt=new Date().toISOString();spawnAttempted=true;
  const child=spawn(process.execPath,componentRegressionCommand.slice(4),{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});
  const close=new Promise(resolveResult=>{let error=null;child.on('error',e=>error={code:e.code??null,message:e.message});child.once('close',(status,signal)=>resolveResult({status,signal,error}));});
  const destination=fd=>new Writable({write(chunk,encoding,done){try{writeFileSync(fd,chunk);done();}catch(e){done(e);}}});
  const outcomes=await Promise.allSettled([close,pipeline(child.stdout,destination(streams.get(dir+'/outputs/stdout.tap'))),pipeline(child.stderr,destination(streams.get(dir+'/outputs/stderr.log')))]);
  const result=outcomes[0].value;check();for(const [p,fd]of streams){fsyncSync(fd);held.set(p,{reference:ref(p),identity:inode(fstatSync(fd))});closeSync(fd);streams.delete(p);}prepSyncDir(path(dir+'/outputs'));
  execution=save(dir+'/outputs/execution.json',{schemaVersion:1,invocation:'invocation-'+randomUUID(),startedAt,finishedAt:new Date().toISOString(),...result,interrupted,requestedArgv:componentRegressionCommand,actualArgv:[process.execPath,...componentRegressionCommand.slice(4)],inputsDigest:manifest.digest,outputs:[ref(dir+'/outputs/stdout.tap'),ref(dir+'/outputs/stderr.log')]});
  for(const outcome of outcomes)if(outcome.status==='rejected')throw outcome.reason;
  await authenticate();assert.equal(interrupted,null,'R writer interrupted');assert.equal(result.error,null,'R writer spawn error');assert.equal(result.signal,null,'R writer signal');assert.equal(result.status,0,'R writer test failure');
  rComponentCoverage(scope,readFileSync(path(dir+'/outputs/stdout.tap'),'utf8'));
  const inputsAfter=save(dir+'/inputs-after.json',inputs(root)),entries=[execution,ref(dir+'/outputs/stdout.tap'),ref(dir+'/outputs/stderr.log')].sort((a,b)=>a.path.localeCompare(b.path,'en'));
  const outputsDigest=hash(JSON.stringify(entries)),outputInventory=save(dir+'/output-inventory.json',{schemaVersion,purpose,entries,digest:outputsDigest});
  const receipt=save(dir+'/receipt.json',{schemaVersion,kind:'R_COMPONENT_EVIDENCE',purpose,identity,scope:scopeRef,designReport,plan,inputsBefore,inputsAfter,inputsDigest:manifest.digest,command:componentRegressionCommand,execution,stdout:ref(dir+'/outputs/stdout.tap'),stderr:ref(dir+'/outputs/stderr.log'),outputInventory,outputsDigest,priorHistoryHead:priorHead,start,result:'PASSED',productVerified:false,nativeAccepted:false});
  await authenticate();assert.equal(interrupted,null,'R writer interrupted before terminal');
  const terminal=save(dir+'/terminal.json',{schemaVersion,purpose,sequence,start,previousHead:priorHead,status:'PASSED',receipt,diagnostic:null,outputInventory}),head=hash(JSON.stringify({previousHead:priorHead,sequence,start,terminal}));
  events.push({sequence,status:'PASSED',start,terminal,head});publishJournal({schemaVersion,purpose,events});
  const journalPrefix=save(dir+'/journal-prefix.json',{schemaVersion,purpose,events});await authenticate();
  save(base+'/request.json',{schemaVersion,purpose,identity,scope:scopeRef,designReport,receipt,inputsDigest:manifest.digest,historyBinding:{journalPrefix,head,sequence,start,terminal},productVerified:false});
  const graph=readComponentRecordGraph(root,authority.runSlug,true,lockFd);await authenticate();assert.deepEqual(readComponentRecordGraph(root,authority.runSlug,true,lockFd),graph,'R writer postpublication drift');assert.equal(interrupted,null,'R writer interrupted before unlock');check();closeSync(lockFd);lockFd=null;unlinkSync(path(lock));held.delete(lock);prepSyncDir(path(base));
  return {...graph,references:graph.references.filter(r=>r.path!==lock),kind:'R_COMPONENT_TRANSACTION_DIAGNOSTIC',provenanceAuthenticated:false,reviewReady:false};
 }catch(error){
  // Failure reporting never adopts a lost lock or repairs unknown output. A
  // publication failure after PASSED keeps the fence; no older pass is usable.
  if(lockFd!==null&&start&&events.length===1)try{
   await authenticate();assert.equal(streams.size,0,'R writer output completion unknown');
   const inputsAfter=existsSync(path(dir+'/inputs-after.json'))?ref(dir+'/inputs-after.json'):save(dir+'/inputs-after.json',inputs(root));
   const diagnostic=save(dir+'/outputs/failure.json',{schemaVersion,purpose,message:error.message,spawnAttempted,execution,inputsAfter});
   const entries=[...held.values()].map(v=>v.reference).filter(r=>r.path.startsWith(dir+'/outputs/')).sort((a,b)=>a.path.localeCompare(b.path,'en'));
   const outputInventory=save(dir+'/output-inventory.json',{schemaVersion,purpose,entries,digest:hash(JSON.stringify(entries))});
   const terminal=save(dir+'/terminal.json',{schemaVersion,purpose,sequence,start,previousHead:priorHead,status:'FAILED',receipt:null,diagnostic,outputInventory}),head=hash(JSON.stringify({previousHead:priorHead,sequence,start,terminal}));
   events.push({sequence,status:'FAILED',start,terminal,head});publishJournal({schemaVersion,purpose,events});
  }catch(recordError){error.failureRecording=recordError.message;}
  error.message+=' [R typed evidence: '+base+']';throw error;
 }finally{process.off('SIGINT',onInt);process.off('SIGTERM',onTerm);for(const fd of streams.values())try{closeSync(fd);}catch{}if(lockFd!==null)try{closeSync(lockFd);}catch{}}
}
// Read-only consistency diagnostic, deliberately not the post-report gate or
// reviewer authority. Historical occurrence authentication remains required.
async function inspectRComponentEvidenceConsistency(root){
 assert.equal(arguments.length,1,'R reader no context override');
 const owner=await constructRComponentEvidence(root),s=rComponentOwners.get(owner);
 const execution=readRComponentEvidenceExecution(s.root,s.authority.runSlug);
 const graph=readRComponentEvidenceGraph(s.root,s.authority.runSlug),request=strictPreparationJSON(bytes(s.root,graph.request.path));
 assert.deepEqual(request.identity,{runSlug:s.authority.runSlug,workflowRef:s.context.identity.workflowRef,bundleDigest:s.context.identity.bundleDigest,builderIteration:s.authority.iteration,builderSessionId:s.authority.builderSession},'R reader current builder identity');
 assert.equal(request.designReport.sha256,s.authority.designReportSha256,'R reader current design');
 assert.deepEqual(await inspectComponentDevelopment(s.root),s.authority,'R reader await authority');
 assert.deepEqual(readRComponentEvidenceExecution(s.root,s.authority.runSlug),execution,'R reader await execution');
 assert.deepEqual(readRComponentEvidenceGraph(s.root,s.authority.runSlug),graph,'R reader await graph');
 return {...execution,currentBuilderContextAuthenticated:true,provenanceAuthenticated:false,reviewReady:false};
}
async function prepareRComponentReview(root,component){
 assert.equal(component,'I1a','R component selection');await constructRComponentEvidence(root);
 // Activation requires the real fixed-engine sequence and complete history,
 // scope/provenance and importer tests. Never create a partial live candidate.
 throw Error('R fixed-engine handoff and complete historical provenance not implemented');
}

// Fixed, reviewed portable regression operation. No caller command, output path,
// reusable capability, capture namespace or accepted-component ledger is accepted.
const componentRegressionCommand=['mise','exec','--','node','--test','--test-reporter=tap',
 'tests/enterprise/evidence.test.mjs','tests/enterprise/ENT-101.test.mjs','tests/enterprise/finalization.test.mjs',
 'tests/enterprise/continuation.test.mjs','tests/enterprise/continuation-v4.test.mjs',
 'tests/enterprise/rejected-regeneration.test.mjs','tests/enterprise/closure-review.test.mjs'];
async function testComponentDevelopment(root){
 root=resolve(root);const authority=await inspectComponentDevelopment(root);
 assert.notEqual(authority.kind,'U_COMPONENT_DEVELOPMENT_AUTHORITY_DIAGNOSTIC','U legacy diagnostic writer refused');
 assert.deepEqual(read(root,'work/enterprise/plan.json').preparationRestart.regressionCommand,componentRegressionCommand,'component fixed regression command');
 assert.ok(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'component Node environment override');
 const namespace=authority.diagnosticNamespace.replace(/\/$/,''),id='invocation-'+randomUUID(),base=namespace+'/'+id;
 assert.match(id,/^invocation-[a-f0-9-]{36}$/,'component invocation identity');
 const directories=new Map(),artifacts=new Map(),live=new Map();let owned=false,interrupted=null;
 const identity=s=>({dev:s.dev,ino:s.ino});
 const check=()=>{
  for(const [path,inode]of directories){const s=lstatSync(confined(root,path));assert.ok(s.isDirectory(),'component directory type');assert.deepEqual(identity(s),inode,'component directory ownership: '+path);}
  for(const [path,r]of artifacts){const p=confined(root,path),s=lstatSync(p);assert.ok(s.isFile(),'component artifact type');assert.deepEqual(identity(s),r.inode,'component artifact ownership: '+path);const raw=readFileSync(p);assert.equal(raw.length,r.bytes,'component artifact length: '+path);assert.equal(hash(raw),r.sha256,'component artifact changed: '+path);}
  for(const [path,fd]of live){const s=lstatSync(confined(root,path));assert.ok(s.isFile(),'component stream type');assert.deepEqual(identity(s),identity(fstatSync(fd)),'component stream ownership: '+path);}
 };
 const authenticate=async()=>{assert.deepEqual(await inspectComponentDevelopment(root),authority,'component authority changed');check();};
 const record=async(name,value)=>{
  await authenticate();if(name==='diagnostic.json')assert.equal(interrupted,null,'component interrupted before publication');assert.match(name,/^[a-z][a-z0-9.-]*$/);const path=base+'/'+name,p=confined(root,path),raw=Buffer.from(JSON.stringify(value,null,2)+'\n');
  const fd=openSync(p,'wx',0o600);try{writeFileSync(fd,raw);fsyncSync(fd);artifacts.set(path,{path,sha256:hash(raw),bytes:raw.length,inode:identity(fstatSync(fd))});}finally{closeSync(fd);}
  prepSyncDir(dirname(p));check();return {path,sha256:hash(raw),bytes:raw.length};
 };
 const onSignal=signal=>{interrupted=signal;};
 const sigint=()=>onSignal('SIGINT'),sigterm=()=>onSignal('SIGTERM');
 try{
  // Every directory creation follows fresh authentication. Shared parents are
  // never adopted as invocation ownership; only exclusive mkdir establishes it.
  const parts=namespace.split('/');for(let i=1;i<=parts.length;i++){
   const path=parts.slice(0,i).join('/');await authenticate();const p=confined(root,path);
   if(!existsSync(p)){try{mkdirSync(p,{mode:0o700});prepSyncDir(dirname(p));}catch(e){if(e.code!=='EEXIST')throw e;}}
   const s=lstatSync(confined(root,path));assert.ok(s.isDirectory(),'component namespace directory');directories.set(path,identity(s));
  }
  await authenticate();mkdirSync(confined(root,base),{mode:0o700});directories.set(base,identity(lstatSync(confined(root,base))));prepSyncDir(confined(root,namespace));
  await record('owner.json',{schemaVersion:1,kind:'COMPONENT_DIAGNOSTIC_OWNER',invocation:id,runSlug:authority.runSlug,builderSession:authority.builderSession,pid:process.pid});owned=true;
  process.on('SIGINT',sigint);process.on('SIGTERM',sigterm);
  const startedAt=new Date().toISOString();
  await record('start.json',{schemaVersion:1,kind:'ISOLATED_COMPONENT_REGRESSIONS',invocation:id,startedAt,requestedArgv:componentRegressionCommand,actualArgv:[process.execPath,...componentRegressionCommand.slice(4)],node:process.version,authority});
  for(const name of ['stdout.tap','stderr.log']){await authenticate();const path=base+'/'+name;live.set(path,openSync(confined(root,path),'wx',0o600));}
  await authenticate();assert.equal(interrupted,null,'component interrupted before subprocess');
  // Only the parent owns file descriptors. Wait for pipe EOF and both stream
  // pipelines as well as child close; descendants cannot inherit a diagnostic fd.
  const child=spawn(process.execPath,componentRegressionCommand.slice(4),{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});
  const closed=new Promise(resolveResult=>{let error=null;child.on('error',e=>{error={code:e.code,message:e.message};});child.once('close',(status,signal)=>resolveResult({status,signal,error}));});
  // The stream must not close a borrowed fd on destroy/error: this scope alone
  // closes descriptors, retaining the original pipeline error for diagnostics.
  const destination=fd=>new Writable({write(chunk,encoding,done){try{writeFileSync(fd,chunk);done();}catch(error){done(error);}}});
  const streams=[pipeline(child.stdout,destination(live.get(base+'/stdout.tap'))),pipeline(child.stderr,destination(live.get(base+'/stderr.log')))];
  const settled=await Promise.allSettled([closed,...streams]);
  const result=settled[0].value;
  // Child close is only this isolated command's exit, never a domain-empty or
  // host-exclusion assertion. Interruption cannot manufacture a passing result.
  await authenticate();
  for(const outcome of settled)if(outcome.status==='rejected')throw outcome.reason;
  for(const [path,fd]of live){fsyncSync(fd);const raw=readFileSync(confined(root,path));artifacts.set(path,{path,sha256:hash(raw),bytes:raw.length,inode:identity(fstatSync(fd))});closeSync(fd);live.delete(path);}
  prepSyncDir(confined(root,base));check();
  const execution=await record('execution.json',{schemaVersion:1,invocation:id,startedAt,finishedAt:new Date().toISOString(),...result,interrupted,requestedArgv:componentRegressionCommand,actualArgv:[process.execPath,...componentRegressionCommand.slice(4)],inputsDigest:authority.currentInputs.digest,outputs:[...artifacts.values()].filter(r=>/\/(stdout.tap|stderr.log)$/.test(r.path)).map(({inode,...r})=>r)});
  assert.equal(interrupted,null,'component interrupted');assert.equal(result.error,null,'component spawn failed');assert.equal(result.signal,null,'component child signalled');assert.equal(result.status,0,'component tests failed');
  const tap=parseTap(readFileSync(confined(root,base+'/stdout.tap'),'utf8'));
  await record('inputs-after.json',inputs(root));
  const diagnostic={schemaVersion:1,kind:'ISOLATED_COMPONENT_REGRESSION_DIAGNOSTIC',invocation:id,runSlug:authority.runSlug,iteration:authority.iteration,builderSession:authority.builderSession,designReportSha256:authority.designReportSha256,inputsDigest:authority.currentInputs.digest,execution,tap,artifacts:[...artifacts.values()].map(({inode,...r})=>r),captureAuthority:false,recoveryAuthority:false,initializationAuthority:false,targetLaunchAuthority:false,runtimeReplacementAuthority:false,ordinaryBatchAuthority:false,completeH:false,nativeAcceptance:false,currentApprovals:[]};
  assert.equal(interrupted,null,'component interrupted before publication');await record('diagnostic.json',diagnostic);await authenticate();assert.equal(interrupted,null,'component interrupted after publication');return diagnostic;
 }catch(error){
  // Lost authority/ownership forbids further publication, including failure
  // publication. Existing bytes remain available; a new invocation never repairs
  // or overwrites this directory. No locks or partial files are deleted.
  if(owned)try{await record('failure.json',{schemaVersion:1,kind:'COMPONENT_DIAGNOSTIC_FAILURE',invocation:id,message:error.message,interrupted,complete:false});}catch{}
  error.message+=' [component diagnostics: '+base+']';throw error;
 }finally{
  process.off('SIGINT',sigint);process.off('SIGTERM',sigterm);
  for(const fd of live.values())try{closeSync(fd);}catch{}
 }
}

export async function inspectRuntimePreparation(root){
 root=resolve(root);const context=await currentContext(root),before=inputs(root);
 assert.equal(context.step,'build-foundation');assert.equal(context.sessionKey,'enterprise-builder');assert.equal(context.stepDefinition.edit,true);
 assert.equal(context.start.provider,'codex');assert.equal(context.start.model,'gpt-6-astra');assert.equal(context.start.providerOptions?.codex?.reasoningEffort,'high');
 assert.ok(!existsSync(confined(root,'evidence/enterprise/gate.lock')),'source gate writer active or unknown');
 const index=context.records.findLastIndex(r=>r.type==='step_start'&&r.step==='review-architecture');
 const design=completed(context,index,'enterprise-architecture-reviewer');assert.ok(design.end<=context.records.indexOf(context.start),'design must precede builder');
 const a=block(design.phases[1].content,'enterprise-failed-interval-design-attestation');
 assert.deepEqual(block(design.phases[0].content,'enterprise-failed-interval-design-attestation'),a,'preparation phases differ');
 for(const [k,v] of Object.entries({schemaVersion:2,verdict:'APPROVE',purpose:'PREPARE_DISTINCT_RUN_CONTINUATION',permission:'PREPARATION_AND_HISTORY_ONLY',runSlug:context.identity.runSlug,workflowRef:context.identity.workflowRef,bundleDigest:context.identity.bundleDigest,step:'review-architecture',iteration:design.start.iteration,sessionKey:'enterprise-architecture-reviewer',providerSessionId:design.session}))assert.equal(a[k],v,`preparation ${k}`);
 assert.equal(a.targetRunSlug,undefined,'source order has target authority');assert.deepEqual(a.unresolvedFindings,[]);
 const contracts=design.definition.outputContracts;assert.equal(contracts?.length,1);
 const canonical=confined(context.identity.runRoot,relative(context.identity.runRoot,context.identity.reportDirectory)+'/'+contracts[0].name),reportRaw=readFileSync(canonical);
 assert.ok(reportRaw.toString()===design.phases[1].content||reportRaw.toString()===design.phases[1].content+'\n','preparation canonical mismatch');
 const references=new Map();
 const bound=(path,sha256)=>{assert.match(sha256,/^[a-f0-9]{64}$/);const raw=bytes(root,path);assert.equal(hash(raw),sha256,'changed preparation reference: '+path);references.set(path,{path,sha256,bytes:raw.length});return raw;};
 assert.equal(a.contractPath,'work/enterprise/FAILED_INTERVAL_RECOVERY.md');bound(a.contractPath,a.contractSha256);
 assert.equal(a.runtimeContinuationContract.path,'work/enterprise/RUNTIME_CONTINUATION.md');bound(a.runtimeContinuationContract.path,a.runtimeContinuationContract.sha256);
 const plan=JSON.parse(bound('work/enterprise/plan.json',a.planSha256));validatePlan(root,plan,read(root,'work/enterprise/backlog.json'));
 const p=JSON.parse(bound(a.sourceProgress.path,a.sourceProgress.sha256));assert.equal(a.sourceProgress.path,'work/enterprise/progress.json');
 assert.equal(p.activeBatchId,a.activeBatchId);assert.equal(p.runBinding.runSlug,context.identity.runSlug);assert.equal(p.entrySelection,a.entrySelection.path);assert.equal(p.entrySelectionHash,a.entrySelection.sha256);
 const selection=JSON.parse(bound(a.entrySelection.path,a.entrySelection.sha256));
 assert.equal(selection.batchId,a.activeBatchId);assert.equal(selection.inputsDigest,p.entryInputs);
 assert.deepEqual(plan.batches.slice(0,plan.batches.findIndex(b=>b.id===a.activeBatchId)+1).map(b=>b.id),a.prefixBatchIds);
 assert.deepEqual(selection.predecessors.map(p=>p.batchId),a.prefixBatchIds.slice(0,-1));
 const ri=context.records.findLastIndex(r=>r.type==='step_start'&&r.step==='review-foundation'),review=completed(context,ri,'enterprise-batch-reviewer'),r=a.latestFoundationReview;
 assert.ok(ri<index,'later foundation review invalidates source order');assert.equal(review.start.iteration,r.iteration);assert.equal(review.session,r.providerSessionId);assert.equal(r.sessionKey,'enterprise-batch-reviewer');
 for(const [i,phase] of review.phases.entries())assert.equal(hash(phase.content),r[`phase${i+1}Sha256`]);
 const reviewRaw=bound(r.reportPath,r.reportSha256).toString();assert.ok(reviewRaw===review.phases[1].content||reviewRaw===review.phases[1].content+'\n');
 const att=closureAttestation(reviewRaw);assert.deepEqual(closureAttestation(review.phases[0].content),att);
 assert.equal(att.candidatePath,r.candidatePath);assert.equal(att.candidateSha256,r.candidateSha256);
 const candidate=validateCandidate(root,r);assert.deepEqual(candidate.candidate.members.map(m=>m.batchId),r.approvedBatchIds);assert.deepEqual(r.approvedBatchIds,a.prefixBatchIds.slice(0,-1));
 bound(r.candidatePath,r.candidateSha256);
 for(const [n,predecessor] of selection.predecessors.entries()){
  const run=candidate.runs[n];assert.equal(predecessor.runId,run.id);assert.equal(run.inputs.digest,selection.inputsDigest);assert.equal(hash(selection.planText),run.inputs.entries.find(e=>e.path==='work/enterprise/plan.json')?.sha256);
  await validateClosureApproval(root,predecessor.approval,run,candidate.candidate.members[n].issueIds,{historicalRunSlug:context.identity.runSlug});
 }
 const rc=a.runtimeCandidate,probe=JSON.parse(bound(rc.identitySourcePath,rc.identitySourceSha256));
 assert.equal(hash(JSON.stringify(context.identity.runtime)),rc.fromRuntimeIdentitySha256,'installed source runtime changed');
 assert.deepEqual(probe.oldRuntime,context.identity.runtime);assert.equal(probe.oldRuntime.version,rc.fromVersion);assert.equal(probe.nextRuntime.version,rc.toVersion);assert.equal(hash(JSON.stringify(probe.nextRuntime)),rc.toRuntimeIdentitySha256);
 assert.deepEqual(probe.oldRuntime.sources.map(s=>s.path),probe.nextRuntime.sources.map(s=>s.path),'runtime inventory changed');
 const differences=probe.nextRuntime.sources.filter((s,i)=>s.sha256!==probe.oldRuntime.sources[i].sha256);assert.deepEqual(differences,probe.runtimeDifferences);
 bound('package.json',rc.fromPackageSha256);bound('package-lock.json',rc.fromLockSha256);bound(rc.toPackagePath,rc.toPackageSha256);bound(rc.toLockPath,rc.toLockSha256);
 const idx=JSON.parse(bound(a.sourceIndex.path,a.sourceIndex.sha256));assert.equal(a.sourceIndex.path,'evidence/enterprise/runs/index.json');assert.equal(idx.runs.length,a.sourceIndex.entryCount);assert.equal(new Set(idx.runs.map(r=>r.id)).size,idx.runs.length,'forked index');
 // Every indexed member must remain present, even if superseded by the
 // selected prefix. Membership/identity checks do not authenticate its result.
 for(const e of idx.runs){
  assert.equal(e.path,receiptPath(e.id),'indexed historical receipt path');
  assert.ok(existsSync(confined(root,e.path)),'indexed historical receipt missing');
  const raw=bytes(root,e.path),run=JSON.parse(raw);
  assert.equal(run.id,e.id,'indexed historical receipt id');assert.equal(run.batchId,e.batchId,'indexed historical receipt batch');
  assert.ok(['passed','failed'].includes(run.status)&&Number.isFinite(Date.parse(run.finishedAt)),'indexed historical receipt unfinished');
  bound(e.path,hash(raw));
 }
 const boundary=Math.max(...selection.predecessors.map(pr=>{const i=idx.runs.findIndex(e=>e.id===pr.runId&&e.batchId===pr.batchId);assert.ok(i>=0,'selected receipt missing');return i;}))+1;
 const tail=idx.runs.slice(boundary);assert.deepEqual(tail.map(e=>e.path),a.failedReceipts.map(r=>r.path),'unexplained failed interval');
 const builders=a.subsequentBuilderOccurrences.map(b=>{
  const o=completed(context,b.startIndex,'enterprise-builder',false);assert.equal(o.start.step,'build-foundation');assert.equal(o.start.iteration,b.iteration);assert.equal(o.session,b.providerSessionId);assert.ok(b.startIndex>ri&&b.startIndex<index);
  for(const [i,p] of o.phases.entries()){assert.equal(p.phaseExecutionId,b[`phase${i+1}ExecutionId`]);assert.equal(hash(p.content),b[`phase${i+1}Sha256`]);}return o;
 });
 assert.deepEqual(context.records.flatMap((s,i)=>s.type==='step_start'&&s.step==='build-foundation'&&i>ri&&i<index?[i]:[]),builders.map(b=>b.index),'unknown source builder');
 const failures=[];let finished=0;
 for(const [n,e] of tail.entries()){
  const reference=a.failedReceipts[n];assert.equal(e.path,receiptPath(e.id));const run=JSON.parse(bound(e.path,reference.sha256));assert.equal(run.id,e.id);assert.equal(run.batchId,e.batchId);assert.equal(run.batchId,reference.batchId);assert.equal(run.inputs.digest,reference.inputsDigest);assert.deepEqual(run.inputs.runtime,context.identity.runtime);
  const definitions=failedReceiptDefinitions(root,run,selection.planText);
  const owners=builders.filter(b=>Date.parse(run.startedAt)>=Date.parse(b.start.timestamp)&&Date.parse(run.finishedAt)<=Date.parse(context.records[b.end]?.timestamp));assert.equal(owners.length,1,'failed receipt occurrence');assert.equal(run.implementationSession,owners[0].session);
  assert.ok(Date.parse(run.startedAt)>=finished,'failed interval order');finished=Date.parse(run.finishedAt);
  const cause=inspectFailedReceipt(root,run,definitions);assert.equal(cause.kind,reference.failureKind,'declared failure kind differs from evidence');
  for(const s of run.suites)for(const output of s.outputs.entries)bound(output.path,output.sha256);
  failures.push({receipt:reference,id:run.id,...cause});
 }
 const known=new Set(idx.runs.map(e=>e.id));
 // Receipt timestamps are untrusted until indexed history authenticates them.
 // An unknown receipt cannot exempt itself by claiming an earlier start time.
 for(const id of readdirSync(confined(root,'evidence/enterprise/runs'))){if(!existsSync(confined(root,receiptPath(id))))continue;assert.ok(known.has(id),'unindexed source receipt');}
 bound(a.retainedBuilderHandoff.path,a.retainedBuilderHandoff.sha256);
 // Recheck every local and orchestrator reference. No lock, archive, projection,
 // terminal assertion or current approval can be emitted by this diagnostic.
 for(const r of references.values())bound(r.path,r.sha256);
 assert.deepEqual(await currentContext(root),context,'concurrent preparation authority');assert.deepEqual(inputs(root),before,'concurrent preparation inputs');assert.deepEqual(readFileSync(canonical),reportRaw);
 return {schemaVersion:1,kind:'SOURCE_PREPARATION_DIAGNOSTIC',initializationAuthority:false,currentApprovals:[],sourceRunSlug:context.identity.runSlug,iteration:context.iteration,builderSession:context.providerSessionId,designReportSha256:hash(reportRaw),designInputsDigest:a.inputsDigest,currentInputs:before,approvedHistoricalBatchIds:r.approvedBatchIds,failures,runtimeDifferences:differences,references:[...references.values()],remaining:['SOURCE_TERMINAL_AND_QUIESCENCE','COMPLETE_HISTORICAL_INPUT_BYTES','CANDIDATE_LAUNCHER_ENGINE_PROOF','TARGET_DESIGN_ORDER','PRIVATE_HISTORY_ARCHIVE_AND_ATOMIC_INITIALIZATION']};
}
// Byte provenance for completed builder handoffs. This remains a preparation
// diagnostic: it neither authenticates all intervening design edits nor creates
// terminal H. No ordinary initializer/approval/selection imports this function.
export async function inspectRuntimeInputHistory(root){
 root=resolve(root);
 const preparation=await inspectRuntimePreparation(root),context=await currentContext(root),before=inputs(root);
 assert.deepEqual(before,preparation.currentInputs,'changed preparation inputs');
 const first=context.records.findLastIndex(r=>r.type==='step_start'&&r.step==='review-foundation'),last=context.records.indexOf(context.start);
 const handoffs=[],references=new Map(),pool=new Map(),manifests=new Map();
 const bind=(path,sha256,length)=>{
  const raw=bytes(root,path);assert.equal(hash(raw),sha256,'changed history bytes: '+path);if(length!==undefined)assert.equal(raw.length,length,'changed history length: '+path);
  const ref={path,sha256,bytes:raw.length};if(references.has(path))assert.deepEqual(references.get(path),ref,'conflicting history reference');references.set(path,ref);return raw;
 };
 const manifest=(m,origin)=>{
  assert.ok(m&&Array.isArray(m.entries)&&m.entries.length,'history input manifest required');
  assert.deepEqual(m.runtime,context.identity.runtime,'historical input runtime drift');
  assert.equal(m.digest,hash(JSON.stringify({entries:m.entries,runtime:m.runtime})),'history input digest');
  assert.equal(new Set(m.entries.map(e=>e.path)).size,m.entries.length,'duplicate historical input');
  for(const e of m.entries){confined(root,e.path);assert.match(e.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(e.bytes)&&e.bytes>=0,'history input length');}
  canonicalHistoricalInputs(root,m.entries);
  if(manifests.has(m.digest)){assert.deepEqual(manifests.get(m.digest).inputs,m);manifests.get(m.digest).origins.push(origin);}
  else manifests.set(m.digest,{inputs:m,origins:[origin]});
 };
 const offer=(entry,handoff,logicalPath=entry.path)=>{
  confined(root,entry.path);confined(root,logicalPath);assert.match(entry.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(entry.bytes)&&entry.bytes>=0,'history reference length');
  const key=entry.sha256+':'+entry.bytes,items=pool.get(key)??[];items.push({...entry,logicalPath,handoff});pool.set(key,items);
 };
 const selection=read(root,read(root,'work/enterprise/progress.json').entrySelection);
 for(const p of selection.predecessors){const path=receiptPath(p.runId),raw=bytes(root,path);references.set(path,{path,sha256:hash(raw),bytes:raw.length});manifest(JSON.parse(raw).inputs,{kind:'REVIEWED_PREFIX',receipt:path});}
 for(const f of preparation.failures){const raw=bind(f.receipt.path,f.receipt.sha256);manifest(JSON.parse(raw).inputs,{kind:'FAILED_RECEIPT',receipt:f.receipt.path});}
 for(let i=first+1;i<last;i++){
  if(context.records[i].type!=='step_start'||context.records[i].step!=='build-foundation')continue;
  const o=completed(context,i,'enterprise-builder',false),[p1,p2]=o.phases;
  for(const p of o.phases){assert.ok(typeof p.phaseExecutionId==='string'&&p.phaseExecutionId.length,'history phase execution required');assert.ok(Date.parse(p.timestamp)>=Date.parse(o.start.timestamp),'history phase timestamp');}
  assert.notEqual(p1.phaseExecutionId,p2.phaseExecutionId,'history phases share execution');assert.ok(Date.parse(p2.timestamp)>=Date.parse(p1.timestamp),'history phase time order');
  const paths=p=>[...new Set(p.content.match(/evidence\/enterprise\/[A-Za-z0-9_./-]+\/handoff\.json/g)??[])];
  const common=paths(p1).filter(path=>paths(p2).includes(path));assert.equal(common.length,1,'single phase-bound builder handoff required');
  const path=common[0],raw=bytes(root,path),sha256=hash(raw);
  for(const p of o.phases)assert.ok(new RegExp('\\b'+sha256+'\\b').test(p.content),'history handoff hash missing from phase');
  bind(path,sha256);const h=JSON.parse(raw);
  assert.equal(h.run,context.identity.runSlug,'history handoff run');assert.equal(h.iteration,o.start.iteration,'history handoff iteration');assert.equal(h.builderSession,o.session,'history handoff session');
  assert.ok(Array.isArray(h.references));assert.equal(new Set(h.references.map(e=>e.path)).size,h.references.length,'duplicate handoff reference');
  const provenance={path,sha256,startIndex:i,iteration:o.start.iteration,session:o.session,phases:o.phases.map(p=>({phase:p.phase,phaseExecutionId:p.phaseExecutionId,contentSha256:hash(p.content)}))};
  handoffs.push(provenance);
  for(const e of h.references)offer(e,path);
  // A declared full snapshot must itself be complete and intact. Do not fall
  // back to a live file when a named immutable copy is missing or tampered.
  if(h.inputs){
   manifest(h.inputs,{kind:'BUILDER_SNAPSHOT',handoff:path});assert.ok(Array.isArray(h.snapshots),'history snapshot copies required');
   assert.deepEqual(h.snapshots.map(({copy,...e})=>e),h.inputs.entries,'history snapshot coverage');
   assert.equal(new Set(h.snapshots.map(e=>e.copy)).size,h.snapshots.length,'duplicate snapshot copy');
   for(const e of h.snapshots){assert.ok(e.copy.startsWith(path.slice(0,-'handoff.json'.length)),'snapshot outside handoff directory');const ref=h.references.find(r=>r.path===e.copy);assert.deepEqual(ref,{path:e.copy,sha256:e.sha256,bytes:e.bytes},'snapshot reference missing');bind(e.copy,e.sha256,e.bytes);}
  }
  // Relocations are explicit statements inside the phase-bound handoff; they
  // must match a logical reference, and can never name files outside the root.
  for(const e of h.historyPreservation?.relocatedReferences??[]){
   const path=isAbsolute(e.actualPath)?relative(root,e.actualPath):e.actualPath;
   assert.ok(path.startsWith('evidence/enterprise/'),'history relocation outside evidence');
   offer({path,sha256:e.sha256,bytes:e.bytes},provenance.path,e.path);
  }
 }
 assert.ok(handoffs.length,'completed history builder required');
 // Resolve only recorded byte sources. A matching current hash by itself is
 // insufficient: some completed builder must have named the source and hash.
 const proofs=[];
 for(const {inputs:m} of manifests.values())for(const e of m.entries){
  const candidates=(pool.get(e.sha256+':'+e.bytes)??[]).filter(x=>x.logicalPath===e.path||x.path.startsWith('evidence/enterprise/'));
  const recorded=candidates.filter(x=>x.logicalPath===e.path);
  for(const x of recorded.filter(x=>x.path!==x.logicalPath))assert.ok(candidates.some(y=>y.path===x.logicalPath&&y.sha256===x.sha256),'unbound history relocation');
  const available=candidates.find(x=>existsSync(confined(root,x.path))&&hash(bytes(root,x.path))===e.sha256&&bytes(root,x.path).length===e.bytes);
  assert.ok(available,'historical input bytes unavailable: '+e.path+' '+m.digest);
  bind(available.path,e.sha256,e.bytes);proofs.push({inputsDigest:m.digest,...e,source:{path:available.path,handoff:available.handoff}});
 }
 // Re-read orchestration, ordinary authority, inputs and every consumed byte
 // after verification. A caller receives no terminal/initialization power.
 for(const r of references.values())bind(r.path,r.sha256,r.bytes);
 assert.deepEqual(await inspectRuntimePreparation(root),preparation,'concurrent history authority');
 assert.deepEqual(await currentContext(root),context,'concurrent history occurrence');assert.deepEqual(inputs(root),before,'concurrent history inputs');
 return {schemaVersion:1,kind:'SOURCE_INPUT_HISTORY_DIAGNOSTIC',initializationAuthority:false,currentApprovals:[],completeMigrationHistory:false,sourceRunSlug:context.identity.runSlug,iteration:context.iteration,designReportSha256:preparation.designReportSha256,currentInputs:before,handoffs,manifests:[...manifests.values()],proofs,references:[...references.values()],remaining:['DESIGN_EDIT_OCCURRENCE_PROVENANCE','SOURCE_TERMINAL_AND_QUIESCENCE','CANDIDATE_LAUNCHER_ENGINE_PROOF','TARGET_DESIGN_ORDER','PRIVATE_HISTORY_ARCHIVE_AND_ATOMIC_INITIALIZATION']};
}
// The inventory only locates bytes. It supplies neither a digest authority nor
// an occurrence whitelist: both come from actual completed source phases.
export async function inspectRuntimeDesignHistory(root,inventoryPath){
 root=resolve(root);
 const preparation=await inspectRuntimePreparation(root),context=await currentContext(root),before=inputs(root),references=new Map();
 assert.deepEqual(before,preparation.currentInputs,'changed design preparation inputs');
 const bind=(path,sha256,length)=>{const raw=bytes(root,path);if(sha256!==undefined)assert.equal(hash(raw),sha256,'changed design snapshot: '+path);if(length!==undefined)assert.equal(raw.length,length,'design snapshot length: '+path);const ref={path,sha256:hash(raw),bytes:raw.length};if(references.has(path))assert.deepEqual(references.get(path),ref,'conflicting design bytes');references.set(path,ref);return raw;};
 assert.ok(typeof inventoryPath==='string'&&inventoryPath.startsWith('evidence/enterprise/'),'design inventory outside evidence');
 const inventory=JSON.parse(bind(inventoryPath));assert.equal(inventory.schemaVersion,1);assert.equal(inventory.kind,'UNTRUSTED_DESIGN_BYTE_INVENTORY');assert.equal(inventory.run,context.identity.runSlug,'design inventory run');
 const first=context.records.findLastIndex(r=>r.type==='step_start'&&r.step==='review-foundation'),last=context.records.indexOf(context.start);
 const selected=context.records.flatMap((r,i)=>r.type==='step_start'&&r.step==='design-architecture'&&i>first&&i<last?[i]:[]);
 assert.ok(selected.length,'completed source designs required');assert.ok(Array.isArray(inventory.entries));assert.deepEqual(inventory.entries.map(e=>e.startIndex),selected,'complete design occurrence inventory required');
 const designs=[];
 for(const entry of inventory.entries){
  const m=entry.inputs;assert.ok(m&&Array.isArray(m.entries)&&m.entries.length,'design input manifest required');assert.deepEqual(m.runtime,context.identity.runtime,'design historical runtime drift');
  assert.equal(m.digest,hash(JSON.stringify({entries:m.entries,runtime:m.runtime})),'design manifest digest');
  assert.equal(new Set(m.entries.map(e=>e.path)).size,m.entries.length,'duplicate design input');
  for(const e of m.entries){confined(root,e.path);assert.match(e.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(e.bytes)&&e.bytes>=0,'design input length');}
  canonicalHistoricalInputs(root,m.entries);
  assert.ok(Array.isArray(entry.snapshots));assert.deepEqual(entry.snapshots.map(({copy,...e})=>e),m.entries,'design snapshot coverage');
  assert.equal(new Set(entry.snapshots.map(e=>e.copy)).size,entry.snapshots.length,'duplicate design copy');
  for(const e of entry.snapshots){assert.ok(typeof e.copy==='string'&&e.copy.startsWith('evidence/enterprise/'),'design copy outside evidence');bind(e.copy,e.sha256,e.bytes);}
  // Resolve the recorded project policy, never today's global policy. This
  // diagnostic supports self-contained step routing only; unrecorded profile
  // resources/assignments must not be obtained from the live environment.
  const policy=entry.snapshots.find(e=>e.path==='.takt/runtime.yaml');assert.ok(policy,'design routing snapshot required');
  const runtime=loadRuntimeProviderFileAt(confined(root,policy.copy));assert.ok(runtime?.provider,'design routing provider required');
  assert.ok(!runtime.provider.assignments&&!runtime.provider.directories&&!runtime.provider.auto_routing,'unsupported historical routing indirection');
  const env=compileProviderEnvironment({kind:'runtime-v1',section:runtime.provider});
  const start=context.records[entry.startIndex],def=context.steps.find(s=>s.name===start.step);
  assert.ok(env.providerRouting?.steps?.[start.step],'self-contained historical step routing required');
  const count=context.records.slice(0,entry.startIndex+1).filter(r=>r.type==='step_start'&&r.step===start.step&&r.workflow===start.workflow).length;
  assert.equal(start.stack?.length,1,'nested design history unsupported');assert.equal(start.stack[0].occurrence,count,'design occurrence count');assert.equal(start.stack[0].step,start.step,'design stack step');
  const initial=resolveStepProviderModel({...env,tagConflictPolicy:env.tagConflictPolicy,step:def});
  initial.providerOptions=resolveProfileScopedProviderOptionsLayers(def,env,initial.providerSource,true).at(-1)?.options??env.providerOptions;
  const promoted=await resolvePromotionRuntime({providerLadders:env.providerLadders,providerRoutingTagConflictPolicy:env.tagConflictPolicy,resolveStepProviderModel:()=>initial},def,count,{providerInfo:initial});
  const expected=promoted.providerInfo,routing={provider:expected.provider,model:expected.model,effort:expected.providerOptions?.codex?.reasoningEffort};
  assert.equal(routing.provider,'codex');assert.ok(routing.model&&routing.effort,'unresolved historical design routing');
  const o=completed(context,entry.startIndex,'enterprise-architect',false,routing),[p1,p2]=o.phases;
  assert.equal(start.providerSource,expected.providerSource,'design provider source');assert.equal(start.modelSource,expected.modelSource,'design model source');
  assert.ok(!context.builderSessions.includes(o.session),'design session aliases builder');
  for(const p of o.phases){assert.ok(typeof p.phaseExecutionId==='string'&&p.phaseExecutionId.length,'design phase execution required');assert.ok(Date.parse(p.timestamp)>=Date.parse(start.timestamp),'design phase timestamp');
   const blocks=[...p.content.matchAll(/^```text\r?\n([\s\S]*?)^```\s*$/gm)],digests=blocks.flatMap(b=>{const match=b[1].match(/^(?:inputsDigest|入力集合digest)\r?\n([a-f0-9]{64})(?:\r?\n|$)/);return match?[match[1]]:[];});
   assert.equal(digests.length,1,'single explicit design inputsDigest required');assert.equal(digests[0],m.digest,'phase design digest');
  }
  assert.notEqual(p1.phaseExecutionId,p2.phaseExecutionId,'design phase execution reused');assert.ok(Date.parse(p2.timestamp)>=Date.parse(p1.timestamp),'design phase time order');
  // TAKT's step_complete timestamp is response.timestamp (Phase 1), not
  // the time the terminal record was emitted after reporting/judgment.
  const done=context.records.slice(o.index+1,o.end).find(r=>r.type==='step_complete');
  assert.ok(Date.parse(done.timestamp)>=Date.parse(start.timestamp)&&Date.parse(done.timestamp)<=Date.parse(p1.timestamp),'design response timestamp');
  if(context.records[o.end])assert.ok(Date.parse(context.records[o.end].timestamp)>=Date.parse(p2.timestamp),'design next occurrence time');
  // Canonical report can only attest the latest design; older reports live in
  // their actual phase records. Do not compare them to a later overwritten file.
  if(entry.startIndex===selected.at(-1)){
   assert.equal(def.outputContracts?.length,1,'design report contract');const path=relative(context.identity.runRoot,context.identity.reportDirectory)+'/'+def.outputContracts[0].name;
   const raw=readFileSync(confined(context.identity.runRoot,path));assert.ok(raw.toString()===p2.content||raw.toString()===p2.content+'\n','design canonical report mismatch');
   designs.push({startIndex:o.index,iteration:start.iteration,session:o.session,occurrence:count,routing,inputs:m,snapshots:entry.snapshots,canonical:{path,sha256:hash(raw)},phases:o.phases.map(p=>({phase:p.phase,phaseExecutionId:p.phaseExecutionId,contentSha256:hash(p.content)}))});
  }else designs.push({startIndex:o.index,iteration:start.iteration,session:o.session,occurrence:count,routing,inputs:m,snapshots:entry.snapshots,phases:o.phases.map(p=>({phase:p.phase,phaseExecutionId:p.phaseExecutionId,contentSha256:hash(p.content)}))});
 }
 // No caller-provided 'current' or approval flags are honored. Preserve source
 // authorities and every consumed byte across this read-only inspection.
 for(const r of references.values())bind(r.path,r.sha256,r.bytes);
 for(const d of designs.filter(d=>d.canonical))assert.equal(hash(readFileSync(confined(context.identity.runRoot,d.canonical.path))),d.canonical.sha256,'concurrent design report');
 assert.deepEqual(await inspectRuntimePreparation(root),preparation,'concurrent design authority');assert.deepEqual(await currentContext(root),context,'concurrent design occurrence');assert.deepEqual(inputs(root),before,'concurrent design inputs');
 return {schemaVersion:1,kind:'SOURCE_DESIGN_HISTORY_DIAGNOSTIC',initializationAuthority:false,currentApprovals:[],completeMigrationHistory:false,sourceRunSlug:context.identity.runSlug,iteration:context.iteration,designReportSha256:preparation.designReportSha256,currentInputs:before,designs,references:[...references.values()],remaining:['COMPLETE_SOURCE_TRANSITION_CHAIN','SOURCE_TERMINAL_AND_QUIESCENCE','CANDIDATE_LAUNCHER_ENGINE_PROOF','TARGET_DESIGN_ORDER','PRIVATE_HISTORY_ARCHIVE_AND_ATOMIC_INITIALIZATION']};
}
// Join authenticated checkpoints in actual source order. A comparison between
// completed occurrences is not proof that no unobserved filesystem writer ran.
// This diagnostic deliberately does not certify exclusive authorship or H.
export async function inspectRuntimeTransitions(root,inventoryPath){
 root=resolve(root);const context=await currentContext(root),before=inputs(root);
 const history=await inspectRuntimeInputHistory(root),design=await inspectRuntimeDesignHistory(root,inventoryPath);
 assert.deepEqual(history.currentInputs,before,'transition history inputs');assert.deepEqual(design.currentInputs,before,'transition design inputs');
 assert.equal(history.designReportSha256,design.designReportSha256,'transition design authority');
 const references=new Map();
 for(const r of [...history.references,...design.references]){if(references.has(r.path))assert.deepEqual(references.get(r.path),r,'conflicting transition reference');references.set(r.path,r);}
 const manifests=new Map(history.manifests.map(m=>[m.inputs.digest,m.inputs]));
 for(const d of design.designs){if(manifests.has(d.inputs.digest))assert.deepEqual(manifests.get(d.inputs.digest),d.inputs,'conflicting transition manifest');manifests.set(d.inputs.digest,d.inputs);}
 const progress=read(root,'work/enterprise/progress.json'),selection=read(root,progress.entrySelection),anchor=manifests.get(selection.inputsDigest);
 assert.ok(anchor,'transition prefix manifest missing');
 const first=context.records.findLastIndex(r=>r.type==='step_start'&&r.step==='review-foundation'),last=context.records.indexOf(context.start);
 const checkpoints=[{kind:'REVIEWED_PREFIX',startIndex:first,iteration:context.records[first].iteration,inputsDigest:anchor.digest}],observations=[],phaseIds=new Set();
 let previousStart=context.records[first],previousPhaseTime=Date.parse(previousStart.timestamp);
 for(let i=first+1;i<last;i++){
  const s=context.records[i];if(s.type!=='step_start')continue;
  assert.ok(s.iteration>previousStart.iteration,'transition iteration order');
  assert.ok(Date.parse(s.timestamp)>=previousPhaseTime,'transition occurrence time order');previousStart=s;
  const def=context.steps.find(d=>d.name===s.step);assert.ok(def,'unknown transition step');
  let binding,o;
  if(s.step==='build-foundation'){
   binding=history.handoffs.find(h=>h.startIndex===i);assert.ok(binding,'transition builder checkpoint missing');o=completed(context,i,'enterprise-builder',false);
  }else if(s.step==='design-architecture'){
   binding=design.designs.find(d=>d.startIndex===i);assert.ok(binding,'transition design checkpoint missing');o=completed(context,i,'enterprise-architect',false,binding.routing);
  }else{
   assert.equal(s.step,'review-architecture','unknown transition writer');o=completed(context,i,'enterprise-architecture-reviewer');
  }
  for(const p of o.phases){assert.ok(typeof p.phaseExecutionId==='string'&&p.phaseExecutionId.length,'transition phase execution missing');assert.ok(!phaseIds.has(p.phaseExecutionId),'transition phase execution reused');phaseIds.add(p.phaseExecutionId);}
  assert.ok(Date.parse(o.phases[0].timestamp)>=Date.parse(s.timestamp)&&Date.parse(o.phases[1].timestamp)>=Date.parse(o.phases[0].timestamp),'transition phase time order');
  previousPhaseTime=Date.parse(o.phases[1].timestamp);assert.ok(Number.isFinite(previousPhaseTime),'transition phase time');
  const occurrence={startIndex:i,step:s.step,iteration:s.iteration,session:o.session,phases:o.phases.map(p=>({phase:p.phase,phaseExecutionId:p.phaseExecutionId,contentSha256:hash(p.content)}))};
  observations.push({...occurrence,edit:def.edit});
  if(!binding)continue;
  let digest;
  if(s.step==='build-foundation'){
   const h=read(root,binding.path);digest=h.inputs?.digest??h.inputsDigest;
   if(h.inputs&&h.inputsDigest!==undefined)assert.equal(h.inputsDigest,h.inputs.digest,'conflicting builder endpoint digest');
   assert.ok(manifests.has(digest),'transition builder endpoint manifest missing');
   // Receipt timestamps were authenticated against the source builder by the
   // preparation reader. Include every failed checkpoint, even unchanged ones.
   const failures=[];
   for(const m of history.manifests)for(const origin of m.origins.filter(x=>x.kind==='FAILED_RECEIPT')){
    const r=read(root,origin.receipt),next=context.records[o.end];
    if(Date.parse(r.startedAt)>=Date.parse(s.timestamp)&&Date.parse(r.finishedAt)<=Date.parse(next.timestamp)){
     const beforeReport=Date.parse(r.finishedAt)<=Date.parse(o.phases[0].timestamp);
     // D_S binds the actual receipt bytes and owner. A later receipt may be
     // ordered only after BOTH report phases, with the exact reported input.
     // This proves checkpoint order, not that the automatic gate launched it.
     if(!beforeReport){
      assert.ok(Date.parse(r.startedAt)>=Date.parse(o.phases[1].timestamp),'transition receipt overlaps report phases');
      assert.equal(m.inputs.digest,digest,'transition receipt after reported endpoint unsupported: input changed');
      assert.deepEqual(m.inputs,manifests.get(digest),'transition post-report manifest mismatch');
     }
     failures.push({...occurrence,kind:'FAILED_RECEIPT',receipt:origin.receipt,startedAt:r.startedAt,finishedAt:r.finishedAt,reportRelation:beforeReport?'BEFORE_REPORT':'AFTER_REPORT',inputsDigest:m.inputs.digest,...(!beforeReport?{automaticGateOriginProven:false}: {})});
    }
   }
   // Repeated input digests group receipts in the byte reader. Restore actual
   // execution order rather than using that manifest-grouping order.
   failures.sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt));
   for(let n=1;n<failures.length;n++)assert.ok(Date.parse(failures[n].startedAt)>=Date.parse(failures[n-1].finishedAt),'transition overlapping failed receipts');
   checkpoints.push(...failures.filter(f=>f.reportRelation==='BEFORE_REPORT'));
   checkpoints.push({...occurrence,kind:'BUILDER_ENDPOINT',handoff:binding.path,inputsDigest:digest});
   checkpoints.push(...failures.filter(f=>f.reportRelation==='AFTER_REPORT'));
  }else checkpoints.push({...occurrence,kind:'DESIGN_ENDPOINT',inputsDigest:binding.inputs.digest});
 }
 assert.ok(Date.parse(context.start.timestamp)>=previousPhaseTime,'transition current occurrence time');
 assert.equal(checkpoints.filter(c=>c.kind==='BUILDER_ENDPOINT').length,history.handoffs.length,'transition builder coverage');
 assert.equal(checkpoints.filter(c=>c.kind==='DESIGN_ENDPOINT').length,design.designs.length,'transition design coverage');
 const expectedFailures=history.manifests.flatMap(m=>m.origins.filter(o=>o.kind==='FAILED_RECEIPT').map(o=>o.receipt));
 assert.deepEqual(checkpoints.filter(c=>c.kind==='FAILED_RECEIPT').map(c=>c.receipt).sort(),expectedFailures.sort(),'transition failure coverage');
 const transitions=checkpoints.slice(1).map((to,index)=>{
  const from=checkpoints[index],a=new Map(manifests.get(from.inputsDigest).entries.map(e=>[e.path,e])),b=new Map(manifests.get(to.inputsDigest).entries.map(e=>[e.path,e]));
  const changes=[...new Set([...a.keys(),...b.keys()])].sort().flatMap(path=>{const old=a.get(path)??null,next=b.get(path)??null;return JSON.stringify(old)===JSON.stringify(next)?[]:[{path,before:old,after:next}];});
  return {from:index,to:index+1,fromDigest:from.inputsDigest,toDigest:to.inputsDigest,changes,attribution:'OBSERVED_CHECKPOINT_INTERVAL',exclusiveWriterProven:false};
 });
 for(const r of references.values()){const raw=bytes(root,r.path);assert.equal(hash(raw),r.sha256,'concurrent transition bytes');assert.equal(raw.length,r.bytes);}
 for(const d of design.designs.filter(d=>d.canonical))assert.equal(hash(readFileSync(confined(context.identity.runRoot,d.canonical.path))),d.canonical.sha256,'concurrent transition design report');
 const finalPreparation=await inspectRuntimePreparation(root);assert.equal(finalPreparation.designReportSha256,history.designReportSha256,'concurrent transition authority');assert.deepEqual(finalPreparation.currentInputs,before,'concurrent transition preparation inputs');
 assert.deepEqual(await currentContext(root),context,'concurrent transition context');assert.deepEqual(inputs(root),before,'concurrent transition inputs');
 return {schemaVersion:1,kind:'SOURCE_INPUT_TRANSITION_DIAGNOSTIC',sourceRunSlug:context.identity.runSlug,iteration:context.iteration,builderSession:context.providerSessionId,designReportSha256:history.designReportSha256,currentInputs:before,initializationAuthority:false,currentApprovals:[],completeMigrationHistory:false,exclusiveWriterProven:false,checkpoints,observations,transitions,currentBuilder:{iteration:context.iteration,session:context.providerSessionId,status:'OPEN_UNATTESTED_ENDPOINT'},references:[...references.values()],remaining:['EXCLUSIVE_INPUT_TRANSITION_AUTHORSHIP','SOURCE_TERMINAL_AND_QUIESCENCE','CANDIDATE_LAUNCHER_ENGINE_PROOF','TARGET_DESIGN_ORDER','PRIVATE_HISTORY_ARCHIVE_AND_ATOMIC_INITIALIZATION']};
}
// R1 prerequisite: input snapshots alone do not cover historical evidence.
// Search only byte locations named by actual, phase-bound builder handoffs.
// This is deliberately separate from the legacy input-only diagnostic.
export async function inspectRuntimeReferenceHistory(root){
 root=resolve(root);const history=await inspectRuntimeInputHistory(root),context=await currentContext(root);
 const requirements=[],locations=new Map(),handoffBytes=new Map();
 const requireEntry=(entry,consumer)=>{
  confined(root,entry.path);assert.match(entry.sha256,/^[a-f0-9]{64}$/,'historical reference hash');
  if(entry.bytes!==undefined)assert.ok(Number.isSafeInteger(entry.bytes)&&entry.bytes>=0,'historical reference length');
  requirements.push({path:entry.path,sha256:entry.sha256,...(entry.bytes===undefined?{}:{bytes:entry.bytes}),consumer});
 };
 for(const h of history.handoffs){
  const raw=bytes(root,h.path);assert.equal(hash(raw),h.sha256,'changed phase-bound handoff');handoffBytes.set(h.path,raw);
  const value=JSON.parse(raw);
  for(const [i,r] of value.references.entries()){
   const consumer={handoff:h.path,handoffSha256:h.sha256,iteration:h.iteration,pointer:`/references/${i}`};
   requireEntry(r,consumer);
   const key=r.path+'\0'+r.sha256;
   if(!locations.has(key))locations.set(key,{path:r.path,sha256:r.sha256,bytes:r.bytes,consumers:[]});
   locations.get(key).consumers.push(consumer);
  }
  // These are acknowledged losses, not exceptions to history completeness.
  for(const [i,r] of (value.historyPreservation?.historicalDifferences??[]).entries())requireEntry(r,{handoff:h.path,handoffSha256:h.sha256,iteration:h.iteration,pointer:`/historyPreservation/historicalDifferences/${i}`});
 }
 const observed=new Map(),available=new Map(),byHash=new Map();
 for(const l of locations.values()){
  const matching=byHash.get(l.sha256)??[];matching.push(l);byHash.set(l.sha256,matching);
  let observation=observed.get(l.path);
  if(!observation){
   // Missing bytes can be reported; unsafe paths, symlinks and I/O errors fail.
   const path=confined(root,l.path);
   observation=existsSync(path)?{path:l.path,sha256:hash(bytes(root,l.path)),bytes:bytes(root,l.path).length}:{path:l.path,missing:true};
   observed.set(l.path,observation);
  }
  if(observation.sha256===l.sha256&&observation.bytes===l.bytes){const list=available.get(l.sha256)??[];list.push(l);available.set(l.sha256,list);}
 }
 const proofs=[],missing=[];
 for(const r of requirements){
  const candidates=(byHash.get(r.sha256)??[]).filter(l=>r.bytes===undefined||r.bytes===l.bytes);
  const source=(available.get(r.sha256)??[]).find(l=>r.bytes===undefined||r.bytes===l.bytes);
  if(source)proofs.push({...r,source:{path:source.path,sha256:source.sha256,bytes:source.bytes,recordedBy:source.consumers[0]}});
  else missing.push({...r,searched:candidates.map(l=>({path:l.path,...observed.get(l.path)}))});
 }
 // Recheck every observed location, including absent/changed candidates, so a
 // concurrent replacement cannot silently change the search result.
 for(const o of observed.values()){
  const path=confined(root,o.path);assert.equal(existsSync(path),!o.missing,'concurrent history location');
  if(!o.missing){const raw=bytes(root,o.path);assert.equal(hash(raw),o.sha256,'concurrent history reference');assert.equal(raw.length,o.bytes);}
 }
 for(const [path,raw] of handoffBytes)assert.deepEqual(bytes(root,path),raw,'concurrent history handoff');
 assert.deepEqual(await currentContext(root),context,'concurrent reference context');
 assert.deepEqual(inputs(root),history.currentInputs,'concurrent reference inputs');
 return {schemaVersion:1,kind:'SOURCE_REFERENCE_HISTORY',sourceRunSlug:history.sourceRunSlug,iteration:history.iteration,designReportSha256:history.designReportSha256,currentInputs:history.currentInputs,initializationAuthority:false,currentApprovals:[],completeMigrationHistory:false,referenceBytesComplete:missing.length===0,handoffs:history.handoffs,searchLocations:[...locations.values()],observations:[...observed.values()],proofs,missing};
}
export async function requireRuntimeReferenceHistory(root){
 const result=await inspectRuntimeReferenceHistory(root);
 if(!result.referenceBytesComplete){const error=new Error('historical reference bytes unavailable');error.missing=result.missing;throw error;}
 return result;
}
// The locator supplies locations only. Expected bytes come from the actual
// source order and runtime identity, never from caller-supplied hashes/version.
// Do not import/execute these historical modules or use them as currentContext.
function readRuntimeByteCopies(root,inventory,context,preparation){
 assert.equal(inventory.schemaVersion,1);assert.equal(inventory.kind,'UNTRUSTED_RUNTIME_BYTE_INVENTORY');
 assert.equal(inventory.run,context.identity.runSlug,'runtime byte inventory run');
 assert.equal(inventory.designReportSha256,preparation.designReportSha256,'runtime byte inventory design');
 const identity=context.identity.runtime;
 assert.deepEqual(identity.sources.map(s=>s.path),runtimeFiles,'runtime byte source catalog');
 assert.ok(Array.isArray(inventory.sources));
 assert.deepEqual(inventory.sources.map(s=>s.path),runtimeFiles,'complete ordered runtime byte inventory required');
 const references=[],copies=new Set();
 const bind=(copy,sha256)=>{
  assert.ok(typeof copy==='string'&&copy.startsWith('evidence/enterprise/'),'runtime copy outside evidence');
  const absolute=confined(root,copy);assert.equal(relative(root,absolute),copy,'runtime copy noncanonical path');
  assert.ok(!copy.includes('\\'),'runtime copy separator');assert.ok(!copies.has(copy),'duplicate runtime copy');copies.add(copy);
  const raw=bytes(root,copy);assert.equal(hash(raw),sha256,'historical runtime bytes mismatch: '+copy);
  references.push({path:copy,sha256,bytes:raw.length});return raw;
 };
 const sources=identity.sources.map((expected,i)=>{
  const raw=bind(inventory.sources[i].copy,expected.sha256);
  if(expected.path==='package.json'){const pkg=JSON.parse(raw);assert.equal(pkg.name,'takt');assert.equal(pkg.version,identity.version,'historical runtime package version');}
  return {...expected,bytes:raw.length,copy:inventory.sources[i].copy};
 });
 const project={};
 for(const path of ['package.json','package-lock.json']){
  const expected=preparation.references.find(r=>r.path===path);assert.ok(expected,'source package authority missing');
  project[path]=JSON.parse(bind(inventory.project?.[path],expected.sha256));
 }
 assert.equal(project['package.json'].devDependencies?.takt,identity.version,'historical project runtime pin');
 assert.equal(project['package-lock.json'].packages?.['node_modules/takt']?.version,identity.version,'historical lock runtime version');
 // The lock's integrity string is retained as bytes, not verified against a
 // complete npm tarball here. These 16 sources are not the full distribution.
 return {identity,sources,references};
}
export async function inspectRuntimeByteHistory(root,inventoryPath){
 root=resolve(root);const preparation=await inspectRuntimePreparation(root),context=await currentContext(root);
 assert.deepEqual(preparation.currentInputs,inputs(root),'runtime byte preparation inputs');
 assert.ok(typeof inventoryPath==='string'&&inventoryPath.startsWith('evidence/enterprise/'),'runtime inventory outside evidence');
 const raw=bytes(root,inventoryPath),result=readRuntimeByteCopies(root,JSON.parse(raw),context,preparation);
 for(const r of result.references){const value=bytes(root,r.path);assert.equal(hash(value),r.sha256,'concurrent runtime copy');assert.equal(value.length,r.bytes);}
 assert.deepEqual(bytes(root,inventoryPath),raw,'concurrent runtime inventory');
 assert.deepEqual(await inspectRuntimePreparation(root),preparation,'concurrent runtime byte authority');
 assert.deepEqual(await currentContext(root),context,'concurrent runtime byte context');
 assert.deepEqual(inputs(root),preparation.currentInputs,'concurrent runtime byte inputs');
 for(const r of result.references){const value=bytes(root,r.path);assert.equal(hash(value),r.sha256,'concurrent runtime copy');assert.equal(value.length,r.bytes);}
 assert.deepEqual(bytes(root,inventoryPath),raw,'concurrent runtime inventory');
 return {schemaVersion:1,kind:'SOURCE_RUNTIME_BYTE_HISTORY',sourceRunSlug:context.identity.runSlug,iteration:context.iteration,designReportSha256:preparation.designReportSha256,currentInputs:preparation.currentInputs,runtime:result.identity,sources:result.sources,references:[{path:inventoryPath,sha256:hash(raw),bytes:raw.length},...result.references],runtimeIdentityBytesComplete:true,distributionIntegrityProven:false,completeMigrationHistory:false,initializationAuthority:false,currentApprovals:[]};
}
// Parse in memory only, after authenticating the entire compressed artifact.
// No extraction, package installation, historical import or network fallback.
async function distributionEntries(raw,packageMetadata=false){
 assert.ok(raw.length<=64*1024*1024,'runtime distribution compressed size');
 assert.equal(raw.subarray(0,2).toString('hex'),'1f8b','runtime distribution gzip required');
 const tar=gunzipSync(raw,{maxOutputLength:128*1024*1024});
 const entries=[],seen=new Set();
 await new Promise((done,reject)=>{
  const parser=new Parser({strict:true});
  parser.on('error',reject);parser.on('warn',(_code,message)=>reject(Error(message)));parser.on('ignoredEntry',()=>reject(Error('unsupported runtime distribution entry')));
  parser.on('entry',entry=>{
   try{
    assert.ok(['File','Directory'].includes(entry.type),'runtime distribution entry type');
    const name=entry.type==='Directory'?entry.path.replace(/\/$/,''):entry.path;
    assert.ok(name==='package'||name.startsWith('package/'),'runtime distribution package root');
    assert.ok(!name.includes('\\')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'),'runtime distribution noncanonical entry');
    assert.ok(!seen.has(name),'runtime distribution duplicate entry');seen.add(name);
    assert.ok(Number.isSafeInteger(entry.size)&&entry.size>=0,'runtime distribution entry length');
    assert.ok(!entry.linkpath,'runtime distribution link');
    if(entry.type==='Directory')assert.equal(entry.size,0,'runtime distribution directory bytes');
    const capture=packageMetadata&&entry.type==='File'&&/^package\/(?:node_modules\/(?:@[^/]+\/)?[^/]+\/)*package\.json$/.test(name),chunks=[];
    if(capture)assert.ok(entry.size<=1024*1024,'package metadata size: '+name);
    const digest=createHash('sha256');let length=0;
    entry.on('data',chunk=>{length+=chunk.length;digest.update(chunk);if(capture)chunks.push(chunk);});
    entry.on('end',()=>{try{
     assert.equal(length,entry.size,'runtime distribution truncated entry');
     if(entry.type==='File'){
      const record={path:name,sha256:digest.digest('hex'),bytes:length};
      if(capture){
       const metadata=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
       assert.ok(metadata&&typeof metadata==='object'&&!Array.isArray(metadata),'package metadata object: '+name);
       const expected=name==='package/package.json'?'takt':name.slice(0,-'/package.json'.length).split('/node_modules/').at(-1);
       assert.equal(metadata.name,expected,'package metadata name: '+name);
       assert.ok(typeof metadata.version==='string'&&metadata.version.trim().length>0,'package metadata version: '+name);
       record.metadata=metadata;
      }
      entries.push(record);
     }
    }catch(e){reject(new Error('runtime distribution entry '+name+': '+e.message,{cause:e}));}});
    entry.resume();
   }catch(e){reject(e);entry.resume();}
  });
  parser.on('end',done);parser.end(tar);
 });
 assert.ok(entries.length,'runtime distribution files required');
 return entries.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
export async function inspectRuntimeDistributionHistory(root,inventoryPath){
 root=resolve(root);const history=await inspectRuntimeByteHistory(root,inventoryPath),inventoryRaw=bytes(root,inventoryPath),inventory=JSON.parse(inventoryRaw);
 assert.equal(hash(inventoryRaw),history.references.find(r=>r.path===inventoryPath)?.sha256,'changed runtime distribution inventory');
 const lockRaw=bytes(root,inventory.project['package-lock.json']);assert.equal(hash(lockRaw),history.references.find(r=>r.path===inventory.project['package-lock.json'])?.sha256,'changed runtime distribution lock');
 const lock=JSON.parse(lockRaw),locked=lock.packages?.['node_modules/takt'];
 assert.match(locked?.integrity??'',/^sha512-[A-Za-z0-9+/]{86}==$/,'runtime distribution sha512 integrity required');
 const copy=inventory.distribution?.copy;
 assert.ok(typeof copy==='string'&&copy.startsWith('evidence/enterprise/'),'runtime distribution outside evidence');
 assert.equal(relative(root,confined(root,copy)),copy,'runtime distribution noncanonical copy');assert.ok(!copy.includes('\\'),'runtime distribution copy separator');
 assert.ok(!history.references.some(r=>r.path===copy),'runtime distribution copy aliases another input');
 const raw=bytes(root,copy);
 assert.equal('sha512-'+createHash('sha512').update(raw).digest('base64'),locked.integrity,'runtime distribution integrity mismatch');
 const entries=await distributionEntries(raw);
 for(const source of history.sources){
  const path=source.path==='package.json'?'package/package.json':source.path.startsWith('../')?'package/'+source.path.slice(3):'package/dist/'+source.path;
  const entry=entries.find(e=>e.path===path);assert.ok(entry,'runtime distribution identity source missing: '+path);
  assert.equal(entry.sha256,source.sha256,'runtime distribution identity source mismatch: '+path);assert.equal(entry.bytes,source.bytes);
 }
 assert.deepEqual(await inspectRuntimeByteHistory(root,inventoryPath),history,'concurrent runtime distribution authority');
 assert.deepEqual(bytes(root,inventoryPath),inventoryRaw,'concurrent runtime distribution inventory');assert.deepEqual(bytes(root,copy),raw,'concurrent runtime distribution bytes');
 return {...history,kind:'SOURCE_RUNTIME_DISTRIBUTION_HISTORY',distributionIntegrityProven:true,dependencyClosureIntegrityProven:false,distribution:{package:'takt',version:history.runtime.version,integrity:locked.integrity,path:copy,sha256:hash(raw),bytes:raw.length,entries},references:[...history.references,{path:copy,sha256:hash(raw),bytes:raw.length}]};
}
// Bind each historical manifest to the preserved distribution using that
// manifest's own package/lock bytes. A current project lock is not a substitute
// for a receipt's lock. The join remains source preparation, not a target reader.
export async function inspectRuntimeInputDistributions(root,inventoryPath){
 root=resolve(root);const context=await currentContext(root),history=await inspectRuntimeInputHistory(root),distribution=await inspectRuntimeDistributionHistory(root,inventoryPath);
 for(const key of ['sourceRunSlug','iteration','designReportSha256'])assert.equal(history[key],distribution[key],'historical distribution authority');
 assert.deepEqual(history.currentInputs,distribution.currentInputs,'historical distribution input boundary');
 const references=new Map();
 for(const r of [...history.references,...distribution.references]){if(references.has(r.path))assert.deepEqual(references.get(r.path),r,'conflicting distribution reference');references.set(r.path,r);}
 const bindings=history.manifests.map(({inputs:m,origins})=>{
  assert.deepEqual(m.runtime,distribution.runtime,'historical distribution runtime');
  const readInput=path=>{
   const entry=m.entries.find(e=>e.path===path);assert.ok(entry,'historical runtime input missing: '+path);
   const proof=history.proofs.find(p=>p.inputsDigest===m.digest&&p.path===path);assert.ok(proof,'historical runtime byte proof missing: '+path);
   assert.equal(proof.sha256,entry.sha256);assert.equal(proof.bytes,entry.bytes);
   const raw=bytes(root,proof.source.path);assert.equal(hash(raw),entry.sha256,'historical runtime input changed');assert.equal(raw.length,entry.bytes);
   return {value:JSON.parse(raw),reference:{...entry,source:proof.source}};
  };
  const pkg=readInput('package.json'),lock=readInput('package-lock.json'),locked=lock.value.packages?.['node_modules/takt'];
  assert.equal(pkg.value.devDependencies?.takt,m.runtime.version,'historical manifest runtime pin');
  assert.equal(locked?.version,m.runtime.version,'historical manifest locked version');
  assert.equal(locked?.integrity,distribution.distribution.integrity,'historical manifest distribution integrity');
  return {inputsDigest:m.digest,origins,runtimeIdentitySha256:hash(JSON.stringify(m.runtime)),package:pkg.reference,lock:lock.reference,distribution:{path:distribution.distribution.path,sha256:distribution.distribution.sha256,integrity:locked.integrity},identitySourceCount:distribution.sources.length};
 });
 // Every saved receipt and builder snapshot participates. The caller cannot
 // supply a receipt whitelist, expected digest, or a replacement current lock.
 assert.equal(bindings.length,history.manifests.length);
 for(const r of references.values()){const raw=bytes(root,r.path);assert.equal(hash(raw),r.sha256,'concurrent historical distribution bytes');assert.equal(raw.length,r.bytes);}
 assert.deepEqual(await currentContext(root),context,'concurrent historical distribution context');
 const preparation=await inspectRuntimePreparation(root);assert.equal(preparation.designReportSha256,history.designReportSha256);assert.deepEqual(preparation.currentInputs,history.currentInputs);
 return {schemaVersion:1,kind:'SOURCE_INPUT_DISTRIBUTION_BINDINGS',sourceRunSlug:history.sourceRunSlug,iteration:history.iteration,designReportSha256:history.designReportSha256,currentInputs:history.currentInputs,bindings,references:[...references.values()],runtimeIdentityBytesComplete:true,distributionIntegrityProven:true,historicalManifestDistributionBindingsComplete:true,dependencyClosureIntegrityProven:false,completeMigrationHistory:false,initializationAuthority:false,currentApprovals:[]};
}
// Metadata is evidence from the authenticated artifact, not a replacement for
// missing lock declarations, version constraints or installed source hashes.
export async function inspectRuntimePackageMetadata(root,inventoryPath){
 root=resolve(root);const context=await currentContext(root),history=await inspectRuntimeInputDistributions(root,inventoryPath);
 return bindRuntimePackageMetadata(root,context,history);
}
// Both callers supply independently authenticated occurrence-specific bindings.
async function bindRuntimePackageMetadata(root,context,history){
 const packages=[],artifacts=new Set(),bindings=[],unresolved=[];
 for(const binding of history.bindings){
  const d=binding.distribution;
  if(!artifacts.has(d.path)){
   const raw=bytes(root,d.path);assert.equal(hash(raw),d.sha256,'changed package metadata artifact');
   assert.equal('sha512-'+createHash('sha512').update(raw).digest('base64'),d.integrity,'package metadata artifact integrity');
   for(const entry of await distributionEntries(raw,true))if(entry.metadata)packages.push({...entry,artifact:d.path,location:'node_modules/takt'+entry.path.slice('package'.length,-'/package.json'.length)});
   artifacts.add(d.path);
  }
  const lockRaw=bytes(root,binding.lock.source.path);assert.equal(hash(lockRaw),binding.lock.sha256,'changed package metadata lock');assert.equal(lockRaw.length,binding.lock.bytes);
  const lock=JSON.parse(lockRaw);assert.ok(lock.packages&&typeof lock.packages==='object'&&!Array.isArray(lock.packages),'package metadata lock packages');
  const matches=[];
  for(const entry of packages.filter(p=>p.artifact===d.path)){
   const locked=lock.packages[entry.location];
   if(locked===undefined){unresolved.push({inputsDigest:binding.inputsDigest,location:entry.location,artifact:d.path,metadataPath:entry.path,reason:'LOCK_PACKAGE_LOCATION_UNAVAILABLE'});continue;}
   assert.ok(locked&&typeof locked==='object'&&!Array.isArray(locked)&&!locked.link,'package metadata unsupported lock entry: '+entry.location);
   assert.equal(locked.version,entry.metadata.version,'package metadata version mismatch: '+entry.location);
   matches.push({location:entry.location,metadataPath:entry.path,sha256:entry.sha256,bytes:entry.bytes});
  }
  bindings.push({...binding,packages:matches});
 }
 for(const r of history.references){const raw=bytes(root,r.path);assert.equal(hash(raw),r.sha256,'concurrent package metadata bytes');assert.equal(raw.length,r.bytes);}
 assert.deepEqual(await currentContext(root),context,'concurrent package metadata context');
 const preparation=await inspectRuntimePreparation(root);assert.equal(preparation.designReportSha256,history.designReportSha256);assert.deepEqual(preparation.currentInputs,history.currentInputs);
 return {...history,kind:'READ_ONLY_HISTORY_ASSESSMENT',component:'ARCHIVED_PACKAGE_METADATA',bindings,packages,unresolved,dependencyClosureIntegrityProven:false,completeMigrationHistory:false,automaticGateOriginProven:false,initializationAuthority:false,currentApprovals:[]};
}
// Data-only comparison. The source entry below authenticates both operands.
// Equal declaration text does not prove installed versions satisfy its ranges.
export function assessPackageDependencyDeclarations(locked,metadata,location){
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 const check=(v,field,message)=>assert.ok(v,`dependency declarations ${location}/${field}: ${message}`);
 const namePattern=/^(?:@[a-zA-Z0-9_~-][a-zA-Z0-9._~-]*\/)?[a-zA-Z0-9_~-][a-zA-Z0-9._~-]*$/;
 const fields=['dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta'];
 const normalize=(pkg,side)=>{
  check(object(pkg),side,'package object required');const result={};
  for(const field of fields){
   const value=pkg[field]===undefined?{}:pkg[field];check(object(value),field,side+' map required');
   result[field]=Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en')).map(([name,spec])=>{
    check(namePattern.test(name),field,side+' invalid name '+name);
    if(field==='peerDependenciesMeta'){
     check(object(spec)&&Object.keys(spec).every(k=>k==='optional')&&(spec.optional===undefined||typeof spec.optional==='boolean'),field,side+' unsupported peer metadata '+name);
     return [name,Object.hasOwn(spec,'optional')?{optional:spec.optional}:{}];
    }
    check(typeof spec==='string'&&spec.length>0&&spec.trim()===spec,field,side+' invalid spec '+name);return [name,spec];
   }));
  }
  return result;
 };
 const declarations=normalize(locked,'lock'),saved=normalize(metadata,'archive');
 for(const field of fields)assert.deepEqual(declarations[field],saved[field],`dependency declarations ${location}/${field}: archive/lock mismatch`);
 const platformFields=['os','cpu','libc'];
 const normalizePlatform=(pkg,side)=>Object.fromEntries(platformFields.map(field=>{
  if(!Object.hasOwn(pkg,field))return [field,null];
  const value=pkg[field];
  check(Array.isArray(value)&&value.length>0,field,side+' platform list required');
  check(value.every(v=>typeof v==='string'&&/^!?[a-zA-Z0-9_-]+$/.test(v)),field,side+' invalid platform selector');
  check(new Set(value).size===value.length,field,side+' duplicate platform selector');
  return [field,[...value].sort()];
 }));
 const platformDeclarations=normalizePlatform(locked,'lock'),savedPlatform=normalizePlatform(metadata,'archive');
 for(const field of platformFields)assert.deepEqual(platformDeclarations[field],savedPlatform[field],`dependency declarations ${location}/${field}: archive/lock platform mismatch`);
 const unresolved=Object.keys(declarations.peerDependenciesMeta).filter(name=>!Object.hasOwn(declarations.peerDependencies,name)).map(name=>({location,name,reason:'PEER_DECLARATION_UNAVAILABLE'}));
 return {kind:'DEPENDENCY_DECLARATION_CONSISTENCY',declarations,platformDeclarations,platformSelectionProven:false,unresolved,versionConstraintsProven:false,dependencyClosureIntegrityProven:false,completeMigrationHistory:false,initializationAuthority:false,currentApprovals:[]};
}
// Data-only eligibility for an explicitly supplied environment. This does not
// authenticate a historical host or prove which optional packages were installed.
// Missing environment data must never fall back to the machine running the reader.
export function assessPackagePlatformEligibility(locked,metadata,location,environment){
 const declaration=assessPackageDependencyDeclarations(locked,metadata,location);
 const check=(ok,field,reason)=>assert.ok(ok,`platform eligibility ${location}/${field}: ${reason}`);
 check(environment!==null&&typeof environment==='object'&&!Array.isArray(environment),'environment','explicit platform required');
 check(Object.keys(environment).every(k=>['os','cpu','libc'].includes(k)),'environment','unsupported platform field');
 const platform={};
 for(const field of ['os','cpu','libc']){
  const value=Object.hasOwn(environment,field)?environment[field]:null;
  if(field==='libc'&&value===null){platform[field]=null;continue;}
  check(typeof value==='string'&&/^[a-zA-Z0-9_-]+$/.test(value)&&value!=='any',field,'concrete platform value required');
  platform[field]=value;
 }
 const checks=Object.entries(declaration.platformDeclarations).map(([field,selectors])=>{
  const actual=platform[field];
  if(selectors===null)return {field,selectors,actual,eligible:true};
  check(actual!==null,field,'platform value unavailable');
  const positive=selectors.filter(s=>!s.startsWith('!'));
  const eligible=selectors.length===1&&selectors[0]==='any'||
   (!selectors.includes('!'+actual)&&(positive.length===0||positive.includes(actual)));
  return {field,selectors,actual,eligible};
 });
 return {...declaration,kind:'PLATFORM_ELIGIBILITY_DATA_ASSESSMENT',scope:'EXPLICIT_ENVIRONMENT_NOT_AUTHENTICATED',platform,checks,
  eligible:checks.every(c=>c.eligible),hostPlatformAuthenticated:false,platformSelectionProven:false};
}
export async function inspectRuntimeDependencyDeclarations(root,inventoryPath){
 root=resolve(root);const context=await currentContext(root),history=await inspectRuntimePackageMetadata(root,inventoryPath);
 return bindRuntimeDependencyDeclarations(root,context,history);
}
async function bindRuntimeDependencyDeclarations(root,context,history){
 const bindings=[],unresolved=[...history.unresolved];
 for(const binding of history.bindings){
  const raw=bytes(root,binding.lock.source.path);assert.equal(hash(raw),binding.lock.sha256,'changed declaration lock');assert.equal(raw.length,binding.lock.bytes);
  const lock=JSON.parse(raw),declarations=[];
  for(const proof of binding.packages){
   const entry=history.packages.find(p=>p.artifact===binding.distribution.path&&p.path===proof.metadataPath&&p.location===proof.location);
   assert.ok(entry,'declaration metadata binding missing');assert.equal(entry.sha256,proof.sha256);assert.equal(entry.bytes,proof.bytes);
   const assessment=assessPackageDependencyDeclarations(lock.packages[proof.location],entry.metadata,proof.location);
   declarations.push({...proof,artifact:binding.distribution,assessment});
   unresolved.push(...assessment.unresolved.map(u=>({...u,inputsDigest:binding.inputsDigest,metadataPath:entry.path})));
  }
  bindings.push({...binding,declarations});
 }
 for(const r of history.references){const raw=bytes(root,r.path);assert.equal(hash(raw),r.sha256,'concurrent declaration bytes');assert.equal(raw.length,r.bytes);}
 assert.deepEqual(await currentContext(root),context,'concurrent declaration context');
 const preparation=await inspectRuntimePreparation(root);assert.equal(preparation.designReportSha256,history.designReportSha256);assert.deepEqual(preparation.currentInputs,history.currentInputs);
 return {...history,component:'ARCHIVED_DEPENDENCY_DECLARATIONS',bindings,unresolved,platformSelectionProven:false,versionConstraintsProven:false,dependencyClosureIntegrityProven:false,completeMigrationHistory:false,automaticGateOriginProven:false,initializationAuthority:false,currentApprovals:[]};
}
// Explicit array form only. Matching declarations and direct package metadata
// do not establish transitive bundled contents or installed-source integrity.
export function assessBundledDependencyDeclarations(locked,metadata,location){
 const check=(v,message)=>assert.ok(v,`bundled declarations ${location}/bundleDependencies: ${message}`);
 const namePattern=/^(?:@[a-zA-Z0-9_~-][a-zA-Z0-9._~-]*\/)?[a-zA-Z0-9_~-][a-zA-Z0-9._~-]*$/;
 const normalize=(pkg,side)=>{
  check(pkg!==null&&typeof pkg==='object'&&!Array.isArray(pkg),side+' package object required');
  check(!Object.hasOwn(pkg,'bundledDependencies'),side+' bundledDependencies alias unsupported');
  if(!Object.hasOwn(pkg,'bundleDependencies'))return [];
  const names=pkg.bundleDependencies;check(Array.isArray(names),side+' explicit bundle array required');
  check(names.every(n=>typeof n==='string'&&namePattern.test(n)),side+' invalid bundle name');
  check(new Set(names).size===names.length,side+' duplicate bundle name');
  check(names.every(n=>Object.hasOwn(pkg.dependencies??{},n)||Object.hasOwn(pkg.optionalDependencies??{},n)),side+' undeclared direct bundle');
  return [...names].sort();
 };
 const names=normalize(locked,'lock');assert.deepEqual(names,normalize(metadata,'archive'),`bundled declarations ${location}/bundleDependencies: archive/lock mismatch`);
 return {names,bundledClosureIntegrityProven:false};
}
export async function inspectRuntimeBundledDeclarations(root,inventoryPath){
 root=resolve(root);const context=await currentContext(root),history=await inspectRuntimeDependencyDeclarations(root,inventoryPath);
 return bindRuntimeBundledDeclarations(root,context,history);
}
// Only authenticated occurrence bindings reach this shared direct-bundle check.
async function bindRuntimeBundledDeclarations(root,context,history){
 const bindings=[];
 for(const binding of history.bindings){
  const raw=bytes(root,binding.lock.source.path);assert.equal(hash(raw),binding.lock.sha256,'changed bundled lock');assert.equal(raw.length,binding.lock.bytes);
  const lock=JSON.parse(raw),bundledDeclarations=[],bundledPackages=[];
  for(const proof of binding.declarations){
   const entry=history.packages.find(p=>p.artifact===binding.distribution.path&&p.path===proof.metadataPath&&p.location===proof.location);
   assert.ok(entry,'bundled owner metadata unavailable');assert.equal(entry.sha256,proof.sha256);assert.equal(entry.bytes,proof.bytes);
   const assessment=assessBundledDependencyDeclarations(lock.packages[proof.location],entry.metadata,proof.location);
   bundledDeclarations.push({...proof,assessment});
   for(const name of assessment.names){
    const location=proof.location+'/node_modules/'+name,diagnostic=location+' in '+binding.inputsDigest,locked=lock.packages[location];
    assert.ok(locked,'bundled package lock unavailable: '+diagnostic);
    assert.equal(locked.inBundle,true,'bundled package inBundle required: '+diagnostic);
    const saved=binding.declarations.find(p=>p.location===location);
    assert.ok(saved,'bundled package metadata unavailable: '+diagnostic);
    assert.deepEqual(saved.artifact,binding.distribution,'bundled package artifact mismatch');
    bundledPackages.push({...saved,owner:proof.location,name,inBundle:true});
   }
  }
  bindings.push({...binding,bundledDeclarations,bundledPackages});
 }
 for(const r of history.references){const raw=bytes(root,r.path);assert.equal(hash(raw),r.sha256,'concurrent bundled bytes');assert.equal(raw.length,r.bytes);}
 assert.deepEqual(await currentContext(root),context,'concurrent bundled context');
 const preparation=await inspectRuntimePreparation(root);assert.equal(preparation.designReportSha256,history.designReportSha256);assert.deepEqual(preparation.currentInputs,history.currentInputs);
 return {...history,component:'ARCHIVED_BUNDLED_DECLARATIONS',bindings,bundledClosureIntegrityProven:false,dependencyClosureIntegrityProven:false,completeMigrationHistory:false,initializationAuthority:false,currentApprovals:[]};
}
// Design inputs have their own phase-bound snapshots. Do not substitute a
// receipt's lock, the current installation, or a caller-selected occurrence.
export async function inspectRuntimeDesignDistributions(root,designInventoryPath,runtimeInventoryPath){
 root=resolve(root);const context=await currentContext(root),history=await inspectRuntimeDesignHistory(root,designInventoryPath),distribution=await inspectRuntimeDistributionHistory(root,runtimeInventoryPath);
 for(const key of ['sourceRunSlug','iteration','designReportSha256'])assert.equal(history[key],distribution[key],'design distribution authority');
 assert.deepEqual(history.currentInputs,distribution.currentInputs,'design distribution input boundary');
 const references=new Map();for(const r of [...history.references,...distribution.references]){if(references.has(r.path))assert.deepEqual(references.get(r.path),r,'conflicting design distribution reference');references.set(r.path,r);}
 const bindings=history.designs.map(d=>{
  const m=d.inputs;assert.deepEqual(m.runtime,distribution.runtime,'design distribution runtime');
  const readInput=path=>{
   const entry=m.entries.find(e=>e.path===path);assert.ok(entry,'design runtime input missing: '+path);
   const snapshot=d.snapshots.find(e=>e.path===path);assert.ok(snapshot,'design runtime byte proof missing: '+path);
   assert.equal(snapshot.sha256,entry.sha256);assert.equal(snapshot.bytes,entry.bytes);
   const raw=bytes(root,snapshot.copy);assert.equal(hash(raw),entry.sha256,'design runtime input changed');assert.equal(raw.length,entry.bytes);
   return {value:JSON.parse(raw),reference:{...entry,source:{path:snapshot.copy,startIndex:d.startIndex}}};
  };
  const pkg=readInput('package.json'),lock=readInput('package-lock.json'),locked=lock.value.packages?.['node_modules/takt'];
  assert.equal(pkg.value.devDependencies?.takt,m.runtime.version,'design manifest runtime pin');
  assert.equal(locked?.version,m.runtime.version,'design manifest locked version');
  assert.equal(locked?.integrity,distribution.distribution.integrity,'design manifest distribution integrity');
  return {startIndex:d.startIndex,iteration:d.iteration,session:d.session,occurrence:d.occurrence,routing:d.routing,phases:d.phases,inputsDigest:m.digest,runtimeIdentitySha256:hash(JSON.stringify(m.runtime)),package:pkg.reference,lock:lock.reference,distribution:{path:distribution.distribution.path,sha256:distribution.distribution.sha256,integrity:locked.integrity},identitySourceCount:distribution.sources.length};
 });
 for(const r of references.values()){const raw=bytes(root,r.path);assert.equal(hash(raw),r.sha256,'concurrent design distribution bytes');assert.equal(raw.length,r.bytes);}
 assert.deepEqual(await inspectRuntimeDesignHistory(root,designInventoryPath),history,'concurrent design distribution history');
 assert.deepEqual(await currentContext(root),context,'concurrent design distribution context');
 return {schemaVersion:1,kind:'SOURCE_DESIGN_DISTRIBUTION_BINDINGS',sourceRunSlug:history.sourceRunSlug,iteration:history.iteration,designReportSha256:history.designReportSha256,currentInputs:history.currentInputs,bindings,references:[...references.values()],runtimeIdentityBytesComplete:true,distributionIntegrityProven:true,designManifestDistributionBindingsComplete:true,dependencyClosureIntegrityProven:false,completeMigrationHistory:false,automaticGateOriginProven:false,initializationAuthority:false,currentApprovals:[]};
}
// Design phases authenticate their own snapshots/routing before the shared
// archive/lock checks. No receipt lock or current package substitutes for them.
export async function inspectRuntimeDesignDependencyDeclarations(root,designInventoryPath,runtimeInventoryPath){
 root=resolve(root);const context=await currentContext(root);
 const designs=await inspectRuntimeDesignDistributions(root,designInventoryPath,runtimeInventoryPath);
 const metadata=await bindRuntimePackageMetadata(root,context,designs);
 const declarations=await bindRuntimeDependencyDeclarations(root,context,metadata);
 assert.deepEqual(await inspectRuntimeDesignDistributions(root,designInventoryPath,runtimeInventoryPath),designs,'concurrent design declaration authority');
 assert.deepEqual(await currentContext(root),context,'concurrent design declaration context');
 return {...declarations,component:'ARCHIVED_DESIGN_DEPENDENCY_DECLARATIONS'};
}
// Design bundle declarations belong to each phase's original lock. Recheck
// that authority after evaluation; direct bindings do not prove bundle closure.
export async function inspectRuntimeDesignBundledDeclarations(root,designInventoryPath,runtimeInventoryPath){
 root=resolve(root);const context=await currentContext(root);
 const history=await inspectRuntimeDesignDependencyDeclarations(root,designInventoryPath,runtimeInventoryPath);
 const assessment=await bindRuntimeBundledDeclarations(root,context,history);
 assert.deepEqual(await inspectRuntimeDesignDependencyDeclarations(root,designInventoryPath,runtimeInventoryPath),history,'concurrent design bundled authority');
 assert.deepEqual(await currentContext(root),context,'concurrent design bundled context');
 return {...assessment,component:'ARCHIVED_DESIGN_BUNDLED_DECLARATIONS'};
}
// Source-only composition: an edge is evaluated only after its package's raw
// archived metadata has been bound to this occurrence's own authenticated lock.
// Installation/platform/origin evidence remains a separate prerequisite.
export async function inspectRuntimeDependencyConstraints(root,inventoryPath){
 root=resolve(root);const context=await currentContext(root),history=await inspectRuntimeDependencyDeclarations(root,inventoryPath);
 return bindRuntimeDependencyConstraints(root,context,history);
}
// Shared checks receive authenticated bindings, never a caller-supplied lock.
async function bindRuntimeDependencyConstraints(root,context,history){
 const {assessDependencyGraph}=await import('./runtime-dependency-graph.mjs');
 const {assessDependencyVersionConstraints}=await import('./runtime-version-constraints.mjs');
 const bindings=[],unresolved=[...history.unresolved];
 for(const binding of history.bindings){
  const raw=bytes(root,binding.lock.source.path);assert.equal(hash(raw),binding.lock.sha256,'changed constraint lock');assert.equal(raw.length,binding.lock.bytes);
  const lock=JSON.parse(raw),graph=assessDependencyGraph(lock);
  const graphPackages=graph.packages.map(pkg=>{
   const proof=binding.declarations.find(p=>p.location===pkg.path);
   assert.ok(proof,'graph package metadata unavailable: '+pkg.path+' in '+binding.inputsDigest);
   return {location:pkg.path,version:pkg.version,metadataPath:proof.metadataPath,sha256:proof.sha256,bytes:proof.bytes,artifact:proof.artifact};
  });
  const constraintAssessment=assessDependencyVersionConstraints(lock);
  unresolved.push(...constraintAssessment.unresolved.map(u=>({...u,inputsDigest:binding.inputsDigest})));
  bindings.push({...binding,graphPackages,constraintAssessment,constraintAssessmentSha256:hash(JSON.stringify(constraintAssessment))});
 }
 for(const r of history.references){const raw=bytes(root,r.path);assert.equal(hash(raw),r.sha256,'concurrent constraint bytes');assert.equal(raw.length,r.bytes);}
 assert.deepEqual(await currentContext(root),context,'concurrent constraint context');
 const preparation=await inspectRuntimePreparation(root);assert.equal(preparation.designReportSha256,history.designReportSha256);assert.deepEqual(preparation.currentInputs,history.currentInputs);
 return {...history,component:'ARCHIVED_GRAPH_VERSION_CONSTRAINTS',bindings,unresolved,platformSelectionProven:false,dependencyClosureIntegrityProven:false,completeMigrationHistory:false,automaticGateOriginProven:false,initializationAuthority:false,currentApprovals:[]};
}
// Reauthenticate design occurrences after graph evaluation as well as before;
// receipt/builder locks cannot stand in for phase-bound design snapshots.
export async function inspectRuntimeDesignDependencyConstraints(root,designInventoryPath,runtimeInventoryPath){
 root=resolve(root);const context=await currentContext(root);
 const history=await inspectRuntimeDesignDependencyDeclarations(root,designInventoryPath,runtimeInventoryPath);
 const assessment=await bindRuntimeDependencyConstraints(root,context,history);
 assert.deepEqual(await inspectRuntimeDesignDependencyDeclarations(root,designInventoryPath,runtimeInventoryPath),history,'concurrent design constraint authority');
 assert.deepEqual(await currentContext(root),context,'concurrent design constraint context');
 return {...assessment,component:'ARCHIVED_DESIGN_GRAPH_VERSION_CONSTRAINTS'};
}
// Compose both checks on the same authenticated bindings. Direct bundle
// presence and range satisfaction remain distinct from installed-file closure.
export async function inspectRuntimeBundledConstraints(root,inventoryPath){
 root=resolve(root);const context=await currentContext(root);
 const history=await inspectRuntimeBundledDeclarations(root,inventoryPath);
 const assessment=await bindRuntimeDependencyConstraints(root,context,history);
 return {...assessment,component:'ARCHIVED_BUNDLED_GRAPH_CONSTRAINTS'};
}
export async function inspectRuntimeDesignBundledConstraints(root,designInventoryPath,runtimeInventoryPath){
 root=resolve(root);const context=await currentContext(root);
 const history=await inspectRuntimeDesignBundledDeclarations(root,designInventoryPath,runtimeInventoryPath);
 const assessment=await bindRuntimeDependencyConstraints(root,context,history);
 assert.deepEqual(await inspectRuntimeDesignBundledDeclarations(root,designInventoryPath,runtimeInventoryPath),history,'concurrent design bundled constraint authority');
 assert.deepEqual(await currentContext(root),context,'concurrent design bundled constraint context');
 return {...assessment,component:'ARCHIVED_DESIGN_BUNDLED_GRAPH_CONSTRAINTS'};
}
// Preparation evidence is a separate domain. No function below writes a product
// receipt, projection, selection, approval or release. Public arguments are data.
function strictPreparationJSON(raw){
 const text=String(raw);const value=JSON.parse(text),stack=[];
 for(const token of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g)){
  const t=token[0];
  if(t==='{')stack.push(new Set());else if(t==='[')stack.push(null);
  else if(t==='}'||t===']')stack.pop();
  else if(t.startsWith('"')&&/^\s*:/.test(text.slice(token.index+t.length))){
   const keys=stack.at(-1),key=JSON.parse(t);assert.ok(keys&&!keys.has(key),'duplicate preparation field');keys.add(key);
  }
 }
 return value;
}
const prepRead=(root,p)=>strictPreparationJSON(bytes(root,p));
const prepRaw=(root,p)=>existsSync(confined(root,p))?bytes(root,p).toString():null;
const prepRef=(root,path)=>({path,sha256:hash(bytes(root,path))});
function prepPath(root,base,path){assert.ok(path.startsWith(base+'/')&&!path.includes('\\'),'preparation namespace');assert.equal(relative(root,confined(root,path)),path,'preparation canonical path');return confined(root,path);}
function prepBase(context){assert.match(context.identity.runSlug,/^[\w-]+$/);return 'evidence/enterprise/preparation/'+context.identity.runSlug;}
function prepExact(value,fields,label){assert.deepEqual(Object.keys(value).sort(),fields.slice().sort(),'preparation '+label+' fields');}
function prepSyncDir(path){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
// An unfinished recovery has priority over all ordinary readiness and mutation.
// Even a torn intent blocks: only the separately authenticated recovery protocol
// may establish completion. No expiry, PID absence or caller bypass is accepted.
function prepAdmission(root,base){
 for(const name of ['recovery.lock','recovery-journal.json'])assert.ok(!existsSync(prepPath(root,base,base+'/'+name)),'preparation recovery fenced: '+name);
}
function prepOwned(cap){prepAdmission(cap.root,cap.base);const s=statSync(prepPath(cap.root,cap.base,cap.lock));assert.ok(s.dev===cap.inode.dev&&s.ino===cap.inode.ino,'preparation foreign lock');assert.equal(bytes(cap.root,cap.lock).toString(),cap.lockRaw,'preparation lock changed');}
function prepAtomic(cap,path,value,expected){
 prepOwned(cap);const absolute=prepPath(cap.root,cap.base,path);assert.equal(prepRaw(cap.root,path),expected,'preparation CAS');
 const raw=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',tmp=absolute+'.'+randomUUID()+'.tmp';let fd;
 try{fd=openSync(tmp,'wx');writeFileSync(fd,raw);fsyncSync(fd);closeSync(fd);fd=undefined;prepOwned(cap);assert.equal(prepRaw(cap.root,path),expected,'preparation CAS');renameSync(tmp,absolute);if(path===cap.journal)cap.journalRaw=raw;prepSyncDir(dirname(absolute));assert.equal(prepRaw(cap.root,path),raw,'preparation publication readback');}
 catch(e){cap.retain=true;throw e;}finally{if(fd!==undefined)closeSync(fd);}
 return {path,sha256:hash(raw)};
}
function prepImmutable(cap,path,value){
 try{prepOwned(cap);const absolute=prepPath(cap.root,cap.base,path);mkdirSync(dirname(absolute),{recursive:true});const raw=Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';
 const fd=openSync(absolute,'wx');try{writeFileSync(fd,raw);fsyncSync(fd);}finally{closeSync(fd);}prepSyncDir(dirname(absolute));assert.deepEqual(bytes(cap.root,path),Buffer.from(raw));return {path,sha256:hash(raw)};}catch(error){cap.retain=true;throw error;}
}
function prepJournal(raw){
 if(raw===null)return {schemaVersion:1,events:[]};const j=strictPreparationJSON(raw);prepExact(j,['schemaVersion','events'],'journal');assert.equal(j.schemaVersion,1);assert.ok(Array.isArray(j.events));
 let sequence=0,last;
 for(const e of j.events){
  assert.equal(e.sequence,sequence+(e.status==='RUNNING'?1:0),'preparation journal sequence');
  if(e.status==='RUNNING'){assert.ok(!last||last.status!=='RUNNING','preparation incomplete previous attempt');sequence++;assert.equal(e.attempt,sequence);last=e;}
  else {assert.ok(['PASSED','FAILED'].includes(e.status),'preparation journal status');assert.ok(last&&e.attempt===last.attempt,'preparation journal branch');assert.ok(last.status==='RUNNING'||(last.status==='PASSED'&&e.status==='FAILED'),'preparation duplicate terminal');last=e;}
 }
 return j;
}
function prepAppend(cap,event){
 const j=prepJournal(cap.journalRaw);event={...event,eventFormatVersion:2,acceptanceScope:cap.definitions.acceptanceScope,sequence:j.events.filter(e=>e.status==='RUNNING').length+(event.status==='RUNNING'?1:0)};
 // Terminals retain the attempt sequence; ordering is the immutable array order.
 j.events.push(event);prepAtomic(cap,cap.journal,j,cap.journalRaw);
}
// Pure definition validation does not authenticate a native execution domain.
// The current-operation boundary below remains closed until the private native
// supervisor/launch protocol is implemented and independently authenticated.
function prepContainmentDefinitions(scope,p){
 const consumers=['capture','gate','candidate','review','import'];
 for(const [label,key,casesKey,prefix,count] of [
  ['recovery','captureRecoveryDefinition','recoveryCaseIds','CR',12],
  ['containment','producerContainmentDefinition','producerContainmentCaseIds','PC',8]
 ]){
  const d=scope[key],ids=Array.from({length:count},(_,i)=>prefix+(i+1));
  assert.equal(d?.schemaVersion,1,label+' definition');assert.equal(d.profileId,scope.profileId,label+' profile');
  assert.deepEqual(d.validatorConsumers,consumers,label+' consumers');assert.deepEqual(d.fullRegressionCommand,p.fullRegressionCommand,label+' command');
  assert.deepEqual(scope[casesKey],ids,label+' cases');assert.deepEqual(d.caseIds,ids,label+' cases');assert.deepEqual(d.acceptanceCases?.map(c=>c.id),ids,label+' cases');
  assert.ok(d.acceptanceCases.every(c=>typeof c.acceptance==='string'&&c.acceptance.length>0),label+' acceptance text');
 }
 const d=scope.producerContainmentDefinition;
 for(const [k,v] of Object.entries({contract:'work/enterprise/PREPARATION_PRODUCER_CONTAINMENT.md',backend:'LINUX_CGROUP_V2_CLOSED_DOMAIN',port:'PRIVATE_PRODUCER_DOMAIN_PORT',coverage:'ENFORCED_MEMBERSHIP_FROM_BEFORE_WORKLOAD_EXECUTION',proofKind:'PRODUCTION_DOMAIN_CLOSED',proofSchemaVersion:1,actualAttempt7:'BLOCKED_ON_COMPLETE_PRODUCER_PROVENANCE',backendAvailability:'UNAVAILABLE_BACKEND',nativeFailurePolicy:'FAIL_NOT_SKIP_NO_FALLBACK',activation:'SEPARATE_REVIEWED_ENVIRONMENT_AND_REAL_AUTHORITY_REQUIRED'}))assert.equal(d[k],v,'containment '+k);
 assert.deepEqual(d.phases,['PREPARED','ADMITTED','ADMISSION_CLOSED','EMPTY','OUTPUTS_SEALED'],'containment phases');
 assert.deepEqual(d.implementationPaths,['scripts/enterprise/runtime-preparation.mjs','scripts/enterprise/verify.mjs','scripts/enterprise/preparation-producer-linux.c','tests/enterprise/finalization.test.mjs','tests/enterprise/evidence-fixture.mjs'],'containment implementation paths');
 for(const k of ['freshIndependentApproval','beforeExecContainment','durableAdmission','denyMigration','denyExternalWriteDelegation','privateMountsAndCredentials','closeInheritedDescriptors','allDescendantsEnclosed','protectedSupervisorIdentity','holdDomainIdentity','killThenEmpty','closeSupervisorWriters','streamingInventory','sealReadback','allReaderIntegration','retainFenceOnUnknown','realNativePositiveRequired','cumulative295','preserveActual7','preserveOriginalCR'])assert.equal(d[k],true,'containment '+k);
 for(const k of ['actual7Adoption','scanProofFallback','callerProofAuthority','autoProvision','remoteDispatch','privilegedInstall','fixturePromotion','productVerified','completeH','targetLaunchAuthority','runtimeReplacementAuthority'])assert.equal(d[k],false,'containment '+k);
 const r=scope.captureRecoveryDefinition;
 assert.equal(r.contract,'work/enterprise/PREPARATION_CAPTURE_RECOVERY.md','recovery contract');
 assert.deepEqual(r.phases,['AUTHENTICATED','FENCED','QUIESCENCE_PROVEN','SNAPSHOT_DURABLE','ABORT_COMMITTED','OLD_FENCE_RELEASED','COMPLETE'],'recovery phases');
 for(const k of ['freshIndependentApproval','preserveOriginalRunning','preserveAllPartialBytes','verifyCompletedOriginalBuilder','realNativeProcessProof','escapedDescendantsCovered','privateRecoveryGuard','sharedAdmissionFence','atomicDurableCASReadback','archiveOriginalFence','allReaderIntegration','beforeAfterAwaitChecks','fixedEngineRetest','freshFullCapture','cumulative295','responseLossReadOnly','retainFenceOnUnknown','futureProducerObservationsBeforeStop'])assert.equal(r[k],true,'recovery '+k);
 for(const k of ['automaticRecovery','forceUnlock','pidAbsenceSufficient','historicalEvidenceBackfill','repackageStandaloneSuccess','latestAbortReady','oldRequestFallback','productWrites','sourceWrites','completeH','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority','acceptedRemainingObligations'])assert.equal(r[k],false,'recovery '+k);
}
function prepDefinitions(plan){
 const p=plan.preparationReview;assert.equal(p?.schemaVersion,2,'preparation review plan');assert.equal(p.productVerified,false);assert.equal(p.gateRunsSuites,false);assert.deepEqual(p.gateWrites,[]);
 assert.deepEqual(p.fullRegressionCommand,plan.preparationEntry.sealPublication.fullRegressionCommand,'preparation full command');
 assert.ok(Array.isArray(p.fullRegressionCommand)&&p.fullRegressionCommand.length>0,'preparation full argv');
 assert.ok(!p.fullRegressionCommand.some(s=>/test-name-pattern|test-skip-pattern/.test(s)),'preparation filtered command');
 const paths=p.fullRegressionCommand.filter(s=>s.endsWith('.test.mjs'));
 const suites=plan.issues.flatMap(i=>i.suites).filter(s=>paths.includes(s.path));
 assert.ok(paths.length&&paths.every(path=>suites.some(s=>s.path===path)),'preparation suite definitions');
 const full=[...new Set([...suites.flatMap(s=>s.requiredAssertions??[]),...p.caseIds])],scope=p.acceptanceScope;
 assert.ok(scope,'preparation acceptance scope');assert.equal(scope.schemaVersion,2);const containedProfile=scope.profileId==='P0-source-provenance-v3',sourceProfile=containedProfile||scope.profileId==='P0-source-provenance-v1';
 assert.ok(sourceProfile||scope.profileId==='P0-control-v2','preparation profile');assert.equal(scope.parentIncrement,p.increment);
 assert.equal(scope.componentId,sourceProfile?'P0-source-provenance':'P0-control');assert.deepEqual(scope.acceptedComponents,sourceProfile?['P0-control','P0-source-provenance']:['P0-control']);
 if(sourceProfile){
  const d=scope.sourceProvenanceDefinition;assert.equal(d?.schemaVersion,1,'source definition');assert.equal(d.profileId,scope.profileId);assert.equal(d.componentId,scope.componentId);assert.equal(d.sourceRunSlug,plan.preparationEntry.sourceRunSlug);assert.deepEqual(d.sourceCheckpoint,plan.preparationEntry.sourceCheckpoint);assert.deepEqual(d.fullRegressionCommand,p.fullRegressionCommand);assert.deepEqual(d.validatorConsumers,['capture','gate','candidate','review','import']);assert.deepEqual(scope.sourceProvenanceCaseIds,d.caseIds);assert.deepEqual(d.caseIds,d.acceptanceCases.map(x=>x.id));
  for(const k of ['freshIndependentApproval','immutablePredecessorRequired','validateOldFrozenProfiles','preserveAllAttempts','realSourceAssessmentRequired','allOccurrenceCoverage','originalDefinitionsRequired','sourceGuardUnchanged','beforeAfterAwaitChecks','cumulativeControlsRequired','fixedEngineRetestRequired'])assert.equal(d[k],true,'source definition '+k);
  for(const k of ['callerContextAuthority','currentSessionStoreAsSourceProof','oldModuleExecution','networkRecovery','runtimeInstallation','fixtureAuthorityInProduction','completeH','productVerified','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority','retainedObligationCompletion'])assert.equal(d[k],false,'source definition '+k);
 }else{assert.equal(scope.sourceProvenanceDefinition,undefined,'old profile source definition');assert.equal(scope.sourceProvenanceCaseIds,undefined,'old profile source cases');}
 if(containedProfile)prepContainmentDefinitions(scope,p);
 else for(const key of ['captureRecoveryDefinition','recoveryCaseIds','producerContainmentDefinition','producerContainmentCaseIds'])assert.equal(scope[key],undefined,'legacy profile extension '+key);
 assert.deepEqual(scope.fullObligations,full,'preparation full obligations');
 const unique=(a,label)=>{assert.ok(Array.isArray(a)&&a.every(x=>typeof x==='string'&&x.length),'preparation '+label);assert.equal(new Set(a).size,a.length,'preparation duplicate '+label);};
 for(const k of ['fullObligations','requiredAssertions','requiredControlAssertions','caseIds','reviewedCaseIds'])unique(scope[k],k);
 const classification=['runtime-continuation-subprocess-nonzero-preserved','runtime-continuation-exit-zero-missing-assertion-preserved','runtime-continuation-failed-without-reproducible-cause-rejected'];
 const owners=plan.failedIntervalRecovery.runtimeContinuation.delivery.workPackages.filter(w=>['R1','R2','R3'].includes(w.id));assert.deepEqual(owners.map(w=>w.id),['R1','R2','R3']);
 const expected=owners.flatMap(w=>w.requiredAssertions.filter(n=>!classification.includes(n)).map(assertion=>({assertion,owner:w.id,dependsOn:w.dependsOn,requiredAt:[w.id,'R4','B00_FULL_PRODUCT_GATE']})));
 assert.equal(scope.retainedObligations.length,expected.length,'preparation retained count');
 for(const [i,r] of scope.retainedObligations.entries()){prepExact(r,['assertion','owner','dependsOn','reason','requiredAt','disposition','sourceSuite'],'retained obligation');for(const k of ['assertion','owner','dependsOn','requiredAt'])assert.deepEqual(r[k],expected[i][k],'preparation retained '+k);assert.equal(r.disposition,'REQUIRED_NOT_ACCEPTED');assert.equal(r.sourceSuite,'rejected-regeneration-regressions');assert.ok(typeof r.reason==='string'&&r.reason.length>0);assert.ok(full.includes(r.assertion),'preparation unknown retained obligation');}
 const retained=scope.retainedObligations.map(r=>r.assertion);unique(retained,'retained');assert.deepEqual(scope.requiredAssertions,full.filter(n=>!retained.includes(n)),'preparation partition');
 assert.deepEqual(scope.reviewedCaseIds,[...(plan.preparationEntry.ordinaryGateOwnership?.caseIds??[]),...(plan.preparationEntry.sealPublication.acceptanceCases??[]).map(c=>c.id),...p.caseIds,...scope.caseIds,...scope.failureHistoryCaseIds,...(sourceProfile?scope.sourceProvenanceCaseIds:[]),...(containedProfile?[...scope.recoveryCaseIds,...scope.producerContainmentCaseIds]:[])],'preparation review case scope');
 for(const k of ['fullCommandRequired','anyExecutedFailureRefuses','fullProductAssertionsUnchanged','freshCaptureRequired','cumulativeControlsRequired'])assert.equal(scope[k],true,'preparation scope '+k);
 for(const k of ['automaticSelectionFromTap','callerExclusionsAllowed','oldFailedAttemptPromotionAllowed','parentIncrementCompleted','historyVerified','productVerified'])assert.equal(scope[k],false,'preparation scope '+k);
 assert.deepEqual(scope.schemaVersions,{request:3,receipt:3,candidate:3,review:4,acceptance:3,journal:1});assert.deepEqual(scope.bindingFields,['profileId','version','definitionSha256','mandatoryDigest','retainedObligationsDigest','failureHistoryDefinitionDigest']);
 assert.deepEqual(scope.failureHistoryCaseIds,p.failureHistory.caseIds,'preparation failure cases');
 const required=[...scope.requiredAssertions,...scope.requiredControlAssertions,...scope.caseIds,...scope.failureHistoryCaseIds,...(sourceProfile?scope.sourceProvenanceCaseIds:[]),...(containedProfile?[...scope.recoveryCaseIds,...scope.producerContainmentCaseIds]:[])];unique(required,'mandatory');assert.ok(required.length,'preparation required assertions');
 if(containedProfile){assert.equal(required.length,303,'containment cumulative mandatory');assert.equal(retained.length,29,'containment retained obligations');}
 const raw=JSON.stringify(scope,null,2)+'\n',acceptanceScope={profileId:scope.profileId,version:2,failureHistoryDefinitionDigest:hash(JSON.stringify(p.failureHistory)),definitionSha256:hash(raw),mandatoryDigest:hash(JSON.stringify(required)),retainedObligationsDigest:hash(JSON.stringify(scope.retainedObligations))};
 return {argv:p.fullRegressionCommand,suites,required,scope,acceptanceScope,failureHistory:p.failureHistory};
}
function sourcePredecessor(auth,bind){
 const {root,base,context,definitions}=auth,d=definitions.scope.sourceProvenanceDefinition;
 const a=strictPreparationJSON(bind('project',d.predecessor.path,d.predecessor));assert.equal(a.kind,'PREPARATION_ACCEPTED_COMPONENT_ANCHOR');assert.equal(a.schemaVersion,1);assert.equal(a.runSlug,context.identity.runSlug);assert.equal(a.currentAuthority,false);assert.equal(a.productVerified,false);assert.deepEqual(a.acceptedComponents,['P0-control']);assert.equal(d.nextAttemptMinimum,a.attempt+1);
 assert.equal(a.references.length,6,'source predecessor coverage');assert.equal(new Set(a.references.map(x=>x.originalPath)).size,6,'source predecessor duplicate');
 const refs=new Map();for(const x of a.references){prepPath(root,base,x.originalPath);refs.set(x.originalPath,{ref:x,raw:bind('project',x.path,x)});}
 const get=path=>{assert.ok(refs.has(path),'source predecessor missing '+path);return strictPreparationJSON(refs.get(path).raw);};
 const ledger=get(base+'/acceptances.json'),journal=get(base+'/journal.json'),request=get(base+'/request.json'),receipt=get(base+'/attempts/'+a.attempt+'/receipt.json'),scope=get(base+'/attempts/'+a.attempt+'/scope.json');
 assert.deepEqual(prepRead(root,base+'/acceptances.json').acceptances.slice(0,ledger.acceptances.length),ledger.acceptances,'source predecessor ledger prefix');assert.deepEqual(prepRead(root,base+'/journal.json').events.slice(0,journal.events.length),journal.events,'source predecessor journal prefix');
 assert.deepEqual(request.historyHead,a.historyHead);assert.equal(journal.events.at(-1).attempt,a.attempt);assert.equal(journal.events.at(-1).status,'PASSED');assert.equal(journal.events.at(-1).terminalClosure,a.historyHead.terminalClosure);assert.deepEqual(journal.events.at(-1).receipt,request.receipt);
 assert.equal(refs.get(request.receipt.path).ref.sha256,request.receipt.sha256);assert.deepEqual(receipt.definitions.scope,scope);assert.equal(scope.profileId,'P0-control-v2');assert.equal(receipt.acceptanceScope.profileId,'P0-control-v2');
 const stored=ledger.acceptances.find(x=>x.reportSha256===a.reportSha256);assert.ok(stored,'source predecessor acceptance');assert.deepEqual(stored.attestation.acceptedComponents,a.acceptedComponents);assert.deepEqual(stored.historyHead,a.historyHead);assert.deepEqual(stored.historyBinding,receipt.historyBinding);
 const review=completed(context,context.records.findIndex(r=>r.type==='step_start'&&r.step==='review-foundation'&&r.iteration===a.reviewIteration),'enterprise-batch-reviewer');
 const saved=refs.get(stored.report);assert.ok(saved);assert.equal(hash(saved.raw),a.reportSha256);assert.ok(saved.raw.toString()===review.phases[1].content||saved.raw.toString()===review.phases[1].content+'\n');
 for(const p of review.phases)assert.deepEqual(block(p.content,'enterprise-batch-attestation'),stored.attestation,'source predecessor review phases');assert.equal(stored.attestation.providerSessionId,review.session);assert.equal(stored.attestation.verdict,'APPROVE');assert.deepEqual(stored.attestation.request,{path:base+'/request.json',sha256:refs.get(base+'/request.json').ref.sha256});assert.deepEqual(stored.attestation.receipt,request.receipt);
 const builder=completed(context,context.records.findIndex(r=>r.type==='step_start'&&r.step==='build-foundation'&&r.iteration===request.builderIteration),'enterprise-builder',false);assert.equal(builder.session,request.builderSessionId);assert.notEqual(builder.session,review.session);assert.ok(builder.end<=review.index,'source predecessor chronology');
 for(const p of builder.phases){const c=block(p.content,'enterprise-preparation-candidate');assert.deepEqual(c.request,stored.attestation.request);assert.deepEqual(c.receipt,request.receipt);assert.deepEqual(c.historyHead,a.historyHead);assert.deepEqual(c.acceptanceScope,receipt.acceptanceScope);}
 const imported=completed(context,context.records.findIndex(r=>r.type==='step_start'&&r.step==='build-foundation'&&r.iteration===a.importIteration),'enterprise-builder',false);assert.ok(review.end<=imported.index);assert.ok(imported.index<context.records.indexOf(context.start));const handoffRaw=bind('project',a.handoff.path,a.handoff);for(const p of imported.phases)assert.ok(p.content.includes(a.handoff.sha256),'source predecessor import handoff');
 const h=strictPreparationJSON(handoffRaw);for(const x of a.references){assert.ok(h.references.some(r=>r.path===x.originalPath&&r.sha256===x.sha256&&r.bytes===x.bytes),'source predecessor handoff binding');}
 for(const [p,x] of refs)if(![base+'/journal.json',base+'/request.json',base+'/acceptances.json'].includes(p))bind('project',p,x.ref);
 return {anchorSha256:d.predecessor.sha256,attempt:a.attempt,reportSha256:a.reportSha256,historyHead:a.historyHead};
}
function sourceAssessmentArtifact(auth,dir){
 if(!auth.definitions.scope.sourceProvenanceDefinition)return;
 const observed=sourceProvenanceRead(auth),saved=prepRead(auth.root,dir+'/output/source-provenance/assessment.json');assert.deepEqual(saved,observed.assessment,'source assessment changed or incomplete');
 const deps=dir+'/output/source-provenance/dependencies';
 for(const ref of saved.inventory){const raw=bytes(auth.root,deps+'/'+ref.space+'/'+ref.path);assert.equal(hash(raw),ref.sha256,'source frozen dependency');assert.equal(raw.length,ref.bytes);}
 assert.equal(snapshot(auth.root,[deps]).entries.length,saved.inventory.length,'source dependency coverage');
}

// Resolve historical references only from phase-bound source records. A matching
// current file is a byte observation, never a substitute for source authority.
function sourceReferenceAudit(root,records,occurrences,bind,pending){
 const requirements=[],locations=new Map(),handoffs=[],documents=new Set(),observations=new Map(),designOrders=[];
 const safe=p=>{assert.equal(typeof p,'string','source reference path');const n=isAbsolute(p)?relative(root,p):p;assert.equal(relative(root,confined(root,n)),n,'source reference canonical path');assert.ok(!n.includes('\\'),'source reference separator');return n;};
 const observe=path=>{path=safe(path);if(!observations.has(path)){const abs=confined(root,path);if(existsSync(abs)){const raw=bytes(root,path);observations.set(path,{path,sha256:hash(raw),bytes:raw.length});}else observations.set(path,{path,missing:true});}return observations.get(path);};
 const requireRef=(r,consumer,pointer)=>{assert.ok(r&&typeof r==='object');const path=safe(r.path);assert.match(r.sha256,/^[a-f0-9]{64}$/,'source required hash');if(r.bytes!==undefined)assert.ok(Number.isSafeInteger(r.bytes)&&r.bytes>=0);requirements.push({path,sha256:r.sha256,...(r.bytes===undefined?{}:{bytes:r.bytes}),consumer,pointer});const key=path+'\0'+r.sha256;if(!locations.has(key))locations.set(key,{path,sha256:r.sha256,bytes:r.bytes});};
 const escape=s=>s.replaceAll('~','~0').replaceAll('/','~1');
 const walk=(v,consumer,pointer)=>{if(!v||typeof v!=='object')return;if(!Array.isArray(v)){
  if(typeof v.path==='string'&&typeof v.sha256==='string')requireRef(v,consumer,pointer);
  for(const [k,path] of Object.entries(v))if(k.endsWith('Path')&&Object.hasOwn(v,k.slice(0,-4)+'Sha256'))requireRef({path,sha256:v[k.slice(0,-4)+'Sha256']},consumer,pointer+'/'+escape(k));
 }for(const [k,x] of Object.entries(v))walk(x,consumer,pointer+'/'+escape(k));};
 for(const o of occurrences){
  const ps=o.phases.filter(p=>[1,2].includes(p.phase)).map(p=>records[Number(p.completePointer.split('/').at(-1))]);
  const paths=p=>[...new Set(p.content.match(/evidence\/enterprise\/[A-Za-z0-9_./-]+\/handoff\.json/g)??[])];
  const common=[...new Set([...paths(ps[0]),...paths(ps[1])])];
  for(const path of common){const observation=observe(path);if(observation.missing){pending('occurrence:'+o.iteration,path,'PHASE_HANDOFF_BYTES_MISSING');continue;}const raw=bytes(root,path),digest=hash(raw);
   // Both actual source phases must bind these bytes. An unbound prose locator
   // can retain an obligation, but cannot authorize its reference graph.
   if(!ps.every(p=>p.content.includes(path)&&new RegExp('\\b'+digest+'\\b').test(p.content))){pending('occurrence:'+o.iteration,path,'PHASE_HANDOFF_HASH_BINDING_MISSING');continue;}
   bind('project',path,{sha256:digest,bytes:raw.length});const h=strictPreparationJSON(raw);assert.equal(h.run,o.sourceRunSlug,'source handoff run');assert.ok(Number.isSafeInteger(h.iteration)&&h.iteration<=o.iteration,'source handoff occurrence order');const owner=occurrences.find(x=>x.iteration===h.iteration);assert.ok(owner,'source handoff owner missing');for(const phase of owner.phases.filter(x=>[1,2].includes(x.phase))){const text=records[Number(phase.completePointer.split('/').at(-1))].content;assert.ok(text.includes(path)&&text.includes(digest),'source handoff original phase binding');}if(documents.has(path))continue;assert.ok(Array.isArray(h.references),'source handoff references');assert.equal(new Set(h.references.map(r=>r.path)).size,h.references.length,'source duplicate handoff locator');
   const consumer={handoff:path,handoffSha256:digest,iteration:h.iteration};handoffs.push(consumer);documents.add(path);
   h.references.forEach((r,i)=>requireRef(r,consumer,'/references/'+i));
   for(const [i,r] of (h.historyPreservation?.historicalDifferences??[]).entries())requireRef(r,consumer,'/historyPreservation/historicalDifferences/'+i);
   for(const [i,r] of (h.historyPreservation?.relocatedReferences??[]).entries())requireRef({path:r.actualPath,sha256:r.sha256,bytes:r.bytes},consumer,'/historyPreservation/relocatedReferences/'+i);
   if(h.inputs){assert.equal(h.inputs.digest,hash(JSON.stringify({entries:h.inputs.entries,runtime:h.inputs.runtime})),'source handoff input digest');canonicalHistoricalInputs(root,h.inputs.entries);assert.ok(Array.isArray(h.snapshots),'source input snapshot required');assert.deepEqual(h.snapshots.map(({copy,...r})=>r),h.inputs.entries,'source snapshot coverage');for(const [i,r] of h.snapshots.entries())requireRef({path:r.copy,sha256:r.sha256,bytes:r.bytes},consumer,'/snapshots/'+i);}
  }
  const tags=p=>[...p.content.matchAll(/^```(enterprise-[\w-]+)\r?\n([\s\S]*?)^```\s*$/gm)].map(m=>({tag:m[1],value:strictPreparationJSON(m[2])}));
  const left=tags(ps[0]),right=tags(ps[1]);assert.deepEqual(left,right,'source attestation phases differ');
  for(const [n,{tag,value:v}] of right.entries()){
   const consumer={iteration:o.iteration,phasePointer:o.phases[1].completePointer,tag};walk(v,consumer,'/blocks/'+n);
   if(v.runSlug!==undefined)assert.equal(v.runSlug,o.sourceRunSlug,'source foreign attestation');if(v.workflowRef!==undefined)assert.equal(v.workflowRef,o.workflowRef,'source attestation workflow');if(v.iteration!==undefined)assert.equal(v.iteration,o.iteration,'source stale attestation');
   const knownOrder=['enterprise-recovery-design-attestation','enterprise-failed-interval-design-attestation'].includes(tag);
   if(knownOrder){assert.equal(o.step,'review-architecture','source design order role');assert.match(v.planSha256??'',/^[a-f0-9]{64}$/,'source original plan hash');assert.equal(v.runSlug,o.sourceRunSlug,'source original order run');assert.equal(v.workflowRef,o.workflowRef,'source original order workflow');assert.equal(v.iteration,o.iteration,'source original order iteration');assert.match(v.contractSha256??'',/^[a-f0-9]{64}$/,'source original contract hash');}
   if(v.planSha256!==undefined||knownOrder){requireRef({path:'work/enterprise/plan.json',sha256:v.planSha256},consumer,'/blocks/'+n+'/planSha256');designOrders.push({iteration:o.iteration,tag,attestation:v,consumer});}
  }
 }
 const available=new Map();
 for(const r of locations.values()){const x=observe(r.path);if(!x.missing&&x.sha256===r.sha256&&(r.bytes===undefined||r.bytes===x.bytes)){const a=available.get(r.sha256)??[];bind('project',r.path,{sha256:r.sha256,bytes:x.bytes});a.push({path:r.path,bytes:x.bytes});available.set(r.sha256,a);}}
 for(const r of requirements){const source=(available.get(r.sha256)??[]).find(x=>r.bytes===undefined||r.bytes===x.bytes);if(!source)pending(r.consumer,r.pointer,'HISTORICAL_PREIMAGE_UNAVAILABLE',r.sha256);}
 for(const order of designOrders){const v=order.attestation,occurrence=occurrences.find(x=>x.iteration===order.iteration);
  assert.equal(occurrence.step,'review-architecture','source design order role');assert.equal(v.step,occurrence.step,'source design order step');assert.equal(v.verdict,'APPROVE','source design order verdict');assert.deepEqual(v.unresolvedFindings,[],'source design order findings');assert.equal(v.sessionKey,'enterprise-architecture-reviewer','source design session key');
  const prior=occurrences.filter(x=>x.iteration<order.iteration&&x.step==='design-architecture').at(-1);assert.ok(prior,'source design before order required');
  if(order.tag==='enterprise-recovery-design-attestation'){assert.equal(v.schemaVersion,1,'source original recovery schema');assert.equal(v.permission,'EVIDENCE_REGENERATION_ONLY');assert.equal(v.contractPath,'work/enterprise/REJECTED_REGENERATION.md');}
  else if(order.tag==='enterprise-failed-interval-design-attestation'){assert.equal(v.schemaVersion,2,'source original interval schema');assert.equal(v.permission,'PREPARATION_AND_HISTORY_ONLY');assert.equal(v.purpose,'PREPARE_DISTINCT_RUN_CONTINUATION');assert.equal(v.targetRunSlug,undefined,'source order target authority');assert.equal(v.contractPath,'work/enterprise/FAILED_INTERVAL_RECOVERY.md');
   const review=occurrences.filter(x=>x.iteration<order.iteration&&x.step==='review-foundation').at(-1),r=v.latestFoundationReview;assert.ok(review&&r,'source review predecessor');assert.equal(review.iteration,r.iteration,'source stale foundation review');for(const p of review.phases.filter(x=>x.phase<3))assert.equal(p.contentSha256,r['phase'+p.phase+'Sha256'],'source original review phase');
   const builds=occurrences.filter(x=>x.step==='build-foundation'&&x.iteration>review.iteration&&x.iteration<order.iteration);assert.deepEqual(v.subsequentBuilderOccurrences.map(x=>x.iteration),builds.map(x=>x.iteration),'source original builder interval');
   for(const [i,b] of builds.entries())for(const phase of b.phases.filter(x=>x.phase<3)){assert.equal(v.subsequentBuilderOccurrences[i]['phase'+phase.phase+'ExecutionId'],phase.phaseExecutionId,'source original builder phase id');assert.equal(v.subsequentBuilderOccurrences[i]['phase'+phase.phase+'Sha256'],phase.contentSha256,'source original builder phase hash');}
  }else assert.fail('source unsupported original order schema');
  const source=available.get(v.planSha256)?.[0];if(!source){order.definitionStatus='UNPROVEN';continue;}const original=strictPreparationJSON(bind('project',source.path));assert.ok(original&&typeof original==='object'&&Array.isArray(original.issues)&&Array.isArray(original.batches),'source original plan structure');assert.equal(original.schemaVersion,1,'source original plan version');assert.equal(new Set(original.issues.map(x=>x.id)).size,original.issues.length,'source original duplicate issue');assert.equal(new Set(original.batches.map(x=>x.id)).size,original.batches.length,'source original duplicate batch');if(v.activeBatchId){const end=original.batches.findIndex(x=>x.id===v.activeBatchId);assert.ok(end>=0);assert.deepEqual(original.batches.slice(0,end+1).map(x=>x.id),v.prefixBatchIds,'source original batch prefix');}
  if(original.failedIntervalRecovery?.sourceRunSlug!==undefined)assert.equal(original.failedIntervalRecovery.sourceRunSlug,occurrences[0].sourceRunSlug,'source definition run');
  order.definitionStatus='BOUND_ORIGINAL_BYTES';order.originalPlan={path:source.path,sha256:v.planSha256,schemaVersion:original.schemaVersion};
 }
 // Each observed absence participates in the stability comparison as well.
 const consumers=[],references=[],consumerIds=new Map(),referenceIds=new Map();
 const intern=(value,list,map)=>{const key=JSON.stringify(value);if(!map.has(key)){map.set(key,list.length);list.push(value);}return map.get(key);};
 const obligations=requirements.map(({consumer,pointer,...ref})=>({consumer:intern(consumer,consumers,consumerIds),pointer,reference:intern(ref,references,referenceIds)}));
 const resolutions=references.map(r=>{const source=(available.get(r.sha256)??[]).find(x=>r.bytes===undefined||r.bytes===x.bytes);return source?{path:source.path,sha256:r.sha256,bytes:source.bytes}:null;});
 // Intern repeated locators, never consumer obligations. Each original pointer
 // remains present even when many consumers require the same historical bytes.
 return {handoffs,consumers,references,obligations,resolutions,orders:designOrders,observations:[...observations.values()]};
}

// The source checkpoint authenticates the orchestrator-owned producer key and
// record inventory. Model prose and P's mutable persona store are never keys.
// These records can be produced by an execution observer; their absence in an
// old runtime is an explicit gap, not permission to reconstruct them afterward.
function sourceSessionBindings(meta,identity,occurrences,records,bind,pending){
 const descriptor=meta.sessionProvenance;
 if(!descriptor)return;
 prepExact(descriptor,['schemaVersion','kind','publicKey','producer','records'],'source producer descriptor');assert.equal(descriptor.schemaVersion,1);assert.equal(descriptor.kind,'TAKT_BOUND_PROVIDER_EXECUTION_V1');
 prepExact(descriptor.producer,['path','sha256','bytes','entryPoint'],'source producer');assert.equal(descriptor.producer.entryPoint,'recordSourceExecution');
 bind('project',descriptor.producer.path,descriptor.producer);
 const key=createPublicKey(descriptor.publicKey);assert.equal(key.asymmetricKeyType,'ed25519','source producer key');
 const raw=bind('source',descriptor.records.path,descriptor.records),envelope=strictPreparationJSON(raw);prepExact(envelope,['schemaVersion','records'],'source executions');assert.equal(envelope.schemaVersion,1);assert.ok(Array.isArray(envelope.records));
 assert.equal(envelope.records.length,occurrences.length*2,'source execution record coverage');let at=0;const writes=new Set(),reviews=[];
 for(const o of occurrences){const ids=[];
  for(const phase of o.phases.filter(x=>[1,2].includes(x.phase))){const record=envelope.records[at++];prepExact(record,['payload','signature'],'source execution signature');const v=record.payload;
   prepExact(v,['runSlug','workflowRef','bundleDigest','iteration','step','phase','phaseExecutionId','provider','model','providerSessionId','status','contentSha256','producerSha256'],'source execution payload');
   assert.ok(verifySignature(null,Buffer.from(JSON.stringify(v)),key,Buffer.from(record.signature,'base64')),'source producer signature');
   for(const [k,expected] of Object.entries({runSlug:identity.runSlug,workflowRef:identity.workflowRef,bundleDigest:identity.bundleDigest,iteration:o.iteration,step:o.step,phase:phase.phase,phaseExecutionId:phase.phaseExecutionId,provider:o.provider,model:o.model,status:'done',contentSha256:phase.contentSha256,producerSha256:descriptor.producer.sha256}))assert.equal(v[k],expected,'source producer occurrence '+k);
   assert.ok(typeof v.providerSessionId==='string'&&v.providerSessionId.length>0,'source producer session');ids.push(v.providerSessionId);
  }
  assert.equal(ids[0],ids[1],'source phase session mismatch');o.sessionBinding='AUTHENTICATED';o.providerSessionId=ids[0];o.sessionEvidence={descriptorPointer:'/sessionProvenance',records:descriptor.records,producer:descriptor.producer,recordPointers:['/records/'+(at-2),'/records/'+(at-1)]};
  if(o.role==='WRITE')writes.add(ids[0]);else reviews.push(ids[0]);
 }
 for(const session of reviews)assert.ok(!writes.has(session),'source independent reviewer aliases writer');
}

// Private read capability: only the authenticated P context and approved plan
// select S. No currentContext is constructed for S and no current session store
// is consulted to authenticate a historical provider execution.
function sourceProvenanceRead(auth){
 const {root,context,definitions,plan,base}=auth,d=definitions.scope.sourceProvenanceDefinition;
 if(!d)return null;
 const dependencies=new Map();
 const bind=(space,path,expected)=>{
  const directory=space==='project'?root:sourceRoot;
  assert.equal(relative(directory,confined(directory,path)),path,'source canonical path');assert.ok(!path.includes('\\'),'source path separator');
  const raw=bytes(directory,path),ref={space,path,sha256:hash(raw),bytes:raw.length},key=space+':'+path;
  if(expected){assert.equal(ref.sha256,expected.sha256,'source dependency hash: '+path);if(expected.bytes!==undefined)assert.equal(ref.bytes,expected.bytes,'source dependency length');}
  if(dependencies.has(key))assert.deepEqual(dependencies.get(key),ref,'source conflicting locator');
  dependencies.set(key,ref);return raw;
 };
 const sourceRoot=confined(resolve(context.identity.runRoot,'..'),d.sourceRunSlug);
 const predecessor=sourcePredecessor(auth,bind);
 assert.notEqual(d.sourceRunSlug,context.identity.runSlug,'source cannot impersonate P');
 for(const r of Object.values(d.sourceCheckpoint))bind('project',r.path,r);
 const identity=JSON.parse(bind('project',d.sourceCheckpoint.progress.path,d.sourceCheckpoint.progress)).runBinding;
 for(const [k,v] of Object.entries({project:root,stateId:context.identity.stateId,runSlug:d.sourceRunSlug,runRoot:sourceRoot}))assert.equal(identity[k],v,'source identity '+k);
 const meta=strictPreparationJSON(bind('project',d.sourceMeta.path,d.sourceMeta)),logRaw=bind('project',d.sourceLog.path,d.sourceLog);
 assert.deepEqual(bind('source','meta.json'),bytes(root,d.sourceMeta.path),'source terminal meta changed');
 const logPath=relative(sourceRoot,identity.logPath);assert.ok(logPath.startsWith('logs/'),'source log location');assert.deepEqual(bind('source',logPath),logRaw,'source log changed');
 const bundle=snapshot(sourceRoot,['workflow-bundle']);assert.equal(bundle.digest,identity.bundleDigest,'source bundle digest');for(const e of bundle.entries)bind('source',e.path,e);
 const bpath=sourceRoot+'/workflow-bundle',loaded=loadWorkflowExecutionBundle({slug:d.sourceRunSlug,workflowBundleAbs:bpath,workflowBundleObjectsAbs:bpath+'/objects',workflowBundleResourcesAbs:bpath+'/resources',workflowBundleManifestAbs:bpath+'/manifest.json',workflowBundleManifestHashAbs:bpath+'/manifest.sha256'});
 assert.equal(loaded.manifest.root.originalWorkflowRef,identity.workflowRef,'source logical workflow');assert.equal(loaded.rootWorkflow.name,identity.workflow,'source workflow');assert.equal(meta.workflow,identity.workflow);
 const records=logRaw.toString().trim().split('\n').map(strictPreparationJSON),terminal=records.at(-1),occurrences=[],unresolved=[];
 assert.equal(records[0]?.type,'workflow_start','source initial record');assert.equal(records[0].workflowName,identity.workflow);
 assert.equal(terminal?.type,'workflow_abort','source terminal record');assert.equal(terminal.reason,meta.reason);assert.equal(terminal.endTime,meta.endTime);assert.equal(terminal.iterations,meta.iterations);assert.equal(meta.status,'failed');
 const pending=(consumer,pointer,reason,expectedHash=null)=>unresolved.push({consumer,pointer,expectedHash,reason,disposition:'UNPROVEN'});
 const starts=records.flatMap((r,i)=>r.type==='step_start'?[i]:[]),counts=new Map();assert.equal(starts.length,terminal.iterations,'source occurrence coverage');assert.equal(starts[0],1,'source unknown initial interval');
 const recognized=new Set(['phase_start','phase_complete','phase_judge_stage','step_complete']);
 for(const [n,i] of starts.entries()){
  const s=records[i],end=starts[n+1]??records.length-1,def=loaded.rootWorkflow.steps.find(x=>x.name===s.step);assert.ok(def,'source unknown step');
  assert.equal(s.iteration,n+1,'source iteration order');assert.equal(s.workflow,identity.workflow);assert.equal(s.stack?.length,1,'source stack depth');
  const count=(counts.get(s.step)??0)+1;counts.set(s.step,count);assert.deepEqual(s.stack[0],{workflow:identity.workflow,workflow_ref:identity.workflowRef,step:s.step,kind:'agent',occurrence:count},'source occurrence identity');
  assert.equal(s.provider,'codex','source provider');assert.ok(['gpt-6.1-sol','gpt-6-astra'].includes(s.model),'source model');assert.ok(['medium','high'].includes(s.providerOptions?.codex?.reasoningEffort),'source effort');
  const reviewer=s.step.startsWith('review-')||s.step==='final-audit';if(reviewer)validateReadonlyDefinition(def,'source reviewer');else assert.equal(def.edit,true,'source editable role');
  const events=records.slice(i+1,end);for(const e of events){assert.ok(recognized.has(e.type),'source unknown intervening record');for(const k of ['iteration','step','workflow','stack'])assert.deepEqual(e[k],s[k],'source event '+k);}
  const done=events.flatMap((e,j)=>e.type==='step_complete'?[j]:[]);assert.deepEqual(done,[events.length-1],'source completion order');assert.equal(events.at(-1).status,'done');
  const phases=[];let last=-1;
  for(const phase of [1,2,3]){
   const ps=events.flatMap((e,j)=>e.type==='phase_start'&&e.phase===phase?[j]:[]),pc=events.flatMap((e,j)=>e.type==='phase_complete'&&e.phase===phase?[j]:[]);
   assert.equal(ps.length,1,'source missing or forked phase start');assert.equal(pc.length,1,'source missing or forked phase completion');assert.ok(ps[0]>last&&pc[0]>ps[0]&&pc[0]<done[0],'source phase order');last=pc[0];
   const a=events[ps[0]],z=events[pc[0]],id=s.step+':'+s.iteration+':'+phase+':1';assert.equal(a.phaseExecutionId,id,'source phase identity');assert.equal(z.phaseExecutionId,id,'source phase completion identity');assert.equal(z.status,'done','source incomplete phase');assert.equal(typeof z.content,'string','source phase content');
   phases.push({phase,phaseExecutionId:id,startPointer:'/records/'+(i+1+ps[0]),completePointer:'/records/'+(i+1+pc[0]),contentSha256:hash(z.content)});
  }
  // Presence of an ID in prose or a mutable store cannot close this obligation.
  // The 0.71 logger does not emit a provider-execution record for these phases.
  pending('occurrence:'+s.iteration,'/records/'+i+'/providerSessionId','SAVED_PRODUCER_BOUND_SESSION_RECORD_REQUIRED');
  pending('occurrence:'+s.iteration,'/records/'+i+'/originalDefinition','ORIGINAL_PLAN_ORDER_AND_ROUTING_PROOF_REQUIRED');
  occurrences.push({sourceRunSlug:d.sourceRunSlug,workflowRef:identity.workflowRef,iteration:s.iteration,step:s.step,startPointer:'/records/'+i,completionPointer:'/records/'+(end-1),definitionSha256:hash(JSON.stringify(def)),provider:s.provider,model:s.model,role:reviewer?'REVIEW':'WRITE',phases,recordStructure:'VALIDATED',sessionBinding:'UNPROVEN',originalDefinition:'UNPROVEN',status:'UNPROVEN'});
 }
 assert.equal(starts.length,meta.currentIteration);assert.equal(records[starts.at(-1)].step,meta.currentStep);
 sourceSessionBindings(meta,identity,occurrences,records,bind,pending);
 for(const o of occurrences.filter(x=>x.sessionBinding==='AUTHENTICATED')){const n=unresolved.findIndex(x=>x.consumer==='occurrence:'+o.iteration&&x.reason==='SAVED_PRODUCER_BOUND_SESSION_RECORD_REQUIRED');assert.ok(n>=0);unresolved.splice(n,1);}
 const canonicalReports=[];
 for(const step of new Set(occurrences.map(x=>x.step))){const o=occurrences.filter(x=>x.step===step).at(-1),def=loaded.rootWorkflow.steps.find(x=>x.name===step);if(def.outputContracts?.length===1){const path='reports/'+def.outputContracts[0].name,raw=bind('source',path),text=records[Number(o.phases[1].completePointer.split('/').at(-1))].content;assert.ok(raw.toString()===text||raw.toString()===text+'\n','source canonical phase report');canonicalReports.push({iteration:o.iteration,path,sha256:hash(raw),bytes:raw.length});}}
 const {observations:readObservations,...referenceAudit}=sourceReferenceAudit(root,records,occurrences,bind,pending);
 pending('source-runtime','/identity/runtime','DECLARATION_IS_NOT_HISTORICAL_INSTALLATION_OR_HOST_PROOF');pending('source-writers','/terminal','TERMINAL_IS_NOT_WRITER_EXCLUSION');
 const inventory=[...dependencies.values()].sort((a,b)=>(a.space+':'+a.path).localeCompare(b.space+':'+b.path,'en'));
 const assessment={schemaVersion:1,kind:'SOURCE_PROVENANCE_ASSESSMENT',predecessor,sourceIdentity:{project:root,stateId:identity.stateId,runSlug:d.sourceRunSlug,runRoot:sourceRoot,workflow:identity.workflow,workflowRef:identity.workflowRef,bundleDigest:identity.bundleDigest},sourceCheckpoint:d.sourceCheckpoint,sourceDefinitionSha256:hash(JSON.stringify(d)),inventory,occurrences,canonicalReports,referenceAudit,unresolved,implementationContract:'NOT_ESTABLISHED_BY_ASSESSMENT',actualSourceProvenance:'UNPROVEN',actualHistoryCompleteness:'UNPROVEN',completeH:false,productVerified:false,initializationAuthority:false,targetLaunchAuthority:false,runtimeReplacementAuthority:false};
 return {assessment,readObservations};
}

// All history consumers share this validator. Checkpoints are authenticated plan
// data; no caller can select an alternative legacy prefix or a trusted digest.
function historyRef(root,ref){
 prepExact(ref,['path','sha256','bytes'],'history reference');assert.match(ref.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(ref.bytes)&&ref.bytes>=0);
 assert.equal(relative(root,confined(root,ref.path)),ref.path,'history canonical reference');
 const raw=bytes(root,ref.path);assert.equal(hash(raw),ref.sha256,'preparation history bytes: '+ref.path);assert.equal(raw.length,ref.bytes,'preparation history length');return raw;
}
const historyReference=(root,path)=>{const raw=bytes(root,path);return {path,sha256:hash(raw),bytes:raw.length};};
const terminalClosure=(prior,attempt,start,status,receipt=null,failure=null)=>hash(JSON.stringify(['PREP_HISTORY_TERMINAL_V1',prior,attempt,start,status,receipt,failure]));
function prepLegacy(auth,cap){
 const {root,base,definitions,context}=auth,f=definitions.failureHistory;
 assert.equal(f.schemaVersion,1,'history definition');assert.equal(f.eventFormatVersion,2);assert.equal(f.checkpointMeaning,'CURRENT_ASSESSMENT_NOT_CONTEMPORANEOUS_MANIFEST');
 const checkpointRaw=bytes(root,f.checkpoint.path);assert.equal(hash(checkpointRaw),f.checkpoint.sha256,'history checkpoint');const c=strictPreparationJSON(checkpointRaw);
 assert.equal(c.schemaVersion,1);assert.equal(c.kind,'PREPARATION_LEGACY_PREFIX_ASSESSMENT');assert.equal(c.runSlug,context.identity.runSlug,'history checkpoint run');assert.deepEqual(c.attempts,f.legacyAttempts,'history prefix attempts');
 const oldRaw=historyRef(root,c.journal).toString(),old=prepJournal(oldRaw),now=prepJournal(prepRaw(root,base+'/journal.json'));
 assert.deepEqual(old.events.filter(e=>e.status==='RUNNING').map(e=>e.attempt),c.attempts,'history prefix sequence');
 assert.deepEqual(now.events.slice(0,old.events.length),old.events,'preparation legacy event changed');
 assert.equal(new Set(c.inventory.map(e=>e.path)).size,c.inventory.length,'history duplicate file');
 const mutable=new Map([[base+'/journal.json',c.journal],[base+'/request.json',c.request]]);
 for(const ref of c.inventory){prepPath(root,base,ref.path);const saved=mutable.get(ref.path);if(saved){assert.equal(saved.sha256,ref.sha256);assert.equal(saved.bytes,ref.bytes);historyRef(root,saved);}else historyRef(root,ref);}
 for(const n of c.attempts){const prefix=base+'/attempts/'+n+'/';assert.deepEqual(snapshot(root,[prefix.slice(0,-1)]).entries,c.inventory.filter(e=>e.path.startsWith(prefix)).sort((a,b)=>a.path.localeCompare(b.path,'en')),'history legacy inventory');}
 // Bind the assessed bytes to completed historical occurrences, never a fake
 // current builder. The current A_P authorizes the checkpoint, not their success.
 for(const e of old.events.filter(e=>e.status==='RUNNING')){
  const i=context.records.findIndex(r=>r.type==='step_start'&&r.step==='build-foundation'&&r.iteration===e.builderIteration);
  const b=completed(context,i,'enterprise-builder',false);assert.equal(b.session,e.builderSessionId,'history builder session');
  for(const k of ['runSlug','workflowRef','bundleDigest'])assert.equal(e[k],context.identity[k],'history '+k);
  const ai=context.records.findLastIndex((r,j)=>j<i&&r.type==='step_start'&&r.step==='review-architecture'),a=completed(context,ai,'enterprise-architecture-reviewer');
  const block1=block(a.phases[0].content,'enterprise-continuation-preparation-attestation'),block2=block(a.phases[1].content,'enterprise-continuation-preparation-attestation');assert.deepEqual(block1,block2,'history approval phases');assert.equal(block2.verdict,'APPROVE');assert.equal(block2.providerSessionId,a.session);assert.equal(block2.planSha256,e.planSha256,'history original approval plan');
  assert.ok([hash(a.phases[1].content),hash(a.phases[1].content+'\n')].includes(e.designReportSha256),'history original approval bytes');assert.notEqual(a.session,b.session);
  const dir=base+'/attempts/'+e.attempt,d=prepRead(root,dir+'/definitions.json'),m=prepRead(root,dir+'/inputs.json'),ex=prepRead(root,dir+'/execution.json');
  assert.equal(m.digest,e.inputsDigest);assert.equal(m.digest,hash(JSON.stringify({entries:m.entries,runtime:m.runtime})));
  assert.equal(hash(bytes(root,dir+'/frozen/work/enterprise/plan.json')),e.planSha256);assert.deepEqual(ex.argv,d.argv);assert.equal(ex.cwd,root);assert.ok(Date.parse(ex.finishedAt)<=Date.parse(b.phases[0].timestamp),'history execution before report');const disposition=c.dispositions?.find(x=>x.attempt===e.attempt);if(disposition){const terminal=old.events.filter(x=>x.attempt===e.attempt).at(-1);assert.equal(terminal.status,disposition.terminal);assert.equal(ex.exitCode,disposition.subprocessExit);if(disposition.cause==='MISSING_REQUIRED_ASSERTIONS'){let failure;try{parseTap(bytes(root,dir+'/output/stdout.tap').toString(),d.required);}catch(error){failure=error.message;}assert.equal(terminal.error,failure,'history original failure cause');}if(disposition.cause==='INPUTS_CHANGED')assert.ok(terminal.error.startsWith('preparation inputs changed'),'history original input failure');if(terminal.status==='PASSED')assert.equal(parseTap(bytes(root,dir+'/output/stdout.tap').toString(),d.required).tests,disposition.tests);}
 }
 if(f.rejection){
  const raw=historyRef(root,c.review),a=block(raw.toString(),'enterprise-batch-attestation');assert.equal(a.verdict,'REQUEST_CHANGES');assert.ok(a.unresolvedFindings.some(x=>JSON.stringify(x).includes(f.finding)),'history rejection finding');
  const r=completed(context,context.records.findIndex(x=>x.type==='step_start'&&x.step==='review-foundation'&&x.iteration===a.iteration),'enterprise-batch-reviewer');
  assert.equal(r.session,a.providerSessionId);for(const phase of r.phases)assert.deepEqual(block(phase.content,'enterprise-batch-attestation'),a,'history rejection phases');assert.ok(raw.toString()===r.phases[1].content||raw.toString()===r.phases[1].content+'\n');
  const approvalRaw=historyRef(root,c.originalDesignApproval);assert.equal(hash(approvalRaw),f.historicalApproval.sha256);assert.equal(hash(raw),f.rejection.sha256);
  const req=strictPreparationJSON(historyRef(root,c.request)),last=old.events.at(-1);assert.equal(last.status,'PASSED');assert.deepEqual(req.receipt,last.receipt);assert.deepEqual(a.receipt,last.receipt);assert.deepEqual(a.request,{path:base+'/request.json',sha256:c.request.sha256});
  const b=completed(context,context.records.findIndex(x=>x.type==='step_start'&&x.step==='build-foundation'&&x.iteration===req.builderIteration),'enterprise-builder',false);for(const p of b.phases){const v=block(p.content,'enterprise-preparation-candidate');assert.deepEqual(v.receipt,last.receipt);assert.deepEqual(v.request,a.request);}assert.ok(r.index>=b.end,'history review chronology');
 }
 const archive=base+'/history/'+f.checkpoint.sha256;
 const copies=[['checkpoint.json',checkpointRaw.toString()],['journal.json',oldRaw],...(c.request?[['request.json',historyRef(root,c.request).toString()]]:[])];
 for(const [name,raw] of copies){const p=archive+'/'+name;if(existsSync(confined(root,p)))assert.equal(prepRaw(root,p),raw,'history archive changed');else if(cap){if(name==='request.json')assert.equal(prepRaw(root,base+'/request.json'),raw,'history original request CAS');if(name==='journal.json'){const current=prepRaw(root,base+'/journal.json');if(current!==null||old.events.length!==0)assert.equal(current,raw,'history original journal CAS');}prepOwned(cap);mkdirSync(dirname(confined(root,p)),{recursive:true});prepAtomic(cap,p,raw,null);}else assert.equal(now.events.length,old.events.length,'history adoption incomplete');}
 return {checkpointSha256:f.checkpoint.sha256,closure:hash(JSON.stringify(['PREP_HISTORY_LEGACY_V1',f.checkpoint.sha256])),count:old.events.length};
}
// A PASSED attempt requires identical before/after input bytes. The start
// descriptor already authenticates their expected hash and length, including
// receipts written before inputs-after.json was added to the frozen inventory.
// Validate those old receipts without rewriting or promoting their evidence.
function prepPassedInputs(root,dir,start,receipt){
 const initial=start.references.find(ref=>ref.path===dir+'/inputs.json');
 assert.ok(initial,'preparation history initial inputs reference');
 const before=historyRef(root,initial);
 const after=historyRef(root,{...initial,path:dir+'/inputs-after.json'});
 assert.deepEqual(after,before,'preparation history inputs-after bytes');
 const observed=strictPreparationJSON(after);
 assert.deepEqual(observed,receipt.inputs,'preparation history inputs-after manifest');
 assert.equal(observed.digest,receipt.inputsAfter,'preparation history inputs-after digest');
 assert.equal(observed.digest,receipt.inputsDigest,'preparation history inputs-after identity');
}
function prepHistory(auth,cap){
 const {root,base}=auth;
 try{
  const legacy=prepLegacy(auth,cap),j=prepJournal(prepRaw(root,base+'/journal.json'));const attemptsPath=confined(root,base+'/attempts');const actual=existsSync(attemptsPath)?readdirSync(attemptsPath).sort((a,b)=>Number(a)-Number(b)):[];assert.deepEqual(actual,j.events.filter(e=>e.status==='RUNNING').map(e=>String(e.attempt)),'preparation history unmapped attempt');let closure=legacy.closure,running,start,startRef,head=null,passed=false;
  for(const e of j.events.slice(legacy.count)){
   assert.ok(e.acceptanceScope,'preparation journal scope missing');assert.equal(e.eventFormatVersion,2,'preparation history event format');assert.ok(e.acceptanceScope,'preparation journal scope missing');
   if(e.status==='RUNNING'){
    prepExact(e,['eventFormatVersion','attempt','sequence','status','startedAt','acceptanceScope','runSlug','workflowRef','bundleDigest','builderIteration','builderSessionId','increment','planSha256','inputsDigest','designReportSha256','startDescriptor','priorClosure'],'history running');
    startRef=e.startDescriptor;assert.equal(startRef.path,base+'/attempts/'+e.attempt+'/start.json','history descriptor attempt path');start=strictPreparationJSON(historyRef(root,startRef));
    prepExact(start,['schemaVersion','attempt','sequence','startedAt','identity','runtime','priorClosure','checkpointSha256','references','argv','sourceCheckpoint','designReport'],'start descriptor');assert.equal(start.schemaVersion,1);assert.equal(start.attempt,e.attempt);assert.equal(start.sequence,e.sequence);assert.equal(start.startedAt,e.startedAt);assert.equal(start.priorClosure,closure,'history prior closure');assert.equal(e.priorClosure,closure,'history running closure');assert.equal(start.checkpointSha256,legacy.checkpointSha256);
    prepExact(start.identity,['acceptanceScope','runSlug','workflowRef','bundleDigest','builderIteration','builderSessionId','increment','planSha256','inputsDigest','designReportSha256'],'history identity');for(const [k,v] of Object.entries(start.identity))assert.deepEqual(e[k],v,'history running identity');
    const dir=base+'/attempts/'+e.attempt;for(const ref of start.references){prepPath(root,dir,ref.path);historyRef(root,ref);}
    assert.deepEqual(snapshot(root,[dir+'/scope.json',dir+'/inputs.json',dir+'/definitions.json',dir+'/frozen',dir+'/frozen-authority']).entries,start.references,'history frozen inventory');
    const d=prepRead(root,dir+'/definitions.json'),m=prepRead(root,dir+'/inputs.json');assert.deepEqual(d.acceptanceScope,e.acceptanceScope);assert.deepEqual(d.scope,prepRead(root,dir+'/scope.json'));assert.equal(m.digest,hash(JSON.stringify({entries:m.entries,runtime:m.runtime})));assert.equal(m.digest,e.inputsDigest);assert.deepEqual(start.runtime,m.runtime);assert.deepEqual(start.argv,d.argv);const frozenPlan=prepRead(root,dir+'/frozen/work/enterprise/plan.json');assert.deepEqual(prepDefinitions(frozenPlan),d,'history approved definitions');assert.equal(hash(bytes(root,dir+'/frozen/work/enterprise/plan.json')),e.planSha256,'history frozen plan');assert.deepEqual(start.sourceCheckpoint,frozenPlan.preparationEntry.sourceCheckpoint,'history source checkpoint');for(const ref of Object.values(start.sourceCheckpoint))assert.equal(hash(bytes(root,dir+'/frozen-authority/'+ref.path)),ref.sha256,'history frozen source');assert.equal(start.designReport.path,dir+'/frozen-authority/design-report.md');assert.equal(hash(historyRef(root,start.designReport)),e.designReportSha256,'history frozen approval');
    running=e;passed=false;head=null;
   }else{
    assert.ok(running&&start,'history terminal without start');const dir=base+'/attempts/'+e.attempt;
    assert.deepEqual(e.acceptanceScope,running.acceptanceScope,'history terminal scope');
    const binding={checkpointSha256:legacy.checkpointSha256,priorClosure:start.priorClosure,startDescriptorSha256:startRef.sha256};let next;
    if(e.status==='PASSED'){
     prepExact(e,['eventFormatVersion','attempt','sequence','status','acceptanceScope','receipt','terminalClosure'],'history passed');
     assert.equal(e.receipt.path,dir+'/receipt.json');const r=strictPreparationJSON(prepBound(root,base,e.receipt));assert.equal(r.schemaVersion,3,'preparation receipt schemaVersion');assert.deepEqual(r.historyBinding,binding,'history receipt binding');assert.equal(r.attempt,e.attempt);assert.equal(r.status,'PASSED');for(const [k,v] of Object.entries(start.identity))assert.deepEqual(r[k],v,'history receipt identity');
     for(const ref of [...r.frozen.entries,...r.outputs.entries])historyRef(root,ref);assert.deepEqual(snapshot(root,[dir+'/output']),r.outputs,'history output inventory');assert.deepEqual(r.execution,prepRead(root,dir+'/execution.json'));assert.deepEqual(r.execution.argv,start.argv);assert.equal(r.execution.exitCode,0);assert.equal(r.execution.signal,null);assert.equal(r.execution.producers?.stopped,true,'history producer completion');assert.equal(r.inputsAfter,r.inputsDigest);assert.deepEqual(parseTap(prepBound(root,base,r.stdout).toString(),r.definitions.required),r.tap);
     prepPassedInputs(root,dir,start,r);
     if(r.definitions.scope.sourceProvenanceDefinition)sourceAssessmentArtifact({...auth,definitions:r.definitions,plan:prepRead(root,dir+'/frozen/work/enterprise/plan.json')},dir);
     next=terminalClosure(start.priorClosure,e.attempt,startRef.sha256,'PASSED',e.receipt.sha256);passed=true;
    }else{
     prepExact(e,['eventFormatVersion','attempt','sequence','status','acceptanceScope','error','finishedAt','failureManifest','terminalClosure'],'history failed');assert.equal(e.failureManifest.path,dir+'/failure.json');
     const f=strictPreparationJSON(historyRef(root,e.failureManifest));prepExact(f,['schemaVersion','attempt','sequence','startDescriptor','running','priorClosure','stage','code','diagnostic','finishedAt','inventory','existence','execution','inputsAfter'],'failure manifest');assert.equal(f.schemaVersion,1);assert.equal(f.attempt,e.attempt);assert.equal(f.sequence,e.sequence);assert.deepEqual(f.startDescriptor,startRef);assert.deepEqual(f.running,running);assert.equal(f.priorClosure,passed?closure:start.priorClosure,'history failed prior closure');assert.equal(f.finishedAt,e.finishedAt);assert.equal(historyRef(root,f.diagnostic).toString(),e.error,'history failure diagnostic');
     for(const ref of f.inventory){prepPath(root,dir,ref.path);historyRef(root,ref);}assert.deepEqual(snapshot(root,[dir]).entries.filter(x=>x.path!==e.failureManifest.path),f.inventory,'history failed inventory');
     for(const x of f.existence){prepPath(root,dir,x.path);assert.ok(['PRODUCED','NOT_PRODUCED'].includes(x.state),'history unknown evidence');assert.equal(existsSync(confined(root,x.path)),x.state==='PRODUCED','history existence');}
     if(f.execution){const ex=strictPreparationJSON(historyRef(root,f.execution));assert.deepEqual(ex.argv,start.argv);assert.equal(ex.cwd,root);assert.equal(ex.producers?.stopped,true,'history producer completion');}if(f.inputsAfter)historyRef(root,f.inputsAfter);
     assert.ok(typeof f.stage==='string'&&f.stage.length&&typeof f.code==='string'&&f.code.length);
     const diagnostic=historyRef(root,f.diagnostic).toString();let reproduced;
     if(f.stage==='RESULT'){const ex=prepRead(root,dir+'/execution.json'),d=prepRead(root,dir+'/definitions.json');try{assert.equal(ex.exitCode,0,'preparation subprocess failed');assert.equal(ex.signal,null);assert.equal(ex.error,null);parseTap(bytes(root,dir+'/output/stdout.tap').toString(),d.required);}catch(error){reproduced=error.message;}assert.equal(diagnostic,reproduced,'history failed diagnosis');}
     if(f.stage==='POST_EXECUTION'&&diagnostic.startsWith('preparation inputs changed')){assert.ok(f.inputsAfter,'history observed inputs required');try{assert.deepEqual(prepRead(root,f.inputsAfter.path),prepRead(root,dir+'/inputs.json'),'preparation inputs changed');}catch(error){reproduced=error.message;}assert.equal(diagnostic,reproduced,'history input failure diagnosis');}
     next=terminalClosure(f.priorClosure,e.attempt,startRef.sha256,'FAILED',null,e.failureManifest.sha256);
    }
    assert.equal(e.terminalClosure,next,'history terminal closure');closure=next;head={attempt:e.attempt,terminalClosure:closure};
   }
  }
  return {checkpointSha256:legacy.checkpointSha256,closure,head};
 }catch(e){if(existsSync(confined(root,base+'/writer.lock')))throw new Error('preparation writer fenced: '+e.message);throw e;}
}
// Recovery preflight is separate from ordinary readiness. It never supplies a
// bypass option to prepAuthority and never trusts a caller-selected attempt/PID.
// This bounded implementation authenticates the exact incomplete tail only;
// publication remains disabled until native coverage and the durable protocol
// are implemented and tested. A successful preflight is not quiescence proof.
async function prepRecoveryAuthority(root){
 root=resolve(root);const context=await currentContext(root),base=prepBase(context);
 prepAdmission(root,base);
 // Pin the observed fence before authority awaits or the first content read.
 // Sampling it after the inventory scan would adopt a concurrent replacement
 // with identical bytes. ctime also detects in-place writes with restored mtime.
 // This is invocation-local identity, not proof of historical ownership.
 const fencePath=base+'/writer.lock';
 const fenceIdentityNow=()=>{
  const st=statSync(prepPath(root,base,fencePath),{bigint:true});
  assert.ok(st.isFile(),'recovery fence must be a regular file');
  return {dev:st.dev,ino:st.ino,size:st.size,mtimeNs:st.mtimeNs,ctimeNs:st.ctimeNs};
 };
 const fenceIdentity=fenceIdentityNow();
 const checkFence=()=>assert.deepEqual(fenceIdentityNow(),fenceIdentity,'recovery fence identity changed');
 const ar=completed(context,context.records.findLastIndex(r=>r.type==='step_start'&&r.step==='review-architecture'),'enterprise-architecture-reviewer');
 const approved=block(ar.phases[1].content,'enterprise-continuation-preparation-attestation');
 const versioned=base+'/reviewed-inputs.'+approved.inputsDigest+'.json';
 const manifest=existsSync(confined(root,versioned))?versioned:base+'/reviewed-inputs.json';
 const authority=await successorAuthority(root,manifest);checkFence();
 assert.deepEqual(await currentContext(root),context,'recovery authority changed');checkFence();
 const plan=prepRead(root,'work/enterprise/plan.json'),p=plan.preparationReview,d=p?.acceptanceScope?.captureRecoveryDefinition;
 assert.equal(p?.enabledRunSlug,context.identity.runSlug,'recovery enabled run');assert.equal(p.namespace,base+'/','recovery namespace');
 assert.equal(p.acceptanceScope.profileId,'P0-source-provenance-v2','recovery profile');assert.equal(d?.schemaVersion,1,'recovery definition');
 assert.equal(d.profileId,p.acceptanceScope.profileId);assert.equal(d.entry,'--recover-preparation-capture');
 assert.equal(d.contract,'work/enterprise/PREPARATION_CAPTURE_RECOVERY.md');
 const contract=authority.currentInputs.entries.find(r=>r.path===d.contract),reviewed=prepRead(root,manifest).entries.find(r=>r.path===d.contract);
 assert.ok(contract&&reviewed,'recovery reviewed contract missing');assert.deepEqual(contract,reviewed,'recovery contract changed');historyRef(root,contract);
 assert.deepEqual(d.validatorConsumers,['capture','gate','candidate','review','import']);
 for(const k of ['freshIndependentApproval','preserveOriginalRunning','preserveAllPartialBytes','verifyCompletedOriginalBuilder','realNativeProcessProof','escapedDescendantsCovered','privateRecoveryGuard','sharedAdmissionFence','retainFenceOnUnknown'])assert.equal(d[k],true,'recovery definition '+k);
 for(const k of ['automaticRecovery','forceUnlock','pidAbsenceSufficient','historicalEvidenceBackfill','repackageStandaloneSuccess','latestAbortReady','oldRequestFallback','productWrites','sourceWrites'])assert.equal(d[k],false,'recovery definition '+k);
 const anchor=strictPreparationJSON(historyRef(root,d.anchor));
 prepExact(anchor,['schemaVersion','kind','observedAt','iteration','runSlug','attempt','originalStatus','currentAuthority','quiescenceProven','historicalOutcome','productVerified','references','partialInventory','historicalHandoff','absentAtObservation'],'recovery anchor');
 assert.equal(anchor.schemaVersion,1);assert.equal(anchor.kind,'INCOMPLETE_CAPTURE_RECOVERY_ANCHOR');assert.equal(anchor.runSlug,context.identity.runSlug,'recovery anchor run');
 assert.equal(anchor.originalStatus,'RUNNING');assert.equal(anchor.currentAuthority,false);assert.equal(anchor.quiescenceProven,false);assert.equal(anchor.historicalOutcome,'UNKNOWN');assert.equal(anchor.productVerified,false);
 assert.ok(Number.isSafeInteger(anchor.attempt)&&anchor.attempt>0,'recovery anchor attempt');assert.ok(Number.isFinite(Date.parse(anchor.observedAt)),'recovery anchor time');
 assert.ok(Number.isSafeInteger(anchor.iteration)&&anchor.iteration<ar.start.iteration,'recovery fresh anchor approval');
 assert.equal(d.nextAttemptMinimum,anchor.attempt+1,'recovery next sequence');
 const references=new Map(),originals=new Map(),centralReferences=new Map();
 const bind=ref=>{const raw=historyRef(root,ref);const old=references.get(ref.path);if(old)assert.deepEqual(old,ref,'recovery reference conflict');references.set(ref.path,ref);return raw;};
 bind(d.anchor);
 for(const r of anchor.references){
  prepExact(r,['originalPath','path','sha256','bytes'],'recovery original reference');assert.ok(!originals.has(r.originalPath),'recovery duplicate original');
  const saved={path:r.path,sha256:r.sha256,bytes:r.bytes};bind(saved);originals.set(r.originalPath,saved);
  // The canonical architecture report is overwritten by later orchestrator
  // reviews. Its old bytes must instead match the completed original phases.
  if(!isAbsolute(r.originalPath)){bind({...saved,path:r.originalPath});}
  else {const rel=relative(context.identity.runRoot,r.originalPath);assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'recovery foreign central reference');confined(context.identity.runRoot,rel);}
 }
 const original=path=>{const r=originals.get(path);assert.ok(r,'recovery original missing: '+path);return strictPreparationJSON(bind(r));};
 const jp=base+'/journal.json',fp=base+'/writer.lock',dir=base+'/attempts/'+anchor.attempt;
 const j=prepJournal(prepRaw(root,jp));assert.deepEqual(j,original(jp),'recovery journal changed');
 const running=j.events.at(-1);assert.equal(running?.status,'RUNNING','recovery pending terminal');assert.equal(running.attempt,anchor.attempt,'recovery tail attempt');
 assert.equal(j.events.filter(e=>e.status==='RUNNING').length,anchor.attempt,'recovery tail sequence');
 const start=prepRead(root,dir+'/start.json');assert.deepEqual(start,original(dir+'/start.json'),'recovery original start');assert.deepEqual(prepRead(root,dir+'/scope.json'),original(dir+'/scope.json'));
 for(const key of ['runSlug','workflowRef','bundleDigest'])assert.equal(running[key],context.identity[key],'recovery original '+key);
 const fence=original(fp);assert.deepEqual(prepRead(root,fp),fence,'recovery fence changed');
 prepExact(fence,['owner','runSlug','iteration','session'],'recovery original fence');assert.ok(typeof fence.owner==='string'&&fence.owner.length>0);assert.equal(fence.runSlug,running.runSlug);assert.equal(fence.iteration,running.builderIteration);assert.equal(fence.session,running.builderSessionId);
 const bi=context.records.findIndex(r=>r.type==='step_start'&&r.step==='build-foundation'&&r.iteration===running.builderIteration),builder=completed(context,bi,'enterprise-builder',false);
 assert.ok(builder.end<=ar.index,'recovery approval must follow completed original builder');assert.equal(builder.session,running.builderSessionId,'recovery original builder session');
 const ai=context.records.findLastIndex((r,i)=>i<bi&&r.type==='step_start'&&r.step==='review-architecture'),oldApproval=completed(context,ai,'enterprise-architecture-reviewer');
 const oldBlock=block(oldApproval.phases[1].content,'enterprise-continuation-preparation-attestation');assert.deepEqual(block(oldApproval.phases[0].content,'enterprise-continuation-preparation-attestation'),oldBlock,'recovery original approval phases');
 assert.equal(oldBlock.verdict,'APPROVE');assert.equal(oldBlock.runSlug,running.runSlug);assert.equal(oldBlock.workflowRef,running.workflowRef);assert.equal(oldBlock.bundleDigest,running.bundleDigest);assert.equal(oldBlock.providerSessionId,oldApproval.session);assert.notEqual(oldApproval.session,builder.session);assert.equal(oldBlock.planSha256,running.planSha256,'recovery original approval plan');
 assert.ok([hash(oldApproval.phases[1].content),hash(oldApproval.phases[1].content+'\n')].includes(running.designReportSha256),'recovery original approval bytes');
 assert.notEqual(authority.designReportSha256,running.designReportSha256,'recovery fresh approval required');
 const oldReportPath=relative(root,resolve(context.identity.reportDirectory,oldApproval.definition.outputContracts[0].name));
 const oldReport=originals.get(resolve(root,oldReportPath));assert.ok(oldReport,'recovery original approval archive');assert.equal(oldReport.sha256,running.designReportSha256);
 for(const [path,ref] of originals){if(isAbsolute(path)&&path!==resolve(root,oldReportPath)){const raw=readFileSync(confined(context.identity.runRoot,relative(context.identity.runRoot,path)));assert.equal(hash(raw),ref.sha256,'recovery central original changed');assert.equal(raw.length,ref.bytes);centralReferences.set(path,ref);}}

 const history=prepHistory({root,base,context,definitions:{failureHistory:p.failureHistory}});assert.equal(history.closure,running.priorClosure,'recovery prefix closure');assert.equal(history.head,null,'recovery incomplete tail');
 const inventory=strictPreparationJSON(bind(anchor.partialInventory));assert.equal(inventory.kind,'PRESENT_INCOMPLETE_CAPTURE_OBSERVATION');assert.equal(inventory.notFailureManifest,true);assert.equal(inventory.doesNotProveProducerShutdown,true);
 assert.ok(Array.isArray(inventory.references)&&inventory.references.length>0,'recovery partial inventory missing');
 const allowedPointers=[jp,fp,base+'/request.json',base+'/acceptances.json'];const seen=new Set();
 for(const r of inventory.references){assert.ok(!seen.has(r.path),'recovery partial duplicate');seen.add(r.path);assert.ok(r.path.startsWith(dir+'/')||allowedPointers.includes(r.path),'recovery partial outside target');bind({path:r.path,sha256:r.sha256,bytes:r.bytes});}
 assert.deepEqual(snapshot(root,[dir]).entries,inventory.references.filter(r=>r.path.startsWith(dir+'/')).map(({path,sha256,bytes})=>({path,sha256,bytes})).sort((a,b)=>a.path.localeCompare(b.path,'en')),'recovery partial inventory changed');
 assert.deepEqual(anchor.absentAtObservation,['execution.json','inputs-after.json','diagnostic.txt','failure.json','receipt.json'],'recovery absent observations');
 for(const name of anchor.absentAtObservation)assert.ok(!existsSync(prepPath(root,base,dir+'/'+name)),'recovery unexpected historical artifact: '+name);
 bind(anchor.historicalHandoff);
 const checkCentral=()=>{for(const [path,ref] of centralReferences){const raw=readFileSync(confined(context.identity.runRoot,relative(context.identity.runRoot,path)));assert.equal(hash(raw),ref.sha256,'recovery central original changed');assert.equal(raw.length,ref.bytes);}};
 checkFence();
 const recheck=async(owner)=>{
  const admission=()=>owner?prepRecoveryOwned(owner):prepAdmission(root,base);
  admission();assert.deepEqual(prepHistory({root,base,context,definitions:{failureHistory:p.failureHistory}}),history,'recovery prefix changed');checkCentral();for(const ref of references.values())historyRef(root,ref);
  assert.deepEqual(snapshot(root,[dir]).entries,inventory.references.filter(r=>r.path.startsWith(dir+'/')).map(({path,sha256,bytes})=>({path,sha256,bytes})).sort((a,b)=>a.path.localeCompare(b.path,'en')),'recovery partial changed during inspection');
  checkFence();
  assert.deepEqual(await currentContext(root),context,'recovery authority changed');assert.deepEqual(await successorAuthority(root,manifest),authority,'recovery authority changed');
  assert.deepEqual(inputs(root),authority.currentInputs,'recovery inputs changed');admission();
  for(const ref of references.values())historyRef(root,ref);checkCentral();assert.deepEqual(prepHistory({root,base,context,definitions:{failureHistory:p.failureHistory}}),history,'recovery prefix changed after authority await');
  assert.deepEqual(snapshot(root,[dir]).entries,inventory.references.filter(r=>r.path.startsWith(dir+'/')).map(({path,sha256,bytes})=>({path,sha256,bytes})).sort((a,b)=>a.path.localeCompare(b.path,'en')),'recovery partial changed after authority await');
  checkFence();
 };
 await recheck();
 return {root,base,context,authority,anchor,running,start,recheck,recoveryId:hash(JSON.stringify(['PREP_RECOVERY_ID_V1',running.runSlug,anchor.attempt,running.startDescriptor.sha256,originals.get(fp).sha256,originals.get(jp).sha256,authority.designReportSha256]))};
}
// Private native observation port. It has no caller-supplied process list,
// command, proof, or signal capability. These point-in-time observations are
// useful blockers, not a certificate of historical lineage or quiescence.
function prepProducerState(auth){
 const startedAt=new Date().toISOString(),commands=[],reasons=new Set(['COMPLETE_PRODUCER_COVERAGE_UNPROVEN','EXCLUSIVE_RECOVERY_ADMISSION_NOT_HELD']);
 const command=(file,args,emptyIsValid=false)=>{
  const observedAt=new Date().toISOString();let r;
  try{r=spawnSync(file,args,{encoding:'utf8',timeout:5000,maxBuffer:8*1024*1024,env:{...process.env,LC_ALL:'C',LANG:'C'}});}
  catch(error){r={status:null,signal:null,error};}
  const record={command:file,argv:args,observedAt,finishedAt:new Date().toISOString(),exitCode:r.status??null,signal:r.signal??null,error:r.error?{code:r.error.code??null,message:r.error.message}:null,stdout:r.stdout??'',stderr:r.stderr??''};commands.push(record);
  const valid=!record.error&&!record.signal&&!record.stderr&&(record.exitCode===0||(emptyIsValid&&record.exitCode===1&&!record.stdout));
  if(!valid)reasons.add('NATIVE_INSPECTION_FAILED');return {record,valid};
 };
 const result={schemaVersion:1,kind:'PREPARATION_NATIVE_PRODUCER_OBSERVATION',startedAt,runSlug:auth.context.identity.runSlug,attempt:auth.anchor.attempt,startDescriptor:auth.running.startDescriptor,invocation:{pid:process.pid,uid:process.getuid?.()??null},platform:process.platform,commands,scans:[],historicalLineageAuthenticated:false,completeProducerCoverage:false,quiescenceProven:false,signalsSent:[],recoveryPerformed:false};
 // Other hosts must implement their own native identity/inspection backend.
 // Do not silently substitute a weaker ps invocation for this one.
 if(process.platform!=='darwin'){reasons.add('UNSUPPORTED_NATIVE_PLATFORM');return {...result,finishedAt:new Date().toISOString(),reasons:[...reasons]};}
 const host=()=>{
  const h=command('/usr/sbin/sysctl',['-n','kern.uuid']),b=command('/usr/sbin/sysctl',['-n','kern.bootsessionuuid']);
  const value={host:h.record.stdout.trim(),boot:b.record.stdout.trim()};
  if(!h.valid||!b.valid||!Object.values(value).every(s=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s))){reasons.add('HOST_BOOT_IDENTITY_UNAVAILABLE');return null;}return value;
 };
 const identity=host();result.hostIdentity=identity;
 const dir=auth.base+'/attempts/'+auth.anchor.attempt,spawnPath=dir+'/output/producer-observations/spawn.json';
 let recorded=null;
 if(existsSync(prepPath(auth.root,auth.base,spawnPath))){
  const raw=bytes(auth.root,spawnPath),s=strictPreparationJSON(raw);
  assert.equal(s.kind,'PREPARATION_PRODUCER_SPAWN_OBSERVATION','recovery spawn kind');assert.equal(s.schemaVersion,1,'recovery spawn schema');
  assert.deepEqual(s.argv,auth.start.argv,'recovery spawn argv');assert.equal(s.cwd,auth.root,'recovery spawn cwd');assert.equal(s.detached,true,'recovery spawn group');
  assert.ok(Number.isSafeInteger(s.pid)&&s.pid>0&&Number.isSafeInteger(s.parentPid)&&s.parentPid>0,'recovery spawn pid');
  recorded={reference:{path:spawnPath,sha256:hash(raw),bytes:raw.length},pid:s.pid,parentPid:s.parentPid};
 }else reasons.add('HISTORICAL_SPAWN_OBSERVATION_MISSING');
 result.recordedSpawn=recorded;reasons.add('HISTORICAL_PROCESS_START_IDENTITY_UNPROVEN');
 const census=()=>{
  const r=command('/bin/ps',['-A','-o','pid=,ppid=,pgid=,uid=,lstart=,stat=']);if(!r.valid)return null;
  const rows=[];const seen=new Set();
  for(const line of r.record.stdout.split('\n').filter(s=>s.trim())){
   const m=/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s*$/.exec(line);
   if(!m){reasons.add('PROCESS_CENSUS_MALFORMED');return null;}
   const [pid,ppid,pgid,uid]=m.slice(1,5).map(Number);
   if(![pid,ppid,pgid,uid].every(Number.isSafeInteger)||pid<=0||seen.has(pid)){reasons.add('PROCESS_CENSUS_MALFORMED');return null;}
   seen.add(pid);rows.push({pid,ppid,pgid,uid,startTime:m[5].replace(/\s+/g,' '),state:m[6]});
  }
  if(!rows.some(p=>p.pid===process.pid&&p.uid===process.getuid())){reasons.add('PROCESS_CENSUS_INCOMPLETE');return null;}return rows;
 };
 const handles=()=>{
  const r=command('/usr/sbin/lsof',['-nP','-F0pftDin','+D',prepPath(auth.root,auth.base,dir)],true);
  // lsof can return a nonzero exit together with observed handles. Preserve
  // those positive blockers without relabelling partial inspection as success.
  if(!r.record.stdout)return r.valid?{entries:[],inspectionSucceeded:true}:null;
  const rows=[];let pid=null,row=null;
  const finish=()=>{if(row){if(!row.name||!row.fd||!row.type||!row.device||!row.inode)throw Error('incomplete handle');rows.push(row);row=null;}};
  try{
   for(const token of r.record.stdout.split('\0')){
    const field=token.replace(/^\n+/,'');if(!field)continue;const key=field[0],value=field.slice(1);
    if(key==='p'){finish();pid=Number(value);assert.ok(Number.isSafeInteger(pid)&&pid>0);}
    else if(key==='f'){finish();assert.ok(pid);row={pid,fd:value};}
    else {assert.ok(row);const name={t:'type',D:'device',i:'inode',n:'name'}[key];assert.ok(name&&!Object.hasOwn(row,name));row[name]=value;}
   }
   finish();assert.ok(rows.length);
  }catch{reasons.add('OPEN_HANDLE_OUTPUT_MALFORMED');return null;}
  return {entries:rows,inspectionSucceeded:r.valid};
 };
 for(let n=0;n<2;n++){
  const processes=census(),handleResult=handles(),openHandles=handleResult?.entries??null,relevant=new Set(openHandles?.map(r=>r.pid)??[]);
  if(recorded){relevant.add(recorded.pid);relevant.add(recorded.parentPid);}
  if(processes){
   let changed=true;while(changed){changed=false;for(const p of processes)if(!relevant.has(p.pid)&&(relevant.has(p.ppid)||(recorded&&p.pgid===recorded.pid))){relevant.add(p.pid);changed=true;}}
  }
  const selected=processes?.filter(p=>relevant.has(p.pid))??[];
  if(selected.some(p=>recorded&&(p.pid===recorded.pid||p.pid===recorded.parentPid||p.pgid===recorded.pid)))reasons.add('RECORDED_PID_OR_GROUP_PRESENT');
  if(openHandles?.length)reasons.add('RELEVANT_OPEN_HANDLES_PRESENT');
  result.scans.push({observedAt:new Date().toISOString(),censusAvailable:processes!==null,handlesAvailable:openHandles!==null,handleInspectionSucceeded:handleResult?.inspectionSucceeded??false,processes:selected,invocation:processes?.find(p=>p.pid===process.pid)??null,openHandles});
 }
 const endIdentity=host();result.endHostIdentity=endIdentity;
 if(JSON.stringify(identity)!==JSON.stringify(endIdentity))reasons.add('HOST_BOOT_IDENTITY_CHANGED');
 const [a,b]=result.scans;
 if(JSON.stringify(a.processes)!==JSON.stringify(b.processes)||JSON.stringify(a.openHandles)!==JSON.stringify(b.openHandles)||JSON.stringify(a.invocation)!==JSON.stringify(b.invocation))reasons.add('NATIVE_OBSERVATION_CHANGED');
 // Two equal snapshots do not enumerate previously escaped or exited writers,
 // authenticate a reused PID, or prevent a writer from appearing afterwards.
 return {...result,finishedAt:new Date().toISOString(),reasons:[...reasons]};
}
// Only this module can mint an admission owner. Ordinary readers never receive
// this capability and always reject the marker, including an orphan owner.
const recoveryOwners=new WeakSet();
function recoveryFileIdentity(st){return Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs'].map(k=>[k,st[k].toString()]));}
function prepRecoveryOwned(cap){
 assert.ok(recoveryOwners.has(cap),'recovery private owner required');
 const path=prepPath(cap.root,cap.base,cap.lock),st=statSync(path,{bigint:true});
 assert.deepEqual(recoveryFileIdentity(st),cap.identity,'recovery admission owner changed');
 assert.deepEqual(recoveryFileIdentity(fstatSync(cap.fd,{bigint:true})),cap.identity,'recovery admission descriptor changed');
 assert.equal(bytes(cap.root,cap.lock).toString(),cap.raw,'recovery admission bytes changed');
 assert.equal(prepRaw(cap.root,cap.journal),cap.journalRaw,'recovery intent CAS');
 if(cap.archive){
  const directory=prepPath(cap.root,cap.base,cap.archive);
  assert.deepEqual(readdirSync(directory).sort(),[...cap.artifacts.keys()].map(p=>p.slice(cap.archive.length+1)).sort(),'recovery archive inventory changed');
  for(const [path,expected] of cap.artifacts){
   const absolute=prepPath(cap.root,cap.base,path);
   const checkIdentity=()=>assert.deepEqual(recoveryFileIdentity(statSync(absolute,{bigint:true})),expected.identity,'recovery archive identity changed');
   checkIdentity();const raw=bytes(cap.root,path);
   assert.equal(raw.length,expected.bytes,'recovery archive length changed');assert.equal(hash(raw),expected.sha256,'recovery archive bytes changed');
   checkIdentity();
  }
 }
}
function prepRecoveryPublish(cap,event){
 prepRecoveryOwned(cap);
 const previous=cap.journalRaw===null?[]:strictPreparationJSON(cap.journalRaw).events;
 const record={...event,sequence:previous.length+1,previousJournalSha256:cap.journalRaw===null?null:hash(cap.journalRaw)};
 const raw=JSON.stringify({schemaVersion:1,kind:'PREPARATION_RECOVERY_JOURNAL',recoveryId:cap.recoveryId,events:[...previous,record]},null,2)+'\n';
 const path=prepPath(cap.root,cap.base,cap.journal),tmp=path+'.'+randomUUID()+'.tmp';let fd;
 try{
  fd=openSync(tmp,'wx');writeFileSync(fd,raw);fsyncSync(fd);closeSync(fd);fd=undefined;
  prepRecoveryOwned(cap);renameSync(tmp,path);cap.journalRaw=raw;
  prepSyncDir(dirname(path));prepRecoveryOwned(cap);assert.equal(bytes(cap.root,cap.journal).toString(),raw,'recovery intent readback');
 }finally{if(fd!==undefined)closeSync(fd);}
 return {path:cap.journal,sha256:hash(raw),bytes:Buffer.byteLength(raw)};
}
function prepRecoveryImmutable(cap,path,value){
 prepRecoveryOwned(cap);const absolute=prepPath(cap.root,cap.base,path),parent=dirname(absolute);
 assert.ok(statSync(parent).isDirectory(),'recovery evidence directory missing');
 prepRecoveryOwned(cap);const raw=JSON.stringify(value,null,2)+'\n',fd=openSync(absolute,'wx');
 try{
  writeFileSync(fd,raw);fsyncSync(fd);
  // Pin the object created by this owner, not a path sampled after readback.
  // Retain these references across every later phase and authority await.
  assert.ok(!cap.artifacts.has(path),'recovery archive duplicate artifact');
  cap.artifacts.set(path,{sha256:hash(raw),bytes:Buffer.byteLength(raw),identity:recoveryFileIdentity(fstatSync(fd,{bigint:true}))});
 }finally{closeSync(fd);}
 prepSyncDir(parent);prepRecoveryOwned(cap);assert.equal(bytes(cap.root,path).toString(),raw,'recovery evidence readback');
 return {path,sha256:hash(raw),bytes:Buffer.byteLength(raw)};
}
async function prepRecoveryAdmission(auth,operation){
 await auth.recheck();prepAdmission(auth.root,auth.base);
 const archive=auth.base+'/recoveries/'+auth.recoveryId;
 assert.ok(!existsSync(prepPath(auth.root,auth.base,archive)),'recovery archive already exists; explicit interrupted-owner assessment required');
 const cap={root:auth.root,base:auth.base,lock:auth.base+'/recovery.lock',journal:auth.base+'/recovery-journal.json',journalRaw:null,recoveryId:auth.recoveryId,artifacts:new Map()};
 const owner=randomUUID(),startedAt=new Date().toISOString();
 cap.raw=JSON.stringify({schemaVersion:1,kind:'PREPARATION_RECOVERY_OWNER',owner,recoveryId:auth.recoveryId,runSlug:auth.context.identity.runSlug,attempt:auth.anchor.attempt,iteration:auth.context.iteration,providerSessionId:auth.context.providerSessionId,startedAt});
 // wx arbitrates concurrent entrants. Never remove a partial or foreign lock.
 cap.fd=openSync(prepPath(cap.root,cap.base,cap.lock),'wx');
 try{
  const created=fstatSync(cap.fd,{bigint:true});
  writeFileSync(cap.fd,cap.raw);fsyncSync(cap.fd);prepSyncDir(confined(cap.root,cap.base));
  const pathStat=statSync(prepPath(cap.root,cap.base,cap.lock),{bigint:true});
  assert.equal(pathStat.dev,created.dev,'recovery admission replaced during acquisition');assert.equal(pathStat.ino,created.ino,'recovery admission replaced during acquisition');
  cap.identity=recoveryFileIdentity(fstatSync(cap.fd,{bigint:true}));recoveryOwners.add(cap);prepRecoveryOwned(cap);
  await auth.recheck(cap);
  const common={owner,recoveryId:auth.recoveryId,runSlug:auth.context.identity.runSlug,attempt:auth.anchor.attempt,iteration:auth.context.iteration,providerSessionId:auth.context.providerSessionId,designReportSha256:auth.authority.designReportSha256,inputsDigest:auth.authority.currentInputs.digest,startDescriptor:auth.running.startDescriptor,originalFence:prepRef(auth.root,auth.base+'/writer.lock'),originalJournal:prepRef(auth.root,auth.base+'/journal.json'),admissionIdentity:cap.identity,historicalOutcome:'UNKNOWN',recoveryPerformed:false};
  prepRecoveryPublish(cap,{...common,phase:'AUTHENTICATED',observedAt:new Date().toISOString()});
  const parent=prepPath(cap.root,cap.base,cap.base+'/recoveries');
  if(!existsSync(parent)){mkdirSync(parent);prepSyncDir(confined(cap.root,cap.base));}
  prepRecoveryOwned(cap);mkdirSync(prepPath(cap.root,cap.base,archive));cap.archive=archive;prepSyncDir(parent);
  const authorization=prepRecoveryImmutable(cap,auth.base+'/recoveries/'+auth.recoveryId+'/authorization.json',{schemaVersion:1,kind:'PREPARATION_RECOVERY_AUTHORIZATION',...common,anchor:auth.anchor,authority:auth.authority});
  await auth.recheck(cap);
  prepRecoveryPublish(cap,{...common,phase:'FENCED',observedAt:new Date().toISOString(),authorization});
  await auth.recheck(cap);return await operation(cap);
 }finally{
  // No cleanup or completion is authorized here. An interrupted or unproven
  // operation retains this owner and its intent for explicit future assessment.
  closeSync(cap.fd);recoveryOwners.delete(cap);
 }
}
export async function recoverPreparationCapture(root){
 assert.equal(arguments.length,1,'recovery accepts no authority overrides');
 const auth=await prepRecoveryAuthority(root);
 return prepRecoveryAdmission(auth,async cap=>{
  const producerState=prepProducerState(auth);
  prepRecoveryOwned(cap);producerState.exclusiveRecoveryAdmissionHeld=true;
  producerState.reasons=producerState.reasons.filter(r=>r!=='EXCLUSIVE_RECOVERY_ADMISSION_NOT_HELD');
  await auth.recheck(cap);
  const observation=prepRecoveryImmutable(cap,auth.base+'/recoveries/'+auth.recoveryId+'/producer-observation.json',producerState);
  await auth.recheck(cap);
  const error=new Error('preparation recovery unproven: admission retained; complete producer proof and remaining durable transition required');
  error.code='PREPARATION_RECOVERY_UNPROVEN';
  error.recovery={schemaVersion:1,kind:'PREPARATION_RECOVERY_PREFLIGHT',runSlug:auth.context.identity.runSlug,attempt:auth.anchor.attempt,recoveryId:auth.recoveryId,inputsDigest:auth.authority.currentInputs.digest,authorityAuthenticated:true,originalTailAuthenticated:true,quiescenceProven:false,completeProducerCoverage:false,recoveryPerformed:false,historicalOutcome:'UNKNOWN',productVerified:false,admissionRetained:true,phase:'FENCED',observation,producerState,missing:['COMPLETE_PRODUCER_PROOF','REMAINING_DURABLE_RECOVERY_PROTOCOL','CR1_CR12_ACCEPTANCE']};
  throw error;
 });
}
async function prepAuthority(root,builderIndex){
 const context=await currentContext(root),base=prepBase(context);
 prepAdmission(root,base);
 assert.ok(!existsSync(confined(root,base+'/writer.lock')),'preparation writer fenced');
 const ar=completed(context,context.records.findLastIndex(r=>r.type==='step_start'&&r.step==='review-architecture'),'enterprise-architecture-reviewer');
 const ad=block(ar.phases[1].content,'enterprise-continuation-preparation-attestation').inputsDigest;
 const versioned=base+'/reviewed-inputs.'+ad+'.json',manifest=existsSync(confined(root,versioned))?versioned:base+'/reviewed-inputs.json';
 const authority=await successorAuthority(root,manifest,builderIndex);
 assert.deepEqual(await currentContext(root),context,'preparation authority changed');
 const plan=prepRead(root,'work/enterprise/plan.json');assert.equal(plan.preparationReview.enabledRunSlug,context.identity.runSlug,'preparation enabled run');
 assert.equal(plan.preparationReview.namespace,base+'/','preparation plan namespace');
 const definitions=prepDefinitions(plan);
 if(definitions.scope.profileId==='P0-source-provenance-v3')throw new Error('PREPARATION_PRODUCER_BACKEND_UNAUTHENTICATED: platform='+process.platform+'; mandatoryAssertions='+definitions.required.length+'; nativeProbePerformed=false; required=AUTHENTICATED_NATIVE_BACKEND,PROTECTED_SUPERVISOR,NATIVE_LAUNCH_PROTOCOL; no workload or admission created');
 const source=authority.references.map(r=>({...r,mtimeMs:statSync(confined(root,r.path)).mtimeMs}));
 const sourceAuth={root,base,definitions,context,plan},sourceObserved=sourceProvenanceRead(sourceAuth);
 const checkSource=()=>{assert.deepEqual(sourceProvenanceRead(sourceAuth),sourceObserved,'source concurrent dependency');};
 const stable=async()=>{prepAdmission(root,base);checkSource();prepHistory({root,base,definitions,context});assert.deepEqual(inputs(root),authority.currentInputs,'preparation inputs changed');for(const r of source){assert.equal(hash(bytes(root,r.path)),r.sha256,'preparation source changed');assert.equal(statSync(confined(root,r.path)).mtimeMs,r.mtimeMs,'preparation source mtime changed');}assert.deepEqual(await currentContext(root),context,'preparation authority changed');assert.deepEqual(await successorAuthority(root,manifest,builderIndex),authority,'preparation authority changed');assert.deepEqual(inputs(root),authority.currentInputs,'preparation inputs changed');prepHistory({root,base,definitions,context});checkSource();prepAdmission(root,base);};
 const auth={root,base,context,authority,plan,definitions,stable,sourceObserved};assert.ok(!existsSync(confined(root,base+'/writer.lock')),'preparation writer fenced');prepHistory(auth);await stable();return auth;
}
async function prepLock(auth,operation){
 await auth.stable();const cap={...auth,lock:auth.base+'/writer.lock',journal:auth.base+'/journal.json'};let fd;
 // Authentication completes before even a directory is created.
 prepAdmission(auth.root,auth.base);mkdirSync(confined(auth.root,auth.base),{recursive:true});
 try{
  fd=openSync(prepPath(cap.root,cap.base,cap.lock),'wx');cap.inode=fstatSync(fd);cap.lockRaw=JSON.stringify({owner:randomUUID(),runSlug:auth.context.identity.runSlug,iteration:auth.context.iteration,session:auth.context.providerSessionId});writeFileSync(fd,cap.lockRaw);fsyncSync(fd);prepSyncDir(confined(cap.root,cap.base));
  cap.journalRaw=prepRaw(cap.root,cap.journal);prepJournal(cap.journalRaw);await auth.stable();const result=await operation(cap);await auth.stable();prepOwned(cap);
  unlinkSync(prepPath(cap.root,cap.base,cap.lock));
  try{prepSyncDir(confined(cap.root,cap.base));cap.unlocked=true;}catch(error){cap.retain=true;const fence=openSync(prepPath(cap.root,cap.base,cap.lock),'wx');try{writeFileSync(fence,cap.lockRaw);fsyncSync(fence);}finally{closeSync(fence);}throw error;}
  return result;
 }catch(e){if(cap.failureRecorded&&!cap.retain){prepOwned(cap);unlinkSync(prepPath(cap.root,cap.base,cap.lock));prepSyncDir(confined(cap.root,cap.base));cap.unlocked=true;}else cap.retain=true;throw e;}finally{
  // On failure retain the fence. A later explicit recovery design, not a reader,
  // may resolve it. Never inspect/remove a next writer's lock after unlock.
  if(fd!==undefined)closeSync(fd);
 }
}
function prepCandidate(auth,request,receipt,increment,builderIteration=auth.context.iteration,builderSessionId=auth.context.providerSessionId){const bound=prepRead(auth.root,request.path);return {schemaVersion:3,historyBinding:bound.historyBinding,historyHead:bound.historyHead,acceptanceScope:auth.definitions.acceptanceScope,purpose:'PREPARATION_COMPONENT_REVIEW',runSlug:auth.context.identity.runSlug,workflowRef:auth.context.identity.workflowRef,bundleDigest:auth.context.identity.bundleDigest,iteration:builderIteration,providerSessionId:builderSessionId,increment,request,receipt,inputsDigest:auth.authority.currentInputs.digest,designReportSha256:auth.authority.designReportSha256,productVerified:false};}
function prepBound(root,base,ref){prepExact(ref,['path','sha256'],'reference');prepPath(root,base,ref.path);assert.match(ref.sha256,/^[a-f0-9]{64}$/);const raw=bytes(root,ref.path);assert.equal(hash(raw),ref.sha256,'preparation artifact changed');return raw;}
async function prepValidate(auth,{historical=false}={}){
 const {root,base}=auth,requestPath=base+'/request.json';prepAdmission(root,base);
 assert.ok(!existsSync(confined(root,base+'/writer.lock')),'preparation writer fenced');
 const requestRaw=bytes(root,requestPath),request=strictPreparationJSON(requestRaw),journalRaw=prepRaw(root,base+'/journal.json'),journal=prepJournal(journalRaw),latest=journal.events.at(-1);
 assert.ok(latest?.status==='PASSED','preparation latest failed or running');
 prepExact(request,['schemaVersion','kind','runSlug','workflowRef','bundleDigest','builderIteration','builderSessionId','increment','receipt','planSha256','inputsDigest','designReportSha256','sourceCheckpoint','acceptanceScope','historyBinding','historyHead'],'request');
 const r=strictPreparationJSON(prepBound(root,base,request.receipt));
 prepExact(r,['schemaVersion','kind','status','attempt','runSlug','workflowRef','bundleDigest','builderIteration','builderSessionId','increment','planSha256','inputsDigest','designReportSha256','productVerified','inputs','inputsAfter','definitions','execution','frozen','tap','outputs','stdout','stderr','acceptanceScope','historyBinding'],'receipt');
 assert.ok(Number.isSafeInteger(r.attempt)&&r.attempt>0,'preparation attempt identity');
 assert.equal(request.receipt.path,base+'/attempts/'+r.attempt+'/receipt.json','preparation receipt path');
 assert.equal(r.stdout.path,base+'/attempts/'+r.attempt+'/output/stdout.tap','preparation stdout path');assert.equal(r.stderr.path,base+'/attempts/'+r.attempt+'/output/stderr.log','preparation stderr path');
 for(const [key,value] of Object.entries({schemaVersion:3,kind:'PREPARATION_COMPONENT_REQUEST',runSlug:auth.context.identity.runSlug,workflowRef:auth.context.identity.workflowRef,bundleDigest:auth.context.identity.bundleDigest,planSha256:hash(bytes(root,'work/enterprise/plan.json')),inputsDigest:auth.authority.currentInputs.digest,designReportSha256:auth.authority.designReportSha256}))assert.equal(request[key],value,'preparation request '+key);
 assert.equal(request.increment,auth.plan.preparationReview.increment,'preparation increment');assert.ok(auth.plan.preparationEntry.increments.includes(request.increment));
 assert.deepEqual(request.sourceCheckpoint,auth.plan.preparationEntry.sourceCheckpoint);
 for(const obj of [request,r,latest])assert.deepEqual(obj.acceptanceScope,auth.definitions.acceptanceScope,'preparation acceptance scope');
 if(!historical){assert.equal(request.builderIteration,auth.context.iteration,'preparation stale build');assert.equal(request.builderSessionId,auth.context.providerSessionId,'preparation builder session');}
 const running=journal.events.find(e=>e.attempt===r.attempt&&e.status==='RUNNING');assert.ok(running,'preparation running event');assert.deepEqual(running.acceptanceScope,auth.definitions.acceptanceScope,'preparation running scope');
 for(const k of ['runSlug','workflowRef','bundleDigest','builderIteration','builderSessionId','increment','planSha256','inputsDigest','designReportSha256'])assert.equal(running[k],request[k],'preparation running '+k);
 const history=prepHistory(auth);assert.deepEqual(request.historyHead,history.head,'preparation history head');assert.deepEqual(request.historyBinding,r.historyBinding,'preparation history binding');
 assert.deepEqual(latest.receipt,request.receipt,'preparation latest receipt');assert.equal(latest.attempt,r.attempt,'preparation attempt');
 assert.equal(r.schemaVersion,3,'preparation receipt schemaVersion');assert.equal(r.kind,'PREPARATION_COMPONENT_EVIDENCE');assert.equal(r.productVerified,false);assert.equal(r.status,'PASSED');
 for(const k of ['runSlug','workflowRef','bundleDigest','builderIteration','builderSessionId','increment','planSha256','inputsDigest','designReportSha256'])assert.deepEqual(r[k],request[k],'preparation receipt '+k);
 assert.deepEqual(r.inputs,auth.authority.currentInputs,'preparation receipt inputs');assert.deepEqual(r.definitions,auth.definitions,'preparation suite definition changed');
 assert.equal(r.execution.exitCode,0,'preparation subprocess failed');assert.equal(r.execution.signal,null,'preparation subprocess signal');assert.equal(r.execution.error,null,'preparation subprocess error');assert.equal(r.execution.cwd,root);assert.deepEqual(r.execution.argv,auth.definitions.argv);
 assert.ok(Number.isFinite(Date.parse(r.execution.startedAt))&&Date.parse(r.execution.finishedAt)>=Date.parse(r.execution.startedAt),'preparation execution dates');
 assert.deepEqual(r.execution.runtime,r.inputs.runtime);assert.equal(r.inputsAfter,r.inputsDigest);
 assert.equal(bytes(root,base+'/attempts/'+r.attempt+'/scope.json').toString(),JSON.stringify(auth.definitions.scope,null,2)+'\n','preparation raw scope');
 const frozenPaths=[base+'/attempts/'+r.attempt+'/scope.json',base+'/attempts/'+r.attempt+'/inputs.json',base+'/attempts/'+r.attempt+'/definitions.json',base+'/attempts/'+r.attempt+'/execution.json',base+'/attempts/'+r.attempt+'/frozen'];
 // Historical receipts lack this inventory row; prepHistory still authenticates
 // their post-input bytes against the immutable start descriptor.
 const postInputs=base+'/attempts/'+r.attempt+'/inputs-after.json';
 if(r.frozen.entries.some(ref=>ref.path===postInputs))frozenPaths.push(postInputs);
 assert.deepEqual(snapshot(root,frozenPaths),r.frozen,'preparation frozen evidence changed');assert.deepEqual(prepRead(root,frozenPaths[1]),r.inputs);assert.deepEqual(prepRead(root,frozenPaths[2]),r.definitions);assert.deepEqual(prepRead(root,frozenPaths[3]),r.execution);
 assert.deepEqual(snapshot(root,[base+'/attempts/'+r.attempt+'/output']),r.outputs,'preparation outputs changed');
 assert.deepEqual(parseTap(prepBound(root,base,r.stdout).toString(),auth.definitions.required),r.tap,'preparation TAP');prepBound(root,base,r.stderr);
 const capture={requestRaw:requestRaw.toString(),journalRaw,outputs:r.outputs};
 await auth.stable();
 assert.equal(prepRaw(root,requestPath),capture.requestRaw,'preparation request changed');assert.equal(prepRaw(root,base+'/journal.json'),capture.journalRaw,'preparation journal changed');assert.deepEqual(snapshot(root,[base+'/attempts/'+r.attempt+'/output']),capture.outputs,'preparation outputs changed');assert.deepEqual(snapshot(root,frozenPaths),r.frozen,'preparation frozen evidence changed');assert.equal(hash(prepBound(root,base,request.receipt)),request.receipt.sha256);assert.ok(!existsSync(confined(root,base+'/writer.lock')),'preparation writer fenced');
 prepHistory(auth);return {request,receipt:r,requestRef:{path:requestPath,sha256:hash(requestRaw)},receiptRef:request.receipt};
}
export async function inspectSourceProvenance(root){
 assert.equal(arguments.length,1,'source authority overrides forbidden');
 const context=await currentContext(root),base=prepBase(context),plan=prepRead(root,'work/enterprise/plan.json'),definitions=prepDefinitions(plan);assert.equal(definitions.scope.profileId,'P0-source-provenance-v1');
 const ar=completed(context,context.records.findLastIndex(r=>r.type==='step_start'&&r.step==='review-architecture'),'enterprise-architecture-reviewer');const digest=block(ar.phases[1].content,'enterprise-continuation-preparation-attestation').inputsDigest;const manifest=base+'/reviewed-inputs.'+digest+'.json';
 const authority=await successorAuthority(root,manifest),auth={root,base,context,plan,definitions,authority};const before=sourceProvenanceRead(auth);
 assert.deepEqual(await currentContext(root),context,'source P authority changed');assert.deepEqual(await successorAuthority(root,manifest),authority,'source P approval changed');assert.deepEqual(sourceProvenanceRead(auth),before,'source dependencies changed');
 return before.assessment;
}
export async function inspectPreparationComponent(root){
 assert.equal(arguments.length,1,'preparation overrides forbidden');const context=await currentContext(root),base=prepBase(context);
 prepAdmission(root,base);if(!existsSync(confined(root,base+'/request.json')))return null;
 const auth=await prepAuthority(root),v=await prepValidate(auth);
 return {kind:'PREPARATION_COMPONENT_READY',historyBinding:v.request.historyBinding,historyHead:v.request.historyHead,acceptanceScope:auth.definitions.acceptanceScope,increment:v.request.increment,request:v.requestRef,receipt:v.receiptRef,inputsDigest:v.receipt.inputsDigest,productVerified:false};
}
function prepProducerObservation(cap,name,value){
 return prepImmutable(cap,cap.producerObservationDirectory+'/'+name+'.json',{
  schemaVersion:1,observedAt:new Date().toISOString(),...value,
  completeProducerCoverage:false,quiescenceProven:false,
 });
}
function prepNativeProcessObservation(pid){
 // Preserve native output, including failed inspection. A single process sample
 // cannot establish a stable start identity or complete escaped-descendant set.
 if(!Number.isSafeInteger(pid)||pid<=0)return {status:'UNAVAILABLE',reason:'NO_SPAWN_PID'};
 const argv=['-p',String(pid),'-o','pid=,ppid=,pgid=,lstart=,stat=,command='];
 const observedAt=new Date().toISOString(),r=spawnSync('/bin/ps',argv,{encoding:'utf8',timeout:5000,maxBuffer:1024*1024});
 return {command:'/bin/ps',argv,observedAt,exitCode:r.status,signal:r.signal,
  error:r.error?{code:r.error.code??null,message:r.error.message}:null,
  stdout:r.stdout??'',stderr:r.stderr??'',identityAuthenticated:false};
}
async function prepStopProducers(cap,pid){
 // Stop the dedicated group managed by capture. This check alone does not
 // prove coverage of escaped descendants or authorize capture recovery.
 const alive=()=>{try{process.kill(-pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
 try{
  if(!pid||!alive())return {remaining:false,stopped:true};
  process.kill(-pid,'SIGTERM');
  for(let n=0;n<40&&alive();n++)await new Promise(r=>setTimeout(r,25));
  if(alive())process.kill(-pid,'SIGKILL');
  for(let n=0;n<160&&alive();n++)await new Promise(r=>setTimeout(r,25));
  assert.ok(!alive(),'preparation managed producers still active');return {remaining:true,stopped:true};
 }catch(error){
  cap.retain=true;
  if(cap.producerObservationDirectory){
   try{prepProducerObservation(cap,'stop-error-'+(cap.producerStopErrors=(cap.producerStopErrors??0)+1),{kind:'PREPARATION_PRODUCER_STOP_ERROR',pid,code:error.code??null,message:error.message});}
   catch(recordError){throw new AggregateError([error,recordError],error.message+'; producer observation recording: '+recordError.message);}
  }
  throw error;
 }
}
export async function capturePreparationComponent(root,increment){
 assert.equal(arguments.length,2,'preparation overrides forbidden');const auth=await prepAuthority(root);
 assert.equal(increment,auth.plan.preparationReview.increment,'preparation increment');
 const prior=prepRaw(root,auth.base+'/request.json');
 if(prior!==null&&strictPreparationJSON(prior).builderIteration===auth.context.iteration){const v=await prepValidate(auth);return prepCandidate(auth,v.requestRef,v.receiptRef,increment);}
 return prepLock(auth,async cap=>{
  const history=prepHistory(auth,cap),journal=prepJournal(cap.journalRaw);assert.ok(!journal.events.length||journal.events.at(-1).status!=='RUNNING','preparation incomplete attempt');
  const attempt=journal.events.filter(e=>e.status==='RUNNING').length+1,dir=cap.base+'/attempts/'+attempt,output=dir+'/output',startedAt=new Date().toISOString();
  assert.ok(attempt>=Math.max(auth.definitions.failureHistory.nextAttemptMinimum,auth.definitions.scope.sourceProvenanceDefinition?.nextAttemptMinimum??1),'history next attempt');
  const identity={acceptanceScope:auth.definitions.acceptanceScope,runSlug:auth.context.identity.runSlug,workflowRef:auth.context.identity.workflowRef,bundleDigest:auth.context.identity.bundleDigest,builderIteration:auth.context.iteration,builderSessionId:auth.context.providerSessionId,increment,planSha256:hash(bytes(root,'work/enterprise/plan.json')),inputsDigest:auth.authority.currentInputs.digest,designReportSha256:auth.authority.designReportSha256};
  let execution,startRef,running,stage='RESERVATION',observed,producerPid,producersStopped=false;const previousRequest=prepRaw(root,cap.base+'/request.json');
  try{
   prepImmutable(cap,dir+'/scope.json',auth.definitions.scope);prepImmutable(cap,dir+'/inputs.json',auth.authority.currentInputs);prepImmutable(cap,dir+'/definitions.json',auth.definitions);
   // Freeze every pre-execution input, not pointers into the changing checkout.
   for(const e of auth.authority.currentInputs.entries){const raw=bytes(root,e.path);assert.equal(hash(raw),e.sha256,'history input freeze');prepImmutable(cap,dir+'/frozen/'+e.path,raw);}
   for(const ref of Object.values(auth.plan.preparationEntry.sourceCheckpoint)){const raw=bytes(root,ref.path);assert.equal(hash(raw),ref.sha256,'history source freeze');prepImmutable(cap,dir+'/frozen-authority/'+ref.path,raw);}
   const arch=completed(auth.context,auth.context.records.findLastIndex(r=>r.type==='step_start'&&r.step==='review-architecture'),'enterprise-architecture-reviewer'),report=arch.phases[1].content;const reportRaw=hash(report)===identity.designReportSha256?report:report+'\n';assert.equal(hash(reportRaw),identity.designReportSha256,'history design freeze');prepImmutable(cap,dir+'/frozen-authority/design-report.md',reportRaw);
   startRef=prepImmutable(cap,dir+'/start.json',{schemaVersion:1,attempt,sequence:attempt,startedAt,identity,runtime:auth.authority.currentInputs.runtime,priorClosure:history.closure,checkpointSha256:history.checkpointSha256,references:snapshot(root,[dir+'/scope.json',dir+'/inputs.json',dir+'/definitions.json',dir+'/frozen',dir+'/frozen-authority']).entries,argv:auth.definitions.argv,sourceCheckpoint:auth.plan.preparationEntry.sourceCheckpoint,designReport:historyReference(root,dir+'/frozen-authority/design-report.md')});startRef=historyReference(root,startRef.path);
   prepAppend(cap,{attempt,status:'RUNNING',startedAt,...identity,startDescriptor:startRef,priorClosure:history.closure});running=prepJournal(cap.journalRaw).events.at(-1);stage='PRE_SPAWN';await auth.stable();
   mkdirSync(prepPath(root,cap.base,output),{recursive:true});
   if(auth.sourceObserved){prepImmutable(cap,output+'/source-provenance/assessment.json',auth.sourceObserved.assessment);for(const ref of auth.sourceObserved.assessment.inventory){const raw=bytes(ref.space==='project'?root:auth.sourceObserved.assessment.sourceIdentity.runRoot,ref.path);assert.equal(hash(raw),ref.sha256,'source dependency changed before save');assert.equal(raw.length,ref.bytes);prepImmutable(cap,output+'/source-provenance/dependencies/'+ref.space+'/'+ref.path,raw);}sourceAssessmentArtifact(auth,dir);}
   const out=output+'/stdout.tap',err=output+'/stderr.log';
   const outfd=openSync(prepPath(root,cap.base,out),'wx');let errfd;
   try{
    errfd=openSync(prepPath(root,cap.base,err),'wx');stage='SUBPROCESS';
    cap.producerObservationDirectory=output+'/producer-observations';
    execution=await new Promise((resolve,reject)=>{
     const env={...process.env,ENTERPRISE_SUITE_OUTPUT:prepPath(root,cap.base,output+'/artifacts')};delete env.NODE_TEST_CONTEXT;
     const child=spawn(auth.definitions.argv[0],auth.definitions.argv.slice(1),{cwd:root,env,stdio:['ignore',outfd,errfd],detached:true});producerPid=child.pid;
     let error=null,observationError,observationStop=Promise.resolve();
     child.once('spawn',()=>{
      try{prepProducerObservation(cap,'spawn',{kind:'PREPARATION_PRODUCER_SPAWN_OBSERVATION',pid:producerPid,parentPid:process.pid,argv:auth.definitions.argv,cwd:root,detached:true,native:prepNativeProcessObservation(producerPid)});}
      catch(e){
       observationError=e;cap.retain=true;
       observationStop=prepStopProducers(cap,producerPid).then(()=>{producersStopped=true;},stopError=>{observationError=new AggregateError([observationError,stopError],observationError.message+'; producer shutdown: '+stopError.message);});
      }
     });
     child.once('error',e=>{error=e.message;});
     child.once('close',async (exitCode,signal)=>{
      const result={argv:auth.definitions.argv,cwd:root,runtime:auth.authority.currentInputs.runtime,startedAt,finishedAt:new Date().toISOString(),exitCode,signal,error};
      try{prepProducerObservation(cap,'exit',{kind:'PREPARATION_PRODUCER_EXIT_OBSERVATION',pid:producerPid??null,...result});}
      catch(e){observationError=observationError?new AggregateError([observationError,e],'producer observations failed'):e;cap.retain=true;}
      await observationStop;
      if(observationError)reject(observationError);else resolve(result);
     });
    });
    execution.producers=await prepStopProducers(cap,producerPid);producersStopped=true;
    try{fsyncSync(outfd);fsyncSync(errfd);}catch(error){cap.retain=true;throw error;}
   }finally{closeSync(outfd);if(errfd!==undefined)closeSync(errfd);}
   prepImmutable(cap,dir+'/execution.json',execution);stage='POST_EXECUTION';observed=inputs(root);prepImmutable(cap,dir+'/inputs-after.json',observed);await auth.stable();prepOwned(cap);
   stage='RESULT';assert.equal(execution.exitCode,0,'preparation subprocess failed');assert.equal(execution.signal,null);assert.equal(execution.error,null);
   const tap=parseTap(bytes(root,out).toString(),auth.definitions.required),outputs=snapshot(root,[output]);
   const historyBinding={checkpointSha256:history.checkpointSha256,priorClosure:history.closure,startDescriptorSha256:startRef.sha256};
   const receipt={schemaVersion:3,kind:'PREPARATION_COMPONENT_EVIDENCE',status:'PASSED',attempt,...identity,historyBinding,productVerified:false,inputs:auth.authority.currentInputs,inputsAfter:observed.digest,definitions:auth.definitions,execution,frozen:snapshot(root,[dir+'/scope.json',dir+'/inputs.json',dir+'/definitions.json',dir+'/execution.json',dir+'/frozen',dir+'/inputs-after.json']),tap,outputs,stdout:prepRef(root,out),stderr:prepRef(root,err)};
   prepPassedInputs(root,dir,prepRead(root,startRef.path),receipt);
   stage='PUBLICATION';await auth.stable();const ref=prepImmutable(cap,dir+'/receipt.json',receipt);await auth.stable();const closure=terminalClosure(history.closure,attempt,startRef.sha256,'PASSED',ref.sha256);prepAppend(cap,{attempt,status:'PASSED',receipt:ref,terminalClosure:closure});
   const request={schemaVersion:3,kind:'PREPARATION_COMPONENT_REQUEST',...identity,historyBinding,historyHead:{attempt,terminalClosure:closure},receipt:ref,sourceCheckpoint:auth.plan.preparationEntry.sourceCheckpoint};
   await auth.stable();const requestRef=prepAtomic(cap,cap.base+'/request.json',request,previousRequest);await auth.stable();assert.deepEqual(snapshot(root,[output]),outputs,'preparation output publication changed');
   return prepCandidate(auth,requestRef,ref,increment);
  }catch(error){
   // No terminal can invent a start that was not durably published. Likewise a
   // failed evidence write cannot be hidden by a later successful failure record.
   if(!running){cap.retain=true;throw error;}
   try{
    if(producerPid&&!producersStopped)await prepStopProducers(cap,producerPid);prepOwned(cap);assert.equal(prepRaw(root,cap.journal),cap.journalRaw,'preparation CAS');
    const finishedAt=new Date().toISOString();prepImmutable(cap,dir+'/diagnostic.txt',error.message);
    const inventory=snapshot(root,[dir]).entries,executionPath=dir+'/execution.json',observedPath=dir+'/inputs-after.json';
    const paths=[executionPath,observedPath,output+'/stdout.tap',output+'/stderr.log',dir+'/receipt.json'];
    const previous=prepJournal(cap.journalRaw).events.at(-1),priorClosure=previous.status==='PASSED'?previous.terminalClosure:history.closure;
    const manifest={schemaVersion:1,attempt,sequence:attempt,startDescriptor:startRef,running,priorClosure,stage,code:error.code??error.name,diagnostic:historyReference(root,dir+'/diagnostic.txt'),finishedAt,inventory,existence:paths.map(path=>({path,state:existsSync(confined(root,path))?'PRODUCED':'NOT_PRODUCED'})),execution:existsSync(confined(root,executionPath))?historyReference(root,executionPath):null,inputsAfter:existsSync(confined(root,observedPath))?historyReference(root,observedPath):null};
    const failure=prepImmutable(cap,dir+'/failure.json',manifest),ref=historyReference(root,failure.path);prepAppend(cap,{attempt,status:'FAILED',error:error.message,finishedAt,failureManifest:ref,terminalClosure:terminalClosure(priorClosure,attempt,startRef.sha256,'FAILED',null,ref.sha256)});prepHistory(auth);cap.failureRecorded=true;
   }catch(recordError){cap.retain=true;throw new AggregateError([error,recordError],error.message+'; preparation failure recording: '+recordError.message);}throw error;
  }
 });
}
function prepBlock(raw,name){assert.deepEqual([...raw.matchAll(/^```(enterprise-[^\s]+)\r?$/gm)].map(m=>m[1]),[name],'mixed preparation attestation blocks');const matches=[...raw.matchAll(new RegExp('^```'+name+'\\r?\\n([\\s\\S]*?)^```\\s*$','gm'))];assert.equal(matches.length,1,'single preparation '+name);return strictPreparationJSON(matches[0][1]);}
async function prepReviewEvidence(root){
 const context=await currentContext(root),base=prepBase(context);prepAdmission(root,base);const request=prepRead(root,base+'/request.json');
 const candidates=context.records.map((r,i)=>({r,i})).filter(({r})=>r.type==='step_start'&&r.step==='build-foundation'&&r.iteration===request.builderIteration);
 assert.equal(candidates.length,1,'preparation builder occurrence');const b=completed(context,candidates[0].i,'enterprise-builder',false);
 const auth=await prepAuthority(root,b.index),v=await prepValidate(auth,{historical:true});
 assert.equal(b.session,request.builderSessionId,'preparation historical builder session');
 const expected=prepCandidate(auth,v.requestRef,v.receiptRef,request.increment,request.builderIteration,b.session);
 for(const p of b.phases)assert.deepEqual(prepBlock(p.content,'enterprise-preparation-candidate'),expected,'preparation builder candidate');
 assert.ok(Date.parse(v.receipt.execution.finishedAt)<=Date.parse(b.phases[0].timestamp),'preparation receipt before builder report');
 return {...auth,...v,builder:b};
}
export async function inspectPreparationCandidate(root){
 assert.equal(arguments.length,1,'preparation overrides forbidden');const auth=await prepReviewEvidence(root);
 assert.equal(auth.context.step,'review-foundation','preparation reviewer step');assert.equal(auth.context.sessionKey,'enterprise-batch-reviewer');assert.equal(auth.context.start.provider,'codex');validateReadonlyDefinition(auth.context.stepDefinition,'preparation candidate reviewer');assert.equal(auth.context.start.model,'gpt-6-astra');assert.equal(auth.context.start.providerOptions?.codex?.reasoningEffort,'high');assert.ok(!auth.context.builderSessions.includes(auth.context.providerSessionId),'preparation independent candidate reviewer');
 await auth.stable();return {kind:'PREPARATION_COMPONENT_FOR_REVIEW',candidate:prepCandidate(auth,auth.requestRef,auth.receiptRef,auth.request.increment,auth.request.builderIteration,auth.builder.session),receipt:auth.receipt,productVerified:false};
}
export async function inspectPreparationReview(root){
 assert.equal(arguments.length,1,'preparation overrides forbidden');
 const auth=await prepReviewEvidence(root),context=auth.context;
 const index=context.records.findLastIndex(r=>r.type==='step_start'&&r.step==='review-foundation');
 assert.ok(index>=auth.builder.end,'preparation review must follow builder');
 const review=completed(context,index,'enterprise-batch-reviewer');
 assert.equal(context.records.filter(r=>r.type==='step_start'&&r.step==='review-foundation'&&r.iteration===review.start.iteration).length,1,'preparation duplicate review occurrence');
 for(let i=auth.builder.end;i<index;i++){const r=context.records[i];if(r.type==='step_start'&&r.step==='review-foundation'){const phases=context.records.slice(i+1,index).filter(x=>x.type==='phase_complete'&&x.step===r.step&&x.iteration===r.iteration);assert.ok(review.phases.every(p=>p.content.includes('supersedes review-foundation:'+r.iteration+':'+hash(JSON.stringify(phases)))),'preparation explicit review supersession required');}}
 assert.notEqual(review.session,auth.builder.session,'preparation independent implementation review');
 const a=prepBlock(review.phases[1].content,'enterprise-batch-attestation');assert.deepEqual(prepBlock(review.phases[0].content,'enterprise-batch-attestation'),a,'preparation review phase mismatch');
 prepExact(a,['schemaVersion','purpose','permission','verdict','runSlug','workflowRef','bundleDigest','step','iteration','sessionKey','providerSessionId','increment','builderIteration','builderSessionId','request','receipt','inputsDigest','outputsDigest','planSha256','designReportSha256','reviewedCaseIds','acceptedComponents','approvedIssueIds','currentApprovals','actualHistoryCompleteness','migrationAuthorization','productVerified','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority','unresolvedFindings','residualBlockers','acceptanceScope','historyBinding','historyHead'],'review');
 const expected={schemaVersion:4,historyBinding:auth.request.historyBinding,historyHead:auth.request.historyHead,acceptanceScope:auth.definitions.acceptanceScope,purpose:'PREPARATION_COMPONENT_REVIEW',permission:'IMPLEMENTATION_CONTRACT_TESTS_ONLY',runSlug:context.identity.runSlug,workflowRef:context.identity.workflowRef,bundleDigest:context.identity.bundleDigest,step:'review-foundation',iteration:review.start.iteration,sessionKey:'enterprise-batch-reviewer',providerSessionId:review.session,increment:auth.request.increment,builderIteration:auth.request.builderIteration,builderSessionId:auth.builder.session,request:auth.requestRef,receipt:auth.receiptRef,inputsDigest:auth.receipt.inputsDigest,outputsDigest:auth.receipt.outputs.digest,planSha256:auth.receipt.planSha256,designReportSha256:auth.receipt.designReportSha256,approvedIssueIds:[],currentApprovals:[],actualHistoryCompleteness:'UNPROVEN',migrationAuthorization:'NONE',productVerified:false,initializationAuthority:false,targetLaunchAuthority:false,runtimeReplacementAuthority:false};
 for(const [k,v] of Object.entries(expected))assert.deepEqual(a[k],v,'preparation review '+k);
 assert.ok(['APPROVE','REQUEST_CHANGES'].includes(a.verdict),'preparation verdict');
 const caseIds=auth.definitions.scope.reviewedCaseIds;
 assert.deepEqual(a.reviewedCaseIds,caseIds,'preparation reviewed cases');
 assert.deepEqual(a.acceptedComponents,a.verdict==='APPROVE'?auth.definitions.scope.acceptedComponents:[],'preparation component scope');assert.ok(Array.isArray(a.unresolvedFindings));if(a.verdict==='APPROVE')assert.deepEqual(a.unresolvedFindings,[]);else assert.ok(a.unresolvedFindings.length>0,'preparation rejection findings');
 assert.ok(Array.isArray(a.residualBlockers)&&a.residualBlockers.length>0&&a.residualBlockers.every(s=>typeof s==='string'&&s.length>0),'preparation residual blockers');
 for(const r of auth.definitions.scope.retainedObligations)assert.ok(a.residualBlockers.some(s=>s.includes(r.owner)&&s.includes(r.assertion)&&s.includes('REQUIRED_NOT_ACCEPTED')),'preparation retained review disclosure');
 assert.ok(Date.parse(review.start.timestamp)>=Date.parse(auth.receipt.execution.finishedAt),'preparation review chronology');
 assert.equal(review.definition.outputContracts?.length,1,'preparation review report contract');
 const canonical=confined(context.identity.runRoot,relative(context.identity.runRoot,context.identity.reportDirectory)+'/'+review.definition.outputContracts[0].name),raw=readFileSync(canonical);
 assert.ok(raw.toString()===review.phases[1].content||raw.toString()===review.phases[1].content+'\n','preparation canonical review mismatch');
 await auth.stable();assert.deepEqual(readFileSync(canonical),raw,'preparation canonical review changed');await prepValidate(auth,{historical:true});
 return {kind:'PREPARATION_COMPONENT_REVIEW',attestation:a,reportSha256:hash(raw),canonicalReport:canonical,productVerified:false};
}
export async function importPreparationReview(root,report){
 assert.equal(arguments.length,2,'preparation overrides forbidden');const auth=await prepAuthority(root),review=await inspectPreparationReview(root);
 assert.equal(review.attestation.verdict,'APPROVE','preparation review rejected');
 assert.equal(resolve(report),review.canonicalReport,'preparation import canonical report only');
 const raw=readFileSync(review.canonicalReport,'utf8');assert.equal(hash(raw),review.reportSha256);
 const boundPaths=[auth.base+'/request.json',auth.base+'/journal.json',auth.base+'/attempts'];const bound=snapshot(root,boundPaths);
 const unchanged=()=>assert.deepEqual(snapshot(root,boundPaths),bound,'preparation import evidence changed');
 const path=auth.base+'/acceptances.json',before=prepRaw(root,path),ledger=before===null?{schemaVersion:1,acceptances:[]}:strictPreparationJSON(before);
 prepExact(ledger,['schemaVersion','acceptances'],'acceptances');assert.equal(ledger.schemaVersion,1);assert.ok(Array.isArray(ledger.acceptances));
 for(const a of ledger.acceptances){assert.ok([2,3].includes(a.schemaVersion),'preparation historical acceptance schema');prepExact(a,['schemaVersion','kind','reportSha256','report','attestation','productVerified','acceptanceScope',...(a.schemaVersion===3?['historyBinding','historyHead']:[])],'acceptance');assert.equal(a.attestation.schemaVersion,a.schemaVersion+1);if(a.schemaVersion===3){assert.deepEqual(a.historyBinding,a.attestation.historyBinding);assert.deepEqual(a.historyHead,a.attestation.historyHead);}assert.deepEqual(a.acceptanceScope,a.attestation.acceptanceScope,'preparation acceptance scope');assert.equal(a.kind,'PREPARATION_COMPONENT_ACCEPTANCE');assert.equal(a.productVerified,false);assert.equal(a.report,auth.base+'/reviews/'+a.reportSha256+'.md');const raw=prepBound(root,auth.base,{path:a.report,sha256:a.reportSha256});assert.deepEqual(prepBlock(raw.toString(),'enterprise-batch-attestation'),a.attestation,'preparation stored acceptance');}
 const ids=ledger.acceptances.map(a=>a.reportSha256);assert.equal(new Set(ids).size,ids.length,'preparation duplicate acceptance');
 const acceptance={schemaVersion:3,historyBinding:review.attestation.historyBinding,historyHead:review.attestation.historyHead,acceptanceScope:review.attestation.acceptanceScope,kind:'PREPARATION_COMPONENT_ACCEPTANCE',reportSha256:review.reportSha256,report:auth.base+'/reviews/'+review.reportSha256+'.md',attestation:review.attestation,productVerified:false};
 if(ids.includes(review.reportSha256)){await auth.stable();unchanged();assert.equal(prepRaw(root,path),before,'preparation acceptance changed');assert.equal(hash(readFileSync(review.canonicalReport)),review.reportSha256);assert.deepEqual(ledger.acceptances[ids.indexOf(review.reportSha256)],acceptance,'preparation conflicting import');assert.equal(hash(bytes(root,acceptance.report)),review.reportSha256);return {...acceptance,idempotent:true};}
 return prepLock(auth,async cap=>{
  unchanged();assert.equal(prepRaw(root,path),before,'preparation acceptance CAS');assert.equal(hash(readFileSync(review.canonicalReport)),review.reportSha256,'preparation review changed');await auth.stable();unchanged();
  if(existsSync(confined(root,acceptance.report)))assert.equal(hash(bytes(root,acceptance.report)),review.reportSha256);else prepImmutable(cap,acceptance.report,raw);
  ledger.acceptances.push(acceptance);prepAtomic(cap,path,ledger,before);await auth.stable();unchanged();
  // This read deliberately verifies the review while our own import fence is
  // held using unchanged raw bound artifacts; readiness remains fenced outside.
  assert.equal(hash(readFileSync(review.canonicalReport)),review.reportSha256,'preparation report changed');
  return {...acceptance,idempotent:false};
 });
}

// Inspection results are JSON data. Serialize containers incrementally so the
// full reference history need not fit in a single V8 string. Keep every field,
// array entry and the existing two-space formatting; this grants no authority.
export async function writeRuntimeJson(value,destination){
 const ancestors=new Set();
 const prepare=(v,key)=>{
  if(v!==null&&(typeof v==='object'||typeof v==='bigint')&&typeof v.toJSON==='function')v=v.toJSON(key);
  if(v instanceof Number||v instanceof String||v instanceof Boolean)v=v.valueOf();
  return v;
 };
 const omitted=v=>v===undefined||typeof v==='function'||typeof v==='symbol';
 function* tokens(v,depth){
  if(v===null||typeof v!=='object'){const text=JSON.stringify(v);if(text===undefined)throw new TypeError('JSON result unavailable');yield text;return;}
  if(ancestors.has(v))throw new TypeError('Converting circular structure to JSON');
  ancestors.add(v);const indent='  '.repeat(depth),childIndent=indent+'  ';
  if(Array.isArray(v)){
   yield '[';
   for(let i=0;i<v.length;i++){yield i?',\n':'\n';yield childIndent;const child=prepare(v[i],String(i));yield* tokens(omitted(child)?null:child,depth+1);}
   if(v.length){yield '\n';yield indent;}yield ']';
  }else{
   yield '{';let first=true;
   for(const key of Object.keys(v)){const child=prepare(v[key],key);if(omitted(child))continue;yield first?'\n':',\n';first=false;yield childIndent;yield JSON.stringify(key);yield ': ';yield* tokens(child,depth+1);}
   if(!first){yield '\n';yield indent;}yield '}';
  }
  ancestors.delete(v);
 }
 function* chunks(){
  let buffer=Buffer.allocUnsafe(65536),used=0;
  function* parts(){yield* tokens(prepare(value,''),0);yield '\n';}
  for(const token of parts()){
   // Encode before slicing: a chunk boundary must not split a UTF-16 pair
   // into two independent encodings and corrupt a reference path.
   const bytes=Buffer.from(token);
   for(let offset=0;offset<bytes.length;){const length=Math.min(buffer.length-used,bytes.length-offset);bytes.copy(buffer,used,offset,offset+length);used+=length;offset+=length;if(used===buffer.length){yield buffer;buffer=Buffer.allocUnsafe(65536);used=0;}}
  }
  if(used)yield buffer.subarray(0,used);
 }
 // pipeline honours backpressure, waits for final flush and rejects write,
 // close and serialization failures. A partial output is never exit zero.
 await pipeline(Readable.from(chunks(),{objectMode:false}),destination);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{
  const args=process.argv.slice(2);let result;
  if(args.length===0)result=await inspectRuntimePreparation(process.cwd());
  else if(args.length===1&&args[0]==='--inspect-component-development')result=await inspectComponentDevelopment(process.cwd());
  else if(args.length===2&&args[0]==='--prepare-component-review')result=await prepareRComponentReview(process.cwd(),args[1]);
  else if(args.length===1&&args[0]==='--test-component-development')result=await testComponentDevelopment(process.cwd());
  else if(args.length===1&&args[0]==='--recover-preparation-capture')result=await recoverPreparationCapture(process.cwd());
  else if(args.length===2&&args[0]==='--capture-component')result=await capturePreparationComponent(process.cwd(),args[1]);
  else if(args.length===2&&args[0]==='--import-component-review')result=await importPreparationReview(process.cwd(),args[1]);
  else if(args.length===1&&args[0]==='--inspect-source-provenance')result=await inspectSourceProvenance(process.cwd());
  else if(args.length===1&&args[0]==='--inspect-component-candidate')result=await inspectPreparationCandidate(process.cwd());
  else if(args.length===1&&args[0]==='--inspect-component-review')result=await inspectPreparationReview(process.cwd());
  else if(args.length===2&&args[0]==='--successor-preparation')result=await inspectSuccessorPreparation(process.cwd(),args[1]);
  else if(args.length===1&&args[0]==='--input-history')result=await inspectRuntimeInputHistory(process.cwd());
  else if(args.length===2&&args[0]==='--design-history')result=await inspectRuntimeDesignHistory(process.cwd(),args[1]);
  else if(args.length===2&&args[0]==='--transitions')result=await inspectRuntimeTransitions(process.cwd(),args[1]);
  else if(args.length===1&&args[0]==='--reference-history')result=await requireRuntimeReferenceHistory(process.cwd());
  else if(args.length===1&&args[0]==='--inspect-references')result=await inspectRuntimeReferenceHistory(process.cwd());
  else if(args.length===2&&args[0]==='--runtime-bytes')result=await inspectRuntimeByteHistory(process.cwd(),args[1]);
  else if(args.length===2&&args[0]==='--runtime-distribution')result=await inspectRuntimeDistributionHistory(process.cwd(),args[1]);
  else if(args.length===2&&args[0]==='--input-distributions')result=await inspectRuntimeInputDistributions(process.cwd(),args[1]);
  else if(args.length===2&&args[0]==='--package-metadata')result=await inspectRuntimePackageMetadata(process.cwd(),args[1]);
  else if(args.length===2&&args[0]==='--bundled-constraints')result=await inspectRuntimeBundledConstraints(process.cwd(),args[1]);
  else if(args.length===3&&args[0]==='--design-bundled-constraints')result=await inspectRuntimeDesignBundledConstraints(process.cwd(),args[1],args[2]);
  else if(args.length===2&&args[0]==='--bundled-declarations')result=await inspectRuntimeBundledDeclarations(process.cwd(),args[1]);
  else if(args.length===3&&args[0]==='--design-bundled-declarations')result=await inspectRuntimeDesignBundledDeclarations(process.cwd(),args[1],args[2]);
  else if(args.length===2&&args[0]==='--dependency-declarations')result=await inspectRuntimeDependencyDeclarations(process.cwd(),args[1]);
  else if(args.length===2&&args[0]==='--dependency-constraints')result=await inspectRuntimeDependencyConstraints(process.cwd(),args[1]);
  else if(args.length===3&&args[0]==='--design-dependency-constraints')result=await inspectRuntimeDesignDependencyConstraints(process.cwd(),args[1],args[2]);
  else if(args.length===3&&args[0]==='--design-dependency-declarations')result=await inspectRuntimeDesignDependencyDeclarations(process.cwd(),args[1],args[2]);
  else if(args.length===3&&args[0]==='--design-distributions')result=await inspectRuntimeDesignDistributions(process.cwd(),args[1],args[2]);
  else throw Error('preparation accepts no authority overrides');
  await writeRuntimeJson(result,process.stdout);
 }catch(error){console.error(error.stack);if(error.recovery)console.error(JSON.stringify({code:error.code,recovery:error.recovery}));if(error.missing)console.error(JSON.stringify({missing:error.missing}));process.exitCode=1;}
}
