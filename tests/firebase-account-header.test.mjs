import test from 'node:test';
import assert from 'node:assert/strict';
import {mountAccountHeader} from '../firebase/browser/account-header.mjs';

function events(target){const listeners={};target.addEventListener=(key,fn)=>(listeners[key]||=[]).push(fn);target.removeEventListener=(key,fn)=>{listeners[key]=(listeners[key]||[]).filter(value=>value!==fn);};target.dispatch=(key,props={})=>{const event={target,preventDefault(){this.defaultPrevented=true;},...props};return {event,pending:(listeners[key]||[]).map(fn=>fn(event))};};return target;}
class Element{
 constructor(tag,doc){this.tagName=tag.toUpperCase();this.document=doc;this.children=[];this.attributes={};this.hidden=false;this.disabled=false;this.open=false;this._text='';events(this);}
 append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
 replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];this._text='';this.append(...nodes);}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
 set textContent(value){this._text=String(value);for(const node of this.children)node.parentNode=null;this.children=[];}
 get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
 setAttribute(key,value){this.attributes[key]=String(value);}
 getAttribute(key){return this.attributes[key]??null;}
 removeAttribute(key){delete this.attributes[key];}
 contains(node){return node===this||this.children.some(child=>child.contains(node));}
 focus(){this.document.activeElement=this;this.document.dispatch('focusin',{target:this});}
 click(){if(this.disabled)return {pending:[]};this.focus();return this.dispatch('click');}
 showModal(){this.open=true;}
 close(){this.open=false;}
 find(predicate){if(predicate(this))return this;return this.children.map(child=>child.find(predicate)).find(Boolean);}
}
function harness(options={}){
 const doc=events({documentElement:{lang:'en'}});doc.createElement=tag=>new Element(tag,doc);doc.createElementNS=(namespace,tag)=>doc.createElement(tag);doc.body=doc.createElement('body');doc.head=doc.createElement('head');doc.activeElement=doc.body;
 const header=doc.createElement('header'),actions=doc.createElement('div'),language=doc.createElement('select'),settings=doc.createElement('button'),map=doc.createElement('main');header.className='topbar';actions.className='header-actions';language.id='language';settings.id='services-settings';header.append(actions);actions.append(language,settings);doc.body.append(header,map);doc.querySelector=selector=>selector==='.topbar .header-actions'?actions:null;
 const win=events({});let count=0;const onSignOut=options.onSignOut||(()=>{count++;});const api=mountAccountHeader({user:{name:'TestUser02',email:'testuser02@planview-ecf9b.invalid'},window:win,document:doc,onSignOut,...options});
 const find=id=>doc.body.find(node=>node.id===id),menu=find('pv-firebase-account-menu'),profile=find('pv-firebase-profile');
 return {doc,win,header,actions,language,settings,map,api,menu,profile,find,get count(){return count;},get profileButton(){return menu.find(node=>node.getAttribute('role')==='menuitem');},get signOutButton(){return menu.children.find(node=>node.getAttribute('role')==='menuitem'&&node!==this.profileButton);},get closeButton(){return profile.find(node=>node.tagName==='BUTTON');},languageChange(lang){doc.documentElement.lang=lang;win.dispatch('planview-language-change');}};
}

test('approved identity mounts in the actual header with ordered slots, native controls retained and no map changes',()=>{
 const h=harness();assert.equal(h.api.root.parentNode,h.actions);assert.equal(h.api.root.children[0],h.api.quotaSlot);assert.equal(h.api.root.children[1],h.api.feedbackSlot);assert.equal(h.api.root.children[2].contains(h.api.accountButton),true);
 assert.equal(h.actions.children[0].contains(h.language),true);assert.equal(h.actions.children[0].contains(h.settings),true);assert.equal(h.map.children.length,0);assert.equal(h.doc.body.getAttribute('data-pv-account-header'),'true');assert.equal(h.api.accountButton.getAttribute('aria-expanded'),'false');assert.equal(h.menu.hidden,true);assert.match(h.api.accountButton.textContent,/TestUser02/);assert.match(h.api.accountButton.title,/Test user/);
 assert.doesNotMatch(h.profile.textContent,/\.invalid/);assert.equal(h.profile.find(node=>node.tagName==='INPUT'),undefined);assert.equal(h.profile.find(node=>node.tagName==='FORM'),undefined);assert.match(h.profile.textContent,/managed centrally/);assert.equal(h.count,0);
 const again=mountAccountHeader({document:h.doc,window:h.win});assert.equal(again,h.api);assert.equal(h.actions.children.length,2);
});

