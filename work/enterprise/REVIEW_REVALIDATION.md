# Invalid review binding: independently ordered evidence revalidation

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

Status: PLANNED_NOT_IMPLEMENTED; design-architecture iteration 14, run 20261022093752-59e717db. This is a new evidence-only authority, requiring independent review before implementation. It grants no Issue approval, selection or release authority. REJECTED_REGENERATION.md remains strict for every existing rejection and approval; the sole additional transition is specified here. ENT-101/B00 owns implementation within the already selected B01.

## Observed failure and reachable workflow

Iteration 12 emitted an APPROVE closure with a nonexistent `recovery.resultPath` in both phases. Its report itself says import is blocked. Iteration 13 import rejected `review recovery binding`; progress and entry selection remain unchanged. The correct root is `a3f6384284148b2ecb3f4ffbc99a0fe7d9fa0823f5fc270cd1a1cfe87fb211d5`; the erroneous path omits `cd` after `270`. The actual attempt is `c1820bde-5512-4cf9-8997-afee581a8336`, sequence 4. Exact raw report/phase/candidate/header/result bindings are in plan.rejectedRegeneration.reviewRevalidation.target and the iteration-14 read-only diagnostic. These values are observations to authenticate, never substitutes for orchestrator authority.

Current chain() binds the first review after the terminal and does not support replacing it with a later corrected report. prepare() requires REQUEST_CHANGES, so this invalid APPROVE cannot authorize another attempt. Frozen workflow routes architecture review to build and only a successful build gate to foundation review. Merely requesting another foundation APPROVE leaves this execution path blocked. Do not modify central workflow, replay a previous rejection, normalize a path during import, or fabricate a successful gate to reach the reviewer.

The reachable path is: independent architecture review with explicit revalidation order D → real Astra/high build of this extension → full B00/B01 machine execution → new foundation review J → strict atomic import → ordinary B02 selection. The old review A remains INVALID_RECOVERY_BINDING forever. D is a new instruction to revalidate evidence, not a corrected A, a REQUEST_CHANGES fabrication or a product APPROVE. Design changes already invalidate the old receipts as current inputs; full execution is mandatory even if another case has unchanged inputs.

## Narrow authentication before writes

Authenticate the fixed original selection, approval, ordinary-refresh root and every attempt, failed receipt, publication checkpoint and review up to A using their original plan/input/suite definitions. For current permission, A must be the latest completed foundation review in this run, reviewing the latest published passed terminal preceding its own start; no later/incomplete/unknown-scope foundation occurrence may be ignored. At first application of D there may be no unexplained attempt after that reviewed terminal. On retry, subsequent terminals must belong to the fully authenticated D-authorized chain. A stays bound to its reviewed terminal, not to the newest retry receipt. Historical acceptance evaluates this ordering at the actual D occurrence, never requires A to remain the latest review after a fresh valid J. The complete historical index interval, outputs, original ACs and independent sessions remain mandatory. No caller-supplied historical context or arbitrary report path is public authority.

For A authenticate its canonical report against actual Phase 1/2, completion record, compiled readonly Astra/high and provider session distinct from all builders and D's reviewer. Require both legacy and closure APPROVE blocks, exact candidate/members, complete original Issue/AC APPROVE decisions and real artifact references, empty machine unresolvedFindings, and all receipt/output hashes. Use the complete closure decision checks, not merely the weaker rejection-scope reader. Historical input validation is internal to this evidence-only order and never counts as current acceptance.

The only allowed defect is `/recovery/resultPath`: all other fields must equal the authentic terminal reviewed by A, and there must be no missing/extra fields. Accept only the exact legacy unversioned six-field recovery shape or the schemaVersion=2 typed-authority shape below. In the latter case also authenticate the entire preceding typed authority, including any earlier revalidation order; it cannot be replaced or dropped. The original resultPath must be a confined relative, nonsymlink, nonexistent path; do not dereference an unconfined value. Reject existing foreign targets, traversal, aliases and any additional defect. Derive the exact expected path from the authenticated root/attempt; verify its raw bytes/hash, result.headerSha256, published journal and candidate. Do not mutate A in memory into an APPROVE that can reach an importer. Explicitly classify the discrepancy as INVALID_RECOVERY_BINDING and preserve A's raw bytes, including its blocking prose.

