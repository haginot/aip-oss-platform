import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

// Deterministic, editable vector artwork. No borrowed illustrations or raster generation.
// The source shapes use an engineering-diagram vocabulary: planes, wireframes and routes.
export const palette = {
  ink:'#434343', note:'#A8A8A8', number:'#B7B7B7', blue:'#3775E6', sky:'#2697FC',
  orange:'#FD9941', white:'#FFFFFF', ice:'#EEF3FD', mist:'#EDF7FF', warm:'#FFF7EF',
  gray:'#ECECEC', line:'#CCCCCC',
};
const C=palette;
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const t=(x,y,s,size=24,weight=400,color=C.ink,anchor='start')=>`<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${esc(s)}</text>`;
const line=(x1,y1,x2,y2,color=C.line,width=1.4,dash='')=>`<path d="M${x1} ${y1}L${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${width}"${dash?` stroke-dasharray="${dash}"`:''}/>`;
const route=(d,color=C.sky,width=1.7,dash='',arrow=false)=>`<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"${dash?` stroke-dasharray="${dash}"`:''}${arrow?' marker-end="url(#arrow)"':''}/>`;
const rect=(x,y,w,h,fill=C.white,stroke=C.line)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>`;
const circle=(x,y,r,fill=C.white,stroke=C.ink)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>`;
const poly=(points,fill=C.white,stroke=C.ink)=>`<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="1.3" stroke-linejoin="round"/>`;
const tag=(x,y,w,s,accent=false)=>rect(x,y,w,34,accent?C.warm:C.white,accent?C.orange:C.line)+t(x+w/2,y+23,s,17,500,C.ink,'middle');

