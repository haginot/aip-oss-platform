import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {scenario,evidence,ready,accepted,rpc,ok,business,audit,grant,ops,allFields,childGateway,login,observation,error} from '../ENT-202-public-submit-20261028/support.mjs';
export {scenario,evidence,rpc,ok,business,audit,grant,ops,allFields,childGateway,login,observation,error};
export const envelope=(operation,body,key=randomUUID())=>({contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',operation,body,key});
export async function pending(f,importer='operator',applicant='operator'){
 let b;if(importer==='operator')b=await ready(f);else{await f.call(importer,'invoiceImport',f.body);b=await f.request();}
 await accepted(f,b,randomUUID(),{who:applicant});return b;
}
export const command=(f,operation,body,who='manager',key=randomUUID(),options={})=>rpc(f,operation,body,who,{...options,request:options.request??envelope(operation,body,key)});
export async function vote(f,id,who='manager',operation='approve',key=randomUUID(),options={}){const current=await ok(f,'get',{id},who,options);const r=await command(f,operation,{id,revision:current.revision},who,key,options);assert.equal(r.status,200,JSON.stringify(r));return r.data.result;}
export async function approve(f,id){for(const who of ['manager','reviewer','publisher'])await vote(f,id,who);}
