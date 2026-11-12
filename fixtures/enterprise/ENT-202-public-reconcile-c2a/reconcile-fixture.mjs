import http from 'node:http';
import {enterpriseGateway} from '../../../src/enterprise/gateway.mjs';
import {SyntheticPort} from '../../../src/enterprise/worker.mjs';
import {login,evidence} from './api-support.mjs';
async function server(handler){const s=http.createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));let closed=false;return {url:`http://127.0.0.1:${s.address().port}`,close:async()=>{if(closed)return;closed=true;s.closeAllConnections();await new Promise(r=>s.close(r));}};}
// A real loopback transport fault, not a replacement for enterpriseWork.
export async function observationGateway(f){
 let mode='forward';const requests=[];
 const proxy=await server(async(req,res)=>{const row={method:req.method,path:req.url,mode};requests.push(row);try{
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  if(mode==='network'){req.socket.destroy();return;}
  if(mode==='bad-json'){res.writeHead(200,{'content-type':'application/json'});res.end('{invalid');return;}
  if(mode==='wrong-operation'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({operationId:'wrong-operation',state:'SUCCEEDED'}));return;}
  const response=await fetch(f.env.payments.url+req.url),body=await response.text();row.upstreamStatus=response.status;row.upstreamBody=body;res.writeHead(response.status,{'content-type':'application/json'});res.end(body);
 }catch(e){row.error=e.message;res.destroy();}});
 f.children.push(proxy);const gateway=await enterpriseGateway(f.env.f.kernel,{issuer:f.env.idp.issuer,port:new SyntheticPort(proxy.url)});f.children.push(gateway);const client=await login({...f.env,gateway},'manager');
 return {origin:gateway.origin,client,requests,setMode:value=>{mode=value;},capture:()=>evidence('observation-proxy',{requests}),gateway};
}
// Destroy the client connection only after the actual gateway response proves commit.
export async function responseLossProxy(f,gateway){const exchanges=[];let lose=true;
 const proxy=await server(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks).toString(),row={method:req.method,path:req.url,request:JSON.parse(body),startedAt:new Date().toISOString()};exchanges.push(row);try{
  const response=await fetch(gateway.origin+req.url,{method:req.method,headers:{...req.headers,host:new URL(gateway.origin).host,origin:gateway.origin},body});row.status=response.status;row.body=await response.json();row.finishedAt=new Date().toISOString();evidence('actual-response-loss',{exchanges});
  if(lose){lose=false;req.socket.destroy();return;}res.writeHead(response.status,{'content-type':'application/json'});res.end(JSON.stringify(row.body));
 }catch(e){row.error=e.message;res.destroy();}});f.children.push(proxy);return {...proxy,exchanges};}
