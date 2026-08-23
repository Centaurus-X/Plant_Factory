# PF-CANVAS-CONTEXT-V1 — Kontextbedienung der Zeichenebene

## 1. Ziel

Die gesamte Engineering- und Draft-Ebene muss zusätzlich zur bestehenden
Toolbar und zum Inspector per Rechtsklick bedienbar sein. Das Kontextmenü ist
eine additive Bedienmöglichkeit und ersetzt keine bestehende Funktion.

## 2. Kontextauflösung

Der Zieltyp wird an der tatsächlichen Pointerposition bestimmt:

1. Prozessobjekt (`g.svg-element`);
2. Verbindung (`path.connection-line`);
3. freie Zeichenfläche.

Das Ziel wird vor dem Öffnen ausgewählt. Ein Rechtsklick darf keinen Drag- oder
Geometrieänderungsvorgang starten.

## 3. Objektaktionen

- Eigenschaften öffnen;
- I/O und Runtime-Binding öffnen;
- HMI-Widget konfigurieren;
- HMI-Datenbindung konfigurieren;
- neue Verbindung erstellen;
- bestehende Verbindungen anzeigen;
- Objekt nach modaler Bestätigung löschen.

Die HMI-Aktionen aktivieren den vorhandenen rechten Inspector und springen in
den passenden PF-HMI-SETUP-V2-Schritt. Es wird kein paralleles HMI-Datenmodell
angelegt.

## 4. Verbindungsaktionen

- vollständigen Verbindungseditor öffnen;
- Startobjekt auswählen;
- Zielobjekt auswählen;
- Verbindung nach modaler Bestätigung löschen.

## 5. Zeichenflächenaktionen

- Zeichnung einpassen;
- Raster ein-/ausblenden;
- Snap ein-/ausschalten;
- HMI-Ebene ein-/ausblenden;
- Undo;
- Redo;
- Auswahl aufheben.

## 6. Accessibility

Das Menü verwendet `role="menu"`; Einträge verwenden `role="menuitem"`.
Unterstützt werden Pfeil auf/ab, Pos1, Ende und Escape. Das Menü wird innerhalb
des sichtbaren Viewports positioniert und bei Scrollen, Resize oder einem
Pointerereignis außerhalb geschlossen.

## 7. Erweiterungsregel

Neue Aktionen werden als deklarative Menüeinträge und als zentral behandelte
Aktion ergänzt. Inline-Eventhandler und HTML-generierte `onclick`-Attribute sind
unzulässig. Destruktive Aktionen verwenden PF-MODAL-V1.
