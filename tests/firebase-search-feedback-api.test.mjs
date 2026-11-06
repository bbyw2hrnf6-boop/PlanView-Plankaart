import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSearchFeedbackApi} from '../firebase/functions/search-feedback-api.mjs';
import {SearchFeedbackError} from '../firebase/functions/search-feedback-store.mjs';
const RECORD_ID = '2026-11-01T13:00:00.000Z_5adc938b-019b-48ae-9f85-ac0ce96201e1';
const RECEIPT = {id: RECORD_ID, createdAt: '2026-11-01T13:00:00.000Z'};
const input = overrides => ({searchId: randomUUID(), submissionId: randomUUID(), kind: 'rules', rating: 'down', text: 'It missed a rule.', outcome: 'partial', resultCount: 2, ...overrides});
const request = (path, body, method = body === undefined ? 'GET' : 'POST', headers = {}) => new Request('https://planview.test' + path, {
  method, ...(body !== undefined ? {body: JSON.stringify(body), headers: {'Content-Type': 'application/json', ...headers}} : {headers}),
});
function fixture(overrides = {}) {
  const calls = [];
  const api = createSearchFeedbackApi({ownerUid: () => 'owner', testUserUid: () => 'guest', store: {
    async submit(uid, value) { calls.push(['submit', uid, value]); return {receipt: RECEIPT, duplicate: false}; },
    async list(value) { calls.push(['list', value]); return {items: [], nextCursor: null}; },
  }, ...overrides});
  return {calls, api, run: (path, user = 'guest', value, method, headers) => api(request(path, value, method, headers), user)};
}

test('search feedback API leaves existing feedback, searches and monitoring endpoints untouched', async () => {
  const h = fixture();
  for (const path of ['/api/status', '/api/admin/feedback', '/api/feedback', '/api/search-feedback/other', '/api/admin/monitoring']) assert.equal(await h.run(path), null);
  assert.equal(h.calls.length, 0);
});
test('only pinned test UID can submit; body identity, unspecified tester and owner tester cannot grant access', async () => {
  const h = fixture(), value = input();
  for (const uid of ['', 'owner', 'another']) {
    const response = await h.run('/api/search-feedback', uid, value);
    assert.equal(response.status, 403); assert.deepEqual(await response.json(), {error: 'test_user_required'});
  }
  assert.equal((await fixture({testUserUid: () => ''}).run('/api/search-feedback', 'guest', value)).status, 403);
  assert.equal((await fixture({testUserUid: () => 'owner'}).run('/api/search-feedback', 'owner', value)).status, 403);
  assert.equal((await h.run('/api/search-feedback', 'guest', {...value, uid: 'owner'})).status, 400);
  assert.equal(h.calls.length, 0);
});
test('new rating returns private minimal 201 receipt; exact retries return 200', async () => {
  const h = fixture(), value = input();
  const response = await h.run('/api/search-feedback', 'guest', value);
  assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), {ok: true, ...RECEIPT});
  assert.deepEqual(h.calls, [['submit', 'guest', value]]);
  const repeat = fixture({store: {submit: async () => ({receipt: RECEIPT, duplicate: true})}});
  assert.equal((await repeat.run('/api/search-feedback', 'guest', value)).status, 200);
});
test('only configured owner can list; timestamp/document ID cursor is forwarded', async () => {
  const h = fixture();
  for (const uid of ['', 'guest', 'another']) assert.equal((await h.run('/api/admin/search-feedback', uid)).status, 403);
  assert.equal((await fixture({ownerUid: () => ''}).run('/api/admin/search-feedback', 'owner')).status, 403);
  assert.equal(h.calls.length, 0);
  const response = await h.run('/api/admin/search-feedback', 'owner');
  assert.deepEqual(await response.json(), {items: [], nextCursor: null});
  assert.equal((await h.run('/api/admin/search-feedback?cursor=' + encodeURIComponent(RECORD_ID), 'owner')).status, 200);
  assert.deepEqual(h.calls, [['list', {}], ['list', {cursor: RECORD_ID}]]);
});
test('unsupported methods and parameters never touch storage', async () => {
  const h = fixture();
  for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await h.run('/api/search-feedback', 'guest', undefined, method)).status, 405);
  for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await h.run('/api/admin/search-feedback', 'owner', undefined, method)).status, 405);
  assert.equal((await h.run('/api/search-feedback?uid=guest', 'guest', input())).status, 400);
  for (const path of ['/api/admin/search-feedback?rating=up', '/api/admin/search-feedback?cursor=bad', '/api/admin/search-feedback?cursor=', '/api/admin/search-feedback?cursor=' + encodeURIComponent(RECORD_ID) + '&cursor=' + encodeURIComponent(RECORD_ID)]) assert.equal((await h.run(path, 'owner')).status, 400);
  assert.equal(h.calls.length, 0);
});
test('API JSON budget, content type and allowed body fields are strict before storage', async () => {
  const h = fixture();
  for (const value of [null, [], {}, input({query: 'private'}), input({createdAt: 'client clock'}), input({text: '界'.repeat(3000)})]) assert.equal((await h.run('/api/search-feedback', 'guest', value)).status, 400);
  const missing = input(); delete missing.resultCount;
  assert.equal((await h.run('/api/search-feedback', 'guest', missing)).status, 400);
  assert.equal((await h.run('/api/search-feedback', 'guest', input(), 'POST', {'Content-Type': 'text/plain'})).status, 400);
  const malformed = new Request('https://planview.test/api/search-feedback', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{bad-json'});
  assert.equal((await h.api(malformed, 'guest')).status, 400);
  assert.equal(h.calls.length, 0);
});
test('exact Unicode text limit fits API byte budget and caller identity is never a body field', async () => {
  const h = fixture(), value = input({text: '界'.repeat(1500)});
  assert.equal((await h.run('/api/search-feedback', 'guest', value)).status, 201);
  assert.deepEqual(h.calls, [['submit', 'guest', value]]);
});
test('expected conflict/rate errors are precise and private infrastructure errors are hidden', async () => {
  for (const [code, status, extra] of [['search_already_rated', 409, {}], ['search_feedback_rate_limit', 429, {retryAfterSeconds: 900}]]) {
    const h = fixture({store: {submit: async () => { throw new SearchFeedbackError(code, status, extra); }}});
    const response = await h.run('/api/search-feedback', 'guest', input());
    assert.equal(response.status, status); assert.deepEqual(await response.json(), {error: code, ...extra});
  }
  const failure = fixture({store: {list: async () => { throw Error('private project, collection, credential detail'); }}});
  const response = await failure.run('/api/admin/search-feedback', 'owner');
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), {error: 'search_feedback_unavailable'});
});
