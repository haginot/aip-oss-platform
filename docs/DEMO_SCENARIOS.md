# 店舗業務・BCPデモ仕様

## 1. デモの目的

単純なCRUD画面ではなく、Ontology、Object、Link、Action、Rule、承認、外部反映、イベント、認可、証拠が同じ業務意味で接続されていることを示す。全シナリオは固定seedで再現でき、APIまたはUIの操作、状態遷移、監査記録、失敗理由を一つのcorrelation IDで追跡できるようにする。

## 2. 実装済みの店舗モデルと境界

`config/store-ontology.json` のOntology 1.1.0、Rule 1.1.0、Workflow 1.1.0、Policy 1.0.0を使う。共通KernelのInventoryPosition、Lot、StoreへRecallCaseとReplacementCandidateを追加し、stock/replacement Linkで依存を解決する。回収通知、承認、発注、顧客通知はRecallCaseの有限状態とActionレコードで表す。承認者は共通principalのmanager、担当者はoperator、委任実行はagentのactorとoperatorのsubjectで記録する。独立定義reviewer/publisherは共通公開手続きを使う。

seedは`store-seed:1`。対象ロットdemo-lotにs1のstock（10個）、s2のstock2（5個、inTransit=true）を結ぶ。販売済みはsynthetic集計7件である。管轄外foreignはs3へ置く。代替候補replacementは同じロットのreplacement Linkに接続し、available=true、recalled=false、容量50、単価1000とする。候補のsupplierはsynthetic識別子であり、実取引先や顧客個人情報は使わない。回収期限は実行開始から1時間、期限超過はKernel clock注入で検査する。

## 3. Scenario A: 商品回収から代替調達（実装済みAPI）

### 正常系の観測契約

1. DetectRecallImpactがOPENからDETECTEDへ進め、認可済みLink先のrevision/digest付き根拠から影響店舗s1/s2、在庫15個を確定する。
2. 委任主体が各在庫へQuarantineInventoryを実行する。期待revision、根拠、期限、回収phaseを共通Action Engineが検査し、隔離状態・Outbox・Auditをtransactionで確定する。
3. managerがdispatchし、独立ERP HTTP ledgerのDELIVEREDを確認する。隔離がローカルで済んでも最新在庫revisionの外部反映が未完了なら発注を拒否する。
4. CreateReplacementOrderが候補Link、在庫隔離、容量、数量、単価を検査する。15個×1000の15000は10000以上のため、要求者がrequireApprovalを省略してもPENDING_APPROVALになる。この時点ではObject更新もOutbox生成もない。
5. operatorの承認と未承認dispatchを拒否する。manager承認時に元の主体・委任・版・根拠・制約を再検査する。承認後にREPLACEMENT_ORDEREDへ進め、元operationIdでERPへ送る。
6. ERPの発注DELIVERED確認後、PublishCustomerNoticeがCUSTOMER_NOTIFIEDへ進める。通知messageと集計7件を外部effectへ反映する。実メール配信や実発注は行わない。
7. API get/history/statusと証拠JSONから、影響判定・隔離・承認・発注・通知のAction ID、operationId、actor/subject、Ontology/Rule版、evidence digest、Outbox、ERP ledger、hash-chain Auditを辿る。正常経路は5外部効果、回収caseのhistoryは3更新である。

### 例外と期待結果

- readerのsubmitはPERMISSION_DENIED、s3単体取得はNOT_FOUND、根拠欠落はINVALID_EVIDENCE。拒否Auditにも入力digest、主体、Action種別と版を残す。承認対象を認可した後の拒否はactionId、operationId、targetId、元actor/subject/delegation、元入力digest、根拠参照、元版と評価時の版を記録する。存在しないIDと管轄外のActionにはこのcontextを付けない。
- 隔離前の発注はQUARANTINE_REQUIRED、候補available=falseはRULE_REJECTED、期限超過はRECALL_EXPIRED。Objectへの業務更新はしない。
- 同じrevisionの二つのSetIsolationを並行送信し、一つだけPENDING_EXTERNAL、もう一つはCONFLICTとなる。同key同入力は同Action、同key異入力はIDEMPOTENCY_MISMATCH、ERP効果は1件。
- 承認待ちの候補変更、元の委任失効を注入し、承認拒否とPENDING_APPROVAL維持を確認する。Ontology 1.2.0を独立review/publishした場合はSTALE_APPROVALとし、新版での再評価を通す。二重承認は拒否する。
- ERP rejectはREJECTEDとEXTERNAL_FAILEDを返す。顧客通知はEXTERNAL_PENDINGとして拒否し、外部成功を誤表示しない。
- ERP lost-ackは外部commit済みでUNKNOWNとなる。同operationIdを再dispatchしても送信せず、照合でDELIVEREDへ収束させる。成功不明と明示拒否を混同しない。代替発注そのもののlost-ackでも、顧客通知を照合完了まで拒否し、ERP ledgerは同operationIdの1件に保つ。

