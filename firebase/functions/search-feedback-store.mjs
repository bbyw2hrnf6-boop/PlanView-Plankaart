import {createHash, randomUUID} from 'node:crypto';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_ID = new RegExp(`^${UUID}$`, 'i');
const RECORD_ID = new RegExp(`^(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z)_${UUID}$`, 'i');
const KINDS = new Set(['sites', 'rules', 'permits']);
const RATINGS = new Set(['up', 'down']);
const OUTCOMES = new Set(['complete', 'partial', 'empty', 'error']);
const INPUT_FIELDS = ['searchId', 'submissionId', 'kind', 'rating', 'text', 'outcome', 'resultCount'];
const HOUR_MS = 3_600_000;
const RATE_LIMIT = 60;
const PAGE_SIZE = 50;

export class SearchFeedbackError extends Error {
  constructor(code, status = 400, extra = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}
function invalid() { throw new SearchFeedbackError('invalid_search_feedback'); }
function fields(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  if (Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) invalid();
}
function uuid(value) {
  if (typeof value !== 'string' || !UUID_ID.test(value)) invalid();
  return value.toLowerCase();
}
function text(value) {
  if (typeof value !== 'string' || value.length > 1500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) invalid();
  return value.replace(/\r\n?/g, '\n').trim();
}
function content(value) {
  const searchId = uuid(value.searchId);
  if (!KINDS.has(value.kind) || !RATINGS.has(value.rating) || !OUTCOMES.has(value.outcome)) invalid();
  if (value.resultCount !== null && (!Number.isSafeInteger(value.resultCount) || value.resultCount < 0)) invalid();
  const note = text(value.text);
  if (value.rating === 'up' && value.text !== '') invalid();
  return {searchId, kind: value.kind, rating: value.rating, text: note, outcome: value.outcome, resultCount: value.resultCount};
}
export function searchFeedbackId(value) {
  if (typeof value !== 'string') invalid();
  const match = RECORD_ID.exec(value);
  if (!match || !Number.isFinite(Date.parse(match[1])) || new Date(match[1]).toISOString() !== match[1]) invalid();
  return value.toLowerCase().replace('t', 'T').replace('z_', 'Z_');
}
const hash = value => createHash('sha256').update(value).digest('hex');
function publicItem(snapshot) {
  const row = snapshot.data(), id = searchFeedbackId(snapshot.id);
  // Only explicit rating context leaves storage. Queries, addresses, source text,
  // browser identity and provider output are never added automatically.
  return {id, ...content(row), createdAt: id.slice(0, 24), user: 'TestUser02'};
}

export function createSearchFeedbackStore(db, {now = () => Date.now(), id = randomUUID} = {}) {
  const feedback = db.collection('planview_search_feedback');
  const submissions = db.collection('planview_search_feedback_submissions');
  const searches = db.collection('planview_search_feedback_searches');
  const limits = db.collection('planview_search_feedback_limits');
  return {
    async submit(uid, value) {
      if (typeof uid !== 'string' || !uid || uid.length > 128) invalid();
      fields(value, INPUT_FIELDS);
      const item = content(value), submissionId = uuid(value.submissionId);
      // Include the submitted text before normalization so an altered retry is
      // rejected even when it differs only in whitespace.
      const contentHash = hash(JSON.stringify([item.searchId, item.kind, item.rating, value.text, item.outcome, item.resultCount]));
      const currentTime = now(), createdAt = new Date(currentTime).toISOString();
      const recordId = searchFeedbackId(`${createdAt}_${id()}`);
      const receiptRef = submissions.doc(hash(`${uid}\0${submissionId}`));
      const searchRef = searches.doc(hash(`${uid}\0${item.searchId}`));
      const limitRef = limits.doc(hash(uid)), recordRef = feedback.doc(recordId);
      return db.runTransaction(async transaction => {
        const receipt = await transaction.get(receiptRef);
        if (receipt.exists) {
          const prior = receipt.data();
          if (prior.contentHash !== contentHash) invalid();
          const priorId = searchFeedbackId(prior.id);
          return {receipt: {id: priorId, createdAt: priorId.slice(0, 24)}, duplicate: true};
        }
        const [search, limit, existing] = await Promise.all([
          transaction.get(searchRef), transaction.get(limitRef), transaction.get(recordRef),
        ]);
        if (search.exists) throw new SearchFeedbackError('search_already_rated', 409);
        const timestamps = (limit.exists && Array.isArray(limit.data().timestamps) ? limit.data().timestamps : [])
          .filter(time => Number.isFinite(time) && time > currentTime - HOUR_MS).sort((left, right) => left - right);
        if (timestamps.length >= RATE_LIMIT) {
          throw new SearchFeedbackError('search_feedback_rate_limit', 429, {
            retryAfterSeconds: Math.max(1, Math.ceil((timestamps[0] + HOUR_MS - currentTime) / 1000)),
          });
        }
        if (existing.exists) throw new SearchFeedbackError('search_feedback_unavailable', 503);
        transaction.set(recordRef, {...item, createdAt, user: 'TestUser02'});
        transaction.set(receiptRef, {id: recordId, createdAt, contentHash});
        transaction.set(searchRef, {id: recordId});
        transaction.set(limitRef, {timestamps: [...timestamps, currentTime]});
        return {receipt: {id: recordId, createdAt}, duplicate: false};
      });
    },
    async list(value = {}) {
      fields(value, ['cursor'], []);
      // The automatic createdAt index includes document name in this direction;
      // no composite index is needed, including equal-timestamp pagination.
      let query = feedback.orderBy('createdAt', 'desc').orderBy('__name__', 'desc');
      if (value.cursor !== undefined) {
        const cursor = searchFeedbackId(value.cursor);
        query = query.startAfter(cursor.slice(0, 24), cursor);
      }
      const result = await query.limit(PAGE_SIZE + 1).get();
      const items = result.docs.slice(0, PAGE_SIZE).map(publicItem);
      return {items, nextCursor: result.docs.length > PAGE_SIZE ? items.at(-1).id : null};
    },
  };
}
