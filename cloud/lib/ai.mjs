import { fetchPointCorpus } from './rule-sources.mjs';
import { cleanRuleInput, rankRuleSources, callRuleOpenAI } from './rule-answer.mjs';
// Server-only PlanView API. No prompts, keys or results are logged or cached.
export class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export const metadata = { model: 'gpt-6-luna', reasoning: 'high', backend: 'openai-api' };
const encoder = new TextEncoder();
const encode = bytes => btoa(String.fromCharCode(...bytes));
const decode = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
});

async function cryptoKey(secret) {
  if (!secret) throw new ApiError(503, 'storage_unavailable');
  return crypto.subtle.importKey('raw', decode(secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptKey(value, user, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`planview:v1:${user}`) }, await cryptoKey(secret), encoder.encode(value));
  return { iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
}
async function storedKey(env, user) {
  const row = await env.DB.prepare('SELECT ciphertext, iv FROM ai_credentials WHERE user_id = ?').bind(user).first();
  if (!row) return null;
  const value = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(row.iv), additionalData: encoder.encode(`planview:v1:${user}`) }, await cryptoKey(env.PLANVIEW_CREDENTIAL_KEY), decode(row.ciphertext));
  return new TextDecoder().decode(value);
}
export function validateSchema(value,schema){
 const types=Array.isArray(schema.type)?schema.type:[schema.type];
 const type=value===null?'null':Array.isArray(value)?'array':typeof value;
 if(!types.includes(type)||schema.enum&&!schema.enum.includes(value))throw new ApiError(502,'invalid_ai_response');
 if(type==='number'&&(!Number.isFinite(value)||schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum))throw new ApiError(502,'invalid_ai_response');
 if(type==='string'&&(value.length>(schema.maxLength||3000)))throw new ApiError(502,'invalid_ai_response');
 if(type==='array'){if(value.length>(schema.maxItems||30))throw new ApiError(502,'invalid_ai_response');return value.map(x=>validateSchema(x,schema.items));}
 if(type==='object'){if((schema.required||[]).some(k=>!(k in value))||schema.additionalProperties===false&&Object.keys(value).some(k=>!(k in schema.properties)))throw new ApiError(502,'invalid_ai_response');return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,validateSchema(v,schema.properties[k])]));}
 return value;
}
export function validateFilters(value,schema){const clean=validateSchema(value,schema);for(const rule of Object.values(clean.distanceRules||{}))if(rule.minKm!==null&&rule.maxKm!==null&&rule.minKm>rule.maxKm)throw new ApiError(502,'invalid_ai_response');if(clean.potentialBuildingLand)clean.requireEnvelope=clean.requireUnbuilt=true;return clean;}
export function cleanInput(payload) {
  if (!payload || typeof payload.query !== 'string' || !payload.query.trim() || payload.query.length > 1200) throw new ApiError(400, 'invalid_query');
  const c = payload.context ?? {};
  if (!c || typeof c !== 'object' || Array.isArray(c) || JSON.stringify(c).length > 3200) throw new ApiError(400, 'invalid_context');
  const counts = c.nearbyFeatureCounts && typeof c.nearbyFeatureCounts === 'object' ? c.nearbyFeatureCounts : {};
  return { query: payload.query.trim(), context: {
    scope: String(c.scope || 'Nederland').slice(0, 100), interfaceLanguage: ['en', 'nl', 'de'].includes(c.interfaceLanguage) ? c.interfaceLanguage : 'en',
    sampledPlanFeatures: (Array.isArray(c.sampledPlanFeatures) ? c.sampledPlanFeatures : []).slice(0, 8).filter(x => x && typeof x === 'object').map(x => ({ designation: String(x.designation || '').slice(0, 100), group: String(x.group || '').slice(0, 40) })),
    nearbyFeatureCounts: Object.fromEntries(Object.entries(counts).filter(([k,v]) => ['camping','towns','industry','roads','station','park','sports','cemetery','swimming_pool','marina'].includes(k) && Number.isFinite(v)).map(([k,v]) => [k, Math.max(0, Math.min(3000, Math.trunc(v)))])),
    nearbyExamples: (Array.isArray(c.nearbyExamples) ? c.nearbyExamples : []).filter(x => typeof x === 'string').slice(0, 6).map(x => x.slice(0, 80))
  } };
}
// Validated model intent is preserved; no keyword-based server overrides.
const stabilize=(filters)=>filters;
export async function callOpenAI(key, payload, config, schema, fetcher = fetch) {
  const { query, context } = cleanInput(payload);
  let response;
  try {
    response = await fetcher('https://api.openai.com/v1/responses', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: metadata.model, reasoning: { effort: metadata.reasoning }, store: false, max_output_tokens: 8192,
        input: [{ role: 'system', content: config.instructions }, { role: 'user', content: JSON.stringify({ mapSnapshot: context, searchText: query }) }],
        text: { format: { type: 'json_schema', name: 'planview_search_filters', strict: true, schema } } })
    });
  } catch { throw new ApiError(502, 'provider_unavailable'); }
  if (!response.ok) throw new ApiError(response.status === 429 ? 429 : 502, response.status === 401 ? 'invalid_api_key' : response.status === 403 || response.status === 404 ? 'model_access_denied' : response.status === 429 ? 'provider_limit' : 'provider_unavailable');
  const raw = await response.text();
  if (raw.length > 200000) throw new ApiError(502, 'invalid_ai_response');
  let filters;
  try {
    const result = JSON.parse(raw);
    if (result.status !== 'completed') throw new Error();
    const output = (result.output || []).filter(x => x.type === 'message').flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text).join('');
    filters = validateFilters(JSON.parse(output), schema);
  } catch { throw new ApiError(502, 'invalid_ai_response'); }
  return { ...stabilize(filters, query), ...metadata, engine: metadata.model };
}
async function readBody(request, limit) {
  if (Number(request.headers.get('Content-Length')) > limit) throw new ApiError(413, 'request_too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'invalid_request');
  let size = 0; const chunks = [];
  for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new ApiError(413, 'request_too_large'); } chunks.push(value); }
  try { const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ApiError(400, 'invalid_request'); }
}
async function acquire(env, user, leaseMs=130000) {
  const now = Date.now(), lease = now + leaseMs;
  const result = await env.DB.prepare(`INSERT INTO ai_usage (user_id, window_start, requests, busy_until) VALUES (?, ?, 1, ?)
    ON CONFLICT(user_id) DO UPDATE SET window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END,
      requests = CASE WHEN window_start < ? THEN 1 ELSE requests + 1 END, busy_until = ?
    WHERE busy_until < ? AND (window_start < ? OR requests < 12)`).bind(user, now, lease, now-300000, now, now-300000, lease, now, now-300000).run();
  if (!result.meta.changes) throw new ApiError(429, 'request_limit');
  return lease;
}
async function storedDSOKey(env,user){
 const row=await env.DB.prepare('SELECT ciphertext, iv FROM source_credentials WHERE user_id = ? AND provider = ?').bind(user,'dso').first();if(!row)return null;
 const value=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(row.iv),additionalData:encoder.encode(`planview:v1:${user}:dso`)},await cryptoKey(env.PLANVIEW_CREDENTIAL_KEY),decode(row.ciphertext));return new TextDecoder().decode(value);
}
async function sourceSettings(env,user,payload){
 if(payload!==undefined){if(!payload||Object.keys(payload).some(k=>k!=='dso')||typeof payload.dso!=='string')throw new ApiError(400,'invalid_source_settings');const key=payload.dso.trim();
  if(!key)await env.DB.prepare('DELETE FROM source_credentials WHERE user_id = ? AND provider = ?').bind(user,'dso').run();
  else{if(!/^[A-Za-z0-9_.~+/-]{8,256}$/.test(key))throw new ApiError(400,'invalid_source_key');const encrypted=await encryptKey(key,user+':dso',env.PLANVIEW_CREDENTIAL_KEY);await env.DB.prepare('INSERT INTO source_credentials (user_id, provider, ciphertext, iv, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id,provider) DO UPDATE SET ciphertext=excluded.ciphertext, iv=excluded.iv, updated_at=excluded.updated_at').bind(user,'dso',encrypted.ciphertext,encrypted.iv,Date.now()).run();}}
 const row=await env.DB.prepare('SELECT updated_at FROM source_credentials WHERE user_id = ? AND provider = ?').bind(user,'dso').first();return {configured:{dso:!!row,rp:false},storage:'cloud-account',capabilities:{ruleText:true,dsoGeometry:false}};
}
async function rulesSearch(payload,env,user,fetcher){
 let input;try{input=cleanRuleInput(payload);}catch(error){throw new ApiError(400,error.message);}
 const dso=await storedDSOKey(env,user);if(!dso)return json({state:'unavailable',error:'dso_key_missing',sources:[],coverage:{complete:false,documentsChecked:0,documentsAvailable:0,warnings:['dso_key_missing']}});
 const lease=await acquire(env,user,200000);
 try{const corpus=await fetchPointCorpus(input.point,dso,fetcher,{query:input.query}),ranked=rankRuleSources(corpus,input.query);const response={state:ranked.sources.length?'matches':'unavailable',sources:ranked.sources,coverage:ranked.coverage,point:input.point,checkedAt:corpus.availableAt};
  if(input.planId)response.coverage.warnings.push('The clicked PDOK IMRO source may contain transitional planning rules not included in the DSO text corpus: '+input.planId);
  if(!response.sources.length)return json(response);
  const key=await storedKey(env,user);if(!key){response.coverage.warnings.push('api_key_missing');return json(response);}
  try{response.answer=await callRuleOpenAI(key,input,response.sources,fetcher);response.state=response.answer.citations.length?'answered':'matches';}catch{response.coverage.warnings.push('ai_unavailable');}
  return json(response);
 }catch{throw new ApiError(502,'rule_sources_unavailable');}finally{await env.DB.prepare('UPDATE ai_usage SET busy_until = 0 WHERE user_id = ? AND busy_until = ?').bind(user,lease).run();}
}
export async function handleApi(request, env, user, config, schema, fetcher = fetch) {
  try {
    if (!user) throw new ApiError(401, 'sign_in_required');
    const path = new URL(request.url).pathname;
    if (!env.DB || !env.PLANVIEW_CREDENTIAL_KEY) throw new ApiError(503, 'storage_unavailable');
    if(request.method==='GET'&&path==='/api/settings')return json(await sourceSettings(env,user));
    if (request.method === 'GET' && (path === '/api/status' || path === '/api/ai/settings')) {
      const row = await env.DB.prepare('SELECT updated_at FROM ai_credentials WHERE user_id = ?').bind(user).first();
      return json({ app: 'planview', ...metadata, available: !!row, configured: !!row, storage: 'cloud-account', interpreterVersion: 3, updatedAt: row?.updated_at || null });
    }
    if (request.method !== 'POST') throw new ApiError(404, 'unknown_endpoint');
    if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site' || request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') throw new ApiError(403, 'same_origin_required');
    const payload = await readBody(request, ['/api/ai/settings','/api/settings'].includes(path) ? 2048 : 8192);
    if(path==='/api/settings')return json(await sourceSettings(env,user,payload));
    if(path==='/api/rules/search')return await rulesSearch(payload,env,user,fetcher);
    if (path === '/api/ai/settings') {
      if (!payload || Object.keys(payload).length !== 1 || typeof payload.key !== 'string') throw new ApiError(400, 'invalid_api_key_format');
      const value = payload.key.trim();
      if (!value) { await env.DB.prepare('DELETE FROM ai_credentials WHERE user_id = ?').bind(user).run(); return json({ configured: false, storage: 'cloud-account' }); }
      if (!/^sk-[A-Za-z0-9_-]{16,508}$/.test(value)) throw new ApiError(400, 'invalid_api_key_format');
      const encrypted = await encryptKey(value, user, env.PLANVIEW_CREDENTIAL_KEY);
      await env.DB.prepare('INSERT INTO ai_credentials (user_id, ciphertext, iv, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET ciphertext=excluded.ciphertext, iv=excluded.iv, updated_at=excluded.updated_at').bind(user, encrypted.ciphertext, encrypted.iv, Date.now()).run();
      return json({ configured: true, storage: 'cloud-account' });
    }
    if (path !== '/api/interpret' && path !== '/api/ai/test') throw new ApiError(404, 'unknown_endpoint');
    const input = path === '/api/ai/test' ? { query: 'Find residential zoning.', context: { interfaceLanguage: 'en' } } : payload;
    cleanInput(input);
    const key = await storedKey(env, user);
    if (!key) throw new ApiError(409, 'api_key_missing');
    const lease = await acquire(env, user);
    try {
      const result = await callOpenAI(key, input, config, schema, fetcher);
      return json(path === '/api/ai/test' ? { ok: true, ...metadata } : result);
    } finally { await env.DB.prepare('UPDATE ai_usage SET busy_until = 0 WHERE user_id = ? AND busy_until = ?').bind(user, lease).run(); }
  } catch (error) {
    return json({ error: error instanceof ApiError ? error.code : 'service_unavailable' }, error instanceof ApiError ? error.status : 503);
  }
}
