"""Refresh compact TOP10NL surroundings for Limburg advanced search.

Run from the project root: python3 update_context.py
Only public PDOK OGC Features are downloaded. The output is research context,
not a legal source or an acoustic measurement.
"""
import datetime as dt
import json
import urllib.request
import urllib.parse
from pathlib import Path

ROOT = 'https://api.pdok.nl/kadaster/brt-top10nl/ogc/v1/collections'
BBOX = '5.45,50.70,6.30,51.85'  # Limburg plus nearby Dutch context
OUT = Path(__file__).resolve().parent / 'data' / 'limburg_context.json'
NEARBY_TYPES = {
    'park': {'park'},
    'sports': {'sportterrein, sportcomplex', 'tennispark'},
    'cemetery': {'begraafplaats', 'erebegraafplaats'},
    'swimming_pool': {'zwembadcomplex'},
    'marina': {'jachthaven'},
}


def pages(collection):
    url = f'{ROOT}/{collection}/items?bbox={BBOX}&limit=1000&f=json'
    count = 0
    while url:
        req = urllib.request.Request(url, headers={'User-Agent': 'PlanView/1.0 (public research prototype)'})
        with urllib.request.urlopen(req, timeout=45) as response:
            page = json.load(response)
        yield from page['features']
        count += len(page['features'])
        print(f'{collection}: {count} read', flush=True)
        next_links = [link['href'] for link in page.get('links', []) if link.get('rel') == 'next']
        url = next_links[0] if next_links else None


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


def main():
    items = {'camping': [], 'towns': [], 'industry': [],
             'features': {name: [] for name in ('station', *NEARBY_TYPES)}}
    seen = set()
    for collection in ('functioneel_gebied_vlak', 'functioneel_gebied_multivlak', 'plaats_vlak', 'plaats_multivlak'):
        for feature in pages(collection):
            props = feature.get('properties') or {}
            kind = props.get('typefunctioneelgebied')
            if kind == 'camping, kampeerterrein':
                group = 'camping'
            elif kind == 'bedrijventerrein':
                group = 'industry'
            elif kind and (match := next((name for name, types in NEARBY_TYPES.items() if kind in types), None)):
                group = match
            elif collection.startswith('plaats_') and props.get('typegebied') in ('woonkern', 'stadskern', 'hoofdkern', 'deelkern'):
                group = 'towns'
            else:
                continue
            ident = f"{collection}/{props.get('lokaal_id', feature.get('id'))}"
            if ident in seen:
                continue
            seen.add(ident)
            location = point(feature['geometry'])
            if not location:
                continue
            target = items['features'][group] if group in NEARBY_TYPES else items[group]
            target.append({'id': ident, 'name': props.get('naamnl') or props.get('naamofficieel') or '', **location,
                           'type': kind or props.get('typegebied'), 'source': 'PDOK TOP10NL'})
    query = urllib.parse.urlencode({'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature',
                                    'typeNames': 'spoorwegen:station', 'outputFormat': 'application/json',
                                    'srsName': 'EPSG:4326', 'count': '1000'})
    station_url = 'https://service.pdok.nl/prorail/spoorwegen/wfs/v1_0?' + query
    with urllib.request.urlopen(station_url, timeout=30) as response:
        stations = json.load(response)['features']
    if len(stations) >= 1000:
        raise RuntimeError('Station result limit reached; refusing incomplete cache')
    west, south, east, north = map(float, BBOX.split(','))
    for feature in stations:
        geometry = feature.get('geometry') or {}
        if geometry.get('type') != 'Point':
            continue
        lng, lat = geometry['coordinates'][:2]
        if not (west <= lng <= east and south <= lat <= north):
            continue
        props = feature.get('properties') or {}
        items['features']['station'].append({'id': str(feature.get('id') or props.get('objectid')),
            'name': props.get('naam') or '', 'point': {'lat': round(lat, 6), 'lng': round(lng, 6)},
            'extent': [round(lng, 6), round(lat, 6), round(lng, 6), round(lat, 6)],
            'type': 'railway station', 'source': 'PDOK ProRail Spoorwegen'})
    payload = {'source': 'PDOK TOP10NL', 'retrieved': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'), 'bbox': BBOX, **items}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
    print(f'Wrote {OUT}: ' + ', '.join(f'{k}={len(v)}' for k, v in items.items() if isinstance(v, list)) +
          ', ' + ', '.join(f'{k}={len(v)}' for k, v in items['features'].items()), flush=True)


if __name__ == '__main__':
    main()
