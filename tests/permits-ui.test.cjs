const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
class Element {
  constructor(tag, document) { this.tagName = tag; this.ownerDocument = document; this.children = []; this.parentNode = null; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.className = ''; this.value = ''; this.hidden = false; this.disabled = false; this.open = false; this._text = ''; this.classList = { add: name => this.toggle(name, true), remove: name => this.toggle(name, false), toggle: (name, active) => this.toggle(name, active) }; }
  toggle(name, active) { const set = new Set(this.className.split(/\s+/).filter(Boolean)); if (active === undefined) active = !set.has(name); if (active) set.add(name); else set.delete(name); this.className = [...set].join(' '); }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0]; }
  get isConnected() { return this._root === true || !!this.parentNode?.isConnected; }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children.forEach(node => { node.parentNode = null; }); this.children = []; }
  append(...nodes) { for (const node of nodes) { node.remove(); this.children.push(node); node.parentNode = this; } }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; }
  before(node) { const parent = this.parentNode; node.remove(); const index = parent.children.indexOf(this); parent.children.splice(index, 0, node); node.parentNode = parent; }
  replaceChildren(...nodes) { for (const old of this.children) old.parentNode = null; this.children = []; this._text = ''; this.append(...nodes); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  dispatch(name, extra = {}) { const event = { target: this, preventDefault() { this.defaultPrevented = true; }, ...extra }; for (const callback of this.listeners[name] || []) callback(event); return event; }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView(options) { this.scrollOptions = options; }
  matches(selector) {
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    const data = /^\[data-pv-tab="([^"]+)"\]$/.exec(selector); if (data) return this.dataset.pvTab === data[1];
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
  querySelectorAll(selector) {
    if (selector.includes(' > ')) { const [first, second] = selector.split(' > '); const roots = first === ':scope' ? [this] : this.querySelectorAll(first); return roots.flatMap(root => root.children.filter(node => node.matches(second))); }
    return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const fixtureCase = (id, status = 'granted', association = { kind: 'address', certain: true }) => ({ id, title: `Woning ${id}`, summary: `Bouwen van een woning ${id}.`, status, association, latestDate: '2026-04-03', events: [{ id: `${id}-notice`, title: `Besluit ${id}`, summary: `Officiële publicatie ${id}.`, status, date: '2026-04-03', caseNumber: `Z-${id}`, url: `https://zoek.officielebekendmakingen.nl/gmb-2026-${id}.html`, documentUrls: [] }] });
const fixtureResponse = (cases, extra = {}) => ({ version: 1, location: { point: { lat: 50.85, lng: 5.69 }, parcelLabel: 'MTT A 123' }, retrievedAt: '2026-10-18T13:00:00Z', coverage: { complete: false, available: true, partial: false, warnings: ['historical_coverage_unknown'], total: cases.length, returned: cases.length, hasMore: false }, cases, nextCursor: null, ...extra });
const fixtureQuestionSource = (id = 'notice-1') => ({ id, title: 'Vergunning Stuwweg', text: 'De omgevingsvergunning voor herinrichting van de Stuwweg is verleend. Zaaknummer RWS-2026/23770.', url: 'https://zoek.officielebekendmakingen.nl/stcrt-2026-23770.html', publicationDate: '2026-10-05', status: 'granted', caseNumber: 'RWS-2026/23770', association: { kind: 'area', certain: false, relation: 'contains_point' } });
const fixtureQuestionResponse = (source = fixtureQuestionSource(), extra = {}) => ({ state: 'answered', query: 'What happened here?', sources: [source], coverage: { complete: false, partial: false, warnings: [] }, answer: { summary: 'A permit was granted.', verdict: 'review', citations: [source.id], conditions: ['Publication status does not establish legal finality.'], claims: [{ statement: 'A permit for the Stuwweg works was granted.', sourceId: source.id, quote: 'De omgevingsvergunning voor herinrichting van de Stuwweg is verleend.' }] }, ...extra });
function harness(lang = 'en') {
  const document = { documentElement: { lang }, activeElement: null };
  document.createElement = tag => new Element(tag, document);
  const container = document.createElement('div'); container._root = true;
  const sources = document.createElement('section'); sources.dataset.pvTab = 'sources'; container.append(sources);
  document.querySelector = selector => selector === '#detail-content .detail-inner' ? container : container.querySelector(selector);
  const selection = { point: { lat: 50.85, lng: 5.69, address: 'Teststraat 1' }, parcel: { properties: { identificatie: 'NL.IMKAD.Perceel.123', perceelnummer: '123', sectie: 'A' } } };
  const state = { selected: selection, selectedPoint: selection.point }, calls = [], timers = new Map(), listeners = {};
  let timer = 0;
  const window = { addEventListener: (name, fn) => { listeners[name] = fn; }, planviewUI: { inspectorTab: 'summary', setInspectorTab(tab) { this.inspectorTab = tab; window.planviewPermits.activate(tab === 'permits'); } } };
  const context = vm.createContext({ document, state, window, URL, AbortController, console, setTimeout: (fn, delay) => { fn.delay = delay; timers.set(++timer, fn); return timer; }, clearTimeout: id => timers.delete(id), fetch: (url, options) => new Promise((resolve, reject) => { calls.push({ url, options, resolve, reject }); }) });
  vm.runInContext(read('permits-ui.js'), context);
  const api = window.planviewPermits;
  const get = selector => container.querySelector(selector);
  const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  return { api, state, document, window, calls, timers, container, get, settle, async respond(index, data, status = 200) { calls[index].resolve({ ok: status === 200, status, json: async () => data }); await settle(); }, async open() { api.render(); window.planviewUI.setInspectorTab('permits'); await settle(); }, choose(point) { api.selectionChanged(point); state.selectedPoint = point; state.selected = { point }; window.planviewUI.inspectorTab = 'summary'; api.render(); }, translate(lang) { document.documentElement.lang = lang; listeners['planview-language-change'](); } };
}

test('permit tab mounts for a location with no plan and fetches only on opening', async () => {
  const h = harness(); h.state.selected.primary = null; h.api.render();
  assert.equal(h.calls.length, 0); assert.equal(h.get('.pv-permits').hidden, true);
  await h.open(); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].url, '/api/permits/point');
  assert.deepEqual(JSON.parse(h.calls[0].options.body), { point: { lat: 50.85, lng: 5.69 }, parcelId: 'NL.IMKAD.Perceel.123' });
  assert.equal(h.get('.pv-permits-progress').hidden, false); assert.equal(h.get('.pv-permits-progress').attrs['aria-valuenow'], undefined, 'unknown work has no fabricated percentage');
  await h.respond(0, fixtureResponse([fixtureCase('1'), fixtureCase('2', 'refused', { kind: 'nearby', certain: false })]));
  assert.equal(h.get('.pv-permits-progress').hidden, true);
  assert.equal(h.get('.pv-permits-view-direct').attrs['aria-pressed'], 'true');
  assert.equal(h.get('.pv-permits-view-general > .pv-permits-view-count').textContent, '1');
  assert.doesNotMatch(h.get('.pv-permits-list').textContent, /Woning 2/);
  assert.match(h.get('.pv-permits-evidence').textContent, /not a complete building file/);
  assert.match(h.get('.pv-permits-count').textContent, /1 of 2 loaded/);
  assert.ok(h.get('.pv-permits').children.indexOf(h.get('.pv-permits-evidence')) < h.get('.pv-permits').children.indexOf(h.get('.pv-permits-list')));
});

