import {authenticatedFetch} from './transport.mjs';
import {initializeApp} from 'firebase/app';
import {getAuth,GoogleAuthProvider,signInWithPopup,onAuthStateChanged,signOut} from 'firebase/auth';
const originalFetch=window.fetch.bind(window);
let apiBase,auth,resolveReady;
const ready=new Promise(resolve=>{resolveReady=resolve;});
window.fetch=authenticatedFetch(originalFetch,{ready,user:()=>auth?.currentUser,apiBase:()=>apiBase,origin:location.origin});
function mount() {
  const style=document.createElement('style');style.textContent='#pv-firebase-gate{position:fixed;inset:0;background:#f7f5ef;z-index:99999;display:grid;place-items:center;padding:24px;color:#253b3c;font:16px system-ui}#pv-firebase-gate[hidden]{display:none}#pv-firebase-gate section{max-width:420px;background:white;border:1px solid #d7ded9;border-radius:16px;padding:32px}#pv-firebase-gate button,#pv-firebase-account{font:inherit;cursor:pointer;border:0;border-radius:8px;padding:12px 16px;background:#18796e;color:white}#pv-firebase-account{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:1500;font:12px system-ui;padding:8px 12px}#pv-firebase-error{color:#9f3025;line-height:1.5}';document.head.append(style);
  const gate=document.createElement('div');gate.id='pv-firebase-gate';gate.setAttribute('role','dialog');gate.setAttribute('aria-modal','true');gate.setAttribute('aria-labelledby','pv-firebase-title');
  gate.innerHTML='<section><h1 id="pv-firebase-title">Planview</h1><p>Mit deinem freigeschalteten Google-Konto anmelden.</p><p>Sign in with your approved Google account.<br>Meld je aan met je toegelaten Google-account.</p><button type="button">Mit Google anmelden</button><p id="pv-firebase-error" role="status" aria-live="polite"></p></section>';
  const account=document.createElement('button');account.id='pv-firebase-account';account.hidden=true;account.type='button';account.textContent='Abmelden · Sign out';account.addEventListener('click',async()=>{await signOut(auth);location.reload();});
  document.body.append(gate,account);return {gate,account,button:gate.querySelector('button'),error:gate.querySelector('[role="status"]')};
}
async function boot() {
  if(document.readyState==='loading')await new Promise(r=>document.addEventListener('DOMContentLoaded',r,{once:true}));
  const ui=mount();
  try {
    const runtimeResponse=await originalFetch('/firebase-runtime.json',{cache:'no-store'});if(!runtimeResponse.ok)throw Error();const runtime=await runtimeResponse.json();
    if(!/^https:\/\/europe-west1-[a-z0-9-]+\.cloudfunctions\.net\/planviewApi$/.test(runtime.apiBase))throw Error();apiBase=runtime.apiBase;
    const firebaseResponse=await originalFetch('/__/firebase/init.json');if(!firebaseResponse.ok)throw Error();const firebaseConfig=await firebaseResponse.json();
    if(firebaseConfig.projectId!==runtime.projectId)throw Error();
    auth=getAuth(initializeApp(firebaseConfig));
    ui.button.addEventListener('click',async()=>{ui.button.disabled=true;ui.error.textContent='';try{const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});await signInWithPopup(auth,provider);}catch{ui.error.textContent='Anmeldung fehlgeschlagen. Google-Anmeldung und freigegebene Domain prüfen.';}finally{ui.button.disabled=false;}});
    let first=true;
    onAuthStateChanged(auth,async user=>{
      resolveReady();
      if(!user){ui.gate.hidden=false;ui.account.hidden=true;first=false;return;}
      try {
        const response=await window.fetch('/api/status');
        if(!response.ok){ui.gate.hidden=false;ui.error.textContent=response.status===403?'Dieses Konto ist noch nicht freigeschaltet.':'Backend noch nicht bereit. Firebase-Einrichtung prüfen.';return;}
        if(!first){location.reload();return;}
        ui.gate.hidden=true;ui.account.hidden=false;ui.account.title=user.email||'';
      }catch{ui.error.textContent='Server nicht erreichbar. Bitte erneut versuchen.';}
      first=false;
    });
  }catch{resolveReady();ui.button.disabled=true;ui.error.textContent='Firebase noch nicht vollständig eingerichtet. Web-App registrieren und Hosting/Functions gemeinsam veröffentlichen.';}
}
boot();
