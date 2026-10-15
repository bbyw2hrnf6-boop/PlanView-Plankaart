"""Local-only DSO/RP credentials and small, fixed-host source queries.

No user-supplied URL is accepted. Credentials never enter HTML or JSON responses.
"""
import json
import os
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CONFIG_DIR = Path.home() / 'Library' / 'Application Support' / 'PlanView'
CONFIG_FILE = CONFIG_DIR / 'credentials.json'
DSO_BASE = 'https://service.omgevingswet.overheid.nl/publiek/omgevingsdocumenten/api/presenteren/v8'
GEOMETRY_BASE = 'https://service.omgevingswet.overheid.nl/publiek/omgevingsdocumenten/api/geometrieopvragen/v1'
RP_BASE = 'https://ruimte.omgevingswet.overheid.nl/ruimtelijke-plannen/api/opvragen/v4'
RD_CRS = 'http://www.opengis.net/def/crs/EPSG/0/28992'
KEY_NAMES = ('dso', 'rp', 'openai')


def credentials():
    try:
        data = json.loads(CONFIG_FILE.read_text(encoding='utf-8'))
        return {name: value for name in KEY_NAMES
                if isinstance((value := data.get(name)), str) and value}
    except (OSError, ValueError, AttributeError):
        return {}


def configured():
    data = credentials()
    return {name: bool(data.get(name)) for name in KEY_NAMES}


def save_credentials(updates):
    current = credentials()
    for name in KEY_NAMES:
        value = updates.get(name)
        if value is None:
            continue
        if not isinstance(value, str):
            raise ValueError('Invalid credential value')
        value = value.strip()
        if value and (len(value) < 8 or len(value) > (512 if name == 'openai' else 256) or not re.fullmatch(r'[A-Za-z0-9_.~+/-]+', value)):
            raise ValueError('Invalid credential format')
        if value:
            current[name] = value
        else:
            current.pop(name, None)
    CONFIG_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(CONFIG_DIR, 0o700)
    fd, temp_name = tempfile.mkstemp(prefix='.credentials-', dir=CONFIG_DIR)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(current, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temp_name, 0o600)
        os.replace(temp_name, CONFIG_FILE)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
    return configured()


def fetch_json(url, key, *, payload=None, crs=False, accept='application/json', max_bytes=2_000_000):
    headers = {'x-api-key': key, 'Accept': accept, 'User-Agent': 'PlanView-local/1.0'}
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    if crs:
        headers['Content-crs'] = RD_CRS
    request = urllib.request.Request(url, data=json.dumps(payload).encode() if payload is not None else None,
                                     headers=headers, method='POST' if payload is not None else 'GET')
    with urllib.request.urlopen(request, timeout=16) as response:
        raw = response.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise ValueError('Official response too large')
    return json.loads(raw)


def _records(value, collection):
    if isinstance(value, dict):
        embedded = value.get('_embedded', {})
        for candidate in (embedded.get(collection) if isinstance(embedded, dict) else None,
                          value.get(collection), value.get('results'), value.get('items')):
            if isinstance(candidate, list):
                return [item for item in candidate if isinstance(item, dict)]
        if value.get('identificatie') or value.get('officieleTitel'):
            return [value]
    elif isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    return []


def _safe_url(value):
    if not isinstance(value, str):
        return None
    parsed = urllib.parse.urlsplit(value)
    return value if parsed.scheme == 'https' and parsed.hostname and parsed.hostname.endswith('.overheid.nl') else None


