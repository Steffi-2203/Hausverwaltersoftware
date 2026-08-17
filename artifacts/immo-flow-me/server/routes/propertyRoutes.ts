import { Router, Request, Response } from "express";
import crypto from "crypto";
import { db } from "../db";
import { eq, and, sql, desc, asc, isNull, count } from "drizzle-orm";
import * as schema from "@shared/schema";
import { insertPropertySchema } from "@shared/schema";
import { storage } from "../storage";
import { isAuthenticated, requireRole, requireMutationAccess, getUserRoles, getProfileFromSession, isTester, maskPersonalData } from "./helpers";
import { verifyPropertyOwnership, verifyUnitOwnership } from "../lib/ownershipCheck";

const router = Router();

function snakeToCamel(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(snakeToCamel);
  if (typeof obj !== 'object') return obj;
  
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = snakeToCamel(value);
  }
  return result;
}

function parsePagination(req: Request) {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 100));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

// ===== Properties CRUD =====

router.get("/api/properties", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const roles = await getUserRoles(req);
    const orgId = profile?.organizationId;
    if (!orgId) return res.json({ data: [], pagination: { page: 1, limit: 100, total: 0 } });

    const { page, limit, offset } = parsePagination(req);

    const whereCondition = and(
      eq(schema.properties.organizationId, orgId),
      isNull(schema.properties.deletedAt)
    );

    const [props, [{ total }]] = await Promise.all([
      db.select().from(schema.properties)
        .where(whereCondition)
        .orderBy(asc(schema.properties.name))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(schema.properties)
        .where(whereCondition),
    ]);

    let maskedProps = isTester(roles) ? maskPersonalData(props) : props;

    const allUnits = await storage.getUnitsByOrganization(orgId);
    const allTenants = await storage.getTenantsByOrganization(orgId);

    const enrichedProps = maskedProps.map((prop: any) => {
      const propertyUnits = allUnits.filter(u => u.propertyId === prop.id);
      const totalQm = propertyUnits.reduce((sum: number, u: any) => sum + (Number(u.flaeche || u.qm) || 0), 0);

      const rentedUnits = propertyUnits.filter(unit => {
        return allTenants.some(t =>
          t.unitId === unit.id &&
          t.status === 'aktiv'
        );
      }).length;

      return {
        ...prop,
        total_units: propertyUnits.length,
        rented_units: rentedUnits,
        total_qm: totalQm,
      };
    });

    res.json({ data: enrichedProps, pagination: { page, limit, total } });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch properties" });
  }
});

router.get("/api/properties/:id", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const property = await storage.getProperty(req.params.id);
    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }
    if (property.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    res.json(property);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch property" });
  }
});

router.get("/api/properties/:propertyId/units", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });
    const isOwner = await verifyPropertyOwnership(req.params.propertyId, profile.organizationId);
    if (!isOwner) return res.status(403).json({ error: "Zugriff verweigert" });
    const property = await storage.getProperty(req.params.propertyId);
    if (property && property.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    const units = await storage.getUnitsByProperty(req.params.propertyId);
    
    const unitsWithMea = units.map(unit => ({
      ...unit,
      mea: unit.nutzwert,
      qm: unit.flaeche,
      vs_personen: unit.vsPersonen,
    }));
    
    if (req.query.includeTenants === 'true') {
      const allTenants = await storage.getTenantsByOrganization(profile?.organizationId);
      const enrichedUnits = unitsWithMea.map(unit => ({
        ...unit,
        tenants: allTenants.filter(t => t.unitId === unit.id)
      }));
      return res.json(enrichedUnits);
    }
    
    res.json(unitsWithMea);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch units" });
  }
});

