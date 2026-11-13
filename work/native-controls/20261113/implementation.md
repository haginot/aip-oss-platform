# Native TAKT control implementation

## Changes

TAKT 0.71.0 の実行制御を実装し、独立レビューへ渡す状態にした。これは native-repair の implement-controls の成果であり、レビュー承認、ENT-201、B00〜B06、全 issue の受け入れではない。既存の未承認候補をコードと実試験で確認し直した。開始時の clone 内には、この変更の独立レビュー報告はなかった。作業中に operator が `NATIVE_REPAIR_ORDER.md` に追記した外部検証と失敗指摘を読み、修正・照合した。このファイルの追記は operator によるものである。

- `scripts/native-controls/patch.mjs`, `upstream.json`: 元の version と8ファイルの SHA-256 を検証し、checkout 内の新しい配布物コピーだけを変更する。既存対象、版違い、元ファイルの変更を拒否し、元 hash と実行時 hash の receipt を出力する。
- 同 recipe の中央 worker 修正: 既存 `acquireProjectExecutionLock` を workflow/worktree 実行前に取得する。競合は `project_execution_conflict` として terminalize し、gate を実行しない。finally で解放してから既存 queue successor を起動する。HTTP 202 の公開契約は維持し、その後の task failure で拒否を観測できる。
- `gate-supervisor.mjs` と command gate 修正: guardian と pipe sentinel が同一 POSIX process group を所有する。worker の終了、guardian 単独の SIGKILL、通常終了、タイムアウト時に TERM→KILL で子孫を回収する。IPC により本当の command 終了コードを返し、成功する大量出力の既存 truncation 契約を保つ。
- `run-bounded.mjs`, `file-limit.mjs`: 実 mount/device と容量20 GiB以下、起動空き8 MiB以上を確認する。HOME/TMP/中央状態/標準出力・標準エラーを指定された writable root 内へ置き、OS の書込ポリシーを子孫へ継承する。64 MiB のファイル単位 hard/soft limit は補助であり、総容量上限は filesystem が担う。
- operator が再現した製品側の失敗「process start time is unavailable」を修正した。sealed system の `/bin/ps` だけに `process-exec (with no-sandbox)` を許可し、Node、shell、worker、gate の書込制限は維持する。既存 TAKT の実開始時刻による識別コードは未変更。不要になった候補 `process-info.c` は削除した。
- `tests/native-controls/`: 実 gate、公式 HTTP→中央 worker→gate、successor、実 CLI run/watch、正常連続実行、別 project、SIGTERM/SIGKILL、guardian 障害、容量拒否、版/hash拒否を検査する独立 fixture。`external-proof.mjs` は外側制約下で実行不能な経路を operator が同じ候補で検証する入口で、skip せず、実行中の source 変更も拒否する。
- `scripts/native-controls/README.md`: 再現可能な prepare、起動、seed 前提、試験と保証範囲を記載。`.gitignore` は配布物コピーと一時 fixture の `.native-controls-runtime/` だけを追加。
- `work/native-controls/20261113/`: 失敗・成功の operator 原本を byte-identical にコピーし、local TAP、local HTTP、EFBIG、hash照合を保存した。元の歴史的証跡は変更していない。

共有 node_modules は変更していない。`work/enterprise`、`evidence`、既存 workflows、package/lockfile の HEAD 比較は差分なし。sourceSnapshots の承認は更新していない。取得済み GitHub `issues` は22件、backlog `items` は190件で、今回の制御修正後に正式な各 slice と独立レビューで統合していく使命は未完了。git add/commit/push は実行していない。

## Actual checks and hashes

実行環境: macOS / Node v22.23.3。最終計測で outer filesystem は805,265,408 bytes、空き195,866,624 bytes。ホスト空きは67,817,373,696 bytes。起動元 supervisor の90分・ホスト30 GiB下限は変更していない。

