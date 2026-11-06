// Metadata only, from the official RP V4 endpoint. Never follows source links.
// https://developer.omgevingswet.overheid.nl/api-register/api/rp-opvragen/
export class RPError extends Error {
  constructor(status,code){super(code);this.status=status;this.code=code;}
}
const base='https://ruimte.omgevingswet.overheid.nl/ruimtelijke-plannen/api/opvragen/v4';
export function cleanPlanId(value){
  if(typeof value!=='string'||!/^NL\.IMRO\.[A-Za-z0-9_.-]{4,120}$/.test(value))throw new RPError(400,'invalid_plan_id');
  return value;
}
const text=(value,max)=>typeof value==='string'?value.slice(0,max):'';
export async function fetchPlanMetadata(id,key,fetcher=fetch){
  cleanPlanId(id);
  let response;
  try{response=await fetcher(`${base}/plannen/${encodeURIComponent(id)}`,{method:'GET',headers:{'x-api-key':key,Accept:'application/hal+json'},redirect:'error',signal:AbortSignal.timeout(16000)});}
  catch{throw new RPError(502,'rp_unavailable');}
  if(!response.ok){
    await response.body?.cancel();
    throw new RPError(response.status===429?429:response.status===404?404:502,response.status===401||response.status===403?'rp_key_rejected':response.status===404?'rp_plan_not_found':response.status===429?'rp_limit':'rp_unavailable');
  }
  let data;
  try{
    if(Number(response.headers.get('Content-Length'))>2000000)throw Error();
    const reader=response.body?.getReader();if(!reader)throw Error();
    let size=0;const chunks=[];
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2000000){await reader.cancel();throw Error();}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    data=JSON.parse(new TextDecoder().decode(bytes));
    if(!data||Array.isArray(data)||data.id!==id||typeof data.naam!=='string'||!data.naam.trim())throw Error();
  }catch{throw new RPError(502,'invalid_rp_response');}
  return {id,title:text(data.naam,300),type:text(data.type,100),status:text(data.planstatusInfo?.planstatus,100),date:text(data.planstatusInfo?.datum,50),
    dossierStatus:text(data.dossier?.status,100),endOfLegalValidity:text(data.eindeRechtsgeldigheid,50),isTamPlan:data.isTamPlan===true,
    source:'Ruimtelijke plannen V4'};
}
