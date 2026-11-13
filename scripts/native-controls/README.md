# Native TAKT 0.71.0 controls

This is a reproducible distribution repair, not enterprise acceptance or an
upstream TAKT release. It does not change the shared installation or any existing
`sourceSnapshots`. The implementation and tests are authored inputs; the copied
distribution and disposable fixtures are ignored under `.native-controls-runtime/`.

## Prepare and verify

From the checkout, using Node 22.23.3:

```sh
node scripts/native-controls/patch.mjs
node --test --test-concurrency=1 tests/native-controls/*.test.mjs
```

The first command requires a fresh destination. To use another fresh destination,
pass `SOURCE_TAKT_DIRECTORY DESTINATION_DIRECTORY` as its two arguments; the
destination must be inside this checkout, with no symlinked parent. The recipe
checks version 0.71.0 and the original SHA-256 values in `upstream.json`, copies
the package, patches exact unique anchors, checks the shared source again and
writes `native-controls-receipt.json`. It refuses existing destinations rather
than silently replacing another candidate. Tests prepare the default copy if it
does not exist, and reject stale runtime hashes if it does.

`central-worker.js`, `commandGateRunner.js` and `project-execution-lock.js` are
changed in the copied distribution; `native-gate-supervisor.mjs` and
`native-gate-groups.mjs` are added. Original process identity, HTTP server,
launcher and successor spawn code remain unchanged. Workers acquire the existing
atomic project execution lock before
worktree creation or workflow execution, terminalize conflicts as
`project_execution_conflict`, and release before successor handoff. HTTP admission
can still return 202; the central task then becomes failed without running a gate.

The B1 review found that dead-worker recovery could admit a new execution during
the old gate's cleanup grace period. Before sending permission to start a gate,
the runner now publishes its real process-group leader identity in the existing
atomic owner record. Stale recovery and explicit release retain the exclusion
while any registered group exists, including after the leader dies. A positively
identified reused leader is distinguished with TAKT's existing identity logic;
unknown inspection remains fail-closed. Normal completion waits for group removal
before successor handoff. Failure to observe cleanup within 10 seconds produces a
diagnostic failure and retains the exclusion; it never grants admission by time.

The B2 review found a contender could hold a pre-registration owner snapshot,
observe the worker's later death, and delete its newer gate registration. Both
recovery and owner inspection now prove inactivity before rereading the complete
record and directory identity. Every publication gets a fresh revision; a changed
record retries observation, never deletion. This ordering matters: once the
record is confirmed after inactivity, its dead or explicitly finished owner
cannot publish another gate. Explicit completion is terminal for updates too.
The regression holds actual descriptor bytes before returning them, starts an
actual gate, pauses cleanup and kills the worker. Run, watch and owner inspection
must preserve the newer record while the old heartbeat advances, then permit
normal acquisition after cleanup. The barrier changes scheduling only.

All CLI run/watch and UI executions for a project must use the repaired copy.
An unpatched older CLI does not understand the added gate-group ownership fields;
mixed repaired/unrepaired distributions are not a supported exclusion boundary.

## Bounded launch

On macOS, supply an already provisioned, dedicated hard-capacity filesystem:

```sh
node scripts/native-controls/run-bounded.mjs VOLUME COPIED_TAKT WRITE_ROOT PROJECT ui --port 0
```

`WRITE_ROOT` is a private directory on `VOLUME`; `PROJECT` must be within it.
Multiple projects may share the same writable root and central configuration.
The caller provisions the volume and seeds the projects, workflows, runtime
configuration and private `WRITE_ROOT/global/config.yaml` before starting. The
launcher does not mount disks, copy credentials, or silently adopt host settings.
Provider setup is outside this control fixture's scope. Keep the patched runtime
outside the writable subtree. The source checkout/dependency installation must
remain available for verifying the patch recipe.

