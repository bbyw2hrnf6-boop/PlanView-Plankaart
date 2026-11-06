const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=name=>fs.readFileSync(require.resolve('../'+name),'utf8');
function between(text,start,end){const from=text.indexOf(start),to=text.indexOf(end,from+start.length);assert.ok(from>=0&&to>from);return text.slice(from,to);}
class Element{
 constructor(tag='section',className=''){this.tagName=tag;this.className=className;this.dataset={};this.children=[];this.textContent='';this._html='';this.parentElement=null;this.classList={add:name=>{this.className+=' '+name;},contains:name=>this.className.split(/\s+/).includes(name)};}
 append(child){child.remove();child.parentElement=this;this.children.push(child);}
 remove(){if(this.parentElement){const at=this.parentElement.children.indexOf(this);if(at>=0)this.parentElement.children.splice(at,1);this.parentElement=null;}}
 set innerHTML(value){this._html=value;if(value.includes('<button'))this.append(new Element('button'));}
 get innerHTML(){return this._html;}
 querySelector(selector){if(selector==='.detail-inner')return this.children.find(child=>child.classList.contains('detail-inner'))||null;if(selector===':scope > h3')return this.children.find(child=>child.tagName==='h3')||null;if(selector===':scope > .secondary-intro')return this.children.find(child=>child.classList.contains('secondary-intro'))||null;return this.walk().find(child=>selector==='button'?child.tagName==='button':selector==='.pv-dso-unconfigured'&&child.classList.contains('pv-dso-unconfigured'))||null;}
 querySelectorAll(selector){if(selector==='.pv-services-detail:not([data-pv-arranged])')return this.walk().filter(child=>child.classList.contains('pv-services-detail')&&!Object.hasOwn(child.dataset,'pvArranged'));if(selector===':scope > details.pv-dso-documents, :scope > .pv-rp-note')return this.children.filter(child=>child.classList.contains('pv-dso-documents')||child.classList.contains('pv-rp-note'));return [];}
 walk(){return this.children.flatMap(child=>[child,...child.walk()]);}
}
function interfaceHarness(service,{cloud=true,language='en',rpOnly=false,rp=true,marker=true,section=true}={}){
 const content=new Element('div'),inner=new Element('div','detail-inner');content.append(inner);
 const card=new Element('section','detail-section pv-services-detail'),heading=new Element('h3'),intro=new Element('p','secondary-intro'),metadata=new Element('div','pv-rp-note');
 card.append(heading);card.append(intro);if(rp)card.append(metadata);if(marker)card.dataset.pvDsoContent=String(!rpOnly);if(section)content.append(card);
 let connectionsOpened=0,tabsApplied=0;
 const context=vm.createContext({window:{planviewOfficialServices:service,planviewRuntime:{isLocal:!cloud}},document:{documentElement:{lang:language},createElement:tag=>new Element(tag)},$:id=>id==='detail-content'?content:{click(){connectionsOpened++;}},esc:value=>String(value),button:label=>`<button>${label}</button>`,applyTab:()=>tabsApplied++});
 const text=source('interface.js');vm.runInContext(between(text,'  const messages=','  const ui=')+between(text,'  function dsoConnectionMissing(){','  function applyTab(){')+';globalThis.api={arrangeServiceContent,dsoConnectionMissing};',context);
 return {api:context.api,card,heading,intro,metadata,inner,content,get connectionsOpened(){return connectionsOpened;},get tabsApplied(){return tabsApplied;}};
}
const centralReady={configured:{dso:false,rp:true},ruleTextConfigured:true,dsoReferencesAvailable:true,sharedCredentials:true,canManageKeys:false};
test('central guest rules remain connected while DSO map geometry is unavailable',()=>{
 const h=interfaceHarness(centralReady);h.api.arrangeServiceContent();
 assert.equal(h.card.parentElement,h.inner);assert.equal(h.card.dataset.pvTab,'rules');assert.equal(h.card.classList.contains('pv-dso-unconfigured'),false);
 assert.match(h.intro.textContent,/Current DSO rules supplement/);assert.equal(h.card.querySelector('button'),null);assert.equal(h.inner.querySelector('.pv-dso-unconfigured'),null);
 assert.equal(h.metadata.parentElement.dataset.pvTab,'sources');assert.equal(h.tabsApplied,1);
});
test('RP-only metadata goes to Sources without an empty DSO failure card',()=>{
 const h=interfaceHarness(centralReady,{rpOnly:true});h.api.arrangeServiceContent();
 assert.equal(h.card.parentElement,null);assert.equal(h.metadata.parentElement.dataset.pvTab,'sources');assert.equal(h.inner.children.length,1);assert.equal(h.inner.querySelector('.pv-dso-unconfigured'),null);
});
test('a genuinely missing shared DSO key sends the guest to owner-managed connections',()=>{
 const h=interfaceHarness({...centralReady,ruleTextConfigured:false});h.api.arrangeServiceContent();
 assert.match(h.intro.textContent,/owner setup needed/);assert.doesNotMatch(h.intro.textContent,/local key|add.*key/i);const connection=h.card.querySelector('button');assert.equal(connection.textContent,'Open connections');connection.onclick();assert.equal(h.connectionsOpened,1);
 const noCard=interfaceHarness({...centralReady,ruleTextConfigured:false},{section:false});noCard.api.arrangeServiceContent();assert.match(noCard.inner.querySelector('.pv-dso-unconfigured').innerHTML,/owner setup needed/);
});
test('local connection fallback and local settings action remain available',()=>{
 const configured=interfaceHarness({configured:{dso:true}},{cloud:false,marker:false});configured.api.arrangeServiceContent();assert.equal(configured.card.classList.contains('pv-dso-unconfigured'),false);
 const missing=interfaceHarness({configured:{dso:false}},{cloud:false,marker:false,language:'de'});missing.api.arrangeServiceContent();assert.match(missing.intro.textContent,/DSO-Verbindung nötig/);assert.equal(missing.card.querySelector('button').textContent,'Lokale Verbindungen öffnen');assert.doesNotMatch(missing.intro.textContent,/Besitzer/);
 const explicit=interfaceHarness({configured:{dso:true},ruleTextConfigured:false},{cloud:false,marker:false});explicit.api.arrangeServiceContent();assert.equal(explicit.card.classList.contains('pv-dso-unconfigured'),true,'explicit text readiness takes precedence over geometry readiness');
});
function searchHarness(service,{cloud=true,fetcher}={}){
 const calls=[],updates=[],results=Array.from({length:4},(_,i)=>({point:{lat:51+i*.001,lng:5},name:'Candidate '+i,review:i===0})),advanced={results,ticket:7,abortController:new AbortController()};let renders=0;
 const context=vm.createContext({window:{planviewOfficialServices:service,planviewRuntime:{isLocal:!cloud}},advanced,showResults:()=>renders++,tr:en=>en,wgs84ToRd:point=>[150000,300000+(point.lat-51)*1000],fetch:async(url,options)=>{calls.push({url,options});return fetcher?fetcher(url,options):{ok:true,json:async()=>({complete:true,instruments:[{document:{title:'Official source'},specificRuleCount:2}]})};},searchProgress:update=>updates.push(update)});
 vm.runInContext(between(source('smart-search.js'),'  async function checkDsoLeads(','  function setSearchBusy(')+';globalThis.check=checkDsoLeads;',context);
 return {check:context.check,advanced,calls,updates,get renders(){return renders;}};
}
test('cloud search checks DSO references for its first three candidates using the central text connection',async()=>{
 const h=searchHarness(centralReady),status={textContent:'Map scan complete.'},spec={groups:['bedrijf'],siteCriteria:{parcelMinAreaM2:500}},before=JSON.stringify(spec);
 await h.check(7,spec,status);
 assert.equal(h.calls.length,3);assert.ok(h.calls.every(call=>/^\/api\/dso\/rules\?x=150000\.000&y=30000[0-2]\.000$/.test(call.url)));assert.ok(h.calls.every(call=>call.options.signal===h.advanced.abortController.signal));
 assert.ok(h.advanced.results.slice(0,3).every(result=>result.dso.instruments[0].specificRuleCount===2&&!result.dsoLoading));assert.equal(h.advanced.results[3].dso,undefined);
 assert.match(status.textContent,/3\/3 candidates/);assert.match(status.textContent,/not a legal approval/);assert.equal(JSON.stringify(spec),before);assert.equal(h.advanced.results[0].review,true);assert.equal(h.updates[0].dsoChecked,3);
});
test('cloud search skips absent key or unsupported references; local search uses its local DSO readiness',async()=>{
 for(const service of [{...centralReady,ruleTextConfigured:false},{...centralReady,dsoReferencesAvailable:false},{configured:{dso:true},ruleTextConfigured:false}]){const h=searchHarness(service);await h.check(7,{}, {textContent:'Done'});assert.equal(h.calls.length,0);}
 const local=searchHarness({configured:{dso:true}},{cloud:false});await local.check(7,{}, {textContent:'Done'});assert.equal(local.calls.length,3);
});
test('failed and stale DSO lead requests retain uncertain evidence and do not alter replacement results',async()=>{
 const failed=searchHarness(centralReady,{fetcher:async()=>({ok:false,status:503})}),status={textContent:'Map scan complete.'};await failed.check(7,{},status);assert.ok(failed.advanced.results.slice(0,3).every(result=>result.dsoError&&!result.dso));assert.match(status.textContent,/3 DSO queries unavailable; legal checks remain open/);assert.equal(failed.updates[0].dsoChecked,0);
 const pending=[],stale=searchHarness(centralReady,{fetcher:()=>new Promise(resolve=>pending.push(resolve))}),running=stale.check(7,{}, {textContent:'Old search'});stale.advanced.ticket=8;stale.advanced.results=[{point:{lat:52,lng:6},name:'Replacement'}];pending.forEach(resolve=>resolve({ok:true,json:async()=>({complete:true,instruments:[]})}));await running;assert.equal(stale.advanced.results[0].dso,undefined);assert.equal(stale.updates.length,0);
});
