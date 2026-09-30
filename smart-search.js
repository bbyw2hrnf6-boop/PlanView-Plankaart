/* Spatial search is evidence-led: sample PDOK plan geometry, interpret the request,
   compare a cached official TOP10NL surroundings snapshot, then rank plan areas.
   It is a screening workflow, never a legal buildability or acoustic finding. */
(() => {
  const $ = id => document.getElementById(id);
  const safe = value => esc(String(value ?? ''));
  const allowedGroups = new Set(['wonen','woongebied','gemengd','bedrijf','bedrijventerrein','centrum','groen','natuur','water','verkeer','maatschappelijk','agrarisch','bos','kantoor','detailhandel','horeca']);
  const allStatus = ['vastgesteld','onherroepelijk'];
  const buildReviewGroups = new Set(['wonen','woongebied','gemengd','centrum','bedrijf','bedrijventerrein']);
  const nearbyTypes = {
    station:{km:3,label:['rail station','treinstation','Bahnhof'],pattern:/\b(train stations?|rail(?:way)? stations?|treinstations?|bahnh[oö]fe?|bahnhof)\b/i},
    park:{km:2,label:['park','park','Park'],pattern:/\b(parks?|parken|parks?anlage[n]?)\b/i},
    sports:{km:2,label:['sports complex','sportterrein','Sportanlage'],pattern:/\b(sports? (?:fields?|complex|grounds?)|sportterreinen?|sportcomplexen?|sportanlagen?|sportpl[aä]tze?)\b/i},
    cemetery:{km:2,label:['cemetery','begraafplaats','Friedhof'],pattern:/\b(cemeter(?:y|ies)|graveyards?|begraafplaatsen?|friedh[oö]fe?|friedhof)\b/i},
    swimming_pool:{km:2,label:['swimming pool','zwembad','Schwimmbad'],pattern:/\b(swimming pools?|zwembaden?|schwimmb[aä]der|schwimmbad)\b/i},
    marina:{km:3,label:['marina','jachthaven','Yachthafen'],pattern:/\b(marinas?|jachthavens?|yachth[aä]fen|yachthafen)\b/i}
  };
  const advanced = {drawing:false,suppressClick:false,bounds:null,rectangle:null,preview:null,start:null,overlay:null,results:[],ticket:0,ai:false,autoRunAfterDraw:false,contextCache:new Map(),envelopeTiles:new Map(),envelopeGeoTiles:new Map()};
  window.planviewAdvanced = advanced;
  const aliases = [
    ['woongebied',/\b(woongebieden|woongebied|residential areas?|wohngebiete?)\b/i],
    ['wonen',/\b(wonen|woningbouw|woonlocaties?|residential|housing|homes?|wohnungen?|wohnen)\b/i],
    ['gemengd',/\b(gemengd|mixed[ -]?use|mischgebiet|gemischte)\b/i],
    ['bedrijventerrein',/\b(bedrijventerrein|industrial estate|gewerbegebiet)\b/i],
    ['bedrijf',/\b(bedrijf|business|commercial|gewerbe)\b/i],
    ['centrum',/\b(centrum|city centre|stadtzentrum|innenstadt)\b/i],
    ['groen',/\b(groen|green|gruen|grün)\b/i],
    ['natuur',/\b(natuur|nature|natur)\b/i],
    ['water',/\b(water|wasser)\b/i],
    ['verkeer',/\b(verkeer|traffic|transport|verkehr)\b/i],
    ['maatschappelijk',/\b(maatschappelijk|civic|public services|gemeinbedarf)\b/i],
    ['agrarisch',/\b(agrarisch|agricultural|landwirtschaft)\b/i],
    ['bos',/\b(bos|forest|wald)\b/i],
    ['kantoor',/\b(kantoor|office|büro|buero)\b/i],
    ['detailhandel',/\b(detailhandel|retail|einzelhandel)\b/i],
    ['horeca',/\b(horeca|hospitality|restaurant|gastronomie)\b/i]
  ];
  const contextWords = {
    nearCamping:/\b(camp(?:ing|site|ground)?s?|caravan|kampeer\w*|campingpl[aä]tze?|zeltpl[aä]tze?)\b/i,
    nearTown:/\b(towns?|villages?|cities|city|dorp(?:en)?|stad|steden|orte?|stadt|st[aä]dte|d[oö]rfer)\b/i,
    avoidIndustry:/\b(no|without|away from|far from|geen|zonder|niet|weg van|keine?|ohne|fern von)\b.{0,40}\b(indust\w*|bedrijventerrein|gewerbe\w*)\b/i,
    preferQuiet:/\b(quiet|silent|peaceful|ruhig|leise|still|stil|rustig|l[aä]rmarm)\b/i,
    potentialBuildingLand:/\b(build(?:ing|able)?\s*(?:land|ground|site|plot)|bouwgrond|bouwlocatie|baugrund\w*|baufl[aä]che|bebouwbaar|bebaubar)\b/i
  };
  const tr = (en,nl,de) => ({nl,de}[document.documentElement.lang] || en);
  function localInterpret(query) {
    const negativeIndustry = contextWords.avoidIndustry.test(query);
    const groups=aliases.filter(([g,pattern])=>pattern.test(query) && !(negativeIndustry&&['bedrijf','bedrijventerrein'].includes(g))).map(([g])=>g);
    const finalOnly=/\b(onherroepelijk|rechtskräftig|rechtskraeftig|final|definitive)\b/i.test(query);
    const adopted=/\b(vastgesteld|adopted|beschlossen)\b/i.test(query);
    const build=contextWords.potentialBuildingLand.test(query),review=/\b(pr[uü]fhinweis\w*|review leads?|ter controle|onderzoekslocaties?)\b/i.test(query),envelopeMention=/\b(bouwvlak|baufenster|building envelope|buildable envelope)\b/i.test(query);
    const unsupported=[];
    if(/\b(flood\w*|overstrom\w*|hochwasser\w*|ownership|eigenaar\w*|eigentümer\w*|prijs\w*|price\w*|kosten|natura\w*|decibel\w*|hectare\w*|m²|sqm|vierkante meter)/i.test(query))unsupported.push('Some requested criteria need datasets not connected to this prototype.');
    return {groups:[...new Set(groups)],statuses:finalOnly&&adopted?allStatus:finalOnly?['onherroepelijk']:adopted?allStatus:[],requireEnvelope:build||envelopeMention,requireUnbuilt:build||/\b(onbebouwd|unbuilt|vacant|empty plot|zonder gebouw|geen gebouw|unbebaut|ohne gebäude|ohne gebaeude)\b/i.test(query),nearCamping:contextWords.nearCamping.test(query),nearTown:contextWords.nearTown.test(query),nearFeatures:Object.entries(nearbyTypes).filter(([,def])=>def.pattern.test(query)).map(([kind])=>kind),avoidIndustry:negativeIndustry,preferQuiet:contextWords.preferQuiet.test(query),potentialBuildingLand:build,includeReviewLeads:review,unsupported,explanation:'Planning geometry and nearby mapped features are checked separately.',engine:'local'};
  }
  function normalize(raw){const build=raw.potentialBuildingLand===true;return {groups:[...new Set((Array.isArray(raw.groups)?raw.groups:[]).filter(g=>allowedGroups.has(g)))],statuses:[...new Set((Array.isArray(raw.statuses)?raw.statuses:[]).filter(s=>allStatus.includes(s)))],requireEnvelope:raw.requireEnvelope===true||build,requireUnbuilt:raw.requireUnbuilt===true||build,nearCamping:raw.nearCamping===true,nearTown:raw.nearTown===true,nearFeatures:[...new Set((Array.isArray(raw.nearFeatures)?raw.nearFeatures:[]).filter(k=>k in nearbyTypes))],avoidIndustry:raw.avoidIndustry===true,preferQuiet:raw.preferQuiet===true,potentialBuildingLand:build,includeReviewLeads:raw.includeReviewLeads===true,unsupported:Array.isArray(raw.unsupported)?raw.unsupported.slice(0,4).map(String):[],explanation:String(raw.explanation||''),engine:raw.engine==='gpt-6-luna'?'gpt-6-luna':'local',backend:raw.backend==='codex-cli'?'codex-cli':raw.backend==='openai-api'?'openai-api':'none'};}
  async function interpret(query,context){
    if(advanced.ai){try{const response=await fetch('/api/interpret',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,context})});if(response.ok)return normalize(await response.json());}catch{}}
    return normalize(localInterpret(query));
  }
  function renderInterpretation(spec){
    const box=$('advanced-parsed');box.hidden=false;
    const chips=[...spec.groups.map(g=>g),...spec.statuses, ...(spec.requireEnvelope?[tr('Building envelope','Bouwvlak','Baufenster')]:[]),...(spec.requireUnbuilt?[tr('No mapped building','Geen ingetekend gebouw','Kein erfasstes Gebäude')]:[]),...(spec.nearCamping?[tr('Near camping','Bij camping','Nahe Campingplatz')]:[]),...(spec.nearTown?[tr('Near town','Bij dorp of stad','Nahe Ort')]:[]),...spec.nearFeatures.map(kind=>`${tr('Near','Bij','Nahe')} ${tr(...nearbyTypes[kind].label)}`),...(spec.avoidIndustry?[tr('Away from mapped industry','Weg van ingetekende industrie','Abstand zu erfasster Industrie')]:[]),...(spec.preferQuiet?[tr('Quietness needs verification','Stilte nog controleren','Ruhe noch prüfen')]:[]),...(spec.includeReviewLeads?[tr('Include review leads','Inclusief onderzoekslocaties','Prüfhinweise einschließen')]:[])];
    box.innerHTML=`<div class="advanced-engine">${spec.engine==='manual'?tr('Manual criteria · official map screening','Handmatige criteria · officiële kaart','Manuelle Kriterien · amtliche Karte'):spec.engine==='gpt-6-luna'?(spec.backend==='codex-cli'?'GPT-6 Luna · Codex CLI · low reasoning':'GPT-6 Luna · API · low reasoning'):tr('Local interpretation · GPT-6 Luna not connected','Lokale interpretatie · GPT-6 Luna niet verbonden','Lokale Auswertung · GPT-6 Luna nicht verbunden')}</div>${spec.explanation?`<p class="advanced-explanation">${safe(spec.explanation)}</p>`:''}${chips.length?`<div class="advanced-chips">${chips.map(x=>`<span>${safe(x)}</span>`).join('')}</div>`:''}${spec.unsupported.map(x=>`<p class="advanced-warning">${safe(x)}</p>`).join('')}`;
  }
  function setOpen(open){window.dispatchEvent(new CustomEvent('planview-search-open',{detail:{open}}));$('advanced-panel').hidden=!open;$('advanced-toggle').setAttribute('aria-expanded',String(open));$('search-results').hidden=true;if(open)$('advanced-query').focus();}
  function exitDrawing(){advanced.drawing=false;state.map.dragging.enable();state.map.doubleClickZoom.enable();$('map').classList.remove('drawing-area');$('advanced-draw').classList.remove('active');$('advanced-draw-hint')?.remove();if(advanced.preview){state.map.removeLayer(advanced.preview);advanced.preview=null;}advanced.start=null;}
  function setBounds(bounds){advanced.bounds=bounds;if(advanced.rectangle)state.map.removeLayer(advanced.rectangle);advanced.rectangle=L.rectangle(bounds,{color:'#68f3c6',weight:2,dashArray:'7 5',fillColor:'#71e2bd',fillOpacity:.1,interactive:false}).addTo(state.map);$('advanced-clear-area').hidden=false;const option=$('advanced-scope-select').querySelector('[value="drawn"]');option.disabled=false;$('advanced-scope-select').value='drawn';$('advanced-scope-label').textContent=tr('Marked area · select again to change','Gemarkeerd gebied · opnieuw kiezen om te wijzigen','Markierter Bereich · zum Ändern erneut wählen');}
  function startDrawing(autoRun=false){if(state.perspective){$('advanced-status').textContent=tr('Switch to the 2D map before marking an area.','Schakel naar de 2D-kaart voordat je een gebied markeert.','Vor dem Markieren zur 2D-Karte wechseln.');return;}if(advanced.drawing){advanced.autoRunAfterDraw=false;exitDrawing();return;}advanced.autoRunAfterDraw=autoRun;advanced.drawing=true;advanced.suppressClick=true;state.map.dragging.disable();state.map.doubleClickZoom.disable();$('map').classList.add('drawing-area');$('advanced-draw').classList.add('active');$('advanced-status').textContent=tr('Drag on the map to mark the search area.','Sleep op de kaart om het zoekgebied te markeren.','Ziehe auf der Karte ein Rechteck für das Suchgebiet.');const hint=document.createElement('div');hint.id='advanced-draw-hint';hint.className='advanced-draw-hint';hint.textContent=autoRun?tr('Drag a rectangle on the map · search will continue automatically','Teken een rechthoek op de kaart · zoeken gaat automatisch verder','Rechteck auf der Karte ziehen · die Suche läuft danach automatisch weiter'):tr('Drag a rectangle on the map','Teken een rechthoek op de kaart','Rechteck auf der Karte ziehen');if(innerWidth<=600)hint.textContent=tr('Tap two opposite corners to mark an area','Tik op twee tegenoverliggende hoeken','Zwei gegenüberliegende Ecken antippen');$('map').appendChild(hint);setOpen(false);}
  function initDrawing(){
    // Two corners are easier than a drag on touch screens; desktop keeps rectangle dragging.
    state.map.on('click',e=>{if(!advanced.drawing||innerWidth>600)return;if(!advanced.start){advanced.start=e.latlng;advanced.preview=L.circleMarker(e.latlng,{radius:6,color:'#087f70',fillOpacity:1}).addTo(state.map);return;}
      const first=state.map.latLngToContainerPoint(advanced.start),second=state.map.latLngToContainerPoint(e.latlng);if(Math.abs(first.x-second.x)<16||Math.abs(first.y-second.y)<16)return;
      const bounds=L.latLngBounds(advanced.start,e.latlng),auto=advanced.autoRunAfterDraw;exitDrawing();advanced.autoRunAfterDraw=false;advanced.suppressClick=true;setTimeout(()=>advanced.suppressClick=false,250);setBounds(bounds);$('advanced-status').textContent=tr('Area marked. Describe what you are looking for.','Gebied gemarkeerd. Beschrijf wat je zoekt.','Bereich markiert. Beschreibe, was du suchst.');setOpen(true);if(auto)runSearch();
    });
    state.map.on('mousedown',e=>{if(!advanced.drawing||innerWidth<=600)return;advanced.start=e.latlng;if(advanced.preview)state.map.removeLayer(advanced.preview);advanced.preview=L.rectangle([e.latlng,e.latlng],{color:'#68f3c6',weight:2,dashArray:'7 5',fillColor:'#71e2bd',fillOpacity:.12,interactive:false}).addTo(state.map);});
    state.map.on('mousemove',e=>{if(innerWidth>600&&advanced.drawing&&advanced.start&&advanced.preview)advanced.preview.setBounds(L.latLngBounds(advanced.start,e.latlng));});
    state.map.on('mouseup',e=>{if(innerWidth<=600||!advanced.drawing||!advanced.start)return;const a=state.map.latLngToContainerPoint(advanced.start),b=state.map.latLngToContainerPoint(e.latlng);const valid=Math.abs(a.x-b.x)>16&&Math.abs(a.y-b.y)>16;const bounds=L.latLngBounds(advanced.start,e.latlng),autoRun=advanced.autoRunAfterDraw;advanced.autoRunAfterDraw=false;exitDrawing();advanced.suppressClick=true;setTimeout(()=>advanced.suppressClick=false,200);if(valid){setBounds(bounds);$('advanced-status').textContent=tr('Area marked. Checking it now…','Gebied gemarkeerd. Wordt nu gecontroleerd…','Bereich markiert. Suche startet…');}else $('advanced-status').textContent=tr('Drag a larger rectangle to choose an area.','Teken een grotere rechthoek.','Ziehe ein größeres Rechteck auf.');setOpen(true);if(valid&&autoRun)runSearch();});
  }
  function selectedMunicipality(query=''){
    const named=state.region?.municipalities.find(item=>new RegExp(`\\b${item.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(query));
    const chosen=state.region?.municipalities.find(item=>item.code===state.municipality);
    const center=state.map?.getCenter(),inView=state.map?.getZoom()>=11&&center&&municipalityAt(center);
    const municipality=named||chosen||inView||null;
    if(municipality&&municipality.code!==state.municipality){state.municipality=municipality.code;$('municipality').value=municipality.code;updateViewLabel();}
    return municipality;
  }
  function selectedScope(query=''){
    const choice=$('advanced-scope-select').value;
    if(choice==='drawn')return advanced.bounds?{bounds:advanced.bounds,name:'marked area'}:null;
    if(choice==='municipality'){const m=selectedMunicipality(query);return m?{bounds:L.latLngBounds(boundsOf(m.bounds)),name:m.name,municipality:m.code}:null;}
    if(choice==='province')return {bounds:L.latLngBounds(REGION_BOUNDS),name:'Limburg province'};
    return {bounds:state.map.getBounds(),name:'current Limburg map view'};
  }
  function wantsMarkedArea(query){return /\b(marked|selected|drawn) (?:map )?area\b|\bmarkierte[nmrs]? (?:gebiete?s?|bereiche?s?)\b|\bgemarkeerd(?:e)? gebied\b/i.test(query);}
  function inScope(p,scope){return scope.bounds.contains([p.lat,p.lng])&&inLimburg(p)&&(!scope.municipality||municipalityAt(p)?.code===scope.municipality);}
  function sampleGrid(scope,rows=8,cols=8){const bounds=scope.bounds,out=[];for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const p={lat:bounds.getSouth()+(r+.5)/rows*(bounds.getNorth()-bounds.getSouth()),lng:bounds.getWest()+(c+.5)/cols*(bounds.getEast()-bounds.getWest())};if(inScope(p,scope))out.push(p);}return out;}
  function intersects(feature,p){const geo=geoToLatLng(feature);return Boolean(geo?.geometry&&['Polygon','MultiPolygon'].includes(geo.geometry.type)&&geometryContains(geo.geometry,p));}
  async function loadEnvelopeIndex(scope,status){
    if(!advanced.envelopeManifest){const response=await fetch('data/bouwvlakken/manifest.json',{cache:'no-cache'});if(!response.ok)throw new Error('Limburg bouwvlak index unavailable');advanced.envelopeManifest=await response.json();}
    const size=advanced.envelopeManifest.tileDegrees,b=scope.bounds;
    const version=encodeURIComponent(advanced.envelopeManifest.retrieved);
    const keys=Object.keys(advanced.envelopeManifest.tiles).filter(key=>{const [row,col]=key.split('-').map(Number),south=row*size,west=col*size;return south<=b.getNorth()+.02&&south+size>=b.getSouth()-.02&&west<=b.getEast()+.02&&west+size>=b.getWest()-.02;});
    status.textContent=tr('Loading official Limburg building envelopes…','Officiële bouwvlakken in Limburg laden…','Amtliche Baufenster in Limburg laden…');
    if(keys.length>12){
      if(!advanced.envelopeOverview){const response=await fetch(`data/bouwvlakken/overview.json?v=${version}`);if(!response.ok)throw new Error('Limburg bouwvlak overview unavailable');advanced.envelopeOverview=await response.json();}
      return advanced.envelopeOverview.filter(item=>scope.bounds.contains([item.point[1],item.point[0]])&&(!scope.municipality||municipalityAt({lat:item.point[1],lng:item.point[0]})?.code===scope.municipality));
    }
    for(let i=0;i<keys.length;i+=8){
      await Promise.all(keys.slice(i,i+8).map(async key=>{if(!advanced.envelopeTiles.has(key)){const response=await fetch(`data/bouwvlakken/${key}.idx.json?v=${version}`);if(!response.ok)throw new Error(`Bouwvlak tile ${key} unavailable`);advanced.envelopeTiles.set(key,(await response.json()).map(item=>({...item,tile:key})));}}));
    }
    return keys.flatMap(key=>advanced.envelopeTiles.get(key)).filter(item=>{
      const point={lat:item.point[1],lng:item.point[0]};
      return scope.bounds.contains([point.lat,point.lng])&&(!scope.municipality||municipalityAt(point)?.code===scope.municipality);
    });
  }
  async function loadEnvelopeGeometry(item){
    if(!advanced.envelopeGeoTiles.has(item.tile)){
      const version=encodeURIComponent(advanced.envelopeManifest.retrieved);
      const request=fetch(`data/bouwvlakken/${item.tile}.geo.json?v=${version}`).then(response=>{if(!response.ok)throw new Error('Bouwvlak geometry unavailable');return response.json();}).then(rows=>new Map(rows));
      advanced.envelopeGeoTiles.set(item.tile,request);
    }
    const polygons=(await advanced.envelopeGeoTiles.get(item.tile)).get(`${item.plan}|${item.id}`);
    if(!polygons)return null;
    // The compact official extract is stored in Dutch RD metres; Leaflet uses WGS84.
    const rdToWgs=([x,y])=>{const dx=(x-155000)/100000,dy=(y-463000)/100000;
      const lat=52.15517440+(3235.65389*dy-32.58297*dx**2-.2475*dy**2-.84978*dx**2*dy-.0655*dy**3-.01709*dx**2*dy**2-.00738*dx+.0053*dx**4-.00039*dx**2*dy**3+.00033*dx**4*dy-.00012*dx*dy)/3600;
      const lng=5.38720621+(5260.52916*dx+105.94684*dx*dy+2.45656*dx*dy**2-.81885*dx**3+.05594*dx*dy**3-.05607*dx**3*dy+.01199*dy-.00256*dx**3*dy**2+.00128*dx*dy**4+.00022*dy**2-.00022*dx**2+.00026*dx**5)/3600;
      return [lng,lat];};
    const coordinates=polygons.map(poly=>poly.map(ring=>ring.map(rdToWgs)));
    return {type:polygons.length===1?'Polygon':'MultiPolygon',coordinates:polygons.length===1?coordinates[0]:coordinates};
  }
  async function previewMap(scope,ticket,status){
    const points=sampleGrid(scope,3,3).slice(0,6);status.textContent=tr('Reading sample plan areas in this map view…','Voorbeeldplangebieden op de kaart lezen…','Beispiel-Plangebiete auf der Karte prüfen…');
    const result=await Promise.allSettled(points.map(async p=>{const features=await fetchFeatures(PLAN_WMS,'enkelbestemming',p);const direct=features.filter(f=>intersects(f,p));const f=direct.length?choosePrimary(direct,p):null;return f?{designation:String(f.properties?.naam||'').slice(0,100),group:String(f.properties?.bestemmingshoofdgroep||'').slice(0,40)}:null;}));
    if(ticket!==advanced.ticket)return null;
    return [...new Map(result.filter(x=>x.status==='fulfilled'&&x.value).map(x=>[`${x.value.group}:${x.value.designation}`,x.value])).values()].slice(0,6);
  }
  function haversine(a,b){const rad=Math.PI/180,lat=(b.lat-a.lat)*rad,lng=(b.lng-a.lng)*rad;const h=Math.sin(lat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(lng/2)**2;return 12742*Math.asin(Math.min(1,Math.sqrt(h)));}
  function closest(point,items){let nearest=null;for(const item of items){const [west,south,east,north]=item.extent||[item.point.lng,item.point.lat,item.point.lng,item.point.lat];const edge={lat:Math.max(south,Math.min(north,point.lat)),lng:Math.max(west,Math.min(east,point.lng))};const km=haversine(point,edge);if(!nearest||km<nearest.km)nearest={km,item};}return nearest;}
  function contextNeeds(spec){return spec.nearCamping||spec.nearTown||spec.nearFeatures.length>0||spec.avoidIndustry||spec.preferQuiet;}
  async function loadContext(scope,spec,status){
    if(!contextNeeds(spec))return {camping:[],towns:[],industry:[],roads:[],features:{},source:'none'};
    const bounds=scope.bounds,cacheKey=[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()].map(x=>x.toFixed(3)).join(':');
    if(advanced.contextCache.has(cacheKey))return advanced.contextCache.get(cacheKey);
    status.textContent=tr('Checking official mapped places and surroundings…','Officiële plaatsen en omgeving controleren…','Amtlich erfasste Orte und Umgebung prüfen…');
    if(!advanced.contextData){const response=await fetch('data/limburg_context.json');if(!response.ok)throw new Error('TOP10NL context unavailable');advanced.contextData=await response.json();}
    const inside=item=>{const [west,south,east,north]=item.extent||[item.point.lng,item.point.lat,item.point.lng,item.point.lat];return east>=bounds.getWest()-.12&&west<=bounds.getEast()+.12&&north>=bounds.getSouth()-.12&&south<=bounds.getNorth()+.12;};
    const data=advanced.contextData,context={camping:data.camping.filter(inside),towns:data.towns.filter(inside),industry:data.industry.filter(inside),roads:[],features:Object.fromEntries(Object.keys(nearbyTypes).map(kind=>[kind,(data.features?.[kind]||[]).filter(inside)])),source:'PDOK TOP10NL + ProRail'};
    advanced.contextCache.set(cacheKey,context);return context;
  }
  function offsetPoint(p,km,bearing){const rad=bearing*Math.PI/180,lat=p.lat+km*Math.cos(rad)/111.2,lng=p.lng+km*Math.sin(rad)/(111.2*Math.cos(p.lat*Math.PI/180));return {lat,lng};}
  function spaced(items,max){if(items.length<=max)return items;const sorted=[...items].sort((a,b)=>a.point.lat-b.point.lat||a.point.lng-b.point.lng);return Array.from({length:max},(_,i)=>sorted[Math.floor(i*(sorted.length-1)/(max-1))]);}
  function candidatePoints(scope,spec,context,envelopes=[]){
    const all=[],seen=new Set();const add=p=>{if(!inScope(p,scope))return;const key=`${p.lat.toFixed(5)}:${p.lng.toFixed(5)}`;if(!seen.has(key)){seen.add(key);all.push(p);}};
    if(spec.requireEnvelope){for(const item of spaced(envelopes.map(envelope=>({point:{lat:envelope.point[1],lng:envelope.point[0]},envelope})),3000))add({...item.point,envelope:item.envelope});}
    const anchors=spec.nearCamping?spaced(context.camping,24):spec.nearFeatures.length?spaced(context.features[spec.nearFeatures[0]],24):spec.nearTown?spaced(context.towns,24):[];
    if(anchors.length)for(const km of [0.8,1.6,2.5])for(const bearing of [0,90,180,270,45,135,225,315])for(const anchor of anchors)add(offsetPoint(anchor.point,km,bearing));
    for(const point of sampleGrid(scope,8,8))add(point);
    const eligible=all.map(point=>{
      const camping=closest(point,context.camping),town=closest(point,context.towns),industry=closest(point,context.industry),road=closest(point,context.roads),nearFeatures=Object.fromEntries(spec.nearFeatures.map(kind=>[kind,closest(point,context.features[kind])]));
      if(spec.nearCamping&&(!camping||camping.km>(spec.distanceKm?.camping||3)))return null;
      if(spec.nearTown&&(!town||town.km>(spec.distanceKm?.town||6)))return null;
      if(spec.nearFeatures.some(kind=>!nearFeatures[kind]||nearFeatures[kind].km>(spec.distanceKm?.[kind]||nearbyTypes[kind].km)))return null;
      if(spec.avoidIndustry&&industry&&industry.km<(spec.distanceKm?.industry||1.2))return null;
      if(spec.preferQuiet&&road&&road.km<.35)return null;
      return {point,envelopeSource:point.envelope||null,camping,town,industry,road,nearFeatures};
    }).filter(Boolean);
    if(spec.requireEnvelope)return [...spaced(eligible.filter(item=>item.envelopeSource),60),...spaced(eligible.filter(item=>!item.envelopeSource),20)].slice(0,80);
    if(anchors.length){const chosen=[],used=new Set();for(const item of eligible){const nearest=closest(item.point,anchors);const key=nearest?.item.id||'grid';if(!used.has(key)){chosen.push(item);used.add(key);if(chosen.length>=80)break;}}for(const item of eligible){if(chosen.length>=80)break;if(!chosen.includes(item))chosen.push(item);}return chosen;}
    return eligible.slice(0,80);
  }
  function scoreResult(r,spec){let score=50;if(r.status==='onherroepelijk')score+=8;if(r.envelope)score+=12;if(r.unbuilt)score+=10;if(spec.nearCamping&&r.camping)score+=Math.max(0,15-5*r.camping.km);if(spec.nearTown&&r.town)score+=Math.max(0,10-1.7*r.town.km);for(const kind of spec.nearFeatures)score+=Math.max(0,12-4*r.nearFeatures[kind].km);if(spec.avoidIndustry&&r.industry)score+=Math.min(8,r.industry.km);if(spec.preferQuiet&&r.road)score+=Math.min(8,4*r.road.km);return Math.round(score);}
  function evidenceText(r,spec){const parts=[];if(spec.nearCamping&&r.camping)parts.push(`${r.camping.km.toFixed(1)} km ${tr('to camping','tot camping','zum Campingplatz')}${r.camping.item.name?` ${r.camping.item.name}`:''}`);if(spec.nearTown&&r.town)parts.push(`${r.town.km.toFixed(1)} km ${tr('to town','tot plaats','zum Ort')}${r.town.item.name?` ${r.town.item.name}`:''}`);for(const kind of spec.nearFeatures){const near=r.nearFeatures[kind];parts.push(`${near.km.toFixed(1)} km ${tr('to mapped','tot','zu erfasstem')} ${tr(...nearbyTypes[kind].label)}${near.item.name?` ${near.item.name}`:''} · ${near.item.source}`);}if(spec.avoidIndustry)parts.push(r.industry?`${r.industry.km.toFixed(1)} km ${tr('to mapped industry','tot ingetekende industrie','zu erfasster Industrie')}`:tr('No industry feature returned nearby','Geen industrieobject in bereik gevonden','Kein Industrieobjekt im Suchbereich gefunden'));if(spec.preferQuiet)parts.push(r.road?`${r.road.km.toFixed(1)} km ${tr('to mapped major road · quiet unverified','tot hoofdweg · stilte niet geverifieerd','zur Hauptstraße · Ruhe ungeprüft')}`:tr('Major-road proxy unavailable · quiet unverified','Geen hoofdwegindicatie · stilte ongeverifieerd','Keine Straßenindikation · Ruhe ungeprüft'));return parts.join(' · ');}
  function showResults(spec){
    advanced.lastSpec=spec;const visible=r=>advanced.filter==='matches'?!r.review:advanced.filter==='review'?r.review:true;
    const box=$('advanced-results');box.innerHTML=advanced.results.map((r,i)=>!visible(r)?'':`<button class="advanced-result ${r.review?'review-result':''}" type="button" data-smart-result="${i}"><span class="advanced-result-num">${i+1}</span><span><strong>${safe(r.name)}</strong><small>${safe(r.municipality||'Limburg')} · ${safe(r.status||'status to verify')} · ${safe(planTitle(r.sourceId))}</small><em>${r.review?`${safe(tr('Review lead · needs checking:','Onderzoekslocatie · nog controleren:','Prüfhinweis · noch zu prüfen:'))} ${safe(r.missing.map(x=>x==='bouwvlak'?tr('bouwvlak','bouwvlak','Baufenster am Prüfpunkt'):x==='quiet'?tr('quietness','stilte','Ruhe'):tr('no mapped building','geen ingetekend gebouw','kein erfasstes Gebäude')).join(', '))}`:`${safe(r.group)}${r.envelope?' · bouwvlak':''}${r.unbuilt?' · no mapped building at point':''}`}</em>${r.envelopeId?`<small class="advanced-envelope-source">${safe(tr('Official bouwvlak','Officieel bouwvlak','Amtliches Baufenster'))} · ${safe(r.envelopeId)}${r.envelopeDate?` · ${safe(r.envelopeDate)}`:''}${r.envelopeStatus?` · ${safe(r.envelopeStatus)}`:''}</small>`:''}${evidenceText(r,spec)?`<small class="advanced-context-evidence">${safe(evidenceText(r,spec))}</small>`:''}<small class="advanced-imro">PDOK · ${safe(r.sourceId)}</small></span></button>`).join('');
    box.querySelectorAll('[data-smart-result]').forEach(button=>button.onclick=()=>{const r=advanced.results[Number(button.dataset.smartResult)];navigateToPoint(r.point,17);selectPoint(r.point);setOpen(false);});
    advanced.overlay.clearLayers();
    for(let i=0;i<advanced.results.length;i++){const r=advanced.results[i];if(!visible(r))continue;const color=r.review?'#bf811c':'#087f70';if(r.feature.geometry){const polygon=L.geoJSON(geoToLatLng(r.feature),{style:{color,weight:3.5,dashArray:r.review?'7 5':undefined,fillColor:color,fillOpacity:r.review ? .24 : .42}}).addTo(advanced.overlay);polygon.on('click',e=>{L.DomEvent.stopPropagation(e.originalEvent);navigateToPoint(r.point,17);selectPoint(r.point);setOpen(false);});}
      if(r.envelopeGeometry){const bouwvlak=L.geoJSON({type:'Feature',properties:{id:r.envelopeId,plan:r.sourceId},geometry:r.envelopeGeometry},{style:{color:'#55efc0',weight:3,fillColor:'#70f4ca',fillOpacity:.34}}).addTo(advanced.overlay);bouwvlak.bindTooltip(`${safe(tr('Official bouwvlak','Officieel bouwvlak','Amtliches Baufenster'))} · ${safe(r.envelopeId)}`,{className:'opportunity-tooltip'});bouwvlak.on('click',e=>{L.DomEvent.stopPropagation(e.originalEvent);navigateToPoint(r.point,17);selectPoint(r.point);setOpen(false);});}
      const marker=L.marker([r.point.lat,r.point.lng],{icon:L.divIcon({className:`smart-pin${r.review?' review-pin':''}`,html:`<span>${i+1}</span>`,iconSize:[31,31],iconAnchor:[15,15]}),zIndexOffset:900}).addTo(advanced.overlay);marker.bindTooltip(`${safe(r.name)} · ${safe(planTitle(r.sourceId))}`,{direction:'top',className:'opportunity-tooltip'});marker.on('click',e=>{L.DomEvent.stopPropagation(e.originalEvent);navigateToPoint(r.point,17);selectPoint(r.point);setOpen(false);});}
    const shown=new Set();for(const r of advanced.results){if(!visible(r))continue;for(const [kind,near,color] of [['camping',spec.nearCamping&&r.camping,'#72e4c5'],['town',spec.nearTown&&r.town,'#9db8ff'],...spec.nearFeatures.map(type=>[type,r.nearFeatures[type],'#ffcf74'])]){if(!near||shown.has(near.item.id))continue;shown.add(near.item.id);L.circleMarker([near.item.point.lat,near.item.point.lng],{radius:5,color,weight:2,fillColor:color,fillOpacity:.9,interactive:true}).bindTooltip(`${safe(near.item.source||'PDOK TOP10NL')} · ${safe(near.item.name||near.item.id)}`).addTo(advanced.overlay);}}
    window.dispatchEvent(new CustomEvent('planview-search-results'));
  }
  async function runSearch(manualSpec=null){
    const query=manualSpec?'Manual criteria':$('advanced-query').value.trim();if(!query){$('advanced-status').textContent='Describe the areas you want first.';$('advanced-query').focus();return;}
    if(!manualSpec&&wantsMarkedArea(query)){if(!advanced.bounds){startDrawing(true);return;}$('advanced-scope-select').value='drawn';}
    const scope=selectedScope(query),status=$('advanced-status'),button=$('advanced-run');if(!scope){status.textContent=tr('Choose a municipality on the left, zoom into one, or mark an area.','Kies links een gemeente, zoom erop in of markeer een gebied.','Links eine Gemeinde wählen, hineinzoomen oder einen Bereich markieren.');return;}
    $('advanced-scope-label').textContent=scope.name;
    const ticket=++advanced.ticket;button.disabled=true;advanced.filter='all';window.dispatchEvent(new CustomEvent('planview-search-busy',{detail:{busy:true}}));advanced.results=[];advanced.overlay.clearLayers();$('advanced-results').innerHTML='';$('advanced-parsed').hidden=true;
    try{
      const rough=normalize(manualSpec||localInterpret(query));
      const [sampledPlanFeatures,nearby]=await Promise.all([
        previewMap(scope,ticket,status),
        contextNeeds(rough)?loadContext(scope,rough,status):Promise.resolve(null)
      ]);
      if(ticket!==advanced.ticket)return;
      status.textContent=tr('Understanding your purpose and the sampled plan areas…','Je vraag en de bemonsterde plangebieden begrijpen…','Suchziel und geprüfte Plangebiete abgleichen…');
      const spec=manualSpec?{...normalize(manualSpec),engine:'manual',distanceKm:manualSpec.distanceKm}:await interpret(query,{scope:scope.name,interfaceLanguage:document.documentElement.lang,sampledPlanFeatures,nearbyFeatureCounts:nearby?{camping:nearby.camping.length,towns:nearby.towns.length,industry:nearby.industry.length,roads:nearby.roads.length,...Object.fromEntries(Object.entries(nearby.features).map(([kind,items])=>[kind,items.length]))}:{},nearbyExamples:nearby?[...nearby.camping.slice(0,2),...nearby.towns.slice(0,2),...nearby.features.station.slice(0,2)].map(item=>item.name).filter(Boolean):[]});if(ticket!==advanced.ticket)return;renderInterpretation(spec);
      if(spec.unsupported.length){status.textContent=tr('Some criteria cannot be checked. Revise the request to avoid misleading matches.','Sommige criteria zijn niet te controleren. Pas de vraag aan.','Einige Kriterien lassen sich nicht prüfen. Bitte die Anfrage präzisieren.');return;}
      if(!spec.groups.length&&!spec.statuses.length&&!spec.requireEnvelope&&!spec.requireUnbuilt&&!contextNeeds(spec)){status.textContent='No searchable map criterion recognized.';return;}
      const context=nearby&&(!spec.nearCamping||rough.nearCamping)&&(!spec.nearTown||rough.nearTown)&&(!spec.avoidIndustry||rough.avoidIndustry)&&(!spec.preferQuiet||rough.preferQuiet)?nearby:await loadContext(scope,spec,status);if(ticket!==advanced.ticket)return;
      if(spec.nearCamping&&!context.camping.length){status.textContent=tr('No mapped campsites returned for this area. Try a smaller map view or another municipality.','Geen ingetekende campings gevonden. Kies een kleiner gebied of andere gemeente.','Keine erfassten Campingplätze gefunden. Kleineren Ausschnitt oder andere Gemeinde wählen.');return;}
      if(spec.nearTown&&!context.towns.length){status.textContent=tr('No mapped towns returned for this area. Try a larger map view.','Geen plaatsen gevonden. Kies een groter gebied.','Keine Orte gefunden. Größeren Ausschnitt wählen.');return;}for(const kind of spec.nearFeatures)if(!context.features[kind].length){status.textContent=`${tr('No mapped','Geen ingetekend','Keine erfassten')} ${tr(...nearbyTypes[kind].label)} ${tr('found near this area. Choose a larger search area.','gevonden. Kies een groter zoekgebied.','nahe diesem Gebiet gefunden. Größeres Suchgebiet wählen.')}`;return;}
      const envelopes=spec.requireEnvelope?await loadEnvelopeIndex(scope,status):[];if(ticket!==advanced.ticket)return;
      const candidates=candidatePoints(scope,spec,context,envelopes),found=new Map(),reviewFound=new Map();let failed=0;
      if(!candidates.length){status.textContent=tr('No sampled locations meet the surrounding-area conditions. Widen the search area or relax a distance condition.','Geen steekproefpunten voldoen aan de omgevingscriteria. Verruim het zoekgebied.','Keine Stichprobenpunkte erfüllen die Umgebungskriterien. Suchgebiet vergrößern.');return;}
      status.textContent=`Checking ${candidates.length} locations against official plan geometry…`;
      for(let offset=0;offset<candidates.length;offset+=6){
        const batch=await Promise.allSettled(candidates.slice(offset,offset+6).map(async candidate=>{
          const point=candidate.point,features=await fetchFeatures(PLAN_WMS,'enkelbestemming',point),exact=features.filter(f=>intersects(f,point));
          const direct=candidate.envelopeSource;
          const linked=direct&&exact.find(f=>f.properties?.plangebied===direct.plan&&f.properties?.identificatie===direct.designation&&!['1','true'].includes(String(f.properties?.historisch).toLowerCase()));
          const feature=linked|| (exact.length?choosePrimary(exact,point):null);if(!feature)return null;
          const props=feature.properties||{},group=String(props.bestemmingshoofdgroep||'').toLowerCase().trim(),planStatus=String(props.planstatus||'').toLowerCase();
          if(spec.groups.length&&!spec.groups.includes(group)||spec.statuses.length&&!spec.statuses.includes(planStatus))return null;
          let envelope=false,unbuilt=false,envelopeGeometry=null,envelopeId='',envelopeDate='',envelopeStatus='';
          if(spec.requireEnvelope||spec.requireUnbuilt){
            const fromIndex=spec.requireEnvelope&&direct?.plan===props.plangebied&&direct?.designation===props.identificatie;
            const extra=await Promise.allSettled([spec.requireEnvelope&&!fromIndex?fetchFeatures(PLAN_WMS,'bouwvlak',point):Promise.resolve([]),spec.requireUnbuilt?fetchFeatures(CAD_WMS,'Bebouwingvlak',point):Promise.resolve([])]);
            if(extra.some(x=>x.status==='rejected'))throw new Error('Evidence unavailable');
            const returned=extra[0].value.find(f=>f.properties?.plangebied===props.plangebied&&(!f.properties?.bestemmingsvlak||String(f.properties.bestemmingsvlak).endsWith(props.identificatie))&&intersects(f,point));
            envelope=Boolean(fromIndex||returned);unbuilt=spec.requireUnbuilt?!extra[1].value.some(f=>intersects(f,point)):false;
            if(fromIndex){envelopeId=direct.id;envelopeDate=direct.date;envelopeStatus=direct.status;}
            else if(returned){envelopeGeometry=geoToLatLng(returned)?.geometry;envelopeId=returned.properties?.identificatie||'';envelopeDate=returned.properties?.datum||'';envelopeStatus=returned.properties?.dossierstatus||'';}
          }
          const missing=[];if(spec.requireEnvelope&&!envelope)missing.push('bouwvlak');if(spec.requireUnbuilt&&!unbuilt)missing.push('unbuilt');if(spec.preferQuiet&&!candidate.road)missing.push('quiet');const review=missing.length>0;if(review&&missing.some(x=>x!=='quiet')&&(!(spec.potentialBuildingLand||spec.includeReviewLeads)||!buildReviewGroups.has(group)))return null;
          const result={...candidate,feature,group,status:planStatus,name:props.naam||group,sourceId:props.plangebied||'',municipality:municipalityAt(point)?.name,envelope,unbuilt,envelopeGeometry,envelopeId,envelopeDate,envelopeStatus,review,missing};result.score=scoreResult(result,spec)-(review?20:0);return result;
        }));
        if(ticket!==advanced.ticket)return;
        for(const item of batch){if(item.status==='rejected'){failed++;continue;}const r=item.value;if(!r)continue;const key=r.feature.properties?.identificatie||`${r.sourceId}:${r.name}:${r.point.lat.toFixed(4)}:${r.point.lng.toFixed(4)}`;const target=r.review?reviewFound:found;if(!target.has(key)||target.get(key).score<r.score)target.set(key,r);}
        advanced.results=[...found.values()].sort((a,b)=>b.score-a.score).concat([...reviewFound.entries()].filter(([key])=>!found.has(key)).map(([,r])=>r).sort((a,b)=>b.score-a.score)).slice(0,40);if(offset%12===0||offset+6>=candidates.length)showResults(spec);
        status.textContent=`Checked ${Math.min(offset+6,candidates.length)} of ${candidates.length} locations · ${advanced.results.length} map areas highlighted…`;
      }
      const exactCount=advanced.results.filter(r=>!r.review).length,reviewCount=advanced.results.length-exactCount;
      const toDraw=advanced.results.filter(r=>r.envelope&&r.envelopeSource&&!r.envelopeGeometry);
      let shapeFailed=0;
      if(toDraw.length){status.textContent=tr('Loading precise building-envelope outlines…','Precieze bouwvlakgrenzen laden…','Genaue Baufenster-Umrisse laden…');
        const shapeLoads=await Promise.allSettled(toDraw.map(async r=>{r.envelopeGeometry=await loadEnvelopeGeometry(r.envelopeSource);}));
        shapeFailed=shapeLoads.filter(item=>item.status==='rejected').length;
        if(ticket!==advanced.ticket)return;showResults(spec);
      }
      status.textContent=`${exactCount} ${tr('exact screening matches','exacte screeningtreffers','exakte Screening-Treffer')}${reviewCount?` · ${reviewCount} ${tr('nearby plan areas to review','nabije plangebieden ter controle','nahe Plangebiete zur Prüfung')}`:''} · ${candidates.length} ${tr('sampled locations','steekproefpunten','Stichprobenpunkte')}${spec.requireEnvelope?` · ${envelopes.length} ${tr('indexed bouwvlak candidate locations loaded','bouwvlak-kandidaatlocaties geladen','indexierte Baufenster-Kandidaten geladen')}`:''}.${failed?` ${failed} data checks failed.`:''}${shapeFailed?` ${shapeFailed} building-envelope outlines could not be drawn.`:''}`;
      if(spec.requireEnvelope){const note=document.createElement('p');note.className='advanced-context-note';const updated=advanced.envelopeManifest?.sourceUpdated?.slice(0,10)||tr('date unknown','datum onbekend','Datum unbekannt'),total=advanced.envelopeManifest?.featureCount?.toLocaleString()||'?';note.textContent=tr(`PDOK Wro bouwvlak extract (${updated}): ${total} Limburg polygons in the source index. Broad searches use spatial samples. Matches are linked to their IMRO plan; check current Omgevingsplan rules in Omgevingsloket.`,`PDOK Wro-bouwvlakextract (${updated}): ${total} Limburgse polygonen in de bronindex. Brede zoekopdrachten gebruiken ruimtelijke steekproeven. Controleer het actuele omgevingsplan in het Omgevingsloket.`,`PDOK-Wro-Baufensterauszug (${updated}): ${total} Limburg-Polygone im Quellenindex. Große Suchgebiete nutzen räumliche Stichproben. Aktuelle Omgevingsplan-Regeln im Omgevingsloket prüfen.`);$('advanced-results').prepend(note);}
      if(advanced.results.length){const bounds=L.latLngBounds(advanced.results.map(r=>[r.point.lat,r.point.lng]));state.map.fitBounds(bounds.pad(.15),{maxZoom:15,padding:[46,46],animate:true});}
      if(contextNeeds(spec)){const note=document.createElement('p');note.className='advanced-context-note';note.textContent=tr('Surroundings: PDOK TOP10NL and ProRail snapshot. Distances to mapped features are approximate. Quietness needs a separate noise check; verify legal rights in Omgevingsloket.','Omgeving: PDOK TOP10NL en ProRail. Afstanden tot kaartobjecten zijn bij benadering. Stilte vraagt een aparte geluidscontrole; controleer rechten in het Omgevingsloket.','Umgebung: PDOK TOP10NL und ProRail. Abstände zu Kartenobjekten sind Näherungen. Ruhe erfordert eine gesonderte Lärmprüfung; Baurecht im Omgevingsloket prüfen.');$('advanced-results').prepend(note);}
      if(advanced.results.length)status.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
    }catch(error){if(ticket!==advanced.ticket)return;console.warn('Spatial search failed',error);status.textContent=error.message==='Context feature limit reached'?tr('Too many mapped surroundings in this scope. Select one municipality or draw a smaller area.','Te veel kaartobjecten in dit gebied. Kies één gemeente of teken een kleiner gebied.','Zu viele Umgebungsobjekte in diesem Bereich. Eine Gemeinde wählen oder kleineres Gebiet markieren.'):tr('A required map or surroundings service is unavailable. No partial matches were claimed; retry or narrow the area.','Een vereiste kaartdienst is niet beschikbaar. Er worden geen onvolledige treffers geclaimd.','Ein benötigter Karten- oder Umgebungsdienst ist nicht erreichbar. Es werden keine unvollständigen Treffer behauptet.');advanced.results=[];advanced.overlay.clearLayers();$('advanced-results').innerHTML='';}
    finally{if(ticket===advanced.ticket){button.disabled=false;window.dispatchEvent(new CustomEvent('planview-search-busy',{detail:{busy:false}}));}}
  }
  Object.assign(advanced,{
    setOpen,startDrawing,cancelDrawing:()=>{advanced.autoRunAfterDraw=false;exitDrawing();advanced.suppressClick=false;},
    cancel:()=>{advanced.ticket++;$('advanced-run').disabled=false;$('advanced-status').textContent=tr('Stopped. Any shown results are partial.','Gestopt. Getoonde resultaten zijn onvolledig.','Gestoppt. Angezeigte Ergebnisse sind unvollständig.');window.dispatchEvent(new CustomEvent('planview-search-busy',{detail:{busy:false}}));},
    runManual:spec=>runSearch(spec),
    filterResults:value=>{advanced.filter=['all','matches','review'].includes(value)?value:'all';if(advanced.lastSpec)showResults(advanced.lastSpec);},
    clearSearch:()=>{
      advanced.ticket++;advanced.results=[];advanced.filter='all';advanced.lastSpec=null;advanced.overlay?.clearLayers();
      if(advanced.preview){state.map.removeLayer(advanced.preview);advanced.preview=null;}
      if(advanced.drawing)exitDrawing();
      if(advanced.rectangle){state.map.removeLayer(advanced.rectangle);advanced.rectangle=null;}
      advanced.bounds=null;advanced.autoRunAfterDraw=false;advanced.suppressClick=false;
      $('advanced-query').value='';$('advanced-results').replaceChildren();$('advanced-parsed').hidden=true;
      $('advanced-clear-area').hidden=true;$('advanced-scope-select').querySelector('[value="drawn"]').disabled=true;$('advanced-scope-select').value='view';$('advanced-scope-label').textContent=tr('Current map view','Huidige kaartweergave','Aktueller Kartenausschnitt');
      $('advanced-run').disabled=false;$('advanced-status').textContent=tr('Search and map results cleared.','Zoekopdracht en kaartresultaten gewist.','Suche und Kartenergebnisse gelöscht.');
      $('pv-clear-search')?.setAttribute('disabled','');window.dispatchEvent(new CustomEvent('planview-search-results'));window.dispatchEvent(new CustomEvent('planview-search-busy',{detail:{busy:false}}));
    }
  });
  async function init(){
    advanced.overlay=L.layerGroup().addTo(state.map);initDrawing();
    $('advanced-toggle').onclick=()=>setOpen($('advanced-panel').hidden);$('advanced-close').onclick=()=>setOpen(false);$('advanced-draw').onclick=()=>startDrawing(false);
    $('advanced-scope-select').onchange=()=>{const scope=selectedScope($('advanced-query').value);$('advanced-scope-label').textContent=scope?.name||tr('Choose a municipality on the left','Kies links een gemeente','Links eine Gemeinde wählen');};
    $('advanced-clear-area').onclick=()=>{if(advanced.rectangle)state.map.removeLayer(advanced.rectangle);advanced.rectangle=null;advanced.bounds=null;$('advanced-clear-area').hidden=true;$('advanced-scope-select').querySelector('[value="drawn"]').disabled=true;$('advanced-scope-select').value='view';$('advanced-scope-label').textContent='Current map view';};
    $('advanced-run').onclick=()=>runSearch();$('advanced-query').addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter')runSearch();});
    document.querySelectorAll('[data-example]').forEach(b=>b.onclick=()=>{$('advanced-query').value=b.dataset.example;$('advanced-query').focus();});$('search').addEventListener('focus',()=>setOpen(false));document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(advanced.drawing)exitDrawing();setOpen(false);}});
    try{const res=await fetch('/api/status',{cache:'no-store'});if(res.ok){const info=await res.json();advanced.ai=info.available===true;$('advanced-backend').textContent=advanced.ai?(info.backend==='codex-cli'?'GPT-6 Luna · Codex connected':'GPT-6 Luna · API connected'):'Local parser · Codex not connected';}else $('advanced-backend').textContent='Local parser · Codex not connected';}catch{$('advanced-backend').textContent='Local parser · Codex not connected';}
  }
  window.addEventListener('load',init);
})();
