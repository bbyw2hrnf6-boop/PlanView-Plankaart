/* API credentials go only to this origin's server; never browser storage. */
(() => {
  const $=id=>document.getElementById(id);
  const tr=(en,nl,de)=>({nl,de}[document.documentElement.lang]||en);
  const cloud=window.planviewRuntime?.isLocal===false;
  const section=document.createElement('section');section.id='ai-settings';section.className='pv-ai-settings';section.dataset.pvManaged='';
  section.innerHTML='<div class="pv-ai-heading"><div><h3 id="ai-settings-title"></h3><p>GPT-6 Luna · High Reasoning</p></div><span id="ai-key-status" role="status"></span></div><label id="ai-key-label" for="ai-api-key"></label><input id="ai-api-key" type="password" autocomplete="new-password" spellcheck="false" autocapitalize="off" maxlength="512" aria-describedby="ai-key-help" data-pv-managed><p id="ai-key-help"></p><div class="services-actions"><button id="ai-save-key" type="button" class="services-save"></button><button id="ai-test-key" type="button" class="services-subtle"></button><button id="ai-remove-key" type="button" class="services-subtle"></button></div><p id="ai-key-message" role="status" aria-live="polite"></p>';
  $('services-intro').before(section);
  let configured=false,available=false,busy=false,loaded=false,messageCode='',shared=false,canManageKeys=true;
  const messages={
    saved:()=>tr('Key saved. Check the connection before your first search.','Sleutel opgeslagen. Controleer de verbinding voor je eerste zoekopdracht.','Schlüssel gespeichert. Prüfe die Verbindung vor der ersten Suche.'),
    removed:()=>cloud?tr('Key removed from your web account.','Sleutel verwijderd uit je webaccount.','Schlüssel aus deinem Webkonto entfernt.'):tr('Saved API key removed. The local Codex connection remains available.','Opgeslagen API-sleutel verwijderd. De lokale Codex-verbinding blijft beschikbaar.','Gespeicherten API-Key entfernt. Die lokale Codex-Verbindung bleibt verfügbar.'),
    tested:()=>tr('Connection verified · GPT-6 Luna · High Reasoning','Verbinding gecontroleerd · GPT-6 Luna · High Reasoning','Verbindung geprüft · GPT-6 Luna · High Reasoning'),
    invalid_api_key_format:()=>tr('Enter a valid OpenAI key beginning with sk-.','Voer een geldige OpenAI-sleutel in die begint met sk-.','Gib einen gültigen OpenAI-Key ein, der mit sk- beginnt.'),
    invalid_api_key:()=>tr('OpenAI rejected this key. Replace it in settings.','OpenAI heeft deze sleutel geweigerd. Vervang hem in de instellingen.','OpenAI hat diesen Schlüssel abgelehnt. Ersetze ihn in den Einstellungen.'),
    api_key_missing:()=>tr('Add your OpenAI API key in Settings → Connections to use AI search.','Voeg je OpenAI API-sleutel toe via Instellingen → Verbindingen voor AI-zoeken.','Hinterlege deinen OpenAI-API-Key unter Einstellungen → Verbindungen für die KI-Suche.'),
    provider_limit:()=>tr('OpenAI usage limit reached. Check your API credit and limits.','OpenAI-gebruikslimiet bereikt. Controleer je API-tegoed en limieten.','OpenAI-Nutzungslimit erreicht. Prüfe dein API-Guthaben und deine Limits.'),
    request_limit:()=>tr('A search is running or the request limit was reached. Try again shortly.','Er loopt een zoekopdracht of de limiet is bereikt. Probeer het zo opnieuw.','Eine Suche läuft bereits oder das Anfragelimit ist erreicht. Versuche es gleich erneut.'),
    weekly_search_limit:()=>tr('Weekly limit of 150 AI searches reached. Contact the owner or wait until Monday.','Weeklimiet van 150 AI-zoekopdrachten bereikt. Neem contact op met de eigenaar of wacht tot maandag.','Wochenlimit von 150 KI-Suchen erreicht. Kontaktiere den Besitzer oder warte bis Montag.'),
    weekly_quota_unavailable:()=>tr('Your weekly allowance could not be checked. Please try again later.','Je weeklimiet kon niet worden gecontroleerd. Probeer het later opnieuw.','Dein Wochenkontingent konnte nicht geprüft werden. Bitte später erneut versuchen.'),
    model_access_denied:()=>tr('This API project cannot access GPT-6 Luna. Check the project permissions.','Dit API-project heeft geen toegang tot GPT-6 Luna. Controleer de projectrechten.','Dieses API-Projekt hat keinen Zugriff auf GPT-6 Luna. Prüfe die Projektberechtigungen.'),
    sign_in_required:()=>tr('Sign in to the web app with your ChatGPT account, then try again.','Meld je aan met je ChatGPT-account en probeer opnieuw.','Melde dich in der Web-App mit deinem ChatGPT-Konto an und versuche es erneut.'),
    storage_unavailable:()=>tr('Key storage is temporarily unavailable. Please retry.','Sleutelopslag is tijdelijk niet beschikbaar. Probeer opnieuw.','Der Schlüsselspeicher ist vorübergehend nicht erreichbar. Bitte erneut versuchen.'),
    provider_unavailable:()=>tr('The AI connection is temporarily unavailable. Your key was not changed.','De AI-verbinding is tijdelijk niet beschikbaar. Je sleutel is niet gewijzigd.','Die KI-Verbindung ist vorübergehend nicht erreichbar. Dein Schlüssel wurde nicht geändert.'),
    invalid_ai_response:()=>tr('The AI response could not be verified. Please retry.','Het AI-antwoord kon niet worden gecontroleerd. Probeer opnieuw.','Die KI-Antwort konnte nicht geprüft werden. Bitte erneut versuchen.'),
    unsaved:()=>tr('Save your new key before checking the connection.','Sla je nieuwe sleutel op voordat je de verbinding controleert.','Speichere den neuen Schlüssel, bevor du die Verbindung prüfst.'),
    service_unavailable:()=>tr('Connection could not be checked. Please retry.','De verbinding kon niet worden gecontroleerd. Probeer opnieuw.','Verbindung konnte nicht geprüft werden. Bitte erneut versuchen.')
  };
  window.planviewAIMessage=code=>(messages[code]||messages.service_unavailable)();
  function render(){
    section.setAttribute('aria-busy',String(busy));
    $('ai-key-message').classList.toggle('pv-loading',busy);
    $('ai-test-key').setAttribute('aria-busy',String(busy));
    $('ai-settings-title').textContent=tr('AI search','AI-zoeken','KI-Suche');
    $('ai-key-label').textContent='OpenAI API key';
    $('ai-api-key').placeholder=tr('Paste your API key','Plak je API-sleutel','API-Key einfügen');
    $('ai-key-help').textContent=cloud?tr('Encrypted on the server for your signed-in web account. Available on your phone and laptop. API usage is billed by OpenAI. Leave blank to keep the saved key.','Versleuteld op de server voor je aangemelde webaccount. Beschikbaar op telefoon en laptop. OpenAI rekent API-gebruik af. Laat leeg om de opgeslagen sleutel te behouden.','Verschlüsselt auf dem Server für dein angemeldetes Webkonto. Auf Handy und Laptop verfügbar. OpenAI rechnet API-Nutzung separat ab. Leer lassen, um den gespeicherten Schlüssel zu behalten.'):tr('Saved only on this Mac. Without an API key, PlanView uses your local Codex connection. Configure the web key separately in the web app. API usage is billed by OpenAI.','Alleen op deze Mac opgeslagen. Zonder API-sleutel gebruikt PlanView je lokale Codex-verbinding. Stel de websleutel apart in de webapp in. OpenAI rekent API-gebruik af.','Nur auf diesem Mac gespeichert. Ohne API-Key nutzt PlanView deine lokale Codex-Anbindung. Den Web-Key separat in der Web-App hinterlegen. OpenAI rechnet API-Nutzung separat ab.');
    if(shared)$('ai-key-help').textContent=canManageKeys?tr('Stored centrally and encrypted. All approved users use this connection. Only you can change it. API usage is billed to your OpenAI account.','Centraal en versleuteld opgeslagen. Alle toegelaten gebruikers gebruiken deze verbinding. Alleen jij kunt deze wijzigen. API-gebruik wordt aan jouw OpenAI-account gefactureerd.','Zentral verschlüsselt gespeichert. Alle freigegebenen Nutzer verwenden diese Verbindung. Nur du kannst sie ändern. API-Nutzung wird deinem OpenAI-Konto berechnet.'):tr('Provided centrally by the owner. You do not need to enter a key. The key is never sent to your browser.','Centraal beschikbaar gesteld door de eigenaar. Je hoeft geen sleutel in te voeren. De sleutel wordt nooit naar je browser gestuurd.','Zentral vom Besitzer bereitgestellt. Du musst keinen Schlüssel eingeben. Der Schlüssel gelangt nie in deinen Browser.');
    $('ai-key-status').textContent=!loaded?(messageCode?tr('Unavailable','Niet beschikbaar','Nicht erreichbar'):tr('Checking…','Controleren…','Wird geprüft…')):configured?tr('Key saved','Sleutel opgeslagen','Schlüssel hinterlegt'):available&&!cloud?tr('Codex connected','Codex verbonden','Codex verbunden'):tr('Key needed','Sleutel nodig','Schlüssel fehlt');
    $('ai-key-status').dataset.ready=String(configured||available);
    if(loaded&&shared)$('ai-key-status').textContent=configured?tr('Central connection ready','Centrale verbinding gereed','Zentrale Verbindung bereit'):tr('Central key missing','Centrale sleutel ontbreekt','Zentraler Schlüssel fehlt');
    $('ai-save-key').textContent=tr('Save key','Sleutel opslaan','Schlüssel speichern');
    $('ai-test-key').textContent=busy?tr('Please wait…','Even wachten…','Bitte warten…'):tr('Check connection','Verbinding controleren','Verbindung prüfen');
    $('ai-test-key').title=tr('Runs one small AI request using your API account.','Voert één kleine AI-aanvraag uit via je API-account.','Führt eine kleine KI-Anfrage über dein API-Konto aus.');
    $('ai-remove-key').textContent=tr('Remove','Verwijderen','Entfernen');
    $('ai-save-key').disabled=busy||!loaded||!canManageKeys||!$('ai-api-key').value.trim();
    $('ai-test-key').disabled=busy||!loaded||!(configured||available);
    $('ai-remove-key').disabled=busy||!loaded||!configured;
    $('ai-api-key').disabled=busy||!canManageKeys;
    for(const id of ['ai-key-label','ai-api-key','ai-save-key','ai-remove-key'])$(id).hidden=!canManageKeys;
    $('ai-key-message').textContent=messageCode?window.planviewAIMessage(messageCode):busy?tr('Checking your connection…','Verbinding controleren…','Verbindung wird geprüft…'):'';
    $('ai-key-message').dataset.error=String(!['','saved','removed','tested'].includes(messageCode));
  }
  async function request(path,payload){
    const response=await fetch(path,{cache:'no-store',credentials:'same-origin',...(payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),signal:AbortSignal.timeout(path.endsWith('/test')?125000:10000)});
    const data=await response.json();if(!response.ok)throw Error(data.error||'service_unavailable');return data;
  }
  async function refresh(){if(busy)return;try{const data=await request('/api/ai/settings');configured=data.configured===true;available=data.available===true;shared=data.credentialScope==='shared';canManageKeys=data.canManageKeys!==false;loaded=true;}catch(error){loaded=false;messageCode=error.message;}render();}
  async function action(kind){
    if(busy)return;
    if(kind!=='test'&&!canManageKeys)return;
    if(kind==='test'&&$('ai-api-key').value.trim()){messageCode='unsaved';render();return;}
    const value=$('ai-api-key').value.trim();
    if(kind==='save'&&!/^sk-[A-Za-z0-9_-]{16,508}$/.test(value)){messageCode='invalid_api_key_format';render();return;}
    busy=true;messageCode='';render();
    try{const data=await request(kind==='test'?'/api/ai/test':'/api/ai/settings',kind==='test'?{}:{key:kind==='remove'?'':value});
      if(kind!=='test'){configured=data.configured===true;$('ai-api-key').value='';}
      messageCode=kind==='test'?'tested':kind==='remove'?'removed':'saved';
      window.dispatchEvent(new Event('planview-ai-change'));
    }catch(error){messageCode=error.message;}finally{busy=false;render();}
  }
  $('ai-save-key').onclick=()=>action('save');$('ai-test-key').onclick=()=>action('test');$('ai-remove-key').onclick=()=>action('remove');
  $('ai-api-key').addEventListener('input',render);
  $('ai-api-key').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();action('save');}});
  $('services-settings').addEventListener('click',refresh);
  const clear=()=>{$('ai-api-key').value='';render();};
  $('services-close').addEventListener('click',clear);document.addEventListener('keydown',e=>{if(e.key==='Escape')clear();});
  window.addEventListener('planview-language-change',render);render();refresh();
})();
