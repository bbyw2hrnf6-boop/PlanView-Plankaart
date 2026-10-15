/* Optional localhost source bridge. PDOK remains the base plan map at all times. */
(() => {
  const entry={id:'dso',label:'DSO current plan areas',icon:'map',group:'OFFICIAL PLAN',on:false,localSource:true};
  layerDefs.splice(layerDefs.findIndex(item=>item.id==='parcels'),0,entry);
  const service={configured:{dso:false,rp:false},pointKey:'',point:null,rules:null,rulesLoading:false,rulesError:'',rp:null,loading:false,error:'',areas:[],ticket:0,
    leaflet:null,geojson:{type:'FeatureCollection',features:[]}};
  window.planviewOfficialServices=service;
  const $=id=>document.getElementById(id);
  const lang=()=>document.documentElement.lang||'en';
  const tr=(en,nl,de)=>lang()==='nl'?nl:lang()==='de'?de:en;
  const message=value=>{$('services-message').textContent=value;};
  const pointKey=p=>`${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}`;
  const isCurrent=p=>state.selected&&pointKey(state.selected.point)===pointKey(p);
  const safeLink=url=>/^https:\/\//.test(url||'')?url:null;
  const officialAt=p=>{const [x,y]=wgs84ToRd(p);return `${OFFICIAL}zoeken?locatie-stelsel=RD&locatie-x=${x.toFixed(1)}&locatie-y=${y.toFixed(1)}`;};

  async function getJSON(url){const response=await fetch(url,{cache:'no-store',credentials:'same-origin'});const data=await response.json();if(!response.ok)throw Error(data.error||`HTTP ${response.status}`);return data;}
  function updateStatus(){
    $('dso-status').textContent=service.configured.dso?tr('Configured on this device','Ingesteld op dit apparaat','Auf diesem Gerät hinterlegt'):tr('Not configured','Niet ingesteld','Nicht hinterlegt');
    $('rp-status').textContent=service.configured.rp?tr('Configured on this device','Ingesteld op dit apparaat','Auf diesem Gerät hinterlegt'):tr('Not configured','Niet ingesteld','Nicht hinterlegt');
    const row=document.querySelector('[data-layer="dso"]')?.closest('.layer-row');
    if(row){row.classList.toggle('pv-unconfigured',!service.configured.dso);row.title=service.configured.dso?'':tr('Add a DSO key in settings','Voeg een DSO-sleutel toe via instellingen','DSO-Schlüssel in den Einstellungen hinterlegen');}
    showLayerState();
  }
  function showLayerState(){
    const label=document.querySelector('[data-layer="dso"]')?.closest('.layer-row')?.querySelector('.pv-layer-state');
    if(!label)return;
    label.textContent=!service.configured.dso?tr('Key needed · settings','Sleutel nodig · instellingen','Schlüssel nötig · Einstellungen'):
      !entry.on?tr('Off','Uit','Aus'):service.loading?tr('Loading…','Laden…','Lädt…'):
      service.error?tr('Source unavailable','Bron niet beschikbaar','Quelle nicht verfügbar'):
      service.point?tr(`${service.point.documents.length} sources · ${service.areas.length} plan extents`,`${service.point.documents.length} bronnen · ${service.areas.length} plangebieden`,`${service.point.documents.length} Quellen · ${service.areas.length} Planumrisse`):
      tr('Select a point to inspect','Kies een punt om te onderzoeken','Punkt zur Prüfung wählen');
    label.dataset.state=service.error?'error':service.loading?'loading':'visible';
  }
  async function loadSettings(){
    if(window.planviewRuntime?.isLocal===false){
      const text=tr('DSO and RP connections currently require the local Mac server. Public PDOK maps and 3D buildings work here.','DSO en RP vereisen momenteel de lokale Mac-server. Openbare PDOK-kaarten en 3D-gebouwen werken hier.','DSO- und RP-Verbindungen benötigen derzeit den lokalen Mac-Server. Öffentliche PDOK-Karten und 3D-Gebäude funktionieren hier.');
      message(text);for(const id of ['dso-status','rp-status'])$(id).textContent=tr('Local server only','Alleen lokale server','Nur auf lokalem Server');
      document.querySelectorAll('#dso-key,#rp-key,#remove-dso,#remove-rp,#services-form button[type="submit"]').forEach(node=>node.disabled=true);
      const input=document.querySelector('[data-layer="dso"]');if(input){input.disabled=true;input.closest('.layer-row').title=text;const label=input.closest('.layer-row').querySelector('.pv-layer-state');if(label)label.textContent=tr('Local server only','Alleen lokale server','Nur auf lokalem Server');}return;
    }
    try{const data=await getJSON('/api/settings');service.configured=data.configured||service.configured;
      updateStatus();
    }catch{message(tr('Start PlanView with the Desktop launcher to manage local keys.','Start PlanView via de Desktop-starter om sleutels lokaal te beheren.','PlanView mit dem Desktop-Starter öffnen, um Schlüssel lokal zu verwalten.'));}
  }
  async function save(event){
    event.preventDefault();const payload={};if($('dso-key').value.trim())payload.dso=$('dso-key').value.trim();if($('rp-key').value.trim())payload.rp=$('rp-key').value.trim();
    if(!Object.keys(payload).length){message(tr('Enter a key, or use Remove to delete one.','Voer een sleutel in of gebruik Verwijderen.','Schlüssel eingeben oder mit Entfernen löschen.'));return;}
    try{const response=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await response.json();if(!response.ok)throw Error(data.error||'Save failed');service.configured=data.configured;$('dso-key').value='';$('rp-key').value='';updateStatus();if(service.configured.dso&&!entry.on){entry.on=true;const input=document.querySelector('[data-layer="dso"]');if(input)input.checked=true;updateLayers();}
      message(tr('Saved locally. Select a map area to load connected sources.','Lokaal opgeslagen. Kies een gebied voor de gekoppelde bronnen.','Lokal gespeichert. Gebiet anklicken, um Quellen zu laden.'));
      if(state.selected)queryPoint(state.selected.point);
    }catch(error){message(error.message);}
  }
  async function remove(name){
    if(!service.configured[name])return;
    try{const response=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({[name]:''})});const data=await response.json();if(!response.ok)throw Error(data.error||'Remove failed');service.configured=data.configured;if(name==='dso'){entry.on=false;const input=document.querySelector('[data-layer="dso"]');if(input)input.checked=false;service.point=null;service.areas=[];service.geojson={type:'FeatureCollection',features:[]};syncLayer();}
      updateStatus();if(state.selected)renderDetails();message(tr('Key removed from this device.','Sleutel verwijderd van dit apparaat.','Schlüssel von diesem Gerät entfernt.'));
    }catch(error){message(error.message);}
  }
  function rdToWgs(x,y){
    const dx=(x-155000)/100000,dy=(y-463000)/100000;
    const lat=[[0,1,3235.65389],[2,0,-32.58297],[0,2,-.2475],[2,1,-.84978],[0,3,-.0655],[2,2,-.01709],[1,0,-.00738],[4,0,.0053],[2,3,-.00039],[4,1,.00033],[1,1,-.00012]];
    const lon=[[1,0,5260.52916],[1,1,105.94684],[1,2,2.45656],[3,0,-.81885],[1,3,.05594],[3,1,-.05607],[0,1,.01199],[3,2,-.00256],[1,4,.00128],[0,2,.00022],[2,0,-.00022],[5,0,.00026]];
    const sum=terms=>terms.reduce((total,[a,b,c])=>total+c*dx**a*dy**b,0)/3600;
    return [5.38720621+sum(lon),52.15517440+sum(lat)];
  }
  function transform(coords){return typeof coords?.[0]==='number'?rdToWgs(coords[0],coords[1]):coords.map(transform);}
  function syncPerspective(){
    if(!state.perspectiveReady)return;const map=state.perspectiveMap;
    const data=entry.on?service.geojson:{type:'FeatureCollection',features:[]};
    if(!map.getSource('dso-selected')){
      map.addSource('dso-selected',{type:'geojson',data});
      map.addLayer({id:'dso-selected-fill',type:'fill',source:'dso-selected',paint:{'fill-color':'#8270d7','fill-opacity':.16}});
      map.addLayer({id:'dso-selected-line',type:'line',source:'dso-selected',paint:{'line-color':'#6b51c8','line-width':2.4,'line-dasharray':[3,2]}});
    }else map.getSource('dso-selected').setData(data);
  }
  function syncLayer(){
    if(!state.map)return;
    if(!service.leaflet)service.leaflet=L.layerGroup();
    service.leaflet.clearLayers();
    if(entry.on&&service.geojson.features.length){
      // DSO is a visual context layer. Clicks must reach the normal map handler,
      // which selects the point and renders all sources in the right-hand panel.
      L.geoJSON(service.geojson,{interactive:false,
        style:{color:'#6b51c8',weight:2.5,dashArray:'6 4',fillColor:'#8e7adc',fillOpacity:.13}}
      ).addTo(service.leaflet);
      if(!state.map.hasLayer(service.leaflet))service.leaflet.addTo(state.map);
    }else if(state.map.hasLayer(service.leaflet))state.map.removeLayer(service.leaflet);
    syncPerspective();showLayerState();
  }
  async function queryPoint(p){
    if(!service.configured.dso)return;
    const key=pointKey(p);if(service.pointKey===key&&(service.loading||service.point))return;
    const ticket=++service.ticket;service.pointKey=key;service.point=null;service.rules=null;service.rulesLoading=false;service.rulesError='';service.rp=null;service.areas=[];service.geojson={type:'FeatureCollection',features:[]};service.error='';service.loading=true;syncLayer();if(isCurrent(p))renderDetails();
    try{
      const [x,y]=wgs84ToRd(p);const result=await getJSON(`/api/dso/point?x=${x.toFixed(3)}&y=${y.toFixed(3)}`);
      if(ticket!==service.ticket)return;service.point=result;service.loading=false;
      // Rule annotations are independent of the optional plan-outline overlay.
      // Start them immediately so a slow or unavailable geometry cannot delay review.
      queryRules(p,ticket);
      const areas=(result.areas||[]).slice(0,6);
      const settled=await Promise.allSettled(areas.map(async area=>{const value=await getJSON(`/api/dso/geometry?id=${encodeURIComponent(area.geometryId)}`);return {type:'Feature',properties:area,geometry:{type:value.geometry.type,coordinates:transform(value.geometry.coordinates)}};}));
      if(ticket!==service.ticket)return;
      service.geojson={type:'FeatureCollection',features:settled.filter(x=>x.status==='fulfilled').map(x=>x.value)};
      service.areas=service.geojson.features;syncLayer();if(isCurrent(p))renderDetails();
    }catch(error){if(ticket!==service.ticket)return;service.loading=false;service.error=error.message;syncLayer();if(isCurrent(p))renderDetails();}
  }
  async function queryRules(p,ticket){
    service.rulesLoading=true;if(isCurrent(p))renderDetails();
    try{const [x,y]=wgs84ToRd(p);const result=await getJSON(`/api/dso/rules?x=${x.toFixed(3)}&y=${y.toFixed(3)}`);
      if(ticket!==service.ticket)return;service.rules=result;service.rulesError='';
    }catch(error){if(ticket!==service.ticket)return;service.rulesError=error.message;}
    finally{if(ticket===service.ticket){service.rulesLoading=false;if(isCurrent(p))renderDetails();}}
  }
  function ruleSummary(){
    if(service.rulesLoading)return `<p class="pv-dso-loading">${tr('Checking rules at this point…','Regels op dit punt controleren…','Regeln an diesem Punkt werden geprüft…')}</p>`;
    if(service.rulesError)return `<p class="source-warning">${tr('Point rule check unavailable:','Puntcontrole niet beschikbaar:','Punktprüfung nicht verfügbar:')} ${esc(service.rulesError)}</p>`;
    if(!service.rules)return '';
    const instruments=service.rules.instruments||[];
    if(!instruments.length)return `<p>${tr('No current municipal, provincial or water instrument returned for this point.','Geen actueel gemeentelijk, provinciaal of waterschapsinstrument gevonden.','Für diesen Punkt wurde kein aktuelles Gemeinde-, Provinz- oder Wasserinstrument geliefert.')}</p>`;
    const priority=/bouw|woon|recrea|camp|chalet|water|grond|natuur|geluid|erfgoed|veiligheid/i;
    const card=item=>{
      const doc=item.document||{},href=safeLink(doc.sourceUrl)||officialAt(state.selected.point);
      if(item.error)return `<div class="pv-dso-instrument"><strong>${esc(doc.title||doc.type)}</strong><p class="pv-dso-muted">${tr('Annotations unavailable. Check the official location view.','Annotaties niet beschikbaar. Controleer de officiële locatie.','Annotationen nicht verfügbar. Amtliche Ortsansicht prüfen.')}</p><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${tr('Official location','Officiële locatie','Amtlicher Ort')} ↗</a></div>`;
      const names=[...new Set([...(item.designations||[]),...(item.areas||[])].map(a=>a.name).filter(Boolean))].slice(0,4);
      const specific=(item.topics||[]).filter(topic=>topic.specific>0).sort((a,b)=>Number(priority.test(b.name))-Number(priority.test(a.name))||b.specific-a.specific).slice(0,4);
      const broad=(item.topics||[]).filter(topic=>topic.broad>0).sort((a,b)=>Number(priority.test(b.name))-Number(priority.test(a.name))||b.broad-a.broad).slice(0,6);
      const activities=(item.activities||[]).filter(name=>priority.test(name)).slice(0,5);
      const refs=(item.ruleReferences||[]).filter(ref=>ref.article).slice(0,5);
      const detail=[broad.length?`<div class="pv-dso-label">${tr('General themes','Algemene thema’s','Allgemeine Themen')}</div><div class="pv-dso-chips">${broad.map(topic=>`<span>${esc(topic.name)}</span>`).join('')}</div>`:'',activities.length?`<div class="pv-dso-label">${tr('Mentioned activities','Genoemde activiteiten','Genannte Tätigkeiten')}</div><div class="pv-dso-chips">${activities.map(name=>`<span>${esc(name)}</span>`).join('')}</div>`:'',refs.length?`<small>${tr('Example article IDs:','Voorbeeldartikel-ID’s:','Beispielartikel-IDs:')} ${refs.map(ref=>esc(ref.article)).join(' · ')}</small>`:''].join('');
      return `<div class="pv-dso-instrument"><div class="pv-dso-instrument-title"><strong>${esc(doc.title||doc.type)}</strong><small>${esc(doc.type||'')} · ${esc(doc.authority||'DSO')}${doc.effectiveFrom?` · ${esc(doc.effectiveFrom)}`:''}</small></div>${names.length?`<div class="pv-dso-label">${tr('Named areas at this point','Benoemde gebieden op dit punt','Benannte Gebiete an diesem Punkt')}</div><div class="pv-dso-chips">${names.map(name=>`<span>${esc(name)}</span>`).join('')}</div>`:`<p class="pv-dso-muted">${tr('No named local area returned here.','Geen benoemd lokaal gebied gevonden.','Kein benanntes lokales Gebiet geliefert.')}</p>`}${specific.length?`<div class="pv-dso-label">${tr('Area-linked topics','Gebiedsgebonden thema’s','Gebietsbezogene Themen')}</div><div class="pv-dso-chips">${specific.map(topic=>`<span>${esc(topic.name)}</span>`).join('')}</div>`:''}<small>${item.specificRuleCount||0} ${tr('area-linked references','gebiedsgebonden verwijzingen','gebietsbezogene Verweise')} · ${item.authorityWideRuleCount||0} ${tr('authority-wide references','algemene verwijzingen','allgemeine Verweise')}</small><div><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${tr('Check official rules for this point','Controleer officiële regels voor dit punt','Amtliche Regeln für diesen Punkt prüfen')} ↗</a></div>${detail?`<details class="pv-dso-documents"><summary>${tr('More themes and article IDs','Meer thema’s en artikel-ID’s','Mehr Themen und Artikel-IDs')}</summary>${detail}</details>`:''}</div>`;
    };
    return `<div class="pv-dso-review"><div class="pv-dso-review-head"><strong>${tr('Current rules at this point','Actuele regels op dit punt','Aktuelle Regeln an diesem Punkt')}</strong><span>${tr('DSO point check','DSO-puntcontrole','DSO-Punktprüfung')}</span></div><p>${tr('Mapped areas and rule references are shown separately. They are research evidence, not a construction permit or a parcel-wide decision.','Gebieden en regelverwijzingen staan apart. Dit is onderzoek, geen bouwvergunning of beoordeling voor het hele perceel.','Gebiete und Regelverweise sind getrennt dargestellt. Dies sind Recherchehinweise, keine Baugenehmigung oder Prüfung des ganzen Grundstücks.')}</p>${instruments.map(card).join('')}</div>`;
  }
  function documentRows(){
    const docs=[...(service.point?.documents||[])];const municipality=state.selected?.municipality?.code||'';
    docs.sort((a,b)=>Number(b.id?.includes(`gm${municipality}`))-Number(a.id?.includes(`gm${municipality}`)));
    return docs.slice(0,8).map((doc,index)=>{const local=doc.id?.includes(`gm${municipality}`);
      const title=doc.title||doc.id;const href=safeLink(doc.sourceUrl)||officialAt(state.selected.point);
      return `<div class="pv-service-document"><span class="pv-service-rank">${local&&index===0?tr('Local plan candidate','Lokaal plan-kandidaat','Lokaler Plankandidat'):tr('Context document','Contextdocument','Kontextdokument')}</span><strong>${esc(title)}</strong><small>${esc(doc.type||'Omgevingsdocument')} · ${esc(doc.authority||'DSO')} · ${esc(doc.id)}</small>${doc.effectiveFrom?`<small>${tr('Effective from','Geldig vanaf','Gültig ab')} ${esc(doc.effectiveFrom)}</small>`:''}<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${tr('Open official location view','Open officiële locatie','Amtliche Ortsansicht öffnen')} ↗</a></div>`;
    }).join('');
  }
  function renderServiceCard(){
    if(!state.selected||!service.configured.dso&&!service.configured.rp)return;
    const root=$('detail-content');if(!root)return;
    const section=document.createElement('section');section.className='detail-section pv-services-detail';section.dataset.pvManaged='';
    let dso='';
    if(service.configured.dso){
      if(service.loading)dso=`<p>${tr('Loading current DSO sources at this point…','Huidige DSO-bronnen op dit punt laden…','Aktuelle DSO-Quellen an diesem Punkt werden geladen…')}</p>`;
      else if(service.error)dso=`<p class="source-warning">${tr('DSO could not be loaded:','DSO kon niet worden geladen:','DSO konnte nicht geladen werden:')} ${esc(service.error)}</p>`;
      else if(service.point)dso=`${ruleSummary()}${entry.on&&service.areas.length?`<p>${tr('Purple dashed outline: the municipality-wide Omgevingsplan extent, not a parcel-specific rule boundary.','Paarse stippellijn: het gemeentebrede omgevingsplangebied, geen grens van een perceelspecifieke regel.','Violetter Umriss: das gemeindeweite Omgevingsplangebiet, keine Grenze einer grundstücksspezifischen Regel.')}</p>`:''}<details class="pv-dso-documents"><summary>${tr('All DSO documents at this point','Alle DSO-documenten op dit punt','Alle DSO-Dokumente an diesem Punkt')} · ${service.point.documents.length}</summary>${documentRows()}</details>`;
      else dso=`<p>${tr('Select a point to load DSO documents.','Kies een punt om DSO-documenten te laden.','Punkt wählen, um DSO-Dokumente zu laden.')}</p>`;
    }
    const rp=service.configured.rp&&state.selected.primary?.properties?.plangebied?`<div class="pv-rp-note">${service.rp?`${tr('RP V4 metadata','RP V4-metadata','RP-V4-Metadaten')}: ${esc(service.rp.title||service.rp.id)} · ${esc(service.rp.status||'')}`:tr('RP V4 plan metadata loading or unavailable. PDOK plan source remains above.','RP V4-plangegevens laden of niet beschikbaar. PDOK-bron blijft hierboven staan.','RP-V4-Plandaten laden oder nicht verfügbar. Die PDOK-Quelle bleibt oben stehen.')}</div>`:'';
    section.innerHTML=`<h3>${tr('Current DSO sources','Actuele DSO-bronnen','Aktuelle DSO-Quellen')}</h3><p class="secondary-intro">${tr('Additional official context; the PDOK designation and its IMRO source remain unchanged above. A matched document is not by itself a building permission.','Aanvullende officiële context; de PDOK-bestemming en IMRO-bron blijven hierboven staan. Een document is geen bouwtoestemming.','Zusätzlicher amtlicher Kontext; die PDOK-Festsetzung und IMRO-Quelle bleiben oben. Ein Dokument ist keine Baugenehmigung.')}</p>${dso}${rp}<a class="source-link" href="${esc(officialAt(state.selected.point))}" target="_blank" rel="noopener noreferrer">${tr('Check all rules at this location','Controleer alle regels op deze locatie','Alle Regeln an diesem Ort prüfen')} ↗</a>`;
    root.append(section);
  }
  const previousUpdate=updateLayers;updateLayers=function(){previousUpdate();if(service.configured.dso&&state.selected)queryPoint(state.selected.point);syncLayer();};
  const previousPerspective=initPerspective;initPerspective=async function(){await previousPerspective();syncPerspective();};
  const previousRender=renderDetails;renderDetails=function(){previousRender();renderServiceCard();};
  const previousSelect=selectPoint;selectPoint=async function(p){const result=previousSelect(p);service.ticket++;service.pointKey='';service.point=null;service.rules=null;service.rulesLoading=false;service.rulesError='';service.rp=null;service.areas=[];service.geojson={type:'FeatureCollection',features:[]};syncLayer();if(service.configured.dso)queryPoint(p);
    await result;if(!isCurrent(p))return;
    const id=state.selected?.primary?.properties?.plangebied;
    if(service.configured.rp&&id){try{service.rp=await getJSON(`/api/rp/plan?id=${encodeURIComponent(id)}`);if(isCurrent(p))renderDetails();}catch{/* PDOK remains the source when RP V4 has no record. */}}
  };
  service.reviewSelectedPoint=()=>{if(!state.selected)return;document.querySelector('.pv-inspector-tabs [data-tab="rules"]')?.click();if(!service.rules&&!service.rulesLoading&&service.configured.dso)queryPoint(state.selected.point);document.querySelector('.pv-dso-review,.pv-dso-loading')?.scrollIntoView({behavior:'smooth',block:'nearest'});};
  const dialog=$('services-dialog');
  const closeDialog=()=>{dialog.hidden=true;document.body.classList.remove('services-open');};
  $('services-settings').addEventListener('click',()=>{message('');dialog.hidden=false;document.body.classList.add('services-open');loadSettings();});
  $('services-close').onclick=closeDialog;
  
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!dialog.hidden)closeDialog();});
  $('services-form').addEventListener('submit',save);
  $('remove-dso').onclick=()=>remove('dso');$('remove-rp').onclick=()=>remove('rp');
  window.addEventListener('planview-language-change',updateStatus);
  window.addEventListener('load',loadSettings);
})();
