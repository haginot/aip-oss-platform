# Enterprise local foundation and B02 governance

All identities, objects and effects in this environment are synthetic. HTTP listeners bind to 127.0.0.1. The OIDC provider and effect service are independent HTTP servers with their own PostgreSQL schemas; neither calls real business services. Local HTTP cookies are HttpOnly and SameSite=Lax. This is a local test configuration, not a production SSO deployment.

## Start and seed

Use the repository's mise environment with Node, PostgreSQL (`initdb`, `pg_ctl`) and installed npm dependencies:

```sh
mise exec -- node scripts/enterprise/local.mjs
```

The command prints the browser URL and PostgreSQL version. Open the URL. Schema migrations, synthetic accounts, scoped grants, and the versioned `config/enterprise/foundation.json` package are installed automatically. Package installation, independent review and publication use the public Kernel contract. Ctrl-C stops the servers and deletes this disposable PostgreSQL cluster; the cluster persists transactions and is shared across worker process restarts while running. Existing product databases are not touched.

Choose `operator` to submit an application. The first approval stage requires both `manager` and `reviewer`; the second requires `publisher`. Each account signs in through the independent OIDC provider. The applicant cannot approve their own request. After all approvals, use 検証先へ実行; 結果不明 requires 外部結果を照合. 補償を実行 reverses a confirmed synthetic effect. `reader` sees only INTERNAL fields, `other` has a different department, and `tenant2` belongs to a different tenant.

## Contract and package extension

Existing v1 Kernel operations are unchanged. Enterprise commands use `kernel.enterprise(credential, {operation, body, key})`. HTTP uses POST `/api` with `{contractVersion:"2.0.0",operation,body,key}`, the session cookie, same-origin request and the CSRF value from `/session`. Mutations require a stable unique `key`; use the same key only for the same request. The server rechecks current authority even on replay.

Package `install`, `review`, `publish` accept a strict versioned JSON manifest. It contains typed entities, classified fields, form labels, an Action type, approval stages/quorum, currency and amount thresholds, permissions, calendar and positive/negative fixtures. The author cannot review their package. Failed fixture simulation prevents installation. The manifest contains no executable code, SQL or network address. Published versions remain pinned to running instances; publishing an earlier reviewed version rolls back the live pointer without changing existing instances. SQL is confined to platform adapters and seed/reference services.

`create`, `edit`, `get`, `query`, `history`, `attach`, `attachment`, `vote`, `cancel`, `grant` and `delegate` enforce tenant and exact legal-entity/department/case/classification scope. Query projection, search, aggregate and export share field authorization, including each instance's pinned package classification. The legacy B01 `attach` API remains immutable bounded synthetic text. Governed B02 documents use the separate document operations below; legacy attachments are not silently migrated. Delegation credentials use `{token,delegationId}` at the Kernel boundary; the current portal uses direct identity only.

The shared PostgreSQL Action, Outbox, Audit and durable RecoveryJournal record mutations and external uncertainty. `kernel.enterpriseRecover` reconciles a lost database commit acknowledgement. `kernel.enterpriseWork` dispatches, observes or compensates via the restricted synthetic HTTP port. Worker command retries do not blindly resend UNKNOWN effects. An authoritative ABSENT observation remains UNKNOWN with `requiresHumanReview`; automatic resend and a human resolution UI are not implemented in this batch. `tick` records an expired SLA once in Audit. The notification is an internal durable event, not an email.

BF-15: legacy `attachment` reads inherit the parent object's current information
classification and allowed purposes, in addition to object scope and RESTRICTED
field authority. For a classified parent, call `attachment` with
`{id: objectId, hash: attachmentHash, purpose: "summary"}` using a purpose actually
allowed by every source policy. Missing or disallowed purposes and missing label
authority deny access before reading attachment bytes. Untagged parents retain the
existing `{id,hash}` contract and `{content}` result. A known hash is not permission:
each request checks current grants and policy, including after restart. If a restored
DB loses the committed classification, the shared BF-13 journal check keeps reads
in RECOVERING until the exact classification and Action are recovered.

The BF-15 regressions use synthetic OIDC sessions, the public HTTP Gateway and real
PostgreSQL to compare get/attachment denial, permitted reads, grant revocation,
stronger policy, restart and schema dump/restore. They retain the latest independent
journal/head during restore. These are API recovery tests, not browser restore UI
or production identity/backup certification.

Package authorship and review persist both actor and subject plus delegation ID. Either identity overlapping the author prevents review, including delegated installation followed by the delegator's direct review. Apply `003-package-provenance.sql` after `002-enterprise.sql` for existing B01 databases. It preserves legacy rows with unknown provenance; those versions remain readable and pinned, but cannot receive new review/publication. Install a new version through the public contract to establish provenance; the migration never guesses a historical subject.

Dispatch requires current worker permission and rechecks the original applicant and all approvers. Reconciliation and compensation instead require current recovery permission, tenant/scope/field access and the intact object/package/Outbox binding, checked again immediately before I/O. They operate only on the existing operation ID, even if its applicant or approvers have since been revoked. Reconciliation performs only an external GET; it never reapplies an effect. Recovery permission revocation blocks I/O, and ABSENT remains unresolved for human review.

