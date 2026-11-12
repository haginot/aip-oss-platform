import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {scenario,evidence,rpc,ok,business,audit,grant,ops,allFields,childGateway,login} from '../ENT-202-public-read-20261028/support.mjs';
export {scenario,evidence,rpc,ok,business,audit,grant,ops,allFields,childGateway,login};
export const envelope=(body,key=randomUUID())=>({contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',operation:'submit',body,key});
export const submit=(f,body,key=randomUUID(),options={})=>rpc(f,'submit',body,options.who??'operator',{...options,request:options.request??envelope(body,key)});
export async function ready(f){await f.call('operator','invoiceImport',f.body);return f.request();}
export async function accepted(f,body,key,options){const r=await submit(f,body,key,options);assert.equal(r.status,200,JSON.stringify(r));return r.data.result;}
export function error(r,code){assert.equal(r.status,code==='NOT_FOUND'?404:code==='PERMISSION_DENIED'?403:400,JSON.stringify(r));assert.deepEqual(r.data,{error:{code}});}
export async function observation(f,p){const v={business:await business(f),audit:await audit(f),payment:p?await f.payment(p.id):null,source:f.source,invoice:await f.invoice(),account:await f.call('operator','paymentAccountRead',{id:f.account.id}),journal:f.env.f.journal.records()};evidence('observation',v);return v;}
