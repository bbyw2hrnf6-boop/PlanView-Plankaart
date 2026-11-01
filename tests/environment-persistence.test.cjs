const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const core=require('../search-core.js'),environment=require('../environment-screen.js');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const feature={type:'Feature',geometry:{type:'Polygon',coordinates:[[[5,52],[5.01,52],[5.01,52.01],[5,52.01],[5,52]]]},properties:{plangebied:'NL.IMRO.test',naam:'Wonen',planstatus:'vastgesteld'}};
const provenance={label:'Official model',url:'https://service.pdok.nl/test',dataDate:'2020, 2021, 2022',retrievedAt:'2026-10-17T12:00:00Z',resolutionM:.5,datasetVersion:'AHN4'};
function result(){return {point:{lat:52.005,lng:5.005},name:'Example area',municipality:'Test municipality',sourceId:'NL.IMRO.test',status:'vastgesteld',feature,envelope:true,review:true,
 parcelEvidence:{parcel:{id:'parcel-123',complete:true,areaM2:1637,geometry:feature.geometry,source:provenance},buildings:{complete:true,coveragePct:0,source:provenance},envelope:{complete:true,areaM2:500,source:provenance},natura2000:{complete:true,intersects:false,minDistanceM:2345,source:provenance}},
 environmentEvidence:{noise:{state:'complete',metric:'Lden',valueDb:45.125,source:provenance},slope:{state:'unknown',metric:'slope_degrees',maxSlopeDeg:12.125,coverage:{scope:'parcel',complete:false,ratio:.85},source:provenance,reason:'no-data-in-slope-neighborhood'},soil:{state:'complete',classes:[{id:'zeekleigronden',label:'Marine clay'}],source:provenance},groundwater:{state:'complete',highWaterDepthCm:80.7,source:provenance}},
 searchCriteria:{query:'quiet clay soil',environmentCriteria:{maxNoiseDb:50,maxSlopeDeg:15,soilClasses:['zeekleigronden'],minGroundwaterDepthCm:50},siteCriteria:{parcelMinAreaM2:1000,maxBuildingCoveragePercent:0},nearby:{station:1}},
 nearFeatures:{station:{km:.123456789,accuracy:'geometry',item:{name:'Station Exact',source:'PDOK TOP10NL'}},park:{km:0,accuracy:'geometry',item:{name:'Park Exact',source:'PDOK TOP10NL'}}},
 industry:{km:.987654321,accuracy:'geometry',item:{name:'Industry Exact',source:'PDOK TOP10NL'}},
 camping:{km:.234567891,accuracy:'geometry',item:{name:'Camping Exact',source:'PDOK TOP10NL'}},
 town:{km:.345678912,accuracy:'geometry',item:{name:'Town Exact',source:'PDOK TOP10NL'}},
 road:{km:.456789123,accuracy:'geometry',item:{name:'Road Exact',source:'PDOK TOP10NL'}}};}
