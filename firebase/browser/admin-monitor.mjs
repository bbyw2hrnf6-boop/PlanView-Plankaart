// Firebase-only owner dashboard. Filters never send prompt text or credentials.
const fields=['requests','prompts','providerCalls','errors','durationMs','inputTokens','cachedInputTokens','cacheWriteTokens','outputTokens','reasoningTokens','estimatedCostUsd','unpricedCalls','usageMissingCalls'];
const users=['Admin','TestUser02','Approved user'];
const num=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:0;
const userLabel=value=>users.includes(value)?value:'Approved user';
const tidy=value=>typeof value==='string'?value.slice(0,200):'';
const copy={
 tab:['Monitoring','Monitoring','Monitoring'],
 title:['Usage overview','Gebruiksoverzicht','Nutzungsübersicht'],
 intro:['Keep an eye on your test, without the noise.','Je test volgen, zonder ruis.','Deinen Test im Blick behalten.'],
 refresh:['Refresh','Vernieuwen','Aktualisieren'],csv:['Full usage CSV','Volledig gebruik als CSV','Vollständige Nutzung als CSV'],csvLog:['Export filtered log','Gefilterd logboek exporteren','Gefilterte Tabelle exportieren'],
 period:['Period','Periode','Zeitraum'],days14:['Last 14 days','Laatste 14 dagen','Letzte 14 Tage'],days7:['Last 7 days','Laatste 7 dagen','Letzte 7 Tage'],today:['Today','Vandaag','Heute'],
 user:['User','Gebruiker','Nutzer'],all:['All users','Alle gebruikers','Alle Nutzer'],admin:['Admin','Beheerder','Admin'],test:['TestUser02','TestUser02','TestUser02'],other:['Approved user','Toegelaten gebruiker','Freigegebener Nutzer'],
 loading:['Loading usage…','Gebruik laden…','Nutzung wird geladen…'],error:['Usage could not be loaded. Please try Refresh.','Gebruik kon niet worden geladen. Probeer Vernieuwen.','Nutzung konnte nicht geladen werden. Bitte aktualisieren.'],forbidden:['Monitoring is available only to the administrator.','Monitoring is alleen beschikbaar voor de beheerder.','Monitoring ist nur für den Administrator verfügbar.'],
 stale:['Refresh failed. The previously loaded snapshot remains below.','Vernieuwen mislukt. De eerder geladen momentopname blijft hieronder staan.','Aktualisierung fehlgeschlagen. Der zuvor geladene Stand bleibt unten sichtbar.'],
 ready:['Snapshot','Momentopname','Stand'],
 requests:['API requests','API-aanvragen','API-Anfragen'],prompts:['AI prompts sent','Verzonden AI-prompts','Gesendete KI-Prompts'],cost:['Estimated OpenAI cost','Geschatte OpenAI-kosten','Geschätzte OpenAI-Kosten'],duration:['Average server time','Gemiddelde servertijd','Mittlere Serverzeit'],errors:['Failed requests','Mislukte aanvragen','Fehlgeschlagene Anfragen'],
 promptShort:['OpenAI calls, including retries','OpenAI-oproepen, inclusief herhalingen','OpenAI-Aufrufe, inklusive Wiederholungen'],durationShort:['Across all API requests','Over alle API-aanvragen','Über alle API-Anfragen'],costShort:['Known usage · USD','Bekend gebruik · USD','Bekannte Nutzung · USD'],
 requestNote:['Backend API requests, including connection and status checks. This dashboard is excluded.','Backend-API-aanvragen, inclusief verbindings- en statuscontroles. Dit dashboard is uitgesloten.','Backend-API-Anfragen einschließlich Verbindungs- und Statusprüfungen. Dieses Dashboard ist ausgenommen.'],
 promptNote:['Actual OpenAI calls, including retries. One search can send multiple prompts.','Echte OpenAI-oproepen, inclusief herhalingen. Eén zoekopdracht kan meerdere prompts sturen.','Tatsächliche OpenAI-Aufrufe, inklusive Wiederholungen. Eine Suche kann mehrere Prompts senden.'],
 durationNote:['Server processing, including source retrieval. Excludes transport, authentication and log writes.','Serververwerking, inclusief het ophalen van bronnen. Exclusief transport, authenticatie en logschrijfacties.','Serververarbeitung einschließlich Quellenabruf. Ohne Übertragung, Authentifizierung und Protokollspeicherung.'],
 partial:['Known cost only. Calls without usage or a known price are not included.','Alleen bekende kosten. Oproepen zonder gebruiksgegevens of bekende prijs zijn niet inbegrepen.','Nur bekannte Kosten. Aufrufe ohne Nutzungsdaten oder bekannten Preis sind nicht eingerechnet.'],
 scopeShort:['OpenAI estimate in USD. Firebase and DSO costs are not included.','OpenAI-schatting in USD. Kosten voor Firebase en DSO zijn niet inbegrepen.','OpenAI-Schätzung in USD. Firebase- und DSO-Kosten sind nicht enthalten.'],
 scope:['OpenAI estimate in USD only. Excludes Firebase, Google, DSO, credits, taxes and usage outside Planview. Compare with your provider bill.','Alleen een OpenAI-schatting in USD. Exclusief Firebase, Google, DSO, tegoed, belastingen en gebruik buiten Planview. Vergelijk met je providerfactuur.','Nur OpenAI-Schätzung in USD. Ohne Firebase, Google, DSO, Guthaben, Steuern und Nutzung außerhalb von Planview. Mit der Anbieterabrechnung abgleichen.'],
 privacy:['Metadata only: no prompt text, answers, addresses or API keys are stored in this log.','Alleen metadata: geen prompttekst, antwoorden, adressen of API-sleutels in dit logboek.','Nur Metadaten: keine Prompttexte, Antworten, Adressen oder API-Keys in diesem Protokoll.'],
 start:['Tracking started','Registratie gestart','Erfassung seit'],noStart:['Tracking starts with the first recorded request after deployment. Earlier activity is not imported.','Registratie begint bij de eerste vastgelegde aanvraag na publicatie. Eerder gebruik wordt niet geïmporteerd.','Erfassung beginnt mit der ersten protokollierten Anfrage nach Veröffentlichung. Frühere Nutzung wird nicht übernommen.'],
 noBackfill:['Earlier activity is not imported.','Eerder gebruik wordt niet geïmporteerd.','Frühere Nutzung wird nicht übernommen.'],utc:['UTC calendar days','UTC-kalenderdagen','UTC-Kalendertage'],
 rollups:['Daily & user breakdown','Uitsplitsing per dag en gebruiker','Aufschlüsselung nach Tag und Nutzer'],method:['How these figures are measured','Hoe deze cijfers worden gemeten','So werden die Zahlen erfasst'],
 daily:['Daily activity','Dagelijkse activiteit','Tägliche Nutzung'],breakdown:['By user','Per gebruiker','Nach Nutzer'],recent:['Request log','Aanvragenlogboek','Anfragenprotokoll'],
 exact:['Totals cover the full selected window, even when older log entries are unavailable.','Totalen omvatten de volledige geselecteerde periode, ook als oudere logregels ontbreken.','Summen umfassen das vollständige ausgewählte Zeitfenster, auch wenn ältere Protokolleinträge fehlen.'],
 logLimit:['Filters below apply only to the newest {n} loaded requests. The overview above stays complete.','Filters hieronder gelden alleen voor de {n} nieuwste geladen aanvragen. Het overzicht hierboven blijft volledig.','Die Filter unten gelten nur für die neuesten {n} geladenen Anfragen. Die Übersicht oben bleibt vollständig.'],
 truncated:['Older requests are omitted from this log. They remain included in the totals.','Oudere aanvragen ontbreken in dit logboek, maar zijn wel opgenomen in de totalen.','Ältere Anfragen fehlen in diesem Protokoll, sind aber in den Summen enthalten.'],
 empty:['No tracked requests in this period for this user selection.','Geen geregistreerde aanvragen in deze periode voor deze gebruikersselectie.','Keine erfassten Anfragen in diesem Zeitraum für diese Nutzerauswahl.'],
 noRecent:['No recent entries match these filters. Try clearing the table filters.','Geen recente vermeldingen met deze filters. Wis de tabelfilters om opnieuw te kijken.','Keine letzten Einträge für diese Filter. Tabellenauswahl zurücksetzen und erneut prüfen.'],
 noRecentScope:['Older requests may still be included in the complete totals above.','Oudere aanvragen kunnen wel zijn opgenomen in de volledige totalen hierboven.','Ältere Anfragen können weiterhin in den vollständigen Summen oben enthalten sein.'],
 search:['Search log','Logboek doorzoeken','Protokoll durchsuchen'],searchPlaceholder:['User, feature or HTTP code…','Gebruiker, functie of HTTP-code…','Nutzer, Funktion oder HTTP-Code…'],
 allFeatures:['All features','Alle functies','Alle Funktionen'],ai:['AI calls only','Alleen AI-oproepen','Nur KI-Aufrufe'],allResults:['All results','Alle resultaten','Alle Ergebnisse'],
 reset:['Reset table','Tabel herstellen','Tabelle zurücksetzen'],sort:['Sort by','Sorteren op','Sortieren nach'],newest:['Newest first','Nieuwste eerst','Neueste zuerst'],oldest:['Oldest first','Oudste eerst','Älteste zuerst'],costSort:['Highest known cost','Hoogste bekende kosten','Höchste bekannte Kosten'],durationSort:['Slowest first','Langzaamste eerst','Langsamste zuerst'],
 matches:['{n} of {total} loaded entries','{n} van {total} geladen vermeldingen','{n} von {total} geladenen Einträgen'],
 previous:['Previous','Vorige','Zurück'],next:['Next','Volgende','Weiter'],page:['Page {page} of {pages}','Pagina {page} van {pages}','Seite {page} von {pages}'],
 day:['Day (UTC)','Dag (UTC)','Tag (UTC)'],time:['Time (UTC)','Tijd (UTC)','Zeit (UTC)'],feature:['Feature','Functie','Funktion'],state:['Result','Resultaat','Ergebnis'],durationColumn:['Server time','Servertijd','Serverzeit'],tokens:['Tokens in / out','Tokens in / uit','Tokens ein / aus'],estimate:['Est. USD','Schatting USD','Schätzung USD'],
 ok:['Successful','Geslaagd','Erfolgreich'],failed:['Failed','Mislukt','Fehler'],unknown:['Unknown','Onbekend','Unbekannt'],
 unpriced:['Calls without a known rate','Oproepen zonder bekend tarief','Aufrufe ohne bekannten Tarif'],missing:['Calls without usage data','Oproepen zonder gebruiksgegevens','Aufrufe ohne Nutzungsdaten'],
 tokenDetail:['Cached input / cache writes / reasoning tokens','Gecachete invoer / cacheschrijfacties / redeneertokens','Gecachte Eingabe / Cache-Schreibvorgänge / Reasoning-Tokens'],
 prices:['Price catalog as of','Prijscatalogus per','Preiskatalog vom'],pricing:['OpenAI pricing','OpenAI-prijzen','OpenAI-Preise'],
 data:['Other data requests','Overige gegevensaanvragen','Weitere Datenanfragen'],system:['System & connections','Systeem en verbindingen','System und Verbindungen'],
 interpret:['Search interpretation','Zoekinterpretatie','Suchinterpretation'],rules:['Rules search','Regels zoeken','Regelsuche'],permits:['Permit search','Vergunningen zoeken','Bauantragssuche'],history:['Permit history','Vergunningenhistorie','Bauantragshistorie'],dso:['DSO rule references','DSO-regelverwijzingen','DSO-Regelverweise'],rp:['Plan metadata','Planmetadata','Planmetadaten'],route:['Route check','Routecontrole','Routenprüfung'],
};
function language(doc){return {nl:1,de:2}[doc.documentElement.lang]||0;}
function text(doc,key){return copy[key]?.[language(doc)]||copy[key]?.[0]||key;}
function metric(source={}){return Object.fromEntries(fields.map(key=>[key,num(source[key])]));}
function sum(rows){return rows.reduce((total,row)=>{for(const key of fields)total[key]+=num(row[key]);return total;},metric());}
function displayedUser(doc,user){return text(doc,{Admin:'admin',TestUser02:'test','Approved user':'other'}[userLabel(user)]);}
function featureKey(endpoint){
 if(endpoint==='/api/interpret')return 'interpret';
 if(endpoint==='/api/rules/search')return 'rules';
 if(endpoint==='/api/permits/search')return 'permits';
 if(endpoint==='/api/permits/point')return 'history';
 if(endpoint==='/api/dso/rules')return 'dso';
 if(endpoint==='/api/rp/plan')return 'rp';
 if(['/api/status','/api/settings','/api/ai/settings','/api/ai/test','/api/routes/status'].includes(endpoint))return 'system';
 if(endpoint==='/api/routes'||endpoint?.startsWith('/api/routes/'))return 'route';
 return 'data';
}
function resultKey(status){return status>=400?'failed':status>=200&&status<400?'ok':'unknown';}
function iso(value){const date=new Date(value);return Number.isFinite(date.valueOf())?date.toISOString():'';}
function dayString(value){return /^\d{4}-\d{2}-\d{2}$/.test(tidy(value))?value:'';}
function normalized(raw){
 if(!raw||!raw.window||!Array.isArray(raw.daily)||!Array.isArray(raw.recent))throw new Error('Invalid monitoring response');
 const from=iso(raw.window.from),to=iso(raw.window.to);if(!from||!to)throw new Error('Invalid monitoring window');
 return {window:{from,to,trackingStartedAt:raw.window.trackingStartedAt?iso(raw.window.trackingStartedAt):null},summary:metric(raw.summary),
  daily:raw.daily.map(row=>({...metric(row),day:dayString(row.day),user:userLabel(row.user)})).filter(row=>row.day),
  recent:raw.recent.slice(0,100).map(row=>({...metric(row),startedAt:iso(row.startedAt),user:userLabel(row.user),endpoint:/^\/api\/[a-z/-]{1,80}$/.test(row.endpoint)?row.endpoint:'',status:typeof row.status==='number'?row.status:0})),
  recentLimit:Math.min(100,num(raw.recentLimit)||100),recentTruncated:raw.recentTruncated===true,
  priceCatalog:{asOf:tidy(raw.priceCatalog?.asOf),source:tidy(raw.priceCatalog?.source)}};
}
function selectedWindow(data,period='14'){
 const days=['1','7','14'].includes(String(period))?Number(period):14;
 const last=new Date(data.window.to);last.setUTCHours(0,0,0,0);
 const start=new Date(last);start.setUTCDate(start.getUTCDate()-days+1);
 return {from:new Date(Math.max(start.valueOf(),new Date(data.window.from).valueOf())).toISOString(),to:data.window.to};
}
function selectedDaily(data,user='all',period='14'){
 const window=selectedWindow(data,period);
 return data.daily.filter(row=>(user==='all'||row.user===user)&&row.day>=window.from.slice(0,10)&&row.day<=window.to.slice(0,10));
}
function selectedTotals(data,user='all',period='14'){
 return user==='all'&&String(period)==='14'?metric(data.summary):sum(selectedDaily(data,user,period));
}
function selectedRecent(data,filters={},doc){
 const {user='all',period='14',query='',feature='all',result='all',sort='newest'}=filters;
 const window=selectedWindow(data,period),from=Date.parse(window.from),to=Date.parse(window.to),terms=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 const selected=data.recent.filter(row=>{
  const started=Date.parse(row.startedAt);
  if(!Number.isFinite(started)||started<from||started>to||(user!=='all'&&row.user!==user))return false;
  if(feature!=='all'&&(feature==='ai'?!(row.prompts>0):featureKey(row.endpoint)!==feature))return false;
  if(result!=='all'&&resultKey(row.status)!==result)return false;
  const key=featureKey(row.endpoint),state=resultKey(row.status);
  const haystack=[row.user,row.endpoint,row.status,key,state,...(copy[key]||[]),...(copy[state]||[]),...(copy[{Admin:'admin',TestUser02:'test','Approved user':'other'}[userLabel(row.user)]]||[]),doc?displayedUser(doc,row.user):''].join(' ').toLocaleLowerCase();
  return terms.every(term=>haystack.includes(term));
 });
 return selected.sort((a,b)=>sort==='cost'?num(b.estimatedCostUsd)-num(a.estimatedCostUsd)||b.startedAt.localeCompare(a.startedAt):sort==='duration'?num(b.durationMs)-num(a.durationMs)||b.startedAt.localeCompare(a.startedAt):sort==='oldest'?a.startedAt.localeCompare(b.startedAt):b.startedAt.localeCompare(a.startedAt));
}
function csvString(rows){
 const cell=value=>{let string=String(value??'');if(/^[\s]*[=+\-@]|^[\t\r\n]/.test(string))string="'"+string;return '"'+string.replaceAll('"','""')+'"';};
 return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
function exportMetadata(data,user,period){
 const window=selectedWindow(data,period);
 return [['Planview usage metadata','UTC','OpenAI estimates USD; not an invoice'],['window_from',window.from],['window_to',window.to],['tracking_started',data.window.trackingStartedAt||''],['price_catalog_as_of',data.priceCatalog.asOf],['price_catalog_source',data.priceCatalog.source],['user_filter',user],['period_days',period],['recent_limit',data.recentLimit],['recent_truncated',data.recentTruncated]];
}
/** Full rollup export: table-only filters intentionally do not change these totals. */
export function monitoringCsv(data,filter='all',period='14'){
 const rows=exportMetadata(data,filter,period);
 rows.push(['export_scope','complete rollups for selected user and period; recent log may be truncated'],[],['section','day_utc','started_at_utc','user','endpoint','http_status',...fields]);
 const totals=selectedTotals(data,filter,period);
 rows.push(['summary','','',filter==='all'?'All users':filter,'','',...fields.map(field=>totals[field])]);
 for(const row of selectedDaily(data,filter,period))rows.push(['daily',row.day,'',row.user,'','',...fields.map(field=>row[field])]);
 for(const row of selectedRecent(data,{user:filter,period}))rows.push(['recent','',row.startedAt,row.user,row.endpoint,row.status,...fields.map(field=>row[field])]);
 return csvString(rows);
}
/** Filtered event export has no falsely complete aggregate totals. Includes all pages. */
export function monitoringLogCsv(data,filters={}){
 const {user='all',period='14',feature='all',result='all',query='',sort='newest'}=filters;
 const rows=exportMetadata(data,user,period);
 rows.push(['export_scope','filtered recent log only; not complete usage totals'],['feature_filter',feature],['result_filter',result],['query_filter',query],['sort',sort],[],['started_at_utc','user','endpoint','http_status',...fields]);
 for(const row of selectedRecent(data,filters))rows.push([row.startedAt,row.user,row.endpoint,row.status,...fields.map(field=>row[field])]);
 return csvString(rows);
}
const styles=[
 '.services-dialog:has(#workspace-monitoring:not([hidden])){width:min(1080px,calc(100vw - 32px))}',
 '.services-dialog:has(#workspace-monitoring:not([hidden])) form{grid-template-columns:minmax(0,1fr)}.services-dialog:has(#workspace-monitoring:not([hidden])) form>*{min-width:0}.services-dialog:has(#workspace-monitoring:not([hidden])) .services-heading>div{min-width:0}.services-dialog:has(#workspace-monitoring:not([hidden])) .services-heading h2{overflow-wrap:anywhere}',
 '#workspace-monitoring{min-width:0;display:grid;gap:20px}#workspace-monitoring[hidden]{display:none}',
 '#workspace-monitoring h3{font-size:22px;margin:0 0 5px;letter-spacing:-.5px}#workspace-monitoring h4{font-size:15px;margin:0}',
 '#workspace-monitoring p{font-size:12px;line-height:1.6;margin:0;color:var(--muted)}',
 '#workspace-monitoring .pv-monitor-heading{display:flex;gap:12px;justify-content:space-between;align-items:start;flex-wrap:wrap}#workspace-monitoring .pv-monitor-heading>div{min-width:0;flex:1 1 180px}#workspace-monitoring .pv-monitor-heading>button{margin-left:auto;flex-shrink:0}',
 '#workspace-monitoring .pv-monitor-tools{display:flex;align-items:end;gap:10px;flex-wrap:wrap}',
 '#workspace-monitoring label{display:grid;gap:6px;font-size:11px;font-weight:600;min-width:0}',
 '#workspace-monitoring button,#workspace-monitoring select,#workspace-monitoring input{font:inherit;font-size:12px;min-height:40px;border:1px solid var(--line2);border-radius:9px;padding:8px 11px;background:var(--surface);color:var(--text);max-width:100%}',
 '#workspace-monitoring select,#workspace-monitoring input{width:100%;min-width:0;box-sizing:border-box}',
 '#workspace-monitoring button{cursor:pointer}#workspace-monitoring button:disabled,#workspace-monitoring button[aria-disabled=true]{opacity:.45;cursor:default}',
 '#workspace-monitoring :is(button,select,input,summary):focus-visible{outline:3px solid var(--mint);outline-offset:2px}',
 '#workspace-monitoring .pv-monitor-global{padding:13px 15px;background:var(--surface2);border-radius:12px;display:flex;align-items:end;gap:12px;flex-wrap:wrap}',
 '#workspace-monitoring .pv-monitor-global label{min-width:150px}#workspace-monitoring .pv-monitor-status{margin-left:auto;font-size:11px;align-self:center}#workspace-monitoring .pv-monitor-status[data-error=true]{color:var(--text);max-width:330px}',
 '#workspace-monitoring .pv-monitor-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}',
 '#workspace-monitoring .pv-monitor-kpi{padding:16px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface);min-width:0}',
 '#workspace-monitoring .pv-monitor-kpi>span{font-size:11px;color:var(--muted);display:block}#workspace-monitoring .pv-monitor-kpi strong{display:block;font-size:26px;margin:10px 0 8px;line-height:1.1;letter-spacing:-.5px;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}',
 '#workspace-monitoring .pv-monitor-kpi[data-monitor-metric=errors][data-warning=true]{border-color:#d7a25e}#workspace-monitoring .pv-monitor-kpi p{font-size:10px}',
 '#workspace-monitoring .pv-monitor-overview{display:grid;gap:9px}#workspace-monitoring .pv-monitor-context{display:flex;justify-content:space-between;flex-wrap:wrap;gap:5px 18px}#workspace-monitoring .pv-monitor-context strong{color:var(--text);font-weight:600}',
 '#workspace-monitoring .pv-monitor-warning{border-left:3px solid #cf9446;padding:7px 10px;background:var(--surface2);border-radius:0 7px 7px 0}',
 '#workspace-monitoring .pv-monitor-recent{display:grid;gap:12px;border-top:1px solid var(--line);padding-top:20px;min-width:0}',
 '#workspace-monitoring .pv-monitor-log-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}',
 '#workspace-monitoring .pv-monitor-filters{display:grid;grid-template-columns:minmax(150px,1.5fr) repeat(3,minmax(105px,1fr));gap:9px}',
 '#workspace-monitoring .pv-monitor-table-wrap{overflow:auto;border:1px solid var(--line);border-radius:10px;max-width:100%}',
 '#workspace-monitoring table{width:100%;border-collapse:collapse;font-size:11px;font-variant-numeric:tabular-nums;background:var(--surface)}',
 '#workspace-monitoring th,#workspace-monitoring td{padding:12px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}#workspace-monitoring th{font-weight:600;background:var(--surface2);color:var(--muted);white-space:nowrap}#workspace-monitoring tr:last-child td{border-bottom:0}',
 '#workspace-monitoring .pv-monitor-log{min-width:670px}#workspace-monitoring .pv-monitor-log tbody tr:hover{background:var(--surface2)}',
 '#workspace-monitoring .pv-monitor-result{display:inline-flex;border-radius:20px;padding:3px 7px;font-size:10px;font-weight:650;white-space:nowrap;background:var(--surface2);color:var(--muted)}',
 '#workspace-monitoring .pv-monitor-result[data-result=ok]{background:#e5f3ee;color:#146650}#workspace-monitoring .pv-monitor-result[data-result=failed]{background:#fbe9e2;color:#9c3d23}',
 '#workspace-monitoring .pv-monitor-time span{display:block;color:var(--muted);font-size:10px;margin-top:3px}',
 '#workspace-monitoring .pv-monitor-row-detail{min-width:120px;max-width:300px}#workspace-monitoring .pv-monitor-row-detail summary{cursor:pointer;line-height:1.5}#workspace-monitoring .pv-monitor-row-detail summary span{display:block;font-size:10px;color:var(--muted);margin-left:12px}#workspace-monitoring .pv-monitor-row-detail[open] summary{margin-bottom:10px}',
 '#workspace-monitoring .pv-monitor-row-detail p{font-size:10px;overflow-wrap:anywhere}#workspace-monitoring .pv-monitor-row-detail code{white-space:normal;font-size:10px;overflow-wrap:anywhere}',
 '#workspace-monitoring .pv-monitor-table-footer{display:flex;gap:8px;align-items:center;flex-wrap:wrap}#workspace-monitoring .pv-monitor-pager{margin-left:auto;display:flex;gap:8px;align-items:center}#workspace-monitoring .pv-monitor-pager span{font-size:11px;color:var(--muted)}',
 '#workspace-monitoring .pv-monitor-disclosure{border:1px solid var(--line);border-radius:10px;padding:13px 15px;min-width:0}#workspace-monitoring .pv-monitor-disclosure>summary{font-size:12px;font-weight:650;cursor:pointer}#workspace-monitoring .pv-monitor-disclosure[open]>summary{margin-bottom:14px}#workspace-monitoring .pv-monitor-disclosure-content{display:grid;gap:14px;min-width:0}#workspace-monitoring .pv-monitor-disclosure-content section{display:grid;gap:9px;min-width:0}',
 '#workspace-monitoring .pv-monitor-bar{display:block;width:100%;height:4px;background:var(--line);border-radius:4px;overflow:hidden;margin-top:6px}#workspace-monitoring .pv-monitor-bar i{display:block;height:100%;background:var(--mint);border-radius:4px}',
 '#workspace-monitoring .pv-monitor-empty{padding:24px 15px;border:1px dashed var(--line2);border-radius:9px;text-align:center}#workspace-monitoring a{color:var(--mint)}',
 '@media(max-width:900px){.services-dialog:has(#workspace-monitoring:not([hidden])){width:100%}}',
 '@media(max-width:650px){#workspace-monitoring .pv-monitor-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}#workspace-monitoring .pv-monitor-filters{grid-template-columns:repeat(2,minmax(0,1fr))}#workspace-monitoring .pv-monitor-global label{flex:1;min-width:110px}#workspace-monitoring .pv-monitor-status{width:100%;margin:0}.workspace-settings-tabs:has([data-settings-tab=monitoring]) button{font-size:11px;padding-inline:6px;min-width:0;overflow-wrap:anywhere}}',
 '@media(max-width:400px){#workspace-monitoring .pv-monitor-kpi strong{font-size:21px}#workspace-monitoring .pv-monitor-kpi{padding:13px 10px}#workspace-monitoring .pv-monitor-pager{margin-left:0;flex-wrap:wrap}}',
].join('\n');
/** Invoke only after authenticated /api/status confirms the pinned owner. */
export function mountAdminMonitoring({window:win=globalThis.window,document:doc=globalThis.document}={}){
 if(win.__planviewAdminMonitor)return win.__planviewAdminMonitor;
 const el=(tag,className='',value)=>{const node=doc.createElement(tag);if(className)node.className=className;if(value!==undefined)node.textContent=value;return node;};
 const panel=el('section','pv-admin-monitor');
 let data=null,loading=false,entry=null,failed=false,forbidden=false,page=0;
 const filters={user:'all',period:'14',query:'',feature:'all',result:'all',sort:'newest'};
 const expanded={};
 const number=value=>new Intl.NumberFormat(doc.documentElement.lang||'en',{maximumFractionDigits:0}).format(num(value));
 const dollars=value=>new Intl.NumberFormat(doc.documentElement.lang||'en',{style:'currency',currency:'USD',minimumFractionDigits:4,maximumFractionDigits:6}).format(num(value));
 const duration=value=>new Intl.NumberFormat(doc.documentElement.lang||'en',{maximumFractionDigits:1}).format(num(value)/1000)+' s';
 const dateTime=value=>value?new Intl.DateTimeFormat(doc.documentElement.lang||'en',{timeZone:'UTC',dateStyle:'medium',timeStyle:'medium'}).format(new Date(value)):'—';
 const shortDate=value=>new Intl.DateTimeFormat(doc.documentElement.lang||'en',{timeZone:'UTC',month:'short',day:'numeric'}).format(new Date(value));
 const label=key=>text(doc,key);
 const cost=source=>dollars(source.estimatedCostUsd)+(source.unpricedCalls||source.usageMissingCalls?' + ?':'');
 function button(key,control,action,disabled=false){const node=el('button','',label(key));node.type='button';node.dataset.monitorControl=control;node.disabled=disabled;node.addEventListener('click',action);return node;}
 function selectControl(key,control,options){
  const wrap=el('label','',label(key)),select=el('select');select.dataset.monitorControl=control;select.setAttribute('aria-label',label(key));
  for(const [value,title]of options){const option=el('option','',title);option.value=value;select.append(option);}
  select.value=filters[control];select.addEventListener('change',()=>{filters[control]=select.value;page=0;draw();});wrap.append(select);return wrap;
 }
 function table(headers,rows,className=''){
  const wrap=el('div','pv-monitor-table-wrap'),node=el('table',className),head=el('thead'),tr=el('tr'),body=el('tbody');
  for(const title of headers){const th=el('th','',title);th.setAttribute('scope','col');tr.append(th);}head.append(tr);
  rows.forEach((cells,index)=>{const row=el('tr');if(className==='pv-monitor-log')row.dataset.monitorEntry=String(page*10+index);for(const value of cells){const td=el('td');if(value&&typeof value==='object')td.append(value);else td.textContent=String(value);row.append(td);}body.append(row);});
  node.append(head,body);wrap.append(node);return wrap;
 }
 function disclosure(key,className){
  const node=el('details','pv-monitor-disclosure '+className);node.open=expanded[key]===true;
  node.append(el('summary','',label(key)));node.addEventListener('toggle',()=>{expanded[key]=node.open;});
  const content=el('div','pv-monitor-disclosure-content');node.append(content);return {node,content};
 }
 function exportFile(content,suffix){
  const url=win.URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'})),anchor=el('a');
  anchor.href=url;anchor.download='planview-'+suffix+'-'+data.window.to.slice(0,10)+'.csv';anchor.hidden=true;doc.body.append(anchor);anchor.click();anchor.remove();win.setTimeout(()=>win.URL.revokeObjectURL(url),1000);
 }
 function rowCells(row){
  const time=el('div','pv-monitor-time',shortDate(row.startedAt));time.append(el('span','',new Intl.DateTimeFormat(doc.documentElement.lang||'en',{timeZone:'UTC',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(row.startedAt))));
  const detail=el('details','pv-monitor-row-detail'),summary=el('summary','',label(featureKey(row.endpoint)));
  if(row.prompts)summary.append(el('span','',number(row.prompts)+' '+label('prompts').toLocaleLowerCase()));
  detail.append(summary,el('code','',row.endpoint||'—'),el('p','','HTTP '+(row.status||'—')),el('p','',label('prompts')+': '+number(row.prompts)),el('p','',label('tokens')+': '+number(row.inputTokens)+' / '+number(row.outputTokens)),el('p','',label('tokenDetail')+': '+number(row.cachedInputTokens)+' / '+number(row.cacheWriteTokens)+' / '+number(row.reasoningTokens)));
  if(row.unpricedCalls||row.usageMissingCalls)detail.append(el('p','',label('partial')),el('p','',label('unpriced')+': '+number(row.unpricedCalls)+' · '+label('missing')+': '+number(row.usageMissingCalls)));
  const result=el('span','pv-monitor-result',label(resultKey(row.status)));result.dataset.result=resultKey(row.status);result.title='HTTP '+row.status;
  const amount=el('span','',cost(row));if(row.unpricedCalls||row.usageMissingCalls)amount.title=label('partial');
  return [time,displayedUser(doc,row.user),detail,result,duration(row.durationMs),amount];
 }
 function draw(){
  const active=doc.activeElement?.dataset?.monitorControl,caret=active==='query'?[doc.activeElement.selectionStart,doc.activeElement.selectionEnd]:null;
  panel.replaceChildren();panel.setAttribute('aria-busy',String(loading));if(entry)entry.button.textContent=label('tab');
  const heading=el('div','pv-monitor-heading'),title=el('div'),refresh=button('refresh','refresh',()=>load());refresh.setAttribute('aria-disabled',String(loading));title.append(el('h3','',label('title')),el('p','',label('intro')));heading.append(title,refresh);panel.append(heading);
  const tools=el('div','pv-monitor-global');
  tools.append(selectControl('period','period',[['14',label('days14')],['7',label('days7')],['1',label('today')]]),selectControl('user','user',[['all',label('all')],...users.map(user=>[user,displayedUser(doc,user)])]));
  const status=el('p','pv-monitor-status',label(loading?'loading':forbidden?'forbidden':failed?data?'stale':'error':'ready')+(data&&!loading&&!failed?' · '+dateTime(data.window.to)+' UTC':''));
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.dataset.error=String(failed);tools.append(status);panel.append(tools);
  if(data){
   const rows=selectedDaily(data,filters.user,filters.period),totals=selectedTotals(data,filters.user,filters.period),overview=el('div','pv-monitor-overview'),kpis=el('div','pv-monitor-kpis');
   for(const [key,value,note]of [['prompts',number(totals.prompts),'promptShort'],['cost',cost(totals),'costShort'],['duration',totals.requests?duration(totals.durationMs/totals.requests):'—','durationShort'],['errors',number(totals.errors),null]]){
    const card=el('div','pv-monitor-kpi');card.dataset.monitorMetric=key;card.dataset.warning=String(key==='errors'&&totals.errors>0);card.append(el('span','',label(key)),el('strong','',value));if(note)card.append(el('p','',label(note)));kpis.append(card);
   }
   const context=el('div','pv-monitor-context'),requestCount=el('p');requestCount.dataset.monitorMetric='requests';requestCount.append(el('strong','',label('requests')+' '+number(totals.requests)));
   const window=selectedWindow(data,filters.period);context.append(requestCount,el('p','',shortDate(window.from)+' – '+shortDate(window.to)+' · '+label('utc')));
   overview.append(kpis,context,el('p','',label('scopeShort')));
   if(totals.unpricedCalls||totals.usageMissingCalls)overview.append(el('p','pv-monitor-warning',label('partial')));
   if(!totals.requests)overview.append(el('p','pv-monitor-empty',label('empty')));panel.append(overview);
   const recent=el('section','pv-monitor-recent'),logHeading=el('div','pv-monitor-log-heading');logHeading.append(el('h4','',label('recent')),button('csvLog','csv-log',()=>exportFile(monitoringLogCsv(data,filters),'filtered-log'),loading));recent.append(logHeading,el('p','',label('logLimit').replace('{n}',number(data.recentLimit))));
   if(data.recentTruncated)recent.append(el('p','',label('truncated')));
   const tableTools=el('div','pv-monitor-filters'),queryWrap=el('label','',label('search')),query=el('input');query.type='search';query.value=filters.query;query.maxLength=200;query.placeholder=label('searchPlaceholder');query.dataset.monitorControl='query';query.setAttribute('aria-label',label('search'));
   query.addEventListener('input',()=>{filters.query=query.value.slice(0,200);page=0;draw();});queryWrap.append(query);
   tableTools.append(queryWrap,selectControl('feature','feature',[['all',label('allFeatures')],['ai',label('ai')],...['interpret','rules','permits','history','dso','rp','route','system','data'].map(key=>[key,label(key)])]),selectControl('state','result',[['all',label('allResults')],...['ok','failed','unknown'].map(key=>[key,label(key)])]),selectControl('sort','sort',['newest','oldest','cost','duration'].map(key=>[key,label(key==='cost'?'costSort':key==='duration'?'durationSort':key)])));
   recent.append(tableTools);
   const entries=selectedRecent(data,filters,doc),pages=Math.max(1,Math.ceil(entries.length/10));page=Math.min(page,pages-1);
   const count=el('p','',label('matches').replace('{n}',number(entries.length)).replace('{total}',number(data.recent.length)));count.setAttribute('role','status');count.setAttribute('aria-live','polite');recent.append(count);
   if(entries.length)recent.append(table(['time','user','feature','state','durationColumn','estimate'].map(label),entries.slice(page*10,page*10+10).map(rowCells),'pv-monitor-log'));
   else{const empty=el('div','pv-monitor-empty');empty.append(el('p','',label('noRecent')),el('p','',label('noRecentScope')));recent.append(empty);}
   const footer=el('div','pv-monitor-table-footer'),activeTableFilter=filters.query||filters.feature!=='all'||filters.result!=='all'||filters.sort!=='newest';
   footer.append(button('reset','reset',()=>{Object.assign(filters,{query:'',feature:'all',result:'all',sort:'newest'});page=0;draw();},!activeTableFilter));
   const pager=el('div','pv-monitor-pager');pager.append(button('previous','previous',()=>{page--;draw();},page===0),el('span','',label('page').replace('{page}',number(page+1)).replace('{pages}',number(pages))),button('next','next',()=>{page++;draw();},page>=pages-1));footer.append(pager);recent.append(footer);panel.append(recent);
   const rollups=disclosure('rollups','pv-monitor-rollups');rollups.content.append(el('p','',label('exact')));
   const byDay=new Map();for(const row of rows)byDay.set(row.day,sum([byDay.get(row.day)||{},row]));
   const ordered=[...byDay].sort(([a],[b])=>a.localeCompare(b)),max=Math.max(1,...ordered.map(([,m])=>m.requests));
   const daily=el('section');daily.append(el('h4','',label('daily')));
   if(ordered.length)daily.append(table(['day','requests','prompts','estimate'].map(label),ordered.map(([day,m])=>{const cell=el('span','',day),bar=el('span','pv-monitor-bar'),fill=el('i');fill.style.width=String(m.requests/max*100)+'%';bar.setAttribute('aria-hidden','true');bar.append(fill);cell.append(bar);return[cell,number(m.requests),number(m.prompts),cost(m)];})));else daily.append(el('p','',label('empty')));
   const breakdown=el('section');breakdown.append(el('h4','',label('breakdown')));
   const included=users.filter(user=>filters.user==='all'||user===filters.user).map(user=>[user,sum(rows.filter(row=>row.user===user))]).filter(([,m])=>m.requests);
   if(included.length)breakdown.append(table(['user','requests','prompts','errors','estimate'].map(label),included.map(([user,m])=>[displayedUser(doc,user),number(m.requests),number(m.prompts),number(m.errors),cost(m)])));else breakdown.append(el('p','',label('empty')));
   rollups.content.append(daily,breakdown);panel.append(rollups.node);
   const method=disclosure('method','pv-monitor-method');
   for(const key of ['requestNote','promptNote','durationNote','scope','privacy'])method.content.append(el('p','',label(key)));
   method.content.append(el('p','',label('unpriced')+': '+number(totals.unpricedCalls)+' · '+label('missing')+': '+number(totals.usageMissingCalls)),el('p','',data.window.trackingStartedAt?label('start')+': '+dateTime(data.window.trackingStartedAt)+'. '+label('noBackfill'):label('noStart')));
   const prices=el('p','',label('prices')+': '+(data.priceCatalog.asOf||'—'));
   try{const url=new URL(data.priceCatalog.source);if(url.protocol==='https:'&&['openai.com','developers.openai.com','platform.openai.com'].includes(url.hostname)){const link=el('a','',label('pricing'));link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';prices.append(' · ',link);}}catch{}
   method.content.append(prices,button('csv','csv',()=>exportFile(monitoringCsv(data,filters.user,filters.period),'usage'),loading));panel.append(method.node);
  }
  if(active){
   let target=panel.querySelector('[data-monitor-control="'+active+'"]');
   if(target?.disabled){const fallback=active==='next'?'previous':active==='previous'?'next':'query';target=panel.querySelector('[data-monitor-control="'+fallback+'"]');}
   if(!target||target.disabled)target=panel.querySelector('[data-monitor-control="period"]');
   target?.focus();if(caret&&typeof target?.setSelectionRange==='function')target.setSelectionRange(...caret);
  }
 }
 async function load(){
  if(loading)return;loading=true;failed=false;forbidden=false;draw();
  try{const response=await win.fetch('/api/admin/monitoring',{method:'GET',cache:'no-store',headers:{Accept:'application/json'}});if(!response.ok){forbidden=response.status===403;throw new Error('Usage unavailable');}data=normalized(await response.json());page=0;}
  catch{failed=true;}finally{loading=false;draw();}
 }
 function mount(){
  if(entry||!win.PlanViewSettings)return;
  const style=el('style');style.textContent=styles;doc.head.append(style);
  entry=win.PlanViewSettings.registerTab('monitoring',label('tab'),panel,()=>{if(!data&&!loading)load();});draw();
 }
 const api={panel};win.__planviewAdminMonitor=api;
 win.addEventListener('planview-settings-ready',mount,{once:true});win.addEventListener('planview-language-change',draw);mount();
 return api;
}
