# Release Evidence — V64_r6, V64_r5, V64_r4, V64_r3 und historische Vergleichsstände

## V64_r6 — sichtbare Kategoriennavigation und strukturierte Baugruppen

Die vier V64_r6-Aufnahmen stammen aus dem aktuellen alternativen
Google-Chrome-Lauf (deviceScaleFactor = 1). Die Kategorienaufnahme verwendet
900 × 780 Pixel, die drei Baugruppenaufnahmen 1920 × 1080 Pixel.

| Datei | Geprüfter Zustand |
|---|---|
| `V64_r6_01_Accessible_Inventory_Scrollbar.png` | schmales Anlagen-Inventar mit horizontal erweitertem Kategorienviewer, sichtbarem nativen Scrollbalken, aktivem Kategorie-Tab und Tastaturführung |
| `V64_r6_02_Drawing_Assembly_Inventory.png` | Zeichen-Inventar → Baugruppen mit dem gebündelten Anlagen Entwurf (31 Teile, 49 freie Ports, Bibliothekskennzeichen) und strukturierter Transferaktion |
| `V64_r6_03_Structured_Assembly_Parts.png` | per Drag-and-Drop eingesetzte strukturierte Baugruppe: reale Einzelgeräte, 14 Verbindungen, passive Maß-/Beschriftungsebene und separat ausgewählter Rohrofen mit I/O-/HMI-Inspektor |
| `V64_r6_04_Legacy_Assembly_Upgrade.png` | passender flacher Altentwurf nach expliziter Migration; Einzelteile bleiben sichtbar an der Ablageposition und separat auswählbar |

Der V64_r6-Browservertrag umfasst 29 bestandene Prüfungen für Scrollbar,
Tablisten-Semantik, Pfeil-/Pos1-/Ende-Bedienung, Baugruppeninventar, echten
Drag-and-Drop, 31 Einzelteile, 14 Verbindungen, passive Layoutschicht,
Device-/I/O- und HMI-Auswahl, Legacy-Migration, Sichtbarkeit sowie Console-,
Page- und Requestfehler. Die Nachweise sind ein gezielter Bedien- und
Visualvertrag, keine pauschale Barrierefreiheitszertifizierung.


## V64_r5 — Klassische optische Variante, Ebenen, Leitungen, Bereiche und Bemaßung

Die vier V64_r5-Aufnahmen stammen aus dem eigenen Chromium-Lauf
(`test/smoke_v64_r5.py`) bei 1920 × 1080 Pixel und `deviceScaleFactor = 1`.

| Datei | Geprüfter Zustand |
|---|---|
| `V64_r5_01_Classic_Reactor_Light.png` | Beispiel „Klassik: Reaktor-P&ID“ (39 Teile, 23 Joints, 31 Zeichenelemente) auf dem Referenzblatt 1300 × 1110: gefüllte Rohre, Flanschpaare, Rohrkopf, axialer und seitlicher Swagelok mit Kapillaren, Rohrofen rot, U-Bogen, Kühler blau, Ventilpanel mit grünen Ventilen, Grenzstellen, Instrumentenkreise, Skid-Bereich, Bemaßungen, animierte Leitungen; Gestellebene ausgeblendet |
| `V64_r5_02_Classic_Reactor_Frame.png` | dieselbe Anlage mit eingeblendeter Gestellebene (Pfosten, Querträger, Füße, Boden, Halterungsträger, Rohrschelle – acht gesteckte Gestellteile) und Register *Blatt* mit Feld **Rand** |
| `V64_r5_03_Classic_Template_Light.png` | Beispiel „Klassik: Symbolvariante“ (19 Teile, 22 Zeichenelemente) auf 1150 × 830: Gasflaschen, Regel- und Rückschlagventile, Gasmischer-Kasten, Kolonne, Kreis-Ofen und Kreis-Kühler, Vent-Ventil senkrecht, Instrumente, grüne Spülgas- und graue Gasleitungen, Light Theme |
| `V64_r5_04_Classic_Template_Dark.png` | dieselbe Symbolvariante im Dark Theme (Klassik-Karten und -Symbole behalten ihre Referenzfarben) |

Der V64_r5-Browservertrag umfasst 95 Prüfungen für Inventar (66 Elemente + 5 Gestellteile),
Stecken der Klassik-Teile (Rohr → Flansch → Rohr mit Flansch), Darstellungszustände mit
berechneten Farben, Taste Z, Animation anhalten/starten, Leitungen per Klick, Bereiche und
Bemaßungen per Ziehen, Ebenen, Gestell-Joint, Bibliotheks-Roundtrip, beide Referenzbeispiele,
Sicherheitsabfrage, Exporte sowie Konsolen- und Seitenfehler.

## V64_r4 — Strecken, Spiegeln, Invertieren, wachsendes Blatt, Register und Kontextmenü

Die vier V64_r4-Aufnahmen stammen aus dem eigenen Chromium-Lauf
(`test/smoke_v64_r4.py`) bei 1920 × 1080 Pixel und `deviceScaleFactor = 1`.

