import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Localized labels for the deterministic vector diagram, not generated imagery.
const labels = {
  '業務の意味・実行ルール・データ・AIを、共通の契約でつなぐ。':'Business meaning, execution, data and AI. Connected by shared contracts.',
  '意味とルールは企業が所有。技術は交換可能に。':'Own the semantics. Keep technology replaceable.',
  '企業が所有する契約':'Enterprise contracts','実装・外部接続':'Implementations',
  '利用・開発':'Experience','人とAIが使う':'Shared entry points','共通の入口':'for people and AI',
  '業務担当者・承認者':'Operators and approvers','業務画面 / 判断 / 承認':'Operations / Decisions / Approvals',
  'ドメイン管理者・開発者':'Domain owners and developers','Ontology / Rules / 公開':'Ontology / Rules / Publishing',
  'アプリケーション':'Applications','AIエージェント':'AI agents','検索 / 提案 / 型付きTool':'Retrieval / Proposals / Typed tools',
  '運用・監査担当者':'Operations and audit','監査 / 運用 / 復旧':'Audit / Operations / Recovery',
  '信頼・認可':'Trust & access','主体と権限を確定':'Establish authority','すべての入口に適用':'at every entry point',
  '経路 / 制限 / Trace':'Routing / Limits / Trace','OIDC / 主体':'OIDC / Principals','テナント分離':'Tenant isolation',
  '委任 / 期限 / 失効':'Scope / Expiry / Revocation','関係ベースの認可':'Relationship-based access','属性 / 環境 / 拒否優先':'Attributes / Context / Deny',
  '業務の中核':'Business core','企業が所有する':'Enterprise-owned','意味・ルール・証拠':'Semantics / Rules / Evidence',
  '業務UI・Rules・AIは同じ契約を利用':'Business UI, rules and AI share the same contracts',
  'Object ID / 型 / 単位 / 関係 / 正本':'Object ID / Types / Units / Links / Source of truth',
  'Revision / 履歴 / 鮮度 / 指標':'Revision / History / Freshness / Metrics',
  '主体・委任・権限・制約・期待版を再検査':'Recheck actor, delegation, authority and revision',
  '承認 / 冪等性 / 状態遷移 / 実行証拠':'Approval / Idempotency / Transitions / Evidence',
  '権限内の検索 / 根拠付きの型付き提案':'Authorized retrieval / Evidence-based typed proposals',
  'READ  →  認可済みObjectと根拠':'READ  →  Authorized objects and evidence',
  'WRITE  →  Action境界を必ず通過':'WRITE  →  Always cross the Action boundary',
  'AI  →  提案と実行権限を分離':'AI  →  Proposals do not confer authority',
  '実行・データ':'Execution','確定・連携・取り込み':'Commit / Connect / Ingest','失敗から回復できる設計':'Design for recovery',
  '同一UoWでローカル原子性':'Local atomicity in one unit of work','履歴 / revision / 同時更新':'History / Revisions / Concurrency',
  '因果ID / 重複排除 / Loop上限':'Causality / Deduplication / Loop limits',
  '外部反映 / Receipt / 照合':'External effects / Receipts / Reconciliation','UNKNOWN / 再試行 / 補償':'UNKNOWN / Retries / Compensation','外部システムは別transaction':'External systems commit separately',
  'Quality / ID対応 / Checkpoint':'Quality / Identity mapping / Checkpoint','Graph / Text / Vector / 集計':'Graph / Text / Vector / Aggregates',
  '接続契約':'Contracts','製品依存を隔離':'Isolate product choices',
  '型・認証文脈・版・Timeout・Cancel・Trace・Typed error・Capability':'Types / Auth context / Version / Timeout / Cancel / Trace / Typed errors / Capabilities',
  '技術の実装':'Technology','小さく開始し':'Start small','必要な責務から分離':'Split as needs emerge',
  '状態 / Link / Action / 履歴 / Outbox':'State / Links / Actions / History / Outbox',
  'ローカルIdentity / Policy / Audit':'Local identity / Policy / Audit',
  'Synthetic ERP / ファイルRecovery Journal':'Synthetic ERP / File recovery journal',
  'まず少数のコンポーネントで垂直に通す':'One end-to-end path with a small component set',
  'PostgreSQL以外への置換保証とは区別':'Not proof of a non-PostgreSQL replacement',
  '候補例 · 接続・適合性の検証は別途':'Candidates only · Integration and conformance need validation',
  '横断コントロール':'Shared controls','すべての層に適用':'Across all layers',
  '認可判断 / 実行証拠':'Access decisions / Evidence','拒否優先 / 失効 / 保全':'Deny / Revoke / Preserve',
  'カタログ / 来歴 / 正本':'Catalog / Lineage / Authority','定義とデータの対応':'Definitions mapped to data',
  'Schema / Policy / Rule版':'Schema / Policy / Rule versions','Conformance / 意味差':'Conformance / Semantic diff','Shadow比較 / 業務評価':'Shadow / Business evaluation',
  '可観測性 / 費用 / SLO':'Observability / Cost / SLO','状態移行 / Rollback':'State migration / Rollback',
  '外部の世界':'External estate','既存資産を接続':'Connect existing assets','正本と責任境界を維持':'Keep ownership explicit',
  'Actionの反映と結果照合':'Apply Actions and reconcile results','取得 / 同期 / 再開位置':'Ingest / Sync / Resume position','Parse / Index / 権限同期':'Parse / Index / Permission sync','分析 / 指標 / 長期保管':'Analytics / Metrics / Retention','推論 / 外部Tool / 鍵管理':'Inference / External tools / Keys',
  'AIから業務実行まで':'From AI to action','権限と証拠を保った一本道':'Preserve authority and evidence',
  '許可範囲の検索':'Authorized retrieval','権限外の内容を渡さない':'Only permitted content',
  '型付き提案':'Typed proposal','Actionの候補を作る':'Propose a business Action',
  '実行時の再検査':'Execution checks','主体・制約・版・承認':'Actor / Constraints / Revision / Approval',
  'ローカル確定':'Local commit','外部反映・照合':'Deliver and reconcile','成功不明も追跡・回復':'Track and resolve unknown outcomes',
  '証拠・監査':'Evidence and audit','結果と判断根拠を保存':'Preserve results and decision basis',
  '参照設計：ARCHITECTURE_BASELINE.ja.md  ·  製品名は候補を含む。実装済み・接続済み・検証済みを示す図ではありません。':'Reference: ARCHITECTURE_BASELINE.md · Product names include candidates. This is not an implementation, integration or verification status report.',
};
const decode = s => s.replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>');
const encode = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export async function translateArchitecture(dist) {
  const dir=path.join(dist,'assets/architecture');
  const source=await readFile(path.join(dir,'aip-oss-architecture-clean.svg'),'utf8');
  const english=source.replace(/<text\b([^>]*)>([^<]*)<\/text>/g,(whole,attrs,content)=>{
    const original=decode(content); const value=labels[original];
    if(!value){if(/[\u3040-\u30ff\u3400-\u9fff]/.test(original))throw new Error(`Missing translation: ${original}`);return whole;}
    const size=Number(attrs.match(/font-size="([\d.]+)"/)[1]);
    // Avoid overflowing boxes after localization. Estimate Japanese glyphs at 1em,
    // Latin at .54em; preserve hierarchy with a bounded font-size reduction.
    const width=s=>Array.from(s).reduce((n,c)=>n+(/[\u3040-\u30ff\u3400-\u9fff]/.test(c)?1:.54),0);
    const ratio=width(value)/Math.max(width(original),1);
    const localizedSize=Math.round(size*Math.min(1,1.17/ratio)*10)/10;
    return `<text${attrs.replace(/font-size="[\d.]+"/,`font-size="${Math.max(size*.78,localizedSize)}"`)}>${encode(value)}</text>`;
  });
  await writeFile(path.join(dir,'aip-oss-architecture-clean.en.svg'),english);
}
