/* Climate model point lookups; never a whole-parcel or safety assessment. */
(function(root){
  'use strict';
  const VIEWER='https://www.klimaateffectatlas.nl/nl/kaartviewer';
  const DEFINITIONS={
    flood:{endpoint:'https://cas.cloud.sogelink.com/public/data/org/gws/YWFMLMWERURF/kea_public/wms',layer:'maximale_waterdiepte_nederland_kleine_kans_20260128',title:'Klimaateffectatlas, 2026 · Overstromingsdiepte',url:'https://www.klimaateffectatlas.nl/nl/overstromingsdiepte',scenario:'Fluss und Meer · kleine Wahrscheinlichkeit (etwa 1:1.000 pro Jahr), heutige Situation',dataPeriod:'Heutige Situation; Kartenfassung 28.01.2026 (Atlas-Update Februar 2026)',modelVersion:'20260128',resolutionM:5,origin:[8260,306710],extent:[8260,306710,284880,623150]},
    rain:{endpoint:'https://climate-adaptation-services.geospatialhosting.com/geoserver/wms',layer:'klimaateffectatlas:nl_waterdiepte_hevige_neerslag_70mm_1h_v20260810',title:'Klimaateffectatlas, 2026 · Waterdiepte bij korte extreme regen',url:'https://www.klimaateffectatlas.nl/nl/waterdiepte-bij-korte-extreme-regen',scenario:'Starkregen · 70 mm in 1 Stunde',dataPeriod:'Modellfassung 10.08.2026; veröffentlicht September 2026; Höhe des Geländemodells je Gebiet unterschiedlich datiert',modelVersion:'20260810',resolutionM:.5,origin:[13565,306846],extent:[13565,306846,278026.5,615370]}
  };
  function wgs84ToRd(point){
    const f=.36*(point.lat-52.1551744),l=.36*(point.lng-5.38720621);
    const x=[[0,1,190094.945],[1,1,-11832.228],[2,1,-114.221],[0,3,-32.391],[1,0,-.705],[3,1,-2.34],[1,3,-.608],[0,2,-.008],[2,3,.148]];
    const y=[[1,0,309056.544],[0,2,3638.893],[2,0,73.077],[1,2,-157.984],[3,0,59.788],[0,1,.433],[2,2,-6.439],[1,1,-.032],[0,4,.092],[1,4,-.054]];
    return [155000+x.reduce((sum,[a,b,c])=>sum+c*f**a*l**b,0),463000+y.reduce((sum,[a,b,c])=>sum+c*f**a*l**b,0)];
  }
  function supported(point){return Number.isFinite(point?.lat)&&Number.isFinite(point?.lng)&&point.lat>=50.7&&point.lat<=53.7&&point.lng>=3&&point.lng<=7.4;}
  function cellAt(kind,point){
    const d=DEFINITIONS[kind],[x,y]=wgs84ToRd(point),r=d.resolutionM;
    if(x<d.extent[0]||y<d.extent[1]||x>=d.extent[2]||y>=d.extent[3])return null;
    const left=d.origin[0]+Math.floor((x-d.origin[0])/r)*r,bottom=d.origin[1]+Math.floor((y-d.origin[1])/r)*r;
    return [left,bottom,left+r,bottom+r];
  }
  function queryUrl(kind,point){
    const d=DEFINITIONS[kind],cell=cellAt(kind,point);if(!cell)return null;
    // Exactly one native raster cell, in its native CRS. No overview image,
    // averaging, neighbor search, or inferred depth from a colored map pixel.
    const params=new URLSearchParams({service:'WMS',version:'1.3.0',request:'GetFeatureInfo',layers:d.layer,query_layers:d.layer,styles:'',crs:'EPSG:28992',bbox:cell.join(','),width:'1',height:'1',i:'0',j:'0',format:'image/png',info_format:'application/json',feature_count:'1'});
    return d.endpoint+'?'+params;
  }
  function provenance(kind,point,url,now){
    const d=DEFINITIONS[kind];return {title:d.title,url:d.url,viewerUrl:VIEWER,serviceUrl:d.endpoint,queryUrls:url?[url]:[],dataPeriod:d.dataPeriod,retrievedAt:new Date(now).toISOString(),modelVersion:d.modelVersion,resolutionM:d.resolutionM,nativeUnit:'m',units:'cm',noDataValue:-9999,license:'CC BY 4.0',attribution:'Klimaateffectatlas, 2026',scope:'point',method:'Eine native Rasterzelle am gewählten Punkt; kein Maximum und keine vollständige Prüfung des Grundstücks.',samplePoint:supported(point)?{lat:point.lat,lng:point.lng}:null,sampledCell:url?{crs:'EPSG:28992',bbox:cellAt(kind,point)}:null};
  }
  function base(kind,source){return {state:'unknown',value:null,unit:'cm',scenario:DEFINITIONS[kind].scenario,scope:'point',source};}
  function unknown(kind,source,reason,reasonCode){return {...base(kind,source),reason,reasonCode};}
  function numeric(value){if(typeof value==='number')return Number.isFinite(value)?value:null;if(typeof value!=='string'||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(value.trim()))return null;const n=Number(value);return Number.isFinite(n)?n:null;}
  function parseDepth(kind,data,source){
    const features=data?.type==='FeatureCollection'&&Array.isArray(data.features)?data.features:null;
    if(features?.length!==1)return unknown(kind,source,'Kein eindeutiger Modellwert für diesen Punkt.','invalid_response');
    const value=numeric(features[0]?.properties?.GRAY_INDEX);
    if(value===-9999)return unknown(kind,source,kind==='rain'?'Die Quelle liefert hier NoData. Auch trockene oder sehr flach überflutete Stellen können ausgeblendet sein; daraus folgt keine Entwarnung.':'Die Quelle liefert hier NoData. Das ist kein bestätigter Wert von 0 cm.','nodata');
    // The raster explicitly declares -9999 as NoData, but a semantic validity
    // guarantee for a zero pixel was not established. Do not certify "dry".
    if(value===0)return unknown(kind,source,'Die Bedeutung eines Nullpixels ist nicht eindeutig belegt. Bitte die Originalkarte prüfen.','unverified_zero');
    if(value===null||value<0||value>=100)return unknown(kind,source,'Der Modellwert fehlt oder ist unplausibel und wird nicht als Befund übernommen.','invalid_value');
    return {...base(kind,source),state:'complete',value:value*100,nativeValue:value,interpretation:'Modellierte maximale Wassertiefe in dieser Rasterzelle für das genannte Szenario. Keine Eintrittsprognose, keine Gebäudeschadensbewertung und kein Grundstücksmaximum.'};
  }
  function abortError(){const error=new Error('Klimaabfrage abgebrochen');error.name='AbortError';return error;}
  function createClient(options={}){
    const fetcher=options.fetch||((...args)=>root.fetch(...args)),now=options.now||Date.now,timeoutMs=options.timeoutMs??8000,cacheTtlMs=options.cacheTtlMs??900000,unknownTtlMs=options.unknownTtlMs??30000,maxCache=options.maxCache??128,cache=new Map();
    async function request(url,signal){
      if(signal?.aborted)throw abortError();const controller=new AbortController();let timedOut=false;
      const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
      const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
      try{
        const response=await fetcher(url,{signal:controller.signal,mode:'cors',credentials:'omit',headers:{Accept:'application/json'}});
        if(!response.ok)throw new Error('Quelle antwortet mit HTTP '+response.status);
        const length=Number(response.headers?.get?.('content-length'));if(length>384*1024)throw new Error('Antwort der Quelle ist zu groß');
        const text=await response.text();if(text.length>384*1024)throw new Error('Antwort der Quelle ist zu groß');return JSON.parse(text);
      }catch(error){if(signal?.aborted)throw abortError();if(timedOut)throw new Error('Die Quelle hat nicht rechtzeitig geantwortet');throw error;}
      finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
    }
    async function component(kind,point,signal){
      const key=kind+':'+point.lat+':'+point.lng,cached=cache.get(key);
      if(cached&&now()-cached.at<(cached.result.state==='complete'?cacheTtlMs:unknownTtlMs))return structuredClone(cached.result);
      const url=queryUrl(kind,point),source=provenance(kind,point,url,now());
      if(!url)return unknown(kind,source,'Dieser Punkt liegt außerhalb der Ausdehnung des Modells.','outside_extent');
      let result;
      try{result=parseDepth(kind,await request(url,signal),source);}
      catch(error){if(signal?.aborted||error.name==='AbortError')throw abortError();result=unknown(kind,source,error instanceof SyntaxError?'Die Quelle hat keinen lesbaren Modellwert geliefert.':error.message||'Die Quelle ist momentan nicht erreichbar.','unavailable');}
      if(signal?.aborted)throw abortError();
      cache.delete(key);cache.set(key,{at:now(),result});while(cache.size>Math.max(1,maxCache))cache.delete(cache.keys().next().value);return structuredClone(result);
    }
    async function inspect(point,settings={}){
      if(settings.signal?.aborted)throw abortError();const kinds=['flood','rain'].filter(kind=>settings[kind]!==false);
      if(!supported(point))return Object.fromEntries(kinds.map(kind=>[kind,unknown(kind,provenance(kind,point,null,now()),'Bitte einen gültigen Punkt in den Niederlanden wählen.','outside_extent')]));
      const entries=await Promise.all(kinds.map(async kind=>[kind,await component(kind,point,settings.signal)]));if(settings.signal?.aborted)throw abortError();return Object.fromEntries(entries);
    }
    return {inspect,clearCache:()=>cache.clear()};
  }
  const client=createClient(),api={inspect:client.inspect,clearCache:client.clearCache,createClient,queryUrl,parseDepth,DEFINITIONS,VIEWER,_test:{wgs84ToRd,cellAt,provenance}};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.PlanViewCompareClimate=api;
})(typeof globalThis!=='undefined'?globalThis:this);
