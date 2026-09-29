// Short UI definitions. These describe map symbols, not the legal effect of a plan.
(() => {
  const definitions = {
    'layer:zoning': ['The main land-use designation in a published spatial plan. Read the linked plan rules for what is allowed.', 'De hoofdbestemming in een gepubliceerd ruimtelijk plan. Lees de gekoppelde planregels voor wat is toegestaan.', 'Die Hauptnutzung im veröffentlichten Raumplan. Was erlaubt ist, steht in den verlinkten Planregeln.'],
    'layer:double': ['An additional designation layered over the main use, often for heritage, archaeology or infrastructure.', 'Een extra bestemming boven op de hoofdbestemming, bijvoorbeeld voor erfgoed, archeologie of leidingen.', 'Eine zusätzliche Festsetzung über der Hauptnutzung, etwa für Erbe, Archäologie oder Leitungen.'],
    'layer:building': ['A mapped building envelope (bouwvlak). Building rules and dimensions still need to be checked.', 'Een ingetekend bouwvlak. Controleer ook de bouwregels en maatvoeringen.', 'Ein eingezeichnetes Baufenster. Bauvorschriften und Maße müssen zusätzlich geprüft werden.'],
    'layer:function': ['A specific function within a designation, such as a permitted use at this location.', 'Een specifieke functie binnen een bestemming, bijvoorbeeld een gebruik op deze plek.', 'Eine besondere Funktion innerhalb einer Nutzung, etwa eine Nutzung an diesem Ort.'],
    'layer:area': ['An overlay applying extra rules to a wider area, such as a protection or restriction zone.', 'Een aanduiding met extra regels voor een groter gebied, zoals een beschermingszone.', 'Eine Überlagerung mit Zusatzregeln für ein größeres Gebiet, etwa eine Schutzzone.'],
    'layer:dimensions': ['Mapped numbers such as maximum building height or site coverage; the plan rules define their meaning.', 'Getallen op de kaart, zoals maximale bouwhoogte of bebouwingspercentage; de planregels bepalen hun betekenis.', 'Kartierte Zahlen wie maximale Bauhöhe oder Bebauungsgrad; die Planregeln bestimmen ihre Bedeutung.'],
    'layer:planBounds': ['The outer boundary of a published plan document, not a parcel or buildable-area boundary.', 'De buitengrens van een gepubliceerd plan, geen perceelsgrens of bouwgrens.', 'Die Außengrenze eines veröffentlichten Plans, keine Flurstücks- oder Baugrenze.'],
    'layer:parcels': ['Cadastral parcel outlines from the Kadaster. A parcel boundary does not itself define planning rights.', 'Kadastrale perceelsgrenzen van het Kadaster. Een perceelsgrens bepaalt op zichzelf geen planrechten.', 'Kataster-Flurstücksgrenzen. Die Grenze allein bestimmt keine Baurechte.'],
    'layer:novex': ['Published large national housing locations. This limited set is not an inventory of buildable land.', 'Gepubliceerde grote landelijke woningbouwlocaties. Deze beperkte set is geen overzicht van bouwgrond.', 'Veröffentlichte große nationale Wohnungsbaustandorte. Die begrenzte Auswahl ist kein Baulandkataster.'],
    'legend:agrarisch': ['Land mainly designated for agriculture.', 'Grond hoofdzakelijk bestemd voor landbouw.', 'Fläche hauptsächlich für Landwirtschaft.'],
    'legend:agrarisch met waarden': ['Agricultural land with additional landscape, nature or cultural values.', 'Landbouwgrond met aanvullende landschaps-, natuur- of cultuurwaarden.', 'Landwirtschaft mit zusätzlichen Landschafts-, Natur- oder Kulturwerten.'],
    'legend:bedrijf': ['Land designated for business activities; permitted types depend on the plan.', 'Grond bestemd voor bedrijvigheid; toegestane typen staan in het plan.', 'Fläche für Gewerbe; zulässige Arten stehen im Plan.'],
    'legend:bedrijventerrein': ['An area designated as an industrial or business estate.', 'Een gebied bestemd als bedrijven- of industrieterrein.', 'Ein als Gewerbe- oder Industriegebiet festgesetzter Bereich.'],
    'legend:bos': ['Land designated as forest.', 'Grond bestemd als bos.', 'Als Wald festgesetzte Fläche.'],
    'legend:centrum': ['Town-centre use, often combining shops, services and other functions.', 'Centrumfunctie, vaak met winkels, diensten en andere functies.', 'Zentrumsnutzung, oft mit Handel, Dienstleistungen und weiteren Funktionen.'],
    'legend:cultuur en ontspanning': ['Use for culture, recreation or entertainment, as specified in the plan.', 'Gebruik voor cultuur, ontspanning of vermaak volgens de planregels.', 'Nutzung für Kultur, Erholung oder Unterhaltung gemäß Planregeln.'],
    'legend:detailhandel': ['Retail or shop use.', 'Gebruik voor detailhandel of winkels.', 'Nutzung für Einzelhandel oder Geschäfte.'],
    'legend:dienstverlening': ['Service-oriented use, with the exact activities defined by the plan.', 'Dienstverlenende functies; het plan bepaalt de precieze activiteiten.', 'Dienstleistungen; der Plan bestimmt die genauen Tätigkeiten.'],
    'legend:gemengd': ['Mixed-use designation; check which combination of uses the plan permits.', 'Gemengde bestemming; controleer welke combinatie van functies is toegestaan.', 'Mischnutzung; die zulässige Kombination steht im Plan.'],
    'legend:groen': ['Green space such as planting, parks or landscaped areas.', 'Groenvoorzieningen zoals beplanting, parken of groenstroken.', 'Grünflächen wie Bepflanzung, Parks oder Grünstreifen.'],
    'legend:horeca': ['Hospitality use such as cafés or restaurants, subject to the plan category.', 'Horecagebruik zoals cafés of restaurants, volgens de plancategorie.', 'Gastronomie wie Cafés oder Restaurants gemäß Plankategorie.'],
    'legend:infrastructuur': ['Land for infrastructure or utility networks.', 'Grond voor infrastructuur of nutsvoorzieningen.', 'Fläche für Infrastruktur oder Versorgungsnetze.'],
    'legend:kantoor': ['Office use.', 'Gebruik voor kantoren.', 'Nutzung für Büros.'],
    'legend:maatschappelijk': ['Public or community facilities, such as education or healthcare.', 'Maatschappelijke voorzieningen, zoals onderwijs of zorg.', 'Gemeinbedarf, etwa Bildung oder Gesundheit.'],
    'legend:natuur': ['Nature conservation or nature-oriented land use.', 'Natuurgebied of natuurgericht gebruik.', 'Naturschutz- oder naturnahe Nutzung.'],
    'legend:recreatie': ['Recreation use; the plan specifies the permitted form.', 'Recreatief gebruik; het plan noemt de toegestane vorm.', 'Erholungsnutzung; die zulässige Form steht im Plan.'],
    'legend:sport': ['Sports facilities or playing fields.', 'Sportvoorzieningen of sportvelden.', 'Sportanlagen oder Spielfelder.'],
    'legend:tuin': ['Garden land, often linked to a nearby property.', 'Tuingrond, vaak verbonden aan een nabijgelegen perceel.', 'Gartenfläche, oft einem benachbarten Grundstück zugeordnet.'],
    'legend:verkeer': ['Roads, paths or other traffic space.', 'Wegen, paden of andere verkeersruimte.', 'Straßen, Wege oder andere Verkehrsflächen.'],
    'legend:ontspanning en vermaak': ['Leisure and entertainment use as defined in the plan.', 'Ontspanning en vermaak zoals omschreven in het plan.', 'Freizeit und Unterhaltung gemäß Planregeln.'],
    'legend:water': ['Water bodies and related water functions.', 'Wateroppervlak en bijbehorende waterfuncties.', 'Wasserflächen und zugehörige Funktionen.'],
    'legend:wonen': ['Residential use; check the plan for housing type and building limits.', 'Woonbestemming; controleer woningtypen en bouwgrenzen in het plan.', 'Wohnnutzung; Haustypen und Baugrenzen stehen im Plan.'],
    'legend:woongebied': ['A broader residential area that may include supporting local functions.', 'Een ruimer woongebied met mogelijk ondersteunende functies.', 'Ein größeres Wohngebiet mit möglichen ergänzenden Nutzungen.'],
    'legend:overig': ['Another published plan category; select the location for its exact designation.', 'Een andere gepubliceerde plancategorie; selecteer de plek voor de exacte bestemming.', 'Eine andere veröffentlichte Plankategorie; Ort für die genaue Festsetzung wählen.']
  };
  const tooltip = document.createElement('div');
  tooltip.id = 'map-info-tooltip';
  tooltip.className = 'map-info-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.append(tooltip);
  let active = null;
  let pinned = false;
  const langIndex = () => ({en: 0, nl: 1, de: 2})[document.documentElement.lang] ?? 0;
  function refreshLabels() {
    document.querySelectorAll('[data-info]').forEach(button => {
      const label = button.parentElement.querySelector('.layer-label,.legend-name') || button.parentElement.querySelector('strong');
      const name = label?.firstChild?.textContent?.trim() || '';
      button.setAttribute('aria-label', `Info: ${name}`);
    });
  }
  function close() {
    if (active) active.setAttribute('aria-expanded', 'false');
    active = null; pinned = false; tooltip.hidden = true;
  }
  function show(button, pin = false) {
    const copy = definitions[button.dataset.info];
    if (!copy) return;
    if (active && active !== button) active.setAttribute('aria-expanded', 'false');
    active = button; pinned = pin;
    tooltip.textContent = copy[langIndex()];
    tooltip.hidden = false;
    button.setAttribute('aria-expanded', String(pin));
    const rect = button.getBoundingClientRect();
    const width = tooltip.offsetWidth;
    const left = Math.max(8, Math.min(rect.left - 6, innerWidth - width - 8));
    const below = rect.bottom + 8;
    const top = below + tooltip.offsetHeight <= innerHeight - 8 ? below : Math.max(8, rect.top - tooltip.offsetHeight - 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }
  document.addEventListener('pointerover', event => {
    const button = event.target.closest?.('[data-info]');
    if (button && !pinned) show(button);
  });
  document.addEventListener('pointerout', event => {
    if (active && !pinned && event.target.closest?.('[data-info]') === active && !active.contains(event.relatedTarget)) close();
  });
  document.addEventListener('focusin', event => {
    const button = event.target.closest?.('[data-info]');
    if (button && !pinned) show(button);
  });
  document.addEventListener('focusout', event => {
    if (active && !pinned && event.target === active) close();
  });
  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-info]');
    if (!button) { if (pinned) close(); return; }
    event.preventDefault();
    event.stopPropagation();
    if (active === button && pinned) close(); else show(button, true);
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  document.querySelector('.sidebar-scroll')?.addEventListener('scroll', close, {passive: true});
  document.getElementById('legend')?.addEventListener('scroll', close, {passive: true});
  window.addEventListener('resize', close);
  window.addEventListener('planview-language-change', () => {
    refreshLabels();
    if (active) show(active, pinned);
  });
  for (const id of ['layer-list', 'legend', 'legend-active']) {
    const list = document.getElementById(id);
    if (list) new MutationObserver(refreshLabels).observe(list, {childList: true, characterData: true, subtree: true});
  }
  window.addEventListener('load', refreshLabels);
  refreshLabels();
})();