def dso_point(x, y):
    key = credentials().get('dso')
    if not key:
        raise PermissionError('DSO production key not configured')
    if not (130000 <= x <= 240000 and 280000 <= y <= 440000):
        raise ValueError('Point outside Limburg search range')
    body = {'geometrie': {'type': 'Point', 'coordinates': [round(x, 3), round(y, 3)]}}
    result = fetch_json(f'{DSO_BASE}/regelingen/_zoek?_expand=true&locatieSelectie=primair&size=100',
                        key, payload=body, crs=True,
                        accept='application/hal+json')
    docs = []
    areas = []
    for item in _records(result, 'regelingen')[:100]:
        ident = item.get('identificatie') or item.get('uriIdentificatie') or item.get('id')
        title = item.get('officieleTitel') or item.get('opschrift') or item.get('titel') or ident
        if not isinstance(ident, str) or not ident:
            continue
        authority = item.get('aangeleverdDoorEen') or {}
        if not isinstance(authority, dict):
            authority = {}
        kind = item.get('type') or {}
        if not isinstance(kind, dict):
            kind = {}
        registered = item.get('geregistreerdMet') or {}
        if not isinstance(registered, dict):
            registered = {}
        links = item.get('_links') if isinstance(item.get('_links'), dict) else {}
        public = item.get('url') or item.get('publicatieUrl') or (links.get('publicatie', {}) or {}).get('href')
        docs.append({'id': ident[:300], 'title': str(title or ident)[:300],
                     'type': str(kind.get('waarde') or 'Omgevingsdocument')[:100],
                     'authority': str(authority.get('naam') or '')[:150],
                     'authorityCode': str(authority.get('code') or '')[:30],
                     'effectiveFrom': str(registered.get('beginInwerking') or '')[:50],
                     'sourceUrl': _safe_url(public)})
        # Presenteren v8 embeds the regulation area when _expand=true. It does not
        # expose the old /locatieidentificaties/_zoek endpoint. Only show a local
        # Omgevingsplan extent; broader visions/AMvBs are contextual documents.
        if kind.get('waarde') == 'Omgevingsplan' and authority.get('bestuurslaag') == 'gemeente':
            embedded = item.get('_embedded') or {}
            area = embedded.get('regelingsgebied') if isinstance(embedded, dict) else None
            if isinstance(area, dict):
                geo_id = area.get('geometrieIdentificatie')
                if isinstance(geo_id, str) and re.fullmatch(r'[A-Za-z0-9_\-]{8,100}', geo_id):
                    areas.append({'geometryId': geo_id, 'locationId': str(area.get('identificatie') or '')[:200],
                                  'name': str(area.get('noemer') or title)[:200] + ' · Omgevingsplan extent',
                                  'documentIds': [ident]})
    return {'documents': docs, 'areas': areas,
            'source': 'DSO Omgevingsdocumenten Presenteren v8', 'complete': True}


# Small, short-lived cache: clicking the same point or opening a search result
# should not fetch all three official instruments again.
_rules_cache = {}
_RULES_TTL = 600
_LEGAL_TYPES = ('Omgevingsplan', 'Omgevingsverordening', 'Waterschapsverordening')


def _value(item):
    return item.get('waarde', '') if isinstance(item, dict) else str(item or '')


def _summarize_rules(document, response):
    selected = set(response.get('geselecteerdeLocatieRefs') or [])
    locations = {item.get('identificatie'): item for item in response.get('locaties', [])
                 if isinstance(item, dict) and item.get('identificatie')}
    areas = []
    for ref in selected:
        item = locations.get(ref, {})
        if item.get('locatieType') != 'Ambtsgebied':
            areas.append({'name': str(item.get('noemer') or item.get('locatieType') or '')[:160],
                          'type': str(item.get('locatieType') or '')[:50], 'id': ref[:180]})
    areas.sort(key=lambda area: area['name'])
    designations = []
    for item in response.get('gebiedsaanwijzingen', []):
        if not isinstance(item, dict) or not selected.intersection(item.get('locatieRefs') or []):
            continue
        designations.append({'name': str(item.get('naam') or '')[:160],
                             'group': str(_value(item.get('groep')))[:100],
                             'id': str(item.get('identificatie') or '')[:180]})
    rule_texts = {item.get('identificatie'): item.get('wId') for item in response.get('regelteksten', [])
                  if isinstance(item, dict)}
    theme_counts = {}
    references = []
    activity_refs = set()
    broad_count = specific_count = 0
    for item in response.get('regelsVoorIedereen', []):
        if not isinstance(item, dict) or not selected.intersection(item.get('locatieRefs') or []):
            continue
        specific = any(locations.get(ref, {}).get('locatieType') != 'Ambtsgebied'
                       for ref in item.get('locatieRefs') or [] if ref in selected)
        if specific:
            specific_count += 1
        else:
            broad_count += 1
        themes = [str(_value(value))[:80] for value in item.get('themas') or [] if _value(value)]
        for theme in themes:
            tally = theme_counts.setdefault(theme, {'name': theme, 'broad': 0, 'specific': 0})
            tally['specific' if specific else 'broad'] += 1
        for activity in item.get('activiteitLocatieaanduidingen') or []:
            if isinstance(activity, dict) and activity.get('activiteitRef'):
                activity_refs.add(activity['activiteitRef'])
        if len(references) < 16:
            references.append({'id': str(item.get('identificatie') or '')[:180],
                               'article': str(rule_texts.get(item.get('regeltekstRef')) or '')[:160],
                               'themes': themes[:4], 'scope': 'specific-area' if specific else 'authority-wide'})
    activities = []
    for item in response.get('activiteiten') or []:
        if isinstance(item, dict) and item.get('identificatie') in activity_refs:
            activities.append(str(item.get('naam') or '')[:160])
    priority = re.compile(r'bouw|woon|recrea|camp|chalet|water|grond|natuur|geluid|erfgoed', re.I)
    activities.sort(key=lambda value: (not bool(priority.search(value)), value))
    return {'document': document, 'areas': areas[:20], 'designations': designations[:16],
            'topics': sorted(theme_counts.values(), key=lambda item: (-item['specific'], -item['broad']))[:12],
            'activities': activities[:12], 'ruleReferences': references,
            'specificRuleCount': specific_count, 'authorityWideRuleCount': broad_count,
            'source': 'DSO Presenteren v8 · point-filtered annotations'}


