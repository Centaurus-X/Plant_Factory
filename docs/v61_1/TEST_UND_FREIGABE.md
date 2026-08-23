# Test- und Freigabevertrag Plant Factory V61.1

## 1. Vollständige Prüfung

```bash
AUTOMATION_RUNTIME=/pfad/zu/automation_system_v0101 ./test_all.sh
```

Ohne externe Runtime bleibt die lokale Prüfung vollständig ausführbar; nur die
zusätzliche Runtime-Tiefprüfung wird ausgelassen.

## 2. Prüfstufen

Die Freigabekette ist fail-fast und umfasst:

1. Python-Syntax und funktionalen Stil;
2. JavaScript-Syntax und funktionalen Stil;
3. deterministischen PF-PID-V1-Generator und Standardvertrag;
4. Markup-, Asset-, Accessibility- und Releasevertrag;
5. Security und isolierte HTTP-API;
6. konsolidierten SVG-Konverter;
7. JavaScript-Regressionssuite;
8. Python-/JavaScript-Formatparität;
9. reproduzierbaren Konfigurationsbuild;
10. deterministische V9-Migration;
11. V9-Node- und V8-Cross-Sharding;
12. Regel- und Prozessbibliotheken;
13. Regelvertrag und optionale Runtime-Autorität;
14. Plant-Factory-, Snapshot- und V9-Modellketten;
15. Serverstart und hermetischen Chromium-Smoke;
16. Repository-, Dokumentations- und Integritätsprüfung.

## 3. PF-PID-V1-spezifische Gates

Die Prüfung verlangt:

- exakt 25 deterministisch generierte Standardtemplates;
- gültige SVG-XML-Struktur und sichere Inhalte;
- META-/Manifest-Übereinstimmung;
- nicht skalierende Linienbreiten und semantische Body-Rollen;
- relative Ports im gültigen Wertebereich;
- zentrale Objektfamilien und Geometrieprofile;
- erhaltene Bindings, Animationen, Custom-SVGs und Erweiterungsfelder;
- kompatible Portpaar-Auswahl und Ablehnung inkompatibler Verbindungen;
- gültige TAGs und Laufzeitzustände;
- keine automatische HMI-Widget- oder Button-Erzeugung;
- Erhalt expliziter optionaler Widgets und Bindings;
- normalisierte Referenzanlage mit sechs Entities und fünf Verbindungen.

## 4. Browser-Freigabe

Der reale Browserlauf prüft zusätzlich:

- sichtbare V61.1-Kennung und geladene V61-Schichten;
- 25 Standardtemplates im Standardscope;
- alle Canvas- und globalen Fachrouten;
- Laden der Referenzanlage;
- sechs normalisierte Canvas-Entities und fünf Verbindungen;
- TAGs, Datenattribute, Ports und Inspector-Synchronisierung;
- reales V9-Binding im Auswahlstatus;
- korrekte Verbindungszahl in der Statusleiste;
- gültigen `window.__pfV61`-Standardbericht;
- standardmäßig verborgenes Engineering-HMI-Overlay;
- zwei explizite optionale HMI-Widgets und keine Auto-Widgets;
- lesbaren Theme-Kontrast für Indicator und Button;
- bewusstes Ein-/Ausblenden des Overlays;
- Light/Dark Theme, Dunkelpalette und responsive Bedienung.

## 5. Verifiziertes Releaseergebnis

| Prüfbereich | Ergebnis |
|---|---:|
| PF-PID-V1 JavaScript-Vertrag | 31/31 |
| V9-Kerntests | 145/145 |
| JavaScript-Formatprüfungen | 42/42 |
| Python-Formatparität | 58/58 |
| Plant-Factory-Modellkette | 31/31 |
| Snapshot-Kette | 52/52 |
| Regelvertrag mit `automation_system_v0101` | 29/29 |
| Chromium-Browser-Smoke | 119/119 |

Die vollständige Freigabekette endete ohne Fehler. Der Browserlauf meldete
keine fehlgeschlagenen Interaktionen, keine Konsolenfehler und keine
fehlgeschlagenen Requests.

## 6. Freigabekriterium

Ein Release ist nur freigegeben, wenn alle automatisierten Prüfungen ohne
Fehler enden, das Archiv reproduzierbar und traversal-sicher ist und sämtliche
internen SHA-256-Prüfsummen stimmen.

Die Softwarefreigabe ist von der Anlagenfreigabe zu unterscheiden. Für den
Produktivbetrieb an realer Hardware bleiben FAT/SAT, Safety-Betrachtung,
Benutzer-/Rechtekonzept, Backup/Restore und Betriebsüberwachung erforderlich.
