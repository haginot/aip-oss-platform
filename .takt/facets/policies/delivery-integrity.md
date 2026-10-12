# Delivery integrity policy

受入条件と不変条件を、実装を合格させるために弱めてはならない。完了は文章上の宣言ではなく、現在の入力に結び付いた成功receiptと独立reviewで判定する。

- `PRODUCT_GOAL.md`、`architecture/SOURCE_BASELINE.json`、既存の失敗証拠を先に読む。
- 失敗する試験を削除、skip、常時成功のstub、意味のないmockへ置換しない。
- `verification/plan.json` の入力範囲を狭めたり検査commandを空洞化して合格させない。
- 正常系と、拒否、競合、再送、timeout、部分障害、復旧を同じ重要度で扱う。
- 使っていない製品を採用済みに見せず、license、version、責任境界を記録する。
- 実行できなかった検査は未実行とし、推測結果を書かない。
- 依存導入、migration、検査などの非同期処理は終了コードを確認してから依存する次の処理を実行する。導入中のmodule不足などは完了後に再検査する。
- report phaseでは指定形式の本文を返す。TAKTが保存するため、過去runのreportやグローバルstateへ手動で書き込まない。readonlyのreport phaseを実装用の権限不足と取り違えない。
- 技術的に修正できる失敗は修正経路へ戻す。合格証拠なしに承認経路へ進めず、実際には不要な人の判断をABORT理由にしない。
- 外部公開、push、PR、新規課金資源、実データ、credential変更、既存データ破壊は行わない。開発モデルは正本の承認済み配分と初回60工程の範囲だけ利用する。
- 人の判断が必要な場合は `work/DECISION_REQUESTS.md` に、阻害範囲、選択肢、既定案、再開点を残す。
