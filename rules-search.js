/* Location-specific rule text research. Evidence is discovered by the server. */
(() => {
  'use strict';
  const lang = () => ['nl', 'de'].includes(document.documentElement.lang) ? document.documentElement.lang : 'en';
  const tr = (en, nl, de) => ({ en, nl, de })[lang()];
  const model = { key: '', point: null, selection: null, query: '', response: null, error: '', loading: false, request: 0, abort: null, node: null, language: '', renderedKey: '' };
  const pointKey = p => Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lng)) ? `${Number(p.lat).toFixed(7)},${Number(p.lng).toFixed(7)}` : '';
  const text = value => typeof value === 'string' ? value : '';
  const el = (tag, className, content) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = String(content);
    return node;
  };
  const currentSelection = () => typeof state === 'undefined' ? null : state.selected;
  function warningText(value) {
    const code = typeof value === 'string' ? value : text(value?.code) || text(value?.errorCode);
    const messages = {
      dso_key_missing: () => tr('A DSO source key is needed to discover current rule documents. Add it in Connections.', 'Een DSO-bronsleutel is nodig om actuele regeldocumenten te vinden. Voeg deze toe bij Verbindingen.', 'Für aktuelle Regeldokumente wird ein DSO-Quellenschlüssel benötigt. Unter Verbindungen hinterlegen.'),
      api_key_missing: () => tr('Add your AI API key in Connections for a cited summary. Available source passages remain readable.', 'Voeg je AI-API-sleutel toe bij Verbindingen voor een samenvatting met bronverwijzingen. Beschikbare bronpassages blijven leesbaar.', 'Für eine Zusammenfassung mit Belegen den KI-API-Schlüssel unter Verbindungen hinterlegen. Verfügbare Originaltexte bleiben lesbar.'),
      source_text_unavailable: () => tr('Original text could not be read from this source.', 'De oorspronkelijke tekst van deze bron kon niet worden gelezen.', 'Der Originaltext dieser Quelle konnte nicht gelesen werden.'),
      dso_unavailable: () => tr('The current-rule document service is unavailable.', 'De service voor actuele regeldocumenten is niet beschikbaar.', 'Der Dienst für aktuelle Regeldokumente ist nicht verfügbar.'),
      ai_unavailable: () => tr('The cited summary is unavailable. Review the original passages below.', 'De samenvatting met bronverwijzingen is niet beschikbaar. Bekijk de oorspronkelijke passages hieronder.', 'Die Zusammenfassung mit Belegen ist nicht verfügbar. Originaltexte unten prüfen.')
    };
    return text(value?.message) || (messages[code] ? messages[code]() : code);
  }
  function safeURL(value) {
    if (typeof value !== 'string') return null;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
  }
  function stop() {
    model.abort?.abort(); model.abort = null; model.request++; model.loading = false;
  }
  function selectionChanged(point) {
    const key = pointKey(point);
    if (key === model.key) return;
    stop(); model.key = key; model.point = point ? { lat: Number(point.lat), lng: Number(point.lng) } : null;
    model.selection = null; model.query = ''; model.response = null; model.error = ''; model.node?.remove(); model.node = null;
  }
  function scopeText(selection) {
    const p = model.point;
    const parts = [tr('Selected point', 'Geselecteerd punt', 'Ausgewählter Punkt') + ` · ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`];
    const parcel = selection?.parcel?.properties;
    if (parcel?.perceelnummer) parts.push(tr('Parcel at point', 'Perceel op dit punt', 'Flurstück am Punkt') + ': ' + [parcel.AKRKadastraleGemeenteCodeWaarde, parcel.sectie, parcel.perceelnummer].filter(Boolean).join(' '));
    if (selection?.municipality?.name) parts.push(selection.municipality.name);
    return parts.join('\n');
  }
  function sourceList(response) {
    const seen = new Set();
    return (Array.isArray(response?.sources) ? response.sources : []).slice(0, 40).filter(source => {
      const id = String(source?.id ?? '');
      if (!id || seen.has(id) || !text(source?.text).trim()) return false;
      seen.add(id); return true;
    });
  }
  function count(value) { return Number.isInteger(value) && value >= 0 ? value : null; }
  function coverageView(response) {
    const coverage = response.coverage || {}, box = el('div', 'pv-rules-coverage');
    const warnings = Array.isArray(coverage.warnings) ? coverage.warnings : [];
    const checked = count(coverage.documentsChecked), available = count(coverage.documentsAvailable);
    const values = [];
    if (checked !== null) values.push(`${checked}${available !== null ? ` / ${available}` : ''} ` + tr('documents checked', 'documenten gecontroleerd', 'Dokumente geprüft'));
    values.push(coverage.complete === true ? tr('Returned text checked', 'Geleverde tekst gecontroleerd', 'Gelieferte Texte geprüft') : tr('Partial source coverage', 'Gedeeltelijke brondekking', 'Quellenlage unvollständig'));
    box.append(el('strong', '', values.join(' · ')));
    const warningBox=el('details','pv-rules-warnings');warningBox.append(el('summary','',tr(`Source notes (${warnings.length})`,`Bronnotities (${warnings.length})`,`Quellenhinweise (${warnings.length})`)));if(warnings.length)box.append(warningBox);
    for (const limit of (Array.isArray(coverage.limits)?coverage.limits:[]).slice(0,3))box.append(el('p','pv-rules-limit',String(limit)));
    for (const warning of warnings.slice(0, 20)) {
      const message = warningText(warning);
      if (message) warningBox.append(el('p', '', message));
    }
    if (warnings.some(warning => ['dso_key_missing', 'api_key_missing'].includes(typeof warning === 'string' ? warning : warning?.code || warning?.errorCode)) && document.getElementById('services-settings')) {
      const button = el('button', 'pv-button pv-rules-connections', tr('Open Connections', 'Open Verbindingen', 'Verbindungen öffnen'));
      button.type = 'button'; button.addEventListener('click', () => document.getElementById('services-settings')?.click()); box.append(button);
    }
    return box;
  }
  function sourceView(source, index) {
    const detail = el('details', 'pv-rules-source');
    detail.id = `pv-rules-source-${index + 1}`;
    const summary = el('summary');
    summary.append(el('span', 'pv-rules-cite-number', String(index + 1)), el('span', '', text(source.article) || text(source.title) || tr('Rule passage', 'Regelpassage', 'Regelpassage')));
    detail.append(summary);
    const body = el('div', 'pv-rules-source-body');
    const documentTitle = text(source.documentTitle) || text(source.title);
    if (documentTitle) body.append(el('p', 'pv-rules-document', documentTitle));
    body.append(el('span', 'pv-rules-applicability', source.applicability === 'point' ? tr('Linked to selected point', 'Gekoppeld aan geselecteerd punt', 'Mit ausgewähltem Punkt verknüpft') : tr('Document context · point applicability unconfirmed', 'Documentcontext · toepassing op punt niet bevestigd', 'Dokumentkontext · Geltung am Punkt unbestätigt')));
    if (source.effectiveFrom) body.append(el('p', 'pv-rules-source-date', tr('Effective from: ', 'Geldig vanaf: ', 'Gültig ab: ') + String(source.effectiveFrom)));
    if(Array.isArray(source.legalRuleKinds)&&source.legalRuleKinds.includes('instructieregels'))body.append(el('p','pv-rules-rule-kind',tr('Instruction addressed to an authority; not individual building permission.','Instructieregel voor een bestuursorgaan; geen individuele bouwtoestemming.','Instruktionsregel für eine Behörde; keine individuelle Baugenehmigung.')));
    for(const condition of (Array.isArray(source.conditions)?source.conditions:[]).slice(0,6))body.append(el('p','pv-rules-linked-condition',tr('Linked applicability condition: ','Gekoppelde toepassingsvoorwaarde: ','Verknüpfte Geltungsbedingung: ')+String(condition)));
    body.append(el('blockquote', 'pv-rules-source-text', source.text));
    const href = safeURL(source.url);
    if (href) { const link = el('a', 'pv-rules-source-link', tr('Read original source ↗', 'Lees oorspronkelijke bron ↗', 'Originalquelle lesen ↗')); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; body.append(link); }
    detail.append(body); return detail;
  }
  function resultView(response) {
    const fragment = document.createDocumentFragment(), sources = sourceList(response), answer = response.answer;
    const citations = Array.isArray(answer?.citations) ? [...new Set(answer.citations.map(id => String(id)))] : [];
    const byId = new Map(sources.map((source, index) => [String(source.id), index]));
    // A generated summary without usable text and resolvable citations is not evidence.
    const grounded = response.state === 'answered' && text(answer?.summary).trim() && citations.length > 0 && citations.every(id => byId.has(id));
    if (grounded) {
      const box = el('div', 'pv-rules-answer');
      box.append(el('div', 'pv-rules-answer-label', answer.verdict === 'not-established' ? tr('Not established from these sources', 'Niet vastgesteld op basis van deze bronnen', 'Aus diesen Quellen nicht festgestellt') : tr('Source-based review', 'Bronnenonderzoek', 'Quellenbasierte Einordnung')));
      const claims=Array.isArray(answer.claims)?answer.claims:[];
      if(claims.length&&claims.every(c=>text(c.statement)&&text(c.quote)&&byId.has(String(c.sourceId)))){
        for(const claim of claims){const item=el('div','pv-rules-claim');item.append(el('p','pv-rules-answer-summary',claim.statement));const quote=el('details','pv-rules-quote');quote.append(el('summary','',tr('Original quote','Oorspronkelijk citaat','Originalzitat')+` · [${byId.get(String(claim.sourceId))+1}]`),el('blockquote','pv-rules-source-text',claim.quote));item.append(quote);box.append(item);}
      }else box.append(el('p', 'pv-rules-answer-summary', answer.summary));
      if (Array.isArray(answer.conditions) && answer.conditions.length) {
        const list = el('ul', 'pv-rules-conditions');
        for (const condition of answer.conditions.slice(0, 12)) if (text(condition).trim()) list.append(el('li', '', condition));
        if (list.childNodes.length) box.append(list);
      }
      const links = el('div', 'pv-rules-citations');
      links.append(el('span', '', tr('Evidence', 'Onderbouwing', 'Belege')));
      for (const id of citations) {
        const index = byId.get(id), button = el('button', '', `[${index + 1}]`);
        button.type = 'button'; button.setAttribute('aria-label', tr(`Read source ${index + 1}`, `Lees bron ${index + 1}`, `Quelle ${index + 1} lesen`));
        button.addEventListener('click', () => { const target = model.node?.querySelector(`#pv-rules-source-${index + 1}`); if (target) { target.open = true; target.querySelector('summary').focus(); target.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); } });
        links.append(button);
      }
      box.append(links); fragment.append(box);
    } else {
      if(answer?.verdict==='not-established'&&Array.isArray(answer.conditions)&&answer.conditions.length){const note=el('div','pv-rules-answer');note.append(el('strong','',tr('Not established from these sources','Niet vastgesteld op basis van deze bronnen','Aus diesen Quellen nicht festgestellt')));const gaps=el('ul','pv-rules-conditions');for(const condition of answer.conditions.slice(0,6))if(text(condition))gaps.append(el('li','',condition));note.append(gaps);fragment.append(note);}
      const message = !sources.length ? tr('No readable rule text was returned. No answer can be established from document titles or map labels alone.', 'Geen leesbare regeltekst ontvangen. Alleen documenttitels of kaartlabels zijn onvoldoende om een antwoord vast te stellen.', 'Es wurde kein lesbarer Regeltext geliefert. Dokumenttitel oder Kartenbeschriftungen allein reichen für eine Antwort nicht aus.') : response.state === 'unavailable' ? tr('Only the passages below are available. An answer could not be established.', 'Alleen de onderstaande passages zijn beschikbaar. Een antwoord kon niet worden vastgesteld.', 'Nur die folgenden Textstellen sind verfügbar. Eine Antwort konnte nicht festgestellt werden.') : tr('Relevant passages are shown below. They do not establish permission for the proposed activity.', 'Relevante passages staan hieronder. Ze stellen geen toestemming voor de voorgenomen activiteit vast.', 'Relevante Textstellen stehen unten. Sie stellen keine Genehmigung für das Vorhaben fest.');
      fragment.append(el('p', 'pv-rules-no-answer', message));
    }
    fragment.append(coverageView(response));
    if (sources.length) {
      fragment.append(el('h4', 'pv-rules-sources-heading', tr('Original rule passages', 'Oorspronkelijke regelpassages', 'Originale Regeltexte')));
      sources.forEach((source, index) => fragment.append(sourceView(source, index)));
    }
    return fragment;
  }
  function paintResults() {
    const node = model.node;
    if (!node) return;
    const input = node.querySelector('textarea'), submit = node.querySelector('[type="submit"]'), cancel = node.querySelector('.pv-rules-cancel'), status = node.querySelector('.pv-rules-status'), results = node.querySelector('.pv-rules-results');
    input.readOnly = model.loading;
    submit.disabled = model.loading || !model.query.trim();
    submit.textContent = model.loading ? tr('Searching rule text…', 'Regeltekst doorzoeken…', 'Regeltexte werden durchsucht…') : tr('Search these rules', 'Doorzoek deze regels', 'Diese Regeln durchsuchen');
    cancel.hidden = !model.loading;
    node.setAttribute('aria-busy', String(model.loading));
    status.classList.toggle('pv-rules-error', !!model.error);
    status.textContent = model.loading ? tr('Discovering documents for this point and checking the original text…', 'Documenten voor dit punt zoeken en de oorspronkelijke tekst controleren…', 'Dokumente für diesen Punkt werden gesucht und Originaltexte geprüft…') : model.error || (model.response ? sourceList(model.response).length ? tr('Source check completed. Review the passages below.', 'Broncontrole afgerond. Bekijk de passages hieronder.', 'Quellenprüfung abgeschlossen. Textstellen unten prüfen.') : tr('Source check completed. No readable rule text returned.', 'Broncontrole afgerond. Geen leesbare regeltekst ontvangen.', 'Quellenprüfung abgeschlossen. Kein lesbarer Regeltext geliefert.') : '');
    results.replaceChildren();
    if (model.response) results.append(resultView(model.response));
  }
  function mount(selection) {
    const section = el('section', 'detail-section pv-rules-search');
    section.dataset.pvTab = 'rules'; section.dataset.pvManaged = ''; section.setAttribute('aria-labelledby', 'pv-tab-rules'); section.setAttribute('role', 'tabpanel');
    section.append(el('div', 'pv-rules-eyebrow', tr('LOCATION RULE RESEARCH', 'REGELONDERZOEK OP LOCATIE', 'REGELRECHERCHE AM STANDORT')));
    section.append(el('h3', '', tr('Ask about this location', 'Stel een vraag over deze locatie', 'Frage zu diesem Standort')));
    section.append(el('p', 'pv-rules-intro', tr('Search the actual published rule text for your proposed activity.', 'Doorzoek de gepubliceerde regeltekst voor je voorgenomen activiteit.', 'Durchsuche veröffentlichte Regeltexte für dein Vorhaben.')));
    section.append(el('p', 'pv-rules-scope', scopeText(selection)));
    section.append(el('p', 'pv-rules-scope-note', tr('Scope: the selected GPS point. Rules can differ within the same parcel; the whole parcel is not checked.', 'Bereik: het geselecteerde GPS-punt. Regels kunnen binnen hetzelfde perceel verschillen; het hele perceel wordt niet gecontroleerd.', 'Prüfumfang: der gewählte GPS-Punkt. Regeln können innerhalb eines Flurstücks abweichen; das gesamte Flurstück wird nicht geprüft.')));
    const form = el('form', 'pv-rules-form');
    const label = el('label', '', tr('What would you like to check?', 'Wat wil je controleren?', 'Was möchtest du prüfen?')); label.htmlFor = 'pv-rules-query';
    const input = el('textarea'); input.id = 'pv-rules-query'; input.rows = 3; input.maxLength = 1000; input.value = model.query; input.required = true;
    input.placeholder = tr('For example: Which rules apply to building a swimming pool here?', 'Bijvoorbeeld: Welke regels gelden hier voor de aanleg van een zwembad?', 'Zum Beispiel: Welche Regeln gelten hier für den Bau eines Pools?');
    input.setAttribute('aria-describedby', 'pv-rules-query-note');
    input.addEventListener('input', () => { model.query = input.value; form.querySelector('[type="submit"]').disabled = model.loading || !model.query.trim(); });
    form.append(label, input);
    const examples = el('div', 'pv-rules-examples'); examples.setAttribute('aria-label', tr('Example questions', 'Voorbeeldvragen', 'Beispielfragen'));
    const presets = [
      [tr('Building', 'Bouwen', 'Bauen'), tr('What conditions apply to building here?', 'Welke voorwaarden gelden hier voor bouwen?', 'Welche Bedingungen gelten hier für das Bauen?')],
      [tr('Pool', 'Zwembad', 'Pool'), tr('What rules apply to a swimming pool here?', 'Welke regels gelden hier voor een zwembad?', 'Welche Regeln gelten hier für einen Pool?')],
      [tr('Height', 'Hoogte', 'Höhe'), tr('Which building and interior height limits apply here?', 'Welke bouwhoogten en inwendige hoogten gelden hier?', 'Welche Gebäude- und Raumhöhen gelten hier?')],
      [tr('Use', 'Gebruik', 'Nutzung'), tr('What uses are allowed here and under which conditions?', 'Welk gebruik is hier toegestaan en onder welke voorwaarden?', 'Welche Nutzungen sind hier unter welchen Bedingungen zulässig?')]
    ];
    for (const [title, query] of presets) { const button = el('button', '', title); button.type = 'button'; button.addEventListener('click', () => { if (model.loading) return; model.query = input.value = query; input.focus({ preventScroll: true }); form.querySelector('[type="submit"]').disabled = false; }); examples.append(button); }
    form.append(examples);
    const note = el('p', 'pv-rules-query-note', tr('Answers need original text and source citations. A missing rule is not permission.', 'Antwoorden vereisen oorspronkelijke tekst en bronverwijzingen. Een ontbrekende regel betekent geen toestemming.', 'Antworten benötigen Originaltexte und Quellenbelege. Eine fehlende Regel bedeutet keine Erlaubnis.')); note.id = 'pv-rules-query-note'; form.append(note);
    const actions = el('div', 'pv-rules-actions'), submit = el('button', 'pv-button primary'); submit.type = 'submit';
    const cancel = el('button', 'pv-button pv-rules-cancel', tr('Cancel', 'Annuleren', 'Abbrechen')); cancel.type = 'button'; cancel.addEventListener('click', () => { stop(); model.error = tr('Search cancelled.', 'Zoekopdracht geannuleerd.', 'Suche abgebrochen.'); paintResults(); input.focus({ preventScroll: true }); });
    actions.append(submit, cancel); form.append(actions); form.addEventListener('submit', event => { event.preventDefault(); run(); }); section.append(form);
    const status = el('p', 'pv-rules-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const results = el('div', 'pv-rules-results'); section.append(status, results);
    model.node = section; model.language = lang(); model.renderedKey = model.key; paintResults(); return section;
  }
  function render(selection = currentSelection()) {
    if (!pointKey(selection?.point)) { selectionChanged(null); return; }
    selectionChanged(selection.point); model.selection = selection;
    const container = document.querySelector('#detail-content .detail-inner');
    if (!container) return;
    if (!model.node || model.language !== lang()) { model.node?.remove(); mount(selection); }
    else model.node.querySelector('.pv-rules-scope').textContent = scopeText(selection);
    const anchor = container.querySelector(':scope > .pv-rule-controls, :scope > [data-pv-tab="rules"]');
    if (model.node.parentNode !== container) { if (anchor) anchor.before(model.node); else container.append(model.node); }
    model.node.hidden = window.planviewUI?.inspectorTab !== 'rules';
    // Refresh tab relationships after adding our section, using the shared controller.
    if (window.planviewUI?.setInspectorTab) window.planviewUI.setInspectorTab(window.planviewUI.inspectorTab);
  }
  async function run() {
    const query = model.query.trim(), selection = model.selection;
    if (!query || !model.point || model.loading || pointKey(currentSelection()?.point) !== model.key) return;
    let rd;
    try { rd = wgs84ToRd(model.point); } catch { rd = null; }
    if (!Array.isArray(rd) || rd.length !== 2 || !rd.every(Number.isFinite)) { model.error = tr('The selected coordinates could not be converted.', 'De geselecteerde coördinaten konden niet worden omgerekend.', 'Die gewählten Koordinaten konnten nicht umgerechnet werden.'); paintResults(); return; }
    stop(); const request = model.request, key = model.key; model.abort = new AbortController();const abortForTimeout=model.abort;setTimeout(()=>{if(model.abort===abortForTimeout){model.error=tr('Rule search timed out. Try a narrower question.','Regelzoekopdracht duurde te lang. Stel een gerichtere vraag.','Regelsuche dauerte zu lange. Frage enger eingrenzen.');abortForTimeout.abort();model.loading=false;paintResults();}},170000);
    model.loading = true; model.error = ''; model.response = null; paintResults();
    const body = { point: { x: rd[0], y: rd[1] }, query, language: lang() };
    const planId = text(selection?.primary?.properties?.plangebied); if (planId) body.planId = planId;
    try {
      const response = await fetch('/api/rules/search', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: model.abort.signal });
      let data; try { data = await response.json(); } catch { throw new Error(tr('The rule service returned an unreadable response.', 'De regelservice gaf een onleesbaar antwoord.', 'Der Regeldienst hat eine unlesbare Antwort geliefert.')); }
      if (!response.ok) {
        const fallback = response.status === 401 || response.status === 403 ? tr('Sign in again to use the private rule search.', 'Meld je opnieuw aan om de privé-regelzoekfunctie te gebruiken.', 'Bitte erneut anmelden, um die private Regelsuche zu verwenden.') : response.status === 404 ? tr('Rule text search is not available on this version yet.', 'Regeltekst zoeken is nog niet beschikbaar in deze versie.', 'Die Regeltextsuche ist in dieser Version noch nicht verfügbar.') : response.status === 429 ? tr('The service is busy. Please try again shortly.', 'De service is bezet. Probeer het zo opnieuw.', 'Der Dienst ist ausgelastet. Bitte kurz warten und erneut versuchen.') : tr('Rule text could not be checked. Try again or open the official sources below.', 'De regeltekst kon niet worden gecontroleerd. Probeer opnieuw of open de officiële bronnen hieronder.', 'Die Regeltexte konnten nicht geprüft werden. Erneut versuchen oder die amtlichen Quellen unten öffnen.');
        throw new Error(text(data?.error) ? data.error.slice(0, 500) : text(data?.error?.message) ? data.error.message.slice(0, 500) : fallback);
      }
      if (!data || typeof data !== 'object' || !['answered', 'matches', 'unavailable'].includes(data.state)) throw new Error(tr('The rule service returned an unexpected result.', 'De regelservice gaf een onverwacht resultaat.', 'Der Regeldienst hat ein unerwartetes Ergebnis geliefert.'));
      if (request !== model.request || key !== model.key || pointKey(currentSelection()?.point) !== key) return;
      model.response = data;
    } catch (error) {
      if (error.name === 'AbortError' || request !== model.request || key !== model.key) return;
      model.error = error.message || tr('Rule search failed.', 'Regelzoekopdracht mislukt.', 'Regelsuche fehlgeschlagen.');
    } finally {
      if (request === model.request && key === model.key) { model.loading = false; model.abort = null; paintResults(); }
    }
  }
  window.planviewRulesSearch = { render, selectionChanged, cancel: () => { stop(); paintResults(); } };
  window.addEventListener('planview-language-change', () => render());
})();
