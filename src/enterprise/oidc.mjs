import {randomBytes,createHash,createPublicKey,verify} from 'node:crypto';
import {fail,tokenDigest} from '../contracts.mjs';
import {EnterpriseRepository} from '../adapters/enterprise.mjs';
const random=()=>randomBytes(32).toString('base64url');
export class EnterpriseOIDC {
 constructor(kernel,{issuer,clientId}){const u=new URL(issuer);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.pathname!=='/'||u.username||u.password||u.search||u.hash)fail('PERMISSION_DENIED');this.kernel=kernel;this.issuer=u.origin;this.clientId=clientId;}
 async start(redirect){
  const state=random(),nonce=random(),verifier=random();
  await this.kernel.state.transaction(u=>new EnterpriseRepository(u).oidcState(tokenDigest(state),{nonce,verifier,expires:new Date(Date.now()+300000)}));
  const params=new URLSearchParams({response_type:'code',client_id:this.clientId,redirect_uri:redirect,scope:'openid',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
  return {state,url:this.issuer+'/authorize?'+params};
 }
 async complete({state,code,stateCookie,redirect}){
  if(typeof state!=='string'||state!==stateCookie||typeof code!=='string')fail('PERMISSION_DENIED');
  const saved=await this.kernel.state.transaction(u=>new EnterpriseRepository(u).takeOidcState(tokenDigest(state)));if(!saved)fail('PERMISSION_DENIED');
  const response=await fetch(this.issuer+'/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(1500),headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,client_id:this.clientId,redirect_uri:redirect,code_verifier:saved.verifier})});if(!response.ok)fail('PERMISSION_DENIED');
  const {id_token}=await response.json();if(typeof id_token!=='string'||id_token.length>16384)fail('PERMISSION_DENIED');
  const parts=id_token.split('.');if(parts.length!==3)fail('PERMISSION_DENIED');let header,claims;try{header=JSON.parse(Buffer.from(parts[0],'base64url'));claims=JSON.parse(Buffer.from(parts[1],'base64url'));}catch{fail('PERMISSION_DENIED');}
  if(header.alg!=='RS256'||header.typ!=='JWT'||typeof header.kid!=='string')fail('PERMISSION_DENIED');
  const keysResponse=await fetch(this.issuer+'/jwks',{redirect:'error',signal:AbortSignal.timeout(1500)});if(!keysResponse.ok)fail('UNAVAILABLE');const {keys}=await keysResponse.json();
  const matches=Array.isArray(keys)?keys.filter(k=>k.kid===header.kid&&k.kty==='RSA'&&k.alg==='RS256'&&k.use==='sig'):[];if(matches.length!==1)fail('PERMISSION_DENIED');
  const key=createPublicKey({key:matches[0],format:'jwk'});if(!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),key,Buffer.from(parts[2],'base64url')))fail('PERMISSION_DENIED');
  const now=Math.floor(Date.now()/1000);if(claims.iss!==this.issuer||claims.aud!==this.clientId||claims.nonce!==saved.nonce||typeof claims.sub!=='string'||!Number.isInteger(claims.exp)||claims.exp<=now||!Number.isInteger(claims.iat)||claims.iat>now+30||claims.exp-claims.iat>3600||(claims.nbf!==undefined&&(!Number.isInteger(claims.nbf)||claims.nbf>now)))fail('PERMISSION_DENIED');
  const token=random(),csrf=random();
  await this.kernel.state.transaction(async u=>{const r=new EnterpriseRepository(u),mapping=await r.oidcSubject(this.issuer,claims.sub);if(!mapping)fail('PERMISSION_DENIED');const p=await u.principal(mapping.principal);if(!p?.active)fail('PERMISSION_DENIED');await r.session(tokenDigest(token),p.id,new Date(claims.exp*1000),csrf);await u.audit({kind:'EnterpriseOIDCLogin',actor:p.id,issuer:this.issuer});});
  return {token,csrf};
 }
}
