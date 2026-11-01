const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const core=require('../search-core.js');

test('environment grammar preserves independent numeric criteria in German, Dutch and English',()=>{
  for(const [query,expected] of [
    ['Lärm höchstens 50 dB; Hangneigung maximal 5 Grad; Grundwasser mindestens 1,2 m unter Gelände',{maxNoiseDb:50,maxSlopeDeg:5,minGroundwaterDepthCm:120}],
    ['Geluid maximaal 45 dB; helling hoogstens 5 graden; grondwater minimaal 80 cm',{maxNoiseDb:45,maxSlopeDeg:5,minGroundwaterDepthCm:80}],
    ['Noise at most 55 dB(A); slope no more than 3 degrees; groundwater at least 100 cm below ground',{maxNoiseDb:55,maxSlopeDeg:3,minGroundwaterDepthCm:100}],
    ['Grundwasser mindestens 1 m unter dem Boden; Lärm 50 dB maximal',{minGroundwaterDepthCm:100,maxNoiseDb:50}],
    ['Slope at most 0°; noise at most 0 dB; GHG at least 0 cm',{maxNoiseDb:0,maxSlopeDeg:0,minGroundwaterDepthCm:0}],
    ['Gesamtpegel Lden höchstens 50 dB',{maxNoiseDb:50}],
    ['Totaalgeluid Lden maximaal 45 dB',{maxNoiseDb:45}],
    ['Total Lden noise at most 55 dB',{maxNoiseDb:55}]
  ]) {
    const result=core.parseEnvironmentCriteria(query);
    assert.deepEqual(result.environmentCriteria,{...core.emptyEnvironmentCriteria(),...expected},query);
    assert.deepEqual(result.unsupported,[],query);
    assert.deepEqual(core.parseSiteCriteria(query).unsupported,[],query+' does not become an unsupported parcel filter');
  }
});

test('terrain percentage is converted to an angle and never borrowed from BAG coverage',()=>{
  const result=core.parseEnvironmentCriteria('Hangneigung maximal 10%');
  assert.ok(Math.abs(result.environmentCriteria.maxSlopeDeg-5.710593137499643)<1e-12);
  assert.equal(core.parseEnvironmentCriteria('Slope at most 100 percent').environmentCriteria.maxSlopeDeg,45);
  assert.equal(core.parseEnvironmentCriteria('BAG coverage at most 10%; parcel at least 1000 m²').environmentCriteria.maxSlopeDeg,null);
  assert.deepEqual(core.parseSiteCriteria('BAG coverage at most 10%; parcel at least 1000 m²').unsupported,[]);
  const ambiguous=core.parseEnvironmentCriteria('BAG coverage at most 10% with slope');
  assert.equal(ambiguous.environmentCriteria.maxSlopeDeg,null);assert.ok(ambiguous.unsupported.length);
});

test('acoustic metrics and unsupported threshold directions remain explicit',()=>{
  for(const query of [
    'Lnight maximaal 40 dB','Lmax at most 50 dB','Indoor noise at most 35 dB',
    'Facade Lden at most 50 dB','Gesetzlichen Lden Grenzwert von höchstens 50 dB einhalten','Legal noise compliance at most 50 dB','Wettelijk geluid maximaal 50 dB',
    'Noise at least 50 dB','Noise exactly 50 dB','Noise at most 150 dB',
    'Slope between 3 and 5 degrees','Slope at least 4°','Slope at most 100 degrees',
    'Grundwasser maximal 100 cm','GLG mindestens 100 cm','Grundwasser mindestens 1 m NAP',
    'Groundwater at least 110 m below ground','Groundwater at least -1 m',
    'Ebenes Grundstück','Boden ohne Torf','Soil bearing capacity at least 200 kPa',
    'Soil sand at 1 m depth','Peat on sand soil','Noise at most 50 dB or slope at most 5°'
  ])assert.ok(core.parseEnvironmentCriteria(query).unsupported.length,query);
  assert.deepEqual(core.parseEnvironmentCriteria('Quiet and peaceful').environmentCriteria,core.emptyEnvironmentCriteria(),'a qualitative quiet preference never invents a numeric limit');
  assert.equal(core.parseEnvironmentCriteria('Lden höchstens 50 dB').environmentCriteria.maxNoiseDb,50);
  assert.equal(core.parseEnvironmentCriteria('Facade Lden at most 50 dB').environmentCriteria.maxNoiseDb,null);
});

test('soil filters use verified BRO main classes and preserve mapping explanation',()=>{
  assert.equal(core.soilClasses.length,14);
  assert.deepEqual(core.parseEnvironmentCriteria('Oude rivierkleigronden').environmentCriteria.soilClasses,['old_river_clay']);
  assert.deepEqual(core.parseEnvironmentCriteria('Zandgronden').environmentCriteria.soilClasses,['sand'],'an explicit official class stays exact');
  assert.deepEqual(core.parseEnvironmentCriteria('Lehmboden').environmentCriteria.soilClasses,['loam'],'loam does not invent Brikgronden');
  const sand=core.parseEnvironmentCriteria('Sandboden');
  assert.deepEqual(sand.environmentCriteria.soilClasses,['sand','podzol']);assert.ok(sand.explanationNotes.length);
  const clay=core.parseEnvironmentCriteria('Bodem klei');
  assert.deepEqual(clay.environmentCriteria.soilClasses,['marine_clay','river_clay','old_river_clay','old_clay']);assert.ok(clay.explanationNotes.length);
  const alternatives=core.parseEnvironmentCriteria('Boden Sand oder Lehm');
  assert.deepEqual(new Set(alternatives.environmentCriteria.soilClasses),new Set(['sand','podzol','loam']));assert.deepEqual(alternatives.unsupported,[]);
  assert.deepEqual(core.parseEnvironmentCriteria('Peat on sand soil').environmentCriteria.soilClasses,[],'layered materials never become invented main classes');
});

