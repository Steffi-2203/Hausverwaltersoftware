/**
 * invoiceStatusRules.ts
 *
 * Reine Hilfsfunktionen fuer Statusaenderungen bei monthly_invoices.
 * Kein DB-Zugriff — einfach testbar.
 */

import type { InsertMonthlyInvoice } from '@shared/schema';

/**
 * Stellt sicher dass paid_amount beim Zuruecksetzen auf 'offen' oder
 * 'ueberfaellig' immer auf null gesetzt wird.
 *
 * Hintergrund: Wird ein Verwalter eine bereits bezahlte Vorschreibung
 * manuell auf 'offen' zurueckgesetzt, ohne paid_amount explizit zu
 * loeschen, bleibt der alte Wert in der DB — die Vorschreibung
 * erscheint dann gleichzeitig als "offen" und haette einen bezahlten
 * Betrag, was den offenen Saldo verfaelscht.
 */
export function applyInvoiceStatusRules(
  data: Partial<InsertMonthlyInvoice>,
): Partial<InsertMonthlyInvoice> {
  if (data.status === 'offen' || data.status === 'ueberfaellig') {
    return { ...data, paidAmount: null };
  }
  return data;
}
