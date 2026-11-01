/** Public KOOP notices for one selected Dutch parcel. Source content is inert data.
 * No keys, personal dossiers, arbitrary fetch URLs, AI, or map state are involved.
 * SRU 2.0 v1.4: https://data.overheid.nl/sites/default/files/dataset/d0cca537-44ea-48cf-9880-fa21e1a7058f/resources/HandleidingSRU2.0.pdf
 */
export const PERMIT_SRU = 'https://repository.overheid.nl/sru';
const BRK = 'https://api.pdok.nl/kadaster/brk-kadastrale-kaart/ogc/v1/collections/perceel/items';
const REVERSE = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/reverse';
const PAGE_SIZE = 25, MAX_POSITION = 1000, TTL = 300000, MAX_CACHE_BYTES = 12000000;
const states = new WeakMap();
export class PermitError extends Error {
  constructor(status,code){super(code);this.name='PermitError';this.status=status;this.code=code;}
}
const uniq = a => [...new Set(a.filter(Boolean))];
const norm = x => String(x||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const cleanText = x => String(x||'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/\s+/g,' ').trim();
const clip = (x,n=600) => {const s=cleanText(x);return s.length>n?s.slice(0,n-1)+'…':s;};
function pointKey(p){return `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;}
export function cleanPermitInput(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['point','parcelId','cursor'].includes(k)))throw new PermitError(400,'invalid_permit_input');
  const p=raw.point;
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['lat','lng'].includes(k))||typeof p.lat!=='number'||typeof p.lng!=='number'||!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||p.lat<50||p.lat>54||p.lng<3||p.lng>8)throw new PermitError(400,'invalid_permit_point');
  const value={point:{lat:+p.lat.toFixed(6),lng:+p.lng.toFixed(6)}};
  if('parcelId'in raw){if(typeof raw.parcelId!=='string'||! /^[A-Za-z0-9_.:\/-]{1,160}$/.test(raw.parcelId))throw new PermitError(400,'invalid_permit_parcel');value.parcelId=raw.parcelId;}
  if('cursor'in raw){if(typeof raw.cursor!=='string'||! /^[A-Za-z0-9_-]{1,600}$/.test(raw.cursor))throw new PermitError(400,'invalid_permit_cursor');value.cursor=raw.cursor;}
  return value;
}
function encodeCursor(p,start,asOf){return btoa(JSON.stringify({v:1,p:pointKey(p),s:start,d:asOf})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function decodeCursor(input){
  if(!input.cursor)return {start:1,asOf:new Date().toISOString().slice(0,10)};
  try{const c=JSON.parse(atob(input.cursor.replace(/-/g,'+').replace(/_/g,'/'))),day=Date.parse(c.d+'T00:00:00Z'),today=Date.parse(new Date().toISOString().slice(0,10)+'T00:00:00Z');
    if(!c||typeof c!=='object'||Object.keys(c).some(k=>!['v','p','s','d'].includes(k))||c.v!==1||c.p!==pointKey(input.point)||!Number.isInteger(c.s)||c.s<2||c.s>MAX_POSITION||!/^\d{4}-\d{2}-\d{2}$/.test(c.d)||!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==c.d||today-day<0||today-day>86400000)throw Error();
    return {start:c.s,asOf:c.d};
  }catch{throw new PermitError(400,'invalid_permit_cursor');}
}
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
function decode(s){return s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(all,key)=>{if(key[0]!=='#')return entities[key]??all;const n=key[1]?.toLowerCase()==='x'?parseInt(key.slice(2),16):+key.slice(1);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'';});}
// Deliberately small non-validating XML tree parser: no entity expansion, DTD or IO.
function xmlTree(xml){
  if(typeof xml!=='string'||xml.length>2000000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new PermitError(502,'invalid_permit_source');
  const root={name:'root',children:[]},stack=[root];let offset=0,nodes=0;
  const tokens=/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[\w:.-]+(?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*\/?>|[^<]+/g;
  for(const m of xml.matchAll(tokens)){
    if(m.index!==offset||++nodes>80000)throw new PermitError(502,'invalid_permit_source');offset=m.index+m[0].length;const t=m[0];
    if(t.startsWith('<!--')||t.startsWith('<?'))continue;
    if(t.startsWith('<![CDATA[')){stack.at(-1).children.push(t.slice(9,-3));continue;}
    if(t.startsWith('</')){const name=t.slice(2,-1).trim().split(':').at(-1);if(stack.length===1||stack.at(-1).name!==name)throw new PermitError(502,'invalid_permit_source');stack.pop();continue;}
    if(t.startsWith('<')){const name=/^<([\w:.-]+)/.exec(t)[1].split(':').at(-1),attrs={};for(const a of t.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))attrs[a[1].split(':').at(-1)]=decode(a[2]??a[3]);const node={name,attrs,children:[]};stack.at(-1).children.push(node);if(!/\/\s*>$/.test(t)){stack.push(node);if(stack.length>90)throw new PermitError(502,'invalid_permit_source');}continue;}
    stack.at(-1).children.push(decode(t));
  }
  if(offset!==xml.length||stack.length!==1)throw new PermitError(502,'invalid_permit_source');return root;
}
function all(node,name,out=[]){for(const c of node.children||[])if(typeof c!=='string'){if(c.name===name)out.push(c);all(c,name,out);}return out;}
function text(node){return !node?'':typeof node==='string'?node:(node.children||[]).map(text).join(' ');}
function first(node,name){return cleanText(text(all(node,name)[0]));}
function fields(node,name){return all(node,name).map(n=>cleanText(text(n)));}
function nodes(node,out=[]){if(node&&typeof node!=='string'){out.push(node);for(const c of node.children||[])nodes(c,out);}return out;}
function directFields(node,name){return (node.children||[]).filter(n=>n?.name===name).map(n=>cleanText(text(n)));}
function urlAllowed(value){
  try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&[
    'zoek.officielebekendmakingen.nl','repository.overheid.nl','repository.officiele-overheidspublicaties.nl','open.rijkswaterstaat.nl'
  ].includes(u.hostname)?u.href:null;}catch{return null;}
}
function sourceURL(record){return urlAllowed(first(record,'url'));}
function documentLinks(root){const links=[];for(const node of all(root,'extref')){const u=urlAllowed(node.attrs?.doc||node.attrs?.href||'');if(u)links.push(u);}for(const node of all(root,'a')){const u=urlAllowed(node.attrs?.href||'');if(u)links.push(u);}return uniq(links).slice(0,12);}
function wktPoint(value,latFirst=false){const m=/^(?:POINT\s*\()?\s*(-?[\d.]+)[,\s]+(-?[\d.]+)\s*\)?$/i.exec(value||'');if(!m)return null;const a=+m[1],b=+m[2],p=latFirst?{lat:a,lng:b}:{lat:b,lng:a};return p.lat>=50&&p.lat<=54&&p.lng>=3&&p.lng<=8?p:null;}
const GEOMETRY_EPS=1e-10;
function onSegment(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1];return Math.abs((p.lng-a[0])*dy-(p.lat-a[1])*dx)<=GEOMETRY_EPS*Math.max(Math.hypot(dx,dy),GEOMETRY_EPS)&&p.lng>=Math.min(a[0],b[0])-GEOMETRY_EPS&&p.lng<=Math.max(a[0],b[0])+GEOMETRY_EPS&&p.lat>=Math.min(a[1],b[1])-GEOMETRY_EPS&&p.lat<=Math.max(a[1],b[1])+GEOMETRY_EPS;}
// Boundary intersection counts; the interior of a polygon hole does not.
function inRing(p,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if(!Array.isArray(a)||!Array.isArray(b))continue;if(onSegment(p,a,b))return 2;if((a[1]>p.lat)!==(b[1]>p.lat)&&p.lng<(b[0]-a[0])*(p.lat-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside?1:0;}
function polygonContains(p,rings){if(!Array.isArray(rings))return false;const outer=inRing(p,rings[0]||[]);if(!outer)return false;if(outer===2)return true;for(const ring of rings.slice(1)){const value=inRing(p,ring);if(value===2)return true;if(value===1)return false;}return true;}
function polygons(geometry){return geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.type==='MultiPolygon'?geometry.coordinates:[];}
export function pointInPermitParcel(p,geometry){return polygons(geometry).some(rings=>polygonContains(p,rings));}
// Same bounded RD New conversion used by the app's existing public geometry adapters.
function rdToWgs(x,y){const dx=(x-155000)/100000,dy=(y-463000)/100000;
  const lat=[[0,1,3235.65389],[2,0,-32.58297],[0,2,-.2475],[2,1,-.84978],[0,3,-.0655],[2,2,-.01709],[1,0,-.00738],[4,0,.0053],[2,3,-.00039],[4,1,.00033],[1,1,-.00012]],lon=[[1,0,5260.52916],[1,1,105.94684],[1,2,2.45656],[3,0,-.81885],[1,3,.05594],[3,1,-.05607],[0,1,.01199],[3,2,-.00256],[1,4,.00128],[0,2,.00022],[2,0,-.00022],[5,0,.00026]];
  const sum=terms=>terms.reduce((total,[a,b,c])=>total+c*dx**a*dy**b,0)/3600;return [5.38720621+sum(lon),52.15517440+sum(lat)];}
/** Only bounded 2D Dutch publication geometries. No WKT evaluation or external IO. */
export function parsePermitGeometry(value){
  if(typeof value!=='string'||value.length>250000)return null;
  const match=/^\s*(?:SRID=(\d+);\s*)?(POLYGON|MULTIPOLYGON|LINESTRING|MULTILINESTRING)\s*(\([\s\S]*\))\s*$/i.exec(value);if(!match||match[1]&&!['4326','4258','28992'].includes(match[1]))return null;
  const tokens=[],token=/\s*([(),]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)/igy;let pos=0,m;
  while(pos<match[3].length){token.lastIndex=pos;m=token.exec(match[3]);if(!m||tokens.length>=50000)return null;tokens.push(m[1]);pos=token.lastIndex;}
  let index=0,count=0,system=match[1]==='28992'?'rd':match[1]?'wgs':null;
  const pair=()=>{const a=+tokens[index++],b=+tokens[index++];if(!Number.isFinite(a)||!Number.isFinite(b)||++count>10000)throw Error();
    const mode=a>=2&&a<=9&&b>=49&&b<=55?'wgs':a>=-10000&&a<=300000&&b>=250000&&b<=650000?'rd':null;if(!mode||system&&system!==mode)throw Error();system=mode;return mode==='rd'?rdToWgs(a,b):[a,b];};
  const list=(depth=0)=>{if(depth>3||tokens[index++]!=='(')throw Error();const out=[];for(;;){out.push(tokens[index]==='('?list(depth+1):pair());if(tokens[index]===')'){index++;return out;}if(tokens[index++]!==',')throw Error();}};
  try{const coordinates=list();if(index!==tokens.length)throw Error();const validPair=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite),line=l=>Array.isArray(l)&&l.length>=2&&l.every(validPair),ring=r=>line(r)&&r.length>=4&&r[0].every((v,i)=>Math.abs(v-r.at(-1)[i])<GEOMETRY_EPS),polygon=p=>Array.isArray(p)&&p.length>0&&p.every(ring),type=match[2].toUpperCase();
    if(type==='POLYGON'&&polygon(coordinates))return {type:'Polygon',coordinates};if(type==='MULTIPOLYGON'&&coordinates.length&&coordinates.every(polygon))return {type:'MultiPolygon',coordinates};if(type==='LINESTRING'&&line(coordinates))return {type:'LineString',coordinates};if(type==='MULTILINESTRING'&&coordinates.length&&coordinates.every(line))return {type:'MultiLineString',coordinates};
  }catch{}return null;
}
function segmentsIntersect(a,b,c,d){const cross=(u,v,w)=>(v[0]-u[0])*(w[1]-u[1])-(v[1]-u[1])*(w[0]-u[0]),s1=cross(a,b,c),s2=cross(a,b,d),s3=cross(c,d,a),s4=cross(c,d,b);if(s1*s2<0&&s3*s4<0)return true;return [[a,c,d],[b,c,d],[c,a,b],[d,a,b]].some(([p,u,v])=>onSegment({lng:p[0],lat:p[1]},u,v));}
function ringsIntersect(a,b){for(let i=1;i<a.length;i++)for(let j=1;j<b.length;j++)if(segmentsIntersect(a[i-1],a[i],b[j-1],b[j]))return true;return false;}
function lines(geometry){return geometry.type==='LineString'?[geometry.coordinates]:geometry.type==='MultiLineString'?geometry.coordinates:[];}
export function permitGeometryRelation(point,geometry,parcelGeometry){
  if(!geometry)return null;const area=polygons(geometry),linear=lines(geometry);
  if(area.some(rings=>polygonContains(point,rings))||linear.some(line=>line.slice(1).some((b,i)=>onSegment(point,line[i],b))))return 'contains_point';
  for(const parcel of polygons(parcelGeometry)){
    for(const source of area){if(source.some(a=>parcel.some(b=>ringsIntersect(a,b)))||source[0].some(p=>polygonContains({lng:p[0],lat:p[1]},parcel))||parcel[0].some(p=>polygonContains({lng:p[0],lat:p[1]},source)))return 'intersects_parcel';}
    for(const line of linear)if(line.some(p=>polygonContains({lng:p[0],lat:p[1]},parcel))||parcel.some(ring=>ringsIntersect(line,ring)))return 'intersects_parcel';
  }return null;
}
function markedGeometries(record){const out=[],locationNodes=(node,out=[])=>{if(!node||typeof node==='string'||/effectgebied/i.test(node.name))return out;out.push(node);for(const child of node.children||[])locationNodes(child,out);return out;};for(const mark of all(record,'gebiedsmarkering'))for(const node of locationNodes(mark)){
  // effectgebied is intentionally excluded: effects do not locate the permitted works.
  const preferred=directFields(node,'locatiegebied').map(parsePermitGeometry).filter(Boolean),fallback=directFields(node,'geometrie').map(parsePermitGeometry).filter(Boolean);
  for(const geometry of preferred.length?preferred:fallback)out.push({geometry,label:first(node,'geometrielabel')||null});
}return out;}
function broadGeometry(geometry){const p=[];const walk=c=>{if(typeof c?.[0]==='number')p.push(c);else if(Array.isArray(c))c.forEach(walk);};walk(geometry.coordinates);if(!p.length)return false;const lng=p.map(c=>c[0]),lat=p.map(c=>c[1]);return distance({lng:Math.min(...lng),lat:Math.min(...lat)},{lng:Math.max(...lng),lat:Math.max(...lat)})>5;}
function distance(a,b){return Math.hypot((a.lat-b.lat)*111.2,(a.lng-b.lng)*111.2*Math.cos(a.lat*Math.PI/180));}
function stateFor(fetcher){let s=states.get(fetcher);if(!s){s={cache:new Map(),bytes:0,inflight:new Map(),active:0,requests:[],cooldown:0};states.set(fetcher,s);}return s;}
async function boundedText(response,max){const len=Number(response.headers.get('content-length'));if(len>max)throw new PermitError(502,'permit_source_too_large');if(!response.body){const t=await response.text();if(t.length>max)throw new PermitError(502,'permit_source_too_large');return t;}const reader=response.body.getReader();let n=0;const chunks=[];try{for(;;){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>max)throw new PermitError(502,'permit_source_too_large');chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}const data=new Uint8Array(n);let i=0;for(const c of chunks){data.set(c,i);i+=c.byteLength;}return new TextDecoder().decode(data);}
async function publicGet(url,fetcher,signal,max=1500000){
  const s=stateFor(fetcher),cached=s.cache.get(url),now=Date.now();if(cached&&cached.until>now)return cached.text;
  if(s.inflight.has(url))return s.inflight.get(url);
  if(s.cooldown>now)throw new PermitError(503,'permit_service_busy');
  const task=(async()=>{const response=await fetcher(url,{method:'GET',redirect:'error',signal,headers:{Accept:url.startsWith(PERMIT_SRU)||url.includes('/xml/')?'application/xml':'application/json'}});
    if(!response.ok){if(response.status===429){s.cooldown=Date.now()+60000;throw new PermitError(503,'permit_service_busy');}throw new PermitError(502,'permit_source_unavailable');}
    const value=await boundedText(response,max);if(cached){s.bytes-=cached.text.length*2;s.cache.delete(url);}for(const [key,item]of s.cache){if(item.until<=now||s.bytes+value.length*2>MAX_CACHE_BYTES){s.cache.delete(key);s.bytes-=item.text.length*2;}else break;}if(value.length*2<=MAX_CACHE_BYTES){s.cache.set(url,{until:now+TTL,text:value});s.bytes+=value.length*2;}return value;})();
  s.inflight.set(url,task);try{return await task;}finally{s.inflight.delete(url);}
}
function addressKey(a){return [norm(a.street),norm(a.number),norm(a.letter),norm(a.addition),norm(a.place)].join('|');}
function addressFromNode(n){return {street:first(n,'straatnaam'),number:first(n,'huisnummer'),letter:first(n,'huisletter'),addition:first(n,'huisnummertoevoeging'),place:first(n,'woonplaats'),postcode:first(n,'postcode')};}
function addressLabel(a){return `${a.street} ${a.number}${a.letter}${a.addition?'-'+a.addition:''}, ${a.postcode||''} ${a.place}`.replace(/\s+/g,' ').trim();}
// Title evidence is useful, but remains distinct from a structured cadastral/address link.
export function titleMentionsPermitAddress(title,address,locality=''){
  const normalized=s=>cleanText(s).normalize('NFKC').toLowerCase().replace(/[–—]/g,'-');
  const escape=s=>normalized(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+');
  if(!address.street||!/^\d+$/.test(address.number)||!address.place)return false;
  const source=normalized(title),place=escape(address.place);
  const expression=new RegExp(`(?<![\\p{L}\\p{N}])${escape(address.street)}\\s+${escape(address.number)}${address.letter?'\\s*'+escape(address.letter):''}${address.addition?'[\\s/-]*'+escape(address.addition):''}(?![\\p{L}\\p{N}])`,'gu');
  for(const match of source.matchAll(expression)){
    const before=source.slice(0,match.index),after=source.slice(match.index+match[0].length);
    // Neither neighbours nor partial house numbers, ranges or lists establish this address.
    if(/(?:tegenover|naast|nabij|bij|rondom|ter hoogte van|omgeving van)\s+(?:de\s+)?$/u.test(before))continue;
    if(/\b(?:oude|nieuwe|lange|korte|grote|kleine|eerste|tweede|derde)\s+$/u.test(before))continue;
    if(/^(?:\s*[-/]\s*[\p{L}\p{N}]|\s+[a-z](?![\p{L}\p{N}])|\s*(?:,|en|t\/?m|tot(?: en met)?)\s*(?!\d{4}\s?[a-z]{2}\b)\d)/u.test(after))continue;
    if(/^\s+(?:bis|hs|huis|[ivx]{1,4})(?![\p{L}\p{N}])/u.test(after))continue;
    if(/^\s+(?:te|in)\s+/u.test(after)&&!new RegExp(`^\\s+(?:te|in)\\s+${place}(?![\\p{L}\\p{N}])`,'u').test(after))continue;
    if(new RegExp(`(?<![\\p{L}\\p{N}])${place}(?![\\p{L}\\p{N}])`,'u').test(source)||norm(locality)===norm(address.place))return true;
  }
  return false;
}
async function resolveLocation(input,fetcher,signal,warnings){
  const p=input.point,delta=.000012,bbox=[p.lng-delta,p.lat-delta,p.lng+delta,p.lat+delta].map(n=>n.toFixed(7)).join(',');
  const responses=await Promise.allSettled([publicGet(BRK+'?'+new URLSearchParams({bbox,limit:'100',f:'json'}),fetcher,signal),publicGet(REVERSE+'?'+new URLSearchParams({lat:String(p.lat),lon:String(p.lng),type:'adres',rows:'30',fl:'*'}),fetcher,signal)]);
  let features=[],docs=[];
  try{if(responses[0].status==='rejected')throw responses[0].reason;const j=JSON.parse(responses[0].value);features=(j.features||[]).filter(f=>pointInPermitParcel(p,f.geometry));if((j.links||[]).some(l=>l.rel==='next'))warnings.push('parcel_query_truncated');}catch{warnings.push('parcel_unavailable');}
  try{if(responses[1].status==='rejected')throw responses[1].reason;docs=JSON.parse(responses[1].value)?.response?.docs||[];}catch{warnings.push('address_unavailable');}
  if(features.length!==1){warnings.push(features.length?'parcel_ambiguous':'parcel_not_found');return {location:{point:p,parcelId:null,parcelLabel:null,addresses:[]},parcel:null,addresses:[],radius:.1};}
  const parcel=features[0],pr=parcel.properties||{},code=pr.akr_kadastrale_gemeente_code_waarde||'',section=pr.sectie||'',number=pr.perceelnummer||'',parcelId=[code,section,number].join('-'),parcelLabel=[code,section,number].join(' ');
  if(input.parcelId&&![parcel.id,pr.identificatie_lokaal_id,parcelId,`NL.IMKAD.KadastraalObject.${pr.identificatie_lokaal_id}`].some(id=>id===input.parcelId))warnings.push('parcel_identity_changed');
  const addresses=docs.filter(d=>d.type==='adres'&&d.straatnaam&&d.huisnummer!=null&&d.woonplaatsnaam&&pointInPermitParcel(wktPoint(d.geometrie_ll||d.centroide_ll)||{lat:0,lng:0},parcel.geometry)).map(d=>({street:d.straatnaam,number:String(d.huisnummer),letter:d.huisletter||'',addition:d.huisnummertoevoeging||'',place:d.woonplaatsnaam,postcode:d.postcode||''}));
  const seen=new Set(),uniqueAddresses=addresses.filter(a=>!seen.has(addressKey(a))&&seen.add(addressKey(a)));
  if(docs.length>=30)warnings.push('address_candidates_limited');
  let radius=.1;const walk=x=>{if(Array.isArray(x)&&typeof x[0]==='number')radius=Math.max(radius,distance(p,{lng:x[0],lat:x[1]})+.025);else if(Array.isArray(x))x.forEach(walk);};walk(parcel.geometry.coordinates);if(radius>.5)warnings.push('large_parcel_search_limited');radius=Math.min(radius,.5);
  return {location:{point:p,parcelId,parcelLabel,addresses:uniqueAddresses.map(addressLabel)},parcel,addresses:uniqueAddresses,radius};
}
function q(s){return '"'+String(s).replace(/["\\]/g,' ').replace(/[\u0000-\u001f]/g,' ').slice(0,160)+'"';}
function buildQuery(resolved,asOf){
  const p=resolved.location.point,spatial=`within/etrs89 "${p.lat} ${p.lng} ${resolved.radius.toFixed(3)}"`,areas=[`w.locatiepunt ${spatial}`,`cd.afgeleideLocatiegebied ${spatial}`];
  // The production area index is the one used by KOOP's own map module:
  // https://kaarten-demo.overheid.nl/doc.html (w.locatiegebied currently returns Unsupported index).
  // One OR query keeps one global result order/cursor and SRU deduplicates shared point/area hits.
  // Local geometry checks below distinguish actual overlap from an area-index proximity candidate.
  // Address supplements exist only after the BAG point falls inside the selected BRK polygon.
  // The documented w.straatnaam index is not supported by the live collection.
  // Full-text phrase searches supplement the point; metadata still decides association.
  for(const a of resolved.addresses.slice(0,8))areas.push(`(cql.textAndIndexes adj ${q(`${a.street} ${a.number}${a.letter}${a.addition?'-'+a.addition:''}`)} AND cql.textAndIndexes=${q(a.place)})`);
  return `c.product-area=="officielepublicaties" AND dt.type="omgevingsvergunning" AND dt.modified<=${asOf} AND (${areas.join(' OR ')}) sortBy dt.modified/sort.descending dt.identifier/sort.ascending`;
}
function isBuilding(record){
  const activities=fields(record,'activiteit').join(' ').toLowerCase();if(/\bbouwen\b|bouwactiviteit/.test(activities))return true;
  const title=first(record,'title');return /\b(?:bouwen|bouw(?:en|plan|project|activiteit|vergunning)?|nieuwbouw|verbouw\w*|aanbouw\w*|uitbouw\w*|dakkapel\w*|dakopbouw\w*|balkon\w*|serre|oprichten|woning(?:splits\w*|vorming)|splitsen van (?:de |een )?woning|transformeren|uitbreiden|uitbreiding|gevelwijziging|dakterras|constructieve|renovatie|renoveren|slopen|sloop)\b/i.test(title);
}
export function permitStatus(title,body=''){
  const head=cleanText(title).toLowerCase();
  if(/\b(?:ontwerp(?:besluit|beschikking|vergunning)?|voornemen|voorgenomen)\b/.test(head))return 'draft';
  const paragraphs=body.split('\n').filter(Boolean),decision=paragraphs.find(p=>/^\s*(?:besluit|beslissing|beschikking)\s*:/i.test(p))||'';
  const probe=(decision||head).toLowerCase();
  if(/\b(?:ontwerp(?:besluit|beschikking|vergunning)?|voornemen|voorgenomen)\b/.test(probe))return 'draft';
  if(/\b(?:niet|geen)\b(?:\s+[\p{L}]+){0,3}\s+(?:verleend\w*|geweigerd\w*|afgewezen|ingetrokken)/u.test(probe))return 'unknown';
  if(/(?:aanvraag|verzoek).{0,70}(?:ingetrokken|intrekken)|(?:ingetrokken|intrekking).{0,50}(?:aanvraag|verzoek)/.test(probe))return 'withdrawn';
  if(/(?:vergunning).{0,60}(?:ingetrokken|intrekken)|(?:intrekking|ingetrokken).{0,40}(?:omgevings)?vergunning/.test(probe))return 'revoked';
  if(/\b(?:verleng\w*|verdaag\w*|verdaging|opschort\w*)\b/.test(probe))return 'extended';
  const refused=/\b(?:geweigerde?|weigering|afgewezene?|afwijzing)\b/.test(probe),granted=/\b(?:verleende?|verlening|toegekende?)\b/.test(probe);
  if(refused&&granted)return /\b(?:gedeeltelijk|deels)\b|verleend\w*\s+en\s+geweigerd\w*|geweigerd\w*\s+en\s+verleend\w*/.test(probe)?'mixed':'unknown';
  if(refused)return 'refused';
  if(granted)return 'granted';
  if(/\b(?:gewijzigd|wijziging|rectificatie|herstelbesluit)\b/.test(probe))return 'amended';
  // RWS application notices use this Dutch compound instead of a separate "aanvraag".
  // A generic decision about an application still cannot establish submission or outcome.
  if(/\bvergunningaanvraag\b/.test(probe)&&!/\b(?:besluit|beslissing|beschikking)\b/.test(probe))return 'submitted';
  if(/\b(?:aanvraag|aangevraagd|ontvangen|ingediend)\b/.test(probe))return 'submitted';
  return 'unknown';
}
function caseNumber(body){
  const matches=[];for(const line of body.split('\n')){const m=/^\s*(?:referentienummer\s*(?:dossier)?|zaak(?:nummer|kenmerk)|dossiernummer|kenmerk|registratienummer|aanvraagnummer)\s*:?\s*([a-z\d][a-z\d.\/_-]{3,79})(?:\s|$)/i.exec(line)||/\b(?:aanvraag|besluit) met zaaknummer\s+([a-z\d][a-z\d.\/_-]{3,79})(?:\s|$)/i.exec(line);if(m&&/\d/.test(m[1])&&!/^(?:datum|deze|geen|voor|202[0-9])$/i.test(m[1]))matches.push(m[1]);}const ids=uniq(matches.map(s=>s.toUpperCase()));return ids.length===1?ids[0]:null;
}
const months={januari:1,februari:2,maart:3,april:4,mei:5,juni:6,juli:7,augustus:8,september:9,oktober:10,november:11,december:12};
function dateValue(s){let m=/\b(20\d{2})-(\d\d)-(\d\d)\b/.exec(s);if(m)return m[0];m=/\b(\d{1,2})[\s-]+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)[\s-]+(20\d{2})\b/i.exec(s);if(m)return `${m[3]}-${String(months[m[2].toLowerCase()]).padStart(2,'0')}-${m[1].padStart(2,'0')}`;m=/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/.exec(s);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:null;}
function decisionDate(body){const line=body.split('\n').find(p=>/^\s*(?:datum (?:besluit|beslissing|beschikking|verzending)|besluitdatum|verzenddatum|verzonden op)/i.test(p));return line?dateValue(line):null;}
function projectSummary(title,body){
  const labelled=body.split('\n').find(l=>/^\s*(?:omschrijving|beschrijving(?: van (?:het )?(?:plan|project|de activiteit))?|activiteit(?:en)?)\s*:/i.test(l));
  if(labelled)return clip(labelled.replace(/^[^:]*:\s*/,''),620);
  const description=body.split('\n').find(l=>/\b(?:aanvraag|project|activiteit|plan)\b.{0,100}\bbetreft\b/i.test(l));if(description)return clip(description,620);
  // This is a factual excerpt from the notice title, not an inferred permit assessment.
  const excerpt=title.split(/(?:omgevingsvergunning|beslissing op bezwaar)[^,]*,\s*/i).at(-1);
  return clip(excerpt&&excerpt.length>=12?excerpt:title,620);
}
function association(record,resolved){
  const pr=resolved.parcel?.properties||{},code=pr.akr_kadastrale_gemeente_code_waarde,section=pr.sectie,number=String(pr.perceelnummer||'');
  // Match within a single marked cadastral location, never combine fields from different parcels.
  for(const mark of all(record,'gebiedsmarkering'))for(const n of nodes(mark)){
    // An administrative municipality name alone cannot identify a cadastral municipality.
    // Every component must be a direct child of the SAME individual parcel tuple.
    const numbers=directFields(n,'perceelnummer'),sections=directFields(n,'kadastraleSectie');
    if(numbers.length!==1||sections.length!==1)continue;
    const codes=uniq([...directFields(n,'kadastraleGemeenteCode'),...directFields(n,'kadastraleGemeente'),...directFields(n,'ligtInGemeente').filter(v=>/^[A-Z]{3}\d{2}$/.test(v))]);
    const names=uniq(directFields(n,'kadastraleGemeenteNaam'));
    const municipality=(codes.length===1&&norm(codes[0])===norm(code))||(names.length===1&&norm(names[0])===norm(pr.kadastrale_gemeente_waarde));
    if(number&&municipality&&numbers[0]===number&&sections[0]===section)return {kind:'parcel',label:resolved.location.parcelLabel,certain:true};
  }
  for(const n of all(record,'Adres')){const a=addressFromNode(n);if(resolved.addresses.some(b=>addressKey(a)===addressKey(b)))return {kind:'address',label:addressLabel(a),certain:true};}
  // Do not override contradictory structured address metadata with free text.
  if(!all(record,'Adres').some(n=>first(n,'straatnaam')&&first(n,'huisnummer'))){
    const title=first(record,'title'),locality=first(record,'woonplaats')||first(record,'authority')||first(record,'creator');
    const address=resolved.addresses.find(a=>titleMentionsPermitAddress(title,a,locality));
    if(address)return {kind:'title_address',label:addressLabel(address),certain:false};
  }
  for(const {geometry,label}of markedGeometries(record)){const relation=permitGeometryRelation(resolved.location.point,geometry,resolved.parcel?.geometry);if(relation)return {kind:'area',label,certain:false,relation,geometryType:geometry.type,broad:broadGeometry(geometry)};}
  const points=fields(record,'locatiepunt').map(v=>wktPoint(v,true)).filter(Boolean);
  if(resolved.parcel&&points.some(p=>pointInPermitParcel(p,resolved.parcel.geometry)))return {kind:'mapped_location',label:null,certain:false};
  return {kind:'nearby',label:first(record,'geometrielabel')||null,certain:false};
}
async function makeEvent(record,resolved,fetcher,signal,warnings){
  const id=first(record,'identifier');if(!/^(?:gmb|stcrt|prb|wsb|bgr)-\d{4}-\d{1,9}$/.test(id))return null;
  const title=clip(first(record,'title'),700),authority=clip(first(record,'authority')||first(record,'creator'),200),date=first(record,'available')||first(record,'date')||first(record,'modified');
  const authorityNode=all(record,'authority')[0]||all(record,'creator')[0],authorityKey=authorityNode?.attrs?.resourceIdentifier||authorityNode?.attrs?.resource||`${authorityNode?.attrs?.scheme||'unspecified'}|${authority}`;
  let body='',links=[],retrieved=false;const u=sourceURL(record);
  if(u&&u.startsWith('https://repository.overheid.nl/frbr/officielepublicaties/')&&u.endsWith(`/${id}.xml`)){
    try{const source=xmlTree(await publicGet(u,fetcher,signal,1200000));const content=all(source,'zakelijke-mededeling-tekst')[0]||all(source,'gemeenteblad')[0]||source;body=all(content,'al').map(n=>cleanText(text(n))).join('\n');links=documentLinks(content);retrieved=true;}
    catch{warnings.push('notice_document_unavailable');}
  }else warnings.push('notice_document_unavailable');
  const status=permitStatus(title,body),summary=projectSummary(title,body),linked=association(record,resolved),sourceTextTruncated=body.length>12000;
  links=uniq([...links,...fields(record,'terinzageleggingBG').map(urlAllowed).filter(Boolean)]).slice(0,12);
  if(sourceTextTruncated)warnings.push('notice_text_truncated');
  const event={id,title,summary,status,date:/^\d{4}-\d{2}-\d{2}$/.test(date)?date:null,decisionDate:decisionDate(body),caseNumber:caseNumber(body),url:`https://zoek.officielebekendmakingen.nl/${id}.html`,documentUrls:links,sourceAvailable:retrieved,sourceText:body.slice(0,12000),sourceTextTruncated,association:linked};
  return {event,authority,authorityKey,association:linked,activity:uniq(fields(record,'activiteit')).join(' · ')};
}
export function groupPermitEvents(items){
  const strength=a=>a?.certain?5:a?.kind==='title_address'?4:a?.kind==='area'?3:a?.kind==='mapped_location'?2:1;
  const groups=new Map();for(const item of items.filter(Boolean).sort((a,b)=>a.event.id.localeCompare(b.event.id))){const e=item.event,key=e.caseNumber&&item.authority?`case-${encodeURIComponent(cleanText(item.authorityKey||item.authority).toLowerCase())}-${encodeURIComponent(e.caseNumber)}`:e.id;let g=groups.get(key);if(!g){g={id:key,title:e.title,summary:e.summary,status:e.status,activity:item.activity||null,authority:item.authority,caseNumber:e.caseNumber,association:item.association,events:[],latestDate:e.date};groups.set(key,g);}if(!g.events.some(x=>x.id===e.id))g.events.push(e);if(strength(item.association)>strength(g.association))g.association=item.association;}
  const decisive=new Set(['granted','refused','withdrawn','revoked','mixed']);for(const g of groups.values()){
    g.events.sort((a,b)=>(a.date||'').localeCompare(b.date||'')||a.id.localeCompare(b.id));
    const latest=g.events.at(-1),decisions=g.events.filter(e=>decisive.has(e.status)).sort((a,b)=>(a.decisionDate||a.date||'').localeCompare(b.decisionDate||b.date||'')||(a.date||'').localeCompare(b.date||''));
    const statusEvent=decisions.at(-1)||latest;g.latestDate=latest.date;g.status=statusEvent.status;g.statusDate=statusEvent.decisionDate||statusEvent.date;g.statusEventId=statusEvent.id;g.title=latest.title;g.summary=latest.summary;
  }
  return [...groups.values()].sort((a,b)=>(b.latestDate||'').localeCompare(a.latestDate||'')||a.id.localeCompare(b.id));
}
export async function fetchPermits(raw,fetcher=fetch,externalSignal=null){
  const input=cleanPermitInput(raw),{start,asOf}=decodeCursor(input),state=stateFor(fetcher),now=Date.now();
  state.requests=state.requests.filter(t=>now-t<300000);if(state.active>=3||state.requests.length>=90)throw new PermitError(429,'permit_rate_limit');state.requests.push(now);state.active++;
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,45000),warnings=['historical_coverage_unknown','notice_status_not_legal_finality'];
  if(externalSignal?.aborted)abort();else externalSignal?.addEventListener('abort',abort,{once:true});
  try{
    if(externalSignal?.aborted)throw new PermitError(502,'permit_timeout');
    const resolved=await resolveLocation(input,fetcher,controller.signal,warnings),query=buildQuery(resolved,asOf);
    const url=PERMIT_SRU+'?'+new URLSearchParams({operation:'searchRetrieve',version:'2.0',recordSchema:'gzd',maximumRecords:String(PAGE_SIZE),startRecord:String(start),query});
    let root;try{root=xmlTree(await publicGet(url,fetcher,controller.signal));if(all(root,'diagnostic').length||!all(root,'numberOfRecords').length)throw Error();}catch(e){if(e instanceof PermitError&&e.code==='permit_service_busy')throw e;throw new PermitError(502,'permit_sources_unavailable');}
    const records=all(root,'record'),seen=new Set(),building=records.filter(r=>{const id=first(r,'identifier');if(seen.has(id))return false;seen.add(id);return isBuilding(r);}),items=[];
    // Three parallel document fetches bound request fan-out and stay below Worker subrequest limits.
    let index=0;await Promise.all(Array.from({length:Math.min(3,building.length)},async()=>{while(index<building.length){const record=building[index++];items.push(await makeEvent(record,resolved,fetcher,controller.signal,warnings));}}));
    if(externalSignal?.aborted)throw new PermitError(502,'permit_timeout');
    const total=Math.max(0,Math.min(1000000,+first(root,'numberOfRecords')||0)),next=+first(root,'nextRecordPosition')||start+records.length;
    const hasMore=records.length>0&&next>start&&next<=total&&next<=MAX_POSITION;
    if(total>MAX_POSITION)warnings.push('result_limit');if(hasMore)warnings.push('more_publications_available');if(resolved.addresses.length>8)warnings.push('address_search_limited');
    const cases=groupPermitEvents(items),nextCursor=hasMore?encodeCursor(input.point,next,asOf):null;
    return {version:1,location:resolved.location,retrievedAt:new Date().toISOString(),asOf,coverage:{complete:false,available:true,partial:warnings.some(w=>/unavailable|ambiguous|truncated/.test(w)),warnings:uniq(warnings),returned:cases.length,total,candidatePublications:records.length,hasMore,nextCursor},cases,nextCursor};
  }catch(e){if(e instanceof PermitError)throw e;throw new PermitError(502,controller.signal.aborted?'permit_timeout':'permit_sources_unavailable');}finally{clearTimeout(timer);externalSignal?.removeEventListener('abort',abort);state.active--;}
}
