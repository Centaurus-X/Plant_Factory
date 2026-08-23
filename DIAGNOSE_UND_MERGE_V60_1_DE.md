# Vollständige Code-Diagnose, Versionsabgleich und Merge-Entscheidung V60.1

**Produkt:** Automated SVG Integration / Plant Factory / HMI-P&ID Studio  
**Zielrelease:** **V60.1 / 60.1.0**  
**Analysierte Quellstände:** V55.2, V56.3, V57.3 und V58.2  
**Prüfdatum:** 14. August 2026  
**Ergebnis:** semantischer Mehrquellen-Merge erstellt und vollständige lokale Release-Prüfkette bestanden

---

## 1. Management-Zusammenfassung

Die vier Archive sind keine lineare Folge, bei der V58.2 automatisch alle
Verbesserungen der Vorgänger enthält. Sie bilden vielmehr drei teilweise
auseinanderlaufende Entwicklungszweige auf einem stabilen gemeinsamen
Plant-Factory-/HMI-Kern:

- **V55.2** ist der stabile gemeinsame Fach- und Konfigurationssockel mit einer
  älteren Bedienoberfläche.
- **V56.3** besitzt den vollständigsten V1-Engineering-Workspace: strukturierter
  Inspektor, reale Bindings, Favoriten, Auto-Fit, Minimap, kompakte Menüs und
  valide Projekt-SVGs.
- **V57.3** besitzt die stärkste Sicherheits- und Betriebsbasis: aktive
  SVG-Sanitisierung, Größenlimit, DOCTYPE-/ENTITY-Sperre, atomare Schreibpfade,
  sichere Projektpfade, Security Header, Localhost-Standardbindung, lokale
  Schriftarten, bessere Tastaturbedienung und die vollständigsten Security-/
  Markup-Tests.
- **V58.2** besitzt die modernste Canvasdarstellung und mehrere wertvolle
  UX-Verbesserungen: Elementbeschriftungen, Teal-Prozesslinien,
  typabhängige Linienfarben, Shortcut-Hilfe und verfeinerte Workspace-Optik.
  Gleichzeitig wurden wesentliche V57.3-Härtungen und Tests wieder entfernt;
  außerdem sind alle vier mitgelieferten Projekt-SVGs wegen eines fehlenden
  `xmlns:xlink`-Namespace nicht als XML parsebar.

Ein korrektes Ergebnis konnte daher **nicht** durch Kopieren von V58.2 und
Übernahme weniger Einzeldateien entstehen. V60.1 wurde als kontrollierter,
semantischer Mehrquellen-Merge aufgebaut:

1. **V58.2** liefert die visuelle Shell und die Canvasverbesserungen.
2. **V57.3** liefert die Sicherheits-, Betriebs-, Font- und Accessibility-Basis.
3. **V56.3** liefert die verlorene Interaktionstiefe des V1-Workspaces und die
   validen Projekt-SVGs.
4. Der in allen vier Archiven byte-identische **V9-Konfigurations- und
   Shard-Vertrag** bleibt unverändert.
5. Neue V60.1-Integrationslogik verbindet die Teilstände, ohne alte
   Branch-spezifische UI-Schichten parallel weiterzuführen.
6. Backend und SVG-Konverter wurden zusätzlich vollständig auf funktionale
   Komposition ohne Klassen, Decorators oder Lambdas umgebaut.

Für den im Archiv enthaltenen Funktionsumfang ist V60.1 technisch konsistent
und lokal produktionsfähig. Die vollständige 15-stufige Release-Prüfung ist
grün. Eine entfernte Netzwerkbereitstellung ist bewusst **nicht** direkt
freigeschaltet: Die schreibende API bindet standardmäßig an `127.0.0.1` und
benötigt für externen Zugriff einen authentifizierten TLS-Reverse-Proxy.

---

## 2. Untersuchungsumfang und Vertrauensbasis

### 2.1 Eingangsarchive

| Version | Archiv | Größe | SHA-256 |
|---|---|---:|---|
| V55.2 | `Code-Analyse und Design-Audit_55_2(4).zip` | 1.114.632 Byte | `a5cccb11808884274d1e882140bca2eb0292674f72beed786d6721510e199928` |
| V56.3 | `Automated_SVG_Integration_56_3(2).zip` | 5.709.366 Byte | `dcaae41036ba6e83a559e89b19b1ee97c085b282aff5bc9622cc28fdc2f4926d` |
| V57.3 | `Automated_SVG_Integration_57_3(2).zip` | 3.425.929 Byte | `7025dc08c822ab9287ae1b6dcd97fdd97897ae1a58c0fd7fd12784788f2c2dd8` |
| V58.2 | `Vollständige Code-Diagnose und UIUX-Optimierung_58_2(1).zip` | 3.162.894 Byte | `33a3ca1be01688ef6876e920cc1df24732a47218b3f30d6b7d9c8d2095b7f3d6` |