function plane(x,y,w,depth=90,inset=30,fill=C.white,grid=false){
  let s=poly(`${x},${y} ${x+w},${y} ${x+w},${y+13} ${x},${y+13}`,C.gray,C.line);
  s+=poly(`${x},${y} ${x+inset},${y-depth} ${x+w-inset},${y-depth} ${x+w},${y}`,fill,C.line);
  // Perspective grid, clipped mathematically to the quadrilateral.
  if(grid){
    for(let i=1;i<16;i++)s+=line(x+w*i/16,y,x+inset+(w-2*inset)*i/16,y-depth,C.gray,1);
    for(let i=1;i<9;i++){const q=i/9;s+=line(x+inset*q,y-depth*q,x+w-inset*q,y-depth*q,C.gray,1);}
  }
  for(let i=8;i<w;i+=12)s+=line(x+i,y+2,x+i-4,y+11,C.line,.7);
  return s;
}
function cube(x,y,w=62,h=50,color=C.ice){
  const a=w/2,b=w/4;
  return poly(`${x-a},${y-h} ${x},${y-h+b} ${x},${y+b} ${x-a},${y}`,C.white,C.ink)
    +poly(`${x},${y-h+b} ${x+a},${y-h} ${x+a},${y} ${x},${y+b}`,C.gray,C.ink)
    +poly(`${x},${y-h-b} ${x+a},${y-h} ${x},${y-h+b} ${x-a},${y-h}`,color,C.ink);
}
function icon(kind,x,y,scale=1,accent=false){
  const a=accent?C.orange:C.blue;
  let s='';
  if(kind==='store'){
    s=cube(0,-6,98,62,C.white)+poly('-49,-68 0,-43 0,-26 -49,-51',C.ice,C.ink);
    for(let i=0;i<5;i++)s+=line(-44+i*10,-65+i*5,-44+i*10,-49+i*5,a,5);
    s+=poly('-36,-37 -21,-29 -21,7 -36,-1',C.white,C.ink)+poly('9,-34 35,-47 35,-25 9,-12',C.mist,C.ink);
    s+=line(-45,-8,-6,12,C.line);
  }else if(kind==='boxes'){
    s=cube(-24,4,44,35,C.white)+cube(22,1,44,35,C.ice)+cube(0,-37,44,35,accent?C.warm:C.white);
    s+=line(-10,-62,10,-52,a,2);
  }else if(kind==='database'){
    s=`<path d="M-42 -70V0C-42 24 42 24 42 0V-70" fill="${C.white}" stroke="${C.ink}" stroke-width="1.3"/><ellipse cx="0" cy="-70" rx="42" ry="15" fill="${C.ice}" stroke="${C.ink}" stroke-width="1.3"/>`;
    for(const yy of [-48,-25,0])s+=route(`M-42 ${yy}C-42 ${yy+24} 42 ${yy+24} 42 ${yy}`,C.ink,1.3);
    s+=circle(27,-18,3,a,a);
  }else if(kind==='agent'){
    s=poly('0,-93 70,-58 0,-23 -70,-58',C.white,C.ink)+poly('-70,-58 0,-23 70,-58 70,-50 0,-15 -70,-50',C.gray,C.line);
    for(let i=-2;i<=2;i++){s+=route(`M${i*13-20} ${-65+i*6}l-22 -11h-12`,C.ink,1);s+=circle(i*13-54,-76+i*6,2,C.white,C.ink);s+=route(`M${i*13+20} ${-65-i*6}l22 -11h12`,C.ink,1);}
    s+=poly('0,-80 27,-66 0,-52 -27,-66',C.ice,a)+route('M0 -80V-52M-27 -66H27M-13 -73L13 -59M13 -73L-13 -59',a,1.2);
  }else if(kind==='screen'){
    s=rect(-65,-96,130,86,C.white,C.ink)+line(-65,-77,65,-77,C.line)+circle(-56,-87,2,a,a)+circle(-48,-87,2,C.line,C.line)+line(0,-10,0,12,C.ink)+line(-28,13,28,13,C.ink);
    s+=rect(-52,-63,31,32,C.ice,C.line)+route('M-13 -32L1 -49L13 -40L29 -61L49 -53',a,2);
    s+=line(-13,-20,50,-20,C.line);
  }else if(kind==='workflow'){
    s=rect(-62,-100,124,92,C.white,C.ink)+line(-62,-80,62,-80,C.line);
    s+=route('M0 -65V-45H-33V-30M0 -45H33V-30',C.ink,1.5);
    s+=rect(-15,-70,30,14,C.ice,a)+rect(-49,-32,32,14)+rect(17,-32,32,14,C.warm,C.orange)+line(0,-8,0,12,C.ink)+line(-25,13,25,13,C.ink);
  }else if(kind==='document'){
    s=poly('-38,-100 18,-100 40,-78 40,12 -38,12',C.white,C.ink)+poly('18,-100 18,-78 40,-78',C.gray,C.ink);
    for(let i=0;i<4;i++)s+=line(-24,-62+i*16,24,-62+i*16,C.line,1.6);
    s+=rect(-24,-83,18,7,accent?C.orange:C.blue,accent?C.orange:C.blue);
  }else if(kind==='check'){
    s=icon('document',0,0,1,false)+circle(28,-5,26,C.white,a)+route('M13 -5L24 6L44 -18',a,3);
  }else if(kind==='shield'){
    s=route('M0 -106L49 -85V-42Q49 -12 0 15Q-49 -12 -49 -42V-85Z',C.ink,1.4)+route('M-24 -50L-5 -31L27 -68',a,3);
  }else if(kind==='hub'){
    for(const yy of [24,8,-8])s+=poly(`0,${yy-48} 70,${yy-12} 0,${yy+24} -70,${yy-12}`,C.white,C.line);
    s+=cube(0,-24,74,43,C.ice)+poly('0,-85 37,-67 0,-48 -37,-67',C.ice,C.blue);
    s+=route('M0 -85V-48M-37 -67H37M-19 -76L19 -57M19 -76L-19 -57',C.blue,1.3);
  }else if(kind==='events'){
    for(let i=0;i<3;i++)s+=rect(-52+i*14,-86+i*18,78,45,C.white,C.ink)+circle(-38+i*14,-64+i*18,4,i===2?C.orange:C.blue,i===2?C.orange:C.blue)+line(-25+i*14,-64+i*18,12+i*14,-64+i*18,C.line);
  }else if(kind==='link'){
    s=cube(-31,0,45,48,C.ice)+cube(35,-24,45,48,C.white)+route('M-8 -11H11V-37',a,2.5)+route('M-8 -34H-20V-58H11',C.line,1.5);
  }
  return `<g transform="translate(${x} ${y}) scale(${scale})">${s}</g>`;
}
function svg(lang,w,h,title,desc,body){
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="title desc" xml:lang="${lang}"><title id="title">${esc(title)}</title><desc id="desc">${esc(desc)}</desc><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M1 1L8 4L1 7" fill="none" stroke="${C.sky}" stroke-width="1.3"/></marker></defs><rect width="${w}" height="${h}" fill="${C.white}"/><g font-family="Arial,'Hiragino Sans','Noto Sans JP',sans-serif" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>\n`;
}
const pick=(lang,ja,en)=>lang==='ja'?ja:en;
function header(w,title,kicker,sub){return t(60,55,kicker,17,500,C.blue)+t(60,111,title,42,600)+t(60,151,sub,21)+line(60,182,w-60,182);}
function foot(w,h,left,right){return line(60,h-69,w-60,h-69)+t(60,h-30,left,17)+t(w-60,h-30,right,17,500,C.note,'end');}

