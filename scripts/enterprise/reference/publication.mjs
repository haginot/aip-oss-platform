// Independent synthetic media ledger. It imports no product domain implementation.
import {createServer} from 'node:http';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
export async function referencePublication(cluster,{withdrawable=true}={}){
 const client=new pg.Client(cluster.config),schema='media_'+randomUUID().replaceAll('-','');await client.connect();await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema}`);await client.query('CREATE TABLE deliveries(id text PRIMARY KEY,payload jsonb NOT NULL,applied integer NOT NULL,withdrawn integer NOT NULL DEFAULT 0)');let lost=false;const requests=[];
 const server=createServer(async(req,res)=>{try{let body='';for await(const chunk of req)body+=chunk;const b=body?JSON.parse(body):{},id=b.operationId??decodeURIComponent(req.url.split('/').at(-1));requests.push({method:req.method,path:req.url,id});let row;
 if(req.method==='POST'&&req.url==='/effects'){
  if(typeof id!=='string'||b.event.operationId!==id||!['release','journey'].includes(b.event.kind))throw Error('invalid');
  row=(await client.query('SELECT * FROM deliveries WHERE id=$1',[id])).rows[0];if(row&&!(await client.query('SELECT payload=$2::jsonb AS equal FROM deliveries WHERE id=$1',[id,JSON.stringify(b.event)])).rows[0].equal)throw Error('conflict');
  await client.query('INSERT INTO deliveries(id,payload,applied) VALUES($1,$2,1) ON CONFLICT DO NOTHING',[id,b.event]);if(lost){lost=false;req.socket.destroy();return;}
 }else if(req.method==='POST'&&req.url==='/compensations'){
  if(!withdrawable){res.end(JSON.stringify({operationId:id,state:'UNSUPPORTED',residualExposure:true}));return;}await client.query('UPDATE deliveries SET withdrawn=1 WHERE id=$1',[id]);
 }else if(req.method!=='GET'||!req.url.startsWith('/effects/'))throw Error('invalid');
 row=(await client.query('SELECT * FROM deliveries WHERE id=$1',[id])).rows[0];res.setHeader('content-type','application/json');res.end(JSON.stringify({operationId:id,state:!row?'ABSENT':row.withdrawn?'COMPENSATED':'SUCCEEDED'}));
 }catch{res.writeHead(400).end('{}');}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {url:`http://127.0.0.1:${server.address().port}`,requests,loseNext(){lost=true;},async ledger(){return (await client.query('SELECT * FROM deliveries ORDER BY id')).rows;},async close(){await new Promise(resolve=>server.close(resolve));await client.query(`DROP SCHEMA ${schema} CASCADE`);await client.end();}};
}