Alle Archive wurden vor der Analyse auf Pfadtraversal, absolute Zielpfade und
Symlink-Einträge geprüft. Es wurden keine unsicheren Archiveinträge gefunden.
Jeder Stand wurde in ein eigenes, unverändertes Quellverzeichnis extrahiert.

### 2.2 Prüfmethode

Die Diagnose kombiniert fünf Ebenen:

1. **Vollständiges Dateiinventar:** Pfad, Größe, SHA-256, Text-/Binärtyp und
   Zeilenzahl für jede Datei.
2. **Hashbasierter Versionsvergleich:** hinzugefügt, entfernt, geändert oder
   byte-identisch für jeden Übergang.
3. **Semantischer Codevergleich:** Backend, Frontend, Konfiguration,
   Projektdateien, Converter, Tests und Buildwerkzeuge.
4. **Ausführbare Verifikation:** Syntax, Formatparität, Fachketten,
   Security/API, Migration, Sharding, Browser und Release-Reproduzierbarkeit.
5. **Visuelle Prüfung:** reale Chromium-Aufnahmen in Light, Dark, Responsive,
   Projektladung und Shortcut-Overlay.

Die vollständige maschinenlesbare Grundlage liegt in:

- `docs/v60_1/DATEI_INVENTAR_V55_2_BIS_V60_1.json`
- `docs/v60_1/DATEI_DIFFERENZ_MATRIX_V55_2_BIS_V60_1.csv`
- `docs/v60_1/MERGE_MANIFEST_V60_1.json`

### 2.3 Zwei Zählweisen

Die Roharchive enthalten auch selbst erzeugte Dateien wie `SHA256SUMS` und
`Verzeichnisstruktur.txt`. Die erste Rohzählung ergab:

| Version | Dateien im Roharchiv | Textzeilen |
|---|---:|---:|
| V55.2 | 189 | 66.314 |
| V56.3 | 237 | 72.478 |
| V57.3 | 221 | 70.817 |
| V58.2 | 225 | 70.720 |

Für die reproduzierbare Differenzmatrix werden diese beiden abgeleiteten
Metadateien sowie die Matrixausgaben selbst nicht als Produktquellstand
mitgezählt. Deshalb sind die normalisierten Werte im JSON geringfügig kleiner.
Die Abweichung ist beabsichtigt und im Feld `scope.excluded` dokumentiert.

---

## 3. Gemeinsamer fachlicher Kern aller vier Versionen

Trotz der sichtbaren UI-Unterschiede ist der fachliche Kern außerordentlich
stabil. Das ist die wichtigste Voraussetzung für einen risikoarmen Merge.

### 3.1 Byte-identischer V9-Vertrag

Die zentrale Datei `config/device_state_data_v9.json` ist in V55.2, V56.3,
V57.3, V58.2 und V60.1 byte-identisch:

```text
178d8fe87d12172e28f8e269b475313f76b2e61d3c0b617aac398e8ad2ead9da
```

Dasselbe gilt für die zentralen Bibliotheken und Shards:

| Artefakt | SHA-256 |
|---|---|
| `config/rule_library_v9.json` | `e76d9cfe6d47dc5281ef79886823fb8be06c46907d2a108c86bb5ada53f26c4a` |
| `config/process_library_v9.json` | `7bdba81af0bd2224106adfefa98e8ea6827a8284c9120cf5acd36d6c49bfa56e` |
| `config/shards/device_state_data_v9_node_fn-01.json` | `d794e0e931fab094bf97f7ddea8b18b9cfdca4563191733ac88cc22df2e8dfaf` |
| `config/shards/device_state_data_v9_node_fn-02.json` | `4ab399a00194379c9a4debef9712a1ca5cf5c0649d98d5c79624318bc3594aac` |
| `config/shards/device_state_data_v8_cross_fn-01.json` | `a47b3c518a2c18930e5b177a96a60fa5c377ca132e973af85a82b51dbc7a2316` |

Damit bleiben folgende fachliche Invarianten erhalten:

- kanonischer Mastervertrag V9;
- 26 Konfigurationssektionen;
- fünf deterministische Controller-UUIDs;
- zwei lokale V9-Node-Shards;
- ein fail-closed V8-Cross-Shard;
- zehn ausführbare Regeln, davon sieben lokal und drei cross-scoped;
- unveränderte Regel- und Prozessbibliotheken;
- unveränderte Fachmodelle für Geräte, Zustände, Prozesse, Regeln, HMI,
  Verbindungen und Rollout.