function architecture(lang){
  const L=(ja,en)=>pick(lang,ja,en); const w=1800,h=2100;
  let s=header(w,'AIP–OSS Platform','TARGET ARCHITECTURE / 01',L('業務の意味と実行ルールを、自分たちで持つ。','Your business semantics. Your rules. Your choice of technology.'));
  const layer=(n,y,ja,en,sub)=>t(58,y,n,18,600,C.blue)+t(58,y+34,L(ja,en),23,500)+t(58,y+65,sub,14,400,C.note);
  s+=layer('01',237,'利用・開発','Experience','HUMANS + AI');
  const apps=[{x:300,name:L('業務・判断・承認','Operations & decisions'),sub:'Business UI / Operations',kind:'screen'},{x:735,name:L('定義・開発・公開','Define, build & release'),sub:'Authoring Studio / API / SDK',kind:'workflow'},{x:1170,name:L('エージェント・Tools','Agents & typed tools'),sub:'AI agents / MCP',kind:'agent'}];
  for(const a of apps){s+=plane(a.x,378,310,76,30);s+=icon(a.kind,a.x+155,351,.92);s+=t(a.x+155,248,a.name,23,500,C.ink,'middle')+t(a.x+155,418,a.sub,18,400,C.ink,'middle');s+=route(`M${a.x+155} 434V466`,C.sky);}
  s+=layer('02',476,'信頼・認可','Trust & access','EVERY ENTRY POINT');
  s+=rect(285,467,1210,81,C.ice,C.blue)+t(890,498,'Gateway · Identity · Tenant · Delegation',24,500,C.ink,'middle')+t(890,532,L('関係・属性による認可 / 拒否優先 / 失効','Relationship & attribute policies / Deny / Revocation'),21,400,C.ink,'middle');
  for(const x of [455,890,1325])s+=route(`M${x} 548C${x} 578 ${x} 578 ${x} 605`,C.sky);
  s+=layer('03',641,'業務の中核','Business core','ENTERPRISE OWNED');
  s+=plane(260,1110,1250,434,152,C.white,true);
  s+=t(886,613,L('企業が所有する、意味・ルール・証拠','ENTERPRISE-OWNED SEMANTICS, RULES & EVIDENCE'),26,500,C.ink,'middle');
  s+=tag(418,637,274,'Ontology & Objects')+tag(740,637,310,'Actions & Workflows')+tag(1098,637,248,'AI & Typed Tools');
  // Connections are behind all object illustrations and labels.
  s+=route('M520 800H704L880 900H1078L1255 800',C.sky,2)+route('M478 990H674L880 900H1100L1310 990',C.sky,2)+route('M880 730V830',C.sky,2);
  s+=route('M478 990L520 800M1255 800L1310 990',C.line,1.4);
  const nodes=[{x:520,y:789,kind:'boxes',label:L('商品・ロット','Product / Lot')},{x:880,y:753,kind:'document',label:L('回収通知','Recall notice')},{x:1255,y:789,kind:'database',label:L('在庫・履歴','Inventory / History')},{x:478,y:993,kind:'store',label:L('店舗・倉庫','Store / Warehouse')},{x:1310,y:993,kind:'check',label:L('承認・実行証拠','Approval / Evidence')}];
  for(const n of nodes){s+=`<ellipse cx="${n.x}" cy="${n.y+4}" rx="83" ry="34" fill="${C.white}" stroke="${C.line}" stroke-width="1.3"/>`+icon(n.kind,n.x,n.y,.7,n.kind==='check')+tag(n.x-105,n.y+(n.kind==='document'?29:44),210,n.label,n.kind==='check');}
  s+=icon('hub',880,932,1.28)+t(880,1003,'ONTOLOGY',31,600,C.ink,'middle')+t(880,1035,L('Object ID · 関係 · 型 · 更新版','Object ID · Links · Types · Revisions'),19,400,C.ink,'middle');
  s+=tag(646,827,142,L('関係をたどる','Traverse links'))+tag(992,827,145,L('Actionを通す','Via Actions'),true);
  s+=t(885,1089,L('業務UI・ルール・AIが、同じ業務定義と実行境界を使う','Business UI, rules and AI share one set of definitions and execution boundaries.'),21,400,C.ink,'middle');
  s+=layer('04',1200,'実行・データ','Execution','COMMIT / CONNECT');
  const execs=[['State & UoW','Object + Action + Outbox','database'],['Events & Automation','Event / Trigger / Worker','events'],['Writeback & Reconcile','Receipt / UNKNOWN','link'],['Ingest & Projections','CDC / Graph / Text / Vector','database']];
  for(let i=0;i<4;i++){const x=290+i*312;s+=route(`M${x+140} 1124V1197`,C.sky);s+=plane(x,1338,278,80,22);s+=icon(execs[i][2],x+139,1311,.6);s+=t(x+139,1236,execs[i][0],20,500,C.ink,'middle')+t(x+139,1378,execs[i][1],17,400,C.ink,'middle');s+=route(`M${x+140} 1401V1440`,C.sky);}
  s+=layer('05',1464,'接続契約','Contracts','PORTS / ADAPTERS');
  s+=rect(285,1441,1210,97,C.ice,C.blue)+t(890,1483,'PORTS / ADAPTERS',29,500,C.ink,'middle')+t(890,1518,L('型 · 認証文脈 · 版 · Timeout · Trace · Typed error · Capability','Types · Auth context · Version · Timeout · Trace · Typed errors · Capabilities'),20,400,C.ink,'middle');
  s+=layer('06',1615,'技術の実装','Technology','REFERENCE + OPTIONS');
  const tech=[{x:285,title:'Node.js + PostgreSQL',sub:L('参照実装の中核','Reference implementation'),items:L('状態 / Action / Outbox / 履歴','State / Action / Outbox / History'),ref:true},{x:700,title:L('イベント・ワークフロー','Events & workflows'),sub:L('拡張候補の例','Extension candidates'),items:'Kafka / Temporal',ref:false},{x:1115,title:L('検索・認可・メタデータ','Search, policy & metadata'),sub:L('拡張候補の例','Extension candidates'),items:'OpenSearch / OPA / OpenMetadata',ref:false}];
  for(const a of tech){s+=route(`M${a.x+190} 1538V1596`,C.sky);s+=plane(a.x,1781,380,142,28,a.ref?C.ice:C.white);s+=t(a.x+190,1624,a.sub,18,500,a.ref?C.blue:C.ink,'middle')+t(a.x+190,1702,a.title,23,500,C.ink,'middle')+t(a.x+190,1739,a.items,17,400,C.ink,'middle');}
  s+=t(897,1828,L('候補は接続・適合性の検証前。PostgreSQL以外への置換保証ではありません。','Candidates require integration and conformance testing; non-PostgreSQL replacement is not guaranteed.'),19,400,C.ink,'middle');
  s+=layer('07',1890,'外部の世界','External estate','EXISTING SYSTEMS');
  const sources=['ERP / CRM / WMS','RDB / CDC / Files','Lakehouse / BI / Models'];
  for(let i=0;i<3;i++){const x=285+i*415;s+=route(`M${x+190} 1849V1884`,C.line);s+=rect(x,1888,380,65,C.white,C.line)+t(x+190,1929,sources[i],22,400,C.ink,'middle');}
  // Cross-cutting controls have their own rail, not an eighth runtime layer.
  s+=line(1548,247,1548,1954,C.line,1.5)+t(1580,253,L('横断機能','SHARED'),21,600)+t(1580,284,L('すべての層へ','CONTROLS'),18);
  const controls=[['Policy','& Audit','認可 / 証拠','Access / Evidence'],['Metadata','& Lineage','来歴 / 正本','Lineage / Authority'],['Release','& Composition','版 / 公開','Version / Release'],['Verification','','適合 / 評価','Conformance / Eval'],['Operations','','監視 / SLO','Observe / SLO'],['Recovery','& Migration','復旧 / 移行','Recover / Migrate']];
  controls.forEach((c,i)=>{const y=419+i*273;s+=circle(1548,y,4,C.blue,C.blue)+line(1553,y,1575,y,C.line);s+=t(1580,y,c[0],20,500)+t(1580,y+29,c[1],20,500)+t(1580,y+66,L(c[2],c[3]),16);});
  s+=foot(w,h,L('目標設計 / 導入・接続・検証済みの一覧ではありません。','Target design / Not a list of completed integrations or verified replacements.'),'AIP–OSS / CANLY COLORS');
  return svg(lang,w,h,'AIP–OSS Platform — '+L('目標アーキテクチャ','Target architecture'),L('七つの層。業務オブジェクトの意味とルールを中核に、人とAI、認可、実行、契約、技術、外部システムを接続。横断機能は監査、来歴、公開、検証、運用、復旧。','Seven layers connect people and AI to trust, business definitions, execution, contracts, technology and external systems. Shared controls span audit, lineage, releases, verification, operations and recovery.'),s);
}

