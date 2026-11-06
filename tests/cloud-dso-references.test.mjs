import test from 'node:test';
import assert from 'node:assert/strict';
import { DSO_BASE } from '../cloud/lib/rule-sources.mjs';
import { DSOReferenceError, fetchPointReferences } from '../cloud/lib/dso-references.mjs';

const key = 'fixture-dso-key', point = { x: 176000.1234, y: 318000.5678 };
const document = (id, type = 'Omgevingsplan') => ({
  identificatie: `/akn/nl/act/gm9999/2024/${id}`, citeerTitel: `Fixture ${id}`, type: { waarde: type },
  aangeleverdDoorEen: { naam: 'Fixture authority', bestuurslaag: 'gemeente' },
  geregistreerdMet: { beginInwerking: '2026-01-01' }, publicatieID: `https://identifier.overheid.nl/akn/nl/act/gm9999/2024/${id}`
});
const annotations = () => ({
  geselecteerdeLocatieRefs: ['local', 'group', 'authority'],
  locaties: [{ identificatie: 'local', locatieType: 'Gebied', noemer: 'Specific test area' },
    { identificatie: 'group', locatieType: 'Gebiedengroep', noemer: 'Test group' },
    { identificatie: 'authority', locatieType: 'Ambtsgebied', noemer: 'Authority area' },
    { identificatie: 'elsewhere', locatieType: 'Gebied', noemer: 'Elsewhere' }],
  gebiedsaanwijzingen: [{ identificatie: 'designation', naam: 'Bouwgebied', groep: { waarde: 'bouwen' }, locatieRefs: ['group'] },
    { identificatie: 'elsewhere-designation', naam: 'Not selected', locatieRefs: ['elsewhere'] }],
  regelteksten: [{ identificatie: 'text1', wId: 'gm9999_1__art_2' }, { identificatie: 'text2', wId: 'gm9999_1__art_3' }],
  regelsVoorIedereen: [
    { identificatie: 'specific', locatieRefs: ['local'], regeltekstRef: 'text1', themas: [{ waarde: 'bouwen' }], activiteitLocatieaanduidingen: [{ activiteitRef: 'build' }] },
    { identificatie: 'group-rule', locatieRefs: ['group'], regeltekstRef: 'text1', themas: [{ waarde: 'bouwen' }] },
    { identificatie: 'broad', locatieRefs: ['authority'], regeltekstRef: 'text2', themas: [{ waarde: 'water' }] },
    { identificatie: 'not-here', locatieRefs: ['elsewhere'], regeltekstRef: 'text2', themas: [{ waarde: 'elsewhere' }] }
  ],
  activiteiten: [{ identificatie: 'build', naam: 'Bouwen' }, { identificatie: 'not-referenced', naam: 'Not selected activity' }]
});
const discovery = (documents, next = '') => ({ _embedded: { regelingen: documents }, _links: next ? { next: { href: next } } : {} });
const fetchFixture = (docs = [document('plan')], annotationFactory = annotations) => async url => Response.json(url.includes('/regelingen/_zoek?') ? discovery(docs) : annotationFactory(url));

test('uses official v8 geometry POSTs and frozen temporal scope; summarizes only confirmed selected annotations', async () => {
  const calls = [], fixtures = fetchFixture();
  const result = await fetchPointReferences(point, key, async (url, options) => {
    calls.push({ url, options }); return fixtures(url);
  });
  assert.equal(calls.length, 2);
  const first = new URL(calls[0].url), second = new URL(calls[1].url);
  assert.equal(second.pathname, new URL(DSO_BASE).pathname + '/regelingen/_akn_nl_act_gm9999_2024_plan/regeltekstannotaties/_zoek');
  for (const { url, options } of calls) {
    assert.ok(url.startsWith(DSO_BASE + '/'));
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers['x-api-key'], key); assert.equal(options.headers.Accept, 'application/hal+json');
    assert.equal(options.headers['Content-Crs'], 'http://www.opengis.net/def/crs/EPSG/0/28992');
    assert.deepEqual(JSON.parse(options.body), { geometrie: { type: 'Point', coordinates: [176000.123, 318000.568] } });
    const params = new URL(url).searchParams;
    for (const name of ['geldigOp', 'inWerkingOp', 'beschikbaarOp']) assert.equal(params.get(name), first.searchParams.get(name));
    assert.equal(params.get('locatieSelectie'), 'primair');
  }
  assert.equal(first.searchParams.get('_expand'), 'true'); assert.equal(first.searchParams.get('page'), '1');
  assert.equal(result.complete, true); assert.equal(result.scope, 'clicked point');
  const item = result.instruments[0];
  assert.equal(item.specificRuleCount, 2); assert.equal(item.authorityWideRuleCount, 1);
  assert.deepEqual(item.areas.map(area => area.name), ['Specific test area', 'Test group']);
  assert.deepEqual(item.designations.map(area => area.name), ['Bouwgebied']);
  assert.deepEqual(item.activities, ['Bouwen']);
  assert.deepEqual(item.topics.map(theme => theme.name), ['bouwen', 'water']);
  assert.equal(item.ruleReferences[0].article, 'gm9999_1__art_2');
  assert.equal(item.ruleReferences[2].scope, 'authority-wide');
  assert.equal(item.document.effectiveFrom, '2026-01-01');
  assert.ok(!JSON.stringify(result).includes(key)); assert.ok(!JSON.stringify(result).includes('Not selected'));
});

