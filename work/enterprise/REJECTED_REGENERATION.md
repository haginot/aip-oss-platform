# Rejected active closure: evidence regeneration only — AR12-01

## Current run boundary — iteration15 / 20261023180641-00e8fea9

Source is initialized, active B04; B00–B03 approvals and BF-61/BF-38/BF-42/BF-43 repairs are retained as history, not current full-prefix approval. B04 failed with exit0/missing assertion; B00 failed with nonzero baseline exit. No successful current B04 candidate exists.

[FAILED_INTERVAL_RECOVERY.md](FAILED_INTERVAL_RECOVERY.md) and [RUNTIME_CONTINUATION.md](RUNTIME_CONTINUATION.md) supersede the impossible same-run runtime handoff (AR14-B01) and preserve both failure types (AR14-N01). Proposed source preparation D_S grants no current approval. After actual source terminal/quiescence, the official central launcher (worktree=false) starts a distinct run at architecture; new independent D_T precedes initializer-private historical archive and an empty B00 projection. Target run is NOT_CREATED. No runtime replacement, central edit, same-run reset or ordinary-gate bypass is authorized here. New behavior remains NOT_IMPLEMENTED and independently unapproved.

Source budget15/60: remaining45, preparation nominal3, total18, reserve42. Future target provisional20+40=60 is separate and requires re-planning after actual launch. All190 Issues/573 AC/124 use cases/31 batches/330 suites and full-catalog initial lower bound62 remain. Full fresh B00–B04 (19 leaves/52 original ACs) and independent reviews precede B05; target initializes at B00, never copied B04. Historical boundary descriptions below are records only.

## Historical contract record (original requirements retained)

状態: EXISTING_IMPLEMENTATION_REQUIRES_INVALID_REVIEW_REVALIDATION_EXTENSION。反復差戻し・section 2.3の通常更新起点認証は実装済み。今回run 20261022093752-59e717db、iteration 14、active B01。iteration 12のAPPROVEは両PhaseのresultPath不一致で取込み不可、iteration 13の拒否を保持する。新規 [REVIEW_REVALIDATION.md](REVIEW_REVALIDATION.md) は独立設計review待ち・未実装である。旧runの復旧能力・旧承認を引き継がず、原Issue/AC、selection、releaseの検査を免除しない。

**追加契約の優先範囲:** 以下section 2〜4の「最新REQUEST_CHANGESだけが再生成許可」「六field recovery/schema1」「APPROVEで生成終了」は通常経路の厳格な契約として維持する。REVIEW_REVALIDATION.mdだけが、認証済みだがresultPathのみ不正なAPPROVEに対する独立設計者の明示的再検証命令とschema2 authorityを追加する。有効なAPPROVEは生成を終了する。不正APPROVEは承認にも拒否にも変換しない。全旧40反例を保持し、新規16反例でこの限定分岐を検査する。

## 1. 観測と権限の分離

旧run 20261021010405-76071af6では、iteration 6のB00承認後にB01を選択した。iteration 8のREQUEST_CHANGESはclosureのB00/B01を明示し、BF-18を指摘した。approval.mjs/closure.mjsはその後の同scope reviewで旧承認を失効させ、selection.mjsがvalidateReviewedRunを呼ぶため、修正後の通常batchが再試験前に停止する。iteration 10の4 CLI拒否・218件の個別成功は evidence/enterprise/B01-resume-iteration10/ にある。個別結果はbatch receiptではない。

選択時の正当性と現在の受入を別の判断にする。既に正規に選択され、実際の独立差戻しを受けたactive batchとその先行prefixだけに「機械証拠を再生成する権限」を認める。現在の承認や依存解除を与えない。B00へactiveを戻さず、B01の中でENT-101の共通修正とB00/B01全suiteを扱う。

## 2. 認証: 最初の書込み・lock取得より前

実装先はscripts/enterprise/rejected-regeneration.mjsとverify.mjsの限定dispatch。currentContextはrequireSession=true、build-foundation、enterprise-builder、edit=true、実provider/model/effortを検査する。共通証拠・復旧コード変更は実Astra/highを要する。CLI/env/session文字列は権威でない。

