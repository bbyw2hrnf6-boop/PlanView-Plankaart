/* Desktop journeys compose the existing search, map and official evidence adapters. */
(() => {
  const $=id=>document.getElementById(id),media=matchMedia('(min-width:901px)'),core=window.PlanViewJourneyCore;
  const tr=(en,nl,de)=>({nl,de}[document.documentElement.lang]||en),safe=value=>esc(String(value??''));
  const label=key=>({quiet:tr('Quietness preference','Rustvoorkeur','Ruhe gewünscht'),accommodation:tr('Accommodation permission','Verblijfsrecht','Unterkunft zulässig')}[key]||window.PlanViewCriteriaUI.text(key));
  const shortLabel=key=>({groups:tr('Zoning','Bestemming','Nutzung'),excludeGroups:tr('Excluded zoning','Uitgesloten bestemming','Ausgeschlossene Nutzung'),statuses:tr('Plan status','Planstatus','Planstatus'),excludeStatuses:tr('Excluded status','Uitgesloten status','Ausgeschlossener Status')}[key]||label(key)).replace(/\s*[≥≤].*$/,'');
  const ui={draft:null,dirty:false,mode:'find',scopeLayer:null,selected:-1,ready:false};
  const enabled=()=>media.matches;
  const dependencies={labels:shortLabel,parcel:window.PlanViewParcelScreen,environment:window.PlanViewEnvironmentScreen};
  function describe(spec=ui.draft){return core.describe(spec||{},shortLabel);}
  function displayValue(row,value=row.value){
    if(value==null&&row.key==='unsupported')return tr('Separate review','Apart controleren','Gesondert prüfen');
    if(value==null)return tr('Data missing','Gegevens ontbreken','Daten fehlen');
    if(row.key==='soilClasses')return value.map(v=>label('soil_'+v)).join(' / ');
    if(Array.isArray(value))return value.map(label).join(' / ');
    if(typeof value==='boolean')return value?tr('Yes','Ja','Ja'):tr('No','Nee','Nein');
    return typeof value==='number'?`${value===row.actual&&row.status==='unknown'&&row.key==='maxSlopeDeg'?'≥ ':''}${core.fmt(value,document.documentElement.lang)} ${row.unit}${value===row.actual&&row.status==='unknown'?' · '+tr('unverified','ongecontroleerd','ungeprüft'):''}`.trim():label(value);
  }
  function setDraft(spec){ui.draft=structuredClone(spec);window.PlanViewCriteriaUI.writeSpec(ui.draft);renderCriteria();}
  function renderCriteria(){
    if(!ui.ready)return;const rows=describe(),box=$('journey-criteria');
    box.innerHTML=rows.length?rows.map(row=>`<div class="journey-criterion" data-criterion-row="${safe(row.id)}"><span class="journey-criterion-icon" aria-hidden="true">${row.scope==='parcel'?'▱':'◉'}</span><span class="journey-criterion-label">${safe(row.label)}${row.operator?` <small>${safe(row.operator)}</small>`:''}</span>${typeof row.value==='number'?`<label class="journey-value"><span class="sr-only">${safe(row.label)}</span><input type="number" min="0" step="any" value="${row.value}" data-criterion-value="${safe(row.id)}"><span>${safe(row.unit)}</span></label>`:`<span class="journey-criterion-value">${safe(displayValue(row))}</span>`}<button type="button" class="journey-remove" data-criterion-remove="${safe(row.id)}" aria-label="${safe(tr('Remove criterion: ','Criterium verwijderen: ','Kriterium entfernen: ')+row.label)}">×</button></div>`).join(''):`<div class="journey-empty-criteria">${safe(tr('Describe your site above or add your first criterion.','Beschrijf je locatie hierboven of voeg een criterium toe.','Beschreibe deine Fläche oben oder füge dein erstes Kriterium hinzu.'))}</div>`;
    box.querySelectorAll('[data-criterion-remove]').forEach(button=>button.onclick=()=>{setDraft(core.remove(ui.draft,button.dataset.criterionRemove));ui.dirty=false;sync();});
    box.querySelectorAll('[data-criterion-value]').forEach(input=>{input.oninput=()=>{if(input.value===''||!input.checkValidity())return;const [section,key,bound]=input.dataset.criterionValue.split(':');if(section==='site')ui.draft.siteCriteria[key]=Number(input.value);else if(section==='environment')ui.draft.environmentCriteria[key]=Number(input.value);else if(section==='distance')ui.draft.distanceRules[key][bound]=Number(input.value);window.PlanViewCriteriaUI.writeSpec(ui.draft);ui.dirty=false;sync();};input.onchange=()=>{
      const [section,key,bound]=input.dataset.criterionValue.split(':');if(input.value===''){setDraft(core.remove(ui.draft,input.dataset.criterionValue));sync();return;}
      if(!input.reportValidity())return;const value=Number(input.value);if(section==='site')ui.draft.siteCriteria[key]=value;else if(section==='environment')ui.draft.environmentCriteria[key]=value;else if(section==='distance')ui.draft.distanceRules[key][bound]=value;
      window.PlanViewCriteriaUI.writeSpec(ui.draft);ui.dirty=false;sync();
    };});
    $('journey-count').textContent=String(rows.length);$('advanced-panel').dataset.hasCriteria=String(rows.length>0);summaryChips();
  }
  function summaryChips(){
    const target=$('journey-active-search');if(!target)return;const spec=window.planviewAdvanced.lastSpec,rows=core.describe(spec||{},shortLabel);
    target.innerHTML=`<button type="button" data-edit-criteria>${safe(window.planviewAdvanced.lastScopeName||$('advanced-scope-label').textContent)}</button>${rows.slice(0,4).map(row=>`<span>${safe(row.label)} ${safe(row.operator)} ${safe(displayValue(row))}</span>`).join('')}<button type="button" data-edit-criteria>${safe(tr('Edit criteria','Criteria wijzigen','Kriterien ändern'))} ↗</button>`;
    target.querySelectorAll('[data-edit-criteria]').forEach(button=>button.onclick=()=>window.planviewAdvanced.setTab('request'));
  }
  function syncScope(){
    if(!ui.ready||!enabled())return;
    const a=window.planviewAdvanced,scope=a.getScope?.();
    $('journey-scope-name').textContent=scope?.name||tr('Choose your search area','Kies je zoekgebied','Suchgebiet wählen');
    $('journey-scope-picker').value=$('advanced-scope-select').value;for(const option of $('journey-scope-picker').options){const original=$('advanced-scope-select').querySelector(`[value="${option.value}"]`);if(original)option.disabled=original.disabled;}if(a.rectangle)a.rectangle.setStyle({opacity:$('advanced-scope-select').value==='drawn'?1:0,fillOpacity:$('advanced-scope-select').value==='drawn'?.1:0});
    if(ui.scopeLayer){state.map.removeLayer(ui.scopeLayer);ui.scopeLayer=null;}
    if(!a.open||a.drawing||a.bounds&&$('advanced-scope-select').value==='drawn'||scope?.error)return;
    const municipality=state.region?.municipalities?.find(m=>m.code===state.municipality),shape=municipality?.geometry;
    if($('advanced-scope-select').value==='municipality'&&shape)ui.scopeLayer=L.geoJSON(shape,{interactive:false,style:{color:'#167970',weight:2,dashArray:'8 6',fillColor:'#167970',fillOpacity:.045}}).addTo(state.map);
    else if(scope?.bounds)ui.scopeLayer=L.rectangle(scope.bounds,{interactive:false,color:'#167970',weight:2,dashArray:'8 6',fillOpacity:.035}).addTo(state.map);
  }
  function sync(){
    if(!ui.ready)return;const a=window.planviewAdvanced;
    document.body.classList.toggle('journey-desktop',enabled());document.body.dataset.journeyMode=ui.mode;if(ui.lastTab!==a.activeTab){$('advanced-panel').scrollTop=0;ui.lastTab=a.activeTab;}
    $('journey-nav-find').textContent=tr('Find sites','Flächen zoeken','Flächen finden');$('journey-nav-inspect').textContent=tr('Check an address','Adres controleren','Adresse prüfen');$('journey-nav-saved').textContent=tr('Saved sites','Bewaarde locaties','Merkliste');
    const view=window.planviewUI.view;
    $('journey-nav-find').setAttribute('aria-pressed',String(a.open));$('journey-nav-inspect').setAttribute('aria-pressed',String(!a.open&&!['cases','compare'].includes(view)));$('journey-nav-saved').setAttribute('aria-pressed',String(['cases','compare'].includes(view)));
    $('journey-eyebrow').textContent=tr('PLANVIEW / SITE SEARCH','PLANVIEW / LOCATIES ZOEKEN','PLANVIEW / FLÄCHENSUCHE');$('journey-title').textContent=tr('Find suitable sites','Passende locaties vinden','Passende Flächen finden');
    $('journey-step-area').textContent=tr('1  Choose area','1  Gebied kiezen','1  Gebiet wählen');$('journey-step-criteria').textContent=tr('2  Check criteria','2  Criteria controleren','2  Kriterien prüfen');$('journey-step-run').textContent=tr('3  Search sites','3  Locaties zoeken','3  Flächen suchen');
    $('journey-description-label').textContent=tr('Describe your search (optional)','Beschrijf je zoekopdracht (optioneel)','Suche beschreiben (optional)');if(enabled())$('advanced-query').setAttribute('aria-label',$('journey-description-label').textContent);
    $('journey-criteria-title').textContent=tr('Your criteria','Je criteria','Deine Kriterien');$('journey-add-criterion').textContent=tr('+ Add criterion','+ Criterium toevoegen','+ Kriterium hinzufügen');
    $('journey-change-area').textContent=tr('Change on map','Wijzigen op kaart','Auf Karte ändern');
    const query=$('advanced-query').value.trim(),prepared=describe().length>0;
    const runLabel=a.busy?tr('Checking…','Controleren…','Wird geprüft…'):query&&ui.dirty?tr('Review criteria →','Criteria controleren →','Kriterien prüfen →'):prepared?tr('Search sites →','Flächen zoeken →','Flächen suchen →'):query?tr('Review criteria →','Criteria controleren →','Kriterien prüfen →'):tr('Add search criteria','Zoekcriteria toevoegen','Suchkriterien ergänzen');if(enabled()&&$('advanced-run').textContent!==runLabel)$('advanced-run').textContent=runLabel;
    $('advanced-run').disabled=a.busy;
    $('journey-stage').textContent=a.busy?tr('Checking official data','Officiële gegevens controleren','Amtliche Daten werden geprüft'):a.pending?tr('Criteria ready · review and search','Criteria gereed · controleer en zoek','Kriterien bereit · prüfen und suchen'):tr('Screening from sampled points · legal review follows','Screening via steekproeven · juridische controle volgt','Suche mit Stichproben · Rechtsprüfung folgt');
    $('journey-results-title').textContent=`${a.results.length} ${tr('candidate sites','kandidaatlocaties','Kandidatenflächen')}`;
    const passed=a.results.filter(r=>!r.review).length;$('journey-results-note').textContent=`${passed} ${tr('map criteria met','kaartcriteria voldaan','Kartenkriterien erfüllt')} · ${a.results.length-passed} ${tr('with open checks','met open controles','mit offenen Prüfungen')}`;
    const stage=a.busy||a.activeTab==='results'?'run':prepared||query?'criteria':'area';for(const step of ['area','criteria','run']){$('journey-step-'+step).classList.toggle('active',step===stage);if(step===stage)$('journey-step-'+step).setAttribute('aria-current','step');else $('journey-step-'+step).removeAttribute('aria-current');}
    if(enabled()){requestAnimationFrame(()=>{state.map.invalidateSize({pan:false});if(state.perspectiveReady)state.perspectiveMap.resize();});for(const button of document.querySelectorAll('[data-search-tab]'))button.querySelector('.pv-research-tab-label').textContent=({request:tr('Search','Zoeken','Suche'),results:tr('Results','Treffers','Treffer'),history:tr('History','Geschiedenis','Verlauf')})[button.dataset.searchTab];}
    renderTray();summaryChips();const status=$('advanced-status'),details=$('journey-status-details');if(details){details.hidden=!status.textContent.trim();details.open=!!a.busy||!a.results.length&&!!a.hasSearched;$('journey-status-label').textContent=a.busy?tr('Search running · view progress','Zoeken loopt · bekijk voortgang','Suche läuft · Fortschritt ansehen'):/failed|fehlgeschlagen|mislukt|nicht erreichbar|unavailable/i.test(status.textContent)?tr('Some data queries failed · details','Enkele bronvragen mislukt · details','Einige Datenabfragen fehlgeschlagen · Details'):tr('Search status and coverage','Zoekstatus en dekking','Suchstatus und Abdeckung');}
  }
  function run(){
    const manual=$('pv-manual'),invalid=[...manual.querySelectorAll('input')].find(input=>!input.checkValidity());if(invalid){manual.open=true;invalid.reportValidity();return;}
    const query=$('advanced-query').value.trim();
    if(query&&ui.dirty){window.planviewAdvanced.run();return;}
    if(!describe().length){if(query){ui.dirty=true;window.planviewAdvanced.run();}else{$('journey-add-criterion').click();}return;}
    const spec=window.PlanViewCriteriaUI.readSpec();spec.queryText=query||describe().slice(0,4).map(row=>`${row.label} ${row.operator} ${displayValue(row)}`).join(' · ');window.planviewAdvanced.runManual(spec);
  }
  function resultCard(r,index,spec){
    const letter=core.letter(index),area=r.parcelEvidence?.parcel?.areaM2,rows=core.evidence(spec,r,dependencies),known=rows.filter(row=>row.actual!=null&&row.key!=='unsupported'),open=rows.filter(row=>row.status==='unknown');
    const bookmark=window.planviewUI?.saved.some(item=>samePoint(item,r.point));
    return `<article class="journey-card ${r.review?'has-open-checks':''}" data-journey-card="${index}"><div class="journey-card-heading"><span class="journey-letter">${letter}</span><div><h3>${safe(tr('Site','Locatie','Fläche'))} ${letter} · ${safe(r.municipality||'Nederland')}</h3><p>${safe(label(r.group)||r.name)}</p></div><button type="button" class="journey-bookmark" data-journey-save="${index}" aria-label="${safe(bookmark?tr('Open saved site','Bewaarde locatie openen','Gespeicherte Fläche öffnen'):tr('Save site','Locatie bewaren','Fläche merken'))}" aria-pressed="${!!bookmark}">${bookmark?'◆':'◇'}</button></div>${core.finite(area)?`<strong class="journey-area">${core.fmt(area,document.documentElement.lang)} <small>m²</small></strong>`:''}<div class="journey-card-metrics">${known.filter(row=>!(core.finite(area)&&['parcelMinAreaM2','parcelMaxAreaM2'].includes(row.key))).slice(0,3).map(row=>`<span>${safe(row.label)} <b>${safe(displayValue(row,row.actual))}</b></span>`).join('')}</div><p class="journey-verdict" data-state="${r.review?'unknown':'pass'}">${r.review?'?':'✓'} ${safe(r.review?tr('Checks still open','Controles nog open','Prüfungen noch offen'):tr('Map criteria met','Kaartcriteria voldaan','Kartenkriterien erfüllt'))}</p>${open.length?`<p class="journey-open-reason">${safe(open.slice(0,2).map(row=>row.label).join(' · '))}</p>`:''}<p class="journey-legal-note">${safe(tr('Building rights to be checked','Bouwrecht nog controleren','Baurecht noch zu prüfen'))}</p><div class="journey-card-actions"><button type="button" class="journey-primary" data-smart-result="${index}">${safe(tr('Check site','Locatie controleren','Standort prüfen'))} →</button><button type="button" class="journey-secondary" data-journey-compare="${index}">${safe(tr('Compare','Vergelijken','Vergleichen'))}</button></div><details class="journey-card-evidence"><summary>${safe(tr('Evidence and sources','Gegevens en bronnen','Befunde und Quellen'))}</summary>${evidenceTable(rows)}${window.PlanViewEnvironmentScreen.render(r.environmentEvidence||{},document.documentElement.lang)}<p>PDOK · ${safe(r.sourceId)} · ${safe(r.status)}</p><a href="${safe(officialPlanLink(r.sourceId,r.point))}" target="_blank" rel="noopener noreferrer">${safe(tr('Official plan','Officieel plan','Amtlicher Plan'))} ↗</a></details></article>`;
  }
  function bindResultActions(){
    if(!ui.hoverLayer)ui.hoverLayer=L.layerGroup().addTo(state.map);$('advanced-results').querySelectorAll('[data-journey-card]').forEach(card=>{const r=window.planviewAdvanced.results[Number(card.dataset.journeyCard)];card.onmouseenter=()=>{ui.hoverLayer.clearLayers();const shape=r.parcelEvidence?.parcel?.geometry||geoToLatLng(r.feature);if(shape)L.geoJSON(shape,{interactive:false,style:{color:'#146e66',weight:4,fillOpacity:.08}}).addTo(ui.hoverLayer);};card.onmouseleave=()=>ui.hoverLayer.clearLayers();});
    $('advanced-results').querySelectorAll('[data-journey-save]').forEach(button=>button.onclick=()=>{const r=window.planviewAdvanced.results[Number(button.dataset.journeySave)];if(window.planviewUI.saved.some(item=>samePoint(item,r.point))){window.planviewUI.setView('cases');return;}window.planviewUI.saveResult(r);button.setAttribute('aria-pressed','true');button.setAttribute('aria-label',tr('Open saved site','Bewaarde locatie openen','Gespeicherte Fläche öffnen'));button.textContent='◆';renderTray();});
    $('advanced-results').querySelectorAll('[data-journey-compare]').forEach(button=>button.onclick=()=>{window.planviewUI.addCompare(window.planviewUI.resultSnapshot(window.planviewAdvanced.results[Number(button.dataset.journeyCompare)]));renderTray();});
    $('advanced-results').querySelectorAll('[data-smart-result]').forEach(button=>{const index=Number(button.dataset.smartResult);button.addEventListener('click',()=>{ui.selected=index;document.querySelectorAll('[data-journey-card]').forEach(card=>card.classList.toggle('selected',Number(card.dataset.journeyCard)===index));});});
  }
  function evidenceTable(rows){
    return `<div class="journey-evidence-wrap"><table class="journey-evidence"><thead><tr><th>${safe(tr('Criterion','Criterium','Kriterium'))}</th><th>${safe(tr('Your requirement','Je wens','Dein Wunsch'))}</th><th>${safe(tr('Finding','Bevinding','Befund'))}</th></tr></thead><tbody>${rows.map(row=>`<tr data-state="${row.status}"><th scope="row">${safe(row.label)}<small>${safe(row.scope==='parcel'?tr('Whole parcel','Hele perceel','Gesamtes Grundstück'):tr('Sample point','Steekproefpunt','Prüfpunkt'))}</small></th><td>${safe(row.operator)} ${safe(displayValue(row))}</td><td><span class="journey-state">${row.status==='pass'?'✓':row.status==='fail'?'×':'?'}</span> ${safe(row.actual==null?tr('Check open','Controle open','Prüfung offen'):displayValue(row,row.actual))}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function inspector(){
    if(!enabled()||!state.selected)return;const selected=state.selected,search=selected.point.searchEvidence||{},spec=search.searchCriteria;
    const inner=$('detail-content').querySelector('.detail-inner'),summary=inner?.querySelector('[data-pv-tab="summary"]');if(!summary)return;
    inner.querySelector('.journey-site-review')?.remove();
    const section=document.createElement('section');section.className='journey-site-review';
    const result={...search,parcelEvidence:selected.parcelScreenEvidence||search.parcelEvidence,environmentEvidence:selected.environmentEvidence||search.environmentEvidence,group:selected.primary?.properties?.bestemmingshoofdgroep||search.group,status:selected.primary?.properties?.planstatus||search.status,distances:search.distances};
    const rows=spec?core.evidence(spec,result,dependencies):[];
    section.innerHTML=`<div class="journey-review-heading"><button type="button" class="journey-back-results">← ${safe(tr('Back to results','Terug naar treffers','Zurück zu Treffern'))}</button><span>${safe(tr('SITE CHECK','LOCATIECONTROLE','STANDORTPRÜFUNG'))}</span><h3>${safe(spec?tr('Does this site meet your search?','Past deze locatie bij je zoekopdracht?','Passt diese Fläche zu deiner Suche?'):tr('Understand this site','Deze locatie begrijpen','Diesen Standort verstehen'))}</h3></div>${rows.length?evidenceTable(rows):`<p>${safe(tr('This address was opened directly. Check the environmental data and applicable rules below.','Dit adres is direct geopend. Controleer hieronder de omgevingsgegevens en regels.','Diese Adresse wurde direkt geöffnet. Prüfe die Umweltwerte und die geltenden Regeln.'))}</p>`}<div class="journey-review-next"><strong>${safe(tr('Next: check building rights','Volgende: bouwrecht controleren','Nächster Schritt: Baurecht prüfen'))}</strong><p>${safe(tr('Map criteria and model values support the search. A legal assessment requires the applicable rule text.','Kaartcriteria en modelwaarden ondersteunen de zoekactie. Voor juridische beoordeling zijn de geldende regelteksten nodig.','Kartenkriterien und Modellwerte unterstützen die Suche. Für die rechtliche Prüfung braucht es die geltenden Regeltexte.'))}</p><button type="button" class="journey-primary" data-journey-rules>${safe(tr('Check proposal against rules','Toets voorstel aan regels','Vorhaben anhand der Regeln prüfen'))} →</button></div>`;
    summary.prepend(section);section.querySelector('.journey-back-results').onclick=()=>{window.planviewUI.closeInspector();window.planviewAdvanced.setOpen(true,{tab:'results'});};section.querySelector('[data-journey-rules]').onclick=()=>window.planviewUI.setInspectorTab('rules');
    const env=summary.querySelector('.pv-env-summary');if(env){env.classList.add('journey-environment');section.insertBefore(env,section.querySelector('.journey-review-next'));}
    const top=inner.querySelector('.detail-title-row h2');if(top&&search.letter)top.textContent=`${tr('Site','Locatie','Fläche')} ${search.letter} · ${selected.municipality?.name||'Nederland'}`;
    summary.classList.add('journey-secondary-evidence');
    renderParcelOutline(selected,search);
  }
  function renderParcelOutline(selected,search){
    if(ui.parcelLayer)state.map.removeLayer(ui.parcelLayer);ui.parcelLayer=L.layerGroup().addTo(state.map);
    const geometry=selected.parcelScreenEvidence?.parcel?.geometry||search.parcelEvidence?.parcel?.geometry||(selected.parcel?.geometry?geoToLatLng(selected.parcel).geometry:null),keys=[];
    if(geometry){L.geoJSON(geometry,{interactive:false,style:{color:'#116d65',weight:3,fillOpacity:.045}}).addTo(ui.parcelLayer);keys.push(['parcel',tr('Parcel','Perceel','Grundstück')]);}
    const envelopes=(selected.layers.building||selected.summaryEnvelopeFeatures||[]).filter(feature=>{const shape=geoToLatLng(feature);return shape?.geometry&&geometryContains(shape.geometry,selected.point)&&feature.properties?.plangebied===selected.primary?.properties?.plangebied;});
    for(const envelope of envelopes)L.geoJSON(geoToLatLng(envelope),{interactive:false,style:{color:'#c47c28',weight:2,dashArray:'5 3',fillColor:'#d69542',fillOpacity:.12}}).addTo(ui.parcelLayer);
    if(envelopes.length)keys.push(['envelope',tr('Bouwvlak','Bouwvlak','Baufenster')]);
    const building=selected.buildingInsights?.building;if(building?.geometry){L.geoJSON(building,{interactive:false,style:{color:'#657784',weight:2,fillColor:'#82929d',fillOpacity:.35}}).addTo(ui.parcelLayer);keys.push(['building',tr('BAG building','BAG-gebouw','BAG-Gebäude')]);}
    let legend=$('journey-map-key');if(!legend){legend=document.createElement('div');legend.id='journey-map-key';legend.setAttribute('aria-label',tr('Selected site geometry','Locatiegeometrie','Geometrie am Standort'));document.querySelector('.map-stage').append(legend);}
    legend.hidden=!keys.length;legend.innerHTML=keys.map(([kind,name])=>`<span><i class="${kind}"></i>${safe(name)}</span>`).join('');
  }
  function renderTray(){
    const target=$('journey-tray');if(!target)return;const items=window.planviewUI.comparison||[];
    target.hidden=!items.length||!enabled()||['compare','cases'].includes(window.planviewUI.view);
    target.innerHTML=`<span>${items.length}/3 ${safe(tr('sites in comparison','locaties in vergelijking','Flächen im Vergleich'))}</span><div>${items.map((item,index)=>`<button type="button" data-tray-open="${index}"><b>${safe(item.letter&&item.query===window.planviewAdvanced.lastQuery?item.letter:'↗')}</b> ${safe(item.label||item.municipality)}</button>`).join('')}</div><button type="button" class="journey-primary" data-tray-compare>${safe(tr('Compare sites','Locaties vergelijken','Flächen vergleichen'))} →</button>`;
    target.querySelector('[data-tray-compare]').onclick=()=>window.planviewUI.setView('compare');target.querySelectorAll('[data-tray-open]').forEach(button=>button.onclick=()=>window.planviewUI.openSnapshot(items[Number(button.dataset.trayOpen)]));
  }
  function init(){
    if(!$('pv-manual')){requestAnimationFrame(init);return;}
    const nav=document.createElement('nav');nav.id='journey-nav';nav.className='journey-nav';nav.setAttribute('aria-label',tr('Main tasks','Hoofdtaken','Hauptaufgaben'));nav.innerHTML='<button type="button" id="journey-nav-find"></button><button type="button" id="journey-nav-inspect"></button><button type="button" id="journey-nav-saved"></button>';document.querySelector('.brand').after(nav);
    $('journey-nav-find').onclick=()=>{ui.mode='find';window.planviewAdvanced.setOpen(true,{tab:'request'});syncScope();sync();};
    $('journey-nav-inspect').onclick=()=>{ui.mode='inspect';window.planviewAdvanced.setOpen(false);window.planviewUI.setView(state.selected?'inspect':'explore');$('search').focus();sync();};
    $('journey-nav-saved').onclick=()=>window.planviewUI.setView('cases');
    const panel=$('advanced-panel'),head=document.createElement('header');head.className='journey-search-head';head.innerHTML='<span class="journey-eyebrow" id="journey-eyebrow">PLANVIEW</span><h2 id="journey-title"></h2><ol class="journey-steps"><li id="journey-step-area"></li><li id="journey-step-criteria"></li><li id="journey-step-run"></li></ol>';panel.prepend(head);
    const area=document.createElement('section');area.className='journey-scope';area.innerHTML=`<div><span>${safe(tr('Search area','Zoekgebied','Suchgebiet'))}</span><strong id="journey-scope-name"></strong></div><button type="button" id="journey-change-area"></button><details><summary>${safe(tr('Choose area','Gebied kiezen','Gebiet wählen'))}</summary><select id="journey-scope-picker" aria-label="${safe(tr('Search area type','Type zoekgebied','Art des Suchgebiets'))}"></select><div id="journey-province-slot"></div><div id="journey-municipality-slot"></div></details>`;
    $('advanced-current-view').prepend(area);$('journey-scope-picker').innerHTML=$('advanced-scope-select').innerHTML;
    // A desktop-specific municipality selector shares the existing region selection.
    const province=document.createElement('select');province.id='journey-province';province.setAttribute('aria-label',tr('Search province','Zoekprovincie','Suchprovinz'));$('journey-province-slot').append(province);const syncProvince=()=>{province.innerHTML=$('province').innerHTML;province.value=$('province').value;};syncProvince();new MutationObserver(syncProvince).observe($('province'),{childList:true});province.onchange=()=>{$('province').value=province.value;$('province').dispatchEvent(new Event('change'));$('advanced-scope-select').value='province';$('advanced-scope-select').dispatchEvent(new Event('change'));syncScope();};
    const municipal=document.createElement('select');municipal.id='journey-municipality';municipal.setAttribute('aria-label',tr('Search municipality','Zoekgemeente','Suchgemeinde'));$('journey-municipality-slot').append(municipal);
    const syncMunicipal=()=>{municipal.innerHTML=$('municipality').innerHTML;municipal.value=$('municipality').value;};syncMunicipal();new MutationObserver(syncMunicipal).observe($('municipality'),{childList:true});
    municipal.onchange=()=>{$('municipality').value=municipal.value;$('municipality').dispatchEvent(new Event('change'));$('advanced-scope-select').value='municipality';$('advanced-scope-select').dispatchEvent(new Event('change'));syncScope();};
    $('journey-scope-picker').onchange=()=>{$('advanced-scope-select').value=$('journey-scope-picker').value;$('advanced-scope-select').dispatchEvent(new Event('change'));syncScope();};
    $('journey-change-area').onclick=()=>window.planviewAdvanced.startDrawing(false);
    const queryLabel=document.createElement('label');queryLabel.id='journey-description-label';queryLabel.htmlFor='advanced-query';$('advanced-query').before(queryLabel);
    const criteria=document.createElement('section');criteria.className='journey-criteria-section';criteria.innerHTML='<div class="journey-section-title"><h3 id="journey-criteria-title"></h3><span id="journey-count">0</span></div><div id="journey-criteria"></div><button type="button" id="journey-add-criterion"></button>';$('pv-manual').before(criteria);
    $('journey-add-criterion').onclick=()=>{$('pv-manual').open=!$('pv-manual').open;if($('pv-manual').open)$('pv-manual').scrollIntoView({block:'nearest',behavior:'smooth'});};
    const statusDetails=document.createElement('details');statusDetails.id='journey-status-details';statusDetails.innerHTML='<summary id="journey-status-label"></summary>';const status=$('advanced-status');status.before(statusDetails);statusDetails.append(status);const stage=document.createElement('p');stage.id='journey-stage';stage.setAttribute('role','status');$('advanced-run').after(stage);
    const resultsHead=document.createElement('div');resultsHead.className='journey-results-head';resultsHead.innerHTML='<div id="journey-active-search"></div><h2 id="journey-results-title"></h2><p id="journey-results-note"></p>';$('advanced-results-view').prepend(resultsHead);
    const tray=document.createElement('aside');tray.id='journey-tray';tray.hidden=true;tray.setAttribute('aria-label',tr('Comparison shortlist','Vergelijkingslijst','Vergleichsauswahl'));document.querySelector('.workspace').append(tray);
    new MutationObserver(()=>{if(enabled())sync();}).observe($('advanced-run'),{childList:true});ui.ready=true;ui.draft=window.PlanViewCriteriaUI.readSpec();renderCriteria();
    $('pv-manual').open=false;
    const manualChanged=()=>{ui.draft=window.PlanViewCriteriaUI.readSpec();ui.dirty=false;window.planviewAdvanced.pending=null;renderCriteria();sync();};$('pv-manual').addEventListener('input',manualChanged);$('pv-manual').addEventListener('change',manualChanged);
    $('advanced-query').addEventListener('input',()=>{ui.dirty=true;sync();syncScope();});
    document.querySelectorAll('[data-example]').forEach(button=>button.addEventListener('click',()=>{ui.dirty=true;sync();}));
    const oldRun=$('advanced-run').onclick;$('advanced-run').onclick=()=>enabled()?run():oldRun();
    $('advanced-query').addEventListener('keydown',event=>{if(enabled()&&(event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();event.stopImmediatePropagation();run();}},true);
    window.addEventListener('planview-search-cleared',()=>{setDraft({siteCriteria:window.PlanViewSearchCore.emptySiteCriteria(),environmentCriteria:window.PlanViewSearchCore.emptyEnvironmentCriteria(),distanceRules:window.PlanViewSearchCore.emptyRules(),groups:[],excludeGroups:[],statuses:[],excludeStatuses:[],unsupported:[]});ui.dirty=false;syncScope();sync();});
    window.addEventListener('planview-criteria-ready',event=>{if(!enabled()||!ui.ready)return;setDraft(event.detail.spec);ui.dirty=false;sync();});
    for(const event of ['planview-search-results','planview-search-busy','planview-search-open','planview-search-tab','planview-view-change','planview-collection-change'])window.addEventListener(event,()=>{sync();if(event==='planview-search-open')syncScope();});
    window.addEventListener('planview-language-change',()=>{renderCriteria();sync();window.planviewAdvanced.redraw();if(state.selected)renderDetails();});
    $('advanced-scope-select').addEventListener('change',syncScope);state.map.on('moveend',()=>{if($('advanced-scope-select').value==='view')syncScope();});
    const original=renderDetails;renderDetails=function(){original();inspector();};
    window.addEventListener('planview-environment-updated',event=>{if(state.selected===event.detail.selected)inspector();});
    media.addEventListener('change',()=>{sync();window.planviewAdvanced.redraw();if(state.selected)renderDetails();});
    sync();if(enabled())window.planviewAdvanced.setOpen(true,{focus:false});syncScope();
  }
  window.PlanViewDesktop={get enabled(){return enabled();},resultCard,bindResultActions,inspector};
  window.addEventListener('load',()=>requestAnimationFrame(init));
})();
