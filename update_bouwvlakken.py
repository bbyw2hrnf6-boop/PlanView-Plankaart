"""Build compact, spatially tiled Netherlands bouwvlak data from PDOK's Wro extract.

Run from this project's root with ``python3 update_bouwvlakken.py``. The source is
the nationwide Bouwvlak GML download, streamed without retaining it on disk.
All non-historical Wro features in the European Netherlands are written.
This is historical Wro plan evidence, not a current building-right decision.
"""
import datetime as dt
import gzip
import json
import math
import os
import shutil
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict, OrderedDict
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SOURCE = 'https://service.pdok.nl/kadaster/ruimtelijke-plannen/atom/downloads/Bouwvlak.gml.gz'
FEED = 'https://service.pdok.nl/kadaster/ruimtelijke-plannen/atom/plu.xml'
OUT = Path(os.environ.get('PLANVIEW_INDEX_OUT', ROOT / 'data' / 'bouwvlakken-next'))
APP = '{http://www.opengis.net/gml}'
GML = APP
TILE_DEGREES = 0.1


def rd_to_wgs(x, y):
    dx, dy = (x - 155000) / 100000, (y - 463000) / 100000
    lat_seconds = (3235.65389 * dy - 32.58297 * dx**2 - .2475 * dy**2
                   - .84978 * dx**2 * dy - .0655 * dy**3
                   - .01709 * dx**2 * dy**2 - .00738 * dx + .0053 * dx**4
                   - .00039 * dx**2 * dy**3 + .00033 * dx**4 * dy
                   - .00012 * dx * dy)
    lon_seconds = (5260.52916 * dx + 105.94684 * dx * dy + 2.45656 * dx * dy**2
                   - .81885 * dx**3 + .05594 * dx * dy**3 - .05607 * dx**3 * dy
                   + .01199 * dy - .00256 * dx**3 * dy**2 + .00128 * dx * dy**4
                   + .00022 * dy**2 - .00022 * dx**2 + .00026 * dx**5)
    return [round(5.38720621 + lon_seconds / 3600, 7),
            round(52.15517440 + lat_seconds / 3600, 7)]


def ring_contains(ring, point):
    lng, lat = point
    inside = False
    for i in range(len(ring) - 1):
        a, b = ring[i], ring[i + 1]
        if (a[1] > lat) != (b[1] > lat) and lng < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0]:
            inside = not inside
    return inside


def in_region(point):
    return 3.1 <= point[0] <= 7.3 and 50.7 <= point[1] <= 53.7


def parse_ring(element):
    pos = element.find('.//' + GML + 'posList')
    if pos is None or not pos.text:
        return []
    values = [float(value) for value in pos.text.split()]
    return [values[i:i + 2] for i in range(0, len(values) - 1, 2)]


def representative_point(polygons):
    """Find an inside point using a scan line, rather than a bounding-box centre."""
    for polygon in polygons:
        outer = polygon[0]
        if len(outer) < 4:
            continue
        ys = [p[1] for p in outer]
        for fraction in (.5, .35, .65, .2, .8):
            y = min(ys) + (max(ys) - min(ys)) * fraction
            crossings = sorted(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
                               for a, b in zip(outer, outer[1:])
                               if (a[1] <= y < b[1]) or (b[1] <= y < a[1]))
            intervals = [(crossings[i + 1] - crossings[i], (crossings[i + 1] + crossings[i]) / 2)
                         for i in range(0, len(crossings) - 1, 2)]
            for _, x in sorted(intervals, reverse=True):
                if not any(ring_contains(hole, (x, y)) for hole in polygon[1:]):
                    return x, y
    return None


def read_feature(member):
    item = member.find(APP + 'Bouwvlak')
    if item is None or item.findtext(APP + 'historisch') == 'true':
        return None
    envelope = item.find('.//' + GML + 'Envelope')
    if envelope is None:
        return None
    lower = [float(v) for v in envelope.findtext(GML + 'lowerCorner', '').split()]
    upper = [float(v) for v in envelope.findtext(GML + 'upperCorner', '').split()]
    # European Netherlands RD bounding box; municipal membership is checked at search time.
    if len(lower) != 2 or len(upper) != 2 or upper[0] < -10000 or lower[0] > 310000 or upper[1] < 300000 or lower[1] > 640000:
        return None
    polygons = []
    for shape in item.findall('.//' + GML + 'Polygon'):
        exterior = shape.find(GML + 'exterior')
        if exterior is None:
            continue
        outer = parse_ring(exterior)
        if len(outer) < 4:
            continue
        polygons.append([outer] + [ring for inside in shape.findall(GML + 'interior')
                                     if len(ring := parse_ring(inside)) >= 4])
    point_rd = representative_point(polygons)
    if point_rd is None:
        return None
    point = rd_to_wgs(*point_rd)
    if not in_region(point):
        return None
    geometry = [[[[round(x, 1), round(y, 1)] for x, y in ring] for ring in polygon]
                for polygon in polygons]
    return {'id': item.findtext(APP + 'identificatie') or item.get(GML + 'id'),
            'plan': item.findtext(APP + 'plangebied') or '',
            'designation': (item.findtext(APP + 'bestemmingsvlak') or '').split('=', 1)[-1],
            'status': item.findtext(APP + 'dossierStatus') or '',
            'date': item.findtext(APP + 'datum') or '',
            'point': point, 'geometry': geometry}