まず本追加契約の独立設計承認を認証する。今回runのreview-architectureの完了occurrenceをcanonical output contract、NDJSON Phase 1/2、step_complete、実session、compiled readonly/Astra/high、実装者と異なるsessionから解決する。両phaseに同一の単一enterprise-recovery-design-attestation blockを要求する。fieldはschemaVersion=1、verdict=APPROVE、runSlug、workflowRef、step=review-architecture、iteration、sessionKey=enterprise-architecture-reviewer、実providerSessionId、contractPath=work/enterprise/REJECTED_REGENERATION.md、contractSha256、planSha256、permission=EVIDENCE_REGENERATION_ONLY、unresolvedFindings=[]。hashはraw bytes。report自己hashは不要。旧iteration 2の設計承認はこの追加契約を承認していない。自己申告blockだけでは不十分。設計review後に契約・planが変われば再reviewを要する。

次にprogress.runBinding・activeBatchId・entrySelection参照を実runへ照合する。selection bytes/hash、元plan、全先行Issue集合・順序・依存・stage/reviewStageを検証し、現planのprefix topologyと完全一致を要する。suiteの追加・修正は許すが、原AC削減は許さない。全前提の元receipt・command・TAP・全出力実bytes、原plan hashと正規APPROVE occurrence/Phase/session/完了時刻を認証する。receiptを単にhash付きで保存しただけでは足りない。

最後に同runの最新review-foundationをcanonical report・Phase 1/2・step_completeから認証する。未完の新review、unknown scope、不一致blockは拒否する。legacyとclosure両blockのverdictはREQUEST_CHANGES、approvedIssueIdsは空、findingは非空。closureは選択されたactiveまでの全prefixと同じ順序を列挙し、receipt identityはそのreviewが実際に審査したcandidateに一致させる。拒否時点のcandidateと全receipt/出力、当該candidateのplan、開始/完了順、実readonly/Astra/high、全builderと異なるreviewerを検証する。拒否のissueEvidenceは不完全なblocking判断でもよく、承認用の全AC APPROVE集合は要求しない。ただし未知Issue/AC/artefactや空finding、active legacy不一致は拒否する。

元selection Sと最初の拒否J0だけに、旧APPROVE occurrenceがJ0より前、J0 candidate内の先行receiptがSのものと同一、J0のactive receiptがSの元planに束縛、という起点条件を適用する。既存形式の起点では一致検査を外さない。通常gateで更新された先行receiptに限りsection 2.3の別形式を全件認証する。二回目以降の拒否Jnは元receipt/元planとの同一性ではなく、以下の認証済みattemptから生成されたcandidateとの同一性を検査する。元承認の由来・内容・出力検査だけを限定内部関数でas-of検証する。現在のvalidateApproval/createSelection/validateSelection/sealにはこの扱いを持ち込まない。公開のskipSupersession、任意historicalRunSlugや時刻引数は禁止。J0以前のunknown/対象scope reviewも検査し、権威の欠損を拒否する。

入力/plan/契約/selection/進捗/index/中央権威のsnapshotを取り、排他下・candidate発行直前に再検査する。欠損、改ざん、他run、別active、prefix変更、自己session、未承認設計はmkdir/lock/receipt/index更新前に拒否する。

### 2.1 固定起点と再生成履歴の分離

`root.json`はSのraw bytes/hash、元plan、元APPROVEの実occurrenceとraw report、J0の実occurrence/raw report/candidate/receipt群、run/workflow/bundle、active、prefix topology、全原ACを固定する。`rootId = SHA256(root.json bytes)`で、自身のhashを本文へ埋めない。実行時に認証してから新規保存し、同run/selectionについて二つのrootを作らない。旧run導入時の起点例はSのB00=`1792548618464-2237259f-271c-461e-890d-a8d1f40e518f`、J0(iteration 8)のB01=`1792550623143-89a4f3f1-1b1f-4dcc-9ecb-0527eb0d85bd`、元plan=`86d4477d66c3f5d85cc4fbeff2fd15e5c8b91262ada8a43b7459420c72f29095`。固定値を認証の代用にせず実ファイル/中央記録を照合する。