test('simple text, status and chronology-year filters are local and preserve input focus', async () => {
  const h = harness(); await h.open();
  const first = fixtureCase('11'); first.events.unshift({ ...first.events[0], id: 'older', date: '2021-02-01', status: 'submitted' });
  await h.respond(0, fixtureResponse([first, fixtureCase('22', 'refused')]));
  const input = h.get('.pv-permits-query'); input.focus(); input.value = 'Z-11'; input.dispatch('input');
  assert.match(h.get('.pv-permits-count').textContent, /1 of 2/); assert.equal(h.calls.length, 1); assert.equal(h.document.activeElement, input);
  const year = h.get('.pv-permits-year'); assert.equal(year.attrs['aria-label'], 'Publication year'); year.value = '2021'; year.dispatch('change');
  assert.match(h.get('.pv-permits-count').textContent, /1 of 2/, 'year applies to earlier events, not only latest event');
  const status = h.get('.pv-permits-filter-status'); assert.equal(status.attrs['aria-label'], 'Status'); status.value = 'refused'; status.dispatch('change');
  assert.match(h.get('.pv-permits-count').textContent, /0 of 2/); assert.match(h.get('.pv-permits-list').textContent, /No loaded procedures match/);
  assert.match(h.get('.pv-permits-filters > summary').textContent, /\(2\)/);
  h.get('.pv-permits-reset').dispatch('click'); assert.match(h.get('.pv-permits-count').textContent, /2 of 2/); assert.equal(input.value, ''); assert.equal(h.calls.length, 1);
});

test('publication-year filter excludes a decision date from the previous year', async () => {
  const h = harness(); await h.open(); const item = fixtureCase('year'); item.latestDate = '2024-01-10'; item.events[0].date = '2024-01-10'; item.events[0].decisionDate = '2023-12-20';
  await h.respond(0, fixtureResponse([item])); const year = h.get('.pv-permits-year');
  assert.ok(year.children.some(option => option.value === '2024')); assert.ok(!year.children.some(option => option.value === '2023'));
  year.value = '2023'; year.dispatch('change'); assert.match(h.get('.pv-permits-count').textContent, /0 of 1/);
});

test('pagination merges the same procedure without losing a historic refusal or duplicating publications', async () => {
  const h = harness(); await h.open();
  const first = fixtureCase('17', 'refused'); first.latestDate = '2025-05-01'; first.events[0].date = first.latestDate;
  const second = fixtureCase('17', 'granted'); second.events[0].id = 'new-decision'; second.events.push(first.events[0]);
  await h.respond(0, fixtureResponse([first], { nextCursor: 'opaque-page-2', coverage: { complete: false, available: true, hasMore: true, nextCursor: 'opaque-page-2', warnings: [] } }));
  assert.equal(h.get('.pv-permits-more').hidden, false); h.get('.pv-permits-more').dispatch('click');
  assert.equal(h.calls.length, 2); assert.equal(JSON.parse(h.calls[1].options.body).cursor, 'opaque-page-2');
  await h.respond(1, fixtureResponse([second]));
  assert.match(h.get('.pv-permits-count').textContent, /1 of 1 loaded/);
  assert.match(h.get('.pv-permits-history > summary').textContent, /2 publications/);
  assert.match(h.get('.pv-permits-case-status').textContent, /Granted/);
  assert.match(h.get('.pv-permits-timeline').textContent, /Refused/); assert.equal(h.get('.pv-permits-more').hidden, true);
});

test('an older decision loaded after a newer extension preserves decisive status and confirmed association', async () => {
  const h = harness(); await h.open();
  const extension = fixtureCase('procedure', 'extended', { kind: 'nearby', certain: false });
  extension.events[0].id = 'new-extension'; extension.events[0].title = 'Procedure verlengd'; extension.events[0].summary = 'Beslistermijn verlengd.';
  const grant = fixtureCase('procedure', 'granted', { kind: 'address', certain: true }); grant.latestDate = '2025-05-01'; grant.events[0].date = grant.latestDate; grant.events[0].id = 'old-grant';
  await h.respond(0, fixtureResponse([extension], { nextCursor: 'page2' })); h.get('.pv-permits-more').dispatch('click'); await h.respond(1, fixtureResponse([grant]));
  assert.match(h.get('.pv-permits-case-status').textContent, /Granted/); assert.match(h.get('.pv-permits-case').textContent, /Address matched within parcel/);
  assert.match(h.get('.pv-permits-case > h4').textContent, /Procedure verlengd/); assert.match(h.get('.pv-permits-case-summary').textContent, /Beslistermijn verlengd/);
  assert.equal(h.get('.pv-permits-possible'), null); assert.match(h.get('.pv-permits-history > summary').textContent, /2 publications/);
});

test('merged procedure status follows decision dates while retaining latest publication chronology', async () => {
  const h = harness(); await h.open();
  const oldRefusal = fixtureCase('dated', 'refused'); oldRefusal.latestDate = '2026-05-01'; oldRefusal.events[0].id = 'late-publication-old-refusal'; oldRefusal.events[0].date = '2026-05-01'; oldRefusal.events[0].decisionDate = '2025-06-01';
  const newGrant = fixtureCase('dated', 'granted'); newGrant.latestDate = '2026-04-01'; newGrant.events[0].id = 'new-grant'; newGrant.events[0].date = '2026-04-01'; newGrant.events[0].decisionDate = '2026-03-25';
  await h.respond(0, fixtureResponse([oldRefusal], { nextCursor: 'next' })); h.get('.pv-permits-more').dispatch('click'); await h.respond(1, fixtureResponse([newGrant]));
  assert.match(h.get('.pv-permits-case-status').textContent, /Granted/);
  assert.match(h.get('.pv-permits-case-date').textContent, /Decision date for this status/); assert.match(h.get('.pv-permits-case-date').textContent, /2026/);
  assert.match(h.get('.pv-permits-case').textContent, /Latest publication/); assert.match(h.get('.pv-permits-history > summary').textContent, /2 publications/);
});

