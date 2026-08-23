# Diagnose und Freigabe – Plant Factory V64_r1

## Ziel und Befund

Die Beanstandungen waren reproduzierbar und hatten vier voneinander unabhängige Ursachen: eine offene Reaktorpfadgeometrie, nominelle statt visuelle Auswahlgrenzen, unvollständige Pointer-/Drag-and-drop-Zustände sowie fest auf helle Darstellung ausgelegte Zeichenflächen. Zusätzlich war das bisherige Komponentenmodell für komplette Referenzdiagramme zu grob: Es konnte Geräte und Verbindungen abbilden, nicht aber die Reihenfolge und SMIL-Struktur jedes SVG-Top-Level-Elements verlustfrei erhalten.

## Korrekturen

| Bereich | Ursache | Korrektur | Nachweis |
|---|---|---|---|
| Rohrreaktor | offener, gefüllter Pfad | geschlossene Kontur in Quelle und Generator | SVG-Vertrag und Chrome-Screenshot |
| Auswahlrahmen | Template-ViewBox statt Browser-Geometrie | `getBBox()` mit Entity-Transformation und sicherem Fallback | Kompressor-/Pumpenrahmen im Browsertest |
| Drag-and-drop | Payload wurde bereits in `dragover` gelesen | Typprüfung beim Überfahren, Payloadauswertung erst bei `drop` | exakt eine neue Entity |
| Klick-Platzierung | Werkzeug blieb aktiv | One-shot-Platzierung mit Rückkehr zu Auswahl | zweite Canvas-Aktion erzeugt kein Duplikat |
| Pan/Scroll | nur Zoompfad vorhanden | dediziertes Pan-Werkzeug, Space/Mitteltaste, X-/Y-Wheel | Offset-Prüfung beider Achsen |
| Themes | weißer Canvas hart verdrahtet | Design-Token für Light, Dark und Brown | drei visuelle Zustände |
| Inventar-Fit | SVG durfte aus Karte herausragen | isolierte Viewport-Fläche mit `overflow: hidden` und konsistentem Padding | alle 35 Karten innerhalb ihrer Vorschau |
| Inspektor | Palette und Auswahl nicht gemeinsam gerendert | sofortige Preview- und Inspector-Aktualisierung | Auswahltest ohne Canvas-Zwischenschritt |
| Referenztreue | monolithischer Custom-SVG-Import | geordnete `svg_fragment`-Primitive mit Originalmarkup | identische Pixel-Hashes bei SMIL t=0 |
| Ereigniskopplung | interne Teile ohne generische Ziele | deterministische `data-pf-event-target`- und `data-pf-state-target`-Attribute | Export- und Eventvertrag |

## Elementares Bauprinzip

Rohre, Bögen, T-Stücke, Flansche und Geräte bleiben eigenständige Entities mit semantischen Ports. Ein Flanschpaar ist eine Komfortbaugruppe für eine sichtbare lösbare Verbindung. Für größere Bauteile werden die Komponenten einzeln platziert, über kompatible Ports verbunden, gemeinsam selektiert und als neue Inventar-Entity gespeichert. Interne Verbindungen werden dabei in die Baugruppe übernommen; externe Ports bleiben exponiert.

Referenzanlagen werden dagegen bewusst als elementare SVG-Zeichenfragmente importiert. Dadurch bleiben selbst Bemaßungen, Beschriftungen, gestrichelte Hilfslinien, Schaltzustände und SMIL-Sequenzen einzeln auswählbar und verschiebbar. Fachlich relevante Blätter erhalten zusätzlich stabile Eventziele. So bleibt der visuelle Zustand originalgetreu, ohne das allgemeine Event-/Animationssystem zu umgehen.

## Abgrenzung

V64_r1 ändert den Zeicheneditor und dessen Darstellung. Das Automation-Konfigurationssystem bleibt in R1 unverändert und wird erst in V64_r2 gezielt ersetzt. Die gelieferten Dokumente und Prototypen wurden dabei als technische Referenz behandelt, nicht als unabhängige Anweisung.
