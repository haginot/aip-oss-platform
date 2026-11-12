# Failed interval history and distinct-run runtime continuation

## Iteration29 delivery correction

[RUNTIME_DELIVERY.md](RUNTIME_DELIVERY.md) is the current bounded implementation and external-boundary plan. The older iteration15 estimate below is historical. Observation helpers exist, but the distinct-run coordinator and initializer-private failed-interval path are not implemented. The source remains active B04; a new independent D_S is required for this changed plan. No source terminal, host admission exclusion, target creation, Issue approval or migration is implied. Preserve all existing failure classifications and 32 runtime/failure acceptance assertions below.

状態: DESIGN_REVIEW_PENDING / NOT_IMPLEMENTED。run 20261023180641-00e8fea9、iteration15、active B04。AR14-B01とAR14-N01を受け、iteration13の同run runtime切替と --recover-failed の未実装案を撤回する。旧版はdesign-history/run-20261023180641-iteration15-entryに不変保存した。

## 観測した失敗区間

iteration10のAPPROVEはB00〜B03だけを承認した。その後のB04選択とBF-61修正を保持するが、現在の全prefix成功・B04候補・独立承認はない。latest failedを成功やREQUEST_CHANGESへ変換しない。

B04=1792793161172-188ede83-8d71-40fe-86ba-2baeef4ecdc1 は全3 subprocess exit0だが必須assertion BF-61-current-lineage-new-and-replayed-approval-denied-before-fix の欠落でfailed。B00=1792793643006-58cfc55a-8fd8-4398-858d-72a94f93a15f はfresh-store-baselineのexit1。部分TAP/非ゼロ終了を全失敗の必要条件にしない。各receiptの当時plan/suite・実exit/signal/log/outputから原因を再計算し、両種別の失敗をそのまま保持する。

0.72.0の隔離audit/437件成功と、iteration13のbody-parser override失敗は歴史証拠で、実executor移行や現在の受入ではない。0.71.0/0.72.0公式resumeの同run拒否に従い、別runを公式launcherで開始する経路へ変更する。

## 新しい境界と実装責務

詳細・field・書込み集合・失敗・試験・予算の正本は [RUNTIME_CONTINUATION.md](RUNTIME_CONTINUATION.md)。全consumerがこの契約を使用する。

1. sourceの独立設計命令D_SはPREPARATION_AND_HISTORY_ONLY。active B04内の実Astra/highによる実装・隔離試験だけを準備し、source progress/承認/selectionは不変。
2. 実source terminalとexecutor/gate/childの停止確認後だけ、正確なcandidate package/lock/runtimeを導入し、公式central launcher (worktree=false)で異なるrun Tを開始。健全workerを停止せず、中央履歴を編集しない。Tは未作成でID未確定。
3. Tのdesign-architecture→別session review-architectureで実contextと新planに束縛した明示D_Tを取得。D_SはTの初期化権限ではない。
4. initializer-privateの型FAILED_INTERVAL_RUNTIME_CONTINUATIONで、旧承認prefix・未審査failed tail・runtime・全phase/receiptを歴史として認証/保存。--initialize-runだけが原子的にTの空approvals/issuesとB00を作る。同run再初期化、通常batchへの例外fallback、旧B04のコピーは不可。
5. Tで通常B00→B01→B02→B03→B04の各gate・新独立レビュー・正規importを行う。全19 leaf/52原AC、BF-61/BF-38/BF-42/BF-43、fresh隔離baselineが合格するまでB05/sealへ進めない。現在approval/selection/closure/finalは厳格なまま。

旧schema1/2のrejection/revalidation能力と既存の原ACは保持する。新schema3は歴史archive専用であり、DESIGN_FAILED_INTERVAL_ORDERによる同run再生成権限は発行しない。currentContextのinstalled runtimeを旧receiptへ刻み直さず、正確な旧runtime認証は専用historical reader内だけで行う。実際の移行・initializer拡張は未実装。

## 保持する受入計画

既存56とiteration13の以下18 assertionを全て保持し、新契約の14 assertionを追加する（合計88、330 suiteの総数不変）。18項目の移行先は新run、progress不変条件はsourceと旧archive、唯一のcross-run projectionはD_T認証後に限定する。全prefixは新runの通常依存順で再検証し、元要件を免除しない。追加14件の名前と実CLI/engine/Phase・CAS・失敗種別の正例反例はRUNTIME_CONTINUATION.md section6に定義する。これら32項目は予定であり、実装済み又は実行済みとは主張しない。

- failed-interval-explicit-independent-order-no-fake-rejection
- failed-interval-original-selection-and-approved-prefix-authenticated
- failed-interval-complete-index-and-failed-output-bytes-bound
- failed-interval-real-builder-phases-session-and-terminal-required
- failed-interval-no-success-candidate-required-or-synthesized
- failed-interval-runtime-from-to-and-five-file-diff-exact
- failed-interval-runtime-package-lock-audit-and-compatibility-bound
- failed-interval-runtime-quiescent-process-boundary-no-mixed-code
- failed-interval-unknown-runtime-or-unrecorded-handoff-zero-writes
- failed-interval-later-review-running-fork-or-gap-zero-writes
- failed-interval-all-B00-through-B04-fresh-suites-required
- failed-interval-input-or-authority-change-fails-with-history
- failed-interval-crash-lock-and-atomic-publication
- failed-interval-frozen-gate-idempotent-same-candidate
- failed-interval-import-approval-history-readers-same-authority
- failed-interval-new-exact-review-before-B05-or-seal
- failed-interval-progress-selection-protected-old-evidence-unchanged
- failed-interval-legacy-rejection-initializer-final-remain-strict