## Verify and diagnose

```sh
mise exec -- node --test tests/enterprise/ENT-102.test.mjs tests/enterprise/ENT-103.test.mjs tests/enterprise/ENT-104.test.mjs tests/enterprise/ENT-105.test.mjs tests/enterprise/ENT-112.test.mjs
mise exec -- node scripts/enterprise/verify.mjs batch --batch B02
mise exec -- node scripts/enterprise/verify.mjs batch --batch B02 --validate-only
```

The batch gate also reruns prerequisites B00 and B01 against the current inputs. It requires the authenticated TAKT selection record, a real implementation session and independent prior review. It does not provide independent approval for B02. Evidence is written beneath `evidence/enterprise/runs/`; the current index and receipt identify the exact stdout, stderr, screenshots and source digest.

Browser tests need a local Chromium binary. Set `ENTERPRISE_CHROME` to its absolute path, or use the existing macOS arm64 Playwright headless-shell cache. No browser download occurs. Tests use a fresh temporary browser profile and direct CDP to exercise the rendered form, approvals, failure/recovery and authorization. Screenshots plus `browser.json` are stored in `ENTERPRISE_SUITE_OUTPUT`, or `evidence/enterprise/browser` for direct test runs.

`ENT-105.test.mjs` kills a separate worker process after the independent effect ledger commits, restarts against the same database/journal, reconciles and checks exactly one application. Other fault tests drop the HTTP acknowledgement, inject a pre-send failure, revoke authority immediately before I/O, and lose the database commit acknowledgement. Test output records errors such as PERMISSION_DENIED, NOT_FOUND, STALE_APPROVAL, INCONSISTENT_STATE and UNAVAILABLE; uncertainty is never reported as success. Failed historical receipts and regression logs remain evidence, not current pass results.

## New-run initialization recovery

Within the authenticated TAKT build-foundation context, `mise exec -- node scripts/enterprise/verify.mjs batch --initialize-run` archives the previous run's evidence references before creating a fresh B00 projection with no current approvals. Retry the same command after an interrupted initialization. The initializer writes and syncs its complete lock owner record to a temporary file before publishing it exclusively; a partial write or process termination before publication cannot leave a partial canonical lock. A completed lock left by a dead initializer is recoverable only for the same run. Temporary files left by SIGKILL are not authority records and do not prevent retry.

Recovery of a dead initializer requires `python3` with POSIX `fcntl.flock`. A helper locks the stable evidence directory inode, rechecks the exact stale owner and its process state, and exclusively publishes the replacement. Concurrent recoverers cannot remove each other's replacement; the operating system releases the recovery mutex when the helper exits or is killed. An ordinary gate writer that creates the lock during replacement wins, and its lock is preserved. Missing Python or unsupported directory locking fails closed. Hardware power-loss durability has not been tested.

Live owners, other runs, ordinary gate locks and malformed/unknown locks remain blocking; initialization does not delete them or repair old malformed locks automatically. Completed history must still match its exact bytes. `tests/enterprise/continuation.test.mjs` exercises partial writes, process termination, retry, simultaneous reclaim by two CLI processes, conflicting writers and history tampering using isolated real CLI processes and files. Successful recovery still requires fresh independent review; it never imports historical approval as current approval.

## B02 documents, audit and connections

Migration `004-enterprise-governance.sql` follows 003. It adds versioned documents, erasure records, scoped connection references, immutable operation routes and webhook receipts. The rollback rejects nonempty enterprise data before removing these tables. All browser fixtures are synthetic text.

In the portal, select the seeded `mail / local-inbox` destination and fix it before voting. Upload a plain-text document, inspect its clean versions, preview/download/export, or use the records-authorized `manager` account to toggle legal hold. Retention prevents early deletion. The document list and all read modes enforce object and document field permissions independently. `documentSearch` supports content/name search within the authorized object. `documentUpload` also accepts text/csv at the Kernel boundary and rejects content above 65536 bytes. Scanner exceptions and negative verdicts quarantine the new version; a previously clean version remains available. The local scanner recognizes only the synthetic marker `SYNTHETIC-MALWARE`; this is fault injection, not production malware detection. A production scanner is not connected.

`documentDelete` requires records authority, expired retention and no hold. Before deleting database content it durably appends an irreversible, content-free erasure intent to the existing RecoveryJournal, serialized by StatePort admission. The journal and its fsynced head witness must live outside the PostgreSQL backup/restore boundary. Restoring PostgreSQL must never restore or bootstrap those files from the same old snapshot. A failed DB transaction after that append leaves the intent authoritative: use `documentRestore` to finish deletion, rather than restoring deleted content.

Every document read (download, preview, export), search and new document mutation verifies the journal chain/head and checks that the tenant's independent erasure intents have corresponding DB tombstones. Missing, tampered or truncated journal data, a missing head, or unapplied intents rejects reads with `RECOVERING`. `documentRestore` with body `{}` and a new mutation key verifies that witness, reconstitutes tombstones within the caller's records/scope/field authority, and removes restored bytes in one audited transaction. An interrupted transaction rolls back; retry with a new key. Partial authority cannot clear the remaining tenant recovery barrier. Existing DB tombstones still suppress reads of resurrected bytes. Recovery works even if the restored snapshot predates the document itself; the independent intent retains its scope and classification.

