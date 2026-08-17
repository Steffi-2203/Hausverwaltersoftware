/**
 * Alle VPI-Routen als importierbarer Express-Router
 *
 * Ermöglicht isoliertes Testen ohne den gesamten registerRoutes()-Aufruf
 * (der Migrations-Bootstrapping und weitere Nebeneffekte auslöst).
 *
 * Routen:
 *   GET    /api/vpi/values              — nur isAuthenticated
 *   POST   /api/vpi/values              — admin oder finance (Upsert)
 *   PATCH  /api/vpi/values/:id          — admin oder finance
 *   DELETE /api/vpi/values/:id          — nur admin
 *   POST   /api/vpi/import              — admin oder finance (Auto-Import Statistik Austria)
 *   POST   /api/vpi/import-csv          — admin oder finance (CSV-Upload)
 *   GET    /api/vpi/check-adjustments   — isAuthenticated (Org aus Session)
 *   POST   /api/vpi/apply               — property_manager oder finance
 */

import { Router } from "express";
import { db, rootDb } from "../db";
import { sql, eq, and, isNull } from "drizzle-orm";
import { tenants, units, properties, vpiAdjustments, rentHistory } from "@shared/schema";
import { isAuthenticated, requireRole, getProfileFromSession, snakeToCamel } from "./helpers";
import { vpiAutomationService } from "../services/vpiAutomationService";

const router = Router();

/**
 * Advisory-Lock-ID fuer VPI-Loeschen / VPI-Anpassung.
 *
 * DELETE /api/vpi/values/:id nimmt einen EXKLUSIVEN Advisory Lock bevor es
 * Referenzen prueft und den Wert loescht.  POST /api/vpi/apply nimmt einen
 * SHARED Advisory Lock bevor es die Anpassung commitet und vpi_base setzt.
 *
 * Dadurch schliessen sich Loeschung und Anpassungserstellung gegenseitig aus:
 * - Mehrere parallele apply-Aufrufe blockieren sich nicht gegenseitig (shared/shared)
 * - Ein DELETE wartet, bis alle laufenden Transaktionen ihren shared Lock freigeben
 * - Waehrend DELETE laeuft, blockiert jeder apply-Aufruf, bis der exklusive Lock
 *   freigegeben ist
 *
 * Wert: 7460000001 (kollisionsfrei; kein anderer Code im Projekt nutzt diesen Wert)
 */
export { VPI_ADVISORY_LOCK_ID } from "../services/vpiLock";
import { VPI_ADVISORY_LOCK_ID } from "../services/vpiLock";

// ── CRUD: Werte lesen / anlegen / bearbeiten / löschen ────────────────────────

router.get("/api/vpi/values", isAuthenticated, async (_req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT id, year, month, value, source, created_at, updated_at
      FROM vpi_values ORDER BY year DESC, month DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("VPI values error:", error);
    res.status(500).json({ error: "Fehler beim Laden der VPI-Werte" });
  }
});

router.post("/api/vpi/values", isAuthenticated, requireRole("admin", "finance"), async (req, res) => {
  try {
    const { year, month, value, source } = req.body;
    if (!year || !month || value === undefined) {
      return res.status(400).json({ error: "Jahr, Monat und Wert sind erforderlich" });
    }
    const monthNum = Number(month);
    if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
      return res.status(400).json({ error: "Monat muss eine ganze Zahl zwischen 1 und 12 sein" });
    }
    const valueNum = Number(value);
    if (!Number.isFinite(valueNum) || valueNum <= 0) {
      return res.status(400).json({ error: "VPI-Wert muss eine positive endliche Zahl sein" });
    }
    const result = await db.execute(sql`
      INSERT INTO vpi_values (year, month, value, source)
      VALUES (${year}, ${month}, ${value}, ${source || "manual"})
      ON CONFLICT (year, month) DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source, updated_at = NOW()
      RETURNING *
    `);
    res.json(result.rows[0]);
  } catch (error) {
    console.error("VPI value create error:", error);
    res.status(500).json({ error: "Fehler beim Speichern des VPI-Werts" });
  }
});

