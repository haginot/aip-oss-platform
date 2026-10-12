# Verification plan

`plan.json` は製品検証の実行入口です。suiteは一意なID、stage、具体的な目的、argv形式のcommands、明示的なinputs/outputs、timeoutを持ちます。現在登録済みの `supervision-mechanism` と `architecture-contract-metadata` は開発監督機構および設計metadataだけを検査します。これらの成功は製品ACのPASSではありません。

## 後続stageで追加するsuite

実装担当は、実動するコードと試験が揃ったstageごとに次を追加します。unit/contract testの結果をdemo、BCP、releaseの実動証拠として使い回さず、それぞれ独立した実行commandを持たせます。

- `implementation`: Ontology/Object/Action、認可・委任、State/Outbox/Auditの実Adapter契約と反例。並行更新、key再利用、timeout、部分commit、逆順、fail-closedを含める。
- `demo`: synthetic seedを使うAPI/UIのend-to-end。回収正常系、権限拒否、競合、承認待ち、外部反映失敗を実行し、Action/Audit traceを出す。
- `bcp`: WAN/ERP断、success-unknown、再起動、DB checkpoint restore、journal列挙、復旧照合、重複排除、補償をfailure injection付きで実行する。測定値と未解決一覧を出す。
- `release`: clean bootstrap、Adapter shadow/cutover/cutback、SBOM/license/vulnerability/secret検査、backup/restore、upgrade/rollbackを含める。AC-007とAC-008双方へ証拠を結ぶ。

各suiteは `PRODUCT_GOAL.md` の対象AC、`work/ROADMAP.json` のmilestone、`architecture/composition.json` の責務、公開Port/信頼境界/障害意味論へ追跡可能な範囲で入力を宣言します。最低限、commandが読むsource、tests、設定、schema/migration、container定義、synthetic seed、verification script、参照する契約/規則、依存lockを列挙します。directory入力は内容hashへ展開されます。project root、空directory、symlink、globでは代替しません。

`outputs` はsuiteが実行して再生成する、意味を判定できるartifactだけを列挙します。例: contract結果JSON、demo trace、failure injection計測JSON、RPO/RTO・損失/重複/未解決レポート、Adapter差分、SBOM、license/security report、restore report。入力sourceや一時logを出力扱いにせず、存在しない空directoryも指定しません。出力を持たない検査だけは `[]` を使えます。

## Receiptと実行

```sh
node scripts/platform-control.mjs run-stage implementation
node scripts/platform-control.mjs validate implementation
```

同様に `demo`、`bcp`、`release` を実行し、各stageの最新receiptをvalidateします。起動時のrunning、成功、失敗receiptを `evidence/run-manifest.json` へ追記します。失敗・中断後に古い成功を再利用しません。suite定義または入力の変更、必須outputの欠落、実行中の入力変化、timeout、spawn errorは失敗です。receiptのargvとexit statusも宣言commandと一致させます。入力変更後は必ず再実行します。

`evidence/ACCEPTANCE_MATRIX.md` は各ACから最新receiptと意味証拠への索引です。期待値を結果として記録せず、PASSは現在入力に対応した成功receiptと実動証拠がある場合に限ります。UI画像・録画は補助で、Object/Action/Audit状態や障害計測を代替しません。

receiptはhashによる鮮度検査であり署名や意味的正しさの保証ではありません。入力の十分性、検査commandの有効性、mock/skipの妥当性、出力artifactの意味は独立reviewで確認します。BCPの目標値は `ops/BCP.md` に記録された設計targetであり、演習前の実測値として扱いません。

## 実行工程と追加suiteの具体的契約

`work/ROADMAP.json` のroot `approved` は計画承認、各milestoneの `planned` は未実装を表します。`workflowStep` / `verificationStage` / `plannedSuites` が以下の到達経路です。下表のdemo/BCP/release suiteは追加予定です。foundationは10の実DB suiteと補助のfoundation-local-contracts、計11 suiteを登録済みです。成功記録の鮮度は現在入力との照合で確認し、roadmapの全義務と独立foundation承認は別途判定します。source/test/configが存在し実行可能になった工程で登録し、同工程の独立reviewに実動receiptを渡します。空command・成功stub・未実装suiteを先に登録してPASSを作りません。

