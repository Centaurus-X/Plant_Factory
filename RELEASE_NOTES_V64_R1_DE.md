# Plant Factory V64_r1 – Release Notes

## Ergebnis

V64_r1 ist ein additiver UX- und Präzisionspatch auf V64. Der Anlagen-Zeicheneditor lässt sich nun wie eine technische Zeichenfläche bedienen und kann die drei gelieferten animierten Referenzanlagen als geordnete, einzeln auswählbare SVG-Elemente übernehmen, an das allgemeine SVG-Eventsystem koppeln und ohne sichtbare Abweichung wieder exportieren.

## Behobene Punkte

1. Der vertikale Rohrreaktor besitzt eine geschlossene, proportionsstabile Kontur ohne keilförmige Füllfläche.
2. Inventarobjekte können per Drag-and-drop exakt einmal eingesetzt werden; Klick aktiviert eine einmalige Platzierung.
3. Die Zeichenfläche unterstützt Pan-Werkzeug, mittlere Maustaste, Leertaste sowie horizontales und vertikales Scrollen.
4. Licht-, Dunkel- und Dunkel-Brown-Modus besitzen passende Canvas-, Raster-, Karten- und Vorschaukontraste.
5. Inventarvorschauen verwenden dieselben Flächen- und Kontrastprinzipien wie „Bibliothek · Prozesssymbole“ und schneiden überstehende SVG-Geometrie sauber ab.
6. Auswahlrahmen werden aus der tatsächlich gerenderten SVG-Geometrie berechnet und passen auch bei Kompressor, Vakuumpumpe und Wärmetauscher.
7. Die rechte Inventarvorschau und der Inspektor aktualisieren sich unmittelbar bei der Auswahl.
8. Eine integrierte Flanschhilfe erläutert elementare Flansche, Flanschpaare und deren Verbindung zu Geräten und Rohren.
9. Reaktor-, Rohrofen- und P&ID-Referenzanlagen sind als elementare, animierte Zeichenmodelle ladbar; SMIL, Reihenfolge, Typografie und ViewBox bleiben erhalten.
10. Importierte SVG-Fragmente erhalten stabile Event- und State-Ziele für HMI-, Runtime-, SCADA- und V9-Export.

## Kompatibilität

Alle V64-, V63.4- und älteren Projekt-, HMI-, Logik-, Automation-, Topologie-, Runtime- und Exportverträge bleiben erhalten. V64_r1 verändert weder das V9-Schema noch gespeicherte Nutzdaten automatisch.
