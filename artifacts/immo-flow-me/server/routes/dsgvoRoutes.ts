import type { Express, Request, Response } from "express";
import { db } from "../db";
import { eq, and, desc, sql, lte, isNull } from "drizzle-orm";
import * as schema from "@shared/schema";
import { storage } from "../storage";

const ADMIN_ROLES = ['admin', 'property_manager'];

async function getAuthContext(req: Request, res: Response, requireAdmin = false) {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    res.status(401).json({ error: "Nicht authentifiziert" });
    return null;
  }
  const profile = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.id, userId))
    .limit(1);
  if (!profile.length) {
    res.status(403).json({ error: "Profil nicht gefunden" });
    return null;
  }

  if (requireAdmin) {
    try {
      const roles = await storage.getUserRoles(userId);
      const userRoles = roles.map((r: any) => r.role);
      if (!userRoles.some((r: string) => ADMIN_ROLES.includes(r))) {
        res.status(403).json({ error: "Keine Berechtigung für diese Aktion" });
        return null;
      }
    } catch {
      res.status(403).json({ error: "Rollenprüfung fehlgeschlagen" });
      return null;
    }
  }

  return { userId, orgId: profile[0].organizationId };
}

export function registerDsgvoRoutes(app: Express) {

  // ====== CONSENT MANAGEMENT ======

  app.post("/api/dsgvo/consent", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res);
      if (!ctx) return;

      const { consentType, granted, consentVersion, legalBasis } = req.body;

      if (!consentType) {
        return res.status(400).json({ error: "Einwilligungstyp ist erforderlich" });
      }

      const serverIp = req.ip || req.headers['x-forwarded-for']?.toString() || 'unknown';
      const serverUa = req.headers['user-agent'] || 'unknown';

      const [record] = await db
        .insert(schema.consentRecords)
        .values({
          userId: ctx.userId,
          organizationId: ctx.orgId,
          consentType,
          granted: granted ?? false,
          consentVersion: consentVersion ?? "1.0",
          ipAddress: serverIp,
          userAgent: serverUa,
          legalBasis: legalBasis ?? null,
        })
        .returning();

      res.status(201).json(record);
    } catch (error) {
      console.error("DSGVO consent create error:", error);
      res.status(500).json({ error: "Fehler beim Speichern der Einwilligung" });
    }
  });

  app.get("/api/dsgvo/consent", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res);
      if (!ctx) return;

      const records = await db
        .select()
        .from(schema.consentRecords)
        .where(eq(schema.consentRecords.userId, ctx.userId))
        .orderBy(desc(schema.consentRecords.createdAt));

      res.json(records);
    } catch (error) {
      console.error("DSGVO consent list error:", error);
      res.status(500).json({ error: "Fehler beim Laden der Einwilligungen" });
    }
  });

  app.put("/api/dsgvo/consent/:id/revoke", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res);
      if (!ctx) return;

      const { id } = req.params;

      const existing = await db
        .select()
        .from(schema.consentRecords)
        .where(and(eq(schema.consentRecords.id, id), eq(schema.consentRecords.userId, ctx.userId)))
        .limit(1);

      if (!existing.length) {
        return res.status(404).json({ error: "Einwilligung nicht gefunden" });
      }

      if (existing[0].revokedAt) {
        return res.status(400).json({ error: "Einwilligung wurde bereits widerrufen" });
      }

      const [updated] = await db
        .update(schema.consentRecords)
        .set({ revokedAt: new Date(), granted: false })
        .where(and(eq(schema.consentRecords.id, id), eq(schema.consentRecords.userId, ctx.userId)))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("DSGVO consent revoke error:", error);
      res.status(500).json({ error: "Fehler beim Widerrufen der Einwilligung" });
    }
  });

  // ====== PROCESSING ACTIVITIES (Art. 30 DSGVO) ======

  app.get("/api/dsgvo/processing-activities", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res, true);
      if (!ctx) return;

      if (!ctx.orgId) {
        return res.json([]);
      }

      const activities = await db
        .select()
        .from(schema.processingActivities)
        .where(
          and(
            eq(schema.processingActivities.organizationId, ctx.orgId),
            eq(schema.processingActivities.isActive, true)
          )
        )
        .orderBy(desc(schema.processingActivities.createdAt));

      res.json(activities);
    } catch (error) {
      console.error("DSGVO processing activities list error:", error);
      res.status(500).json({ error: "Fehler beim Laden der Verarbeitungstätigkeiten" });
    }
  });

  app.post("/api/dsgvo/processing-activities", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res, true);
      if (!ctx) return;

      if (!ctx.orgId) {
        return res.status(400).json({ error: "Keine Organisation zugeordnet" });
      }

      const {
        name, purpose, legalBasis, dataCategories, dataSubjects,
        recipients, thirdCountryTransfer, transferSafeguards,
        retentionPeriod, technicalMeasures, organizationalMeasures,
        responsiblePerson, dpiaConducted, dpiaDate, lastReviewDate, nextReviewDate,
      } = req.body;

      if (!name || !purpose || !legalBasis || !retentionPeriod) {
        return res.status(400).json({ error: "Name, Zweck, Rechtsgrundlage und Aufbewahrungsfrist sind erforderlich" });
      }

      const [activity] = await db
        .insert(schema.processingActivities)
        .values({
          organizationId: ctx.orgId,
          name,
          purpose,
          legalBasis,
          dataCategories: dataCategories ?? [],
          dataSubjects: dataSubjects ?? [],
          recipients: recipients ?? null,
          thirdCountryTransfer: thirdCountryTransfer ?? false,
          transferSafeguards: transferSafeguards ?? null,
          retentionPeriod,
          technicalMeasures: technicalMeasures ?? null,
          organizationalMeasures: organizationalMeasures ?? null,
          responsiblePerson: responsiblePerson ?? null,
          dpiaConducted: dpiaConducted ?? false,
          dpiaDate: dpiaDate ?? null,
          lastReviewDate: lastReviewDate ?? null,
          nextReviewDate: nextReviewDate ?? null,
        })
        .returning();

      res.status(201).json(activity);
    } catch (error) {
      console.error("DSGVO processing activity create error:", error);
      res.status(500).json({ error: "Fehler beim Erstellen der Verarbeitungstätigkeit" });
    }
  });

  app.put("/api/dsgvo/processing-activities/:id", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res, true);
      if (!ctx) return;

      const { id } = req.params;

      if (!ctx.orgId) {
        return res.status(400).json({ error: "Keine Organisation zugeordnet" });
      }

      const existing = await db
        .select()
        .from(schema.processingActivities)
        .where(
          and(
            eq(schema.processingActivities.id, id),
            eq(schema.processingActivities.organizationId, ctx.orgId)
          )
        )
        .limit(1);

      if (!existing.length) {
        return res.status(404).json({ error: "Verarbeitungstätigkeit nicht gefunden" });
      }

      const {
        name, purpose, legalBasis, dataCategories, dataSubjects,
        recipients, thirdCountryTransfer, transferSafeguards,
        retentionPeriod, technicalMeasures, organizationalMeasures,
        responsiblePerson, dpiaConducted, dpiaDate, isActive,
        lastReviewDate, nextReviewDate,
      } = req.body;

      const [updated] = await db
        .update(schema.processingActivities)
        .set({
          ...(name !== undefined && { name }),
          ...(purpose !== undefined && { purpose }),
          ...(legalBasis !== undefined && { legalBasis }),
          ...(dataCategories !== undefined && { dataCategories }),
          ...(dataSubjects !== undefined && { dataSubjects }),
          ...(recipients !== undefined && { recipients }),
          ...(thirdCountryTransfer !== undefined && { thirdCountryTransfer }),
          ...(transferSafeguards !== undefined && { transferSafeguards }),
          ...(retentionPeriod !== undefined && { retentionPeriod }),
          ...(technicalMeasures !== undefined && { technicalMeasures }),
          ...(organizationalMeasures !== undefined && { organizationalMeasures }),
          ...(responsiblePerson !== undefined && { responsiblePerson }),
          ...(dpiaConducted !== undefined && { dpiaConducted }),
          ...(dpiaDate !== undefined && { dpiaDate }),
          ...(isActive !== undefined && { isActive }),
          ...(lastReviewDate !== undefined && { lastReviewDate }),
          ...(nextReviewDate !== undefined && { nextReviewDate }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.processingActivities.id, id),
            eq(schema.processingActivities.organizationId, ctx.orgId)
          )
        )
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("DSGVO processing activity update error:", error);
      res.status(500).json({ error: "Fehler beim Aktualisieren der Verarbeitungstätigkeit" });
    }
  });

  app.delete("/api/dsgvo/processing-activities/:id", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res, true);
      if (!ctx) return;

      const { id } = req.params;

      if (!ctx.orgId) {
        return res.status(400).json({ error: "Keine Organisation zugeordnet" });
      }

      const existing = await db
        .select()
        .from(schema.processingActivities)
        .where(
          and(
            eq(schema.processingActivities.id, id),
            eq(schema.processingActivities.organizationId, ctx.orgId)
          )
        )
        .limit(1);

      if (!existing.length) {
        return res.status(404).json({ error: "Verarbeitungstätigkeit nicht gefunden" });
      }

      const [updated] = await db
        .update(schema.processingActivities)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(schema.processingActivities.id, id),
            eq(schema.processingActivities.organizationId, ctx.orgId)
          )
        )
        .returning();

      res.json({ success: true, deactivated: updated });
    } catch (error) {
      console.error("DSGVO processing activity delete error:", error);
      res.status(500).json({ error: "Fehler beim Deaktivieren der Verarbeitungstätigkeit" });
    }
  });

  // ====== DATA RETENTION POLICIES (Admin/Manager only) ======

  app.get("/api/dsgvo/retention-policies", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res, true);
      if (!ctx) return;

      if (!ctx.orgId) {
        return res.json([]);
      }

      const policies = await db
        .select()
        .from(schema.dataRetentionPolicies)
        .where(
          and(
            eq(schema.dataRetentionPolicies.organizationId, ctx.orgId),
            eq(schema.dataRetentionPolicies.isActive, true)
          )
        )
        .orderBy(desc(schema.dataRetentionPolicies.createdAt));

      res.json(policies);
    } catch (error) {
      console.error("DSGVO retention policies list error:", error);
      res.status(500).json({ error: "Fehler beim Laden der Löschfristen" });
    }
  });

  app.post("/api/dsgvo/retention-policies", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res, true);
      if (!ctx) return;

      if (!ctx.orgId) {
        return res.status(400).json({ error: "Keine Organisation zugeordnet" });
      }

      const { dataCategory, retentionDays, legalBasis, autoDelete, notifyBeforeDays } = req.body;

      if (!dataCategory || !retentionDays || !legalBasis) {
        return res.status(400).json({ error: "Datenkategorie, Aufbewahrungsdauer und Rechtsgrundlage sind erforderlich" });
      }

      const [policy] = await db
        .insert(schema.dataRetentionPolicies)
        .values({
          organizationId: ctx.orgId,
          dataCategory,
          retentionDays,
          legalBasis,
          autoDelete: autoDelete ?? false,
          notifyBeforeDays: notifyBeforeDays ?? 30,
        })
        .returning();

      res.status(201).json(policy);
    } catch (error) {
      console.error("DSGVO retention policy create error:", error);
      res.status(500).json({ error: "Fehler beim Erstellen der Löschfrist" });
    }
  });

  app.put("/api/dsgvo/retention-policies/:id", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res, true);
      if (!ctx) return;

      const { id } = req.params;

      if (!ctx.orgId) {
        return res.status(400).json({ error: "Keine Organisation zugeordnet" });
      }

      const existing = await db
        .select()
        .from(schema.dataRetentionPolicies)
        .where(
          and(
            eq(schema.dataRetentionPolicies.id, id),
            eq(schema.dataRetentionPolicies.organizationId, ctx.orgId)
          )
        )
        .limit(1);

      if (!existing.length) {
        return res.status(404).json({ error: "Löschfrist nicht gefunden" });
      }

      const { dataCategory, retentionDays, legalBasis, autoDelete, notifyBeforeDays, isActive } = req.body;

      const [updated] = await db
        .update(schema.dataRetentionPolicies)
        .set({
          ...(dataCategory !== undefined && { dataCategory }),
          ...(retentionDays !== undefined && { retentionDays }),
          ...(legalBasis !== undefined && { legalBasis }),
          ...(autoDelete !== undefined && { autoDelete }),
          ...(notifyBeforeDays !== undefined && { notifyBeforeDays }),
          ...(isActive !== undefined && { isActive }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.dataRetentionPolicies.id, id),
            eq(schema.dataRetentionPolicies.organizationId, ctx.orgId)
          )
        )
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("DSGVO retention policy update error:", error);
      res.status(500).json({ error: "Fehler beim Aktualisieren der Löschfrist" });
    }
  });

  app.post("/api/dsgvo/retention-policies/execute", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res, true);
      if (!ctx) return;

      if (!ctx.orgId) {
        return res.status(400).json({ error: "Keine Organisation zugeordnet" });
      }

      const policies = await db
        .select()
        .from(schema.dataRetentionPolicies)
        .where(
          and(
            eq(schema.dataRetentionPolicies.organizationId, ctx.orgId),
            eq(schema.dataRetentionPolicies.isActive, true)
          )
        );

      const now = new Date();
      const results: Array<{
        policy: string;
        dataCategory: string;
        retentionDays: number;
        eligibleCount: number;
        autoDelete: boolean;
      }> = [];

      for (const policy of policies) {
        const cutoffDate = new Date(now.getTime() - policy.retentionDays * 24 * 60 * 60 * 1000);
        let eligibleCount = 0;

        if (policy.dataCategory === "mieterdaten" || policy.dataCategory === "stammdaten") {
          const eligible = await db
            .select({ id: schema.tenants.id })
            .from(schema.tenants)
            .innerJoin(schema.units, eq(schema.units.id, schema.tenants.unitId))
            .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
            .where(
              and(
                eq(schema.properties.organizationId, ctx.orgId),
                eq(schema.tenants.status, "beendet"),
                lte(schema.tenants.updatedAt, cutoffDate),
                isNull(schema.tenants.deletedAt)
              )
            );
          eligibleCount = eligible.length;
        } else if (policy.dataCategory === "kommunikation") {
          const eligible = await db
            .select({ id: schema.tenants.id })
            .from(schema.tenants)
            .innerJoin(schema.units, eq(schema.units.id, schema.tenants.unitId))
            .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
            .where(
              and(
                eq(schema.properties.organizationId, ctx.orgId),
                eq(schema.tenants.status, "beendet"),
                lte(schema.tenants.updatedAt, cutoffDate),
                isNull(schema.tenants.deletedAt)
              )
            );
          eligibleCount = eligible.length;
        }

        results.push({
          policy: policy.id,
          dataCategory: policy.dataCategory,
          retentionDays: policy.retentionDays,
          eligibleCount,
          autoDelete: policy.autoDelete ?? false,
        });

        await db
          .update(schema.dataRetentionPolicies)
          .set({ lastExecutedAt: now, updatedAt: now })
          .where(eq(schema.dataRetentionPolicies.id, policy.id));
      }

      res.json({
        executedAt: now.toISOString(),
        policiesChecked: policies.length,
        results,
      });
    } catch (error) {
      console.error("DSGVO retention execute error:", error);
      res.status(500).json({ error: "Fehler bei der Löschfrist-Prüfung" });
    }
  });

  // ====== DSGVO DASHBOARD ======

  app.get("/api/dsgvo/dashboard", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res, true);
      if (!ctx) return;

      if (!ctx.orgId) {
        return res.json({
          totalConsents: 0,
          activeConsents: 0,
          revokedConsents: 0,
          processingActivitiesCount: 0,
          retentionPoliciesCount: 0,
          pendingRetention: 0,
          lastReviewDate: null,
          complianceScore: 0,
        });
      }

      const [consents, activities, retentionPolicies] = await Promise.all([
        db
          .select()
          .from(schema.consentRecords)
          .where(eq(schema.consentRecords.userId, ctx.userId)),
        db
          .select()
          .from(schema.processingActivities)
          .where(
            and(
              eq(schema.processingActivities.organizationId, ctx.orgId),
              eq(schema.processingActivities.isActive, true)
            )
          ),
        db
          .select()
          .from(schema.dataRetentionPolicies)
          .where(
            and(
              eq(schema.dataRetentionPolicies.organizationId, ctx.orgId),
              eq(schema.dataRetentionPolicies.isActive, true)
            )
          ),
      ]);

      const totalConsents = consents.length;
      const activeConsents = consents.filter((c) => c.granted && !c.revokedAt).length;
      const revokedConsents = consents.filter((c) => c.revokedAt).length;

      const processingActivitiesCount = activities.length;
      const retentionPoliciesCount = retentionPolicies.length;

      const now = new Date();
      const pendingRetention = retentionPolicies.filter((p) => {
        if (!p.lastExecutedAt) return true;
        const daysSinceExecution = (now.getTime() - new Date(p.lastExecutedAt).getTime()) / (1000 * 60 * 60 * 24);
        return daysSinceExecution > 30;
      }).length;

      const reviewDates = activities
        .filter((a) => a.lastReviewDate)
        .map((a) => new Date(a.lastReviewDate!));
      const lastReviewDate = reviewDates.length > 0
        ? new Date(Math.max(...reviewDates.map((d) => d.getTime()))).toISOString().split("T")[0]
        : null;

      const complianceScore = calculateComplianceScore(activities, retentionPolicies, consents);

      res.json({
        totalConsents,
        activeConsents,
        revokedConsents,
        processingActivitiesCount,
        retentionPoliciesCount,
        pendingRetention,
        lastReviewDate,
        complianceScore,
      });
    } catch (error) {
      console.error("DSGVO dashboard error:", error);
      res.status(500).json({ error: "Fehler beim Laden des DSGVO-Dashboards" });
    }
  });
}

