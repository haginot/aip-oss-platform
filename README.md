# AIP OSS Platform

Palantir AIP / Foundry が扱う Ontology、Object、Action、認可、イベント、AI、監査、運用の責務を、交換可能なOSSの組み合わせで実現するためのプロジェクトです。最初から47製品を並べるのではなく、プラットフォームが所有する業務契約を先に固定し、小さな垂直スライスを実装し、店舗業務とBCPの実演で保証を増やします。

このリポジトリの現段階は「製品実装前の自走基盤」です。TAKTが目標、設計、実装、通常業務デモ、BCP、交換試験、リリース監査を順に進め、機械ゲートまたは独立レビューが不合格なら原因工程へ戻します。エージェントが文章で完了を宣言しただけでは `COMPLETE` になりません。

## まず動かす

Node.js 22.22以上と、TAKTで利用するproviderの認証済みCLIが必要です。

```sh
npm install
npm run platform:preflight
npm run takt:doctor
npm run platform:status
```

対話しながら開始する場合:

```sh
npm run platform:start
```

画面で内容を確認し、`/go` で実行します。確認済みの目標を直接実行する場合は次を使います。

```sh
npm run platform:autonomous
```

長期実行には、あらかじめ登録してある `.takt/tasks.yaml` のタスクを使います。Taktは隔離cloneで実行するため、初回commitが必要です。

```sh
npm run platform:run
# max_steps 到達後も同じ実行を継続すると明示的に決めた場合だけ:
npx takt run --ignore-exceed
```

状態、差分、失敗、再開位置は `npx takt list` で確認します。常駐してpending taskを処理する場合は `npm run platform:watch` を使います。失敗や上限到達を無条件に成功扱いせず、保存された位置からrequeueします。

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

各実装段階では `verification/plan.json` に登録したコマンドをshell経由ではなく直接実行し、対象ファイルと出力のSHA-256を `evidence/run-manifest.json` に残します。コードや試験定義が変われば古い合格記録は無効になります。意味的な妥当性は別セッションのreviewerが確認します。

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

詳しい再開方法、差し戻し規則、人間を呼ぶ条件は [完遂ループの設計](docs/DELIVERY_LOOP.md) を参照してください。

## 現在地

監督機構、目標、アーキテクチャ原則、デモ仕様、初期ロードマップを用意した状態です。製品としての実装と実演証拠はまだありません。`npm run platform:status` が、どのgateまで通るかを事実ベースで表示します。

## 参照

- [TAKT](https://github.com/nrslib/takt)
- [TAKT Task Management](https://github.com/nrslib/takt/blob/main/docs/task-management.md)
- [TAKT Workflow Guide](https://github.com/nrslib/takt/blob/main/docs/workflows.ja.md)

