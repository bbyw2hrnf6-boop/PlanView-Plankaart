import test from 'node:test';
import assert from 'node:assert/strict';
import {createMonitoredEngine} from '../firebase/functions/monitored-engine.mjs';

const response=()=>Response.json({model:'gpt-6-luna',usage:{input_tokens:10,output_tokens:2}});
function fixture({used=149,engine,fetcher=async()=>response(),reserveError=false,refundError=false}={}){
  const events=[],reservations=new Set();let calls=0,refunds=0,errors=0;
  const quota=()=>({limit:150,used,remaining:150-used,resetsAt:'2026-11-01T23:00:00.000Z',timezone:'Europe/Amsterdam'});
  const quotaStore={
    status:async()=>quota(),
    reserve:async(uid,id)=>{
      if(reserveError)throw Error('private storage failure');
      if(used>=150)return {allowed:false,quota:quota()};
      used++;reservations.add(id);return {allowed:true,quota:quota(),reservation:{requestId:id}};
    },
    refund:async(uid,reservation)=>{
      if(refundError)throw Error('private refund failure');
      if(reservations.delete(reservation.requestId)){used--;refunds++;}
    }
  };
  const wrapped=createMonitoredEngine({
    ownerUid:()=> 'owner',testUserUid:()=> 'test',quotaStore,
    store:{record:async event=>events.push(event)},fetcher,onQuotaError:()=>errors++,
    engine:async(...args)=>{calls++;return engine?engine(...args):Response.json({ok:true});}
  });
  return {run:(path='/api/interpret',uid='test',method='POST')=>wrapped(new Request('https://planview.test'+path,{method}),{},uid,{},{}),
    events,get used(){return used;},get calls(){return calls;},get refunds(){return refunds;},get errors(){return errors;}};
}
const ai=fetcher=>fetcher('https://api.openai.com/v1/responses',{method:'POST'});

test('all four paid entry points reject the 151st test search before provider or engine work',async()=>{
  for(const path of ['/api/interpret','/api/ai/test','/api/rules/search','/api/permits/search']){
    const h=fixture({used:150});const result=await h.run(path);
    assert.equal(result.status,429);assert.equal((await result.json()).error,'weekly_search_limit');
    assert.equal(h.calls,0);assert.equal(h.used,150);assert.equal(h.events[0].metrics.prompts,0);
  }
});
test('two provider prompts in one permit question consume exactly one weekly search',async()=>{
  const h=fixture({engine:async(req,env,user,config,schema,fetcher)=>{
    await ai(fetcher);await ai(fetcher);return Response.json({answer:'result'});
  }});
  assert.equal((await h.run('/api/permits/search')).status,200);assert.equal(h.used,150);
  assert.equal(h.events[0].metrics.prompts,2);assert.equal((await h.run()).status,429);
});
test('free fallbacks and invalid searches release their reservation, including thrown pre-provider errors',async()=>{
  const free=fixture();assert.equal((await free.run('/api/rules/search')).status,200);
  assert.equal(free.used,149);assert.equal(free.refunds,1);
  const invalid=fixture({engine:async()=>Response.json({error:'invalid_request'},{status:400})});
  assert.equal((await invalid.run()).status,400);assert.equal(invalid.used,149);
  const thrown=fixture({engine:async()=>{throw Error('validation failure');}});
  await assert.rejects(thrown.run(),/validation failure/);assert.equal(thrown.used,149);
});
test('network failures and caught provider failures remain counted once OpenAI was attempted',async()=>{
  const network=fixture({fetcher:async()=>{throw Error('connection lost');},engine:async(req,env,user,config,schema,fetcher)=>{
    await ai(fetcher);return Response.json({});
  }});
  await assert.rejects(network.run(),/connection lost/);assert.equal(network.used,150);assert.equal(network.refunds,0);
  const fallback=fixture({engine:async(req,env,user,config,schema,fetcher)=>{await ai(fetcher);return Response.json({fallback:true});}});
  assert.equal((await fallback.run()).status,200);assert.equal(fallback.used,150);
});
test('storage outages fail closed, while failed refunds conservatively retain the consumed slot',async()=>{
  const unavailable=fixture({reserveError:true});const result=await unavailable.run();
  assert.equal(result.status,503);assert.deepEqual(await result.json(),{error:'weekly_quota_unavailable'});
  assert.equal(unavailable.calls,0);assert.equal(unavailable.errors,1);
  const refund=fixture({refundError:true});assert.equal((await refund.run()).status,200);
  assert.equal(refund.used,150);assert.equal(refund.errors,1);
});
test('only the pinned test UID is limited, the owner and free data calls stay usable',async()=>{
  const h=fixture({used:150});
  for(const uid of ['owner','other-approved'])assert.equal((await h.run('/api/interpret',uid)).status,200);
  for(const path of ['/api/permits/point','/api/dso/rules','/api/rp/plan'])assert.equal((await h.run(path,'test','GET')).status,200);
  assert.equal(h.used,150);
});
test('quota status uses verified user identity, has no mutation method and does not log itself',async()=>{
  const h=fixture({used:32});const result=await h.run('/api/quota','test','GET');
  assert.deepEqual(await result.json(),{limited:true,limit:150,used:32,remaining:118,resetsAt:'2026-11-01T23:00:00.000Z',timezone:'Europe/Amsterdam'});
  assert.deepEqual(await (await h.run('/api/quota','owner','GET')).json(),{limited:false});
  assert.equal((await h.run('/api/quota?uid=owner','test','GET')).status,400);
  assert.equal((await h.run('/api/quota','test','POST')).status,405);
  assert.equal(h.calls,0);assert.equal(h.events.length,0);assert.equal(h.used,32);
});
test('quota status storage failure grants no new allowance and owner identity always takes precedence',async()=>{
  const engine=createMonitoredEngine({engine:async()=>Response.json({ok:true}),store:{record:async()=>{}},
    ownerUid:()=> 'owner',testUserUid:()=> 'test',quotaStore:{status:async()=>{throw Error('private database error');}}});
  const result=await engine(new Request('https://planview.test/api/quota'),{},'test');
  assert.equal(result.status,503);assert.deepEqual(await result.json(),{error:'weekly_quota_unavailable'});
  const owner=createMonitoredEngine({engine:async()=>Response.json({ok:true}),store:{record:async()=>{}},
    ownerUid:()=> 'same-uid',testUserUid:()=> 'same-uid',quotaStore:{reserve:async()=>{throw Error('must not reserve');}}});
  assert.equal((await owner(new Request('https://planview.test/api/interpret',{method:'POST'}),{},'same-uid')).status,200);
  assert.deepEqual(await (await owner(new Request('https://planview.test/api/quota'),{},'same-uid')).json(),{limited:false});
});
