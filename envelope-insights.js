/* Show point-specific Bouwvlak evidence in the Summary tab for every selection.
   Search results retain their indexed PDOK feature while ordinary clicks use
   the same official GetFeatureInfo source, even when the map layer is hidden. */
(() => {
  const sourcePage='https://www.pdok.nl/atom-downloadservices/-/article/ruimtelijke-plannen';
  const tr=(en,nl,de)=>({nl,de}[document.documentElement.lang]||en);
  const exactAtPoint=(features,p)=>(features||[]).filter(feature=>{
    const geo=geoToLatLng(feature);
    return geo&&['Polygon','MultiPolygon'].includes(geo.geometry.type)&&geometryContains(geo.geometry,p);
  });
  const validLink=url=>/^https?:\/\//i.test(url||'')?url:null;
  function start(selected){
    if(!selected.primary||layerDefs.find(layer=>layer.id==='building')?.on||selected.summaryEnvelopeStarted)return;
    selected.summaryEnvelopeStarted=true;
    selected.summaryEnvelopeLoading=true;
    fetchFeatures(PLAN_WMS,'bouwvlak',selected.point,selected.signal).then(features=>{
      selected.summaryEnvelopeFeatures=features;
    }).catch(()=>{selected.summaryEnvelopeError=true;}).finally(()=>{
      selected.summaryEnvelopeLoading=false;
      show(selected);
    });
  }
  function evidenceRow(feature,selected,indexed=false){
    const p=selected.point,props=indexed?feature:feature.properties||{};
    const plan=props.plan||props.plangebied||'',id=props.id||props.identificatie||'';
    const title=(selected.layers.documents||[]).find(record=>record.identificatie===plan)?.naam||planTitle(plan);
    const date=props.date||props.datum||'',status=props.status||props.dossierstatus||props.planstatus||'';
    const planUrl=plan?officialPlanLink(plan,p):OFFICIAL;
    const ruleUrl=validLink(String(props.verwijzingnaartekst||'').split(',')[0]);
    const primaryPlan=selected.primary?.properties?.plangebied;
    const sourceNote=primaryPlan&&plan!==primaryPlan?`<p class="pv-envelope-caution">${tr('This building envelope belongs to another intersecting plan. Check both sources.','Dit bouwvlak hoort bij een ander overlappend plan. Controleer beide bronnen.','Dieses Baufenster gehört zu einem anderen überlagernden Plan. Beide Quellen prüfen.')}</p>`:'';
    return `<div class="pv-envelope-item"><strong>${esc(title)}</strong><small>${esc(indexed?tr('PDOK Wro Bouwvlak extract','PDOK Wro-bouwvlakextract','PDOK-Wro-Baufensterauszug'):tr('PDOK Ruimtelijke plannen · Bouwvlak','PDOK Ruimtelijke plannen · Bouwvlak','PDOK Ruimtelijke plannen · Baufenster'))}</small><dl><div><dt>${tr('Feature ID','Object-ID','Objekt-ID')}</dt><dd>${esc(id||'—')}</dd></div><div><dt>IMRO</dt><dd>${esc(plan||'—')}</dd></div>${date?`<div><dt>${tr('Source date','Brondatum','Quellendatum')}</dt><dd>${esc(date)}</dd></div>`:''}${status?`<div><dt>${tr('Status','Status','Status')}</dt><dd>${esc(status)}</dd></div>`:''}</dl><div class="pv-envelope-links"><a href="${esc(planUrl)}" target="_blank" rel="noopener noreferrer">${tr('Open source plan ↗','Bronplan openen ↗','Quellenplan öffnen ↗')}</a>${ruleUrl?`<a href="${esc(ruleUrl)}" target="_blank" rel="noopener noreferrer">${tr('Building rule ↗','Bouwregel ↗','Bauregel ↗')}</a>`:''}<a href="${sourcePage}" target="_blank" rel="noopener noreferrer">${tr('PDOK geometry source ↗','PDOK-geometriebron ↗','PDOK-Geometriequelle ↗')}</a></div>${sourceNote}</div>`;
  }
  function render(selected){
    const p=selected.point,indexed=p.searchEnvelope?.id&&p.searchEnvelope?.plan?p.searchEnvelope:null;
    const features=selected.layers.building??selected.summaryEnvelopeFeatures;
    const exact=exactAtPoint(features,p);
    const seen=new Set(),rows=[];
    for(const feature of exact){
      const props=feature.properties||{},key=`${props.plangebied}|${props.identificatie}`;
      if(seen.has(key))continue;seen.add(key);rows.push(evidenceRow(feature,selected));
    }
    if(indexed&&!seen.has(`${indexed.plan}|${indexed.id}`)){
      rows.push(evidenceRow(indexed,selected,true));
    }
    const pending=selected.pendingLayers?.includes('building')||selected.summaryEnvelopeLoading;
    const unavailable=selected.summaryEnvelopeError||(!pending&&!Array.isArray(features));
    let note='';
    if(rows.length){
      note=`<p class="pv-envelope-caution">${indexed&&!exact.length&&!pending?tr('The search-index feature was not returned by the current point query. Compare it with the current Omgevingsplan before relying on it.','Het zoekindexobject kwam niet terug in de actuele puntvraag. Vergelijk met het huidige omgevingsplan.','Das Objekt aus dem Suchindex kam in der aktuellen Punktabfrage nicht zurück. Mit dem heutigen Omgevingsplan abgleichen.'):
        tr('A mapped bouwvlak alone does not establish a current building right.','Een ingetekend bouwvlak bewijst op zichzelf geen actueel bouwrecht.','Ein kartiertes Baufenster belegt allein kein aktuelles Baurecht.')}</p>`;
    }else if(pending)note=`<p class="pv-envelope-note">${tr('Checking the official building envelope at this point…','Officieel bouwvlak op dit punt controleren…','Amtliches Baufenster an diesem Punkt wird geprüft…')}</p>`;
    else if(unavailable)note=`<p class="pv-envelope-note">${tr('Building-envelope source unavailable; no result can be confirmed.','Bouwvlakbron niet beschikbaar; geen resultaat bevestigd.','Baufenster-Quelle nicht verfügbar; kein Befund bestätigt.')}</p>`;
    else note=`<p class="pv-envelope-note">${tr('No official bouwvlak returned at this exact point. This is not a buildability decision.','Geen officieel bouwvlak op dit exacte punt gevonden. Dit is geen oordeel over bouwrecht.','Kein amtliches Baufenster an genau diesem Punkt gefunden. Das ist keine Baurechtsentscheidung.')}</p>`;
    return `<div class="pv-envelope-summary" role="group" aria-label="${tr('Official building envelope','Officieel bouwvlak','Amtliches Baufenster')}"><div class="pv-envelope-heading"><strong>${tr('Official building envelope','Officieel bouwvlak','Amtliches Baufenster')}</strong><span>${rows.length?`${rows.length} ${tr('matched','gevonden','gefunden')}`:''}</span></div>${rows.join('')}${note}</div>`;
  }
  function show(selected){
    if(state.selected!==selected)return;
    const summary=document.querySelector('#detail-content .detail-inner > .detail-section[data-pv-tab="summary"]');
    const target=summary||((selected.point.searchEnvelope?.id&&selected.point.searchEnvelope?.plan)?document.querySelector('#detail-content .empty-detail'):null);
    if(!target)return;
    target.querySelector('.pv-envelope-summary')?.remove();
    if(summary)summary.insertAdjacentHTML('beforeend',render(selected));
    else target.querySelector('.detail-actions')?.insertAdjacentHTML('beforebegin',render(selected));
  }
  const previousRender=renderDetails;
  renderDetails=function(){previousRender();const selected=state.selected;if(!selected)return;start(selected);show(selected);};
})();
