# Native TAKT control implementation

## Changes

独立レビュー B2 / P1（古いowner snapshotによる回復が、新しく登録された生存gateの記録を削除するTOCTOU）を修正し、独立再レビューへ引き渡す。承認は未取得。

今回変更したソース／テストは以下の5ファイル。

- `scripts/native-controls/patch.mjs`：TAKT 0.71.0の既存project execution lockに、非稼働確認後の再読・revision比較を追加。取得時のstale recoveryと`getProjectExecutionOwner`の両方で使用する。
- `scripts/native-controls/README.md`：B2の原因、確認順序、回帰試験を記述。
- `tests/native-controls/snapshot.test.mjs`：run／watch／owner照会の3ケースを追加。
- `tests/native-controls/snapshot-worker.mjs`：実ロックを取得し、合図の後に実command gateを開始するfixture。
- `tests/native-controls/snapshot-contender.mjs`：実owner descriptorから読んだbytesを変更せず、返却前に待機してレビューの順序を固定するfixture。

各owner公開には新しいrevision UUIDを付ける。非稼働と判定した後に記録を再読し、完全なowner内容とdirectoryのdev/inoが一致する場合だけ削除へ進む。変化した場合は再観測し、再試行上限では診断可能な失敗としてロックを保持する。単に生存確認の前に再読する方式ではない。非稼働確認後の同一revisionは、死亡したownerまたは更新禁止となった終了済みownerの記録であり、後続gateを公開できないことを根拠とする。`executionFinished`公開後の更新も拒否する。

既存の原子的なowner公開、directory識別、TAKTの実process identityを維持した。修正はversionと元ファイルhashを確認するrecipeでclone内の配布物へ適用した。共有node_modules、既存sourceSnapshots／承認、enterprise資料を変更していない。git add／commit／pushは行っていない。

今回の証拠は `work/native-controls/20261113-b2/` に保持する。B1以前の成功・失敗記録は上書きせず、旧hashの成功を今回の成功根拠に流用しない。

## Actual checks and hashes

| コマンド／検査 | 終了・結果 | 証拠 |
|---|---|---|
| `node --test --test-concurrency=1 tests/native-controls/snapshot.test.mjs`（修正前） | 終了1、3失敗。run/watchが取得成功し、照会は生存gateのownerを削除 | `before.tap`、`before-run.json`、`before-watch.json`、`before-inspect.json` |
| `prepare()` from `scripts/native-controls/patch.mjs`（Nodeから呼出し） | 終了0。実体と非symlinkを確認した使い捨てコピーだけを削除・再生成、共有元hashを検証 | `previous-runtime-receipt.json`、`runtime-receipt.json` |
| `node --test --test-concurrency=1 tests/native-controls/snapshot.test.mjs tests/native-controls/lease.test.mjs` | 終了0、4成功 | `after-snapshot.tap` |
| `node --test --test-concurrency=1 tests/native-controls/*.test.mjs` | 終了0、18件中16成功・0失敗・2 skip | `final-tests.tap` |
| operator: `node tests/native-controls/external-proof.mjs OWNED_64_MIB_MOUNT COPIED_TAKT` | 終了0、`sourcesUnchanged=true`、`result.ok=true`、`escapedWrite=false` | `operator-proof.json`、`operator-exit.json` |
| `git diff --check` | 終了0 | 実行記録 |
| `git diff --exit-code HEAD -- work/enterprise evidence .takt/workflows package.json package-lock.json` | 終了0 | `local-verification.json` |
| 著作ソースと保持証拠の`git check-ignore` | 終了1、該当なし | `local-verification.json` |
| 現在ソース／runtimeと外部証拠のhash照合、元配布物検証 | 終了0、24ソース・10実行時hash一致 | `hash-binding.json` |

準備時の失敗も区別して残した。最初のheredocコマンドは一時ファイル作成が外側制限に拒否され、終了1で準備コードは未実行。その後、コピー処理の完了前に試験を開始してしまい、`package.json`不在の4失敗となった。この実行ミスは`premature-runtime-test.tap`へ保存し、コピー完了（終了0）を待って上記4成功を得た。

ローカルの2 skipは、nested sandboxの`Operation not permitted`と実image attachの権限拒否。成功扱いしていない。`local-confinement-refusal.json`と全体TAPに記録し、所有image残留なしを確認した。1 MiBのEFBIG補助試験も成功したが、総容量の証明とは区別する。

B2の実測：

| 経路 | worker PID | 旧gate heartbeat | 結果 |
|---|---:|---:|---|
| run | 58145 | 43 → 67 | 古いsnapshotによる取得を拒否、回収後に取得成功 |
| watch | 58176 | 38 → 57 | 古いsnapshotによる取得を拒否、回収後に取得成功 |
| owner照会 | 58206 | 41 → 61 | 新しいrevisionと生存groupを持つownerを返し、記録を維持。回収後に取得成功 |

