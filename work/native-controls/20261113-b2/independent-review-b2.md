B1修正後のソース、回帰テスト、外部証跡を読み直します。特に、gate起動前の登録とworker死亡後のロック回復が競合せず、回収完了まで排他を維持できるかを確認します。

B1修正後の21ソース・10実行時 hash は、新しい外部証跡と一致しました。実装はgate起動許可の前にgroup所有情報を保存し、worker死亡後もgroupが残る間はロック回復を拒否します。既存の回帰試験に加え、登録前にworkerが死亡した場合にコマンドが起動しないことも確認します。

通常のB1回帰試験は通過しましたが、別のTOCTOU競合を再現しました。競合側がgroup登録前のowner記録を読んだ後にworkerがgroupを登録して死亡すると、競合側は古い記録を使って新しい記録を削除し、旧gateが書き込んでいる間にロックを取得できました。実identity・実gateを使い、読み取り後の実行順序だけを一時fixtureで固定した再現です。

# Independent native control review

## Verdict

**変更要求：blocking 1件。`implement-controls` に戻す。**

B1の既存回帰ケースは通過した。しかし、group登録前の古いowner記録を保持した競合者が、登録後の記録を削除してロックを取得できるTOCTOUを再現した。旧gateの書き込み中に新しい所有者が成立するため、実行排他の修正は未完了。

ソース・レポート・承認状態は変更していない。追加再現は私有一時fixtureのみで実施した。

## Inspected source and test evidence

修正recipe、`gate-groups.mjs`、guardian/sentinel、生成後のproject execution lock、容量制限launcher、関連テスト、失敗ログ、新しいoperator証跡を照合した。

| 検査 | 結果 |
|---|---|
| `node --test --test-concurrency=1 tests/native-controls/*.test.mjs` | 終了0。15件中13成功、0失敗、2 skip |
| B1回帰：worker SIGTERM／SIGKILL／worker＋guardian SIGKILL | 登録済みgroupが残る間の取得拒否、回収後の再取得を確認 |
| 明示的release | gate存続中の拒否と、回収後の再取得を確認 |
| 公式HTTP、中央worker、queue successor、実CLI競合、別project、通常後続処理 | 既存ケースで成功 |
| 現在値と新operator証跡のhash照合 | 21ソース・10実行時hashが一致 |
| 外部4証跡とclone内コピー | 一致 |
| レビュー後の所有image・追加再現の観測process残留 | いずれも0件 |

ローカルの2 skipはnested sandboxとimage attachの拒否であり、成功扱いしていない。

[新operator証跡](/private/tmp/aip-native-mlotYs/v/repo/work/native-controls/20261113-b1/operator-proof.json)は2026-11-13T01:10:19.135Z、終了0。実APFS容量67,067,904 bytes、62,914,560 bytes書き込み時のENOSPC、回復実行、直接／symlink書き込み拒否を記録している。SHA-256：

`f54069010d8e203cc814ccef9702ac7d48218b264fbb897555eab7c6e4f76642`

主要な現在の実行時hash：

| ファイル | SHA-256 |
|---|---|
| `project-execution-lock.js` | `1675596623facdb9a969e865d6fffeb57a16b9719d5a974176fb759905ef6376` |
| `native-gate-groups.mjs` | `f089eaee38fb8e265f62671eb897395a0cda859afd947bb22ee05d4cc5f022bc` |
| `commandGateRunner.js` | `f571241e8034c1b94385807dc50bcec6a47888e149810004409ab93f9cd0d75d` |

修正前の`Missing expected exception`と途中のheartbeat検査失敗は保持されている。旧hashの外部成功を今回の承認根拠に流用していない。

## Blocking findings

### B2 / P1：古いowner snapshotによる回復が、後から登録された生存gateの所有記録を削除する

