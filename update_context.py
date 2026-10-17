"""Refresh compact TOP10NL surroundings for Netherlands advanced search.

Run from the project root: python3 update_context.py
Only public PDOK OGC Features are downloaded. The output is research context,
not a legal source or an acoustic measurement.
"""
import datetime as dt
import json
import urllib.request
import urllib.parse
import concurrent.futures
from pathlib import Path

ROOT = 'https://api.pdok.nl/kadaster/brt-top10nl/ogc/v1/collections'
BBOX = '3.1,50.7,7.3,53.7'  # European Netherlands
OUT = Path(__file__).resolve().parent / 'data' / 'netherlands_context.json'
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
    TYPES={'camping, kampeerterrein','caravanpark','bungalowpark'}
    items={'camping':[],'towns':[],'industry':[],'features':{name:[] for name in ('station',*NEARBY_TYPES)}}
    camping=[];seen=set()
    def consume(collection):
        return collection,list(pages(collection))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
     for collection,features in pool.map(consume,('functioneel_gebied_vlak','functioneel_gebied_multivlak','plaats_vlak','plaats_multivlak')):
      for f in features:
       p=f.get('properties') or {};kind=p.get('typefunctioneelgebied')
       group='camping' if kind in TYPES else 'industry' if kind=='bedrijventerrein' else next((name for name,types in NEARBY_TYPES.items() if kind in types),None) if kind else 'towns' if collection.startswith('plaats_') and p.get('typegebied') in ('woonkern','stadskern','hoofdkern','deelkern') else None
       if not group:continue
       ident=f"{collection}/{p.get('lokaal_id',f.get('id'))}"
       if ident in seen:continue
       seen.add(ident);location=point(f['geometry'])
       if not location:continue
       name=p.get('naamnl') or p.get('naamofficieel') or ''
       target=items['features'][group] if group in NEARBY_TYPES else items[group]
       target.append({'id':ident,'name':name,**location,'type':kind or p.get('typegebied'),'source':'PDOK TOP10NL'})
       if group=='camping':camping.append({'type':'Feature','id':ident,'properties':{'id':ident,'name':name,'kind':kind,'source':'PDOK TOP10NL','sourceUrl':f'{ROOT}/{collection}/items/{f["id"]}?f=html','sourceDate':p.get('bronactualiteit')},'geometry':f['geometry']})
    query=urllib.parse.urlencode({'service':'WFS','version':'2.0.0','request':'GetFeature','typeNames':'spoorwegen:station','outputFormat':'application/json','srsName':'EPSG:4326','count':1000})
    with urllib.request.urlopen('https://service.pdok.nl/prorail/spoorwegen/wfs/v1_0?'+query,timeout=60) as r:stations=json.load(r)['features']
    assert len(stations)<1000
    for f in stations:
     g=f.get('geometry') or {}
     if g.get('type')!='Point':continue
     lng,lat=g['coordinates'][:2];p=f.get('properties') or {}
     items['features']['station'].append({'id':str(f.get('id') or p.get('objectid')),'name':p.get('naam') or '', 'point':{'lat':round(lat,6),'lng':round(lng,6)},'extent':[lng,lat,lng,lat],'type':'railway station','source':'PDOK ProRail Spoorwegen'})
    metadata={'source':'PDOK TOP10NL + ProRail','retrieved':dt.datetime.now(dt.timezone.utc).isoformat(),'bbox':BBOX,'coverage':'European Netherlands'}
    OUT.write_text(json.dumps({**metadata,**items},ensure_ascii=False,separators=(',',':')))
    (OUT.parent/'camping_sites.geojson').write_text(json.dumps({'type':'FeatureCollection','metadata':metadata,'features':camping},ensure_ascii=False,separators=(',',':')))
    print('Completed national context',len(camping),'campsites',len(stations),'stations',flush=True)

if __name__=='__main__':
    main()
