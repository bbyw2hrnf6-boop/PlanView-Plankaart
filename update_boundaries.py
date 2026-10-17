import json,urllib.request,datetime,math
from pathlib import Path
OUT=Path(__file__).resolve().parent
API='https://api.pdok.nl/kadaster/bestuurlijkegebieden/ogc/v1/collections'
def get(kind):
    url=f'{API}/{kind}/items?f=json&limit=1000'; features=[]
    while url:
        with urllib.request.urlopen(url,timeout=90) as r:d=json.load(r)
        features.extend(d['features']);url=next((l['href'] for l in d.get('links',[]) if l['rel']=='next'),None)
    return features
# Douglas-Peucker keeps closed rings, all islands and holes. Original data remains authoritative.
def simplify(points,tol=.00006):
    if len(points)<5:return points
    x,y=points[0];X,Y=points[-1];dx,dy=X-x,Y-y;den=dx*dx+dy*dy
    distances=[]
    for a,b in points[1:-1]:
        t=max(0,min(1,((a-x)*dx+(b-y)*dy)/den)) if den else 0
        distances.append((a-x-t*dx)**2+(b-y-t*dy)**2)
    maximum=max(distances,default=0)
    if maximum>tol*tol:
        i=distances.index(maximum)+1;return simplify(points[:i+1],tol)[:-1]+simplify(points[i:],tol)
    return [points[0],points[-1]]
def geom(g):
    polys=[g['coordinates']] if g['type']=='Polygon' else g['coordinates'];out=[]
    for poly in polys:
        rings=[]
        for ring in poly:
            reduced=simplify(ring)
            if len(reduced)<4:reduced=ring
            rings.append([[round(x,6),round(y,6)] for x,y,*_ in reduced])
        out.append(rings)
    return {'type':g['type'],'coordinates':out[0] if g['type']=='Polygon' else out}
def bounds(g):
    p=g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']];v=[c for poly in p for r in poly for c in r]
    return [min(c[1] for c in v),min(c[0] for c in v),max(c[1] for c in v),max(c[0] for c in v)]
provinces=[]
for f in get('provinciegebied'):
    p=f['properties'];g=geom(f['geometry']);provinces.append({'code':p['code'],'name':p['naam'],'bounds':bounds(g),'geometry':g})
municipalities=[]
for f in get('gemeentegebied'):
    p=f['properties'];g=geom(f['geometry']);municipalities.append({'code':p['code'].zfill(4),'name':p['naam'],'province':p['ligt_in_provincie_code'],'provinceName':p['ligt_in_provincie_naam'],'bounds':bounds(g),'geometry':g})
country={'type':'MultiPolygon','coordinates':[poly for p in provinces for poly in (p['geometry']['coordinates'] if p['geometry']['type']=='MultiPolygon' else [p['geometry']['coordinates']])]}
data={'metadata':{'source':API,'retrieved':datetime.datetime.now(datetime.timezone.utc).isoformat(),'coverage':'European Netherlands','geometryToleranceDegrees':.00006},'country':{'name':'Nederland','bounds':bounds(country)},'provinces':sorted(provinces,key=lambda p:p['name']),'municipalities':sorted(municipalities,key=lambda p:p['name'])}
assert len(provinces)==12 and len(municipalities)>330
(OUT/'netherlands.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')))
print('boundaries',len(provinces),len(municipalities),(OUT/'netherlands.json').stat().st_size,flush=True)
