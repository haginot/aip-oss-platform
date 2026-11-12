// Independent synthetic authorization server. Accounts are invented fixture IDs only.
import {createServer} from 'node:http';
import {generateKeyPairSync,randomBytes,createHash,sign} from 'node:crypto';
import pg from 'pg';
export async function referenceOIDC(cluster){
 const schema='idp_'+randomBytes(8).toString('hex');await cluster.admin.query(`CREATE SCHEMA ${schema}`);const db=new pg.Pool({...cluster.config,options:`-c search_path=${schema}`});
 await db.query('CREATE TABLE codes(code text PRIMARY KEY, claims jsonb NOT NULL, challenge text NOT NULL, redirect text NOT NULL, client text NOT NULL, expires timestamptz NOT NULL)');
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const kid='synthetic-1',jwk={...publicKey.export({format:'jwk'}),kid,alg:'RS256',use:'sig'};let issuer,override={},badSignature=false;
 const accounts=['operator','manager','reviewer','publisher','reader','other','tenant2','agent'];
 const server=createServer(async(req,res)=>{try{const u=new URL(req.url,issuer);
  if(req.method==='GET'&&u.pathname==='/jwks'){res.setHeader('content-type','application/json');res.end(JSON.stringify({keys:[jwk]}));return;}
  if(req.method==='GET'&&u.pathname==='/authorize'){
   const p=u.searchParams,redirect=new URL(p.get('redirect_uri'));if(redirect.protocol!=='http:'||redirect.hostname!=='127.0.0.1'||redirect.pathname!=='/callback'||redirect.username||redirect.password||p.get('client_id')!=='enterprise-local'||p.get('response_type')!=='code'||p.get('code_challenge_method')!=='S256')throw Error('invalid request');
   if(!p.has('account')){const hidden=[...p].map(([k,v])=>`<input type="hidden" name="${escape(k)}" value="${escape(v)}">`).join('');res.setHeader('content-type','text/html; charset=utf-8');res.end(`<h1>Synthetic identity provider</h1><p>架空のローカル検証アカウント</p><form>${hidden}<label>Account <select name="account">${accounts.map(a=>`<option>${a}</option>`).join('')}</select></label><button>Sign in</button></form>`);return;}
   const account=p.get('account');if(!accounts.includes(account))throw Error('unknown account');const code=randomBytes(24).toString('base64url'),now=Math.floor(Date.now()/1000);
   const claims={iss:issuer,aud:p.get('client_id'),sub:account,nonce:p.get('nonce'),iat:now,exp:now+1800,...override};
   await db.query("INSERT INTO codes VALUES($1,$2,$3,$4,$5,now()+interval '1 minute')",[code,claims,p.get('code_challenge'),redirect.href,p.get('client_id')]);redirect.searchParams.set('code',code);redirect.searchParams.set('state',p.get('state'));res.writeHead(302,{location:redirect.href}).end();return;
  }
  if(req.method==='POST'&&u.pathname==='/token'){
   let data='';for await(const chunk of req){data+=chunk;if(data.length>16384)throw Error('size');}const p=new URLSearchParams(data);
   const row=(await db.query('DELETE FROM codes WHERE code=$1 AND expires>now() RETURNING *',[p.get('code')])).rows[0];
   if(!row||row.client!==p.get('client_id')||row.redirect!==p.get('redirect_uri')||row.challenge!==createHash('sha256').update(p.get('code_verifier')??'').digest('base64url')||p.get('grant_type')!=='authorization_code')throw Error('invalid grant');
   const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),unsigned=encode({alg:'RS256',typ:'JWT',kid})+'.'+encode(row.claims);const signature=sign('RSA-SHA256',Buffer.from(unsigned),privateKey);if(badSignature)signature[0]^=1;
   res.setHeader('content-type','application/json');res.end(JSON.stringify({id_token:unsigned+'.'+signature.toString('base64url')}));return;
  }res.writeHead(404).end();
 }catch{res.writeHead(400).end('{"error":"invalid_request"}');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));issuer=`http://127.0.0.1:${server.address().port}`;
 return {issuer,claims(value){override=value;},signatureInvalid(value){badSignature=value;},async close(){await new Promise(resolve=>server.close(resolve));await db.end();}};
}
function escape(value){return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
