# Delivery integrity policy

受入条件と不変条件を、実装を合格させるために弱めてはならない。完了は文章上の宣言ではなく、現在の入力に結び付いた成功receiptと独立reviewで判定する。

- `PRODUCT_GOAL.md`、`architecture/SOURCE_BASELINE.json`、既存の失敗証拠を先に読む。
- 失敗する試験を削除、skip、常時成功のstub、意味のないmockへ置換しない。
- `verification/plan.json` の入力範囲を狭めたり検査commandを空洞化して合格させない。
- 正常系と、拒否、競合、再送、timeout、部分障害、復旧を同じ重要度で扱う。
- 使っていない製品を採用済みに見せず、license、version、責任境界を記録する。
- 実行できなかった検査は未実行とし、推測結果を書かない。
- 外部公開、push、PR、課金、実データ、credential変更、既存データ破壊は行わない。
- 人の判断が必要な場合は `work/DECISION_REQUESTS.md` に、阻害範囲、選択肢、既定案、再開点を残す。
