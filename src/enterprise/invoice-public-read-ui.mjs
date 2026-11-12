const $=s=>document.querySelector(s),path='/enterprise/cases/ENT-202';
let generation=0;
function clear(){
 for(const selector of ['#identity','#case-list','#state','#summary','#quantity','#binding','#approvals','#history'])$(selector).replaceChildren();
 $('#case-detail').hidden=true;
 for(const el of document.querySelectorAll('*'))for(const k of Object.keys(el.dataset))delete el.dataset[k];
 for(const el of document.querySelectorAll('input,textarea,select')){el.value='';if(el.tagName==='SELECT')el.selectedIndex=-1;}
}
async function api(session,operation,body){
 const response=await fetch('/enterprise/v2/rpc',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrf},body:JSON.stringify({contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',operation,body})});
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
  $('#case-list').replaceChildren(...list.items.map(item=>{const li=document.createElement('li'),a=document.createElement('a');a.href=path+'/'+encodeURIComponent(item.id);a.textContent='支払案件 '+item.id;li.append(a);return li;}));
  if(detail){
   const {payment:p,invoice:i,purchase:po,account:a}=detail;
   for(const [label,value] of [['支払ID',p.id],['支払版',p.revision],['請求ID',i.id],['請求番号',i.fields.number],['請求版',i.revision],['発注ID',po.id],['発注版',po.revision],['口座ID',a.id],['口座現在版',a.revision],['承認に結合した口座版',p.fields.accountRevision],['金額',p.fields.amount+' '+p.fields.currency]])row(label,value);
   $('#state').textContent='支払状態: '+p.state+' / 請求照合: '+i.state+' / 予約: '+p.reservation;
   $('#quantity').textContent=JSON.stringify({請求数量:i.fields.quantity,単位:i.fields.unit,数量契約:po.quantityContract,独立検収:po.receipt},null,2);
   $('#binding').textContent=JSON.stringify({identity:detail.identity,package:detail.definition,payment:{operation:p.operation,fields:p.fields},purchase:{package:po.package,order:po.order,receipt:po.receipt}},null,2);
   $('#approvals').textContent=JSON.stringify({申請:history.audit.requester,承認:history.audit.approvals,段階:detail.workflow},null,2);
   $('#history').textContent=JSON.stringify(history,null,2);
   $('#case-detail').hidden=false;$('#case-detail').dataset.id=p.id;$('#detail-title').focus();
  }
  $('#message').textContent=list.items.length?'最新の参照情報を表示しました。':'現在参照できる支払案件はありません。';
 }catch(error){if(mine!==generation)return;clear();$('#message').textContent=error.status===403?'参照権限を確認できません。再ログインしてください。':error.status===404?'案件が見つからないか、現在は参照できません。': '情報を取得できませんでした。最新の情報を取得してください。';}
}
$('#reload').addEventListener('click',load);
// Revalidate on return to the page. A previous response cannot repaint a newer
// denial; all confidential DOM is cleared before every asynchronous refresh.
window.addEventListener('focus',load);
window.addEventListener('pagehide',()=>{generation++;clear();});
load();
