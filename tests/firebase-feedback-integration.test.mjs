import test from 'node:test';
import assert from 'node:assert/strict';
import {createGateway,allowedOrigins} from '../firebase/functions/gateway.mjs';
import {createMonitoredEngine} from '../firebase/functions/monitored-engine.mjs';
import {createFeedbackApi} from '../firebase/functions/feedback-api.mjs';
import {createFeedbackStore} from '../firebase/functions/feedback-store.mjs';

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
 const feedbackApi=createFeedbackApi({store:createFeedbackStore(db),ownerUid:()=> 'owner',testUserUid:()=> 'tester'});
 const engine=createMonitoredEngine({feedbackApi,ownerUid:()=> 'owner',testUserUid:()=> 'tester',
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
const note={text:'Die Suche war hilfreich.\nDie Schaltfläche könnte deutlicher sein.',submissionId:'d510e798-37ed-4257-8e8b-035891812ff4'};

test('verified tester can save feedback at zero AI allowance; owner can read and categorize the stored original',async()=>{
 const h=fixture();assert.equal((await h.run('/api/interpret')).statusCode,429);
 const saved=await h.run('/api/feedback','tester','POST',note);assert.equal(saved.statusCode,201);assert.equal(saved.body.ok,true);
 const repeated=await h.run('/api/feedback','tester','POST',note);assert.equal(repeated.statusCode,200);assert.equal(repeated.body.id,saved.body.id);
 const list=await h.run('/api/admin/feedback','owner','GET');assert.equal(list.statusCode,200);assert.equal(list.body.items.length,1);
 const item=list.body.items[0];assert.equal(item.text,note.text);assert.equal(item.category,'uncategorized');assert.equal(item.id.slice(0,24),item.createdAt);assert.equal(item.user,'TestUser02');
 const changed=await h.run('/api/admin/feedback','owner','POST',{id:item.id,category:'interface'});assert.equal(changed.statusCode,200);assert.equal(changed.body.item.text,note.text);
 const after=await h.run('/api/admin/feedback','owner','GET');assert.equal(after.body.items[0].category,'interface');assert.equal(after.body.items[0].createdAt,item.createdAt);
 assert.equal(h.quotaCalls,1,'feedback never enters AI reservation code');assert.equal(h.engineCalls,0);assert.equal(h.records.length,1,'feedback text never enters operational usage logging');
 assert.equal(JSON.stringify(h.records).includes(note.text),false);
});
test('guest cannot read or recategorize feedback, owner cannot impersonate tester and body UID hints are rejected',async()=>{
 const h=fixture();
 assert.equal((await h.run('/api/admin/feedback','tester','GET')).statusCode,403);
 assert.equal((await h.run('/api/admin/feedback','tester','POST',{id:'anything',category:'map'})).statusCode,403);
 assert.equal((await h.run('/api/feedback','owner','POST',note)).statusCode,403);
 assert.equal((await h.run('/api/feedback','another','POST',note)).statusCode,403);
 assert.equal((await h.run('/api/feedback','tester','POST',{...note,uid:'owner'})).statusCode,400);
 assert.equal((await h.run('/api/admin/feedback?uid=owner','owner','GET')).statusCode,400);
 assert.equal(h.db.rows.size,0);assert.equal(h.records.length,0);assert.equal(h.quotaCalls,0);
});
