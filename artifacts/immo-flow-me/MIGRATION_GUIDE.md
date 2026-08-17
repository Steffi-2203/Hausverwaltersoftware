# Migrationsleitfaden für diese Reparatur

## 1. Vorbereitung
- **Backup** der Datenbank anlegen (`pg_dump`).
- Umgebungsvariablen prüfen:
  - `DATABASE_URL`
  - `SESSION_SECRET` (mindestens 32 Zeichen — wird jetzt erzwungen)
  - optional `EBICS_KEY_SECRET`, `BASE_INTEREST_RATE`
  - `EBICS_ENABLED` **nicht** setzen, solange kein echter EBICS-Client angebunden ist.

## 2. Migration
Die Datei `migrations/20260815_audit_repair.sql` läuft beim Start automatisch
(`runSqlMigrations`). Sie legt `auth_tokens`, `period_locks` sowie fehlende
Unique-Constraints an und ist idempotent.

**Wichtig:** Der Unique-Index auf `journal_entries (organization_id, booking_number)`
wird nur angelegt, wenn keine doppelten Belegnummern existieren. Andernfalls
erscheint eine `WARNING` im Log. Dubletten vorher bereinigen:

```sql
SELECT organization_id, booking_number, COUNT(*)
FROM journal_entries
WHERE booking_number IS NOT NULL
GROUP BY 1,2 HAVING COUNT(*) > 1;
```

## 3. RLS
Beim ersten Start nach dem Update werden Policies für alle Tabellen mit
`organization_id` erzeugt. Das kann je nach Tabellenzahl einige Sekunden dauern
und wird im Log protokolliert (`RLS: N Tabellen mit organization_id gefunden`).

Prüfen:
```sql
SELECT COUNT(*) FROM pg_policies WHERE policyname LIKE 'org_isolation_%';
```

## 4. Nach dem Deploy testen
- Login mit zwei Organisationen: keine fremden Datensätze sichtbar.
- Eine Buchung anlegen und stornieren (Transaktion + Belegnummer).
- BK-Abrechnung erstellen: Summe der Mieteranteile = Belegsumme (auf den Cent).
- SEPA-Lastschrift exportieren: fehlerhafte IBANs werden namentlich gemeldet.
- EBICS-Aktion auslösen: liefert 501 mit Hinweis auf den Dateiweg.
