# V64 – Test- und Freigabevertrag

## Ziel

Die Freigabe verlangt Nachweise für neue V64-Funktionen und alle geerbten
V63.4-Verträge.

## Statische V64-Prüfung

~~~bash
python3 test/test_v64_release.py
~~~

Prüft:

- Releasekennung;
- erforderliche Dateien;
- Navigation und CSS-Einbindung;
- Event-Schema und zehn Effekte;
- HMI- und Runtimekopplung;
- Zeichenmodell und Bedienfunktionen;
- neun neue Templates;
- semantische Ports und Animationsziele;
- Projekt-/V9-Export;
- funktionalen Codestil;
- JavaScript-Syntax;
- Start- und Paketpfade.

## Funktionaler Modelltest

~~~bash
node test/test_v64_model.mjs
~~~

Prüft:

- Rohrofen-Beispiel;
- Entity-/Portnormalisierung;
- Port-Weltkoordinaten;
- orthogonale Verbindung;
- interne und externe Baugruppenports;
- Duplizieren und Löschen;
- Event-Regeln und Temperaturanimation.

## Geerbte Tests

Mindestens:

~~~bash
npm test
python3 test/test_v63_4_release.py
python3 test/test_server_api.py
python3 test/test_security.py
python3 test/test_markup.py
~~~

Die vollständige Prüfkette bleibt:

~~~bash
./test_all.sh
~~~

## Builderprüfung

~~~bash
python3 _tools/build_symbol_standard.py
~~~

Erwartung:

- 35 Templates;
- deterministisches Manifest;
- neun V64-Templates;
- keine verlorenen V63.4-Symbole.

## Browserprüfung

Prüfschritte:

1. Seite ohne Console-/Page-Fehler öffnen.
2. Menü **Zeichnen** öffnen.
3. Kategorie Rohrbauteile und neue Geräte sichtbar.
4. Rohrofen-Beispiel laden.
5. Entities, Verbindungen und Beschriftung sichtbar.
6. Entity auswählen und Inspektor prüfen.
7. Verbindungstool aktivieren und Ports prüfen.
8. Mehrfachauswahl und Vorschau prüfen.
9. Inventarübernahme gegen temporären Testnamen prüfen.
10. HMI **Zustände & Alarme** öffnen.
11. Animationsdesigner, Presets und Zielfelder prüfen.
12. Regel speichern, Vorschau und Exportmodell prüfen.
13. Projekt speichern/laden und neue Sektionen vergleichen.

## API-Prüfung

- GET /;
- GET /api/templates;
- POST /api/templates/neu-laden;
- Projektlisten-/Lade-/Speicherpfade;
- V9-Konfiguration;
- V9-Validierung;
- Shardpfade;
- Traversal- und Sanitizer-Negativfälle.

## Exportprüfung

Erwartete Kernartefakte:

~~~text
<projekt>.svg
<projekt>.json
<projekt>.html
signals.json
hmi_runtime.js
svg_event_runtime.js
PF-LOGIC-Artefakte
~~~

JSON muss enthalten:

~~~text
hmi_ui.event_animations
hmi_ui_report.event_animations
plant_drawing
plant_drawing_report
hmi_ui.plant_drawing_ref
~~~

## Archivprüfung

~~~bash
python3 _tools/create_sha256_manifest.py
python3 _tools/create_sha256_manifest.py --check
python3 _tools/build_release_archive.py \
  --output ../Automated_SVG_Integration_64.zip
python3 _tools/verify_release_archive.py \
  ../Automated_SVG_Integration_64.zip
~~~

Zusätzlich wird eine externe SHA-256-Sidecar-Datei erstellt.

## Deploymentprüfung

- Archiv auf Testhost übertragen;
- in /home/philo/Automated_SVG_Integration_64 bereitstellen;
- Start ausschließlich über das enthaltene start_plant_factory.sh;
- Listener auf 0.0.0.0:8090 prüfen;
- URL http://192.168.0.80:8090/ prüfen;
- statische und API-Tests gegen den laufenden Dienst wiederholen;
- Log auf Traceback, Exception und Error prüfen.

## Ergebnis

Lokaler Freigabestand vom 22. August 2026:

| Prüfbereich | Ergebnis |
|---|---:|
| V64-Releasevertrag | 100 bestanden, 0 fehlgeschlagen |
| V64-Zeichen-/Animationsmodell | 13 bestanden, 0 fehlgeschlagen |
| isolierte Server-API, Sanitizer und Persistenz | 15 bestanden, 0 fehlgeschlagen |
| echte Chrome-Regressionskette V61 bis V64 | 423 bestanden, 0 fehlgeschlagen |
| davon neuer V64-End-to-End-Ablauf | 46 bestanden, 0 fehlgeschlagen |

Die Browserkette umfasst die geerbten Oberflächenverträge und den neuen
Zeichnen-/Animationsablauf. Es traten keine Console-, Page- oder
Request-Fehler auf. Die Nachweisbilder liegen unter **release_evidence/**.

Die drei bereitgestellten SVG-Generatoren wurden in einem isolierten
temporären Verzeichnis ausgeführt. Alle animierten Ausgaben stimmen nach
einheitlicher LF-Zeilenenden-Normalisierung exakt mit den Referenz-SVGs
überein. Die abweichenden Byte-Hashes der Windows-Dateien entstehen
ausschließlich durch CRLF statt LF.

Zusätzlich bestanden die vollständigen geerbten V9-, PF-LOGIC-, Automation-,
PID-, HMI-, Sicherheits-, Markup-, Snapshot- und Releaseverträge. Die neuen
Python- und JavaScript-Module enthalten keine Klassen, Lambdas, Decorators
oder Arrow-Funktionen; alle JavaScript-Dateien bestanden die Syntaxprüfung.

### Archivfreigabe

- 417 Dateien im deterministischen ZIP;
- 416 Nutzdateien durch das eingebettete **SHA256SUMS** verifiziert;
- zwei unabhängige Paketbauten mit identischem SHA-256-Hash;
- externes **.zip.sha256**-Sidecar für die Downloadprüfung;
- keine virtuelle Umgebung, Node-Module, Caches oder temporären Testdateien im
  Paket.

### Testhostfreigabe

| Merkmal | Ist-Stand |
|---|---|
| URL | http://192.168.0.80:8090/ |
| Listener | 0.0.0.0:8090 |
| Prozess | PID 701197 |
| Releasepfad | /home/philo/Automated_SVG_Integration_64 |
| Start | direkt über das enthaltene start_plant_factory.sh |
| Startlog | /home/philo/plant_factory_v64_c8b59a46de3b.log |
| Remote-API | 15 bestanden, 0 fehlgeschlagen |
| Remote-Security | 16 bestanden, 0 fehlgeschlagen |
| Remote-Markup/Integration | 20 bestanden, 0 fehlgeschlagen |
| Remote-Chrome V64 | 46 bestanden, 0 fehlgeschlagen |

Der Prozess läuft aus dem V64-Releasepfad und verwendet die vorhandene,
geprüfte Python-Laufzeit. Das Startlog enthält keine Fehler, Exceptions oder
Tracebacks.

Für den bewusst unverschlüsselten LAN-Test wurde Chrome ausschließlich im
Testlauf angewiesen, die Origin als vertrauenswürdig zu behandeln. Ohne TLS
weist Chrome korrekt darauf hin, dass **Cross-Origin-Opener-Policy** auf einer
unsicheren Origin ignoriert wird. Der Produktcode und seine Security-Header
wurden dafür nicht abgeschwächt; TLS bleibt ein offener Produktionspunkt.
