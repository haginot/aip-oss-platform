# Product Goal: An interchangeable OSS business platform with AIP-equivalent capabilities

[日本語](./PRODUCT_GOAL.ja.md)

## 1. Goal

Complete an OSS platform in which we own the business semantics and public contracts, and can replace implementations of state, search, authorization, Workflow, AI and audit through Ports and Adapters. Instead of replicating Palantir product internals or screens, implement the capability to connect data, logic, Actions, permissions, AI and evidence around Ontology as verifiable public contracts.

The first completed version must reproduce and demonstrate complex normal store operations and BCP in a local or OSS-only verification environment. The demonstrations cover these two scenarios:

1. Normal operations connecting a product lot recall to identification of affected stores, inventory and customer handling, quarantine, approval, substitute procurement, external updates and audit.
2. BCP covering degraded operation during WAN or core-system outages, holding writebacks with unknown success, and reconciliation, deduplication and compensation after recovery.

## 2. Definition of completion

Completion means satisfying the following acceptance criteria with reproducible evidence and obtaining final approval from a reviewer in a session separate from the implementer. It is not measured by the number of products installed or by agent self-reporting.

| ID | Acceptance criterion | Observable passing condition |
|---|---|---|
| AC-001 | Reproducible startup | Start the OSS composition in a new environment through one documented entry point and automatically verify seed data, health checks and demo prerequisites. Do not require secrets or paid or proprietary services. |
| AC-002 | Ontology-centered Kernel | Provide versioned Ontology, Object retrieval, finite queries and link traversal, updates with expected versions, typed Actions, Action state, Outbox and audit evidence with public contracts and contract tests. |
| AC-003 | Authentication, authorization and delegation | Establish actor and onBehalfOf at the trust boundary and test permission and denial for individual retrieval, lists, search, columns, Actions and AI tools using the same business semantics. Fail closed on faults and include counterexample tests. |
| AC-004 | Consistency and failure handling | Test concurrent updates, same-key retries, key reuse with different inputs, timeouts, partial failures and reversed ordering. Prevent duplicate effects, unrecorded updates and inconsistencies between audit records and Objects. |
| AC-005 | Demonstration of complex store operations | Demonstrate product recall and substitute procurement success, permission denial, conflicts, pending approval and failed external updates through a UI or API. Trace each decision to its Ontology version, rule version, principal and evidence. |
| AC-006 | BCP demonstration | Inject WAN/core-system outages, unknown success, restarts, recovery and reconciliation. Measure the declared degraded-operation scope, RPO/RTO, data loss, duplicates and unresolved items. Complete at least one clean recovery exercise. |
| AC-007 | Replaceability | Demonstrate shadow comparison, difference checks, cutover and rollback for at least one Adapter that holds state or has semantic differences. Compare types, versions, authorization, retries and migration, beyond the shape of a common API. |
| AC-008 | Operable OSS | Address the default composition's licenses, SBOM, vulnerabilities, secrets, backup, observability, upgrades, rollback and data retention through documentation and automated checks. The default path must be redistributable as OSS. |
| AC-009 | Independent final audit | Trace AC-001 through AC-008 individually to current code and evidence, and obtain approval from both machine gates and an independent reviewer. Do not present unverified items, failures or constraints as completion. |

## 3. Architectural invariants

- The platform owns the semantics of Ontology, Object API, Action, authorization composition, Event/Evidence, publication and version management. Do not expose product SDKs to business code.
- Do not split 47 responsibilities into 47 services. Retain decisions for every responsibility, but start with a small number of modules and minimal OSS such as PostgreSQL.
- AI may propose Actions but does not itself confer execution authority. The Action Engine rechecks the execution-time principal, delegation, permissions, constraints, expected version, approval and idempotency.
- Do not claim exactly-once execution or a single transaction extending into external systems. Handle unknown success through Outbox, at-least-once delivery, reconciliation and compensation.
- Do not substitute search indexes, vector stores, AI traces or Lineage for authoritative business state or audit evidence.
- The default development and demo paths must be reproducible using OSS alone. Isolate optional cloud or commercial Adapters as additional profiles.

## 4. Scope

### Included

- Minimal paths for Ontology/Schema definition, validation, versioning, differences, publication and rollback
- Public Object/Query/Link/Action APIs and typed clients
- State, expected versions, Unit of Work, Action log, Outbox and audit evidence
- Authentication, relationship or attribute authorization, service principals and acting on behalf of users
- Workflow, external updates, events, observability and recovery to the extent required by the two demonstrations
- Authorized retrieval, structured proposals, evaluation and tool constraints when using AI
- Authoring/Business UI or equivalent operational interfaces
- Development environment, test data, failure injection and demo runbooks

### Out of scope for the initial release

- One-to-one replication of all Palantir features, internal implementations, brands or UI
- A dedicated product for each of the 47 responsibilities
- Demonstrations using personal data from production stores or real customers
- Automated final decisions concerning regulation, accounting, employment, medicine or safety
- Production multi-region SLAs or performance guarantees for unlimited data volumes
- Unapproved paid APIs, cloud resources, external publication, pushes or deployments

## 5. Evidence and quality

For each acceptance criterion, connect the specification, tests, commands, input versions, output hashes, execution results and known counterexamples to `evidence/ACCEPTANCE_MATRIX.md`. Declare verification runs in `verification/plan.json`, and accept only passing records that match current input hashes. Include denial, conflicts, duplicates, timeouts, partial faults and recovery alongside success cases.

UI screenshots and demo videos are supporting evidence; they cannot replace state, audit or test results. Design documents alone, empty tests, mocks alone and commands that always succeed are not completion evidence.

## 6. Autonomous execution boundaries

TAKT may autonomously research public information, propose OSS selections, and create and revise code, tests, local containers, seed data, documentation and execution records. It must not weaken existing acceptance criteria to obtain a pass.

Development model calls are authorized only within the approved Luna/Sol/Astra allocation, the authenticated Codex account and the initial 60-step run. This does not authorize requiring paid models at product runtime. New API contracts, additional purchases, separately billable resources and unconditional removal of limits are not authorized. Step counts do not guarantee spending; inspect allowance and consumption through run records.

For the following matters, do not infer permission. Stop only the dependent steps and request human judgment:

- Use of real stores, real customers, personal data, confidential information or external participants
- Paid services other than the approved development models, billable computation or deployment to external environments
- Unresolved licensing or trademark questions about distribution
- Data destruction, writeback to existing environments, publication, pushes, PRs or credential changes
- Substantial changes to AC meanings, intended product users or initial-release scope
- The same blocker repeating three times without further technical work adding information

## 7. Resources and Stop conditions

Limit the initial autonomous run to 60 workflow steps and prefer a composition that runs on local CPU and memory. Do not perform large model training, lengthy load tests or extensive external communication. Reaching the step limit is incomplete, not success. Retain TAKT checkpoints and reports, inspect the cause and then resume.

Even before product completion, use `ABORT` when external approval, unavailable credentials, licensing issues or an unreproducible provider failure prevents continuation. Preserve passed gates, unmet ACs, the resume point and required human judgments.
