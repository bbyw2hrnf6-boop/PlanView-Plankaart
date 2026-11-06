import {SearchFeedbackError, searchFeedbackId} from './search-feedback-store.mjs';

const json = (value, status = 200) => Response.json(value, {
  status, headers: {'Cache-Control': 'private, no-store'},
});
function invalid() { throw new SearchFeedbackError('invalid_search_feedback'); }
async function body(request) {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') invalid();
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 8192) invalid();
  let value;
  try { value = JSON.parse(raw); } catch { invalid(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const allowed = ['searchId', 'submissionId', 'kind', 'rating', 'text', 'outcome', 'resultCount'];
  if (Object.keys(value).some(key => !allowed.includes(key)) || allowed.some(key => !Object.hasOwn(value, key))) invalid();
  return value;
}
export function createSearchFeedbackApi({store, ownerUid, testUserUid}) {
  return async (request, user) => {
    const url = new URL(request.url), admin = url.pathname === '/api/admin/search-feedback';
    if (!admin && url.pathname !== '/api/search-feedback') return null;
    const owner = ownerUid(), tester = testUserUid();
    if (admin) {
      if (!owner || user !== owner) return json({error: 'admin_required'}, 403);
    } else if (!tester || user !== tester || user === owner) return json({error: 'test_user_required'}, 403);
    try {
      if (request.method !== (admin ? 'GET' : 'POST')) return json({error: 'method_not_allowed'}, 405);
      if (!admin) {
        if (url.search) invalid();
        const result = await store.submit(user, await body(request));
        return json({ok: true, ...result.receipt}, result.duplicate ? 200 : 201);
      }
      const keys = [...url.searchParams.keys()];
      if (keys.some(key => key !== 'cursor') || keys.length > 1) invalid();
      const cursor = url.searchParams.get('cursor');
      if (cursor !== null) searchFeedbackId(cursor);
      return json(await store.list(cursor === null ? {} : {cursor}));
    } catch (error) {
      if (error instanceof SearchFeedbackError) return json({error: error.code, ...error.extra}, error.status);
      return json({error: 'search_feedback_unavailable'}, 503);
    }
  };
}
