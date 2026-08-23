# V63.4 – Test- und Freigabevertrag

## Zielprüfungen

V63.4 ergänzt die geerbte Prüfkette um:

- statischen Vertrag `test/test_v63_4_release.py`;
- Chromium-Regressionslauf `test/smoke_v63_4.py`;
- sichtbare Single-Navigation;
- verborgene, aber vorhandene Legacy-Tabs;
- Buttondarstellung im Widgetregister;
- geführten Zustands-/Alarm-Workflow;
- vollständigen Expertenzugriff;
- geführte Darstellung mit unverändertem Widgetmodell.

## Freigabeergebnis

Die vollständige 20-stufige Releasekette wurde im Quellbaum und erneut aus dem
unveränderten, frisch extrahierten finalen ZIP bestanden. Die externe
`automation_system_v0101`-Autorität wurde mit 29/29 Prüfungen validiert.

Die Chromium-Kette besteht aus:

- Basisvertrag: 119/119;
- V62.1-Interaktionen: 45/45;
- V63.1-Logic/FBD: 51/51;
- V63.2-Stabilitätsregressionen: 45/45;
- V63.3-I/O/HMI-UX: 60/60;
- V63.4-HMI-Workflow-UX: 57/57;
- kombiniert: 377/377 bei null Konsolen-, Seiten- oder Requestfehlern.

## Archivvertrag

Das finale Archiv enthält 387 Dateien und 386 Einträge im internen
`SHA256SUMS`. Zwei unabhängige deterministische Builds sind byte-identisch.
Archivpfade, interne Prüfsummen, Ausführungsrechte und Ausschlüsse für
`.venv`, `node_modules`, `__pycache__` und temporäre Testverzeichnisse wurden
validiert.

## Verbindliche Freigabekriterien

Ein Release gilt als freigegeben, weil:

1. alle statischen und dynamischen Verträge bestehen;
2. die externe `automation_system_v0101`-Autorität besteht;
3. der Quellbaumtest vollständig besteht;
4. zwei deterministische ZIP-Builds byte-identisch sind;
5. Archivpfade, Symlinks und interne Prüfsummen validiert sind;
6. der identische Test aus dem frisch extrahierten finalen ZIP besteht;
7. keine Browser-, Konsolen-, Seiten- oder Requestfehler auftreten.