function recall(lang){
  const L=(ja,en)=>pick(lang,ja,en); const w=1600,h=660;
  let s=header(w,L('商品回収を、業務の流れに','From a recall notice to governed action'),'BUSINESS SCENARIO / 02',L('検索したデータを、認可と承認を伴う業務操作につなぐ。','Connect retrieved facts to business operations governed by authorization and approval.'));
  const steps=[['回収通知','Recall notice','対象ロットを受信','Receive affected lot','document'],['対象在庫','Locate inventory','2店舗の在庫を確認','Check two stores','store'],['隔離','Quarantine','販売できなくする','Block affected stock','boxes'],['代替提案','Propose substitutes','欠品への対応を考える','Plan for stock-outs','agent'],['承認','Approve','権限と条件を確認','Verify authority & rules','check'],['外部反映','Deliver','通知イベントへ接続','Emit notification events','link']];
  steps.forEach((a,i)=>{const x=160+i*256;if(i<5)s+=route(`M${x+94} 321H${x+156}`,C.sky,1.7,'',true);s+=plane(x-99,367,198,82,26);s+=icon(a[4],x,324,.8,i===2||i===4)+t(x,235,String(i+1).padStart(2,'0'),17,500,C.blue,'middle');s+=t(x,421,L(a[0],a[1]),25,500,C.ink,'middle')+t(x,461,L(a[2],a[3]),19,400,C.ink,'middle');if(i===2||i===4)s+=line(x-35,486,x+35,486,C.orange,3);});
  s+=rect(60,528,1480,46,C.ice,C.line)+t(800,558,L('対象ロット → 在庫 → 店舗 → Action → 承認 → 外部結果を、業務上の関係として結ぶ','Affected lot → inventory → store → Action → approval → external result: connected by business relationships.'),20,400,C.ink,'middle');
  s+=foot(w,h,L('参照シナリオ / 合成データの2店舗・APIデモ','Reference scenario / Two-store synthetic-data API demo'),'AIP–OSS / 02');
  return svg(lang,w,h,L('商品回収の業務フロー','Recall business flow'),L('回収通知、対象在庫、隔離、代替提案、承認、外部反映の順に進む。合成データを使用。','Recall notice, inventory, quarantine, substitute proposal, approval, and delivery, using synthetic data.'),s);
}

