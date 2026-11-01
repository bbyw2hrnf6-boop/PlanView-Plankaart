import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fetchPermits,cleanPermitInput,PermitError,permitStatus,groupPermitEvents,pointInPermitParcel,parsePermitGeometry,permitGeometryRelation,titleMentionsPermitAddress,PERMIT_SRU} from '../cloud/lib/permits.mjs';

const fixture=name=>readFileSync(new URL('./fixtures/permits/'+name,import.meta.url),'utf8');
const point={lat:50.849683,lng:5.68487};
const history=fixture('maastricht-history-sru.xml');
const empty='<sru:searchRetrieveResponse xmlns:sru="urn:sru"><sru:numberOfRecords>0</sru:numberOfRecords><sru:records/></sru:searchRetrieveResponse>';
function sourceFor(id){try{return fixture(id+'.xml');}catch{return '<officiele-publicatie><gemeenteblad><zakelijke-mededeling-tekst><al/></zakelijke-mededeling-tekst></gemeenteblad></officiele-publicatie>';}}
function fakeNetwork({sru=history,parcel=fixture('maastricht-parcels.json'),addresses=fixture('maastricht-addresses.json'),source=sourceFor,fail}={}){
  const requests=[];
  const fetcher=async(url,options)=>{
    requests.push({url,options});assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.ok(options.signal);
    assert.deepEqual(Object.keys(options.headers),['Accept']);
    if(fail?.(url))return new Response('Temporary upstream failure',{status:503});
    const u=new URL(url);assert.ok(['api.pdok.nl','repository.overheid.nl'].includes(u.hostname));
    if(url.startsWith(PERMIT_SRU))return new Response(typeof sru==='function'?sru(u):sru,{headers:{'Content-Type':'application/xml'}});
    if(u.pathname.includes('/perceel/items'))return new Response(parcel);
    if(u.pathname.includes('/reverse'))return new Response(addresses);
    const id=/\/((?:gmb|stcrt|prb|wsb|bgr)-\d{4}-\d+)\.xml$/.exec(u.pathname)?.[1];assert.ok(id,'only canonical public notice XML may be fetched');
    return new Response(source(id));
  };
  return {fetcher,requests};
}

test('authentic Maastricht procedure joins an application, extension, refusal and later grant',async()=>{
  const net=fakeNetwork();const result=await fetchPermits({point},net.fetcher);
  assert.equal(result.version,1);assert.equal(result.location.parcelId,'MTT00-A-5847');
  assert.ok(result.location.addresses.includes('Brusselsestraat 10C, 6211PE Maastricht'));
  assert.equal(result.cases.length,1);const c=result.cases[0];
  assert.equal(c.caseNumber,'22-1577WB');assert.equal(c.authority,'Maastricht');assert.equal(c.status,'granted');
  assert.deepEqual(c.events.map(e=>e.status),['submitted','extended','refused','granted']);
  assert.equal(c.events.at(-1).decisionDate,'2023-06-26');
  assert.equal(c.association.kind,'address');assert.equal(c.association.certain,true);
  assert.match(c.summary,/splitsen van de woning naar 4 zelfstandige woningen/);
  assert.ok(!/DigiD|beroepschrift|naam en adres/.test(c.summary));
  assert.equal(result.coverage.complete,false);assert.equal(result.coverage.partial,false);
  assert.ok(result.coverage.warnings.includes('historical_coverage_unknown'));
  assert.equal(result.nextCursor,null);
  const query=new URL(net.requests.find(r=>r.url.startsWith(PERMIT_SRU)).url).searchParams.get('query');
  assert.match(query,/within\/etrs89 "50\.849683 5\.68487 0\.100"/);
  assert.match(query,/w\.locatiepunt within\/etrs89.* OR cd\.afgeleideLocatiegebied within\/etrs89/);
  assert.match(query,/sortBy dt\.modified\/sort.descending dt\.identifier\/sort.ascending$/);
  assert.match(query,/cql.textAndIndexes adj "Brusselsestraat 10C"/);
  assert.doesNotMatch(query,/w\.straatnaam/,'documented but unavailable production index must not be used');
});

