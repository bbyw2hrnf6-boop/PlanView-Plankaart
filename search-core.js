/* Pure search semantics shared by the browser and regression tests. */
(function (root) {
  'use strict';
  const kinds = ['camping','town','station','park','sports','cemetery','swimming_pool','marina','industry'];
  const defaults = {camping:3,town:6,station:3,park:2,sports:2,cemetery:2,swimming_pool:2,marina:3,industry:1.2};
  const terms = {
    camping:/\b(?:camp(?:ing|site|ground)?s?|holiday\s*parks?|vacation\s*parks?|ferienparks?|campingpl[aä]tze?|kampeer\w*)\b/ig,
    town:/\b(?:towns?|villages?|cities|city|dorp(?:en)?|stad|steden|orte?|stadt|st[aä]dte|d[oö]rfer)\b/ig,
    station:/\b(?:train\s*stations?|rail(?:way)?\s*stations?|treinstations?|bahnh[oö]fe?|bahnhof)\b/ig,
    park:/\b(?:parks?|parken|parkanlagen?)\b/ig,
    sports:/\b(?:sports? (?:fields?|complex|grounds?)|sportterrein(?:en)?|sportcomplex(?:en)?|sportanlagen?|sportpl[aä]tze?)\b/ig,
    cemetery:/\b(?:cemeter(?:y|ies)|graveyards?|begraafplaats(?:en)?|friedh[oö]fe?|friedhof)\b/ig,
    swimming_pool:/\b(?:swimming pools?|zwembad(?:en)?|schwimmb[aä]der|schwimmbad)\b/ig,
    marina:/\b(?:marinas?|jachthavens?|yachth[aä]fen|yachthafen)\b/ig,
    industry:/\b(?:indust\w*|bedrijventerrein|gewerbe\w*)\b/ig
  };
  const emptyRules = () => Object.fromEntries(kinds.map(kind => [kind,{minKm:null,maxKm:null}]));
  function cleanRules(raw) {
    const rules=emptyRules();
    for(const kind of kinds)for(const bound of ['minKm','maxKm']) {
      const value=raw?.[kind]?.[bound];
      if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=50)rules[kind][bound]=value;
    }
    return rules;
  }
  const number='(\\d+(?:[.,]\\d+)?)',unit='(km|kilomet(?:er|re)s?|kilometer[n]?|m|met(?:er|re)s?|metern)';
  const toKm=(value,u)=>Number(value.replace(',','.'))*(/^k/i.test(u)?1:.001);
  function parseDistanceRules(query) {
    const result=emptyRules(),expressions=[],occupied=[];
    const range=new RegExp('(?:\\b(?:between|zwischen|tussen)\\s+)?'+number+'\\s*'+unit+'?\\s*(?:-|–|\\bto\\b|\\bbis\\b|\\btot\\b|\\band\\b|\\bund\\b|\\ben\\b)\\s*'+number+'\\s*'+unit+'\\b','ig');
    for(const match of query.matchAll(range)) {
      const minKm=toKm(match[1],match[2]||match[4]),maxKm=toKm(match[3],match[4]);
      if(minKm<=maxKm&&maxKm<=50) {expressions.push({start:match.index,end:match.index+match[0].length,minKm,maxKm});occupied.push([match.index,match.index+match[0].length]);}
    }
    const single=new RegExp(number+'\\s*'+unit+'\\b','ig');
    for(const match of query.matchAll(single)) {
      if(occupied.some(([start,end])=>match.index>=start&&match.index<end))continue;
      const km=toKm(match[1],match[2]);if(km<0||km>50)continue;
      const prefix=query.slice(Math.max(0,match.index-45),match.index);
      const minimum=/(?:at\s+least|more\s+than|farther\s+than|further\s+than|not\s+closer\s+than|minimum|mindestens|mehr\s+als|weiter\s+als|nicht\s+n[aä]her\s+als|minimaal|ten\s+minste|meer\s+dan|niet\s+dichter\s+dan|>=|≥|>)\s*$/i.test(prefix);
      expressions.push({start:match.index,end:match.index+match[0].length,minKm:minimum?km:null,maxKm:minimum?null:km});
    }
    const mentions=[];
    for(const [kind,pattern] of Object.entries(terms))for(const match of query.matchAll(pattern))mentions.push({kind,start:match.index,end:match.index+match[0].length});
    // "Holiday park" is one campsite mention, never an additional public park.
    const filtered=mentions.filter(mention=>mention.kind!=='park'||!mentions.some(other=>other.kind==='camping'&&mention.start>=other.start&&mention.end<=other.end));
    const best=new Map();
    for(const expression of expressions) {
      let selected=null;
      for(const mention of filtered) {
        const start=Math.min(expression.end,mention.end),end=Math.max(expression.start,mention.start);
        const between=query.slice(start,end),gap=expression.end<=mention.start?mention.start-expression.end:mention.end<=expression.start?expression.start-mention.end:0;
        if(gap>65||/[!?;\n]|\.(?!\d)|,(?!\d)|\b(?:and|und|en)\b/i.test(between))continue;
        if(filtered.some(other=>other!==mention&&other.start>=start&&other.end<=end))continue;
        if(!selected||gap<selected.gap)selected={kind:mention.kind,gap};
      }
      if(selected&&(!best.has(selected.kind)||selected.gap<best.get(selected.kind).gap))best.set(selected.kind,{...expression,gap:selected.gap});
    }
    for(const [kind,{minKm,maxKm}] of best)result[kind]={minKm,maxKm};
    return result;
  }
  function resolveRules(raw,query,spec={}) {
    const rules=cleanRules(raw),explicit=parseDistanceRules(query);
    const active=new Set([...(spec.nearCamping?['camping']:[]),...(spec.nearTown?['town']:[]),...(spec.nearFeatures||[]),...(spec.avoidIndustry?['industry']:[])]);
    for(const kind of kinds) {
      // A validated semantic interpretation is authoritative. Regex is only a
      // fallback; it must never erase a range/operator understood by the model.
      if(rules[kind].minKm===null&&rules[kind].maxKm===null&&(explicit[kind].minKm!==null||explicit[kind].maxKm!==null)) {
        rules[kind]={...explicit[kind]};
        if(kind==='industry'&&spec.avoidIndustry&&rules[kind].minKm===null)rules[kind]={minKm:rules[kind].maxKm,maxKm:null};
      }
      const manual=spec.distanceKm?.[kind];
      if(active.has(kind)&&rules[kind].minKm===null&&rules[kind].maxKm===null&&typeof manual==='number'&&Number.isFinite(manual)&&manual>=0&&manual<=50)rules[kind][kind==='industry'?'minKm':'maxKm']=manual;
      if(active.has(kind)&&rules[kind].minKm===null&&rules[kind].maxKm===null)rules[kind][kind==='industry'?'minKm':'maxKm']=defaults[kind];
    }
    return rules;
  }
  const rad=Math.PI/180,R=6371;
  function haversine(a,b){const lat=(b.lat-a.lat)*rad,lng=(b.lng-a.lng)*rad,h=Math.sin(lat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(lng/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));}
  function onSegment(p,a,b){const cross=(p.lng-a[0])*(b[1]-a[1])-(p.lat-a[1])*(b[0]-a[0]);return Math.abs(cross)<1e-12&&p.lng>=Math.min(a[0],b[0])-1e-12&&p.lng<=Math.max(a[0],b[0])+1e-12&&p.lat>=Math.min(a[1],b[1])-1e-12&&p.lat<=Math.max(a[1],b[1])+1e-12;}
  function inRing(p,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[j],b=ring[i];if(onSegment(p,a,b))return true;if((a[1]>p.lat)!==(b[1]>p.lat)&&p.lng<(b[0]-a[0])*(p.lat-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
  function segmentDistance(p,a,b){const cos=Math.cos(p.lat*rad),ax=(a[0]-p.lng)*rad*R*cos,ay=(a[1]-p.lat)*rad*R,bx=(b[0]-p.lng)*rad*R*cos,by=(b[1]-p.lat)*rad*R,dx=bx-ax,dy=by-ay,t=dx*dx+dy*dy?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy))):0;return Math.hypot(ax+t*dx,ay+t*dy);}
  function geometryDistance(p,geometry) {
    if(geometry?.type==='Point')return haversine(p,{lng:geometry.coordinates[0],lat:geometry.coordinates[1]});
    if(!['Polygon','MultiPolygon'].includes(geometry?.type))return null;
    const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;let distance=Infinity;
    for(const polygon of polygons) {
      if(!polygon.length)continue;
      if(inRing(p,polygon[0])&&!polygon.slice(1).some(hole=>inRing(p,hole)))return 0;
      for(const ring of polygon)for(let i=0;i<ring.length;i++)distance=Math.min(distance,segmentDistance(p,ring[i],ring[(i+1)%ring.length]));
    }
    return Number.isFinite(distance)?distance:null;
  }
  function nearest(p,items=[]) {
    let result=null;
    for(const item of items) {
      let km=geometryDistance(p,item.geometry),accuracy=km===null?'point':'geometry';
      if(km===null) {
        const [west,south,east,north]=item.extent||[item.point.lng,item.point.lat,item.point.lng,item.point.lat];
        const edge={lat:Math.max(south,Math.min(north,p.lat)),lng:Math.max(west,Math.min(east,p.lng))};
        km=haversine(p,edge);if(west!==east||south!==north)accuracy='extent';
      }
      if(!result||km<result.km)result={km,item,accuracy};
    }
    return result;
  }
  function checkDistance(near,rule) {
    if(!rule||rule.minKm===null&&rule.maxKm===null)return {pass:true,uncertain:false};
    if(!near)return {pass:true,uncertain:true};
    if(rule.maxKm!==null&&near.km>rule.maxKm)return {pass:false,uncertain:false};
    if(near.accuracy==='extent')return {pass:true,uncertain:true};
    if(rule.minKm!==null&&near.km<rule.minKm)return {pass:false,uncertain:false};
    return {pass:true,uncertain:false};
  }
  function resultKey(result){return `${result.sourceId||result.feature?.properties?.plangebied||''}|${result.envelopeId?'bouwvlak:'+result.envelopeId:'designation:'+(result.feature?.properties?.identificatie||`${result.point.lat.toFixed(5)}:${result.point.lng.toFixed(5)}`)}`;}
  function queryLocation(query,region) {
    if(!region)return null;
    const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const aliases=place=>[place.name,...(place.name==='Fryslân'?['Friesland']:place.name==="'s-Gravenhage"?['Den Haag']:place.name==="'s-Hertogenbosch"?['Den Bosch']:[])];
    const mentions=[];
    for(const [type,places] of [['municipality',region.municipalities],['province',region.provinces]])for(const place of places||[]) {
      const names=aliases(place);if(type==='municipality'&&/\s*\([^)]+\)$/.test(place.name))names.push(place.name.replace(/\s*\([^)]+\)$/,''));
      for(const name of names)for(const match of query.matchAll(new RegExp('(?<![\\p{L}\\p{N}_-])'+escape(name)+'(?![\\p{L}\\p{N}_-])','giu')))mentions.push({start:match.index,end:match.index+match[0].length,type,place});
    }
    // Prefer a complete official name (Bergen op Zoom) over its short prefix.
    const maximal=mentions.filter(m=>!mentions.some(other=>other.start<=m.start&&other.end>=m.end&&other.end-other.start>m.end-m.start));
    const spans=[...new Set(maximal.map(m=>`${m.start}:${m.end}`))].map(key=>{const [start,end]=key.split(':').map(Number);return {start,end,options:maximal.filter(m=>m.start===start&&m.end===end)};}).sort((a,b)=>a.start-b.start);
    const recognized=[],invalid=[];
    for(const span of spans) {
      const before=query.slice(0,span.start),after=query.slice(span.end),prefix=before.match(/(?:\b(?:in|within|inside|binnen|im)\s+(?:(?:the|de|het|der|die|den)\s+)?(?:(provincie|province|provinz|gemeente|municipality|gemeinde)\s+(?:of\s+)?)?|\b(provincie|province|provinz|gemeente|municipality|gemeinde)\s+(?:of\s+)?)$/i);
      const suffix=after.match(/^\s+(provincie|province|provinz|gemeente|municipality|gemeinde)\b/i);
      const previous=recognized.at(-1),linked=previous&&/^\s*(?:,|and|und|en|or|of|oder|&)\s*(?:(?:in|within|inside|binnen|im)\s+)?$/i.test(query.slice(previous.end,span.start));
      if(!prefix&&!suffix&&!linked)continue;
      const cue=prefix?.[1]||prefix?.[2]||suffix?.[1]||linked&&previous.cue||'';
      const requestedType=/provincie|province|provinz/i.test(cue)?'province':/gemeente|municipality|gemeinde/i.test(cue)?'municipality':null;
      let options=requestedType?span.options.filter(m=>m.type===requestedType):span.options.some(m=>m.type==='municipality')?span.options.filter(m=>m.type==='municipality'):span.options;
      if(!options.length){invalid.push(...span.options.map(option=>option.place.name));continue;}
      options=[...new Map(options.map(option=>[`${option.type}:${option.place.code}`,option])).values()];
      recognized.push({...span,cue,options});
    }
    if(invalid.length)return {error:'type',names:[...new Set(invalid)]};
    if(recognized.some(m=>m.options.length>1))return {error:'ambiguous',names:[...new Set(recognized.flatMap(m=>m.options.map(option=>option.place.name)))]};
    const selected=[...new Map(recognized.map(m=>m.options[0]).map(option=>[`${option.type}:${option.place.code}`,option])).values()];
    if(selected.length>1)return {error:'multiple',names:selected.map(option=>option.place.name)};
    return selected.length?{type:selected[0].type,place:selected[0].place}:null;
  }
  const api={kinds,defaults,emptyRules,cleanRules,parseDistanceRules,resolveRules,haversine,geometryDistance,nearest,checkDistance,resultKey,queryLocation};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.PlanViewSearchCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
