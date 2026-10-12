import {readFileSync,readdirSync,statSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const hash=s=>createHash('sha256').update(s).digest('hex');
export function scanSecrets(root){
 const findings=[];const rules=[['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['aws-key',/AKIA[0-9A-Z]{16}/],['github-token',/gh[pousr]_[A-Za-z0-9]{30,}/],['api-key',/sk-(?:proj-|live-)[A-Za-z0-9_-]{24,}/]];
 function visit(dir){for(const name of readdirSync(dir)){if(['.git','node_modules','.release-runtime','runs','worktrees','logs','licenses'].includes(name))continue;const path=join(dir,name),s=statSync(path);if(s.isDirectory())visit(path);else if(s.size<8e6){if(/^\.env(?:\.|$)/.test(name)&&!name.endsWith('.example'))findings.push({path,rule:'environment-file'});const text=readFileSync(path,'utf8');for(const [rule,re] of rules)if(re.test(text))findings.push({path,rule});}}}visit(root);return findings;
}
export function validateRuntimePackage(path,p){
 assert.match(p.integrity,/^sha512-/);assert.match(p.resolved,/^https:\/\/registry.npmjs.org\//);assert.ok(new Set(['MIT','ISC','BSD-2-Clause','BSD-3-Clause','Apache-2.0','0BSD']).has(p.license),`unresolved/prohibited license ${path}: ${p.license}`);
}
export function validateAudit(status,audit){assert.equal(status,0,'audit command failed');assert.equal(audit.metadata.vulnerabilities.total,0,'vulnerability threshold exceeded');}
if(process.argv[1]?.endsWith('/supply-chain.mjs')){
 const out='evidence/generated/release';mkdirSync(out,{recursive:true});
 const lock=JSON.parse(readFileSync('package-lock.json')),components=[],notices=[];
 for(const [path,p] of Object.entries(lock.packages)){if(!path||p.dev)continue;validateRuntimePackage(path,p);
 const files=readdirSync(path).filter(n=>/^(license|licence|copying|notice)(\.|$)/i.test(n));if(!files.length){const readme=readdirSync(path).find(n=>/^readme\.md$/i.test(n));assert.ok(readme&&readFileSync(join(path,readme),'utf8').includes('Permission is hereby granted, free of charge'),`missing notice ${path}`);files.push(readme);}
 for(const file of files)notices.push(`## ${path} ${p.version}\n\n${readFileSync(join(path,file),'utf8')}\n`);
 components.push({type:'library',name:path.split('node_modules/').at(-1),version:p.version,licenses:[{license:{id:p.license}}],hashes:[{alg:'SHA-512',content:Buffer.from(p.integrity.slice(7),'base64').toString('hex')}],purl:`pkg:npm/${path.split('node_modules/').at(-1)}@${p.version}`});
 }
 const oss=JSON.parse(readFileSync('architecture/OSS_BASELINE.json'));for(const p of oss.products.filter(p=>p.id!=='pg')){const file=p.id==='node'?'NODE-LICENSE.txt':'POSTGRESQL-COPYRIGHT.txt';const text=readFileSync('licenses/'+file,'utf8');assert.ok(text.length>1000);notices.push(`## ${p.id} ${p.version}\n\n${text}\n`);components.push({type:'application',name:p.id,version:p.version,properties:[{name:'vendor-notices-sha256',value:hash(text)},{name:'inventory-scope',value:'vendor runtime; bundled notices retained; internal binary components not individually enumerated'}]});}
 // Fresh bootstrap records the actual owned runtime before its cleanup.
 const clean=JSON.parse(readFileSync(out+'/clean-bootstrap-trace.json'));assert.equal(clean.exitCode,0);const platform=clean.info.runtimePlatform;assert.match(platform.postgresConfigure,/--without-icu/);assert.match(platform.postgresConfigure,/--without-readline/);assert.equal(platform.binaries.length,3);for(const b of platform.binaries){assert.match(b.sha256,/^[a-f0-9]{64}$/);if(b.binary!=='node')assert.doesNotMatch(b.linkage,/homebrew|openssl|icu4c/);}
 writeFileSync(out+'/runtime-platform.json',JSON.stringify({platform:process.platform,architecture:process.arch,...platform,scope:'default isolated release runtime from fresh bootstrap; PostgreSQL has no external OpenSSL/ICU/readline; Node bundled notices retained; OS standard libraries/toolchain excluded from component inventory'},null,2)+'\n');
 writeFileSync(out+'/sbom.cdx.json',JSON.stringify({bomFormat:'CycloneDX',specVersion:'1.5',version:1,metadata:{timestamp:new Date().toISOString(),component:{type:'application',name:lock.name,version:lock.version}},components},null,2)+'\n');
 writeFileSync(out+'/THIRD_PARTY_NOTICES.md','# Runtime redistribution notices\n\n'+notices.join('\n'));
 const inventories=Object.entries(lock.packages).filter(([p])=>p).map(([path,p])=>({path,version:p.version,license:p.license??null,developmentOnly:!!p.dev,optional:!!p.optional,integrity:p.integrity}));writeFileSync(out+'/locked-inventory.json',JSON.stringify(inventories,null,2)+'\n');
 for(const scope of ['all','runtime']){const args=['audit','--json',...(scope==='runtime'?['--omit=dev']:[])];const result=spawnSync('npm',args,{encoding:'utf8',timeout:120000,maxBuffer:8e6});let audit;try{audit=JSON.parse(result.stdout);}catch{throw Error('npm audit did not return JSON');}writeFileSync(out+`/audit-${scope}.json`,JSON.stringify({exitCode:result.status,checkedAt:new Date().toISOString(),...audit},null,2)+'\n');validateAudit(result.status,audit);}
 const findings=scanSecrets('.');writeFileSync(out+'/secret-scan.json',JSON.stringify({checkedAt:new Date().toISOString(),scope:'repository including authored .takt configs; except .git/node_modules/runs/worktrees/logs/licenses; known key families and environment files',findings},null,2)+'\n');assert.equal(findings.length,0,'secret scan failed');
 // Explicit security floor derived from official Node July 2026 and PG 18 advisories.
 assert.equal(process.version,'v22.23.3');const pg=spawnSync('postgres',['--version'],{encoding:'utf8'});assert.equal(pg.status,0);assert.match(pg.stdout,/18\.6/);
 const sources=['https://nodejs.org/en/blog/vulnerability/july-2026-security-releases','https://www.postgresql.org/support/security/18/'];const observations=[];
 for(const url of sources){const r=await fetch(url);assert.ok(r.ok,`security source unavailable: ${url}`);const body=await r.text();assert.ok(body.length>1000);observations.push({url,sha256:hash(body),retrievedAt:new Date().toISOString()});}
 writeFileSync(out+'/runtime-security.json',JSON.stringify({node:process.version,postgres:pg.stdout.trim(),minimumFixed:{node:'22.23.2',postgres:'18.6'},observations,scope:'npm registry advisory scan plus known vendor security floor; not proof of absence of undisclosed or OS/bundled-library vulnerabilities'},null,2)+'\n');
 console.log(`supply chain: ${components.length} runtime components, ${inventories.length} locked packages; audit and secrets passed`);
}
