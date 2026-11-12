import {createHash} from 'node:crypto';
import {writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {CodexProvider} from '../../node_modules/takt/dist/infra/providers/codex.js';
import {routes} from '../model-routing.mjs';
import {selectCodex} from '../codex-runtime.mjs';
// Existing approved provider transport; separate receipt, never protected historical smoke.
const root=resolve(import.meta.dirname,'../..');
const output=process.argv[2];
if(!output || !/^evidence\/enterprise\/connection-[\w-]+\.json$/.test(output) || existsSync(resolve(root,output))) throw Error('new enterprise connection receipt required');
const cli=selectCodex();process.env.TAKT_CODEX_CLI_PATH=cli.path;
const routing=await routes(root);
const receipt={schemaVersion:1,checkedAt:new Date().toISOString(),transport:'takt-codex-provider',cli,
 runtimeDigest:createHash('sha256').update(JSON.stringify(routing.runtime)).digest('hex'),scope:'live connectivity only; not business quality or independent approval',status:'running',results:[]};
const save=()=>writeFileSync(resolve(root,output),JSON.stringify(receipt,null,2)+'\n');save();
for(const name of ['build-foundation','review-architecture']) {
 const step=routing.steps.find(x=>x.step===name);
 const agent=new CodexProvider().setup({name:'enterprise-connection-'+name});
 let result;
 try {const response=await agent.call('Do not use tools or read files. Reply only READY.',{cwd:root,model:step.model,providerOptions:step.providerOptions,permissionMode:'readonly',abortSignal:AbortSignal.timeout(60000)});
 result={model:step.model,effort:step.efforts[0],status:response.status==='done'&&response.content.trim()==='READY'?'passed':'failed',providerStatus:response.status,...(response.status!=='done'?{error:response.error??response.content}:{})};
 }catch(error){result={model:step.model,effort:step.efforts[0],status:'failed',error:error.message};}
 receipt.results.push(result);save();process.stdout.write(JSON.stringify(result)+'\n');
}
receipt.status=receipt.results.every(x=>x.status==='passed')?'passed':'failed';receipt.checkedAt=new Date().toISOString();save();if(receipt.status!=='passed')process.exitCode=1;
