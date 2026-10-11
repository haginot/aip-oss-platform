# Platform artifact contract

## Authority

1. `PRODUCT_GOAL.md` が製品scope、AC、不変条件、自律境界の正本である。
2. `architecture/SOURCE_BASELINE.json` は元設計の出典とhashを固定する。元資料はruntime依存にしない。
3. `architecture/composition.json` は47責務すべての採用、内製、非採用判断を保持する。47 serviceを意味しない。
4. `work/ROADMAP.json` はACからmilestoneへの追跡を保持する。
5. `verification/plan.json` が機械検証の宣言、`evidence/run-manifest.json` が入力・出力hash付きの実行receiptである。
6. `evidence/ACCEPTANCE_MATRIX.md` は各ACの状態と証拠への索引であり、証拠そのものを置き換えない。

## Stage contract

- goal: 正本と設計出典が固定される。
- architecture: 47責務の判断と公開Port、信頼境界、整合性境界、障害意味論が決まる。
- plan: すべてのACを依存関係つきmilestoneへ割り当てる。
- implementation: Ontology/Object/Action、認可、委任、Outbox、Auditの実動sliceと反例試験を持つ。
- demo: 商品回収・代替調達を同一の実動基盤で完走する。
- bcp: WAN/基幹停止、成功不明、復旧、照合、補償を注入して計測する。
- release: clean bootstrap、Adapter交換、運用・供給網検査を満たす。
- final: AC-001〜AC-008をcurrent codeへ辿り、AC-009を独立監査する。

各実装stageは検査可能なsuiteを `verification/plan.json` に追加し、suiteの `inputs` に対象source、test、configを、`outputs` に再生成可能な成果物だけを列挙する。receipt生成後に入力が変わった場合は再実行する。
