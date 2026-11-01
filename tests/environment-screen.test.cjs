const test=require('node:test'),assert=require('node:assert/strict');
const screen=require('../environment-screen.js');
const c={maxNoiseDb:50,maxSlopeDeg:5,soilClasses:['sand'],minGroundwaterDepthCm:80};
const good={noise:{state:'complete',metric:'Lden',valueDb:48},slope:{state:'complete',metric:'slope_degrees',maxSlopeDeg:4,coverage:{scope:'parcel',complete:true}},soil:{state:'complete',classes:[{id:'sand',label:'Sand'}]},groundwater:{state:'complete',highWaterDepthCm:100}};
test('environment criteria combine with AND and compare the correct metrics and directions',()=>{
 assert.equal(screen.evaluate(good,c).status,'pass');
 for(const [kind,value,key] of [['noise',{valueDb:55},'maxNoiseDb'],['slope',{maxSlopeDeg:6},'maxSlopeDeg'],['soil',{classes:[{id:'peat'}]},'soilClasses'],['groundwater',{highWaterDepthCm:60},'minGroundwaterDepthCm']]){
  const r=screen.evaluate({...good,[kind]:{...good[kind],...value}},c);assert.equal(r.pass,false);assert.deepEqual(r.failed,[key]);
 }
 assert.equal(screen.evaluate({...good,groundwater:{state:'complete',highWaterDepthCm:-10}},c).pass,false);
});
test('missing, partial, wrong-metric and point-neighborhood slope never certify a parcel',()=>{
 const bad=[{...good,noise:{...good.noise,metric:'Lnight'}},{...good,noise:{...good.noise,state:'unknown'}},{...good,slope:{...good.slope,coverage:{scope:'point-neighborhood',complete:true}}},{...good,slope:{...good.slope,coverage:{scope:'parcel',complete:false}}},{...good,groundwater:{state:'unknown',highWaterDepthCm:100}},{...good,soil:{state:'complete',classes:[]}}];
 for(const e of bad){const r=screen.evaluate(e,c);assert.equal(r.status,'unknown');assert.ok(r.missing.length);assert.equal(r.pass,true);}
});
test('only requested sources run; unresolved parcel cannot silently fall back to neighborhood slope',async()=>{
 let sourceCalls=0,terrainCalls=0;
 const client=screen.createScreen({sources:{inspect:async(p,o)=>{sourceCalls++;assert.equal(o.noise,true);assert.equal(o.soil,false);return {noise:good.noise};}},terrain:{inspect:async()=>{terrainCalls++;return good.slope;}}});
 const e=await client.inspect({lat:52,lng:5},{criteria:{maxNoiseDb:50,maxSlopeDeg:5}});assert.equal(e.slope.state,'unknown');assert.equal(terrainCalls,0);assert.equal(sourceCalls,1);
 assert.equal(screen.evaluate(e,{maxNoiseDb:50,maxSlopeDeg:5}).status,'unknown');
 const geometry={type:'Polygon',coordinates:[[[5,52],[5.001,52],[5.001,52.001],[5,52.001],[5,52]]]};
 await client.inspect({lat:52,lng:5},{criteria:{maxSlopeDeg:5},parcelEvidence:{parcel:{complete:true,geometry}}});assert.equal(terrainCalls,1);assert.equal(sourceCalls,1);
});
test('source failures retain review evidence and cancellation propagates',async()=>{
 const client=screen.createScreen({sources:{inspect:async()=>{throw Error('offline');}}});const e=await client.inspect({lat:52,lng:5},{criteria:{maxNoiseDb:50,minGroundwaterDepthCm:80}});assert.equal(screen.evaluate(e,{maxNoiseDb:50,minGroundwaterDepthCm:80}).status,'unknown');
 const controller=new AbortController();controller.abort();await assert.rejects(client.inspect({lat:52,lng:5},{criteria:c,signal:controller.signal}),{name:'AbortError'});
});
test('environment evidence retains scale and provenance while escaping external labels',()=>{
 const html=screen.render({...good,soil:{...good.soil,classes:[{id:'sand',label:'<script>bad</script>'}],source:{title:'BRO',url:'javascript:bad',dataPeriod:'2025',retrievedAt:'2026-10-17'}}},'de');assert.ok(html.includes('am Prüfpunkt'));assert.ok(html.includes('gesamtes Grundstück'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('href="javascript:'));assert.ok(html.includes('Quellenzeitraum'));
});
