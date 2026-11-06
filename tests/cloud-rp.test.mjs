import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanPlanId,fetchPlanMetadata} from '../cloud/lib/rp.mjs';
const id='NL.IMRO.0200.bp1253-vas1',key='fixture-rp-key-not-real';
const plan={id,naam:'Woningbouwlocatie',type:'bestemmingsplan',planstatusInfo:{planstatus:'vastgesteld',datum:'2016-02-18'},dossier:{status:'geheel onherroepelijk in werking'},isTamPlan:false,eindeRechtsgeldigheid:null};
test('RP uses fixed official host, server key and actual V4 metadata fields only',async()=>{
 const result=await fetchPlanMetadata(id,key,async(url,options)=>{
  assert.equal(url,`https://ruimte.omgevingswet.overheid.nl/ruimtelijke-plannen/api/opvragen/v4/plannen/${id}`);
  assert.equal(options.headers['x-api-key'],key);assert.equal(options.headers.Accept,'application/hal+json');assert.equal(options.redirect,'error');assert.ok(options.signal);
  return Response.json({...plan,_links:{next:'https://evil.example'},geometrie:{coordinates:[0,0]},secret:key});
 });
 assert.deepEqual(result,{id,title:plan.naam,type:plan.type,status:'vastgesteld',date:'2016-02-18',dossierStatus:plan.dossier.status,endOfLegalValidity:'',isTamPlan:false,source:'Ruimtelijke plannen V4'});
 assert.ok(!JSON.stringify(result).includes(key));
});
test('invalid RP IDs never make a provider call; upstream failures never echo its response',async()=>{
 for(const value of [null,'https://evil.example','NL.IMRO.0200/../private','NL.IMRO.0200?key=bad','NL.IMRO.'+'x'.repeat(121)])assert.throws(()=>cleanPlanId(value),{code:'invalid_plan_id'});
 await assert.rejects(()=>fetchPlanMetadata('bad',key,()=>assert.fail('no provider call')),{status:400,code:'invalid_plan_id'});
 for(const [status,code] of [[401,'rp_key_rejected'],[403,'rp_key_rejected'],[404,'rp_plan_not_found'],[429,'rp_limit'],[503,'rp_unavailable']])await assert.rejects(()=>fetchPlanMetadata(id,key,async()=>new Response(key,{status})),{code});
 await assert.rejects(()=>fetchPlanMetadata(id,key,async()=>{throw Error(key);} ),{code:'rp_unavailable'});
});
test('RP rejects mismatched IDs, malformed data and oversized payloads; fields are bounded',async()=>{
 for(const data of [{...plan,id:'NL.IMRO.wrong-id'},[],{...plan,naam:null}])await assert.rejects(()=>fetchPlanMetadata(id,key,async()=>Response.json(data)),{code:'invalid_rp_response'});
 await assert.rejects(()=>fetchPlanMetadata(id,key,async()=>new Response('x'.repeat(2000001))),{code:'invalid_rp_response'});
 const result=await fetchPlanMetadata(id,key,async()=>Response.json({...plan,naam:'x'.repeat(500),eindeRechtsgeldigheid:'2024-01-01',isTamPlan:true}));assert.equal(result.title.length,300);assert.equal(result.endOfLegalValidity,'2024-01-01');assert.equal(result.isTamPlan,true);
});
