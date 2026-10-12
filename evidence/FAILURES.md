# Failures and Deviations

検証失敗、途中停止、受入条件に不利な結果、固定後の設計変更を追記します。失敗runを削除して成功runだけを残してはいけません。

現時点では製品検証runを開始していません。

## 2026-10-12 — goal review B-001: 監督検証の入力欠落

- 指摘: `supervision-mechanism.inputs` に、試験が読む `.takt/tasks.yaml`、`docs/ARCHITECTURE_BASELINE.md`、`work/DECISION_REQUESTS.md`、`architecture/composition.json`、`work/ROADMAP.json` が含まれていなかった。旧receipt `20261011183543417-mechanism-ee4e0a` の34入力では、隔離実行・PR禁止などの検査対象の現在版を証明できない。旧receiptは履歴として保持し、今回の承認根拠には使わない。
- 再現: `node --test --test-name-pattern='supervision receipts track' tests/platform-control.test.mjs` は、入力追加前に exit 1（`.takt/tasks.yaml must be fingerprinted`、1 test failed）。失敗を削除せず、同じ回帰試験を保持した。
- 修正: 上記5ファイルを宣言入力へ追加。検査commandは変更していない。回帰試験は一時領域で実際のrouting・queue試験を実行してreceiptを生成し、`worktree: false`、`auto_pr: true`、残る4ファイルの変更でreceiptが失効すること、および元の入力に戻すと照合が成功することを確認する。
- 再検証: `npm run verify:mechanism` は exit 0。41 tests passed、0 failed、0 skipped。workflow doctorとgoal検査も exit 0。
- 現在のreceipt: `evidence/run-manifest.json` の `20261011184544696-mechanism-f243ce`。39入力、planDigest `959bb7ff33bd1eeca0504ca5fb15657537ceb556b80c77e132810cc2296e3892`、inputDigest `25e8b25bd2d44f4cd5370ec8c2cc48418a89cc12fac25848d5094ce36fbca4b0`。
- 範囲: ローカルで修正・再検証済み。独立した `review-goal` の再審査は未実施。製品AC-001〜AC-009は全件 `NOT_RUN` のままであり、この監督機構receiptを製品完成の証拠にしない。


## A-001 — architecture採用承認の保留（2026-10-12）

architecture-contract-metadata suiteのrun `20261011185851464-architecture-30df45` はexit 1。composition.status=draftのため `validate architecture` が拒否した。原因はDR-ARCH-001の内製コード配布license回答未確認であり、設計の完了や製品PASSを宣言しない。47責務の設計と反例検査は準備済み。license承認の明示記録後、現入力に対するarchitecture suiteを再実行する。失敗receiptは保持する。

### 2026-10-12 — A-001の解消とarchitecture再検証

DR-ARCH-001の解決済みMIT判断、LICENSE、package/lockの宣言、OSS_BASELINE、47責務のapproved構成を再確認した。license宣言の不一致・grant欠落・未承認を拒否する検査と、LICENSEを含む宣言入力を追加した。共通Portのcancel/deadline/上限・エラー意味論を補い、BCP設計targetと復旧手順をops/BCP.mdへ反映した。

- `npm test`: exit 0、58 passed、0 failed、0 skipped。
- architecture gate: exit 0、3 commands exit 0、17 metadata tests passed。receipt `20261011200724021-architecture-db37ee`、17入力、inputDigest `fa57cfc93ddbe12d8d5f990deac0d30e6064d3b452f78ef59515538b33d72fa9`。
- mechanism: exit 0、3 commands exit 0。receipt `20261011200729074-mechanism-bc231d`、45入力、inputDigest `be370ba8625b2a72e5cc61737d495b3171bb105aa09889eec4a3d6da5e1fb528`。
- 両suiteの入力・suite定義digestを独立計算し現在receiptと一致。過去失敗receiptは削除していない。
- 範囲は構成と設計metadataの検証。独立review-architectureは未実施、製品AC-001〜AC-009は全件NOT_RUN、BCP数値は未実測。

## 2026-10-12 — architecture review B-ARCH-001/002への修正

独立reviewはREQUEST_CHANGES。B-ARCH-001はAction key/inbox/ERP ledgerの保持と期限後再送契約の欠落、B-ARCH-002はKernel DB復元で失われたoperation IDを発見する独立耐久契約の欠落。設計欠落の指摘であり、実動障害を再現済みという記録ではない。

- 保持: Action keyと最小結果・状態、consumer inbox、ERP ledger、recovery journalを無期限保持。key再利用禁止。Auditの30日保持と分離し、記録欠損・保持範囲不明を未適用扱いしない。
- 発見: 別volumeへfsyncするRecoveryJournalPortを定義。INTENTをDB transaction前、COMMITTED markerをDB commit後かつdurable ack/配送前に耐久化する。tenant/store snapshot、epoch/sequence/hash chain、original key/digest/actor/action/operation ID対応を列挙する。復旧は全epochと復元DBの既存未解決操作の和集合を既定範囲とし、controllerの観測IDを入力にしない。欠損・認可拒否・未分類では受付/配送をfenceする。
- 配線: RECOVERY_CONTRACT.json、D-11、ops/BCP.md、action/event/writeback/recovery/cdc/audit/object-storeの契約と実動検証計画へ反映。監督suite入力は新契約とBCP台帳を追加し、既存command・試験を保持した。
- 検査: npm test exit 0、71 passed、0 failed、0 skipped。現在のarchitecture gateは30 metadata testsと3 commandsがexit 0。mechanismは41 testsと3 commandsがexit 0。新規反例検査は設計metadata欠落を拒否する検査であり、実動保持・復旧のPASSではない。
- 現在のarchitecture receipt: 20261011201859803-architecture-ac1688、18入力、inputDigest acbc05c3c2445c742c06c4d6fdc72898c43349ed73a0fad13c4a0163b2e20855。
- 現在のmechanism receipt: 20261011201902118-mechanism-f7d23d、47入力、inputDigest 819dfcf7c98480d1c8cb5978c5886e426e4da1914eeb625dcbc3b7fa40c8c869。
- 両receiptの入力digest、suite定義、command argvを独立計算・照合し一致。旧receiptとlicense保留の失敗記録は削除しない。独立reviewの再審査は未実施。製品AC-001〜AC-009はNOT_RUN、BCP目標は未実測。DBとjournal両volumeの同時喪失は初版保証外としてfail closed。


