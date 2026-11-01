const {test}=require('node:test');
const assert=require('node:assert/strict');
const screen=require('../parcel-screen.js');
const {geometry:g}=screen;
const rect=(w,s,e,n,properties={},id='')=>({type:'Feature',id,properties,geometry:{type:'Polygon',coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]}});
const base=rect(5,52,5.01,52.01,{kadastrale_grootte_waarde:764321,akr_kadastrale_gemeente_code_waarde:'TST00',sectie:'A',perceelnummer:1},'parcel-1');
const center={lng:5.005,lat:52.005};
function mockClient({parcels=[base],buildings=[],nature=[],overrides={},...settings}={}){
 const calls=[];
 const fetch=async(url,{signal})=>{
  calls.push(url);assert.ok(signal,'request cancellation is linked');
  const kind=Object.keys(screen.endpoints).find(k=>url.startsWith(screen.endpoints[k]));
  const value=overrides[kind]?.(url);
  if(value instanceof Error)throw value;
  const body=value===undefined?url.includes('/items')?{features:{parcel:parcels,buildings,natura2000:nature}[kind],timeStamp:'2026-10-17T12:00:00Z',links:[]}: {updated:'2026-10-10T00:00:00Z'}:value;
  return {ok:true,headers:{get:()=>null},json:async()=>body};
 };
 return {client:screen.createClient({fetch,...settings}),calls};
}
test('intersection area clips concavities, holes and multipolygons and deduplicates overlap',()=>{
 const hole=rect(5.002,52.002,5.008,52.008).geometry.coordinates[0];
 const donut={...base,geometry:{type:'Polygon',coordinates:[base.geometry.coordinates[0],hole]}};
 assert.equal(g.pointRelation(center,donut),0);
 assert.equal(g.intersectionArea(donut,rect(5.003,52.003,5.007,52.007)),0);
 const half=rect(5,52,5.005,52.01);
 const double=g.overlap(base,[half,half]);
 assert.ok(Math.abs(double.coveragePct-50)<.001,'overlapping source shapes are unioned, never double-counted');
 const multi={type:'MultiPolygon',coordinates:[rect(5,52,5.002,52.002).geometry.coordinates,rect(5.008,52.008,5.01,52.01).geometry.coordinates]};
 assert.ok(g.intersectionArea(base,multi)>0);
 assert.ok(g.area(donut)<g.area(base));
});
test('whole-polygon distance detects containment, crossing, boundary contact, holes and separate parts',()=>{
 const donut={type:'Polygon',coordinates:[base.geometry.coordinates[0],rect(5.002,52.002,5.008,52.008).geometry.coordinates[0]]};
 assert.ok(g.distance(rect(5.004,52.004,5.006,52.006),donut)>130,'inside a hole is outside protected land');
 assert.equal(g.distance(base,rect(5.009,52.009,5.02,52.02)),0);
 assert.equal(g.distance(base,rect(5.01,52,5.02,52.01)),0,'touching boundary counts as intersection');
 assert.equal(g.distance(base,rect(5.004,52.004,5.006,52.006)),0);
 const horizontal=rect(5,52.004,5.02,52.006),vertical=rect(5.009,51.99,5.011,52.02);
 assert.equal(g.distance(horizontal,vertical),0,'crossing without vertices contained is still intersection');
 const concave={type:'Polygon',coordinates:[[[5,52],[5.01,52],[5.01,52.002],[5.002,52.002],[5.002,52.01],[5,52.01],[5,52]]]};
 assert.ok(g.distance(concave,rect(5.007,52.007,5.008,52.008))>300);
});
test('inspection resolves whole parcel, official area and clipped BAG footprint with source provenance',async()=>{
 const building=rect(5.008,52.005,5.012,52.009,{status:'Pand in gebruik',identificatie:'bag-1'},'bag-feature');
 const {client,calls}=mockClient({buildings:[building]});
 const evidence=await client.inspect(center,{getEnvelopeFeatures:async(parcel)=>{assert.equal(parcel.id,'parcel-1');return {features:[rect(5,52,5.005,52.01,{},'env-1')],complete:true,sourceUpdated:'2026-07-01',sourceId:'NL.IMRO.Test'};}});
 assert.equal(evidence.parcel.areaM2,764321);assert.equal(evidence.parcel.areaMethod,'registered');
 assert.ok(evidence.parcel.geometryAreaM2>700000);assert.ok(Math.abs(evidence.buildings.coveragePct-8)<.01);
 assert.ok(Math.abs(evidence.envelope.coveragePct-50)<.01);assert.equal(evidence.envelope.source.planId,'NL.IMRO.Test');
 assert.equal(evidence.natura2000.intersects,false);assert.equal(evidence.natura2000.minDistanceM,null);assert.ok(evidence.natura2000.distanceLowerBoundM>=1000);
 assert.equal(evidence.parcel.source.updatedAt,'2026-10-10T00:00:00Z');assert.equal(evidence.buildings.source.responseTimestamp,'2026-10-17T12:00:00Z');
 assert.ok(evidence.parcel.source.featureUrl.includes('parcel-1'));
 const before=calls.length;await client.inspect(center);assert.equal(calls.length,before,'completed responses are cached');
});
test('parcel boundary, ambiguous geometry and parcel hole cannot certify a parcel',async()=>{
 assert.equal((await mockClient().client.inspect({lng:5,lat:52.005})).parcel.reason,'point-on-parcel-boundary');
 assert.equal((await mockClient({parcels:[base,{...base,id:'other'}]}).client.inspect(center)).parcel.reason,'ambiguous-parcel');
 const donut={...base,geometry:{type:'Polygon',coordinates:[base.geometry.coordinates[0],rect(5.002,52.002,5.008,52.008).geometry.coordinates[0]]}};
 assert.equal((await mockClient({parcels:[donut]}).client.inspect(center)).parcel.reason,'no-parcel-at-point');
});
test('incomplete data remains unknown for absence; positive lower bounds can still decide',async()=>{
 const {client}=mockClient({pageSize:1,maxPages:1,overrides:{parcel:url=>url.includes('/items')?{features:[base],numberMatched:1}:undefined,buildings:url=>url.includes('/items')?{features:[rect(5,52,5.005,52.01,{status:'Pand in gebruik'},'building')],links:[{rel:'next',href:screen.endpoints.buildings+'/items?offset=1'}]}:undefined,natura2000:url=>url.includes('/items')?{features:[],links:[{rel:'next',href:screen.endpoints.natura2000+'/items?offset=1'}]}:undefined}});
 const e=await client.inspect(center,{envelopeFeatures:[rect(5,52,5.005,52.01)]});
 assert.equal(e.buildings.complete,false);assert.equal(e.natura2000.intersects,null);
 assert.equal(screen.evaluate(e,{maxBuildingCoveragePercent:70,excludeNatura2000:true}).status,'unknown');
 assert.equal(screen.evaluate(e,{maxBuildingCoveragePercent:20}).status,'fail');
 assert.equal(screen.evaluate(e,{minEnvelopePercent:20}).status,'pass');
 assert.equal(screen.evaluate(e,{minEnvelopePercent:70}).status,'unknown');
 assert.equal(screen.evaluate(e,{parcelMinAreaM2:800000}).status,'fail');
});
test('Natura check measures nearest parcel edge rather than candidate point and includes whole parcel overlap',async()=>{
 const protectedArea=rect(5.0099,52.0099,5.02,52.02,{naam_n2k:'Edge nature',beschermin:'HR',status:'Designated'},'nature-1');
 const e=await mockClient({nature:[protectedArea]}).client.inspect(center,{criteria:{minNaturaDistanceKm:2}});
 assert.equal(e.natura2000.intersects,true);assert.equal(e.natura2000.minDistanceM,0);
 assert.equal(screen.evaluate(e,{excludeNatura2000:true,minNaturaDistanceKm:2}).status,'fail');
 assert.equal(e.natura2000.areas[0].id,'nature-1');
 const absent=await mockClient().client.inspect(center,{criteria:{minNaturaDistanceKm:5}});
 assert.equal(screen.evaluate(absent,{excludeNatura2000:true,minNaturaDistanceKm:5}).status,'pass','a completely queried distance buffer proves a minimum, not an exact nearest distance');
 assert.equal(absent.natura2000.minDistanceM,null);
});
test('unknown or invalid BAG features never establish unbuilt land',async()=>{
 for(const building of [rect(5,52,5.005,52.01,{}),{type:'Feature',id:'broken',properties:{status:'Pand in gebruik'},geometry:null}]){
  const e=await mockClient({buildings:[building]}).client.inspect(center);
  assert.equal(e.buildings.complete,false);assert.equal(screen.evaluate(e,{maxBuildingCoveragePercent:0}).status,'unknown');
 }
 const demolished=await mockClient({buildings:[rect(5,52,5.005,52.01,{status:'Pand gesloopt'})]}).client.inspect(center);
 assert.equal(screen.evaluate(demolished,{maxBuildingCoveragePercent:0}).status,'pass');
});
test('pagination is followed, bounded, and foreign next URLs are refused',async()=>{
 let pages=0;
 const {client}=mockClient({overrides:{buildings:url=>{
  if(!url.includes('/items'))return;
  pages++;return url.includes('offset=1')?{features:[],links:[]}:{features:[rect(5,52,5.005,52.01,{status:'Pand in gebruik'},'b')],links:[{rel:'next',href:screen.endpoints.buildings+'/items?offset=1'}]};
 }}});
 const e=await client.inspect(center);assert.equal(pages,2);assert.equal(e.buildings.complete,true);
 const bad=mockClient({overrides:{natura2000:url=>url.includes('/items')?{features:[],links:[{rel:'next',href:'https://example.com/leak'}]}:undefined}});
 assert.equal((await bad.client.inspect(center)).natura2000.complete,false);assert.ok(!bad.calls.some(url=>url.includes('example.com')));
});
test('service failures are isolated; cancellation propagates and cannot populate failed cache entries',async()=>{
 const e=await mockClient({overrides:{buildings:url=>url.includes('/items')?new Error('BAG unavailable'):undefined}}).client.inspect(center,{envelopeComplete:true});
 assert.equal(e.parcel.state,'checked');assert.equal(e.buildings.complete,false);assert.equal(e.natura2000.complete,true);
 assert.equal(screen.evaluate(e,{maxBuildingCoveragePercent:0}).status,'unknown');
 const controller=new AbortController();controller.abort();
 await assert.rejects(()=>mockClient().client.inspect(center,{signal:controller.signal}),{name:'AbortError'});
 let requests=0;
 const client=screen.createClient({fetch:async(url,{signal})=>{requests++;return await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{const e=new Error('aborted');e.name='AbortError';reject(e);},{once:true});});}});
 const active=new AbortController(),pending=client.inspect(center,{signal:active.signal});setTimeout(()=>active.abort(),5);
 await assert.rejects(pending,{name:'AbortError'});assert.equal(requests,2);
});
test('distance at a numeric threshold remains provisional within measurement tolerance',()=>{
 const e={natura2000:{complete:true,intersects:false,observedDistanceM:1000,minDistanceM:1000,distanceLowerBoundM:1000}};
 assert.equal(screen.evaluate(e,{minNaturaDistanceKm:1}).status,'unknown');
 assert.equal(screen.evaluate(e,{minNaturaDistanceKm:.9}).status,'pass');
 assert.equal(screen.evaluate(e,{minNaturaDistanceKm:1.1}).status,'fail');
});
test('explicit criteria only load required evidence; parcel-only screening avoids all extra services',async()=>{
 const {client,calls}=mockClient();let envelopeLoads=0;
 const e=await client.inspect(center,{criteria:{parcelMinAreaM2:100},getEnvelopeFeatures:async()=>{envelopeLoads++;return {features:[],complete:true};}});
 assert.equal(screen.evaluate(e,{parcelMinAreaM2:100}).status,'pass');assert.equal(envelopeLoads,0);
 assert.equal(e.buildings.reason,'not-requested');assert.equal(e.natura2000.reason,'not-requested');
 assert.ok(calls.every(url=>url.startsWith(screen.endpoints.parcel)));
});
test('explicit totals prevent false absence from short or empty final pages without a next link',async()=>{
 for(const count of [0,1]){
  const {client}=mockClient({overrides:{
   buildings:url=>url.includes('/items')?{features:count?[rect(5.02,52,5.03,52.01,{status:'Pand in gebruik'},'outside')]:[],numberMatched:count+1,links:[]}:undefined,
   natura2000:url=>url.includes('/items')?{features:count?[rect(5.02,52,5.03,52.01,{},'outside-nature')]:[],numberMatched:count+1,links:[]}:undefined
  }});
  const e=await client.inspect(center,{criteria:{maxBuildingCoveragePercent:0,excludeNatura2000:true}});
  assert.equal(e.buildings.complete,false);assert.equal(e.buildings.reason,'matched-count-incomplete');
  assert.equal(e.natura2000.complete,false);assert.equal(e.natura2000.intersects,null);
  assert.equal(screen.evaluate(e,{maxBuildingCoveragePercent:0,excludeNatura2000:true}).status,'unknown');
 }
 const {client}=mockClient({overrides:{parcel:url=>url.includes('/items')?{features:[base],numberMatched:2,links:[]}:undefined}});
 assert.equal((await client.inspect(center)).parcel.state,'unknown','an incompletely resolved parcel query cannot certify its unique parcel');
});
test('distinct IDs must satisfy a reported total across pages, including a total omitted on the final page',async()=>{
 for(const finalHasTotal of [true,false]){
  const building=rect(5.02,52,5.03,52.01,{status:'Pand in gebruik'},'repeated');
  const {client}=mockClient({overrides:{buildings:url=>{
   if(!url.includes('/items'))return;
   return url.includes('offset=1')?{features:[building],...(finalHasTotal?{numberMatched:2}:{}),links:[]}:{features:[building],numberMatched:2,links:[{rel:'next',href:screen.endpoints.buildings+'/items?offset=1'}]};
  }}});
  const e=await client.inspect(center,{criteria:{maxBuildingCoveragePercent:0}});
  assert.equal(e.buildings.complete,false);assert.equal(e.buildings.reason,'matched-count-incomplete');
  assert.equal(screen.evaluate(e,{maxBuildingCoveragePercent:0}).status,'unknown');
 }
 const {client}=mockClient({overrides:{buildings:url=>{
  if(!url.includes('/items'))return;
  const final=url.includes('offset=1'),building=rect(5.02,52,5.03,52.01,{status:'Pand in gebruik'},final?'second':'first');
  return {features:[building],numberMatched:2,links:final?[]:[{rel:'next',href:screen.endpoints.buildings+'/items?offset=1'}]};
 }}});
 const complete=await client.inspect(center,{criteria:{maxBuildingCoveragePercent:0}});
 assert.equal(complete.buildings.complete,true);assert.equal(screen.evaluate(complete,{maxBuildingCoveragePercent:0}).status,'pass');
});