| 工程 / milestone | 追加予定suite（stage） | 実装・反例・操作で判定する意味 | 再生成するoutputs例 |
| --- | --- | --- | --- |
| build-foundation / M-01 | foundation-bootstrap (implementation) | pinned Node/PostgreSQL、別ERP principal、空DB/migration/seed、起動途中失敗・cleanup・health不成立 | evidence/generated/foundation/bootstrap.json |
| build-foundation / M-02 | kernel-contracts (implementation) | Ontology/Object/Action、State/Outbox/Inbox/Audit、取り込み・有限query・採用責務の契約。並行CAS、各writeでのabort、Audit失敗、再送/逆順/poison、非採用capability拒否 | evidence/generated/foundation/contracts.json |
| build-foundation / M-02 | definition-lifecycle (implementation) | Authoring draft/diff/simulation/review/publish/use/rollbackの実操作、生成typed client。未審査公開・非互換schema拒否、旧新client、定義変更で承認stale/再評価 | evidence/generated/foundation/definitions.json、client-compatibility.json |
| build-foundation / M-02 | recovery-journal-foundation (implementation) | 別volume INTENT fsync→DB commit→COMMITTED fsync→ack/配送。停止点・gap/deny・directory fsync/部分append、元ID、独立ERP ledger、期限なしdedup/30日境界/多年再送 | evidence/generated/foundation/journal-crash-matrix.json、retention.json |
| build-foundation / M-02 | retrieval-comparison-foundation (implementation) | D-08 SQL scan baselineと比較harness。型・認可・削除・revision/watermark probe、有限lexical意味と差分判定 | evidence/generated/foundation/retrieval-baseline.json |
| build-foundation / M-03 | authorization-delegation (implementation) | trusted session、actor/onBehalfOf、get/list/search/column/Action/toolの一致、policy epoch commit競合、失効・越境・委任拡張・障害fail-closed、偽主体/根拠/型/攻撃payload | evidence/generated/foundation/authorization-matrix.json |
| build-store-demo / M-04 | store-recall-procurement (demo) | 同一実動基盤の回収・代替transfer/purchase・通知、正常/拒否/競合/承認待ち/外部失敗、timeout後成功不明とstale承認。店舗担当者の操作から版・主体・証拠まで追跡 | evidence/generated/demo/store-trace.json、case-results.json |
| build-store-demo / M-04 | retrieval-store-corpus (demo) | baseline検索に店舗corpusを追加しupdate/delete/revoke/遅延caseの期待結果を検査。M-05用に同じ入力を保持 | evidence/generated/demo/retrieval-corpus-results.json |
| build-bcp / M-06 | store-continuity-recovery (bcp) | WAN/ERP断・成功不明・restart・DB-only restore、checkpoint前の未解決を含むepoch列挙とDB union、fence・分類・再送dedup・認可付き補償。RECOVERY_CONTRACTの全8scenario、oracle ID流入禁止 | evidence/generated/bcp/injections.json、reconciliation.json、metrics.json、unresolved.json |
| harden-release / M-05 | retrieval-adapter-exchange (release) | SQL scan→独立永続projectionのbackfill/catch-up/shadow/fence/cutover/cutback。差0の意味/認可、tombstone/revocation、checkpoint gap/逆順/再起動、不一致時拒否、lag fallback/UNAVAILABLE | evidence/generated/release/adapter-diff.json、migration-checkpoints.json、cutover-cutback.json |
| harden-release / M-07 | oss-operations-supply-chain (release) | 実使用OSS version/license、SBOM/vulnerability/secret、backup/WAL restore、保持、鍵参照、upgrade失敗/互換rollback・観測 | evidence/generated/release/sbom.json、licenses.json、security.json、operations.json |
| harden-release / M-08 | clean-bootstrap-integration (release) | fresh環境の一入口bootstrap→店舗→BCP→Adapter交換、全suite鮮度・出力存在/再生成、stale/欠落/最新FAIL拒否。AC-001〜008を現行hashで判定 | evidence/generated/release/clean-bootstrap.json、acceptance-links.json |
| harden-release / M-08 → final-audit / M-09が読む | final-current-input-audit (release) | AC索引→現行code/test→各stage最新receipt→semantic outputを機械照合。stale/未実行/未解決FAIL拒否。別sessionの独立審査へ対象hashを提供 | evidence/generated/release/current-input-audit.json |

`responsibilityCoverage` は固定compositionの47責務を、非採用のUNSUPPORTED_CAPABILITY反例も含めて担当milestoneへ割り当てます。各roleの `verificationObligation` の具体的ケースをtest IDと生成結果へ対応付け、M-08で漏れを照合します。基盤のrecovery契約はM-02、横断復旧演習はM-06、release再検証はM-08です。Adapter比較基盤はM-02、店舗データはM-04、永続投影・移行・交換完了はM-05です。

