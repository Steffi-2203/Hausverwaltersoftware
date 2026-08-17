import { db } from "../db";
import { roundMoney } from "@shared/utils";
import {
  monthlyInvoices,
  invoiceLines,
  distributionKeys,
  unitDistributionValues,
  expenses,
  tenants,
  units
} from "@shared/schema";

/**
 * Invoice generator: deterministic functions to build invoice payloads and lines.
 * - All numeric values are numbers (not strings)
 * - All rounding done via roundMoney
 * - buildInvoiceData and buildInvoiceLines are pure/deterministic
 */

export type VatRates = {
  ustSatzMiete: number;
  ustSatzBk: number;
  ustSatzHeizung: number;
};

export type CarryForward = {
  vortragMiete: number;
  vortragBk: number;
  vortragHk: number;
  vortragSonstige: number;
  credit?: number;
};

export interface InvoiceData {
  tenantId: string;
  unitId: string | null;
  year: number;
  month: number;
  grundmiete: number;
  betriebskosten: number;
  heizungskosten: number;
  gesamtbetrag: number;
  ust: number;
  ustSatzMiete: number;
  ustSatzBk: number;
  ustSatzHeizung: number;
  status: "offen" | "teilbezahlt" | "bezahlt" | "ueberfaellig";
  faelligAm: string;
  vortragMiete: number;
  vortragBk: number;
  vortragHk: number;
  vortragSonstige: number;
  allocationDetail?: any;
  isVacancy?: boolean;
}

export class InvoiceGenerator {
  getVatRates(unitType: string): VatRates {
    const isCommercial = ['geschaeft', 'garage', 'stellplatz', 'lager'].includes((unitType || '').toLowerCase());
    return {
      ustSatzMiete: isCommercial ? 20 : 10,
      ustSatzBk: isCommercial ? 20 : 10,
      ustSatzHeizung: 20
    };
  }

  calculateVatFromGross(grossAmount: number, vatRate: number): number {
    if (!vatRate) return 0;
    return roundMoney(grossAmount - (grossAmount / (1 + vatRate / 100)));
  }

  buildInvoiceData(
    tenant: typeof tenants.$inferSelect,
    unitType: string,
    year: number,
    month: number,
    dueDate: string,
    carryForward: CarryForward
  ): InvoiceData {
    const vatRates = this.getVatRates(unitType);

    const grundmiete = roundMoney(Number(tenant.grundmiete) || 0);
    const betriebskosten = roundMoney(Number(tenant.betriebskostenVorschuss) || 0);
    const heizungskosten = roundMoney(Number(tenant.heizkostenVorschuss) || 0);

    const ustMiete = roundMoney(this.calculateVatFromGross(grundmiete, vatRates.ustSatzMiete));
    const ustBk = roundMoney(this.calculateVatFromGross(betriebskosten, vatRates.ustSatzBk));
    const ustHeizung = roundMoney(this.calculateVatFromGross(heizungskosten, vatRates.ustSatzHeizung));
    
    let sonstigeSum = 0;
    let ustSonstige = 0;
    const sonstigeKosten = tenant.sonstigeKosten as Record<string, { betrag: number; ust: number }> | null;
    if (sonstigeKosten && typeof sonstigeKosten === 'object') {
      for (const value of Object.values(sonstigeKosten)) {
        if (value && Number(value.betrag) > 0) {
          const betrag = roundMoney(Number(value.betrag));
          const ustRate = Number(value.ust) || 10;
          sonstigeSum += betrag;
          ustSonstige += roundMoney(this.calculateVatFromGross(betrag, ustRate));
        }
      }
    }
    
    const wasserkosten = roundMoney(Number(tenant.wasserkostenVorschuss) || 0);
    const ustWasser = roundMoney(this.calculateVatFromGross(wasserkosten, vatRates.ustSatzBk));
    const ust = roundMoney(ustMiete + ustBk + ustHeizung + ustWasser + ustSonstige);

    const vortragGesamt = roundMoney((carryForward.vortragMiete || 0) + (carryForward.vortragBk || 0) + (carryForward.vortragHk || 0) + (carryForward.vortragSonstige || 0));
    const gesamtbetrag = roundMoney(grundmiete + betriebskosten + heizungskosten + wasserkosten + sonstigeSum + vortragGesamt);

    return {
      tenantId: tenant.id,
      unitId: tenant.unitId,
      year,
      month,
      grundmiete,
      betriebskosten,
      heizungskosten,
      gesamtbetrag,
      ust,
      ustSatzMiete: vatRates.ustSatzMiete,
      ustSatzBk: vatRates.ustSatzBk,
      ustSatzHeizung: vatRates.ustSatzHeizung,
      status: "offen",
      faelligAm: dueDate,
      vortragMiete: roundMoney(carryForward.vortragMiete || 0),
      vortragBk: roundMoney(carryForward.vortragBk || 0),
      vortragHk: roundMoney(carryForward.vortragHk || 0),
      vortragSonstige: roundMoney(carryForward.vortragSonstige || 0)
    };
  }

