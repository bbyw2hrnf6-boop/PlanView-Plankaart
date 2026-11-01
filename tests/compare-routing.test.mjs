import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {handleApi} from '../cloud/lib/ai.mjs';
import {cleanRouteInput,callRouting} from '../cloud/lib/routes.mjs';
const require=createRequire(import.meta.url),browser=require('../compare-routing.js');
const origin='https://planview.test',key='eyJ-routing-fixture-not-a-real-secret.payload.signature';
const input={origins:[{lat:50.86,lng:5.69},{lat:50.87,lng:5.7}],target:{lat:50.85,lng:5.71,label:'Maastricht station'},mode:'cycling'};
function env(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('CREATE TABLE source_credentials(user_id TEXT,provider TEXT,ciphertext TEXT,iv TEXT,updated_at INTEGER,PRIMARY KEY(user_id,provider)); CREATE TABLE ai_usage(user_id TEXT PRIMARY KEY,window_start INTEGER,requests INTEGER,busy_until INTEGER);');return {sqlite,PLANVIEW_CREDENTIAL_KEY:btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),DB:{prepare(sql){return {bind(...args){const stmt=sqlite.prepare(sql);return {first:async()=>stmt.get(...args)||null,run:async()=>({meta:{changes:Number(stmt.run(...args).changes)}})};}};}}};}
const req=(path,body,headers={})=>new Request(origin+path,{...(body===undefined?{}:{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)})});
const never=()=>{throw Error('Provider must not be called');};
const run=(e,user,path,body,fetcher=never,headers)=>handleApi(req(path,body,headers),e,user,{}, {},fetcher);
const provider=async(url,options)=>{assert.equal(url,'https://api.heigit.org/openrouteservice/v2/matrix/cycling-regular');assert.equal(options.headers.Authorization,key);assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body),{locations:[[5.69,50.86],[5.7,50.87],[5.71,50.85]],sources:['0','1'],destinations:['2'],metrics:['duration','distance'],units:'m'});return Response.json({durations:[[123.4],[null]],distances:[[811],[null]]});};
const publicProvider=async(url,options)=>{assert.ok(url.startsWith('https://routing.openstreetmap.de/routed-bike/table/v1/driving/'));assert.equal(options.headers.Authorization,undefined);return Response.json({code:'Ok',durations:[[123.4],[null]],distances:[[811],[null]]});};
test('ORS credentials are encrypted per account, never returned, and separately removable',async()=>{
 const e=env();let r=await run(e,'owner','/api/settings',{dso:'fixture-dso-key',ors:key});assert.equal(r.status,200);assert.deepEqual((await r.json()).configured,{dso:true,rp:false,ors:true});
 assert.ok(!JSON.stringify(e.sqlite.prepare('SELECT * FROM source_credentials').all()).includes(key));
 assert.deepEqual(await (await run(e,'owner','/api/routes/status')).json(),{configured:true,available:true,provider:'ors',requiresKey:false,storage:'cloud-account'});
 assert.equal((await (await run(e,'other','/api/routes/status')).json()).configured,false);
 assert.equal((await (await run(e,'other','/api/routes',input,publicProvider)).json()).provider,'osrm');
 const row=e.sqlite.prepare("SELECT * FROM source_credentials WHERE provider='ors'").get();e.sqlite.prepare('INSERT INTO source_credentials(user_id,provider,ciphertext,iv,updated_at) VALUES(?,?,?,?,?)').run('other','ors',row.ciphertext,row.iv,row.updated_at);assert.equal((await run(e,'other','/api/routes',input)).status,503);e.sqlite.prepare("DELETE FROM source_credentials WHERE user_id='other'").run();
 await run(e,'owner','/api/settings',{ors:''});assert.equal((await (await run(e,'owner','/api/settings')).json()).configured.dso,true);assert.equal(e.sqlite.prepare('SELECT count(*) n FROM source_credentials').get().n,1);
});
test('batch routes use actual model output; unavailable routes remain null',async()=>{
 const e=env();await run(e,'owner','/api/settings',{ors:key});const response=await run(e,'owner','/api/routes',input,provider);assert.equal(response.status,200);const data=await response.json();
 assert.equal(data.routes[0].durationSeconds,123.4);assert.equal(data.routes[0].distanceMeters,811);assert.deepEqual(data.routes[1],{origin:input.origins[1],status:'unavailable',durationSeconds:null,distanceMeters:null});assert.equal(data.liveTraffic,false);assert.equal(data.modeled,true);assert.equal(data.target.label,input.target.label);assert.ok(!JSON.stringify(data).includes(key));
});
test('routing rejects unauthenticated, cross-site, arbitrary URLs, oversized origins and invalid coordinates',async()=>{
 const e=env();assert.equal((await run(e,null,'/api/routes/status')).status,401);
 for(const payload of [{...input,url:'https://evil.test'},{...input,origins:Array(4).fill(input.origins[0])},{...input,mode:'flight'},{...input,mode:['walking']},{...input,mode:{}},{...input,target:{lat:1,lng:2}},{...input,origins:[{lat:true,lng:5.7}]},{...input,target:{...input.target,key}}])assert.equal((await run(e,'owner','/api/routes',payload)).status,400);
 assert.equal((await run(e,'owner','/api/routes',input,never,{Origin:'https://evil.test'})).status,403);
 assert.equal((await run(e,'owner','/api/settings',{ors:key,owner:'other'})).status,400);
 assert.throws(()=>cleanRouteInput({...input,target:{lat:NaN,lng:5.7}}));
});
test('ORS errors and malformed metrics are unavailable, never echoed or fabricated',async()=>{
 const e=env();await run(e,'owner','/api/settings',{ors:key});
 for(const [fetcher,code] of [[async()=>new Response(key,{status:401}),'routing_key_rejected'],[async()=>{throw Error(key);},'routing_unavailable'],[async()=>Response.json({durations:[['100'],[100]],distances:[[4],[5]]}),'invalid_routing_response'],[async()=>Response.json({durations:[[true],[100]],distances:[[4],[5]]}),'invalid_routing_response']]){const r=await run(e,'owner','/api/routes',input,fetcher);assert.equal(r.status,502);assert.deepEqual(await r.json(),{error:code});}
 e.sqlite.prepare("UPDATE source_credentials SET ciphertext='broken'").run();assert.equal((await run(e,'owner','/api/routes',input)).status,503);
});
test('routing is bounded to twelve calculations per five minutes per account',async()=>{
 const e=env();await run(e,'owner','/api/settings',{ors:key});for(let i=0;i<12;i++)assert.equal((await run(e,'owner','/api/routes',input,provider)).status,200);assert.equal((await run(e,'owner','/api/routes',input,never)).status,429);
});
test('account-free routing is available without an external key and uses one batch for each travel mode',async()=>{
 const e=env();assert.deepEqual(await (await run(e,'owner','/api/routes/status')).json(),{configured:false,available:true,provider:'osrm',requiresKey:false,storage:'cloud-account'});
 await run(e,'owner','/api/settings',{dso:'fixture-unrelated-dso-secret'});
 for(const [mode,path] of [['walking','routed-foot'],['cycling','routed-bike'],['driving','routed-car']]){
  let calls=0;const response=await callRouting(null,{...input,mode},async(url,options)=>{calls++;assert.equal(url,`https://routing.openstreetmap.de/${path}/table/v1/driving/5.69,50.86;5.7,50.87;5.71,50.85?sources=0;1&destinations=2&annotations=duration,distance&generate_hints=false`);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.body,undefined);assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers['User-Agent'],'PlanView/1.0 (https://planview-maastricht-spatial.dannhir.chatgpt.site)');assert.equal(options.headers.Referer,'https://planview-maastricht-spatial.dannhir.chatgpt.site/');assert.ok(!JSON.stringify({url,options}).includes(input.target.label));assert.ok(!JSON.stringify(options).includes('fixture-unrelated-dso-secret'));return Response.json({code:'Ok',durations:[[32],[null]],distances:[[101],[null]]});});
  assert.equal(calls,1);assert.equal(response.provider,'osrm');assert.equal(response.profile,path);assert.equal(response.mode,mode);assert.deepEqual(response.routes.map(r=>r.origin),input.origins);assert.equal(response.routes[1].durationSeconds,null);assert.equal(response.target.label,input.target.label);assert.equal(response.liveTraffic,false);assert.equal(response.modeled,true);assert.equal(response.attributionUrl,'https://www.openstreetmap.org/copyright');assert.equal(response.editUrl,'https://www.openstreetmap.org/fixthemap');
 }
 assert.equal((await run(e,'owner','/api/routes',input,publicProvider)).status,200);
});
test('public provider failures, fallback speeds and malformed matrices never fabricate results',async()=>{
 for(const fixture of [{code:'NoTable'},{code:'Ok',durations:[[2],[3]],distances:[[4],[5]],fallback_speed_cells:[[0,0]]},{code:'Ok',durations:[[2],[3]],distances:[[4],[5]],fallback_speed_cells:[]},{code:'Ok',durations:[[true],[3]],distances:[[4],[5]]},{code:'Ok',durations:[[2],[3]],distances:[[4],[-5]]},{durations:[[2],[3]],distances:[[4],[5]]},{code:'Ok',durations:[[2]],distances:[[4]]}])await assert.rejects(()=>callRouting(null,input,async()=>Response.json(fixture)),e=>e.code==='invalid_routing_response');
 for(const [fetcher,code] of [[async()=>new Response('provider body must never echo',{status:429}),'routing_limit'],[async()=>new Response('not a key error',{status:401}),'routing_unavailable'],[async()=>{throw Error('private internal detail');},'routing_unavailable']])await assert.rejects(()=>callRouting(null,input,fetcher),e=>e.code===code);
});
test('public routing serializes all web users and retains a 1.1-second cooldown after fast replies',async()=>{
 const e=env(),originalNow=Date.now;let now=2000000000000;Date.now=()=>now;
 try{
  assert.equal((await run(e,'alice','/api/routes',input,publicProvider)).status,200);
  const row=e.sqlite.prepare("SELECT * FROM ai_usage WHERE user_id='__planview_global_osrm__'").get();assert.equal(row.busy_until,now+1100);
  assert.equal((await run(e,'bob','/api/routes',input,never)).status,429);
  now+=1099;assert.equal((await run(e,'bob','/api/routes',input,never)).status,429);
  now++;assert.equal((await run(e,'bob','/api/routes',input,publicProvider)).status,200);
  assert.equal(e.sqlite.prepare("SELECT busy_until FROM ai_usage WHERE user_id='bob:routing'").get().busy_until,0);
 }finally{Date.now=originalNow;}
});
test('public routing holds global lease for in-flight calls and enforces per-account budget separately',async()=>{
 const e=env(),originalNow=Date.now;let now=2000000000000;Date.now=()=>now;
 try{
  let finish,started;const ready=new Promise(resolve=>started=resolve),pending=run(e,'alice','/api/routes',input,async()=>{started();return new Promise(resolve=>finish=()=>resolve(Response.json({code:'Ok',durations:[[1],[2]],distances:[[3],[4]]})));});
  await ready;now+=1101;assert.equal((await run(e,'bob','/api/routes',input,never)).status,429);finish();assert.equal((await pending).status,200);
  for(let i=0;i<11;i++){now+=1101;assert.equal((await run(e,'alice','/api/routes',input,publicProvider)).status,200);}
  now+=1101;assert.equal((await run(e,'alice','/api/routes',input,never)).status,429);assert.equal((await run(e,'charlie','/api/routes',input,publicProvider)).status,200);
 }finally{Date.now=originalNow;}
});
test('browser routing submits coordinates only to same-origin proxy, preserving abort signal',async()=>{
 const prior=globalThis.fetch,controller=new AbortController();let received;
 globalThis.fetch=async(url,options)=>{received={url,options};return Response.json({routes:[]});};
 try{await browser.inspect(input.origins,input.target,{mode:'cycling',signal:controller.signal});assert.equal(received.url,'/api/routes');assert.equal(received.options.credentials,'same-origin');assert.equal(received.options.signal,controller.signal);assert.deepEqual(JSON.parse(received.options.body),input);await assert.rejects(()=>browser.inspect(Array(4).fill(input.origins[0]),input.target));}
 finally{globalThis.fetch=prior;}
});
test('routing connection shortcut selects Connections before scrolling and focusing the key',()=>{
 const calls=[],nodes={'services-settings':{click:()=>calls.push('open')},'settings-connections-tab':{click:()=>calls.push('connections')},'routing-settings':{scrollIntoView:()=>calls.push('scroll')},'routing-api-key':{focus:()=>calls.push('focus')}};
 const window={document:{getElementById:id=>nodes[id]}};
 runInNewContext(readFileSync(new URL('../compare-routing.js',import.meta.url),'utf8'),{window});
 window.PlanViewCompareRouting.openSettings();assert.deepEqual(calls,['open','connections','scroll','focus']);
});
