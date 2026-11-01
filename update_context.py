"""Refresh complete mapped TOP10NL surroundings for Netherlands search.

Run: python3 update_context.py [--cache-dir /tmp/planview-context-download]
The optional cache resumes complete downloaded pages from this refresh; use a
fresh cache directory for a later update. Only public PDOK data is downloaded.
Mapped boundaries support straight-line screening, not legal or noise claims.
"""
import argparse
import concurrent.futures
import datetime as dt
import gzip
import hashlib
import http.client
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = 'https://api.pdok.nl/kadaster/brt-top10nl/ogc/v1/collections'
BBOX = '3.1,50.7,7.3,53.7'  # European Netherlands
OUT = Path(__file__).resolve().parent / 'data' / 'netherlands_context.json'
CAMPING_TYPES = {'camping, kampeerterrein', 'caravanpark', 'bungalowpark', 'vakantiepark'}
NEARBY_TYPES = {
    'park': {'park'},
    'sports': {'sportterrein, sportcomplex', 'tennispark'},
    'cemetery': {'begraafplaats', 'erebegraafplaats'},
    'swimming_pool': {'zwembadcomplex'},
    'marina': {'jachthaven'},
    'hospital': {'ziekenhuiscomplex'},
    'allotments': {'volkstuinen'},
    'recreation_area': {'recreatiegebied'},
}


def fetch_json(url, cache_dir=None):
    cache = cache_dir / (hashlib.sha256(url.encode()).hexdigest() + '.json') if cache_dir else None
    if cache and cache.exists():
        return json.loads(cache.read_text())
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'PlanView/1.0 (public research prototype)'})
            with urllib.request.urlopen(req, timeout=60) as response:
                data = json.load(response)
            if cache:
                cache.write_text(json.dumps(data, separators=(',', ':')))
            return data
        except (OSError, ValueError, http.client.HTTPException):
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def pages(collection, cache_dir=None):
    url = f'{ROOT}/{collection}/items?bbox={BBOX}&limit=250&f=json'
    count = 0
    seen_urls = set()
    while url:
        if url in seen_urls:
            raise RuntimeError(f'{collection}: repeated pagination link')
        seen_urls.add(url)
        page = fetch_json(url, cache_dir)
        features = page['features']
        yield from features
        count += len(features)
        print(f'{collection}: {count} read', flush=True)
        url = next((link['href'] for link in page.get('links', []) if link.get('rel') == 'next'), None)
    if not count:
        raise RuntimeError(f'{collection}: empty response; retaining previous context')


def compact_geometry(geometry):
    """Keep all rings/vertices; six decimals are roughly 0.1 m in NL."""
    def compact(value):
        if isinstance(value, list) and len(value) >= 2 and all(isinstance(v, (int, float)) for v in value[:2]):
            return [round(value[0], 6), round(value[1], 6)]
        return [compact(child) for child in value]
    return {'type': geometry['type'], 'coordinates': compact(geometry['coordinates'])}


def point(geometry):
    coords = []
    def visit(value):
        if isinstance(value, list) and len(value) >= 2 and all(isinstance(x, (int, float)) for x in value[:2]):
            coords.append(value)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    visit(geometry.get('coordinates', []))
    if not coords:
        return None
    west, east = min(x[0] for x in coords), max(x[0] for x in coords)
    south, north = min(x[1] for x in coords), max(x[1] for x in coords)
    return {'point': {'lat': round((south+north)/2, 6), 'lng': round((west+east)/2, 6)},
            'extent': [round(west, 6), round(south, 6), round(east, 6), round(north, 6)]}


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    payload = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if path.suffix == '.gz':
        payload = gzip.compress(payload, mtime=0)
    temporary.write_bytes(payload)
    temporary.replace(path)


def write_context(items, metadata, camping):
    """Publish a small index and lazily loaded geometry groups, each under 25 MB."""
    directory = OUT.parent / 'context'
    directory.mkdir(exist_ok=True)
    groups = {'camping': items['camping'], 'town': items['towns'], 'industry': items['industry'], **items['features']}
    geometry_files = {}
    for kind, records in groups.items():
        payload = gzip.compress(json.dumps(records, ensure_ascii=False, separators=(',', ':')).encode(), mtime=0)
        filename = f'{kind}-{hashlib.sha256(payload).hexdigest()[:16]}.json.gz'
        if len(payload) >= 25 * 1024 * 1024:
            raise RuntimeError(f'{kind}: geometry asset exceeds hosting size limit')
        path = directory / filename
        if path.exists():
            if path.read_bytes() != payload:
                raise RuntimeError(f'{kind}: unexpected geometry content-hash collision')
        else:
            temporary = path.with_suffix('.gz.tmp')
            temporary.write_bytes(payload)
            temporary.replace(path)
        geometry_files[kind] = f'data/context/{filename}'
    def index(records):
        return [{key: value for key, value in record.items() if key != 'geometry' or record['geometry']['type'] == 'Point'} for record in records]
    compact_items = {key: index(items[key]) for key in ('camping', 'towns', 'industry')}
    compact_items['features'] = {kind: index(records) for kind, records in items['features'].items()}
    camping_payload = {'type': 'FeatureCollection', 'metadata': metadata, 'features': camping}
    write_json(OUT.parent / 'camping_sites.geojson', camping_payload)
    write_json(OUT.parent / 'camping_sites.geojson.gz', camping_payload)
    manifest = {**metadata, 'geometryFiles': geometry_files, **compact_items}
    # Keep the plain maintenance copy; publish the identical compressed manifest
    # last, after every immutable geometry file has been written successfully.
    write_json(OUT, manifest)
    write_json(OUT.with_suffix('.json.gz'), manifest)


