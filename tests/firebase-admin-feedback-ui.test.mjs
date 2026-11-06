import test from 'node:test';
import assert from 'node:assert/strict';
import {mountAdminFeedback} from '../firebase/browser/admin-feedback.mjs';
import {mountAdminMonitoring} from '../firebase/browser/admin-monitor.mjs';

class Element{
 constructor(tag,document){this.tagName=tag.toUpperCase();this.document=document;this.children=[];this.dataset={};this.attributes={};this.style={};this.listeners={};this._text='';this.className='';this.hidden=false;this.disabled=false;this.value='';}
 append(...nodes){for(const node of nodes){const child=typeof node==='string'?Object.assign(new Element('text',this.document),{textContent:node}):node;child.parent=this;this.children.push(child);}}
 replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
 set innerHTML(value){throw new Error('Unsafe HTML construction: '+value);}
 setAttribute(key,value){this.attributes[key]=String(value);}
 getAttribute(key){return this.attributes[key];}
 addEventListener(name,fn){(this.listeners[name]||=[]).push(fn);}
 dispatch(name,props={}){for(const fn of this.listeners[name]||[])fn({target:this,preventDefault(){},...props});}
 click(){if(!this.disabled)this.dispatch('click');}
 focus(){this.document.activeElement=this;}
 matches(selector){if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));if(selector.startsWith('#'))return this.id===selector.slice(1);const data=/^\[data-([a-z-]+)(?:="([^"]+)")?\]$/.exec(selector);if(data){const key=data[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());return key in this.dataset&&(data[2]===undefined||this.dataset[key]===data[2]);}return this.tagName.toLowerCase()===selector;}
 querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
