# Verification snapshot / 検証スナップショット

Records inspected: October 13, 2026 / 記録確認日：2026年10月13日

This is an editorial summary of the development checkout's acceptance matrix and implementation notes inspected for the article rewrite. The full product test suite was not rerun for this article. PASS is scoped to the linked machine-verification records, not a claim of production readiness or final independent approval.

本記事の改稿時に開発用チェックアウトの受入表と実装資料を確認した要約です。製品の試験一式は再実行していません。PASSは各検証記録の範囲を示し、本番運用の認定や最終独立監査の承認を意味しません。

| Criterion | Recorded state | Scope and limits |
| --- | --- | --- |
| AC-001 | PASS | Clean macOS startup and OSS build-tool checks. Not every OS or deployment environment. |
| AC-002 | PASS | Bounded versioned Ontology, Object queries, typed Actions, real PostgreSQL and HTTP. Not every possible domain model. |
| AC-003 | PASS | Actor/delegation and fail-closed list/search/column authorization, including restricted ERP-field handling. No business-runtime model service adopted. |
| AC-004 | PASS | Recorded concurrency, retries, deadlines, cancellation, and partial-failure checks. Not a universal production failure guarantee. |
| AC-005 | PASS | Two-store synthetic API demo for recall, quarantine, approvals, substitute purchasing, and customer-response flows. No real orders or customer messages. |
| AC-006 | PASS | Local synthetic logical-backup restoration and external-effect reconciliation. Clean cases check zero loss, duplicates, and unresolved outcomes; a deliberate post-checkpoint-loss case reports one lost mutation and a manual hold. Physical WAL replay and host loss are outside scope. |
| AC-007 | PASS | Canonical PostgreSQL scan versus a persistent JSONB-derived index, including comparison, cutover, and rollback in the same database and SQL snapshot. No non-PostgreSQL migration or performance claim. |
| AC-008 | PASS | Startup, declared dependency/vendor-runtime inventory, security checks, and operating-procedure records. Not a whole-OS SBOM, absence of unknown vulnerabilities, long-term real retention, or major database-upgrade certification. |
| AC-009 | READY_FOR_REVIEW | Final independent audit awaiting approval. Earlier findings and focused repair reviews do not establish approval of the complete repaired system. |

The reference ERP uses a separate database and principal on the same PostgreSQL server. That is a useful transaction and authorization boundary, not evidence of independently failing physical hosts. Process termination exercises and logical database restoration are distinct from loss of the database host.

参照ERPは同じPostgreSQLサーバー内の別データベース・別主体を使います。トランザクションと権限は分かれていますが、物理ホストの独立故障を検証した構成ではありません。プロセス停止や論理復元と、データベースホストの喪失は区別します。

The architecture map lists candidate extension technologies. Their appearance does not indicate adoption, integration, license review, or conformance validation. The current implementation rejects capabilities that have not been adopted; it does not silently substitute a production AI model or service.

全体図の拡張製品は候補例です。採用、接続、ライセンス確認、適合性検証の完了を示しません。現在の実装は未採用の能力を拒否し、実際のモデルやサービスを暗黙に補いません。

For provenance, SHA-256 of the inspected `evidence/ACCEPTANCE_MATRIX.md`:

`89b21ecb3e6f9bd300041374a85c84eaa6114d1be5b61f941758396e4b7df272`

This checksum identifies the inspected record, not the current state of a moving development branch. Internal paths, raw run receipts, supervision instructions, and credentials are intentionally not published here.
