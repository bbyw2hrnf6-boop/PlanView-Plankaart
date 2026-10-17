const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../search-core.js');

test('distance grammar keeps units, min/max/range and independent EN/NL/DE criteria',()=>{
  for(const [query,kind,minKm,maxKm] of [
    ['Within 500 m of a train station','station',null,.5],
    ['Mindestens 2 km vom Bahnhof','station',2,null],
    ['Hoogstens 750 meter van een zwembad','swimming_pool',null,.75],
    ['Zwischen 500 m und 2 km vom Campingplatz','camping',.5,2],
    ['Between 1 and 3 km of a cemetery','cemetery',1,3],
    ['Tussen 250 meter en 1,5 km van een sportterrein','sports',.25,1.5],
    ['Park within 1 km; marina at least 2 km away','marina',2,null],
    ['Bahnhof 300 m und Park 2 km','park',null,2],
    ['Within 1 km of a holiday park','camping',null,1]
  ])assert.deepEqual(core.parseDistanceRules(query)[kind],{minKm,maxKm},query);
  const separate=core.parseDistanceRules('Within 300 m of a train station and 2 km of a park');
  assert.deepEqual(separate.station,{minKm:null,maxKm:.3});assert.deepEqual(separate.park,{minKm:null,maxKm:2});
  assert.deepEqual(core.parseDistanceRules('Within 1 km of a holiday park').park,{minKm:null,maxKm:null});
});

test('AI distance survives when grammar cannot confidently associate a term; defaults only fill missing active criteria',()=>{
  const rules=core.resolveRules({station:{minKm:1,maxKm:4}},'I want rail access nearby',{nearFeatures:['station']});
  assert.deepEqual(rules.station,{minKm:1,maxKm:4});
  assert.deepEqual(rules.camping,{minKm:null,maxKm:null});
  assert.deepEqual(core.resolveRules({},'near a station',{nearFeatures:['station']}).station,{minKm:null,maxKm:3});
  assert.deepEqual(core.resolveRules({station:{minKm:.5,maxKm:3}},'not closer than 500 m and at most 3 km from a train station',{nearFeatures:['station']}).station,{minKm:.5,maxKm:3});
  assert.deepEqual(core.resolveRules({},'No industry within 1200 m',{avoidIndustry:true}).industry,{minKm:1.2,maxKm:null});
  const manual=core.resolveRules({},'',{nearFeatures:['station'],avoidIndustry:true,distanceKm:{station:.4,industry:2}});
  assert.deepEqual(manual.station,{minKm:null,maxKm:.4});assert.deepEqual(manual.industry,{minKm:2,maxKm:null});
});

test('polygon distance respects concavity, holes and multipolygon parts',()=>{
  const outer=[[5,52],[5.02,52],[5.02,52.02],[5,52.02],[5,52]],hole=[[5.005,52.005],[5.015,52.005],[5.015,52.015],[5.005,52.015],[5.005,52.005]];
  const geometry={type:'Polygon',coordinates:[outer,hole]};
  assert.equal(core.geometryDistance({lat:52.002,lng:5.002},geometry),0);
  assert.ok(core.geometryDistance({lat:52.01,lng:5.01},geometry)>.3,'point in hole is not inside site');
  const triangle={type:'Polygon',coordinates:[[[5,52],[5.02,52],[5,52.02],[5,52]]]};
  assert.ok(core.geometryDistance({lat:52.018,lng:5.018},triangle)>.5,'bbox corner is outside triangle');
  assert.equal(core.geometryDistance({lat:52.002,lng:5.002},{type:'MultiPolygon',coordinates:[[[[6,53],[6.01,53],[6,53.01],[6,53]]],geometry.coordinates]}),0);
});

test('extent-only distance cannot certify precise matching or falsely fail a minimum',()=>{
  const near=core.nearest({lat:52.01,lng:5.01},[{extent:[5,52,5.02,52.02],point:{lat:52.01,lng:5.01}}]);
  assert.equal(near.accuracy,'extent');
  assert.deepEqual(core.checkDistance(near,{minKm:1,maxKm:null}),{pass:true,uncertain:true});
  assert.deepEqual(core.checkDistance(near,{minKm:null,maxKm:.1}),{pass:true,uncertain:true});
  assert.deepEqual(core.checkDistance(null,{minKm:1,maxKm:null}),{pass:true,uncertain:true});
  assert.deepEqual(core.checkDistance({km:2,accuracy:'geometry'},{minKm:null,maxKm:1}),{pass:false,uncertain:false});
  assert.deepEqual(core.checkDistance({km:.5,accuracy:'point'},{minKm:1,maxKm:2}),{pass:false,uncertain:false});
});

test('result keys preserve distinct building envelopes and plan versions',()=>{
  const a={sourceId:'NL.IMRO.A',envelopeId:'a',feature:{properties:{identificatie:'one-designation'}}};
  const b={...a,envelopeId:'b'},c={...a,sourceId:'NL.IMRO.B'};
  assert.notEqual(core.resultKey(a),core.resultKey(b));assert.notEqual(core.resultKey(a),core.resultKey(c));
});
