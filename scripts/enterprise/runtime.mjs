import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
export const runtimeFiles=[
 'package.json','infra/config/paths.js','infra/config/global/projectRegistry.js',
 'core/execution/locations.js','infra/task/centralStateRepository.js',
 'features/tasks/execute/workflowExecutionBundle.js','infra/config/project/sessionStore.js',
 'core/workflow/engine/WorkflowRunLoop.js','core/workflow/engine/StepExecutor.js',
 'core/workflow/quality-gates/commandGateRunner.js',
 'infra/config/loaders/workflowParser.js','infra/config/loaders/workflowStepNormalizer.js',
 'infra/config/loaders/capabilitySetResolver.js','infra/config/providerOptions.js',
 '../builtins/ja/provider-options/readonly.yaml','../builtins/en/provider-options/readonly.yaml',
];
export function runtimeIdentity(root) {
 const base=resolve(root,'node_modules/takt');
 return {version:JSON.parse(readFileSync(resolve(base,'package.json'))).version,
   sources:runtimeFiles.map(path=>({path,sha256:hash(readFileSync(resolve(base,'dist',path==='package.json'?'../package.json':path)))}))};
}