### 3.2 Gemeinsamer Dateisockel

Über die vier Eingangsversionen existieren 284 verschiedene Pfade. Davon sind
187 in allen vier Versionen vorhanden. 152 dieser gemeinsamen Dateien sind
byte-identisch; 35 besitzen mindestens zwei Inhaltsvarianten. Die Unterschiede
liegen deshalb überwiegend in der Anwendungsschale, im Server-Hardening, in
Tests, Release-Evidenz und ergänzenden UI-Modulen — nicht im fachlichen
Datenmodell.

### 3.3 Bekannter Runtime-Hinweis

Acht `filter_id`-Verwendungen werden in allen Ständen als bekannte Hinweise
geführt. Die lokale Vertragsprüfung ist vollständig grün. Die optionale
Tiefprüfung gegen `automation_system_v0101` konnte nicht ausgeführt werden,
weil diese externe Runtime in keinem der vier bereitgestellten Archive
enthalten war. V60.1 versteckt diesen Umstand nicht: `AUTOMATION_RUNTIME` bzw.
`PYTHONPATH` kann die Autorität beim Deployment explizit einbinden.

---

## 4. Tiefe Diagnose je Version

## 4.1 V55.2 — stabiler Fachsockel, ältere Bedienlinie

### Stärken

V55.2 stabilisiert die ältere Oberfläche an einer konkreten Stelle: Tabs und
Werkzeugleisten scrollen horizontal, statt Aktionen unsichtbar abzuschneiden.
Das Projektnamenfeld behält eine nutzbare Mindestbreite. Der V9-Kern, die
Config-Buildwerkzeuge, Shards, Regeln, Prozesse und Snapshot-Kette sind bereits
reif und bilden den gemeinsamen fachlichen Ausgangspunkt.

### Grenzen

- Kein vollständiger V1-Workspace mit Rail, moderner Bibliothek, Minimap und
  strukturiertem Kontextinspektor.
- Die später in V57.3 eingeführte SVG-Sicherheitskette fehlt.
- Die vier Projekt-SVGs sind XML-seitig ungültig, weil `xlink:*` verwendet wird,
  ohne `xmlns:xlink` zu deklarieren.
- Der Stand ist als Basis fachlich wertvoll, aber visuell und betrieblich nicht
  der geeignete Release-Kandidat für V60.1.

### Merge-Rolle

V55.2 dient als **Invarianten- und Rückwärtskompatibilitätsreferenz**, nicht als
visuelle oder sicherheitstechnische Basis.

## 4.2 V56.3 — stärkster Engineering-Workspace

### Stärken

V56.3 ist der vollständigste UI-/UX-Zweig der vier Eingangsversionen. Er bringt:

- V1-Geometrie und V1-Proportionierung;
- strukturierte Inspector-Gruppen statt eines flachen Formularblocks;
- Anzeige realer Element-, Port- und Binding-Daten;
- Favoritenbereich in der Symbolbibliothek;
- Auto-Fit für reale Canvas-Inhalte;
- Live-Minimap;
- kompakte Header- und Inspector-Menüs;
- explizite Inspector-Übernahme;
- zweite persistente Brown-Dark-Palette;
- browserbasierte Release-Evidenz;
- ein Playwright-Lockfile;
- valide `xmlns:xlink`-Deklarationen in allen vier Projekt-SVGs.

Die UI-Logik wurde bereits bewusst funktional ohne Klassen und Arrow Functions
entwickelt. V56.3 ist damit der wichtigste Feature-Spender für die Interaktion.

### Grenzen

- Die umfassende V57.3-Sicherheitsbasis ist noch nicht vorhanden.
- Lokale Fonts und die spätere Accessibility-/Fokus-Härtung fehlen teilweise.
- Ein direktes Upgrade von V56.3 würde die Canvasverbesserungen aus V58.2 nicht
  enthalten.

### Merge-Rolle

V56.3 ist der **Workspace- und Interaktions-Feature-Parent** von V60.1.

## 4.3 V57.3 — stärkste Security-, Font- und Accessibility-Basis

### Stärken

V57.3 ist betrieblich der stärkste Eingangszweig. Wesentliche Verbesserungen:

