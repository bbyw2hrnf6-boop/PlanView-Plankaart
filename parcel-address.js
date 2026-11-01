/* Addresses in the selected cadastral polygon, independent of the active inspector tab. */
(() => {
  'use strict';
  const endpoint='https://api.pdok.nl/bzk/locatieserver/search/v3_1/reverse';
  const tr=(en,nl,de)=>({nl,de}[document.documentElement.lang]||en);
  function addressesInParcel(docs,geometry){
    const seen=new Set();
    return docs.filter(doc=>{
      if(doc.type!=='adres'||!doc.straatnaam||doc.huisnummer==null)return false;
      const point=parseWkt(doc.geometrie_ll||doc.centroide_ll);
      if(!point||!geometryContains(geometry,point))return false;
      const key=[doc.straatnaam,doc.huisnummer,doc.huisletter||'',doc.huisnummertoevoeging||'',doc.woonplaatsnaam||''].join('|');
      if(seen.has(key))return false;seen.add(key);return true;
    }).map(doc=>({
      street:`${doc.straatnaam} ${doc.huisnummer}${doc.huisletter||''}${doc.huisnummertoevoeging?'-'+doc.huisnummertoevoeging:''}`,
      place:doc.woonplaatsnaam||''
    }));
  }
  function show(selected){
    if(state.selected!==selected)return;
    const top=document.querySelector('#detail-content .detail-top');if(!top)return;
    top.querySelector('.pv-parcel-address')?.remove();
    const evidence=selected.parcelAddresses;
    if(!evidence?.addresses.length||selected.point.address)return;
    const block=document.createElement('div');block.className='pv-parcel-address';
    const label=document.createElement('span');label.className='pv-parcel-address-label';
    label.textContent=tr('Address in this parcel','Adres binnen dit perceel','Adresse im Grundstück');
    const addresses=evidence.addresses;
    if(addresses.length===1){
      const address=document.createElement('strong');address.textContent=[addresses[0].street,addresses[0].place].filter(Boolean).join(', ');block.append(label,address);
    }else{
      label.textContent=tr('Addresses in this parcel','Adressen binnen dit perceel','Adressen im Grundstück');block.append(label);
      const details=document.createElement('details'),summary=document.createElement('summary');
      summary.textContent=addresses.slice(0,2).map(a=>a.street).join(' · ')+(addresses.length>2?tr(` · +${addresses.length-2} more`,` · +${addresses.length-2} meer`,` · +${addresses.length-2} weitere`):'');
      const list=document.createElement('ul');for(const a of addresses){const item=document.createElement('li');item.textContent=[a.street,a.place].filter(Boolean).join(', ');list.append(item);}
      details.append(summary,list);block.append(details);
    }
    if(evidence.limited){const note=document.createElement('small');note.textContent=tr('PDOK · address list may be incomplete','PDOK · adreslijst mogelijk onvolledig','PDOK · Adressliste möglicherweise unvollständig');block.append(note);}
    const title=top.querySelector('.detail-title-row');if(title)title.insertAdjacentElement('afterend',block);else top.append(block);
  }
  async function load(selected){
    const geometry=selected.parcel?.geometry?geoToLatLng(selected.parcel)?.geometry:null;
    if(!geometry||selected.point.address)return;
    const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,10000);
    selected.signal?.addEventListener('abort',abort,{once:true});
    try{
      if(selected.signal?.aborted)return;
      const p=selected.point,response=await fetch(endpoint+'?'+new URLSearchParams({lat:String(p.lat),lon:String(p.lng),type:'adres',rows:'30',fl:'*'}),{signal:controller.signal});
      if(!response.ok)throw new Error('Address source unavailable');
      const data=await response.json(),docs=data.response?.docs||[];
      if(controller.signal.aborted||state.selected!==selected)return;
      selected.parcelAddresses={addresses:addressesInParcel(docs,geometry),limited:docs.length>=30};show(selected);
    }catch{/* Keep the point label when no verified address is available. */}
    finally{clearTimeout(timer);selected.signal?.removeEventListener('abort',abort);}
  }
  const previousRender=renderDetails;
  renderDetails=function(){
    previousRender();const selected=state.selected;if(!selected)return;show(selected);
    if(!selected.parcelAddressesStarted){selected.parcelAddressesStarted=true;load(selected);}
  };
})();
