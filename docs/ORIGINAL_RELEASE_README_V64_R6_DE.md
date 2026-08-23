# Automated SVG Integration / Plant Factory V64_r6

V64_r6 schließt den Bearbeitungsweg zwischen **Anlage · Zeichnen** und dem
Anlagenbild: Eine im Zeicheneditor gespeicherte Baugruppe wird im
Anlagen-Inventar nicht mehr nur als ein flaches SVG eingesetzt, sondern als
strukturierte Baugruppe. Jedes Gerät bleibt einzeln auswählbar und kann über
Details, I/O, HMI, Linien und Ebenen konfiguriert werden. Maßlinien,
Beschriftungen und Bereiche bleiben als passive, originalgetreue
Zeichnungsebene erhalten. Zusätzlich besitzt die Kategorienavigation des
Anlagen-Inventars einen sichtbaren, barrierearmen horizontalen Scrollbalken
mit Tastaturbedienung. V64_r5 und alle älteren Verträge bleiben additiv
erhalten.

## Neu in V64_r6

- **sichtbare horizontale Kategoriennavigation** im Anlagen-Inventar mit
  nativer Scrollbar, stabilem Scrollbereich und automatischem Sichtbarhalten
  der aktiven Kategorie;
- **Tastaturbedienung** mit Tab, Pfeil links/rechts, Pos1 und Ende sowie
  Tablisten-/Tab-Semantik und sichtbarem Fokus;
- **strukturierte Zeichenbaugruppen**: Beim Einsetzen entstehen reale
  Anlagen-Entities und Anlagenverbindungen;
- **elementare Editierbarkeit**: Geräte bleiben einzeln auswählbar; Details,
  I/O, HMI und Verbindungseigenschaften sind pro Teil erreichbar;
- **passive Layout-Entity** für Bereiche, Texte und Bemaßungen, ohne
  doppelte Darstellung eingebetteter Geräte und Leitungen;
- **expliziter flacher SVG-Weg** für bewusst unstrukturierte Custom-Symbole;
- **Migration bestehender flacher Anlagenentwürfe**, sofern ihre SVG-Signatur
  einer gespeicherten Zeichenbaugruppe entspricht;
- **„Anlagen Entwurf“** direkt unter **Zeichen-Inventar → Baugruppen**:
  31 elementare Entities, 14 gesteckte Verbindungen und 45 Zeichenelemente;
- serverseitige Validierung und sichere Rückfalllogik auf das flache Format.

