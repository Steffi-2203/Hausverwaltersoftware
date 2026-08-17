import { and, eq, inArray, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";

export class KeyHandoverError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = "KeyHandoverError";
  }
}

/**
 * Erstellt eine Schlüsselübergabe org-gebunden und atomar.
 *
 * Org-Scope VOR dem Insert: Der Schlüsselbestand (und ein optionaler Tenant)
 * muss über seine Property zur Organisation gehören — fremde IDs → 404.
 * Insert + Bestands-Update laufen in einer Transaktion; trifft das
 * org-gebundene Update 0 Zeilen, wird alles zurückgerollt.
 */
export async function createKeyHandover(params: {
  organizationId: string;
  keyInventoryId: string;
  body: {
    tenantId?: string | null;
    recipientName?: string | null;
    handoverDate: string;
    returnDate?: string | null;
    quantity?: number;
    status?: string;
    handoverProtocol?: string | null;
    notes?: string | null;
  };
}) {
  const { organizationId, keyInventoryId, body } = params;

  return db.transaction(async (tx) => {
    // Org-Checks INNERHALB der Transaktion mit Zeilensperren (TOCTOU-Schutz):
    // Bestand und Tenant werden gesperrt geprüft, damit eine parallele
    // Umhängung zwischen Prüfung und Insert ausgeschlossen ist.
    const invRows: any = await tx.execute(sql`
      SELECT ki.id FROM key_inventory ki
      JOIN properties p ON ki.property_id = p.id
      WHERE ki.id = ${keyInventoryId}
        AND p.organization_id = ${organizationId}
      FOR UPDATE OF ki
    `);
    if (!invRows.rows?.length) {
      throw new KeyHandoverError("Schlüsselbestand nicht gefunden", 404);
    }

    if (body.tenantId) {
      const tenantRows: any = await tx.execute(sql`
        SELECT t.id FROM tenants t
        JOIN units u ON t.unit_id = u.id
        JOIN properties p ON u.property_id = p.id
        WHERE t.id = ${body.tenantId}
          AND p.organization_id = ${organizationId}
        FOR UPDATE OF t
      `);
      if (!tenantRows.rows?.length) {
        throw new KeyHandoverError("Mieter nicht gefunden", 404);
      }
    }

    const inserted = await tx.insert(schema.keyHandovers).values({
      keyInventoryId,
      tenantId: body.tenantId || null,
      recipientName: body.recipientName || null,
      handoverDate: body.handoverDate,
      returnDate: body.returnDate || null,
      quantity: body.quantity || 1,
      status: (body.status as any) || 'ausgegeben',
      handoverProtocol: body.handoverProtocol || null,
      notes: body.notes || null,
    }).returning();

    if (!body.returnDate) {
      const updated = await tx.update(schema.keyInventory)
        .set({
          availableCount: sql`GREATEST(0, ${schema.keyInventory.availableCount} - ${body.quantity || 1})`,
          updatedAt: new Date()
        })
        .where(and(
          eq(schema.keyInventory.id, keyInventoryId),
          inArray(schema.keyInventory.propertyId,
            tx.select({ id: schema.properties.id }).from(schema.properties)
              .where(eq(schema.properties.organizationId, organizationId)))
        ))
        .returning({ id: schema.keyInventory.id });
      if (!updated.length) {
        throw new KeyHandoverError("Schlüsselbestand nicht gefunden (Org-Scope)", 404);
      }
    }
    return inserted;
  });
}
