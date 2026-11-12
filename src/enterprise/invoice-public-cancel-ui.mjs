const $=s=>document.querySelector(s);
let generation=0,busy=false,selected=null,retained=new Set(),lastCommand=null;
const envelope=(operation,body,key)=>({contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',operation,body,...(key===undefined?{}:{key})});
function clear(){
 generation++;selected=null;retained.clear();lastCommand=null;
 for(const id of ['identity','source','summary'])$('#'+id).replaceChildren();
 $('#case-select').replaceChildren();$('#references').hidden=true;$('#result').hidden=true;$('#detail').removeAttribute('href');
 for(const el of document.querySelectorAll('*'))for(const key of Object.keys(el.dataset))delete el.dataset[key];
 for(const el of document.querySelectorAll('input,textarea,select')){el.value='';if(el.tagName==='SELECT')el.selectedIndex=-1;}
 $('#message').textContent='現在の参照権限を確認できません。入力を消去しました。再ログインして確認してください。';
}
const denied=e=>e.status===403||e.status===404;
async function session(){const r=await fetch('/session'),s=await r.json();if(!r.ok||!s.actor)throw Object.assign(Error('PERMISSION_DENIED'),{status:403});return s;}
async function call(s,request){const r=await fetch('/enterprise/v2/rpc',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrf},body:JSON.stringify(request)}),v=await r.json();if(!r.ok)throw Object.assign(Error(v.error.code),{status:r.status});return v.result;}
const read=(s,op,body)=>call(s,envelope(op,body));
async function revalidate(s,ids){for(const id of ids)await read(s,'get',{id});}
function failure(e,mine){if(denied(e)){clear();return;}if(mine!==generation)return;$('#message').textContent=e.message==='IDEMPOTENCY_MISMATCH'?'同じ再送キーで内容が変わっています。元の内容を確認するか、新しいキーを入力してください。':e.message==='CONFLICT'?'現在版を確認してください。下書きは保持しています。':'処理を確認できません。下書きは保持しています。結果を確認し、同じ内容・キーで明示的に再送できます。';}
const stateLabel=value=>({WAITING_APPROVAL:'承認待ち',READY:'承認完了',RETURNED:'差戻し',CANCELLED:'取消済み',EXPIRED:'期限切れ',UNKNOWN:'結果不明・手動照合が必要',SUCCEEDED:'支払結果確認済み'}[value]??value);
function render(value){const p=value.payment,po=value.purchase,q=po.quantityContract;$('#source').textContent=[
 '支払案件: '+value.id,'状態: '+stateLabel(value.workflow.state),'対象の版: '+value.revision,'金額: '+p.fields.amount+' '+p.fields.currency,
 '請求: '+value.invoice.id+'（'+value.invoice.fields.number+'）','請求の版: '+value.invoice.revision,
 '口座: '+value.account.id+'（版 '+value.account.revision+'）','発注: '+po.id,
 '発注数量: '+q.ordered.quantity+' '+q.ordered.unit,'検収数量: '+q.received.quantity+' '+q.received.unit,
 '独立検収担当者: '+po.receipt.actor,'支払申請者: '+p.author.actor,'承認期限: '+value.workflow.due,
 '承認段階: '+(value.workflow.state==='WAITING_APPROVAL'?value.workflow.stage+1:stateLabel(value.workflow.state)),
 '投票: '+(value.workflow.votes.map(v=>v.actor+'（'+(v.decision==='RETURN'?'差戻し':'承認')+'・段階 '+(v.stage+1)+'）').join('、')||'未投票')
 ].join('\n');$('#references').hidden=false;$('#references').dataset.id=value.id;$('#detail').href='/enterprise/cases/ENT-202/'+encodeURIComponent(value.id);}
