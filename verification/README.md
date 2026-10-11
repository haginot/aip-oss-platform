# Verification plan

`plan.json` は製品検証の実行入口です。各suiteは一意なID、stage、argv形式のcommands、明示的なinputs、必要ならoutputs、timeoutを持ちます。

実装が進んだら、少なくとも `implementation`、`demo`、`bcp`、`release` のsuiteを追加します。unit testだけをdemoやBCPの証拠に流用せず、E2E、negative path、failure injection、restore、clean bootstrapをそれぞれ実行します。

```sh
node scripts/platform-control.mjs run-stage implementation
node scripts/platform-control.mjs validate implementation
```

実行開始時のrunning receipt、失敗時のfailed receipt、成功時のpassed receiptを `evidence/run-manifest.json` に記録します。同じstageの最新実行だけを使い、失敗・中断後に以前の合格を拾いません。検証中の入力変更、必須出力の欠落、timeout、spawn errorは失敗です。suite定義、入力、出力のいずれかが変わると古いreceiptは無効です。

project root（正規化した別名を含む）、空directory、symlink経由の参照はinputs/outputsに使いません。実際のcommand receiptのargv、件数、exit statusも検査します。これはhashによる鮮度検査で電子署名ではありません。空洞化した検査、入力範囲不足、意味の誤りは独立reviewで確認します。

`mechanism` は開発監督機構だけの検証です。ここに合格しても製品のACはPASSにしません。起動前の4モデル接続確認は `evidence/model-smoke.json` へ別途記録し、機械検証や製品品質の証拠に混ぜません。
