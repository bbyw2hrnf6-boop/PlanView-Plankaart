/* Spatial search is evidence-led: sample PDOK plan geometry, interpret the request,
   compare a cached official TOP10NL surroundings snapshot, then rank plan areas.
   It is a screening workflow, never a legal buildability or acoustic finding. */
(() => {
  const $ = id => document.getElementById(id);
  const safe = value => esc(String(value ?? ''));
  const allowedGroups = new Set(['wonen','woongebied','gemengd','bedrijf','bedrijventerrein','centrum','groen','natuur','water','verkeer','maatschappelijk','agrarisch','bos','kantoor','detailhandel','horeca','recreatie']);
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
  const advanced = {drawing:false,suppressClick:false,bounds:null,rectangle:null,preview:null,start:null,overlay:null,markers:null,results:[],ticket:0,ai:false,autoRunAfterDraw:false,pending:null,contextCache:new Map(),bagCache:new Map(),envelopeTiles:new Map(),envelopeGeoTiles:new Map(),history:loadSearchHistory(),open:false,activeTab:'request',busy:false,hasSearched:false,backendStatus:null,statusCheckedAt:0,statusRequest:null,interpretation:null};
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
    ['horeca',/\b(horeca|hospitality|restaurant|gastronomie)\b/i],
    ['recreatie',/\b(recreatie|recreation zoning|recreational zoning|freizeitgebiet)\b/i]
  ];
  const contextWords = {
    insideCamping:/\b(?:inside|within|on|in|binnen|op|in einem|innerhalb|auf einem)\s+(?:an?\s+|de\s+|het\s+|einer?\s+|einem\s+)?(?:camp(?:ing|site|ground)?|caravan\s*park|holiday\s*park|vacation\s*park|bungalow\s*park|kampeerterrein|campingplatz|ferienpark)\b/i,
    nearCamping:/\b(camp(?:ing|site|ground)?s?|caravan|kampeer\w*|campingpl[aä]tze?|zeltpl[aä]tze?)\b/i,
    nearTown:/\b(towns?|villages?|cities|city|dorp(?:en)?|stad|steden|orte?|stadt|st[aä]dte|d[oö]rfer)\b/i,
    avoidIndustry:/\b(no|without|away from|far from|geen|zonder|niet|weg van|keine?|ohne|fern von)\b.{0,40}\b(indust\w*|bedrijventerrein|gewerbe\w*)\b/i,
    preferQuiet:/\b(quiet|silent|peaceful|ruhig|leise|still|stil|rustig|l[aä]rmarm)\b/i,
    potentialBuildingLand:/\b(build(?:ing|able)?\s*(?:land|ground|site|plot)|bouwgrond|bouwlocatie|baugrund\w*|baufl[aä]che|bebouwbaar|bebaubar)\b/i
  };
  const tr = (en,nl,de) => ({nl,de}[document.documentElement.lang] || en);
  const distanceDefaults={camping:3,town:6,station:3,park:2,sports:2,cemetery:2,swimming_pool:2,marina:3,industry:1.2};
  const distanceTerms={camping:/\b(camp(?:ing|site|ground)?s?|holiday\s*parks?|vacation\s*parks?|ferienparks?|campingpl[aä]tze?|kampeer\w*)\b/ig,town:/\b(towns?|villages?|cities|city|dorp(?:en)?|stad|steden|orte?|stadt|st[aä]dte|d[oö]rfer)\b/ig,station:/\b(train\s*stations?|rail(?:way)?\s*stations?|treinstations?|bahnh[oö]fe?|bahnhof)\b/ig,park:/\b(parks?|parken|parkverein)\b/ig,industry:/\b(indust\w*|bedrijventerrein|gewerbe\w*)\b/ig};
  function requestedDistances(query){
    const numbers=[...query.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:km|kilomet(?:er|re)s?|kilometer[n]?)\b/ig)].map(m=>({km:Number(m[1].replace(',','.')),index:m.index})).filter(x=>x.km>=.1&&x.km<=50);
    const result={};for(const [kind,pattern] of Object.entries(distanceTerms)){
      const terms=[...query.matchAll(pattern)];let best=null;
      for(const term of terms)for(const number of numbers){const gap=Math.abs(term.index-number.index);const between=query.slice(Math.min(term.index,number.index),Math.max(term.index,number.index));if(gap>70||/[!?;\n]|\.(?!\d)|,(?!\d)|\b(?:and|und|en)\b/i.test(between))continue;if(!best||gap<best.gap)best={gap,km:number.km};}
      if(best)result[kind]=best.km;
    }
    return result;
  }
  function wantsNearbyHomes(query){return /\b(?:houses?|homes?|dwellings?|wohnh[aä]us\w*|wohnh[aä]user\w*|wohnungen?|huizen|woningen|geb[aä]ude\w*)\b/i.test(query)&&/\b(?:near(?:by)?|around|close|surrounding|neighbou?r|corner|in der n[aä]he|umgebung|umkreis|rundherum|nabij|omgeving|buurt|nebenan|um die ecke|gleich um)\b/i.test(query);}
  function requestedHomeRadius(query){const m=query.match(/(?:houses?|homes?|wohnh[aä]us\w*|wohnh[aä]user\w*|huizen|woningen|geb[aä]ude\w*).{0,45}?(\d{2,4})\s*(?:m|meter[n]?)\b|\b(\d{2,4})\s*(?:m|meter[n]?).{0,45}?(?:houses?|homes?|wohnh[aä]us\w*|wohnh[aä]user\w*|huizen|woningen|geb[aä]ude\w*)/i);return m?Math.max(50,Math.min(1000,Number(m[1]||m[2]))):250;}
  function completeInterpretation(raw,query){
    const spec=normalize(raw),explicit=requestedDistances(query);spec.distanceKm={...distanceDefaults,...explicit};spec.nearbyHomes=wantsNearbyHomes(query);spec.homeRadiusM=requestedHomeRadius(query);
    if(spec.nearbyHomes)spec.unsupported=spec.unsupported.filter(x=>!/(houses?|homes?|wohnha|huizen|woningen|geb[aä]ude|BAG)/i.test(x));
    if(spec.nearbyHomes)spec.explanation=tr('Planning and mapped surroundings are screened first. Nearby residential buildings are then checked with BAG for the first 12 candidates.','Eerst worden plannen en omgeving gecontroleerd. Daarna worden woongebouwen bij de eerste 12 kandidaten met BAG gecontroleerd.','Zuerst werden Pläne und kartierte Umgebung geprüft. Wohngebäude im Umfeld werden anschließend für die ersten 12 Kandidaten mit BAG geprüft.');
    for(const kind of Object.keys(explicit))if(kind==='camping'&&spec.nearCamping||kind==='industry'&&spec.avoidIndustry||kind==='station'&&spec.nearFeatures.includes('station')||kind==='park'&&spec.nearFeatures.includes('park'))spec.unsupported=spec.unsupported.filter(x=>!new RegExp(`${kind==='camping'?'camp|ferien|kampeer':kind==='industry'?'industr|gewerbe|bedrijf':kind==='station'?'station|bahnhof|trein':'park'}`,'i').test(x));
    if(Object.keys(explicit).length)spec.unsupported=spec.unsupported.filter(x=>!/(distance|abstand|entfern|radius|umkreis|kilomet|\bkm\b)/i.test(x)||/(noise|sound|l[aä]rm|preis|price|hectare|m²)/i.test(x));
    return spec;
  }
  function localInterpret(query) {
    const negativeIndustry = contextWords.avoidIndustry.test(query);
    const groups=aliases.filter(([g,pattern])=>pattern.test(query) && !(negativeIndustry&&['bedrijf','bedrijventerrein'].includes(g))).map(([g])=>g);
    const finalOnly=/\b(onherroepelijk|rechtskräftig|rechtskraeftig|final|definitive)\b/i.test(query);
    const adopted=/\b(vastgesteld|adopted|beschlossen)\b/i.test(query);
    const build=contextWords.potentialBuildingLand.test(query),review=/\b(pr[uü]fhinweis\w*|review leads?|ter controle|onderzoekslocaties?)\b/i.test(query),envelopeMention=/\b(bouwvlak|baufenster|building envelope|buildable envelope)\b/i.test(query);
    const unsupported=[];
    if(/\b(flood\w*|overstrom\w*|hochwasser\w*|ownership|eigenaar\w*|eigentümer\w*|prijs\w*|price\w*|kosten|natura\w*|decibel\w*|hectare\w*|m²|sqm|vierkante meter)/i.test(query))unsupported.push('Some requested criteria need datasets not connected to this prototype.');
    return {groups:[...new Set(groups)],statuses:finalOnly&&adopted?allStatus:finalOnly?['onherroepelijk']:adopted?allStatus:[],requireEnvelope:build||envelopeMention,requireUnbuilt:build||/\b(onbebouwd|unbuilt|vacant|empty plot|zonder gebouw|geen gebouw|unbebaut|ohne gebäude|ohne gebaeude)\b/i.test(query),nearCamping:contextWords.nearCamping.test(query)&&!contextWords.insideCamping.test(query),insideCamping:contextWords.insideCamping.test(query),accommodationIntent:/\b(tiny houses?|tiny homes?|chalet[s]?|stacaravan[s]?|permanent(?:e)? (?:bewoning|residence|wohnen)|dauerwohnen|vakantiehuisjes?|holiday homes?)\b/i.test(query)?'accommodation':'none',nearTown:contextWords.nearTown.test(query),nearFeatures:Object.entries(nearbyTypes).filter(([,def])=>def.pattern.test(query)).map(([kind])=>kind),avoidIndustry:negativeIndustry,preferQuiet:contextWords.preferQuiet.test(query),potentialBuildingLand:build,includeReviewLeads:review,unsupported,explanation:'Planning geometry and nearby mapped features are checked separately.',engine:'local'};
  }
  function backendMetadata(raw={}){
    const model=typeof raw.model==='string'?raw.model:typeof raw.engine==='string'&&!['local','manual'].includes(raw.engine)?raw.engine:'';
    return {model:model.slice(0,80),backend:['codex-cli','openai-api'].includes(raw.backend)?raw.backend:'none',reasoning:['none','minimal','low','medium','high','xhigh','max','ultra'].includes(raw.reasoning)?raw.reasoning:''};
  }
  function modelLabel(meta){
    const model=meta.model==='gpt-6-luna'?'GPT-6 Luna':meta.model||tr('AI model not reported','AI-model niet vermeld','KI-Modell nicht angegeben');
    const effort=meta.reasoning?`${meta.reasoning[0].toUpperCase()+meta.reasoning.slice(1)} Reasoning`:tr('Reasoning not reported','Reasoning niet vermeld','Reasoning nicht angegeben');
    const backend=meta.backend==='codex-cli'?'Codex':meta.backend==='openai-api'?'API':tr('Backend not reported','Backend niet vermeld','Backend nicht angegeben');
    return `${model} · ${effort} · ${backend}`;
  }
  function localInterpretationLabel(reason){
    if(window.planviewRuntime?.isLocal===false)return tr('Browser interpretation · no cloud AI connected','Browserinterpretatie · geen cloud-AI gekoppeld','Browser-Auswertung · keine Cloud-KI verbunden');
    if(reason==='interpretation-unavailable')return tr('AI temporarily unavailable · local interpretation used','AI tijdelijk niet beschikbaar · lokaal geïnterpreteerd','KI vorübergehend nicht verfügbar · lokal ausgewertet');
    if(reason==='status-unavailable')return tr('AI connection could not be checked · local interpretation used','AI-verbinding kon niet worden gecontroleerd · lokaal geïnterpreteerd','KI-Verbindung nicht prüfbar · lokal ausgewertet');
    return tr('AI unavailable · local interpretation used','AI niet beschikbaar · lokaal geïnterpreteerd','KI nicht verfügbar · lokal ausgewertet');
  }
  function interpretationLabel(spec){
    if(spec.engine==='manual')return tr('Manual criteria · official map screening','Handmatige criteria · officiële kaart','Manuelle Kriterien · amtliche Karte');
    return spec.engine==='local'?localInterpretationLabel(spec.fallbackReason):modelLabel(spec);
  }
  function renderBackendStatus(){
    const label=$('advanced-backend');if(!label)return;label.dataset.pvManaged='';
    const info=advanced.backendStatus;
    if(window.planviewRuntime?.isLocal===false)label.textContent=tr('Browser interpretation · no cloud AI connected','Browserinterpretatie · geen cloud-AI gekoppeld','Browser-Auswertung · keine Cloud-KI verbunden');
    else if(!info)label.textContent=tr('Checking AI connection…','AI-verbinding controleren…','KI-Verbindung wird geprüft…');
    else if(info.state==='ready')label.textContent=`${modelLabel(info)} · ${tr('ready','gereed','bereit')}`;
    else if(info.reason==='interpretation-unavailable')label.textContent=tr('AI temporarily unavailable · local parser available','AI tijdelijk niet beschikbaar · lokale parser beschikbaar','KI vorübergehend nicht verfügbar · lokaler Parser verfügbar');
    else if(info.state==='error')label.textContent=tr('AI connection could not be checked · local parser available','AI-verbinding kon niet worden gecontroleerd · lokale parser beschikbaar','KI-Verbindung nicht prüfbar · lokaler Parser verfügbar');
    else label.textContent=tr('AI unavailable · local parser available','AI niet beschikbaar · lokale parser beschikbaar','KI nicht verfügbar · lokaler Parser verfügbar');
    label.dataset.state=info?.state||'checking';
    const resultLabel=$('advanced-parsed')?.querySelector('.advanced-engine');
    if(resultLabel&&advanced.interpretation)resultLabel.textContent=interpretationLabel(advanced.interpretation);
  }
  async function refreshBackendStatus({force=false}={}){
    if(window.planviewRuntime?.isLocal===false){advanced.ai=false;advanced.backendStatus={available:false,state:'unavailable',reason:'backend-unavailable'};advanced.statusCheckedAt=Date.now();renderBackendStatus();return advanced.backendStatus;}
    if(advanced.statusRequest)return advanced.statusRequest;
    if(!force&&advanced.backendStatus&&Date.now()-advanced.statusCheckedAt<3000)return advanced.backendStatus;
    advanced.statusRequest=(async()=>{
      try{
        const response=await fetch('/api/status',{cache:'no-store',signal:AbortSignal.timeout(6500)});
        if(!response.ok)throw new Error('AI status unavailable');
        const raw=await response.json();
        if(typeof raw.available!=='boolean')throw new Error('AI status missing availability');
        advanced.ai=raw.available;
        advanced.backendStatus={...backendMetadata(raw),available:advanced.ai,state:advanced.ai?'ready':'unavailable',reason:advanced.ai?'':'backend-unavailable'};
      }catch{
        advanced.ai=false;
        advanced.backendStatus={...backendMetadata(advanced.backendStatus||{}),available:false,state:'error',reason:'status-unavailable'};
      }
      advanced.statusCheckedAt=Date.now();renderBackendStatus();return advanced.backendStatus;
    })();
    try{return await advanced.statusRequest;}finally{advanced.statusRequest=null;}
  }
  function normalize(raw){const build=raw.potentialBuildingLand===true;return {groups:[...new Set((Array.isArray(raw.groups)?raw.groups:[]).filter(g=>allowedGroups.has(g)))],statuses:[...new Set((Array.isArray(raw.statuses)?raw.statuses:[]).filter(s=>allStatus.includes(s)))],requireEnvelope:raw.requireEnvelope===true||build,requireUnbuilt:raw.requireUnbuilt===true||build,nearCamping:raw.nearCamping===true&&raw.insideCamping!==true,insideCamping:raw.insideCamping===true,accommodationIntent:raw.accommodationIntent==='accommodation'?'accommodation':'none',nearTown:raw.nearTown===true,nearFeatures:[...new Set((Array.isArray(raw.nearFeatures)?raw.nearFeatures:[]).filter(k=>k in nearbyTypes))],avoidIndustry:raw.avoidIndustry===true,preferQuiet:raw.preferQuiet===true,potentialBuildingLand:build,includeReviewLeads:raw.includeReviewLeads===true,unsupported:Array.isArray(raw.unsupported)?raw.unsupported.slice(0,4).map(String):[],explanation:String(raw.explanation||''),engine:backendMetadata(raw).model||'local',...backendMetadata(raw),fallbackReason:['backend-unavailable','status-unavailable','interpretation-unavailable'].includes(raw.fallbackReason)?raw.fallbackReason:''};}
  async function interpret(query,context){
    // Refresh before each actual interpretation, including after a server restart.
    // Opening the panel shares an in-flight request and uses only a brief status cache.
    const status=await refreshBackendStatus({force:true});
    if(advanced.ai){
      try{
        const response=await fetch('/api/interpret',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,context})});
        if(!response.ok)throw new Error('AI interpretation unavailable');
        const spec=normalize(await response.json());
        if(spec.engine==='local')throw new Error('AI interpretation metadata missing');
        advanced.backendStatus={...backendMetadata(spec),available:true,state:'ready',reason:''};advanced.ai=true;renderBackendStatus();
        return spec;
      }catch{
        advanced.ai=false;
        advanced.backendStatus={...backendMetadata(status),available:false,state:'error',reason:'interpretation-unavailable'};
        advanced.statusCheckedAt=0;renderBackendStatus();
        return normalize({...localInterpret(query),fallbackReason:'interpretation-unavailable'});
      }
    }
    return normalize({...localInterpret(query),fallbackReason:status.reason});
  }
  function renderInterpretation(spec){
    const box=$('advanced-parsed');box.hidden=false;advanced.interpretation=spec;
    const chips=[...spec.groups.map(g=>g),...spec.statuses,...(spec.requireEnvelope?[tr('Building envelope','Bouwvlak','Baufenster')]:[]),...(spec.requireUnbuilt?[tr('No mapped building at point','Geen gebouw op punt','Kein Gebäude am Punkt')]:[]),...(spec.insideCamping?[tr('Inside mapped campsite boundary','Binnen campinggrens','Innerhalb der Campinggrenze')]:[]),...(spec.accommodationIntent==='accommodation'?[tr('Accommodation rules: review','Verblijfsregels: controleren','Unterkunftsregeln: prüfen')]:[]),...(spec.preferQuiet?[tr('Quietness: unverified','Rust: niet gecontroleerd','Ruhe: ungeprüft')]:[])];
    const distances=[...(spec.nearCamping?[['camping',tr('Camping or holiday park','Camping of vakantiepark','Camping- oder Ferienpark'),'<']]:[]),...(spec.nearTown?[['town',tr('Town','Plaats','Ort'),'<']]:[]),...spec.nearFeatures.map(kind=>[kind,tr(...nearbyTypes[kind].label),'<']),...(spec.avoidIndustry?[['industry',tr('Mapped industry','Gekarteerde industrie','Kartierte Industrie'),'>']]:[])];
    box.innerHTML=`<div class="advanced-engine" data-pv-managed>${safe(interpretationLabel(spec))}</div><strong class="pv-criteria-title">${safe(tr('Check the interpreted criteria','Controleer de zoekcriteria','Erkannte Kriterien prüfen'))}</strong>${spec.explanation?`<p class="advanced-explanation">${safe(spec.explanation)}</p>`:''}${chips.length?`<div class="advanced-chips">${chips.map(x=>`<span>${safe(x)}</span>`).join('')}</div>`:''}${distances.length?`<div class="pv-distance-editors">${distances.map(([kind,label,operator])=>`<label>${safe(label)} <span>${operator==='<'?'≤':'≥'}</span><input type="number" data-distance-kind="${kind}" min="0.1" max="50" step="0.1" value="${spec.distanceKm[kind]}"> km</label>`).join('')}</div><p class="pv-criteria-note">${safe(tr('Straight-line distance to mapped features; edit before searching.','Hemelsbrede afstand tot kaartobjecten; pas aan voor zoeken.','Luftlinie zu kartierten Objekten; vor der Suche anpassen.'))}</p>`:''}${spec.nearbyHomes?`<label class="pv-home-editor">${safe(tr('Residential buildings nearby · BAG screening within','Woningen in de buurt · BAG-controle binnen','Wohngebäude in der Nähe · BAG-Prüfung im Umkreis von'))} <input type="number" data-home-radius min="50" max="1000" step="50" value="${spec.homeRadiusM}"> m <span>${safe(tr('Provisional until checked','Voorlopig tot gecontroleerd','Bis zur Prüfung vorläufig'))}</span></label>`:''}${spec.unsupported.map(x=>`<p class="advanced-warning">${safe(tr('Needs separate review:','Apart controleren:','Gesondert prüfen:'))} ${safe(x)}</p>`).join('')}`;
  }
  // One research workspace owns the request, result list and local history.
  // Keep the original form/result nodes so existing search and manual hooks still apply.
  function setOpen(open,options={}){
    advanced.open=Boolean(open);
    if(advanced.open)void refreshBackendStatus();
    if(options.tab)setSearchTab(options.tab);
    const panel=$('advanced-panel');panel.hidden=!advanced.open;
    $('advanced-toggle').setAttribute('aria-expanded',String(advanced.open));
    $('search-results').hidden=true;
    window.dispatchEvent(new CustomEvent('planview-search-open',{detail:{open:advanced.open,tab:advanced.activeTab}}));
    if(advanced.open&&options.focus!==false){
      const target=advanced.activeTab==='request'?$('advanced-query'):panel.querySelector(`[data-search-tab="${advanced.activeTab}"]`);
      target?.focus({preventScroll:true});
    }
  }
  function loadSearchHistory(){try{return JSON.parse(localStorage.getItem('planview-search-history')||'[]').filter(item=>item&&typeof item.query==='string').slice(0,20);}catch{return[];}}
  function setSearchTab(tab){
    advanced.activeTab=tab==='current'?'request':['request','results','history'].includes(tab)?tab:'request';
    const views={request:'advanced-current-view',results:'advanced-results-view',history:'advanced-history-view'};
    document.querySelectorAll('[data-search-tab]').forEach(button=>{
      const selected=button.dataset.searchTab===advanced.activeTab;
      button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
    });
    for(const [name,id] of Object.entries(views))if($(id))$(id).hidden=name!==advanced.activeTab;
    $('advanced-panel').dataset.researchTab=advanced.activeTab;
    if(advanced.activeTab==='history')renderHistory($('advanced-history-view'));
    updateResearchState();
    window.dispatchEvent(new CustomEvent('planview-search-tab',{detail:{open:advanced.open,tab:advanced.activeTab}}));
  }
  function clearHistory(){advanced.history=[];try{localStorage.removeItem('planview-search-history');}catch{}renderHistory($('advanced-history-view'));}
  function renderHistory(target){
    if($('search-history-count'))$('search-history-count').textContent=String(advanced.history.length);
    if(!target)return;
    if(!advanced.history.length){target.innerHTML=`<div class="pv-research-empty"><strong>${safe(tr('No searches saved yet','Nog geen zoekopdrachten bewaard','Noch kein Suchverlauf'))}</strong><p>${safe(tr('Searches with results appear here. Up to 20 recent search configurations are stored on this device.','Zoekopdrachten met resultaten verschijnen hier. Maximaal 20 recente zoekinstellingen worden op dit apparaat bewaard.','Suchen mit Treffern erscheinen hier. Bis zu 20 letzte Suchkonfigurationen werden lokal auf diesem Gerät gespeichert.'))}</p></div>`;return;}
    target.innerHTML=`<div class="pv-history-toolbar"><strong>${safe(tr('Recent searches','Recente zoekopdrachten','Letzte Suchen'))}</strong><button type="button" data-clear-history>${safe(tr('Clear history','Geschiedenis wissen','Verlauf löschen'))}</button></div><p class="pv-research-note">${safe(tr('Load a configuration, then run it again for current map data. Stored locally on this device.','Laad een zoekinstelling en voer deze opnieuw uit voor actuele kaartgegevens. Lokaal op dit apparaat bewaard.','Konfiguration laden und für aktuelle Kartendaten erneut ausführen. Lokal auf diesem Gerät gespeichert.'))}</p>${advanced.history.map((item,index)=>`<article class="pv-history-item"><button type="button" class="pv-history-query" data-history-load="${index}"><strong>${safe(item.query)}</strong><small>${safe(item.scopeName||item.scope||'Limburg')} · ${item.createdAt?safe(new Date(item.createdAt).toLocaleString()):''}</small><small>${safe(tr('Load previous search','Vorige zoekopdracht laden','Vorherige Suche laden'))} →</small></button></article>`).join('')}`;
    target.querySelector('[data-clear-history]')?.addEventListener('click',clearHistory);target.querySelectorAll('[data-history-load]').forEach(button=>button.onclick=()=>restoreHistory(Number(button.dataset.historyLoad)));
  }
  function updateResearchState(){
    if($('search-results-count'))$('search-results-count').textContent=String(advanced.results.length);
    const empty=$('pv-research-empty');if(!empty)return;
    const visible=advanced.results.filter(r=>advanced.filter==='matches'?!r.review:advanced.filter==='review'?r.review:true);
    empty.hidden=visible.length>0;
    const title=advanced.busy?tr('Screening in progress','Kaartcontrole loopt','Kartenprüfung läuft'):advanced.results.length?tr('No results in this filter','Geen resultaten in dit filter','Keine Treffer in diesem Filter'):advanced.hasSearched?tr('No candidates returned','Geen kandidaten gevonden','Keine Kandidaten zurückgegeben'):tr('Your results will appear here','Je resultaten verschijnen hier','Hier erscheinen deine Treffer');
    const copy=advanced.busy?tr('Results appear as sampled points are checked. You can stop the search; any shown results remain partial.','Resultaten verschijnen terwijl steekproefpunten worden gecontroleerd. Je kunt stoppen; getoonde resultaten blijven onvolledig.','Treffer erscheinen während der Stichprobenprüfung. Du kannst abbrechen; angezeigte Ergebnisse bleiben dann unvollständig.'):advanced.results.length?tr('Choose All to see the other candidates. A filter is not a complete assessment of available sites.','Kies Alle voor de andere kandidaten. Een filter is geen volledige beoordeling van beschikbare locaties.','Wähle Alle, um die übrigen Kandidaten zu sehen. Ein Filter ist keine vollständige Standortprüfung.'):advanced.hasSearched?tr('Review the search status and adjust the request or area. This is a sampled search, not a complete parcel inventory.','Bekijk de zoekstatus en pas de vraag of het gebied aan. Dit is een steekproef, geen volledige percelenlijst.','Prüfe den Suchstatus und passe Anfrage oder Gebiet an. Die Suche nutzt Stichproben und ist kein vollständiges Flurstücksverzeichnis.'):tr('Describe the site you need or use manual criteria in Request.','Beschrijf je locatie of gebruik handmatige criteria bij Vraag.','Beschreibe den gesuchten Standort oder nutze die manuellen Kriterien unter Anfrage.');
    empty.innerHTML=`<strong>${safe(title)}</strong><p>${safe(copy)}</p>`;
    $('advanced-results-view').setAttribute('aria-busy',String(advanced.busy));
  }
  function translateResearchPanel(){
    const panel=$('advanced-panel');
    panel.setAttribute('aria-label',tr('Research workspace','Onderzoeksruimte','Recherchebereich'));
    const heading=panel.querySelector('.advanced-heading h2');heading.textContent=tr('Research','Onderzoek','Recherche');heading.dataset.pvManaged='';
    const labels={request:tr('Request','Vraag','Anfrage'),results:tr('Results','Treffers','Treffer'),history:tr('History','Geschiedenis','Verlauf')};
    for(const button of panel.querySelectorAll('[data-search-tab]'))button.querySelector('.pv-research-tab-label').textContent=labels[button.dataset.searchTab];
    panel.querySelector('.pv-search-tabs').setAttribute('aria-label',tr('Research views','Onderzoeksweergaven','Rechercheansichten'));
    $('advanced-close').setAttribute('aria-label',tr('Close research','Onderzoek sluiten','Recherche schließen'));
    if($('pv-clear-search'))$('pv-clear-search').textContent=tr('Reset current search','Huidige zoekopdracht wissen','Aktuelle Suche zurücksetzen');
    if($('pv-research-footer-note'))$('pv-research-footer-note').textContent=tr('Reset clears the request, results and marked area. History and saved cases stay.','Wissen verwijdert vraag, resultaten en markering. Geschiedenis en dossiers blijven.','Zurücksetzen löscht Anfrage, Treffer und Markierung. Verlauf und Fälle bleiben erhalten.');
    renderHistory($('advanced-history-view'));updateResearchState();renderBackendStatus();
  }
  function initResearchPanel(){
    const panel=$('advanced-panel'),tabs=panel.querySelector('.pv-search-tabs'),request=$('advanced-current-view'),history=$('advanced-history-view');
    panel.classList.add('pv-research-panel');
    tabs.dataset.pvManaged='';
    tabs.innerHTML=[['request','advanced-current-view'],['results','advanced-results-view'],['history','advanced-history-view']].map(([tab,id])=>`<button type="button" id="research-tab-${tab}" role="tab" aria-controls="${id}" aria-selected="${tab==='request'}" data-search-tab="${tab}"><span class="pv-research-tab-label"></span>${tab==='results'?'<span id="search-results-count">0</span>':tab==='history'?'<span id="search-history-count">0</span>':''}</button>`).join('');
    const results=document.createElement('div');results.id='advanced-results-view';results.className='advanced-results-view';results.hidden=true;results.innerHTML='<div id="pv-research-empty" class="pv-research-empty" data-pv-managed></div>';results.append($('advanced-results'));history.before(results);
    for(const [tab,view] of [['request',request],['results',results],['history',history]]){view.setAttribute('role','tabpanel');view.setAttribute('aria-labelledby',`research-tab-${tab}`);}
    history.dataset.pvManaged='';
    const status=$('advanced-status');status.classList.add('pv-research-status');tabs.after(status);
    // Remove the second result/history renderer entirely; state remains in advanced.
    $('search-results-dock')?.remove();$('search-dock-reopen')?.remove();
    tabs.querySelectorAll('[data-search-tab]').forEach(button=>{
      button.onclick=()=>setSearchTab(button.dataset.searchTab);
      button.onkeydown=event=>{const order=['request','results','history'],index=order.indexOf(button.dataset.searchTab);let next;if(event.key==='ArrowRight')next=order[(index+1)%3];else if(event.key==='ArrowLeft')next=order[(index+2)%3];else if(event.key==='Home')next=order[0];else if(event.key==='End')next=order[2];if(next){event.preventDefault();setSearchTab(next);$('research-tab-'+next).focus();}};
    });
    // interface.js adds existing manual/cancel/reset controls in its load handler.
    requestAnimationFrame(()=>{
      const footer=document.createElement('footer');footer.className='pv-research-footer';footer.dataset.pvManaged='';
      const actions=document.createElement('div');actions.className='pv-research-footer-actions';
      for(const id of ['pv-cancel-search','pv-clear-search'])if($(id))actions.append($(id));
      footer.append(actions);const note=document.createElement('p');note.id='pv-research-footer-note';note.className='pv-research-note';footer.append(note);panel.append(footer);
      translateResearchPanel();
    });
    setSearchTab('request');translateResearchPanel();
  }
  function restoreHistory(index){const item=advanced.history[index];if(!item)return;if(item.municipality){state.municipality=item.municipality;$('municipality').value=item.municipality;}$('advanced-query').value=item.query;$('advanced-scope-select').value=item.scope||'view';if(item.bounds){const b=item.bounds;if(item.scope==='drawn'){if(advanced.rectangle)state.map.removeLayer(advanced.rectangle);setBounds(L.latLngBounds([b[0],b[1]],[b[2],b[3]]));}else if(item.scope==='view')state.map.fitBounds(L.latLngBounds([b[0],b[1]],[b[2],b[3]]),{animate:false});}else if(advanced.bounds){state.map.removeLayer(advanced.rectangle);advanced.rectangle=null;advanced.bounds=null;$('advanced-clear-area').hidden=true;$('advanced-scope-select').querySelector('[value="drawn"]').disabled=true;}$('advanced-scope-label').textContent=item.scopeName||tr('Current map view','Huidige kaartweergave','Aktueller Kartenausschnitt');setSearchTab('current');$('advanced-status').textContent=tr('Previous search restored. Review it and run again to refresh current map data.','Vorige zoekopdracht hersteld. Start opnieuw om de kaartgegevens te vernieuwen.','Vorherige Suche geladen. Erneut starten, um aktuelle Kartendaten zu prüfen.');setOpen(true);$('advanced-run').focus();}
  function rememberSearch(query,scope){if(!query||!advanced.results.length)return;const toBounds=b=>b?[b.getSouth(),b.getWest(),b.getNorth(),b.getEast()]:null;const mode=$('advanced-scope-select').value,bounds=mode==='drawn'?toBounds(advanced.bounds):toBounds(scope?.bounds);const item={query,scope:mode,scopeName:scope?.name||$('advanced-scope-label').textContent,bounds,municipality:state.municipality,createdAt:new Date().toISOString(),count:advanced.results.length};advanced.history=[item,...advanced.history.filter(old=>old.query!==query||old.scope!==item.scope)].slice(0,20);try{localStorage.setItem('planview-search-history',JSON.stringify(advanced.history));}catch{}renderHistory($('advanced-history-view'));}

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
  function contextNeeds(spec){return spec.nearCamping||spec.insideCamping||spec.nearTown||spec.nearFeatures.length>0||spec.avoidIndustry||spec.preferQuiet;}
  async function loadContext(scope,spec,status){
    if(!contextNeeds(spec))return {camping:[],towns:[],industry:[],roads:[],features:{},source:'none'};
    const bounds=scope.bounds,maxDistance=Math.max(...Object.values(spec.distanceKm||distanceDefaults)),padding=Math.max(.12,Math.min(.75,maxDistance/65+.025));
    const cacheKey=[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth(),padding].map(x=>x.toFixed(3)).join(':');
    if(advanced.contextCache.has(cacheKey))return advanced.contextCache.get(cacheKey);
    status.textContent=tr('Checking official mapped places and surroundings…','Officiële plaatsen en omgeving controleren…','Amtlich erfasste Orte und Umgebung prüfen…');
    if(!advanced.contextData){const response=await fetch('data/limburg_context.json');if(!response.ok)throw new Error('TOP10NL context unavailable');advanced.contextData=await response.json();}
    const inside=item=>{const [west,south,east,north]=item.extent||[item.point.lng,item.point.lat,item.point.lng,item.point.lat];return east>=bounds.getWest()-padding&&west<=bounds.getEast()+padding&&north>=bounds.getSouth()-padding&&south<=bounds.getNorth()+padding;};
    const sites=await window.planviewContext.load('camping');
    const mappedSites=sites.features.map(feature=>{const extent=feature._bounds;const p={lat:(extent[1]+extent[3])/2,lng:(extent[0]+extent[2])/2};return {id:feature.id,name:feature.properties.name,source:'PDOK TOP10NL',sourceUrl:feature.properties.sourceUrl,point:p,extent,geometry:feature.geometry};});
    const data=advanced.contextData,context={camping:mappedSites.filter(inside),towns:data.towns.filter(inside),industry:data.industry.filter(inside),roads:[],features:Object.fromEntries(Object.keys(nearbyTypes).map(kind=>[kind,(data.features?.[kind]||[]).filter(inside)])),source:'PDOK TOP10NL + ProRail'};
    advanced.contextCache.set(cacheKey,context);return context;
  }
  function offsetPoint(p,km,bearing){const rad=bearing*Math.PI/180,lat=p.lat+km*Math.cos(rad)/111.2,lng=p.lng+km*Math.sin(rad)/(111.2*Math.cos(p.lat*Math.PI/180));return {lat,lng};}
  function spaced(items,max){if(items.length<=max)return items;const sorted=[...items].sort((a,b)=>a.point.lat-b.point.lat||a.point.lng-b.point.lng);return Array.from({length:max},(_,i)=>sorted[Math.floor(i*(sorted.length-1)/(max-1))]);}
  function candidatePoints(scope,spec,context,envelopes=[]){
    const all=[],seen=new Set();const add=p=>{if(!inScope(p,scope))return;const key=`${p.lat.toFixed(5)}:${p.lng.toFixed(5)}`;if(!seen.has(key)){seen.add(key);all.push(p);}};
    if(spec.requireEnvelope){for(const item of spaced(envelopes.map(envelope=>({point:{lat:envelope.point[1],lng:envelope.point[0]},envelope})),3000))add({...item.point,envelope:item.envelope});}
    const anchors=spec.insideCamping?spaced(context.camping,80):spec.nearCamping?spaced(context.camping,24):spec.nearFeatures.length?spaced(context.features[spec.nearFeatures[0]],24):spec.nearTown?spaced(context.towns,24):[];
    if(spec.insideCamping)for(const item of anchors){const [west,south,east,north]=item.extent;for(let row=0;row<5;row++)for(let col=0;col<5;col++){const p={lat:south+(row+.5)*(north-south)/5,lng:west+(col+.5)*(east-west)/5};if(geometryContains(item.geometry,p)){add(p);break;}}}
    if(anchors.length&&!spec.insideCamping){const radius=spec.nearCamping?spec.distanceKm.camping:spec.nearFeatures.length?spec.distanceKm[spec.nearFeatures[0]]:spec.distanceKm.town;const rings=[Math.min(.8,radius*.3),radius*.35,radius*.65,radius*.9].filter((km,i,all)=>km>.05&&all.findIndex(other=>Math.abs(other-km)<.05)===i);for(const km of rings)for(const bearing of [0,90,180,270,45,135,225,315])for(const anchor of anchors)add({...offsetPoint(anchor.point,km,bearing),searchRing:km});}
    for(const point of sampleGrid(scope,8,8))add(point);
    const eligible=all.map(point=>{
      const insideSite=spec.insideCamping?context.camping.find(item=>point.lng>=item.extent[0]&&point.lng<=item.extent[2]&&point.lat>=item.extent[1]&&point.lat<=item.extent[3]&&geometryContains(item.geometry,point)):null;
      if(spec.insideCamping&&!insideSite)return null;
      const camping=insideSite?{km:0,item:insideSite}:closest(point,context.camping),town=closest(point,context.towns),industry=closest(point,context.industry),road=closest(point,context.roads),nearFeatures=Object.fromEntries(spec.nearFeatures.map(kind=>[kind,closest(point,context.features[kind])]));
      if(spec.nearCamping&&(!camping||camping.km>(spec.distanceKm?.camping||3)))return null;
      if(spec.nearTown&&(!town||town.km>(spec.distanceKm?.town||6)))return null;
      if(spec.nearFeatures.some(kind=>!nearFeatures[kind]||nearFeatures[kind].km>(spec.distanceKm?.[kind]||nearbyTypes[kind].km)))return null;
      if(spec.avoidIndustry&&industry&&industry.km<(spec.distanceKm?.industry||1.2))return null;
      if(spec.preferQuiet&&road&&road.km<.35)return null;
      return {point,envelopeSource:point.envelope||null,camping,town,industry,road,nearFeatures};
    }).filter(Boolean);
    if(spec.requireEnvelope)return [...spaced(eligible.filter(item=>item.envelopeSource),spec.insideCamping?18:60),...spaced(eligible.filter(item=>!item.envelopeSource),spec.insideCamping?6:20)].slice(0,spec.insideCamping?24:80);
    if(anchors.length&&!spec.insideCamping){
      const bands=[...new Set(eligible.map(item=>item.point.searchRing).filter(Number.isFinite))],limit=80,perBand=Math.max(8,Math.floor((limit-8)/Math.max(1,bands.length)));
      const chosen=[...spaced(eligible.filter(item=>item.point.searchRing==null),8)];
      for(const band of bands)chosen.push(...spaced(eligible.filter(item=>item.point.searchRing===band),perBand));
      const seen=new Set(chosen);for(const item of spaced(eligible,limit))if(chosen.length<limit&&!seen.has(item)){chosen.push(item);seen.add(item);}
      return chosen.slice(0,limit);
    }
    if(anchors.length)return eligible.slice(0,24);
    return eligible.slice(0,spec.insideCamping?24:80);
  }
  function scoreResult(r,spec){let score=50;if(r.status==='onherroepelijk')score+=8;if(r.envelope)score+=12;if(r.unbuilt)score+=10;if(spec.insideCamping&&r.camping)score+=18;if(spec.nearCamping&&r.camping)score+=Math.max(0,15-5*r.camping.km);if(spec.nearTown&&r.town)score+=Math.max(0,10-1.7*r.town.km);for(const kind of spec.nearFeatures)score+=Math.max(0,12-4*r.nearFeatures[kind].km);if(spec.avoidIndustry&&r.industry)score+=Math.min(8,r.industry.km);if(spec.preferQuiet&&r.road)score+=Math.min(8,4*r.road.km);return Math.round(score);}
  function evidenceText(r,spec){const parts=[];if(spec.insideCamping&&r.camping)parts.push(`${tr('Inside mapped boundary','Binnen ingetekende grens','Innerhalb kartierter Grenze')} ${r.camping.item.name||''} · PDOK TOP10NL`);if(spec.nearCamping&&r.camping)parts.push(`${r.camping.km.toFixed(1)} km ${tr('to camping','tot camping','zum Campingplatz')}${r.camping.item.name?` ${r.camping.item.name}`:''}`);if(spec.nearTown&&r.town)parts.push(`${r.town.km.toFixed(1)} km ${tr('to town','tot plaats','zum Ort')}${r.town.item.name?` ${r.town.item.name}`:''}`);for(const kind of spec.nearFeatures){const near=r.nearFeatures[kind];parts.push(`${near.km.toFixed(1)} km ${tr('to mapped','tot','zu erfasstem')} ${tr(...nearbyTypes[kind].label)}${near.item.name?` ${near.item.name}`:''} · ${near.item.source}`);}if(spec.avoidIndustry)parts.push(r.industry?`${r.industry.km.toFixed(1)} km ${tr('to mapped industry','tot ingetekende industrie','zu erfasster Industrie')}`:tr('No industry feature returned nearby','Geen industrieobject in bereik gevonden','Kein Industrieobjekt im Suchbereich gefunden'));if(spec.preferQuiet)parts.push(r.road?`${r.road.km.toFixed(1)} km ${tr('to mapped major road · quiet unverified','tot hoofdweg · stilte niet geverifieerd','zur Hauptstraße · Ruhe ungeprüft')}`:tr('Major-road proxy unavailable · quiet unverified','Geen hoofdwegindicatie · stilte ongeverifieerd','Keine Straßenindikation · Ruhe ungeprüft'));return parts.join(' · ');}
  function bagEvidence(r,spec){
    if(!spec.nearbyHomes)return '';
    if(!r.bag)return tr('Nearby homes: BAG check pending for this candidate.','Woningen in de buurt: BAG-controle nog open.','Wohnhäuser im Umfeld: BAG-Prüfung für diesen Kandidaten offen.');
    if(r.bag.state==='error')return tr('Nearby homes: BAG service unavailable; criterion unverified.','Woningen in de buurt: BAG niet beschikbaar; criterium open.','Wohnhäuser im Umfeld: BAG nicht erreichbar; Kriterium ungeprüft.');
    return `${r.bag.count} ${tr('registered residential building footprints','geregistreerde woongebouwen','registrierte Wohngebäude')} ≤ ${spec.homeRadiusM} m · PDOK BAG${r.bag.partial?` · ${tr('incomplete response','onvolledig antwoord','unvollständige Antwort')}`:''}`;
  }
  async function nearbyResidentialBuildings(point,radiusM){
    const key=`${point.lat.toFixed(5)}:${point.lng.toFixed(5)}:${radiusM}`;
    if(advanced.bagCache.has(key))return advanced.bagCache.get(key);
    const task=(async()=>{
      const latPad=radiusM/111000,lonPad=radiusM/(111000*Math.cos(point.lat*Math.PI/180));
      const bbox=[point.lng-lonPad,point.lat-latPad,point.lng+lonPad,point.lat+latPad].join(',');
      const response=await fetch(`https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand/items?bbox=${bbox}&limit=1000&f=json`,{signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new Error(`BAG ${response.status}`);
      const data=await response.json();if(!Array.isArray(data.features))throw new Error('BAG response missing features');
      const residential=data.features.filter(feature=>{
        const p=feature.properties||{},uses=Array.isArray(p.gebruiksdoel)?p.gebruiksdoel.join(' '):String(p.gebruiksdoel||'');
        if(!/woonfunctie/i.test(uses)||!/in gebruik/i.test(String(p.status||'')))return false;
        const coordinates=[];const collect=value=>{if(Array.isArray(value)&&value.length>=2&&typeof value[0]==='number'&&typeof value[1]==='number')coordinates.push(value);else if(Array.isArray(value))value.forEach(collect);};collect(feature.geometry?.coordinates);
        if(!coordinates.length)return false;
        const west=Math.min(...coordinates.map(c=>c[0])),east=Math.max(...coordinates.map(c=>c[0])),south=Math.min(...coordinates.map(c=>c[1])),north=Math.max(...coordinates.map(c=>c[1]));
        const edge={lat:Math.max(south,Math.min(north,point.lat)),lng:Math.max(west,Math.min(east,point.lng))};
        const km=haversine(point,edge);return km<=radiusM/1000&&km>.008;
      });
      return {state:'checked',count:residential.length,partial:!!data.links?.some(link=>link.rel==='next')||data.features.some(feature=>feature.properties?.gebruiksdoel==null||feature.properties?.status==null)};
    })();advanced.bagCache.set(key,task);try{return await task;}catch(error){advanced.bagCache.delete(key);throw error;}
  }
  async function checkNearbyHomes(ticket,spec,status){
    if(!spec.nearbyHomes||!advanced.results.length)return;
    const leads=advanced.results.slice(0,12);status.textContent=tr(`Checking nearby BAG homes for ${leads.length} candidates…`,`BAG-woningen bij ${leads.length} kandidaten controleren…`,`BAG-Wohngebäude bei ${leads.length} Kandidaten prüfen…`);
    for(let offset=0;offset<leads.length;offset+=3){
      await Promise.allSettled(leads.slice(offset,offset+3).map(async lead=>{try{lead.bag=await nearbyResidentialBuildings(lead.point,spec.homeRadiusM);if(lead.bag.count>0){lead.missing=lead.missing.filter(x=>x!=='nearbyHomes');lead.review=lead.missing.length>0;}}catch{lead.bag={state:'error'};}}));
      if(ticket!==advanced.ticket)return;showResults(spec);
    }
    advanced.results=advanced.results.filter(lead=>!(lead.bag?.state==='checked'&&lead.bag.count===0&&!lead.bag.partial));
    showResults(spec);
  }
  function dsoEvidence(r){
    if(r.dsoLoading)return `<span class="pv-legal-check">${safe(tr('Stage 2 · checking DSO rules at this point…','Stap 2 · DSO-regels op dit punt controleren…','Stufe 2 · DSO-Regeln am Punkt werden geprüft…'))}</span>`;
    if(r.dsoError)return `<span class="pv-legal-check">${safe(tr('DSO rule check unavailable; inspect this point for sources.','DSO-regelcontrole niet beschikbaar; open de locatie.','DSO-Regelprüfung nicht verfügbar; Standort öffnen.'))}</span>`;
    if(!r.dso)return `<span class="pv-legal-check">${safe(tr('DSO: open this point to check current rules.','DSO: open dit punt voor actuele regels.','DSO: Punkt öffnen, um aktuelle Regeln zu prüfen.'))}</span>`;
    const instruments=r.dso.instruments||[],usable=instruments.filter(item=>!item.error),names=[...new Set(usable.flatMap(item=>[...(item.designations||[]).map(a=>a.name),...(item.areas||[]).map(a=>a.name)]))].filter(Boolean).slice(0,3);
    if(!usable.length)return `<span class="pv-legal-check">${safe(tr('DSO point details unavailable; open the lead to retry.','DSO-puntdetails niet beschikbaar; open de locatie opnieuw.','DSO-Punktdetails nicht verfügbar; Treffer zur erneuten Prüfung öffnen.'))}</span>`;
    return `<span class="pv-legal-check"><strong>${safe(r.dso.complete?tr('Stage 2 · DSO point check','Stap 2 · DSO-puntcontrole','Stufe 2 · DSO-Punktprüfung'):tr('Stage 2 · partial DSO point check','Stap 2 · gedeeltelijke DSO-puntcontrole','Stufe 2 · teilweise DSO-Punktprüfung'))}</strong>${safe(names.length?names.join(' · '):tr('Only broad regulation areas returned','Alleen algemene regelgebieden gevonden','Nur allgemeine Regelgebiete geliefert'))}<small>${safe(tr('Rule references found; permission still requires review.','Regelverwijzingen gevonden; toestemming nog beoordelen.','Regelverweise gefunden; Zulässigkeit weiter zu prüfen.'))}</small></span>`;
  }
  function openResult(r){
    const point={...r.point};
    if(r.envelope&&r.envelopeId&&r.sourceId){
      point.searchEnvelope={id:r.envelopeId,plan:r.sourceId,date:r.envelopeDate||'',status:r.envelopeStatus||'',sourceUpdated:advanced.envelopeManifest?.sourceUpdated||''};
    }
    navigateToPoint(point,17);
    selectPoint(point);
    if(innerWidth>=1360&&advanced.open)setSearchTab('results');else setOpen(false);
  }
  function missingText(code){return code==='bouwvlak'?tr('building envelope at this point','bouwvlak op dit punt','Baufenster am Prüfpunkt'):code==='unbuilt'?tr('no mapped building at this point','geen gebouw op dit punt','kein Gebäude am Prüfpunkt'):code==='quiet'?tr('quietness','rust','Ruhe'):code==='nearbyHomes'?tr('residential buildings nearby','woongebouwen in de buurt','Wohngebäude im Umfeld'):tr('other requested condition','andere gevraagde voorwaarde','weitere Suchbedingung');}
  function resultCard(r,i,spec){
    const label=r.review?tr('Candidate · checks open','Kandidaat · controles open','Kandidat · Prüfungen offen'):tr('Mapped criteria met · legal review open','Kaartcriteria voldaan · juridische toets open','Kartenkriterien erfüllt · Rechtsprüfung offen');
    const detail=r.review?`${safe(tr('To check:','Te controleren:','Zu prüfen:'))} ${safe(r.missing.map(missingText).join(', '))}`:`${safe(r.group)}${r.envelope?' · bouwvlak':''}${r.unbuilt?' · no mapped building at point':''}`;
    return `<button class="advanced-result ${r.review?'review-result':''}" type="button" data-smart-result="${i}"><span class="advanced-result-num">${i+1}</span><span><strong>${safe(r.name)}</strong><small>${safe(r.municipality||'Limburg')} · ${safe(r.status||'status to verify')} · ${safe(planTitle(r.sourceId))}</small><span class="pv-result-verdict">${safe(label)}</span><em>${detail}</em>${r.envelopeId?`<small class="advanced-envelope-source">${safe(tr('Official bouwvlak','Officieel bouwvlak','Amtliches Baufenster'))} · ${safe(r.envelopeId)}${r.envelopeDate?` · ${safe(r.envelopeDate)}`:''}${r.envelopeStatus?` · ${safe(r.envelopeStatus)}`:''}</small>`:''}${evidenceText(r,spec)?`<small class="advanced-context-evidence">${safe(evidenceText(r,spec))}</small>`:''}${spec.nearbyHomes?`<small class="advanced-context-evidence">${safe(bagEvidence(r,spec))}</small>`:''}${spec.accommodationIntent==='accommodation'?`<small class="advanced-context-evidence">${safe(tr('Accommodation permission unverified. Check the linked plan rules, building envelope, use and occupancy conditions.','Verblijf niet geverifieerd. Controleer de planregels, bouwvlak en gebruiksvoorwaarden.','Unterkunft ungeprüft. Planregeln, Baufenster und Nutzung prüfen.'))}</small>`:''}${dsoEvidence(r)}<small class="advanced-imro">PDOK · ${safe(r.sourceId)}</small></span></button>${spec.accommodationIntent==='accommodation'?`<a class="advanced-rule-link" href="${safe(officialPlanLink(r.sourceId,r.point))}" target="_blank" rel="noopener noreferrer">${safe(tr('Open applicable plan rules ↗','Toepasselijke planregels openen ↗','Geltende Planregeln öffnen ↗'))}</a>`:''}`;
  }
  function renderMarkers(){
    if(!advanced.markers)return;advanced.markers.clearLayers();
    const visible=r=>advanced.filter==='matches'?!r.review:advanced.filter==='review'?r.review:true;
    const cells=new Map();for(let i=0;i<advanced.results.length;i++){const r=advanced.results[i];if(!visible(r))continue;const p=state.map.latLngToContainerPoint(r.point),key=`${Math.floor(p.x/58)}:${Math.floor(p.y/58)}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push({r,i});}
    for(const group of cells.values()){
      const count=group.length,center={lat:group.reduce((n,x)=>n+x.r.point.lat,0)/count,lng:group.reduce((n,x)=>n+x.r.point.lng,0)/count};
      const only=group[0],className=`smart-pin${count>1?' cluster-pin':only.r.review?' review-pin':''}`;
      const marker=L.marker(center,{icon:L.divIcon({className,html:`<span>${count>1?count:only.i+1}</span>`,iconSize:[count>1?36:31,count>1?36:31],iconAnchor:[count>1?18:15,count>1?18:15]}),zIndexOffset:900}).addTo(advanced.markers);
      marker.bindTooltip(count>1?`${count} ${tr('candidate areas · zoom in','kandidaatgebieden · zoom in','Kandidatenflächen · hineinzoomen')}`:`${safe(only.r.name)} · ${safe(planTitle(only.r.sourceId))}`,{direction:'top',className:'opportunity-tooltip'});
      marker.on('click',e=>{L.DomEvent.stopPropagation(e.originalEvent);if(count===1)openResult(only.r);else state.map.setView(center,Math.min(17,state.map.getZoom()+2),{animate:true});});
    }
  }
  function showResults(spec){
    advanced.lastSpec=spec;const visible=r=>advanced.filter==='matches'?!r.review:advanced.filter==='review'?r.review:true;
    const box=$('advanced-results');box.innerHTML=advanced.results.map((r,i)=>visible(r)?resultCard(r,i,spec):'').join('');
    box.querySelectorAll('[data-smart-result]').forEach(button=>button.onclick=()=>{const r=advanced.results[Number(button.dataset.smartResult)];openResult(r);});
    advanced.overlay.clearLayers();
    for(let i=0;i<advanced.results.length;i++){const r=advanced.results[i];if(!visible(r))continue;const color=r.review?'#bf811c':'#087f70';if(r.feature.geometry){const polygon=L.geoJSON(geoToLatLng(r.feature),{style:{color,weight:3.5,dashArray:r.review?'7 5':undefined,fillColor:color,fillOpacity:r.review ? .24 : .42}}).addTo(advanced.overlay);polygon.on('click',e=>{L.DomEvent.stopPropagation(e.originalEvent);openResult(r);});}
      if(r.envelopeGeometry){const bouwvlak=L.geoJSON({type:'Feature',properties:{id:r.envelopeId,plan:r.sourceId},geometry:r.envelopeGeometry},{style:{color:'#55efc0',weight:3,fillColor:'#70f4ca',fillOpacity:.34}}).addTo(advanced.overlay);bouwvlak.bindTooltip(`${safe(tr('Official bouwvlak','Officieel bouwvlak','Amtliches Baufenster'))} · ${safe(r.envelopeId)}`,{className:'opportunity-tooltip'});bouwvlak.on('click',e=>{L.DomEvent.stopPropagation(e.originalEvent);openResult(r);});}
    }
    const shown=new Set();for(const r of advanced.results){if(!visible(r))continue;for(const [kind,near,color] of [['camping',(spec.nearCamping||spec.insideCamping)&&r.camping,'#72e4c5'],['town',spec.nearTown&&r.town,'#9db8ff'],...spec.nearFeatures.map(type=>[type,r.nearFeatures[type],'#ffcf74'])]){if(!near||shown.has(near.item.id))continue;shown.add(near.item.id);L.circleMarker([near.item.point.lat,near.item.point.lng],{radius:5,color,weight:2,fillColor:color,fillOpacity:.9,interactive:true}).bindTooltip(`${safe(near.item.source||'PDOK TOP10NL')} · ${safe(near.item.name||near.item.id)}`).addTo(advanced.overlay);}}
    renderMarkers();updateResearchState();window.dispatchEvent(new CustomEvent('planview-search-results'));
  }
  async function checkDsoLeads(ticket,spec,status){
    if(!window.planviewOfficialServices?.configured?.dso||!advanced.results.length)return;
    const leads=advanced.results.slice(0,3);
    for(const lead of leads)lead.dsoLoading=true;
    showResults(spec);
    status.textContent+=` ${tr('Stage 2: checking DSO rules for the first three leads…','Stap 2: DSO-regels voor de eerste drie locaties controleren…','Stufe 2: DSO-Regeln für die ersten drei Treffer prüfen…')}`;
    await Promise.allSettled(leads.map(async lead=>{
      try{const [x,y]=wgs84ToRd(lead.point);const response=await fetch(`/api/dso/rules?x=${x.toFixed(3)}&y=${y.toFixed(3)}`,{cache:'no-store'});
        if(!response.ok)throw new Error(`DSO ${response.status}`);
        const data=await response.json();if(ticket!==advanced.ticket)return;lead.dso=data;
      }catch{if(ticket===advanced.ticket)lead.dsoError=true;}
      finally{if(ticket===advanced.ticket){lead.dsoLoading=false;showResults(spec);}}
    }));
    if(ticket===advanced.ticket)status.textContent+=` ${tr('Open any lead to see its full point review.','Open een locatie voor de volledige puntcontrole.','Jeden Treffer öffnen, um die vollständige Punktprüfung zu sehen.')}`;
  }
  async function runSearch(manualSpec=null){
    const query=manualSpec?'Manual criteria':$('advanced-query').value.trim();if(!query){$('advanced-status').textContent='Describe the areas you want first.';$('advanced-query').focus();return;}
    if(!manualSpec&&wantsMarkedArea(query)){if(!advanced.bounds){startDrawing(true);return;}$('advanced-scope-select').value='drawn';}
    const scope=selectedScope(query),status=$('advanced-status'),button=$('advanced-run');if(!scope){status.textContent=tr('Choose a municipality on the left, zoom into one, or mark an area.','Kies links een gemeente, zoom erop in of markeer een gebied.','Links eine Gemeinde wählen, hineinzoomen oder einen Bereich markieren.');return;}
    $('advanced-scope-label').textContent=scope.name;
    const scopeSignature=`${$('advanced-scope-select').value}:${scope.bounds.toBBoxString()}`;
    const pending=!manualSpec&&advanced.pending?.query===query&&advanced.pending?.scopeSignature===scopeSignature?advanced.pending:null;
    if(pending){for(const input of $('advanced-parsed').querySelectorAll('input'))if(!input.reportValidity())return;for(const input of $('advanced-parsed').querySelectorAll('[data-distance-kind]'))pending.spec.distanceKm[input.dataset.distanceKind]=Number(input.value);if($('advanced-parsed').querySelector('[data-home-radius]'))pending.spec.homeRadiusM=Number($('advanced-parsed').querySelector('[data-home-radius]').value);}
    const ticket=++advanced.ticket;button.disabled=true;advanced.filter='all';window.dispatchEvent(new CustomEvent('planview-search-busy',{detail:{busy:true}}));advanced.results=[];advanced.overlay.clearLayers();advanced.markers?.clearLayers();$('advanced-results').innerHTML='';advanced.hasSearched=Boolean(manualSpec||pending);setSearchTab(manualSpec||pending?'results':'request');window.dispatchEvent(new CustomEvent('planview-search-results'));if(!pending)$('advanced-parsed').hidden=true;
    try{
      const rough=pending?.spec||normalize(manualSpec||localInterpret(query));
      const [sampledPlanFeatures,nearby]=await Promise.all([
        pending?Promise.resolve([]):previewMap(scope,ticket,status),
        contextNeeds(rough)?loadContext(scope,rough,status):Promise.resolve(null)
      ]);
      if(ticket!==advanced.ticket)return;
      status.textContent=tr('Understanding your purpose and the sampled plan areas…','Je vraag en de bemonsterde plangebieden begrijpen…','Suchziel und geprüfte Plangebiete abgleichen…');
      const spec=manualSpec?{...normalize(manualSpec),engine:'manual',distanceKm:{...distanceDefaults,...manualSpec.distanceKm},nearbyHomes:!!manualSpec.nearbyHomes,homeRadiusM:manualSpec.homeRadiusM||250}:pending?.spec||completeInterpretation(await interpret(query,{scope:scope.name,interfaceLanguage:document.documentElement.lang,sampledPlanFeatures,nearbyFeatureCounts:nearby?{camping:nearby.camping.length,towns:nearby.towns.length,industry:nearby.industry.length,roads:nearby.roads.length,...Object.fromEntries(Object.entries(nearby.features).map(([kind,items])=>[kind,items.length]))}:{},nearbyExamples:nearby?[...nearby.camping.slice(0,2),...nearby.towns.slice(0,2),...nearby.features.station.slice(0,2)].map(item=>item.name).filter(Boolean):[]}),query);if(ticket!==advanced.ticket||!manualSpec&&query!==$('advanced-query').value.trim())return;renderInterpretation(spec);
      if(!manualSpec&&!pending){advanced.pending={query,scopeSignature,spec};button.textContent=tr('Search with these criteria','Zoeken met deze criteria','Mit diesen Kriterien suchen');status.textContent=tr('Review the distances and unverified conditions, then start the map search.','Controleer afstanden en open voorwaarden; start daarna de kaartzoekopdracht.','Entfernungen und offene Bedingungen prüfen, dann die Kartensuche starten.');return;}
      advanced.pending=null;button.textContent=tr('Find areas','Gebieden vinden','Gebiete finden');
      if(spec.unsupported.length)status.textContent=tr('Some conditions need manual review; map-supported criteria will still be screened.','Sommige voorwaarden moeten handmatig worden beoordeeld; de kaartcriteria worden wel gecontroleerd.','Einige Bedingungen brauchen eine manuelle Prüfung; die kartierbaren Kriterien werden trotzdem geprüft.');
      if(!spec.groups.length&&!spec.statuses.length&&!spec.requireEnvelope&&!spec.requireUnbuilt&&!spec.nearbyHomes&&!contextNeeds(spec)){status.textContent='No searchable map criterion recognized.';return;}
      const context=nearby&&(!(spec.nearCamping||spec.insideCamping)||(rough.nearCamping||rough.insideCamping))&&(!spec.nearTown||rough.nearTown)&&(!spec.avoidIndustry||rough.avoidIndustry)&&(!spec.preferQuiet||rough.preferQuiet)?nearby:await loadContext(scope,spec,status);if(ticket!==advanced.ticket)return;
      if((spec.nearCamping||spec.insideCamping)&&!context.camping.length){status.textContent=tr('No mapped campsites returned for this area. Try a smaller map view or another municipality.','Geen ingetekende campings gevonden. Kies een kleiner gebied of andere gemeente.','Keine erfassten Campingplätze gefunden. Kleineren Ausschnitt oder andere Gemeinde wählen.');return;}
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
          const geometryMissing=[];if(spec.requireEnvelope&&!envelope)geometryMissing.push('bouwvlak');if(spec.requireUnbuilt&&!unbuilt)geometryMissing.push('unbuilt');
          if(geometryMissing.length&&(!(spec.potentialBuildingLand||spec.includeReviewLeads)||!buildReviewGroups.has(group)))return null;
          const missing=[...geometryMissing];if(spec.preferQuiet)missing.push('quiet');if(spec.nearbyHomes)missing.push('nearbyHomes');if(spec.unsupported.length)missing.push('unsupported');const review=missing.length>0;
          const result={...candidate,feature,group,status:planStatus,name:props.naam||group,sourceId:props.plangebied||'',municipality:municipalityAt(point)?.name,envelope,unbuilt,envelopeGeometry,envelopeId,envelopeDate,envelopeStatus,review,missing};result.score=scoreResult(result,spec)-(review?20:0);return result;
        }));
        if(ticket!==advanced.ticket)return;
        for(const item of batch){if(item.status==='rejected'){failed++;continue;}const r=item.value;if(!r)continue;const key=r.feature.properties?.identificatie||`${r.sourceId}:${r.name}:${r.point.lat.toFixed(4)}:${r.point.lng.toFixed(4)}`;const target=r.review?reviewFound:found;if(!target.has(key)||target.get(key).score<r.score)target.set(key,r);}
        advanced.results=[...found.values()].sort((a,b)=>b.score-a.score).concat([...reviewFound.entries()].filter(([key])=>!found.has(key)).map(([,r])=>r).sort((a,b)=>b.score-a.score)).slice(0,40);if(offset%12===0||offset+6>=candidates.length)showResults(spec);
        status.textContent=`Checked ${Math.min(offset+6,candidates.length)} of ${candidates.length} locations · ${advanced.results.length} map areas highlighted…`;
      }
      const toDraw=advanced.results.filter(r=>r.envelope&&r.envelopeSource&&!r.envelopeGeometry);
      let shapeFailed=0;
      if(toDraw.length){status.textContent=tr('Loading precise building-envelope outlines…','Precieze bouwvlakgrenzen laden…','Genaue Baufenster-Umrisse laden…');
        const shapeLoads=await Promise.allSettled(toDraw.map(async r=>{r.envelopeGeometry=await loadEnvelopeGeometry(r.envelopeSource);}));
        shapeFailed=shapeLoads.filter(item=>item.status==='rejected').length;
        if(ticket!==advanced.ticket)return;showResults(spec);
      }
      await checkNearbyHomes(ticket,spec,status);if(ticket!==advanced.ticket)return;
      const mappedCount=advanced.results.filter(r=>!r.review).length,reviewCount=advanced.results.length-mappedCount;
      status.textContent=`${advanced.results.length} ${tr('candidate areas','kandidaatgebieden','Kandidatenflächen')} · ${mappedCount} ${tr('mapped criteria met','kaartcriteria voldaan','Kartenkriterien erfüllt')} · ${reviewCount} ${tr('with open checks','met open controles','mit offenen Prüfungen')} · ${candidates.length} ${tr('sampled locations (not a complete parcel inventory)','steekproefpunten (geen volledige percelenlijst)','Stichprobenpunkte (kein vollständiges Flurstücksverzeichnis)')}${spec.requireEnvelope?` · ${envelopes.length} ${tr('indexed bouwvlak candidates','geïndexeerde bouwvlakken','indexierte Baufenster-Kandidaten')}`:''}.${failed?` ${failed} ${tr('map checks failed; coverage incomplete.','kaartcontroles mislukt; onvolledig.','Kartenabfragen fehlgeschlagen; Abdeckung unvollständig.')}`:''}${shapeFailed?` ${shapeFailed} ${tr('bouwvlak outlines missing.','bouwvlakgrenzen ontbreken.','Baufenster-Umrisse fehlen.')}`:''}`;
      await checkDsoLeads(ticket,spec,status);rememberSearch(query,scope);updateResearchState();
      if(spec.requireEnvelope){const note=document.createElement('p');note.className='advanced-context-note';const updated=advanced.envelopeManifest?.sourceUpdated?.slice(0,10)||tr('date unknown','datum onbekend','Datum unbekannt'),total=advanced.envelopeManifest?.featureCount?.toLocaleString()||'?';note.textContent=tr(`PDOK Wro bouwvlak extract (${updated}): ${total} Limburg polygons in the source index. Broad searches use spatial samples. Matches are linked to their IMRO plan; check current Omgevingsplan rules in Omgevingsloket.`,`PDOK Wro-bouwvlakextract (${updated}): ${total} Limburgse polygonen in de bronindex. Brede zoekopdrachten gebruiken ruimtelijke steekproeven. Controleer het actuele omgevingsplan in het Omgevingsloket.`,`PDOK-Wro-Baufensterauszug (${updated}): ${total} Limburg-Polygone im Quellenindex. Große Suchgebiete nutzen räumliche Stichproben. Aktuelle Omgevingsplan-Regeln im Omgevingsloket prüfen.`);$('advanced-results').prepend(note);}
      if(advanced.results.length){const bounds=L.latLngBounds(advanced.results.map(r=>[r.point.lat,r.point.lng]));state.map.fitBounds(bounds.pad(.15),{maxZoom:15,padding:[46,46],animate:true});}
      if(spec.accommodationIntent==='accommodation'){const note=document.createElement('p');note.className='advanced-context-note';note.textContent=tr('A mapped campsite and recreation designation do not prove that tiny houses, new buildings or permanent residence are allowed. Open each linked plan and inspect use, building and accommodation rules. Current Omgevingsplan rules may supersede older Wro plans.','Een ingetekende camping of recreatiebestemming bewijst niet dat tiny houses, nieuwbouw of permanent wonen zijn toegestaan. Controleer per locatie de gekoppelde plan- en omgevingsplanregels.','Ein kartierter Campingplatz oder Erholungsgebiet beweist keine Zulässigkeit von Tiny Houses, Neubau oder Dauerwohnen. Die verlinkten Plan- und Omgevingsplan-Regeln je Ort prüfen.');$('advanced-results').prepend(note);}
      if(contextNeeds(spec)){const note=document.createElement('p');note.className='advanced-context-note';note.textContent=tr('Surroundings: PDOK TOP10NL and ProRail snapshot. Distances to mapped features are approximate. Quietness needs a separate noise check; verify legal rights in Omgevingsloket.','Omgeving: PDOK TOP10NL en ProRail. Afstanden tot kaartobjecten zijn bij benadering. Stilte vraagt een aparte geluidscontrole; controleer rechten in het Omgevingsloket.','Umgebung: PDOK TOP10NL und ProRail. Abstände zu Kartenobjekten sind Näherungen. Ruhe erfordert eine gesonderte Lärmprüfung; Baurecht im Omgevingsloket prüfen.');$('advanced-results').prepend(note);}
      if(advanced.results.length)status.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
    }catch(error){if(ticket!==advanced.ticket)return;console.warn('Spatial search failed',error);status.textContent=error.message==='Context feature limit reached'?tr('Too many mapped surroundings in this scope. Select one municipality or draw a smaller area.','Te veel kaartobjecten in dit gebied. Kies één gemeente of teken een kleiner gebied.','Zu viele Umgebungsobjekte in diesem Bereich. Eine Gemeinde wählen oder kleineres Gebiet markieren.'):tr('A required map or surroundings service is unavailable. No partial matches were claimed; retry or narrow the area.','Een vereiste kaartdienst is niet beschikbaar. Er worden geen onvolledige treffers geclaimd.','Ein benötigter Karten- oder Umgebungsdienst ist nicht erreichbar. Es werden keine unvollständigen Treffer behauptet.');advanced.results=[];advanced.overlay.clearLayers();advanced.markers?.clearLayers();$('advanced-results').innerHTML='';}
    finally{if(ticket===advanced.ticket){button.disabled=false;window.dispatchEvent(new CustomEvent('planview-search-busy',{detail:{busy:false}}));}}
  }
  Object.assign(advanced,{
    setOpen,setTab:setSearchTab,refreshBackendStatus,startDrawing,cancelDrawing:()=>{advanced.autoRunAfterDraw=false;exitDrawing();advanced.suppressClick=false;},
    cancel:()=>{advanced.ticket++;$('advanced-run').disabled=false;$('advanced-status').textContent=tr('Stopped. Any shown results are partial.','Gestopt. Getoonde resultaten zijn onvolledig.','Gestoppt. Angezeigte Ergebnisse sind unvollständig.');window.dispatchEvent(new CustomEvent('planview-search-busy',{detail:{busy:false}}));},
    runManual:spec=>runSearch(spec),
    filterResults:value=>{advanced.filter=['all','matches','review'].includes(value)?value:'all';if(advanced.lastSpec)showResults(advanced.lastSpec);},
    clearSearch:()=>{
      advanced.ticket++;advanced.results=[];advanced.filter='all';advanced.lastSpec=null;advanced.pending=null;advanced.interpretation=null;advanced.overlay?.clearLayers();advanced.markers?.clearLayers();advanced.hasSearched=false;
      if(advanced.preview){state.map.removeLayer(advanced.preview);advanced.preview=null;}
      if(advanced.drawing)exitDrawing();
      if(advanced.rectangle){state.map.removeLayer(advanced.rectangle);advanced.rectangle=null;}
      advanced.bounds=null;advanced.autoRunAfterDraw=false;advanced.suppressClick=false;
      $('advanced-query').value='';$('advanced-results').replaceChildren();$('advanced-parsed').hidden=true;
      $('advanced-clear-area').hidden=true;$('advanced-scope-select').querySelector('[value="drawn"]').disabled=true;$('advanced-scope-select').value='view';$('advanced-scope-label').textContent=tr('Current map view','Huidige kaartweergave','Aktueller Kartenausschnitt');
      $('advanced-run').disabled=false;$('advanced-run').textContent=tr('Find areas','Gebieden vinden','Gebiete finden');$('advanced-status').textContent=tr('Search and map results cleared.','Zoekopdracht en kaartresultaten gewist.','Suche und Kartenergebnisse gelöscht.');
      setSearchTab('request');$('pv-clear-search')?.setAttribute('disabled','');window.dispatchEvent(new CustomEvent('planview-search-results'));window.dispatchEvent(new CustomEvent('planview-search-busy',{detail:{busy:false}}));
    }
  });
  async function init(){
    initResearchPanel();
    window.addEventListener('planview-search-busy',event=>{advanced.busy=event.detail.busy;updateResearchState();});
    window.addEventListener('planview-search-results',updateResearchState);
    window.addEventListener('planview-language-change',()=>requestAnimationFrame(translateResearchPanel));
    advanced.overlay=L.layerGroup().addTo(state.map);advanced.markers=L.layerGroup().addTo(state.map);state.map.on('zoomend',renderMarkers);initDrawing();
    renderHistory($('advanced-history-view'));
    $('advanced-toggle').onclick=()=>setOpen(!advanced.open);$('advanced-close').onclick=()=>setOpen(false);$('advanced-draw').onclick=()=>startDrawing(false);
    $('advanced-scope-select').onchange=()=>{advanced.pending=null;$('advanced-run').textContent=tr('Find areas','Gebieden vinden','Gebiete finden');const scope=selectedScope($('advanced-query').value);$('advanced-scope-label').textContent=scope?.name||tr('Choose a municipality on the left','Kies links een gemeente','Links eine Gemeinde wählen');};
    $('advanced-clear-area').onclick=()=>{if(advanced.rectangle)state.map.removeLayer(advanced.rectangle);advanced.rectangle=null;advanced.bounds=null;$('advanced-clear-area').hidden=true;$('advanced-scope-select').querySelector('[value="drawn"]').disabled=true;$('advanced-scope-select').value='view';$('advanced-scope-label').textContent=tr('Current map view','Huidige kaartweergave','Aktueller Kartenausschnitt');};
    $('advanced-run').onclick=()=>runSearch();$('advanced-query').addEventListener('input',()=>{advanced.pending=null;$('advanced-run').textContent=tr('Find areas','Gebieden vinden','Gebiete finden');$('advanced-parsed').hidden=true;});$('advanced-query').addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter')runSearch();});
    document.querySelectorAll('[data-example]').forEach(b=>b.onclick=()=>{$('advanced-query').value=b.dataset.example;$('advanced-query').focus();});$('search').addEventListener('focus',()=>setOpen(false));document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(advanced.drawing)exitDrawing();setOpen(false);}});
    await refreshBackendStatus();
  }
  window.addEventListener('load',init);
})();
