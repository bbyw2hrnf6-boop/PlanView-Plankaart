import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleApi, callOpenAI, cleanInput } from '../cloud/lib/ai.mjs';
const schema=JSON.parse(readFileSync(new URL('../search_filters.schema.json', import.meta.url)));
const config=JSON.parse(readFileSync(new URL('../search_config.json', import.meta.url)));
const fixture=Object.fromEntries(Object.entries(schema.properties).map(([k,s])=>[k,s.type==='boolean'?false:s.type==='array'?[]:s.enum?s.enum[0]:'Interpreted request.']));
const key='sk-planview-test-value-not-a-real-key';
const origin='https://planview.test';
function env(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE ai_credentials (user_id TEXT PRIMARY KEY, ciphertext TEXT NOT NULL, iv TEXT NOT NULL, updated_at INTEGER NOT NULL); CREATE TABLE ai_usage (user_id TEXT PRIMARY KEY, window_start INTEGER NOT NULL, requests INTEGER NOT NULL, busy_until INTEGER NOT NULL);');
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
  r=await run(e,'owner','/api/interpret',{query:'Quiet residential land',context:{apiKey:'never send this'}});assert.equal(r.status,200);assert.equal((await r.json()).preferQuiet,true);
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