test('authentic Stuwweg RWS notice is found through area coverage with its source reference and factual description',async()=>{
  const location={lat:50.86848656,lng:5.68907101},net=fakeNetwork({sru:fixture('rws-stuwweg-sru.xml'),parcel:fixture('rws-stuwweg-parcels.json'),addresses:fixture('rws-stuwweg-addresses.json')});
  const result=await fetchPermits({point:location},net.fetcher);assert.equal(result.cases.length,1);const c=result.cases[0],e=c.events[0];
  assert.equal(c.caseNumber,'RWSZ2026-00008173');assert.match(c.title,/RWS-2026\/23770/);assert.match(c.summary,/herinrichting van de Stuwweg/);
  assert.equal(c.association.kind,'area');assert.equal(c.association.relation,'contains_point');assert.equal(c.association.certain,false);assert.equal(c.association.broad,false);assert.equal(c.association.geometryType,'Polygon');
  assert.deepEqual(e.association,c.association);assert.match(e.sourceText,/RWSZ2026-00008173/);assert.equal(e.sourceTextTruncated,false);
  assert.equal(c.status,'unknown','a decision notice without grant/refusal language is not inferred to be a grant');
  assert.deepEqual(e.documentUrls,['https://open.rijkswaterstaat.nl/@310789/kennisgeving-besluit-vergunning-2']);
  assert.equal(result.coverage.partial,false);assert.ok(net.requests.every(r=>!r.url.includes('open.rijkswaterstaat.nl')),'RWS source links do not trigger arbitrary document downloads');
  const rdOnly=fixture('rws-stuwweg-sru.xml').replace(/<overheidwetgeving:locatiegebied>[\s\S]*?<\/overheidwetgeving:locatiegebied>/g,'');
  const rd=await fetchPermits({point:location},fakeNetwork({sru:rdOnly,parcel:fixture('rws-stuwweg-parcels.json'),addresses:fixture('rws-stuwweg-addresses.json')}).fetcher);assert.equal(rd.cases[0].association.kind,'area','bounded RD New metadata supports older notices without derived WGS84');
});

test('area geometry parser bounds untrusted WKT, preserves holes, multipart polygons and exact boundaries',()=>{
  const geometry=parsePermitGeometry('POLYGON((5 50,6 50,6 51,5 51,5 50),(5.4 50.4,5.6 50.4,5.6 50.6,5.4 50.6,5.4 50.4))');
  assert.equal(permitGeometryRelation({lat:50.2,lng:5.2},geometry),'contains_point');assert.equal(permitGeometryRelation({lat:50.5,lng:5.5},geometry),null);
  assert.equal(permitGeometryRelation({lat:50.5,lng:5.4},geometry),'contains_point','a hole boundary belongs to the geometry');
  assert.equal(permitGeometryRelation({lat:50,lng:5},geometry),'contains_point','outer vertices and edges are included');
  const multi=parsePermitGeometry('SRID=4326;MULTIPOLYGON(((5 50,5.1 50,5.1 50.1,5 50.1,5 50)),((6 51,6.1 51,6.1 51.1,6 51.1,6 51)))');
  assert.equal(multi.type,'MultiPolygon');assert.equal(permitGeometryRelation({lat:51.05,lng:6.05},multi),'contains_point');assert.equal(permitGeometryRelation({lat:50.5,lng:5.5},multi),null);
  const origin=parsePermitGeometry('SRID=28992;LINESTRING(155000 463000,155100 463100)');assert.ok(Math.abs(origin.coordinates[0][0]-5.38720621)<1e-8);assert.ok(Math.abs(origin.coordinates[0][1]-52.1551744)<1e-8);
  for(const value of ['POLYGON EMPTY','POINT(5 50)','POLYGON Z((5 50 0,6 50 0,5 51 0,5 50 0))','POLYGON((5 50,6 50,5 51))','POLYGON((500 50,6 50,5 51,500 50))','POLYGON((5 50,176000 320000,5 51,5 50))','SRID=900913;LINESTRING(5 50,6 51)','LINESTRING(5e999 50,6 51)','LINESTRING(5 50,6 51); fetch(1)','LINESTRING('+('5 50,'.repeat(10002))+'5 50)'])assert.equal(parsePermitGeometry(value),null,value.slice(0,80));
});

