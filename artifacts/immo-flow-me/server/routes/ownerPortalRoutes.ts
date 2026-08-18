import type { Express, Request, Response, NextFunction } from "express";
import { db, rootDb, orgContext, appPool } from "../db";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, desc, inArray, isNotNull } from "drizzle-orm";
import * as schema from "@shared/schema";

/**
 * Setzt den RLS-Org-Kontext für Eigentümerportal-Anfragen mit einer reinen
 * Portal-Session (ownerPortalId). Admin-Sessions laufen bereits über
 * rlsMiddleware und brauchen diesen Wrapper nicht.
 */
export async function ownerPortalOrgMiddleware(req: Request, res: Response, next: NextFunction) {
  const ownerPortalId = (req.session as any)?.ownerPortalId;
  if (!ownerPortalId) return next();

  // Mixed Session (Admin + Portal): Selbst-Isolation auch im bestehenden
  // Org-Kontext erzwingen (siehe tenantPortalOrgMiddleware). Org-Mismatch → 401.
  const existing = orgContext.getStore();
  if (existing) {
    try {
      const [access] = await rootDb
        .select({
          organizationId: schema.ownerPortalAccess.organizationId,
          ownerId: schema.ownerPortalAccess.ownerId,
        })
        .from(schema.ownerPortalAccess)
        .where(and(
          eq(schema.ownerPortalAccess.id, ownerPortalId),
          eq(schema.ownerPortalAccess.isActive, true),
        ))
        .limit(1);
      if (!access?.organizationId || access.organizationId !== existing.organizationId) {
        return res.status(401).json({ error: "Nicht authentifiziert" });
      }
      await existing.client.query("SELECT set_config('app.current_owner', $1, true)", [access.ownerId]);
      return next();
    } catch (err) {
      return next(err);
    }
  }

  try {
    const [access] = await rootDb
      .select({
        organizationId: schema.ownerPortalAccess.organizationId,
        ownerId: schema.ownerPortalAccess.ownerId,
      })
      .from(schema.ownerPortalAccess)
      .where(and(
        eq(schema.ownerPortalAccess.id, ownerPortalId),
        eq(schema.ownerPortalAccess.isActive, true),
      ))
      .limit(1);

    if (!access?.organizationId) {
      return res.status(401).json({ error: "Nicht authentifiziert" });
    }

    const orgId = access.organizationId;
    appPool.connect().then((client) => {
      client.query("BEGIN")
        .then(() => client.query("SELECT set_config('app.current_org', $1, true)", [orgId]))
        // Selbst-Isolation: Portal-Session sieht in owner_portal_access nur die eigene Zeile.
        .then(() => client.query("SELECT set_config('app.current_owner', $1, true)", [access.ownerId]))
        .then(() => {
          const orgDb = drizzle(client as any, { schema });
          req.dbClient = client;
          req.orgDb = orgDb;
          let finished = false;
          const cleanup = () => {
            if (finished) return;
            finished = true;
            const ok = res.statusCode < 500;
            client.query(ok ? "COMMIT" : "ROLLBACK").catch(() => {}).finally(() => client.release());
          };
          res.on("finish", cleanup);
          res.on("close", cleanup);
          orgContext.run({ organizationId: orgId, db: orgDb, client }, () => next());
        })
        .catch((err) => {
          client.query("ROLLBACK").catch(() => {}).finally(() => client.release());
          next(err);
        });
    }).catch(next);
  } catch (err) {
    next(err);
  }
}

async function getOwnerContext(req: Request, res: Response) {
  const ownerPortalId = (req.session as any)?.ownerPortalId;
  if (ownerPortalId) {
    const access = await db
      .select()
      .from(schema.ownerPortalAccess)
      .where(and(
        eq(schema.ownerPortalAccess.id, ownerPortalId),
        eq(schema.ownerPortalAccess.isActive, true)
      ))
      .limit(1);

    if (access.length) {
      const owner = await db
        .select()
        .from(schema.owners)
        .where(eq(schema.owners.id, access[0].ownerId))
        .limit(1);

      if (owner.length) {
        return {
          userId: null,
          ownerId: owner[0].id,
          owner: owner[0],
          organizationId: owner[0].organizationId,
          portalAccessId: access[0].id,
          email: access[0].email,
        };
      }
    }
  }

  res.status(401).json({ error: "Nicht authentifiziert" });
  return null;
}