test('a partly granted and refused decision remains distinct from a full refusal', async () => {
  const h = harness('de'); await h.open(); const item = fixtureCase('partial', 'mixed'); item.statusEventId = item.events[0].id;
  await h.respond(0, fixtureResponse([item])); assert.match(h.get('.pv-permits-case-status').textContent, /Teilweise genehmigt \/ abgelehnt/);
  const status = h.get('.pv-permits-filter-status'); status.value = 'refused'; status.dispatch('change'); assert.match(h.get('.pv-permits-count').textContent, /0 von 1/);
  status.value = 'mixed'; status.dispatch('change'); assert.match(h.get('.pv-permits-count').textContent, /1 von 1/);
});

test('location changes abort requests and discard responses even if the transport ignores abort', async () => {
  const h = harness(); await h.open(); const oldSignal = h.calls[0].options.signal;
  h.choose({ lat: 51.1, lng: 5.8 }); assert.equal(oldSignal.aborted, true); assert.equal(h.calls.length, 1);
  h.window.planviewUI.setInspectorTab('permits'); assert.equal(h.calls.length, 2);
  await h.respond(0, fixtureResponse([fixtureCase('stale')])); assert.doesNotMatch(h.container.textContent, /Woning stale/);
  await h.respond(1, fixtureResponse([fixtureCase('current')])); assert.match(h.container.textContent, /Woning current/); assert.doesNotMatch(h.container.textContent, /Woning stale/);
});

test('cancelled refresh retains evidence, blocks late replacement and reuses per-location memory', async () => {
  const h = harness(); await h.open(); await h.respond(0, fixtureResponse([fixtureCase('saved')]));
  h.get('.pv-permits-query').value = 'saved'; h.get('.pv-permits-query').dispatch('input');
  const history = h.get('.pv-permits-history'); history.open = true; history.dispatch('toggle');
  h.get('.pv-permits-refresh').dispatch('click'); assert.match(h.get('.pv-permits-list').textContent, /Woning saved/);
  assert.equal(h.get('.pv-permits-history').open, true); h.get('.pv-permits-cancel').dispatch('click');
  assert.equal(h.calls[1].options.signal.aborted, true); assert.match(h.get('.pv-permits-status').textContent, /cancelled/);
  await h.respond(1, fixtureResponse([fixtureCase('late')])); assert.match(h.get('.pv-permits-list').textContent, /Woning saved/);
  const oldSelection = h.state.selected; h.choose({ lat: 51.1, lng: 5.8 });
  h.api.selectionChanged(oldSelection.point); h.state.selectedPoint = oldSelection.point; h.state.selected = oldSelection; h.api.render();
  h.window.planviewUI.setInspectorTab('permits'); assert.equal(h.calls.length, 2); assert.equal(h.get('.pv-permits-query').value, 'saved'); assert.match(h.get('.pv-permits-list').textContent, /Woning saved/);
});

test('empty, unavailable, partial and no-filter-match results remain distinct', async () => {
  const empty = harness(); await empty.open(); await empty.respond(0, fixtureResponse([]));
  assert.match(empty.get('.pv-permits-list').textContent, /No associated publications found/); assert.match(empty.get('.pv-permits-evidence').textContent, /does not establish/);
  const unavailable = harness(); await unavailable.open(); await unavailable.respond(0, {}, 503);
  assert.match(unavailable.get('.pv-permits-status').textContent, /unavailable/); assert.doesNotMatch(unavailable.get('.pv-permits-list').textContent, /No associated/);
  const partial = harness(); await partial.open(); await partial.respond(0, fixtureResponse([fixtureCase('33')], { coverage: { complete: false, available: true, partial: true, warnings: ['notice_document_unavailable'] } }));
  assert.match(partial.get('.pv-permits-evidence').textContent, /Retrieval incomplete/); assert.match(partial.get('.pv-permits-evidence').textContent, /could not be retrieved/); assert.match(partial.get('.pv-permits-list').textContent, /Woning 33/);
  const possible = harness(); await possible.open(); await possible.respond(0, fixtureResponse([fixtureCase('44', 'granted', { kind: 'mapped_location', certain: false })]));
  assert.match(possible.get('.pv-permits-list').textContent, /No securely attributed/); assert.equal(possible.get('.pv-permits-view-general > .pv-permits-view-count').textContent, '1'); possible.get('.pv-permits-view-general').dispatch('click'); assert.match(possible.get('.pv-permits-list').textContent, /Woning 44/);
});

test('source text stays literal, unsafe links are omitted and statuses translate without translating evidence', async () => {
  const h = harness('de'); await h.open(); const item = fixtureCase('safe', 'revoked');
  item.title = '<img src=x onerror=alert(1)>'; item.summary = '<script>unsafe()</script>'; item.events[0].url = 'javascript:alert(1)';
  item.events[0].documentUrls = ['https://example.com/besluit.pdf', 'http://example.com/plain.pdf', 'https://user:secret@example.com/secret.pdf'];
  await h.respond(0, fixtureResponse([item]));
  assert.match(h.get('.pv-permits-case').textContent, /<img src=x onerror/); assert.equal(h.get('.pv-permits-case').querySelectorAll('img').length, 0);
  const links = h.get('.pv-permits-case').querySelectorAll('a'); assert.equal(links.length, 1); assert.equal(links[0].href, 'https://example.com/besluit.pdf'); assert.equal(links[0].rel, 'noopener noreferrer');
  assert.match(h.get('.pv-permits-case-status').textContent, /Genehmigung widerrufen/);
  h.translate('nl'); assert.match(h.get('.pv-permits-case-status').textContent, /Vergunning ingetrokken/); assert.match(h.get('.pv-permits-case').textContent, /<script>unsafe/); assert.equal(h.calls.length, 1);
});