test('area and line associations use true parcel intersection rather than bounding boxes or effect geometry',async()=>{
  const parcel=parsePermitGeometry('POLYGON((5.2 50.2,5.3 50.2,5.3 50.3,5.2 50.3,5.2 50.2))'),p={lng:5.25,lat:50.25};
  assert.equal(permitGeometryRelation(p,parsePermitGeometry('POLYGON((5.29 50.29,5.4 50.29,5.4 50.4,5.29 50.4,5.29 50.29))'),parcel),'intersects_parcel');
  assert.equal(permitGeometryRelation(p,parsePermitGeometry('LINESTRING(5.1 50.29,5.4 50.29)'),parcel),'intersects_parcel');
  assert.equal(permitGeometryRelation(p,parsePermitGeometry('MULTILINESTRING((6 51,6.1 51.1),(5.1 50.25,5.4 50.25))'),parcel),'contains_point');
  assert.equal(permitGeometryRelation(p,parsePermitGeometry('LINESTRING(5.1 50.31,5.4 50.31)'),parcel),null);
  const hole=parsePermitGeometry('POLYGON((5 50,6 50,6 51,5 51,5 50),(5.1 50.1,5.5 50.1,5.5 50.5,5.1 50.5,5.1 50.1))');
  assert.equal(permitGeometryRelation(p,hole,parcel),null,'a parcel completely inside a hole does not intersect the source');
  const location={lat:50.86848656,lng:5.68907101},input={sru:fixture('rws-stuwweg-sru.xml').replace(/gebiedsmarkering/g,'effectgebied'),parcel:fixture('rws-stuwweg-parcels.json'),addresses:fixture('rws-stuwweg-addresses.json')};
  const r=await fetchPermits({point:location},fakeNetwork(input).fetcher);assert.equal(r.cases[0].association.kind,'nearby','an effect area cannot claim to locate the works');
});

test('broad area markings stay uncertain and duplicate point/area candidates fetch one notice only',async()=>{
  const sru=fixture('rws-stuwweg-sru.xml').replace(/<overheidwetgeving:locatiegebied>[\s\S]*?<\/overheidwetgeving:locatiegebied>/g,'<overheidwetgeving:locatiegebied>POLYGON((5 50,6 50,6 51,5 51,5 50))</overheidwetgeving:locatiegebied>');
  const duplicated=sru.replace('</sru:records>',sru.match(/<sru:record>[\s\S]*?<\/sru:record>/)[0]+'</sru:records>'),net=fakeNetwork({sru:duplicated});
  const result=await fetchPermits({point},net.fetcher);assert.equal(result.cases.length,1);assert.equal(result.cases[0].association.broad,true);assert.equal(result.cases[0].association.certain,false);
  assert.equal(net.requests.filter(r=>r.url.includes('/stcrt-2026-35213/1/xml/')).length,1);
});

test('notice text for questions is inert, bounded and explicitly marked when incomplete',async()=>{
  const body='Description '+('a'.repeat(13000)),net=fakeNetwork({sru:fixture('rws-stuwweg-sru.xml'),source:()=>`<officiele-publicatie><zakelijke-mededeling-tekst><al>${body}</al></zakelijke-mededeling-tekst></officiele-publicatie>`});
  const result=await fetchPermits({point},net.fetcher),e=result.cases[0].events[0];assert.equal(e.sourceText.length,12000);assert.equal(e.sourceTextTruncated,true);assert.ok(result.coverage.warnings.includes('notice_text_truncated'));assert.equal(result.coverage.partial,true);
  const controller=new AbortController();controller.abort();const aborting=async(url,options)=>{if(options.signal.aborted)throw new DOMException('Aborted','AbortError');return net.fetcher(url,options);};
  await assert.rejects(fetchPermits({point},aborting,controller.signal),e=>e.status===502);
});

