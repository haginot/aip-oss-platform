import {randomUUID} from 'node:crypto';
import {procurementManifest} from '../../src/enterprise/procurement.mjs';
import {scope} from './fixture.mjs';
// All business seed enters the same public commands as interactive clients.
export async function seedProcurement(f,call=f.call,purchaseScope=scope){
 const manifest=structuredClone(procurementManifest);
 await call('manager','install',{manifest});await call('reviewer','review',{id:manifest.id,version:manifest.version});await call('publisher','publish',{id:manifest.id,version:manifest.version});
 const budgetId='budget-'+randomUUID(),supplierIds=['supplier-a-'+randomUUID(),'supplier-b-'+randomUUID(),'supplier-related-'+randomUUID()];
 await call('manager','resourceCreate',{id:budgetId,scope:purchaseScope,currency:'JPY',unit:'minor',capacity:2000,threshold:2000,periodEnd:'2099-01-01T00:00:00Z',calculationVersion:'integer-v1'});
 for(const [index,id] of supplierIds.entries())await call('publisher','supplierCreate',{id,scope:purchaseScope,name:['Synthetic A','Synthetic B','Synthetic related'][index],relatedSubjects:index===2?['operator']:[]});
 return {budgetId,supplierIds,scope:purchaseScope};
}
