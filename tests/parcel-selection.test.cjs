const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function declaration(name) {
  const pattern = new RegExp(`^(?:async )?function ${name}\\(`, 'm');
  const start = source.search(pattern);
  assert.ok(start >= 0, `Application function exists: ${name}`);
  const remainder = source.slice(start + 1);
  const next = remainder.search(/^(?:async )?function \w+\(/m);
  return source.slice(start, next < 0 ? source.length : start + 1 + next);
}
const polygon = (west, south, east, north) => ({type:'Polygon', coordinates:[[[west,south],[east,south],[east,north],[west,north],[west,south]]]});
const feature = (geometry, properties) => ({type:'Feature', geometry, properties});
const point = {lat:52.005, lng:5.005};
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function fixture() {
  const primary = feature(polygon(4.99,51.99,5.03,52.03), {identificatie:'designation-1',plangebied:'NL.IMRO.test-plan',naam:'Wonen'});
  const parcel = feature(polygon(5.004,52.004,5.006,52.006), {identificatie:'parcel-17',sectie:'A',perceelnummer:17});
  const selected = {point:{...point},primary,parcel,layers:{zoning:[primary],documents:[{identificatie:'NL.IMRO.test-plan',naam:'Applicable planning source'}]}};
  return {primary,parcel,selected};
}
function harness(selected) {
  const group = () => ({items:[],clearLayers(){this.items.length = 0;}});
  const selection = group(), pin = group(), frames = [];
  const context = vm.createContext({
    state:{selected,perspectiveReady:true,detailLayers:{selection,pin},perspectiveMap:{getSource(name){assert.equal(name,'selection');return {setData:data=>frames.push(plain(data))};}}},
    geoToLatLng:f=>f?.geometry ? {type:'Feature',geometry:f.geometry,properties:{...f.properties}} : null,
    L:{
      geoJSON:(shape,options)=>({shape,options,addTo(layer){layer.items.push(this);return this;}}),
      circleMarker:(coordinates,options)=>({coordinates,options,addTo(layer){layer.items.push(this);return this;}})
    },
    layerDefs:[],BGT_BASE:'bgt',PLAN_WMS:'planning',CAD_WMS:'cadastre',NOVEX_WMS:'novex',mapOpacity:()=>1
  });
  for (const name of ['polygonContains','geometryContains','parcelAtPoint','updatePerspectiveSelection','drawSelection','perspectiveStyle']) vm.runInContext(declaration(name), context);
  return {context,selection,pin,frames};
}

test('a parcel selection draws only the cadastral parcel and retains its broader planning context', () => {
  const {primary,parcel,selected} = fixture(), before = plain(selected);
  freeze(primary);freeze(parcel);freeze(selected.layers);
  const h = harness(selected);
  h.context.drawSelection(primary,parcel,point);
  assert.equal(h.selection.items.length,1,'A single parcel must receive the selection outline');
  assert.deepEqual(plain(h.selection.items[0].shape.geometry),parcel.geometry);
  assert.notDeepEqual(plain(h.selection.items[0].shape.geometry),primary.geometry,'The enclosing designation must remain context, never the selected area');
  assert.ok(h.selection.items[0].options.style.weight > 0);
  assert.ok(!h.selection.items[0].options.style.dashArray,'The selected parcel has a solid boundary');
  assert.deepEqual(plain(selected),before,'Rendering must preserve plan IDs, zoning geometry, parcel identity and documents for Rules and Permits');
});

test('a missing parcel clears stale outlines without substituting the planning designation', () => {
  for (const parcel of [null,undefined,{type:'Feature',properties:{identificatie:'unresolved'}}]) {
    const {primary,selected} = fixture();selected.parcel = parcel;
    const h = harness(selected);h.selection.items.push({stale:'previous parcel'});h.pin.items.push({stale:'previous point'});
    h.context.drawSelection(primary,parcel,point);
    assert.equal(h.selection.items.length,0,'A failed cadastre lookup must not turn a whole planning area into a parcel');
    assert.equal(h.pin.items.length,1,'The clicked point remains visible when parcel geometry is unavailable');
    assert.deepEqual(plain(h.pin.items[0].coordinates),[point.lat,point.lng]);
  }
});

test('a cadastral lookup selects an intersecting parcel instead of the first nearby feature', () => {
  const {parcel,selected} = fixture(), h = harness(selected);
  const nearby = feature(polygon(5.010,52.010,5.020,52.020),{identificatie:'nearby-parcel'});
  assert.equal(h.context.parcelAtPoint([nearby,parcel],point),parcel);
  assert.equal(h.context.parcelAtPoint([nearby],point),undefined,'No exact match must remain unresolved rather than fall back to a neighboring parcel');
  assert.equal(h.context.parcelAtPoint([],point),undefined);
});

test('parcel matching respects polygon holes and disconnected MultiPolygon parts', () => {
  const {parcel,selected} = fixture(), h = harness(selected);
  const excludedHole = polygon(5.0045,52.0045,5.0055,52.0055).coordinates[0];
  const holedParcel = feature({type:'Polygon',coordinates:[parcel.geometry.coordinates[0],excludedHole]},{identificatie:'hole-surrounding-parcel'});
  assert.equal(h.context.parcelAtPoint([holedParcel],point),undefined,'A click in a parcel hole must not select the surrounding cadastral polygon');
  const multiParcel = feature({type:'MultiPolygon',coordinates:[polygon(5.010,52.010,5.020,52.020).coordinates,parcel.geometry.coordinates]},{identificatie:'multipart-parcel'});
  assert.equal(h.context.parcelAtPoint([multiParcel],point),multiParcel,'Containment in any official parcel part resolves that parcel');
  assert.equal(h.context.parcelAtPoint([feature({type:'Point',coordinates:[point.lng,point.lat]},{identificatie:'not-a-parcel-area'})],point),undefined);
});

test('disconnected parts of a cadastral MultiPolygon remain part of the selected parcel', () => {
  const {primary,parcel,selected} = fixture();
  parcel.geometry = {type:'MultiPolygon',coordinates:[polygon(5.004,52.004,5.006,52.006).coordinates,polygon(5.008,52.004,5.009,52.005).coordinates]};
  const h = harness(selected);h.context.drawSelection(primary,parcel,point);
  assert.equal(h.selection.items.length,1);
  assert.deepEqual(plain(h.selection.items[0].shape.geometry),parcel.geometry,'Keep all official parcel parts; do not crop or replace the polygon');
  assert.equal(h.frames.at(-1).features.find(f=>f.properties.kind==='parcel').geometry.coordinates.length,2);
});

test('reselecting another parcel replaces both the polygon and point in each map engine', () => {
  const first = fixture(), h = harness(first.selected);
  h.context.drawSelection(first.primary,first.parcel,point);
  const nextPoint = {lat:52.015,lng:5.015};
  const nextParcel = feature(polygon(5.014,52.014,5.016,52.016),{identificatie:'parcel-18'});
  h.context.state.selected = {...first.selected,point:nextPoint,parcel:nextParcel};
  h.context.drawSelection(first.primary,nextParcel,nextPoint);
  assert.equal(h.selection.items.length,1);assert.equal(h.pin.items.length,1);
  assert.deepEqual(plain(h.selection.items[0].shape.geometry),nextParcel.geometry);
  assert.deepEqual(plain(h.pin.items[0].coordinates),[nextPoint.lat,nextPoint.lng]);
  const frame = h.frames.at(-1);
  assert.deepEqual(frame.features.map(f=>f.properties.kind).sort(),['parcel','pin']);
  assert.deepEqual(frame.features.find(f=>f.geometry.type==='Point').geometry.coordinates,[nextPoint.lng,nextPoint.lat]);
});

test('perspective selection contains only the actual parcel and point while source context stays unchanged', () => {
  const {primary,parcel,selected} = fixture(), before = plain(selected);
  freeze(primary);freeze(parcel);freeze(selected.layers);
  const h = harness(selected);h.context.updatePerspectiveSelection();
  const frame = h.frames.at(-1);
  assert.equal(frame.type,'FeatureCollection');assert.equal(frame.features.length,2);
  const polygons = frame.features.filter(f=>['Polygon','MultiPolygon'].includes(f.geometry.type));
  assert.equal(polygons.length,1);assert.equal(polygons[0].properties.kind,'parcel');
  assert.deepEqual(polygons[0].geometry,parcel.geometry);
  assert.deepEqual(frame.features.find(f=>f.properties.kind==='pin').geometry,{type:'Point',coordinates:[point.lng,point.lat]});
  assert.deepEqual(plain(selected),before);
});

test('perspective mode never falls back to a designation when cadastral geometry is absent', () => {
  const {selected} = fixture();selected.parcel = null;
  const h = harness(selected);h.context.updatePerspectiveSelection();
  assert.deepEqual(h.frames.at(-1).features.map(f=>f.properties.kind),['pin']);
  h.context.state.selected = null;h.context.updatePerspectiveSelection();
  assert.deepEqual(h.frames.at(-1),{type:'FeatureCollection',features:[]},'Clearing a selection also clears its previous perspective geometry');
});

test('perspective fill and outline target parcels and retain the 3D insertion anchor', () => {
  const h = harness(fixture().selected), style = h.context.perspectiveStyle();
  const evaluate = (expression,kind) => {
    if (!Array.isArray(expression)) return expression;
    if (expression[0] === 'get') return expression[1] === 'kind' ? kind : undefined;
    if (expression[0] === '==') return evaluate(expression[1],kind) === evaluate(expression[2],kind);
    throw new Error('Unexpected selection filter operator: '+expression[0]);
  };
  for (const id of ['selected-fill','selected-outline']) {
    const layer = style.layers.find(layer=>layer.id===id);
    assert.ok(layer,`${id} remains available, including the selected-fill anchor used by 3DBAG`);
    assert.equal(layer.source,'selection');
    assert.equal(evaluate(layer.filter,'parcel'),true);
    assert.equal(evaluate(layer.filter,'designation'),false,'Broad zoning geometry must never receive the parcel selection style');
  }
});

test('inspection base layers start enabled', () => {
  const start=source.indexOf('const layerDefs=['), end=source.indexOf('\n];',start)+3;
  const defaults=vm.runInNewContext(source.slice(start,end)+';layerDefs');
  assert.equal(defaults.find(d=>d.id==='zoning').on,true);
  assert.equal(defaults.find(d=>d.id==='parcels').on,true);
});

test('selecting a parcel restores both context layers and checkboxes without enabling optional overlays', async () => {
  const {primary,parcel}=fixture();
  const toggles=[{checked:false},{checked:false}],defs=[{id:'zoning',on:false},{id:'parcels',on:false},{id:'double',on:false}];
  let refreshes=0;
  const panel={innerHTML:'',scrollTop:0,scrollTo(){},classList:{add(){}}};
  const context=vm.createContext({
    AbortController,window:{innerWidth:1440},state:{request:0},layerDefs:defs,
    document:{documentElement:{lang:'en'},getElementById:()=>panel,querySelectorAll:selector=>{assert.equal(selector,'[data-layer="zoning"],[data-layer="parcels"]');return toggles;}},
    inNetherlands:()=>true,drawSelection(){},municipalityAt:()=>null,setMunicipalitySelection(){},
    icon:()=>'',esc:s=>s,PLAN_WMS:'planning',CAD_WMS:'cadastre',
    fetchZoning:async()=>[primary],fetchFeatures:async()=>[parcel],fetchPlanRecords:async()=>[{identificatie:'NL.IMRO.test-plan'}],
    choosePrimary:features=>features[0],parcelAtPoint:features=>features[0],
    updateLayers(){refreshes++;},renderDetails(){},renderLegend(){},matchMedia:()=>({matches:true})
  });
  vm.runInContext(declaration('selectPoint'),context);
  await context.selectPoint(point);
  assert.deepEqual(defs.map(d=>d.on),[true,true,false]);
  assert.ok(toggles.every(t=>t.checked));assert.equal(refreshes,1);
  assert.equal(context.state.selected.primary,primary);
  assert.equal(context.state.selected.parcel,parcel);
  assert.equal(context.state.selected.layers.documents[0].identificatie,'NL.IMRO.test-plan');
  await context.selectPoint(point);
  assert.equal(refreshes,1,'Already enabled layers do not need another map refresh');
});

test('desktop selection highlights only the parcel even with BAG and bouwvlak evidence loaded', () => {
  const desktop=fs.readFileSync(path.join(__dirname,'..','desktop-journey.js'),'utf8');
  const start=desktop.indexOf('  function renderParcelOutline('),end=desktop.indexOf('  function renderTray(',start);
  const {primary,parcel,selected}=fixture();
  selected.summaryEnvelopeFeatures=[primary];selected.layers.building=[primary];
  selected.buildingInsights={building:feature(polygon(5.0045,52.0045,5.0055,52.0055),{identificatie:'bag-1'})};
  const before=plain(selected);freeze(selected);
  const rendered=[],legend={hidden:false,innerHTML:''};
  const context=vm.createContext({ui:{},state:{map:{removeLayer(){}}},$:()=>legend,
    tr:en=>en,safe:s=>s,geoToLatLng:f=>f,geometryContains:()=>true,
    L:{layerGroup:()=>({addTo(){return this;}}),geoJSON:(geometry)=>({addTo(){rendered.push(plain(geometry));}})}
  });
  vm.runInContext(desktop.slice(start,end),context);
  context.renderParcelOutline(selected,{});
  assert.deepEqual(rendered,[parcel.geometry]);
  assert.deepEqual(plain(selected),before,'Building and planning evidence remains intact for the inspector and searches');
  assert.match(legend.innerHTML,/Parcel/);assert.doesNotMatch(legend.innerHTML,/BAG|Bouwvlak/);
});