router.post("/api/properties", isAuthenticated, requireRole('property_manager'), async (req: any, res) => {
  try {
    const userEmail = req.session?.email;
    const profile = await storage.getProfileByEmail(userEmail);
    
    if (!profile) {
      return res.status(403).json({ error: "Profile not found" });
    }
    
    const normalizedBody = snakeToCamel(req.body);
    const rawUnits = normalizedBody.einheitenAnzahl ?? normalizedBody.numberOfUnits ?? 0;
    const numberOfUnits = typeof rawUnits === 'number' ? rawUnits : parseInt(rawUnits, 10);
    
    if (rawUnits !== 0 && isNaN(numberOfUnits)) {
      return res.status(400).json({ error: "Ungültige Anzahl Einheiten" });
    }
    const validUnits = numberOfUnits > 0 ? Math.min(numberOfUnits, 100) : 0;
    
    const validationResult = insertPropertySchema.safeParse({
      ...normalizedBody,
      organizationId: profile.organizationId,
    });
    if (!validationResult.success) {
      return res.status(400).json({ error: "Validation failed", details: validationResult.error.flatten() });
    }
    
    const propertyId = normalizedBody.id || crypto.randomUUID();
    const property = await storage.createProperty({
      id: propertyId,
      ...validationResult.data,
    });
    
    await storage.createPropertyManager({
      userId: profile.id,
      propertyId: property.id,
    });
    
    if (validUnits > 0) {
      const unitData = [];
      for (let i = 1; i <= validUnits; i++) {
        unitData.push({
          propertyId: property.id,
          topNummer: `Top ${i}`,
          type: 'wohnung' as const,
          status: 'leerstand' as const,
          flaeche: '0',
          stockwerk: i,
        });
      }
      await db.insert(schema.units).values(unitData);
    }
    
    res.json(property);
  } catch (error) {
    console.error("Create property error:", error);
    res.status(500).json({ error: "Failed to create property" });
  }
});

router.patch("/api/properties/:id", isAuthenticated, requireRole('property_manager'), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const existingProperty = await storage.getProperty(req.params.id);
    if (!existingProperty) {
      return res.status(404).json({ error: "Property not found" });
    }
    if (existingProperty.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    const normalizedBody = snakeToCamel(req.body);
    // organizationId darf nie per PATCH geändert werden — verhindert Property-Transfer zu fremder Org
    delete normalizedBody.organizationId;
    delete normalizedBody.organization_id;
    const validationResult = insertPropertySchema.partial().safeParse(normalizedBody);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Validation failed", details: validationResult.error.flatten() });
    }
    // Sicherheitshalber: organizationId aus validierten Daten entfernen (falls Schema sie erlaubt)
    const { organizationId: _dropped, ...safeData } = validationResult.data as any;
    const property = await storage.updateProperty(req.params.id, safeData);
    res.json(property);
  } catch (error) {
    res.status(500).json({ error: "Failed to update property" });
  }
});

router.delete("/api/properties/:id", isAuthenticated, requireRole('property_manager'), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const existingProperty = await storage.getProperty(req.params.id);
    if (!existingProperty) {
      return res.status(404).json({ error: "Property not found" });
    }
    if (existingProperty.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    await storage.deleteProperty(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete property" });
  }
});

// ===== Property Managers =====

router.post("/api/property-managers", isAuthenticated, requireRole('property_manager'), async (req: any, res) => {
  try {
    const userEmail = req.session?.email;
    const profile = await storage.getProfileByEmail(userEmail);
    
    if (!profile) {
      return res.status(403).json({ error: "Profile not found" });
    }
    if (!profile.organizationId) {
      return res.status(403).json({ error: "Keine Organisation zugeordnet" });
    }

    const normalizedBody = snakeToCamel(req.body);
    const targetPropertyId = normalizedBody.propertyId;

    // Org-Isolationscheck: Property muss zur Session-Org gehören
    const isOwner = await verifyPropertyOwnership(targetPropertyId, profile.organizationId);
    if (!isOwner) return res.status(403).json({ error: "Zugriff verweigert" });

    const result = await storage.createPropertyManager({
      userId: profile.id,
      propertyId: targetPropertyId,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to assign property" });
  }
});

router.delete("/api/property-managers/:propertyId", isAuthenticated, requireRole('property_manager'), async (req: any, res) => {
  try {
    const userEmail = req.session?.email;
    const profile = await storage.getProfileByEmail(userEmail);
    
    if (!profile) {
      return res.status(403).json({ error: "Profile not found" });
    }
    if (!profile.organizationId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });
    const isOwner = await verifyPropertyOwnership(req.params.propertyId, profile.organizationId);
    if (!isOwner) return res.status(403).json({ error: "Zugriff verweigert" });
    
    await storage.deletePropertyManager(profile.id, req.params.propertyId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to unassign property" });
  }
});

// ===== Property Settlements =====

router.get("/api/properties/:propertyId/settlements", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });
    const isOwner = await verifyPropertyOwnership(req.params.propertyId, profile.organizationId);
    if (!isOwner) return res.status(403).json({ error: "Zugriff verweigert" });
    const property = await storage.getProperty(req.params.propertyId);
    if (property && property.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    const settlements = await storage.getSettlementsByProperty(req.params.propertyId);
    res.json(settlements);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch settlements" });
  }
});

