import test from 'node:test';
import assert from 'node:assert/strict';
import {DSO_BASE, xmlText, extractDocumentSources, fetchPointCorpus} from '../cloud/lib/rule-sources.mjs';

// Synthetic Dutch legal wording: exercises the actual STOP/Ozon response schema.
const doc={identificatie:'/akn/nl/act/gm9999/2024/omgevingsplan',citeerTitel:'Fixture omgevingsplan',
  expressionId:'/akn/nl/act/gm9999/2024/omgevingsplan/nld@3',type:{waarde:'Omgevingsplan'},
  publicatieID:'https://identifier.overheid.nl/akn/nl/act/gm9999/2024/omgevingsplan/nld@3',
  geregistreerdMet:{beginInwerking:'2026-01-01'}};
const component=(id,type,inhoud='',nodes=[],kop='')=>({identificatie:id,expressie:id.replace(/^gm9999_3__/,''),type,inhoud,kop,_embedded:{documentComponenten:nodes}});
const structure={_embedded:{documentComponenten:[
  component('gm9999_3__art_2','ARTIKEL','',[
    component('gm9999_3__art_2__para_1','LID','<Inhoud><Al>Een zwembad heeft een bouwhoogte van maximaal 2 m. Zie <IntRef ref="art_3">artikel 3</IntRef>.</Al></Inhoud>',[],'<Kop><Nummer>1.</Nummer></Kop>'),
    component('gm9999_3__art_2__para_2','LID','<Inhoud><Al>Dit geldt niet in het beschermde gebied.</Al></Inhoud>',[],'<Kop><Nummer>2.</Nummer></Kop>')
  ],'<Kop><Label>Artikel</Label><Nummer>2</Nummer><Opschrift>Zwembaden</Opschrift></Kop>'),
  component('gm9999_3__art_3','ARTIKEL','<Inhoud><Al>Een zwembad is een bassin, behoudens <ExtRef ref="/akn/nl/act/mnre0000/2024/bbl">landelijke uitzonderingen</ExtRef>.</Al></Inhoud>',[],'<Kop><Label>Artikel</Label><Nummer>3</Nummer><Opschrift>Definitie</Opschrift></Kop>'),
  {...component('gm9999_3__art_4','ARTIKEL','<Inhoud>Een ingetrokken regel.</Inhoud>'),vervallen:true}
]}};
const annotations={geselecteerdeLocatieRefs:['local'],locaties:[{identificatie:'local',locatieType:'Gebied',noemer:'Fixture wijk'},{identificatie:'elsewhere',locatieType:'Gebied'}],
  regelteksten:[{identificatie:'r1',wId:'gm9999_3__art_2__para_1'},{identificatie:'r2',wId:'gm9999_3__art_2__para_2'},{identificatie:'r4',wId:'gm9999_3__art_4'}],
  regelsVoorIedereen:[{identificatie:'legal1',locatieRefs:['local'],regeltekstRef:'r1'},
    {identificatie:'legal2',locatieRefs:['elsewhere'],regeltekstRef:'r2'},
    {identificatie:'legal4',locatieRefs:['local'],regeltekstRef:'r4'}]};

test('joins the selected leaf, keeps sibling exceptions and references contextual, excludes revoked text',()=>{
  const result=extractDocumentSources(doc,structure,annotations,{asOf:'2026-10-17',availableAt:'2026-10-17T10:00:00Z'});
  assert.equal(result.sources.length,3);
  const first=result.sources.find(x=>x.componentId.endsWith('para_1'));
  assert.equal(first.applicability,'point');assert.equal(first.scope,'specific-area');assert.deepEqual(first.annotationIds,['legal1']);
  assert.match(first.text,/maximaal 2 m/);assert.equal(first.expressionId,doc.expressionId);assert.equal(first.url,doc.publicatieID);
  assert.equal(result.sources.find(x=>x.componentId.endsWith('para_2')).applicability,'document-context');
  assert.equal(result.sources.find(x=>x.componentId.endsWith('art_3')).applicability,'document-context');
  assert.ok(result.warnings.some(x=>/external legislation/.test(x)));
  assert.ok(!result.sources.some(x=>/ingetrokken/.test(x.text)));
});

test('an annotated parent selects descendants, and direct annotation upgrades contextual siblings',()=>{
  const a=structuredClone(annotations);a.regelteksten.push({identificatie:'parent',wId:'gm9999_3__art_2'});
  a.regelsVoorIedereen.push({identificatie:'legal-parent',locatieRefs:['local'],regeltekstRef:'parent'});
  const result=extractDocumentSources(doc,structure,a);
  assert.equal(result.sources.find(x=>x.componentId.endsWith('para_2')).applicability,'point');
});

test('no selected locations cannot turn document relevance into point evidence',()=>{
  const result=extractDocumentSources(doc,structure,{...annotations,geselecteerdeLocatieRefs:[]});
  assert.equal(result.sources.length,0);assert.ok(result.warnings.some(x=>/no selected location/.test(x)));
});