[patch.mjs:94](/private/tmp/aip-native-mlotYs/v/repo/scripts/native-controls/patch.mjs:94)は回復判定を`isExecutionOwnerActive(owner)`へ変更する。しかし、[gate-groups.mjs:29](/private/tmp/aip-native-mlotYs/v/repo/scripts/native-controls/gate-groups.mjs:29)が参照する`gateGroups`は、先に読み込んだsnapshotの内容である。

生成後の[project-execution-lock.js:169](/private/tmp/aip-native-mlotYs/v/repo/.native-controls-runtime/takt/dist/infra/task/project-execution-lock.js:169)は、そのsnapshotで非稼働と判定すると`removeOwner`を呼ぶ。削除時にはdirectoryのdev/inoを確認するが、同じownerIdの記録がgroup登録によって更新されたことを検出しない。group登録は同じdirectory・同じownerファイル名へのrenameなので、この確認を通過する。

**再現手順**

1. 私有projectで、修正済みの実`acquireProjectExecutionLock`をworkerが取得する。
2. 別の競合processで同じロックを取得させ、group未登録のowner記録を読み終えた直後に停止する。
3. workerで実`runCommandQualityGate`を開始する。永続owner記録に実guardianのidentityが登録されたことと、gateのheartbeat書き込みを確認する。
4. guardian/sentinelだけをSIGSTOPし、workerをSIGKILLする。
5. 競合processを再開し、ロック取得結果と旧gateのheartbeatを確認する。

競合processの停止位置は、私有fixture内の`fs.readFileSync`ラッパーと`syncBuiltinESMExports()`で固定した。ラッパーは実際に読んだbytesを変更せず、返却前に待機するだけである。配布物、identity関数、gate結果は置き換えていない。

**実測**

| 項目 | 値 |
|---|---|
| worker PID | 55859 |
| guardian／sentinel PID | 55865／55866 |
| 実gate PID | 55868 |
| 競合process PID | 55862 |
| 古いsnapshot | `gateGroups`なし |
| worker死亡前の永続記録 | guardian 55865の実identityを登録済み |
| 競合processの取得結果 | `acquired: true` |
| 新ロック保持中の旧heartbeat | 53 → 73 |
| 再現結果 | `overlap: true` |

[worker fixture](/private/tmp/aip-native-mlotYs/v/repo/.native-controls-runtime/review-stale-snapshot-fjvOpD/worker.mjs)、[競合fixture](/private/tmp/aip-native-mlotYs/v/repo/.native-controls-runtime/review-stale-snapshot-fjvOpD/contender.mjs)、[実測結果](/private/tmp/aip-native-mlotYs/v/repo/.native-controls-runtime/review-stale-snapshot-fjvOpD/result.json)を保持した。再現コマンドは終了0。これは観測・後処理の完了であり、排他契約の成功ではない。

実測結果SHA-256：

`3b3a70be3c9d61b03cd3774a2f87fb99613912033a6e619458e78b64b6c1521b`

現在のHTTP回帰試験は、group登録・worker死亡後に競合取得を開始する。このため、登録前のsnapshotを保持する競合者を検査していない。

**戻す工程：`implement-controls`。** group登録によるowner更新とstale回復を整合させ、古いsnapshotが新しい所有記録を削除できないよう修正すること。上記の実行順序を回帰試験に加え、回収中の拒否と回収後の正常取得を確認する必要がある。

## Limits and next implementation

non-blockingの検証限界として、実PID再利用、外側launcher断後の制限継承、guardianとsentinel同時喪失時の自動回収、groupを離脱した子孫、満杯のままの耐久的失敗記録は未実証。修正済み／未修正CLIの混在も保証対象外と明記されている。

B2修正後、関連統合試験と変更後hashに対応するbounded HTTP外部実試験を再実行し、独立レビューへ戻すこと。

本レビューはB06／ENT-201の承認ではない。GitHub 22件・backlog 190件の正式実装、実テスト、独立レビュー、受け入れは未完了。