test('account menu opens by click or arrows, supports menu keyboard navigation and returns focus on Escape',()=>{
 const h=harness();h.api.accountButton.click();assert.equal(h.menu.hidden,false);assert.equal(h.api.accountButton.getAttribute('aria-expanded'),'true');assert.equal(h.doc.activeElement,h.profileButton);
 let key=h.menu.dispatch('keydown',{key:'ArrowDown'});assert.equal(key.event.defaultPrevented,true);assert.equal(h.doc.activeElement,h.signOutButton);h.menu.dispatch('keydown',{key:'ArrowDown'});assert.equal(h.doc.activeElement,h.profileButton);h.menu.dispatch('keydown',{key:'End'});assert.equal(h.doc.activeElement,h.signOutButton);h.menu.dispatch('keydown',{key:'Home'});assert.equal(h.doc.activeElement,h.profileButton);
 key=h.doc.dispatch('keydown',{key:'Escape'});assert.equal(key.event.defaultPrevented,true);assert.equal(h.menu.hidden,true);assert.equal(h.doc.activeElement,h.api.accountButton);
 h.api.accountButton.dispatch('keydown',{key:'ArrowUp'});assert.equal(h.doc.activeElement,h.signOutButton);h.api.accountButton.click();assert.equal(h.menu.hidden,true);h.api.accountButton.dispatch('keydown',{key:'ArrowDown'});assert.equal(h.doc.activeElement,h.profileButton);
});

test('quota, feedback and outside focus dismiss the account menu without taking focus back',()=>{
 const h=harness(),feedback=h.doc.createElement('button'),quota=h.doc.createElement('button');h.api.feedbackSlot.append(feedback);h.api.quotaSlot.append(quota);
 for(const outside of [feedback,quota,h.settings,h.map]){h.api.accountButton.click();assert.equal(h.menu.hidden,false);h.doc.dispatch('pointerdown',{target:outside});assert.equal(h.menu.hidden,true);}
 h.api.accountButton.click();h.settings.focus();assert.equal(h.menu.hidden,true);assert.equal(h.doc.activeElement,h.settings);
 h.api.accountButton.click();h.doc.dispatch('pointerdown',{target:h.profileButton});assert.equal(h.menu.hidden,false);
});

test('read-only profile opens as a modal, keeps focus inside, and closes back to its account opener',()=>{
 const h=harness({isAdmin:true,user:{name:'Danny Hirsch',email:'hirsch.danny@gmx.de'}});h.api.accountButton.click();h.profileButton.click();assert.equal(h.menu.hidden,true);assert.equal(h.profile.open,true);assert.equal(h.doc.activeElement,h.closeButton);assert.match(h.profile.textContent,/Danny Hirsch/);assert.match(h.profile.textContent,/Administrator/);assert.match(h.profile.textContent,/hirsch.danny@gmx.de/);
 for(const shiftKey of [false,true]){const key=h.profile.dispatch('keydown',{key:'Tab',shiftKey});assert.equal(key.event.defaultPrevented,true);assert.equal(h.doc.activeElement,h.closeButton);}
 h.profile.dispatch('keydown',{key:'Escape'});assert.equal(h.profile.open,false);assert.equal(h.doc.activeElement,h.api.accountButton);h.api.accountButton.click();h.profileButton.click();h.profile.dispatch('cancel');assert.equal(h.profile.open,false);assert.equal(h.doc.activeElement,h.api.accountButton);
 h.api.accountButton.click();h.profileButton.click();h.closeButton.click();assert.equal(h.profile.open,false);
});