D is the latest completed independent `review-architecture` occurrence after A, not a local fixture or builder report. Require actual readonly Astra/high, canonical output contract, identical blocks in both phases, step completion, actual provider session distinct from A and every builder. Verify D before the current real Astra/high builder occurrence. Revalidate complete authority and current inputs before lock, under lock and before candidate publication. A changed, incomplete or newer review stops execution. A valid foundation APPROVE cannot be invalidated through this path.

## Explicit order and versioned lineage

The existing `enterprise-recovery-design-attestation` gains schemaVersion=2 only for this extension. It retains every schema-1 identity, verdict=APPROVE, permission=EVIDENCE_REGENERATION_ONLY, unresolvedFindings=[], contractPath/contractSha256 for REJECTED_REGENERATION.md and planSha256. Add exactly `revalidation` with these fields:

| Field | Required value/binding |
|---|---|
| purpose | REVALIDATE_INVALID_REVIEW_ONLY |
| contractPath / contractSha256 | work/enterprise/REVIEW_REVALIDATION.md and raw bytes hash |
| invalidReview | runSlug, workflowRef, iteration, step=review-foundation, sessionKey, actual providerSessionId, start-record index, Phase 1/2 content hashes, report raw SHA-256 |
| rootId / candidatePath / candidateSha256 | Authentic unchanged root and candidate reviewed by A |
| invalidRecovery | Exact original versioned recovery object in both phases of A (legacy six fields or typed schema 2) |
| expectedRecovery | Exact same-version object derived from the authentic header/result, differing only at resultPath |
| allowedDifference | /recovery/resultPath |
| disposition | KEEP_INVALID_REVIEW_AND_RERUN_FULL_PREFIX |

The independent reviewer must inspect the historical chain and exact discrepancy before emitting D. A generic architecture APPROVE, a schema-1 design attestation, plan.pending/null values, self-asserted identity or this document is not an order. Never generate an approval block on the reviewer's behalf. A new contract or plan requires a new D binding those bytes and the same latest A. Source/test changes under that approved plan require new input evidence. The report raw hash is calculated externally; no self-hash is embedded.

Preserve root schema 1/2, existing header schema 1, receipts and old reviews byte-for-byte. New attempt headers use schemaVersion=2 and a tagged `authority`, replacing `parent` rather than overloading its rejection semantics:

- `{kind: SCOPED_REJECTION, review: <authenticated occurrence/raw report/candidate refs>}` for a new genuine rejection. A valid schema-1 rejection remains usable through its unchanged validator.
- `{kind: DESIGN_REVALIDATION_ORDER, design: <D occurrence/raw report refs>, invalidReview: <A occurrence/raw report refs>, reviewedTerminal: <path/raw hash>, invalidRecovery, expectedRecovery}` for the one explicitly ordered bridge. All fields are independently recomputed from actual records. Unknown kind/version/extra authority fields fail closed.

Header retains run/root, sequence, previous terminal, exact plan text/input manifest/suite definitions/index prefix, real builder and current design approval. A header never claims A was rejected or approved successfully. Its raw hash binds authority. Candidate recovery schemaVersion=2 contains rootId, attemptId, headerPath/headerSha256 and `authority` exactly matching the header; it contains no result reference. The new review's recovery schemaVersion=2 contains rootId, attemptId, headerSha256, resultPath/resultSha256 and the identical `authority`. No parentRejectionReportSha256 is invented for D. Exact field sets are enforced by version. Reference order remains D/A/prior terminal → header → receipts → candidate → result → new independent review; there is no candidate/result hash cycle.

The history reader traverses every actual review/design occurrence in order. An invalid A cannot be skipped: only its exact subsequent D accounts for it. D bridges that A and its reviewed terminal once in the authority sequence. Failed/interrupted retries under D retain a contiguous terminal chain and the same D; a second application of D across a newer foundation review is forbidden. Post-report repeat with identical D/current input and completed publication returns the same attempt/receipts. New input before any new foundation review permits full-prefix retry; a plan change also requires a new matching design order targeting the same A and explicitly superseding the earlier order. Preserve both orders and all intermediate attempts; authenticate the whole sequence, without demanding that A reviewed those later receipts. No older successful candidate fallback is allowed.

