import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSearchFeedback} from '../firebase/browser/search-feedback.mjs';

class Element {
 constructor(tag,doc){this.tagName=tag.toUpperCase();this.document=doc;this.children=[];this.listeners={};this.attributes={};this.dataset={};this.hidden=false;this.disabled=false;this.readOnly=false;this.value='';this._text='';}
 append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
 set textContent(value){this._text=String(value);for(const node of this.children)node.parentNode=null;this.children=[];}
 get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
 setAttribute(key,value){this.attributes[key]=String(value);}
 getAttribute(key){return this.attributes[key];}
 addEventListener(name,fn){(this.listeners[name]||=[]).push(fn);}
 contains(node){return this===node||this.children.some(child=>child.contains(node));}
 dispatch(name,props={}){const event={target:this,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.propagationStopped=true;},...props};return {event,pending:(this.listeners[name]||[]).map(fn=>fn(event))};}
 click(){if(!this.disabled){this.focus();return this.dispatch('click');}}
 focus(){this.document.activeElement=this;}
 get isConnected(){return this===this.document.body||this===this.document.head||Boolean(this.parentNode?.isConnected);}
 find(predicate){if(predicate(this))return this;for(const child of this.children){const found=child.find(predicate);if(found)return found;}return null;}
 findAll(predicate){return [...(predicate(this)?[this]:[]),...this.children.flatMap(child=>child.findAll(predicate))];}
}
const ID1='21000000-0000-4000-8000-000000000001';
const ID2='21000000-0000-4000-8000-000000000002';
const ID3='21000000-0000-4000-8000-000000000003';
function harness(){
 const doc={documentElement:{lang:'en'}};doc.createElement=tag=>new Element(tag,doc);doc.createElementNS=(_namespace,tag)=>doc.createElement(tag);doc.head=doc.createElement('head');doc.body=doc.createElement('body');doc.activeElement=doc.body;
 const listeners={},calls=[],observers=[],timeouts=[],controllers=[];let ids=0;
 const win={
  crypto:{randomUUID:()=>`10000000-0000-4000-8000-${String(++ids).padStart(12,'0')}`},
  AbortSignal:{timeout(milliseconds){timeouts.push(milliseconds);const controller=new AbortController();controllers.push(controller);return controller.signal;}},
  addEventListener:(name,fn)=>(listeners[name]||=[]).push(fn),removeEventListener:(name,fn)=>listeners[name]=(listeners[name]||[]).filter(value=>value!==fn),
  fetch:(...args)=>new Promise((resolve,reject)=>{calls.push({args,resolve,reject});args[1]?.signal?.addEventListener('abort',()=>reject(args[1].signal.reason),{once:true});}),
  MutationObserver:class{constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this);}observe(target){this.target=target;}disconnect(){this.disconnected=true;}},
 };
 const api=mountSearchFeedback({window:win,document:doc});
 const h={doc,win,listeners,calls,api,observers,timeouts,controllers,
  host(){const host=doc.createElement('div');doc.body.append(host);return host;},
  event(detail){for(const fn of listeners['planview-search-feedback']||[])fn({detail});},
  start(kind='rules',searchId=ID1){this.event({phase:'started',kind,searchId});},
  complete({kind='rules',searchId=ID1,container=this.host(),outcome='complete',resultCount=3,...extra}={}){this.event({phase:'completed',kind,searchId,container,outcome,resultCount,...extra});return container;},
  clear(kind='rules',searchId){this.event({phase:'cleared',kind,...(searchId?{searchId}:{})});},
  rating(host){return host.find(node=>node.className==='pv-search-rating');},
  controls(host){const node=this.rating(host);return {node,up:node.find(el=>el.dataset.rating==='up'),down:node.find(el=>el.dataset.rating==='down'),input:node.find(el=>el.tagName==='TEXTAREA'),form:node.find(el=>el.className==='pv-rating-form'),send:node.find(el=>el.className==='pv-rating-send'),cancel:node.find(el=>el.className==='pv-rating-actions').children[0],retry:node.find(el=>el.className==='pv-rating-retry'),status:node.find(el=>el.className==='pv-rating-status')};},
  input(control,value){control.input.value=value;control.input.dispatch('input');},
  language(lang){doc.documentElement.lang=lang;for(const fn of listeners['planview-language-change']||[])fn();},
  async settle(){for(let i=0;i<10;i++)await Promise.resolve();},
  async respond(index=calls.length-1,{status=200,result={ok:true,id:'saved-rating',createdAt:'2026-11-01T16:00:00.000Z'}}={}){calls[index].resolve({status,ok:status<400,json:async()=>result});await this.settle();},
 };
 return h;
}

