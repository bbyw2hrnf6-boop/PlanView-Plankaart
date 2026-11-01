const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {gunzipSync} = require('node:zlib');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/netherlands_context.json')));
const groups = Object.fromEntries(Object.entries(data.geometryFiles).map(([kind, file]) => {
  const bytes = fs.readFileSync(path.join(root, file));
  assert.ok(bytes.length < 25 * 1024 * 1024, kind + ': fits hosted asset limit');
  assert.ok(file.endsWith('-' + createHash('sha256').update(bytes).digest('hex').slice(0, 16) + '.json.gz'), kind + ': immutable content-addressed geometry');
  return [kind, JSON.parse(gunzipSync(bytes))];
}));
const core = require('../search-core.js');

test('published compressed context is byte-for-byte identical to its maintenance source', () => {
  const raw = fs.readFileSync(path.join(root, 'data/netherlands_context.json'));
  const compressed = fs.readFileSync(path.join(root, 'data/netherlands_context.json.gz'));
  assert.deepEqual(gunzipSync(compressed), raw);
  assert.ok(compressed.length < raw.length, 'compression saves hosting and transfer space');
});

test('compressed overlay snapshots preserve every maintenance-source byte', () => {
  for (const name of ['camping_sites.geojson', 'development_projects.geojson']) {
    const raw = fs.readFileSync(path.join(root, 'data', name));
    const compressed = fs.readFileSync(path.join(root, 'data', name + '.gz'));
    assert.deepEqual(gunzipSync(compressed), raw, name);
    assert.ok(compressed.length < raw.length, name + ': smaller transfer without data loss');
  }
});

test('actual context loader reads gzip overlays and already-decoded hosting responses', async () => {
  const vm = require('node:vm'), {gzipSync} = require('node:zlib');
  const fixture = {type:'FeatureCollection',metadata:{source:'PDOK',note:'Fryslân · unchanged'},features:[{id:'sample',properties:{name:'Original'},geometry:{type:'Polygon',coordinates:[[[5,51],[6,51],[6,52],[5,51]]]}}]};
  for (const expanded of [false,true]) {
    const requests=[];
    const ctx=vm.createContext({layerDefs:[],window:{addEventListener(){}},updateLayers(){},initPerspective(){},togglePerspective(){},console,Response,Blob,DecompressionStream,TextDecoder,Uint8Array,Map,Set,fetch:async url=>{requests.push(url);return new Response(expanded?JSON.stringify(fixture):gzipSync(Buffer.from(JSON.stringify(fixture))));}});
    vm.runInContext(fs.readFileSync(path.join(root,'national-data.js'),'utf8'),ctx);
    vm.runInContext(fs.readFileSync(path.join(root,'context-layers.js'),'utf8'),ctx);
    for(const [kind,file] of [['camping','camping_sites.geojson.gz'],['projects','development_projects.geojson.gz']]) {
      const result=await ctx.window.planviewContext.load(kind);
      assert.equal(JSON.stringify(result.metadata),JSON.stringify(fixture.metadata));
      assert.equal(JSON.stringify(result.features[0].geometry),JSON.stringify(fixture.features[0].geometry));
      assert.equal(requests.at(-1),'data/'+file);
      assert.equal(await ctx.window.planviewContext.load(kind),result,'cached source keeps identity');
    }
    assert.equal(requests.length,2,'only one request per overlay');
  }
});

test('national context retains map geometry and source dates for all searchable areas', () => {
  assert.match(data.geometryMethod, /original polygon rings/);
  for (const [kind, items] of Object.entries(groups)) {
    assert.ok(items.length, kind + ' is populated');
    assert.equal(new Set(items.map(item => item.id)).size, items.length, kind + ' IDs are unique');
    const index = kind === 'town' ? data.towns : data[kind] || data.features[kind];
    assert.deepEqual(items.map(item => item.id), index.map(item => item.id), kind + ': index and full geometry agree');
    for (const item of items) {
      assert.ok(item.geometry, `${kind}/${item.id}: geometry missing`);
      assert.ok(item.extent.length === 4 && item.extent.every(Number.isFinite), item.id);
      if (kind !== 'station') {
        assert.ok(['Polygon', 'MultiPolygon'].includes(item.geometry.type), item.id);
        assert.ok(Object.hasOwn(item, 'sourceDate'), item.id + ': source date retained even if null');
        assert.match(item.sourceUrl, /^https:\/\/api\.pdok\.nl\/kadaster\/brt-top10nl\/ogc\/v1\/collections\/[^/]+\/items\/[0-9a-f-]{36}\?f=html$/, item.id + ': exact source feature URL');
      }
    }
  }
});

test('new nearby categories and holiday parks are present in the published snapshot', () => {
  const expected = {hospital: 'ziekenhuiscomplex', allotments: 'volkstuinen', recreation_area: 'recreatiegebied'};
  for (const [kind, type] of Object.entries(expected)) {
    assert.ok(data.features[kind].length > 10, kind + ': national dataset');
    assert.ok(data.features[kind].every(item => item.type === type), kind + ': exact source classification');
  }
  assert.ok(data.camping.some(item => item.type === 'vakantiepark'));
  const sites = JSON.parse(fs.readFileSync(path.join(root, 'data/camping_sites.geojson')));
  assert.equal(sites.features.length, data.camping.length);
  assert.deepEqual(new Set(sites.features.map(item => item.id)), new Set(data.camping.map(item => item.id)));
});

test('published map polygons produce geometric distance evidence, including multi-polygons', () => {
  for (const kind of ['hospital', 'allotments', 'recreation_area', 'park', 'sports']) {
    for (const item of [groups[kind][0], groups[kind].find(item => item.geometry.type === 'MultiPolygon')].filter(Boolean)) {
      const coordinates = item.geometry.type === 'Polygon' ? item.geometry.coordinates[0][0] : item.geometry.coordinates[0][0][0];
      const near = core.nearest({lng: coordinates[0], lat: coordinates[1]}, [item]);
      assert.equal(near.accuracy, 'geometry');
      assert.equal(near.km, 0);
    }
  }
});
