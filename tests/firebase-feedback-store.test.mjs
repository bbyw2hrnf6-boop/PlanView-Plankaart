import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createFeedbackStore} from '../firebase/functions/feedback-store.mjs';

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
const input = overrides => ({text: 'The map worked well.', submissionId: randomUUID(), ...overrides});
const count = (db, name) => [...db.rows.keys()].filter(path => path.startsWith(`${name}/`)).length;

test('feedback stores only submitted text, optional category and server identity/time', async () => {
  const db = database(), store = createFeedbackStore(db, {now: () => NOW});
  const value = input({text: ' \r\nVery good\r\nmap\t! \n '});
  const submitted = await store.submit('private-test-uid', value);
  assert.equal(submitted.duplicate, false);
  assert.equal(submitted.receipt.createdAt, '2026-11-01T13:00:00.000Z');
  const result = await store.list();
  assert.deepEqual(result, {items: [{id: submitted.receipt.id, text: 'Very good\nmap\t!', category: 'uncategorized', createdAt: submitted.receipt.createdAt, user: 'TestUser02'}], nextCursor: null});
  const persisted = JSON.stringify([...db.rows]);
  for (const forbidden of ['private-test-uid', value.submissionId, 'latitude', 'longitude', 'prompt', 'headers']) assert.equal(persisted.includes(forbidden), false);
  assert.equal(count(db, 'planview_test_feedback'), 1);
  assert.equal(count(db, 'planview_feedback_submissions'), 1);
  assert.equal(count(db, 'planview_feedback_limits'), 1);
});

test('feedback retry is atomic and idempotent, even with concurrent requests and later categorization', async () => {
  const db = database(), store = createFeedbackStore(db, {now: () => NOW}), value = input({category: 'map'});
  const results = await Promise.all(Array.from({length: 12}, () => store.submit('guest', value)));
  assert.equal(results.filter(result => !result.duplicate).length, 1);
  assert.equal(new Set(results.map(result => result.receipt.id)).size, 1);
  await store.categorize({id: results[0].receipt.id, category: 'interface'});
  const retry = await store.submit('guest', {...value, submissionId: value.submissionId.toUpperCase()});
  assert.deepEqual(retry, {...results[0], duplicate: true});
  await assert.rejects(store.submit('guest', {...value, text: 'Changed content must receive a new submission ID.'}), error => error.code === 'invalid_feedback');
  await assert.rejects(store.submit('guest', {...value, category: 'rules'}), error => error.code === 'invalid_feedback');
  assert.equal((await store.list()).items[0].text, value.text);
  assert.equal((await store.list()).items[0].category, 'interface');
  assert.equal([...db.rows.entries()].find(([path]) => path.startsWith('planview_feedback_limits/'))[1].timestamps.length, 1);
});

test('idempotency keys belong to the verified UID rather than another account', async () => {
  const db = database(), store = createFeedbackStore(db, {now: () => NOW}), value = input();
  const first = await store.submit('one', value), second = await store.submit('two', value);
  assert.notEqual(first.receipt.id, second.receipt.id);
  assert.equal(count(db, 'planview_test_feedback'), 2);
});

test('feedback rolling-hour flood limit accepts only twenty unique concurrent submissions', async () => {
  const db = database(), store = createFeedbackStore(db, {now: () => NOW});
  const results = await Promise.allSettled(Array.from({length: 45}, () => store.submit('guest', input())));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 20);
  assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.code === 'feedback_rate_limit' && result.reason.status === 429 && result.reason.extra.retryAfterSeconds === 3600));
  assert.equal(count(db, 'planview_test_feedback'), 20);
  assert.equal(count(db, 'planview_feedback_submissions'), 20);
  const ledger = [...db.rows.values()].find(row => row.timestamps);
  assert.equal(ledger.timestamps.length, 20);
});

test('feedback retries stay available at the flood limit and capacity returns after a rolling hour', async () => {
  const db = database(); let clock = NOW;
  const store = createFeedbackStore(db, {now: () => clock}), first = input();
  const receipt = await store.submit('guest', first);
  await Promise.all(Array.from({length: 19}, () => store.submit('guest', input())));
  clock += 3_599_000;
  await assert.rejects(store.submit('guest', input()), error => error.code === 'feedback_rate_limit' && error.extra.retryAfterSeconds === 1);
  assert.deepEqual(await store.submit('guest', first), {...receipt, duplicate: true});
  clock += 1000;
  assert.equal((await store.submit('guest', input())).duplicate, false);
  assert.equal([...db.rows.values()].find(row => row.timestamps).timestamps.length, 1);
});