現在の許可を持つ拒否Jは一つだけで、実runの最新完了reviewから導出する。古いJ0や中間Jnは鎖の由来確認にのみ使用し、現行許可へ戻さない。過去reportは保存したraw copyと当該occurrenceのPhase 2内容、Phase 1の同一block、step_complete、実session由来へ照合する。canonical reportは最新Jの取得に使用し、上書きされたcanonicalファイルに過去Jと同じ本文を要求しない。由来を解決できない過去sessionも文字列で代用せず拒否する。

| 段階 | 認証する結合 | 付与しない権限 |
|---|---|---|
| 起点S→J0 | 元選択・元承認・元receipt・元planと最初の独立拒否の一致 | 現在承認、B02選択 |
| Jn→attempt Ak | 最新の正規拒否、独立設計承認Dn、固定root、直前terminal、今回plan/input/suite、実builder | 先行batchの承認免除 |
| Ak→candidate Ck | 同attemptの全prefixの新receipt、同input/plan、実exit/TAP/出力、発行順序 | review済みというstatus |
| Ck→次の拒否Jn+1 | 実reviewのcandidate hash・member receipt群・recovery参照、独立session、完了順序 | Jnの再利用、任意receipt差替え |
| Ck→APPROVE→import | 最新の厳密な全member/原AC判断と現在入力、通常のatomic import | 過去拒否をAPPROVEへ変換 |

Jn+1のreceipt/planはCk・Akのものに一致し、Sのものとは異なってよい。全段階でrun、workflow、rootId、selection hash、active、prefixのIssue集合/順序/依存/stage/reviewStage、原ACを一致させる。各世代の入力・plan・suiteは別々に保存し、古い証拠を現planのsuiteで読み替えない。新planは原ACと既存必須assertionを保持し、新suiteを追加できる。契約又はplan bytesの変更はその版への新しい独立設計承認Dnを要する。ソース/試験本体だけの変更は同planの新inputとして扱う。過去Dnは当時のattemptの由来にのみ使い、現在版の承認へ昇格しない。

### 2.2 Append-only attemptとreviewの結合

新規保存は `evidence/enterprise/recoveries/<rootId>/` 配下。root、attemptごとの`header.json`/`result.json`、report copies、append-only journalを置く。headは索引であり権威ではない。全鎖をrootから検証し、実中央review列と通常runs/indexの順序に照合する。callerが選んだ古いheadからの開始は禁止。

- headerはattemptId、単調sequence、rootId、直前terminalのpath/raw hash（初回はnull）、親拒否のoccurrence/report/candidate hash、Dnのoccurrence/report/contract/plan hash、今回planText/input manifest/全suite定義、開始時runs/index prefix、実builderのrun/step/iteration/provider/model/effort/sessionを含む。認証後・実subprocess前にdurable保存する。
- resultはheaderのraw hash、status、全新receipt ID/raw hash/出力digest、開始終了時刻、exit/signal、candidate参照（成功時のみ）を含む。candidateは`recovery`としてrootId、attemptId、headerPath/headerSha256、親拒否reportSha256を持つ。**candidateはresult hashを持たない**。依存はheader→receipt→candidate→result→reviewで、自己hash循環を作らない。
- 全prefixのreceiptはheaderのplan/input/suiteに一致し、開始後に生成され、builder sessionが一致し、すべて完了してからcandidate/resultを発行する。resultのpassedだけでなくreceipt/TAP/全出力を検証する。失敗・中断attemptと、そのpartial receiptもjournalへ残す。
- 再生成candidateを審査するclosure blockには`recovery`を追加し、rootId、attemptId、headerSha256、resultPath/resultSha256、parentRejectionReportSha256をPhase 1/2で同一に記録する。独立reviewerは鎖の実証拠を読んでこの対応を確認する。拒否でもこの結合は省略できない。J0には拡張fieldを遡及要求しない。J1以後で欠損なら拒否する。
- 最新reviewのCk/member/recovery参照が、同rootの認証済み最新成功terminalに厳密一致すること。review開始はresultと全receiptの完了より後。reviewが同runの新しい独立REQUEST_CHANGESなら、そのJを次attemptの親とする。元Sのreceipt/plan同一検査を再適用しない。APPROVEなら再生成能力を終了し、現在入力が一致する場合だけ通常importへ進む。

