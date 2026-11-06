import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountTestFeedback} from '../firebase/browser/test-feedback.mjs';

class Element{
 constructor(tag,doc){this.tagName=tag.toUpperCase();this.document=doc;this.children=[];this.listeners={};this.attributes={};this.hidden=false;this.disabled=false;this.value='';this._text='';this.open=false;this.style={values:{},setProperty(key,value){this.values[key]=value;}};}
 append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
 setAttribute(key,value){this.attributes[key]=String(value);}
 getAttribute(key){return this.attributes[key];}
 addEventListener(name,fn){(this.listeners[name]||=[]).push(fn);}
 contains(node){return this===node||this.children.some(child=>child.contains(node));}
 dispatch(name,props={}){const event={target:this,preventDefault(){this.defaultPrevented=true;},...props};const pending=(this.listeners[name]||[]).map(fn=>fn(event));return {event,pending};}
 click(){if(!this.disabled){this.focus();return this.dispatch('click');}}
 focus(){this.document.activeElement=this;}
 getBoundingClientRect(){return {bottom:136};}
 show(){this.open=true;}
 close(){this.open=false;}
 get isConnected(){return this===this.document.body||this===this.document.head||Boolean(this.parentNode?.isConnected);}
 find(predicate){if(predicate(this))return this;for(const child of this.children){const result=child.find(predicate);if(result)return result;}return null;}
}
function harness(){
 const doc={documentElement:{lang:'en',clientHeight:800}};doc.createElement=tag=>new Element(tag,doc);doc.head=doc.createElement('head');doc.body=doc.createElement('body');doc.activeElement=doc.body;doc.getElementById=id=>doc.body.find(node=>node.id===id);
 const tools=doc.createElement('div');tools.id='pv-firebase-account-header';const slot=doc.createElement('div');slot.id='pv-firebase-feedback-slot';const account=doc.createElement('button');account.id='pv-firebase-account';account.textContent='TestUser02';tools.append(slot,account);doc.body.append(tools);
 const docListeners={};doc.addEventListener=(name,fn)=>(docListeners[name]||=[]).push(fn);doc.removeEventListener=(name,fn)=>docListeners[name]=(docListeners[name]||[]).filter(value=>value!==fn);
 const listeners={},viewportListeners={},calls=[],timers=new Map();let ids=0,timerId=0;
 const viewport={offsetTop:0,height:800,addEventListener:(name,fn)=>(viewportListeners[name]||=[]).push(fn),removeEventListener:(name,fn)=>viewportListeners[name]=(viewportListeners[name]||[]).filter(value=>value!==fn)};
 const win={innerHeight:800,visualViewport:viewport,setTimeout:(callback,delay)=>{timers.set(++timerId,{callback,delay});return timerId;},clearTimeout:id=>timers.delete(id),crypto:{randomUUID:()=>`10000000-0000-4000-8000-${String(++ids).padStart(12,'0')}`},addEventListener:(name,fn)=>(listeners[name]||=[]).push(fn),removeEventListener:(name,fn)=>listeners[name]=(listeners[name]||[]).filter(value=>value!==fn),fetch:(...args)=>new Promise((resolve,reject)=>{calls.push({args,resolve,reject});const signal=args[1]?.signal;signal?.addEventListener('abort',()=>reject(signal.reason),{once:true});})};
 const api=mountTestFeedback({container:slot,window:win,document:doc});
 const get=tag=>api.dialog.find(node=>node.tagName===tag.toUpperCase());
 const textarea=get('textarea'),select=get('select'),form=get('form');
 const buttons=()=>api.dialog.find(node=>node.tagName==='FORM').children.at(-1).children;
 const h={doc,win,tools,slot,account,calls,api,textarea,select,form,buttons,timers,
  outside(target=doc.body){for(const fn of docListeners.pointerdown||[])fn({target});},
  key(key,props={}){const event={key,target:doc.activeElement,preventDefault(){this.defaultPrevented=true;},...props};for(const fn of docListeners.keydown||[])fn(event);return {event};},
  advance(){for(const [id,{callback}] of [...timers]){timers.delete(id);callback();}},
  viewport(height,offsetTop=0){viewport.height=height;viewport.offsetTop=offsetTop;for(const fn of viewportListeners.resize||[])fn();},
  input(value){textarea.value=value;textarea.dispatch('input');},category(value){select.value=value;select.dispatch('change');},
  submit(){return form.dispatch('submit').pending[0];},
  async settle(){for(let i=0;i<8;i++)await Promise.resolve();},
  async respond(index=calls.length-1,{status=200,result={ok:true,id:'saved-note',createdAt:'2026-11-01T16:00:00.000Z'}}={}){calls[index].resolve({status,ok:status<400,json:async()=>result});await this.settle();},
  language(lang){doc.documentElement.lang=lang;for(const fn of listeners['planview-language-change']||[])fn();},
 };
 return h;
}

