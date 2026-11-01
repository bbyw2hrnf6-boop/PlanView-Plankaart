const test=require('node:test');
const assert=require('node:assert/strict');
const env=require('../environmental-sources.js');
const provenance={title:'Official model'};
const pixel=(field,value)=>({type:'FeatureCollection',features:[{properties:{[field]:value}}]});
const square={type:'Polygon',coordinates:[[[5,52],[6,52],[6,53],[5,53],[5,52]]]};
const soil=(code='zEZ21',geometry=square)=>({type:'FeatureCollection',crs:{properties:{name:'urn:ogc:def:crs:OGC:1.3:CRS84'}},features:[{geometry,properties:{soilcode:code,first_soilcode:code,first_soilname:'Hoge zwarte enkeerdgronden; leemarm en zwak lemig fijn zand',maparea_id:'V2025-1..soilarea.0000046677'}}]});
const point={lat:52.2,lng:5.5};
const response=data=>({ok:true,status:200,text:async()=>JSON.stringify(data)});
function publicResponse(url){const layer=new URL(url).searchParams.get('query_layers');return response(layer===env.LAYERS.noise?pixel('GRAY_INDEX',48):layer===env.LAYERS.soil?soil():pixel('value_list',layer===env.LAYERS.high?'63':'152'));}

test('real WMS field conventions preserve values, metric and source edition',()=>{
 const noise=env.parseNoise(pixel('GRAY_INDEX',48),provenance);assert.equal(noise.state,'complete');assert.equal(noise.metric,'Lden');assert.equal(noise.valueDb,48);
 const ground=env.parseGroundwater(pixel('value_list','63'),pixel('value_list','152'),provenance);assert.equal(ground.state,'complete');assert.equal(ground.highWaterDepthCm,63);assert.equal(ground.lowWaterDepthCm,152);
 const mapped=env.parseSoil(soil(),point,provenance);assert.equal(mapped.state,'complete');assert.deepEqual(mapped.classes.map(x=>x.id),['thick_earth']);assert.equal(mapped.source.modelVersion,'V2025-1');assert.deepEqual(mapped.rawSoilCodes,['zEZ21']);
});

test('empty, malformed, no-data and inconsistent pixels never become complete',()=>{
 for(const v of [null,'','NaN','48;63',0,'0',-9999,255,Infinity])assert.equal(env.parseNoise(pixel('GRAY_INDEX',v),provenance).state,'unknown');
 assert.match(env.parseNoise(pixel('GRAY_INDEX',0),provenance).reason,/no verified valid-data meaning/);
 assert.equal(env.parseNoise(pixel('GRAY_INDEX',8),provenance).state,'complete','positive 8 dB pixels occur in the official raster; do not invent a nodata code');
 for(const v of [null,'','NaN','63 152',255,-9999,256,-1])assert.equal(env.parseGroundwater(pixel('value_list',v),pixel('value_list',152),provenance).state,'unknown');
 assert.equal(env.parseGroundwater(pixel('value_list',0),pixel('value_list',254),provenance).state,'complete');
 assert.equal(env.parseGroundwater(pixel('value_list',152),pixel('value_list',63),provenance).state,'unknown');
 assert.equal(env.parseNoise({type:'FeatureCollection',features:[]},provenance).state,'unknown');
 assert.equal(env.parseNoise({type:'FeatureCollection',features:[{properties:{GRAY_INDEX:48}},{properties:{GRAY_INDEX:62}}]},provenance).state,'unknown');
});

test('soil uses official main groups without confusing cover or substrate with class',()=>{
 const codes={hVb:'peat',kVz:'peat',hEV:'peat',iWp:'peaty',kHn21:'podzol',Y21:'podzol',Bld6:'brik',zEZ21:'thick_earth',EL5:'thick_earth',Zn21:'sand',Sn13A:'calcareous_silt',MOo05:'unripe_mineral',Mn15A:'marine_clay',Rn44C:'river_clay',KRn8:'old_river_clay',KX:'old_clay',Ln5:'loam',MZ:'old_limburg'};
 for(const [code,id] of Object.entries(codes))assert.equal(env.classifySoilCode(code)?.id,id,code);
 for(const code of ['UNKNOWN','water','AVk','S10',''])assert.equal(env.classifySoilCode(code),null,code);
 assert.equal(env.parseSoil(soil('kVz'),point,provenance).classes[0].id,'peat');
 assert.equal(env.parseSoil(soil('Hn21/Zn21'),point,provenance).state,'unknown','associations are review evidence');
 assert.equal(env.parseSoil(soil('AB'),point,provenance).state,'unknown');
});

