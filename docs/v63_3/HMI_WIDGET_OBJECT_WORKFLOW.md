# PF-V63.3 expliziter Widget-/Objekt-Workflow

## Ziel

V63.3 vereinfacht das Anlegen und Verknüpfen von HMI-Widgets. Widgets bleiben
bewusst optional und werden niemals automatisch beim Einfügen eines P&ID-
Objekts erzeugt.

## Kanonische Modelle

```text
project.hmi.hmi_ui.widgets[]   Widgetdefinition
project.hmi.hmi_ui.bindings[] Widget ↔ Objekt ↔ Quelle/Interaktion
```

Ein Widget und seine Objektbeziehung bleiben zwei normalisierte Datensätze.
Der neue Workflow erzeugt beide bei Bedarf in **einer atomaren
Projekttransaktion**. Es entsteht keine zweite oder abweichende HMI-Wahrheit.

## Schritt 1: Überblick

Direkt unter der Einleitung **Schritt 1 · HMI-Widget auswählen** steht das
vollbreite Widgetregister. Es zeigt für die aktive View:

- Widgetname;
- Typ;
- verknüpftes P&ID-/SVG-Objekt;
- Datenquelle oder Interaktion;
- vollständige Widget-ID.

Die Tabelle nutzt die verfügbare horizontale Breite. Lange Inhalte dürfen
umbrechen oder horizontal gescrollt werden, aber keine Nachbarfelder
überlagern.

## Schritt 2: Explizites Anlegen

Beim Anlegen stehen drei bewusste Entscheidungen zur Verfügung:

1. aktive HMI-View;
2. optionales P&ID-/SVG-Objekt aus einem Dropdown oder die aktuelle
   Canvas-Auswahl;
3. Widget-Typ.

Wird ein Objekt gewählt, erzeugt Plant Factory in einer Transaktion:

```text
Widget + kanonisches Binding + optional abgeleitete I/O-Quelle
```

Die I/O-Quelle wird nur dann vorbelegt, wenn für das Objekt bereits eine
Device-Zuweisung existiert. Sensoranzeigen bevorzugen Sensorquellen;
Bedienelemente bevorzugen Aktorquellen. Fehlt eine Quelle, bleibt das Binding
valide, aber sichtbar als noch zu vervollständigen markiert.

## Schritt 3: Bearbeiten und Binding

Der Widget-Editor zeigt die aktuelle Relation explizit an:

```text
Widget → P&ID-/SVG-Objekt → Runtime-Quelle oder Interaktion
```

Über **Datenbindung bearbeiten** wird zum bestehenden Binding gewechselt.
Fehlt ein Binding, kann es über **Datenbindung anlegen** erzeugt werden.
Styles, Alarme, Darstellung, Animationen und Interaktionen bleiben in den
bestehenden Workflow-Schritten erhalten.

## Sicherheits- und Konsistenzregeln

- `origin` bleibt `explicit`.
- `auto_created` bleibt `false`.
- P&ID-Drop erzeugt niemals ein Widget.
- Widget- und Binding-Erzeugung bildet genau einen Undo-/Redo-Schritt.
- Das Löschen eines Widgets entfernt wie bisher seine abhängigen Bindings erst
  nach Bestätigung.
- Bestehende Widgets und Bindings werden unverändert geladen.
