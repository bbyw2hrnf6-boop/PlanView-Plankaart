/* Official point-model adapters. Missing data never becomes a passing value. */
(function(root){
  'use strict';
  const ENDPOINTS={noise:'https://data.rivm.nl/geo/alo/wms',soil:'https://service.pdok.nl/tno/bro-bodemkaart/wms/v1_0',groundwater:'https://service.pdok.nl/tno/bro-model-grondwaterspiegeldiepte/wms/v2_0'};
  const LAYERS={noise:'rivm_20250801_Geluid_lden_allebronnen_2022',soil:'soilarea',high:'bro-grondwaterspiegeldieptemetingen-GHG',low:'bro-grondwaterspiegeldieptemetingen-GLG'};
  const SOIL_GROUPS={peat:['V','Veengronden'],peaty:['W','Moerige gronden'],podzol:['H/Y','Podzolgronden'],brik:['B','Brikgronden'],thick_earth:['EZ/EL/EK','Dikke eerdgronden'],sand:['Z','Kalkloze / kalkhoudende zandgronden'],calcareous_silt:['S…A','Kalkhoudende bijzonder lutumarme gronden'],unripe_mineral:['MO/RO','Niet-gerijpte minerale gronden'],marine_clay:['M','Zeekleigronden'],river_clay:['R','Rivierkleigronden'],old_river_clay:['KR','Oude rivierkleigronden'],old_clay:['KX/KT','Oude kleigronden'],loam:['L','Leemgronden'],old_limburg:['MZ/MK/MA/FK/FG/KM/KK/KS','Oude gronden in Zuid-Limburg']};
  const GROUP_BY_CODE={V:'peat',EV:'peat',W:'peaty',H:'podzol',Y:'podzol',B:'brik',EZ:'thick_earth',EL:'thick_earth',EK:'thick_earth',Z:'sand',S:'calcareous_silt',MO:'unripe_mineral',RO:'unripe_mineral',M:'marine_clay',R:'river_clay',KR:'old_river_clay',KX:'old_clay',KT:'old_clay',L:'loam',MZ:'old_limburg',MK:'old_limburg',MA:'old_limburg',FK:'old_limburg',FG:'old_limburg',KM:'old_limburg',KK:'old_limburg',KS:'old_limburg'};
  const CATALOGUE='https://docs.geostandaarden.nl/bro/cv-im-SGM-20230223/';
  function source(kind,urls,now){
    const common={queryUrls:urls,retrievedAt:new Date(now).toISOString(),method:'Point lookup in an official spatial model; not a site measurement'};
    if(kind==='noise')return {...common,title:'RIVM · Geluid in Nederland (Lg)',catalogueName:'Geluid in Nederland (Lg)',numericMetric:'Lden',url:'https://data.overheid.nl/dataset/69286913-abe8-47a0-8860-ab876f1ab545',explainerUrl:'https://www.atlasleefomgeving.nl/geluid-in-nederland-lcum',units:'dB',metricBasis:'The exact source archive readme specifies combined annual Lden in 1 dB classes. Lg is the catalogue product name; GRAY_INDEX itself has no metric metadata. No conversion is applied.',rasterArchiveUrl:'https://data.rivm.nl/data/alo/rivm_20250801_Geluid_lden_allebronnen_2022.zip',rasterReadme:'readme_geluid in nederland.txt',resolutionMeters:10,modelVersion:'20250801 — combined sources',dataPeriod:'Roads/aviation 2022; rail 2023; industry 2024; wind turbines 2025',metadataUrl:'https://www.nationaalgeoregister.nl/geonetwork/srv/api/records/68711fca-7589-4b83-829c-42550803c287/formatters/xml'};
    if(kind==='soil')return {...common,title:'BRO Bodemkaart (SGM) · PDOK',url:'https://basisregistratieondergrond.nl/inhoud-bro/registratieobjecten/modellen/bodemkaart-sgm/',units:'Mapped soil main class',scale:'1:50,000',modelVersion:'2025-01 (catalogue edition)',dataPeriod:'Regional surveys and subsequent updates; catalogue revision 2025-10-28',classificationUrl:CATALOGUE};
    return {...common,title:'BRO Model Grondwaterspiegeldiepte (WDM) · PDOK',url:'https://www.pdok.nl/introductie/-/article/bro-model-grondwaterspiegeldiepte-wdm-',units:'cm below local ground level',resolutionMeters:50,modelVersion:'2025-01 (catalogue edition)',dataPeriod:'Long-term groundwater fluctuation model; catalogue revision 2025-10-28'};
  }
  function unknown(reason,provenance,extra={}){return {state:'unknown',...extra,source:provenance,reason};}
  function strictNumber(value){if(typeof value==='number')return Number.isFinite(value)?value:null;if(typeof value!=='string'||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(value.trim()))return null;const number=Number(value);return Number.isFinite(number)?number:null;}
  function featureList(data){return data?.type==='FeatureCollection'&&Array.isArray(data.features)?data.features:null;}
  function rasterNumber(data,field){const features=featureList(data);if(!features?.length)return null;const values=features.map(feature=>strictNumber(feature.properties?.[field]));if(values.some(value=>value===null)||new Set(values).size!==1)return null;return values[0];}
  function parseNoise(data,provenance){
    const valueDb=rasterNumber(data,'GRAY_INDEX');
    // The source TIFF is signed Int16 and declares no GDAL_NODATA tag.
    // Zero has not been established as a real quiet pixel or a no-data code,
    // so it cannot certify a match. Positive values up to 140 dB are accepted;
    // out-of-domain values are never clamped into a passing result.
    const label='Combined modeled noise (Lden; catalogue: Lg)';
    if(valueDb===0)return unknown('Zero noise pixel has no verified valid-data meaning; not evidence of silence',provenance,{metric:'Lden',label});
    if(valueDb===null||valueDb<0||valueDb>140)return unknown('No valid modeled noise pixel',provenance,{metric:'Lden',label});
    return {state:'complete',valueDb,metric:'Lden',label,source:provenance};
  }
  function onSegment(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1];return Math.abs((p.lng-a[0])*dy-(p.lat-a[1])*dx)<1e-12&&p.lng>=Math.min(a[0],b[0])-1e-12&&p.lng<=Math.max(a[0],b[0])+1e-12&&p.lat>=Math.min(a[1],b[1])-1e-12&&p.lat<=Math.max(a[1],b[1])+1e-12;}
  function inRing(p,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[j],b=ring[i];if(onSegment(p,a,b))return true;if((a[1]>p.lat)!==(b[1]>p.lat)&&p.lng<(b[0]-a[0])*(p.lat-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
  function contains(p,geometry){if(!['Polygon','MultiPolygon'].includes(geometry?.type))return false;const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;return polygons.some(rings=>rings[0]?.length>=4&&inRing(p,rings[0])&&!rings.slice(1).some(ring=>inRing(p,ring)));}
  function classifySoilCode(code){
    // BRO catalogue main-class capitals; lowercase additions describe layers.
    // Consequently kVz (peat on sand) stays peat and never becomes sand.
    const match=/^[a-z]*([A-Z]{1,2})[a-zA-Z0-9]*$/.exec(code);
    if(!match||match[1]==='S'&&!/A[a-z]*$/.test(code))return null;
    const id=GROUP_BY_CODE[match[1]];return id?{id,code:SOIL_GROUPS[id][0],label:SOIL_GROUPS[id][1]}:null;
  }
  function parseSoil(data,point,provenance){
    const features=featureList(data),crs=data?.crs?.properties?.name;
    if(!features||features.length>=20||crs&&!/CRS84|4326/.test(crs))return unknown('Unsupported, truncated, or incompatible soil response',provenance,{classes:[]});
    const matches=features.filter(feature=>contains(point,feature.geometry));
    if(!matches.length)return unknown('No mapped soil polygon at this point',provenance,{classes:[]});
    const rawSoilCodes=[],descriptions=[],classes=new Map(),versions=new Set();let incomplete=false;
    for(const feature of matches){const p=feature.properties||{},raw=String(p.soilcode||p.first_soilcode||'').trim();if(!raw){incomplete=true;continue;}rawSoilCodes.push(raw);if(p.first_soilname)descriptions.push(p.first_soilname);const version=/^(V[^.]+)\./.exec(p.maparea_id||'');if(version)versions.add(version[1]);
      for(const code of raw.split(/\s*[\/|+]\s*/)){const group=classifySoilCode(code);if(group)classes.set(group.id,group);else incomplete=true;}}
    const result={classes:[...classes.values()],rawSoilCodes:[...new Set(rawSoilCodes)],descriptions:[...new Set(descriptions)]};
    const src=versions.size?{...provenance,modelVersion:[...versions].join(', ')}:provenance;
    if(incomplete||!classes.size)return unknown('At least one mapped soil code has no verified main-class mapping',src,result);
    if(classes.size>1)return unknown('Multiple soil main classes at a boundary or in a mapped association',src,result);
    return {state:'complete',...result,source:src};
  }
  function parseGroundwater(high,low,provenance){
    // PDOK's published ghg-mediaan.tif and glg-mediaan.tif explicitly declare
    // unsigned 8-bit pixels, GDAL_NODATA=255, and valid values 0–254 cm.
    // Negative physical depths are possible; this particular model cannot
    // encode them. An unexpected encoding must not silently become evidence.
    const depth=data=>{const value=rasterNumber(data,'value_list');return value!==null&&value>=0&&value<255?value:null;};
    const highWaterDepthCm=depth(high),lowWaterDepthCm=depth(low);
    const extra={};if(highWaterDepthCm!==null)extra.highWaterDepthCm=highWaterDepthCm;if(lowWaterDepthCm!==null)extra.lowWaterDepthCm=lowWaterDepthCm;
    if(highWaterDepthCm===null||lowWaterDepthCm===null)return unknown('Missing GHG or GLG model pixel',provenance,extra);
    if(highWaterDepthCm>lowWaterDepthCm)return unknown('GHG/GLG model values are inconsistent',provenance,extra);
    return {state:'complete',...extra,source:provenance};
  }
  function queryUrl(endpoint,layer,point){
    // An odd image size places the queried point at the middle pixel center.
    // The tiny footprint prevents a neighboring soil polygon becoming a match.
    const delta=.000015;
    const p=new URLSearchParams({service:'WMS',version:'1.1.1',request:'GetFeatureInfo',layers:layer,query_layers:layer,styles:'',bbox:[point.lng-delta,point.lat-delta,point.lng+delta,point.lat+delta].join(','),srs:'EPSG:4326',width:'3',height:'3',x:'1',y:'1',format:'image/png',info_format:'application/json',feature_count:'20'});
    return endpoint+'?'+p;
  }
  function abortError(){const error=new Error('Environmental lookup cancelled');error.name='AbortError';return error;}
  function createClient(options={}){
    const fetcher=options.fetch||((...args)=>root.fetch(...args)),now=options.now||Date.now,timeoutMs=options.timeoutMs??8000,cacheTtlMs=options.cacheTtlMs??900000,maxCache=options.maxCache??256,cache=new Map();
    async function request(url,signal){
      if(signal?.aborted)throw abortError();
      const controller=new AbortController();let timeout=false;
      const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
      const timer=setTimeout(()=>{timeout=true;controller.abort();},timeoutMs);
      try{const response=await fetcher(url,{signal:controller.signal,credentials:'omit',mode:'cors'});if(!response.ok)throw new Error('Official service HTTP '+response.status);const text=await response.text();if(text.length>5*1024*1024)throw new Error('Official response exceeds size limit');return JSON.parse(text);}
      catch(error){if(signal?.aborted)throw abortError();if(timeout)throw new Error('Official service timed out');throw error;}
      finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
    }
    async function component(kind,point,signal){
      const key=kind+':'+point.lat+':'+point.lng,cached=cache.get(key);if(cached&&now()-cached.at<cacheTtlMs)return structuredClone(cached.result);
      const layers=kind==='groundwater'?[LAYERS.high,LAYERS.low]:[LAYERS[kind]],urls=layers.map(layer=>queryUrl(ENDPOINTS[kind],layer,point)),provenance=source(kind,urls,now());
      let result;
      try{const data=await Promise.all(urls.map(url=>request(url,signal)));if(signal?.aborted)throw abortError();result=kind==='noise'?parseNoise(data[0],provenance):kind==='soil'?parseSoil(data[0],point,provenance):parseGroundwater(data[0],data[1],provenance);}
      catch(error){if(signal?.aborted||error.name==='AbortError')throw abortError();result=unknown(error.message||'Official source unavailable',provenance,kind==='soil'?{classes:[]}:{});}
      if(result.state==='complete'){cache.delete(key);cache.set(key,{at:now(),result});while(cache.size>maxCache)cache.delete(cache.keys().next().value);}
      return structuredClone(result);
    }
    async function inspect(point,settings={}){
      if(settings.signal?.aborted)throw abortError();
      const kinds=['noise','soil','groundwater'].filter(kind=>settings[kind]);
      if(!Number.isFinite(point?.lat)||!Number.isFinite(point?.lng)||point.lat<50.6||point.lat>53.8||point.lng<3||point.lng>7.4)return Object.fromEntries(kinds.map(kind=>[kind,unknown('Point outside supported Netherlands model extent',source(kind,[],now()),kind==='soil'?{classes:[]}: {})]));
      const entries=await Promise.all(kinds.map(async kind=>[kind,await component(kind,point,settings.signal)]));if(settings.signal?.aborted)throw abortError();return Object.fromEntries(entries);
    }
    return {inspect,clearCache:()=>cache.clear()};
  }
  const client=createClient();
  const api={inspect:client.inspect,createClient,parseNoise,parseSoil,parseGroundwater,classifySoilCode,queryUrl,ENDPOINTS,LAYERS,SOIL_GROUPS};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.PlanViewEnvironmentalSources=api;
})(typeof globalThis!=='undefined'?globalThis:this);