## 2026-10-12 — F-FOUNDATION-001: 実DB起動拒否・foundation未完

前段の「製品検証run未開始」は当時の記録として保持する。今回は実装source・migration・seed・実DB試験を作成し、検証を開始したが失敗した。PRODUCT_GOALと固定baselineを弱めず、M-01〜M-03の完了/AC-002〜AC-004の合格を宣言しない。

- 依存: 最初のnpm ciはexit 0。pg 8.16.3の導入はdefault npm cacheのEPERMで一度失敗した後、task-local /private/tmp cacheでexit 0。cache権限やcredentialを変更していない。
- 根因: native initdbが `FATAL: could not create shared memory segment: Operation not permitted`、`Failed system call was shmget(... size=56 ...)` で失敗。migration/seed/業務assertionより前に停止。実DB試験の不変条件は未確認であり、DBをmockへ置換しない。Docker daemonは接続不可。host Node 25.4.0/PostgreSQL 14.20は承認版22.22.0/18.6と不一致。
- 全体: npm test exit 1、98 tests / 76 passed / 22 failed / 0 skipped。追加standalone contract/fsync journalは5 passed / 0 failed / 0 skipped。既存metadata/control試験71件の成功を製品AC証拠と混同しない。
- 個別再診断（全てexit 1、skip 0）: kernel-contracts 5/18成功・13失敗、authorization-delegation 0/5成功、definition-lifecycle 0/2成功、recovery-journal-foundation 5/18成功・13失敗、retrieval-comparison-foundation 0/1成功、foundation-bootstrap 0/1成功。JSONにTAP/stdout/stderrを保持。journal suiteの5件はkernel suiteと同じ単体を再実行したもので独立した5ケースの追加ではない。
- 失敗stage receipt: `20261011210125257-implementation-77ee9a`。foundation-bootstrap command exit 1、inputs 30 files、inputDigest `76df560e0b0cb81be85a4aeb34c7d6c111bf6307667a6cae92598df55f3e451b`、planDigest `356c81923bbf0b08c707ab2f6371e5f71a4d3626488b264641b85c432530b68e`、output artifact SHA-256 `ce41384e0efa2860bda5a404b1c7a5e58c8a5570cd1db706981305f31a2c18a6`。先行失敗run `20261011205857678-implementation-434297` も保持。stage fail-fastのため他5 suiteの個別診断にはstage成功receiptがない。
- source: config/ontology.json、migrations/001-foundation.sql、src、scripts/foundation、tests/foundation、docs/IMPLEMENTATION.md。独立ERP HTTP/DB、生成client、別volume/process kill、保持境界/lease/full lifecycle等は未完。現在のOutbox consumerはローカルprojectionでありERP反映の成功ではない。
- 停止/再開: 同一shmget拒否が反復し、PRODUCT_GOAL §6に従いDR-FOUNDATION-001へ記録した。build-foundationで検証可能な既存隔離環境と固定版bootstrapを用意し、欠落実装を完成→全6 suite実行→現入力成功receipt→独立review-foundationへ戻す。AC-002〜AC-004はFAIL、その他ACはNOT_RUN。環境回復だけで未完コードが合格するとは判断しない。


## 2026-10-12 — F-FOUNDATION-002: 固定版でもagent sandboxの共有メモリ拒否が再発

DR-FOUNDATION-001の監督者環境での成功は履歴として保持する。今回のagent実行ではmiseのNode 22.22.0/PostgreSQL 18.6でもinitdbがshmget Operation not permittedで失敗した。Docker daemonにも接続不可。環境版の不一致を今回の根因にしない。

- npm ci: default cacheのEPERMでexit 255。task-local /private/tmp/aip-foundation-npm-cacheへ切り替えた再実行がexit 0。導入終了後に全体・個別診断を再実行した。
- 修正: recoveryRangeの欠落/縮小/DB drain欠落/未証明optimizationを拒否する4反例、版/digest付き生成clientとHTTP通信・correlation/no-retry反例、実process SIGKILL→新processでのjournal再読試験。bootstrapには既存の実DB経路を保持してgenerated-client HTTP操作を追加。全implementation suiteの入力にmise.tomlを追加。失敗試験・既存receipt・ACは削除/弱化していない。
- 全体: mise exec -- npm test exit 1、105 tests、83 passed、22 failed、0 skipped/cancelled。22件はinitdb起動時に停止。単体5件、client transport/再現性2件、journal実process1件が成功。TypeScript compiler検査は未実行。echo serverはKernel代替ではなくwire unitのみ。
- 6個別diagnostics: 全suite exit 1、skip 0。bootstrap 0/1、kernel 7/20、definitions 2/4、authorization 0/5、journal 6/19、retrieval 0/1。重複単体を新しい独立ケースとして数えない。
- AC-002〜AC-004はFAIL。現Outboxはローカルprojectionで独立ERP未実装。DBとjournalは同じtemp root/volumeで別directoryにあるだけ。combined commit/ack/process kill、別volume、mixed-client、保持境界/lease/全定義lifecycle等は未完。
- 停止/再開: 正本§6の反復阻害停止条件に従いDR-FOUNDATION-002へ影響・選択肢・既定案・build-foundation再開点を記録。今回の現在入力失敗receiptを別途索引し、成功したmetadataを製品合格へ転用しない。

### F-FOUNDATION-002の現在receipt

`20261012031650467-implementation-ae518c`、stage failed。foundation-local-contractsは8/8成功、command exit 0、bootstrapは0/1成功、command exit 1。双方の入力38ファイル/digest `4dafbd5baa87611ec2083e7c6e7078db4f4570194fcbaec9b43347447fc24925` とsuite定義・command・出力hashを独立計算して照合した。local artifact SHA-256 `19fa9f45dde527fdaf86ae97822f73b6180a1ff008dfbf212150d90b7a9fc121`、bootstrap artifact SHA-256 `85dcffbb0b1db669592463d4dc150825cc46437af018a0d02d35075914b6ea34`。後続5 suiteはfail-fastでstage未実行、個別診断は成功stageとして扱わない。先行する今回の失敗run `20261012031628843-implementation-66db2e` も保持。

