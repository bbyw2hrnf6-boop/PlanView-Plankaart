"""Refresh selected official Limburg provincial WFS planning-context polygons.

These are mapped context from the provincial service, not a complete or
necessarily current statement of legal effect. Verify in Omgevingsloket.
"""
import datetime as dt
import json
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WFS = 'https://portal.prvlimburg.nl/geodata/PROVINCIALE_BELEIDSPLANNEN/wfs'
KINDS = {
    'VERORD_STEDELIJK_GEBIED_V': 'urban_area',
    'VERORD_NATUURNETWERK_V': 'nature_network',
    'VERORD_GRONDWATERBESCHERM_V': 'groundwater_protection',
}


def fetch(name):
    params = urllib.parse.urlencode({'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature',
                                      'typeNames': name, 'outputFormat': 'application/json',
                                      'srsName': 'EPSG:4326', 'count': 5000})
    with urllib.request.urlopen(WFS + '?' + params, timeout=120) as response:
        result = json.load(response)
    if result.get('numberMatched', 0) > len(result['features']):
        raise RuntimeError(f'{name}: incomplete WFS response')
    return result['features']


def compact(geometry):
    def visit(value):
        if isinstance(value, list) and value and isinstance(value[0], (float, int)):
            return [round(value[0], 6), round(value[1], 6)]
        return [visit(child) for child in value]
    return {'type': geometry['type'], 'coordinates': visit(geometry['coordinates'])}


def main():
    features = []
    for source, kind in KINDS.items():
        records = fetch(source)
        for record in records:
            props = record.get('properties') or {}
            features.append({'type': 'Feature', 'id': record['id'], 'geometry': compact(record['geometry']),
                             'properties': {'id': record['id'], 'kind': kind,
                                            'name': props.get('OMSCHRIJVING') or props.get('OMSCHR') or props.get('OMS') or kind.replace('_', ' ').title(),
                                            'source': 'Provincie Limburg WFS', 'sourceLayer': source,
                                            'sourceUrl': WFS + '?service=WFS&request=GetCapabilities'}})
        print(source, len(records), flush=True)
    out = {'type': 'FeatureCollection', 'metadata': {'source': 'Provincie Limburg WFS',
            'retrieved': dt.datetime.now(dt.timezone.utc).isoformat(),
            'legalNote': 'Context only; current legal effect must be checked in Omgevingsloket.',
            'sourceUrl': WFS + '?service=WFS&request=GetCapabilities'}, 'features': features}
    path = ROOT / 'data' / 'provincial_context.geojson'
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    print(f'Saved {len(features)} polygons ({path.stat().st_size:,} bytes)')


if __name__ == '__main__':
    main()