### 公開Rule/Workflowと店舗制約の合成

validate、submit、approveは同じdecideStoreActionを使う。店舗固有の前提・期限・容量・金額承認を検査し、公開Rule/Workflowも評価する。承認要否は店舗金額承認、要求requireApproval、公開approvalAtQuantityの論理和である。公開minimumQuantityの数量は、影響特定と顧客通知ではaffectedQuantity、隔離では対象在庫quantity、発注では要求quantityと定義する。店舗Actionは隔離を解除しないため、公開allowRelease評価の入力はisolated=trueである。SetIsolationは従来どおり利用者のisolated値を評価する。

published-workflow.jsonは独立draft/review/publishでOntology/Workflow 1.2.0、approvalAtQuantity=10を公開する。10個在庫の隔離と単価100×10個の低額発注はPENDING_APPROVALになり、未承認のObject/Outbox更新がないことを検査する。published-rule.jsonではRule 1.2.0、minimumQuantity=11を公開し、10個在庫のvalidate/submitをRULE_REJECTEDで拒否する。承認時にも公開プログラムを再評価する。公開後の旧承認はSTALE_APPROVALとなり、拒否Auditは評価版1.2.0と元版1.1.0を区別する。

承認拒否の反例では同じ対象に2件の承認待ち発注を作り、候補変更と委任失効で別々に拒否する。保存AuditそのものからActionと元根拠を区別する。quarantine-race.jsonは実際のQuarantineInventoryを同時送信し、一方のみ確定する。共通根拠のrevision/digest再検査により他方はINVALID_EVIDENCEになる。汎用SetIsolationのCONFLICT試験も保持し、二つの戻り値を混同しない。

### 検索・根拠corpus

`retrieval-store-corpus`は同seedをHTTP検索し、ID順・型・Ontology版・revision・列maskとdigestを検査する。source checkpointのgapはSOURCE_GAP、遅延中は未適用の在庫を返さない。適用後のhistoryはinventory:1を持つ。source更新後の旧revision根拠はINVALID_EVIDENCE、tombstoneは検索・単体取得から消える。店舗scope失効後は0件、Policy障害はUNAVAILABLEとなる。SQL正本のwatermarkはauthoritativeである。比較用の期待値とprobeをJSONへ保存し、後続Adapter交換で再利用する。

## 4. Scenario B: WAN/基幹停止のBCP（別stageの検証範囲）

### 障害モデル

店舗側UI/APIからplatform、platformから外部ERP/WMS、イベント配送、Object store、認可providerのうち、何を停止させたかを明記して個別に注入する。「ネットワーク障害」という一語で全componentの状態を曖昧にしない。

### 縮退運転

BusinessContinuityModeへ入る主体と条件を制限する。利用できるread modelのwatermark、許されるAction、金額・数量上限、approval、期限を表示する。権限判定ができない場合に広く許可せず、事前に固定した限定Actionだけを扱う。保留Actionには一意なID、入力hash、actor、時刻、根拠、対象revisionを持たせる。

### 復旧と照合

1. 障害前にbackup/checkpointと計測開始点を作る。
2. 外部書き戻し中にtimeout、process restart、重複配送を注入する。
3. platformまたは依存componentを停止し、宣言した縮退範囲だけを操作する。
4. 復旧後、外部状態を問い合わせ、成功済み、未実行、競合、不明を分類する。
5. 再送、manual review、補償Actionを選び、重複効果を防ぐ。
6. 派生indexを正本から再構築し、権限と削除が一致することを照合する。
7. RPO、RTO、未解決件数、重複件数、失われた証拠を測定する。

### 合格の意味

目標値は実装段階の `ops/BCP.md` で、demo環境と本番想定を分けて固定する。障害を隠して正常に見せるのではなく、どの操作を拒否・保留・許可したかが利用者に見えること、復旧後に全保留項目が一意の最終状態または明示的なmanual reviewへ収束することを要求する。

## 5. デモ証拠

各シナリオについて、seed版、実行command、入力、主要な画面/API応答、Object/Action/Event/Auditのcorrelation、失敗注入、期待結果、実結果を残す。録画や画像を作る場合も、manifest上のmachine-readable artifactへ対応づける。


## 6. 外部送信の列契約（B-FINAL-001修正）

