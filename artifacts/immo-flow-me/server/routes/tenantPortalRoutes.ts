import type { Express, Request, Response, NextFunction } from "express";
import { db, rootDb, orgContext, appPool } from "../db";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, desc, asc } from "drizzle-orm";
import * as schema from "@shared/schema";
import { decryptIbanFields } from "../lib/fieldEncryption";

/**
 * Setzt den RLS-Org-Kontext für Mieterportal-Anfragen mit einer reinen
 * Portal-Session (tenantPortalId). Admin-Sessions laufen bereits über
 * rlsMiddleware und brauchen diesen Wrapper nicht.
 *
 * Ablauf:
 *   1. tenant_portal_access (nicht RLS-geschützt) per rootDb lesen → org_id
 *   2. Datenbankverbindung prüfen, app.current_org setzen
 *   3. AsyncLocalStorage-Kontext starten → db-Proxy zeigt auf RLS-Verbindung
 */
export async function tenantPortalOrgMiddleware(req: Request, res: Response, next: NextFunction) {
  const tenantPortalId = (req.session as any)?.tenantPortalId;
  if (!tenantPortalId) return next();

  // Mixed Session (Admin + Portal): rlsMiddleware hat bereits einen Org-Kontext
  // aufgebaut. Selbst-Isolation trotzdem erzwingen: app.current_tenant auf der
  // bestehenden Transaktions-Verbindung setzen (RLS auf tenant_portal_access
  // greift dann auf die eigene Zeile). Org-Mismatch → 401 (fail-closed).
  const existing = orgContext.getStore();
  if (existing) {
    try {
      const [access] = await rootDb
        .select({
          organizationId: schema.tenantPortalAccess.organizationId,
          tenantId: schema.tenantPortalAccess.tenantId,
        })
        .from(schema.tenantPortalAccess)
        .where(and(
          eq(schema.tenantPortalAccess.id, tenantPortalId),
          eq(schema.tenantPortalAccess.isActive, true),
        ))
        .limit(1);
      if (!access?.organizationId || access.organizationId !== existing.organizationId) {
        return res.status(401).json({ error: "Nicht authentifiziert" });
      }
      await existing.client.query("SELECT set_config('app.current_tenant', $1, true)", [access.tenantId]);
      return next();
    } catch (err) {
      return next(err);
    }
  }

  try {
    const [access] = await rootDb
      .select({
        organizationId: schema.tenantPortalAccess.organizationId,
        tenantId: schema.tenantPortalAccess.tenantId,
      })
      .from(schema.tenantPortalAccess)
      .where(and(
        eq(schema.tenantPortalAccess.id, tenantPortalId),
        eq(schema.tenantPortalAccess.isActive, true),
      ))
      .limit(1);

    if (!access?.organizationId) {
      return res.status(401).json({ error: "Nicht authentifiziert" });
    }

    const orgId = access.organizationId;
    appPool.connect().then((client) => {
      client.query("BEGIN")
        .then(() => client.query("SELECT set_config('app.current_org', $1, true)", [orgId]))
        // Selbst-Isolation: Portal-Session sieht in tenant_portal_access nur die eigene Zeile.
        .then(() => client.query("SELECT set_config('app.current_tenant', $1, true)", [access.tenantId]))
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

async function getTenantContext(req: Request, res: Response) {
  const tenantPortalId = (req.session as any)?.tenantPortalId;
  if (tenantPortalId) {
    const access = await db
      .select()
      .from(schema.tenantPortalAccess)
      .where(and(
        eq(schema.tenantPortalAccess.id, tenantPortalId),
        eq(schema.tenantPortalAccess.isActive, true)
      ))
      .limit(1);

    if (access.length) {
      const tenant = await db
        .select()
        .from(schema.tenants)
        .where(eq(schema.tenants.id, access[0].tenantId))
        .limit(1);

      if (tenant.length) {
        return {
          userId: null,
          tenantId: tenant[0].id,
          tenant: decryptIbanFields(tenant[0]),
          portalAccessId: access[0].id,
          email: access[0].email,
        };
      }
    }
  }

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

  const access = await db
    .select()
    .from(schema.tenantPortalAccess)
    .where(and(
      eq(schema.tenantPortalAccess.email, profile[0].email),
      eq(schema.tenantPortalAccess.isActive, true)
    ))
    .limit(1);

  if (!access.length) {
    res.status(403).json({ error: "Kein aktiver Mieterportal-Zugang" });
    return null;
  }

  const tenant = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, access[0].tenantId))
    .limit(1);

  if (!tenant.length) {
    res.status(404).json({ error: "Mieterdaten nicht gefunden" });
    return null;
  }

  return {
    userId,
    tenantId: tenant[0].id,
    tenant: decryptIbanFields(tenant[0]),
    portalAccessId: access[0].id,
    email: profile[0].email,
  };
}

export function registerTenantPortalRoutes(app: Express) {
  // Muss vor allen anderen /api/tenant-portal/*-Routen registriert sein.
  // Setzt app.current_org für reine Portal-Sessions (tenantPortalId) analog
  // zu rlsMiddleware für Admin-Sessions.
  app.use("/api/tenant-portal", tenantPortalOrgMiddleware);

  app.get("/api/tenant-portal/dashboard", async (req: Request, res: Response) => {
    try {
      const ctx = await getTenantContext(req, res);
      if (!ctx) return;

      const unit = await db
        .select()
        .from(schema.units)
        .where(eq(schema.units.id, ctx.tenant.unitId))
        .limit(1);

      let property: any = null;
      if (unit.length) {
        const props = await db
          .select()
          .from(schema.properties)
          .where(eq(schema.properties.id, unit[0].propertyId))
          .limit(1);
        if (props.length) property = props[0];
      }

      const invoices = await db
        .select()
        .from(schema.monthlyInvoices)
        .where(eq(schema.monthlyInvoices.tenantId, ctx.tenantId))
        .orderBy(desc(schema.monthlyInvoices.year), desc(schema.monthlyInvoices.month))
        .limit(6);

      const payments = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.tenantId, ctx.tenantId))
        .orderBy(desc(schema.payments.buchungsDatum))
        .limit(5);

      const leases = await db
        .select()
        .from(schema.leases)
        .where(eq(schema.leases.tenantId, ctx.tenantId))
        .orderBy(desc(schema.leases.startDate))
        .limit(1);

      const openInvoices = invoices.filter(i => i.status !== 'bezahlt' && i.status !== 'storniert');
      const openBalance = openInvoices.reduce((sum, i) => sum + parseFloat(i.gesamtbetrag || '0'), 0);

      const docCount = await db
        .select()
        .from(schema.tenantDocuments)
        .where(eq(schema.tenantDocuments.tenantId, ctx.tenantId));

      res.json({
        tenant: {
          id: ctx.tenant.id,
          firstName: ctx.tenant.firstName,
          lastName: ctx.tenant.lastName,
          email: ctx.tenant.email,
          phone: ctx.tenant.phone,
          mobilePhone: ctx.tenant.mobilePhone,
          mietbeginn: ctx.tenant.mietbeginn,
          mietende: ctx.tenant.mietende,
          grundmiete: ctx.tenant.grundmiete,
          betriebskostenVorschuss: ctx.tenant.betriebskostenVorschuss,
          heizkostenVorschuss: ctx.tenant.heizkostenVorschuss,
          wasserkostenVorschuss: ctx.tenant.wasserkostenVorschuss,
          kaution: ctx.tenant.kaution,
          kautionBezahlt: ctx.tenant.kautionBezahlt,
        },
        unit: unit.length ? {
          id: unit[0].id,
          topNummer: unit[0].topNummer,
          typ: unit[0].typ,
          flaeche: unit[0].flaeche,
          zimmer: unit[0].zimmer,
        } : null,
        property: property ? {
          id: property.id,
          name: property.name,
          address: property.address,
          plz: property.plz,
          ort: property.ort,
        } : null,
        lease: leases.length ? {
          startDate: leases[0].startDate,
          endDate: leases[0].endDate,
          grundmiete: leases[0].grundmiete,
          betriebskostenVorschuss: leases[0].betriebskostenVorschuss,
          heizkostenVorschuss: leases[0].heizkostenVorschuss,
          status: leases[0].status,
        } : null,
        recentInvoices: invoices.map(i => ({
          id: i.id,
          year: i.year,
          month: i.month,
          grundmiete: i.grundmiete,
          betriebskosten: i.betriebskosten,
          gesamtbetrag: i.gesamtbetrag,
          status: i.status,
          faelligkeitsDatum: i.faelligkeitsDatum,
        })),
        recentPayments: payments.map(p => ({
          id: p.id,
          betrag: p.betrag,
          buchungsDatum: p.buchungsDatum,
          paymentType: p.paymentType,
          verwendungszweck: p.verwendungszweck,
        })),
        openBalance,
        openInvoiceCount: openInvoices.length,
        documentCount: docCount.length,
      });
    } catch (error) {
      console.error("Tenant portal dashboard error:", error);
      res.status(500).json({ error: "Fehler beim Laden des Dashboards" });
    }
  });

  app.get("/api/tenant-portal/invoices", async (req: Request, res: Response) => {
    try {
      const ctx = await getTenantContext(req, res);
      if (!ctx) return;

      const { year, status } = req.query;
      const conditions: any[] = [eq(schema.monthlyInvoices.tenantId, ctx.tenantId)];
      if (year) conditions.push(eq(schema.monthlyInvoices.year, parseInt(year as string)));
      if (status && status !== 'alle') conditions.push(eq(schema.monthlyInvoices.status, status as string));

      const invoices = await db
        .select()
        .from(schema.monthlyInvoices)
        .where(conditions.length > 1 ? and(...conditions) : conditions[0])
        .orderBy(desc(schema.monthlyInvoices.year), desc(schema.monthlyInvoices.month));

      const safeInvoices = invoices.map(i => ({
        id: i.id,
        year: i.year,
        month: i.month,
        grundmiete: i.grundmiete,
        betriebskosten: i.betriebskosten,
        heizungskosten: i.heizungskosten,
        wasserkosten: i.wasserkosten,
        ustSatzMiete: i.ustSatzMiete,
        ustSatzBk: i.ustSatzBk,
        ust: i.ust,
        gesamtbetrag: i.gesamtbetrag,
        status: i.status,
        faelligkeitsDatum: i.faelligkeitsDatum,
        rechnungsNummer: i.rechnungsNummer,
        createdAt: i.createdAt,
      }));

      res.json(safeInvoices);
    } catch (error) {
      console.error("Tenant portal invoices error:", error);
      res.status(500).json({ error: "Fehler beim Laden der Vorschreibungen" });
    }
  });

  app.get("/api/tenant-portal/payments", async (req: Request, res: Response) => {
    try {
      const ctx = await getTenantContext(req, res);
      if (!ctx) return;

      const payments = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.tenantId, ctx.tenantId))
        .orderBy(desc(schema.payments.buchungsDatum));

      const safePayments = payments.map(p => ({
        id: p.id,
        betrag: p.betrag,
        buchungsDatum: p.buchungsDatum,
        paymentType: p.paymentType,
        verwendungszweck: p.verwendungszweck,
        createdAt: p.createdAt,
      }));

      res.json(safePayments);
    } catch (error) {
      console.error("Tenant portal payments error:", error);
      res.status(500).json({ error: "Fehler beim Laden der Zahlungen" });
    }
  });

  app.get("/api/tenant-portal/documents", async (req: Request, res: Response) => {
    try {
      const ctx = await getTenantContext(req, res);
      if (!ctx) return;

      const documents = await db
        .select()
        .from(schema.tenantDocuments)
        .where(eq(schema.tenantDocuments.tenantId, ctx.tenantId))
        .orderBy(desc(schema.tenantDocuments.createdAt));

      const safeDocuments = documents.map(d => ({
        id: d.id,
        name: d.name,
        category: d.category,
        fileUrl: d.fileUrl,
        fileSize: d.fileSize,
        mimeType: d.mimeType,
        notes: d.notes,
        createdAt: d.createdAt,
      }));

      res.json(safeDocuments);
    } catch (error) {
      console.error("Tenant portal documents error:", error);
      res.status(500).json({ error: "Fehler beim Laden der Dokumente" });
    }
  });

  app.get("/api/tenant-portal/lease", async (req: Request, res: Response) => {
    try {
      const ctx = await getTenantContext(req, res);
      if (!ctx) return;

      const leases = await db
        .select()
        .from(schema.leases)
        .where(eq(schema.leases.tenantId, ctx.tenantId))
        .orderBy(desc(schema.leases.startDate));

      const safeLeases = leases.map(l => ({
        id: l.id,
        startDate: l.startDate,
        endDate: l.endDate,
        grundmiete: l.grundmiete,
        betriebskostenVorschuss: l.betriebskostenVorschuss,
        heizkostenVorschuss: l.heizkostenVorschuss,
        kaution: l.kaution,
        kautionBezahlt: l.kautionBezahlt,
        status: l.status,
        createdAt: l.createdAt,
      }));

      res.json(safeLeases);
    } catch (error) {
      console.error("Tenant portal lease error:", error);
      res.status(500).json({ error: "Fehler beim Laden der Mietverträge" });
    }
  });

  app.get("/api/tenant-portal/check-access", async (req: Request, res: Response) => {
    try {
      const ctx = await getTenantContext(req, res);
      if (!ctx) return;
      res.json({ hasAccess: true, tenantId: ctx.tenantId });
    } catch (error) {
      res.json({ hasAccess: false });
    }
  });
}
