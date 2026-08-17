import { Router, Request, Response } from "express";
import { db } from "../db";
import { eq, and, sql, inArray, gte, lte } from "drizzle-orm";
import * as schema from "../../shared/schema";
import { isAuthenticated, requireRole, getProfileFromSession, snakeToCamel, objectToSnakeCase } from "./helpers";
import { storage } from "../storage";

const router = Router();

router.post("/api/bulk/invoices/preview", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res: Response) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) {
      return res.status(403).json({ error: "Keine Organisation zugewiesen" });
    }
    const body = snakeToCamel(req.body);
    const { propertyId, year, month } = body;
    if (!propertyId || !year || !month) {
      return res.status(400).json({ error: "propertyId, year und month sind erforderlich" });
    }

    const property = await db.select().from(schema.properties)
      .where(and(eq(schema.properties.id, propertyId), eq(schema.properties.organizationId, profile.organizationId)))
      .limit(1);
    if (!property.length) return res.status(404).json({ error: "Liegenschaft nicht gefunden" });

    const unitsData = await db.select().from(schema.units).where(eq(schema.units.propertyId, propertyId));
    const unitIds = unitsData.map(u => u.id);
    if (!unitIds.length) return res.json({ tenants: [], existing: 0 });

    const tenantsData = await db.select().from(schema.tenants)
      .where(and(inArray(schema.tenants.unitId, unitIds), eq(schema.tenants.status, 'aktiv')));

    const existingInvoices = await db.select().from(schema.monthlyInvoices)
      .where(and(
        inArray(schema.monthlyInvoices.tenantId, tenantsData.map(t => t.id)),
        eq(schema.monthlyInvoices.year, year),
        eq(schema.monthlyInvoices.month, month)
      ));
    const existingSet = new Set(existingInvoices.map(i => i.tenantId));

    const unitMap = new Map(unitsData.map(u => [u.id, u]));
    const preview = tenantsData.map(t => {
      const unit = unitMap.get(t.unitId);
      const grundmiete = Number(t.grundmiete || 0);
      const betriebskosten = Number((t as any).betriebskosten || 0);
      const heizungskosten = Number((t as any).heizungskosten || 0);
      const gesamtbetrag = grundmiete + betriebskosten + heizungskosten;
      return {
        tenant_id: t.id,
        tenant_name: `${t.firstName || ''} ${t.lastName || ''}`.trim(),
        unit_number: unit?.topNummer || '-',
        betrag: gesamtbetrag,
        already_exists: existingSet.has(t.id),
      };
    });

    res.json({
      tenants: preview,
      existing: existingInvoices.length,
      property_name: property[0].name,
    });
  } catch (error) {
    console.error("Error previewing bulk invoices:", error);
    res.status(500).json({ error: "Fehler bei der Vorschau" });
  }
});

router.post("/api/bulk/invoices", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res: Response) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) {
      return res.status(403).json({ error: "Keine Organisation zugewiesen" });
    }
    const body = snakeToCamel(req.body);
    const { propertyId, year, month } = body;
    if (!propertyId || !year || !month) {
      return res.status(400).json({ error: "propertyId, year und month sind erforderlich" });
    }

    const property = await db.select().from(schema.properties)
      .where(and(eq(schema.properties.id, propertyId), eq(schema.properties.organizationId, profile.organizationId)))
      .limit(1);
    if (!property.length) return res.status(404).json({ error: "Liegenschaft nicht gefunden" });

    const unitsData = await db.select().from(schema.units).where(eq(schema.units.propertyId, propertyId));
    const unitIds = unitsData.map(u => u.id);
    if (!unitIds.length) return res.json({ created: 0, errors: [] });

    const tenantsData = await db.select().from(schema.tenants)
      .where(and(inArray(schema.tenants.unitId, unitIds), eq(schema.tenants.status, 'aktiv')));

    const existingInvoices = await db.select().from(schema.monthlyInvoices)
      .where(and(
        inArray(schema.monthlyInvoices.tenantId, tenantsData.map(t => t.id)),
        eq(schema.monthlyInvoices.year, year),
        eq(schema.monthlyInvoices.month, month)
      ));
    const existingSet = new Set(existingInvoices.map(i => i.tenantId));

    const unitMap = new Map(unitsData.map(u => [u.id, u]));
    let created = 0;
    const errors: string[] = [];
    const dueDate = new Date(year, month - 1, 5).toISOString().split('T')[0];

    for (const tenant of tenantsData) {
      try {
        if (existingSet.has(tenant.id)) continue;

        const unit = unitMap.get(tenant.unitId);
        if (!unit) continue;

        const grundmiete = Number(tenant.grundmiete || 0);
        const betriebskosten = Number((tenant as any).betriebskosten || 0);
        const heizungskosten = Number((tenant as any).heizungskosten || 0);

        const isCommercial = ['geschaeft', 'garage', 'stellplatz', 'lager'].includes((unit.type || '').toLowerCase());
        const ustSatzMiete = isCommercial ? 20 : 10;
        const ustSatzBk = isCommercial ? 20 : 10;
        const ustSatzHeizung = 20;

        const ustMiete = grundmiete - (grundmiete / (1 + ustSatzMiete / 100));
        const ustBk = betriebskosten - (betriebskosten / (1 + ustSatzBk / 100));
        const ustHk = heizungskosten - (heizungskosten / (1 + ustSatzHeizung / 100));
        const ust = Math.round((ustMiete + ustBk + ustHk) * 100) / 100;

        const gesamtbetrag = grundmiete + betriebskosten + heizungskosten;

        await db.insert(schema.monthlyInvoices).values({
          tenantId: tenant.id,
          unitId: unit.id,
          year,
          month,
          grundmiete: grundmiete.toString(),
          betriebskosten: betriebskosten.toString(),
          heizungskosten: heizungskosten.toString(),
          gesamtbetrag: gesamtbetrag.toString(),
          ust: ust.toString(),
          ustSatzMiete: ustSatzMiete.toString(),
          ustSatzBk: ustSatzBk.toString(),
          ustSatzHeizung: ustSatzHeizung.toString(),
          status: 'offen',
          faelligAm: dueDate,
          vortragMiete: '0',
          vortragBk: '0',
          vortragHk: '0',
          vortragSonstige: '0',
        });
        created++;
      } catch (err: any) {
        const tenantName = `${tenant.firstName || ''} ${tenant.lastName || ''}`.trim();
        errors.push(`${tenantName}: ${err.message}`);
      }
    }

    res.json({ created, skipped: existingSet.size, errors });
  } catch (error) {
    console.error("Error creating bulk invoices:", error);
    res.status(500).json({ error: "Fehler bei der Massenerstellung" });
  }
});

