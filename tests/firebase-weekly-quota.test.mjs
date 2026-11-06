import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createWeeklyQuotaStore} from '../firebase/functions/weekly-quota.mjs';

function database() {
  const rows = new Map();
  let pending = Promise.resolve(), failure;
  const snapshot = path => ({exists: rows.has(path), data: () => structuredClone(rows.get(path))});
  const reference = path => ({path, async get() { if (failure) throw failure; return snapshot(path); }});
  return {
    rows,
    fail(error) { failure = error; },
    collection: name => ({doc: id => reference(`${name}/${id}`)}),
    runTransaction(fn) {
      const result = pending.then(async () => {
        if (failure) throw failure;
        const staged = new Map();
        let writing = false;
        const value = await fn({
          async get(ref) { assert.equal(writing, false, 'all reads precede writes'); return snapshot(ref.path); },
          set(ref, data) { writing = true; staged.set(ref.path, structuredClone(data)); },
        });
        for (const [path, data] of staged) rows.set(path, data);
        return value;
      });
      pending = result.catch(() => {});
      return result;
    },
  };
}

const NOW = Date.parse('2026-11-01T12:40:00.000Z');
const USER = '5hCsyPxNqwcGJa3sqRnfyAuqFQ82';

test('weekly quota begins at zero without creating an allowance document', async () => {
  const db = database(), store = createWeeklyQuotaStore(db, {now: () => NOW});
  assert.deepEqual(await store.status(USER), {
    limit: 150, used: 0, remaining: 150, timezone: 'Europe/Amsterdam',
    periodStart: '2026-10-25T23:00:00.000Z', resetsAt: '2026-11-01T23:00:00.000Z',
  });
  assert.equal(db.rows.size, 0);
});

test('concurrent reservations never accept more than 150 searches', async () => {
  const db = database(), store = createWeeklyQuotaStore(db, {now: () => NOW});
  const results = await Promise.all(Array.from({length: 180}, () => store.reserve(USER, randomUUID())));
  assert.equal(results.filter(value => value.allowed).length, 150);
  assert.equal(results.filter(value => !value.allowed).length, 30);
  assert.equal((await store.status(USER)).remaining, 0);
  assert.equal(db.rows.size, 151, 'rejected requests do not add reservation records');
  for (const value of results.filter(value => !value.allowed)) {
    assert.equal(value.quota.used, 150);
    assert.equal('reservation' in value, false);
  }
});

test('the final place is atomic and duplicate request ids consume only one place', async () => {
  const db = database(), store = createWeeklyQuotaStore(db, {now: () => NOW});
  await Promise.all(Array.from({length: 149}, () => store.reserve(USER, randomUUID())));
  const id = randomUUID();
  const [first, duplicate, rejected] = await Promise.all([
    store.reserve(USER, id), store.reserve(USER, id.toUpperCase()), store.reserve(USER, randomUUID()),
  ]);
  assert.equal(first.allowed, true);
  assert.deepEqual(duplicate, first);
  assert.equal(rejected.allowed, false);
  assert.equal((await store.status(USER)).used, 150);
});

test('refund frees exactly its reservation, is idempotent, and cannot resurrect a request id', async () => {
  const db = database(), store = createWeeklyQuotaStore(db, {now: () => NOW});
  const first = await store.reserve(USER, randomUUID());
  const second = await store.reserve(USER, randomUUID());
  const refunds = await Promise.all([
    store.refund(USER, first.reservation), store.refund(USER, first.reservation),
  ]);
  assert.deepEqual(refunds, [{refunded: true}, {refunded: false}]);
  assert.equal((await store.status(USER)).used, 1);
  assert.equal((await store.reserve(USER, first.reservation.requestId)).allowed, false);
  assert.equal((await store.status(USER)).used, 1);
  assert.deepEqual(await store.refund('different_user', second.reservation), {refunded: false});
  assert.equal((await store.status(USER)).used, 1);
  assert.deepEqual(await store.refund(USER, {...first.reservation, requestId: randomUUID()}), {refunded: false});
  await store.refund(USER, second.reservation);
  assert.equal((await store.status(USER)).used, 0);
});

test('an unrefunded crash reservation stays consumed and users have independent allowances', async () => {
  const db = database();
  await createWeeklyQuotaStore(db, {now: () => NOW}).reserve(USER, randomUUID());
  const restarted = createWeeklyQuotaStore(db, {now: () => NOW + 3_600_000});
  assert.equal((await restarted.status(USER)).used, 1);
  assert.equal((await restarted.status('another_user')).used, 0);
  await restarted.reserve('another_user', randomUUID());
  assert.equal((await restarted.status(USER)).used, 1);
});