Verbindliche Dokumente: **RELEASE_NOTES_V64_R6_DE.md**,
**DIAGNOSE_UND_RELEASE_V64_R6_DE.md**, **docs/v64_r6/**.

## Basis V64_r5


V64_r5 ergänzt die Ebene **Anlage · Zeichnen** um eine zweite, klassische
optische Variante: gefüllte Doppellinien-Rohre, Flansche (auch mit
Verschraubung), Swagelok-Fittings, Titan-Kapillaren mit animierten Laufstrichen,
grün/rot schaltende Ventile, Instrumentenkreise, Apparate, Bereiche wie
„Ventilpanel“, Bemaßungen, drei Ebenen mit eigenem Gestell-Inventar und beide
Referenzbilder als pixelgenau nachgebaute Beispiele. Alle Funktionen und die
bisherige Zeichen-Optik bis V64_r4 bleiben erhalten.

## Neu in V64_r5

- **Klassik-Symbolfamilie (24 Teile)** mit gefüllten Rohren, Rohr mit Flansch,
  Rohrstück mit Seitenanschluss, Flanschpaar, Flansch mit Verschraubung,
  Rohrbogen, U-Bogen, Rohrkopf, Kapillaren, Swagelok, Hand-/Regel-/Rückschlag-
  ventil, Grenzstellen, Instrumentenkreis, Rohrofen, Kühler, Kolonne,
  Kreis-Apparat, Gasmischer-Kasten, Gasflasche – alle steckbar (71 Templates);
- **Darstellungszustände** `flow`, `heat`, `hot`, `cold`, `purge`, `open`,
  `closed` mit den Referenzfarben, Taste **Z**, Inspektor und Kontextmenü;
- **animierte Laufstriche** (SMIL) auf Teilen und Leitungen, Toolbar-Schalter;
- **Leitungen mit Stützpunkten (L)**, **Bereiche (B)** und **Bemaßungen (D)**;
- **Ebenen** Prozess · Gestell · Beschriftung, Gestell-Teile im eigenen
  Register, Verbindungsart `structure`;
- **Swagelok oben / seitlich, links / rechts** über Rohrkopf und Rohrstück mit
  Seitenanschluss (echte Joints);
- **Blattrand** im Register *Blatt*; Referenzbeispiele behalten ihr Blattmaß;
- Beispiele **„Klassik: Reaktor-P&ID laden“** (39 Teile, 23 Joints) und
  **„Klassik: Symbolvariante laden“** (19 Teile, 22 Zeichenelemente).

Verbindliche Dokumente: **RELEASE_NOTES_V64_R5_DE.md**,
**DIAGNOSE_UND_RELEASE_V64_R5_DE.md**, **docs/v64_r5/**.

## Basis V64_r4

- **Streckbare Rohrteile** (Rohr, T-Stück, Kapillare, Doppelmantel-Rohr):
  Endkappen und Flusspfeil behalten ihre Größe, der Körper wird länger, Ports
  folgen exakt; Geräte skalieren proportional, „frei“ erlaubt Verzerrung;
- **Spiegeln (F / Umschalt+F) und Invertieren (I)** mit mitgeführten Ports und
  gedrehten Flusspfeilen – alle acht Lagen eines Rohrbogens sind erreichbar;
- **wachsendes Blatt**: Raster über der gesamten Ansicht, gestrichelter
  Blattrahmen, automatisches Anpassen an den Inhalt;
- **Inspektor-Register** Objekt · Ports · Eigenschaften · Blatt mit Länge/Höhe,
  Skalierungsmodus, Spiegeln, Invertieren, Portrichtungen, freien Eigenschaften;
- **Kontextmenü** per Rechtsklick und **Strg + Ziehen / Strg + Pfeiltasten** zur
  Navigation wie in der Ebene „Anlage“;
- **neue Elementarteile** `Swagelok_union`, `Swagelok_tee`, `Swagelok_elbow`,
  `Capillary_line`, `Pipe_cap`, `Boundary_connector`, `Gas_mixer` (42 Templates),
  T-Stück bereinigt;
- gespeicherte **Custom-Entities** erscheinen sofort unter „Eigene Symbole“ des
  Anlagen-Inventars und werden in der Bildmitte eingesetzt;
- Beispiel **„Rohrofen mit Fittings & Mischer“** (31 Teile, 25 Joints).

Dokumente: **RELEASE_NOTES_V64_R4_DE.md**, **DIAGNOSE_UND_RELEASE_V64_R4_DE.md**,
**docs/v64_r4/**.

## Basis V64_r3

- **Einrasten an Ports**: gezogene oder abgelegte Teile rasten an freien,
  medienkompatiblen Ports ein und werden als gesteckte Verbindung (Joint) gekoppelt;
- **Verbund**: gesteckte Teile bewegen sich gemeinsam, Doppelklick wählt den
  Verbund, Alt + Ziehen löst ein Teil, offene Joints lassen sich zusammenziehen;
- **Griffe und Tastatur**: acht Größen-Griffe mit mitgeführten Ports, Drehgriff,
  R / Umschalt+R, Pfeiltasten, Strg+A, Strg+G, Rahmenauswahl;
- **zwei getrennte Inventare**: Zeichen-Inventar (Elemente und Baugruppen) und
  Anlagen-Inventar, beide Richtungen der Übernahme sind explizite Aktionen;
- **Baugruppen-Templates**: Auswahl als Baugruppe speichern, beim Platzieren
  entstehen wieder einzeln konfigurierbare Entities mit internen Joints;
- **Übernahme ins Anlagenbild als Einzelobjekte**: jedes Teil wird eigene
  Anlagen-Entity, Joints werden Anlagenverbindungen mit semantischen Ports;
- neue Server-API `/api/drawing-assemblies` (GET, POST, POST …/loeschen);
- gesteckte Rohrofen-Anlage als Beispiel (21 Teile, 17 Joints).

Verbindliche Dokumente: **RELEASE_NOTES_V64_R3_DE.md**,
**DIAGNOSE_UND_RELEASE_V64_R3_DE.md**, **docs/v64_r3/**.

## Basis V64

V64 erweitert die stabile V63.4-Basis additiv um zwei zusammengehörige
Engineering-Funktionen:

- ereignis- und signalgesteuerte Animationen für vollständige SVG-Objekte oder
  semantisch markierte Unterelemente;
- einen eigenen Anlagen-Zeicheneditor für elementare Rohre, Flansche, Behälter,
  Reaktoren, Rohröfen, Kühler und Wärmetauscher.

PF-PID-V1, I/O-Zuweisungen, HMI-Widgets, Bindings, Styles, Alarme,
Automation-System-V9-Bridge, PF-LOGIC-V1 und alle bisherigen Exporte bleiben
erhalten.

## Neu in V64

- allgemeiner Vertrag **plant-factory.svg-event-animation**;
- zehn Effekte: Farbe, Kontur, Temperatur, Fluss, Blinken, Pulsieren,
  Rotation, Füllstand, Transparenz und Leuchten;
- Trigger durch Sensor-/Aktor-/State-Signale, allgemeine Events,
  HMI-Interaktionen und Alarme;
- Zielwahl für ein Anlagenobjekt und optional einen semantischen
  **data-pf-state-target**-Bereich;
- geführter Animationsdesigner im bestehenden HMI-Schritt
  **Zustände & Alarme**;
- eigenständiger Menüpunkt **Anlage → Zeichnen**;
- elementares Platzieren, Skalieren, Drehen, Verschieben, Duplizieren und
  Löschen;
- semantische Portverbindungen für Prozess, Versorgungsmedium, Signal und
  Energie;
- freie Linien, Rechtecke, Ellipsen und Beschriftungen;
- Auswahlvorschau und bewusste Übernahme einer Baugruppe als Custom-Entity in
  das bestehende Inventar;
- vollständiger SVG-/JSON-Export des Zeichenmodells;
- additive Persistenz im Projekt und in der V9-/Runtime-Konfiguration;
- neun neue PF-PID-V1-Templates, insgesamt 35 kanonische Templates.

## Geerbte Verbesserungen aus V63.4

V63.4 bleibt unverändert als Kompatibilitätsbasis erhalten:

## Neu und optimiert in V63.4

- klickbare Widgetnamen erscheinen als kompakte Aktionsbuttons statt als Links;
- die nummerierten HMI-Schritte sind die einzige sichtbare Navigation;
- die geerbte zweite Tabzeile bleibt verborgen als DOM-Kompatibilitätshaken;
- Pfeiltasten, Pos1 und Ende bedienen die HMI-Schritte;
- Zustände und Alarme besitzen einen geführten Standardweg sowie vollständig
  erhaltene Expertenbereiche;
- Darstellung ist klar in View, Widgetauswahl und Widgetdesign gegliedert;
- Widget, P&ID-/SVG-Objekt und Datenstatus werden gemeinsam angezeigt;
- eigener V63.4-Statisch- und Chromium-Regressionsvertrag.

## Geerbte Verbesserungen aus V63.3

- gemeinsame I/O-Aktionszeile für **Zuweisung speichern** und
  **Zuweisung entfernen**;
- standardmäßig eingeklapptes Register **Aktuelle Zuordnungen**;
- responsive Zuordnungstabelle mit stabilen Spalten, gekürzten Element-/Alias-
  Werten und vollständigen Tooltips;
- neues PF-PID-V1-Symbol **Generic_Sensor_Entity** in der Kategorie
  **Messstellen**;
- PF-PID-V1-Bibliothek mit nun 26 kanonischen Templates;
- vollbreites HMI-Widgetregister direkt unter der Schritt-1-Einleitung;
- explizite Objektwahl beim Anlegen eines Widgets;
- Übernahme der aktuellen Canvas-Auswahl;
- atomare Erzeugung von Widget und Objektbinding;
- automatische, aber nur vorbelegende Ableitung einer Sensor-/Aktorquelle aus
  der bestehenden I/O-Zuweisung;
- sichtbare Widget-Objekt-Quelle-Relation und direkte Navigation zum
  Bindingeditor;
- geerbter V63.3-Statisch-, Relation- und Chromium-Regressionsvertrag.

## Erhaltene Hauptfunktionen

- PF-PID-V1 mit normalisierten Prozesssymbolen und semantischen Ports;
- Legacy- und Custom-SVG-Objekte;
- Inspector, Mehrfachauswahl, Verschieben, Skalieren, Rotieren, Undo/Redo,
  Snapshots, Speichern und Laden;
- HMI-Widgets, Bindings, Styles, Alarme, Animationen und Interaktionen;
- verschiebbare, skalierbare und maximierbare PF-MODAL-V1-Dialoge;
- Rechtsklickmenüs auf Zeichenfläche, Objekten und Verbindungen;
- PF-LOGIC-V1 mit typisierten Bausteinen, IEC-Timern, Zählern, Validierung,
  Runtime-/V9-/V8-Cross- und Siemens-SCL-Ausgabe;
- Process States, Filter, Timer, Rule Engine und Rules gemäß V9-Vertrag;
- V9-/V8-Cross-Konfiguration, HMI-/SCADA-/SVG- und Runtime-Exporte;
- alle Stabilitätskorrekturen aus V63.2.

## Schnellstart

~~~bash
./start_plant_factory.sh
~~~

Anschließend öffnen:

```text
http://127.0.0.1:8090/
```

Das Startskript bindet standardmäßig an `0.0.0.0:8090`; über
`PLANT_FACTORY_HOST` und `PLANT_FACTORY_PORT` lässt sich dies einschränken.
Eine dauerhafte Netzbereitstellung benötigt einen authentifizierten
TLS-Reverse-Proxy und ein geeignetes Rollen-/Rechtekonzept.

## Anlagen zeichnen (V64_r3 bis V64_r6)

1. Links **Zeichnen** öffnen; im Zeichen-Inventar das Register **Elemente** wählen.
2. Ein Teil auf die Fläche ziehen oder anklicken und platzieren.
3. Das nächste Teil an einen freien Port heranführen: der Zielport pulsiert,
   beim Loslassen sind die Teile gesteckt (Joint).
4. Ziehen bewegt den Verbund; Alt + Ziehen löst ein Teil; Doppelklick wählt den
   Verbund; R dreht; Griffe ändern die Größe.
5. **Verbinden** bleibt für klassische Signal-, Medien- und Energielinien
   (zwei Ports anklicken).
6. Mehrere Teile auswählen, Namen vergeben und **Als Baugruppe speichern**;
   im Register **Baugruppen** wiederverwenden – jedes Teil bleibt konfigurierbar.
7. **Als Einzelobjekte ins Anlagenbild** überträgt Teile und Joints als
   Anlagen-Entities und -Verbindungen; **Als Custom-Entity** bleibt für flache
   Symbole verfügbar.


V64_r6: **Als editierbare Baugruppe ins Anlagenbild** speichert die
Zeichenbaugruppe strukturiert. Wird ihre Karte unter **Eigene Symbole**
eingesetzt, erzeugt das Anlagenbild die einzelnen Geräte und Joints erneut.
Die Teile können einzeln gewählt und in **Details**, **I/O**, **HMI**,
**Linien** und **Ebenen** bearbeitet werden. Bereiche, Maße und Texte liegen
auf einer passiven Layout-Entity. **Als flaches SVG ins Anlagen-Inventar**
bleibt der ausdrückliche Kompatibilitätsweg für ein einziges Custom-Objekt.
Ein passender älterer flacher Anlagenentwurf kann im Inspektor über
**In elementare Baugruppe umwandeln** migriert werden.
Interne Ports einer Baugruppe werden beim Speichern verborgen; nur nicht intern
belegte Ports werden als Anschlüsse veröffentlicht.

V64_r4: Rohre per Ost-/West-Griff auf Länge ziehen, **F** spiegelt, **I**
invertiert die Flussrichtung, Rechtsklick öffnet das Kontextmenü, **Strg +
Ziehen** verschiebt die Ansicht; das Blatt wächst automatisch mit. Die
Schaltfläche **„Rohrofen mit Fittings & Mischer laden“** zeigt die komplette
Anlage mit Grenzstellen, Kapillaren, Swagelok-Fittings und Gasmischer.

V64_r5: Im Register **Elemente** stehen zusätzlich die Klassik-Teile (Karten
mit Kennzeichen „Klassik“), im Register **Gestell** die Gestellteile. **L** zeichnet
Leitungen mit Stützpunkten (Darstellung im Inspektor: Rohr, Kapillare, heiß,
kalt, Kühlwasser, Spülgas, Gasleitung, Signal), **B** Bereiche, **D** Bemaßungen,
**Z** schaltet den Zustand (Ventil grün/rot, Ofen rot, Kühler blau), die
Toolbar blendet Ebenen aus und hält die Animation an. **„Klassik: Reaktor-P&ID
laden“** und **„Klassik: Symbolvariante laden“** bauen die beiden Referenzbilder
vollständig aus Elementarteilen nach.

## Ereignisanimation anlegen

1. Ein Objekt im Anlagenbild wählen.
2. **HMI → Zustände & Alarme** öffnen.
3. Im Bereich **Ereignisgesteuerte SVG-Animationen** ein Preset wählen.
4. Trigger, Quelle und Bedingung festlegen.
5. Zielobjekt und optional ein semantisches SVG-Unterelement wählen.
6. Effekt, Farben, Dauer und Intensität konfigurieren.
7. Vorschau prüfen und Regel speichern.

Der Export übernimmt dieselbe Regel in **hmi_ui.event_animations**; die
SCADA-Runtime verarbeitet danach echte Signalupdates, allgemeine Events,
Interaktionen und Alarmzustände.

## I/O-Zuweisung

1. Ein Anlagenobjekt auf dem Canvas auswählen.
2. Im Inspector **I/O** öffnen.
3. Rolle, ID, Controller, Bus, Adresse und Funktion prüfen oder ergänzen.
4. **Zuweisung speichern** verwenden.
5. Das eingeklappte Register **Aktuelle Zuordnungen** bei Bedarf öffnen.

Die Canvas-Auswahl wird direkt in den I/O-Editor übernommen. Das Auswählen
allein speichert noch keine Änderung.

## Expliziten HMI-Widgetbezug anlegen

1. Ein P&ID-/SVG-Objekt auswählen.
2. Im Inspector **HMI** und anschließend **Widgets** öffnen.
3. Im vollbreiten Widgetregister vorhandene Relationen prüfen.
4. Unter **Neues Widget anlegen** das Objekt aus dem Dropdown oder über
   **Canvas-Auswahl** übernehmen.
5. Widget-Typ wählen und **Widget anlegen** drücken.

Bei vorhandener I/O-Zuweisung wird die passende Sensor- oder Aktorquelle im
Binding vorbelegt. Widgets bleiben explizit: Das Einfügen eines P&ID-Objekts
erzeugt niemals automatisch ein HMI-Bedienelement.

## Kanonisches Projektmodell

Es gibt keine voneinander unabhängigen Konfigurationswahrheiten:

```text
project.devices.assignments            I/O-Zuweisungen
project.hmi.hmi_ui.widgets              HMI-Widgets
project.hmi.hmi_ui.bindings             Widget-/Objekt-/Quellenbezug
project.processes.process_states        editierbare Projekt-States
project.dynamic_rule_engine.rule_sets   editierbare Projektregeln
project.logic                           editierbare grafische Schaltlogik
V9 process_states/filters/timers/
   rule_engine/rules                    Runtime-Sicht und Exportvertrag
```

## Schaltlogik verwenden

1. In der Hauptnavigation **Logik** öffnen.
2. Einen eigenen Schaltplan erstellen oder die Timer-/Counter-Demo additiv
   ergänzen.
3. Signale oder typisierte Bausteine einfügen.
4. Kompatible Ports verbinden und Bindings im Inspector festlegen.
5. **Prüfen** ausführen.
6. Über **Übersetzen & Exportieren** die gewünschten Zielartefakte erzeugen.

Nur `project.logic` beziehungsweise `*.logic.json` ist die editierbare
Logikquelle. Universal Runtime JSON, V9-Regeln, V8-Cross-Ausgabe, SCL und
PLC-Tag-Mapping werden reproduzierbar daraus abgeleitet.

## Vollständiges Beispielprojekt

Das geerbte Projekt `v63_2_komplettbeispiel` demonstriert P&ID, semantische
Verbindungen, I/O, HMI, Automation und zwei additive Logic-/FBD-Schaltpläne.
Der Build bleibt deterministisch prüfbar:

```bash
node _tools/build_v63_2_example.mjs --check
```

## Entwicklung und vollständige Prüfung

```bash
python3 -m pip install -r requirements-dev.txt
python3 -m playwright install chromium
./test_all.sh
```

Mit externer Runtime-Autorität:

```bash
AUTOMATION_RUNTIME=/pfad/zu/automation_system_v0101 ./test_all.sh
```

Gezielte V64-Prüfungen:

~~~bash
npm run test:v64
python3 test/test_v64_release.py
node test/test_v64_model.mjs
~~~

Gezielte V64_r6-Prüfungen (Scrollbar, strukturierte Baugruppen, Migration):

~~~bash
npm run test:v64:r6
python3 test/smoke_v64_r6.py http://127.0.0.1:8090
~~~

Gezielte V64_r5-Prüfungen (Klassik-Variante, Ebenen, Leitungen, Referenzbeispiele):

~~~bash
npm run test:v64:r5
python3 test/smoke_v64_r5.py http://127.0.0.1:8090
~~~

Die vollständige geerbte V63.4-Prüfung bleibt zusätzlich verfügbar:

~~~bash
npm run test:v63.4
python3 test/test_v63_4_release.py
python3 test/smoke_v63_4.py http://127.0.0.1:8090
~~~

## Verbindliche Dokumentation

- **RELEASE_NOTES_V64_R6_DE.md** — sichtbare Kategoriennavigation und strukturierte Baugruppen;
- **DIAGNOSE_UND_RELEASE_V64_R6_DE.md** — Ursachen, minimal-invasive Architektur und Migration;
- **docs/v64_r6/ARCHITEKTUR_UND_BEDIENUNG.md** — Datenfluss, Platzierung und Bedienung;
- **docs/v64_r6/TEST_UND_FREIGABE.md** — R6-Prüfkette und visuelle Nachweise;
- **docs/v64_r6/RELEASE_MANIFEST_V64_R6.json** — maschinenlesbarer R6-Vertrag;
- **RELEASE_NOTES_V64_R5_DE.md** — Klassik-Symbolfamilie, Zustände, Laufstriche, Leitungen,
  Bereiche, Bemaßungen, Ebenen, Gestell, Referenzbeispiele;
- **DIAGNOSE_UND_RELEASE_V64_R5_DE.md** — Diagnose der Referenzbilder und Korrekturen;
- **docs/v64_r5/ARCHITEKTUR_UND_BEDIENUNG.md** — Klassik-Geometrie, Zustände, Ebenen, Bedienung;
- **docs/v64_r5/TEST_UND_FREIGABE.md** — R5-Prüfkette;
- **docs/v64_r5/RELEASE_MANIFEST_V64_R5.json** — maschinenlesbarer Releasevertrag;
- **RELEASE_NOTES_V64_R4_DE.md** — Strecken, Spiegeln, Invertieren, wachsendes Blatt,
  Inspektor-Register, Kontextmenü, neue Elementarteile;
- **DIAGNOSE_UND_RELEASE_V64_R4_DE.md** — Diagnose der gemeldeten Punkte und Korrekturen;
- **docs/v64_r4/ARCHITEKTUR_UND_BEDIENUNG.md** — Geometrie, Bedienung, Bauanleitung;
- **docs/v64_r4/TEST_UND_FREIGABE.md** — R4-Prüfkette;
- **docs/v64_r4/RELEASE_MANIFEST_V64_R4.json** — maschinenlesbarer Releasevertrag;
- **RELEASE_NOTES_V64_R3_DE.md** — Steck-Editor, Baugruppen, getrennte Inventare;
- **DIAGNOSE_UND_RELEASE_V64_R3_DE.md** — Diagnose der Zeichenebene und Korrekturen;
- **docs/v64_r3/ARCHITEKTUR_UND_BEDIENUNG.md** — Modell, Einrasten, Inventare, Tastatur;
- **docs/v64_r3/TEST_UND_FREIGABE.md** — R3-Prüfkette;
- **docs/v64_r3/RELEASE_MANIFEST_V64_R3.json** — maschinenlesbarer Releasevertrag;
- **RELEASE_NOTES_V64_R2_DE.md** / **docs/v64_r2/** — Automation Studio;
- **RELEASE_NOTES_V64_R1_DE.md** / **docs/v64_r1/** — Zeicheneditor-UX und Referenzanlagen;
- **RELEASE_NOTES_V64_DE.md** — Änderungen und Kompatibilität;
- **DIAGNOSE_UND_RELEASE_V64_DE.md** — Diagnose, Architekturentscheidungen und
  Restgrenzen;
- **docs/v64/ARCHITEKTUR_UND_BEDIENUNG.md** — Gesamtarchitektur und Bedienfluss;
- **docs/v64/SVG_EVENT_ANIMATIONEN.md** — Ereignis- und Animationsvertrag;
- **docs/v64/ANLAGEN_ZEICHENEDITOR.md** — elementares Zeichen- und Inventarmodell;
- **docs/v64/MIGRATION_UND_KOMPATIBILITAET.md** — additive Migration;
- **docs/v64/TEST_UND_FREIGABE.md** — Prüfkette;
- **docs/v64/RELEASE_MANIFEST_V64.json** — maschinenlesbarer Releasevertrag;
- `RELEASE_NOTES_V63_4_DE.md` — Änderungen und Kompatibilität;
- `DIAGNOSE_UND_PATCH_V63_4_DE.md` — Ursachen und minimal-invasive Patches;
- `docs/v63_4/HMI_NAVIGATION_UND_WIDGET_REGISTER.md` — Single-Navigation und Widgetbuttons;
- `docs/v63_4/HMI_ZUSTAENDE_UND_ALARME.md` — geführter Zustands-/Alarmvertrag;
- `docs/v63_4/HMI_DARSTELLUNG.md` — View-/Widget-/Designvertrag;
- `docs/v63_4/TEST_UND_FREIGABE.md` — vollständige Prüfkette;
- `docs/v63_4/RELEASE_MANIFEST_V63_4.json` — maschinenlesbarer Status;
- `V63_4_VERIFICATION_SUMMARY.txt` — kompakte Freigabe- und Prüfübersicht;
- `RELEASE_NOTES_V63_3_DE.md` — Änderungen und Kompatibilität;
- `DIAGNOSE_UND_PATCH_V63_3_DE.md` — Ursachen und minimal-invasive Patches;
- `docs/v63_3/IO_ZUWEISUNGEN_UND_REGISTER.md` — I/O-Bedienvertrag;
- `docs/v63_3/HMI_WIDGET_OBJECT_WORKFLOW.md` — explizite HMI-Relation;
- `docs/v63_3/GENERIC_SENSOR_ENTITY.md` — neues Messstellensymbol;
- `docs/v63_3/TEST_UND_FREIGABE.md` — vollständige Prüfkette;
- `docs/v63_3/RELEASE_MANIFEST_V63_3.json` — maschinenlesbarer Status;
- `docs/v63_2/` — geerbter Stabilitäts- und Automation-Vertrag;
- `docs/v63_1/` — geerbter PF-LOGIC-V1-Standard;
- `docs/v62_1/` — Modal-, Kontextmenü- und HMI-Verträge;
- `docs/v61_1/` — PF-PID-V1-Objektstandard.

## Anlagenfreigabe

Die automatisierte Prüfung bestätigt die Software-Baseline. Vor der Kopplung
an eine reale Produktionsanlage sind zusätzlich FAT/SAT, I/O-Punktprüfung,
Safety- und Security-Freigabe sowie die Abnahme mit der konkreten
SPS-/SCADA-, Feldbus- und Netzwerkinfrastruktur erforderlich.
