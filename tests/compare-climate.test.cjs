const test=require('node:test');
const assert=require('node:assert/strict');
const climate=require('../compare-climate.js');
const point={lat:51.807,lng:4.68};
const pixel=value=>({type:'FeatureCollection',features:[{type:'Feature',geometry:null,properties:{GRAY_INDEX:value}}]});
const response=data=>({ok:true,status:200,text:async()=>JSON.stringify(data)});
const source={title:'Official model',retrievedAt:'2026-10-17T19:00:00Z'};

test('verified raw metre values become centimetres without changing scenario or scope',()=>{
 const rain=climate.parseDepth('rain',pixel(0.04399999976158142),source);
 assert.equal(rain.state,'complete');assert.ok(Math.abs(rain.value-4.4)<1e-6);assert.equal(rain.unit,'cm');assert.equal(rain.scope,'point');assert.match(rain.scenario,/70 mm in 1 Stunde/);assert.equal(rain.source,source);assert.match(rain.interpretation,/kein Grundstücksmaximum/);
 const flood=climate.parseDepth('flood',pixel('2.571500062942505'),source);assert.ok(Math.abs(flood.value-257.15)<1e-4);assert.match(flood.scenario,/1:1.000/);assert.match(flood.scenario,/heutige/);
});

test('NoData, ambiguous zero, empty and malformed values remain unknown without invented zero',()=>{
 for(const kind of ['flood','rain'])for(const value of [-9999,0,'0',-1,null,'','NaN','4 cm','1;2',Infinity,100,9999]){
  const result=climate.parseDepth(kind,pixel(value),source);assert.equal(result.state,'unknown',kind+':'+value);assert.equal(result.value,null);assert.ok(result.reason);assert.equal(result.unit,'cm');
 }
 assert.equal(climate.parseDepth('rain',pixel(-9999),source).reasonCode,'nodata');assert.match(climate.parseDepth('rain',pixel(-9999),source).reason,/keine Entwarnung/);
 assert.equal(climate.parseDepth('flood',pixel(0),source).reasonCode,'unverified_zero');
 for(const data of [{},{type:'FeatureCollection',features:[]},{type:'FeatureCollection',features:[...pixel(.2).features,...pixel(.2).features]}])assert.equal(climate.parseDepth('rain',data,source).state,'unknown');
});

test('queries exactly one cell on each native RD grid, with no raster downsampling',()=>{
 const [x,y]=climate._test.wgs84ToRd(point);
 for(const kind of ['flood','rain']){
  const d=climate.DEFINITIONS[kind],url=new URL(climate.queryUrl(kind,point)),p=url.searchParams,b=p.get('bbox').split(',').map(Number);
  assert.equal(p.get('crs'),'EPSG:28992');assert.equal(p.get('width'),'1');assert.equal(p.get('height'),'1');assert.equal(p.get('i'),'0');assert.equal(p.get('j'),'0');assert.equal(p.get('query_layers'),d.layer);assert.equal(p.get('info_format'),'application/json');
  assert.equal(b[2]-b[0],d.resolutionM);assert.equal(b[3]-b[1],d.resolutionM);assert.equal((b[0]-d.origin[0])%d.resolutionM,0);assert.equal((b[1]-d.origin[1])%d.resolutionM,0);assert.ok(b[0]<=x&&x<b[2]&&b[1]<=y&&y<b[3]);
 }
 assert.equal(climate.DEFINITIONS.rain.resolutionM,.5);assert.equal(climate.DEFINITIONS.flood.resolutionM,5);
 assert.equal(climate.queryUrl('rain',{lat:54,lng:4}),null);
});

test('inspection provides current source edition, sample footprint and retrieval provenance',async()=>{
 const calls=[];const client=climate.createClient({now:()=>Date.UTC(2026,9,17,19),fetch:async(url,options)=>{calls.push(url);assert.equal(options.credentials,'omit');assert.equal(options.mode,'cors');return response(pixel(.12));}});
 const result=await client.inspect(point);assert.equal(calls.length,2);
 for(const kind of ['flood','rain']){
  const r=result[kind];assert.equal(r.state,'complete');assert.equal(r.value,12);assert.equal(r.source.retrievedAt,'2026-10-17T19:00:00.000Z');assert.equal(r.source.attribution,'Klimaateffectatlas, 2026');assert.equal(r.source.license,'CC BY 4.0');assert.equal(r.source.noDataValue,-9999);assert.equal(r.source.nativeUnit,'m');assert.deepEqual(r.source.samplePoint,point);assert.equal(r.source.queryUrls.length,1);assert.equal(r.source.sampledCell.crs,'EPSG:28992');assert.match(r.source.method,/kein Maximum/);assert.equal(r.source.viewerUrl,climate.VIEWER);
 }
 assert.equal(result.rain.source.modelVersion,'20260810');assert.equal(result.flood.source.modelVersion,'20260128');assert.match(result.rain.source.dataPeriod,/je Gebiet unterschiedlich/);
});

