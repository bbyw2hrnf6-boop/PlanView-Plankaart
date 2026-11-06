import {FeedbackError, feedbackCategory, feedbackId} from './feedback-store.mjs';

const json = (value, status = 200) => Response.json(value, {
  status, headers: {'Cache-Control': 'private, no-store'},
});
function invalid() { throw new FeedbackError('invalid_feedback'); }
async function body(request, allowed, required = allowed) {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') invalid();
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 16_384) invalid();
  let value;
  try { value = JSON.parse(text); } catch { invalid(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  if (Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) invalid();
  return value;
}

export function createFeedbackApi({store, ownerUid, testUserUid}) {
  return async (request, user) => {
    const url = new URL(request.url), isAdmin = url.pathname === '/api/admin/feedback';
    if (!isAdmin && url.pathname !== '/api/feedback') return null;
    const owner = ownerUid(), tester = testUserUid();
    if (isAdmin) {
      if (!owner || user !== owner) return json({error: 'admin_required'}, 403);
    } else if (!tester || user !== tester || user === owner) {
      return json({error: 'test_user_required'}, 403);
    }
    try {
      if (!isAdmin) {
        if (request.method !== 'POST') return json({error: 'method_not_allowed'}, 405);
        if (url.search) invalid();
        const value = await body(request, ['text', 'category', 'submissionId'], ['text', 'submissionId']);
        const result = await store.submit(user, value);
        return json({ok: true, ...result.receipt}, result.duplicate ? 200 : 201);
      }
      if (request.method === 'GET') {
        const keys = [...url.searchParams.keys()];
        if (keys.some(key => key !== 'cursor') || keys.length > 1) invalid();
        const cursor = url.searchParams.get('cursor');
        if (cursor !== null) feedbackId(cursor);
        return json(await store.list(cursor === null ? {} : {cursor}));
      }
      if (request.method === 'POST') {
        if (url.search) invalid();
        const value = await body(request, ['id', 'category']);
        feedbackId(value.id);
        feedbackCategory(value.category);
        return json({ok: true, ...await store.categorize(value)});
      }
      return json({error: 'method_not_allowed'}, 405);
    } catch (error) {
      if (error instanceof FeedbackError) return json({error: error.code, ...error.extra}, error.status);
      return json({error: 'feedback_unavailable'}, 503);
    }
  };
}