function authority(lang){
  const L=(ja,en)=>pick(lang,ja,en); const w=1600,h=840;
  let s=header(w,L('提案できる。実行してよい、とは限らない。','A proposal is not permission to execute.'),'AUTHORITY BOUNDARY / 03',L('AIの出力は提案。実行のたびに、Actionの境界で条件を確認する。','AI produces proposals. Every execution request is checked at the Action boundary.'));
  s+=t(277,239,L('認可された根拠','AUTHORIZED EVIDENCE'),22,500,C.ink,'middle')+t(723,239,L('型付きの提案','TYPED PROPOSAL'),22,500,C.ink,'middle')+t(1265,239,L('業務としての実行','GOVERNED EXECUTION'),22,500,C.ink,'middle');
  s+=plane(100,466,355,126,35)+plane(550,466,345,126,35)+plane(1090,466,350,126,35,C.warm);
  s+=icon('database',277,411,.94)+icon('agent',723,424,1.18)+icon('shield',1265,421,1.02,true);
  s+=route('M380 378H590',C.sky,1.8,'',true)+route('M836 378H1147',C.sky,1.8,'',true);
  s+=line(992,272,992,698,C.orange,1.7,'6 7')+tag(906,282,171,'ACTION BOUNDARY',true);
  s+=t(277,518,L('認証済みIDから検索','Retrieve as a verified actor'),24,500,C.ink,'middle')+t(277,554,L('閲覧を許可された情報だけ','Only permitted information'),21,400,C.ink,'middle');
  s+=t(723,518,L('根拠を添えて提案する','Propose with evidence'),24,500,C.ink,'middle')+t(723,554,L('提案に実行権限は付かない','No execution authority granted'),21,400,C.ink,'middle');
  s+=t(1265,518,'Action Engine',25,500,C.ink,'middle')+t(1265,554,L('実行時に、もう一度検査','Recheck at execution time'),21,400,C.ink,'middle');
  s+=rect(1065,588,404,112,C.white,C.orange)+t(1087,621,L('主体・権限・委任','Actor / Authority / Delegation'),20)+t(1087,653,L('期待版・制約・承認','Expected revision / Constraints / Approval'),19)+t(1087,683,L('同じ要求の再送判定','Idempotency / Duplicate request checks'),19);
  s+=rect(100,612,795,68,C.ice,C.line)+t(497,641,L('検索時の権限と、実行時の権限は別に確認する','Retrieval permission and execution permission are checked separately.'),21,500,C.ink,'middle')+t(497,667,L('拒否された操作は実行しない','Denied operations do not execute.'),18,400,C.ink,'middle');
  s+=foot(w,h,L('設計上の境界 / 製品の実行時AIモデルは未採用','Design boundary / No production runtime AI model has been adopted'),'AIP–OSS / 03');
  return svg(lang,w,h,L('AIの提案と実行権限を分ける','Separate AI proposals from execution authority'),L('認可された情報を取得して提案を作る。Action Engineで主体、委任、期待版、承認、冪等性を再検査する。','Authorized retrieval feeds a typed proposal. The Action Engine rechecks actor, delegation, revision, approval and idempotency.'),s);
}

