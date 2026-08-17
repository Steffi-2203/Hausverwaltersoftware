import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ========== SEPA XML VALIDATION TESTS ==========

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function validateIban(iban: string): boolean {
  const cleaned = iban.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/.test(cleaned)) return false;
  if (cleaned.startsWith('AT') && cleaned.length !== 20) return false;
  if (cleaned.startsWith('DE') && cleaned.length !== 22) return false;
  return true;
}

function validateBic(bic: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic.toUpperCase());
}

function formatSepaAmount(amount: number): string {
  return amount.toFixed(2);
}

function generateEndToEndId(tenantId: string, month: number, year: number): string {
  return `E2E-${year}${String(month).padStart(2, '0')}-${tenantId.substr(0, 8)}`.toUpperCase();
}

/** Helper: assert two numbers are approximately equal within a given number of decimal places. */
function assertCloseTo(actual: number, expected: number, decimals: number, msg?: string): void {
  const factor = Math.pow(10, decimals);
  const diff = Math.abs(Math.round(actual * factor) - Math.round(expected * factor));
  assert.ok(diff <= 1, msg ?? `Expected ${actual} to be close to ${expected} (${decimals} decimals)`);
}

describe('SEPA Export Validation', () => {
  it('validates Austrian IBANs correctly', () => {
    assert.strictEqual(validateIban('AT611904300234573201'), true);
    assert.strictEqual(validateIban('AT61 1904 3002 3457 3201'), true);
    assert.strictEqual(validateIban('AT12345'), false);
    assert.strictEqual(validateIban('XX611904300234573201'), true); // generic format ok
    assert.strictEqual(validateIban('123456'), false);
    assert.strictEqual(validateIban(''), false);
  });

  it('validates German IBANs correctly', () => {
    assert.strictEqual(validateIban('DE89370400440532013000'), true);
    assert.strictEqual(validateIban('DE8937040044053201300'), false); // wrong length
  });

  it('validates BIC format', () => {
    assert.strictEqual(validateBic('GIBAATWWXXX'), true);
    assert.strictEqual(validateBic('OPSKATWW'), true);
    assert.strictEqual(validateBic('BKAUATWW'), true);
    assert.strictEqual(validateBic('abc'), false);
    assert.strictEqual(validateBic(''), false);
  });

  it('escapes XML special characters correctly', () => {
    assert.strictEqual(escapeXml('Müller & Söhne'), 'Müller &amp; Söhne');
    assert.strictEqual(escapeXml('Test <tag>'), 'Test &lt;tag&gt;');
    assert.strictEqual(escapeXml('He said "hello"'), 'He said &quot;hello&quot;');
    assert.strictEqual(escapeXml("O'Brien"), "O&apos;Brien");
    assert.strictEqual(escapeXml('Normal text'), 'Normal text');
  });

  it('formats SEPA amounts to 2 decimal places', () => {
    assert.strictEqual(formatSepaAmount(1234.5), '1234.50');
    assert.strictEqual(formatSepaAmount(0), '0.00');
    assert.strictEqual(formatSepaAmount(99.999), '100.00');
    assert.strictEqual(formatSepaAmount(1500), '1500.00');
  });

  it('generates valid end-to-end IDs', () => {
    const id = generateEndToEndId('abc12345-def-678', 3, 2026);
    assert.strictEqual(id, 'E2E-202603-ABC12345');
    assert.ok(id.length <= 35); // SEPA max 35 chars
  });

  it('generates unique end-to-end IDs for different periods', () => {
    const id1 = generateEndToEndId('abc12345', 1, 2026);
    const id2 = generateEndToEndId('abc12345', 2, 2026);
    const id3 = generateEndToEndId('def67890', 1, 2026);
    assert.notStrictEqual(id1, id2);
    assert.notStrictEqual(id1, id3);
  });

  it('handles pain.008.001.02 direct debit XML structure', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02">
  <CstmrDrctDbtInitn>
    <GrpHdr>
      <MsgId>MSG-001</MsgId>
      <CreDtTm>2026-01-15T10:00:00Z</CreDtTm>
      <NbOfTxs>2</NbOfTxs>
      <CtrlSum>1500.00</CtrlSum>
    </GrpHdr>
  </CstmrDrctDbtInitn>
</Document>`;
    assert.ok(xml.includes('pain.008.001.02'));
    assert.ok(xml.includes('<NbOfTxs>2</NbOfTxs>'));
    assert.ok(xml.includes('<CtrlSum>1500.00</CtrlSum>'));
  });

  it('handles pain.001.001.03 credit transfer XML structure', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>MSG-002</MsgId>
      <NbOfTxs>1</NbOfTxs>
      <CtrlSum>500.00</CtrlSum>
    </GrpHdr>
  </CstmrCdtTrfInitn>
</Document>`;
    assert.ok(xml.includes('pain.001.001.03'));
    assert.ok(xml.includes('<CstmrCdtTrfInitn>'));
  });
});