function calculateComplianceScore(
  activities: schema.ProcessingActivity[],
  policies: schema.DataRetentionPolicy[],
  consents: schema.ConsentRecord[]
): number {
  let score = 0;
  let maxScore = 0;

  maxScore += 25;
  if (activities.length > 0) {
    score += 15;
    const now = new Date();
    const reviewedRecently = activities.filter((a) => {
      if (!a.lastReviewDate) return false;
      const reviewDate = new Date(a.lastReviewDate);
      const daysSince = (now.getTime() - reviewDate.getTime()) / (1000 * 60 * 60 * 24);
      return daysSince <= 365;
    });
    if (reviewedRecently.length === activities.length) {
      score += 10;
    } else if (reviewedRecently.length > 0) {
      score += Math.round((reviewedRecently.length / activities.length) * 10);
    }
  }

  maxScore += 25;
  const requiredCategories = [
    "mieterdaten",
    "finanzdaten",
    "kommunikation",
    "dokumente",
  ];
  const coveredCategories = policies.map((p) => p.dataCategory.toLowerCase());
  const covered = requiredCategories.filter((c) => coveredCategories.includes(c)).length;
  score += Math.round((covered / requiredCategories.length) * 25);

  maxScore += 25;
  if (consents.length > 0) {
    score += 10;
    const activeConsents = consents.filter((c) => c.granted && !c.revokedAt);
    if (activeConsents.length > 0) {
      score += 15;
    }
  }

  maxScore += 25;
  if (activities.length >= 3) {
    score += 10;
  }
  const withDpia = activities.filter((a) => a.dpiaConducted);
  if (withDpia.length > 0) {
    score += 5;
  }
  if (policies.length >= 3) {
    score += 10;
  }

  return Math.min(100, Math.round((score / maxScore) * 100));
}

