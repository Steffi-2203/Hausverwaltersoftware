# Runbook: Schlüsselrotation für die Feldverschlüsselung (AES-256-GCM)

**Letzte Probe-Rotation:** 2026-08-18 — Entwicklungsumgebung, alle 8 Tabellen verifiziert. Produktions-Rotation: Schritt 4 unten.

## Hintergrund

Alle IBANs, BICs und SEPA-Kontonummern werden mit AES-256-GCM (Schlüssel: 32 Byte, Base64-kodiert) an-rest verschlüsselt. Der aktive Schlüssel liegt als Deployment-Secret `FIELD_ENCRYPTION_KEY`. Eine Rotation ersetzt diesen Schlüssel ohne Datenverlust: der alte Schlüssel wird temporär als `FIELD_ENCRYPTION_KEY_OLD` parallel gehalten, alle Ciphertexte werden umgestellt, danach wird `_OLD` entfernt.

### Betroffene Tabellen (8)

| Tabelle | Spalten |
|---|---|
| `bank_accounts` | `iban`, `bic` |
| `tenants` | `iban`, `bic` |
| `owners` | `iban`, `bic` |
| `organizations` | `iban`, `bic` |
| `contractors` | `iban`, `bic` |
| `ebics_connections` | `iban`, `bic` |
| `transactions` | `partner_iban` |
| `kautionen` | `treuhandkonto_iban` |

---

## Ablauf (Schritt für Schritt)

### Schritt 1 — Neuen Schlüssel erzeugen

Lokal im Terminal (niemals in CI-Logs, niemals als Argument):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Den ausgegebenen Wert notieren als `NEW_KEY`. **Nie in Dateien, Git, Logs oder Chat eintragen.**

### Schritt 2 — Secrets in der Produktionsumgebung setzen

Im Replit-Workspace: **Publishing → Adjust settings → Environment Variables (Production)**

1. Neues Secret anlegen:
   - Name: `FIELD_ENCRYPTION_KEY_OLD`
   - Wert: der **aktuelle** Wert von `FIELD_ENCRYPTION_KEY` (aus dem bestehenden Secret kopieren)
2. Bestehendes Secret aktualisieren:
   - Name: `FIELD_ENCRYPTION_KEY`
   - Wert: `NEW_KEY` (aus Schritt 1)

> ⚠️ Sicherstellen: `FIELD_ENCRYPTION_KEY_OLD` ist der exakte aktuelle Wert, bevor `FIELD_ENCRYPTION_KEY` überschrieben wird. Bei einem Fehler hier werden Daten unlesbar.

### Schritt 3 — Deployment starten

Im Replit-Workspace auf **Publish** klicken (oder erneut deployen).

Beim Start läuft automatisch `migrateFieldEncryption()`, die:
1. Erkennt, dass `FIELD_ENCRYPTION_KEY_OLD` gesetzt ist.
2. `rotateFieldEncryptionKey(OLD, NEW)` aufruft — alle 8 Tabellen werden per CAS-Update umgestellt.
3. Eine Abschlussverifikation unter Tabellensperre (`LOCK TABLE IN EXCLUSIVE MODE`) durchführt.
4. Den Server **nur** startet, wenn `verified=true` und `errors.length === 0`.

Bei Fehlern startet der Server **nicht** (Fail-Closed) und loggt den genauen Fehler. `FIELD_ENCRYPTION_KEY_OLD` bleibt gültig — Rollback ist möglich (siehe unten).

Logs prüfen:
```
[fieldEncryption] Rotationsfenster aktiv — schlüssele Bestandsdaten um...
[fieldEncryption] Rotation abgeschlossen (N rotiert, M neu verschlüsselt). FIELD_ENCRYPTION_KEY_OLD kann jetzt entfernt werden.
```

### Schritt 4 — Rotation verifizieren

Verifizierungsskript lokal gegen die Produktions-DB ausführen:

```bash
DATABASE_URL=<prod-db-url> \
  FIELD_ENCRYPTION_KEY=<NEW_KEY> \
  pnpm --filter @workspace/immo-flow-me run verify-encryption
```

Erwartete Ausgabe:
```
✓ bank_accounts:     N Zeilen, alle lesbar (0 Fehler)
✓ tenants:           N Zeilen, alle lesbar (0 Fehler)
✓ owners:            N Zeilen, alle lesbar (0 Fehler)
✓ organizations:     N Zeilen, alle lesbar (0 Fehler)
✓ contractors:       N Zeilen, alle lesbar (0 Fehler)
✓ ebics_connections: N Zeilen, alle lesbar (0 Fehler)
✓ transactions:      N Zeilen, alle lesbar (0 Fehler)
✓ kautionen:         N Zeilen, alle lesbar (0 Fehler)
Gesamt: N Zeilen geprüft, 0 Fehler. Schlüssel ist korrekt.
```

Wenn irgendeine Zeile einen Fehler meldet: **nicht mit Schritt 5 fortfahren** — Rollback einleiten.

### Schritt 5 — FIELD_ENCRYPTION_KEY_OLD entfernen

Erst nach erfolgreicher Verifikation (Schritt 4):

Im Replit-Workspace: **Publishing → Adjust settings → Environment Variables (Production)**
→ `FIELD_ENCRYPTION_KEY_OLD` löschen.

Erneut deployen, damit der Server ohne `_OLD` startet. Logs prüfen: keine `_OLD`-Warnung.

---

## Rollback

> ⚠️ **Achtung: Schlüssel NIE einfach tauschen.** Während und nach der Rotation sind Datensätze mit dem neuen Schlüssel verschlüsselt. Den alten Key als `FIELD_ENCRYPTION_KEY` zu setzen und `_OLD` zu löschen würde alle bereits rotierten Datensätze unlesbar machen.

