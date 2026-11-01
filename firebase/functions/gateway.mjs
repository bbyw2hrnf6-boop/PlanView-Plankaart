export function allowedOrigins(project,extra='') {
  return new Set([`https://${project}.web.app`,`https://${project}.firebaseapp.com`,...extra.split(',').map(s=>s.trim()).filter(Boolean)].filter(s=>{try{return new URL(s).origin===s&&s.startsWith('https://');}catch{return false;}}));
}
export function accessAllowed(token,emails) {
  return token?.email_verified===true&&new Set(emails.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean)).has(String(token.email||'').toLowerCase());
}
export function createGateway({verifyToken,allowedEmails,origins,engine,environment,config,schema}) {
  return async function gateway(req,res) {
    res.set('Cache-Control','private, no-store');res.set('X-Content-Type-Options','nosniff');res.set('Vary','Origin');
    const origin=req.get('origin');
    if(!origin||!origins.has(origin))return res.status(403).json({error:'origin_not_allowed'});
    res.set('Access-Control-Allow-Origin',origin);
    if(req.method==='OPTIONS') {
      res.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.set('Access-Control-Allow-Headers','Authorization, Content-Type');res.set('Access-Control-Max-Age','600');return res.status(204).send('');
    }
    if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'method_not_allowed'});
    const match=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(req.get('authorization')||'');
    if(!match)return res.status(401).json({error:'sign_in_required'});
    let token;try{token=await verifyToken(match[1]);}catch{return res.status(401).json({error:'sign_in_required'});}
    if(!accessAllowed(token,allowedEmails()))return res.status(403).json({error:'account_not_allowed'});
    const path=req.path;
    if(!/^\/api\/[a-z/-]+$/.test(path))return res.status(404).json({error:'unknown_endpoint'});
    const body=req.method==='POST'?req.rawBody:null;
    if(body&&body.length>8192)return res.status(413).json({error:'request_too_large'});
    try {
      const headers=new Headers({'Origin':origin,'Sec-Fetch-Site':'same-origin'});
      if(req.method==='POST')headers.set('Content-Type',req.get('content-type')||'');
      // The validated Firebase bearer token replaces Sites identity. Never trust a client UID.
      const request=new Request(origin+path,{method:req.method,headers,...(body?{body:new Uint8Array(body)}:{})});
      const result=await engine(request,environment(),token.uid,config,schema);
      return res.status(result.status).type('application/json').send(await result.text());
    }catch{return res.status(503).json({error:'service_unavailable'});}
  };
}
