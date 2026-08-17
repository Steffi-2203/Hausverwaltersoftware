import { db } from "../db";
import { 
  organizations, 
  profiles, 
  properties, 
  units, 
  tenants, 
  expenses, 
  meters,
  meterReadings,
  monthlyInvoices 
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { encryptField } from "../lib/fieldEncryption";

const SEED_ORG_ID = "00000000-0000-0000-0000-000000000001";
const SEED_USER_ID = "00000000-0000-0000-0000-000000000002";
const SEED_PROPERTY_ID = "00000000-0000-0000-0000-000000000003";

interface SeedResult {
  success: boolean;
  message: string;
  created: {
    organization: boolean;
    property: boolean;
    units: number;
    tenants: number;
    expenses: number;
    meters: number;
    meterReadings: number;
    invoices: number;
  };
}

export async function seedMinimalDataset(): Promise<SeedResult> {
  const result: SeedResult = {
    success: false,
    message: "",
    created: {
      organization: false,
      property: false,
      units: 0,
      tenants: 0,
      expenses: 0,
      meters: 0,
      meterReadings: 0,
      invoices: 0,
    },
  };

  try {
    const existingOrg = await db.select().from(organizations)
      .where(eq(organizations.id, SEED_ORG_ID)).limit(1);
    
    if (existingOrg.length > 0) {
      result.message = "Seed data already exists. Skipping.";
      result.success = true;
      return result;
    }

    await db.transaction(async (tx) => {
      const [org] = await tx.insert(organizations).values({
        id: SEED_ORG_ID,
        name: "Test Hausverwaltung GmbH",
        street: "Mariahilfer Straße 1",
        postalCode: "1060",
        city: "Wien",
        country: "Österreich",
        email: "test@immoflow.at",
        phone: "+43 1 234 5678",
        uid: "ATU12345678",
      }).returning();
      result.created.organization = true;

      const [property] = await tx.insert(properties).values({
        id: SEED_PROPERTY_ID,
        organizationId: org.id,
        name: "Testliegenschaft Wien Mariahilf",
        street: "Gumpendorfer Straße 10",
        postalCode: "1060",
        city: "Wien",
        country: "Österreich",
        baujahr: 1925,
        gesamtflaeche: "450.00",
        anzahlEinheiten: 3,
      }).returning();
      result.created.property = true;

      const [unit1, unit2, unit3] = await tx.insert(units).values([
        {
          propertyId: property.id,
          topNummer: "Top 1",
          type: "wohnung",
          status: "aktiv",
          flaeche: "85.50",
          zimmer: 3,
          nutzwert: "95.00",
          stockwerk: 1,
        },
        {
          propertyId: property.id,
          topNummer: "Top 2",
          type: "wohnung",
          status: "aktiv",
          flaeche: "62.30",
          zimmer: 2,
          nutzwert: "70.00",
          stockwerk: 2,
        },
        {
          propertyId: property.id,
          topNummer: "Geschäft EG",
          type: "geschaeft",
          status: "aktiv",
          flaeche: "120.00",
          zimmer: 1,
          nutzwert: "150.00",
          stockwerk: 0,
        },
      ]).returning();
      result.created.units = 3;

      const [tenant1, tenant2] = await tx.insert(tenants).values([
        {
          unitId: unit1.id,
          firstName: "Max",
          lastName: "Mustermann",
          email: "max.mustermann@test.at",
          phone: "+43 664 1234567",
          mietbeginn: "2022-01-01",
          grundmiete: "650.00",
          betriebskostenVorschuss: "180.00",
          heizkostenVorschuss: "95.00",
          wasserkostenVorschuss: "25.00",
          iban: encryptField("AT483200000012345678"),
          bic: encryptField("RLNWATWW"),
          zahlungsart: "sepa",
        },
        {
          unitId: unit3.id,
          firstName: "Firma",
          lastName: "Beispiel GmbH",
          email: "office@beispiel.at",
          phone: "+43 1 9876543",
          mietbeginn: "2021-06-01",
          grundmiete: "1800.00",
          betriebskostenVorschuss: "350.00",
          heizkostenVorschuss: "180.00",
          wasserkostenVorschuss: "45.00",
          iban: encryptField("AT611904300234573201"),
          bic: encryptField("BKAUATWW"),
          zahlungsart: "sepa",
        },
      ]).returning();
      result.created.tenants = 2;

      await tx.insert(expenses).values([
        {
          propertyId: property.id,
          category: "betriebskosten_umlagefaehig",
          mrgKategorie: "hausbetreuung",
          description: "Hausbetreuung Q1 2026",
          betrag: "1200.00",
          rechnungsDatum: "2026-01-15",
          year: 2026,
          lieferant: "Facility Service GmbH",
          istUmlagefaehig: true,
        },
        {
          propertyId: property.id,
          category: "betriebskosten_umlagefaehig",
          mrgKategorie: "muellabfuhr",
          description: "Müllabfuhr Jänner 2026",
          betrag: "450.00",
          rechnungsDatum: "2026-01-20",
          year: 2026,
          lieferant: "MA 48",
          istUmlagefaehig: true,
        },
      ]);
      result.created.expenses = 2;

      const [meter1, meter2] = await tx.insert(meters).values([
        {
          unitId: unit1.id,
          meterNumber: "W-001-2022",
          meterType: "wasser",
          location: "Küche Top 1",
          isActive: true,
        },
        {
          unitId: unit1.id,
          meterNumber: "H-001-2022",
          meterType: "heizung",
          location: "Flur Top 1",
          isActive: true,
        },
      ]).returning();
      result.created.meters = 2;

      await tx.insert(meterReadings).values([
        {
          meterId: meter1.id,
          readingDate: "2026-01-01",
          readingValue: "125.350",
          isEstimated: false,
          readBy: "Hausverwaltung",
        },
        {
          meterId: meter2.id,
          readingDate: "2026-01-01",
          readingValue: "4523.000",
          isEstimated: false,
          readBy: "Hausverwaltung",
        },
      ]);
      result.created.meterReadings = 2;

      await tx.insert(monthlyInvoices).values({
        tenantId: tenant1.id,
        unitId: unit1.id,
        year: 2026,
        month: 1,
        grundmiete: "650.00",
        betriebskosten: "180.00",
        heizungskosten: "95.00",
        wasserkosten: "25.00",
        ustSatzMiete: 10,
        ustSatzBk: 10,
        ustSatzHeizung: 20,
        ustSatzWasser: 10,
        ust: "91.82",
        gesamtbetrag: "950.00",
        status: "offen",
        faelligAm: "2026-01-05",
      });
      result.created.invoices = 1;
    });

    result.success = true;
    result.message = "Minimal dataset seeded successfully";
    return result;

  } catch (error) {
    result.message = `Seed failed: ${error instanceof Error ? error.message : String(error)}`;
    return result;
  }
}

export async function clearSeedData(): Promise<{ success: boolean; message: string }> {
  try {
    const existingOrg = await db.select().from(organizations)
      .where(eq(organizations.id, SEED_ORG_ID)).limit(1);
    
    if (existingOrg.length === 0) {
      return { success: true, message: "No seed data found" };
    }

    await db.delete(organizations).where(eq(organizations.id, SEED_ORG_ID));
    
    return { success: true, message: "Seed data cleared" };
  } catch (error) {
    return { 
      success: false, 
      message: `Clear failed: ${error instanceof Error ? error.message : String(error)}` 
    };
  }
}

if (require.main === module) {
  seedMinimalDataset()
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch(err => {
      console.error("Seed error:", err);
      process.exit(1);
    });
}
