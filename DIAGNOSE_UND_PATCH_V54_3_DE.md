# Automated_SVG_Integration — V54.3

**Diagnose und Patch · Stellventil, Skalierung, Schrittmotor-Analyse**

Auslöser dieser Version war eine Frage, keine Fehlermeldung: *„Ließe sich damit ein
Schrittmotor für ein Regelventil ansteuern, und wäre eine Teilöffnung möglich?"*

Um die Frage sauber beantworten zu können, wurde der komplette Stellpfad der Runtime
nachgelesen — vom Sollwert im `process_state` bis zum Modbus-Register. Dabei sind
**drei echte Fehler in der von mir ausgelieferten Konfiguration** aufgefallen. Sie sind
in dieser Version behoben. Die Frage selbst ist in §3 beantwortet.

---

## 1. Der Stellpfad der Runtime — was tatsächlich passiert

Ein analoger Stellwert nimmt genau diesen Weg:

| # | Ort | Datei / Zeile | Wirkung |
|---|-----|---------------|---------|
| 1 | Sollwert lesen | `_automation_engine.py:2675 extract_setpoint_from_state` | liest **nur** die Schlüssel `target_temp_c`, `target_temp`, `target_bar`, `target_pressure_bar`, `target`, `setpoint`, `value`, `power`, `rpm`, `flow_rate` — sonst `0.0` |
| 2 | Regler rechnen | PID bzw. `control_method` | Ausgang wird auf `out_min` … `out_max` begrenzt |
| 3 | Skalieren | `_automation_engine.py:1369 scaled_to_raw` | linear `eng_min…eng_max → raw_min…raw_max`, **mit Clamp auf `eng_min`** |
| 4 | Schreiben | `_modbus_tcp_adapter.py:287` | `client.write_register(address, int(value))` — **ein** 16-Bit-Register |
| 5 | Rücklesen | `_controller_thread.py:358` | `int(readback) == int(command)` |

Aus dieser Kette folgen unmittelbar die drei Fehler.

---

## 2. Drei behobene Fehler in der Auslieferungs-Konfiguration

### 2.1 State 32 — Sollwert wurde stillschweigend zu 0.0

`process_states[state_id=32]` (Kühlmittelventil) trug den Sollwert unter dem Schlüssel
`opening_percent`. Dieser Schlüssel steht in **keiner** der neun Listen aus Schritt 1.
`extract_setpoint_from_state` wäre also durchgelaufen und hätte `0.0` zurückgegeben —
das Ventil hätte zugefahren, ohne dass irgendwo ein Fehler aufgetreten wäre. Der
schlimmste Fehlertyp: still, plausibel, falsch.

Zusätzlich fehlte eine `control_strategy`. Bei `null` erkennt die Runtime
automatisch und hätte hier — mangels `write_coil` und mangels `hysteresis` — einen
P-Regler mit `kp=1.0` und Ausgangsbereich `0…10` gebaut. Ein Prozentwert von 60 wäre
auf 10 begrenzt worden.

**Behoben** (`config/_patches/fn02_ausbau.json`):

```json
{
  "state_id": 32,
  "parameters": { "setpoint": 60.0 },
  "control_strategy": {
    "pid_config_id": 3,
    "type": "PID",
    "sample_time": 0.5,
    "dt_max_s": 2.0,
    "out_min": 0.0,
    "out_max": 100.0,
    "error_scale": 1.0,
    "anti_windup": true
  },
  "description": "Kuehlmittelventil als STELLVENTIL: Sollstellung in Prozent, PID auf 0-100 %, Skalierung ueber profile_id 4 (Level_Percent_0_100 -> Rohwert 0-10000). Damit ist eine Teiloeffnung wie 43 % moeglich, nicht nur auf/zu."
}
```

`setpoint` steht in der Schlüsselliste, `out_max: 100.0` passt zum Prozentbereich.

### 2.2 Aktor 3 auf `ctrl_wago_5` — falsches Skalierungsprofil

