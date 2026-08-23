# Architektur und Betrieb — Plant Factory V60.1

## 1. Systemgrenze

V60.1 ist eine lokale bzw. intern abgesicherte Engineering-Anwendung für
P&ID-/HMI-Entwurf, Plant-Factory-Konfiguration, Regeln, Prozesse, Topologie,
Validierung und Rollout-Projektion. Das Paket besteht aus:

- einem funktional aufgebauten Python-/aiohttp-Dienst;
- einer modularen browserseitigen Engineering-Oberfläche;
- einer kanonischen V9-Konfiguration;
- lokalen V9-Node-Shards und fail-closed V8-Cross-Shards;
- SVG-Templates, Projekten, HMI-Snapshot-/Exportlogik;
- Build-, Migrations-, Format- und Prüfwerkzeugen.

Die Anwendung ist kein direkt ins Internet exponierbarer Mehrbenutzerdienst.
Schreibende API-Routen werden standardmäßig ausschließlich auf Loopback
bereitgestellt.

## 2. Laufzeitarchitektur

```text
┌──────────────────────────────── Browser ────────────────────────────────┐
│                                                                        │
│  V60 Workspace Shell                                                  │
│  ├─ Bibliothek / Favoriten / Suche                                    │
│  ├─ Canvas / Elemente / Verbindungen / Minimap                        │
│  ├─ Inspector: Details, I/O, HMI, Linien, Ebenen                       │
│  ├─ Prozesse / Regeln / Zustände / Topologie / Cross / Validierung     │
│  └─ HMI / Snapshot / Export                                            │
│                                                                        │
│  ES-Module                                                             │
│  ├─ core.js: API, State, History, Theme, Utilities                     │
│  ├─ elements.js: SVG-Elemente und Canvas                              │
│  ├─ connection_mapper.js: Verbindungen und Ports                       │
│  ├─ ui.js: Inspector, Projekte, Export                                 │
│  ├─ v9_*.js: Schema, Store, Migration, Shards, Validierung, Panels      │
│  ├─ v56_workspace.js: Workspace-Interaktion                            │
│  └─ v60_ui.js: Merge-Integration und Accessibility                     │
└───────────────────────────────┬────────────────────────────────────────┘
                                │ HTTP/JSON/SVG
                                ▼
┌──────────────────────── Python / aiohttp ──────────────────────────────┐
│ svg_editor_tool.py                                                     │
│ ├─ Konfiguration und Startparameter                                    │
│ ├─ Security Middleware                                                 │
│ ├─ sichere Projekt-/Exportpfade                                        │
│ ├─ SVG-Sanitisierung                                                   │
│ └─ Route-Komposition                                                   │
│                                                                        │
│ _server_v9.py                                                          │
│ ├─ V9-Konfigurations-API                                               │
│ ├─ Normalisierung und Formatierung                                     │
│ ├─ atomare Config-Schreibpfade                                         │
│ ├─ V9-Node-/V8-Cross-Projektion                                        │
│ └─ optionale Runtime-Typautorität                                      │
└───────────────────────────────┬────────────────────────────────────────┘
                                │ Dateien
                                ▼
┌──────────────────────────── Persistenz ────────────────────────────────┐
│ config/device_state_data_v9.json                                      │
│ config/shards/*.json                                                   │
│ config/rule_library_v9.json                                            │
│ config/process_library_v9.json                                         │
│ projekte/*.json und projekte/*.svg                                     │
│ public/svg_templates/**/*.svg                                          │
└────────────────────────────────────────────────────────────────────────┘
```

## 3. Funktionale Modulgrenzen

### 3.1 Backend

`svg_editor_tool.py` erzeugt den Dienst durch Funktionen und explizite
Zustandsobjekte. Es gibt keine Serverklasse und keinen versteckten
Singleton-Lebenszyklus. Die Kernverantwortungen sind getrennt:

- Konfiguration lesen und normalisieren;
- sichere Pfade und Namen erzeugen;
- SVG parsen und sanitizen;
- Handler als Funktionen erzeugen;
- Middleware zusammensetzen;
- `aiohttp.web.Application` konfigurieren;
- Startparameter anwenden.

`_server_v9.py` kapselt den fachlichen V9-Vertrag. Das Modul bleibt auch für
reine Build-/Shard-Aufgaben importierbar, wenn `aiohttp` nicht benötigt wird.
Schreibvorgänge nutzen atomare Replace-Semantik.

### 3.2 Frontend