## 2026-10-12 — F-FOUNDATION-003: current DB path works; broader foundation remains incomplete

DR-FOUNDATION-001/002 are RESOLVED and unchanged. Current pinned bootstrap and real DB suites succeed; historical shmget failures and receipts remain history, not the current diagnosis. Initial npm ci with the task-local cache exited 0. TypeScript 5.9.3 was installed as an exact development dependency (exit 0, npm reported zero vulnerabilities).

This build adds a separate synthetic ERP database/principal/HTTP ledger, durable writeback lease/SENDING/UNKNOWN reconciliation, generated-client completion, original-delegation revalidation, declaration compiler and mixed-client publication/rollback, actual Kernel SIGKILL at five boundaries and separate task-owned APFS volume tests. Projection Inbox acknowledgement no longer falsely completes ERP delivery.

The first independently mounted-volume test failed before assertions during PostgreSQL startup. The harness now uses a short task-owned Unix socket path outside the mount tree and retains startup log text on failure. Re-running that test and five process-boundary cases succeeded. The failed run is not removed or described as a business-invariant pass. This is a local technical correction, not a new environment/permission decision.

Current full `mise exec -- npm test`: exit 0, 127 tests, 127 passed, zero failed/cancelled/skipped. Dedicated suite receipts are regenerated after the final declared input changes. Suite success must not mask the still-missing retention boundary, full definition/Policy/Rule/Workflow authoring, ingestion/checkpoint/history/quality and secret/telemetry obligations. Kernel crashes do not prove PostgreSQL process crash or destructive restore; RPO/RTO and compensation remain unmeasured. AC-002–AC-004 are not accepted, and no human decision request is opened for technically implementable remaining work.

### F-FOUNDATION-003 — document gate correction

The first `validate implementation` after the nine-suite success rejected `docs/IMPLEMENTATION.md` because an angle-bracket suite-name example matched its unresolved-placeholder guard. The example was replaced with an actual executable kernel-contracts command, without changing that guard. All implementation suites are rerun because the document is a declared input; the preceding success receipt remains historical and becomes stale. The final acceptance gate must still reject AC-002 FAIL until the remaining foundation obligations are met.


## 2026-10-12 — F-FOUNDATION-004: additional invariants implemented; full foundation not accepted

Current iteration adds Action-linked authorized history with an as-of revision bound, finite executable Policy/Rule/Workflow programs and scoped simulation/publication fences, retained-key/Inbox/ERP ledger/Audit logical-time boundary tests, and encrypted synthetic file-secret injection/rotation through actual ERP HTTP. Existing failure cases and declared inputs are retained. Initial retention diagnostics failed four assertions because the new test expected IDEMPOTENCY_KEY_REUSE instead of the existing public IDEMPOTENCY_MISMATCH code. The expectation was corrected to the existing contract; all six cases then succeeded. No product error contract or test was removed.

The application logical Date clock is advanced, not PostgreSQL time or actual elapsed years; no-expiry storage is tested and no purge is introduced. File secrets use trusted in-process capabilities, not external actor claims; a complete secret-service Audit/lease policy and operational telemetry remain unimplemented. Source ingestion/checkpoint/quality/quarantine/lineage and full responsibility coverage also remain. DB process crash/restore is not established by these tests. AC-002–AC-004 remain FAIL pending unmet foundation obligations. No human decision is needed for these technical tasks. Final test and receipt counts are indexed in ACCEPTANCE_MATRIX.md after regeneration.

## 2026-10-12 — F-FOUNDATION-005: real ingestion, Authoring and service-secret evidence added

The first ingestion diagnostics failed on SOURCE_GAP because PostgreSQL bigint cursor values were returned as strings. The adapter boundary now normalizes the validated bounded cursor to a number, and all four ingestion cases pass through real PostgreSQL and generated HTTP clients. Immutable receipt/cursor, quality quarantine/correction, source/Action lineage, tombstone history, collision, concurrency and injected transactional rollbacks are covered. No DB mock or skipped fallback was introduced.

Authoring tests add definition diff, simulation-case editing, failed expected outcomes, review invalidation and stale reviewed Object rejection. Secret access tests authenticate trusted service identities per reference and require durable SecretResolved/SecretDenied Audit before release; failed Audit prevents outgoing HTTP. Scoped observations report Action/Outbox counts, oldest queue age and bounded source checkpoints without Object/secret values. An initial observability test mistakenly used a nonexistent ERP fault name; the test was corrected to the actual lost-ack injection and asserts UNKNOWN plus foreign/unauthorized views. A subsequent queue-age SQL alias quoting error caused an import failure, was fixed, and the full tests were rerun.

Final full mise exec -- npm test: exit 0, 154 passed, zero failed/cancelled/skipped. Implementation receipt 20261012070508163-implementation-0ad936: all 13 suites pass; 58 current declared inputs, digest 2086437edd655c22e2d82caa3fbe30c1e3d594c685138b6b87aa0bf10af239e3. Suite total 106 includes repeated standalone cases. Historical failures and receipts remain. Current acceptance remains FAIL pending complete adopted responsibility coverage, snapshot/change overlap and pipeline process recovery, full operational telemetry and independent foundation review. Source ingestion is a finite synthetic change-log profile; observations are a bounded status API; neither is a production connector or complete monitoring system. No environment or human decision request blocks technical continuation.


## 2026-10-12 — F-FOUNDATION-006: missing bounded foundation profiles implemented and reverified

The previously missing snapshot/change overlap and durable pipeline cursor now run over the same source receipt/Object/history/Audit transaction. Actual worker SIGKILL before and after checkpoint commit verifies restart without duplicate effects. Added immutable bounded blobs, reviewed versioned identity aliases, scoped fixed-template analytics, durable trace telemetry, persisted schedules and gateway/graph/capability boundary tests. All existing suites, negative cases and broad source/test/config input declarations remain; four suites were appended. docs/IMPLEMENTATION.md maps all 47 responsibility decisions to executable foundation evidence and explicitly retains later store, exchange, BCP and release obligations.

