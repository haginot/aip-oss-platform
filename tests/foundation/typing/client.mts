import {createClient, type SetIsolation} from '../../../src/generated/client.mjs';
const client=createClient({url:'http://127.0.0.1/rpc',token:'synthetic',tenant:'t1'});
const request: SetIsolation={actionType:'SetIsolation',actionVersion:'1.0.0',ontologyVersion:'1.0.0',input:{targetId:'stock',isolated:true},expectedRevision:1,idempotencyKey:'k',evidence:[]};
void client.submit(request);
void client.query({type:'InventoryPosition',projection:['quantity'],filter:{op:'eq',field:'quantity',value:10}});
// @ts-expect-error incorrect Action input type must fail compilation
void client.submit({...request,input:{targetId:'stock',isolated:'true'}});
// @ts-expect-error client version is fixed by its generated definition
void client.submit({...request,ontologyVersion:'1.1.0'});
// @ts-expect-error finite Object query excludes arbitrary field names
void client.query({type:'InventoryPosition',projection:['unknown']});
// @ts-expect-error typed numeric filters reject string input
void client.query({type:'InventoryPosition',filter:{op:'eq',field:'quantity',value:'10'}});
