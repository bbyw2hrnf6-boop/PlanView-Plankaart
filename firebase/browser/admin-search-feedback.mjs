// Owner-only view. The server independently authorizes every request.
const copy={
 title:['Search ratings','Zoekbeoordelingen','Suchbewertungen'],
 intro:['How TestUser02 experienced individual searches. Only ratings and an optional reason are saved here.','Hoe TestUser02 afzonderlijke zoekopdrachten heeft ervaren. Hier staan alleen beoordelingen en een eventuele toelichting.','Wie TestUser02 einzelne Suchen erlebt hat. Hier stehen Bewertungen und eine freiwillige Begründung.'],
 refresh:['Refresh','Vernieuwen','Aktualisieren'],more:['Load more','Meer laden','Mehr laden'],
 filter:['Rating','Beoordeling','Bewertung'],all:['All ratings','Alle beoordelingen','Alle Bewertungen'],up:['Satisfied','Tevreden','Zufrieden'],down:['Dissatisfied','Ontevreden','Unzufrieden'],
 scope:['Filter applies to loaded ratings. Load more to include older ratings.','Het filter geldt voor geladen beoordelingen. Laad meer voor oudere beoordelingen.','Der Filter gilt für geladene Bewertungen. „Mehr laden“ bezieht ältere Bewertungen ein.'],
 loading:['Loading search ratings…','Zoekbeoordelingen laden…','Suchbewertungen werden geladen…'],ready:['Latest search ratings loaded.','Nieuwste zoekbeoordelingen geladen.','Neueste Suchbewertungen geladen.'],
 error:['Search ratings could not be loaded. Please try again.','Zoekbeoordelingen konden niet worden geladen. Probeer het opnieuw.','Suchbewertungen konnten nicht geladen werden. Bitte erneut versuchen.'],
 stale:['Loading failed. Previously loaded search ratings remain below.','Laden mislukt. Eerder geladen zoekbeoordelingen blijven hieronder staan.','Laden fehlgeschlagen. Bisher geladene Suchbewertungen bleiben unten sichtbar.'],
 forbidden:['Search ratings are available only to the administrator.','Zoekbeoordelingen zijn alleen beschikbaar voor de beheerder.','Suchbewertungen sind nur für den Administrator verfügbar.'],
 retry:['Try again','Opnieuw proberen','Erneut versuchen'],empty:['No search ratings yet. Ratings from TestUser02 will appear here.','Nog geen zoekbeoordelingen. Beoordelingen van TestUser02 verschijnen hier.','Noch keine Suchbewertungen. Bewertungen von TestUser02 erscheinen hier.'],
 noMatch:['No matching ratings among the entries loaded so far.','Geen passende beoordelingen in de tot nu toe geladen berichten.','Keine passenden Bewertungen unter den bisher geladenen Einträgen.'],
 details:['Search details','Zoekdetails','Suchdetails'],kind:['Search','Zoekopdracht','Suche'],sites:['Find sites','Locaties zoeken','Grundstücke finden'],rules:['Rules','Regels','Regeln'],permits:['Permit history','Vergunninghistorie','Bauanträge'],
 outcome:['Result status','Resultaatstatus','Ergebnisstatus'],complete:['Complete','Volledig','Vollständig'],partial:['Partial','Gedeeltelijk','Teilweise'],emptyOutcome:['No results','Geen resultaten','Keine Ergebnisse'],errorOutcome:['Failed','Mislukt','Fehlgeschlagen'],
 resultCount:['Results','Resultaten','Ergebnisse'],unknown:['Not recorded','Niet vastgelegd','Nicht erfasst'],searchId:['Search reference','Zoekreferentie','Suchreferenz'],
 summary:['Loaded ratings','Geladen beoordelingen','Geladene Bewertungen'],time:['Times shown in your local time zone.','Tijden worden in je lokale tijdzone weergegeven.','Zeitangaben in deiner lokalen Zeitzone.'],
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)_([0-9a-f-]+)$/i;
function normalizedItem(item){
 const match=typeof item?.id==='string'&&record.exec(item.id),text=item?.text??'';
 if(!match||!uuid.test(match[2])||!Number.isFinite(Date.parse(match[1]))||new Date(match[1]).toISOString()!==match[1]||item.createdAt!==match[1]||!uuid.test(item.searchId)||!['sites','rules','permits'].includes(item.kind)||!['up','down'].includes(item.rating)||typeof text!=='string'||text.length>1500||!['complete','partial','empty','error'].includes(item.outcome)||(item.resultCount!==null&&(!Number.isSafeInteger(item.resultCount)||item.resultCount<0))||item.user!=='TestUser02')throw new Error('Invalid search feedback response');
 return {id:match[1]+'_'+match[2].toLowerCase(),searchId:item.searchId.toLowerCase(),kind:item.kind,rating:item.rating,text,createdAt:match[1],outcome:item.outcome,resultCount:item.resultCount,user:'TestUser02'};
}
function normalizedPage(raw){
 if(!raw||!Array.isArray(raw.items)||raw.items.length>50||(raw.nextCursor!==null&&(typeof raw.nextCursor!=='string'||!raw.nextCursor||raw.nextCursor.length>1000)))throw new Error('Invalid search feedback response');
 return {items:raw.items.map(normalizedItem),nextCursor:raw.nextCursor};
}
const styles=`
 #workspace-test-feedback .pv-search-ratings{display:grid;gap:16px;min-width:0}#workspace-test-feedback .pv-search-ratings[hidden]{display:none}
 #workspace-test-feedback .pv-rating-list{display:grid;gap:12px}
 #workspace-test-feedback .pv-rating-card{padding:16px;border:1px solid var(--line);border-radius:9px;background:var(--surface2);display:grid;gap:11px;min-width:0}
 #workspace-test-feedback .pv-rating-meta{display:flex;gap:8px 14px;align-items:center;justify-content:space-between;flex-wrap:wrap;font-size:12px;color:var(--muted)}
 #workspace-test-feedback .pv-rating-heading{display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-width:0}
 #workspace-test-feedback .pv-rating-heading strong{font-size:14px}
 #workspace-test-feedback .pv-rating-badge{display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border:1px solid var(--line2);border-radius:20px;font-size:11px;font-weight:600;color:var(--text);background:var(--surface)}
 #workspace-test-feedback .pv-rating-badge[data-rating=up]{border-color:color-mix(in srgb,var(--mint) 50%,var(--line2));background:color-mix(in srgb,var(--mint) 12%,var(--surface))}
 #workspace-test-feedback .pv-rating-badge[data-rating=down]{border-color:color-mix(in srgb,#b87348 50%,var(--line2));background:color-mix(in srgb,#b87348 12%,var(--surface))}
 #workspace-test-feedback .pv-rating-reason{font-size:14px;color:var(--text);white-space:pre-wrap;overflow-wrap:anywhere}
 #workspace-test-feedback .pv-rating-details{font-size:12px;color:var(--muted)}
 #workspace-test-feedback .pv-rating-details summary{cursor:pointer;min-height:32px;display:list-item;align-content:center}
 #workspace-test-feedback .pv-rating-details summary:focus-visible{outline:3px solid var(--mint);outline-offset:2px}
 #workspace-test-feedback .pv-rating-details dl{display:grid;grid-template-columns:minmax(95px,auto) minmax(0,1fr);gap:7px 15px;margin:8px 0 0}
 #workspace-test-feedback .pv-rating-details dt,#workspace-test-feedback .pv-rating-details dd{margin:0;overflow-wrap:anywhere}
 #workspace-test-feedback .pv-rating-details dd{color:var(--text)}
 #workspace-test-feedback .pv-rating-summary{font-size:12px;color:var(--muted)}
 @media(max-width:560px){#workspace-test-feedback .pv-rating-meta{align-items:start}#workspace-test-feedback .pv-rating-meta time{width:100%}#workspace-test-feedback .pv-rating-details dl{grid-template-columns:1fr;gap:3px}#workspace-test-feedback .pv-rating-details dd{margin-bottom:5px}}
`;