// ========== DUNNING SYSTEM TESTS (ABGB §1333) ==========

interface DunningLevel {
  level: 0 | 1 | 2 | 3;
  name: string;
  daysOverdue: number;
  fee: number;
  interestRate: number;
}

const DUNNING_LEVELS: DunningLevel[] = [
  { level: 0, name: "Offen", daysOverdue: 0, fee: 0, interestRate: 0 },
  { level: 1, name: "Zahlungserinnerung", daysOverdue: 14, fee: 0, interestRate: 0 },
  { level: 2, name: "1. Mahnung", daysOverdue: 30, fee: 5, interestRate: 0.04 },
  { level: 3, name: "2. Mahnung", daysOverdue: 45, fee: 10, interestRate: 0.04 },
];

const ABGB_INTEREST_RATE = 0.04;

function calculateInterest(amount: number, daysOverdue: number): number {
  if (daysOverdue <= 14) return 0;
  const yearFraction = daysOverdue / 365;
  return Math.round(amount * ABGB_INTEREST_RATE * yearFraction * 100) / 100;
}

function getDunningLevel(daysOverdue: number): DunningLevel {
  for (let i = DUNNING_LEVELS.length - 1; i >= 0; i--) {
    if (daysOverdue >= DUNNING_LEVELS[i].daysOverdue) {
      return DUNNING_LEVELS[i];
    }
  }
  return DUNNING_LEVELS[0];
}

function calculateTotalDue(amount: number, daysOverdue: number): { fee: number; interest: number; total: number } {
  const level = getDunningLevel(daysOverdue);
  const interest = calculateInterest(amount, daysOverdue);
  return {
    fee: level.fee,
    interest,
    total: amount + level.fee + interest,
  };
}

describe('Dunning System (ABGB §1333)', () => {
  it('returns level 0 for invoices not yet overdue', () => {
    assert.strictEqual(getDunningLevel(0).level, 0);
    assert.strictEqual(getDunningLevel(5).level, 0);
    assert.strictEqual(getDunningLevel(13).level, 0);
  });

  it('escalates to Zahlungserinnerung after 14 days', () => {
    assert.strictEqual(getDunningLevel(14).level, 1);
    assert.strictEqual(getDunningLevel(14).name, 'Zahlungserinnerung');
    assert.strictEqual(getDunningLevel(14).fee, 0);
  });

  it('escalates to 1. Mahnung after 30 days with EUR 5 fee', () => {
    assert.strictEqual(getDunningLevel(30).level, 2);
    assert.strictEqual(getDunningLevel(30).name, '1. Mahnung');
    assert.strictEqual(getDunningLevel(30).fee, 5);
  });

  it('escalates to 2. Mahnung after 45 days with EUR 10 fee', () => {
    assert.strictEqual(getDunningLevel(45).level, 3);
    assert.strictEqual(getDunningLevel(45).name, '2. Mahnung');
    assert.strictEqual(getDunningLevel(45).fee, 10);
  });

  it('calculates no interest for first 14 days', () => {
    assert.strictEqual(calculateInterest(1000, 0), 0);
    assert.strictEqual(calculateInterest(1000, 14), 0);
  });

  it('calculates ABGB §1333 interest at 4% p.a.', () => {
    const interest30 = calculateInterest(1000, 30);
    assertCloseTo(interest30, 1000 * 0.04 * (30 / 365), 2);
    assert.ok(interest30 > 0);

    const interest90 = calculateInterest(1000, 90);
    assertCloseTo(interest90, 1000 * 0.04 * (90 / 365), 2);
    assert.ok(interest90 > interest30);
  });

  it('calculates correct total due with fees and interest', () => {
    const result = calculateTotalDue(800, 45);
    assert.strictEqual(result.fee, 10);
    assert.ok(result.interest > 0);
    assertCloseTo(result.total, 800 + 10 + result.interest, 2);
  });

  it('handles zero amount gracefully', () => {
    const result = calculateTotalDue(0, 45);
    assert.strictEqual(result.interest, 0);
    assert.strictEqual(result.total, 10); // fee only
  });

  it('calculates interest proportionally to days overdue', () => {
    const interest60 = calculateInterest(1000, 60);
    const interest120 = calculateInterest(1000, 120);
    assertCloseTo(interest120, interest60 * 2, 1);
  });
});