test('header feedback slot owns its purple button and anchored nonmodal panel, without moving the account or fetching context',()=>{
 const h=harness();assert.equal(h.calls.length,0);assert.match(h.api.button.textContent,/Feedback/);assert.equal(h.account.parentNode,h.tools);assert.equal(h.api.button.parentNode.parentNode,h.slot);assert.equal(h.api.button.getAttribute('aria-haspopup'),'dialog');assert.equal(h.api.button.getAttribute('aria-expanded'),'false');assert.equal(h.api.dialog.getAttribute('aria-labelledby'),'pv-firebase-feedback-title');assert.equal(h.api.dialog.getAttribute('aria-modal'),'false');
 assert.equal(mountTestFeedback({container:h.slot,window:h.win,document:h.doc}),h.api);
 h.api.button.click();assert.equal(h.api.dialog.open,true);assert.equal(h.api.button.getAttribute('aria-expanded'),'true');assert.equal(h.doc.activeElement,h.textarea);assert.match(h.api.dialog.textContent,/No page or location details are added automatically/);assert.match(h.api.dialog.textContent,/does not use your AI allowance/);
 assert.equal(h.select.value,'uncategorized');assert.equal(h.textarea.maxLength,3000);assert.equal(h.textarea.required,true);
 h.api.button.click();assert.equal(h.api.dialog.open,false);assert.equal(h.api.button.getAttribute('aria-expanded'),'false');
});