### Rollback während des Rotationsfensters (Schritte 2–4)

Die Boot-Migration hat bereits einen Teil der Datensätze auf den neuen Schlüssel umgestellt. Das sichere Verfahren ist eine **Rückwärtsrotation** über denselben Mechanismus:

1. Im Deployment-Secret **tauschen**:
   - `FIELD_ENCRYPTION_KEY` = **alter** Key (bisheriger Wert von `FIELD_ENCRYPTION_KEY_OLD`)
   - `FIELD_ENCRYPTION_KEY_OLD` = **neuer** Key (bisheriger Wert von `FIELD_ENCRYPTION_KEY`)
2. Erneut deployen — die Boot-Migration rotiert jetzt alle Datensätze vom neuen Schlüssel zurück auf den alten.
3. Verifizieren: `pnpm --filter @workspace/immo-flow-me run verify-encryption` (mit dem alten Key als `FIELD_ENCRYPTION_KEY`)
4. `FIELD_ENCRYPTION_KEY_OLD` entfernen, erneut deployen.

Dieses Verfahren funktioniert, weil `decryptField()` beim Entschlüsselungsfehler mit dem Hauptschlüssel automatisch `_OLD` als Fallback versucht — so sind Datensätze beider Generationen während der Rückwärtsrotation lesbar.

### Rollback nach Schritt 5 (KEY_OLD bereits entfernt)

Nach dem Entfernen von `FIELD_ENCRYPTION_KEY_OLD` sind alle Datensätze mit dem neuen Schlüssel verschlüsselt. Ein Zurück zum alten Schlüssel ist nur möglich, wenn der alte Schlüsselwert noch sicher außerhalb von Replit aufbewahrt wurde. Vorgehen (Rückwärtsrotation):

1. Im Deployment-Secret **tauschen**:
   - `FIELD_ENCRYPTION_KEY` = **alter** Key (der historisch gesicherte Wert)
   - `FIELD_ENCRYPTION_KEY_OLD` = **aktueller** (neuer) Key
2. Erneut deployen — die Boot-Migration rotiert alle Datensätze vom neuen Schlüssel zurück auf den alten.
3. Verifizieren: `pnpm --filter @workspace/immo-flow-me run verify-encryption` (mit dem alten Key als `FIELD_ENCRYPTION_KEY`)
4. `FIELD_ENCRYPTION_KEY_OLD` entfernen, erneut deployen.

**Voraussetzung:** Der alte Schlüsselwert muss an einem sicheren Ort außerhalb von Replit aufbewahrt worden sein (z.B. Passwort-Manager, HSM). Ohne den alten Schlüsselwert ist eine Rückwärtsrotation nicht möglich — die Daten bleiben mit dem neuen Schlüssel verschlüsselt und lesbar.

---

## CLI-Rotation (ohne Deployment)

Alternativ zum Boot-Migrations-Weg: CLI-Skript in einem Wartungsfenster (Server stoppen):

```bash
FIELD_ENCRYPTION_KEY_OLD=<alter-Base64-Key> \
  FIELD_ENCRYPTION_KEY_NEW=<neuer-Base64-Key> \
  pnpm --filter @workspace/immo-flow-me run rotate-encryption-key
```

Danach `FIELD_ENCRYPTION_KEY` im Deployment-Secret auf den neuen Wert setzen und deployen.

---

## Sicherheitsregeln

- **Schlüssel NIEMALS als Shell-Argument** übergeben (erscheinen in `ps aux` und Shell-History).
- **Schlüssel NIEMALS in Dateien oder Git einchecken** — nur als Replit-Secret speichern.
- **Nur ein Rotationsfenster gleichzeitig** — nie zwei `_OLD`-Schlüssel parallel halten.
- **Wartungsfenster**: Rotation in Zeiten minimaler Schreiblast durchführen (CAS schützt, aber Konflikte verlängern die Rotation).
- **Rotation idempotent**: Ein abgebrochener Lauf kann gefahrlos wiederholt werden. Der neue Schlüssel muss korrekt sein; ein falscher neuer Schlüssel macht Daten unlesbar.

---

## Häufige Fehler

| Fehler | Ursache | Lösung |
|---|---|---|
| `Schlüssel ist kein gültiges Base64` | Padding oder Sonderzeichen beim Kopieren | Exakt den generierten Wert kopieren |
| `Schlüssel muss exakt 32 Bytes sein` | Falscher Schlüssel (z.B. zu kurz) | Neu generieren |
| `Rotation unvollständig — verified=false` | DB-Fehler oder parallele Writes | Server stoppen, Rotation erneut ausführen |
| `FIELD_ENCRYPTION_KEY_OLD identisch mit FIELD_ENCRYPTION_KEY` | Rotation bereits abgeschlossen | `_OLD` entfernen |
| `Wert mit aktuellem Schlüssel nicht lesbar und KEY_OLD nicht gesetzt` | `_OLD` zu früh entfernt, Restdaten vorhanden | `_OLD` wieder setzen, Rotation erneut |

---

## Verwandte Dateien

- `server/lib/fieldEncryption.ts` — Krypto-Primitive
- `server/lib/migrateFieldEncryption.ts` — Boot-Migration inkl. Rotationspfad
- `server/lib/rotateFieldEncryption.ts` — CAS-Rotation mit Abschlussverifikation
- `scripts/rotate-field-encryption-key.ts` — CLI-Einstiegspunkt
- `scripts/verify-field-encryption.ts` — Verifizierungsskript (alle 8 Tabellen)
