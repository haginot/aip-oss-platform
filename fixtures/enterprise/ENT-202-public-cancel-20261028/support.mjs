import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {rpc} from '../ENT-202-public-approve-20261028/support.mjs';
export {scenario,evidence,pending,ok,business,audit,grant,ops,allFields,childGateway,login,observation,error,vote,approve} from '../ENT-202-public-approve-20261028/support.mjs';
export {accepted,submit} from '../ENT-202-public-submit-20261028/support.mjs';
export {rpc};
export const envelope=(body,key=randomUUID())=>({contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',operation:'cancel',body,key});
export const cancel=(f,body,who='operator',key=randomUUID(),options={})=>rpc(f,'cancel',body,who,{...options,request:options.request??envelope(body,key)});
export async function cancelled(f,id,key=randomUUID(),options={}){const r=await cancel(f,{id},'operator',key,options);assert.equal(r.status,200,JSON.stringify(r));return r.data.result;}
export async function worker(f,id,crash){
 const argv=['tests/enterprise/worker-child.mjs'],startedAt=new Date().toISOString(),p=spawn(process.execPath,argv,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
 p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);const exited=new Promise((resolve,reject)=>{p.on('error',reject);p.on('exit',(code,signal)=>resolve({code,signal}));});
 const {host,port,user,database,options}=f.env.f.state.pool.options;p.stdin.end(JSON.stringify({config:{host,port,user,database,options},journal:f.env.f.journal.path,credential:f.env.f.credentials.manager,id,mode:'dispatch',url:f.env.payments.url,crash}));
 const row={command:[process.execPath,...argv],cwd:process.cwd(),runtime:process.version,startedAt,finishedAt:null,stdout:null,stderr:null,...await exited};row.finishedAt=new Date().toISOString();row.stdout=stdout;row.stderr=stderr;
 const {evidence}=await import('./support.mjs');evidence('worker-'+id,row);return row;
}
