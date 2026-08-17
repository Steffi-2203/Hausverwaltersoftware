# ImmoflowMe — Reparatur-Report (Audit-Umsetzung)

Stand: 2026. Alle Änderungen sind im Code mit `Audit-Befund` kommentiert.

## Behobene kritische Befunde

| ID | Befund | Lösung |
|----|--------|--------|
| K1 | RLS war definiert, aber wirkungslos: der globale Pool setzte `app.current_org` nie; nur 2 Tabellen hatten Policies | `AsyncLocalStorage`-Org-Kontext + `db`-Proxy in `server/db.ts`, Kontext gesetzt in `rlsMiddleware`; Policies werden jetzt für **alle** Tabellen mit `organization_id` erzeugt (`rlsPolicies.ts`), `isRlsAlreadyConfigured()` prüft Vollständigkeit statt Existenz |
| K2 | Bearer-Token-Login setzte keine `organizationId` → Requests ohne Mandantenbezug | `server/index.ts` lädt das Profil und setzt `organizationId` in der Session |
| K3 | `auth_tokens` / `period_locks` wurden zur Laufzeit per `CREATE TABLE` erzeugt und fehlten in Schema & Migrationen | Migration `migrations/20260815_audit_repair.sql` + Drizzle-Definitionen in `shared/schema.ts`; Laufzeit-DDL entfernt |
| K4 | Betriebskostenabrechnung rechnete in Float-Euro und rundete je Mieter einzeln → Summe ≠ Belegsumme | `settlementService.ts` verteilt jeden Beleg **einmal cent-exakt** (Hare/Niemeyer, `distributeCents`); Summen in Integer-Cents |
| K5 | EBICS meldete `success: true` und setzte Zahlungsstapel auf "eingereicht", obwohl keine Bankverbindung existiert | Transportschicht wirft `EbicsNotImplementedError` (HTTP 501) sofern `EBICS_ENABLED=true` fehlt; Dateiweg (SEPA-XML/CAMT.053) bleibt der produktive Pfad |
| K6 | Buchungen ohne Transaktion, Belegnummern mit Race Condition, Periodensperren nie geprüft | Journalbuchung/Storno in `db.transaction`, Belegnummer per `SELECT … FOR UPDATE`, Unique-Index auf `(organization_id, booking_number)`, Periodensperre wird erzwungen |

## Behobene mittlere Befunde

- **M1 SEPA:** IBAN/BIC/Mandatsdatum werden vor dem Export strikt validiert, Namen und Verwendungszweck auf den EPC-Zeichensatz normalisiert, Beträge ≤ 0 abgewiesen; fehlerhafte Datensätze werden namentlich gemeldet statt die Datei von der Bank ablehnen zu lassen.
- **M2 Mahnwesen:** Verzugszinsen und Spesen unterscheiden jetzt Verbraucher (4 % p.a., § 1000 ABGB) und Unternehmer (Basiszinssatz + 9,2 PP, § 456 UGB, zzgl. 40 EUR Pauschale § 458 UGB). Basiszinssatz per `BASE_INTEREST_RATE` konfigurierbar.
- **M3 Schlüsselablage:** EBICS-Privatschlüssel werden nicht mehr mit einem Default-Secret verschlüsselt; ohne `EBICS_KEY_SECRET`/`SESSION_SECRET` (≥32 Zeichen) bricht der Vorgang ab.
- **Mandantentrennung in Services:** `paymentService`, `paymentSplittingService`, `pushRoutes`, Schlüsselinventar und die Accounting-Routen verlangen zwingend eine `organizationId` (sonst 403).

## Nicht enthalten (bewusst offen)

- Echter EBICS-Transport (INI/HIA/HPB/C52/C53/CCT/CDD) — erfordert zertifizierte Client-Bibliothek bzw. Gateway. Aufwand ca. 15–25 Personentage inkl. Bank-Tests.
- Vollständige Umstellung aller älteren Report-/PDF-Pfade auf Integer-Cents (Kernpfade Abrechnung/Heizung sind umgestellt).

## Verifikation

- `npx tsc --noEmit`: fehlerfrei.
- `npx vitest run tests/unit/`: 264 Tests grün; die verbleibenden Fälle benötigen eine erreichbare PostgreSQL-Instanz (`DATABASE_URL`) und wurden in dieser Umgebung nicht ausgeführt.
