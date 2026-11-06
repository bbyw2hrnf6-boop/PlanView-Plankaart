const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = name => fs.readFileSync(require.resolve('../' + name), 'utf8');
const part = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start) + start.length));
const CustomEvent = class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } };
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

class Element {
  constructor(tag, doc) { this.tagName = tag; this.doc = doc; this.children = []; this.listeners = {}; this.dataset = {}; this.attrs = {}; this.className = ''; this._text = ''; this.value = ''; this.classList = { toggle() {} }; }
  get isConnected() { return this.root || !!this.parentNode?.isConnected; }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  append(...nodes) { for (const node of nodes) { node.remove(); this.children.push(node); node.parentNode = this; } }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; }
  before(node) { const parent = this.parentNode; node.remove(); parent.children.splice(parent.children.indexOf(this), 0, node); node.parentNode = parent; }
  replaceChildren() { for (const node of this.children) node.parentNode = null; this.children = []; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  dispatch(name) { for (const fn of this.listeners[name] || []) fn({ preventDefault() {} }); }
  focus() { this.doc.activeElement = this; }
  matches(selector) {
    if (selector === '[type="submit"]') return this.type === 'submit';
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    return this.tagName === selector;
  }
  querySelectorAll(selector) { if (selector.startsWith(':scope')) return []; return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function rules() {
  const document = { documentElement: { lang: 'en' } }; document.createElement = tag => new Element(tag, document); document.createDocumentFragment = () => document.createElement('fragment'); document.getElementById = () => null;
  const root = document.createElement('div'); root.root = true; document.querySelector = selector => selector === '#detail-content .detail-inner' ? root : root.querySelector(selector);
  const state = { selected: { point: { lat: 52, lng: 5 } } }, calls = [], events = [], timers = [], listeners = {}; let id = 0;
  const window = { crypto: { randomUUID: () => `10000000-0000-4000-8000-${String(++id).padStart(12, '0')}` }, dispatchEvent: event => events.push(event.detail), addEventListener: (type, fn) => listeners[type] = fn, planviewUI: { inspectorTab: 'rules', setInspectorTab() {} } };
  vm.runInNewContext(read('rules-search.js'), { document, state, window, CustomEvent, URL, AbortController, setTimeout: fn => { timers.push(fn); return timers.length; }, wgs84ToRd: () => [150000, 450000], fetch: (...args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject })) });
  const api = window.planviewRulesSearch; api.render();
  return { api, document, root, state, window, events, calls, timers, get: selector => root.querySelector(selector), submit(query = 'Private question at Teststraat 8') { const input = root.querySelector('textarea'); input.value = query; input.dispatch('input'); root.querySelector('form').dispatch('submit'); }, async respond(index, data, status = 200) { calls[index].resolve({ ok: status === 200, status, json: async () => data }); await settle(); }, translate(lang) { document.documentElement.lang = lang; listeners['planview-language-change'](); } };
}
const ruleResponse = (extra = {}) => ({ state: 'matches', sources: [{ id: 'source-1', title: 'Teststraat 8', text: 'Building rule.' }], coverage: { complete: true, partial: false, warnings: [] }, ...extra });

test('rule rating starts only after explicit submit, follows current painted results and rebinds on language change', async () => {
  const h = rules(); h.api.render(); h.get('textarea').value = 'Draft'; h.get('textarea').dispatch('input'); assert.equal(h.events.length, 0); assert.equal(h.calls.length, 0);
  h.submit(); assert.equal(h.events[0].phase, 'started'); assert.equal(h.events[0].kind, 'rules');
  await h.respond(0, ruleResponse()); const event = h.events.at(-1);
  assert.equal(event.phase, 'completed'); assert.equal(event.searchId, h.events[0].searchId); assert.equal(event.resultCount, 1); assert.equal(event.outcome, 'complete');
  assert.equal(event.container, h.get('.pv-rules-results')); assert.match(event.container.textContent, /Building rule/); assert.equal(event.container.isConnected, true);
  assert.deepEqual(Object.keys(event).sort(), ['container', 'kind', 'outcome', 'phase', 'resultCount', 'searchId']); assert.doesNotMatch(JSON.stringify({ ...event, container: null }), /Private|Teststraat|Building rule/);
  h.api.render(); assert.equal(h.events.length, 2, 'unrelated render does not repeat completion');
  h.translate('nl'); assert.equal(h.events.length, 3); assert.equal(h.events.at(-1).searchId, event.searchId); assert.notEqual(h.events.at(-1).container, event.container); assert.equal(h.events.at(-1).container.isConnected, true); assert.equal(h.calls.length, 1);
});

