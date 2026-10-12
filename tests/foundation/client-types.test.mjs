import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
test('generated declarations compile with strict pinned TypeScript and reject invalid client inputs',()=>{
 assert.equal(JSON.parse(readFileSync('node_modules/typescript/package.json','utf8')).version,'5.9.3');
 assert.equal(execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--project','config/client-tsconfig.json'],{encoding:'utf8',timeout:30000}), '');
});
