/* Shared runtime metadata; no keys or user data are sent to the cloud. */
(() => {
  const isLocal=['localhost','127.0.0.1','[::1]','::1'].includes(location.hostname);
  const cloudUrl='https://planview-maastricht-spatial.dannhir.chatgpt.site';
  window.planviewRuntime={isLocal,cloudUrl,release:null};
  const tr=(en,nl,de)=>({nl,de}[document.documentElement.lang]||en);
  function render(){
    let footer=document.getElementById('planview-hosting-status');
    if(!footer){footer=document.createElement('p');footer.id='planview-hosting-status';footer.dataset.pvManaged='';footer.className='section-help';document.getElementById('services-form')?.append(footer);}
    footer.replaceChildren();
    const release=window.planviewRuntime.release;
    footer.append(document.createTextNode(`${isLocal?tr('Local','Lokaal','Lokal'):tr('Web version','Webversie','Webversion')} · ${release?.version||tr('Version unavailable','Versie niet beschikbaar','Version nicht verfügbar')} · `));
    const link=document.createElement('a');link.href=cloudUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent=tr('Open web version','Webversie openen','Webversion öffnen');footer.append(link);
    if(!isLocal)footer.append(document.createTextNode(tr(' · Saved cases and appearance stay in this browser; service keys are encrypted for your web account.',' · Dossiers en weergave blijven in deze browser; servicesleutels zijn versleuteld in je webaccount.',' · Fälle und Darstellung bleiben in diesem Browser; Dienstschlüssel sind im Webkonto verschlüsselt.')));
  }
  window.addEventListener('planview-language-change',render);
  window.addEventListener('load',async()=>{try{const response=await fetch('./release.json',{cache:'no-store'});if(response.ok)window.planviewRuntime.release=await response.json();}catch{}render();});
})();
