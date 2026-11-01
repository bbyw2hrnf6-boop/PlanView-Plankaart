/* Coordinate requested environmental evidence. Missing model data never proves a match. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.PlanViewEnvironmentScreen=api;})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';
  const finite=n=>typeof n==='number'&&Number.isFinite(n);
  const active=c=>({noise:c?.maxNoiseDb!=null,slope:c?.maxSlopeDeg!=null,soil:Array.isArray(c?.soilClasses)&&c.soilClasses.length>0,groundwater:c?.minGroundwaterDepthCm!=null});
  const needs=c=>Object.values(active(c)).some(Boolean);
  const unknown=reason=>({state:'unknown',reason});
  const aborted=signal=>{if(signal?.aborted){const error=new Error('Aborted');error.name='AbortError';throw error;}};
  function createScreen(dependencies={}){
    async function inspect(point,{criteria={},parcelEvidence=null,signal}={}){
      aborted(signal);const wanted=active(criteria),out={checkedAt:new Date().toISOString(),point:{lat:point.lat,lng:point.lng}};
      const sources=dependencies.sources||root.PlanViewEnvironmentalSources,terrain=dependencies.terrain||root.PlanViewTerrainScreen;
      const jobs=[];
      if(wanted.noise||wanted.soil||wanted.groundwater)jobs.push((async()=>{
        try{if(!sources?.inspect)throw Error('source-module-unavailable');const data=await sources.inspect(point,{noise:wanted.noise,soil:wanted.soil,groundwater:wanted.groundwater,signal});for(const key of ['noise','soil','groundwater'])if(wanted[key])out[key]=data?.[key]||unknown('no-data');}
        catch(error){aborted(signal);if(error?.name==='AbortError')throw error;for(const key of ['noise','soil','groundwater'])if(wanted[key])out[key]=unknown('source-unavailable');}
      })());
      if(wanted.slope)jobs.push((async()=>{
        const parcel=parcelEvidence?.parcel;
        if(!parcel?.complete||!parcel.geometry){out.slope=unknown('parcel-unresolved');return;}
        try{out.slope=terrain?.inspect?await terrain.inspect(point,{geometry:parcel.geometry,signal}):unknown('source-module-unavailable');}
        catch(error){aborted(signal);if(error?.name==='AbortError')throw error;out.slope=unknown('source-unavailable');}
      })());
      await Promise.all(jobs);aborted(signal);return out;
    }
    return {inspect};
  }
  function evaluate(evidence={},criteria={}){
    const checks=[],wanted=active(criteria),add=(key,value,valid,passes)=>checks.push({key,value:finite(value)||Array.isArray(value)?value:null,status:valid?(passes?'pass':'fail'):'unknown'});
    if(wanted.noise){const e=evidence.noise;add('maxNoiseDb',e?.valueDb,e?.state==='complete'&&e.metric==='Lden'&&finite(e.valueDb),e?.valueDb<=criteria.maxNoiseDb);}
    if(wanted.slope){const e=evidence.slope;add('maxSlopeDeg',e?.maxSlopeDeg,e?.state==='complete'&&e.metric==='slope_degrees'&&e.coverage?.scope==='parcel'&&e.coverage?.complete===true&&finite(e.maxSlopeDeg),e?.maxSlopeDeg<=criteria.maxSlopeDeg);}
    if(wanted.soil){const e=evidence.soil,ids=(e?.classes||[]).map(x=>x.id).filter(x=>typeof x==='string');add('soilClasses',ids,e?.state==='complete'&&ids.length>0,ids.some(id=>criteria.soilClasses.includes(id)));}
    if(wanted.groundwater){const e=evidence.groundwater;add('minGroundwaterDepthCm',e?.highWaterDepthCm,e?.state==='complete'&&finite(e.highWaterDepthCm),e?.highWaterDepthCm>=criteria.minGroundwaterDepthCm);}
    const failed=checks.filter(x=>x.status==='fail').map(x=>x.key),missing=checks.filter(x=>x.status==='unknown').map(x=>x.key);
    return {pass:!failed.length,status:failed.length?'fail':missing.length?'unknown':'pass',checks,failed,missing};
  }
  const words={en:{noise:'Modeled combined noise Lden',slope:'Maximum terrain slope',soil:'BRO soil class',groundwater:'Mean highest groundwater level (GHG)',point:'at the sample point',parcel:'whole parcel',unknown:'Check open: data incomplete or unavailable',below:'cm below ground',sources:'Sources and model details',retrieved:'Retrieved',period:'Source period',resolution:'Resolution'},nl:{noise:'Gemodelleerd totaalgeluid Lden',slope:'Maximale terreinhelling',soil:'BRO-bodemhoofdklasse',groundwater:'Gemiddeld hoogste grondwaterstand (GHG)',point:'op het steekproefpunt',parcel:'gehele perceel',unknown:'Controle open: gegevens onvolledig of niet beschikbaar',below:'cm onder maaiveld',sources:'Bronnen en modeldetails',retrieved:'Opgehaald',period:'Bronperiode',resolution:'Resolutie'},de:{noise:'Modellierter Gesamtpegel Lden',slope:'Maximale Geländeneigung',soil:'BRO-Bodenhauptklasse',groundwater:'Mittlerer höchster Grundwasserstand (GHG)',point:'am Prüfpunkt',parcel:'gesamtes Grundstück',unknown:'Prüfung offen: Daten fehlen oder sind unvollständig',below:'cm unter Gelände',sources:'Quellen und Modelldetails',retrieved:'Abgerufen',period:'Quellenzeitraum',resolution:'Auflösung'}};
  const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function rows(evidence={},language='en'){
    const t=words[language]||words.en,fmt=n=>Number(n).toLocaleString(language,{maximumFractionDigits:1}),out=[];
    for(const [kind,key] of [['noise','maxNoiseDb'],['slope','maxSlopeDeg'],['soil','soilClasses'],['groundwater','minGroundwaterDepthCm']]){
      const e=evidence[kind];if(!e)continue;let value='—';
      if(kind==='noise'&&finite(e.valueDb))value=`${fmt(e.valueDb)} dB Lden`;
      if(kind==='slope'&&finite(e.maxSlopeDeg))value=`${e.coverage?.complete===true?'':'≥ '}${fmt(e.maxSlopeDeg)}°`;
      if(kind==='soil'&&e.classes?.length)value=e.classes.map(x=>x.label||x.id).join(' / ');
      if(kind==='groundwater'&&finite(e.highWaterDepthCm))value=`${fmt(e.highWaterDepthCm)} ${t.below}`;
      const valid=kind==='noise'?e.metric==='Lden'&&finite(e.valueDb):kind==='slope'?e.metric==='slope_degrees'&&e.coverage?.scope==='parcel'&&e.coverage?.complete===true&&finite(e.maxSlopeDeg):kind==='soil'?e.classes?.some(x=>typeof x.id==='string'):finite(e.highWaterDepthCm);
      const neighborhood={de:'Punktumgebung · kein Grundstücksnachweis',nl:'Puntomgeving · geen perceelbewijs',en:'point neighborhood · not whole-parcel evidence'}[language]||'point neighborhood';
      const coverage=kind==='slope'&&finite(e.coverage?.ratio)?` · ${fmt(e.coverage.ratio*100)}% ${language==='de'?'Rasterabdeckung':language==='nl'?'rasterdekking':'raster coverage'}`:'';
      out.push({kind,key,label:t[kind],value,complete:e.state==='complete'&&!!valid,scope:(kind==='slope'?(e.coverage?.scope==='point-neighborhood'?neighborhood:t.parcel):t.point)+coverage,reason:e.reason||'',source:e.source||{}});
    }return out;
  }
  function render(evidence,language='en',{compact=false}={}){
    const t=words[language]||words.en,list=rows(evidence,language);if(!list.length)return '';
    const lines=list.map(r=>`<div class="pv-env-row" data-state="${r.complete?'complete':'unknown'}"><strong>${escape(r.label)}</strong><span>${escape(r.value)}</span><small>${escape(r.scope)}${r.complete?'':` · ${escape(t.unknown)}`}</small></div>`).join('');
    if(compact)return `<span class="pv-env-evidence">${lines.replaceAll('<div ','<span ').replaceAll('</div>','</span>')}</span>`;
    const sources=list.map(r=>{const s=r.source,url=s.url||'',resolution=s.resolutionMeters??s.resolutionM,version=s.modelVersion||s.datasetVersion,link=/^https:\/\/(?:[a-z0-9.-]+\.)?(?:pdok\.nl|rivm\.nl|ahn\.nl|atlasleefomgeving\.nl|bro-loket\.nl|bodemdata\.nl|basisregistratieondergrond\.nl|data\.overheid\.nl)\//i.test(url)?`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(s.title||s.label||r.label)} ↗</a>`:escape(s.title||s.label||r.label);return `<li>${link}${s.units?` · ${escape(s.units)}`:''}${s.scale?` · 1:50.000`:''}${resolution?` · ${escape(t.resolution)} ${escape(resolution)} m`:''}${s.dataPeriod||s.dataDate?`<small>${escape(t.period)}: ${escape(s.dataPeriod||s.dataDate)}</small>`:''}${version?`<small>${escape(version)}</small>`:''}${s.metricBasis?`<small>${escape(s.metricBasis)}</small>`:''}${s.retrievedAt?`<small>${escape(t.retrieved)}: ${escape(s.retrievedAt)}</small>`:''}${r.reason?`<small>${escape(r.reason)}</small>`:''}</li>`;}).join('');
    return `<div class="pv-env-evidence">${lines}</div><details class="pv-env-sources"><summary>${escape(t.sources)}</summary><ul>${sources}</ul></details>`;
  }
  return {...createScreen(),createScreen,active,needs,evaluate,rows,render};
});
