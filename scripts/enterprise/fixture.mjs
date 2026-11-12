import {fixture,startCluster} from '../foundation/runtime.mjs';
import {bootstrapEnterpriseFixture} from './fixture-bootstrap.mjs';
export {startCluster};
export {scope,operations} from './fixture-bootstrap.mjs';
export async function enterpriseFixture(cluster,options={}){
 const f=await fixture(cluster,options);
 return bootstrapEnterpriseFixture(f,options);
}
