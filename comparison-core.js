/* Shared comparison of captured evidence. One profile, no inferred legal permission. */
(function(root,factory){
  const node=typeof module==='object'&&module.exports;
  const api=factory(root,node?require('./desktop-journey-core.js'):null,node?require('./parcel-screen.js'):null,node?require('./environment-screen.js'):null);
  if(node)module.exports=api;else root.PlanViewCompareCore=api;
})(typeof window!=='undefined'?window:globalThis,function(root,journeyModule,parcelModule,environmentModule){
  'use strict';
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const own=(object,key)=>Object.prototype.hasOwnProperty.call(object||{},key);
  const copy=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const siteRecords={parcelMinAreaM2:'parcel',parcelMaxAreaM2:'parcel',minEnvelopeAreaM2:'envelope',minEnvelopePercent:'envelope',maxBuildingCoveragePercent:'buildings',excludeNatura2000:'natura2000',minNaturaDistanceKm:'natura2000'};
  const environmentRecords={maxNoiseDb:'noise',maxSlopeDeg:'slope',soilClasses:'soil',minGroundwaterDepthCm:'groundwater'};
  // Legacy snapshots persisted these UI placeholders as text. Match whole
  // values only: a genuine plan name containing 'Unknown' is still evidence.
  const missingText=new Set(['Not queried','Niet opgevraagd','Nicht abgefragt','Not returned','Niet gevonden','Nicht zurückgegeben','Unknown','Onbekend','Unbekannt','Unavailable','Niet beschikbaar','Nicht verfügbar','Not checked','Niet gecontroleerd','Nicht geprüft','Noch nicht geprüft','No designation returned','Geen bestemming teruggegeven','Keine Festsetzung zurückgegeben','No evidence snapshot yet','Nog geen gegevensmomentopname','Noch kein Datenstand gespeichert','not-queried','not-returned','—'].map(value=>value.toLowerCase()));
  const isMissingText=value=>typeof value==='string'&&(!value.trim()||missingText.has(value.trim().toLowerCase()));
  const fallbackLabels={parcelAreaM2:'Parcel area',envelopeAreaM2:'Building envelope area',envelopeCoveragePercent:'Building envelope coverage',buildingCoveragePercent:'Building coverage',naturaIntersects:'Natura 2000 overlap',naturaDistanceKm:'Distance to Natura 2000',parcel:'Cadastral parcel',designation:'Designation',municipality:'Municipality',status:'Plan status',date:'Plan date',envelope:'Building envelope',maxNoiseDb:'Modeled noise Lden',maxSlopeDeg:'Maximum terrain slope',soilClasses:'BRO soil class',minGroundwaterDepthCm:'Groundwater depth GHG',station:'Train station',park:'Park',industry:'Industry',camping:'Camping',town:'Town',road:'Road',water:'Water',supermarket:'Supermarket',school:'School',hospital:'Hospital',bus:'Bus stop',restaurant:'Restaurant',nature:'Nature'};
  function dependencies(options={}){return {...options,journey:options.journey||root.PlanViewJourneyCore||journeyModule,parcel:options.parcel||root.PlanViewParcelScreen||parcelModule,environment:options.environment||root.PlanViewEnvironmentScreen||environmentModule};}
  function label(key,options={}){const value=typeof options.labels==='function'?options.labels(key):options.labels?.[key];return value&&value!==key?value:fallbackLabels[key]||key;}
  function key(item={}){const point=item.point||item;return finite(point.lat)&&finite(point.lng)?`${point.lat.toFixed(6)},${point.lng.toFixed(6)}`:'';}
  function cleanProfile(profile){
    if(!profile||typeof profile!=='object')return null;
    const result=copy(profile);
    result.siteCriteria=Object.fromEntries(Object.entries(result.siteCriteria||{}).filter(([,value])=>finite(value)||value===true));
    result.environmentCriteria=Object.fromEntries(Object.entries(result.environmentCriteria||{}).filter(([,value])=>finite(value)||Array.isArray(value)&&value.length));
    result.distanceRules=Object.fromEntries(Object.entries(result.distanceRules||{}).map(([kind,rule])=>[kind,Object.fromEntries(Object.entries(rule||{}).filter(([bound,value])=>['minKm','maxKm'].includes(bound)&&finite(value)))]).filter(([,rule])=>Object.keys(rule).length));
    for(const name of ['groups','excludeGroups','statuses','excludeStatuses','unsupported'])result[name]=Array.isArray(result[name])?result[name].filter(value=>typeof value==='string'&&value.trim()):[];
    return result;
  }
  function hasCriteria(profile,options={}){const cleaned=cleanProfile(profile);return !!cleaned&&dependencies(options).journey.describe(cleaned).length>0;}
  function chooseProfile(items=[],currentSpec){
    if(hasCriteria(currentSpec))return cleanProfile(currentSpec);
    for(const item of items){const spec=item?.searchCriteria||item?.searchEvidence?.searchCriteria||item?.point?.searchEvidence?.searchCriteria;if(hasCriteria(spec))return cleanProfile(spec);}
    return null;
  }
  function normalize(item={},profile={},options={}){
    const nested=item.point?.searchEvidence||item.searchEvidence||{},result={...nested,...item};
    for(const field of ['group','status'])if(isMissingText(result[field]))result[field]=null;
    // Older saved snapshots explicitly use null for unqueried containers.
    // Screen evaluators expect objects; null must remain unknown evidence.
    for(const field of ['parcelEvidence','environmentEvidence'])if(!result[field]||typeof result[field]!=='object'||Array.isArray(result[field]))result[field]={};
    result.point=item.point||{lat:item.lat,lng:item.lng};
    result.distances={...(nested.distances||{}),...(item.nearFeatures||{}),...(item.distances||{})};
    for(const kind of ['industry','camping','town','road'])if(!result.distances[kind]&&result[kind])result.distances[kind]=result[kind];
    const findings={...dependencies(options).journey.pointFindings(result,profile,options),...(nested.pointFindings||{}),...(item.pointFindings||{})};
    if(!own(findings,'envelope')&&profile.requireEnvelope&&result.envelope==='mapped')findings.envelope=true;
    result.pointFindings=findings;
    return result;
  }
  function recordFor(row,result){
    if(row.id.startsWith('site:'))return result.parcelEvidence?.[siteRecords[row.key]];
    if(row.id.startsWith('environment:'))return result.environmentEvidence?.[environmentRecords[row.key]];
    if(row.id.startsWith('distance:'))return result.distances?.[row.key];
    return null;
  }
  function metadata(record,item,row){
    if(!record){
      const planning=['designation','status','date'].includes(row?.key)||/^(?:group|excludeGroup|status|excludeStatus):/.test(row?.id||'');
      const source=planning&&typeof item.sourceUrl==='string'&&item.sourceUrl?{url:item.sourceUrl,title:!isMissingText(item.plan)&&item.plan||item.sourceId||null,featureId:item.sourceId||null}:null;
      return {source,checkedAt:item.capturedAt||item.checkedAt||null};
    }
    const lowerBound=row?.key==='maxSlopeDeg'?record.coverage?.complete!==true&&finite(record.maxSlopeDeg):row?.key==='minNaturaDistanceKm'?record.observedDistanceM==null&&record.minDistanceM==null&&finite(record.distanceLowerBoundM):row?.id?.startsWith('site:')&&['minEnvelopeAreaM2','minEnvelopePercent','maxBuildingCoveragePercent'].includes(row.key)?record.complete!==true:false;
    return {source:record.source||null,checkedAt:record.source?.checkedAt||record.source?.retrievedAt||item.capturedAt||item.checkedAt||null,reason:record.reason||'',accuracy:record.accuracy||null,lowerBound,coverage:record.coverage||null,sourceState:record.state||null};
  }
  function evaluate(items=[],profile,priorities={},options={}){
    const deps=dependencies(options),selected=cleanProfile(profile),results=items.map(item=>normalize(item,selected||{},deps));
    const descriptions=selected?deps.journey.describe(selected,key=>label(key,deps)):[];
    const evidence=results.map(result=>selected?deps.journey.evidence(selected,result,deps):[]);
    const rows=descriptions.map((description,index)=>({...description,group:description.id.startsWith('site:')?'site':description.id.startsWith('environment:')?'environment':description.id.startsWith('distance:')?'context':'planning',priority:['must','important','normal','ignore'].includes(priorities[description.id])?priorities[description.id]:'normal',cells:results.map((result,itemIndex)=>{const finding=evidence[itemIndex][index]||{};return {actual:finding.actual??null,status:['pass','fail'].includes(finding.status)?finding.status:'unknown',...metadata(recordFor(description,result),result,description)};})}));
    const summaries=items.map((item,index)=>{
      const summary={key:key(item),pass:0,fail:0,unknown:0,mustFail:0,mustUnknown:0,weightedScore:null,coverage:0};let weight=0,earned=0,known=0;
      for(const row of rows){if(row.priority==='ignore')continue;const cell=row.cells[index],w=row.priority==='important'?2:1;weight+=w;summary[cell.status]++;if(cell.status!=='unknown')known++;if(cell.status==='pass')earned+=w;if(row.priority==='must'&&cell.status!=='pass')summary[cell.status==='fail'?'mustFail':'mustUnknown']++;}
      const total=summary.pass+summary.fail+summary.unknown;summary.coverage=total?known/total:0;summary.weightedScore=weight?earned/weight*100:null;return summary;
    });
    const order=items.map((_,index)=>index).sort((a,b)=>{const x=summaries[a],y=summaries[b];return x.mustFail-y.mustFail||x.mustUnknown-y.mustUnknown||x.fail-y.fail||x.unknown-y.unknown||(y.weightedScore??0)-(x.weightedScore??0)||y.coverage-x.coverage||a-b;});
    return {profile:selected,rows,summaries,order};
  }
  function facts(items=[],options={}){
    const deps=dependencies(options),results=items.map(item=>normalize(item,{},deps)),rows=[];
    const add=(id,key,unit,scope,group,read)=>{const cells=results.map(result=>read(result));rows.push({id:'fact:'+id,key,label:label(key,deps),operator:'',unit,value:null,scope,group,cells});};
    const unknown=item=>({actual:null,status:'unknown',checkedAt:item.capturedAt||null});
    const metric=(result,record,field,transform=value=>value)=>finite(record?.[field])?{actual:transform(record[field]),status:record.complete===true?'measured':'unknown',...metadata(record,result),lowerBound:record.complete!==true}:unknown(result);
    add('parcelAreaM2','parcelAreaM2','m²','parcel','site',r=>metric(r,r.parcelEvidence?.parcel,'areaM2'));
    add('envelopeAreaM2','envelopeAreaM2','m²','parcel','site',r=>metric(r,r.parcelEvidence?.envelope,'areaM2'));
    add('envelopeCoveragePercent','envelopeCoveragePercent','%','parcel','site',r=>metric(r,r.parcelEvidence?.envelope,'coveragePct'));
    add('buildingCoveragePercent','buildingCoveragePercent','%','parcel','site',r=>metric(r,r.parcelEvidence?.buildings,'coveragePct'));
    add('naturaIntersects','naturaIntersects','','parcel','environment',r=>{const record=r.parcelEvidence?.natura2000;return typeof record?.intersects==='boolean'?{actual:record.intersects,status:record.complete?'measured':'unknown',...metadata(record,r)}:unknown(r);});
    add('naturaDistanceKm','naturaDistanceKm','km','parcel','environment',r=>{const record=r.parcelEvidence?.natura2000;if(finite(record?.minDistanceM))return {actual:record.minDistanceM/1000,status:record.complete?'measured':'unknown',...metadata(record,r)};if(finite(record?.distanceLowerBoundM))return {actual:record.distanceLowerBoundM/1000,status:'unknown',...metadata(record,r),lowerBound:true};return unknown(r);});
    const text=(r,value,record,key)=>value!=null&&!isMissingText(value)?{actual:value,status:'measured',...metadata(record,r,{key})}:unknown(r);
    add('parcel','parcel','','parcel','site',r=>text(r,r.parcelEvidence?.parcel?.label||r.parcelEvidence?.parcel?.id||r.parcel,r.parcelEvidence?.parcel));
    for(const field of ['designation','municipality','status','date'])add(field,field,'','point',field==='municipality'?'site':'planning',r=>text(r,r[field],null,field));
    const kinds=new Set();for(const result of results)for(const [kind,record] of Object.entries(result.distances))if(record)kinds.add(kind);
    for(const kind of [...kinds].sort())add('distance:'+kind,kind,'km','point','context',r=>{const record=r.distances[kind];return finite(record?.km)?{actual:record.km,status:record.accuracy==='extent'?'unknown':'measured',name:record.name||record.item?.name||'',...metadata(record,r)}:unknown(r);});
    for(const [field,kind,unit] of [['maxNoiseDb','noise','dB Lden'],['maxSlopeDeg','slope','°'],['soilClasses','soil',''],['minGroundwaterDepthCm','groundwater','cm']])add('environment:'+kind,field,unit,kind==='slope'?'parcel':'point','environment',r=>{
      const record=r.environmentEvidence?.[kind];if(!record)return unknown(r);const envRows=deps.environment.rows(r.environmentEvidence,deps.language||'en'),display=envRows.find(row=>row.kind===kind),actual=kind==='noise'?record.valueDb:kind==='slope'?record.maxSlopeDeg:kind==='groundwater'?record.highWaterDepthCm:(record.classes||[]).map(value=>value.id).filter(Boolean);
      const known=finite(actual)||Array.isArray(actual)&&actual.length>0;return {actual:known?actual:null,status:known&&display?.complete?'measured':'unknown',...metadata(record,r,{key:field}),scope:display?.scope,display:display?.value};
    });
    return rows;
  }
  // Set-valued alternatives may arrive in a different order. Numeric findings
  // remain exact; rounded display strings must not hide a real difference.
  function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).sort().join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value??null);}
  function different(row){const cells=row?.cells||[];if(cells.length<2)return false;const signature=cell=>canonical({actual:cell.actual,status:cell.status,lowerBound:!!cell.lowerBound,accuracy:cell.accuracy||null,scope:cell.scope||row.scope||null});return cells.slice(1).some(cell=>signature(cell)!==signature(cells[0]));}
  // Notes synchronize only after an explicit edit. Preserve a different note
  // from the other workspace once, rather than recording every keystroke.
  function updateNote(record={},value,source='comparison',now=new Date().toISOString()){
    const next=copy(record)||{},note=String(value??'').slice(0,4000),old=typeof next.note==='string'?next.note:'',previousSource=next.noteSource||'comparison';
    const history=Array.isArray(next.noteHistory)?next.noteHistory.slice():[];
    if(old.trim()&&old!==note&&previousSource!==source&&!history.some(entry=>entry.text===old))history.push({text:old,source:previousSource,savedAt:now});
    return {...next,note,noteSource:source,noteUpdatedAt:now,noteHistory:history};
  }
  return {key,chooseProfile,hasCriteria,evaluate,facts,different,normalize,updateNote};
});
