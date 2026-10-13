# Product delivery loop with TAKT

[日本語](./DELIVERY_LOOP.ja.md)

## 1. Purpose

This mechanism retains product completion state, evidence, return destinations and stop conditions as version-controlled artifacts, beyond asking a long prompt to finish everything. TAKT executes stages; completion requires both machine gates and independent review.

## 2. Three control planes

### Workflow control

`.takt/workflows/platform-lifecycle.yaml` defines the order and return destinations for goals, design, planning, implementation, demos, BCP, release and final audit. Implementers and reviewers use different `session_key` values. Reviewers return work to the earliest stage containing the cause, rather than the stage where the problem appeared.

### Artifact control

`PRODUCT_GOAL.md`, `architecture/composition.json`, `work/ROADMAP.json`, `verification/plan.json` and `evidence/ACCEPTANCE_MATRIX.md` are authoritative, rather than conversation. Regenerate the relevant evidence when changing composition, roadmap or tests.

### Evidence control

`scripts/platform-control.mjs run-stage <stage>` executes verification-plan argv arrays without a shell. It hashes each suite definition, pre-execution input files and output artifacts into the manifest. Changed inputs during verification, missing required outputs, command failure or timeout cause failure. It saves running state at execution start; if the latest execution is running or failed, an earlier passed execution cannot be reused. Changes to inputs, outputs or suites after success also invalidate old receipts. A written statement that tests passed previously cannot pass the gate.

This is not signed third-party certification. Independent review rejects hollow checks and attempts to conceal defects through narrow inputs.

## 3. Stages and return destinations

1. `frame-goal` / `review-goal`: establish completion criteria, scope and stop conditions. Stop when a value judgment is required.
2. `design-architecture` / `review-architecture`: decide each of the 47 responsibilities as selected, already provided or not needed, with contracts, versions, licenses and verification.
3. `plan-roadmap` / `review-roadmap`: map all ACs to milestones with dependencies and make Platform Kernel the first implementation unit. Machine checks reject unknown dependencies, self-dependencies, cycles, empty outcomes and missing AC coverage.
4. `build-foundation` / `review-foundation`: build a minimal vertical slice of Ontology, Object, Action, authorization, state, Outbox and audit.
5. `build-store-demo` / `review-store-demo`: demonstrate product recall and substitute procurement, including success, denial, conflicts and external failures.
6. `build-bcp` / `review-bcp`: measure failure injection, degraded operation, recovery, reconciliation and compensation.
7. `harden-release`: verify Adapter replacement, startup, operations, licenses, SBOM, vulnerabilities, backup and rollback.
8. `final-audit`: independently review evidence for each AC and return `COMPLETE` only when all are satisfied.

After three repetitions of each major loop, a progress judge assesses whether the same findings are merely rephrased or substantial information has been gained. Models per stage and promotion on revisits follow the [model operating policy](MODEL_POLICY.md). Step limits and `ABORT` stop incomplete work and are distinct from completion.

Explicitly set `command_gates: skip` when gated stages stop for human judgment or final-audit and other stages return work to the cause. This prevents failed gates from blocking transition to stopping or repair stages; approval paths retain their gates. The final audit is readonly and must not rewrite the matrix to PASS itself. The release owner sets AC-001 through AC-008 to PASS and AC-009 to READY_FOR_REVIEW. Final completion combines all current receipts, independent approval in `14-final-audit.md` and TAKT's COMPLETE.

## 4. Verification stages

The `stage` field in `verification/plan.json` has these meanings:

| stage | Minimum coverage |
|---|---|
| mechanism | Self-checks of supervision scripts, workflow and initial goal |
| implementation | Kernel unit, contract, integration and negative tests |
| demo | Product recall and substitute procurement end-to-end tests and failure paths |
| bcp | Outage, restart, reconcile, restore and RPO/RTO measurements |
| release | Clean bootstrap, Adapter replacement, license/SBOM/security and full regression |

Suite `inputs` must identify files or directories explicitly; do not use project root `.` or normalized aliases of it. Empty directories, symlinks and references outside the project are also rejected. List generated artifacts in `outputs`. Commands must be argv arrays rather than strings, and no-check commands such as `true` or `echo` cannot serve as passing evidence. Machine checks cannot identify every kind of no-check command, so semantic review remains necessary.

The release gate reruns mechanism and implementation/demo/bcp/release. The final gate is readonly and compares only the latest receipts; product inputs must not change during the audit.

## 5. Inspecting status and resuming

`npm run platform:status` evaluates machine gates in order. The first failure is the current work boundary. Use `npx takt list` to inspect TAKT task status, branch, run and resume point.

Distinguish these failure cases:

- Reproducible implementation or test defects: resume at the causal stage.
- Temporary provider/environment faults: requeue from the same position.
- Reaching `max_steps`: inspect the report and remaining ACs, and resume from the saved position only if continuation has value.
- Awaiting human judgment: retain the `ABORT` reason and options; do not proceed using an assumed default.

`--ignore-exceed` ignores only the step limit. It does not bypass quality gates, stop conditions or external permissions. Use `npm run platform:run -- --ignore-exceed` only when spending and infinite loops can be monitored. There is currently no spending-based forced stop or automatic requeue after reaching the limit. This is a finite development loop in which a human checks completion, resumption and pending decisions.

## 6. Branch operations

Registered tasks use `worktree: true` for isolated clones. `platform:run`, `platform:start` and `platform:autonomous` share the same entry point and check uncommitted artifacts, authentication, model connections and machine-verification freshness before starting. Clones lack node_modules, so the first stage runs `npm ci`. Absolute paths to design sources refer to this development environment and must not become runtime dependencies of the completed product.

Success leaves a branch and run report. Before integrating into root, inspect the diff in `takt list` and the final audit. Automatic PR creation is disabled by default, and external pushes require explicit human instruction.