router.post("/api/bulk/notifications", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res: Response) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) {
      return res.status(403).json({ error: "Keine Organisation zugewiesen" });
    }
    const body = snakeToCamel(req.body);
    const { propertyId, status, subject, body: emailBody } = body;

    if (!subject || !emailBody) {
      return res.status(400).json({ error: "Betreff und Nachricht sind erforderlich" });
    }

    let tenantsData = await storage.getTenantsByOrganization(profile.organizationId);

    if (propertyId) {
      const unitsData = await db.select().from(schema.units).where(eq(schema.units.propertyId, propertyId));
      const unitIds = new Set(unitsData.map(u => u.id));
      tenantsData = tenantsData.filter(t => unitIds.has(t.unitId));
    }

    if (status && status !== 'alle') {
      tenantsData = tenantsData.filter(t => t.status === status);
    }

    const tenantsWithEmail = tenantsData.filter(t => t.email);

    let sent = 0;
    let failed = 0;
    const failedDetails: string[] = [];

    try {
      const { sendEmail } = await import("../lib/resend");
      for (const tenant of tenantsWithEmail) {
        try {
          const tenantName = `${tenant.firstName || ''} ${tenant.lastName || ''}`.trim();
          const personalizedBody = emailBody
            .replace(/\{name\}/g, tenantName)
            .replace(/\{vorname\}/g, tenant.firstName || '')
            .replace(/\{nachname\}/g, tenant.lastName || '');

          await sendEmail({
            to: tenant.email!,
            subject,
            html: `<div style="font-family: Arial, sans-serif;">${personalizedBody.replace(/\n/g, '<br/>')}</div>`,
          });
          sent++;
        } catch (err: any) {
          failed++;
          failedDetails.push(`${tenant.firstName} ${tenant.lastName}: ${err.message}`);
        }
      }
    } catch (err: any) {
      return res.status(500).json({ error: "E-Mail-Service nicht verfügbar: " + err.message });
    }

    res.json({ sent, failed, total: tenantsWithEmail.length, errors: failedDetails });
  } catch (error) {
    console.error("Error sending bulk notifications:", error);
    res.status(500).json({ error: "Fehler beim Massenversand" });
  }
});

router.post("/api/bulk/notifications/preview", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res: Response) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) {
      return res.status(403).json({ error: "Keine Organisation zugewiesen" });
    }
    const body = snakeToCamel(req.body);
    const { propertyId, status } = body;

    let tenantsData = await storage.getTenantsByOrganization(profile.organizationId);

    if (propertyId) {
      const unitsData = await db.select().from(schema.units).where(eq(schema.units.propertyId, propertyId));
      const unitIds = new Set(unitsData.map(u => u.id));
      tenantsData = tenantsData.filter(t => unitIds.has(t.unitId));
    }

    if (status && status !== 'alle') {
      tenantsData = tenantsData.filter(t => t.status === status);
    }

    const withEmail = tenantsData.filter(t => t.email).length;
    const withoutEmail = tenantsData.filter(t => !t.email).length;

    res.json({ total: tenantsData.length, withEmail, withoutEmail });
  } catch (error) {
    console.error("Error previewing notifications:", error);
    res.status(500).json({ error: "Fehler bei der Vorschau" });
  }
});