Der Browserzustand liegt in funktionalen Stores und Maps. Module exportieren
Factory-Funktionen oder Funktionsobjekte; Klassen und Arrow Functions sind im
produktiven JavaScript nicht erlaubt und werden AST-basiert geprüft.

Die neue V60-Schicht ist absichtlich integrationsorientiert. Sie dupliziert
keine Fachmodelle, sondern verbindet vorhandene Module:

- Menüstatus und Fokus;
- Palette und Persistenz;
- Auto-Fit und Minimap;
- Inspector-Apply;
- Rail-/Tab-/Menü-Tastaturnavigation;
- Dialog-Fokusfalle;
- responsive Zustände.

### 3.3 Konfiguration

Der Master ist die einzige fachliche Quelle. Shards sind deterministische
Projektionen:

```text
V9 Master
├─ V9 Node fn-01
├─ V9 Node fn-02
└─ V8 Cross owner fn-01
```

Der Cross-Shard enthält bewusst keine lokalen Busparameter. Regeln werden
fail-closed nur dann in den Cross-Bereich projiziert, wenn Scope, Eigentümer
und mutierte States den Vertrag erfüllen.

## 4. Datenflüsse

## 4.1 Projekt laden

1. Browser ruft die Projektliste ab.
2. Ein Projekt wird über einen sicheren, serverseitig normalisierten Namen
   geladen.
3. JSON liefert Element-, Verbindungs- und Projektzustand.
4. SVG liefert die persistierte Darstellung bzw. den Exportstand.
5. `elements.js` baut die Element-Map und den Canvas neu auf.
6. `connection_mapper.js` rekonstruiert Portbeziehungen.
7. `v56_workspace.js` und `v60_ui.js` aktualisieren Fit, Minimap, Kontext und
   Status.

## 4.2 Projekt speichern

1. Der Browser sendet Projektmetadaten, Modell und SVG.
2. Der Server normalisiert den Namen und begrenzt den Zielpfad auf
   `projekte_dir`.
3. SVG wird vor Persistenz sanitiziert.
4. JSON und SVG werden atomar geschrieben.
5. Erst nach erfolgreichem Replace wird Erfolg gemeldet.

## 4.3 V9-Konfiguration

1. `v9_store.js` lädt die kanonische Konfiguration.
2. Schema, Migration und Validierung erzeugen eine normalisierte Projektion.
3. `v9_bootstrap.js` spiegelt diese Projektion in den kompatiblen App-State.
4. Topologie-, Zustands-, Regel-, Cross- und Validierungspanels lesen aus
   demselben Store.
5. Speichern formatiert deterministisch und schreibt atomar.

## 4.4 HMI und Export

- Element- und Bindingdaten werden in das HMI-Modell adaptiert.
- Animation und Signalbrücke werden aus dem gleichen Modell erzeugt.
- Ein Konfigurations-Snapshot wird eingebettet und kann verifiziert werden.
- Der Export entfernt Editor-Auswahlzustände und sanitiziert das SVG.
- Das SCADA-Bundle bleibt mit seinem bestehenden Fünf-Dateien-Vertrag
  kompatibel.

## 5. Sicherheitsmodell

### 5.1 Vertrauenszonen

| Zone | Vertrauen | Maßnahme |
|---|---|---|
| lokaler Paketquellstand | kontrolliert | Hashes, Tests, keine Laufzeitdownloads |
| Projekt-/SVG-Upload | untrusted | Größenlimit, XML-Parser, Sanitisierung |
| Browserdaten | untrusted | serverseitige Pfad- und Inhaltsprüfung |
| externe Runtime | optional trusted authority | nur explizit über Pfad eingebunden |
| externes Netzwerk | untrusted | keine direkte Freigabe; Reverse-Proxy erforderlich |

### 5.2 SVG-Regeln

Erlaubt sind passive SVG-Geometrie, lokale IDs und lokale Fragmentreferenzen.
Entfernt oder abgewiesen werden aktive Inhalte, externe Ressourcen,
Ereignisattribute, CSS-Remote-URLs, `DOCTYPE` und `ENTITY`.

### 5.3 HTTP-Regeln

- Loopback-Bindung als Standard;
- CORS aus;
- CSP und weitere Security Header auf Erfolgs- und Fehlerantworten;
- kein stiller Fallback auf ein öffentliches Interface;
- Host/Port nur explizit überschreibbar.

### 5.4 Persistenzregeln

- Zielpfade werden auf konfigurierte Wurzeln begrenzt;
- Namen werden normalisiert;
- Schreibvorgänge erfolgen über temporäre Geschwisterdatei und atomaren
  Replace;
