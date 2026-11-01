/* Pure search semantics shared by the browser and regression tests. */
(function (root) {
  'use strict';
  const kinds = ['camping','town','station','park','sports','cemetery','swimming_pool','marina','industry','hospital','allotments','recreation_area'];
  const defaults = {camping:3,town:6,station:3,park:2,sports:2,cemetery:2,swimming_pool:2,marina:3,industry:1.2,hospital:2,allotments:2,recreation_area:3};
  const terms = {
    camping:/\b(?:camp(?:ing|site|ground)?s?|holiday\s*parks?|vacation\s*parks?|ferienparks?|campingpl[aä]tze?|kampeer\w*)\b/ig,
    town:/\b(?:towns?|villages?|cities|city|dorp(?:en)?|stad|steden|orte?|stadt|st[aä]dte|d[oö]rfer)\b/ig,
    station:/\b(?:train\s*stations?|rail(?:way)?\s*stations?|treinstations?|bahnh[oö]fe?|bahnhof)\b/ig,
    park:/\b(?:parks?|parken|parkanlagen?)\b/ig,
    sports:/\b(?:sports? (?:fields?|complex|grounds?)|sportterrein(?:en)?|sportcomplex(?:en)?|sportanlagen?|sportpl[aä]tze?)\b/ig,
    cemetery:/\b(?:cemeter(?:y|ies)|graveyards?|begraafplaats(?:en)?|friedh[oö]fe?|friedhof)\b/ig,
    swimming_pool:/\b(?:swimming pools?|zwembad(?:en)?|schwimmb[aä]der|schwimmbad)\b/ig,
    marina:/\b(?:marinas?|jachthavens?|yachth[aä]fen|yachthafen)\b/ig,
    industry:/\b(?:indust\w*|bedrijventerrein|gewerbe\w*)\b/ig,
    hospital:/\b(?:hospitals?|ziekenhuis(?:complex)?|ziekenhuizen|krankenh[aä]user|krankenhaus)\b/ig,
    allotments:/\b(?:allotments?|allotment\s+gardens?|volkstuinen?|kleing[aä]rten|kleingarten(?:anlagen?)?|schreberg[aä]rten|schrebergarten)\b/ig,
    recreation_area:/\b(?:recreational?\s+areas?|recreatiegebieden?|recreatiegebied|(?:nah)?erholungsgebiete?)\b/ig
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
    const range=new RegExp('(?:\\b(?:between|zwischen|tussen)\\s+)?'+number+'\\s*'+unit+'?\\s*(?:-|–|\\bto\\b|\\bbis\\b|\\btot\\b|\\band\\b|\\bund\\b|\\ben\\b)\\s*'+number+'\\s*'+unit+'\\b(?!²)','ig');
    for(const match of query.matchAll(range)) {
      const minKm=toKm(match[1],match[2]||match[4]),maxKm=toKm(match[3],match[4]);
      if(minKm<=maxKm&&maxKm<=50) {expressions.push({start:match.index,end:match.index+match[0].length,minKm,maxKm});occupied.push([match.index,match.index+match[0].length]);}
    }
    const single=new RegExp(number+'\\s*'+unit+'\\b(?!²)','ig');
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
  // Parcel thresholds describe mapped geometry, never the floor area or building
  // percentage allowed by a plan. Keep all fields explicit for AI/manual parity.
  const siteLimits={parcelMinAreaM2:Infinity,parcelMaxAreaM2:Infinity,minEnvelopeAreaM2:Infinity,minEnvelopePercent:100,maxBuildingCoveragePercent:100,minNaturaDistanceKm:50};
  const emptySiteCriteria=()=>({...Object.fromEntries(Object.keys(siteLimits).map(key=>[key,null])),excludeNatura2000:false});
  function siteCriteriaErrors(raw={}) {
    const errors=[];
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return ['Site criteria must be an object.'];
    for(const [key,max] of Object.entries(siteLimits)) {
      const value=raw[key];
      if(value!==undefined&&value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<0||value>max))errors.push(`Invalid ${key}: expected a finite number from 0${Number.isFinite(max)?` to ${max}`:''}.`);
    }
    if(raw.excludeNatura2000!==undefined&&typeof raw.excludeNatura2000!=='boolean')errors.push('Invalid excludeNatura2000: expected true or false.');
    if(typeof raw.parcelMinAreaM2==='number'&&typeof raw.parcelMaxAreaM2==='number'&&raw.parcelMinAreaM2>raw.parcelMaxAreaM2)errors.push('Minimum parcel area exceeds maximum parcel area.');
    return errors;
  }
  function cleanSiteCriteria(raw) {
    const clean=emptySiteCriteria();
    for(const [key,max] of Object.entries(siteLimits))if(typeof raw?.[key]==='number'&&Number.isFinite(raw[key])&&raw[key]>=0&&raw[key]<=max)clean[key]=raw[key];
    clean.excludeNatura2000=raw?.excludeNatura2000===true;
    return clean;
  }
  const areaNumber='(\\d+(?:[.,]\\d+)?)',areaUnit='(m²|m2|sqm|sq\\.?\\s*m|square\\s*met(?:er|re)s?|vierkante\\s*meters?|quadratmeter[n]?|ha|hectares?|hectaren|hektar)';
  const parcelTerm=/\b(?:parcels?|plots?|lots?|perce(?:el|len)|kavels?|grondstuk(?:ken)?|grundst[uü]ck\w*)\b/i;
  const envelopeTerm=/\b(?:bouwvlakk?\w*|baufenster\w*|building\s+envelopes?)\b/i;
  const coverageTerm=/\b(?:bag|building\s+(?:coverage|footprints?)|bebouwingsgraad|bebouwd\w*|bebouwing|[uü]berbaut\w*|bebaut\w*|geb[aä]ude(?:anteil|abdeckung|grundfl[aä]che))\b/i;
  const naturaTerm=/\bnatura\s*2000\b/i;
  const minOperator=/(?:at\s+least|minimum|min\.?|mindestens|minimaal|ten\s+minste|ab|>=|≥)\s*$/i;
  const maxOperator=/(?:at\s+most|up\s+to|no\s+more\s+than|not\s+more\s+than|maximum|max\.?|h[oö]chstens|maximal|maximaal|hoogstens|bis\s+zu|<=|≤)\s*$/i;
  const numberValue=value=>Number(value.replace(',','.'));
  const areaValue=(value,u)=>numberValue(value)*(/^(?:ha|hect|hekt)/i.test(u)?10000:1);
  function boundMode(before,after) {
    if(minOperator.test(before)||/^\s*(?:or\s+more|oder\s+mehr|of\s+meer)\b/i.test(after))return 'min';
    if(maxOperator.test(before)||/^\s*(?:or\s+less|oder\s+weniger|of\s+minder)\b/i.test(after))return 'max';
    if(/(?:exactly|precisely|genau|exakt|precies|exact|=)\s*$/i.test(before))return 'exact';
    return null;
  }
  function parseSiteCriteria(query='') {
    const siteCriteria=emptySiteCriteria(),unsupported=[];
    const addUnsupported=clause=>{const message=`Check requested site criterion: ${clause.trim()}`;if(!unsupported.includes(message))unsupported.push(message);};
    // Split only at explicit conjunctions that do not introduce the second
    // number of a range. A height/permission request cannot borrow a parcel noun
    // from the preceding independent condition.
    const clauses=String(query).split(/[;!?\n]|\.(?!\d)|,(?!\d)|\s+(?:and|und|en)\s+(?!\d)/i).filter(Boolean);
    function assign(key,value,clause) {
      if(!Number.isFinite(value)||value<0||value>siteLimits[key]){addUnsupported(clause);return;}
      if(siteCriteria[key]===null)siteCriteria[key]=value;
      else siteCriteria[key]=/^(?:parcelMax|maxBuilding)/.test(key)?Math.min(siteCriteria[key],value):Math.max(siteCriteria[key],value);
    }
    let previousKind=null;
    for(const clause of clauses) {
      let isEnvelope=envelopeTerm.test(clause),isParcel=parcelTerm.test(clause),isCoverage=coverageTerm.test(clause);
      const isNatura=naturaTerm.test(clause);
      if(!isNatura&&!isEnvelope&&!isParcel&&!isCoverage&&/^(?:\s*)(?:at\s+least|at\s+most|minimum|maximum|min\.?|max\.?|mindestens|h[oö]chstens|minimaal|maximaal|hoogstens|>=|<=|≥|≤)\s+\d/i.test(clause)) {
        isParcel=previousKind==='parcel';isEnvelope=previousKind==='envelope';isCoverage=previousKind==='coverage';
      }
      previousKind=isParcel&&!isEnvelope?'parcel':isEnvelope&&!isParcel?'envelope':isCoverage?'coverage':null;
      const guarded=/\b(?:floor\s*area|living\s*area|wohnfl[aä]che\w*|vloeroppervlak\w*|vergunning\w*|permit\w*|permission|allowed|toegestaan|zul[aä]ssig\w*|erlaub\w*|genehmig\w*|hoogte|height|h[oö]he)\b/i.test(clause);
      const hasArea=new RegExp(areaNumber+'\\s*'+areaUnit+'(?![\\p{L}\\p{N}])','iu').test(clause),hasPercent=/\d\s*%|\d\s*(?:percent|prozent|procent)/i.test(clause);
      // Environmental quantities have their own units and evidence adapter.
      // Keep legal/area/coverage clauses here; do not duplicate a supported
      // noise, slope or groundwater threshold as an unsupported parcel filter.
      if(!hasArea&&!isEnvelope&&!isCoverage&&Object.values(environmentTerms).some(term=>term.test(clause)))continue;
      const hasOr=/\b(?:or|oder|of)\b(?!\s+(?:more|less|mehr|weniger|meer|minder)\b)/i.test(clause.replace(/\bof\s+(?:a\s+|the\s+)?(?:parcel|plot|bouwvlak|building|natura)/ig,''));
      if(guarded&&/\d/.test(clause)||(hasOr&&(hasArea||hasPercent||isNatura))){addUnsupported(clause);continue;}
      if((hasArea||hasPercent)&&/(?:^|\s)[-−]\s*\d/.test(clause)){addUnsupported(clause);continue;}
      // A bare separator followed by three digits could be a decimal or a
      // thousands separator. Let the semantic interpreter/user disambiguate.
      if((hasArea||hasPercent)&&new RegExp('\\b[1-9]\\d*[.,]\\d{3}\\s*(?:'+areaUnit+'|%|percent|prozent|procent)','i').test(clause)){addUnsupported(clause);continue;}
      if(isNatura) {
        if(/\b(?:not|nicht|niet)\s+(?:outside|excluding|au(?:ß|ss)erhalb|buiten)|\b(?:without|ohne|zonder)\s+(?:excluding|ausschluss|uitsluiting)/i.test(clause)){addUnsupported(clause);continue;}
        const excluded=/(?:\b(?:outside|excluding|exclude|avoid|without|zonder|buiten|uitsluiten|vermeid\w*|ohne)\b|au(?:ß|ss)erhalb)/i.test(clause)||/\b(?:no|geen|keine?)\s+natura\s*2000\b/i.test(clause)||/\b(?:ausschlie(?:ß|ss)en|uitsluiten)\b/i.test(clause);
        if(excluded)siteCriteria.excludeNatura2000=true;
        const distance=clause.match(new RegExp('(?<![\\d.])'+areaNumber+'\\s*'+unit+'\\b','i'));
        if(distance) {
          const mode=boundMode(clause.slice(0,distance.index),clause.slice(distance.index+distance[0].length));
          const nearbyExclusion=excluded&&/\b(?:within|binnen|im\s+umkreis|innerhalb)\b/i.test(clause);
          const otherDistance=Object.values(parseDistanceRules(clause)).some(rule=>rule.minKm!==null||rule.maxKm!==null);
          if(!otherDistance&&(mode==='min'||nearbyExclusion))assign('minNaturaDistanceKm',toKm(distance[1],distance[2]),clause);else addUnsupported(clause);
        } else if(!excluded)addUnsupported(clause);
      }
      if(hasArea) {
        const range=clause.match(new RegExp('(?:\\b(?:between|zwischen|tussen)\\s+)?'+areaNumber+'\\s*'+areaUnit+'?\\s*(?:-|–|\\bto\\b|\\bbis\\b|\\btot\\b|\\band\\b|\\bund\\b|\\ben\\b)\\s*'+areaNumber+'\\s*'+areaUnit+'(?![\\p{L}\\p{N}])','iu'));
        if(range) {
          const min=areaValue(range[1],range[2]||range[4]),max=areaValue(range[3],range[4]);
          if(!isParcel||isEnvelope||min>max)addUnsupported(clause);
          else {assign('parcelMinAreaM2',min,clause);assign('parcelMaxAreaM2',max,clause);}
        } else {
          const matches=[...clause.matchAll(new RegExp('(?<![\\d.,-])'+areaNumber+'\\s*'+areaUnit+'(?![\\p{L}\\p{N}])','giu'))];
          if(!matches.length)addUnsupported(clause);
          for(const match of matches) {
            const mode=boundMode(clause.slice(0,match.index),clause.slice(match.index+match[0].length)),value=areaValue(match[1],match[2]);
            if(isEnvelope&&!isParcel&&mode==='min')assign('minEnvelopeAreaM2',value,clause);
            else if(isParcel&&!isEnvelope&&mode) {
              if(mode!=='max')assign('parcelMinAreaM2',value,clause);
              if(mode!=='min')assign('parcelMaxAreaM2',value,clause);
            } else addUnsupported(clause);
          }
        }
      }
      if(hasPercent) {
        const percentages=[...clause.matchAll(new RegExp('(?<![\\d.,-])'+areaNumber+'\\s*(?:%|percent|prozent|procent)','ig'))];
        if(!percentages.length)addUnsupported(clause);
        for(const match of percentages) {
          const mode=boundMode(clause.slice(0,match.index),clause.slice(match.index+match[0].length));
          if(isEnvelope&&mode==='min')assign('minEnvelopePercent',numberValue(match[1]),clause);
          else if(isCoverage&&mode==='max')assign('maxBuildingCoveragePercent',numberValue(match[1]),clause);
          else addUnsupported(clause);
        }
      }
      if(!hasArea&&!hasPercent&&!isNatura&&/\d+\s*(?:m\b|km\b|dB\b|decibel\w*|euro\w*|€|rooms?\b|zimmer\w*|kamers?\b|floors?\b|etagen?\b)/i.test(clause)&&!Object.values(parseDistanceRules(clause)).some(rule=>rule.minKm!==null||rule.maxKm!==null))addUnsupported(clause);
    }
    unsupported.push(...siteCriteriaErrors(siteCriteria));
    return {siteCriteria,unsupported:[...new Set(unsupported)]};
  }
  function resolveSiteCriteria(raw,query='',{includeParserUnsupported=true}={}) {
    const siteCriteria=cleanSiteCriteria(raw),parsed=parseSiteCriteria(query),unsupported=siteCriteriaErrors(raw??{});
    for(const key of Object.keys(siteLimits))if(siteCriteria[key]===null)siteCriteria[key]=parsed.siteCriteria[key];
    siteCriteria.excludeNatura2000||=parsed.siteCriteria.excludeNatura2000;
    // The local grammar deliberately rejects ambiguous wording. A validated AI
    // interpretation may already have resolved it and supplies its own complete
    // unsupported list; callers keep that list and suppress only grammar doubts.
    return {siteCriteria,unsupported:[...new Set([...unsupported,...(includeParserUnsupported?parsed.unsupported:[]),...siteCriteriaErrors(siteCriteria)])]};
  }
  const environmentLimits={maxNoiseDb:140,maxSlopeDeg:90,minGroundwaterDepthCm:10000};
  // BRO Soil Map main groups. These are map classifications, not a claim about
  // a sampled material, bearing capacity or soil contamination.
  const soilClasses=['peat','peaty','podzol','brik','thick_earth','sand','calcareous_silt','unripe_mineral','marine_clay','river_clay','old_river_clay','old_clay','loam','old_limburg'];
  const emptyEnvironmentCriteria=()=>({maxNoiseDb:null,maxSlopeDeg:null,soilClasses:[],minGroundwaterDepthCm:null});
  function environmentCriteriaErrors(raw={}) {
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return ['Environment criteria must be an object.'];
    const errors=[];
    for(const [key,max] of Object.entries(environmentLimits)) {
      const value=raw[key];
      if(value!==undefined&&value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<0||value>max))errors.push(`Invalid ${key}: expected a finite number from 0 to ${max}.`);
    }
    if(raw.soilClasses!==undefined&&(!Array.isArray(raw.soilClasses)||raw.soilClasses.some(value=>!soilClasses.includes(value))))errors.push('Invalid soilClasses: use supported mapped soil classes.');
    return errors;
  }
  function cleanEnvironmentCriteria(raw) {
    const clean=emptyEnvironmentCriteria();
    for(const [key,max] of Object.entries(environmentLimits))if(typeof raw?.[key]==='number'&&Number.isFinite(raw[key])&&raw[key]>=0&&raw[key]<=max)clean[key]=raw[key];
    if(Array.isArray(raw?.soilClasses))clean.soilClasses=[...new Set(raw.soilClasses.filter(value=>soilClasses.includes(value)))];
    return clean;
  }
  const environmentTerms={
    noise:/\b(?:noise|sound\s*level|sound\s*exposure|l[aä]rm\w*|lautst[aä]rke|schall\w*|ger[aä]usch\w*|geluid\w*|decibels?|db(?:\(a\))?|lden)\b/i,
    slope:/\b(?:slope|incline|gradient|hangneigung|gel[aä]ndeneigung|gef[aä]lle|steigung|helling\w*|flat\s+(?:land|terrain)|level\s+(?:land|terrain)|eben\w*\s+(?:grundst[uü]ck|gel[aä]nde)|flach\w*\s+(?:grundst[uü]ck|gel[aä]nde)|vlak(?:ke)?\s+(?:grond|terrein))\b/i,
    groundwater:/\b(?:ground\s*water|groundwater|grundwasser\w*|grondwater\w*|ghg|glg|gvg)\b/i,
    soil:/\b(?:soil|boden\w*|bodem\w*|grondsoort\w*|sandb[oö]den|sandboden|lehmboden|tonboden|torfboden|zandgrond\w*|kleigrond\w*|veengrond\w*|podzol\w*|brik\w*|eerdgrond\w*|sand|zand|clay|klei)\b/i
  };
  const soilAliases={
    peat:/\b(?:peat(?:\s+soils?)?|torf(?:boden|b[oö]den)?|veen(?:gronden?)?)\b/ig,
    peaty:/\b(?:peaty(?:\s+soils?)?|torfig\w*|moerige(?:\s+gronden)?)\b/ig,
    podzol:/\b(?:podzol\w*)\b/ig,
    brik:/\b(?:brik\w*)\b/ig,
    thick_earth:/\b(?:thick\s+earth(?:\s+soils?)?|dikke\s+eerdgronden|dicke\s+eerdgronden)\b/ig,
    sand:/\b(?:zandgronden|sandboden|sandb[oö]den|sandy\s+soils?|sand\s+soils?)\b/ig,
    calcareous_silt:/\b(?:calcareous\s+silt|kalkhoudende\s+(?:bijzonder\s+)?lutumarme\s+gronden|kalkhaltige\s+schluffb[oö]den)\b/ig,
    unripe_mineral:/\b(?:unripe\s+mineral(?:\s+soils?)?|niet[- ]gerijpte\s+minerale\s+gronden|unreife\s+mineralb[oö]den)\b/ig,
    marine_clay:/\b(?:marine\s+clay(?:\s+soils?)?|zeeklei(?:gronden)?|meeres(?:ton|kleiboden))\b/ig,
    river_clay:/\b(?:river\s+clay(?:\s+soils?)?|rivierklei(?:gronden)?|fluss(?:ton|kleiboden))\b/ig,
    old_river_clay:/\b(?:old\s+river\s+clay(?:\s+soils?)?|oude\s+rivierkleigronden|alte\s+fluss(?:ton|kleib[oö]den))\b/ig,
    old_clay:/\b(?:old\s+clay(?:\s+soils?)?|oude\s+kleigronden|alte\s+tonb[oö]den)\b/ig,
    loam:/\b(?:loam(?:\s+soils?)?|lehm(?:boden|b[oö]den)?|leem(?:gronden)?)\b/ig,
    old_limburg:/\b(?:old\s+limburg(?:\s+soils?)?|oude\s+gronden\s+(?:in\s+)?zuid[- ]limburg|alte\s+b[oö]den\s+(?:in\s+)?s[uü]dlimburg)\b/ig
  };
  function soilAlternativePart(text) {
    // An OR exception is safe only when every word names a soil class or is a
    // soil-list label. Merely finding a soil word would hide mixed criteria.
    const spans=Object.values(soilAliases).flatMap(pattern=>[...text.matchAll(pattern)].map(match=>[match.index,match.index+match[0].length]));
    const generic=/\b(?:sand|zand|clay|klei|ton(?:boden|b[oö]den)?)\b/ig;
    spans.push(...[...text.matchAll(generic)].map(match=>[match.index,match.index+match[0].length]));
    if(!spans.length)return false;
    const rest=text.split('').map((char,index)=>spans.some(([start,end])=>index>=start&&index<end)?' ':char).join('')
      .replace(/\b(?:soils?|types?|classes?|boden(?:art|typ|klasse)?|b[oö]den|bodem(?:type|soort|klasse)?|grondsoort(?:en)?|gronden|either|entweder|only|nur|uitsluitend)\b/ig,'')
      .replace(/[\s:()[\]{}"'–—-]/g,'');
    return rest.length===0;
  }
  function hasUnsupportedAlternatives(query='') {
    // Do not split at AND: "noise X and sand or loam" has ambiguous scope.
    // Separate sentences/list clauses may contain other independent filters.
    return String(query).split(/[;!?\n]|\.(?!\d)|,(?!\d)/).some(clause=>{
      const explicit=[...clause.matchAll(/\b(?:or|oder)\b/ig)].some(match=>{
        const before=clause.slice(0,match.index),after=clause.slice(match.index+match[0].length);
        const numericSuffix=/\d(?:[.,]\d+)?\s*(?:m²|m2|sqm|ha|km|cm|m|dB(?:\(A\))?|°|degrees?|deg|grad(?:en)?|%|percent|prozent|procent)?\s*$/i.test(before)&&/^\s+(?:more|less|mehr|weniger)\b/i.test(after);
        const equalComparison=/\b(?:less|greater|smaller|more)\s+than\s*$/i.test(before)&&/^\s+equal\s+to\b/i.test(after);
        return !numericSuffix&&!equalComparison;
      });
      const dutch=[...clause.matchAll(/\bof\b/ig)].some(match=>{
        const before=clause.slice(0,match.index),after=clause.slice(match.index+match[0].length);
        // English "within 1 km of a hospital" is not an alternative. Dutch
        // soil lists and a following criterion are; keep their guard explicit.
        return /^\s*(?:binnen|nabij|dichtbij|maximaal|minimaal|geluid\w*|helling\w*|grondwater\w*|bodem\w*)\b/i.test(after)||soilAlternativePart(before)||soilAlternativePart(after);
      });
      if(!explicit&&!dutch)return false;
      const parts=clause.split(/\b(?:or|oder|of)\b/i);
      return parts.length<2||!parts.every(soilAlternativePart);
    });
  }
  function environmentMode(before,after) {
    const basic=boundMode(before,after);if(basic)return basic;
    if(/^\s*(?:maximum|max(?:imal|imaal)?\.?|h[oö]chstens|at\s+most|hoogstens)\b/i.test(after))return 'max';
    if(/^\s*(?:minimum|min(?:imaal)?\.?|mindestens|at\s+least|ten\s+minste)\b/i.test(after))return 'min';
    if(/(?:under|below|less\s+than|lower\s+than|unter|weniger\s+als|kleiner\s+als|minder\s+dan|onder|<)\s*$/i.test(before))return 'max';
    if(/(?:deeper\s+than|tiefer\s+als|dieper\s+dan|more\s+than|greater\s+than|mehr\s+als|groter\s+dan|>)\s*$/i.test(before))return 'min';
    return null;
  }
  function parseEnvironmentCriteria(query='') {
    const environmentCriteria=emptyEnvironmentCriteria(),unsupported=[],explanationNotes=[];
    const addUnsupported=clause=>{const message=`Check requested environmental criterion: ${clause.trim()}`;if(!unsupported.includes(message))unsupported.push(message);};
    const clauses=String(query).split(/[;!?\n]|\.(?!\d)|,(?!\d)|\s+(?:and|und|en)\s+(?!\d)/i).filter(Boolean);
    function assign(key,value,clause) {
      if(!Number.isFinite(value)||value<0||value>environmentLimits[key]){addUnsupported(clause);return;}
      if(environmentCriteria[key]===null)environmentCriteria[key]=value;
      else environmentCriteria[key]=key==='minGroundwaterDepthCm'?Math.max(environmentCriteria[key],value):Math.min(environmentCriteria[key],value);
    }
    for(const clause of clauses) {
      const soilMentions=Object.entries(soilAliases).flatMap(([kind,pattern])=>[...clause.matchAll(pattern)].map(match=>({kind,start:match.index,end:match.index+match[0].length})));
      const noise=environmentTerms.noise.test(clause),slope=environmentTerms.slope.test(clause),groundwater=environmentTerms.groundwater.test(clause),soil=soilMentions.length>0||environmentTerms.soil.test(clause)&&(!noise&&!slope&&!groundwater||/\b(?:sand|zand|clay|klei|ton)\b/i.test(clause));
      if(!noise&&!slope&&!groundwater&&!soil)continue;
      const alternatives=/\b(?:or|oder)\b(?!\s+(?:more|less|mehr|weniger))|\bof\s+(?:maximaal|minimaal|minder|meer)\b/i.test(clause);
      if(alternatives&&(!soil||noise||slope||groundwater)||/(?:^|\s)[-−]\s*\d/.test(clause)){addUnsupported(clause);continue;}
      if(noise) {
        const numbers=[...clause.matchAll(/(?<![\d.,-])(\d+(?:[.,]\d+)?)\s*(?:dB(?:\s*\(A\))?|decibels?)(?![\p{L}\p{N}])/giu)];
        const differentMeasure=/\b(?:lnight|lmax|laeq|night\w*|nacht\w*|piek\w*|peak\w*|innen\w*|indoor\w*|binnenhuis|facade|fassade|gevel|legal\w*|compliance|gesetzlich\w*|rechtlich\w*|wettelijk\w*|voorkeursgrenswaarde)\b/i.test(clause);
        if(differentMeasure||!numbers.length&&/\d/.test(clause))addUnsupported(clause);
        else for(const match of numbers) {
          const mode=environmentMode(clause.slice(0,match.index),clause.slice(match.index+match[0].length));
          if(mode==='max')assign('maxNoiseDb',numberValue(match[1]),clause);else addUnsupported(clause);
        }
      }
      if(slope) {
        const numbers=[...clause.matchAll(/(?<![\d.,-])(\d+(?:[.,]\d+)?)\s*(°|degrees?|deg|grad(?:en)?|%|percent|prozent|procent)(?![\p{L}\p{N}])/giu)];
        if(!numbers.length)addUnsupported(clause);
        for(const match of numbers) {
          const mode=environmentMode(clause.slice(0,match.index),clause.slice(match.index+match[0].length)),number=numberValue(match[1]);
          const degrees=/^(?:%|percent|prozent|procent)$/i.test(match[2])?Math.atan(number/100)*180/Math.PI:number;
          // A building-coverage percentage must not migrate into the terrain
          // condition when both are expressed in one ambiguous clause.
          if(mode==='max'&&!coverageTerm.test(clause)&&!envelopeTerm.test(clause))assign('maxSlopeDeg',degrees,clause);else addUnsupported(clause);
        }
      }
      if(groundwater) {
        const numbers=[...clause.matchAll(/(?<![\d.,-])(\d+(?:[.,]\d+)?)\s*(cm|centimet(?:er|re)s?|zentimeter[n]?|m|met(?:er|re)s?|metern)(?![\p{L}\p{N}²])/giu)];
        const differentMeasure=/\b(?:glg|gvg|nap|above|oberhalb|boven|water\s*quality|wasserqualit[aä]t|waterkwaliteit|contaminat\w*|vervuil\w*|schutzgebiet\w*|beschermingsgebied\w*)\b/i.test(clause);
        if(differentMeasure||!numbers.length)addUnsupported(clause);
        else for(const match of numbers) {
          const mode=environmentMode(clause.slice(0,match.index),clause.slice(match.index+match[0].length)),cm=numberValue(match[1])*(/^(?:cm|cent|zent)/i.test(match[2])?1:100);
          if(mode==='min')assign('minGroundwaterDepthCm',cm,clause);else addUnsupported(clause);
        }
      }
      if(soil) {
        const soilIntent=clause.replace(/\b(?:no|not)\s+more\s+than\b/ig,'at most');
        if(/\b(?:no|not|without|exclude|excluding|geen|niet|zonder|keine?[nrs]?|nicht|ohne|contaminat\w*|vervuil\w*|schadstoff\w*|tragf[aä]hig\w*|bearing\s+capacity)\b/i.test(soilIntent)||!noise&&!slope&&!groundwater&&/\d/.test(clause)||/\b(?:sand|zand|clay|klei|peat|veen|torf(?:boden)?|lehm|loam)(?:\s+soil)?\s+(?:on|over|above|under|auf|[uü]ber|unter|op|boven|onder)\s+(?:sand|zand|clay|klei|peat|veen|torf|lehm|loam)\b/i.test(clause)){addUnsupported(clause);continue;}
        const maximal=soilMentions.filter(m=>!soilMentions.some(other=>other!==m&&other.start<=m.start&&other.end>=m.end&&other.end-other.start>m.end-m.start));
        const selected=maximal.map(mention=>mention.kind);
        const uncovered=clause.split('').map((char,index)=>maximal.some(m=>index>=m.start&&index<m.end)?' ':char).join('');
        if(/\b(?:sand|zand|sandiger?\s+boden)\b/i.test(uncovered)||/\b(?:sandboden|sandb[oö]den|sandy\s+soils?|sand\s+soils?)\b/i.test(clause)) {
          selected.push('sand','podzol');explanationNotes.push('Sand is screened as the BRO main classes Zandgronden and Podzolgronden; this is not a subsurface-material test.');
        }
        if(/\b(?:clay|klei|ton(?:boden|b[oö]den)?)\b/i.test(uncovered)) {
          selected.push('marine_clay','river_clay','old_river_clay','old_clay');explanationNotes.push('Clay is screened as the BRO marine, river, old river and old clay main classes; this is not a subsurface-material test.');
        }
        if(selected.length)environmentCriteria.soilClasses=[...new Set([...environmentCriteria.soilClasses,...selected])];else addUnsupported(clause);
      }
    }
    return {environmentCriteria,unsupported:[...new Set([...unsupported,...environmentCriteriaErrors(environmentCriteria)])],explanationNotes:[...new Set(explanationNotes)]};
  }
  function resolveEnvironmentCriteria(raw,query='',{includeParserUnsupported=true}={}) {
    const environmentCriteria=cleanEnvironmentCriteria(raw),parsed=parseEnvironmentCriteria(query),unsupported=environmentCriteriaErrors(raw??{});
    for(const key of Object.keys(environmentLimits))if(environmentCriteria[key]===null)environmentCriteria[key]=parsed.environmentCriteria[key];
    if(!environmentCriteria.soilClasses.length)environmentCriteria.soilClasses=parsed.environmentCriteria.soilClasses;
    return {environmentCriteria,unsupported:[...new Set([...unsupported,...(includeParserUnsupported?parsed.unsupported:[]),...environmentCriteriaErrors(environmentCriteria)])],explanationNotes:parsed.explanationNotes};
  }
  const exclusionAliases={
    woongebied:'woongebieden?|residential areas?|wohngebiete?',wonen:'wonen|woningbouw|residential|housing|wohnen',gemengd:'gemengd|mixed[ -]?use|mischgebiet|gemischte',
    bedrijventerrein:'bedrijventerreinen?|industrial estates?|gewerbegebiete?',bedrijf:'bedrijf|business|commercial|gewerbe',centrum:'centrum|city centre|stadtzentrum|innenstadt',
    groen:'groen|green|gruen|grün',natuur:'natuur|nature|natur',water:'water|wasser',verkeer:'verkeer|traffic|transport|verkehr',
    maatschappelijk:'maatschappelijk|civic|public services|gemeinbedarf',agrarisch:'agrarisch|agriculture|agricultural|landwirtschaft(?:lich\\w*)?',bos:'bos|forests?|wald',
    kantoor:'kantoor|office|büro|buero',detailhandel:'detailhandel|retail|einzelhandel',horeca:'horeca|hospitality|gastronomie',recreatie:'recreatie|recreation(?:al)? zoning|freizeitgebiet'
  };
  function parseExclusions(query='') {
    const excludeGroups=[],excludeStatuses=[];
    const negative='(?:no|not|without|exclude|excluding|geen|niet|zonder|keine?[nrs]?|nicht|ohne)';
    for(const clause of String(query).split(/[;.!?\n]|\s+(?:but|aber|maar)\s+/i)) {
      const mentions=[];
      for(const [kind,words] of Object.entries({...exclusionAliases,vastgesteld:'vastgesteld|adopted|beschlossen',onherroepelijk:'onherroepelijk|final|rechtskr[aä]ftig|rechtskraeftig'})) {
        for(const match of clause.matchAll(new RegExp('\\b(?:'+words+')\\b','ig'))) {
          mentions.push({kind,start:match.index,end:match.index+match[0].length});
        }
      }
      const maximal=mentions.filter(m=>!mentions.some(other=>other!==m&&other.start<=m.start&&other.end>=m.end&&other.end-other.start>m.end-m.start)).sort((a,b)=>a.start-b.start);
      let previous=null;
      for(const mention of maximal) {
          const {kind,start,end}=mention,before=clause.slice(0,start),after=clause.slice(end);
          const immediate=new RegExp('\\b'+negative+'\\s+(?:(?:the|a|an|de|het|een|der|die|das|ein(?:e[nmrs]?)?)\\s+)?(?:(?:zoning|zone|bestemming|gebiet|nutzung|plannen?|plans?)\\s+)?$','i').test(before);
          const trailing=/^\s*(?:(?:zoning|zone|bestemming|nutzung|plannen?|plans?)\s+)?(?:uitsluiten|ausschlie(?:ß|ss)en|excluded)\b/i.test(after);
          const linked=previous&&/^\s*(?:(?:zoning|zone|bestemming|nutzung|plannen?|plans?)\s+)?(?:,|and|und|en|or|oder|of|nor|noch)\s*$/i.test(clause.slice(previous.end,start));
          if(!immediate&&!trailing&&!linked||/\b(?:not|nicht|niet)\s+(?:without|ohne|zonder)\s*$/i.test(before)){previous=null;continue;}
          // Surroundings avoidance belongs to distanceRules.industry, not a
          // zoning exclusion. Explicit category words still opt into exclusion.
          if(['bedrijf','bedrijventerrein'].includes(kind)&&/\b(?:nearby|near|within|in de buurt|nabij|n[aä]he|umkreis)\b/i.test(clause)&&!/\b(?:zoning|zone|bestemming|nutzung|category|kategorie)\b/i.test(clause)){previous=null;continue;}
          (kind in exclusionAliases?excludeGroups:excludeStatuses).push(kind);
          previous=mention;
      }
    }
    return {excludeGroups:[...new Set(excludeGroups)],excludeStatuses:[...new Set(excludeStatuses)]};
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
  const geometryExtents=new WeakMap();
  function polygonLowerBound(p,geometry) {
    if(!geometry||!['Polygon','MultiPolygon'].includes(geometry.type))return null;
    let extent=geometryExtents.get(geometry);
    if(!extent) {
      extent=[Infinity,Infinity,-Infinity,-Infinity];
      const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
      for(const polygon of polygons)for(const ring of polygon)for(const [lng,lat] of ring){extent[0]=Math.min(extent[0],lng);extent[1]=Math.min(extent[1],lat);extent[2]=Math.max(extent[2],lng);extent[3]=Math.max(extent[3],lat);}
      geometryExtents.set(geometry,extent);
    }
    if(!extent.every(Number.isFinite))return null;
    const [west,south,east,north]=extent,dx=(Math.max(west,Math.min(east,p.lng))-p.lng)*rad*R*Math.cos(p.lat*rad),dy=(Math.max(south,Math.min(north,p.lat))-p.lat)*rad*R;
    // Same local projection as segmentDistance: the full polygon lies inside
    // this box, so its distance can never be less than this cheap lower bound.
    return Math.hypot(dx,dy);
  }
  function nearest(p,items=[]) {
    let result=null;
    for(const item of items) {
      if(result?.km===0)return result;
      if(result){const lower=polygonLowerBound(p,item.geometry);if(lower!==null&&lower>=result.km)continue;}
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
  const api={kinds,defaults,emptyRules,cleanRules,parseDistanceRules,resolveRules,emptySiteCriteria,cleanSiteCriteria,siteCriteriaErrors,parseSiteCriteria,resolveSiteCriteria,soilClasses,emptyEnvironmentCriteria,cleanEnvironmentCriteria,environmentCriteriaErrors,parseEnvironmentCriteria,resolveEnvironmentCriteria,hasUnsupportedAlternatives,parseExclusions,haversine,geometryDistance,nearest,checkDistance,resultKey,queryLocation};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.PlanViewSearchCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
