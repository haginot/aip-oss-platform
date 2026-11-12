# Exact current closure review — scope revision 4

## Current run boundary — iteration15 / 20261023180641-00e8fea9

Source is initialized, active B04; B00–B03 approvals and BF-61/BF-38/BF-42/BF-43 repairs are retained as history, not current full-prefix approval. B04 failed with exit0/missing assertion; B00 failed with nonzero baseline exit. No successful current B04 candidate exists.

[FAILED_INTERVAL_RECOVERY.md](FAILED_INTERVAL_RECOVERY.md) and [RUNTIME_CONTINUATION.md](RUNTIME_CONTINUATION.md) supersede the impossible same-run runtime handoff (AR14-B01) and preserve both failure types (AR14-N01). Proposed source preparation D_S grants no current approval. After actual source terminal/quiescence, the official central launcher (worktree=false) starts a distinct run at architecture; new independent D_T precedes initializer-private historical archive and an empty B00 projection. Target run is NOT_CREATED. No runtime replacement, central edit, same-run reset or ordinary-gate bypass is authorized here. New behavior remains NOT_IMPLEMENTED and independently unapproved.

Source budget15/60: remaining45, preparation nominal3, total18, reserve42. Future target provisional20+40=60 is separate and requires re-planning after actual launch. All190 Issues/573 AC/124 use cases/31 batches/330 suites and full-catalog initial lower bound62 remain. Full fresh B00–B04 (19 leaves/52 original ACs) and independent reviews precede B05; target initializes at B00, never copied B04. Historical boundary descriptions below are records only.

## Current run boundary — 20261023180641-00e8fea9

Current design iteration1/60; this run is not initialized. Persisted progress belongs to 20261022093752-59e717db, active B04. Its B00–B03 15-leaf imported closure and B04 four READY_FOR_REVIEW statuses are history, not current approvals. Latest old iteration60 is REQUEST_CHANGES/BF-61 over B00–B04 with no approved Issues. BF-38 audit retrieval fix and its DB/HTTP/browser evidence exist; ENT-114 still lacks approval due to BF-61. BF-42/BF-43 repairs and subsequent review/revalidation/imports are historical and require current-input tests and new independent reviews.

Initializer, failed-tail archive, ordinary-refresh recovery and invalid-review revalidation code now exist. Old PLANNED descriptions below are historical design records, not current implementation status. A remaining initializer gap is concrete: rejectedInitializationHistory fails ordinary unexplained input on the third intermediate input manifest in old B04's selecting occurrence. [RUN_ENTRY_HISTORY.md](RUN_ENTRY_HISTORY.md) defines a new initializer-private, history-only extension and eight planned counterexamples. It does not loosen current approval/recovery/selection/seal. No initialization/import/recovery is executed in this design step.

B00 implements and tests that extension with an actual Astra/high writer, archives full old history and initializes empty approvals at B00, then regenerates current baseline. B01 revalidates BF-42/BF-43; B04 implements BF-61 and retains BF-38. All original 190 Issues/573 AC, 124 use cases, 31 batches and 330 planned suites remain required. This run targets nine initial batches B00–B05, B05A/B and B06: nominal20, reserve40, cap60; full initial catalog lower bound62 remains separate.

BF-61: before new releaseApprove or stored-operation replay returns an ID/status or mutates approval/enqueues delivery, check current source, all ancestors/documents, classification, scope, purpose, current actor/grant and the publication's immutable basis. Preserve stored content/approval binding and original operation purpose for replay; never redo a historical vote or rewrite audit to make it pass. Exercise release and withdrawal approvals, denial before committed side effects, legitimate operations, revocation and restart/restore. Keep worker final-I/O checks and lost-ack/reconciliation. The independent old counterexample was memory-fixture based; real DB/public HTTP/normal browser before/after BF-61 evidence is still required. No external leak is claimed.

BF-61 planned named assertions (ENT-114 contract/browser, real DB/HTTP/DOM):
- BF-61-current-lineage-new-and-replayed-approval-denied-before-fix
- BF-61-new-release-and-withdrawal-votes-current-boundary-after-fix
- BF-61-original-purpose-replay-immutable-history-and-legitimate-withdrawal-retained


## Historical contract record (original requirements retained)