同じ親拒否での失敗・中断・入力変更による再attemptも、直前terminalへ連続して結合する。過去のpassed candidateへのfallbackは禁止。後続reviewが未開始の場合だけ、現在の同じ親拒否から全prefixを再試験できる。新しいreviewが開始したら、未完・unknown scope・非一致candidateでは新attemptを書かず停止する。正規の次拒否が完了した場合だけ親を進める。新しい拒否を無視して古い親を指定する操作は不可。

hash鎖だけを権限として扱わない。実TAKTの設計/review occurrence・compiled routing/session・完了順序・原選択の正当性、実receipt/出力、runs/indexとjournalの単調列を併せて認証する。欠落/混在/改ざん/逆順/分岐、scope拡張、未記録receipt、古いhead/親へのrollbackは書込み前に拒否する。中央権威と製品ファイルを同時改ざんするhost管理者への耐タンパー保証は行わない。

## 3. 実行・冪等性・中断

既存CLIは verify.mjs batch --recover-rejected。今回runでは不正APPROVEが最新であり、REVIEW_REVALIDATION.mdの独立命令・追加実装前には再生成可能と扱わない。任意batch/候補path/reviewpath/run/session引数は受け付けない。activeとprefixは認証済みselectionから導出する。

frozen workflowのpost-report commandはverify.mjs batchのままである。追加flagだけでなく、この通常経路でも、正規selection検査が認証済みの差戻しsupersessionで停止した場合だけ同じ限定処理へdispatchする。全例外をcatchして通すfallbackは禁止。未分類エラー・tampered selection・欠損authorityは従来どおり拒否する。TAKTの自動gateと手動CLIが同じ能力境界を使うことを実engine fixtureで試す。中央bundle/YAMLの書換えに依存しない。

認証後だけ既存gate排他を取得し、現input manifestでprefix全suiteを順に実subprocess実行する。失敗/実行中の旧latestを合格へfallbackせず、新しいattemptとして再実行する。過去receipt・失敗・出力は不変で保持する。新attemptはrunning/failed/passedと実exit/signal/TAP/出力bytesをappend-onlyで記録する。改変された元選択/拒否証拠を再試験で隠すことはできない。B00 baselineは保護2ファイルを変更しない隔離release→finalを再実行する。standaloneの218件や旧52件を正式receiptへコピーしない。

書込み可能集合はsection 2.2のevidence/enterprise/recoveries/<rootId>/配下の新root・attempt・report copies・journal/head、通常の新runs/receipt/index、未承認closure candidate、既存lockの正規取得/解放だけ。progress bytes（active、selection、approvals、Issue statusを含む）と旧index prefix・全旧証拠、保護2ファイル、中央stateは不変。成功はMACHINE_EVIDENCE_REGENERATED_REVIEW_REQUIREDであり、READY/VERIFIEDや後続権限を付与しない。既存BLOCKEDを残しても、新candidateをreviewへ渡せる。

attemptの正規配置は`<rootId>/attempts/<attemptId>/`。次reviewerはprogress.lastGateの古いcandidateを選ばず、固定rootのjournal/latest terminal・通常runs/index・実review列を読み取り照合し、今回の全prefix candidateを解決する。buildのPhase 2後にgateが初めてresultを発行した場合もこの解決方法を用いる。gateのstdoutはroot/attempt/result/candidateのpathとraw hashを返すが、それ単独を承認権威にしない。発見できない場合は古いcandidateへfallbackせず未完了と報告する。

durable checkpointはsection 2.2のheader/resultとjournalであり、元selectionへの不変なroot参照と各世代のreceiptを分離する。全prefix完了・同input・latest一致を検査した後だけcandidateとterminal resultをdurable発行する。部分成功ではcandidateを作らない。receiptが一つでも失敗すればattemptはfailed、過去の成功候補は無効。publicationはcandidate→immutable result→journal terminal→head更新の順にfsyncする。head更新前の中断は一意な既存resultとindexを照合して同じterminalを確定するか、失敗記録へ進める。二つの競合resultや由来欠落は停止し、過去成功へ戻さない。

