/**
 * Regressions-Tests: Float-freie Cent-Arithmetik in trialBalanceService,
 * paymentSplittingService und invoiceService.
 *
 * Jeder Test wählt Beträge, die mit Float-Akkumulation (Number(x)||0-Ketten)
 * zu off-by-one-Cent-Fehlern führen, und verifiziert das cent-exakte Ergebnis.
 */

import { describe, it } from 'node:test';
import { expect } from '../helpers/expect';
import { toCents, fromCents, sumCents, ustFromGrossCents } from '../../server/lib/money';

// ---------------------------------------------------------------------------
// money.ts-Grundlage
// ---------------------------------------------------------------------------
describe('toCents / fromCents — Basis-Rundung', () => {
  it('konvertiert Float-Eurobeträge exakt', () => {
    // 1.005 → kaufmännisch 1.01 (nicht 1.00 wie Math.round)
    expect(toCents(1.005)).toBe(101);
    expect(toCents(19.9)).toBe(1990);
    expect(toCents('19.90')).toBe(1990);
    expect(fromCents(1990)).toBe(19.9);
  });

  it('sumCents addiert exakt ohne Float-Drift', () => {
    // 0.1 + 0.2 in Float = 0.30000000000000004, in Cents = 30
    const cents = sumCents([toCents(0.1), toCents(0.2)]);
    expect(cents).toBe(30);
    expect(fromCents(cents)).toBe(0.3);
  });

  it('sumCents über viele Beträge bleibt exakt', () => {
    // 12 × 99.99 € — Float-Akkumulation würde leicht abweichen
    const monthly = Array.from({ length: 12 }, () => toCents(99.99));
    expect(sumCents(monthly)).toBe(119988); // 1.199,88 €
  });
});

