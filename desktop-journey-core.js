/* Shared desktop criteria and evidence presentation. Never infer legal permission. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PlanViewJourneyCore=factory();})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const finite=n=>typeof n==='number'&&Number.isFinite(n);
  const letter=index=>{let n=index+1,out='';while(n>0){n--;out=String.fromCharCode(65+n%26)+out;n=Math.floor(n/26);}return out;};
  const fmt=(value,lang='en')=>finite(value)?value.toLocaleString(lang,{maximumFractionDigits:2}):'—';
  function describe(spec={},labels=key=>key){
    const rows=[],add=(id,key,label,value,operator='',unit='',scope='point')=>rows.push({id,key,label,value,operator,unit,scope});
    for(const [key,value] of Object.entries(spec.siteCriteria||{})){
      if(value==null||value===false)continue;
      const unit=/AreaM2$/.test(key)?'m²':/Percent$/.test(key)?'%':/DistanceKm$/.test(key)?'km':'';
      add('site:'+key,key,labels(key),value,key==='excludeNatura2000'?'':/Max|maxBuilding/.test(key)?'≤':'≥',unit,'parcel');
    }
    for(const [key,value] of Object.entries(spec.environmentCriteria||{})){
      if(value==null||Array.isArray(value)&&!value.length)continue;
      const unit=key==='maxNoiseDb'?'dB Lden':key==='maxSlopeDeg'?'°':key==='minGroundwaterDepthCm'?'cm':'';
      add('environment:'+key,key,labels(key),value,key==='soilClasses'?'':key.startsWith('max')?'≤':'≥',unit,key==='maxSlopeDeg'?'parcel':'point');
    }
    for(const [kind,rule] of Object.entries(spec.distanceRules||{}))for(const bound of ['minKm','maxKm'])if(rule?.[bound]!=null)add('distance:'+kind+':'+bound,kind,labels(kind),rule[bound],bound==='minKm'?'≥':'≤','km');
    for(const [field,prefix] of [['groups','group'],['excludeGroups','excludeGroup'],['statuses','status'],['excludeStatuses','excludeStatus']])if(spec[field]?.length)add(prefix+':all',field,labels(field),spec[field],prefix.startsWith('exclude')?'≠':'=');
    for(const [key,label] of [['requireEnvelope','envelope'],['requireUnbuilt','unbuilt'],['insideCamping','insideCamping'],['nearbyHomes','nearbyHomes'],['preferQuiet','quiet']])if(spec[key])add('flag:'+key,key,labels(label),true);
    for(const [index,value] of (spec.unsupported||[]).entries())add('unsupported:'+index,'unsupported',value,null);
    if(spec.accommodationIntent==='accommodation')add('flag:accommodation','accommodation',labels('accommodation'),true);
    return rows;
  }
  function evidence(spec,result={},dependencies={}){
    const findings=result.pointFindings||pointFindings(result,spec,dependencies);const rows=describe(spec,dependencies.labels),site=(dependencies.parcel?.evaluate(result.parcelEvidence,spec.siteCriteria)||result.parcelAssessment)?.checks||[],environment=(dependencies.environment?.evaluate(result.environmentEvidence,spec.environmentCriteria)||result.environmentAssessment)?.checks||[];
    return rows.map(row=>{
      let status='unknown',actual=null;
      if(row.id.startsWith('site:')){const check=site.find(c=>c.key===row.key);if(check){status=check.status;actual=row.key==='excludeNatura2000'&&typeof check.actual==='boolean'?!check.actual:check.actual;}}
      else if(row.id.startsWith('environment:')){const check=environment.find(c=>c.key===row.key);if(check){status=check.status;actual=check.value;}}
      else if(row.id.startsWith('distance:')){const [,kind]=row.id.split(':'),near=result.distances?.[kind]||result.nearFeatures?.[kind]||result[kind];if(near&&finite(near.km)){actual=near.km;status=near.accuracy==='extent'?'unknown':(row.operator==='≤'?actual<=row.value:actual>=row.value)?'pass':'fail';}}
      else if(row.key==='groups'||row.key==='excludeGroups'){actual=result.group||null;if(actual)status=(row.key==='groups'?row.value.includes(actual):!row.value.includes(actual))?'pass':'fail';}
      else if(row.key==='statuses'||row.key==='excludeStatuses'){actual=result.status||null;if(actual)status=(row.key==='statuses'?row.value.includes(actual):!row.value.includes(actual))?'pass':'fail';}
      else if(row.key==='requireEnvelope'&&typeof findings.envelope==='boolean'){actual=findings.envelope;status=actual?'pass':'unknown';}
      else if(row.key==='requireUnbuilt'&&typeof findings.unbuilt==='boolean'){actual=findings.unbuilt;status=actual?'pass':'unknown';}
      else if(row.key==='insideCamping'&&typeof findings.insideCamping==='boolean'){actual=findings.insideCamping;status=actual?'pass':'fail';}
      else if(row.key==='nearbyHomes'&&findings.bag?.state==='checked'){actual=findings.bag.count;status=actual>0?'pass':'unknown';}
      return {...row,status,actual};
    });
  }
  function pointFindings(result={},spec={},dependencies={}){
    const out={};if(spec.requireEnvelope&&typeof result.envelope==='boolean')out.envelope=result.envelope;if(spec.requireUnbuilt&&typeof result.unbuilt==='boolean')out.unbuilt=result.unbuilt;
    if(spec.insideCamping&&result.camping?.item?.geometry&&result.point&&dependencies.contains)out.insideCamping=!!dependencies.contains(result.camping.item.geometry,result.point);
    if(result.bag)out.bag={state:result.bag.state,count:result.bag.count,partial:result.bag.partial};return out;
  }
  function remove(spec,id){
    const out=structuredClone(spec),[section,key,bound]=id.split(':');
    if(section==='site')out.siteCriteria[key]=key==='excludeNatura2000'?false:null;
    else if(section==='environment')out.environmentCriteria[key]=key==='soilClasses'?[]:null;
    else if(section==='distance'){
      out.distanceRules[key][bound]=null;
      if(out.distanceRules[key].minKm==null&&out.distanceRules[key].maxKm==null){if(key==='camping')out.nearCamping=false;else if(key==='town')out.nearTown=false;else if(key==='industry')out.avoidIndustry=false;else out.nearFeatures=(out.nearFeatures||[]).filter(k=>k!==key);}
    }else if(['group','excludeGroup','status','excludeStatus'].includes(section)){const field={group:'groups',excludeGroup:'excludeGroups',status:'statuses',excludeStatus:'excludeStatuses'}[section];out[field]=key==='all'?[]:(out[field]||[]).filter(v=>v!==key);}
    else if(section==='flag')out[key]=key==='accommodation'?'none':false;
    else if(section==='unsupported')out.unsupported=(out.unsupported||[]).filter((v,i)=>i!==Number(key));
    return out;
  }
  return {letter,fmt,describe,evidence,pointFindings,remove,finite};
});
