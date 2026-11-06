import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleApi, callOpenAI, cleanInput } from '../cloud/lib/ai.mjs';
const schema=JSON.parse(readFileSync(new URL('../search_filters.schema.json', import.meta.url)));
const config=JSON.parse(readFileSync(new URL('../search_config.json', import.meta.url)));
const fixtureValue=s=>{const type=Array.isArray(s.type)?'null':s.type;return type==='null'?null:type==='object'?Object.fromEntries(Object.entries(s.properties).map(([k,v])=>[k,fixtureValue(v)])):type==='boolean'?false:type==='array'?[]:type==='number'?0:s.enum?s.enum[0]:'Interpreted request.';};
const fixture=fixtureValue(schema);
const key='sk-planview-test-value-not-a-real-key';
const origin='https://planview.test';
function env(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE ai_credentials (user_id TEXT PRIMARY KEY, ciphertext TEXT NOT NULL, iv TEXT NOT NULL, updated_at INTEGER NOT NULL); CREATE TABLE source_credentials (user_id TEXT NOT NULL, provider TEXT NOT NULL, ciphertext TEXT NOT NULL, iv TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,provider)); CREATE TABLE ai_usage (user_id TEXT PRIMARY KEY, window_start INTEGER NOT NULL, requests INTEGER NOT NULL, busy_until INTEGER NOT NULL);');
  const DB={prepare(sql){return {bind(...args){const stmt=sqlite.prepare(sql);return {first:async()=>stmt.get(...args)||null,run:async()=>({meta:{changes:Number(stmt.run(...args).changes)}})};}};}};
  return {DB,sqlite,PLANVIEW_CREDENTIAL_KEY:btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))};
}
const req=(path,body,extra={})=>new Request(origin+path,{...(body===undefined?{}:{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...extra},body:JSON.stringify(body)})});
const good=async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.headers.Authorization,`Bearer ${key}`);const body=JSON.parse(options.body);assert.equal(body.model,'gpt-6-luna');assert.equal(body.reasoning.effort,'high');assert.equal(body.store,false);assert.equal(body.text.format.strict,true);return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(fixture)}]}]});};
const run=(e,user,path,body,fetcher=good,headers)=>handleApi(req(path,body,headers),e,user,config,schema,fetcher);
test('keys are encrypted, never echoed, tied to identity and removable',async()=>{
  const e=env();let r=await run(e,'owner','/api/ai/settings',{key});assert.equal(r.status,200);assert.deepEqual(await r.json(),{configured:true,storage:'cloud-account'});
  const row=e.sqlite.prepare('SELECT * FROM ai_credentials').get();assert.ok(!JSON.stringify(row).includes(key));assert.notEqual(row.ciphertext,key);
  assert.equal((await (await run(e,'owner','/api/status')).json()).available,true);
  assert.equal((await (await run(e,'other','/api/status')).json()).available,false);
  assert.equal((await run(e,'other','/api/interpret',{query:'Residential land'})).status,409);
  r=await run(e,'owner','/api/interpret',{query:'Quiet residential land',context:{apiKey:'never send this'}});assert.equal(r.status,200);assert.equal((await r.json()).preferQuiet,false);
  assert.equal((await (await run(e,'owner','/api/ai/test',{})).json()).ok,true);
  await run(e,'owner','/api/ai/settings',{key:''});assert.equal(e.sqlite.prepare('SELECT COUNT(*) AS n FROM ai_credentials').get().n,0);
  assert.equal((await run(e,'owner','/api/interpret',{query:'Residential land'})).status,409);
});
test('reject unauthenticated, cross-origin, bad fields and oversized requests without provider calls',async()=>{
  const e=env(),never=()=>{throw Error('Unexpected provider call');};
  assert.equal((await run(e,null,'/api/status',undefined,never)).status,401);
  assert.equal((await run(e,'owner','/api/ai/settings',{key},never,{Origin:'https://evil.test'})).status,403);
  assert.equal((await run(e,'owner','/api/ai/settings',{key,owner:'other'},never)).status,400);
  assert.equal((await run(e,'owner','/api/ai/settings',{key:'bad'},never)).status,400);
  assert.equal((await run(e,'owner','/api/ai/settings',{key:'x'.repeat(3000)},never)).status,413);
  assert.equal((await run(e,'owner','/api/interpret',{query:'x'.repeat(1201)},never)).status,400);
  assert.equal((await run(e,'owner','/api/interpret',{query:'x',context:[]},never)).status,400);
});
test('provider errors and incomplete outputs never leak keys or become fabricated success',async()=>{
  const e=env();await run(e,'owner','/api/ai/settings',{key});
  const bad=await run(e,'owner','/api/interpret',{query:'Residential land'},async()=>new Response(key,{status:401}));assert.equal(bad.status,502);assert.deepEqual(await bad.json(),{error:'invalid_api_key'});
  const incomplete=await run(e,'owner','/api/interpret',{query:'Residential land'},async()=>Response.json({status:'incomplete',output:[]}));assert.equal(incomplete.status,502);
  e.sqlite.prepare('UPDATE ai_credentials SET ciphertext=?').run('broken');const corrupted=await run(e,'owner','/api/interpret',{query:'Residential land'},()=>{throw Error('Must not call provider');});assert.equal(corrupted.status,503);
});
test('bounded context, strict model schema, numeric quietness and API limits',async()=>{
  const c=cleanInput({query:'Test',context:{scope:'x'.repeat(200),nearbyFeatureCounts:{station:9000,alien:1},secret:key}});assert.equal(c.context.scope.length,100);assert.deepEqual(c.context.nearbyFeatureCounts,{station:3000});assert.equal(c.context.secret,undefined);
  const numeric=await callOpenAI(key,{query:'Noise below 30 dB',context:{}},config,schema,good);assert.equal(numeric.preferQuiet,false);
  const invalid=async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{}'}]}]});await assert.rejects(()=>callOpenAI(key,{query:'x'},config,schema,invalid));
  const e=env();await run(e,'owner','/api/ai/settings',{key});for(let i=0;i<12;i++)assert.equal((await run(e,'owner','/api/interpret',{query:'Land'})).status,200);
  assert.equal((await run(e,'owner','/api/interpret',{query:'Land'})).status,429);
});

