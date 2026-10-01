/* Source-backed development and campsite context. These overlays are deliberately
   separate from the legal PDOK plankaart and never imply a right to build. */
(() => {
  const entries = [
    {id:'provincial',label:'Provincial Planning',icon:'map',group:'DEVELOPMENT CONTEXT',on:false,context:true},
    {id:'projects',label:'Planned Housing & Construction Projects',icon:'building',group:'DEVELOPMENT CONTEXT',on:false,context:true},
    {id:'camping',label:'Camping & Holiday Parks',icon:'leaf',group:'CONTEXT',on:false,context:true}
  ];
  layerDefs.push(...entries);
  const files={provincial:'data/provincial_context.geojson',projects:'data/development_projects.geojson',camping:'data/camping_sites.geojson'};
  const cache=new Map(),pending=new Map(),leaflet=new Map();
  const labels={urban_area:'Urban area',nature_network:'Nature network',groundwater_protection:'Groundwater protection',
    'camping, kampeerterrein':'Campsite',caravanpark:'Caravan park',bungalowpark:'Holiday park'};
  const colors={urban_area:'#8766cc',nature_network:'#369769',groundwater_protection:'#48a9d4',
    'camping, kampeerterrein':'#ea9e44',caravanpark:'#dc7359',bungalowpark:'#aa80db'};
  const attribution={provincial:'© Provincie Limburg',camping:'© PDOK / Kadaster TOP10NL',projects:'© Gemeente Maastricht'};
  const empty={type:'FeatureCollection',features:[]};
  const context={data:cache,load};
  window.planviewContext=context;

  async function load(id){
    if(cache.has(id))return cache.get(id);
    if(pending.has(id))return pending.get(id);
    const task=fetch(files[id]).then(response=>{if(!response.ok)throw new Error(`${id} data unavailable`);return response.json();})
      .then(data=>{if(data.type!=='FeatureCollection'||!Array.isArray(data.features))throw new Error(`Invalid ${id} data`);
        for(const feature of data.features)feature._bounds=featureBounds(feature.geometry);
        cache.set(id,data);pending.delete(id);return data;}).catch(error=>{pending.delete(id);throw error;});
    pending.set(id,task);return task;
  }
  function featureBounds(geometry){
    if(!geometry)return null;
    if(geometry.type==='Point')return [geometry.coordinates[0],geometry.coordinates[1],geometry.coordinates[0],geometry.coordinates[1]];
    const box=[Infinity,Infinity,-Infinity,-Infinity];
    const visit=value=>{if(typeof value[0]==='number'){box[0]=Math.min(box[0],value[0]);box[1]=Math.min(box[1],value[1]);box[2]=Math.max(box[2],value[0]);box[3]=Math.max(box[3],value[1]);}else for(const child of value)visit(child);};
    visit(geometry.coordinates);return box;
  }
  function intersects(box,bounds){return box&&box[2]>=bounds.getWest()&&box[0]<=bounds.getEast()&&box[3]>=bounds.getSouth()&&box[1]<=bounds.getNorth();}
  function visibleFeatures(id,data){
    const map=state.perspective&&state.perspectiveReady?state.perspectiveMap:state.map;
    const b=map.getBounds(),zoom=map.getZoom();
    return data.features.filter(feature=>intersects(feature._bounds,b)&&
      !(id==='provincial'&&zoom<11&&feature.properties.kind!=='urban_area'));
  }
  function style(feature){const kind=feature.properties.kind,color=colors[kind]||'#f6b75e';return {color,weight:kind==='nature_network'?1.2:2,
    fillColor:color,fillOpacity:kind==='urban_area'?.10:kind==='nature_network'?.12:.20,dashArray:kind==='groundwater_protection'?'5 5':null};}
  function card(id,feature){
    const p=feature.properties,type=labels[p.kind]||p.kind||'Mapped area';
    const rows=[p.phase,p.homes!=null?`${p.homes} planned homes`:null,p.studentRooms!=null?`${p.studentRooms} student rooms`:null,
      p.locationAccuracy,p.sourceDate?`Source geometry date: ${p.sourceDate}`:null].filter(Boolean);
    const note=id==='camping'?'Mapped site, not permission for accommodation. Check the local plan rules.':
      id==='provincial'?'Province-level context. Confirm current legal effect in Omgevingsloket.':
      id==='projects'?'Published project; marker location is approximate. Project plans may change.':'Indicative development area; check municipal source.';
    const source=p.sourceUrl&&/^https:\/\//.test(p.sourceUrl)?`<a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">Official source ↗</a>`:'';
    return `<div class="pv-context-popup"><strong>${esc(p.name||type)}</strong><small>${esc(type)} · ${esc(p.municipality||p.source||'Limburg')}</small>${rows.map(row=>`<span>${esc(row)}</span>`).join('')}<p>${esc(note)}</p>${source}<br><a href="${OFFICIAL}" target="_blank" rel="noopener noreferrer">Check current rules ↗</a></div>`;
  }
  function drawLeaflet(id,data){
    let layer=leaflet.get(id);if(!layer){layer=L.layerGroup();leaflet.set(id,layer);}
    layer.clearLayers();
    const features=visibleFeatures(id,data);
    if(!features.length){showState(id,'empty');return;}
    for(const feature of features){
      const geo=L.geoJSON(feature,{style,pointToLayer:(_,latlng)=>L.circleMarker(latlng,{radius:8,color:'#fff',weight:2,fillColor:'#d48157',fillOpacity:.95})});
      geo.bindPopup(card(id,feature),{maxWidth:285});
      geo.on('click',event=>{L.DomEvent.stopPropagation(event.originalEvent);if(event.latlng)selectPoint(event.latlng);});
      geo.addTo(layer);
    }
    if(!state.map.hasLayer(layer))layer.addTo(state.map);
    showState(id,'visible');
  }
  function showState(id,status){
    const label=document.querySelector(`[data-layer="${id}"]`)?.closest('.layer-row')?.querySelector('.pv-layer-state');
    if(!label)return;
    const lang=document.documentElement.lang;
    const localized={empty:['No verified data in view','Geen geverifieerde data in beeld','Keine geprüften Daten im Ausschnitt'],loading:['Loading…','Laden…','Lädt…'],error:['Source unavailable','Bron niet beschikbaar','Quelle nicht verfügbar'],visible:['Visible','Zichtbaar','Sichtbar'],off:['Off','Uit','Aus']};
    const text=localized[status][lang==='nl'?1:lang==='de'?2:0];
    label.textContent=text;label.dataset.state=status==='empty'?'zoom':status;
  }
  function updateAttribution(id,on){const value=attribution[id];if(!value||!state.map?.attributionControl)return;
    if(on&&!context[`attribution_${id}`]){state.map.attributionControl.addAttribution(value);context[`attribution_${id}`]=true;}
    if(!on&&context[`attribution_${id}`]){state.map.attributionControl.removeAttribution(value);context[`attribution_${id}`]=false;}}
  function refresh(){
    if(!state.map)return;
    for(const entry of entries){
      const layer=leaflet.get(entry.id);
      if(!entry.on){if(layer&&state.map.hasLayer(layer))state.map.removeLayer(layer);updateAttribution(entry.id,false);showState(entry.id,'off');continue;}
      updateAttribution(entry.id,true);
      if(cache.has(entry.id))drawLeaflet(entry.id,cache.get(entry.id));
      else{showState(entry.id,'loading');load(entry.id).then(()=>refresh()).catch(()=>showState(entry.id,'error'));}
    }
    updatePerspective();
  }
  function updatePerspective(){
    if(!state.perspectiveReady)return;
    const map=state.perspectiveMap;
    for(const entry of entries){
      const sourceId=`context-${entry.id}`;
      if(!map.getSource(sourceId)){
        map.addSource(sourceId,{type:'geojson',data:empty});
        if(entry.id==='projects')map.addLayer({id:`${sourceId}-points`,type:'circle',source:sourceId,
          paint:{'circle-radius':8,'circle-color':'#d48157','circle-stroke-width':2,'circle-stroke-color':'#fff'}});
        else{
          map.addLayer({id:`${sourceId}-fill`,type:'fill',source:sourceId,
            paint:{'fill-color':entry.id==='camping'?'#eaa143':entry.id==='provincial'?'#55a87d':'#6d85d5','fill-opacity':.23}});
          map.addLayer({id:`${sourceId}-line`,type:'line',source:sourceId,
            paint:{'line-color':entry.id==='camping'?'#d98324':entry.id==='provincial'?'#428b6d':'#5670bc','line-width':2}});
        }
      }
      const data=entry.on&&cache.get(entry.id);
      map.getSource(sourceId).setData(data?{type:'FeatureCollection',features:visibleFeatures(entry.id,data)}:empty);
    }
  }
  const previousUpdate=updateLayers;updateLayers=function(){previousUpdate();refresh();};
  const previousPerspective=initPerspective;initPerspective=async function(){await previousPerspective();updatePerspective();};
  window.addEventListener('load',()=>{
    state.map.on('moveend',()=>{clearTimeout(context.refreshTimer);context.refreshTimer=setTimeout(refresh,120);});
    document.getElementById('municipality').addEventListener('change',()=>setTimeout(refresh,150));
    refresh();
  });
})();