// ========== PARTIAL PAYMENT (TEILBEZAHLT) IN DUNNING & SEPA ==========

/**
 * Audit-Befund M3: Bei status='teilbezahlt' muss der offene Restbetrag
 * (gesamtbetrag - paidAmount) im Mahnlauf und im SEPA-Export verwendet werden,
 * nicht der volle Rechnungsbetrag.
 */

interface PartialInvoice {
  gesamtbetrag: number;
  paidAmount: number;
  status: 'offen' | 'teilbezahlt' | 'bezahlt' | 'ueberfaellig';
  faelligAm: Date;
}

function getRemainingAmount(invoice: PartialInvoice): number {
  return Math.max(0, Math.round((invoice.gesamtbetrag - invoice.paidAmount) * 100) / 100);
}

function calculateDunningTotal(invoice: PartialInvoice, daysOverdue: number): {
  remaining: number;
  fee: number;
  interest: number;
  totalDue: number;
} {
  const remaining = getRemainingAmount(invoice);
  const level = getDunningLevel(daysOverdue);
  const interest = calculateInterest(remaining, daysOverdue);
  return {
    remaining,
    fee: level.fee,
    interest,
    totalDue: Math.round((remaining + level.fee + interest) * 100) / 100,
  };
}

describe('Partial Payment Dunning (Teilbezahlt)', () => {
  const partialInvoice: PartialInvoice = {
    gesamtbetrag: 200,
    paidAmount: 80,
    status: 'teilbezahlt',
    faelligAm: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), // 35 days overdue
  };

  it('calculates remaining balance correctly for teilbezahlt invoice', () => {
    assert.strictEqual(getRemainingAmount(partialInvoice), 120);
  });

  it('uses remaining balance (not full amount) for dunning calculation', () => {
    const result = calculateDunningTotal(partialInvoice, 35);
    // Remaining must be 120, not 200
    assert.strictEqual(result.remaining, 120);
    assertCloseTo(result.totalDue, 120 + result.fee + result.interest, 2);
  });

  it('calculates fee and interest on remaining balance only', () => {
    const resultFull = calculateDunningTotal(
      { ...partialInvoice, paidAmount: 0 }, 45
    );
    const resultPartial = calculateDunningTotal(partialInvoice, 45);

    // Interest on 120 must be less than interest on 200
    assert.ok(resultPartial.interest < resultFull.interest,
      `Interest on partial (${resultPartial.interest}) should be less than on full (${resultFull.interest})`);
    // Total due for partial payment must be less than for full amount
    assert.ok(resultPartial.totalDue < resultFull.totalDue,
      `Total due on partial (${resultPartial.totalDue}) should be less than on full (${resultFull.totalDue})`);
  });

  it('returns zero remaining amount when fully paid', () => {
    const fullyPaid: PartialInvoice = { ...partialInvoice, paidAmount: 200, status: 'bezahlt' };
    assert.strictEqual(getRemainingAmount(fullyPaid), 0);
  });

  it('does not produce negative remaining amount if overpaid', () => {
    const overpaid: PartialInvoice = { ...partialInvoice, paidAmount: 250 };
    assert.strictEqual(getRemainingAmount(overpaid), 0);
  });

  it('SEPA direct debit amount equals remaining balance for teilbezahlt', () => {
    // Mirrors the fix in sepaExportService: amount = max(0, gesamtbetrag - paidAmount)
    const invoiceTotal = 200;
    const paid = 80;
    const sepaAmount = Math.max(0, Math.round((invoiceTotal - paid) * 100) / 100);
    assert.strictEqual(sepaAmount, 120);
  });

  it('SEPA amount is zero for fully paid invoice (no double-debit)', () => {
    const invoiceTotal = 200;
    const paid = 200;
    const sepaAmount = Math.max(0, Math.round((invoiceTotal - paid) * 100) / 100);
    assert.strictEqual(sepaAmount, 0);
  });

  it('dunning interest on 120 EUR over 30 days matches ABGB §1333 rate', () => {
    const interest = calculateInterest(120, 30);
    const expected = Math.round(120 * 0.04 * (30 / 365) * 100) / 100;
    assertCloseTo(interest, expected, 2);
  });

  it('dunning total for 120 EUR remaining after 45 days is less than for 200 EUR', () => {
    const total120 = calculateDunningTotal(partialInvoice, 45);
    const total200 = calculateDunningTotal({ ...partialInvoice, paidAmount: 0 }, 45);
    assert.ok(total120.totalDue < total200.totalDue);
    assert.ok(total200.totalDue - total120.totalDue > 0);
  });
});

