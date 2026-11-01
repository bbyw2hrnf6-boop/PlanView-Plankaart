const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const core=require('../search-core.js'),parcelScreen=require('../parcel-screen.js');
const source=fs.readFileSync(path.resolve(__dirname,'../smart-search.js'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function harness(){
 const fields=new Map(),element=id=>{if(!fields.has(id))fields.set(id,{value:'',innerHTML:'',textContent:'',querySelector:()=>null,querySelectorAll:()=>[],scrollIntoView:()=>{},prepend:()=>{},focus:()=>{}});return fields.get(id);};
 const context=vm.createContext({document:{getElementById:element,querySelectorAll:()=>[],documentElement:{lang:'en'},createElement:()=>({})},window:{addEventListener:()=>{},dispatchEvent:()=>{},matchMedia:()=>({matches:false}),PlanViewSearchCore:core},L:{latLngBounds:()=>({pad:()=>({})})},state:{map:{fitBounds:()=>{}}},console,Map,Set,URLSearchParams,AbortController,DOMException,CustomEvent:class{constructor(name,details){this.type=name;this.detail=details?.detail;}},esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),PLAN_WMS:'plans',CAD_WMS:'cadaster',municipalityAt:()=>({name:'Test Municipality'}),fetchFeatures:async()=>[],choosePrimary:features=>features[0]});
 vm.runInContext(source.replace(/\}\)\(\);\s*$/, `globalThis.search={parcelEnvelopes,parcelEvidenceText,parcelSourceLinks,siteNeeds,normalize,completeInterpretation,advanced,runSearch,
 setupRun(candidates){
 selectedScope=()=>({name:'Test scope',bounds:{toBBoxString:()=> '5,52,6,53'}});
 previewMap=async()=>[];loadContext=async()=>({camping:[],towns:[],industry:[],roads:[],features:{}});candidatePoints=()=>candidates;
 renderInterpretation=()=>{};setSearchTab=()=>{};showResults=()=>{};rememberSearch=()=>{};updateResearchState=()=>{};checkNearbyHomes=async()=>{};checkDsoLeads=async()=>{};intersects=()=>true;
 advanced.overlay={clearLayers:()=>{}};advanced.markers={clearLayers:()=>{}};
 }};})();`),context);
 return {context,search:context.search,element};
}
function configureTiles(search,{count=1,missing=false}={}){
 search.advanced.envelopeManifest={retrieved:'same',compressedTiles:true,sourceUpdated:'2026-07-01',sourcePage:'https://www.pdok.nl/atom-downloadservices/-/article/ruimtelijke-plannen'};
 search.advanced.envelopeSpatial={retrieved:'same',tiles:Object.fromEntries(Array.from({length:count},(_,i)=>['tile'+i,[5.38,52.15,5.4,52.17]]))};
 const geometry=[[[[155000,463000],[155100,463000],[155100,463100],[155000,463100],[155000,463000]]]];
 for(let i=0;i<count;i++){
  search.advanced.envelopeTiles.set('tile'+i,[{plan:'planA',id:'a'+i,tile:'tile'+i,point:[6,53]},{plan:'planB',id:'b'+i,tile:'tile'+i,point:[5.388,52.156]}]);
  search.advanced.envelopeGeoTiles.set('tile'+i,Promise.resolve(new Map(missing?[]:[['planA|a'+i,geometry],['planB|b'+i,geometry]])));
 }
}
test('parcel envelope lookup includes crossing source tiles and keeps the selected plan isolated',async()=>{
 const {search}=harness();configureTiles(search);
 const result=await search.parcelEnvelopes({bbox:[5.387,52.155,5.389,52.157]},'planA');
 assert.equal(result.complete,true);assert.deepEqual(plain(result.features.map(f=>f.id)),['a0'],'source representative point outside parcel cannot exclude its crossing geometry');
 assert.ok(result.features.every(f=>f.properties.plangebied==='planA'));
 assert.equal(result.sourceUpdated,'2026-07-01');assert.equal(result.sourceId,'planA');
 assert.equal(result.features[0].geometry.type,'Polygon');assert.ok(result.features[0].geometry.coordinates[0][0][0]>5);
});
test('parcel envelope completeness cannot survive stale indices, missing shapes, budgets or cancellation',async()=>{
 const {search}=harness();configureTiles(search,{count:13});
 const partial=await search.parcelEnvelopes({bbox:[5.387,52.155,5.389,52.157]},'planA');assert.equal(partial.complete,false);assert.equal(partial.features.length,12);
 configureTiles(search,{missing:true});assert.equal((await search.parcelEnvelopes({bbox:[5.387,52.155,5.389,52.157]},'planA')).complete,false);
 search.advanced.envelopeSpatial.retrieved='old';await assert.rejects(()=>search.parcelEnvelopes({bbox:[5.387,52.155,5.389,52.157]},'planA'),/stale/);
 const controller=new AbortController();controller.abort();await assert.rejects(()=>search.parcelEnvelopes({bbox:[5,52,6,53]},'planA',controller.signal),{name:'AbortError'});
});
test('zero coverage activates whole-parcel checking and all-empty criteria do not',()=>{
 const {search}=harness();assert.equal(search.siteNeeds({siteCriteria:core.emptySiteCriteria()}),false);
 assert.equal(search.siteNeeds({siteCriteria:{...core.emptySiteCriteria(),maxBuildingCoveragePercent:0}}),true);
 assert.equal(search.normalize({potentialBuildingLand:true}).siteCriteria.maxBuildingCoveragePercent,0);
 assert.equal(search.normalize({siteCriteria:{minEnvelopeAreaM2:100}}).requireEnvelope,true);
});
test('runSearch rejects proven parcel failure, retains unknown checks and deduplicates whole parcels per plan',async()=>{
 const {context,search}=harness();
 const candidates=[0,1,2,3,4].map(i=>({point:{lng:5+i*.01,lat:52},distanceMissing:[]}));search.setupRun(candidates);
 context.fetchFeatures=async(service,layer,point)=>[{properties:{plangebied:point.lng===5.04?'planB':'planA',identificatie:'designation',bestemmingshoofdgroep:'wonen',planstatus:'vastgesteld',naam:'Housing'}}];
 const inspections=[];
 context.window.PlanViewParcelScreen={inspect:async(point,options)=>{inspections.push(options);const i=Math.round((point.lng-5)*100);return i===0?{parcel:{id:'small',areaM2:50,complete:true}}:i===1?{parcel:{state:'unknown',complete:false}}:{parcel:{id:'large',areaM2:200,complete:true}};},evaluate:parcelScreen.evaluate};
 await search.runSearch({siteCriteria:{parcelMinAreaM2:100}});
 assert.equal(inspections.length,5);assert.ok(inspections.every(options=>options.signal&&typeof options.getEnvelopeFeatures==='function'));
 assert.equal(search.advanced.results.length,3,'same parcel in same plan deduplicates; different plan and unresolved point remain');
 assert.ok(!search.advanced.results.some(r=>r.parcelEvidence.parcel.id==='small'));
 const unknown=search.advanced.results.find(r=>r.review);assert.ok(unknown);assert.ok(unknown.missing.includes('site:parcelMinAreaM2'));
 assert.equal(search.advanced.results.filter(r=>r.parcelEvidence.parcel.id==='large').length,2);
});
test('source links show available official endpoints without inventing missing evidence links',()=>{
 const {search}=harness();const markup=search.parcelSourceLinks({parcelEvidence:{parcel:{source:{url:parcelScreen.endpoints.parcel+'/items?bbox=5,52,6,53'}},buildings:{state:'unknown'},natura2000:{source:{url:'javascript:alert(1)'}}}});
 assert.match(markup,/BRK/);assert.doesNotMatch(markup,/BAG|javascript:|Natura 2000/);
 const evidence=search.parcelEvidenceText({parcelEvidence:{parcel:{state:'unknown'},natura2000:{state:'unknown'}}});assert.match(evidence,/checks open/);assert.doesNotMatch(evidence,/0%|≥ 0/);
});
