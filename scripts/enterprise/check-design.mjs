import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {parse} from 'yaml';
import {hash,validatePlan} from './evidence.mjs';

// Structural design checks only. Planned commands are never executed or marked passed here.
const root=resolve(import.meta.dirname,'../..');
const read=path=>JSON.parse(readFileSync(resolve(root,path),'utf8'));
const plan=read('work/enterprise/plan.json'), catalog=read('work/enterprise/backlog.json');
const currentCoverage=read(plan.coverage), old=read(plan.revisionHistory.previousPlan);
// Legacy R assertions below validate its frozen proposal, never current U authority.
const successor=plan.componentSuccessor;
const successorEntry=successor?read(successor.entrySnapshot):null;
const frozenEntry=path=>{const r=successorEntry.entries.find(e=>e.path===path);assert.ok(r,'missing frozen predecessor '+path);const raw=readFileSync(resolve(root,r.copy));assert.equal(hash(raw),r.sha256);assert.equal(raw.length,r.bytes);return JSON.parse(raw);};
const predecessorPlan=successor?frozenEntry('work/enterprise/plan.json'):null;
const coverage=successor?{...currentCoverage,executionContext:frozenEntry(plan.coverage).executionContext}:currentCoverage;
const checkedRuntime=successor?plan.predecessorRuntime:plan.runtime;
const legacyRuntime=plan.historicalRuntime;
validatePlan(root,plan,catalog);
assert.equal(plan.scopeRevision,catalog.scopeRevision);
assert.equal(coverage.scopeRevision,catalog.scopeRevision);
assert.equal(plan.revisionHistory.currentIndependentArchitectureApproval,null);
const byId=new Map(plan.issues.map(i=>[i.id,i]));
for(const issue of old.issues) {
  assert.deepEqual(byId.get(issue.id).originalAcceptance.slice(0,issue.originalAcceptance.length),issue.originalAcceptance,`original AC removed ${issue.id}`);
}
const leaves=plan.issues.filter(i=>!i.children.length);
const batches=new Map(plan.batches.map((b,n)=>[b.id,{...b,order:n}]));
assert.equal(batches.size,plan.batches.length,'duplicate batch');
const assigned=plan.batches.flatMap(b=>b.issueIds);
assert.equal(new Set(assigned).size,assigned.length,'duplicate leaf assignment');
assert.deepEqual([...assigned].sort(),leaves.map(i=>i.id).sort(),'missing leaf');
function descendants(id,seen=new Set()) {
  assert.ok(!seen.has(id),`dependency cycle ${id}`);
  const i=byId.get(id);assert.ok(i,`unknown dependency ${id}`);
  if(!i.children.length) return [id];
  return i.children.flatMap(child=>descendants(child,new Set([...seen,id])));
}
for(const batch of plan.batches) {
  assert.ok(batch.issueIds.length && batch.issueIds.length<=batch.maxLeafIssues,`unbounded batch ${batch.id}`);
  for(const id of batch.issueIds) {
    const issue=byId.get(id);assert.equal(issue.batchId,batch.id);
    const expected=[...new Set(issue.dependsOn.flatMap(id=>descendants(id)))].sort();
    assert.deepEqual([...issue.expandedLeafDependencies].sort(),expected,`dependency expansion ${id}`);
    for(const dependency of expected) {
      const prior=byId.get(dependency), priorBatch=batches.get(prior.batchId);
      assert.ok(priorBatch.order<batches.get(batch.id).order ||
        prior.batchId===batch.id && batch.issueIds.indexOf(dependency)<batch.issueIds.indexOf(id),`non-topological ${id} depends ${dependency}`);
    }
    assert.ok(issue.suites.length,`no planned suites ${id}`);
    for(const ac of issue.acceptanceTests) {
      assert.ok(ac.suiteIds.length,`unbound AC ${ac.id}`);
      for(const suiteId of ac.suiteIds) assert.ok(issue.suites.some(s=>s.id===suiteId),`missing AC suite ${ac.id}`);
    }
  }
}
const suites=leaves.flatMap(i=>i.suites);
assert.equal(new Set(suites.map(s=>s.id)).size,suites.length,'duplicate suite');
for(const suite of suites) {
  assert.ok(suite.command.length && suite.requiredAssertions.length,`empty command/assertions ${suite.id}`);
}
const business=catalog.items.filter(i=>i.kind==='use-case');
assert.deepEqual(coverage.businessUseCases.map(i=>i.issueId).sort(),business.map(i=>i.id).sort(),'business coverage');
for(const row of coverage.businessUseCases) {
  const issue=byId.get(row.issueId);
  assert.deepEqual(row.invariants,issue.originalAcceptance);
  assert.ok(row.lifecycle.length>1 && row.purpose && row.retention.policy);
  for(const field of ['legalEntity','jurisdiction','industry','classification','actors','externalEffects','screen','api','tests','exceptionsAndRecovery','unsupportedReason']) assert.ok(row[field],`missing ${field} ${row.issueId}`);
  assert.equal(row.batchId,issue.batchId);
  assert.equal(row.reviewEvidence.status,'PENDING');
  for(const field of ['report','receiptHash','inputsDigest']) assert.equal(row.reviewEvidence[field],null,'fabricated approval');
  assert.ok(issue.suites.some(s=>s.id===`${row.issueId}.browser`),`missing browser ${row.issueId}`);
  assert.equal(row.externalEffects.mode,'SYNTHETIC_ONLY');
}
assert.equal(coverage.crossDomain.length,5);
for(const chain of coverage.crossDomain) {
  assert.ok(chain.issueIds.length>=3);
  chain.issueIds.forEach(id=>assert.ok(byId.has(id)));
  assert.equal(chain.commands.length,2);
  for(const command of chain.commands) assert.ok(byId.get(chain.ownerIssue).suites.some(s=>JSON.stringify(s.command)===JSON.stringify(command)),`missing chain suite ${chain.id}`);
  assert.equal(chain.reviewEvidence,null);
}
assert.deepEqual(coverage.companyInventory.records,[],'do not invent company inventory');
for(const entry of plan.protectedFiles) assert.equal(hash(readFileSync(resolve(root,entry.path))),entry.sha256,`protected file ${entry.path}`);
assert.equal(plan.githubRepository,null);
assert.equal(legacyRuntime.nominalSteps+legacyRuntime.repairReserve,legacyRuntime.initialStepLimit);
assert.equal(legacyRuntime.currentStep+legacyRuntime.remainingNominalSteps,legacyRuntime.nominalSteps);
// AR2-01: validate planned sequencing and command wiring, not unimplemented runtime behavior.
const workflow=parse(readFileSync(resolve(root,'.takt/workflows/enterprise-lifecycle.yaml'),'utf8'));
const finalization=plan.finalization;
assert.equal(finalization.contract,'work/enterprise/FINALIZATION.md');
assert.ok(plan.sourceSnapshots.some(s=>s.path===finalization.contract),'unbound finalization contract');
assert.equal(finalization.implementationBatch,'B00');
assert.deepEqual(finalization.reportOrder,['release-seal','readonly-audit','TAKT-report-phase','readonly-post-report-gate','TAKT-COMPLETE']);
assert.deepEqual(finalization.finalWrites,[],'final gate must not write');
assert.equal(finalization.finalRerunsSuites,false,'final gate must not rerun suites');
assert.equal(finalization.finalApprovalRequiredBeforeSeal,false,'ENT-705 approval cycle');
assert.equal(finalization.sealHash,'SHA256_RAW_FILE_BYTES');
assert.equal(finalization.reportHash,'SHA256_RAW_FILE_BYTES');
assert.equal(finalization.requiredCurrentLeafCount,leaves.length);
assert.equal(finalization.requiredCurrentParentCount,plan.issues.length-leaves.length);
const commandBase=['mise','exec','--','node','scripts/enterprise/verify.mjs'];
for(const [field,suffix] of [['releaseCommand',['all','--seal']],['preflightCommand',['final','--check-seal']],['finalCommand',['final','--check-report']]]) {
  assert.deepEqual(finalization[field],[...commandBase,...suffix],`incorrect ${field}`);
}
for(const [stepName,field,batchId] of [['harden-release','releaseCommand','B22'],['final-audit','finalCommand','B23']]) {
  const step=workflow.steps.find(s=>s.name===stepName);
  assert.equal(step.quality_gates.length,1,`unexpected gates ${stepName}`);
  assert.equal(step.quality_gates[0].command,finalization[field].join(' '),`gate mismatch ${stepName}`);
  assert.deepEqual(batches.get(batchId).command,finalization[field],`batch command mismatch ${batchId}`);
}
const finalStep=workflow.steps.find(s=>s.name==='final-audit');
assert.equal(finalStep.capabilities,'readonly');assert.equal(finalStep.edit,false);
assert.equal(finalStep.session_key,'enterprise-final-auditor');
assert.ok(finalStep.instruction.includes('final --check-seal'));
assert.ok(finalStep.output_contracts.report.some(r=>r.name===finalization.reportName));
assert.deepEqual(finalization.legacyAllDispatch,{'harden-release':'all --seal','final-audit':'final --check-report','unknown':'REJECT_BEFORE_ANY_WRITE'});
assert.deepEqual(plan.commands.releaseSeal,finalization.releaseCommand);
assert.deepEqual(plan.commands.finalPreflight,finalization.preflightCommand);
assert.deepEqual(plan.commands.final,finalization.finalCommand);
const sealSuite=byId.get('ENT-705').suites.find(s=>s.id==='complete-machine-gate');
assert.deepEqual(sealSuite.command,finalization.releaseCommand);
const finalSuite=byId.get('ENT-101').suites.find(s=>s.id==='finalization-regressions');
assert.ok(finalSuite,'B00 finalization suite missing');
assert.equal(finalSuite.path,'tests/enterprise/finalization.test.mjs');
assert.deepEqual(finalSuite.command,['mise','exec','--','node','--test','--test-reporter=tap',finalSuite.path]);
for(const name of ['same-R-review-and-final-gate','changed-input-rejected','changed-receipt-rejected','changed-output-rejected',
  'R-approved-R-prime-latest-rejected','latest-failed-rejected','latest-running-rejected','missing-or-incomplete-report-rejected',
  'changed-review-report-rejected','same-provider-session-rejected','wrong-run-or-stale-iteration-rejected','self-asserted-session-rejected',
  'report-phase-before-command-gate','final-success-zero-filesystem-writes','final-failure-zero-filesystem-writes',
  'concurrent-change-rejected','ENT-705-no-preapproval-cycle','legacy-all-final-dispatch-readonly',
  'legacy-all-release-seals','unknown-context-fails-before-write','explicit-seal-during-final-rejected']) {
  assert.ok(finalSuite.requiredAssertions.includes(name),`missing B00 counterexample ${name}`);
}
for(const ac of byId.get('ENT-101').acceptanceTests) assert.ok(ac.suiteIds.includes(finalSuite.id),'unbound B00 finalization tests');
// A new run may reuse implementation, never historical approval authority.
const runtimeConfig=parse(readFileSync(resolve(root,'.takt/runtime.yaml'),'utf8'));
assert.equal(runtimeConfig.provider.targets.steps['build-foundation'].profile,'critical','current build profile');
assert.equal(runtimeConfig.provider.profiles.critical.model,'gpt-6-astra');
assert.equal(runtimeConfig.provider.profiles.critical.options.reasoning_effort,'high');
assert.equal(legacyRuntime.historicalSmokeRuntimeMatches,false,'historical smoke must not be promoted');
const continuation=plan.continuation;
assert.ok(continuation && continuation.runSlug!==continuation.priorRunSlug,'distinct run boundary required');
assert.equal(continuation.reentryBatch,'B00');
assert.equal(continuation.implementationBatch,'B00');
assert.equal(continuation.oldRunCentralStateMutable,false);
assert.equal(continuation.sameRunActiveBatchResetAllowed,false);
assert.deepEqual(continuation.currentIndependentApprovals,[],'historical approval promoted');
assert.equal(hash(readFileSync(resolve(root,continuation.historicalProgressSnapshot))),continuation.historicalProgressSha256);
assert.ok(plan.sourceSnapshots.some(s=>s.path===continuation.contract),'unbound continuation contract');
assert.equal(coverage.executionContext.runSlug,plan.componentContinuation.runSlug);
assert.equal(coverage.executionContext.sourceRunSlug,continuation.runSlug);
assert.equal(coverage.executionContext.activeBatchId,null);
assert.equal(coverage.executionContext.architectureReview,'PENDING_OCCURRENCE11_RETAINED_OWNER_DESIGN');
assert.deepEqual(continuation.currentRunRevalidationBatches,['B00','B01','B02','B03','B04','B05']);
assert.deepEqual(continuation.initializationCommand,[...commandBase,'batch','--initialize-run']);
assert.deepEqual(plan.commands.initializeRun,continuation.initializationCommand);
const continuationSuite=byId.get('ENT-101').suites.find(s=>s.id==='continuation-regressions');
assert.equal(continuationSuite.status,'PRESENT_REQUIRES_FRESH_RUN');
assert.equal(continuation.status,'INITIALIZED_ACTIVE_B04_FAILED_INTERVAL_BLOCKED');
for(const path of ['scripts/enterprise/continuation.mjs',continuationSuite.path]) assert.ok(readFileSync(resolve(root,path)).length>0,`missing existing continuation input ${path}`);
assert.equal(continuationSuite.path,'tests/enterprise/continuation.test.mjs');
assert.deepEqual(continuationSuite.command,['mise','exec','--','node','--test','--test-reporter=tap',continuationSuite.path]);
assert.deepEqual(continuationSuite.requiredAssertions,continuation.requiredAssertions);
assert.equal(continuationSuite.requiredAssertions.length,7);
for(const ac of byId.get('ENT-101').acceptanceTests) assert.ok(ac.suiteIds.includes(continuationSuite.id),'unbound continuation tests');
// Scope4 retains all previous expanded ACs, never promotes historical evidence.
const priorExpanded=read(plan.revisionHistory.previousExpandedPlan);
for(const issue of priorExpanded.issues) assert.deepEqual(byId.get(issue.id).originalAcceptance,issue.originalAcceptance,`expanded AC removed ${issue.id}`);
const revision=read('work/enterprise/scope-revision.json');
assert.equal(plan.scopeRevision,revision.revision);assert.equal(plan.issues.length,revision.issues);assert.equal(business.length,revision.businessUseCases);
for(const batch of plan.batches) for(const dep of batch.dependsOnBatches) assert.ok(batches.has(dep)&&batches.get(dep).order<batches.get(batch.id).order,`batch order ${batch.id} -> ${dep}`);
for(const [batchId,dependencies] of Object.entries(plan.additionalOrdering)) for(const dep of dependencies) assert.ok(batches.get(batchId).dependsOnBatches.includes(dep));
const scenario=read('work/enterprise/requested-scenarios/disclosure-lifecycle.json');
assert.deepEqual(coverage.requestedScenarios.map(x=>({id:x.id,requirement:x.requirement})),scenario.acceptance);
for(const row of coverage.requestedScenarios) {
 assert.equal(row.status,'PLANNED_NOT_VERIFIED');assert.equal(row.reviewEvidence,null);
 for(const sid of row.suiteIds) assert.ok(byId.get(row.ownerIssue).suites.find(s=>s.id===sid)?.requiredAssertions.includes(row.id));
}
assert.equal(plan.closureReview.status,'EXISTING_IMPLEMENTATION_REQUIRES_CURRENT_INPUT_REVIEW');
assert.ok(plan.sourceSnapshots.some(x=>x.path===plan.closureReview.contract));
for(const id of ['closure-review-regressions','continuation-v4-regressions']) assert.equal(byId.get('ENT-101').suites.find(s=>s.id===id).status,'PRESENT_REQUIRES_FRESH_RUN');
for(const id of ['ENT-2412','ENT-2413','ENT-2414']) assert.ok(byId.get(id).suites.some(s=>s.id===id+'.numerical-oracle'));
assert.equal(legacyRuntime.boundedContinuation.catalogNominalLowerBound,2+plan.batches.filter(b=>b.stage==='build-foundation').length*2+2);
assert.ok(legacyRuntime.boundedContinuation.catalogNominalLowerBound>legacyRuntime.initialStepLimit,'do not promise one-run completion');
assert.equal(legacyRuntime.remainingNominalSteps,legacyRuntime.boundedContinuation.remainingArchitectureReviews+legacyRuntime.boundedContinuation.preparationTurns+legacyRuntime.boundedContinuation.remainingDesignTurns+legacyRuntime.boundedContinuation.remainingImplementationReviews+legacyRuntime.boundedContinuation.currentTargetBatches.length*2);
assert.equal(legacyRuntime.nominalSteps,legacyRuntime.currentStep+legacyRuntime.remainingNominalSteps);
assert.equal(continuation.unimportedReview.disposition.startsWith('HISTORY_ONLY'),true);
assert.equal(hash(readFileSync(resolve(root,continuation.unimportedReview.snapshot))),continuation.unimportedReview.sha256);
// A rejected prerequisite grants no current approval. This checks the design only.
const recovery=plan.rejectedRegeneration;
assert.equal(recovery.status,'EXISTING_IMPLEMENTATION_REQUIRES_CURRENT_RUN_REVALIDATION');
assert.equal(recovery.currentArchitectureApproval,null);
assert.equal(recovery.machineEvidenceOnly,true);
for(const key of ['progressWrites','independentApprovalGranted','activeBatchSwapAllowed']) assert.equal(recovery[key],false);
assert.equal(recovery.runSlug,continuation.priorRunSlug);assert.equal(recovery.currentRunSlug,continuation.runSlug);assert.equal(recovery.historicalOnly,true);
assert.equal(recovery.executionWithinActiveBatch,'B01','actual selected active required');
assert.deepEqual(recovery.prefix,['B00','B01'],'authenticated current prefix required');
assert.equal(recovery.rejectionIteration,6,'current first rejection required');
assert.equal(recovery.ownerIssue,'ENT-101');assert.equal(recovery.implementationBatch,'B00');
assert.ok(plan.sourceSnapshots.some(s=>s.path===recovery.contract),'unbound recovery contract');
assert.equal(recovery.designAttestation,'enterprise-recovery-design-attestation');
assert.deepEqual(recovery.command,[...commandBase,'batch','--recover-rejected']);
assert.deepEqual(plan.commands.recoverRejected,recovery.command);
assert.deepEqual(recovery.frozenGate,[...commandBase,'batch']);
assert.equal(workflow.steps.find(s=>s.name==='build-foundation').quality_gates[0].command,recovery.frozenGate.join(' '));
const recoverySuite=byId.get(recovery.ownerIssue).suites.find(s=>s.id===recovery.suiteId);
assert.equal(recoverySuite.status,'PRESENT_REQUIRES_FRESH_RUN');
for(const path of ['scripts/enterprise/rejected-regeneration.mjs',recoverySuite.path])assert.ok(readFileSync(resolve(root,path)).length);
assert.equal(recoverySuite.path,'tests/enterprise/rejected-regeneration.test.mjs');
assert.deepEqual(recoverySuite.command,['mise','exec','--','node','--test','--test-reporter=tap',recoverySuite.path]);
assert.deepEqual(recoverySuite.requiredAssertions,recovery.requiredAssertions);
assert.equal(recovery.requiredAssertions.length,88);assert.equal(new Set(recovery.requiredAssertions).size,88);
// AR12-01 is a plan contract, not a claim that the recovery CLI exists or passed.
assert.equal(recovery.architectureFinding,'AR12-01');
const lineage=recovery.lineage;
assert.equal(lineage.schemaVersion,1);assert.equal(lineage.status,'EXISTING_IMPLEMENTATION_REQUIRES_CURRENT_RUN_VERIFICATION');
assert.equal(lineage.runtimeVerified,false);
assert.equal(lineage.rootEquality,'BOOTSTRAP_ONLY_STRICT','original equality must remain at root only');
assert.equal(lineage.descendantEquality,'PRODUCING_ATTEMPT_CANDIDATE_RECEIPTS_AND_PLAN','descendant must bind new receipts and plan');
assert.equal(lineage.rootSelectionImmutable,true);
assert.equal(lineage.currentPermission,'LATEST_SCOPED_REJECTION_OR_EXPLICIT_INVALID_REVIEW_REVALIDATION_ORDER');
assert.equal(lineage.historicalRejections,'PROVENANCE_ONLY_NEVER_CURRENT_PERMISSION');
assert.equal(lineage.headAuthority,'UNTRUSTED_INDEX_VALIDATE_FULL_CHAIN_AND_ORCHESTRATOR');
assert.equal(lineage.attemptParent,'VERSIONED_SCOPED_REJECTION_OR_REVALIDATION_ORDER_AND_PREVIOUS_TERMINAL');
assert.equal(lineage.sameParentRetry,'ALL_PREFIX_NEW_ATTEMPT_AFTER_FAILED_INTERRUPTED_OR_INPUT_CHANGED');
assert.deepEqual(lineage.referenceOrder,['header','receipts','candidate','terminal-result','independent-review']);
assert.equal(lineage.candidateReferencesResult,false,'candidate/result hash cycle');
assert.deepEqual(lineage.requiredBindings,['runSlug','workflowRef','rootId','entrySelectionHash','activeBatchId','prefixTopology','originalAC','planSha256','inputsDigest','suiteDefinitions','builderSession','parentRejectionReportSha256','previousTerminalSha256']);
assert.deepEqual(lineage.reviewBinding,['rootId','attemptId','headerSha256','resultPath','resultSha256','parentRejectionReportSha256']);
assert.equal(lineage.changedPlanRequiresNewDesignApproval,true);
assert.equal(lineage.latestApproveEndsRegenerationPermission,true);
assert.equal(lineage.importMode,'VALIDATE_HISTORICAL_LINEAGE_AND_CURRENT_EXACT_APPROVE');
assert.equal(lineage.minimumConsecutiveRejections,2);
for(const name of ['recovery-two-rejections-new-receipts-new-plan-then-exact-import',
 'recovery-root-equality-only-at-bootstrap','recovery-descendant-rejection-binds-producing-attempt',
 'recovery-chain-missing-mixed-tampered-or-forked-zero-writes','recovery-old-rejection-or-head-replay-rejected',
 'recovery-plan-suite-change-requires-matching-design-approval','recovery-latest-incomplete-review-blocks-descendant-attempt',
 'recovery-same-parent-failed-attempt-retry-retains-chain','recovery-terminal-publication-crash-and-concurrent-head',
 'recovery-approval-import-validates-chain-without-rejection-authority']) assert.ok(recovery.requiredAssertions.includes(name),`missing AR12-01 counterexample ${name}`);
for(const path of ['work/enterprise/BATCH_REVIEW.md','work/enterprise/REVIEW_CLOSURE.md']) {
 assert.ok(plan.sourceSnapshots.some(s=>s.path===path));
 assert.ok(readFileSync(resolve(root,path),'utf8').includes('AR12-01'),`unbound repeated-rejection review contract ${path}`);
}
const before13=read(recovery.iteration13EntrySnapshot);
const plan13=read(before13.entries.find(e=>e.path==='work/enterprise/plan.json').copy);
const originalRecoveryAssertions=plan13.rejectedRegeneration.requiredAssertions;
assert.deepEqual(recovery.requiredAssertions.slice(0,originalRecoveryAssertions.length),originalRecoveryAssertions,'removed original recovery regressions');
const runtimeContinuationText=readFileSync(resolve(root,plan.failedIntervalRecovery.runtimeContinuation.contract),'utf8');
const recoveryText=readFileSync(resolve(root,recovery.contract),'utf8');
for(const name of recovery.requiredAssertions) assert.ok((recoveryText+readFileSync(resolve(root,plan.failedIntervalRecovery.contract),'utf8')+runtimeContinuationText).includes(name),`missing recovery counterexample ${name}`);

