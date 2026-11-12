import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {withFixture,restart} from './helpers.mjs';
import {scope} from '../../scripts/enterprise/fixture.mjs';
export {withFixture,restart,scope};
export const resource=()=>({id:randomUUID(),scope,currency:'JPY',unit:'minor',capacity:1000,threshold:800,periodEnd:'2099-01-01T00:00:00Z',calculationVersion:'integer-v1'});
export const sla=()=>({id:randomUUID(),scope,priority:'NORMAL',holidays:['2026-10-23'],businessDays:2});
export const policy=()=>({id:randomUUID(),scope,jurisdiction:'SYNTHETIC-JP',industry:'synthetic',version:'1.0.0',effective:'2020-01-01T00:00:00Z',expires:'2099-01-01T00:00:00Z',evidence:'synthetic-only-rulebook',owner:'reviewer',requirements:['approval','retention']});
export const coverage=()=>({id:randomUUID(),scope,departments:['corporate','hr'],lifecycles:['start','close'],classifications:['CONFIDENTIAL'],effects:['none'],exceptions:['restart']});
export async function denied(fn,code='PERMISSION_DENIED'){const {default:assert}=await import('node:assert/strict');await assert.rejects(fn,e=>e.code===code);}
export function evidence(name,data){if(process.env.ENTERPRISE_SUITE_OUTPUT){mkdirSync(process.env.ENTERPRISE_SUITE_OUTPUT,{recursive:true});writeFileSync(process.env.ENTERPRISE_SUITE_OUTPUT+'/'+name+'.json',JSON.stringify(data,null,2)+'\n');}}
export async function referenceCheck(request){
 const {referenceAssurance}=await import('../../scripts/enterprise/reference/assurance.mjs'),{default:assert}=await import('node:assert/strict');const server=await referenceAssurance();
 try{const post=(b,token='synthetic-reference-only')=>fetch(server.url,{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify(b)}),body={...request,scope:'synthetic-corporate'};
 assert.equal((await post(body,'wrong')).status,403);assert.equal((await post({...body,scope:'another-company'})).status,403);
 const response=await post(body);assert.equal(response.status,200);const result=await response.json();evidence(request.kind+'-reference',{request:body,response:result,requests:server.requests,credentialAndScopeDenied:true});return result;
 }finally{await server.close();}
}
export async function restoreRegression(kind,body,operation){
 const {default:assert}=await import('node:assert/strict'),{execFileSync}=await import('node:child_process');
 await withFixture(async(f,cluster)=>{
  const schema=(await f.owner.query('SELECT current_schema() name')).rows[0].name,args=['-h',cluster.config.host,'-p',String(cluster.config.port),'-U',cluster.config.user,'-d',cluster.config.database];
  const dump=name=>{const path=cluster.directory+'/'+name+'.sql';execFileSync('pg_dump',[...args,'--schema='+schema,'--file='+path]);return path;};
  const restore=async path=>{await f.owner.query(`DROP SCHEMA ${schema} CASCADE`);execFileSync('psql',[...args,'--single-transaction','--set=ON_ERROR_STOP=1','--file='+path],{stdio:'pipe'});restart(f);};
  const before=dump('before'),key=randomUUID(),who=kind==='sla'?'operator':'manager';
  f.kernel.fault=async p=>{if(p==='enterprise-after-commit')throw Error('lost commit response');};await assert.rejects(()=>f.call(who,operation,body,key));const complete=dump('complete');
  await restore(before);const journal=JSON.stringify(f.kernel.journal.records());await denied(()=>f.kernel.enterpriseRecover(f.credentials.manager),'RECOVERING');assert.equal(JSON.stringify(f.kernel.journal.records()),journal);
  await denied(()=>f.call('manager','assuranceRead',{id:body.id}),'RECOVERING');await denied(()=>f.call('manager','assuranceList',{kind}),'RECOVERING');
  await restore(complete);await f.kernel.enterpriseRecover(f.credentials.manager);await f.call(who,operation,body,key);const record=await f.call('manager','assuranceRead',{id:body.id});assert.equal(record.revision,1);assert.equal(record.history.length,1);
  const action=(await f.owner.query('SELECT * FROM actions WHERE id=$1',[record.action_id])).rows[0];assert.equal(action.request.operation,operation);const audit=await f.call('manager','assuranceAudit',{id:body.id});assert.ok(JSON.stringify(audit).includes(record.action_id));
  // Direct SQL corruption is detected before a read, not interpreted as new input.
  await f.owner.query("UPDATE enterprise_assurance SET data=data||'{\"state\":\"CORRUPTED\"}'::jsonb WHERE id=$1",[body.id]);await denied(()=>f.call('manager','assuranceRead',{id:body.id}),'RECOVERING');
  evidence(kind+'-restore',{realSchemaDumpRestore:true,commitResponseLoss:true,missingActionFenced:true,sameKeyRevision:record.revision,history:record.history,sqlTamperDenied:true});
 });
}