The ENT-106 BF-11 regression uses `pg_dump` and `psql` to restore a real schema snapshot taken before deletion, including rolling back the DB tombstones. It checks all read surfaces before recovery, missing/tampered/stale witness rejection, authority boundaries, transaction interruption and successful repeated re-erasure. This is local PostgreSQL restore verification, not production backup orchestration. Operators must preserve the independent journal/head at their latest durable checkpoint. Coordinated rollback or privileged rewriting of both witnesses is outside this local hash-chain guarantee; external immutable storage and disaster recovery of lost witnesses remain deployment requirements. Legacy databases remain RECOVERING until the records-authorized `documentMigrate` operation with body `{}` establishes an independent migration checkpoint. Run it on the latest database **before** restoring an older backup. It matches every tenant v2 committed submission in the durable journal against retained Action IDs/digests and rejects extra Actions without committed journal evidence. It verifies retained upload provenance, matches every deletion Action to its tombstone and every tombstone to its document/deletion Action, and requires scope/field authority for all tenant documents. Missing historical Actions, documents or tombstones is not an empty successful migration. Preserve or recover the authoritative latest DB/journal first; missing history is never inferred.

Migration copies verified legacy tombstones into the independent journal before appending its completion checkpoint. An exception before completion leaves all document surfaces (including `documentRestore`) closed; retry migration against the complete current DB with a new key. If the DB was restored before migration, the latest journal exposes missing committed Actions and migration refuses. A trusted checkpoint survives subsequent DB restore; `documentRestore` then reconstructs legacy tombstones and re-erases content. A fresh empty tenant uses the same explicit operation, which the local seed invokes before installing packages. Returning an old mutation result also rechecks the checkpoint and applied intents.

The legacy regression prepares a pre-checkpoint journal representation by retaining the actual public-operation submission records while excluding only new erasure/checkpoint records. It restores real pre-deletion and current PostgreSQL schema dumps, verifies migration refusal for missing history/authority, interrupts migration, retries it, and re-erases the legacy document after restoring the old snapshot. This is a synthetic legacy-format fixture, not execution of a released old product binary. It never inserts tombstones after restore to manufacture success.


`auditExport` requires a distinct audit permission and verifies the stored hash chain before joining requester actor/subject/delegation, definition/policy, approval authorities, action and operation IDs. Document contents and secret values are absent from audit records. Export is available in the portal. Storage failure aborts the transaction. The ordinary application role cannot rewrite audit rows. An administrator able to rewrite the entire database and chain can defeat an unanchored chain; external anchors, key rotation and independent immutable storage remain deployment requirements.

`connectionSet` is a strict public operation for authorized administrators. It accepts registered provider/destination/secret references and an exact organization scope, not a URL or secret value. `kernel.connections` holds the platform-owned registry and secret resolver values; the portal lists allowed destinations without credentials. `routeSet` pins the connection revision to the instance before approval. Saving the same provider, secret reference, scope, destination and active state preserves the revision, including JSON scope key reordering, so existing operations can still reconcile and compensate. Material changes increment the revision; disabled or changed connections fail closed at I/O. This does not repair previously stale route revisions or implicitly retarget approved operations. The local launcher seeds one loopback mail connection; connection administration is currently through the Kernel contract, not a browser editor.

The independent HTTP reference services for mail, calendar, accounting, HR and contract verify credentials, destination and domain schema. Calendar uses invite/cancel semantics, mail uses send/compensate, and the remaining domains use stable-ID upserts. Mapping sends title, amount and currency only, with sourceOfTruth `enterprise`, definition revision and tenant/domain/object stable ID. The services own a separate persistent effect ledger and expose GET observation plus idempotent reversal. Lost acknowledgements retain UNKNOWN, and recovery never blindly re-sends. Google Workspace, Microsoft 365 and real accounting/HR/contract SaaS remain explicitly unconnected; synthetic conformance does not certify their APIs.

Signed webhook ingestion is POST `/webhooks/{tenant}/{connectionId}` with `x-timestamp` (epoch milliseconds) and `x-signature` (hex HMAC-SHA256 over timestamp + `.` + exact JSON bytes). Events contain id, sequence, stableId and state. Invalid signatures or timestamps are rejected; identical duplicates and lower sequence numbers do not create new effects. Conflicting reuse of an event ID is rejected. A webhook is a recorded observation only; workflow completion still requires authoritative GET reconciliation.

```sh
mise exec -- node --test tests/enterprise/ENT-106.test.mjs tests/enterprise/ENT-108.test.mjs tests/enterprise/ENT-109.test.mjs tests/enterprise/ENT-603.test.mjs tests/enterprise/ENT-604.test.mjs
```

The B02 browser scenario stores `governance-browser.json` and four screenshots. It exercises upload, quarantine, preview/download/export, legal hold, denied audit export, authorized audit export, a pinned connector, UNKNOWN/reconciliation/compensation and document field isolation. The connector fault test kills a separate worker after the reference ledger commits, restarts against the same database and verifies one application. These tests do not call real email, calendar, payment, HR or IR services.