// ===== Property Maintenance Contracts =====

router.get("/api/properties/:propertyId/maintenance-contracts", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });
    const isOwner = await verifyPropertyOwnership(req.params.propertyId, profile.organizationId);
    if (!isOwner) return res.status(403).json({ error: "Zugriff verweigert" });
    const property = await storage.getProperty(req.params.propertyId);
    if (property && property.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    const contracts = await storage.getMaintenanceContractsByProperty(req.params.propertyId);
    res.json(contracts);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch maintenance contracts" });
  }
});

// ===== Maintenance Tasks & Contractors =====

router.get("/api/maintenance-tasks", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const { status } = req.query;
    const tasks = await storage.getMaintenanceTasksByOrganization(profile?.organizationId, status as string | undefined);
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch maintenance tasks" });
  }
});

router.get("/api/contractors", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const contractors = await storage.getContractorsByOrganization(profile?.organizationId);
    res.json(contractors);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch contractors" });
  }
});

// ===== Distribution Keys =====

router.get("/api/distribution-keys", isAuthenticated, async (req: any, res) => {
  try {
    const keys = await storage.getDistributionKeys();
    res.json(keys);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch distribution keys" });
  }
});

router.post("/api/distribution-keys", isAuthenticated, requireRole("property_manager"), async (req: any, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const org = await storage.getUserOrganization(userId);
    if (!org) return res.status(403).json({ error: "No organization" });

    const normalizedBody = snakeToCamel(req.body);
    const { keyCode, name, description, unit, inputType } = normalizedBody;
    if (!keyCode || !name) {
      return res.status(400).json({ error: "keyCode and name required" });
    }

    const newKey = await storage.createDistributionKey({
      organizationId: org.id,
      keyCode,
      name,
      description,
      unit: unit || "Anteil",
      inputType: inputType || "custom",
      isSystem: false,
      isActive: true,
      mrgKonform: true,
    });
    res.status(201).json(newKey);
  } catch (error) {
    res.status(500).json({ error: "Failed to create distribution key" });
  }
});

router.patch("/api/distribution-keys/:id", isAuthenticated, requireRole("property_manager"), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "No organization" });

    const { id } = req.params;

    // Org-Isolationscheck: Key muss zur Session-Org gehören (analog zu DELETE)
    const key = await storage.getDistributionKey(id);
    if (!key) return res.status(404).json({ error: "Key not found" });

    if (key.propertyId) {
      const property = await storage.getProperty(key.propertyId);
      if (!property || property.organizationId !== profile.organizationId) {
        return res.status(403).json({ error: "Access denied" });
      }
      // Wenn zusätzlich organizationId gesetzt ist, muss sie mit der Property-Org übereinstimmen.
      // Inkonsistente Zeilen (propertyId→OrgA, organizationId→OrgB) werden fail-closed abgelehnt.
      if (key.organizationId && key.organizationId !== profile.organizationId) {
        return res.status(403).json({ error: "Access denied" });
      }
    } else if (key.organizationId) {
      if (key.organizationId !== profile.organizationId) {
        return res.status(403).json({ error: "Access denied" });
      }
    } else {
      // System/globaler Key (kein propertyId, kein organizationId) → fail-closed
      return res.status(403).json({ error: "Access denied" });
    }

    const normalizedBody = snakeToCamel(req.body);
    // organizationId/propertyId dürfen nie per PATCH geändert werden — verhindert Key-Transfer
    delete normalizedBody.organizationId;
    delete normalizedBody.organization_id;
    delete normalizedBody.propertyId;
    delete normalizedBody.property_id;
    const updated = await storage.updateDistributionKey(id, normalizedBody, profile.organizationId);
    if (!updated) return res.status(404).json({ error: "Key not found" });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: "Failed to update distribution key" });
  }
});

