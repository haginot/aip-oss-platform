# Native TAKT control implementation

## Changes

独立レビュー `review-controls.1.20261113T005758Z.md` の blocking B1を修正した。B1はworker死亡後、旧gateが書き込みを続けるTERM猶予中に、新しいproject execution lockを取得できる問題だった。レビュー原本を先頭から末尾まで確認し、再現結果を `independent-review-b1.md`、`reviewer-overlap.json` として本ディレクトリへ保持した。これは修正実装の報告であり、独立レビューの承認ではない。

今回の変更:

- `scripts/native-controls/gate-groups.mjs`を追加。既存TAKTの `getProcessIdentity`、`hasProcessIdentityMismatch`、`sameProcessIdentity` を使い、gateの実process-group leaderと開始時刻を記録する。代替identityやfixture identityは導入していない。
- `patch.mjs`は、元hash検証済みの `project-execution-lock.js` にgate groupの所有期間を追加する。既存の原子的なowner公開、fsync、rename、directory identityによる回復処理は維持する。workerの生存だけでなく登録groupの存続を確認し、groupが残る間はstale recoveryと明示的releaseの両方で排他を保持する。
- `gate-supervisor.mjs`とcommand gate修正に起動handshakeを追加。sentinel準備完了後、parentがgroup情報をowner recordへ永続化し、その後にだけstart IPCを送る。登録失敗やparent死亡でstartが届かなければユーザーcommandを起動しない。
- 通常のgate完了は登録groupが消えるまで確認してから返す。10秒以内に回収を確認できなければ診断可能な失敗を返し、排他を保持する。時間経過だけでは新規実行を許可しない。
- `run-bounded.mjs`、`tests/native-controls/helpers.mjs`、`patch.test.mjs`を更新し、修正されたlockと追加moduleも再現recipeと実行時hash検証の対象に含めた。書込み制限policyとファイル単位上限は変更していない。
- `http-gate.mjs`、`http-fixture.mjs`に1 ms間隔の実ファイルheartbeatを追加。実guardian/sentinelを一時停止して回収窓を確実に作り、worker SIGTERM、worker SIGKILL、workerとguardianのSIGKILLで回収前拒否と回収後再取得を検証する。
- `release-worker.mjs`、`lease.test.mjs`を追加。workerが生存したまま明示的releaseしてもgateが残る間は拒否し、group消滅後は古いworkerの生存に妨げられず再取得できることを実gateで検証する。
- `scripts/native-controls/README.md`に所有期間、handshake、異常時の排他保持、修正済みCLI/UIを揃えて利用する前提を追記した。

旧共有node_modulesへは書き込んでいない。元version/hashを検証したうえで、このclone内の一時配布物を作り直した。変更前receipt、旧外部成功証跡、B1再現、途中の失敗を保持した。既存sourceSnapshots、enterprise承認、歴史的証跡は書き換えていない。git add/commit/pushは実行していない。`NATIVE_REPAIR_ORDER.md`への外部再検証結果の追記はoperatorによるもの。

## Actual checks and hashes

以下の証跡名は `work/native-controls/20261113-b1/` 以下。