| 実行・照合 | 終了コードと結果 | 出典 |
| --- | --- | --- |
| `node --test --test-concurrency=1 tests/native-controls/*.test.mjs` | 0; tests 14、pass 12、fail 0、skip 2 | `local-tests.tap` |
| operator: `node tests/native-controls/external-proof.mjs OWNED_64_MIB_MOUNT COPIED_TAKT` | 0; bounded HTTP、直接/symlink write拒否、実 ENOSPC、回復成功; sourcesUnchanged=true | `root-candidate-external-proof.json`, `root-candidate-external-exit.json` |
| recipe によるコピー/元 hash 検証 | gate suite の初回実行で実際にコピーして成功。別の小さい fixture でも正規 hash の prepare 成功と版/hash/既存対象拒否を検査 | `local-tests.tap`, runtime receipt |
| 現ソース17件・実行時9件と operator 証跡の SHA-256 比較 | 0; 全26件一致 | `hash-binding.json` |
| `git diff --check` | 0 | 最終 shell 実行 |
| `git diff --exit-code HEAD -- work/enterprise evidence .takt/workflows package.json package-lock.json` | 0 | `verification.json` |
| hdiutil inventory の所有 image 照合 | 0; 残留 mount なし | `hash-binding.json` |

local の skip 2件を成功扱いしていない。nested sandbox は71 (`sandbox_apply: Operation not permitted`)、この engineering image 内の実 image attach は1 (`アクセス権がありません`) だった。operator によって、後者は単なる nested sandbox の問題ではないと確認された。対応する成功根拠は外部の実64 MiB volume 上での operator 試験であり、EFBIG や native-route-only 試験による代替ではない。

失敗履歴も保存した。外部の最初の bounded HTTP は終了1、実 process identity を読めない製品不具合だった (`root-http-evidence.json`)。修正前の local 起動も sandbox拒否で終了71。補助 ulimit の開発中には、hard を soft より先に下げたための `Invalid argument`（test終了1）と、単位誤認による2,097,152/1,048,576 bytes不一致（test終了1）が発生した。soft→hard、macOSの1024-byte単位へ修正した最終検査は、正確に1,048,576 bytesで EFBIG、command exit23、失敗ログ生成を確認している (`local-file-limit.json`)。

最終 operator 証跡は2026-11-13T00:44:44.079Z。元ファイル:
`/Users/haginota/.local/state/aip-takt-recovery/native-capacity-fixture-20261113/root-candidate-external-proof.json`。
コピーはこのディレクトリの同名ファイル。SHA-256:
`70e835a85eb776cc227d93588935d40df2bacbce5e017bc335477bd098e0c54b`。
最終 local TAP SHA-256:
`9f36f21e4b1182bf5e2929346222a6859642e4098b93835109da4b13d3189169`。

主要実装 source hash:

| ファイル | SHA-256 |
| --- | --- |
| patch.mjs | `566ebef453fe4f47a091598f0a16e3169c5f685705a4c8a2b50f14118cf33d6d` |
| run-bounded.mjs | `318f8ce7dc47167e0c0a92cd330ad4cc3d5252f1cd7fc498802a8be3bd1f7acb` |
| file-limit.mjs | `3728231dd82736b64507286b124a475b4f04dcbad1f9b46f35f15754786c02f3` |
| gate-supervisor.mjs | `86cf604b5aee27e1074073a06b8ee19d15e272dcf7bb8ad348c97e63ab17f349` |

実行時 hash（`dist/` 以下のファイルは接頭辞を省略）:

