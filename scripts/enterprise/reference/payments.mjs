// Independent PostgreSQL ledger behind a loopback HTTP endpoint. No Kernel or
// business adapter imports. Purchasing and payments have separate tables/routes.
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
export async function referencePayments(cluster,purchaseUrl){
 const schema='payment_'+randomBytes(8).toString('hex');await cluster.admin.query(`CREATE SCHEMA ${schema}`);
 const db=new pg.Pool({...cluster.config,options:`-c search_path=${schema}`});await db.query('CREATE TABLE payments(id text PRIMARY KEY,payload jsonb NOT NULL,applications integer NOT NULL DEFAULT 1)');
 const requests=[];let fault=null;
 const server=createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>262144)throw Error('limit');}
  if(req.url==='/effects'||req.url.startsWith('/effects/')||req.url==='/compensations'){
   const response=await fetch(purchaseUrl+req.url,{method:req.method,headers:{'content-type':'application/json'},...(raw?{body:raw}:{})});res.writeHead(response.status,{'content-type':'application/json'}).end(await response.text());return;
  }
  requests.push({method:req.method,path:req.url,...(raw?{body:JSON.parse(raw)}:{})});let operationId,state;
  if(req.method==='POST'&&req.url==='/payments'){
   const b=JSON.parse(raw),e=b.event,f=e?.fields;
   if(e?.operationKind!=='invoice-payment'||e.destination!=='local-synthetic-payment'||f?.operationKind!==e.operationKind||f.destination!==e.destination||e.operationId!==b.operationId||e.schemaVersion!=='1.0.0'||!Number.isSafeInteger(f.amount)||f.amount<=0||!f.syntheticReference?.startsWith('synthetic:')||!f.purchaseId||!f.sourceDigest||!f.accountDigest)throw Error('payment contract');
   operationId=b.operationId;
   await db.query('INSERT INTO payments(id,payload) VALUES($1,$2) ON CONFLICT DO NOTHING',[operationId,e]);
   if(!(await db.query('SELECT payload=$2::jsonb AS same FROM payments WHERE id=$1',[operationId,e])).rows[0].same)throw Error('idempotency');state='SUCCEEDED';
  }else if(req.method==='GET'&&req.url.startsWith('/payments/')){operationId=decodeURIComponent(req.url.slice(10));state=(await db.query('SELECT 1 FROM payments WHERE id=$1',[operationId])).rowCount?'SUCCEEDED':'ABSENT';}
  else{res.writeHead(404).end('{}');return;}
  if(fault==='lost-ack'&&req.method==='POST'){fault=null;req.socket.destroy();return;}
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({operationId,state}));
 }catch{res.writeHead(400).end('{}');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${server.address().port}`,fault(v){fault=v;},requests:()=>structuredClone(requests),async ledger(){return (await db.query('SELECT * FROM payments ORDER BY id')).rows;},async close(){await new Promise(resolve=>server.close(resolve));await db.end();}};
}
