/* Optional, deliberate travel-time checks for at most three search candidates. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),tr=(en,nl,de)=>({nl,de}[document.documentElement.lang]||en),safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const selected=new Set();let target=null,mode='driving',result=null,busy=false,error='',generation=0,controller=null,targetGeneration=0,targetController=null,timer=0,mounted=false;
  const key=r=>`${r.sourceId||''}|${r.point.lat.toFixed(6)},${r.point.lng.toFixed(6)}`;
  const results=()=>window.planviewAdvanced?.results||[],items=()=>results().filter(r=>selected.has(key(r))),number=Number.isFinite;
  function invalidate(){generation++;controller?.abort();controller=null;busy=false;result=null;error='';update();}
  function card(r,index){return `<div class="journey-route-row"><label><input type="checkbox" data-search-route="${index}" ${selected.has(key(r))?'checked':''}><span>${safe(tr('Check travel time','Reistijd controleren','Reisezeit prüfen'))}</span></label><span data-search-route-value="${index}"></span></div>`;}
  function routeText(r){
    if(busy&&selected.has(key(r)))return tr('Calculating…','Berekenen…','Wird berechnet…');
    const row=result?.routes?.find(route=>route.origin?.lat===r.point.lat&&route.origin?.lng===r.point.lng);
    if(!row)return tr('Not checked','Niet gecontroleerd','Noch nicht geprüft');
    if(!number(row.durationSeconds)||!number(row.distanceMeters))return tr('No route returned','Geen route ontvangen','Keine Route verfügbar');
    const minutes=Math.max(1,Math.round(row.durationSeconds/60)),km=(row.distanceMeters/1000).toLocaleString(document.documentElement.lang,{maximumFractionDigits:1});
    return `${minutes} min · ${km} km`;
  }
  function bind(){
    if(!mounted)mount();const current=new Set(results().map(key));let changed=false;for(const id of selected)if(!current.has(id)){selected.delete(id);changed=true;}if(changed)invalidate();
    $('advanced-results')?.querySelectorAll('[data-search-route]').forEach(input=>{input.onchange=()=>{const r=results()[Number(input.dataset.searchRoute)];if(!r)return;if(input.checked&&selected.size>=3){input.checked=false;error=tr('Choose up to three sites for one calculation.','Kies maximaal drie locaties per berekening.','Wähle bis zu drei Standorte pro Berechnung.');update();return;}input.checked?selected.add(key(r)):selected.delete(key(r));invalidate();if(selected.size){$('journey-routes').open=true;}update();};});update();
  }
  function update(){
    if(!mounted)return;const panel=$('journey-routes');panel.hidden=!results().length;
    $('journey-routes-label').textContent=tr('Optional travel times','Optionele reistijden','Optionale Reisezeiten')+` · ${selected.size}/3`;
    $('journey-routes-intro').textContent=tr('Select up to three result cards and one destination. This adds road-network times; it does not filter or rank the search.','Selecteer maximaal drie treffers en één bestemming. Dit vult reistijden over het wegennet aan; het filtert of sorteert de zoekactie niet.','Wähle bis zu drei Treffer und ein Ziel. Ergänzt Reisezeiten im Wegenetz; verändert keine Suchfilter oder Rangfolge.');
    $('journey-route-target-label').textContent=tr('Common destination','Gemeenschappelijke bestemming','Gemeinsames Ziel');
    $('journey-route-target').placeholder=tr('Find address or place…','Zoek adres of plaats…','Adresse oder Ort suchen…');
    $('journey-route-mode-label').textContent=tr('Travel mode','Vervoermiddel','Verkehrsmittel');
    const modes=[['driving',tr('Driving','Auto','Auto')],['cycling',tr('Cycling','Fietsen','Fahrrad')],['walking',tr('Walking','Lopen','Zu Fuß')]];
    for(const [value,label] of modes)$('journey-route-mode').querySelector(`[value="${value}"]`).textContent=label;
    $('journey-route-go').textContent=busy?tr('Calculating…','Berekenen…','Wird berechnet…'):tr('Calculate for selection','Bereken voor selectie','Für Auswahl berechnen');
    $('journey-route-go').disabled=busy||!selected.size||!target||window.planviewAdvanced.busy;
    const status=$('journey-route-status');status.classList.toggle('pv-loading',busy);status.textContent=error||(busy?tr('Checking the road network…','Wegennet controleren…','Wegenetz wird geprüft…'):result?tr('Travel times ready · modeled, without live traffic.','Reistijden gereed · berekend, zonder live verkeer.','Reisezeiten bereit · modelliert, ohne Live-Verkehr.'):!selected.size?tr('Select “Check travel time” on result cards.','Vink “Reistijd controleren” aan bij treffers.','Markiere „Reisezeit prüfen“ bei den Treffern.'):!target?tr('Choose the destination from a suggestion.','Kies de bestemming uit een suggestie.','Wähle das Ziel aus einem Vorschlag.'):tr('Ready to calculate on request.','Klaar om op verzoek te berekenen.','Bereit zur Berechnung auf Anfrage.'));
    status.dataset.state=error?'error':busy?'loading':'idle';$('journey-route-form').setAttribute('aria-busy',String(busy));
    $('journey-route-note').textContent=tr('Optional routing · modeled times, no live traffic. Selected coordinates are sent to the configured routing service only when you calculate.','Optionele routes · berekende tijden, geen live verkeer. Alleen bij berekenen gaan geselecteerde coördinaten naar de ingestelde routedienst.','Optionales Routing · modellierte Zeiten, kein Live-Verkehr. Gewählte Koordinaten gehen erst beim Berechnen an den eingestellten Routing-Dienst.');
    $('journey-route-source').hidden=!result;const source=result?.provider==='ors'?'openrouteservice · HeiGIT':'OSRM · FOSSGIS',sourceUrl=result?.provider==='ors'?'https://openrouteservice.org/':'https://routing.openstreetmap.de/about.html';$('journey-route-source').innerHTML=result?`<a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">${source} ↗</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">${safe(tr('Fix the map','Kaart verbeteren','Karte korrigieren'))} ↗</a><br>${safe(tr('checked','opgevraagd','abgerufen'))} ${safe(new Date(result.retrievedAt||result._retrievedAt).toLocaleString(document.documentElement.lang))}`:'';
    $('advanced-results')?.querySelectorAll('[data-search-route]').forEach(input=>{const r=results()[Number(input.dataset.searchRoute)];if(!r)return;input.checked=selected.has(key(r));input.disabled=window.planviewAdvanced.busy||(!input.checked&&selected.size>=3);});
    $('advanced-results')?.querySelectorAll('[data-search-route-value]').forEach(span=>{const r=results()[Number(span.dataset.searchRouteValue)];if(!r)return;const context=(result||busy)&&selected.has(key(r))?`${modes.find(([value])=>value===mode)?.[1]||''} · ${target?.label||''}`:'';span.innerHTML=`<strong>${safe(routeText(r))}</strong>${context?`<small>${safe(context)}</small>`:''}`;span.classList.toggle('pv-loading',busy&&selected.has(key(r)));span.dataset.ready=String(!!result?.routes?.some(route=>route.origin?.lat===r.point.lat&&route.origin?.lng===r.point.lng&&number(route.durationSeconds)));span.title=result&&selected.has(key(r))?`${target?.label||''} · ${modes.find(([value])=>value===mode)?.[1]||''}`:'';});
  }
  function clearOptions(){const box=$('journey-target-options');box.replaceChildren();box.hidden=true;$('journey-route-target').setAttribute('aria-expanded','false');}
  async function searchTarget(){
    const input=$('journey-route-target'),query=input.value.trim(),ticket=targetGeneration;if(query.length<3){clearOptions();return;}
    targetController=new AbortController();const options=$('journey-target-options');
    try{const response=await fetch('https://api.pdok.nl/bzk/locatieserver/search/v3_1/suggest?'+new URLSearchParams({q:query,rows:'5'}),{signal:targetController.signal});if(!response.ok)throw Error();const data=await response.json();if(ticket!==targetGeneration||input.value.trim()!==query)return;
      const docs=data.response?.docs||[];options.innerHTML=docs.length?docs.map((d,i)=>`<button type="button" role="option" data-target="${i}">${safe(d.weergavenaam)}</button>`).join(''):`<p>${safe(tr('No suggestions found. Try an address or place.','Geen suggesties. Probeer een adres of plaats.','Keine Vorschläge. Versuche eine Adresse oder einen Ort.'))}</p>`;options.hidden=false;input.setAttribute('aria-expanded','true');
      options.querySelectorAll('button').forEach((button,i)=>{button.onclick=()=>chooseTarget(docs[i]);button.onkeydown=event=>{const buttons=[...options.querySelectorAll('button')];if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();buttons[(i+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus();}if(event.key==='Escape'){event.stopPropagation();clearOptions();input.focus();}};});
    }catch(e){if(e.name==='AbortError'||ticket!==targetGeneration)return;options.innerHTML=`<p>${safe(tr('Address search unavailable. Please try again.','Adreszoeker niet bereikbaar. Probeer opnieuw.','Adresssuche nicht erreichbar. Bitte erneut versuchen.'))}</p>`;options.hidden=false;input.setAttribute('aria-expanded','true');}
  }
  async function chooseTarget(doc){
    const ticket=++targetGeneration;targetController?.abort();targetController=new AbortController();clearTimeout(timer);clearOptions();error='';
    try{const response=await fetch('https://api.pdok.nl/bzk/locatieserver/search/v3_1/lookup?'+new URLSearchParams({id:doc.id}),{signal:targetController.signal});if(!response.ok)throw Error();const data=await response.json();if(ticket!==targetGeneration)return;const place=data.response?.docs?.[0],match=/POINT\s*\(\s*([\d.-]+)\s+([\d.-]+)\s*\)/.exec(place?.centroide_ll||'');if(!match)throw Error();target={lat:Number(match[2]),lng:Number(match[1]),label:place.weergavenaam};$('journey-route-target').value=target.label;invalidate();$('journey-route-go').focus();
    }catch(e){if(e.name==='AbortError'||ticket!==targetGeneration)return;error=tr('This destination could not be resolved.','Bestemming niet gevonden.','Dieses Ziel konnte nicht aufgelöst werden.');update();}
  }
  async function calculate(event){
    event.preventDefault();if(busy||!target||!selected.size||window.planviewAdvanced.busy)return;const sites=items();if(!sites.length||sites.length>3)return;
    const ticket=++generation;controller=new AbortController();busy=true;error='';result=null;update();
    try{const data=await window.PlanViewCompareRouting.inspect(sites.map(r=>r.point),target,{mode,signal:controller.signal});if(ticket!==generation)return;result={...data,_retrievedAt:new Date().toISOString()};}
    catch(e){if(e.name==='AbortError'||ticket!==generation)return;error=e.status===429?tr('Too many requests. Wait a moment and retry.','Te veel verzoeken. Wacht even en probeer opnieuw.','Zu viele Anfragen. Bitte kurz warten und erneut versuchen.'):tr('Routing is unavailable. No travel time was estimated. You can retry.','Routedienst niet bereikbaar. Er is geen reistijd geschat. Probeer opnieuw.','Routing nicht erreichbar. Es wurde keine Reisezeit geschätzt. Du kannst erneut versuchen.');}
    finally{if(ticket===generation){busy=false;update();}}
  }
  function mount(){
    const head=document.querySelector('.journey-results-head');if(!head)return;const panel=document.createElement('details');panel.id='journey-routes';panel.className='journey-routes';panel.dataset.pvManaged='';panel.hidden=true;
    panel.innerHTML='<summary id="journey-routes-label"></summary><p id="journey-routes-intro"></p><form id="journey-route-form"><label class="journey-route-target-wrap"><span id="journey-route-target-label"></span><input id="journey-route-target" role="combobox" aria-autocomplete="list" aria-controls="journey-target-options" aria-expanded="false" autocomplete="off"><div id="journey-target-options" role="listbox" hidden></div></label><label><span id="journey-route-mode-label"></span><select id="journey-route-mode"><option value="driving"></option><option value="cycling"></option><option value="walking"></option></select></label><button type="submit" id="journey-route-go"></button></form><p id="journey-route-status" role="status" aria-live="polite"></p><p id="journey-route-note"></p><p id="journey-route-source" hidden></p>';
    head.after(panel);mounted=true;$('journey-route-form').onsubmit=calculate;
    $('journey-route-mode').onchange=()=>{mode=$('journey-route-mode').value;invalidate();};
    $('journey-route-target').oninput=()=>{target=null;targetGeneration++;targetController?.abort();clearTimeout(timer);clearOptions();invalidate();timer=setTimeout(searchTarget,280);};
    $('journey-route-target').onkeydown=event=>{const options=$('journey-target-options');if(event.key==='ArrowDown'&&options.querySelector('button')){event.preventDefault();options.querySelector('button').focus();}if(event.key==='Escape'){event.stopPropagation();clearOptions();}};update();
  }
  window.PlanViewSearchRouting={card,bind};
  window.addEventListener('planview-search-results',bind);window.addEventListener('planview-search-busy',update);window.addEventListener('planview-language-change',update);
  window.addEventListener('planview-search-progress',event=>{if(event.detail?.phase==='preparing'){selected.clear();invalidate();}});
  window.addEventListener('planview-search-cleared',()=>{selected.clear();invalidate();});window.addEventListener('planview-routing-connections-change',invalidate);
})();
