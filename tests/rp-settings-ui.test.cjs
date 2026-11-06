const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function harness(fetcher=async()=>Response.json({})){
 const nodes=new Map(),events={},mapCalls=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',disabled:false,hidden:false,addEventListener(){},querySelector(){return null;},closest(){return {querySelector(){return null;}};},append(){},classList:{add(){},remove(){}}});return nodes.get(id);};
 const state={selected:null,map:null,perspectiveReady:false};
 const context=vm.createContext({window:{planviewRuntime:{isLocal:false},addEventListener:(name,fn)=>events[name]=fn,dispatchEvent(){}},document:{documentElement:{lang:'en'},getElementById:node,querySelector:()=>null,addEventListener(){},createElement:()=>({dataset:{}}),body:{classList:{add(){},remove(){}}}},layerDefs:[{id:'parcels'}],state,
  fetch:fetcher,Response,Event,encodeURIComponent,updateLayers:()=>mapCalls.push('layers'),initPerspective:async()=>{},renderDetails(){},selectPoint:async()=>{},wgs84ToRd:()=>[180000,318000],OFFICIAL:'https://omgevingswet.overheid.nl/',esc:s=>String(s)});
 const source=fs.readFileSync(require.resolve('../local-services.js'),'utf8').replace(/\}\)\(\);\s*$/,'window.testRP={applySettings,updateStatus,loadRP,queryPoint,save,remove,updateLayers,entry};})();');
 vm.runInContext(source,context);return {api:context.window.testRP,service:context.window.planviewOfficialServices,state,node,mapCalls};
}
const settings=canManageKeys=>({configured:{dso:true,rp:true},capabilities:{rpMetadata:true},credentialScope:'shared',canManageKeys});
test('RP input follows backend capability and owner permission; DSO geometry stays local-only',async()=>{
 let calls=0;const h=harness(async()=>{calls++;return Response.json(settings(true));});
 h.api.applySettings(settings(true));h.api.updateStatus();assert.equal(h.node('rp-key').disabled,false);assert.equal(h.node('rp-key').hidden,false);assert.equal(h.service.configured.rp,true);assert.equal(h.service.configured.dso,false);
 h.node('rp-key').value='fixture-rp-key';h.api.applySettings(settings(false));h.api.updateStatus();assert.equal(h.node('rp-key').hidden,true);assert.equal(h.node('save-services').hidden,true);assert.equal(h.node('remove-rp').hidden,true);
 await h.api.save({preventDefault(){}});await h.api.remove('rp');assert.equal(calls,0);
 h.api.applySettings({configured:{rp:true}});h.api.updateStatus();assert.equal(h.node('rp-key').disabled,true);assert.equal(h.service.configured.rp,false);
});
test('owner can save only RP without changing DSO or painting map layers',async()=>{
 let payload;const h=harness(async(url,options)=>{assert.equal(url,'/api/settings');payload=JSON.parse(options.body);return Response.json(settings(true));});
 h.api.applySettings(settings(true));h.node('rp-key').value='fixture-rp-key';
 await h.api.save({preventDefault(){}});assert.deepEqual(payload,{rp:'fixture-rp-key'});assert.equal(h.node('rp-key').value,'');assert.equal(h.service.ruleTextConfigured,true);assert.equal(h.service.configured.rp,true);assert.equal(h.mapCalls.length,0);
});
test('late RP result cannot replace metadata of a newly selected parcel',async()=>{
 const pending=[];const h=harness((url)=>new Promise(resolve=>pending.push({url,resolve})));
 h.api.applySettings(settings(true));
 const selection=id=>({point:{lat:52,lng:5},primary:{properties:{plangebied:id}}});
 h.state.selected=selection('NL.IMRO.0200.first-plan');const first=h.api.loadRP();
 h.state.selected=selection('NL.IMRO.0200.second-plan');const second=h.api.loadRP();
 pending[1].resolve(Response.json({id:'second',title:'Current plan'}));await second;
 pending[0].resolve(Response.json({id:'first',title:'Old plan'}));await first;
 assert.equal(h.service.rp.id,'second');assert.equal(h.mapCalls.length,0);assert.match(pending[1].url,/id=NL.IMRO.0200.second-plan/);
});
test('central guest references load without any geometry request or layer styling; stale result is ignored',async()=>{
 const pending=[];const h=harness(url=>new Promise(resolve=>pending.push({url,resolve})));
 h.api.applySettings({...settings(false),capabilities:{rpMetadata:true,dsoReferences:true}});
 h.state.selected={point:{lat:52,lng:5}};const first=h.api.queryPoint(h.state.selected.point);
 assert.match(pending[0].url,/^\/api\/dso\/rules\?x=/);assert.equal(h.service.configured.dso,false);assert.equal(h.service.ruleTextConfigured,true);assert.equal(h.service.loading,true);
 h.state.selected={point:{lat:53,lng:6}};const second=h.api.queryPoint(h.state.selected.point);
 pending[1].resolve(Response.json({instruments:[{document:{title:'Current source'}}],complete:true}));await second;
 pending[0].resolve(Response.json({instruments:[{document:{title:'Old source'}}],complete:true}));await first;
 assert.equal(h.service.rules.instruments[0].document.title,'Current source');assert.equal(h.service.loading,false);assert.equal(h.mapCalls.length,0);
});
test('planning preset cannot activate unsupported cloud DSO outlines while text stays connected',()=>{
 const h=harness();h.api.applySettings({...settings(false),capabilities:{dsoReferences:true}});
 h.api.entry.on=true;h.api.updateLayers();assert.equal(h.api.entry.on,false);assert.equal(h.service.ruleTextConfigured,true);assert.equal(h.service.dsoReferencesAvailable,true);
});
