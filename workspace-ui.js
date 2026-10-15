/* PlanView workspace: presentation and accessibility only. Existing adapters own data. */
(() => {
  const $ = id => document.getElementById(id);
  const tr = (en, nl, de) => ({nl, de}[document.documentElement.lang] || en);
  const mobileMode=matchMedia('(max-width:900px)');
  let layersOpen = !mobileMode.matches;
  let settingsTab = 'connections';
  let lastFocus = null;

  function syncLayout() {
    const research = !$('advanced-panel').hidden;
    const inspector = $('detail-panel').classList.contains('open');
    const workbench = !$('pv-workbench').hidden;
    const narrow = innerWidth < 1360;
    document.body.dataset.workspace = workbench ? 'collection' : 'map';
    document.body.dataset.inspector = inspector && !workbench ? 'open' : 'closed';
    document.body.dataset.left = workbench ? 'none' : research ? 'research' : layersOpen && !(narrow && inspector) ? 'layers' : 'none';
    $('sidebar').inert = document.body.dataset.left !== 'layers';
    $('detail-panel').inert = !inspector || workbench;
    document.querySelector('.map-stage').inert = workbench;
    $('pv-layers').setAttribute('aria-pressed', String(document.body.dataset.left === 'layers'));
    $('pv-research').setAttribute('aria-pressed', String(research && !workbench));
    $('pv-research').setAttribute('aria-expanded', String(research && !workbench));
    syncMobileNav();syncMapChoices();
    if(research||inspector||workbench){if($('mobile-map-options'))$('mobile-map-options').open=false;}
  }

  function syncMobileNav(){
    const view=window.planviewUI?.view,tool=document.body.dataset.left;
    $('pv-mobile-nav')?.querySelectorAll('button').forEach(button=>{const target=button.dataset.mobileTool||button.dataset.view;const active=target==='layers'?tool==='layers':target==='search'?!$('advanced-panel').hidden:target==='explore'?!['cases','compare'].includes(view)&&tool==='none':view===target;button.setAttribute('aria-pressed',String(active));button.classList.toggle('active',active);if(button.dataset.mobileTool)button.setAttribute('aria-expanded',String(active));});
  }

  function syncMapChoices() {
    if (!$('pv-basemap')) return;
    $('pv-basemap').value = state.baseMode;
    $('pv-map-ink').value = state.mapStyle;
    $('pv-perspective').value = state.perspective ? 'perspective' : '2d';
    $('pv-perspective').disabled = $('perspective-toggle').disabled;
    const quick=$('mobile-perspective');if(quick){quick.disabled=$('pv-perspective').disabled;quick.setAttribute('aria-pressed',String(state.perspective));quick.querySelector('span').textContent=state.perspective?tr('2D map','2D-kaart','2D-Karte'):tr('3D buildings','3D-gebouwen','3D-Gebäude');}
    const map = state.perspective && state.perspectiveReady ? state.perspectiveMap : state.map;
    $('pv-basemap').title = state.baseMode === 'bgt' && map?.getZoom() < 15
      ? tr('BGT appears from zoom 15; street map is shown now.', 'BGT verschijnt vanaf zoom 15; nu zie je de stratenkaart.', 'BGT ab Zoom 15; aktuell wird die Straßenkarte angezeigt.') : '';
  }

  function makeMapTools() {
    const toolbar = $('pv-toolbar');
    toolbar.classList.add('workspace-toolbar');
    toolbar.setAttribute('aria-label', tr('Map tools', 'Kaartgereedschap', 'Kartenwerkzeuge'));
    const research = document.createElement('button');
    research.id = 'pv-research'; research.type = 'button';
    research.setAttribute('aria-controls', 'advanced-panel');
    research.innerHTML = `${icon('search')}<span></span>`;
    $('pv-layers').after(research);
    research.onclick = () => {
      if (!$('pv-workbench').hidden) window.planviewUI.setView('explore');
      window.planviewAdvanced.setOpen($('advanced-panel').hidden);
    };
    $('pv-layers').onclick = () => {
      const visible = document.body.dataset.left === 'layers';
      if (!$('pv-workbench').hidden || innerWidth < 1360 && $('detail-panel').classList.contains('open')) window.planviewUI.setView('explore');
      window.planviewAdvanced.setOpen(false, {focus:false});
      layersOpen = !visible; syncLayout();
    };
    $('close-layers').onclick = () => { layersOpen = false; syncLayout(); $('pv-layers').focus(); };
    const choices = document.createElement('div'); choices.className = 'workspace-map-choices';
    choices.innerHTML = `<label><span class="sr-only" id="pv-basemap-label"></span><select id="pv-basemap" aria-labelledby="pv-basemap-label"></select></label><label><span class="sr-only" id="pv-ink-label"></span><select id="pv-map-ink" aria-labelledby="pv-ink-label"></select></label><label><span class="sr-only" id="pv-perspective-label"></span><select id="pv-perspective" aria-labelledby="pv-perspective-label"></select></label>`;
    toolbar.append(choices);
    document.querySelector('.workspace').prepend(toolbar);
    $('pv-basemap').onchange = () => {
      const target = $('pv-basemap').value;
      // The original control also refreshes the existing contextual aerial display.
      for (let i = 0; i < 3 && state.baseMode !== target; i++) $('basemap-toggle').click();
      syncMapChoices();
    };
    $('pv-map-ink').onchange = () => { if (state.mapStyle !== $('pv-map-ink').value) $('render-toggle').click(); syncMapChoices(); };
    $('pv-perspective').onchange = async () => {
      if ((state.perspective ? 'perspective' : '2d') === $('pv-perspective').value) return;
      $('pv-perspective').disabled = true;
      await togglePerspective(); syncMapChoices();
    };
    new MutationObserver(syncMapChoices).observe($('perspective-toggle'), {attributes:true, attributeFilter:['disabled', 'aria-pressed']});
    state.map.on('zoomend', syncMapChoices);
    document.querySelector('.workspace').append($('advanced-panel'));
    $('advanced-toggle').hidden = true;
  }

  function makeMobileTools(){
    const toolbar=$('pv-toolbar'),choices=toolbar.querySelector('.workspace-map-choices');
    const quick=document.createElement('button');quick.id='mobile-perspective';quick.type='button';quick.className='mobile-only-tool';quick.dataset.pvManaged='';quick.innerHTML=`${icon('building')}<span></span>`;
    quick.onclick=()=>{$('pv-perspective').value=state.perspective?'2d':'perspective';$('pv-perspective').dispatchEvent(new Event('change'));};
    const options=document.createElement('details');options.id='mobile-map-options';options.className='mobile-only-tool';options.dataset.pvManaged='';options.innerHTML=`<summary>${icon('settings')}<span></span></summary><div class="mobile-map-menu"><div class="mobile-draw-tools"></div></div>`;
    toolbar.append(quick,options);
    for(const id of ['pv-draw','pv-measure'])$(id).addEventListener('click',()=>options.open=false);
    function place(){
      if(mobileMode.matches){options.querySelector('.mobile-map-menu').prepend(choices);options.querySelector('.mobile-draw-tools').append($('pv-draw'),$('pv-measure'));}
      else{options.open=false;toolbar.insertBefore($('pv-draw'),quick);toolbar.insertBefore($('pv-measure'),quick);toolbar.insertBefore(choices,quick);}
      syncMapChoices();syncLayout();
    }
    options.addEventListener('toggle',()=>options.querySelector('summary').setAttribute('aria-expanded',String(options.open)));
    document.addEventListener('pointerdown',event=>{if(options.open&&!options.contains(event.target))options.open=false;});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&options.open){event.preventDefault();event.stopImmediatePropagation();options.open=false;options.querySelector('summary').focus();}},true);
    window.addEventListener('planview-mobile-map',()=>{layersOpen=false;options.open=false;});
    mobileMode.addEventListener('change',()=>{if(mobileMode.matches)layersOpen=false;place();});
    place();
    let frame=0;
    const viewport=window.visualViewport;
    function size(){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(viewport?.scale&&viewport.scale!==1)return;const height=Math.round(viewport?.height||innerHeight);const value=height+'px';if(document.documentElement.style.getPropertyValue('--app-height')!==value)document.documentElement.style.setProperty('--app-height',value);const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName||'');document.body.dataset.keyboard=mobileMode.matches&&typing&&innerHeight-height>140?'open':'closed';$('pv-mobile-nav').inert=document.body.dataset.keyboard==='open';});}
    viewport?.addEventListener('resize',size);window.addEventListener('resize',size);document.addEventListener('focusin',size);document.addEventListener('focusout',size);size();
  }

  function simplifyLayers() {
    const list = $('layer-list');
    let group;
    [...list.children].forEach(node => {
      if (node.classList.contains('layer-group-label')) {
        group = document.createElement('details'); group.className = 'workspace-layer-group';
        group.open = list.querySelectorAll('.workspace-layer-group').length === 0;
        const summary = document.createElement('summary'); summary.append(node);
        group.append(summary); list.append(group);
      } else if (group) group.append(node);
    });
    const legend = document.querySelector('.legend-section');
    const details = document.createElement('details'); details.className = 'workspace-legend';
    const summary = document.createElement('summary');
    const heading = legend.querySelector('.section-title');
    const reset = $('reset-filters');
    heading.before(details); summary.append(heading.querySelector('h2')); details.append(summary);
    [...legend.children].filter(n => n !== details).forEach(n => details.append(n));
    heading.remove(); details.append(reset);
    const saved = document.querySelector('.research-section');
    saved.hidden = true;
    // Existing saved-area renderer remains compatible; Cases is the sole visible collection.
    const welcome = $('pv-welcome');
    welcome.querySelector('.eyebrow').textContent = 'PLANVIEW · LIMBURG';
    const find = document.createElement('button'); find.type = 'button'; find.className = 'pv-button'; find.id = 'workspace-find';
    find.onclick = () => window.planviewAdvanced.setOpen(true);
    welcome.append(find);
  }

  function selectSettingsTab(tab, focus = false) {
    settingsTab = tab;
    $('workspace-connections').hidden = tab !== 'connections';
    $('workspace-appearance').hidden = tab !== 'appearance';
    document.querySelectorAll('[data-settings-tab]').forEach(button => {
      const active = button.dataset.settingsTab === tab;
      button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus();
    });
  }

  function makeSettings() {
    const form = $('services-form');
    const tabs = document.createElement('div'); tabs.className = 'workspace-settings-tabs'; tabs.dataset.pvManaged = '';  tabs.setAttribute('role', 'tablist');
    tabs.innerHTML = `<button type="button" role="tab" id="settings-connections-tab" data-settings-tab="connections" aria-controls="workspace-connections"></button><button type="button" role="tab" id="settings-appearance-tab" data-settings-tab="appearance" aria-controls="workspace-appearance"></button>`;
    const connections = document.createElement('section'); connections.id = 'workspace-connections'; connections.setAttribute('role', 'tabpanel'); connections.setAttribute('aria-labelledby', 'settings-connections-tab');
    [...form.children].filter(n => !n.classList.contains('services-heading')).forEach(n => connections.append(n));
    const appearance = document.createElement('section'); appearance.id = 'workspace-appearance'; appearance.dataset.pvManaged = '';  appearance.setAttribute('role', 'tabpanel'); appearance.setAttribute('aria-labelledby', 'settings-appearance-tab');
    appearance.innerHTML = `<label for="pv-theme" id="workspace-theme-label"></label><div class="workspace-theme-choices"><button type="button" data-theme-choice="day"><span class="theme-swatch swatch-day" aria-hidden="true"><i></i><i></i><i></i></span><span></span></button><button type="button" data-theme-choice="night"><span class="theme-swatch swatch-night" aria-hidden="true"><i></i><i></i><i></i></span><span></span></button><button type="button" data-theme-choice="sand"><span class="theme-swatch swatch-sand" aria-hidden="true"><i></i><i></i><i></i></span><span></span></button></div><div id="workspace-system-choice"><label class="workspace-system-label"><input type="checkbox" id="workspace-system-theme"><span id="workspace-system-label"></span></label></div><p id="workspace-theme-note"></p><label for="workspace-language" id="workspace-language-label"></label><select id="workspace-language"><option value="de">Deutsch</option><option value="nl">Nederlands</option><option value="en">English</option></select><p id="workspace-local-note"></p>`;
    form.append(tabs, connections, appearance);
    $('workspace-system-choice').append($('pv-theme'));
    $('pv-theme').hidden = true;
    $('workspace-theme-label').removeAttribute('for');
    $('workspace-system-theme').onchange = () => { $('pv-theme').value = $('workspace-system-theme').checked ? 'system' : document.body.dataset.appearance; $('pv-theme').dispatchEvent(new Event('change')); updateThemeSelection(); };
    $('workspace-language').onchange = () => window.planviewSetLanguage($('workspace-language').value);
    appearance.querySelectorAll('[data-theme-choice]').forEach(button => button.onclick = () => {
      $('pv-theme').value = button.dataset.themeChoice;
      $('pv-theme').dispatchEvent(new Event('change'));
      updateThemeSelection();
    });
    $('pv-theme').addEventListener('change', updateThemeSelection);
    tabs.querySelectorAll('button').forEach(button => {
      button.onclick = () => selectSettingsTab(button.dataset.settingsTab);
      button.onkeydown = e => { if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) { e.preventDefault(); selectSettingsTab(e.key === 'Home' ? 'connections' : e.key === 'End' ? 'appearance' : settingsTab === 'appearance' ? 'connections' : 'appearance', true); } };
    });
    $('services-settings').addEventListener('click', () => {
      lastFocus = document.activeElement; selectSettingsTab(settingsTab);
      document.querySelector(`[data-settings-tab="${settingsTab}"]`).focus();
      updateThemeSelection();
    });
    $('services-close').addEventListener('click', () => { (lastFocus || $('services-settings')).focus(); });
    $('services-dialog').addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const focusable = [...$('services-dialog').querySelectorAll('button,input,select,textarea,a[href]')].filter(n => !n.disabled && n.tabIndex !== -1 && n.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    selectSettingsTab('connections');
  }

  function updateThemeSelection() {
    document.querySelectorAll('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === $('pv-theme').value)));
    $('workspace-language').value = document.documentElement.lang;
    $('language').value = document.documentElement.lang;
    $('workspace-system-theme').checked = $('pv-theme').value === 'system';
    const colors = {day:'#F3F6F7',night:'#101A24',sand:'#F3EEE4'};
    document.querySelector('meta[name="theme-color"]').content = colors[document.body.dataset.appearance] || colors.day;
  }

  function translateWorkspace() {
    $('pv-toolbar').setAttribute('aria-label',tr('Map tools','Kaartgereedschap','Kartenwerkzeuge'));
    $('pv-nav').setAttribute('aria-label',tr('Workspaces','Werkruimten','Arbeitsbereiche'));
    const eyebrow = document.querySelector('.services-heading .eyebrow'); eyebrow.dataset.pvManaged=''; eyebrow.textContent='PLANVIEW';
    $('pv-research').querySelector('span').textContent = tr('Search', 'Zoeken', 'Suchen');
    $('pv-draw').querySelector('span').textContent = tr('Area', 'Gebied', 'Bereich');
    $('pv-basemap-label').textContent = tr('Base map','Ondergrond','Grundkarte');
    $('pv-ink-label').textContent = tr('Plan rendering','Planweergave','Plandarstellung');
    $('pv-perspective-label').textContent = tr('Map perspective','Kaartperspectief','Kartenperspektive');
    $('pv-basemap').innerHTML = `<option value="street">${tr('Street','Straat','Straße')}</option><option value="bgt">BGT</option><option value="aerial">${tr('Aerial','Luchtfoto','Luftbild')}</option>`;
    $('pv-map-ink').innerHTML = `<option value="clean">${tr('Clear','Helder','Klar')}</option><option value="official">${tr('Official','Officieel','Offiziell')}</option>`;
    $('pv-perspective').innerHTML = `<option value="2d">2D</option><option value="perspective">${tr('Perspective','Perspectief','Perspektive')}</option>`;
    $('pv-perspective').title = tr('Perspective shows 3DBAG building volumes; planning geometry remains two-dimensional.','Perspectief met 3DBAG-gebouwvolumes; plangeometrie blijft tweedimensionaal.','Perspektive mit 3DBAG-Gebäudevolumen; die Plangeometrie bleibt zweidimensional.');
    $('settings-connections-tab').textContent = tr('Connections','Verbindingen','Verbindungen');
    $('settings-appearance-tab').textContent = tr('Appearance & language','Weergave & taal','Darstellung & Sprache');
    $('workspace-theme-label').textContent = tr('Choose your workspace','Kies je werkruimte','Deine Arbeitsoberfläche');
    for (const [theme, labels] of Object.entries({day:['Day','Dag','Tag'],night:['Night','Nacht','Nacht'],sand:['Sand','Zand','Sand']})) document.querySelector(`[data-theme-choice="${theme}"] > span:last-child`).textContent = tr(...labels);
    $('workspace-system-label').textContent = tr('Follow system appearance','Systeemweergave volgen','Darstellung des Systems übernehmen');
    $('workspace-theme-note').textContent = tr('Official map colours stay the same in every theme.','Officiële kaartkleuren blijven gelijk in elk thema.','Amtliche Kartenfarben bleiben in allen Themes gleich.');
    $('workspace-language-label').textContent = tr('Interface language','Interfacetaal','Sprache der Oberfläche');
    $('workspace-local-note').textContent = tr('Your appearance and language are saved on this device.','Je weergave en taal worden op dit apparaat bewaard.','Darstellung und Sprache werden auf diesem Gerät gespeichert.');
    $('workspace-find').textContent = tr('Start a search','Start een zoekopdracht','Recherche starten');
    $('services-settings').setAttribute('aria-label',tr('Settings','Instellingen','Einstellungen'));
    $('services-settings').title = tr('Settings','Instellingen','Einstellungen');
    document.querySelectorAll('#language option').forEach(option => { option.textContent = option.value.toUpperCase(); });
    if($('mobile-map-options'))$('mobile-map-options').querySelector('summary span').textContent=tr('Map options','Kaartopties','Kartenoptionen');
    syncMobileNav();syncMapChoices(); updateThemeSelection();
  }

  function improveDirectSearch() {
    const input = $('search'), list = $('search-results');
    input.setAttribute('role','combobox'); input.setAttribute('aria-autocomplete','list'); input.setAttribute('aria-controls','search-results');
    list.setAttribute('role','listbox');
    let cursor = -1;
    new MutationObserver(() => {
      cursor = -1; input.removeAttribute('aria-activedescendant'); input.setAttribute('aria-expanded', String(!list.hidden));
      list.querySelectorAll('[data-result]').forEach((button, i) => { button.id = `location-option-${i}`; button.setAttribute('role','option'); button.setAttribute('aria-selected','false'); });
    }).observe(list, {childList:true, attributes:true, attributeFilter:['hidden']});
    input.addEventListener('keydown', e => {
      const options = [...list.querySelectorAll('[data-result]')];
      if (list.hidden || !options.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); cursor = (cursor + (e.key === 'ArrowDown' ? 1 : options.length - 1) + options.length) % options.length;
        options.forEach((button, i) => button.setAttribute('aria-selected',String(i === cursor)));
        input.setAttribute('aria-activedescendant', options[cursor].id); options[cursor].scrollIntoView({block:'nearest'});
      } else if (e.key === 'Enter' && cursor >= 0) { e.preventDefault(); e.stopImmediatePropagation(); options[cursor].click(); }
    }, true);
  }

  window.addEventListener('load', () => {
    makeMapTools(); simplifyLayers(); makeSettings(); improveDirectSearch(); makeMobileTools(); translateWorkspace();
    const observer = new MutationObserver(syncLayout);
    observer.observe($('detail-panel'), {attributes:true, attributeFilter:['class']});
    observer.observe($('advanced-panel'), {attributes:true, attributeFilter:['hidden']});
    observer.observe($('pv-workbench'), {attributes:true, attributeFilter:['hidden']});
    new ResizeObserver(() => { state.map?.invalidateSize({pan:false}); state.perspectiveMap?.resize(); }).observe(document.querySelector('.map-stage'));
    window.addEventListener('planview-search-open', e => { if (e.detail.open) layersOpen = false; queueMicrotask(syncLayout); });
    window.addEventListener('planview-view-change', syncLayout);
    window.addEventListener('planview-language-change', translateWorkspace);
    window.addEventListener('resize', () => {
      if (innerWidth < 1360 && !$('advanced-panel').hidden && $('detail-panel').classList.contains('open')) window.planviewUI.closeInspector();
      syncLayout();
    });
    // Topmost transient UI consumes Escape before the original map-level handler.
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('dialog[open]')) return;
      if (!$('services-dialog').hidden) { e.preventDefault(); e.stopImmediatePropagation(); $('services-close').click(); return; }
      const menu = document.querySelector('.pv-action-menu[open]');
      if (menu) { e.preventDefault(); e.stopImmediatePropagation(); menu.open = false; menu.querySelector('summary')?.focus(); return; }
      if (!$('search-results').hidden) { e.preventDefault(); e.stopImmediatePropagation(); $('search-results').hidden = true; $('search').focus(); return; }
      if (window.planviewAdvanced.drawing) { e.preventDefault(); e.stopImmediatePropagation(); window.planviewAdvanced.cancelDrawing(); $('pv-draw').focus(); return; }
      if (document.body.classList.contains('pv-measuring')) return;
      if ($('detail-panel').classList.contains('open')) { e.preventDefault(); e.stopImmediatePropagation(); window.planviewUI.closeInspector(); return; }
      if (!$('advanced-panel').hidden) { e.preventDefault(); e.stopImmediatePropagation(); window.planviewAdvanced.setOpen(false); $('pv-research').focus(); return; }
      if (layersOpen && document.body.dataset.left === 'layers') { e.preventDefault(); e.stopImmediatePropagation(); layersOpen = false; syncLayout(); $('pv-layers').focus(); }
    }, true);
    syncLayout();
  });
})();