- SVG-Limit von 10 MiB;
- Ablehnung von `DOCTYPE` und `ENTITY`;
- Entfernung aktiver Tags wie `script` und `foreignObject`;
- Entfernung von Event-Attributen und externen Ressourcen;
- Entfernung externer CSS-URLs;
- Erhalt erlaubter lokaler Fragmentreferenzen;
- atomare Schreibvorgänge für Projekte und V9-Konfiguration;
- sichere Projekt- und Exportnamen;
- Security Header und restriktivere Serverkonfiguration;
- standardmäßige Bindung an `127.0.0.1`;
- robustere YAML-Verarbeitung;
- lokale Public-Sans- und IBM-Plex-Mono-Dateien samt Lizenzen;
- persistente Blau-/Braun-Dark-Palette;
- bessere Keyboard-, Dialog- und Fokusführung;
- eigenständige Markup- und Security-Tests;
- valide Projekt-SVGs.

### Grenzen

Der Versionspfad ist nicht aus V56.3 fortgeführt worden. Beim Übergang
V56.3 → V57.3 wurden 49 Dateien entfernt, darunter gerade die reichhaltigen
V56.3-Workspace-Schichten, das Browser-Fixture und die V56.3-Release-Evidenz.
V57.3 ist daher sicherer, aber in der Engineering-Workspace-Tiefe nicht
vollständig überlegen.

### Merge-Rolle

V57.3 ist der **Security-, Betriebs-, Font- und Accessibility-Parent** von
V60.1.

## 4.4 V58.2 — stärkste Canvasoptik, aber kritische Regressionen

### Stärken

V58.2 verbessert sichtbar die tägliche Arbeit:

- Namen werden direkt unter den platzierten Symbolen gerendert;
- Prozesslinien verwenden Teal und Pfeilspitzen;
- Signal- und Datenlinien erhalten unterscheidbare Typstile;
- Symbole verwenden eine ruhigere Engineering-Palette;
- Shortcut-Overlay und zusätzliche Workspace-Hinweise;
- verfeinerte Canvas-, Scrollbar-, State- und Responsive-Darstellung;
- moderne V1-Shell mit Rail und globalen Arbeitsräumen.

### Kritische Regressionen

V58.2 darf nicht ungeprüft als alleinige Merge-Basis verwendet werden:

1. `_server_v9.py` verlor gegenüber V57.3 42 sicherheits- und
   robustheitsrelevante Zeilen bei nur 12 neuen Zeilen.
2. `svg_editor_tool.py` verlor 177 Zeilen und damit wesentliche Härtungen:
   SVG-Sanitizing, DOCTYPE-/ENTITY-Sperre, Größenlimit, sichere Namen,
   atomare Schreibpfade, Security Middleware und konfigurierbare sichere
   Bindung.
3. `test/test_security.py` und `test/test_markup.py` wurden vollständig
   entfernt.
4. Die lokalen Fontdateien und V57-spezifischen Theme-/Experience-Schichten
   wurden entfernt.
5. Alle vier Projekt-SVGs sind wieder XML-ungültig (`unbound prefix` in Zeile
   41), obwohl V56.3 und V57.3 diesen Fehler bereits behoben hatten.
6. Mehrere V56.3-Workspace-Details sind nur noch teilweise oder vereinfacht
   vorhanden.

### Merge-Rolle

V58.2 ist ausschließlich der **visuelle Shell- und Canvas-Parent**. Seine
Backend- und Testregressionen werden ausdrücklich nicht übernommen.

---

## 5. Vollständiger Versionsverlauf auf Dateiebene

Die Rohvergleiche zeigen den nichtlinearen Entwicklungsverlauf:

| Übergang | Hinzugefügt | Entfernt | Geändert | Unverändert |
|---|---:|---:|---:|---:|
| V55.2 → V56.3 | 48 | 0 | 29 | 160 |
| V56.3 → V57.3 | 33 | 49 | 30 | 158 |
| V57.3 → V58.2 | 37 | 33 | 33 | 155 |

Die wichtigste Aussage ist nicht die Anzahl der Änderungen, sondern ihre
Richtung:

- V55.2 → V56.3 ist überwiegend **additiv**.
- V56.3 → V57.3 ist ein **Branchwechsel**: neue Security-/Theme-Dateien kommen,
  V56-Workspace-Dateien gehen.
- V57.3 → V58.2 ist ein weiterer **Branchwechsel**: V1-Workspace und
  Canvas-Evidenz kommen zurück, Security-, Font- und Markup-Bestandteile gehen.

Die vollständige 299-Pfade-Matrix führt jeden einzelnen Pfad und jeden Hash
auf. Damit ist nachvollziehbar, ob V60.1 eine Datei exakt wiederverwendet,
neu erstellt oder semantisch zusammengeführt hat.