router.patch("/api/vpi/values/:id", isAuthenticated, requireRole("admin", "finance"), async (req, res) => {
  try {
    const { value, source } = req.body;
    if (value === undefined) {
      return res.status(400).json({ error: "Wert ist erforderlich" });
    }
    const valueNum = Number(value);
    if (!Number.isFinite(valueNum) || valueNum <= 0) {
      return res.status(400).json({ error: "VPI-Wert muss eine positive endliche Zahl sein" });
    }
    const result = await db.execute(sql`
      UPDATE vpi_values
      SET value = ${value}, source = COALESCE(${source ?? null}, source), updated_at = NOW()
      WHERE id = ${req.params.id}::uuid
      RETURNING *
    `);
    if (!result.rows.length) return res.status(404).json({ error: "VPI-Wert nicht gefunden" });
    res.json(result.rows[0]);
  } catch (error) {
    console.error("VPI value update error:", error);
    res.status(500).json({ error: "Fehler beim Aktualisieren des VPI-Werts" });
  }
});

router.delete("/api/vpi/values/:id", isAuthenticated, requireRole("admin"), async (req, res) => {
  try {
    // Alle Schritte laufen innerhalb einer Transaktion mit einem EXKLUSIVEN
    // Advisory Lock. Dadurch kann kein gleichzeitiger POST /api/vpi/apply
    // (der einen SHARED Lock haelt) den gleichen VPI-Wert als Referenz
    // committen, waehrend der Referenz-Check laeuft.
    const result = await db.transaction(async (tx) => {
      // Exklusiver Lock — blockiert alle SHARED-Lock-Halter (apply-Transaktionen)
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${VPI_ADVISORY_LOCK_ID})`);

      // Wert laden (innerhalb der gesperrten Transaktion)
      const existing = await tx.execute(sql`
        SELECT id, year, month, value FROM vpi_values WHERE id = ${req.params.id}::uuid
      `);
      if (!existing.rows.length) return { status: 404, body: { error: "VPI-Wert nicht gefunden" } };
      const { value } = existing.rows[0] as { year: number; month: number; value: string };

      // Referenz-Check 1: aktive Mietvertraege die diesen Wert als vpi_base tragen
      // rootDb: VPI-Werte sind global (org-unabhängig); Referenzen können in jeder Org liegen
      const tenantRef = await rootDb.execute(sql`
        SELECT COUNT(*)::int AS cnt
        FROM tenants
        WHERE vpi_base IS NOT NULL
          AND vpi_base::numeric = ${value}::numeric
          AND deleted_at IS NULL
      `);
      if ((tenantRef.rows[0] as any).cnt > 0) {
        return {
          status: 409,
          body: {
            error: "Dieser VPI-Wert wird als Referenzwert in aktiven Mietvertraegen verwendet und kann nicht geloescht werden.",
            error_code: "VPI_IN_USE_TENANTS",
          },
        };
      }

      // Referenz-Check 2: Indexanpassungen die diesen Wert als neuen Basiswert gesetzt haben
      // rootDb: Indexanpassungen können org-übergreifend referenziert werden
      const adjRef = await rootDb.execute(sql`
        SELECT COUNT(*)::int AS cnt
        FROM vpi_adjustments
        WHERE vpi_new::numeric = ${value}::numeric
      `);
      if ((adjRef.rows[0] as any).cnt > 0) {
        return {
          status: 409,
          body: {
            error: "Dieser VPI-Wert ist in Indexanpassungen als neuer Basiswert hinterlegt und kann nicht geloescht werden.",
            error_code: "VPI_IN_USE_ADJUSTMENTS",
          },
        };
      }

      await tx.execute(sql`DELETE FROM vpi_values WHERE id = ${req.params.id}::uuid`);
      return { status: 200, body: { success: true } };
    });

    res.status(result.status).json(result.body);
  } catch (error) {
    console.error("VPI value delete error:", error);
    res.status(500).json({ error: "Fehler beim Loeschen des VPI-Werts" });
  }
});

// ── Import ─────────────────────────────────────────────────────────────────────

/** Auto-Import: holt VPI-Daten direkt von Statistik Austria OGD-API */
router.post("/api/vpi/import", isAuthenticated, requireRole("admin", "finance"), async (_req, res) => {
  try {
    const { importVpiFromStatistikAustria } = await import("../services/vpiImportService");
    const result = await importVpiFromStatistikAustria();
    res.json(result);
  } catch (error: any) {
    console.error("VPI auto-import error:", error);
    const status =
      error.message?.includes("nicht erreichbar") ||
      error.message?.includes("Zeitüberschreitung")
        ? 503
        : 500;
    res.status(status).json({ error: error.message || "Fehler beim Auto-Import" });
  }
});

/** CSV-Import: parst hochgeladenen CSV-Text aus dem Request-Body */
router.post("/api/vpi/import-csv", isAuthenticated, requireRole("admin", "finance"), async (req, res) => {
  try {
    const csvText: string = typeof req.body?.csv === "string" ? req.body.csv : "";
    if (!csvText.trim()) {
      return res.status(400).json({ error: "Kein CSV-Inhalt übermittelt" });
    }
    const { importVpiFromCsv } = await import("../services/vpiImportService");
    const result = await importVpiFromCsv(csvText);
    res.json(result);
  } catch (error: any) {
    console.error("VPI CSV-import error:", error);
    res.status(400).json({ error: error.message || "Fehler beim CSV-Import" });
  }
});

// ── Automation ─────────────────────────────────────────────────────────────────

router.get("/api/vpi/check-adjustments", isAuthenticated, async (req, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) {
      return res.status(400).json({ error: "No organization" });
    }
    const adjustments = await vpiAutomationService.checkVpiAdjustments(profile.organizationId);
    res.json({ adjustments });
  } catch (error: any) {
    // getCurrentVpi wirft diesen Fehler wenn vpi_values leer ist — klar kommunizieren.
    if (error?.message?.includes("VPI-Tabelle ist leer")) {
      return res.status(422).json({
        error:
          "Keine VPI-Daten vorhanden. Bitte importieren Sie aktuelle Indexwerte von Statistik Austria bevor Sie die Anpassungsprüfung starten.",
        code: "VPI_EMPTY",
      });
    }
    console.error("VPI check-adjustments error:", error);
    res.status(500).json({ error: "Fehler bei der VPI-Anpassungsprüfung" });
  }
});

// POST /api/vpi/apply — Wendet eine VPI-Anpassung auf einen Mieter an.
// Client darf nur tenantId + effectiveDate senden; newRent/currentVpiValue
// werden ignoriert und server-seitig neu berechnet.
router.post("/api/vpi/apply", isAuthenticated, requireRole("property_manager", "finance"), async (req, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) {
      return res.status(400).json({ error: "No organization" });
    }
    const normalizedBody = snakeToCamel(req.body);
    const { tenantId, effectiveDate: clientEffectiveDate } = normalizedBody;
    if (!tenantId) return res.status(400).json({ error: "tenantId ist erforderlich" });

    const effectiveDate: string =
      clientEffectiveDate ||
      new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
        .toISOString()
        .split("T")[0];

    // 1. Org-Zugehörigkeit prüfen (ohne Lock)
    const orgCheckRows = await db
      .select({ tenantId: tenants.id })
      .from(tenants)
      .innerJoin(units, eq(tenants.unitId, units.id))
      .innerJoin(properties, eq(units.propertyId, properties.id))
      .where(
        and(
          eq(tenants.id, tenantId),
          eq(properties.organizationId, profile.organizationId),
          isNull(tenants.deletedAt),
        ),
      )
      .limit(1);
    if (!orgCheckRows[0]) return res.status(404).json({ error: "Mieter nicht gefunden" });

    const DEFAULT_VPI_BASE = 100;
    const SCHWELLENWERT = 0.05;
    const now = new Date();
    const today = now.toISOString().split("T")[0]!;

    // 2. Erstellen + Anwenden in einer Transaktion — Shared Lock ZUERST, dann VPI lesen.
    //    Die Reihenfolge ist entscheidend: currentVpi wird NACH dem Lock gelesen,
    //    damit ein gleichzeitiger DELETE (exklusiver Lock) nicht den Wert entfernen
    //    kann, den wir gleich als Referenz schreiben wollen.
    const result = await db.transaction(async (tx) => {
      // SHARED Advisory Lock: mehrere parallele apply-Aufrufe koennen gleichzeitig
      // laufen (shared/shared), aber kein DELETE (exklusiver Lock) kann starten
      // solange dieser Lock gehalten wird — und umgekehrt.
      await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${VPI_ADVISORY_LOCK_ID})`);

      // VPI NACH dem Lock lesen — dadurch ist sichergestellt, dass der gelesene
      // Wert nicht durch ein gleichzeitiges DELETE verschwinden kann bevor wir
      // ihn als vpi_new / vpi_base committen.
      const currentVpi = await vpiAutomationService.getCurrentVpi();

      // Tenant-Zeile sperren; danach den aktuellen Stand lesen (Post-Lock-Read)
      await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for("update").limit(1);

      const [lockedTenantRow] = await tx
        .select()
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      if (!lockedTenantRow) throw new Error("Mieter nicht gefunden nach Lock");

      const tenant = lockedTenantRow;
      const baseVpi = Number(tenant.vpiBase) || DEFAULT_VPI_BASE;
      const currentRent = Number(tenant.grundmiete) || 0;
      const tenantSchwellenwert =
        tenant.vpiSchwellenwert != null ? Number(tenant.vpiSchwellenwert) : SCHWELLENWERT;
      const percentageIncrease = (currentVpi.value - baseVpi) / baseVpi;

      // Schwellenwert-Check nach Lock
      if (percentageIncrease < tenantSchwellenwert) {
        throw Object.assign(
          new Error(
            `Schwellenwert nicht erreicht: ${(percentageIncrease * 100).toFixed(2)}% < ${(tenantSchwellenwert * 100).toFixed(2)}%`,
          ),
          { status: 422 },
        );
      }

      // Versionscheck: vpiBase muss dem erwarteten Stand entsprechen —
      // parallele Requests die denselben alten Stand gelesen haben,
      // scheitern hier nach dem Lock, weil vpiBase inzwischen aktualisiert wurde.
      if (
        Math.abs(Number(tenant.vpiBase || DEFAULT_VPI_BASE) - baseVpi) > 0.01 &&
        tenant.lastVpiAdjustment
      ) {
        throw Object.assign(
          new Error("VPI-Basis wurde inzwischen durch eine parallele Anpassung verändert"),
          { status: 409 },
        );
      }

      const serverNewRent = Math.round(currentRent * (1 + percentageIncrease) * 100) / 100;
      const percentageChange =
        currentRent > 0 ? ((serverNewRent - currentRent) / currentRent) * 100 : 0;

      const [adj] = await tx
        .insert(vpiAdjustments)
        .values({
          tenantId,
          adjustmentDate: effectiveDate!,
          previousRent: currentRent.toString(),
          newRent: serverNewRent.toString(),
          vpiOld: baseVpi.toString(),
          vpiNew: currentVpi.value.toString(),
          percentageChange: percentageChange.toFixed(2),
          effectiveDate: effectiveDate,
          appliedAt: now,
          notificationSent: true,
          notificationDate: today,
        })
        .returning();

      await tx.insert(rentHistory).values({
        tenantId,
        grundmiete: serverNewRent.toString(),
        betriebskostenVorschuss: tenant.betriebskostenVorschuss || "0",
        heizkostenVorschuss: tenant.heizkostenVorschuss || "0",
        wasserkostenVorschuss: tenant.wasserkostenVorschuss || "0",
        validFrom: effectiveDate,
        changeReason: `VPI-Anpassung: ${percentageChange.toFixed(2)}%`,
      });

      await tx
        .update(tenants)
        .set({
          grundmiete: serverNewRent.toString(),
          vpiBase: currentVpi.value.toString(),
          lastVpiAdjustment: effectiveDate,
          updatedAt: now,
        })
        .where(eq(tenants.id, tenantId));

      return adj;
    });

    res.json({
      success: true,
      message: `VPI-Anpassung erfolgreich angewendet`,
      adjustment: result,
    });
  } catch (error: any) {
    console.error("VPI apply error:", error);
    const status = (error as any).status ?? 500;
    res.status(status).json({ success: false, error: error.message || "Failed to apply VPI adjustment" });
  }
});

export default router;