根拠は`after-run.json`、`after-watch.json`、`after-inspect.json`。guardian/sentinelのみをSIGSTOPし、workerをSIGKILLした後も実gateは書き込みを続ける。fixtureはdescriptor bytesの返却順序のみを変え、identity・配布物・gate結果を置き換えていない。独立レビューの元再現も`reviewer-result.json`へ保持した（SHA-256 `3b3a70be3c9d61b03cd3774a2f87fb99613912033a6e619458e78b64b6c1521b`）。

新しい外部証拠は2026-11-13T01:30:38.287Z。容量67,067,904 bytesの実APFSで62,914,560 bytes書き込んだ時点でENOSPCとなり、capacity taskは`workflow_failed`、容量解放後のrecovery-controlは完了。直接／symlink書き込み拒否、実CLI競合、中央worker／後続worker、別project、通常連続実行、B1の3異常終了ケースも成功している。

- capacity run: `20261113013036-6eb0101d`
- recovery run: `20261113013037-4a014b45`
- process identity: `darwin-start-v2:1794533427`
- `operator-cleanup.json`：detach・image削除ともtrue。現在のhdiutil情報でも所有fixtureの残留mountなし。
- `operator-capacity-admission.json`：履歴・engineering予約・proof予約・reserve合計21,427,478,528 bytes、上限21,474,836,480 bytes未満。
- ローカルの所有image／試験process残留も検査時0件。

外部証拠のSHA-256：

| ファイル | SHA-256 |
|---|---|
| `operator-proof.json` | `cbc09e97eee352bbe632760fa62148057fe27b38626c5d6e77c9158c0413b943` |
| `operator-exit.json` | `b1da0f8208c94f081446a9d3afd8a476afdc17ae91573230a0aaf057ce907651` |
| `operator-cleanup.json` | `1205cce610f33ddc553874ffe3c2a386e139d388d637fb36559a8b07fe9550f1` |
| `operator-capacity-admission.json` | `17225dcc9632750bcbf1fa259d61fe17c68b2462103236f987c5ef467180ede2` |

現在の実行時SHA-256（コピー配布物を基準とする）：

| ファイル | SHA-256 |
|---|---|
| `package.json` | `2542444f13be289c37675c3b50367c3dc09356dfb00cae87d08b4993e4bf630d` |
| `dist/features/web-ui/central-worker.js` | `4746ee0c6c1660fd541f20d9dc34dfd1c471f5b8060d5dac54116f230e25f302` |
| `dist/features/web-ui/central-worker-spawn.js` | `a4f6592c586527dec5276839feab6de4bc41aceabcb5bf151fab66f108770e44` |
| `dist/features/web-ui/launcher.js` | `afa8b077f589618a96c013df24c720ed2c396a13f9b6a1773c5eb2540c8fac87` |
| `dist/features/web-ui/server.js` | `4e79838e2388aba670eccba74e26ebf63d78e7b4a1edc9e57a8b634cdc1320a6` |
| `dist/infra/task/project-execution-lock.js` | `c7e68563b3d42e46742c3209fd6f2dd3805595b5eec5854ac6be6f2d8d5bc656` |
| `dist/infra/task/process.js` | `5965f11b4360dc71f1ed87e45c2d1a2a9fc433a7ec315e4e80e20e23dc7fd743` |
| `dist/core/workflow/quality-gates/commandGateRunner.js` | `f571241e8034c1b94385807dc50bcec6a47888e149810004409ab93f9cd0d75d` |
| `dist/infra/task/native-gate-groups.mjs` | `f089eaee38fb8e265f62671eb897395a0cda859afd947bb22ee05d4cc5f022bc` |
| `dist/core/workflow/quality-gates/native-gate-supervisor.mjs` | `26180870eeba5cebef671e10e06d9b136774f40216300f51772d7e775971f133` |

現在のソースSHA-256：

