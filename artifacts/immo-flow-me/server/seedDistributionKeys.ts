import { rootDb as db } from "./db";
import { distributionKeys } from "@shared/schema";
import { sql } from "drizzle-orm";

const STANDARD_DISTRIBUTION_KEYS = [
  {
    keyCode: "nutzflaeche",
    name: "Nutzfläche (m²)",
    description: "Verteilung nach Nutzfläche in Quadratmetern",
    unit: "m²",
    inputType: "flaeche",
    isSystem: true,
    mrgKonform: true,
    mrgParagraph: "§21 MRG",
    sortOrder: 1,
  },
  {
    keyCode: "einheiten",
    name: "Anzahl Einheiten",
    description: "Gleicher Anteil pro Mieteinheit (1:1)",
    unit: "Stück",
    inputType: "anzahl",
    isSystem: true,
    mrgKonform: true,
    mrgParagraph: "§21 MRG",
    sortOrder: 2,
  },
  {
    keyCode: "personen",
    name: "Anzahl Personen",
    description: "Verteilung nach Anzahl der Bewohner",
    unit: "Personen",
    inputType: "anzahl",
    isSystem: true,
    mrgKonform: true,
    mrgParagraph: "§21 MRG",
    sortOrder: 3,
  },
  {
    keyCode: "pauschal",
    name: "Pauschal (Gleichverteilung)",
    description: "Gleiche Verteilung auf alle aktiven Mieter",
    unit: "Anteil",
    inputType: "pauschal",
    isSystem: true,
    mrgKonform: true,
    mrgParagraph: "§21 MRG",
    sortOrder: 4,
  },
  {
    keyCode: "verbrauch",
    name: "Verbrauch",
    description: "Verteilung nach tatsächlichem Verbrauch (Zählerstand)",
    unit: "kWh/m³",
    inputType: "verbrauch",
    isSystem: true,
    mrgKonform: true,
    mrgParagraph: "§21 MRG",
    sortOrder: 5,
  },
  {
    keyCode: "sondernutzung",
    name: "Sondernutzung",
    description: "Für Garage, Keller, Terrasse etc. mit individuellen Anteilen",
    unit: "Anteil",
    inputType: "sondernutzung",
    isSystem: true,
    mrgKonform: true,
    mrgParagraph: "§21 MRG",
    sortOrder: 6,
  },
];

/**
 * Seedet fehlende Standard-Verteilerschlüssel für ALLE Organisationen.
 * Seit Task #138 sind Verteilerschlüssel org-gebunden (organization_id NOT NULL);
 * globale NULL-org-Zeilen wären durch RLS für alle unsichtbar.
 * Ein einziges INSERT..SELECT legt genau die (Org, key_code)-Paare an, die fehlen.
 */
export async function seedDistributionKeys(): Promise<void> {
  try {
    let created = 0;
    for (const key of STANDARD_DISTRIBUTION_KEYS) {
      const result = await db.execute(sql`
        INSERT INTO distribution_keys
          (organization_id, key_code, name, description, unit, input_type,
           is_system, is_active, mrg_konform, mrg_paragraph, sort_order)
        SELECT o.id, ${key.keyCode}, ${key.name}, ${key.description}, ${key.unit},
               ${key.inputType}, ${key.isSystem}, true, ${key.mrgKonform},
               ${key.mrgParagraph}, ${key.sortOrder}
        FROM organizations o
        WHERE NOT EXISTS (
          SELECT 1 FROM distribution_keys dk
          WHERE dk.organization_id = o.id AND dk.key_code = ${key.keyCode}
        )
        ON CONFLICT (organization_id, key_code) WHERE property_id IS NULL DO NOTHING
      `);
      created += result.rowCount ?? 0;
    }
    if (created > 0) {
      console.log(`Distribution keys seeded: ${created} rows created across organizations`);
    } else {
      console.log("Standard distribution keys already exist, skipping seed");
    }
  } catch (error) {
    console.error("Error seeding distribution keys:", error);
  }
}

/** Seedet die Standard-Verteilerschlüssel für eine einzelne (neue) Organisation. */
export async function seedDistributionKeysForOrg(organizationId: string): Promise<void> {
  for (const key of STANDARD_DISTRIBUTION_KEYS) {
    await db.execute(sql`
      INSERT INTO distribution_keys
        (organization_id, key_code, name, description, unit, input_type,
         is_system, is_active, mrg_konform, mrg_paragraph, sort_order)
      SELECT ${organizationId}, ${key.keyCode}, ${key.name}, ${key.description},
             ${key.unit}, ${key.inputType}, ${key.isSystem}, true,
             ${key.mrgKonform}, ${key.mrgParagraph}, ${key.sortOrder}
      WHERE NOT EXISTS (
        SELECT 1 FROM distribution_keys dk
        WHERE dk.organization_id = ${organizationId} AND dk.key_code = ${key.keyCode}
      )
      ON CONFLICT (organization_id, key_code) WHERE property_id IS NULL DO NOTHING
    `);
  }
}

export { STANDARD_DISTRIBUTION_KEYS };
