import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreDB} from '../firebase/functions/firestore-db.mjs';
import {handleApi,encryptKey} from '../cloud/lib/ai.mjs';
function database(){
 const rows=new Map();let pending=Promise.resolve();
 const reference=id=>({id,async get(){return {exists:rows.has(id),data:()=>rows.get(id)};},async set(value){rows.set(id,structuredClone(value));},async delete(){rows.delete(id);}});
 return {rows,collection:name=>({doc:id=>reference(name+'/'+id)}),runTransaction(fn){const result=pending.then(()=>fn({get:ref=>ref.get(),set:(ref,v)=>rows.set(ref.id,structuredClone(v)),update:(ref,v)=>rows.set(ref.id,{...rows.get(ref.id),...v})}));pending=result.catch(()=>{});return result;}};
}
const secret=Buffer.alloc(32,7).toString('base64');
function request(path,payload){return new Request('https://project.web.app'+path,{method:payload===undefined?'GET':'POST',headers:{Origin:'https://project.web.app','Content-Type':'application/json'},...(payload===undefined?{}:{body:JSON.stringify(payload)})});}
test('Firebase stores encrypted credentials per user and never returns the secret to the browser',async()=>{
 const db=database(),env={DB:firestoreDB(db),PLANVIEW_CREDENTIAL_KEY:secret},key='sk-'+('x'.repeat(40));
 const saved=await handleApi(request('/api/ai/settings',{key}),env,'alice',{},{});assert.equal(saved.status,200);
 assert.ok([...db.rows.values()].every(row=>!JSON.stringify(row).includes(key)));
 const alice=await (await handleApi(request('/api/ai/settings'),env,'alice',{},{})).json();
 const bob=await (await handleApi(request('/api/ai/settings'),env,'bob',{},{})).json();
 assert.equal(alice.configured,true);assert.equal(bob.configured,false);assert.equal(alice.storage,'cloud-account');assert.equal(alice.key,undefined);
 await handleApi(request('/api/settings',{dso:'example-dso-key',ors:'example-routing-key'}),env,'alice',{},{});
 const settings=await (await handleApi(request('/api/settings'),env,'alice',{},{})).json();assert.equal(settings.configured.dso,true);assert.equal(settings.configured.ors,true);
 await handleApi(request('/api/settings',{dso:''}),env,'alice',{},{});
 assert.equal((await (await handleApi(request('/api/settings'),env,'alice',{},{})).json()).configured.dso,false);
 // Actual decryption through the shared rules endpoint reaches the fetcher with Alice's stored DSO key.
 await handleApi(request('/api/settings',{dso:'example-dso-key'}),env,'alice',{},{});
 let received=false;await handleApi(request('/api/rules/search',{point:{x:176000,y:318000},query:'bouwen'}),env,'alice',{}, {},async(url,options)=>{received ||= options.headers?.['x-api-key']==='example-dso-key';return new Response('{}',{status:503});});
 assert.equal(received,true);
});
test('Firebase transactions reject concurrent leases, retain request counts, and ignore stale releases',async()=>{
 const db=firestoreDB(database()),sql=`INSERT INTO ai_usage (user_id, window_start, requests, busy_until) VALUES (?, ?, 1, ?) ON CONFLICT(user_id) DO UPDATE SET window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END, requests = CASE WHEN window_start < ? THEN 1 ELSE requests + 1 END, busy_until = ? WHERE busy_until < ? AND (window_start < ? OR requests < ?)`;
 const acquire=(now,lease)=>db.prepare(sql).bind('alice',now,lease,now-300000,now,now-300000,lease,now,now-300000,2).run();
 const parallel=await Promise.all([acquire(1000,2000),acquire(1000,3000)]);assert.equal(parallel.reduce((n,r)=>n+r.meta.changes,0),1);
 const release=(lease)=>db.prepare('UPDATE ai_usage SET busy_until = 0 WHERE user_id = ? AND busy_until = ?').bind('alice',lease).run();
 assert.equal((await release(9999)).meta.changes,0);assert.equal((await acquire(1500,4000)).meta.changes,0);
 await release(2000);assert.equal((await acquire(2100,4000)).meta.changes,1);await release(4000);assert.equal((await acquire(4100,6000)).meta.changes,0);
 assert.equal((await acquire(400000,401000)).meta.changes,1);
});
test('Firebase storage refuses unsupported queries',async()=>{const db=firestoreDB(database());await assert.rejects(db.prepare('SELECT * FROM anything').bind('alice').first(),/unsupported/);await assert.rejects(db.prepare('DROP TABLE ai_credentials').bind().run(),/unsupported/);});
