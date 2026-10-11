# 完成指示

`PRODUCT_GOAL.md` を正本として、AC-001〜AC-009を弱めず、機械検証と独立レビューを通し、店舗の商品回収・代替調達とBCPを実演できるOSSプラットフォームを完成させる。

## 必須条件

- `/Users/haginota/Repositories/pivot-ontology/output/aipf-modular-architecture-20261010` の設計思想を、`architecture/SOURCE_BASELINE.json` の固定hashと照合して引き継ぐ。
- Ontology/Object/Action、認可・委任、状態・Outbox・Auditを共通の公開contractとして実装する。
- 商品ロット回収・代替調達の正常、拒否、競合、承認待ち、外部反映失敗を実演する。
- WANまたは基幹停止、成功不明、再起動、復旧、照合、重複排除、補償を実演し、RPO/RTOと未解決項目を測る。
- すべてのPASSを現在の入力hashに対応する検証receiptへ結び、最後に別sessionのreviewerが監査する。

## 自律実行の境界

ローカルのsource、test、container、synthetic data、文書、証拠は自律的に作成・修正してよい。外部公開、push、PR、課金、実データ、credential変更、既存環境への書き戻しは行わない。人の判断が必要な場合は `work/DECISION_REQUESTS.md` に影響、選択肢、既定案、再開点を残して停止する。
