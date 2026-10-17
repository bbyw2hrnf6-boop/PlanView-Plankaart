/** Point-filtered, source-owned DSO rule text. No credentials are persisted.
 * Inject fetcher for fixtures; all network destinations and request shapes are fixed.
 */
export const DSO_BASE = 'https://service.omgevingswet.overheid.nl/publiek/omgevingsdocumenten/api/presenteren/v8';
const RD_CRS = 'http://www.opengis.net/def/crs/EPSG/0/28992';
const MAX_DOCUMENTS = 12, MAX_PAGES = 3, MAX_BYTES = 6_000_000;
const documentCache = new Map();
const payloadSizes = new WeakMap();
let cachedBytes = 0;
const LEGAL_TYPES = new Set(['Omgevingsplan', 'Omgevingsverordening', 'Waterschapsverordening',
  'AMvB', 'Ministeriële Regeling', 'Voorbeschermingsregels Omgevingsplan',
  'Voorbeschermingsregels Omgevingsverordening', 'Projectbesluit']);
const BLOCKS = /<\/?(?:[\w.-]+:)?(?:Al|Li|Lid|Lijst|Tabel|Tbody|Thead|Tr|Kop|Opschrift|Inhoud|Nummer|Label|Begrip|Definitie|Begrippenlijst)(?:\s[^<>]*?)?\s*\/?>/gi;
const ENTITIES = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};

export function xmlText(value) {
  if (typeof value !== 'string' || value.length > 2_000_000) return '';
  // STOP content is treated only as inert text. Never resolve entities or execute markup.
  if (/<!DOCTYPE|<!ENTITY/i.test(value)) return '';
  return value.replace(/<\?(?:[^?]|\?(?!>))*\?>/g,'').replace(BLOCKS,'\n')
    .replace(/<[^<>]*>/g,' ').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all,name) => {
      if (name[0] !== '#') return ENTITIES[name] ?? all;
      const n = name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2),16) : parseInt(name.slice(1),10);
      return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
    }).replace(/[ \t\r\f]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}