router.delete("/api/distribution-keys/:id", isAuthenticated, requireRole("property_manager"), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "No organization" });

    const { id } = req.params;
    
    const key = await storage.getDistributionKey(id);
    if (!key) return res.status(404).json({ error: "Key not found" });
    
    if (key.propertyId) {
      const property = await storage.getProperty(key.propertyId);
      if (!property || property.organizationId !== profile.organizationId) {
        return res.status(403).json({ error: "Access denied" });
      }
      // Wenn zusätzlich organizationId gesetzt ist, muss sie mit der Property-Org übereinstimmen.
      // Inkonsistente Zeilen (propertyId→OrgA, organizationId→OrgB) werden fail-closed abgelehnt.
      if (key.organizationId && key.organizationId !== profile.organizationId) {
        return res.status(403).json({ error: "Access denied" });
      }
    } else if (key.organizationId) {
      if (key.organizationId !== profile.organizationId) {
        return res.status(403).json({ error: "Access denied" });
      }
    } else {
      // System/globaler Key (kein propertyId, kein organizationId) → fail-closed
      return res.status(403).json({ error: "Access denied" });
    }

    await storage.deleteDistributionKey(id, profile.organizationId);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete distribution key" });
  }
});

// ===== Property-specific Distribution Keys =====

router.get("/api/properties/:propertyId/distribution-keys", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });
    const isOwner = await verifyPropertyOwnership(req.params.propertyId, profile.organizationId);
    if (!isOwner) return res.status(403).json({ error: "Zugriff verweigert" });
    const property = await storage.getProperty(req.params.propertyId);
    if (!property || property.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    const keys = await storage.getDistributionKeysByProperty(req.params.propertyId);
    res.json(keys);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch distribution keys" });
  }
});

router.post("/api/properties/:propertyId/distribution-keys", isAuthenticated, requireRole("property_manager"), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });
    const isOwner = await verifyPropertyOwnership(req.params.propertyId, profile.organizationId);
    if (!isOwner) return res.status(403).json({ error: "Zugriff verweigert" });
    const property = await storage.getProperty(req.params.propertyId);
    if (!property || property.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    const normalizedBody = snakeToCamel(req.body);
    const { keyCode, name, description, formula, unit, inputType } = normalizedBody;
    if (!keyCode || !name) {
      return res.status(400).json({ error: "keyCode and name required" });
    }

    const newKey = await storage.createDistributionKey({
      organizationId: profile.organizationId,
      propertyId: req.params.propertyId,
      keyCode,
      name,
      description,
      formula: formula || 'flaeche',
      unit: unit || 'm²',
      inputType: inputType || 'flaeche',
      isSystem: false,
      isActive: true,
    });
    res.status(201).json(newKey);
  } catch (error) {
    console.error("Create distribution key error:", error);
    res.status(500).json({ error: "Failed to create distribution key" });
  }
});

// ===== Distribution Values =====

router.get("/api/units/:unitId/distribution-values", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });
    const isOwner = await verifyUnitOwnership(req.params.unitId, profile.organizationId);
    if (!isOwner) return res.status(403).json({ error: "Zugriff verweigert" });
    const unit = await storage.getUnit(req.params.unitId);
    if (!unit) return res.status(404).json({ error: "Unit not found" });
    const property = await storage.getProperty(unit.propertyId);
    if (!property || property.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    const values = await storage.getUnitDistributionValues(req.params.unitId);
    res.json(values);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch unit distribution values" });
  }
});

router.get("/api/properties/:propertyId/distribution-values", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });
    const isOwner = await verifyPropertyOwnership(req.params.propertyId, profile.organizationId);
    if (!isOwner) return res.status(403).json({ error: "Zugriff verweigert" });
    const property = await storage.getProperty(req.params.propertyId);
    if (!property || property.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    const values = await storage.getUnitDistributionValuesByProperty(req.params.propertyId);
    res.json(values);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch property distribution values" });
  }
});