test('only building-related environmental permit notices survive actual metadata and title filtering',async()=>{
  const net=fakeNetwork({sru:fixture('maastricht-sru.xml')});const result=await fetchPermits({point},net.fetcher);
  assert.ok(result.cases.length>0);assert.ok(result.cases.every(c=>!/kappen van (?:een |de )?(?:dode )?boom/i.test(c.title)));
  assert.ok(!net.requests.some(r=>/gmb-2026-(?:415318|370381)\/1\/xml/.test(r.url)),'tree permits do not trigger document downloads');
  assert.ok(result.coverage.hasMore);assert.ok(result.nextCursor);assert.equal(result.coverage.total,42);
});

test('nearest BAG address outside the selected parcel never becomes its address identity',async()=>{
  const docs=JSON.parse(fixture('maastricht-addresses.json'));for(const d of docs.response.docs){d.geometrie_ll='POINT(5.70 50.85)';d.centroide_ll=d.geometrie_ll;}
  const net=fakeNetwork({addresses:JSON.stringify(docs)}),result=await fetchPermits({point},net.fetcher);
  assert.deepEqual(result.location.addresses,[]);assert.ok(result.cases.every(c=>c.association.kind!=='address'&&!c.association.certain));
  const q=new URL(net.requests.find(r=>r.url.startsWith(PERMIT_SRU)).url).searchParams.get('query');assert.ok(!q.includes('textAndIndexes'));
});

test('14, 140, 14A and 14A-1 cannot become the same address by substring matching',async()=>{
  for(const replacement of ['140','14','10A']){
    const altered=history.replace(/<overheidwetgeving:huisnummer>10<\/overheidwetgeving:huisnummer>/g,`<overheidwetgeving:huisnummer>${replacement}<\/overheidwetgeving:huisnummer>`);
    const result=await fetchPermits({point},fakeNetwork({sru:altered}).fetcher);assert.ok(result.cases.every(c=>c.association.kind!=='address'&&!c.association.certain));
  }
  const addition=history.replace(/<overheidwetgeving:huisletter>C<\/overheidwetgeving:huisletter>/g,'<overheidwetgeving:huisletter>C</overheidwetgeving:huisletter><overheidwetgeving:huisnummertoevoeging>999</overheidwetgeving:huisnummertoevoeging>');
  assert.ok((await fetchPermits({point},fakeNetwork({sru:addition}).fetcher)).cases.every(c=>c.association.kind!=='address'));
});

test('parcel polygons respect holes and multiple parts; matching publication geometry remains uncertain',async()=>{
  const ring=[[5,50],[6,50],[6,51],[5,51],[5,50]],hole=[[5.4,50.4],[5.6,50.4],[5.6,50.6],[5.4,50.6],[5.4,50.4]];
  assert.equal(pointInPermitParcel({lat:50.2,lng:5.2},{type:'Polygon',coordinates:[ring,hole]}),true);
  assert.equal(pointInPermitParcel({lat:50.5,lng:5.5},{type:'Polygon',coordinates:[ring,hole]}),false);
  const altered=history.replace(/<overheidwetgeving:Adres>/g,'<overheidwetgeving:Punt>').replace(/<\/overheidwetgeving:Adres>/g,'</overheidwetgeving:Punt>').replace(/<dcterms:title>[^<]*<\/dcterms:title>/g,'<dcterms:title>Bouwactiviteit Maastricht</dcterms:title>');
  const result=await fetchPermits({point},fakeNetwork({sru:altered}).fetcher);assert.equal(result.cases[0].association.kind,'mapped_location');assert.equal(result.cases[0].association.certain,false);
});

