# BCP実行runbook・演習台帳

## 実装profileと責任

PRODUCT_GOAL.md AC-006、docs/DECISIONS.md D-06/D-11、architecture/RECOVERY_CONTRACT.jsonを正本として、ローカルsynthetic PostgreSQL 18.6 / Node 22.23.3のBCPを実装する。共通Kernel、公開HTTP RPCと生成client、同一transactionのObject/Action/Outbox/Auditを使用する。Kernel DBとRecoveryJournalPortのfsync journalはtask-ownedの別APFS volume、synthetic ERPは別database・別principal・HTTP境界である。ERPとKernelは同じ隔離PostgreSQL serverを共有する。この演習は本番店舗SLA、別hostの耐災害性、WAN上の実店舗接続の検証ではない。

Platform operationsがcontinuitySet/recoverを操作し、現在のtenant/store recovery権限で認証する。店舗operatorは隔離を申請、店舗managerは自分の申請とは別の承認を行う。Security teamがPolicy/失効の判断主体、業務approverとPlatform operationsが手動保留と補償の判断主体である。人の業務判断を自動で置き換えない。

## 自動演習の入口

初回依存導入は`mise exec -- npm ci`。全BCP gateはrepository rootから`bash .takt/quality-gates/platform-gate.sh bcp`を実行する。implementation 23 suite、demo 2 suite、bcp-exercise suiteを直列で再実行し、現在入力・suite定義・出力hashとAC索引を検査する。BCPだけの診断は`mise exec -- npm run bcp:test`。診断後もsourceを変えた場合、全gateを再実行する。同じartifactを出すnpm testとgateを並行実行しない。

演習は隔離clusterをinitdbし、synthetic schemaとERPを生成する。tests/bcp/exercise.test.mjsがTCP切断、ERP commit後のack消失、ERP rollback、Kernel子processの実SIGKILL、Kernel schemaのみのDROPとpg_dump復元を制御する。既存環境・実データ・実credentialには接続しない。演習controllerが障害前ID集合を測定用に保管するが、復旧APIには渡さない。演習後はcluster、子process、mountをcleanupする。machine結果はevidence/generated/bcp/exercise.json、TAP・exit・版はbcp-exercise.jsonへ出力する。

## 縮退可能なActionと禁止Action

continuityはtenant/storeごとのNORMAL / DEGRADED / RECOVERINGと単調revisionでDBに保存する。continuitySetは期待revision付きのrecovery control ActionでありContinuityMode Auditを同じtransactionへ記録する。利用者が直接NORMALを指定することは禁止し、recoverの全件分類によってのみNORMALへ戻す。

| 状態 | 許可 | 禁止・保留 |
|---|---|---|
| NORMAL | 通常の公開認可・版・規則・期待版付きAction | 手動保留targetへの更新、未確定INTENTがある新Action/配送 |
| DEGRADED | 有効な既存sessionの認可付きread、SetIsolation(true)、QuarantineInventory。target数量と入力数量は100以下。通常のRule/Workflow・根拠・承認が継続 | SetIsolation(false)、DetectRecallImpact、CreateReplacementOrder、PublishCustomerNotice、配送、source ingestionの新規反映はCONTINUITY_RESTRICTED。上限不適合も拒否 |
| RECOVERING | scope付きread、journal snapshot/list、recoverによる分類 | 対象storeの新Action、承認、配送。mode変更後もjournal破損・欠損・不確定INTENTのfenceを解除しない |

縮退中に承認が必要な隔離はPENDING_APPROVALでObject/Outboxを更新しない。別主体の正当な承認後にローカルObject・Outboxを確定し、配送は接続復旧・照合まで停止する。actor/onBehalfOf、scope、Policy、Ontology/Rule/Workflow、根拠revisionは通常経路で再検査する。policy.available=falseはreadもUNAVAILABLE。権限拒否はPERMISSION_DENIEDであり、切断を理由にsuperuserや承認省略を導入しない。縮退は店舗内Kernelとdurable DBが稼働している場合に限る。

## RPO/RTO定義と測定

| 目標 | 上限 | 実測の起点・終点 |
|---|---|---|
| WAN/worker crashでcheckpointに含まれるacknowledged mutationのlocal RPO | 損失0件 | 障害前後のAction IDに加え、Object ID・revision・Action ID・fields digestで識別したimmutable historyのcommit集合を比較する（同じAction IDに対する承認commitも別mutationとして数える） |
| backup restoreのRPO window | 最大60秒 | pg_dump取得開始から障害注入まで（保守的上限）の単調時計差。restore前後の実損失IDを別途報告 |
| 縮退local RTO | 最大120秒 | TCP切断/mode切替から認可付き隔離・read probe完了まで |
| restartと継続ActionのRTO | 最大120秒 | ack消失に伴うSIGKILL開始からrestore・新process・照合・新Action・補償配送完了まで |
| 接続復旧後pending分類RTO | 最大300秒 | 接続復旧通知から新process起動と全journal operationの分類が完了するまで |