const refresh=recovery.ordinaryRefreshBootstrap;
assert.equal(refresh.status,'EXISTING_IMPLEMENTATION_REQUIRES_FRESH_REVALIDATION');
assert.equal(refresh.rootSchemaVersion,2);assert.equal(refresh.legacyStrictRootSchemaVersion,1);
assert.equal(refresh.originalSelectionAndFirstRejectionPlanEqual,true);
assert.equal(refresh.rootSelectionImmutable,true);assert.equal(refresh.currentApprovalGranted,false);
assert.equal(refresh.permission,'EVIDENCE_REGENERATION_ONLY');
assert.equal(refresh.requiredAssertions.length,12);
for(const name of refresh.requiredAssertions){assert.ok(recovery.requiredAssertions.includes(name));assert.ok(recoveryText.includes(name));}
assert.notEqual(refresh.selectedPredecessorRunId,refresh.rejectedPredecessorRunId);
// Iteration 14: an explicit independent order permits fresh machine evidence only.
// These assertions validate the proposed contract, not a runtime implementation.
const revalidation=recovery.reviewRevalidation;
assert.equal(revalidation.status,'EXISTING_IMPLEMENTATION_REQUIRES_CURRENT_RUN_REVALIDATION');
assert.equal(revalidation.contract,'work/enterprise/REVIEW_REVALIDATION.md');
assert.ok(plan.sourceSnapshots.some(s=>s.path===revalidation.contract));
assert.equal(revalidation.currentIndependentApproval,null);assert.equal(revalidation.runtimeVerified,false);
assert.equal(revalidation.permission,'EVIDENCE_REGENERATION_ONLY');
assert.equal(revalidation.purpose,'REVALIDATE_INVALID_REVIEW_ONLY');
assert.equal(revalidation.designAttestationSchemaVersion,2);
assert.deepEqual(revalidation.allowedDifferences,['/recovery/resultPath']);
assert.equal(revalidation.originalReviewDisposition,'INVALID_RECOVERY_BINDING_NEVER_IMPORTED');
for(const key of ['currentApprovalGranted','ordinaryDesignApprovalSufficient','originalReportsMutable','rootMutable','progressWrites','invalidReviewSkipped','candidateReferencesResult','sameRunInitializationAllowed']) assert.equal(revalidation[key],false,`invalid revalidation ${key}`);
for(const key of ['newAttemptAlwaysRequired','strictAllOriginalACsBeforeOrder','latestFoundationReviewMustBeCompleted','normalApprovalImportUnchanged','frozenGateUnchanged']) assert.equal(revalidation[key],true,`missing revalidation ${key}`);
assert.equal(revalidation.ownerIssue,recovery.ownerIssue);assert.equal(revalidation.implementationBatch,'B00');assert.equal(revalidation.executionWithinActiveBatch,'B01');
assert.deepEqual(revalidation.fullPrefixRequired,recovery.prefix);
assert.equal(revalidation.headerSchemaVersion,2);assert.equal(revalidation.recoverySchemaVersion,2);
assert.deepEqual(revalidation.allowedRecoverySchemas,['LEGACY_UNVERSIONED','V2_TYPED_AUTHORITY']);
assert.equal(revalidation.reviewedTerminalBinding,'AS_OF_INVALID_REVIEW_NOT_LATEST_RETRY');
assert.deepEqual(revalidation.authorityKinds,['SCOPED_REJECTION','DESIGN_REVALIDATION_ORDER']);
assert.deepEqual(revalidation.referenceOrder,['independent-order-and-invalid-review-and-prior-terminal','header','receipts','candidate','terminal-result','independent-review']);
assert.deepEqual(revalidation.requiredConsumers,['generation','closure-import','approval-validation','new-run-history']);
assert.deepEqual(revalidation.acceptanceSequence,['authenticate-original-selection-and-entire-chain','independent-design-revalidation-order','real-Astra-build','full-B00-B01-machine-evidence','fresh-independent-foundation-review','strict-current-atomic-import','ordinary-B02-selection']);
assert.equal(revalidation.requiredAssertions.length,16);assert.equal(new Set(revalidation.requiredAssertions).size,16);
const revalidationText=readFileSync(resolve(root,revalidation.contract),'utf8');
for(const name of revalidation.requiredAssertions){assert.ok(recovery.requiredAssertions.includes(name));assert.ok(revalidationText.includes(name));}
assert.deepEqual(recoverySuite.extensionAssertions,revalidation.requiredAssertions);assert.equal(recoverySuite.extensionStatus,'PRESENT_REQUIRES_FRESH_RUN');
const target=revalidation.target;
assert.equal(target.runSlug,recovery.runSlug);assert.equal(target.reviewIteration,12);
const keys=['rootId','attemptId','headerSha256','resultPath','resultSha256','parentRejectionReportSha256'];
assert.deepEqual(Object.keys(target.invalidRecovery),keys);assert.deepEqual(Object.keys(target.expectedRecovery),keys);
assert.deepEqual(keys.filter(k=>target.invalidRecovery[k]!==target.expectedRecovery[k]),['resultPath']);
assert.equal(target.expectedRecovery.resultPath,`evidence/enterprise/recoveries/${target.expectedRecovery.rootId}/attempts/${target.expectedRecovery.attemptId}/result.json`);
const currentDesignPlan=read(read(plan.revisionHistory.currentDesignEntrySnapshot).entries.find(e=>e.path==='work/enterprise/plan.json').copy);
assert.deepEqual(recovery.requiredAssertions.slice(0,currentDesignPlan.rejectedRegeneration.requiredAssertions.length),currentDesignPlan.rejectedRegeneration.requiredAssertions,'removed existing recovery assertions');
const actualProgress=read('work/enterprise/progress.json');
assert.equal(actualProgress.runBinding.runSlug,continuation.runSlug);assert.equal(actualProgress.activeBatchId,'B04');
assert.equal(plan.openRegressions.find(x=>x.finding==='BF-43').status,'HISTORICAL_FIX_REQUIRES_CURRENT_RUN_REVALIDATION');

for(const ac of byId.get(recovery.ownerIssue).acceptanceTests) assert.ok(ac.suiteIds.includes(recovery.suiteId));
const entryRoot='evidence/enterprise/design-history/run-20261021010405-iteration11-entry/';
const entryPlan=read(entryRoot+'work/enterprise/plan.json');
assert.deepEqual(plan.batches,entryPlan.batches,'redesign changed batch topology');
for(const prior of entryPlan.issues) {
 const current=byId.get(prior.id);
 for(const field of ['originalAcceptance','dependsOn','sourceSpecSha256','batchId','children']) assert.deepEqual(current[field],prior[field],`changed ${field} ${prior.id}`);
}
const entryCoverage=read(entryRoot+plan.coverage);
for(const field of Object.keys(entryCoverage).filter(k=>k!=='executionContext')) assert.deepEqual(coverage[field],entryCoverage[field],`changed coverage ${field}`);
const manifest=read(recovery.entrySnapshot).entries;
for(const path of ['work/enterprise/progress.json','evidence/enterprise/runs/index.json']) {
 const saved=manifest.find(x=>x.path===path);assert.ok(saved,`missing history ${path}`);
 assert.equal(hash(readFileSync(resolve(root,path))),saved.sha256,`design mutated runtime state ${path}`);
}
const currentEntry=read(plan.revisionHistory.currentRunEntrySnapshot);
const savedPlan=read(currentEntry.entries.find(e=>e.path==='work/enterprise/plan.json').copy);
assert.deepEqual(plan.batches,savedPlan.batches,'new-run topology changed');
for(const prior of savedPlan.issues){const now=byId.get(prior.id);for(const field of ['originalAcceptance','dependsOn','sourceSpecSha256','batchId','children'])assert.deepEqual(now[field],prior[field],`new-run changed ${field} ${prior.id}`);for(const suite of prior.suites){const next=now.suites.find(s=>s.id===suite.id);assert.ok(next);for(const name of suite.requiredAssertions)assert.ok(next.requiredAssertions.includes(name),'removed planned assertion');}}
const extension=continuation.handoffExtension;
assert.equal(extension.status,'IMPLEMENTED_REQUIRES_CURRENT_RUN_REVALIDATION');
assert.equal(extension.oldRejectionGrantsCurrentPermission,false);
assert.equal(continuation.unimportedReview.verdict,'REQUEST_CHANGES');
assert.equal(continuation.unimportedReview.finding,'BF-61');assert.equal(continuation.unimportedReview.iteration,60);assert.equal(continuation.unimportedReview.batchId,'B04');
assert.equal(continuation.priorRunSlug,recovery.runSlug);assert.notEqual(continuation.priorRunSlug,recovery.historicalObservation.runSlug);
assert.equal(recovery.historicalObservation.currentAuthority,false);
const v4=byId.get('ENT-101').suites.find(s=>s.id===extension.suiteId);
assert.equal(extension.requiredAssertions.length,7);
for(const name of extension.requiredAssertions){assert.ok(v4.requiredAssertions.includes(name));assert.ok(readFileSync(resolve(root,continuation.contract),'utf8').includes(name));}
assert.equal(plan.openRegressions[0].finding,'BF-38');
const tail=continuation.failedTailExtension;
assert.equal(tail.status,'IMPLEMENTED_REQUIRES_CURRENT_INPUT_REVALIDATION');
assert.equal(tail.permission,'HISTORY_ARCHIVE_AND_EMPTY_NEW_RUN_PROJECTION_ONLY');
assert.equal(tail.normalApprovalValidatorsUnchanged,true);
assert.equal(tail.requiredAssertions.length,7);
for(const name of tail.requiredAssertions){assert.ok(v4.requiredAssertions.includes(name));assert.ok(readFileSync(resolve(root,continuation.contract),'utf8').includes(name));}
assert.equal(plan.openRegressions.find(x=>x.finding==='BF-42').status,'HISTORICAL_FIX_REQUIRES_CURRENT_RUN_REVALIDATION');
for(const s of byId.get('ENT-103').suites)for(const name of ['BF-42-new-edit-current-purpose-denied-before-fix','BF-42-new-edit-attach-vote-cancel-current-purpose-after-fix','BF-42-original-purpose-replay-and-authorized-edit-retained'])assert.ok(s.requiredAssertions.includes(name));

for(const suite of byId.get('ENT-114').suites)for(const name of ['BF-38-current-lineage-audit-denied-before-fix','BF-38-current-lineage-audit-boundary-after-fix','BF-38-authorized-audit-and-immutable-history-retained'])assert.ok(suite.requiredAssertions.includes(name));
// New initializer-private history contract; structure checks do not execute it.
const ordinary=continuation.ordinaryHistoryExtension;
assert.equal(ordinary.status,'IMPLEMENTED_REQUIRES_CURRENT_INPUT_REVALIDATION');assert.equal(ordinary.runtimeVerified,false);
assert.equal(ordinary.permission,'HISTORY_ARCHIVE_AND_EMPTY_NEW_RUN_PROJECTION_ONLY');
assert.equal(ordinary.normalApprovalValidatorsUnchanged,true);assert.equal(ordinary.implementationBatch,'B00');
assert.equal(ordinary.historicalReceiptCount,12);assert.equal(ordinary.historicalInputDigests.length,3);
assert.equal(new Set(ordinary.historicalInputDigests).size,3);assert.equal(ordinary.requiredAssertions.length,8);
assert.ok(plan.sourceSnapshots.some(s=>s.path===ordinary.contract));
const ordinaryText=readFileSync(resolve(root,ordinary.contract),'utf8');
assert.deepEqual(v4.extensionAssertions,ordinary.requiredAssertions);assert.equal(v4.extensionStatus,'PRESENT_REQUIRES_FRESH_RUN');
for(const name of ordinary.requiredAssertions){assert.ok(v4.requiredAssertions.includes(name));assert.ok(ordinaryText.includes(name));}
const bf61=plan.openRegressions.find(x=>x.finding==='BF-61');
assert.equal(bf61.status,'FIX_PRESENT_REQUIRES_CURRENT_RECEIPT_AND_INDEPENDENT_REVIEW');assert.equal(bf61.batchId,'B04');
assert.equal(hash(readFileSync(resolve(root,bf61.sourceReview))),bf61.sourceReviewSha256);
assert.equal(bf61.requiredAssertions.length,3);
for(const suite of byId.get('ENT-114').suites)for(const name of bf61.requiredAssertions)assert.ok(suite.requiredAssertions.includes(name));
assert.equal(legacyRuntime.currentStep,57);assert.equal(legacyRuntime.nominalSteps,60);assert.equal(legacyRuntime.repairReserve,0);
assert.deepEqual(legacyRuntime.boundedContinuation.currentTargetBatches,[]);
assert.equal(legacyRuntime.boundedContinuation.preparationTurns,0);
assert.equal(legacyRuntime.boundedContinuation.remainingArchitectureReviews,1);
assert.equal(legacyRuntime.boundedContinuation.remainingDesignTurns,2);

const currentReassessment=plan.componentContinuation.reassessment;
assert.equal(currentReassessment.iteration,4);assert.equal(currentReassessment.configEditable,false);
for(const k of ['actualAuthorityAccepted','implementationAccepted','milestonesReset'])assert.equal(currentReassessment[k],false);
assert.equal(currentReassessment.implementationTurnsConsumed,1);assert.equal(currentReassessment.fixtureTestsPassed,32);assert.equal(currentReassessment.independentReview,null);
const currentReassessmentCheckpoint=read(currentReassessment.checkpoint.path);
assert.equal(hash(readFileSync(resolve(root,currentReassessment.checkpoint.path))),currentReassessment.checkpoint.sha256);
assert.equal(readFileSync(resolve(root,currentReassessment.checkpoint.path)).length,currentReassessment.checkpoint.bytes);
assert.equal(currentReassessmentCheckpoint.kind,'REASSESSMENT_DATA_NOT_AUTHORITY');
assert.deepEqual(currentReassessment.currentConfig,currentReassessmentCheckpoint.proposedConfig);
const observedDeltaPaths=['.takt/config.yaml','scripts/enterprise/runtime-preparation.mjs','tests/enterprise/rejected-regeneration.test.mjs'];
for(const path of observedDeltaPaths){const ref=currentReassessmentCheckpoint.references.find(e=>e.path===path);assert.ok(ref);assert.equal(hash(readFileSync(resolve(root,ref.copy))),ref.sha256);if(path==='.takt/config.yaml'&&!successor)assert.equal(hash(readFileSync(resolve(root,path))),ref.sha256,'reassessment config drift');}
const currentReassessmentEntry=read(currentReassessment.entrySnapshot);
assert.equal(currentReassessmentEntry.runSlug,plan.componentContinuation.runSlug);
for(const path of observedDeltaPaths){const e=currentReassessmentEntry.entries.find(e=>e.path===path),r=currentReassessmentCheckpoint.references.find(e=>e.path===path);assert.deepEqual(r,e);}
assert.equal(currentReassessment.currentConfig.sha256,'f943847b403b35b42e4650099752f0a26544a0e642b278283aacc8400e54d503');
assert.deepEqual(currentReassessmentCheckpoint.profileProjection,{profile:'takt-fast',value:{service_tier:'fast',features:{fast_mode:true}}});
for(const ref of currentReassessmentCheckpoint.references){assert.equal(hash(readFileSync(resolve(root,ref.copy))),ref.sha256);if(ref.path.includes('/iteration3/'))assert.equal(hash(readFileSync(resolve(root,ref.path))),ref.sha256);}
const currentDesignEntry=read(plan.revisionHistory.currentDesignEntrySnapshot);
assert.equal(recovery.entrySnapshot,plan.revisionHistory.currentDesignEntrySnapshot);
for(const record of currentDesignEntry.existingFiles){if(record.path==='scripts/enterprise/check-design.mjs'||observedDeltaPaths.includes(record.path)||(successor&&record.path==='.takt/runtime.yaml')||plan.componentContinuation.permittedPaths.includes(record.path))continue;assert.equal(hash(readFileSync(resolve(root,record.path))),record.sha256,`design changed existing product/runtime ${record.path}`);}

const failed=plan.failedIntervalRecovery;
assert.equal(failed.status,'PLANNED_NOT_IMPLEMENTED');assert.equal(failed.designApproval,null);
assert.equal(failed.permission,'PREPARATION_AND_HISTORY_ONLY');assert.equal(failed.authorityKind,'SOURCE_PREPARATION_ORDER');
assert.equal(failed.schemaVersion,3);assert.equal(failed.implementationWithinActiveBatch,actualProgress.activeBatchId);
assert.deepEqual(failed.prefix,['B00','B01','B02','B03','B04']);
assert.equal(failed.leafCount,19);assert.equal(failed.originalACCount,52);assert.equal(failed.requiredAssertions.length,32);
for(const key of ['progressWrites','sameRunInitializationAllowed','currentApprovalGranted','runtimeTransitionImplemented'])assert.equal(failed[key],false);
assert.ok(plan.sourceSnapshots.some(e=>e.path===failed.contract));
const failedText=readFileSync(resolve(root,failed.contract),'utf8');
for(const name of failed.requiredAssertions){assert.ok(recoverySuite.requiredAssertions.includes(name));assert.ok((failedText+runtimeContinuationText).includes(name));}
// AR14-B01 / AR14-N01: structure only, no actual executor migration claimed.
assert.equal(failed.runtimeTransition,'DISTINCT_RUN_OFFICIAL_CENTRAL_LAUNCHER_AFTER_SOURCE_TERMINAL');
assert.equal(failed.historicalArchiveKind,'FAILED_INTERVAL_RUNTIME_CONTINUATION');
assert.deepEqual(failed.command,plan.commands.initializeRun);
assert.equal(failed.frozenGateDispatch,'NO_FALLBACK_EXPLICIT_TARGET_INITIALIZATION');
assert.equal(failed.targetRun,null);assert.equal(failed.targetInitialBatch,'B00');assert.deepEqual(failed.targetInitialApprovals,[]);
for(const key of ['sourceProgressWrites','sourceOrderIsTargetPermission']) assert.equal(failed[key],false,key);
for(const key of ['sourceTerminalRequired','currentRuntimeValidatorsUnchanged']) assert.equal(failed[key],true,key);
assert.deepEqual(failed.failureKinds,['SUBPROCESS_FAILURE','GATE_VALIDATION_FAILURE']);
const transition=failed.runtimeContinuation;
assert.equal(transition.status,'PLANNED_NOT_IMPLEMENTED');
assert.equal(transition.contract,'work/enterprise/RUNTIME_CONTINUATION.md');
assert.ok(plan.sourceSnapshots.some(e=>e.path===transition.contract));
assert.equal(transition.sourceRun,continuation.runSlug);assert.equal(transition.targetRun,null);
assert.equal(transition.officialEntry,'NEW_CENTRAL_LAUNCHER_NO_WORKTREE_INITIAL_ARCHITECTURE');
assert.equal(transition.sourceAttestationSchema,2);assert.equal(transition.targetAttestationSchema,1);
assert.equal(transition.targetAttestation,'enterprise-runtime-continuation-attestation');
assert.equal(transition.sourcePermission,'PREPARATION_AND_HISTORY_ONLY');
assert.equal(transition.targetPermission,'HISTORY_ARCHIVE_AND_EMPTY_NEW_RUN_PROJECTION_ONLY');
for(const key of ['sameRunResumeAllowed','copySourceActiveAllowed','copySourceApprovalsAllowed']) assert.equal(transition[key],false,key);
for(const key of ['sourceTerminalRequired','freshTargetDesignReviewRequired']) assert.equal(transition[key],true,key);
assert.equal(transition.historicalRuntimeReader,'INITIALIZER_PRIVATE_EXACT_OLD_BYTES');
assert.equal(transition.failureDerivation,'RECEIPT_OWN_PLAN_EXIT_SIGNAL_LOGS_AND_EXACT_GATE_DIAGNOSIS');
assert.deepEqual(transition.targetBudget,{nominalSteps:20,repairReserve:40,initialStepLimit:60,targetBatches:['B00','B01','B02','B03','B04','B05','B05A','B05B','B06']});
assert.equal(transition.targetBudget.nominalSteps,2+transition.targetBudget.targetBatches.length*2);
const additions=recoverySuite.runtimeContinuationAssertions;
assert.equal(recoverySuite.runtimeContinuationStatus,'PLANNED_NOT_IMPLEMENTED');
assert.equal(additions.length,14);assert.equal(new Set(additions).size,14);
assert.deepEqual(failed.requiredAssertions.slice(18),additions);
assert.deepEqual(failed.requiredAssertions,currentDesignPlan.failedIntervalRecovery.requiredAssertions);
for(const name of additions){assert.ok(runtimeContinuationText.includes(name));assert.ok(recovery.requiredAssertions.includes(name));}
// Iteration29: bounded executable delivery; diagnostic helpers grant no migration authority.
const delivery=transition.delivery;
assert.equal(delivery.contract,'work/enterprise/RUNTIME_DELIVERY.md');
assert.ok(plan.sourceSnapshots.some(e=>e.path===delivery.contract));
assert.equal(delivery.status,'PENDING_INDEPENDENT_DESIGN_REVIEW');
assert.equal(delivery.observationsImplemented,true);assert.equal(delivery.migrationImplemented,false);
assert.equal(delivery.newSourceOrderRequired,true);assert.equal(delivery.sourceOrderPermission,'PREPARATION_AND_HISTORY_ONLY');
for(const key of ['preparationCompleteIsTerminal','manufactureAbortAllowed','repeatUnchangedProbesToReachLimit','actualLaunchAuthorized','targetCreated'])assert.equal(delivery[key],false,key);
assert.equal(delivery.ordinaryGatePassingCandidateRequired,true);
assert.equal(delivery.sourceTerminalMechanism,'EXISTING_RULE_ONLY_WHEN_ITS_ACTUAL_CONDITION_HOLDS');
assert.deepEqual(delivery.hostAdmission,{status:'UNCONFIRMED_EXTERNAL_MECHANISM',quietQueueIsExclusion:false,localMutexExcludesOfficialWriters:false,productionDefault:'DENY',scope:'ALL_PROJECT_ENQUEUE_AND_LAUNCH_ENTRY_POINTS',lifetime:'OWNER_GENERATION_ENFORCED_UNTIL_TARGET_WORKER_RELEASE'});
assert.equal(delivery.historyGapPolicy,'AUTHENTICATED_PREIMAGE_OR_BLOCK_NO_WAIVER');
assert.deepEqual(delivery.workPackages.map(w=>w.id),['R1','R2','R3','R4']);
assert.deepEqual(delivery.workPackages.map(w=>w.dependsOn),[[],['R1'],['R1','R2'],['R1','R2','R3']]);
const deliveryAssignments=delivery.workPackages.flatMap(w=>w.requiredAssertions);
assert.equal(deliveryAssignments.length,failed.requiredAssertions.length);assert.equal(new Set(deliveryAssignments).size,deliveryAssignments.length);
assert.deepEqual([...deliveryAssignments].sort(),[...failed.requiredAssertions].sort());
assert.deepEqual(delivery.workPackages[3].integrationAssertions,failed.requiredAssertions);
for(const w of delivery.workPackages){assert.equal(w.implementationStatus,w.id==='R1'?'PARTIAL_COMPONENTS_REQUIRES_INTEGRATION':'PLANNED_NOT_IMPLEMENTED');assert.equal(w.ownerIssue,'ENT-101');assert.equal(w.activeBatchId,actualProgress.activeBatchId);assert.ok(w.paths.length&&w.acceptance.length);assert.deepEqual(w.command,['mise','exec','--','node','--test','--test-reporter=tap','tests/enterprise/continuation.test.mjs','tests/enterprise/continuation-v4.test.mjs','tests/enterprise/rejected-regeneration.test.mjs']);}
const historicOrder=plan.revisionHistory.runtimeDeliveryCorrection.historicalSourceOrder;
assert.equal(historicOrder.iteration,30);assert.equal(historicOrder.currentAuthority,false);
assert.equal(hash(readFileSync(resolve(root,historicOrder.path))),historicOrder.sha256);
// Iteration45: implement the private reader without converting diagnostics or
// fixture success into actual historical proof. Structural checks only.
const r1=delivery.r1Reassessment;
assert.equal(r1.iteration,45,'historical R1 reassessment anchor');
assert.equal(r1.privateReader,'scripts/enterprise/runtime-history.mjs');
assert.ok(delivery.workPackages[0].paths.includes(r1.privateReader));
assert.equal(r1.readerStatus,'PARTIAL_REFERENCE_GRAPH_VERSION_OUTPUT_COMPONENTS; TARGET_PRIVATE_READER_INCOMPLETE');
for(const key of ['oldRuntimeExecutionAllowed','sourceDiagnosticsAsTargetReader','realHistoryComplete','sourceImplementationExhausted','partialHistoryGrantsAuthority','fixtureCanAuthorizeProduction','searchEmptyMeansExhaustive'])assert.equal(r1[key],false,`R1 unsafe ${key}`);
assert.equal(r1.normalRuntimeChecksUnchanged,true);assert.equal(r1.dependencyClosureRequired,true);
assert.deepEqual(r1.originPort,{name:'OriginEvidencePort',mode:'READ_ONLY',productionFormat:'UNCONFIRMED_NO_ACCEPTED_PRODUCER',unavailable:'UNPROVEN_EXECUTION_ORIGIN',feedbackIsReceiptOrigin:false,prospectiveProofBackfillsHistory:false});
assert.deepEqual(r1.results,['IMPLEMENTATION_CONTRACT_TESTS','ACTUAL_HISTORY_COMPLETENESS','MIGRATION_AUTHORIZATION']);
assert.deepEqual(r1.implementationIncrements,['R1a','R1b']);assert.deepEqual(r1.incrementDependencies,[[],['R1a']]);
assert.equal(r1.implementationTurns,2,'historical source envelope; successor pairs budgeted separately');
for(const ref of [r1.historicalHandoff,r1.originAssessment])assert.equal(hash(readFileSync(resolve(root,ref.path))),ref.sha256,'changed R1 blocker evidence');
const reassessment=read(r1.historicalHandoff.path),origin=read(r1.originAssessment.path);
assert.equal(reassessment.initializationAuthority,false);assert.equal(origin.automaticGateOriginProven,false);
assert.equal(r1.missingReferenceCount,reassessment.missing.length);assert.equal(r1.missingReferenceCount,28);
assert.equal(r1.missingPreimageCount,new Set(reassessment.missing.map(e=>e.path+'\0'+e.sha256)).size);assert.equal(r1.missingPreimageCount,2);
assert.equal(r1.cases.length,12);assert.equal(new Set(r1.cases.map(c=>c.id)).size,12);
for(const [i,c] of r1.cases.entries()){
 assert.equal(c.id,`R1-${String(i+1).padStart(2,'0')}`);
 assert.equal(c.increment,i<6?'R1a':'R1b');
 assert.ok(delivery.workPackages[0].requiredAssertions.includes(c.assertion),'R1 subcase has no existing assertion owner');
 assert.ok(c.expected.length>30,'R1 observable acceptance missing');
}
assert.deepEqual(recovery.requiredAssertions,currentDesignPlan.rejectedRegeneration.requiredAssertions,'R1 must preserve all existing assertion names');
assert.equal(plan.selection.progressStatus,'SOURCE_RUN_ACTIVE_B04; CURRENT_PREPARATION_RUN_NOT_INITIALIZED; NO_CURRENT_APPROVAL');
const unchangedInputs=currentDesignEntry.inputs.entries.filter(e=>!['scripts/enterprise/check-design.mjs',...plan.sourceSnapshots.filter(x=>x.path.startsWith('work/enterprise/')).map(x=>x.path),'work/enterprise/plan.json'].includes(e.path));
for(const e of unchangedInputs.filter(e=>!observedDeltaPaths.includes(e.path)&&!(successor&&e.path==='.takt/runtime.yaml')&&!plan.componentContinuation.permittedPaths.includes(e.path)))assert.equal(hash(readFileSync(resolve(root,e.path))),e.sha256,`unrelated input changed ${e.path}`);


