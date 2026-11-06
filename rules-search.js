/* Location-specific rule text research. Evidence is discovered by the server. */
(() => {
  'use strict';
  const lang = () => ['nl', 'de'].includes(document.documentElement.lang) ? document.documentElement.lang : 'en';
  const tr = (en, nl, de) => ({ en, nl, de })[lang()];
  const model = { key: '', point: null, selection: null, query: '', response: null, error: '', loading: false, request: 0, abort: null, node: null, language: '', renderedKey: '', responseQuery: '' };
  const pointKey = p => Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lng)) ? `${Number(p.lat).toFixed(7)},${Number(p.lng).toFixed(7)}` : '';
  const text = value => typeof value === 'string' ? value : '';
  const el = (tag, className, content) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = String(content);
    return node;
  };
  const currentSelection = () => typeof state === 'undefined' ? null : state.selected;
  // Optional UI lifecycle only: never send question text, addresses or source text.
  function searchFeedback(phase, feedback = model.feedback) {
    const container = model.node?.querySelector('.pv-rules-results');
    if (!feedback?.searchId || !container || typeof window.dispatchEvent !== 'function') return;
    if (phase === 'completed' && (!container.isConnected || feedback.container === container)) return;
    try {
      window.dispatchEvent(new CustomEvent('planview-search-feedback', { detail: { phase, kind: 'rules', searchId: feedback.searchId, ...(phase === 'completed' ? { outcome: feedback.outcome, resultCount: feedback.resultCount } : {}), container } }));
      if (phase === 'completed') feedback.container = container;
    } catch {} // A missing optional feedback integration must not affect research.
  }
  function beginSearchFeedback() {
    try { const searchId = window.crypto?.randomUUID?.(); if (searchId) { model.feedback = { searchId, phase: 'started' }; searchFeedback('started'); return searchId; } } catch {}
    return null;
  }
  function finishSearchFeedback(searchId, outcome, resultCount) {
    if (!searchId || model.feedback?.searchId !== searchId || model.feedback.phase === 'completed' || pointKey(currentSelection()?.point) !== model.key) return;
    Object.assign(model.feedback, { phase: 'completed', outcome, resultCount }); searchFeedback('completed');
  }
  // Translate fixed service diagnostics only. Official titles, quotations and
  // unknown diagnostics stay verbatim so no source meaning is inferred here.
  function diagnosticText(value) {
    const raw=String(value??'');
    const messages={
      'Only the clicked point is checked; applicability across an entire parcel is not established.':['Alleen het aangeklikte punt is gecontroleerd; toepasselijkheid op het gehele perceel is niet vastgesteld.','Nur der angeklickte Punkt wird geprüft; die Geltung für das gesamte Flurstück ist nicht festgestellt.'],
      'Legacy IMRO/TAM plan rules, individual permits, attachments and external legislation are not automatically complete in this DSO corpus.':['Oude IMRO/TAM-planregels, individuele vergunningen, bijlagen en externe wetgeving zijn niet automatisch volledig opgenomen in dit DSO-corpus.','Ältere IMRO-/TAM-Planregeln, Einzelgenehmigungen, Anlagen und externe Rechtsvorschriften sind in diesem DSO-Textbestand nicht automatisch vollständig enthalten.'],
      'A geographically matched rule can be conditional or address a public authority; the match does not establish permission for a proposed activity.':['Een geografisch gekoppelde regel kan voorwaardelijk zijn of aan een bestuursorgaan zijn gericht; de koppeling stelt geen toestemming voor een voorgenomen activiteit vast.','Eine räumlich zugeordnete Regel kann an Bedingungen geknüpft oder an eine Behörde gerichtet sein; die Zuordnung stellt keine Erlaubnis für ein Vorhaben fest.'],
      'Ranked excerpts; cross-references and the whole parcel are not exhaustively assessed.':['Gerangschikte tekstfragmenten; kruisverwijzingen en het gehele perceel zijn niet uitputtend beoordeeld.','Nach Relevanz ausgewählte Auszüge; Querverweise und das gesamte Flurstück sind nicht vollständig geprüft.'],
      'An applicable annotation has no resolvable text reference.':['Een toepasselijke annotatie heeft geen oplosbare tekstverwijzing.','Eine anwendbare Annotation enthält keinen auflösbaren Textverweis.'],
      'DSO returned no selected location identifiers; document text cannot be certified as point-filtered.':['DSO gaf geen geselecteerde locatie-identificaties terug; filtering van de documenttekst op dit punt kan niet worden bevestigd.','DSO hat keine Kennungen ausgewählter Orte geliefert; eine Filterung der Dokumenttexte auf diesen Punkt kann nicht bestätigt werden.'],
      'A text component could not be safely parsed within the text limits.':['Een tekstonderdeel kon binnen de tekstlimieten niet veilig worden verwerkt.','Ein Textbestandteil konnte innerhalb der Textgrenzen nicht sicher verarbeitet werden.'],
      'Internal-reference expansion reached its retrieval limit.':['Het uitwerken van interne verwijzingen heeft de ophaallimiet bereikt.','Die Auflösung interner Verweise hat die Abrufgrenze erreicht.'],
      'Applicable annotations were returned but no current point-filtered text component could be retrieved.':['Toepasselijke annotaties zijn ontvangen, maar er kon geen actueel, op het punt gefilterd tekstonderdeel worden opgehaald.','Anwendbare Annotationen wurden geliefert, aber kein aktueller, auf den Punkt gefilterter Textbestandteil konnte abgerufen werden.'],
      'Some rules refer to external legislation, information objects or attachments that were not retrieved.':['Sommige regels verwijzen naar externe wetgeving, informatieobjecten of bijlagen die niet zijn opgehaald.','Einige Regeln verweisen auf externe Rechtsvorschriften, Informationsobjekte oder Anlagen, die nicht abgerufen wurden.'],
      'Official document discovery reached its pagination limit.':['Het zoeken naar officiële documenten heeft de pagineringslimiet bereikt.','Die amtliche Dokumentensuche hat ihre Seitengrenze erreicht.'],
      'No normative DSO documents were returned; this does not establish that no rules apply.':['Er zijn geen normatieve DSO-documenten ontvangen; dit stelt niet vast dat er geen regels gelden.','Es wurden keine normativen DSO-Dokumente geliefert; daraus folgt nicht, dass keine Regeln gelten.'],
      'Official text or annotations could not be retrieved within the retrieval limits.':['Officiële tekst of annotaties konden binnen de ophaallimieten niet worden opgehaald.','Amtlicher Text oder Annotationen konnten innerhalb der Abrufgrenzen nicht geladen werden.'],
      'The overall 60-second source retrieval budget was reached; remaining regulations are explicitly listed as unavailable.':['De totale ophaaltijd van 60 seconden voor bronnen is bereikt; resterende regelingen staan uitdrukkelijk als niet beschikbaar vermeld.','Das gesamte Zeitbudget von 60 Sekunden für den Quellenabruf wurde erreicht; übrige Regelungen sind ausdrücklich als nicht verfügbar aufgeführt.']
    };
    for(const [en,[nl,de]] of Object.entries(messages)){
      if(raw===en)return tr(en,nl,de);
      if(raw.endsWith(': '+en))return raw.slice(0,-en.length)+tr(en,nl,de);
    }
    const patterns=[
      [/^(.*?)(\d+) referenced components or broad sections were not expanded\.$/,(prefix,n)=>prefix+tr(`${n} referenced components or broad sections were not expanded.`,`${n} onderdelen of brede secties waarnaar wordt verwezen, zijn niet uitgewerkt.`,`${n} referenzierte Bestandteile oder übergreifende Abschnitte wurden nicht aufgelöst.`)],
      [/^(.*?)(\d+) applicable regulations were omitted by the document retrieval limit\.$/,(prefix,n)=>prefix+tr(`${n} applicable regulations were omitted by the document retrieval limit.`,`${n} toepasselijke regelingen zijn door de documentophaallimiet niet opgehaald.`,`${n} anwendbare Regelungen wurden wegen der Dokumentabrufgrenze ausgelassen.`)],
      [/^(.*?)Official request failed \((\d{3})\)\.$/,(prefix,status)=>prefix+tr(`Official request failed (${status}).`,`Officieel verzoek mislukt (${status}).`,`Amtliche Anfrage fehlgeschlagen (${status}).`)],
      [/^The clicked PDOK IMRO source may contain transitional planning rules outside this DSO text corpus: (.+)$/,(id)=>tr('The clicked PDOK IMRO source may contain transitional planning rules outside this DSO text corpus: ','De aangeklikte PDOK-IMRO-bron kan overgangsplanregels buiten dit DSO-tekstcorpus bevatten: ','Die angeklickte PDOK-IMRO-Quelle kann Übergangsplanregeln außerhalb dieses DSO-Textbestands enthalten: ')+id]
    ];
    for(const [pattern,translate] of patterns){const match=raw.match(pattern);if(match)return translate(...match.slice(1));}
    return raw;
  }
  function warningText(value) {
    const code = typeof value === 'string' ? value : text(value?.code) || text(value?.errorCode);
    const messages = {
      dso_key_missing: () => tr('A DSO source key is needed to discover current rule documents. Add it in Connections.', 'Een DSO-bronsleutel is nodig om actuele regeldocumenten te vinden. Voeg deze toe bij Verbindingen.', 'Für aktuelle Regeldokumente wird ein DSO-Quellenschlüssel benötigt. Unter Verbindungen hinterlegen.'),
      api_key_missing: () => tr('Add your AI API key in Connections for a cited summary. Available source passages remain readable.', 'Voeg je AI-API-sleutel toe bij Verbindingen voor een samenvatting met bronverwijzingen. Beschikbare bronpassages blijven leesbaar.', 'Für eine Zusammenfassung mit Belegen den KI-API-Schlüssel unter Verbindungen hinterlegen. Verfügbare Originaltexte bleiben lesbar.'),
      source_text_unavailable: () => tr('Original text could not be read from this source.', 'De oorspronkelijke tekst van deze bron kon niet worden gelezen.', 'Der Originaltext dieser Quelle konnte nicht gelesen werden.'),
      dso_unavailable: () => tr('The current-rule document service is unavailable.', 'De service voor actuele regeldocumenten is niet beschikbaar.', 'Der Dienst für aktuelle Regeldokumente ist nicht verfügbar.'),
      ai_unavailable: () => tr('The cited summary is unavailable. Review the original passages below.', 'De samenvatting met bronverwijzingen is niet beschikbaar. Bekijk de oorspronkelijke passages hieronder.', 'Die Zusammenfassung mit Belegen ist nicht verfügbar. Originaltexte unten prüfen.')
    };
    return text(value?.message) ? diagnosticText(value.message) : messages[code] ? messages[code]() : diagnosticText(code);
  }
  function safeURL(value) {
    if (typeof value !== 'string') return null;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
  }
  function stop() {
    searchFeedback('cleared'); model.feedback = null;
    model.abort?.abort(); model.abort = null; model.request++; model.loading = false;
  }
  function selectionChanged(point) {
    const key = pointKey(point);
    if (key === model.key) return;
    stop(); model.key = key; model.point = point ? { lat: Number(point.lat), lng: Number(point.lng) } : null;
    model.selection = null; model.query = ''; model.responseQuery = ''; model.response = null; model.error = ''; model.node?.remove(); model.node = null;
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
    const coverage = response.coverage || {}, box = el('div', 'pv-rules-coverage'+(response.coverage?.complete===true?'':' pv-rules-coverage-partial'));
    const warnings = Array.isArray(coverage.warnings) ? coverage.warnings : [];
    const checked = count(coverage.documentsChecked), available = count(coverage.documentsAvailable);
    const values = [];
    if (checked !== null) values.push(`${checked}${available !== null ? ` / ${available}` : ''} ` + tr('documents checked', 'documenten gecontroleerd', 'Dokumente geprüft'));
    values.push(coverage.complete === true ? tr('Returned text checked', 'Geleverde tekst gecontroleerd', 'Gelieferte Texte geprüft') : tr('Partial source coverage', 'Gedeeltelijke brondekking', 'Quellenlage unvollständig'));
    box.append(el('strong', '', values.join(' · ')));
    if(coverage.complete!==true)box.append(el('p','pv-rules-coverage-summary',tr('The review below uses the returned excerpts. Missing sources, cross-references and parcel-wide applicability remain open.','De beoordeling hieronder gebruikt de ontvangen tekstfragmenten. Ontbrekende bronnen, kruisverwijzingen en toepasselijkheid op het gehele perceel blijven open.','Die folgende Einordnung nutzt die gelieferten Textauszüge. Fehlende Quellen, Querverweise und die Geltung für das gesamte Flurstück bleiben offen.')));
    const warningBox=el('details','pv-rules-warnings');warningBox.append(el('summary','',tr(`Source notes (${warnings.length})`,`Bronnotities (${warnings.length})`,`Quellenhinweise (${warnings.length})`)));if(warnings.length)box.append(warningBox);
    for (const limit of (Array.isArray(coverage.limits)?coverage.limits:[]))box.append(el('p','pv-rules-limit',diagnosticText(limit)));
    for (const warning of warnings) {
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
    fragment.append(coverageView(response));
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
    submit.textContent = model.loading ? tr('Checking your proposal…', 'Voorstel controleren…', 'Vorhaben wird geprüft…') : tr('Check my proposal', 'Mijn voorstel controleren', 'Vorhaben prüfen');
    cancel.hidden = !model.loading;
    node.setAttribute('aria-busy', String(model.loading));
    status.classList.toggle('pv-rules-error', !!model.error);
    status.textContent = model.loading ? tr('Discovering documents for this point and checking the original text…', 'Documenten voor dit punt zoeken en de oorspronkelijke tekst controleren…', 'Dokumente für diesen Punkt werden gesucht und Originaltexte geprüft…') : model.error || (model.response ? sourceList(model.response).length ? tr('Source check completed. Review the passages below.', 'Broncontrole afgerond. Bekijk de passages hieronder.', 'Quellenprüfung abgeschlossen. Textstellen unten prüfen.') : tr('Source check completed. No readable rule text returned.', 'Broncontrole afgerond. Geen leesbare regeltekst ontvangen.', 'Quellenprüfung abgeschlossen. Kein lesbarer Regeltext geliefert.') : '');
    status.classList.toggle('is-loading',model.loading);
    node.querySelector('.pv-rules-progress').hidden=!model.loading;
    const previous=node.querySelector('.pv-rules-previous');previous.hidden=!model.response;previous.textContent=model.response?tr('Shown result for: ','Getoond resultaat voor: ','Angezeigtes Ergebnis für: ')+model.responseQuery+(model.loading?tr(' · New question is being checked.',' · Nieuwe vraag wordt gecontroleerd.',' · Neue Frage wird geprüft.'):''):'';
    if(results._response!==model.response){results.replaceChildren();if(model.response)results.append(resultView(model.response));results._response=model.response;}
    if (model.feedback?.phase === 'completed') searchFeedback('completed');
  }
  function mount(selection) {
    const section = el('section', 'detail-section pv-rules-search');
    section.dataset.pvTab = 'rules'; section.dataset.pvManaged = ''; section.setAttribute('aria-labelledby', 'pv-tab-rules'); section.setAttribute('role', 'tabpanel');
    section.append(el('div', 'pv-rules-eyebrow', tr('LOCATION RULE RESEARCH', 'REGELONDERZOEK OP LOCATIE', 'REGELRECHERCHE AM STANDORT')));
    section.append(el('h3', '', tr('What would you like to do here?', 'Wat wil je hier doen?', 'Was möchtest du hier tun?')));
    section.append(el('p', 'pv-rules-intro', tr('Search the actual published rule text for your proposed activity.', 'Doorzoek de gepubliceerde regeltekst voor je voorgenomen activiteit.', 'Durchsuche veröffentlichte Regeltexte für dein Vorhaben.')));
    const steps=el('ol','pv-rules-steps');steps.setAttribute('aria-label',tr('How the check works','Hoe de controle werkt','So funktioniert die Prüfung'));
    for(const step of [tr('Describe your proposal','Beschrijf je voorstel','Vorhaben beschreiben'),tr('Check original text','Originele tekst controleren','Originaltexte prüfen'),tr('Clarify open points','Open punten verduidelijken','Offene Punkte klären')])steps.append(el('li','',step));section.append(steps);
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
    const progress=el('div','pv-progress pv-rules-progress');progress.setAttribute('role','progressbar');progress.setAttribute('aria-label',tr('Rule text check','Regeltekstcontrole','Regeltextprüfung'));progress.append(el('span'));progress.hidden=true;
    const previous=el('p','pv-rules-previous');previous.hidden=true;
    const results = el('div', 'pv-rules-results'); section.append(status, progress, previous, results);
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
    if (model.feedback?.phase === 'completed') searchFeedback('completed');
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
    stop(); const request = model.request, key = model.key, feedbackId = beginSearchFeedback(); let feedbackOutcome = null, feedbackCount = null;
    model.abort = new AbortController();const abortForTimeout=model.abort;setTimeout(()=>{if(model.abort===abortForTimeout){model.error=tr('Rule search timed out. Try a narrower question.','Regelzoekopdracht duurde te lang. Stel een gerichtere vraag.','Regelsuche dauerte zu lange. Frage enger eingrenzen.');abortForTimeout.abort();model.loading=false;paintResults();finishSearchFeedback(feedbackId,'error',null);}},170000);
    model.loading = true; model.error = ''; paintResults();
    const body = { point: { x: rd[0], y: rd[1] }, query, language: lang() };
    const planId = text(selection?.primary?.properties?.plangebied); if (planId) body.planId = planId;
    try {
      const response = await fetch('/api/rules/search', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: model.abort.signal });
      let data; try { data = await response.json(); } catch { throw new Error(tr('The rule service returned an unreadable response.', 'De regelservice gaf een onleesbaar antwoord.', 'Der Regeldienst hat eine unlesbare Antwort geliefert.')); }
      if (!response.ok) {
        const fallback = response.status === 401 || response.status === 403 ? tr('Sign in again to use the private rule search.', 'Meld je opnieuw aan om de privé-regelzoekfunctie te gebruiken.', 'Bitte erneut anmelden, um die private Regelsuche zu verwenden.') : response.status === 404 ? tr('Rule text search is not available on this version yet.', 'Regeltekst zoeken is nog niet beschikbaar in deze versie.', 'Die Regeltextsuche ist in dieser Version noch nicht verfügbar.') : response.status === 429 ? tr('The service is busy. Please try again shortly.', 'De service is bezet. Probeer het zo opnieuw.', 'Der Dienst ist ausgelastet. Bitte kurz warten und erneut versuchen.') : tr('Rule text could not be checked. Try again or open the official sources below.', 'De regeltekst kon niet worden gecontroleerd. Probeer opnieuw of open de officiële bronnen hieronder.', 'Die Regeltexte konnten nicht geprüft werden. Erneut versuchen oder die amtlichen Quellen unten öffnen.');
        const code = text(data?.error);
        throw new Error(['weekly_search_limit', 'weekly_quota_unavailable'].includes(code) ? window.planviewAIMessage?.(code) || fallback : code ? code.slice(0, 500) : text(data?.error?.message) ? data.error.message.slice(0, 500) : fallback);
      }
      if (!data || typeof data !== 'object' || !['answered', 'matches', 'unavailable'].includes(data.state)) throw new Error(tr('The rule service returned an unexpected result.', 'De regelservice gaf een onverwacht resultaat.', 'Der Regeldienst hat ein unerwartetes Ergebnis geliefert.'));
      if (abortForTimeout.signal.aborted || request !== model.request || key !== model.key || pointKey(currentSelection()?.point) !== key) return;
      model.response = data;model.responseQuery=query;
      feedbackCount = sourceList(data).length; feedbackOutcome = data.state === 'unavailable' ? feedbackCount ? 'partial' : 'error' : !feedbackCount ? 'empty' : data.coverage?.partial ? 'partial' : 'complete';
    } catch (error) {
      if (error.name === 'AbortError' || request !== model.request || key !== model.key) return;
      model.error = error.message || tr('Rule search failed.', 'Regelzoekopdracht mislukt.', 'Regelsuche fehlgeschlagen.');
      feedbackOutcome = 'error';
    } finally {
      if (request === model.request && key === model.key && pointKey(currentSelection()?.point) === key) { model.loading = false; model.abort = null; paintResults(); if (feedbackOutcome) finishSearchFeedback(feedbackId, feedbackOutcome, feedbackCount); }
    }
  }
  window.planviewRulesSearch = { render, selectionChanged, cancel: () => { stop(); paintResults(); } };
  window.addEventListener('planview-language-change', () => render());
})();
