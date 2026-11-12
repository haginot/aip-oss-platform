const $=selector=>document.querySelector(selector);
let generation=0,retentionEpoch=0,binding=null,inFlight=null;
const retainedIds=new Set();
function actionState(){ $('#reconcile').disabled=Boolean(inFlight)||!binding||binding.payment.state!=='UNKNOWN'||binding.payment.reservation!=='HELD'; }
function hideResult(){ $('#result').hidden=true;$('#observation').replaceChildren();for(const key of Object.keys($('#result').dataset))delete $('#result').dataset[key]; }
function clear(){
 generation++;retentionEpoch++;binding=null;retainedIds.clear();
 for(const id of ['identity','state','summary','history','observation'])$('#'+id).replaceChildren();
 for(const element of document.querySelectorAll('select'))element.replaceChildren();
 for(const element of document.querySelectorAll('input,select,textarea')){element.value='';if(element.tagName==='SELECT')element.selectedIndex=-1;}
 for(const element of document.querySelectorAll('*'))for(const key of Object.keys(element.dataset))delete element.dataset[key];
 $('#case-detail').hidden=true;$('#result').hidden=true;actionState();
 $('#message').textContent='現在の参照権限を確認できません。保持情報を消去しました。再ログイン後、現在の情報を読み込んでください。';
}
async function session(){const response=await fetch('/session'),value=await response.json();if(!response.ok||!value.actor)throw Object.assign(Error('PERMISSION_DENIED'),{status:403});return value;}
async function rpc(identity,operation,body={},path='/enterprise/v2/rpc'){
 const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':identity.csrf},body:JSON.stringify({contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',operation,body})});
 const value=await response.json();if(!response.ok)throw Object.assign(Error(value.error?.code||'UNAVAILABLE'),{status:response.status});
 if(value.contractVersion!=='2.0.0'||value.packageId!=='ENT-202'||value.type!=='ENT202Case'||!value.result)throw Error('INVALID_RESPONSE');return value.result;
}
// Every retained option and selected history is reread under the current session.
async function current(identity,selected){
 const list=await rpc(identity,'query'),ids=list.items.map(item=>item.id);
 if([...retainedIds].some(id=>!ids.includes(id)))throw Object.assign(Error('NOT_FOUND'),{status:404});
 for(const id of new Set([...retainedIds,...ids]))await rpc(identity,'get',{id});
 let detail=null,history=null;
 if(selected){if(!ids.includes(selected))throw Object.assign(Error('NOT_FOUND'),{status:404});detail=await rpc(identity,'inspect',{id:selected});history=await rpc(identity,'history',{id:selected});detail=await rpc(identity,'get',{id:selected});}
 return {list,detail,history};
}
function present(identity,value,selected){
 $('#identity').textContent='ログイン中: '+identity.actor;
 const options=value.list.items.map(item=>{const option=document.createElement('option');option.value=item.id;option.textContent='支払ID: '+item.id;return option;});
 const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='支払を選択してください';$('#payment-id').replaceChildren(placeholder,...options);$('#payment-id').value=selected||'';
 retainedIds.clear();for(const item of value.list.items)retainedIds.add(item.id);binding=value.detail;hideResult();
 $('#case-detail').hidden=!binding;for(const key of Object.keys($('#case-detail').dataset))delete $('#case-detail').dataset[key];
 for(const id of ['state','summary','history'])$('#'+id).replaceChildren();
 if(binding){$('#case-detail').dataset.id=binding.id;$('#state').textContent='支払状態: '+binding.payment.state+' / 予約: '+binding.payment.reservation;$('#summary').textContent='支払ID: '+binding.identity.paymentId+'\n請求書ID: '+binding.identity.invoiceId+'\n'+JSON.stringify(binding,null,2);$('#history').textContent=JSON.stringify(value.history,null,2);}
 actionState();
}
async function refresh(){
 const mine=++generation,epoch=retentionEpoch,selected=$('#payment-id').value;
 try{const identity=await session(),value=await current(identity,selected);if(mine!==generation||epoch!==retentionEpoch)return;present(identity,value,selected);$('#message').textContent=selected?'選択した支払の現在情報を確認しました。':'現在の支払一覧を確認しました。';}
 catch{if(epoch===retentionEpoch)clear();}
}
$('#payment-id').addEventListener('input',()=>{generation++;binding=null;hideResult();$('#case-detail').hidden=true;for(const id of ['state','summary','history'])$('#'+id).replaceChildren();for(const key of Object.keys($('#case-detail').dataset))delete $('#case-detail').dataset[key];actionState();});
$('#load').addEventListener('click',refresh);$('#refresh').addEventListener('click',refresh);
$('#reconcile-form').addEventListener('submit',async event=>{
 event.preventDefault();if(inFlight||!binding||binding.id!==$('#payment-id').value||binding.payment.state!=='UNKNOWN'||binding.payment.reservation!=='HELD')return;
 const id=binding.id,mine=++generation,epoch=retentionEpoch,token={};inFlight=token;actionState();hideResult();$('#message').textContent='支払結果を照合しています…';
 try{
  const identity=await session();await current(identity,id);if(mine!==generation||epoch!==retentionEpoch)return;
  let result,error;
  try{result=await rpc(identity,'reconcile',{id},'/enterprise/v2/reconcile');}catch(cause){error=cause;}
  if(epoch!==retentionEpoch)return;
  // Even a lost response or operation-only denial requires fresh proof for all retained data.
  const latest=await session(),selected=$('#payment-id').value,value=await current(latest,selected);
  if(mine!==generation||epoch!==retentionEpoch)return;
  present(latest,value,selected);
  if(error){$('#message').textContent='照合の応答を確認できません。現在の支払状態を確認しました。自動再送は行いません。';return;}
  const summary=result.reconciliation,validSummary=summary&&Object.keys(summary).sort().join(',')==='observation,requiresHumanReview'&&['SUCCEEDED','ABSENT','UNKNOWN'].includes(summary.observation)&&summary.requiresHumanReview===(summary.observation!=='SUCCEEDED');
  if(!validSummary||result.id!==id||result.identity?.paymentId!==id||result.payment?.reservation!=='HELD'||result.payment?.state!==(summary.observation==='SUCCEEDED'?'SUCCEEDED':'UNKNOWN'))throw Error('INVALID_RESPONSE');
  // A newer current read may have advanced the state; never display an old outcome as current.
  const observation=value.detail.payment.state==='SUCCEEDED'?'SUCCEEDED':summary.observation==='SUCCEEDED'?'UNKNOWN':summary.observation;
  $('#observation').textContent=observation==='SUCCEEDED'?'照合済み: SUCCEEDED。支払成功を確認しました。':observation==='ABSENT'?'照合結果: ABSENT。支払は UNKNOWN / HELD のままです。人による確認が必要です。':'照合結果: UNKNOWN。支払は UNKNOWN / HELD のままです。人による確認が必要です。';
  $('#result').hidden=false;$('#result').dataset.id=id;$('#result-title').focus();$('#message').textContent='現在の支払結果を確認しました。';
 }catch{if(epoch===retentionEpoch)clear();}
 finally{if(inFlight===token)inFlight=null;actionState();}
});
window.addEventListener('focus',refresh);window.addEventListener('pagehide',clear);refresh();