内部Object/Outboxは監査・復旧用の全fieldsを保持する。ERP payloadは外部contract 1.0.0のAction別許可項目だけを送る。共通envelopeはcontractVersion、operationId、actionId、tenant、store、aggregateId、sequence、isolated。SetIsolationはこのenvelopeだけ、店舗ActionはactionTypeと次のfieldsを追加する。

| Action | 外部fields |
|---|---|
| DetectRecallImpact | phase、lotId、affectedIds、affectedStores、affectedQuantity |
| QuarantineInventory | isolated |
| CreateReplacementOrder | 影響特定の5項目＋candidateId、orderQuantity、orderAmount |
| PublishCustomerNotice | 発注の8項目＋customerMessage、customerCount |

各項目は固定scalar型（文字列・boolean・safe integer）を検査する。未定義項目、secret、将来追加される入れ子のObject列は送らない。許可項目にObject/配列が入る場合、未知Actionや未知外部contract版はINCONSISTENT_STATEでHTTP前に拒否する。APIの利用者列scopeや承認者の広い権限を、外部送信項目の拡張に使わない。

送信と照合は同じimmutable Outbox eventから同じpayload/digestを作る。現在のObjectや公開Ontologyから再構成しない。restricted-export-ordinary/delegated/approvedは通常・委任・承認付き隔離のlost-ackと照合を実HTTP/ERP ledgerで検査し、内部secret保持、外部列除外、同key再送、UNKNOWN中の再dispatch抑止、最終効果1件を確認する。正常flowと既存全例外のledgerも再帰的に制限列を検査する。

修正前にERPへ送信済みの旧payloadを、新形式で成功とみなす移行処理はない。既存ledgerとdigestが違えば照合はUNKNOWNに残り、盲目的に再送しない。このデモの再実行は独立synthetic DBを新設し、既存環境や保存失敗traceを書き換えない。

## 7. 共通foundation更新後の店舗再検証

第7回foundation独立reviewはB-FOUNDATION-008を修正済みとしてAC-002〜AC-004の範囲でAPPROVEした。店舗の意味的な受入は最新demo receiptと独立review-store-demoで別に判断する。

`quarantine-authority-expiry.json`は、委任されたQuarantineInventoryのERP commit後に元委任期限を越える待機を注入する。workerのmanager sessionが有効でもPERMISSION_DENIEDとなり、ローカル完了はrollbackされる。元ActionはPENDING_EXTERNAL、OutboxはSENDING、journalのCOMMITTED/SEND_STARTEDとERP ledgerの1効果を保持し、元ActionにABORTEDを付けない。内部secretを保持し、ERPのfieldsはisolatedのみとする。

両在庫がローカルで隔離済みでも、外部反映を確定できない間は代替発注をEXTERNAL_PENDINGで拒否し、RecallCaseはDETECTED、Actionは3件のままとする。拒否AuditのAction種別・根拠digest・Ontology/Rule版を検査する。synthetic fixtureで委任期限を更新した後、新しいdispatchでも再送せず、同operationId/payload digestのreconcileでDELIVEREDへ進める。続いて15個・15000の発注を承認し、顧客対応7件まで完了する。ERP ledgerは全体5件である。期限更新は演習用DBへの失敗注入・復旧操作であり、製品の権限自動延長機能ではない。


## 8. worker拒否の保存監査（B-DEMO-003修正）

dispatch/reconcileはOutboxと保存Actionのtenant・店舗scopeを確認してから元Action contextを評価contextへ保持する。元主体・委任の失効、ERP反映後の期限超過でtransactionをrollbackしても、別transactionのDenied AuditにactionId、operationId、actionType、targetId、入力digest、根拠、元actor/subject/delegation、元版を残す。評価時の版と要求主体を上書きせず、workerOperationで配送と照合を区別する。

`worker-denial-context.json`は2件の委任隔離を実ERP commit後のlost-ackでUNKNOWNにし、委任失効後のdispatch/reconcile拒否を保存Auditから一意に追跡する。requestId/traceIdによるtelemetry結合も検査する。未知ID、店舗scope外、保存Actionのtenant不一致では根拠・Action contextを記録しない。権限復旧後の照合は追加送信なし・各operationIdの効果1件を要求する。

`quarantine-authority-expiry.json`では、実ERP反映後の待機で元委任期限を越えた拒否にも同じ追跡assertionを適用する。PENDING_EXTERNAL/SENDING、journal COMMITTED/SEND_STARTED、発注EXTERNAL_PENDING、期限更新後の照合・承認・顧客対応までの既存検査を維持する。