export function registerOwnerPortalRoutes(app: Express) {
  // Setzt app.current_org für reine Portal-Sessions (ownerPortalId).
  app.use("/api/owner-portal", ownerPortalOrgMiddleware);

  app.get("/api/owner-portal/dashboard", async (req: Request, res: Response) => {
    try {
      const ctx = await getOwnerContext(req, res);
      if (!ctx) return;

      const orgFilter = ctx.organizationId
        ? and(eq(schema.propertyOwners.ownerId, ctx.ownerId), eq(schema.properties.organizationId, ctx.organizationId))
        : eq(schema.propertyOwners.ownerId, ctx.ownerId);

      const propertyOwnerships = await db
        .select({
          propertyOwner: schema.propertyOwners,
          property: schema.properties,
        })
        .from(schema.propertyOwners)
        .innerJoin(schema.properties, eq(schema.propertyOwners.propertyId, schema.properties.id))
        .where(orgFilter);

      const propertyIds = propertyOwnerships.map(po => po.property.id);

      const unitOwnerships = propertyIds.length > 0
        ? await db
            .select()
            .from(schema.wegUnitOwners)
            .where(and(
              eq(schema.wegUnitOwners.ownerId, ctx.ownerId),
              inArray(schema.wegUnitOwners.propertyId, propertyIds)
            ))
        : [];

      let totalMeaShare = 0;
      unitOwnerships.forEach(uo => {
        totalMeaShare += parseFloat(uo.meaShare || '0');
      });

      let reserveFundTotal = 0;
      if (propertyIds.length > 0) {
        const reserveEntries = await db
          .select()
          .from(schema.wegReserveFund)
          .where(inArray(schema.wegReserveFund.propertyId, propertyIds));
        reserveEntries.forEach(entry => {
          reserveFundTotal += parseFloat(entry.amount || '0');
        });
      }

      let assemblyCount = 0;
      if (propertyIds.length > 0) {
        const assemblies = await db
          .select()
          .from(schema.wegAssemblies)
          .where(inArray(schema.wegAssemblies.propertyId, propertyIds));
        assemblyCount = assemblies.length;
      }

      res.json({
        owner: {
          id: ctx.owner.id,
          firstName: ctx.owner.firstName,
          lastName: ctx.owner.lastName,
          companyName: ctx.owner.companyName,
          email: ctx.owner.email,
          phone: ctx.owner.phone,
          mobilePhone: ctx.owner.mobilePhone,
          address: ctx.owner.address,
          city: ctx.owner.city,
          postalCode: ctx.owner.postalCode,
        },
        properties: propertyOwnerships.map(po => ({
          id: po.property.id,
          name: po.property.name,
          address: po.property.address,
          city: po.property.city,
          postalCode: po.property.postalCode,
          ownershipShare: po.propertyOwner.ownershipShare,
        })),
        unitOwnerships: unitOwnerships.map(uo => ({
          id: uo.id,
          unitId: uo.unitId,
          propertyId: uo.propertyId,
          meaShare: uo.meaShare,
          nutzwert: uo.nutzwert,
          validFrom: uo.validFrom,
          validTo: uo.validTo,
        })),
        totalMeaShare,
        reserveFundTotal,
        propertyCount: propertyOwnerships.length,
        unitCount: unitOwnerships.length,
        assemblyCount,
      });
    } catch (error) {
      console.error("Owner portal dashboard error:", error);
      res.status(500).json({ error: "Fehler beim Laden des Dashboards" });
    }
  });

  app.get("/api/owner-portal/properties", async (req: Request, res: Response) => {
    try {
      const ctx = await getOwnerContext(req, res);
      if (!ctx) return;

      const orgFilter = ctx.organizationId
        ? and(eq(schema.propertyOwners.ownerId, ctx.ownerId), eq(schema.properties.organizationId, ctx.organizationId))
        : eq(schema.propertyOwners.ownerId, ctx.ownerId);

      const propertyOwnerships = await db
        .select({
          propertyOwner: schema.propertyOwners,
          property: schema.properties,
        })
        .from(schema.propertyOwners)
        .innerJoin(schema.properties, eq(schema.propertyOwners.propertyId, schema.properties.id))
        .where(orgFilter);

      const result = [];
      for (const po of propertyOwnerships) {
        const units = await db
          .select()
          .from(schema.wegUnitOwners)
          .innerJoin(schema.units, eq(schema.wegUnitOwners.unitId, schema.units.id))
          .where(and(
            eq(schema.wegUnitOwners.ownerId, ctx.ownerId),
            eq(schema.wegUnitOwners.propertyId, po.property.id)
          ));

        result.push({
          id: po.property.id,
          name: po.property.name,
          address: po.property.address,
          city: po.property.city,
          postalCode: po.property.postalCode,
          totalUnits: po.property.totalUnits,
          totalArea: po.property.totalArea,
          ownershipShare: po.propertyOwner.ownershipShare,
          validFrom: po.propertyOwner.validFrom,
          validTo: po.propertyOwner.validTo,
          ownedUnits: units.map(u => ({
            unitId: u.units.id,
            topNummer: u.units.topNummer,
            type: u.units.type,
            flaeche: u.units.flaeche,
            nutzwert: u.units.nutzwert,
            meaShare: u.weg_unit_owners.meaShare,
          })),
        });
      }

      res.json(result);
    } catch (error) {
      console.error("Owner portal properties error:", error);
      res.status(500).json({ error: "Fehler beim Laden der Liegenschaften" });
    }
  });

  app.get("/api/owner-portal/settlements", async (req: Request, res: Response) => {
    try {
      const ctx = await getOwnerContext(req, res);
      if (!ctx) return;

      const propQuery = ctx.organizationId
        ? db.select({ propertyId: schema.propertyOwners.propertyId })
            .from(schema.propertyOwners)
            .innerJoin(schema.properties, eq(schema.propertyOwners.propertyId, schema.properties.id))
            .where(and(eq(schema.propertyOwners.ownerId, ctx.ownerId), eq(schema.properties.organizationId, ctx.organizationId)))
        : db.select({ propertyId: schema.propertyOwners.propertyId })
            .from(schema.propertyOwners)
            .where(eq(schema.propertyOwners.ownerId, ctx.ownerId));

      const propertyOwnerships = await propQuery;
      const propertyIds = propertyOwnerships.map(po => po.propertyId);

      if (!propertyIds.length) {
        return res.json([]);
      }

      const settlements = await db
        .select({
          settlement: schema.settlements,
          property: schema.properties,
        })
        .from(schema.settlements)
        .innerJoin(schema.properties, eq(schema.settlements.propertyId, schema.properties.id))
        .where(inArray(schema.settlements.propertyId, propertyIds))
        .orderBy(desc(schema.settlements.year));

      res.json(settlements.map(s => ({
        id: s.settlement.id,
        propertyId: s.settlement.propertyId,
        propertyName: s.property.name,
        year: s.settlement.year,
        status: s.settlement.status,
        gesamtausgaben: s.settlement.gesamtausgaben,
        gesamtvorschuss: s.settlement.gesamtvorschuss,
        differenz: s.settlement.differenz,
        pdfUrl: s.settlement.pdfUrl,
        createdAt: s.settlement.createdAt,
      })));
    } catch (error) {
      console.error("Owner portal settlements error:", error);
      res.status(500).json({ error: "Fehler beim Laden der Abrechnungen" });
    }
  });

  app.get("/api/owner-portal/documents", async (req: Request, res: Response) => {
    try {
      const ctx = await getOwnerContext(req, res);
      if (!ctx) return;

      const propQuery = ctx.organizationId
        ? db.select({ propertyId: schema.propertyOwners.propertyId })
            .from(schema.propertyOwners)
            .innerJoin(schema.properties, eq(schema.propertyOwners.propertyId, schema.properties.id))
            .where(and(eq(schema.propertyOwners.ownerId, ctx.ownerId), eq(schema.properties.organizationId, ctx.organizationId)))
        : db.select({ propertyId: schema.propertyOwners.propertyId })
            .from(schema.propertyOwners)
            .where(eq(schema.propertyOwners.ownerId, ctx.ownerId));

      const propertyOwnerships = await propQuery;
      const propertyIds = propertyOwnerships.map(po => po.propertyId);

      if (!propertyIds.length) {
        return res.json([]);
      }

      const documents = await db
        .select()
        .from(schema.propertyDocuments)
        .where(inArray(schema.propertyDocuments.propertyId, propertyIds))
        .orderBy(desc(schema.propertyDocuments.createdAt));

      res.json(documents.map(d => ({
        id: d.id,
        propertyId: d.propertyId,
        name: d.name,
        category: d.category,
        fileUrl: d.fileUrl,
        fileSize: d.fileSize,
        mimeType: d.mimeType,
        notes: d.notes,
        createdAt: d.createdAt,
      })));
    } catch (error) {
      console.error("Owner portal documents error:", error);
      res.status(500).json({ error: "Fehler beim Laden der Dokumente" });
    }
  });

  app.get("/api/owner-portal/assemblies", async (req: Request, res: Response) => {
    try {
      const ctx = await getOwnerContext(req, res);
      if (!ctx) return;

      const propQuery = ctx.organizationId
        ? db.select({ propertyId: schema.propertyOwners.propertyId })
            .from(schema.propertyOwners)
            .innerJoin(schema.properties, eq(schema.propertyOwners.propertyId, schema.properties.id))
            .where(and(eq(schema.propertyOwners.ownerId, ctx.ownerId), eq(schema.properties.organizationId, ctx.organizationId)))
        : db.select({ propertyId: schema.propertyOwners.propertyId })
            .from(schema.propertyOwners)
            .where(eq(schema.propertyOwners.ownerId, ctx.ownerId));

      const propertyOwnerships = await propQuery;
      const propertyIds = propertyOwnerships.map(po => po.propertyId);

      if (!propertyIds.length) {
        return res.json([]);
      }

      const assemblies = await db
        .select({
          assembly: schema.wegAssemblies,
          property: schema.properties,
        })
        .from(schema.wegAssemblies)
        .innerJoin(schema.properties, eq(schema.wegAssemblies.propertyId, schema.properties.id))
        .where(inArray(schema.wegAssemblies.propertyId, propertyIds))
        .orderBy(desc(schema.wegAssemblies.assemblyDate));

      res.json(assemblies.map(a => ({
        id: a.assembly.id,
        propertyId: a.assembly.propertyId,
        propertyName: a.property.name,
        title: a.assembly.title,
        assemblyType: a.assembly.assemblyType,
        assemblyDate: a.assembly.assemblyDate,
        location: a.assembly.location,
        status: a.assembly.status,
        protocolUrl: a.assembly.protocolUrl,
        quorumReached: a.assembly.quorumReached,
        createdAt: a.assembly.createdAt,
      })));
    } catch (error) {
      console.error("Owner portal assemblies error:", error);
      res.status(500).json({ error: "Fehler beim Laden der Versammlungen" });
    }
  });

  /**
   * GET /api/owner-portal/invalidated-votes
   * Gibt Umlaufbeschlüsse zurück, die für diese Liegenschaft von passed=true
   * auf passed=false gekippt sind (§ 24 Abs. 1 WEG 2002).
   * Nur Stimmen der eigenen Liegenschaften — Cross-Org-Isolation über
   * den Portal-Session-Kontext (getOwnerContext).
   * Polling-fähig: 30 s refetchInterval im Frontend.
   */
  app.get("/api/owner-portal/invalidated-votes", async (req: Request, res: Response) => {
    try {
      const ctx = await getOwnerContext(req, res);
      if (!ctx) return;

      const propQuery = ctx.organizationId
        ? db.select({ propertyId: schema.propertyOwners.propertyId })
            .from(schema.propertyOwners)
            .innerJoin(schema.properties, eq(schema.propertyOwners.propertyId, schema.properties.id))
            .where(and(eq(schema.propertyOwners.ownerId, ctx.ownerId), eq(schema.properties.organizationId, ctx.organizationId)))
        : db.select({ propertyId: schema.propertyOwners.propertyId })
            .from(schema.propertyOwners)
            .where(eq(schema.propertyOwners.ownerId, ctx.ownerId));

      const propertyOwnerships = await propQuery;
      const propertyIds = propertyOwnerships.map(po => po.propertyId);
      if (!propertyIds.length) return res.json([]);

      // Alle Versammlungen auf den eigenen Liegenschaften
      const assemblyRows = await db
        .select({ id: schema.wegAssemblies.id })
        .from(schema.wegAssemblies)
        .where(inArray(schema.wegAssemblies.propertyId, propertyIds));
      const assemblyIds = assemblyRows.map(a => a.id);
      if (!assemblyIds.length) return res.json([]);

      // Umlaufbeschlüsse mit gesetztem invalidation_warning
      const rows = await db
        .select({
          voteId:             schema.wegVoteResults.voteId,
          invalidationWarning: schema.wegVoteResults.invalidationWarning,
          topic:              schema.wegVotes.topic,
          assemblyTitle:      schema.wegAssemblies.title,
          propertyId:         schema.wegAssemblies.propertyId,
          propertyName:       schema.properties.name,
        })
        .from(schema.wegVoteResults)
        .innerJoin(schema.wegVotes,      eq(schema.wegVoteResults.voteId,    schema.wegVotes.id))
        .innerJoin(schema.wegAssemblies, eq(schema.wegVotes.assemblyId,      schema.wegAssemblies.id))
        .innerJoin(schema.properties,    eq(schema.wegAssemblies.propertyId, schema.properties.id))
        .where(and(
          inArray(schema.wegVotes.assemblyId, assemblyIds),
          isNotNull(schema.wegVoteResults.invalidationWarning),
        ));

      res.json(rows.map(r => ({
        voteId:             r.voteId,
        topic:              r.topic,
        assemblyTitle:      r.assemblyTitle,
        propertyId:         r.propertyId,
        propertyName:       r.propertyName,
        invalidationWarning: r.invalidationWarning,
      })));
    } catch (error) {
      console.error("Owner portal invalidated-votes error:", error);
      res.status(500).json({ error: "Fehler beim Laden der Warnmeldungen" });
    }
  });

  app.get("/api/owner-portal/budgets", async (req: Request, res: Response) => {
    try {
      const ctx = await getOwnerContext(req, res);
      if (!ctx) return;

      const propQuery = ctx.organizationId
        ? db.select({ propertyId: schema.propertyOwners.propertyId })
            .from(schema.propertyOwners)
            .innerJoin(schema.properties, eq(schema.propertyOwners.propertyId, schema.properties.id))
            .where(and(eq(schema.propertyOwners.ownerId, ctx.ownerId), eq(schema.properties.organizationId, ctx.organizationId)))
        : db.select({ propertyId: schema.propertyOwners.propertyId })
            .from(schema.propertyOwners)
            .where(eq(schema.propertyOwners.ownerId, ctx.ownerId));

      const propertyOwnerships = await propQuery;
      const propertyIds = propertyOwnerships.map(po => po.propertyId);

      if (!propertyIds.length) {
        return res.json([]);
      }

      const budgets = await db
        .select({
          budget: schema.wegBudgetPlans,
          property: schema.properties,
        })
        .from(schema.wegBudgetPlans)
        .innerJoin(schema.properties, eq(schema.wegBudgetPlans.propertyId, schema.properties.id))
        .where(inArray(schema.wegBudgetPlans.propertyId, propertyIds))
        .orderBy(desc(schema.wegBudgetPlans.year));

      res.json(budgets.map(b => ({
        id: b.budget.id,
        propertyId: b.budget.propertyId,
        propertyName: b.property.name,
        year: b.budget.year,
        totalAmount: b.budget.totalAmount,
        reserveContribution: b.budget.reserveContribution,
        managementFee: b.budget.managementFee,
        status: b.budget.status,
        approvedAt: b.budget.approvedAt,
        createdAt: b.budget.createdAt,
      })));
    } catch (error) {
      console.error("Owner portal budgets error:", error);
      res.status(500).json({ error: "Fehler beim Laden der Wirtschaftspläne" });
    }
  });
}
