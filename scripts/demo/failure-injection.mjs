export function injectExternal(erp,mode){
 if(!['normal','reject','lost-ack','rollback'].includes(mode))throw Error('unsupported demo fault');
 erp.controller.mode=mode;
}
export async function injectCandidateChange(f){await f.owner.query("UPDATE objects SET revision=revision+1,fields=jsonb_set(fields,'{available}','false') WHERE id='replacement'");}
