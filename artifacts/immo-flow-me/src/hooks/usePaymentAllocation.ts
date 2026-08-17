import { useMemo } from 'react';
import { allocatePayment, allocateMultiplePayments, type InvoiceAmounts, type AllocationDetails } from '@/lib/paymentAllocation';

interface Invoice {
  id: string;
  grundmiete: number;
  betriebskosten: number;
  heizungskosten: number;
  ust: number;
  gesamtbetrag: number;
}

interface Payment {
  id: string;
  betrag: number;
  eingangs_datum: string;
}

/**
 * Hook für die Zahlungsaufteilung nach AT-Hausverwaltungsstandard
 * Reihenfolge: BK → Heizung → Miete
 */
export function usePaymentAllocation(invoice: Invoice | null, payments: Payment[] = []) {
  return useMemo(() => {
    if (!invoice) {
      return {
        allocation: null,
        einzelzuordnungen: [],
        gesamtstatus: 'offen' as const,
        gesamtbezahlt: 0,
        restbetrag: 0
      };
    }

    const invoiceAmounts: InvoiceAmounts = {
      grundmiete: invoice.grundmiete,
      betriebskosten: invoice.betriebskosten,
      heizungskosten: invoice.heizungskosten,
      ust: invoice.ust,
      gesamtbetrag: invoice.gesamtbetrag
    };

    if (payments.length === 0) {
      return {
        allocation: null,
        einzelzuordnungen: [],
        gesamtstatus: 'offen' as const,
        gesamtbezahlt: 0,
        restbetrag: invoice.gesamtbetrag
      };
    }

    if (payments.length === 1) {
      const result = allocatePayment(payments[0].betrag, invoiceAmounts);
      return {
        allocation: result,
        einzelzuordnungen: [{
          ...result,
          datum: payments[0].eingangs_datum,
          betrag: payments[0].betrag
        }],
        gesamtstatus: result.status === 'vollstaendig' ? 'bezahlt' as const : 
                      result.status === 'ueberzahlt' ? 'ueberzahlt' as const : 
                      'teilbezahlt' as const,
        gesamtbezahlt: payments[0].betrag,
        restbetrag: result.allocation.unterzahlung - result.allocation.ueberzahlung
      };
    }

    // Mehrere Zahlungen
    const multiResult = allocateMultiplePayments(
      payments.map(p => ({ betrag: p.betrag, datum: p.eingangs_datum })),
      invoiceAmounts
    );

    return {
      allocation: multiResult.einzelzuordnungen[multiResult.einzelzuordnungen.length - 1] || null,
      einzelzuordnungen: multiResult.einzelzuordnungen,
      gesamtstatus: multiResult.gesamtstatus,
      gesamtbezahlt: multiResult.gesamtbezahlt,
      restbetrag: multiResult.restbetrag
    };
  }, [invoice, payments]);
}

/**
 * Hook für einzelne Zahlungsvorschau
 */
export function usePaymentPreview(
  zahlungsbetrag: number,
  invoice: Invoice | null
): AllocationDetails | null {
  return useMemo(() => {
    if (!invoice || zahlungsbetrag <= 0) return null;

    const invoiceAmounts: InvoiceAmounts = {
      grundmiete: invoice.grundmiete,
      betriebskosten: invoice.betriebskosten,
      heizungskosten: invoice.heizungskosten,
      ust: invoice.ust,
      gesamtbetrag: invoice.gesamtbetrag
    };

    return allocatePayment(zahlungsbetrag, invoiceAmounts);
  }, [zahlungsbetrag, invoice]);
}