test('rule cancellation and selection changes suppress even an abort-ignoring stale success', async () => {
  for (const selectionChange of [false, true]) {
    const h = rules(); h.submit();
    if (selectionChange) { h.state.selected = { point: { lat: 53, lng: 6 } }; h.api.selectionChanged(h.state.selected.point); h.api.render(); } else h.api.cancel();
    await h.respond(0, ruleResponse()); assert.equal(h.events.some(event => event.phase === 'completed'), false); assert.equal(h.events.at(-1).phase, 'cleared'); assert.equal(h.calls[0].args[1].signal.aborted, true);
  }
});

test('rule empty, partial and failed requests complete with accurate rating metadata', async () => {
  for (const [data, status, outcome, resultCount] of [[ruleResponse({ sources: [] }), 200, 'empty', 0], [ruleResponse({ coverage: { partial: true } }), 200, 'partial', 1], [{}, 503, 'error', null]]) {
    const h = rules(); h.submit(); await h.respond(0, data, status); assert.equal(h.events.at(-1).phase, 'completed'); assert.equal(h.events.at(-1).outcome, outcome); assert.equal(h.events.at(-1).resultCount, resultCount);
  }
});

test('rule timeout emits one failure and a late transport response never changes its rating target', async () => {
  const h = rules(); h.submit(); h.timers[0](); assert.match(h.get('.pv-rules-status').textContent, /timed out/);
  assert.equal(h.events.at(-1).outcome, 'error'); await h.respond(0, ruleResponse()); assert.equal(h.events.filter(event => event.phase === 'completed').length, 1); assert.doesNotMatch(h.get('.pv-rules-results').textContent, /Building rule/);
});

function sites({ candidates = [], contextError = false, deferred = false } = {}) {
  const fields = new Map(), get = id => { if (!fields.has(id)) fields.set(id, { isConnected: true, value: '', textContent: '', innerHTML: '', querySelectorAll: () => [], querySelector: () => null }); return fields.get(id); };
  get('advanced-query').value = 'Private site search'; get('advanced-scope-select').value = 'view';
  const advanced = { results: [], ticket: 0, overlay: { clearLayers() {} }, markers: { clearLayers() {} } }, events = [], requests = []; let id = 0;
  const window = { crypto: { randomUUID: () => `20000000-0000-4000-8000-${String(++id).padStart(12, '0')}` }, dispatchEvent: event => { if (event.type === 'planview-search-feedback') events.push(event.detail); }, PlanViewDesktop: { enabled: true } };
  const spec = { queryText: 'Private site search', groups: ['wonen'], statuses: [], excludeGroups: [], excludeStatuses: [], unsupported: [], nearFeatures: [], siteCriteria: {}, environmentCriteria: { maxSlopeDeg: null }, distanceRules: {}, distanceKm: {} };
  const scope = { name: 'Test region', bounds: { toBBoxString: () => '5,52,6,53' } };
  const context = vm.createContext({ advanced, window, document: { documentElement: { lang: 'en' } }, CustomEvent, AbortController, $: get, console: { warn() {} }, selectedScope: () => scope, wantsMarkedArea: () => false, normalize: input => ({ ...spec, ...input }), localInterpret: () => spec, previewMap: async () => [], contextNeeds: () => false, criteriaErrors: () => [], siteNeeds: () => false, environmentNeeds: () => false, activateDistances() {}, renderInterpretation() {}, completeInterpretation: value => value, interpret: async () => spec, searchCore: { kinds: [], resolveRules: () => ({}) }, distanceDefaults: {}, setSearchTab() {}, setSearchBusy: busy => advanced.busy = busy, searchProgress: update => advanced.progress = { ...advanced.progress, ...update }, loadContext: async () => { if (contextError) throw new Error('unavailable'); if (deferred) return new Promise(resolve => requests.push(resolve)); return {}; }, candidatePoints: () => candidates, tr: en => en, showResults() {}, checkNearbyHomes: async () => {}, checkDsoLeads: async () => {}, rememberSearch() {}, updateResearchState() {}, finishSearchFeedback: null });
  context.PLAN_WMS = '/official-map'; context.intersects = () => true; context.choosePrimary = features => features[0]; context.fetchFeatures = async () => [{ properties: { naam: 'Wonen', bestemmingshoofdgroep: 'wonen', planstatus: 'vastgesteld', plangebied: 'plan-id' } }]; context.municipalityAt = () => null; context.scoreResult = () => 50; context.searchCore.resultKey = result => result.point.lat + ',' + result.point.lng;
  context.L = { latLngBounds: () => ({ pad() { return this; } }) }; context.state = { map: { fitBounds() {} } };
  const source = read('smart-search.js'); vm.runInContext(part(source, '  function searchFeedback(', '  const aliases =') + part(source, '  async function runSearch(', '  Object.assign(advanced,') + ';globalThis.api={runSearch,clearSearchFeedback};', context);
  return { advanced, events, requests, spec, run: manual => context.api.runSearch(manual ? spec : null), cancel() { context.api.clearSearchFeedback(); advanced.abortController.abort(); advanced.ticket++; }, get };
}

