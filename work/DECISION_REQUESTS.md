# Human Decision Requests

## 運用規則

価値判断、外部権限、費用、機密、license、scope変更が必要な場合だけ記録します。各項目には状態、阻害されるmilestone、選択肢、既定値を推測できない理由、判断後の再開位置を含めます。

DR-ARCH-001の内製コード配布license判断は解決済みです。外部OSSの一次資料照合と設計・検査の準備を維持し、同じarchitecture runの安全な再開点から続行します。

判断待ちの項目を作るときは、根拠となるfile・検査結果、未決定の選択、推奨案と代替案の影響を記録し、対応するworkflowをABORTで止めます。判断済みの項目は削除せず、決定内容、判断者、日時、再開工程を追記します。開発モデルの既存アカウント利用はPRODUCT_GOALの範囲に含まれますが、新規の契約や追加購入は含まれません。

## DR-ARCH-001 — 内製コードのOSS配布license

- 状態: RESOLVED（2026-10-12、監督者がチャット内で推奨案MITを明示承認）。
- 根拠: package.jsonにlicense宣言がなく、repository rootにLICENSEがない。PRODUCT_GOAL.md AC-008は既定構成のOSS再配布を要求し、停止条件は「ライセンスまたは商標上の配布可否が未解決」。開始・監督指示はlicense未解決を委任から除外している。
- 阻害範囲: design-architectureのcomposition approved、review-architectureへの合格引渡し、内製物のOSS配布license確定。PRODUCT_GOALとACを変更しない。外部OSSのNode.js/pg MITとPostgreSQL licenseはarchitecture/OSS_BASELINE.jsonの一次資料で確認済み。
- 選択肢: MIT（短いnoticeで再配布可能）、Apache-2.0（明示的patent条項とnotice管理）、保留（設計draftを保持しworkflow停止）。
- 推奨案: MIT。既定として確定できない理由は、内製著作物の配布licenseが権利者の判断を要し、今回の自律委任にlicense未解決の判断が含まれないため。第三者OSSのlicense/noticeはそのまま保持する。
- 決定: 内製コードをMITで配布する。外部OSSの個別licenseとnotice義務は変更せず、release gateでSBOM・notice・再配布検査を行う。外部公開やpushの承認を意味しない。
- 安全な再開点: 監督者の明示回答を記録→LICENSEとpackage.json/package-lock.jsonのlicense宣言を追加→OSS_BASELINEのinternalLicenseDecisionとcompositionのlicenseを確定→composition.statusをapproved→docs/DECISIONS.md D-10の判断を更新→architecture suiteとmechanism suiteを再実行し、現在入力hashの成功receiptを確認→別session review-architecture。既存失敗receiptは削除しない。


## DR-FOUNDATION-001 — 反復するsandbox共有メモリ制約と検証再開環境

