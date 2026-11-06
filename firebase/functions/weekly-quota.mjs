import {createHash} from 'node:crypto';

const LIMIT = 150;
const TIMEZONE = 'Europe/Amsterdam';
const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UID = /^[A-Za-z0-9_-]{1,128}$/;
const PERIOD = /^\d{4}-\d{2}-\d{2}$/;
const localDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function parts(timestamp) {
  return Object.fromEntries(localDate.formatToParts(timestamp)
    .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}
function calendarTimestamp(value) {
  return Date.parse(`${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}T00:00:00.000Z`);
}
function midnight(calendarDay) {
  // Convert each local Monday separately: a DST week can contain 167 or 169 hours.
  let instant = calendarDay;
  for (let attempt = 0; attempt < 3; attempt++) {
    const local = parts(instant);
    const represented = calendarTimestamp(local) + local.hour * 3_600_000 + local.minute * 60_000 + local.second * 1000;
    instant += calendarDay - represented;
  }
  return new Date(instant).toISOString();
}
function week(timestamp) {
  if (!Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) throw Error('invalid_quota_clock');
  const day = calendarTimestamp(parts(timestamp));
  const monday = day - ((new Date(day).getUTCDay() + 6) % 7) * DAY_MS;
  return {
    periodId: new Date(monday).toISOString().slice(0, 10),
    periodStart: midnight(monday), resetsAt: midnight(monday + 7 * DAY_MS),
  };
}
function identity(uid) {
  if (typeof uid !== 'string' || !UID.test(uid)) throw Error('invalid_quota_uid');
  // Keep identity-provider identifiers out of stored document payloads and paths.
  return createHash('sha256').update(uid).digest('hex');
}
function requestId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw Error('invalid_quota_request_id');
  return value.toLowerCase();
}
function reservation(value) {
  if (!value || typeof value.periodId !== 'string' || !PERIOD.test(value.periodId)) throw Error('invalid_quota_reservation');
  const day = Date.parse(`${value.periodId}T00:00:00.000Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== value.periodId || new Date(day).getUTCDay() !== 1) throw Error('invalid_quota_reservation');
  return {periodId: value.periodId, requestId: requestId(value.requestId)};
}
function used(snapshot) {
  if (!snapshot.exists) return 0;
  const value = snapshot.data().used;
  // A damaged counter must never turn into a fresh allowance.
  if (!Number.isInteger(value) || value < 0 || value > LIMIT) throw Error('invalid_quota_counter');
  return value;
}
function quota(window, count) {
  return {
    limit: LIMIT, used: count, remaining: LIMIT - count,
    resetsAt: window.resetsAt, timezone: TIMEZONE, periodStart: window.periodStart,
  };
}
function record(snapshot, expected) {
  if (!snapshot.exists) return null;
  const row = snapshot.data();
  if (row.periodId !== expected.periodId || row.requestId !== expected.requestId || !['reserved', 'refunded'].includes(row.state)) throw Error('invalid_quota_record');
  return row;
}

// Server-only reservation ledger. Requests reserve before any chargeable work;
// a crash leaves the reservation consumed until the next local calendar week.
// A refund is allowed only when the caller observed zero OpenAI attempts.
export function createWeeklyQuotaStore(db, {now = () => Date.now()} = {}) {
  const weeks = db.collection('planview_weekly_quota');
  const requests = db.collection('planview_weekly_reservations');
  const references = (subject, value) => ({
    weekly: weeks.doc(`${subject}_${value.periodId}`),
    request: requests.doc(`${subject}_${value.periodId}_${value.requestId}`),
  });

  return {
    async status(uid) {
      const subject = identity(uid), window = week(now());
      const snapshot = await weeks.doc(`${subject}_${window.periodId}`).get();
      return quota(window, used(snapshot));
    },

    async reserve(uid, value) {
      const subject = identity(uid), window = week(now());
      const token = {periodId: window.periodId, requestId: requestId(value)};
      const refs = references(subject, token);
      return db.runTransaction(async transaction => {
        const [weekly, existing] = await Promise.all([transaction.get(refs.weekly), transaction.get(refs.request)]);
        const count = used(weekly), previous = record(existing, token);
        if (previous) {
          if (!weekly.exists || (previous.state === 'reserved' && count === 0)) throw Error('invalid_quota_counter');
          return previous.state === 'reserved'
            ? {allowed: true, quota: quota(window, count), reservation: token}
            : {allowed: false, quota: quota(window, count)};
        }
        if (count >= LIMIT) return {allowed: false, quota: quota(window, count)};
        transaction.set(refs.weekly, {
          periodStart: window.periodStart, resetsAt: window.resetsAt, used: count + 1,
        });
        transaction.set(refs.request, {...token, state: 'reserved'});
        return {allowed: true, quota: quota(window, count + 1), reservation: token};
      });
    },

    async refund(uid, value) {
      const subject = identity(uid), token = reservation(value);
      const refs = references(subject, token);
      return db.runTransaction(async transaction => {
        const [weekly, existing] = await Promise.all([transaction.get(refs.weekly), transaction.get(refs.request)]);
        const previous = record(existing, token);
        if (!previous || previous.state === 'refunded') return {refunded: false};
        const count = used(weekly);
        if (!weekly.exists || count === 0) throw Error('invalid_quota_counter');
        const row = weekly.data();
        transaction.set(refs.weekly, {periodStart: row.periodStart, resetsAt: row.resetsAt, used: count - 1});
        transaction.set(refs.request, {...token, state: 'refunded'});
        return {refunded: true};
      });
    },
  };
}