// Successor preparation is neither a source writer nor an authorized target.
const prep=plan.preparationEntry;
assert.equal(prep.schemaVersion,1);assert.equal(prep.status,'PENDING_INDEPENDENT_DESIGN_REVIEW');
assert.equal(prep.runSlug,'20261024121802-56fec935');assert.notEqual(prep.runSlug,prep.sourceRunSlug);
assert.equal(prep.sourceRunSlug,actualProgress.runBinding.runSlug);
assert.equal(prep.runtimeVersion,'0.71.0');assert.equal(prep.guardStatus,'ATTEMPT7_RUNNING_FENCED_EXPLICIT_RECOVERY_DESIGN_PENDING');
assert.equal(prep.purpose,'PREPARE_SUCCESSOR_HISTORY_COMPONENTS');assert.equal(prep.permission,'PREPARATION_AND_HISTORY_ONLY');
assert.equal(prep.attestation,'enterprise-continuation-preparation-attestation');
for(const k of ['isAuthorizedMigrationTarget','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority'])assert.equal(prep[k],false,k);
assert.deepEqual(prep.currentApprovals,[]);assert.equal(transition.targetRun,null);
assert.equal(prep.contract,'work/enterprise/PREPARATION_ENTRY.md');assert.ok(plan.sourceSnapshots.some(x=>x.path===prep.contract));
assert.equal(legacyRuntime.boundedContinuation.currentRun,plan.preparationRestart.runSlug);
assert.deepEqual(prep.increments,['P0','P1','P2','P3','R1b','R2','R3','R4']);
assert.equal(prep.increments.length*2+2,18); // retained complete preparation estimate; current bounded segment is smaller
assert.equal(legacyRuntime.unboundedRemainingEstimate.nominalTurns,prep.increments.length*2+2+3);
for(const r of [...Object.values(prep.sourceCheckpoint),prep.latestHandoff])assert.equal(hash(readFileSync(resolve(root,r.path))),r.sha256,'source preparation reference changed');
const sourceMeta=read(prep.sourceMetaSnapshot);assert.equal(sourceMeta.runSlug,prep.sourceRunSlug);assert.equal(sourceMeta.status,'failed');assert.equal(sourceMeta.currentIteration,60);assert.equal(sourceMeta.reason,'Max steps reached');
assert.equal(prep.savedMissingConsumerCount,56);assert.equal(prep.missingPreimages,2);
const prepText=readFileSync(resolve(root,prep.contract),'utf8');
for(const name of prep.subcaseAssertions){assert.ok(recovery.requiredAssertions.includes(name));assert.ok(prepText.includes(name));}
for(const path of prep.permittedPaths)assert.ok(currentEntry.inputs.entries.some(e=>e.path===path) || path==='scripts/enterprise/preparation-producer-linux.c','unknown preparation implementation path');
assert.ok(prepText.includes('P0'));assert.ok(prepText.includes('not implemented'));
const ownership=prep.ordinaryGateOwnership;
assert.equal(ownership.status,'IMPLEMENTED_PENDING_INDEPENDENT_COMPONENT_REVIEW');assert.equal(ownership.reviewRequiredBeforeImplementation,true);
assert.deepEqual(ownership.identityFields,['project','runSlug','workflowRef','bundleDigest']);assert.deepEqual(ownership.entries,['dispatch','main','runBatchGate']);
assert.equal(ownership.selectionHelperUnchanged,true);assert.equal(ownership.validateOnlyIsWriter,true);assert.equal(ownership.missingBinding,'REFUSE_NO_IMPLICIT_INITIALIZATION');
assert.deepEqual(ownership.assertionOwners,prep.subcaseAssertions);assert.deepEqual(ownership.caseIds,Array.from({length:10},(_,i)=>'O'+(i+1)));
for(const id of ownership.caseIds)assert.ok(prepText.includes(id+':'),'ownership acceptance missing '+id);
for(const path of ['scripts/enterprise/verify.mjs','tests/enterprise/finalization.test.mjs','tests/enterprise/evidence.test.mjs'])assert.ok(prep.permittedPaths.includes(path),'unreviewable ownership repair path');
assert.ok(!prep.permittedPaths.includes('scripts/enterprise/selection.mjs'),'selection dependency helper must remain unchanged');
assert.equal(prep.terminalMissingConsumerCount,58);assert.equal(prep.terminalHandoffCount,42);
assert.equal(prep.priorPreparationApproval.iteration,2);assert.equal(plan.revisionHistory.ordinaryGateOwnershipReassessment.currentIndependentApproval,null);

// AR6-B01: async API changes must include existing mandatory consumers.
// This validates the migration plan, not implementation behavior.
const migration=ownership.consumerMigration;
assert.equal(migration.finding,'AR6-B01');assert.equal(migration.iteration,7);
assert.equal(migration.status,'IMPLEMENTED_SAVED_REGRESSION_PASS_PENDING_CURRENT_REVIEW');
assert.equal(migration.ownerIssue,'ENT-101');assert.equal(migration.suiteId,'evidence-validator-regressions');
assert.equal(migration.fixturePath,'tests/enterprise/evidence.test.mjs');
assert.equal(migration.fixtureAuthority,'REAL_ISOLATED_REGISTRY_COMPILER_CONTEXT_SESSION_AND_OWNED_RUN_BINDING');
assert.deepEqual(migration.directConsumers,['scripts/enterprise/verify.mjs','tests/enterprise/evidence.test.mjs','tests/enterprise/rejected-regeneration.test.mjs']);
for(const path of migration.directConsumers)assert.ok(prep.permittedPaths.includes(path),'missing async consumer permission');
for(const key of ['awaitAllCalls','awaitRejections','negativeRequiresAuthenticatedPositiveSetup','expectedEvidenceFailurePreserved','lowLevelExecuteTestsUnchanged'])assert.equal(migration[key],true,key);
for(const key of ['guardBypassAllowed','publicTrustedTokenAllowed','skipOrDeleteAllowed'])assert.equal(migration[key],false,key);
assert.equal(migration.foreignRecoverySnippet,'AWAIT_OWNERSHIP_REFUSAL_KEEP_ZERO_WRITES; OWNED_EVIDENCE_TESTS_KEEP_LATEST_FAILURE_REJECTION');
assert.deepEqual(migration.requiredExistingTests,[
 'batch transition retains exact predecessor review receipts and executes only active batch',
 ...['failed','running'].map(s=>`batch transition rejects latest predecessor ${s} without fallback or active execution`),
 ...['stdout','artifacts'].map(s=>`batch transition rejects predecessor ${s} change before active execution`),
 'validate-only batch transition does not create or replace receipts',
 'batch transition reruns stale source predecessors and binds both receipts to new inputs',
 'source change cannot hide tampered predecessor output or start active execution'
]);
const evidenceSuite=byId.get(migration.ownerIssue).suites.find(s=>s.id===migration.suiteId);
assert.equal(evidenceSuite.path,migration.fixturePath);
assert.deepEqual(evidenceSuite,savedPlan.issues.find(i=>i.id===migration.ownerIssue).suites.find(s=>s.id===migration.suiteId),'existing evidence suite changed');
const regressionPaths=['tests/enterprise/evidence.test.mjs','tests/enterprise/finalization.test.mjs','tests/enterprise/continuation.test.mjs','tests/enterprise/continuation-v4.test.mjs','tests/enterprise/rejected-regeneration.test.mjs'];
assert.deepEqual(migration.fullRegressionCommand,['mise','exec','--','node','--test','--test-reporter=tap',...regressionPaths]);
for(const path of regressionPaths)assert.ok(prep.permittedPaths.includes(path),'affected regression outside scope');
assert.ok(prepText.includes('Iteration 7: AR6-B01 authenticated async consumer migration'));
assert.ok(prepText.includes(migration.fullRegressionCommand.join(' ')));
assert.equal(plan.revisionHistory.asyncConsumerCorrection.currentIndependentApproval,null);


// Iteration12: publication authority and failure semantics, not a runtime proof.
const publication=prep.sealPublication;
assert.equal(publication.status,'IMPLEMENTED_PENDING_INDEPENDENT_COMPONENT_REVIEW');assert.equal(publication.ownerIssue,'ENT-101');
assert.equal(publication.writerOwner,'VERIFY_MODULE_PRIVATE_CAPABILITY');
assert.deepEqual(publication.implementationPaths,['scripts/enterprise/verify.mjs','scripts/enterprise/finalization.mjs','tests/enterprise/batch-id.test.mjs','tests/enterprise/closure-review.test.mjs']);
assert.equal(prep.permittedPaths.length,16);assert.equal(new Set(prep.permittedPaths).size,16);
for(const path of publication.implementationPaths)assert.ok(prep.permittedPaths.includes(path),'publication path missing');
for(const key of ['publicSealWriterAllowed','callerCheckpointAuthorityAllowed','readonlyFinalOwnershipFallbackAllowed','oldPassedFallbackAllowed'])assert.equal(publication[key],false,key);
for(const key of ['checkpointAfterEveryAwait','checkpointBeforeSealAndTerminal','attemptBoundaryIncludesPostPublicationFailure','schemaAndApprovalChecksPreserved','preserveClosureNonpromotion','reviewRequiredBeforeImplementation'])assert.equal(publication[key],true,key);
assert.equal(publication.validateCandidateAuthority,'READ_ONLY_DATA_VALIDATION_NOT_FINAL_SUCCESS');
assert.equal(publication.terminalPublication,'LOCKED_RAW_INDEX_CAS_ATOMIC_RENAME');
assert.equal(publication.failure,'APPEND_FAILED_PRESERVE_HISTORY_OR_RETAIN_OWNED_FENCE');
assert.equal(publication.crash,'RUNNING_OR_OWNED_FENCE_BLOCKS_FINAL');
assert.equal(publication.batchFixtureBinding,'COPY_ACTUALLY_AUTHENTICATED_BINDING_IN_LOCAL_RESET_ONLY');
assert.equal(publication.closureExpectedCause,'writer binding runSlug');
assert.equal(publication.runtimeEvidence,'ITERATION14_SAVED_1102_PASS_NOT_CURRENT_REVIEW_OR_RERUN');
assert.deepEqual(publication.requiredExistingTests,migration.requiredExistingTests);
assert.deepEqual(publication.fullRegressionCommand,[...migration.fullRegressionCommand,'tests/enterprise/closure-review.test.mjs']);
assert.equal(publication.batchIdCoverage,'tests/enterprise/finalization.test.mjs imports ./batch-id.test.mjs');
assert.ok(readFileSync(resolve(root,'tests/enterprise/finalization.test.mjs'),'utf8').includes("import './batch-id.test.mjs'"),'batch ID suite not reachable');
assert.deepEqual(publication.acceptanceCases.map(c=>c.id),Array.from({length:10},(_,i)=>'SP'+(i+1)));
const publicationOwners=['same-R-review-and-final-gate','concurrent-change-rejected','unknown-context-fails-before-write','latest-failed-rejected','latest-running-rejected','concurrent-change-rejected','latest-failed-rejected','final-failure-zero-filesystem-writes','BF-04-forged-active-batch-rejected-before-evidence','closure-no-historical-approval-promotion'];
assert.deepEqual(publication.acceptanceCases.map(c=>c.assertionOwner),publicationOwners);
for(const c of publication.acceptanceCases){assert.ok(c.acceptance?.length>20);assert.ok(prepText.includes(c.id+': '+c.acceptance));assert.ok(byId.get('ENT-101').suites.some(s=>s.requiredAssertions.includes(c.assertionOwner)));}
assert.ok(prepText.includes(publication.fullRegressionCommand.join(' ')));
const pc=plan.revisionHistory.publicationCorrection;
assert.equal(pc.iteration,12);assert.equal(pc.currentIndependentApproval,null);assert.equal(pc.entrySnapshot,'evidence/enterprise/design-history/run-20261024121802-iteration12-entry/manifest.json');
assert.equal(pc.historicalPreparationApproval.iteration,8);assert.equal(pc.historicalPreparationApproval.permittedPathCount,12);assert.equal(pc.historicalPreparationApproval.currentAuthority,false);
for(const r of [pc.historicalPreparationApproval,pc.proposal])assert.equal(hash(readFileSync(resolve(root,r.path))),r.sha256,'publication history changed');

// Iteration17: typed preparation evidence/review plan, not executable acceptance.
const pr=plan.preparationReview;
assert.equal(pr.schemaVersion,2);assert.equal(pr.status,'SOURCE_IMPLEMENTED_CAPTURE7_FENCED_RECOVERY_REVISION_PENDING');
assert.equal(pr.contract,'work/enterprise/PREPARATION_REVIEW.md');assert.equal(pr.ownerIssue,'ENT-101');assert.equal(pr.increment,'P0');
assert.equal(pr.enabledRunSlug,prep.runSlug);assert.deepEqual(pr.command,[...commandBase,'batch']);
assert.equal(pr.dispatch,'EXACT_BATCH_EXPLICIT_AUTHENTICATED_REQUEST_BEFORE_PRODUCT_PREFLIGHT');
assert.equal(pr.authorization,'FRESH_COMPLETED_A_P_CURRENT_PLAN_AND_CONTRACTS');
for(const k of ['normalWriterOwnershipUnchanged','productValidatorsUnchanged','latestFailedOrRunningRefuses','strictPhaseSessionAndCanonicalReport','requireActualIsolatedEngine'])assert.equal(pr[k],true,k);
for(const k of ['ownershipFailureFallback','gateRunsSuites','productVerified','sourceWorkflowMutation','centralBundleMutation','reviewerMayImpersonateBuilder','machineEvidenceCanApproveItself','existingEvidenceCanBeRelabelled','releaseOrCompleteAllowed','historyOrMigrationAuthority'])assert.equal(pr[k],false,k);
for(const k of ['gateWrites','approvedIssueIds','currentApprovals'])assert.deepEqual(pr[k],[],k);
assert.equal(pr.namespace,`evidence/enterprise/preparation/${prep.runSlug}/`);
assert.equal(pr.receiptKind,'PREPARATION_COMPONENT_EVIDENCE');assert.equal(pr.gateKind,'PREPARATION_COMPONENT_READY');
assert.equal(pr.reviewStep,'review-foundation');assert.equal(pr.reviewTag,'enterprise-batch-attestation');
assert.equal(pr.reviewSchemaVersion,4);assert.equal(pr.productReviewSchemaVersion,1);
assert.equal(pr.reviewPurpose,'PREPARATION_COMPONENT_REVIEW');assert.equal(pr.reviewPermission,'IMPLEMENTATION_CONTRACT_TESTS_ONLY');
assert.equal(pr.nextStepAfterApproval,'build-foundation');
assert.deepEqual(pr.implementationPaths,['scripts/enterprise/runtime-preparation.mjs','scripts/enterprise/verify.mjs','tests/enterprise/continuation-v4.test.mjs','tests/enterprise/rejected-regeneration.test.mjs','tests/enterprise/finalization.test.mjs','tests/enterprise/evidence-fixture.mjs']);
for(const f of pr.implementationPaths)assert.ok(prep.permittedPaths.includes(f),'prep route path outside approval scope');
assert.deepEqual(pr.fullRegressionCommand,publication.fullRegressionCommand);
assert.deepEqual(pr.caseIds,Array.from({length:12},(_,i)=>'PR'+(i+1)));assert.deepEqual(pr.assertionOwners,prep.subcaseAssertions);
const prText=readFileSync(resolve(root,pr.contract),'utf8');for(const id of pr.caseIds)assert.ok(prText.includes(id+':'),'prep review acceptance missing');
for(const f of [pr.contract,'work/enterprise/BATCH_REVIEW.md'])assert.ok(plan.sourceSnapshots.some(x=>x.path===f),'unbound preparation review contract');
assert.ok(readFileSync(resolve(root,'work/enterprise/BATCH_REVIEW.md'),'utf8').includes('schemaVersion4/purpose PREPARATION_COMPONENT_REVIEW'));
const prChange=plan.revisionHistory.preparationReviewCorrection;
assert.equal(prChange.iteration,17);assert.equal(prChange.currentIndependentApproval,null);assert.equal(prChange.entrySnapshot,'evidence/enterprise/design-history/run-20261024121802-iteration17-entry/manifest.json');
assert.equal(prChange.historicalPreparationApproval.iteration,13);assert.equal(prChange.historicalPreparationApproval.currentAuthority,false);
for(const ref of [pr.historicalImplementation,pr.routingDiagnosis,prChange.historicalPreparationApproval])assert.equal(hash(readFileSync(resolve(root,ref.path))),ref.sha256);
const historicalComponent=read(pr.historicalImplementation.path);
assert.equal(historicalComponent.status,'PENDING_INDEPENDENT_IMPLEMENTATION_REVIEW');assert.deepEqual(historicalComponent.testTotals,{tests:1102,pass:1102,fail:0,cancelled:0,skipped:0,todo:0});
assert.equal(historicalComponent.p0Complete,false);assert.equal(historicalComponent.completeMigrationHistory,false);
const prepBuild=workflow.steps.find(s=>s.name==='build-foundation'),prepReview=workflow.steps.find(s=>s.name==='review-foundation');
assert.equal(prepBuild.quality_gates.find(g=>g.name==='enterprise-batch').command,pr.command.join(' '));
assert.ok(prepBuild.rules.some(r=>r.next==='review-foundation' && r.command_gates!=='skip'));
assert.ok(prepReview.instruction.includes('work/enterprise/BATCH_REVIEW.md'));
assert.ok(prepReview.rules.some(r=>r.next===pr.nextStepAfterApproval));

// Iteration20: explicit bounded acceptance; never derive exclusions from TAP.
const scope=pr.acceptanceScope;
assert.equal(scope.schemaVersion,2);assert.equal(scope.profileId,'P0-source-provenance-v3');assert.equal(scope.componentId,'P0-source-provenance');
assert.equal(scope.parentIncrement,'P0');assert.equal(scope.status,'PRODUCER_CONTAINMENT_REVISION_PENDING');
assert.equal(scope.contract,'work/enterprise/PREPARATION_ACCEPTANCE.md');assert.equal(scope.meaning,'CUMULATIVE_SOURCE_RECOVERY_AND_PROSPECTIVE_CONTAINMENT_ONLY');
assert.ok(plan.sourceSnapshots.some(r=>r.path===scope.contract));
const scopeText=readFileSync(resolve(root,scope.contract),'utf8');
const routeSuitePaths=pr.fullRegressionCommand.filter(x=>x.endsWith('.test.mjs'));
const fullObligations=[...new Set([...plan.issues.flatMap(i=>i.suites).filter(s=>routeSuitePaths.includes(s.path)).flatMap(s=>s.requiredAssertions),...pr.caseIds])];
assert.equal(fullObligations.length,194);assert.deepEqual(scope.fullObligations,fullObligations);
const classification=['runtime-continuation-subprocess-nonzero-preserved','runtime-continuation-exit-zero-missing-assertion-preserved','runtime-continuation-failed-without-reproducible-cause-rejected'];
const retainedExpected=delivery.workPackages.slice(0,3).flatMap(w=>w.requiredAssertions.filter(n=>!classification.includes(n)).map(assertion=>({assertion,owner:w.id,dependsOn:w.dependsOn,requiredAt:[w.id,'R4','B00_FULL_PRODUCT_GATE']})));
assert.equal(retainedExpected.length,29);assert.equal(scope.retainedObligations.length,29);
for(const [i,r] of scope.retainedObligations.entries()){
 const e=retainedExpected[i];for(const k of ['assertion','owner','dependsOn','requiredAt'])assert.deepEqual(r[k],e[k],'retained obligation '+k);
 assert.equal(r.disposition,'REQUIRED_NOT_ACCEPTED');assert.equal(r.sourceSuite,'rejected-regeneration-regressions');assert.ok(r.reason.length>40);assert.ok(scopeText.includes(r.assertion));
 assert.ok(recovery.requiredAssertions.includes(r.assertion),'original regeneration obligation removed');
}
const retained=scope.retainedObligations.map(x=>x.assertion);
assert.deepEqual(scope.requiredAssertions,fullObligations.filter(x=>!retained.includes(x)));
assert.equal(scope.requiredAssertions.length,165);assert.equal(new Set([...scope.requiredAssertions,...retained]).size,194);
assert.deepEqual(scope.requiredControlAssertions,["O1-O5 owned cli", "O1-O5 owned main", "O1-O5 owned runBatchGate", "O2-O5 batch rejects foreign", "O2-O5 batch rejects missing", "O2-O5 batch rejects malformed", "O2-O5 batch rejects project", "O2-O5 batch rejects workflowRef", "O2-O5 batch rejects bundleDigest", "O2-O5 batch rejects absent", "O2-O5 all rejects foreign", "O2-O5 all rejects missing", "O2-O5 all rejects malformed", "O2-O5 all rejects project", "O2-O5 all rejects workflowRef", "O2-O5 all rejects bundleDigest", "O2-O5 all rejects absent", "O2-O5 main rejects foreign", "O2-O5 main rejects missing", "O2-O5 main rejects malformed", "O2-O5 main rejects project", "O2-O5 main rejects workflowRef", "O2-O5 main rejects bundleDigest", "O2-O5 main rejects absent", "O2-O5 runBatchGate rejects foreign", "O2-O5 runBatchGate rejects missing", "O2-O5 runBatchGate rejects malformed", "O2-O5 runBatchGate rejects project", "O2-O5 runBatchGate rejects workflowRef", "O2-O5 runBatchGate rejects bundleDigest", "O2-O5 runBatchGate rejects absent", "O4 supplied session main", "O4 supplied session runBatchGate", "O5 caller capability cannot bypass wrapper", "O4 wrong step", "O4 missing session", "O2 foreign successor before selection", "O6 lock collision preserves owner", "O6 changed progress at lock acquisition refuses before receipts", "O6 changed plan at lock acquisition refuses before receipts", "O6 changed input at lock acquisition refuses before receipts", "O6 changed authority at lock acquisition refuses before receipts", "O7 suite mutation retains evidence without progress or candidate publication", "SP3 removed public writer cannot accept forged authority", "SP2 approval progress", "SP2 approval plan", "SP2 approval input", "SP2 approval authority", "SP2 no-prior-approval progress", "SP2 no-prior-approval plan", "SP2 no-prior-approval input", "SP2 no-prior-approval authority", "SP6 concurrent release-index", "SP6 concurrent run-index", "SP6 concurrent lock", "SP4 before-stage", "SP4 after-stage", "SP4 before-terminal", "SP4 post-terminal", "SP5 process killed running", "SP5 process killed staged", "SP5 process killed durable-before-unlock", "SP7 retained fence failure-record", "SP7 retained fence passed-write", "SP7 retained fence failure-cas", "SP4 post-commit progress", "SP4 post-commit unlock", "SP4 post-commit unlock-sync", "SP3 read-only candidate is never final success", "SP6 completed unlock never inspects the next writer lock", "SP1 response loss after durable unlock remains committed", "batch transition retains exact predecessor review receipts and executes only active batch", "batch transition rejects latest predecessor failed without fallback or active execution", "batch transition rejects latest predecessor running without fallback or active execution", "batch transition rejects predecessor stdout change before active execution", "batch transition rejects predecessor artifacts change before active execution", "validate-only batch transition does not create or replace receipts", "batch transition reruns stale source predecessors and binds both receipts to new inputs", "source change cannot hide tampered predecessor output or start active execution", "ordinary-writer-owned-entry-boundaries", "ordinary-writer-seal-rechecks-projection-before-publication", "seal-publication-attempt-failure-boundary"]);
assert.deepEqual(scope.caseIds,Array.from({length:12},(_,i)=>'AS'+(i+1)));
assert.deepEqual(scope.acceptanceCases.map(c=>c.id),scope.caseIds);for(const c of scope.acceptanceCases){assert.ok(c.acceptance.length>40);assert.ok(scopeText.includes(c.id+': '+c.acceptance));}
assert.deepEqual(scope.reviewedCaseIds,[...ownership.caseIds,...publication.acceptanceCases.map(c=>c.id),...pr.caseIds,...scope.caseIds,...scope.failureHistoryCaseIds,...scope.sourceProvenanceCaseIds,...scope.recoveryCaseIds,...scope.producerContainmentCaseIds]);
assert.deepEqual(scope.acceptedComponents,['P0-control','P0-source-provenance']);
for(const k of ['fullCommandRequired','anyExecutedFailureRefuses','fullProductAssertionsUnchanged','freshCaptureRequired','cumulativeControlsRequired'])assert.equal(scope[k],true,k);
for(const k of ['automaticSelectionFromTap','callerExclusionsAllowed','oldFailedAttemptPromotionAllowed','parentIncrementCompleted','historyVerified','productVerified'])assert.equal(scope[k],false,k);
assert.deepEqual(scope.schemaVersions,{request:3,receipt:3,candidate:3,review:4,acceptance:3,journal:1});
assert.deepEqual(scope.bindingFields,['profileId','version','definitionSha256','mandatoryDigest','retainedObligationsDigest','failureHistoryDefinitionDigest']);
assert.equal(scope.legacyDisposition,'PRESERVE_ORIGINAL_DEFINITIONS_AND_FAILURES_REJECT_CURRENT_USE');
assert.equal(scope.failedAttempt.attempt,1);
for(const r of [scope.failedAttempt,scope.previousValidation,scope.historicalHandoff])assert.equal(hash(readFileSync(resolve(root,r.path))),r.sha256,'historical capture bytes changed');
const failedJournal=read(scope.failedAttempt.path);assert.deepEqual(failedJournal.events.map(e=>e.status),['RUNNING','FAILED']);
const validation19=read(scope.previousValidation.path);assert.equal(validation19.captureStatus,'FAILED_REQUIRED_ASSERTIONS_MISSING');assert.equal(validation19.capture.exitCode,1);assert.equal(validation19.execution.exitCode,0);
assert.deepEqual(validation19.missingMandatoryAssertions.toSorted(),retained.toSorted());
assert.deepEqual(validation19.testTotals,{tests:1146,passed:1146,failed:0,cancelled:0,skipped:0,todo:0});
const scopeCorrection=plan.revisionHistory.preparationAcceptanceCorrection;
assert.equal(scopeCorrection.iteration,20);assert.equal(scopeCorrection.currentIndependentApproval,null);assert.equal(scopeCorrection.entrySnapshot,'evidence/enterprise/design-history/run-20261024121802-iteration20-entry/manifest.json');
assert.equal(scopeCorrection.historicalPreparationApproval.iteration,18);assert.equal(scopeCorrection.historicalPreparationApproval.currentAuthority,false);
assert.equal(hash(readFileSync(resolve(root,scopeCorrection.historicalPreparationApproval.path))),scopeCorrection.historicalPreparationApproval.sha256);

