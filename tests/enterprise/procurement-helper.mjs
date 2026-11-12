import {randomUUID} from 'node:crypto';
import {scope} from '../../scripts/enterprise/fixture.mjs';
export {scope};
export {seedProcurement} from '../../scripts/enterprise/procurement-seed.mjs';
export async function comparePurchase(f,seed,more={},who='operator'){
 const b={id:'purchase-'+randomUUID(),scope:seed.scope??scope,title:'Synthetic purchase 日本語',currency:'JPY',budgetId:seed.budgetId,...more};
 let result=await f.call(who,'purchaseCreate',b);
 for(const [index,supplierId] of seed.supplierIds.slice(0,2).entries())result=await f.call(who,'purchaseQuote',{id:b.id,revision:result.revision,quoteId:'quote-'+index,supplierId,amount:index?1400:1200,currency:'JPY'});
 result=await f.call(who,'purchaseSelect',{id:b.id,revision:result.revision,quoteId:'quote-0',reason:'Same specification; lower total synthetic cost'});
 return {...b,revision:result.revision};
}
export async function approvePurchase(f,b){for(const who of ['manager','reviewer','publisher'])await f.call(who,'vote',{id:b.id,revision:b.revision,decision:'APPROVE'});return b;}
