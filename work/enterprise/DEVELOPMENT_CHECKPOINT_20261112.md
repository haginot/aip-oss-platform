# Development checkpoint — 2026-11-12

This checkpoint preserves the enterprise implementation and portable regressions
from the dirty development checkout based on commit
`81f9f92c415c9a81a3f3edc596b6aeccbc871989` on
`codex/enterprise-checkpoint-20261112`. It is a development checkpoint, not an
ENT-201 acceptance or a current TAKT approval. `main` was not changed.

## Reproducible local verification

Use the pinned Node.js 22.23.3 and PostgreSQL 18.6 from `mise.toml`, install
the locked dependencies, and provide the cached Chromium used by
`tests/enterprise/browser-helper.mjs`. After reviewing the two tool pins, trust
this checkout with `mise trust ./mise.toml`, then use `mise exec -- npm ci` and
`mise exec -- npm test`. Ambient Homebrew PostgreSQL 14 is insufficient for the
fixed-version bootstrap checks. Regression fixtures live in `fixtures/enterprise`; original execution
history is excluded from Git. Normal regressions use disposable databases and
browser instances. Explicit historical external adapters keep their identity
checks.

`npm test` runs two file workers. The release regression wrapper uses the same
two workers with a finite 55-minute child deadline and 50 seconds of controller
reporting headroom. Tests within each file keep their original ordering. A direct
adapter test writes temporary evidence; only the explicit release wrapper writes
the adapter release artifact.

## Evidence preservation

The following protected originals retain their configured SHA-256 values:

- `evidence/generated/release/adapter-trace.json`:
  `7cdc30620fd3f6cf62d50b31761409aa2350c7c81d74c083d229caf4c653aee6`
- `evidence/model-smoke.json`:
  `dce2d7cb780ef7ea704b468e58fdb9801fbbbe68afb2854427cc48c5e01b2c52`

The approximately 19 GB of execution history, machine-local Codex state and
`work/enterprise/progress.json` are not part of the uploaded checkpoint. Test
fixtures and their provenance hashes do not establish historical execution or
approval authority.

## Remaining formal acceptance boundary

No new production TAKT run or B00–B06 approval was created by this checkpoint.
The observed old progress points at B04; historical approvals are not current
approvals. `RUN_ENTRY_HISTORY.md` still records the authentication and initializer
work needed before an ordered new run can proceed. Its implementation/review and
real runner launch must precede B00, ordered prerequisite reviews and the
independent B06 review.

The actual source checkout passed the read-only startup capacity guard (20 GiB
record ceiling and 30 GiB free-space floor). That check does not certify the
continuous production cap, official-UI/central-worker exclusion, or crash cleanup
on the restored production run. These remain explicit production acceptance
checks. Local synthetic tests do not replace them.

## Checks already complete

- ENT-201 public API AC-01 through AC-04 and actual browser purchase/receipt and
  read-revocation cases passed in the local full regression. These are not formal
  TAKT acceptance receipts.
- The adapter/protected-original combined recheck passed 7/7 after the default
  adapter output was isolated. The explicit adapter release wrapper separately
  passed in an isolated committed checkout.
- Supervision mechanism: 42/42. Focused preparation regressions: 306/306.
- Syntax: 322 modules, zero errors. Recovered fixture hashes: 48/48 matched.
- Workflow doctor and goal/architecture validation passed.
- Staged implementation and the additional execution-budget commit were checked
  for secrets. The seven implementation findings were reviewed public session
  identifiers or condition names, with exact scoped exclusions; no credentials
  were identified.

## Full regression and failure resolution

The complete run finished in 2,696,659 ms: 4,159 tests, 4,153 passed, six failed,
zero cancelled and zero skipped. It is retained as a failed run. The six failures
were the protected adapter artifact assertion (the adapter test overwrote the
protected output), a missing archived U role validation input, three bootstrap
checks that selected PostgreSQL 14 instead of pinned 18.6, and one quality-gate
check that correctly refused the untrusted checkout tool configuration.

The adapter now defaults to disposable output. The U role JSON is a byte-exact
portable fixture with original/current provenance hashes; no validator or
identity assertion was relaxed. The reviewed `mise.toml` was trusted locally,
and the affected checks were rerun with both pinned tools. U role primitives:
43/43 passed, zero skipped. Bootstrap, quality-gate, protected-original and
adapter test files: 13/13 passed, zero skipped. This resolves each observed
failure; the entire full suite was not rerun after these fixes. These focused
successes do not turn the original failed run into a passed release receipt.

A fresh checkout from GitHub separately passed the protected-original/adapter
checks (7/7) before the final fixture/documentation fix. Generated outputs from
the development tests are archived privately with hashes and are not committed.
The two protected original hashes above are checked again before push.
