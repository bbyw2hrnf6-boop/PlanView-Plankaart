/** Bounded DSO annotation summaries for point reviews. No geometry or AI calls. */
import { DSO_BASE } from './rule-sources.mjs';

const RD_CRS = 'http://www.opengis.net/def/crs/EPSG/0/28992';
const LEGAL_TYPES = ['Omgevingsplan', 'Omgevingsverordening', 'Waterschapsverordening'];
// Presenteren v8 LocatieType enum (official OpenAPI 8.2.5).
const LOCATION_TYPES = new Set(['Gebied', 'Lijn', 'Punt', 'Gebiedengroep', 'Lijnengroep', 'Puntengroep', 'Ambtsgebied']);
const MAX_PAGES = 3, MAX_BYTES = 4_000_000;
const string = (value, max = 300) => typeof value === 'string' ? value.slice(0, max) : '';
const value = item => item && typeof item === 'object' ? string(item.waarde) : string(item);
const objects = items => Array.isArray(items) ? items.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
const strings = items => Array.isArray(items) ? items.filter(item => typeof item === 'string') : [];
const unique = items => [...new Set(items)];

export class DSOReferenceError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function safeOfficialURL(input) {
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && (url.hostname === 'overheid.nl' || url.hostname.endsWith('.overheid.nl')) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function regulationPath(id) {
  if (!/^\/akn\/nl\/act\/[A-Za-z0-9_-]+\/\d{4}\/[A-Za-z0-9_.;-]{1,220}$/.test(id)) throw new DSOReferenceError(502, 'invalid_dso_regulation');
  return id.replace(/[\/-]/g, '_');
}

function documentSummary(item) {
  const id = string(item.identificatie || item.uriIdentificatie || item.id);
  regulationPath(id);
  const authority = item.aangeleverdDoorEen || {}, registered = item.geregistreerdMet || {};
  return {
    id, title: string(item.citeerTitel || item.officieleTitel || item.opschrift || item.titel || id),
    type: value(item.type), authority: string(authority.naam, 150),
    effectiveFrom: string(registered.beginInwerking, 50),
    sourceUrl: safeOfficialURL(item.publicatieID || item.url || item.publicatieUrl || item._links?.publicatie?.href)
  };
}

function summarize(document, response) {
  const warnings = [], selected = new Set(strings(response.geselecteerdeLocatieRefs));
  const locations = new Map(objects(response.locaties).filter(item => typeof item.identificatie === 'string').map(item => [item.identificatie, item]));
  // A selected ID with no corresponding location cannot establish specific or authority-wide scope.
  const confirmed = new Set([...selected].filter(id => LOCATION_TYPES.has(locations.get(id)?.locatieType)));
  if (!selected.size) warnings.push('Selected point location references were not returned.');
  if (confirmed.size !== selected.size) warnings.push('Some selected location references have no confirmed location type.');
  const areas = [...confirmed].filter(id => locations.get(id).locatieType !== 'Ambtsgebied').map(id => {
    const item = locations.get(id);
    return { name: string(item.noemer || item.locatieType, 160), type: string(item.locatieType, 50), id: string(id, 180) };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const matched = refs => strings(refs).filter(id => confirmed.has(id));
  const designations = objects(response.gebiedsaanwijzingen).filter(item => matched(item.locatieRefs).length).map(item => ({
    name: string(item.naam, 160), group: value(item.groep).slice(0, 100), id: string(item.identificatie, 180)
  }));
  const texts = new Map(objects(response.regelteksten).map(item => [item.identificatie, string(item.wId, 160)]));
  const themes = new Map(), references = [], activityRefs = new Set();
  let specific = 0, broad = 0, unconfirmed = 0;
  for (const item of objects(response.regelsVoorIedereen)) {
    const refs = strings(item.locatieRefs), selectedRefs = refs.filter(id => selected.has(id));
    const verifiedRefs = matched(refs);
    if (!verifiedRefs.length) { if (selectedRefs.length) unconfirmed++; continue; }
    const isSpecific = verifiedRefs.some(id => locations.get(id).locatieType !== 'Ambtsgebied');
    if (isSpecific) specific++; else broad++;
    const names = unique((Array.isArray(item.themas) ? item.themas : []).map(value).filter(Boolean).map(item => item.slice(0, 80)));
    for (const name of names) {
      const tally = themes.get(name) || { name, broad: 0, specific: 0 };
      tally[isSpecific ? 'specific' : 'broad']++; themes.set(name, tally);
    }
    for (const activity of objects(item.activiteitLocatieaanduidingen)) if (typeof activity.activiteitRef === 'string') activityRefs.add(activity.activiteitRef);
    if (references.length < 16) references.push({
      id: string(item.identificatie, 180), article: texts.get(item.regeltekstRef) || '',
      themes: names.slice(0, 4), scope: isSpecific ? 'specific-area' : 'authority-wide'
    });
  }
  const priority = /bouw|woon|recrea|camp|chalet|water|grond|natuur|geluid|erfgoed/i;
  const activities = unique(objects(response.activiteiten).filter(item => activityRefs.has(item.identificatie)).map(item => string(item.naam, 160)).filter(Boolean))
    .sort((a, b) => Number(priority.test(b)) - Number(priority.test(a)) || a.localeCompare(b));
  return {
    document, areas: areas.slice(0, 20), designations: designations.slice(0, 16),
    topics: [...themes.values()].sort((a, b) => b.specific - a.specific || b.broad - a.broad || a.name.localeCompare(b.name)).slice(0, 12),
    activities: activities.slice(0, 12), ruleReferences: references,
    specificRuleCount: specific, authorityWideRuleCount: broad, unconfirmedRuleCount: unconfirmed,
    complete: warnings.length === 0, warnings,
    ...(!confirmed.size ? { error: 'Point-specific location references unavailable' } : {}),
    source: 'DSO Presenteren v8 · point-filtered annotations'
  };
}

async function officialJSON(path, key, body, fetcher, deadline) {
  if (Date.now() >= deadline) throw new DSOReferenceError(502, 'dso_reference_timeout');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(15_000, deadline - Date.now())));
  try {
    const response = await fetcher(DSO_BASE + path, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/hal+json', 'Content-Type': 'application/json', 'Content-Crs': RD_CRS, 'x-api-key': key },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new DSOReferenceError(502, 'dso_references_unavailable');
    if (Number(response.headers?.get?.('content-length') || 0) > MAX_BYTES) throw new DSOReferenceError(502, 'dso_response_limit');
    let raw;
    if (response.body?.getReader) {
      const reader = response.body.getReader(), chunks = []; let size = 0;
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new DSOReferenceError(502, 'dso_response_limit'); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      raw = new TextDecoder().decode(bytes);
    } else {
      raw = await response.text();
      if (new TextEncoder().encode(raw).length > MAX_BYTES) throw new DSOReferenceError(502, 'dso_response_limit');
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new DSOReferenceError(502, 'invalid_dso_response');
    return parsed;
  } catch (error) {
    if (error instanceof DSOReferenceError) throw error;
    throw new DSOReferenceError(502, 'dso_references_unavailable');
  } finally { clearTimeout(timer); }
}

export async function fetchPointReferences(point, key, fetcher = fetch) {
  const x = point?.x, y = point?.y;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -10_000 || x > 310_000 || y < 300_000 || y > 640_000) throw new DSOReferenceError(400, 'invalid_dso_point');
  if (typeof key !== 'string' || key.length < 8) throw new DSOReferenceError(409, 'dso_key_missing');
  const now = new Date(), checkedAt = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const asOf = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const temporal = { geldigOp: asOf, inWerkingOp: asOf, beschikbaarOp: checkedAt }, deadline = Date.now() + 30_000;
  const body = { geometrie: { type: 'Point', coordinates: [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000] } };
  const documents = new Map(), warnings = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({ ...temporal, _expand: 'true', locatieSelectie: 'primair', size: '100', page: String(page) });
    const data = await officialJSON(`/regelingen/_zoek?${params}`, key, body, fetcher, deadline);
    if (!Array.isArray(data._embedded?.regelingen)) throw new DSOReferenceError(502, 'invalid_dso_response');
    const records = objects(data._embedded.regelingen);
    if (records.length > 100) throw new DSOReferenceError(502, 'dso_response_limit');
    for (const record of records) {
      if (!LEGAL_TYPES.includes(value(record.type))) continue;
      try { const document = documentSummary(record); if (!documents.has(document.id)) documents.set(document.id, document); }
      catch { warnings.push('An official regulation identifier could not be safely resolved.'); }
    }
    // The external next URL is only a pagination signal; never follow its host/path.
    if (!data._links?.next?.href) break;
    if (page === MAX_PAGES) warnings.push('Official document discovery reached its pagination limit.');
  }
  const available = [...documents.values()], selected = [];
  for (const type of LEGAL_TYPES) { const document = available.find(item => item.type === type); if (document) selected.push(document); }
  const extraMunicipal = available.find(item => item.type === 'Omgevingsplan' && !selected.includes(item));
  if (extraMunicipal) selected.push(extraMunicipal);
  if (available.length > selected.length) warnings.push(`${available.length - selected.length} regulations were omitted by the representative instrument limit.`);
  if (!selected.length) warnings.push('No municipal, provincial or water regulation was returned; applicability remains unverified.');
  const instruments = [];
  for (const document of selected) {
    try {
      const params = new URLSearchParams({ ...temporal, locatieSelectie: 'primair' });
      const response = await officialJSON(`/regelingen/${regulationPath(document.id)}/regeltekstannotaties/_zoek?${params}`, key, body, fetcher, deadline);
      instruments.push(summarize(document, response));
    } catch {
      instruments.push({ document, areas: [], designations: [], topics: [], activities: [], ruleReferences: [], specificRuleCount: 0,
        authorityWideRuleCount: 0, complete: false, error: 'Point-specific annotations unavailable' });
    }
  }
  return { instruments, checkedAt, scope: 'clicked point', complete: warnings.length === 0 && instruments.every(item => item.complete), warnings,
    source: 'DSO Omgevingsdocumenten Presenteren v8 · point references' };
}