test('feedback pages remain stable for simultaneous records and do not need a composite index', async () => {
  const db = database(); let clock = NOW;
  const store = createFeedbackStore(db, {now: () => clock});
  for (let index = 0; index < 65; index++) {
    if (index % 20 === 0) clock += 3_600_000;
    await store.submit('guest', input({text: `Feedback ${index}`}));
  }
  const first = await store.list();
  assert.equal(first.items.length, 50);
  assert.equal(first.nextCursor, first.items.at(-1).id);
  clock += 3_600_000;
  const newer = await store.submit('guest', input({text: 'Arrived after the first page'}));
  const second = await store.list({cursor: first.nextCursor});
  assert.equal(second.items.length, 15);
  assert.equal(second.nextCursor, null);
  const ids = [...first.items, ...second.items].map(row => row.id);
  assert.equal(new Set(ids).size, 65);
  assert.equal(ids.includes(newer.receipt.id), false);
  assert.deepEqual(ids, [...ids].sort().reverse());
});

test('production timestamp-index listing paginates records sharing the exact same creation time', async () => {
  const db = database(), store = createFeedbackStore(db, {now: () => NOW});
  for (let index = 0; index < 55; index++) await store.submit(`fixture-user-${index}`, input());
  const first = await store.list(), second = await store.list({cursor: first.nextCursor});
  assert.equal(first.items.length, 50);
  assert.equal(second.items.length, 5);
  assert.equal(second.nextCursor, null);
  const items = [...first.items, ...second.items];
  assert.equal(new Set(items.map(item => item.id)).size, 55, 'equal timestamps must not skip or repeat feedback');
  assert.ok(items.every(item => item.createdAt === new Date(NOW).toISOString()));
  assert.deepEqual(db.queries[1].after, [new Date(NOW).toISOString(), first.nextCursor]);
});

test('admin categorization changes only category and preserves the feedback text and date', async () => {
  const db = database(), store = createFeedbackStore(db, {now: () => NOW});
  const {receipt} = await store.submit('guest', input({text: 'Keep my original words.', category: 'idea'}));
  const before = (await store.list()).items[0];
  assert.deepEqual(await store.categorize({id: receipt.id, category: 'rules'}), {item: {...before, category: 'rules'}});
  assert.deepEqual((await store.list()).items[0], {...before, category: 'rules'});
  await assert.rejects(store.categorize({id: `${receipt.id.slice(0, 25)}${randomUUID()}`, category: 'map'}), error => error.code === 'feedback_not_found' && error.status === 404);
});

test('feedback rejects invalid fields, text, categories, IDs and cursors before writing', async () => {
  const db = database(), store = createFeedbackStore(db, {now: () => NOW});
  for (const value of [null, [], {}, input({text: ''}), input({text: '   '}), input({text: 42}), input({text: 'x'.repeat(3001)}), input({text: 'hello\0secret'}), input({text: 'hello\x1bworld'}), input({category: 'unknown'}), input({category: null}), input({submissionId: '../bad-id'}), input({submissionId: randomUUID().replace('-4', '-3')}), input({uid: 'owner'}), input({createdAt: 'yesterday'})]) {
    await assert.rejects(store.submit('guest', value), error => error.code === 'invalid_feedback');
  }
  for (const value of ['', null, undefined, 'x'.repeat(129)]) await assert.rejects(store.submit(value, input()), error => error.code === 'invalid_feedback');
  for (const cursor of ['', '../', '2026-11-99T13:00:00.000Z_' + randomUUID(), '2026-11-01T13:00:00.000Z_not-a-uuid']) await assert.rejects(store.list({cursor}), error => error.code === 'invalid_feedback');
  await assert.rejects(store.list({user: 'owner'}), error => error.code === 'invalid_feedback');
  await assert.rejects(store.categorize({id: 'bad', category: 'map'}), error => error.code === 'invalid_feedback');
  assert.equal(db.rows.size, 0);
});

test('feedback accepts the exact text limit including safe Unicode and does not execute HTML', async () => {
  const db = database(), store = createFeedbackStore(db, {now: () => NOW});
  const prefix = '<script>alert(1)</script>\n';
  const text = prefix + '界'.repeat(3000 - prefix.length);
  assert.equal(text.length, 3000);
  await store.submit('guest', input({text}));
  assert.equal((await store.list()).items[0].text, text);
});

test('feedback database failures propagate and a record-ID collision cannot overwrite feedback', async () => {
  const db = database(), fixedId = randomUUID(), store = createFeedbackStore(db, {now: () => NOW, id: () => fixedId});
  await store.submit('guest', input({text: 'First'}));
  await assert.rejects(store.submit('guest', input({text: 'Second'})), error => error.code === 'feedback_unavailable' && error.status === 503);
  assert.equal((await store.list()).items[0].text, 'First');
  const failure = Error('private database detail');
  db.fail(failure);
  await assert.rejects(store.submit('guest', input()), error => error === failure);
  await assert.rejects(store.list(), error => error === failure);
});