| コマンド・検査 | 実測 | 出典 |
| --- | --- | --- |
| 修正前配布物で `node --test --test-name-pattern='isolated process' tests/native-controls/http.test.mjs` | 終了1。回収前の再取得拒否が起きず `Missing expected exception`。新しい回帰試験がB1を検出 | `before.tap`, `before-http.json` |
| `node scripts/native-controls/patch.mjs` | 終了0。元0.71.0とhashを検証して新しい一時コピーを作成 | `runtime-receipt.json` |
| `node --test --test-concurrency=1 tests/native-controls/gates.test.mjs tests/native-controls/patch.test.mjs` | 終了0、10成功 | `gate-and-patch.tap` |
| 修正後HTTPのみの試験 | 終了0、1成功 | `after-http.tap` |
| `node --test --test-concurrency=1 tests/native-controls/*.test.mjs` | 終了0、14件中12成功、失敗0、skip 2 | `final-tests.tap` |
| その後追加した `node --test tests/native-controls/lease.test.mjs` | 終了0、1成功 | `lease.tap` |
| operator: `node tests/native-controls/external-proof.mjs OWNED_64_MIB_MOUNT COPIED_TAKT` | 終了0、`sourcesUnchanged=true`, `result.ok=true`, `escapedWrite=false` | `operator-proof.json`, `operator-exit.json` |
| 現21ソース・10実行時hashとoperator証跡の比較 | 終了0、全31件一致。コピーした外部4証跡も原本と一致 | `hash-binding.json` |
| `git diff --check` | 終了0 | 実装工程のコマンド出力 |
| `git diff --exit-code HEAD -- work/enterprise evidence .takt/workflows package.json package-lock.json` | 終了0 | 実装工程のコマンド出力 |

途中でheartbeat進行検査が失敗した実行も `heartbeat-truncation-failure.tap` と `heartbeat-failure-http.json` に保存した。heartbeatを切詰め上書きする実装を、appendしたファイルサイズで観測する実装に変更し、開始・進行を待つ条件を明示した。最終HTTPは3種類の死亡条件で通過した。

localのskip 2件はnested sandboxとengineering image内のimage attach拒否であり、成功扱いしていない。新しいhashに対応するbounded経路と総容量の根拠は、今回operatorが実行した外部64 MiB APFS試験である。B1修正前の外部成功を引き継いでいない。

今回の外部原本:
`/Users/haginota/.local/state/aip-takt-recovery/native-capacity-fixture-20261113/b1-reproof-1/proof.json`

記録時刻: `2026-11-13T01:10:19.135Z`。SHA-256:
`f54069010d8e203cc814ccef9702ac7d48218b264fbb897555eab7c6e4f76642`

主なsource SHA-256:

| ファイル | SHA-256 |
| --- | --- |
| patch.mjs | `43de59357f15e8c9271fe5404275eeb14f22f423130a58d05f9fb096e3018ce6` |
| gate-groups.mjs | `f089eaee38fb8e265f62671eb897395a0cda859afd947bb22ee05d4cc5f022bc` |
| gate-supervisor.mjs | `26180870eeba5cebef671e10e06d9b136774f40216300f51772d7e775971f133` |
| run-bounded.mjs | `119d69d0351c86639f19179333abd073fdf061bcc6e51d375fefd78ed8a45c40` |
| http-fixture.mjs | `f2d61fbc16ab2e5e31399b47bf0bc68606edb4e56d6efc73d9b5695493c1ad69` |
| http-gate.mjs | `c25535ba1aa797b75276e244ee0164b2c6d4202af4ccd810f0dd4bc2da9368a8` |

実行時SHA-256（package.json以外は `dist/` 以下）:

| ファイル | SHA-256 |
| --- | --- |
| package.json | `2542444f13be289c37675c3b50367c3dc09356dfb00cae87d08b4993e4bf630d` |
| features/web-ui/central-worker.js | `4746ee0c6c1660fd541f20d9dc34dfd1c471f5b8060d5dac54116f230e25f302` |
| features/web-ui/central-worker-spawn.js | `a4f6592c586527dec5276839feab6de4bc41aceabcb5bf151fab66f108770e44` |
| features/web-ui/launcher.js | `afa8b077f589618a96c013df24c720ed2c396a13f9b6a1773c5eb2540c8fac87` |
| features/web-ui/server.js | `4e79838e2388aba670eccba74e26ebf63d78e7b4a1edc9e57a8b634cdc1320a6` |
| infra/task/project-execution-lock.js | `1675596623facdb9a969e865d6fffeb57a16b9719d5a974176fb759905ef6376` |
| infra/task/process.js | `5965f11b4360dc71f1ed87e45c2d1a2a9fc433a7ec315e4e80e20e23dc7fd743` |
| infra/task/native-gate-groups.mjs | `f089eaee38fb8e265f62671eb897395a0cda859afd947bb22ee05d4cc5f022bc` |
| core/workflow/quality-gates/commandGateRunner.js | `f571241e8034c1b94385807dc50bcec6a47888e149810004409ab93f9cd0d75d` |
| core/workflow/quality-gates/native-gate-supervisor.mjs | `26180870eeba5cebef671e10e06d9b136774f40216300f51772d7e775971f133` |

