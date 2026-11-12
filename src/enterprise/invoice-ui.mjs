const $=s=>document.querySelector(s);let session,invoice=null,payment=null;
// Read references own API-derived form/list values, independently of the
// selected payment used by business actions. User drafts never create reads.
let retainedPayment=null,retainedAccount=null,listedPayments=[];
function clear(){invoice=null;payment=null;retainedPayment=null;retainedAccount=null;listedPayments=[];for(const n of document.querySelectorAll('input,textarea,select')){n.value='';if(n.tagName==='SELECT')n.selectedIndex=-1;}for(const s of ['#cases','#summary','#approvals','#history'])$(s).replaceChildren();$('#detail').hidden=true;for(const k of Object.keys($('#detail').dataset))delete $('#detail').dataset[k];}
async function api(operation,body={},key=crypto.randomUUID()){
 const response=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrf},body:JSON.stringify({contractVersion:'2.0.0',operation,body,key})});const value=await response.json();if(!response.ok)throw Object.assign(Error(value.error.code),{status:response.status});return value.result;
}
function render(value){$('#detail').hidden=false;$('#detail').dataset.id=value.id;$('#detail').dataset.state=value.state;$('#summary').textContent=JSON.stringify(value,null,2);$('#approvals').replaceChildren(...(value.workflow?.votes??[]).map(v=>{const n=document.createElement('li');n.textContent=`${v.stage}: ${v.actor} ${v.decision}`;return n;}));$('#history').replaceChildren(...value.history.map(v=>{const n=document.createElement('li');n.textContent=`版 ${v.revision} / ${v.action_id}`;return n;}));}
async function openInvoice(id){invoice=await api('invoiceRead',{id});payment=null;$('#invoice-target').value=id;for(const [key,name] of [['id','invoice-id'],['purchaseId','purchase-id'],['number','number'],['supplierId','supplier-id'],['amount','amount'],['currency','currency'],['quantity','quantity'],['unit','unit']])$('#'+name).value=invoice.fields[key];render(invoice);}
async function openPayment(id){payment=await api('paymentRead',{id});retainedPayment=payment.id;$('#payment-target').value=id;render(payment);}
async function list(){const r=await api('query',{packageId:'enterprise-invoice',type:'InvoicePayment'});listedPayments=r.items.map(x=>x.id);$('#cases').replaceChildren(...r.items.map(x=>{const n=document.createElement('li'),b=document.createElement('button');b.textContent=x.id;b.onclick=()=>run(()=>openPayment(x.id));n.append(b);return n;}));}
async function checkRetained(){if(invoice)await api('invoiceRead',{id:invoice.id});for(const id of new Set([retainedPayment,...listedPayments].filter(Boolean)))await api('paymentRead',{id});if(retainedAccount)await api('paymentAccountRead',{id:retainedAccount});}
async function run(fn){$('#message').textContent='';try{await fn();}catch(e){
 if([403,404].includes(e.status)){
  try{if(invoice||retainedPayment||retainedAccount||listedPayments.length)await checkRetained();else clear();}catch{clear();}
 }
 $('#message').textContent=e.message;
}}
const invoiceBody=()=>({id:$('#invoice-id').value,purchaseId:$('#purchase-id').value,number:$('#number').value,supplierId:$('#supplier-id').value,amount:Number($('#amount').value),currency:$('#currency').value,quantity:Number($('#quantity').value),unit:$('#unit').value});
$('#import').onsubmit=e=>{e.preventDefault();run(async()=>{const b=invoiceBody();await api('invoiceImport',b);await openInvoice(b.id);});};
$('#correct').onclick=()=>run(async()=>{await api('invoiceCorrect',{...invoiceBody(),revision:invoice?.revision});await openInvoice(invoice.id);});
$('#account').onsubmit=e=>{e.preventDefault();run(async()=>{if(!invoice)throw Error('請求を開いてください');const b={id:$('#account-id').value,scope:invoice.scope,supplierId:invoice.fields.supplierId,currency:invoice.fields.currency,syntheticReference:$('#account-reference').value,revision:Number($('#account-revision').value)};const r=await api('paymentAccountSet',b);retainedAccount=r.id;$('#account-revision').value=r.revision;$('#message').textContent='口座版 '+r.revision;});};
$('#request').onsubmit=e=>{e.preventDefault();run(async()=>{if(!invoice)throw Error('請求を開いてください');const b={id:$('#payment-id').value,invoiceId:invoice.id,revision:invoice.revision,accountId:$('#account-id').value,amount:Number($('#payment-amount').value)};await api('paymentRequest',b);await openPayment(b.id);await list();});};
$('#open-invoice').onclick=()=>run(()=>openInvoice($('#invoice-target').value));$('#open-payment').onclick=()=>run(()=>openPayment($('#payment-target').value));
$('#reload').onclick=()=>run(async()=>{await checkRetained();await list();if(payment)await openPayment(payment.id);else if(invoice)await openInvoice(invoice.id);});
for(const [selector,decision] of [['#approve','APPROVE'],['#return','RETURN']])$(selector).onclick=()=>run(async()=>{
 if(decision==='RETURN')await checkRetained();
 const current=payment?await api('paymentRead',{id:payment.id}):null;
 await api('vote',{id:current?.id,revision:current?.revision,decision});await openPayment(current.id);
 if(decision==='RETURN')$('#message').textContent='差戻しました。申請者は送信前取消後、請求を再読込して訂正し、新しい支払IDで再申請してください。';
});
for(const [selector,op] of [['#dispatch','dispatch'],['#reconcile','reconcile'],['#cancel','paymentCancel']])$(selector).onclick=()=>run(async()=>{await api(op,{id:payment?.id});await openPayment(payment.id);});
try{session=await(await fetch('/session')).json();if(!session.actor)throw Error('ログインしてください');$('#identity').textContent='ログイン中: '+session.actor;await run(list);}catch(e){clear();$('#message').textContent=e.message;}
