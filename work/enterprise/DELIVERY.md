> SCOPE REVISION 4 — 2026-10-21: current backlog has 190 Issues / 124 business use cases. Revisions 3 and 4 add BUSINESS_PLANNING_EXPANSION.md, INFORMATION_LIFECYCLE_EXPANSION.md, ENT-2400–2415 and ENT-2500–2506, plus requested-scenarios/disclosure-lifecycle.json. Read these requirements and revise the plan through design-architecture and separate review before implementation or acceptance. Preserve original ACs and all useful code/evidence. Older counts below and in task prompts are historical.

> BOUNDED CONTINUATION — run 20261020062537-e8806144 stopped at 60/60 with Max steps reached. The user authorizes continued local implementation and official restart. Keep max_steps at 60 for each bounded run and preserve old central state, reports, receipts and failures. Latest review enterprise-04-batch-review.md approves exact B05 receipt 1792531345355-969f3f41-2a2e-49f4-987d-1b745fd6e026 only; its attestation is not imported yet, and B00–B04 require current reapproval. Archive this as history through the validated continuation mechanism, never promote historical approval to a new run. Update CONTINUATION.md and review the new boundary before initialization. Re-examine the repeated prefix-review workload when planning bounded progress without weakening current-evidence validity or review independence. Do not silently raise limits or claim expanded scope fits in one run. Confirm current model connections, retain Sol/medium implementation and Astra/high independent review/security routing.

> SCOPE REVISION 2 — latest user instruction (2026-10-20): include PR, marketing, information governance and every enterprise department/business lifecycle. Read SCOPE_EXPANSION.md and the current backlog before selecting/reviewing a batch. Earlier 52-Issue/22-use-case counts in run prompts and frozen workflow bundles describe revision 1 and are superseded. Preserve useful in-progress foundation work, but return to design-architecture and independent review to revise plan/coverage before claiming expanded-scope completion. The old architecture approval does not approve this new scope. Do not erase prior evidence or silently increase the 60-step limit.

# Enterprise workflow delivery — 2026-10-20

The user requests implementation and verification of corporate/back-office, management planning/IR, HR/recruiting/labor administration, and executive-assistant workflows using TAKT with appropriate models. This explicitly extends the previous store-only product scope. `work/enterprise/backlog.json` contains 171 issue specifications, including 117 business use cases. The original PRODUCT_GOAL and AC-001–009 remain binding regression obligations.

## Baseline and authority

The product baseline is local commit c66f5d5, completed by TAKT task 711dd411-c7ca-4a82-98b4-3eddaebd8c8e. Its final independent review is in the central run 20261012054516-f3f7e52d, report 14-final-audit.md. This proves that original bounded release was approved then; it does not certify the new enterprise scope or fresh receipts today. Preserve the pre-existing modified adapter-trace.json. Do not operate the research task or rewrite TAKT central state files.

Use synthetic records and independent local HTTP reference systems. Implement real persistent workflows, public APIs and usable browser screens, not static demonstration cards. Existing business contracts must be generalized rather than bypassed with separate ungoverned CRUD or direct DB calls from business packages. Reuse the existing PostgreSQL/authorization/Action/Outbox/Audit foundation. A reference connector passing locally is not a verified Google, Microsoft, accounting, payroll or signature-service connection. Report each capability and deployment limitation accurately.

The user authorizes ordinary implementation, local commits, tests and Issue creation at the repository they specify. Until that destination is known, retain local issue IDs and do not create a new GitHub repository or publish to a guessed location. No real email, public IR disclosure, money transfer, offer delivery, calendar invitation, real personal data, production writes or new paid resources is required or authorized. These external effects must use synthetic reference endpoints. Company-specific law, policy, retention and approval thresholds are configurable and need deployment-owner validation; do not claim universal compliance.

## Scope and batches

1. Common platform ENT-101–112: baseline, organizational ontology, authentication/authorization, approvals, durable workflows, documents, AI boundary, connectors, audit, publication, recovery and package SDK.
2. Back office ENT-201–206.
3. Management and IR ENT-301–305.
4. HR ENT-401–407.
5. Executive assistance ENT-501–504.
6. Portal, authoring, connectors and AI UI ENT-601–605. Build minimal usable portal early alongside the first domain slice; do not postpone all UI until the end.
7. Cross-domain acceptance, adversarial testing, resilience, release and independent audit ENT-701–705.