同じ入力と同じ権威でpost-report gateが再呼出しされたときは、完了checkpoint、全最新receiptと出力、candidate、入力を再検証し、同一結果を読み取る。別receiptへ置換して審査対象を失効させない。入力変更なら最新の親拒否と直前terminalから別attemptで全prefixを再試験する。process中断はrunningのまま合格にせず、元権威とcheckpoint・lock所有を再認証して失敗を保存し、新attemptから全再実行する。live/ordinary/不明lockを消さない。既存POSIX lock回復契約以上の耐久保証を主張しない。

排他取得前に全認証を行い、取得直後に同じsnapshotをCAS照合してからheader/receiptを書く。同じheadから同時に二つのattemptを作らない。既知の競合はlock/新証拠作成前に拒否し、取得中に発生した競合は取得したlockの解放だけを行い証拠・progressを書かない。実行開始後の入力/権威変更は新candidateを発行せず当該attemptをfailedで残す。「書込み前の拒否」は変更発生前に正規に開始済みの失敗記録を削除する意味ではない。

## 4. 受入・移行・権限の上限

本経路は選択権限を再発行しない。active B01とentrySelectionは変えない。通常のB02選択、同一run初期化、all --seal、finalは既存の現在承認検査を保つ。新しいcandidateの全B00/B01 receipt・原AC・BF-18の修正前失敗と修正後実DB/HTTP/再起動・UI証拠を、別Astra/high sessionのreview-foundationが審査する。実装者によるfinding閉鎖は権威でない。

その後のexact closure APPROVEだけを既存importClosureでatomicに取り込む。拒否reportは取込み不可。再生成candidateの取込みにはsection 2.2のrecovery結合検証を追加し、通常の全AC・現在性・latest・独立session検査は維持する。最新APPROVE後はJを現在許可として再認証するのでなく、鎖を歴史的由来として検証する（承認後の再生成権限はない）。通常candidateのlegacy/closure形式は変更しない。次の差戻しでは固定rootと連続attemptから新しい拒否を認証する。古いJ0/checkpointだけへ戻る操作、readonly finalの書込み、latest失敗の無視は許さない。

旧runでの導入順は、追加設計review→選択済みactive内の実装→反例・既存回帰→全prefix再生成→独立review→exact import→通常selectionだった。現在この経路のコードと試験は存在する。今回runは初期化済みでactive B01を維持する。section 2.3の後続実装は存在する。今回追加契約の独立命令・実装後に全prefixを再生成し、現在入力の独立承認を取得する。本設計stepでは初期化・import・gateのwrite実行をしない。

## 5. 実行可能な受入計画

ENT-101の追加suite rejected-regeneration-regressions（PRESENT_REQUIRES_FRESH_RUN）:
`mise exec -- node --test --test-reporter=tap tests/enterprise/rejected-regeneration.test.mjs`
実CLI subprocessと実TAKT compiler/session/Phaseの隔離fixtureを使う。現中央状態へ偽reportを作らない。以下のnamed assertionsをplanへ索引し、原ACを保持する。