// ---------------------------------------------------------------------------
// invoiceService: calculateTenantCarryForward-Logik (isoliert)
// ---------------------------------------------------------------------------
describe('Übertrag-Berechnung (Cent-basiert)', () => {
  function calcCarryForward(
    invoices: Array<{ grundmiete: number; betriebskosten: number; heizungskosten: number }>,
    payments: number[]
  ) {
    const sollMieteCents = sumCents(invoices.map((inv) => toCents(inv.grundmiete)));
    const sollBkCents = sumCents(invoices.map((inv) => toCents(inv.betriebskosten)));
    const sollHkCents = sumCents(invoices.map((inv) => toCents(inv.heizungskosten)));
    const sollGesamtCents = sollMieteCents + sollBkCents + sollHkCents;

    const istGesamtCents = sumCents(payments.map(toCents));
    const diffCents = istGesamtCents - sollGesamtCents;

    if (diffCents > 0) {
      return { credit: fromCents(diffCents), vortragMiete: 0, vortragBk: 0, vortragHk: 0 };
    }

    let remainingCents = istGesamtCents;
    const paidBkCents = Math.min(remainingCents, sollBkCents);
    remainingCents -= paidBkCents;
    const paidHkCents = Math.min(remainingCents, sollHkCents);
    remainingCents -= paidHkCents;
    const paidMieteCents = Math.min(remainingCents, sollMieteCents);

    return {
      vortragMiete: fromCents(Math.max(0, sollMieteCents - paidMieteCents)),
      vortragBk: fromCents(Math.max(0, sollBkCents - paidBkCents)),
      vortragHk: fromCents(Math.max(0, sollHkCents - paidHkCents)),
    };
  }

  it('errechnet keinen Übertrag wenn vollständig bezahlt', () => {
    const result = calcCarryForward(
      Array.from({ length: 12 }, () => ({ grundmiete: 650, betriebskosten: 180, heizungskosten: 95 })),
      Array.from({ length: 12 }, () => 925)
    );
    expect(result.vortragMiete).toBe(0);
    expect(result.vortragBk).toBe(0);
    expect(result.vortragHk).toBe(0);
  });

  it('errechnet korrekten Übertrag bei Teilzahlung — float-kritische Beträge', () => {
    // 3 × 333.33 Soll, 2 × 333.33 bezahlt → genau 333.33 offen
    const invoices = Array.from({ length: 3 }, () => ({
      grundmiete: 200,
      betriebskosten: 100,
      heizungskosten: 33.33,
    }));
    const result = calcCarryForward(invoices, [333.33, 333.33]);
    // Soll-HK = 3 × 33.33 = 99.99, Soll-BK = 300, Soll-Miete = 600
    // Gesamt = 999.99, bezahlt = 666.66, offen = 333.33
    // Priorität: BK zuerst (300 gedeckt), HK (99.99 gedeckt), Miete: 666.66-300-99.99=266.67 → Vortrag 333.33
    const totalVortrag = fromCents(
      toCents(result.vortragMiete ?? 0) +
      toCents(result.vortragBk ?? 0) +
      toCents(result.vortragHk ?? 0)
    );
    expect(totalVortrag).toBe(333.33);
  });

  it('gibt Credit zurück wenn Mieter überbezahlt hat', () => {
    const result = calcCarryForward(
      [{ grundmiete: 500, betriebskosten: 100, heizungskosten: 50 }],
      [700]
    );
    expect(result.credit).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// invoiceService: buildInvoiceData-Logik (isoliert)
// ---------------------------------------------------------------------------
describe('Vorschreibungsberechnung (Cent-basiert)', () => {
  function buildInvoiceTotals(
    grundmiete: number,
    betriebskosten: number,
    heizungskosten: number,
    ustSatzMiete: number,
    ustSatzBk: number,
    ustSatzHeizung: number,
    carryForwardTotal = 0
  ) {
    const grundmieteCents = toCents(grundmiete);
    const betriebskostenCents = toCents(betriebskosten);
    const heizungskostenCents = toCents(heizungskosten);
    const ustMieteCents = ustFromGrossCents(grundmieteCents, ustSatzMiete);
    const ustBkCents = ustFromGrossCents(betriebskostenCents, ustSatzBk);
    const ustHeizungCents = ustFromGrossCents(heizungskostenCents, ustSatzHeizung);
    const ustCents = ustMieteCents + ustBkCents + ustHeizungCents;
    const vortragCents = toCents(carryForwardTotal);
    const gesamtbetragCents = grundmieteCents + betriebskostenCents + heizungskostenCents + vortragCents;
    return {
      ust: fromCents(ustCents),
      gesamtbetrag: fromCents(gesamtbetragCents),
    };
  }

  it('USt-Summe aus Brutto bei 10%/10%/20% — Standardwohnung', () => {
    const { ust, gesamtbetrag } = buildInvoiceTotals(650, 180, 95, 10, 10, 20);
    // ustMiete = round(650 * 10 / 110) = round(59.09...) = 59
    // ustBk    = round(180 * 10 / 110) = round(16.36...) = 16
    // ustHeizung = round(95 * 20 / 120) = round(15.83...) = 16
    // ust = 59 + 16 + 16 = 91 cent → 0.91 ... wait let me recalc
    // ustMiete = 650 * 10 / 110 = 59.0909... → 59 cents
    // ustBk    = 180 * 10 / 110 = 16.3636... → 16 cents
    // ustHeizung = 95 * 20 / 120 = 15.8333... → 16 cents
    // Summe = 91 cents = 0.91... nope
    // wait, toCents(650) = 65000, ustFromGrossCents(65000, 10) = round(65000 * 10 / 110) = round(5909.09) = 5909
    // toCents(180) = 18000, ustFromGrossCents(18000, 10) = round(18000*10/110) = round(1636.36) = 1636
    // toCents(95) = 9500, ustFromGrossCents(9500, 20) = round(9500*20/120) = round(1583.33) = 1583
    // total ust cents = 5909 + 1636 + 1583 = 9128 → 91.28 €
    expect(ust).toBe(91.28);
    expect(gesamtbetrag).toBe(925); // 650 + 180 + 95
  });

  it('Gesamtbetrag mit Übertrag ist cent-exakt', () => {
    // Übertrag 333.33 € (float-kritisch)
    const { gesamtbetrag } = buildInvoiceTotals(650, 180, 95, 10, 10, 20, 333.33);
    expect(gesamtbetrag).toBe(1258.33);
  });
});

// ---------------------------------------------------------------------------
// trialBalanceService: validateSettlementTotals-Logik (isoliert)
// ---------------------------------------------------------------------------
describe('Saldenbilanz: Cent-Summierung der Settlement-Details', () => {
  function validateSettlement(details: Array<{ totalSoll: number; totalIst: number }>, expenseTotal: number) {
    const totalSollCents = sumCents(details.map((d) => toCents(d.totalSoll)));
    const totalIstCents = sumCents(details.map((d) => toCents(d.totalIst)));
    const expenseTotalCents = toCents(expenseTotal);
    const discrepancyCents = Math.abs(totalSollCents - expenseTotalCents);
    return {
      isValid: discrepancyCents < 1,
      totalSoll: fromCents(totalSollCents),
      totalIst: fromCents(totalIstCents),
      expenseTotal: fromCents(expenseTotalCents),
      discrepancy: fromCents(discrepancyCents),
    };
  }

  it('erkennt exakt ausgeglichene Abrechnung', () => {
    // 3 Einheiten à 333.33 € → Summe 999.99 € = Ausgaben
    const details = Array.from({ length: 3 }, () => ({ totalSoll: 333.33, totalIst: 333.33 }));
    const result = validateSettlement(details, 999.99);
    expect(result.isValid).toBe(true);
    expect(result.totalSoll).toBe(999.99);
    expect(result.discrepancy).toBe(0);
  });

  it('erkennt Diskrepanz bei float-kritischen Beträgen', () => {
    // Ausgaben 1000.00, aber Summe nur 999.99 → Diskrepanz 1 Cent
    const details = Array.from({ length: 3 }, () => ({ totalSoll: 333.33, totalIst: 333.33 }));
    const result = validateSettlement(details, 1000.0);
    expect(result.isValid).toBe(false);
    expect(result.discrepancy).toBe(0.01);
  });

  it('summiert viele Mieteranteile ohne Float-Drift', () => {
    // 100 Einheiten à 10.01 € → exakt 1001.00 €
    const details = Array.from({ length: 100 }, () => ({ totalSoll: 10.01, totalIst: 10.01 }));
    const result = validateSettlement(details, 1001.0);
    expect(result.isValid).toBe(true);
    expect(result.totalSoll).toBe(1001.0);
  });
});

// ---------------------------------------------------------------------------
// paymentSplittingService: Restcent-Berechnung (isoliert)
// ---------------------------------------------------------------------------
describe('Zahlungsaufteilung: Cent-exakte Restwert-Berechnung', () => {
  it('Restbetrag nach Zuteilung ist cent-exakt', () => {
    const paymentCents = toCents(925.00);
    const invoiceCents = toCents(925.00);
    const appliedCents = Math.min(paymentCents, invoiceCents);
    const remainingCents = paymentCents - appliedCents;
    expect(remainingCents).toBe(0);
    expect(fromCents(remainingCents)).toBe(0);
  });

  it('Teilzahlung: Restbetrag ist exakt 1 Cent bei float-kritischem Betrag', () => {
    // Zahlung 333.33, Rechnung 333.34 → Rest 0.01 €
    const paymentCents = toCents(333.33);
    const invoiceCents = toCents(333.34);
    const appliedCents = Math.min(paymentCents, invoiceCents);
    const remainingInvoiceCents = invoiceCents - appliedCents;
    expect(remainingInvoiceCents).toBe(1); // 1 Cent
    expect(fromCents(remainingInvoiceCents)).toBe(0.01);
  });

  it('totalAllocated = paymentAmount - remainingAmount (exakt)', () => {
    const paymentCents = toCents(1234.56);
    const allocatedCents = toCents(1000.00);
    const remainingCents = paymentCents - allocatedCents;
    expect(fromCents(paymentCents - remainingCents)).toBe(1000.00);
  });
});
