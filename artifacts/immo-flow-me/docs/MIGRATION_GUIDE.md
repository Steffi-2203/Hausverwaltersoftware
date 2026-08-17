# Migration Guide: invoice_lines & expense_allocations

## Übersicht

Diese Migration fügt zwei neue Tabellen hinzu:
- `invoice_lines` - Einzelne Rechnungspositionen pro Rechnung
- `expense_allocations` - Kostenverteilung auf Einheiten

## Drizzle TypeScript Schema

Die Tabellen sind in `shared/schema.ts` definiert:

```typescript
// invoice_lines - Rechnungspositionen
export const invoiceLines = pgTable("invoice_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id").notNull().references(() => monthlyInvoices.id),
  expenseType: varchar("expense_type", { length: 50 }).notNull(),
  description: text("description"),
  netAmount: numeric("net_amount", { precision: 12, scale: 2 }).notNull(),
  vatRate: integer("vat_rate").notNull(),
  grossAmount: numeric("gross_amount", { precision: 12, scale: 2 }).notNull(),
  allocationReference: varchar("allocation_reference", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// expense_allocations - Kostenverteilung
export const expenseAllocations = pgTable("expense_allocations", {
  id: uuid("id").defaultRandom().primaryKey(),
  expenseId: uuid("expense_id").notNull().references(() => expenses.id),
  unitId: uuid("unit_id").notNull().references(() => units.id),
  allocatedNet: numeric("allocated_net", { precision: 12, scale: 2 }).notNull(),
  allocationBasis: varchar("allocation_basis", { length: 50 }).notNull(),
  allocationDetail: text("allocation_detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
```

## Testanleitung

### 1. Backup erstellen

```bash
# Vollständiges Backup
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

# Nur Schema
pg_dump $DATABASE_URL --schema-only > schema_backup.sql

# Nur Daten der betroffenen Tabellen (falls vorhanden)
psql $DATABASE_URL -c "COPY invoice_lines TO STDOUT WITH CSV HEADER" > invoice_lines_backup.csv
psql $DATABASE_URL -c "COPY expense_allocations TO STDOUT WITH CSV HEADER" > expense_allocations_backup.csv
```

### 2. Migration ausführen

**Option A: Drizzle Kit (empfohlen)**
```bash
npm run db:push
```

**Option B: SQL direkt**
```bash
psql $DATABASE_URL < migrations/20260201_invoice_lines_expense_allocations.sql
```

### 3. Validierung

```bash
# Validierungsskript ausführen
psql $DATABASE_URL < scripts/validate-schema.sql
```

Erwartete Ergebnisse:
- 2 Tabellen: `invoice_lines`, `expense_allocations`
- 3 Foreign Keys: `invoice_id`, `expense_id`, `unit_id`
- 2 Check Constraints: `chk_invoice_lines_vat_rate`, VAT-Checks auf `monthly_invoices`
- 4+ Indices auf den neuen Tabellen
- 1 Unique Constraint: `uq_expense_allocation_expense_unit`

### 4. Testdaten einfügen

```bash
psql $DATABASE_URL < scripts/seed-invoice-expense-test.sql
```

### 5. Beispiel-Queries

```sql
-- Alle Rechnungspositionen einer Rechnung
SELECT * FROM invoice_lines WHERE invoice_id = '<uuid>';

-- Kostenverteilung einer Ausgabe
SELECT 
    ea.*, 
    u.top_nummer,
    e.bezeichnung 
FROM expense_allocations ea
JOIN units u ON ea.unit_id = u.id
JOIN expenses e ON ea.expense_id = e.id
WHERE ea.expense_id = '<uuid>';

-- Summe pro Rechnung prüfen
SELECT 
    invoice_id,
    SUM(gross_amount) as total_lines,
    (SELECT gesamtbetrag FROM monthly_invoices WHERE id = il.invoice_id) as invoice_total
FROM invoice_lines il
GROUP BY invoice_id;
```

## Rollback

### Vor dem Rollback: Daten exportieren

```bash
# Exportiere Daten bevor sie gelöscht werden
psql $DATABASE_URL -c "COPY invoice_lines TO '/tmp/invoice_lines_export.csv' WITH CSV HEADER"
psql $DATABASE_URL -c "COPY expense_allocations TO '/tmp/expense_allocations_export.csv' WITH CSV HEADER"
```

### Rollback ausführen

```sql
BEGIN;
DROP TABLE IF EXISTS expense_allocations CASCADE;
DROP TABLE IF EXISTS invoice_lines CASCADE;
COMMIT;
```

### Datenverlust bei Rollback

Folgende Daten gehen verloren:
- **invoice_lines**: Alle Rechnungspositionen-Details
- **expense_allocations**: Alle berechneten Kostenverteilungen

**Wiederherstellung nach Rollback:**
1. Migration erneut ausführen
2. CSV-Daten reimportieren:
```sql
COPY invoice_lines FROM '/tmp/invoice_lines_export.csv' WITH CSV HEADER;
COPY expense_allocations FROM '/tmp/expense_allocations_export.csv' WITH CSV HEADER;
```

## Transaktionssicherheit

Alle Migrationen sind in `BEGIN/COMMIT` gewrappt. Bei Fehlern:
- PostgreSQL führt automatisch Rollback durch
- Keine partiellen Änderungen möglich
- Schema bleibt konsistent

## Idempotenz

Die Migration verwendet:
- `CREATE TABLE IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`
- `DO $$ ... IF NOT EXISTS ... $$` für Constraints

Migration kann mehrfach ausgeführt werden ohne Fehler.