const firstId='2026-11-01T12:30:00.000Z_11111111-1111-4111-8111-111111111111',secondId='2026-11-01T12:30:00.000Z_22222222-2222-4222-8222-222222222222';
const item=(overrides={})=>({id:firstId,text:'The permit question was useful.\nI would like a shorter answer.',category:'uncategorized',createdAt:'2026-11-01T12:30:00.000Z',user:'TestUser02',...overrides});
const page=(items=[item()],nextCursor=null)=>({items,nextCursor});
function harness({ready=true,monitoring=false}={}){
 const doc={documentElement:{lang:'en'},activeElement:null};doc.createElement=tag=>new Element(tag,doc);doc.head=doc.createElement('head');doc.body=doc.createElement('body');
 const listeners={},calls=[],registered=[];
 const win={addEventListener:(event,fn)=>(listeners[event]||=[]).push(fn),fetch:(...args)=>new Promise((resolve,reject)=>calls.push({args,resolve,reject}))};
 function readySettings(){win.PlanViewSettings={registerTab(id,label,panel,onSelect){const existing=registered.find(row=>row.id===id);if(existing)return existing;const button=doc.createElement('button');button.textContent=label;panel.id=`workspace-${id}`;panel.hidden=true;doc.body.append(panel);const entry={id,button,panel,onSelect};registered.push(entry);return entry;}};for(const fn of listeners['planview-settings-ready']||[])fn();}
 if(ready)readySettings();if(monitoring)mountAdminMonitoring({window:win,document:doc});
 const api=mountAdminFeedback({window:win,document:doc});
 const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
 return {doc,win,calls,registered,api,get:control=>api.panel.querySelector(`[data-feedback-control="${control}"]`),readySettings,settle,
  open(id='test-feedback'){for(const entry of registered)entry.panel.hidden=entry.id!==id;registered.find(entry=>entry.id===id).onSelect();},
  async response(data=page(),status=200,index=calls.length-1){calls[index].resolve({ok:status>=200&&status<300,status,json:async()=>data});await settle();},
  translate(lang){doc.documentElement.lang=lang;for(const fn of listeners['planview-language-change']||[])fn();},
  choose(id,category){const select=api.panel.querySelector(`[data-feedback-control="category-${id}"]`);select.value=category;select.dispatch('change');},
 };
}
test('owner feedback registers once beside Monitoring and loads only when its tab opens',async()=>{
 const h=harness({ready:false,monitoring:true});assert.equal(h.calls.length,0);assert.equal(h.registered.length,0);h.readySettings();assert.deepEqual(h.registered.map(entry=>entry.id),['monitoring','test-feedback']);
 assert.equal(mountAdminFeedback({window:h.win,document:h.doc}),h.api);assert.equal(h.registered.length,2);assert.equal(h.calls.length,0);
 h.open();h.open();assert.equal(h.calls.length,1);assert.equal(h.registered[0].panel.hidden,true);assert.equal(h.calls[0].args[0],'/api/admin/feedback');assert.equal(h.calls[0].args[1].method,'GET');assert.equal(h.calls[0].args[1].cache,'no-store');
 await h.response();h.open();assert.equal(h.calls.length,1,'reopening does not poll or reload automatically');assert.match(h.api.panel.textContent,/Latest feedback loaded/);
});
test('stored feedback is displayed verbatim as text without executing HTML or leaking unlisted fields',async()=>{
 const h=harness();h.open();const text='<img src=x onerror="fetch(\'/secret\')">\n**A tester note** & <script>alert(1)</script>';
 await h.response(page([item({text,token:'PRIVATE TOKEN',email:'private@example.com',privateKey:'API-KEY'})]));
 assert.equal(h.api.panel.querySelector('.pv-feedback-text').textContent,text);assert.equal(h.api.panel.querySelectorAll('img').length,0);assert.equal(h.api.panel.querySelectorAll('script').length,0);assert.doesNotMatch(h.api.panel.textContent,/PRIVATE TOKEN|private@example|API-KEY/);assert.match(h.api.panel.textContent,/TestUser02/);
 const time=h.api.panel.querySelector('time');assert.equal(time.getAttribute('datetime'),'2026-11-01T12:30:00.000Z');assert.match(h.api.panel.textContent,/local time zone/);
});
test('pagination encodes the opaque cursor, deduplicates and keeps the loaded-category filter explicit',async()=>{
 const h=harness();h.open();await h.response(page([item()],'opaque+/cursor=1'));
 const filter=h.get('filter');filter.value='map';filter.dispatch('change');assert.match(h.api.panel.textContent,/No entries in this category/);assert.match(h.api.panel.textContent,/filter applies to the entries loaded below/);
 h.get('more').click();assert.equal(h.calls.at(-1).args[0],'/api/admin/feedback?cursor=opaque%2B%2Fcursor%3D1');assert.equal(h.get('more').disabled,true);
 await h.response(page([item(),item({id:secondId,text:'Map zoom could be smoother.',category:'map'})]));assert.equal(h.api.panel.querySelectorAll('.pv-feedback-card').length,1);assert.match(h.api.panel.textContent,/Map zoom could be smoother/);assert.equal(h.get('more'),null);
 h.get('filter').value='all';h.get('filter').dispatch('change');assert.equal(h.api.panel.querySelectorAll('.pv-feedback-card').length,2,'duplicate page receipts are not repeated');
});
test('category submission is explicit and failure preserves draft, tester text and retry',async()=>{
 const h=harness();h.open();await h.response();h.choose(firstId,'idea');assert.equal(h.calls.length,1);assert.equal(h.get(`save-${firstId}`).disabled,false);h.get(`save-${firstId}`).click();
 assert.equal(h.calls.length,2);assert.equal(h.calls[1].args[0],'/api/admin/feedback');assert.equal(h.calls[1].args[1].method,'POST');assert.deepEqual(JSON.parse(h.calls[1].args[1].body),{id:firstId,category:'idea'});assert.equal(h.get(`category-${firstId}`).disabled,true);
 await h.response({error:'private stack trace or provider key'},503);assert.equal(h.get(`category-${firstId}`).value,'idea');assert.equal(h.get(`save-${firstId}`).disabled,false);assert.match(h.api.panel.textContent,/Your selection is kept/);assert.match(h.api.panel.textContent,/The permit question was useful/);assert.doesNotMatch(h.api.panel.textContent,/private stack/);
 h.get(`save-${firstId}`).click();await h.response({ok:true,item:item({category:'idea'})});assert.match(h.api.panel.textContent,/Category saved/);assert.equal(h.get(`save-${firstId}`).disabled,true);
});
test('empty, forbidden and failed snapshots have clear states and preserve loaded items on retry',async()=>{
 const h=harness();h.open();await h.response({},403);assert.match(h.api.panel.textContent,/only to the administrator/);assert.equal(h.get('retry'),null);
 h.get('refresh').click();await h.response(page([]));assert.match(h.api.panel.textContent,/No feedback yet/);
 h.get('refresh').click();await h.response();h.get('refresh').click();h.calls.at(-1).reject(new Error('private failure detail'));await h.settle();assert.match(h.api.panel.textContent,/previously loaded feedback remains/);assert.match(h.api.panel.textContent,/The permit question was useful/);assert.doesNotMatch(h.api.panel.textContent,/private failure detail/);
 h.get('retry').click();await h.response(page([item({text:'New tester comment'})]));assert.match(h.api.panel.textContent,/New tester comment/);assert.doesNotMatch(h.api.panel.textContent,/The permit question was useful/);
});
test('category drafts survive refresh and 404 update explains reloading',async()=>{
 const h=harness();h.open();await h.response();h.choose(firstId,'rules');h.get('refresh').click();await h.response();assert.equal(h.get(`category-${firstId}`).value,'rules');
 h.get(`save-${firstId}`).click();await h.response({error:'feedback_not_found'},404);assert.match(h.api.panel.textContent,/no longer available/);assert.equal(h.get(`category-${firstId}`).value,'rules');
});
test('English, German and Dutch category labels follow app language and preserve focused selection',async()=>{
 const h=harness();h.open();await h.response();h.get('filter').focus();h.translate('de');assert.equal(h.registered[0].button.textContent,'Testnutzer-Feedback');assert.match(h.api.panel.textContent,/Ohne Kategorie/);assert.match(h.api.panel.textContent,/Bauanträge/);assert.equal(h.doc.activeElement,h.get('filter'));
 h.translate('nl');assert.equal(h.registered[0].button.textContent,'Feedback testgebruiker');assert.match(h.api.panel.textContent,/Vergunningen/);assert.match(h.api.panel.textContent,/Categorie opslaan/);
});
test('malformed feedback responses fail safely instead of displaying arbitrary data',async()=>{
 const h=harness();h.open();await h.response(page([item({category:'<script>'})]));assert.match(h.api.panel.textContent,/could not be loaded/);assert.equal(h.api.panel.querySelectorAll('.pv-feedback-card').length,0);
 h.get('retry').click();await h.response(page([item({user:'Attacker'})]));assert.match(h.api.panel.textContent,/could not be loaded/);assert.doesNotMatch(h.api.panel.textContent,/Attacker/);
 h.get('retry').click();await h.response(page([item({id:'11111111-1111-4111-8111-111111111111'})]));assert.match(h.api.panel.textContent,/could not be loaded/,'a bare submission UUID is not a persisted record ID');
 h.get('retry').click();await h.response(page([item({createdAt:'2026-11-02T12:30:00.000Z'})]));assert.match(h.api.panel.textContent,/could not be loaded/,'timestamp must match the server record ID');
});
const searchId='33333333-3333-4333-8333-333333333333';
const ratingItem=(overrides={})=>({id:firstId,searchId,kind:'rules',rating:'down',text:'The answer missed the height restriction.',outcome:'complete',resultCount:3,createdAt:'2026-11-01T12:30:00.000Z',user:'TestUser02',...overrides});
const section=(h,key)=>h.api.panel.querySelector(`[data-feedback-section="${key}"]`);
const ratings=h=>h.api.panel.querySelector('.pv-search-ratings');
const ratingControl=(h,key)=>ratings(h).querySelector(`[data-rating-control="${key}"]`);
test('search-rating section is lazy, reuses loaded pages and preserves general-note drafts while switching',async()=>{
 const h=harness();assert.equal(h.calls.length,0);h.open();await h.response();h.choose(firstId,'map');
 const notes=h.api.panel.querySelector('.pv-feedback-notes'),draft=h.get(`category-${firstId}`);
 section(h,'ratings').click();assert.equal(h.calls.length,2);assert.equal(h.calls[1].args[0],'/api/admin/search-feedback');assert.equal(h.calls[1].args[1].cache,'no-store');assert.equal(notes.hidden,true);assert.equal(ratings(h).hidden,false);assert.equal(section(h,'ratings').getAttribute('aria-pressed'),'true');
 await h.response(page([ratingItem()]));section(h,'notes').click();assert.equal(ratings(h).hidden,true);assert.equal(notes.hidden,false);assert.equal(h.get(`category-${firstId}`),draft,'switching does not recreate category editor');assert.equal(draft.value,'map');
 section(h,'ratings').click();h.open();assert.equal(h.calls.length,2,'switches and reopening do not poll');assert.equal(ratings(h).querySelectorAll('.pv-rating-card').length,1);
});
test('an ongoing category save survives switching to search ratings without taking focus',async()=>{
 const h=harness();h.open();await h.response();h.choose(firstId,'idea');h.get(`save-${firstId}`).click();const saveCall=h.calls.length-1;
 section(h,'ratings').focus();section(h,'ratings').click();const active=h.doc.activeElement;
 await h.response({ok:true,item:item({category:'idea'})},200,saveCall);assert.equal(h.doc.activeElement,active);assert.equal(ratings(h).hidden,false);
 await h.response(page([ratingItem()]));section(h,'notes').click();assert.equal(h.get(`category-${firstId}`).value,'idea');assert.match(h.api.panel.querySelector('.pv-feedback-notes').textContent,/Category saved/);
});
test('rating cards safely show satisfaction, search kind, date and optional reason with result details collapsed',async()=>{
 const h=harness();section(h,'ratings').click();const text='<img src=x onerror="fetch(\'/secret\')"> **Answer incomplete**';
 await h.response(page([ratingItem({text,prompt:'SECRET PROMPT',address:'PRIVATE ADDRESS',token:'API-KEY'})]));
 const p=ratings(h);assert.equal(p.querySelector('.pv-rating-reason').textContent,text);assert.equal(p.querySelectorAll('img').length,0);assert.match(p.textContent,/Dissatisfied/);assert.match(p.textContent,/Rules/);assert.match(p.textContent,/Complete/);assert.match(p.textContent,/Results3/);assert.match(p.textContent,/Search reference33333333/);assert.doesNotMatch(p.textContent,/SECRET PROMPT|PRIVATE ADDRESS|API-KEY/);assert.equal(p.querySelector('details').open,false);assert.equal(p.querySelector('time').getAttribute('datetime'),'2026-11-01T12:30:00.000Z');
 p.querySelector('details').open=true;p.querySelector('details').dispatch('toggle');ratingControl(h,'refresh').click();await h.response(page([ratingItem({text:'',rating:'up',resultCount:null,outcome:'partial'})]));assert.equal(p.querySelector('details').open,true,'refresh preserves expanded result metadata');assert.equal(p.querySelector('.pv-rating-reason'),null);assert.match(p.textContent,/Satisfied/);assert.match(p.textContent,/Not recorded/);
});
test('rating filter affects only loaded records, pagination is encoded and retries retain older ratings',async()=>{
 const h=harness();section(h,'ratings').click();await h.response(page([ratingItem()],'opaque+/cursor=1'));
 const filter=ratingControl(h,'filter');filter.focus();filter.value='up';filter.dispatch('change');assert.match(ratings(h).textContent,/No matching ratings/);assert.equal(h.doc.activeElement,ratingControl(h,'filter'));assert.match(ratings(h).textContent,/Filter applies to loaded ratings/);
 ratingControl(h,'more').click();assert.equal(h.calls.at(-1).args[0],'/api/admin/search-feedback?cursor=opaque%2B%2Fcursor%3D1');await h.response({error:'private provider error'},503);assert.match(ratings(h).textContent,/Previously loaded search ratings remain/);assert.doesNotMatch(ratings(h).textContent,/private provider error/);
 ratingControl(h,'retry').click();assert.match(h.calls.at(-1).args[0],/cursor=opaque%2B%2Fcursor%3D1/);await h.response(page([ratingItem(),ratingItem({id:secondId,rating:'up',kind:'sites',text:'',outcome:'empty',resultCount:0})]));assert.equal(ratings(h).querySelectorAll('.pv-rating-card').length,1);assert.equal(ratingControl(h,'more'),null);assert.match(ratings(h).textContent,/Loaded ratings: 2 · Satisfied: 1 · Dissatisfied: 1/);
 ratingControl(h,'filter').value='all';ratingControl(h,'filter').dispatch('change');assert.equal(ratings(h).querySelectorAll('.pv-rating-card').length,2,'duplicate pages are merged by record ID');assert.match(ratings(h).textContent,/Find sites/);assert.match(ratings(h).textContent,/No results/);
});
test('search-rating loading, empty, forbidden and invalid states are separate from general feedback',async()=>{
 const h=harness();section(h,'ratings').click();assert.match(ratings(h).textContent,/Loading search ratings/);await h.response({},403);assert.match(ratings(h).textContent,/only to the administrator/);assert.equal(ratingControl(h,'retry'),null);
 ratingControl(h,'refresh').click();await h.response(page([]));assert.match(ratings(h).textContent,/No search ratings yet/);
 ratingControl(h,'refresh').click();await h.response(page([ratingItem({kind:'<script>'})]));assert.match(ratings(h).textContent,/Previously loaded search ratings remain/);assert.equal(ratings(h).querySelectorAll('.pv-rating-card').length,0);
 ratingControl(h,'retry').click();await h.response(page([ratingItem({createdAt:'2026-11-02T12:30:00.000Z'})]));assert.match(ratings(h).textContent,/Previously loaded search ratings remain/);
 section(h,'notes').click();assert.equal(h.calls.at(-1).args[0],'/api/admin/feedback');await h.response();assert.match(h.api.panel.querySelector('.pv-feedback-notes').textContent,/The permit question was useful/);
});
test('ratings and section controls translate to German and Dutch without losing active filter or loaded records',async()=>{
 const h=harness();section(h,'ratings').click();await h.response(page([ratingItem({kind:'permits',outcome:'error',resultCount:null})]));
 ratingControl(h,'filter').value='down';ratingControl(h,'filter').dispatch('change');ratingControl(h,'filter').focus();h.translate('de');
 assert.equal(section(h,'notes').textContent,'Allgemeine Hinweise');assert.equal(section(h,'ratings').textContent,'Suchbewertungen');assert.match(ratings(h).textContent,/Unzufrieden/);assert.match(ratings(h).textContent,/Bauanträge/);assert.match(ratings(h).textContent,/Fehlgeschlagen/);assert.equal(ratingControl(h,'filter').value,'down');assert.equal(h.doc.activeElement,ratingControl(h,'filter'));
 h.translate('nl');assert.equal(section(h,'notes').textContent,'Algemene opmerkingen');assert.match(ratings(h).textContent,/Vergunninghistorie/);assert.match(ratings(h).textContent,/Ontevreden/);assert.equal(h.calls.length,1);
});
