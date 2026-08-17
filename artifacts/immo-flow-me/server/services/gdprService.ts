import { db } from "../db";
import { eq, and, sql, inArray } from "drizzle-orm";
import {
  tenants,
  units,
  properties,
  monthlyInvoices,
  payments,
  paymentAllocations,
  rentHistory,
  tenantDocuments,
} from "@shared/schema";
import { decryptField } from "../lib/fieldEncryption";

async function verifyTenantOrganization(tenantId: string, organizationId: string) {
  const result = await db
    .select({
      tenantId: tenants.id,
      unitId: units.id,
      propertyId: properties.id,
      organizationId: properties.organizationId,
    })
    .from(tenants)
    .innerJoin(units, eq(units.id, tenants.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(
      and(
        eq(tenants.id, tenantId),
        eq(properties.organizationId, organizationId)
      )
    )
    .limit(1);

  return result[0] ?? null;
}

export async function exportTenantData(tenantId: string, organizationId: string) {
  const ownership = await verifyTenantOrganization(tenantId, organizationId);
  if (!ownership) {
    throw new Error("Mieter gehört nicht zu dieser Organisation oder existiert nicht");
  }

  const [tenantRecord] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId));

  const [unitRecord] = await db
    .select()
    .from(units)
    .where(eq(units.id, tenantRecord.unitId));

  const [propertyRecord] = await db
    .select()
    .from(properties)
    .where(eq(properties.id, unitRecord.propertyId));

  const [invoices, tenantPayments, allocations, documents, history] = await Promise.all([
    db.select().from(monthlyInvoices).where(eq(monthlyInvoices.tenantId, tenantId)),
    db.select().from(payments).where(eq(payments.tenantId, tenantId)),
    db
      .select({
        id: paymentAllocations.id,
        paymentId: paymentAllocations.paymentId,
        invoiceId: paymentAllocations.invoiceId,
        appliedAmount: paymentAllocations.appliedAmount,
        allocationType: paymentAllocations.allocationType,
        createdAt: paymentAllocations.createdAt,
      })
      .from(paymentAllocations)
      .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
      .where(eq(payments.tenantId, tenantId)),
    db.select().from(tenantDocuments).where(eq(tenantDocuments.tenantId, tenantId)),
    db.select().from(rentHistory).where(eq(rentHistory.tenantId, tenantId)),
  ]);

  const dataCategories = [
    "stammdaten",
    "einheit",
    "liegenschaft",
    "vorschreibungen",
    "zahlungen",
    "zahlungszuordnungen",
    "dokumente",
    "miethistorie",
  ];

  return {
    meta: {
      exportDatum: new Date().toISOString(),
      mieterName: `${tenantRecord.firstName} ${tenantRecord.lastName}`,
      datenkategorien: dataCategories,
      rechtsgrundlage: "Art. 15 DSGVO – Auskunftsrecht",
    },
    stammdaten: {
      id: tenantRecord.id,
      vorname: tenantRecord.firstName,
      nachname: tenantRecord.lastName,
      email: tenantRecord.email,
      telefon: tenantRecord.phone,
      mobiltelefon: tenantRecord.mobilePhone,
      iban: decryptField(tenantRecord.iban),
      bic: decryptField(tenantRecord.bic),
      status: tenantRecord.status,
      mietbeginn: tenantRecord.mietbeginn,
      mietende: tenantRecord.mietende,
      grundmiete: tenantRecord.grundmiete,
      betriebskostenVorschuss: tenantRecord.betriebskostenVorschuss,
      heizkostenVorschuss: tenantRecord.heizkostenVorschuss,
      kaution: tenantRecord.kaution,
      kautionBezahlt: tenantRecord.kautionBezahlt,
      sepaMandat: tenantRecord.sepaMandat,
      sepaMandatDatum: tenantRecord.sepaMandatDatum,
      notizen: tenantRecord.notes,
      erstelltAm: tenantRecord.createdAt,
      aktualisiertAm: tenantRecord.updatedAt,
    },
    einheit: {
      id: unitRecord.id,
      topNummer: unitRecord.topNummer,
      typ: unitRecord.type,
      flaeche: unitRecord.flaeche,
      zimmer: unitRecord.zimmer,
      stockwerk: unitRecord.stockwerk,
    },
    liegenschaft: {
      id: propertyRecord.id,
      name: propertyRecord.name,
      adresse: propertyRecord.address,
      stadt: propertyRecord.city,
      plz: propertyRecord.postalCode,
    },
    vorschreibungen: invoices.map((inv) => ({
      id: inv.id,
      jahr: inv.year,
      monat: inv.month,
      grundmiete: inv.grundmiete,
      betriebskosten: inv.betriebskosten,
      heizungskosten: inv.heizungskosten,
      wasserkosten: inv.wasserkosten,
      ust: inv.ust,
      gesamtbetrag: inv.gesamtbetrag,
      status: inv.status,
      faelligAm: inv.faelligAm,
    })),
    zahlungen: tenantPayments.map((p) => ({
      id: p.id,
      betrag: p.betrag,
      buchungsDatum: p.buchungsDatum,
      zahlungsart: p.paymentType,
      verwendungszweck: p.verwendungszweck,
      erstelltAm: p.createdAt,
    })),
    zahlungszuordnungen: allocations.map((a) => ({
      id: a.id,
      zahlungId: a.paymentId,
      rechnungId: a.invoiceId,
      zugewiesenerBetrag: a.appliedAmount,
      zuordnungstyp: a.allocationType,
    })),
    dokumente: documents.map((d) => ({
      id: d.id,
      name: d.name,
      kategorie: d.category,
      dateityp: d.mimeType,
      dateigroesse: d.fileSize,
      erstelltAm: d.createdAt,
    })),
    miethistorie: history.map((h) => ({
      id: h.id,
      gueltigAb: h.validFrom,
      gueltigBis: h.validUntil,
      grundmiete: h.grundmiete,
      betriebskostenVorschuss: h.betriebskostenVorschuss,
      heizkostenVorschuss: h.heizkostenVorschuss,
      aenderungsgrund: h.changeReason,
    })),
  };
}

