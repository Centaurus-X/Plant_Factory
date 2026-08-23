# Plant Factory V64_r5 – Release Notes

## Ergebnis

V64_r5 ergänzt die Ebene **Anlage · Zeichnen** um eine zweite, **klassische optische Variante**:
gefüllte Doppellinien-Rohre, Flanschpaare, Flansch mit Verschraubung, Rohrkopf, U-Bogen,
Swagelok-Verschraubungen, Titan-Kapillaren, Handventile mit grün/rot animierten Zuständen,
Grenzstellen, Instrumentenkreise, Rohrofen, Doppelrohr-Kühler, Kolonne, Kreis-Apparate,
Gasmischer-Kasten und Gasflaschen. Dazu kommen animierte Leitungen mit Stützpunkten, Bereiche
(„Ventilpanel“, „Gestell / Skid“), Bemaßungen, drei Ebenen (Prozess · Gestell · Beschriftung)
mit eigenem Gestell-Inventar sowie ein Animationsschalter. Beide Referenzbilder – das Reaktor-
P&ID mit gefüllten Rohren und die Template-Symbolvariante – sind als Beispiele enthalten und
werden **pixelgenau auf dem Referenzblatt** aus Elementarteilen gezeichnet. Alle bisherigen
Funktionen und die bisherige Zeichen-Optik (PF-PID-V1-Standardsymbole) bleiben unverändert.

## Neu in der Zeichenebene

1. **Klassik-Symbolfamilie (24 Teile)**: `Classic_tube` (gefülltes Rohr, streckbar),
   `Classic_tube_flanged` (Rohr mit Flansch – der Flanschbalken bleibt beim Strecken fest),
   `Classic_tube_tap` (Rohrstück mit Seitenanschluss links/rechts bzw. oben/unten),
   `Classic_flange`, `Classic_flange_bolted` (Flansch mit Verschraubung), `Classic_tube_elbow`,
   `Classic_tube_ubend` (in der Höhe streckbar), `Classic_tube_head`, `Classic_capillary`,
   `Classic_capillary_elbow`, `Classic_swagelok`, `Classic_line`, `Classic_valve`,
   `Classic_control_valve`, `Classic_check_valve`, `Classic_flag`, `Classic_flag_back`,
   `Classic_instrument`, `Classic_furnace`, `Classic_cooler`, `Classic_column`,
   `Classic_coil_circle`, `Classic_mixer_box`, `Classic_cylinder`. Alle stecken automatisch
   zusammen (Joints) und tragen Zustände (`flow`, `heat`, `hot`, `cold`, `purge`, `open`,
   `closed`) mit den Referenzfarben (Ofen rot, Kühler blau, Ventil grün/rot).
2. **Animierte Laufstriche**: Jedes Klassik-Teil trägt weiße SMIL-Laufstriche wie im
   Referenzbild; der Toolbar-Schalter **Animation** hält sie an oder startet sie. Der Export
   enthält die Animation.
3. **Leitungen mit Stützpunkten** (Werkzeug **Leitung**, Taste **L**): Klick setzt Punkte,
   Umschalt erzwingt orthogonale Segmente, Enter/Doppelklick beendet, Escape verwirft.
   Darstellungen: Rohrleitung, Kapillare, heiß, kalt, Kühlwasser, Spülgas, Gasleitung, Signal
   (gestrichelt) oder frei; animiert oder statisch.
4. **Bereiche** (Werkzeug **Bereich**, Taste **B**): gestrichelter Rahmen mit Titel innen oder
   über dem Rahmen („Ventilpanel“). **Bemaßungen** (Werkzeug **Bemaßung**, Taste **D**): Endstriche,
   Pfeile, Maßtext innen oder auf der anderen Seite.
5. **Ebenen**: Prozess, Gestell und Beschriftung lassen sich in der Toolbar ein-/ausblenden;
   ausgeblendete Ebenen (inklusive ihrer Ports und Joints) fehlen auch im Export. Jedes Teil und
   jedes Zeichenelement trägt seine Ebene im Inspektor.
6. **Gestell / Aufhängung** mit eigenem Inventar-Register: `Frame_post`, `Frame_beam`,
   `Frame_foot`, `Frame_clamp`, `Frame_floor` stecken über Gestell-Ports (`kind: structure`)
   zusammen und liegen automatisch auf der Gestellebene hinter dem Prozess.
7. **Swagelok-Anbringung oben / seitlich, links / rechts**: der Rohrkopf bietet einen axialen
   Kapillaranschluss, das Rohrstück mit Seitenanschluss zwei Wandanschlüsse; **R** dreht,
   **F** spiegelt die Verschraubung. Im Reaktor-Beispiel sind beide Swagelok-Fittings über
   kurze Kapillaren als echte Joints angeschlossen.
8. **Darstellungszustand** pro Teil: Inspektor-Auswahl, Taste **Z** (nächster Zustand) und
   Kontextmenü „Darstellung“. Instrumentenkreise zeigen Funktion, Nummer und Messwert
   (Eigenschaft `value`), `caption` und `hide_labels` steuern Beschriftungen.
9. **Blattrand**: Das Register *Blatt* zeigt den Rand des automatischen Wachstums (Standard 80);
   Referenzbeispiele verwenden 4, damit das Blatt exakt das Referenzmaß behält.
10. **Beispiele**: „Klassik: Reaktor-P&ID laden“ (39 Teile, 23 Joints, 31 Zeichenelemente,
    1300 × 1110) und „Klassik: Symbolvariante laden“ (19 Teile, 22 Zeichenelemente, 1150 × 830).
11. **Canvas-Texte** übernehmen ihre eigene Schriftgröße, -familie und Farbe (bisher erzwang das
    Stylesheet 16 px); der Export war davon nie betroffen.

## Kompatibilität

- Projekt-, V9-, SCADA-, Runtime-, HMI-, Logik- und Automation-Verträge sind unverändert.
- `plant-factory.plant-drawing` und `plant-factory.plant-drawing-assembly` bleiben Version 1;
  die neuen Felder `visual_state`, `layer` (Entities), `points`, `line_style`, `animated`,
  `layer`, `label`, `label_position`, `font_family`, `text_anchor` (Zeichenelemente) und
  `margin` (Blatt) sind optional und werden neutral ergänzt.
- PF-PID-V1 umfasst jetzt 71 Templates; die 42 Standardsymbole sind byte-identisch geblieben
  (`style: standard`, keine Zustände).
- Die geerbten Browser- und Releaseverträge (r1 … r4) laufen unverändert; pixelidentischer
  Referenzexport bleibt erhalten.

## Prüfung

`./test_all.sh` umfasst jetzt den statischen R5-Vertrag, den R5-Modellvertrag (82 Prüfungen),
den R5-Serververtrag (56 Prüfungen) und die R5-Browserprüfung (95 Prüfungen inklusive Stecken
der Klassik-Teile, Zustände, Animation, Leitungen, Bereiche, Bemaßung, Ebenen, Bibliothek und
beider Referenzbeispiele mit Export). Details in **DIAGNOSE_UND_RELEASE_V64_R5_DE.md** und
**docs/v64_r5/**.
