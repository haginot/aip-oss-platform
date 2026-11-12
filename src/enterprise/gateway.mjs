import {procurementPublicRead,procurementCasePath} from './procurement-public-read.mjs';
import {invoicePublicRead,casePath} from './invoice-public-read.mjs';
import {invoicePublicSubmit} from './invoice-public-submit.mjs';
import {invoicePublicApprove} from './invoice-public-approve.mjs';
import {invoicePublicCancel} from './invoice-public-cancel.mjs';
import {invoicePublicImport} from './invoice-public-import.mjs';
import {invoicePublicCorrect} from './invoice-public-correct.mjs';
import {invoicePublicReconcile} from './invoice-public-reconcile.mjs';
import {checkAuthorityRecovery,checkCredentialRecovery} from './authority-recovery.mjs';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {exact,fail,PlatformError,tokenDigest} from '../contracts.mjs';
import {EnterpriseRepository} from '../adapters/enterprise.mjs';
import {authority} from './security.mjs';
import {receiveWebhook} from './connectors.mjs';
import {EnterpriseOIDC} from './oidc.mjs';
export async function enterpriseGateway(kernel,{issuer,clientId='enterprise-local',port:externalPort}){
 const oidc=new EnterpriseOIDC(kernel,{issuer,clientId});let origin;
 const html=await readFile(new URL('./portal.html',import.meta.url));const js=await readFile(new URL('./portal.mjs',import.meta.url));
 const adminHtml=await readFile(new URL('./admin.html',import.meta.url)),adminJs=await readFile(new URL('./admin.mjs',import.meta.url));
 const controlsHtml=await readFile(new URL('./controls.html',import.meta.url)),controlsJs=await readFile(new URL('./controls-ui.mjs',import.meta.url));
 const assuranceHtml=await readFile(new URL('./assurance.html',import.meta.url)),assuranceJs=await readFile(new URL('./assurance-ui.mjs',import.meta.url));
 const procurementHtml=await readFile(new URL('./procurement.html',import.meta.url)),procurementJs=await readFile(new URL('./procurement-ui.mjs',import.meta.url));
 const invoiceHtml=await readFile(new URL('./invoice.html',import.meta.url)),invoiceJs=await readFile(new URL('./invoice-ui.mjs',import.meta.url));
 const procurementReadHtml=await readFile(new URL('./procurement-public-read.html',import.meta.url)),procurementReadJs=await readFile(new URL('./procurement-public-read-ui.mjs',import.meta.url));
 const publicReadHtml=await readFile(new URL('./invoice-public-read.html',import.meta.url)),publicReadJs=await readFile(new URL('./invoice-public-read-ui.mjs',import.meta.url));
 const publicSubmitHtml=await readFile(new URL('./invoice-public-submit.html',import.meta.url)),publicSubmitJs=await readFile(new URL('./invoice-public-submit-ui.mjs',import.meta.url));
 const publicApproveHtml=await readFile(new URL('./invoice-public-approve.html',import.meta.url)),publicApproveJs=await readFile(new URL('./invoice-public-approve-ui.mjs',import.meta.url));
 const publicCancelHtml=await readFile(new URL('./invoice-public-cancel.html',import.meta.url)),publicCancelJs=await readFile(new URL('./invoice-public-cancel-ui.mjs',import.meta.url));
 const publicImportHtml=await readFile(new URL('./invoice-public-import.html',import.meta.url)),publicImportJs=await readFile(new URL('./invoice-public-import-ui.mjs',import.meta.url));
 const publicCorrectHtml=await readFile(new URL('./invoice-public-correct.html',import.meta.url)),publicCorrectJs=await readFile(new URL('./invoice-public-correct-ui.mjs',import.meta.url));
 const publicReconcileHtml=await readFile(new URL('./invoice-public-reconcile.html',import.meta.url)),publicReconcileJs=await readFile(new URL('./invoice-public-reconcile-ui.mjs',import.meta.url));
 const server=createServer(async(req,res)=>{
  res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
   if(req.headers.host!==new URL(origin).host)fail('PERMISSION_DENIED');
   const url=new URL(req.url,origin),cookies=Object.fromEntries((req.headers.cookie??'').split(';').filter(Boolean).map(v=>v.trim().split('=')));
   const cookie=(name,value)=>`${name}=${value}; HttpOnly; SameSite=Lax; Path=/`;
   if(req.method==='GET'&&url.pathname==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end(html);return;}
   if(req.method==='GET'&&url.pathname==='/portal.mjs'){res.setHeader('content-type','text/javascript');res.end(js);return;}
   if(req.method==='GET'&&['/admin','/admin.mjs'].includes(url.pathname)){res.setHeader('content-type',url.pathname==='/admin'?'text/html; charset=utf-8':'text/javascript');res.end(url.pathname==='/admin'?adminHtml:adminJs);return;}
   if(req.method==='GET'&&['/controls','/controls.mjs'].includes(url.pathname)){res.setHeader('content-type',url.pathname==='/controls'?'text/html; charset=utf-8':'text/javascript');res.end(url.pathname==='/controls'?controlsHtml:controlsJs);return;}
   if(req.method==='GET'&&['/assurance','/assurance.mjs'].includes(url.pathname)){res.setHeader('content-type',url.pathname==='/assurance'?'text/html; charset=utf-8':'text/javascript');res.end(url.pathname==='/assurance'?assuranceHtml:assuranceJs);return;}
   if(req.method==='GET'&&['/procurement','/procurement.mjs'].includes(url.pathname)){res.setHeader('content-type',url.pathname==='/procurement'?'text/html; charset=utf-8':'text/javascript');res.end(url.pathname==='/procurement'?procurementHtml:procurementJs);return;}
   if(req.method==='GET'&&['/invoice','/invoice.mjs'].includes(url.pathname)){res.setHeader('content-type',url.pathname==='/invoice'?'text/html; charset=utf-8':'text/javascript');res.end(url.pathname==='/invoice'?invoiceHtml:invoiceJs);return;}
   if(req.method==='GET'&&url.pathname==='/login'){const login=await oidc.start(origin+'/callback');res.writeHead(302,{'set-cookie':cookie('oidc_state',login.state),location:login.url}).end();return;}
   if(req.method==='GET'&&url.pathname==='/callback'){
    const session=await oidc.complete({state:url.searchParams.get('state'),code:url.searchParams.get('code'),stateCookie:cookies.oidc_state,redirect:origin+'/callback'});
    res.writeHead(302,{'set-cookie':[cookie('enterprise_session',session.token),cookie('oidc_state','')+'; Max-Age=0'],location:'/'}).end();return;
   }
   if(req.method==='POST'&&url.pathname.startsWith('/webhooks/')){const parts=url.pathname.split('/');if(parts.length!==4)fail('INVALID_ARGUMENT');let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>65536)fail('INVALID_ARGUMENT');}const result=await receiveWebhook(kernel,parts[2],parts[3],{timestamp:req.headers['x-timestamp'],signature:req.headers['x-signature'],raw});res.setHeader('content-type','application/json');res.end(JSON.stringify(result));return;}
   const token=cookies.enterprise_session;if(!token)fail('PERMISSION_DENIED');const credential={token};
   const identity=await kernel.state.transaction(async u=>{const r=new EnterpriseRepository(u);checkCredentialRecovery(kernel,tokenDigest(token));const person=await u.identity(token);if(!person)fail('PERMISSION_DENIED');await checkAuthorityRecovery(kernel,r,person.tenant);const c=await authority(u,r,credential,'read'),s=await r.browserSession(tokenDigest(token));if(!s)fail('PERMISSION_DENIED');return {actor:c.actor,scopes:c.scopes,csrf:s.csrf};});
   if(req.method==='GET'&&url.pathname==='/session'){res.setHeader('content-type','application/json');res.end(JSON.stringify(identity));return;}
   if(req.method==='GET'&&['/enterprise/ENT-202-reconcile','/enterprise/ENT-202-reconcile.mjs'].includes(url.pathname)){res.setHeader('content-type',url.pathname.endsWith('.mjs')?'text/javascript':'text/html; charset=utf-8');res.end(url.pathname.endsWith('.mjs')?publicReconcileJs:publicReconcileHtml);return;}
   if(req.method==='GET'&&['/enterprise/ENT-202-correct','/enterprise/ENT-202-correct.mjs'].includes(url.pathname)){res.setHeader('content-type',url.pathname.endsWith('.mjs')?'text/javascript':'text/html; charset=utf-8');res.end(url.pathname.endsWith('.mjs')?publicCorrectJs:publicCorrectHtml);return;}
   if(req.method==='GET'&&['/enterprise/ENT-202-import','/enterprise/ENT-202-import.mjs'].includes(url.pathname)){res.setHeader('content-type',url.pathname.endsWith('.mjs')?'text/javascript':'text/html; charset=utf-8');res.end(url.pathname.endsWith('.mjs')?publicImportJs:publicImportHtml);return;}
   if(req.method==='GET'&&['/enterprise/ENT-202-submit','/enterprise/ENT-202-submit.mjs'].includes(url.pathname)){res.setHeader('content-type',url.pathname.endsWith('.mjs')?'text/javascript':'text/html; charset=utf-8');res.end(url.pathname.endsWith('.mjs')?publicSubmitJs:publicSubmitHtml);return;}
   if(req.method==='GET'&&['/enterprise/ENT-202-approve','/enterprise/ENT-202-approve.mjs'].includes(url.pathname)){res.setHeader('content-type',url.pathname.endsWith('.mjs')?'text/javascript':'text/html; charset=utf-8');res.end(url.pathname.endsWith('.mjs')?publicApproveJs:publicApproveHtml);return;}
   if(req.method==='GET'&&['/enterprise/ENT-202-cancel','/enterprise/ENT-202-cancel.mjs'].includes(url.pathname)){res.setHeader('content-type',url.pathname.endsWith('.mjs')?'text/javascript':'text/html; charset=utf-8');res.end(url.pathname.endsWith('.mjs')?publicCancelJs:publicCancelHtml);return;}
   if(req.method==='GET'&&url.pathname==='/enterprise/ENT-201-public-read.mjs'){res.setHeader('content-type','text/javascript');res.end(procurementReadJs);return;}
   if(req.method==='GET'&&(url.pathname===procurementCasePath||url.pathname.startsWith(procurementCasePath+'/'))){if(url.pathname!==procurementCasePath){const part=url.pathname.slice(procurementCasePath.length+1);if(!part||part.includes('/'))fail('NOT_FOUND');let key;try{key=decodeURIComponent(part);}catch{fail('INVALID_ARGUMENT');}await procurementPublicRead(kernel,credential,{contractVersion:'2.0.0',packageId:'ENT-201',type:'ENT201Case',operation:'get',body:{id:key}});}res.setHeader('content-type','text/html; charset=utf-8');res.end(procurementReadHtml);return;}
   if(req.method==='GET'&&url.pathname==='/enterprise/ENT-202-public-read.mjs'){res.setHeader('content-type','text/javascript');res.end(publicReadJs);return;}
   if(req.method==='GET'&&(url.pathname===casePath||url.pathname.startsWith(casePath+'/'))){if(url.pathname!==casePath){const parts=url.pathname.slice(casePath.length+1);if(!parts||parts.includes('/'))fail('NOT_FOUND');await invoicePublicRead(kernel,credential,{contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',operation:'get',body:{id:decodeURIComponent(parts)}});}res.setHeader('content-type','text/html; charset=utf-8');res.end(publicReadHtml);return;}
   if(req.method!=='POST'||!['/api','/enterprise/v2/rpc','/enterprise/v2/reconcile'].includes(url.pathname))fail('NOT_FOUND');if(req.headers.origin!==origin||req.headers['x-csrf-token']!==identity.csrf||req.headers['content-type']!=='application/json')fail('PERMISSION_DENIED');
   let data='';for await(const chunk of req){data+=chunk;if(Buffer.byteLength(data)>131072)fail('INVALID_ARGUMENT');}let request;try{request=JSON.parse(data);}catch{fail('INVALID_ARGUMENT');}
   if(url.pathname==='/enterprise/v2/reconcile'){const result=await invoicePublicReconcile(kernel,credential,request,externalPort);res.setHeader('content-type','application/json');res.end(JSON.stringify(result));return;}
   if(url.pathname==='/enterprise/v2/rpc'){const result=await (request?.packageId==='ENT-201'?procurementPublicRead:request?.operation==='import'&&Object.hasOwn(request,'key')?invoicePublicImport:request?.operation==='correct'&&Object.hasOwn(request,'key')?invoicePublicCorrect:request?.operation==='submit'?invoicePublicSubmit:request?.operation==='cancel'&&Object.hasOwn(request,'key')?invoicePublicCancel:['approve','return'].includes(request?.operation)&&Object.hasOwn(request,'key')?invoicePublicApprove:invoicePublicRead)(kernel,credential,request);res.setHeader('content-type','application/json');res.end(JSON.stringify(result));return;}
   exact(request,['contractVersion','operation','body','key'],['contractVersion','operation','body']);if(request.contractVersion!=='2.0.0')fail('UNSUPPORTED_VERSION');
   let result;if(request.operation==='controlWork'){result=await kernel.enterpriseControlWork(credential,request.body);}else if(request.operation==='recover'){exact(request.body,[]);result=await kernel.enterpriseRecover(credential);}else if(['dispatch','reconcile','compensate'].includes(request.operation)){exact(request.body,request.operation==='dispatch'?['id']:['id','purpose'],['id']);result=await kernel.enterpriseWork(credential,{...request.body,mode:request.operation},externalPort);}else{const {contractVersion,...command}=request;result=await kernel.enterprise(credential,command);}
   res.setHeader('content-type','application/json');res.end(JSON.stringify({contractVersion:'2.0.0',result}));
  }catch(error){const code=error instanceof PlatformError?error.code:'UNAVAILABLE';try{await kernel.state.transaction(u=>u.audit({kind:'EnterpriseHTTPDenied',code}));}catch{}res.writeHead(code==='NOT_FOUND'?404:code==='PERMISSION_DENIED'?403:400,{'content-type':'application/json'}).end(JSON.stringify({error:{code}}));}
 });
 server.requestTimeout=5000;server.headersTimeout=5000;
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
 return {origin,async close(){await new Promise(resolve=>server.close(resolve));}};
}
