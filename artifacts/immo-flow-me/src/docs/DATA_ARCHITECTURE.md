# Daten-Architektur: Single Source of Truth

## Übersicht

Diese Dokumentation beschreibt die Datenflüsse und -quellen der Immobilienverwaltungs-App.

## Führende Tabellen (Single Source of Truth)

### 1. `payments` - Mieteinnahmen
**Führend für:** Mietzahlungen und Rechnungszuordnung

| Feld | Beschreibung |
|------|--------------|
| tenant_id | Verknüpfung zum Mieter |
| invoice_id | Verknüpfung zur Rechnung (für Zuordnung) |
| betrag | Zahlungsbetrag |
| eingangs_datum | Zahlungseingang |
| zahlungsart | SEPA, Überweisung, Bar, etc. |

**Verwendung in:**
- `useCombinedPayments` - Mieteinnahmen für Reports
- `usePaymentAllocation` - Rechnungszuordnung
- SOLL/IST Vergleich
- Buchhaltungsübersicht (Einnahmen)

### 2. `transactions` - Bankbewegungen
**Führend für:** Alle Kontobewegungen (Import von Bank)

| Feld | Beschreibung |
|------|--------------|
| amount | Positiv = Einnahme, Negativ = Ausgabe |
| category_id | Buchungskategorie |
| property_id | Zuordnung zur Liegenschaft |
| tenant_id | Optional: Bei Mietzahlungen |
| transaction_date | Buchungsdatum |

**Verwendung in:**
- Banking-Übersicht
- Kontostand-Berechnung
- USt-Meldung (über Kategorien)

### 3. `expenses` - Betriebskosten
**Führend für:** BK-Abrechnung

| Feld | Beschreibung |
|------|--------------|
| property_id | Zuordnung zur Liegenschaft |
| category | betriebskosten_umlagefaehig / instandhaltung |
| expense_type | Versicherung, Müll, Heizung, etc. |
| transaction_id | Optional: Verknüpfung zur Bank-Transaktion |

**Verwendung in:**
- BK-Abrechnung
- Ausgaben-Report

## Synchronisations-Regeln

```
┌─────────────────────────────────────────────────────────────────┐
│                    DATENFLUSS                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   payments ─────────────────────► transactions                   │
│   (Mietzahlung)     Sync→        (Banking-Übersicht)            │
│                                                                  │
│   transactions ─────────────────► expenses                       │
│   (Ausgaben)        Sync→        (BK-Abrechnung)                │
│                                                                  │
│   ⛔ transactions ───X──────────► payments                       │
│                     KEIN SYNC (vermeidet Duplikate)             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 1. payments → transactions (One-Way)
- Mietzahlungen aus `payments` werden zu `transactions` kopiert
- Ermöglicht Banking-Übersicht mit allen Einnahmen
- `transactions` Kopie hat `tenant_id` und `category_id = Mieteinnahmen`

### 2. transactions → expenses (One-Way)
- Ausgaben mit BK-relevanter Kategorie werden zu `expenses` kopiert
- `expenses` hat `transaction_id` für Rückverfolgung
- Mapping via `CATEGORY_TO_EXPENSE_MAPPING`

### 3. transactions → payments: **DEAKTIVIERT**
- Wurde entfernt um Duplikate zu verhindern
- Wenn Banking-Import Mietzahlung zeigt → Nutzer erfasst via Zahlungsformular

## Report-Datenquellen

| Report | Datenquelle | Hook |
|--------|-------------|------|
| SOLL/IST Vergleich | `payments` | `useCombinedPayments` |
| Buchhaltung Einnahmen | `payments` | `useCombinedPayments` |
| Buchhaltung Ausgaben | `transactions` (amount < 0) | `useTransactions` |
| USt-Meldung | `transactions` | `useTransactions` |
| Banking-Übersicht | `transactions` | `useTransactions` |
| BK-Abrechnung | `expenses` | `useExpenses` |

## Stammdaten-Verknüpfungen

```
properties
    │
    ├── units (property_id)
    │       │
    │       ├── tenants (unit_id)
    │       │       │
    │       │       └── payments (tenant_id)
    │       │
    │       └── rent_expectations (unit_id)
    │
    ├── expenses (property_id)
    │
    └── property_owners (property_id)

transactions
    ├── tenant_id → tenants (für Mietzahlungen)
    ├── property_id → properties (direkt, für Filter)
    ├── unit_id → units (optional)
    └── category_id → account_categories
```

## Duplikat-Vermeidung

### Bei Migration (Sync)
1. Check via `transaction_id` auf `expenses` (eindeutig)
2. Fallback: Check via Datum + Betrag + Property/Tenant

### Bei Neuanlage
- `createPaymentWithSync`: Erstellt payment + synced transaction
- `createTransactionWithSync`: Erstellt transaction + synced expense (wenn relevant)
- Kein Rück-Sync von transactions zu payments

## Hooks-Übersicht

| Hook | Funktion |
|------|----------|
| `useCombinedPayments` | Mieteinnahmen aus payments (SSOT) |
| `useTransactions` | Alle Bankbewegungen |
| `useExpenses` | Betriebskosten für BK-Abrechnung |
| `usePaymentSync` | Sync-Operationen mit korrekten Richtungen |
| `usePaymentAllocation` | Rechnungszuordnung |

## Wichtige Hinweise

1. **Für Mieteinnahmen immer `payments` verwenden** - nicht `transactions`
2. **Property-Filter:** Über tenant → unit → property (bei payments/transactions)
3. **Ausgaben-Filter:** Direkt über `property_id` auf expenses/transactions
4. **Keine Duplikate mehr** durch deaktivierte transactions→payments Sync
