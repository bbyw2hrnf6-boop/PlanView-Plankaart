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
export function validateFilters(value, schema) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || schema.required.some(key => !(key in value))) throw new ApiError(502, 'invalid_ai_response');
  const clean = {};
  for (const [key, spec] of Object.entries(schema.properties)) {
    const item = value[key];
    if (spec.type === 'boolean' && typeof item !== 'boolean' || spec.type === 'string' && (typeof item !== 'string' || item.length > 3000 || spec.enum && !spec.enum.includes(item))) throw new ApiError(502, 'invalid_ai_response');
    if (spec.type === 'array' && (!Array.isArray(item) || item.length > 30 || item.some(entry => typeof entry !== 'string' || entry.length > 500 || spec.items.enum && !spec.items.enum.includes(entry)))) throw new ApiError(502, 'invalid_ai_response');
    clean[key] = item;
  }
  if (clean.potentialBuildingLand) clean.requireEnvelope = clean.requireUnbuilt = true;
  return clean;
}
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
function stabilize(filters, query) {
  if (/\b(quiet|silent|peaceful|ruhig|leise|still|stil|rustig)\b/i.test(query) && !/\b(?:\d+\s*dB|decibel|dezibel|geluidsniveau\s*\d+|noise level\s*\d+)\b/i.test(query)) {
    filters.preferQuiet = true;
    filters.unsupported = filters.unsupported.filter(x => !/(sound|noise|quiet|silent|l[aä]rm|ger[aä]usch|geluid|stilte|ruhe)/i.test(x));
  }
  if (/(baufenster|bouwvlak|building envelope)/i.test(query) && /(pr[uü]fhinweis|review lead|ter controle|onderzoeks?locatie)/i.test(query)) filters.requireEnvelope = filters.includeReviewLeads = true;
  if (/(industrie|industry|industrial|bedrijventerrein)/i.test(query) && /1[,.]2\s*km/i.test(query)) {
    filters.avoidIndustry = true;
    filters.unsupported = filters.unsupported.filter(x => !/(industrie|industry|industrial|bedrijventerrein)/i.test(x));
  }
  if (/(plangrenz|plan boundar|plangrens)/i.test(query)) filters.unsupported = filters.unsupported.filter(x => !/(plangrenz|plan boundar|plangrens)/i.test(x));
  return filters;
}
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
async function acquire(env, user) {
  const now = Date.now(), lease = now + 130000;
  const result = await env.DB.prepare(`INSERT INTO ai_usage (user_id, window_start, requests, busy_until) VALUES (?, ?, 1, ?)
    ON CONFLICT(user_id) DO UPDATE SET window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END,
      requests = CASE WHEN window_start < ? THEN 1 ELSE requests + 1 END, busy_until = ?
    WHERE busy_until < ? AND (window_start < ? OR requests < 12)`).bind(user, now, lease, now-300000, now, now-300000, lease, now, now-300000).run();
  if (!result.meta.changes) throw new ApiError(429, 'request_limit');
  return lease;
}
export async function handleApi(request, env, user, config, schema, fetcher = fetch) {
  try {
    if (!user) throw new ApiError(401, 'sign_in_required');
    const path = new URL(request.url).pathname;
    if (!env.DB || !env.PLANVIEW_CREDENTIAL_KEY) throw new ApiError(503, 'storage_unavailable');
    if (request.method === 'GET' && (path === '/api/status' || path === '/api/ai/settings')) {
      const row = await env.DB.prepare('SELECT updated_at FROM ai_credentials WHERE user_id = ?').bind(user).first();
      return json({ app: 'planview', ...metadata, available: !!row, configured: !!row, storage: 'cloud-account', interpreterVersion: 3, updatedAt: row?.updated_at || null });
    }
    if (request.method !== 'POST') throw new ApiError(404, 'unknown_endpoint');
    if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site' || request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') throw new ApiError(403, 'same_origin_required');
    const payload = await readBody(request, path === '/api/ai/settings' ? 2048 : 8192);
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