- recovery-exact-rejection-regenerates-prefix-only
- recovery-current-design-approval-required
- recovery-forged-or-incomplete-rejection-zero-writes
- recovery-historical-selection-and-output-tamper-rejected
- recovery-wrong-run-session-or-active-rejected
- recovery-unknown-or-later-review-rejected
- recovery-topology-or-AC-change-rejected
- recovery-rejection-member-receipt-and-finding-binding
- recovery-source-change-reruns-whole-prefix
- recovery-latest-failed-running-no-success-fallback
- recovery-concurrent-authority-input-or-writer-rejected
- recovery-interruption-retains-failure-without-approval
- recovery-idempotent-post-report-gate-same-receipts
- recovery-progress-selection-old-evidence-protected-unchanged
- recovery-no-dependent-selection-or-seal-before-new-review
- recovery-real-cli-and-frozen-engine-gate
- recovery-exact-fresh-review-import-then-normal-selection
- recovery-legacy-init-and-readonly-final-remain-strict
- recovery-two-rejections-new-receipts-new-plan-then-exact-import
- recovery-root-equality-only-at-bootstrap
- recovery-descendant-rejection-binds-producing-attempt
- recovery-chain-missing-mixed-tampered-or-forked-zero-writes
- recovery-old-rejection-or-head-replay-rejected
- recovery-plan-suite-change-requires-matching-design-approval
- recovery-latest-incomplete-review-blocks-descendant-attempt
- recovery-same-parent-failed-attempt-retry-retains-chain
- recovery-terminal-publication-crash-and-concurrent-head
- recovery-approval-import-validates-chain-without-rejection-authority

negative認証はfiles/dirs/bytes/mtimeとFS mutation監視でゼロwriteを検証する。正常再生成でもprogress/旧証拠を同様に比較し、実suite失敗・kill・競合後に承認が増えないことを検査する。成功statusだけのfixtureは不可。全scope4業務・数値・DISCの試験は別途必須であり、本suiteの成功で代替しない。

連続差戻しの必須シナリオはS/P0→J0→実CLIで全prefix R1/P1→別sessionのJ1→ソース・suite変更（plan変更には新設計承認D2）→保存済みworkflowの通常batch gateで全prefix R2/P2→新しい独立APPROVE→正規import→通常B02 selection。R1/R2の全member IDはSと異なり、P1/P2もP0と異なるfixtureを使う。J1以後の再生成成功と、J0再利用/任意receipt差替えの拒否を同時に示す。各APPROVE前にB02/seal/final拒否、各再生成のprogress/S/旧証拠不変を検査する。importだけが承認projectionを更新できる。実fixtureで記録したPhase/session/CLI argv/exitと全prefix実行回数をassertし、メモリ上の状態遷移図だけでは合格にしない。

## Historical design boundary — iteration 8

今回runは初期化済みでactive B01。旧runの差戻し・後続failed terminalの保存機能は実装済みである。以下はiteration 8で追加した通常gate更新認証の契約で、現在コードには実装がある。再初期化・承認取込み・再生成は設計stepでは実行しない。

### 2.3 Iteration 8: 通常gateによる先行receipt更新の起点認証（既存実装・再検証必須）

本節はsection 2の「J0の先行receiptは必ずSと同一」のみに、限定された別形式を追加する。既存の同一receipt起点はそのまま厳格に検証する。以後のattempt・独立review・import・sealの条件は免除しない。今回runは初期化済み、active B01で、最初の拒否はiteration 6/BF-43である。iteration 8時点はinitial rejection predecessor mismatchで停止した。iteration 14の停止理由はresultPath不一致である。

観測したSはselection 079741b4-e0fe-48a7-8373-ae2be6d6f77e、前提B00は1792666908061-c2220196-aa09-48ab-943e-faef6b8a1b8c。iteration 5ではENT-103試験の変更後、通常gateがB00 1792669658449-ff5e5ad6-3396-4116-907e-4b68eaa8ab06とB01 1792671020930-9227d184-8757-46f4-bd77-1e4196e15c17を作った。Phase 1/2は両receiptとcandidate 453b3ab1f79f6979b69aae9e142ca29740c18cae519823235946f2c2f91cd02dを明示する。報告後gateでB01 1792671579527-379be04d-b00f-43e3-95fc-8c5c275b5a4aとcandidate 757c75a9893709230d6a3842c351ef767c5331094982db8e39e916e68530d8b9が最新になり、実独立J0が後者を審査して拒否した。時刻だけからgate成功を認証してはならない。NDJSONのstep_complete.timestampはPhase 1終了時刻で、post-report境界には使えない。

