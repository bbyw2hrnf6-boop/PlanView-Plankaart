const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const core=require('../search-core.js');
const environment=require('../environment-screen.js');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const geometry={type:'Polygon',coordinates:[[[5,52],[5.001,52],[5.001,52.001],[5,52.001],[5,52]]]};
const noise=value=>({state:'complete',metric:'Lden',valueDb:value,source:{title:'Modeled noise',url:'https://www.atlasleefomgeving.nl/kaarten',dataPeriod:'2022',retrievedAt:'2026-10-17'}});
const slope=value=>({state:'complete',metric:'slope_degrees',maxSlopeDeg:value,coverage:{scope:'parcel',complete:true},source:{title:'AHN',url:'https://www.ahn.nl/'}});

// Exercise the real search loop and result/inspector renderers. Only network,
// candidate discovery and map/DOM surfaces are replaced with bounded fixtures.
function harness({evidence=[{noise:noise(45)},{noise:noise(55)},{noise:{state:'unknown'}}],parcels=[]}={}) {
  const elements=new Map(),created=[],calls={sources:[],terrain:[],parcel:[],selected:[]};
  function element(){return {value:'',innerHTML:'',textContent:'',hidden:false,dataset:{},children:[],classList:{add(){},remove(){},toggle(){}},setAttribute(){},querySelectorAll:()=>[],querySelector:()=>null,focus(){},scrollIntoView(){},prepend(){},append(child){this.children.push(child);},remove(){}};}
  const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const inspector=element();
  const document={documentElement:{lang:'de'},getElementById:get,querySelectorAll:()=>[],querySelector:selector=>selector.startsWith('#detail-content')?inspector:null,createElement:()=>{const el=element(),button=element();el.querySelector=selector=>selector==='button'?button:null;created.push(el);return el;}};
  const client=environment.createScreen({sources:{inspect:async(point,options)=>{calls.sources.push({point,options});return evidence[point.index]||{};}},terrain:{inspect:async(point,options)=>{calls.terrain.push({point,options});return evidence[point.index]?.slope||{state:'unknown'};}}});
  const bounds={toBBoxString:()=> '5,52,5.1,52.1',getWest:()=>5,getEast:()=>5.1,getSouth:()=>52,getNorth:()=>52.1,contains:()=>true,pad(){return this;}};
  const ctx=vm.createContext({document,window:{PlanViewSearchCore:core,PlanViewEnvironmentScreen:{...environment,...client},addEventListener(){},dispatchEvent(){},matchMedia:()=>({matches:true}),PlanViewParcelScreen:{inspect:async(point)=>{calls.parcel.push(point);return parcels[point.index]||{parcel:{complete:false}};},evaluate:()=>({pass:true,missing:[]})}},console,Map,Set,URLSearchParams,AbortController,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},innerWidth:1400,L:{latLngBounds:()=>bounds},localStorage:{getItem:()=>null,setItem(){}},fixtureBounds:bounds,fixtureCandidates:evidence.map((_,index)=>({point:{lat:52.0001+index*.0001,lng:5.0001,index},nearFeatures:{},distanceMissing:[]}))});
  vm.runInContext(read('app.js')+'\nglobalThis.mapState=state;',ctx);
  ctx.mapState.map={fitBounds(){},getBounds:()=>bounds};
  ctx.fetchFeatures=async(service,layer,point)=>[{type:'Feature',properties:{identificatie:'designation-'+point.index,plangebied:'NL.IMRO.Test'+point.index,bestemmingshoofdgroep:'wonen',planstatus:'vastgesteld',naam:'Location '+point.index},geometry}];
  ctx.choosePrimary=features=>features[0];ctx.municipalityAt=()=>({name:'Utrecht'});ctx.navigateToPoint=()=>{};ctx.selectPoint=point=>{calls.selected.push(point);ctx.mapState.selected={point};};
  const injection=`
    selectedScope=()=>({bounds:fixtureBounds,name:'Test scope'});
    previewMap=async()=>[];
    candidatePoints=()=>fixtureCandidates;
    intersects=()=>true;
    showResults=()=>{};
    checkNearbyHomes=async()=>{};
    const realCheckDsoLeads=checkDsoLeads;
    checkDsoLeads=async()=>{};
    rememberSearch=()=>{};
    advanced.overlay={clearLayers(){}};
    globalThis.search={runSearch,completeInterpretation,localInterpret,normalize,advanced,resultCard,openResult,criteriaErrors,realCheckDsoLeads};
  })();`;
  vm.runInContext(read('smart-search.js').replace(/\}\)\(\);\s*$/,injection),ctx);
  vm.runInContext(read('search-criteria-ui.js'),ctx);
  get('advanced-scope-select').value='view';
  return {ctx,calls,get,inspector,created};
}

