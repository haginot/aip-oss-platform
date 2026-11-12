// Independent synthetic reference calculator. No product or domain imports.
// Read-only HTTP protocol; never sends business requests or contacts services.
import {createServer} from 'node:http';
export async function referenceAssurance(){
 const requests=[];const server=createServer(async(req,res)=>{let body='';try{
  for await(const chunk of req){body+=chunk;if(body.length>20000)throw Error('size');}
  if(req.method!=='POST'||req.url!=='/calculate'){res.writeHead(404).end();return;}
  if(req.headers.authorization!=='Bearer synthetic-reference-only'){res.writeHead(403).end();return;}
  const b=JSON.parse(body);if(b.scope!=='synthetic-corporate'){res.writeHead(403).end();return;}
  requests.push(b);let result;
  if(b.kind==='resource'){
   if(!['JPY','USD','EUR'].includes(b.currency)||b.version!=='integer-v1'||!b.entries.every(e=>Number.isSafeInteger(e.quantity)&&e.quantity>0))throw Error('contract');
   const gross=b.entries.reduce((n,e)=>n+BigInt(e.quantity),0n),reserved=b.entries.filter(e=>!e.released).reduce((n,e)=>n+BigInt(e.quantity),0n);
   result={reserved:String(reserved),gross:String(gross),allowed:gross<=BigInt(b.threshold)&&reserved<=BigInt(b.capacity),version:b.version};
  }else if(b.kind==='sla'){
   const d=new Date(b.start);d.setUTCHours(0,0,0,0);let remaining=b.priority==='URGENT'?1:b.days;if(!Number.isSafeInteger(remaining)||remaining<1||remaining>30)throw Error('contract');
   while(remaining){d.setUTCDate(d.getUTCDate()+1);if(d.getUTCDay()>0&&d.getUTCDay()<6&&!b.holidays.includes(d.toISOString().slice(0,10)))remaining--;}
   result={due:d.toISOString()};
  }else if(b.kind==='policy'){
   result={supported:b.jurisdiction==='SYNTHETIC-JP'&&b.industry==='synthetic'&&b.version==='1.0.0'&&b.reviewed===true&&JSON.stringify(b.requirements)===JSON.stringify(['approval','retention']),legalComplianceClaim:false};
  }else if(b.kind==='coverage'){
   result={cells:b.dimensions.reduce((n,x)=>n*new Set(x).size,1),complete:false};
  }else throw Error('contract');
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(result));
 }catch{res.writeHead(400).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${server.address().port}/calculate`,requests,close:()=>new Promise(resolve=>server.close(resolve))};
}
