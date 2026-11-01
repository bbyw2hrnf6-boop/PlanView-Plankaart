/* Whole-parcel screening against PDOK BRK, BAG and Natura 2000.
 * WGS84 GeoJSON in/out. Areas and distances are screening measurements, not
 * cadastral boundary surveys. Topology: vendored polygon-clipping 0.15.7 (MIT).
 */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./vendor/polygon-clipping.umd.min.js') : root.polygonClipping);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlanViewParcelScreen = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (clip) {
  'use strict';
  const endpoints = Object.freeze({
    parcel: 'https://api.pdok.nl/kadaster/brk-kadastrale-kaart/ogc/v1/collections/perceel',
    buildings: 'https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand',
    natura2000: 'https://api.pdok.nl/rvo/natura2000/ogc/v1/collections/natura2000'
  });
  const rad = Math.PI / 180, earth = 6371008.8;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const aborted = signal => { if (signal?.aborted) { const error = new Error('Screening cancelled'); error.name = 'AbortError'; throw error; } };
  const geometryOf = feature => feature?.type === 'Feature' ? feature.geometry : feature;
  function polygons(input) {
    const g = geometryOf(input), value = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : null;
    if (!Array.isArray(value) || !value.length || !value.every(polygon => Array.isArray(polygon) && polygon.length && polygon.every(ring => Array.isArray(ring) && ring.length >= 4 && ring.every(p => Array.isArray(p) && finite(p[0]) && finite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)))) throw new Error('Invalid WGS84 polygon geometry');
    return value;
  }
  function bbox(input) {
    const result = [Infinity, Infinity, -Infinity, -Infinity];
    for (const polygon of polygons(input)) for (const ring of polygon) for (const p of ring) {
      result[0] = Math.min(result[0], p[0]); result[1] = Math.min(result[1], p[1]);
      result[2] = Math.max(result[2], p[0]); result[3] = Math.max(result[3], p[1]);
    }
    return result;
  }
  function onSegment(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    if (!length) return Math.hypot(p[0] - a[0], p[1] - a[1]) < 1e-10;
    return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / length < 1e-10 && p[0] >= Math.min(a[0], b[0]) - 1e-10 && p[0] <= Math.max(a[0], b[0]) + 1e-10 && p[1] >= Math.min(a[1], b[1]) - 1e-10 && p[1] <= Math.max(a[1], b[1]) + 1e-10;
  }
  // 0 outside, 1 strict interior, 2 boundary. Holes never count as parcel land.
  function ringRelation(p, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i]; if (onSegment(p, a, b)) return 2;
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside ? 1 : 0;
  }
  function pointRelation(point, input) {
    const p = Array.isArray(point) ? point : [point.lng, point.lat]; let boundary = false;
    for (const polygon of polygons(input)) {
      const outer = ringRelation(p, polygon[0]); if (outer === 2) { boundary = true; continue; } if (!outer) continue;
      let inHole = false;
      for (const hole of polygon.slice(1)) { const relation = ringRelation(p, hole); if (relation === 2) boundary = true; if (relation) inHole = true; }
      if (!inHole) return 1;
    }
    return boundary ? 2 : 0;
  }
  function areaCoordinates(coords) {
    let result = 0;
    for (const polygon of coords) for (let r = 0; r < polygon.length; r++) {
      const ring = polygon[r]; let sum = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += (ring[i][0] - ring[j][0]) * rad * (2 + Math.sin(ring[j][1] * rad) + Math.sin(ring[i][1] * rad));
      result += (r ? -1 : 1) * Math.abs(sum * earth * earth / 2);
    }
    return Math.max(0, result);
  }
  const area = input => areaCoordinates(polygons(input));
  function intersectionArea(a, b) { return areaCoordinates(clip.intersection(polygons(a), polygons(b))); }
  function overlap(parcel, features) {
    let merged = [], complete = true; const ids = []; let count = 0;
    for (const feature of features || []) {
      try {
        const intersection = clip.intersection(polygons(parcel), polygons(feature));
        if (intersection.length) { merged = merged.length ? clip.union(merged, intersection) : intersection; ids.push(feature.id || feature.properties?.identificatie || feature.properties?.identificatie_lokaal_id || ''); count++; }
      } catch { complete = false; }
    }
    const areaM2 = areaCoordinates(merged), denominator = area(parcel);
    return { areaM2, coveragePct: denominator > 0 ? Math.min(100, areaM2 / denominator * 100) : null, count, ids, valid: complete };
  }
  function project(p, center) { return [(p[0] - center[0]) * rad * earth * Math.cos(center[1] * rad), (p[1] - center[1]) * rad * earth]; }
  function segments(input, center) {
    const out = [];
    for (const polygon of polygons(input)) for (const ring of polygon) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = project(ring[j], center), b = project(ring[i], center); if (a[0] !== b[0] || a[1] !== b[1]) out.push([a, b]); }
    return out;
  }
  function pointSegmentSquared(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0; return (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2; }
  function cross(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
  function segmentSquared(a, b, c, d) {
    if (Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <= Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) && Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <= Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) && cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0) return 0;
    return Math.min(pointSegmentSquared(a, c, d), pointSegmentSquared(b, c, d), pointSegmentSquared(c, a, b), pointSegmentSquared(d, a, b));
  }
  function distance(a, b) {
    const pa = polygons(a), pb = polygons(b);
    // Containment covers disjoint boundaries with overlapping interiors.
    if (pa.some(p => pointRelation(p[0][0], b)) || pb.some(p => pointRelation(p[0][0], a))) return 0;
    const bounds = bbox(a), center = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2], aa = segments(a, center), bb = segments(b, center); let minimum = Infinity;
    for (const [u, v] of aa) for (const [w, x] of bb) {
      // A segment-bbox lower bound avoids most expensive segment checks.
      const dx = Math.max(0, Math.min(u[0], v[0]) - Math.max(w[0], x[0]), Math.min(w[0], x[0]) - Math.max(u[0], v[0]));
      const dy = Math.max(0, Math.min(u[1], v[1]) - Math.max(w[1], x[1]), Math.min(w[1], x[1]) - Math.max(u[1], v[1]));
      if (dx * dx + dy * dy >= minimum) continue;
      minimum = Math.min(minimum, segmentSquared(u, v, w, x)); if (minimum === 0) return 0;
    }
    return Math.sqrt(minimum);
  }
  function expand(bounds, meters) {
    // Conservative pads throughout the Netherlands, including 50 km buffers.
    const dy = meters / 110000, maxLatitude = Math.max(Math.abs(bounds[1] - dy), Math.abs(bounds[3] + dy));
    const dx = meters / (110000 * Math.cos(maxLatitude * rad));
    return [bounds[0] - dx, bounds[1] - dy, bounds[2] + dx, bounds[3] + dy];
  }
  const sourceId = feature => String(feature.id ?? feature.properties?.identificatie ?? feature.properties?.identificatie_lokaal_id ?? '');
  function unknown(reason, source) { return { state: 'unknown', complete: false, reason, source }; }
  function createClient(settings = {}) {
    const requestFetch = settings.fetch || ((...args) => fetch(...args)), now = settings.now || (() => Date.now()), cache = new Map();
    const maxPages = settings.maxPages ?? 4, pageSize = settings.pageSize ?? 1000, timeoutMs = settings.timeoutMs ?? 15000, ttl = settings.cacheTtlMs ?? 600000;
    async function json(url, signal) {
      aborted(signal);
      const cached = cache.get(url); if (cached && now() - cached.time < ttl) return cached.value;
      const controller = new AbortController(), cancel = () => controller.abort(signal.reason), timer = setTimeout(() => controller.abort(), timeoutMs);
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        const response = await requestFetch(url, { signal: controller.signal, headers: { Accept: 'application/geo+json, application/json' } });
        if (!response.ok) throw new Error(`PDOK HTTP ${response.status}`);
        const length = Number(response.headers?.get?.('content-length') || 0); if (length > 40000000) throw new Error('PDOK response exceeds screening limit');
        const value = await response.json(); aborted(signal);
        cache.set(url, { time: now(), value }); if (cache.size > 100) cache.delete(cache.keys().next().value);
        return value;
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
    }
    async function collection(kind, signal) { try { const data = await json(endpoints[kind] + '?f=json', signal); return data.updated || null; } catch { return null; } }
    async function features(kind, bounds, signal) {
      const limit = kind === 'parcel' ? Math.min(pageSize, 100) : pageSize;
      const first = `${endpoints[kind]}/items?bbox=${bounds.join(',')}&limit=${limit}&f=json`, urls = [], out = [], seen = new Set();
      let next = first, complete = false, reason = '', responseTimestamp = null, expectedTotal = null, anonymousCount = 0;
      const featureIds = new Set();
      const updateTask = collection(kind, signal);
      for (let page = 0; next && page < maxPages; page++) {
        aborted(signal); if (seen.has(next)) { reason = 'repeated-page'; break; } seen.add(next); urls.push(next);
        let data;
        try { data = await json(next, signal); } catch (error) { aborted(signal); reason = error.message; break; }
        if (!Array.isArray(data.features)) { reason = 'invalid-response'; break; }
        out.push(...data.features); responseTimestamp = data.timeStamp || data.timestamp || responseTimestamp;
        for (const feature of data.features) { const id = sourceId(feature); if (id) featureIds.add(id); else anonymousCount++; }
        if (finite(data.numberMatched) && data.numberMatched >= 0) expectedTotal = Math.max(expectedTotal ?? 0, data.numberMatched);
        const link = data.links?.find(link => link.rel === 'next');
        if (link) {
          try { const url = new URL(link.href, next), allowed = new URL(endpoints[kind] + '/items'); if (url.origin !== allowed.origin || url.pathname !== allowed.pathname) throw new Error('invalid-next-link'); next = url.href; } catch { reason = 'invalid-next-link'; break; }
        } else {
          // An explicit total takes precedence over a short final page. Count
          // distinct features: repeated IDs across pages cannot fill a gap.
          complete = expectedTotal !== null ? featureIds.size + anonymousCount >= expectedTotal : data.features.length < limit;
          if (!complete) reason = expectedTotal !== null ? 'matched-count-incomplete' : 'page-limit-without-total'; next = null;
        }
      }
      if (next && !reason) reason = 'page-budget';
      const source = { dataset: kind === 'parcel' ? 'BRK Kadastrale Kaart' : kind === 'buildings' ? 'BAG pand' : 'Natura 2000 (RVO)', collectionUrl: endpoints[kind], url: first, urls, checkedAt: new Date(now()).toISOString(), updatedAt: await updateTask, responseTimestamp };
      const unique = [...new Map(out.map((feature, i) => [sourceId(feature) || `row:${i}`, feature])).values()];
      return { features: unique, complete, reason, source };
    }
    async function inspect(point, options = {}) {
      const signal = options.signal, evidence = { checkedAt: new Date(now()).toISOString(), parcel: unknown('not-checked'), buildings: unknown('parcel-unresolved'), envelope: unknown('parcel-unresolved'), natura2000: unknown('parcel-unresolved') };
      if (!finite(point?.lng) || !finite(point?.lat) || point.lng < 2 || point.lng > 9 || point.lat < 49 || point.lat > 55) { evidence.parcel = unknown('location-outside-screening-extent'); return evidence; }
      aborted(signal);
      let data;
      try { data = await features('parcel', expand([point.lng, point.lat, point.lng, point.lat], 1), signal); } catch (error) { aborted(signal); evidence.parcel = unknown(error.message); return evidence; }
      let invalid = false; const containing = [], boundary = [];
      for (const feature of data.features) { try { const relation = pointRelation(point, feature); if (relation === 1) containing.push(feature); if (relation === 2) boundary.push(feature); } catch { invalid = true; } }
      if (!data.complete || invalid || containing.length !== 1 || boundary.length) { evidence.parcel = unknown(!data.complete ? data.reason : invalid ? 'invalid-parcel-geometry' : boundary.length ? 'point-on-parcel-boundary' : containing.length > 1 ? 'ambiguous-parcel' : 'no-parcel-at-point', data.source); return evidence; }
      const feature = containing[0], p = feature.properties || {}, geometryAreaM2 = area(feature), registered = p.kadastrale_grootte_waarde;
      if (!(geometryAreaM2 > 0)) { evidence.parcel = unknown('zero-area-parcel', data.source); return evidence; }
      const parcel = evidence.parcel = { state: 'checked', complete: true, id: sourceId(feature), localId: p.identificatie_lokaal_id || null, label: [p.akr_kadastrale_gemeente_code_waarde, p.sectie, p.perceelnummer].filter(v => v != null).join(' '), geometry: feature.geometry, bbox: bbox(feature), areaM2: finite(registered) && registered > 0 ? registered : geometryAreaM2, geometryAreaM2, areaMethod: finite(registered) && registered > 0 ? 'registered' : 'geometry', registeredAt: p.tijdstip_registratie || p.begin_geldigheid || null, source: { ...data.source, featureId: sourceId(feature), featureUrl: `${endpoints.parcel}/items/${encodeURIComponent(sourceId(feature))}?f=json` } };
      const bounds = parcel.bbox, requested = options.criteria;
      const needBuildings = !requested || finite(requested.maxBuildingCoveragePercent);
      const needEnvelope = !requested || finite(requested.minEnvelopeAreaM2) || finite(requested.minEnvelopePercent);
      const needNatura = !requested || requested.excludeNatura2000 === true || finite(requested.minNaturaDistanceKm);
      const buildingTask = (async () => {
        if (!needBuildings) return unknown('not-requested');
        const result = await features('buildings', bounds, signal), eligible = []; let statusUnknown = false;
        for (const item of result.features) {
          const status = String(item.properties?.status || '').trim();
          // Completed, occupied, under construction and out-of-use footprints.
          if (/^(Pand in gebruik(?: \(niet ingemeten\))?|Bouw gestart|Pand buiten gebruik|Verbouwing pand)$/i.test(status)) eligible.push(item);
          else if (!/^(Pand gesloopt|Niet gerealiseerd pand|Bouwvergunning verleend|Pand ten onrechte opgevoerd)$/i.test(status)) statusUnknown = true;
        }
        const measured = overlap(feature, eligible), complete = result.complete && measured.valid && !statusUnknown;
        return { state: complete ? 'checked' : 'partial', complete, areaM2: measured.areaM2, coveragePct: measured.coveragePct, count: measured.count, ids: measured.ids, reason: result.reason || (!measured.valid ? 'invalid-building-geometry' : statusUnknown ? 'unknown-building-status' : ''), source: result.source };
      })();
      const envelopeTask = (async () => {
        if (!needEnvelope) return unknown('not-requested');
        const result = options.getEnvelopeFeatures ? await options.getEnvelopeFeatures(parcel) : { features: options.envelopeFeatures || [], complete: options.envelopeComplete === true, sourceUpdated: options.envelopeSourceUpdated };
        aborted(signal); const measured = overlap(feature, result?.features || []), complete = result?.complete === true && measured.valid;
        return { state: complete ? 'checked' : 'partial', complete, areaM2: measured.areaM2, coveragePct: measured.coveragePct, count: measured.count, sourceIds: measured.ids, reason: complete ? '' : 'incomplete-envelope-coverage', source: { dataset: 'PDOK Ruimtelijke plannen bouwvlak', url: result?.sourceUrl || 'https://service.pdok.nl/kadaster/ruimtelijke-plannen/wms/v1_0', updatedAt: result?.sourceUpdated || null, checkedAt: new Date(now()).toISOString(), planId: result?.sourceId || null } };
      })();
      const naturaTask = (async () => {
        if (!needNatura) return unknown('not-requested');
        const requested = options.criteria?.minNaturaDistanceKm;
        const radiusM = Math.max(1000, finite(requested) ? Math.min(50000, Math.max(0, requested) * 1000) : 0);
        // 1% plus one metre ensures complete data can establish the requested
        // minimum despite the local metric approximation at large distances.
        const guaranteedRadiusM = radiusM * 1.01 + 1, queryRadiusM = radiusM * 1.02 + 2, result = await features('natura2000', expand(bounds, queryRadiusM), signal);
        let minimum = Infinity, invalid = false; const areas = [];
        for (const item of result.features) {
          aborted(signal);
          try { const meters = distance(feature, item); if (!finite(meters)) throw new Error('Invalid distance'); minimum = Math.min(minimum, meters); areas.push({ id: sourceId(item), name: item.properties?.naam_n2k || 'Natura 2000', protection: item.properties?.beschermin || '', status: item.properties?.status || '', distanceM: meters, intersects: meters === 0, url: `${endpoints.natura2000}/items/${encodeURIComponent(sourceId(item))}?f=json` }); } catch { invalid = true; }
        }
        const complete = result.complete && !invalid, intersects = minimum === 0 ? true : complete ? false : null;
        // A returned area's distance is globally nearest only within the
        // completely queried radius. Otherwise record a lower bound.
        const exactWithinSearch = complete && minimum <= guaranteedRadiusM;
        return { state: complete ? 'checked' : 'partial', complete, coverage: 'Netherlands', intersects, minDistanceM: exactWithinSearch || minimum === 0 ? minimum : null, observedDistanceM: finite(minimum) ? minimum : null, distanceLowerBoundM: complete ? Math.min(guaranteedRadiusM, minimum) : null, searchRadiusM: guaranteedRadiusM, areas: areas.sort((a, b) => a.distanceM - b.distanceM), reason: result.reason || (invalid ? 'invalid-natura-geometry' : ''), source: result.source };
      })();
      const results = await Promise.allSettled([buildingTask, envelopeTask, naturaTask]); aborted(signal);
      for (let i = 0; i < results.length; i++) { const key = ['buildings', 'envelope', 'natura2000'][i], result = results[i]; evidence[key] = result.status === 'fulfilled' ? result.value : unknown(result.reason?.message || 'service-unavailable'); }
      return evidence;
    }
    return { inspect, clearCache: () => cache.clear() };
  }
  function evaluate(evidence, criteria = {}) {
    const checks = [], add = (key, status, actual, expected) => checks.push({ key, status, actual: actual ?? null, expected });
    const metric = (key, record, name, operator) => {
      const expected = criteria[key]; if (!finite(expected)) return;
      const actual = record?.[name], known = finite(actual), passed = known && (operator === 'min' ? actual >= expected : actual <= expected);
      // Incomplete intersection lists yield lower bounds: useful to pass a
      // minimum or fail a maximum, never the reverse.
      const status = !known ? 'unknown' : passed ? record.complete || operator === 'min' ? 'pass' : 'unknown' : record.complete || operator === 'max' ? 'fail' : 'unknown';
      add(key, status, actual, expected);
    };
    metric('parcelMinAreaM2', evidence?.parcel, 'areaM2', 'min'); metric('parcelMaxAreaM2', evidence?.parcel, 'areaM2', 'max');
    metric('minEnvelopeAreaM2', evidence?.envelope, 'areaM2', 'min'); metric('minEnvelopePercent', evidence?.envelope, 'coveragePct', 'min'); metric('maxBuildingCoveragePercent', evidence?.buildings, 'coveragePct', 'max');
    const nature = evidence?.natura2000;
    if (criteria.excludeNatura2000) add('excludeNatura2000', nature?.intersects === true ? 'fail' : nature?.intersects === false && nature.complete ? 'pass' : 'unknown', nature?.intersects, false);
    if (finite(criteria.minNaturaDistanceKm)) {
      const minimum = criteria.minNaturaDistanceKm * 1000, observed = nature?.observedDistanceM ?? nature?.minDistanceM, lower = nature?.distanceLowerBoundM;
      // Distances use a local projection. Keep a narrow uncertainty band near
      // non-zero thresholds instead of claiming survey-grade precision.
      const margin = Math.max(1, minimum * .005);
      const fail = finite(observed) && observed < minimum - margin || minimum > 0 && nature?.intersects === true;
      const pass = finite(lower) && lower >= minimum + margin || minimum === 0 && nature?.complete;
      add('minNaturaDistanceKm', fail ? 'fail' : pass ? 'pass' : 'unknown', finite(observed) ? observed / 1000 : finite(lower) ? lower / 1000 : null, criteria.minNaturaDistanceKm);
    }
    const failed = checks.filter(c => c.status === 'fail').map(c => c.key), missing = checks.filter(c => c.status === 'unknown').map(c => c.key);
    return { pass: !failed.length, status: failed.length ? 'fail' : missing.length ? 'unknown' : 'pass', failed, missing, unknown: missing, checks };
  }
  const client = createClient();
  return { inspect: client.inspect, clearCache: client.clearCache, evaluate, createClient, endpoints, geometry: { area, bbox, overlap, intersectionArea, distance, pointRelation } };
});