An initial trigger test called nonexistent erp.setMode and failed before its reconciliation assertions. The failing TAP is retained at generated/foundation/failures/trigger-fixture-20261012.tap. The fixture was corrected to the existing erp.controller.mode lost-ack injection; the combined 16-case test run then passed. No product error contract or failure assertion was removed. Final checks also aligned actual Object policyVersion with its existing generated declaration and added a telemetry INSERT-denial case: an unavailable response after business commit retains transactional Audit/Object/Outbox, and retrying the original key returns the original Action without duplicate effect.

Final full mise exec -- npm test: exit 0, 173 passed, zero failed/cancelled/skipped. Final implementation receipt 20261012073004567-implementation-77b2c5: all 17 suites passed, 68 declared inputs, digest e1c355f9a561a3d6128b198728c8c693eb7ea76640e9601f77c9cddb9029fb51. Suite total 125 includes repeated standalone cases. AC-002–AC-004 now index current machine evidence as PASS, explicitly pending independent foundation review. This does not accept AC-001/005–009. Original six design-file hashes match the fixed baseline. Kernel and ERP share the isolated PostgreSQL server; application-clock retention tests do not simulate DB expiry or actual elapsed years. DB-process crash/restore, compensation, RPO/RTO, persistent alternative Adapter cutover and release controls remain subsequent milestones, not verified outcomes. No new human decision request was required.

Final implementation validation exited 0. Independently recalculated suite definitions, current input digests and all 25 output artifact hashes match the receipt; git diff --check exited 0. This local verification is not a separate-session review.

## 2026-10-12 — F-FOUNDATION-007: TAKT gate selected ambient Node instead of pinned tools

TAKT's exact command `./.takt/quality-gates/platform-gate.sh implementation` failed with exit 1. Receipt `20261012073252102-implementation-deacc7` records local contracts 9/9 passed and bootstrap 0/3 passed, with later suites not run due to fail-fast. The bootstrap report records Node v25.4.0 instead of required v22.22.0. The shell gate invoked plain node, so prior successful mise-prefixed commands did not establish that the actual TAKT entry selected the pinned environment. The fixed-version assertions were retained.

Before regeneration, the failed reports were copied to [bootstrap](generated/foundation/failures/gate-bootstrap-20261012.json) and [local contracts](generated/foundation/failures/gate-local-contracts-20261012.json); both copies match the original failed receipt's artifact SHA-256. The original command log remains `.takt/quality-gates/logs/1791790375014-command-gate-7fd5af6f-76b8-44eb-9969-4f7034eec448.log` (ephemeral ignored log). The failed receipt remains in run-manifest.json.

The gate now invokes each controller command through `mise exec -- node`, retaining stage commands, fail-fast, validation and fixed-version checks. Three launcher regressions cover unusable ambient Node, missing mise, and a failing mise exit code with no subsequent validation or ambient fallback. All three failed against the previous gate ([TAP](generated/foundation/failures/gate-regression-before-20261012.tap)) and passed after the fix. The real product/DB suites remain the product evidence; synthetic launcher executables test only tool-selection failures. Every implementation suite additionally hashes the gate and receipt controller; existing inputs and assertions were not removed.

Initial pinned npm ci exited 0. Final `mise exec -- npm test` exited 0: 176 passed, zero failed/cancelled/skipped. The exact TAKT command, without an outer mise wrapper, exited 0 and generated receipt `20261012073547492-implementation-831eea`: 17 suites passed, 71 input files, digest `1888b1523fe1e1194ba8b299d37cf5fc63687304be02c55fb4ef660e0f0b0272`, 25 output artifacts and 128 suite test executions including duplicates. All suite reports record Node v22.22.0; bootstrap's PostgreSQL 18.6 assertions passed. Separate hash calculation matched current inputs, suite definitions and outputs, and the six original design hashes match SOURCE_BASELINE. This is verification within the implementation session, not independent review. AC-002–AC-004 index the new machine receipt; independent foundation review and subsequent demo/BCP/release obligations remain outstanding.

## 2026-10-12 — F-FOUNDATION-008: independent foundation review required contract repairs

The first independent review returned REQUEST_CHANGES for B-FOUNDATION-001–004. Its observations were static; the implementation session then reproduced all four findings over real PostgreSQL and generated HTTP clients. The initial seven tests all failed (0 passed, 7 failed, 0 skipped, exit 1). Their full TAP remains at [review regressions before repair](generated/foundation/failures/review-regressions-before-20261012.tap). No failing case was removed or changed to a mock/skip. The final expanded regression inventory has twelve cases.

B-001: approval records previously appended :approval to a public key in the same journal namespace, shadowing another legitimate submission. Explicit submission/approval operationKind now separates records while preserving original Action/operation IDs and keys. Legacy approvalActor records are recognized without interpreting a user suffix. Replay verifies both IDs as well as the canonical digest. Tests replay the colliding user key over HTTP, reopen the journal and launch a fresh process. A confirmed approval rollback retains the previously committed pending submission; unresolved INTENT still fences effects.

B-002: approval now reconstructs original actor/subject/delegation store and column scope, rechecks every evidence revision/projected digest and locks evidence Objects until commit. Tests reject changed non-target evidence, shrunken principal/delegation scope and changed column visibility, while preserving business state and recording denial. The positive delegated case succeeds with a wider approver and proves a competing SQL update cannot change checked evidence before commit. Outbox retains the original actor/onBehalfOf.

B-003: rollback now requires an already PUBLISHED immutable definition. An unpublished REVIEWED version cannot bypass stale baseline or Object revision checks; tests preserve the live policy and reviewed state on denial and retain valid published-version rollback.

B-004: query with a search field requires search permission in addition to read at Gateway and Kernel. Tests cover policy, principal and delegation denial across query (including empty search), search and objects.search tool, with no business/snapshot mutation; ordinary get/query remain permitted.

N-FOUNDATION-001: the matrix pinned an older run while a subsequent gate overwrote generated artifacts. Its index now deterministically selects the last implementation entry in run-manifest.json, including failed runs. Existing validation still requires that latest run to pass with matching current input, suite-definition and output hashes; older success cannot substitute. Historical receipts and failures are retained. Independent review has occurred, and repair approval requires a new separate-session review, not this implementation session's tests.

