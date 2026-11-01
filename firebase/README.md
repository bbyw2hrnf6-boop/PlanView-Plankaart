# Planview auf Firebase

Stand: 1. November 2026. Verbindlicher Quellcode ist dieser Git-Checkout `InteractiveMap/app`, verbunden mit `https://github.com/bbyw2hrnf6-boop/PlanView-Plankaart`. Der GitHub-Repository-Stamm ist **app/**, nicht der äußere Ordner InteractiveMap. Das frühere lokale Verzeichnis `Documents/PlanView Plankaart` wird nicht neu angelegt.

## Bereits vorbereitet

- Firebase-Projekt **planview-ecf9b**, Web-App **Planview Web** registriert. Google-Anmeldung ist aktiviert; beide Hosting-Domains sind autorisiert. Firestore `(default)` ist in `europe-west1` mit privaten Produktionsregeln erstellt.
- Projektkonsole: https://console.firebase.google.com/project/planview-ecf9b/overview
- Spätere Hosting-Adresse: https://planview-ecf9b.web.app/ — erst nach erfolgreicher Veröffentlichung live.
- Hosting, Node.js-22-Function `planviewApi` in `europe-west1`, Google-Anmeldung und Firestore-Anbindung vorbereitet.
- Backend-Zugriff zunächst nur für das verifizierte Google-Konto **hirsch.danny@gmx.de**. Die öffentliche Hosting-Adresse liefert die Anmeldeseite sowie öffentliche Karten-/App-Dateien; sensible APIs sind unabhängig davon geschützt. Hosting allein ist keine Zugriffssperre für die statischen Dateien.
- API-Schlüssel werden über die vorhandenen App-Einstellungen pro Firebase-Benutzer gespeichert: AES-GCM-verschlüsselt in Firestore. Der separate Hauptschlüssel liegt in Google Secret Manager und wird nur der Function bereitgestellt. Firestore-Regeln verbieten sämtliche direkten Browserzugriffe, auch auf verschlüsselte Schlüssel.
- GitHub-Actions-Datei `.github/workflows/firebase-deploy.yml` vorbereitet. Anmeldung bei Google erfolgt über kurzlebige OIDC-Tokens, ohne heruntergeladene Service-Account-Schlüsseldatei und ohne OpenAI-/DSO-Keys in GitHub.
- Lokale App, bestehende Sites-Veröffentlichung, alte Keys und Git-Historie bleiben erhalten. Firebase übernimmt den aktuellen kanonischen App-Code beim Bauen. Keys aus dem Mac oder der alten Sites-Datenbank werden nicht migriert; später in Firebase erneut eingeben.

## 1. Abrechnung und Anmeldung in Firebase

1. In der Projektkonsole kontrollieren, dass oben **Planview / planview-ecf9b** ausgewählt ist.
2. **Spark → Upgrade → Blaze**. Bestehendes Abrechnungskonto auswählen. Dies gilt pro Projekt: ein anderes Blaze-Projekt schaltet dieses Projekt nicht frei. Google kann für Functions, Firestore, Builds, gespeicherte Container und Übertragung Kosten berechnen. Ein Budget mit E-Mail-Warnung einrichten; Budget-Warnungen sind **keine harte Kostensperre**.
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

Der Hauptschlüssel ist kein OpenAI-Key. Er verschlüsselt die später von jedem Benutzer gespeicherten Anbieter-Keys.

```sh
openssl rand -base64 32 | ./firebase/node_modules/.bin/firebase functions:secrets:set PLANVIEW_CREDENTIAL_KEY --project planview-ecf9b --data-file -
```

Der generierte Wert geht direkt über stdin zu Secret Manager, ohne eine Datei oder Ausgabe im Terminal. **Nur einmal erzeugen. Bestehenden Wert nicht bei jedem Deployment ersetzen.** Sonst lassen sich bisher gespeicherte Anbieter-Keys nicht mehr entschlüsseln. Zugriff über Google-IAM begrenzen. Reguläre GitHub-Deployments erzeugen oder rotieren diesen Schlüssel nicht.

## 4. Laufzeitrechte und erstes Deployment

Die Function nutzt das dedizierte Laufzeitkonto `planview-runtime@planview-ecf9b.iam.gserviceaccount.com`. Es erhält Firestore-Lese-/Schreibrechte im Projekt und ausschließlich für `PLANVIEW_CREDENTIAL_KEY` Zugriff auf den Secret-Wert. Diese dauerhaften IAM-Rechte müssen vor Einrichtung ausdrücklich freigegeben sein. Mit Google Cloud CLI als Projektbesitzer, bei Bedarf auch in Cloud Shell:

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
./firebase/node_modules/.bin/firebase deploy --project planview-ecf9b \
  --only functions:planview,firestore:rules,firestore:indexes,hosting
```

Bei der ersten Bereitstellung können Google-APIs automatisch aktiviert werden. Deployment-CLI-Dialoge lesen, insbesondere Kosten und Aufbewahrung von Build-Artefakten. Ein erfolgreicher CLI-Abschluss muss **Function, Firestore-Regeln und Hosting** bestätigen. Keine reine Hosting-Veröffentlichung als funktionsfähiges KI-Backend ausgeben.

Die App verwendet für längere API-Anfragen den authentifizierten direkten HTTPS-Endpunkt der Function. Das umgeht das 60-Sekunden-Limit von Firebase Hosting. Die Function selbst hat 300 Sekunden, keine warm gehaltene Mindestinstanz und höchstens drei Instanzen; Such- und Benutzerlimits bleiben zusätzlich aktiv. Ein abgebrochener Browseraufruf garantiert nicht, dass bereits gestartete Providerarbeit kostenfrei abgebrochen wird.

## 5. Live prüfen und Anbieter-Keys hinterlegen

1. https://planview-ecf9b.web.app/ öffnen.
2. Mit dem freigegebenen Google-Konto anmelden.
3. Einstellungen → Verbindungen: OpenAI-API-Key eintragen, speichern, Verbindung testen.
4. DSO-Key eintragen, wenn die aktuellen DSO-Regeltexte abgefragt werden sollen. Optionalen Routing-Key separat über die bestehende Routen-/Vergleichsverbindung hinterlegen.
5. Grundstück anklicken: nur Grundstück markieren; bekannte Adresse im Kopf und Bauantragsverlauf prüfen. Eine KI-Frage und eine Regeltextfrage testen.
6. In zweitem Browser mit anderem Konto prüfen: Backend-Zugriff muss abgewiesen werden. Fremde Konten nutzen nicht deinen OpenAI-Key.
7. Dasselbe freigegebene Konto auf anderem Gerät darf seine gespeicherten Cloud-Keys wiederverwenden. Notizen/Merkliste bleiben derzeit im jeweiligen Browser; keine automatische gemeinsame Falldatenbank.

PDOK und KOOP brauchen hierfür keinen neuen Anbieter-Key. Die lokale Codex-Anmeldung sowie die macOS-PDFKit-/Vision-OCR stehen in Firebase nicht zur Verfügung. Die Cloud-Bauantragssuche nutzt veröffentlichte Bekanntmachungstexte und kennzeichnet ungelesene Anlagen. Eine vollständige serverseitige PDF-/OCR-Pipeline ist ein eigenes Folgeprojekt; Firebase allein aktiviert sie nicht.

Der im Browser sichtbare Firebase-Web-Konfigurationswert `apiKey` ist eine öffentliche Projektkennung für das Firebase-SDK. Er ist **nicht** der geheime OpenAI-/DSO-Key. Schutz entsteht durch verifizierte Anmeldung, serverseitige Freigabeliste, Firestore-Regeln und IAM; Anbieter-Keys gelangen nicht in die statischen Assets.

## 6. GitHub automatisch deployen

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
6. Über GitHub Desktop die geprüften App-Änderungen samt Firebase-Dateien committen und **Push origin**. Die vorbereitete Action läuft bei Push auf main oder manuell unter Actions. Sie überspringt das Deployment, solange die drei Variablen fehlen. API-Anbieter-Keys gehören weder in GitHub Secrets noch in diese Variablen; sie bleiben im Benutzerkonto der Web-App. Der Secret-Manager-Hauptschlüssel bleibt bei Google.
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
`firebase/deployment-settings.json` enthält die öffentliche API-Freigabeliste und zusätzliche erlaubte Ursprünge. `prepare` erzeugt daraus die ignorierte `.env.planview-ecf9b` mit ausschließlich diesen zwei nicht geheimen Werten. Anbieter-Keys gehören dort nicht hinein. Die Firebase-Tokenprüfung validiert Signatur, Ablauf, Aussteller und Zielprojekt sowie gesperrte/widerrufene Sitzungen. Für die Sperrprüfung braucht das Laufzeitkonto zusätzlich die ausdrücklich freizugebende Berechtigung `firebaseauth.users.get`; dafür ist eine schmale Projektrolle `planviewTokenVerifier` vorgesehen. Die serverseitige E-Mail-Freigabeliste wird ebenfalls bei jedem API-Aufruf geprüft.
