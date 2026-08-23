# V64_r6 – Test und Freigabe

## Freigabeumfang

Die R6-Freigabe prüft die sichtbare Kategoriennavigation, Tastaturbedienung,
strukturierte Speicherung, serverseitige Normalisierung, Platzierung als
elementare Anlagenobjekte, Migration eines passenden flachen Altobjekts sowie
die vollständige Rückwärtskompatibilität bis V64_r5.

## Deterministische Verträge

| Prüfung | Ergebnis |
|---|---:|
| V64 Basis-Releasevertrag | 100/100 |
| V64_r1 Releasevertrag | 40/40 |
| V64_r2 Releasevertrag | 49/49 |
| V64_r3 Releasevertrag | 86/86 |
| V64_r4 Releasevertrag | 128/128 |
| V64_r5 Releasevertrag | 199/199 |
| V64_r6 Modellvertrag | 16/16 |
| V64_r6 statischer Releasevertrag | 60/60 |
| V64_r6 Serververtrag | 13/13 |
| V64_r6 Browser- und Visualvertrag | 29/29 |

## R6-Browservertrag

Der Browserlauf verwendet eine getrennte Google-Chrome-Instanz mit
deviceScaleFactor 1: 900 × 780 Pixel für die schmale Kategorienansicht und
1920 × 1080 Pixel für die Baugruppenansichten. Er prüft:

- V64_r6-Titel, Releasevertrag und geladene additive Styles;
- real sichtbaren horizontalen Scrollbalken;
- Tablistenrollen, Auswahlstatus und roving tabindex;
- Ende, Pos1 und Pfeilnavigation mit Sichtbarhalten;
- Karte **Anlagen Entwurf** unter Zeichen-Inventar → Baugruppen;
- strukturierte Übernahme über die Online-UI;
- Kennzeichen **Baugruppe · 31 Teile** im Anlagen-Inventar;
- Platzierung als 31 Parts plus eine passive Layout-Entity;
- echtes Drag-and-Drop an eine sichtbare Canvasposition;
- 14 reale Anlagenverbindungen;
- Auswahl eines Rohrofens als einzelne Entity;
- Erreichbarkeit der Device-/I/O- und HMI-Konfiguration;
- keine doppelte eingebettete Geräte-/Verbindungsdarstellung;
- explizite Migration einer passenden flachen Custom-Entity;
- Sichtbarkeit der strukturierten und migrierten Einzelteile;
- keine Console-, Page- oder Requestfehler.

## Visuelle Nachweise

| Datei | Zustand |
|---|---|
| V64_r6_01_Accessible_Inventory_Scrollbar.png | Kategorienzeile mit sichtbarer Scrollbar und Tastaturfokus |
| V64_r6_02_Drawing_Assembly_Inventory.png | Anlagen Entwurf direkt im Zeichen-Inventar unter Baugruppen |
| V64_r6_03_Structured_Assembly_Parts.png | Anlagenbild mit strukturiert eingesetzter Baugruppe und einzeln ausgewähltem Gerät |
| V64_r6_04_Legacy_Assembly_Upgrade.png | explizite Inspektoraktion für einen passenden flachen Altentwurf |

Die Aufnahmen stammen aus dem bestandenen aktuellen Freigabelauf und liegen
unter release_evidence. Sie belegen die geprüften Zustände, nicht eine
allgemeine Barrierefreiheitszertifizierung.

## Sicherheits- und Kompatibilitätskriterien

- keine aktiven Skripte, Eventhandler oder externen Ressourcen in Custom-SVGs;
- serverseitige Normalisierung der eingebetteten Baugruppe;
- keine hängenden internen Verbindungen;
- nur skalare freie Entity-Eigenschaften;
- unbekannter Kompositionsmodus fällt auf flat zurück;
- PF-PID-V1-Bibliothek bleibt bei 71 Templates;
- keine Projekt-, V9-, Automation-, Runtime- oder HMI-Schemaänderung;
- funktionaler Stil ohne Klassen, Lambda-/Arrow-Funktionen oder Decorators;
- vollständiges Archiv wird gegen seinen internen SHA-256-Manifest geprüft.

## Freigabebefehl

    ./test_all.sh

Die eindeutige Erfolgsmeldung lautet:

    ALL V64_R6 RELEASE CHECKS PASSED
