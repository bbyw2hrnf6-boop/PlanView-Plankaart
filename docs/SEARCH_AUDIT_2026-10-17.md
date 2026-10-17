# Such-Audit und Standort-Regelsuche · 17. Oktober 2026

Implementiert: explizite KI-Distanzregeln mit Minimum/Maximum und Meterumrechnung; Ortsanforderung gegen Suchraum geprüft; echte Polygonabstände für verfügbare Geometrien; Extent-Abstände als ungewisse Prüfung; Context-Radius passend zu editierten Grenzen; getrennte Baufenster; BAG-Polygonabstand; neue DSO-Textsuche je ausgewähltem Punkt. KI-Antworten brauchen existierende Quell-IDs, wörtliche Textbelege und passende Zahlen. DSO-Webschlüssel werden getrennt je Konto verschlüsselt gespeichert; keine lokalen Schlüssel werden synchronisiert.

Offen: vollständige Parzellenprüfung statt einzelner Punkte; IMRO/TAM-Altregeltexte zusätzlich zum DSO-Korpus; externe Verweise/Anlagen; Schutzgebiets-, Projekt- und NOVEX-Daten sind bisher Kontextlayer und keine automatischen Ausschlussfilter; landesweite Suche bleibt eine Stichprobe. Die neue Regelsuche ersetzt keine vollständige Genehmigungsprüfung.

DSO-Abruf: aktuelle Dokumentstruktur plus punktgefilterte Annotationen, inkl. nationalem Bbl. Maximal zwölf Instrumente und 60 Sekunden Quellenabruf; nicht geladene Dokumente sind ausdrücklich markiert. Direkt zugeordnete Texte, Behörden-Instruktionen und unbestätigter Dokumentkontext bleiben unterscheidbar. KI-Modell unverändert GPT-6 Luna / High.

Amtliche Spezifikation: https://developer.omgevingswet.overheid.nl/api-register/api/omgevingsdocument-presenteren/

Die folgenden Befunde dokumentieren den Zustand vor den oben genannten Korrekturen. Größere offene Punkte bleiben als nächste Ausbaustufen erhalten.

# PlanView: Audit von Suche, Filtern und Daten

Audit-Ausgangsstand: 17. Oktober 2026. Geprüft wurde die kanonische App unter `/Users/uhorizon/Documents/PlanView Plankaart`. Die folgenden Zeilennummern beziehen sich auf den Stand **vor** den für diesen Audit vorbereiteten Änderungen. Beim ursprünglichen Audit wurden keine Schlüsselwerte gelesen und keine bezahlten KI-Aufrufe ausgeführt. Anschließend wurde die implementierte Regelsuche mit amtlichen Live-Texten und dem bestehenden lokalen Codex-Modell geprüft.

## Befund

Die Suche ist derzeit eine räumliche **Kandidatensuche an Stichprobenpunkten**. Eine KI übersetzt die Beschreibung in eine kleine feste Filterstruktur; danach prüfen JavaScript und PDOK die Punkte. Sie inventarisiert keine Grundstücke vollständig und entscheidet nicht über Baurechte. Gute vorhandene Eigenschaften sind das JSON-Schema, die Trennung zwischen kartierten Treffern und offenen Prüfungen, Polygon-Containment für Campingplätze und die direkte Zuordnung von Baufenster, Plan-ID und Geometrie. Die größten Präzisionsverluste entstehen zwischen Intent, Distanzstruktur und geometrischer Prüfung.

## Priorisierte Fehler

