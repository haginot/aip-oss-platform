import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rpc} from '../ENT-202-public-read-20261028/support.mjs';
export {scenario,evidence,business,audit,grant,ops,allFields,scope,childGateway,login} from '../ENT-202-public-read-20261028/support.mjs';
export {error} from '../ENT-202-public-submit-20261028/support.mjs';
export {rpc};
export const envelope=(body,key=randomUUID())=>({contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',operation:'import',body,key});
export const imported=(f,body=f.body,key=randomUUID(),who='operator',options={})=>rpc(f,'import',body,who,{...options,request:Object.hasOwn(options,'request')?options.request:envelope(body,key)});
export async function accepted(...args){const row=await imported(...args);assert.equal(row.status,200,JSON.stringify(row));return row;}
