# Planview auf Firebase

Stand: 1. November 2026. Verbindlicher Quellcode ist dieser Git-Checkout `InteractiveMap/app`, verbunden mit `https://github.com/bbyw2hrnf6-boop/PlanView-Plankaart`. Der GitHub-Repository-Stamm ist **app/**, nicht der äußere Ordner InteractiveMap. Das frühere lokale Verzeichnis `Documents/PlanView Plankaart` wird nicht neu angelegt.

## Eingerichtet und veröffentlicht

- Firebase-Projekt **planview-ecf9b**, Web-App **Planview Web** registriert. Google-Anmeldung ist aktiviert; beide Hosting-Domains sind autorisiert. Firestore `(default)` ist in `europe-west1` mit privaten Produktionsregeln erstellt.
- Projektkonsole: https://console.firebase.google.com/project/planview-ecf9b/overview
- Live-Adresse: **https://planview-ecf9b.web.app/**. Hosting und geschützte API sind seit 1. November 2026 veröffentlicht; TestUser02 wurde auf der echten Seite erfolgreich angemeldet. Anonyme API-Aufrufe liefern 401, fremde Ursprünge 403.
- Hosting, Node.js-22-Function `planviewApi` in `europe-west1`, Google-Anmeldung, Test-Passwortlogin und Firestore-Anbindung eingerichtet. Läuft unabhängig vom lokalen Mac.
- Backend-Zugriff für das verifizierte Google-Konto **hirsch.danny@gmx.de** sowie den separat eingerichteten Testzugang **TestUser02**, sobald seine konkrete UID konfiguriert ist. Die öffentliche Hosting-Adresse liefert die Anmeldeseite sowie öffentliche Karten-/App-Dateien; sensible APIs sind unabhängig davon geschützt. Hosting allein ist keine Zugriffssperre für die statischen Dateien.
- API-Schlüssel werden **zentral vom Besitzer verwaltet**: AES-GCM-verschlüsselt in Firestore. Das verifizierte Besitzerkonto speichert/ändert sie in Settings → Connections. TestUser02 verwendet diese serverseitige Verbindung mit und darf die Schlüssel weder auslesen noch ändern. Der separate Hauptschlüssel liegt in Google Secret Manager und wird nur der Function bereitgestellt. Firestore-Regeln verbieten sämtliche direkten Browserzugriffe, auch auf verschlüsselte Schlüssel.
- GitHub-Actions-Datei `.github/workflows/firebase-deploy.yml` vorbereitet. Anmeldung bei Google erfolgt über kurzlebige OIDC-Tokens, ohne heruntergeladene Service-Account-Schlüsseldatei und ohne OpenAI-/DSO-Keys in GitHub.
- Lokale App, bestehende Sites-Veröffentlichung, alte Keys und Git-Historie bleiben erhalten. Firebase übernimmt den aktuellen kanonischen App-Code beim Bauen. Keys aus dem Mac oder der alten Sites-Datenbank werden nicht migriert; später in Firebase erneut eingeben.

## 1. Abrechnung und Anmeldung in Firebase

1. In der Projektkonsole kontrollieren, dass oben **Planview / planview-ecf9b** ausgewählt ist.
2. Bereits erledigt: **Blaze aktiviert**, bestehendes Google-Testguthaben vom Eigentümer freigegeben. Laut Konsole endet der Testzeitraum am **13. November 2026**. Google kann für Functions, Firestore, Builds, gespeicherte Container und Übertragung Kosten berechnen. Budget-Warnungen sind **keine harte Kostensperre**.
3. Bereits erledigt: **Authentication → Anmeldemethode → Google → Aktiviert**. Support-E-Mail `hirsch.danny@gmx.de` auswählen und speichern. Keine Passwörter in Projektdateien eintragen. Falls Google eine OAuth-Einwilligung im Testmodus verlangt, dieses Konto als Testnutzer freigeben.
4. Unter Authentication → Einstellungen → Autorisierte Domains die Hosting-Domains prüfen: `planview-ecf9b.web.app` und `planview-ecf9b.firebaseapp.com`. Die erste Domain gegebenenfalls ergänzen.
5. Bereits erledigt: **Firestore Database → Standard Edition / Native Mode → Standort europe-west1 (Belgien)**. Produktionsmodus wählen. Die beiliegenden Regeln verweigern Browser-Lese-/Schreibzugriff. Standort bewusst wählen; spätere Standortwechsel sind keine einfache Einstellung.
6. Falls die Konsole eine rechtliche Zustimmung oder Abrechnungsbestätigung verlangt, selbst prüfen und bestätigen.

## 2. Terminal vorbereiten

Node.js **22** verwenden. Die Firebase-Abhängigkeiten und Lockdateien liegen im Projekt. Nach einem neuen Clone:

```sh
cd /Users/uhorizon/Documents/ChatGPT/InteractiveMap/app
npm ci --prefix firebase
npm ci --prefix firebase/functions
./firebase/node_modules/.bin/firebase login
```

Im Browser mit `hirsch.danny@gmx.de` anmelden und die CLI-Berechtigungen prüfen. Das ist ein normaler Login; keine Tokens in Git oder Chat kopieren. Der Login wird im lokalen Firebase-CLI-Kontospeicher gehalten. **Kein `firebase init` ausführen:** `firebase.json`, Regeln und Funktionen sind bereits eingerichtet; init könnte sie überschreiben.

## 3. Hauptschlüssel einmalig sicher anlegen

**Im Projekt planview-ecf9b bereits erledigt. Den folgenden Erzeugungsschritt hier nicht erneut ausführen.** Der Hauptschlüssel ist kein OpenAI-Key. Er verschlüsselt die zentral gespeicherten Anbieter-Keys. Die folgende Anleitung dient ausschließlich einer neuen, noch nicht eingerichteten Installation.

```sh
openssl rand -base64 32 | ./firebase/node_modules/.bin/firebase functions:secrets:set PLANVIEW_CREDENTIAL_KEY --project planview-ecf9b --data-file -
```

Der generierte Wert geht direkt über stdin zu Secret Manager, ohne eine Datei oder Ausgabe im Terminal. **Nur einmal erzeugen. Bestehenden Wert nicht bei jedem Deployment ersetzen.** Sonst lassen sich bisher gespeicherte Anbieter-Keys nicht mehr entschlüsseln. Zugriff über Google-IAM begrenzen. Reguläre GitHub-Deployments erzeugen oder rotieren diesen Schlüssel nicht.

## 4. Laufzeitrechte und erstes Deployment

Die Function nutzt das dedizierte Laufzeitkonto `planview-runtime@planview-ecf9b.iam.gserviceaccount.com`. Es erhält Firestore-Lese-/Schreibrechte im Projekt und ausschließlich für `PLANVIEW_CREDENTIAL_KEY` Zugriff auf den Secret-Wert. Diese dauerhaften IAM-Rechte müssen vor Einrichtung ausdrücklich freigegeben sein. Mit Google Cloud CLI als Projektbesitzer, bei Bedarf auch in Cloud Shell:

Im bestehenden Projekt sind die beiden Bindungen bereits eingerichtet. Zusätzlich ist nach ausdrücklicher Freigabe die Projektrolle `planviewTokenVerifier` mit ausschließlich `firebaseauth.users.get` an dieses Konto gebunden. Dadurch kann `verifyIdToken(token, true)` auch gesperrte Nutzer und widerrufene Sitzungen ablehnen. Diese Prüfung bleibt für beide Loginarten aktiv.

```sh
gcloud auth login
gcloud config set project planview-ecf9b
gcloud iam service-accounts create planview-runtime --project=planview-ecf9b --display-name="Planview runtime"
gcloud projects add-iam-policy-binding planview-ecf9b \
  --member="serviceAccount:planview-runtime@planview-ecf9b.iam.gserviceaccount.com" \
  --role=roles/datastore.user --condition=None
```

Das Konto nur erstellen, wenn es noch nicht existiert. Nicht einem ähnlich benannten fremden Account Rechte geben. Den Zugriff auf den Hauptschlüssel ausschließlich an diesem Secret binden:

```sh
gcloud secrets add-iam-policy-binding PLANVIEW_CREDENTIAL_KEY --project=planview-ecf9b \
  --member="serviceAccount:planview-runtime@planview-ecf9b.iam.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor --condition=None
```

Dann aus dem App-Stamm:

```sh
python3 tools/firebase_release.py audit
node --test tests/*.test.cjs tests/*.test.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
python3 tools/firebase_release.py prepare
FIREBASE_HOSTING_UPLOAD_CONCURRENCY=20 node --require ./firebase/buffered-uploads.cjs \
  ./firebase/node_modules/firebase-tools/lib/bin/firebase.js deploy --project planview-ecf9b \
  --only functions:planview,firestore:rules,firestore:indexes,hosting
```

Bei der ersten Bereitstellung können Google-APIs automatisch aktiviert werden. Deployment-CLI-Dialoge lesen, insbesondere Kosten und Aufbewahrung von Build-Artefakten. Ein erfolgreicher CLI-Abschluss muss **Function, Firestore-Regeln und Hosting** bestätigen. Keine reine Hosting-Veröffentlichung als funktionsfähiges KI-Backend ausgeben.

Beim ersten Livegang wurde die Function erfolgreich erstellt und die Firestore-Regeln freigegeben; die CLI stoppte danach wegen einer noch nicht gewählten Aufbewahrungsrichtlinie für Build-Container. Hosting wurde anschließend separat erfolgreich veröffentlicht, mit exakt denselben vorbereiteten Backend-Quellen. Eine reine Hosting-Aktualisierung ersetzt kein fehlendes Backend. Vor zukünftigen automatisierten Function-Deployments die gewünschte Container-Aufbewahrung festlegen: die CLI kann andernfalls nach einem erfolgreichen Function-Update vor dem Hosting-Schritt abbrechen. Es wurde hier weder eine automatische Löschrichtlinie eingerichtet noch bestehende Historie bereinigt.

Der kleine CLI-Preload puffert ausschließlich Datei-Uploads an den offiziellen Hosting-Endpunkt unseres Projekts. Die normalen gestreamten Uploads liefen lokal wiederholt in Zeitlimits, selbst bei kleinen Dateien; dieselben Bytes mit fester Länge wurden sofort angenommen. Authentifizierung, Abbruchsignal und Gzip-Inhalt bleiben identisch. Die übrigen CLI-Anfragen werden unverändert weitergereicht. Der Preload gehört weder in den Browser noch in die Function.

Firebase liefert HTML, JavaScript und CSS mit `no-cache` aus: der Browser darf sie speichern, muss sie beim nächsten Laden aber auf Aktualität prüfen. Zusätzlich versieht der Firebase-Build die lokalen Skript-/CSS-URLs in der Startseite mit einem Inhalts-Hash. Geänderte Dateien bekommen damit neue URLs, auch wenn ein Browser noch alte Cache-Regeln gespeichert hat. Große unveränderte Karten-/Datendateien behalten das normale Caching. Der kanonische HTML-Code für localhost/Sites wird dabei nicht verändert.

Die App verwendet für längere API-Anfragen den authentifizierten direkten HTTPS-Endpunkt der Function. Das umgeht das 60-Sekunden-Limit von Firebase Hosting. Die Function selbst hat 300 Sekunden, keine warm gehaltene Mindestinstanz und höchstens drei Instanzen; Such- und Benutzerlimits bleiben zusätzlich aktiv. Ein abgebrochener Browseraufruf garantiert nicht, dass bereits gestartete Providerarbeit kostenfrei abgebrochen wird.

## 5. Live prüfen und Anbieter-Keys hinterlegen

1. https://planview-ecf9b.web.app/ öffnen.
2. Mit dem freigegebenen Google-Konto anmelden.
3. Als Besitzer in Einstellungen → Verbindungen den zentralen OpenAI-API-Key eintragen, speichern und Verbindung testen. Der Besitzer gibt ihn selbst ein; keine Keys im Chat oder Projekt hinterlegen.
4. Als Besitzer den zentralen DSO-Key für aktuelle DSO-Regeltexte und optional den **separaten RP-V4-Key** für Metadaten des ausgewählten IMRO-Plans eintragen. Optionalen Routing-Key über die bestehende Routen-/Vergleichsverbindung hinterlegen. Diese Verbindungen gelten für alle ausdrücklich freigegebenen Konten.
5. Grundstück anklicken: nur Grundstück markieren; bekannte Adresse im Kopf und Bauantragsverlauf prüfen. Eine KI-Frage und eine Regeltextfrage testen.
6. In zweitem Browser mit anderem Konto prüfen: Backend-Zugriff muss abgewiesen werden. Fremde Konten nutzen nicht deinen OpenAI-Key.
7. TestUser02 auf einem anderen Gerät anmelden: die zentralen Verbindungen sollen bereitstehen, ohne sichtbare Eingabe-/Änderungsfelder. Nicht freigegebene Konten bleiben ausgeschlossen. Nutzungslimits gelten weiterhin pro Nutzer. Notizen/Merkliste bleiben derzeit im jeweiligen Browser; keine automatische gemeinsame Falldatenbank.

PDOK und KOOP brauchen hierfür keinen neuen Anbieter-Key. Die lokale Codex-Anmeldung sowie die macOS-PDFKit-/Vision-OCR stehen in Firebase nicht zur Verfügung. Die Cloud-Bauantragssuche nutzt veröffentlichte Bekanntmachungstexte und kennzeichnet ungelesene Anlagen. Eine vollständige serverseitige PDF-/OCR-Pipeline ist ein eigenes Folgeprojekt; Firebase allein aktiviert sie nicht.

Der RP-V4-Anschluss lädt ausschließlich Metadaten des bereits über PDOK ausgewählten IMRO-Plans: Titel, Planart, Planstatus und Datum aus `planstatusInfo`, Dossierstatus sowie gegebenenfalls das von der Quelle gemeldete Ende der Rechtsgültigkeit. Er ersetzt weder die Plankarte noch die DSO-Regeltextsuche und durchsucht keine vollständigen alten Plantexte. Der neue authentifizierte GET-Pfad `/api/rp/plan?id=…` akzeptiert nur begrenzte IMRO-Kennungen und ruft ausschließlich den festen amtlichen Host auf, ohne Weiterleitungen. Je Nutzer gelten intern 40 Aufrufe pro fünf Minuten und höchstens eine gleichzeitige RP-Abfrage; das ist keine zugesicherte Anbieterquote. Quelle: [amtliche RP-V4-Dokumentation](https://developer.omgevingswet.overheid.nl/api-register/api/rp-opvragen/). Keine neue Kartenmarkierung entsteht. DSO-Kartengeometrien benötigen weiterhin den lokalen Mac-Server. Die RP-Verbindung braucht keine zusätzlichen IAM-Rechte und verwendet dieselbe zentrale Verschlüsselung; der Besitzer gibt den Anbieter-Key selbst erneut ein.

DSO-Textverbindung und DSO-Kartenumrisse sind getrennte Fähigkeiten. Der zentrale DSO-Key aktiviert auch für TestUser02 die Regelfragen sowie die Punktverweise in Inspektor, Suchtreffern und Vergleich. `GET /api/dso/rules?x=…&y=…` lädt über den zentralen Key nur amtliche Dokument-/Annotationsverweise für einen geprüften RD-Punkt; keine Geometrien und keine KI-Abfrage. Begrenzung: drei parallele Aufrufe pro Nutzer mit jeweils zwölf Aufrufen pro fünf Minuten (zusammen höchstens 36), drei Discovery-Seiten, vier repräsentative Instrumente und 30 Sekunden Gesamtzeit. Fehlende Dokumente, unbekannte Ortsreferenzen und ausgelassene Instrumente bleiben unbestätigt/teilweise. Die ersten drei Suchtreffer werden ergänzend geprüft; daraus entsteht kein neuer Zulässigkeitsfilter. Nur der Kartenumriss-Schalter bleibt im Web deaktiviert. Ein bereiter zentraler Key darf daher keinen Hinweis „DSO nicht eingerichtet“ auslösen.

Der im Browser sichtbare Firebase-Web-Konfigurationswert `apiKey` ist eine öffentliche Projektkennung für das Firebase-SDK. Er ist **nicht** der geheime OpenAI-/DSO-Key. Schutz entsteht durch verifizierte Anmeldung, serverseitige Freigabeliste, Firestore-Regeln und IAM; Anbieter-Keys gelangen nicht in die statischen Assets.

### App-eigener Testzugang ohne Postfach

Die Anmeldeseite bietet zusätzlich **TestUser02 + Passwort**. Das Konto wird von Firebase Authentication verwaltet und funktioniert geräteübergreifend; es ist kein nur im Browser gespeichertes Konto. Ein echtes E-Mail-Postfach oder Google-Konto ist nicht nötig. Firebase E-Mail/Passwort verlangt intern eine E-Mail-förmige Kennung: `testuser02@planview-ecf9b.invalid`. Die reservierte `.invalid`-Adresse dient ausschließlich dieser internen Zuordnung. Auf der Website wird nur der Benutzername eingegeben.

1. Firebase Authentication → Anmeldemethode → **E-Mail-Adresse/Passwort** aktivieren; **E-Mail-Link** bleibt aus.
2. Unter Nutzer → Nutzer hinzufügen die interne Kennung eintragen. Der Eigentümer setzt und bestätigt das Passwort selbst direkt bei Firebase. Niemals in Chat, Quellcode, Deployment-Parameter oder Git eintragen.
3. Die von Firebase erzeugte **UID** dieses Kontos als `PLANVIEW_TEST_USER_UID` in `firebase/deployment-settings.json` eintragen und Frontend/Function gemeinsam deployen. Die UID ist eine öffentliche Kontokennung, kein Passwort. Ein leerer Wert deaktiviert den Testzugriff.
4. Das Backend akzeptiert nur genau diese UID, die interne Kennung und den verifizierten Firebase-Anbieter `password`. Andere unbestätigte E-Mail-Konten erhalten keine Ausnahme. Der allgemeine Zugriff für das Besitzerkonto verlangt weiterhin eine bestätigte E-Mail.
5. TestUser02 verwendet die zentral vom Besitzer gespeicherten Verbindungen. Die Schlüsselwerte bleiben ausschließlich auf dem Server. Die API verweigert dem Testnutzer das Ändern oder Löschen der Keys, auch bei direkten API-Aufrufen. Abrechnung der Anbieter läuft über die zentralen Keys; Nutzungslimits bleiben pro Nutzer getrennt.

Für den Freund genügt die Live-Adresse, der Benutzername **TestUser02** und das vom Eigentümer gesetzte Passwort. Kein Firebase-Konsolenzugang und kein eigenes Postfach erforderlich. Die gewünschten Anbieter-Keys einmal als Besitzer zentral speichern; sie müssen dem Freund nicht separat geschickt werden.

Die zentrale Zuordnung wird ausschließlich durch `PLANVIEW_CREDENTIAL_OWNER_UID` festgelegt: `fRosTqQICMhB0TW2UfqkC082xGH2`, das verifizierte Google-Konto `hirsch.danny@gmx.de`. Eine vom Browser übermittelte Besitzerkennung wird nicht akzeptiert. Credentials bleiben unter dieser Besitzeridentität mit AES-GCM gebunden. Vorhandene frühere Nutzer-Keys werden weder gelesen noch migriert oder gelöscht; im zentralen Modus verwendet das Backend die Besitzer-Verbindungen. Ein leerer Parameter stellt den bisherigen getrennten Kontomodus wieder her. Dieser Parameter ist keine API-Geheimnisdatei. Änderungen an den zentralen Key-Werten über die App brauchen kein neues Deployment.

Es gibt keine öffentliche Registrierung und keinen E-Mail-Passwortreset in unserer Oberfläche. Die interne Kennung ist kein zustellbares Postfach. Selbst falls jemand außerhalb unserer Oberfläche ein anderes Firebase-Konto erstellt, lässt ihn die serverseitige Freigabeliste nicht zu. Wird das Testkonto gelöscht und neu angelegt, ändert sich seine UID: bewusst neu freigeben; gespeicherte Keys werden nicht automatisch übertragen. Passwörter werden weder im App-Code verglichen noch in Firestore gespeichert; Firebase übernimmt die Passwortprüfung.

## 6. Admin-Monitoring

Die Oberfläche zeigt zuerst vier Kennzahlen: KI-Prompts, bekannte geschätzte OpenAI-Kosten, mittlere Serverzeit und fehlgeschlagene Anfragen. Nutzer und Zeitraum (heute, sieben oder 14 UTC-Kalendertage) filtern diese vollständigen Summen. Der Zeitraum richtet sich nach dem geladenen Stand; Aktualisieren lädt bewusst einen neuen Stand. Kostenlücken bleiben mit „+ ?“ und einem sichtbaren Hinweis erkennbar. Technische Erläuterungen sowie die Tages-/Nutzeraufschlüsselung sind zugeklappt.

Das Anfragenprotokoll zeigt jeweils zehn Einträge mit sechs Spalten. Funktion, Ergebnis und einfache Textsuche gelten nur für die höchstens 100 geladenen letzten Ereignisse; sie verändern nicht die vollständigen Kennzahlen oben. Die Suche kombiniert Wörter zu Nutzer, Funktion, API-Pfad oder HTTP-Code, ohne Prompttexte zu durchsuchen. Sortierung: neueste/älteste, höchste bekannte Kosten oder längste Serverzeit. Bauantragshistorie, Bauantragssuche, DSO-Regelverweise, Planmetadaten und Systemabfragen sind getrennt benannt. Aufklappen einer Funktion zeigt Tokens, HTTP-Code, API-Pfad und Kostenunsicherheit. „Tabelle zurücksetzen“ löscht nur die Tabellenfilter. Der Export neben der Tabelle enthält alle passenden geladenen Ereignisse, auch über mehrere Seiten; der vollständige Nutzungs-CSV unter den Erfassungsdetails enthält die vollständigen Summen für Nutzer und Zeitraum. Beide Exporte nennen ihren Umfang ausdrücklich.

Im Firebase-Build erhält ausschließlich die konfigurierte Besitzer-UID (`hirsch.danny@gmx.de`) den zusätzlichen Reiter **Settings → Monitoring**. Der Server prüft die Besitzer-UID auch bei direkten Aufrufen von `GET /api/admin/monitoring`; TestUser02 erhält 403. Es wird keine neue Kontofreigabe, IAM-Rolle oder zusätzliche Anbieter-Berechtigung eingerichtet.

Die Ansicht umfasst die letzten **14 UTC-Kalendertage** einschließlich heute: Backend-API-Aufrufe, tatsächlich gestartete OpenAI-Responses-Aufrufe, gemeldete Eingabe-/Cache-/Ausgabe-/Reasoning-Tokens, Server-Bearbeitungszeiten, HTTP-Fehler und geschätzte OpenAI-Kosten in USD. Ein Bauantrags-Intent und seine Antwort zählen als zwei KI-Aufrufe, wenn beide gestartet wurden. Status-/Verbindungsabfragen zählen als Backend-Aufrufe; Dashboard-Abfragen selbst sind ausgenommen. Öffentliche Kartenabrufe direkt aus dem Browser und Nutzung außerhalb dieses Firebase-Backends werden nicht erfasst. Reasoning-Tokens sind Teil der Ausgabe-Tokens und werden nicht doppelt berechnet.

Die Kostenrechnung verwendet den datierten Preiskatalog in `firebase/functions/request-meter.mjs`, tatsächliche gemeldete Cache-Nutzung und bekannte Verarbeitungstarife. Nicht bepreiste Modelle/Tarife sowie fehlende oder ungültige Tokenangaben bleiben ausdrücklich unbekannt. Angezeigte Kosten sind eine Schätzung bekannter OpenAI-Nutzung, keine Rechnung: Firebase-/Google-/DSO-Kosten, Guthaben, Steuern und andere Anwendungen sind nicht enthalten. Quellen: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [Responses-Nutzungsfelder](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create), [Prompt-Caching](https://developers.openai.com/api/docs/guides/prompt-caching).

Private Firestore-Sammlungen `planview_monitor_events`, `planview_monitor_daily` und `planview_monitor_meta` enthalten ausschließlich erlaubte Metadaten und feste Nutzerbezeichnungen. Prompt-/Antworttexte, Adressen, Koordinaten, API-Keys, Header, rohe Fehlertexte und Firebase-Nutzerkennungen werden nicht hineingeschrieben. Ereignis und Tages-/Nutzersummen werden atomar und gegen doppelte Ereignis-IDs gesichert gespeichert. Die letzten 100 Einzelereignisse sind begrenzt; die Tages-/Nutzersummen bleiben vollständig. CSV exportiert genau diese Metadaten und vollständige Summen. Direkte Browserzugriffe bleiben durch die vorhandenen Firestore-Regeln gesperrt.

Die Erfassung beginnt mit den ersten Aufrufen nach Veröffentlichung; ältere Nutzung wird nicht rekonstruiert. Es gibt kein Polling, keine Automation und keine Lösch-/TTL-Richtlinie. Die Ansicht ist auf 14 Tage begrenzt; das ist keine automatische Speicherlöschung. Ein Logging-Fehler ersetzt kein erfolgreiches Suchergebnis; er erzeugt nur eine feste Diagnose `planview_monitor_write_failed`. Abbrüche vor Abschluss oder fehlende Provider-Nutzungsdaten können die Erfassung unvollständig lassen. Das Monitoring selbst benötigt zusätzliche Firestore-Lese-/Schreibvorgänge. Der Preiskatalog muss bei Tarifänderungen bewusst aktualisiert werden.

## 7. Wochenlimit für TestUser02

Nur die fest konfigurierte Testnutzer-UID erhält **150 KI-Suchanfragen pro Kalenderwoche**. Die Besitzer-UID bleibt unbegrenzt. Eine Woche beginnt montags um 00:00 Uhr in `Europe/Amsterdam`; Sommer-/Winterzeit wird berücksichtigt. Das Limit gilt geräteübergreifend und wird im Backend über Firestore-Transaktionen durchgesetzt. Browserdaten zu löschen oder die Anzeige zu umgehen setzt es nicht zurück.

Gezählt werden abgeschickte Anfragen an `/api/interpret`, `/api/rules/search`, `/api/permits/search` sowie der KI-Verbindungstest `/api/ai/test`, sobald mindestens ein OpenAI-Aufruf versucht wurde. Eine Bauantragsfrage mit Intent- und Antwort-Aufruf zählt als **eine Suche**, im Monitoring aber als **zwei KI-Prompts**. Kartenklicks, Adresssuche, Bauantragshistorie, DSO-Verweise, RP-Metadaten und Suchversuche ohne KI-Aufruf verbrauchen keine Wochenplätze. Ein fehlgeschlagener OpenAI-Aufruf zählt, weil der Anbieter ihn möglicherweise berechnet. Die bestehenden kurzfristigen Anfragelimits gelten zusätzlich.

Der Server reserviert vor jeder möglichen KI-Suche atomar einen Platz und gibt ihn bei null OpenAI-Versuchen zurück. Gleichzeitige Anfragen überschreiten die 150 Plätze nicht. Bei Ausfall der Quota-Datenbank beginnt keine weitere kostenpflichtige Suche; ein abgebrochener Prozess oder fehlgeschlagener Rückerstattungs-Schreibvorgang behält den reservierten Platz vorsichtshalber bei. Bei ausgeschöpftem Limit folgt HTTP 429 mit `weekly_search_limit`. Das ist ein Suchanfragenlimit und kein fester Geldbetrag oder OpenAI-Rechnungslimit.

Eine kleine Anzeige oben rechts in der Kopfzeile zeigt dem Testnutzer die übrigen Plätze und per Aufklappen den Rücksetzzeitpunkt. Bei null Plätzen verweist sie an den Besitzer. `GET /api/quota` liefert ausschließlich das Kontingent des authentifizierten Nutzers; es gibt keine öffentliche Zurücksetzen-/Erhöhen-Schnittstelle. Die privaten Sammlungen `planview_weekly_quota` und `planview_weekly_reservations` enthalten nur gehashte Nutzerkennungen, Kalendergrenzen, Zähler und zufällige Reservierungskennungen, keine Suchtexte oder Keys. Bestehende Browserregeln verweigern direkten Zugriff. Es werden weder neue IAM-Rechte noch eine Automation oder Löschrichtlinie eingerichtet.

## 8. Feedback vom Testnutzer

Der Abruf sortiert nach Erstellungsdatum absteigend und anschließend nach Dokument-ID. So nutzt er den vorhandenen automatischen Firestore-Feldindex; eine reine absteigende Dokument-ID-Abfrage scheiterte im Liveprojekt mit fehlendem Index. Der Cursor enthält Zeit und ID, damit auch mehrere Notizen mit identischem Zeitstempel ohne Lücken oder Duplikate paginiert werden. Die Korrektur benötigt weder neue Indizes noch Datenänderungen.

Im Firebase-Build sieht TestUser02 oben rechts in der Kopfzeile eine lilafarbene **Feedback**-Schaltfläche direkt neben Kontingent und Konto. Eine kurze Animation macht sie beim Erscheinen sichtbar; es gibt keine Endlosschleife. Beim Klick blendet ein kleines, am Header verankertes Widget ein. Die übrige Seite bleibt nutzbar. Das Fenster fragt nur nach einer Notiz (höchstens 3.000 Zeichen). Eine Kategorie ist freiwillig: Ohne Kategorie, Oberfläche, Suche, Regeln, Bauanträge, Karte, Idee/Verbesserung oder Sonstiges. Entwürfe bleiben während dieser geöffneten Seite bei Schließen oder einem Sendefehler erhalten. Nach bestätigtem Speichern erscheint eine Bestätigung; nach 1,2 Sekunden schließt das Widget automatisch. Bei Fehlern bleibt es offen. Escape und ein Klick außerhalb schließen es ebenfalls. „Bewegung reduzieren“ deaktiviert Animationen. Es werden keine Screenshots, Standorte, Suchverläufe oder Seiteninhalte automatisch angehängt und keine KI-Aufrufe ausgelöst; Feedback verbraucht kein Suchkontingent.

Der Besitzer findet die Notizen unter **Einstellungen → Testnutzer-Feedback**, jeweils mit Datum, Kategorie und vollständigem Text. Neue Einträge stehen oben. Die Liste lädt beim Öffnen oder Aktualisieren, mit jeweils 50 Einträgen und „Mehr laden“ für ältere Notizen. Der Kategoriefilter bezieht sich ausdrücklich auf die geladenen Einträge. Der Besitzer kann Kategorien nachträglich ändern; Originaltext und ursprüngliches Datum bleiben erhalten. Testertexte werden als reiner Text angezeigt, sodass eingefügtes HTML nicht ausgeführt wird.

`POST /api/feedback` erlaubt nur die fest konfigurierte Testnutzer-UID. `GET /api/admin/feedback` und die Kategorienänderung per `POST /api/admin/feedback` verlangen serverseitig die bestehende Besitzer-UID. Der Client kann keine fremde Nutzerkennung übermitteln. Firestore-Sammlungen `planview_test_feedback`, `planview_feedback_submissions` und `planview_feedback_limits` bleiben für direkte Browserzugriffe gesperrt. Der Inhalt ist über die App nur für den Besitzer lesbar; es werden keine zusätzlichen Konten oder IAM-Rechte freigegeben.

Jeder bewusste Sendevorgang erhält eine zufällige Kennung. Wiederholungen derselben Notiz nach einem Verbindungsfehler speichern sie atomar nur einmal; geänderte Inhalte brauchen eine neue Kennung. Ein eigener Schutz begrenzt neue Notizen auf 20 pro rollierender Stunde und zählt Wiederholungen nicht nochmals. Das Feedback bleibt außerhalb des KI-Metadatenprotokolls und des Wochenlimits. Es gibt keine automatische Benachrichtigung, KI-Kategorisierung, Löschrichtlinie oder wiederkehrende Automation.

### Bewertungen einzelner Suchen

TestUser02 sieht nach einer abgeschlossenen Standort-, Regel- oder Bauantragssuche direkt unter dem Ergebnis die Frage „War diese Suche hilfreich?“ mit Daumen hoch/runter. Daumen hoch speichert sofort. Daumen runter öffnet eine freiwillige Begründung (höchstens 1.500 Zeichen) und einen ausdrücklichen Senden-Knopf. Eine noch nicht gesendete Begründung kann abgebrochen werden. Die Auswahl bleibt während des Speicherns gesperrt; nach Bestätigung erscheint ein Danke-Hinweis. Ein unklarer Versand kann mit exakt derselben Bewertung wiederholt werden, ohne sie doppelt zu speichern. Neue Suchen, Abbruch und Grundstückswechsel entfernen die zum vorherigen Ergebnis gehörenden Bedienelemente; ein Sprachwechsel bindet dieselbe Bewertung wieder ein.

Die Standortsuche bietet die Bewertung erst nach der tatsächlichen Kriterienprüfung an, nicht schon nach der KI-Interpretation einer Frage. Regel- und Bauantragssuchen bewerten nur ausdrücklich abgeschickte Fragen. Automatisches Laden der Bauantragshistorie, Kartenklicks und lokale Ergebnisfilter erzeugen keine Bewertung. Leere, teilweise und fehlgeschlagene aktuelle Suchläufe können bewertet werden; abgebrochene oder veraltete Antworten erhalten keine neuen Daumen.

Der Admin findet unter Einstellungen → Testnutzer-Feedback die getrennten Bereiche „Allgemeine Hinweise“ und „Suchbewertungen“. Bewertungen zeigen Zufriedenheit, Suchart, Datum und die gegebenenfalls geschriebene Begründung. Ergebnisstatus, Ergebniszahl und eine zufällige Suchreferenz sind aufklappbar. Der Zufriedenheitsfilter gilt für die geladenen Einträge; jeweils 50 weitere Bewertungen lassen sich nachladen. Kategorien und Entwürfe der allgemeinen Notizen bleiben beim Wechsel erhalten.

POST /api/search-feedback erlaubt ausschließlich die fest konfigurierte Testnutzer-UID. GET /api/admin/search-feedback verlangt die bestehende Besitzer-UID. Pro Suchreferenz wird eine endgültige Bewertung gespeichert; exakte Wiederholungen derselben Sendung liefern denselben Beleg zurück. Ein eigenes Limit von 60 Bewertungen pro Stunde schützt die Ablage. Bewertungen verbrauchen kein KI-Suchkontingent und erzeugen weder KI-Aufrufe noch normale Monitoring-Ereignisse. Die privaten Firestore-Sammlungen planview_search_feedback, planview_search_feedback_submissions, planview_search_feedback_searches und planview_search_feedback_limits nutzen die vorhandenen Rechte und gesperrten Browserregeln. Automatische Such-/Antworttexte, Adressen oder Quelleninhalte werden nicht gespeichert; die Begründung ist bewusst eingegebener Feedbacktext. Keine neue IAM-Freigabe, kein neuer Index und keine Automation.

## 9. Konto und Profil in der Kopfzeile

Die Firebase-Kopfzeile enthält rechts das angemeldete Konto mit Avatar, Name und Rolle. Auf schmalen Bildschirmen wird die Kontoschaltfläche zum Avatar verkürzt; der zugängliche Name und das Menü nennen weiterhin das vollständige Konto. Das Kontomenü bietet **Mein Profil** und **Abmelden**. Das Profil zeigt Name, Rolle und bei einem echten Google-Konto dessen E-Mail-Adresse. Die technische `.invalid`-Kennung des Testkontos wird nicht angezeigt. Das Profil ist eine schreibgeschützte Ansicht des zentral verwalteten Kontos; Namen, Zugangsdaten und Berechtigungen werden hier nicht geändert.

Kontingent und Feedback werden in eigene Header-Plätze eingebunden. Es gibt keine dauerhaft über der Karte liegende Konto-/Abmelde-/Feedback-Leiste mehr. Die Kopfzeile bleibt im normalen Seitenlayout: ab 1680 Pixeln einzeilig, auf mittleren Desktopbreiten zweizeilig und auf Mobilgeräten dreizeilig. Suche, Sprache, Einstellungen und die bestehende mobile Navigation bleiben erreichbar. Aufgeklappte Menüs erscheinen nur bei bewusster Bedienung und schließen per Außenklick oder Escape. Änderungen betreffen nur den Firebase-Build; lokale Anmeldung, Firestore-Daten und Backend-Rechte bleiben erhalten.

## 10. GitHub automatisch deployen

GitHub Desktop ist wieder mit `/Users/uhorizon/Documents/ChatGPT/InteractiveMap/app` verbunden. Remote ist `bbyw2hrnf6-boop/PlanView-Plankaart`, Branch `main`. Nicht das äußere InteractiveMap-Repository und nicht `deploy/site` veröffentlichen. Vorhandene lokale Änderungen und acht ältere, noch nicht gepushte Commits sind erhalten; Änderungen vor einem Commit prüfen. Ein großer alter Veröffentlichungs-TAR unter maintenance bleibt lokal und wird ignoriert.

1. Erst das manuelle Deployment aus Schritt 4 erfolgreich abschließen. Es legt Laufzeitkonto und Secret-Bindung an.
2. `firebase/setup-github-oidc.sh` lesen. Es legt ein Deployment-Dienstkonto an, vergibt die für Hosting, Functions und Regeln nötigen Projektrollen und beschränkt den OIDC-Vertrauenspfad auf **dieses Repository und refs/heads/main**. Wer Schreibrechte auf main/Workflow hat, kann damit Backend-Code deployen; Branch-Schutz und GitHub-Environment-Review sind sinnvoll. Keine Owner-/Editor-Projektrolle wird an GitHub vergeben.
3. Im Terminal mit Google Cloud CLI ausführen, nachdem du diese Zugriffsrechte freigegeben hast:

```sh
bash firebase/setup-github-oidc.sh --apply
```

4. GitHub-Repository → Settings → Environments → **firebase-production** anlegen. Falls angeboten, Reviewer und Branch `main` als Schutz setzen.
5. Settings → Secrets and variables → Actions → **Variables**: die drei vom Skript ausgegebenen Werte anlegen:
   - `FIREBASE_PROJECT_ID`
   - `GCP_DEPLOY_SERVICE_ACCOUNT`
   - `GCP_WORKLOAD_IDENTITY_PROVIDER`
6. Über GitHub Desktop die geprüften App-Änderungen samt Firebase-Dateien committen und **Push origin**. Die vorbereitete Action läuft bei Push auf main oder manuell unter Actions. Sie überspringt das Deployment, solange die drei Variablen fehlen. API-Anbieter-Keys gehören weder in GitHub Secrets noch in diese Variablen; sie bleiben zentral verschlüsselt in Firestore. Der Secret-Manager-Hauptschlüssel bleibt bei Google. Die tatsächliche Aktivierung ist noch offen: insbesondere Build-Dienstkonto und Container-Aufbewahrung vorab klären; das aktuelle Standard-Buildkonto besitzt bestehende Editor-Rechte und soll nicht ungeprüft für GitHub delegiert werden.
7. Actions-Lauf und Deployment-Ergebnis kontrollieren, anschließend die Hosting-Seite neu laden. Ein Push, der nur eine alte GitHub-Pages-Veröffentlichung aktualisiert, ist kein Firebase-Deployment. Das alte Pages-Setup ist unabhängig und kann später bewusst deaktiviert werden.

Nicht zusätzlich `firebase init hosting:github` ausführen: dessen Standardworkflow veröffentlicht primär Hosting und verwendet oft einen Service-Account-JSON-Key. Die vorbereitete Action veröffentlicht auch das Backend und verwendet OIDC.

## Dateien und lokale Prüfung

- `.firebaserc`, `firebase.json`: Projekt, Hosting, Functions, Firestore.
- `firebase/browser/`: Firebase-Anmeldung und gezielter Fetch-Transport nur für eigene API-Pfade.
- `firebase/functions/`: Auth-/Origin-Gateway, Firestore-Transaktionsadapter, Function-Einstieg.
- `cloud/lib/`: eine gemeinsame fachliche Suchlogik für das bisherige Hosting und Firebase.
- `tools/firebase_release.py`: überprüfte Browser-Assets kopieren und Firebase-spezifische Anmeldung ausschließlich in den generierten Build einfügen. Kein Kopieren von lokalen Python-Servern, Schlüsseln, Browserdaten oder Codex-Logins.
- `.firebase-build/`, `firebase/functions/generated/`, node_modules und lokale Environment-/Schlüsseldateien sind ignoriert. Die Lockdateien gehören in Git.
- `tests/firebase-*.test.mjs`: verifizierte Identität, Freigabeliste, CORS, Größenlimit, getrennte verschlüsselte Credentials, gleichzeitige Anfragen/Leases, Tokenweitergabe ausschließlich an eigene API.

Lokaler Start bleibt der vorhandene Launcher auf http://127.0.0.1:4174/. Die Firebase-Vorbereitung benötigt keinen Neustart des lokalen Servers und verändert seine gespeicherten Keys nicht.

## Offizielle Referenzen

- https://firebase.google.com/docs/hosting/serverless-overview
- https://firebase.google.com/docs/hosting/functions
- https://firebase.google.com/docs/functions/config-env
- https://firebase.google.com/docs/auth/admin/verify-id-tokens
- https://firebase.google.com/docs/hosting/reserved-urls
- https://firebase.google.com/docs/projects/iam/permissions
- https://github.com/google-github-actions/auth
- https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines

### Reproduzierbare Parameter
`firebase/deployment-settings.json` enthält die öffentliche API-Freigabeliste, die konkrete Testnutzer-UID, die Besitzer-UID für zentrale Keys und zusätzliche erlaubte Ursprünge. `prepare` erzeugt daraus die ignorierte `.env.planview-ecf9b` mit ausschließlich diesen vier nicht geheimen Werten. Anbieter-Keys gehören dort nicht hinein. Die Firebase-Tokenprüfung validiert Signatur, Ablauf, Aussteller und Zielprojekt sowie gesperrte/widerrufene Sitzungen. Die serverseitige Kontofreigabe wird bei jedem API-Aufruf geprüft.
