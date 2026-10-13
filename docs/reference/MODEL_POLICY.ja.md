# 開発モデルの運用方針

[English](./MODEL_POLICY.md)

## 基本方針

全工程をAstraへ割り当てず、限定的な整理はLuna、設計・実装はSol、影響の大きい独立監査はAstraへ割り当てる。モデルだけで品質を保証せず、現在の入力に対する機械検証、別sessionのreview、反例と障害注入を組み合わせる。

正本は `.takt/runtime.yaml` と `.takt/workflows/platform-lifecycle.yaml`。TAKT 0.70.0の実際のcompilerとpromotion resolverを使う `npm run platform:routing` と回帰テストで解決結果を確認する。TAKT更新時はprivate APIへの依存も含めて再検証する。グローバルのCodex/TAKT設定は変更しない。

| Profile | モデル | 推論設定 | 用途 |
|---|---|---|---|
| economical | gpt-6-luna | low | 初回の目標整理、roadmap、内部assistant/selector |
| builder | gpt-6.1-sol | medium | architecture設計、Kernel、店舗demo、BCP、release |
| reviewer | gpt-6.1-sol | high | 目標、roadmap、店舗demoの審査、completion retry judge |
| critical | gpt-6-astra | high | architecture、foundation、BCP、最終監査、loop judge |

## 再訪時の昇格

- `frame-goal`、`plan-roadmap`: 初回Luna/low、2回目Sol/medium、3回目以降Astra/high。
- `design-architecture`、`build-foundation`、`build-store-demo`、`build-bcp`、`harden-release`: 初回・2回目Sol/medium、3回目以降Astra/high。
- 重要監査の4工程は最初からAstra/high。通常審査はSol/high。

「再訪」は同じworkflow内のstep実行回数で、コマンドgate不合格による再実行も含む。問題の難易度を自動で認識するわけではない。モデルが昇格しても実装者とreviewerは別sessionのままとし、ACや検査を弱めて収束させない。主要loopが3周するとAstraのjudgeが情報利得と人の判断の要否を審査する。

## GPT-5.6系を既定にしなかった理由

旧世代だから安いとは限らない。2026-10-12に確認した公式モデルページの標準API価格では、短いcontextの100万tokenあたり、入力/出力は次の通りだった。

| 比較 | GPT-5.6系 | 今回のモデル |
|---|---|---|
| 小型 | 5.6 Luna: $0.20 / $1.20 | 6 Luna: $0.10 / $0.50 |
| 主力 | 5.6 Sol: $4.00 / $20.00 | 6.1 Sol: $2.00 / $10.00 |

出典: [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)、[GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)、[GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)、[GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)。価格、cached input、長いcontext、処理tierなどの条件は利用時に公式資料で再確認する。

これはAPI価格の比較で、今回使用するChatGPT認証の請求額・利用枠を表すものではない。GPT-5.6への差し替えを禁止しないが、設定変更、同じ回帰テストと接続確認、機械検証の再実行を必要とする。認証・rate limit障害で別モデルへ無断fallbackしたり、新規の有料資源を作ったりはしない。

## CLIと接続検査

`scripts/codex-runtime.mjs` はPATH上とmacOSアプリ同梱のCLIを比較し、新しいものをプロジェクトの起動環境にだけ指定する。`TAKT_CODEX_CLI_PATH` を明示した場合はそれを尊重し、壊れた指定を無断で置き換えない。

今回の環境ではPATHの0.144.5では指定モデルを利用できなかった。アプリ同梱の0.162.0-alpha.17.2では、TAKTのCodexProviderを通したLuna/low、Sol/medium、Sol/high、Astra/highの短い接続確認に成功した。アプリ更新や別machineでも同じ結果になるとは保証しないため、起動前に再検査する。

`npm run platform:models` はファイル編集やtool実行を求めない短いreadonly promptを4設定で実行し、`evidence/model-smoke.json` へ結果を保存する。receiptは24時間有効で、実際のmerged runtime、選択CLIのpath/versionが一致する場合だけ有効。CLI/auth/modelエラーがあれば起動を止める。認証済みというだけでは合格にしない。モデルの本格的な実装品質や製品品質を証明する試験ではない。

`npm run platform:run` / `platform:watch` / `platform:start` はstrict preflightを通してから同じ隔離queueを使う。環境変数によるprovider/model/runtime上書き、未commitの仕様、古い機械検証receiptは拒否する。これらの入口を迂回した直接の `npx takt run` は接続・鮮度検査を行わないので、通常の開始には使わない。

## 費用と停止の限界

初回は最大60工程で区切る。stepごとに実装、判定、reportなど複数のモデル呼び出しがあり、loop judgeや検証コマンドも動くため、60は呼び出し数・token数・金額の上限ではない。現状に金額ベースの強制停止はない。

上限に達したらrun report、残AC、同じ欠陥の反復、利用枠を人が確認する。再開位置からrequeueした上で、継続を明示的に決めた場合だけ `npm run platform:run -- --ignore-exceed` を使う。このoptionは工程上限だけを無視し、品質gateや権限境界を無視しない。

新規課金、外部公開、push/PR、実データ、credential変更、既存環境への書き戻しは停止条件。初回の許可は既存アカウントでの開発モデル利用に限り、製品が有料モデルを必須依存にする許可ではない。
