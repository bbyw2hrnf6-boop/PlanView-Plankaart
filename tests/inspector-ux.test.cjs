const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = file => fs.readFileSync(path.join(__dirname,'..',file),'utf8');
class Element {
  constructor(){this.events={};this.attrs={};this.value='';this.hidden=true;this.innerHTML='';this.options=[];}
  addEventListener(name,callback){(this.events[name] ||= []).push(callback);}
  dispatch(name,extra={}){const event={key:'',preventDefault(){},stopImmediatePropagation(){},...extra};for(const callback of this.events[name]||[])callback(event);}
  setAttribute(name,value){this.attrs[name]=value;}
  removeAttribute(name){delete this.attrs[name];}
  replaceChildren(){this.innerHTML='';}
  querySelectorAll(){return this.options;}
  querySelector(){return this.options[0];}
  scrollIntoView(){}
}
function searchHarness(){
  const input=new Element(),box=new Element(),timers=new Map(),calls=[];let sequence=0;
  const context={AbortController,Event,esc:s=>s,state:{searchResults:[]},document:{documentElement:{lang:'en'},getElementById:id=>id==='search'?input:box,addEventListener(){}},setTimeout:fn=>{timers.set(++sequence,fn);return sequence;},clearTimeout:id=>timers.delete(id),searchOfficial:(query,signal)=>new Promise((resolve,reject)=>calls.push({query,signal,resolve,reject})),chooseSearch(){}};
  const code=source('app.js');vm.runInNewContext(code.slice(code.indexOf('function initSearch(){'),code.indexOf('\nfunction chooseSearch'))+';initSearch();',context);
  return {input,box,calls,context,runTimer(){const [id,callback]=timers.entries().next().value;timers.delete(id);return callback();}};
}
test('An address response cannot overwrite a new query during the debounce window',async()=>{
  const h=searchHarness();h.input.value='Maastricht';h.input.dispatch('input');const old=h.runTimer();
  h.input.value='Eindhoven';h.input.dispatch('input');assert.equal(h.calls[0].signal.aborted,true);
  h.calls[0].resolve([{name:'Old Maastricht',type:'gemeente'}]);await old;
  assert.equal(h.box.hidden,true);assert.equal(h.box.innerHTML,'');assert.equal(h.context.state.searchResults.length,0);
  const next=h.runTimer();h.calls[1].resolve([{name:'New Eindhoven',type:'gemeente'}]);await next;assert.match(h.box.innerHTML,/New Eindhoven/);assert.doesNotMatch(h.box.innerHTML,/Maastricht/);
});
test('Short queries, Escape and stale errors do not reopen or replace address results',async()=>{
  for(const action of ['short','escape']){const h=searchHarness();h.input.value='Maastricht';h.input.dispatch('input');const pending=h.runTimer();if(action==='short'){h.input.value='Ma';h.input.dispatch('input');}else h.input.dispatch('keydown',{key:'Escape'});h.calls[0].reject(new Error('late failure'));await pending;assert.equal(h.box.hidden,true);assert.doesNotMatch(h.box.innerHTML,/unavailable/);}
});
test('ArrowUp begins at the final address suggestion, ArrowDown at the first',()=>{
  for(const [key,wanted] of [['ArrowUp',2],['ArrowDown',0]]){
    const input=new Element(),list=new Element();list.hidden=false;list.options=[0,1,2].map(i=>Object.assign(new Element(),{id:`location-option-${i}`}));
    const context={$:id=>id==='search'?input:list,MutationObserver:class{observe(){}},document:{}};const code=source('workspace-ui.js');const start=code.indexOf('  function improveDirectSearch()');const end=code.indexOf("\n  window.addEventListener('load'",start);
    vm.runInNewContext(code.slice(start,end)+';improveDirectSearch();',context);input.dispatch('keydown',{key});assert.equal(input.attrs['aria-activedescendant'],`location-option-${wanted}`);assert.equal(list.options[wanted].attrs['aria-selected'],'true');
  }
});
test('Explicit shared-note updates preserve a different saved note once, not every keystroke',()=>{
  const saved={lat:50.85,lng:5.69,notes:'Saved inspection note'},compare={lat:50.85,lng:5.69,notes:'Legacy comparison snapshot'};const events=[];let writes=0;
  const context={state:{saved:[saved]},ui:{compare:[compare]},samePoint:(a,b)=>a.lat===b.lat&&a.lng===b.lng,persistSaved:()=>writes++,writeStorage(){},window:{dispatchEvent:event=>events.push(event.detail)},CustomEvent:class{constructor(name,options){this.detail=options.detail;}}};
  const code=source('interface.js');vm.runInNewContext(code.slice(code.indexOf('  function getSharedNote'),code.indexOf('  function noteArchive'))+';this.update=setSharedNote;this.read=getSharedNote;',context);
  assert.equal(context.read(saved),'Saved inspection note');assert.equal(writes,0);
  context.update(saved,'Shared',{source:'comparison'});context.update(saved,'Shared draft',{source:'comparison'});
  assert.equal(saved.notes,'Shared draft');assert.equal(compare.notes,'Shared draft');assert.equal(saved.notesHistory.length,1);assert.equal(saved.notesHistory[0].text,'Saved inspection note');assert.equal(events[1].source,'comparison');
  context.update(saved,'Saved follow-up',{source:'saved'});assert.equal(saved.notesHistory.length,2);assert.equal(saved.notesHistory[1].text,'Shared draft');
});
test('Rule refresh retains visible original passages until the new answer arrives',()=>{
  const widgets={};for(const selector of ['textarea','[type="submit"]','.pv-rules-cancel','.pv-rules-status','.pv-rules-results','.pv-rules-progress','.pv-rules-previous'])widgets[selector]=Object.assign(new Element(),{classList:{toggle(){}},textContent:''});
  const results=widgets['.pv-rules-results'];let replacements=0,appends=0;results.replaceChildren=()=>replacements++;results.append=()=>appends++;
  const model={node:{querySelector:selector=>widgets[selector],setAttribute(){}},query:'May I build a pool?',responseQuery:'May I build a shed?',response:{sources:[{id:'1'}]},loading:false,error:''};
  const context={model,tr:en=>en,sourceList:r=>r.sources,resultView:r=>r};const code=source('rules-search.js');vm.runInNewContext(code.slice(code.indexOf('  function paintResults()'),code.indexOf('  function mount('))+';this.paint=paintResults;',context);
  context.paint();assert.equal(replacements,1);assert.equal(appends,1);model.loading=true;context.paint();assert.equal(replacements,1);assert.equal(appends,1);assert.match(widgets['.pv-rules-previous'].textContent,/May I build a shed/);assert.match(widgets['.pv-rules-previous'].textContent,/New question/);assert.equal(widgets['.pv-rules-progress'].hidden,false);
  model.loading=false;model.response={sources:[{id:'2'}]};model.responseQuery=model.query;context.paint();assert.equal(replacements,2);assert.equal(widgets['.pv-rules-progress'].hidden,true);assert.match(widgets['.pv-rules-previous'].textContent,/May I build a pool/);
});
test('Fixed rule diagnostics translate without altering official document names or unknown source wording',()=>{
  const code=source('rules-search.js');const context={text:v=>typeof v==='string'?v:'',tr:(en,nl,de)=>de};vm.runInNewContext(code.slice(code.indexOf('  function diagnosticText'),code.indexOf('  function safeURL'))+';this.translate=diagnosticText;this.warning=warningText;',context);
  assert.equal(context.translate('Only the clicked point is checked; applicability across an entire parcel is not established.'),'Nur der angeklickte Punkt wird geprüft; die Geltung für das gesamte Flurstück ist nicht festgestellt.');
  assert.equal(context.translate('Omgevingsplan Maastricht: 7 referenced components or broad sections were not expanded.'),'Omgevingsplan Maastricht: 7 referenzierte Bestandteile oder übergreifende Abschnitte wurden nicht aufgelöst.');
  assert.equal(context.translate('Omgevingsplan Maastricht: Official request failed (503).'),'Omgevingsplan Maastricht: Amtliche Anfrage fehlgeschlagen (503).');
  assert.equal(context.translate('2 applicable regulations were omitted by the document retrieval limit.'),'2 anwendbare Regelungen wurden wegen der Dokumentabrufgrenze ausgelassen.');
  assert.equal(context.translate('De bouwhoogte bedraagt ten hoogste 5 meter.'),'De bouwhoogte bedraagt ten hoogste 5 meter.');
  assert.equal(context.translate('A new diagnostic with details not known by this client.'),'A new diagnostic with details not known by this client.');
  assert.match(context.warning({message:'Ranked excerpts; cross-references and the whole parcel are not exhaustively assessed.'}),/nicht vollständig geprüft/);
  assert.match(context.translate('The clicked PDOK IMRO source may contain transitional planning rules outside this DSO text corpus: NL.IMRO.0935.bp01-VA01'),/Übergangsplanregeln.*NL.IMRO.0935.bp01-VA01$/);
});
test('Incomplete coverage appears before the generated answer and every diagnostic remains available',()=>{
  class Node{constructor(tag,cls='',content){this.tag=tag;this.className=cls;this.textContent=content;this.childNodes=[];}append(...nodes){this.childNodes.push(...nodes);}setAttribute(){}addEventListener(){}}
  const context={tr:(en,nl,de)=>de,text:v=>typeof v==='string'?v:'',el:(...args)=>new Node(...args),document:{createDocumentFragment:()=>new Node('fragment'),getElementById:()=>null},sourceList:r=>r.sources,sourceView:(item)=>new Node('blockquote','original',item.text),model:{}};
  const code=source('rules-search.js');vm.runInNewContext(code.slice(code.indexOf('  function diagnosticText'),code.indexOf('  function safeURL'))+code.slice(code.indexOf('  function count('),code.indexOf('  function sourceView('))+code.slice(code.indexOf('  function resultView('),code.indexOf('  function paintResults('))+';this.render=resultView;',context);
  const warnings=Array.from({length:24},(_,i)=>`Amtliches Dokument ${i}: Some rules refer to external legislation, information objects or attachments that were not retrieved.`);
  const tree=context.render({state:'answered',coverage:{complete:false,documentsChecked:10,documentsAvailable:12,warnings,limits:['Only the clicked point is checked; applicability across an entire parcel is not established.']},sources:[{id:'1',text:'Nederlandse originele regeltekst'}],answer:{summary:'Einordnung mit Beleg',citations:['1']}});
  assert.match(tree.childNodes[0].className,/pv-rules-coverage-partial/);assert.match(tree.childNodes[0].childNodes[0].textContent,/10 \/ 12 Dokumente geprüft.*Quellenlage unvollständig/);assert.equal(tree.childNodes[1].className,'pv-rules-answer');
  const diagnostics=tree.childNodes[0].childNodes.find(n=>n.tag==='details');assert.equal(diagnostics.childNodes.length,25);assert.match(diagnostics.childNodes[24].textContent,/Amtliches Dokument 23:.*nicht abgerufen wurden/);assert.equal(tree.childNodes.at(-1).textContent,'Nederlandse originele regeltekst');
});
test('Selecting an address reaches its detail zoom despite immediate and late pane resizes',()=>{
  const map={zoom:7,center:[52,5],flight:null,stop(){this.flight=null;return this;},flyTo(center,zoom){this.flight={center,zoom};},setView(center,zoom){this.center=Array.from(center);this.zoom=zoom;return this;},invalidateSize(options){this.flight=null;if(!options.pan)this.center=[this.center[0],this.center[1]+.01];return this;}};
  const perspective={center:null,zoom:7,stop(){},jumpTo({center,zoom}){this.center=Array.from(center);this.zoom=zoom;},resize(){}};
  const input={dispatchEvent(){},value:''},list={hidden:false};const state={map,perspectiveMap:perspective,searchResults:[{lat:50.82409,lng:5.72416,name:'Reyckenborg 55 Maastricht'}]};
  const context={state,document:{getElementById:id=>id==='search'?input:list},Event,municipalityAt:()=>null,setMunicipalitySelection(){},selectPoint(){context.resize();},matchMedia:()=>({matches:false})};
  const app=source('app.js'),workspace=source('workspace-ui.js');vm.runInNewContext(app.slice(app.indexOf('function navigateToPoint('),app.indexOf('\nfunction mapOpacity('))+workspace.slice(workspace.indexOf('  function resizeWorkspaceMaps()'),workspace.indexOf('  function improveDirectSearch()'))+app.slice(app.indexOf('function chooseSearch('),app.indexOf('\nfunction wireControls('))+';this.choose=chooseSearch;this.resize=resizeWorkspaceMaps;',context);
  context.choose(0);assert.equal(map.zoom,17);assert.deepEqual(map.center,[50.82409,5.72416]);assert.deepEqual(perspective.center,[5.72416,50.82409]);
  context.resize();assert.equal(map.zoom,17);assert.deepEqual(map.center,[50.82409,5.72416]);
  map.center=[50.825,5.725];context.resize();assert.deepEqual(map.center,[50.825,5.725],'A later resize does not snap back over user movement');assert.equal(map.flight,null);
});
test('Reduced motion disables bounds navigation in both map engines',()=>{
  const options=[];const context={state:{map:{stop(){},fitBounds:(bounds,opts)=>options.push(opts)},perspectiveMap:{stop(){},fitBounds:(bounds,opts)=>options.push(opts)}},boundsOf:b=>b,matchMedia:()=>({matches:true})};const app=source('app.js');vm.runInNewContext(app.slice(app.indexOf('function navigateToBounds('),app.indexOf('\nfunction mapOpacity('))+';navigateToBounds([50.7,5.5,50.9,5.8]);',context);assert.equal(options[0].animate,false);assert.equal(options[1].duration,0);
});