test('manual scan rejects proven Lden failure and retains missing data as review',async()=>{
  const {ctx,calls}=harness();
  await ctx.search.runSearch({environmentCriteria:{maxNoiseDb:50}});
  const results=ctx.search.advanced.results;
  assert.equal(calls.sources.length,3);
  assert.equal(results.length,2);
  const passed=results.find(r=>r.point.index===0),unknown=results.find(r=>r.point.index===2);
  assert.ok(passed&&!passed.review);assert.equal(passed.searchCriteria.environmentCriteria.maxNoiseDb,50);
  assert.ok(unknown.review);assert.ok(unknown.missing.includes('environment:maxNoiseDb'));
  assert.ok(!results.some(r=>r.point.index===1),'known threshold failure must leave the result set');
});

test('zero noise threshold stays active and undecoded source zero never becomes a confirmed match',async()=>{
  const {ctx,calls}=harness({evidence:[{noise:noise(45)},{noise:{state:'unknown',metric:'Lden',valueDb:null,rawValue:0,reason:'undocumented-zero-code'}}]});
  await ctx.search.runSearch({environmentCriteria:{maxNoiseDb:0}});
  assert.equal(calls.sources.length,2);
  assert.equal(ctx.search.advanced.results.length,1);
  const unknown=ctx.search.advanced.results[0];
  assert.equal(unknown.point.index,1);assert.equal(unknown.searchCriteria.environmentCriteria.maxNoiseDb,0);
  assert.equal(unknown.review,true);assert.ok(unknown.missing.includes('environment:maxNoiseDb'));
});

test('free-text criteria reach the same real scan loop without unsupported legacy noise flags',async()=>{
  const {ctx}=harness({evidence:[{noise:noise(45),groundwater:{state:'complete',highWaterDepthCm:120},soil:{state:'complete',classes:[{id:'sand',label:'Zandgronden'}]}}]});
  const query='Gesamtpegel Lden höchstens 50 dB; Grundwasser mindestens 1 m unter Gelände; Sandboden';
  const spec=ctx.search.completeInterpretation(ctx.search.localInterpret(query),query);
  assert.deepEqual(plain(spec.unsupported),[]);assert.equal(spec.environmentCriteria.minGroundwaterDepthCm,100);
  assert.deepEqual(plain(spec.environmentCriteria.soilClasses),['sand','podzol']);
  await ctx.search.runSearch(spec);
  assert.equal(ctx.search.advanced.results.length,1);assert.equal(ctx.search.advanced.results[0].review,false);
});

test('local interpretation allows soil-class alternatives while retaining mixed OR as unsupported',()=>{
  const {ctx}=harness();
  for(const query of ['Boden Sand oder Lehm','Zand of leem','sand or loam soil; noise at most 50 dB']) {
    const spec=ctx.search.completeInterpretation(ctx.search.localInterpret(query),query);
    assert.deepEqual(plain(spec.unsupported),[],query);
    assert.deepEqual(new Set(plain(spec.environmentCriteria.soilClasses)),new Set(['sand','podzol','loam']),query);
  }
  for(const query of ['Sand oder Grundwasser mindestens 100 cm','Boden Sand oder Lehm und Lärm höchstens 50 dB','Lärm höchstens 50 dB oder Hangneigung maximal 5 Grad']) {
    const spec=ctx.search.completeInterpretation(ctx.search.localInterpret(query),query);
    assert.ok(spec.unsupported.some(item=>/\b(?:OR|ODER|OF)\b/.test(item)),query);
  }
});

test('slope scan resolves parcel geometry and cannot substitute a point neighborhood or incomplete parcel',async()=>{
  const {ctx,calls}=harness({evidence:[{slope:slope(0)},{slope:slope(0)},{slope:{...slope(0),coverage:{scope:'point-neighborhood',complete:true}}}],parcels:[{parcel:{id:'A',complete:true,geometry}},{parcel:{id:'B',complete:false,geometry}},{parcel:{id:'C',complete:true,geometry}}]});
  await ctx.search.runSearch({environmentCriteria:{maxSlopeDeg:0}});
  assert.equal(calls.parcel.length,3);assert.equal(calls.terrain.length,2);
  assert.ok(calls.terrain.every(call=>call.options.geometry===geometry));
  const results=ctx.search.advanced.results;
  assert.equal(results.length,3);
  assert.equal(results.find(r=>r.point.index===0).review,false);
  for(const index of [1,2])assert.ok(results.find(r=>r.point.index===index).missing.includes('environment:maxSlopeDeg'));
  const neighborhood=environment.rows(results.find(r=>r.point.index===2).environmentEvidence,'de').find(row=>row.kind==='slope');
  assert.equal(neighborhood.complete,false);assert.match(neighborhood.scope,/Punktumgebung/);
});

