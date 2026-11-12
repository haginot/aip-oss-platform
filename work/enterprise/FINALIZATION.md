# Release seal and independent final attestation — AR2-01

状態: EXISTING_IMPLEMENTATION_REQUIRES_CURRENT_RUN_VERIFICATION。CLI・seal・attestation検証を実装し、BF-01〜03の反例を追加。旧runに限定した独立承認は履歴として存在し、本runの独立承認は未取得。
原Issue/ACを変更しない。ENT-101の証拠基盤とENT-705の独立監査を接続する契約である。

## 観測と責務

修正前の `scripts/enterprise/verify.mjs` の `all` は新しいreceipt/indexを作りprogressを更新していた。
`--validate-only` でもprogressを書き、CLI入口はgate.lockを作る。最終readonly検証には使えない。
TAKT `WorkflowRunLoop.js` はrunStep/step:complete後にresolveCommandGateTransitionを実行する。
`StepExecutor.js` のapplyPostExecutionPhasesはPhase 2のreport生成後にrule判定へ進む。
従って、実装する順序は **releaseで固定 → final auditorが読む → TAKTがreportを保存 → final gateが同じ集合とreportを読む → COMPLETE**。
release reportはsealより先に生成されるため、その本文中の暫定receiptを最終承認対象にしない。
final auditorは必ずrelease gateが最後に固定したsealを取得する。

## CLIと順序（実装済み、B00で今回入力を再検証する公開契約）

| 呼出し | 読取り対象／出力 | 書込みと成功の意味 |
|---|---|---|
| `verify.mjs batch` | active batchと影響closureを実行 | 新run/receipt/indexと実装進捗。独立承認ではない |
| `verify.mjs all --seal` | harden-releaseで全機械suiteを実行し、現在性を検査 | release sealを新規生成。`MACHINE_EVIDENCE_SEALED`だけを返す |
| `verify.mjs final --check-seal` | sealの全入力・receipt・出力・latest index・実行context | 読取りのみ。`SEALED_EVIDENCE_CURRENT`。reportの存在も最終承認も前提にしない |
| `verify.mjs final --check-report` | 同じ検査＋そのsealを承認した今回のTAKT最終report | 読取りのみ。`FINAL_INDEPENDENT_APPROVAL_CURRENT`。COMPLETEへの必要条件 |

finalの分岐はmkdir/lock/progress読書き副作用より前に置く。finalからexecute/mainの更新経路を呼ばない。
進捗の更新APIはbatch/releaseのwriterだけが所有する。finalはlockの作成/削除、receiptコピー、index追記、
status変更、report書込み、再試験、子プロセスによる再生成を行わない。成功・拒否・例外の全経路で同じ。
検査開始/終了で入力、index、seal、receipt、出力、reportのhashを再照合し、同時変更は拒否する。
排他的writerの不在を確認できない場合も拒否。最終検査に合わせてwriter lockを作る方式は禁止。
TAKT自身による中央report/遷移ログ、およびgate失敗ログはengineの責務として区別し、検査CLIの書込み許可に転用しない。

旧run 20261020062537-e8806144 では実context readerで保存済みworkflow-bundleを読み取り確認していた。本runの有効bundleは別途currentContextで確認し、旧workflowRefを現在の権威へ転用しない。
有効なrelease gateは `verify.mjs all --seal`、final gateは `verify.mjs final --check-report`。
workflowRefは project:sha256:f323f28ea8d7cd183bb45a476788acede64afa61bd6e0d2c0dbee3ab4bf6f364。
この読取りは書込み権限の証明や今回runの最終承認ではない。
中央stateや旧taskを手編集しない。B00は実TAKT engineを隔離fixtureで動かし、有効なgate定義とreport順序を確認する。
保存済みgateが旧 `verify.mjs all` のままでも安全に進めるため、CLI入口の互換dispatchを必須にする:
信頼したcurrent run contextがharden-releaseなら `all --seal`、final-auditなら `final --check-report` へ解決する。
context不明・複数候補・別run・別stepではlegacy allを拒否する。明示 `all --seal` もfinal-auditでは拒否する。
`all --validate-only` をreadonly代替にしない。有効workflowのfinalで再実行する経路を残さない。
これにより新旧どちらのgateでも最終reviewの後にR'を生成しない。モデルrouting/sessionは変更しない。

## Seal Rの内容と発行

