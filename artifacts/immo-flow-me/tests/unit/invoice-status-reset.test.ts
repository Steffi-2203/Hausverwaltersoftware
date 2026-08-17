import { describe, it } from 'node:test';
import { expect } from '../helpers/expect';
import { applyInvoiceStatusRules } from '../../server/lib/invoiceStatusRules';

describe('applyInvoiceStatusRules — paid_amount beim Statusruecksetzen loeschen', () => {
  // ---- Hauptfall: Status → 'offen' ----------------------------------------

  it('loescht paid_amount wenn Status auf "offen" gesetzt wird', () => {
    const result = applyInvoiceStatusRules({ status: 'offen', paidAmount: '1000.00' });
    expect(result.paidAmount).toBeNull();
  });

  it('setzt paid_amount auch ohne expliziten Wert auf null bei Status "offen"', () => {
    const result = applyInvoiceStatusRules({ status: 'offen' });
    expect(result.paidAmount).toBeNull();
  });

  // ---- Hauptfall: Status → 'ueberfaellig' ---------------------------------

  it('loescht paid_amount wenn Status auf "ueberfaellig" gesetzt wird', () => {
    const result = applyInvoiceStatusRules({ status: 'ueberfaellig', paidAmount: '750.50' });
    expect(result.paidAmount).toBeNull();
  });

  it('setzt paid_amount auch ohne expliziten Wert auf null bei Status "ueberfaellig"', () => {
    const result = applyInvoiceStatusRules({ status: 'ueberfaellig' });
    expect(result.paidAmount).toBeNull();
  });

  // ---- Beibehaltung: bezahlt / teilbezahlt --------------------------------

  it('behaelt paid_amount bei Status "bezahlt"', () => {
    const result = applyInvoiceStatusRules({ status: 'bezahlt', paidAmount: '1000.00' });
    expect(result.paidAmount).toBe('1000.00');
  });

  it('behaelt paid_amount bei Status "teilbezahlt"', () => {
    const result = applyInvoiceStatusRules({ status: 'teilbezahlt', paidAmount: '500.00' });
    expect(result.paidAmount).toBe('500.00');
  });

  // ---- Kein Status gesetzt ------------------------------------------------

  it('aendert nichts wenn kein Status gesetzt wird', () => {
    const result = applyInvoiceStatusRules({ paidAmount: '1000.00' });
    expect(result.paidAmount).toBe('1000.00');
    expect(result.status).toBeUndefined();
  });

  it('gibt unveraenderte Daten zurueck wenn weder status noch paid_amount gesetzt sind', () => {
    const result = applyInvoiceStatusRules({ month: 6, year: 2026 });
    expect(result).toEqual({ month: 6, year: 2026 });
  });

  // ---- Weitere Felder bleiben unveraendert --------------------------------

  it('behaelt alle anderen Felder unveraendert wenn paid_amount zurueckgesetzt wird', () => {
    const input = {
      status: 'offen' as const,
      paidAmount: '1000.00',
      month: 3,
      year: 2026,
      gesamtbetrag: '1200.00',
    };
    const result = applyInvoiceStatusRules(input);
    expect(result.paidAmount).toBeNull();
    expect(result.month).toBe(3);
    expect(result.year).toBe(2026);
    expect(result.gesamtbetrag).toBe('1200.00');
    expect(result.status).toBe('offen');
  });
});