export async function anonymizeTenantData(tenantId: string, organizationId: string) {
  const ownership = await verifyTenantOrganization(tenantId, organizationId);
  if (!ownership) {
    throw new Error("Mieter gehört nicht zu dieser Organisation oder existiert nicht");
  }

  const [tenantRecord] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId));

  if (tenantRecord.deletedAt) {
    throw new Error("Mieterdaten wurden bereits anonymisiert");
  }

  const now = new Date();

  // Org-Scope (Defense-in-Depth zu RLS): tenants hat keine organization_id —
  // Bezug über unit → property. Ein fremder tenantId trifft 0 Zeilen.
  await db
    .update(tenants)
    .set({
      firstName: "GELÖSCHT",
      lastName: "GELÖSCHT",
      email: null,
      phone: null,
      mobilePhone: null,
      iban: null,
      bic: null,
      notes: null,
      deletedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(tenants.id, tenantId),
        inArray(
          tenants.unitId,
          db
            .select({ id: units.id })
            .from(units)
            .innerJoin(properties, eq(properties.id, units.propertyId))
            .where(eq(properties.organizationId, organizationId))
        )
      )
    );

  const anonymizedFields = [
    "firstName (Vorname)",
    "lastName (Nachname)",
    "email (E-Mail)",
    "phone (Telefon)",
    "mobilePhone (Mobiltelefon)",
    "iban (IBAN)",
    "bic (BIC)",
    "notes (Notizen)",
  ];

  return {
    erfolg: true,
    mieterId: tenantId,
    anonymisiertAm: now.toISOString(),
    anonymisierteFelder: anonymizedFields,
    hinweis:
      "Personenbezogene Daten wurden gemäß Art. 17 DSGVO anonymisiert. " +
      "Finanzdaten (Vorschreibungen, Zahlungen) bleiben für die Buchhaltungspflicht erhalten.",
    rechtsgrundlage: "Art. 17 DSGVO – Recht auf Löschung",
    aufbewahrungspflicht: "§ 132 BAO – 7 Jahre Aufbewahrungspflicht für Geschäftsunterlagen",
  };
}
