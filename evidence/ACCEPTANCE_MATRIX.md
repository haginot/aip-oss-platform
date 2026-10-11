# Acceptance Matrix

`PASS` は現在の入力hashに対するmachine receiptと意味的証拠の両方がある場合だけ使用します。`READY_FOR_REVIEW` は機械検査済みで独立最終審査前、`NOT_RUN` は未実施、`FAIL` は実施して不合格、`BLOCKED` は人の判断または外部条件待ちを表します。

| ID | Status | Evidence | Residual risk |
|---|---|---|---|
| AC-001 | NOT_RUN | なし | clean環境からの起動未検証 |
| AC-002 | NOT_RUN | なし | Kernel未実装 |
| AC-003 | NOT_RUN | なし | 認証・認可・委任未実装 |
| AC-004 | NOT_RUN | なし | 競合・再送・部分失敗未検証 |
| AC-005 | NOT_RUN | なし | 店舗業務デモ未実装 |
| AC-006 | NOT_RUN | なし | BCP演習未実施 |
| AC-007 | NOT_RUN | なし | Adapter交換未実施 |
| AC-008 | NOT_RUN | なし | 運用・license・supply chain未検証 |
| AC-009 | NOT_RUN | なし | 最終独立監査前 |