- 状態: RESOLVED（2026-10-12 11:11 JST、監督者が推奨案Aを適用）。AC/scopeは変更していない。
- 根拠: PRODUCT_GOAL.md §6「同じ阻害要因が3回反復し、技術的追加作業では情報が増えない」。native initdbは複数のsuiteおよびnpm testで `FATAL: could not create shared memory segment: Operation not permitted` / `shmget(... size=56 ...)` を再現した。evidence/generated/foundationの各JSONに実stderrを保持。現在のNode 25.4.0/PostgreSQL 14.20は承認済み22.22.0/18.6と異なり、Docker daemonも未接続。DB代替mockやversion検査の緩和を行っていない。
- 阻害範囲: M-01〜M-03の実DB試験、AC-002〜AC-004の成功receipt、review-foundationへの合格引渡し。実装の未完項目はdocs/IMPLEMENTATION.mdに残し、環境だけ整えば全ACが通るとは判断しない。
- 選択肢: (A) 既存のローカル隔離環境で固定版Node/PostgreSQLと共有メモリを利用可能にして再開する、(B) 既存のローカルDocker環境を利用可能にし固定版の隔離container構成を実装・検証する、(C) この環境では未達として停止を維持する。外部公開・新規課金・credential変更・既存DBへの接続は全案から除く。
- 推奨/既定案: A。再開まではCを安全な既定動作とする。agent自身がsandbox権限を拡張またはDocker daemonを変更する判断はしない。承認済み自律境界内で検証可能な環境へ戻す方法を監督側で選ぶ。
- 決定と根拠: ローカルの隔離cloneに `mise.toml` を追加し、Node 22.22.0とPostgreSQL 18.6を導入した。Docker daemonは無関係な既存containerへ影響し得るため再起動していない。固定版の実PostgreSQLで初めて露見した、`SELECT ... FOR SHARE` に必要な権限不足とsnapshot JSONB配列の直列化不良を修正した。`npm run foundation:test` は6 suites・45 tests・failed 0・skipped 0で成功し、receipt `20261012021134898-implementation-7ea276` を生成した。過去の失敗証拠は保持している。
- 再開点: 同一taskを正規にrequeueし、build-foundationの成果を独立review-foundationへ渡す。固定版起動構成、独立ERP、生成client、別volume、後続demo/BCPの未達項目はworkflowで引き続き検証し、今回の解決だけでAC-002〜AC-004または全ACの合格とはしない。


## DR-FOUNDATION-002 — 再queue後のagent sandboxで固定版DB起動が再度拒否

- 状態: RESOLVED（2026-10-12 13:12 JST、監督者が推奨案Aを適用）。DR-FOUNDATION-001の監督者によるRESOLVED記録と過去の成功receiptは変更しない。
- 根拠: miseでNode v22.22.0/PostgreSQL 18.6を確認した後も、bootstrap、全体npm test、6 suite個別診断でinitdbの `shmget(... size=56 ...)` がOperation not permittedとなった。migration/seed/業務assertion前の停止。同じ阻害が3回以上反復した。Docker daemonにも接続できない。非DBのclient生成・実HTTP transport・journalのSIGKILL再起動・復旧範囲metadata反例を追加し、これらは成功したが、DB起動制約について追加検査で情報は増えていない。
- 阻害範囲: M-01〜M-03の実DB検証と現在入力の成功receipt。同じ経路で状態・認可・Action・Outbox・Auditの不変条件を検査する完了条件を満たせない。AC-002〜AC-004はFAIL。ERP等の欠落実装も別途残る。
- 選択肢: A: 既存の隔離ローカル環境で、固定版DBの共有メモリを利用できるagent実行profileへ戻して同じsource/testを再実行。B: 既存Docker環境を監督側で利用可能にし、別volume/独立ERP構成を実装・検証。C: このsandboxでは未達として停止を維持。外部資源・新規課金・credential変更・既存DBへの接続は含めない。
- 推奨案: A。再開まではCを安全な既定動作とする。agent自身はsandbox権限やDocker daemonを変更できず、監督者の環境での過去成功を今回の成功に置き換えない。
- 決定と根拠: 対象runの失敗時刻・作成PIDと一致し、`NATTCH=0` だった56-byte SysV共有メモリだけを明示IDで回収した。常駐PostgreSQLのsegmentと用途不明の別segmentは保持した。TAKTのbuilder/critical profileへ `permission_mode: full` を追加し、DBを使うbuild/review工程だけをCodex `danger-full-access` にした。workflow doctor、固定版bootstrap、全foundation stageが成功し、現在入力のimplementation receipt `20261012041218922-implementation-519f49` を得た。Docker daemon、既存DB、credential、外部資源には触れていない。
- 再開点: build-foundation。npm ciのexit 0を確認→固定版bootstrap→実DBに接続されたgenerated-client HTTP試験と全6 suite→未完の独立ERP/別volume/混在client/lease/保持/定義lifecycle等の実装と反例検証→現在入力の成功receipt→別session review-foundation。環境のみの回復を製品合格とはしない。