test('missing or ambiguous BRK cannot promote a nearby notice to a known parcel',async()=>{
  const data=JSON.parse(fixture('maastricht-parcels.json'));data.features.push(structuredClone(data.features[0]));
  for(const parcel of [JSON.stringify({...data,features:[]}),JSON.stringify(data)]){
    const result=await fetchPermits({point,parcelId:'MTT00-A-5847'},fakeNetwork({parcel}).fetcher);
    assert.equal(result.location.parcelId,null);assert.deepEqual(result.location.addresses,[]);assert.ok(result.cases.every(c=>c.association.kind==='nearby'&&!c.association.certain));
  }
  const failed=await fetchPermits({point},fakeNetwork({fail:u=>u.includes('/perceel/items')}).fetcher);assert.equal(failed.coverage.partial,true);assert.ok(failed.coverage.warnings.includes('parcel_unavailable'));
});

test('unsupported supplied parcel ID is never authority for a point',async()=>{
  const result=await fetchPermits({point,parcelId:'OTHER00-Z-1234'},fakeNetwork().fetcher);
  assert.equal(result.location.parcelId,'MTT00-A-5847');assert.ok(result.coverage.warnings.includes('parcel_identity_changed'));
});

test('explicit parcel association requires a cadastral municipality, section and number together',async()=>{
  const mark='<overheidwetgeving:gebiedsmarkering><overheidwetgeving:Perceel><overheidwetgeving:perceelnummer>5847</overheidwetgeving:perceelnummer><overheidwetgeving:kadastraleSectie>A</overheidwetgeving:kadastraleSectie><overheidwetgeving:ligtInGemeente>Maastricht</overheidwetgeving:ligtInGemeente>CODE</overheidwetgeving:Perceel></overheidwetgeving:gebiedsmarkering>';
  const withoutAddress=history.replace(/<overheidwetgeving:Adres>/g,'<overheidwetgeving:Punt>').replace(/<\/overheidwetgeving:Adres>/g,'</overheidwetgeving:Punt>').replace(/<dcterms:title>[^<]*<\/dcterms:title>/g,'<dcterms:title>Bouwactiviteit Maastricht</dcterms:title>');
  for(const [code,expected] of [['','mapped_location'],['<overheidwetgeving:kadastraleGemeenteCode>MTT00</overheidwetgeving:kadastraleGemeenteCode>','parcel'],['<overheidwetgeving:kadastraleGemeenteCode>ABC00</overheidwetgeving:kadastraleGemeenteCode>','mapped_location']]){
    const sru=withoutAddress.replace(/<\/overheidwetgeving:tpmeta>/g,mark.replace('CODE',code)+'</overheidwetgeving:tpmeta>');const r=await fetchPermits({point},fakeNetwork({sru}).fetcher);assert.equal(r.cases[0].association.kind,expected);assert.equal(r.cases[0].association.certain,expected==='parcel');
  }
  const split='<overheidwetgeving:gebiedsmarkering><overheidwetgeving:Perceel><overheidwetgeving:perceelnummer>5847</overheidwetgeving:perceelnummer></overheidwetgeving:Perceel><overheidwetgeving:Perceel><overheidwetgeving:kadastraleSectie>A</overheidwetgeving:kadastraleSectie><overheidwetgeving:kadastraleGemeenteCode>MTT00</overheidwetgeving:kadastraleGemeenteCode></overheidwetgeving:Perceel></overheidwetgeving:gebiedsmarkering>';
  const r=await fetchPermits({point},fakeNetwork({sru:withoutAddress.replace(/<\/overheidwetgeving:tpmeta>/g,split+'</overheidwetgeving:tpmeta>')}).fetcher);assert.equal(r.cases[0].association.kind,'mapped_location');assert.equal(r.cases[0].association.certain,false);
});

