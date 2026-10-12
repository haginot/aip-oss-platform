import {AsyncLocalStorage} from 'node:async_hooks';
import {exact,fail} from './contracts.mjs';
export const traceContext=new AsyncLocalStorage();
export function telemetry(k,credential,r,options){return k.call(credential,'observe',async(u,c)=>{
 exact(r,['after','limit'],[]);const after=r.after??0,limit=r.limit??100;
 if(!Number.isSafeInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>100)fail('INVALID_ARGUMENT');
 const rows=(await u.client.query('SELECT sequence,record FROM telemetry WHERE tenant=$1 AND stores <@ $2::jsonb AND sequence>$3 ORDER BY sequence LIMIT $4',[c.tenant,JSON.stringify(c.stores),after,limit+1])).rows;
 return {items:rows.slice(0,limit).map(row=>({sequence:Number(row.sequence),...row.record})),next:rows.length>limit?Number(rows[limit-1].sequence):null};
},options);}