| Priorität | Befund mit Codebeleg | Auswirkung | Begrenzte Korrektur / Regressionstest |
|---|---|---|---|
| P1 | `smart-search.js:50–66` erkennt nur km und nur fünf Objektarten; `:62` setzt alle Distanzen aus Regex und Defaults neu. Das KI-Schema enthält weder Distanzwerte noch Operatoren. | „500 m vom Bahnhof“, „mindestens 2 km vom Bahnhof“, „zwischen 1 und 3 km“, „750 m vom Schwimmbad“ werden nicht korrekt ausgeführt. Ein Mindestabstand wird als Höchstabstand geprüft. | Striktes `distanceRules`-Objekt mit neun Typen, `minKm`/`maxKm`, Meterumrechnung. Validierte KI-Regeln beibehalten, Regex nur als Fallback. EN/NL/DE-, Meter-, Minimum-, Maximum- und Range-Fixtures. |
| P1 | `smart-search.js:328` berechnet Polygonabstände zur Bounding Box, nicht zum Polygon. `update_context.py:40–54,75` verwirft fast alle Polygongeometrien. | Punkte außerhalb konkaver Flächen oder in Löchern erhalten fälschlich 0 km. Nähe kann zu Unrecht bestätigt werden; Industrieabstand kann zu Unrecht einen Punkt ausschließen. | Erhaltene Camping-Geometrien bis zur Kante messen, Löcher und MultiPolygone beachten. Extent-only-Distanzen als unbestätigt führen. Test: Dreieck/BBox-Ecke und Loch. Später alle benötigten Kontextgeometrien räumlich gekachelt erhalten. |
| P1 | `smart-search.js:496` verwendet vorab geladenen Kontext erneut, ohne die tatsächlichen/editierten Distanzen zu vergleichen. `:332` verwendet begrenzte identische Winkel-Puffer für beide Achsen. | Nach einer Änderung von 3 auf 50 km fehlen weiter entfernte Objekte; an Nordgrenzen kann ein zu kleiner Längengradpuffer entstehen. | Nach Freigabe der Kriterien Kontext mit finalen Werten neu auswählen; Cache nach beiden Puffern. Test: Station außerhalb des kleinen und innerhalb des großen Radius. |
| P1 | `smart-search.js:527` dedupliziert nur nach Bestimmungsflächen-ID. | Mehrere verschiedene Baufenster in derselben Bestimmungsfläche verschwinden zu einem Treffer. IDs können außerdem in verschiedenen Planversionen vorkommen. | Schlüssel aus Plan-ID und Baufenster-ID, sonst Plan-ID und Bestimmungsflächen-ID. Test: gleiche Bestimmungsfläche, zwei Baufenster, zwei Planversionen. |
| P1 | `smart-search.js:263–277`: Ortsnamen wirken nur bei Suchraum „Gemeinde“; „Kartenansicht“ und „Provinz“ ignorieren einen im Text genannten anderen Ort. Die KI darf im aktuellen Schema keinen Suchraum zurückgeben. | „Grundstücke in Groningen“ kann im sichtbaren Maastricht-Ausschnitt ausgeführt werden. | Gewünschten Suchraum ausdrücklich auflösen und als prüfbare Suchraum-Karte zeigen; bei Widerspruch Rückfrage oder Wechsel anbieten. Nicht stillschweigend ignorieren. |
| P1 | `smart-search.js:514–517` prüft „unbebaut“ nur am einzelnen Stichprobenpunkt. Parzellen werden in der Flächensuche nicht inventarisiert. | Ein Punkt neben einem Haus im selben Grundstück kann als „kein Gebäude am Punkt“ gelten; das ist kein unbebautes Grundstück. Das vorhandene UI benennt den Punkt zwar, der Nutzerintent bleibt dadurch aber nur teilweise erfüllt. | Bei Intent „unbebautes Grundstück“ komplette Katasterparzelle plus alle schneidenden BAG-Pand-Geometrien prüfen; bis dahin explizite offene Grundstücksprüfung, keine Umdeutung zur bewiesenen Parzelleneigenschaft. |
| P2 | `smart-search.js:132` schneidet `unsupported` auf vier Einträge ab. `:63–66` löscht Einträge anhand breiter Wortmuster. | Weitere gewünschte Anforderungen verschwinden; z. B. Entfernungswarnungen zu einem nicht ausführbaren Ziel oder Teilanforderungen rund um Wohngebäude. | Alle bis zum validierten Limit erhalten; nur eine konkret ausführbare Anforderung durch ihre konkrete Evidenz ersetzen. Test: acht offene Anforderungen bleiben acht. |
| P2 | `cloud/lib/ai.mjs:58–60` und `server.py:102–106` aktivieren Industrie-Vermeidung allein durch „industry“ + „1.2 km“, ohne Negationsprüfung. | „Industrie innerhalb 1,2 km“ kann zu „mindestens 1,2 km Abstand“ werden. | Solche Nachkorrekturen entfernen oder nur nach gesicherter Relation aktivieren. Intent-Tests für positive/negative Nähe und Zahlengleichheit. |
| P2 | `smart-search.js:394–398` verwendet auch für BAG-Gebäude nur deren Bounding Box. Nach BAG-Prüfung ändern sich Review-Status, aber Score und Reihenfolge nicht (`:407–410`). | Zählung naher Wohngebäude kann falsch sein; inzwischen bestätigte Treffer stehen hinter offenen Kandidaten. | BAG-Geometrie bis zur Kante messen; Score und Status nach Evidenzprüfung gemeinsam neu berechnen. |
| P2 | `smart-search.js:290–292,347,363` ersetzt breite Suchräume durch 34.398 räumlich ausgewählte Baufenster, reduziert danach auf 3.000 und schließlich höchstens 80 Prüfpunkte. `update_bouwvlakken.py:174–185` hält je Zelle nur einen Status-/Datumsfavoriten. | Ein geeignetes Wohn-Baufenster kann bereits vor dem Wohnen-Filter verloren gehen. Ein Nullergebnis bedeutet nicht, dass kein geeignetes Grundstück existiert. | Breite Suche als Überblick benennen; bei Verfeinerung gezielt Originalkacheln laden. Für präzise Inventarsuche einen räumlichen Index mit Filter-Pushdown und paginierten Ergebnissen verwenden. Vollständigkeit separat anzeigen. |
| P2 | `app.js:138` setzt GetFeatureInfo auf 30 Objekte; `choosePrimary` (`:148`) nutzt eine heuristische Status-Punktzahl, keine vollständige Rechtsversionsprüfung. | Viele überlagerte Pläne können abgeschnitten werden. Ein alter bzw. allein historischer Treffer kann ohne strikt aktuelle Auswahl weiterverwendet werden. | Rückgabekappung erkennen, nicht geprüfte Rechtsversionen kennzeichnen. Historische Objektwerte normalisieren und explizit behandeln; Aktualität nicht aus UI-Rang ableiten. |
| P2 | `smart-search.js:552` bricht nur per Ticket ab; laufende Netzwerkanfragen laufen bis Timeout weiter. | Stoppen fühlt sich verzögert an; frühere Suche belegt Dienst- und Browserkapazität. | Einen AbortController je Suche bis zu WMS/BAG durchreichen; nach Stop keine weitere Batch beginnen. |