---

## 6. Funktionsmatrix der Eingangsversionen und V60.1

Legende: **voll** = vollständig vorhanden; **teil** = vorhanden, aber nicht auf
höchstem Stand; **nein** = nicht vorhanden oder nachweislich regressiv.

| Funktionsbereich | V55.2 | V56.3 | V57.3 | V58.2 | V60.1 |
|---|---|---|---|---|---|
| V9-Master, Regeln, Prozesse, Shards | voll | voll | voll | voll | voll |
| Vollständige V1-Workspace-Geometrie | nein | voll | teil | voll | voll |
| Strukturierter produktiver Inspektor | teil | voll | teil | teil | voll |
| Reale Binding-/Portanzeige | teil | voll | teil | teil | voll |
| Favoritenbibliothek | nein | voll | nein | teil | voll |
| Auto-Fit und Live-Minimap | nein | voll | nein | teil | voll |
| Kompakte Header-/Inspector-Menüs | nein | voll | teil | voll | voll |
| Elementbeschriftungen auf Canvas | nein | nein | nein | voll | voll |
| Teal-/Typfarben für Verbindungen | nein | nein | nein | voll | voll |
| Blau- und Braun-Dark-Palette | nein | voll | voll | teil | voll |
| Lokale Public-Sans-/IBM-Plex-Fonts | nein | nein | voll | nein | voll |
| Keyboard-/Dialog-/Fokus-Härtung | teil | teil | voll | teil | voll |
| Aktive SVG-Sanitisierung | nein | nein | voll | nein | voll |
| Atomare Schreibpfade | teil | teil | voll | nein | voll |
| Security Header / Localhost-Default | teil | teil | voll | nein | voll |
| Valide Projekt-SVGs | nein | voll | voll | nein | voll |
| Security- und Markup-Tests | nein | nein | voll | nein | voll |
| Merge-/API-/Converter-Stiltests | nein | nein | nein | nein | voll |
| Reale Browserprüfung des Gesamtmerges | nein | voll | voll | voll | voll |
| Durchgehend funktionaler Quellstil | nein | teil | teil | teil | voll |

---

## 7. Merge-Strategie für V60.1

## 7.1 Warum kein normales „neueste Version gewinnt“

Ein „V58.2 plus Versionsnummer“ hätte einen scheinbar modernen, aber
betrieblich schwächeren Stand erzeugt. Ein „V57.3 plus V58-CSS“ hätte den
reichhaltigen V56.3-Workspace nicht wiederhergestellt. Ein „V56.3 plus
Security-Patch“ hätte wiederum die V58.2-Canvasdarstellung und mehrere neuere
Navigationsverbesserungen ausgelassen.

Deshalb wurde pro Verantwortungsbereich ein expliziter Parent bestimmt.

## 7.2 Merge-Priorität je Komponente

| Komponente | Führender Parent | Ergänzung | Ergebnis V60.1 |
|---|---|---|---|
| Fachvertrag/Config | alle identisch | keine semantische Änderung | byte-identisch erhalten |
| Server/API | V57.3 | funktionale V60-Refaktorierung | gehärtete, testbare Funktionskomposition |
| Workspace-Shell | V58.2 | V56.3 + V57.3 | moderne Shell mit voller Interaktion und A11y |
| Inspector | V56.3 | V58-Kontext + V60-Apply | reale Daten, fünf Bereiche, explizite Übernahme |
| Bibliothek | V56.3 | V60-Keyboard | Favoriten, Kategorien, tastaturbedienbar |
| Canvas | V58.2 | V56-Fit/Minimap | Labels, Engineering-Palette, Auto-Fit, Minimap |
| Theme/Fonts | V57.3 | V56-Brown + V60-Integration | lokale Fonts, Blau/Braun persistent |
| Projekt-SVGs | V56.3/V57.3 | XML-Vertragstest | alle vier parsebar |
| SVG-Konverter | V57-Grundlage | vollständige V60-Konsolidierung | eine funktionale Implementierung |
| Tests | Union aller Zweige | neue V60-Gates | 15 reproduzierbare Stufen |

## 7.3 Dateiweise Konfliktauflösung

### Backend

`_server_v9.py` und `svg_editor_tool.py` wurden nicht aus V58.2 übernommen.
Ausgangspunkt war die V57.3-Härtung. Anschließend wurden Klassen und implizite
Objektzustände durch explizite Funktionskomposition und Zustandsobjekte ersetzt.
Die API bleibt kompatibel, ist aber isolierter testbar.

### HTML und CSS

`public/index.html` ist ein echter Handmerge. Er enthält:

- V58.2-Header, Rail und globale Arbeitsräume;
- fünf direkte Inspector-Tabs;
- Header- und Inspector-Überlaufmenüs;
- Minimap und Fit-Steuerung;
- Palette- und Shortcut-Schalter;
- fünf korrekt ausgezeichnete Dialoge;
- Live-Statusregion;
- V60.1-Integrationsassets.

`public/css/workspace.css` behält die V58.2-Canvasdarstellung. Die neue Datei
`public/css/v60.css` kapselt V60-spezifische Merge- und Responsive-Regeln, damit
historische CSS-Schichten nicht weiter unkontrolliert überschrieben werden.

### JavaScript

- `core.js`, `registry.js`, `connection_mapper.js` und `ui.js` nutzen die
  reichhaltigeren V56.3-Funktionen als Grundlage.
- `elements.js` behält die V58.2-Beschriftungslogik.
- `v9_ui_chrome.js` verbindet die V58-Navigation mit der V57-Tastaturführung.
- `v56_workspace.js` stellt die produktiven Workspace-Funktionen bereit.
- `v60_ui.js` ist die neue, bewusst kleine Integrationsschicht für Menüs,
  Palette, Auto-Fit, Minimap, Inspector-Apply, Fokusführung und roving
  `tabindex`.

Alle produktiven JavaScript-Dateien wurden AST-basiert geprüft. Es existieren
keine Klassen, Methodendeklarationen oder Arrow Functions.

### SVG-Konverter

Die beiden früher nahezu identischen Converter-Dateien enthielten doppelte
Klassenimplementierungen. V60.1 besitzt nur noch eine kanonische funktionale
Implementierung. `svg_converter_.py` ist ein schmaler Kompatibilitätsstarter.
Ein dabei entdeckter Fehler wurde zusätzlich korrigiert: namespacete
`<defs>`-Container wurden früher nicht sicher erkannt und konnten doppelt
angelegt werden. V60.1 garantiert genau einen passenden Container und
Dokument-weit eindeutige IDs.

---

## 8. Vollständiger Funktionsstand V60.1

## 8.1 Engineering und P&ID

- Symbolbibliothek mit Kategorien, Suche und Favoriten;
- Drag-and-drop und bestehende Canvas-Werkzeuge;
- Auswahl, Mehrfachauswahl, Verschieben, Raster und Zoom;
- Auto-Fit auf reale Inhalte;
- Live-Minimap;
- Elementnamen direkt auf der Zeichenfläche;
- Teal-Prozesslinien und unterscheidbare Signal-/Datenlinien;
- Auswahl-Chip bleibt innerhalb des Canvas;
- valide Projektladung und sichere Projektspeicherung;
- eigenes SVG kann weiter importiert werden.

## 8.2 Inspector

- fünf direkte Bereiche: Details, I/O, HMI, Linien und Ebenen;
- reale Elementdaten statt Platzhaltertext;
- Port- und Binding-Kontext;
- klar gruppierte Felder;
- explizite Schaltfläche `Übernehmen`;
- Kontext-/Breadcrumb-Anzeige;
- tastaturbedienbare Tabnavigation;
- kompaktes Überlaufmenü.

## 8.3 Plant Factory / Automation

- Prozesse, Regeln, Zustände, Topologie, Cross-Rollout und Validierung;
- kompatible Legacy-Routen hinter der neuen Workspace-Shell;
- V9-Master und lokale V9-Projektionen;
- fail-closed V8-Cross-Projektion;
- deterministische Migration und Shard-Erzeugung;
- HMI-Snapshot, Animation und Exportkette;
- fünfteiliger SCADA-Bundle-Vertrag bleibt erhalten.

## 8.4 UI/UX und Accessibility

- Light Theme sowie persistente blaue und braune Dark-Palette;
- lokale Public Sans und IBM Plex Mono;
- beschriftete Workspace-Rail;
- fokussierbare Hauptnavigation;
- Pfeiltasten, Home/End und Escape in Rail, Tabs und Menüs;
- roving `tabindex`;
- Keyboard-Aktivierung von Vorlagen;
- Dialog-Fokusfalle und Fokus-Rückgabe;
- Shortcut-Hilfe;
- responsive Darstellung bei 1366 × 768;
- ARIA-Referenzen, Label-Ziele und eindeutige IDs statisch geprüft.

---

## 9. Security- und Betriebsdiagnose V60.1

## 9.1 SVG-Eingang

Die Sanitisierung schützt den produktiven Import- und Exportpfad:

