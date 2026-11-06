// Firebase-only Settings extension. Mount only after /api/status confirms the owner.
import {mountAdminSearchFeedback} from './admin-search-feedback.mjs';
const categories=['uncategorized','interface','search','rules','permits','map','idea','other'];
const copy={
 tab:['Test-user feedback','Feedback testgebruiker','Testnutzer-Feedback'],
 sections:['Feedback type','Soort feedback','Feedback-Art'],notes:['General notes','Algemene opmerkingen','Allgemeine Hinweise'],ratings:['Search ratings','Zoekbeoordelingen','Suchbewertungen'],
 title:['Feedback from TestUser02','Feedback van TestUser02','Feedback von TestUser02'],
 intro:['Notes and ideas saved by your tester. Open this tab or refresh to load them.','Opmerkingen en ideeën van je tester. Open dit tabblad of vernieuw om ze te laden.','Gespeicherte Hinweise und Ideen deines Testnutzers. Zum Laden diesen Reiter öffnen oder aktualisieren.'],
 refresh:['Refresh','Vernieuwen','Aktualisieren'],more:['Load more','Meer laden','Mehr laden'],
 filter:['Category filter','Categoriefilter','Kategoriefilter'],all:['All categories','Alle categorieën','Alle Kategorien'],
 scope:['The filter applies to the entries loaded below. Load more to include older feedback.','Het filter geldt voor de hieronder geladen berichten. Laad meer voor oudere feedback.','Der Filter gilt für die unten geladenen Einträge. „Mehr laden“ zeigt auch älteres Feedback.'],
 loading:['Loading feedback…','Feedback laden…','Feedback wird geladen…'],
 ready:['Latest feedback loaded.','Nieuwste feedback geladen.','Neuestes Feedback geladen.'],
 error:['Feedback could not be loaded. Please try again.','Feedback kon niet worden geladen. Probeer het opnieuw.','Feedback konnte nicht geladen werden. Bitte erneut versuchen.'],
 stale:['Loading failed. The previously loaded feedback remains below. Please try again.','Laden mislukt. De eerder geladen feedback blijft hieronder staan. Probeer het opnieuw.','Laden fehlgeschlagen. Das zuvor geladene Feedback bleibt unten sichtbar. Bitte erneut versuchen.'],
 forbidden:['Feedback is available only to the administrator.','Feedback is alleen beschikbaar voor de beheerder.','Feedback ist nur für den Administrator verfügbar.'],
 retry:['Try again','Opnieuw proberen','Erneut versuchen'],
 empty:['No feedback yet. Saved notes from TestUser02 will appear here.','Nog geen feedback. Opgeslagen opmerkingen van TestUser02 verschijnen hier.','Noch kein Feedback. Gespeicherte Hinweise von TestUser02 erscheinen hier.'],
 noMatch:['No entries in this category among the feedback loaded so far.','Geen berichten in deze categorie binnen de tot nu toe geladen feedback.','Keine Einträge in dieser Kategorie unter dem bisher geladenen Feedback.'],
 category:['Category','Categorie','Kategorie'],save:['Save category','Categorie opslaan','Kategorie speichern'],saving:['Saving…','Opslaan…','Wird gespeichert…'],
 saved:['Category saved.','Categorie opgeslagen.','Kategorie gespeichert.'],
 saveError:['Category could not be saved. Your selection is kept; please try again.','Categorie kon niet worden opgeslagen. Je keuze blijft staan; probeer het opnieuw.','Kategorie konnte nicht gespeichert werden. Deine Auswahl bleibt erhalten; bitte erneut versuchen.'],
 missing:['This entry is no longer available. Refresh to update the list.','Dit bericht is niet meer beschikbaar. Vernieuw de lijst.','Dieser Eintrag ist nicht mehr verfügbar. Bitte die Liste aktualisieren.'],
 time:['Times shown in your local time zone.','Tijden worden in je lokale tijdzone weergegeven.','Zeitangaben in deiner lokalen Zeitzone.'],
 uncategorized:['Uncategorized','Geen categorie','Ohne Kategorie'],interface:['Interface','Interface','Oberfläche'],search:['Search','Zoeken','Suche'],rules:['Rules','Regels','Regeln'],permits:['Permits','Vergunningen','Bauanträge'],map:['Map','Kaart','Karte'],idea:['Idea','Idee','Idee'],other:['Other','Overig','Sonstiges'],
};
const lang=doc=>({nl:1,de:2}[doc.documentElement.lang]||0);
const label=(doc,key)=>copy[key]?.[lang(doc)]||copy[key]?.[0]||key;
function normalizedItem(item){
 const match=typeof item?.id==='string'&&/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(item.id);
 if(!match||!Number.isFinite(Date.parse(match[1]))||new Date(match[1]).toISOString()!==match[1]||item.createdAt!==match[1]||typeof item.text!=='string'||item.text.length>3000||!item.text.trim()||!categories.includes(item.category)||item.user!=='TestUser02')throw new Error('Invalid feedback response');
 return {id:match[1]+'_'+match[2].toLowerCase(),text:item.text,category:item.category,createdAt:match[1],user:'TestUser02'};
}
function normalizedPage(raw){
 if(!raw||!Array.isArray(raw.items)||raw.items.length>50||(raw.nextCursor!==null&&(typeof raw.nextCursor!=='string'||!raw.nextCursor||raw.nextCursor.length>1000)))throw new Error('Invalid feedback response');
 return {items:raw.items.map(normalizedItem),nextCursor:raw.nextCursor};
}
const styles=`
 .services-dialog:has(#workspace-test-feedback:not([hidden])){width:min(850px,calc(100vw - 32px))}
 .workspace-settings-tabs:has([data-settings-tab=test-feedback]){display:flex;flex-wrap:wrap;gap:4px}
 .workspace-settings-tabs:has([data-settings-tab=test-feedback]) button{flex:1 1 140px;min-height:44px}
 #workspace-test-feedback{display:grid;gap:16px;min-width:0}#workspace-test-feedback[hidden]{display:none}
 #workspace-test-feedback .pv-feedback-sections{display:flex;gap:4px;padding:4px;background:var(--surface2);border:1px solid var(--line);border-radius:9px}
 #workspace-test-feedback .pv-feedback-sections button{flex:1 1 50%;border-color:transparent;background:transparent;font-weight:600}
 #workspace-test-feedback .pv-feedback-sections button[aria-pressed=true]{background:var(--surface);border-color:var(--line2);color:var(--mint)}
 #workspace-test-feedback .pv-feedback-notes{display:grid;gap:16px;min-width:0}#workspace-test-feedback .pv-feedback-notes[hidden]{display:none}
 #workspace-test-feedback h3{font-size:19px;margin:0 0 7px;letter-spacing:-.3px}
 #workspace-test-feedback p{font-size:12px;line-height:1.6;margin:0;color:var(--muted)}
 #workspace-test-feedback button,#workspace-test-feedback select{font:inherit;font-size:12px;min-height:42px;border:1px solid var(--line2);border-radius:7px;padding:8px 12px;background:var(--surface);color:var(--text);max-width:100%}
 #workspace-test-feedback button{cursor:pointer}#workspace-test-feedback button:disabled{opacity:.5;cursor:default}
 #workspace-test-feedback button:focus-visible,#workspace-test-feedback select:focus-visible{outline:3px solid var(--mint);outline-offset:2px}
 #workspace-test-feedback label{display:grid;gap:6px;font-size:12px;font-weight:600}
 #workspace-test-feedback .pv-feedback-tools{display:flex;gap:8px;align-items:end;flex-wrap:wrap}
 #workspace-test-feedback .pv-feedback-tools label{margin-right:auto;min-width:170px}
 #workspace-test-feedback .pv-feedback-list{display:grid;gap:12px}
 #workspace-test-feedback .pv-feedback-card{padding:16px;border:1px solid var(--line);border-radius:9px;background:var(--surface2);display:grid;gap:12px;min-width:0}
 #workspace-test-feedback .pv-feedback-meta{display:flex;gap:8px 14px;justify-content:space-between;flex-wrap:wrap;font-size:12px;color:var(--muted)}
 #workspace-test-feedback .pv-feedback-meta strong{color:var(--text)}
 #workspace-test-feedback .pv-feedback-text{font-size:14px;color:var(--text);white-space:pre-wrap;overflow-wrap:anywhere}
 #workspace-test-feedback .pv-feedback-category{display:flex;gap:8px;align-items:end;flex-wrap:wrap}
 #workspace-test-feedback .pv-feedback-category label{flex:1 1 160px;max-width:260px}
 #workspace-test-feedback .pv-feedback-status{min-height:20px}
 #workspace-test-feedback .pv-feedback-empty{padding:24px 15px;border:1px dashed var(--line2);border-radius:8px}
 #workspace-test-feedback .pv-feedback-more{justify-self:center;min-width:160px}
 @media(max-width:900px){.services-dialog:has(#workspace-test-feedback:not([hidden])){width:100%}}
 @media(max-width:560px){#workspace-test-feedback .pv-feedback-tools label{width:100%}#workspace-test-feedback .pv-feedback-category label{max-width:none}#workspace-test-feedback .pv-feedback-category button{flex:1 1 120px}.workspace-settings-tabs:has([data-settings-tab=test-feedback]) button{font-size:12px;flex-basis:45%}}
`;

