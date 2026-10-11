# BCP設計・演習台帳

## 現在の状態

本書はBCP工程の正本です。現段階ではシナリオと記録項目だけが固定され、復旧目標、実行可能なrunbook、演習結果はまだ確定していません。未実施を成功として扱いません。

## 対象障害

- 店舗からplatformへの通信断
- platformからERP/WMS相当接続先への通信断と成功不明
- Object storeまたはprocessの停止・再起動
- Eventの重複、逆順、配送遅延
- 認可providerの停止
- 派生indexの破損またはcheckpoint不一致

## 固定すべき項目

実装前に、componentごとの正本、backup、checkpoint、RPO、RTO、縮退中に許すAction、禁止Action、承認者、上限、復旧順序、照合query、補償、manual reviewへの移送条件を決めます。demo目標と本番採用時の目標を混同しません。

## 演習記録

各演習は開始・終了時刻、build/definition/policy版、seed、障害注入点、観測値、RPO/RTO、データ損失、重複効果、未解決Action、証拠pathを `evidence/run-manifest.json` と受入matrixへ記録します。実測前の期待値を結果欄へ転記しません。

