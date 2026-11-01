"""Index the full extent of each existing bouwvlak tile, including crossing shapes."""
import gzip
import json
from pathlib import Path
from update_bouwvlakken import rd_to_wgs

ROOT = Path(__file__).resolve().parent / 'data' / 'bouwvlakken'


def main():
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    tiles = {}
    for key in manifest['tiles']:
        suffix = '.gz' if manifest.get('compressedTiles') else ''
        path = ROOT / f'{key}.geo.json{suffix}'
        with (gzip.open(path, 'rt') if suffix else path.open()) as stream:
            rows = json.load(stream)
        xs, ys = [], []
        for _, polygons in rows:
            for polygon in polygons:
                for ring in polygon:
                    for x, y in ring:
                        xs.append(x); ys.append(y)
        if not xs:
            continue
        corners = [rd_to_wgs(x, y) for x in (min(xs), max(xs)) for y in (min(ys), max(ys))]
        # Conservative padding accounts for the curved RD/WGS bounding edges.
        tiles[key] = [min(p[0] for p in corners)-.02, min(p[1] for p in corners)-.02,
                      max(p[0] for p in corners)+.02, max(p[1] for p in corners)+.02]
    output = {'sourceUpdated': manifest.get('sourceUpdated'), 'retrieved': manifest['retrieved'],
              'method': 'Full geometry extents per source tile; conservative WGS84 padding', 'tiles': tiles}
    (ROOT / 'spatial-tiles.json').write_text(json.dumps(output, separators=(',', ':'))+'\n')
    print(f'Indexed full geometry extents for {len(tiles)} tiles')


if __name__ == '__main__':
    main()
