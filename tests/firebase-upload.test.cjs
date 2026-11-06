const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {bufferedHostingFetch}=require('../firebase/upload-transport.cjs');
const target='https://upload-firebasehosting.googleapis.com/upload/sites/planview-ecf9b/versions/abc123/files/'+'a'.repeat(64);
test('Hosting upload buffers exact bytes and preserves credentials, method and cancellation',async()=>{
  const signal=new AbortController().signal,headers={Authorization:'Bearer example'},body=Readable.from([Buffer.from([0,255]),Buffer.from([1,2])]);
  let call;
  const fetcher=bufferedHostingFetch(async(...args)=>{call=args;return 'done';});
  assert.equal(await fetcher(target,{method:'POST',headers,signal,body,duplex:'half'}),'done');
  assert.equal(call[0],target);assert.deepEqual(call[1].body,Buffer.from([0,255,1,2]));
  assert.equal(call[1].headers,headers);assert.equal(call[1].signal,signal);assert.equal(call[1].method,'POST');
});
test('all other hosts, projects, paths, methods and existing buffers retain original transport',async()=>{
  for(const [url,method] of [[target.replace('upload-firebasehosting.googleapis.com','example.com'),'POST'],[target.replace('planview-ecf9b','other-project'),'POST'],[target.replace('/files/','/other/'),'POST'],[target,'GET']]){
    const options={method,body:Readable.from(['unchanged'])};let forwarded;
    await bufferedHostingFetch(async(input,opts)=>{forwarded=opts;})(url,options);assert.equal(forwarded,options);
  }
  const options={method:'POST',body:Buffer.from('already buffered')};let forwarded;
  await bufferedHostingFetch(async(input,opts)=>{forwarded=opts;})(target,options);assert.equal(forwarded,options);
});