全21ソースの値と原本コピーのhashは `hash-binding.json`、元8ファイルのpinは変更していない `scripts/native-controls/upstream.json` にある。元process identity moduleは上表のとおり未変更。

## Proven boundaries

今回のoperator試験も実 `boundedSpawn → official HTTP → central worker → command gate` を使用した。mock providerは制御fixtureに限定し、gateの結果は実コマンドから取得した。

| 障害条件 | 旧worker PID | 旧guardian PID | 拒否中の旧gate heartbeat | 結果 |
| --- | ---: | ---: | --- | --- |
| worker SIGTERM | 53237 | 53255 | 47 → 58 | run/watch取得拒否、新HTTP workerは `project_execution_conflict` |
| worker SIGKILL | 53305 | 53323 | 66 → 76 | 同上 |
| workerとguardianのSIGKILL | 53373 | 53391 | 66 → 77 | leader死亡後も生存groupにより同上 |

監視processだけを一時停止し、書き込むgateは停止していない。監視を再開した後はgroup回収を確認して再取得し、新しいlock保持中に旧heartbeatが増えないことも検査した。明示的releaseの別試験では、旧workerが生存していてもgroup消滅後は再取得できた。

初回CLI競合、queue successor競合、別projectの独立実行、実CLI run/watch拒否、正常hold→follow、command失敗、timeout、大量出力成功、guardian単独死亡の既存検査も維持した。

外部実filesystem容量は67,067,904 bytes。実gateは62,914,560 bytes書込み時点でENOSPCとなり、taskは `workflow_failed`。容量runは `20261113011016-820872df`、空き回復後の成功runは `20261113011018-36c3a5a8`。直接・symlink経由の書込み拒否を確認し、`escapedWrite=false`。実開始時刻は `darwin-start-v2:1794532207`。

外部の `operator-cleanup.json` はdetach・image削除を記録する。現在のinventoryでも所有fixture mountは0件。operatorの容量admissionはretained 20,538,261,504 bytesにengineering 805,306,368、proof 67,108,864、reserve 16,777,216を加算し、20 GiB以下を検証している。clone側の最終計測は容量805,265,408 bytes、空き185,249,792 bytes。modelによる外部volumeへの書込みは行っていない。

## Remaining work

B1修正の独立再レビューが必要。上記31件のhashと保持したbefore/after・operator証跡に結び付けて確認すること。旧17ソース・9実行時hashの成功は今回の修正承認ではない。

CLI run/watchとUIは、同じ修正済み配布物を使用する必要がある。未修正CLIは追加group所有フィールドを理解しないため、修正前後の配布物を混在させた排他は保証しない。

自らprocess group/sessionを離脱した子孫、guardianとsentinelを同時に失った場合の自動回収、OS障害、Windows、実PID再利用を意図的に起こす試験、外側launcher断後の制限継承は未実証。停止したgroupや回収不能なgroupを時間だけで解放しないため、その場合は排他を保持したままとなる。100 msはTERM猶予であり、実行再許可までの期限ではない。

総容量境界は専用mountを途中でresize/replaceせずnested mountを追加しない前提。満杯のままの耐久的terminal記録は保証せず、空き回復とreconcileが必要。実証は64 MiBであり20 GiBを埋める試験ではない。実providerの認証・製品機能、ネットワーク/読取り隔離は対象外。

GitHub22件とbacklog190件の正式実装・実テスト・独立レビューは引き続き必要。本工程はENT-201、B00〜B06、全issueの受け入れを宣言せず、旧B00〜B04承認も引き継がない。
