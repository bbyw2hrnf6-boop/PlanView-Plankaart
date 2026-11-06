import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createFeedbackApi} from '../firebase/functions/feedback-api.mjs';
import {FeedbackError} from '../firebase/functions/feedback-store.mjs';

const RECORD_ID = '2026-11-01T13:00:00.000Z_5adc938b-019b-48ae-9f85-ac0ce96201e1';
const RECEIPT = {id: RECORD_ID, createdAt: '2026-11-01T13:00:00.000Z'};
const input = overrides => ({text: 'The rule search could be clearer.', submissionId: randomUUID(), ...overrides});
const request = (path, body, method = body === undefined ? 'GET' : 'POST', headers = {}) => new Request(`https://planview.test${path}`, {
  method, ...(body !== undefined ? {body: JSON.stringify(body), headers: {'Content-Type': 'application/json', ...headers}} : {headers}),
});
function fixture(overrides = {}) {
  const calls = [];
  const api = createFeedbackApi({ownerUid: () => 'owner', testUserUid: () => 'guest', store: {
    async submit(uid, value) { calls.push(['submit', uid, value]); return {receipt: RECEIPT, duplicate: false}; },
    async list(value) { calls.push(['list', value]); return {items: [], nextCursor: null}; },
    async categorize(value) { calls.push(['categorize', value]); return {item: {id: value.id, category: value.category}}; },
  }, ...overrides});
  return {calls, api, run: (path, user = 'guest', value, method, headers) => api(request(path, value, method, headers), user)};
}

test('feedback API leaves unrelated paths to the app engine', async () => {
  const h = fixture();
  for (const path of ['/api/status', '/api/admin/monitoring', '/api/feedback/other']) assert.equal(await h.run(path), null);
  assert.equal(h.calls.length, 0);
});

test('only the pinned test UID can submit and body identity cannot grant access', async () => {
  const h = fixture(), value = input();
  for (const user of ['', 'owner', 'another-guest']) {
    const response = await h.run('/api/feedback', user, value);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {error: 'test_user_required'});
  }
  assert.equal(h.calls.length, 0);
  assert.equal((await fixture({testUserUid: () => ''}).run('/api/feedback', 'guest', value)).status, 403);
  assert.equal((await fixture({testUserUid: () => 'owner'}).run('/api/feedback', 'owner', value)).status, 403);
  const spoofed = await h.run('/api/feedback', 'guest', {...value, uid: 'owner'});
  assert.equal(spoofed.status, 400);
  assert.equal(h.calls.length, 0);
});

test('new feedback receives a minimal private receipt and retry receives HTTP200', async () => {
  const h = fixture(), value = input({category: 'search'});
  const response = await h.run('/api/feedback', 'guest', value);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), {ok: true, ...RECEIPT});
  assert.deepEqual(h.calls, [['submit', 'guest', value]]);
  const retry = fixture({store: {submit: async () => ({receipt: RECEIPT, duplicate: true})}});
  assert.equal((await retry.run('/api/feedback', 'guest', value)).status, 200);
});

test('feedback admin list and category edits require the configured owner UID', async () => {
  const h = fixture();
  for (const user of ['', 'guest', 'other']) {
    assert.equal((await h.run('/api/admin/feedback', user)).status, 403);
    assert.equal((await h.run('/api/admin/feedback', user, {id: RECORD_ID, category: 'map'})).status, 403);
  }
  assert.equal(h.calls.length, 0);
  assert.equal((await fixture({ownerUid: () => ''}).run('/api/admin/feedback', 'owner')).status, 403);
  const list = await h.run('/api/admin/feedback', 'owner');
  assert.deepEqual(await list.json(), {items: [], nextCursor: null});
  const page = await h.run('/api/admin/feedback?cursor=' + encodeURIComponent(RECORD_ID), 'owner');
  assert.equal(page.status, 200);
  const edit = await h.run('/api/admin/feedback', 'owner', {id: RECORD_ID, category: 'idea'});
  assert.deepEqual(await edit.json(), {ok: true, item: {id: RECORD_ID, category: 'idea'}});
  assert.deepEqual(h.calls, [['list', {}], ['list', {cursor: RECORD_ID}], ['categorize', {id: RECORD_ID, category: 'idea'}]]);
});

