# 店舗業務・BCPデモ仕様

[English](./DEMO_SCENARIOS.md)

## 1. デモの目的

単純なCRUD画面ではなく、Ontology、Object、Link、Action、Rule、承認、外部反映、イベント、認可、証拠が同じ業務意味で接続されていることを示す。全シナリオは固定seedで再現でき、APIまたはUIの操作、状態遷移、監査記録、失敗理由を一つのcorrelation IDで追跡できるようにする。

## 2. 共通の店舗モデル

最低限、Tenant、Region、Store、Employee、RoleAssignment、Product、Lot、InventoryPosition、Supplier、RecallNotice、QuarantineCase、TransferOrder、PurchaseOrder、CustomerNotice、Approval、ExternalWriteback、BusinessContinuityModeをObjectとして扱う。Linkは、店舗の地域、在庫の店舗・商品・ロット、回収通知の対象ロット、代替商品の関係、承認者の組織範囲を表す。

Actionは入力、対象Object、期待revision、actor、onBehalfOf、idempotency key、根拠、policy/rule/definition versionを持つ。少なくとも DetectRecallImpact、QuarantineInventory、RequestEmergencyTransfer、ApproveEmergencyTransfer、CreateReplacementOrder、PublishCustomerNotice、AcknowledgeWriteback、EnterContinuityMode、ReconcilePendingWriteback、ExitContinuityMode を検討する。最終的な名称と境界はOntology reviewで固定する。

## 3. Scenario A: 商品回収から代替調達

### 開始状態

三地域、複数店舗、同一商品に複数ロット、移動中在庫、販売済み数量、代替商品、地域別承認権限をseedする。外部ERP/WMS相当の接続先は、成功、明示失敗、timeout後成功の応答を制御できるOSS内のtest doubleまたは実装Adapterとする。

### 正常系

1. RecallNoticeを取り込み、対象Product/Lotを安定IDへ対応づける。
2. Object/Link queryで影響店舗、在庫、移動中在庫を特定する。
3. Ruleが隔離対象、顧客通知範囲、代替可能品、承認経路を算出する。
4. 権限のある担当者が隔離Actionを実行し、inventory revision、Action log、Outboxを同じ境界で確定する。
5. 在庫不足店舗についてTransferまたはPurchaseを提案し、金額・地域・緊急度に応じた承認を通す。
6. 外部反映を送り、ackと照合結果を記録する。
7. UIまたはAPIで、回収noticeから最終Actionと証拠まで辿る。

### 必須の反例

- 管轄外店舗の在庫、原価列、顧客通知対象を取得または変更しようとする。
- 同じexpected revisionから二つの隔離Actionを競合させる。
- 同じidempotency keyと同じ入力を再送する。
- 同じidempotency keyへ異なる入力を送る。
- 承認後、実行前に権限または対象revisionを変更する。
- Writebackがtimeoutしたが外部側では成功している。
- Rule版またはOntology版を切替え、実行中caseと新規caseの扱いを確認する。

各反例は、拒否または一意な収束を観測し、理由に秘密情報を含めず、監査証拠を残す。

## 4. Scenario B: WAN/基幹停止のBCP

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
