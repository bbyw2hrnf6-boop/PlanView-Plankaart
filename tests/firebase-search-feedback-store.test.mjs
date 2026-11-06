import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSearchFeedbackStore} from '../firebase/functions/search-feedback-store.mjs';

function database() {
  const rows = new Map(), queries = [];
  let pending = Promise.resolve(), failure;
  const snapshot = path => ({id: path.split('/').at(-1), exists: rows.has(path), data: () => structuredClone(rows.get(path))});
  const reference = path => ({id: path.split('/').at(-1), path});
  function query(collection, ordering = [], after, cap) {
    return {
      doc: id => reference(`${collection}/${id}`),
      orderBy: (field, direction) => query(collection, [...ordering, [field, direction]], after, cap),
      startAfter: (...cursor) => query(collection, ordering, cursor, cap),
      limit: value => query(collection, ordering, after, value),
      async get() {
        if (failure) throw failure;
        queries.push({collection, ordering, after, cap});
        assert.deepEqual(ordering, [['createdAt', 'desc'], ['__name__', 'desc']], 'use the existing timestamp index; descending document-name-only queries require an index in production');
        assert.equal(cap, 51, 'listing is bounded to one page plus one continuation item');
        let result = [...rows.keys()].filter(path => path.startsWith(`${collection}/`)).sort().reverse();
        if (after) {
          assert.equal(after.length, 2, 'cursor includes timestamp and unique document name');
          assert.equal(after[0], after[1].slice(0, 24));
          result = result.filter(path => path.split('/').at(-1) < after[1]);
        }
        return {docs: result.slice(0, cap).map(snapshot)};
      },
    };
  }
  return {
    rows, queries,
    fail(error) { failure = error; },
    collection: name => query(name),
    runTransaction(fn) {
      const result = pending.then(async () => {
        if (failure) throw failure;
        let writing = false;
        const staged = new Map();
        const value = await fn({
          async get(ref) { assert.equal(writing, false, 'all reads must precede writes'); return snapshot(ref.path); },
          set(ref, data) { writing = true; staged.set(ref.path, structuredClone(data)); },
        });
        for (const [key, data] of staged) rows.set(key, data);
        return value;
      });
      pending = result.catch(() => {});
      return result;
    },
  };
}
const NOW = Date.parse('2026-11-01T13:00:00.000Z');
const input = overrides => ({searchId: randomUUID(), submissionId: randomUUID(), kind: 'rules', rating: 'down', text: 'It missed the relevant rule.', outcome: 'partial', resultCount: 2, ...overrides});
const count = (db, name) => [...db.rows.keys()].filter(path => path.startsWith(`${name}/`)).length;

test('search feedback stores only allowlisted context and submitted text with server identity/time', async () => {
  const db = database(), store = createSearchFeedbackStore(db, {now: () => NOW});
  const value = input({text: ' \r\nNeeds a clearer answer\r\nplease \n '});
  const saved = await store.submit('private-test-uid', value);
  assert.equal(saved.duplicate, false);
  assert.deepEqual(await store.list(), {items: [{id: saved.receipt.id, searchId: value.searchId, kind: 'rules', rating: 'down', text: 'Needs a clearer answer\nplease', outcome: 'partial', resultCount: 2, createdAt: new Date(NOW).toISOString(), user: 'TestUser02'}], nextCursor: null});
  const persisted = JSON.stringify([...db.rows]);
  for (const forbidden of ['private-test-uid', value.submissionId, 'latitude', 'longitude', 'prompt', 'headers']) assert.equal(persisted.includes(forbidden), false);
  assert.equal(count(db, 'planview_search_feedback'), 1);
  assert.equal(count(db, 'planview_search_feedback_submissions'), 1);
  assert.equal(count(db, 'planview_search_feedback_searches'), 1);
  assert.equal(count(db, 'planview_search_feedback_limits'), 1);
});