test('site AI interpretation preview offers no rating until confirmed screening actually finishes', async () => {
  const h = sites(); await h.run(false); assert.equal(h.events.length, 0); assert.ok(h.advanced.pending);
  await h.run(false); assert.equal(h.events.length, 2); assert.equal(h.events[0].phase, 'started'); assert.equal(h.events[1].phase, 'completed'); assert.equal(h.events[1].kind, 'sites'); assert.equal(h.events[1].outcome, 'empty'); assert.equal(h.events[1].resultCount, 0); assert.equal(h.events[1].container, h.get('advanced-results-view'));
});

test('site screening errors can be rated but cancelled or replaced request completions cannot', async () => {
  const error = sites({ contextError: true }); await error.run(true); assert.equal(error.events.at(-1).outcome, 'error'); assert.equal(error.events.at(-1).resultCount, null);
  const cancelled = sites({ deferred: true }), running = cancelled.run(true); await settle(); assert.equal(cancelled.events[0].phase, 'started'); cancelled.cancel(); cancelled.requests[0]({}); await running;
  assert.equal(cancelled.events.at(-1).phase, 'cleared'); assert.equal(cancelled.events.filter(event => event.phase === 'completed').length, 0);
  const replaced = sites({ deferred: true }), first = replaced.run(true); await settle(); const second = replaced.run(true); await settle();
  replaced.requests[0]({}); await first; assert.equal(replaced.events.filter(event => event.phase === 'completed').length, 0);
  replaced.requests[1]({}); await second; const completion = replaced.events.filter(event => event.phase === 'completed'); assert.equal(completion.length, 1); assert.equal(completion[0].searchId, replaced.events.filter(event => event.phase === 'started').at(-1).searchId);
});

test('successful site screening emits its final full candidate count after map evidence completes', async () => {
  const h = sites({ candidates: [{ point: { lat: 52.1, lng: 5.1 }, distanceMissing: [] }, { point: { lat: 52.2, lng: 5.2 }, distanceMissing: [] }] });
  await h.run(true); assert.equal(h.advanced.results.length, 2); assert.equal(h.advanced.busy, false); assert.equal(h.advanced.progress.phase, 'complete');
  assert.equal(h.events.at(-1).phase, 'completed'); assert.equal(h.events.at(-1).outcome, 'complete'); assert.equal(h.events.at(-1).resultCount, 2);
});
