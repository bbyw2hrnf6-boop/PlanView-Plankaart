/* On-demand official permit publications for the selected location.
   This module has no map, rules or area-search side effects. */
(() => {
  'use strict';
  const language = () => ['nl', 'de'].includes(document.documentElement.lang) ? document.documentElement.lang : 'en';
  const tr = (en, nl, de) => ({ en, nl, de })[language()];
  const text = value => typeof value === 'string' ? value : '';
  const pointKey = point => point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)) ? `${Number(point.lat).toFixed(7)},${Number(point.lng).toFixed(7)}` : '';
  const currentSelection = () => typeof state === 'undefined' ? null : state.selected;
  const activePointKey = () => typeof state === 'undefined' ? '' : pointKey(state.selectedPoint || state.selected?.point);
  const cache = new Map();
  const model = { key: '', selection: null, entry: null, node: null, language: '', active: false, request: 0, controller: null, timeout: null, questionRequest: 0, questionController: null, questionTimeout: null };
  const statuses = ['submitted', 'granted', 'refused', 'withdrawn', 'revoked', 'mixed', 'draft', 'extended', 'amended', 'unknown'];
  const el = (tag, className, content) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = String(content);
    return node;
  };
  function statusLabel(status) {
    const labels = {
      submitted: ['Application published', 'Aanvraag gepubliceerd', 'Antrag veröffentlicht'],
      granted: ['Granted', 'Verleend', 'Genehmigt'],
      refused: ['Refused', 'Geweigerd', 'Abgelehnt'],
      withdrawn: ['Withdrawn', 'Ingetrokken', 'Zurückgezogen'],
      mixed: ['Partially granted / refused', 'Gedeeltelijk verleend / geweigerd', 'Teilweise genehmigt / abgelehnt'],
      revoked: ['Permit revoked', 'Vergunning ingetrokken', 'Genehmigung widerrufen'],
      draft: ['Draft decision', 'Ontwerpbesluit', 'Entwurfsentscheidung'],
      extended: ['Procedure extended', 'Procedure verlengd', 'Verfahren verlängert'],
      amended: ['Amended', 'Gewijzigd', 'Geändert'],
      unknown: ['Not established', 'Niet vastgesteld', 'Nicht festgestellt']
    };
    return tr(...(labels[status] || labels.unknown));
  }
  function safeURL(value) {
    try { const url = new URL(value); return typeof value === 'string' && url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
  }
  function link(value, label) {
    const href = safeURL(value);
    if (!href) return null;
    const node = el('a', 'pv-permits-source-link', label);
    node.href = href; node.target = '_blank'; node.rel = 'noopener noreferrer';
    return node;
  }
  function dateLabel(value, withTime = false) {
    if (!text(value)) return tr('Date unavailable', 'Datum niet beschikbaar', 'Datum nicht verfügbar');
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T12:00:00Z' : value);
    if (!Number.isFinite(date.getTime())) return tr('Date unavailable', 'Datum niet beschikbaar', 'Datum nicht verfügbar');
    return withTime ? date.toLocaleString(language()) : date.toLocaleDateString(language(), { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function parcelId(selection) {
    const properties = selection?.parcel?.properties || {};
    return String(properties.identificatie || properties.identificatie_lokaal_id || selection?.parcelScreenEvidence?.parcel?.id || '').slice(0, 160);
  }
  const entryKey = selection => pointKey(selection?.point) + '|' + parcelId(selection);
  function stop(cancelled = false) {
    clearTimeout(model.timeout); model.timeout = null;
    model.controller?.abort(); model.controller = null; model.request++;
    if (model.entry?.loading) {
      model.entry.loading = false; model.entry.cancelled = cancelled;
      // A location change may retry on the next explicit opening of this tab.
      if (!cancelled) model.entry.attempted = !!model.entry.response;
    }
  }
  function stopQuestion(cancelled = false) {
    clearTimeout(model.questionTimeout); model.questionTimeout = null;
    model.questionController?.abort(); model.questionController = null; model.questionRequest++;
    if (model.entry?.question.loading) { model.entry.question.loading = false; model.entry.question.cancelled = cancelled; }
  }
  function selectionChanged(point) {
    const key = pointKey(point);
    if (key === model.key) return;
    stop(); stopQuestion(); model.key = key; model.selection = null; model.entry = null;
    model.node?.remove(); model.node = null; model.active = false;
  }
  function selectedStillMatches(key) {
    return key === model.key && key === pointKey(currentSelection()?.point) && (!activePointKey() || key === activePointKey());
  }
  function entryFor(selection) {
    const key = entryKey(selection);
    if (!cache.has(key)) cache.set(key, { key, response: null, query: '', status: '', year: '', associationView: 'direct', filtersOpen: false, error: '', cancelled: false, attempted: false, loading: false, expanded: new Set(), question: { query: '', response: null, responseQuery: '', loading: false, error: '', cancelled: false } });
    const entry = cache.get(key);
    // Bounded in-memory cache; no addresses or publications are persisted.
    cache.delete(key); cache.set(key, entry);
    while (cache.size > 12) cache.delete(cache.keys().next().value);
    return entry;
  }
  function caseEvents(item) { return (Array.isArray(item?.events) ? item.events : []).filter(value => value && typeof value === 'object'); }
  function yearValues(item) {
    return [...new Set([item?.latestDate, ...caseEvents(item).map(event => event.date)].map(value => /^\d{4}-/.test(text(value)) ? value.slice(0, 4) : '').filter(Boolean))];
  }
  const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function matches(item, entry) {
    if (entry.status && item.status !== entry.status) return false;
    if (entry.year && !yearValues(item).includes(entry.year)) return false;
    const haystack = normalized([item.title, item.summary, ...caseEvents(item).flatMap(event => [event.title, event.summary, event.caseNumber])].join(' '));
    return normalized(entry.query).trim().split(/\s+/).filter(Boolean).every(word => haystack.includes(word));
  }
  function lastDecision(events) {
    const decisive = new Set(['granted', 'refused', 'withdrawn', 'revoked', 'mixed']);
    return events.filter(event => decisive.has(event.status)).sort((a, b) => text(a.decisionDate || a.date).localeCompare(text(b.decisionDate || b.date)) || text(a.date).localeCompare(text(b.date)) || text(a.id).localeCompare(text(b.id))).at(-1);
  }
  function mergeResponse(previous, incoming) {
    if (!previous) return incoming;
    const cases = new Map();
    for (const item of [...previous.cases, ...incoming.cases]) {
      const old = cases.get(item.id);
      if (!old) { cases.set(item.id, item); continue; }
      const byId = new Map([...caseEvents(old), ...caseEvents(item)].map(event => [event.id || event.url, event]));
      const events = [...byId.values()].sort((a, b) => text(a.date).localeCompare(text(b.date)) || text(a.id).localeCompare(text(b.id)));
      const latest = events.at(-1), decision = lastDecision(events);
      const newest = text(item.latestDate) > text(old.latestDate) ? item : old;
      const rank = association => association?.certain === true ? association.kind === 'parcel' ? 5 : 4 : association?.kind === 'title_address' ? 3 : association?.kind === 'area' ? 2 : association?.kind === 'mapped_location' ? 1 : 0;
      const association = rank(item.association) > rank(old.association) ? item.association : old.association;
      cases.set(item.id, { ...old, ...newest, events, association, ...(latest ? { latestDate: latest.date, title: latest.title, summary: latest.summary, status: (decision || latest).status, statusDate: (decision || latest).decisionDate || (decision || latest).date, statusEventId: (decision || latest).id } : {}) });
    }
    const warnings = [...new Set([...(previous.coverage?.warnings || []), ...(incoming.coverage?.warnings || [])])].filter(code => code !== 'more_publications_available' || !!incoming.nextCursor || incoming.coverage?.hasMore === true);
    return { ...incoming, cases: [...cases.values()].sort((a, b) => text(b.latestDate).localeCompare(text(a.latestDate))), coverage: { ...incoming.coverage, warnings, partial: previous.coverage?.partial === true || incoming.coverage?.partial === true } };
  }
  function isCertain(item) { return item.association?.certain === true && ['parcel', 'address'].includes(item.association.kind); }
  function isDirect(item) { return isCertain(item) || item.association?.kind === 'title_address'; }
  function isArea(item) { return item.association?.kind === 'area' && ['contains_point', 'intersects_parcel'].includes(item.association.relation); }
  function associationLabel(item) {
    if (item.association?.kind === 'title_address') return tr('Address recognised in title · parcel link inferred', 'Adres herkend in titel · perceelkoppeling afgeleid', 'Adresse im Titel erkannt · Grundstücksbezug abgeleitet') + (item.association.label ? ' · ' + item.association.label : '');
    if (isCertain(item)) return item.association.kind === 'parcel' ? tr('Explicit parcel match', 'Expliciete perceelkoppeling', 'Flurstück ausdrücklich genannt') : tr('Address matched within parcel', 'Adres gekoppeld binnen perceel', 'Adresse im Flurstück zugeordnet');
    if (isArea(item)) return item.association.relation === 'contains_point' ? tr('Published area covers selected point · exact parcel unconfirmed', 'Gepubliceerd gebied omvat geselecteerd punt · exact perceel onbevestigd', 'Veröffentlichter Bereich umfasst ausgewählten Punkt · genaues Flurstück unbestätigt') : tr('Published area overlaps selected parcel · exact parcel unconfirmed', 'Gepubliceerd gebied overlapt geselecteerd perceel · exact perceel onbevestigd', 'Veröffentlichter Bereich überschneidet ausgewähltes Flurstück · genaues Flurstück unbestätigt');
    return item.association?.kind === 'nearby' ? tr('Nearby publication · parcel match unconfirmed', 'Publicatie in de buurt · perceelkoppeling onbevestigd', 'Veröffentlichung in der Nähe · Flurstück unbestätigt') : tr('Mapped location · parcel match unconfirmed', 'Locatie op kaart · perceelkoppeling onbevestigd', 'Kartierter Ort · Flurstück unbestätigt');
  }
  function broadAreaNote(item) {
    return isArea(item) && item.association.broad === true ? el('p', 'pv-permits-match-note', tr('This publication covers a broad area. Its overlap does not establish an application for this exact parcel.', 'Deze publicatie omvat een groot gebied. Overlap stelt geen aanvraag voor dit exacte perceel vast.', 'Diese Veröffentlichung umfasst ein großes Gebiet. Eine Überschneidung belegt keinen Antrag für dieses genaue Flurstück.')) : null;
  }
  function scopeLabel() {
    const selection = model.selection, properties = selection?.parcel?.properties || {}, response = model.entry?.response;
    const label = response?.location?.parcelLabel || [properties.AKRKadastraleGemeenteCodeWaarde || properties.akr_kadastrale_gemeente_code_waarde, properties.sectie, properties.perceelnummer].filter(value => value != null && value !== '').join(' ');
    const parts = [];
    if (label) parts.push(tr('Parcel: ', 'Perceel: ', 'Flurstück: ') + label);
    if (text(selection?.point?.address)) parts.push(selection.point.address);
    if (selection?.point) parts.push(`${Number(selection.point.lat).toFixed(6)}, ${Number(selection.point.lng).toFixed(6)}`);
    return parts.join(' · ');
  }
  function warningLabel(value) {
    const code = typeof value === 'string' ? value : text(value?.code) || text(value?.errorCode);
    const labels = {
      notice_status_not_legal_finality: ['A publication status does not establish that a decision is legally final.', 'De publicatiestatus stelt niet vast dat een besluit onherroepelijk is.', 'Ein Veröffentlichungsstatus belegt keine Rechtskraft der Entscheidung.'],
      parcel_query_truncated: ['The parcel lookup returned only part of the available data.', 'De perceelzoekopdracht gaf slechts een deel van de beschikbare gegevens.', 'Die Flurstücksabfrage lieferte nur einen Teil der verfügbaren Daten.'],
      parcel_unavailable: ['The cadastral parcel could not be retrieved. Location matches remain uncertain.', 'Het kadastrale perceel kon niet worden opgehaald. Locatiekoppelingen blijven onzeker.', 'Das Katasterflurstück konnte nicht geladen werden. Standortzuordnungen bleiben unsicher.'],
      address_unavailable: ['Address data could not be retrieved.', 'Adresgegevens konden niet worden opgehaald.', 'Adressdaten konnten nicht geladen werden.'],
      parcel_ambiguous: ['More than one parcel was found at the selected point. Parcel association is unconfirmed.', 'Er is meer dan één perceel op het geselecteerde punt gevonden. De perceelkoppeling is onbevestigd.', 'Am ausgewählten Punkt wurde mehr als ein Flurstück gefunden. Die Zuordnung ist unbestätigt.'],
      parcel_not_found: ['No parcel was found at the selected point. Results use location proximity.', 'Geen perceel gevonden op het geselecteerde punt. Resultaten gebruiken nabijheid.', 'Am ausgewählten Punkt wurde kein Flurstück gefunden. Ergebnisse beruhen auf räumlicher Nähe.'],
      parcel_identity_changed: ['The current cadastral parcel differs from the selected parcel reference.', 'Het actuele kadastrale perceel wijkt af van de geselecteerde perceelreferentie.', 'Das aktuelle Katasterflurstück weicht vom ausgewählten Flurstücksbezug ab.'],
      address_candidates_limited: ['The address lookup reached its retrieval limit.', 'De adreszoekopdracht bereikte de ophaallimiet.', 'Die Adresssuche erreichte ihre Abrufgrenze.'],
      large_parcel_search_limited: ['The parcel extends beyond the bounded location search. Some publications may be missing.', 'Het perceel strekt zich uit buiten de begrensde locatiezoekopdracht. Publicaties kunnen ontbreken.', 'Das Flurstück reicht über die begrenzte Standortsuche hinaus. Veröffentlichungen können fehlen.'],
      notice_document_unavailable: ['Some original publication text could not be retrieved. Open the original source.', 'Sommige oorspronkelijke publicatieteksten konden niet worden opgehaald. Open de oorspronkelijke bron.', 'Einige Originaltexte konnten nicht geladen werden. Die Originalquelle öffnen.'],
      notice_text_truncated: ['Some publication text was shortened for retrieval. Open the original source for the complete notice.', 'Sommige publicatietekst is bij het ophalen ingekort. Open de oorspronkelijke bron voor de volledige kennisgeving.', 'Einige Veröffentlichungstexte wurden beim Abruf gekürzt. Die vollständige Bekanntmachung steht in der Originalquelle.'],
      result_limit: ['The publication search reached its result limit. This is a partial selection.', 'De publicatiezoekopdracht bereikte de resultaatlimiet. Dit is een gedeeltelijke selectie.', 'Die Veröffentlichungssuche erreichte ihre Ergebnisgrenze. Dies ist eine Teilauswahl.'],
      more_publications_available: ['More publications can be loaded below.', 'Meer publicaties kunnen hieronder worden geladen.', 'Weitere Veröffentlichungen können unten geladen werden.'],
      address_search_limited: ['Only a bounded set of parcel addresses was included in the publication search.', 'Slechts een begrensde selectie perceeladressen is in de publicatiezoekopdracht opgenomen.', 'Nur eine begrenzte Auswahl der Flurstücksadressen wurde in die Suche aufgenommen.'],
      historical_coverage_unknown: ['Historical publication coverage is not exhaustive.', 'De historische publicatiedekking is niet volledig.', 'Die historischen Veröffentlichungen sind nicht vollständig erfasst.'],
      historical_completeness_unknown: ['Historical publication coverage is not exhaustive.', 'De historische publicatiedekking is niet volledig.', 'Die historischen Veröffentlichungen sind nicht vollständig erfasst.'],
      location_match_uncertain: ['Some publications cannot be confirmed for this parcel.', 'Sommige publicaties kunnen niet voor dit perceel worden bevestigd.', 'Einige Veröffentlichungen lassen sich diesem Flurstück nicht sicher zuordnen.'],
      source_unavailable: ['Some official publications could not be retrieved.', 'Sommige officiële publicaties konden niet worden opgehaald.', 'Einige amtliche Veröffentlichungen konnten nicht geladen werden.'],
      source_text_unavailable: ['Some original text is unavailable. Open the original publication.', 'Sommige oorspronkelijke tekst is niet beschikbaar. Open de oorspronkelijke publicatie.', 'Einige Originaltexte sind nicht verfügbar. Originalveröffentlichung öffnen.'],
      api_key_missing: ['Add your AI API key in Connections for a cited summary. Original publications remain available.', 'Voeg je AI-API-sleutel toe bij Verbindingen voor een samenvatting met bronverwijzingen. Oorspronkelijke publicaties blijven beschikbaar.', 'Für eine Zusammenfassung mit Belegen den KI-API-Schlüssel unter Verbindungen hinterlegen. Originalveröffentlichungen bleiben verfügbar.'],
      ai_unavailable: ['The cited summary is unavailable. Review the original publications below.', 'De samenvatting met bronverwijzingen is niet beschikbaar. Bekijk de oorspronkelijke publicaties hieronder.', 'Die Zusammenfassung mit Belegen ist nicht verfügbar. Originalveröffentlichungen unten prüfen.'],
      ai_busy: ['The summary service is busy. Review the original publications or retry later.', 'De samenvattingsservice is bezet. Bekijk de oorspronkelijke publicaties of probeer later opnieuw.', 'Der Zusammenfassungsdienst ist ausgelastet. Originalveröffentlichungen prüfen oder später erneut versuchen.'],
      query_retrieval_limited: ['The search reached its publication retrieval limit. Additional relevant publications may be missing.', 'De zoekopdracht bereikte de ophaallimiet voor publicaties. Aanvullende relevante publicaties kunnen ontbreken.', 'Die Suche erreichte die Abrufgrenze für Veröffentlichungen. Weitere relevante Veröffentlichungen können fehlen.'],
      permit_question_retrieval_limited: ['The search reached its publication retrieval limit. Additional relevant publications may be missing.', 'De zoekopdracht bereikte de ophaallimiet voor publicaties. Aanvullende relevante publicaties kunnen ontbreken.', 'Die Suche erreichte die Abrufgrenze für Veröffentlichungen. Weitere relevante Veröffentlichungen können fehlen.'],
      uncertain_permit_association: ['Some publications relate to a mapped point or area. Their exact connection to this parcel is unconfirmed.', 'Sommige publicaties hebben betrekking op een punt of gebied op de kaart. Hun precieze verband met dit perceel is niet bevestigd.', 'Einige Veröffentlichungen beziehen sich auf einen kartierten Punkt oder Bereich. Ihr genauer Bezug zu diesem Flurstück ist unbestätigt.'],
      permit_question_ranked_not_exhaustive: ['Results are ranked by relevance to the question. This is a selection of publications, not an exhaustive permit history.', 'Resultaten zijn gerangschikt op relevantie voor de vraag. Dit is een selectie van publicaties, geen volledig vergunningverloop.', 'Ergebnisse sind nach Relevanz zur Frage geordnet. Dies ist eine Auswahl von Veröffentlichungen, kein vollständiger Antragsverlauf.'],
      attachments_not_retrieved: ['Not all attachments, drawings and full decisions were read. Check the document and page coverage and open the originals.', 'Niet alle bijlagen, tekeningen en volledige besluiten zijn gelezen. Controleer de document- en paginadekking en open de oorspronkelijke bronnen.', 'Nicht alle Anlagen, Zeichnungen und vollständigen Bescheide wurden gelesen. Dokument- und Seitenabdeckung prüfen und Originalquellen öffnen.'],
      permit_question_page_unavailable: ['A further page of publications could not be retrieved. The search is incomplete; the sources already found remain available.', 'Een volgende pagina met publicaties kon niet worden opgehaald. De zoekopdracht is onvolledig; eerder gevonden bronnen blijven beschikbaar.', 'Eine weitere Seite mit Veröffentlichungen konnte nicht geladen werden. Die Suche ist unvollständig; bereits gefundene Quellen bleiben verfügbar.'],
      permit_intent_unavailable: ['The question could not be interpreted automatically. The original question and available search terms were used.', 'De vraag kon niet automatisch worden geïnterpreteerd. De oorspronkelijke vraag en beschikbare zoektermen zijn gebruikt.', 'Die Frage konnte nicht automatisch eingeordnet werden. Verwendet wurden die ursprüngliche Frage und verfügbare Suchbegriffe.'],
      permit_intent_busy: ['The question interpretation service is busy. The original question and available search terms were used.', 'De service voor vraaginterpretatie is bezet. De oorspronkelijke vraag en beschikbare zoektermen zijn gebruikt.', 'Der Dienst zum Einordnen der Frage ist ausgelastet. Verwendet wurden die ursprüngliche Frage und verfügbare Suchbegriffe.'],
      permit_documents_not_loaded: ['Linked permit documents were not loaded in this environment. The available notice text remains readable; open the originals for attachments.', 'Gekoppelde vergunningdocumenten zijn in deze omgeving niet geladen. De beschikbare kennisgevingstekst blijft leesbaar; open de oorspronkelijke bronnen voor bijlagen.', 'Verknüpfte Genehmigungsdokumente wurden in dieser Umgebung nicht geladen. Verfügbare Bekanntmachungstexte bleiben lesbar; Anlagen über die Originalquellen öffnen.'],
      permit_document_unavailable: ['A linked document could not be retrieved. Other available sources remain readable.', 'Een gekoppeld document kon niet worden opgehaald. Andere beschikbare bronnen blijven leesbaar.', 'Ein verknüpftes Dokument konnte nicht geladen werden. Andere verfügbare Quellen bleiben lesbar.'],
      permit_document_limit: ['Document retrieval reached its limit. Some linked documents were not checked.', 'Het ophalen van documenten bereikte de limiet. Sommige gekoppelde documenten zijn niet gecontroleerd.', 'Der Dokumentabruf erreichte seine Grenze. Einige verknüpfte Dokumente wurden nicht geprüft.'],
      permit_document_deadline: ['The document retrieval time limit was reached. Some documents or pages remain unchecked.', 'De tijdslimiet voor het ophalen van documenten is bereikt. Sommige documenten of pagina’s zijn nog niet gecontroleerd.', 'Das Zeitlimit für den Dokumentabruf wurde erreicht. Einige Dokumente oder Seiten bleiben ungeprüft.'],
      permit_document_text_truncated: ['Some document text is shown as a shortened excerpt. Open the original document for the complete page.', 'Sommige documenttekst wordt als ingekort fragment getoond. Open het oorspronkelijke document voor de volledige pagina.', 'Einige Dokumenttexte werden als gekürzte Auszüge angezeigt. Die vollständige Seite im Originaldokument öffnen.'],
      permit_document_pages_limited: ['Only selected document pages were read. Other pages may contain relevant information.', 'Alleen geselecteerde documentpagina’s zijn gelezen. Andere pagina’s kunnen relevante informatie bevatten.', 'Nur ausgewählte Dokumentseiten wurden gelesen. Andere Seiten können relevante Informationen enthalten.'],
      permit_document_ocr: ['Some scanned pages were read using text recognition (OCR). Check quoted passages against the original.', 'Sommige gescande pagina’s zijn gelezen met tekstherkenning (OCR). Controleer citaten aan de hand van het origineel.', 'Einige gescannte Seiten wurden mit Texterkennung (OCR) gelesen. Zitierte Stellen mit dem Original abgleichen.'],
      permit_document_ocr_uncertain: ['Text recognition can misread words and numbers. Verify important details in the original page.', 'Tekstherkenning kan woorden en getallen verkeerd lezen. Controleer belangrijke gegevens op de oorspronkelijke pagina.', 'Texterkennung kann Wörter und Zahlen falsch lesen. Wichtige Angaben auf der Originalseite prüfen.'],
      permit_document_extraction_unavailable: ['Text extraction for linked documents is unavailable. Read the notice or open the original documents.', 'Tekstextractie van gekoppelde documenten is niet beschikbaar. Lees de kennisgeving of open de oorspronkelijke documenten.', 'Textextraktion für verknüpfte Dokumente ist nicht verfügbar. Bekanntmachung lesen oder Originaldokumente öffnen.'],
      permit_document_links_blocked: ['Some linked documents could not be opened by the retrieval service. Use the original source links.', 'Sommige gekoppelde documenten konden niet door de ophaalservice worden geopend. Gebruik de oorspronkelijke bronlinks.', 'Einige verknüpfte Dokumente konnten vom Abrufdienst nicht geöffnet werden. Links zu den Originalquellen verwenden.'],
      broad_area_match: ['A published area may cover a larger region. Its overlap does not establish an application for this exact parcel.', 'Een gepubliceerd gebied kan een grotere regio omvatten. Overlap stelt geen aanvraag voor dit exacte perceel vast.', 'Ein veröffentlichter Bereich kann ein größeres Gebiet umfassen. Eine Überschneidung belegt keinen Antrag für dieses genaue Flurstück.'],
      rate_limited: ['The publication service is busy. Retry later.', 'De publicatieservice is bezet. Probeer later opnieuw.', 'Der Veröffentlichungsdienst ist ausgelastet. Später erneut versuchen.']
    };
    return labels[code] ? tr(...labels[code]) : text(value?.message) || tr('An additional source limitation was reported. Check the original publications.', 'Er is een aanvullende bronbeperking gemeld. Controleer de oorspronkelijke publicaties.', 'Eine weitere Einschränkung der Quellen wurde gemeldet. Originalveröffentlichungen prüfen.');
  }
  function coverageView(response) {
    const coverage = response.coverage || {}, box = el('div', 'pv-permits-coverage');
    const unavailable = response.state === 'unavailable' || coverage.available === false;
    if (unavailable || coverage.partial === true) box.classList.add('pv-feedback-warning');
    box.append(el('strong', '', unavailable ? tr('Publication retrieval unavailable', 'Publicaties ophalen niet beschikbaar', 'Veröffentlichungen derzeit nicht abrufbar') : coverage.partial === true ? tr('Retrieval incomplete', 'Ophalen onvolledig', 'Abruf unvollständig') : tr('Official publications retrieved', 'Officiële publicaties opgehaald', 'Amtliche Veröffentlichungen abgerufen')));
    box.append(el('p', '', tr('This is a publication search, not a complete building file. A missing result does not establish that no application was made. Historical parcels and addresses may differ.', 'Dit is een publicatiezoekopdracht, geen compleet bouwdossier. Geen resultaat betekent niet dat er nooit een aanvraag is gedaan. Historische percelen en adressen kunnen verschillen.', 'Dies ist eine Veröffentlichungssuche, keine vollständige Bauakte. Ein fehlender Treffer belegt nicht, dass es nie einen Antrag gab. Historische Flurstücke und Adressen können abweichen.')));
    const notes = (Array.isArray(coverage.warnings) ? coverage.warnings : []).map(warningLabel).filter(Boolean);
    if (notes.length) {
      const detail = el('details', 'pv-permits-source-notes'); detail.append(el('summary', '', tr('Source notes', 'Bronnotities', 'Quellenhinweise') + ` (${notes.length})`));
      for (const note of notes) detail.append(el('p', '', note)); box.append(detail);
    }
    const source = el('p', 'pv-permits-provenance');
    const sourceLink = link('https://zoek.officielebekendmakingen.nl/', 'Officiële Bekendmakingen · KOOP ↗');
    if (sourceLink) source.append(sourceLink);
    if (response.retrievedAt) source.append(el('span', '', tr('Retrieved: ', 'Opgehaald: ', 'Abgerufen: ') + dateLabel(response.retrievedAt, true)));
    box.append(source); return box;
  }
  function eventView(event) {
    const item = el('li', 'pv-permits-event');
    const top = el('div', 'pv-permits-event-meta');
    top.append(el('time', '', dateLabel(event.date)), el('span', '', statusLabel(event.status)));
    if (/^\d{4}-\d{2}-\d{2}/.test(text(event.date))) top.firstChild.dateTime = event.date;
    item.append(top, el('h5', '', text(event.title) || tr('Official publication', 'Officiële publicatie', 'Amtliche Veröffentlichung')));
    if (text(event.summary)) item.append(el('p', 'pv-permits-event-summary', event.summary));
    if (text(event.caseNumber)) item.append(el('p', 'pv-permits-case-number', tr('Case number: ', 'Zaaknummer: ', 'Aktenzeichen: ') + event.caseNumber));
    if (event.decisionDate) item.append(el('p', 'pv-permits-case-number', tr('Decision date: ', 'Besluitdatum: ', 'Entscheidungsdatum: ') + dateLabel(event.decisionDate)));
    const links = el('div', 'pv-permits-event-links'), original = link(event.url, tr('Original publication ↗', 'Oorspronkelijke publicatie ↗', 'Originalveröffentlichung ↗'));
    if (original) links.append(original);
    let index = 0;
    for (const document of (Array.isArray(event.documentUrls) ? event.documentUrls : []).slice(0, 12)) {
      const attachment = link(typeof document === 'string' ? document : document?.url, tr('Published document', 'Gepubliceerd document', 'Veröffentlichtes Dokument') + ` ${++index} ↗`);
      if (attachment) links.append(attachment);
    }
    if (links.childNodes.length) item.append(links);
    return item;
  }
  function caseView(item) {
    const article = el('article', 'pv-permits-case');
    article.append(el('p', 'pv-permits-association' + (isCertain(item) ? '' : ' pv-permits-association-possible'), associationLabel(item)));
    const broad = broadAreaNote(item); if (broad) article.append(broad);
    article.append(el('h4', '', text(item.title) || tr('Permit procedure', 'Vergunningprocedure', 'Genehmigungsverfahren')));
    const status = el('div', 'pv-permits-case-status');
    status.append(el('span', '', tr('Last evidenced status', 'Laatst aangetoonde status', 'Letzter belegter Stand')), el('strong', '', statusLabel(item.status)));
    article.append(status);
    const decision = caseEvents(item).find(event => event.id === item.statusEventId) || lastDecision(caseEvents(item));
    if (decision?.decisionDate) article.append(el('p', 'pv-permits-case-date', tr('Decision date for this status: ', 'Besluitdatum voor deze status: ', 'Entscheidungsdatum für diesen Stand: ') + dateLabel(decision.decisionDate)));
    else if (decision?.date) article.append(el('p', 'pv-permits-case-date', tr('Status publication: ', 'Statuspublicatie: ', 'Veröffentlichung dieses Stands: ') + dateLabel(decision.date)));
    if (item.latestDate) article.append(el('p', 'pv-permits-case-date', tr('Latest publication: ', 'Laatste publicatie: ', 'Letzte Veröffentlichung: ') + dateLabel(item.latestDate)));
    article.append(el('p', 'pv-permits-case-summary', text(item.summary) || tr('No readable summary was returned. Open the original publication.', 'Geen leesbare samenvatting ontvangen. Open de oorspronkelijke publicatie.', 'Keine lesbare Zusammenfassung geliefert. Originalveröffentlichung öffnen.')));
    const events = caseEvents(item).slice().sort((a, b) => text(a.date).localeCompare(text(b.date))), detail = el('details', 'pv-permits-history');
    const entry = model.entry;
    detail.open = entry?.expanded.has(item.id) || false;
    detail.addEventListener('toggle', () => { if (detail.open) entry?.expanded.add(item.id); else entry?.expanded.delete(item.id); });
    detail.append(el('summary', '', tr('History', 'Verloop', 'Verlauf') + ` · ${events.length} ` + tr('publications', 'publicaties', 'Veröffentlichungen')));
    const list = el('ol', 'pv-permits-timeline'); for (const event of events) list.append(eventView(event));
    detail.append(list); article.append(detail);
    const latest = events.at(-1), original = latest && link(latest.url, tr('Latest original source ↗', 'Laatste oorspronkelijke bron ↗', 'Letzte Originalquelle ↗'));
    if (original) article.append(original);
    return article;
  }
  function renderList() {
    const entry = model.entry, node = model.node;
    if (!entry || !node) return;
    const list = node.querySelector('.pv-permits-list'), count = node.querySelector('.pv-permits-count'); list.replaceChildren();
    const activeFilters = Number(!!entry.status) + Number(!!entry.year);
    node.querySelector('.pv-permits-filters > summary').textContent = tr('Filters', 'Filters', 'Filter') + (activeFilters ? ` (${activeFilters})` : '');
    node.querySelector('.pv-permits-reset').disabled = !entry.query && !activeFilters;
    const all = entry.response?.cases || [], direct = all.filter(isDirect), general = all.filter(item => !isDirect(item));
    for (const [key, items, label] of [
      ['direct', direct, tr('This parcel', 'Dit perceel', 'Dieses Grundstück')],
      ['general', general, tr('Area & nearby', 'Gebied & omgeving', 'Gebiet & Umgebung')]
    ]) {
      const button = node.querySelector('.pv-permits-view-' + key);
      button.setAttribute('aria-pressed', String(entry.associationView === key));
      button.querySelector('.pv-permits-view-label').textContent = label;
      button.querySelector('.pv-permits-view-count').textContent = entry.response ? String(items.length) : '–';
    }
    node.querySelector('.pv-permits-view-note').textContent = entry.associationView === 'direct'
      ? tr('Loaded publications linked by parcel or address. Matches inferred from a title are labelled separately.', 'Geladen publicaties gekoppeld via perceel of adres. Koppelingen uit een titel zijn apart aangeduid.', 'Geladene Veröffentlichungen mit Flurstücks- oder Adressbezug. Aus einem Titel abgeleitete Zuordnungen sind eigens gekennzeichnet.')
      : tr('Loaded publications covering this area or nearby. Their connection to this exact parcel is unconfirmed.', 'Geladen publicaties over dit gebied of de omgeving. De koppeling met dit exacte perceel is onbevestigd.', 'Geladene Veröffentlichungen zu diesem Gebiet oder zur Umgebung. Ihr Bezug zu diesem genauen Grundstück ist unbestätigt.');
    if (!entry.response) { count.textContent = ''; return; }
    const scoped = entry.associationView === 'direct' ? direct : general;
    const visible = scoped.filter(item => matches(item, entry));
    count.textContent = tr(`${visible.length} of ${all.length} loaded procedures`, `${visible.length} van ${all.length} geladen procedures`, `${visible.length} von ${all.length} geladenen Verfahren`);
    const unavailable = entry.response.state === 'unavailable' || entry.response.coverage?.available === false;
    if (!all.length) {
      if (!unavailable) list.append(el('p', 'pv-permits-empty', tr('No associated publications found in this retrieval. This does not rule out earlier applications.', 'Geen gekoppelde publicaties gevonden in deze zoekopdracht. Eerdere aanvragen zijn hiermee niet uitgesloten.', 'Bei diesem Abruf wurden keine zugeordneten Veröffentlichungen gefunden. Frühere Anträge sind damit nicht ausgeschlossen.')));
      return;
    }
    if (!scoped.length) {
      list.append(el('p', 'pv-permits-empty', entry.associationView === 'direct'
        ? tr('No securely attributed publications among the loaded results. Check Area & nearby or load more publications. This does not establish that no application exists.', 'Geen zeker gekoppelde publicaties in de geladen resultaten. Bekijk Gebied & omgeving of laad meer publicaties. Dit betekent niet dat er geen aanvraag bestaat.', 'Unter den geladenen Treffern ist noch keine Veröffentlichung diesem Grundstück sicher zugeordnet. Prüfe „Gebiet & Umgebung“ oder lade weitere Veröffentlichungen. Das bedeutet nicht, dass es keinen Antrag gibt.')
        : tr('No area or nearby publications among the loaded results.', 'Geen gebieds- of omgevingspublicaties in de geladen resultaten.', 'Unter den geladenen Treffern sind keine Veröffentlichungen zu Gebiet oder Umgebung.')));
      return;
    }
    if (!visible.length) { list.append(el('p', 'pv-permits-empty', tr('No loaded procedures match these filters. Clear the search or reset the filters.', 'Geen geladen procedures voldoen aan deze filters. Wis de zoektekst of herstel de filters.', 'Kein geladenes Verfahren entspricht diesen Filtern. Suchtext löschen oder Filter zurücksetzen.'))); return; }
    const group = el('section', 'pv-permits-group');
    for (const item of visible) group.append(caseView(item));
    list.append(group);
  }

  function questionSources(response) {
    const seen = new Set();
    return (Array.isArray(response?.sources) ? response.sources : []).slice(0, 40).filter(source => {
      const id = text(source?.id);
      if (!id || seen.has(id)) return false;
      seen.add(id); return true;
    });
  }
  const quoteText = value => text(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
  function quoteRange(value, quote) {
    const needle = quoteText(quote); if (!needle) return null;
    const direct = value.indexOf(text(quote));
    if (direct >= 0 && text(quote)) return { start: direct, end: direct + quote.length, evidence: true };
    // Match the server's NFKC/whitespace normalization while mapping each output
    // UTF-16 unit back to the unchanged PDF text. A ligature can expand into
    // multiple letters, while a base letter and combining mark can become one.
    let normalized = ''; const starts = [], ends = [];
    let segments;
    if (typeof Intl.Segmenter === 'function') segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(item => ({ value: item.segment, start: item.index, end: item.index + item.segment.length }));
    else {
      segments = []; let offset = 0;
      for (const character of value) {
        const previous = segments.at(-1);
        if (/^\p{M}$/u.test(character) && previous) { previous.value += character; previous.end = offset + character.length; }
        else segments.push({ value: character, start: offset, end: offset + character.length });
        offset += character.length;
      }
    }
    for (const segment of segments) {
      for (const character of segment.value.normalize('NFKC')) {
        if (/\s/u.test(character)) {
          if (normalized.endsWith(' ')) { ends[ends.length - 1] = segment.end; continue; }
          normalized += ' '; starts.push(segment.start); ends.push(segment.end);
        } else {
          normalized += character;
          for (let unit = 0; unit < character.length; unit++) { starts.push(segment.start); ends.push(segment.end); }
        }
      }
    }
    const index = normalized.indexOf(needle);
    return index < 0 ? null : { start: starts[index], end: ends[index + needle.length - 1], evidence: true };
  }
  function highlightRanges(source, claims, terms) {
    const value = text(source.text), ranges = [];
    for (const claim of claims) {
      if (text(claim.sourceId) !== source.id) continue;
      const range = quoteRange(value, claim.quote); if (range) ranges.push(range);
    }
    for (const range of (Array.isArray(source.highlightRanges) ? source.highlightRanges : []).slice(0, 40)) {
      if (!Number.isInteger(range?.start) || !Number.isInteger(range?.end) || range.start < 0 || range.end <= range.start || range.end > value.length) continue;
      const original = value.slice(range.start, range.end);
      if (text(range.term) && original.toLocaleLowerCase('nl') !== range.term.toLocaleLowerCase('nl')) continue;
      ranges.push({ start: range.start, end: range.end, evidence: false });
    }
    const needles = [...new Set([...(Array.isArray(source.highlightTerms) ? source.highlightTerms : []), ...terms].filter(term => text(term).trim().length >= 3).map(term => term.trim().slice(0, 100)))].slice(0, 24);
    for (const term of needles) {
      const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'); let match;
      while ((match = pattern.exec(value)) && ranges.length < 120) ranges.push({ start: match.index, end: match.index + match[0].length, evidence: false });
      if (ranges.length >= 120) break;
    }
    const merged = [];
    for (const range of ranges.sort((a, b) => a.start - b.start || b.end - a.end)) {
      const previous = merged.at(-1);
      if (previous && range.start < previous.end) { previous.end = Math.max(previous.end, range.end); previous.evidence ||= range.evidence; }
      else merged.push({ ...range });
    }
    return merged;
  }
  function highlightedSource(value, ranges) {
    const block = el('blockquote', 'pv-permits-source-text'); let position = 0;
    for (const range of ranges) {
      if (range.start > position) block.append(el('span', '', value.slice(position, range.start)));
      block.append(el('mark', range.evidence ? 'pv-permits-highlight pv-permits-highlight-evidence' : 'pv-permits-highlight', value.slice(range.start, range.end))); position = range.end;
    }
    if (position < value.length) block.append(el('span', '', value.slice(position)));
    return block;
  }
  function searchIntentView(intent) {
    if (!intent || !text(intent.dutchQuery).trim()) return null;
    const detail = el('details', 'pv-permits-search-intent');
    detail.append(el('summary', '', tr('Searched in Dutch: ', 'Gezocht op: ', 'Gesucht auf Niederländisch: ') + intent.dutchQuery.slice(0, 1000)));
    const intentLabels = {
      overview: ['Permit history', 'Vergunningverloop', 'Antragsverlauf'], status: ['Decision and status', 'Besluit en status', 'Entscheidung und Status'],
      refusal_reasons: ['Refusal reasons', 'Weigeringsgronden', 'Ablehnungsgründe'], project_details: ['Project details', 'Projectgegevens', 'Angaben zum Vorhaben'],
      conditions: ['Conditions and obligations', 'Voorwaarden en verplichtingen', 'Bedingungen und Auflagen'], timeline: ['Chronology', 'Chronologie', 'Zeitlicher Verlauf'],
      documents: ['Documents and passages', 'Documenten en passages', 'Dokumente und Textstellen'], other: ['Question about this location', 'Vraag over deze locatie', 'Frage zu diesem Standort']
    };
    const label = intentLabels[intent.intent] || intentLabels.other;
    detail.append(el('p', '', tr('Question understood as: ', 'Vraag opgevat als: ', 'Frage eingeordnet als: ') + tr(...label)));
    const terms = (Array.isArray(intent.terms) ? intent.terms : []).filter(term => text(term).trim()).slice(0, 16);
    if (terms.length) detail.append(el('p', '', tr('Search terms: ', 'Zoektermen: ', 'Suchbegriffe: ') + terms.join(' · ')));
    if (intent.interpreted !== true) detail.append(el('p', '', tr('Search phrasing uses available terms; automatic interpretation was not available.', 'De zoekformulering gebruikt beschikbare termen; automatische interpretatie was niet beschikbaar.', 'Die Suchformulierung nutzt verfügbare Begriffe; eine automatische Einordnung war nicht verfügbar.')));
    return detail;
  }
  function jumpToQuestionSource(index, quote = '') {
    const target = model.node?.querySelector(`#pv-permits-question-source-${index + 1}`);
    if (target) {
      target.open = true; target.querySelector('summary')?.focus({ preventScroll: true });
      const hit = (quote && [...target.querySelectorAll('mark')].find(mark => quoteText(mark.textContent).includes(quoteText(quote)))) || target.querySelector('.pv-permits-highlight-evidence') || target.querySelector('mark');
      (hit || target).scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
    }
  }
  function questionResultView(response, query) {
    const result = el('div', 'pv-permits-question-result'), sources = questionSources(response), answer = response.answer;
    result.append(el('p', 'pv-permits-answered-query', tr('Search: ', 'Zoekopdracht: ', 'Suche: ') + query));
    const intentView = searchIntentView(response.searchIntent); if (intentView) result.append(intentView);
    const byId = new Map(sources.map((source, index) => [source.id, { source, index }]));
    const claims = Array.isArray(answer?.claims) ? answer.claims : [];
    const citations = Array.isArray(answer?.citations) ? [...new Set(answer.citations.filter(id => typeof id === 'string'))] : [];
    // Generated statements are displayed only with an exact quote in a returned
    // original. Treat all source and model strings as text, never executable HTML.
    const grounded = response.state === 'answered' && claims.length > 0 && claims.length <= 12 && citations.length > 0 && citations.every(id => byId.get(id)?.source.sourceAvailable !== false && text(byId.get(id)?.source.text).trim()) && claims.every(claim => {
      const source = byId.get(text(claim?.sourceId))?.source;
      return text(claim?.statement).trim() && quoteText(claim?.quote) && source && citations.includes(source.id) && quoteText(source.text).includes(quoteText(claim.quote));
    });
    if (grounded) {
      const box = el('div', 'pv-permits-answer');
      box.append(el('strong', 'pv-permits-answer-label', answer.verdict === 'not-established' ? tr('Answer · not established from these sources', 'Antwoord · niet vastgesteld uit deze bronnen', 'Antwort · aus diesen Quellen nicht festgestellt') : tr('Answer', 'Antwoord', 'Antwort')));
      for (const [claimIndex, claim] of claims.entries()) {
        if (claimIndex === 1) box.append(el('h5', 'pv-permits-summary-heading', tr('Summary', 'Samenvatting', 'Zusammenfassung')));
        const item = el('div', 'pv-permits-claim'), reference = byId.get(claim.sourceId), quote = el('details', 'pv-permits-quote');
        item.append(el('p', 'pv-permits-answer-text' + (claimIndex === 0 ? ' pv-permits-direct-answer' : ''), claim.statement));
        quote.append(el('summary', '', tr('Original quote', 'Oorspronkelijk citaat', 'Originalzitat') + ` · [${reference.index + 1}]`), el('blockquote', 'pv-permits-source-text', claim.quote));
        const read = el('button', 'pv-permits-read-hit', tr('Show highlighted passage', 'Gemarkeerde passage tonen', 'Markierte Textstelle zeigen') + ` [${reference.index + 1}]`); read.type = 'button'; read.addEventListener('click', () => jumpToQuestionSource(reference.index, claim.quote)); quote.append(read);
        item.append(quote); box.append(item);
      }
      const conditions = (Array.isArray(answer.conditions) ? answer.conditions : []).filter(value => text(value).trim()).slice(0, 12);
      if (conditions.length) {
        const list = el('ul', 'pv-permits-answer-conditions');
        for (const condition of conditions) list.append(el('li', '', condition)); box.append(list);
      }
      const evidence = el('div', 'pv-permits-citations'); evidence.append(el('span', '', tr('Evidence', 'Onderbouwing', 'Belege')));
      for (const id of citations) {
        const index = byId.get(id).index, button = el('button', '', `[${index + 1}]`); button.type = 'button';
        button.setAttribute('aria-label', tr(`Read publication ${index + 1}`, `Lees publicatie ${index + 1}`, `Veröffentlichung ${index + 1} lesen`));
        button.addEventListener('click', () => jumpToQuestionSource(index)); evidence.append(button);
      }
      box.append(evidence); result.append(box);
    } else {
      result.append(el('h5', 'pv-permits-no-answer-heading', tr('Answer not established', 'Antwoord niet vastgesteld', 'Antwort nicht festgestellt')));
      result.append(el('p', 'pv-permits-no-answer', sources.length ? tr('Relevant publications are available below. A verified summary could not be established; review the original text.', 'Relevante publicaties staan hieronder. Een gecontroleerde samenvatting kon niet worden vastgesteld; bekijk de oorspronkelijke tekst.', 'Relevante Veröffentlichungen stehen unten. Eine belegte Zusammenfassung konnte nicht erstellt werden; Originaltexte prüfen.') : response.state === 'unavailable' || response.coverage?.available === false ? tr('Publication retrieval is unavailable. Retry later or review the loaded history below.', 'Publicaties ophalen is niet beschikbaar. Probeer later opnieuw of bekijk het geladen verloop hieronder.', 'Veröffentlichungen derzeit nicht abrufbar. Später erneut versuchen oder den geladenen Verlauf unten prüfen.') : tr('No matching publications were returned for this search. This does not establish that no application exists.', 'Deze zoekopdracht gaf geen overeenkomende publicaties. Dit stelt niet vast dat er geen aanvraag bestaat.', 'Diese Suche lieferte keine passenden Veröffentlichungen. Das belegt nicht, dass kein Antrag existiert.')));
      const limitations = [...new Set([...(Array.isArray(answer?.conditions) ? answer.conditions : []), ...(Array.isArray(answer?.missingInformation) ? answer.missingInformation : [])].filter(value => text(value).trim()))].slice(0, 12);
      if (answer?.verdict === 'not-established' && limitations.length) {
        const gaps = el('ul', 'pv-permits-answer-gaps'); for (const limitation of limitations) gaps.append(el('li', '', limitation)); result.append(gaps);
      }
    }
    const coverage = response.coverage || {}, notes = el('div', 'pv-permits-question-coverage' + (coverage.partial === true ? ' pv-feedback-warning' : ''));
    notes.append(el('strong', '', coverage.partial === true ? tr('Search coverage incomplete', 'Zoekdekking onvolledig', 'Suchumfang unvollständig') : tr('Search within retrieved official publications', 'Zoeken binnen opgehaalde officiële publicaties', 'Suche in abgerufenen amtlichen Veröffentlichungen')));
    notes.append(el('p', '', tr('Published notices are checked for the selected location. Attachments, earlier proceedings and exact parcel applicability may be missing. This search does not check current planning rules.', 'Gepubliceerde kennisgevingen worden gecontroleerd voor de geselecteerde locatie. Bijlagen, eerdere procedures en toepassing op het exacte perceel kunnen ontbreken. Deze zoekopdracht controleert geen actuele planregels.', 'Veröffentlichte Bekanntmachungen werden für den ausgewählten Standort geprüft. Anlagen, frühere Verfahren und die genaue Flurstückszuordnung können fehlen. Diese Suche prüft keine aktuellen Planregeln.')));
    const knownCount = value => Number.isInteger(value) && value >= 0;
    const documentCoverage = [];
    if (knownCount(coverage.documentsAvailable)) documentCoverage.push(`${coverage.documentsAvailable} ` + tr('PDF documents loaded', 'PDF-documenten geladen', 'PDF-Dokumente geladen'));
    if (knownCount(coverage.documentsChecked)) documentCoverage.push(`${coverage.documentsChecked} ` + tr('source links checked', 'bronverwijzingen gecontroleerd', 'Quellenverweise geprüft'));
    const readablePages = knownCount(coverage.documentPagesFullyRead) ? coverage.documentPagesFullyRead : coverage.documentPagesRead;
    if (knownCount(readablePages)) {
      const denominator = knownCount(coverage.documentPagesAvailable) && coverage.documentPagesAvailable > 0 && coverage.documentPagesAvailable >= readablePages ? ` / ${coverage.documentPagesAvailable}` : '';
      documentCoverage.push(`${readablePages}${denominator} ` + tr('pages with readable text', 'pagina’s met leesbare tekst', 'Seiten mit lesbarem Text'));
    }
    if (knownCount(coverage.documentPagesFullyRead) && knownCount(coverage.documentPagesRead)) documentCoverage.push(`${coverage.documentPagesRead} ` + tr('pages processed', 'pagina’s verwerkt', 'Seiten verarbeitet'));
    if (knownCount(coverage.documentOCRPages) && coverage.documentOCRPages > 0) documentCoverage.push(`${coverage.documentOCRPages} ` + tr('pages with OCR', 'pagina’s met OCR', 'Seiten mit OCR'));
    if (documentCoverage.length) notes.append(el('p', 'pv-permits-document-coverage', documentCoverage.join(' · ')));
    const warnings = (Array.isArray(coverage.warnings) ? coverage.warnings : []).map(warningLabel).filter(Boolean);
    if (warnings.length) {
      const detail = el('details', 'pv-permits-source-notes'); detail.append(el('summary', '', tr('Source notes', 'Bronnotities', 'Quellenhinweise') + ` (${warnings.length})`));
      for (const warning of warnings) detail.append(el('p', '', warning)); notes.append(detail);
    }
    result.append(notes);
    if (sources.length) result.append(el('h4', 'pv-permits-question-sources-heading', tr('Sources and relevant passages', 'Bronnen en relevante passages', 'Quellen und relevante Textstellen') + ` (${sources.length})`));
    sources.forEach((source, index) => {
      const detail = el('details', 'pv-permits-question-source'); detail.id = `pv-permits-question-source-${index + 1}`;
      const pageLabel = Number.isInteger(source.page) && source.page > 0 ? ' · PDF · ' + tr('Page ', 'Pagina ', 'Seite ') + source.page : '';
      detail.append(el('summary', '', `[${index + 1}] ` + (text(source.title) || tr('Official publication', 'Officiële publicatie', 'Amtliche Veröffentlichung')) + pageLabel + (source.incomplete === true ? ' · ' + tr('Partly read', 'Deels gelezen', 'Teilweise gelesen') : '')));
      const body = el('div', 'pv-permits-question-source-body');
      body.append(el('p', 'pv-permits-association' + (isCertain(source) ? '' : ' pv-permits-association-possible'), associationLabel(source)));
      const broad = broadAreaNote(source); if (broad) body.append(broad);
      const pdf = source.documentType === 'pdf' || source.kind === 'document_page' || Number.isInteger(source.page);
      const metadata = [(pdf ? tr('Notice status: ', 'Status kennisgeving: ', 'Stand der Bekanntmachung: ') : '') + statusLabel(source.status)];
      if (source.publicationDate) metadata.push(dateLabel(source.publicationDate));
      if (text(source.caseNumber)) metadata.push(source.caseNumber);
      body.append(el('p', 'pv-permits-case-number', metadata.join(' · ')));
      const page = Number.isInteger(source.page) && source.page > 0 ? source.page : null;
      if (pdf) body.append(el('p', 'pv-permits-document-page', 'PDF' + (page ? ' · ' + tr('Page ', 'Pagina ', 'Seite ') + page + (Number.isInteger(source.pageCount) && source.pageCount >= page ? ` / ${source.pageCount}` : '') : '') + (source.excerpt === true ? ' · ' + tr('Text excerpt', 'Tekstfragment', 'Textauszug') : '')));
      if (source.incomplete === true) body.append(el('p', 'pv-permits-incomplete-note pv-feedback-warning', tr('This page was only partly read. Quotations use the available excerpt; missing text may contain additional information. Check the original page.', 'Deze pagina is slechts gedeeltelijk gelezen. Citaten gebruiken het beschikbare fragment; ontbrekende tekst kan aanvullende informatie bevatten. Controleer de oorspronkelijke pagina.', 'Diese Seite wurde nur teilweise gelesen. Zitate nutzen den verfügbaren Auszug; fehlender Text kann weitere Informationen enthalten. Originalseite prüfen.')));
      if (source.ocr === true) body.append(el('p', 'pv-permits-ocr-note', tr('Read using text recognition (OCR). Words and numbers can be misread; verify important details on the original page.', 'Gelezen met tekstherkenning (OCR). Woorden en getallen kunnen verkeerd zijn herkend; controleer belangrijke gegevens op de oorspronkelijke pagina.', 'Mit Texterkennung (OCR) gelesen. Wörter und Zahlen können falsch erkannt sein; wichtige Angaben auf der Originalseite prüfen.')));
      if (source.sourceAvailable !== false && text(source.text).trim()) {
        const terms = Array.isArray(response.searchIntent?.terms) ? response.searchIntent.terms : [], ranges = highlightRanges(source, grounded ? claims : [], terms);
        if (ranges.length) body.append(el('p', 'pv-permits-hit-note', tr('Highlighted: matching terms and cited evidence', 'Gemarkeerd: overeenkomende termen en geciteerde onderbouwing', 'Markiert: passende Suchbegriffe und zitierte Belege')));
        body.append(highlightedSource(source.text, ranges));
      }
      else body.append(el('p', 'pv-permits-no-answer', tr('Original text unavailable. Open the official publication.', 'Oorspronkelijke tekst niet beschikbaar. Open de officiële publicatie.', 'Originaltext nicht verfügbar. Amtliche Veröffentlichung öffnen.')));
      const original = link(source.url || source.documentUrl, pdf ? tr('Original document ↗', 'Oorspronkelijk document ↗', 'Originaldokument ↗') : tr('Original publication ↗', 'Oorspronkelijke publicatie ↗', 'Originalveröffentlichung ↗')); if (original) body.append(original);
      detail.append(body); result.append(detail);
    });
    return result;
  }
  function paintQuestion() {
    const question = model.entry?.question, node = model.node; if (!question || !node) return;
    const form = node.querySelector('.pv-permits-question-form'), input = node.querySelector('.pv-permits-question-input'), submit = node.querySelector('.pv-permits-question-submit');
    input.readOnly = question.loading; submit.disabled = question.loading || !question.query.trim(); submit.setAttribute('aria-busy', String(question.loading));
    submit.textContent = question.loading ? tr('Searching publications…', 'Publicaties doorzoeken…', 'Veröffentlichungen durchsuchen…') : tr('Search permit publications', 'Vergunningspublicaties doorzoeken', 'Bauanträge durchsuchen');
    form.setAttribute('aria-busy', String(question.loading));
    for (const button of node.querySelectorAll('.pv-permits-question-example')) button.disabled = question.loading;
    node.querySelector('.pv-permits-question-cancel').hidden = !question.loading;
    const progress = node.querySelector('.pv-permits-question-progress'); progress.hidden = !question.loading; progress.setAttribute('aria-busy', String(question.loading));
    const status = node.querySelector('.pv-permits-question-status'); status.classList.toggle('pv-feedback-error', !!question.error);
    status.textContent = question.loading ? tr('Understanding the question, searching documents and checking evidence…', 'De vraag begrijpen, documenten doorzoeken en onderbouwing controleren…', 'Frage verstehen, Dokumente durchsuchen und Belege prüfen…') : question.error || (question.cancelled ? tr('Search cancelled. The previous result remains below.', 'Zoekopdracht geannuleerd. Het vorige resultaat blijft hieronder staan.', 'Suche abgebrochen. Das vorige Ergebnis bleibt unten erhalten.') : '');
    const previous = node.querySelector('.pv-permits-question-previous'); previous.hidden = !question.loading || !question.response;
    previous.textContent = question.response ? tr('Previous search remains visible: ', 'Vorige zoekopdracht blijft zichtbaar: ', 'Vorige Suche bleibt sichtbar: ') + question.responseQuery : '';
    const results = node.querySelector('.pv-permits-question-results');
    if (results.response !== question.response) {
      results.replaceChildren(); if (question.response) results.append(questionResultView(question.response, question.responseQuery)); results.response = question.response;
    }
  }
  function questionForm() {
    const question = model.entry.question, section = el('section', 'pv-permits-question');
    section.append(el('h4', '', tr('Ask about permits at this location', 'Vraag over vergunningen op deze locatie', 'Bauanträge an diesem Standort durchsuchen')));
    section.append(el('p', 'pv-permits-question-intro', tr('Ask in your own words. Your question is converted into Dutch search terms, then the available notices and documents are checked for a cited answer.', 'Stel je vraag in je eigen woorden. De vraag wordt omgezet naar Nederlandse zoektermen; daarna worden beschikbare kennisgevingen en documenten gecontroleerd voor een antwoord met bronverwijzingen.', 'Frage in eigenen Worten stellen. Daraus entstehen niederländische Suchbegriffe; anschließend werden verfügbare Bekanntmachungen und Dokumente für eine belegte Antwort geprüft.')));
    const form = el('form', 'pv-permits-question-form'), label = el('label', '', tr('What would you like to find?', 'Wat wil je vinden?', 'Was möchtest du finden?'));
    label.htmlFor = 'pv-permits-question-input';
    const input = el('textarea', 'pv-permits-question-input'); input.id = 'pv-permits-question-input'; input.rows = 3; input.maxLength = 1000; input.required = true; input.value = question.query;
    input.placeholder = tr('For example: Which applications were refused and why?', 'Bijvoorbeeld: Welke aanvragen zijn geweigerd en waarom?', 'Zum Beispiel: Welche Anträge wurden abgelehnt und warum?'); input.setAttribute('aria-describedby', 'pv-permits-question-note');
    input.addEventListener('input', () => { question.query = input.value; paintQuestion(); }); form.append(label, input);
    const examples = el('div', 'pv-permits-question-examples'); examples.setAttribute('aria-label', tr('Example questions', 'Voorbeeldvragen', 'Beispielfragen'));
    const presets = [
      [tr('History', 'Verloop', 'Verlauf'), tr('Which applications and decisions are published for this location?', 'Welke aanvragen en besluiten zijn voor deze locatie gepubliceerd?', 'Welche Anträge und Entscheidungen wurden für diesen Standort veröffentlicht?')],
      [tr('Refusals', 'Weigeringen', 'Ablehnungen'), tr('Which applications were refused and which reasons were published?', 'Welke aanvragen zijn geweigerd en welke redenen zijn gepubliceerd?', 'Welche Anträge wurden abgelehnt und welche Gründe wurden veröffentlicht?')],
      [tr('Case number', 'Zaaknummer', 'Aktenzeichen'), tr('What happened with RWS-2026/23770?', 'Wat is er gebeurd met RWS-2026/23770?', 'Was ist bei RWS-2026/23770 passiert?')]
    ];
    for (const [title, query] of presets) {
      const button = el('button', 'pv-permits-question-example', title); button.type = 'button';
      button.addEventListener('click', () => { if (question.loading) return; question.query = input.value = query; paintQuestion(); input.focus({ preventScroll: true }); }); examples.append(button);
    }
    form.append(examples);
    const note = el('p', 'pv-permits-question-note', tr('Runs only when submitted. Searches this location’s publications; the loaded list and its filters stay separate.', 'Start alleen na verzenden. Doorzoekt publicaties voor deze locatie; de geladen lijst en de filters blijven apart.', 'Startet erst nach Absenden. Durchsucht Veröffentlichungen für diesen Standort; geladene Liste und Filter bleiben getrennt.')); note.id = 'pv-permits-question-note'; form.append(note);
    const actions = el('div', 'pv-permits-question-actions'), submit = el('button', 'pv-button primary pv-permits-question-submit'); submit.type = 'submit';
    const cancel = el('button', 'pv-button pv-permits-question-cancel', tr('Cancel', 'Annuleren', 'Abbrechen')); cancel.type = 'button';
    cancel.addEventListener('click', () => { stopQuestion(true); paintQuestion(); input.focus({ preventScroll: true }); }); actions.append(submit, cancel); form.append(actions);
    form.addEventListener('submit', event => { event.preventDefault(); runQuestion(); }); section.append(form);
    const status = el('p', 'pv-permits-question-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const progress = el('div', 'pv-progress pv-permits-question-progress'); progress.setAttribute('role', 'progressbar'); progress.setAttribute('aria-label', tr('Permit publication search', 'Vergunningspublicaties doorzoeken', 'Bauanträge durchsuchen')); progress.append(el('span'));
    section.append(status, progress, el('p', 'pv-permits-question-previous'), el('div', 'pv-permits-question-results')); return section;
  }
  function paint() {
    const entry = model.entry, node = model.node;
    if (!entry || !node) return;
    const response = entry.response, loading = entry.loading;
    node.querySelector('.pv-permits-scope').textContent = scopeLabel();
    node.querySelector('.pv-permits-refresh').disabled = loading;
    node.querySelector('.pv-permits-cancel').hidden = !loading;
    node.querySelector('.pv-permits-progress').hidden = !loading;
    node.querySelector('.pv-permits-progress').setAttribute('aria-busy', String(loading));
    const status = node.querySelector('.pv-permits-status');
    status.classList.toggle('pv-feedback-error', !!entry.error);
    status.textContent = loading ? tr('Retrieving official publications for this location…', 'Officiële publicaties voor deze locatie ophalen…', 'Amtliche Veröffentlichungen für diesen Standort werden geladen…') : entry.error || (entry.cancelled ? tr('Retrieval cancelled. Previously loaded entries remain available.', 'Ophalen geannuleerd. Eerder geladen vermeldingen blijven beschikbaar.', 'Abruf abgebrochen. Bereits geladene Einträge bleiben verfügbar.') : '');
    const provenance = node.querySelector('.pv-permits-evidence'); provenance.replaceChildren();
    if (response) provenance.append(coverageView(response));
    node.querySelector('.pv-permits-controls').hidden = !response || !response.cases.length;
    const year = node.querySelector('.pv-permits-year'), years = [...new Set((response?.cases || []).flatMap(yearValues))].sort().reverse();
    const current = entry.year; if (current && !years.includes(current)) years.push(current);
    year.replaceChildren(); const all = el('option', '', tr('All years', 'Alle jaren', 'Alle Jahre')); all.value = ''; year.append(all);
    for (const value of years) { const option = el('option', '', value); option.value = value; year.append(option); } year.value = current;
    const next = response?.nextCursor || response?.coverage?.nextCursor;
    const more = node.querySelector('.pv-permits-more'); more.hidden = !next; more.disabled = loading;
    node.querySelector('.pv-permits-page-note').hidden = !next;
    renderList(); paintQuestion();
  }
  function mount() {
    const entry = model.entry, node = el('section', 'detail-section pv-permits');
    node.dataset.pvTab = 'permits'; node.dataset.pvManaged = ''; node.setAttribute('role', 'tabpanel'); node.setAttribute('aria-labelledby', 'pv-tab-permits');
    const header = el('div', 'pv-permits-heading'), heading = el('div');
    heading.append(el('span', 'pv-permits-eyebrow', tr('OFFICIAL PUBLICATIONS', 'OFFICIËLE PUBLICATIES', 'AMTLICHE VERÖFFENTLICHUNGEN')), el('h3', '', tr('Permit history', 'Bouwaanvragen', 'Bauanträge')));
    const refresh = el('button', 'pv-button pv-permits-refresh', tr('Refresh', 'Vernieuwen', 'Aktualisieren')); refresh.type = 'button'; refresh.addEventListener('click', () => run(false));
    header.append(heading, refresh); node.append(header);
    node.append(el('p', 'pv-permits-intro', tr('Applications and decisions found for this location. Open a procedure to follow its published history.', 'Aanvragen en besluiten gevonden voor deze locatie. Open een procedure om het gepubliceerde verloop te volgen.', 'Gefundene Anträge und Entscheidungen für diesen Standort. Ein Verfahren öffnen, um den veröffentlichten Verlauf zu lesen.')));
    node.append(el('p', 'pv-permits-scope'));
    node.append(questionForm());
    node.append(el('h4', 'pv-permits-list-heading', tr('Permit history · loaded list', 'Vergunningverloop · geladen lijst', 'Antragsverlauf · geladene Liste')));
    const controls = el('div', 'pv-permits-controls');
    const views = el('div', 'pv-permits-views'); views.setAttribute('role', 'group'); views.setAttribute('aria-label', tr('Publication association', 'Publicatiekoppeling', 'Zuordnung der Veröffentlichungen'));
    for (const key of ['direct', 'general']) {
      const button = el('button', 'pv-permits-view pv-permits-view-' + key); button.type = 'button';
      button.append(el('span', 'pv-permits-view-label'), el('span', 'pv-permits-view-count'));
      button.addEventListener('click', () => { entry.associationView = key; renderList(); }); views.append(button);
    }
    controls.append(views, el('p', 'pv-permits-view-note'));

    const label = el('label', 'pv-permits-search-label', tr('Filter loaded list', 'Geladen lijst filteren', 'Geladene Liste filtern')); label.htmlFor = 'pv-permits-query';
    const search = el('input', 'pv-permits-query'); search.id = 'pv-permits-query'; search.type = 'search'; search.value = entry.query; search.maxLength = 300;
    search.placeholder = tr('Title, summary or case number…', 'Titel, samenvatting of zaaknummer…', 'Titel, Zusammenfassung oder Aktenzeichen…'); search.setAttribute('aria-describedby', 'pv-permits-search-note');
    search.addEventListener('input', () => { entry.query = search.value; renderList(); }); controls.append(label, search);
    const filter = el('details', 'pv-permits-filters'); filter.open = entry.filtersOpen;
    filter.addEventListener('toggle', () => { entry.filtersOpen = filter.open; });
    filter.append(el('summary', '', tr('Filters', 'Filters', 'Filter')));
    const filterRow = el('div', 'pv-permits-filter-row');
    const statusLabelNode = el('label', '', tr('Status', 'Status', 'Status')); statusLabelNode.htmlFor = 'pv-permits-filter-status';
    const status = el('select', 'pv-permits-filter-status'); status.id = 'pv-permits-filter-status'; status.setAttribute('aria-label', tr('Status', 'Status', 'Status'));
    const any = el('option', '', tr('All statuses', 'Alle statussen', 'Alle Status')); any.value = ''; status.append(any);
    for (const key of statuses) { const option = el('option', '', statusLabel(key)); option.value = key; status.append(option); } status.value = entry.status;
    status.addEventListener('change', () => { entry.status = status.value; renderList(); }); statusLabelNode.append(status);
    const yearLabel = el('label', '', tr('Publication year', 'Publicatiejaar', 'Veröffentlichungsjahr')); yearLabel.htmlFor = 'pv-permits-filter-year';
    const year = el('select', 'pv-permits-year'); year.id = 'pv-permits-filter-year'; year.setAttribute('aria-label', tr('Publication year', 'Publicatiejaar', 'Veröffentlichungsjahr')); year.addEventListener('change', () => { entry.year = year.value; renderList(); }); yearLabel.append(year);
    filterRow.append(statusLabelNode, yearLabel); filter.append(filterRow);
    const reset = el('button', 'pv-button pv-permits-reset', tr('Reset search and filters', 'Zoektekst en filters wissen', 'Suche und Filter zurücksetzen')); reset.type = 'button';
    reset.addEventListener('click', () => { entry.query = ''; entry.status = ''; entry.year = ''; search.value = ''; status.value = ''; year.value = ''; renderList(); }); filter.append(reset); controls.append(filter);
    const note = el('p', 'pv-permits-search-note', tr('Search and filters apply only to loaded procedures in this tab. The year matches any publication in the procedure.', 'Zoektekst en filters gelden alleen voor geladen procedures in dit tabblad. Het jaar geldt voor elke publicatie in de procedure.', 'Suche und Filter gelten nur für geladene Verfahren in diesem Tab. Das Jahr bezieht sich auf eine beliebige Veröffentlichung des Verfahrens.')); note.id = 'pv-permits-search-note'; controls.append(note); node.append(controls);
    const statusLine = el('p', 'pv-permits-status'); statusLine.setAttribute('role', 'status'); statusLine.setAttribute('aria-live', 'polite'); node.append(statusLine);
    const progress = el('div', 'pv-progress pv-permits-progress'); progress.setAttribute('role', 'progressbar'); progress.setAttribute('aria-label', tr('Retrieving publications', 'Publicaties ophalen', 'Veröffentlichungen werden geladen')); progress.append(el('span')); node.append(progress);
    const cancel = el('button', 'pv-button pv-permits-cancel', tr('Cancel retrieval', 'Ophalen annuleren', 'Abruf abbrechen')); cancel.type = 'button'; cancel.addEventListener('click', () => { stop(true); paint(); }); node.append(cancel);
    node.append(el('div', 'pv-permits-evidence'));
    const count = el('p', 'pv-permits-count'); count.setAttribute('role', 'status'); count.setAttribute('aria-live', 'polite'); node.append(count, el('div', 'pv-permits-list'));
    const more = el('button', 'pv-button pv-permits-more', tr('Load more publications', 'Meer publicaties laden', 'Weitere Veröffentlichungen laden')); more.type = 'button'; more.addEventListener('click', () => run(true)); node.append(more);
    node.append(el('p', 'pv-permits-page-note', tr('More publications are available. Search and filters do not yet include them.', 'Er zijn meer publicaties beschikbaar. Zoektekst en filters omvatten deze nog niet.', 'Weitere Veröffentlichungen sind verfügbar. Suche und Filter berücksichtigen diese noch nicht.')));
    node.append(el('p', 'pv-permits-footnote', tr('Summaries retain the official source language. Status describes the publications found, not a confirmed final legal position. Reasons and attachments appear only when published; open the source for the full decision.', 'Samenvattingen blijven in de officiële brontaal. De status beschrijft gevonden publicaties, geen bevestigde definitieve rechtspositie. Redenen en bijlagen verschijnen alleen als ze gepubliceerd zijn; open de bron voor het volledige besluit.', 'Zusammenfassungen bleiben in der amtlichen Quellsprache. Der Status beschreibt gefundene Veröffentlichungen, keinen bestätigten rechtskräftigen Stand. Gründe und Anlagen erscheinen nur soweit veröffentlicht; den vollständigen Bescheid in der Quelle öffnen.')));
    model.node = node; model.language = language(); paint(); return node;
  }
  function render(selection = currentSelection()) {
    const key = pointKey(selection?.point);
    if (!key || (activePointKey() && activePointKey() !== key)) { if (!key) selectionChanged(null); return; }
    selectionChanged(selection.point); model.selection = selection;
    const entry = entryFor(selection);
    if (entry !== model.entry) { stop(); stopQuestion(); model.entry = entry; model.node?.remove(); model.node = null; }
    const container = document.querySelector('#detail-content .detail-inner'); if (!container) return;
    if (!model.node || model.language !== language()) { model.node?.remove(); mount(); }
    model.node.querySelector('.pv-permits-scope').textContent = scopeLabel();
    if (model.node.parentNode !== container) {
      const source = container.querySelector(':scope > [data-pv-tab="sources"]');
      if (source) source.before(model.node); else container.append(model.node);
    }
    model.node.hidden = window.planviewUI?.inspectorTab !== 'permits';
    window.planviewUI?.setInspectorTab(window.planviewUI.inspectorTab);
  }
  function activate(active) {
    model.active = active;
    if (model.node) model.node.hidden = !active;
    if (active && model.entry && model.node?.isConnected && !model.entry.attempted && !model.entry.loading) run(false);
  }
  async function run(more = false) {
    const entry = model.entry, point = model.selection?.point, key = model.key;
    if (!entry || !point || entry.loading || !model.active || !selectedStillMatches(key)) return;
    const cursor = more ? entry.response?.nextCursor || entry.response?.coverage?.nextCursor : null;
    if (more && !cursor) return;
    stop(); const request = model.request; model.controller = new AbortController();
    const controller = model.controller;
    entry.loading = true; entry.error = ''; entry.cancelled = false; entry.attempted = true; paint();
    const body = { point: { lat: Number(point.lat), lng: Number(point.lng) } };
    const parcel = parcelId(model.selection); if (parcel) body.parcelId = parcel; if (cursor) body.cursor = cursor;
    model.timeout = setTimeout(() => { if (model.controller === controller) { controller.abort(); entry.error = tr('Retrieval timed out. Try again; previously loaded entries remain available.', 'Ophalen duurde te lang. Probeer opnieuw; eerder geladen vermeldingen blijven beschikbaar.', 'Abruf dauerte zu lange. Erneut versuchen; bereits geladene Einträge bleiben verfügbar.'); } }, 65000);
    try {
      const response = await fetch('/api/permits/point', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new Error(tr('Sign in again to retrieve publications.', 'Meld je opnieuw aan om publicaties op te halen.', 'Zum Abrufen der Veröffentlichungen erneut anmelden.'));
        if (response.status === 429) throw new Error(tr('The service is busy. Wait a little and retry.', 'De service is bezet. Wacht even en probeer opnieuw.', 'Der Dienst ist ausgelastet. Kurz warten und erneut versuchen.'));
        throw new Error(tr('Publication service unavailable. Retry shortly. Previously loaded entries remain available.', 'Publicatieservice niet beschikbaar. Probeer zo opnieuw. Eerder geladen vermeldingen blijven beschikbaar.', 'Veröffentlichungsdienst nicht verfügbar. Bald erneut versuchen. Bereits geladene Einträge bleiben verfügbar.'));
      }
      const data = await response.json();
      if (!data || data.version !== 1 || !Array.isArray(data.cases) || !data.coverage || data.cases.some(item => !item || typeof item !== 'object' || !text(item.id))) throw new Error(tr('The publication service returned an unreadable result. Try again.', 'De publicatieservice gaf een onleesbaar resultaat. Probeer opnieuw.', 'Der Veröffentlichungsdienst lieferte ein unlesbares Ergebnis. Erneut versuchen.'));
      if (controller.signal.aborted || request !== model.request || model.entry !== entry || !selectedStillMatches(key)) return;
      entry.response = more ? mergeResponse(entry.response, data) : data;
    } catch (error) {
      if (request !== model.request || model.entry !== entry || !selectedStillMatches(key)) return;
      if (error.name !== 'AbortError') entry.error = error instanceof SyntaxError ? tr('The publication service returned an unreadable result. Try again.', 'De publicatieservice gaf een onleesbaar resultaat. Probeer opnieuw.', 'Der Veröffentlichungsdienst lieferte ein unlesbares Ergebnis. Erneut versuchen.') : error.message || tr('Publications could not be retrieved.', 'Publicaties konden niet worden opgehaald.', 'Veröffentlichungen konnten nicht geladen werden.');
    } finally {
      if (request === model.request && model.entry === entry) { clearTimeout(model.timeout); model.timeout = null; model.controller = null; entry.loading = false; paint(); }
    }
  }
  async function runQuestion() {
    const entry = model.entry, question = entry?.question, point = model.selection?.point, key = model.key;
    const query = text(question?.query).trim();
    if (!entry || !question || !query || query.length > 1000 || !point || question.loading || !model.active || !selectedStillMatches(key)) return;
    stopQuestion(); const request = model.questionRequest, controller = new AbortController(); model.questionController = controller;
    question.loading = true; question.error = ''; question.cancelled = false; paintQuestion();
    const body = { point: { lat: Number(point.lat), lng: Number(point.lng) }, query, language: language() };
    const parcel = parcelId(model.selection); if (parcel) body.parcelId = parcel;
    model.questionTimeout = setTimeout(() => {
      if (model.questionController === controller) {
        stopQuestion(); question.error = tr('Permit search timed out. Try a narrower question. Previous results remain available.', 'Vergunningzoekopdracht duurde te lang. Stel een gerichtere vraag. Vorige resultaten blijven beschikbaar.', 'Bauantragssuche dauerte zu lange. Frage enger eingrenzen. Vorige Ergebnisse bleiben verfügbar.'); paintQuestion();
      }
    }, 250000);
    try {
      const response = await fetch('/api/permits/search', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new Error(tr('Sign in again to search permit publications.', 'Meld je opnieuw aan om vergunningspublicaties te doorzoeken.', 'Zum Durchsuchen der Bauanträge erneut anmelden.'));
        if (response.status === 429) throw new Error(tr('The publication service is busy. Wait a little and retry.', 'De publicatieservice is bezet. Wacht even en probeer opnieuw.', 'Der Veröffentlichungsdienst ist ausgelastet. Kurz warten und erneut versuchen.'));
        throw new Error(tr('Permit search is unavailable. Previously loaded publications and results remain available.', 'Vergunningen zoeken is niet beschikbaar. Eerder geladen publicaties en resultaten blijven beschikbaar.', 'Bauantragssuche ist nicht verfügbar. Bereits geladene Veröffentlichungen und Ergebnisse bleiben verfügbar.'));
      }
      const data = await response.json();
      if (!data || !['matches', 'answered', 'unavailable'].includes(data.state) || !Array.isArray(data.sources) || !data.coverage || data.sources.some(source => !source || typeof source !== 'object' || !text(source.id))) throw new Error(tr('The publication search returned an unreadable result. Try again.', 'De publicatiezoekopdracht gaf een onleesbaar resultaat. Probeer opnieuw.', 'Die Veröffentlichungssuche lieferte ein unlesbares Ergebnis. Erneut versuchen.'));
      if (controller.signal.aborted || request !== model.questionRequest || model.entry !== entry || !selectedStillMatches(key)) return;
      question.response = data; question.responseQuery = query;
    } catch (error) {
      if (request !== model.questionRequest || model.entry !== entry || !selectedStillMatches(key)) return;
      if (error.name !== 'AbortError') question.error = error instanceof SyntaxError ? tr('The publication search returned an unreadable result. Try again.', 'De publicatiezoekopdracht gaf een onleesbaar resultaat. Probeer opnieuw.', 'Die Veröffentlichungssuche lieferte ein unlesbares Ergebnis. Erneut versuchen.') : error.message || tr('Permit search failed.', 'Vergunningen zoeken mislukt.', 'Bauantragssuche fehlgeschlagen.');
    } finally {
      if (request === model.questionRequest && model.entry === entry) { clearTimeout(model.questionTimeout); model.questionTimeout = null; model.questionController = null; question.loading = false; paintQuestion(); }
    }
  }
  window.planviewPermits = { render, selectionChanged, activate, cancel: () => { stop(true); stopQuestion(true); paint(); } };
  window.addEventListener('planview-language-change', () => render());
})();