test('timeout and busy source leave retry available without a false empty result', async () => {
  const h = harness(); await h.open(); [...h.timers.values()][0]();
  h.calls[0].reject(Object.assign(new Error('abort'), { name: 'AbortError' })); await h.settle();
  assert.match(h.get('.pv-permits-status').textContent, /timed out/); assert.equal(h.get('.pv-permits-refresh').disabled, false); assert.doesNotMatch(h.get('.pv-permits-list').textContent, /No associated/);
  h.get('.pv-permits-refresh').dispatch('click'); await h.respond(1, {}, 429); assert.match(h.get('.pv-permits-status').textContent, /busy/); assert.equal(h.get('.pv-permits-cancel').hidden, true);
});

test('inspector integration retains four reachable keyboard tabs and keeps permits isolated', () => {
  const source = read('interface.js');
  assert.match(source, /\['summary','rules','permits','sources'\]/); assert.match(source, /e\.key==='End'\?all\.length-1/); assert.doesNotMatch(source, /%3/);
  assert.match(source, /planviewPermits\?\.selectionChanged\(p\)/); assert.match(source, /planviewPermits\?\.render\(\)/);
  assert.match(read('index.html'), /permits-ui\.js/); assert.match(read('index.html'), /permits-ui\.css/);
  assert.doesNotMatch(read('permits-ui.js'), /L\.(?:geoJSON|circleMarker|polyline)|planviewAdvanced|planviewRulesSearch/);
  assert.match(read('permits-ui.css'), /prefers-reduced-motion/); assert.match(read('permits-ui.js'), /pv-progress pv-permits-progress/);
});

test('published areas are separated from confirmed parcel matches and keep uncertainty labels', async () => {
  const h = harness(); await h.open();
  const area = fixtureCase('rws', 'unknown', { kind: 'area', certain: false, relation: 'contains_point', broad: true });
  const overlap = fixtureCase('overlap', 'granted', { kind: 'area', certain: false, relation: 'intersects_parcel' });
  await h.respond(0, fixtureResponse([area, overlap, fixtureCase('nearby', 'refused', { kind: 'nearby', certain: false })]));
  assert.doesNotMatch(h.get('.pv-permits-list').textContent, /Woning rws/);
  assert.equal(h.get('.pv-permits-view-direct > .pv-permits-view-count').textContent, '0');
  assert.equal(h.get('.pv-permits-view-general > .pv-permits-view-count').textContent, '3');
  h.get('.pv-permits-view-general').dispatch('click');
  const main = h.get('.pv-permits-list').children[0];
  assert.match(main.textContent, /Woning rws/); assert.match(main.textContent, /Woning overlap/);
  assert.match(main.textContent, /Published area covers selected point · exact parcel unconfirmed/);
  assert.match(main.textContent, /Published area overlaps selected parcel · exact parcel unconfirmed/);
  assert.match(main.textContent, /Woning nearby/); assert.match(main.textContent, /This publication covers a broad area/);
  assert.equal(h.calls.length, 1, 'Switching views never fetches data');
});

test('permit question is explicit, submits once and leaves quick list filtering independent', async () => {
  const h = harness(); await h.open(); await h.respond(0, fixtureResponse([fixtureCase('list')]));
  assert.equal(h.calls.length, 1); assert.match(h.get('.pv-permits-question').textContent, /Ask about permits/);
  assert.equal(h.get('.pv-permits-question-submit').disabled, true);
  const input = h.get('.pv-permits-question-input'); input.focus(); input.value = 'What happened with RWS-2026/23770?'; input.dispatch('input');
  assert.equal(h.calls.length, 1); assert.equal(h.document.activeElement, input); assert.equal(h.get('.pv-permits-question-submit').disabled, false);
  const event = h.get('.pv-permits-question-form').dispatch('submit'); h.get('.pv-permits-question-form').dispatch('submit');
  assert.equal(event.defaultPrevented, true); assert.equal(h.calls.length, 2); assert.equal(h.calls[1].url, '/api/permits/search');
  assert.deepEqual(JSON.parse(h.calls[1].options.body), { point: { lat: 50.85, lng: 5.69 }, query: 'What happened with RWS-2026/23770?', language: 'en', parcelId: 'NL.IMKAD.Perceel.123' });
  assert.equal(h.get('.pv-permits-question-progress').hidden, false); assert.equal(h.get('.pv-permits-question-progress').attrs['aria-valuenow'], undefined);
  assert.match(h.get('.pv-permits-list').textContent, /Woning list/);
  const filter = h.get('.pv-permits-query'); filter.value = 'nothing'; filter.dispatch('input');
  assert.equal(h.calls.length, 2); assert.match(h.get('.pv-permits-list').textContent, /No loaded procedures match/);
  await h.respond(1, fixtureQuestionResponse());
  assert.match(h.get('.pv-permits-answer').textContent, /A permit for the Stuwweg/);
  assert.match(h.get('.pv-permits-quote').textContent, /De omgevingsvergunning/);
  assert.equal(h.get('.pv-permits-question-progress').hidden, true); assert.equal(h.get('.pv-permits-query').value, 'nothing');
  h.get('.pv-permits-citations').querySelector('button').dispatch('click');
  assert.equal(h.get('.pv-permits-question-source').open, true); assert.equal(h.document.activeElement, h.get('.pv-permits-question-source > summary'));
});

test('question examples fill and focus without requests, translate and preserve question evidence', async () => {
  const h = harness('de'); await h.open(); await h.respond(0, fixtureResponse([]));
  h.get('.pv-permits-question-example').dispatch('click');
  assert.equal(h.calls.length, 1); assert.match(h.get('.pv-permits-question-input').value, /Welche Anträge/);
  assert.equal(h.document.activeElement, h.get('.pv-permits-question-input'));
  h.get('.pv-permits-question-form').dispatch('submit'); assert.equal(JSON.parse(h.calls[1].options.body).language, 'de');
  await h.respond(1, fixtureQuestionResponse()); h.translate('nl');
  assert.match(h.get('.pv-permits-question').textContent, /Vraag over vergunningen/); assert.match(h.get('.pv-permits-answer').textContent, /A permit for the Stuwweg/);
  assert.match(h.get('.pv-permits-quote').textContent, /De omgevingsvergunning/); assert.equal(h.calls.length, 2);
});

