import { db } from "../db";
import { monthlyInvoices, payments, expenses, properties, tenants, units } from "@shared/schema";
import { eq, and, gte, lte, inArray, sum } from "drizzle-orm";
import { format, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter } from "date-fns";
import { toCents, fromCents, ustFromGrossCents, type Cents } from "../lib/money";

interface UstVoranmeldung {
  zeitraum: string;
  kennzahlen: {
    kz000: number;
    kz001: number;
    kz011: number;
    kz017: number;
    kz019: number;
    kz022: number;
    kz029: number;
    kz060: number;
    kz061: number;
    kz065: number;
    kz066: number;
    kz070: number;
    kz083: number;
  };
  berechnung: {
    umsatzsteuer20: number;
    umsatzsteuer10: number;
    vorsteuer: number;
    zahllast: number;
  };
}

interface UstZusammenfassung {
  einnahmen: {
    mieteinnahmenWohnen: number;
    mieteinnahmenGewerbe: number;
    betriebskostenWohnen: number;
    betriebskostenGewerbe: number;
    heizkostenWohnen: number;
    heizkostenGewerbe: number;
  };
  umsatzsteuer: {
    ust10: number;
    ust20: number;
    gesamt: number;
  };
  vorsteuer: {
    ausRechnungen: number;
    gesamt: number;
  };
  zahllast: number;
}

export class FinanzOnlineService {
  async generateUstVoranmeldung(
    organizationId: string,
    year: number,
    period: 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'M01' | 'M02' | 'M03' | 'M04' | 'M05' | 'M06' | 'M07' | 'M08' | 'M09' | 'M10' | 'M11' | 'M12'
  ): Promise<UstVoranmeldung> {
    const { startDate, endDate } = this.getPeriodDates(year, period);
    const summary = await this.calculateUstSummary(organizationId, startDate, endDate);

    const zeitraum = period.startsWith('Q') 
      ? `${period}/${year}` 
      : `${period.substring(1)}/${year}`;

    return {
      zeitraum,
      kennzahlen: {
        kz000: Math.round(summary.einnahmen.mieteinnahmenWohnen + summary.einnahmen.betriebskostenWohnen + summary.einnahmen.heizkostenWohnen),
        kz001: Math.round(summary.einnahmen.mieteinnahmenGewerbe + summary.einnahmen.betriebskostenGewerbe + summary.einnahmen.heizkostenGewerbe),
        kz011: 0,
        kz017: 0,
        kz019: 0,
        kz022: Math.round(summary.umsatzsteuer.ust20),
        kz029: Math.round(summary.umsatzsteuer.ust10),
        kz060: Math.round(summary.vorsteuer.ausRechnungen),
        kz061: 0,
        kz065: 0,
        kz066: 0,
        kz070: Math.round(summary.zahllast),
        kz083: summary.zahllast < 0 ? Math.abs(Math.round(summary.zahllast)) : 0,
      },
      berechnung: {
        umsatzsteuer20: summary.umsatzsteuer.ust20,
        umsatzsteuer10: summary.umsatzsteuer.ust10,
        vorsteuer: summary.vorsteuer.gesamt,
        zahllast: summary.zahllast,
      },
    };
  }