test('exact concurrent retries are atomic, idempotent and consume one flood-limit slot', async () => {
  const db = database(), store = createSearchFeedbackStore(db, {now: () => NOW}), value = input();
  const results = await Promise.all(Array.from({length: 12}, () => store.submit('guest', value)));
  assert.equal(results.filter(row => !row.duplicate).length, 1);
  assert.equal(new Set(results.map(row => row.receipt.id)).size, 1);
  assert.deepEqual(await store.submit('guest', {...value, submissionId: value.submissionId.toUpperCase()}), {...results[0], duplicate: true});
  assert.equal([...db.rows.values()].find(row => row.timestamps).timestamps.length, 1);
});

test('altered retry is rejected and one search can receive only one final rating', async () => {
  const db = database(), store = createSearchFeedbackStore(db, {now: () => NOW}), value = input();
  await store.submit('guest', value);
  for (const change of [{text: value.text + ' '}, {rating: 'up', text: ''}, {searchId: randomUUID()}, {kind: 'permits'}, {outcome: 'error'}, {resultCount: null}]) {
    await assert.rejects(store.submit('guest', {...value, ...change}), error => error.code === 'invalid_search_feedback');
  }
  await assert.rejects(store.submit('guest', {...value, submissionId: randomUUID()}), error => error.code === 'search_already_rated' && error.status === 409);
  assert.equal(count(db, 'planview_search_feedback'), 1);
  assert.equal((await store.list()).items[0].text, value.text);
});

test('concurrent different submissions cannot create two ratings for one search', async () => {
  const db = database(), store = createSearchFeedbackStore(db, {now: () => NOW}), value = input();
  const results = await Promise.allSettled(Array.from({length: 12}, () => store.submit('guest', {...value, submissionId: randomUUID()})));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.ok(results.filter(row => row.status === 'rejected').every(row => row.reason.code === 'search_already_rated'));
  assert.equal(count(db, 'planview_search_feedback'), 1);
});

test('idempotency and final-search keys are scoped to verified UID', async () => {
  const db = database(), store = createSearchFeedbackStore(db, {now: () => NOW}), value = input({rating: 'up', text: '', resultCount: null});
  const first = await store.submit('one', value), second = await store.submit('two', value);
  assert.notEqual(first.receipt.id, second.receipt.id);
  assert.equal(count(db, 'planview_search_feedback'), 2);
});

test('sixty unique concurrent ratings per rolling hour; exact retries work at limit and capacity returns', async () => {
  const db = database(); let clock = NOW;
  const store = createSearchFeedbackStore(db, {now: () => clock}), first = input();
  const saved = await store.submit('guest', first);
  const results = await Promise.allSettled(Array.from({length: 75}, () => store.submit('guest', input())));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 59);
  assert.ok(results.filter(row => row.status === 'rejected').every(row => row.reason.code === 'search_feedback_rate_limit' && row.reason.status === 429 && row.reason.extra.retryAfterSeconds === 3600));
  assert.equal(count(db, 'planview_search_feedback'), 60);
  assert.equal(count(db, 'planview_search_feedback_submissions'), 60);
  clock += 3_599_000;
  assert.deepEqual(await store.submit('guest', first), {...saved, duplicate: true});
  await assert.rejects(store.submit('guest', input()), error => error.extra.retryAfterSeconds === 1);
  clock += 1000;
  assert.equal((await store.submit('guest', input())).duplicate, false);
  assert.equal([...db.rows.values()].find(row => row.timestamps).timestamps.length, 1);
});

test('timestamp plus document-name pagination is stable for simultaneous records and new arrivals', async () => {
  const db = database(); let clock = NOW;
  const store = createSearchFeedbackStore(db, {now: () => clock});
  for (let index = 0; index < 55; index++) await store.submit('guest', input());
  const first = await store.list();
  assert.equal(first.items.length, 50);
  clock++;
  const newer = await store.submit('guest', input());
  const second = await store.list({cursor: first.nextCursor});
  assert.equal(second.items.length, 5);
  assert.equal(second.nextCursor, null);
  const ids = [...first.items, ...second.items].map(row => row.id);
  assert.equal(new Set(ids).size, 55);
  assert.equal(ids.includes(newer.receipt.id), false);
  assert.deepEqual(ids, [...ids].sort().reverse());
  assert.deepEqual(db.queries[1].after, [new Date(NOW).toISOString(), first.nextCursor]);
});

