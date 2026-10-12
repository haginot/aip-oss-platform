import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,cp,mkdir,readFile,rm,stat,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {spawnSync} from 'node:child_process';
test('single bootstrap entry from pristine source, empty HOME and npm cache; no credentials or dev dependencies', {timeout:600000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'aip-clean-release-'));try{
 const checkout=join(root,'source'),home=join(root,'home');await mkdir(checkout);await mkdir(home);
 for(const p of ['package.json','package-lock.json','mise.toml','src','config','migrations','scripts'])await cp(p,join(checkout,p),{recursive:true});
 const env={PATH:process.env.PATH,HOME:home,TMPDIR:tmpdir(),MISE_DATA_DIR:join(root,'mise-data'),MISE_CACHE_DIR:join(root,'mise-cache'),MISE_TRUSTED_CONFIG_PATHS:checkout,MISE_YES:'1',npm_config_cache:join(root,'npm-cache'),npm_config_userconfig:join(home,'.npmrc')};
 const result=spawnSync('bash',['scripts/release/bootstrap.sh','--check'],{cwd:checkout,env,encoding:'utf8',timeout:550000,maxBuffer:4e6});assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 const info=JSON.parse(result.stdout.split('\n').find(line=>line.startsWith('{')&&line.includes('"health":"PASS"')));assert.equal(info.health,'PASS');assert.match(info.runtimePlatform.postgresConfigure,/--without-icu/);assert.match(info.runtimePlatform.postgresConfigure,/--without-readline/);for(const b of info.runtimePlatform.binaries.filter(b=>b.binary!=='node'))assert.doesNotMatch(b.linkage,/homebrew|openssl|icu4c/);assert.equal(info.demoPreflight,'PASS');assert.equal(info.seed,'store-seed:1');assert.equal(info.node,'v22.23.3');assert.equal(info.ontologyVersion,'1.1.0');
 await assert.rejects(stat(join(checkout,'node_modules/takt')),{code:'ENOENT'});await assert.rejects(stat(dirname(info.credentialsPath)),{code:'ENOENT'});
 await mkdir('evidence/generated/release',{recursive:true});await writeFile('evidence/generated/release/clean-bootstrap-trace.json',JSON.stringify({exitCode:result.status,info,emptyHome:true,emptyNpmCache:true,pristineSource:true,developmentDependenciesInstalled:false,emptyMiseData:true,emptyMiseCache:true,externalPrerequisite:'OSS mise executable and OS build tools; runtime downloaded/installed by entry from empty data/cache',stdout:result.stdout,stderr:result.stderr},null,2)+'\n');
 }finally{await rm(root,{recursive:true,force:true});}
});
