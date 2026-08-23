# V64_r3 – Architektur und Bedienung

## Architektur

Die Zeichenebene besteht aus dem reinen Datenmodell `v64_plant_drawing_model.js` und der
Interaktionsschicht `v64_plant_drawing.js`. Beide sind rein funktional (keine Klassen, keine
Arrow Functions) und bauen additiv auf dem r1-Vertrag auf.

```text
Zeichen-Inventar (Elemente · Baugruppen)
        ↓ ziehen / klicken
Entity mit semantischen Ports  ──Einrasten──▶ Joint (routing: direct)
        ↓                                          ↓
Verbund (Joints + assembly_id)              offene Joints → zusammenziehen
        ↓
Baugruppen-Template (lokale Koordinaten, freie Ports, interne Joints)
        ↓ platzieren                     ↓ speichern
einzelne Entities + neue IDs      /api/drawing-assemblies (JSON, atomar)
        ↓
Anlagenbild: Einzelobjekte + Anlagenverbindungen   |   Anlagen-Inventar: Custom-Entity
```

### Modellvertrag

- `joint` und `routing: 'direct'` kennzeichnen gesteckte Verbindungen.
- `assembly_id`, `assembly_template_id`, `assembly_name` verbinden Teile einer platzierten Baugruppe.
- `assembly_templates[]` (Projektkopie) und `inventory.imported_template_ids[]` liegen im Zeichenmodell.
- Baugruppen-Templates tragen das Schema `plant-factory.plant-drawing-assembly`, Version 1.

### Einrasten

`findPlantSnapCandidate` prüft die freien Ports der bewegten Teile gegen die freien Ports aller
ruhenden Teile. Kriterien: gleiche Medienart, Abstand innerhalb der zoomabhängigen Toleranz,
Richtungsverträglichkeit als Rangmalus. Das Teil wird exakt auf den Zielport verschoben und
`createPlantJoints` legt für alle dann koinzidenten Ports Joints an.

### Zwei Inventare

| Inventar | Inhalt | Quelle | Überführung |
|---|---|---|---|
| Zeichen-Inventar · Elemente | PF-PID-V1-Standardteile, bewusst übernommene Anlagen-Symbole | Template-Registry, `inventory.imported_template_ids` | „Aus Anlagen-Inventar übernehmen“ |
| Zeichen-Inventar · Baugruppen | Baugruppen-Templates | Bibliothek (`public/svg_templates/assemblies/*.json`) und Projekt | „Als Baugruppe speichern“, „In Anlagen-Inventar übernehmen“ |
| Anlagen-Inventar | Standard, Legacy, Custom-Entities | Template-Registry | „Als Custom-Entity ins Anlagen-Inventar“, „Als Einzelobjekte ins Anlagenbild“ |

## Bedienung

1. Links **Elemente** wählen, ein Teil auf die Zeichenfläche ziehen oder anklicken und platzieren.
2. Das nächste Teil an einen freien Port heranführen: der Zielport pulsiert, beim Loslassen
   sind die Teile gesteckt.
3. Ziehen bewegt den gesamten Verbund; **Alt + Ziehen** löst ein Teil; Doppelklick wählt den Verbund.
4. Einzelteil anklicken: Griffe ändern die Größe, der Drehgriff oder **R** dreht; Name, Tag,
   Maße und Drehung im Inspektor bleiben je Teil editierbar.
5. Mehrere Teile auswählen, rechts einen Namen vergeben und **Als Baugruppe speichern**.
6. Register **Baugruppen**: Karte ziehen oder klicken; alle Teile entstehen neu und sind einzeln
   konfigurierbar; freie Ports rasten beim Ablegen ein.
7. **Als Einzelobjekte ins Anlagenbild** überträgt Teile und Joints als Anlagen-Entities und
   -Verbindungen; **Als Custom-Entity** bleibt für flache Symbole verfügbar.
8. Die klassische Verbindung („Verbinden“, Prozess/Medium/Signal/Energie) bleibt für
   Instrumentierung und Medienlinien erhalten.

## Tastatur

| Taste | Funktion |
|---|---|
| R / Umschalt+R | 90° rechts / links drehen |
| Pfeiltasten | Auswahl um eine Rasterweite verschieben |
| Strg+A | alles auswählen |
| Strg+G | Auswahl gruppieren |
| Strg+D | duplizieren |
| Entf | löschen |
| Alt + Ziehen | Teil aus dem Verbund lösen |
| Umschalt beim Griff | Seitenverhältnis halten / 15°-Raster |
| V, H, C, Leertaste | Auswahl, Pan, Verbinden, temporäres Pan |

## Sicherheits- und Stilgrenzen

- Baugruppen-JSON wird serverseitig normalisiert: keine SVG-Fragmente, keine externen CSS-URLs,
  nur skalare Eigenschaften, traversal-sichere IDs, atomares Schreiben.
- Kein `innerHTML` in der Zeichenebene, keine nativen Dialoge, kein `localStorage`.
- CSS der Revision r3 ist vollständig auf `.plant-drawing-*` begrenzt.
