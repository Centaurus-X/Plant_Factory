# V64_r1 – Architektur und Bedienung

## Additive Architektur

V64_r1 erweitert die vorhandene V64-Schichtung:

1. Das Inventar liefert weiterhin kanonische SVG-Templates und semantische Ports.
2. Das funktionale Zeichenmodell führt Entities, Verbindungen und Primitive unverändert weiter und ergänzt ausschließlich den Primitivtyp `svg_fragment` sowie Referenzmetadaten.
3. Der Renderer erzeugt Canvas, Vorschau und Export aus demselben normalisierten Modell.
4. Der allgemeine SVG-Event-Renderer adressiert importierte Fragmente über `data-pf-event-target` und `data-pf-state-target`.
5. Projekt-, Runtime-, SCADA- und Automation-V9-Exporte erhalten weiterhin dasselbe `plant_drawing`-Modell; Referenzinformationen sind additive Felder.

## Bedienung der Zeichenfläche

- Inventarkarte ziehen: setzt genau eine Instanz am Ablagepunkt.
- Inventarkarte anklicken: aktiviert die einmalige Platzierung; der nächste Canvas-Klick setzt ein Objekt und kehrt zur Auswahl zurück.
- Hand-Werkzeug, Leertaste oder mittlere Maustaste: verschiebt die Zeichenfläche.
- Mausrad: vertikal verschieben; Umschalt + Mausrad: horizontal verschieben.
- Plus/Minus: Zoom; Raster und Einrasten bleiben getrennt schaltbar.
- Objekt oder Fragment anklicken: aktualisiert Inspektor und Vorschau unmittelbar.
- Port anklicken: startet beziehungsweise beendet eine semantische Verbindung.
- Mehrfachauswahl: kann als wiederverwendbare Inventar-Entity gespeichert werden.

## Flansche und Baugruppen

Ein einzelner Flansch ist ein elementarer Anschluss. Das universelle Flanschpaar ist eine kleine Baugruppe mit zwei gegenüberliegenden Prozessports und sichtbarer Trennstelle. Ein typischer Aufbau lautet:

`Rohr → Flansch/Flanschpaar → Geräteport → Flansch/Flanschpaar → Rohr`

Nach dem Verbinden können alle Teile gemeinsam markiert, in der Vorschau geprüft und als neues Gerät ins Inventar übernommen werden. Dadurch bleiben Rohre, Verbindungen und Geräte editierbar; häufig genutzte Kombinationen werden trotzdem zu Templates.

## Referenzanlagen

Unter „Referenzanlagen“ stehen die drei gelieferten Diagramme zur Verfügung. „Elementar & animiert laden“ übernimmt jedes direkte SVG-Kindelement geordnet in das Zeichenmodell. Sichtbare Elemente sind einzeln selektierbar. SMIL-Elemente verbleiben in ihrem ursprünglichen Parent, sodass Zeitachsen, Farbwechsel, Flüsse und Transformationen erhalten bleiben.

Der Voll-SVG-Export verwendet bei einer unveränderten Referenz deren ursprüngliche ViewBox, Abmessungen, Typografie und Elementreihenfolge. Damit ist der Export bei identischem Animationszeitpunkt visuell deckungsgleich mit der Quelle.