function unknown(lang){
  const L=(ja,en)=>pick(lang,ja,en);const w=1600,h=1060;
  let s=header(w,L('成功したのに、応答がない。','The operation succeeded. The response disappeared.'),'DELIVERY & RECOVERY / 04',L('ローカルの原子性と、外部システムへの反映は別の問題。','Local atomicity and delivery to an external system are separate concerns.'));
  s+=t(419,238,L('同じローカルトランザクション','ONE LOCAL TRANSACTION'),23,500,C.ink,'middle')+t(1275,238,L('外部は別トランザクション','SEPARATE EXTERNAL TRANSACTION'),23,500,C.ink,'middle');
  s+=plane(112,439,617,143,48,C.ice)+plane(1080,439,389,143,37);
  const units=[['Object',226,'database'],['Action',420,'document'],['Outbox',614,'events']];
  for(const [label,x,kind] of units)s+=icon(kind,x,376,.68)+t(x,416,label,23,500,C.ink,'middle');
  s+=icon('database',1275,377,.83)+t(1275,416,'ERP / WMS',23,500,C.ink,'middle');
  s+=route('M743 340H1060',C.sky,1.8,'',true)+t(900,315,L('確定後に送信','Deliver after commit'),21,500,C.ink,'middle');
  s+=route('M1060 397H963M915 397H743',C.orange,1.7,'6 6')+line(927,385,951,409,C.orange,2.5)+line(951,385,927,409,C.orange,2.5)+t(900,443,L('成功応答を消失','Success response lost'),20,400,C.ink,'middle');
  s+=line(990,494,990,730,C.line,1.3,'5 7');
  s+=t(420,493,L('Object + Action + Outboxを同時に確定','Commit Object + Action + Outbox together'),21,400,C.ink,'middle')+t(1275,493,L('外部では処理済み','The external effect has committed'),21,400,C.ink,'middle');
  s+=rect(112,540,617,128,C.warm,C.orange)+t(145,580,'UNKNOWN',29,600)+t(145,617,L('失敗と決めつけず、無条件に再送しない','Do not assume failure. Do not retry blindly.'),23)+t(145,647,L('外部の証拠で、結果を確認する','Resolve the outcome using external evidence.'),20);
  s+=route('M743 599H1060',C.sky,1.8,'',true)+t(906,575,'Reconcile',21,500,C.ink,'middle');
  s+=rect(1080,540,389,128,C.white,C.blue)+t(1110,580,L('外部記録と照合','Check external records'),24,500)+t(1110,615,'Operation ID',22)+t(1110,647,'+ Input digest',22);
  s+=route('M1080 706H732',C.sky,1.7,'',true)+t(901,740,L('確認できなければ UNKNOWN のまま','No confirming evidence → remain UNKNOWN'),20,400,C.ink,'middle');
  s+=line(60,784,1540,784)+t(60,827,L('冪等性 / 同じ依頼を見分ける','IDEMPOTENCY / Recognize the same operation'),24,500);
  s+=rect(60,860,700,89,C.ice,C.line)+rect(800,860,740,89,C.warm,C.line);
  s+=t(86,895,L('同じID・同じ入力','Same ID, same input'),23,500)+t(86,928,L('既存の結果を返す','Return the existing result'),21);
  s+=t(827,895,L('同じID・違う入力','Same ID, different input'),23,500)+t(827,928,L('競合として拒否する','Reject as a conflict'),21);
  s+=foot(w,h,L('外部まで含む単一トランザクションや、無条件の exactly-once は主張しません。','No global transaction across the ERP, and no unconditional exactly-once claim.'),'AIP–OSS / 04');
  return svg(lang,w,h,L('外部成功後の応答消失と復旧','Lost success responses and reconciliation'),L('ローカル確定後に外部へ送る。応答が消えればUNKNOWNとして保持。操作IDと入力ダイジェストで照合し、同じIDの違う入力は拒否する。','After a local commit, send to the external system. A lost response remains UNKNOWN. Reconcile by operation ID and input digest; reject the same ID with different input.'),s);
}

