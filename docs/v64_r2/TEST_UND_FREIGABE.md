# V64_r2 – Test und Freigabe

## Prüfumfang

- statischer R2-Releasevertrag
- PF-AUTOMATION-STUDIO-V1-Integrationsvertrag
- funktionaler Python-/JavaScript-Stil
- vollständige V62–V64_r1-Abwärtskompatibilität
- alle sieben Automation-Studio-Views
- atomarer Mehrsektions-Commit und unbekannte Sektionsabwehr
- Light, Dark, Dark-Brown und Responsive
- vollständiger Hauptworkflow über alle Seiten, Tabs, Dialoge und Exporte
- Sicherheits-, API-, Modell-, Shard-, Merge-, Migrations- und Reproduzierbarkeitsprüfungen

## Visuelle Kriterien

- keine Überlagerung oder abgeschnittene Hauptinhalte
- konsistente Typografie, Abstände, Radien, Linien und Farbtokens
- drei klar getrennte Arbeitsbereiche für Inventar, Editor und Kontext
- erkennbare aktive Navigation und verständliche Zustände
- keine CSS-Auswirkung außerhalb des Automation-Studio-Hosts

## Lokale Freigabematrix

Der vollständige 20-stufige Releasepfad wurde am 22. August 2026 ohne Fehler ausgeführt.

| Prüfbereich | Ergebnis |
|---|---:|
| Hauptworkflow, alle Seiten und globale Routen | 124/124 |
| V62 Browser-Regression | 45/45 |
| V63 Browser-Regression | 51/51 |
| V63.2 Browser-Regression | 45/45 |
| V63.3 Browser-Regression | 60/60 |
| V63.4 Browser-Regression | 57/57 |
| V64 Browser-Regression | 46/46 |
| V64_r1 Browser- und Visualvertrag | 44/44 |
| V64_r2 Browser- und Visualvertrag | 37/37 |
| V64 statischer Releasevertrag | 100/100 |
| V64_r1 statischer Releasevertrag | 40/40 |
| PF-AUTOMATION-STUDIO-V1-Integration | 45/45 |
| V64_r2 statischer Releasevertrag | 49/49 |
| V64-Zeichenmodell | 13/13 |
| JavaScript-Modell- und Regressionsprüfungen | 376/376 |

Zusätzlich bestanden Python-Syntax und funktionaler Stil, JavaScript-Syntax und funktionaler Stil, Formatparität, deterministischer Konfigurationsbau, Migration, V9-/V8-Sharding, Regelvertrag, Projektmodellkette, Sicherheitsprüfungen, interne Prüfsummen und der reproduzierbare Archivvertrag.

## Visueller Abgleich

Die sieben Automation-Studio-Views wurden in Light, Dark und Dark-Brown sowie in Desktop- und responsiven Viewports geprüft. Cockpit, Prozesse & States, Regeln, Filter & Timer, Bibliothek, Rule-Engine und Gerätekarte zeigen keine abgeschnittenen Hauptinhalte, Überlagerungen oder Designsystemabweichungen. Die V64_r1-Referenzimporte bleiben visuell und bytegenau reproduzierbar.

## Paket- und Remote-Freigabe

Das Releasearchiv umfasst 453 Dateien und 452 interne SHA-256-Einträge. Zwei unmittelbar aufeinanderfolgende Builds waren bitgenau identisch. `node_modules`, virtuelle Umgebungen, Testserverlogs, Browserprofile, temporäre Screenshots und Python-Caches sind ausgeschlossen. Der externe Archivhash wird wegen seiner Selbstreferenz ausschließlich in der separaten `.zip.sha256`-Datei geführt.

Auf der Testumgebung wurde der Listener auf `0.0.0.0:8090` mit dem Arbeitsverzeichnis `/home/philo/Automated_SVG_Integration_64_r2` verifiziert. 18/18 lesende Remote-Prüfungen für Einstieg, R2-Markup, Automation Panel, Security-Header, V9-Konfiguration, 35 Inventarobjekte und zentrale Assets bestanden. Die gezielten Remote-Browserverträge bestanden mit 44/44 für V64_r1 und 37/37 für V64_r2.

Der umfassende Remote-Hauptworkflow ergab 122/124: Die beiden einzigen Meldungen sind identische Chromium-Infrastrukturwarnungen, weil `Cross-Origin-Opener-Policy` auf der ausdrücklich unverschlüsselten HTTP-Testadresse nicht wirksam werden kann. Es liegen keine Anwendungs-, Request-, Seiten-, JavaScript-, API- oder Layoutfehler vor. Für eine wirksame COOP-Isolation bleibt ein TLS-Reverse-Proxy der bereits dokumentierte Produktionspunkt.