認証する鎖はS→G（通常実行・candidateの全履歴）→J0。Sの全元承認・元receipt・元plan・selection raw hashを既存as-of検査で認証する。J0のplanTextはSと完全一致し、active/prefix/AC/依存も一致する。この追加形式は選択後・最初の拒否前のソース/試験本体変更に限る。plan変更、既存rootの後付け更新、別activeの起点修復は拒否する。現在planの変更は従来どおり新しい独立設計承認を要する。

Gには次の全参照を検証して保存する。product側のhandoff、時刻、同じsession文字列、candidate hashだけでは認証できない。

1. 実orchestratorが固定run/workflow/bundleに記録した選択を行ったbuild occurrence、Phase 1/2の完了内容とそれぞれのhash、実provider/session、Astra/high writer、編集可能なcompiled stepを解決する。選択はSの承認review完了後、最初のJ0の開始前。同provider sessionは複数occurrenceで再利用されるため、開始記録index・phaseExecutionId・内容を含めて一意に照合する。元承認以降J0より前のreviewを全列検査し、対象scopeの後続承認/拒否や未完・未知scopeを飛ばさない。
2. Sの前提receiptを含むindex prefixと、選択後からJ0開始直前までに追記された全entryを連続して照合する。今回の最初のB01 failed、B00 passed、B01 passed、post-report B01 passedの4 entryを一つも省略しない。全receiptのID/path、status、builder、入力manifest、実suite定義/argv/cwd/runtime/start/end/exit/signal、stdout/stderrと全出力の実bytesを確認する。failedの部分TAPに成功を要求せず、実非ゼロ失敗として保持する。running、未終端、欠損、二重ID、順序逆転、index prefix改変、説明できない別writerや余分なentryは停止する。失敗を成功へ読み替えない。
3. Phase 1/2に明示された通常candidate Cとその全memberを、当時のplanと入力、完了receipt、raw/canonical hash、出力、実builderに照合する。両phaseで機械identityが一致することを要し、単なる「exit 0」記述は不可。Cの前提が更新される理由はSのmanifestとCのmanifestのソース/試験差分で確認する。SとCのplan bytes、元AC、prefix topologyは一致する。旧receiptと旧承認は元のまま残す。
4. J0はcanonical report・同一Phase 1/2 block・実readonly/Astra/high・独立provider session・完了occurrence・空approvedIssueIds・非空findingで認証する。J0のcandidate C0はJ0開始直前のindexにおける全prefixの最新passed receiptに厳密一致する。CとC0が同一なら同一hashを検査する。異なる場合は、C以後の全追記を固定workflowの通常batch再呼出し規則で検証する。既に現在入力で成功した前提を保持し、activeだけ再実行する場合も許すが、C0の全memberは同一input/plan・全suite成功・同じ実builderであることを要する。Cから保持する前提memberは同じreceiptを維持し、再実行するactive memberだけがCの後かつJ0開始前に完了していなければならない。入力変更、前提の再差替え、未完gate、飛ばしたentry、C0未記載、J0以前の別reviewは拒否する。通常gateコード・有効gate定義のhashと実fixtureでこの規則を検証し、中央記録にない「gateイベント」を捏造しない。
5. Gは由来のprivate evidence projectionでありAPPROVEではない。S/J0/C/C0、全中間receipt/出力/index区間、実phase記録の参照とraw hashを新形式root(schemaVersion=2, ordinaryRefresh)へ固定する。rootIdはraw bytes hashで、参照はS/receipt/C/C0/J0→G→root→新attemptの一方向。自己hashやcandidateとresultの循環は禁止する。既存schemaVersion=1のstrict起点/root bytesは変更しない。同run/selectionに既存rootがあれば完全一致を要求し、別形式への書換えやforkは拒否する。
6. 認証後・lock取得直後・immutable root/header発行前に同じ入力/plan/契約/selection/progress/index/中央authorityとGの全参照を再検査する。事前不一致は書込みゼロ、競合取得時は自分のlock解放だけ。中断/atomic publicationとpost-reportの同一receipt維持はsection 3に従う。Gを自己申告headerとして過去receiptに追加しない。
7. 実装は選択済みB01内でENT-101を変更し、B00/B01の全必須suiteを現在入力で再実行する。新receipt/candidate/terminalは未承認の機械証拠のみ。通常batchと--recover-rejectedは同一認証へdispatchする。progress/元selection/旧index prefix/保護対象/中央状態は不変。独立review-foundationがBF-43、BF-42、原15 ACと全6 Issueをexact receiptで審査しAPPROVEを正規importするまで、B02選択・VERIFIED・sealを認めない。
8. validateRecoveryApprovalと新run用history readerもschemaVersion=2の同じ由来鎖を認証する。initializer内の歴史保存は空の新承認集合に限り、同run再初期化は禁止。APPROVE後は歴史検証であって再生成許可ではない。旧schema1/legacy候補とreadonly finalの厳格性を保持する。新契約/plan hashへの独立設計承認と実Astra/high builderを実装の前提とする。

