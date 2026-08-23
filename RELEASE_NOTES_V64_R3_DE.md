# Plant Factory V64_r3 – Release Notes

## Ergebnis

V64_r3 macht die Ebene **Anlage · Zeichnen** zu einem Steck-Editor: Elementarteile rasten
an freien Ports ein, bewegen sich als Verbund, werden zu Baugruppen gespeichert und kommen als
einzeln konfigurierbare Entities zurück. Das Zeichen-Inventar und das Anlagen-Inventar sind
getrennt und in beide Richtungen überführbar. Alle Funktionen bis V64_r2 bleiben erhalten.

## Neu in der Zeichenebene

1. **Einrasten an Ports**: Ein gezogenes oder aus dem Inventar abgelegtes Teil rastet an jedem
   freien, medienkompatiblen Port ein; die Kopplung wird als gesteckte Verbindung (Joint) gespeichert.
2. **Verbund**: Gesteckte Teile bewegen sich gemeinsam, Doppelklick wählt den Verbund,
   **Alt + Ziehen** löst ein Teil, „Teile zusammenziehen“ schließt geöffnete Joints.
3. **Griffe und Tastatur**: acht Größen-Griffe mit mitgeführten Ports, Drehgriff, **R**/Umschalt+R,
   Pfeiltasten, Strg+A, Strg+G, Rahmenauswahl, Alt/Umschalt/Strg-Mehrfachauswahl.
4. **Sichtbare Ports und Trefferflächen**: freie Ports werden dezent angedeutet, Rohre und
   Verbindungen sind auf ihrer gesamten Fläche greifbar.
5. **Zwei Inventare**: Register **Elemente** (PF-PID-V1-Standardteile) und **Baugruppen**
   (Bibliothek des Dienstes und Projekt); Anlagen-Symbole werden nur auf Wunsch übernommen.
6. **Baugruppen-Templates**: Auswahl als Baugruppe speichern; beim Platzieren entstehen wieder
   einzelne Entities mit neuen IDs, internen Joints und gemeinsamer Baugruppen-ID.
7. **Übernahme ins Anlagenbild als Einzelobjekte**: jedes Teil wird eigene Anlagen-Entity mit
   Tag, Name, Drehung und Größe; Joints werden Anlagenverbindungen mit semantischen Ports.
8. **Gesteckte Rohrofen-Anlage** als neues Beispiel (21 Teile, 17 Joints) neben dem r1-Beispiel.
9. Neue Server-API `/api/drawing-assemblies` (GET, POST, POST …/loeschen) mit atomarer,
   traversal-sicherer JSON-Persistenz.

## Kompatibilität

- Projekt-, V9-, SCADA-, Runtime-, HMI-, Logik- und Automation-Verträge sind unverändert.
- `plant-factory.plant-drawing` bleibt Version 1; neue Felder (`joint`, `assembly_id`,
  `assembly_templates`, `inventory`) sind optional.
- Klassische Verbindungen im Werkzeug „Verbinden“ bleiben erhalten.
- Die geerbten Browser- und Releaseverträge akzeptieren die Revision r3 additiv.

## Prüfung

`./test_all.sh` umfasst jetzt den statischen R3-Vertrag, den R3-Modellvertrag (33 Prüfungen),
den R3-Serververtrag (20 Prüfungen) und den R3-Browservertrag (55 Prüfungen) zusätzlich zu
allen geerbten Gates.