router.post("/api/bulk/export", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res: Response) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) {
      return res.status(403).json({ error: "Keine Organisation zugewiesen" });
    }
    const body = snakeToCamel(req.body);
    const { types, propertyId, dateFrom, dateTo, format: exportFormat } = body;

    if (!types || !types.length) {
      return res.status(400).json({ error: "Mindestens ein Exporttyp erforderlich" });
    }

    const csvSections: string[] = [];

    if (types.includes('mieterliste')) {
      let tenantsData = await storage.getTenantsByOrganization(profile.organizationId);
      if (propertyId) {
        const unitsData = await db.select().from(schema.units).where(eq(schema.units.propertyId, propertyId));
        const unitIds = new Set(unitsData.map(u => u.id));
        tenantsData = tenantsData.filter(t => unitIds.has(t.unitId));
      }
      csvSections.push('=== MIETERLISTE ===');
      csvSections.push('Vorname;Nachname;E-Mail;Telefon;Status;Grundmiete;Einheit');
      for (const t of tenantsData) {
        csvSections.push(`${t.firstName || ''};${t.lastName || ''};${t.email || ''};${t.phone || ''};${t.status || ''};${t.grundmiete || '0'};${t.unitId || ''}`);
      }
      csvSections.push('');
    }

    if (types.includes('objektliste')) {
      let propertiesData = await db.select().from(schema.properties)
        .where(eq(schema.properties.organizationId, profile.organizationId));
      if (propertyId) {
        propertiesData = propertiesData.filter(p => p.id === propertyId);
      }
      csvSections.push('=== OBJEKTLISTE ===');
      csvSections.push('Name;Adresse;Stadt;PLZ;Typ');
      for (const p of propertiesData) {
        csvSections.push(`${p.name || ''};${p.address || ''};${p.city || ''};${(p as any).postalCode || ''};${p.type || ''}`);
      }
      csvSections.push('');
    }

    if (types.includes('zahlungen')) {
      let conditions: any[] = [];
      const allTenants = await storage.getTenantsByOrganization(profile.organizationId);
      const tenantIds = allTenants.map(t => t.id);
      if (!tenantIds.length) {
        csvSections.push('=== ZAHLUNGEN ===');
        csvSections.push('Keine Zahlungen vorhanden');
        csvSections.push('');
      } else {
        let payments = await db.select().from(schema.payments)
          .where(inArray(schema.payments.tenantId, tenantIds));
        if (dateFrom) payments = payments.filter(p => (p as any).paymentDate >= dateFrom);
        if (dateTo) payments = payments.filter(p => (p as any).paymentDate <= dateTo);
        csvSections.push('=== ZAHLUNGEN ===');
        csvSections.push('Mieter-ID;Betrag;Datum;Typ;Referenz');
        for (const p of payments) {
          csvSections.push(`${p.tenantId};${p.amount || '0'};${(p as any).paymentDate || ''};${(p as any).paymentType || ''};${(p as any).reference || ''}`);
        }
        csvSections.push('');
      }
    }

    if (types.includes('rechnungen')) {
      const allTenants = await storage.getTenantsByOrganization(profile.organizationId);
      let tenantIds = allTenants.map(t => t.id);
      if (propertyId) {
        const unitsData = await db.select().from(schema.units).where(eq(schema.units.propertyId, propertyId));
        const unitIds = new Set(unitsData.map(u => u.id));
        const filteredTenants = allTenants.filter(t => unitIds.has(t.unitId));
        tenantIds = filteredTenants.map(t => t.id);
      }
      if (!tenantIds.length) {
        csvSections.push('=== RECHNUNGEN ===');
        csvSections.push('Keine Rechnungen vorhanden');
        csvSections.push('');
      } else {
        let invoices = await db.select().from(schema.monthlyInvoices)
          .where(inArray(schema.monthlyInvoices.tenantId, tenantIds));
        if (dateFrom) {
          const fromDate = new Date(dateFrom);
          invoices = invoices.filter(i => i.year > fromDate.getFullYear() || (i.year === fromDate.getFullYear() && i.month >= fromDate.getMonth() + 1));
        }
        if (dateTo) {
          const toDate = new Date(dateTo);
          invoices = invoices.filter(i => i.year < toDate.getFullYear() || (i.year === toDate.getFullYear() && i.month <= toDate.getMonth() + 1));
        }
        csvSections.push('=== RECHNUNGEN ===');
        csvSections.push('Mieter-ID;Jahr;Monat;Grundmiete;Betriebskosten;Heizungskosten;Gesamt;Status;Fällig am');
        for (const inv of invoices) {
          csvSections.push(`${inv.tenantId};${inv.year};${inv.month};${inv.grundmiete};${inv.betriebskosten};${inv.heizungskosten};${inv.gesamtbetrag};${inv.status};${inv.faelligAm || ''}`);
        }
        csvSections.push('');
      }
    }

    const csvContent = csvSections.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=export_${new Date().toISOString().split('T')[0]}.csv`);
    res.send('\uFEFF' + csvContent);
  } catch (error) {
    console.error("Error generating bulk export:", error);
    res.status(500).json({ error: "Fehler beim Export" });
  }
});

export default router;
