import crypto from "crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";

export interface AuditHashEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  organizationId: string;
  userId: string;
  data: Record<string, unknown>;
  previousHash: string;
  hash: string;
  timestamp: string;
}

function computeHash(data: {
  action: string;
  entityType: string;
  entityId: string;
  organizationId: string;
  userId: string;
  payload: Record<string, unknown>;
  previousHash: string;
  timestamp: string;
}): string {
  const content = JSON.stringify({
    action: data.action,
    entityType: data.entityType,
    entityId: data.entityId,
    organizationId: data.organizationId,
    userId: data.userId,
    payload: data.payload,
    previousHash: data.previousHash,
    timestamp: data.timestamp,
  });
  return crypto.createHash("sha256").update(content).digest("hex");
}

export async function getLastHash(organizationId: string): Promise<string> {
  try {
    const result = await db.execute(sql`
      SELECT hash FROM financial_audit_log
      WHERE organization_id = ${organizationId}::uuid
      ORDER BY created_at DESC
      LIMIT 1
    `);
    return (result as any).rows?.[0]?.hash || "GENESIS";
  } catch {
    return "GENESIS";
  }
}

export async function createFinancialAuditEntry(params: {
  action: string;
  entityType: string;
  entityId: string;
  organizationId: string;
  userId: string;
  data: Record<string, unknown>;
}): Promise<AuditHashEntry> {
  const timestamp = new Date().toISOString();
  const previousHash = await getLastHash(params.organizationId);

  const hash = computeHash({
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    organizationId: params.organizationId,
    userId: params.userId,
    payload: params.data,
    previousHash,
    timestamp,
  });

  const id = crypto.randomUUID();

  await db.execute(sql`
    INSERT INTO financial_audit_log (id, action, entity_type, entity_id, organization_id, user_id, data, previous_hash, hash, created_at)
    VALUES (${id}::uuid, ${params.action}, ${params.entityType}, ${params.entityId}, ${params.organizationId}::uuid, ${params.userId}::uuid, ${JSON.stringify(params.data)}::jsonb, ${previousHash}, ${hash}, ${timestamp}::timestamptz)
  `);

  return {
    id,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    organizationId: params.organizationId,
    userId: params.userId,
    data: params.data,
    previousHash,
    hash,
    timestamp,
  };
}

export async function verifyAuditChain(organizationId: string): Promise<{
  valid: boolean;
  totalEntries: number;
  brokenAt?: number;
  message: string;
}> {
  try {
    const entries = await db.execute(sql`
      SELECT id, action, entity_type, entity_id, organization_id, user_id, data, previous_hash, hash, created_at
      FROM financial_audit_log
      WHERE organization_id = ${organizationId}::uuid
      ORDER BY created_at ASC
    `);

    const rows = (entries as any).rows || [];
    if (rows.length === 0) {
      return { valid: true, totalEntries: 0, message: "Keine Einträge vorhanden" };
    }

    let expectedPreviousHash = "GENESIS";

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      if (row.previous_hash !== expectedPreviousHash) {
        return {
          valid: false,
          totalEntries: rows.length,
          brokenAt: i,
          message: `Kette unterbrochen bei Eintrag ${i + 1}: erwarteter Previous-Hash stimmt nicht überein`,
        };
      }

      const expectedHash = computeHash({
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        organizationId: row.organization_id,
        userId: row.user_id,
        payload: typeof row.data === "string" ? JSON.parse(row.data) : row.data,
        previousHash: row.previous_hash,
        timestamp: new Date(row.created_at).toISOString(),
      });

      if (row.hash !== expectedHash) {
        return {
          valid: false,
          totalEntries: rows.length,
          brokenAt: i,
          message: `Hash-Manipulation erkannt bei Eintrag ${i + 1}: gespeicherter Hash stimmt nicht mit berechnetem überein`,
        };
      }

      expectedPreviousHash = row.hash;
    }

    return {
      valid: true,
      totalEntries: rows.length,
      message: `Alle ${rows.length} Einträge verifiziert – Kette intakt`,
    };
  } catch (error: any) {
    return {
      valid: false,
      totalEntries: 0,
      message: `Verifikation fehlgeschlagen: ${error.message}`,
    };
  }
}
