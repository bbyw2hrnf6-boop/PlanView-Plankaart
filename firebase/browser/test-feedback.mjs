// Firebase-only tester feedback. Deliberate text submission; no automatic context capture.
const categories=['uncategorized','interface','search','rules','permits','map','idea','other'];
const copy={
 button:['Feedback','Feedback','Feedback'],title:['Share feedback','Feedback delen','Feedback geben'],
 intro:['What worked well? What could be better? A short note is enough.','Wat werkte goed? Wat kan beter? Een korte opmerking is genoeg.','Was lief gut? Was könnte besser sein? Eine kurze Notiz reicht.'],
 text:['Your feedback','Je feedback','Dein Feedback'],placeholder:['An idea, something missing, or a feature that did not work as expected…','Een idee, iets dat ontbreekt, of een functie die anders werkte dan verwacht…','Eine Idee, etwas Fehlendes oder eine Funktion, die anders lief als erwartet…'],
 category:['Category (optional)','Categorie (optioneel)','Kategorie (optional)'],
 uncategorized:['No category','Geen categorie','Ohne Kategorie'],interface:['Interface','Interface','Oberfläche'],search:['Search','Zoeken','Suche'],rules:['Rules','Regels','Regeln'],permits:['Permit history','Vergunningenhistorie','Bauanträge'],map:['Map','Kaart','Karte'],idea:['Idea / improvement','Idee / verbetering','Idee / Verbesserung'],other:['Other','Overig','Sonstiges'],
 privacy:['Visible to the Planview owner. No page or location details are added automatically. This does not use your AI allowance.','Zichtbaar voor de eigenaar van Planview. Pagina- of locatiegegevens worden niet automatisch toegevoegd. Dit gebruikt geen AI-tegoed.','Sichtbar für den Planview-Besitzer. Seiten- oder Standortdaten werden nicht automatisch ergänzt. Verbraucht kein KI-Kontingent.'],
 send:['Send feedback','Feedback versturen','Feedback senden'],sending:['Sending…','Versturen…','Wird gesendet…'],close:['Close','Sluiten','Schließen'],
 required:['Please write a short note first.','Schrijf eerst een korte opmerking.','Bitte zuerst eine kurze Notiz schreiben.'],long:['Please keep your feedback within 3,000 characters.','Beperk je feedback tot 3.000 tekens.','Bitte auf höchstens 3.000 Zeichen kürzen.'],
 auth:['Please sign in again before sending. Your note is still here.','Meld je opnieuw aan voordat je verstuurt. Je opmerking blijft hier staan.','Bitte vor dem Senden erneut anmelden. Deine Notiz bleibt hier erhalten.'],
 invalid:['Please check your note and try again. Your note is still here.','Controleer je opmerking en probeer opnieuw. Je opmerking blijft hier staan.','Bitte die Notiz prüfen und erneut versuchen. Deine Notiz bleibt erhalten.'],
 rate:['A few notes were sent recently. Please try again in a little while. Your note is still here.','Er zijn onlangs meerdere opmerkingen verstuurd. Probeer het straks opnieuw. Je opmerking blijft hier staan.','Gerade wurden mehrere Notizen gesendet. Bitte etwas später erneut versuchen. Deine Notiz bleibt erhalten.'],
 error:['Could not confirm delivery. Please try again; the same note will not be saved twice. Your draft is still here.','De verzending kon niet worden bevestigd. Probeer opnieuw; dezelfde opmerking wordt niet dubbel opgeslagen. Je concept blijft hier staan.','Versand konnte nicht bestätigt werden. Bitte erneut versuchen; dieselbe Notiz wird nicht doppelt gespeichert. Dein Entwurf bleibt erhalten.'],
 thanks:['Thank you — your feedback is saved.','Bedankt — je feedback is opgeslagen.','Danke — dein Feedback ist gespeichert.'],
 thanksDetail:['The Planview owner can now read it in Settings.','De eigenaar van Planview kan het nu lezen in Instellingen.','Der Planview-Besitzer kann es jetzt in den Einstellungen lesen.'],
 another:['Write another note','Nog een opmerking schrijven','Weitere Notiz schreiben'],count:['{count} / 3,000 characters','{count} / 3.000 tekens','{count} / 3.000 Zeichen'],
};
const styles=`
 #pv-firebase-feedback{position:relative;display:flex;align-items:center;flex:none}
 #pv-firebase-feedback-button{display:inline-flex;align-items:center;justify-content:center;gap:7px;font:650 12px system-ui;min-height:40px;padding:8px 13px;border:1px solid #7d58c2;border-radius:12px;background:linear-gradient(135deg,#8b5bd1,#6b42ad);color:#fff;box-shadow:0 3px 10px #7044b526;cursor:pointer;white-space:nowrap;transform-origin:center;animation:pv-feedback-hello 850ms ease-out 500ms 1;transition:background 150ms,box-shadow 150ms,transform 150ms}
 #pv-firebase-feedback-button:hover{background:linear-gradient(135deg,#9564da,#7045b5);box-shadow:0 4px 14px #7044b53d;transform:translateY(-1px)}
 #pv-firebase-feedback-button:hover .pv-feedback-icon,#pv-firebase-feedback-button:focus-visible .pv-feedback-icon{animation:pv-feedback-wave 550ms ease-out 1}
 #pv-firebase-feedback-button[aria-expanded=true]{background:#61389f;box-shadow:0 0 0 3px #aa87e128}
 #pv-firebase-feedback-button .pv-feedback-icon{position:relative;display:inline-flex;align-items:center;justify-content:center;width:18px;height:14px;border:1.5px solid currentColor;border-radius:4px;font-size:14px;line-height:1;letter-spacing:0}
 #pv-firebase-feedback-button .pv-feedback-icon::after{content:'';position:absolute;left:3px;bottom:-4px;width:4px;height:4px;border-left:1.5px solid currentColor;transform:skewY(-35deg)}
 #pv-firebase-feedback-dialog{box-sizing:border-box;position:absolute;inset:auto 0 auto auto;top:calc(100% + 12px);margin:0;width:min(380px,calc(100vw - 24px));max-height:var(--pv-feedback-max-height,calc(100dvh - 100px));overflow:auto;padding:21px;border:1px solid #d9cce9;border-radius:18px;background:var(--surface,#fff);color:var(--text,#253b3c);box-shadow:0 15px 45px #24324029,0 3px 10px #7044b512;font:14px system-ui;line-height:1.5;z-index:2200}
 #pv-firebase-feedback-dialog[open]{animation:pv-feedback-enter 190ms cubic-bezier(.2,.8,.2,1) both}
 #pv-firebase-feedback-dialog:not([open]){display:none}
 #pv-firebase-feedback-dialog h2{font:750 20px system-ui;letter-spacing:-.45px;margin:0;padding-right:32px}
 #pv-firebase-feedback-dialog p{margin:9px 0;font-size:12px;color:var(--muted,#586f75)}
 #pv-firebase-feedback-dialog .pv-feedback-close{position:absolute;top:12px;right:12px;padding:4px;width:32px;min-height:32px;font-size:22px;line-height:1;border-color:transparent;background:transparent;color:var(--muted,#586f75)}
 #pv-firebase-feedback-dialog form{display:grid;gap:12px;margin-top:17px}
 #pv-firebase-feedback-dialog label{display:grid;gap:6px;font-size:12px;font-weight:600}
 #pv-firebase-feedback-dialog textarea,#pv-firebase-feedback-dialog select{box-sizing:border-box;display:block;width:100%;font:14px system-ui;line-height:1.5;color:var(--text,#253b3c);background:var(--surface,#fff);border:1px solid var(--line2,#c9d8d3);border-radius:10px;padding:10px 11px}
 #pv-firebase-feedback-dialog textarea{min-height:112px;max-height:240px;resize:vertical}
 #pv-firebase-feedback-dialog textarea::placeholder{color:var(--muted,#586f75);opacity:1}
 #pv-firebase-feedback-dialog .pv-feedback-count{display:block;text-align:right;font-size:10px;font-weight:400;color:var(--muted,#586f75)}
 #pv-firebase-feedback-dialog .pv-feedback-privacy{font-size:10px;margin:0;line-height:1.55}
 #pv-firebase-feedback-dialog button{font:650 12px system-ui;min-height:40px;cursor:pointer;border:1px solid var(--line2,#c9d8d3);border-radius:10px;padding:9px 14px;background:var(--surface2,#f4f7f6);color:var(--text,#253b3c)}
 #pv-firebase-feedback-dialog button.pv-feedback-send{background:#7448b9;border-color:#7448b9;color:#fff}
 #pv-firebase-feedback-dialog button.pv-feedback-send:hover{background:#663ca9}
 #pv-firebase-feedback-dialog button:disabled{opacity:.55;cursor:wait}
 #pv-firebase-feedback-dialog .pv-feedback-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
 #pv-firebase-feedback-dialog .pv-feedback-status{margin:0;font-size:12px;color:var(--text,#253b3c)}
 #pv-firebase-feedback-dialog .pv-feedback-status:empty{display:none}
 #pv-firebase-feedback-dialog .pv-feedback-success{padding:18px 0 2px;text-align:center}
 #pv-firebase-feedback-dialog .pv-feedback-success-symbol{display:grid;place-items:center;width:44px;height:44px;margin:0 auto 12px;border-radius:50%;background:#eee7f8;color:#7448b9;font:700 24px system-ui}
 #pv-firebase-feedback-dialog .pv-feedback-success .pv-feedback-actions{justify-content:center;margin-top:15px}
 #pv-firebase-feedback-dialog [hidden]{display:none!important}
 #pv-firebase-feedback .pv-feedback-announcement{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;clip-path:inset(50%)}
 #pv-firebase-feedback-button:focus-visible,#pv-firebase-feedback-dialog button:focus-visible,#pv-firebase-feedback-dialog textarea:focus-visible,#pv-firebase-feedback-dialog select:focus-visible{outline:3px solid #bda7df;outline-offset:3px}
 @keyframes pv-feedback-hello{0%,100%{transform:rotate(0)}25%{transform:rotate(-4deg)}45%{transform:rotate(4deg)}65%{transform:rotate(-2deg)}85%{transform:rotate(1deg)}}
 @keyframes pv-feedback-wave{0%,100%{transform:rotate(0)}30%{transform:rotate(-13deg)}65%{transform:rotate(10deg)}}
 @keyframes pv-feedback-enter{from{opacity:0;transform:translateY(-9px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
 @media(max-width:760px){#pv-firebase-feedback-dialog{position:fixed;top:var(--pv-feedback-top,90px);right:12px;left:auto;padding:19px}#pv-firebase-feedback-button{min-height:38px;padding:7px 11px}}
 @media(max-height:600px){#pv-firebase-feedback-dialog textarea{min-height:80px;max-height:120px}#pv-firebase-feedback-dialog form{gap:8px}#pv-firebase-feedback-dialog .pv-feedback-privacy{font-size:10px}}
 @media(prefers-reduced-motion:reduce){#pv-firebase-feedback-button,#pv-firebase-feedback-button .pv-feedback-icon,#pv-firebase-feedback-dialog{animation:none!important;transition:none!important;scroll-behavior:auto}#pv-firebase-feedback-button:hover{transform:none}}
`;
function label(doc,key){return copy[key][{nl:1,de:2}[doc.documentElement.lang]||0];}
function submissionId(win){
 const crypto=win.crypto||globalThis.crypto;
 if(crypto?.randomUUID)return crypto.randomUUID();
 if(!crypto?.getRandomValues)throw new Error('Secure random identifier unavailable');
 const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 return [...bytes].map((byte,index)=>([4,6,8,10].includes(index)?'-':'')+byte.toString(16).padStart(2,'0')).join('');
}
/** Mount in the account header. Owns no account, quota or settings controls. */
export function mountTestFeedback({container,window:win=globalThis.window,document:doc=globalThis.document}={}){
 if(win.__planviewTestFeedback)return win.__planviewTestFeedback;
 if(!container)throw new Error('Feedback requires an account header slot');
 const el=tag=>doc.createElement(tag),style=el('style'),host=el('div'),button=el('button'),icon=el('span'),caption=el('span'),dialog=el('dialog'),announcement=el('span');
 style.textContent=styles;doc.head.append(style);host.id='pv-firebase-feedback';button.id='pv-firebase-feedback-button';button.type='button';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','pv-firebase-feedback-dialog');button.setAttribute('aria-expanded','false');
 icon.className='pv-feedback-icon';icon.textContent='···';icon.setAttribute('aria-hidden','true');caption.className='pv-feedback-button-label';button.append(icon,caption);
 announcement.className='pv-feedback-announcement';announcement.setAttribute('role','status');announcement.setAttribute('aria-live','polite');announcement.setAttribute('aria-atomic','true');
 host.append(button,announcement,dialog);container.append(host);
 dialog.id='pv-firebase-feedback-dialog';dialog.setAttribute('aria-labelledby','pv-firebase-feedback-title');dialog.setAttribute('aria-describedby','pv-firebase-feedback-intro');dialog.setAttribute('aria-modal','false');
 const title=el('h2'),intro=el('p'),closeIcon=el('button'),form=el('form'),textLabel=el('label'),textCaption=el('span'),textarea=el('textarea'),count=el('span'),categoryLabel=el('label'),categoryCaption=el('span'),select=el('select'),privacy=el('p'),status=el('p'),actions=el('div'),closeButton=el('button'),send=el('button'),success=el('div'),check=el('span'),thanks=el('p'),thanksDetail=el('p'),successActions=el('div'),another=el('button'),done=el('button');
 title.id='pv-firebase-feedback-title';intro.id='pv-firebase-feedback-intro';closeIcon.className='pv-feedback-close';closeIcon.textContent='×';closeIcon.type='button';
 textarea.id='pv-firebase-feedback-text';textarea.name='text';textarea.required=true;textarea.maxLength=3000;textarea.rows=4;textarea.setAttribute('aria-describedby','pv-firebase-feedback-count pv-firebase-feedback-privacy');count.id='pv-firebase-feedback-count';count.className='pv-feedback-count';textLabel.append(textCaption,textarea,count);
 select.id='pv-firebase-feedback-category';select.name='category';for(const value of categories){const option=el('option');option.value=value;select.append(option);}select.value='uncategorized';categoryLabel.append(categoryCaption,select);
 privacy.id='pv-firebase-feedback-privacy';privacy.className='pv-feedback-privacy';status.className='pv-feedback-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
 actions.className=successActions.className='pv-feedback-actions';closeButton.type='button';send.type='submit';send.className='pv-feedback-send';actions.append(closeButton,send);form.noValidate=true;form.append(textLabel,categoryLabel,privacy,status,actions);
 success.className='pv-feedback-success';check.className='pv-feedback-success-symbol';check.textContent='✓';check.setAttribute('aria-hidden','true');another.type='button';done.type='button';done.className='pv-feedback-send';successActions.append(another,done);success.append(check,thanks,thanksDetail,successActions);dialog.append(title,intro,closeIcon,form,success);
 let busy=false,delivered=false,errorKey='',pending=null,destroyed=false,focusBefore=null,closeTimer=null;
 function cancelClose(){if(closeTimer!==null){win.clearTimeout(closeTimer);closeTimer=null;}}
 function draw(){
  if(destroyed)return;
  caption.textContent=label(doc,'button');title.textContent=label(doc,'title');intro.textContent=label(doc,'intro');textCaption.textContent=label(doc,'text');textarea.placeholder=label(doc,'placeholder');categoryCaption.textContent=label(doc,'category');
  for(const option of select.children)option.textContent=label(doc,option.value);
  privacy.textContent=label(doc,'privacy');count.textContent=label(doc,'count').replace('{count}',textarea.value.length);closeIcon.setAttribute('aria-label',label(doc,'close'));closeButton.textContent=done.textContent=label(doc,'close');send.textContent=label(doc,busy?'sending':'send');
  textarea.disabled=select.disabled=send.disabled=busy;form.setAttribute('aria-busy',String(busy));textarea.setAttribute('aria-invalid',String(['required','long','invalid'].includes(errorKey)));status.textContent=errorKey?label(doc,errorKey):'';
  form.hidden=delivered;intro.hidden=delivered;success.hidden=!delivered;thanks.textContent=label(doc,'thanks');thanksDetail.textContent=label(doc,'thanksDetail');another.textContent=label(doc,'another');if(delivered)announcement.textContent=label(doc,'thanks');
 }
 function close({restoreFocus=true}={}){cancelClose();const wasOpen=dialog.open;if(wasOpen)dialog.close();button.setAttribute('aria-expanded','false');if(wasOpen&&!destroyed&&restoreFocus)(focusBefore?.isConnected===false?button:focusBefore||button).focus();}
 function position(){
  if(!dialog.open)return;const viewport=win.visualViewport,viewportTop=viewport?.offsetTop||0,viewportBottom=viewportTop+(viewport?.height||win.innerHeight||doc.documentElement.clientHeight);
  const top=Math.max(viewportTop+8,Math.min(button.getBoundingClientRect().bottom+12,viewportBottom-140));
  dialog.style.setProperty('--pv-feedback-top',`${top}px`);dialog.style.setProperty('--pv-feedback-max-height',`${Math.max(0,viewportBottom-top-12)}px`);
 }
 function open(){if(destroyed||dialog.open)return;cancelClose();if(delivered){delivered=false;errorKey='';}focusBefore=doc.activeElement;draw();dialog.show();button.setAttribute('aria-expanded','true');position();textarea.focus();}
 function changed(){if(busy)return;pending=null;errorKey='';draw();}
 async function submit(event){
  event.preventDefault();if(busy||delivered||destroyed)return;
  const text=textarea.value.trim();if(!text){errorKey='required';draw();textarea.focus();return;}
  if(textarea.value.length>3000){errorKey='long';draw();textarea.focus();return;}
  busy=true;errorKey='';announcement.textContent='';draw();
  try{
   if(!pending)pending={text,category:categories.includes(select.value)?select.value:'uncategorized',submissionId:submissionId(win)};
   const response=await win.fetch('/api/feedback',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(pending),signal:(win.AbortSignal||globalThis.AbortSignal).timeout(20_000)});
   if(!response.ok){errorKey=response.status===401||response.status===403?'auth':response.status===400?'invalid':response.status===429?'rate':'error';return;}
   const result=await response.json();if(result?.ok!==true||typeof result.id!=='string'||!result.id)throw new Error('Feedback not confirmed');
   if(destroyed)return;delivered=true;pending=null;textarea.value='';select.value='uncategorized';
  }catch{if(!destroyed)errorKey='error';}
  finally{busy=false;if(!destroyed){draw();if(delivered&&dialog.open){if(dialog.contains(doc.activeElement))done.focus();closeTimer=win.setTimeout(()=>{closeTimer=null;close({restoreFocus:dialog.contains(doc.activeElement)});},1200);}}}
 }
 function keyboard(event){if(dialog.open&&event.key==='Escape'){event.preventDefault();close({restoreFocus:host.contains(doc.activeElement)});}}
 function outside(event){if(dialog.open&&!host.contains(event.target))close({restoreFocus:false});}
 function nextNote(){cancelClose();delivered=false;errorKey='';draw();textarea.focus();}
 button.addEventListener('click',()=>dialog.open?close():open());form.addEventListener('submit',submit);textarea.addEventListener('input',changed);select.addEventListener('change',changed);
 for(const node of [closeIcon,closeButton,done])node.addEventListener('click',close);
 another.addEventListener('click',nextNote);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 doc.addEventListener('pointerdown',outside);doc.addEventListener('keydown',keyboard);win.addEventListener('planview-language-change',draw);win.addEventListener('resize',position);win.visualViewport?.addEventListener('resize',position);win.visualViewport?.addEventListener('scroll',position);
 const api={button,dialog,open,close,destroy(){if(destroyed)return;cancelClose();if(dialog.open)dialog.close();destroyed=true;doc.removeEventListener('pointerdown',outside);doc.removeEventListener('keydown',keyboard);win.removeEventListener('planview-language-change',draw);win.removeEventListener('resize',position);win.visualViewport?.removeEventListener('resize',position);win.visualViewport?.removeEventListener('scroll',position);host.remove();style.remove();if(win.__planviewTestFeedback===api)delete win.__planviewTestFeedback;}};
 win.__planviewTestFeedback=api;draw();return api;
}