test('instruction rules remain distinct from rules for citizens; free-text annotation joins work',()=>{
  const a={geselecteerdeLocatieRefs:['local'],locaties:annotations.locaties,
    regelteksten:annotations.regelteksten,instructieregels:[{identificatie:'government-only',locatieRefs:['local'],regeltekstRef:'r1'}]};
  const result=extractDocumentSources(doc,structure,a);
  assert.deepEqual(result.sources.find(x=>x.applicability==='point').legalRuleKinds,['instructieregels']);
  const free={geselecteerdeLocatieRefs:['local'],locaties:annotations.locaties,
    divisieteksten:[{identificatie:'t1',wId:'gm9999_3__art_2__para_1'}],tekstdelen:[{identificatie:'text1',locatieRefs:['local'],divisietekstRef:'t1'}]};
  assert.equal(extractDocumentSources(doc,structure,free).sources.find(x=>x.applicability==='point').componentId,'gm9999_3__art_2__para_1');
});

test('XML is inert, entity decoding preserves readable inequalities, external entities are rejected',()=>{
  assert.equal(xmlText('<Inhoud><Al>Hoogte &lt; 3 m &#38; &quot;pool&quot;.</Al></Inhoud>'),'Hoogte < 3 m & "pool".');
  assert.equal(xmlText('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><Al>&x;</Al>'),'');
  assert.equal(xmlText('<Al>2 m</Al><Al>uitzondering</Al>'),'2 m\n\nuitzondering');
});

test('fetch freezes the temporal scope, uses fixed hosts/point body, never hides a missing instrument',async()=>{
  const other={...doc,identificatie:'/akn/nl/act/ws9999/2024/verordening',type:{waarde:'Waterschapsverordening'}};
  const requests=[];
  const fake=async(url,opts)=>{
    requests.push({url,opts});assert.ok(url.startsWith(DSO_BASE+'/'));assert.equal(opts.redirect,'error');
    const u=new URL(url);assert.equal(u.searchParams.get('geldigOp'),'2026-10-17');assert.equal(u.searchParams.get('inWerkingOp'),'2026-10-17');
    assert.equal(u.searchParams.get('beschikbaarOp'),'2026-10-17T10:00:00Z');
    if(url.includes('/regelingen/_zoek?'))return Response.json({_embedded:{regelingen:[doc,other]},_links:{}});
    if(url.includes('_akn_nl_act_ws9999'))return new Response('{}',{status:503});
    if(url.includes('documentstructuur?'))return Response.json(structure);
    assert.equal(opts.headers['Content-Crs'],'http://www.opengis.net/def/crs/EPSG/0/28992');
    assert.deepEqual(JSON.parse(opts.body),{geometrie:{type:'Point',coordinates:[176000,318000]}});return Response.json(annotations);
  };
  const result=await fetchPointCorpus({x:176000,y:318000},'fixture-key',fake,{now:new Date('2026-10-17T10:00:00Z')});
  assert.equal(result.coverage.complete,false);assert.equal(result.coverage.legalCompleteness,false);
  assert.equal(result.coverage.documentsAvailable,2);assert.equal(result.coverage.documentsChecked,1);
  assert.equal(result.failures.length,1);assert.ok(result.sources.some(x=>x.applicability==='point'));
  assert.ok(result.coverage.limits.some(x=>/IMRO/.test(x)));assert.ok(!JSON.stringify(result).includes('fixture-key'));
});

test('rejects bad points and keys without network, including NaN and Infinity',async()=>{
  let called=false;const fake=()=>{called=true;throw new Error('not expected');};
  for(const p of [{x:NaN,y:300000},{x:Infinity,y:300000},{x:0,y:0}])await assert.rejects(fetchPointCorpus(p,'fixture-key',fake));
  await assert.rejects(fetchPointCorpus({x:176000,y:318000},'',fake));assert.equal(called,false);
});

test('includes national building rules, excludes policy documents, and marks oversized instruments unavailable',async()=>{
  const bbl={...doc,identificatie:'/akn/nl/act/mnre9999/2024/BWBR9999999',citeerTitel:'Besluit bouwwerken leefomgeving',type:{waarde:'AMvB'}};
  const policy={...doc,identificatie:'/akn/nl/act/pv99/2024/visie',type:{waarde:'Omgevingsvisie'}};
  const fake=async(url)=>{
    if(url.includes('/regelingen/_zoek?'))return Response.json({_embedded:{regelingen:[bbl,policy]},_links:{}});
    return new Response('{}',{headers:{'content-length':'6000001'}});
  };
  const result=await fetchPointCorpus({x:176000,y:318000},'fixture-key',fake,{now:new Date('2026-10-17T10:00:00Z')});
  assert.equal(result.coverage.documentsAvailable,1);assert.equal(result.coverage.discoveredDocuments,2);
  assert.equal(result.failures[0].title,'Besluit bouwwerken leefomgeving');assert.equal(result.coverage.complete,false);
});

test('legal day follows Netherlands time even before midnight UTC',async()=>{
  const fake=async(url)=>{assert.equal(new URL(url).searchParams.get('geldigOp'),'2026-10-17');return Response.json({_embedded:{regelingen:[]},_links:{}});};
  const result=await fetchPointCorpus({x:176000,y:318000},'fixture-key',fake,{now:new Date('2026-10-16T22:30:00Z')});
  assert.equal(result.asOf,'2026-10-17');assert.equal(result.availableAt,'2026-10-16T22:30:00Z');
});
