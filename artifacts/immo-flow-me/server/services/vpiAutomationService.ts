import { db } from "../db";
import { tenants, units, properties, vpiAdjustments, rentHistory, vpiValues } from "@shared/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { format, addMonths } from "date-fns";
import { de } from "date-fns/locale";
import { sendEmail } from "../lib/resend";

interface VpiData {
  year: number;
  month: number;
  value: number;
}

interface VpiAdjustmentResult {
  tenantId: string;
  tenantName: string;
  propertyName: string;
  unitNumber: string;
  currentRent: number;
  newRent: number;
  percentageIncrease: number;
  baseVpi: number;
  currentVpi: number;
  effectiveDate: string;
  schwellenwert: number;
}

// Globaler Fallback-Schwellenwert (5 %)
export const SCHWELLENWERT = 0.05;

// ─── Reine Berechnungshelfer — exportiert für Unit-Tests ──────────────────────

/**
 * Berechnet den prozentualen VPI-Anstieg gegenüber dem Basiswert.
 * Gibt 0 zurück wenn baseVpi ≤ 0 (Schutz vor Division durch 0).
 */
export function computeVpiPercentage(currentVpi: number, baseVpi: number): number {
  if (baseVpi <= 0) return 0;
  return (currentVpi - baseVpi) / baseVpi;
}

/**
 * Prüft ob der prozentuale Anstieg den Schwellenwert erreicht oder überschreitet.
 * Verwendet den globalen SCHWELLENWERT wenn kein individueller angegeben.
 */
export function meetsSchwellenwert(
  percentageIncrease: number,
  schwellenwert: number = SCHWELLENWERT,
): boolean {
  return percentageIncrease >= schwellenwert;
}

/**
 * MietWuG / MRG Deckelung und Hälfteregelung (§16 Abs.6 MRG).
 *
 * Richtwertmieten  → voller VPI-Anstieg (keine Kappung durch diese Funktion)
 * Kategoriemieten  → Hälfteregelung: nur 50 % des Anstiegs darf weitergewälzt werden
 * Freie Mieten     → vertragliche Regelung gilt; wir wenden keinen gesetzlichen Cap an
 * null / unbekannt → vorsichtshalber kein Cap (Verwalter entscheidet manuell)
 *
 * Gibt den effektiv anzuwendenden prozentualen Anstieg zurück.
 */
export function applyMietWuGCap(
  percentageIncrease: number,
  mietrechtTyp: string | null | undefined,
): number {
  if (mietrechtTyp === 'kategorie') {
    // §16 Abs.6 MRG: Bei Kategoriemieten gilt die Hälfteregelung.
    return percentageIncrease / 2;
  }
  // 'richtwert', 'frei', null → kein gesetzlicher Cap durch diese Funktion.
  return percentageIncrease;
}

// Default-VPI-Basis wenn kein Wert im Tenant-Datensatz hinterlegt ist
const DEFAULT_VPI_BASE = 100;

export class VpiAutomationService {
  /**
   * Liest den aktuellen VPI aus der Datenbank.
   * Wirft einen expliziten Fehler wenn die Tabelle leer ist.
   */
  async getCurrentVpi(): Promise<VpiData> {
    const latest = await db.select()
      .from(vpiValues)
      .orderBy(desc(vpiValues.year), desc(vpiValues.month))
      .limit(1);

    if (latest.length > 0 && latest[0]) {
      return {
        year: latest[0].year,
        month: latest[0].month,
        value: Number(latest[0].value),
      };
    }

    throw new Error(
      'VPI-Tabelle ist leer – bitte aktuellen VPI von Statistik Austria einpflegen'
    );
  }

