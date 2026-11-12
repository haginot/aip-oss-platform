import assert from 'node:assert/strict';
import {browser} from './browser-helper.mjs';
export async function portalScenario(env){
 const page=await browser();const signIn=async account=>{await page.navigate(env.gateway.origin+'/login');await page.until('!!document.querySelector("select[name=account]")');await page.fill('select[name=account]',account);await page.click('button');await page.until(`document.querySelector('#identity')?.textContent==='ログイン中: ${account}'`);await page.until('document.querySelector("#workspace")?.hidden===false');};
 try{
 await signIn('operator');for(const [key,value] of Object.entries({title:'Browser synthetic approval',amount:'1200',currency:'JPY',memo:'RESTRICTED synthetic only'}))await page.fill('#field-'+key,value);
 await page.click('#create button');await page.until('document.querySelector("#record").dataset.state==="WAITING_APPROVAL"');const id=await page.evaluate('document.querySelector("#record").dataset.id');await page.screenshot('01-created');
 await page.click('[data-decision=APPROVE]');await page.until('document.querySelector("#message").textContent.includes("PERMISSION_DENIED")');
 for(const account of ['manager','reviewer','publisher']){await signIn(account);await page.until('document.querySelectorAll("#cases button").length===1');await page.click('#cases button');await page.until('document.querySelector("#record").dataset.state==="WAITING_APPROVAL"');await page.click('[data-decision=APPROVE]');await page.until(`!!document.querySelector('#record [data-actor="${account}"]')`);}
 await page.until('document.querySelector("#record").dataset.state==="READY"');env.effects.fault('lost-ack');await page.click('[data-operation=dispatch]');await page.until('document.querySelector("#record").dataset.state==="UNKNOWN"');await page.screenshot('02-unknown');
 await page.click('[data-operation=reconcile]');await page.until('document.querySelector("#record").dataset.state==="SUCCEEDED"');await page.click('[data-operation=compensate]');await page.until('document.querySelector("#record").dataset.state==="COMPENSATED"');await page.screenshot('03-compensated');
 await signIn('reader');await page.until('document.querySelectorAll("#cases button").length===1');await page.click('#cases button');await page.until('document.querySelector("#record").dataset.state==="COMPENSATED"');assert.equal(await page.evaluate('document.querySelector("#record").textContent.includes("RESTRICTED synthetic only")'),false);await page.screenshot('04-reader-masked');
 await signIn('other');await page.until('document.querySelectorAll("#cases button").length===0');await page.screenshot('05-other-department');
 const ledger=await env.effects.ledger();assert.equal(ledger.length,1);assert.equal(ledger[0].applications,1);assert.equal(ledger[0].reversals,1);
 return {id,browser:await page.send('Browser.getVersion'),steps:['OIDC login','typed form create','unauthorized vote rejected','parallel approvals','serial approval','lost acknowledgement UNKNOWN','reconciliation','compensation','field masking','department isolation'],ledger:ledger.map(x=>({id:x.id,applications:x.applications,reversals:x.reversals}))};
 }finally{await page.close();}
}
