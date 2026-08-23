# PF-MODAL-V1 — verbindlicher Dialogstandard

## 1. Geltungsbereich

PF-MODAL-V1 gilt ab Plant Factory V62.1 für alle Oberflächen, die den übrigen
Workspace während einer Entscheidung oder Bearbeitung sperren müssen.
Kanonische Modalwurzeln sind `.modal` und `.v9-modal`.

Nicht als Modal gelten:

- das HMI-Canvas-Overlay;
- das Zeichenflächen-Kontextmenü;
- Tooltips, Statusmeldungen und permanente Inspector-Bereiche.

Diese Oberflächen besitzen eine andere Interaktionssemantik und dürfen den
Workspace nicht blockieren.

## 2. Verbindlicher Aufbau

Ein statisches Modal besitzt:

```text
.modal
└── .modal-content
    ├── .modal-header
    ├── .modal-body
    └── .modal-footer
```

Ein dynamisches V9-Modal besitzt:

```text
.v9-modal
└── .v9-modal__panel
    ├── .v9-modal__head
    ├── .v9-modal__body
    └── .v9-modal__foot
```

Der V62-Fenstermanager erkennt beide Strukturen automatisch und beobachtet
nachträglich eingefügte Dialoge mit einem `MutationObserver`.

## 3. Interaktionsvertrag

Jeder erkannte Dialog muss:

- über seine Titelzeile verschiebbar sein;
- innerhalb des sichtbaren Browserbereichs bleiben;
- über einen sichtbaren Griff größenveränderbar sein;
- zentrierbar sowie maximierbar und wiederherstellbar sein;
- Fokus bei Öffnung übernehmen und bei Schließen zurückgeben;
- per Escape geschlossen werden können, sofern der Fachdialog dies erlaubt;
- vollständig mit Light- und Dark-Theme funktionieren;
- vorhandene Speichern-, Abbrechen- und Validierungslogik unverändert erhalten.

Tastatursteuerung der fokussierten Titelzeile:

- `Alt + Pfeiltaste`: 12 Pixel verschieben;
- `Alt + Umschalt + Pfeiltaste`: 32 Pixel verschieben;
- `Alt + 0`: zentrieren;
- `Alt + Enter`: maximieren oder wiederherstellen.

## 4. Anwendungsdialogdienst

`public/js/dialog_service.js` stellt funktionale Erzeuger bereit:

- `showNotice()`;
- `showConfirmation()`;
- `showInputDialog()`;
- `openModalElement()`;
- `closeModalElement()`.

Browser-native `window.alert()`, `window.confirm()` und `window.prompt()` sind im
Produktcode unzulässig. Sie sind nicht themefähig, nicht verschiebbar, nicht
strukturiert erweiterbar und geben den Interaktionsfluss an den Browser ab.

## 5. Daten- und Transaktionsregel

Ein Dialog darf Fachzustand erst beim expliziten Speichern verändern. Temporäre
Formularwerte bleiben lokal im Dialog. Abbrechen und Escape dürfen keine
History- oder Modelländerung erzeugen. Destruktive Aktionen benötigen eine
modale Bestätigung mit eindeutigem Aktionsnamen.

## 6. Erweiterungsregel

Neue Dialoge müssen eine kanonische Panel- und Headerstruktur verwenden. Eine
Sonderimplementierung von Drag, Resize oder Fokusverwaltung ist unzulässig;
diese Verantwortung liegt ausschließlich beim gemeinsamen Fenstermanager.