def main(cache_dir=None):
    if cache_dir:
        cache_dir.mkdir(parents=True, exist_ok=True)
    items = {'camping': [], 'towns': [], 'industry': [], 'features': {name: [] for name in ('station', *NEARBY_TYPES)}}
    camping, seen = [], set()
    source_counts = {}
    def consume(collection):
        return collection, list(pages(collection, cache_dir))
    collections = ('functioneel_gebied_vlak', 'functioneel_gebied_multivlak', 'plaats_vlak', 'plaats_multivlak')
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for collection, features in pool.map(consume, collections):
            source_counts[collection] = len(features)
            for feature in features:
                props = feature.get('properties') or {}
                kind = props.get('typefunctioneelgebied')
                group = ('camping' if kind in CAMPING_TYPES else 'industry' if kind == 'bedrijventerrein'
                         else next((name for name, types in NEARBY_TYPES.items() if kind in types), None) if kind
                         else 'towns' if collection.startswith('plaats_') and props.get('typegebied') in ('woonkern', 'stadskern', 'hoofdkern', 'deelkern') else None)
                if not group:
                    continue
                ident = f'{collection}/{props.get("lokaal_id", feature.get("id"))}'
                if ident in seen:
                    raise RuntimeError(f'Duplicate source feature: {ident}')
                seen.add(ident)
                geometry = compact_geometry(feature['geometry'])
                location = point(geometry)
                if not location:
                    raise RuntimeError(f'Missing source geometry: {ident}')
                name = props.get('naamnl') or props.get('naamofficieel') or ''
                source_url = f'{ROOT}/{collection}/items/{feature["id"]}?f=html'
                target = items['features'][group] if group in NEARBY_TYPES else items[group]
                target.append({'id': ident, 'name': name, **location, 'geometry': geometry,
                               'type': kind or props.get('typegebied'), 'source': 'PDOK TOP10NL',
                               'sourceUrl': source_url,
                               'sourceDate': props.get('bronactualiteit')})
                if group == 'camping':
                    camping.append({'type': 'Feature', 'id': ident, 'properties': {
                        'id': ident, 'name': name, 'kind': kind, 'source': 'PDOK TOP10NL',
                        'sourceUrl': source_url, 'sourceDate': props.get('bronactualiteit')}, 'geometry': geometry})
    query = urllib.parse.urlencode({'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature',
                                    'typeNames': 'spoorwegen:station', 'outputFormat': 'application/json',
                                    'srsName': 'EPSG:4326', 'count': 1000})
    stations = fetch_json('https://service.pdok.nl/prorail/spoorwegen/wfs/v1_0?' + query, cache_dir)
    if len(stations['features']) >= 1000 or stations.get('numberMatched', len(stations['features'])) != len(stations['features']):
        raise RuntimeError('ProRail: incomplete station response; retaining previous context')
    for feature in stations['features']:
        geometry = feature.get('geometry') or {}
        if geometry.get('type') != 'Point':
            raise RuntimeError('ProRail: station has unexpected geometry')
        props = feature.get('properties') or {}
        geometry = compact_geometry(geometry)
        items['features']['station'].append({'id': str(feature.get('id') or props.get('objectid')),
            'name': props.get('naam') or '', **point(geometry), 'geometry': geometry,
            'type': 'railway station', 'source': 'PDOK ProRail Spoorwegen'})
    metadata = {'source': 'PDOK TOP10NL + ProRail', 'retrieved': dt.datetime.now(dt.timezone.utc).isoformat(),
                'bbox': BBOX, 'coverage': 'European Netherlands', 'sourceCounts': source_counts,
                'geometryMethod': 'All original polygon rings and vertices, rounded to 6 decimals; straight-line map distances.',
                'accuracyNote': 'Mapped topographic boundaries, not surveyed parcel boundaries or travel distances; sourceDate is per-feature source imagery/data date.',
                'attribution': 'Kadaster TOP10NL (CC BY 4.0); ProRail Spoorwegen'}
    write_context(items, metadata, camping)
    print('Completed national context', {key: len(value) for key, value in items.items() if isinstance(value, list)},
          {key: len(value) for key, value in items['features'].items()}, f'{OUT.stat().st_size:,} bytes', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache-dir', type=Path)
    args = parser.parse_args()
    main(args.cache_dir)