## B03 definition administration, optional proposals and recovery

The `/admin` screen uses finite inputs (version, display label, business-day deadline,
first-stage quorum). It exposes version differences, positive/negative fixture
simulation, independent review, publication, rollback and persistent Action history.
It has no code/SQL editor. `definitionDraft`, `definitionList` and
`definitionSimulate` require author/review permission and all definition field
classifications. `definitionMigrate` requires publish plus object/field authority:
it only migrates unvoted WAITING_APPROVAL instances to a published, compatible
version, advances the object revision/history and recalculates its bound definition
and deadline. Approved or externally dispatched instances cannot be migrated.
Lowering an existing field classification is rejected for instance migration.
BF-16 compares every accepted package field label: PUBLIC < INTERNAL < CONFIDENTIAL
< STRICT, with legacy RESTRICTED at the same strict level. Unknown persisted labels
fail closed. Equivalent or stronger classifications may migrate only after the
existing scope, field, authority, binding and unvoted-instance checks. This ordering
does not change exact field grants: a principal still needs the destination field
label to read it. Rejected migrations preserve the fixed version, revision, fields
and successful command audit. ENT-110 exercises all 25 label pairs via public HTTP,
and checks STRICT downgrade denial through get, search/export and AI projection.
These are synthetic OIDC and real PostgreSQL API tests, not a browser migration UI.
Publication alone switches new instances; old instances retain their version.
Rollback of an unvoted migrated instance uses the same operation with its prior
published version and current revision. This does not run arbitrary data transforms.

The case screen's optional AI proposal sends only the authorized title to a
loopback reference model. Kernel `propose` accepts an explicit field projection,
purpose (summary/employment/labor/disclosure), and integer maxCost from 1 to 100
synthetic units. The reference port has no tool execution interface. Output must
have a typed text, the exact authorized source reference/digest, no tools, and a
cost within the reservation. Reservations are durable journal entries made before
HTTP, capped at 1000 units per tenant for this deployment; failed requests consume
the reservation conservatively. There is no automatic reset or payment integration.
Proposals persist as Actions and never vote, publish, or enqueue external effects.
Human workflow approvals remain mandatory. Model outage leaves manual processing
available. The reference server is independent HTTP code with synthetic replies,
not an evaluation of a production LLM's factual accuracy or a paid model connection.

Before admitting an existing tenant, a recovery administrator uses
`authorityMigrate` with `{}` on the complete latest DB and independent journal.
It validates retained committed Action history and snapshots current grant and
session-expiry decisions. The caller must cover all tenant scopes, operations and
field classifications. Missing history or a missing completion checkpoint keeps
normal enterprise operations in RECOVERING. The local seed initializes this through
the public operation (temporarily assigning its synthetic recovery administrator
all fixture departments). The empty migration/rollback fixture does not seed it.

Public `grant` decisions and `logout` token hashes are durable outside DB snapshots.
Only a grant bound to a COMMITTED submission can be reapplied when its exact Action
is absent from a restored DB. ABORTED submissions are ignored, including grants
whose database mutation rolled back because Audit failed. INTENT alone never grants
authority: an exact retained Action (tenant, digest, operation ID and operation kind)
proves a DB commit without replaying the intent. If that Action is absent, normal
operations remain RECOVERING. An independent currently authorized recovery principal
uses `kernel.enterpriseRecover` to resolve that intent; the uncertain grant target
cannot authorize its own resolution. For authority intents, recovery records COMMITTED
only for the exact persisted Action. An absent Action is not proof of rollback:
a restored snapshot can have lost a committed revocation. Recovery therefore returns
RECOVERING without recording ABORTED or reopening access, even for an independent
administrator. Restore a trusted complete DB containing the exact committed Action
and reconcile again; only then retry the original request/key. If no such commit
evidence is available (including a process stopped before commit), this path remains
fenced and cannot automatically resolve the decision. Do not edit the journal or
mark the intent ABORTED to bypass the fence. Explicit ABORTED records written after
a known transaction rollback remain excluded. A rolled-back authority migration checkpoint cannot enable
access or suppress a new migration attempt. On restoration, committed revocations
are applied before checking access; revoked grants cannot authorize reads or worker I/O. Current DB
restrictions are not undone when their decision Action is present. Logout and
expired-session witnesses reject resurrected tokens. These witnesses must remain
outside the product DB backup boundary, like erasure records. A database restored
from before document deletion still requires `documentRestore` before document
read/search can resume. Administrative direct SQL edits after the checkpoint are
not a supported authority-change interface and are not captured as independent
revocation evidence; use the public grant operation. Coordinated rollback or loss
of both journal and head, and recovery of lost encryption keys, are not solved.

After a DB snapshot restore, use `externalRestore` on an authorized instance to
persist UNKNOWN, then the existing reconcile operation against the independent
external ledger. It never sends an apply request. `recoveryStatus` reports scoped
instance, waiting and unresolved counts. Application/compensation uses the original
operation ID. Unknown/absent external observations still require human resolution.
Neither operation implements infrastructure backup storage or a production scheduler.

