import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mountWeeklyQuota} from '../firebase/browser/weekly-quota.mjs';
import {authenticatedFetch} from '../firebase/browser/transport.mjs';

class Element{
 constructor(tag,doc){this.tagName=tag.toUpperCase();this.document=doc;this.children=[];this.dataset={};this.attributes={};this.listeners={};this.hidden=false;this.disabled=false;this._text='';this.style={};}
 append(...children){for(const child of children){if(child.parent)child.remove();child.parent=this;this.children.push(child);}}
 replaceChildren(...children){for(const child of this.children)child.parent=null;this.children=[];this._text='';this.append(...children);}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
 setAttribute(name,value){this.attributes[name]=String(value);}
 getAttribute(name){return this.attributes[name];}
 addEventListener(name,fn){(this.listeners[name]||=[]).push(fn);}
 dispatch(name,event={}){for(const fn of this.listeners[name]||[])fn({target:this,...event});}
 click(){if(!this.disabled)this.dispatch('click');}
 focus(){this.document.activeElement=this;}
 remove(){if(this.parent){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}}
 find(id){return this.id===id?this:this.children.map(child=>child.find(id)).find(Boolean);}
 contains(node){return node===this||this.children.some(child=>child.contains(node));}
 getBoundingClientRect(){return this.rect||{left:590,right:720,bottom:54};}
}
function events(target){
 const listeners={};
 target.addEventListener=(name,fn)=>(listeners[name]||=[]).push(fn);
 target.removeEventListener=(name,fn)=>{listeners[name]=(listeners[name]||[]).filter(other=>other!==fn);};
 target.emit=(name,event={})=>{for(const fn of listeners[name]||[])fn(event);};
 return target;
}
const snapshot=(used=2)=>({limited:true,limit:150,used,remaining:150-used,resetsAt:'2026-11-01T23:00:00.000Z',periodStart:'2026-10-25T23:00:00.000Z',timezone:'Europe/Amsterdam'});
function harness(){
 const calls=[],doc=events({documentElement:{lang:'en'},visibilityState:'visible',activeElement:null});
 doc.createElement=tag=>new Element(tag,doc);doc.body=doc.createElement('body');doc.head=doc.createElement('head');
 const account=doc.createElement('button');account.id='pv-firebase-account';account.textContent='TestUser02 · Sign out';doc.body.append(account);
 const slot=doc.createElement('div');slot.id='header-quota-slot';doc.body.append(slot);
 const win=events({innerWidth:800,innerHeight:600,fetch:(...args)=>new Promise((resolve,reject)=>calls.push({args,resolve,reject}))});
 const api=mountWeeklyQuota({container:slot,window:win,document:doc});
 const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
 return {doc,win,calls,account,slot,api,settle,get:id=>doc.body.find(id),async response(data=snapshot(),status=200,index=calls.length-1){calls[index].resolve({ok:status<400,status,json:async()=>data});await settle();},translate(lang){doc.documentElement.lang=lang;win.emit('planview-language-change');}};
}
test('weekly indicator makes one authenticated status request, stays compact and explains what counts',async()=>{
 const h=harness();assert.equal(h.calls.length,1);assert.equal(h.calls[0].args[0],'/api/quota');assert.equal(h.calls[0].args[1].method,'GET');assert.equal(h.calls[0].args[1].cache,'no-store');
 assert.equal(h.account.parent,h.doc.body);assert.equal(h.get('pv-firebase-quota').parent,h.slot);assert.equal(h.api.detail.hidden,true);assert.match(h.api.badge.textContent,/Loading AI allowance/);
 await h.response();assert.equal(h.api.badge.textContent,'AI: 148 / 150 left');assert.equal(h.api.badge.getAttribute('aria-expanded'),'false');
 assert.match(h.api.detail.textContent,/Monday at 00:00 in Amsterdam/);assert.match(h.api.detail.textContent,/Map clicks and public data requests do not count/);assert.match(h.api.detail.textContent,/Connection tests also count/);
 assert.equal(mountWeeklyQuota({container:h.slot,window:h.win,document:h.doc}),h.api);assert.equal(h.calls.length,1,'mounting twice does not create a second badge or request');
 h.api.badge.click();assert.equal(h.api.detail.hidden,false);assert.equal(h.api.badge.getAttribute('aria-expanded'),'true');assert.equal(h.calls.length,2);
 h.doc.emit('keydown',{key:'Escape'});assert.equal(h.api.detail.hidden,true);assert.equal(h.doc.activeElement,h.api.badge);
});
test('counter, reset time and limit explanation follow EN, DE and NL without sending searches',async()=>{
 const h=harness();await h.response();h.translate('de');assert.equal(h.api.badge.textContent,'KI: 148 / 150 übrig');assert.match(h.api.detail.textContent,/Kartenklicks und öffentliche Datenabfragen zählen nicht/);assert.match(h.api.detail.textContent,/00:00 Uhr in Amsterdam/);
 h.translate('nl');assert.equal(h.api.badge.textContent,'AI: 148 / 150 over');assert.match(h.api.detail.textContent,/Kaartklikken en openbare gegevensaanvragen tellen niet mee/);assert.match(h.api.detail.textContent,/Wordt vernieuwd op/);
 assert.equal(h.calls.length,1);
});
test('only completed chargeable POST requests refresh quota; public maps and status do not',async()=>{
 const h=harness();await h.response();
 for(const path of ['/api/status','/api/permits/point','/api/dso/rules','/api/rp/plan','/api/routes','/api/quota'])h.api.onResponse({status:200},{path,method:'POST'});
 h.api.onResponse({status:200},{path:'/api/interpret',method:'GET'});assert.equal(h.calls.length,1);
 for(const path of ['/api/interpret','/api/ai/test','/api/rules/search','/api/permits/search']){
  h.api.onResponse({status:200},{path,method:'POST'});assert.equal(h.calls.at(-1).args[0],'/api/quota');await h.response(snapshot(3));
 }
 assert.equal(h.calls.length,5);assert.equal(h.api.badge.textContent,'AI: 147 / 150 left');
});
test('a completed search during an in-flight status check queues a fresh authoritative snapshot',async()=>{
 const h=harness();h.api.onResponse({status:200},{path:'/api/permits/search',method:'POST'});h.api.onResponse({status:200},{path:'/api/rules/search',method:'POST'});
 assert.equal(h.calls.length,1);await h.response(snapshot(148),200,0);assert.equal(h.calls.length,2);await h.response(snapshot(150),200,1);assert.equal(h.api.badge.textContent,'AI: 0 / 150 left');
});
test('429 never fabricates exhaustion; confirmed exhaustion opens clear contact-owner guidance',async()=>{
 const h=harness();await h.response(snapshot(149));h.api.onResponse({status:429},{path:'/api/interpret',method:'POST'});await h.response(snapshot(149));assert.equal(h.api.detail.hidden,true);assert.equal(h.api.badge.textContent,'AI: 1 / 150 left');
 h.api.onResponse({status:429},{path:'/api/interpret',method:'POST'});await h.response(snapshot(150));assert.equal(h.api.detail.hidden,false);assert.equal(h.api.badge.dataset.state,'exhausted');assert.match(h.api.detail.textContent,/Please contact the Planview owner/);assert.match(h.api.detail.textContent,/AI searches are blocked until/);
 h.translate('de');assert.match(h.api.detail.textContent,/Bitte dem Planview-Besitzer Bescheid sagen/);
});
test('status failure and malformed data never present a guessed remaining allowance',async()=>{
 const h=harness();await h.response({},503);assert.equal(h.api.badge.textContent,'AI allowance unavailable');assert.match(h.api.detail.textContent,/server still enforces your limit/);
 h.api.refresh();await h.response(snapshot(4));assert.equal(h.api.badge.textContent,'AI: 146 / 150 left');h.api.refresh();await h.response({...snapshot(4),remaining:149});assert.equal(h.api.badge.textContent,'AI: 146 / 150 left');assert.match(h.api.detail.textContent,/Last known allowance/);
 assert.doesNotMatch(h.api.detail.textContent,/AI: 149/);
});
test('focus, visible-tab return and manual opening refresh without recurring polling',async()=>{
 const h=harness();await h.response();h.doc.visibilityState='hidden';h.win.emit('focus');h.doc.emit('visibilitychange');assert.equal(h.calls.length,1);
 h.doc.visibilityState='visible';h.doc.emit('visibilitychange');h.win.emit('focus');assert.equal(h.calls.length,2);await h.response(snapshot(0));assert.equal(h.api.badge.textContent,'AI: 150 / 150 left');
 h.win.emit('focus');assert.equal(h.calls.length,3);await h.response(snapshot(7));assert.equal(h.api.badge.textContent,'AI: 143 / 150 left');
 const source=fs.readFileSync(new URL('../firebase/browser/weekly-quota.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/setInterval|setTimeout|localStorage|sessionStorage/);
});
test('server unlimited response hides the quota and cleanup never moves account or its header slot',async()=>{
 const h=harness();await h.response({limited:false});assert.equal(h.get('pv-firebase-quota').hidden,true);assert.equal(h.account.parent,h.doc.body);
 h.api.destroy();assert.equal(h.account.parent,h.doc.body);assert.equal(h.slot.parent,h.doc.body);assert.equal(h.get('pv-firebase-quota'),undefined);h.win.emit('focus');h.doc.emit('visibilitychange');assert.equal(h.calls.length,1);
 const later=harness();later.api.destroy();await later.response(snapshot(150));assert.equal(later.get('pv-firebase-quota'),undefined);assert.equal(later.account.parent,later.doc.body);
});
test('header detail stays below its pill, clamps to viewport and dismisses with outside click or Escape',async()=>{
 const h=harness();await h.response();const quota=h.get('pv-firebase-quota');
 quota.rect={left:72,right:194,bottom:110};h.win.innerWidth=375;h.win.innerHeight=667;
 h.api.badge.click();assert.equal(h.api.detail.hidden,false);assert.equal(h.api.detail.style.left,'-60px');assert.equal(h.api.detail.style.right,'auto');assert.equal(h.api.detail.style.width,'320px');assert.equal(h.api.detail.style.maxHeight,'535px');
 h.doc.emit('pointerdown',{target:h.api.detail});assert.equal(h.api.detail.hidden,false,'interacting with panel does not dismiss it');
 h.doc.emit('pointerdown',{target:h.account});assert.equal(h.api.detail.hidden,true,'outside interaction dismisses panel');
 h.api.badge.click();h.win.innerWidth=280;h.win.emit('resize');assert.equal(h.api.detail.style.width,'256px');assert.equal(h.api.detail.style.left,'-60px');
 h.doc.emit('keydown',{key:'Escape'});assert.equal(h.api.detail.hidden,true);assert.equal(h.doc.activeElement,h.api.badge);
 const source=fs.readFileSync(new URL('../firebase/browser/weekly-quota.mjs',import.meta.url),'utf8');assert.match(source,/top:calc\(100% \+ 10px\)/);assert.doesNotMatch(source,/position:fixed|[;{]bottom:|pv-firebase-test-tools|append\(account\)/);
});
test('manual quota refresh returns keyboard focus to the new refresh control after loading',async()=>{
 const h=harness();await h.response();h.api.badge.click();await h.response();
 const refresh=h.get('pv-firebase-quota-refresh');refresh.focus();refresh.click();assert.equal(h.get('pv-firebase-quota-refresh').disabled,true);
 await h.response(snapshot(8));assert.equal(h.doc.activeElement,h.get('pv-firebase-quota-refresh'));assert.equal(h.api.badge.textContent,'AI: 142 / 150 left');
});
test('transport observations preserve the exact response body, cancellation and private request boundaries',async()=>{
 const response=new Response('{"answer":"original response"}'),observed=[],calls=[];
 const origin='https://project.web.app',api='https://europe-west1-project.cloudfunctions.net/planviewApi';
 const send=authenticatedFetch(async(...args)=>{calls.push(args);return response;},{ready:Promise.resolve(),user:()=>({getIdToken:async()=>'private-token'}),apiBase:()=>api,origin,onResponse:(value,metadata)=>{observed.push([value,metadata]);throw new Error('observer failure');}});
 const result=await send(origin+'/api/permits/search?private=secret',{method:'POST',body:'private question'});assert.equal(result,response);assert.equal(response.bodyUsed,false);assert.equal(await result.text(),'{"answer":"original response"}');
 assert.equal(observed.length,1);assert.deepEqual(observed[0][0],{status:200});assert.deepEqual(observed[0][1],{path:'/api/permits/search',method:'POST'});assert.equal(calls[0][1].headers.get('Authorization'),'Bearer private-token');
 await send('https://api.pdok.nl/public');assert.equal(observed.length,1,'public requests are not observed or given Firebase identity');
});
test('Firebase auth mounts quota only for the test login and never changes canonical map code',()=>{
 const source=fs.readFileSync(new URL('../firebase/browser/auth.mjs',import.meta.url),'utf8');
 assert.match(source,/mountWeeklyQuota\(\{container:/);assert.doesNotMatch(source,/mountWeeklyQuota\(\{account:/);
 assert.match(source,/weeklyQuota\?\.onResponse\(response,request\)/);assert.match(source,/weeklyQuota\?\.destroy\(\)/);
 assert.doesNotMatch(fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),/weekly-quota\.mjs|pv-firebase-quota/);
});
