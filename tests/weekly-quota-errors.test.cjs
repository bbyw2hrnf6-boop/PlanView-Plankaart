const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = name => fs.readFileSync(require.resolve('../' + name), 'utf8');
function between(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}
const expected = {
  en: { weekly_search_limit: /150 AI searches.*Contact the owner.*Monday/, weekly_quota_unavailable: /allowance could not be checked.*try again later/ },
  nl: { weekly_search_limit: /150 AI-zoekopdrachten.*eigenaar.*maandag/, weekly_quota_unavailable: /weeklimiet kon niet worden gecontroleerd.*later opnieuw/ },
  de: { weekly_search_limit: /150 KI-Suchen.*Besitzer.*Montag/, weekly_quota_unavailable: /Wochenkontingent konnte nicht geprüft werden.*später erneut/ }
};
function messages(language) {
  const context = vm.createContext({ window: {}, cloud: true, tr: (en, nl, de) => ({ en, nl, de })[language] });
  vm.runInContext(between(read('ai-settings.js'), '  const messages={', '  function render(){'), context);
  return context.window.planviewAIMessage;
}
function ruleRun({ language, code, status = 429, helper = true }) {
  const point = { lat: 52, lng: 5 }, previous = { state: 'answered', sources: [{ id: 'previous-rule' }] };
  const model = { point, key: 'current', query: 'Can I build?', selection: { point }, loading: false, request: 0, response: previous };
  const context = vm.createContext({
    model, window: helper ? { planviewAIMessage: messages(language) } : {},
    currentSelection: () => ({ point }), pointKey: () => 'current', wgs84ToRd: () => [150000, 450000],
    lang: () => language, tr: (en, nl, de) => ({ en, nl, de })[language], text: value => typeof value === 'string' ? value : '',
    stop: () => { model.request++; }, beginSearchFeedback: () => null, finishSearchFeedback() {}, paintResults() {}, AbortController, setTimeout: () => 0,
    fetch: async () => Response.json({ error: code }, { status })
  });
  vm.runInContext(between(read('rules-search.js'), '  async function run() {', '  window.planviewRulesSearch =') + ';globalThis.run=run;', context);
  return { model, previous, run: context.run };
}
function permitRun({ language, code, status = 429, helper = true, unreadable = false }) {
  const previous = { state: 'answered', sources: [{ id: 'previous-permit' }] };
  const question = { query: 'What was approved?', loading: false, response: previous };
  const model = { key: 'current', selection: { point: { lat: 52, lng: 5 } }, entry: { question }, active: true, questionRequest: 0 };
  const context = vm.createContext({
    model, window: helper ? { planviewAIMessage: messages(language) } : {},
    language: () => language, tr: (en, nl, de) => ({ en, nl, de })[language],
    text: value => typeof value === 'string' ? value : '', selectedStillMatches: () => true, parcelId: () => 'parcel',
    stopQuestion: () => { model.questionRequest++; }, beginSearchFeedback: () => null, finishSearchFeedback() {}, paintQuestion() {}, AbortController, setTimeout: () => 0, clearTimeout() {},
    fetch: async () => unreadable ? new Response('unreadable', { status }) : Response.json({ error: code }, { status })
  });
  vm.runInContext(between(read('permits-ui.js'), '  async function runQuestion() {', '  window.planviewPermits =') + ';globalThis.run=runQuestion;', context);
  return { question, previous, run: context.run };
}

for (const language of Object.keys(expected)) {
  test(`weekly errors have localized shared messages in ${language}`, () => {
    const message = messages(language);
    for (const [code, pattern] of Object.entries(expected[language])) assert.match(message(code), pattern);
    assert.doesNotMatch(message('weekly_search_limit'), /API|OpenAI|credit|Guthaben|tegoed/);
  });
  for (const code of Object.keys(expected[language])) {
    test(`rules search explains ${code} in ${language} and preserves earlier sources`, async () => {
      const h = ruleRun({ language, code, status: code === 'weekly_search_limit' ? 429 : 503 });
      await h.run(); assert.match(h.model.error, expected[language][code]);
      assert.equal(h.model.response, h.previous); assert.equal(h.model.loading, false);
    });
    test(`permit search explains ${code} in ${language} and preserves earlier sources`, async () => {
      const h = permitRun({ language, code, status: code === 'weekly_search_limit' ? 429 : 503 });
      await h.run(); assert.match(h.question.error, expected[language][code]);
      assert.equal(h.question.response, h.previous); assert.equal(h.question.loading, false);
    });
  }
}
test('ordinary provider throttling retains retry wording and does not claim a weekly limit', async () => {
  for (const unreadable of [false, true]) {
    const h = permitRun({ language: 'en', code: 'permit_question_limit', unreadable });
    await h.run(); assert.match(h.question.error, /service is busy.*retry/); assert.doesNotMatch(h.question.error, /Monday|150/);
  }
  const h = ruleRun({ language: 'en', code: 'dso_key_missing', status: 409 });
  await h.run(); assert.equal(h.model.error, 'dso_key_missing');
});
test('missing shared helper falls back to readable service errors without raw weekly codes', async () => {
  const rules = ruleRun({ language: 'en', code: 'weekly_search_limit', helper: false });
  await rules.run(); assert.match(rules.model.error, /service is busy/); assert.doesNotMatch(rules.model.error, /weekly_search_limit/);
  const permits = permitRun({ language: 'en', code: 'weekly_search_limit', helper: false });
  await permits.run(); assert.match(permits.question.error, /service is busy/); assert.doesNotMatch(permits.question.error, /weekly_search_limit/);
});