test('cancelled question keeps previous answer, input focus and history while dropping late responses', async () => {
  const h = harness(); await h.open(); await h.respond(0, fixtureResponse([fixtureCase('history')]));
  const input = h.get('.pv-permits-question-input'); input.value = 'First question'; input.dispatch('input'); h.get('.pv-permits-question-form').dispatch('submit');
  await h.respond(1, fixtureQuestionResponse());
  input.value = 'Second question'; input.dispatch('input'); h.get('.pv-permits-question-form').dispatch('submit');
  assert.equal(h.get('.pv-permits-question-previous').hidden, false); assert.match(h.get('.pv-permits-question-previous').textContent, /First question/);
  assert.match(h.get('.pv-permits-answer').textContent, /A permit for the Stuwweg/);
  h.get('.pv-permits-question-cancel').dispatch('click'); assert.equal(h.calls[2].options.signal.aborted, true);
  assert.equal(h.document.activeElement, input); assert.equal(input.readOnly, false); assert.match(h.get('.pv-permits-question-status').textContent, /cancelled/);
  const changed = fixtureQuestionResponse(); changed.answer.claims[0].statement = 'SHOULD NOT APPEAR'; await h.respond(2, changed);
  assert.doesNotMatch(h.get('.pv-permits-question-results').textContent, /SHOULD NOT APPEAR/); assert.match(h.get('.pv-permits-answered-query').textContent, /First question/);
  assert.match(h.get('.pv-permits-list').textContent, /Woning history/);
});

test('changing selected location aborts permit questions and ignores stale answers independently of history', async () => {
  const h = harness(); await h.open(); await h.respond(0, fixtureResponse([fixtureCase('old')]));
  const input = h.get('.pv-permits-question-input'); input.value = 'Old location'; input.dispatch('input'); h.get('.pv-permits-question-form').dispatch('submit');
  h.choose({ lat: 51.1, lng: 5.8 }); assert.equal(h.calls[1].options.signal.aborted, true); h.window.planviewUI.setInspectorTab('permits');
  await h.respond(1, fixtureQuestionResponse()); assert.equal(h.get('.pv-permits-answer'), null); assert.equal(h.get('.pv-permits-question-input').value, '');
  await h.respond(2, fixtureResponse([fixtureCase('new')])); assert.match(h.get('.pv-permits-list').textContent, /Woning new/); assert.doesNotMatch(h.container.textContent, /Woning old/);
});

test('source quotes are validated against originals and all model and source markup stays literal', async () => {
  const h = harness(); await h.open(); await h.respond(0, fixtureResponse([]));
  const input = h.get('.pv-permits-question-input'); input.value = 'Check text'; input.dispatch('input'); h.get('.pv-permits-question-form').dispatch('submit');
  const invalid = fixtureQuestionResponse(); invalid.answer.claims[0].quote = 'Invented refusal reason'; invalid.answer.claims[0].statement = 'UNSUPPORTED CLAIM';
  invalid.sources[0].title = '<img src=x onerror=alert(1)>'; invalid.sources[0].text = '<script>source()</script>'; invalid.sources[0].url = 'javascript:alert(1)';
  await h.respond(1, invalid); assert.equal(h.get('.pv-permits-answer'), null); assert.doesNotMatch(h.get('.pv-permits-question-results').textContent, /UNSUPPORTED CLAIM/);
  assert.match(h.get('.pv-permits-question-source').textContent, /<script>source\(\)<\/script>/); assert.equal(h.get('.pv-permits-question-source').querySelectorAll('img').length, 0); assert.equal(h.get('.pv-permits-question-source').querySelectorAll('a').length, 0);
  input.value = 'Check exact text'; input.dispatch('input'); h.get('.pv-permits-question-form').dispatch('submit');
  const valid = fixtureQuestionResponse(); valid.sources[0].text = '<img src=x> is literally part of the text.'; valid.answer.claims[0].quote = '<img src=x>'; valid.answer.claims[0].statement = '<script>claim()</script>';
  await h.respond(2, valid); assert.match(h.get('.pv-permits-answer').textContent, /<script>claim\(\)<\/script>/); assert.equal(h.get('.pv-permits-answer').querySelectorAll('script').length, 0); assert.equal(h.get('.pv-permits-quote').querySelectorAll('img').length, 0);
});

test('AI unavailable and partial search retain original sources and loaded history with localized warnings', async () => {
  const h = harness('de'); await h.open(); await h.respond(0, fixtureResponse([fixtureCase('history')]));
  const input = h.get('.pv-permits-question-input'); input.value = 'Ablehnungen'; input.dispatch('input'); h.get('.pv-permits-question-form').dispatch('submit');
  const source = fixtureQuestionSource(); source.text = ''; source.sourceAvailable = false;
  await h.respond(1, fixtureQuestionResponse(source, { state: 'matches', answer: null, coverage: { partial: true, warnings: ['api_key_missing', 'ai_busy', 'ai_unavailable', 'source_text_unavailable', 'query_retrieval_limited'] } }));
  assert.equal(h.get('.pv-permits-answer'), null); assert.match(h.get('.pv-permits-question-coverage').textContent, /Suchumfang unvollständig/);
  assert.match(h.get('.pv-permits-question-coverage').textContent, /KI-API-Schlüssel/); assert.match(h.get('.pv-permits-question-coverage').textContent, /Zusammenfassungsdienst ist ausgelastet/); assert.match(h.get('.pv-permits-question-coverage').textContent, /Abrufgrenze/);
  assert.match(h.get('.pv-permits-question-source').textContent, /Originaltext nicht verfügbar/); assert.equal(h.get('.pv-permits-question-source').querySelector('a').href, source.url);
  assert.match(h.get('.pv-permits-list').textContent, /Woning history/); h.get('.pv-permits-question-form').dispatch('submit'); await h.respond(2, {}, 503);
  assert.match(h.get('.pv-permits-question-status').textContent, /nicht verfügbar/); assert.match(h.get('.pv-permits-question-source').textContent, /Vergunning Stuwweg/);
});

test('question timeout releases controls immediately and keeps a failed retrieval distinct from empty matches', async () => {
  const h = harness(); await h.open(); await h.respond(0, fixtureResponse([]));
  const input = h.get('.pv-permits-question-input'); input.value = 'History'; input.dispatch('input'); h.get('.pv-permits-question-form').dispatch('submit');
  [...h.timers.values()][0](); assert.equal(h.calls[1].options.signal.aborted, true); assert.equal(h.get('.pv-permits-question-submit').disabled, false);
  assert.match(h.get('.pv-permits-question-status').textContent, /timed out/); assert.equal(h.get('.pv-permits-question-progress').hidden, true);
  h.get('.pv-permits-question-form').dispatch('submit'); await h.respond(2, { state: 'unavailable', sources: [], answer: null, coverage: { available: false, partial: true, warnings: ['source_unavailable'] } });
  assert.match(h.get('.pv-permits-question-results').textContent, /retrieval is unavailable/); assert.doesNotMatch(h.get('.pv-permits-question-results').textContent, /No matching publications/);
});