| ファイル | SHA-256 |
| --- | --- |
| package.json | `2542444f13be289c37675c3b50367c3dc09356dfb00cae87d08b4993e4bf630d` |
| features/web-ui/central-worker.js | `c392925a85b6ad26842fb76d23f33e499303d4ce419bb1e91199f1453457583b` |
| features/web-ui/central-worker-spawn.js | `a4f6592c586527dec5276839feab6de4bc41aceabcb5bf151fab66f108770e44` |
| features/web-ui/launcher.js | `afa8b077f589618a96c013df24c720ed2c396a13f9b6a1773c5eb2540c8fac87` |
| features/web-ui/server.js | `4e79838e2388aba670eccba74e26ebf63d78e7b4a1edc9e57a8b634cdc1320a6` |
| infra/task/project-execution-lock.js | `ebbc75b634b97f039d30fba120dec23ab73dd39190ebdfef32b8fe3db5837819` |
| infra/task/process.js | `5965f11b4360dc71f1ed87e45c2d1a2a9fc433a7ec315e4e80e20e23dc7fd743` |
| core/workflow/quality-gates/commandGateRunner.js | `add90e482629956293f66f8bff31c9ce3d8b54d22a8677c469c45e4441ab444e` |
| core/workflow/quality-gates/native-gate-supervisor.mjs | `86cf604b5aee27e1074073a06b8ee19d15e272dcf7bb8ad348c97e63ab17f349` |

元ファイル hash は `scripts/native-controls/upstream.json`、全17ソースの現在値・比較結果は `hash-binding.json`。検証後の変更はREADMEと本報告・証跡コピーのみ。試験中に一時追加した容量 fixture の拡張は採用せず、検証済みの `http-gate.mjs` hash に戻し、26件一致を再確認した。

## Proven boundaries

operator の実経路は `boundedSpawn → official HTTP POST /api/tasks → central worker → actual command gate`。TAKT mock provider はこの制御 fixture のみに使用し、gate の成功は実コマンドから得た。

- first と queue successor はいずれも `project_execution_conflict`、gate markerなし。実 CLI run/watch も競合時exit1。別 project は同時にcompleted。
- hold→follow は別の run ID でcompleted。SIGTERM/SIGKILLした実 worker の gate と子孫が停止し、既存 reconcile 後に `worker_crashed`。実死者の project lock を既存開始時刻識別で回復できた。
- local の実 gate 試験は正常・大量出力成功・exit7・timeout・worker SIGTERM・worker SIGKILL・guardian SIGKILLを確認した。TERMを無視する子孫は ready handshake 後に障害注入しており、fixture側のkillを成功条件にしていない。
- bounded経路で実開始時刻 `darwin-start-v2:1794530674` を取得。直接とsymlink経由で writable root 外の書込を拒否し、`escapedWrite=false`。
- 外部実 APFS filesystem 容量67,067,904 bytes。62,914,560 bytes書込み時点で実ENOSPC。taskは`workflow_failed`、fillを削除して台帳空きを回復した後の`recovery-control`はcompleted。容量run IDは`20261113004441-b87824c3`、回復run IDは`20261113004443-921d16c7`。
- operator の指示追記に外部 fixture detach/remove が記録され、現時点の hdiutil inventory でも所有 fixture の残留mountなし。localで作った画像も除去した。外部volumeへの操作はoperator自身によるもので、modelは読み取りとclone内への証跡コピーだけを行った。

## Remaining work

次の `review-controls` による独立コードレビューは未実施。上記の現在 hash と保持した失敗・成功証跡を使うこと。旧B00〜B04の承認は採用していない。GitHub22件/backlog190件の正式実装・実テスト・独立レビューとENT-201受け入れは別途必要で、本制御検査をB00〜B06の代替にしてはならない。

保証は同一process groupの子孫と、guardian単独の障害まで。自らgroup/sessionを離脱した子孫、guardianとsentinelの同時喪失、OS障害、Windows、実PID再利用を意図的に発生させた試験は未実証。100 msはTERM猶予であり厳密な回収期限ではない。UI停止を全detached workerの取消しとは扱わない。外側launcher断後の書込維持を独立にkill注入する試験も未実施。

総容量境界は専用mountをoperatorが途中でresize/replaceせず、nested mountを追加しない条件による。filesystemが完全に満杯のままの耐久的terminal記録は保証せず、空き回復とreconcileが必要。検証した総容量は64 MiBであり、20 GiBを実際に埋める試験はしていない。ネットワークや読取りの隔離、実providerの認証・製品機能受け入れはこの制御fixtureの対象外である。