The twelve expanded real DB/HTTP regressions pass with exit 0. The new review-regressions-foundation suite retains broad source/test/config declarations; all existing suites, inputs and commands remain. Final `mise exec -- npm test` exited 0 with 188 passed and zero failed/cancelled/skipped. The exact TAKT command `./.takt/quality-gates/platform-gate.sh implementation` (without an outer mise wrapper) exited 0: all 18 suites and acceptance validation passed. Receipt `20261012075614074-implementation-719697` ran from 2026-10-12T07:56:14.074Z to 2026-10-12T07:56:39.931Z, with 73 input files, input digest `5ecd85bfa7a6fe3b108fc2de131b95925741c67c3352bd51dede7c93cb8066df`, 26 output artifacts and 140 suite test executions (including duplicates, not additional to 188). All reports record Node v22.22.0. Separate recalculation matched every suite definition, current input digest and declared output hash. Original six design hashes match SOURCE_BASELINE. AC-002–AC-004 are machine PASS pending independent repair review; subsequent gates use the matrix latest-stage selector, not this historical run ID. All earlier failure evidence remains. These checks do not close subsequent demo, BCP, Adapter exchange, release or final audit obligations.

## 2026-10-12 — F-FOUNDATION-009: review/edit/publication TOCTOU from second independent review

The second independent review accepted the observed B-FOUNDATION-001–004 repair paths but returned REQUEST_CHANGES for B-FOUNDATION-005. Its static finding was reproduced with real PostgreSQL and generated HTTP requests. Initial four regressions all failed with Missing expected rejection (exit 1): review concurrent with edit, publication concurrent with edit, stale stored simulation binding, and edit-away/edit-back during review. Full TAP remains at [authoring concurrency before repair](generated/foundation/failures/authoring-concurrency-before-20261012.tap). No prior test or failure evidence was removed.

Monotonic cases_revision and conditional SQL updates now bind the reviewed snapshot to the committed row. Review cannot overwrite an intervening edit even when case content returns to its original value. Publication checks current case digest/revision and definition digest, including rollback; a CAS transition locks the exact reviewed definition through live pointer, Policy epoch, Audit and commit. Editors update only editable rows at the observed case revision. The clean isolated bootstrap explicitly binds its seed review to empty cases; no existing-environment migration was attempted.

Seven expanded tests pass (exit 0), including actual editor lock waiting during publication, refusal after commit, an injected failure rolling definition/live/Policy changes back, valid subsequent publication, and corrupted prior-published rollback refusal. Fault hooks only schedule or interrupt real transactions; there is no mock state/authorization adapter. The initial four failures remain part of the seven tests. AC-002–AC-004 now index regenerated current receipts; repair review by a separate session remains outstanding.

Final pinned npm ci exited 0. Full `mise exec -- npm test` exited 0 with 195 passed and zero failed/cancelled/skipped. `mise exec -- npm run foundation:test` passed all 19 suites. The exact TAKT command `./.takt/quality-gates/platform-gate.sh implementation`, without an outer mise wrapper, exited 0 with all 19 suites and acceptance validation passing. Final receipt `20261012081318034-implementation-fa4897` ran from 2026-10-12T08:13:18.034Z to 2026-10-12T08:13:45.010Z: 74 input files, input digest `2e05e18198868be6792f6134fbb1866449f60951c9272c0b090db2228f0a6e2c`, 27 output artifacts, 147 suite test executions including duplicates (not additional to 195). Every report records Node v22.22.0. Separate recalculation matched all suite definitions, current input digest and declared output hashes. The six original design SHA-256 values match SOURCE_BASELINE. AC-002–AC-004 are machine PASS pending independent B-005 repair review; prior REQUEST_CHANGES and failed receipts remain. This implementation-session verification does not substitute for independent review or later demo/BCP/release obligations.

## 2026-10-12 — F-FOUNDATION-010: reviewed Object revision race at publication

Independent review B-FOUNDATION-006 identified an unlocked Object check before publication waited on an Action-held Policy SHARE lock. Two real PostgreSQL/HTTP reproductions failed before repair (0 passed, 2 failed, exit 1): Action-first publication succeeded on stale review, and a competing SQL writer could update a checked Object before publication commit. Full TAP: [before repair](generated/foundation/failures/publication-objects-before-20261012.tap). Earlier REQUEST_CHANGES, receipts and failure evidence remain.

Publication now serializes publishers before authentication using a transaction advisory mutex, upgrades Policy before Object/definition writes, and locks every reviewed decision/case Object in deterministic ID order through commit. This avoids publisher/publisher SHARE upgrade and Action/Object/Policy inversion. Case CAS still detects concurrent edits. Five expanded real DB/HTTP regressions retain the initial failures, test both orderings, a direct SQL writer, rollback and lock release after injected publication failure, fresh review, idempotent Action replay and concurrent stale-baseline rejection. Existing authoring regressions remain unchanged.

During test development an assertion incorrectly counted all layered Denied records as one; it now checks the submit record specifically (Gateway/HTTP also record denial). A subsequent positive case used the old generated client's version binding for a new-version request; it now uses the same contract HTTP transport bound to the newly published definition. These harness failures are preserved at [Audit assertion](generated/foundation/failures/publication-objects-audit-assertion-20261012.tap) and [client version](generated/foundation/failures/publication-objects-client-version-20261012.tap). No product validation or failure case was weakened. The combined five new and seven existing authoring tests pass (12 passed, zero failed/cancelled/skipped, exit 0).

Pinned npm ci exited 0. Final `mise exec -- npm test` exited 0 with 200 passed and zero failed/cancelled/skipped. `mise exec -- npm run foundation:test` passed all 20 suites. The exact TAKT command `./.takt/quality-gates/platform-gate.sh implementation`, without an outer mise wrapper, exited 0 with all 20 suites and acceptance validation passing. Final receipt `20261012083604490-implementation-a6f809` ran from 2026-10-12T08:36:04.490Z to 2026-10-12T08:36:32.803Z: 75 input files, input digest `df787386af56705b4cb245cb148789f4e4494a33a9b5f1a0fddee3e6787571b1`, 28 output artifacts, 152 suite test executions including duplicates (not additional to 200). Every report records Node v22.22.0. Separate recalculation matched all suite definitions, current input digest and declared output hashes. The six original design SHA-256 values match SOURCE_BASELINE. AC-002–AC-004 are machine PASS pending independent B-006 repair review; prior REQUEST_CHANGES and failure evidence remain. No human decision or external resource is required. This implementation-session verification does not substitute for independent review or later demo/BCP/release obligations.