test('actual permit engine diagnostics use readable localized text instead of technical codes', async () => {
  const keys = ['permit_question_retrieval_limited', 'uncertain_permit_association', 'permit_question_ranked_not_exhaustive', 'attachments_not_retrieved', 'permit_question_page_unavailable', 'source_text_unavailable', 'notice_text_truncated', 'future_source_limit'];
  const messages = {
    en: ['retrieval limit', 'exact connection', 'ranked by relevance', 'Not all attachments', 'further page of publications', 'original text is unavailable', 'shortened for retrieval', 'additional source limitation'],
    nl: ['ophaallimiet', 'precieze verband', 'gerangschikt op relevantie', 'Niet alle bijlagen', 'volgende pagina met publicaties', 'oorspronkelijke tekst is niet beschikbaar', 'bij het ophalen ingekort', 'aanvullende bronbeperking'],
    de: ['Abrufgrenze', 'genauer Bezug', 'nach Relevanz', 'Nicht alle Anlagen', 'weitere Seite mit Veröffentlichungen', 'Originaltexte sind nicht verfügbar', 'beim Abruf gekürzt', 'weitere Einschränkung der Quellen']
  };
  for (const lang of ['en', 'nl', 'de']) {
    const h = harness(lang); await h.open(); await h.respond(0, fixtureResponse([]));
    const input = h.get('.pv-permits-question-input'); input.value = 'History'; input.dispatch('input'); h.get('.pv-permits-question-form').dispatch('submit');
    const source = fixtureQuestionSource(); source.sourceAvailable = false; source.text = source.title;
    await h.respond(1, fixtureQuestionResponse(source, { state: 'matches', answer: null, coverage: { partial: true, warnings: keys } }));
    const notes = h.get('.pv-permits-question-coverage').textContent;
    for (const key of keys) assert.equal(notes.includes(key), false, `technical warning ${key} leaked in ${lang}`);
    for (const message of messages[lang]) assert.ok(notes.includes(message), `missing ${lang} diagnostic: ${message}`);
    assert.equal(h.get('.pv-permits-question-source').querySelector('blockquote'), null, 'a title fallback must not be presented as original body text');
    assert.equal(h.get('.pv-permits-question-source').querySelector('a').href, source.url);
  }
});

test('interpreted Dutch search is visible with a direct answer and a separate grounded summary', async () => {
  const h = harness('de'); await h.open(); await h.respond(0, fixtureResponse([fixtureCase('history')]));
  const input = h.get('.pv-permits-question-input'); input.value = 'Was wird hier gebaut?'; input.dispatch('input'); h.get('.pv-permits-question-form').dispatch('submit');
  const data = fixtureQuestionResponse();
  data.searchIntent = { originalQuestion: input.value, dutchQuery: 'herinrichting Stuwweg werkzaamheden vergunning', terms: ['herinrichting', 'Stuwweg', 'werkzaamheden'], intent: 'project_details', interpreted: true };
  data.answer.claims.push({ statement: 'The case is recorded as RWS-2026/23770.', sourceId: data.sources[0].id, quote: 'Zaaknummer RWS-2026/23770.' });
  await h.respond(1, data);
  assert.match(h.get('.pv-permits-search-intent > summary').textContent, /Gesucht auf Niederländisch: herinrichting Stuwweg/);
  assert.match(h.get('.pv-permits-search-intent').textContent, /Angaben zum Vorhaben/);
  assert.equal(h.get('.pv-permits-answer-label').textContent, 'Antwort');
  assert.equal(h.get('.pv-permits-direct-answer').textContent, 'A permit for the Stuwweg works was granted.');
  assert.equal(h.get('.pv-permits-summary-heading').textContent, 'Zusammenfassung');
  assert.match(h.get('.pv-permits-answer').textContent, /The case is recorded/);
  assert.match(h.get('.pv-permits-list').textContent, /Woning history/); assert.equal(h.get('.pv-permits-query').value, '');
});

test('grounded quotes and translated terms highlight original text safely and citations scroll to the hit', async () => {
  const h = harness(); await h.open(); await h.respond(0, fixtureResponse([]));
  const input = h.get('.pv-permits-question-input'); input.value = 'Was ist genehmigt?'; input.dispatch('input'); h.get('.pv-permits-question-form').dispatch('submit');
  const source = fixtureQuestionSource(); source.text = 'De omgevingsvergunning\n  voor herinrichting is verleend. <img src=x onerror=alert(1)> Stuwweg 12.';
  source.highlightRanges = [{ start: -1, end: 20, term: 'invalid' }, { start: 0, end: 9000, term: 'invalid' }, { start: 0, end: 2, term: 'WRONG' }];
  source.highlightTerms = ['Stuwweg', '<img', '.*'];
  const data = fixtureQuestionResponse(source); data.answer.claims[0].quote = 'De omgevingsvergunning voor herinrichting is verleend.';
  data.searchIntent = { dutchQuery: 'vergunning herinrichting', terms: ['vergunning', 'herinrichting'], intent: 'status', interpreted: true };
  await h.respond(1, data);
  const card = h.get('.pv-permits-question-source'), body = card.querySelector('blockquote'), marks = body.querySelectorAll('mark');
  assert.equal(body.textContent, source.text, 'highlighting never modifies the source text'); assert.ok(marks.length >= 3);
  assert.match(marks[0].textContent, /omgevingsvergunning\n  voor/); assert.match(marks[0].className, /highlight-evidence/);
  assert.ok(marks.some(mark => mark.textContent === 'Stuwweg')); assert.ok(marks.some(mark => mark.textContent === '<img'));
  assert.equal(card.querySelectorAll('img').length, 0); assert.equal(card.querySelectorAll('script').length, 0);
  h.get('.pv-permits-read-hit').dispatch('click'); assert.equal(card.open, true); assert.equal(h.document.activeElement, card.querySelector('summary'));
  assert.equal(marks[0].scrollOptions.block, 'nearest');
});