### Architecture recovery-range regression obligation

M-02では、既存 `architecture-contract-metadata` suiteの `scripts/architecture-check.mjs` と `tests/architecture-check.test.mjs` を拡張し、`architecture/RECOVERY_CONTRACT.json` の `journal.recoveryRange` を検査対象に含めます。反例fixtureでこの範囲を削除する場合と、checkpoint以前の未解決journal操作を列挙対象から外すよう縮小する場合の両方について、architecture gateが失敗しなければなりません。suite inputsには対象contract、checker、testとfixtureを実在pathで明示し、出力がなければ `outputs: []` を維持します。これは設計契約の退行検出で、実動のDB復元・照合・重複排除・補償を代替しません。後者の実動反例はM-06 `store-continuity-recovery` が検査します。suite変更後は既存のarchitecture receiptを現在入力で再実行します。

## Inputsの登録方法

上表のpathは将来の出力配置例です。実装工程が実在するpathへ確定し、README・roadmapの対応も更新します。共通入力は `PRODUCT_GOAL.md`、`work/ROADMAP.json`、`architecture`、`verification/plan.json`、`package.json` / `package-lock.json` と、commandが実際に読むすべての実装・test・実行入口です。元設計directoryはruntime依存にせず、固定baselineで検査します。

例えばkernel suiteが `src`、`tests/contracts`、`config`、`schema`、`migrations`、`scripts/verify-kernel.mjs` を読む実装になった場合、これらを**すべて**入力へ列挙します。型付きclientが別directoryならそのsource、公開schema、generator、生成client、compile configと旧client fixtureも含めます。実動依存はcontainer/process定義、image digest/version profile、ERP source/migrations/config、synthetic seed、policy/rule/manifestも含めます。まだ存在しないpathを宣言して実行しません。

suiteごとの追加入力を次のように決めます。

- journal/BCP: `architecture/RECOVERY_CONTRACT.json`、`docs/DECISIONS.md`、`ops/BCP.md`、journal/fsync/epoch/reconcile実装、ERP ledger、backup/restore/fault injector/controller、保持境界fixture、測定checker。oracleは検査専用で復旧入力から分離し、journal/checkpointとERPが発見した集合を検査する。
- Authoring/client: schema/Rule/Policy/Workflow定義、review/publish/rollback実装、Authoring操作面、client generator/生成物、互換性・simulation・承認待ちfixture。
- 認可/demo: trusted session/delegation/policy/tool guard、Object/検索/Action/UI、店舗seedと期待値、独立ERP HTTP/ledger、操作driver。AIを追加する場合は正本の条件付き要件をすべて有効にし、model/prompt/retrieval/policy/evidence版と評価corpusも入力へ追加する。
- Adapter交換: 両Adapter、永続投影schema/migration/worker、snapshot/tombstone/checkpoint/reindex、比較harness、M-04共有corpus、切替configと認可checker。baseline結果を参照入力に使う場合、その生成suiteも現行入力で再実行する。
- release/final: composition/OSS baseline、lock/container digests、license/SBOM/security checkerと閾値、restore/upgrade/rollback script、全stageの検証宣言とAC索引。final監査が読む `evidence/run-manifest.json` はrelease suite自身のreceiptをrunnerが同fileへ書くためinputsに直接含めない。先に読み取り用snapshotを別pathへ生成し、それを入力に固定してcurrent code/output hashと比較する。snapshotは次回監査前に更新し、失敗後の旧PASSを使わない。

## Outputsと合否の判定

生成JSONには少なくともcase/test ID、対象AC/milestone/role/Port、期待値と実測値、判定、Object/Action/event/operation相関ID、対象版/digestを持たせます。Authoringではdraft/release/approver/client互換結果、AdapterではID/type/revision/evidence/mask/deny/order/watermarkの差分、BCPでは停止点・単調時計の時刻・復旧分類・損失/重複/未解決IDを記録します。raw event/journal/ERP照合結果はsyntheticのみ、secretは出力しません。計測checkerが `ops/BCP.md` のRPO/RTO/分類target超過や意味不一致をnonzero exitで拒否します。未解決一覧の欠落を成功としません。

`outputs` は上記checkerが検査した再生成artifactの実pathを列挙します。stdoutだけをsemantic結果の代替にせず、receiptが各outputのhashを保持します。生成先は入力directoryと分離し、実行中の入力変化を起こしません。期待値を出力へコピーするcommandを検証扱いしません。