## F-DEMO-001 — Store demo実装中の失敗（2026-10-12）

初回は5件ともAPI業務assertion後のartifact exporterでtelemetryを存在しないid列でsortし失敗した。`generated/demo/failures/first-artifact-export.tap`を保持し、sequenceへ修正した。2店舗seedへ変更後、同一店舗だけを許すstoreEffect条件とforeign店舗の配置が不一致となり4件失敗した。`multi-store-before.tap`を保持し、共通認可scopeによる複数店舗の確認とs3拒否seedへ修正した。未検出caseの発注がSTALE_IMPACTを返す誤りは`early-order-before.tap`に保存し、隔離前提を先に検査するよう修正した。二重承認の試験期待値は既存Kernelの状態拒否PERMISSION_DENIEDと一致せず1件失敗し、`double-approval-before.tap`を保持したうえで公開契約に合わせた。試験削除・skipはしていない。現在の合否はdemo receiptを参照する。

## F-DEMO-002 — 並行試験による証拠上書き検出

全体npm test（208件成功）とdemo gateを並行実行したため、同じfoundation artifactが後から生成され、最終validateでauthorization-delegationの出力hash不一致を検出した。suite自体はimplementation20件、demo2件とも成功したが、gate終了コード1を合格に使わない。`generated/demo/failures/parallel-artifact-validation.log`を保持し、他の試験を終了した後にdemo gate全体を単独再実行する。入力・出力hashの検査は変更していない。


## F-DEMO-003 — 独立review B-DEMO-001/002への修正

第1回store demo独立reviewはREQUEST_CHANGES。公開Rule/Workflow省略と承認拒否Auditの対象欠落を実HTTP/DBの3反例で再現した。修正前10件中7成功・3失敗・skip 0・exit 1の[全TAP](generated/demo/failures/review-regressions-before-20261012.tap)を保持する。公開Workflow閾値による隔離承認、公開minimumQuantityによるvalidate拒否、2件の承認待ちActionを区別する拒否Auditのassertionが失敗した。既存試験を削除/skip/mock化していない。

店舗制約と公開Rule/Workflowを共通decideStoreActionで合成し、validate/submit/approveへ適用した。承認拒否は認可済み保存ActionからID・operationId・対象・元主体/委任・根拠・元版を付加し、評価時の版も保持する。未知IDと管轄外Actionにはcontextを付けない。修正後の最初の10件は全成功。拡張12件ではscope注入fixtureがjsonb列へtext[]を渡して1件失敗した。[fixture失敗TAP](generated/demo/failures/review-scope-fixture-20261012.tap)を保持し、実schemaのjsonb入力へ修正した。検査内容や公開拒否契約は弱めていない。

N-DEMOの実Action例外経路としてQuarantineInventory競合（共有根拠が古くなった敗者はINVALID_EVIDENCE）とCreateReplacementOrder lost-ackを追加し、元SetIsolationのCONFLICT/UNKNOWN試験も保持する。過去の並行検査ログは元.logを保持したまま[byte一致のTAPコピー](generated/demo/failures/parallel-artifact-validation.tap)を追加する。現在の合否は最新demo receiptとvalidateを参照し、独立再審査は未実施である。


### F-DEMO-003 — 最終再検証

Pinned `mise exec -- npm ci --cache /tmp/aip-store-demo-npm-cache`はexit 0。修正後の全体`mise exec -- npm test`は213件成功、失敗/cancel/skip 0、exit 0。全体試験を終了してから`bash .takt/quality-gates/platform-gate.sh demo`を単独実行し、exit 0。implementation `20261012092219088-implementation-7dab97`は20 suite、78入力、digest `202a079b5e26fdd25e6e063c5c2b4ef0cc07d818414e51323521ea5577cdb942`、28出力。demo `20261012092247690-demo-2b6a22`は2 suite（店舗12件/検索1件、失敗/skip 0）、85入力、digest `dae0b68c760a66096f826d8757aea3a10235082b5f81044371916a0e896f99e0`、15出力。再validate demoとgit diff --checkはexit 0。別計算で22 suiteの宣言・現在入力・全43出力hashが一致した。元設計6ファイルも固定baseline hashと一致。

並行artifact失敗のTAPコピーは元logとbyte一致し、sha256 `23bbc466f9740a0d45c85e471d35648119f4d82c90cfd49f9ccf5f58d30db517`。保存した修正前/fixture失敗TAPとこのコピーはgit check-ignoreで非ignoreを確認した。ステージング/commit/pushはしていない。今回の成功は修正実装sessionでの機械検証であり、B-DEMO-001/002の独立再審査は未実施。BCP、RPO/RTO、補償、Adapter交換、releaseと最終監査は未達のままである。


## F-BCP-001 — pg_dump復元driverの失敗

初回BCP演習は4件中1成功・3失敗、skip 0、exit 1。pg_dumpが出すpsql meta commandをpg queryへ渡したため、実restoreがsyntax error near backslashで停止した。[失敗TAP](generated/bcp/failures/restore-driver-before.tap)を保持する。復元driverをpsql -X -v ON_ERROR_STOP=1へ修正し、障害・損失・復旧のassertionを保持した。修正後の4件が成功し、その後店舗縮退を加えた5件も成功した。最終の現在入力receiptはBCP selectorを参照する。過去失敗や手動保留をclean recoveryと扱わない。

## F-BCP-002 — runbookの公開Port名脱落

全体npm testは218件中217成功・1失敗、skip 0、exit 1。BCP runbook書換えでRecoveryJournalPortの明示名が欠落し、既存architecture反例gateが拒否した。[全TAP](generated/bcp/failures/runbook-port-name-before.tap)を保持する。文書へ公開Port名と無期限保持条件を復元した。検査を削除・緩和せず全体を再実行する。


## F-BCP-003 — 独立review B-BCP-001/002/003の動的再現と修正