test('independent source failures preserve successful depth values and official links',async()=>{
 const client=climate.createClient({fetch:async url=>{if(url.startsWith(climate.DEFINITIONS.rain.endpoint))throw new TypeError('Network request failed');return response(pixel(.27));}});
 const result=await client.inspect(point);assert.equal(result.flood.state,'complete');assert.equal(result.rain.state,'unknown');assert.equal(result.rain.value,null);assert.equal(result.rain.reasonCode,'unavailable');assert.equal(result.rain.source.url,climate.DEFINITIONS.rain.url);
 const malformed=climate.createClient({fetch:async()=>({ok:true,text:async()=>'<ServiceException/>'})});assert.equal((await malformed.inspect(point,{flood:false})).rain.state,'unknown');
});

test('cache is bounded, keeps exact points, returns clones and expires unknowns sooner',async()=>{
 let time=1000,calls=0,raw=.2;const client=climate.createClient({fetch:async()=>{calls++;return response(pixel(raw));},now:()=>time,cacheTtlMs:1000,unknownTtlMs:20,maxCache:2});
 const first=await client.inspect(point,{flood:false});first.rain.value=500;assert.equal((await client.inspect(point,{flood:false})).rain.value,20);assert.equal(calls,1);
 await client.inspect({...point,lng:point.lng+1e-9},{flood:false});assert.equal(calls,2,'point provenance is never rounded');
 await client.inspect({...point,lng:point.lng+2e-9},{flood:false});await client.inspect(point,{flood:false});assert.equal(calls,4,'least recent entry evicted');
 time+=1001;raw=-9999;assert.equal((await client.inspect(point,{flood:false})).rain.state,'unknown');assert.equal(calls,5);raw=.12;assert.equal((await client.inspect(point,{flood:false})).rain.state,'unknown');assert.equal(calls,5);
 time+=21;assert.equal((await client.inspect(point,{flood:false})).rain.value,12);assert.equal(calls,6);client.clearCache();await client.inspect(point,{flood:false});assert.equal(calls,7);
});

test('HTTP failure, excessive response and timeout remain unknown',async()=>{
 for(const fetch of [async()=>({ok:false,status:503}),async()=>({ok:true,headers:{get:()=>String(400*1024)},text:async()=>{throw new Error('Must not read oversized body');}}),async()=>({ok:true,text:async()=>'.'.repeat(400*1024)})]){
  const client=climate.createClient({fetch});assert.equal((await client.inspect(point,{rain:false})).flood.state,'unknown');
 }
 const client=climate.createClient({timeoutMs:5,fetch:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{const error=new Error('Aborted');error.name='AbortError';reject(error);},{once:true}))});
 const result=await client.inspect(point,{rain:false});assert.equal(result.flood.state,'unknown');assert.match(result.flood.reason,/nicht rechtzeitig/);
});

test('caller cancellation propagates and never caches incomplete work',async()=>{
 let calls=0;const client=climate.createClient({fetch:async(url,{signal})=>{calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{const error=new Error('Aborted');error.name='AbortError';reject(error);},{once:true}));}});
 const controller=new AbortController(),pending=client.inspect(point,{signal:controller.signal});controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,2);
 await assert.rejects(client.inspect(point,{signal:controller.signal}),{name:'AbortError'});assert.equal(calls,2);
});

test('invalid or out-of-country coordinates make no requests and never suggest safe conditions',async()=>{
 const client=climate.createClient({fetch:async()=>{throw new Error('Must not fetch');}});
 for(const point of [null,{lat:NaN,lng:5},{lat:40,lng:5},{lat:52,lng:9}]){
  const result=await client.inspect(point);assert.equal(Object.keys(result).length,2);for(const r of Object.values(result)){assert.equal(r.state,'unknown');assert.equal(r.value,null);assert.equal(r.reasonCode,'outside_extent');assert.equal(r.source.queryUrls.length,0);}
 }
 assert.deepEqual(await client.inspect(point,{flood:false,rain:false}),{});
});
