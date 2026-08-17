import { db } from "../db";
import { monthlyInvoices, payments, expenses, tenants, units, properties, bankAccounts } from "@shared/schema";
import { eq, and, gte, lte, inArray, isNull } from "drizzle-orm";
import { format } from "date-fns";
import { toCents, type Cents } from "../lib/money";

/** Integer-Cents als DATEV/BMD-Betragsfeld formatieren: 123456 → "1234,56" */
function centsToExportField(cents: Cents): string {
  const neg = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${neg}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

interface DatevBooking {
  /** Betrag in Integer-Cents (dezimalsicher) */
  umsatzCents: Cents;
  sollHaben: 'S' | 'H';
  kontoSoll: string;
  kontoHaben: string;
  belegDatum: string;
  belegfeld1: string;
  belegfeld2?: string;
  buchungstext: string;
  kostenstelle1?: string;
  kostenstelle2?: string;
}

interface BmdBooking {
  buchungsdatum: string;
  belegNr: string;
  kontoNr: string;
  gegenkontoNr: string;
  /** Betrag in Integer-Cents (dezimalsicher) */
  betragCents: Cents;
  mwstCode: string;
  buchungstext: string;
  belegnummer: string;
  kostenstelle?: string;
}

export class BmdDatevExportService {
  private readonly KONTEN = {
    BANK: '2800',
    KASSE: '2700',
    MIETEINNAHMEN_WOHNEN: '4100',
    MIETEINNAHMEN_GEWERBE: '4110',
    BETRIEBSKOSTEN_EINNAHMEN: '4200',
    HEIZKOSTEN_EINNAHMEN: '4210',
    FORDERUNGEN_MIETER: '1400',
    INSTANDHALTUNG: '4260',
    VERWALTUNGSKOSTEN: '4300',
    VERSICHERUNG: '4360',
    STEUERN_ABGABEN: '4390',
    SONSTIGE_KOSTEN: '4900',
  };

  private readonly MWST_CODES = {
    '10': 'V10',
    '20': 'V20',
    '0': 'V00',
  };

  async generateDatevExport(
    organizationId: string,
    startDate: Date,
    endDate: Date
  ): Promise<string> {
    const bookings = await this.collectBookings(organizationId, startDate, endDate);
    
    const lines: string[] = [];
    
    lines.push('"EXTF";700;21;"Buchungsstapel";7;' + format(new Date(), 'yyyyMMddHHmmss') + ';;"";"";"";0');
    lines.push('"EXTF";700;16;"Debitoren/Kreditoren";1;' + format(new Date(), 'yyyyMMddHHmmss'));
    
    for (const booking of bookings) {
      lines.push(this.formatDatevLine(booking));
    }
    
    return lines.join('\r\n');
  }

  async generateBmdExport(
    organizationId: string,
    startDate: Date,
    endDate: Date
  ): Promise<string> {
    const bookings = await this.collectBmdBookings(organizationId, startDate, endDate);
    
    const lines: string[] = [];
    
    lines.push('Buchungsdatum;BelegNr;KontoNr;GegenkontoNr;Betrag;MwStCode;Buchungstext;Belegnummer;Kostenstelle');
    
    for (const booking of bookings) {
      lines.push([
        booking.buchungsdatum,
        booking.belegNr,
        booking.kontoNr,
        booking.gegenkontoNr,
        centsToExportField(booking.betragCents),
        booking.mwstCode,
        `"${booking.buchungstext}"`,
        booking.belegnummer,
        booking.kostenstelle || '',
      ].join(';'));
    }
    
    return lines.join('\r\n');
  }

  private formatDatevLine(booking: DatevBooking): string {
    return [
      centsToExportField(booking.umsatzCents),
      booking.sollHaben,
      booking.kontoSoll,
      booking.kontoHaben,
      '',
      booking.belegDatum,
      booking.belegfeld1,
      booking.belegfeld2 || '',
      `"${booking.buchungstext}"`,
      '',
      '',
      '',
      booking.kostenstelle1 || '',
      booking.kostenstelle2 || '',
    ].join(';');
  }

  private async collectBookings(
    organizationId: string,
    startDate: Date,
    endDate: Date
  ): Promise<DatevBooking[]> {
    const bookings: DatevBooking[] = [];

    const paymentsData = await db.select({
      payment: payments,
      tenant: tenants,
      unit: units,
      property: properties,
    })
      .from(payments)
      .innerJoin(tenants, eq(payments.tenantId, tenants.id))
      .innerJoin(units, eq(tenants.unitId, units.id))
      .innerJoin(properties, eq(units.propertyId, properties.id))
      .where(and(
        eq(properties.organizationId, organizationId),
        gte(payments.datum, startDate.toISOString()),
        lte(payments.datum, endDate.toISOString())
      ));

    for (const row of paymentsData) {
      const amountCents = toCents(row.payment.betrag ?? "0");
      const tenantNr = row.tenant.id.substring(0, 8);
      
      bookings.push({
        umsatzCents: amountCents,
        sollHaben: 'S',
        kontoSoll: this.KONTEN.BANK,
        kontoHaben: this.KONTEN.FORDERUNGEN_MIETER,
        belegDatum: format(new Date(row.payment.datum!), 'ddMM'),
        belegfeld1: `Z-${tenantNr}`,
        belegfeld2: row.payment.zahlungsreferenz || '',
        buchungstext: `Miete ${row.tenant.vorname} ${row.tenant.nachname}`,
        kostenstelle1: row.property.id.substring(0, 8),
      });
    }

    const expensesData = await db.select({
      expense: expenses,
      property: properties,
    })
      .from(expenses)
      .innerJoin(properties, eq(expenses.propertyId, properties.id))
      .where(and(
        eq(properties.organizationId, organizationId),
        gte(expenses.datum, startDate.toISOString()),
        lte(expenses.datum, endDate.toISOString())
      ));

    for (const row of expensesData) {
      const amountCents = toCents(row.expense.betrag ?? "0");
      const konto = this.getExpenseAccount(row.expense.category);
      
      bookings.push({
        umsatzCents: amountCents,
        sollHaben: 'S',
        kontoSoll: konto,
        kontoHaben: this.KONTEN.BANK,
        belegDatum: format(new Date(row.expense.datum!), 'ddMM'),
        belegfeld1: `A-${row.expense.id.substring(0, 8)}`,
        belegfeld2: row.expense.belegnummer || '',
        buchungstext: row.expense.description || row.expense.category || 'Ausgabe',
        kostenstelle1: row.property.id.substring(0, 8),
      });
    }

    return bookings;
  }

  private async collectBmdBookings(
    organizationId: string,
    startDate: Date,
    endDate: Date
  ): Promise<BmdBooking[]> {
    const bookings: BmdBooking[] = [];

    const paymentsData = await db.select({
      payment: payments,
      tenant: tenants,
      unit: units,
      property: properties,
    })
      .from(payments)
      .innerJoin(tenants, eq(payments.tenantId, tenants.id))
      .innerJoin(units, eq(tenants.unitId, units.id))
      .innerJoin(properties, eq(units.propertyId, properties.id))
      .where(and(
        eq(properties.organizationId, organizationId),
        gte(payments.datum, startDate.toISOString()),
        lte(payments.datum, endDate.toISOString())
      ));

    for (const row of paymentsData) {
      const amountCents = toCents(row.payment.betrag ?? "0");
      
      bookings.push({
        buchungsdatum: format(new Date(row.payment.datum!), 'dd.MM.yyyy'),
        belegNr: row.payment.zahlungsreferenz || `Z${row.payment.id.substring(0, 6)}`,
        kontoNr: this.KONTEN.BANK,
        gegenkontoNr: this.KONTEN.FORDERUNGEN_MIETER,
        betragCents: amountCents,
        mwstCode: 'V00',
        buchungstext: `Miete ${row.tenant.vorname} ${row.tenant.nachname}`,
        belegnummer: row.payment.id.substring(0, 10),
        kostenstelle: row.property.id.substring(0, 8),
      });
    }

    const expensesData = await db.select({
      expense: expenses,
      property: properties,
    })
      .from(expenses)
      .innerJoin(properties, eq(expenses.propertyId, properties.id))
      .where(and(
        eq(properties.organizationId, organizationId),
        gte(expenses.datum, startDate.toISOString()),
        lte(expenses.datum, endDate.toISOString())
      ));

    for (const row of expensesData) {
      const amountCents = toCents(row.expense.betrag ?? "0");
      const mwstRate = row.expense.mwstSatz || '20';
      
      bookings.push({
        buchungsdatum: format(new Date(row.expense.datum!), 'dd.MM.yyyy'),
        belegNr: row.expense.belegnummer || `A${row.expense.id.substring(0, 6)}`,
        kontoNr: this.getExpenseAccount(row.expense.category),
        gegenkontoNr: this.KONTEN.BANK,
        betragCents: amountCents,
        mwstCode: this.MWST_CODES[mwstRate as keyof typeof this.MWST_CODES] || 'V20',
        buchungstext: row.expense.description || row.expense.category || 'Ausgabe',
        belegnummer: row.expense.id.substring(0, 10),
        kostenstelle: row.property.id.substring(0, 8),
      });
    }

    return bookings;
  }

  private getExpenseAccount(category: string | null): string {
    const categoryLower = (category || '').toLowerCase();
    
    if (categoryLower.includes('reparatur') || categoryLower.includes('instandhaltung')) {
      return this.KONTEN.INSTANDHALTUNG;
    }
    if (categoryLower.includes('verwaltung')) {
      return this.KONTEN.VERWALTUNGSKOSTEN;
    }
    if (categoryLower.includes('versicherung')) {
      return this.KONTEN.VERSICHERUNG;
    }
    if (categoryLower.includes('steuer') || categoryLower.includes('abgabe')) {
      return this.KONTEN.STEUERN_ABGABEN;
    }
    
    return this.KONTEN.SONSTIGE_KOSTEN;
  }

  getExportFormats(): Array<{ value: string; label: string; description: string }> {
    return [
      { value: 'datev', label: 'DATEV', description: 'DATEV-kompatibles ASCII-Format' },
      { value: 'bmd', label: 'BMD', description: 'BMD NTCS CSV-Format' },
    ];
  }
}

export const bmdDatevExportService = new BmdDatevExportService();