test('keeps municipality, province and water representatives before a second municipal plan, reports omitted documents', async () => {
  const docs = [document('municipal1'), document('municipal2'), document('municipal3'),
    document('province', 'Omgevingsverordening'), document('water', 'Waterschapsverordening'), document('policy', 'Omgevingsvisie')];
  const result = await fetchPointReferences(point, key, fetchFixture(docs));
  assert.deepEqual(result.instruments.map(item => item.document.title), ['Fixture municipal1', 'Fixture province', 'Fixture water', 'Fixture municipal2']);
  assert.equal(result.complete, false); assert.match(result.warnings.join(' '), /1 regulations were omitted/);
});

test('missing or unresolved selected locations never create specific or broad evidence', async () => {
  for (const change of [data => { delete data.geselecteerdeLocatieRefs; }, data => { data.geselecteerdeLocatieRefs = ['missing']; data.regelsVoorIedereen[0].locatieRefs = ['missing']; }, data => { data.locaties.forEach(item => { item.locatieType = 'Unknown'; }); }]) {
    const result = await fetchPointReferences(point, key, fetchFixture(undefined, () => { const data = annotations(); change(data); return data; }));
    const item = result.instruments[0];
    assert.equal(result.complete, false); assert.equal(item.complete, false); assert.ok(item.error);
    assert.equal(item.specificRuleCount, 0); assert.equal(item.authorityWideRuleCount, 0);
    assert.deepEqual(item.areas, []); assert.deepEqual(item.ruleReferences, []); assert.ok(item.warnings.length);
  }
});

test('mixed confirmed and unresolved locations remain partial and retain only verified reference scope', async () => {
  const result = await fetchPointReferences(point, key, fetchFixture(undefined, () => {
    const data = annotations(); data.geselecteerdeLocatieRefs.push('missing');
    data.regelsVoorIedereen.push({ identificatie: 'unknown-rule', locatieRefs: ['missing'], themas: ['unverified'] });
    return data;
  }));
  const item = result.instruments[0];
  assert.equal(result.complete, false); assert.equal(item.error, undefined);
  assert.equal(item.unconfirmedRuleCount, 1); assert.equal(item.specificRuleCount, 2);
  assert.ok(!item.ruleReferences.some(ref => ref.id === 'unknown-rule'));
  assert.ok(!item.topics.some(theme => theme.name === 'unverified'));
});

test('an unavailable or oversized annotation instrument is retained explicitly and cannot echo provider error bodies', async () => {
  const docs = [document('plan'), document('province', 'Omgevingsverordening')];
  for (const failure of [() => new Response(`private error ${key}`, { status: 403 }), () => new Response('{}', { headers: { 'content-length': '4000001' } })]) {
    const result = await fetchPointReferences(point, key, async url => {
      if (url.includes('/regelingen/_zoek?')) return Response.json(discovery(docs));
      return url.includes('_province/') ? failure() : Response.json(annotations());
    });
    assert.equal(result.complete, false); assert.equal(result.instruments.length, 2);
    assert.ok(result.instruments[1].error); assert.equal(result.instruments[1].complete, false);
    assert.ok(!JSON.stringify(result).includes(key)); assert.ok(!JSON.stringify(result).includes('private error'));
  }
});

test('pagination is bounded and follows only generated official paths, never external next links', async () => {
  const calls = [];
  const result = await fetchPointReferences(point, key, async url => {
    calls.push(url); return Response.json(discovery([document('plan')], 'https://attacker.invalid/private?api-key=secret'));
  });
  assert.equal(calls.filter(url => url.includes('/regelingen/_zoek?')).length, 3);
  assert.ok(calls.every(url => url.startsWith(DSO_BASE + '/')));
  assert.equal(result.complete, false); assert.match(result.warnings.join(' '), /pagination limit/);
});

test('an empty discovery is unverified, invalid regulation identifiers are skipped without an arbitrary request', async () => {
  const empty = await fetchPointReferences(point, key, fetchFixture([]));
  assert.equal(empty.complete, false); assert.deepEqual(empty.instruments, []); assert.match(empty.warnings.join(' '), /unverified/);
  let calls = 0;
  const invalid = await fetchPointReferences(point, key, async () => {
    calls++; return Response.json(discovery([{ ...document('bad'), identificatie: 'https://attacker.invalid/../secret' }]));
  });
  assert.equal(calls, 1); assert.equal(invalid.complete, false); assert.deepEqual(invalid.instruments, []);
});

test('invalid coordinates, nonfinite values and missing keys are rejected before network', async () => {
  let calls = 0; const never = () => { calls++; throw new Error('unexpected'); };
  for (const input of [{ x: NaN, y: 318000 }, { x: Infinity, y: 318000 }, { x: 176000, y: 0 }, { x: 310001, y: 318000 }, { x: null, y: 318000 }, { x: '176000', y: 318000 }]) {
    await assert.rejects(fetchPointReferences(input, key, never), error => error instanceof DSOReferenceError && error.status === 400);
  }
  await assert.rejects(fetchPointReferences(point, '', never), error => error.code === 'dso_key_missing');
  assert.equal(calls, 0);
});

test('discovery byte limit rejects streamed payloads and cancels the reader', async () => {
  let cancelled = false;
  const response = { ok: true, headers: new Headers(), body: { getReader: () => ({
    read: async () => ({ value: new Uint8Array(4_000_001), done: false }), cancel: async () => { cancelled = true; }
  }) } };
  await assert.rejects(fetchPointReferences(point, key, async () => response), error => error.code === 'dso_response_limit');
  assert.equal(cancelled, true);
});