Status: EXISTING_IMPLEMENTATION_REQUIRES_CURRENT_INPUT_REVIEW. closure.mjs and closure-review.test.mjs exist; the historical 20261021010405 run iteration 8 rejection superseded its B00/B01 approval. Revalidate current receipts and obtain a new separate review. Existing BATCH_REVIEW.md single-batch validation remains strict until then. No reduction of original ACs, suite execution, dependency checks, reviewer independence or current-input requirements is authorized.

## Problem and boundary

The prior run ended at 60/60 with an exact B05 approval and stale B00–B04 approvals. Broad authored-input fingerprints invalidate earlier receipts whenever common code changes. Repeating six separate review turns per change exhausted the bounded run before the first business portal. Retain the broad input set and the actual machine re-execution; combine explicit independent review decisions, not historical statuses.

A selected batch gate runs the impacted preceding closure and active batch with the same current input manifest. It emits a closure candidate listing every affected batch, latest passed run ID, exact original Issue/AC set, suite definitions, input manifest, receipt raw and canonical hashes, output digest and real builder session. Candidate creation grants no approval and cannot select a dependent batch.

## Review and attestation

The separate Astra/high readonly reviewer reads every listed receipt, test body, current source, negative assertions, durable DB/HTTP ledger/browser artifacts and original ACs. The prose records per-Issue decisions, limitations and open findings. It must not approve an unseen prefix on the basis of a generic summary.

Keep exactly one existing `enterprise-batch-attestation` block for the active batch, as required by the frozen workflow. In addition, Phase 1 and Phase 2 contain an identical single `enterprise-closure-attestation` JSON block with:

- schemaVersion=1, verdict, runSlug, workflowRef, step=review-foundation, iteration, sessionKey, actual providerSessionId.
- activeBatchId, inputsDigest, candidatePath/candidateSha256 (raw file bytes).
- members: for each affected predecessor and the active batch, batchId, runId, receiptHash (canonical JSON), receiptSha256 (raw bytes), outputsDigest, approvedIssueIds and original AC decisions with artifact references.
- unresolvedFindings; APPROVE is forbidden with blockers or incomplete members. The active member must exactly equal the legacy active-batch block. A rejection cannot be imported as approval.

Validate against actual orchestrator-owned run mapping, compiled readonly/Astra/high declaration, session store, latest completed review occurrence, logged Phase 1/2 contents and step completion. Review begins after *all* member receipts completed. Reviewer session differs from every member's builder/release session. Validate every current manifest, command, named assertion, output byte and latest index, before and after import. A historical report, self-reported model or engine context cannot provide authority.

## Import, resume and failures

After the report is persisted by TAKT, a later authorized writer imports all listed approvals atomically under the existing gate lock, retaining exact raw report bytes and per-member pointers. Report hash is computed externally; do not demand a self-referential report digest. A single report may authenticate several explicit decisions. This is never an automatic approval expansion. Any changed member, missing affected predecessor/Issue/AC, mixed input digest, failure/running latest run, changed report or concurrent mutation rejects the entire import. Keep failed attempts and original pointers.

Both validateApproval and authenticated createSelection/resume must support the explicit member identity. Reading only the active legacy block is insufficient. A later review supersedes only the members it explicitly scopes; an unstructured later review remains unknown-scope and fails closed. Final seal binds the exact same report and per-member receipt identities; final remains readonly. Atomic import needs a durable recovery checkpoint so process interruption cannot leave half a dependency closure approved.

Old-run approvals remain history. Initialize at B00 and reacquire present-run approvals in dependency order. This extension does not let B05 bypass B00–B04 entry, reset an active batch, import an unrecorded session or waive the final independent audit. If extension implementation/independent acceptance is incomplete, use the existing single-batch path and budget its cost explicitly.

Executable acceptance: `mise exec -- node --test --test-reporter=tap tests/enterprise/closure-review.test.mjs` (existing; requires current-input re-execution). Named assertions are indexed under ENT-101 in plan.json, including valid closure, missing/mixed/stale members, latest failures, report/session forgery, review ordering, interrupted atomic import and strict legacy behavior.


## Rejected active closure