保存先は `evidence/enterprise/releases/<releaseId>/seal.json`、最新発行試行はappend-only
`evidence/enterprise/releases/index.json`。writerは発行開始をrunningで記録し、失敗も残す。
最新failed/runningがあれば過去passed sealへfallbackしない。最新成功sealを監査開始時に一意に固定する。
sealにはschemaVersion、releaseId、作成時刻、scope revision、全190 Issue/AC/spec hash、plan/coverage hash、
全機械入力manifest/digest、全31 batch＋allのrunId/receipt **file bytes SHA-256**、各出力manifest/hash、
独立batch report/approvalの参照hash、元AC回帰、124 browser/5横断の索引、保護対象hash、制限事項を含める。
既存内部のJSON.stringify(receipt) hashをraw file hashと混同しない。旧形式の検証も別fieldで保持する。
同じ入力でもrunIdが変われば別release。各batchのlatest index entryをIDとhashで固定し、
機械run index全体と、当該attemptのrunning entryまでのrelease index prefixを固定する。
sealを書いた後、writerは同じattemptId・sealPath・sealDigestを持つpassed terminal entryを一件だけ追記する。
自身を参照するこのterminal entryはsealのhash対象prefixに含めず、検証時に厳密に照合する。
失敗時はfailed terminal entryを追記する。entryを上書きせず、runningのままの中断も失敗として閉じる。
当該passed terminalより後のentryは成功でも拒否し、古いRの再承認に見せない。
`releaseDigest = SHA256(seal.jsonの実bytes)`。自己digestはseal本文に入れない。公開前検査と公開後readbackは同じattempt失敗境界に含める。正常終了後のfinalによる純粋検証は別に行う。
最終reportとそのhashはsealの入力に含めない。reportは後からseal digestを参照する一方向の依存である。
seal作成時は、planのreviewStage=review-foundationの先行実装batch承認を要求する。
B22（ENT-701〜704）とB23（ENT-705）はreviewStage=final-auditのためseal後に審査する。
これらの最終承認、親の完了status、今回のfinal reportをseal作成時に要求しない。
final reportではこれらを含む全leafを必須にし、先行実装batchの承認要件は免除しない。
独立batch承認の由来とfieldはBATCH_REVIEW.mdに従う。承認run R1と最新機械run R2が異なる場合、
両方の出力rootをsealへ固定し、finalでもR1のvalidateRunを実行する。
ENT-705の機械suiteは163先行leafと監査準備を検査するだけ。complete-machine-gateはオーケストレーションであり再帰suiteではない。

## Reportの取得・由来とattestation

実装済みTAKT context readerをB00で今回入力に対して再検証する。release時に現在runのcanonical project/worktree、runSlug、中央runRoot、
metaのworkflow identity、NDJSON log path、reportDirectory、session storageの実パス、effective workflow digestを固定する。
command gateの環境変数allowlistはreportDirectoryを渡していないため、架空のTAKT_REPORT_DIRを前提にしない。
TAKTの実state resolver/sessionStoreを用いてこのcheckoutの現在runを一意に解決し、release contextとの一致を検査する。
そのreaderと使用するTAKT版のソースhashを機械入力へ含める。全ディスクから「最新らしいreport」を選ばない。
中央state、run mapping、provider session記録はorchestrator所有の信頼境界。製品側statusやreport内の自己申告だけでは由来を証明できない。
B00 fixtureで実際の取得経路を証明できなければcontext unavailableとして閉じ、固定文字列sessionで代用しない。

final reviewerのPhase 1はcheck-sealのreleaseId/digestと全Issueの証拠を読み、承認又は差戻しを返す。
TAKT Phase 2で生成する `enterprise-06-final-audit.md` に、単一のJSON fenced block
（言語名 `enterprise-attestation`）を含める。以下はfield契約であり、架空の承認値を納入しない:

- schemaVersion=1、verdict=APPROVE|REQUEST_CHANGES、releaseId、releaseDigest、inputsDigest。
- runSlug、workflowRef、step=final-audit、iteration、sessionKey=enterprise-final-auditor、providerSessionId。
- approvedLeafIds（164件の厳密集合）、approvedParentIds（26件）、issueEvidence（全190件）。
- leafごとの原AC ID、seal内receipt/output参照、反例/ブラウザ等の根拠、判定。parentは全子孫と原parent ACのデモ/導入条件を参照。
- unresolvedFindings（APPROVE時は空）、productionLimitations、githubSynchronization=PENDING_DESTINATION（公開先未確定時）。