Der Aktor trug `profile_id: 3` (`Current_4_20mA`, `eng_min: 4.0`). Der Clamp in
`scaled_to_raw` hätte **jede Stellung unter 4 % auf 4 % angehoben** — das Ventil wäre
nie ganz zu gewesen. Ein Leckstrom von 4 %, dauerhaft, ohne Alarm.

**Behoben:** `profile_id: 4` (`Level_Percent_0_100`, `eng_min 0.0`, `eng_max 100.0`,
`raw_min 0`, `raw_max 10000`). 0 % ergibt jetzt Rohwert 0, 43 % ergibt 4300, 100 %
ergibt 10000 — eine Auflösung von 0,01 %.

### 2.3 Aktor 4 auf `ctrl_wago_3` — gar kein Skalierungsprofil

Das Cross-Worker-Ziel schrieb ohne `profile_id`. `_get_scaling_profile` liefert dann
nichts, `scaled_to_raw` gibt den Wert **unskaliert** zurück: aus 60 % wäre der Rohwert
60 geworden statt 39321 bei 0–10 V. Ein Faktor 655 daneben.

**Behoben** (`config/_patches/cross_worker_e2e_abgleich.json`): `profile_id: 2`
(`Voltage_0_10V`).

**Kontrolle nach dem Neubau:** *Analogaktoren ohne Skalierungsprofil: 0.*
Alle sechs `write_register`-Aktoren tragen jetzt ein passendes Profil.

---

## 3. Die Antwort: Schrittmotor und Teilöffnung

### 3.1 Teilöffnung — funktioniert, ist ab jetzt auch belegt

Stufenlose Ventilstellung ist genau das, wofür der Stellpfad aus §1 gebaut ist.
State 32 ist jetzt das arbeitende Beispiel dafür: Sollstellung 60 %, PID auf 0–100 %,
Skalierung auf Rohwert 0–10000. Jede Zwischenstellung ist erreichbar, und die
Rückmeldung über den Sensor schließt den Regelkreis.

Wer eine *gefahrene* Stellung statt eines Sprungs will, nimmt statt PID eine
`control_method`: Template 1 (`ramp`, `v0 → v1 über t_ramp`) ist bereits in der
Konfiguration und fährt den Sollwert linear. `control_methods[method_id=1]` steht
beispielhaft auf 20 → 80 über 600 s.

### 3.2 Schrittmotor direkt — geht nicht, und zwar aus Prinzip

Die Runtime kennt **keine Bewegungssteuerung**. Konkret fehlt:

- kein Schrittzähler, keine Richtung, kein Puls/Richtungs-Ausgang
- keine Endschalter, keine Referenzfahrt
- keine Beschleunigungs- oder Bremsrampe auf Achsebene
- nur **ein** Register pro Aktor — eine 32-Bit-Position bräuchte zwei
- `int(value)`, also 16 Bit, ohne Vorzeichenbehandlung
- `max_output_delta_per_step` steht zwar im Schema (`_json_formator.py:583`),
  wird in der Runtime aber **nirgends ausgewertet** — ehrlich gesagt: totes Feld

Der Zyklus der Runtime ist ein Regelzyklus, kein Interpolationstakt. Ein Schrittmotor
will Pulse im Millisekundenraster; die Steuerung liefert Sollwerte im
Sekundenraster.

### 3.3 Der Weg, der trotzdem funktioniert

Genau so wird es in der Anlagentechnik ohnehin gemacht: Der Schrittmotor bekommt
**einen eigenen Positionierer**, und die Steuerung redet nur mit dem.

```
Plant Factory / Worker ──(1 Register, 0…10000 = 0…100 %)──► Stellantrieb
                                                             (Positionierer,
                                                              Endschalter, Rampe)
                                                                    │
                                                                    ▼
                                                            Schrittmotor + Ventil
```