Dependencies are authoritative, but implementation may deliver a thin vertical slice first and expand shared capabilities. None of the 117 use cases may be dropped just to finish. The source catalog is an initial decomposition, not a claim that every possible enterprise process is enumerable; add discovered gaps with stable IDs and evidence.

## Execution and evidence

The enterprise TAKT workflow uses six stages: architecture, separate architecture review, incremental implementation, separate implementation review, release hardening, final independent audit. Revisit implementation/review for each bounded batch. Initial run limit: 60 steps; preserve counts and report remaining work if exceeded, without silently lifting the limit.

Use existing runtime profiles: Sol/medium for design and implementation; promote to Astra/high on repeated implementation failures; Astra/high for authorization, privacy and independent audits. Internal bounded assistance can use Luna/low. Run current model connection checks before launching. Each reviewer has a separate session and readonly capability.

During architecture, create `work/enterprise/plan.json` with batches, Issue IDs, paths, risks, test commands and dependencies. During the first implementation batch, implement `scripts/enterprise/verify.mjs batch|all` and regression tests for its evidence validation. The batch gate must require actual subprocess exits and fingerprint source, configuration, test definitions and outputs, invalidate stale results and reject empty/missing suites. No receipt forged from status prose. Do not weaken the existing verification controller or remove failing tests.

For every leaf Issue retain actual command, exit code, source/test/output hashes, positive and negative assertions, and independent-review report reference. Use OPEN, IN_PROGRESS, READY_FOR_REVIEW, VERIFIED, BLOCKED distinctly. Only update VERIFIED after a separate reviewer has approved that exact evidence; a source change invalidates affected verification. GitHub closing requires VERIFIED and actual persisted parent/child relations. Parent closure requires all descendants verified. GitHub access being unavailable blocks publication/closure, not local implementation.

`batch` must execute and validate all suites for the selected bounded batch; `all` must execute or validate fresh complete evidence for every leaf, full existing regression, browser E2E, connector failures and recovery. A manually changed status or a catalog-only test is insufficient. Final audit must inspect all leaf traces and use `all`. ENT-705 independent approval comes from the final report, never from the implementer.

## Definition of success

A user can start, inspect, approve/reject, delegate, cancel and finish each of the 117 workflows through a real local UI, with the intended effects observable in a separate reference endpoint and a joined audit trail. Unauthorized users cannot obtain protected information via objects, fields, query/count, documents, export, notifications, model inputs or logs. Changes to content, authority or approval invalidate pending execution. Concurrency, cancellation, crash and uncertain external success preserve business invariants. Synthetic-only and unconnected production adapters remain clearly labeled. The final reviewer approves each criterion with fresh machine evidence. The new initiative is not complete merely because the old store release passed.

## Operator control: running workflow snapshot (2026-10-20, review AR2-01)

TAKT task `acffa2a7-06d7-4742-864f-a009381456c4`, run `20261019154241-6bc5b71c`, executes a published workflow bundle prepared at launch. Confirmed in TAKT `features/tasks/execute/workflowExecution.js`: prepare, publish and load the bundle, then bootstrap its `rootWorkflow`. Editing the source workflow YAML alone does not replace the live run's command gates. Both the running release and final-audit gates invoke exactly `mise exec -- node scripts/enterprise/verify.mjs all`, after the step report.

Address AR2-01 against that actual execution contract as well as the proposed YAML. The final gate must validate the exact frozen release evidence approved by the independent auditor without regenerating tests/receipts or changing evidence/progress. Explicitly account for the current bundle's unchanged `all` entry point (for example, separate explicit release generation from read-only `all` verification), or document a supported continuation boundary that reloads the revised workflow before relying on changed commands. An edited YAML is not evidence that the active bundle changed. Never edit central run state/bundle files, stop a healthy worker, or silently raise the 60-step limit. Include the live-bundle case in the architecture review and meaningful counterexample checks.