| ファイル | SHA-256 |
|---|---|
| `scripts/native-controls/README.md` | `9d73d01472f93053ef49cf64358da879487d58720c7d20f5e21b148caf6db782` |
| `scripts/native-controls/file-limit.mjs` | `3728231dd82736b64507286b124a475b4f04dcbad1f9b46f35f15754786c02f3` |
| `scripts/native-controls/gate-groups.mjs` | `f089eaee38fb8e265f62671eb897395a0cda859afd947bb22ee05d4cc5f022bc` |
| `scripts/native-controls/gate-supervisor.mjs` | `26180870eeba5cebef671e10e06d9b136774f40216300f51772d7e775971f133` |
| `scripts/native-controls/patch.mjs` | `620f5753544da6b826161a7156cac94d463caba28e76b0a898686ad94f48b30a` |
| `scripts/native-controls/run-bounded.mjs` | `119d69d0351c86639f19179333abd073fdf061bcc6e51d375fefd78ed8a45c40` |
| `scripts/native-controls/upstream.json` | `1fc12d8f2cab35d311d58eaa181d104eece1a02fb50d486d385f890a34b484a6` |
| `tests/native-controls/external-proof.mjs` | `ce52ef5f28364e0ce03284be16c904418b1eb7acaa925814b67b73aaa5bde20a` |
| `tests/native-controls/file-limit-payload.mjs` | `eb22c4f26758ca811fd56cb37dc24a0223bfe14e638f46f88f7941b827c1f97a` |
| `tests/native-controls/file-limit.test.mjs` | `ff81ec00b5221944c49ad792fa203ce62c91d22580c519e705190bce633299df` |
| `tests/native-controls/gate-payload.mjs` | `98b055dc1e72be5ef79a0fb565a724882acdf7ce59b29506bd4186b1973f3dcd` |
| `tests/native-controls/gate-worker.mjs` | `312f74c885a1754a0ca0aff1047578f70832433161739d6c49151566509fec6a` |
| `tests/native-controls/gates.test.mjs` | `765c276b2353b2c3ddbdef884734d8ba150c85991eaa756c1b1eb4947a336fdb` |
| `tests/native-controls/helpers.mjs` | `7c9533af52803a0fbdb883a9658d993eab85b4f0c3af3653edaa43ed09b7d3d6` |
| `tests/native-controls/http-fixture.mjs` | `f2d61fbc16ab2e5e31399b47bf0bc68606edb4e56d6efc73d9b5695493c1ad69` |
| `tests/native-controls/http-gate.mjs` | `c25535ba1aa797b75276e244ee0164b2c6d4202af4ccd810f0dd4bc2da9368a8` |
| `tests/native-controls/http.test.mjs` | `be74b3325ad60a3da12ea9abebbf3dcc8efa0ca1ac3e66dc93e3b72a9716d441` |
| `tests/native-controls/lease.test.mjs` | `2376353d6b5915e9d9a2d9df19c20596f8780e16989761e414b03f39b7c167c1` |
| `tests/native-controls/patch.test.mjs` | `15875b1b683acf2c6af17bfed2c372bf3d94409525b82a7d0b51b486cfbbf504` |
| `tests/native-controls/release-worker.mjs` | `ff78239ee15cf224a2ffc8646e9d5e9e5e292aa92e2e280ba87df564574f2a9e` |
| `tests/native-controls/snapshot-contender.mjs` | `af729f6693dafc4dcf0b7e6593c76e848efe910b7064760ba02f85020ab4f8f8` |
| `tests/native-controls/snapshot-worker.mjs` | `831723cd0d7a62acaaf508d6f8cf73ca7bb800ee950b2d279603a6ee2671cc96` |
| `tests/native-controls/snapshot.test.mjs` | `39df4ff285f4515ce4ee96f6f54199986603aa9afae29d90a55760b0822f2f10` |
| `tests/native-controls/volume.mjs` | `2b80f8f0863701d7e577c8368c9d8acc3d9401ff4cf317aaee57f8ee96b998e9` |

## Proven boundaries

公式HTTP→中央worker→実command gate、queue successor、CLI run/watch、別project、通常完了と後続実行を検証した。B1のworker SIGTERM／SIGKILL／worker＋guardian喪失時にも、回収中の競合は`project_execution_conflict`となる。明示的release時のgroup保持も通過した。

B2について、group未登録のsnapshotを持つ競合者を停止し、その後の実group登録とworker死亡を経て再開する順序で、run・watch・owner照会すべてが新しい所有記録を保護することを確認した。回収後の取得と、その新しいロック保持中に旧heartbeatが増えないことも確認した。

外部bounded HTTPは今回の24ソース・10実行時hashに結び付いた別の実試験であり、B2のdescriptor順序固定試験自体はローカルの別processで実施した。この二つを混同しない。

容量は実APFS volumeの上限で拘束する。du監視や1ファイル上限を総容量のハード上限とは扱わない。64 MiB級での実証であり、20 GiBまでの書き込み試験ではない。許可されたmountは実行中にリサイズ・交換・nested mount追加をしないことを前提とする。

## Remaining work

- `review-controls`によるB2修正と今回の一致hashに対する独立再レビュー。実装者の結果は承認を代替しない。
- 実PID再利用を意図的に発生させた試験、外側launcher死亡後の制限継承、guardianとsentinel同時喪失時の自動回収、process group／sessionを離脱した子孫、OS障害／Windowsの保証は未実証または対象外。
- 同一projectのCLIとUIは修正版配布物を使う必要がある。旧CLI混在は保証対象外。
- 回収不能な生存groupは排他を保持する。時間経過だけで取得を許可しない。
- 満杯のままでの永続失敗記録は未実証。今回の容量fixtureはfillを削除して記録領域を回復しており、容量解放とreconcileによる回復が必要。
- GitHub 22件とローカルbacklog 190件の完成は継続課題。本工程はその前提となる実行制御の修復であり、ENT-201、正式なB00〜B06、全issueの受け入れを宣言しない。
