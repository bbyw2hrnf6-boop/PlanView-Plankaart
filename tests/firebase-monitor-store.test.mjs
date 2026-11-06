import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createMonitorStore} from '../firebase/functions/monitor-store.mjs';

function database() {
  const rows = new Map();
  const queries = [];
  let pending = Promise.resolve();
  let failure;
  const snapshot = id => ({id: id.split('/').at(-1), exists: rows.has(id), data: () => structuredClone(rows.get(id))});
  const reference = id => ({id, async get() { if (failure) throw failure; return snapshot(id); }});
  function query(collection, filters = [], ordering = null, cap = null) {
    return {
      doc: id => reference(`${collection}/${id}`),
      where: (field, operator, value) => query(collection, [...filters, [field, operator, value]], ordering, cap),
      orderBy: (field, direction) => query(collection, filters, [field, direction], cap),
      limit: value => query(collection, filters, ordering, value),
      async get() {
        if (failure) throw failure;
        queries.push({collection, filters, ordering, cap});
        assert.equal(new Set([...filters.map(row => row[0]), ordering?.[0]].filter(Boolean)).size, 1, 'queries need only one single-field index');
        assert.equal(cap, 101, 'recent queries always have a bounded result');
        let result = [...rows.entries()].filter(([id]) => id.startsWith(`${collection}/`));
        for (const [field, operator, value] of filters) result = result.filter(([, row]) => operator === '>=' ? row[field] >= value : row[field] <= value);
        if (ordering) result.sort(([, left], [, right]) => left[ordering[0]].localeCompare(right[ordering[0]]) * (ordering[1] === 'desc' ? -1 : 1));
        return {docs: result.slice(0, cap).map(([id]) => snapshot(id))};
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
        const staged = new Map();
        let writing = false;
        const value = await fn({
          async get(ref) { assert.equal(writing, false, 'transaction reads precede writes'); return snapshot(ref.id); },
          set(ref, data) { writing = true; staged.set(ref.id, structuredClone(data)); },
        });
        for (const [id, data] of staged) rows.set(id, data);
        return value;
      });
      pending = result.catch(() => {});
      return result;
    },
  };
}

const NOW = Date.parse('2026-11-01T12:40:00.000Z');
function event(overrides = {}) {
  return {
    id: randomUUID(), startedAt: new Date(NOW - 1000).toISOString(),
    user: 'TestUser02', endpoint: '/api/interpret', status: 200, durationMs: 1200,
    metrics: {prompts: 1, providerCalls: 2, inputTokens: 1200, cachedInputTokens: 300,
      outputTokens: 100, reasoningTokens: 25, estimatedCostUsd: 0.0123,
      providers: {openai: 1, dso: 1}},
    ...overrides,
  };
}

test('monitor starts empty and does not fabricate pre-monitoring history', async () => {
  const db = database();
  const result = await createMonitorStore(db, {now: () => NOW}).read();
  assert.equal(result.window.trackingStartedAt, null);
  assert.equal(result.summary.requests, 0);
  assert.deepEqual(result.daily, []);
  assert.deepEqual(result.recent, []);
  assert.equal(result.recentTruncated, false);
  assert.equal(db.queries.length, 1);
});

test('monitor atomically deduplicates events and aggregates concurrent requests per day and safe user', async () => {
  const db = database(), store = createMonitorStore(db, {now: () => NOW});
  const first = event();
  const deduped = await Promise.all([store.record(first), store.record(first)]);
  assert.deepEqual(deduped, [{recorded: true}, {recorded: false}]);
  const second = event({status: 502, user: 'Admin'});
  await Promise.all([store.record(second), ...Array.from({length: 19}, () => store.record(event()))]);
  const result = await store.read();
  assert.equal(result.summary.requests, 21);
  assert.equal(result.summary.errors, 1);
  assert.equal(result.summary.prompts, 21);
  assert.equal(result.summary.providerCalls, 42);
  assert.equal(result.summary.inputTokens, 25_200);
  assert.equal(result.summary.durationMs, 25_200);
  assert.ok(Math.abs(result.summary.estimatedCostUsd - 0.2583) < 1e-10);
  assert.deepEqual(result.daily.map(row => [row.user, row.requests]), [['Admin', 1], ['TestUser02', 20]]);
  assert.equal(result.window.trackingStartedAt, first.startedAt);
  assert.equal([...db.rows.keys()].filter(id => id.startsWith('planview_monitor_events/')).length, 21);
  assert.equal(db.rows.get('planview_monitor_daily/2026-11-01_1').providers.openai, 20);
});

