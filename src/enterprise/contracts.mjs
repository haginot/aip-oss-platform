import {invoicePackage} from './invoice.mjs';
import {procurementPackage} from './procurement.mjs';
import {exact,fail,digest,typed} from '../contracts.mjs';
export const contractVersion='2.0.0';
export const classifications=['PUBLIC','INTERNAL','CONFIDENTIAL','STRICT','RESTRICTED'];
export function id(value){if(typeof value!=='string'||!/^[-a-zA-Z0-9_.:]{1,128}$/.test(value))fail('INVALID_ARGUMENT');return value;}
export function scope(value){exact(value,['legalEntityId','departmentId','caseId','classification']);for(const k of ['legalEntityId','departmentId','caseId'])id(value[k]);if(!classifications.includes(value.classification))fail('INVALID_ARGUMENT');return value;}
export function sameScope(a,b){return digest(a)===digest(b);}
export function route(value){
 if(!Array.isArray(value)||value.length<1||value.length>8)fail('INVALID_ARGUMENT');
 for(const stage of value){exact(stage,['approvers','quorum']);if(!Array.isArray(stage.approvers)||!stage.approvers.length||stage.approvers.length>12||new Set(stage.approvers).size!==stage.approvers.length)fail('INVALID_ARGUMENT');stage.approvers.forEach(id);if(!Number.isInteger(stage.quorum)||stage.quorum<1||stage.quorum>stage.approvers.length)fail('INVALID_ARGUMENT');}
}
export function validatePackage(p){
 exact(p,['id','version','types','form','action','route','amountRoutes','permissions','fixtures','calendar']);id(p.id);if(typeof p.version!=='string'||!/^\d+\.\d+\.\d+$/.test(p.version))fail('INVALID_ARGUMENT');
 if(!p.types||Array.isArray(p.types)||Object.keys(p.types).length>24)fail('INVALID_ARGUMENT');
 for(const [name,fields] of Object.entries(p.types)){id(name);if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).length>32)fail('INVALID_ARGUMENT');for(const [key,f] of Object.entries(fields)){id(key);exact(f,['type','classification']);if(!['string','integer','boolean'].includes(f.type)||!classifications.includes(f.classification))fail('INVALID_ARGUMENT');}}
 for(const name of ['LegalEntity','Department','Case','Employment','Position','Classification'])if(!p.types[name])fail('INVALID_ARGUMENT');
 exact(p.action,['name','type']);id(p.action.name);if(!p.types[p.action.type])fail('INVALID_ARGUMENT');
 if(!Array.isArray(p.form)||p.form.length!==Object.keys(p.types[p.action.type]).length)fail('INVALID_ARGUMENT');
 const keys=new Set();for(const f of p.form){exact(f,['field','label']);if(!p.types[p.action.type][f.field]||keys.has(f.field)||typeof f.label!=='string'||f.label.length>80)fail('INVALID_ARGUMENT');keys.add(f.field);}
 route(p.route);if(!Array.isArray(p.amountRoutes)||p.amountRoutes.length>10)fail('INVALID_ARGUMENT');for(const r of p.amountRoutes){exact(r,['currency','minAmount','route']);if(!/^[A-Z]{3}$/.test(r.currency)||!Number.isSafeInteger(r.minAmount)||r.minAmount<0)fail('INVALID_ARGUMENT');route(r.route);}
 exact(p.permissions,['create','approve']);if(p.permissions.create!=='action'||p.permissions.approve!=='approve')fail('INVALID_ARGUMENT');
 exact(p.calendar,['timezone','weekdays','holidays','businessDays']);try{new Intl.DateTimeFormat('en',{timeZone:p.calendar.timezone});}catch{fail('INVALID_ARGUMENT');}
 if(!Array.isArray(p.calendar.weekdays)||!p.calendar.weekdays.length||p.calendar.weekdays.some(n=>!Number.isInteger(n)||n<1||n>7)||!Array.isArray(p.calendar.holidays)||p.calendar.holidays.some(x=>!/^\d{4}-\d{2}-\d{2}$/.test(x))||!Number.isInteger(p.calendar.businessDays)||p.calendar.businessDays<1||p.calendar.businessDays>30)fail('INVALID_ARGUMENT');
 if(!Array.isArray(p.fixtures)||p.fixtures.length<2||p.fixtures.length>20)fail('INVALID_ARGUMENT');
 for(const f of p.fixtures){exact(f,['fields','expected']);if(!['valid','invalid'].includes(f.expected))fail('INVALID_ARGUMENT');let valid=true;try{fields(p,p.action.type,f.fields);}catch{valid=false;}if(valid!==(f.expected==='valid'))fail('SIMULATION_FAILED');}
 procurementPackage(p);invoicePackage(p);return p;
}
export function fields(p,type,value){const fs=p.types[type];if(!fs)fail('INVALID_ARGUMENT');exact(value,Object.keys(fs));for(const [key,f] of Object.entries(fs))typed(value[key],f);if('amount' in value&&(!Number.isSafeInteger(value.amount)||value.amount<0||! /^[A-Z]{3}$/.test(value.currency)))fail('INVALID_ARGUMENT');return value;}
export function approvalRoute(p,value){return p.amountRoutes.filter(r=>r.currency===value.currency&&value.amount>=r.minAmount).sort((a,b)=>b.minAmount-a.minAmount)[0]?.route??p.route;}
export function deadline(now,calendar){
 // Walk UTC instants while counting local calendar date boundaries, including DST.
 const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:calendar.timezone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'});
 const local=t=>{const x=Object.fromEntries(fmt.formatToParts(t).map(v=>[v.type,v.value]));return {date:`${x.year}-${x.month}-${x.day}`,day:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(x.weekday)+1};};
 let last=local(now).date,remaining=calendar.businessDays;
 for(let at=Math.floor(now/60000)*60000+60000;at<now+120*86400000;at+=60000){const d=local(at);if(d.date===last)continue;last=d.date;if(calendar.weekdays.includes(d.day)&&!calendar.holidays.includes(d.date)&&!--remaining)return new Date(at);}
 fail('INVALID_ARGUMENT');
}