The current code rejects an entry prerequisite superseded by a later closure rejection before machine regeneration. REJECTED_REGENERATION.md adds a separately authorized evidence-only path, EXISTING_REQUIRES_CURRENT_RUN_VERIFICATION. A REQUEST_CHANGES closure can authenticate rejection scope with incomplete blocking AC decisions; it never satisfies APPROVE validation or imports approvals. Original entry occurrence and rejection/candidate identities must be intact. Fresh full-prefix receipts then require the unchanged exact independent APPROVE/import. Later unknown or incomplete review fails closed. Do not use historical validation options in ordinary approval or selection.

## AR12-01: repeated rejection provenance (existing extension)

For a candidate produced by rejected regeneration, the closure block additionally contains `recovery: {rootId, attemptId, headerSha256, resultPath, resultSha256, parentRejectionReportSha256}` identically in Phase 1 and Phase 2. The reviewer reads and binds the fixed selection root, producing attempt, current candidate and all receipt/output bytes. A refusal may have incomplete AC decisions, but it cannot omit or guess this lineage. A newer rejection binds the new receipts and their own plan, not the original selection receipts/plan. Root equality remains mandatory for bootstrap only. See REJECTED_REGENERATION.md sections 2.1–2.2 for ordering, immutable history and failure rules.

The existing importer validates this additional lineage for regenerated candidates while preserving every existing APPROVE, current-input, latest, Issue/AC and session check. At import, old rejections are historical provenance, not current regeneration permission; latest APPROVE ends that permission. Normal candidates and the frozen legacy active-batch block retain their existing format. Missing lineage on a regenerated candidate fails closed. No product status or root hash substitutes for actual independent review. This extension, including repeated rejection and exact import tests, exists and requires current-run verification; no old active batch is a current authority.

## Historical run: 20261022010421-b25edfc9

Entry history is the prior run 20261021010405-76071af6, active B04, iteration60 REQUEST_CHANGES/BF-38 over B00–B04; no Issues approved. All old status/receipt/recovery references are history only. CONTINUATION.md defines the B00 extension for authenticating and archiving this latest recovery rejection before an empty new-run projection. Recovery/closure implementations exist, but none of their old permissions or approvals are copied. Actual current-run full-input suites and independent exact member/AC review remain required. BF-38 current source policy must also guard audit retrieval; integrity of immutable historical audit is not permission to disclose it.


## Iteration 8 historical design boundary — ordinary refresh bootstrap

The current run 20261022093752-59e717db is initialized with active B01. Its first scoped rejection is iteration 6/BF-43. The normal gate refreshed B00 after selection and before that rejection. REJECTED_REGENERATION.md section 2.3 adds a planned authenticated S→ordinary-refresh→J0 root form, without changing the legacy equal-receipt root. This extension was planned at iteration 8 and now exists in code; the iteration-12 APPROVE could not be imported because its recovery.resultPath is invalid. Revalidate changed inputs; do not promote the old prose approval. Authenticate every original approval, actual builder occurrence/Phase/session, intervening failed and post-report receipts, exact candidate and independent rejection. Never treat historical approval as current permission, rewrite selection, or skip a later review. Import must validate the new root history and the exact fresh APPROVE through existing atomic closure checks; the ordinary candidate format stays unchanged. Current-input full-prefix execution and BF-43/BF-42 original-AC review are required before B02 or release. Same-run initialization remains forbidden; future-run history archival grants no approval. BF-38 remains open in B04.

## Iteration 14: malformed review remains invalid

[REVIEW_REVALIDATION.md](REVIEW_REVALIDATION.md) adds a **planned, unimplemented** explicit independent architecture order to rerun machine evidence after an authenticated APPROVE has only an invalid resultPath. This is not a repaired approval or a fabricated rejection. Preserve both original phases and their raw report. A generic design approval cannot authorize it. The next exact foundation review must inspect new full-prefix receipts and bind schemaVersion=2 recovery/typed authority (or unchanged legacy form for existing schema1 candidates). Both phases must match exactly. Follow the complete history through the invalid review and its explicit order; never skip to a later corrected APPROVE. Import still requires current inputs, outputs, latest receipts, all original Issue/AC decisions and a separate actual session. No B02 or seal before exact atomic import. Historical schema1/2 roots and all failures stay immutable. The new design order is not product acceptance.
