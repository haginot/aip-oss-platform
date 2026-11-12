import {randomUUID} from 'node:crypto';
import {scope} from './procurement-helper.mjs';
export {scope,approvePurchase} from './procurement-helper.mjs';
export const quantityVersion='1.1.0';
export {publishQuantity,seedQuantity} from '../../scripts/enterprise/procurement-quantity-seed.mjs';
export const purchaseBody=(seed,more={})=>({id:'quantity-'+randomUUID(),scope:seed.scope,title:'合成備品・数量契約',currency:'JPY',budgetId:seed.budgetId,packageVersion:quantityVersion,quantity:7,unit:'台',...more});
export async function compareQuantity(f,seed,more={},who='operator'){
 const b=purchaseBody(seed,more);let result=await f.call(who,'purchaseCreate',b);
 for(const [index,supplierId] of seed.supplierIds.slice(0,2).entries())result=await f.call(who,'purchaseQuote',{id:b.id,revision:result.revision,quoteId:'quantity-q'+index,supplierId,amount:index?1400:1200,currency:b.currency,quantity:b.quantity,unit:b.unit,quoteVersion:index?3:2});
 result=await f.call(who,'purchaseSelect',{id:b.id,revision:result.revision,quoteId:'quantity-q0',reason:'同一仕様・数量・単位の総額を比較'});return {...b,revision:result.revision};
}
export const receiptBody=(b,record,more={})=>({id:b.id,revision:record.revision,orderOperationId:record.order.operationId,note:'独立担当者による実全量検収',receivedQuantity:b.quantity,unit:b.unit,...more});