test('allowance resets at Monday midnight Amsterdam, not UTC or seven days after first use', async () => {
  const db = database();
  let clock = Date.parse('2026-11-01T22:59:59.999Z');
  const store = createWeeklyQuotaStore(db, {now: () => clock});
  const old = await store.reserve(USER, randomUUID());
  assert.equal(old.quota.used, 1);
  clock++;
  assert.deepEqual(await store.status(USER), {
    limit: 150, used: 0, remaining: 150, timezone: 'Europe/Amsterdam',
    periodStart: '2026-11-01T23:00:00.000Z', resetsAt: '2026-11-08T23:00:00.000Z',
  });
  await store.reserve(USER, randomUUID());
  await store.refund(USER, old.reservation);
  assert.equal((await store.status(USER)).used, 1, 'late refunds apply only to the old week');
  clock--;
  assert.equal((await store.status(USER)).used, 0, 'the old reservation was refunded');
});

test('summer-time transition yields a 167-hour calendar week', async () => {
  const db = database();
  const quota = await createWeeklyQuotaStore(db, {now: () => Date.parse('2026-03-29T12:00:00Z')}).status(USER);
  assert.equal(quota.periodStart, '2026-03-22T23:00:00.000Z');
  assert.equal(quota.resetsAt, '2026-03-29T22:00:00.000Z');
  assert.equal((Date.parse(quota.resetsAt) - Date.parse(quota.periodStart)) / 3_600_000, 167);
});

test('winter-time transition yields a 169-hour calendar week', async () => {
  const db = database();
  const quota = await createWeeklyQuotaStore(db, {now: () => Date.parse('2026-10-25T12:00:00Z')}).status(USER);
  assert.equal(quota.periodStart, '2026-10-18T22:00:00.000Z');
  assert.equal(quota.resetsAt, '2026-10-25T23:00:00.000Z');
  assert.equal((Date.parse(quota.resetsAt) - Date.parse(quota.periodStart)) / 3_600_000, 169);
});

test('calendar weeks cross year boundaries without resetting on New Year', async () => {
  const db = database();
  let clock = Date.parse('2026-12-31T12:00:00Z');
  const store = createWeeklyQuotaStore(db, {now: () => clock});
  const first = await store.reserve(USER, randomUUID());
  assert.equal(first.reservation.periodId, '2026-12-28');
  clock = Date.parse('2027-01-01T12:00:00Z');
  const after = await store.status(USER);
  assert.equal(after.used, 1);
  assert.equal(after.periodStart, '2026-12-27T23:00:00.000Z');
  assert.equal(after.resetsAt, '2027-01-03T23:00:00.000Z');
});

test('bounded identities and reservation tokens prevent path injection and malformed writes', async () => {
  const db = database(), store = createWeeklyQuotaStore(db, {now: () => NOW});
  for (const uid of ['', '../someone', 'a/b', 'a'.repeat(129), null, {}]) {
    await assert.rejects(store.status(uid), /invalid_quota_uid/);
    await assert.rejects(store.reserve(uid, randomUUID()), /invalid_quota_uid/);
  }
  for (const id of ['', '../private', 'a'.repeat(1000), null, {}]) await assert.rejects(store.reserve(USER, id), /invalid_quota_request_id/);
  for (const value of [null, {}, {periodId: '2026-11-01', requestId: randomUUID()}, {periodId: '2026-02-30', requestId: randomUUID()}, {periodId: '../private', requestId: randomUUID()}]) await assert.rejects(store.refund(USER, value), /invalid_quota_reservation/);
  assert.equal(db.rows.size, 0);
});

test('ledger stores only counts, calendar boundaries, request ids and states', async () => {
  const db = database(), store = createWeeklyQuotaStore(db, {now: () => NOW});
  await store.reserve(USER, randomUUID());
  const serialized = JSON.stringify([...db.rows]);
  assert.equal(serialized.includes(USER), false);
  for (const [path, row] of db.rows) {
    assert.equal(path.includes('/../'), false);
    const expected = path.startsWith('planview_weekly_quota/')
      ? ['periodStart', 'resetsAt', 'used'] : ['periodId', 'requestId', 'state'];
    assert.deepEqual(Object.keys(row).sort(), expected.sort());
  }
});

test('database failures and corrupt counters propagate rather than granting fresh allowance', async () => {
  const db = database(), store = createWeeklyQuotaStore(db, {now: () => NOW});
  const granted = await store.reserve(USER, randomUUID());
  const weeklyPath = [...db.rows.keys()].find(path => path.startsWith('planview_weekly_quota/'));
  for (const invalid of [-1, 151, 1.5, '1', undefined, NaN, Infinity]) {
    db.rows.get(weeklyPath).used = invalid;
    await assert.rejects(store.status(USER), /invalid_quota_counter/);
    await assert.rejects(store.reserve(USER, randomUUID()), /invalid_quota_counter/);
    await assert.rejects(store.refund(USER, granted.reservation), /invalid_quota_counter/);
  }
  const error = Error('database unavailable');
  db.fail(error);
  await assert.rejects(store.status(USER), value => value === error);
  await assert.rejects(store.reserve(USER, randomUUID()), value => value === error);
  await assert.rejects(store.refund(USER, granted.reservation), value => value === error);
  await assert.rejects(createWeeklyQuotaStore(database(), {now: () => NaN}).status(USER), /invalid_quota_clock/);
});
