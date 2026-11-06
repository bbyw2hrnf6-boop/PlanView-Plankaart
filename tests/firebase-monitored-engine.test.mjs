import test from 'node:test';
import assert from 'node:assert/strict';
import {createMonitoredEngine} from '../firebase/functions/monitored-engine.mjs';
import {createGateway,allowedOrigins} from '../firebase/functions/gateway.mjs';
const origin='https://planview.test';
const request=(path,options={})=>new Request(origin+path,options);
function fixture(overrides={}){
  const events=[];let reads=0;
  const wrapper=createMonitoredEngine({ownerUid:()=> 'owner',testUserUid:()=> 'guest',engine:async()=>Response.json({ok:true}),
    quotaStore:{status:async()=>({limit:150,used:0,remaining:150}),reserve:async()=>({allowed:true,reservation:{id:'reservation'}}),refund:async()=>{}},
    store:{record:async e=>events.push(e),read:async()=>{reads++;return {summary:{requests:42}};}},...overrides});
  return {events,engine:wrapper,run:(path,user='guest',options={})=>wrapper(request(path,options),{},user,{},{}),get reads(){return reads;}};
}
test('monitoring data is owner-only on the server, independent of client flags',async()=>{
  const h=fixture();assert.equal((await h.run('/api/admin/monitoring')).status,403);assert.equal(h.reads,0);
  assert.equal((await h.run('/api/admin/monitoring?user=owner')).status,403);assert.equal(h.reads,0);
  const allowed=await h.run('/api/admin/monitoring','owner');assert.equal(allowed.status,200);assert.equal((await allowed.json()).summary.requests,42);assert.equal(h.reads,1);assert.equal(h.events.length,0);
  assert.equal((await h.run('/api/admin/monitoring?user=guest','owner')).status,400);
  assert.equal((await h.run('/api/admin/monitoring','owner',{method:'POST'})).status,405);
  assert.equal((await fixture({ownerUid:()=>''}).run('/api/admin/monitoring','owner')).status,403);
});
test('operational requests keep status and response while metadata excludes bodies and query strings',async()=>{
  const sensitive='private-prompt-and-key-value';let tick=1000;
  const h=fixture({now:()=>tick++,id:()=> 'event-1',engine:async(req,env,user,config,schema,fetcher)=>{await fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:sensitive},body:JSON.stringify({input:sensitive})});return Response.json({answer:sensitive},{status:422});},
    fetcher:async()=>Response.json({model:'gpt-6-luna',service_tier:'default',usage:{input_tokens:100,output_tokens:10,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:5}},output:[{text:sensitive}]})});
  const response=await h.run('/api/rules/search?secret='+sensitive,'guest',{method:'POST',body:sensitive});assert.equal(response.status,422);assert.equal((await response.json()).answer,sensitive);
  assert.equal(h.events.length,1);const event=h.events[0];assert.equal(event.user,'TestUser02');assert.equal(event.endpoint,'/api/rules/search');assert.equal(event.status,422);assert.equal(event.metrics.prompts,1);assert.ok(event.durationMs>=0);assert.ok(!JSON.stringify(event).includes(sensitive));
});
test('failed monitoring writes never replace app results or disclose raw errors',async()=>{
  let failures=0;const h=fixture({store:{record:async()=>{throw Error('secret-provider-error');},read:async()=>{throw Error('secret-query');}},onWriteError:()=>failures++});
  assert.equal((await h.run('/api/interpret')).status,200);assert.equal(failures,1);
  const failedRead=await h.run('/api/admin/monitoring','owner');assert.equal(failedRead.status,503);assert.deepEqual(await failedRead.json(),{error:'monitoring_unavailable'});
});
test('thrown app errors are still recorded as failed attempts without copying error messages',async()=>{
  const h=fixture({engine:async()=>{throw Error('secret');}});await assert.rejects(()=>h.run('/api/unknown-path'),/secret/);
  assert.equal(h.events[0].status,503);assert.equal(h.events[0].endpoint,'/api/unknown');assert.ok(!JSON.stringify(h.events[0]).includes('secret'));
});
test('Firebase gateway cannot turn a guest token or owner hint into admin monitoring access',async()=>{
  const h=fixture(),token={uid:'guest',email:'testuser02@planview-ecf9b.invalid',firebase:{sign_in_provider:'password'}};
  const gateway=createGateway({verifyToken:async()=>token,allowedEmails:()=> 'hirsch.danny@gmx.de',testUserUid:()=> 'guest',origins:allowedOrigins('planview-test'),engine:h.engine,environment:()=>({}),config:{},schema:{}});
  const req={method:'GET',path:'/api/admin/monitoring',originalUrl:'/api/admin/monitoring?uid=owner',get:name=>({origin:'https://planview-test.web.app',authorization:'Bearer test.token'})[name]};
  const res={statusCode:0,set(){return this;},status(code){this.statusCode=code;return this;},type(){return this;},json(value){this.body=value;return this;},send(value){this.body=value;return this;}};
  await gateway(req,res);assert.equal(res.statusCode,403);assert.equal(h.reads,0);assert.equal(h.events.length,0);assert.equal(JSON.parse(res.body).error,'admin_required');
});