- maximal 10 MiB;
- kein `DOCTYPE`, keine `ENTITY`;
- keine aktiven `script`- oder `foreignObject`-Elemente;
- keine Event-Handler-Attribute;
- keine externen Ressourcen;
- keine externen CSS-URLs;
- lokale Fragmentreferenzen bleiben erhalten;
- das Ergebnis muss weiter valides XML sein;
- eingebettete erlaubte Config-Snapshots bleiben erhalten.

## 9.2 Dateisystem

- Projektnamen werden auf sichere Dateinamen normalisiert;
- Pfadtraversal kann das konfigurierte Projektverzeichnis nicht verlassen;
- Text- und Config-Schreibvorgänge sind atomar;
- temporäre Geschwisterdateien werden nach erfolgreichem Replace entfernt;
- Exportdateinamen sind traversal-sicher.

## 9.3 HTTP

- Standardbindung: `127.0.0.1:8090`;
- Security Header einschließlich CSP, `X-Content-Type-Options`, Referrer Policy,
  Cross-Origin-Opener-Policy und Cross-Origin-Resource-Policy;
- CORS standardmäßig deaktiviert;
- Fehlerantworten durchlaufen ebenfalls die Security Middleware;
- Pfade werden aus `config/server.yaml` gelesen;
- Upload-Limit und erlaubte Endung sind konfiguriert.

## 9.4 Produktionsgrenze

V60.1 ist als lokale Engineering-Anwendung bzw. als interner Dienst hinter
einer kontrollierten Plattform ausgelegt. Für eine direkte Bereitstellung in
einem fremden Netz fehlen absichtlich Authentifizierung und TLS-Terminierung.
Die korrekte Produktionsarchitektur lautet:

```text
Browser / Engineering-Client
        │ HTTPS + AuthN/AuthZ
        ▼
Authentifizierter Reverse-Proxy
        │ nur internes Loopback-/Service-Netz
        ▼
Plant Factory V60.1 auf 127.0.0.1:8090
```

Ein bloßes Starten mit `--host 0.0.0.0` ohne diese Schutzschicht ist nicht als
Produktionsfreigabe zu verstehen.

---

## 10. Verifikation und Testergebnis

Die Release-Pipeline `./test_all.sh` umfasst 15 Stufen und lief vollständig
durch.

| Bereich | Ergebnis |
|---|---:|
| Python-Syntax und funktionaler Stil | bestanden |
| JavaScript-Syntax und funktionaler Stil | bestanden |
| Markup und V60-Mergevertrag | bestanden |
| Security und isolierte HTTP-API | bestanden |
| SVG-Konverter | bestanden |
| JavaScript-Regressionssuite | 270/270 |
| Python-Formatparität | 58/58 |
| JavaScript-Formatparität | 42/42 |
| Byte-identischer Config-Rebuild | bestanden |
| Deterministische Migration | bestanden |
| V9-/V8-Shard-Split | bestanden |
| Regel-/Prozessbibliotheken | bestanden |
| Regelvertrag | 15/15 |
| Plant-Factory-Modellkette | 31/31 |
| Snapshot-Kette | 52/52 |
| V9-Kern | 145/145 |
| Browser-Smoke | 88/88 |
| Abschlussprüfung Repository | bestanden |

### Browserumgebung

Die bereitgestellte Chromium-Installation blockiert administrativ jede
Navigation — auch `file:`, `data:` und frei aufgelöste lokale Hostnamen — mit
`ERR_BLOCKED_BY_ADMINISTRATOR`. Der Test verwendet nur für genau diesen
Fehlerfall einen hermetischen Fallback:

1. Der echte Server wird gestartet und außerhalb des Browsers per HTTP geprüft.
2. Das echte `public/index.html`, alle acht Stylesheets und der vollständige
   ES-Modulgraph mit 35 Modulen werden geladen.
3. Die Module werden nur für den Test in eine isolierte Registry transpiliert.
4. `fetch`-Aufrufe werden durch den Playwright-Hostprozess an denselben lokalen
   Server weitergeleitet.
5. DOM, CSS, JavaScript, Layout, Pointer- und Tastaturinteraktionen laufen in
   einem echten Chromium.

Der Fallback wird **nur** bei der genannten administrativen Blockmeldung
aktiviert. Jede andere Navigation- oder Anwendungsstörung bleibt ein harter
Testfehler. In einer normalen Umgebung läuft derselbe Smoke-Test direkt über
HTTP.

### Visuelle Nachweise

- `release_evidence/v60_1_workspace_light.png`
- `release_evidence/v60_1_workspace_dark.png`
- `release_evidence/v60_1_workspace_responsive.png`
- `release_evidence/v60_1_shortcut_help.png`