  /**
   * Schwellenwert vertragsindividuell; korrekte Schema-Felder.
   */
  async checkVpiAdjustments(organizationId: string): Promise<VpiAdjustmentResult[]> {
    const currentVpi = await this.getCurrentVpi();

    const activeTenants = await db.select({
      tenant: tenants,
      unit: units,
      property: properties,
    })
      .from(tenants)
      .innerJoin(units, eq(tenants.unitId, units.id))
      .innerJoin(properties, eq(units.propertyId, properties.id))
      .where(and(
        eq(properties.organizationId, organizationId),
        isNull(tenants.deletedAt),
        eq(tenants.status, 'aktiv')
      ));

    const adjustments: VpiAdjustmentResult[] = [];

    for (const row of activeTenants) {
      const baseVpi = Number(row.tenant.vpiBase) || DEFAULT_VPI_BASE;
      const lastAdjustmentDate = row.tenant.lastVpiAdjustment
        ? new Date(row.tenant.lastVpiAdjustment)
        : null;

      const tenantSchwellenwert = row.tenant.vpiSchwellenwert != null
        ? Number(row.tenant.vpiSchwellenwert)
        : SCHWELLENWERT;

      const rawPercentageIncrease = (currentVpi.value - baseVpi) / baseVpi;

      // Audit-Befund V1: MietWuG Deckelung / Hälfteregelung anwenden.
      // Kategoriemieten (§16 Abs.6 MRG) dürfen nur 50 % des VPI-Anstiegs
      // weitergegeben werden. Der Mietrechttyp kommt vom Objekt (property.mietrechtTyp).
      const mietrechtTyp = (row.property as any).mietrechtTyp as string | null | undefined;
      const effectivePercentage = applyMietWuGCap(rawPercentageIncrease, mietrechtTyp);

      if (effectivePercentage >= tenantSchwellenwert) {
        const currentRent = Number(row.tenant.grundmiete) || 0;
        const newRent = Math.round(currentRent * (1 + effectivePercentage) * 100) / 100;

        if (!lastAdjustmentDate || lastAdjustmentDate < new Date(currentVpi.year, currentVpi.month - 1, 1)) {
          adjustments.push({
            tenantId: row.tenant.id,
            tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`.trim(),
            propertyName: row.property.name || '',
            unitNumber: row.unit.topNummer || '',
            currentRent,
            newRent,
            percentageIncrease: effectivePercentage,
            baseVpi,
            currentVpi: currentVpi.value,
            effectiveDate: format(addMonths(new Date(), 1), 'yyyy-MM-01'),
            schwellenwert: tenantSchwellenwert,
          });
        }
      }
    }

    return adjustments;
  }

  async generateVpiNotificationLetter(adjustment: VpiAdjustmentResult): Promise<string> {
    const effectiveDate = format(new Date(adjustment.effectiveDate), 'dd.MM.yyyy', { locale: de });

    return `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px;">
        <h2>Mitteilung über Mietanpassung gemäß Verbraucherpreisindex</h2>
        
        <p>Sehr geehrte(r) ${adjustment.tenantName},</p>
        
        <p>gemäß den Bestimmungen Ihres Mietvertrages teilen wir Ihnen mit, dass aufgrund der 
        Entwicklung des Verbraucherpreisindex (VPI) eine Anpassung Ihrer Miete erfolgt.</p>
        
        <h3>Details der Anpassung:</h3>
        <table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;">Objekt:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${adjustment.propertyName} - ${adjustment.unitNumber}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;">Basis-VPI:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${adjustment.baseVpi}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;">Aktueller VPI:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${adjustment.currentVpi}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;">Veränderung:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${(adjustment.percentageIncrease * 100).toFixed(2)}%</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;">Schwellenwert:</td>
            ..<td style="padding: 8px; border: 1px solid #ddd;">${(adjustment.schwellenwert * 100).toFixed(2)}%</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;">Bisherige Miete:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${adjustment.currentRent.toFixed(2)} €</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Neue Miete:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>${adjustment.newRent.toFixed(2)} €</strong></td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;">Gültig ab:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${effectiveDate}</td>
          </tr>
        </table>
        
        <p>Die Anpassung erfolgt auf Grundlage des von der Statistik Austria veröffentlichten 
        Verbraucherpreisindex.</p>
        
        <p>Bei Fragen stehen wir Ihnen gerne zur Verfügung.</p>
        
        <p>Mit freundlichen Grüßen,<br>
        Ihre Hausverwaltung</p>
      </div>
    `;
  }
}

export const vpiAutomationService = new VpiAutomationService();
