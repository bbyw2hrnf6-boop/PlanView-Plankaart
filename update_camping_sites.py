"""Refresh official TOP10NL camping/holiday-park polygons for PlanView.

Run from this project folder. The snapshot is topographic context, not planning
permission. Keep full geometry for exact inside-site search and map rendering.
"""
import datetime as dt
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
API = 'https://api.pdok.nl/kadaster/brt-top10nl/ogc/v1/collections'
BBOX = '5.45,50.70,6.30,51.85'
TYPES = {'camping, kampeerterrein', 'caravanpark', 'bungalowpark'}
province = json.loads((ROOT / 'limburg.json').read_text())['province']['geometry']


def in_ring(point, ring):
    x, y = point
    inside = False
    for i, a in enumerate(ring):
        b = ring[i - 1]
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            inside = not inside
    return inside


def in_province(point):
    polygons = [province['coordinates']] if province['type'] == 'Polygon' else province['coordinates']
    return any(in_ring(point, rings[0]) and not any(in_ring(point, hole) for hole in rings[1:]) for rings in polygons)


def vertices(geometry):
    def walk(value):
        if isinstance(value, list) and len(value) >= 2 and isinstance(value[0], (int, float)):
            yield value
        elif isinstance(value, list):
            for child in value:
                yield from walk(child)
    return list(walk(geometry['coordinates']))


def collect(collection):
    url = f'{API}/{collection}/items?bbox={BBOX}&limit=1000&f=json'
    while url:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'PlanView/1.0'}), timeout=45) as response:
            page = json.load(response)
        yield from page['features']
        url = next((link['href'] for link in page.get('links', []) if link.get('rel') == 'next'), None)


def main():
    features = []
    seen = set()
    for collection in ('functioneel_gebied_vlak', 'functioneel_gebied_multivlak'):
        for item in collect(collection):
            props = item.get('properties') or {}
            kind = props.get('typefunctioneelgebied')
            if kind not in TYPES:
                continue
            coords = vertices(item['geometry'])
            if not coords or not any(in_province(p) for p in coords):
                continue
            identifier = f"{collection}/{props.get('lokaal_id', item.get('id'))}"
            if identifier in seen:
                continue
            seen.add(identifier)
            features.append({'type': 'Feature', 'id': identifier,
                             'properties': {'id': identifier, 'name': props.get('naamnl') or '', 'kind': kind,
                                            'source': 'PDOK TOP10NL', 'sourceUrl': f'{API}/{collection}/items/{item.get("id")}',
                                            'sourceDate': props.get('bronactualiteit')},
                             'geometry': item['geometry']})
    out = {'type': 'FeatureCollection', 'metadata': {'source': 'PDOK TOP10NL', 'retrieved': dt.datetime.now(dt.timezone.utc).isoformat(),
           'sourceUrl': f'{API}/functioneel_gebied_vlak/items', 'scope': 'Limburg'}, 'features': features}
    path = ROOT / 'data' / 'camping_sites.geojson'
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    print(f'{len(features)} polygons saved to {path} ({path.stat().st_size:,} bytes)')


if __name__ == '__main__':
    main()
