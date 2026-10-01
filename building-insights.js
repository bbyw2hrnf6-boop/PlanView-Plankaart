/* Building Insights are point-specific BAG data, not a map layer. */
(() => {
  const BAG='https://api.pdok.nl/kadaster/bag/ogc/v2';
  const cache=new Map();
  const tr=(en,nl,de)=>({nl,de}[document.documentElement.lang]||en);
  const timeoutFetch=async(url,options={})=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{const response=await fetch(url,{...options,signal:controller.signal});if(!response.ok)throw new Error(`Source ${response.status}`);return response.json();}
    finally{clearTimeout(timer);}
  };
  const validId=id=>/^\d{16}$/.test(String(id||''));
  const label=v=>`${v.openbare_ruimte_naam||''} ${v.huisnummer||''}${v.huisletter||''}${v.toevoeging?`-${v.toevoeging}`:''}, ${v.woonplaats_naam||''}`.trim();
  const inPolygon=(geometry,p)=>geometry&&['Polygon','MultiPolygon'].includes(geometry.type)&&geometryContains(geometry,p);
  const bbox=(p,r=.00022)=>[p.lng-r,p.lat-r,p.lng+r,p.lat+r].map(n=>n.toFixed(6)).join(',');
  async function findBuilding(p){
    const url=`${BAG}/collections/pand/items?bbox=${bbox(p)}&limit=100&f=json`;
    const data=await timeoutFetch(url);
    const matches=(data.features||[]).filter(f=>inPolygon(f.geometry,p)&&f.properties?.status!=='Pand gesloopt');
    if(!matches.length)return null;
    // Smallest intersecting footprint is a safe tiebreaker at shared boundaries.
    const area=f=>{const ring=f.geometry.type==='Polygon'?f.geometry.coordinates[0]:f.geometry.coordinates[0][0];let total=0;for(let i=0;i<ring.length-1;i++)total+=ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1];return Math.abs(total);};
    return matches.sort((a,b)=>area(a)-area(b))[0];
  }
  async function fetchUnits(building){
    const hrefs=(building.properties?.['verblijfsobject.href']||[]).filter(url=>typeof url==='string'&&url.startsWith(`${BAG}/collections/verblijfsobject/items/`)).slice(0,24);
    const results=[];for(let i=0;i<hrefs.length;i+=6){const batch=await Promise.allSettled(hrefs.slice(i,i+6).map(url=>timeoutFetch(url)));for(const result of batch)if(result.status==='fulfilled'&&validId(result.value.properties?.identificatie))results.push(result.value.properties);}
    return results;
  }
  function pickUnit(units,p){
    if(!units.length)return null;
    const address=p.address||'';
    const exact=units.find(v=>address&&new RegExp(`\\b${v.huisnummer}${v.huisletter||''}\\b`,'i').test(address)&&address.toLowerCase().includes(String(v.openbare_ruimte_naam||'').toLowerCase()));
    return exact||units.find(v=>v.status==='Verblijfsobject in gebruik')||units[0];
  }
  async function load(selected){
    const key=`${selected.point.lat.toFixed(6)},${selected.point.lng.toFixed(6)}`;
    if(cache.has(key)){selected.buildingInsights=await cache.get(key);return;}
    const task=(async()=>{
      try{
        const building=await findBuilding(selected.point);
        if(!building)return {state:'none'};
        const result={state:'building',building,units:[],unit:null};
        selected.buildingInsights=result;show(selected);
        result.units=await fetchUnits(building);result.unit=pickUnit(result.units,selected.point);
        show(selected);
        return result;
      }catch(error){return {state:'error',error:String(error)};}
    })();
    cache.set(key,task);selected.buildingInsights=await task;show(selected);
  }
  function value(name,value){return `<div class="metric"><div class="metric-label">${esc(name)}</div><div class="metric-value">${esc(value??'—')}</div></div>`;}
  function render(selected){
    const insight=selected.buildingInsights;
    if(!insight||insight.state==='none')return '';
    if(insight.state==='error')return `<section class="detail-section pv-building-insights" data-pv-tab="summary"><h3>${tr('Building Insights','Gebouwinzichten','Gebäude-Einblicke')}</h3><p class="secondary-intro">${tr('BAG building lookup unavailable; no building facts claimed.','BAG-gebouwgegevens zijn niet beschikbaar.','BAG-Gebäudeabfrage nicht verfügbar.')}</p></section>`;
    const b=insight.building.properties,id=b.identificatie,unit=insight.unit;
    const options=insight.units.length>1?`<label class="pv-building-unit-label">${tr('Address / unit','Adres / verblijfsobject','Adresse / Einheit')}<select id="pv-building-unit">${insight.units.map(v=>`<option value="${esc(v.identificatie)}" ${v.identificatie===unit?.identificatie?'selected':''}>${esc(label(v))}</option>`).join('')}</select></label>`:'';
    const bagUrl=`${BAG}/collections/pand/items/${encodeURIComponent(insight.building.id)}?f=html`;
    return `<section class="detail-section pv-building-insights" data-pv-tab="summary"><h3>${tr('Building Insights','Gebouwinzichten','Gebäude-Einblicke')}</h3><p class="secondary-intro">${tr('Building footprint at the clicked point · BAG identity','Gebouw op het aangeklikte punt · BAG-identiteit','Gebäude am angeklickten Punkt · BAG-ID')}</p><div class="metric-grid">${value(tr('Construction year','Bouwjaar','Baujahr'),b.bouwjaar)}${value(tr('BAG status','BAG-status','BAG-Status'),b.status)}${value(tr('Use','Gebruiksdoel','Nutzung'),b.gebruiksdoel)}${value(tr('Addressable objects','Verblijfsobjecten','Nutzungseinheiten'),b.aantal_verblijfsobjecten)}</div><p class="pv-building-id">BAG pand-ID · ${esc(id)}</p>${options}${unit?`<p class="pv-building-id">VBO-ID · ${esc(unit.identificatie)} · ${esc(label(unit))}${unit.oppervlakte!=null?` · ${esc(unit.oppervlakte)} m²`:''}</p>`:''}${insight.units.length>1?`<p class="secondary-intro">${tr('Multiple addressable objects are registered here. Select the relevant address.','Meerdere verblijfsobjecten zijn hier geregistreerd. Kies het juiste adres.','Mehrere Einheiten sind hier registriert. Wähle die passende Adresse.')}</p>`:''}<div class="pv-building-links"><a href="${esc(bagUrl)}" target="_blank" rel="noopener noreferrer">${tr('Official BAG record ↗','Officieel BAG-record ↗','Amtlicher BAG-Eintrag ↗')}</a></div></section>`;
  }
  function show(selected){
    if(state.selected!==selected)return;
    const content=document.getElementById('detail-content'),anchor=content.querySelector('.detail-inner > .detail-section, .empty-detail');
    if(!anchor)return;
    content.querySelector('.pv-building-insights')?.remove();
    const html=render(selected);if(!html)return;
    anchor.insertAdjacentHTML('afterend',html);
    const section=content.querySelector('.pv-building-insights'),active=content.querySelector('.pv-inspector-tabs [aria-selected="true"]')?.dataset.tab||'summary';
    section.hidden=active!=='summary';
    const picker=section.querySelector('#pv-building-unit');if(picker)picker.onchange=async()=>{
      const insight=selected.buildingInsights,unit=insight.units.find(v=>v.identificatie===picker.value);if(!unit)return;
      insight.unit=unit;show(selected);
    };
  }
  const previousRender=renderDetails;
  renderDetails=function(){previousRender();const selected=state.selected;if(!selected)return;show(selected);if(!selected.buildingInsightsStarted){selected.buildingInsightsStarted=true;load(selected);}};
})();