## Daten- und API-Inventar

| Quelle | Gegenwärtige Verwendung | Tatsächliche Aussagekraft / Lücke |
|---|---|---|
| PDOK Ruimtelijke plannen WMS; Atom-Bouwvlak-Auszug | Primäre Bestimmung, Baufenster, Planstatus/-verweise; räumliche Suchkandidaten | Der vorhandene Baufenster-Index enthält 1.897.137 Objekte, geladen am 17.10.2026; im Manifest steht Quellenstand **01.07.2026**. Nicht mit allen aktuellen Omgevingsplan-Regeln gleichsetzen. |
| PDOK Kadastrale Kaart WMS | Angeklickte Parzelle; Gebäudefläche am Suchpunkt | Der Suchablauf ist bisher keine vollständige Katasterparzellen-Suche; Eigentum, Verkauf und Preis werden nicht geliefert. |
| PDOK BAG OGC API v2 | Wohngebäude im Umfeld; erste 12 Kandidaten | Gebrauchsdoel und Pandstatus existieren im offiziellen Dienst. Bisher höchstens 1.000 Features je Anfrage; bei Folgeseite wird unvollständig markiert. Nicht bestätigte Kandidaten 13–40 bleiben offen. |
| TOP10NL-Snapshot | 3.812 Campingflächen, 3.383 Orte, 3.981 Industrieflächen; 2.163 Parks, 4.616 Sportanlagen, 4.154 Friedhöfe, 812 Schwimmbadkomplexe, 1.288 Marinas | Geladen am 17.10.2026. Camping-Geometrien bleiben erhalten, andere Kategorien werden auf Extents reduziert. TOP10NL beschreibt kartierte Topografie; fehlender Eintrag beweist keine Nichtexistenz. Nachbarschaft jenseits der Landesgrenze wird nicht erfasst. |
| ProRail Spoorwegen | 425 Bahnhofs-Punkte, als Kontext-Snapshot | Punktnähe, keine Fahrzeit, Zugfrequenz, Erreichbarkeit oder garantierte aktuelle Bedienung. |
| NNN-WMS und RIVM-Grundwasserschutz | Sichtbare Schutz-Layer | Aktuell **keine ausführbaren Suchfilter** im Suchschema. „Außerhalb Naturschutz/Grundwasserschutz“ darf nicht als erfüllt gelten. |
| Nationale Woningbouwkaart/LMVW | 8.166 öffentliche Projektpunkte | Kontextdarstellung; keine Suchfilterintegration. Datenlücken laut eigenem Manifest für Fryslân, Gelderland und Noord-Brabant; Groningen hat nur einen Punkt. Projektdaten sind keine genehmigte Bebaubarkeit. |
| Limburg-Siedlungsgrenze | Zusätzlicher Kontext-Layer | Nur Limburg; keine landesweite Siedlungsgrenzenabdeckung. |
| NOVEX, Plan-Zusatzbezeichnungen/Maße, DSO | Kartenebenen bzw. Standortverweise | Nicht alle sind ausführbare Suchkriterien. Die DSO-Nachprüfung der ersten drei Suchtreffer findet Referenzen, entscheidet aber nicht über das Nutzungsziel. |
| 3DBAG, Luftbild/BGT/OSM | Visualisierung und Gebäudekontext | Optische Bestandsinformationen; kein Nachweis von Erlaubnis, Deckenhöhe, Eigentum oder ungenutzten Grundstücken. |
| OpenAI / lokaler Codex | Strukturierter Intent-Interpreter, Modell GPT-6 Luna mit High Reasoning | Das Modell erfindet keine Kandidaten; die Datenabfragen bestimmen Ergebnisse. Für präzise Suchsemantik sind Operatoren, offene Bedingungen, Suchraum und Evidenzzustände wichtiger als ein Modellwechsel. |

