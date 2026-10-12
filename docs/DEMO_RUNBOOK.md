# 店舗APIデモ実行手順

このデモはローカルsynthetic専用である。既存の業務DB、実顧客、実ERP、外部公開先へ接続しない。NodeとPostgreSQLの固定版はmise.tomlを使う。新しいcloneでは最初に`npm ci`を完了させ、終了コード0を確認する。PostgreSQLプロセスはtest fixtureが隔離一時clusterとして起動し、Kernel DBとERP DBを別principal・HTTP境界で分ける。

## 再生成コマンド

作業directoryから`mise exec -- node --test tests/demo/*.test.mjs`でAPIの動作を確認できる。正式な証拠は`bash .takt/quality-gates/platform-gate.sh demo`で作る。このgateはimplementationの全suiteを再実行してからdemoの2 suiteを実行し、最新receiptと現在source/test/configのhashをvalidateする。非同期実行中の出力だけで成功と判断せず、終了コード0を確認する。`mise exec -- node scripts/platform-control.mjs validate demo`で再照合できる。入力変更後はgateを再実行する。

## 操作と観測

`tests/demo/store.test.mjs`が公開HTTP gatewayとcreateContractClientを起動し、各API操作の実応答をassertする。手動読解では、normal.jsonのresponsesを順に辿る。submitの入力はactionType、actionVersion、ontologyVersion、input、expectedRevision、idempotencyKey、evidence（Object ID、revision、公開projectionのdigest）である。credentialsはfixture内の一時sessionであり、証拠へtokenを出力しない。

DetectRecallImpactのtargetIdはrecall。QuarantineInventoryはtargetId=stock/stock2、caseId=recall。CreateReplacementOrderはtargetId=recall、candidateId=replacement、quantity=15。PublishCustomerNoticeはtargetId=recallとsynthetic messageを渡す。担当operatorがsubmit、委任agentが隔離、managerがapprove/dispatch/reconcileを操作する。statusはactionId、dispatch/reconcileはoperationIdを使う。正常系は影響15個、2店舗、発注金額15000、承認待ち、外部発注成功、顧客対応7件を確認する。Object historyのsourcePositionとAction ID、Auditの版・actor・subjectを対応づける。

## 失敗注入と再評価

`seedStore`は同一profileを各caseの独立DBへ投入する。`scripts/demo/failure-injection.mjs`のinjectExternalはnormal/reject/lost-ack/rollbackを選択できる。rejectは外部未実行の明示拒否、lost-ackはERP transaction commit後に応答を失わせる。候補変更はrevisionとavailableを変更し、承認時の再検査を観測する。委任active=false、店舗scope削除、Policy available=false、期限超過clockも試験内に明記する。

承認待ちではObject phaseがDETECTED、Outboxが0件である。候補変更・委任失効・定義公開後は承認が拒否される。定義変更caseはmanager draft、別reviewer review、publisher publishを経て、新版で再提案する。明示失敗ではEXTERNAL_FAILEDを確認し、顧客通知を進めない。UNKNOWNは再送せず照合し、ERP ledgerの同operationIdが1件であることを確認する。競合caseは同revisionの2要求、一方CONFLICT、同key再送の同Action IDを観測する。

## 成果物の確認

`evidence/generated/demo/store-recall-procurement.json`と`retrieval-store-corpus.json`がsuiteのTAP・件数・終了コードを保持する。normal/denials/conflict/stale-approval/external-failure/definition-change.jsonはAPI応答、Action、Outbox、ERP ledger、Audit、telemetryを保持する。retrieval-corpus.jsonはseed期待値、検索probe、source lineageと拒否の監査を保持する。失敗TAPはfailures配下に保存し、成功で上書きしない。

`evidence/run-manifest.json`のrunsからstage=demoの最後の要素を選ぶ。失敗runを除外して古い成功を採用しない。suite宣言digest、inputsのsha256、outputsのsha256が現在ファイルと一致することが受入の前提である。AC-005の機械PASSは次の独立review-store-demoの承認を置き換えない。

## このstageの限界

UI録画、実通知、実注文、AIモデルは使用していない。API実演で有限な業務契約を検査する。移動中在庫はinTransit属性として隔離対象に含める。地域間transferの配送管理、複数候補の最適化、実顧客配信はこのsliceの実装成果として表示しない。WAN/基幹停止、DB再起動・復元、補償、RPO/RTO、未解決項目の計測はBCP suite、Adapter交換とclean bootstrapはrelease suiteで別に検証する。共有基盤更新後はこれらの現在receiptも再生成し、各独立reviewと最終監査へ渡す。店舗suiteの成功でそれらの承認を代替しない。


## 独立review指摘の再現と修正確認

B-DEMO-001/002の修正前は、追加した3反例が実HTTP/DBで失敗した。`evidence/generated/demo/failures/review-regressions-before-20261012.tap`は既存7件成功・追加3件失敗・skip 0のTAPを保持する。公開版の番号だけでなくprograms.workflow.approvalAtQuantity=10とprograms.rule.minimumQuantity=11の実行内容を変更し、draft/review/publish後にAPI判定をassertする。公開Workflowを要求requireApprovalなしで適用し、低額発注にも承認を強制する。

