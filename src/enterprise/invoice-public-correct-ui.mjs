const $=selector=>document.querySelector(selector);
let generation=0,retentionEpoch=0,busy=false,binding=null,lastCommand=null;
const retainedInvoices=new Set(),retainedPurchases=new Set();
const fields={id:'invoice-id',purchaseId:'purchase-id',revision:'revision',number:'number',supplierId:'supplier-id',amount:'amount',currency:'currency',quantity:'quantity',unit:'unit'};
const denied=error=>error.status===403||error.status===404;
function hideResult(){ $('#summary').replaceChildren();$('#result').hidden=true;for(const key of Object.keys($('#result').dataset))delete $('#result').dataset[key]; }
function clear(){
 generation++;retentionEpoch++;binding=null;lastCommand=null;retainedInvoices.clear();retainedPurchases.clear();
 for(const id of ['identity','source','summary'])$('#'+id).replaceChildren();
 for(const element of document.querySelectorAll('select'))element.replaceChildren();
 for(const element of document.querySelectorAll('input,textarea,select')){element.value='';if(element.tagName==='SELECT')element.selectedIndex=-1;}
 for(const element of document.querySelectorAll('*'))for(const key of Object.keys(element.dataset))delete element.dataset[key];
 $('#references').hidden=true;$('#result').hidden=true;
 $('#message').textContent='現在の参照権限を確認できません。入力を消去しました。再ログインして読み込んでください。';
}
async function session(){const response=await fetch('/session'),value=await response.json();if(!response.ok||!value.actor)throw Object.assign(Error('PERMISSION_DENIED'),{status:403});return value;}
async function call(identity,path,request){const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':identity.csrf},body:JSON.stringify(request)}),value=await response.json();if(!response.ok)throw Object.assign(Error(value.error.code),{status:response.status});return value.result;}
const read=(identity,operation,id)=>call(identity,'/api',{contractVersion:'2.0.0',operation,body:{id}});
async function revalidate(identity){for(const id of [...retainedInvoices])await read(identity,'invoiceRead',id);for(const id of [...retainedPurchases])await read(identity,'purchaseRead',id);}
function failure(error,mine,epoch){
 if(epoch!==retentionEpoch)return;
 // Input edits invalidate rendering, but cannot cancel an explicit current-epoch denial.
 if(denied(error)){clear();return;}if(mine!==generation)return;
 $('#message').textContent=error.message==='IDEMPOTENCY_MISMATCH'?'同じ再送キーで内容が変わっています。元の内容を確認してください。':error.message==='CONFLICT'?'請求書番号・現在版を確認してください。下書きは保持しています。':'入力・現在の結果を確認してください。下書きは保持しています。結果不明時は自動再送せず、元の内容・キーを確認して明示的に再送してください。';
}
function currencyOptions(){if(!$('#currency').options.length)for(const value of ['','JPY','USD','EUR']){const option=document.createElement('option');option.value=value;option.textContent=value||'選択してください';$('#currency').append(option);}}
function renderSource(purchase){const q=purchase.quantityContract;$('#source').textContent=['発注: '+purchase.id,'現在版: '+purchase.revision,'金額: '+purchase.fields.amount+' '+purchase.fields.currency,'取引先: '+purchase.fields.supplierId,'発注数量: '+(q.ordered?q.ordered.quantity+' '+q.ordered.unit:'未確定'),'検収数量: '+(q.received?q.received.quantity+' '+q.received.unit:'未検収'),'独立検収担当者: '+(purchase.receipt?.actor??'未検収')].join('\n');$('#references').hidden=false;$('#references').dataset.id=purchase.id;}
function render(value){$('#summary').textContent='請求書: '+value.id+'\n版: '+value.revision+'\n照合: '+(value.state==='MATCHED'?'一致':value.state==='QUARANTINED'?'隔離・照合内容を確認':value.state)+'\n理由: '+(value.reasons?.join('、')||'なし');$('#result').hidden=false;$('#result').dataset.id=value.id;$('#result-title').focus();}
async function refresh(){const mine=++generation,epoch=retentionEpoch;try{const identity=await session();await revalidate(identity);if(mine!==generation||epoch!==retentionEpoch)return;$('#identity').textContent='ログイン中: '+identity.actor;$('#message').textContent='現在の参照権限を確認しました。';}catch(error){failure(error,mine,epoch);}}
$('#lookup').addEventListener('click',async()=>{
 const id=$('#invoice-id').value,mine=++generation,epoch=retentionEpoch;hideResult();binding=null;
 try{const identity=await session();await revalidate(identity);const invoice=await read(identity,'invoiceRead',id),purchase=await read(identity,'purchaseRead',invoice.fields.purchaseId);if(mine!==generation||epoch!==retentionEpoch)return;
 retainedInvoices.add(invoice.id);retainedPurchases.add(purchase.id);binding={id:invoice.id,purchaseId:purchase.id,revision:invoice.revision};currencyOptions();
 for(const [key,selector] of Object.entries(fields))$('#'+selector).value=String(key==='revision'?invoice.revision:invoice.fields[key]);
 $('#request-key').value='';$('#identity').textContent='ログイン中: '+identity.actor;renderSource(purchase);$('#message').textContent='請求書の現在版を読み込みました。訂正内容と再送キーを入力してください。';
 }catch(error){failure(error,mine,epoch);}
});
$('#correct-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;const mine=++generation,epoch=retentionEpoch;
 const body=Object.fromEntries(Object.entries(fields).map(([key,selector])=>[key,['revision','amount','quantity'].includes(key)?Number($('#'+selector).value):$('#'+selector).value]));
 const request={contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',operation:'correct',body,key:$('#request-key').value};
 if(!binding||body.id!==binding.id||body.purchaseId!==binding.purchaseId||body.revision!==binding.revision){$('#message').textContent='請求書の現在版を読み込んでから訂正してください。';return;}
 if(!$('#correct-form').checkValidity()||!['id','purchaseId','supplierId'].every(key=>/^[-a-zA-Z0-9_.:]{1,128}$/.test(body[key]))||!/^[-a-zA-Z0-9_.:]{1,128}$/.test(request.key)||!['amount','quantity','revision'].every(key=>Number.isSafeInteger(body[key])&&body[key]>0)||!body.number.trim()||!body.unit.trim()){$('#message').textContent='必須項目と正の整数を確認してください。';return;}
 if(lastCommand?.key===request.key&&JSON.stringify(lastCommand)!==JSON.stringify(request)){failure(Error('IDEMPOTENCY_MISMATCH'),mine,epoch);return;}
 busy=true;$('#correct').disabled=true;hideResult();$('#message').textContent='請求書の訂正を確認しています…';
 try{const identity=await session();await revalidate(identity);if(mine!==generation||epoch!==retentionEpoch)return;lastCommand=structuredClone(request);
 let result;try{result=await call(identity,'/enterprise/v2/rpc',request);}catch(error){
 if(denied(error)){
  if(epoch!==retentionEpoch)return;
  try{const current=await session();await revalidate(current);}catch{if(epoch===retentionEpoch)clear();return;}
  if(mine===generation&&epoch===retentionEpoch)$('#message').textContent='訂正権限・対象の状態を確認してください。下書きは保持しています。';return;
 }throw error;}
 if(mine!==generation||epoch!==retentionEpoch)return;
 const current=await session();await revalidate(current);const invoice=await read(current,'invoiceRead',result.id);if(mine!==generation||epoch!==retentionEpoch)return;
 render(invoice);$('#message').textContent='請求書を訂正しました。次の訂正は現在版を読み直してください。';
 }catch(error){failure(error,mine,epoch);}finally{busy=false;$('#correct').disabled=false;}
});
$('#correct-form').addEventListener('input',event=>{generation++;hideResult();if(event.target.id==='invoice-id'){binding=null;$('#source').replaceChildren();$('#references').hidden=true;for(const key of Object.keys($('#references').dataset))delete $('#references').dataset[key];}refresh();});
$('#refresh').addEventListener('click',refresh);window.addEventListener('focus',refresh);window.addEventListener('pagehide',clear);refresh();