// Iteration25: complete preparation failure prefix; structure only, no runtime authority.
const fh=pr.failureHistory;
assert.equal(fh.schemaVersion,1);assert.equal(fh.finding,'RF-P0-01');assert.equal(fh.status,'PLANNED_PENDING_INDEPENDENT_REVIEW');
assert.equal(fh.contract,'work/enterprise/PREPARATION_FAILURE_HISTORY.md');assert.equal(fh.ownerIssue,'ENT-101');assert.equal(fh.componentId,'P0-control');
assert.deepEqual(fh.legacyAttempts,[1,2,3]);assert.equal(fh.nextAttemptMinimum,4);
assert.equal(fh.checkpointMeaning,'CURRENT_ASSESSMENT_NOT_CONTEMPORANEOUS_MANIFEST');
assert.deepEqual(fh.validatorConsumers,['capture','gate','candidate','review','import']);
assert.equal(fh.eventFormatVersion,2);assert.equal(fh.startDescriptorSchemaVersion,1);assert.equal(fh.failureManifestSchemaVersion,1);
assert.equal(fh.closureEncoding,'SHA256_UTF8_JSON_STRINGIFY_ORDERED_ARRAY_V1');
assert.deepEqual(fh.bindingFields,['checkpointSha256','priorClosure','startDescriptorSha256']);assert.deepEqual(fh.headFields,['attempt','terminalClosure']);
for(const k of ['preserveOriginalBytes','validateEveryAttempt','diagnosticAndOutputInventoryRequired','validateOwnFrozenDefinitions','freshCaptureRequired','failureBeforeTerminal','beforeAfterAwaitChecks','retainOwnedFenceOnFailure','legacyIndependentAuthorityRequired','fixedEngineRetestRequired','noHashCycles'])assert.equal(fh[k],true,k);
for(const k of ['inferHistoricalAbsence','rewriteOldFailure','callerCheckpointAuthority','automaticFenceRecovery','legacyCandidateReuse','deferFindingToR1','productVerified','completeH','migrationAuthority'])assert.equal(fh[k],false,k);
assert.deepEqual(fh.implementationPaths,pr.implementationPaths);assert.deepEqual(fh.assertionOwners,pr.assertionOwners);assert.deepEqual(fh.fullRegressionCommand,pr.fullRegressionCommand);
assert.deepEqual(fh.caseIds,Array.from({length:12},(_,i)=>'FH'+(i+1)));assert.deepEqual(scope.failureHistoryCaseIds,fh.caseIds);
assert.equal(new Set([...scope.requiredAssertions,...scope.requiredControlAssertions,...scope.caseIds,...fh.caseIds]).size,271);
assert.deepEqual(fh.acceptanceCases.map(c=>c.id),fh.caseIds);const fhText=readFileSync(resolve(root,fh.contract),'utf8');
for(const c of fh.acceptanceCases){assert.ok(c.acceptance.length>70);assert.ok(fhText.includes(c.id+': '+c.acceptance));}
assert.ok(plan.sourceSnapshots.some(r=>r.path===fh.contract));
for(const r of [fh.checkpoint,fh.historicalApproval,fh.rejection])assert.equal(hash(readFileSync(resolve(root,r.path))),r.sha256,'failure-history source changed');
assert.equal(fh.historicalApproval.iteration,21);assert.equal(fh.historicalApproval.currentAuthority,false);assert.equal(fh.rejection.iteration,23);assert.equal(fh.rejection.verdict,'REQUEST_CHANGES');assert.equal(fh.rejection.finding,'RF-P0-01');
const hc=read(fh.checkpoint.path);assert.equal(hc.schemaVersion,1);assert.equal(hc.kind,'PREPARATION_LEGACY_PREFIX_ASSESSMENT');assert.equal(hc.observedAtIteration,25);assert.equal(hc.runSlug,prep.runSlug);assert.deepEqual(hc.attempts,fh.legacyAttempts);assert.equal(hc.status,'PENDING_INDEPENDENT_DESIGN_REVIEW');
assert.equal(hc.meaning,'CURRENT_ASSESSMENT_OF_PRESERVED_BYTES_NOT_CONTEMPORANEOUS_FAILURE_MANIFEST');
for(const k of ['historicalAbsenceProven','producerOriginProven','productVerified','completeH'])assert.equal(hc[k],false,k);
assert.equal(hc.inventory.length,892);assert.equal(new Set(hc.inventory.map(r=>r.path)).size,hc.inventory.length);
for(const r of [...hc.inventory,hc.journal,hc.request,hc.review,hc.originalDesignApproval,hc.historicalHandoff,hc.reassessment]){
 const original=readFileSync(resolve(root,r.path));
 // The adopted legacy checkpoint explicitly froze the two appendable pointers.
 // No generic missing-evidence fallback or expected-hash replacement is allowed.
 const preserved=r.path===pr.namespace+'journal.json'?hc.journal:r.path===pr.namespace+'request.json'?hc.request:null;
 const b=hash(original)===r.sha256?original:preserved&&preserved.sha256===r.sha256?readFileSync(resolve(root,preserved.path)):original;
 assert.equal(hash(b),r.sha256,r.path);assert.equal(b.length,r.bytes);
}
const h22=read(hc.historicalHandoff.path);for(const r of hc.inventory)assert.ok(h22.references.some(e=>e.path===r.path&&e.sha256===r.sha256&&e.bytes===r.bytes),'checkpoint was not in historical handoff');
const legacyJournal=read(hc.journal.path);assert.deepEqual(legacyJournal.events.map(e=>e.status),['RUNNING','FAILED','RUNNING','FAILED','RUNNING','PASSED']);assert.deepEqual(legacyJournal.events.slice(0,2),failedJournal.events);
assert.deepEqual(hc.dispositions.map(e=>e.terminal),['FAILED','FAILED','PASSED']);assert.equal(hc.dispositions[1].cause,'INPUTS_CHANGED');assert.equal(hc.dispositions[1].subprocessExit,1);assert.equal(hc.dispositions[2].independentDecision,'REQUEST_CHANGES');assert.equal(hc.dispositions[2].accepted,false);
assert.equal(hc.review.sha256,fh.rejection.sha256);assert.equal(hc.originalDesignApproval.sha256,fh.historicalApproval.sha256);
const fhr=plan.revisionHistory.preparationFailureHistoryCorrection;assert.equal(fhr.iteration,25);assert.equal(fhr.finding,'RF-P0-01');assert.equal(fhr.currentIndependentApproval,null);assert.equal(fhr.entrySnapshot,'evidence/enterprise/design-history/run-20261024121802-iteration25-entry/manifest.json');assert.deepEqual(fhr.historicalPreparationApproval,fh.historicalApproval);assert.deepEqual(fhr.rejection,fh.rejection);assert.equal(hash(readFileSync(resolve(root,fhr.proposal.path))),fhr.proposal.sha256);

// Iteration32: source adapter contract only; historical component approval is not current authority.
const source=scope.sourceProvenanceDefinition;
assert.equal(source.schemaVersion,1);assert.equal(source.status,'IMPLEMENTED_NOT_INDEPENDENTLY_ACCEPTED_CAPTURE_FENCED');
assert.equal(source.contract,'work/enterprise/PREPARATION_SOURCE_PROVENANCE.md');assert.equal(source.ownerIssue,'ENT-101');
assert.equal(source.componentId,scope.componentId);assert.equal(source.profileId,scope.profileId);assert.equal(source.sourceRunSlug,prep.sourceRunSlug);
assert.equal(source.authority,'REAL_P_A_P_THEN_PRIVATE_DATA_ONLY_SOURCE_RECORDS');
assert.equal(source.sessionAuthority,'SAVED_PRODUCER_BOUND_OCCURRENCE_RECORDS_NOT_CURRENT_STORE');
assert.equal(source.assessmentKind,'SOURCE_PROVENANCE_ASSESSMENT');assert.equal(source.assessmentSchemaVersion,1);
assert.equal(source.actualSourceAcceptance,'AUTHENTICATED_OR_EXPLICIT_UNPROVEN_NEVER_FIXTURE_PROMOTION');
assert.deepEqual(source.validatorConsumers,['capture','gate','candidate','review','import']);
assert.deepEqual(source.implementationPaths,['scripts/enterprise/runtime-preparation.mjs','scripts/enterprise/runtime-history.mjs','tests/enterprise/continuation-v4.test.mjs','tests/enterprise/rejected-regeneration.test.mjs','tests/enterprise/finalization.test.mjs','tests/enterprise/evidence-fixture.mjs']);
for(const path of source.implementationPaths)assert.ok(prep.permittedPaths.includes(path),'source adapter path outside review');
assert.deepEqual(source.assertionOwners,prep.subcaseAssertions);assert.deepEqual(source.fullRegressionCommand,pr.fullRegressionCommand);
assert.deepEqual(source.sourceCheckpoint,prep.sourceCheckpoint);assert.equal(source.nextAttemptMinimum,8);
for(const k of ['freshIndependentApproval','immutablePredecessorRequired','validateOldFrozenProfiles','preserveAllAttempts','realSourceAssessmentRequired','allOccurrenceCoverage','originalDefinitionsRequired','sourceGuardUnchanged','beforeAfterAwaitChecks','cumulativeControlsRequired','fixedEngineRetestRequired'])assert.equal(source[k],true,k);
for(const k of ['callerContextAuthority','currentSessionStoreAsSourceProof','oldModuleExecution','networkRecovery','runtimeInstallation','fixtureAuthorityInProduction','completeH','productVerified','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority','retainedObligationCompletion'])assert.equal(source[k],false,k);
assert.deepEqual(source.caseIds,Array.from({length:12},(_,i)=>'SA'+(i+1)));assert.deepEqual(scope.sourceProvenanceCaseIds,source.caseIds);
assert.equal(new Set([...scope.requiredAssertions,...scope.requiredControlAssertions,...scope.caseIds,...scope.failureHistoryCaseIds,...scope.sourceProvenanceCaseIds,...scope.recoveryCaseIds]).size,295);
assert.deepEqual(source.acceptanceCases.map(c=>c.id),source.caseIds);const sourceText=readFileSync(resolve(root,source.contract),'utf8');
for(const c of source.acceptanceCases){assert.ok(c.acceptance.length>70);assert.ok(sourceText.includes(c.id+': '+c.acceptance));}
assert.ok(plan.sourceSnapshots.some(r=>r.path===source.contract));
for(const r of [source.predecessor,source.sourceMeta,source.sourceLog]){const b=readFileSync(resolve(root,r.path));assert.equal(hash(b),r.sha256);assert.equal(b.length,r.bytes);}
const anchor=read(source.predecessor.path);assert.equal(anchor.kind,'PREPARATION_ACCEPTED_COMPONENT_ANCHOR');assert.equal(anchor.observedAtIteration,32);assert.equal(anchor.runSlug,prep.runSlug);assert.equal(anchor.reviewIteration,30);assert.equal(anchor.importIteration,31);assert.equal(anchor.attempt,6);
assert.deepEqual(anchor.acceptedComponents,['P0-control']);assert.equal(anchor.currentAuthority,false);assert.equal(anchor.productVerified,false);
assert.equal(anchor.reportSha256,'61d93df1fff236870fa2a01d1c3ae5afad4b28781cfd1c69f48be020c8ef7821');assert.equal(anchor.references.length,6);
for(const r of [...anchor.references,anchor.handoff]){const b=readFileSync(resolve(root,r.path));assert.equal(hash(b),r.sha256);assert.equal(b.length,r.bytes);}
const oldLedger=read(anchor.references.find(r=>r.originalPath.endsWith('/acceptances.json')).path);assert.equal(oldLedger.acceptances.length,1);
const accepted=oldLedger.acceptances[0];assert.equal(accepted.reportSha256,anchor.reportSha256);assert.equal(accepted.attestation.verdict,'APPROVE');assert.deepEqual(accepted.attestation.acceptedComponents,['P0-control']);assert.deepEqual(accepted.attestation.approvedIssueIds,[]);assert.equal(accepted.productVerified,false);assert.deepEqual(accepted.historyHead,anchor.historyHead);
const oldScope=read(anchor.references.find(r=>r.originalPath.endsWith('/scope.json')).path);assert.equal(oldScope.profileId,'P0-control-v2');
for(const key of ['requiredAssertions','requiredControlAssertions','caseIds','failureHistoryCaseIds','retainedObligations','schemaVersions','bindingFields'])assert.deepEqual(scope[key],oldScope[key],'cumulative source profile changed '+key);
const sourceCorrection=plan.revisionHistory.sourceProvenanceCorrection;assert.equal(sourceCorrection.iteration,32);assert.equal(sourceCorrection.currentIndependentApproval,null);assert.equal(sourceCorrection.entrySnapshot,'evidence/enterprise/design-history/run-20261024121802-iteration32-entry/manifest.json');assert.deepEqual(sourceCorrection.predecessor,source.predecessor);assert.equal(sourceCorrection.retainedObligationsAccepted,false);
assert.equal(hash(readFileSync(resolve(root,sourceCorrection.proposal.path))),sourceCorrection.proposal.sha256);

// Iteration36: explicit recovery contract only; actual incomplete capture remains fenced.
const cr=scope.captureRecoveryDefinition;
assert.equal(cr.schemaVersion,1);assert.equal(cr.status,'PLANNED_PENDING_INDEPENDENT_REVIEW');
assert.equal(cr.contract,'work/enterprise/PREPARATION_CAPTURE_RECOVERY.md');assert.equal(cr.profileId,scope.profileId);
assert.equal(cr.authority,'FRESH_REAL_P_A_P_EXACT_INCOMPLETE_TAIL_ONLY');assert.equal(cr.entry,'--recover-preparation-capture');
assert.equal(cr.terminal,'RECOVERED_ABORTED');assert.equal(cr.terminalEventFormatVersion,3);assert.equal(cr.ordinaryEventFormatVersion,2);
assert.equal(cr.quiescence,'PRESENT_COMPLETE_SCOPED_PRODUCER_COVERAGE_AND_ADMISSION_EXCLUSION');assert.equal(cr.actualQuiescence,'UNPROVEN');
assert.equal(cr.storage,'PREPARATION_RECOVERIES_AND_APPEND_ONLY_RECOVERY_JOURNAL');assert.equal(cr.closureDomain,'PREP_HISTORY_RECOVERY_V1');
assert.equal(cr.missingEvidenceDisposition,'UNKNOWN_AT_FAILURE_OR_ABSENT_AT_RECOVERY_OBSERVATION');
assert.deepEqual(cr.phases,['AUTHENTICATED','FENCED','QUIESCENCE_PROVEN','SNAPSHOT_DURABLE','ABORT_COMMITTED','OLD_FENCE_RELEASED','COMPLETE']);
assert.deepEqual(cr.validatorConsumers,['capture','gate','candidate','review','import']);
assert.deepEqual(cr.implementationPaths,['scripts/enterprise/runtime-preparation.mjs','scripts/enterprise/verify.mjs','tests/enterprise/finalization.test.mjs','tests/enterprise/evidence-fixture.mjs']);
for(const p of cr.implementationPaths)assert.ok(prep.permittedPaths.includes(p));
for(const k of ['freshIndependentApproval','preserveOriginalRunning','preserveAllPartialBytes','verifyCompletedOriginalBuilder','realNativeProcessProof','escapedDescendantsCovered','privateRecoveryGuard','sharedAdmissionFence','atomicDurableCASReadback','archiveOriginalFence','allReaderIntegration','beforeAfterAwaitChecks','fixedEngineRetest','freshFullCapture','cumulative295','responseLossReadOnly','retainFenceOnUnknown','futureProducerObservationsBeforeStop'])assert.equal(cr[k],true,k);
for(const k of ['automaticRecovery','forceUnlock','pidAbsenceSufficient','historicalEvidenceBackfill','repackageStandaloneSuccess','latestAbortReady','oldRequestFallback','productWrites','sourceWrites','completeH','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority','acceptedRemainingObligations'])assert.equal(cr[k],false,k);
assert.equal(cr.nextAttemptMinimum,8);assert.deepEqual(cr.fullRegressionCommand,pr.fullRegressionCommand);
assert.deepEqual(cr.caseIds,Array.from({length:12},(_,i)=>'CR'+(i+1)));assert.deepEqual(scope.recoveryCaseIds,cr.caseIds);assert.deepEqual(cr.acceptanceCases.map(c=>c.id),cr.caseIds);
const crt=readFileSync(resolve(root,cr.contract),'utf8');for(const c of cr.acceptanceCases){assert.ok(c.acceptance.length>70);assert.ok(crt.includes(c.id+': '+c.acceptance));}
assert.ok(plan.sourceSnapshots.some(r=>r.path===cr.contract));
const crab=readFileSync(resolve(root,cr.anchor.path));assert.equal(hash(crab),cr.anchor.sha256);assert.equal(crab.length,cr.anchor.bytes);
const cra=JSON.parse(crab);assert.equal(cra.kind,'INCOMPLETE_CAPTURE_RECOVERY_ANCHOR');assert.equal(cra.iteration,36);assert.equal(cra.runSlug,prep.runSlug);assert.equal(cra.attempt,7);assert.equal(cra.originalStatus,'RUNNING');assert.equal(cra.historicalOutcome,'UNKNOWN');
for(const k of ['currentAuthority','quiescenceProven','productVerified'])assert.equal(cra[k],false);
assert.equal(cra.references.length,12);for(const r of [...cra.references,cra.partialInventory,cra.historicalHandoff]){const b=readFileSync(resolve(root,r.path));assert.equal(hash(b),r.sha256);assert.equal(b.length,r.bytes);}
const originalJournal=JSON.parse(readFileSync(resolve(root,cra.references.find(r=>r.originalPath.endsWith('/journal.json')).path)));
assert.equal(originalJournal.schemaVersion,1);assert.equal(originalJournal.events.at(-1).attempt,7);assert.equal(originalJournal.events.at(-1).status,'RUNNING');assert.equal(originalJournal.events.at(-1).builderIteration,35);assert.equal(originalJournal.events.at(-1).eventFormatVersion,2);assert.equal(originalJournal.events.filter(e=>e.status==='RUNNING').length,7);
const crj=plan.revisionHistory.captureRecoveryCorrection;assert.equal(crj.iteration,36);assert.equal(crj.currentIndependentApproval,null);assert.equal(crj.entrySnapshot,'evidence/enterprise/design-history/run-20261024121802-iteration36-entry/manifest.json');assert.deepEqual(crj.anchor,cr.anchor);assert.equal(crj.priorAttemptStatus,'RUNNING');assert.equal(crj.recoveryPerformed,false);assert.equal(crj.retainedObligationsAccepted,false);assert.equal(hash(readFileSync(resolve(root,crj.proposal.path))),crj.proposal.sha256);
assert.deepEqual(cra.absentAtObservation,['execution.json','inputs-after.json','diagnostic.txt','failure.json','receipt.json']);