  async calculateUstSummary(
    organizationId: string,
    startDate: Date,
    endDate: Date
  ): Promise<UstZusammenfassung> {
    const orgProperties = await db.select().from(properties)
      .where(eq(properties.organizationId, organizationId));
    const propertyIds = orgProperties.map(p => p.id);

    let einnahmen = {
      mieteinnahmenWohnen: 0,
      mieteinnahmenGewerbe: 0,
      betriebskostenWohnen: 0,
      betriebskostenGewerbe: 0,
      heizkostenWohnen: 0,
      heizkostenGewerbe: 0,
    };

    if (propertyIds.length > 0) {
      const allUnits = await db.select().from(units)
        .where(inArray(units.propertyId, propertyIds));
      const unitIds = allUnits.map(u => u.id);

      if (unitIds.length > 0) {
        const allTenants = await db.select().from(tenants)
          .where(inArray(tenants.unitId, unitIds));
        const tenantIds = allTenants.map(t => t.id);

        if (tenantIds.length > 0) {
          const invoicesData = await db.select({
            invoice: monthlyInvoices,
            tenant: tenants,
            unit: units,
          })
            .from(monthlyInvoices)
            .innerJoin(tenants, eq(monthlyInvoices.tenantId, tenants.id))
            .innerJoin(units, eq(tenants.unitId, units.id))
            .where(and(
              inArray(monthlyInvoices.tenantId, tenantIds),
              gte(monthlyInvoices.createdAt, startDate),
              lte(monthlyInvoices.createdAt, endDate)
            ));

          for (const row of invoicesData) {
            const isWohnen = row.unit.nutzungsart === 'wohnung';
            // Cent-Integer statt Float: DB-Decimal-Strings exakt einlesen
            const grundmiete = toCents(row.invoice.grundmiete ?? "0");
            const bk = toCents(row.invoice.betriebskosten ?? "0");
            const heiz = toCents(row.invoice.heizungskosten ?? "0");

            if (isWohnen) {
              einnahmen.mieteinnahmenWohnen += grundmiete;
              einnahmen.betriebskostenWohnen += bk;
              einnahmen.heizkostenWohnen += heiz;
            } else {
              einnahmen.mieteinnahmenGewerbe += grundmiete;
              einnahmen.betriebskostenGewerbe += bk;
              einnahmen.heizkostenGewerbe += heiz;
            }
          }
        }
      }
    }

    // Alle USt-Berechnungen in Integer-Cents mit kaufmännischer Rundung
    const ust10BasisCents = einnahmen.mieteinnahmenWohnen + einnahmen.betriebskostenWohnen;
    const ust20BasisCents = einnahmen.mieteinnahmenGewerbe + einnahmen.betriebskostenGewerbe +
                            einnahmen.heizkostenWohnen + einnahmen.heizkostenGewerbe;

    // USt aus Brutto herausrechnen: brutto * satz / (100 + satz)
    const ust10Cents = ustFromGrossCents(ust10BasisCents, 10);
    const ust20Cents = ustFromGrossCents(ust20BasisCents, 20);

    let vorsteuerCents: Cents = 0;
    if (propertyIds.length > 0) {
      const expensesData = await db.select().from(expenses)
        .where(and(
          inArray(expenses.propertyId, propertyIds),
          gte(expenses.datum, startDate.toISOString()),
          lte(expenses.datum, endDate.toISOString())
        ));

      for (const exp of expensesData) {
        const betragCents = toCents(exp.betrag ?? "0");
        const mwstSatz = Number(exp.mwstSatz) || 20;
        vorsteuerCents += ustFromGrossCents(betragCents, mwstSatz);
      }
    }

    const zahllastCents = ust10Cents + ust20Cents - vorsteuerCents;

    return {
      einnahmen: {
        mieteinnahmenWohnen: fromCents(einnahmen.mieteinnahmenWohnen),
        mieteinnahmenGewerbe: fromCents(einnahmen.mieteinnahmenGewerbe),
        betriebskostenWohnen: fromCents(einnahmen.betriebskostenWohnen),
        betriebskostenGewerbe: fromCents(einnahmen.betriebskostenGewerbe),
        heizkostenWohnen: fromCents(einnahmen.heizkostenWohnen),
        heizkostenGewerbe: fromCents(einnahmen.heizkostenGewerbe),
      },
      umsatzsteuer: {
        ust10: fromCents(ust10Cents),
        ust20: fromCents(ust20Cents),
        gesamt: fromCents(ust10Cents + ust20Cents),
      },
      vorsteuer: {
        ausRechnungen: fromCents(vorsteuerCents),
        gesamt: fromCents(vorsteuerCents),
      },
      zahllast: fromCents(zahllastCents),
    };
  }

  private getPeriodDates(year: number, period: string): { startDate: Date; endDate: Date } {
    if (period.startsWith('Q')) {
      const quarter = parseInt(period.substring(1));
      const startMonth = (quarter - 1) * 3;
      return {
        startDate: startOfQuarter(new Date(year, startMonth, 1)),
        endDate: endOfQuarter(new Date(year, startMonth, 1)),
      };
    } else {
      const month = parseInt(period.substring(1)) - 1;
      return {
        startDate: startOfMonth(new Date(year, month, 1)),
        endDate: endOfMonth(new Date(year, month, 1)),
      };
    }
  }

  generateXml(voranmeldung: UstVoranmeldung): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<SteuroerklaerungUVA xmlns="http://www.bmf.gv.at/elda">
  <Zeitraum>${voranmeldung.zeitraum}</Zeitraum>
  <Kennzahlen>
    <KZ000>${voranmeldung.kennzahlen.kz000}</KZ000>
    <KZ001>${voranmeldung.kennzahlen.kz001}</KZ001>
    <KZ022>${voranmeldung.kennzahlen.kz022}</KZ022>
    <KZ029>${voranmeldung.kennzahlen.kz029}</KZ029>
    <KZ060>${voranmeldung.kennzahlen.kz060}</KZ060>
    <KZ070>${voranmeldung.kennzahlen.kz070}</KZ070>
    ${voranmeldung.kennzahlen.kz083 > 0 ? `<KZ083>${voranmeldung.kennzahlen.kz083}</KZ083>` : ''}
  </Kennzahlen>
</SteuroerklaerungUVA>`;
  }

  getAvailablePeriods(year: number): Array<{ value: string; label: string }> {
    const periods = [];
    
    for (let q = 1; q <= 4; q++) {
      periods.push({ value: `Q${q}`, label: `${q}. Quartal ${year}` });
    }
    
    const months = [
      'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
      'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
    ];
    for (let m = 1; m <= 12; m++) {
      periods.push({ value: `M${String(m).padStart(2, '0')}`, label: `${months[m-1]} ${year}` });
    }
    
    return periods;
  }
}

export const finanzOnlineService = new FinanzOnlineService();
