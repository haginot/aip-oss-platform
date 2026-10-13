# Store operations and BCP demo specifications

[日本語](./DEMO_SCENARIOS.ja.md)

## 1. Demo purpose

Demonstrate that Ontology, Object, Link, Action, Rule, approval, external updates, events, authorization and evidence connect with the same business semantics, beyond a simple CRUD screen. Every scenario must be reproducible with fixed seed data, and API or UI operations, state transitions, audit records and failure reasons must be traceable through one correlation ID.

## 2. Shared store model

At minimum, treat Tenant, Region, Store, Employee, RoleAssignment, Product, Lot, InventoryPosition, Supplier, RecallNotice, QuarantineCase, TransferOrder, PurchaseOrder, CustomerNotice, Approval, ExternalWriteback and BusinessContinuityMode as Objects. Links represent a store's region, an inventory position's store/product/lot, lots affected by a recall notice, substitute product relationships and approvers' organizational scope.

Actions carry input, target Object, expected revision, actor, onBehalfOf, idempotency key, grounds and policy/rule/definition versions. Consider at least DetectRecallImpact, QuarantineInventory, RequestEmergencyTransfer, ApproveEmergencyTransfer, CreateReplacementOrder, PublishCustomerNotice, AcknowledgeWriteback, EnterContinuityMode, ReconcilePendingWriteback and ExitContinuityMode. Final names and boundaries are established in Ontology review.

## 3. Scenario A: Product recall through substitute procurement

### Initial state

Seed three regions, multiple stores, multiple lots of the same product, inventory in transit, sold quantities, substitute products and regional approval permissions. The external ERP/WMS-equivalent connection is an OSS test double or implemented Adapter with controllable responses for success, explicit failure and success after timeout.

### Success path

1. Ingest RecallNotice and map the affected Product/Lot to stable IDs.
2. Identify affected stores, inventory and inventory in transit through Object/Link queries.
3. Rules calculate quarantine targets, customer notification scope, eligible substitutes and approval routes.
4. An authorized operator executes the quarantine Action, committing inventory revision, Action log and Outbox within the same boundary.
5. Propose Transfers or Purchases for stores with shortages and obtain approval according to amount, region and urgency.
6. Send external updates and record acknowledgments and reconciliation results.
7. Trace the recall notice through the final Action and evidence in the UI or API.

### Required counterexamples

- Attempt to retrieve or modify inventory, cost columns or customer notification targets for stores outside the actor's jurisdiction.
- Race two quarantine Actions against the same expected revision.
- Resend the same input with the same idempotency key.
- Send different input with the same idempotency key.
- Change permissions or target revision after approval and before execution.
- Time out a Writeback that has succeeded externally.
- Switch Rule or Ontology versions and verify treatment of running and new cases.

For each counterexample, observe denial or unique convergence, keep secrets out of reasons and retain audit evidence.

## 4. Scenario B: BCP during WAN/core-system outages

### Failure model

Identify and individually inject the stopped component among the connection from store UI/API to platform, the connection from platform to external ERP/WMS, event delivery, Object store and authorization provider. Do not obscure all component states with the single phrase "network fault."

### Degraded operation

Restrict principals and conditions for entering BusinessContinuityMode. Display available read-model watermarks, permitted Actions, amount/quantity limits, approval and expiry. When authorization cannot be determined, do not broadly permit operations; handle only predefined limited Actions. Held Actions include a unique ID, input hash, actor, timestamp, grounds and target revision.

### Recovery and reconciliation

1. Create a backup/checkpoint and measurement starting point before the fault.
2. Inject timeouts, process restarts and duplicate delivery during external writeback.
3. Stop the platform or a dependent component and operate only within the declared degraded scope.
4. After recovery, query external state and classify items as succeeded, not executed, conflicting or unknown.
5. Choose retry, manual review or compensating Actions, preventing duplicate effects.
6. Rebuild derived indexes from authoritative sources and reconcile permissions and deletions.
7. Measure RPO, RTO, unresolved counts, duplicate counts and lost evidence.

### Meaning of a pass

Set targets in `ops/BCP.md` during implementation, separating the demo environment from production assumptions. Users must see which operations were denied, held or permitted, rather than faults being concealed as normal operation. After recovery, all held items must converge to a unique final state or explicit manual review.

## 5. Demo evidence

For each scenario, retain the seed version, execution command, inputs, key screens/API responses, Object/Action/Event/Audit correlations, failure injections, expected results and actual results. Map recordings or images to machine-readable artifacts in the manifest as well.
