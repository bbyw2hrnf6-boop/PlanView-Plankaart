import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleApi,encryptKey} from '../cloud/lib/ai.mjs';

const origin='https://planview.test',point={point:{lat:50.85,lng:5.69}};
function env(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE ai_usage (user_id TEXT PRIMARY KEY, window_start INTEGER NOT NULL, requests INTEGER NOT NULL, busy_until INTEGER NOT NULL);');
  return {sqlite,DB:{prepare(sql){return{bind(...values){const s=sqlite.prepare(sql);return{first:async()=>s.get(...values)||null,run:async()=>({meta:{changes:Number(s.run(...values).changes)}})};}};}}};
}
const request=(body,headers={})=>new Request(origin+'/api/permits/point',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const run=(e,user,body=point,fetcher=async()=>{throw Error('private provider diagnostic');},headers)=>handleApi(request(body,headers),e,user,{}, {},fetcher);

test('permit API requires sign-in and same-origin JSON before accessing sources',async()=>{
  const never=()=>assert.fail('Sources must not be reached');
  assert.equal((await run(env(),null,point,never)).status,401);
  assert.equal((await run(env(),'owner',point,never,{Origin:'https://evil.test'})).status,403);
  assert.equal((await run(env(),'owner',point,never,{'Content-Type':'text/plain'})).status,403);
});

test('permit validation rejects arbitrary endpoints, invalid points and oversized bodies',async()=>{
  const never=()=>assert.fail('Invalid request cannot fetch public data');
  for(const payload of [{...point,url:'https://evil.test'}, {point:{lat:true,lng:5.69}}, {point:{lat:1,lng:2}}, {...point,cursor:'https://evil.test'}]){
    assert.equal((await run(env(),'owner',payload,never)).status,400);
  }
  assert.equal((await run(env(),'owner',{...point,extra:'x'.repeat(9000)},never)).status,413);
});

test('public permit route needs no AI/DSO secret and releases its independent lease on failure',async()=>{
  const e=env();
  const result=await run(e,'owner');
  assert.equal(result.status,502);
  const body=await result.json();
  assert.match(body.error,/permit/);
  assert.ok(!JSON.stringify(body).includes('private provider diagnostic'));
  const usage=e.sqlite.prepare('SELECT * FROM ai_usage').all();
  assert.equal(usage.length,1);
  assert.equal(usage[0].user_id,'owner:permits');
  assert.equal(usage[0].busy_until,0);
});

test('internal permit budget and concurrent lease reject before any source request',async()=>{
  for(const [count,busy] of [[40,0],[1,Date.now()+60000]]){
    const e=env();e.sqlite.prepare('INSERT INTO ai_usage VALUES (?,?,?,?)').run('owner:permits',Date.now(),count,busy);
    const result=await run(e,'owner',point,()=>assert.fail('Throttled request cannot fetch sources'));
    assert.equal(result.status,429);
    assert.deepEqual(await result.json(),{error:'permit_request_limit'});
  }
});

const searchRequest=body=>new Request(origin+'/api/permits/search',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
const search=(e,body,fetcher)=>handleApi(searchRequest(body),e,'owner',{}, {},fetcher);
test('permit questions validate selected location and reject client-provided evidence',async()=>{
  const never=()=>assert.fail('Invalid input cannot reach providers');
  for(const body of [{query:'Status'}, {...point,query:''}, {...point,query:'Status',sources:[]}, {...point,query:'Status',url:'https://evil.test'}]){
    assert.equal((await search(env(),body,never)).status,400);
  }
});
test('permit questions retain source excerpts without AI or DSO credentials and release their own lease',async()=>{
  const e=env(),fixture=name=>readFileSync(new URL('./fixtures/permits/'+name,import.meta.url),'utf8');
  const fetcher=async url=>{
    const u=new URL(url);assert.ok(['api.pdok.nl','repository.overheid.nl'].includes(u.hostname));
    if(u.pathname.includes('/perceel/items'))return new Response(fixture('maastricht-parcels.json'));
    if(u.pathname.includes('/reverse'))return new Response(fixture('maastricht-addresses.json'));
    if(u.pathname==='/sru')return new Response(fixture('maastricht-history-sru.xml'));
    const id=/\/(gmb-\d{4}-\d+)\.xml$/.exec(u.pathname)?.[1];assert.ok(id);
    return new Response(fixture(id+'.xml'));
  };
  const result=await search(e,{point:{lat:50.849683,lng:5.68487},query:'22-1577WB',language:'de'},fetcher);
  assert.equal(result.status,200);const data=await result.json();assert.equal(data.state,'matches');assert.equal(data.answer,null);
  assert.equal(data.sources.length,4);assert.ok(data.sources.every(s=>s.text.length>30));assert.ok(data.coverage.warnings.includes('api_key_missing'));
  assert.equal(data.coverage.complete,false);assert.ok(!('modelConfig'in data));
  const usage=e.sqlite.prepare('SELECT * FROM ai_usage').all();assert.equal(usage.length,1);assert.equal(usage[0].user_id,'owner:permit-questions');assert.equal(usage[0].busy_until,0);
});
test('permit question limits and source errors do not leak diagnostics or block other routes',async()=>{
  const e=env();e.sqlite.prepare('INSERT INTO ai_usage VALUES (?,?,?,?)').run('owner:permit-questions',Date.now(),12,0);
  const limited=await search(e,{...point,query:'Status'},()=>assert.fail('No over-budget source call'));
  assert.equal(limited.status,429);assert.deepEqual(await limited.json(),{error:'permit_question_limit'});
  const next=env(),failed=await search(next,{...point,query:'Status'},async()=>{throw Error('secret diagnostic');});
  assert.equal(failed.status,502);assert.ok(!JSON.stringify(await failed.json()).includes('secret diagnostic'));
  assert.equal(next.sqlite.prepare('SELECT busy_until FROM ai_usage').get().busy_until,0);
});
test('permit search interprets a German concept into Dutch before searching location-bound documents',async()=>{
  const e=env();e.PLANVIEW_CREDENTIAL_KEY=btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
  e.sqlite.exec('CREATE TABLE ai_credentials (user_id TEXT PRIMARY KEY, ciphertext TEXT NOT NULL, iv TEXT NOT NULL);');
  const encrypted=await encryptKey('test-key','owner',e.PLANVIEW_CREDENTIAL_KEY);
  e.sqlite.prepare('INSERT INTO ai_credentials VALUES (?,?,?)').run('owner',encrypted.ciphertext,encrypted.iv);
  const fixture=name=>readFileSync(new URL('./fixtures/permits/'+name,import.meta.url),'utf8'),steps=[];
  const sentence='De vergunning voor het bouwen van een zwembad is verleend.';
  const fetcher=async(url,options)=>{
    const u=new URL(url);
    if(u.hostname==='api.openai.com'){
      const body=JSON.parse(options.body),intent=body.text.format.name==='planview_permit_intent';
      steps.push(intent?'intent':'answer');
      const output=intent?{searchQuery:'zwembad bouwen vergunning',terms:['zwembad','bassin'],intent:'project_details',category:'pool',statuses:[],caseReferences:[]}:{claims:[{statement:'Die Genehmigung für den Bau eines Pools wurde erteilt.',sourceId:'gmb-2023-288376',quote:sentence}],missingInformation:[]};
      if(!intent)assert.ok(body.input[1].content.includes('zwembad'));
      return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]});
    }
    steps.push('sources');
    if(u.pathname.includes('/perceel/items'))return new Response(fixture('maastricht-parcels.json'));
    if(u.pathname.includes('/reverse'))return new Response(fixture('maastricht-addresses.json'));
    if(u.pathname==='/sru'){
      const query=u.searchParams.get('query');assert.match(query,/50\.849683/);assert.ok(!query.includes('zwembad'),'intent must never broaden the public query beyond this location');
      return new Response(fixture('maastricht-history-sru.xml'));
    }
    return new Response(`<officiele-publicatie><zakelijke-mededeling-tekst><al>${sentence}</al></zakelijke-mededeling-tekst></officiele-publicatie>`);
  };
  const result=await search(e,{point:{lat:50.849683,lng:5.68487},query:'Gab es ein Schwimmbecken?',language:'de'},fetcher);
  assert.equal(result.status,200);const data=await result.json();assert.equal(steps[0],'intent');assert.equal(steps.at(-1),'answer');
  assert.equal(data.searchIntent.interpreted,true);assert.ok(data.searchIntent.terms.includes('zwembad'));assert.equal(data.state,'answered');
  assert.ok(data.sources.some(s=>s.highlightRanges.length>0));assert.ok(data.coverage.warnings.includes('permit_documents_not_loaded'));
  assert.equal(e.sqlite.prepare('SELECT busy_until FROM ai_usage').get().busy_until,0);
});