test('DSO keys are encrypted per web account; missing evidence never invokes AI',async()=>{
 const e=env(),never=()=>{throw Error('Must not call provider');};
 assert.equal((await run(e,'owner','/api/settings',{dso:'test-dso-key-123456'},never)).status,200);
 const row=e.sqlite.prepare('SELECT * FROM source_credentials').get();assert.ok(!JSON.stringify(row).includes('test-dso-key-123456'));
 assert.equal((await (await run(e,'other','/api/settings',undefined,never)).json()).configured.dso,false);
 const r=await run(e,'other','/api/rules/search',{query:'Pool?',point:{x:180000,y:330000}},never);assert.equal((await r.json()).error,'dso_key_missing');
 assert.equal((await run(e,'owner','/api/rules/search',{query:'Pool?',point:{x:1,y:2}},never)).status,400);
 await run(e,'owner','/api/settings',{dso:''},never);assert.equal(e.sqlite.prepare('SELECT count(*) n FROM source_credentials').get().n,0);
});
test('distance schema is recursive, range-safe and does not overwrite explicit model intent',async()=>{
 const goodValue=structuredClone(fixture);goodValue.distanceRules.station={minKm:.5,maxKm:2};const fetcher=async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(goodValue)}]}]});
 const result=await callOpenAI(key,{query:'Not quiet; near industry within 1.2km'},config,schema,fetcher);assert.deepEqual(result.distanceRules.station,{minKm:.5,maxKm:2});assert.equal(result.preferQuiet,false);assert.equal(result.avoidIndustry,false);
 goodValue.distanceRules.station.maxKm='2';await assert.rejects(()=>callOpenAI(key,{query:'x'},config,schema,fetcher));
});
test('central keys are owner-managed, usable by approved API callers and never returned',async()=>{
 const e=env();e.PLANVIEW_CREDENTIAL_OWNER_UID='owner';
 const saved=await (await run(e,'owner','/api/ai/settings',{key})).json();assert.equal(saved.canManageKeys,true);assert.equal(saved.credentialScope,'shared');
 const status=await (await run(e,'test-user','/api/status')).json();assert.equal(status.configured,true);assert.equal(status.canManageKeys,false);assert.equal(status.credentialScope,'shared');assert.ok(!JSON.stringify(status).includes(key));
 for(const [path,body] of [['/api/ai/settings',{key:''}],['/api/ai/settings',{key}],['/api/settings',{dso:'test-dso-key-123456'}],['/api/settings',{ors:''}]]){
  const denied=await run(e,'test-user',path,body);assert.equal(denied.status,403);assert.deepEqual(await denied.json(),{error:'keys_managed_centrally'});
 }
 assert.equal((await run(e,'test-user','/api/interpret',{query:'Residential land'})).status,200);
 assert.equal((await run(e,'owner','/api/interpret',{query:'Residential land'})).status,200);
 const users=e.sqlite.prepare('SELECT user_id FROM ai_usage ORDER BY user_id').all().map(row=>row.user_id);assert.deepEqual(users,['owner','test-user']);
 assert.equal(e.sqlite.prepare('SELECT count(*) n FROM ai_credentials').get().n,1);
 await run(e,'owner','/api/ai/settings',{key:''});assert.equal((await (await run(e,'test-user','/api/status')).json()).configured,false);
});
test('central DSO and optional routing keys stay encrypted and are used server-side for the test user',async()=>{
 const e=env();e.PLANVIEW_CREDENTIAL_OWNER_UID='owner';
 await run(e,'owner','/api/settings',{dso:'shared-dso-key-123456',ors:'shared-routing-key-123456'});
 const settings=await (await run(e,'test-user','/api/settings')).json();assert.equal(settings.configured.dso,true);assert.equal(settings.configured.ors,true);assert.equal(settings.canManageKeys,false);assert.ok(!JSON.stringify(settings).includes('shared-dso-key-123456'));
 assert.ok(e.sqlite.prepare('SELECT * FROM source_credentials').all().every(row=>row.user_id==='owner'&&!JSON.stringify(row).includes('shared-dso-key-123456')));
 let received=false;await run(e,'test-user','/api/rules/search',{point:{x:176000,y:318000},query:'bouwen'},async(url,options)=>{received ||= options.headers?.['x-api-key']==='shared-dso-key-123456';return new Response('{}',{status:503});});assert.equal(received,true);
 const routing=await (await run(e,'test-user','/api/routes/status')).json();assert.equal(routing.provider,'ors');assert.equal(routing.canManageKeys,false);
});
test('central RP key is encrypted and owner-managed; plan lookup validates IDs and releases caller budget',async()=>{
 const e=env();e.PLANVIEW_CREDENTIAL_OWNER_UID='owner';const id='NL.IMRO.0200.bp1253-vas1',rp='fixture-shared-rp-key';
 const never=()=>assert.fail('no provider request');
 assert.equal((await run(e,'test-user','/api/rp/plan?id='+id,undefined,never)).status,409);
 assert.equal((await run(e,'test-user','/api/settings',{rp},never)).status,403);
 assert.equal((await run(e,'owner','/api/settings',{rp},never)).status,200);
 const settings=await (await run(e,'test-user','/api/settings',undefined,never)).json();assert.equal(settings.configured.rp,true);assert.equal(settings.capabilities.rpMetadata,true);assert.equal(settings.canManageKeys,false);assert.ok(!JSON.stringify(settings).includes(rp));
 const row=e.sqlite.prepare('SELECT * FROM source_credentials WHERE provider=?').get('rp');assert.equal(row.user_id,'owner');assert.ok(!JSON.stringify(row).includes(rp));
 for(const query of ['','?id=bad','?id='+id+'&id='+id,'?id='+id+'&url=https://evil.example'])assert.equal((await run(e,'test-user','/api/rp/plan'+query,undefined,never)).status,400);
 const response=await run(e,'test-user','/api/rp/plan?id='+id,undefined,async(url,options)=>{assert.equal(options.headers['x-api-key'],rp);return Response.json({id,naam:'Plan',planstatusInfo:{planstatus:'vastgesteld'}});});
 assert.equal(response.status,200);assert.equal((await response.json()).status,'vastgesteld');
 const usage=e.sqlite.prepare('SELECT * FROM ai_usage').get();assert.equal(usage.user_id,'test-user:rp');assert.equal(usage.busy_until,0);
 await run(e,'test-user','/api/rp/plan?id='+id,undefined,async()=>new Response('{}',{status:503}));assert.equal(e.sqlite.prepare('SELECT busy_until FROM ai_usage').get().busy_until,0);
 assert.equal((await run(e,'test-user','/api/settings',{rp:''},never)).status,403);
 await run(e,'owner','/api/settings',{rp:''},never);assert.equal((await (await run(e,'test-user','/api/settings',undefined,never)).json()).configured.rp,false);
});
test('central DSO references use the owner key for guest requests, validate coordinates and allow three bounded parallel leads',async()=>{
 const e=env();e.PLANVIEW_CREDENTIAL_OWNER_UID='owner';const dso='fixture-central-dso-connection',path='/api/dso/rules?x=151992.1&y=390799.4',never=()=>assert.fail('no provider call');
 assert.equal((await run(e,'test-user',path,undefined,never)).status,409);
 await run(e,'owner','/api/settings',{dso},never);assert.equal((await (await run(e,'test-user','/api/settings')).json()).capabilities.dsoReferences,true);
 for(const query of ['','?x=&y=390799','?x=151992&x=151993&y=390799','?x=151992&y=10','?x=151992&y=390799&url=https://evil.example'])assert.equal((await run(e,'test-user','/api/dso/rules'+query,undefined,never)).status,400);
 const pending=[];let ready;const started=new Promise(resolve=>ready=resolve);
 const provider=async(url,options)=>{
  assert.ok(url.startsWith('https://service.omgevingswet.overheid.nl/publiek/omgevingsdocumenten/api/presenteren/v8/regelingen/_zoek?'));
  assert.equal(options.headers['x-api-key'],dso);assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body).geometrie.coordinates,[151992.1,390799.4]);
  return new Promise(resolve=>{pending.push(resolve);if(pending.length===3)ready();});
 };
 const requests=Array.from({length:3},()=>run(e,'test-user',path,undefined,provider));await started;
 assert.equal((await run(e,'test-user',path,undefined,never)).status,429);
 pending.forEach(resolve=>resolve(Response.json({_embedded:{regelingen:[]}})));
 for(const response of await Promise.all(requests)){assert.equal(response.status,200);const data=await response.json();assert.equal(data.complete,false);assert.deepEqual(data.instruments,[]);assert.ok(!JSON.stringify(data).includes(dso));}
 const usage=e.sqlite.prepare('SELECT user_id,busy_until FROM ai_usage').all();assert.equal(usage.length,3);assert.ok(usage.every(row=>row.user_id.startsWith('test-user:dso-references:')&&row.busy_until===0));
 const failed=await run(e,'test-user',path,undefined,async()=>new Response(dso,{status:401}));assert.equal(failed.status,502);assert.deepEqual(await failed.json(),{error:'dso_references_unavailable'});
 assert.ok(e.sqlite.prepare('SELECT busy_until FROM ai_usage').all().every(row=>row.busy_until===0));
});