def main():
    with urllib.request.urlopen(FEED, timeout=30) as feed:
        source_updated = ET.fromstring(feed.read()).findtext('{http://www.w3.org/2005/Atom}updated')
    tiles = defaultdict(list)
    OUT.mkdir(parents=True, exist_ok=True)
    for old in (p for p in OUT.iterdir() if p.name.endswith(('.json','.json.gz','.ndjson'))):
        old.unlink()
    geo_files = OrderedDict()
    request = urllib.request.Request(SOURCE, headers={'User-Agent': 'PlanView/1.0 (public spatial research)'})
    local_source = os.environ.get('PLANVIEW_GML_SOURCE')
    response = open(local_source, 'rb') if local_source else urllib.request.urlopen(request, timeout=120)
    with response, gzip.GzipFile(fileobj=response) as stream:
        parser = ET.iterparse(stream, events=('start', 'end'))
        root = next(parser)[1]
        seen = 0
        for event, element in parser:
            if event != 'end' or element.tag != APP + 'featureMember':
                continue
            seen += 1
            feature = read_feature(element)
            if feature:
                lng, lat = feature['point']
                key = f'{math.floor(lat / TILE_DEGREES):03d}-{math.floor(lng / TILE_DEGREES):03d}'
                geometry = feature.pop('geometry')
                tiles[key].append(feature)
                if key not in geo_files:
                    if len(geo_files)>=48:geo_files.popitem(last=False)[1].close()
                    geo_files[key] = (OUT / f'{key}.geo.ndjson').open('a')
                geo_files.move_to_end(key)
                # An object ID can recur in several versions of a plan. The
                # document ID + object ID pair is unique in the PDOK extract.
                geo_files[key].write(json.dumps([feature['plan'] + '|' + feature['id'], geometry], separators=(',', ':')) + '\n')
            element.clear()
            root.clear()
            if seen % 100000 == 0:
                print(f'{seen:,} nationwide features; {sum(map(len, tiles.values())):,} in Netherlands', flush=True)
    for handle in geo_files.values():
        handle.close()
    manifest = {'source': SOURCE, 'sourcePage': 'https://www.pdok.nl/atom-downloadservices/-/article/ruimtelijke-plannen',
                'sourceUpdated': source_updated,
                'retrieved': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
                'featureCount': sum(map(len, tiles.values())), 'tileDegrees': TILE_DEGREES,
                'coverage': 'European Netherlands', 'compressedTiles': True,
                'tiles': {key: len(features) for key, features in sorted(tiles.items())}}
    overview = []
    for key, features in tiles.items():
        with gzip.open(OUT / f'{key}.idx.json.gz', 'wt', encoding='utf-8', compresslevel=6) as target:
            json.dump(features,target,ensure_ascii=False,separators=(',',':'))
        # Large province searches need a small, spatially distributed preview.
        # The complete index and geometry remain available in the individual tiles.
        cells = {}
        for feature in features:
            lng, lat = feature['point']
            cell = (math.floor(lat * 100), math.floor(lng * 100))
            current = cells.get(cell)
            def rank(item):
                status = item['status'].lower()
                active = int('onherroepelijk' in status or 'in werking' in status or status == 'vastgesteld')
                return active, item['date']
            if current is None or rank(feature) > rank(current):
                cells[cell] = feature
        overview.extend({**feature, 'tile': key} for feature in cells.values())
        ndjson = OUT / f'{key}.geo.ndjson'
        with ndjson.open() as source, gzip.open(OUT / f'{key}.geo.json.gz', 'wt', encoding='utf-8', compresslevel=6) as target:
            target.write('[')
            for i, line in enumerate(source):
                if i:
                    target.write(',')
                target.write(line.strip())
            target.write(']')
        ndjson.unlink()
    with gzip.open(OUT / 'overview.json.gz','wt',encoding='utf-8',compresslevel=6) as target:
        json.dump(overview,target,ensure_ascii=False,separators=(',',':'))
    manifest['overviewCount'] = len(overview)
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')))
    if not os.environ.get('PLANVIEW_INDEX_OUT'):
        current=ROOT/'data'/'bouwvlakken'; backup=ROOT/'data'/'bouwvlakken-previous'
        if backup.exists():shutil.rmtree(backup)
        if current.exists():current.rename(backup)
        OUT.rename(current)
        if backup.exists():shutil.rmtree(backup)
    print(f"Wrote {manifest['featureCount']:,} Netherlands bouwvlakken in {len(tiles)} tiles to {OUT}", flush=True)


if __name__ == '__main__':
    main()
    from update_envelope_spatial_index import main as update_spatial_tiles
    update_spatial_tiles()
