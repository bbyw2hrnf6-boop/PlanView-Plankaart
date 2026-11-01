/* Environmental models in the existing inspector, loaded explicitly on request. */
(() => {
  const tr=(en,nl,de)=>({nl,de}[document.documentElement.lang]||en),screen=window.PlanViewEnvironmentScreen;
  function show(selected){
    if(state.selected!==selected)return;
    const target=document.querySelector('#detail-content .detail-inner > .detail-section[data-pv-tab="summary"]');if(!target)return;
    target.querySelector('.pv-env-summary')?.remove();
    const evidence=selected.environmentEvidence||selected.point.searchEvidence?.environmentEvidence;
    const section=document.createElement('section');section.className='pv-env-summary';section.setAttribute('aria-busy',String(!!selected.environmentLoading));
    section.innerHTML=`<h3>${esc(tr('Environmental models','Omgevingsmodellen','Umweltmodelle'))}</h3><p>${esc(tr('Noise, soil and groundwater describe the sample point. Terrain slope uses the whole resolved parcel at native raster resolution. These are models, not on-site measurements.','Geluid, bodem en grondwater beschrijven het steekproefpunt. Helling gebruikt het hele gevonden perceel op oorspronkelijke rasterresolutie. Modellen, geen metingen ter plaatse.','Lärm, Boden und Grundwasser beschreiben den Prüfpunkt. Die Hangneigung nutzt das ganze aufgelöste Grundstück in ursprünglicher Rasterauflösung. Modelle, keine Messungen vor Ort.'))}</p>${evidence?screen.render(evidence,document.documentElement.lang):''}<div role="status" aria-live="polite" class="${selected.environmentLoading?'pv-loading':selected.environmentError?'pv-feedback-warning':''}">${selected.environmentLoading?esc(tr('Checking official environmental sources…','Officiële omgevingsbronnen controleren…','Amtliche Umweltquellen werden geprüft…')):selected.environmentError?esc(tr('Checks incomplete. Please retry.','Controles onvolledig. Probeer opnieuw.','Prüfungen unvollständig. Bitte erneut versuchen.')):''}</div><button type="button" class="pv-button" aria-busy="${!!selected.environmentLoading}" ${selected.environmentLoading?'disabled':''}>${esc(evidence?tr('Refresh environmental checks','Omgevingscontrole vernieuwen','Umweltprüfung aktualisieren'):tr('Check environmental data','Omgevingsgegevens controleren','Umweltdaten prüfen'))}</button>`;
    section.querySelector('button').onclick=()=>load(selected);target.append(section);
  }
  async function load(selected){
    if(selected.environmentLoading)return;selected.environmentLoading=true;selected.environmentError=false;show(selected);
    try{
      const parcelEvidence=await window.PlanViewParcelScreen.inspect(selected.point,{criteria:{},signal:selected.signal});
      const evidence=await screen.inspect(selected.point,{criteria:{maxNoiseDb:140,maxSlopeDeg:90,soilClasses:['all'],minGroundwaterDepthCm:0},parcelEvidence,signal:selected.signal});
      if(state.selected!==selected)return;selected.environmentEvidence=evidence;const previous=selected.parcelScreenEvidence||selected.point.searchEvidence?.parcelEvidence,oldParcel=previous?.parcel,newParcel=parcelEvidence?.parcel;const sameParcel=oldParcel?.complete&&newParcel?.complete&&oldParcel.id&&oldParcel.id===newParcel.id&&JSON.stringify(oldParcel.geometry)===JSON.stringify(newParcel.geometry);selected.parcelScreenEvidence=sameParcel?{...previous,parcel:newParcel}:parcelEvidence;
    }catch(error){if(error?.name!=='AbortError')selected.environmentError=true;}
    finally{selected.environmentLoading=false;show(selected);window.dispatchEvent(new CustomEvent('planview-environment-updated',{detail:{selected}}));}
  }
  const previous=renderDetails;renderDetails=function(){previous();if(state.selected)show(state.selected);};
  window.PlanViewEnvironmentInsights={show,load};
})();