test('only valid completed current searches receive inline rating controls, without implicit fetch or focus changes',()=>{
 const h=harness(),host=h.host();h.start();assert.equal(h.rating(host),null);assert.equal(h.calls.length,0);
 for(const detail of [null,{phase:'completed',kind:'map',searchId:ID1,container:host,outcome:'complete',resultCount:1},{phase:'completed',kind:'rules',searchId:'bad',container:host,outcome:'complete',resultCount:1},{phase:'completed',kind:'rules',searchId:ID1,container:host,outcome:'cancelled',resultCount:1},{phase:'completed',kind:'rules',searchId:ID1,container:host,outcome:'complete',resultCount:-1},{phase:'completed',kind:'rules',searchId:ID1,outcome:'complete',resultCount:1}])h.event(detail);
 assert.equal(h.rating(host),null);h.complete({container:host});const c=h.controls(host);
 assert.equal(c.node.parentNode,host);assert.equal(c.form.hidden,true);assert.equal(c.input.maxLength,1500);assert.equal(c.up.getAttribute('aria-pressed'),'false');assert.equal(c.down.getAttribute('aria-expanded'),'false');assert.equal(c.node.getAttribute('role'),'group');assert.equal(c.status.getAttribute('aria-live'),'polite');assert.equal(h.doc.activeElement,h.doc.body);assert.equal(h.calls.length,0);
 assert.equal(mountSearchFeedback({window:h.win,document:h.doc}),h.api);
});

test('new searches retire previous same-kind ratings, stale completion/clear events are ignored, other kinds stay independent',()=>{
 const h=harness();h.start('rules',ID1);const first=h.complete();const old=h.rating(first);h.start('rules',ID2);assert.equal(old.isConnected,false);
 const stale=h.complete({searchId:ID1});assert.equal(h.rating(stale),null);h.clear('rules',ID1);
 const second=h.complete({searchId:ID2}),permits=h.complete({kind:'permits',searchId:ID3});assert.ok(h.rating(second));assert.ok(h.rating(permits));
 h.complete({searchId:ID2,container:second});assert.equal(second.findAll(node=>node.className==='pv-search-rating').length,1);
 h.clear('rules',ID2);assert.equal(h.rating(second),null);assert.ok(h.rating(permits));h.clear('permits');assert.equal(h.rating(permits),null);
});

test('a cleared search remains retired after late completion and a fresh search still becomes rateable',()=>{
 const h=harness();h.start('rules',ID1);const first=h.complete(),old=h.rating(first);h.clear('rules',ID1);assert.equal(old.isConnected,false);
 const stale=h.host();h.complete({container:stale,searchId:ID1});assert.equal(h.rating(stale),null,'the cleared search ID cannot resurrect its rating');
 const unrelated=h.host();h.complete({container:unrelated,searchId:ID2});assert.equal(h.rating(unrelated),null,'completion without a new start cannot bypass the cleared state');
 h.start('rules',ID2);const fresh=h.complete({searchId:ID2});assert.ok(h.rating(fresh));assert.equal(h.calls.length,0);
});

test('thumbs up submits once immediately with only approved metadata and no note, and final success stays disabled',async()=>{
 const h=harness(),host=h.complete({kind:'sites',outcome:'empty',resultCount:0}),c=h.controls(host);
 c.up.click();c.up.click();c.down.click();assert.equal(h.calls.length,1);assert.equal(c.form.hidden,true);assert.equal(c.up.disabled,true);assert.equal(c.down.disabled,true);assert.equal(c.node.getAttribute('aria-busy'),'true');
 const [url,options]=h.calls[0].args;assert.equal(url,'/api/search-feedback');assert.equal(options.method,'POST');assert.equal(options.headers['Content-Type'],'application/json');
 const value=JSON.parse(options.body);assert.deepEqual(value,{searchId:ID1,submissionId:'10000000-0000-4000-8000-000000000001',kind:'sites',rating:'up',text:'',outcome:'empty',resultCount:0});
 await h.respond();assert.match(c.status.textContent,/rating is saved/);assert.equal(c.up.disabled,true);assert.equal(c.down.disabled,true);assert.equal(c.node.getAttribute('aria-busy'),'false');c.up.click();assert.equal(h.calls.length,1);
});