// Iteration46: enforced prospective membership; no retrospective actual7 proof.
const containment=scope.producerContainmentDefinition;
assert.equal(containment.schemaVersion,1);assert.equal(containment.status,'PLANNED_PENDING_INDEPENDENT_REVIEW');
assert.equal(containment.contract,'work/enterprise/PREPARATION_PRODUCER_CONTAINMENT.md');assert.equal(containment.profileId,scope.profileId);
assert.equal(containment.backend,'LINUX_CGROUP_V2_CLOSED_DOMAIN');assert.equal(containment.port,'PRIVATE_PRODUCER_DOMAIN_PORT');assert.equal(containment.coverage,'ENFORCED_MEMBERSHIP_FROM_BEFORE_WORKLOAD_EXECUTION');
assert.equal(containment.proofKind,'PRODUCTION_DOMAIN_CLOSED');assert.equal(containment.proofSchemaVersion,1);
assert.equal(containment.actualAttempt7,'BLOCKED_ON_COMPLETE_PRODUCER_PROVENANCE');assert.equal(containment.backendAvailability,'UNAVAILABLE_BACKEND');
assert.equal(containment.nativeFailurePolicy,'FAIL_NOT_SKIP_NO_FALLBACK');assert.equal(containment.activation,'SEPARATE_REVIEWED_ENVIRONMENT_AND_REAL_AUTHORITY_REQUIRED');
assert.deepEqual(containment.phases,['PREPARED','ADMITTED','ADMISSION_CLOSED','EMPTY','OUTPUTS_SEALED']);
assert.deepEqual(containment.validatorConsumers,['capture','gate','candidate','review','import']);
assert.deepEqual(containment.implementationPaths,['scripts/enterprise/runtime-preparation.mjs','scripts/enterprise/verify.mjs','scripts/enterprise/preparation-producer-linux.c','tests/enterprise/finalization.test.mjs','tests/enterprise/evidence-fixture.mjs']);
for(const path of containment.implementationPaths)assert.ok(prep.permittedPaths.includes(path),'containment implementation path missing');
assert.deepEqual(containment.fullRegressionCommand,pr.fullRegressionCommand);
for(const k of ["freshIndependentApproval", "beforeExecContainment", "durableAdmission", "denyMigration", "denyExternalWriteDelegation", "privateMountsAndCredentials", "closeInheritedDescriptors", "allDescendantsEnclosed", "protectedSupervisorIdentity", "holdDomainIdentity", "killThenEmpty", "closeSupervisorWriters", "streamingInventory", "sealReadback", "allReaderIntegration", "retainFenceOnUnknown", "realNativePositiveRequired", "cumulative295", "preserveActual7", "preserveOriginalCR"])assert.equal(containment[k],true,k);
for(const k of ["actual7Adoption", "scanProofFallback", "callerProofAuthority", "autoProvision", "remoteDispatch", "privilegedInstall", "fixturePromotion", "productVerified", "completeH", "targetLaunchAuthority", "runtimeReplacementAuthority"])assert.equal(containment[k],false,k);
assert.deepEqual(containment.caseIds,Array.from({length:8},(_,i)=>'PC'+(i+1)));assert.deepEqual(scope.producerContainmentCaseIds,containment.caseIds);
assert.deepEqual(containment.acceptanceCases.map(c=>c.id),containment.caseIds);assert.ok(containment.caseIds.every(id=>scope.reviewedCaseIds.includes(id)));
assert.equal(new Set([...scope.requiredAssertions,...scope.requiredControlAssertions,...scope.caseIds,...scope.failureHistoryCaseIds,...scope.sourceProvenanceCaseIds,...scope.recoveryCaseIds,...scope.producerContainmentCaseIds]).size,303);
const pct=readFileSync(resolve(root,containment.contract),'utf8');for(const c of containment.acceptanceCases){assert.ok(c.acceptance.length>70);assert.ok(pct.includes(c.id+': '+c.acceptance));}
assert.ok(plan.sourceSnapshots.some(r=>r.path===containment.contract));
const pcb=readFileSync(resolve(root,containment.blocker.path));assert.equal(hash(pcb),containment.blocker.sha256);assert.equal(pcb.length,containment.blocker.bytes);
assert.deepEqual(containment.workPackages.map(w=>[w.id,w.dependsOn]),[['C1',['NEW_A_P']],['C2',['C1']],['C3',['C2','AUTHENTICATED_CAPABLE_ENVIRONMENT']]]);
assert.deepEqual(containment.workPackages.map(w=>w.acceptance),[['PC1','PC2','PC3','PC8'],['PC4','PC5','PC6','CR1-CR12'],['PC7','ALL303','ALL_CR_CHILD_CONDITIONS']]);
const pcc=plan.revisionHistory.producerContainmentCorrection;assert.equal(pcc.iteration,46);assert.equal(pcc.entrySnapshot,'evidence/enterprise/design-history/run-20261024121802-iteration46-entry/manifest.json');assert.equal(pcc.currentIndependentApproval,null);assert.deepEqual(pcc.blocker,containment.blocker);assert.deepEqual(pcc.oldRecoveryAnchor,cr.anchor);
for(const k of ['actualRecoveryPerformed','backendActivated','retainedObligationsAccepted'])assert.equal(pcc[k],false);
assert.deepEqual(legacyRuntime.unboundedRemainingEstimate,{nominalTurns:21,projectedTotal:67,overflowBeyondCurrentCap:7,nominalOutsideThisSegment:13,authorizedNewRun:false,completionGuaranteed:false});
assert.equal(legacyRuntime.unboundedRemainingEstimate.projectedTotal,legacyRuntime.previousPreparationBudget.anchorStep+legacyRuntime.unboundedRemainingEstimate.nominalTurns);

// Current-run source work has no capture or predecessor authority; legacy definitions stay P-bound.
const restart=plan.preparationRestart, restartText=readFileSync(resolve(root,restart.contract),'utf8');
assert.equal(restart.schemaVersion,3);assert.equal(restart.runSlug,'20261025111129-b2ae6cb1');
assert.equal(restart.predecessorRunSlug,prep.runSlug);assert.equal(restart.sourceRunSlug,prep.sourceRunSlug);
assert.equal(restart.runtimeVersion,'0.71.0');assert.equal(restart.status,'PENDING_INDEPENDENT_AMENDMENT_REVIEW');
assert.equal(restart.purpose,'PREPARE_CONTAINMENT_COMPONENTS');assert.equal(restart.permission,'IMPLEMENTATION_AND_ISOLATED_REVIEW_ONLY');
assert.equal(restart.attestation,'enterprise-preparation-restart-attestation');assert.equal(restart.guardStatus,'V3_SOURCE_PRESENT_REVIEW_ROUTE_PARTIAL_NOT_ACCEPTED');
assert.equal(restart.entrySnapshot,plan.revisionHistory.currentDesignEntrySnapshot);assert.deepEqual(restart.currentApprovals,[]);
assert.ok(plan.sourceSnapshots.some(s=>s.path===restart.contract));
for(const k of ['captureAuthority','recoveryAuthority','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority','ordinaryBatchAuthority','completeH'])assert.equal(restart[k],false,k);
assert.deepEqual(restart.permittedPaths,['scripts/enterprise/runtime-preparation.mjs','scripts/enterprise/preparation-producer-linux.c','tests/enterprise/rejected-regeneration.test.mjs','tests/enterprise/evidence-fixture.mjs','tests/enterprise/continuation.test.mjs','tests/enterprise/continuation-v4.test.mjs','tests/enterprise/finalization.test.mjs','scripts/enterprise/verify.mjs']);
assert.deepEqual(restart.historicalVersion1.permittedPaths,restart.permittedPaths.slice(0,6));
assert.equal(restart.historicalVersion1.currentAmendmentAuthority,false);
assert.equal(restart.historicalExcludedDispatchPath.path,'scripts/enterprise/verify.mjs');
assert.equal(restart.integrationCasesStatus,'PARTIAL_SOURCE_PRESENT_NOT_INDEPENDENTLY_ACCEPTED');
assert.deepEqual(restart.integrationCases.map(x=>x.id),['QI1','QI2','QI3','QI4','QI5','QI6']);
for(const c of restart.integrationCases)assert.ok(restartText.includes(c.acceptance));
for(const ref of [restart.historicalVersion1.contract,restart.historicalVersion1.review,restart.integrationCheckpoint])assert.equal(hash(readFileSync(resolve(root,ref.path))),ref.sha256);
for(const ref of read(restart.integrationCheckpoint.path).references){const bytes=readFileSync(resolve(root,ref.path));assert.equal(hash(bytes),ref.sha256);assert.equal(bytes.length,ref.bytes);}
assert.deepEqual(restart.integrationMilestones.map(x=>x.id),['I0','I1','I2','I3']);
assert.deepEqual(restart.integrationMilestones[0].dependsOn,['FRESH_CURRENT_SCHEMA3_REVIEW']);
assert.equal(restart.permittedPaths.at(-1),'scripts/enterprise/verify.mjs');
const descriptor=restart.descriptorIntegration;
assert.deepEqual(Object.keys(descriptor).sort(),['schemaVersion','contract','format','maxBytes','fieldCount','integerEncoding','tagOrder','authorityStages','currentTarget','launchAuthority','nativeAcceptance','implementationStatus','ownerIssue','ownerCases','requiredCases','preservePriorAssertions','regressionWitness','milestones'].sort());
assert.equal(descriptor.schemaVersion,1);assert.equal(descriptor.format,'PDESC001');assert.equal(descriptor.maxBytes,65536);assert.equal(descriptor.fieldCount,24);assert.equal(descriptor.integerEncoding,'U64_BE_BIGINT');assert.equal(descriptor.tagOrder,'EXACT_1_TO_24');
assert.deepEqual(descriptor.authorityStages,['DECODED','INTENT_MATCHED','NATIVE_PREGO_VERIFIED']);
assert.equal(descriptor.currentTarget,'I1a');assert.equal(descriptor.launchAuthority,false);assert.equal(descriptor.nativeAcceptance,false);assert.equal(descriptor.implementationStatus,'PLANNED_NOT_IMPLEMENTED');assert.equal(descriptor.ownerIssue,'ENT-101');assert.deepEqual(descriptor.ownerCases,['QI3','QI6']);assert.equal(descriptor.preservePriorAssertions,2146);
assert.deepEqual(descriptor.requiredCases.map(x=>x.id),['DS1','DS2','DS3','DS4','DS5','DS6','DS7','DS8']);
assert.equal(descriptor.contract.path,'work/enterprise/PREPARATION_DESCRIPTOR.md');
for(const ref of [descriptor.contract,descriptor.regressionWitness])assert.equal(hash(readFileSync(resolve(root,ref.path))),ref.sha256);
const descriptorText=readFileSync(resolve(root,descriptor.contract.path),'utf8');
for(const c of descriptor.requiredCases){assert.ok(c.acceptance.length>90);assert.ok(descriptorText.includes(c.acceptance));}
assert.deepEqual(descriptor.milestones.map(x=>x.id),['I1a','I1b']);assert.deepEqual(descriptor.milestones[0].dependsOn,['FRESH_CURRENT_SCHEMA3_REVIEW','I0']);assert.deepEqual(descriptor.milestones[1].dependsOn,['I1a','AUTHENTICATED_AUTHORIZED_PREPROVISIONED_LINUX_BACKEND']);
assert.ok(plan.sourceSnapshots.some(s=>s.path===descriptor.contract.path&&s.sha256===descriptor.contract.sha256));
assert.equal(coverage.executionContext.designIteration,4);
assert.equal(restart.componentReviewAuthority,true);
assert.equal(restart.historicalVersion2.schemaVersion,2);assert.equal(restart.historicalVersion2.proposalApproved,false);assert.equal(restart.historicalVersion2.currentAmendmentAuthority,false);
assert.deepEqual(restart.historicalVersion2.permittedPaths,restart.permittedPaths.slice(0,7));
for(const ref of [restart.historicalVersion2.contract,restart.historicalVersion2.proposalPlan,restart.historicalVersion2.completedReview])assert.equal(hash(readFileSync(resolve(root,ref.path))),ref.sha256);
const q=restart.componentReview;
assert.deepEqual(Object.keys(q).sort(),['schemaVersion','contract','status','scopeId','purpose','permission','reviewSchemaVersion','namespace','gateArgv','gateReadOnly','ordinaryBatchAuthority','nativeAccepted','completeH','acceptedComponents','approvedIssueIds','currentApprovals','requiredCases','retainedPriorAssertions','requiredDescriptorCases','allPriorFailureArtifactsRequired','latestIncompleteRefuses','legacyFallbackAllowed','frozenEngineRequired','postReportPhasesRequired','evidenceCommand','inspectCommand','importCommand','milestones'].sort());
assert.equal(q.schemaVersion,1);assert.equal(q.status,'PLANNED_NOT_IMPLEMENTED');assert.equal(q.scopeId,'Q-I1a-v1');assert.equal(q.purpose,'Q_COMPONENT_IMPLEMENTATION_REVIEW');assert.equal(q.permission,'PORTABLE_COMPONENT_IMPLEMENTATION_ONLY');assert.equal(q.reviewSchemaVersion,5);
assert.equal(q.namespace,restart.diagnosticNamespace+'review-evidence/');assert.deepEqual(q.gateArgv,['batch']);
for(const k of ['gateReadOnly','allPriorFailureArtifactsRequired','latestIncompleteRefuses','frozenEngineRequired','postReportPhasesRequired'])assert.equal(q[k],true,k);
for(const k of ['ordinaryBatchAuthority','nativeAccepted','completeH','legacyFallbackAllowed'])assert.equal(q[k],false,k);
assert.deepEqual(q.acceptedComponents,['Q-I1a']);assert.deepEqual(q.approvedIssueIds,[]);assert.deepEqual(q.currentApprovals,[]);assert.equal(q.retainedPriorAssertions,2146);
assert.deepEqual(q.requiredDescriptorCases,Array.from({length:8},(_,i)=>'DS'+(i+1)));assert.deepEqual(q.requiredCases.map(x=>x.id),Array.from({length:12},(_,i)=>'QV'+(i+1)));
assert.equal(q.contract.path,'work/enterprise/PREPARATION_COMPONENT_REVIEW.md');const qText=readFileSync(resolve(root,q.contract.path),'utf8');assert.equal(hash(qText),q.contract.sha256);assert.ok(plan.sourceSnapshots.some(s=>s.path===q.contract.path&&s.sha256===q.contract.sha256));
for(const c of q.requiredCases){assert.ok(c.acceptance.length>100);assert.ok(qText.includes(c.acceptance));}
assert.deepEqual(q.evidenceCommand,['--prepare-component-review','I1a']);assert.deepEqual(q.inspectCommand,['--inspect-component-review']);assert.deepEqual(q.importCommand,['--import-component-implementation-review','<report>']);
assert.deepEqual(q.milestones.map(m=>[m.id,m.dependsOn]),[['J0',['FRESH_CURRENT_SCHEMA3_REVIEW']],['J1',['J0']],['J2',['J1']]]);
assert.equal(legacyRuntime.boundedContinuation.remainingImplementationReviews,0);
// Iteration41: integrated delivery and frozen condition coverage, not runtime acceptance.
{
const delivery=restart.integrationDelivery;
assert.deepEqual(Object.keys(delivery).sort(),['schemaVersion','iteration','status','scopeId','maxImplementationTurns','partialAcceptanceAllowed','reviewReady','historicalReview','regressionBaseline','failureHistory','reassessment','caseConditions','caseBinding','milestones','onIncomplete'].sort());
assert.equal(delivery.schemaVersion,1);assert.equal(delivery.iteration,53);assert.equal(delivery.status,'PENDING_INDEPENDENT_REASSESSMENT_REVIEW');assert.equal(delivery.scopeId,q.scopeId);assert.equal(delivery.maxImplementationTurns,4);assert.equal(delivery.partialAcceptanceAllowed,false);assert.equal(delivery.reviewReady,false);
const expectedConditions={"DS1": ["independent-fixed-vectors", "js-c-all24-values", "u64-above-2pow53", "intent-without-authority"], "DS2": ["each-missing-duplicate-reordered-unknown-tag", "header-count-flags", "truncation-length-overflow-trailing", "utf8-nul-integer-vector", "inclusive65536-and-overflow-no-effects"], "DS3": ["each-run-project-workflow-bundle-binding", "each-occurrence-session-review-binding", "each-plan-reviewInputs-currentInputs-checkpoint-scope-binding", "invocation-generation-binding", "old-approval-and-self-consistent-fake-expectations"], "DS4": ["executable-argv-env-cwd", "source-build-binary", "host-supervisor", "concrete-policy-finite-limits", "input-output-admission-identities", "duplicate-env-path-resolution-stale-generation"], "DS5": ["constructor-decoder-semantic-reservation-chain", "lock-and-await-change", "admitted-durability-change", "final-check-change", "no-old-publisher-bypass"], "DS6": ["short-go", "primary-and-close-unlock-errors", "persistence-interruption", "duplicate-and-response-loss", "no-direct-child-or-transport-promotion"], "DS7": ["missing-supervisor-backend-policy-membership", "circular-proof-and-retroactive-pid", "p7-s-and-checkpoint-unchanged", "no-public-token-force-launch"], "DS8": ["all-seven-suites-and-prior-occurrences", "actual-guard-js-c-private-integration", "source-input-toolchain-output-provenance", "prior-failures-and-native-exclusions"], "QV1": ["actual-q-schema3-eight-path-positive", "schema1-six-and-schema2-seven-history", "no-design-as-implementation"], "QV2": ["old-approval-run-bundle-session-runtime", "extra-authority-and-wildcards", "mixed-malformed-stale-markers-no-fallback"], "QV3": ["seven-suites-and-retained-multiplicities", "all-ds-qv-child-conditions", "failed-skip-cancel-todo-empty", "copied-history-and-native-promotion-refused"], "QV4": ["input-review-plan-scope-checkpoint-change", "journal-artifact-change-at-await-and-publication", "every-failed-output-and-cause", "scope-map-with-rehashed-missing-child"], "QV5": ["real-process-interruption", "pipe-parent-writer-incompletion", "latest-started-failed-fence", "cas-fsync-rename-readback-failure", "competing-owner-no-auto-unlock"], "QV6": ["gate-and-review-zero-writes-success-and-error", "phase-occurrence-session-candidate-mismatch", "missing-completion-stale-builder", "reviewer-not-builder-impersonation"], "QV7": ["real-loader-bundle-compiler-engine-command", "completed-build-phases-gate-review-return", "failed-gate-no-advance", "distinct-session-and-labeled-model-fixture"], "QV8": ["same-session-model-effort-readonly", "incomplete-different-phases", "canonical-report-tamper", "mixed-schema-and-design-approval"], "QV9": ["request-changes-new-execution-new-review", "explicit-malformed-review-supersession", "later-unfinished-rejected-review", "changed-source-invalidates-with-history"], "QV10": ["dedicated-import-exact-q-i1a", "write-free-identical-retry", "conflicting-occurrence-response-loss", "lock-cas-await-failure-no-projection"], "QV11": ["product-approval-closure-selection-refusal", "recovery-all-seal-final-refusal", "p-preparation-refusal", "direct-batch-ownership-no-verified"], "QV12": ["p-s-central-protected-refs", "native303-and-residual29", "no-h-target-runtime-or-p7-authority", "unavailable-backend-not-native-pass"]};
assert.deepEqual(delivery.caseConditions,expectedConditions);
assert.deepEqual(delivery.caseBinding,{scopeFrozenBeforeRun:true,derivedFromTap:false,independentExpectations:true,numberedPaths:true,completeConditionCoverage:true,allPriorFailedInvocations:true,actualProducerProvenance:true,unreferencedMetadataRejected:true,semanticReviewRequired:true,fixtureAuthorityTransfer:false});
for(const [id,conditions]of Object.entries(expectedConditions)){assert.ok(qText.includes('| '+id+' | '+conditions.join('; ')+' |'));}
for(const key of ['historicalReview','failureHistory','reassessment']){const x=delivery[key],b=readFileSync(resolve(root,x.path));assert.equal(hash(b),x.sha256);assert.equal(b.length,x.bytes);}
assert.equal(delivery.historicalReview.sha256,'941daa49476ecfc1ca4c4cef8ab2ae92c1f023fc7bdb6b0a12b64ed3a35a3fb8');
const rb=delivery.regressionBaseline;assert.deepEqual(Object.keys(rb).sort(),['iteration','validation','tap','assertions','original2146Required','multiplicityRequired','currentPass'].sort());assert.equal(rb.iteration,50);assert.equal(rb.assertions,2642);assert.equal(rb.original2146Required,true);assert.equal(rb.multiplicityRequired,true);assert.equal(rb.currentPass,false);
for(const ref of [rb.validation,rb.tap]){const b=readFileSync(resolve(root,ref.path));assert.equal(hash(b),ref.sha256);assert.equal(b.length,ref.bytes);}
assert.equal(rb.tap.sha256,'59c95ad1c83fc6a0233ef41cdc3e06bc216532bfa95c32bd2df9d4c73bf56d68');
assert.deepEqual(delivery.milestones.map(x=>[x.id,x.dependsOn,x.targetImplementationTurn]),[['M1',['FRESH_CURRENT_SCHEMA3_REVIEW'],2],['M2',['M1'],4],['M3',['M2'],null]]);
for(const m of delivery.milestones)assert.ok(m.doneWhen.length>100);
assert.ok(delivery.onIncomplete.includes('fourth implementation turn'));assert.ok(delivery.onIncomplete.includes('never reduce Q-I1a-v1 or raise60'));
assert.equal(legacyRuntime.currentStep,57);assert.equal(legacyRuntime.nominalSteps,60);assert.equal(legacyRuntime.repairReserve,0);assert.equal(legacyRuntime.remainingNominalSteps,3);
assert.deepEqual(restart.permittedPaths,currentDesignPlan.preparationRestart.permittedPaths);assert.deepEqual(restart.historicalVersion1,currentDesignPlan.preparationRestart.historicalVersion1);assert.deepEqual(restart.historicalVersion2,currentDesignPlan.preparationRestart.historicalVersion2);
assert.deepEqual(plan.revisionHistory.preparationRestart.historicalVersion3Approval,delivery.historicalReview);
}

// Iteration47 publication intent sources: structural checks, not runtime proof.
{
const pi=restart.publicationIntegration;
assert.deepEqual(Object.keys(pi).sort(),["contract", "diagnostic", "diagnosticExecution", "expectedFieldCount", "nativeAccepted", "partialAuthorityFieldCount", "previousDelivery", "publicExploitDemonstrated", "remainingSources", "requirements", "schemaVersion", "status"]);
assert.equal(pi.schemaVersion,1);assert.equal(pi.status,'PENDING_INDEPENDENT_DESIGN_REVIEW');assert.equal(pi.expectedFieldCount,24);assert.equal(pi.partialAuthorityFieldCount,13);assert.equal(pi.publicExploitDemonstrated,false);assert.equal(pi.nativeAccepted,false);
assert.deepEqual(pi.remainingSources,{"invocationId": "Private constructor allocates a fresh invocation ID under Q diagnostic ownership before STARTED; authenticate the actual guard, owner and unique start, never caller-supplied IDs.", "domainGeneration": "Private constructor generates a fresh random generation and binds it durably to that invocation and retained stores. A nonce is intent identity, not native membership or stopped-domain proof.", "command": "Read a frozen private command definition in reviewed permitted source/test inputs: absolute executable bytes, exact argv, finite sorted allowlisted env and sandbox cwd. Resolve/hold the executable and sandbox identities; no ambient PATH or arbitrary caller command.", "hostIdentity": "Hash the exact bounded host observation produced by the authenticated invocation; bind its provenance and limitations. Portable observations cannot authenticate kernel/boot ownership or a native backend; unavailable native proof remains false.", "supervisorIdentity": "Hash the reviewed supervisor intent definition and its invocation binding, independently from descriptor data. This is the expected supervisor definition, not proof of a protected live supervisor; I1b must separately authenticate the actual supervisor and applied policy.", "helperBuild": "Record the actual compiler subprocess, compiler executable digest, exact argv/environment, current helper source digest, exit/signal and closed stdout/stderr. Hash the fixed completed build record, excluding descriptor/future PID/receipt to avoid cycles.", "helperBinary": "Hold and hash the successful build output file independently, with size and file identity; require the helperBuild output reference to match. Compilation alone does not authenticate native policy.", "policy": "Read the reviewed concrete policy and all five positive finite limits from private source definitions; bind the exact policy bytes and compare each limit, never digest-only or limits copied from the descriptor.", "inputInventory": "Enumerate the immutable invocation input copies with sorted paths, raw hashes, sizes and retained identities; independently match authenticated inputs and reject additions/aliases/changes. Exclude generated descriptor and later results from this input inventory.", "outputStore": "Reserve and retain the confined private output directory identity before descriptor creation; bind run/invocation/generation, canonical role/path, device/inode and owner/mode from actual held directory evidence. Recheck no alias or symlink and that it is not a P/S/product store.", "admissionStore": "Reserve a distinct confined admission directory and bind the same actual identity fields independently. It must not alias output, descriptor or protected state; held directory identity is rechecked through publication."});assert.deepEqual(pi.requirements,{"all24IndependentExpectations": true, "singleSemanticAdmissionBoundary": true, "digestOnlyAuthorityAllowed": false, "rawProductionBypassAllowed": false, "legacyFixturesIsolated": true, "retainedDescriptorRequired": true, "recheckBeforeReservation": true, "recheckAfterAdmitted": true, "recheckBeforeGo": true, "primaryAndCleanupErrorsRetained": true, "portableGoIsNativeAuthority": false, "publicFixtureSelectorAllowed": false, "diagnosticFailureRetained": true, "actualCallGraphReviewRequired": true});
assert.equal(pi.contract.path,'work/enterprise/PREPARATION_DESCRIPTOR.md');
for(const k of ['contract','diagnostic','diagnosticExecution','previousDelivery']) {const ref=pi[k];assert.deepEqual(Object.keys(ref).sort(),['bytes','path','sha256']);const b=readFileSync(resolve(root,ref.path));assert.equal(hash(b),ref.sha256);assert.equal(b.length,ref.bytes);}
assert.equal(pi.diagnostic.sha256,'bd157cc59dae322d11df42cd2627be8eb3465a8d6e1b763f51af0b0ee51919b3');assert.equal(pi.diagnosticExecution.sha256,'0f464f1a42953bce583f8d3c3658169959eb30e221efccb374d86c3c38f8a9aa');
const prior=read(pi.previousDelivery.path);assert.deepEqual(prior,read("evidence/enterprise/design-history/run-20261025111129-iteration53-entry/work/enterprise/plan.json"));assert.equal(prior.preparationRestart.integrationDelivery.regressionBaseline.assertions,2571);assert.deepEqual(prior.preparationRestart.integrationDelivery.caseConditions,restart.integrationDelivery.caseConditions);
const text=readFileSync(resolve(root,pi.contract.path),'utf8');for(const [k,v]of Object.entries(pi.remainingSources))assert.ok(text.includes('| '+k+' | '+v+' |'));
for(const word of ['digest-only owner','compile-time test harness','every retained raw/legacy callable route','INTENT_MATCHED alone never','original iteration46 harness/output'])assert.ok(text.includes(word));
}