test('refusal, proposed decision, withdrawal, revocation and extension are distinct states',()=>{
  const rwsApplication='Kennisgeving vergunningaanvraag voor Instroomvoorziening bouwen Stuwweg Maastricht.';
  assert.equal(permitStatus(rwsApplication,'De minister geeft kennis van de aanvraag om een vergunning op grond van DSO - Omgevingswet.'),'submitted');
  assert.equal(permitStatus('Besluit vergunningaanvraag Stuwweg Maastricht'),'unknown');
  assert.equal(permitStatus(rwsApplication,'Besluit: vergunning geweigerd'),'refused');
  assert.equal(permitStatus(rwsApplication,'Besluit: vergunning verleend'),'granted');
  assert.equal(permitStatus(rwsApplication,'Besluit: beslissing genomen'),'unknown');
  assert.equal(permitStatus('Ontwerpbesluit omgevingsvergunning verleend'),'draft');
  assert.equal(permitStatus('Voornemen weigering omgevingsvergunning'),'draft');
  assert.equal(permitStatus('Verlenging beslistermijn omgevingsvergunning verleend'),'extended');
  assert.equal(permitStatus('Intrekking aanvraag omgevingsvergunning'),'withdrawn');
  assert.equal(permitStatus('Intrekking omgevingsvergunning'),'revoked');
  assert.equal(permitStatus('Omgevingsvergunning geweigerd'),'refused');
  assert.equal(permitStatus('Geweigerde omgevingsvergunning voor het bouwen van een woning'),'refused');
  assert.equal(permitStatus('Verleende omgevingsvergunning voor het bouwen van een woning'),'granted');
  assert.equal(permitStatus('Ontwerp verleende omgevingsvergunning voor het bouwen'),'draft');
  assert.equal(permitStatus('Omgevingsvergunning gedeeltelijk verleend en gedeeltelijk geweigerd'),'mixed');
  assert.equal(permitStatus('Besluit genomen omgevingsvergunning'),'unknown');
  assert.equal(permitStatus('Omgevingsvergunning niet verleend'),'unknown');
  assert.equal(permitStatus('Omgevingsvergunning is niet ingetrokken'),'unknown');
  assert.equal(permitStatus('Omgevingsvergunning via beslissing op bezwaar','Besluit: van rechtswege verleend'),'granted');
  assert.equal(permitStatus('Aanvraag omgevingsvergunning','Binnen zes weken kan bezwaar worden gemaakt tegen een verleende vergunning.'),'submitted');
});

function event(id,status,date,caseNumber='ABC-123',authority='Maastricht'){
  return {authority,association:{kind:'nearby',certain:false},event:{id,title:id,summary:id,status,date,caseNumber,url:'https://zoek.officielebekendmakingen.nl/gmb-2023-1.html',documentUrls:[]}};
}
test('case grouping requires the same exact reference and authority; later procedural notices preserve a decision',()=>{
  const result=groupPermitEvents([event('a','refused','2023-01-01'),event('b','granted','2023-02-01'),event('c','extended','2023-03-01'),event('d','submitted','2023-04-01'),event('e','refused','2023-01-01','ABC123'),event('f','refused','2023-01-01','ABC-123','Other authority'),event('g','submitted','2023-01-01',null),event('h','submitted','2023-01-01',null)]);
  assert.equal(result.length,5);const g=result.find(c=>c.events.some(e=>e.id==='a'));assert.equal(g.status,'granted');assert.deepEqual(g.events.map(e=>e.id),['a','b','c','d']);
  const revoked=groupPermitEvents([event('a','granted','2023-01-01'),event('b','revoked','2023-02-01')]);assert.equal(revoked[0].status,'revoked');
  const province=event('p','refused','2023-01-01','ABC-123','Groningen'),municipality=event('m','granted','2023-01-02','ABC-123','Groningen');province.authorityKey='OVERHEID.Provincie|Groningen';municipality.authorityKey='OVERHEID.Gemeente|Groningen';assert.equal(groupPermitEvents([province,municipality]).length,2,'same-name province and municipality remain different authorities');
});

test('the latest actual decision date wins when notices are published out of decision order',()=>{
  const refusal=event('old-refusal','refused','2023-04-03'),grant=event('new-grant','granted','2023-04-01');refusal.event.decisionDate='2023-03-01';grant.event.decisionDate='2023-03-30';
  const [c]=groupPermitEvents([refusal,grant]);assert.equal(c.status,'granted');assert.equal(c.statusDate,'2023-03-30');assert.equal(c.statusEventId,'new-grant');assert.equal(c.latestDate,'2023-04-03');assert.deepEqual(c.events.map(e=>e.id),['new-grant','old-refusal']);
  const laterMixed=event('mixed','mixed','2023-05-01');assert.equal(groupPermitEvents([grant,laterMixed])[0].status,'mixed');
});

