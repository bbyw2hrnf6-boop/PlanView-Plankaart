const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');

function harness(reducedMotion=false){
  const fields=new Map(),fits=[],perspectiveFits=[],stops=[];
  const element=id=>{
    if(!fields.has(id))fields.set(id,{value:'',innerHTML:'',textContent:''});
    return fields.get(id);
  };
  const context=vm.createContext({
    document:{getElementById:element,querySelectorAll:()=>[],addEventListener(){},dispatchEvent(){}},
    window:{addEventListener(){}},Event,matchMedia:()=>({matches:reducedMotion})
  });
  vm.runInContext(fs.readFileSync(require.resolve('../app.js'),'utf8')+
    '\n globalThis.fixture={state,wireControls,setMunicipalitySelection,selectProvince};',context);
  const api=context.fixture;
  api.state.region=JSON.parse(fs.readFileSync(require.resolve('../netherlands.json'),'utf8'));
  api.state.map={getZoom:()=>10,stop:()=>stops.push('2d'),fitBounds:(bounds,options)=>fits.push({bounds,options})};
  api.state.perspectiveMap={stop:()=>stops.push('3d'),fitBounds:(bounds,options)=>perspectiveFits.push({bounds,options})};
  api.wireControls();
  return {api,element,fits,perspectiveFits,stops,fit:()=>element('fit-city').onclick()};
}

test('Fit selected region retains the municipality needed by the next search',()=>{
  const h=harness(),municipality=h.api.state.region.municipalities.find(m=>m.name==='Maastricht');
  h.api.setMunicipalitySelection(municipality);
  h.fit();
  assert.equal(h.api.state.municipality,municipality.code);
  assert.equal(h.api.state.province,municipality.province);
  assert.equal(h.element('municipality').value,municipality.code);
  assert.equal(h.element('view-label').textContent,'Municipality plan overview');
  const [south,west,north,east]=municipality.bounds;
  assert.deepEqual(JSON.parse(JSON.stringify(h.fits[0].bounds)),[[south,west],[north,east]]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.perspectiveFits[0].bounds)),[[west,south],[east,north]]);
  assert.deepEqual(h.stops,['2d','3d'],'cancel any earlier flight before fitting');
  assert.equal(h.fits[0].options.animate,false,'commit before a sidebar resize can cancel the destination');
  assert.equal(h.perspectiveFits[0].options.duration,0,'3D commits the same destination immediately');
});

for(const provinceCode of ['31','all']){
  test(`Fit selected region still fits ${provinceCode==='all'?'the Netherlands':'the province'} when no municipality is selected`,()=>{
    const h=harness(true);
    h.api.selectProvince(provinceCode);
    h.fits.length=0;
    h.fit();
    assert.equal(h.api.state.municipality,'all');
    assert.equal(h.api.state.province,provinceCode);
    const selected=provinceCode==='all'?h.api.state.region.country:h.api.state.region.provinces.find(p=>p.code===provinceCode);
    const [south,west,north,east]=selected.bounds;
    assert.deepEqual(JSON.parse(JSON.stringify(h.fits[0].bounds)),[[south,west],[north,east]]);
    assert.equal(h.fits[0].options.animate,false,'reduced motion is respected');
  });
}
