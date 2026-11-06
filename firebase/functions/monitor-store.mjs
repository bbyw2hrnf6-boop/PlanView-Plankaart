// Private operational counters only. This store deliberately accepts no request bodies,
// response bodies, credentials, coordinates, or identity-provider identifiers.
const USERS = ['Admin', 'TestUser02', 'Approved user'];
const PROVIDERS = ['openai', 'dso', 'rp', 'koop', 'pdok', 'routing', 'other'];
const ENDPOINTS = new Set([
  '/api/status', '/api/settings', '/api/ai/settings', '/api/ai/test', '/api/interpret',
  '/api/rules/search', '/api/dso/rules', '/api/rp/plan', '/api/routes/status',
  '/api/routes', '/api/permits/point', '/api/permits/search',
]);
const METRICS = [
  'requests', 'prompts', 'providerCalls', 'errors', 'durationMs', 'inputTokens',
  'cachedInputTokens', 'cacheWriteTokens', 'outputTokens', 'reasoningTokens',
  'estimatedCostUsd', 'unpricedCalls', 'usageMissingCalls',
];
const COUNTERS = METRICS.filter(key => key !== 'estimatedCostUsd');
const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_METRIC = 1_000_000_000_000;
const RECENT_LIMIT = 100;

function number(value, maximum = MAX_METRIC, integer = true) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  const bounded = Math.min(value, maximum);
  return integer ? Math.floor(bounded) : bounded;
}
function metrics(value = {}, aggregate = false) {
  const maximum = aggregate ? Number.MAX_SAFE_INTEGER : MAX_METRIC;
  const result = Object.fromEntries(COUNTERS.map(key => [key, number(value?.[key], maximum)]));
  result.estimatedCostUsd = number(value?.estimatedCostUsd, aggregate ? Number.MAX_SAFE_INTEGER : 1_000_000_000, false);
  return result;
}
function providers(value = {}, aggregate = false) {
  return Object.fromEntries(PROVIDERS.map(key => [key, number(value?.[key], aggregate ? Number.MAX_SAFE_INTEGER : MAX_METRIC)]));
}
function sum(left, right, keys = METRICS) {
  return Object.fromEntries(keys.map(key => [key, Math.min(Number.MAX_SAFE_INTEGER, (left[key] || 0) + (right[key] || 0))]));
}
function iso(value) {
  if (typeof value !== 'string' || value.length > 30) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp < 0) return null;
  return new Date(timestamp).toISOString();
}
function endpoint(value) {
  const path = typeof value === 'string' ? value.split(/[?#]/, 1)[0] : '';
  return ENDPOINTS.has(path) ? path : '/api/unknown';
}
function event(value, currentTime) {
  if (!value || typeof value.id !== 'string' || !UUID.test(value.id)) throw Error('invalid_monitor_event_id');
  const started = iso(value.startedAt);
  const startedAt = started && Date.parse(started) <= currentTime ? started : new Date(currentTime).toISOString();
  const status = Number.isInteger(value.status) && value.status >= 100 && value.status <= 599 ? value.status : 500;
  const result = {
    id: value.id.toLowerCase(), startedAt,
    user: USERS.includes(value.user) ? value.user : 'Approved user',
    endpoint: endpoint(value.endpoint), status,
    ...metrics(value.metrics),
    providers: providers(value.metrics?.providers),
  };
  // These three figures describe the gateway request, never caller-supplied counters.
  result.requests = 1;
  result.errors = status >= 400 ? 1 : 0;
  result.durationMs = number(value.durationMs, DAY_MS);
  return result;
}
function dayUserId(day, user) { return `${day}_${USERS.indexOf(user)}`; }
function publicEvent(snapshot) {
  const row = snapshot.data();
  return {
    id: UUID.test(row.id || '') ? row.id.toLowerCase() : 'unknown',
    startedAt: iso(row.startedAt),
    user: USERS.includes(row.user) ? row.user : 'Approved user',
    endpoint: endpoint(row.endpoint),
    status: Number.isInteger(row.status) && row.status >= 100 && row.status <= 599 ? row.status : 500,
    ...metrics(row),
  };
}

export function createMonitorStore(db, {now = () => Date.now()} = {}) {
  const events = db.collection('planview_monitor_events');
  const daily = db.collection('planview_monitor_daily');
  const meta = db.collection('planview_monitor_meta').doc('config');

  return {
    async record(value) {
      const currentTime = now();
      const clean = event(value, currentTime);
      const day = clean.startedAt.slice(0, 10);
      const eventRef = events.doc(clean.id);
      const rollupRef = daily.doc(dayUserId(day, clean.user));
      return db.runTransaction(async transaction => {
        const existing = await transaction.get(eventRef);
        if (existing.exists) return {recorded: false};
        // Firestore requires every transaction read before its first write.
        const [rollup, configuration] = await Promise.all([
          transaction.get(rollupRef), transaction.get(meta),
        ]);
        const previous = rollup.exists ? rollup.data() : {};
        transaction.set(eventRef, clean);
        transaction.set(rollupRef, {
          day, user: clean.user,
          ...sum(metrics(previous, true), clean),
          providers: sum(providers(previous.providers, true), clean.providers, PROVIDERS),
        });
        if (!configuration.exists) transaction.set(meta, {trackingStartedAt: clean.startedAt});
        return {recorded: true};
      });
    },

    async read() {
      const currentTime = now();
      const today = new Date(currentTime).toISOString().slice(0, 10);
      const fromTime = Date.parse(`${today}T00:00:00.000Z`) - 13 * DAY_MS;
      const from = new Date(fromTime).toISOString();
      const to = new Date(currentTime).toISOString();
      const days = Array.from({length: 14}, (_, index) => new Date(fromTime + index * DAY_MS).toISOString().slice(0, 10));
      const keys = days.flatMap(day => USERS.map(user => ({day, user})));
      // Exactly 14 days × 3 fixed user labels: totals never depend on a capped log query.
      const [configuration, recent, snapshots] = await Promise.all([
        meta.get(),
        events.where('startedAt', '>=', from).where('startedAt', '<=', to)
          .orderBy('startedAt', 'desc').limit(RECENT_LIMIT + 1).get(),
        Promise.all(keys.map(({day, user}) => daily.doc(dayUserId(day, user)).get())),
      ]);
      const rows = snapshots.flatMap((snapshot, index) => snapshot.exists
        ? [{...keys[index], ...metrics(snapshot.data(), true)}] : []);
      return {
        window: {
          days: 14, from, to, timeZone: 'UTC',
          trackingStartedAt: configuration.exists ? iso(configuration.data().trackingStartedAt) : null,
        },
        summary: rows.reduce((total, row) => sum(total, row), metrics()),
        daily: rows,
        recent: recent.docs.slice(0, RECENT_LIMIT).map(publicEvent),
        recentLimit: RECENT_LIMIT,
        recentTruncated: recent.docs.length > RECENT_LIMIT,
      };
    },
  };
}
