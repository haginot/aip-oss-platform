import {randomUUID} from 'node:crypto';
import {withFixture} from './helpers.mjs';
import {scope} from '../../scripts/enterprise/fixture.mjs';
import {referencePublication} from '../../scripts/enterprise/reference/publication.mjs';
import {SyntheticPort} from '../../src/enterprise/worker.mjs';
export {scope};
export async function withControls(fn){return withFixture(async(f,cluster)=>{const a=await referencePublication(cluster),b=await referencePublication(cluster,{withdrawable:false});f.kernel.controlPorts={web:new SyntheticPort(a.url),mail:new SyntheticPort(b.url),handoff:new SyntheticPort(a.url)};try{await fn(f,{a,b,cluster});}finally{await a.close();await b.close();}},{documentScanner:async()=>true});}
export async function source(f){const o=f.create();await f.call('operator','create',o);const id=randomUUID();await f.call('operator','informationCreate',{id,scope,source:{kind:'object',id:o.id,projection:['title']},label:'CONFIDENTIAL',purposes:['summary','disclosure']});return id;}
export const rightBody=()=>({id:randomUUID(),scope,subject:'synthetic-subject',material:'synthetic-material',purposes:['disclosure'],media:['web','mail'],regions:['JP'],starts:'2020-01-01T00:00:00Z',expires:'2099-01-01T00:00:00Z',indirect:false,evidenceVersion:'fixture-v1'});
export async function release(f,{channels=['web'],embargo='2020-01-01T00:00:00Z',correctionOf}={}){const info=await source(f),right=rightBody();right.material='object:'+(await f.call('manager','controlRead',{id:info,purpose:'disclosure'})).data.sources[0].id;await f.call('manager','rightGrant',right);const id=randomUUID();await f.call('operator','releaseCreate',{id,scope,source:info,subject:right.subject,purpose:'disclosure',rights:[right.id],channels,region:'JP',indirect:false,embargo,...(correctionOf?{correctionOf}:{})});return {id,right,info};}
export async function approve(f,id,withdrawal=false){for(const [who,role] of [['manager','legal'],['reviewer','pr'],['publisher','ir']]){const x=await f.call(who,'controlRead',{id});await f.call(who,'releaseApprove',{id,revision:x.revision,role,withdrawal});}}
export const work=(f,id,channel='web',mode='dispatch',who='manager')=>f.kernel.enterpriseControlWork(f.credentials[who],{id,channel,mode});
