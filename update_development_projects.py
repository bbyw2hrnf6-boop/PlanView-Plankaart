"""Normalize the public LMVW plan-point snapshot; preserve disclosed coverage gaps."""
import collections
import datetime as dt
import gzip
import json
import urllib.request
from pathlib import Path

BASE = 'https://www.nationalewoningbouwkaart.nl'
OUT = Path(__file__).resolve().parent / 'data' / 'development_projects.geojson'
PROVINCES = {'20': 'Groningen', '21': 'Fryslân', '22': 'Drenthe', '23': 'Overijssel',
             '24': 'Flevoland', '25': 'Gelderland', '26': 'Utrecht', '27': 'Noord-Holland',
             '28': 'Zuid-Holland', '29': 'Zeeland', '30': 'Noord-Brabant', '31': 'Limburg'}


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=60) as response:
        raw = response.read()
        modified = response.headers.get('Last-Modified')
    return json.loads(gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw), modified


projects, modified = get('/project2.json.gz')
municipalities, _ = get('/gemeente.json.gz')
by_name = {f['properties']['gemeente_naam'].casefold(): f['properties'] for f in municipalities['features']}
if "'s-gravenhage" in by_name:
    by_name['den haag'] = by_name["'s-gravenhage"]
features = []
seen = set()
unknown = []
for item in projects['features']:
    p = item['properties']
    identifier = str(p['project_id'])
    if identifier in seen:
        raise RuntimeError('Duplicate source project_id: ' + identifier)
    seen.add(identifier)
    municipality = p.get('gemeente_naam') or p.get('gemeente_name') or ''
    summary = by_name.get(municipality.casefold(), {})
    code = (p.get('gemeente_code') or summary.get('gemeente_code') or '').removeprefix('GM')
    province = p.get('provincie_naam') or summary.get('provincie_naam') or ''
    if province == 'Friesland':
        province = 'Fryslân'
    province_code = (p.get('provincie_code') or '').removeprefix('PV')
    if not province_code:
        province_code = next((c for c, n in PROVINCES.items() if n == province), '')
    if not province:
        unknown.append(identifier)
    if item.get('geometry', {}).get('type') != 'Point':
        raise RuntimeError('Unexpected geometry: ' + identifier)
    homes = p.get('Bruto Plancapaciteit')
    properties = {
        'id': 'lmvw-' + identifier,
        'sourceId': identifier,
        'name': p.get('naam') or p.get('Plannaam') or 'Unnamed housing plan',
        'municipality': municipality,
        'municipalityCode': code,
        'province': province,
        'provinceCode': province_code,
        'kind': 'housing project',
        'phase': p.get('Planstatus') or 'Not specified',
        'status': p.get('Planstatus') or None,
        'capacity': p.get('Netto Plancapaciteit'),
        'grossCapacity': homes,
        'netCapacity': p.get('Netto Plancapaciteit'),
        'peilmoment': p.get('peilmoment'),
        'sourceDate': p.get('peilmoment'),
        'locationAccuracy': 'Published project point; not a project boundary or building permission',
        'source': 'Nationale Woningbouwkaart / LMVW — Ministerie van BZK, ABF Research',
        'sourceUrl': BASE + '/',
        'sourceDataUrl': BASE + '/project2.json.gz',
        'sourceExplanationUrl': BASE + '/toelichting',
        'provinceDerivedFromMunicipalSummary': not bool(p.get('provincie_naam')),
    }
    if homes is not None:
        properties['homes'] = homes
    features.append({'type': 'Feature', 'id': 'lmvw-' + identifier,
                     'properties': properties, 'geometry': item['geometry']})

counts = collections.Counter(f['properties']['province'] for f in features)
missing = [name for name in PROVINCES.values() if not counts[name]]
payload = {
    'type': 'FeatureCollection',
    'metadata': {
        'source': 'Nationale Woningbouwkaart / Landelijke Monitor Voortgang Woningbouw',
        'sourceOwner': 'Ministerie van BZK; municipalities via provinces, processed by ABF Research',
        'sourceUrl': BASE + '/',
        'sourceDataUrl': BASE + '/project2.json.gz',
        'sourceExplanationUrl': BASE + '/toelichting',
        'retrieved': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'sourceLastModified': modified,
        'scope': 'Netherlands public housing-plan points where published; incomplete location inventory',
        'featureCount': len(features),
        'provincesExpected': list(PROVINCES.values()),
        'provinceCounts': {name: counts[name] for name in PROVINCES.values()},
        'provincesWithPublishedPoints': [name for name in PROVINCES.values() if counts[name]],
        'provincesWithoutPublishedPoints': missing,
        'unresolvedProvinceCount': len(unknown),
        'peilmomentCounts': dict(collections.Counter(f['properties']['peilmoment'] for f in features)),
        'limitations': [
            'Only public plans and supplied plan locations are included. No point does not mean no plan.',
            'Municipalities do not all supply plan-location data; completeness differs between provinces.',
            'Public plan points are currently absent for: ' + ', '.join(missing) + '.',
            'Points mark published project locations, not cadastral boundaries, legal designations or permission.',
            'Hard/soft plan status and planned dwelling capacity are snapshot attributes, not construction guarantees.',
            'Peilmoment differs by source record; updates occur around January and July.',
            'No rights can be derived from the data; verify the municipal source and current rules.',
        ],
    },
    'features': features,
}
if unknown:
    raise RuntimeError('Unresolved project provinces: ' + ', '.join(unknown[:10]))
OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
print(json.dumps({'path': str(OUT), 'bytes': OUT.stat().st_size, 'features': len(features),
                  'provinceCounts': payload['metadata']['provinceCounts'], 'missingProvinces': missing,
                  'sourceLastModified': modified}, ensure_ascii=False))