現在は既存2suiteを変更せず `roadmap-contract-metadata` (stage `plan`) を追加しました。`node scripts/platform-control.mjs run-stage plan` がACのID網羅、milestone状態、依存先・循環等の構造を検査しreceiptを作ります。構造検査はjournal順序やAuthoringの意味的十分性を保証しないため、review-roadmapで上表と固定設計を独立照合します。

監査checkerの実装・suite登録・snapshot/artifact生成は編集可能なM-08のharden-releaseで行い、`run-stage release` に機械監査receiptを含め、AC-009をREADY_FOR_REVIEWにします。M-09のfinal-auditはreadonlyのため、既存artifactとreceiptを読み、`validate final` と別session final-auditorの独立審査を実行します。AC-009の最終承認はTAKTが保存する独立verdictとAC別根拠へ結び、reviewer自身にsource/証拠/Matrixの書換えを要求しません。修正・証拠再生成が必要ならharden-release等へ戻します。機械監査を独立reviewそのものとは扱いません。


## 2026-10-12 foundation実行の現在地

implementationには10の実DB suiteと補助の `foundation-local-contracts`、計11 suiteを登録済みです。追加された `writeback-foundation` / `process-volume-foundation` / `retention-foundation` はM-02、`secrets-foundation` はM-03の検証経路です。生成pathと補助traceはplan.jsonのoutputsを正本とします。補助suiteの成功は単体契約の範囲であり、実DB suiteの代替にしません。

記録receipt `20261012053306852-implementation-a0461e` は全11 suiteのcommand成功を記録しています。ただし今回の照合では全11 suiteのinputDigestが現在値と不一致で、現在の実装合格根拠には使えません。suite定義・command成功記録・出力hashは一致しています。build-foundationで対象suiteを再実行し、証拠索引も現在状態へ更新します。以前の失敗receiptは保持します。Acceptance MatrixはAC-002〜AC-004をFAIL、他のACをNOT_RUNとしており、この記録だけでM-01〜M-03を完了扱いしません。

実装文書とMatrixには独立ERP HTTP/別DB ledger、lease・成功不明照合、TypeScript compiler・旧新client、別APFS volumeでのKernel SIGKILL、有限Policy/Rule/Workflow公開と認可付き履歴、保持境界・synthetic secret注入/rotationの試験が記録されています。ERPは同じ隔離PostgreSQL serverの別DBであり、独立server障害領域ではありません。保持試験はapplication clockの30日±1秒・18年境界で、実時間経過やDB TTL/purgeを証明しません。別volumeは明示harnessの試験構成で、通常serveの別directoryとは区別します。

残るfoundation義務はsource ingest/checkpoint/quality/quarantine/lineage、完全な責務coverage、definition差分・simulation case編集、secret単位のservice主体認可/Audit、完全なredacted運用観測です。build-foundationで実装・反例・操作・意味的証拠を完成させ、現在入力のreceiptと独立reviewを得ます。recoveryRangeの削除・縮小を拒否する設計反例やKernel停止は、M-06のPostgreSQL-process停止・DB restore・union照合・補償・RPO/RTO計測を代替しません。

stage runnerはfail-fastを維持します。失敗stage内で未実行のsuiteや個別診断JSONを成功receipt扱いせず、失敗後の旧PASSを再利用しません。後続の店舗demo・BCP・Adapter交換にはそれぞれ独立したsuiteと現行入力のreceiptが必要です。

## Release実装の機械監査経路

harden-releaseはclean-bootstrap、adapter-replacement、release-operations、release-supply-chain、final-current-input-auditを登録した。plannedSuitesの義務はROADMAPのexecutionSuitesと対応し、上流の実動suiteを保持する。release gateはarchitecture/plan/mechanism/implementation/demo/bcpを再生成してからreleaseを実行する。current-input-audit.jsonは監査時の上流最新receiptと個別の現在入力/output hashを固定した出力snapshotであり、同時更新するmanifestをsuite入力へ含めない。release完了後およびreadonly final gateで `node scripts/release/current-input-audit.mjs --all` を実行し、releaseも含めて検査する。このcommandはartifactを書き換えない。反例はtests/release/current-input-audit.test.mjsでstale入力/output、最新FAIL、未実行suite、必須artifact欠落を拒否する。独立最終承認は次の別sessionの責務である。

mechanismには全Node testを逐次実行するfull-release-regressionを追加した。後続stageがsemantic traceを再生成する前に全体試験を完了させ、全体TAPのJSONを独立outputとしてreceiptへ固定する。全体試験の成功と後続stageのfreshnessを両方検査する。
