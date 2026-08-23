# Release-Prüfprotokoll V56.1

**Stand:** 2026-08-12  
**Release:** 56.1.0  
**Prüfumgebung:** Linux, Python 3, Node.js, Chromium über `CHROMIUM_PATH`

## Ergebnis

Alle lokal ausführbaren Release-Prüfungen bestanden. Es verbleiben keine
fehlgeschlagenen Syntax-, Vertrags-, Regression-, Snapshot-, Routing- oder
Browserprüfungen.

| Stufe | Prüfung | Ergebnis |
|---:|---|---|
| 1 | Python-Syntax aller Server-, Tool- und Testdateien | bestanden |
| 2 | JavaScript-/MJS-Syntax, keine Frontend-Klassen, kein `ONOFF` | bestanden |
| 3 | V56.1-Workspace-Invarianten | bestanden |
| 4 | Editor/Server/Runtime-Formatparität | 58 + 42 bestanden |
| 5 | reproduzierbarer Config-Build | bestanden, Master bytegleich |
| 6 | deterministische V50→V9-Migration | bestanden |
| 6 | Controller-UUID-Baseline | 5 von 5 korrekt |
| 7 | V9-Node-/V8-Cross-Split | bestanden |
| 7 | realer Cross-Worker-Fall | Regeln 3, 6 und 30 |
| 8 | V9-Regel- und Prozessbibliotheken | bestanden, bytegleich |
| 9 | Regelvertrag | 15 bestanden, 0 fehlgeschlagen |
| 10 | Plant-Factory-Kette | 31 bestanden, 0 fehlgeschlagen |
| 11 | Konfigurations-Snapshot | 52 bestanden, 0 fehlgeschlagen |
| 12 | V9-Kernregression | 145 bestanden, 0 fehlgeschlagen |
| 13 | verpflichtender Browser-Smoke | 79 bestanden, 0 fehlgeschlagen |
| Zusatz | erweiterter UI-/Routing-Audit | 103 bestanden |
| Zusatz | Browser-Page-Errors | 0 |
| Zusatz | fehlgeschlagene Browser-Requests | 0 |

## Geprüfte UI-Zustände

- Engineering mit leerem Canvas,
- Engineering mit geladenem Projekt,
- ausgewähltes Element und Properties-Inspektor,
- Automatisierung / Prozesse,
- Topologie,
- Validierung,
- Runtime / HMI,
- Dark Mode,
- Desktop 1680 × 1000,
- Responsive 1366 × 768.

## Externe Tiefprüfung

Die externe Automation-Runtime war in der Prüfungsumgebung nicht im
`PYTHONPATH`. Deshalb wurde ausschließlich die zusätzliche Prüfung gegen die
externe Runtime-Type-Authority übersprungen. Die lokalen Format-, Regel-,
Shard-, Migrations- und Regressionstests blieben vollständig aktiv.

Der Regelvertrag meldet weiterhin den bekannten Integrationshinweis, dass
mehrere Bedingungen `filter_id` setzen, während die referenzierte Runtime bei
leerem Filterkontext auf Rohwerte zurückfällt. Es handelt sich um einen
bekannten fachlichen Integrationspunkt aus dem Bestand, nicht um einen
fehlgeschlagenen V56.1-Test.
