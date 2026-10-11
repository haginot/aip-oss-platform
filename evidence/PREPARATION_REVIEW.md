# 実行準備レビュー — 2026-10-12

## 判定

現段階は製品実装前の開発ループである。目標、出典、workflow、モデル配分、検証script、隔離queue、実行手順を再レビューし、下記の不備を修正した。ローカル検査、commit済みのクリーンなコピーからの検査、strict起動前検査が合格し、初回runを開始できる状態になった。製品の完成判定ではない。

今回のレビューはこの変更を行ったCodexによる実行準備レビューであり、製品完成時に要求する別sessionの独立最終監査を代替しない。長時間の開発run、製品実装、実店舗への接続、外部公開、push、PRは実施していない。

## 修正した不備

| 観点 | 不備と修正 |
|---|---|
| モデル費用 | Astra中心の配分をLuna/low、Sol/medium、Sol/high、Astra/highへ分割。重要監査はAstra固定、計画と実装は同じ工程への再訪時に昇格する。GPT-5.6系を含む公式価格比較をMODEL_POLICYへ記録した。 |
| 実際の設定解決 | tagとstep指定の競合を解消。TAKT 0.70.0の実compilerとpromotion resolverを使って全14工程、内部agent、推論設定を検査する。 |
| CLIの互換性 | PATHの古いCLIでは対象モデルを利用できなかった。新しいアプリ同梱CLIをプロジェクトの起動環境で選び、TAKT provider経由で接続を確認した。グローバル設定は変更しない。 |
| 起動経路 | 対話型の直接workflow実行とqueue実行が混在していた。run/start/autonomous/watchをstrict preflight付きの隔離queueに統一した。 |
| 隔離clone | 未commitの変更や既存node_modulesに依存しないよう、起動前にGit状態を確認し、初回工程でlockfileに従う依存導入を明示した。 |
| gateと停止 | 不合格gateが人への停止や原因工程への差し戻しまで妨げる経路を修正。ABORT・修正経路だけgateをskipし、承認・COMPLETE経路は検査を維持した。 |
| 証拠の鮮度 | 過去の成功だけを探す実装を廃止。最新実行がfailed/runningなら進めず、実行前後の入力、出力、suite定義、全commandの成功記録を照合する。モデル接続確認も開始時にrunningを保存する。 |
| 検証対象 | project root別名、project外、symlink、欠損、空directoryを拒否。非空の対象と混在した空directoryも個別に拒否する。 |
| 計画 | 全ACの対応、未知・自己・循環依存、空のoutcomeを検査し、形式だけのロードマップを拒否する。 |
| 最終監査 | releaseで全stageを再実行し、readonlyの最終監査は現在のreceiptを照合する。AC-009のREADY_FOR_REVIEWと独立監査の承認を区別する。 |
| 依存関係 | TAKT 0.70.0と直接利用するyaml 2.9.1を固定。開発用依存のauditも確認した。 |

## 検証結果

| 検査 | 結果 |
|---|---|
| 回帰テスト | 39件PASS、FAIL/SKIPなし。モデル配分、CLI選択、起動引数、証拠の鮮度、失敗、中断、timeout、path、ロードマップを検査。 |
| TAKT workflow doctor | platform-lifecycle合格。全14工程、最大60工程。 |
| mechanism stage | 現在の入力に対するcommand全成功とfingerprint照合に合格。詳細はrun-manifest.json。 |
| 出典 | SOURCE_BASELINE.jsonの6資料の実SHA-256を原本と照合、全一致。 |
| 実モデル接続 | Luna/low、Sol/medium、Sol/high、Astra/highの4設定がTAKT CodexProvider経由でPASS。接続記録はmodel-smoke.json、24時間有効。 |
| ローカルpreflight | Node、固定TAKT、queue、gate実行権限、モデル配分、CLI認証、接続receipt、mechanism receiptが合格。 |
| 開発依存audit | npm auditで報告された脆弱性は0件。この時点の既知情報であり、将来選定する製品OSSのlicense/SBOM/security検査ではない。 |
| クリーンコピー | 修正commit `1c16c1e` からローカルcloneし、node_modulesのない状態から `npm ci --offline` が成功。続く `npm run check` で39件、workflow doctor、mechanismがすべて合格。ネットワークなしの依存導入はこのmachineのnpm cacheを使ったもので、製品の起動検証ではない。 |
| strict dry-run | commit後のrootで `npm run platform:run -- --dry-run` が合格し、`isolated launch ready` を確認。TAKTの開発runは起動していない。 |

## 製品の現在地と残る制約

- goalとmechanismのみPASS。architecture以降はWAITで、compositionとroadmapはdraft、AC-001〜AC-009はすべてNOT_RUNのままである。今回の合格を製品の合格へ転記しない。
- 最初の工程は目標の再確認である。目標審査ではAIの権限付き検索・構造化提案・tool制約が実動デモの到達条件として十分具体的か確認する。初版scopeを実質的に変える必要があれば、推測で確定せず人の判断を求める。
- 60はworkflow工程数であり、モデル呼び出し数・token数・金額上限ではない。金額による強制停止も、上限到達後の自動再queueも実装していない。無制限の自走や完成の保証として扱わない。
- API単価の比較と、現在のChatGPT認証の利用枠・請求は別である。追加の課金資源や新しいAPI契約は許可しない。
- sourceDirectoryはこの開発環境の絶対pathである。完成製品のruntime依存にしない。モデル接続receiptもCLI/path/merged runtimeに結び付くため、別環境では再検査が必要である。
- manifestはfingerprint付きのローカル記録で、電子署名や改ざん不能な証明ではない。試験の意味、inputsの網羅性、反例は独立reviewerが審査する。
- TAKTのprivate compiler/provider APIを検査に使っている。TAKTのversionを上げるときは同じ回帰・接続検査をやり直す。
- この自走基盤はtakt-goal-supervisionの実験から、証拠・差し戻し・停止・checkpointの考え方を取り入れている。別の常駐監督サービスや上限後の自動継続まで再現したものではない。

## 実行手順

モデル接続確認が24時間以内で、起動前検査が合格する場合は `npm run platform:run` で初回runを開始できる。時間が経過した場合は `npm run platform:prepare` を再実行してから `npm run platform:run -- --dry-run` で確認する。停止時は残AC、run report、再開位置、人の判断の要否を確認する。上限を無条件に解除しない。