`ENT-111.test.mjs` actually dumps and restores PostgreSQL schemas (including
workflow, attachments, approvals and grants), stops/restarts PostgreSQL, drops an
HTTP response, and terminates a separate worker after external commit. It writes
measured RTO intervals, acknowledged-object loss checks (RPO for the explicitly
listed fixture objects), and unresolved counts to `recovery-measurements.json`.
These local timings are not production RTO/RPO guarantees. The legacy authority
fixture removes only new authority records from public-operation history; it is
not a released old binary. The tests also cover migration interruption, missing
history, scope/field refusal, and logout after backup restoration. Connection errors
are retained in `PostgresState.connectionErrors` (bounded to the last 100) and broken
checked-out connections are discarded; they are not silently returned as success.

```sh
mise exec -- node --test tests/enterprise/ENT-107.test.mjs tests/enterprise/ENT-110.test.mjs tests/enterprise/ENT-111.test.mjs tests/enterprise/ENT-602.test.mjs tests/enterprise/ENT-602.browser.test.mjs
mise exec -- node scripts/enterprise/verify.mjs batch --batch B03
```

B03 requires current independent B00/B01/B02 approval at selection. A source edit
invalidates those current approvals; the authenticated entry proof permits the
bounded work to continue, and the ordinary gate regenerates its prerequisite
closure. Each changed approval still needs independent review before B04.

The ENT-111 BF-12 regressions retain the pre-fix denial failure and exercise actual
Audit INSERT failure, transaction rollback, a separate process exiting before commit,
post-commit acknowledgement-loss injection, same-key retry, later revocation, and
real schema restore. The process-stop injection exits with code 74; it is not a
power-loss test. Unknown grant decisions remain fenced until explicit reconciliation.

The BF-12 combined-fault regression commits a revocation, loses its acknowledgement
before journal finalization, and restores the actual pre-revocation schema dump while
retaining the latest journal/head. Repeated recovery and request retry remain
RECOVERING with an unchanged INTENT. Restoring the complete post-commit dump permits
exact-Action reconciliation; subsequent old-snapshot restore still denies access.

## B04 information, publication, rights and handoff controls

Migration `005-enterprise-controls.sql` follows 004. It adds scoped control records,
append-only command history, release-role assignments, per-channel deliveries and
handoff Inbox receipts. Control identities are also registered as empty v2 Objects,
so existing Outbox foreign keys remain intact. Each delivery has its own Action and
operation ID linked to the approval Action; admission requires the parent's durable
commit. Empty-database rollback removes the added tables; populated databases still
refuse rollback. Source scope now accepts PUBLIC and STRICT alongside the original
INTERNAL/CONFIDENTIAL/RESTRICTED contract (RESTRICTED remains a strict-class alias).

Start the same local launcher and open `/controls`. The finite Japanese forms cover
information registration/derivation, usage-right registration/revocation, release
review/dispatch/correction/withdrawal and cross-department offers/acceptance/cancellation.
Synthetic release-role assignments are manager=legal, reviewer=pr, publisher=ir. An
operator authors the release; all three different nondelegated approvers must review
its fixed source digest, version, purpose, destinations, rights and embargo. Rights
are registered by a records-authorized manager. No real media provider is connected.

Information sources are authorized object projections or clean governed document
versions. Derivations retain their roots, transform version, maximum classification,
exact organization barrier and intersected purposes. All uses recursively verify
current source access/version/hash; missing or changed lineage fails closed. Aggregate
outputs require three distinct root IDs, so repeated copies cannot satisfy the
minimum. Hidden sources are never counted. AI uses the independent synthetic model
with a durable cost reservation, empty tool allowlist and exact references. Export
and notification derivations are internal data; external transmission requires a
separately approved release. Label preservation is enforced by the API, not by UI
visibility. PUBLIC is still organization-scoped, not an anonymous read permission.

Release channels use separate independent PostgreSQL media ledgers. Payloads contain
the approved text and source digest. The worker pins the configured loopback route,
rechecks current approvers, source, rights and embargo immediately before I/O, and
persists uncertainty first. UNKNOWN uses observation only; ABSENT requires human
resolution. A durable delivery witness prevents a restored READY row from resending.
Each channel exposes its receipt; partial success remains partial. Corrections are
new release IDs linked to accepted originals and require new approval. Withdrawal
requires three new approvals. The synthetic mail medium returns UNSUPPORTED and
retains residual exposure; it is never reported as a successful withdrawal.

Release creation and dispatch require rights for every root material ID in the
source lineage and the declared synthetic subject. Unrelated rights and incomplete
coverage are refused. In the UI, register the object:<ID> or document:<ID> as the material
and select one or more corresponding rights for the same release subject.

Rights bind synthetic subject/material, evidence version, purposes, media, region,
validity period and indirect-provider permission. Revocation appends a content-free
suppression witness outside the DB backup boundary before changing the row. It is
conservatively irreversible even when the subsequent DB/Audit transaction rolls back.
Reimport under another ID and restored GRANTED rows cannot bypass the witness. Keep
the journal/head current and separate from PostgreSQL backups. The slice does not
supply a legal determination, consent collection service or permission to erase the
suppression witness. Check the public `rightCheck` operation for a proposed use.