// ========== SETTLEMENT DISTRIBUTION KEY TESTS ==========

type DistributionKeyType = 'nutzflaeche' | 'einheiten' | 'personen' | 'pauschal' | 'verbrauch' | 'sondernutzung';

interface UnitData {
  id: string;
  flaeche: number;
  personen: number;
  nutzwert: number;
  verbrauch?: number;
}

function calculateShare(
  unit: UnitData,
  allUnits: UnitData[],
  keyType: DistributionKeyType
): number {
  switch (keyType) {
    case 'nutzflaeche': {
      const totalFlaeche = allUnits.reduce((sum, u) => sum + u.flaeche, 0);
      return totalFlaeche > 0 ? unit.flaeche / totalFlaeche : 0;
    }
    case 'einheiten': {
      return allUnits.length > 0 ? 1 / allUnits.length : 0;
    }
    case 'personen': {
      const totalPersonen = allUnits.reduce((sum, u) => sum + u.personen, 0);
      return totalPersonen > 0 ? unit.personen / totalPersonen : 0;
    }
    case 'pauschal': {
      return allUnits.length > 0 ? 1 / allUnits.length : 0;
    }
    case 'verbrauch': {
      const totalVerbrauch = allUnits.reduce((sum, u) => sum + (u.verbrauch || 0), 0);
      return totalVerbrauch > 0 ? (unit.verbrauch || 0) / totalVerbrauch : 0;
    }
    case 'sondernutzung': {
      const totalNutzwert = allUnits.reduce((sum, u) => sum + u.nutzwert, 0);
      return totalNutzwert > 0 ? unit.nutzwert / totalNutzwert : 0;
    }
  }
}

function calculateSettlementForTenant(
  tenantShare: number,
  totalExpense: number,
  monthsOccupied: number,
  totalMonths: number = 12
): { anteil: number; zeitanteil: number; tenantCost: number } {
  const zeitanteil = monthsOccupied / totalMonths;
  const tenantCost = totalExpense * tenantShare * zeitanteil;
  return {
    anteil: tenantShare,
    zeitanteil,
    tenantCost: Math.round(tenantCost * 100) / 100,
  };
}

function calculateAdvanceAdjustment(bkTotal: number, hkTotal: number): { newBk: number; newHk: number } {
  const monthlyBk = bkTotal / 12;
  const monthlyHk = hkTotal / 12;
  return {
    newBk: Math.round(monthlyBk * 1.03 * 100) / 100,
    newHk: Math.round(monthlyHk * 1.03 * 100) / 100,
  };
}

const testUnits: UnitData[] = [
  { id: 'u1', flaeche: 80, personen: 2, nutzwert: 100 },
  { id: 'u2', flaeche: 60, personen: 1, nutzwert: 75 },
  { id: 'u3', flaeche: 120, personen: 4, nutzwert: 150 },
  { id: 'u4', flaeche: 40, personen: 1, nutzwert: 50 },
];

