import {createHash, randomUUID} from 'node:crypto';

export const FEEDBACK_CATEGORIES = Object.freeze([
  'uncategorized', 'interface', 'search', 'rules', 'permits', 'map', 'idea', 'other',
]);
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const SUBMISSION_ID = new RegExp(`^${UUID}$`, 'i');
const RECORD_ID = new RegExp(`^(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z)_${UUID}$`, 'i');
const HOUR_MS = 3_600_000;
const RATE_LIMIT = 20;
const PAGE_SIZE = 50;

export class FeedbackError extends Error {
  constructor(code, status = 400, extra = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

function invalid() { throw new FeedbackError('invalid_feedback'); }
function fields(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const keys = Object.keys(value);
  if (keys.some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) invalid();
}
export function feedbackCategory(value = 'uncategorized') {
  if (!FEEDBACK_CATEGORIES.includes(value)) invalid();
  return value;
}
function feedbackText(value) {
  if (typeof value !== 'string' || value.length > 3000) invalid();
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (!text || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) invalid();
  return text;
}
export function feedbackId(value) {
  if (typeof value !== 'string') invalid();
  const match = RECORD_ID.exec(value);
  if (!match || !Number.isFinite(Date.parse(match[1])) || new Date(match[1]).toISOString() !== match[1]) invalid();
  return value.toLowerCase().replace('t', 'T').replace('z_', 'Z_');
}
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function publicItem(snapshot) {
  const row = snapshot.data();
  const id = feedbackId(snapshot.id);
  const createdAt = id.slice(0, 24);
  // Return only these explicit fields, even if other data ever enters the document.
  return {
    id, text: feedbackText(row.text), category: feedbackCategory(row.category),
    createdAt, user: 'TestUser02',
  };
}

export function createFeedbackStore(db, {now = () => Date.now(), id = randomUUID} = {}) {
  const feedback = db.collection('planview_test_feedback');
  const submissions = db.collection('planview_feedback_submissions');
  const limits = db.collection('planview_feedback_limits');

  return {
    async submit(uid, value) {
      if (typeof uid !== 'string' || !uid || uid.length > 128) invalid();
      fields(value, ['text', 'category', 'submissionId'], ['text', 'submissionId']);
      const text = feedbackText(value.text), category = feedbackCategory(value.category);
      if (typeof value.submissionId !== 'string' || !SUBMISSION_ID.test(value.submissionId)) invalid();
      const submissionId = value.submissionId.toLowerCase();
      const contentHash = hash(JSON.stringify([text, category]));
      const currentTime = now(), createdAt = new Date(currentTime).toISOString();
      const recordId = feedbackId(`${createdAt}_${id()}`);
      const receiptRef = submissions.doc(hash(`${uid}\0${submissionId}`));
      const limitRef = limits.doc(hash(uid));
      const recordRef = feedback.doc(recordId);

      return db.runTransaction(async transaction => {
        const priorReceipt = await transaction.get(receiptRef);
        if (priorReceipt.exists) {
          const prior = priorReceipt.data();
          if (prior.contentHash !== contentHash) invalid();
          const priorId = feedbackId(prior.id);
          return {receipt: {id: priorId, createdAt: priorId.slice(0, 24)}, duplicate: true};
        }
        const [limit, existingRecord] = await Promise.all([
          transaction.get(limitRef), transaction.get(recordRef),
        ]);
        const timestamps = (limit.exists && Array.isArray(limit.data().timestamps) ? limit.data().timestamps : [])
          .filter(time => Number.isFinite(time) && time > currentTime - HOUR_MS).sort((left, right) => left - right);
        if (timestamps.length >= RATE_LIMIT) {
          throw new FeedbackError('feedback_rate_limit', 429, {
            retryAfterSeconds: Math.max(1, Math.ceil((timestamps[0] + HOUR_MS - currentTime) / 1000)),
          });
        }
        // A collision must never replace a different submission.
        if (existingRecord.exists) throw new FeedbackError('feedback_unavailable', 503);
        transaction.set(recordRef, {text, category, createdAt, user: 'TestUser02'});
        transaction.set(receiptRef, {id: recordId, createdAt, contentHash});
        transaction.set(limitRef, {timestamps: [...timestamps, currentTime]});
        return {receipt: {id: recordId, createdAt}, duplicate: false};
      });
    },

    async list(value = {}) {
      fields(value, ['cursor'], []);
      // Firestore's automatic createdAt index also orders equal timestamps by
      // document name in the same direction. A name-only descending query needs
      // an additional index in production; use the existing field index instead.
      let query = feedback.orderBy('createdAt', 'desc').orderBy('__name__', 'desc');
      if (value.cursor !== undefined) {
        const cursor = feedbackId(value.cursor);
        query = query.startAfter(cursor.slice(0, 24), cursor);
      }
      // Both cursor values preserve stable pages for simultaneous submissions.
      const result = await query.limit(PAGE_SIZE + 1).get();
      const items = result.docs.slice(0, PAGE_SIZE).map(publicItem);
      return {items, nextCursor: result.docs.length > PAGE_SIZE ? items.at(-1).id : null};
    },

    async categorize(value) {
      fields(value, ['id', 'category']);
      const recordId = feedbackId(value.id), category = feedbackCategory(value.category);
      const reference = feedback.doc(recordId);
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) throw new FeedbackError('feedback_not_found', 404);
        const item = {...publicItem(snapshot), category};
        transaction.set(reference, {
          text: item.text, category, createdAt: item.createdAt, user: 'TestUser02',
        });
        return {item};
      });
    },
  };
}
