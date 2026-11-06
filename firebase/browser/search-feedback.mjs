// Firebase-only, mounted for the pinned tester. Search lifecycle contains metadata only.
const kinds=['sites','rules','permits'],outcomes=['complete','partial','empty','error'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const copy={
 title:['Was this search helpful?','Was deze zoekopdracht nuttig?','War diese Suche hilfreich?'],
 sites:['Site search','Locaties zoeken','Standortsuche'],rules:['Rules search','Regels zoeken','Regelsuche'],permits:['Permit search','Vergunningen zoeken','Bauantragssuche'],
 up:['Helpful','Nuttig','Hilfreich'],down:['Not helpful','Niet nuttig','Nicht hilfreich'],
 reason:['What could be better? (optional)','Wat kan beter? (optioneel)','Was könnte besser sein? (optional)'],
 placeholder:['What was missing or did not match your expectations?','Wat ontbrak of voldeed niet aan je verwachtingen?','Was hat gefehlt oder nicht zu deiner Erwartung gepasst?'],
 send:['Send rating','Beoordeling versturen','Bewertung senden'],cancel:['Cancel','Annuleren','Abbrechen'],retry:['Try again','Opnieuw proberen','Erneut versuchen'],
 sending:['Saving…','Opslaan…','Wird gespeichert…'],saved:['Thank you — your rating is saved.','Bedankt — je beoordeling is opgeslagen.','Danke — deine Bewertung ist gespeichert.'],
 already:['This search has already been rated.','Deze zoekopdracht is al beoordeeld.','Diese Suche wurde bereits bewertet.'],
 long:['Please use no more than 1,500 characters.','Gebruik maximaal 1.500 tekens.','Bitte höchstens 1.500 Zeichen verwenden.'],
 error:['Delivery could not be confirmed. Try again with the same rating.','De verzending kon niet worden bevestigd. Probeer dezelfde beoordeling opnieuw.','Speichern konnte nicht bestätigt werden. Bitte dieselbe Bewertung erneut senden.'],
 auth:['Please sign in again to send your rating.','Meld je opnieuw aan om je beoordeling te versturen.','Bitte erneut anmelden, um deine Bewertung zu senden.'],
 invalid:['Please check your note and try again.','Controleer je opmerking en probeer opnieuw.','Bitte die Notiz prüfen und erneut versuchen.'],
 rate:['Please wait a little before sending another rating.','Wacht even voordat je nog een beoordeling verstuurt.','Bitte etwas warten, bevor du eine weitere Bewertung sendest.'],
 count:['{n} / 1,500','{n} / 1.500','{n} / 1.500'],
};
const styles=[
 '.pv-search-rating{margin:16px 0 4px;padding:13px 14px;border:1px solid var(--line,#d7e3df);border-radius:12px;background:var(--surface2,#f5f8f6);color:var(--text,#263d40);font:12px system-ui;min-width:0;animation:pv-search-rating-enter 180ms ease-out 1}',
 '.pv-search-rating .pv-rating-top{display:flex;gap:10px 14px;align-items:center;justify-content:space-between;flex-wrap:wrap}',
 '.pv-search-rating .pv-rating-title{font-size:12px;font-weight:650;margin:0;line-height:1.5}.pv-search-rating .pv-rating-kind{font-size:10px;color:var(--muted,#5e7379);display:block;margin-top:2px}',
 '.pv-search-rating .pv-rating-choices{display:flex;gap:7px;flex-wrap:wrap}.pv-search-rating button{font:600 11px system-ui;min-height:36px;padding:7px 10px;border:1px solid var(--line2,#c8d8d1);border-radius:9px;background:var(--surface,#fff);color:var(--text,#263d40);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px}',
 '.pv-search-rating button svg{width:16px;height:16px;flex:none}.pv-search-rating [data-rating=down] svg{transform:rotate(180deg)}',
 '.pv-search-rating [data-rating=up][aria-pressed=true]{color:#146650;border-color:#7aaf9e;background:#e5f3ee}.pv-search-rating [data-rating=down][aria-pressed=true]{color:#9c3d23;border-color:#d4a28e;background:#fbe9e2}',
 '.pv-search-rating button:disabled{opacity:.55;cursor:default}.pv-search-rating button:focus-visible,.pv-search-rating textarea:focus-visible{outline:3px solid var(--mint,#177f73);outline-offset:2px}',
 '.pv-search-rating .pv-rating-form{margin-top:12px;display:grid;gap:9px;animation:pv-search-rating-enter 150ms ease-out 1}.pv-search-rating .pv-rating-form[hidden],.pv-search-rating [hidden]{display:none!important}',
 '.pv-search-rating label{display:grid;gap:7px;font-size:11px;font-weight:600}.pv-search-rating textarea{box-sizing:border-box;width:100%;min-width:0;min-height:80px;max-height:180px;resize:vertical;border:1px solid var(--line2,#c8d8d1);border-radius:9px;background:var(--surface,#fff);color:var(--text,#263d40);font:13px system-ui;line-height:1.5;padding:10px}',
 '.pv-search-rating .pv-rating-count{font-size:10px;color:var(--muted,#5e7379);text-align:right;font-weight:400}.pv-search-rating .pv-rating-actions{display:flex;gap:7px;justify-content:flex-end;flex-wrap:wrap}',
 '.pv-search-rating .pv-rating-send{background:var(--mint,#177f73);border-color:var(--mint,#177f73);color:var(--on-accent,#fff)}.pv-search-rating .pv-rating-status{font-size:11px;line-height:1.5;margin:8px 0 0}.pv-search-rating .pv-rating-status:empty{display:none}.pv-search-rating .pv-rating-retry{margin-top:8px}',
 '@keyframes pv-search-rating-enter{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}',
 '@media(prefers-reduced-motion:reduce){.pv-search-rating,.pv-search-rating .pv-rating-form{animation:none!important}}',
].join('\n');
function text(doc,key){return copy[key][{nl:1,de:2}[doc.documentElement.lang]||0];}
function newId(win){if(win.crypto?.randomUUID)return win.crypto.randomUUID();throw new Error('Secure identifier unavailable');}
/** One inline rating for each current search kind; never attaches controls to the map. */
export function mountSearchFeedback({window:win=globalThis.window,document:doc=globalThis.document}={}){
 if(win.__planviewSearchFeedback)return win.__planviewSearchFeedback;
 const el=(tag,className='',value)=>{const node=doc.createElement(tag);if(className)node.className=className;if(value!==undefined)node.textContent=value;return node;};
 const style=el('style');style.textContent=styles;doc.head.append(style);
 const current=new Map();let destroyed=false;
 function retire(state){if(!state)return;state.retired=true;state.observer?.disconnect();state.node?.remove();}
 function icon(){
  const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg'),path=doc.createElementNS('http://www.w3.org/2000/svg','path');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('aria-hidden','true');
  path.setAttribute('d','M7 10v10H3V10h4Zm0 0 5-7c1-1 3 0 3 1v5h4a2 2 0 0 1 2 2l-1 7a2 2 0 0 1-2 2H7');svg.append(path);return svg;
 }
 function attach(state,container){
  state.observer?.disconnect();state.container=container;if(state.node.parentNode!==container)container.append(state.node);
  if(win.MutationObserver){
   state.observer=new win.MutationObserver(()=>{if(!destroyed&&!state.retired&&current.get(state.kind)===state&&state.container.isConnected&&!state.container.contains(state.node))state.container.append(state.node);});
   state.observer.observe(container,{childList:true});
  }
 }
 function create(detail){
  const state={...detail,retired:false,busy:false,choice:'',delivered:false,already:false,error:'',pending:null};
  const node=el('section','pv-search-rating'),top=el('div','pv-rating-top'),heading=el('div'),title=el('p','pv-rating-title'),kind=el('span','pv-rating-kind'),choices=el('div','pv-rating-choices'),up=el('button'),down=el('button'),upText=el('span'),downText=el('span'),form=el('div','pv-rating-form'),label=el('label'),caption=el('span'),input=el('textarea'),count=el('span','pv-rating-count'),actions=el('div','pv-rating-actions'),cancel=el('button'),send=el('button','pv-rating-send'),status=el('p','pv-rating-status'),retry=el('button','pv-rating-retry');
  state.node=node;node.dataset.searchRating=detail.kind;node.setAttribute('role','group');title.id='pv-rating-title-'+detail.searchId;node.setAttribute('aria-labelledby',title.id);form.id='pv-rating-form-'+detail.searchId;
  for(const [button,rating,captionNode]of [[up,'up',upText],[down,'down',downText]]){button.type='button';button.dataset.rating=rating;button.append(icon(),captionNode);choices.append(button);}
  down.setAttribute('aria-controls',form.id);heading.append(title,kind);top.append(heading,choices);
  input.maxLength=1500;input.rows=3;count.id='pv-rating-count-'+detail.searchId;input.setAttribute('aria-describedby',count.id);label.append(caption,input,count);
  for(const button of [cancel,send,retry])button.type='button';actions.append(cancel,send);form.append(label,actions);node.append(top,form,status,retry);status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  function draw(){
   if(destroyed||state.retired)return;
   const finalized=state.delivered||state.already;
   title.textContent=text(doc,'title');kind.textContent=text(doc,state.kind);upText.textContent=text(doc,'up');downText.textContent=text(doc,'down');
   up.setAttribute('aria-pressed',String(state.choice==='up'));down.setAttribute('aria-pressed',String(state.choice==='down'));down.setAttribute('aria-expanded',String(state.choice==='down'&&!finalized));
   up.disabled=down.disabled=state.busy||finalized||Boolean(state.pending);
   form.hidden=state.choice!=='down'||finalized;
   caption.textContent=text(doc,'reason');input.placeholder=text(doc,'placeholder');count.textContent=text(doc,'count').replace('{n}',input.value.length);
   input.disabled=state.busy;input.readOnly=Boolean(state.pending);input.setAttribute('aria-invalid',String(state.error==='long'||state.error==='invalid'));
   cancel.textContent=text(doc,'cancel');cancel.disabled=state.busy||Boolean(state.pending);send.textContent=text(doc,'send');send.disabled=state.busy;send.hidden=Boolean(state.pending&&state.error);
   retry.textContent=text(doc,'retry');retry.hidden=!state.error||state.error==='long';retry.disabled=state.busy;
   status.textContent=text(doc,state.busy?'sending':state.delivered?'saved':state.already?'already':state.error||'title');if(!state.busy&&!state.delivered&&!state.already&&!state.error)status.textContent='';
   node.setAttribute('aria-busy',String(state.busy));
  }
  async function submit(){
   if(state.busy||state.delivered||state.already||state.retired||destroyed||!state.choice)return;
   if(!state.pending&&input.value.length>1500){state.error='long';draw();input.focus();return;}
   state.busy=true;state.error='';draw();
   try{
    if(!state.pending)state.pending={searchId:state.searchId,submissionId:newId(win),kind:state.kind,rating:state.choice,text:state.choice==='down'?input.value.trim():'',outcome:state.outcome,resultCount:state.resultCount};
    const response=await win.fetch('/api/search-feedback',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(state.pending),signal:(win.AbortSignal||globalThis.AbortSignal).timeout(20_000)});
    if(!response.ok){
     if(response.status===409){state.already=true;state.pending=null;return;}
     state.error=response.status===401||response.status===403?'auth':response.status===400?'invalid':response.status===429?'rate':'error';
     if([400,401,403,429].includes(response.status))state.pending=null;
     return;
    }
    const result=await response.json();if(result?.ok!==true||typeof result.id!=='string'||!result.id)throw new Error('Rating not confirmed');
    state.delivered=true;state.pending=null;input.value='';
   }catch{state.error='error';}
   finally{state.busy=false;draw();}
  }
  up.addEventListener('click',()=>{if(state.busy||state.delivered||state.already||state.pending)return;state.choice='up';submit();});
  down.addEventListener('click',()=>{if(state.busy||state.delivered||state.already||state.pending)return;state.choice='down';state.error='';draw();input.focus();});
  cancel.addEventListener('click',()=>{if(state.busy||state.pending)return;state.choice='';state.error='';draw();down.focus();});
  send.addEventListener('click',submit);retry.addEventListener('click',submit);
  input.addEventListener('input',()=>{if(state.busy||state.pending)return;state.error='';draw();});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();submit();}else if(event.key==='Escape'&&!state.busy&&!state.pending){event.preventDefault();event.stopPropagation();cancel.click();}});
  state.draw=draw;draw();return state;
 }
 function lifecycle(event){
  const detail=event.detail;if(destroyed||!detail||!kinds.includes(detail.kind))return;
  const previous=current.get(detail.kind);
  if(detail.phase==='cleared'){if(detail.searchId&&previous?.searchId!==detail.searchId)return;retire(previous);current.set(detail.kind,{kind:detail.kind,searchId:detail.searchId||previous?.searchId,phase:'cleared'});return;}
  if(!uuid.test(detail.searchId))return;
  if(detail.phase==='started'){if(previous?.searchId===detail.searchId)return;retire(previous);current.set(detail.kind,{kind:detail.kind,searchId:detail.searchId,phase:'started'});return;}
  if(detail.phase!=='completed'||!outcomes.includes(detail.outcome)||!(detail.resultCount===null||Number.isInteger(detail.resultCount)&&detail.resultCount>=0)||!detail.container||typeof detail.container.append!=='function')return;
  if(previous&&(previous.searchId!==detail.searchId||previous.phase==='cleared'))return;
  const state=previous?.node?previous:create(detail);current.set(detail.kind,state);attach(state,detail.container);
 }
 function translate(){for(const state of current.values())state.draw?.();}
 win.addEventListener('planview-search-feedback',lifecycle);win.addEventListener('planview-language-change',translate);
 const api={destroy(){if(destroyed)return;destroyed=true;for(const state of current.values())retire(state);current.clear();style.remove();win.removeEventListener('planview-search-feedback',lifecycle);win.removeEventListener('planview-language-change',translate);if(win.__planviewSearchFeedback===api)delete win.__planviewSearchFeedback;}};
 win.__planviewSearchFeedback=api;return api;
}
