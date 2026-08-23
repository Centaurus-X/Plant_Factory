# PF-V63.4-HMI-UX – Navigation und Widgetregister

## Verbindlicher Navigationsvertrag

Die sichtbare HMI-Navigation besteht aus genau vier nummerierten Schritten:

1. Widgets
2. Datenbindung
3. Zustände & Alarme
4. Darstellung

Die Leiste `.hmi-workflow-overview` ist die kanonische `tablist`. Jeder Schritt
ist ein `button[role="tab"]` und verweist über `aria-controls` auf genau ein
`tabpanel`.

Die geerbte `.hmi-legacy-tab-list` darf nicht gelöscht werden. Sie bleibt als
Kompatibilitätshaken im DOM, ist jedoch `hidden`, `aria-hidden="true"` und
visuell vollständig ausgeblendet. Neue Integrationen müssen ausschließlich die
nummerierten Workflowtabs verwenden.

## Tastaturbedienung

- Pfeil links/rechts: vorheriger beziehungsweise nächster Schritt;
- Pos1: erster Schritt;
- Ende: letzter Schritt;
- Enter/Leertaste: Aktivierung über das native Buttonverhalten.

## Widgetregister

Widgetnamen sind kompakte Auswahlbuttons. Sie dürfen nicht als Links oder
unterstrichener Text dargestellt werden. Der bestehende Akzentfarbcode für die
aktive Zeile bleibt verbindlich.

Die Tabelle behält die Spalten Widget, Typ, P&ID-/SVG-Objekt,
Datenquelle/Interaktion und ID. Lange Inhalte dürfen umbrechen; das kanonische
Modell wird nicht gekürzt.