function children(node) { return Array.isArray(node?._embedded?.documentComponenten) ? node._embedded.documentComponenten : []; }
function str(value, max=500) { return typeof value === 'string' ? value.slice(0,max) : ''; }
function val(value) { return value && typeof value === 'object' ? str(value.waarde) : str(value); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function safeOfficial(value) {
  try { const u=new URL(value); return u.protocol==='https:' && (u.hostname==='overheid.nl'||u.hostname.endsWith('.overheid.nl')) && !u.username && !u.password ? u.href : null; }
  catch { return null; }
}
function identifier(id) {
  if (!/^\/akn\/nl\/act\/[A-Za-z0-9_-]+\/\d{4}\/[A-Za-z0-9_.;-]{1,220}$/.test(id||'')) throw new Error('Invalid official regulation identifier');
  return id.replace(/[\/-]/g,'_');
}
function refTargets(xml) {
  if (typeof xml !== 'string' || xml.length > 2_000_000) return [];
  return unique([...xml.matchAll(/<(?:[\w.-]+:)?IntRef\b[^<>]*\bref=["']([^"']{1,400})["'][^<>]*>/gi)].map(m=>m[1]));
}
function externalRefs(xml) {
  if (typeof xml !== 'string' || xml.length > 2_000_000) return [];
  return unique([...xml.matchAll(/<(?:[\w.-]+:)?(?:ExtRef|ExtIORef|IORef)\b[^<>]*\bref=["']([^"']{1,1000})["'][^<>]*>/gi)].map(m=>m[1]));
}
function componentIndex(structure) {
  const index=new Map(), expressions=new Map(); let visited=0;
  const walk=(node,parents=[],depth=0) => {
    if (depth>40 || ++visited>60_000) throw new Error('Official document structure exceeds retrieval limits');
    for(const item of children(node)) {
      if (!item || typeof item !== 'object') continue;
      const id=str(item.identificatie,400); if (!id) continue;
      const entry={item,parents}; index.set(id,entry);
      if (typeof item.expressie === 'string') expressions.set(item.expressie,entry);
      walk(item,[...parents,item],depth+1);
    }
  }; walk(structure); return {index,expressions};
}

/** Annotation join is the only path to applicability:'point'.
 * Geographically selected sibling/definition context never inherits applicability.
 */
export function extractDocumentSources(document, structure, annotations, {asOf='',availableAt=''}={}) {
  const warnings=[], {index,expressions}=componentIndex(structure);
  const selected=new Set(Array.isArray(annotations?.geselecteerdeLocatieRefs)?annotations.geselecteerdeLocatieRefs:[]);
  const locations=new Map((annotations?.locaties||[]).filter(x=>x&&typeof x==='object').map(x=>[x.identificatie,x]));
  const textRefs=new Map();
  for(const collection of ['regelteksten','divisies','divisieteksten']) for(const item of annotations?.[collection]||[]) {
    if(item&&typeof item.identificatie==='string'&&typeof item.wId==='string') textRefs.set(item.identificatie,item.wId);
  }
  const matches=new Map();
  for(const collection of ['regelsVoorIedereen','instructieregels','omgevingswaarderegels','tekstdelen']) {
    for(const rule of annotations?.[collection]||[]) {
      if(!rule || typeof rule !== 'object') continue;
      const refs=(rule.locatieRefs||[]).filter(ref=>selected.has(ref)); if(!refs.length) continue;
      const target=textRefs.get(rule.regeltekstRef||rule.divisietekstRef||rule.divisieRef);
      if(!target) { warnings.push('An applicable annotation has no resolvable text reference.'); continue; }
      const record=matches.get(target)||{rules:[],locations:[],ruleKinds:[],idealisations:[]};
      record.rules.push(str(rule.identificatie,300)); record.locations.push(...refs);
      record.ruleKinds.push(collection); record.idealisations.push(val(rule.idealisatie)); matches.set(target,record);
    }
  }
  if(!selected.size) warnings.push('DSO returned no selected location identifiers; document text cannot be certified as point-filtered.');
  const sources=new Map(), pendingContext=new Set(), unresolved=new Set();
  const add=(entry, applicability, annotation=null, via='')=>{
    const item=entry.item; if(item.vervallen||item.gereserveerd) return;
    const id=str(item.identificatie,400), raw=item.inhoud;
    const text=xmlText(raw);
    if(!text){if(typeof raw==='string'&&raw.trim())warnings.push('A text component could not be safely parsed within the text limits.');return;}
    if(sources.has(id)&&sources.get(id).applicability==='point') return;
    const headings=entry.parents.map(x=>xmlText(x.kop)).filter(Boolean);
    const title=xmlText(item.kop);
    const article=entry.parents.findLast(x=>x.type==='ARTIKEL') || (item.type==='ARTIKEL'?item:null);
    const wId=id;
    const publication=safeOfficial(document.publicatieID||document.sourceUrl);
    const docId=str(document.identificatie||document.id,300);
    const sourceUrl=`${DSO_BASE}/regelingen/${identifier(docId)}/documentstructuur/${encodeURIComponent(wId)}?${new URLSearchParams({geldigOp:asOf,inWerkingOp:asOf,beschikbaarOp:availableAt})}`;
    sources.set(id,{
      id:`${docId}#${wId}`,title:[...headings.slice(-2),title].filter(Boolean).join(' · ')||wId,
      text, url:publication||'https://omgevingswet.overheid.nl/regels-op-de-kaart/', sourceUrl,
      article:xmlText(article?.kop)||title||wId, componentId:wId,
      documentId:docId,documentTitle:str(document.citeerTitel||document.officieleTitel||document.title,500),
      expressionId:str(document.expressionId,500),effectiveFrom:str(document.geregistreerdMet?.beginInwerking||document.effectiveFrom,50),
      applicability,scope:annotation?.locations.some(ref=>locations.has(ref)&&locations.get(ref).locatieType!=='Ambtsgebied')?'specific-area':applicability==='point'?'authority-wide':'unverified-context',
      legalRuleKinds:unique(annotation?.ruleKinds||[]),annotationIds:unique(annotation?.rules||[]),
      locationIds:unique(annotation?.locations||[]),idealisations:unique(annotation?.idealisations||[]),
      asOf,availableAt,contextReason:via||null,externalReferences:externalRefs(raw),
      conditions:unique([...entry.parents,item].map(node=>[xmlText(node.conditieArtikel?.kop),xmlText(node.conditieArtikel?.inhoud)].filter(Boolean).join('\n'))),
      // Only ID references, never arbitrary follow-up URLs, are followed.
      internalReferences:refTargets(raw)
    });
    for(const ref of refTargets(raw)) pendingContext.add(ref);
  };
  const addSubtree=(entry,applicability,annotation,via='')=>{
    add(entry,applicability,annotation,via);
    const walk=(node,parents,depth=0)=>{
      if(depth>40) return;
      for(const child of children(node)) {
        const found=index.get(child.identificatie); if(!found) continue;
        add(found,applicability,annotation,via); walk(child,[...parents,child],depth+1);
      }
    }; walk(entry.item,entry.parents);
  };
  for(const [target,annotation] of matches) {
    const entry=index.get(target); if(!entry) {unresolved.add(target);continue;}
    addSubtree(entry,'point',annotation);
    // Include the whole article as contextual siblings: exceptions and qualifiers often sit in another lid.
    const article=entry.parents.findLast(x=>x.type==='ARTIKEL');
    if(article) addSubtree(index.get(article.identificatie),'document-context',null,'same article as a point-filtered rule; sibling applicability is not independently verified');
  }
  const handled=new Set();
  // Two hops recover referenced definitions/exceptions without expanding a whole document indefinitely.
  for(let hop=0;hop<2;hop++) {
    const queue=[...pendingContext].filter(ref=>!handled.has(ref));
    for(const ref of queue.slice(0,500)) {
      handled.add(ref); const entry=expressions.get(ref)||index.get(ref);
      if(!entry){unresolved.add(ref);continue;}
      // A chapter reference can contain thousands of unrelated rules; report rather than silently over-expand.
      if(['LICHAAM','HOOFDSTUK','AFDELING','BIJLAGE'].includes(entry.item.type)) {unresolved.add(ref);continue;}
      addSubtree(entry,'document-context',null,'internal reference from a retrieved rule; applicability not independently verified');
    }
    if(queue.length>500) warnings.push('Internal-reference expansion reached its retrieval limit.');
  }
  if(unresolved.size) warnings.push(`${unresolved.size} referenced components or broad sections were not expanded.`);
  if(matches.size&&![...sources.values()].some(x=>x.applicability==='point'))warnings.push('Applicable annotations were returned but no current point-filtered text component could be retrieved.');
  if([...sources.values()].some(x=>x.externalReferences.length)) warnings.push('Some rules refer to external legislation, information objects or attachments that were not retrieved.');
  return {sources:[...sources.values()],warnings:unique(warnings),matchedAnnotations:matches.size,
    unresolvedReferences:[...unresolved].slice(0,100),selectedLocationCount:selected.size};
}

async function officialJSON(path,key,fetcher,{body,maxBytes=MAX_BYTES,deadline=Date.now()+20_000}={}) {
  const headers={'Accept':'application/hal+json','x-api-key':key};
  if(body){headers['Content-Type']='application/json';headers['Content-Crs']=RD_CRS;}
  if(Date.now()>=deadline)throw new Error('Official DSO retrieval budget exhausted');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(1,Math.min(30_000,deadline-Date.now())));
  try {
    const response=await fetcher(DSO_BASE+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,redirect:'error',signal:controller.signal});
    if(!response.ok) { const error=new Error(`Official DSO request failed (${response.status})`);error.status=response.status;throw error; }
    if(Number(response.headers?.get?.('content-length')||0)>maxBytes) throw new Error('Official DSO response exceeds retrieval limit');
    let raw;
    if(response.body?.getReader){
      const reader=response.body.getReader(),chunks=[];let total=0;
      for(;;){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes){await reader.cancel();throw new Error('Official DSO response exceeds retrieval limit');}chunks.push(value);}
      const joined=new Uint8Array(total);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;} raw=new TextDecoder().decode(joined);
    }else{raw=await response.text();if(new TextEncoder().encode(raw).length>maxBytes)throw new Error('Official DSO response exceeds retrieval limit');}
    const parsed=JSON.parse(raw);if(parsed&&typeof parsed==='object')payloadSizes.set(parsed,raw.length*2);return parsed;
  } finally {clearTimeout(timer);}
}