test('thumbs down opens an optional authored note, sends explicitly, safely preserves plain text, and never captures extra event context',async()=>{
 const h=harness(),host=h.complete({kind:'permits',outcome:'partial',resultCount:2,query:'private question',address:'private address',sourceText:'private result'}),c=h.controls(host);
 c.down.click();assert.equal(c.form.hidden,false);assert.equal(c.down.getAttribute('aria-expanded'),'true');assert.equal(h.doc.activeElement,c.input);assert.equal(h.calls.length,0);
 h.input(c,'  Missing <img src=x onerror=alert(1)> detail.  ');c.send.click();assert.equal(h.calls.length,1);assert.equal(c.input.disabled,true);
 assert.deepEqual(JSON.parse(h.calls[0].args[1].body),{searchId:ID1,submissionId:'10000000-0000-4000-8000-000000000001',kind:'permits',rating:'down',text:'Missing <img src=x onerror=alert(1)> detail.',outcome:'partial',resultCount:2});
 assert.equal(c.node.find(node=>node.tagName==='IMG'),null);await h.respond();assert.equal(c.form.hidden,true);assert.equal(c.input.value,'');assert.match(c.status.textContent,/rating is saved/);
});

test('negative note is optional and cancel hides the local draft without submitting or discarding it',async()=>{
 const h=harness(),host=h.complete(),c=h.controls(host);c.down.click();h.input(c,'Keep this local draft.');c.cancel.click();assert.equal(c.form.hidden,true);assert.equal(h.calls.length,0);assert.equal(h.doc.activeElement,c.down);
 c.down.click();assert.equal(c.input.value,'Keep this local draft.');h.input(c,'');c.send.click();assert.equal(JSON.parse(h.calls[0].args[1].body).text,'');await h.respond();assert.match(c.status.textContent,/rating is saved/);
});

test('oversized notes stay editable without a request and keyboard shortcuts submit or cancel explicitly',async()=>{
 const h=harness(),host=h.complete(),c=h.controls(host);c.down.click();h.input(c,'x'.repeat(1501));c.send.click();assert.equal(h.calls.length,0);assert.equal(c.input.readOnly,false);assert.equal(c.input.getAttribute('aria-invalid'),'true');assert.match(c.status.textContent,/1,500/);
 h.input(c,'A valid draft.');const escaped=c.input.dispatch('keydown',{key:'Escape'}).event;assert.equal(escaped.defaultPrevented,true);assert.equal(c.form.hidden,true);assert.equal(h.calls.length,0);
 c.down.click();const enter=c.input.dispatch('keydown',{key:'Enter',ctrlKey:true}).event;assert.equal(enter.defaultPrevented,true);assert.equal(h.calls.length,1);await h.respond();assert.match(c.status.textContent,/rating is saved/);
});

test('uncertain 503 delivery locks the authored note and retries the identical payload and submission ID',async()=>{
 const h=harness(),host=h.complete(),c=h.controls(host);c.down.click();h.input(c,'The answer missed the garage.');c.send.click();const body=h.calls[0].args[1].body;
 await h.respond(0,{status:503});assert.equal(c.input.value,'The answer missed the garage.');assert.equal(c.input.disabled,false);assert.equal(c.input.readOnly,true);assert.equal(c.cancel.disabled,true);assert.equal(c.send.hidden,true);assert.equal(c.retry.hidden,false);assert.match(c.status.textContent,/could not be confirmed/);
 c.cancel.click();c.up.click();assert.equal(h.calls.length,1);assert.equal(c.form.hidden,false);c.retry.click();assert.equal(h.calls[1].args[1].body,body);await h.respond(1);assert.match(c.status.textContent,/rating is saved/);
});

test('twenty-second timeout and rejected network calls retain immutable retry bodies and recover from busy state',async()=>{
 for(const failure of ['timeout','network']){
  const h=harness(),host=h.complete(),c=h.controls(host);c.down.click();h.input(c,'Keep until confirmed.');c.send.click();const body=h.calls[0].args[1].body;assert.deepEqual(h.timeouts,[20_000]);
  if(failure==='timeout')h.controllers[0].abort(new DOMException('private timeout detail','TimeoutError'));else h.calls[0].reject(Error('private connection detail'));await h.settle();
  assert.equal(c.node.getAttribute('aria-busy'),'false');assert.equal(c.input.value,'Keep until confirmed.');assert.equal(c.input.readOnly,true);assert.doesNotMatch(c.status.textContent,/private/);c.retry.click();assert.equal(h.calls[1].args[1].body,body);assert.deepEqual(h.timeouts,[20_000,20_000]);await h.respond(1);assert.match(c.status.textContent,/rating is saved/);
 }
});

test('malformed successful replies cannot clear drafts or finalize; same immutable rating can be retried',async()=>{
 for(const result of [{ok:false,error:'private internals'},{ok:true},{ok:true,id:''}]){
  const h=harness(),host=h.complete(),c=h.controls(host);c.down.click();h.input(c,'Keep this note.');c.send.click();const body=h.calls[0].args[1].body;await h.respond(0,{result});
  assert.equal(c.input.value,'Keep this note.');assert.equal(c.input.readOnly,true);assert.equal(c.up.disabled,true);assert.match(c.status.textContent,/could not be confirmed/);assert.doesNotMatch(c.status.textContent,/private internals/);c.retry.click();assert.equal(h.calls[1].args[1].body,body);await h.respond(1);assert.match(c.status.textContent,/rating is saved/);
 }
});

