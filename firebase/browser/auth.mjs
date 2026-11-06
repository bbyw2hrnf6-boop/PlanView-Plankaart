import {authenticatedFetch} from './transport.mjs';
import {TEST_USER_NAME,TEST_USER_EMAIL} from '../functions/login-policy.mjs';
import {mountAdminMonitoring} from './admin-monitor.mjs';
import {mountWeeklyQuota} from './weekly-quota.mjs';
import {mountTestFeedback} from './test-feedback.mjs';
import {mountSearchFeedback} from './search-feedback.mjs';
import {mountAdminFeedback} from './admin-feedback.mjs';
import {mountAccountHeader} from './account-header.mjs';
import {initializeApp} from 'firebase/app';
import {getAuth,GoogleAuthProvider,signInWithPopup,signInWithEmailAndPassword,onAuthStateChanged,signOut} from 'firebase/auth';
const originalFetch=window.fetch.bind(window);
let apiBase,auth,resolveReady,weeklyQuota,testFeedback,searchFeedback,accountHeader;
const ready=new Promise(resolve=>{resolveReady=resolve;});
window.fetch=authenticatedFetch(originalFetch,{ready,user:()=>auth?.currentUser,apiBase:()=>apiBase,origin:location.origin,onResponse:(response,request)=>{weeklyQuota?.onResponse(response,request);}});
function mount() {
  const style=document.createElement('style');style.textContent=`
    #pv-firebase-gate{position:fixed;inset:0;background:#f7f5ef;z-index:99999;display:grid;place-items:center;padding:24px;color:#253b3c;font:16px system-ui;overflow:auto}
    #pv-firebase-gate[hidden]{display:none}
    #pv-firebase-gate section{box-sizing:border-box;width:min(100%,440px);background:white;border:1px solid #d7ded9;border-radius:16px;padding:32px;box-shadow:0 12px 40px #253b3c0b}
    #pv-firebase-gate h1{margin:0 0 12px;font-size:30px}
    #pv-firebase-gate h2{font-size:18px;margin:0 0 16px}
    #pv-firebase-gate p{line-height:1.5}
    #pv-firebase-gate button{font:inherit;cursor:pointer;border:0;border-radius:8px;padding:12px 16px;background:#18796e;color:white}
    #pv-firebase-gate button{width:100%}
    #pv-firebase-gate button:disabled{opacity:.6;cursor:wait}
    #pv-firebase-gate form{border-top:1px solid #d7ded9;margin-top:24px;padding-top:24px}
    #pv-firebase-gate label{display:block;font-size:14px;font-weight:600;margin:12px 0 6px}
    #pv-firebase-gate input{box-sizing:border-box;display:block;width:100%;padding:12px;border:1px solid #aebbb5;border-radius:8px;font:inherit;background:#fff;color:#253b3c}
    #pv-firebase-gate input:focus-visible,#pv-firebase-gate button:focus-visible{outline:3px solid #8ed0c6;outline-offset:3px}
    #pv-firebase-gate form button{margin-top:16px}
    #pv-firebase-error{color:#9f3025;line-height:1.5;min-height:1.5em;margin-bottom:0}
  `;document.head.append(style);
  const gate=document.createElement('div');gate.id='pv-firebase-gate';gate.setAttribute('role','dialog');gate.setAttribute('aria-modal','true');gate.setAttribute('aria-labelledby','pv-firebase-title');
  gate.innerHTML=`<section><h1 id="pv-firebase-title">Planview</h1>
    <p>Mit deinem freigeschalteten Konto anmelden.<br>Sign in · Aanmelden</p>
    <button type="button" id="pv-google-login">Mit Google anmelden</button>
    <form id="pv-test-login" aria-labelledby="pv-test-title">
      <h2 id="pv-test-title">Testzugang · Test account</h2>
      <label for="pv-test-username">Benutzername · Username</label>
      <input id="pv-test-username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${TEST_USER_NAME}">
      <label for="pv-test-password">Passwort · Password · Wachtwoord</label>
      <input id="pv-test-password" type="password" name="password" autocomplete="current-password" required>
      <button type="submit">Mit Testkonto anmelden</button>
    </form><p id="pv-firebase-error" role="status" aria-live="polite"></p></section>`;
  document.body.append(gate);return {gate,button:gate.querySelector('#pv-google-login'),form:gate.querySelector('form'),username:gate.querySelector('#pv-test-username'),password:gate.querySelector('#pv-test-password'),testButton:gate.querySelector('[type="submit"]'),error:gate.querySelector('[role="status"]')};
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
    ui.form.addEventListener('submit',async event=>{
      event.preventDefault();ui.testButton.disabled=true;ui.error.textContent='';
      try {
        if(ui.username.value.trim().toLowerCase()!==TEST_USER_NAME.toLowerCase())throw Error();
        await signInWithEmailAndPassword(auth,TEST_USER_EMAIL,ui.password.value);
      }catch{ui.error.textContent='Test-Anmeldung fehlgeschlagen. Benutzername und Passwort prüfen.';}
      finally{ui.password.value='';ui.testButton.disabled=false;}
    });
    let first=true;
    onAuthStateChanged(auth,async user=>{
      resolveReady();
      if(!user){searchFeedback?.destroy();searchFeedback=null;testFeedback?.destroy();testFeedback=null;weeklyQuota?.destroy();weeklyQuota=null;accountHeader?.destroy();accountHeader=null;ui.gate.hidden=false;first=false;return;}
      try {
        const response=await window.fetch('/api/status');
        if(!response.ok){ui.gate.hidden=false;ui.error.textContent=response.status===403?'Dieses Konto ist noch nicht freigeschaltet.':'Backend noch nicht bereit. Firebase-Einrichtung prüfen.';return;}
        const status=await response.json();
        if(!first){location.reload();return;}
        const isAdmin=status.credentialScope==='shared'&&status.canManageKeys===true;
        accountHeader=mountAccountHeader({user:{name:user.email===TEST_USER_EMAIL?TEST_USER_NAME:user.displayName||user.email||'Planview user',email:user.email===TEST_USER_EMAIL?'':user.email||''},isAdmin,onSignOut:async()=>{await signOut(auth);location.reload();}});
        ui.gate.hidden=true;
        if(isAdmin){mountAdminMonitoring();mountAdminFeedback();}
        else if(user.email===TEST_USER_EMAIL){weeklyQuota=mountWeeklyQuota({container:accountHeader.quotaSlot});testFeedback=mountTestFeedback({container:accountHeader.feedbackSlot});searchFeedback=mountSearchFeedback();}
      }catch{ui.error.textContent='Server nicht erreichbar. Bitte erneut versuchen.';}
      first=false;
    });
  }catch{resolveReady();ui.button.disabled=true;ui.testButton.disabled=true;ui.error.textContent='Firebase noch nicht vollständig eingerichtet. Web-App registrieren und Hosting/Functions gemeinsam veröffentlichen.';}
}
boot();
