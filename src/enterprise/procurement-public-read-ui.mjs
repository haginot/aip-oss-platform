const $=s=>document.querySelector(s),path='/enterprise/cases/ENT-201';
let generation=0;
function clear(){
 for(const selector of ['#identity','#case-list','#state','#summary','#quantity','#binding','#approvals','#history'])$(selector).replaceChildren();
 $('#case-detail').hidden=true;
 for(const el of document.querySelectorAll('*'))for(const k of Object.keys(el.dataset))delete el.dataset[k];
 for(const el of document.querySelectorAll('input,textarea,select')){el.value='';if(el.tagName==='SELECT')el.selectedIndex=-1;}
}
async function api(session,operation,body){
 const response=await fetch('/enterprise/v2/rpc',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrf},body:JSON.stringify({contractVersion:'2.0.0',packageId:'ENT-201',type:'ENT201Case',operation,body})});
 const value=await response.json();if(!response.ok)throw Object.assign(Error(value.error.code),{status:response.status});return value.result;
}
function row(label,value){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);$('#summary').append(dt,dd);}
async function load(){
 const mine=++generation;clear();$('#message').textContent='確認中…';
 try{
  const response=await fetch('/session'),session=await response.json();if(!response.ok||!session.actor)throw Object.assign(Error('PERMISSION_DENIED'),{status:403});
  const list=await api(session,'query',{}),suffix=location.pathname.slice(path.length);let detail,history;
  if(suffix){if(!/^\/[^/]+$/.test(suffix))throw Object.assign(Error('NOT_FOUND'),{status:404});const id=decodeURIComponent(suffix.slice(1));detail=await api(session,'inspect',{id});history=await api(session,'history',{id});}
  if(mine!==generation)return;
  $('#identity').textContent='ログイン中: '+session.actor;
  $('#case-list').replaceChildren(...list.items.map(item=>{const li=document.createElement('li'),a=document.createElement('a');a.href=path+'/'+encodeURIComponent(item.id);a.textContent='購買案件 '+item.id;li.append(a);return li;}));
  if(detail){
   const p=detail.purchase;
   for(const [label,value] of [['購買ID',p.id],['申請名',p.fields.title],['Object版',detail.revision],['固定定義版',detail.definition.version],['金額',p.fields.amount+' '+p.fields.currency],['見積版',p.fields.quoteVersion??'不明']])row(label,value);
   $('#state').textContent='購買状態: '+p.state;
   $('#quantity').textContent=JSON.stringify({数量契約:p.quantityContract.status==='UNKNOWN'?'不明（旧版・推定なし）':p.quantityContract,独立検収:p.receipt},null,2);
   $('#binding').textContent=JSON.stringify({identity:detail.identity,definition:detail.definition,見積:p.quotes,選定:p.selection,発注:p.order},null,2);
   $('#approvals').textContent=JSON.stringify({承認経路:detail.workflow,申請:history.audit.requester,承認:history.audit.approvals},null,2);
   $('#history').textContent=JSON.stringify(history,null,2);
   $('#case-detail').hidden=false;$('#case-detail').dataset.id=p.id;$('#detail-title').focus();
  }
  $('#message').textContent=list.items.length?'最新の参照情報を表示しました。':'現在参照できる購買案件はありません。';
 }catch(error){if(mine!==generation)return;clear();$('#message').textContent=error.status===403?'参照権限を確認できません。再ログインしてください。':error.status===404?'案件が見つからないか、現在は参照できません。': '情報を取得できませんでした。最新の情報を取得してください。';}
}
$('#reload').addEventListener('click',load);
// Revalidate on return to the page. A previous response cannot repaint a newer
// denial; all confidential DOM is cleared before every asynchronous refresh.
window.addEventListener('focus',load);
window.addEventListener('pagehide',()=>{generation++;clear();});
load();
