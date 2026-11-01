import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedOrigins,accessAllowed,createGateway} from '../firebase/functions/gateway.mjs';
function harness({token={uid:'trusted-uid',email:'hirsch.danny@gmx.de',email_verified:true},testUserUid='',origin='https://demo-project.web.app',method='POST',authorization='Bearer valid.token',path='/api/settings',body={dso:'example-key'},fail=false}={}){
 const calls=[],headers={origin,authorization,'content-type':'application/json'};
 const req={method,path,rawBody:Buffer.from(JSON.stringify(body)),get:name=>headers[name]};
 const res={statusCode:200,headers:{},set(k,v){this.headers[k]=v;return this;},status(code){this.statusCode=code;return this;},type(){return this;},json(value){this.body=value;return this;},send(value){this.body=value;return this;}};
 const handler=createGateway({verifyToken:async()=>{if(fail)throw Error();return token;},allowedEmails:()=>'hirsch.danny@gmx.de',testUserUid:()=>testUserUid,origins:allowedOrigins('demo-project'),engine:async(request,env,user)=>{calls.push({request,env,user,payload:await request.json()});return new Response('{"configured":true}',{status:200});},environment:()=>({private:true}),config:{},schema:{}});
 return {req,res,calls,run:()=>handler(req,res)};
}
test('only verified allowlisted Firebase users can use the API',async()=>{
 for(const params of [{authorization:''},{fail:true},{token:{uid:'attacker',email:'hirsch.danny@gmx.de',email_verified:false}},{token:{uid:'guest',email:'other@example.com',email_verified:true}},{origin:'https://evil.example'},{origin:undefined}]){const h=harness(params);if('origin'in params&&params.origin===undefined)h.req.get=name=>name==='origin'?undefined:'Bearer valid.token';await h.run();assert.ok([401,403].includes(h.res.statusCode));assert.equal(h.calls.length,0);}
 const h=harness();await h.run();assert.equal(h.res.statusCode,200);assert.equal(h.calls[0].user,'trusted-uid');assert.equal(h.res.headers['Access-Control-Allow-Origin'],'https://demo-project.web.app');assert.equal(h.calls[0].request.headers.get('Authorization'),null);
});
test('CORS preflight reveals no account or keys; large and unsupported requests are rejected',async()=>{
 const preflight=harness({method:'OPTIONS',authorization:''});await preflight.run();assert.equal(preflight.res.statusCode,204);assert.equal(preflight.calls.length,0);
 const big=harness({body:{value:'x'.repeat(9000)}});await big.run();assert.equal(big.res.statusCode,413);
 const bad=harness({path:'/api/../settings'});await bad.run();assert.equal(bad.res.statusCode,404);
 assert.equal(allowedOrigins('demo-project','https://custom.example,http://unsafe.example,https://bad.example/path').size,3);
 assert.equal(accessAllowed({uid:'owner',email:'HIRSCH.DANNY@GMX.DE',email_verified:true},'hirsch.danny@gmx.de'),true);
});
test('only the pinned test UID with its password provider can enter, using its own storage identity',async()=>{
 const token={uid:'test-uid',email:'testuser02@planview-ecf9b.invalid',email_verified:false,firebase:{sign_in_provider:'password'}};
 const h=harness({token,testUserUid:'test-uid'});await h.run();assert.equal(h.res.statusCode,200);assert.equal(h.calls[0].user,'test-uid');
 for(const override of [{testUserUid:''},{token:{...token,uid:'different-user'}},{token:{...token,email:'other@example.com'}},{token:{...token,firebase:{sign_in_provider:'google.com'}}},{token:{...token,firebase:{sign_in_provider:'anonymous'}}},{fail:true}]){
  const denied=harness({token,testUserUid:'test-uid',...override});await denied.run();assert.ok([401,403].includes(denied.res.statusCode));assert.equal(denied.calls.length,0);
 }
 assert.equal(accessAllowed({email:'hirsch.danny@gmx.de',email_verified:true},'hirsch.danny@gmx.de'),false);
});