test('neighboring polygons, holes and truncated responses cannot supply a soil match',()=>{
 assert.equal(env.parseSoil(soil(),{lat:51.9,lng:5.5},provenance).state,'unknown');
 const withHole={...square,coordinates:[...square.coordinates,[[5.4,52.1],[5.6,52.1],[5.6,52.3],[5.4,52.3],[5.4,52.1]]]};
 assert.equal(env.parseSoil(soil('Zn21',withHole),point,provenance).state,'unknown');
 const truncated=soil();truncated.features=Array(20).fill(truncated.features[0]);assert.equal(env.parseSoil(truncated,point,provenance).state,'unknown');
});

test('queries explicitly request the center point in longitude/latitude order',()=>{
 const url=new URL(env.queryUrl(env.ENDPOINTS.groundwater,env.LAYERS.high,point)),p=url.searchParams,bbox=p.get('bbox').split(',').map(Number);
 assert.equal(p.get('srs'),'EPSG:4326');assert.equal(p.get('version'),'1.1.1');assert.equal(p.get('x'),'1');assert.equal(p.get('width'),'3');assert.equal(p.get('info_format'),'application/json');assert.ok(Math.abs((bbox[0]+bbox[2])/2-point.lng)<1e-10);assert.ok(Math.abs((bbox[1]+bbox[3])/2-point.lat)<1e-10);
});

test('inspect requests only enabled sources, caches complete exact points and expires entries',async()=>{
 let time=1000,calls=[];const client=env.createClient({fetch:async(url,options)=>{calls.push(url);assert.equal(options.credentials,'omit');return publicResponse(url);},now:()=>time,cacheTtlMs:100});
 const result=await client.inspect(point,{noise:true,soil:true,groundwater:true});assert.equal(calls.length,4);assert.equal(result.groundwater.state,'complete');assert.equal(result.noise.source.units,'dB');assert.equal(result.noise.source.numericMetric,'Lden');assert.equal(result.noise.source.catalogueName,'Geluid in Nederland (Lg)');assert.match(result.noise.source.rasterArchiveUrl,/rivm_20250801_Geluid_lden_allebronnen_2022\.zip$/);assert.equal(result.groundwater.source.resolutionMeters,50);
 result.noise.valueDb=999;assert.equal((await client.inspect(point,{noise:true})).noise.valueDb,48);assert.equal(calls.length,4);
 await client.inspect({...point,lng:point.lng+1e-7},{noise:true});assert.equal(calls.length,5,'no rounding across pixel boundaries');
 time+=101;await client.inspect(point,{noise:true});assert.equal(calls.length,6);
 assert.deepEqual(await client.inspect(point,{}),{});
});

test('source failures remain independent unknown results and are not success-cached',async()=>{
 let failures=0;const client=env.createClient({fetch:async url=>{if(url.startsWith(env.ENDPOINTS.noise)){failures++;throw new TypeError('Network request failed');}return publicResponse(url);}});
 const result=await client.inspect(point,{noise:true,soil:true});assert.equal(result.noise.state,'unknown');assert.equal(result.soil.state,'complete');await client.inspect(point,{noise:true});assert.equal(failures,2);
 const mixed=env.createClient({fetch:async url=>new URL(url).searchParams.get('query_layers')===env.LAYERS.low?response({type:'FeatureCollection',features:[]}):publicResponse(url)});
 const ground=(await mixed.inspect(point,{groundwater:true})).groundwater;assert.equal(ground.state,'unknown');assert.equal(ground.highWaterDepthCm,63);assert.equal(ground.lowWaterDepthCm,undefined);
});

test('timeouts are unknown but caller cancellation propagates and does not populate cache',async()=>{
 let calls=0;const blocked=async(url,{signal})=>{calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{const e=new Error('Aborted');e.name='AbortError';reject(e);},{once:true}));};
 const client=env.createClient({fetch:blocked,timeoutMs:10});assert.equal((await client.inspect(point,{noise:true})).noise.state,'unknown');
 const controller=new AbortController();const pending=client.inspect(point,{noise:true,signal:controller.signal});controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,2);
 await assert.rejects(client.inspect(point,{noise:true,signal:controller.signal}),{name:'AbortError'});assert.equal(calls,2);
});

test('unsupported coordinates never query a service',async()=>{
 const client=env.createClient({fetch:async()=>{throw new Error('Must not fetch');}});const result=await client.inspect({lat:40,lng:5},{noise:true,soil:true,groundwater:true});assert.ok(Object.values(result).every(item=>item.state==='unknown'));
});