function docPriority(doc){
  const type=val(doc.type),title=str(doc.citeerTitel||doc.officieleTitel).toLowerCase();
  // PlanView's building questions need Bbl before broad procedural legislation.
  return type==='Omgevingsplan'?0:title.includes('besluit bouwwerken leefomgeving')?1:
    type==='Omgevingsverordening'?2:type==='Waterschapsverordening'?3:
    type.startsWith('Voorbeschermingsregels')?4:type==='AMvB'?5:type==='Ministeriële Regeling'?6:7;
}

export async function fetchPointCorpus(point,key,fetcher=fetch,options={}) {
  const x=Number(point?.x),y=Number(point?.y);
  if(!Number.isFinite(x)||!Number.isFinite(y)||x< -10000||x>310000||y<300000||y>640000)throw new Error('Point outside Netherlands RD search range');
  if(typeof key!=='string'||key.length<8)throw new Error('DSO production key is required');
  const now=options.now instanceof Date?options.now:new Date(),availableAt=now.toISOString().replace(/\.\d{3}Z$/,'Z');
  const asOf=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const deadline=Date.now()+60_000;
  const temporal={geldigOp:asOf,inWerkingOp:asOf,beschikbaarOp:availableAt},body={geometrie:{type:'Point',coordinates:[Math.round(x*1000)/1000,Math.round(y*1000)/1000]}};
  const warnings=[],documents=[];let discoveryComplete=true;
  for(let page=1;page<=MAX_PAGES;page++){
    const params=new URLSearchParams({...temporal,_expand:'true',locatieSelectie:'primair',size:'100',page:String(page)});
    const result=await officialJSON(`/regelingen/_zoek?${params}`,key,fetcher,{body,maxBytes:4_000_000,deadline});
    const records=result?._embedded?.regelingen;
    if(!Array.isArray(records))throw new Error('Unexpected official regulation response');
    documents.push(...records.filter(x=>x&&typeof x==='object'));
    if(!result?._links?.next?.href)break;
    if(page===MAX_PAGES){discoveryComplete=false;warnings.push('Official document discovery reached its pagination limit.');}
  }
  const byId=new Map();for(const doc of documents)if(LEGAL_TYPES.has(val(doc.type))&&!byId.has(doc.identificatie))byId.set(doc.identificatie,doc);
  const available=[...byId.values()].sort((a,b)=>docPriority(a)-docPriority(b)||str(a.identificatie).localeCompare(str(b.identificatie)));
  const selected=available.slice(0,MAX_DOCUMENTS),sources=[],checked=[],failures=[];
  if(!available.length)warnings.push('No normative DSO documents were returned; this does not establish that no rules apply.');
  if(available.length>selected.length)warnings.push(`${available.length-selected.length} applicable regulations were omitted by the document retrieval limit.`);
  // Sequential retrieval keeps document + annotation parsing within Worker memory limits.
  // Large national document text is cached; annotations are never reused at another point.
  let cursor=0;await Promise.all(Array.from({length:Math.min(1,selected.length)},async()=>{
    for(;;){const position=cursor++;if(position>=selected.length)return;const doc=selected[position];
      const summary={id:str(doc.identificatie),title:str(doc.citeerTitel||doc.officieleTitel),type:val(doc.type),expressionId:str(doc.expressionId),url:safeOfficial(doc.publicatieID)};
      try{
        const uri=identifier(doc.identificatie),model=String(doc._links?.annotaties?.href||'').includes('/divisieannotaties')?'divisieannotaties':'regeltekstannotaties';
        const params=new URLSearchParams({...temporal,locatieSelectie:'primair'}),cacheKey=`${doc.identificatie}|${doc.expressionId||''}|${asOf}`;
        const cached=documentCache.get(cacheKey);let structure;
        if(cached&&Date.now()-cached.at<600_000)structure=cached.value;
        else {
          structure=await officialJSON(`/regelingen/${uri}/documentstructuur?${new URLSearchParams({...temporal,_transformXml:'inhoud'})}`,key,fetcher,{deadline});
          const bytes=payloadSizes.get(structure)||0;
          if(documentCache.has(cacheKey)){cachedBytes-=documentCache.get(cacheKey).bytes||0;documentCache.delete(cacheKey);}
          while(documentCache.size && (documentCache.size>=12||cachedBytes+bytes>8_000_000)){
            const oldest=documentCache.keys().next().value;cachedBytes-=documentCache.get(oldest).bytes||0;documentCache.delete(oldest);
          }
          if(bytes<=8_000_000){documentCache.set(cacheKey,{at:Date.now(),value:structure,bytes});cachedBytes+=bytes;}
        }
        const annotations=await officialJSON(`/regelingen/${uri}/${model}/_zoek?${params}`,key,fetcher,{body,maxBytes:6_000_000,deadline});
        const result=extractDocumentSources(doc,structure,annotations,{asOf,availableAt});
        sources.push(...result.sources);checked.push({...summary,sourceCount:result.sources.length,matchedAnnotations:result.matchedAnnotations,selectedLocationCount:result.selectedLocationCount});
        warnings.push(...result.warnings.map(w=>`${summary.title}: ${w}`));
      }catch(error){failures.push({...summary,error:error?.status?`Official request failed (${error.status}).`:'Official text or annotations could not be retrieved within the retrieval limits.'});}
    }
  }));
  sources.sort((a,b)=>a.documentId.localeCompare(b.documentId)||a.componentId.localeCompare(b.componentId));checked.sort((a,b)=>a.id.localeCompare(b.id));
  if(Date.now()>=deadline)warnings.push('The overall 60-second source retrieval budget was reached; remaining regulations are explicitly listed as unavailable.');
  // These gaps remain even when all Ozon retrievals succeed: Ozon is not the whole legal dossier.
  const limits=['Only the clicked point is checked; applicability across an entire parcel is not established.',
    'Legacy IMRO/TAM plan rules, individual permits, attachments and external legislation are not automatically complete in this DSO corpus.',
    'A geographically matched rule can be conditional or address a public authority; the match does not establish permission for a proposed activity.'];
  return {point:{x,y,crs:'EPSG:28992'},asOf,availableAt,sources,documents:checked,failures,
    coverage:{complete:discoveryComplete&&available.length===selected.length&&!failures.length&&!warnings.length,
      documentsChecked:checked.length,documentsAvailable:available.length,discoveredDocuments:documents.length,
      pointSources:sources.filter(x=>x.applicability==='point').length,contextSources:sources.filter(x=>x.applicability==='document-context').length,
      warnings:unique([...warnings,...failures.map(x=>`${x.title}: ${x.error}`)]),limits,legalCompleteness:false},
    source:'DSO Omgevingsdocumenten Presenteren v8 · current rule text joined to point-filtered annotations'};
}

// Optional local bridge. Credentials arrive only on stdin, never argv, logs, or files.
if(typeof process!=='undefined' && process.argv?.[1] && import.meta.url===new URL(`file://${process.argv[1]}`).href){
  let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>20_000)throw new Error('Request too large');}
  try{const request=JSON.parse(input);process.stdout.write(JSON.stringify(await fetchPointCorpus(request.point,request.key)));}
  catch(error){process.stdout.write(JSON.stringify({error:error?.status?`Official DSO request failed (${error.status}).`:'Official rule retrieval failed.'}));process.exitCode=1;}
}
