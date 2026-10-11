# Verification plan

`plan.json` は製品検証の実行入口です。各suiteは一意なID、stage、argv形式のcommands、明示的なinputs、必要ならoutputs、timeoutを持ちます。

実装が進んだら、少なくとも `implementation`、`demo`、`bcp`、`release` のsuiteを追加します。unit testだけをdemoやBCPの証拠に流用せず、E2E、negative path、failure injection、restore、clean bootstrapをそれぞれ実行します。

```sh
node scripts/platform-control.mjs run-stage implementation
node scripts/platform-control.mjs validate implementation
```

成功receiptは `evidence/run-manifest.json` に記録されます。suite定義、入力、出力のいずれかが変わると古いreceiptは無効です。