期待値を実測欄へ転記しない。performance.nowの同一controller時計で測り、UTC時刻をtimelineへ記録する。exercise.jsonのmetricsは失われたAction IDとmutation（Object/revision/Action/fields）、checkpoint経過時間、RTO、ERP ledger/effectsから算出した重複効果、未解決件数を保持する。分類時間と全業務の解決時間は区別する。手動保留の終了時間は未測定。未解決recordは元Action/operation/key/digest/target、理由、観測時刻、commitからの経過時間（証明できない場合null）、担当、次の照合点を保持する。

## backupと復旧順序

この実装演習のbackup profileは**pg_dumpによるKernel schema全体の論理snapshot**である。Object/action/key/Outbox/Audit/history/policy/live定義/source cursor/continuity/recovery observationsをまとめて保存し、raw SQLのSHA-256を記録する。進行submissionを止め、COMMITTED marker耐久化後、controllerの逐次操作でcheckpointを取得する。pg_dumpは整合snapshotを取得する。復元はtask-owned schemaへpsql -X -v ON_ERROR_STOP=1で行い、ERPとjournalは復元対象に含めない。設計のbase backup＋WAL replayはこのprofileでは未実装・未検証であり、物理WALのRPOを合格に見せない。releaseのbackup profile拡張は別証拠が必要である。

1. storeをRECOVERINGへ遷移し受付・配送を止める。復元演習中はGateway子processも停止する。継続DB transactionがない時点でsnapshotを採取する。復元直後は外部配送に先立ちRECOVERINGを設定する。
2. published定義、Policy、Action/Outbox参照、Audit chainと独立journalを検査する。journalはINTENTをDB transaction前、COMMITTEDをcommit後かつack前にfsyncする。別volumeのhead witnessを先にfsyncし、sequenceとhashを照合するので、行途中と完全な末尾行の切落しもfenceする。journal/headの欠損、hash/epoch/連続性不一致はUNAVAILABLE/INCONSISTENT_STATE。既存journalを自動再作成しない。runtime constructorはbootstrap=falseが既定であり、journal本体とheadが両方失われた場合、新しい空のpathを指した場合も起動を拒否する。bootstrap=trueは新規隔離schemaを作成するfixtureと新規journalの単体演習だけで明示し、稼働中/restartの子processに渡さない。両volume/host同時喪失は保証外でfail closed。
3. recover({store,checkpoint})は同epochの**全journal**を固定highWatermarkまで100件以下の頁で列挙する。復元DBのPENDING_EXTERNAL/MANUAL_REVIEWを和集合として検査し、journalに対応しないDB操作は停止する。controllerのIDリスト、checkpoint後だけの省略、復元DBだけの探索を使わない。
4. 元operation ID/Action ID/key/digestに結合したpayloadをERP statusへ送り、APPLIEDを確認する。復元ローカルcommitとOutboxが存在すればDELIVERED/SUCCEEDEDへ確定する。成功不明は新IDで再実行しない。配送leaseに続けて独立journalへSEND_STARTEDをfsyncし、DB transaction確定後にHTTPへ送信する。このappendもsubmissionと同じadmission lockで直列化する。DB restore後のoutbox.attempt=0だけでは未送信の証明にならない。journal-send-v1のCOMMITTED、復元commitとの一致、attempt=0、全journalにSEND_STARTEDなしという条件をすべて満たす場合だけunappliedとして同じIDで配送可能に戻す。旧protocolや送信開始ありのUNKNOWNは手動保留し、再dispatchを拒否する。送信開始記録後にlease commitが失敗しても安全側の保留となる。ledger不存在だけから未適用を推論しない。
5. 最新COMMITTEDのexternalEvent・commitRevisionsと復元Action結果・Object revision・同Actionに結合したimmutable history・Outbox payloadを照合する。Action IDが残っていても承認commitを失っていればlost-approved-commit、DBにないCOMMITTEDはlost-local-commitとして損失を明示する。いずれもERP APPLIEDだけで復旧済みにしない。元key/digest/Action/operationのMANUAL_REVIEW bindingを保存するが、失ったObject/history/元Auditを捏造しない。APPLIEDでも再送しない。UNKNOWN、unconfirmed-intentも保留する。RecoveryObserved Auditへcheckpoint・snapshot・journal hash・分類を追記する。保留targetは新規Actionとsource更新を拒否する。全分類後は無関係targetだけ通常運転を再開できるが、未確定INTENTはglobal fenceを維持する。
6. 元keyの同入力は元Actionを返し、異入力はIDEMPOTENCY_MISMATCH。同じ操作のdispatch再送は新効果を作らない。原主体/委任・Policy・expiryを配送時に再検査する。scopeを跨ぐjournal列挙は拒否する。
7. 補償はSUCCEEDEDのSetIsolation(true)を参照する新SetIsolation(false)で、現在の根拠・期待revision・認可・独立承認を必要とする。元Action/operationへのCompensationProposed Auditと参照を、新Action保存と同じtransactionに記録する。承認前は隔離を解除しない。有限逆操作で扱えないActionはMANUAL_REVIEW_REQUIREDとし、店舗approver/Platform operationsの判断に残す。