追加traceはpublished-workflow、published-rule、approval-denial-context、quarantine-race、procurement-unknown.json。承認拒否Auditのactorは評価を依頼したmanager、originalActor/Subject/DelegationIdは元発注のagent/operator/delegation、inputDigestは保存Actionのdigestである。actionId/operationId、targetId、evidenceとoriginalVersionsを保存Auditから取得する。未知ID・店舗scope外のActionへの承認拒否は根拠やAction contextを出力しない。2件の承認待ちActionを用いて拒否を曖昧な時刻結合で推定せず区別する。

QuarantineInventoryの競合は、影響caseと複数在庫を共有根拠として使うため、敗者はINVALID_EVIDENCEで拒否される。SetIsolationのCONFLICTとは別caseである。代替発注のUNKNOWNは顧客通知を保留し、再dispatchでも送信回数を増やさず、reconcile後に通知を進める。過去の並行artifact上書きログは元.logを保持し、同じbyteのparallel-artifact-validation.tapを配布可能な失敗証拠とする。gateとnpm testは順番に実行し、成果物を同時に生成しない。

## 最終監査B-FINAL-001の再検証

修正前のnormal.jsonは `evidence/generated/demo/failures/final-audit-normal-before-20261012.json` へbyte一致で保全した（SHA-256 eb596e9857fda00611ff82f7e06535186bab5181ea4b3c9c69e5ecae473a6e13）。`restricted-export-before-20261012.tap` は追加した実HTTP/ERP反例を含む15件中2成功・13失敗・skip 0・exit 1を保持する。secretがERPへ入ることを検出した失敗であり、過去成功で打ち消さない。

B-FINAL-001修正時のstore suiteは16件で、既存12件、通常・委任・承認付き隔離の3件、全店舗Actionの外部列・型契約1件を含む。`restricted-export-ordinary.json`、`restricted-export-delegated.json`、`restricted-export-approved.json` でOutboxの内部fieldsとERP ledgerの外部fieldsを区別する。ERPはisolatedだけを受け取り、内部secretは外部境界を越えない。各caseでlost-ack、再dispatch抑止、同operationIdとdigestによるreconcile、重複効果なしを確認する。

共通writebackを変更したため、最終証拠の再生成には `bash .takt/quality-gates/platform-gate.sh release` を逐次実行する。この入口は全体回帰、foundation、demo、BCP、releaseを順番に実行し、現在hashを照合する。別のnpm testやgateを同時に起動しない。店舗reviewには最新demo receiptを渡す。前回最終監査はREQUEST_CHANGESであり、この修正sessionの機械PASSは独立承認を意味しない。

## foundation第7回review後の店舗再実行

第7回foundation review後の追加時点ではstore suiteは17件。追加の`quarantine-authority-expiry.json`は、元委任が実ERP反映後に失効した隔離Actionと、それに依存する発注・顧客対応を一つのtraceにする。testのafter-external hookは実ERP transactionのcommit後に有効期限を越えるまで待機するだけで、ERP応答や認可をmockに置換しない。

配送拒否は保存AuditのworkerOperation、actionId、operationIdを起点とし、requestId/traceIdでtelemetryへ結合する。responsesにも同じ保存済み相関IDを記録する。発注EXTERNAL_PENDINGは要求digest、reconcile成功はoperationIdで対応を確認する。拒否直後はPENDING_EXTERNAL/SENDING、成功不明のため発注を拒否する。fixtureの委任期限更新後に照合し、追加送信0件・隔離効果1件をassertする。発注の承認と顧客対応まで進め、正常flowと同じ5件のERP ledgerへ収束する。期限更新はローカルsynthetic injectionで、実credentialや既存環境を変更しない。

この追加試験と文書・suite宣言を含む入力を確定した後、release gateを単独実行し、最後に`bash .takt/quality-gates/platform-gate.sh final`で全stageの現在hashを読み取り照合する。最終監査の独立承認は別sessionに残す。


## B-DEMO-003: worker拒否Auditの追跡

現在のstore suiteは18件。`worker-denial-context.json`は異なる2件の隔離Actionのdispatch/reconcile拒否を検査する。`quarantine-authority-expiry.json`も、ERP反映後の期限失効によりtransactionがrollbackされた後の保存Auditを直接検査する。export時にAction情報を推定・補完しない。

Denied Auditのoperationはworker、workerOperationはdispatchまたはreconcileである。評価を要求したactor=managerと、保存ActionのoriginalActor=agent、originalSubject=operator、originalDelegationId=delegationを区別する。actionId、operationId、actionType、targetId、inputDigest、evidence、originalVersionsを保存Actionへ照合し、評価時のOntology/Rule/Workflow/Policy版と併記する。同じrequestId/traceIdのtelemetryで操作と拒否codeを確認する。時刻だけによる結合は行わない。

contextはOutboxと保存Actionのtenant・店舗scopeを確認した後だけ設定する。未知operationId、店舗管轄外、Outboxと異なるtenantの保存ActionはNOT_FOUNDとし、Action・根拠contextを出力しない。委任復旧後のreconcileは追加送信なしで効果1件へ収束する。

修正前の`worker-denial-context-before-20261012.tap`は18件中16成功・2失敗・skip 0・exit 1を保持する。旧失効traceは`failures/worker-denial-context-before-20261012.json`へbyte一致で保全した（SHA-256 ed3fac34bf4812d0bb8adb721ceecf09d33ff2c20e0949fad2583fd4dce6060c）。共通Kernel/Writeback変更後はrelease gateで全stageを逐次再生成し、final gateで現在hashを照合する。独立review-store-demoの再承認は別sessionで行う。
