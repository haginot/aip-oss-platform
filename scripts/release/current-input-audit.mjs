import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,lstatSync,writeFileSync} from 'node:fs';
import {resolve,relative} from 'node:path';
const hash=x=>createHash('sha256').update(x).digest('hex');
export function digestPaths(root,paths){
 const files=[];function visit(path){const absolute=resolve(root,path),s=lstatSync(absolute);assert.ok(!s.isSymbolicLink(),'symlink');if(s.isDirectory()){for(const e of readdirSync(absolute)){if(['.git','node_modules','runs','worktrees','logs'].includes(e))continue;visit(relative(root,resolve(absolute,e)));}}else{assert.ok(s.isFile());files.push(path);}}
 for(const p of paths)visit(p);const entries=[...new Set(files)].sort().map(path=>({path,sha256:hash(readFileSync(resolve(root,path)))}));return {digest:hash(entries.map(e=>`${e.path}\0${e.sha256}\n`).join('')),fileCount:entries.length,entries};
}
export function auditCurrent(root,plan,manifest,stages){
 const verified=[],covered=new Set();for(const stage of stages){const suites=plan.suites.filter(s=>s.stage===stage);assert.ok(suites.length,`unexecuted stage ${stage}`);const run=manifest.runs.filter(r=>r.stage===stage).at(-1);assert.equal(run?.status,'passed',`latest ${stage} not passed`);assert.equal(run.suites.length,suites.length,'suite count');
 for(const suite of suites){const r=run.suites.find(r=>r.id===suite.id);assert.equal(r?.status,'passed',`unexecuted suite ${suite.id}`);assert.equal(r.planDigest,hash(JSON.stringify(suite)),'stale suite definition');assert.equal(r.commands.length,suite.commands.length);r.commands.forEach((c,i)=>{assert.equal(c.exitCode,0);assert.ok(!c.error);assert.deepEqual(c.argv,suite.commands[i]);});const inputs=digestPaths(root,suite.inputs),outputs=digestPaths(root,suite.outputs);assert.equal(r.inputs.digest,inputs.digest,'stale input');assert.equal(r.outputs.digest,outputs.digest,'stale/missing output');assert.equal(r.inputs.fileCount,inputs.fileCount);assert.equal(r.outputs.fileCount,outputs.fileCount);assert.deepEqual(r.outputs.artifacts,outputs.entries);inputs.entries.forEach(e=>covered.add(e.path));verified.push({stage,runId:run.id,suiteId:suite.id,inputs,outputs,receipt:r});}}
 // Every authored source, test and execution script must be covered by current receipts.
 const required=['src','tests','scripts'].flatMap(p=>digestPaths(root,[p]).entries);for(const e of required)assert.ok(covered.has(e.path),`uncovered source/test ${e.path}`);
 return {checkedAt:new Date().toISOString(),status:'passed',stages,suiteCount:verified.length,outputCount:verified.reduce((n,s)=>n+s.outputs.fileCount,0),sourceTestScriptCount:required.length,verified};
}
if(process.argv[1]?.endsWith('/current-input-audit.mjs')){
 const stages=['architecture','plan','mechanism','implementation','demo','bcp'];if(process.argv.includes('--all'))stages.push('release');const result=auditCurrent(process.cwd(),JSON.parse(readFileSync('verification/plan.json')),JSON.parse(readFileSync('evidence/run-manifest.json')),stages);
 const matrix=readFileSync('evidence/ACCEPTANCE_MATRIX.md','utf8');for(let i=1;i<=8;i++)assert.match(matrix,new RegExp(`\\| AC-00${i} \\| PASS \\|`));assert.match(matrix,/\| AC-009 \| READY_FOR_REVIEW \|/);
 if(!process.argv.includes('--all'))writeFileSync('evidence/generated/release/current-input-audit.json',JSON.stringify({...result,acceptanceMatrixSha256:hash(matrix),releaseNote:'Upstream receipt snapshot; current release is running during this suite. Post-gate --all verifies release without modifying artifacts.'},null,2)+'\n');
 console.log(JSON.stringify({status:result.status,stages,suites:result.suiteCount,outputs:result.outputCount,sourceTestScripts:result.sourceTestScriptCount}));
}