// Iteration53: structural obligations, not evidence of semantic implementation.
{
const sc=restart.semanticCompletion;
assert.deepEqual(Object.keys(sc).sort(),["contract", "diagnostic", "diagnosticExecution", "historicalFullInputsDigest", "intentMatched", "legacyBoundary", "retainedAssertionCounts", "rules", "schemaVersion", "sourceFieldCount", "status", "writerEntry"]);assert.equal(sc.schemaVersion,1);assert.equal(sc.status,'PENDING_INDEPENDENT_DESIGN_REVIEW');assert.equal(sc.sourceFieldCount,24);assert.equal(sc.intentMatched,false);
assert.deepEqual(sc.rules,{"sourceMatchIsIntent": false, "concreteDefinitionRequired": true, "placeholderAccepted": false, "independentExpectedBeforeDecode": true, "cAll24ComparisonRequired": true, "expectedFromDescriptorAllowed": false, "ownerHeldPrivateBridge": true, "publicAuthorityTokenAllowed": false, "revalidateActualOwnerEachBoundary": true, "normalRawDenialRetained": true, "positiveSemanticControlRequired": true, "portableGoGrantsNative": false, "writerFallbackAllowed": false, "partialAcceptanceAllowed": false});assert.deepEqual(sc.retainedAssertionCounts,[2146,2295,2571,2587,2642]);
assert.equal(sc.historicalFullInputsDigest,'7bcc87129f55a617ed66b25de928307fb9583ca8fe39276597e3efcdb9e4b508');
for(const k of ['contract','diagnostic','diagnosticExecution','writerEntry','legacyBoundary']){const x=sc[k];assert.deepEqual(Object.keys(x).sort(),['bytes','path','sha256']);const b=readFileSync(resolve(root,x.path));assert.equal(hash(b),x.sha256);assert.equal(b.length,x.bytes);}
assert.equal(sc.contract.path,'work/enterprise/PREPARATION_DESCRIPTOR.md');
assert.equal(sc.diagnostic.sha256,'ac0235886fec1d317d20bb3a750ba4d8c96bf59c4aa8eb70876f81e564555543');assert.equal(sc.writerEntry.sha256,'4ef36bf60b60add0dbc76b538df004aefaa58f4dd5317b9c69f70b46991586a4');
const text=readFileSync(resolve(root,sc.contract.path),'utf8');for(const word of ['Definition completeness before comparison','Independent expected records and C comparison','normal-build raw-entry refusal','A stale parent result','sourceBindingsMatched','INTENT_MATCHED is data-level completion only'])assert.ok(text.includes(word));
assert.deepEqual(legacyRuntime.hardHorizon,{"schemaVersion": 1, "lastIteration": 60, "architectureReviewTarget": 58, "implementationRange": [], "independentReviewTarget": null, "importTarget": null, "repairReserve": 0, "earlyReassessmentOnM1Miss": true, "automaticExtensionAllowed": false, "automaticNewRunAllowed": false, "enterpriseCompletionGuaranteed": false});assert.ok(restart.integrationDelivery.onIncomplete.includes('second implementation turn'));
}

assert.equal(restart.diagnosticNamespace,`evidence/enterprise/component-development/${restart.runSlug}/`);
assert.deepEqual(restart.workPackages,['C1','C2']);assert.equal(restart.nativeAcceptance,'C3_REQUIRES_AUTHENTICATED_AUTHORIZED_LINUX_BACKEND');
assert.deepEqual(restart.requiredCases.map(c=>c.id),['QR1','QR2','QR3','QR4','QR5','QR6']);
for(const c of restart.requiredCases){assert.ok(c.acceptance.length>70);assert.ok(restartText.includes(c.acceptance));}
assert.equal(restart.retainedNativeAssertions,303);assert.equal(restart.retainedObligations,29);
assert.equal(restart.ownerIssue,'ENT-101');assert.equal(restart.suiteId,recoverySuite.id);assert.equal(restart.subcasesStatus,'V3_DS_QV_PLANNED_NOT_IMPLEMENTED');assert.ok(recoverySuite.requiredAssertions.includes(restart.assertionOwner));assert.ok(readFileSync(resolve(root,recoverySuite.path),'utf8').includes("test('"+restart.testOwner+"'"));
assert.deepEqual(plan.preparationReview,currentDesignPlan.preparationReview,'retargeted historical preparation definition');
assert.deepEqual(prep,currentDesignPlan.preparationEntry,'historical preparation authority changed');
assert.deepEqual(plan.batches,currentDesignPlan.batches,'batch definitions changed');
assert.deepEqual(plan.issues,currentDesignPlan.issues,'original AC/suite/issue definitions changed');
assert.deepEqual(coverage.businessUseCases,read(currentDesignEntry.entries.find(e=>e.path===plan.coverage).copy).businessUseCases,'business coverage changed');
assert.equal(hash(readFileSync(resolve(root,restart.sourceCheckpoint.path))),restart.sourceCheckpoint.sha256);
const predecessorCheckpoint=read(restart.sourceCheckpoint.path);
assert.equal(predecessorCheckpoint.runSlug,restart.runSlug);assert.equal(predecessorCheckpoint.predecessorRunSlug,prep.runSlug);
assert.equal(predecessorCheckpoint.terminal.iterations,60);assert.equal(predecessorCheckpoint.terminal.reason,'Max steps reached');
for(const k of ['allWritersStopped','hostExclusionProven','completeH','initializationAuthority'])assert.equal(predecessorCheckpoint[k],false);
for(const r of predecessorCheckpoint.references){const b=readFileSync(resolve(root,r.path));assert.equal(hash(b),r.sha256);assert.equal(b.length,r.bytes);assert.equal(hash(readFileSync(resolve(root,r.originalPath))),r.sha256,'predecessor checkpoint drift');}
assert.deepEqual(legacyRuntime.previousPreparationBudget.unboundedRemainingEstimate,legacyRuntime.unboundedRemainingEstimate);
assert.equal(legacyRuntime.previousPreparationBudget.runSlug,prep.runSlug);assert.equal(legacyRuntime.previousPreparationBudget.anchorStep,46);
assert.equal(legacyRuntime.boundedContinuation.budgetAnchorStep,57);
assert.equal(plan.revisionHistory.preparationRestart.currentIndependentApproval,null);
assert.equal(plan.revisionHistory.preparationRestart.predecessorAuthorityTransferred,false);


// Iteration57: a planning blocker must not become implementation authority.
{
 const h=restart.horizonReassessment;
 assert.equal(h.schemaVersion,1);assert.equal(h.iteration,57);assert.equal(h.status,'BLOCKED_ON_ACCEPTANCE_HORIZON');assert.equal(h.scopeId,'Q-I1a-v1');
 assert.equal(h.reason,'M1 missed implementation turn2; no complete candidate or independent implementation acceptance');
 assert.equal(h.remainingSteps,60-legacyRuntime.currentStep);
 assert.deepEqual(h.minimumOrderedOccurrences,['review-architecture','build-foundation','review-foundation','build-foundation:dedicated-import']);
 assert.equal(h.minimumFutureSteps,h.minimumOrderedOccurrences.length);assert.equal(h.earliestCompletionIteration,legacyRuntime.currentStep+h.minimumFutureSteps);assert.equal(h.overflow,h.minimumFutureSteps-h.remainingSteps);assert.ok(h.overflow>0);
 for(const k of ['newImplementationWindow','candidateAllowed','implementationAccepted','productVerified','nativeAccepted','automaticNewRunAllowed'])assert.equal(h[k],false,k);
 for(const k of ['remainingWork','validation','failureHistory','intent','intentExecution','writerEntry']){const r=h[k],b=readFileSync(resolve(root,r.path));assert.equal(hash(b),r.sha256);assert.equal(b.length,r.bytes);}
 const pending=Object.entries(restart.integrationDelivery.caseConditions).flatMap(([caseId,cs])=>cs.map(conditionKey=>({caseId,conditionKey,status:'NOT_ACCEPTED'})));assert.deepEqual(h.conditions,pending);assert.equal(pending.length,85);
 assert.equal(read(h.remainingWork.path).implementationTurn,2);assert.equal(read(h.remainingWork.path).intentMatched,false);assert.equal(read(h.remainingWork.path).reviewReady,false);
 assert.equal(read(h.intentExecution.path).status,1);
 const g=h.regressionBaseline;assert.equal(g.assertions,2715);assert.equal(g.multiplicityAndMeaningRequired,true);assert.equal(g.allPriorFailuresRequired,true);assert.equal(g.currentPass,false);const gb=readFileSync(resolve(root,g.validation.path));assert.equal(hash(gb),g.validation.sha256);assert.equal(gb.length,g.validation.bytes);assert.equal(read(g.validation.path).tap.tests,2715);
 assert.deepEqual(h.nextRequiredActions,["Review current exact blocker/plan without implementation acceptance", "Preserve current inputs, failures, unfinished85 conditions and unimported reviews", "Only under a separately authorized bounded continuation authenticate actual context and fresh independent design; finish M1/M2 before candidate/review/import", "Retain native/history/P7/product obligations; never adopt historical approval as current"]);
 assert.deepEqual(h.previousHorizon,read('evidence/enterprise/design-history/run-20261025111129-iteration57-entry/work/enterprise/plan.json').runtime.hardHorizon);
 assert.deepEqual(legacyRuntime.hardHorizon.implementationRange,[]);assert.equal(legacyRuntime.hardHorizon.independentReviewTarget,null);assert.equal(legacyRuntime.hardHorizon.importTarget,null);
 assert.ok(readFileSync(resolve(root,'work/enterprise/PREPARATION_DESCRIPTOR.md'),'utf8').includes('C need not independently recreate TAKT session authentication'));
}

// R continuation checks are structural, not authority issuance or implementation acceptance.
const rc=plan.componentContinuation, re=read(rc.entrySnapshot);
const rp=read(re.entries.find(e=>e.path==='work/enterprise/plan.json').copy);
assert.deepEqual(plan.historicalRuntime,rp.runtime,'Q runtime history must remain exact');
assert.deepEqual(plan.preparationRestart,rp.preparationRestart,'Q authority proposal must remain historical');
assert.deepEqual(plan.preparationEntry,rp.preparationEntry);assert.deepEqual(plan.preparationReview,rp.preparationReview);
assert.deepEqual(plan.issues,rp.issues);assert.deepEqual(plan.batches,rp.batches);
assert.equal(rc.runSlug,'20261026112309-9d467d09');assert.equal(rc.schemaVersion,4);
assert.equal(rc.scope,'R-I1a-v1');assert.equal(rc.acceptedComponent,'R-I1a');
assert.equal(rc.recordSchemaVersion,2);assert.equal(rc.decisionSchemaVersion,6);
assert.equal(rc.recordPurpose,'R_COMPONENT_IMPLEMENTATION_REVIEW');
assert.equal(rc.permission,'IMPLEMENTATION_AND_ISOLATED_REVIEW_ONLY');assert.equal(rc.status,'PENDING_INDEPENDENT_DESIGN_REVIEW');
assert.deepEqual(rc.currentApprovals,[]);assert.equal(rc.authorityTransferred,false);
assert.equal(rc.componentReviewAuthority,true);
for(const k of ['captureAuthority','recoveryAuthority','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority','productVerified','nativeAccepted','completeH','newCasesExecuted'])assert.equal(rc[k],false,`R authority escalation ${k}`);
assert.deepEqual(rc.permittedPaths,rp.preparationRestart.permittedPaths);assert.equal(rc.permittedPaths.length,8);
assert.deepEqual(rc.caseConditions,rp.preparationRestart.integrationDelivery.caseConditions);
assert.equal(Object.values(rc.caseConditions).flat().length,85);assert.equal(Object.keys(rc.caseConditions).length,20);
assert.deepEqual(rc.regressionCommand,rp.preparationRestart.regressionCommand);
assert.equal(rc.diagnosticNamespace,'evidence/enterprise/component-development/'+rc.runSlug+'/');
const cp=read(rc.predecessorCheckpoint);assert.equal(cp.kind,'READONLY_PREDECESSOR_DATA_NOT_AUTHORITY');assert.equal(cp.runSlug,rc.runSlug);assert.equal(cp.predecessorRunSlug,rc.predecessorRunSlug);assert.deepEqual(cp.currentApprovals,[]);
for(const ref of cp.references){assert.equal(hash(readFileSync(resolve(root,ref.path))),ref.sha256);assert.equal(hash(readFileSync(resolve(root,ref.copy))),ref.sha256);}
for(const k of ['allWritersStopped','hostExclusionProven','completeH'])assert.equal(cp[k],false);
assert.deepEqual(rc.sourceCheckpoint,rp.preparationRestart.sourceCheckpoint);
const qm=read(cp.references.find(e=>e.path.endsWith('/meta.json')).copy);assert.equal(qm.iterations,57);assert.equal(qm.reason,'Workflow aborted by step transition');
assert.equal(checkedRuntime.currentStep,11);assert.equal(checkedRuntime.nominalSteps,18);assert.equal(checkedRuntime.repairReserve,42);assert.equal(checkedRuntime.initialStepLimit,60);assert.equal(checkedRuntime.remainingNominalSteps,7);
assert.equal(checkedRuntime.nominalSteps+checkedRuntime.repairReserve,60);assert.equal(checkedRuntime.currentStep+checkedRuntime.remainingNominalSteps,18);
assert.equal(checkedRuntime.boundedContinuation.currentRun,rc.runSlug);assert.equal(checkedRuntime.boundedContinuation.catalogNominalLowerBound,62);
assert.deepEqual(rc.restartCases,['RC1','RC2','RC3','RC4','RC5','RC6']);
assert.equal(coverage.executionContext.runSlug,rc.runSlug);assert.equal(coverage.executionContext.currentStep,11);assert.deepEqual(coverage.executionContext.currentIndependentApprovals,[]);
assert.ok(plan.sourceSnapshots.some(e=>e.path===rc.contract));
// Occurrence8 explicitly amends deadlines; previous counts/deadlines remain evidence.
const ir=rc.integrationReassessment;
assert.equal(ir.iteration,8);assert.equal(ir.implementationTurnsConsumed,3);
assert.equal(ir.previousM1DueTurn,2);assert.equal(ir.previousM1Status,'MISSED');assert.equal(ir.previousM2DueTurn,4);
assert.equal(ir.countReset,false);assert.equal(ir.deadlineAmendment,'PROPOSED_REQUIRES_NEW_INDEPENDENT_REVIEW');
assert.deepEqual(ir.prospectiveCumulativeTurns,[4,5]);assert.equal(ir.M1DueCumulativeTurn,4);assert.equal(ir.M2DueCumulativeTurn,5);
assert.equal(ir.onMiss,'IMMEDIATE_REASSESSMENT_WITH_EXACT_FAILURES');assert.equal(ir.currentApproval,null);
for(const k of ['candidateAllowedBeforeCompleteM2','guardComplete','semanticOwnerComplete','writerComplete','freshRegressionComplete'])assert.equal(ir[k],false,k);
assert.equal(ir.conditionStatus,'NOT_ACCEPTED');assert.equal(ir.bootstrap,'COMPLETED_CURRENT_REVIEW_AND_READONLY_CONTEXT_BEFORE_FIRST_EDIT');
assert.equal(ir.scopeBinding,'R_TYPED_PRIVATE_AUTHORITY_NO_Q_IMPERSONATION');
assert.equal(ir.profileEvidence,'VALIDATED_NON_SECRET_PROJECTION_DISTINCT_FROM_ACTUAL_OPTIONS');
assert.equal(checkedRuntime.boundedContinuation.preparationTurns,4);
assert.equal(checkedRuntime.remainingNominalSteps,checkedRuntime.boundedContinuation.remainingArchitectureReviews+checkedRuntime.boundedContinuation.preparationTurns+checkedRuntime.boundedContinuation.remainingDesignTurns+checkedRuntime.boundedContinuation.remainingImplementationReviews);
const irRaw=readFileSync(resolve(root,ir.checkpoint.path));assert.equal(hash(irRaw),ir.checkpoint.sha256);assert.equal(irRaw.length,ir.checkpoint.bytes);
const ic=JSON.parse(irRaw);assert.equal(ic.schemaVersion,1);assert.equal(ic.kind,'INTEGRATION_REASSESSMENT_DATA_NOT_AUTHORITY');assert.equal(ic.runSlug,rc.runSlug);assert.equal(ic.iteration,8);assert.equal(ic.entrySnapshot,ir.entrySnapshot);
assert.equal(ic.implementationTurnsConsumed,3);assert.deepEqual(ic.missedMilestone,{name:'M1',dueCumulativeTurn:2,status:'MISSED'});
for(const k of ['existingGuardComplete','semanticRouteImplemented','writerImplemented','implementationAccepted','productVerified'])assert.equal(ic[k],false,k);
assert.deepEqual(ic.previousReassessment,rc.reassessment);
const ps=ic.profileSource;assert.equal(ps.kind,'NON_SECRET_PROFILE_SOURCE_BINDING_NOT_ACTIVATION');assert.equal(ps.profile,'takt-fast');assert.equal(ps.activationProven,false);
assert.deepEqual(ps.projection,{service_tier:'fast',features:{fast_mode:true}});
// R's provider source is historical; U binds its own actual project config/options.
if(!successor){const profileSourceRaw8=readFileSync(ps.path),profileSourceStat8=statSync(ps.path);assert.equal(hash(profileSourceRaw8),ps.sha256);assert.equal(profileSourceRaw8.length,ps.bytes);assert.deepEqual(ps.identity,{device:profileSourceStat8.dev,inode:profileSourceStat8.ino});}

const ie=read(ir.entrySnapshot);assert.equal(ie.runSlug,rc.runSlug);assert.equal(new Set(ic.references.map(e=>e.path)).size,ic.references.length);
for(const ref of ic.references){assert.deepEqual(ref,ie.entries.find(e=>e.path===ref.path));const raw=readFileSync(resolve(root,ref.copy));assert.equal(hash(raw),ref.sha256);assert.equal(raw.length,ref.bytes);if(ref.path.includes('/iteration7/'))assert.deepEqual(raw,readFileSync(resolve(root,ref.path)));}
const priorPlan=read(ie.entries.find(e=>e.path==='work/enterprise/plan.json').copy);
assert.deepEqual(rc.milestones,priorPlan.componentContinuation.milestones);assert.deepEqual(rc.reassessment,priorPlan.componentContinuation.reassessment);
assert.deepEqual(ic.conditions,Object.entries(rc.caseConditions).flatMap(([id,cs])=>cs.map(condition=>({id,condition,status:'NOT_ACCEPTED'}))));
const priorAssessment=read('evidence/enterprise/component-development/'+rc.runSlug+'/iteration7/assessment.json');
assert.equal(priorAssessment.implementationTurnsConsumed,3);assert.equal(priorAssessment.existingGuardIncomplete,true);assert.equal(priorAssessment.semanticExit,1);assert.equal(priorAssessment.writerExit,1);
for(const path of ['work/enterprise/plan.json','work/enterprise/COMPONENT_CONTINUATION.md','scripts/enterprise/runtime-preparation.mjs','scripts/enterprise/preparation-producer-linux.c','.takt/config.yaml','evidence/enterprise/component-development/'+rc.runSlug+'/iteration7/assessment.json'])assert.ok(ic.references.some(r=>r.path===path),'missing integration anchor '+path);
// Occurrence11: plan-bound delivery data; existing checkpoint schemas are immutable.
const delivery11=rc.deliveryAmendment;
assert.equal(delivery11.iteration,11);assert.equal(delivery11.status,'PROPOSED_REQUIRES_NEW_INDEPENDENT_REVIEW');
assert.equal(delivery11.implementationTurnsConsumed,4);assert.deepEqual(delivery11.missedM1Deadlines,[2,4]);
assert.deepEqual(delivery11.prospectiveCumulativeTurns,[5,6,7,8]);assert.equal(delivery11.M1DueCumulativeTurn,6);assert.equal(delivery11.M2DueCumulativeTurn,8);
assert.equal(delivery11.countReset,false);assert.equal(delivery11.currentApproval,null);assert.equal(delivery11.conditionStatus,'NOT_ACCEPTED');
assert.equal(delivery11.onMiss,'IMMEDIATE_REASSESSMENT_WITH_EXACT_FAILURES');
for(const k of ['candidateAllowedBeforeCompleteM2','newGuardCheckpointKind','independentImplementationAccepted','productVerified','nativeAccepted'])assert.equal(delivery11[k],false,'delivery11 '+k);
assert.equal(delivery11.authorityBinding,'CURRENT_REVIEW_RAW_PLAN_AND_CONTRACT; RETAIN_OCCURRENCE4_AND8_CHECKPOINTS');
assert.equal(delivery11.scopeDefinition,'UNCHANGED_OCCURRENCE8_R_PROJECTION_PLUS_EXISTING_PLAN_DIGEST');
assert.deepEqual(delivery11.bridge,{lifetime:'ONE_RETAINED_C_PROCESS_FROM_COMPARE_THROUGH_PUBLICATION',authority:'PRIVATE_INHERITED_PIPE_AND_HELD_FDS_NOT_JSON',stages:['PRE_RESERVE','POST_RESERVE_LOCK','POST_ADMISSION_LOCK','POST_ADMITTED','PRE_GO'],reauthentication:'REAL_JS_GUARD_THEN_C_HELD_BYTES_IDENTITIES_AND_STATE',replay:'EXACT_STAGE_SEQUENCE_AND_FRESH_CHALLENGE_ONE_USE',frameBoundBytes:4096,abort:'RETAIN_PARTIAL_STATE_AND_UNKNOWN_NO_GO_RETRY',readonlyConsumersSpawn:false,rawFallback:false,wire:'RSP1_FIXED_208_BYTES_BIG_ENDIAN_SEQUENCE_AND_SIX_32_BYTE_BINDINGS'});
assert.deepEqual(delivery11.fixture,{purpose:'WAITING_PROTOCOL_CHILD_ONLY',profile:'R_HOST_PROTOCOL_V1',definition:'FIXED_SOURCE_OWNED_BEFORE_DESCRIPTOR_DECODE',compatibility:'BUILD_FOR_OBSERVED_HOST_AND_CHECK_FORMAT_ARCH_LOADER_DEPENDENCIES',linuxPolicyForDarwinExecutable:false,nativeAuthority:false,publicLaunchCLI:false});
assert.deepEqual(delivery11.deliverables,[{cumulativeTurn:5,target:'R_PROJECTION_AND_OWNED_BRIDGE_THROUGH_VALIDATED_RESERVATION',acceptance:'INTERNAL_PROGRESS_ONLY'},{cumulativeTurn:6,target:'FULL_M1_PUBLICATION_NORMAL_CONTROL_AND_ALL_STAGE_MUTATIONS',acceptance:'INTERNAL_PROGRESS_ONLY'},{cumulativeTurn:7,target:'R_WRITER_SCOPE_HISTORY_AND_READONLY_CONSUMERS',acceptance:'INTERNAL_PROGRESS_ONLY'},{cumulativeTurn:8,target:'FULL_M2_IMPORT_ENGINE_AND_FRESH_SEVEN_FILE_REGRESSION',acceptance:'CANDIDATE_ONLY_IF_FULL_SCOPE_COMPLETE'}]);
const sized11=ref=>{assert.ok(ref&&typeof ref==='object'&&!Array.isArray(ref),'delivery11 sized reference required');assert.deepEqual(Object.keys(ref).sort(),['bytes','path','sha256']);const b=readFileSync(resolve(root,ref.path));assert.equal(hash(b),ref.sha256);assert.equal(b.length,ref.bytes);return b;};
const ev11=JSON.parse(sized11(delivery11.evidence));assert.equal(ev11.kind,'DESIGN_DELIVERY_OBSERVATION_NOT_AUTHORITY');assert.equal(ev11.runSlug,rc.runSlug);assert.equal(ev11.iteration,11);assert.equal(ev11.implementationTurnsConsumed,4);assert.deepEqual(ev11.missedM1Deadlines,[2,4]);assert.equal(ev11.guardAddedInIteration10,true);
for(const k of ['semanticOwnerComplete','writerComplete','implementationAccepted'])assert.equal(ev11[k],false);
assert.deepEqual(ev11.conditions,Object.entries(rc.caseConditions).flatMap(([id,cs])=>cs.map(condition=>({id,condition,status:'NOT_ACCEPTED'}))));
const entry11=read(ev11.entrySnapshot);assert.equal(entry11.runSlug,rc.runSlug);assert.equal(new Set(ev11.references.map(e=>e.path)).size,ev11.references.length);
for(const e of ev11.references){assert.deepEqual(e,entry11.entries.find(x=>x.path===e.path));const raw=readFileSync(resolve(root,e.copy));assert.equal(hash(raw),e.sha256);assert.equal(raw.length,e.bytes);if(e.path.includes('/iteration10/'))assert.deepEqual(raw,readFileSync(resolve(root,e.path)));}
const previous11=read(entry11.entries.find(e=>e.path==='work/enterprise/plan.json').copy);
for(const k of ['reassessment','integrationReassessment','milestones','caseConditions','restartCases','permittedPaths'])assert.deepEqual(rc[k],previous11.componentContinuation[k],'retained history '+k);
assert.equal(delivery11.retainedRegressionAssertions,2778);sized11(delivery11.retainedRegression);sized11(delivery11.retainedInterruptedExecution);
assert.equal(delivery11.retainedRegression.path,'evidence/enterprise/component-development/'+rc.runSlug+'/iteration10/full-2/stdout.log');
assert.equal(delivery11.retainedInterruptedExecution.path,'evidence/enterprise/component-development/'+rc.runSlug+'/iteration10/full-1/execution.json');
assert.equal(rc.milestoneAuthority,'deliveryAmendment only after fresh independent approval; all prior milestones and integrationReassessment remain exact history');
assert.equal(coverage.executionContext.architectureReview,'PENDING_OCCURRENCE11_RETAINED_OWNER_DESIGN');
console.log(JSON.stringify({kind:'R_CONTINUATION_DESIGN_STRUCTURE_ONLY',runSlug:rc.runSlug,plannedRestartCases:6,executedRestartCases:0,independentApproval:false}));