test('account labels and open profile follow English, Dutch and German without exposing the test identifier',()=>{
 const h=harness();h.api.accountButton.click();h.profileButton.click();h.languageChange('nl');assert.match(h.api.accountButton.title,/Testgebruiker/);assert.match(h.profile.textContent,/Je Planview-profiel/);assert.match(h.profile.textContent,/centraal beheerd/);assert.equal(h.closeButton.getAttribute('aria-label'),'Sluiten');assert.equal(h.profile.open,true);
 h.languageChange('de');assert.match(h.api.accountButton.getAttribute('aria-label'),/Angemeldet als TestUser02/);assert.match(h.profile.textContent,/Dein Planview-Profil/);assert.match(h.profile.textContent,/Testnutzer/);assert.match(h.profile.textContent,/zentral/);assert.doesNotMatch(h.profile.textContent,/\.invalid/);assert.equal(h.signOutButton.textContent,'Abmelden');
});

test('sign out invokes one action, prevents duplicate submissions, and keeps a recoverable error without private detail',async()=>{
 let reject,attempts=0;const h=harness({onSignOut:()=>{attempts++;return new Promise((resolve,no)=>{reject=no;});}});h.api.accountButton.click();const waiting=h.signOutButton.click().pending[0];assert.equal(attempts,1);assert.equal(h.api.accountButton.disabled,true);assert.equal(h.signOutButton.disabled,true);assert.equal(h.profileButton.disabled,true);assert.equal(h.menu.getAttribute('aria-busy'),'true');assert.match(h.signOutButton.textContent,/Signing out/);h.signOutButton.click();assert.equal(attempts,1);
 reject(new Error('sensitive sign-out implementation detail'));await waiting;assert.equal(h.signOutButton.disabled,false);assert.equal(h.api.accountButton.disabled,false);assert.equal(h.menu.hidden,false);assert.match(h.menu.textContent,/Please try again/);assert.doesNotMatch(h.menu.textContent,/sensitive/);assert.equal(h.doc.activeElement,h.signOutButton);assert.equal(h.menu.getAttribute('aria-busy'),null);
 h.languageChange('de');assert.match(h.menu.textContent,/Bitte erneut versuchen/);
 const success=harness();success.api.accountButton.click();await success.signOutButton.click().pending[0];assert.equal(success.count,1);assert.equal(success.menu.hidden,true);assert.equal(success.api.accountButton.disabled,false);
});

test('destroy removes account UI and handlers, restores native header controls, and ignores late sign-out failure',async()=>{
 let reject;const h=harness({onSignOut:()=>new Promise((resolve,no)=>{reject=no;})});h.api.accountButton.click();const pending=h.signOutButton.click().pending[0];h.api.destroy();h.api.destroy();reject(new Error('late failure'));await pending;
 assert.deepEqual(h.actions.children,[h.language,h.settings]);assert.equal(h.doc.body.getAttribute('data-pv-account-header'),null);assert.equal(h.find('pv-firebase-user-tools'),undefined);assert.equal(h.find('pv-firebase-profile'),undefined);assert.equal(h.doc.head.children.length,0);assert.equal(h.win.__planviewAccountHeader,undefined);h.languageChange('de');h.doc.dispatch('keydown',{key:'Escape'});assert.equal(h.map.children.length,0);
});

test('mount validation fails before altering the header and profile identity is rendered as text',()=>{
 const h=harness();h.api.destroy();assert.throws(()=>mountAccountHeader({user:{name:'User'},window:h.win,document:h.doc}),/sign-out action/);assert.deepEqual(h.actions.children,[h.language,h.settings]);
 const api=mountAccountHeader({user:{name:'<img src=x onerror=alert(1)>'},window:h.win,document:h.doc,onSignOut(){}});assert.match(api.accountButton.textContent,/<img/);assert.equal(api.root.find(node=>node.tagName==='IMG'),undefined);api.destroy();
});
