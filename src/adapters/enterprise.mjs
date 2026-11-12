// SQL belongs to the shared StatePort adapter, never to a business package.
import {digest,fail} from '../contracts.mjs';
export class EnterpriseRepository {
 constructor(u){this.u=u;}
 one(sql,args=[]){return this.u.one(sql,args);}
 async query(sql,args=[]){return (await this.u.client.query(sql,args)).rows;}
 grant(principal){return this.one('SELECT * FROM enterprise_grants WHERE principal=$1 FOR SHARE',[principal]);}
 delegation(id){return this.one('SELECT * FROM enterprise_delegations WHERE id=$1 FOR SHARE',[id]);}
 async addDelegation(d){await this.query('INSERT INTO enterprise_delegations VALUES($1,$2,$3,$4,$5,$6,true)',[d.id,d.actor,d.subject,JSON.stringify(d.scopes),JSON.stringify(d.operations),d.expires]);}
 async delegationEdges(){return this.query('SELECT actor,subject FROM enterprise_delegations WHERE active AND expires>now()');}
 package(tenant,id,version){return this.one('SELECT * FROM enterprise_packages WHERE tenant=$1 AND id=$2 AND version=$3 FOR SHARE',[tenant,id,version]);}
 async live(tenant,id){return this.one('SELECT p.* FROM enterprise_live l JOIN enterprise_packages p USING(tenant,id,version) WHERE l.tenant=$1 AND l.id=$2 FOR SHARE OF l',[tenant,id]);}
 async install(tenant,p,c){const identity={actor:c.actor,subject:c.subject,delegationId:c.delegationId};await this.query("INSERT INTO enterprise_packages(id,version,tenant,digest,manifest,author,state,author_identity) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7)",[p.id,p.version,tenant,digest(p),p,c.actor,identity]);}
 async review(p,c){await this.query("UPDATE enterprise_packages SET reviewer=$4,reviewer_identity=$5,state=CASE WHEN state='PUBLISHED' THEN state ELSE 'REVIEWED' END WHERE tenant=$1 AND id=$2 AND version=$3",[p.tenant,p.id,p.version,c.actor,{actor:c.actor,subject:c.subject,delegationId:c.delegationId,authority:c,packageDigest:p.digest}]);}
 async publish(p){await this.query("UPDATE enterprise_packages SET state='PUBLISHED' WHERE tenant=$1 AND id=$2 AND version=$3",[p.tenant,p.id,p.version]);await this.query('INSERT INTO enterprise_live VALUES($1,$2,$3) ON CONFLICT(tenant,id) DO UPDATE SET version=excluded.version',[p.tenant,p.id,p.version]);}
 // Bound materialization to 1001 authorized candidates, not 1001 tenant rows.
 // Match sourcePolicy's maximum label and intersection of allowed purposes.
 // The normal transaction still checks journal recovery, statement deadline,
 // current authority and each returned row's policy before projecting it.
 async objects(c,type,packageId,purpose){return this.query(`
  SELECT o.* FROM objects o JOIN enterprise_instances i ON i.id=o.id
  WHERE o.tenant=$1 AND o.type=$2 AND o.store IS NULL AND NOT o.deleted
   AND o.enterprise_scope IN (SELECT value FROM jsonb_array_elements($3::jsonb))
   AND i.package_id=$4
   AND NOT EXISTS (
    SELECT 1 FROM enterprise_controls x
    WHERE x.tenant=o.tenant AND x.kind='information' AND x.data->>'transform'='source@1'
     AND x.data->'sources' @> jsonb_build_array(jsonb_build_object('kind','object','id',o.id))
    HAVING count(*)>0 AND (
     NOT coalesce(bool_and(x.data->'purposes' ? $6::text),false)
     OR NOT CASE max(array_position(ARRAY['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT'],x.data->>'label'))
      WHEN 1 THEN true WHEN 2 THEN 'INTERNAL'=ANY($5::text[])
      WHEN 3 THEN 'CONFIDENTIAL'=ANY($5::text[])
      WHEN 4 THEN 'STRICT'=ANY($5::text[]) OR 'RESTRICTED'=ANY($5::text[])
      ELSE false END))
  ORDER BY o.id LIMIT 1001`,[c.tenant,type,JSON.stringify(c.scopes),packageId,c.fields,typeof purpose==='string'?purpose:null]);}
 procurement(tenant,id){return this.one('SELECT * FROM enterprise_procurement WHERE tenant=$1 AND id=$2 FOR UPDATE',[tenant,id]);}
 async saveProcurement(x,actionId){await this.query('INSERT INTO enterprise_procurement VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant,id) DO UPDATE SET revision=$4,data=$5,action_id=$6',[x.tenant,x.id,x.kind,x.revision,JSON.stringify(x.data),actionId]);}
 async bindInstance(id,binding){await this.query('UPDATE enterprise_instances SET binding=$2 WHERE id=$1',[id,binding]);}
 object(id){return this.one('SELECT * FROM objects WHERE id=$1 AND enterprise_scope IS NOT NULL FOR UPDATE',[id]);}
 async create(c,b,actionId){const o=await this.one('INSERT INTO objects(id,tenant,store,type,revision,fields,source_position,enterprise_scope) VALUES($1,$2,NULL,$3,1,$4,$5,$6) RETURNING *',[b.id,c.tenant,b.type,b.fields,'action:'+actionId,b.scope]);await this.query('INSERT INTO history(object_id,revision,fields,action_id) VALUES($1,1,$2,$3)',[o.id,o.fields,actionId]);return o;}
 instance(id){return this.one('SELECT * FROM enterprise_instances WHERE id=$1 FOR UPDATE',[id]);}
 async start(o,p,binding,authority,actionId,due){await this.query("INSERT INTO enterprise_instances(id,action_id,package_id,package_version,binding,authority,state,due) VALUES($1,$2,$3,$4,$5,$6,'WAITING_APPROVAL',$7)",[o.id,actionId,p.id,p.version,binding,authority,due]);}
 async setInstance(i){await this.query('UPDATE enterprise_instances SET votes=$2,stage=$3,state=$4,timer_fired=$5 WHERE id=$1',[i.id,JSON.stringify(i.votes),i.stage,i.state,i.timer_fired]);}
 async due(now){return this.query("SELECT id FROM enterprise_instances WHERE due<=$1 AND state='WAITING_APPROVAL' AND NOT timer_fired ORDER BY id FOR UPDATE",[new Date(now)]);}
 async revoke(principal){await this.query('UPDATE enterprise_grants SET active=false,revision=revision+1 WHERE principal=$1',[principal]);}
 async sessionRevoke(hash){await this.query('UPDATE sessions SET expires=now() WHERE digest=$1',[hash]);}
 async grantSet(principal,scopes,operations,fields){await this.query('INSERT INTO enterprise_grants(principal,scopes,operations,fields) VALUES($1,$2,$3,$4) ON CONFLICT(principal) DO UPDATE SET scopes=excluded.scopes,operations=excluded.operations,fields=excluded.fields,active=true,revision=enterprise_grants.revision+1',[principal,JSON.stringify(scopes),JSON.stringify(operations),JSON.stringify(fields)]);}
 async oidcState(hash,value){await this.query('INSERT INTO enterprise_oidc_states VALUES($1,$2,$3,$4)',[hash,value.nonce,value.verifier,value.expires]);}
 async takeOidcState(hash){return this.one('DELETE FROM enterprise_oidc_states WHERE digest=$1 AND expires>now() RETURNING *',[hash]);}
 async oidcSubject(issuer,subject){return this.one('SELECT principal FROM enterprise_oidc_subjects WHERE issuer=$1 AND subject=$2',[issuer,subject]);}
 async session(hash,principal,expires,csrf){await this.query('INSERT INTO sessions VALUES($1,$2,$3)',[hash,principal,expires]);await this.query('INSERT INTO enterprise_browser_sessions VALUES($1,$2)',[hash,csrf]);}
 async browserSession(hash){return this.one('SELECT csrf FROM enterprise_browser_sessions WHERE digest=$1',[hash]);}
 async events(id){return this.query('SELECT revision,action_id,recorded_at FROM history WHERE object_id=$1 ORDER BY revision',[id]);}
 async pending(){return this.query("SELECT i.id FROM enterprise_instances i JOIN actions a ON a.id=i.action_id WHERE i.state IN ('READY','UNKNOWN') ORDER BY i.id");}
 async actionForInstance(i){return this.u.action(i.action_id,true);}
 async externalState(i,state){i.state=state;await this.setInstance(i);await this.u.updateAction(i.action_id,state,{targetId:i.id});}
 async setOutbox(operationId,state){await this.query('UPDATE outbox SET state=$2,attempt=attempt+1 WHERE operation_id=$1',[operationId,state]);}
}