追加named assertions（iteration 8で既存28件に追加した12件。現在コード/保存済み試験は存在するが、変更後入力で再検証する）:
- recovery-refresh-authenticated-selection-to-ordinary-candidate-to-first-rejection
- recovery-refresh-original-approval-and-plan-equality-remain-strict
- recovery-refresh-builder-phases-session-and-independent-rejection-required
- recovery-refresh-entire-index-interval-including-failed-and-post-report-runs
- recovery-refresh-missing-mixed-forked-running-or-tampered-zero-writes
- recovery-refresh-candidate-latest-prefix-and-source-output-binding
- recovery-refresh-legacy-equal-root-and-new-version-no-root-rewrite
- recovery-refresh-readonly-design-and-builder-provenance-no-authority
- recovery-refresh-concurrent-publication-and-idempotent-post-report
- recovery-refresh-new-prefix-receipts-exact-review-import-before-next-batch
- recovery-refresh-initializer-history-only-and-final-zero-write
- recovery-refresh-real-cli-frozen-gate-and-independent-bf43-review

隔離fixtureで実TAKT Phase/session/通常CLI/frozen gateを動かし、SのB00とC0のB00が異なる正例、最初のB01失敗、C→post-report C0、J0拒否、二回の再生成拒否からexact APPROVE/import/通常B02選択まで検証する。欠損・偽造・未完・別run/step/session・plan変更・後続review・余分receipt・stale latest・途中出力改変・競合ではFS mutation監視とbytes/mtime比較で拒否を確認する。root schema1とinitializer/finalの既存反例も再実行する。この設計の構造検査成功は追加経路の実装成功ではない。

## Iteration 14: invalid review revalidation (planned)

[REVIEW_REVALIDATION.md](REVIEW_REVALIDATION.md) の明示命令・schema2履歴・全consumer検証をENT-101の同じsuiteへ追加する。次の16 assertionは未実装・未実行であり、既存40件を保持する:

- recovery-revalidation-original-malformed-approve-rejected-and-preserved
- recovery-revalidation-explicit-independent-design-order-required
- recovery-revalidation-only-result-path-defect-accepted
- recovery-revalidation-real-phases-sessions-and-all-AC-binding
- recovery-revalidation-invalid-or-existing-path-zero-writes
- recovery-revalidation-original-root-and-full-history-strict
- recovery-revalidation-full-prefix-new-receipts-before-fresh-review
- recovery-revalidation-versioned-authority-no-fake-rejection-or-hash-cycle
- recovery-revalidation-new-rejection-and-second-invalid-review-chain
- recovery-revalidation-later-incomplete-review-and-order-replay-rejected
- recovery-revalidation-changed-plan-new-design-order-required
- recovery-revalidation-crash-concurrent-authority-and-input-failure-retained
- recovery-revalidation-idempotent-frozen-post-report-gate
- recovery-revalidation-exact-import-only-then-normal-selection
- recovery-revalidation-progress-old-evidence-and-protected-bytes-unchanged
- recovery-revalidation-history-only-initialization-and-final-zero-write

## Iteration13 failed interval extension (not implemented)

See [FAILED_INTERVAL_RECOVERY.md](FAILED_INTERVAL_RECOVERY.md). Its superseding distinct-run history contract requires source preparation and a separate target initialization order; no same-run generation permission is granted. ordinaryOrigin/bootstrap/current approval remain strict.