function between(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,`function boundary exists: ${start}`);return source.slice(a,b);}
function harness(){
 const nodes=new Map(),storage=new Map(),downloads=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='advanced-query'?'quiet clay soil':'',innerHTML:'',textContent:'',dataset:{},style:{},hidden:false,scrollTop:0,classList:{add(){},remove(){},toggle(){},contains(){return false;}},getAttribute(){return null;},setAttribute(){},querySelector(){return null;},querySelectorAll(){return [];},scrollTo(){},scrollIntoView(){},focus(){},contains(){return false;}});return nodes.get(id);};
 const context=vm.createContext({console,Event,CustomEvent,AbortController,Map,Set,URLSearchParams,Date,Promise,setTimeout,clearTimeout,setInterval,clearInterval,innerWidth:1200,downloads,
  document:{documentElement:{lang:'en'},body:node('body'),getElementById:node,querySelectorAll:()=>[],querySelector:()=>null,createElement:()=>node('new')},
  window:{addEventListener(){},dispatchEvent(){},PlanViewSearchCore:core,PlanViewEnvironmentScreen:environment,innerWidth:1200},
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
  state:{request:0,saved:[],selected:null,map:{fitBounds(){}}},crypto:{randomUUID:()=> 'saved-id'},
  L:{latLngBounds:()=>({pad:()=>({})}),latLng:()=>({distanceTo:()=>9000})},
  PLAN_WMS:'plans',CAD_WMS:'cadaster',OFFICIAL:'https://omgevingswet.overheid.nl/',layerDefs:[],
  esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),icon:()=>'',
  planTitle:id=>'Plan '+id,officialPlanLink:id=>'https://omgevingswet.overheid.nl/'+id,
  pointLabel:p=>p.address||'Selected area',samePoint:(a,b)=>Math.abs(a.lat-b.lat)<.00001&&Math.abs(a.lng-b.lng)<.00001,
  geoToLatLng:f=>f,geometryContains:()=>true,featuresAtPoint:features=>features,
  inNetherlands:()=>true,municipalityAt:()=>({name:'Test municipality'}),setMunicipalitySelection(){},
  fetchZoning:async()=>[feature],fetchFeatures:async()=>[],fetchPlanRecords:async()=>[{identificatie:'NL.IMRO.test',naam:'Actual plan',dossierstatus:'vastgesteld',datum:'2024-01-01'}],choosePrimary:features=>features[0],
  fetchDataJSON:async()=>({features:{station:[{point:{lat:51,lng:4},name:'Approximate station'}],park:[{point:{lat:51,lng:4},name:'Approximate park'}]},industry:[{point:{lat:51,lng:4},name:'Approximate industry'}]}),
  fetch:async url=>({ok:true,json:async()=>url==='/api/settings'?{configured:{dso:false}}:{features:[]}}),
  matchMedia:()=>({matches:true}),drawSelection(){},navigateToPoint(){},renderDetails(){},renderLegend(){},renderSaved(){},updateLayers(){},loadRegion:async()=>{},showToast(){},
  persistSaved(){storage.set('saved-test',JSON.stringify(context.state.saved));}
 });
 const app=read('app.js');
 vm.runInContext(between(app,'function saveCurrent(){','function buildCaseBrief(){')+between(app,'function buildCaseBrief(){','function wireCaseActions(')+between(app,'function parcelAtPoint(','// Selection marks')+between(app,'async function selectPoint(p){','async function loadOverlayForSelection('),context);
 const smart=read('smart-search.js');
 vm.runInContext(smart.replace(/\}\)\(\);\s*$/,`globalThis.searchHarness={openResult};setOpen=()=>{};setSearchTab=()=>{};})();`),context);
 const ui=read('interface.js');
 vm.runInContext(ui.replace(/\}\)\(\);\s*$/,`globalThis.interfaceHarness={snapshot,resultSnapshot,openSnapshot,siteBriefText,addCompare,enrichCompare,renderWorkbench,ui};setView=view=>{ui.view=view;};updateNav=()=>{};download=(...args)=>downloads.push(args);})();`),context);
 return {context,api:context.interfaceHarness,search:context.searchHarness,node,storage,downloads,settle:async()=>{await new Promise(setImmediate);await new Promise(setImmediate);}};
}
function distances(r){return Object.fromEntries(Object.entries({...r.nearFeatures,camping:r.camping,town:r.town,road:r.road}).map(([key,v])=>[key,{km:v.km,name:v.item.name,source:v.item.source,accuracy:v.accuracy}]));}
function assertEvidence(actual,r){assert.deepEqual(plain(actual.environmentEvidence),r.environmentEvidence);assert.deepEqual(plain(actual.parcelEvidence),r.parcelEvidence);assert.deepEqual(plain(actual.searchCriteria),r.searchCriteria);assert.deepEqual(plain(actual.distances),distances(r));assert.equal(actual.industry.km,r.industry.km);assert.equal(actual.industry.accuracy,'geometry');}

