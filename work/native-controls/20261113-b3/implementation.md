# Native TAKT control implementation

## Changes

B3のfixture修正を実装した。実装ステップの報告であり、独立レビューの承認ではない。

- `tests/native-controls/volume.mjs:11`：checkoutの実mountを確認し、正の容量・20 GiB以下・空き8 MiB以上の場合だけ再利用する。`/`、大容量、空き容量不足のfilesystemは再利用せず、既存の実hdiutil経路で専用64 MiB APFS imageを作る。
- `tests/native-controls/http.test.mjs:25`：新fixtureを使い、専用imageではmount内のprivate write rootから実boundedSpawnを実行する。結果とlogはdetach前にmount外へ保存する。sandbox拒否のskip判定もcleanup完了後に行う。
- `tests/native-controls/volume.mjs:39`：callback失敗時もdetachする。attach途中失敗では所有imageだけをinventoryから探して回収する。detach／inventory確認失敗ではimageを保持して失敗を返す。元の失敗とcleanup失敗を残し、環境skipに変換しない。`volume-lifecycle.json`に段階、実stderr、cleanup結果を記録する。
- `tests/native-controls/volume.test.mjs`：8件の明示的なsimulated lifecycleテストと1件の実image failure-pathテストを追加した。host-root選択、private root、既存mount再利用、callback拒否、partial attach、detach失敗、inventory失敗、容量／device不一致を確認する。simulationは実confinement、identity、provider、ENOSPCの証明に使わない。
- `scripts/native-controls/README.md`：B3経路、回収失敗時の扱い、通常hostでの再実行と未実証範囲を記載した。

変更した既存sourceはREADMEとfixture 2ファイルのみ、新規sourceはfixtureテスト1ファイル。product runtime、patch recipe、boundedSpawnの拒否条件、実ENOSPC gate、B1/B2回帰コードは変更していない。

## Actual checks and hashes

証跡root：`work/native-controls/20261113-b3/`。Node v22.23.3、darwin。今回のcheckoutは`/private/tmp/aip-native-9KxfTm/v`の容量805,265,408 bytesのmount内にある。

| 実行／証跡 | 結果 |
| --- | --- |
| 提供済み`operator-before.json` | 通常hostの旧candidate：18件、17 pass、1 fail、0 skip。bounded routeが`Writable root must be on bounded volume`で失敗。内容とhashを保持した。元hostの完全なTAPは今回提供されていない。 |
| `mise exec -- node --test --test-concurrency=1 tests/native-controls/*.test.mjs` / `engineering-before.tap` | 終了1。checkoutのmise.tomlがuntrustedのためテスト開始前に停止。hostのtrust設定は変更していない。 |
| `node --test --test-concurrency=1 tests/native-controls/*.test.mjs` / `engineering-before-node.tap` | 変更前：終了0、18件、16 pass、0 fail、2 skip。 |
| `node --test --test-concurrency=1 tests/native-controls/http.test.mjs` / `http-after.tap` | 終了0、1 pass、0 fail、2 skip。 |
| `node --test --test-concurrency=1 tests/native-controls/volume.test.mjs` / `volume-after.tap` | 初回終了1、7 pass、1 fail、1 skip。新規unitテストの疑似root device設定の誤り。失敗記録を保存した。 |
| 同上 / `volume-after-corrected.tap` | 疑似root device設定修正後：終了0、8 pass、0 fail、1 skip。 |
| 全suite / `engineering-after.tap` | 終了0、27件、24 pass、0 fail、3 skip。最終indent修正前の中間記録。 |
| 全suite / `engineering-final.tap` | **終了0、27件、24 pass、0 fail、3 skip、0 cancelled。** 最終candidateで実施。 |
| `verification.json` | 最終実行前後の26 source hash（order 1＋native source 25）一致、実runtime 10 hash一致。所有image残留0、backing image残留0。 |
| `git diff --check` | 終了0。新規テストとB3証跡はignore対象外。 |

一度試みたPython here-documentによるindent整形は、shellの一時ファイル作成が`operation not permitted`となり実行されなかった。apply_patchで整形を実施し、その後に最終suiteを実行した。

