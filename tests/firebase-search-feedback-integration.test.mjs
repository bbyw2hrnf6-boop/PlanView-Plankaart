import test from 'node:test';
import assert from 'node:assert/strict';
import {createGateway,allowedOrigins} from '../firebase/functions/gateway.mjs';
import {createMonitoredEngine} from '../firebase/functions/monitored-engine.mjs';
import {createSearchFeedbackApi} from '../firebase/functions/search-feedback-api.mjs';
import {createSearchFeedbackStore} from '../firebase/functions/search-feedback-store.mjs';

function database(){
 const rows=new Map();
 const snapshot=path=>({exists:rows.has(path),id:path.split('/').at(-1),data:()=>structuredClone(rows.get(path))});
 return {rows,collection:name=>({doc:id=>({path:name+'/'+id}),orderBy(field,direction){
  assert.equal(field,'createdAt');assert.equal(direction,'desc');let cursor='',limit=50;
  const query={orderBy(name,direction){assert.equal(name,'__name__');assert.equal(direction,'desc');return query;},startAfter(time,value){assert.equal(time,value.slice(0,24));cursor=value;return query;},limit(value){limit=value;return query;},async get(){
   return {docs:[...rows.keys()].filter(path=>path.startsWith(name+'/')&&(!cursor||path.slice(name.length+1)<cursor)).sort().reverse().slice(0,limit).map(snapshot)};
  }};return query;
 }}),async runTransaction(fn){
  const staged=new Map();const result=await fn({get:async ref=>snapshot(ref.path),set:(ref,value)=>staged.set(ref.path,structuredClone(value))});
  for(const [path,value]of staged)rows.set(path,value);return result;
 }};
}
function fixture(){
 const db=database(),records=[];let quotaCalls=0,engineCalls=0;
 const searchFeedbackApi=createSearchFeedbackApi({store:createSearchFeedbackStore(db),ownerUid:()=> 'owner',testUserUid:()=> 'tester'});
 const engine=createMonitoredEngine({searchFeedbackApi,ownerUid:()=> 'owner',testUserUid:()=> 'tester',
  quotaStore:{reserve:async()=>{quotaCalls++;return {allowed:false,quota:{remaining:0}};}},
  store:{record:async value=>records.push(value)},engine:async()=>{engineCalls++;return Response.json({ok:true});}});
 async function run(path,uid='tester',method='POST',body){
  const token=uid==='owner'?{uid,email:'hirsch.danny@gmx.de',email_verified:true}:{uid,email:'testuser02@planview-ecf9b.invalid',firebase:{sign_in_provider:'password'}};
  const gateway=createGateway({verifyToken:async()=>token,allowedEmails:()=> 'hirsch.danny@gmx.de',testUserUid:()=> 'tester',origins:allowedOrigins('planview-test'),engine,environment:()=>({}),config:{},schema:{}});
  const req={method,path:path.split('?')[0],originalUrl:path,rawBody:body===undefined?null:Buffer.from(JSON.stringify(body)),get:key=>({origin:'https://planview-test.web.app',authorization:'Bearer valid.token','content-type':'application/json'})[key]};
  const res={statusCode:0,set(){return this;},status(value){this.statusCode=value;return this;},type(){return this;},send(value){this.body=JSON.parse(value);return this;},json(value){this.body=value;return this;}};
  await gateway(req,res);return res;
 }
 return {run,db,records,get quotaCalls(){return quotaCalls;},get engineCalls(){return engineCalls;}};
}
const rating={searchId:'d510e798-37ed-4257-8e8b-035891812ff4',submissionId:'c69d1d6f-5809-483c-b6d8-59a4e538c28a',kind:'permits',rating:'down',text:'The answer was incomplete.',outcome:'partial',resultCount:1};

test('authenticated tester rates at zero AI allowance; owner reads it, with no prompt cost or operational logging',async()=>{
 const h=fixture();
 assert.equal((await h.run('/api/interpret')).statusCode,429);
 const saved=await h.run('/api/search-feedback','tester','POST',rating);
 assert.equal(saved.statusCode,201);assert.equal(saved.body.ok,true);
 const repeated=await h.run('/api/search-feedback','tester','POST',rating);
 assert.equal(repeated.statusCode,200);assert.equal(repeated.body.id,saved.body.id);
 const list=await h.run('/api/admin/search-feedback','owner','GET');
 assert.equal(list.statusCode,200);assert.deepEqual(list.body,{items:[{id:saved.body.id,searchId:rating.searchId,kind:'permits',rating:'down',text:rating.text,outcome:'partial',resultCount:1,createdAt:saved.body.createdAt,user:'TestUser02'}],nextCursor:null});
 assert.equal(h.quotaCalls,1,'rating does not reserve AI slots');assert.equal(h.engineCalls,0);
 assert.equal(h.records.length,1,'rating does not enter the operational AI usage log');
 assert.equal(JSON.stringify(h.records).includes(rating.text),false);
 assert.equal(JSON.stringify(h.records).includes(rating.searchId),false);
});
test('gateway validates identity before search ratings; tester cannot read ratings and owner cannot submit as tester',async()=>{
 const h=fixture();
 assert.equal((await h.run('/api/admin/search-feedback','tester','GET')).statusCode,403);
 assert.equal((await h.run('/api/search-feedback','owner','POST',rating)).statusCode,403);
 assert.equal((await h.run('/api/search-feedback','another','POST',rating)).statusCode,403);
 assert.equal((await h.run('/api/search-feedback','tester','POST',{...rating,uid:'owner'})).statusCode,400);
 assert.equal((await h.run('/api/admin/search-feedback?uid=owner','owner','GET')).statusCode,400);
 assert.equal(h.db.rows.size,0);assert.equal(h.records.length,0);assert.equal(h.quotaCalls,0);
});
test('rating once cannot be changed through second submission or overwritten by a caller timestamp',async()=>{
 const h=fixture();
 const saved=await h.run('/api/search-feedback','tester','POST',rating);assert.equal(saved.statusCode,201);
 assert.equal((await h.run('/api/search-feedback','tester','POST',{...rating,text:'Changed'})).statusCode,400);
 assert.equal((await h.run('/api/search-feedback','tester','POST',{...rating,submissionId:'b9430738-c7a5-4374-b4ed-1933e153566c',rating:'up',text:''})).statusCode,409);
 assert.equal((await h.run('/api/search-feedback','tester','POST',{...rating,createdAt:'2000-01-01'})).statusCode,400);
 const list=await h.run('/api/admin/search-feedback','owner','GET');assert.equal(list.body.items.length,1);assert.equal(list.body.items[0].text,rating.text);
 assert.equal(h.records.length,0);assert.equal(h.quotaCalls,0);
});
