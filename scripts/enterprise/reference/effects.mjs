// Independent synthetic HTTP reference: its own PostgreSQL ledger, no Kernel imports.
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
export async function referenceEffects(cluster,options={}){
 const schema='reference_'+randomBytes(8).toString('hex');await cluster.admin.query(`CREATE SCHEMA ${schema}`);
 const db=new pg.Pool({...cluster.config,options:`-c search_path=${schema}`});
 await db.query('CREATE TABLE effects(id text PRIMARY KEY,payload jsonb NOT NULL,applications integer NOT NULL DEFAULT 1,reversals integer NOT NULL DEFAULT 0)');
 const requests=[];
 let fault=null;const server=createServer(async(req,res)=>{try{
  if(options.secret&&(req.headers.authorization!=='Bearer '+options.secret||req.headers['x-destination']!==options.destination)){res.writeHead(403).end('{}');return;}
  requests.push({method:req.method,path:req.url});
  const parts=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>262144)throw Error('body limit');parts.push(chunk);}const body=parts.length?JSON.parse(Buffer.concat(parts)):{};
  let operationId,state;
  if(req.method==='POST'&&req.url==='/effects'){
   if(options.domain){const e=body.event;if(!e||e.schemaVersion!==1||e.domain!==options.domain||!e.stableId?.includes(':'+options.domain+':')||!Number.isInteger(e.revision)||e.sourceOfTruth!=='enterprise'||!e.changes||typeof e.changes.title!=='string'||!['invite','send','upsert'].includes(e.action))throw Error('mapping');}
   operationId=body.operationId;if(typeof operationId!=='string'||!body.event)throw Error('invalid');
   const row=(await db.query('INSERT INTO effects(id,payload) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING *',[operationId,body.event])).rows[0]??(await db.query('SELECT * FROM effects WHERE id=$1',[operationId])).rows[0];
   if(JSON.stringify(row.payload)!==JSON.stringify(JSON.parse(JSON.stringify(body.event)))){
    // jsonb key order differs: compare with PostgreSQL's independent equality.
    if(!(await db.query('SELECT payload=$2::jsonb AS same FROM effects WHERE id=$1',[operationId,body.event])).rows[0].same)throw Error('idempotency mismatch');
   }state=row.reversals?'COMPENSATED':'SUCCEEDED';
  }else if(req.method==='GET'&&req.url.startsWith('/effects/')){operationId=decodeURIComponent(req.url.slice(9));const row=(await db.query('SELECT * FROM effects WHERE id=$1',[operationId])).rows[0];state=!row?'ABSENT':row.reversals?'COMPENSATED':'SUCCEEDED';}
  else if(req.method==='POST'&&req.url==='/compensations'){operationId=body.operationId;const row=(await db.query('UPDATE effects SET reversals=1 WHERE id=$1 RETURNING *',[operationId])).rows[0];state=row?'COMPENSATED':'ABSENT';}
  else{res.writeHead(404).end();return;}
  if(fault==='lost-ack'&&req.method==='POST'){fault=null;req.socket.destroy();return;}
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({operationId,state}));
 }catch{res.writeHead(400).end('{}');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${server.address().port}`,fault(value){fault=value;},requests(){return structuredClone(requests);},async ledger(){return (await db.query('SELECT * FROM effects ORDER BY id')).rows;},async close(){await new Promise(resolve=>server.close(resolve));await db.end();}};
}
