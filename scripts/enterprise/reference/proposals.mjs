import {createServer} from 'node:http';
// Independent reference: only HTTP JSON, no product imports or model SDK.
export async function referenceProposals(){
 const requests=[];let mode='normal';const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>65536){res.writeHead(413).end();return;}}if(req.method!=='POST'||req.url!=='/proposals'){res.writeHead(404).end();return;}
 const input=JSON.parse(raw);requests.push(input);if(mode==='down'){res.writeHead(503).end();return;}
 const output={text:'合成資料に基づく提案。人の審査が必要です。',references:[input.reference],tools:[],cost:1};
 if(mode==='tool')output.tools=['publish'];if(mode==='grounding')output.references=[{id:'foreign'}];if(mode==='type')output.text={execute:true};if(mode==='cost')output.cost=input.maxCost+1;
 res.setHeader('content-type','application/json');res.end(JSON.stringify(output));});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {url:`http://127.0.0.1:${server.address().port}`,requests,mode(value){mode=value;},async close(){await new Promise(r=>server.close(r));}};
}
