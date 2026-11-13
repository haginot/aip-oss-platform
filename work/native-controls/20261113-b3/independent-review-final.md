# Independent native control review

## Verdict

**B3 fixture修正のengineering reviewを承認。Blocking findingは0件。**

承認は確認したfixture修正と回帰検証の範囲に限る。通常ホストでの0失敗・0 skipは未確認であり、ENT-201、B00–B06、212 issues全体の正式受け入れではない。

独立レビュー中の書き込みは私有テストfixtureに限定し、ソース・レポート・承認状態は変更していない。本レポートは提供済みのレビュー結果と記録済みコマンド出力に基づく。

## Inspected source and test evidence

[NATIVE_REPAIR_ORDER.md](/private/tmp/aip-native-9KxfTm/v/repo/NATIVE_REPAIR_ORDER.md)、README、B2レビュー、B3の差分・失敗ログ・receipt・実runtimeを照合した。

| 独立検証 | 結果 |
|---|---|
| `node --test --test-concurrency=1 tests/native-controls/*.test.mjs` | Node 22.23.3、終了0、**27件：24成功・0失敗・3 skip** |
| `mise exec -- node --test --test-concurrency=1 tests/native-controls/*.test.mjs` | 終了1。`mise.toml`未信頼によりテスト開始前に停止 |
| candidateと実ファイルの照合 | **26 source・10 runtime hash一致** |
| 保存証跡の照合 | checksum 42件、保護対象3件、artifactと元ファイル27組が一致 |
| 所有image／backing image残留 | 0件 |
| `git diff --check`、保護証跡のHEAD比較 | 差異なし |

変更はREADME、既存fixture 2ファイル、新規fixtureテスト1ファイルに限定されている。product runtime、boundedSpawnの拒否条件、B1/B2回帰、実ENOSPC assertionは変更されていない。

[volume.mjs:11](/private/tmp/aip-native-9KxfTm/v/repo/tests/native-controls/volume.mjs:11)は`/`、過大容量、空き容量不足を再利用対象から除外し、所有64 MiB imageへ分岐する。[http.test.mjs:25](/private/tmp/aip-native-9KxfTm/v/repo/tests/native-controls/http.test.mjs:25)はmount内のwrite rootを使用し、detach前に結果とlogを保存する。callback失敗でもcleanupへ進み、detach／inventory失敗は環境skipにならない。

追加された8件のsimulationはmount選択とlifecycleの故障経路を検証する。実imageを使うcallback失敗後のdetach試験は、attachの環境拒否でskipした。simulationを実mount・confinement・ENOSPCの証明として扱っていない。初回unit試験の失敗ログも保持されている。

[独立再実行のHTTP証跡](/private/tmp/aip-native-9KxfTm/v/repo/.native-controls-runtime/http-native-OlF45m/evidence.json)で、公式HTTP→実worker→gate、queue successor、CLI run/watch競合、別project実行、正常連続実行を確認した。providerは明示的なmockであり、実provider成功の証明ではない。

B1のworker SIGTERM／SIGKILL／worker＋guardian SIGKILLでは、旧gateのheartbeat増加中に競合を拒否し、回収後に再取得した。B2の古いsnapshot試験も通過した。

| B2経路 | heartbeat | 結果 |
|---|---:|---|
| run | 42→63 | 取得拒否、回収後再取得 |
| watch | 42→62 | 取得拒否、回収後再取得 |
| owner照会 | 57→77 | 新revisionとgroupを保持、回収後再取得 |

追加の[登録拒否試験](/private/tmp/aip-native-9KxfTm/v/repo/.native-controls-runtime/review-registration-refusal-EKsr0X/result.json)では、私有lock directoryを`0500`にして実gate APIを呼び出した。group登録はEACCES、gateはexitCode 1、実行markerなし。検証コマンドは終了0だった。

承認対象の主要SHA-256：

| 対象 | SHA-256 |
|---|---|
| `tests/native-controls/volume.mjs` | `91522fbbc515a55f0a9595ad586aeb37d19b0e72bac5a3d29cd9299da0954dc5` |
| `tests/native-controls/http.test.mjs` | `42c3a8c60b725b0b29efeafee674cbea95b060bc7ef669271518634861c24779` |
| `tests/native-controls/volume.test.mjs` | `02f09a7b7918ec080f0f7ab69b0d2ebf49139eb6c28cf7c6978658f874df7594` |
| [candidate.json](/private/tmp/aip-native-9KxfTm/v/repo/work/native-controls/20261113-b3/candidate.json) | `5572c7e88330c8b6767b6d252b3ffbbef76dea34cf1f14c6265404283879704f` |

## Blocking findings

**なし。確認した実装について、implement-controlsへの差し戻しは不要。**

旧通常ホストでの「18件中17成功・1失敗・0 skip」は[operator-before.json](/private/tmp/aip-native-9KxfTm/v/repo/work/native-controls/20261113-b3/operator-before.json)として保持されている。失敗はbounded-route fixtureが`/`まで探索し、boundedSpawnの`Writable root must be on bounded volume`拒否に達するものだった。ただし元ホストの完全なTAPは未提供であり、旧障害を独立再現済みとは扱わない。

## Limits and next implementation

以下は今回のengineering承認に対するnon-blockingの限界である。

- **通常ホスト検証は未完了。** 3 skipはnested sandbox拒否、容量試験のimage attach拒否、callback失敗時detach試験のimage attach拒否。所有mountの正常利用と実callback失敗後detachは未実証。
- 総容量境界はfilesystemによるhard capであり、pollingや単一ファイルのEFBIGではない。今回の環境では実aggregate ENOSPCは未実証。過去の成功を現在candidateの成功として引き継がない。
- bootstrapは専用mount、修正版配布物、私有設定の事前準備を要する。product launcherはmount作成や認証情報の準備を行わない。実model／service tierの成立は未確認。
- 未修正版との混在、groupを離脱した子孫、guardianとsentinelの同時喪失、実PID再利用、launcher死亡後の制限継承は今回の実証範囲外。
- 回収不能なgroupは排他を保持する。時間経過だけで再取得を許可しない。満杯状態での耐久的記録は保証せず、容量fixtureはfillを削除して記録領域を回復する。

次工程は、operatorが現在のcandidateを通常macOSホストで次のコマンドにより実行し、**0失敗・0 skip、source/runtime hash、所有image残留確認**をB3証跡へ追加すること。

```sh
mise exec -- node --test --test-concurrency=1 tests/native-controls/*.test.mjs
```