export async function seedDefaultDsgvoData(organizationId: string) {
  const existingActivities = await db
    .select()
    .from(schema.processingActivities)
    .where(eq(schema.processingActivities.organizationId, organizationId))
    .limit(1);

  if (existingActivities.length > 0) {
    return { seeded: false, reason: "Daten bereits vorhanden" };
  }

  const defaultActivities: schema.InsertProcessingActivity[] = [
    {
      organizationId,
      name: "Mieterdatenverwaltung",
      purpose: "Verwaltung von Stammdaten der Mieter zur Durchführung des Mietvertrags",
      legalBasis: "Art. 6 Abs. 1 lit. b DSGVO - Vertragserfüllung",
      dataCategories: ["stammdaten", "kontaktdaten", "bankdaten", "mietvertragsdaten"],
      dataSubjects: ["mieter", "ehemalige_mieter"],
      recipients: ["hausverwaltung", "steuerberater"],
      retentionPeriod: "Dauer des Mietverhältnisses + 7 Jahre (BAO §132)",
      technicalMeasures: ["verschluesselung", "zugriffskontrolle", "backup", "audit_log"],
      organizationalMeasures: ["datenschutzschulung", "vertraulichkeitsvereinbarung", "zugriffsberechtigungskonzept"],
      thirdCountryTransfer: false,
      isActive: true,
    },
    {
      organizationId,
      name: "Betriebskostenabrechnung",
      purpose: "Erstellung und Versand der jährlichen Betriebskostenabrechnung gemäß MRG",
      legalBasis: "Art. 6 Abs. 1 lit. b DSGVO - Vertragserfüllung, §21 MRG",
      dataCategories: ["finanzdaten", "verbrauchsdaten", "stammdaten"],
      dataSubjects: ["mieter", "eigentuemer"],
      recipients: ["mieter", "steuerberater", "finanzamt"],
      retentionPeriod: "7 Jahre ab Ende des Geschäftsjahres (BAO §132)",
      technicalMeasures: ["verschluesselung", "zugriffskontrolle", "integritaetspruefung"],
      organizationalMeasures: ["vier_augen_prinzip", "revisionssichere_archivierung"],
      thirdCountryTransfer: false,
      isActive: true,
    },
    {
      organizationId,
      name: "SEPA-Zahlungsverkehr",
      purpose: "Durchführung von SEPA-Lastschriften und Überweisungen für Mietzahlungen",
      legalBasis: "Art. 6 Abs. 1 lit. b DSGVO - Vertragserfüllung",
      dataCategories: ["bankdaten", "zahlungsdaten", "stammdaten"],
      dataSubjects: ["mieter"],
      recipients: ["bank", "zahlungsdienstleister"],
      retentionPeriod: "7 Jahre ab Transaktionsdatum (BAO §132)",
      technicalMeasures: ["verschluesselung", "sichere_uebertragung", "zugriffskontrolle"],
      organizationalMeasures: ["mandatsverwaltung", "vier_augen_prinzip"],
      thirdCountryTransfer: false,
      isActive: true,
    },
    {
      organizationId,
      name: "Kommunikation mit Mietern",
      purpose: "Schriftverkehr, E-Mail-Kommunikation und Benachrichtigungen an Mieter",
      legalBasis: "Art. 6 Abs. 1 lit. b DSGVO - Vertragserfüllung, Art. 6 Abs. 1 lit. f DSGVO - berechtigtes Interesse",
      dataCategories: ["kontaktdaten", "kommunikationsinhalte"],
      dataSubjects: ["mieter", "eigentuemer", "dienstleister"],
      recipients: ["empfaenger_der_kommunikation"],
      retentionPeriod: "3 Jahre nach Ende des Mietverhältnisses",
      technicalMeasures: ["verschluesselung", "zugriffskontrolle"],
      organizationalMeasures: ["datenschutzschulung", "kommunikationsrichtlinien"],
      thirdCountryTransfer: false,
      isActive: true,
    },
    {
      organizationId,
      name: "Dokumentenverwaltung",
      purpose: "Speicherung und Verwaltung von Verträgen, Belegen und Dokumenten",
      legalBasis: "Art. 6 Abs. 1 lit. b DSGVO - Vertragserfüllung, Art. 6 Abs. 1 lit. c DSGVO - rechtliche Verpflichtung",
      dataCategories: ["dokumente", "vertraege", "belege"],
      dataSubjects: ["mieter", "eigentuemer", "dienstleister"],
      recipients: ["hausverwaltung", "steuerberater"],
      retentionPeriod: "7 Jahre nach Ende des Mietverhältnisses (BAO §132)",
      technicalMeasures: ["verschluesselung", "zugriffskontrolle", "backup", "versionierung"],
      organizationalMeasures: ["dokumentenklassifizierung", "loeschkonzept"],
      thirdCountryTransfer: false,
      isActive: true,
    },
    {
      organizationId,
      name: "Zählerdatenerfassung",
      purpose: "Erfassung und Auswertung von Zählerständen für Heiz- und Wasserkosten",
      legalBasis: "Art. 6 Abs. 1 lit. b DSGVO - Vertragserfüllung, HeizKG",
      dataCategories: ["verbrauchsdaten", "zaehlerstaende"],
      dataSubjects: ["mieter"],
      recipients: ["hausverwaltung", "abrechnungsdienstleister"],
      retentionPeriod: "5 Jahre nach Abrechnungszeitraum",
      technicalMeasures: ["zugriffskontrolle", "integritaetspruefung"],
      organizationalMeasures: ["ableseprotokolle", "plausibilitaetspruefung"],
      thirdCountryTransfer: false,
      isActive: true,
    },
  ];

  const defaultPolicies: schema.InsertDataRetentionPolicy[] = [
    {
      organizationId,
      dataCategory: "finanzdaten",
      retentionDays: 2557,
      legalBasis: "§132 BAO - 7 Jahre Aufbewahrungspflicht für Geschäftsunterlagen",
      autoDelete: false,
      notifyBeforeDays: 90,
    },
    {
      organizationId,
      dataCategory: "mieterdaten",
      retentionDays: 2557,
      legalBasis: "§132 BAO - 7 Jahre Aufbewahrungspflicht, Art. 17 DSGVO - Recht auf Löschung nach Fristablauf",
      autoDelete: false,
      notifyBeforeDays: 90,
    },
    {
      organizationId,
      dataCategory: "kommunikation",
      retentionDays: 1095,
      legalBasis: "Art. 17 DSGVO - Recht auf Löschung, 3 Jahre Verjährungsfrist (ABGB §1489)",
      autoDelete: false,
      notifyBeforeDays: 30,
    },
    {
      organizationId,
      dataCategory: "dokumente",
      retentionDays: 2557,
      legalBasis: "§132 BAO - 7 Jahre Aufbewahrungspflicht für Belege und Verträge",
      autoDelete: false,
      notifyBeforeDays: 90,
    },
    {
      organizationId,
      dataCategory: "verbrauchsdaten",
      retentionDays: 1825,
      legalBasis: "HeizKG - 5 Jahre Aufbewahrung von Abrechnungsunterlagen",
      autoDelete: false,
      notifyBeforeDays: 60,
    },
    {
      organizationId,
      dataCategory: "bewerberdaten",
      retentionDays: 180,
      legalBasis: "Art. 17 DSGVO - Recht auf Löschung, 6 Monate nach Abschluss des Auswahlverfahrens",
      autoDelete: true,
      notifyBeforeDays: 14,
    },
  ];

  await db.insert(schema.processingActivities).values(defaultActivities);
  await db.insert(schema.dataRetentionPolicies).values(defaultPolicies);

  return {
    seeded: true,
    activitiesCount: defaultActivities.length,
    policiesCount: defaultPolicies.length,
  };
}