test('PDF passages show document and page coverage, OCR uncertainty and the exact original page link', async () => {
  const h = harness('de'); await h.open(); await h.respond(0, fixtureResponse([]));
  const input = h.get('.pv-permits-question-input'); input.value = 'Auflagen?'; input.dispatch('input'); h.get('.pv-permits-question-form').dispatch('submit');
  const source = fixtureQuestionSource(); Object.assign(source, { kind: 'document_page', documentType: 'pdf', page: 4, pageCount: 22, ocr: true, excerpt: true, documentUrl: 'https://example.com/besluit.pdf', url: 'https://example.com/besluit.pdf#page=4' });
  const data = fixtureQuestionResponse(source); data.coverage = { partial: true, documentsChecked: 2, documentsAvailable: 4, documentPagesRead: 6, documentOCRPages: 1, warnings: ['permit_document_ocr_uncertain', 'permit_document_pages_limited'] };
  await h.respond(1, data);
  assert.match(h.get('.pv-permits-document-page').textContent, /PDF · Seite 4 \/ 22 · Textauszug/);
  assert.match(h.get('.pv-permits-ocr-note').textContent, /Wörter und Zahlen können falsch erkannt/);
  assert.match(h.get('.pv-permits-document-coverage').textContent, /4 PDF-Dokumente geladen · 2 Quellenverweise geprüft · 6 Seiten mit lesbarem Text · 1 Seiten mit OCR/);
  assert.equal(h.get('.pv-permits-question-source').querySelector('a').href, 'https://example.com/besluit.pdf#page=4');
  assert.match(h.get('.pv-permits-question-source').querySelector('a').textContent, /Originaldokument/);
  assert.match(h.get('.pv-permits-question-coverage').textContent, /Nur ausgewählte Dokumentseiten/);
});

test('an unestablished answer exposes the actual missing evidence without presenting unsupported claims', async () => {
  const h = harness(); await h.open(); await h.respond(0, fixtureResponse([]));
  const input = h.get('.pv-permits-question-input'); input.value = 'Why refused?'; input.dispatch('input'); h.get('.pv-permits-question-form').dispatch('submit');
  const data = fixtureQuestionResponse(); data.state = 'matches';
  data.answer = { verdict: 'not-established', summary: 'UNSUPPORTED SUMMARY', claims: [], citations: [], conditions: ['The notice does not publish refusal reasons.'], missingInformation: ['The full decision was not available.'] };
  data.searchIntent = { dutchQuery: 'weigeringsgronden', terms: ['weigeringsgronden'], intent: 'refusal_reasons', interpreted: false };
  await h.respond(1, data);
  assert.equal(h.get('.pv-permits-no-answer-heading').textContent, 'Answer not established');
  assert.match(h.get('.pv-permits-answer-gaps').textContent, /notice does not publish refusal reasons/); assert.match(h.get('.pv-permits-answer-gaps').textContent, /full decision was not available/);
  assert.doesNotMatch(h.get('.pv-permits-question-results').textContent, /UNSUPPORTED SUMMARY/); assert.equal(h.get('.pv-permits-answer'), null);
  assert.match(h.get('.pv-permits-search-intent').textContent, /automatic interpretation was not available/);
});

test('intent and PDF diagnostics are localized and the request budget covers document processing without fake phases', async () => {
  const keys = ['permit_intent_unavailable', 'permit_intent_busy', 'permit_documents_not_loaded', 'permit_document_unavailable', 'permit_document_limit', 'permit_document_deadline', 'permit_document_text_truncated', 'permit_document_pages_limited', 'permit_document_ocr', 'permit_document_ocr_uncertain', 'permit_document_extraction_unavailable', 'permit_document_links_blocked'];
  for (const lang of ['en', 'nl', 'de']) {
    const h = harness(lang); await h.open(); await h.respond(0, fixtureResponse([]));
    const input = h.get('.pv-permits-question-input'); input.value = 'Documents'; input.dispatch('input'); h.get('.pv-permits-question-form').dispatch('submit');
    assert.equal([...h.timers.values()][0].delay, 250000);
    assert.equal(h.get('.pv-permits-question-progress').attrs['aria-valuenow'], undefined);
    const data = fixtureQuestionResponse(); data.coverage.warnings = keys; await h.respond(1, data);
    const notes = h.get('.pv-permits-question-coverage').textContent;
    for (const key of keys) assert.equal(notes.includes(key), false, `untranslated ${key} in ${lang}`);
    assert.doesNotMatch(notes, /additional source limitation|aanvullende bronbeperking|weitere Einschränkung der Quellen/);
  }
});

test('PDF compatibility ligatures and combining text validate and highlight without changing raw Unicode offsets', async () => {
  const h = harness(); await h.open(); await h.respond(0, fixtureResponse([]));
  const input = h.get('.pv-permits-question-input'); input.value = 'Check the official decision'; input.dispatch('input'); h.get('.pv-permits-question-form').dispatch('submit');
  const source = fixtureQuestionSource();
  source.text = '😀 Voorwoord. De ofﬁciele\n\u00a0 vergunning voor cafe\u0301 is verleend. <img src=x onerror=alert(1)> Einde.';
  const data = fixtureQuestionResponse(source); data.answer.claims[0].quote = 'De officiele vergunning voor café is verleend.';
  data.answer.claims[0].statement = 'The cited official decision grants the permit.';
  await h.respond(1, data);
  assert.match(h.get('.pv-permits-direct-answer').textContent, /decision grants the permit/);
  const body = h.get('.pv-permits-question-source').querySelector('blockquote'), mark = body.querySelector('mark');
  assert.equal(body.textContent, source.text); assert.equal(mark.textContent, 'De ofﬁciele\n\u00a0 vergunning voor cafe\u0301 is verleend.');
  assert.equal(body.querySelectorAll('img').length, 0); assert.match(body.textContent, /<img src=x onerror/);
  h.get('.pv-permits-read-hit').dispatch('click'); assert.equal(mark.scrollOptions.block, 'nearest');
});

test('document coverage keeps links and loaded PDFs separate and labels partially read PDF pages', async () => {
  const h = harness('de'); await h.open(); await h.respond(0, fixtureResponse([]));
  const input = h.get('.pv-permits-question-input'); input.value = 'Auflagen'; input.dispatch('input'); h.get('.pv-permits-question-form').dispatch('submit');
  const source = fixtureQuestionSource(); Object.assign(source, { documentType: 'pdf', page: 22, pageCount: 22, incomplete: true, excerpt: true, ocr: true });
  const data = fixtureQuestionResponse(source); data.coverage = { partial: true, documentsChecked: 3, documentsAvailable: 1, documentPagesRead: 22, documentPagesFullyRead: 21, documentPagesAvailable: 22, documentOCRPages: 22, warnings: ['permit_document_pages_limited'] };
  await h.respond(1, data);
  const coverage = h.get('.pv-permits-document-coverage').textContent;
  assert.match(coverage, /1 PDF-Dokumente geladen · 3 Quellenverweise geprüft · 21 \/ 22 Seiten mit lesbarem Text · 22 Seiten verarbeitet · 22 Seiten mit OCR/);
  assert.doesNotMatch(coverage, /3\s*\/\s*1/);
  assert.match(h.get('.pv-permits-question-source > summary').textContent, /Teilweise gelesen/);
  assert.match(h.get('.pv-permits-incomplete-note').textContent, /nur teilweise gelesen/);
  assert.match(h.get('.pv-permits-direct-answer').textContent, /permit for the Stuwweg/);
  assert.ok(h.get('.pv-permits-question-source').querySelector('mark'), 'available excerpt remains usable and highlighted');
});