test('feedback rejects unsupported methods and query parameters before touching storage', async () => {
  const h = fixture();
  for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await h.run('/api/feedback', 'guest', undefined, method)).status, 405);
  assert.equal((await h.run('/api/admin/feedback', 'owner', undefined, 'DELETE')).status, 405);
  for (const path of ['/api/feedback?uid=guest', '/api/feedback?']) {
    // URL.search is empty for a bare trailing question mark, which contains no parameter.
    if (path.endsWith('?')) continue;
    assert.equal((await h.run(path, 'guest', input())).status, 400);
  }
  for (const path of ['/api/admin/feedback?uid=owner', '/api/admin/feedback?cursor=bad', '/api/admin/feedback?cursor=', '/api/admin/feedback?cursor=' + encodeURIComponent(RECORD_ID) + '&cursor=' + encodeURIComponent(RECORD_ID)]) assert.equal((await h.run(path, 'owner')).status, 400);
  assert.equal((await h.run('/api/admin/feedback?cursor=' + encodeURIComponent(RECORD_ID), 'owner', {id: RECORD_ID, category: 'idea'})).status, 400);
  assert.equal(h.calls.length, 0);
});

test('feedback body parsing is strict and bounded independently of the gateway', async () => {
  const h = fixture();
  for (const value of [null, [], {}, input({extra: 'context'}), {text: 'hello'}, {submissionId: randomUUID()}, {text: 'hello', submissionId: randomUUID(), createdAt: 'yesterday'}]) assert.equal((await h.run('/api/feedback', 'guest', value)).status, 400);
  const malformed = new Request('https://planview.test/api/feedback', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{not-json'});
  assert.equal((await h.api(malformed, 'guest')).status, 400);
  assert.equal((await h.run('/api/feedback', 'guest', input(), 'POST', {'Content-Type': 'text/plain'})).status, 400);
  assert.equal((await h.run('/api/feedback', 'guest', input({text: '界'.repeat(6000)}))).status, 400);
  for (const value of [{id: RECORD_ID}, {id: RECORD_ID, category: 'wrong'}, {id: '../bad', category: 'map'}, {id: RECORD_ID, category: 'map', text: 'replace original'}]) assert.equal((await h.run('/api/admin/feedback', 'owner', value)).status, 400);
  assert.equal(h.calls.length, 0);
});

test('feedback accepts Unicode within its body budget and sends no caller identity to storage', async () => {
  const h = fixture(), value = input({text: '界'.repeat(3000)});
  assert.equal((await h.run('/api/feedback', 'guest', value)).status, 201);
  assert.deepEqual(h.calls, [['submit', 'guest', value]]);
});

test('feedback maps expected rate and missing-record errors and hides infrastructure details', async () => {
  const rate = fixture({store: {submit: async () => { throw new FeedbackError('feedback_rate_limit', 429, {retryAfterSeconds: 900}); }}});
  const limited = await rate.run('/api/feedback', 'guest', input());
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), {error: 'feedback_rate_limit', retryAfterSeconds: 900});
  const missing = fixture({store: {categorize: async () => { throw new FeedbackError('feedback_not_found', 404); }}});
  const absent = await missing.run('/api/admin/feedback', 'owner', {id: RECORD_ID, category: 'map'});
  assert.equal(absent.status, 404);
  assert.deepEqual(await absent.json(), {error: 'feedback_not_found'});
  const unavailable = fixture({store: {list: async () => { throw Error('private collection path and credential detail'); }}});
  const failure = await unavailable.run('/api/admin/feedback', 'owner');
  assert.equal(failure.status, 503);
  assert.deepEqual(await failure.json(), {error: 'feedback_unavailable'});
});
