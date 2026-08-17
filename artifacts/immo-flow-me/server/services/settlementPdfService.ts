import { db } from "../db";
import { settlements, settlementDetails, tenants, units, properties, expenses, distributionKeys } from "@shared/schema";
import { eq, and, between, inArray } from "drizzle-orm";
import { format } from "date-fns";
import { de } from "date-fns/locale";

interface SettlementPdfData {
  property: {
    name: string;
    address: string;
    city: string;
    postalCode: string;
  };
  tenant: {
    name: string;
    address: string;
    unitNumber: string;
    qm: number;
  };
  period: {
    year: number;
    startDate: string;
    endDate: string;
  };
  expenses: Array<{
    category: string;
    description: string;
    totalAmount: number;
    tenantShare: number;
    distributionKey: string;
    percentage: number;
  }>;
  summary: {
    totalExpenses: number;
    tenantShare: number;
    prepayments: number;
    balance: number;
  };
  organization: {
    name: string;
    address: string;
    iban: string;
  };
}

export class SettlementPdfService {
  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('de-AT', { 
      style: 'currency', 
      currency: 'EUR' 
    }).format(amount);
  }

  private formatPercentage(value: number): string {
    return `${(value * 100).toFixed(2)}%`;
  }

  async getSettlementData(settlementId: string): Promise<SettlementPdfData | null> {
    const settlement = await db.select()
      .from(settlements)
      .where(eq(settlements.id, settlementId))
      .limit(1);

    if (!settlement[0]) return null;

    const details = await db.select({
      detail: settlementDetails,
      tenant: tenants,
      unit: units,
    })
      .from(settlementDetails)
      .innerJoin(tenants, eq(settlementDetails.tenantId, tenants.id))
      .innerJoin(units, eq(tenants.unitId, units.id))
      .where(eq(settlementDetails.settlementId, settlementId));

    const property = await db.select()
      .from(properties)
      .where(eq(properties.id, settlement[0].propertyId))
      .limit(1);

    if (!property[0] || details.length === 0) return null;

    const firstDetail = details[0];
    const expensesList = await db.select({
      expense: expenses,
      key: distributionKeys,
    })
      .from(expenses)
      .leftJoin(distributionKeys, eq(expenses.distributionKeyId, distributionKeys.id))
      .where(and(
        eq(expenses.propertyId, settlement[0].propertyId),
        eq(expenses.istUmlagefaehig, true),
        between(expenses.datum, 
          new Date(settlement[0].year, 0, 1).toISOString(),
          new Date(settlement[0].year, 11, 31).toISOString()
        )
      ));

    const totalUnitArea = Number(firstDetail.unit.flaeche) || 50;
    const allUnits = await db.select().from(units)
      .where(eq(units.propertyId, settlement[0].propertyId));
    const propertyTotalArea = allUnits.reduce((sum, u) => sum + (Number(u.flaeche) || 0), 0) || totalUnitArea;

    return {
      property: {
        name: property[0].name || '',
        address: property[0].strasse || '',
        city: property[0].ort || '',
        postalCode: property[0].plz || '',
      },
      tenant: {
        name: `${firstDetail.tenant.firstName || ''} ${firstDetail.tenant.lastName || ''}`.trim(),
        address: `${property[0].strasse}, ${property[0].plz} ${property[0].ort}`,
        unitNumber: firstDetail.unit.topNummer || '',
        qm: totalUnitArea,
      },
      period: {
        year: settlement[0].year,
        startDate: format(new Date(settlement[0].year, 0, 1), 'dd.MM.yyyy'),
        endDate: format(new Date(settlement[0].year, 11, 31), 'dd.MM.yyyy'),
      },
      expenses: expensesList.map(e => ({
        category: e.expense.category || 'Sonstige',
        description: e.expense.description || '',
        totalAmount: Number(e.expense.betrag) || 0,
        tenantShare: (Number(e.expense.betrag) || 0) * (totalUnitArea / propertyTotalArea),
        distributionKey: e.key?.name || 'Nutzfläche',
        percentage: totalUnitArea / propertyTotalArea,
      })),
      summary: {
        totalExpenses: Number(firstDetail.detail.ausgabenAnteil) || 0,
        tenantShare: Number(firstDetail.detail.ausgabenAnteil) || 0,
        prepayments: Number(firstDetail.detail.vorschuss) || 0,
        balance: Number(firstDetail.detail.differenz) || 0,
      },
      organization: {
        name: 'Hausverwaltung',
        address: `${property[0].strasse}, ${property[0].plz} ${property[0].ort}`,
        iban: '',
      },
    };
  }

  generateHtml(data: SettlementPdfData): string {
    const balanceText = data.summary.balance >= 0 
      ? `Guthaben zu Ihren Gunsten: ${this.formatCurrency(data.summary.balance)}`
      : `Nachzahlung: ${this.formatCurrency(Math.abs(data.summary.balance))}`;

    const balanceClass = data.summary.balance >= 0 ? 'text-green-600' : 'text-red-600';

    return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Betriebskostenabrechnung ${data.period.year}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 12px; line-height: 1.5; margin: 40px; }
    .header { margin-bottom: 30px; }
    .header h1 { font-size: 18px; margin: 0 0 5px 0; }
    .header p { margin: 2px 0; color: #666; }
    .address-block { margin: 20px 0; }
    .section { margin: 20px 0; }
    .section-title { font-size: 14px; font-weight: bold; margin-bottom: 10px; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f5f5f5; font-weight: bold; }
    .text-right { text-align: right; }
    .summary { background: #f9f9f9; padding: 15px; margin: 20px 0; }
    .summary-row { display: flex; justify-content: space-between; margin: 5px 0; }
    .summary-total { font-weight: bold; font-size: 14px; border-top: 2px solid #333; padding-top: 10px; margin-top: 10px; }
    .text-green-600 { color: #16a34a; }
    .text-red-600 { color: #dc2626; }
    .footer { margin-top: 40px; font-size: 10px; color: #666; border-top: 1px solid #ddd; padding-top: 20px; }
    .legal-text { font-size: 10px; color: #666; margin-top: 20px; }
    @media print { body { margin: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>Betriebskostenabrechnung ${data.period.year}</h1>
    <p>gemäß § 21 MRG (Mietrechtsgesetz)</p>
  </div>

  <div class="address-block">
    <p><strong>Objekt:</strong> ${data.property.name}</p>
    <p>${data.property.address}, ${data.property.postalCode} ${data.property.city}</p>
  </div>

  <div class="address-block">
    <p><strong>Mieter:</strong> ${data.tenant.name}</p>
    <p>Einheit: ${data.tenant.unitNumber} (${data.tenant.qm} m²)</p>
    <p>Abrechnungszeitraum: ${data.period.startDate} bis ${data.period.endDate}</p>
  </div>

  <div class="section">
    <div class="section-title">Betriebskostenaufstellung</div>
    <table>
      <thead>
        <tr>
          <th>Kategorie</th>
          <th>Beschreibung</th>
          <th>Verteilungsschlüssel</th>
          <th class="text-right">Gesamt</th>
          <th class="text-right">Ihr Anteil</th>
        </tr>
      </thead>
      <tbody>
        ${data.expenses.map(e => `
        <tr>
          <td>${e.category}</td>
          <td>${e.description}</td>
          <td>${e.distributionKey} (${this.formatPercentage(e.percentage)})</td>
          <td class="text-right">${this.formatCurrency(e.totalAmount)}</td>
          <td class="text-right">${this.formatCurrency(e.tenantShare)}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <div class="summary">
    <div class="section-title">Zusammenfassung</div>
    <div class="summary-row">
      <span>Summe Betriebskosten (Ihr Anteil):</span>
      <span>${this.formatCurrency(data.summary.tenantShare)}</span>
    </div>
    <div class="summary-row">
      <span>Geleistete Vorauszahlungen:</span>
      <span>- ${this.formatCurrency(data.summary.prepayments)}</span>
    </div>
    <div class="summary-row summary-total ${balanceClass}">
      <span>${data.summary.balance >= 0 ? 'Guthaben:' : 'Nachzahlung:'}</span>
      <span>${this.formatCurrency(Math.abs(data.summary.balance))}</span>
    </div>
  </div>

  <div class="legal-text">
    <p><strong>Hinweis gemäß § 21 Abs. 3 MRG:</strong></p>
    <p>Einwendungen gegen diese Abrechnung können innerhalb von 6 Monaten ab Zugang bei der Schlichtungsstelle oder dem zuständigen Bezirksgericht erhoben werden. Die Belege zu dieser Abrechnung können beim Vermieter eingesehen werden.</p>
  </div>

  ${data.summary.balance < 0 ? `
  <div class="section">
    <p><strong>Zahlungshinweis:</strong></p>
    <p>Bitte überweisen Sie den Nachzahlungsbetrag von ${this.formatCurrency(Math.abs(data.summary.balance))} innerhalb von 14 Tagen auf folgendes Konto:</p>
    <p>IBAN: ${data.organization.iban || '[IBAN einfügen]'}</p>
    <p>Verwendungszweck: BK-Abrechnung ${data.period.year} ${data.tenant.unitNumber}</p>
  </div>
  ` : `
  <div class="section">
    <p><strong>Gutschrift:</strong></p>
    <p>Ihr Guthaben von ${this.formatCurrency(data.summary.balance)} wird mit der nächsten Monatsmiete verrechnet.</p>
  </div>
  `}

  <div class="footer">
    <p>Erstellt am: ${format(new Date(), 'dd.MM.yyyy, HH:mm', { locale: de })} Uhr</p>
    <p>Diese Abrechnung wurde maschinell erstellt und ist ohne Unterschrift gültig.</p>
  </div>
</body>
</html>`;
  }
}

export const settlementPdfService = new SettlementPdfService();
