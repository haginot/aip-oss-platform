// BPR-01 test-only scheduling: every read and classification command executes
// the real Kernel and HTTP contracts; no successful business result is mocked.
import assert from 'node:assert/strict';
import {evidence,ready,rpc,business,audit,openBrowser,cleared} from './support.mjs';
export function armRestriction(f,p,point){
 const native=f.env.f.kernel.enterprise.bind(f.env.f.kernel);let count=0,armed=true,change;
 f.env.f.kernel.enterprise=async(...args)=>{const result=await native(...args);if(armed&&args[1].operation===point&&++count===2){armed=false;const before=await business(f),body={id:'bpr01-'+crypto.randomUUID(),scope:f.seed.scope,source:{kind:'object',id:p.id,projection:['amount']},label:'STRICT',purposes:['finance-review']};const command=await f.probe('publisher','informationCreate',body);assert.equal(command.status,200,JSON.stringify(command));change={point,count,body,command,before,after:await business(f)};evidence('bpr01-classification-change',change);}return result;};
 return {restore(){f.env.f.kernel.enterprise=native;},get change(){return change;}};
}
export async function apiRestriction(f,operation,point){
 const p=await ready(f),gate=armRestriction(f,p,point);
 try{const response=await rpc(f,operation,{id:p.id}),after=await business(f);evidence('bpr01-response',{operation,point,response,change:gate.change,after,audit:await audit(f)});assert.ok(gate.change,'real classification command executed');assert.equal(response.status,403,JSON.stringify(response));assert.deepEqual(response.data,{error:{code:'PERMISSION_DENIED'}});assert.deepEqual(after,gate.change.after);for(const op of ['get','inspect','history']){const next=await rpc(f,op,{id:p.id});assert.equal(next.status,403);assert.deepEqual(next.data,{error:{code:'PERMISSION_DENIED'}});}assert.deepEqual((await rpc(f)).data.result.items,[]);assert.deepEqual(await business(f),gate.change.after);
 }finally{gate.restore();}
}
export async function browserRestriction(f,point){
 const p=await ready(f),{page,signIn,list,detail,capture}=await openBrowser(f);let gate;
 try{await signIn();await list();await detail(p.id);const beforeDom=await capture();gate=armRestriction(f,p,point);const start=await page.evaluate('window.publicHttp.length');await page.click('#reload');await page.until("document.querySelector('#message').textContent.includes('再ログイン')");const afterDom=await capture(),responses=afterDom.http.slice(start),after=await business(f);evidence('bpr01-browser-response',{point,beforeDom,afterDom,responses,change:gate.change,after,audit:await audit(f),browser:await page.send('Browser.getVersion'),executable:page.executable});assert.ok(gate.change);const inspect=responses.find(x=>x.request.operation==='inspect');assert.equal(inspect.status,403,JSON.stringify(inspect));assert.deepEqual(inspect.data,{error:{code:'PERMISSION_DENIED'}});cleared(afterDom,[p.id,f.body.id,f.body.number,f.po.id,f.account.id]);assert.deepEqual(after,gate.change.after);
 const follow=await page.evaluate(`(async()=>{const s=await(await fetch('/session')).json(),r=await fetch('/enterprise/v2/rpc',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrf},body:JSON.stringify({contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',operation:'get',body:{id:${JSON.stringify(p.id)}}})});return {status:r.status,data:await r.json()};})()`);assert.equal(follow.status,403);assert.deepEqual(follow.data,{error:{code:'PERMISSION_DENIED'}});evidence('bpr01-browser-followup',follow);assert.deepEqual(await business(f),gate.change.after);
 }finally{gate?.restore();await page.close();}
}