## Empfohlener Zielablauf

1. **Intent erfassen:** Vorhaben (Wohnen, Pool, Tiny House), Region, harte Anforderungen, Wünsche und Ausschlüsse. Vage Vorhaben nicht automatisch mit einer Wohnbestimmung oder einem vorhandenen Bau-Recht gleichsetzen.
2. **Prüfbaren Suchplan zeigen:** Jeder Nutzerwunsch erhält Wert, Einheit, Operator, Quelle und Status „prüfbar / Näherung / Regeltext erforderlich / Daten fehlen“. Bei widersprüchlichen Grenzen oder Orten zuerst auflösen.
3. **Geometrisch ausführen:** Flächen und Parzellen als Objekte inventarisieren; exakte schneidende Geometrien für Punkt/Fläche/Abstand; keine Extents als bewiesene Nähekriterien ausgeben.
4. **Evidenz bewerten:** Pro Kriterium bestätigt, widersprochen oder unbekannt; Fehlermeldung und begrenzte Datenabdeckung sind unbekannt. Harte Kriterien vor Rangfolge auswerten.
5. **Ergebnisse erklären:** Vergleichbare Kriterien, konkrete gemessene Werte, Quellenstand und offene Bedingungen pro Kandidat. Keine scheinbar exakte generische 50-Punkte-Note als Qualitätsbeweis. Übersichten und vollständige Suchräume auseinanderhalten.
6. **Am ausgewählten Standort in Regeln suchen:** Standort, Parzellen-ID, Instrument-/Versions-ID und räumliche Anwendbarkeit festhalten. Treffer mit Artikel, kurzem Originalzitat, Datum und öffentlichem Link belegen. Ein gefundener Artikel ist noch kein vollständiger Genehmigungsbescheid.

Für die Regel-Suche passen Fragen nach zulässiger Nutzung, Haupt-/Nebenanlagen, Baufenster, Bau-/Traufhöhe, Bebauungsanteil, Abständen, Pool/Nebengebäude, Dauerwohnen/Tourismus, Anzahl Wohneinheiten sowie Archäologie-/Wasser-/Schutzauflagen. „Deckenhöhe“ darf nicht mit Gebäudehöhe verwechselt werden: Der Regeltext kann andere technische oder überörtliche Anforderungen enthalten; fehlt die konkrete Vorschrift, muss die Antwort das sagen. Allgemeine Definitionen, Ausnahmen, Änderungsstände und andere geltende Instrumente müssen zur konkreten Fundstelle mitgelesen werden.

## Integrierte begrenzte Reparaturen

Die Reparaturen sind in die kanonische App integriert. Enthalten sind ein reines `search-core.js`, angepasste Suche, Schema/Prompt sowie zehn grüne Regressionstests. Sie beheben zusätzlich eindeutige Ortsauflösung und sichtbare Suchraumkonflikte sowie Distanzstruktur, Einheit/Operatoren, Polygonabstand bei vorhandenen Geometrien, unsichere Extents, Kontext-Neuauswahl, Baufenster-Deduplikation, Abschneiden offener Anforderungen und BAG-Distanz/Rangfolge. Sie ersetzen **keinen** vollständigen nationalen Parzellenindex und **keine** vollständige Rechtsprüfung.

## Verifizierte Primärquellen

- [PDOK BAG-Pand-Features mit Gebruiksdoel und Status](https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand/items?f=html): bestätigt die verwendeten Attribute.
- [Kadaster-Informationsmodell BRT](https://kadaster.github.io/imbrt/): TOP10NL ist eine topografische Datenbasis und kein Rechtskataster.
- [PDOK TOP10NL Downloadviewer](https://app.pdok.nl/brt/top10nl/download-viewer/): beschreibt Export/API und Aktualität je Featuretyp.
- [Geonovum: RO-Standards](https://www.geonovum.nl/geo-standaarden/ro-standaarden-ruimtelijke-ordening): erklärt das parallele IMRO-/Omgevingswet-Übergangsumfeld.
- [IPLO: Omgevingsplan von Rechts wegen](https://iplo.nl/regelgeving/instrumenten/omgevingsplan/omgevingsplan-rechtswege/): nennt auch Bestandteile, die nicht in Regels op de kaart dargestellt sind. Das Produkt darf deshalb die abgerufenen Texte nicht als garantiert vollständige Gesamtheit aller geltenden Regeln bezeichnen.
