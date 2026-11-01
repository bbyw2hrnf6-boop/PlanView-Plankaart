import test from 'node:test';
import assert from 'node:assert/strict';
import {authenticatedFetch} from '../firebase/browser/transport.mjs';
const origin='https://project.web.app',api='https://europe-west1-project.cloudfunctions.net/planviewApi';
test('Firebase transport sends identity only to its own API and preserves payloads and cancellation',async()=>{
 const calls=[],controller=new AbortController();
 const send=authenticatedFetch(async(...args)=>{calls.push(args);return new Response('{}');},{ready:Promise.resolve(),user:()=>({getIdToken:async()=>'private-token'}),apiBase:()=>api,origin});
 await send(origin+'/api/permits/search',{method:'POST',body:'{"query":"bouw"}',headers:{'Content-Type':'application/json'},signal:controller.signal});
 assert.equal(calls[0][0],api+'/api/permits/search');assert.equal(calls[0][1].headers.get('Authorization'),'Bearer private-token');assert.equal(new TextDecoder().decode(calls[0][1].body),'{"query":"bouw"}');assert.equal(calls[0][1].credentials,'omit');
 controller.abort();assert.equal(calls[0][1].signal.aborted,true);
 await send('https://api.pdok.nl/public');assert.equal(calls[1][0],'https://api.pdok.nl/public');assert.equal(calls[1][1],undefined);
 await send(origin+'/app.js');assert.equal(calls[2][0],origin+'/app.js');assert.equal(calls[2][1],undefined);
});
test('signed-out Firebase transport never calls backend with an anonymous user',async()=>{
 let sent=false;const send=authenticatedFetch(async()=>{sent=true;},{ready:Promise.resolve(),user:()=>null,apiBase:()=>api,origin});
 const response=await send(origin+'/api/status');assert.equal(response.status,401);assert.equal(sent,false);
});
