import {procurementQuantityManifest} from '../../src/enterprise/procurement.mjs';
import {seedProcurement} from './procurement-seed.mjs';
import {scope} from './fixture.mjs';
// Separate additive seed: the legacy manifest, fixture and seed stay intact.
// Publishing this exact new version never migrates existing instances.
export async function publishQuantity(f,call=f.call){
 const manifest=structuredClone(procurementQuantityManifest);
 await call('manager','install',{manifest});await call('reviewer','review',{id:manifest.id,version:manifest.version});await call('publisher','publish',{id:manifest.id,version:manifest.version});
}
export async function seedQuantity(f,call=f.call,purchaseScope=scope){
 const seed=await seedProcurement(f,call,purchaseScope);await publishQuantity(f,call);return seed;
}