test('definite 400 and 429 errors retain editable drafts and a changed resubmission receives a new ID',async()=>{
 for(const status of [400,429]){
  const h=harness(),host=h.complete(),c=h.controls(host);c.down.click();h.input(c,'First explanation');c.send.click();const first=JSON.parse(h.calls[0].args[1].body);await h.respond(0,{status});
  assert.equal(c.input.readOnly,false);assert.equal(c.input.disabled,false);assert.equal(c.cancel.disabled,false);assert.equal(c.input.value,'First explanation');assert.equal(c.send.hidden,false);assert.match(c.status.textContent,status===400?/check your note/:/wait a little/);
  h.input(c,'Edited explanation');c.send.click();const second=JSON.parse(h.calls[1].args[1].body);assert.notEqual(second.submissionId,first.submissionId);assert.equal(second.text,'Edited explanation');await h.respond(1);assert.match(c.status.textContent,/rating is saved/);
 }
});

test('409 already-rated finalizes without clearing or resending the original search rating',async()=>{
 const h=harness(),host=h.complete(),c=h.controls(host);c.down.click();h.input(c,'Possible earlier delivery');c.send.click();await h.respond(0,{status:409});assert.match(c.status.textContent,/already been rated/);assert.equal(c.form.hidden,true);assert.equal(c.up.disabled,true);assert.equal(c.down.disabled,true);assert.equal(c.retry.hidden,true);c.up.click();c.down.click();assert.equal(h.calls.length,1);
});

test('same-ID language host rebind preserves draft, busy state and eventual result while observers follow the current host',async()=>{
 const h=harness(),first=h.complete(),c=h.controls(first);c.down.click();h.input(c,'Keep through translation');h.language('de');const second=h.host();h.complete({container:second});assert.equal(h.rating(first),null);assert.equal(h.rating(second),c.node);assert.equal(c.input.value,'Keep through translation');assert.match(c.node.textContent,/War diese Suche hilfreich/);
 c.send.click();const third=h.host();h.language('nl');h.complete({container:third});assert.equal(h.rating(second),null);assert.equal(h.rating(third),c.node);assert.equal(c.input.disabled,true);assert.match(c.status.textContent,/Opslaan/);assert.equal(h.calls.length,1);
 await h.respond();assert.match(c.status.textContent,/je beoordeling is opgeslagen/);assert.equal(c.up.disabled,true);assert.equal(c.down.disabled,true);assert.ok(h.observers.slice(0,-1).every(observer=>observer.disconnected));
 const last=h.observers.at(-1);c.node.remove();last.callback();assert.equal(c.node.parentNode,third,'host content rerender restores the current rating');
});

test('completion, translation and late submissions never steal focus or resurrect a retired search',async()=>{
 const h=harness(),host=h.complete(),c=h.controls(host);c.down.click();h.input(c,'A quick explanation');c.send.click();const other=h.doc.createElement('button');h.doc.body.append(other);other.focus();h.language('de');const second=h.host();h.complete({container:second});assert.equal(h.doc.activeElement,other);
 h.start('rules',ID2);const newer=h.complete({searchId:ID2});await h.respond();assert.equal(c.node.isConnected,false);assert.ok(h.rating(newer));assert.equal(h.doc.activeElement,other);assert.equal(h.rating(second),null);
});

test('destroy removes all nodes, observers and lifecycle listeners, prevents late redraws and allows clean remount',async()=>{
 const h=harness(),host=h.complete(),c=h.controls(host);c.up.click();const before=c.status.textContent;h.api.destroy();assert.equal(c.node.isConnected,false);assert.equal(h.doc.head.children.length,0);assert.equal(h.win.__planviewSearchFeedback,undefined);assert.equal(h.listeners['planview-search-feedback'].length,0);assert.equal(h.listeners['planview-language-change'].length,0);assert.ok(h.observers.every(observer=>observer.disconnected));
 h.complete({searchId:ID2,container:host});h.language('de');await h.respond();assert.equal(h.rating(host),null);assert.equal(c.status.textContent,before);assert.equal(h.calls.length,1);h.api.destroy();
 const remounted=mountSearchFeedback({window:h.win,document:h.doc});assert.notEqual(remounted,h.api);assert.equal(h.listeners['planview-search-feedback'].length,1);remounted.destroy();
});