After a new REQUEST_CHANGES J, the next attempt uses J's new SCOPED_REJECTION authority and the current independent design approval (schema 1 is sufficient for rejection authority; historical D is still verified). After exact APPROVE, generation ends and only normal import can update approvals. A second malformed APPROVE requires a distinct subsequent D for that exact review/terminal, retaining the first bridge. No permanent exemption is attached to a root, session or report path. Later incomplete, unknown or unrelated review scopes fail closed for this active prefix.

## Writes, recovery and consumer integration

The implementation must update the common history validator used by generation, closure acceptance, later approval validation and new-run archival. All consumers authenticate the same typed transitions; acceptance authenticates historical D without demanding that it is still current generation permission. Subsequent actual reviews continue to supersede approvals normally. New-run archival of an invalid A already authenticated by D, or its failed tail, may preserve the whole validated history only with empty new-run approvals. An invalid A without authenticated D still blocks this initializer path. No old-run D grants current permission, and same-run reinitialization remains forbidden.

No new CLI bypass: `verify.mjs batch` and `batch --recover-rejected` discover the current order from actual TAKT records. Dispatch only after the original selection is authenticated and the classified INVALID_RECOVERY_BINDING plus exact D passes all checks. Do not catch arbitrary assertion messages or turn gate failure into success. The frozen workflow command stays unchanged and executes the real complete prefix before exit 0. Tests must use actual compiler/session/phase and CLI subprocess fixtures; none are written into the real central run.

Allowed writes remain new attempt/header/result, immutable A/D copies, journal/head, new runs/index suffix, unapproved candidate and own lock lifecycle. progress, original selection/root, all old evidence/index prefix, protected files and central state remain unchanged. Writer failure never grants approval. Lock/CAS, interrupted attempts, publication order, no live-lock theft and idempotency are the existing REJECTED_REGENERATION section 3 rules, now binding typed authority too. Record failures even when later retries pass.

Always execute every B00/B01 suite including fresh isolated store baseline, original regressions, BF-42/BF-43 before/after evidence and this extension's tests. The new exact six-Issue/fifteen-AC foundation review must bind the new versioned recovery fields in both phases. Only strict current-input/current-output/latest/exact-review atomic import may grant VERIFIED and clear active B01. B02/seal/final reject before that. Old A can never be imported, even if current inputs happen to match its candidate.

## Required runtime acceptance (planned, not run)

Extend ENT-101's existing rejected-regeneration-regressions command, retaining all 40 assertions, with these 16 named assertions. Test real pre-extension rejection, new D/new receipts/fresh independent review/import/normal B02 selection, plus FS bytes/mtime and write interception for negative cases. Restore fixtures between cases; standalone tests do not replace the full prefix receipt.

- recovery-revalidation-original-malformed-approve-rejected-and-preserved
- recovery-revalidation-explicit-independent-design-order-required
- recovery-revalidation-only-result-path-defect-accepted
- recovery-revalidation-real-phases-sessions-and-all-AC-binding
- recovery-revalidation-invalid-or-existing-path-zero-writes
- recovery-revalidation-original-root-and-full-history-strict
- recovery-revalidation-full-prefix-new-receipts-before-fresh-review
- recovery-revalidation-versioned-authority-no-fake-rejection-or-hash-cycle
- recovery-revalidation-new-rejection-and-second-invalid-review-chain
- recovery-revalidation-later-incomplete-review-and-order-replay-rejected
- recovery-revalidation-changed-plan-new-design-order-required
- recovery-revalidation-crash-concurrent-authority-and-input-failure-retained
- recovery-revalidation-idempotent-frozen-post-report-gate
- recovery-revalidation-exact-import-only-then-normal-selection
- recovery-revalidation-progress-old-evidence-and-protected-bytes-unchanged
- recovery-revalidation-history-only-initialization-and-final-zero-write

Structural check-design validation verifies this plan and rejects unsafe settings only. It does not implement the order, authenticate a future reviewer, execute these assertions, repair the original report or approve B00/B01.