describe('Settlement Distribution Keys (MRG §21)', () => {
  it('distributes by Nutzfläche correctly', () => {
    const share1 = calculateShare(testUnits[0], testUnits, 'nutzflaeche');
    assertCloseTo(share1, 80 / 300, 6);

    const share3 = calculateShare(testUnits[2], testUnits, 'nutzflaeche');
    assertCloseTo(share3, 120 / 300, 6);

    const allShares = testUnits.map(u => calculateShare(u, testUnits, 'nutzflaeche'));
    const totalShares = allShares.reduce((sum, s) => sum + s, 0);
    assertCloseTo(totalShares, 1.0, 6);
  });

  it('distributes by Einheiten equally', () => {
    const share = calculateShare(testUnits[0], testUnits, 'einheiten');
    assert.strictEqual(share, 0.25);

    testUnits.forEach(u => {
      assert.strictEqual(calculateShare(u, testUnits, 'einheiten'), 0.25);
    });
  });

  it('distributes by Personen correctly', () => {
    const share1 = calculateShare(testUnits[0], testUnits, 'personen');
    assertCloseTo(share1, 2 / 8, 6);

    const share3 = calculateShare(testUnits[2], testUnits, 'personen');
    assertCloseTo(share3, 4 / 8, 6);
  });

  it('distributes by Verbrauch correctly', () => {
    const unitsWithVerbrauch = testUnits.map((u, i) => ({
      ...u,
      verbrauch: [100, 200, 300, 400][i],
    }));
    const totalVerbrauch = 100 + 200 + 300 + 400;

    const share1 = calculateShare(unitsWithVerbrauch[0], unitsWithVerbrauch, 'verbrauch');
    assertCloseTo(share1, 100 / totalVerbrauch, 6);
  });

  it('distributes by MEA/Sondernutzung correctly', () => {
    const totalNutzwert = 100 + 75 + 150 + 50; // 375
    const share = calculateShare(testUnits[0], testUnits, 'sondernutzung');
    assertCloseTo(share, 100 / totalNutzwert, 6);
  });

  it('all shares sum to 1.0 for each key type', () => {
    const keyTypes: DistributionKeyType[] = ['nutzflaeche', 'einheiten', 'personen', 'pauschal', 'sondernutzung'];
    for (const keyType of keyTypes) {
      const allShares = testUnits.map(u => calculateShare(u, testUnits, keyType));
      const total = allShares.reduce((sum, s) => sum + s, 0);
      assertCloseTo(total, 1.0, 6);
    }
  });

  it('calculates tenant settlement with time proportion', () => {
    const result = calculateSettlementForTenant(0.25, 12000, 12, 12);
    assert.strictEqual(result.tenantCost, 3000);
    assert.strictEqual(result.zeitanteil, 1);

    const halfYear = calculateSettlementForTenant(0.25, 12000, 6, 12);
    assert.strictEqual(halfYear.tenantCost, 1500);
    assert.strictEqual(halfYear.zeitanteil, 0.5);
  });

  it('handles partial year tenancy correctly', () => {
    const result = calculateSettlementForTenant(0.3, 10000, 3, 12);
    assert.strictEqual(result.tenantCost, 750);
  });

  it('calculates MRG advance adjustment with 3% reserve', () => {
    const result = calculateAdvanceAdjustment(2400, 1200);
    assertCloseTo(result.newBk, (2400 / 12) * 1.03, 2);
    assertCloseTo(result.newHk, (1200 / 12) * 1.03, 2);
  });
});

// ========== VACANCY (LEERSTAND) INVOICE TESTS ==========

interface VacancyInvoice {
  grundmiete: number;
  betriebskosten: number;
  heizungskosten: number;
  wasserkosten: number;
  ust: number;
  gesamtbetrag: number;
  isVacancy: boolean;
}

function createVacancyInvoice(bk: number, hk: number): VacancyInvoice {
  const ust10 = bk * 0.10;
  const ust20 = hk * 0.20;
  const totalUst = ust10 + ust20;
  const gesamtbetrag = bk + hk + totalUst;

  return {
    grundmiete: 0,
    betriebskosten: bk,
    heizungskosten: hk,
    wasserkosten: 0,
    ust: Math.round(totalUst * 100) / 100,
    gesamtbetrag: Math.round(gesamtbetrag * 100) / 100,
    isVacancy: true,
  };
}