async function refresh(){
 const mine=++generation,ids=[...retained],chosen=selected;
 try{const s=await session();await revalidate(s,ids);const list=await read(s,'query',{});const value=chosen?await read(s,'inspect',{id:chosen}):null;
 if(mine!==generation)return;
 $('#identity').textContent='ログイン中: '+s.actor;$('#case-select').replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='案件を選択してください';$('#case-select').append(placeholder);
 for(const row of list.items){retained.add(row.id);const option=document.createElement('option');option.value=row.id;option.textContent=row.id+'（版 '+row.revision+'）';$('#case-select').append(option);}$('#case-select').value=chosen??'';
 if(value)render(value);$('#message').textContent='現在の参照権限と案件を確認しました。';
 }catch(e){failure(e,mine);}
}
async function inspect(){
 const target=$('#case-select').value;if(!target||!retained.has(target))return;const mine=++generation;
 try{const s=await session();await revalidate(s,[...retained]);const value=await read(s,'inspect',{id:target});if(mine!==generation)return;
 selected=value.id;render(value);$('#result').hidden=true;$('#summary').replaceChildren();$('#message').textContent='選択した案件の現在版を確認しました。';
 }catch(e){failure(e,mine);}
}
$('#cancel-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;const mine=++generation,ids=[...retained],target=selected;
 if(!target||$('#case-select').value!==target||!retained.has(target)){$('#message').textContent='一覧から案件を選び、現在版を確認してください。';return;}
 const body={id:target};if($('#purpose').value)body.purpose=$('#purpose').value;
 const request=envelope('cancel',body,$('#request-key').value);
 if(lastCommand?.key===request.key&&JSON.stringify(lastCommand)!==JSON.stringify(request)){failure(Error('IDEMPOTENCY_MISMATCH'),mine);return;}
 busy=true;$('#cancel').disabled=true;$('#message').textContent='未送信取消を確認しています…';
 try{const s=await session();await revalidate(s,ids);if(mine!==generation)return;lastCommand=structuredClone(request);
 let result;try{result=await call(s,request);}catch(e){
 // A write denial may still leave the case readable. Recheck only the
 // authorized retained references; any real read denial still clears stale DOM.
 if(denied(e)){try{const current=await session();await revalidate(current,ids);}catch(readError){failure(readError,mine);return;}if(mine===generation)$('#message').textContent='取消権限・申請者・現在の状態を確認してください。下書きは保持しています。';return;}throw e;
 }
 if(mine!==generation)return;
 // The inspected snapshot predates this cancellation. Hide it before rechecking current
 // authorized contents; read failure must never leave that snapshot as current.
 $('#source').replaceChildren();$('#references').hidden=true;$('#detail').removeAttribute('href');for(const key of Object.keys($('#references').dataset))delete $('#references').dataset[key];$('#summary').replaceChildren();$('#result').hidden=true;
 const current=await session();await revalidate(current,ids);const value=await read(current,'inspect',{id:target});
 if(mine!==generation)return;render(value);$('#summary').textContent='支払案件: '+value.id+'\n状態: '+stateLabel(value.workflow.state)+'\n対象の版: '+value.revision+'\n予約: '+(value.payment.reservation==='RELEASED'?'解放済み':'保持中');$('#result').hidden=false;$('#result-title').focus();$('#message').textContent='未送信取消を受け付けました。';
 }catch(e){failure(e,mine);}finally{busy=false;$('#cancel').disabled=false;}
});
$('#refresh').addEventListener('click',refresh);$('#inspect').addEventListener('click',inspect);
$('#case-select').addEventListener('change',()=>{generation++;selected=null;$('#source').replaceChildren();$('#references').hidden=true;$('#detail').removeAttribute('href');for(const key of Object.keys($('#references').dataset))delete $('#references').dataset[key];$('#summary').replaceChildren();$('#result').hidden=true;});
$('#cancel-form').addEventListener('input',()=>{generation++;$('#summary').replaceChildren();$('#result').hidden=true;refresh();});
window.addEventListener('focus',refresh);window.addEventListener('pagehide',clear);refresh();
