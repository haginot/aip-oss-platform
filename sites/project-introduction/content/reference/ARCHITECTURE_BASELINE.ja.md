# Architecture Baseline

[English](./ARCHITECTURE_BASELINE.md)

## 1. 出典と位置づけ

このbaselineは参照設計 `aipf-modular-architecture-20261010` の2026-10-10版を、実装開始時の設計入力として要約したものです。元成果物は参照設計と候補カタログであり、Adapterや実行基盤の実装済み証拠ではありません。元ファイルのhashはリポジトリの `architecture/SOURCE_BASELINE.json` に固定します。

## 2. 中心原則

製品名ではなく、業務の意味、公開契約、能力を中心に置く。業務UI、Rules、Agentは共通の型付き契約を呼び、製品固有のSQL、SDK、認証、再試行はAdapter内へ閉じる。交換可能とはAPIの形が似ていることではなく、機能適合、意味差、状態移行、rollbackが検証されていることを指す。

プラットフォームが所有する境界は次の六つである。

1. Ontology: Object ID、型、単位、Link、Action、属性ごとの正本、定義版。
2. Object API: get、有限filter、cursor、revision、freshness、projection、認可。
3. Action Engine: actor/delegation、制約、期待版、冪等性、承認、状態、証拠。
4. 認可の合成: 関係、属性、環境、拒否優先、信頼済みcontext、失効。
5. Event/Evidence: ID、schema/版、因果、再送、Actionと判断の証拠。
6. 公開管理: diff、互換性、simulation、review、publish、migration、rollback。

## 3. 実行経路

- 読み取りは、認証、Object API、必要な認可、正本または投影、行・列制御を経て、revisionとfreshnessを返す。
- AI参照は、信頼済み主体を確定してから許可範囲を検索し、権限のない内容をモデルへ渡さない。
- AI実行は型付きAction提案までとし、Action Engineが実行時の主体、委任、権限、制約、版、承認を再検査する。
- 更新は同じUnit of WorkでObject revision、Action記録、Outboxの原子性を持つ。外部ERPや監査保管先まで同一transactionとは主張しない。
- 動的処理はEvent/Timerから提案を作っても、Action境界を再通過する。causation ID、冪等性、回数・費用上限でloopを制御する。

## 4. 共通の意味

ObjectRefはtenant、type、安定したobject IDを持つ。ObjectRevision、DefinitionVersion、PolicyVersion、RuleVersion、ModelVersion、IndexWatermark、SourcePositionを別型として扱う。時刻は業務上の有効時刻と記録時刻を分け、金額は通貨と精度、数量は単位を持つ。NULLと未指定を区別する。

全Portはtimeout、cancel、trace、版、認証文脈、size上限、typed errorを定義する。少なくとも InvalidInput、Denied、Conflict、NotFound、UnsupportedCapability、Unavailable、DeadlineExceeded、RateLimited、InconsistentState を揃え、再試行可能性と冪等性を分ける。

## 5. 47責務

全責務について `selected`、`provided`、`not-needed` のいずれかを記録し、`undecided` のままArchitecture gateを越えない。一つの製品やモジュールが複数責務を担ってよいが、保証はroleごとに確認する。

| 領域 | role IDs |
|---|---|
| data | ingest, cdc, pipeline, transform, quality, identity-map, blob, lake-table, analytics |
| semantic | ontology, object-api, object-store, graph, text-search, retrieval, history, metrics |
| kinetic | rules, compute, action, workflow, writeback |
| dynamic | event, stream, trigger |
| ai | agent, model, embedding, parse, ai-eval, guard, feature |
| security | identity, relationship-auth, attribute-auth, delegation, secrets |
| ops | metadata, audit, observability, schema-release, deployment, gateway, cache, recovery |
| ux | business-ui, authoring-ui |

特に ontology、object-api、action、identity、attribute-auth、delegation、secrets、audit、observability、schema-release、deployment、recovery、business-ui、authoring-ui は初版の必須責務である。専用製品が必須という意味ではなく、同一processや既存基盤で担う場合も契約と検証を明記する。

## 6. 実装順序

Ontologyの最小型、Object API、Action、認可、状態/Outbox、監査証拠から始める。次に店舗シナリオへ必要なWorkflow、外部反映、イベント、UIを垂直に通す。その後、AI、検索、高度なstream、分析を、実際のscenarioに必要なものから追加する。

初期のOSS既定構成は少数componentを優先する。PostgreSQLが状態、link、履歴、Outboxを同時に担ってもよい。専用graph、vector、broker、workflow engineは、要求する機能profileと運用価値が証明されるまで追加しない。

## 7. 交換と移行

- stateless接続: 並行検証、経路切替、rollback。
- 検索/graph投影: 正本から再構築、shadow比較、鮮度・削除・ACL照合。
- 状態/Event正本: snapshotとCDC、更新停止点、照合、切替、再開位置、rollback。
- Workflow: 旧実行を旧基盤で完了し、新規開始から切替。
- 認可/Rules: 同じ正例・反例corpusで判定差分を検査。
- Model/embedding: 業務評価を再実行し、必要なら再埋め込み・再索引。

初版のAC-007ではこのうち少なくとも一つを実行し、単なるmock差替えや同じ実装名の変更を交換実証に数えない。

## 8. 横断試験

状態・Actionでは同時更新、再送、入力違い、途中失敗を試す。認可ではget、list、search、column、count、Action、revocation、判定障害を揃える。AIでは不正主体、権限外tool、古い承認、根拠不足を拒否する。Eventでは重複、逆順、欠損、再生、schema更新を扱う。Workflow/Writebackではtimeout、承認待ち、再試行、補償、成功不明を扱う。復旧では状態、定義、鍵参照、権限、実行履歴の整合点を実際に戻す。

これらは実装前の試験仕様であり、文書に記載しただけで検証済みとは扱わない。
