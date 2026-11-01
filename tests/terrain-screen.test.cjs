const test=require('node:test');
const assert=require('node:assert/strict');
const terrain=require('../terrain-screen.js');
// The browser bundle references Worker at load time; decoding below is on the
// calling thread and never instantiates a worker or uses a network dependency.
const oldWorker=global.Worker;global.Worker=class{};
const GeoTIFF=require('../vendor/geotiff-2.1.3.js');global.Worker=oldWorker;
const helper=terrain._test;
const ring=(a,b,c,d)=>[[a,b],[c,b],[c,d],[a,d],[a,b]];
const grid=(polygons=[ [ring(5,5,15,15)] ])=>({width:40,height:40,box:[0,0,20,20],polygons,scope:'parcel'});
const plane=(request,dx=0,dy=0)=>Float32Array.from({length:request.width*request.height},(_,i)=>30+dx*(i%request.width)*.5+dy*Math.floor(i/request.width)*.5);
// A real uncompressed Float32 GeoTIFF fixture, with RD pixel-area georeferencing.
// Tests the actual vendored decoder, not just a stub matching our implementation.
function tiff(request,values,overrides={}) {
 const {width,height,box}=request;
 const tags=[[256,4,[width]],[257,4,[height]],[258,3,[32]],[259,3,[1]],[262,3,[1]],[273,4,[0]],[277,3,[1]],[278,4,[height]],[279,4,[values.length*4]],[284,3,[1]],[339,3,[3]],[33550,12,[overrides.resolution||.5,.5,0]],[33922,12,[0,0,0,box[0],box[3],0]],[34735,3,[1,1,0,4,1024,0,1,1,1025,0,1,1,3072,0,1,overrides.crs||28992,3076,0,1,9001]],[42113,2,Array.from('3.4028234663852886e+38\0',c=>c.charCodeAt(0))]].sort((a,b)=>a[0]-b[0]);
 const sizes={2:1,3:2,4:4,12:8};let cursor=8+2+tags.length*12+4;
 for(const t of tags)if(t[2].length*sizes[t[1]]>4){cursor=Math.ceil(cursor/8)*8;t[3]=cursor;cursor+=t[2].length*sizes[t[1]];}
 cursor=Math.ceil(cursor/8)*8;tags.find(t=>t[0]===273)[2][0]=cursor;
 const buffer=new ArrayBuffer(cursor+values.length*4),v=new DataView(buffer);v.setUint16(0,0x4949,true);v.setUint16(2,42,true);v.setUint32(4,8,true);v.setUint16(8,tags.length,true);
 tags.forEach((t,i)=>{const pos=10+i*12;v.setUint16(pos,t[0],true);v.setUint16(pos+2,t[1],true);v.setUint32(pos+4,t[2].length,true);if(t[3])v.setUint32(pos+8,t[3],true);let off=t[3]||pos+8;for(const n of t[2]){if(t[1]===2)v.setUint8(off,n);if(t[1]===3)v.setUint16(off,n,true);if(t[1]===4)v.setUint32(off,n,true);if(t[1]===12)v.setFloat64(off,n,true);off+=sizes[t[1]];}});
 values.forEach((n,i)=>v.setFloat32(cursor+i*4,n,true));return buffer;
}
const point={lng:5.69,lat:50.84};
const request=helper.target(point);
function client(buffer,options={}) {
 const calls=[];const api=terrain.createClient({GeoTIFF,now:()=>1792240000000,...options,fetch:async(url,init)=>{calls.push(url);return new Response(url.includes('GetCapabilities')?'<ows:Abstract>Het betreft versie 4, opgenomen in 2020, 2021 en 2022.</ows:Abstract>':buffer,{headers:{'Content-Type':url.includes('GetCapabilities')?'text/xml':'image/tiff'}});}});
 return {api,calls};
}
test('Horn slope has correct units for x and y gradients',async()=>{
 const g=grid(),dx=.2,dy=.3,result=await helper.analyze(plane(g,dx,dy),g,3.4028234663852886e38);
 assert.equal(result.state,'complete');assert.equal(result.coverage.scope,'parcel');
 assert.ok(Math.abs(result.maxSlopeDeg-Math.atan(Math.hypot(dx,dy))*180/Math.PI)<.001);
 assert.ok(Math.abs(result.meanSlopeDeg-result.maxSlopeDeg)<.001);
});
test('hole interiors do not enter the parcel slope maximum; multipolygon islands do',async()=>{
 const g=grid([[ring(2,2,18,18),ring(5,5,15,15)],[ring(.1,.1,.2,.2)]]),values=plane(g);
 values[20*g.width+20]=200;const result=await helper.analyze(values,g,null);
 assert.equal(result.maxSlopeDeg,0); // Hill is well inside the excluded hole.
 const mask=helper.makeMask(g.polygons,g.box,g.width,g.height);
 assert.equal(mask[20*g.width+20],0);assert.equal(mask[39*g.width],1); // Tiny island retained, no center required.
 assert.equal(result.state,'unknown'); // Island touches raster edge: required halo absent in this fixture.
});
test('sliver and boundary cells are included rather than disappearing between grid centers',()=>{
 const g=grid([[ring(5.01,5.01,5.02,5.02)]]),mask=helper.makeMask(g.polygons,g.box,g.width,g.height);
 assert.equal(mask.reduce((a,b)=>a+b,0),1);
 const boundary=helper.makeMask([[ring(5,5,5.5,5.5)]],g.box,g.width,g.height);
 assert.equal(boundary.reduce((a,b)=>a+b,0),9); // Closed boundaries conservatively touch neighbors.
});
test('NoData in one required gradient neighborhood makes coverage unknown',async()=>{
 const g=grid(),values=plane(g);values[20*g.width+20]=3.4028234663852886e38;
 const result=await helper.analyze(values,g,3.4028234663852886e38);
 assert.equal(result.state,'unknown');assert.equal(result.coverage.missingCells,9);assert.equal(result.maxSlopeDeg,0);assert.equal(result.lowerBound,true);
});
test('NaN and absent samples never count as flat terrain',async()=>{
 const g=grid(),values=plane(g);values.fill(NaN);
 const result=await helper.analyze(values,g,null);
 assert.equal(result.state,'unknown');assert.equal(result.maxSlopeDeg,null);assert.equal(result.coverage.validCells,0);
});
test('real Float32 GeoTIFF decoder and native grid preserve a known slope and source dates',async()=>{
 const {api,calls}=client(tiff(request,plane(request,.1,0)));
 const result=await api.inspect(point);
 assert.equal(result.state,'complete');assert.equal(result.coverage.scope,'point-neighborhood');assert.equal(result.coverage.neighborhoodWidthM,40);
 assert.ok(Math.abs(result.maxSlopeDeg-Math.atan(.1)*180/Math.PI)<.001);
 assert.equal(result.source.dataDate,'2020, 2021, 2022');assert.equal(result.source.datasetVersion,'AHN4');assert.equal(result.source.crs,'EPSG:28992');
 assert.match(result.source.url,/coverageId=dtm_05m/);assert.doesNotMatch(result.source.url,/scale|resample|width|height/i);
 await api.inspect(point);assert.equal(calls.length,2); // Raster and capabilities cache keep original provenance.
});
test('whole parcel GeoJSON uses the same native coverage contract',async()=>{
 const geometry={type:'MultiPolygon',coordinates:[[ring(5.6899,50.8399,5.6901,50.8401)],[ring(5.6902,50.8402,5.69021,50.84021)]]};
 const r=helper.target(point,geometry),{api}=client(tiff(r,plane(r)));
 const result=await api.inspect(point,{geometry});assert.equal(result.state,'complete');assert.equal(result.coverage.scope,'parcel');assert.equal(result.maxSlopeDeg,0);
});
test('unexpected CRS or resampled TIFF cannot satisfy the filter',async()=>{
 for(const overrides of [{crs:4326},{resolution:1}]){
  const {api}=client(tiff(request,plane(request),overrides)),result=await api.inspect(point);
  assert.equal(result.state,'unknown');assert.match(result.reason,/unexpected-raster-(grid|reference)/);
 }
});
test('large parcel has explicit budget failure without fetching or downsampling',async()=>{
 const {api,calls}=client(new ArrayBuffer(0));
 const result=await api.inspect(point,{geometry:{type:'Polygon',coordinates:[ring(5.6,50.8,5.8,51)]}});
 assert.equal(result.state,'unknown');assert.equal(result.reason,'native-raster-budget-exceeded');assert.equal(calls.length,0);
});
test('malformed/unclosed parcel is unknown rather than silently becoming a point scan',async()=>{
 const {api,calls}=client(new ArrayBuffer(0)),result=await api.inspect(point,{geometry:{type:'Polygon',coordinates:[[[5.6,50.8],[5.7,50.8],[5.7,50.9],[5.6,50.9]]]}});
 assert.equal(result.state,'unknown');assert.equal(result.reason,'invalid-parcel-geometry');assert.equal(result.coverage.scope,'parcel');assert.equal(calls.length,0);
});
test('abort before fetch and during analysis propagates cancellation',async()=>{
 const controller=new AbortController();controller.abort();const {api,calls}=client(new ArrayBuffer(0));
 await assert.rejects(api.inspect(point,{signal:controller.signal}),{name:'AbortError'});assert.equal(calls.length,0);
 const g=grid(),second=new AbortController(),promise=helper.analyze(plane(g),g,null,second.signal);second.abort();await assert.rejects(promise,{name:'AbortError'});
});
test('error and oversized response cannot become a completed result',async()=>{
 const api=terrain.createClient({GeoTIFF,fetch:async()=>new Response('error',{status:503})});assert.equal((await api.inspect(point)).state,'unknown');
 const api2=terrain.createClient({GeoTIFF,fetch:async()=>new Response('x',{headers:{'Content-Length':'50000000'}})});assert.equal((await api2.inspect(point)).reason,'ahn-response-byte-budget');
});