/** No fetching until open(); the owning feedback tab controls visibility. */
export function mountAdminSearchFeedback({window:win=globalThis.window,document:doc=globalThis.document}={}){
 const el=(tag,className='',value)=>{const node=doc.createElement(tag);if(className)node.className=className;if(value!==undefined)node.textContent=value;return node;};
 const panel=el('section','pv-search-ratings'),style=el('style');style.textContent=styles;doc.head.append(style);
 panel.id='pv-admin-search-ratings';panel.hidden=true;
 let items=[],nextCursor=null,loaded=false,loading=false,failed=false,forbidden=false,filter='all',retryCursor=null;
 const expanded=new Set();
 const text=key=>copy[key]?.[({nl:1,de:2}[doc.documentElement.lang]||0)]||copy[key]?.[0]||key;
 const dateTime=value=>new Intl.DateTimeFormat(doc.documentElement.lang||'en',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
 function draw(){
  const active=doc.activeElement?.dataset?.ratingControl;
  panel.replaceChildren();panel.setAttribute('aria-busy',String(loading));
  const heading=el('div');heading.append(el('h3','',text('title')),el('p','',text('intro')));panel.append(heading);
  const tools=el('div','pv-feedback-tools'),filterLabel=el('label','',text('filter')),select=el('select');select.dataset.ratingControl='filter';select.setAttribute('aria-label',text('filter'));
  for(const key of ['all','up','down']){const option=el('option','',text(key));option.value=key;select.append(option);}select.value=filter;
  select.addEventListener('change',()=>{filter=select.value;draw();});filterLabel.append(select);
  const refresh=el('button','',text('refresh'));refresh.type='button';refresh.dataset.ratingControl='refresh';refresh.disabled=loading;refresh.addEventListener('click',()=>load(null));tools.append(filterLabel,refresh);panel.append(tools);
  const status=el('p','pv-feedback-status',text(loading?'loading':forbidden?'forbidden':failed?loaded?'stale':'error':loaded?'ready':'loading'));status.setAttribute('role','status');status.setAttribute('aria-live','polite');panel.append(status);
  if(failed&&!forbidden){const retry=el('button','',text('retry'));retry.type='button';retry.dataset.ratingControl='retry';retry.disabled=loading;retry.addEventListener('click',()=>load(retryCursor));panel.append(retry);}
  if(loaded){
   const up=items.filter(item=>item.rating==='up').length;
   panel.append(el('p','pv-rating-summary',`${text('summary')}: ${items.length} · ${text('up')}: ${up} · ${text('down')}: ${items.length-up}`),el('p','',text('scope')));
   const list=el('div','pv-rating-list'),shown=items.filter(item=>filter==='all'||item.rating===filter);
   for(const item of shown){
    const card=el('article','pv-rating-card');card.dataset.ratingId=item.id;
    const meta=el('div','pv-rating-meta'),heading=el('div','pv-rating-heading'),badge=el('span','pv-rating-badge',`${item.rating==='up'?'👍':'👎'} ${text(item.rating)}`),time=el('time','',dateTime(item.createdAt));badge.dataset.rating=item.rating;time.setAttribute('datetime',item.createdAt);heading.append(badge,el('strong','',text(item.kind)));meta.append(heading,time);card.append(meta);
    // Reason is plain text, never HTML, Markdown, or an executable source.
    if(item.text.trim())card.append(el('p','pv-rating-reason',item.text));
    const details=el('details','pv-rating-details'),summary=el('summary','',text('details')),fields=el('dl');details.open=expanded.has(item.id);summary.dataset.ratingControl=`details-${item.id}`;
    details.addEventListener('toggle',()=>{if(details.open)expanded.add(item.id);else expanded.delete(item.id);});
    const outcome={empty:'emptyOutcome',error:'errorOutcome'}[item.outcome]||item.outcome;
    for(const [key,value]of [['outcome',text(outcome)],['resultCount',item.resultCount===null?text('unknown'):String(item.resultCount)],['searchId',item.searchId]])fields.append(el('dt','',text(key)),el('dd','',value));
    details.append(summary,fields);card.append(details);list.append(card);
   }
   if(!shown.length)list.append(el('p','pv-feedback-empty',text(items.length?'noMatch':'empty')));panel.append(list,el('p','',text('time')));
   if(nextCursor){const more=el('button','pv-feedback-more',text('more'));more.type='button';more.dataset.ratingControl='more';more.disabled=loading;more.addEventListener('click',()=>load(nextCursor));panel.append(more);}
  }
  if(active&&!panel.hidden)panel.querySelector(`[data-rating-control="${active}"]`)?.focus();
 }
 async function load(cursor){
  if(loading)return;loading=true;failed=false;forbidden=false;retryCursor=cursor;draw();
  try{
   const response=await win.fetch('/api/admin/search-feedback'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{method:'GET',cache:'no-store',headers:{Accept:'application/json'}});
   if(!response.ok){forbidden=response.status===403;throw new Error('Search feedback unavailable');}
   const page=normalizedPage(await response.json()),combined=cursor?[...items,...page.items]:page.items;
   items=[...new Map(combined.map(item=>[item.id,item])).values()];nextCursor=page.nextCursor;loaded=true;
  }catch{failed=true;}finally{loading=false;draw();}
 }
 draw();
 return {panel,open(){if(!loaded&&!loading)load(null);},translate:draw};
}
