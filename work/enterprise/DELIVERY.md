# Enterprise workflow delivery — 2026-10-20

The user requests implementation and verification of corporate/back-office, management planning/IR, HR/recruiting/labor administration, and executive-assistant workflows using TAKT with appropriate models. This explicitly extends the previous store-only product scope. `work/enterprise/backlog.json` contains 52 issue specifications, including 22 business use cases. The original PRODUCT_GOAL and AC-001–009 remain binding regression obligations.

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

Dependencies are authoritative, but implementation may deliver a thin vertical slice first and expand shared capabilities. None of the 22 use cases may be dropped just to finish. The source catalog is an initial decomposition, not a claim that every possible enterprise process is enumerable; add discovered gaps with stable IDs and evidence.

## Execution and evidence

The enterprise TAKT workflow uses six stages: architecture, separate architecture review, incremental implementation, separate implementation review, release hardening, final independent audit. Revisit implementation/review for each bounded batch. Initial run limit: 60 steps; preserve counts and report remaining work if exceeded, without silently lifting the limit.

Use existing runtime profiles: Sol/medium for design and implementation; promote to Astra/high on repeated implementation failures; Astra/high for authorization, privacy and independent audits. Internal bounded assistance can use Luna/low. Run current model connection checks before launching. Each reviewer has a separate session and readonly capability.

During architecture, create `work/enterprise/plan.json` with batches, Issue IDs, paths, risks, test commands and dependencies. During the first implementation batch, implement `scripts/enterprise/verify.mjs batch|all` and regression tests for its evidence validation. The batch gate must require actual subprocess exits and fingerprint source, configuration, test definitions and outputs, invalidate stale results and reject empty/missing suites. No receipt forged from status prose. Do not weaken the existing verification controller or remove failing tests.

For every leaf Issue retain actual command, exit code, source/test/output hashes, positive and negative assertions, and independent-review report reference. Use OPEN, IN_PROGRESS, READY_FOR_REVIEW, VERIFIED, BLOCKED distinctly. Only update VERIFIED after a separate reviewer has approved that exact evidence; a source change invalidates affected verification. GitHub closing requires VERIFIED and actual persisted parent/child relations. Parent closure requires all descendants verified. GitHub access being unavailable blocks publication/closure, not local implementation.

`batch` must execute and validate all suites for the selected bounded batch; `all` must execute or validate fresh complete evidence for every leaf, full existing regression, browser E2E, connector failures and recovery. A manually changed status or a catalog-only test is insufficient. Final audit must inspect all leaf traces and use `all`. ENT-705 independent approval comes from the final report, never from the implementer.

## Definition of success

A user can start, inspect, approve/reject, delegate, cancel and finish each of the 22 workflows through a real local UI, with the intended effects observable in a separate reference endpoint and a joined audit trail. Unauthorized users cannot obtain protected information via objects, fields, query/count, documents, export, notifications, model inputs or logs. Changes to content, authority or approval invalidate pending execution. Concurrency, cancellation, crash and uncertain external success preserve business invariants. Synthetic-only and unconnected production adapters remain clearly labeled. The final reviewer approves each criterion with fresh machine evidence. The new initiative is not complete merely because the old store release passed.