Der Antrieb übernimmt Referenzfahrt, Endlagen, Rampen und Schrittzählung. Nach außen
zeigt er genau eine Zahl: die Sollstellung. Und die kann die Steuerung heute schon
schreiben — unverändert, ohne Erweiterung des Vertrags. Marktübliche
Modbus-Stellantriebe (AUMA, Bernard, Rotork, Belimo) arbeiten exakt so.

Das ist die traditionelle Arbeitsteilung, und sie ist die richtige: die Leitebene regelt
den Prozess, die Feldebene bewegt die Mechanik.

---

## 4. Editor: Zustandsfarben jetzt auch im Editor sichtbar

`ANIMATION_CSS` lebte bis V54.2 ausschließlich im exportierten Bundle. Im Editor
blieben `ok-green`, `warn-yellow` und `alarm-red` deshalb wirkungslos — man sah erst
nach dem Export, was man gebaut hatte. `v9_bootstrap.js` installiert das Stylesheet
jetzt beim Start:

```js
function installAnimationStyles() {
  if (document.getElementById('v9-animation-styles')) return;
  const style = document.createElement('style');
  style.id = 'v9-animation-styles';
  style.textContent = ANIMATION_CSS;
  document.head.appendChild(style);
}
```

Zusätzlich trug die Kopfzeile noch „V52 · Config V9". Jetzt: **Plant Factory ·
V54.3 · Config V9 + Cross V8**.

---

## 5. Verifikation

`./test_all.sh` — alle zwölf Stufen bestanden:

| Stufe | Inhalt | Ergebnis |
|-------|--------|----------|
| 1 | Python-Syntax | ok |
| 2 | JS-Syntax, kein OOP, kein ONOFF | ok |
| 3 | Ausgabeformat Editor == Server == Runtime | 58 + 42 |
| 4 | Konfiguration aus Feld-Shards reproduzierbar | ok |
| 5 | Migration deterministisch, 5 UUID gegen Baseline | ok |
| 6 | Rollout-Split V9 lokal + V8 cross | gültig |
| 7 | Bausteinbibliotheken auf V9-Format | 11 + 1 |
| 8 | Regelvertrag gegen die echte Runtime | 29 |
| 9 | Plant-Factory-Kette Zeichnen→Binden→Export→Animation | 31 |
| 10 | Konfigurations-Snapshot im Anlagenbild | 52 |
| 11 | Kern-Regressionstests | 145 |
| 12 | UI-Smoke-Test (Playwright) | 122 |

**479 Zusicherungen, 0 Fehlschläge.**

Zusätzlich geprüft nach dem Neubau der Konfiguration:

```
State 32: {"parameters": {"setpoint": 60.0},
           "control_strategy": {..., "out_max": 100.0}}
Aktor ctrl_wago_5 3 -> profile_id 4   (Level_Percent_0_100)
Aktor ctrl_wago_3 4 -> profile_id 2   (Voltage_0_10V)
Analogaktoren ohne Skalierungsprofil: 0
```

---

## 6. Was sich gegenüber V54.2 geändert hat

| Datei | Änderung |
|-------|----------|
| `config/_patches/fn02_ausbau.json` | State 32: `setpoint` statt `opening_percent`, PID 0–100 % ergänzt; Aktor 3 → `profile_id 4` |
| `config/_patches/cross_worker_e2e_abgleich.json` | Aktor 4 → `profile_id 2` |
| `config/device_state_data_v9.json` | neu erzeugt aus den Patches |
| `public/js/v9_bootstrap.js` | `installAnimationStyles()` |
| `public/index.html` | Titel und Versionsschild auf V54.3 |
| `public/js/ui.js` | Producer-Kennung auf 54.3 |
| `VERSION`, `package.json` | 54.3.0 |

Der Vertrag selbst ist unverändert: V9 mit 26 Abschnitten, V8-Cross mit drei
Lockerungen und fünf Verboten. Es wurde nichts erweitert — es wurde nur richtig
ausgefüllt.
