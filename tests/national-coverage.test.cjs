const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const region=JSON.parse(fs.readFileSync(path.join(root,'netherlands.json')));
const fields=new Map();const element=id=>{if(!fields.has(id))fields.set(id,{value:'',innerHTML:'',textContent:'',querySelector:()=>null});return fields.get(id);};
const ctx=vm.createContext({document:{querySelectorAll:()=>[],getElementById:element,documentElement:{lang:'en'}},window:{addEventListener:()=>{}},console,Map,Set,URLSearchParams,fetch,Response,Blob,DecompressionStream,TextDecoder,Uint8Array});
vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8')+'\n globalThis.geography={state,municipalityAt,inNetherlands,geometryContains,selectedProvince,selectedRegionBounds,selectProvince,setMunicipalitySelection};',ctx);
const g=ctx.geography;g.state.region=region;
const capitals=[['Drenthe',52.995,6.563],['Flevoland',52.51,5.477],['Fryslân',53.202,5.799],['Gelderland',51.985,5.918],['Groningen',53.219,6.567],['Limburg',50.851,5.691],['Noord-Brabant',51.689,5.304],['Noord-Holland',52.382,4.636],['Overijssel',52.512,6.095],['Utrecht',52.091,5.121],['Zeeland',51.499,3.614],['Zuid-Holland',52.079,4.311]];
test('12 provinces, 342 unique municipalities, and correct province membership for all capitals',()=>{
 assert.equal(region.provinces.length,12);assert.equal(region.municipalities.length,342);
 assert.equal(new Set(region.municipalities.map(m=>m.code)).size,342);
 for(const m of region.municipalities)assert.ok(region.provinces.some(p=>p.code===m.province));
 for(const [province,lat,lng] of capitals){const p={lat,lng};assert.ok(g.inNetherlands(p),province);assert.equal(g.municipalityAt(p)?.provinceName,province);}
 assert.ok(g.inNetherlands({lat:53.055,lng:4.797}),'Texel');
 assert.equal(g.inNetherlands({lat:50.85,lng:4.35}),false,'Brussels');
 assert.equal(g.inNetherlands({lat:52.52,lng:13.4}),false,'Berlin');
});
test('province/municipality selection shares one inventory, and holes remain outside',()=>{
 for(const province of region.provinces){g.state.province=province.code;assert.equal(g.selectedProvince().name,province.name);assert.equal(g.selectedRegionBounds(),province.bounds);}
 g.state.province='all';assert.equal(g.selectedRegionBounds(),region.country.bounds);
 const geometry={type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[3,1],[3,3],[1,3],[1,1]]]};
 assert.ok(g.geometryContains(geometry,{lat:.5,lng:.5}));assert.equal(g.geometryContains(geometry,{lat:2,lng:2}),false);
});
test('public compressed assets expand once even when host already decodes gzip',async()=>{
 const zlib=require('node:zlib');const fixture={source:'PDOK',point:[6.56,53.21]};let body=zlib.gzipSync(Buffer.from(JSON.stringify(fixture)));
 ctx.fetch=async()=>new Response(body);vm.runInContext(fs.readFileSync(path.join(root,'national-data.js'),'utf8'),ctx);
 assert.equal(JSON.stringify(await vm.runInContext("fetchDataJSON('tile.json.gz')",ctx)),JSON.stringify(fixture));
 body=JSON.stringify(fixture);assert.equal(JSON.stringify(await vm.runInContext("fetchDataJSON('tile.json.gz')",ctx)),JSON.stringify(fixture));
});

test('nationwide surroundings and public project gaps are explicit',()=>{
 const context=JSON.parse(fs.readFileSync(path.join(root,'data/netherlands_context.json')));
 const sites=JSON.parse(fs.readFileSync(path.join(root,'data/camping_sites.geojson')));
 assert.ok(sites.features.length>3000);assert.ok(context.features.station.length>400);
 for(const province of region.provinces){const inside=item=>g.geometryContains(province.geometry,{lat:item.point.lat,lng:item.point.lng});assert.ok(context.towns.some(inside),province.name+' towns');assert.ok(context.features.station.some(inside),province.name+' stations');assert.ok(sites.features.some(f=>{const coords=f.geometry.type==='Polygon'?f.geometry.coordinates[0]:f.geometry.coordinates[0][0];return coords.some(([lng,lat])=>g.geometryContains(province.geometry,{lat,lng}));}),province.name+' campsite polygons');}
 const projects=JSON.parse(fs.readFileSync(path.join(root,'data/development_projects.geojson')));
 assert.equal(projects.features.length,projects.metadata.featureCount);assert.ok(projects.features.length>8000);
 assert.deepEqual([...projects.metadata.provincesWithoutPublishedPoints].sort(),['Fryslân','Gelderland','Noord-Brabant'].sort());
 assert.ok(projects.metadata.limitations.some(s=>s.includes('No point does not mean no plan')));
});

test('national bouwvlak overview includes every province and resolves source geometry by plan/object ID',()=>{
 const base=path.join(root,'data/bouwvlakken'),zlib=require('node:zlib');
 const manifest=JSON.parse(fs.readFileSync(path.join(base,'manifest.json')));
 assert.equal(manifest.coverage,'European Netherlands');assert.equal(manifest.compressedTiles,true);assert.ok(manifest.featureCount>1000000);
 const overview=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(base,'overview.json.gz'))));
 assert.equal(overview.length,manifest.overviewCount);
 for(const province of region.provinces){const [s,w,n,e]=province.bounds;const item=overview.find(item=>{const [lng,lat]=item.point;return lat>=s&&lat<=n&&lng>=w&&lng<=e&&g.geometryContains(province.geometry,{lat,lng});});assert.ok(item,province.name+' bouwvlakken');
  const rows=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(base,`${item.tile}.geo.json.gz`))));assert.ok(rows.some(([key])=>key===`${item.plan}|${item.id}`),province.name+' geometry provenance');}
});
