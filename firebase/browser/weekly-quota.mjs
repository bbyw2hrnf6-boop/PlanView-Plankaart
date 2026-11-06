// Firebase-only allowance indicator. All enforcement and counting happen on the server.
const searchPaths=new Set(['/api/interpret','/api/ai/test','/api/rules/search','/api/permits/search']);
const copy={
 count:['AI: {remaining} / {limit} left','AI: {remaining} / {limit} over','KI: {remaining} / {limit} übrig'],
 loading:['Loading AI allowance…','AI-tegoed laden…','KI-Kontingent laden…'],
 unavailable:['AI allowance unavailable','AI-tegoed niet beschikbaar','KI-Kontingent nicht verfügbar'],
 title:['Weekly AI search allowance','Wekelijks AI-zoektegoed','Wöchentliches KI-Suchkontingent'],
 reset:['Resets on {date} (Amsterdam).','Wordt vernieuwd op {date} (Amsterdam).','Wird am {date} zurückgesetzt (Amsterdam).'],
 week:['150 AI searches per week, renewed every Monday at 00:00 in Amsterdam.','150 AI-zoekopdrachten per week, elke maandag om 00:00 in Amsterdam vernieuwd.','150 KI-Suchen pro Woche, jeden Montag um 00:00 Uhr in Amsterdam erneuert.'],
 scope:['A search counts once when it sends AI prompts. Connection tests also count. Map clicks and public data requests do not count.','Een zoekopdracht telt één keer als er AI-prompts worden verstuurd. Verbindingstests tellen ook mee. Kaartklikken en openbare gegevensaanvragen tellen niet mee.','Eine Suche zählt einmal, wenn sie KI-Prompts sendet. Verbindungstests zählen auch. Kartenklicks und öffentliche Datenabfragen zählen nicht.'],
 exhausted:['Weekly limit reached. Please contact the Planview owner if you need more searches. AI searches are blocked until the allowance resets.','Weeklimiet bereikt. Neem contact op met de eigenaar van Planview als je meer zoekopdrachten nodig hebt. AI-zoekopdrachten zijn geblokkeerd tot het tegoed wordt vernieuwd.','Wochenlimit erreicht. Bitte dem Planview-Besitzer Bescheid sagen, wenn du mehr Suchen brauchst. KI-Suchen sind bis zum Zurücksetzen gesperrt.'],
 failure:['The current allowance could not be checked. Refresh to try again. The server still enforces your limit.','Het actuele tegoed kon niet worden gecontroleerd. Vernieuw om opnieuw te proberen. De server blijft je limiet bewaken.','Das aktuelle Kontingent konnte nicht geprüft werden. Bitte aktualisieren. Der Server hält das Limit weiterhin ein.'],
 stale:['Last known allowance.','Laatst bekend tegoed.','Zuletzt bekannter Stand.'],
 refresh:['Refresh','Vernieuwen','Aktualisieren'],
};
const styles=`
 #pv-firebase-quota{position:relative;max-width:100%;font:12px system-ui;color:var(--text,#253b3c)}#pv-firebase-quota[hidden]{display:none}
 #pv-firebase-quota-badge{display:flex;align-items:center;justify-content:center;gap:7px;min-height:34px;font:500 11px system-ui;line-height:1.4;cursor:pointer;border:1px solid var(--line2,#c9d8d3);border-radius:20px;padding:6px 11px;background:var(--surface,#fff);color:var(--text,#253b3c);white-space:nowrap;font-variant-numeric:tabular-nums;transition:background .18s,border-color .18s}
 #pv-firebase-quota-badge::before{content:'';width:6px;height:6px;flex:none;border-radius:50%;background:#188277}
 #pv-firebase-quota-badge:hover{background:var(--surface2,#f1f8f6);border-color:#8ebdb5}
 #pv-firebase-quota-badge[data-state=low],#pv-firebase-quota-badge[data-state=exhausted]{border-color:#d3aa66;background:var(--surface,#fff);color:var(--text,#694d1c)}
 #pv-firebase-quota-badge[data-state=low]::before,#pv-firebase-quota-badge[data-state=exhausted]::before{background:#bc8128}
 #pv-firebase-quota-badge[data-state=unavailable]::before{background:#879496}
 #pv-firebase-quota-badge:focus-visible,#pv-firebase-quota-detail button:focus-visible{outline:3px solid var(--mint,#8ed0c6);outline-offset:2px}
 #pv-firebase-quota-detail{position:absolute;top:calc(100% + 10px);right:0;z-index:1800;box-sizing:border-box;width:min(320px,calc(100vw - 24px));max-height:60vh;overflow:auto;padding:17px;border:1px solid var(--line2,#c9d8d3);border-radius:14px;background:var(--surface,#fff);box-shadow:0 16px 40px #183d3424;font-size:12px;line-height:1.5;text-align:left;white-space:normal}
 #pv-firebase-quota-detail[hidden]{display:none}#pv-firebase-quota-detail h3{font-size:13px;line-height:1.4;margin:0 0 9px}#pv-firebase-quota-detail p{margin:0 0 9px}#pv-firebase-quota-detail p:last-child{margin-bottom:0}
 #pv-firebase-quota-detail button{font:inherit;cursor:pointer;border:1px solid var(--line2,#c9d8d3);border-radius:8px;padding:7px 11px;background:var(--surface2,#f5f8f6);color:inherit}#pv-firebase-quota-detail button:disabled{opacity:.55;cursor:wait}
 @media(max-width:600px){#pv-firebase-quota-badge{gap:5px;padding:6px 8px;font-size:10px;min-height:32px}}
 @media(prefers-reduced-motion:reduce){#pv-firebase-quota-badge{transition:none}}
`;
function label(doc,key){return copy[key][{nl:1,de:2}[doc.documentElement.lang]||0];}
function iso(value){if(typeof value!=='string')throw new Error('Invalid allowance');const date=new Date(value);if(!Number.isFinite(date.valueOf()))throw new Error('Invalid allowance');return date.toISOString();}
function normalize(raw){
 if(raw?.limited===false)return {limited:false};
 if(raw?.limited!==true||raw.limit!==150||!Number.isInteger(raw.used)||raw.used<0||raw.used>150||raw.remaining!==150-raw.used||raw.timezone!=='Europe/Amsterdam')throw new Error('Invalid allowance');
 const resetsAt=iso(raw.resetsAt),periodStart=iso(raw.periodStart);if(resetsAt<=periodStart)throw new Error('Invalid allowance');
 return {limited:true,limit:150,used:raw.used,remaining:raw.remaining,resetsAt,periodStart,timezone:'Europe/Amsterdam'};
}
/** Only mount for the test login. GET /api/quota remains authoritative. */
export function mountWeeklyQuota({container,window:win=globalThis.window,document:doc=globalThis.document}={}){
 if(win.__planviewWeeklyQuota)return win.__planviewWeeklyQuota;
 if(!container?.append)throw new TypeError('A header quota container is required');
 const el=(tag,value)=>{const node=doc.createElement(tag);if(value!==undefined)node.textContent=value;return node;};
 const style=el('style',styles),quota=el('div'),badge=el('button'),count=el('span'),detail=el('section');
 quota.id='pv-firebase-quota';badge.id='pv-firebase-quota-badge';detail.id='pv-firebase-quota-detail';
 badge.type='button';badge.setAttribute('aria-controls',detail.id);badge.setAttribute('aria-expanded','false');count.setAttribute('aria-live','polite');count.setAttribute('aria-atomic','true');detail.setAttribute('aria-labelledby','pv-firebase-quota-title');detail.hidden=true;
 badge.append(count);quota.append(badge,detail);doc.head.append(style);container.append(quota);
 let data=null,failed=false,loading=false,queued=false,destroyed=false,open=false,showExhausted=false,pending=null,restoreRefreshFocus=false;
 const paragraph=value=>detail.append(el('p',value));
 function positionDetail(){
  if(!open)return;
  const rect=quota.getBoundingClientRect?.(),width=Number(win.innerWidth);
  if(!rect||!Number.isFinite(rect.left)||!Number.isFinite(rect.right)||!Number.isFinite(width)||width<=24)return;
  const panelWidth=Math.min(320,width-24),left=Math.max(12,Math.min(rect.right-panelWidth,width-12-panelWidth));
  detail.style.left=`${left-rect.left}px`;detail.style.right='auto';detail.style.width=`${panelWidth}px`;
  if(Number.isFinite(win.innerHeight)&&Number.isFinite(rect.bottom))detail.style.maxHeight=`${Math.max(0,win.innerHeight-rect.bottom-22)}px`;
 }
 function draw(){
  if(destroyed)return;
  if(doc.activeElement?.id==='pv-firebase-quota-refresh')restoreRefreshFocus=true;
  if(!open)restoreRefreshFocus=false;
  quota.hidden=data?.limited===false;
  const text=data?.limited?label(doc,'count').replace('{remaining}',data.remaining).replace('{limit}',data.limit):label(doc,failed?'unavailable':'loading');
  count.textContent=text;badge.dataset.state=failed?'unavailable':data?.remaining===0?'exhausted':data?.remaining<=15?'low':'ready';
  badge.title=label(doc,'title');badge.setAttribute('aria-expanded',String(open));detail.hidden=!open;detail.replaceChildren();
  const title=el('h3',label(doc,'title'));title.id='pv-firebase-quota-title';detail.append(title);
  if(data?.limited){
   if(failed)paragraph(label(doc,'stale'));
   paragraph(text);
   const date=new Intl.DateTimeFormat(doc.documentElement.lang||'en',{timeZone:'Europe/Amsterdam',dateStyle:'medium',timeStyle:'short'}).format(new Date(data.resetsAt));
   paragraph(label(doc,'reset').replace('{date}',date));
   if(data.remaining===0)paragraph(label(doc,'exhausted'));
  }
  if(failed)paragraph(label(doc,'failure'));
  paragraph(label(doc,'week'));paragraph(label(doc,'scope'));
  const refresh=el('button',label(doc,'refresh'));refresh.id='pv-firebase-quota-refresh';refresh.type='button';refresh.disabled=loading;refresh.addEventListener('click',()=>void load());detail.append(refresh);
  positionDetail();
  if(restoreRefreshFocus&&!loading){refresh.focus();restoreRefreshFocus=false;}
 }
 async function load(force=false){
  if(destroyed)return;
  if(loading){if(force)queued=true;return pending;}
  loading=true;draw();
  pending=(async()=>{
   try{
    const response=await win.fetch('/api/quota',{method:'GET',cache:'no-store',headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error('Allowance unavailable');
    const next=normalize(await response.json());if(destroyed)return;data=next;failed=false;
    if(showExhausted&&data.limited&&data.remaining===0)open=true;
   }catch{if(!destroyed)failed=true;}
   finally{
    loading=false;if(destroyed)return;if(!queued)showExhausted=false;draw();
    if(queued){queued=false;void load();}
   }
  })();return pending;
 }
 function onResponse(response,{path,method}){
  if(method!=='POST'||!searchPaths.has(path))return;
  if(response.status===429)showExhausted=true;
  void load(true);
 }
 function focus(){if(doc.visibilityState!=='hidden')void load();}
 function visibility(){if(doc.visibilityState==='visible')void load();}
 function language(){draw();}
 function close(event){if(event.key==='Escape'&&open){open=false;draw();badge.focus();}}
 function outside(event){if(open&&!quota.contains(event.target)){open=false;draw();}}
 badge.addEventListener('click',()=>{open=!open;draw();if(open)void load();});
 doc.addEventListener('keydown',close);doc.addEventListener('pointerdown',outside);win.addEventListener('resize',positionDetail);
 win.addEventListener('focus',focus);doc.addEventListener('visibilitychange',visibility);win.addEventListener('planview-language-change',language);
 const api={badge,detail,refresh:()=>load(true),onResponse,destroy(){
  destroyed=true;win.removeEventListener('focus',focus);doc.removeEventListener('visibilitychange',visibility);win.removeEventListener('planview-language-change',language);
  doc.removeEventListener('keydown',close);doc.removeEventListener('pointerdown',outside);win.removeEventListener('resize',positionDetail);
  quota.remove();style.remove();if(win.__planviewWeeklyQuota===api)delete win.__planviewWeeklyQuota;
 }};
 win.__planviewWeeklyQuota=api;void load();return api;
}
