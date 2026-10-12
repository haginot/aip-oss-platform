// Fixed synthetic seed profile; credentials remain ephemeral fixture sessions.
export async function seedStore(f,{deadline=Date.now()+3600000}={}) {
 const cases={name:'rice lot recall',lotId:'demo-lot',deadline,phase:'OPEN',affectedIds:'[]',affectedStores:'[]',affectedQuantity:0,soldQuantity:7,candidateId:'',orderQuantity:0,orderAmount:0,customerMessage:'',customerCount:0,isolated:false};
 await f.owner.query("UPDATE objects SET store='s3' WHERE id='foreign'");
 await f.owner.query("UPDATE objects SET store='s2' WHERE id='stock2'");
 await f.owner.query("UPDATE principals SET stores='[\"s1\",\"s2\"]' WHERE id IN ('operator','manager')");
 await f.owner.query("UPDATE delegations SET stores='[\"s1\",\"s2\"]' WHERE id='delegation'");
 const objects=[['demo-lot','Lot',{name:'Rice lot R-20261012',secret:'synthetic'}],['recall','RecallCase',cases],['replacement','ReplacementCandidate',{name:'Safe rice lot',available:true,recalled:false,capacity:50,unitPrice:1000,supplier:'synthetic-supplier'}]];
 for(const [id,type,fields] of objects)await f.owner.query("INSERT INTO objects(id,tenant,store,type,revision,fields,source_position) VALUES($1,'t1','s1',$2,1,$3,'store-seed:1')",[id,type,fields]);
 await f.owner.query("INSERT INTO links VALUES('demo-lot','stock','stock'),('demo-lot','stock2','stock'),('demo-lot','replacement','replacement')");
 await f.owner.query("UPDATE objects SET fields=fields || '{\"inTransit\":true}'::jsonb WHERE id='stock2'");
 return {version:'store-seed:1',recallId:'recall',stocks:['stock','stock2'],soldQuantity:7};
}
