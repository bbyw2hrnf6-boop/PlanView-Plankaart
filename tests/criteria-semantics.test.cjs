const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=require('../search-core.js');

test('parcel criteria preserve independent DE/NL/EN thresholds and unit conversions',()=>{
  const parsed=core.parseSiteCriteria('Grundstücke zwischen 500 und 2000 m², mindestens 100 m² Baufenster, maximal 10 % bebaut, mindestens 500 m Abstand zu Natura 2000');
  assert.deepEqual(parsed.siteCriteria,{...core.emptySiteCriteria(),parcelMinAreaM2:500,parcelMaxAreaM2:2000,minEnvelopeAreaM2:100,maxBuildingCoveragePercent:10,minNaturaDistanceKm:.5});
  assert.deepEqual(parsed.unsupported,[]);
  for(const [query,expected] of [
    ['Perceel minimaal 0,5 hectare',{parcelMinAreaM2:5000}],
    ['Parcel at most 2500 square metres',{parcelMaxAreaM2:2500}],
    ['Parcel exactly 1000 sqm',{parcelMinAreaM2:1000,parcelMaxAreaM2:1000}],
    ['Parcel minimum 1000 m² and maximum 2000 m²',{parcelMinAreaM2:1000,parcelMaxAreaM2:2000}],
    ['Bouwvlak minimaal 30 procent',{minEnvelopePercent:30}],
    ['Bouwvlak minimaal 30%',{minEnvelopePercent:30}],
    ['At most 0% BAG building coverage',{maxBuildingCoveragePercent:0}],
    ['No Natura 2000 within 500 m',{excludeNatura2000:true,minNaturaDistanceKm:.5}],
    ['Außerhalb von Natura2000',{excludeNatura2000:true}]
  ])for(const [key,value] of Object.entries(expected))assert.equal(core.parseSiteCriteria(query).siteCriteria[key],value,query);
});

test('uncertain, incompatible and legal numeric criteria never silently become geometry filters',()=>{
  for(const query of [
    'Parcel 1000 m²',
    'Parcel minimum 1.000 m²',
    'Baufenster mindestens 100 m² Wohnfläche',
    'Baufenster maximal 100 m²',
    'Building height at most 10 m',
    'Permitted building coverage at most 40%',
    'Grundstück mindestens -100 m²',
    'Parcel between -500 and 1000 m²',
    'BAG coverage at most -10%',
    'BAG coverage at most 120%',
    'Natura 2000 no more than 500 m away',
    'Not outside Natura 2000',
    'Parcel minimum 500 m² or building coverage maximum 30%',
    'Parcel minimum 2000 m²; parcel maximum 1000 m²'
  ])assert.ok(core.parseSiteCriteria(query).unsupported.length,query);
  assert.equal(core.parseSiteCriteria('Baufenster mindestens 100 m² Wohnfläche').siteCriteria.minEnvelopeAreaM2,null);
  assert.equal(core.parseSiteCriteria('Natura 2000 no more than 500 m away').siteCriteria.excludeNatura2000,false);
  assert.equal(core.parseSiteCriteria('Outside Natura 2000').siteCriteria.parcelMinAreaM2,null);
  assert.equal(core.parseSiteCriteria('Outside Natura 2000 at least 500 m from a train station').siteCriteria.minNaturaDistanceKm,null,'a station distance must not become a Natura distance');
});

test('site normalization preserves zero, rejects invalid scalars and flags contradictory intervals',()=>{
  const raw={parcelMinAreaM2:1000,parcelMaxAreaM2:500,maxBuildingCoveragePercent:0,minEnvelopePercent:101,minNaturaDistanceKm:Infinity,minEnvelopeAreaM2:'250',excludeNatura2000:'yes'};
  const clean=core.cleanSiteCriteria(raw);
  assert.equal(clean.maxBuildingCoveragePercent,0);
  assert.equal(clean.minEnvelopePercent,null);assert.equal(clean.minNaturaDistanceKm,null);assert.equal(clean.minEnvelopeAreaM2,null);assert.equal(clean.excludeNatura2000,false);
  assert.equal(clean.parcelMinAreaM2,1000);assert.equal(clean.parcelMaxAreaM2,500,'invalid interval is never reordered');
  assert.equal(core.siteCriteriaErrors(raw).length,5);
  assert.ok(core.resolveSiteCriteria(raw,'').unsupported.length>=5);
  const result=core.resolveSiteCriteria({parcelMinAreaM2:1200},'Parcel minimum 500 m²');
  assert.equal(result.siteCriteria.parcelMinAreaM2,1200,'validated semantic threshold remains authoritative');
  const semantic=core.resolveSiteCriteria({parcelMinAreaM2:1000},'A parcel 1000 m²',{includeParserUnsupported:false});
  assert.equal(semantic.siteCriteria.parcelMinAreaM2,1000);assert.deepEqual(semantic.unsupported,[]);
  const filled=core.resolveSiteCriteria({parcelMinAreaM2:1000},'Baufenster mindestens 100 m²',{includeParserUnsupported:false});
  assert.equal(filled.siteCriteria.minEnvelopeAreaM2,100,'confident missing criterion is still filled');
});

