# Independent native control review

## Verdict

**本変更のengineering reviewを承認する。blocking findingは0件。B1・B2の解消を確認した。**

承認対象は、検証済みhashの修正版配布物をCLI/UIで統一し、専用容量制限volumeとbounded launcherを使用する実行制御である。ENT-201、B00〜B06、全issueの受け入れ承認ではない。

レビュー中にソース・既存レポート・承認状態は変更していない。本レポートは提供済みのレビュー結果とコマンド出力に基づく。

## Inspected source and test evidence

`NATIVE_REPAIR_ORDER.md`、修正recipe、生成後のproject execution lock、group登録とguardian/sentinel、容量制限launcher、回帰テスト、保持された失敗ログ、最新operator証跡を照合した。

| 検査 | 結果 |
|---|---|
| `node --test --test-concurrency=1 tests/native-controls/*.test.mjs` | **終了0、18件中16成功・0失敗・2 skip** |
| 公式HTTP→中央worker→実gate、queue successor、実CLI競合、別project、通常連続実行 | 成功 |
| B1：worker SIGTERM／SIGKILL／worker＋guardian SIGKILL | 回収中の競合拒否、回収後の再取得を確認 |
| B2：古いsnapshotを保持するrun／watch／owner照会 | 更新後の記録を保持し、回収後に再取得 |
| 明示的release | gate存続中の排他保持と、回収後の再取得を確認 |
| 独立追加試験：group登録書き込みを拒否 | EACCESでgate失敗、実行markerなし。検証コマンド終了0 |
| 最新外部証跡とのhash照合 | **24ソース・10実行時hash一致**。レビュー終了時も変更なし |
| `git diff --check`、保護対象のHEAD比較 | 終了0 |
| レビュー後の所有image残留 | 0件 |

ローカルの2 skipはnested sandboxとimage attachの拒否であり、成功扱いしていない。

[最新operator証跡](/private/tmp/aip-native-mlotYs/v/repo/work/native-controls/20261113-b2/operator-proof.json)は2026-11-13T01:30:38.287Z、終了0。容量67,067,904 bytesの実APFS上で62,914,560 bytes書き込み時にENOSPCとなり、その後の回復実行が成功している。直接／symlink経由の書き込み拒否も確認されている。

総容量はfilesystemで拘束される。du監視や単一ファイルのEFBIGを総容量の証明としていない。

外部証跡SHA-256：

`cbc09e97eee352bbe632760fa62148057fe27b38626c5d6e77c9158c0413b943`

主要な承認対象hash：

| 対象 | SHA-256 |
|---|---|
| `scripts/native-controls/patch.mjs` | `620f5753544da6b826161a7156cac94d463caba28e76b0a898686ad94f48b30a` |
| runtime `project-execution-lock.js` | `c7e68563b3d42e46742c3209fd6f2dd3805595b5eec5854ac6be6f2d8d5bc656` |
| runtime `native-gate-groups.mjs` | `f089eaee38fb8e265f62671eb897395a0cda859afd947bb22ee05d4cc5f022bc` |
| runtime `commandGateRunner.js` | `f571241e8034c1b94385807dc50bcec6a47888e149810004409ab93f9cd0d75d` |

元TAKT 0.71.0のversion/hash検証は成功した。著作ソース・テスト・保持証跡はignore対象ではなく、使い捨て配布物と一時fixtureはignore対象である。旧hashの成功や旧B00〜B04の承認は引き継いでいない。

## Blocking findings

**なし。**

B1は、gate起動許可前の実group登録と、worker死亡後も登録groupを確認する排他によって対処されている。正常完了・明示的release・異常終了の回帰試験が通過した。

B2は、[patch.mjs:102](/private/tmp/aip-native-mlotYs/v/repo/scripts/native-controls/patch.mjs:102)で非稼働判定後にowner記録を再読し、revisionを含む内容とdirectory identityが一致した場合だけ回復を進める。変更を検出した場合は再判定する。終了済みownerの再更新も拒否するため、前回の古いsnapshotによる削除経路を閉じている。

今回の再実行結果：

| 経路 | 旧gate heartbeat | 回収中の結果 | 回収後 |
|---|---:|---|---|
| run | 46 → 65 | 取得拒否 | 再取得成功 |
| watch | 57 → 78 | 取得拒否 | 再取得成功 |
| owner照会 | 42 → 62 | 新revisionとgroupを持つownerを保持 | 再取得成功 |

証拠：[run](/private/tmp/aip-native-mlotYs/v/repo/.native-controls-runtime/snapshot-run-yjwq3K/evidence.json)、[watch](/private/tmp/aip-native-mlotYs/v/repo/.native-controls-runtime/snapshot-watch-fWb7At/evidence.json)、[owner照会](/private/tmp/aip-native-mlotYs/v/repo/.native-controls-runtime/snapshot-inspect-AmaN0l/evidence.json)。

回帰試験は実owner descriptorから読み取ったbytesを変更せず、返却前に待機して競合順序を固定する。identity、配布物、gate結果は置き換えていない。

追加の[登録拒否試験](/private/tmp/aip-native-mlotYs/v/repo/.native-controls-runtime/review-registration-refusal-tR62W5/result.json)では、私有lock directoryを書き込み不可にして実gate APIを呼び出した。登録がEACCESとなり、gateはexitCode 1で失敗し、実行markerは作成されなかった。結果SHA-256：

`5f0dd17b1c0501d11cbb8b126d80b42a58d9e93cc9d2fe46c8f270e5c20b95c1`

修正前のB2三ケースの失敗と、配布物コピー完了前に試験を開始した実行ミスは保存されている。検査を弱めて通過させた形跡は確認していない。

## Limits and next implementation

以下はnon-blockingの保証範囲・未実証点として残る。

- 同一projectのCLI/UIは同じ修正版を使用する。未修正版との混在は保証対象外。
- 専用mountを実行中にresize・交換せず、nested mountを追加しないことが容量境界の前提。
- 実PID再利用、外側launcher死亡後の制限継承、guardianとsentinel同時喪失時の自動回収、group/sessionを離脱した子孫、OS障害・Windowsは未実証または対象外。
- 回収不能な生存groupは排他を保持する。時間経過だけでは再取得を許可しない。
- 満杯のままの耐久的失敗記録は未実証。容量fixtureはfillを削除して記録領域を回復している。
- 実容量試験は64 MiB級。20 GiBまで書き込む試験は実施していない。

本変更について実装工程への差し戻しは不要。ソース・runtimeを変更した場合は対応する再検証が必要である。

GitHub 22件・backlog 190件の正式実装、実テスト、独立レビュー、およびENT-201受け入れは引き続き未完了。