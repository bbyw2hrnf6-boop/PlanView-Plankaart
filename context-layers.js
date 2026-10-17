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
  const cache=new Map(),pending=new Map(),leaflet=new Map(),drawn=new Map(),perspectiveDrawn=new Map();
  const sameFeatures=(a,b)=>a?.length===b.length&&b.every((feature,i)=>a[i]===feature);
  const labels={urban_area:'Urban area',nature_network:'Nature network',groundwater_protection:'Groundwater protection',
    'camping, kampeerterrein':'Campsite',caravanpark:'Caravan park',bungalowpark:'Holiday park'};
  const colors={urban_area:'#8766cc',nature_network:'#369769',groundwater_protection:'#48a9d4',
    'camping, kampeerterrein':'#ea9e44',caravanpark:'#dc7359',bungalowpark:'#aa80db'};
  const attribution={provincial:'© Provincies / PDOK NNN · RIVM · Provincie Limburg',camping:'© PDOK / Kadaster TOP10NL',projects:'© Nationale Woningbouwkaart / LMVW'};
  const nationalProtection=[{id:'nature',url:'https://service.pdok.nl/provincies/natuurnetwerk-nederland/wms/v1_0',layers:'PS.ProtectedSite'},{id:'groundwater',url:'https://data.rivm.nl/geo/alo/wms',layers:'rivm_gwb_actueel'}];
  let protectionTiles=null;
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
    if(id==='camping'&&zoom<10)return [];
    const features=data.features.filter(feature=>intersects(feature._bounds,b)&&!(id==='provincial'&&zoom<11));
    if(id!=='projects'||zoom>=12)return features;
    // Group public project points spatially at regional scale; never draw thousands of DOM layers.
    const cell=360/2**(Math.floor(zoom)+1),groups=new Map();
    for(const feature of features){const [x,y]=feature.geometry.coordinates,key=`${Math.floor(x/cell)}:${Math.floor(y/cell)}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(feature);}
    return [...groups.values()].map(group=>group.length===1?group[0]:{...group[0],properties:{...group[0].properties,name:`${group.length} public housing projects`,cluster:group.length},geometry:{type:'Point',coordinates:[group.reduce((n,f)=>n+f.geometry.coordinates[0],0)/group.length,group.reduce((n,f)=>n+f.geometry.coordinates[1],0)/group.length]}});
  }

  function style(feature){const kind=feature.properties.kind,color=colors[kind]||'#f6b75e';return {color,weight:kind==='nature_network'?1.2:2,
    fillColor:color,fillOpacity:kind==='urban_area'?.10:kind==='nature_network'?.12:.20,dashArray:kind==='groundwater_protection'?'5 5':null};}
  function card(id,feature){
    const p=feature.properties,type=labels[p.kind]||p.kind||'Mapped area';
    const rows=[p.phase,p.province,p.peilmoment?`Snapshot: ${p.peilmoment}`:null,p.homes!=null?`${p.homes} planned homes`:null,p.studentRooms!=null?`${p.studentRooms} student rooms`:null,
      p.locationAccuracy,p.sourceDate?`Source geometry date: ${p.sourceDate}`:null].filter(Boolean);
    const note=id==='camping'?'Mapped site, not permission for accommodation. Check the local plan rules.':
      id==='provincial'?'Nationwide NNN nature network and groundwater protection (RIVM). The additional urban planning boundary is available only for Limburg. Confirm current legal effect in Omgevingsloket.':
      id==='projects'?'Public LMVW inventory; locations and capacities are indicative, and publication is incomplete. No public project points are available for Fryslân, Gelderland or Noord-Brabant in this snapshot. Project plans may change.':'Indicative development area; check municipal source.';
    const source=p.sourceUrl&&/^https:\/\//.test(p.sourceUrl)?`<a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">Official source ↗</a>`:'';
    return `<div class="pv-context-popup"><strong>${esc(p.name||type)}</strong><small>${esc(type)} · ${esc(p.municipality||p.source||'Nederland')}</small>${rows.map(row=>`<span>${esc(row)}</span>`).join('')}<p>${esc(note)}</p>${source}<br><a href="${OFFICIAL}" target="_blank" rel="noopener noreferrer">Check current rules ↗</a></div>`;
  }
  function drawLeaflet(id,data){
    let layer=leaflet.get(id);if(!layer){layer=L.layerGroup();leaflet.set(id,layer);}
    const features=visibleFeatures(id,data);
    if(sameFeatures(drawn.get(id),features)){if(features.length&&!state.map.hasLayer(layer))layer.addTo(state.map);showState(id,features.length||id==='provincial'?'visible':'empty');return;}
    drawn.set(id,features);layer.clearLayers();
    if(!features.length){showState(id,id==='provincial'?'visible':'empty');return;}
    for(const feature of features){
      const geo=L.geoJSON(feature,{style,pointToLayer:(_,latlng)=>L.circleMarker(latlng,{radius:8,color:'#fff',weight:2,fillColor:'#d48157',fillOpacity:.95})});
      geo.bindPopup(card(id,feature),{maxWidth:285});
      geo.on('click',event=>{L.DomEvent.stopPropagation(event.originalEvent);if(feature.properties.cluster){navigateToPoint(event.latlng,state.map.getZoom()+2);return;}if(event.latlng)selectPoint(event.latlng);});
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
    let text=localized[status][lang==='nl'?1:lang==='de'?2:0];
    if(status==='empty'&&id==='camping'&&(state.perspective?state.perspectiveMap:state.map).getZoom()<10)text=lang==='de'?'Ab Zoom 10':lang==='nl'?'Vanaf zoom 10':'Zoom to level 10';
    if(status==='empty'&&id==='projects')text=lang==='de'?'Keine öffentlichen Projektpunkte im Ausschnitt':lang==='nl'?'Geen openbare projectpunten in beeld':'No public project locations in view';
    if(label.textContent!==text)label.textContent=text;label.dataset.state=status==='empty'?'zoom':status;
  }
  function updateAttribution(id,on){const value=attribution[id];if(!value||!state.map?.attributionControl)return;
    if(on&&!context[`attribution_${id}`]){state.map.attributionControl.addAttribution(value);context[`attribution_${id}`]=true;}
    if(!on&&context[`attribution_${id}`]){state.map.attributionControl.removeAttribution(value);context[`attribution_${id}`]=false;}}
  function refresh(){
    if(!state.map)return;
    const enabled=entries.find(e=>e.id==='provincial').on;
    if(enabled&&!protectionTiles){protectionTiles=L.layerGroup(nationalProtection.map(source=>L.tileLayer.wms(source.url,{layers:source.layers,format:'image/png',transparent:true,opacity:.55,version:'1.1.1',updateWhenIdle:true,updateWhenZooming:false,keepBuffer:2})));}
    if(protectionTiles){if(enabled&&!state.map.hasLayer(protectionTiles))protectionTiles.addTo(state.map);if(!enabled&&state.map.hasLayer(protectionTiles))state.map.removeLayer(protectionTiles);}
    for(const entry of entries){
      const layer=leaflet.get(entry.id);
      if(!entry.on){if(layer&&state.map.hasLayer(layer))state.map.removeLayer(layer);updateAttribution(entry.id,false);showState(entry.id,'off');continue;}
      updateAttribution(entry.id,true);
      if(!state.perspective&&cache.has(entry.id))drawLeaflet(entry.id,cache.get(entry.id));
      else if(!cache.has(entry.id)){showState(entry.id,'loading');load(entry.id).then(()=>refresh()).catch(()=>showState(entry.id,'error'));}
    }
    updatePerspective();
  }
  function updatePerspective(){
    if(!state.perspectiveReady||!state.perspective)return;
    const map=state.perspectiveMap;
    for(const source of nationalProtection){const id=`national-protection-${source.id}`;if(!map.getSource(id)){const tiles=`${source.url}?service=WMS&version=1.1.1&request=GetMap&layers=${encodeURIComponent(source.layers)}&styles=&format=image/png&transparent=true&srs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}`;map.addSource(id,{type:'raster',tiles:[tiles],tileSize:256,attribution:source.id==='nature'?'© Provincies / PDOK NNN':'© RIVM'});map.addLayer({id,type:'raster',source:id,paint:{'raster-opacity':.5,'raster-fade-duration':0}},map.getLayer('municipality-lines')?'municipality-lines':undefined);}map.setLayoutProperty(id,'visibility',entries.find(e=>e.id==='provincial').on?'visible':'none');}
    for(const entry of entries){
      const sourceId=`context-${entry.id}`;
      if(!map.getSource(sourceId)){
        map.addSource(sourceId,{type:'geojson',data:empty,attribution:attribution[entry.id]});
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
      const features=data?visibleFeatures(entry.id,data):[];
      if(!sameFeatures(perspectiveDrawn.get(entry.id),features)){perspectiveDrawn.set(entry.id,features);map.getSource(sourceId).setData({type:'FeatureCollection',features});}
    }
  }
  const previousUpdate=updateLayers;updateLayers=function(){previousUpdate();refresh();};
  const previousPerspective=initPerspective;initPerspective=async function(){await previousPerspective();state.perspectiveMap.on('movestart',()=>clearTimeout(context.refreshTimer));state.perspectiveMap.on('moveend',scheduleRefresh);};
  const previousToggle=togglePerspective;togglePerspective=async function(){await previousToggle();refresh();};
  function scheduleRefresh(){clearTimeout(context.refreshTimer);context.refreshTimer=setTimeout(refresh,250);}
  window.addEventListener('load',()=>{
    state.map.on('movestart',()=>clearTimeout(context.refreshTimer));
    state.map.on('moveend',()=>{if(!state.perspective)scheduleRefresh();});
    document.addEventListener('planview:regionchange',scheduleRefresh);
    window.addEventListener('planview-language-change',scheduleRefresh);
    refresh();
  });
})();