独立reviewの3件は実PostgreSQL、HTTP、子process SIGKILL、pg_dump破壊復元で動的に再現した。修正前の8件は4成功・4失敗・skip 0・exit 1（3反例と結果exportの件数検査が失敗）。[全失敗TAP](generated/bcp/failures/review-regressions-before-20261012.tap)を保持する。既存4演習は成功したが、レビュー指摘を打ち消す証拠にはしない。

B-001はadmission lock下で独立journalのSEND_STARTEDをHTTP送信前にfsyncし、attempt=0だけの未送信判定を廃止した。新protocolの耐久証拠なし、送信開始あり、ledger不明の場合は手動保留としdispatchを拒否する。B-002は最新COMMITTEDのexternalEvent/commitRevisionsと復元Action/Object/history/Outboxを照合し、同Action IDが残る承認commit喪失もlost-approved-commitと数える。RPO測定にはimmutable mutation集合を追加し、失ったObject/history/ApprovedCommitを再作成しない。B-003はruntime restartと新規bootstrapを分離し、restartでは両witness欠損・新しい空pathを初期化せずUNAVAILABLEとする。

最新の合否は全試験とBCP gateを逐次再実行した現在入力receiptで判断する。この修正sessionの機械検証は独立再審査の承認ではない。以前の失敗証拠とreceiptを保持し、ACと入力範囲を弱めない。

初回修正試験は送信recordへ前のrecordHashを含めてappendした実装ミスによりhash chain検査が失敗した（8件中3成功・5失敗・skip 0）。[失敗TAP](generated/bcp/failures/send-marker-driver-before.tap)を保持する。旧hash/sequence/previousHashを取り除いて新送信recordを生成するよう訂正した。配送に到達せず子processが停止hookへ進まない場合の待機をこの診断では手動SIGKILLで終了し、そのrunは成功に使わない。入力変更中のrunも最終証拠にせず、全体とgateを逐次再実行する。

送信record訂正後の8件は6成功・2失敗・skip 0・exit 1。3反例は成功したが、lost-local-commitの隔離APFS作成がhdiutil resource busyで停止し、全件exportも不足件数を拒否した。[TAP](generated/bcp/failures/mounted-volume-busy-20261012.tap)を保持する。業務試験をskipせず、同じ実volume演習を全体/gateで再実行する。

## F-RELEASE-001 — bootstrap返却Ontology版の誤参照

release clean試験は初回0/1で失敗した。public ontologyはdefinition envelopeを返すがhealth出力が直下ontologyVersionを参照していた。失敗receiptをevidence/generated/release/failures/clean-bootstrap-before.jsonへ保存し、definition.ontologyVersionへ修正した。成功とtraceの出力path衝突も分離した。試験は削除・skipせず再実行する。

## F-RELEASE-002 — 空runtime cacheでのGnuPG socket path長超過

空HOME/mise data/cacheの初回導入はNode署名検査時のgpg-agent socket pathが長すぎて0/1、exit 1。PostgreSQL compileだけ成功した途中状態を成功にしない。[失敗JSON](generated/release/failures/clean-runtime-install-before.json)を保持する。bootstrapが専用の短い/tmp pathをGNUPGHOMEにして署名検査を維持し、所有agent/pathをcleanupするよう修正した。修正後は同じ完全空cache試験が1/1、exit 0で完走した。

## F-RELEASE-003 — 既定runtimeの未固定共有library参照

初期mise buildの実otool検査でHomebrew OpenSSL 3.6.1/ICU 78.2へのリンクを検出した。[観測記録](generated/release/failures/default-linkage-before.json)を保持する。OpenSSL公式NEWS（https://github.com/openssl/openssl/blob/master/NEWS.md）は3.6.2で複数CVEを修正している。既存host libraryを更新せず、release専用mise cacheでlocalhost専用PostgreSQLを外部SSL/ICU/readlineなしにcompileする入口へ修正した。clean suiteと供給網suiteはconfigureと実binaryリンクを検査し、既存global runtimeの流用・依存再混入を拒否する。

## F-RELEASE-004 — 最終索引表の受入matrix parser衝突

release 5 suite成功後のvalidate releaseがAC索引の3列行を受入状態行と解釈し、exit 1。[全gate log](generated/release/failures/matrix-index-before.txt)を保持する。parserを緩和せず、索引表のIDをcode表記にして正本9行と区別した。入力変更後に全7stageを再実行する。前runのsuite成功だけをrelease gate成功にはしない。

## F-DEMO-004 — 最終独立監査B-FINAL-001: 店舗隔離の制限列がERPへ流出

最終監査はAC-003/005をFAILとしてbuild-store-demoへ差戻した。Writeback.payloadがSetIsolation以外で内部fields全体を転送し、通常traceのQuarantineInventory 2件がsynthetic制限列secret=hidden-wordをERP ledgerへ保存していた。監査対象のnormal.jsonを[byte一致の保存trace](generated/demo/failures/final-audit-normal-before-20261012.json)へ保全した（SHA-256 eb596e9857fda00611ff82f7e06535186bab5181ea4b3c9c69e5ecae473a6e13）。元receiptと過去失敗記録は保持する。

修正前に通常・委任・承認付き隔離の実HTTP/ERP反例と、全店舗traceのledger再帰検査を追加した。`mise exec -- node --test tests/demo/store.test.mjs` は15件中2成功・13失敗・cancel/skip 0・exit 1。[全失敗TAP](generated/demo/failures/restricted-export-before-20261012.tap)を保存し、試験の削除/skip/mock化はしていない。

外部contract 1.0.0のAction別許可項目をWriteback.payloadでscalar型検査して投影する。未知Action/版、許可項目へのObject混入はHTTP/lease前に拒否する。内部Object/Outboxの全fieldsは保持し、dispatch/reconcileは同じimmutable eventから同じpayload/digestを作る。通常・委任・承認付きのlost-ack→UNKNOWN→照合を実ERP ledgerと効果で確認する。全Actionの未知列/入れ子除外と型違反拒否も追加した。直接修正検査は16件すべて成功、fail/cancel/skip 0、exit 0。正式な現在入力receiptは全stage再実行後の最新selectorを参照する。

