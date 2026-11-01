const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const core=require('../search-core.js');
const fields=new Map(),element=id=>{if(!fields.has(id))fields.set(id,{value:'',innerHTML:'',textContent:'',querySelector:()=>null});return fields.get(id);};
const ctx=vm.createContext({document:{getElementById:element,querySelectorAll:()=>[],documentElement:{lang:'de'}},window:{addEventListener:()=>{},PlanViewSearchCore:core},L:{latLngBounds:corners=>({corners})},console,Map,Set,URLSearchParams});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app.js'),'utf8')+'\nglobalThis.mapState=state;',ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../smart-search.js'),'utf8').replace(/\}\)\(\);\s*$/,'globalThis.search={completeInterpretation,localInterpret,normalize,candidatePoints,scoreResult,evidenceText,loadContext,advanced};})();'),ctx);
ctx.mapState.region=JSON.parse(fs.readFileSync(path.join(__dirname,'../netherlands.json'),'utf8'));
const plain=value=>JSON.parse(JSON.stringify(value));
const bounds={getWest:()=>5.1,getEast:()=>5.12,getSouth:()=>52.08,getNorth:()=>52.1,contains:p=>{const lat=p.lat??p[0],lng=p.lng??p[1];return lat>=52.08&&lat<=52.1&&lng>=5.1&&lng<=5.12;}};

test('browser fallback and normalization preserve a realistic whole-parcel German request',()=>{
  const query='Grundstücke zwischen 500 und 2000 m², mindestens 100 m² Baufenster, maximal 10 % bebaut, mindestens 500 m Abstand zu Natura 2000';
  const spec=ctx.search.completeInterpretation(ctx.search.localInterpret(query),query);
  assert.deepEqual(plain(spec.siteCriteria),{...core.emptySiteCriteria(),parcelMinAreaM2:500,parcelMaxAreaM2:2000,minEnvelopeAreaM2:100,maxBuildingCoveragePercent:10,minNaturaDistanceKm:.5});
  assert.deepEqual(plain(spec.unsupported),[]);assert.equal(spec.requireEnvelope,true);
  assert.deepEqual(plain(spec.nearFeatures),[]);
});

test('browser fallback supports new geographic types and retains unsupported legal thresholds',()=>{
  const query='Grundstück mindestens 1000 m²; Krankenhaus höchstens 1 km; Kleingarten maximal 500 m; Erholungsgebiet mindestens 2 km; Gebäudehöhe maximal 8 m';
  const spec=ctx.search.completeInterpretation(ctx.search.localInterpret(query),query);
  assert.deepEqual(plain(spec.nearFeatures).sort(),['hospital','allotments','recreation_area'].sort());
  assert.equal(spec.siteCriteria.parcelMinAreaM2,1000);
  assert.deepEqual(plain(spec.distanceRules.hospital),{minKm:null,maxKm:1});
  assert.deepEqual(plain(spec.distanceRules.allotments),{minKm:null,maxKm:.5});
  assert.deepEqual(plain(spec.distanceRules.recreation_area),{minKm:2,maxKm:null});
  assert.ok(spec.unsupported.some(s=>/8 m/.test(s)),'unconnected height requirement remains visible');
});

test('semantic AI criteria survive browser normalization without replacement by regex defaults',()=>{
  const spec=ctx.search.completeInterpretation({siteCriteria:{parcelMinAreaM2:1250,minEnvelopePercent:40,excludeNatura2000:true},excludeGroups:['agrarisch'],excludeStatuses:['vastgesteld'],unsupported:['Groundwater restriction requires separate evidence.']},'Find a parcel suitable for my project');
  assert.equal(spec.siteCriteria.parcelMinAreaM2,1250);assert.equal(spec.siteCriteria.minEnvelopePercent,40);assert.equal(spec.siteCriteria.excludeNatura2000,true);
  assert.deepEqual(plain(spec.excludeGroups),['agrarisch']);assert.deepEqual(plain(spec.excludeStatuses),['vastgesteld']);assert.equal(spec.unsupported.length,1);
});

test('explicit distance rules activate every matching criterion even when AI omitted its nearby flag',()=>{
  const spec=ctx.search.completeInterpretation({distanceRules:{hospital:{minKm:1,maxKm:null},town:{minKm:null,maxKm:2},camping:{minKm:3,maxKm:null},industry:{minKm:null,maxKm:1}}},'');
  assert.ok(spec.nearFeatures.includes('hospital'));assert.equal(spec.nearTown,true);assert.equal(spec.nearCamping,true);assert.equal(spec.avoidIndustry,true);
  assert.equal(spec.distanceRules.hospital.minKm,1);assert.equal(spec.distanceRules.industry.maxKm,1);
});

test('missing source features for a minimum distance remain usable review leads without crashing',()=>{
  const spec=ctx.search.completeInterpretation({nearFeatures:['hospital'],distanceRules:{hospital:{minKm:1,maxKm:null}}},'');
  const context={camping:[],towns:[],industry:[],roads:[],features:{hospital:[]}};
  const candidates=ctx.search.candidatePoints({bounds},spec,context);
  assert.ok(candidates.length);assert.ok(candidates.every(candidate=>candidate.distanceMissing.includes('distance:hospital')));
  const lead={...candidates[0],status:'vastgesteld',review:true,missing:candidates[0].distanceMissing};
  assert.ok(Number.isFinite(ctx.search.scoreResult(lead,spec)));assert.doesNotThrow(()=>ctx.search.evidenceText(lead,spec));
});

test('a zero maximum distance includes a station anchor instead of sampling only nonzero rings',()=>{
  const spec=ctx.search.completeInterpretation({distanceRules:{station:{minKm:null,maxKm:0}}},'');
  const station={id:'test-station',point:{lat:52.09,lng:5.11},extent:[5.11,52.09,5.11,52.09],geometry:{type:'Point',coordinates:[5.11,52.09]}};
  const candidates=ctx.search.candidatePoints({bounds},spec,{camping:[],towns:[],industry:[],roads:[],features:{station:[station]}});
  assert.ok(candidates.some(candidate=>candidate.nearFeatures.station.km===0));
  assert.ok(candidates.every(candidate=>candidate.nearFeatures.station.km===0));
});

test('context cache handles boolean flags and feature names and separates active feature sets',async()=>{
  const item={id:'test',point:{lat:52.09,lng:5.11},extent:[5.11,52.09,5.11,52.09]};
  ctx.search.advanced.contextCache.clear();
  ctx.search.advanced.contextData={camping:[],towns:[],industry:[],features:{hospital:[item],station:[item]}};
  const hospital=ctx.search.completeInterpretation({nearFeatures:['hospital']},'');
  const station=ctx.search.completeInterpretation({nearFeatures:['station']},'');
  assert.equal((await ctx.search.loadContext({bounds},hospital,{})).features.hospital.length,1);
  assert.equal((await ctx.search.loadContext({bounds},station,{})).features.station.length,1);
  assert.equal(ctx.search.advanced.contextCache.size,2);
});

test('cross-criterion OR stays unverified and excluded plan status does not become a required status',()=>{
  const query='Within 1 km of a hospital or within 2 km of a park';
  const alternative=ctx.search.completeInterpretation(ctx.search.localInterpret(query),query);
  assert.ok(alternative.unsupported.length,'OR must never become a verified AND match');
  const excluded=ctx.search.completeInterpretation(ctx.search.localInterpret('Nicht rechtskräftig'),'Nicht rechtskräftig');
  assert.deepEqual(plain(excluded.statuses),[]);assert.deepEqual(plain(excluded.excludeStatuses),['onherroepelijk']);
});
