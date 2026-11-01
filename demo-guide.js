/* Offline documentation is adjacent to the app, never a background API client. */
(() => {
  function mount(){
  const toolbar=document.getElementById('pv-toolbar');if(!toolbar||toolbar.querySelector('.pv-demo-link'))return false;
  const link=document.createElement('a');link.className='pv-demo-link';link.href='./briefing.html';link.target='_blank';link.rel='noopener';
  function render(){const lang=document.documentElement.lang;link.textContent=lang==='de'?'Demo & Hilfe ↗':lang==='nl'?'Demo & uitleg ↗':'Demo & guide ↗';link.setAttribute('aria-label',lang==='de'?'Demo-Briefing und Funktionsübersicht öffnen':lang==='nl'?'Demo en functieoverzicht openen':'Open demo briefing and feature guide');}
  toolbar.append(link);render();window.addEventListener('planview-language-change',render);return true;
  }
  if(!mount()){const observer=new MutationObserver(()=>{if(mount())observer.disconnect();});observer.observe(document.querySelector('.workspace'),{childList:true,subtree:true});}
})();
