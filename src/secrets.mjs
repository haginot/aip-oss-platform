import {open,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {fail,exact} from './contracts.mjs';
// Local synthetic secret provider. The key is injected from a restrictive file;
// database, journal, HTTP responses and diagnostics contain only opaque refs.
export class FileSecrets {
 #capability;
 constructor(directory,keyPath,{clock=()=>Date.now(),capability}={}) {if(!capability||typeof capability!=='object')fail('INVALID_ARGUMENT');this.#capability=capability;this.directory=directory;this.keyPath=keyPath;this.clock=clock;}
 async #key() {
  const file=await open(this.keyPath,'r');try{const stat=await file.stat();if(!stat.isFile()||(stat.mode&0o077))fail('PERMISSION_DENIED');const key=await file.readFile();if(key.length!==32)fail('INVALID_ARGUMENT');return key;}finally{await file.close();}
 }
 path(ref){if(typeof ref!=='string'||!/^secret:[a-f0-9]{32}$/.test(ref))fail('INVALID_ARGUMENT');return join(this.directory,ref.slice(7)+'.json');}
 async #save(ref,row){const path=this.path(ref),temporary=path+'.'+randomBytes(8).toString('hex');const file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify(row));await file.sync();}finally{await file.close();}await rename(temporary,path);const dir=await open(this.directory,'r');try{await dir.sync();}finally{await dir.close();}}
 async #read(ref){const file=await open(this.path(ref),'r');try{const stat=await file.stat();if(!stat.isFile()||(stat.mode&0o077))fail('PERMISSION_DENIED');return JSON.parse(await file.readFile('utf8'));}finally{await file.close();}}
 async #seal(ref,value){if(typeof value!=='string'||value.length<16||value.length>4096)fail('INVALID_ARGUMENT');const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',await this.#key(),iv);cipher.setAAD(Buffer.from(ref));const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return {iv:iv.toString('hex'),data:data.toString('hex'),tag:cipher.getAuthTag().toString('hex')};}
 async inject(value){const ref='secret:'+randomBytes(16).toString('hex');await this.#save(ref,{active:await this.#seal(ref,value),previous:null,until:0});return ref;}
 authorize(principal){if(principal!==this.#capability)fail('PERMISSION_DENIED');}
 async rotate(ref,value,overlapMs,principal){this.authorize(principal);if(!Number.isInteger(overlapMs)||overlapMs<0||overlapMs>60000)fail('INVALID_ARGUMENT');const row=await this.#read(ref);await this.#save(ref,{active:await this.#seal(ref,value),previous:row.active,until:this.clock()+overlapMs});}
 async resolve(ref,principal,{previous=false}={}){this.authorize(principal);const row=await this.#read(ref);exact(row,['active','previous','until']);if(previous&&(!row.previous||this.clock()>=row.until))fail('PERMISSION_DENIED');const sealed=previous?row.previous:row.active;try{const decipher=createDecipheriv('aes-256-gcm',await this.#key(),Buffer.from(sealed.iv,'hex'));decipher.setAAD(Buffer.from(ref));decipher.setAuthTag(Buffer.from(sealed.tag,'hex'));return Buffer.concat([decipher.update(Buffer.from(sealed.data,'hex')),decipher.final()]).toString('utf8');}catch{fail('PERMISSION_DENIED');}}
}

// Grants are trusted launch configuration, never caller-supplied identity.
// Audit must commit before any secret is returned to an outbound transport.
export class ServiceSecrets {
 #provider; #capability; #kernel; #grants;
 constructor(provider,capability,kernel,grants){this.#provider=provider;this.#capability=capability;this.#kernel=kernel;this.#grants=structuredClone(grants);}
 async resolve(ref,credential,options){this.#provider.path(ref);return this.#kernel.call(credential,'secret',async(u,c)=>{
  const grant=this.#grants.find(g=>g.ref===ref&&g.actor===c.actor&&g.tenant===c.tenant&&c.stores.includes(g.store));
  if(!grant||c.onBehalfOf){await u.audit({kind:'SecretDenied',reference:ref,actor:c.actor});return {denied:true};}
  const value=await this.#provider.resolve(ref,this.#capability);
  await u.audit({kind:'SecretResolved',reference:ref,actor:c.actor,tenant:c.tenant,store:grant.store});return {value};
 },options).then(result=>{if(result.denied)fail('PERMISSION_DENIED');return result.value;});}
}