- ein fehlgeschlagener Schreibvorgang darf die letzte gültige Datei nicht
  partiell überschreiben.

## 6. Konfiguration des Dienstes

`config/server.yaml` enthält die Betriebsdefaults:

```yaml
server:
  host: "127.0.0.1"
  port: 8090
  debug: false

upload:
  max_file_size: 10485760
  allowed_extensions:
    - ".svg"

security:
  enable_cors: false
  allowed_origins: []
```

Relative Pfade werden gegen das Paketverzeichnis aufgelöst. Dadurch ist der
Start unabhängig vom aktuellen Shell-Arbeitsverzeichnis, sofern `run.sh`
verwendet wird.

## 7. Deploymentmuster

## 7.1 Lokaler Engineering-Arbeitsplatz

```bash
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r requirements.txt
./run.sh
```

Zugriff ausschließlich über `http://127.0.0.1:8090/`.

## 7.2 Interner Server hinter Reverse-Proxy

Verbindliche Eigenschaften des Proxys:

- TLS-Terminierung;
- Benutzer- oder Maschinen-Authentifizierung;
- rollenbasierte Autorisierung für schreibende Routen;
- Request- und Upload-Limits mindestens so restriktiv wie V60.1;
- Audit-Logging;
- kein ungefilterter öffentlicher Zugriff auf den aiohttp-Port.

Erst hinter dieser Schicht darf der Host bewusst erweitert werden.

## 7.3 Externe Automation-Runtime

Die Runtime wird nicht in das Paket kopiert. Sie wird explizit eingebunden:

```bash
export AUTOMATION_RUNTIME=/opt/automation_system_v0101
./run.sh
```

`run.sh` ergänzt den Pfad kontrolliert zu `PYTHONPATH`. Die Release-Prüfung
verwendet denselben Mechanismus.

## 8. Backup und Wiederherstellung

Zu sichern sind mindestens:

- `config/device_state_data_v9.json`;
- `config/shards/`;
- `config/rule_library_v9.json`;
- `config/process_library_v9.json`;
- `projekte/`;
- anlagenspezifisch ergänzte `public/svg_templates/`.

Vor einer Wiederherstellung sollten `SHA256SUMS` und die JSON-/SVG-Parsertests
ausgeführt werden. Shards können aus dem Master reproduzierbar neu erzeugt
werden; sie sind keine unabhängige fachliche Quelle.

## 9. Monitoring und Logs

Der Server schreibt strukturierte Python-Logs gemäß `config/server.yaml`.
Für einen produktiven Host sind zusätzlich sinnvoll:

- Prozessüberwachung über systemd oder Container-Orchestrierung;
- Healthcheck auf den Editor-Einstieg und die V9-Config-API;
- Alarmierung bei Schreib- und Parserfehlern;
- Rotation des konfigurierten Logfiles;
- Reverse-Proxy-Zugriffsprotokoll mit Benutzerkontext.

## 10. Upgradepfad nach V60.1

1. Bestehendes Paket vollständig sichern.
2. V60.1 separat entpacken; keine Dateien in einen laufenden Altstand
   überschreiben.
3. Kundenspezifische Projekte und Templates kontrolliert übernehmen.
4. `./test_all.sh` ausführen.
5. Optional externe Runtime-Autorität einbinden und erneut prüfen.
6. Projektdateien laden, speichern und exportieren.
7. Fachliche FAT/SAT mit realer SPS-/I/O-Umgebung durchführen.
8. Erst danach den Altstand außer Betrieb nehmen.

Ein direktes Dateikopieren einzelner V58.2-Backenddateien in V60.1 ist wegen
der nachgewiesenen Security-Regression ausdrücklich zu vermeiden.

## 11. Wartungsregeln für Folgereleases

- V9-Masteränderungen benötigen Migration, Formatparität, Shard-Rebuild und
  Regelvertragstest.
- Änderungen an `public/index.html` benötigen Markup- und Browser-Smoke.
- Änderungen an SVG-Eingang oder Export benötigen Security- und Convertertest.
- Neue JavaScript-Dateien müssen in der funktionalen AST-Prüfung enthalten
  sein.
- Neue Python-Dateien dürfen keine Klassen, Lambdas oder Decorators enthalten.
- UI-Features dürfen nicht durch Entfernen ihrer Tests „grün“ gemacht werden.
- Security-Dateien aus einem früheren Zweig dürfen nie durch einen visuellen
  Merge blind überschrieben werden.