test('scan retains evidence and source links when the result is opened in the inspector',async()=>{
  const {ctx,calls,inspector}=harness({evidence:[{noise:noise(45)}]});
  await ctx.search.runSearch({environmentCriteria:{maxNoiseDb:50}});
  const result=ctx.search.advanced.results[0];
  const card=ctx.search.resultCard(result,0,result.searchCriteria);
  assert.match(card,/45 dB Lden/);assert.match(card,/href="https:\/\/www\.atlasleefomgeving\.nl\/kaarten"/);
  ctx.search.openResult(result);
  assert.equal(calls.selected.length,1);
  assert.equal(calls.selected[0].searchEvidence.environmentEvidence,result.environmentEvidence);
  assert.equal(calls.selected[0].searchEvidence.searchCriteria.environmentCriteria.maxNoiseDb,50);
  vm.runInContext(read('environment-insights.js'),ctx);
  ctx.window.PlanViewEnvironmentInsights.show(ctx.mapState.selected);
  const html=inspector.children.at(-1).innerHTML;
  assert.match(html,/45 dB Lden/);assert.match(html,/atlasleefomgeving\.nl\/kaarten/);assert.match(html,/Prüfpunkt/);
});

test('model contract supports total Lden and GHG without claiming other acoustic metrics or parcel-wide point models',()=>{
  const schema=JSON.parse(read('search_filters.schema.json')),config=JSON.parse(read('search_config.json')).instructions;
  assert.ok(schema.required.includes('environmentCriteria'));
  assert.match(schema.properties.environmentCriteria.properties.maxNoiseDb.description,/Lden/);
  assert.match(schema.properties.environmentCriteria.properties.minGroundwaterDepthCm.description,/GHG/);
  assert.doesNotMatch(config,/an explicitly requested numeric sound threshold/);
  assert.doesNotMatch(config,/groundwater, housing-project and NOVEX overlays are not currently executable/);
  assert.match(config,/explicitly requested total-Lden maximum is supported/);assert.doesNotMatch(config,/unsupported acoustic metrics such as Lnight or Lden/);assert.match(config,/Lnight/);assert.match(config,/BELOW LOCAL GROUND/);assert.match(config,/point/);
});

test('coverage counts actual checked points and retains failed-source coverage after completion',async()=>{const {ctx}=harness(),fetchFeatures=ctx.fetchFeatures;ctx.fetchFeatures=async(service,layer,point)=>{if(point.index===1)throw Error('fixture source unavailable');return fetchFeatures(service,layer,point);};await ctx.search.runSearch({environmentCriteria:{maxNoiseDb:50}});assert.deepEqual(plain(ctx.search.advanced.progress),{phase:'complete',completed:3,total:3,failed:1,shapeFailed:0,dsoChecked:0,dsoTotal:0,dsoFailed:0});assert.equal(ctx.search.advanced.results.length,2);});

test('cancelling in-flight sample work leaves stopped coverage and ignores late results',async()=>{const {ctx}=harness();let release,started;const begins=new Promise(resolve=>started=resolve),pending=new Promise(resolve=>release=resolve),fetchFeatures=ctx.fetchFeatures;ctx.fetchFeatures=async(...args)=>{started();await pending;return fetchFeatures(...args);};const run=ctx.search.runSearch({environmentCriteria:{maxNoiseDb:50}});await begins;ctx.search.advanced.cancel();assert.equal(ctx.search.advanced.progress.phase,'stopped');release();await run;assert.equal(ctx.search.advanced.progress.phase,'stopped');assert.equal(ctx.search.advanced.progress.completed,0);assert.equal(ctx.search.advanced.results.length,0);});


test('busy state is committed before dispatch so early routing listeners never read stale state',async()=>{const {ctx}=harness(),observed=[];ctx.window.dispatchEvent=event=>{if(event.type==='planview-search-busy')observed.push([event.detail.busy,ctx.search.advanced.busy]);};await ctx.search.runSearch({environmentCriteria:{maxNoiseDb:50}});assert.deepEqual(observed,[[true,true],[false,false]]);assert.equal(ctx.search.advanced.busy,false);});

test('DSO stage replaces its running message with checked and unavailable counts',async()=>{const {ctx,get}=harness();ctx.window.planviewOfficialServices={configured:{dso:true}};ctx.search.advanced.results=[{point:{lat:52,lng:5}},{point:{lat:52.01,lng:5}}];ctx.search.advanced.ticket=7;ctx.search.advanced.abortController=new AbortController();let called=0;ctx.fetch=async(url,options)=>{assert.ok(options.signal);called++;return {ok:called===1,status:503,json:async()=>({rules:[]})};};const status=get('advanced-status');status.textContent='Map screening finished.';await ctx.search.realCheckDsoLeads(7,{},status);assert.match(status.textContent,/1\/2 Kandidaten abgerufen/);assert.match(status.textContent,/1 DSO-Abfragen nicht verfügbar/);assert.doesNotMatch(status.textContent,/prüfen…/);assert.equal(ctx.search.advanced.progress.dsoFailed,1);assert.ok(ctx.search.advanced.results.every(result=>result.dsoLoading===false));});
