const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const core=require('../search-core.js');
const canonical=process.env.PLANVIEW_SOURCE||path.resolve(__dirname,'..');
const fields=new Map(),element=id=>{if(!fields.has(id))fields.set(id,{value:'',innerHTML:'',textContent:'',querySelector:()=>null});return fields.get(id);};
const ctx=vm.createContext({document:{getElementById:element,querySelectorAll:()=>[],documentElement:{lang:'en'}},window:{addEventListener:()=>{},PlanViewSearchCore:core},L:{latLngBounds:corners=>({corners})},console,Map,Set,URLSearchParams});
vm.runInContext(fs.readFileSync(path.join(canonical,'app.js'),'utf8')+'\n globalThis.g={state,inNetherlands};',ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../smart-search.js'),'utf8').replace(/\}\)\(\);\s*$/, 'globalThis.search={completeInterpretation,normalize,loadContext,candidatePoints,selectedScope,advanced};})();'),ctx);
ctx.g.state.region=JSON.parse(fs.readFileSync(path.join(canonical,'netherlands.json'),'utf8'));
const bound={getWest:()=>5.1,getEast:()=>5.12,getSouth:()=>52.08,getNorth:()=>52.1,contains:p=>{const lat=p.lat??p[0],lng=p.lng??p[1];return lat>=52.08&&lat<=52.1&&lng>=5.1&&lng<=5.12;}};

test('semantic range and every unsupported requirement survive client normalization',()=>{
  const raw={nearFeatures:['station'],distanceRules:{station:{minKm:.5,maxKm:3}},unsupported:Array.from({length:8},(_,i)=>'requirement '+i)};
  const spec=ctx.search.completeInterpretation(raw,'Between 500 m and 3 km of a train station');
  assert.deepEqual(JSON.parse(JSON.stringify(spec.distanceRules.station)),{minKm:.5,maxKm:3});assert.equal(spec.unsupported.length,8);
});

test('increasing the preview distance includes surroundings beyond the old prefetch extent',async()=>{
  const features=Object.fromEntries(['station','park','sports','cemetery','swimming_pool','marina'].map(kind=>[kind,[]]));
  features.station=[{id:'far',point:{lat:52.09,lng:5.5},extent:[5.5,52.09,5.5,52.09]}];
  ctx.search.advanced.contextData={camping:[],towns:[],industry:[],features};ctx.window.planviewContext={load:async()=>({features:[]})};
  const spec=ctx.search.completeInterpretation({nearFeatures:['station']},'Within 3 km of a train station');
  assert.equal((await ctx.search.loadContext({bounds:bound},spec,{})).features.station.length,0);
  spec.distanceRules.station.maxKm=50;spec.distanceKm.station=50;
  assert.equal((await ctx.search.loadContext({bounds:bound},spec,{})).features.station.length,1);
});

test('extent-only surroundings stay review leads rather than precise matches',()=>{
  const spec=ctx.search.completeInterpretation({nearFeatures:['park']},'Within 500 m of a park');
  const context={camping:[],towns:[],industry:[],roads:[],features:{park:[{id:'bbox-only',point:{lat:52.09,lng:5.11},extent:[5.08,52.06,5.14,52.12]}]}};
  const candidates=ctx.search.candidatePoints({bounds:bound},spec,context);
  assert.ok(candidates.length);assert.ok(candidates.every(candidate=>candidate.distanceMissing.includes('distance:park')));
});

test('explicit Groningen in a Limburg map view resolves the municipality polygon',()=>{
  ctx.g.state.map={getBounds:()=>bound,getZoom:()=>8,getCenter:()=>({lat:50.85,lng:5.69})};ctx.g.state.province='31';ctx.g.state.municipality='all';
  element('advanced-scope-select').value='view';
  const scope=ctx.search.selectedScope('Find residential land in Groningen');
  const municipality=ctx.g.state.region.municipalities.find(m=>m.name==='Groningen');
  assert.equal(scope.municipality,municipality.code);assert.equal(scope.geometry,municipality.geometry);assert.match(scope.name,/from your request/);
  assert.deepEqual(JSON.parse(JSON.stringify(scope.bounds.corners)),[[municipality.bounds[0],municipality.bounds[1]],[municipality.bounds[2],municipality.bounds[3]]]);
});

test('province cues, ambiguous names and explicit scope conflicts stay visible',()=>{
  const region=ctx.g.state.region;
  assert.equal(core.queryLocation('Land in Groningen',region).type,'municipality');
  assert.equal(core.queryLocation('Land within the province of Groningen',region).type,'province');
  assert.equal(core.queryLocation('Land in de provincie Utrecht',region).type,'province');
  assert.equal(core.queryLocation('Land in Groningen province',region).type,'province');
  assert.equal(core.queryLocation('Land in Bergen',region).error,'ambiguous');
  assert.equal(core.queryLocation('Land in Bergen op Zoom',region).place.name,'Bergen op Zoom');
  assert.equal(core.queryLocation('Land in Groningen or Utrecht',region).error,'multiple');
  assert.equal(core.queryLocation('Land in the province Amsterdam',region).error,'type');
  assert.equal(core.queryLocation('Midden-Groningen appears in a source label',region),null);
  assert.equal(core.queryLocation('near a station',region),null);
  element('advanced-scope-select').value='province';ctx.g.state.province='31';
  assert.match(ctx.search.selectedScope('Land in Groningen').error,/selected search area is Limburg/);
  assert.equal(ctx.g.state.province,'31','explicit province choice unchanged');
  element('advanced-scope-select').value='country';assert.ok(ctx.search.selectedScope('Land in Groningen').error);
  element('advanced-scope-select').value='drawn';ctx.search.advanced.bounds=bound;assert.ok(ctx.search.selectedScope('Land in Groningen').error);
  element('advanced-scope-select').value='municipality';ctx.g.state.municipality=region.municipalities.find(m=>m.name==='Maastricht').code;
  assert.match(ctx.search.selectedScope('Land in Groningen').error,/Maastricht/);
  assert.equal(ctx.search.selectedScope('Land in Limburg').name,'Maastricht','explicit municipality inside requested province is compatible');
});