test('direct result→comparison retains environmental evidence, criteria and exact geometry distances',async()=>{
 const h=harness(),r=result(),snapshot=h.api.resultSnapshot(r);assertEvidence(snapshot,r);
 h.api.addCompare(snapshot);await h.settle();assertEvidence(h.api.ui.compare[0],r);
 const stored=JSON.parse(h.storage.get('planview-compare-v2'))[0];assertEvidence(stored,r);
 assert.equal(stored.distances.park.km,0,'zero geometric distance is not replaced by approximate context');
});
test('result→real detail selection→save→comparison preserves criteria, source provenance and precise distances',async()=>{
 const h=harness(),r=result();h.search.openResult(r);await h.settle();
 assert.equal(h.context.state.selected.point.searchEvidence.review,true);
 const detail=h.api.snapshot();assertEvidence(detail,r);assert.equal(detail.partial,true);
 h.context.saveCurrent();assert.equal(h.context.state.saved.length,1);const saved=h.context.state.saved[0];assertEvidence(saved,r);
 saved.notes='Check access with municipality';h.context.saveCurrent();assert.equal(h.context.state.saved.length,1);assert.equal(saved.notes,'Check access with municipality');
 const persisted=JSON.parse(h.storage.get('saved-test'))[0];assertEvidence(persisted,r);
 h.api.addCompare(saved);await h.settle();assertEvidence(h.api.ui.compare[0],r);
});
test('reopening a persisted case keeps evidence through detail and a second save',async()=>{
 const h=harness(),r=result(),persisted=plain(h.api.resultSnapshot(r));persisted.notes='Original notes';
 h.api.openSnapshot(persisted);await h.settle();
 assertEvidence(h.api.snapshot(),r);h.context.saveCurrent();assertEvidence(h.context.state.saved[0],r);
 assert.equal(h.context.state.saved[0].environmentEvidence.noise.source.retrievedAt,provenance.retrievedAt,'reopening must not turn old source retrieval into a fresh measurement');
});
test('comparison JSON export retains numeric precision, criteria, coverage and source timestamps',async()=>{
 const h=harness(),r=result();h.api.ui.compare.push(h.api.resultSnapshot(r));await h.api.enrichCompare(h.api.ui.compare[0]);
 h.api.renderWorkbench('compare');h.node('pv-export-comparison').onclick();
 const [name,body,type]=h.downloads.at(-1);assert.equal(name,'PlanView-comparison.json');assert.equal(type,'application/json');
 const exported=JSON.parse(body);assertEvidence(exported.sites[0],r);assert.equal(exported.sites[0].environmentEvidence.slope.coverage.ratio,.85);
 assert.match(h.node('pv-workbench-body').innerHTML,/85% raster coverage/);assert.match(h.node('pv-workbench-body').innerHTML,/≥ 12\.1°/);
});
test('text brief retains search thresholds, distances, model scope, partial status and source period',()=>{
 const h=harness(),r=result(),snapshot=h.api.resultSnapshot(r);snapshot.notes='Access still open';
 const text=h.api.siteBriefText(snapshot);
 assert.match(text,/45\.1 dB Lden/);assert.match(text,/≥ 12\.1°/);assert.match(text,/whole parcel/);assert.match(text,/85% raster coverage/);assert.match(text,/Needs review/);
 assert.match(text,/2020, 2021, 2022/);assert.match(text,/2026-10-17T12:00:00Z/);assert.match(text,/https:\/\/service\.pdok\.nl\/test/);assert.match(text,/Access still open/);
 assert.match(text,/maxNoiseDb/);assert.match(text,/maxSlopeDeg/);assert.match(text,/parcelMinAreaM2/);assert.match(text,/zeekleigronden/);
 assert.match(text,/Station Exact/);assert.match(text,/Industry Exact/);assert.match(text,/geometry/);
 assert.match(text,/Camping Exact/);assert.match(text,/Town Exact/);assert.match(text,/Road Exact/);
});
test('environment rows never present a partial maximum or point neighborhood as complete parcel evidence',()=>{
 const r=result(),partial=environment.rows(r.environmentEvidence).find(row=>row.kind==='slope');
 assert.equal(partial.complete,false);assert.equal(partial.value,'≥ 12.1°');assert.match(partial.scope,/85% raster coverage/);
 const point={state:'complete',metric:'slope_degrees',maxSlopeDeg:3,coverage:{scope:'point-neighborhood',complete:true,ratio:1}};
 const row=environment.rows({slope:point})[0];assert.equal(row.complete,false);assert.match(row.scope,/not whole-parcel evidence/);
 const markup=environment.render(r.environmentEvidence);assert.match(markup,/Resolution 0\.5 m/);assert.match(markup,/AHN4/);
});
test('refreshing environmental models preserves earlier parcel checks only for the same parcel and exact geometry',async()=>{
 for(const change of ['none','id','geometry']){
  const h=harness(),r=result();h.search.openResult(r);await h.settle();
  const newParcel=plain(r.parcelEvidence.parcel);newParcel.source.retrievedAt='2026-10-17T13:00:00Z';
  if(change==='id')newParcel.id='different-parcel';
  if(change==='geometry')newParcel.geometry.coordinates[0][1][0]+=.001;
  const fresh={parcel:newParcel,buildings:{state:'unknown',reason:'not-requested'},envelope:{state:'unknown',reason:'not-requested'},natura2000:{state:'unknown',reason:'not-requested'}};
  const refreshed=plain(r.environmentEvidence);refreshed.noise.valueDb=46.5;
  h.context.window.PlanViewParcelScreen={inspect:async()=>fresh};
  h.context.window.PlanViewEnvironmentScreen={...environment,inspect:async()=>refreshed};
  vm.runInContext(read('environment-insights.js'),h.context);
  await h.context.window.PlanViewEnvironmentInsights.load(h.context.state.selected);
  const snapshot=h.api.snapshot();assert.equal(snapshot.environmentEvidence.noise.valueDb,46.5);
  assert.equal(snapshot.parcelEvidence.parcel.source.retrievedAt,'2026-10-17T13:00:00Z');
  for(const key of ['buildings','envelope','natura2000']){
   assert.deepEqual(plain(snapshot.parcelEvidence[key]),change==='none'?r.parcelEvidence[key]:fresh[key],`${key} must not be lost on unchanged parcel or reused on changed geometry`);
  }
  h.context.saveCurrent();assert.deepEqual(plain(h.context.state.saved[0].parcelEvidence),plain(snapshot.parcelEvidence));
 }
});