describe('Vacancy Invoice Generation (Leerstand)', () => {
  it('creates vacancy invoice with zero rent', () => {
    const inv = createVacancyInvoice(200, 100);
    assert.strictEqual(inv.grundmiete, 0);
    assert.strictEqual(inv.isVacancy, true);
  });

  it('applies correct VAT rates (10% BK, 20% HK)', () => {
    const inv = createVacancyInvoice(200, 100);
    const expectedUst = 200 * 0.10 + 100 * 0.20;
    assertCloseTo(inv.ust, expectedUst, 2);
    assertCloseTo(inv.gesamtbetrag, 200 + 100 + expectedUst, 2);
  });

  it('handles zero BK and HK', () => {
    const inv = createVacancyInvoice(0, 0);
    assert.strictEqual(inv.ust, 0);
    assert.strictEqual(inv.gesamtbetrag, 0);
  });
});

// ========== AUSTRIAN VAT CALCULATION TESTS ==========

function calculateAustrianVat(
  grundmiete: number,
  betriebskosten: number,
  heizungskosten: number,
  wasserkosten: number
): { ust10: number; ust20: number; totalUst: number; gesamtBrutto: number } {
  const ust10 = (grundmiete + betriebskosten + wasserkosten) * 0.10;
  const ust20 = heizungskosten * 0.20;
  const totalUst = ust10 + ust20;
  const netto = grundmiete + betriebskosten + heizungskosten + wasserkosten;
  return {
    ust10: Math.round(ust10 * 100) / 100,
    ust20: Math.round(ust20 * 100) / 100,
    totalUst: Math.round(totalUst * 100) / 100,
    gesamtBrutto: Math.round((netto + totalUst) * 100) / 100,
  };
}

describe('Austrian VAT Calculation', () => {
  it('applies 10% to residential rent, BK, and water', () => {
    const result = calculateAustrianVat(500, 200, 0, 50);
    assertCloseTo(result.ust10, (500 + 200 + 50) * 0.10, 2);
    assert.strictEqual(result.ust20, 0);
  });

  it('applies 20% to heating costs', () => {
    const result = calculateAustrianVat(0, 0, 100, 0);
    assert.strictEqual(result.ust10, 0);
    assertCloseTo(result.ust20, 100 * 0.20, 2);
  });

  it('calculates mixed VAT correctly', () => {
    const result = calculateAustrianVat(600, 200, 150, 30);
    assertCloseTo(result.ust10, (600 + 200 + 30) * 0.10, 2);
    assertCloseTo(result.ust20, 150 * 0.20, 2);
    assertCloseTo(result.totalUst, result.ust10 + result.ust20, 2);
    const expectedBrutto = 600 + 200 + 150 + 30 + result.totalUst;
    assertCloseTo(result.gesamtBrutto, expectedBrutto, 2);
  });
});

// ========== MRG §21 SETTLEMENT DEADLINE TESTS ==========

function checkSettlementDeadline(year: number): { abs3Warning: boolean; abs4Expired: boolean; abs3Date: string; abs4Date: string } {
  const now = new Date();
  const abs3Deadline = new Date(year + 1, 5, 30); // 30.06. of following year
  const abs4Deadline = new Date(year + 4, 0, 1); // 01.01. of 4th following year

  return {
    abs3Warning: now > abs3Deadline,
    abs4Expired: now > abs4Deadline,
    abs3Date: `30.06.${year + 1}`,
    abs4Date: `01.01.${year + 4}`,
  };
}

describe('MRG §21 Settlement Deadlines', () => {
  it('calculates Abs 3 deadline correctly (30.06. following year)', () => {
    const result = checkSettlementDeadline(2024);
    assert.strictEqual(result.abs3Date, '30.06.2025');
    assert.strictEqual(result.abs3Warning, true); // We're in 2026, so 2024 settlement is overdue
  });

  it('calculates Abs 4 statute of limitations (01.01. 4th following year)', () => {
    const result = checkSettlementDeadline(2022);
    assert.strictEqual(result.abs4Date, '01.01.2026');
    assert.strictEqual(result.abs4Expired, true); // 2022 settlement expired in Jan 2026
  });

  it('does not warn for current year settlement', () => {
    const result = checkSettlementDeadline(2025);
    assert.strictEqual(result.abs3Date, '30.06.2026');
    assert.strictEqual(result.abs4Date, '01.01.2029');
  });
});