if(successor){
 const u=successor, repair=plan.runtimeScopeRepair, timing=plan.successorTimingReassessment;
 assert.equal(u.schemaVersion,5);assert.equal(u.runSlug,'20261026190543-01d1feb5');assert.equal(u.predecessorRunSlug,'20261026112309-9d467d09');
 assert.equal(u.contract,'work/enterprise/COMPONENT_SUCCESSOR.md');assert.equal(u.status,'PENDING_U_WRITER_INTEGRATION_REVIEW');
 assert.equal(u.purpose,'PREPARE_CONTAINMENT_COMPONENTS');assert.equal(u.permission,'IMPLEMENTATION_AND_ISOLATED_REVIEW_ONLY');
 assert.equal(u.attestation,'enterprise-preparation-restart-attestation');assert.deepEqual(u.permittedPaths,rc.permittedPaths);assert.equal(u.permittedPaths.length,8);
 assert.deepEqual(plan.componentContinuation,predecessorPlan.componentContinuation,'R proposal retargeted');assert.deepEqual(plan.predecessorRuntime,predecessorPlan.runtime,'R runtime changed');
 assert.deepEqual(plan.issues,predecessorPlan.issues);assert.deepEqual(plan.batches,predecessorPlan.batches);
 assert.deepEqual(u.caseConditions,rc.caseConditions);assert.equal(Object.values(u.caseConditions).flat().length,85);assert.deepEqual(u.regressionCommand,rc.regressionCommand);
 assert.equal(u.scope,'U-I1a-v1');assert.equal(u.acceptedComponent,'U-I1a');assert.equal(u.recordSchemaVersion,3);assert.equal(u.candidateSchemaVersion,3);assert.equal(u.decisionSchemaVersion,7);
 assert.equal(u.recordPurpose,'SUCCESSOR_COMPONENT_IMPLEMENTATION_REVIEW');assert.equal(u.receiptKind,'U_COMPONENT_EVIDENCE');assert.equal(u.gateKind,'U_COMPONENT_REVIEW_READY');
 assert.equal(u.diagnosticNamespace,'evidence/enterprise/component-development/'+u.runSlug+'/');assert.deepEqual(u.restartCases,['U1','U2','U3','U4','U5','U6']);
 assert.deepEqual(u.currentApprovals,[]);assert.equal(u.componentReviewAuthority,true);
 for(const k of ['authorityTransferred','captureAuthority','recoveryAuthority','initializationAuthority','targetLaunchAuthority','runtimeReplacementAuthority','productVerified','nativeAccepted','completeH','newCasesExecuted','implementationAccepted','liveWriterActivated','configurationEditable','profileActivationClaimed'])assert.equal(u[k],false,'U escalation '+k);
 const sized=ref=>{assert.deepEqual(Object.keys(ref).sort(),['bytes','path','sha256']);const b=readFileSync(resolve(root,ref.path));assert.equal(hash(b),ref.sha256);assert.equal(b.length,ref.bytes);return b;};
 const uc=JSON.parse(sized(u.predecessorCheckpoint));assert.equal(uc.kind,'READONLY_PREDECESSOR_DATA_NOT_AUTHORITY');assert.equal(uc.runSlug,u.runSlug);assert.equal(uc.predecessorRunSlug,u.predecessorRunSlug);
 assert.deepEqual(uc.currentApprovals,[]);for(const k of ['allWritersStopped','hostExclusionProven','completeH'])assert.equal(uc[k],false);
 for(const r of uc.references){const b=readFileSync(resolve(root,r.copy));assert.equal(hash(b),r.sha256);assert.equal(b.length,r.bytes);assert.deepEqual(r,successorEntry.entries.find(e=>e.path===r.path));}
 const meta=JSON.parse(readFileSync(resolve(root,uc.references.find(r=>r.path.endsWith('/meta.json')).copy)));
 assert.equal(meta.iterations,16);assert.equal(meta.reason,'Step execution failed: spawnSync git ENOBUFS');
 const phases=JSON.parse(sized(u.predecessorPhase16));assert.equal(phases.length,1);assert.equal(phases[0].phase,1);assert.equal(phases[0].iteration,16);
 assert.deepEqual(u.history,{buildTurnsConsumed:8,M1Misses:[2,4],M2DueTurn:8,M2Status:'MISSED',step16Phase2Complete:false,canonicalImplementationIteration:15,terminalIteration:16,terminalReason:'Step execution failed: spawnSync git ENOBUFS',allWritersStopped:false,hostExclusionProven:false,batchReviewBelongsTo:'20261024121802-56fec935',batchReviewIteration:30});
 assert.deepEqual(u.milestones,{implementationTurnsConsumed:4,maxImplementationTurns:6,D1DueTurn:5,D2DueTurn:6,onMiss:'IMMEDIATE_REASSESSMENT_NO_AUTOMATIC_EXTENSION',historicalCountsReset:false});
 assert.equal(u.configuration.path,'.takt/config.yaml');sized(u.configuration);assert.equal(u.configuration.bytes,134);assert.equal(u.configuration.sha256,'0a11476864b1299bbabd1c48d79fb3c179df88916b4d64c51f191373784359d4');assert.ok(!u.permittedPaths.includes(u.configuration.path));
 assert.equal(u.runtimeConfiguration.path,'.takt/runtime.yaml');sized(u.runtimeConfiguration);assert.equal(u.runtimeConfiguration.sha256,'e50da64fb3a954889eef8c955c01b5b5d6269d45757b852edfd164921fcec816');assert.ok(!u.permittedPaths.includes(u.runtimeConfiguration.path));assert.equal(u.runtimeConfigurationEditable,false);assert.equal(u.configActor,'UNCONFIRMED');assert.equal(u.configReason,'UNCONFIRMED');
 const rt=plan.runtime;assert.equal(rt.currentStep,15);assert.equal(rt.initialStepLimit,60);assert.equal(rt.nominalSteps,20);assert.equal(rt.remainingNominalSteps,5);assert.equal(rt.repairReserve,40);assert.equal(rt.nominalSteps+rt.repairReserve,60);
 assert.equal(rt.boundedContinuation.currentRun,u.runSlug);assert.equal(rt.boundedContinuation.catalogNominalLowerBound,62);assert.equal(rt.boundedContinuation.authorityTransferred,false);assert.equal(rt.boundedContinuation.completionGuaranteed,false);
 assert.equal(rt.boundedContinuation.remainingArchitectureReviews+rt.boundedContinuation.preparationTurns+rt.boundedContinuation.remainingImplementationReviews+rt.boundedContinuation.remainingImportOrReassessment,rt.remainingNominalSteps);
 assert.equal(currentCoverage.executionContext.runSlug,u.runSlug);assert.equal(currentCoverage.executionContext.designIteration,15);assert.equal(currentCoverage.executionContext.currentStep,15);assert.equal(currentCoverage.executionContext.activeBatchId,null);assert.deepEqual(currentCoverage.executionContext.currentIndependentApprovals,[]);assert.equal(currentCoverage.executionContext.architectureReview,'PENDING_U_WRITER_INTEGRATION_REVIEW');assert.equal(currentCoverage.executionContext.productVerified,false);
 for(const k of Object.keys(currentCoverage).filter(k=>k!=='executionContext'))assert.deepEqual(currentCoverage[k],frozenEntry(plan.coverage)[k],'U coverage changed '+k);

 if(repair){
  assert.equal(repair.schemaVersion,1);assert.equal(repair.runSlug,u.runSlug);assert.equal(repair.iteration,7);assert.equal(repair.status,'LOCAL_COLLECTOR_LIMIT_RETAINED_B02_ROLE_BINDING_PENDING');assert.equal(repair.scope,'OFFLINE_REPAIR_VALIDATION_ONLY');assert.equal(repair.blockingFinding,'B02');assert.equal(repair.reviewVerdict,'REQUEST_CHANGES');
  assert.equal(repair.contract,'work/enterprise/RUNTIME_SCOPE_REPAIR.md');assert.equal(u.runtimeRepairContract,repair.contract);assert.ok(plan.sourceSnapshots.some(e=>e.path===repair.contract));
  assert.equal(repair.entrySnapshot,'evidence/enterprise/design-history/run-20261026190543-iteration3-entry/manifest.json');const er=read(repair.entrySnapshot);
  const ep=er.entries.find(e=>e.path==='work/enterprise/plan.json'),epRaw=readFileSync(resolve(root,ep.copy));assert.equal(hash(epRaw),ep.sha256);const oldU=JSON.parse(epRaw).componentSuccessor;const normalized={...u};delete normalized.runtimeRepairContract;normalized.status=oldU.status;normalized.milestones=oldU.milestones;assert.deepEqual(normalized,oldU,'runtime repair retargets portable scope');
  const reviewCheckpoint=JSON.parse(sized(repair.reviewCheckpoint));assert.equal(reviewCheckpoint.verdict,'REQUEST_CHANGES');assert.equal(reviewCheckpoint.reviewIteration,2);assert.equal(reviewCheckpoint.implementationAuthority,false);const rev=reviewCheckpoint.review;const rawReview=readFileSync(resolve(root,rev.copy));assert.equal(hash(rawReview),rev.sha256);assert.equal(rawReview.length,rev.bytes);assert.ok(rawReview.toString('utf8').includes('REQUEST_CHANGES'));
  const installed=sized(repair.baselineSource);assert.equal(repair.baselineSource.path,'node_modules/takt/dist/core/workflow/review-scope.js');assert.equal(repair.baselineSource.sha256,'9974d96a4458892c8366a4bbd49405b5cff255032de8545f11d9e7c9df01864f');
  assert.deepEqual(repair.change,{oldBytes:67108864,newBytes:268435456,exactReplacementCount:1});assert.equal(repair.candidate.path,'evidence/enterprise/design-run01d1feb5-iteration3/candidate/review-scope.js');const candidate=sized(repair.candidate),from='const GIT_MAX_BUFFER = 64 * 1024 * 1024;',to='const GIT_MAX_BUFFER = 256 * 1024 * 1024;';assert.equal(installed.toString('utf8').split(from).length,2);assert.equal(candidate.toString('utf8'),installed.toString('utf8').replace(from,to));
  const exp=JSON.parse(sized(repair.experiment));assert.equal(exp.kind,'ISOLATED_REVIEW_SCOPE_BUFFER_EXPERIMENT_NOT_RUNTIME_ACTIVATION');assert.equal(exp.baselineResult.code,'ENOBUFS');assert.deepEqual(exp.baselineResult.spawnargs,['ls-files','--others','--exclude-standard','-z']);assert.equal(exp.git.code,0);assert.ok(exp.git.bytes>repair.change.oldBytes);assert.ok(exp.git.bytes<repair.change.newBytes);assert.equal(exp.comparison.exactObjectEqual,true);assert.equal(exp.comparison.displayLimit,200);assert.equal(exp.candidate.sha256,repair.candidate.sha256);
  for(const k of ['installed','approved'])assert.equal(exp.candidate[k],false);for(const k of ['actualEngineExecuted','dualPhaseComplete','runtimeActivationAuthorized','componentAuthority','oldRRootCauseProven'])assert.equal(exp[k],false);assert.equal(exp.limits.candidateUpperBoundaryExecuted,false);
  assert.equal(repair.permittedArtifactRoot,'evidence/enterprise/design-run01d1feb5-iteration3/');assert.deepEqual(repair.cases,['RS1','RS2','RS3','RS4','RS5','RS6']);assert.deepEqual(repair.currentApprovals,[]);assert.equal(repair.componentTurnsDeferred,true);assert.equal(repair.implementationTurnsConsumed,0);assert.equal(repair.maxOfflinePreparationTurns,2);
  for(const k of ['candidateInstalled','candidateAccepted','fullMatrixExecuted','newLimitBoundaryExecuted','actualEngineExecuted','dualPhaseComplete','componentImplementationEnabled','runtimeReplacementAuthority','targetLaunchAuthority','sourceQuiescenceProven','hostExclusionProven','completeH','supportedActivationProven','oldRRootCauseProven','productionEffects'])assert.equal(repair[k],false,'repair authority escalation '+k);
  const binding=repair.executionBinding;
  assert.ok(binding,'missing execution binding reconciliation');
  assert.equal(binding.status,'UNRESOLVED_LOCAL_MODULE_VS_RUNNING_EXECUTOR');
  assert.deepEqual(binding.completedReportIterations,[1,2,3,4]);
  for(const k of ['loadedCollectorIdentityProven','phaseCompletionClosesB01','candidateSuccessClosesB01','componentAuthority'])assert.equal(binding[k],false,'unsupported binding authority '+k);
  assert.equal(binding.requiresReadOnlyReconciliationBeforeActivation,true);
  const observed=JSON.parse(sized(binding.phaseObservation));
  assert.equal(observed.kind,'LOG_PREFIX_PROJECTION_NOT_LOADED_MODULE_ATTESTATION');
  assert.deepEqual(observed.completedReportIterations,[1,2,3,4]);
  assert.equal(observed.loadedCollectorIdentityProven,false);assert.equal(observed.componentAuthority,false);
  const logPrefix=readFileSync(observed.sourcePrefix.path).subarray(0,observed.sourcePrefix.bytes);
  assert.equal(logPrefix.length,observed.sourcePrefix.bytes);assert.equal(hash(logPrefix),observed.sourcePrefix.sha256);
  const rows=logPrefix.toString('utf8').trim().split('\n').map(JSON.parse);
  const events=rows.filter(d=>['step_start','step_complete','phase_start','phase_complete'].includes(d.type)).map(d=>Object.fromEntries(['type','step','iteration','phase','phaseExecutionId','status','timestamp','matchedRuleIndex','provider','model','providerOptions'].filter(k=>k in d).map(k=>[k,d[k]])));
  assert.deepEqual(observed.events,events);
  assert.deepEqual(events.filter(e=>e.type==='phase_complete'&&e.phase===2&&e.status==='done').map(e=>e.iteration),binding.completedReportIterations);
  const diagnostic=JSON.parse(sized(binding.collectorObservation));
  assert.equal(diagnostic.collector.code,'ENOBUFS');assert.deepEqual(diagnostic.collector.spawnargs,['ls-files','--others','--exclude-standard','-z']);
  assert.equal(diagnostic.stream.status,0);assert.equal(diagnostic.stream.stderrBytes,0);assert.ok(diagnostic.stream.bytes>repair.change.oldBytes);
  assert.equal(diagnostic.localModule.sha256,repair.baselineSource.sha256);
  for(const k of ['loadedCollectorIdentityProven','candidateExecuted','runtimeActivated'])assert.equal(diagnostic[k],false);
  assert.ok(binding.launcherObservation&&binding.externalCollectorObservation,'launcher and external collector observations required');
  const launcher=JSON.parse(sized(binding.launcherObservation)), external=JSON.parse(sized(binding.externalCollectorObservation));
  assert.equal(launcher.kind,'READONLY_PROCESS_ANCESTRY_AND_CURRENT_DISK_NOT_LOADED_BYTES_ATTESTATION');
  assert.equal(launcher.worker.cwd,root);assert.ok(launcher.ancestry.some(e=>e.pid===launcher.worker.pid));
  assert.equal(launcher.worker.script,launcher.externalPackageRoot+'/dist/features/web-ui/worker-entry.js');
  for(const k of ['loadedCollectorIdentityProven','runtimeActivated','componentAuthority','rawEnvironmentRead','rawArgumentsSaved'])assert.equal(launcher[k],false);
  for(const e of launcher.sourceRefs){const raw=readFileSync(resolve(root,e.copy));assert.equal(hash(raw),e.sha256);assert.equal(raw.length,e.bytes);}
  const localCopy=launcher.sourceRefs.find(e=>e.path===repair.baselineSource.path),externalCopy=launcher.sourceRefs.find(e=>e.path===launcher.externalPackageRoot+'/dist/core/workflow/review-scope.js');
  assert.ok(localCopy&&externalCopy,'both collector source copies required');
  assert.equal(localCopy.sha256,repair.baselineSource.sha256);
  assert.equal(readFileSync(resolve(root,externalCopy.copy),'utf8'),readFileSync(resolve(root,localCopy.copy),'utf8').replace('const GIT_MAX_BUFFER = 64 * 1024 * 1024;','const GIT_MAX_BUFFER = 128 * 1024 * 1024;'));
  assert.equal(launcher.exactCollectorDelta64To128,true);
  assert.equal(external.kind,'EXPLICIT_EXTERNAL_DISK_COLLECTOR_NOT_ACTIVE_ENGINE');assert.equal(external.module.sha256,externalCopy.sha256);assert.equal(external.status,0);assert.equal(external.stream.code,0);assert.equal(external.stream.stderrBytes,0);assert.ok(external.stream.bytes>67108864&&external.stream.bytes<134217728);assert.equal(external.scope.exactIndependentUnion,true);
  assert.equal(external.runtimeIdentity.local.version,'0.71.0');assert.equal(external.runtimeIdentity.external.version,'0.70.0');assert.equal(external.runtimeIdentity.collectorOmitted,true);assert.equal(external.runtimeIdentity.identical,false);
  assert.deepEqual(external.runtimeIdentity.changedPaths,['package.json','infra/task/centralStateRepository.js','infra/config/loaders/workflowStepNormalizer.js','infra/config/providerOptions.js']);
  for(const k of ['loadedCollectorIdentityProven','candidateExecuted','runtimeActivated','componentAuthority'])assert.equal(external[k],false);
  for(const k of ['runtimeIdentitySufficient','externalPackageAccepted','localFailureProvesActiveFailure'])assert.equal(binding[k],false);
  assert.deepEqual(repair.reviewDisposition,{status:'READY_FOR_ROLE_BOUND_DESIGN_REVIEW',question:'Review B02 role authentication and the unchanged executor path; RSC-256 is optional, not the next mandatory step.',componentApprovalRequested:false,runtimeInstallationRequested:false,priorRequestChangesPreserved:true,independentDecisionPending:true});
  assert.equal(rt.boundedContinuation.scope,'U_WRITER_AND_COMPLETE_INTEGRATION_PROPOSAL');assert.equal(rt.boundedContinuation.preparationTurns,2);assert.equal(rt.boundedContinuation.remainingArchitectureReviews,1);assert.equal(rt.boundedContinuation.remainingImplementationReviews,1);assert.equal(rt.boundedContinuation.remainingImportOrReassessment,1);
  const roles=plan.runtimeRoleBinding;
  assert.ok(roles&&typeof roles==='object','B02 role contract required');
  assert.equal(roles.schemaVersion,1);assert.equal(roles.runSlug,u.runSlug);assert.equal(roles.iteration,7);assert.equal(roles.status,'PENDING_INDEPENDENT_DESIGN_REVIEW');assert.equal(roles.finding,'B02');
  assert.deepEqual(roles.roles,['ORCHESTRATOR_ORIGIN','LOCAL_VALIDATION_HELPER','ISOLATED_ENGINE']);
  assert.equal(roles.legacyIdentityRole,'LOCAL_VALIDATION_HELPER');assert.equal(roles.executorAssurance,'CENTRAL_PROCESS_TUPLE_AND_OS_ORIGIN_WITH_CURRENT_DISK_SNAPSHOT');
  for(const k of ['loadedBytesAuthenticated','launchTimeDistributionManifestAvailable','runtimeSelectionOverride','localOnlyMayAuthenticateExecutor','memoryDumpRequired','currentSnapshotMayAuthenticatePastExecution','RSC256Required','runtimeReplacementAuthority','implementationAuthorized','independentApproval','componentAccepted','productVerified'])assert.equal(roles[k],false,'role authority '+k);
  assert.equal(roles.legacyHelpersUnchanged,true);assert.equal(roles.schemas1To4Unchanged,true);assert.deepEqual(roles.implementationPaths,u.permittedPaths);assert.equal(roles.implementationLocation,'scripts/enterprise/runtime-preparation.mjs');
  assert.deepEqual(roles.attestationExtension,{schemaVersion:5,field:'runtimeRoles',referenceFields:['path','sha256','bytes'],legacyRuntimeFieldsMean:'LOCAL_VALIDATION_HELPER',unknownFieldsReject:true});
  assert.deepEqual(roles.originTuple,['stateId','taskId','generation','executionId','runId','pid','processStartTime','canonicalCwd','nodeExecutable','workerEntry','bundleDigest','session','providerOptions']);
  assert.deepEqual(roles.requiredAdditionalSources,['features/web-ui/worker-entry.js','features/web-ui/central-worker.js','features/web-ui/central-worker-spawn.js','features/tasks/execute/workflowExecutionApi.js','core/workflow/review-scope.js','core/workflow/engine/WorkflowEngineSetup.js','core/workflow/engine/OptionsBuilder.js','infra/task/process.js']);
  assert.deepEqual(roles.helperRuntime,external.runtimeIdentity.local);assert.deepEqual(roles.executorDiskRuntime,external.runtimeIdentity.external);
  assert.ok(roles.review&&roles.observation,'B02 review and observation required');
  const reviewed=sized(roles.review).toString('utf8');assert.ok(reviewed.includes('REQUEST_CHANGES')&&reviewed.includes('B02'));
  const ro=JSON.parse(sized(roles.observation));assert.equal(ro.kind,'ROLE_BINDING_OBSERVATION_NOT_LAUNCH_DISTRIBUTION_ATTESTATION');assert.equal(ro.runSlug,u.runSlug);assert.equal(ro.iteration,7);assert.equal(ro.centralProcessTupleMatches,true);
  assert.equal(ro.taskProjection.pid,ro.worker.pid);assert.equal(ro.taskProjection.processIdentity.startTime,ro.worker.started);assert.equal(ro.taskProjection.runId,u.runSlug);
  assert.equal(ro.context.iteration,7);assert.equal(ro.context.step,'design-architecture');assert.deepEqual(ro.context.runtime,roles.helperRuntime);assert.deepEqual(ro.executorDiskIdentity,roles.executorDiskRuntime);
  for(const k of ['loadedBytesAuthenticated','componentAuthority','collectorIncludedInLegacyIdentity','launchDistributionManifestPresent'])assert.equal(ro[k],false);
  for(const e of ro.sourceRefs){const raw=readFileSync(resolve(root,e.copy));assert.equal(hash(raw),e.sha256);assert.equal(raw.length,e.bytes);}
  assert.deepEqual(roles.engine,{packageRole:'ORCHESTRATOR_ORIGIN_CURRENT_DISK',sourceRoot:launcher.externalPackageRoot,command:['/opt/homebrew/Cellar/node/25.4.0/bin/node','--test','--test-reporter=tap','tests/enterprise/finalization.test.mjs'],entry:'U-specific scenario imports exact isolated copy of executor package; legacy scenarios retain local imports',fullDistributionAndDependencyInventoryRequired:true,unknownDependencyReject:true,fullSizeScopeRequired:true,syntheticProviderOnly:true,realCentralWrites:false,installedRuntimeWrites:false});
  assert.ok(roles.manifest&&roles.distributionInventory,'role manifest and inventory required');
  const rm=JSON.parse(sized(roles.manifest)),di=JSON.parse(sized(roles.distributionInventory));
  assert.deepEqual(Object.keys(rm).sort(),['schemaVersion','purpose','runSlug','helper','executorOrigin','isolatedEngine','mapping','evidenceLevel','missingProofs'].sort());
  assert.equal(rm.schemaVersion,1);assert.equal(rm.purpose,'U_RUNTIME_ROLES_V1');assert.equal(rm.runSlug,u.runSlug);assert.equal(rm.evidenceLevel,roles.executorAssurance);
  assert.deepEqual(rm.helper.identity,roles.helperRuntime);assert.deepEqual(rm.executorOrigin.identity,roles.executorDiskRuntime);assert.deepEqual(rm.executorOrigin.observation,roles.observation);assert.deepEqual(rm.helper.distributionInventory,roles.distributionInventory);assert.deepEqual(rm.executorOrigin.distributionInventory,roles.distributionInventory);
  assert.deepEqual(rm.mapping,{helperEqualsExecutorRequired:false,testCopyMatchesExecutorInventoryRequired:true,callerOverrideAllowed:false});
  assert.deepEqual(rm.missingProofs,['LAUNCH_TIME_DISTRIBUTION_MANIFEST','LOADED_MEMORY_BYTES','ISOLATED_ENGINE_AND_ACTUAL_U_COMPONENT_ACCEPTANCE']);
  assert.deepEqual(rm.isolatedEngine,{sourceInventory:roles.distributionInventory,sourceInventoryRole:'executor',entryCommand:roles.engine.command,copyNotYetCreated:true,relocationMustPreserveBytesAndResolution:true,syntheticProviderOnly:true,actualEngineExecuted:false});
  assert.equal(di.kind,'CURRENT_DISK_DISTRIBUTIONS_NOT_STARTUP_OR_MEMORY_ATTESTATION');assert.equal(di.loadedBytesAuthenticated,false);assert.equal(di.nodeExecutable.path,roles.engine.command[0]);
  for(const k of ['executor','helper']){assert.equal(di[k].completeRequiredClosure,true);assert.ok(di[k].missing.every(e=>e.optional));assert.equal(di[k].fileCount,di[k].packages.reduce((n,p)=>n+p.files.length,0));assert.equal(new Set(di[k].packages.map(p=>p.root)).size,di[k].packages.length);}
  assert.deepEqual(roles.gate,{subprocess:false,writes:false,locks:false,repair:false,checks:'CLOSED_AUTHENTICATED_EVIDENCE_AND_CURRENT_CENTRAL_TUPLE_NOT_OS_LIVENESS'});
  assert.deepEqual(roles.mismatches,['HELPER_ONLY_MATCH','DIFFERENT_LAUNCHER','PID_REUSE','COLLECTOR_REPLACEMENT','UNKNOWN_PACKAGE_DELTA','DEPENDENCY_DRIFT','CONFIG_OR_PROVIDER_MISMATCH','OLD_RUN_BUNDLE_SESSION','ROLE_SWAP','CALLER_ROOT_OVERRIDE','MISSING_ORIGIN','POST_AWAIT_CHANGE','SAVED_WITNESS_AS_CURRENT_AUTHORITY','FIXTURE_AS_LIVE_PROOF']);
  assert.equal(roles.positive,'DIFFERENT_PINNED_HELPER_AND_EXECUTOR_WITH_EXPLICIT_ROLE_MAPPING');
  assert.deepEqual(roles.nextWork,{step:'build-foundation',kind:'LIMITED_ROLE_AUTHENTICATION_AND_U_INTEGRATION',requiresNewIndependentSchema5Review:true,maxComponentTurns:4,D1DueTurn:2,D2DueTurn:4,partialCandidate:false,bootstrapUsesOldGuardAsExecutorProof:false,onMissingEvidence:'RECORD_EXACT_MISSING_ORIGIN_AND_REASSESS_NO_REPLACEMENT_OR_FORCED_GATE'});
  console.log(JSON.stringify({kind:'RUNTIME_REPAIR_DESIGN_ONLY',runtimeActivated:false,componentImplementationEnabled:false,candidateAccepted:false,independentApproval:false}));
 }

 assert.ok(timing&&typeof timing==='object','U deadline reassessment required');
 assert.deepEqual(Object.keys(timing).sort(),['schemaVersion','runSlug','iteration','status','contract','observation','previousReview','historicalMilestones','missedDeadline','milestones','remainingImplementationTurns','requiresNewIndependentReview','authority','priorRolePlanDisposition','implementationPaths','profile','protocol','frameBytes','fieldCount','stages','timing','policyLimits','legacyR','authentication','implementationSites','failure','acceptance','fullOwnerExecuted','timingAccepted','componentAccepted','implementationAuthorized','productVerified'].sort());
 assert.equal(timing.schemaVersion,1);assert.equal(timing.runSlug,u.runSlug);assert.equal(timing.iteration,11);assert.equal(timing.status,'PENDING_INDEPENDENT_DESIGN_REVIEW');assert.equal(timing.contract,u.contract);
 assert.deepEqual(timing.historicalMilestones,{implementationTurnsConsumed:0,maxImplementationTurns:4,D1DueTurn:2,D2DueTurn:4,onMiss:'IMMEDIATE_REASSESSMENT_NO_AUTOMATIC_EXTENSION',historicalCountsReset:false});
 assert.deepEqual(timing.missedDeadline,{name:'D1',dueCumulativeTurn:2,buildIteration:10,status:'MISSED'});assert.deepEqual(timing.milestones,{implementationTurnsConsumed:2,maxImplementationTurns:6,D1DueTurn:4,D2DueTurn:6,onMiss:'IMMEDIATE_REASSESSMENT_NO_AUTOMATIC_EXTENSION',historicalCountsReset:false});assert.equal(timing.remainingImplementationTurns,4);assert.equal(u.milestones.maxImplementationTurns-u.milestones.implementationTurnsConsumed,2);assert.equal(rt.currentStep+rt.remainingNominalSteps,rt.nominalSteps);
 assert.equal(timing.requiresNewIndependentReview,true);assert.equal(timing.authority,'NEW_REVIEW_OF_CURRENT_RAW_CONTRACT_PLAN_INPUTS_ONLY');assert.equal(timing.priorRolePlanDisposition,'ITERATION7_AND_REVIEW8_HISTORY_NOT_CURRENT_WINDOW');assert.deepEqual(timing.implementationPaths,u.permittedPaths);
 for(const k of ['fullOwnerExecuted','timingAccepted','componentAccepted','implementationAuthorized','productVerified'])assert.equal(timing[k],false,'timing authority escalation '+k);
 assert.ok(timing.observation&&timing.previousReview,'timing observation and historical review required');
 const to=JSON.parse(sized(timing.observation)),tr=sized(timing.previousReview).toString('utf8');assert.ok(tr.includes('APPROVE')&&tr.includes('D1はturn 2'));assert.equal(timing.previousReview.sha256,'f122a211fede8b29a8fa7e3ac037781a961feee62e6559ee0504ee49468aff34');
 assert.equal(to.kind,'U_TIMING_DESIGN_OBSERVATION_NOT_OWNER_ACCEPTANCE');assert.equal(to.runSlug,u.runSlug);assert.equal(to.iteration,11);assert.equal(to.buildTurnsConsumed,2);assert.deepEqual(to.missedD1,{dueTurn:2,iteration:10,status:'MISSED'});
 assert.ok(to.assessment&&to.remainingWork&&to.artifactInventory,'timing failed history required');
 const ta=JSON.parse(sized(to.assessment));sized(to.remainingWork);sized(to.artifactInventory);assert.equal(ta.buildTurn,2);assert.deepEqual(ta.D1,{due:2,status:'MISSED'});assert.equal(ta.designReportSha256,'6faee06b73b4f4f7a15f1ea8cff379eb90952f914074031f9bc2593869b7a371');assert.deepEqual(to.diagnostic,ta.diagnostic);assert.deepEqual(to.sourceRefs,ta.sources);
 assert.equal(to.diagnostic.positive.status,0);assert.equal(to.diagnostic.actualAcquisition.status,70);assert.equal(to.diagnostic.actualAcquisition.auth.status,0);assert.equal(to.diagnostic.authDurationMs,77870);assert.equal(to.diagnostic.authorityBeforeDurationMs,70796);
 for(const k of ['fullUOwnerExecuted','newTimingExecuted','implementationApproved'])assert.equal(to[k],false);
 assert.ok(Array.isArray(to.sourceCopies),'historical source copies required');assert.deepEqual(to.sourceCopies.map(({copy,...r})=>r),to.sourceRefs.map(({mtimeNs,...r})=>r));for(const e of to.sourceCopies){const raw=readFileSync(resolve(root,e.copy));assert.equal(hash(raw),e.sha256,'historical timing source changed');assert.equal(raw.length,e.bytes);}
 assert.equal(timing.profile,'U_HOST_PROTOCOL_V1');assert.equal(timing.protocol,'RSP1');assert.equal(timing.frameBytes,208);assert.equal(timing.fieldCount,24);
 assert.deepEqual(timing.stages,['PRE_RESERVE','POST_RESERVE_LOCK','POST_ADMISSION_LOCK','POST_ADMITTED','PRE_GO']);
 assert.deepEqual(timing.timing,{clock:'MONOTONIC',challengeMs:240000,challengeCount:5,nonChallengeAllowanceMs:60000,ownerMs:1260000,watchdogGraceMs:1000,watchdogMs:1261000,cleanupReapMs:1000,start:'C_OWNER_BEFORE_FIRST_CHALLENGE',challengeStart:'C_BEFORE_FRAME_WRITE',waitRule:'MIN_OWNER_AND_CURRENT_CHALLENGE_REMAINING',childWaitRule:'OWNER_REMAINING_NEVER_RESET',publicationRequestConsumesBudget:true,deadlineResetAllowed:false,lateGrantAllowed:false});
 const tb=timing.timing;assert.equal(tb.ownerMs,tb.challengeCount*tb.challengeMs+tb.nonChallengeAllowanceMs);assert.equal(tb.watchdogMs,tb.ownerMs+tb.watchdogGraceMs);assert.equal(timing.policyLimits[0],String(tb.ownerMs));
 assert.deepEqual(timing.policyLimits,['1260000','1000','134217728','1','65536']);assert.deepEqual(timing.legacyR,{profile:'R_HOST_PROTOCOL_V1',ownerMs:10000,watchdogMs:11000,unchanged:true});
 assert.deepEqual(timing.authentication,{fullBeforeAndAfterEachChallenge:true,checkFullDistributionBytesAndResolution:true,checkActualContextAndOrigin:true,mtimeOnlyAllowed:false,cacheTTLAllowed:false,savedDiagnosticAsAuthorityAllowed:false,preflightSubstitutesChallenge:false,callerBudgetAllowed:false,privateCompiledProfileRequired:true});
 assert.deepEqual(timing.implementationSites,['readComponentDescriptorAuthority','verifyOwnedComponentDescriptor','reserveOwnedComponentDescriptor','publishOwnedComponentReservation','pd_rsp_wait','pd_semantic_recheck','pd_semantic_challenge','pd_semantic_publish child wait']);
 assert.deepEqual(timing.failure,{afterAdmittedRetained:true,unknownGoReplay:false,primaryAndCleanupPreserved:true,blockedJsTimerIsHardDeadline:false,processStopProofRequired:true,healthyWorkerSignalsAllowed:false});
 assert.deepEqual(timing.acceptance,['REAL_U_FULL_AUTH_FIVE_STAGE_GO_POSITIVE','PER_STAGE_BEFORE_AT_AFTER_DEADLINE','C_TIMEOUT_WITH_BLOCKED_JS_AND_LATE_GRANT','GLOBAL_DEADLINE_ACROSS_STAGES_AND_PUBLICATION_PAUSE','CHILD_WAIT_AND_ADMITTED_FAILURE_NO_REPLAY','PROFILE_LIMIT_POLICY_MISMATCH_SELF_CONSISTENT_FORGERY','R_TEN_SECOND_CONTRACT_AND_RAW_EPERM','ALL_85_VARIANTS_PREBOUND_HISTORY_WRITER_ENGINE_IMPORT']);
 const timingText=readFileSync(resolve(root,timing.contract),'utf8');for(const fragment of ['U iteration11 / design occurrence6','U_HOST_PROTOCOL_V1','1260000ms =5*240000+60000','1261000ms','cumulative turns3..6','D1 due4','D2 due6','mtime-only','before-and-after authority','R_HOST_PROTOCOL_V1 (10000ms'])assert.ok(timingText.includes(fragment),'timing contract missing '+fragment);
 console.log(JSON.stringify({kind:'U_TIMING_DESIGN_ONLY',consumed:2,missedD1:2,proposedD1:4,proposedD2:6,fullOwnerExecuted:false,independentApproval:false}));
 assert.ok(plan.sourceSnapshots.some(e=>e.path===u.contract));
 console.log(JSON.stringify({kind:'U_SUCCESSOR_DESIGN_STRUCTURE_ONLY',runSlug:u.runSlug,predecessorPhase16Complete:false,plannedSubcases:6,executedSubcases:0,independentApproval:false}));
}