All four journey types use a shared correlation ID. Each offer carries only a finite
reference/task payload, recipient scope, event ID and monotonic sequence; the Inbox
rejects conflicting duplicates or gaps. The recipient's own approval and scope are
required before a step's Outbox effect. Prior departments' grants are not copied.
Cancellation has a durable witness and blocks subsequent offers/dispatch after DB
restore. Previously accepted effects remain observable. Compensation needs an explicit
recipient approval and reverses accepted steps in reverse sequence. This is the shared
handoff engine; the later domain batches supply their distinct commercial/HR processes.

```sh
mise exec -- node --test tests/enterprise/ENT-113.test.mjs tests/enterprise/ENT-114.test.mjs tests/enterprise/ENT-115.test.mjs tests/enterprise/ENT-116.test.mjs
mise exec -- node --test tests/enterprise/ENT-113.browser.test.mjs tests/enterprise/ENT-114.browser.test.mjs tests/enterprise/ENT-115.browser.test.mjs tests/enterprise/ENT-116.browser.test.mjs
mise exec -- node scripts/enterprise/verify.mjs batch --batch B04
```

The tests exercise real PostgreSQL schema restore for consent and release delivery,
independent HTTP acknowledgement loss and a separate worker exit after external
commit. Process exit is not a power-loss test. Journal/head coordinated rollback or
loss, privileged DB rewrite, production malware/SSO/media services, production legal
policy and jurisdiction-specific rights decisions remain outside these synthetic
contracts. The aggregate minimum is fixed at three for this fixture. Schema/role
installation is platform configuration, not a browser SQL interface. No B04 evidence
is independently approved until the separate TAKT reviewer binds the exact run.

Tagged root objects/documents also constrain the existing get/query/documentRead/documentSearch/propose surfaces. Supply an allowed `purpose` for those reads; untagged inputs keep their previous contract. Searches omit inaccessible tagged roots before counts. Legacy workflow dispatch refuses tagged roots because it has no separately approved publication-purpose binding. Use a ReleasePlan for their external publication. These restrictions intentionally prevent switching back to an older API to remove labels or purpose limits.


BF-13 classification recovery binds each new informationCreate/informationDerive to
an independent journal witness containing the immutable policy digest and Action ID.
Every enterprise request and worker checks this evidence before using the database.
A COMMITTED or unresolved INTENT whose exact Action or policy is missing or changed
puts the tenant in RECOVERING, including ordinary get/query, document reads, AI and
external dispatch. Explicit recovery cannot treat an absent Action as an abort.
ABORTED classification changes are excluded, so an audited rollback does not impose
a new classification. The currently executing transaction alone may finish its own
INTENT; this exemption is not exposed as a caller parameter.

Restore a trusted complete database containing the exact committed Action and its
immutable classification, while preserving the latest independent journal/head.
The normal checks then validate the policy; for an INTENT, use the existing explicit
enterprise recovery operation with current recovery authority to reconcile its Action.
Do not edit the journal, delete its witness or manufacture an ABORTED result to open
reads. If commit evidence cannot be recovered, the tenant remains RECOVERING. This
is a safety fence, not automatic reconstruction or a guaranteed recovery time.

Pre-upgrade submissions did not identify classification operations. Their original
Action and classification history are validated when present; any missing non-aborted
legacy Action conservatively fences the tenant, even if it might have been another
operation. New non-classification commands carry a version marker and retain their
existing recovery contracts. The legacy compatibility test uses a synthetic old-format
journal, not an old product binary. The BF-13 regressions use actual pg_dump/psql schema
restore for objects and document policy strengthening, rollback and commit-response
loss, plus current-journal preservation. These fault operations use Kernel APIs, not
a browser restore UI. Joint journal/head rollback and hostile privileged rewriting
remain outside this recovery guarantee.

BF-14 compensation approval uses the exact accepted step's recipient scope and the
journey classification for both initial requests and idempotent replays. The approver
must have current approve authority, cannot be the journey author, and cannot act
through delegation. A cancellation does not itself approve or complete compensation.
The worker revalidates the saved approver's current authority, step scope and label
before preparation and immediately before external withdrawal or WITHDRAW_UNKNOWN
reconciliation. Invalid pre-fix saved approvals are refused even if their grant
revision still matches. Revocation after preparation can leave WITHDRAW_UNKNOWN;
no external request is sent, and reconciliation also requires valid approval.
An eligible recipient may approve again, reconcile the independent result, and
withdraw a still-accepted effect once. Existing reverse-order constraints remain.

BF-14 regression evidence includes real PostgreSQL, public HTTP denial of the first
and repeated request, synthetic pre-fix saved authorities, and an I/O-boundary grant
revocation injected by fixture SQL. That SQL injection is a test fault, not a supported
production permission-management path. Browser tests use the synthetic OIDC login,
verify denial without exposing the classified record, and confirm authorized
compensation through the HTTP result, independent ledger and sender display.

## B05 resources, SLA, policy applicability and coverage

