# Acceptance Matrix

`PASS` は現在入力のmachine receiptと意味的証拠が揃う場合のみ使用する。`READY_FOR_REVIEW` は必要な機械検査済み・独立審査前、`NOT_RUN` は未実施、`FAIL` は受入未達、`BLOCKED` は人または外部条件待ち。suite成功とmilestone/AC完成は別の判断である。AC-002〜AC-004のPASSは実装の機械検証結果に限り、独立review-foundationの承認を意味しない。製品完成には全ACと別sessionの最終監査が必要である。

| ID | Status | Evidence | Residual risk |
|---|---|---|---|
| AC-001 | PASS | [release receipt](run-manifest.json) / [clean起動](generated/release/clean-bootstrap.json) / [実測](generated/release/clean-bootstrap-trace.json) / [入口と前提](../docs/RELEASE.md) | 空HOME/npm cache/source-onlyで単一入口を実行。空mise data/cacheからruntime download/compileも完走。macOSと明示OSS build toolsが前提 |
| AC-002 | PASS | [現在入力receipt](run-manifest.json)（下記selector） / [Kernel](generated/foundation/kernel-contracts.json) / [定義](generated/foundation/definition-lifecycle.json) / [実装・47責務索引](../docs/IMPLEMENTATION.md) / [pipeline](generated/foundation/pipeline-foundation.json) / [data](generated/foundation/data-services-foundation.json) | 版付きOntology、有限query/link、期待版付き型付きAction、状態/Outbox/Audit、生成clientと実DB/HTTPを検査済み。source checkpoint・耐久pipeline・blob・版付きidentity mapping・有限analyticsを追加。独立review-foundation第4回のAPPROVEは当時のfoundation範囲。第7回foundation reviewはB-FOUNDATION-008修正を承認。APIによる有限Authoringであり、店舗demoはAC-005の現在receiptで別途検証 |
| AC-003 | PASS | 同receipt / [許可・拒否matrix](generated/foundation/authorization-matrix.json) / [認可suite](generated/foundation/authorization-delegation.json) / [認証期限](generated/foundation/authentication-expiry-foundation.json) / [worker元委任期限](generated/foundation/worker-authority-expiry-foundation.json) / [secret・観測](generated/foundation/operations-foundation.json) / [trace](generated/foundation/data-services-trace.json) / [境界](generated/foundation/boundary-foundation.json) | 信頼境界でactor/onBehalfOf確定、単体/一覧/検索/列/Action/toolの許可・拒否、委任変更/失効/Policy障害のfail closedを実DB検査。secret参照単位認可とAudit失敗時の配送抑止、scope付き観測/telemetryを検査済み。モデル未採用。B-FOUNDATION-007のsession・委任期限をまたぐSQL待機とcommit前失効を8件で検査し、第7回foundation reviewはworker元委任期限も含め承認。最終監査B-FINAL-001の店舗ERP制限列送信を修正し、下記restricted-export証拠で機械再検証。第7回foundation reviewの承認範囲はAC-002〜AC-004。後続stageと最終独立監査は別途実施 |
| AC-004 | PASS | 同receipt / [結合trace](generated/foundation/writeback-trace.json) / [ERP](generated/foundation/writeback-foundation.json) / [worker元委任期限](generated/foundation/worker-authority-expiry-foundation.json) / [process/volume](generated/foundation/process-volume-foundation.json) / [保持](generated/foundation/retention-foundation.json) / [pipeline](generated/foundation/pipeline-trace.json) / [trigger](generated/foundation/trigger-foundation.json) / [観測保存失敗](generated/foundation/data-services-foundation.json) | 同時更新/同key再送/入力不一致/timeout/部分失敗/逆順を実DB・ERP HTTPで検査。Kernelとpipelineの実SIGKILL、schedule再送、観測保存失敗後の同key回復も重複なし。保持境界はapplication clockであり実時間経過/DB TTL検証ではない。DB process crash/restore・補償・RPO/RTOはAC-006参照。B-FINAL-002の期限・取消を修正しdeadlines-foundationで検査。第7回foundation reviewの承認範囲はAC-002〜AC-004。後続stageと最終独立監査は別途実施 |
| AC-005 | PASS | [最新demo receipt](run-manifest.json) / [store suite](generated/demo/store-recall-procurement.json) / [検索corpus](generated/demo/retrieval-store-corpus.json) / [正常trace](generated/demo/normal.json) / [runbook](../docs/DEMO_RUNBOOK.md) | 現在receiptに対応する機械検証のPASS。第4回store reviewはB-DEMO-003でREQUEST_CHANGES。拒否Auditの保存Action参照を修正し、第5回store reviewはB-DEMO-003解消を確認してAPPROVE。元委任のERP反映後失効・発注保留・権限更新後照合を追加。通常・委任・承認付き隔離の制限列除外とUNKNOWN照合を追加。syntheticの2店舗・有限購入/通知flow、API実演。AI・実顧客配信は未使用 |
| AC-006 | PASS | [最新BCP receipt](run-manifest.json) / [BCP suite](generated/bcp/bcp-exercise.json) / [実測・trace](generated/bcp/exercise.json) / [runbook](../ops/BCP.md) | 現在receiptに対応する機械検証PASS。独立review-bcp第2回でB-BCP-001/002/003解消を承認後、共通writeback変更と店舗復旧の制限列除外検査を追加。期限・取消・認証期限・worker拒否Auditの共通修正後、復元した店舗Actionの拒否追跡と手動保留のmutation損失測定を追加。第4回review-bcpは現在変更の拒否Audit・telemetry結合を確認してAPPROVE（BCP範囲）。ローカルsynthetic論理pg_dump restore。clean復旧は損失0・重複0・未解決0を要求。checkpoint後commit喪失は1件の損失と手動保留を意図的に報告。物理WAL replay・host同時喪失は未検証 |
| AC-007 | PASS | [release receipt](run-manifest.json) / [交換suite](generated/release/adapter-replacement.json) / [shadow差分・切替・切戻し](generated/release/adapter-trace.json) / [StatePort](../src/adapters/indexed-postgres.mjs) | 永続derived index。正本scanを比較に使い性能改善は主張しない。演習controllerは公開管理APIではない |
| AC-008 | PASS | [release receipt](run-manifest.json) / [SBOM](generated/release/sbom.cdx.json) / [notice](generated/release/THIRD_PARTY_NOTICES.md) / [全依存audit](generated/release/audit-all.json) / [runtime audit](generated/release/audit-runtime.json) / [secret](generated/release/secret-scan.json) / [vendor](generated/release/runtime-security.json) / [backup/upgrade](generated/release/operations-trace.json) / [保持](generated/foundation/retention-foundation.json) / [観測](generated/foundation/operations-foundation.json) / [release](../docs/RELEASE.md) | npm closureとvendor runtime SBOM。既定PG buildは外部OpenSSL/ICUなし。binary内部libraryとOS全体の完全SBOM・未知脆弱性不存在・長期実時間・major DB upgradeは未検証 |
| AC-009 | READY_FOR_REVIEW | [全machine gate索引](#final-audit-machine-gate-index) / [現在入力manifest](run-manifest.json) / [hash監査snapshot](generated/release/current-input-audit.json) / verification/plan.json | 最新final-auditはB-FINAL-001修正を確認し、B-FINAL-002でREQUEST_CHANGES。第7回foundation reviewはB-FOUNDATION-008修正後のAC-002〜AC-004をAPPROVE。共有基盤更新後の第5回store review・第4回BCP reviewはAPPROVE。releaseの現在入力再検証後、別session final-auditの承認は未取得 |

## Foundationの現在証拠範囲（2026-10-12）

現在receiptの索引は `run-manifest.json` の `runs` 配列で `stage === "implementation"` を満たす最後の要素である。成功runのみを選別しない。最新runの全宣言suite成功と、各suite定義・現在入力・宣言出力hashの一致を `validate implementation` で検査する。後続gateが成果物を再生成した場合も同じselectorで新receiptを参照する。最新runの失敗、入力変更、出力不一致は過去のPASSで補えない。

独立reviewはB-FOUNDATION-001〜004をblockingとしてREQUEST_CHANGESを返した。修正前の実DB/HTTP反例7件はすべて失敗し、[失敗TAP](generated/foundation/failures/review-regressions-before-20261012.tap)を保持している。修正と拡張反例12件は[review-regressions-foundation](generated/foundation/review-regressions-foundation.json)でAC-002〜AC-004へ結び付ける。journal key衝突とprocess再起動、元の委任/列scopeによる承認根拠再検査・commitまでのlock、未公開版rollback拒否、query/search/toolの検索許可を検査する。詳細は [F-FOUNDATION-008](FAILURES.md) と [実装文書](../docs/IMPLEMENTATION.md) を参照。第2回独立reviewでこれら4件の修正経路を確認したが、新たにB-FOUNDATION-005でREQUEST_CHANGESとなった。

B-FOUNDATION-005のreview/edit/publication競合は実DB・生成HTTP clientの4件で修正前の失敗を再現し、[失敗TAP](generated/foundation/failures/authoring-concurrency-before-20261012.tap)を保持した。単調増加するcases_revisionと条件付き更新、公開時のcase digest・revision・定義digest照合を追加した。[authoring-concurrency-foundation](generated/foundation/authoring-concurrency-foundation.json)の7件は並行編集、編集後の内容復元、公開中の実lock待ち、拒否Audit、transaction rollback、正当な再審査・公開と公開済み版へのrollbackを検査する。詳細は [F-FOUNDATION-009](FAILURES.md) を参照。第3回独立reviewはB-005の修正経路を確認したが、Object revision検査と並行ActionのB-FOUNDATION-006でREQUEST_CHANGESとなった。

B-FOUNDATION-006のObject revision検査と並行Actionの競合は、修正前の実DB・HTTP反例2件で再現し、[失敗TAP](generated/foundation/failures/publication-objects-before-20261012.tap)を保持した。公開同士を認証前のtransaction mutexで直列化し、Policy UPDATE lockをObject検査より前に取得する。検査対象のObjectをID順にFOR UPDATEで読み、公開・Audit・commitまで保持する。[publication-objects-foundation](generated/foundation/publication-objects-foundation.json)の5件は、Action先行時のSTALE_REVIEW、公開先行時のAction再検査、別SQL書込の抑止、公開失敗時のrollbackと待機Actionの再開、並行公開の直列化と新しい審査による復旧を検査する。詳細は [F-FOUNDATION-010](FAILURES.md) を参照。修正後の第4回独立再審査はAPPROVE（foundation範囲）であり、REQUEST_CHANGES履歴を保持する。

N-FOUNDATION-001の旧run固定参照は廃止し、上記の決定的selectorで最新stage receiptを索引する。過去receipt・失敗履歴は保持する。再生成可能なJSON報告とtraceだけを宣言出力にし、現在のsource/test/config/固定版設定/実装文書/launcher/controllerを宣言入力に含める。全体200件、20 implementation suiteが成功した。現在receiptは75入力・28出力artifactを保持し、suite内152試験実行には重複を含むため全体200件へ加算しない。各suite定義・現在入力・出力hashの再計算も一致した。B-FOUNDATION-006修正後の第4回独立再審査はAPPROVE。

pipelineは有限synthetic snapshot/change profile、blobはPostgreSQL内のsynthetic証拠、analyticsは固定集計、telemetryはscope付き耐久traceである。KernelとERPは別DB・principal・HTTP境界を持つが、隔離PostgreSQL serverを共有する。保持境界はapplication clockであり、実時間経過やDB TTLの検証ではない。これらをproduction CDC、監視SLO、実DB復元の証拠に転用しない。店舗demoの機械検証は下記を参照。BCP、Adapter交換、release検査、最終独立監査は未実施。現在、人の判断を必要とする阻害はない。


## Store demoの現在証拠範囲

stage === "demo" の最後のrunを索引し、成功だけを選別しない。現在入力・出力hashの一致と2 suite成功をvalidate demoで要求する。Ontology 1.1.0 / Rule 1.1.0を使う2店舗の回収・隔離・承認・代替購入・顧客対応をHTTP APIで検査する。normal、denials、conflict、stale-approval、definition-change、external-failure、unknown-success、および検索corpusのartifactを参照する。承認待ちのOutbox不在、元主体・委任・候補・版の再検査、明示拒否と成功不明、同operationId照合を区別する。各Actionは版、actor/subject、request根拠、operationId、Audit hash chainへ対応する。

第4回foundation reviewはB-FOUNDATION-001〜006への修正を確認し、APPROVEとなった。REQUEST_CHANGESの履歴と失敗証拠は保持する。N-FOUNDATION-002のjournal件数assertionをrecords().lengthへ修正し、demo gateのimplementation再実行で確認する。上記の200件/75入力/28出力は以前のrunの計測であり、現在runの件数はmanifestとsuite artifactを正本とする。Store demo第1回独立reviewはREQUEST_CHANGES。修正後再審査、BCP、Adapter交換、release、最終監査は未実施。


B-DEMO-001/002への修正は[公開Workflow](generated/demo/published-workflow.json)、[公開Rule](generated/demo/published-rule.json)、[承認拒否context](generated/demo/approval-denial-context.json)で検査する。公開programsの意味的変更を独立draft/review/publishし、店舗validate/submit/approveへ共通決定関数を適用する。承認拒否は認可済みActionからactionId/operationId・元主体/委任・根拠・元版と評価版をAuditへ残す。未知ID・管轄外はcontextを出さない。修正前3件の失敗は[保存TAP](generated/demo/failures/review-regressions-before-20261012.tap)を参照。[店舗隔離の共有根拠競合](generated/demo/quarantine-race.json)と[代替発注UNKNOWN](generated/demo/procurement-unknown.json)も追加し、既存SetIsolation例外試験を保持する。機械PASSは独立再審査の承認を意味しない。


## BCPの現在証拠範囲

stage === "bcp"の最後のrunを選び、失敗やhash不一致を過去成功で補わない。bcp-exerciseの入力は既存foundation/demo範囲にscripts/bcp、tests/bcp、ops/BCP.mdを追加し、既存suiteを保持する。clean-recovery、lost-local-commit、manual-and-fences、store-degraded、restored-send-unknown、lost-approved-commit、missing-journal-restartと全件exportの8試験を検査する。実測値・損失ID・重複・未解決・担当・照合点はexercise.jsonを参照。復旧入力にcontrollerの観測IDを渡さず、別volume journalから全epochの操作を発見する。手動保留対象の更新を止め、元Audit/historyを捏造せずRecoveryObservedを残す。補償は別Action/operation、現在の認可・期待版と独立承認を通す。

共通writebackのB-FINAL-001修正後、store-degradedに承認済み隔離の配送前snapshot復元・新processでのAPPLIED照合を追加した。内部Object/Outboxにsecretを保持し、ERP fieldsはisolatedのみ、payload digest一致と追加送信0件を要求する。exportEvidenceとconfirmed、traceで確認できる。全BCP ledgerを残存Outboxまたは独立COMMITTED journalへ結合し、制限列非送信・外部payload・digestを検査する。現在の変更は後続review-bcpで独立に審査する。

店舗demo第2回の独立審査はAPPROVE（B-DEMO-001/002解消）。上記の旧REQUEST_CHANGESと未実施記述は当時の履歴。BCPのPASSは現在入力の機械検証を示し、review-bcp、release、別session最終監査を代替しない。製品全体の完成は未判定。

BCP独立review B-BCP-001/002/003はREQUEST_CHANGES。修正の動的反例はtests/bcp/exercise.test.mjs、失敗TAPはevidence/generated/bcp/failures/review-regressions-before-20261012.tap。最新bcp receiptのrestored-send-unknown / lost-approved-commit / missing-journal-restartとmutation損失測定へ追跡する。機械PASSは独立した修正再審査待ちであり、AC-006の最終承認ではない。

## Final audit machine gate index

各stageのruns配列最後の要素を選び、失敗runを除外しない。suiteのplanDigest、全inputsのSHA256とinputsDigest、全outputsのSHA256とoutputsDigest、commandsとexitCodeを検査する。現在入力へ追跡できないPASSは無効とする。

| AC | Stage / machine suites | 現在コード・意味的証拠 |
|---|---|---|
| `AC-001` | release / clean-bootstrap | scripts/release/bootstrap.sh、scripts/foundation/serve.mjs、tests/release/bootstrap.test.mjs、clean-bootstrap-trace.json |
| `AC-002` | implementation / kernel-contracts、definition-lifecycle、authoring/publication regressions、ingestion/pipeline/data/trigger/boundary | src/kernel.mjs、src/contracts.mjs、src/adapters/postgres.mjs、config、生成client、foundation traces |
| `AC-003` | implementation / worker-authority-expiry-foundation、authentication-expiry-foundation、authorization-delegation、secrets、operations、review-regressions及びdemo / store-recall-procurement | src/security.mjs、src/secrets.mjs、src/gateway.mjs、src/writeback.mjs、authorization-matrix、secret trace、restricted-export-ordinary/delegated/approved |
| `AC-004` | implementation / deadlines-foundation、writeback、recovery-journal、process-volume、retention、kernel | src/writeback.mjs、src/adapters/journal.mjs、writeback/retention/process traces |
| `AC-005` | demo / store-recall-procurement、retrieval-store-corpus | src/store-actions.mjs、config/store-ontology.json、scripts/demo、tests/demo、demo traces |
| `AC-006` | bcp / bcp-exercise | src/continuity.mjs、src/writeback.mjs、scripts/bcp、tests/bcp、ops/BCP.md、exercise.json（store-degradedの復元後external payload照合を含む） |
| `AC-007` | release / adapter-replacement | src/adapters/indexed-postgres.mjs、migration002、adapter-trace.json |
| `AC-008` | release / release-supply-chain、release-operations及びimplementation保持・観測 | licenses、SBOM/notices/audit/secret、operations-trace、retention-foundation、operations-foundation |
| `AC-009` | mechanism / supervision-mechanism・full-release-regression、architecture / metadata、plan / roadmap、release / final-current-input-audit、final gate --all | PRODUCT_GOAL、SOURCE_BASELINE、composition、ROADMAP、verification/plan、run-manifest、別session reviewer |

release実行後の最新receiptを正本とする。BCP独立review第2回はAPPROVE、B-BCP-001/002/003解消を確認した。上記REQUEST_CHANGES記述は歴史的記録であり、失敗TAPを保持する。製品の最終独立承認はここでは付与しない。


## B-FINAL-001 — 店舗ERP制限列送信の差戻しと修正

最終独立監査はAC-003/005をFAILとしてbuild-store-demoへ差し戻した。旧成功receiptは欠陥を検出しておらず、完成根拠に使わない。[監査対象の正常trace保存](generated/demo/failures/final-audit-normal-before-20261012.json)と[修正前反例TAP](generated/demo/failures/restricted-export-before-20261012.tap)を保持する。通常・委任・承認付きQuarantineInventoryのERP ledgerを再帰検査し、修正前は15件中13件失敗した。

[src/writeback.mjs](../src/writeback.mjs)は外部contract 1.0.0のAction別scalar許可項目へ投影する。内部Object/Outboxのsecretを保持しながら、外部のfieldsは許可項目だけとなる。[通常](generated/demo/restricted-export-ordinary.json)、[委任](generated/demo/restricted-export-delegated.json)、[承認付き](generated/demo/restricted-export-approved.json)は実HTTPのlost-ack→UNKNOWN→再送抑止→同operationId/payload digest照合→DELIVEREDとERP効果1件を検査する。全店舗traceのledgerにも再帰検査を適用する。型違反・未知Action・未知contract版の拒否もstore suiteで検査する。

現在の合否は最新stage receiptと現在入力/output hash一致に限る。共通writeback変更のためfoundation/demo/BCP/releaseを再生成する。B-FINAL-001の独立再審査とAC-009の承認は、この実装sessionでは付与しない。

## Release再検証と監査への引継ぎ（2026-10-12）

共通writeback変更後の第3回独立review-bcpはAPPROVE（BCP範囲、blocking 0件）。配送前snapshot復元後の店舗隔離を新processから照合し、内部制限列の保持、ERPのisolatedのみの投影、同payload digest、追加送信0件を確認した。上記の再審査待ち記述は当時の履歴として保持する。B-FINAL-001の最終独立再審査と製品完成判定は引き続き別session final-auditの責務である。

本release工程ではdocs/RELEASE.mdの旧payload互換性・復元時保留方針を更新し、release gateでarchitectureからreleaseまで全7stageを順次再生成する。成功判定は最新runのcommand終了コード、現在入力・出力hash、全source/test/script coverageの一致に限る。release gate後にfinal gateのreadonly --all照合を実行し、AC-009はREADY_FOR_REVIEWのまま引き渡す。保存済み失敗証拠・失敗receiptは保持する。


## B-FINAL-002 — 期限・取消の差戻しと現在証拠

最新のfinal-auditはB-FINAL-001の制限列送信修正を確認したが、共通基盤のdeadline/cancel欠落でREQUEST_CHANGESとした。これは以前のfoundation承認を修正後の承認へ自動継承するものではない。AC-004と同じ経路を利用するAC-006の独立最終承認は保留する。

[deadlines-foundation](generated/foundation/deadlines-foundation.json)の19件をAC-002〜AC-004およびAC-006の共通基盤証拠へ接続する。[修正前11件の失敗TAP](generated/foundation/failures/deadlines-before-20261012.tap)と[F-FOUNDATION-011](FAILURES.md)を保持する。admission待ち、SQL lock待ち、秘密参照、ERP HTTP送信中、HTTP切断、復旧ledger読取へ同じabsolute deadline/cancel signalを伝播する。送信開始後の不明状態を保持し、新しい要求による照合で解決する。確認済みSQL rollback後の同key再送で重複しないことも実DBで検査する。

B-FINAL-002修正時の機械PASSは21 implementation suiteと、共有src変更後に順次再実行するdemo/BCP/releaseの最新receipt、現在入力/output hash一致を前提とする。過去の件数・未実施・審査待ちの記述は当時の履歴であり、現在値はmanifestと各artifactを参照する。修正後のfoundation再審査・後続独立review・最終監査は別sessionで行い、AC-009はREADY_FOR_REVIEWを維持する。


## B-FOUNDATION-007 — 認証期限をまたぐSQL待機

第5回foundation reviewはB-FINAL-002の修正と19件の成功証拠を確認したが、authenticateがlock待機前の時刻でsession・委任の期限を判定する問題でREQUEST_CHANGESとした。[修正前4件の失敗TAP](generated/foundation/failures/authentication-expiry-before-20261012.tap)と[F-FOUNDATION-012](FAILURES.md)を保持する。

[authentication-expiry-foundation](generated/foundation/authentication-expiry-foundation.json)の8件は、入口認証・業務再認可・Object lock待機・元委任の承認・最終SQL後からCOMMIT前までの期限切れを実PostgreSQLとHTTPで検査する。認証済みsessionと委任の最も早い期限をtransactionへ登録し、SQL前後とCOMMIT開始直前の現在時刻で再検査する。期限切れはPERMISSION_DENIEDで拒否し、Object・Action・history・Outboxの更新をrollbackする。拒否Auditとjournal ABORTEDを保持し、更新された権限による同key再送は重複しない。

現在の機械PASSは22 implementation suiteと、共通基盤変更後のdemo・BCP・releaseの最新receipt、現在入力・出力hashの一致を前提とする。過去のAPPROVEは修正後へ自動継承しない。修正後のfoundation・後続独立review・最終監査は未実施で、AC-009はREADY_FOR_REVIEWを維持する。


## B-FOUNDATION-008 — workerが扱う元委任の期限

第6回foundation reviewはB-FOUNDATION-007の修正と8件の証拠を確認したが、consume・Writeback.checkedで保存済みActionの元委任期限をtransactionへ登録しない経路をblockingとした。[修正前3件の失敗TAP](generated/foundation/failures/worker-authority-expiry-before-20261012.tap)と[F-FOUNDATION-013](FAILURES.md)を保持する。

[worker-authority-expiry-foundation](generated/foundation/worker-authority-expiry-foundation.json)の7件をAC-003/004の証拠へ追加した。元委任期限をtransactionへ登録し、Inbox更新後・ERP反映後・実ledger lock待機中の失効を拒否する。consumeのInbox/projectionをrollbackし、既にCOMMITTEDの元ActionにABORTEDを付けない。ERP反映済みの場合は耐久SENDING/UNKNOWNとoperation identityを保持し、期限更新後の照合で効果1件のまま解決する。開始時点の失効3操作と有効な委任の正常・重複排除も検査する。

現在の機械PASSは23 implementation suiteと共有コード変更後のdemo・BCP・releaseの最新receipt、現在入力・出力hashの一致を前提とする。過去の件数は当時の履歴である。修正後のfoundation・後続独立review・最終監査は未実施で、AC-009はREADY_FOR_REVIEWを維持する。


## foundation第7回承認後の店舗引継ぎ（2026-10-12）

上流の独立review-foundation第7回はAPPROVE（AC-002〜AC-004限定、blocking/non-blockingとも0件）。審査対象implementation receiptは`20261012142007607-implementation-c7bfed`、23 suites・85入力・31出力、入力digestは`5213222406b1a7d3f191d44d113332adb05bb53955c69e2609fbf4158671be98`。この記録は審査時点への索引であり、現在の機械証拠は各stage最後のrunを使う。上記のfoundation再審査待ちは当時の履歴として保持する。

[店舗の元委任失効trace](generated/demo/quarantine-authority-expiry.json)は、実ERPで隔離済みでもローカル完了前に元委任が失効するとSENDINGを保持して発注を拒否することを検査する。期限更新後は同operationId/digestで照合し、再送せず承認付き代替発注・顧客対応まで完走する。既存16件の店舗試験と検索corpusを保持し、store suiteへ1件・再生成可能なtraceへ1件追加した。suiteの既存入力範囲と検査commandは維持する。

共有基盤と更新されたdemo入力に対する全stageの機械検証はrelease gateで逐次再生成し、final gateで現在hashを照合する。次の独立review-store-demo、後続の独立review、AC-009最終監査はこの実装sessionでは承認しない。以前の失敗receipt/TAPと正本AC・不変条件は保持する。


## B-DEMO-003 — worker拒否Auditと保存Actionの結合

第4回store独立reviewのREQUEST_CHANGESを受け、[worker拒否context](generated/demo/worker-denial-context.json)と[ERP反映後の元委任失効](generated/demo/quarantine-authority-expiry.json)でAC-005の追跡条件を検査する。拒否Audit自体に認可済みActionのID、operationId、元主体・委任・根拠・版を保持し、評価時の主体・版と区別する。requestId/traceIdでtelemetryへ結合する。2件のActionのdispatch/reconcileを区別し、未知ID・管轄外・別tenantのcontext非開示を検査する。18件の店舗試験は従来の業務・障害assertionを保持する。

[修正前trace](generated/demo/failures/worker-denial-context-before-20261012.json)と[2件失敗のTAP](generated/demo/failures/worker-denial-context-before-20261012.tap)、[F-DEMO-005](FAILURES.md)を保存する。現在の機械PASSは共通Kernel/Writeback変更後の全stage最新receiptと現在hash一致を前提とする。過去foundation承認は変更後へ自動継承しない。今回の店舗修正、後続stage、最終監査の独立承認は未取得である。


## BCP再演習と店舗第5回reviewからの引継ぎ（2026-10-13）

上流の第5回review-store-demoはAC-005についてAPPROVE、B-DEMO-003解消・blockingなしと判定した。上記の店舗再審査待ちは当時の履歴であり、BCPと最終監査の承認へ拡張しない。共通Kernel/Writebackの期限・認可・拒否Audit修正後のBCPを、既存7障害シナリオとexportの8試験で再演習する。suiteの既存入力・command・反例・失敗証拠を保持する。

store-degradedはsnapshot復元後、新processのRECOVERING中にdispatch/reconcileを拒否し、追加のERP apply/statusなし・PENDING_EXTERNAL維持を検査する。exercise.jsonのdenialEvidenceから保存AuditのAction/operation/根拠/元主体/版とtelemetryのrequestId/traceIdへ追跡できる。照合後のDUPLICATE・送信payload投影・損失0・重複0・未解決0の検査も保持する。manual-and-fencesの損失はimmutable mutation集合から計測し、未確定INTENTの保留とは別に報告する。現在機械結果は最新bcp receiptとexercise.json、独立判定は次のreview-bcpを参照する。AC-009はREADY_FOR_REVIEWを維持する。

## Release第3回から最終監査への引継ぎ（2026-10-13）

第4回独立review-bcpはAPPROVE、blocking 0件。審査対象は `20261012153619880-bcp-250df7`、8試験成功、入力96ファイル、digest `94a0446e9cd838cc75ff9ac652a6f62899a0df58e8ab122422b6a833cb1d4a30`。元記録はTAKTの `context/previous_responses/review-bcp.4.20261012T154511Z.md`。この審査時点の記録を新しいreceiptの代替にしない。以前の再審査待ち記述と失敗証拠は履歴として維持する。

AC-001/007/008はreleaseの最新runを使い、clean bootstrap、永続index交換、供給網、破壊復元・upgrade/rollbackの実行結果へ結ぶ。全Node discoveryはmechanism/full-release-regression、その後の全source/test/scriptの現在hashと各stage出力はrelease/final-current-input-audit及びfinal gateのreadonly `--all` で再計算する。suite・入力範囲・失敗反例を維持し、古い成功runの選別を認めない。上記のAC別machine gate索引を最終監査の入口とし、AC-009はREADY_FOR_REVIEWを維持する。