---

## 11. Reproduzierbarer Start und Betrieb

### Installation

```bash
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r requirements.txt
```

Node.js wird nur für die vollständige Entwicklungs-/Release-Prüfung benötigt:

```bash
npm install
```

Die Dev-Abhängigkeiten sind exakt auf Playwright `1.62.1` und TypeScript
`5.8.3` festgelegt.

### Lokaler Start

```bash
./run.sh
```

Danach:

```text
http://127.0.0.1:8090/
```

Optional können Host und Port explizit überschrieben werden:

```bash
./run.sh --host 127.0.0.1 --port 8090
```

### Externe Runtime-Autorität

```bash
AUTOMATION_RUNTIME=/pfad/zu/automation_system_v0101 ./test_all.sh
```

oder für den Start:

```bash
AUTOMATION_RUNTIME=/pfad/zu/automation_system_v0101 ./run.sh
```

### Vollständige Freigabeprüfung

```bash
./test_all.sh
```

---

## 12. Bekannte Hinweise und bewusst nicht behauptete Eigenschaften

1. Die externe `automation_system_v0101`-Runtime ist nicht Teil des Archivs.
   Ihre zusätzliche Typautorität kann deshalb nur in der Zielumgebung geprüft
   werden.
2. Acht bekannte `filter_id`-Hinweise bleiben sichtbar. Die lokale
   Vertragsprüfung akzeptiert sie gemäß bestehendem Runtime-Verhalten; sie
   wurden nicht stillschweigend entfernt.
3. Die Anwendung besitzt keine eingebaute Benutzerverwaltung. Externe
   Netzwerkfreigabe erfordert Reverse-Proxy, Authentifizierung und TLS.
4. Die mitgelieferten Projektdateien sind Fixtures/Demoprojekte. Eine
   anlagenspezifische FAT/SAT und die Prüfung realer SPS-/I/O-Hardware bleiben
   ein separater Inbetriebnahmeschritt.
5. Browserbilder belegen den gelieferten UI-Stand; sie ersetzen keine
   kundenspezifische Usability-Abnahme an jedem Zielgerät.

Diese Punkte sind keine verdeckten Mergefehler, sondern klare Systemgrenzen.

---

## 13. Release-Urteil

V60.1 erfüllt das Ziel eines nahtlosen, fachlich konsistenten Merges der vier
bereitgestellten Versionen:

- keine Rücknahme des byte-identischen V9-Fachvertrags;
- vollständige Wiederherstellung der V57.3-Sicherheitsbasis;
- Wiederaufnahme der wertvollen V56.3-Workspace-Funktionen;
- Erhalt der V58.2-Canvas- und UX-Verbesserungen;
- valide Projekt-SVGs;
- lokale Fonts und persistente Themes;
- funktionaler Quellstil ohne Klassen, Python-Lambdas, Decorators oder
  JavaScript-Arrow-Functions;
- reproduzierbare, vollständig grüne Release-Pipeline;
- dokumentierte Produktionsgrenzen.

**Freigabe:** V60.1 ist für den im Paket enthaltenen lokalen bzw. intern
abgesicherten Plant-Factory-/HMI-Engineering-Einsatz freigegeben. Für eine
externe Netzbereitstellung ist die in Abschnitt 9.4 beschriebene
Authentifizierungs- und TLS-Schicht verbindlich.

---

## 14. Navigationshilfe zu den wichtigsten Release-Dateien

| Datei | Zweck |
|---|---|
| `README.md` | Schnellstart und Bedienübersicht |
| `DIAGNOSE_UND_MERGE_V60_1_DE.md` | diese vollständige Diagnose |
| `docs/v60_1/ARCHITEKTUR_UND_BETRIEB_V60_1.md` | Architektur, Sicherheits- und Deploymentmodell |
| `docs/v60_1/RELEASE_TESTS_V60_1.md` | vollständiges Testprotokoll und Testkommandos |
| `docs/v60_1/MERGE_MANIFEST_V60_1.json` | maschinenlesbare Merge-Entscheidungen |
| `docs/v60_1/DATEI_INVENTAR_V55_2_BIS_V60_1.json` | vollständige Hash-/Metadatenanalyse |
| `docs/v60_1/DATEI_DIFFERENZ_MATRIX_V55_2_BIS_V60_1.csv` | tabellarischer Pfadvergleich |
| `release_evidence/README.md` | Zuordnung der visuellen Nachweise |
| `test_all.sh` | verbindliche Release-Prüfkette |
| `config/server.yaml` | lokale Server- und Sicherheitskonfiguration |