router.post("/api/units/:unitId/distribution-values", isAuthenticated, requireRole("property_manager"), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });
    const isOwner = await verifyUnitOwnership(req.params.unitId, profile.organizationId);
    if (!isOwner) return res.status(403).json({ error: "Zugriff verweigert" });
    const unit = await storage.getUnit(req.params.unitId);
    if (!unit) return res.status(404).json({ error: "Unit not found" });
    const property = await storage.getProperty(unit.propertyId);
    if (!property || property.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    const normalizedBody = snakeToCamel(req.body);
    const { keyId, value } = normalizedBody;
    if (!keyId) return res.status(400).json({ error: "keyId is required" });
    const key = await storage.getDistributionKey(keyId);
    if (!key) return res.status(400).json({ error: "Invalid distribution key" });
    if (!key.isSystem && key.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Distribution key access denied" });
    }
    const result = await storage.upsertUnitDistributionValue({
      unitId: req.params.unitId,
      keyId,
      value: value?.toString() || '0'
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to save unit distribution value" });
  }
});

router.delete("/api/units/:unitId/distribution-values/:keyId", isAuthenticated, requireRole("property_manager"), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });
    const isOwner = await verifyUnitOwnership(req.params.unitId, profile.organizationId);
    if (!isOwner) return res.status(403).json({ error: "Zugriff verweigert" });
    const unit = await storage.getUnit(req.params.unitId);
    if (!unit) return res.status(404).json({ error: "Unit not found" });
    const property = await storage.getProperty(unit.propertyId);
    if (!property || property.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    await storage.deleteUnitDistributionValue(req.params.unitId, req.params.keyId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete unit distribution value" });
  }
});

// ===== Property Documents =====

router.get("/api/properties/:propertyId/documents", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });
    const isOwner = await verifyPropertyOwnership(req.params.propertyId, profile.organizationId);
    if (!isOwner) return res.status(403).json({ error: "Zugriff verweigert" });
    const { propertyId } = req.params;
    const orgId = req.session.organizationId;
    const documents = await db.select()
      .from(schema.propertyDocuments)
      .where(and(eq(schema.propertyDocuments.propertyId, propertyId), eq(schema.propertyDocuments.organizationId, orgId)));
    
    res.json(documents.map(d => ({
      ...d,
      property_id: d.propertyId,
      organization_id: d.organizationId,
      file_url: d.fileUrl,
      file_size: d.fileSize,
      mime_type: d.mimeType,
      created_at: d.createdAt,
      updated_at: d.updatedAt,
    })));
  } catch (error) {
    console.error('Property documents fetch error:', error);
    res.status(500).json({ error: "Failed to fetch documents" });
  }
});

router.post("/api/properties/:propertyId/documents", isAuthenticated, requireRole("property_manager"), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });
    const isOwner = await verifyPropertyOwnership(req.params.propertyId, profile.organizationId);
    if (!isOwner) return res.status(403).json({ error: "Zugriff verweigert" });
    const { propertyId } = req.params;
    const orgId = req.session.organizationId;
    const body = snakeToCamel(req.body);
    
    const property = await db.select().from(schema.properties)
      .where(and(eq(schema.properties.id, propertyId), eq(schema.properties.organizationId, orgId)));
    if (property.length === 0) {
      return res.status(403).json({ error: "Property not found or access denied" });
    }
    
    const result = await db.insert(schema.propertyDocuments).values({
      propertyId,
      organizationId: orgId,
      name: body.name,
      category: body.category || 'sonstiges',
      fileUrl: body.fileUrl || body.file_url,
      fileSize: body.fileSize || body.file_size,
      mimeType: body.mimeType || body.mime_type,
      notes: body.notes,
    }).returning();
    
    res.json(result[0]);
  } catch (error) {
    console.error('Property document create error:', error);
    res.status(500).json({ error: "Failed to create document" });
  }
});

router.delete("/api/properties/:propertyId/documents/:id", isAuthenticated, requireRole("property_manager"), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });
    const isOwner = await verifyPropertyOwnership(req.params.propertyId, profile.organizationId);
    if (!isOwner) return res.status(403).json({ error: "Zugriff verweigert" });
    const { id } = req.params;
    const orgId = req.session.organizationId;
    await db.delete(schema.propertyDocuments).where(and(eq(schema.propertyDocuments.id, id), eq(schema.propertyDocuments.organizationId, orgId)));
    res.json({ success: true });
  } catch (error) {
    console.error('Property document delete error:', error);
    res.status(500).json({ error: "Failed to delete document" });
  }
});

export default router;
