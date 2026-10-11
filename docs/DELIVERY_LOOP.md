# TAKTによる製品完遂ループ

## 1. 目的

この仕組みは、長いpromptに「最後まで作って」と書くだけではなく、製品完成の状態、証拠、差し戻し先、停止条件をversion-controlled artifactとして持つ。TAKTは工程を実行するが、完成判定は機械gateと独立reviewの積である。

## 2. 三つの制御面

### Workflow control

`.takt/workflows/platform-lifecycle.yaml` が目標、設計、計画、実装、デモ、BCP、release、最終監査の順序と戻り先を持つ。実装者とreviewerは別の `session_key` を使う。reviewerは問題が現れた場所ではなく、原因のある最も早い工程へ戻す。

### Artifact control

会話ではなく、`PRODUCT_GOAL.md`、`architecture/composition.json`、`work/ROADMAP.json`、`verification/plan.json`、`evidence/ACCEPTANCE_MATRIX.md` を正本とする。構成、roadmap、試験を変えた場合は、対応する証拠を再生成する。

### Evidence control

`scripts/platform-control.mjs run-stage <stage>` は検証planのargvをshellを介さず実行する。各suiteの定義、実行前の入力ファイル、出力artifactをhash化してmanifestへ記録する。検証中に入力が変わった場合、必須出力がない場合、commandが失敗またはtimeoutした場合は不合格になる。実行開始時にrunning状態を保存し、最新実行がrunningまたはfailedなら以前のpassedは再利用しない。成功後に入力、出力、suiteを変えても古いreceiptを拒否する。これにより「前にtestが通った」という文章だけではgateを通せない。

これは署名付きの第三者証明ではない。検査自体を空洞化したり狭いinputsで不具合を隠したりする行為は、独立reviewで拒否する。

## 3. 工程と戻り先

1. `frame-goal` / `review-goal`: 完成条件、範囲、停止条件を整える。価値判断が必要なら停止する。
2. `design-architecture` / `review-architecture`: 47責務を採用、既存提供、不要のいずれかへ決め、契約、版、license、検証を持たせる。
3. `plan-roadmap` / `review-roadmap`: 全ACを依存付きmilestoneへ対応づけ、Platform Kernelを最初の実装単位にする。機械検査は未知の依存、自己依存、循環、空のoutcome、AC漏れを拒否する。
4. `build-foundation` / `review-foundation`: Ontology、Object、Action、認可、状態、Outbox、監査の最小垂直sliceを作る。
5. `build-store-demo` / `review-store-demo`: 商品回収・代替調達を正常・拒否・競合・外部失敗まで実演する。
6. `build-bcp` / `review-bcp`: 障害注入、縮退、復旧、照合、補償を実測する。
7. `harden-release`: Adapter交換、起動、運用、license、SBOM、脆弱性、backup、rollbackを検査する。
8. `final-audit`: ACごとの証拠を独立reviewし、全て満たした場合だけ `COMPLETE` とする。

各主要loopを3回反復すると進捗judgeが、同じ指摘の言い換えか、実質的な情報利得があるかを判定する。工程ごとのモデルと再訪時の昇格は [モデル運用方針](MODEL_POLICY.md) に従う。step上限や `ABORT` は未完成の停止であり、完了とは区別する。

gate付き工程の人への停止と、final-auditなどから原因工程への差し戻しは `command_gates: skip` を明示する。不合格gateのために停止・修正工程へ移れなくなるのを防ぐためで、承認経路のgateは省略しない。最終監査はreadonlyなのでmatrixを自分でPASSへ書き換えない。release担当がAC-001〜AC-008をPASS、AC-009をREADY_FOR_REVIEWに整え、現在の全receipt、`14-final-audit.md` の独立承認、TAKTのCOMPLETEを合わせて最終判定とする。

## 4. 検証stage

`verification/plan.json` の `stage` は次の意味を持つ。

| stage | 最低限の内容 |
|---|---|
| mechanism | 監督script、workflow、初期goalの自己検査 |
| implementation | Kernelのunit、contract、integration、negative test |
| demo | 商品回収・代替調達のend-to-endとfailure path |
| bcp | outage、restart、reconcile、restore、RPO/RTO測定 |
| release | clean bootstrap、Adapter交換、license/SBOM/security、全回帰 |

suiteの`inputs`はファイルまたはdirectoryを明示し、project rootの `.` やその正規化別名は指定しない。空directory、symlink、project外への参照も拒否する。生成物は`outputs`へ列挙する。commandは文字列ではなくargv配列にし、`true`や`echo`のような無検査commandを合格証拠にしない。無検査commandの全種類を機械的に判別できるわけではないので意味の審査は残る。

release gateはmechanismとimplementation/demo/bcp/releaseを再実行する。final gateはreadonlyで最新receiptだけを照合し、監査中に製品入力を変更しない。

## 5. 状態確認と再開

`npm run platform:status` は各機械gateを順に評価する。最初の不合格が現在の作業境界である。TAKT taskの状態、branch、run、resume pointは `npx takt list` で確認する。

失敗時は次を区別する。

- 再現する実装・test欠陥: 原因工程から再開する。
- 一時的provider/環境障害: 同じ位置からrequeueする。
- `max_steps` 到達: reportと残ACを確認し、継続価値がある場合だけ保存位置から再開する。
- 人の判断待ち: `ABORT` の理由と選択肢を維持し、勝手なdefaultで進めない。

`--ignore-exceed` はstep上限だけを無視する。品質gate、停止条件、外部権限を無視するoptionではない。費用や無限loopを監視できる場合に限って `npm run platform:run -- --ignore-exceed` として使う。現状に金額ベースの強制停止や、上限到達後の自動再queueはない。人が完了・再開・判断待ちを確認する有限の開発loopである。

## 6. Branch運用

登録済みtaskは `worktree: true` で隔離cloneを使う。`platform:run`、`platform:start`、`platform:autonomous` は同じ入口で、開始前に未commitの成果物と認証・モデル接続・機械検証の鮮度を確認する。cloneにはnode_modulesがないため、最初の工程で `npm ci` を行う。設計出典の絶対pathはこの開発環境の参照であり、完成製品のruntime依存にはしない。

成功するとbranchとrun reportが残る。rootへ反映する前に `takt list` のdiffと最終auditを確認する。自動PRは既定で無効とし、外部pushは人が明示した場合だけ行う。