| Datei | Geprüfter Zustand |
|---|---|
| `V64_r4_01_Scratch_Build_Light.png` | Rohrofen-Strang **von Grund auf per Mausgesten** gesteckt: gespiegelte Grenzstelle N₂, Kapillare, Ventil, Swagelok, Gasmischer, gedrehte Verschraubung, Rohr, Flansch, Rohrofen (9 Teile, 8 Joints), Verbund per Doppelklick gewählt |
| `V64_r4_02_Example_Light.png` | Beispiel „Rohrofen mit Fittings & Mischer“ (31 Teile, 25 Joints) mit gestreckten Rohren, gespiegeltem U-Bogen, gedrehtem Kühler, beschrifteten Grenzstellen, Light Theme |
| `V64_r4_03_Example_Dark.png` | dieselbe Anlage im Dark Theme mit Blattrahmen und Raster über der gesamten Ansicht |
| `V64_r4_04_Inspector_ContextMenu.png` | Kontextmenü per Rechtsklick auf den Gasmischer und Inspektor mit Registern Objekt · Ports · Eigenschaften · Blatt |

Der V64_r4-Browservertrag umfasst 82 Prüfungen für Streckprofile, Spiegeln, Invertieren,
proportionale Skalierung, wachsendes Blatt, Inspektor-Register, Kontextmenü, Strg-Navigation,
Neubau per Mausgesten, Baugruppe und Custom-Entity speichern, Offenlegen im Anlagen-Inventar,
Einsetzen sowie Konsolen- und Seitenfehler.

## V64_r3 — Steck-Editor, Baugruppen und getrennte Inventare

Die vier V64_r3-Aufnahmen stammen aus dem eigenen Chromium-Lauf
(`test/smoke_v64_r3.py`) bei 1920 × 1080 Pixel und `deviceScaleFactor = 1`.

| Datei | Geprüfter Zustand |
|---|---|
| `V64_r3_01_Assembly_Light.png` | gesteckte Rohrofen-Anlage aus 21 Elementarteilen mit 17 geschlossenen Joints, Light Theme |
| `V64_r3_02_Assembly_Dark.png` | dieselbe Anlage im Dark Theme mit sichtbaren Steckmarken, Porthinweisen und klassischen Instrumentenlinien |
| `V64_r3_03_Assembly_Brown.png` | Dark-Brown-Palette des Zeicheneditors |
| `V64_r3_04_Assembly_Inventory.png` | Zeichen-Inventar mit Register **Baugruppen**, Übernahme-Karte und getrenntem Anlagen-Inventar |

Der V64_r3-Browservertrag umfasst 56 Prüfungen für Einrasten, Verbund, Alt-Lösen,
Griffe, Drehung, Baugruppen speichern/platzieren, Übernahme als Einzelobjekte,
Inventartrennung sowie Konsolen- und Seitenfehler.

## V63.2 — Stabilität, I/O-Synchronisierung und Automation-V9-Bridge

Die vier V63.2-Aufnahmen stammen aus dem eigenen Chromium-Regressionslauf bei
1680 × 1000 Pixel und `deviceScaleFactor = 1`.

| Datei | Geprüfter Zustand |
|---|---|
| `V63_2_Screenshot_01_Compact_Connection_Modal.png` | kompakter, responsiver Verbindungsdialog nach vorheriger Maximierung |
| `V63_2_Screenshot_02_IO_Selection_And_Connections.png` | direkte Canvas-Auswahl im I/O-Editor sowie fünf unmittelbar gerenderte Verbindungen |
| `V63_2_Screenshot_03_Additive_Logic_Diagrams.png` | eigener Schaltplan und Timer-/Counter-Demo gleichzeitig im Inventar |
| `V63_2_Screenshot_04_Automation_V9_Bridge.png` | konsolidierte Automation-Navigation, fünf kanonische V9-Sektionen und null aktive doppelte Regelquellen |

Der V63.2-Browservertrag umfasst 45 Prüfungen für Modalgeometrie,
Verbindungslifecycle, I/O-Auswahlsynchronisierung, additive Logic-Diagramme,
Automation-Bridge sowie Browser-, Konsolen- und Requestfehler.

## V63.1 — PF-LOGIC-V1 und universelle Runtime-Kompatibilität

Die vier aktuellen Aufnahmen stammen aus dem bestandenen hermetischen
Chromium-Lauf bei 1800 × 1050 Pixel und `deviceScaleFactor = 1`.

| Datei | Geprüfter Zustand |
|---|---|
| `V63_1_Screenshot_01_Logic_FBD_Light.png` | additiver Logic-/FBD-Workspace im Light Theme mit TON, TOF, CTU, typisierten Ports und elf Verbindungen |
| `V63_1_Screenshot_02_Logic_FBD_Dark.png` | Dark Theme, Timer-Inventar und interaktive TON-Konfiguration im Logic-Inspector |
| `V63_1_Screenshot_03_Universal_Compiler.png` | modaler Compiler mit Universal JSON, Automation_System V9/V8 und Siemens-/IEC-SCL-Zielprofilen |
| `V63_1_Screenshot_04_V9_Signal_Inventory.png` | V9-Process-State-Signalinventar und State-Write-Konfiguration ohne duplizierte Runtimeobjekte |

