NATIVE_REPAIR_ORDER.md と現在の差分、実行証跡を照合します。ソースや承認状態は変更せず、必要な再現はこの volume 内の一時 fixture で行います。

外部証跡には実 ENOSPC と bounded HTTP 経路の成功記録があります。現在の fixture は公式 HTTP・中央 worker・後続 worker と実コマンド gate を使っています。次に、証跡の hash 一致と、異常終了時のロック解放・子孫回収の境界を確認します。

関連テストを再実行し、12成功・0失敗・2 skip を確認しました。外部証跡の17ソース・9実行時 hash も現在値と一致しています。追加で、worker の死後、gate の回収が終わる前に同じプロジェクトのロックを取得できるかを一時 fixture で調べます。

blocking の競合を再現しました。worker に SIGTERM／SIGKILL を送った後、同じプロジェクトの新しいロック取得が成功し、その保持中も旧 gate が書き込みを続けました。既存テストは gate の停止を待ってからロックを再取得するため、この隙間を検査していません。実装とテストの修正が必要です。

## Verdict

**変更要求：blocking 1件。`implement-controls` に戻してください。**

worker 終了後、旧 gate が書き込みを続けている間に、同じプロジェクトの実行ロックを再取得できます。ソース・レポート・承認状態は変更していません。

## Inspected source and test evidence

- `NATIVE_REPAIR_ORDER.md`、修正 recipe、容量制限 launcher、guardian/sentinel、関連テスト、指定された旧失敗原本と bootstrap を確認しました。
- `node --test --test-concurrency=1 tests/native-controls/*.test.mjs` を再実行：**終了0、12成功、0失敗、2 skip**。公式 HTTP、中央 worker、queue successor、実 CLI の競合拒否、通常連続実行、gate 回収は既存ケースで成功しました。
- 外部実試験の**17ソース・9実行時 hash は現在値と一致**。実64 MiB APFSでの ENOSPC と直接／symlink 書き込み拒否は、[operator 証跡](/private/tmp/aip-native-mlotYs/v/repo/work/native-controls/20261113/root-candidate-external-proof.json)で確認しました。証跡 SHA-256：`70e835a85eb776cc227d93588935d40df2bacbce5e017bc335477bd098e0c54b`。
- ローカルの2 skip は nested sandbox／image attach の拒否です。成功扱いしていません。レビュー後の所有 image 残留は0件でした。

## Blocking findings

**B1 / P1：worker の死亡と gate 回収の間に、実行排他が失われる。**

[patch.mjs:27](/private/tmp/aip-native-mlotYs/v/repo/scripts/native-controls/patch.mjs:27) はロック所有者を worker にしています。一方、[gate-supervisor.mjs:38](/private/tmp/aip-native-mlotYs/v/repo/scripts/native-controls/gate-supervisor.mjs:38) は worker 死亡後も TERM→100 ms猶予→KILL で回収します。その間、既存ロックの stale recovery は死亡した worker のロックを回復でき、旧 gate と新しいロック所有者の処理が重なります。

再現手順：

1. `http-fixture.mjs` と `http-gate.mjs` を私有一時 fixture にコピーし、実 runtime・公式 HTTP 経路を維持する。
2. `hold` gate に、1 ms間隔で heartbeat カウンターをファイルへ書く処理を追加する。
3. 中央 worker に SIGTERM／SIGKILL を送り、**worker の停止だけ**を待って `acquireProjectExecutionLock(project, 'run')` を呼ぶ。
4. 新しいロックの保持中にファイルを書き、20 ms前後の旧 gate の heartbeat を比較する。

実測は次のとおりです。両方とも新しいロック取得が成功しました。

| 障害 | worker PID | 旧 gate PID | 新所有者 PID | ロック保持中の旧 gate カウンター |
|---|---:|---:|---:|---:|
| SIGTERM | 48069 | 48127 | 47755 | 31 → 48 |
| SIGKILL | 48144 | 48202 | 47755 | 39 → 56 |

[再現 fixture](/private/tmp/aip-native-mlotYs/v/repo/.native-controls-runtime/review-overlap-write-AhMtpF/overlap.mjs)／[実測結果](/private/tmp/aip-native-mlotYs/v/repo/.native-controls-runtime/review-overlap-write-AhMtpF/http-result.json)。再現プロセスは終了0ですが、これは観測の完了であり、排他契約の成功ではありません。結果 SHA-256：`55c0d7f7803c568d23e982f6414ebc10433fca1b3beb62a48bc032f88d883e7b`。

既存の [http-fixture.mjs:135](/private/tmp/aip-native-mlotYs/v/repo/tests/native-controls/http-fixture.mjs:135) は全 gate の停止を待ってからロックを再取得するため、この競合を検出しません。

**戻す工程：`implement-controls`。** 既存の実プロセス識別・ロックを維持しつつ、旧 gate の回収完了まで競合実行を拒否する所有期間に修正してください。回収前の再取得拒否と、回収後の通常再取得を回帰テストに追加する必要があります。

## Limits and next implementation

non-blocking の検証限界として、外側 launcher 断後の制限継承、guardian と sentinel の同時喪失、process group を離脱した子孫、満杯のままの耐久的失敗記録は未実証です。

修正後は関連統合試験と、変更した hash に対応する bounded HTTP 外部実試験を再検証してください。本レビューは B06／ENT-201 の承認ではなく、GitHub 22件・backlog 190件の受け入れも未完了です。