test('opaque pagination is location-bound, date-bound and bounded; appending retains stable case identities',async()=>{
  const paged=history.replace('<sru:numberOfRecords>4</sru:numberOfRecords>','<sru:numberOfRecords>30</sru:numberOfRecords>').replace('</sru:records>','</sru:records><sru:nextRecordPosition>26</sru:nextRecordPosition>');
  const net=fakeNetwork({sru:u=>u.searchParams.get('startRecord')==='26'?history:paged});
  const first=await fetchPermits({point},net.fetcher);assert.equal(first.coverage.hasMore,true);assert.match(first.nextCursor,/^[A-Za-z0-9_-]+$/);
  const second=await fetchPermits({point,cursor:first.nextCursor},net.fetcher);assert.equal(second.nextCursor,null);assert.equal(second.cases[0].id,first.cases[0].id);
  await assert.rejects(fetchPermits({point:{lat:50.85,lng:5.69},cursor:first.nextCursor},net.fetcher),e=>e.status===400&&e.code==='invalid_permit_cursor');
  for(const value of [{v:1,p:'50.849683,5.684870',s:1001,d:new Date().toISOString().slice(0,10)},{v:1,p:'50.849683,5.684870',s:26,d:'2020-01-01'}]){
    const cursor=btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');await assert.rejects(fetchPermits({point,cursor},net.fetcher),e=>e.status===400);
  }
});

test('public requests are cached across repeated visits and no search query is accepted from the client',async()=>{
  const net=fakeNetwork();await fetchPermits({point},net.fetcher);const n=net.requests.length;await fetchPermits({point},net.fetcher);assert.equal(net.requests.length,n);
  for(const input of [{point,query:'all records'},{point,url:'https://evil.test'},{point,cursor:null},{point,parcelId:null},{point:{...point,url:'https://evil.test'}},{point:{lat:NaN,lng:5}},{point:{lat:51,lng:Infinity}},{point:{lat:'51',lng:5}},{point:{lat:0,lng:0}},{point,parcelId:'" OR cql.allRecords=1'}])assert.throws(()=>cleanPermitInput(input),e=>e instanceof PermitError&&e.status===400);
});

test('upstream source loss is partial, but search failure is an error rather than an empty history',async()=>{
  const partial=await fetchPermits({point},fakeNetwork({fail:u=>u.includes('/xml/')}).fetcher);
  assert.ok(partial.cases.length>0);assert.equal(partial.coverage.partial,true);assert.ok(partial.coverage.warnings.includes('notice_document_unavailable'));assert.ok(partial.cases.every(c=>c.events.every(e=>!e.sourceAvailable)));
  await assert.rejects(fetchPermits({point},fakeNetwork({fail:u=>u.startsWith(PERMIT_SRU)}).fetcher),e=>e.status===502&&e.code==='permit_sources_unavailable');
  const result=await fetchPermits({point},fakeNetwork({sru:empty}).fetcher);assert.deepEqual(result.cases,[]);assert.equal(result.coverage.available,true);assert.equal(result.coverage.complete,false);
});

test('untrusted XML stays inert; external entities, source redirects and arbitrary source hosts are not followed',async()=>{
  const source=()=> '<!DOCTYPE a [<!ENTITY secret SYSTEM "file:///etc/passwd">]><officiele-publicatie><al>&secret;</al></officiele-publicatie>';
  const result=await fetchPermits({point},fakeNetwork({source}).fetcher);assert.ok(result.coverage.partial);assert.ok(!JSON.stringify(result).includes('passwd'));
  const hostile=history.replace(/<gzd:url>[^<]+<\/gzd:url>/g,'<gzd:url>https://evil.test/private.xml</gzd:url>'),net=fakeNetwork({sru:hostile});
  const safe=await fetchPermits({point},net.fetcher);assert.ok(safe.coverage.partial);assert.ok(net.requests.every(r=>!r.url.includes('evil.test')));
  await assert.rejects(fetchPermits({point},fakeNetwork({sru:'<!DOCTYPE a [<!ENTITY secret SYSTEM "file:///etc/passwd">]>'+empty}).fetcher),e=>e.status===502);
});