Der V63-Browservertrag umfasst 51 zusätzliche Prüfungen für Workspace-Routing,
Schaltplaninventar, 33 Bausteine, V9-Signale, Drag, Undo, Kontextmenüs,
Compilerartefakte, Modalinteraktion und die Rückkehr in den bestehenden
Plant-/HMI-Workspace.

## V62.1 — Modal-, Kontextmenü- und HMI-Verträge

| Datei | Geprüfter Zustand |
|---|---|
| `v62_1_connection_modal.png` | transaktionaler Verbindungseditor als PF-MODAL-V1-Fenster |
| `v62_1_context_menu_inspector_rail.png` | Canvas-Rechtsklickmenü und dauerhaft sichtbarer Inspector-Rail |
| `v62_1_hmi_setup.png` | geführtes HMI-Setup für Widgets, Datenbindung, Zustände/Alarme und Darstellung |

Alle aktuellen V61.1-Aufnahmen stammen aus dem vollständig bestandenen,
hermetischen Chromium-Smoke bei `deviceScaleFactor = 1`. Desktopaufnahmen
verwenden 1680 × 1000 Pixel, der Responsive-Nachweis 1366 × 768 Pixel.

## V61.1 — verbindliche Nachweise

| Datei | Geprüfter Zustand |
|---|---|
| `v61_1_pid_light.png` | normalisierte PF-PID-V1-Anlage, Light Theme, sechs Entities, fünf semantische Verbindungen und reales V9-Binding |
| `v61_1_pid_dark.png` | dieselbe Referenzanlage im Dark Theme mit standardisierten Zuständen, Ports und Beschriftungen |
| `v61_1_hmi_optional.png` | bewusst eingeblendetes HMI-Overlay mit genau zwei expliziten Widgets, davon ein optionaler Button |
| `v61_1_responsive.png` | vollständige Engineering-Bedienung bei 1366 × 768 Pixel |

Der Browserlauf umfasst 119 bestandene Interaktions- und Darstellungsprüfungen.
Er prüft zusätzlich Bibliotheksumfang, Projektladung, normalisierte Geometrie,
TAGs, Ports, fünf Verbindungen, Inspector-Synchronisierung, reales Binding im
Auswahlstatus, kontrastreiche HMI-Anzeige, Theme-/Palettenwechsel und die
Richtlinie `auto_create_widgets = false`.

## V60.1 — Merge-Baseline

| Datei | Geprüfter Zustand |
|---|---|
| `v60_1_workspace_light.png` | Engineering-Workspace, Light Theme, Bibliothek, Canvas, Inspector und Minimap |
| `v60_1_workspace_dark.png` | reales Projekt, Auswahl, Dark Theme und alternative Dunkelpalette |
| `v60_1_workspace_responsive.png` | produktive Bedienung bei 1366 × 768, Header-Menü geöffnet |
| `v60_1_shortcut_help.png` | fokussierbarer Shortcut-Dialog im Dark Theme |

## V58.2

| Datei | Geprüfter Zustand |
|---|---|
| `21-v58-2-canvas-light.png` | Elementbeschriftung, Teal-Fließlinie und V58-Palette im Light Theme |
| `22-v58-2-canvas-dark.png` | dieselbe V58-Szene im Dark Theme |

## V58.1

| Datei | Geprüfter Zustand |
|---|---|
| `13-v58-1-engineering-light.png` | Engineering hell, leerer Einstieg |
| `14-v58-1-engineering-loaded.png` | Projekt geladen |
| `15-v58-1-inspector-selected.png` | Auswahl und Inspektor |
| `16-v58-1-automation.png` | Automatisierung |
| `17-v58-1-topology.png` | Topologie und Rollout |
| `18-v58-1-validation.png` | Validierung |
| `19-v58-1-engineering-dark.png` | Dark Mode |
| `20-v58-1-shortcuts-overlay.png` | Shortcut-Overlay |

## V56.1-/V1-Referenzbestand

| Datei | Geprüfter Zustand |
|---|---|
| `00-design-target-v1.png` | ausgewähltes visuelles Designziel |
| `01-engineering-empty.png` | Engineering, leerer Einstieg |
| `02-automation-processes.png` | Prozesse als Vollbreitenbereich |
| `03-topology.png` | V9-Topologie |
| `04-validation.png` | Validierungsarbeitsraum |
| `05-runtime-hmi.png` | Runtime-/HMI-Arbeitsraum |
| `06-engineering-loaded.png` | reales Projekt geladen |
| `07-engineering-dark.png` | Dark Mode |
| `08-responsive-1366x768.png` | Responsive-Viewport |
| `09-engineering-selected.png` | Auswahl und produktiver Inspektor |
| `10-reference-vs-v56-1.png` | vollständiger visueller Vergleich |
| `11-header-navigation-comparison.png` | Kopf, Rail und Bibliothek |
| `12-inspector-comparison.png` | Kontextinspektor |

Die historischen Bilder bleiben erhalten, damit Designentwicklung, Merge-
Entscheidungen und visuelle Regressionen dauerhaft nachvollziehbar bleiben.