test('page coverage never shows a contradictory or unknown denominator', async () => {
  const h = harness(); await h.open(); await h.respond(0, fixtureResponse([]));
  const input = h.get('.pv-permits-question-input'); input.value = 'Documents'; input.dispatch('input'); h.get('.pv-permits-question-form').dispatch('submit');
  const data = fixtureQuestionResponse(); data.coverage = { partial: true, documentPagesRead: 22, documentPagesFullyRead: 21, documentPagesAvailable: 20, warnings: [] };
  await h.respond(1, data);
  assert.match(h.get('.pv-permits-document-coverage').textContent, /21 pages with readable text/);
  assert.doesNotMatch(h.get('.pv-permits-document-coverage').textContent, /21\s*\/\s*20/);
});

test('association views keep filters, focus, counts and language while switching locally', async () => {
  const h = harness('de'); await h.open();
  await h.respond(0, fixtureResponse([fixtureCase('direct'), fixtureCase('area','refused',{kind:'area',certain:false,relation:'contains_point'}),fixtureCase('near','granted',{kind:'nearby',certain:false})]));
  const direct=h.get('.pv-permits-view-direct'), general=h.get('.pv-permits-view-general'), input=h.get('.pv-permits-query');
  assert.match(direct.textContent,/Dieses Grundstück1/);assert.match(general.textContent,/Gebiet & Umgebung2/);
  input.value='area';input.dispatch('input');general.focus();general.dispatch('click');
  assert.equal(h.document.activeElement,general);assert.equal(general.attrs['aria-pressed'],'true');assert.equal(direct.attrs['aria-pressed'],'false');
  assert.match(h.get('.pv-permits-list').textContent,/Woning area/);assert.doesNotMatch(h.get('.pv-permits-list').textContent,/Woning near/);
  assert.equal(h.get('.pv-permits-query'),input);assert.equal(input.value,'area');assert.match(general.textContent,/2$/,'badges count all loaded results in the category');
  h.translate('nl');assert.equal(h.get('.pv-permits-view-general').attrs['aria-pressed'],'true');assert.match(h.get('.pv-permits-view-general').textContent,/Gebied & omgeving2/);
  assert.equal(h.get('.pv-permits-query').value,'area');assert.equal(h.calls.length,1);
  h.get('.pv-permits-reset').dispatch('click');assert.equal(h.get('.pv-permits-view-general').attrs['aria-pressed'],'true');
  assert.equal(h.get('.pv-permits-list').querySelectorAll('.pv-permits-case').length,2);
  h.choose({lat:51.1,lng:5.8});assert.equal(h.get('.pv-permits-view-direct').attrs['aria-pressed'],'true','new parcels start with confirmed associations');
});

test('pagination can reveal confirmed matches without changing the selected association view', async () => {
  const h=harness();await h.open();await h.respond(0,fixtureResponse([fixtureCase('near','unknown',{kind:'nearby',certain:false})],{nextCursor:'next'}));
  assert.match(h.get('.pv-permits-list').textContent,/No securely attributed/);assert.equal(h.get('.pv-permits-more').hidden,false);
  h.get('.pv-permits-view-general').dispatch('click');h.get('.pv-permits-more').dispatch('click');
  await h.respond(1,fixtureResponse([fixtureCase('confirmed')]));
  assert.equal(h.get('.pv-permits-view-general').attrs['aria-pressed'],'true');assert.equal(h.get('.pv-permits-view-direct > .pv-permits-view-count').textContent,'1');
  assert.doesNotMatch(h.get('.pv-permits-list').textContent,/Woning confirmed/);
  h.get('.pv-permits-view-direct').dispatch('click');assert.match(h.get('.pv-permits-list').textContent,/Woning confirmed/);assert.equal(h.calls.length,2);
});


test('title address inferences appear under This parcel with explicit evidence labels in all languages',async()=>{
  const h=harness();await h.open();
  await h.respond(0,fixtureResponse([fixtureCase('title','granted',{kind:'title_address',certain:false,label:'Singel 8, Maastricht'}),fixtureCase('area','granted',{kind:'area',certain:false,relation:'contains_point'})]));
  assert.equal(h.get('.pv-permits-view-direct > .pv-permits-view-count').textContent,'1');
  assert.match(h.get('.pv-permits-list').textContent,/Address recognised in title.*Singel 8/);
  assert.doesNotMatch(h.get('.pv-permits-list').textContent,/Woning area/);
  h.translate('de');assert.match(h.get('.pv-permits-list').textContent,/Adresse im Titel erkannt/);
  h.translate('nl');assert.match(h.get('.pv-permits-list').textContent,/Adres herkend in titel/);
  h.get('.pv-permits-view-general').dispatch('click');assert.doesNotMatch(h.get('.pv-permits-list').textContent,/Woning title/);
  assert.match(h.get('.pv-permits-list').textContent,/Woning area/);
});

test('later pages promote an area case using title evidence without duplicates',async()=>{
 const h=harness();await h.open();
 await h.respond(0,fixtureResponse([fixtureCase('same','granted',{kind:'area',certain:false,relation:'contains_point'})],{nextCursor:'next'}));
 h.get('.pv-permits-view-general').dispatch('click');h.get('.pv-permits-more').dispatch('click');
 await h.respond(1,fixtureResponse([fixtureCase('same','granted',{kind:'title_address',certain:false,label:'Singel 8, Maastricht'})]));
 assert.equal(h.get('.pv-permits-view-direct > .pv-permits-view-count').textContent,'1');
 assert.equal(h.get('.pv-permits-view-general > .pv-permits-view-count').textContent,'0');
 h.get('.pv-permits-view-direct').dispatch('click');
 assert.equal(h.get('.pv-permits-list').querySelectorAll('.pv-permits-case').length,1);
 assert.match(h.get('.pv-permits-list').textContent,/Address recognised in title/);
});
