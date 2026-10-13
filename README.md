# AIP OSS Platform

カンリーとは一切関係のない、萩野個人の開発・検証プロジェクトです。会社や顧客の実データは使用していません。Palantirの公式プロジェクトでもありません。

[図解付き紹介ページ（日本語）](https://haginot.github.io/aip-oss-platform/ja.html) · [English introduction](https://haginot.github.io/aip-oss-platform/) · [実装の説明](docs/IMPLEMENTATION.md)

Palantir AIP / Foundry が扱う Ontology、Object、Action、認可、イベント、AI、監査、運用の責務を、交換可能なOSSの組み合わせで実現するためのプロジェクトです。最初から47製品を並べるのではなく、プラットフォームが所有する業務契約を先に固定し、小さな垂直スライスを実装し、店舗業務とBCPの実演で保証を増やします。

このリポジトリには、Node.jsとPostgreSQLによる限定的な参照実装と、合成データを使った検証記録があります。本番運用向けの完成品ではありません。TAKTが目標、設計、実装、通常業務デモ、BCP、交換試験、リリース監査を順に進め、機械ゲートまたは独立レビューが不合格なら原因工程へ戻します。エージェントが文章で完了を宣言しただけでは `COMPLETE` になりません。

## まず動かす

Node.js 22.22以上と、認証済みCodex CLIが必要です。TAKTは検証済みの0.70.0へ固定しています。次は開発ループの準備であり、製品の起動手順ではありません。

```sh
npm ci
npm run platform:prepare
npm run platform:status
```

`platform:prepare` は回帰テスト、workflow検査、機械検証、4設定の短いモデル接続確認、事前検査を実行します。モデル接続確認は既存のアカウント利用枠を消費します。接続記録は24時間有効で、CLIまたはモデル配分を変えたら再確認が必要です。

実行に渡す成果物をローカルcommitし、起動前検査だけを行います。TAKTの隔離cloneはcommit済みの内容を使うため、未commitの仕様やコードは渡しません。

```sh
npm run platform:run -- --dry-run
# ここからが実開発の開始:
npm run platform:run
```

`platform:start` と `platform:autonomous` も同じ隔離queueを実行する別名です。対話型の直接実行や `/go` は使いません。初回は最大60工程で区切り、未達なら停止します。これはAPI呼び出し数や金額の上限ではなく、完成まで無制限に回し続ける設定でもありません。

状態、差分、失敗、再開位置は `npx takt list` で確認します。常駐してpending taskを処理する場合は `npm run platform:watch` を使います。失敗や上限到達後は理由と残ACを確認して保存位置からrequeueし、上限超過を許可すると明示的に決めた場合だけ `npm run platform:run -- --ignore-exceed` を使います。新規課金資源、実データ、外部書き戻し、push、PRは許可しません。

## モデルの使い分け

| 担当 | モデル | 昇格・固定 |
|---|---|---|
| 目標整理、roadmap、内部の補助・振分け | GPT-6 Luna / low | 目標・計画は2回目Sol、3回目Astra |
| 設計、実装、デモ、BCP実装、release整備 | GPT-6.1 Sol / medium | 同じ工程の3回目からAstra |
| 目標・roadmap・店舗デモの通常審査 | GPT-6.1 Sol / high | 固定 |
| architecture、認可・整合性、BCP、最終監査、停滞判定 | GPT-6 Astra / high | 固定、値下げしない |

同じ工程への再訪回数で昇格します。難易度を自動分類する仕組みではありません。設定の実際の解決結果は `npm run platform:routing` で確認できます。GPT-5.6系との比較、認証とCLIの選び方、費用管理の限界は [モデル運用方針](docs/MODEL_POLICY.md) に記載しています。

## 完成までの制御

```text
目標固定 → 独立目標審査
  ↓
47責務の構成決定 → 独立アーキテクチャ審査
  ↓
依存付きロードマップ → Platform Kernel → 独立実装審査
  ↓
店舗の商品回収・代替調達デモ → シナリオ審査
  ↓
WAN/基幹停止の縮退運転・照合・復旧 → BCP審査
  ↓
Adapter交換・運用・ライセンス・供給網の硬化
  ↓
受入条件ごとの最終独立監査 → COMPLETE
```

各実装段階では `verification/plan.json` に登録したコマンドをshell経由ではなく直接実行し、対象ファイルと出力のSHA-256を `evidence/run-manifest.json` に残します。コードや試験定義が変われば古い合格記録は無効になります。最新実行が失敗・中断した場合も、以前の合格を再利用できません。意味的な妥当性は別セッションのreviewerが確認します。記録は電子署名ではなく、同一の作業者による不正な書き換えを防ぐ仕組みではありません。

## 正本

- `PRODUCT_GOAL.md`: スコープ、完成条件、停止条件
- `docs/ARCHITECTURE_BASELINE.md`: 元設計から継承する不変条件
- `architecture/composition.json`: 47責務の採用・既存提供・不要判断
- `work/ROADMAP.json`: 依存関係と受入条件を持つ実装順序
- `docs/DEMO_SCENARIOS.md`: 店舗業務とBCPの実演仕様
- `verification/plan.json`: 実行すべき検証コマンド
- `evidence/ACCEPTANCE_MATRIX.md`: 受入条件と証拠の対応
- `evidence/run-manifest.json`: 検証runと入力・出力hash
- `.takt/workflows/platform-lifecycle.yaml`: 完遂ループ
- `docs/MODEL_POLICY.md`: 工程別モデル、昇格、接続確認、費用境界
- `evidence/PREPARATION_REVIEW.md`: 実行準備のレビューと検証結果（製品の完成証拠ではない）

詳しい再開方法、差し戻し規則、人間を呼ぶ条件は [完遂ループの設計](docs/DELIVERY_LOOP.md) を参照してください。

## 現在地

参照実装と合成データによるデモ・検証記録はありますが、実店舗への導入や本番運用を検証したものではありません。実装の範囲と制約は [実装の説明](docs/IMPLEMENTATION.md) を参照してください。`npm run platform:status` が、どのgateまで通るかを事実ベースで表示します。

## 参照

- [TAKT](https://github.com/nrslib/takt)
- [TAKT Task Management](https://github.com/nrslib/takt/blob/main/docs/task-management.md)
- [TAKT Workflow Guide](https://github.com/nrslib/takt/blob/main/docs/workflows.ja.md)