def dso_rules_point(x, y):
    key = credentials().get('dso')
    if not key:
        raise PermissionError('DSO production key not configured')
    if not (130000 <= x <= 240000 and 280000 <= y <= 440000):
        raise ValueError('Point outside Limburg search range')
    cache_key = (round(x, 1), round(y, 1))
    hit = _rules_cache.get(cache_key)
    if hit and time.monotonic() - hit[0] < _RULES_TTL:
        return hit[1]
    body = {'geometrie': {'type': 'Point', 'coordinates': [round(x, 3), round(y, 3)]}}
    documents = [doc for doc in dso_point(x, y)['documents'] if doc['type'] in _LEGAL_TYPES]
    # Keep the municipal, provincial and water instruments represented even if
    # the point search returns several versions of one instrument first.
    documents = ([next((doc for doc in documents if doc['type'] == kind), None)
                  for kind in _LEGAL_TYPES] +
                 [doc for doc in documents if doc['type'] == 'Omgevingsplan'][1:2])
    documents = [doc for doc in documents if doc is not None]
    instruments = []
    for doc in documents[:4]:
        uri_id = re.sub(r'[^A-Za-z0-9]+', '_', doc['id']).strip('_')
        try:
            result = fetch_json(f'{DSO_BASE}/regelingen/_{uri_id}/regeltekstannotaties/_zoek?locatieSelectie=primair',
                                key, payload=body, crs=True, accept='application/hal+json', max_bytes=4_000_000)
            instruments.append(_summarize_rules(doc, result))
        except (urllib.error.HTTPError, urllib.error.URLError, OSError, ValueError):
            instruments.append({'document': doc, 'error': 'Point-specific annotations unavailable'})
    response = {'instruments': instruments, 'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'scope': 'clicked point', 'complete': all('error' not in item for item in instruments)}
    if len(_rules_cache) >= 256:
        _rules_cache.clear()
    _rules_cache[cache_key] = (time.monotonic(), response)
    return response


def dso_geometry(geometry_id):
    key = credentials().get('dso')
    if not key:
        raise PermissionError('DSO production key not configured')
    if not re.fullmatch(r'[A-Za-z0-9_\-]{8,100}', geometry_id or ''):
        raise ValueError('Invalid geometry ID')
    url = f'{GEOMETRY_BASE}/geometrieen/{geometry_id}?crs={urllib.parse.quote(RD_CRS, safe="")}'
    value = fetch_json(url, key)
    geometry = value.get('geometry', value) if isinstance(value, dict) else None
    if not isinstance(geometry, dict) or geometry.get('type') not in ('Polygon', 'MultiPolygon', 'LineString', 'MultiLineString', 'Point'):
        raise ValueError('Unexpected geometry response')
    return {'geometry': geometry, 'crs': 'EPSG:28992', 'id': geometry_id}


def rp_plan(plan_id):
    key = credentials().get('rp')
    if not key:
        raise PermissionError('Ruimtelijke plannen V4 key not configured')
    if not re.fullmatch(r'NL\.IMRO\.[A-Za-z0-9.\-]{4,120}', plan_id or ''):
        raise ValueError('Invalid IMRO ID')
    result = fetch_json(f'{RP_BASE}/plannen/{urllib.parse.quote(plan_id, safe="")}', key,
                        accept='application/hal+json')
    if not isinstance(result, dict):
        raise ValueError('Unexpected plan response')
    return {'id': str(result.get('identificatie') or plan_id)[:200],
            'title': str(result.get('naam') or result.get('titel') or '')[:300],
            'type': str(result.get('typePlan') or result.get('typeplan') or '')[:100],
            'status': str(result.get('planstatus') or result.get('dossierstatus') or '')[:100],
            'date': str(result.get('datum') or '')[:50],
            'source': 'Ruimtelijke plannen V4'}