post-report gateは固定runRoot内のmeta.reportDirectoryからこの名前のファイルだけを読み、symlink/escapeを拒否する。
同runの最新final-audit occurrence/iterationのPhase 1とPhase 2の成功、step_completeをNDJSONで確認する。
Phase 2.contentとreport bytesの一致を検査する（TAKTが付加する末尾LFだけを規定normalizerで扱い、hashは常にraw bytes）。
Phase 1とPhase 2でrelease identityと判定が一致し、同じscope/iterationであることを検査する。
report本文、対応するphase records、sessionStoreの実provider session、effective workflowのreadonly/Astra routingを照合する。
providerSessionIdは実装/releaseの全session IDと異なること。キー名だけ異なる同一provider sessionも拒否する。
過去iterationのreport、欠損/未完report、後から差し替えた本文、自己申告session、別runをすべて拒否する。
report自身に自身のhashを記入させない。gateが実bytesからreportSha256を計算し、releaseDigestとともに結果へ返す。

## 完了状態と復旧

機械的な成功と人の判断を分離する。TAKTのCOMPLETEは、今回final reportがAPPROVEを返し、
そのreportが生成された後のpure gateが同一Rに対してexit 0になったときだけ許す。
永続したseal＋中央report＋TAKTの該当遷移記録が完了の正本である。reportの各Issue行が厳密な承認索引になる。
progress.jsonのREADY_FOR_REVIEWを最終gateがVERIFIEDへ書き換える必要はない。
閲覧CLI/UIは正本からleaf VERIFIEDとparent完了を導出し、古いstatusだけでは完了しない。
必要なローカルstatus projection/exportは別writerの後処理とし、元report/hashを再検証してから生成する。
その未生成は既存の証拠を失わせない。外部GitHub作成/closeは行わず、公開先待ちは明記する。

Rが失効したらfinalは非zeroでharden-releaseへ戻す。新しい試行R'と新しい独立監査reportを必須にし、
Rのreportを流用しない。古い失敗・report・sealは履歴として保持する。
管理者が製品とorchestratorの全ファイルを同時に改ざんする攻撃はlocal hashのみでは防げない。

## B00の実行受入

既存の `tests/enterprise/finalization.test.mjs` を再実行し、real CLI subprocessと一時root、実TAKT engineの隔離fixtureで検証する。
製品や中央runに試験reportを偽造しない。planのfinalization-regressionsに列挙するnamed assertionsをTAPで報告する。
同一Rでの成功に加え、入力/receipt/出力改変、R承認後のR'、最新failed/running、report欠損/差替え、
別session/別run/古いiteration偽装、同時変更、ENT-705循環の拒否を実験する。
finalの成功/失敗両経路でfiles/dirs/bytes/mtimeの前後比較に加えFS mutation API監視を使い、
作成後削除されたlockも検出する。監視は最終CLIと子プロセスを対象としTAKT自身のreport生成とは分離する。
旧all gateのfinal dispatchでも同じzero-writeとR維持を検証する。これらの実装/成功証拠と独立reviewがB00を出る条件。

新runの履歴保全・初期化・再承認は [CONTINUATION.md](CONTINUATION.md) に従う。旧runのseal/report/承認をcurrent runへ付け替えない。

改訂4では計画/確率MLの数値oracle、情報状態の継続利用、DISC-01〜10と追加7業務をseal索引へ含める。機械suite総数はplanから導出し、旧290/171/117等の固定件数で検証を打ち切らない。closure reviewを採用した場合はREVIEW_CLOSURE.mdの各memberの実由来とraw reportを同じsealへ固定する。既存finalizationの動的集合検証と新scopeの実証はB00/最終監査で取り直す。

## Preparation run iteration 12: publication failure boundary

The saved iteration9 counterexample exits1 at the outer writer progress checkpoint after sealRelease has already published passed; subsequent readonly final exits0. The implementation is not accepted by the existing CLI table merely because it has an exported seal writer. [PREPARATION_ENTRY.md](PREPARATION_ENTRY.md), iteration12, specifies the repair and SP1-SP10 acceptance.

Move mutation-capable release orchestration into verify.mjs's module-private authenticated/locked boundary; finalization.mjs supplies read-only validation only. Remove exported sealRelease as a mutation entry; no public no-op callback or forged capability may authorize publication. Recheck ownership, raw checkpoints, actual authority, indexes and artifacts after every await and before seal/terminal publication. Preserve all existing seal fields, reviewed receipt/output validation and running-prefix semantics. Staged seal validation grants no final success.

Atomic terminal publication uses an owned lock and expected-raw-index CAS; append-only means retaining every prior entry, with durable temporary-file/rename publication. Include post-publication verification in the attempt catch: append failed on error even if passed was appended, or retain the owned fence if durable failure recording cannot complete. Latest failed/running, duplicate terminal, any later attempt and active writer all make final refuse; no older passed fallback. Interrupted processes leave running or the owned fence. Final never acquires/clears a lock or falls back to current progress ownership. An ambiguous delivery after fully durable validated commit is resolved by inspection, not treated as a failed validation or retried silently. This contract is not implemented or independently approved in iteration12.
