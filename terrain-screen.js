/* Native AHN DTM terrain screening. GeoTIFF.js 2.1.3 must be loaded first.
 * A complete result covers every native raster cell intersecting the parcel;
 * it is a raster-derived screening metric, not a terrain survey. */
(function (root, factory) {
  const api = factory(root.GeoTIFF);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlanViewTerrainScreen = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (defaultDecoder) {
  'use strict';
  const endpoint = 'https://service.pdok.nl/rws/actueel-hoogtebestand-nederland/wcs/v1_0';
  const capabilitiesUrl = endpoint + '?service=WCS&version=2.0.1&request=GetCapabilities';
  const resolution = 0.5, maxPixels = 1048576, maxBytes = 16777216;
  const method = 'Horn 3×3 gradient on native AHN 0.5 m DTM; intersecting raster cells';
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const checkAbort = signal => { if (signal?.aborted) { const error = new Error('Terrain screening cancelled'); error.name = 'AbortError'; throw error; } };
  const problem = reason => Object.assign(new Error(reason), { reason });
  function wgs84ToRd(p) {
    const f = .36 * (p.lat - 52.1551744), l = .36 * (p.lng - 5.38720621);
    const x = [[0,1,190094.945],[1,1,-11832.228],[2,1,-114.221],[0,3,-32.391],[1,0,-.705],[3,1,-2.34],[1,3,-.608],[0,2,-.008],[2,3,.148]];
    const y = [[1,0,309056.544],[0,2,3638.893],[2,0,73.077],[1,2,-157.984],[3,0,59.788],[0,1,.433],[2,2,-6.439],[1,1,-.032],[0,4,.092],[1,4,-.054]];
    return [155000 + x.reduce((s,[a,b,c]) => s+c*f**a*l**b,0),463000 + y.reduce((s,[a,b,c]) => s+c*f**a*l**b,0)];
  }
  function target(point, geometry) {
    let coords, scope, vertices = 5;
    if (geometry) {
      const g = geometry.type === 'Feature' ? geometry.geometry : geometry;
      coords = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : null;
      vertices = 0;
      if (!Array.isArray(coords) || !coords.length || !coords.every(p => Array.isArray(p) && p.length && p.every(r => Array.isArray(r) && r.length >= 4 && r.every(v => { vertices++; return Array.isArray(v) && finite(v[0]) && finite(v[1]) && v[0] >= 3 && v[0] <= 8 && v[1] >= 50 && v[1] <= 54; }) && r[0][0] === r[r.length-1][0] && r[0][1] === r[r.length-1][1]))) throw problem('invalid-parcel-geometry');
      if (vertices > 100000) throw problem('parcel-geometry-budget');
      coords = coords.map(p => p.map(r => r.map(v => wgs84ToRd({lng:v[0],lat:v[1]})))); scope = 'parcel';
    } else {
      if (!point || !finite(point.lng) || !finite(point.lat) || point.lng < 3 || point.lng > 8 || point.lat < 50 || point.lat > 54) throw problem('invalid-point');
      // Explicit square, not a sampled surrogate for the full parcel.
      const [x,y] = wgs84ToRd(point), r = 20;
      coords = [[[[x-r,y-r],[x+r,y-r],[x+r,y+r],[x-r,y+r],[x-r,y-r]]]]; scope = 'point-neighborhood';
    }
    const bounds = [Infinity,Infinity,-Infinity,-Infinity];
    for (const p of coords) for (const ring of p) for (const [x,y] of ring) { bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y); }
    if (bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) throw problem('empty-parcel-geometry');
    // Two-cell halo supplies all nine heights even for boundary-intersecting cells.
    const box = [Math.floor(bounds[0]/resolution)*resolution-1,Math.floor(bounds[1]/resolution)*resolution-1,Math.ceil(bounds[2]/resolution)*resolution+1,Math.ceil(bounds[3]/resolution)*resolution+1];
    if (box[0] < 10000 || box[1] < 306250 || box[2] > 280000 || box[3] > 618750) throw problem('outside-ahn-coverage');
    const width = Math.round((box[2]-box[0])/resolution), height = Math.round((box[3]-box[1])/resolution);
    if (width * height > maxPixels || width > 4096 || height > 4096) throw problem('native-raster-budget-exceeded');
    if (vertices * height > 20000000) throw problem('parcel-geometry-budget');
    return { polygons:coords, scope, box, width, height };
  }
  function coverageUrl(box) {
    const query = new URLSearchParams({service:'WCS',version:'2.0.1',request:'GetCoverage',coverageId:'dtm_05m',format:'image/tiff'});
    query.append('subset',`x(${box[0]},${box[2]})`); query.append('subset',`y(${box[1]},${box[3]})`);
    return endpoint + '?' + query;
  }
  // Raster mask includes any cell touched by polygon edges and cells whose
  // centers lie inside its rings (even/odd holes). This retains narrow slivers.
  function makeMask(polygons, box, width, height) {
    const mask = new Uint8Array(width*height), s = resolution;
    function mark(row, lo, hi) {
      if (row < 0 || row >= height) return;
      const first = Math.max(0,Math.ceil((lo-box[0])/s)-1), last = Math.min(width-1,Math.floor((hi-box[0])/s));
      if (first <= last) mask.fill(1,row*width+first,row*width+last+1);
    }
    for (const poly of polygons) {
      for (let row=0;row<height;row++) {
        const y=box[3]-(row+.5)*s, xs=[];
        for (const ring of poly) for (let i=1;i<ring.length;i++) {
          const a=ring[i-1],b=ring[i];
          if ((a[1]>y)!==(b[1]>y)) xs.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));
        }
        xs.sort((a,b)=>a-b);
        for (let j=0;j+1<xs.length;j+=2) {
          const first=Math.max(0,Math.ceil((xs[j]-box[0])/s-.5)),last=Math.min(width-1,Math.floor((xs[j+1]-box[0])/s-.5));
          if(first<=last) mask.fill(1,row*width+first,row*width+last+1);
        }
      }
      for (const ring of poly) for (let i=1;i<ring.length;i++) {
        const a=ring[i-1],b=ring[i],lo=Math.min(a[1],b[1]),hi=Math.max(a[1],b[1]);
        const first=Math.max(0,Math.ceil((box[3]-hi)/s)-1),last=Math.min(height-1,Math.floor((box[3]-lo)/s));
        for (let row=first;row<=last;row++) {
          if(a[1]===b[1]) mark(row,Math.min(a[0],b[0]),Math.max(a[0],b[0]));
          else {
            const bottom=Math.max(lo,box[3]-(row+1)*s),top=Math.min(hi,box[3]-row*s);
            const x1=a[0]+(bottom-a[1])*(b[0]-a[0])/(b[1]-a[1]),x2=a[0]+(top-a[1])*(b[0]-a[0])/(b[1]-a[1]);
            mark(row,Math.min(x1,x2),Math.max(x1,x2));
          }
        }
      }
    }
    return mask;
  }
  function horn(values, index, width) {
    const a=values[index-width-1],b=values[index-width],c=values[index-width+1],d=values[index-1],f=values[index+1],g=values[index+width-1],h=values[index+width],i=values[index+width+1];
    const dx=(c+2*f+i-a-2*d-g)/(8*resolution),dy=(g+2*h+i-a-2*b-c)/(8*resolution);
    return Math.atan(Math.hypot(dx,dy))*180/Math.PI;
  }
  async function analyze(values, request, nodata, signal) {
    checkAbort(signal);
    const {width,height,box,polygons,scope}=request,mask=makeMask(polygons,box,width,height);
    let expectedCells=0,validCells=0,maximum=-Infinity,total=0;
    const good = v => finite(v) && v !== nodata && Math.abs(v)<1000000;
    for(let row=0;row<height;row++) {
      if(row%32===0) { await new Promise(resolve=>setTimeout(resolve,0)); checkAbort(signal); }
      for(let col=0;col<width;col++) {
        const index=row*width+col; if(!mask[index]) continue; expectedCells++;
        if(row===0 || col===0 || row===height-1 || col===width-1) continue;
        let valid=true;
        for(let dy=-1;dy<=1&&valid;dy++) for(let dx=-1;dx<=1;dx++) if(!good(values[index+dy*width+dx])) {valid=false;break;}
        if(!valid) continue;
        const slope=horn(values,index,width);maximum=Math.max(maximum,slope);total+=slope;validCells++;
      }
    }
    const complete=expectedCells>0&&validCells===expectedCells;
    return {state:complete?'complete':'unknown',method,metric:'slope_degrees',maxSlopeDeg:validCells?maximum:null,meanSlopeDeg:validCells?total/validCells:null,lowerBound:!complete,
      coverage:{scope,complete,expectedCells,validCells,missingCells:expectedCells-validCells,ratio:expectedCells?validCells/expectedCells:0,resolutionM:resolution,mask:'all intersecting native raster cells',...(scope==='point-neighborhood'?{neighborhoodWidthM:40}:{})},
      ...(!complete?{reason:expectedCells?'no-data-in-slope-neighborhood':'no-intersecting-raster-cells',missing:['complete-native-terrain-coverage']}:{})};
  }
  function metadata(xml) {
    const abstract=(xml.match(/<(?:\w+:)?Abstract\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Abstract>/i)?.[1]||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
    const version=abstract.match(/versie\s+(\d+)/i)?.[1], years=[...new Set(abstract.match(/\b20\d{2}\b/g)||[])].sort();
    return {dataDate:years.length?years.join(', '):null,...(version?{datasetVersion:'AHN'+version}:{}),metadataUrl:capabilitiesUrl};
  }
  function createClient(settings={}) {
    const decoder=settings.GeoTIFF||defaultDecoder,requestFetch=settings.fetch||((...args)=>fetch(...args)),now=settings.now||(()=>Date.now()),cache=new Map();
    const timeoutMs=settings.timeoutMs??25000,ttl=settings.cacheTtlMs??600000;
    let metadataCache=null;
    async function bounded(url,signal,limit) {
      checkAbort(signal);
      const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,timeoutMs);
      signal?.addEventListener('abort',abort,{once:true});
      try {
        const response=await requestFetch(url,{signal:controller.signal});
        if(!response.ok) throw problem('ahn-http-'+response.status);
        if(Number(response.headers?.get?.('content-length'))>limit) throw problem('ahn-response-byte-budget');
        if(response.body?.getReader) {
          const reader=response.body.getReader(),chunks=[];let size=0;
          try { while(true) { const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw problem('ahn-response-byte-budget');}chunks.push(value);checkAbort(signal); } }
          finally { reader.releaseLock(); }
          const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}return data.buffer;
        }
        const buffer=await response.arrayBuffer();if(buffer.byteLength>limit)throw problem('ahn-response-byte-budget');return buffer;
      } finally { clearTimeout(timer);signal?.removeEventListener('abort',abort); }
    }
    async function getMetadata(signal) {
      if(metadataCache&&now()-metadataCache.time<3600000)return metadataCache.value;
      try {const value=metadata(new TextDecoder().decode(await bounded(capabilitiesUrl,signal,1048576)));metadataCache={time:now(),value};return value;} catch {return {dataDate:null,metadataUrl:capabilitiesUrl};}
    }
    async function raster(url,request,signal) {
      const cached=cache.get(url);if(cached&&now()-cached.time<ttl)return cached.value;
      const buffer=await bounded(url,signal,maxBytes);checkAbort(signal);
      if(!decoder?.fromArrayBuffer)throw problem('geotiff-decoder-unavailable');
      const tiff=await decoder.fromArrayBuffer(buffer),img=await tiff.getImage();checkAbort(signal);
      const width=img.getWidth(),height=img.getHeight(),res=img.getResolution(),box=img.getBoundingBox(),keys=img.getGeoKeys(),fd=img.getFileDirectory();
      if(width!==request.width||height!==request.height||width*height>maxPixels)throw problem('unexpected-raster-dimensions');
      if(Math.abs(res[0]-.5)>1e-9||Math.abs(res[1]+.5)>1e-9||box.some((v,i)=>Math.abs(v-request.box[i])>.01))throw problem('unexpected-raster-grid');
      if(keys.ProjectedCSTypeGeoKey!==28992||keys.ProjLinearUnitsGeoKey!==9001||keys.GTRasterTypeGeoKey!==1)throw problem('unexpected-raster-reference');
      if(fd.SamplesPerPixel!==1||fd.BitsPerSample?.[0]!==32||fd.SampleFormat?.[0]!==3)throw problem('unexpected-raster-values');
      const values=await img.readRasters({samples:[0],interleave:true,signal});checkAbort(signal);
      if(values.length!==width*height)throw problem('unexpected-raster-values');
      const value={values,nodata:img.getGDALNoData(),retrievedAt:new Date(now()).toISOString()};
      cache.set(url,{time:now(),value});if(cache.size>4)cache.delete(cache.keys().next().value);return value;
    }
    async function inspect(point,options={}) {
      const {geometry,signal}=options;checkAbort(signal);
      let request,url=endpoint;
      const source={url,label:'PDOK AHN DTM 0.5 m',coverageId:'dtm_05m',crs:'EPSG:28992',verticalDatum:'NAP (metres)',resolutionM:resolution,dataDate:null,retrievedAt:null,metadataUrl:capabilitiesUrl};
      try {
        request=target(point,geometry);url=coverageUrl(request.box);source.url=url;
        const [data,meta]=await Promise.all([raster(url,request,signal),getMetadata(signal)]);checkAbort(signal);Object.assign(source,meta,{retrievedAt:data.retrievedAt});
        return {...await analyze(data.values,request,data.nodata,signal),source};
      } catch(error) {
        checkAbort(signal);
        return {state:'unknown',method,metric:'slope_degrees',maxSlopeDeg:null,meanSlopeDeg:null,coverage:{scope:geometry?'parcel':'point-neighborhood',complete:false,resolutionM:resolution},source,reason:error.reason||'ahn-unavailable',missing:['complete-native-terrain-coverage']};
      }
    }
    return {inspect,clearCache(){cache.clear();metadataCache=null;}};
  }
  const client=createClient();
  return {...client,createClient,endpoint,capabilitiesUrl,limits:{maxPixels,maxBytes,resolutionM:resolution},_test:{wgs84ToRd,target,coverageUrl,makeMask,horn,analyze,metadata}};
});