test('OR is allowed only for complete soil lists, never mixed criteria or ambiguous scope',()=>{
  for(const query of ['Boden Sand oder Lehm','Zand of klei','either sand or loam soil','Bodemtype: Zandgronden of Podzolgronden','Soil: marine clay or old river clay','Boden Sand oder Lehm; Lärm höchstens 50 dB','Within 1 km of a hospital','Parcel 500 m² or more','Slope less than or equal to 5 degrees'])assert.equal(core.hasUnsupportedAlternatives(query),false,query);
  for(const query of ['Sand oder maximal 50 dB Lärm','Lärm höchstens 50 dB oder Hangneigung maximal 5 Grad','Within 1 km of a hospital or within 2 km of a park','Boden Sand oder Lehm und Lärm höchstens 50 dB','Lärm höchstens 50 dB und Sand oder Lehm','Sand oder Lehm mit Grundwasser mindestens 1 m','Sand oder unbelasteter Lehm','Boden Sand oder ohne Lehm','Sand oder 50% Lehm','Zand of helling maximaal 5 graden','Bodem zand of binnen 1 km van een ziekenhuis','Geluid maximaal 50 dB of grondwater minimaal 100 cm','Sand or more groundwater depth','Sand or equal noise'])assert.equal(core.hasUnsupportedAlternatives(query),true,query);
});

test('environment normalization validates bounds, preserves zero and keeps semantic values authoritative',()=>{
  const raw={maxNoiseDb:0,maxSlopeDeg:91,minGroundwaterDepthCm:Infinity,soilClasses:['sand','made-up']};
  assert.deepEqual(core.cleanEnvironmentCriteria(raw),{...core.emptyEnvironmentCriteria(),maxNoiseDb:0,soilClasses:['sand']});
  assert.equal(core.environmentCriteriaErrors(raw).length,3);
  assert.equal(core.resolveEnvironmentCriteria(raw).unsupported.length,3);
  const resolved=core.resolveEnvironmentCriteria({maxNoiseDb:55},'Noise at most 50 dB; slope at most 10%',{includeParserUnsupported:false});
  assert.equal(resolved.environmentCriteria.maxNoiseDb,55);assert.ok(Math.abs(resolved.environmentCriteria.maxSlopeDeg-5.710593137499643)<1e-12);
  assert.equal(core.environmentCriteriaErrors({maxNoiseDb:'50'}).length,1);assert.equal(core.environmentCriteriaErrors({soilClasses:'sand'}).length,1);
});

test('strict interpreter schema uses the same environment fields, soil classes and validation ranges',()=>{
  const schema=JSON.parse(fs.readFileSync(path.join(__dirname,'../search_filters.schema.json'),'utf8'));
  assert.ok(schema.required.includes('environmentCriteria'));
  const environment=schema.properties.environmentCriteria;
  assert.equal(environment.additionalProperties,false);
  assert.deepEqual(new Set(environment.required),new Set(Object.keys(core.emptyEnvironmentCriteria())));
  assert.deepEqual(environment.properties.soilClasses.items.enum,core.soilClasses);
  for(const [key,max] of Object.entries({maxNoiseDb:140,maxSlopeDeg:90,minGroundwaterDepthCm:10000})) {
    assert.equal(environment.properties[key].minimum,0);assert.equal(environment.properties[key].maximum,max);
  }
});

test('manual and preview controls round-trip zero and multiple official soil classes',()=>{
  const ctx=vm.createContext({window:{PlanViewSearchCore:core},document:{documentElement:{lang:'de'}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../search-criteria-ui.js'),'utf8'),ctx);
  const ui=ctx.window.PlanViewCriteriaUI;
  const markup=ui.environmentMarkup({maxNoiseDb:0,maxSlopeDeg:5,minGroundwaterDepthCm:100,soilClasses:['sand','podzol']},true);
  assert.match(markup,/data-environment-criterion="maxNoiseDb" value="0"/);
  assert.match(markup,/Gesamtpegel Lden/);assert.match(markup,/GHG/);assert.match(markup,/step="any"/);
  assert.equal((markup.match(/data-environment-soil=/g)||[]).length,14);
  const fake={querySelectorAll:selector=>selector==='[data-environment-criterion]'?[
    {dataset:{environmentCriterion:'maxNoiseDb'},value:'0'},
    {dataset:{environmentCriterion:'maxSlopeDeg'},value:'5.710593137499643'},
    {dataset:{environmentCriterion:'minGroundwaterDepthCm'},value:''}
  ]:[{dataset:{environmentSoil:'sand'}},{dataset:{environmentSoil:'podzol'}}]};
  assert.deepEqual(JSON.parse(JSON.stringify(ui.readEnvironment(fake))),{maxNoiseDb:0,maxSlopeDeg:5.710593137499643,minGroundwaterDepthCm:null,soilClasses:['sand','podzol']});
  for(const key of core.soilClasses)assert.notEqual(ui.text('soil_'+key),'soil_'+key);
});