`candidate.json`が最終source/runtime manifest。`candidate-intermediate.json`は中間状態であり最終candidateの証明には使わない。実行結果JSONと環境拒否の実stderrは`artifacts/`へコピーし、`artifact-index.json`に元の場所・対応TAP・SHA-256を保存した。

| 対象 | SHA-256 |
| --- | --- |
| `tests/native-controls/http.test.mjs` | `42c3a8c60b725b0b29efeafee674cbea95b060bc7ef669271518634861c24779` |
| `tests/native-controls/volume.mjs` | `91522fbbc515a55f0a9595ad586aeb37d19b0e72bac5a3d29cd9299da0954dc5` |
| `tests/native-controls/volume.test.mjs` | `02f09a7b7918ec080f0f7ab69b0d2ebf49139eb6c28cf7c6978658f874df7594` |
| `scripts/native-controls/README.md` | `f5984ca282349c474ded8d79978a1fd95f208306e46ffb7602d93b21558e10ff` |
| `candidate.json` | `5572c7e88330c8b6767b6d252b3ffbbef76dea34cf1f14c6265404283879704f` |
| `engineering-final.tap` | `ab8755ada39b539c0fa83428b781292753992d97a6334d19f8929219b8ea5f78` |
| `verification.json` | `bc609a1edfe77971c5da8a8a01ed5e8f279f0d95177063cf44344df220764174` |
| runtime `project-execution-lock.js` | `c7e68563b3d42e46742c3209fd6f2dd3805595b5eec5854ac6be6f2d8d5bc656` |
| runtime `commandGateRunner.js` | `f571241e8034c1b94385807dc50bcec6a47888e149810004409ab93f9cd0d75d` |

保護対象は開始時から不変：`evidence/generated/release/adapter-trace.json` = `7cdc30620fd3f6cf62d50b31761409aa2350c7c81d74c083d229caf4c653aee6`、`evidence/model-smoke.json` = `dce2d7cb780ef7ea704b468e58fdb9801fbbbe68afb2854427cc48c5e01b2c52`。提供された`operator-before.json` = `a23a6c336a498703a10480edd995d2c963070546a94ca3e85c7104eba2c9f7e1`も不変。

## Proven boundaries

実HTTP→central worker→gate、CLI競合、queue successor、project分離、B1のcleanup中排他、B2の古いsnapshotによるrun/watch/owner照会、明示release、実process-group回収の回帰suiteは通過した。最終JSONは`artifacts/http-native-2fE4zD-evidence.json`と`artifacts/snapshot-{run-LSwI41,watch-Xyapcg,inspect-9PKgPe}-evidence.json`に保持した。

本環境のbounded routeは実sandbox-execがexit 71、`sandbox_apply: Operation not permitted`を返し、fixture結果は生成されなかった。`artifacts/http-bounded-UJBRkt-evidence.json`に保存した。容量試験と実failure-path detach試験は実hdiutil attachが`アクセス権がありません`で拒否され、回収確認後にskipした。対応する`volume-ADnivo`／`volume-rPaybK`のlifecycle JSONを保持した。これら3件は成功ではなくUNPROVEN。

EFBIGの実gateテストは通過したが、aggregate ENOSPCの代替証明にはしていない。既存のENOSPC assertionは維持した。通常hostでの新規image作成→bounded HTTP→detach成功、および実callback失敗後のdetach成功は今回の環境では未実証。unitの注入試験はその代替ではない。

## Remaining work

1. 次の`review-controls`ステップで、別sessionのreviewerがsourceをread-onlyで読み、実装・失敗試行・最終hash・証跡を独立確認する。本実装sessionは独立承認を発行していない。
2. operatorがこの最終candidateをenclosing mount外の通常macOS hostで、`mise exec -- node --test --test-concurrency=1 tests/native-controls/*.test.mjs`により再実行する。**0 failure・0 skipは未確認**。出力、source/runtime hash、所有image残留確認をB3証跡へ追加する。
3. 本報告はengineering scopeのみ。ENT-201、B00–B06、212 issue全体の正式受け入れ、実provider結果／model tierの認証を主張しない。過去のB2承認・外部ENOSPC結果を今回candidateの承認として引き継がない。

commit、push、staging、frozen workflow、auth、共有依存の変更は行っていない。
