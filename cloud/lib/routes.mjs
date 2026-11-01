// Fixed-host routing proxies. Coordinates are sent only after the user's request.
// Reference: https://giscience.github.io/openrouteservice/api-reference/endpoints/matrix/
// Public service policy: https://routing.openstreetmap.de/about.html
export class RoutingError extends Error {
  constructor(status, code) { super(code); this.status=status; this.code=code; }
}
export const routeProfiles=Object.freeze({walking:'foot-walking',cycling:'cycling-regular',driving:'driving-car'});
const publicProfiles=Object.freeze({walking:'routed-foot',cycling:'routed-bike',driving:'routed-car'});
const applicationUrl='https://planview-maastricht-spatial.dannhir.chatgpt.site';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
function point(value,label=false){
  if(!object(value)||Object.keys(value).some(k=>!['lat','lng',...(label?['label']:[])].includes(k))||
    !Number.isFinite(value.lat)||!Number.isFinite(value.lng)||value.lat<50.6||value.lat>53.8||value.lng<3||value.lng>7.6||
    (value.label!==undefined&&(typeof value.label!=='string'||value.label.length>160)))throw new RoutingError(400,'invalid_route_point');
  return {lat:value.lat,lng:value.lng,...(label&&value.label?{label:value.label.trim()}: {})};
}
export function cleanRouteInput(payload){
  if(!object(payload)||Object.keys(payload).some(k=>!['origins','target','mode'].includes(k))||!Array.isArray(payload.origins)||payload.origins.length<1||payload.origins.length>3||typeof payload.mode!=='string'||!Object.hasOwn(routeProfiles,payload.mode))throw new RoutingError(400,'invalid_route_request');
  return {origins:payload.origins.map(p=>point(p)),target:point(payload.target,true),mode:payload.mode};
}
export async function callRouting(key,payload,fetcher=fetch){
  const input=cleanRouteInput(payload),provider=key?'ors':'osrm',profile=key?routeProfiles[input.mode]:publicProfiles[input.mode];let response;
  const options=key?{
    method:'POST',
    headers:{Authorization:key,'Content-Type':'application/json',Accept:'application/json'},
    body:JSON.stringify({locations:[...input.origins,input.target].map(p=>[p.lng,p.lat]),sources:input.origins.map((_,i)=>String(i)),destinations:[String(input.origins.length)],metrics:['duration','distance'],units:'m'})
  }:{method:'GET',headers:{Accept:'application/json','User-Agent':`PlanView/1.0 (${applicationUrl})`,Referer:applicationUrl+'/'} };
  const coordinates=[...input.origins,input.target].map(p=>`${p.lng},${p.lat}`).join(';');
  const url=key?`https://api.heigit.org/openrouteservice/v2/matrix/${profile}`:`https://routing.openstreetmap.de/${profile}/table/v1/driving/${coordinates}?sources=${input.origins.map((_,i)=>i).join(';')}&destinations=${input.origins.length}&annotations=duration,distance&generate_hints=false`;
  try{response=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(12000)});}catch{throw new RoutingError(502,'routing_unavailable');}
  if(!response.ok)throw new RoutingError(response.status===429?429:502,key&&(response.status===401||response.status===403)?'routing_key_rejected':response.status===429?'routing_limit':'routing_unavailable');
  let data;
  try{const raw=await response.text();if(raw.length>64000)throw Error();data=JSON.parse(raw);
    if(provider==='osrm'&&(data.code!=='Ok'||Object.hasOwn(data,'fallback_speed_cells')))throw Error();
    if(!Array.isArray(data.durations)||!Array.isArray(data.distances)||data.durations.length!==input.origins.length||data.distances.length!==input.origins.length)throw Error();
    for(let i=0;i<input.origins.length;i++)for(const field of ['durations','distances']){const row=data[field][i];if(!Array.isArray(row)||row.length!==1||(row[0]!==null&&(!Number.isFinite(row[0])||row[0]<0)))throw Error();}
  }catch{throw new RoutingError(502,'invalid_routing_response');}
  return {mode:input.mode,profile,provider,target:input.target,source:key?'openrouteservice / HeiGIT · OpenStreetMap':'OSRM / FOSSGIS · OpenStreetMap',sourceUrl:key?'https://openrouteservice.org/':'https://routing.openstreetmap.de/about.html',attributionUrl:'https://www.openstreetmap.org/copyright',editUrl:'https://www.openstreetmap.org/fixthemap',retrievedAt:new Date().toISOString(),modeled:true,liveTraffic:false,
    routes:input.origins.map((origin,i)=>{const durationSeconds=data.durations[i][0],distanceMeters=data.distances[i][0],available=durationSeconds!==null&&distanceMeters!==null;return {origin,status:available?'available':'unavailable',durationSeconds:available?durationSeconds:null,distanceMeters:available?distanceMeters:null};})};
}