手動保留を解除する一般repair APIは初版に存在しない。業務担当はERP ledgerとローカルsnapshotを対照してrepair案をレビューし、追加の認可・Audit付き実装と再演習なしに直接SQLで解除しない。保留を残した演習はclean recoveryとして数えない。

## 現在証拠の索引

evidence/run-manifest.jsonのrunsでstage === "bcp"の最後の要素を選ぶ。成功だけを選別せず、validate bcpがsuite定義・現在入力・全出力hashを再計算する。clean-recoveryはWAN断、ローカル隔離、未送信Outbox分類、ERP applied/ack消失、実SIGKILL、schema破壊/復元、新process、同ID照合、継続Action、承認付き補償を自動完走し、損失0・重複0・未解決0を要求する。

lost-local-commitはcheckpoint後の適用済みActionをDBだけから失わせ、controller oracleなしに発見し、損失1・再送0・未解決1を正しく報告する。manual-and-fencesはERP rollback/不存在、INTENT実SIGKILL、journal部分/完全末尾切落し・停止・restart欠損、cross-scopeを注入して保留/fenceを要求する。store-degradedはQuarantineInventoryの承認、100上限、発注禁止と復旧配送を検査する。追加反例restored-send-unknownは配送前snapshotへ巻き戻してattempt=0とし、ERP statusをTCP切断したまま新processで復旧して保留1・再送0を要求し、再接続後のAPPLIED照合で解消する。lost-approved-commitはPENDING_APPROVAL snapshotへ戻して同Action IDが残る承認mutation損失1を検出し、Object/history/ApprovedCommitを再作成せず保留1とする。missing-journal-restartはNORMAL相当のDBに履歴がある状態で両witness欠損と新pathの起動拒否を実processで検査する。journalを正当に復旧するまで受付を再開しない。保持の30日前後/年単位、順序逆転・GAP・conflict・Policy失効は同gateの既存foundation suiteに保持する。

store-degradedはさらに、承認済みQuarantineInventoryの配送前snapshotへDBを復元し、新Gateway processからERPのAPPLIEDを照合する。内部Object/Outboxの制限列を保持し、外部fieldsは`{isolated:true}`のみ、同operationの再dispatchはDUPLICATE、追加送信・mutation損失・重複効果・未解決は0件を要求する。exercise.jsonのexportEvidenceは対象Action/operation、外部fieldsとpayload digestを保存する。全演習のERP ledgerについて、残存Outboxまたは独立COMMITTED journalのeventから得た外部payloadとの一致、payload digest、制限列の非送信を検査する。ローカルcommit喪失例もこの検査から除外しない。

store-degradedの復元後は、RECOVERING中のdispatch/reconcileを拒否し、ERP apply/status要求が増えずPENDING_EXTERNALを保持することも検査する。保存された拒否Auditを元Action・operation・入力digest・根拠・元主体・版へ結合し、requestId/traceIdから新processのtelemetryへ追跡する。exercise.jsonのdenialEvidenceがその索引であり、traceに実Auditとtelemetryを保存する。manual-and-fencesも障害注入前後のimmutable mutation集合を比較し、損失・再送・重複効果・未解決件数を実測する。未確定INTENTの保留をacknowledged mutationの損失へ混同しない。

AC-006の機械検証と独立review-bcpは別判定である。最新数値はexercise.jsonを参照し、独立審査前に製品全体完成やAC-009の承認を宣言しない。

Action key、consumer inbox、ERP ledger、RecoveryJournalPortは無期限・TTLなし・key再利用禁止。30日Audit保持境界と独立し、未解決Action/補償とdedupはcleanupしない。不存在・期限・保持範囲不明は未適用の証明にならない。
