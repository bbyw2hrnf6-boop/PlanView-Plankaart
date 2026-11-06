import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {mountAdminMonitoring,monitoringCsv,monitoringLogCsv} from '../firebase/browser/admin-monitor.mjs';

class Element{
 constructor(tag,document){this.tagName=tag.toUpperCase();this.document=document;this.children=[];this.dataset={};this.attributes={};this.style={};this.listeners={};this._text='';this.className='';this.hidden=false;this.disabled=false;this.value='';this.open=false;this.selectionStart=0;this.selectionEnd=0;}
 append(...nodes){for(const node of nodes){const child=typeof node==='string'?Object.assign(new Element('text',this.document),{textContent:node}):node;child.parent=this;this.children.push(child);}}
 replaceChildren(...nodes){if(this.document.activeElement!==this&&this.contains(this.document.activeElement))this.document.activeElement=this.document.body;this.children=[];this._text='';this.append(...nodes);}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
 setAttribute(key,value){this.attributes[key]=String(value);}
 getAttribute(key){return this.attributes[key];}
 addEventListener(name,fn){(this.listeners[name]||=[]).push(fn);}
 dispatch(name,props={}){for(const fn of this.listeners[name]||[])fn({target:this,preventDefault(){},...props});}
 click(){if(!this.disabled)this.dispatch('click');}
 focus(){if(!this.disabled)this.document.activeElement=this;}
 remove(){this.parent.children=this.parent.children.filter(child=>child!==this);}
 matches(selector){if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));if(selector.startsWith('#'))return this.id===selector.slice(1);const data=/^\[data-([a-z-]+)(?:="([^"]+)")?\]$/.exec(selector);if(data){const key=data[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());return key in this.dataset&&(data[2]===undefined||this.dataset[key]===data[2]);}return this.tagName.toLowerCase()===selector;}
 querySelectorAll(selector){const parts=selector.trim().split(/\s+/);if(parts.length>1){const last=parts.pop();return this.querySelectorAll(parts.join(' ')).flatMap(node=>node.querySelectorAll(last));}return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
 setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 closest(selector){return this.matches(selector)?this:this.parent?.closest(selector)||null;}
 contains(node){return this===node||this.children.some(child=>child.contains(node));}
}
const metrics=(overrides={})=>({requests:0,prompts:0,providerCalls:0,errors:0,durationMs:0,inputTokens:0,cachedInputTokens:0,cacheWriteTokens:0,outputTokens:0,reasoningTokens:0,estimatedCostUsd:0,unpricedCalls:0,usageMissingCalls:0,...overrides});
function fixture(){
 const admin=metrics({requests:2,prompts:3,providerCalls:3,durationMs:4000,inputTokens:900,outputTokens:200,estimatedCostUsd:.02});
 const guest=metrics({requests:5,prompts:7,providerCalls:7,errors:1,durationMs:15000,inputTokens:1800,outputTokens:500,estimatedCostUsd:.08,usageMissingCalls:1});
 return {window:{days:14,from:'2026-10-19T00:00:00Z',to:'2026-11-01T12:45:00Z',timeZone:'UTC',trackingStartedAt:'2026-11-01T12:00:00Z'},summary:metrics(Object.fromEntries(Object.keys(admin).map(key=>[key,admin[key]+guest[key]]))),daily:[{day:'2026-11-01',user:'Admin',...admin},{day:'2026-11-01',user:'TestUser02',...guest}],recent:[{id:'1',startedAt:'2026-11-01T12:40:00Z',user:'TestUser02',endpoint:'/api/rules/search',status:200,...metrics({requests:1,prompts:2,inputTokens:100,outputTokens:20,durationMs:2000,usageMissingCalls:1}),prompt:'SECRET QUESTION AND ADDRESS',answer:'SECRET ANSWER',apiKey:'PRIVATE VALUE'}],recentLimit:100,recentTruncated:true,priceCatalog:{asOf:'2026-11-01',source:'https://developers.openai.com/api/docs/pricing',rates:{}}};
}
function harness({ready=true}={}){
 const doc={documentElement:{lang:'en'},activeElement:null};doc.createElement=tag=>new Element(tag,doc);doc.head=doc.createElement('head');doc.body=doc.createElement('body');
 const listeners={},calls=[],registered=[];
 const win={addEventListener:(event,fn)=>(listeners[event]||=[]).push(fn),fetch:(...args)=>new Promise((resolve,reject)=>calls.push({args,resolve,reject})),URL:{createObjectURL:()=>'',revokeObjectURL(){}},setTimeout(){}};
 function readySettings(){win.PlanViewSettings={registerTab(id,label,panel,onSelect){const button=doc.createElement('button');button.textContent=label;panel.hidden=true;doc.body.append(panel);const entry={id,button,panel,onSelect};registered.push(entry);return entry;}};for(const fn of listeners['planview-settings-ready']||[])fn();}
 if(ready)readySettings();const api=mountAdminMonitoring({window:win,document:doc});
 const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
 return {doc,win,calls,registered,api,get:selector=>api.panel.querySelector(selector),readySettings,settle,open(){registered[0].panel.hidden=false;registered[0].onSelect();},async response(data=fixture(),status=200,index=calls.length-1){calls[index].resolve({ok:status<400,status,json:async()=>data});await settle();},translate(lang){doc.documentElement.lang=lang;for(const fn of listeners['planview-language-change']||[])fn();}};
}
test('owner mounting waits for Settings and only opening Monitoring fetches one snapshot',async()=>{
 const h=harness({ready:false});assert.equal(h.calls.length,0);assert.equal(h.registered.length,0);h.readySettings();assert.equal(h.registered.length,1);assert.equal(h.registered[0].id,'monitoring');assert.equal(h.calls.length,0);
 assert.equal(mountAdminMonitoring({window:h.win,document:h.doc}),h.api);assert.equal(h.registered.length,1);
 h.open();h.open();assert.equal(h.calls.length,1);assert.equal(h.calls[0].args[0],'/api/admin/monitoring');assert.equal(h.calls[0].args[1].method,'GET');assert.equal(h.get('[data-monitor-control="refresh"]').getAttribute('aria-disabled'),'true');
 await h.response();h.open();assert.equal(h.calls.length,1,'no polling or repeat request on reopening');assert.match(h.api.panel.textContent,/Snapshot ·/);
});
test('dashboard keeps four primary metrics, complete totals and uncertain cost while folding background detail',async()=>{
 const h=harness();h.open();await h.response();const text=h.api.panel.textContent;
 assert.match(h.get('[data-monitor-metric="requests"]').textContent,/7/);
 assert.match(h.get('[data-monitor-metric="prompts"]').textContent,/10/);
 assert.match(h.get('[data-monitor-metric="errors"]').textContent,/1/);
 assert.match(h.get('[data-monitor-metric="cost"]').textContent,/\+ \?/);
 assert.equal(h.api.panel.querySelectorAll('.pv-monitor-kpi').length,4);
 assert.equal(h.get('.pv-monitor-rollups').tagName,'DETAILS');assert.equal(h.get('.pv-monitor-rollups').open,false);
 assert.equal(h.get('.pv-monitor-method').tagName,'DETAILS');assert.equal(h.get('.pv-monitor-method').open,false);
 assert.equal(h.get('.pv-monitor-log').querySelectorAll('th').length,6,'technical fields belong in row details');
 const detail=h.get('.pv-monitor-log').querySelector('details');assert.ok(detail);assert.equal(detail.open,false);assert.match(detail.textContent,/\/api\/rules\/search/);
 assert.match(text,/100/);assert.match(text,/older|omitted|limited|newest/i);assert.match(text,/Rules search/);
 assert.doesNotMatch(text,/SECRET|PRIVATE VALUE/);assert.match(text,/no prompt text, answers, addresses or API keys/);assert.match(text,/Excludes Firebase, Google, DSO/);
});
test('global user filter uses complete rollups even when that user has no loaded recent row and preserves focus',async()=>{
 const h=harness();h.open();await h.response();const select=h.get('[data-monitor-control="user"]');select.focus();select.value='Admin';select.dispatch('change');
 assert.match(h.get('[data-monitor-metric="requests"]').textContent,/2/);assert.match(h.get('[data-monitor-metric="prompts"]').textContent,/3/);
 assert.equal(logRows(h).length,0);assert.match(h.api.panel.textContent,/No recent|No matching|No loaded/i);
 assert.equal(h.doc.activeElement,h.get('[data-monitor-control="user"]'));assert.equal(h.calls.length,1);
 h.translate('de');assert.match(h.api.panel.textContent,/Gesendete KI-Prompts|KI-Prompts/);assert.match(h.get('[data-monitor-metric="prompts"]').textContent,/3/);
});
function filterFixture(){
 const data=fixture();
 data.daily=[
  {day:'2026-10-19',user:'TestUser02',...metrics({requests:20,prompts:25,errors:2,durationMs:40_000,estimatedCostUsd:.3})},
  {day:'2026-10-25',user:'Admin',...metrics({requests:2,prompts:3,durationMs:4_000,estimatedCostUsd:.02})},
  {day:'2026-10-26',user:'TestUser02',...metrics({requests:8,prompts:12,errors:1,durationMs:16_000,estimatedCostUsd:.15})},
  {day:'2026-10-31',user:'TestUser02',...metrics({requests:4,prompts:6,durationMs:8_000,estimatedCostUsd:.07})},
  {day:'2026-11-01',user:'Admin',...metrics({requests:2,prompts:3,durationMs:4_000,estimatedCostUsd:.02})},
  {day:'2026-11-01',user:'TestUser02',...metrics({requests:5,prompts:7,errors:1,durationMs:15_000,estimatedCostUsd:.08,usageMissingCalls:1})},
 ];
 data.summary=metrics();for(const row of data.daily)for(const key of Object.keys(data.summary))data.summary[key]+=row[key];
 const row=(startedAt,user,endpoint,status,values={})=>({startedAt,user,endpoint,status,...metrics({requests:1,...values})});
 data.recent=[
  row('2026-11-01T12:40:00Z','TestUser02','/api/rules/search',200,{prompts:2,inputTokens:100,outputTokens:20,durationMs:2000,estimatedCostUsd:.004}),
  row('2026-11-01T12:39:00Z','Admin','/api/status',200,{durationMs:30}),
  row('2026-11-01T12:38:00Z','TestUser02','/api/permits/search',502,{prompts:1,durationMs:6000,estimatedCostUsd:.01}),
  row('2026-11-01T12:37:00Z','TestUser02','/api/permits/point',200,{durationMs:500}),
  row('2026-11-01T12:36:00Z','TestUser02','/api/dso/rules',200,{durationMs:300}),
  row('2026-11-01T12:35:00Z','Admin','/api/rp/plan',200,{durationMs:200}),
  row('2026-11-01T12:34:00Z','Admin','/api/routes',200,{durationMs:1000}),
  row('2026-10-31T23:59:59Z','TestUser02','/api/interpret',200,{prompts:1,durationMs:4000,estimatedCostUsd:.002}),
  row('2026-10-26T00:00:00Z','TestUser02','/api/ai/test',429,{prompts:1,durationMs:50,usageMissingCalls:1}),
  row('2026-10-25T23:59:59Z','Admin','/api/interpret',101,{durationMs:80}),
 ];
 return data;
}
function change(h,key,value,event='change'){
 const control=h.get(`[data-monitor-control="${key}"]`);assert.ok(control,`missing ${key} control`);control.focus();control.value=value;control.dispatch(event);
 return h.get(`[data-monitor-control="${key}"]`);
}
const logRows=h=>h.get('.pv-monitor-log')?.querySelector('tbody')?.children||[];
const metricText=(h,key)=>h.get(`[data-monitor-metric="${key}"]`).textContent;
test('snapshot-relative 14/7/1 UTC periods keep inclusive boundary days and combine with global user',async()=>{
 const h=harness();h.open();await h.response(filterFixture());assert.match(metricText(h,'requests'),/41/);assert.match(metricText(h,'prompts'),/56/);
 change(h,'period','7');assert.match(metricText(h,'requests'),/19/);assert.match(metricText(h,'prompts'),/28/);assert.equal(logRows(h).length,9,'7 days includes Oct26 and omits Oct25');
 assert.equal(h.doc.activeElement,h.get('[data-monitor-control="period"]'));
 change(h,'period','1');assert.match(metricText(h,'requests'),/7/);assert.match(metricText(h,'prompts'),/10/);assert.equal(logRows(h).length,7,'today is based on snapshot.to, never host date');
 change(h,'user','TestUser02');assert.match(metricText(h,'requests'),/5/);assert.match(metricText(h,'prompts'),/7/);assert.equal(logRows(h).length,4);assert.equal(h.calls.length,1,'global filtering is local to one snapshot');
});
test('function, result and free text filter only loaded table rows, retain full KPIs, and reset locally',async()=>{
 const h=harness();h.open();await h.response(filterFixture());
 const original=['requests','prompts','cost','duration','errors'].map(key=>metricText(h,key));
 change(h,'feature','permits');assert.equal(logRows(h).length,1);assert.match(logRows(h)[0].textContent,/\/api\/permits\/search/);assert.doesNotMatch(logRows(h)[0].textContent,/\/api\/permits\/point/);
 change(h,'result','ok');assert.equal(logRows(h).length,0);assert.match(h.api.panel.textContent,/No recent|No matching|No loaded/i);
 change(h,'feature','all');change(h,'result','failed');assert.equal(logRows(h).length,2);
 change(h,'query','  TESTuser02 /API/PERMITS  ','input');assert.equal(logRows(h).length,1,'case-insensitive terms search safe metadata');
 assert.equal(h.doc.activeElement,h.get('[data-monitor-control="query"]'));assert.deepEqual(['requests','prompts','cost','duration','errors'].map(key=>metricText(h,key)),original);
 h.get('[data-monitor-control="reset"]').click();assert.equal(logRows(h).length,10);assert.equal(h.get('[data-monitor-control="query"]').value,'');assert.equal(h.get('[data-monitor-control="feature"]').value,'all');assert.equal(h.get('[data-monitor-control="result"]').value,'all');assert.equal(h.calls.length,1);
 change(h,'period','1');change(h,'user','Admin');change(h,'result','failed');h.get('[data-monitor-control="reset"]').click();assert.equal(h.get('[data-monitor-control="period"]').value,'1');assert.equal(h.get('[data-monitor-control="user"]').value,'Admin');assert.equal(logRows(h).length,3,'table reset preserves global scope');
});
test('translated user-label searches match the same rows in the table and filtered export',async()=>{
 const data=filterFixture(),h=harness();h.open();await h.response(data);h.translate('nl');change(h,'query','beheerder','input');
 assert.equal(logRows(h).length,4);assert.equal(filteredLogRecords(monitoringLogCsv(data,{query:'beheerder'})).length,4,'CSV must retain every visible translated-user match');
});
test('typing preserves the search caret and disclosure choices survive filters and language changes',async()=>{
 const h=harness();h.open();await h.response(filterFixture());const disclosure=h.get('.pv-monitor-rollups');disclosure.open=true;disclosure.dispatch('toggle');
 const method=h.get('.pv-monitor-method');method.open=true;method.dispatch('toggle');
 const query=h.get('[data-monitor-control="query"]');query.focus();query.value='rules';query.selectionStart=2;query.selectionEnd=4;query.dispatch('input');
 assert.equal(h.doc.activeElement,h.get('[data-monitor-control="query"]'));assert.equal(h.doc.activeElement.selectionStart,2);assert.equal(h.doc.activeElement.selectionEnd,4);
 assert.equal(h.get('.pv-monitor-rollups').open,true);assert.equal(h.get('.pv-monitor-method').open,true);
 h.translate('de');assert.equal(h.get('[data-monitor-control="query"]').value,'rules');assert.equal(h.get('.pv-monitor-rollups').open,true);assert.equal(h.get('.pv-monitor-method').open,true);
});
test('feature grouping distinguishes AI attempts, history, DSO, plan metadata, route and system calls',async()=>{
 const h=harness();h.open();await h.response(filterFixture());
 for(const [feature,endpoint] of [['history','/api/permits/point'],['dso','/api/dso/rules'],['rp','/api/rp/plan'],['route','/api/routes'],['system','/api/status']]){
  change(h,'feature',feature);const rows=logRows(h);assert.ok(rows.length>=1);assert.ok(rows.some(row=>row.textContent.includes(endpoint)),`${feature} exposes its correct endpoint`);
  if(feature!=='system')assert.equal(rows.length,1);
 }
 change(h,'feature','ai');assert.equal(logRows(h).length,4);assert.ok(logRows(h).every(row=>!/\/api\/(status|permits\/point|rp\/plan)/.test(row.textContent)));
 change(h,'feature','all');change(h,'result','unknown');assert.equal(logRows(h).length,1);assert.match(logRows(h)[0].textContent,/101/);
});
test('table sorting orders loaded records and survives refresh without changing totals',async()=>{
 const h=harness();h.open();await h.response(filterFixture());
 change(h,'sort','oldest');assert.match(logRows(h)[0].textContent,/\/api\/interpret/);assert.match(logRows(h)[0].textContent,/101/);
 change(h,'sort','cost');assert.match(logRows(h)[0].textContent,/\/api\/permits\/search/);
 change(h,'sort','duration');assert.match(logRows(h)[0].textContent,/\/api\/permits\/search/);
 change(h,'sort','newest');assert.match(logRows(h)[0].textContent,/\/api\/rules\/search/);
 change(h,'feature','history');h.get('[data-monitor-control="refresh"]').click();assert.equal(h.calls.length,2);await h.response(filterFixture());assert.equal(h.get('[data-monitor-control="feature"]').value,'history');assert.equal(logRows(h).length,1);assert.match(metricText(h,'requests'),/41/);
});
function paginatedFixture(){
 const data=filterFixture();data.recent=Array.from({length:25},(_,index)=>({startedAt:new Date(Date.parse('2026-11-01T12:40:00Z')-index*60_000).toISOString(),user:'TestUser02',endpoint:index<15?'/api/rules/search':'/api/permits/search',status:200,...metrics({requests:1,prompts:1,durationMs:index*1000,estimatedCostUsd:index/1000})}));return data;
}
test('recent table paginates ten loaded entries, resets on filtering, and log CSV includes every match beyond the page',async()=>{
 const data=paginatedFixture(),h=harness();h.open();await h.response(data);assert.equal(logRows(h).length,10);assert.equal(h.get('[data-monitor-control="previous"]').disabled,true);assert.equal(h.get('[data-monitor-control="next"]').disabled,false);
 h.get('[data-monitor-control="next"]').click();assert.equal(logRows(h).length,10);assert.equal(h.get('[data-monitor-control="previous"]').disabled,false);
 h.get('[data-monitor-control="next"]').click();assert.equal(logRows(h).length,5);assert.equal(h.get('[data-monitor-control="next"]').disabled,true);assert.match(logRows(h)[0].textContent,/\/api\/permits\/search/);
 h.get('[data-monitor-control="previous"]').click();assert.equal(logRows(h).length,10);
 change(h,'feature','rules');assert.equal(logRows(h).length,10);assert.equal(h.get('[data-monitor-control="previous"]').disabled,true,'filtering restarts at first page');
 assert.equal(filteredLogRecords(monitoringLogCsv(data,{feature:'rules'})).length,15,'CSV exports all filtered loaded records, not only current page');
 h.get('[data-monitor-control="next"]').click();assert.equal(logRows(h).length,5);change(h,'sort','oldest');assert.equal(logRows(h).length,10);assert.equal(h.get('[data-monitor-control="previous"]').disabled,true,'sorting restarts at first page');
 assert.match(metricText(h,'requests'),/41/);assert.equal(h.calls.length,1);
});
test('refresh, final-page navigation and reset retain focus on an enabled visible dashboard control',async()=>{
 const h=harness();h.open();await h.response(paginatedFixture());
 const refresh=h.get('[data-monitor-control="refresh"]');refresh.focus();refresh.click();await h.response(paginatedFixture());
 assert.notEqual(h.doc.activeElement,h.doc.body,'refresh completion should not strand keyboard focus');assert.equal(h.doc.activeElement.disabled,false);assert.ok(h.api.panel.contains(h.doc.activeElement));
 for(let page=0;page<2;page++){const next=h.get('[data-monitor-control="next"]');next.focus();next.click();}
 assert.notEqual(h.doc.activeElement,h.doc.body,'disabled last-page Next needs an enabled fallback');assert.equal(h.doc.activeElement.disabled,false);assert.ok(h.api.panel.contains(h.doc.activeElement));
 change(h,'query','rules','input');const reset=h.get('[data-monitor-control="reset"]');reset.focus();reset.click();
 assert.notEqual(h.doc.activeElement,h.doc.body,'Reset becomes disabled so focus must move to a stable control');assert.equal(h.doc.activeElement.disabled,false);assert.ok(h.api.panel.contains(h.doc.activeElement));
});
test('empty window, request failure and retry are explicit and retain prior totals on refresh failure',async()=>{
 const h=harness();h.open();await h.response({},403);assert.match(h.api.panel.textContent,/only to the administrator/);assert.ok(!h.get('[data-monitor-control="csv"]')||h.get('[data-monitor-control="csv"]').disabled);
 h.get('[data-monitor-control="refresh"]').click();const empty=fixture();empty.summary=metrics();empty.daily=[];empty.recent=[];empty.window.trackingStartedAt=null;await h.response(empty);assert.match(h.api.panel.textContent,/No tracked requests/);assert.match(h.api.panel.textContent,/first recorded request/);assert.match(metricText(h,'duration'),/—/);
 h.get('[data-monitor-control="refresh"]').click();h.calls.at(-1).reject(new Error('private upstream detail'));await h.settle();assert.match(h.api.panel.textContent,/previously loaded snapshot remains/);assert.doesNotMatch(h.api.panel.textContent,/private upstream/);assert.equal(h.get('[data-monitor-control="csv"]').disabled,false);assert.match(metricText(h,'requests'),/0/);
});
function csvRecords(csv){
 const result=[];let row=[],cell='',quoted=false;
 for(let i=csv.charCodeAt(0)===0xfeff?1:0;i<csv.length;i++){
  const c=csv[i];if(c==='"'){if(quoted&&csv[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
  else if(c===','&&!quoted){row.push(cell);cell='';}
  else if(c==='\n'&&!quoted){row.push(cell.replace(/\r$/,''));result.push(row);row=[];cell='';}
  else cell+=c;
 }
 return result;
}
const recentRecords=csv=>csvRecords(csv).filter(row=>row[0]==='recent');
const filteredLogRecords=csv=>csvRecords(csv).filter(row=>/^\d{4}-\d{2}-\d{2}T/.test(row[0]||''));
test('CSV has complete selected totals, capped recent metadata and spreadsheet formula escaping',()=>{
 const data=fixture();data.priceCatalog.asOf='=HYPERLINK("https://bad")';data.recent[0].endpoint='\t=SECRET_FORMULA';
 const csv=monitoringCsv(data,'TestUser02');assert.match(csv,/"summary","","","TestUser02","","","5","7"/);
 assert.doesNotMatch(csv,/"\t=SECRET_FORMULA"/);assert.match(csv,/"'=HYPERLINK\(""https:\/\/bad""\)"/);assert.doesNotMatch(csv,/SECRET QUESTION|SECRET ANSWER|PRIVATE VALUE|"Admin"/);
 assert.match(csv,/recent_truncated/);assert.match(csv,/cachedInputTokens/);assert.match(csv,/usageMissingCalls/);
});
test('complete CSV applies global UTC period and user to rollups without deriving totals from the capped log',()=>{
 const csv=monitoringCsv(filterFixture(),'TestUser02','7'),rows=csvRecords(csv),summary=rows.find(row=>row[0]==='summary');
 assert.ok(summary);assert.equal(summary[6],'17');assert.equal(summary[7],'25');assert.equal(rows.filter(row=>row[0]==='daily').length,3);assert.equal(recentRecords(csv).length,6);
 assert.ok(rows.filter(row=>row[0]==='daily').every(row=>row[1]>='2026-10-26'));assert.doesNotMatch(csv,/"Admin"/);
 const today=monitoringCsv(filterFixture(),'all','1');assert.equal(csvRecords(today).find(row=>row[0]==='summary')[6],'7');assert.equal(recentRecords(today).length,7);
});
test('filtered-log CSV exports only matching loaded rows, marks its limited scope and does not invent aggregate totals',()=>{
 const data=filterFixture();const csv=monitoringLogCsv(data,{user:'TestUser02',period:'7',query:'permits',feature:'permits',result:'failed',sort:'cost'}),rows=csvRecords(csv);
 assert.equal(filteredLogRecords(csv).length,1);assert.equal(filteredLogRecords(csv)[0][2],'/api/permits/search');assert.ok(!rows.some(row=>['summary','daily'].includes(row[0])));
 assert.match(csv,/recent_truncated/);assert.match(csv,/recent_limit/);assert.match(csv,/loaded|recent|limited|capped/i);assert.match(csv,/period|window/i);assert.doesNotMatch(csv,/SECRET QUESTION|SECRET ANSWER|PRIVATE VALUE/);
 const empty=monitoringLogCsv(data,{user:'Admin',period:'1',feature:'permits',result:'failed'});assert.equal(filteredLogRecords(empty).length,0);
});
test('extended Settings tabs use dynamic arrow, Home and End keyboard navigation',()=>{
 const source=fs.readFileSync(new URL('../workspace-ui.js',import.meta.url),'utf8');
 const start=source.indexOf("    tabs.addEventListener('click', event =>");const end=source.indexOf("    $('services-settings').addEventListener",start);
 const doc={};const tabs=new Element('div',doc);for(const id of ['connections','appearance','monitoring']){const button=new Element('button',doc);button.dataset.settingsTab=id;tabs.append(button);}
 const selected=[];vm.runInNewContext(source.slice(start,end),{tabs,selectSettingsTab:(...args)=>selected.push(args)});
 const key=(index,key)=>tabs.dispatch('keydown',{target:tabs.children[index],key});
 key(0,'End');key(2,'ArrowRight');key(0,'ArrowLeft');key(2,'Home');
 assert.deepEqual(selected,[['monitoring',true],['connections',true],['monitoring',true],['connections',true]]);
 tabs.dispatch('click',{target:tabs.children[2]});assert.deepEqual(selected.at(-1),['monitoring']);
});