The launcher checks the mount/device and `statfs` capacity (maximum 20 GiB),
requires 8 MiB of startup space, puts HOME/TMP/central state and all inherited
stdout/stderr files inside the writable root, and starts Node with a macOS
Seatbelt write policy. A 64 MiB inherited hard/soft per-file limit adds protection
for individual logs. That limit is **not** the aggregate quota. The filesystem
capacity is the aggregate boundary; polling disk usage is not used.

The only unsandboxed exec exception is the sealed Apple `/bin/ps`, needed by the
unchanged TAKT identity code to read real process start times. Its setuid exec was
refused by the first policy; the operator's failure must remain in the evidence.
Shells, Node, central workers, successors and gates retain the write restriction.
The policy uses Apple's `process-exec`/`no-sandbox` form, present in the shipped
`/System/Library/Sandbox/Profiles/com.apple.SubmitDiagInfo.sb`. This is a private
OS interface; the real bounded-route test is required on the deployment OS.

The boundary assumes a dedicated local mounted volume which the operator does
not resize, replace or populate with nested mounts during execution. It confines
filesystem writes; it is not isolation from hostile privileged commands or remote
services. There is no network or read sandbox claim. The test environment uses
only local HTTP and mock providers.

## Cleanup contract and tests

A guardian holds the command's POSIX process group; an independently initialized
sentinel watches a private lifetime pipe. Commands start only after the sentinel
is ready AND the parent confirms publication of group ownership. Normal exit,
failure and worker death initiate group TERM followed by
KILL after a 100 ms grace period, including TERM-resistant descendants. Killing
the guardian closes the sentinel's pipe and triggers the same cleanup. Success
and failure codes travel through IPC while the gate runner waits for output
pipes to close and the registered group to disappear. Existing timeout and successful noisy-output truncation contracts
remain in place. Tests use actual `runCommandQualityGate` and actual HTTP workers.

No guarantee is made for descendants that deliberately leave the process group,
simultaneous loss of both guardian and sentinel, OS failure, or Windows cleanup.
Crash ledger recovery uses the existing repository `reconcile()` operation;
the tests do not claim that an ordinary HTTP listing immediately reconciles it.
The 100 ms grace is not a scheduler-independent cleanup deadline.

The HTTP regression writes a 1 ms heartbeat and pauses the real guardian/sentinel
to hold the cleanup window open. After worker SIGTERM/SIGKILL (also worker plus
guardian SIGKILL), run/watch acquisition and a new HTTP worker must be refused
while the old heartbeat advances. After resuming cleanup, reacquisition must
succeed and the old heartbeat must remain unchanged. No fixture identity is used.

Run disk tests serially. `volume.mjs` checks outer free capacity before creating a
64 MiB APFS image, keeps the image inside this checkout, and detaches/removes its
owned fixture. Failed attachment is checked for residual owned devices. The
capacity gate writes a fill file until real ENOSPC, then removes its fill to
allow failure publication. Durable publication while the ledger filesystem is
completely full is not claimed; free space and reconcile are required for recovery.

The current enclosing engineering environment rejects nested `sandbox-exec` and
cannot attach the images created within its own APFS image. These two tests mark
only the specifically observed environmental refusal as SKIP/UNPROVEN. Native
HTTP tests and the 1 MiB EFBIG subprocess test still run; neither substitutes for
bounded-route or aggregate-capacity proof. To require zero skips in a deployable
environment, use the operator entrypoint against an already owned small mount:

```sh
node tests/native-controls/external-proof.mjs OWNED_64_MIB_MOUNT COPIED_TAKT
```

This uses the unchanged candidate's actual bounded launcher, official HTTP,
workers, successor and gates, checks native start-time identity, direct and symlink
write refusal, real aggregate ENOSPC and crash cleanup. It emits source/runtime
hashes, exit status and results as JSON. It exits nonzero on missing ENOSPC,
escaped writes or source changes during the run, and never skips. The operator
owns this externally supplied mount and must retain evidence then detach/remove
it; the model does not write outside the engineering volume. Bind independent
review to those hashes. No B00–B06, ENT-201 or all-issue approval follows from these
control tests.