test('request admission and upstream throttling return useful busy errors without retries',async()=>{
  const net=fakeNetwork({sru:empty});for(let n=0;n<90;n++)await fetchPermits({point},net.fetcher);
  await assert.rejects(fetchPermits({point},net.fetcher),e=>e.status===429&&e.code==='permit_rate_limit');
  const busy=async(url)=>url.startsWith(PERMIT_SRU)?new Response('',{status:429}):new Response(url.includes('/reverse')?fixture('maastricht-addresses.json'):fixture('maastricht-parcels.json'));
  await assert.rejects(fetchPermits({point},busy),e=>e.status===503&&e.code==='permit_service_busy');
});


test('title address matching keeps complete house numbers, locality and neighbours distinct',()=>{
  const a={street:'Singel',number:'8',letter:'',addition:'',place:'Maastricht'};
  for(const title of ['Bouwen woning Singel 8 te Maastricht','Maastricht - bouwen Singel 8.','Bouwen SINGEL 8, Maastricht','Bouwen Singel 8, 6211PE Maastricht'])assert.equal(titleMentionsPermitAddress(title,a),true,title);
  assert.equal(titleMentionsPermitAddress('Bouwen Singel 8',a,'Maastricht'),true);
  for(const title of ['Singel 80 Maastricht','Singel 8A Maastricht','Singel 8 A Maastricht','Singel 8-1 Maastricht','Singel 8 / 1 Maastricht','Singel 8-10 Maastricht','Singel 8 en 10 Maastricht','Singel 8 t/m 10 Maastricht','Singel 8, 10 Maastricht','Nieuwe Singelstraat 8 Maastricht','Nieuwe Singel 8 Maastricht','Singel 8 bis Maastricht','tegenover Singel 8 Maastricht','naast de Singel 8 Maastricht','ter hoogte van Singel 8 Maastricht','Singel 8 te Amsterdam','Singel 8'])assert.equal(titleMentionsPermitAddress(title,a),false,title);
  assert.equal(titleMentionsPermitAddress('Singel 8 te Amsterdam',a,'Maastricht'),false);
  assert.equal(titleMentionsPermitAddress('Singel 8',a,'Amsterdam'),false);
  const unit={...a,letter:'A',addition:'1'};
  assert.equal(titleMentionsPermitAddress('Singel 8A-1 Maastricht',unit),true);
  assert.equal(titleMentionsPermitAddress('Singel 8 A 1 Maastricht',unit),true);
  for(const title of ['Singel 8A-10 Maastricht','Singel 8A Maastricht','Singel 8B-1 Maastricht'])assert.equal(titleMentionsPermitAddress(title,unit),false);
});

test('missing structured addresses allow title inference but never a confirmed parcel assertion',async()=>{
  const sru=history.replace(/<overheidwetgeving:Adres>[\s\S]*?<\/overheidwetgeving:Adres>/g,'');
  const result=await fetchPermits({point},fakeNetwork({sru}).fetcher);
  assert.equal(result.cases[0].association.kind,'title_address');assert.equal(result.cases[0].association.certain,false);
  assert.match(result.cases[0].association.label,/Brusselsestraat 10C/);
  assert.ok(result.cases[0].events.some(e=>e.association.kind==='title_address'));
  const docs=JSON.parse(fixture('maastricht-addresses.json'));for(const d of docs.response.docs)d.geometrie_ll=d.centroide_ll='POINT(5.70 50.85)';
  const outside=await fetchPermits({point},fakeNetwork({sru,addresses:JSON.stringify(docs)}).fetcher);
  assert.ok(outside.cases.every(c=>c.association.kind!=='title_address'));
});