初回pinned npm ciはexit 0（419 packages追加、604 packages監査、検出脆弱性0）。既存送信済み旧payloadのdigestを新形式へ書き換える移行は行わず、不一致はUNKNOWNのまま手動照合対象となる。実データ/既存環境への書戻しはない。修正後の独立店舗review・後続review・最終監査は別sessionで行う。


## F-FOUNDATION-011 — 最終独立監査B-FINAL-002: absolute deadline / cancel signalの破棄

最終独立監査は公開dispatch/reconcile/continuitySet/recover/compensateが呼出し元の予算を破棄し、配送時に既定期限を作り直す問題でbuild-foundationへ差し戻した。旧成功gateはこの契約違反を検出しておらず完成根拠にしない。修正前の実DB・HTTP反例11件は全件失敗、exit 1（期待した拒否なし）。[全失敗TAP](generated/foundation/failures/deadlines-before-20261012.tap)を保持する。

予算を公開境界で一度だけ生成し、admission、認証、SQL待機/retry、secret、ERP apply/status、復旧/補償とscheduleのnested operationへ伝播する。SQL取消は自身のbackendへ行い、commit開始前の確認済みrollbackと開始後の成功不明を区別する。HTTP切断もsignalへ接続する。耐久lease/SEND_STARTED後の取消では配送済みを推測せず、SENDINGとoperation identityを保持し、新しい要求で照合する。commit後journal・拒否Audit等の整合性記録は取消で捨てない。

拡張19件は実PostgreSQL lock待ち、ERP HTTP処理中の取消/期限切れ、HTTP切断、復旧ledger待ち、元keyでの再送と重複なしの照合を含み、すべて成功した。公開cancelled操作の横断検査も追加した。既存の試験・入力・失敗証拠は保持する。正式な結果はmanifestの各stage最後のrun（失敗を除外しない）と現在hashで判定し、独立再審査は別sessionへ残す。

最初の全体250件実行では249成功・1失敗（exit 1）。承認拒否をwithBudgetが根拠なしで二重記録し、既存店舗試験が最新AuditのactionId欠落を検出した。[全失敗TAP](generated/foundation/failures/deadlines-full-before-20261012.tap)を保持する。記録済みのPlatformErrorを内部WeakSetで識別し、外側では追加Auditを作らず元の拒否を返すよう修正した。承認の証拠検査は変更していない。


## F-FOUNDATION-012 — B-FOUNDATION-007: lock待機前の時刻で認証期限を許可

独立foundation reviewは、authenticateがSQL待機前に確定した時刻でsession・委任期限を比較する経路をblockingとした。修正前の実DB・HTTP反例4件はすべて期待した拒否が発生せず失敗、exit 1。[失敗TAP](generated/foundation/failures/authentication-expiry-before-20261012.tap)を保持する。

認証したsession・委任の最も早い有効期限をtransactionに登録し、現在時刻を登録時・後続SQLの前後・COMMIT開始直前に検査する。承認では元の委任期限も登録する。期限切れはPERMISSION_DENIEDとして業務更新をrollbackする。呼出し元のdeadlineやSHARE lockで認証期限を延ばさない。開始済みCOMMITの取消は主張しない。

拡張8件は初回認証・実行再認可の実SQL lock待ち、業務更新後、承認の元委任、最終SQL後の失効と、更新済み期限による同key再送を検査し、すべて成功した。状態・history・Outbox・Audit・journalのassertionを維持する。正式な全体結果は最新stage receiptと現在hashを参照し、独立再審査は別sessionで行う。


## F-FOUNDATION-013 — B-FOUNDATION-008: workerの元委任期限登録漏れ

第6回foundation reviewは、consumeとWriteback.checkedが保存済みActionの元委任期限を一度だけ検査し、transactionの期限監視へ登録しない問題をblockingとした。修正前の実DB・HTTP反例3件は、Inbox更新後、ERP反映後、ERP ledgerの実lock待機中に失効しても期待した拒否が発生せず全件失敗、exit 1。[失敗TAP](generated/foundation/failures/worker-authority-expiry-before-20261012.tap)を保持する。

両経路で取得・検査した元委任期限をrequireAuthorityUntilへ登録し、後続SQL前後とCOMMIT開始直前の既存検査へ接続した。worker自身の有効sessionで元委任の期限を延ばさない。拡張7件は期限切れの3操作、正常系と重複排除も含み成功した。Inbox/projection rollback、拒否Audit、元ActionのCOMMITTED journalを検査する。外部効果発生後はローカル完了のみrollbackし、耐久SENDING/UNKNOWNとoperation identityを保持する。更新済み期限による新しい照合でERP効果1件のまま解決し、再送しない。

既存試験と失敗証拠を維持する。正式な全体結果は最新stage receiptと現在hashで判定し、共有コードを使用するdemo・BCP・releaseも再生成する。修正後の独立再審査は別sessionで行う。


## F-DEMO-005 — B-DEMO-003: 元委任失効によるworker拒否の追跡欠落

第4回store独立reviewは、ERP反映後に元委任が失効したdispatch拒否Auditから対象Action・元主体・委任・根拠へ辿れない問題でREQUEST_CHANGESとした。状態保留と再送抑止は成立していたが、AC-005の各判断の追跡条件を満たしていなかった。

[修正前の保存trace](generated/demo/failures/worker-denial-context-before-20261012.json)をbyte一致で保全した。SHA-256は`ed3fac34bf4812d0bb8adb721ceecf09d33ff2c20e0949fad2583fd4dce6060c`。[修正前TAP](generated/demo/failures/worker-denial-context-before-20261012.tap)は18件中16成功・2失敗・skip 0・exit 1で、保存拒否AuditのAction参照欠落を直接検出した。

Outboxと保存Actionのtenant・店舗scopeを確認した後、元Action情報を評価contextへ保持し、rollback後の拒否Auditへ渡す。承認で使う保存Action証拠の共通関数を配送・照合でも使用し、評価主体/版と元主体/委任/根拠/版を区別する。未知ID・管轄外・別tenantではcontextを出力しない。

修正後の18件は成功した。異なる2件のActionについてdispatch/reconcile拒否を区別し、ERP反映後の期限失効でもAuditからActionへ追跡する。元の保留、発注拒否、再送抑止、照合・業務再開を保持する。正式な全stage結果は最新receiptと現在hashで判定し、独立再審査は別sessionへ残す。