Migration `006-enterprise-assurance.sql` follows 005. Start the same seeded local
launcher and open `/assurance` from the portal. Manager can create integer-unit
resource accounts, synthetic policy packs and coverage matrices. Operator creates
SLA cases and requests a reasoned emergency escalation; manager approves it and a
third principal (reviewer) performs post-use review. The one-use emergency authority
expires within one hour and authorizes only a durable internal escalation event.
It grants no general or permanent permission and sends no email. Normal expiry also
creates one internal Outbox event. Calendars use UTC, weekdays and explicit holidays.

Resource accounts fix currency, unit, period end, capacity, period-wide cumulative
threshold and calculation version `integer-v1`. Amounts are safe integers; decimal
rounding or conversion is refused. Releases restore reserved capacity but do not reset
the cumulative threshold. The threshold spans all references and actors within one
account/period; it is not a global accounting consolidation across separately managed
accounts. Closing prevents further reservation/release. Serialized transactions and
row locks prevent conflicting reservations; stable request keys prevent duplicates.

Policy packs bind exact company scope, jurisdiction, industry, version, effective and
expiry dates, evidence, accountable reviewer and finite requirement identifiers.
Application refuses unknown/mismatched requirements and unreviewed/expired packs.
The named reviewer must differ from the author, and current review authority is
rechecked. These are synthetic applicability records, not a certification of expert
credentials, legal advice or automatic enforcement by every later business workflow.
No operation or screen asserts legal compliance.

BF-17: `policyApply` uses the same applicability check for new requests and saved
successful request keys. Revoked reviewer authority, changed authority revision,
expired/not-yet-effective policy, and mismatched version or requirements refuse
the result. A valid replay returns the original result without adding an application,
revision, Action, history entry or successful command audit. The regression compares
new keys and the original successful key through synthetic OIDC/public HTTP, after
Kernel/Gateway restart and exact PostgreSQL schema dump/restore. Expiry uses an
injected Kernel clock; the latest independent journal/head is preserved. This is
not a browser-operated restore or a production identity/backup certification.

Coverage stores the Cartesian product of five finite dimensions (at most 100 cells),
stable LOCAL issue identifiers and independently reviewed exclusion reasons. Newly
registered cells remain OPEN. Count thresholds or exclusions alone never return a
complete result. These local issue records do not publish GitHub issues or infer
undiscovered business processes. Completion still requires implemented business
slices and exact independent evidence; this screen does not issue release approval.

All four records use current scope and classified-field permissions, existing Action
and Audit transactions, append-only histories and independent journal version hashes.
A known SQL rollback is excluded from the recovery witness. An uncertain commit or
old DB with a missing/mismatched record remains RECOVERING until the trusted exact
DB and Action are recovered. `enterpriseRecover` cannot mark a missing assurance
Action ABORTED. Preserve the current journal/head outside the SQL backup boundary.
This is not automatic reconstruction, protection from joint witness loss, production
power-failure certification or a browser-operated restore tool.

The four contract tests use real PostgreSQL, pg_dump/psql restore, audit failure,
commit-response-loss injection and SQL tampering. The independent loopback HTTP
reference calculator imports no product/domain code and checks integer totals,
holiday deadlines, synthetic rule applicability and matrix cardinality. It is a
read-only test oracle with its own credential/scope checks, not a production business
connector. Browser tests use synthetic OIDC and the public Gateway, keyboard input,
role changes, denial responses, persisted histories and reloads.

```sh
mise exec -- node --test tests/enterprise/ENT-117.test.mjs tests/enterprise/ENT-118.test.mjs tests/enterprise/ENT-119.test.mjs tests/enterprise/ENT-120.test.mjs
mise exec -- node --test tests/enterprise/ENT-117.browser.test.mjs tests/enterprise/ENT-118.browser.test.mjs tests/enterprise/ENT-119.browser.test.mjs tests/enterprise/ENT-120.browser.test.mjs
mise exec -- node scripts/enterprise/verify.mjs batch --batch B05
```

### Scope revision 4: exact closure review and historical continuation

B00 implements `closure-review.test.mjs` and `continuation-v4.test.mjs`. Current-run
independent acceptance is still required; implementation and fixture successes do
not approve any product Issue.

A passing normal batch gate now returns `closureCandidate` in `lastGate`. Its
content-addressed candidate binds the full preceding closure, original plan bytes,
input manifest, original Issue/AC definitions, suite definitions, exact receipts,
outputs and builder sessions. The candidate is not an approval. Review all members
using `work/enterprise/REVIEW_CLOSURE.md` and retain the active legacy block.
For the closure block's per-member AC decisions, the executable shape is
`issueEvidence: [{issueId, decisions: [{id, verdict: "APPROVE", artifacts: [path]}]}]`.
Every original acceptance ID is required exactly once. Artifact paths must occur
in that member's actual output manifest. The report still supplies substantive
review findings and limitations; a matching JSON object alone is insufficient.

After TAKT has saved the actual independent report, the authorized writer uses:

```sh
mise exec -- node scripts/enterprise/verify.mjs batch --import-closure
```

