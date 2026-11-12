const $=s=>document.querySelector(s);
let generation=0,retentionEpoch=0,busy=false,selected=null,retained=new Set(),invoiceIds=new Set(),lastCommand=null;
function hideResult(){$('#summary').replaceChildren();$('#result').hidden=true;}
function clear(){
 generation++;retentionEpoch++;selected=null;retained.clear();invoiceIds.clear();lastCommand=null;
 for(const id of ['identity','source','summary'])$('#'+id).replaceChildren();
 for(const el of document.querySelectorAll('select'))el.replaceChildren();$('#references').hidden=true;$('#result').hidden=true;
 for(const el of document.querySelectorAll('*'))for(const key of Object.keys(el.dataset))delete el.dataset[key];
 for(const el of document.querySelectorAll('input,textarea,select')){el.value='';if(el.tagName==='SELECT')el.selectedIndex=-1;}
 $('#message').textContent='現在の参照権限を確認できません。入力を消去しました。再ログインして確認してください。';
}
const denied=e=>e.status===403||e.status===404;
async function session(){const r=await fetch('/session'),s=await r.json();if(!r.ok||!s.actor)throw Object.assign(Error('PERMISSION_DENIED'),{status:403});return s;}
async function call(s,path,request){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrf},body:JSON.stringify(request)}),v=await r.json();if(!r.ok)throw Object.assign(Error(v.error.code),{status:r.status});return v.result;}
const read=(s,operation,body)=>call(s,'/api',{contractVersion:'2.0.0',operation,body});
async function revalidate(s){for(const id of [...retained])await read(s,'purchaseRead',{id});for(const id of [...invoiceIds])await read(s,'invoiceRead',{id});}
function failure(e,mine){if(denied(e)){clear();return;}if(mine!==generation)return;$('#message').textContent=e.message==='IDEMPOTENCY_MISMATCH'?'同じ再送キーで内容が変わっています。元の内容を確認してください。':e.message==='CONFLICT'?'ID・請求書番号・現在版を確認してください。下書きは保持しています。':'入力・現在の結果を確認してください。下書きは保持しています。結果不明時は自動再送せず、同じID・内容・キーを確認して明示的に再送してください。';}
function renderSource(po){const q=po.quantityContract;$('#source').textContent=['発注: '+po.id,'現在版: '+po.revision,'金額: '+po.fields.amount+' '+po.fields.currency,'取引先: '+po.fields.supplierId,'発注数量: '+(q.ordered? q.ordered.quantity+' '+q.ordered.unit:'未確定'),'検収数量: '+(q.received?q.received.quantity+' '+q.received.unit:'未検収'),'独立検収担当者: '+(po.receipt?.actor??'未検収'),'発注operation: '+po.order.operationId,'発注package: '+po.package.version,'発注payload: '+(po.order.payloadDigest??'未確定')].join('\n');$('#references').hidden=false;$('#references').dataset.id=po.id;}
function render(value){$('#summary').textContent='請求書: '+value.id+'\n版: '+value.revision+'\n照合: '+(value.state==='MATCHED'?'一致':value.state==='QUARANTINED'?'隔離・照合内容を確認':value.state)+'\n理由: '+(value.reasons?.join('、')||'なし');$('#result').hidden=false;$('#result').dataset.id=value.id;$('#result-title').focus();}
async function refresh(){
 const mine=++generation,chosen=selected;
 try{const s=await session();await revalidate(s);const list=await read(s,'query',{packageId:'enterprise-procurement',type:'PurchaseRequest'});
 // Revalidate every option, including retained options omitted by a revoked query.
 const ids=new Set([...retained,...list.items.map(x=>x.id)]);let current;
 for(const id of ids){const po=await read(s,'purchaseRead',{id});if(id===chosen)current=po;}
 if(mine!==generation)return;
 // A successful fresh authorization restores choices erased by clear(),
 // while ordinary refreshes preserve the user's selected currency.
 if(!$('#currency').options.length){for(const value of ['','JPY','USD','EUR']){const option=document.createElement('option');option.value=value;option.textContent=value||'選択してください';$('#currency').append(option);}$('#currency').value='';}
 retained=ids;$('#identity').textContent='ログイン中: '+s.actor;$('#purchase-id').replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='発注を選択してください';$('#purchase-id').append(placeholder);
 for(const row of list.items){const option=document.createElement('option');option.value=row.id;option.textContent=row.id+'（版 '+row.revision+'）';$('#purchase-id').append(option);}$('#purchase-id').value=chosen??'';
 if(current)renderSource(current);$('#message').textContent='現在の参照権限と発注を確認しました。';
 }catch(e){failure(e,mine);}
}
$('#purchase-id').addEventListener('change',async()=>{
 const target=$('#purchase-id').value,mine=++generation;selected=null;$('#source').replaceChildren();$('#references').hidden=true;for(const key of Object.keys($('#references').dataset))delete $('#references').dataset[key];hideResult();if(!target||!retained.has(target))return;
 try{const s=await session();await revalidate(s);const po=await read(s,'purchaseRead',{id:target});if(mine!==generation)return;selected=target;renderSource(po);}catch(e){failure(e,mine);}
});
$('#import-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;const mine=++generation,epoch=retentionEpoch,target=selected;
 if(!target||$('#purchase-id').value!==target||!retained.has(target)){$('#message').textContent='一覧から発注を選択し、現在の発注を確認してください。';return;}
 const body={id:$('#invoice-id').value,purchaseId:target,number:$('#number').value,supplierId:$('#supplier-id').value,amount:Number($('#amount').value),currency:$('#currency').value,quantity:Number($('#quantity').value),unit:$('#unit').value};
 const request={contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',operation:'import',body,key:$('#request-key').value};
 if(lastCommand?.key===request.key&&JSON.stringify(lastCommand)!==JSON.stringify(request)){failure(Error('IDEMPOTENCY_MISMATCH'),mine);return;}
 busy=true;$('#import').disabled=true;hideResult();$('#message').textContent='請求書の取込を確認しています…';
 try{const s=await session();await revalidate(s);if(mine!==generation)return;lastCommand=structuredClone(request);
 let result;try{result=await call(s,'/enterprise/v2/rpc',request);}catch(e){
 if(denied(e)){if(epoch!==retentionEpoch)return;try{const current=await session();await revalidate(current);}catch(readError){
 // Input edits invalidate rendering, but an explicit denial still invalidates
 // retained data. A clear starts a new retention epoch immune to old responses.
 if(epoch===retentionEpoch&&(denied(readError)||mine===generation))clear();return;
 }if(mine===generation)$('#message').textContent='取込権限・対象の状態を確認してください。下書きは保持しています。';return;}throw e;
 }
 if(mine!==generation)return;invoiceIds.add(result.id);
 const current=await session();await revalidate(current);const value=await read(current,'invoiceRead',{id:result.id});if(mine!==generation)return;render(value);$('#message').textContent='請求書を取り込みました。';
 }catch(e){failure(e,mine);}finally{busy=false;$('#import').disabled=false;}
});
$('#lookup').addEventListener('click',async()=>{const id=$('#invoice-id').value,mine=++generation;hideResult();try{const s=await session();await revalidate(s);const value=await read(s,'invoiceRead',{id});if(mine!==generation)return;invoiceIds.add(id);render(value);}catch(e){failure(e,mine);}});
$('#import-form').addEventListener('input',event=>{if(event.target.id==='purchase-id')return;generation++;hideResult();refresh();});
$('#refresh').addEventListener('click',refresh);window.addEventListener('focus',refresh);window.addEventListener('pagehide',clear);refresh();