test('all supported search kinds/outcomes and optional negative explanations remain distinct', async () => {
  const db = database(), store = createSearchFeedbackStore(db, {now: () => NOW});
  for (const kind of ['sites', 'rules', 'permits']) for (const outcome of ['complete', 'partial', 'empty', 'error']) {
    await store.submit('guest', input({kind, outcome, text: '', resultCount: outcome === 'error' ? null : 0}));
  }
  assert.equal((await store.list()).items.length, 12);
});

test('validation rejects unexpected context, invalid identifiers, text, outcomes and result counts before writing', async () => {
  const db = database(), store = createSearchFeedbackStore(db, {now: () => NOW});
  for (const value of [null, [], {}, input({text: 42}), input({text: 'x'.repeat(1501)}), input({text: 'bad\0text'}), input({text: '\x1bworld'}), input({rating: 'up', text: ' ' }), input({rating: 'other'}), input({kind: 'map'}), input({outcome: 'cancelled'}), input({resultCount: -1}), input({resultCount: 1.2}), input({resultCount: '2'}), input({resultCount: Number.MAX_SAFE_INTEGER + 1}), input({searchId: '../bad'}), input({submissionId: randomUUID().replace('-4', '-3')}), input({uid: 'owner'}), input({query: 'private question'}), input({address: 'private address'}), input({createdAt: 'yesterday'})]) {
    await assert.rejects(store.submit('guest', value), error => error.code === 'invalid_search_feedback');
  }
  const missing = input(); delete missing.text;
  await assert.rejects(store.submit('guest', missing), error => error.code === 'invalid_search_feedback');
  for (const uid of ['', null, undefined, 'x'.repeat(129)]) await assert.rejects(store.submit(uid, input()), error => error.code === 'invalid_search_feedback');
  for (const cursor of ['', '../', '2026-11-99T13:00:00.000Z_' + randomUUID(), '2026-11-01T13:00:00.000Z_not-a-uuid']) await assert.rejects(store.list({cursor}), error => error.code === 'invalid_search_feedback');
  await assert.rejects(store.list({rating: 'up'}), error => error.code === 'invalid_search_feedback');
  assert.equal(db.rows.size, 0);
});

test('exact Unicode text limit and HTML are stored as inert text and extra persisted fields never leave list', async () => {
  const db = database(), store = createSearchFeedbackStore(db, {now: () => NOW});
  const prefix = '<script>alert(1)</script>\n', text = prefix + '界'.repeat(1500 - prefix.length);
  const {receipt} = await store.submit('guest', input({text}));
  const path = 'planview_search_feedback/' + receipt.id;
  db.rows.set(path, {...db.rows.get(path), prompt: 'private', uid: 'private-uid'});
  const item = (await store.list()).items[0];
  assert.equal(item.text, text);
  assert.equal(Object.hasOwn(item, 'prompt'), false);
  assert.equal(Object.hasOwn(item, 'uid'), false);
});

test('record-ID collisions cannot overwrite earlier ratings and infrastructure errors propagate', async () => {
  const db = database(), fixedId = randomUUID(), store = createSearchFeedbackStore(db, {now: () => NOW, id: () => fixedId});
  await store.submit('guest', input({text: 'First'}));
  await assert.rejects(store.submit('guest', input({text: 'Second'})), error => error.code === 'search_feedback_unavailable' && error.status === 503);
  assert.equal((await store.list()).items[0].text, 'First');
  const failure = Error('private database detail'); db.fail(failure);
  await assert.rejects(store.submit('guest', input()), error => error === failure);
  await assert.rejects(store.list(), error => error === failure);
});
