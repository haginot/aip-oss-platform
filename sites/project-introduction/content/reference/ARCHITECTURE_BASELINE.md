# Architecture Baseline

[日本語](./ARCHITECTURE_BASELINE.ja.md)

## 1. Sources and purpose

This baseline summarizes the 2026-10-10 reference design, `aipf-modular-architecture-20261010`, as design input for implementation. The source artifacts are a reference design and candidate catalog, not evidence that Adapters or execution infrastructure have been implemented. Source file hashes are pinned in the repository's `architecture/SOURCE_BASELINE.json`.

## 2. Core principles

Center business semantics, public contracts and capabilities rather than product names. Business UI, Rules and Agents call shared typed contracts; product-specific SQL, SDKs, authentication and retries remain inside Adapters. Replaceability means verified functional fit, semantic differences, state migration and rollback, beyond similar API shapes.

The platform owns these six boundaries:

1. Ontology: Object IDs, types, units, Links, Actions, authoritative sources per property and definition versions.
2. Object API: get, finite filters, cursors, revisions, freshness, projections and authorization.
3. Action Engine: actor/delegation, constraints, expected versions, idempotency, approval, state and evidence.
4. Authorization composition: relationships, attributes, environment, deny precedence, trusted context and revocation.
5. Event/Evidence: IDs, schema/versions, causality, retries and evidence of Actions and decisions.
6. Publication management: diff, compatibility, simulation, review, publish, migration and rollback.

## 3. Execution paths

- Reads pass through authentication, Object API, required authorization, authoritative state or projections, and row/column controls, returning revision and freshness.
- AI retrieval establishes a trusted principal before searching the permitted scope. Unauthorized content must not reach the model.
- AI execution stops at typed Action proposals. The Action Engine rechecks the execution-time principal, delegation, permissions, constraints, versions and approval.
- Updates atomically cover Object revision, Action records and Outbox within the same Unit of Work. Do not claim a single transaction extending to external ERP systems or audit storage.
- Dynamic processing may generate proposals from Events/Timers but must pass through the Action boundary again. Control loops with causation IDs, idempotency and limits on executions and cost.

## 4. Shared semantics

ObjectRef includes tenant, type and a stable object ID. Treat ObjectRevision, DefinitionVersion, PolicyVersion, RuleVersion, ModelVersion, IndexWatermark and SourcePosition as distinct types. Separate business-valid time from recorded time; monetary values include currency and precision, and quantities include units. Distinguish NULL from unspecified values.

Every Port defines timeout, cancellation, trace, version, authentication context, size limits and typed errors. At minimum, provide InvalidInput, Denied, Conflict, NotFound, UnsupportedCapability, Unavailable, DeadlineExceeded, RateLimited and InconsistentState. Distinguish retryability from idempotency.

## 5. 47 responsibilities

Record every responsibility as `selected`, `provided` or `not-needed`; do not cross the Architecture gate with any `undecided` responsibility. One product or module may serve multiple responsibilities, but verify guarantees for each role.

| Area | role IDs |
|---|---|
| data | ingest, cdc, pipeline, transform, quality, identity-map, blob, lake-table, analytics |
| semantic | ontology, object-api, object-store, graph, text-search, retrieval, history, metrics |
| kinetic | rules, compute, action, workflow, writeback |
| dynamic | event, stream, trigger |
| ai | agent, model, embedding, parse, ai-eval, guard, feature |
| security | identity, relationship-auth, attribute-auth, delegation, secrets |
| ops | metadata, audit, observability, schema-release, deployment, gateway, cache, recovery |
| ux | business-ui, authoring-ui |

In particular, ontology, object-api, action, identity, attribute-auth, delegation, secrets, audit, observability, schema-release, deployment, recovery, business-ui and authoring-ui are mandatory initial-release responsibilities. This does not require dedicated products: specify contracts and verification even when the same process or existing infrastructure provides them.

## 6. Implementation order

Start with minimal Ontology types, Object API, Action, authorization, state/Outbox and audit evidence. Next, connect Workflow, external updates, events and UI vertically through the store scenario. Then add AI, search, advanced streams and analytics according to actual scenario needs.

Prefer a small number of components in the initial default OSS composition. PostgreSQL may provide state, links, history and Outbox together. Do not add dedicated graph, vector, broker or workflow engines until their required capability profiles and operational value are demonstrated.

## 7. Replacement and migration

- Stateless connections: parallel validation, routing cutover and rollback.
- Search/graph projections: rebuild from authoritative sources, shadow comparison, freshness/deletion/ACL reconciliation.
- Authoritative state/Events: snapshots and CDC, write freeze points, reconciliation, cutover, resume positions and rollback.
- Workflow: complete old executions on the old infrastructure and switch new starts.
- Authorization/Rules: compare decisions using the same positive and negative corpus.
- Model/embedding: rerun business evaluations and re-embed/reindex when required.

For initial-release AC-007, execute at least one of these. A mock replacement or a rename of the same implementation does not count as a replacement demonstration.

## 8. Cross-cutting tests

For state and Actions, test concurrent updates, retries, different inputs and partial failures. For authorization, cover get, list, search, column, count, Action, revocation and decision failures. For AI, reject invalid principals, unauthorized tools, stale approvals and insufficient grounds. For Events, address duplication, reverse ordering, missing events, replay and schema updates. For Workflow/Writeback, cover timeouts, pending approval, retries, compensation and unknown success. For recovery, actually restore a consistent point covering state, definitions, key references, permissions and execution history.

These are pre-implementation test specifications. Documentation alone does not constitute verification.
