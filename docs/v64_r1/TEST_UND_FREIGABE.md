# V64_r1 – Test und Freigabe

## Prüfstrategie

Die Freigabe kombiniert statische Verträge, Modelltests, reale Chrome-Interaktion, visuelle Screenshots und Pixelvergleich. Die Tests verändern keine Projekt- oder Nutzdaten.

## Verifizierte Kriterien

- 35 Inventar-Templates werden vollständig dargestellt und innerhalb ihrer Preview-Fläche beschnitten.
- Drag-and-drop erzeugt exakt eine Entity.
- Klick-Platzierung ist einmalig.
- Auswahlrahmen folgt der tatsächlich gerenderten Geometrie.
- Inspektor und Inventarvorschau aktualisieren sich ohne Canvas-Zwischenschritt.
- Pan funktioniert horizontal und vertikal; Zoom bleibt erhalten.
- Light, Dark und Dark-Brown erzeugen unterschiedliche, konsistente Canvas-Zustände.
- Der Rohrreaktor besitzt keine offene oder keilförmige Füllkontur.
- Reaktor-P&ID: 118 Top-Level-Fragmente und 48 SMIL-Elemente.
- Rohrofen: 85 Top-Level-Fragmente und 46 SMIL-Elemente.
- P&ID-Anlage: 94 Top-Level-Fragmente und 66 SMIL-Elemente.
- Alle importierten Referenzblätter besitzen Eventziele und exportieren dieselbe Zahl von Animationselementen.
- Quelle und Export besitzen am SMIL-Startzeitpunkt identische Pixel-Hashes.
- Bestehende V64-Modell- und Browserverträge bleiben grün.

## Finaler lokaler Nachweis

- Haupt-Workflow über alle zentralen Seiten, Tabs, Dialoge, Themes und Responsive-Zustände: 119/119 bestanden.
- V62 Browserregression: 45/45 bestanden.
- V63 Browserregression: 51/51 bestanden.
- V63.2 Browserregression: 45/45 bestanden.
- V63.3 Browserregression: 60/60 bestanden.
- V63.4 Browserregression: 57/57 bestanden.
- V64 Browserregression: 46/46 bestanden.
- V64_r1 Chrome-/Visual-/Pixelvertrag: 44/44 bestanden.
- V64 Basismodell: 13/13 bestanden.
- V64 Basiskontrakt: 100/100 bestanden.
- V64_r1 Releasekontrakt: 40/40 bestanden.
- JavaScript-Regressionssuiten: 376/376 bestanden.
- Sicherheits-, API-, SVG-, Shard-, Merge-, Migrations-, Format- und Reproduzierbarkeitsprüfungen: bestanden.
- Verbotene neue Lambda-/Arrow-/OOP-Konstrukte: keine festgestellt; Treffer in Datenwerten, CSS-Klassen oder den Prüfroutinen selbst sind keine Codekonstrukte.

Maßgeblich für das unveränderte Paket sind zusätzlich das interne `SHA256SUMS`, der ZIP-Sidecar und die abschließende Remote-Prüfung.