This reads the canonical report filename from the published workflow contract,
requires identical closure objects in logged Phase 1 and Phase 2, checks the real
readonly Astra/high reviewer and every builder session, and validates current
latest passed evidence for every member. A later scoped review supersedes only
its explicit member; an unknown-scope review fails closed. The existing single
batch path remains available and retains its exact original validation.

The importer shares the existing exclusive gate lock and durable filesystem
primitives with continuation. It preserves the raw report and writes immutable
before/projection/checkpoint files under `evidence/enterprise/closure-imports/`
before one atomic progress replacement. Interrupted staging can be retried;
after a completed replacement a retry verifies and returns already imported.
No partially approved dependency prefix is exposed. Selection/resume and final
seal validation retain the report, candidate hash and explicit member identity.
Final checks remain readonly; they never invoke this writer.

`batch --initialize-run` also resolves the old run's latest canonical review even
when it was never imported into old progress. It authenticates its logged phases,
readonly routing, real session, exact old receipt, outputs and reviewed plan.
It archives raw report/receipt with `historyOnly=true` and `currentApprovals=[]`
before publishing the new B00 projection. Missing, changed or concurrently
replaced report/authority prevents projection replacement. Old central state and
old selection bytes remain unchanged. The historical plan need not equal the new
scope's plan, but must equal the plan fingerprint in the reviewed old receipt.

These are local POSIX fsync/link/rename/flock recovery contracts with isolated
orchestrator fixtures. They do not guarantee durability under simultaneous loss
or malicious replacement of all product and orchestrator storage.

### Rejected closure: regenerate evidence without granting approval

`mise exec -- node scripts/enterprise/verify.mjs batch --recover-rejected` authenticates
an already selected active batch, its original prerequisite approvals, the actual
independent rejection, and the current plan's independent recovery-design approval.
The frozen workflow's ordinary `batch` gate dispatches to this same path only for
the specific prerequisite-review supersession rejection. Other selection errors
remain errors. No batch, report, session or historical cutoff argument is accepted.

Each recovery root preserves the original selection and first rejection. Immutable
attempt headers bind subsequent actual rejection occurrences, plan/input/suites,
builder identity and the preceding terminal. The gate runs every prefix suite in
real subprocesses and retains failed/interrupted receipts. A passed attempt creates
an unapproved closure candidate, then its result, terminal journal and head; a
publication checkpoint distinguishes completed heads from interrupted publication.
A retry with unchanged input and authority validates and returns the same receipts.
Source changes or a new authenticated rejection require a new whole-prefix attempt.
Plan/contract changes additionally require their exact independent design review.

Progress, active selection, approvals, original evidence and protected files remain
unchanged. `MACHINE_EVIDENCE_REGENERATED_REVIEW_REQUIRED` is machine evidence only.
Reviewers resolve the newest terminal under `evidence/enterprise/recoveries/`, check
it against the entire chain and runs/index, and use the candidate from that result,
not the old `progress.lastGate`. Recovery candidates contain the header reference;
the review closure block additionally binds the result's path and raw SHA-256 as
specified in `work/enterprise/REJECTED_REGENERATION.md`. Both report phases must agree.
Only a fresh exact APPROVE can be imported by the ordinary atomic closure importer.
After approval, chain validation remains historical provenance and grants no further
regeneration permission. Subsequent selection and readonly final checks stay strict.

The tests use isolated actual TAKT registries, compiled workflows and sessions,
real CLI/command-gate execution, filesystem mutation monitoring, process termination,
and genuine suite failures. They do not write synthetic authority to the live run.
Durability assumes local POSIX fsync/link/rename/flock and Python 3. Coordinated loss
or privileged rewriting of product and central authority is outside this guarantee.
The approved plan's design-time status fields are retained byte-for-byte; current
implementation evidence and its independent acceptance are recorded separately.

### ENT-201 の容量制限つき読み取り専用検査

macOS の作業ツリーで `mise exec -- node scripts/launch.mjs ent201` を実行すると、
インストール済み TAKT が ENT-201 の API と実 Chromium の検査を実行する。
`--check-storage` は同じ経路で容量超過とソースへの書き込み拒否だけを検査する。
どちらも作業ツリーをコピーせず、空き 30 GiB を開始条件とし、実行時の書き込みは
最大 768 MiB の一時ボリュームに収める。ログは個別 64 KiB まで読み取る。

監督プロセスは準備、検証、事後照合にそれぞれ専用の継承ソケットを渡し、前の
プロセスの終了を確認してから次を許可する。事後照合は検証プロセスとその配下を
回収した後に、ソース、依存パッケージ、実行設定、TAP と成果物のハッシュを照合する。
終了時にボリュームを解放し、256 KiB 以下の結果を
`~/.local/state/aip-takt-ent201/{latest,storage}.json` に残す。保存済みの結果から認可を
復元することはできない。監督プロセス自身が SIGKILL された場合は、残った
`active` が次の実行を止める。

このコマンドは実行結果を現行入力に結び付けるための検査で、進捗や正式承認を書き換えない。
正式な B06 受け入れには、承認済みの前提バッチ、正規 TAKT 実行内の B06 証跡、
同じ証跡に対する独立した読み取り専用レビューが必要。
