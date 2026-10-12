import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,validateDefinition} from '../../src/contracts.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const quote=JSON.stringify;
const scalar=f=>(f.type==='integer'?'number':f.type)+(f.nullable?' | null':'');
export function generateClient(definition) {
  validateDefinition(definition);
  const banner=`// Generated from config/ontology.json; ontology ${definition.ontologyVersion}; digest ${digest(definition)}.\n`;
  const runtime=banner+`import {createContractClient} from '../client-transport.mjs';
export const definition = ${JSON.stringify(definition,null,2)};
export function createClient(options) { return createContractClient(options,definition); }
`;
  const fields=Object.entries(definition.types).map(([name,t])=>`  ${quote(name)}: { ${Object.entries(t.fields).map(([k,f])=>`${quote(k)}: ${scalar(f)}`).join('; ')} };`).join('\n');
  const filters=Object.entries(definition.types).map(([name,t])=>`  ${quote(name)}: ${Object.entries(t.fields).filter(([,f])=>!f.restricted).map(([k,f])=>`{op: 'eq'; field: ${quote(k)}; value: ${scalar(f)}} | {op: 'in'; field: ${quote(k)}; values: ${f.type==='integer'?'number':f.type}[]}`).join(' | ')};`).join('\n');
  const declarations=banner+`export interface Fields {
${fields}
}
interface AtomicFilters {
${filters}
}
export type ObjectType = keyof Fields;
export type Filter<T extends ObjectType> = AtomicFilters[T] | {op: 'and'; terms: Filter<T>[]};
export interface ObjectResult<T extends ObjectType = ObjectType> {
  id: string; type: T; revision: number; fields: Partial<Fields[T]>;
  ontologyVersion: string; policyVersion: string;
}
export interface Cursor {snapshot: string; offset: number}
export interface Query<T extends ObjectType> {
  type: T; filter?: Filter<T>; projection?: (keyof Fields[T])[]; limit?: number;
  cursor?: Cursor; search?: string; order?: {field: keyof Fields[T]; direction: 'asc'};
}
export interface QueryResult<T extends ObjectType> {
  items: ObjectResult<T>[]; count: number; nextCursor: Cursor | null;
  ontologyVersion: string; policyVersion: string; watermark: 'authoritative';
}
export interface Evidence {id: string; revision: number; digest: string}
export interface SetIsolation {
  actionType: 'SetIsolation'; actionVersion: ${quote(definition.actions.SetIsolation.version)};
  ontologyVersion: ${quote(definition.ontologyVersion)};
  input: {targetId: string; isolated: boolean}; expectedRevision: number;
  idempotencyKey: string; evidence: Evidence[]; requireApproval?: boolean;
}
export interface ActionResult {
  actionId: string; operationId: string; revision: number;
  state: 'CONFLICT' | 'PENDING_APPROVAL' | 'PENDING_EXTERNAL' | 'SUCCEEDED' | 'EXTERNAL_FAILED' | 'MANUAL_REVIEW';
  result: {targetId: string; objectRevision?: number; recovery?: boolean; external?: string; approver?: string};
}
export interface CallOptions {signal?: AbortSignal}
export interface PipelinePlan {id: string; source: string; store: string; jobVersion: '1.0.0'; barrier: number; snapshot: {position: number; record: Record<string, unknown>}[]; changes: {position: number; record: Record<string, unknown>; releases?: number}[]; dependencies: string[]}
export interface PipelineResult {id: string; state: 'READY' | 'RUNNING' | 'SUCCEEDED' | 'CANCELLED'; cursor: number; total: number; inputDigest: string; jobVersion: string; barrier: number}
export interface Client {
  continuitySet(body: {store: string; mode: 'DEGRADED' | 'RECOVERING'; expectedRevision: number}, options?: CallOptions): Promise<{actionType: 'ContinuityMode'; actionId: string; store: string; mode: string; revision: number}>;
  recover(body: {store: string; checkpoint: string}, options?: CallOptions): Promise<{snapshot: Record<string, unknown>; results: Record<string, unknown>[]; unresolved: Record<string, unknown>[]; fenced: boolean}>;
  compensate(body: {actionId: string; expectedRevision: number; idempotencyKey: string}, options?: CallOptions): Promise<ActionResult>;
  capabilities(body?: Record<string, never>, options?: CallOptions): Promise<{version: string; unavailable: string[]}>;
  capability(body: {name: string}, options?: CallOptions): Promise<never>;
  scheduleCreate(body: {id: string; version: '1.0.0'; operationId: string; kind: 'consume' | 'reconcile'; startAt: number; intervalMs: number; missedRun: 'coalesce'}, options?: CallOptions): Promise<{id: string; nextAt: number; inputDigest: string}>;
  scheduleStatus(body: {id: string}, options?: CallOptions): Promise<{id: string; nextAt: number; fires: unknown[]}>;
  scheduleTick(body: {id: string}, options?: CallOptions): Promise<{state: string; fireId?: string; result?: unknown}>;
  identityResolve(body: {source: string; store: string; version: string; key: string}, options?: CallOptions): Promise<{objectId: string; version: string; mappingDigest: string}>;
  mappingDraft(body: {source: string; store: string; version: string; entries: Record<string, string>}, options?: CallOptions): Promise<{state: string; digest: string}>;
  mappingReview(body: {source: string; store: string; version: string}, options?: CallOptions): Promise<{state: string; digest: string}>;
  mappingPublish(body: {source: string; store: string; version: string}, options?: CallOptions): Promise<{state: string; digest: string}>;
  blobPut(body: {objectId: string; base64: string; sha256: string}, options?: CallOptions): Promise<{uri: string; sha256: string; size: number; version: string; retention: string}>;
  blobRead(body: {objectId: string; sha256: string; start?: number; end?: number}, options?: CallOptions): Promise<{base64: string; sha256: string; size: number; version: string; retention: string}>;
  blobDelete(body: {objectId: string; sha256: string}, options?: CallOptions): Promise<never>;
  analytics(body: {template: 'inventory-summary'; version: '1.0.0'; ontologyVersion: string; store: string}, options?: CallOptions): Promise<{count: number; quantity: number; isolatedQuantity: number; snapshot: string; lineage: unknown[]}>;
  telemetry(body?: {after?: number; limit?: number}, options?: CallOptions): Promise<{items: unknown[]; next: number | null}>;
  pipelineStart(body: PipelinePlan, options?: CallOptions): Promise<PipelineResult>;
  pipelineStatus(body: {id: string}, options?: CallOptions): Promise<PipelineResult>;
  pipelineStep(body: {id: string}, options?: CallOptions): Promise<PipelineResult>;
  pipelineCancel(body: {id: string}, options?: CallOptions): Promise<PipelineResult>;
  ontology(options?: CallOptions): Promise<{definition: typeof definition; digest: string}>;
  get(body: {id: string; projection?: string[]}, options?: CallOptions): Promise<ObjectResult>;
  history(body: {id: string; afterRevision?: number; asOfRevision?: number; limit?: number; projection?: string[]}, options?: CallOptions): Promise<{items: (ObjectResult & {actionId: string | null; sourcePosition: string; validAt: string | null; recordedAt: string; deleted: boolean})[]; nextRevision: number | null; ontologyVersion: string; policyVersion: string}>;
  query<T extends ObjectType>(body: Query<T>, options?: CallOptions): Promise<QueryResult<T>>;
  search<T extends ObjectType>(body: Query<T>, options?: CallOptions): Promise<QueryResult<T>>;
  traverse(body: {id: string; link: ${Object.keys(definition.links).map(quote).join(' | ')}; depth?: 1 | 2; projection?: string[]}, options?: CallOptions): Promise<{items: ObjectResult[]; ontologyVersion: string}>;
  validate(body: SetIsolation, options?: CallOptions): Promise<{state: 'PROPOSED'; digest: string; ontologyVersion: string}>;
  submit(body: SetIsolation, options?: CallOptions): Promise<ActionResult>;
  status(body: {actionId: string}, options?: CallOptions): Promise<ActionResult>;
  approve(body: {actionId: string}, options?: CallOptions): Promise<ActionResult>;
  dispatch(body: {operationId: string}, options?: CallOptions): Promise<{state: string; operationId?: string}>;
  reconcile(body: {operationId: string}, options?: CallOptions): Promise<{state: string; operationId: string}>;
  ingest(body: {source: string; store: string; position: number; expectedPosition: number; record: Record<string, unknown>; releases?: number}, options?: CallOptions): Promise<{state: string; revision: number | null; inputDigest: string}>;
  sourceStatus(body: {source: string; store: string; after?: number; limit?: number}, options?: CallOptions): Promise<{checkpoint: number; items: unknown[]}>;
  observe(body?: Record<string, never>, options?: CallOptions): Promise<{actions: {state: string; count: number}[]; outbox: {state: string; count: number; oldestAgeSeconds: number}[]; sources: unknown[]; ontologyVersion: string; policyVersion: string}>;
  definitionDiff(body: {version: string}, options?: CallOptions): Promise<{changes: {path: string; before: unknown; after: unknown}[]; cases: unknown[]}>;
  editCases(body: {version: string; cases: {id: string; isolated: boolean; expected: string}[]}, options?: CallOptions): Promise<{state: 'DRAFT'; casesDigest: string}>;
  draft(body: {definition: Record<string, unknown>}, options?: CallOptions): Promise<{version: string; digest: string; diff: string}>;
  review(body: {version: string}, options?: CallOptions): Promise<{objectsChecked: number; digest: string; compatible: boolean}>;
  publish(body: {version: string; rollback?: boolean}, options?: CallOptions): Promise<{version: string; digest: string; reviewer: string; rollback: boolean}>;
  tool(body: {name: 'objects.search' | 'actions.propose'; args: Record<string, unknown>}, options?: CallOptions): Promise<unknown>;
}
export declare const definition: {
  ontologyVersion: ${quote(definition.ontologyVersion)}; [key: string]: unknown;
};
export declare function createClient(options: {
  url: string; token: string; tenant: string; delegationId?: string; timeoutMs?: number;
}): Client;
`;
  return {runtime,declarations};
}
export function writeClient({check=false}={}) {
  const definition=JSON.parse(readFileSync(resolve(root,'config/ontology.json'),'utf8'));
  const generated=generateClient(definition);
  for(const [file,body] of [['src/generated/client.mjs',generated.runtime],['src/generated/client.d.mts',generated.declarations]]) {
    const path=resolve(root,file);
    if(check) {if(readFileSync(path,'utf8')!==body)throw Error(`Generated client is stale: ${file}`);}
    else {mkdirSync(dirname(path),{recursive:true});writeFileSync(path,body);}
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) writeClient({check:process.argv.includes('--check')});
