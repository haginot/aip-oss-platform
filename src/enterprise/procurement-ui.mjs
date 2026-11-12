const $=id=>document.getElementById(id);let session,selected,createVersion;
const labels={REQUESTED:'見積待ち',COMPARED:'比較済・承認待ち',ORDER_READY:'承認済・発注可能',ORDER_CONFIRMED:'発注確認済',RECEIVED:'受領済',UNKNOWN:'結果不明・外部結果の照合が必要',RETURNED:'差戻し',CANCELLED:'取消済',EXPIRED:'期限切れ'};
async function api(operation,body={},key=crypto.randomUUID()){
 const r=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrf},body:JSON.stringify({contractVersion:'2.0.0',operation,body,key})});
 const data=await r.json();if(!r.ok){
  if(['purchaseRead','query'].includes(operation))clearProtected();
  else if([403,404].includes(r.status)){
   // An operation can be forbidden while reading is still allowed (e.g. self
   // approval). Check current read access before retaining protected UI values.
   try{await api('purchaseRead',{id:body.id??selected?.id});}catch{clearProtected();}
  }
  throw Error(data.error?.code??'UNAVAILABLE');
 }return data.result;
}
async function guard(fn){try{$('message').textContent='';await fn();}catch(error){$('message').textContent='操作を完了できません: '+error.message;}}
function clearForm(root){for(const input of root.querySelectorAll('input,textarea,select')){input.value='';if(input.tagName==='SELECT')input.selectedIndex=-1;}}
function clearDetail(){selected=undefined;$('detail').hidden=true;for(const key of ['id','state','revision'])delete $('detail').dataset[key];for(const key of ['summary','state','approvals','quotes','history','audit-result'])$(key).replaceChildren();$('target').value='';clearForm($('detail'));}
function clearProtected(){clearDetail();$('cases').replaceChildren();clearForm($('create'));}
async function load(){const {items}=await api('query',{packageId:'enterprise-procurement',type:'PurchaseRequest'});$('cases').replaceChildren();for(const item of items){const button=document.createElement('button');button.textContent=item.fields.title+' / '+item.id;button.onclick=()=>guard(()=>show(item.id));$('cases').append(button);}if(selected){if(items.some(x=>x.id===selected.id))await show(selected.id);else clearProtected();}}
function quantityForm(id,enabled){$(id).hidden=!enabled;$(id).disabled=!enabled;}
async function show(id){
 const record=await api('purchaseRead',{id});selected=record;$('detail').hidden=false;$('detail').dataset.id=id;$('detail').dataset.state=record.state;$('detail').dataset.revision=record.revision;$('target').value=id;
 $('state').textContent=labels[record.state]??record.state;
 $('summary').replaceChildren();const table=document.createElement('table');$('summary').append(table);
 const receipt=record.receipt;
 const known=record.quantityContract.status==='KNOWN';for(const id of ['quote-quantity','receive-quantity'])quantityForm(id,known);
 for(const [label,value] of [['購買目的',record.fields.title],['数量契約版',record.package.version],['発注数量・単位',record.quantityContract.ordered?record.quantityContract.ordered.quantity+' '+record.quantityContract.ordered.unit:known?'未発注（申請 '+record.fields.quantity+' '+record.fields.unit+'）':'数量未記録'],['検収数量・単位',receipt&&known?receipt.receivedQuantity+' '+receipt.unit:known?'未検収':'数量未記録'],['数量照合可能',record.quantityContract.matchEligible?'はい':'いいえ'],['選定見積版',known?record.fields.quoteVersion:'未記録'],['予算',record.fields.budgetId],['選定金額',record.fields.amount+' '+record.fields.currency],['選定仕入先',record.fields.supplierId||'未選定'],['選定見積',record.fields.quoteId||'未選定'],['比較・選定理由',record.selection?.reason??'未選定'],['承認期限',new Date(record.workflow.due).toLocaleString('ja-JP')],['注文番号',record.order.operationId],['受領担当者',receipt?.actor??'未受領'],['受領確認',receipt?.note??'未受領']]){
  const tr=document.createElement('tr'),th=document.createElement('th'),td=document.createElement('td');th.textContent=label;td.textContent=value;tr.append(th,td);table.append(tr);
 }
 $('approvals').replaceChildren();for(const vote of record.workflow.votes){const li=document.createElement('li');li.dataset.actor=vote.actor;li.textContent=`段階${vote.stage+1}: ${vote.actor} / ${vote.decision==='APPROVE'?'承認':'差戻し'}`;$('approvals').append(li);}
 $('quotes').replaceChildren();for(const q of record.quotes){const tr=document.createElement('tr');for(const v of [q.quoteId,q.supplierId,q.amount,q.currency,q.quantity??'未記録',q.unit??'未記録',q.quoteVersion??'未記録']){const td=document.createElement('td');td.textContent=v;tr.append(td);}$('quotes').append(tr);}
 $('history').replaceChildren();for(const e of record.history){const li=document.createElement('li');li.textContent=`版 ${e.revision} / Action ${e.action_id} / ${e.recorded_at}`;$('history').append(li);}
}
$('create').onsubmit=e=>{e.preventDefault();guard(async()=>{const r=await api('purchaseCreate',{id:$('new-id').value,scope:session.scopes[0],title:$('title').value,currency:$('currency').value,budgetId:$('budget').value,...(createVersion==='1.1.0'?{packageVersion:createVersion,quantity:Number($('quantity').value),unit:$('unit').value}:{})});await load();await show(r.id);});};
$('quote').onsubmit=e=>{e.preventDefault();guard(async()=>{await api('purchaseQuote',{id:selected.id,revision:selected.revision,quoteId:$('quote-id').value,supplierId:$('supplier').value,amount:Number($('amount').value),currency:selected.fields.currency,...(selected.quantityContract.status==='KNOWN'?{quantity:Number($('quote-quantity-value').value),unit:$('quote-unit').value,quoteVersion:Number($('quote-version').value)}:{})});await show(selected.id);});};
$('selection').onsubmit=e=>{e.preventDefault();guard(async()=>{await api('purchaseSelect',{id:selected.id,revision:selected.revision,quoteId:$('chosen').value,reason:$('reason').value});await show(selected.id);});};
for(const [button,decision] of [['approve','APPROVE'],['return','RETURN']])$(button).onclick=()=>guard(async()=>{await api('vote',{id:selected.id,revision:selected.revision,decision});await show(selected.id);});
for(const op of ['cancel','dispatch','reconcile'])$(op).onclick=()=>guard(async()=>{await api(op,{id:selected.id});await show(selected.id);});
$('receive').onsubmit=e=>{e.preventDefault();guard(async()=>{await api('purchaseReceive',{id:selected.id,revision:selected.revision,orderOperationId:selected.order.operationId,note:$('receipt-note').value,...(selected.quantityContract.status==='KNOWN'?{receivedQuantity:Number($('received-quantity').value),unit:$('received-unit').value}:{})});await show(selected.id);});};
$('reload').onclick=()=>guard(load);$('open').onclick=()=>guard(()=>show($('target').value));
$('audit').onclick=()=>guard(async()=>{$('audit-result').textContent=JSON.stringify(await api('auditExport',{id:selected.id}),null,2);});
await guard(async()=>{const response=await fetch('/session');if(!response.ok)return;session=await response.json();$('identity').textContent='ログイン中: '+session.actor;$('workspace').hidden=false;$('new-id').value=crypto.randomUUID();const pkg=await api('package',{id:'enterprise-procurement'});createVersion=pkg.manifest.version;quantityForm('create-quantity',createVersion==='1.1.0');await load();});