/** Owner-only mounting complements, but never replaces, the server authorization. */
export function mountAdminFeedback({window:win=globalThis.window,document:doc=globalThis.document}={}){
 if(win.__planviewAdminFeedback)return win.__planviewAdminFeedback;
 const el=(tag,className='',value)=>{const node=doc.createElement(tag);if(className)node.className=className;if(value!==undefined)node.textContent=value;return node;};
 const panel=el('section','pv-admin-feedback'),notesPanel=el('section','pv-feedback-notes'),sections=el('div','pv-feedback-sections'),notesButton=el('button'),ratingsButton=el('button'),drafts=new Map(),saving=new Set(),messages=new Map();
 const ratings=mountAdminSearchFeedback({window:win,document:doc});
 let section='notes';
 let entry=null,items=[],nextCursor=null,loaded=false,loading=false,failed=false,forbidden=false,filter='all',retryCursor=null;
 const text=key=>label(doc,key);
 const dateTime=value=>new Intl.DateTimeFormat(doc.documentElement.lang||'en',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
 notesPanel.id='pv-admin-general-feedback';sections.setAttribute('role','group');
 for(const [key,button,target]of [['notes',notesButton,notesPanel],['ratings',ratingsButton,ratings.panel]]){
  button.type='button';button.dataset.feedbackSection=key;button.setAttribute('aria-controls',target.id);
  button.addEventListener('click',()=>{section=key;drawSections();if(key==='ratings')ratings.open();else if(!loaded&&!loading)load(null);});
  sections.append(button);
 }
 panel.append(sections,notesPanel,ratings.panel);
 function drawSections(){
  sections.setAttribute('aria-label',text('sections'));notesButton.textContent=text('notes');ratingsButton.textContent=text('ratings');
  notesButton.setAttribute('aria-pressed',String(section==='notes'));ratingsButton.setAttribute('aria-pressed',String(section==='ratings'));
  notesPanel.hidden=section!=='notes';ratings.panel.hidden=section!=='ratings';
 }
 function categorySelect(value,control){
  const select=el('select');select.dataset.feedbackControl=control;
  for(const key of categories){const option=el('option','',text(key));option.value=key;select.append(option);}select.value=value;return select;
 }
 function draw(){
  const active=doc.activeElement?.dataset?.feedbackControl;
  notesPanel.replaceChildren();notesPanel.setAttribute('aria-busy',String(loading));drawSections();
  if(entry)entry.button.textContent=text('tab');
  const heading=el('div');heading.append(el('h3','',text('title')),el('p','',text('intro')));notesPanel.append(heading);
  const tools=el('div','pv-feedback-tools'),filterLabel=el('label','',text('filter')),select=categorySelect(filter,'filter'),all=el('option','',text('all'));all.value='all';select.replaceChildren(all,...select.children);select.value=filter;select.setAttribute('aria-label',text('filter'));
  select.addEventListener('change',()=>{filter=select.value;draw();});filterLabel.append(select);
  const refresh=el('button','',text('refresh'));refresh.type='button';refresh.dataset.feedbackControl='refresh';refresh.disabled=loading||saving.size>0;refresh.addEventListener('click',()=>load(null));tools.append(filterLabel,refresh);notesPanel.append(tools);
  const status=el('p','pv-feedback-status',text(loading?'loading':forbidden?'forbidden':failed?loaded?'stale':'error':loaded?'ready':'loading'));status.setAttribute('role','status');status.setAttribute('aria-live','polite');notesPanel.append(status);
  if(failed&&!forbidden){const retry=el('button','',text('retry'));retry.type='button';retry.dataset.feedbackControl='retry';retry.disabled=loading;retry.addEventListener('click',()=>load(retryCursor));notesPanel.append(retry);}
  if(loaded){
   notesPanel.append(el('p','',text('scope')),el('p','',text('time')));
   const list=el('div','pv-feedback-list'),shown=items.filter(item=>filter==='all'||item.category===filter);
   for(const item of shown){
    const card=el('article','pv-feedback-card');card.dataset.feedbackId=item.id;
    const meta=el('div','pv-feedback-meta'),time=el('time','',dateTime(item.createdAt));time.setAttribute('datetime',item.createdAt);meta.append(el('strong','','TestUser02'),time);
    // Tester text is deliberately rendered as text. HTML and Markdown are never executed.
    const body=el('p','pv-feedback-text',item.text),controls=el('div','pv-feedback-category'),categoryLabel=el('label','',text('category')),category=categorySelect(drafts.get(item.id)??item.category,`category-${item.id}`),busy=saving.has(item.id);
    category.setAttribute('aria-label',`${text('category')} · ${dateTime(item.createdAt)}`);category.disabled=busy;category.addEventListener('change',()=>{drafts.set(item.id,category.value);messages.delete(item.id);draw();});categoryLabel.append(category);
    const save=el('button','',text(busy?'saving':'save'));save.type='button';save.dataset.feedbackControl=`save-${item.id}`;save.disabled=busy||loading||category.value===item.category;save.addEventListener('click',()=>saveCategory(item.id));controls.append(categoryLabel,save);
    card.append(meta,body,controls);
    if(messages.has(item.id)){const message=el('p','pv-feedback-status',text(messages.get(item.id)));message.setAttribute('role','status');message.setAttribute('aria-live','polite');card.append(message);}
    list.append(card);
   }
   if(!shown.length)list.append(el('p','pv-feedback-empty',text(items.length?'noMatch':'empty')));notesPanel.append(list);
   if(nextCursor){const more=el('button','pv-feedback-more',text('more'));more.type='button';more.dataset.feedbackControl='more';more.disabled=loading||saving.size>0;more.addEventListener('click',()=>load(nextCursor));notesPanel.append(more);}
  }
  if(active&&section==='notes')notesPanel.querySelector(`[data-feedback-control="${active}"]`)?.focus();
 }
 async function load(cursor){
  if(loading||saving.size)return;loading=true;failed=false;forbidden=false;retryCursor=cursor;draw();
  try{
   const response=await win.fetch('/api/admin/feedback'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{method:'GET',cache:'no-store',headers:{Accept:'application/json'}});
   if(!response.ok){forbidden=response.status===403;throw new Error('Feedback unavailable');}
   const page=normalizedPage(await response.json());
   // Refresh and pagination never discard an unsaved category selection.
   const combined=cursor?[...items,...page.items]:page.items;
   items=[...new Map(combined.map(item=>[item.id,item])).values()];nextCursor=page.nextCursor;loaded=true;
  }catch{failed=true;}finally{loading=false;draw();}
 }
 async function saveCategory(id){
  const item=items.find(item=>item.id===id),category=drafts.get(id);
  if(!item||saving.has(id)||loading||!categories.includes(category)||category===item.category)return;
  saving.add(id);messages.delete(id);draw();
  try{
   const response=await win.fetch('/api/admin/feedback',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({id,category})});
   if(!response.ok){messages.set(id,response.status===404?'missing':'saveError');throw new Error('Category unavailable');}
   const result=await response.json();if(result?.ok!==true)throw new Error('Invalid category response');
   const updated=result.item?normalizedItem(result.item):{...item,category};
   if(updated.id!==id||updated.category!==category)throw new Error('Invalid category response');
   items=items.map(row=>row.id===id?updated:row);drafts.delete(id);messages.set(id,'saved');
  }catch{if(!messages.has(id))messages.set(id,'saveError');}finally{saving.delete(id);draw();}
 }
 function mount(){
  if(entry||!win.PlanViewSettings)return;
  const style=el('style');style.textContent=styles;doc.head.append(style);
  entry=win.PlanViewSettings.registerTab('test-feedback',text('tab'),panel,()=>{if(section==='ratings')ratings.open();else if(!loaded&&!loading)load(null);});draw();
 }
 const api={panel};win.__planviewAdminFeedback=api;
 win.addEventListener('planview-settings-ready',mount,{once:true});win.addEventListener('planview-language-change',()=>{draw();ratings.translate();});mount();
 return api;
}
