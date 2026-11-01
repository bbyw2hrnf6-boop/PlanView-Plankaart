/* Shared, translated controls for manual criteria and interpreted parcel filters. */
(() => {
  const core=window.PlanViewSearchCore, labels={
    title:['Choose search criteria','Zoekcriteria kiezen','Suchkriterien auswählen'],
    planningNote:['Zoning and plan status apply at the sampled point. A parcel may contain several designations.','Bestemming en planstatus gelden op het steekproefpunt. Een perceel kan meerdere bestemmingen bevatten.','Nutzung und Planstatus gelten am Prüfpunkt. Ein Grundstück kann mehrere Festsetzungen enthalten.'],
    planning:['Planning and use','Plan en gebruik','Planung und Nutzung'],
    parcel:['Whole parcel','Hele perceel','Gesamtes Grundstück'],
    surroundings:['Distances to surroundings','Afstanden tot omgeving','Abstände zur Umgebung'],
    environment:['Environment: noise, slope, soil & groundwater','Milieu: geluid, helling, bodem & grondwater','Umwelt: Lärm, Hang, Boden & Grundwasser'],
    maxNoiseDb:['Modelled combined noise Lden ≤ dB','Gemodelleerd totaalgeluid Lden ≤ dB','Modellierter Gesamtpegel Lden ≤ dB'],
    maxSlopeDeg:['Maximum terrain slope ≤ °','Maximale terreinhelling ≤ °','Maximale Geländeneigung ≤ °'],
    minGroundwaterDepthCm:['High groundwater level (GHG) ≥ cm below ground','Hoge grondwaterstand (GHG) ≥ cm onder maaiveld','Hoher Grundwasserstand (GHG) ≥ cm unter Gelände'],
    soilClasses:['Mapped soil main class (BRO)','Gekarteerde bodemhoofdklasse (BRO)','Kartierte Bodenhauptklasse (BRO)'],
    soil_peat:['Peat soils (Veengronden)','Veengronden','Torfböden (Veengronden)'],
    soil_peaty:['Peaty soils (Moerige gronden)','Moerige gronden','Moorige Böden (Moerige gronden)'],
    soil_podzol:['Podzol soils','Podzolgronden','Podsolböden (Podzolgronden)'],
    soil_brik:['Brik soils','Brikgronden','Brikgronden'],
    soil_thick_earth:['Thick earth soils','Dikke eerdgronden','Dikke eerdgronden'],
    soil_sand:['Sand soils (Zandgronden)','Zandgronden','Sandböden (Zandgronden)'],
    soil_calcareous_silt:['Calcareous low-clay soils','Kalkhoudende bijzonder lutumarme gronden','Kalkhaltige tonarme Böden'],
    soil_unripe_mineral:['Unripe mineral soils','Niet-gerijpte minerale gronden','Unreife Mineralböden'],
    soil_marine_clay:['Marine clay soils','Zeekleigronden','Meereskleiböden'],
    soil_river_clay:['River clay soils','Rivierkleigronden','Flusskleiböden'],
    soil_old_river_clay:['Old river clay soils','Oude rivierkleigronden','Alte Flusskleiböden'],
    soil_old_clay:['Old clay soils','Oude kleigronden','Alte Kleiböden'],
    soil_loam:['Loam soils','Leemgronden','Lehmböden (Leemgronden)'],
    soil_old_limburg:['Old soils of South Limburg','Oude gronden in Zuid-Limburg','Alte Böden Südlimburgs'],
    environmentNote:['Modelled annual-average combined noise (Lden) and ground data at the sample point. AHN terrain slope requires the complete parcel (0.5 m terrain raster, maximum slope). Missing data stays unverified.','Gemodelleerd jaargemiddeld totaalgeluid (Lden) en bodem op het steekproefpunt. AHN-helling vereist het volledige perceel (0,5 m terreinraster, maximale helling). Ontbrekende gegevens blijven ongecontroleerd.','Modellierter Gesamtjahrespegel (Lden) und Bodendaten am Prüfpunkt. AHN-Neigung benötigt das vollständige Grundstück (0,5-m-Geländeraster, maximale Neigung). Fehlende Daten bleiben ungeprüft.'],
    groundwaterNote:['GHG is the average highest groundwater level, measured down from ground level; larger values mean deeper groundwater.','GHG is de gemiddeld hoogste grondwaterstand, gemeten onder maaiveld; hogere waarden betekenen dieper grondwater.','GHG bezeichnet den mittleren höchsten Grundwasserstand unter Gelände; größere Werte bedeuten tieferes Grundwasser.'],
    soilNote:['Choose any acceptable class. The 1:50,000 soil map gives regional guidance, not proof of parcel suitability, bearing capacity or absence of contamination.','Kies de aanvaardbare klassen. De bodemkaart 1:50.000 geeft regionale oriëntatie, geen bewijs van perceelgeschiktheid, draagkracht of afwezigheid van vervuiling.','Wähle alle passenden Bodenarten. Die Bodenkarte 1:50.000 dient zur regionalen Orientierung; sie belegt weder Grundstückseignung noch Tragfähigkeit oder Schadstofffreiheit.'],
    any:['Any','Alle','Alle'], group:['Zoning group','Bestemmingsgroep','Nutzungsgruppe'],
    excludeGroups:['Exclude zoning groups','Bestemmingsgroepen uitsluiten','Nutzungsgruppen ausschließen'],
    status:['Plan status','Planstatus','Planstatus'],
    vastgesteld:['Adopted','Vastgesteld','Beschlossen'], onherroepelijk:['Final','Onherroepelijk','Unanfechtbar'],
    envelope:['Bouwvlak at the test point','Bouwvlak op het punt','Baufenster am Prüfpunkt'],
    unbuilt:['No mapped building at the test point','Geen gebouw op het punt','Kein kartiertes Gebäude am Prüfpunkt'],
    parcelMinAreaM2:['Parcel area ≥ m²','Perceeloppervlakte ≥ m²','Grundstücksfläche ≥ m²'],
    parcelMaxAreaM2:['Parcel area ≤ m²','Perceeloppervlakte ≤ m²','Grundstücksfläche ≤ m²'],
    minEnvelopeAreaM2:['Bouwvlak overlap ≥ m²','Bouwvlak op perceel ≥ m²','Baufenster auf Grundstück ≥ m²'],
    minEnvelopePercent:['Bouwvlak overlap ≥ %','Bouwvlak op perceel ≥ %','Baufenster auf Grundstück ≥ %'],
    maxBuildingCoveragePercent:['BAG building coverage ≤ %','BAG-bebouwing op perceel ≤ %','BAG-Gebäudeanteil ≤ %'],
    minNaturaDistanceKm:['Distance from Natura 2000 (NL) ≥ km','Afstand tot Natura 2000 (NL) ≥ km','Abstand zu Natura 2000 (NL) ≥ km'],
    excludeNatura2000:['No Natura 2000 overlap (NL)','Geen overlap met Natura 2000 (NL)','Keine Überschneidung mit Natura 2000 (NL)'],
    parcelNote:['0% building coverage checks the whole parcel. Overlap areas are approximate; they do not establish building permission.','0% bebouwing controleert het hele perceel. Overlap is bij benadering en bewijst geen bouwrecht.','0 % Gebäudeanteil prüft das gesamte Grundstück. Überlappungsflächen sind Näherungen und belegen kein Baurecht.'],
    distancesNote:['Blank = no filter. Mapped objects in the Netherlands only. Distances are straight-line distances from the sampled point; Natura distance uses the parcel boundary.','Leeg = geen filter. Alleen Nederlandse kaartobjecten. Hemelsbreed vanaf het steekproefpunt; Natura-afstand vanaf de perceelgrens.','Leer = kein Filter. Nur Kartenobjekte in den Niederlanden. Luftlinie ab Prüfpunkt; Natura-Abstand ab Grundstücksgrenze.'],
    allNote:['Selected criteria are combined with AND. Searches sample locations; unknown checks remain visible.','Geselecteerde criteria gelden samen (EN). De zoekactie gebruikt steekproeven; onbekende controles blijven zichtbaar.','Ausgewählte Kriterien gelten gemeinsam (UND). Die Suche prüft Stichproben; offene Prüfungen bleiben sichtbar.'],
    hospital:['Hospital','Ziekenhuis','Krankenhaus'],allotments:['Allotment gardens','Volkstuinen','Kleingärten'],recreation_area:['Recreation area','Recreatiegebied','Erholungsgebiet'],
    camping:['Campsite / holiday park','Camping / vakantiepark','Camping- / Ferienpark'], town:['Town / village','Plaats / dorp','Ort / Dorf'],
    station:['Railway station','Treinstation','Bahnhof'], park:['Park','Park','Park'], sports:['Sports grounds','Sportterrein','Sportanlage'], cemetery:['Cemetery','Begraafplaats','Friedhof'], swimming_pool:['Swimming pool','Zwembad','Schwimmbad'], marina:['Marina','Jachthaven','Yachthafen'], industry:['Industrial land','Bedrijventerrein','Industriegebiet'],
    insideCamping:['Inside a mapped campsite','Binnen ingetekende camping','Innerhalb eines kartierten Campingplatzes'], nearbyHomes:['Residential buildings nearby (BAG)','Woningen nabij (BAG)','Wohngebäude im Umfeld (BAG)'], homeRadius:['Residential search radius (m)','Zoekstraal woningen (m)','Suchradius Wohngebäude (m)'],
    run:['Run manual search','Handmatig zoeken','Manuell suchen'],
    wohnen:['Residential','Wonen','Wohnen'],
    wonen:['Residential','Wonen','Wohnen'], woongebied:['Residential area','Woongebied','Wohngebiet'], gemengd:['Mixed use','Gemengd','Mischnutzung'], bedrijf:['Business','Bedrijf','Gewerbe'], bedrijventerrein:['Industrial estate','Bedrijventerrein','Industriegebiet'], centrum:['Centre','Centrum','Zentrum'], groen:['Green space','Groen','Grünfläche'], natuur:['Nature','Natuur','Natur'], water:['Water','Water','Wasser'], verkeer:['Transport','Verkeer','Verkehr'], maatschappelijk:['Community facilities','Maatschappelijk','Gemeinbedarf'], agrarisch:['Agriculture','Agrarisch','Landwirtschaft'], bos:['Forest','Bos','Wald'], kantoor:['Office','Kantoor','Büro'], detailhandel:['Retail','Detailhandel','Einzelhandel'], horeca:['Hospitality','Horeca','Gastronomie'], recreatie:['Recreation','Recreatie','Erholung']
  };
  const groups=['wonen','woongebied','gemengd','bedrijf','bedrijventerrein','centrum','groen','natuur','water','verkeer','maatschappelijk','agrarisch','bos','kantoor','detailhandel','horeca','recreatie'];
  const siteFields=['parcelMinAreaM2','parcelMaxAreaM2','minEnvelopeAreaM2','minEnvelopePercent','maxBuildingCoveragePercent','minNaturaDistanceKm'];
  const environmentFields=['maxNoiseDb','maxSlopeDeg','minGroundwaterDepthCm'];
  const text=key=>labels[key]?.[({nl:1,de:2}[document.documentElement.lang]||0)]||key;
  const label=key=>`<span data-criteria-label="${key}">${text(key)}</span>`;
  const number=(key,value='',attr='')=>`<label>${label(key)}<input type="number" min="0" ${/Percent$/.test(key)?'max="100" step="any"':key==='minNaturaDistanceKm'?'max="50" step="any"':'step="any"'} data-site-criterion="${key}" value="${value??''}" placeholder="—" ${attr}></label>`;
  function siteMarkup(criteria={},activeOnly=false){
    return `<div class="pv-criteria-grid pv-site-criteria">${siteFields.filter(key=>!activeOnly||criteria[key]!=null).map(key=>number(key,criteria[key])).join('')}${!activeOnly||criteria.excludeNatura2000?`<label class="pv-check pv-criteria-wide"><input type="checkbox" data-site-criterion="excludeNatura2000" ${criteria.excludeNatura2000?'checked':''}>${label('excludeNatura2000')}</label>`:''}</div>`;
  }
  function readSite(root){const value=core.emptySiteCriteria();for(const input of root.querySelectorAll('[data-site-criterion]'))value[input.dataset.siteCriterion]=input.type==='checkbox'?input.checked:input.value===''?null:Number(input.value);return value;}
  function environmentMarkup(criteria={},activeOnly=false){
    const limits={maxNoiseDb:140,maxSlopeDeg:90,minGroundwaterDepthCm:10000};
    return `<div class="pv-criteria-grid pv-environment-criteria">${environmentFields.filter(key=>!activeOnly||criteria[key]!=null).map(key=>`<label>${label(key)}<input type="number" min="0" max="${limits[key]}" step="any" data-environment-criterion="${key}" value="${criteria[key]??''}" placeholder="—"></label>`).join('')}${!activeOnly||criteria.soilClasses?.length?`<fieldset class="pv-criteria-wide pv-soil-criteria"><legend>${label('soilClasses')}</legend>${core.soilClasses.map(key=>`<label class="pv-check"><input type="checkbox" data-environment-soil="${key}" ${criteria.soilClasses?.includes(key)?'checked':''}>${label('soil_'+key)}</label>`).join('')}<p class="pv-small-note">${label('soilNote')}</p></fieldset>`:''}</div>${!activeOnly||criteria.minGroundwaterDepthCm!=null?`<p class="pv-small-note">${label('groundwaterNote')}</p>`:''}<p class="pv-small-note">${label('environmentNote')}</p>`;
  }
  function readEnvironment(root){const value=core.emptyEnvironmentCriteria();for(const input of root.querySelectorAll('[data-environment-criterion]'))value[input.dataset.environmentCriterion]=input.value===''?null:Number(input.value);value.soilClasses=[...root.querySelectorAll('[data-environment-soil]:checked')].map(input=>input.dataset.environmentSoil);return value;}
  function translate(root=document){for(const node of root.querySelectorAll('[data-criteria-label]'))node.textContent=text(node.dataset.criteriaLabel);}
  function mount(before,run){
    const manual=document.createElement('details');manual.id='pv-manual';manual.className='pv-manual';manual.dataset.pvManaged='';
    const opts=groups.map(key=>`<option value="${key}" data-criteria-label="${key}">${text(key)}</option>`).join('');
    manual.innerHTML=`<summary>${label('title')}</summary><p class="pv-small-note">${label('allNote')}</p><details open class="pv-criteria-section"><summary>${label('planning')}</summary><p class="pv-small-note">${label('planningNote')}</p><div class="pv-criteria-grid"><label>${label('group')}<select id="pv-group"><option value="" data-criteria-label="any">${text('any')}</option>${opts}</select></label><label>${label('status')}<select id="pv-plan-status"><option value="" data-criteria-label="any">${text('any')}</option>${['vastgesteld','onherroepelijk'].map(k=>`<option value="${k}" data-criteria-label="${k}">${text(k)}</option>`).join('')}</select></label><label class="pv-check pv-criteria-wide"><input id="pv-envelope" type="checkbox">${label('envelope')}</label><label class="pv-check pv-criteria-wide"><input id="pv-unbuilt" type="checkbox">${label('unbuilt')}</label></div><details class="pv-exclude-groups"><summary>${label('excludeGroups')}</summary><div class="pv-criteria-grid">${groups.map(k=>`<label class="pv-check"><input type="checkbox" data-exclude-group="${k}">${label(k)}</label>`).join('')}</div></details></details><details open class="pv-criteria-section"><summary>${label('parcel')}</summary>${siteMarkup()}<p class="pv-small-note">${label('parcelNote')}</p></details><details class="pv-criteria-section pv-environment-section"><summary>${label('environment')}</summary>${environmentMarkup()}</details><details class="pv-criteria-section"><summary>${label('surroundings')}</summary><p class="pv-small-note">${label('distancesNote')}</p><div class="pv-manual-distances">${core.kinds.map(k=>`<fieldset class="pv-distance-range"><legend>${label(k)}</legend>${['minKm','maxKm'].map(b=>`<label>${b==='minKm'?'≥':'≤'} <input type="number" min="0" max="50" step="any" data-manual-distance="${k}" data-bound="${b}" placeholder="—"> km</label>`).join('')}</fieldset>`).join('')}</div><label class="pv-check"><input id="pv-inside-camping" type="checkbox">${label('insideCamping')}</label><label class="pv-check"><input id="pv-nearby-homes" type="checkbox">${label('nearbyHomes')}</label><label>${label('homeRadius')}<input id="pv-home-radius" type="number" min="50" max="1000" step="any" value="250"></label></details><p id="pv-manual-error" role="alert" class="advanced-warning" hidden></p><button type="button" id="pv-run-manual" class="pv-button primary">${label('run')}</button>`;
    before.before(manual);
    manual.querySelector('#pv-run-manual').onclick=()=>{
      if([...manual.querySelectorAll('input')].some(el=>!el.reportValidity()))return;
      const distanceRules=core.emptyRules();for(const el of manual.querySelectorAll('[data-manual-distance]'))distanceRules[el.dataset.manualDistance][el.dataset.bound]=el.value===''?null:Number(el.value);
      const siteCriteria=readSite(manual),environmentCriteria=readEnvironment(manual),errors=[...core.siteCriteriaErrors(siteCriteria),...core.environmentCriteriaErrors(environmentCriteria)];
      for(const [kind,rule] of Object.entries(distanceRules))if(rule.minKm!=null&&rule.maxKm!=null&&rule.minKm>rule.maxKm)errors.push(`${text(kind)}: ≥ must not exceed ≤.`);
      const selected=manual.querySelector('#pv-group').value,excludeGroups=[...manual.querySelectorAll('[data-exclude-group]:checked')].map(el=>el.dataset.excludeGroup);
      if(selected&&excludeGroups.includes(selected))errors.push(text('group')+': '+text(selected)+' + '+text('excludeGroups'));
      const error=manual.querySelector('#pv-manual-error');error.hidden=!errors.length;error.textContent=errors.join(' ');if(errors.length)return;
      const active=k=>distanceRules[k].minKm!=null||distanceRules[k].maxKm!=null,inside=manual.querySelector('#pv-inside-camping').checked;
      if(inside&&active('camping')){error.hidden=false;error.textContent=({de:'Camping-Abstände und „innerhalb“ bitte getrennt verwenden.',nl:'Gebruik campingafstanden en “binnen” afzonderlijk.'}[document.documentElement.lang]||'Use campsite distances and “inside” separately.');return;}
      const planStatus=manual.querySelector('#pv-plan-status').value;
      run({groups:selected?[selected]:[],excludeGroups,statuses:planStatus?[planStatus]:[],excludeStatuses:[],siteCriteria,environmentCriteria,distanceRules,requireEnvelope:manual.querySelector('#pv-envelope').checked,requireUnbuilt:manual.querySelector('#pv-unbuilt').checked,nearCamping:active('camping'),insideCamping:inside,nearTown:active('town'),nearFeatures:core.kinds.filter(k=>!['camping','town','industry'].includes(k)&&active(k)),avoidIndustry:active('industry'),nearbyHomes:manual.querySelector('#pv-nearby-homes').checked,homeRadiusM:Number(manual.querySelector('#pv-home-radius').value),includeReviewLeads:false,unsupported:[],explanation:text('allNote')});
    };
    return manual;
  }

  function writeSpec(spec={},root=document.getElementById('pv-manual')){
    if(!root)return;root._criteriaBase=structuredClone(spec);
    const set=(selector,value)=>{const el=root.querySelector(selector);if(!el)return;if(['#pv-group','#pv-plan-status'].includes(selector)&&value&&el.options&&![...el.options].some(option=>option.value===value)){const option=document.createElement('option');option.value=value;option.textContent=text(value);el.append(option);}el.type==='checkbox'?el.checked=!!value:el.value=value??'';};
    set('#pv-group',spec.groups?.[0]||'');set('#pv-plan-status',spec.statuses?.[0]||'');
    for(const key of siteFields)set(`[data-site-criterion="${key}"]`,spec.siteCriteria?.[key]);set('[data-site-criterion="excludeNatura2000"]',spec.siteCriteria?.excludeNatura2000);
    for(const key of environmentFields)set(`[data-environment-criterion="${key}"]`,spec.environmentCriteria?.[key]);
    root.querySelectorAll('[data-environment-soil]').forEach(el=>el.checked=spec.environmentCriteria?.soilClasses?.includes(el.dataset.environmentSoil)||false);
    root.querySelectorAll('[data-exclude-group]').forEach(el=>el.checked=spec.excludeGroups?.includes(el.dataset.excludeGroup)||false);
    root.querySelectorAll('[data-manual-distance]').forEach(el=>el.value=spec.distanceRules?.[el.dataset.manualDistance]?.[el.dataset.bound]??'');
    for(const [id,key] of [['pv-envelope','requireEnvelope'],['pv-unbuilt','requireUnbuilt'],['pv-inside-camping','insideCamping'],['pv-nearby-homes','nearbyHomes']])set('#'+id,spec[key]);set('#pv-home-radius',spec.homeRadiusM||250);
  }
  function readSpec(root=document.getElementById('pv-manual')){
    const base=root._criteriaBase||{},value=structuredClone(base),distanceRules=core.emptyRules();
    for(const el of root.querySelectorAll('[data-manual-distance]'))distanceRules[el.dataset.manualDistance][el.dataset.bound]=el.value===''?null:Number(el.value);
    const active=k=>distanceRules[k].minKm!=null||distanceRules[k].maxKm!=null,keep=k=>active(k)||base.distanceRules?.[k]?.minKm==null&&base.distanceRules?.[k]?.maxKm==null;
    const group=root.querySelector('#pv-group').value,status=root.querySelector('#pv-plan-status').value;
    Object.assign(value,{groups:group===(base.groups?.[0]||'')?(base.groups||[]):group?[group]:[],statuses:status===(base.statuses?.[0]||'')?(base.statuses||[]):status?[status]:[],excludeGroups:[...root.querySelectorAll('[data-exclude-group]:checked')].map(el=>el.dataset.excludeGroup),excludeStatuses:base.excludeStatuses||[],siteCriteria:readSite(root),environmentCriteria:readEnvironment(root),distanceRules,requireEnvelope:root.querySelector('#pv-envelope').checked,requireUnbuilt:root.querySelector('#pv-unbuilt').checked,insideCamping:root.querySelector('#pv-inside-camping').checked,nearCamping:active('camping')||!!base.nearCamping&&keep('camping'),nearTown:active('town')||!!base.nearTown&&keep('town'),nearFeatures:[...new Set([...(base.nearFeatures||[]).filter(keep),...core.kinds.filter(k=>!['camping','town','industry'].includes(k)&&active(k))])],avoidIndustry:active('industry')||!!base.avoidIndustry&&keep('industry'),nearbyHomes:root.querySelector('#pv-nearby-homes').checked,homeRadiusM:Number(root.querySelector('#pv-home-radius').value),unsupported:base.unsupported||[]});
    // The editor now owns each explicit filter. Keep review behaviour, but do not
    // regenerate removed filters from the interpreter's building-land shortcut.
    value.includeReviewLeads=!!(base.includeReviewLeads||base.potentialBuildingLand);value.potentialBuildingLand=false;
    return value;
  }

  // The modal edits copies of the canonical controls. Applying commits their values
  // together, so existing interpretation and manual-search schemas stay identical.
  function pickerCatalog(){
    const item=(id,category,key,selectors,note)=>({id,category,key,selectors,note});
    return [
      item('group','planning','group',['#pv-group'],'planningNote'),
      item('excludeGroups','planning','excludeGroups',['.pv-exclude-groups .pv-criteria-grid'],'planningNote'),
      item('status','planning','status',['#pv-plan-status'],'planningNote'),
      item('envelope','planning','envelope',['#pv-envelope'],'planningNote'),
      item('unbuilt','planning','unbuilt',['#pv-unbuilt'],'planningNote'),
      ...siteFields.map(key=>item(key,'parcel',key,[`[data-site-criterion="${key}"]`],'parcelNote')),
      item('excludeNatura2000','parcel','excludeNatura2000',['[data-site-criterion="excludeNatura2000"]'],'parcelNote'),
      ...environmentFields.map(key=>item(key,'environment',key,[`[data-environment-criterion="${key}"]`],key==='minGroundwaterDepthCm'?'groundwaterNote':'environmentNote')),
      item('soilClasses','environment','soilClasses',['.pv-soil-criteria'],'soilNote'),
      ...core.kinds.map(key=>item('distance:'+key,'surroundings',key,[`[data-manual-distance="${key}"]`],'distancesNote')),
      item('insideCamping','surroundings','insideCamping',['#pv-inside-camping'],'distancesNote'),
      item('nearbyHomes','surroundings','nearbyHomes',['#pv-nearby-homes','#pv-home-radius'],'planningNote')
    ];
  }
  let picker=null,pickerCategory='all',pickerEntry=null,pickerSources=[],pickerAlternatives=null;
  const pickerTr=(en,nl,de)=>({nl,de}[document.documentElement.lang]||en);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function entryForRow(rowId){
    const [section,key]=String(rowId||'').split(':');
    return ({group:'group',excludeGroup:'excludeGroups',status:'status'}[section])||({requireEnvelope:'envelope',requireUnbuilt:'unbuilt',insideCamping:'insideCamping',nearbyHomes:'nearbyHomes'}[key])||(section==='distance'?'distance:'+key:key);
  }
  function openInvalid(input){
    const d=input.dataset,row=d.siteCriterion?'site:'+d.siteCriterion:d.environmentCriterion?'environment:'+d.environmentCriterion:d.manualDistance?'distance:'+d.manualDistance:input.id==='pv-home-radius'?'flag:nearbyHomes':null;
    openPicker(row);requestAnimationFrame(()=>pickerSources.find(([,copy])=>!copy.checkValidity())?.[1].reportValidity());
  }
  function openPicker(rowId){
    if(!picker){
      picker=document.createElement('dialog');picker.id='pv-criteria-picker';picker.className='pv-criteria-picker';picker.dataset.pvManaged='';picker.setAttribute('aria-labelledby','pv-picker-title');
      picker.innerHTML='<header><div><span class="pv-picker-eyebrow">PLANVIEW</span><h2 id="pv-picker-title"></h2></div><button type="button" data-picker-close>×</button></header><div id="pv-picker-browser"><label class="pv-picker-search"><span id="pv-picker-search-label"></span><input type="search" id="pv-picker-query" autocomplete="off"></label><div id="pv-picker-categories" aria-label="Categories"></div><p id="pv-picker-hint"></p><div id="pv-picker-list"></div></div><form id="pv-picker-editor" hidden><button type="button" id="pv-picker-back"></button><h3 id="pv-picker-editor-title"></h3><p id="pv-picker-note"></p><div id="pv-picker-fields"></div><p id="pv-picker-error" role="alert" hidden></p><footer><button type="button" data-picker-close id="pv-picker-cancel"></button><button type="submit" id="pv-picker-apply"></button></footer></form>';
      document.body.append(picker);picker.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});
      picker.querySelectorAll('[data-picker-close]').forEach(button=>button.onclick=()=>picker.close());
      picker.querySelector('#pv-picker-query').oninput=renderPickerList;
      picker.querySelector('#pv-picker-back').onclick=()=>{pickerEntry=null;renderPickerList();picker.querySelector('#pv-picker-query').focus();};
      picker.querySelector('#pv-picker-editor').onsubmit=event=>{event.preventDefault();applyPicker();};
      picker.addEventListener('click',event=>{if(event.target===picker){const r=picker.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)picker.close();}});
    }
    pickerCategory='all';pickerEntry=null;picker.querySelector('#pv-picker-query').value='';
    picker.querySelector('#pv-picker-title').textContent=pickerTr('Choose a criterion','Kies een criterium','Kriterium auswählen');
    picker.querySelector('[data-picker-close]').setAttribute('aria-label',pickerTr('Close criteria','Criteria sluiten','Kriterien schließen'));
    picker.querySelector('#pv-picker-search-label').textContent=pickerTr('Search criteria','Zoek criteria','Kriterien durchsuchen');
    picker.querySelector('#pv-picker-query').placeholder=pickerTr('e.g. noise, parcel, station…','bijv. geluid, perceel, station…','z. B. Lärm, Grundstück, Bahnhof…');
    picker.querySelector('#pv-picker-hint').textContent=text('allNote');
    picker.querySelector('#pv-picker-back').textContent='← '+pickerTr('All criteria','Alle criteria','Alle Kriterien');
    picker.querySelector('#pv-picker-cancel').textContent=pickerTr('Cancel','Annuleren','Abbrechen');
    picker.querySelector('#pv-picker-apply').textContent=pickerTr('Apply criterion','Criterium toepassen','Kriterium übernehmen');
    renderPickerList();picker.showModal();
    const entry=pickerCatalog().find(e=>e.id===entryForRow(rowId));
    if(entry)editPicker(entry);else picker.querySelector('#pv-picker-query').focus();
  }
  function renderPickerList(){
    const categories=['all','planning','parcel','environment','surroundings'],q=picker.querySelector('#pv-picker-query').value.toLocaleLowerCase().trim();
    picker.querySelector('#pv-picker-browser').hidden=!!pickerEntry;picker.querySelector('#pv-picker-editor').hidden=!pickerEntry;
    const cats=picker.querySelector('#pv-picker-categories');cats.innerHTML=categories.map(key=>`<button type="button" data-category="${key}" aria-pressed="${key===pickerCategory}">${escape(key==='all'?text('any'):text(key).split(':')[0])}</button>`).join('');
    cats.querySelectorAll('button').forEach(button=>button.onclick=()=>{pickerCategory=button.dataset.category;renderPickerList();picker.querySelector(`[data-category="${pickerCategory}"]`).focus();});
    const entries=pickerCatalog().filter(e=>(pickerCategory==='all'||pickerCategory===e.category)&&(!q||[text(e.key),text(e.category),...(labels[e.key]||[]),e.id].join(' ').toLocaleLowerCase().includes(q)));
    const list=picker.querySelector('#pv-picker-list');list.innerHTML=entries.length?entries.map(e=>`<button type="button" data-picker-entry="${e.id}"><span><strong>${escape(text(e.key))}</strong><small>${escape(text(e.category).split(':')[0])}</small></span><span aria-hidden="true">＋</span></button>`).join(''):`<p class="pv-picker-empty">${escape(pickerTr('No matching criterion. Try “soil”, “station” or another term.','Geen criterium gevonden. Probeer “bodem”, “station” of een andere term.','Kein passendes Kriterium. Versuche „Boden“, „Bahnhof“ oder einen anderen Begriff.'))}</p>`;
    list.querySelectorAll('button').forEach(button=>button.onclick=()=>editPicker(entries.find(e=>e.id===button.dataset.pickerEntry)));
  }
  function editPicker(entry){
    pickerEntry=entry;renderPickerList();const root=document.getElementById('pv-manual'),fields=picker.querySelector('#pv-picker-fields');fields.replaceChildren();pickerSources=[];pickerAlternatives=null;
    picker.querySelector('#pv-picker-editor-title').textContent=text(entry.key);picker.querySelector('#pv-picker-note').textContent=text(entry.note);picker.querySelector('#pv-picker-error').hidden=true;
    if(['group','status'].includes(entry.id)){
      const field=entry.id==='group'?'groups':'statuses',current=readSpec(root)[field]||[],choices=[...new Set([...(field==='groups'?groups:['vastgesteld','onherroepelijk']),...current])];
      pickerAlternatives={field};
      picker.querySelector('#pv-picker-note').textContent=text(entry.note)+' '+pickerTr('Choose all acceptable alternatives. A site may match any checked option in this field; other criteria still apply together. No selection means no filter.','Kies alle aanvaardbare alternatieven. Eén aangevinkte optie binnen dit veld is voldoende; andere criteria gelden samen. Geen selectie betekent geen filter.','Wähle alle zulässigen Alternativen. Eine angekreuzte Option in diesem Feld genügt; die übrigen Kriterien gelten weiterhin gemeinsam. Keine Auswahl bedeutet keinen Filter.');
      fields.innerHTML='<div class="pv-criteria-grid">'+choices.map(value=>`<label class="pv-check"><input type="checkbox" data-picker-alternative="${escape(value)}" ${current.includes(value)?'checked':''}><span>${escape(text(value))}</span></label>`).join('')+'</div>';
      picker.querySelector('#pv-picker-editor').hidden=false;fields.querySelector('input')?.focus();return;
    }
    for(const selector of entry.selectors){
      let source=root.querySelector(selector);if(!source)continue;
      if(source.matches('input,select'))source=source.closest(entry.id.startsWith('distance:')?'fieldset':'label');
      const clone=source.cloneNode(true),originalControls=[...source.querySelectorAll('input,select')],clonedControls=[...clone.querySelectorAll('input,select')];
      originalControls.forEach((input,i)=>{const copy=clonedControls[i];copy.value=input.value;copy.checked=input.checked;if(copy.id)copy.id+='-picker';pickerSources.push([input,copy]);});
      clone.querySelectorAll('[id]').forEach(el=>{if(!el.matches('input,select'))el.removeAttribute('id');});fields.append(clone);
    }
    picker.querySelector('#pv-picker-editor').hidden=false;fields.querySelector('input,select')?.focus();
  }
  function setAlternatives(field,values,root=document.getElementById('pv-manual')){
    if(!['groups','statuses'].includes(field)||!root)return;
    const alternatives=[...new Set(values.map(String))],select=root.querySelector(field==='groups'?'#pv-group':'#pv-plan-status');
    root._criteriaBase={...(root._criteriaBase||{}),[field]:alternatives};
    // Imported profiles may contain a status beyond the two default choices.
    // Keep that explicit option representable in the canonical backing form.
    if(alternatives[0]&&select.options&&![...select.options].some(option=>option.value===alternatives[0])){const option=document.createElement('option');option.value=alternatives[0];option.textContent=text(alternatives[0]);select.append(option);}
    select.value=alternatives[0]||'';
  }
  function applyPicker(){
    const error=picker.querySelector('#pv-picker-error'),invalid=pickerSources.find(([,copy])=>!copy.checkValidity());if(invalid){invalid[1].reportValidity();return;}
    const numbers=pickerSources.filter(([,copy])=>copy.type==='number'&&copy.value!=='').map(([,copy])=>Number(copy.value));
    if(pickerEntry.id.startsWith('distance:')&&numbers.length===2&&numbers[0]>numbers[1]){error.hidden=false;error.textContent=pickerTr('Minimum must not exceed maximum.','Minimum mag niet hoger zijn dan maximum.','Mindestwert darf den Höchstwert nicht überschreiten.');return;}
    if(pickerAlternatives)setAlternatives(pickerAlternatives.field,[...picker.querySelectorAll('[data-picker-alternative]:checked')].map(input=>input.dataset.pickerAlternative));
    for(const [input,copy] of pickerSources){input.value=copy.value;input.checked=copy.checked;}
    document.getElementById('pv-manual').dispatchEvent(new Event('input',{bubbles:true}));picker.close();
  }

  window.PlanViewCriteriaUI={openPicker,openInvalid,pickerCatalog,entryForRow,setAlternatives,writeSpec,readSpec,mount,translate,siteMarkup,readSite,environmentMarkup,readEnvironment,text,siteFields,environmentFields};
})();
