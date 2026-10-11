# TAKTによる製品完遂ループ

## 1. 目的

この仕組みは、長いpromptに「最後まで作って」と書くだけではなく、製品完成の状態、証拠、差し戻し先、停止条件をversion-controlled artifactとして持つ。TAKTは工程を実行するが、完成判定は機械gateと独立reviewの積である。

## 2. 三つの制御面

### Workflow control

`.takt/workflows/platform-lifecycle.yaml` が目標、設計、計画、実装、デモ、BCP、release、最終監査の順序と戻り先を持つ。実装者とreviewerは別の `session_key` を使う。reviewerは問題が現れた場所ではなく、原因のある最も早い工程へ戻す。

### Artifact control

会話ではなく、`PRODUCT_GOAL.md`、`architecture/composition.json`、`work/ROADMAP.json`、`verification/plan.json`、`evidence/ACCEPTANCE_MATRIX.md` を正本とする。構成、roadmap、試験を変えた場合は、対応する証拠を再生成する。

### Evidence control

`scripts/platform-control.mjs run-stage <stage>` は検証planのargvをshellを介さず実行する。各suiteの定義、入力ファイル、出力artifactをhash化してmanifestへ記録する。成功後に入力やsuiteを変えると、`validate` は古いreceiptを拒否する。これにより「前にtestが通った」という文章だけではgateを通せない。

## 3. 工程と戻り先

1. `frame-goal` / `review-goal`: 完成条件、範囲、停止条件を整える。価値判断が必要なら停止する。
2. `design-architecture` / `review-architecture`: 47責務を採用、既存提供、不要のいずれかへ決め、契約、版、license、検証を持たせる。
3. `plan-roadmap`: ACを依存付きmilestoneへ対応づけ、Platform Kernelを最初の実装単位にする。
4. `build-foundation` / `review-foundation`: Ontology、Object、Action、認可、状態、Outbox、監査の最小垂直sliceを作る。
5. `build-store-demo` / `review-store-demo`: 商品回収・代替調達を正常・拒否・競合・外部失敗まで実演する。
6. `build-bcp` / `review-bcp`: 障害注入、縮退、復旧、照合、補償を実測する。
7. `harden-release`: Adapter交換、起動、運用、license、SBOM、脆弱性、backup、rollbackを検査する。
8. `final-audit`: ACごとの証拠を独立reviewし、全て満たした場合だけ `COMPLETE` とする。

各主要loopを3回反復すると進捗judgeが、同じ指摘の言い換えか、実質的な情報利得があるかを判定する。step上限や `ABORT` は未完成の停止であり、完了とは区別する。

## 4. 検証stage

`verification/plan.json` の `stage` は次の意味を持つ。

| stage | 最低限の内容 |
|---|---|
| mechanism | 監督script、workflow、初期goalの自己検査 |
| implementation | Kernelのunit、contract、integration、negative test |
| demo | 商品回収・代替調達のend-to-endとfailure path |
| bcp | outage、restart、reconcile、restore、RPO/RTO測定 |
| release | clean bootstrap、Adapter交換、license/SBOM/security、全回帰 |

suiteの`inputs`はファイルまたはdirectoryを明示し、project rootの `.` は指定しない。生成物は`outputs`へ列挙する。commandは文字列ではなくargv配列にし、`true`や`echo`のような無検査commandを合格証拠にしない。

## 5. 状態確認と再開

`npm run platform:status` は各機械gateを順に評価する。最初の不合格が現在の作業境界である。TAKT taskの状態、branch、run、resume pointは `npx takt list` で確認する。

失敗時は次を区別する。

- 再現する実装・test欠陥: 原因工程から再開する。
- 一時的provider/環境障害: 同じ位置からrequeueする。
- `max_steps` 到達: reportと残ACを確認し、継続価値がある場合だけ保存位置から再開する。
- 人の判断待ち: `ABORT` の理由と選択肢を維持し、勝手なdefaultで進めない。

`--ignore-exceed` はstep上限だけを無視する。品質gate、停止条件、外部権限を無視するoptionではない。費用や無限loopを監視できる場合に限って使う。

## 6. Branch運用

登録済みtaskは `worktree: true` で隔離cloneを使う。成功するとbranchとrun reportが残る。rootへ反映する前に `takt list` のdiffと最終auditを確認する。自動PRは既定で無効とし、外部pushは人が明示した場合だけ行う。
