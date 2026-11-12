const $=s=>document.querySelector(s);
let generation=0,busy=false;
function clear(){
 for(const s of ['#identity','#source','#summary'])$(s).replaceChildren();
 $('#references').hidden=true;$('#result').hidden=true;$('#detail').removeAttribute('href');
 for(const el of document.querySelectorAll('*'))for(const k of Object.keys(el.dataset))delete el.dataset[k];
 for(const el of document.querySelectorAll('input,textarea,select')){el.value='';if(el.tagName==='SELECT')el.selectedIndex=-1;}
}
function hideResult(){$('#source').replaceChildren();$('#references').hidden=true;$('#summary').replaceChildren();$('#result').hidden=true;$('#detail').removeAttribute('href');}
async function session(){const r=await fetch('/session');const s=await r.json();if(!r.ok||!s.actor)throw Object.assign(Error('PERMISSION_DENIED'),{status:403});return s;}
async function call(s,path,request){
 const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrf},body:JSON.stringify(request)});
 const v=await r.json();if(!r.ok)throw Object.assign(Error(v.error.code),{status:r.status});return v.result;
}
const legacy=(s,operation,body)=>call(s,'/api',{contractVersion:'2.0.0',operation,body});
const read=(s,operation,body)=>call(s,'/enterprise/v2/rpc',{contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',operation,body});
function draft(){return {id:$('#payment-id').value,invoiceId:$('#invoice-id').value,revision:Number($('#revision').value),accountId:$('#account-id').value,amount:Number($('#amount').value)};}
async function references(s,b){
  const invoice=await legacy(s,'invoiceRead',{id:b.invoiceId}),account=await legacy(s,'paymentAccountRead',{id:b.accountId});
 return {invoice,account};
}
function failure(error,mine){
 // Authorization denial clears this page even if draft edits invalidated the response.
 if(error.status===403||error.status===404){generation++;clear();$('#message').textContent='現在の権限で参照できません。入力を消去しました。再ログインして確認してください。';}
 else if(mine!==generation)return;
 else $('#message').textContent=error.message==='CONFLICT'?'現在版・金額・予約を確認してください。下書きは保持しています。拒否された内容の修正には新しい再送キーが必要です。':error.message==='IDEMPOTENCY_MISMATCH'?'同じ再送キーで内容が変わっています。元の申請結果を確認してください。拒否済み申請の修正には新しい再送キーを入力してください。':'処理を確認できません。下書きは保持しています。結果を確認し、必要なら同じID・キーで再送してください。';
}
async function refresh(show=false){
 const mine=++generation;hideResult();
 try{const s=await session(),b=draft(),sources={};if(b.invoiceId)sources.invoice=await legacy(s,'invoiceRead',{id:b.invoiceId});if(b.accountId)sources.account=await legacy(s,'paymentAccountRead',{id:b.accountId});if(mine!==generation)return;$('#identity').textContent='ログイン中: '+s.actor;if(show&&Object.keys(sources).length){$('#source').textContent=JSON.stringify(sources,null,2);$('#references').hidden=false;}$('#message').textContent='現在の参照権限を確認しました。';}
 catch(e){failure(e,mine);}
}
function render(result){$('#summary').textContent=JSON.stringify(result,null,2);$('#result').hidden=false;$('#detail').href='/enterprise/cases/ENT-202/'+encodeURIComponent(result.id);$('#result-title').focus();}
$('#submit-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;busy=true;$('#submit').disabled=true;const mine=++generation,b=draft(),key=$('#request-key').value;hideResult();$('#message').textContent='申請を確認しています…';
 try{
  const s=await session();await references(s,b);if(mine!==generation)return;
  const result=await call(s,'/enterprise/v2/rpc',{contractVersion:'2.0.0',packageId:'ENT-202',type:'ENT202Case',operation:'submit',body:b,key});if(mine!==generation)return;
  render(result);$('#message').textContent='支払申請を受け付けました。承認・送金は実行していません。';
 }catch(e){failure(e,mine);}finally{busy=false;$('#submit').disabled=false;}
});
$('#lookup').addEventListener('click',async()=>{const mine=++generation;hideResult();try{const s=await session(),result=await read(s,'get',{id:$('#payment-id').value});if(mine!==generation)return;render(result);$('#message').textContent='現在の支払結果を取得しました。';}catch(e){failure(e,mine);}});
$('#check').addEventListener('click',()=>refresh(true));$('#refresh').addEventListener('click',()=>refresh(true));
$('#submit-form').addEventListener('input',()=>{generation++;hideResult();});
window.addEventListener('focus',()=>refresh());window.addEventListener('pagehide',()=>{generation++;clear();});
refresh();