if(successor){
 const w=plan.successorWriterReassessment;
 assert.ok(w && typeof w==='object','writer reassessment required');
 const expectedWriterDesign={"schemaVersion": 1, "runSlug": "20261026190543-01d1feb5", "iteration": 15, "status": "PENDING_INDEPENDENT_DESIGN_REVIEW", "contract": "work/enterprise/COMPONENT_SUCCESSOR.md", "previousCanonicalReportSha256": "7ce5e64885e5e732ffabd012ca5c6558a260e4d674bd977a88eb13cc5d4c514c", "historicalMilestones": {"implementationTurnsConsumed": 2, "maxImplementationTurns": 6, "D1DueTurn": 4, "D2DueTurn": 6, "onMiss": "IMMEDIATE_REASSESSMENT_NO_AUTOMATIC_EXTENSION", "historicalCountsReset": false}, "missedD1": [{"dueTurn": 2, "iteration": 10, "status": "MISSED"}, {"dueTurn": 4, "iteration": 14, "status": "MISSED"}], "milestones": {"implementationTurnsConsumed": 4, "maxImplementationTurns": 6, "D1DueTurn": 5, "D2DueTurn": 6, "onMiss": "IMMEDIATE_REASSESSMENT_NO_AUTOMATIC_EXTENSION", "historicalCountsReset": false}, "remainingImplementationTurns": 2, "requiresNewIndependentReview": true, "authority": "NEW_REVIEW_OF_CURRENT_RAW_CONTRACT_PLAN_INPUTS_ONLY", "priorTimingPlanDisposition": "ITERATION11_AND_REVIEW12_HISTORY_NOT_CURRENT_WINDOW", "implementationPaths": ["scripts/enterprise/runtime-preparation.mjs", "scripts/enterprise/preparation-producer-linux.c", "tests/enterprise/rejected-regeneration.test.mjs", "tests/enterprise/evidence-fixture.mjs", "tests/enterprise/continuation.test.mjs", "tests/enterprise/continuation-v4.test.mjs", "tests/enterprise/finalization.test.mjs", "scripts/enterprise/verify.mjs"], "scope": "U-I1a-v1", "binding": {"source": "ACTUAL_TEST_SOURCE_BEFORE_STARTED", "conditionCount": 85, "caseCount": 20, "allVariants": true, "fields": ["conditionId", "variantId", "sourcePath", "sourceSha256", "testPathOrdinalAndName", "expectedBoundary", "independentOracle"], "deriveFromSuccessfulTap": false, "requireFullSchema5RawBindingMatrix": true, "preserveAssertionMultiplicities": true, "UPrivateScopeOnly": true}, "history": {"retainAllFailedInterruptedAndPartial": true, "preservationIsExecutionProvenance": false, "missingOrigin": "BLOCK_CANDIDATE_WITH_EXACT_MISSING_REFERENCE", "missingPastBytesMayBeReconstructed": false, "separateSavedDiagnosticsFromAuthenticatedExecutions": true, "validateEachInvocationOwnInputsAndAuthority": true, "latestFailedOrStartedBlocksCandidate": true, "foreignFenceMayBeCleared": false, "closedSetIncludesUnreferencedMetadata": true}, "writer": {"privateTypedSchema5Branch": true, "recordSchema": 3, "purpose": "SUCCESSOR_COMPONENT_IMPLEMENTATION_REVIEW", "sameNamespace": true, "sequence": "PREVIOUS_DURABLE_TERMINAL_PLUS_ONE", "initialSequence": 1, "journalHeadCAS": true, "exclusiveOwnedLock": true, "startedBeforeSpawn": true, "stages": ["AUTHENTICATE_AND_PIN", "VALIDATE_COMPLETE_SCOPE_AND_HISTORY", "OWNED_LOCK_AND_HEAD_CAS", "DURABLE_STARTED", "SPAWN_FIXED_COMMAND", "CLOSE_AND_BOTH_PIPE_EOF", "FSYNC_READBACK_CLOSED_INVENTORY", "DURABLE_TERMINAL_AND_HEAD_CAS", "CANDIDATE_ONLY_AFTER_FULL_SCOPE_AND_ENGINE"], "terminalCauses": ["PRE_SPAWN", "SPAWN", "PROCESS_EXIT_OR_SIGNAL", "STDOUT_OR_STDERR", "PERSISTENCE_OR_READBACK", "INPUT_OR_AUTHORITY_DRIFT", "CLOSURE_OR_PUBLICATION"], "failedAppendRequiresOwnedStableHead": true, "recordingFailure": "RETAIN_STARTED_FENCE_PARTIAL_OUTPUT_AND_PRIMARY_PLUS_RECORDING_ERROR", "continuation": "ONLY_VALIDATED_TERMINAL_WITH_PROVEN_PRIOR_WRITER_CLOSURE_AND_OWNED_LOCK", "unknownProducer": "NO_UNLOCK_NO_NEW_NAMESPACE_NO_OLD_PASS", "successReceiptIsReviewReady": false, "isolatedPrimitiveTestsBeforePublicWriter": true, "isolatedProgressIsCandidate": false}, "consumer": {"readOnly": true, "subprocess": false, "locks": false, "repair": false, "closedEvidenceAndCurrentPublicContext": true, "newOSLivenessClaim": false, "candidateSchema": 3, "decisionSchema": 7, "acceptedComponents": ["U-I1a"], "identicalImportWrites": 0, "conflictingImport": "REJECT_RETAIN_HISTORY", "fixedEngineTRequired": true, "bothPhasesGateSeparateReviewImportRequired": true}, "validation": ["NORMAL_REAL_U_OWNER_AND_CONTINUING_TWO_INVOCATIONS", "ALL85_AND_VARIANTS_PREBOUND_SOURCE_ORDINAL_BOUNDARY_ORACLE", "MISSING_REHASHED_VARIANT_OR_HISTORY_REJECTED", "PRE_SPAWN_SPAWN_STREAM_CLOSE_EOF_FSYNC_READBACK_FAILURE", "LATEST_FAILED_STARTED_AND_COMPETING_WRITER_FENCED", "CAS_AND_AWAIT_INPUT_AUTHORITY_OR_JOURNAL_DRIFT", "CLOSED_INVENTORY_EXTRA_MISSING_REPLACED_FILES", "MISSING_ORIGIN_OR_DELETED_FIXTURE_NOT_FABRICATED", "ZERO_WRITE_ZERO_SUBPROCESS_GATE_REVIEW_SUCCESS_AND_REJECTION", "T_ENGINE_DUAL_PHASE_GATE_DISTINCT_REVIEW_IMPORT_AND_FAILURES", "UNFILTERED_SEVEN_FILES_AND_CURRENT_INDEPENDENT_REVIEW"], "newCheckpointAuthority": false, "partialCandidate": false, "implementationAuthorized": false, "componentAccepted": false, "productVerified": false, "runtimeReplacementAuthority": false};
 assert.deepEqual(Object.keys(w).sort(),[...Object.keys(expectedWriterDesign),'observation','previousReviewText'].sort(),'writer contract keys');
 for(const [k,v] of Object.entries(expectedWriterDesign))assert.deepEqual(w[k],v,'writer design contract '+k);
 assert.deepEqual(w.milestones,successor.milestones);assert.deepEqual(w.historicalMilestones,plan.successorTimingReassessment.milestones);
 assert.deepEqual(w.implementationPaths,successor.permittedPaths);assert.equal(w.remainingImplementationTurns,successor.milestones.maxImplementationTurns-successor.milestones.implementationTurnsConsumed);
 assert.equal(plan.runtime.boundedContinuation.scope,'U_WRITER_AND_COMPLETE_INTEGRATION_PROPOSAL');assert.equal(plan.runtime.boundedContinuation.preparationTurns,2);
 const checked=r=>{assert.ok(r&&typeof r==='object','writer observation reference missing');assert.deepEqual(Object.keys(r).sort(),['bytes','path','sha256']);const b=readFileSync(resolve(root,r.path));assert.equal(hash(b),r.sha256,'writer referenced bytes changed');assert.equal(b.length,r.bytes);return b;};
 const wo=JSON.parse(checked(w.observation));const previousText=checked(w.previousReviewText).toString('utf8');
 assert.equal(wo.kind,'U_WRITER_REASSESSMENT_NOT_IMPLEMENTATION_ACCEPTANCE');assert.equal(wo.iteration,15);assert.equal(wo.runSlug,successor.runSlug);assert.equal(wo.buildTurnsConsumed,4);assert.deepEqual(wo.missedD1,w.missedD1);
 assert.ok(previousText.includes('APPROVE')&&previousText.includes('D1'),'historical review text required');
 const a=JSON.parse(checked(wo.assessment)),r=JSON.parse(checked(wo.remainingWork));checked(wo.artifactInventory);const owner=JSON.parse(checked(wo.priorOwnerAssessment));
 assert.equal(a.iteration,14);assert.equal(a.buildTurn,4);assert.equal(a.milestones.D1Status,'MISSED');assert.equal(a.milestones.D1DueTurn,4);assert.equal(a.milestones.previousUD1Miss,2);assert.equal(a.designReportSha256,w.previousCanonicalReportSha256);assert.deepEqual(a.results,wo.savedTests);
 assert.equal(r.nextStep,'design-architecture');assert.equal(r.nextBuildTurn,null);assert.equal(r.conditions.length,85);assert.ok(r.conditions.every(x=>x.status==='NOT_ACCEPTED'));
 assert.equal(owner.iteration,13);assert.equal(owner.realPublication.status,0);assert.equal(wo.savedOwnerStatus,0);assert.equal(owner.realPublication.events.at(-1).ownerElapsedMs,wo.savedOwnerLastStageMs);assert.equal(owner.componentAccepted??owner.implementationAccepted,false);
 for(const k of ['newOwnerExecution','implementationApproved','savedOwnerRerunOnCurrentInputs'])assert.equal(wo[k],false);assert.equal(wo.currentEvidenceIsHistoricalNotAuthority,true);
 assert.deepEqual(wo.currentImplementation,{schema5RoleAuthentication:true,privateUReviewReader:true,uOwnerConnection:true,uWriter:false,fullPreStartedBindings:false,historicalProvenanceComplete:false,dedicatedReadonlyGate:false,schema7Import:false,TExecuted:false});
 assert.ok(Array.isArray(wo.sourceCopies),'writer source copies missing');assert.deepEqual(wo.sourceCopies.map(x=>x.path),successor.permittedPaths);
 for(const e of wo.sourceCopies){const b=readFileSync(resolve(root,e.copy));assert.equal(hash(b),e.sha256);assert.equal(b.length,e.bytes);}
 const prep=readFileSync(resolve(root,wo.sourceCopies.find(x=>x.path==='scripts/enterprise/runtime-preparation.mjs').copy),'utf8');
 for(const text of ['U writer route not implemented','R writer existing history requires validated continuation','R history unspawned cause requires provenance','R fixed-engine handoff and complete historical provenance not implemented','readUSuccessorReview'])assert.ok(prep.includes(text),'historical implementation boundary '+text);
 console.log(JSON.stringify({kind:'U_WRITER_REASSESSMENT_DESIGN_ONLY',buildTurnsConsumed:4,missedD1:[2,4],proposedD1:5,unchangedD2:6,implementationAuthorized:false,componentAccepted:false}));
}

console.log(JSON.stringify({status:'PASS',scope:'design structure only; not product verification or independent approval',
  scopeRevision:plan.scopeRevision,issues:plan.issues.length,leaves:leaves.length,parents:plan.issues.length-leaves.length,
  acceptance:plan.issues.reduce((n,i)=>n+i.originalAcceptance.length,0),retainedOriginalAcceptance:old.issues.reduce((n,i)=>n+i.originalAcceptance.length,0),
  businessUseCases:business.length,batches:plan.batches.length,plannedSuites:suites.length,crossDomainJourneys:coverage.crossDomain.length,
  continuation:{runSlug:continuation.runSlug,reentryBatch:continuation.reentryBatch,plannedAssertions:continuationSuite.requiredAssertions.length,runtimeVerified:false},
  finalization:{finding:finalization.finding,plannedAssertions:finalSuite.requiredAssertions.length,runtimeVerified:false},
  rejectedRegeneration:{finding:recovery.architectureFinding,plannedAssertions:recovery.requiredAssertions.length,minimumConsecutiveRejections:lineage.minimumConsecutiveRejections,revalidationAssertions:revalidation.requiredAssertions.length,runtimeVerified:false},
  runtimeContinuation:{findings:['AR14-B01','AR14-N01'],sourceRun:transition.sourceRun,targetRun:null,plannedAssertions:failed.requiredAssertions.length,runtimeVerified:false},
  preparationAcceptance:{profileId:scope.profileId,requiredAssertions:new Set([...scope.requiredAssertions,...scope.requiredControlAssertions,...scope.caseIds,...scope.failureHistoryCaseIds,...scope.sourceProvenanceCaseIds,...scope.recoveryCaseIds,...scope.producerContainmentCaseIds]).size,retained:scope.retainedObligations.length,runtimeVerified:false},
  planSha256:hash(readFileSync(resolve(root,'work/enterprise/plan.json'))),coverageSha256:hash(readFileSync(resolve(root,plan.coverage)))},null,2));