test('monitor recent log truncation never truncates aggregate totals', async () => {
  const db = database(), store = createMonitorStore(db, {now: () => NOW});
  await Promise.all(Array.from({length: 125}, (_, index) => store.record(event({
    startedAt: new Date(NOW - (index + 1) * 1000).toISOString(),
  }))));
  const result = await store.read();
  assert.equal(result.summary.requests, 125);
  assert.equal(result.summary.prompts, 125);
  assert.equal(result.recent.length, 100);
  assert.equal(result.recentLimit, 100);
  assert.equal(result.recentTruncated, true);
  assert.equal(result.recent[0].startedAt, new Date(NOW - 1000).toISOString());
  assert.equal(result.recent.at(-1).startedAt, new Date(NOW - 100_000).toISOString());
});

test('monitor counts exactly fourteen UTC calendar days including both window boundaries', async () => {
  const db = database();
  let clock = Date.parse('2026-10-18T23:59:59.999Z');
  const store = createMonitorStore(db, {now: () => clock});
  await store.record(event({startedAt: new Date(clock).toISOString()}));
  clock = Date.parse('2026-10-19T00:00:00.000Z');
  await store.record(event({startedAt: new Date(clock).toISOString(), user: 'Admin'}));
  clock = NOW;
  await store.record(event({startedAt: new Date(clock).toISOString(), user: 'Approved user'}));
  const result = await store.read();
  assert.deepEqual(result.window, {days: 14, from: '2026-10-19T00:00:00.000Z', to: '2026-11-01T12:40:00.000Z', timeZone: 'UTC', trackingStartedAt: '2026-10-18T23:59:59.999Z'});
  assert.equal(result.summary.requests, 2);
  assert.deepEqual(result.daily.map(row => row.day), ['2026-10-19', '2026-11-01']);
  assert.equal(result.recent.length, 2);
});

test('monitor whitelists stored and returned fields and bounds untrusted numeric values', async () => {
  const db = database(), store = createMonitorStore(db, {now: () => NOW});
  await store.record(event({
    user: 'private-uid-123', endpoint: '/api/rules/search?key=private-secret',
    key: 'private-secret', prompt: 'private question', output: 'private answer',
    headers: {Authorization: 'private-secret'}, coordinates: [4, 52], error: 'private error',
    status: 999, durationMs: Infinity,
    metrics: {requests: 1234, errors: 0, prompts: -1, inputTokens: 2e20,
      outputTokens: NaN, cachedInputTokens: '400', providerCalls: 3.8,
      estimatedCostUsd: Infinity, secret: 'private-secret',
      providers: {dso: 2, openai: -1, secret: 'private-secret'}},
  }));
  await store.record(event({endpoint: '/api/secret-user-id', startedAt: 'not a timestamp', durationMs: 2e20}));
  const result = await store.read();
  const stored = JSON.stringify([...db.rows.values()]);
  for (const forbidden of ['private-uid', 'private-secret', 'private question', 'private answer', 'private error', 'Authorization', 'coordinates']) assert.equal(stored.includes(forbidden), false);
  assert.equal(result.recent.find(row => row.endpoint === '/api/rules/search').user, 'Approved user');
  assert.equal(result.recent.find(row => row.endpoint === '/api/rules/search').status, 500);
  assert.equal(result.summary.errors, 1);
  assert.equal(result.summary.requests, 2);
  assert.equal(result.summary.inputTokens, 1_000_000_001_200);
  assert.equal(result.summary.cachedInputTokens, 300);
  assert.equal(result.summary.providerCalls, 5);
  assert.equal(result.summary.durationMs, 86_400_000);
  assert.equal(result.recent[0].endpoint, '/api/unknown');
  assert.equal(result.recent[0].startedAt, new Date(NOW).toISOString());
  assert.equal('providers' in result.recent[0], false);
  assert.equal('metrics' in result.recent[0], false);
  assert.equal('key' in result.recent[0], false);
  await assert.rejects(store.record(event({id: '../private-user'})), /invalid_monitor_event_id/);
});

test('monitor propagates transaction and read failures instead of reporting false zero totals', async () => {
  const db = database(), store = createMonitorStore(db, {now: () => NOW});
  const failure = Error('firestore unavailable');
  db.fail(failure);
  await assert.rejects(store.record(event()), error => error === failure);
  await assert.rejects(store.read(), error => error === failure);
  assert.equal(db.rows.size, 0);
});