// Recolor retained detailed / legacy vector assets as well as the four new figures.
const legacyColors={
  '#127b78':C.blue,'#142338':C.ink,'#147fbc':C.blue,'#174c69':C.ink,'#183341':C.ink,
  '#1c6651':C.blue,'#244fce':C.blue,'#43556c':C.ink,'#5d737f':C.ink,'#879aa3':C.note,
  '#915a11':C.ink,'#a6b4c3':C.line,'#b6d8e9':C.line,'#b7cbd5':C.line,'#bedbd6':C.line,
  '#c4dce8':C.line,'#d5e0e5':C.line,'#d9e0e8':C.line,'#e2eff5':C.ice,'#e6f3ee':C.ice,
  '#e8edff':C.ice,'#f0f8fc':C.mist,'#f1f8f7':C.ice,'#f2f5f8':C.white,'#f7f9fa':C.white,
  '#fff1d7':C.warm,'#ffffff':C.white,
};
async function normalize(dir){
  for(const e of await readdir(dir,{withFileTypes:true})){
    const file=path.join(dir,e.name);
    if(e.isDirectory())await normalize(file);
    else if(e.name.endsWith('.svg')){
      const source=await readFile(file,'utf8');
      await writeFile(file,source.replace(/#[a-fA-F0-9]{6}/g,c=>legacyColors[c.toLowerCase()]??c).replace(/rx="(?:12|14|16|18|20)"/g,'rx="2"'));
    }
  }
}
export async function drawDiagrams(dist){
  const assets=path.join(dist,'assets');
  await normalize(assets);
  for(const lang of ['ja','en']){
    const name=`aip-oss-architecture-clean${lang==='en'?'.en':''}.svg`;
    const original=await readFile(path.join(assets,'architecture',name),'utf8');
    await writeFile(path.join(assets,'architecture',`aip-oss-architecture-detail${lang==='en'?'.en':''}.svg`),original);
    await writeFile(path.join(assets,'architecture',name),architecture(lang));
    for(const [name,render] of [['recall-flow',recall],['proposal-authority',authority],['unknown-success',unknown]]){
      await writeFile(path.join(assets,'project-introduction',`${name}${lang==='ja'?'.ja':''}.svg`),render(lang));
    }
  }
}