  buildInvoiceLines(
    invoiceId: string,
    tenant: typeof tenants.$inferSelect,
    vatRates: VatRates,
    month: number,
    year: number,
    unitId?: string
  ): Array<{
    invoiceId: string;
    unitId?: string;
    lineType: string;
    description: string;
    amount: number;
    taxRate: number;
    meta?: Record<string, unknown>;
  }> {
    const lines: any[] = [];
    const monthName = ['Jänner','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'][month - 1];

    const grundmiete = roundMoney(Number(tenant.grundmiete) || 0);
    if (grundmiete > 0) {
      lines.push({
        invoiceId,
        unitId,
        lineType: 'grundmiete',
        description: `Nettomiete ${monthName} ${year}`,
        amount: grundmiete,
        taxRate: vatRates.ustSatzMiete,
        meta: { reference: 'MRG §15' }
      });
    }

    const bk = roundMoney(Number(tenant.betriebskostenVorschuss) || 0);
    if (bk > 0) {
      lines.push({
        invoiceId,
        unitId,
        lineType: 'betriebskosten',
        description: `BK-Vorschuss ${monthName} ${year}`,
        amount: bk,
        taxRate: vatRates.ustSatzBk,
        meta: { reference: 'MRG §21' }
      });
    }

    const hk = roundMoney(Number(tenant.heizkostenVorschuss) || 0);
    if (hk > 0) {
      lines.push({
        invoiceId,
        unitId,
        lineType: 'heizkosten',
        description: `HK-Vorschuss ${monthName} ${year}`,
        amount: hk,
        taxRate: vatRates.ustSatzHeizung,
        meta: { reference: 'HeizKG' }
      });
    }

    const wasser = roundMoney(Number(tenant.wasserkostenVorschuss) || 0);
    if (wasser > 0) {
      lines.push({
        invoiceId,
        unitId,
        lineType: 'wasserkosten',
        description: `Wasserkosten-Vorschuss ${monthName} ${year}`,
        amount: wasser,
        taxRate: 10,
        meta: { reference: 'MRG §21' }
      });
    }

    const sonstigeKosten = tenant.sonstigeKosten as Record<string, { betrag: number; ust: number; schluessel?: string }> | null;
    if (sonstigeKosten && typeof sonstigeKosten === 'object') {
      for (const [key, value] of Object.entries(sonstigeKosten)) {
        if (value && Number(value.betrag) > 0) {
          const betrag = roundMoney(Number(value.betrag));
          const ust = Number(value.ust) || 10;
          lines.push({
            invoiceId,
            unitId,
            lineType: 'sonstige',
            description: `${key} ${monthName} ${year}`,
            amount: betrag,
            taxRate: ust,
            meta: { reference: value.schluessel || 'Vereinbarung' }
          });
        }
      }
    }

    return lines;
  }
}

export const invoiceGenerator = new InvoiceGenerator();