test('entry and hover gestures are finite, reduced motion is respected, and the panel has no modal backdrop',()=>{
 const source=readFileSync(new URL('../firebase/browser/test-feedback.mjs',import.meta.url),'utf8');
 assert.match(source,/pv-feedback-hello 850ms ease-out 500ms 1/);assert.match(source,/pv-feedback-wave 550ms ease-out 1/);assert.match(source,/prefers-reduced-motion:reduce/);assert.match(source,/animation:none!important;transition:none!important/);
 assert.doesNotMatch(source,/infinite|showModal|::backdrop|pv-firebase-test-actions|pv-firebase-test-tools/);assert.match(source,/width:min\(380px,calc\(100vw - 24px\)\)/);assert.match(source,/max-height:var\(--pv-feedback-max-height/);
});

test('empty and oversized drafts remain editable and never reach the server',async()=>{
 const h=harness();h.api.open();h.input('   \n');await h.submit();assert.equal(h.calls.length,0);assert.match(h.api.dialog.textContent,/short note first/);assert.equal(h.doc.activeElement,h.textarea);
 h.input('x'.repeat(3001));await h.submit();assert.equal(h.calls.length,0);assert.match(h.api.dialog.textContent,/within 3,000 characters/);assert.equal(h.textarea.value.length,3001);
});

test('explicit submission sends only text, optional category and UUID, prevents duplicates and thanks after confirmed storage',async()=>{
 const h=harness();h.api.button.click();h.input('  Search results are helpful. <img src=x onerror=alert(1)>  ');const waiting=h.submit();
 assert.equal(h.calls.length,1);assert.equal(h.textarea.disabled,true);assert.equal(h.select.disabled,true);assert.equal(h.buttons()[1].disabled,true);await h.submit();assert.equal(h.calls.length,1);
 const [url,options]=h.calls[0].args;assert.equal(url,'/api/feedback');assert.equal(options.method,'POST');const payload=JSON.parse(options.body);assert.deepEqual(Object.keys(payload).sort(),['category','submissionId','text']);assert.equal(payload.category,'uncategorized');assert.equal(payload.text,'Search results are helpful. <img src=x onerror=alert(1)>');assert.match(payload.submissionId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.equal(h.api.dialog.find(node=>node.tagName==='IMG'),null);await h.respond();await waiting;assert.equal(h.textarea.value,'');assert.equal(h.form.hidden,true);assert.match(h.api.dialog.textContent,/your feedback is saved/);assert.equal(h.doc.activeElement.textContent,'Close');
 assert.equal(h.timers.size,1);assert.equal([...h.timers.values()][0].delay,1200);h.advance();assert.equal(h.api.dialog.open,false);assert.equal(h.doc.activeElement,h.api.button);assert.match(h.slot.textContent,/your feedback is saved/);
 h.api.open();assert.equal(h.form.hidden,false);assert.equal(h.doc.activeElement,h.textarea);assert.equal(h.textarea.value,'');
});

test('network uncertainty preserves the draft across closing and retries with exactly the same ID and payload',async()=>{
 const h=harness();h.api.button.click();h.input('The permit search feels slow.');h.category('permits');const first=h.submit();const body=h.calls[0].args[1].body;h.calls[0].reject(new Error('private backend detail'));await first;
 assert.equal(h.textarea.value,'The permit search feels slow.');assert.match(h.api.dialog.textContent,/Could not confirm delivery/);assert.doesNotMatch(h.api.dialog.textContent,/private backend detail/);
 h.api.close();assert.equal(h.doc.activeElement,h.api.button);h.api.open();assert.equal(h.textarea.value,'The permit search feels slow.');assert.equal(h.select.value,'permits');const retry=h.submit();assert.equal(h.calls[1].args[1].body,body);await h.respond(1);await retry;assert.match(h.api.dialog.textContent,/feedback is saved/);
});

test('a twenty-second timeout stops the busy state and retains the exact submission for a safe retry',async()=>{
 const h=harness(),timeouts=[],controllers=[];h.win.AbortSignal={timeout(milliseconds){timeouts.push(milliseconds);const controller=new AbortController();controllers.push(controller);return controller.signal;}};
 h.api.open();h.input('Please keep this note if the connection stalls.');const waiting=h.submit();const body=h.calls[0].args[1].body;
 assert.equal(h.textarea.disabled,true);assert.deepEqual(timeouts,[20_000]);controllers[0].abort(new DOMException('Timed out','TimeoutError'));await waiting;
 assert.equal(h.textarea.disabled,false);assert.equal(h.buttons()[1].disabled,false);assert.equal(h.textarea.value,'Please keep this note if the connection stalls.');assert.match(h.api.dialog.textContent,/Could not confirm delivery/);
 const retry=h.submit();assert.deepEqual(timeouts,[20_000,20_000]);assert.equal(h.calls[1].args[1].body,body);await h.respond(1);await retry;assert.match(h.api.dialog.textContent,/your feedback is saved/);
});

test('editing a failed note creates a new id, optional category is local and localized errors keep all text',async()=>{
 const h=harness();h.api.open();h.input('First note');let waiting=h.submit();await h.respond(0,{status:503});await waiting;const first=JSON.parse(h.calls[0].args[1].body);
 h.category('interface');h.input('Updated note');waiting=h.submit();const second=JSON.parse(h.calls[1].args[1].body);assert.notEqual(first.submissionId,second.submissionId);assert.equal(second.category,'interface');await h.respond(1,{status:429});await waiting;
 assert.match(h.api.dialog.textContent,/try again in a little while/);assert.equal(h.textarea.value,'Updated note');h.language('de');assert.match(h.api.dialog.textContent,/etwas später erneut versuchen/);assert.equal(h.textarea.value,'Updated note');assert.equal(h.select.value,'interface');h.language('nl');assert.match(h.api.dialog.textContent,/Probeer het straks opnieuw/);assert.match(h.api.dialog.textContent,/Categorie \(optioneel\)/);
 waiting=h.submit();await h.respond(2,{status:401});await waiting;assert.match(h.api.dialog.textContent,/Meld je opnieuw aan/);assert.equal(h.textarea.value,'Updated note');
});

test('closing an in-flight note does not cancel or duplicate delivery and reopening shows its state',async()=>{
 const h=harness();h.api.open();h.input('Unsent unless I press the button.');h.api.close();h.api.open();assert.equal(h.calls.length,0);assert.equal(h.textarea.value,'Unsent unless I press the button.');
 const waiting=h.submit();h.api.close();h.api.open();assert.equal(h.textarea.disabled,true);assert.match(h.api.dialog.textContent,/Sending…/);assert.equal(h.calls.length,1);await h.respond();await waiting;assert.equal(h.textarea.value,'');assert.equal(h.form.hidden,true);
});

test('the nonmodal widget closes on Escape or outside click, restores the opener appropriately and keeps drafts',()=>{
 const h=harness();h.api.button.click();h.input('Keep this draft.');
 const tab=h.key('Tab',{shiftKey:false});assert.equal(tab.event.defaultPrevented,undefined);
 h.key('Escape');assert.equal(h.api.dialog.open,false);assert.equal(h.doc.activeElement,h.api.button);h.api.button.click();assert.equal(h.textarea.value,'Keep this draft.');
 h.outside(h.textarea);assert.equal(h.api.dialog.open,true);const other=h.doc.createElement('button');h.doc.body.append(other);other.focus();h.outside(other);assert.equal(h.api.dialog.open,false);assert.equal(h.doc.activeElement,other);
 h.api.button.click();assert.equal(h.textarea.value,'Keep this draft.');h.api.dialog.dispatch('cancel');assert.equal(h.api.dialog.open,false);assert.equal(h.textarea.value,'Keep this draft.');
});

test('Escape closes feedback after tabbing outside without moving page focus or losing the draft',()=>{
 const h=harness();h.api.button.click();h.input('Keep this while I inspect the map.');const other=h.doc.createElement('button');h.doc.body.append(other);other.focus();
 const event=h.key('Escape');assert.equal(event.event.defaultPrevented,true);assert.equal(h.api.dialog.open,false);assert.equal(h.doc.activeElement,other);assert.equal(h.textarea.value,'Keep this while I inspect the map.');
 assert.equal(h.key('Escape').event.defaultPrevented,undefined);h.api.button.click();assert.equal(h.textarea.value,'Keep this while I inspect the map.');h.api.destroy();assert.equal(h.key('Escape').event.defaultPrevented,undefined);
});

test('closing during delivery preserves the immutable payload and a completion never reopens the widget',async()=>{
 const h=harness();h.api.open();h.input('A quick note while testing.');const waiting=h.submit();const payload=h.calls[0].args[1].body;
 h.api.close();h.textarea.dispatch('input');assert.equal(h.calls[0].args[1].body,payload);await h.respond();await waiting;
 assert.equal(h.api.dialog.open,false);assert.equal(h.timers.size,0);assert.match(h.slot.textContent,/your feedback is saved/);h.api.open();assert.equal(h.form.hidden,false);assert.equal(h.textarea.value,'');
});

test('automatic confirmation dismissal leaves keyboard focus outside the widget untouched',async()=>{
 const h=harness();h.api.open();h.input('Works well.');const waiting=h.submit();await h.respond();await waiting;const other=h.doc.createElement('button');h.doc.body.append(other);other.focus();h.advance();assert.equal(h.api.dialog.open,false);assert.equal(h.doc.activeElement,other);
});

test('panel anchors to the header control and stays scrollable above an on-screen keyboard',()=>{
 const h=harness();h.api.button.click();assert.equal(h.api.dialog.style.values['--pv-feedback-top'],'148px');assert.equal(h.api.dialog.style.values['--pv-feedback-max-height'],'640px');
 h.viewport(230);assert.equal(h.api.dialog.style.values['--pv-feedback-top'],'90px');assert.equal(h.api.dialog.style.values['--pv-feedback-max-height'],'128px');
 h.viewport(230,30);assert.equal(h.api.dialog.style.values['--pv-feedback-top'],'120px');assert.equal(h.api.dialog.style.values['--pv-feedback-max-height'],'128px');
 const previous={...h.api.dialog.style.values};h.api.destroy();h.viewport(800);assert.deepEqual(h.api.dialog.style.values,previous);
});

test('a confirmed submission does not steal focus if the tester already continued elsewhere',async()=>{
 const h=harness();h.api.open();h.input('One more idea.');const waiting=h.submit();const other=h.doc.createElement('button');h.doc.body.append(other);other.focus();await h.respond();await waiting;assert.equal(h.doc.activeElement,other);h.advance();assert.equal(h.doc.activeElement,other);
});

test('a malformed success never clears the draft and destroy removes UI and listeners',async()=>{
 const h=harness();h.api.open();h.input('Keep until confirmed.');const waiting=h.submit();await h.respond(0,{result:{ok:false,error:'sensitive internal error'}});await waiting;assert.equal(h.textarea.value,'Keep until confirmed.');assert.match(h.api.dialog.textContent,/Could not confirm delivery/);assert.doesNotMatch(h.api.dialog.textContent,/sensitive internal/);
 h.api.destroy();assert.equal(h.account.parentNode,h.tools);assert.equal(h.api.dialog.isConnected,false);assert.equal(h.api.button.isConnected,false);assert.equal(h.win.__planviewTestFeedback,undefined);h.language('de');assert.equal(h.calls.length,1);
});
