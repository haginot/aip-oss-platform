# Current run entry history — 20261023180641-00e8fea9

Status: PLANNED_NOT_IMPLEMENTED. ENT-101/B00 owns a private initializer history format. This document grants no current approval or recovery authority. Independent design review precedes real Astra/high implementation. No initializer is executed by design-architecture.

## Observed boundary

Persisted progress belongs to 20261022093752-59e717db, active B04. Latest canonical review iteration60 REQUEST_CHANGES/BF-61 has empty approvedIssueIds and an ordinary candidate without recovery. The iteration58 B00–B03 closure approval is historical selection provenance only. The readonly rejectedInitializationHistory call currently fails at ordinaryOrigin: ordinary unexplained input. Its old/current two-manifest whitelist cannot authenticate the intermediate third manifest; removing that check globally is not authorized.

The complete selecting occurrence interval contains 12 entries: B04 failed on f0d2fc9099c920a8a8a91a9d0b37cee5e7e22f9004254976a6db8968268e2673; B00/B01/B02/B03 passed and B04 failed on 27d4873c27e5e31d3fd9900a077ba9f596b17734788228c179bf4a46d9ab083b; B00/B01/B02/B03/B04 passed then post-report B04 passed on 0b86b5d0cf9b77c9a0f55829eb88b52e995a13768e87aad19d95e527e44b9fc4. The changed paths are src/enterprise/controls.mjs and tests/enterprise/ENT-114.test.mjs / ENT-114.browser.test.mjs. These observed hashes locate evidence, not authority. Latest candidate is evidence/enterprise/closures/4552916cb42dafa71583d6738eec2a3d0bd036b2d024b24d5ee68f7e2d83cbb1/candidate.json.

## Authentication and write boundary

1. Validate the actual new-run editable Astra/high writer, distinct run identity, current design/plan, old immutable B04 entry selection and its complete real B00–B03 approval provenance before writes. Require the actual TAKT compiler/readonly/session/Phase contract with the installed 0.71.0 runtime; historical 0.70.0 evidence does not establish compatibility.
2. Resolve latest old independent review from the orchestrator, both identical attestation phases, completed readonly Astra/high occurrence and canonical report. Authenticate every member of the ordinary candidate against its own plan, input, suite definitions, raw/canonical receipt hashes and artifact bytes. Its lack of recovery is a positive format constraint; never attach an unrelated older recovery root. Review begins after all member receipts; reject unknown/incomplete/later scope or nonempty approvedIssueIds on a rejection.
3. Authenticate the B04 selecting builder occurrence, Phase1/2, completion, exact provider/session, and the entire contiguous index interval from entry through latest review. Retain failed receipts as failures, passed receipts as machine evidence only, and the post-report gate sequence. Do not filter to the final digest. Independently recompute each manifest digest and receipt/output integrity; bind all three snapshots to that real occurrence and authenticated phase/artifact references. Same-session strings, wall clock or hashes alone are insufficient. If provenance or snapshot bytes cannot be authenticated, stop with a specific blocker rather than synthesize missing authority.
4. Permit multiple intermediate manifests only in this initializer-private history format (version2). Require same archived plan bytes, suite definitions, runtime fingerprint, full input path set and prefix topology. Each adjacent manifest change is confined to source/test bodies; reject plan/config/gate/runtime drift, missing receipts, extra batches, fork, rollback to an obsolete candidate, mixed writers or unexplained snapshots. Keep all prior completed recovery/revalidation roots, invalid reviews, explicit orders and imported reports as separately validated history. The ordinary candidate never inherits their current execution authority.
5. Before lock, immediately under lock and before publication, recheck old progress/index, selection, all references and actual review authority. Running/incomplete receipts, unknown/live old writer or concurrent changes stop; never kill, complete or delete old attempts. Serialize only the new initializer writer. Archive all referenced evidence, failures and exact reports durably, verify manifest and selection checkpoint bytes, then atomically create new B00 via createSelection with approvals={}, issues={}. Interrupted archive/projection resumes only from identical verified checkpoint. Archive completion alone is not baseline success.
6. Do not modify old progress until the atomic new projection; index prefix, selections, reports, roots, protected files and central TAKT state remain immutable. Do not expose the private historical acceptance to validateApproval, ordinary selection, current recovery, import, seal or readonly final. Same-run initialization remains forbidden. Existing strict ordinaryOrigin/recovery root formats are not relaxed.
7. Run B00 all eight suites and fresh isolated release then final under current inputs; independently review exact new receipts. Only then select B01. Revalidate BF-42/BF-43 and every earlier original AC in the current run. B04 must fix BF-61 and retain BF-38 regressions. No historical status is current VERIFIED.

## Executable acceptance

Existing suite: mise exec -- node --test --test-reporter=tap tests/enterprise/continuation-v4.test.mjs. These eight additional named assertions are planned, not implemented or executed:

- bootstrap-ordinary-rejection-multiple-input-snapshots-history-only
- bootstrap-ordinary-entire-twelve-receipt-interval-including-failures
- bootstrap-ordinary-intermediate-source-test-only-no-plan-runtime-or-suite-drift
- bootstrap-ordinary-real-builder-phases-and-latest-independent-rejection
- bootstrap-ordinary-reviewed-candidate-exact-latest-prefix-without-recovery
- bootstrap-ordinary-gap-fork-unknown-writer-review-or-tamper-zero-writes
- bootstrap-ordinary-durable-archive-and-atomic-empty-current-projection
- bootstrap-ordinary-no-current-recovery-approval-selection-or-seal-authority

Use the actual compiler and CLI in an isolated orchestrator fixture with the observed three-manifest/two-failure/12-entry sequence, latest ordinary rejection, an earlier completed recovery approval, and atomic new-run initialization. Verify real stdout/stderr, source/test snapshots, receipt outputs, phase identities and durable archive bytes, with filesystem mutation monitoring and bytes/mtime before/after for negative cases. Include multi-prerequisite B04, legacy two-manifest and failed-tail compatibility, and crash/parallel changes. A memory fixture or mocked status alone cannot satisfy the success case. Current runtime 0.71.0 compatibility, full existing regression suite and independent review are mandatory.
