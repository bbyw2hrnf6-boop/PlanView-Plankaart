export function authenticatedFetch(baseFetch,{ready,user,apiBase,origin,onResponse}) {
  return async(input,options)=>{
    const request=new Request(input,options),url=new URL(request.url);
    if(url.origin!==origin||!url.pathname.startsWith('/api/'))return baseFetch(input,options);
    await ready;
    const current=user();
    if(!current)return new Response(JSON.stringify({error:'sign_in_required'}),{status:401,headers:{'Content-Type':'application/json'}});
    const headers=new Headers(request.headers);headers.set('Authorization','Bearer '+await current.getIdToken());
    // The direct Function endpoint avoids Hosting's 60-second timeout.
    const response=await baseFetch(apiBase()+url.pathname+url.search,{method:request.method,headers,credentials:'omit',signal:request.signal,...(!['GET','HEAD'].includes(request.method)?{body:await request.arrayBuffer()}:{} )});
    // Observers receive response metadata only; they never consume the caller's body.
    try{Promise.resolve(onResponse?.({status:response.status},{path:url.pathname,method:request.method})).catch(()=>{});}catch{}
    return response;
  };
}