test('explicit zoning and plan-status exclusions do not turn nearby avoidance into a category filter',()=>{
  for(const [query,groups,statuses] of [
    ['Keine Landwirtschaft; ohne Gewerbegebiet; nicht rechtskräftig',['agrarisch','bedrijventerrein'],['onherroepelijk']],
    ['Exclude agricultural zoning and forest',['agrarisch','bos'],[]],
    ['Geen natuur; vastgesteld uitsluiten',['natuur'],['vastgesteld']],
    ['No industrial estate nearby',[],[]],
    ['No industrial estate zoning nearby',['bedrijventerrein'],[]],
    ['Not without residential zoning',[],[]],
    ['No residential areas',['woongebied'],[]],
    ['Wonen but no agrarisch',['agrarisch'],[]]
  ])assert.deepEqual(core.parseExclusions(query),{excludeGroups:groups,excludeStatuses:statuses},query);
});

test('additional TOP10NL types have separate distance operators and never consume parcel square metres',()=>{
  for(const [query,kind,minKm,maxKm] of [
    ['Within 1 km of a hospital','hospital',null,1],
    ['Mindestens 500 m vom Krankenhaus','hospital',.5,null],
    ['Volkstuinen maximaal 750 m','allotments',null,.75],
    ['Erholungsgebiet zwischen 1 und 3 km','recreation_area',1,3],
    ['Allotment garden within 2 km','allotments',null,2]
  ])assert.deepEqual(core.parseDistanceRules(query)[kind],{minKm,maxKm},query);
  for(const rule of Object.values(core.parseDistanceRules('Park und Grundstück mindestens 1000 m²')))assert.deepEqual(rule,{minKm:null,maxKm:null});
  assert.deepEqual(core.resolveRules({},'',{nearFeatures:['hospital','allotments','recreation_area']}).hospital,{minKm:null,maxKm:2});
});

test('strict interpreter schema contains every executable site and distance field',()=>{
  const schema=JSON.parse(fs.readFileSync(path.join(__dirname,'../search_filters.schema.json'),'utf8'));
  for(const key of ['siteCriteria','excludeGroups','excludeStatuses'])assert.ok(schema.required.includes(key));
  assert.deepEqual(new Set(schema.properties.siteCriteria.required),new Set(Object.keys(core.emptySiteCriteria())));
  assert.deepEqual(new Set(schema.properties.distanceRules.required),new Set(core.kinds));
  assert.equal(schema.properties.siteCriteria.additionalProperties,false);
  assert.equal(schema.properties.siteCriteria.properties.maxBuildingCoveragePercent.maximum,100);
});

test('nearest polygon optimization is equivalent to exhaustive geometry distances across holes and extents',()=>{
  const square=(x,y,size)=>({type:'Polygon',coordinates:[[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]]]});
  const items=Array.from({length:100},(_,i)=>({name:String(i),geometry:square(4+(i%10)*.1,51+Math.floor(i/10)*.1,.04)}));
  items[4].geometry.coordinates.push([[4.41,51.01],[4.43,51.01],[4.43,51.03],[4.41,51.03],[4.41,51.01]]);
  for(const point of [{lat:51.02,lng:4.42},{lat:51.09,lng:4.09},{lat:52.2,lng:5.2},{lat:50.5,lng:3.5}]) {
    const expected=items.map(item=>({item,km:core.geometryDistance(point,item.geometry)})).sort((a,b)=>a.km-b.km)[0];
    const actual=core.nearest(point,items);
    assert.equal(actual.item.name,expected.item.name);assert.equal(actual.km,expected.km);
  }
});
