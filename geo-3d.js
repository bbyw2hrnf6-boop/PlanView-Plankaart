/* 3DBAG LoD1.2 building heights, colored from the same PDOK zoning WMS as the plan map. */
(() => {
  // Buildings belong to perspective mode; they are not a selectable map overlay.
  const service={status:'idle',count:0,colored:0,error:'',paletteError:'',request:0,map:null,timer:null,controller:null};
  window.planviewCity3D=service;
  const empty={type:'FeatureCollection',features:[]};
  const neutral='#a8b6b2';
  const tr=(en,nl,de)=>document.documentElement.lang==='nl'?nl:document.documentElement.lang==='de'?de:en;
  const palette=legendItems.map(([key,,color])=>({key,color,rgb:[1,3,5].map(i=>parseInt(color.slice(i,i+2),16))}));
  const status=()=>{
    const credit=document.getElementById('city3d-credit');if(!credit)return;
    credit.hidden=!state.perspective;
    const zoom=state.perspectiveMap?.getZoom()||0;
    const message=zoom<16?tr('Zoom in for 3D buildings','Zoom in voor 3D-gebouwen','Für 3D-Gebäude hineinzoomen'):service.status==='loading'?tr('Loading buildings…','Gebouwen laden…','Gebäude laden…'):service.status==='error'?tr('Buildings unavailable','Gebouwen niet beschikbaar','Gebäude nicht erreichbar'):service.count?tr(`${service.count} buildings`,`${service.count} gebouwen`,`${service.count} Gebäude`):tr('No buildings here','Geen gebouwen hier','Keine Gebäude hier');
    const text=`© 3DBAG · ${message}`;if(credit.textContent!==text)credit.textContent=text;
    credit.title=service.paletteError?tr('Plan colors unavailable; buildings shown in neutral colors.','Plankaartkleuren niet beschikbaar; gebouwen hebben neutrale kleuren.','Planfarben nicht verfügbar; Gebäude werden neutral dargestellt.'):'Building heights: 3DBAG by tudelft3d and 3DGI · CC BY 4.0. Colors: PDOK plan map.';
  };
  function setup(){
    const map=state.perspectiveMap;if(!state.perspectiveReady||!map)return;
    service.map=map;
    if(!map.getSource('city3d-buildings'))map.addSource('city3d-buildings',{type:'geojson',data:empty});
    if(!map.getLayer('city3d-buildings'))map.addLayer({id:'city3d-buildings',type:'fill-extrusion',source:'city3d-buildings',paint:{'fill-extrusion-color':['get','color'],'fill-extrusion-height':['get','height'],'fill-extrusion-base':0,'fill-extrusion-opacity':.94}},'selected-fill');
    map.off('moveend',schedule);map.on('moveend',schedule);
    map.off('movestart',pause);map.on('movestart',pause);
    schedule();
  }
  function pause(){clearTimeout(service.timer);if(service.controller){service.controller.abort();service.controller=null;service.request++;service.status=service.count?'ready':'idle';}}
  function clear(){pause();if(service.count||service.status!=='idle')service.map?.getSource('city3d-buildings')?.setData(empty);service.count=0;service.colored=0;service.bounds=null;service.status='idle';status();}
  function schedule(){
    clearTimeout(service.timer);
    if(!state.perspective||!state.perspectiveMap||state.perspectiveMap.getZoom()<16){clear();return;}
    const bounds=state.perspectiveMap.getBounds(),loaded=service.bounds;
    if(loaded&&!service.limited&&bounds.getWest()>=loaded[0]&&bounds.getSouth()>=loaded[1]&&bounds.getEast()<=loaded[2]&&bounds.getNorth()<=loaded[3]){status();return;}
    service.timer=setTimeout(load,350);status();
  }
  function representativePoint(geometry){
    const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
    const rings=polygons.map(p=>p[0]).filter(r=>r?.length>=4);
    if(!rings.length)return null;
    let chosen=rings[0],largest=0;
    for(const ring of rings){let area=0;for(let i=0;i<ring.length-1;i++)area+=ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1];if(Math.abs(area)>largest){chosen=ring;largest=Math.abs(area);}}
    let crossSum=0,cx=0,cy=0;
    for(let i=0;i<chosen.length-1;i++){const cross=chosen[i][0]*chosen[i+1][1]-chosen[i+1][0]*chosen[i][1];crossSum+=cross;cx+=(chosen[i][0]+chosen[i+1][0])*cross;cy+=(chosen[i][1]+chosen[i+1][1])*cross;}
    if(Math.abs(crossSum)>1e-12){const point={lng:cx/(3*crossSum),lat:cy/(3*crossSum)};if(geometryContains(geometry,point))return point;}
    for(let i=1;i<chosen.length-2;i++){const point={lng:(chosen[0][0]+chosen[i][0]+chosen[i+1][0])/3,lat:(chosen[0][1]+chosen[i][1]+chosen[i+1][1])/3};if(geometryContains(geometry,point))return point;}
    return {lng:chosen[0][0],lat:chosen[0][1]};
  }
  function nearestLegend(data,index){
    if(data[index+3]<245)return null;
    let best=null,distance=2701;
    for(const item of palette){const d=(data[index]-item.rgb[0])**2+(data[index+1]-item.rgb[1])**2+(data[index+2]-item.rgb[2])**2;if(d<distance){distance=d;best=item;}}
    return distance<=2700?best:null;
  }
  function legendAt(raster,geometry){
    if(!raster)return null;
    const point=representativePoint(geometry);if(!point)return null;
    const [x,y]=mercator(point);
    const px=Math.round((x-raster.minX)/(raster.maxX-raster.minX)*(raster.size-1));
    const py=Math.round((raster.maxY-y)/(raster.maxY-raster.minY)*(raster.size-1));
    if(px<0||py<0||px>=raster.size||py>=raster.size)return null;
    const votes=new Map();
    for(const [dx,dy] of [[0,0],[-3,0],[3,0],[0,-3],[0,3],[-6,0],[6,0],[0,-6],[0,6]]){
      const sx=px+dx,sy=py+dy;if(sx<0||sy<0||sx>=raster.size||sy>=raster.size)continue;
      const match=nearestLegend(raster.pixels,(sy*raster.size+sx)*4);if(match)votes.set(match.key,{item:match,count:(votes.get(match.key)?.count||0)+1});
    }
    return [...votes.values()].sort((a,b)=>b.count-a.count)[0]?.item||null;
  }
  async function zoningRaster(bounds,signal){
    const southwest=mercator({lat:bounds.getSouth(),lng:bounds.getWest()});
    const northeast=mercator({lat:bounds.getNorth(),lng:bounds.getEast()});
    const size=1024,params=new URLSearchParams({service:'WMS',version:'1.3.0',request:'GetMap',layers:'enkelbestemming',styles:'',format:'image/png',transparent:'true',crs:'EPSG:3857',bbox:`${southwest[0]},${southwest[1]},${northeast[0]},${northeast[1]}`,width:String(size),height:String(size)});
    const response=await fetch(`${PLAN_WMS}?${params}`,{signal});if(!response.ok)throw Error(`PDOK ${response.status}`);
    const bitmap=await createImageBitmap(await response.blob());
    try{const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0,size,size);return {pixels:context.getImageData(0,0,size,size).data,minX:southwest[0],minY:southwest[1],maxX:northeast[0],maxY:northeast[1],size};}
    finally{bitmap.close();}
  }
  async function load(){
    const map=state.perspectiveMap;if(!map||!state.perspective)return;if(map.isMoving()){schedule();return;}
    const bounds=map.getBounds();
    const corners=[[bounds.getSouth(),bounds.getWest()],[bounds.getSouth(),bounds.getEast()],[bounds.getNorth(),bounds.getWest()],[bounds.getNorth(),bounds.getEast()]].map(([lat,lng])=>wgs84ToRd({lat,lng}));
    const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]);
    const bbox=`${Math.min(...xs).toFixed(1)},${Math.min(...ys).toFixed(1)},${Math.max(...xs).toFixed(1)},${Math.max(...ys).toFixed(1)},EPSG:28992`;
    service.controller?.abort();const controller=new AbortController();service.controller=controller;const ticket=++service.request;
    service.status='loading';service.error='';service.paletteError='';status();
    const params=new URLSearchParams({service:'WFS',version:'2.0.0',request:'GetFeature',typeNames:'BAG3D:lod12',outputFormat:'application/json',srsName:'EPSG:4326',bbox,count:'1000',propertyName:'geom,b3_h_50p,b3_h_maaiveld'});
    try{
      const buildingsPromise=fetch(`https://data.3dbag.nl/api/BAG3D/wfs?${params}`,{signal:controller.signal}).then(async response=>{if(!response.ok)throw Error(`3DBAG ${response.status}`);return response.json();});
      const [buildingsResult,rasterResult]=await Promise.allSettled([buildingsPromise,zoningRaster(bounds,controller.signal)]);
      if(ticket!==service.request)return;
      if(buildingsResult.status==='rejected')throw buildingsResult.reason;
      const data=buildingsResult.value,raster=rasterResult.status==='fulfilled'?rasterResult.value:null;
      if(!raster)service.paletteError=String(rasterResult.reason);
      let colored=0;
      const features=[],candidates=(data.features||[]).filter(feature=>['Polygon','MultiPolygon'].includes(feature.geometry?.type));
      for(let i=0;i<candidates.length;i++){
        if(i%64===0){await new Promise(resolve=>setTimeout(resolve,0));if(ticket!==service.request)return;}
        const feature=candidates[i];
        const p=feature.properties||{};
        const roof=Number(p.b3_h_50p??p.b3_h_dak_50p??p.h_dak_50p);
        const ground=Number(p.b3_h_maaiveld??p.h_maaiveld);
        const height=roof-ground;
        if(!Number.isFinite(height)||height<2||height>250)continue;
        const legend=legendAt(raster,feature.geometry);if(legend)colored++;
        features.push({type:'Feature',geometry:feature.geometry,properties:{height:Math.round(height*10)/10,color:legend?.color||neutral,designation:legend?.key||''}});
      }
      map.getSource('city3d-buildings')?.setData({type:'FeatureCollection',features});
      service.count=features.length;service.colored=colored;service.limited=(data.features||[]).length>=1000||Number(data.numberMatched)>(data.features||[]).length;service.bounds=[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()];service.controller=null;service.status='ready';status();
    }catch(error){if(error.name==='AbortError'||ticket!==service.request)return;service.error=String(error);service.status='error';service.count=0;service.colored=0;map.getSource('city3d-buildings')?.setData(empty);status();console.warn('3DBAG layer:',error);}
  }
  const originalInit=initPerspective;initPerspective=async function(){await originalInit();setup();};
  const originalToggle=togglePerspective;togglePerspective=async function(){await originalToggle();if(state.perspective)setup();else clear();status();};
  window.addEventListener('planview-language-change',status);
  window.addEventListener('load',()=>{const credit=document.createElement('a');credit.id='city3d-credit';credit.href='https://docs.3dbag.nl/en/copyright/';credit.target='_blank';credit.rel='noopener noreferrer';credit.textContent='© 3DBAG by tudelft3d and 3DGI';credit.title='Building extrusions from 3DBAG LoD1.2; colors sampled from PDOK plan map at each building center · CC BY 4.0';credit.hidden=true;document.querySelector('.map-stage').append(credit);status();});
})();
