/* User-triggered OSRM travel times; an optional ORS key stays on the server. */
(function(root,factory){
  const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;
  if(root?.document){root.PlanViewCompareRouting=api;api.mountSettings();}
})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';
  const modes=Object.freeze(['walking','cycling','driving']);
  async function request(path,{payload,signal}={}){
    const response=await root.fetch(path,{credentials:'same-origin',cache:'no-store',signal,...(payload?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}:{})});
    const data=await response.json();if(!response.ok){const error=Error(data.error||'routing_unavailable');error.code=error.message;error.status=response.status;throw error;}return data;
  }
  function point(value,label=false){
    if(!value||!Number.isFinite(value.lat)||!Number.isFinite(value.lng)||value.lat<50.6||value.lat>53.8||value.lng<3||value.lng>7.6)throw Error('invalid_route_point');
    return {lat:value.lat,lng:value.lng,...(label&&typeof value.label==='string'?{label:value.label.slice(0,160)}:{})};
  }
  async function status({signal}={}){return request('/api/routes/status',{signal});}
  async function inspect(origins,target,{mode='walking',signal}={}){
    if(!Array.isArray(origins)||!origins.length||origins.length>3||!modes.includes(mode))throw Error('invalid_route_request');
    return request('/api/routes',{payload:{origins:origins.map(p=>point(p)),target:point(target,true),mode},signal});
  }
  const doc=root.document;
  const tr=(en,nl,de)=>doc?.documentElement.lang==='de'?de:doc?.documentElement.lang==='nl'?nl:en;
  function openSettings(){
    doc?.getElementById('services-settings')?.click();
    doc?.getElementById('settings-connections-tab')?.click();
    const advanced=doc?.getElementById('routing-advanced');if(advanced)advanced.open=true;
    const field=doc?.getElementById('routing-api-key');
    doc?.getElementById('routing-settings')?.scrollIntoView({behavior:root.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'auto':'smooth',block:'center'});field?.focus({preventScroll:true});
  }
  function mountSettings(){
    const form=doc?.getElementById('services-form');if(!form||doc.getElementById('routing-settings'))return;
    const section=doc.createElement('section');section.id='routing-settings';section.className='pv-ai-settings pv-routing-settings';section.dataset.pvManaged='';
    section.innerHTML='<div class="pv-ai-heading"><div><h3 id="routing-settings-title"></h3><p id="routing-provider"></p></div><span id="routing-key-status" role="status"></span></div><p id="routing-key-intro"></p><p><a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener noreferrer">OSRM · FOSSGIS ↗</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a> · <a id="routing-fix-map" href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer"></a></p><details id="routing-advanced"><summary id="routing-advanced-label"></summary><label id="routing-key-label" for="routing-api-key"></label><input id="routing-api-key" type="password" autocomplete="new-password" spellcheck="false" autocapitalize="off" maxlength="2048" aria-describedby="routing-key-help" data-pv-managed><p id="routing-key-help"></p><div class="services-actions"><button id="routing-save-key" type="button" class="services-save"></button><button id="routing-remove-key" type="button" class="services-subtle"></button></div></details><p id="routing-key-message" role="status" aria-live="polite"></p>';
    form.insertBefore(section,form.querySelector('.services-security'));
    const $=id=>doc.getElementById(id);let configured=false,loaded=false,busy=false,message='',error=false;
    function render(){
      $('routing-settings-title').textContent=tr('Travel times','Reistijden','Reisezeiten');
      $('routing-provider').textContent=configured?'openrouteservice · HeiGIT':'OSRM · OpenStreetMap · FOSSGIS';
      $('routing-key-intro').textContent=configured?tr('Your optional HeiGIT connection is active. Calculations send the selected coordinates to HeiGIT. Remove the key to use OSRM without an account. Times are modeled, without live traffic.','Je optionele HeiGIT-verbinding is actief. Berekeningen sturen de gekozen coördinaten naar HeiGIT. Verwijder de sleutel om OSRM zonder account te gebruiken. Berekende tijden, zonder live verkeer.','Deine optionale HeiGIT-Verbindung ist aktiv. Berechnungen senden die gewählten Koordinaten an HeiGIT. Entferne den Schlüssel, um OSRM ohne Konto zu nutzen. Modellierte Zeiten, ohne Live-Verkehr.'):tr('Ready without an account or API key. Choose a destination in the comparison to calculate walking, cycling or driving times on the road network. Only when you calculate are the selected coordinates sent to FOSSGIS. Shared public service for occasional comparisons; no live traffic or availability guarantee.','Klaar zonder account of API-sleutel. Kies een bestemming in de vergelijking voor loop-, fiets- of autorijtijden over het wegennet. Alleen bij berekenen gaan de gekozen coördinaten naar FOSSGIS. Gedeelde openbare dienst voor incidentele vergelijkingen; geen live verkeer of beschikbaarheidsgarantie.','Bereit ohne Konto oder API-Schlüssel. Wähle im Vergleich ein Ziel für Geh-, Rad- oder Fahrzeiten über das Wegenetz. Erst beim Berechnen werden die gewählten Koordinaten an FOSSGIS gesendet. Öffentlicher Dienst für gelegentliche Vergleiche; ohne Live-Verkehr oder Verfügbarkeitsgarantie.');
      $('routing-fix-map').textContent=tr('Fix the map ↗','Kaart verbeteren ↗','Karte korrigieren ↗');
      $('routing-advanced-label').textContent=tr('Use your own openrouteservice connection (optional)','Eigen openrouteservice-verbinding (optioneel)','Eigene openrouteservice-Verbindung (optional)');
      $('routing-key-label').textContent=tr('Your openrouteservice API key','Je openrouteservice API-sleutel','Dein openrouteservice API-Schlüssel');
      $('routing-key-help').textContent=root.planviewRuntime?.isLocal===false?tr('Stored encrypted for your signed-in web account. The key is never returned to the browser.','Versleuteld opgeslagen voor je aangemelde webaccount. De sleutel wordt nooit aan de browser teruggegeven.','Verschlüsselt für dein angemeldetes Webkonto gespeichert. Der Schlüssel wird nie an den Browser zurückgegeben.'):tr('Stored by your local server on this device. The key is never returned to the browser.','Opgeslagen door je lokale server op dit apparaat. De sleutel wordt nooit aan de browser teruggegeven.','Vom lokalen Server auf diesem Gerät gespeichert. Der Schlüssel wird nie an den Browser zurückgegeben.');
      $('routing-key-status').textContent=!loaded?tr('Checking settings','Instellingen controleren','Einstellungen prüfen'):configured?tr('Own connection','Eigen verbinding','Eigene Verbindung'):tr('No key needed','Geen sleutel nodig','Ohne Schlüssel nutzbar');
      $('routing-key-status').dataset.ready=String(loaded);
      $('routing-save-key').textContent=tr('Save routing key','Bewaar routesleutel','Routing-Schlüssel speichern');
      $('routing-remove-key').textContent=tr('Use without key','Zonder sleutel gebruiken','Ohne Schlüssel nutzen');
      $('routing-save-key').disabled=busy;$('routing-remove-key').disabled=busy||!configured;$('routing-api-key').disabled=busy;
      $('routing-key-message').classList.toggle('pv-loading',busy);section.setAttribute('aria-busy',String(busy));
      $('routing-key-message').textContent=message|| (busy?tr('Updating connection…','Verbinding bijwerken…','Verbindung wird aktualisiert…'):'');$('routing-key-message').dataset.error=String(error);
    }
    const explain=code=>code==='sign_in_required'?tr('Sign in to save a key for your web account.','Meld je aan om een sleutel op te slaan.','Anmelden, um einen Schlüssel im Webkonto zu speichern.'):code==='invalid_source_key'?tr('Check the key and paste the complete value from HeiGIT.','Controleer de sleutel en plak de volledige waarde van HeiGIT.','Schlüssel prüfen und vollständig von HeiGIT einfügen.'):tr('The connection settings are unavailable. Try again.','De verbindingsinstellingen zijn niet beschikbaar. Probeer opnieuw.','Verbindungseinstellungen nicht erreichbar. Erneut versuchen.');
    async function refresh(){try{const data=await status();configured=data.configured===true;loaded=true;message='';error=false;}catch(e){loaded=false;message=explain(e.code);error=true;}render();}
    async function save(remove=false){
      if(busy)return;const value=$('routing-api-key').value.trim();if(!remove&&!value){message=tr('Paste your HeiGIT key first.','Plak eerst je HeiGIT-sleutel.','Zuerst deinen HeiGIT-Schlüssel einfügen.');error=true;render();return;}
      busy=true;message='';render();
      try{const data=await request('/api/settings',{payload:{ors:remove?'':value}});configured=data.configured?.ors===true;loaded=true;$('routing-api-key').value='';message=remove?tr('OSRM is ready without a key.','OSRM is klaar zonder sleutel.','OSRM ist ohne Schlüssel nutzbar.'):tr('Key saved. Open the comparison and choose a destination to calculate routes.','Sleutel opgeslagen. Open de vergelijking en kies een bestemming om routes te berekenen.','Schlüssel gespeichert. Im Vergleich ein Ziel wählen und Reisezeiten berechnen.');error=false;root.dispatchEvent(new root.Event('planview-routing-connections-change'));}
      catch(e){message=explain(e.code);error=true;}finally{busy=false;render();}
    }
    $('routing-save-key').onclick=()=>save();$('routing-remove-key').onclick=()=>save(true);
    $('routing-api-key').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();save();}});
    $('services-settings')?.addEventListener('click',refresh);root.addEventListener('planview-language-change',render);
    const dialog=$('services-dialog');if(dialog&&root.MutationObserver)new root.MutationObserver(()=>{if(dialog.hidden)$('routing-api-key').value='';}).observe(dialog,{attributes:true,attributeFilter:['hidden']});
    render();
  }
  return {modes,status,inspect,openSettings,mountSettings};
});
