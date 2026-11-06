import {randomUUID} from 'node:crypto';
import {createRequestMeter,priceCatalog} from './request-meter.mjs';

const paths=new Set(['/api/status','/api/settings','/api/ai/settings','/api/routes/status','/api/rp/plan','/api/dso/rules','/api/interpret','/api/ai/test','/api/rules/search','/api/permits/point','/api/permits/search','/api/routes']);
const aiSearchPaths=new Set(['/api/interpret','/api/ai/test','/api/rules/search','/api/permits/search']);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});

// Firebase-only boundary. No request body, query string, credentials or generated
// text is passed to monitoring storage. Authorization remains server-owned.
export function createMonitoredEngine({engine,store,quotaStore,feedbackApi,searchFeedbackApi,ownerUid,testUserUid=()=>'',fetcher=fetch,now=()=>Date.now(),id=randomUUID,onWriteError=()=>{},onQuotaError=()=>{}}){
  return async(request,env,user,config,schema)=>{
    const url=new URL(request.url),owner=ownerUid(),testUser=testUserUid();
    // Feedback is an explicit user submission, separate from AI usage and its
    // metadata log. The feedback API independently enforces the pinned identities.
    if(feedbackApi){const result=await feedbackApi(request,user);if(result)return result;}
    if(searchFeedbackApi){const result=await searchFeedbackApi(request,user);if(result)return result;}
    const limited=Boolean(testUser&&user===testUser&&user!==owner);
    if(url.pathname==='/api/quota'){
      if(request.method!=='GET')return json({error:'method_not_allowed'},405);
      if(url.search)return json({error:'invalid_quota_query'},400);
      if(!limited)return json({limited:false});
      try{return json({limited:true,...await quotaStore.status(user)});}
      catch{return json({error:'weekly_quota_unavailable'},503);}
    }
    if(url.pathname.startsWith('/api/admin/')){
      if(!owner||user!==owner)return json({error:'admin_required'},403);
      if(url.pathname!=='/api/admin/monitoring')return json({error:'unknown_endpoint'},404);
      if(request.method!=='GET')return json({error:'method_not_allowed'},405);
      if(url.search)return json({error:'invalid_monitor_query'},400);
      try{return json({...await store.read(),priceCatalog});}
      catch{return json({error:'monitoring_unavailable'},503);}
    }
    const start=now(),meter=createRequestMeter({fetcher,now});let status=503,reservation;
    try{
      if(limited&&request.method==='POST'&&aiSearchPaths.has(url.pathname)){
        let result;
        try{result=await quotaStore.reserve(user,id());}
        catch{
          try{onQuotaError();}catch{}
          return json({error:'weekly_quota_unavailable'},503);
        }
        if(!result.allowed){status=429;return json({error:'weekly_search_limit',quota:result.quota},429);}
        reservation=result.reservation;
      }
      const response=await engine(request,env,user,config,schema,meter.fetch);
      status=response.status;return response;
    }finally{
      try{
        const metrics=await meter.finish();
        // One user search may call OpenAI twice. Only searches that attempt an
        // OpenAI call consume a weekly slot; free/invalid searches return theirs.
        // An unfinished reservation stays consumed conservatively after a crash.
        if(reservation&&metrics.prompts===0){
          try{await quotaStore.refund(user,reservation);}
          catch{try{onQuotaError();}catch{}}
        }
        await store.record({id:id(),startedAt:new Date(start).toISOString(),user:user===owner?'Admin':user===testUserUid()?'TestUser02':'Approved user',
          endpoint:paths.has(url.pathname)?url.pathname:'/api/unknown',status,durationMs:Math.max(0,now()-start),metrics});
      }catch{try{onWriteError();}catch{/* Monitoring failures cannot replace app responses. */}}
    }
  };
}
