import { Router, Request, Response } from "express";
import { isAuthenticated } from "./helpers";
import { db } from "../db";
import { tenants, units, properties, profiles, leases } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import { checkMrgExcess, RICHTWERTE_2025, type MrgRentInput } from "../services/mrgRentCalculationService";
import { parseMoneyInput } from "../lib/money";

const router = Router();

const richtwertValues: Record<string, number> = {
  "Wien": 6.67,
  "Niederösterreich": 6.85,
  "Oberösterreich": 7.23,
  "Salzburg": 9.22,
  "Tirol": 8.14,
  "Vorarlberg": 10.25,
  "Steiermark": 9.21,
  "Kärnten": 7.81,
  "Burgenland": 6.09,
};

const kategorieValues: Record<string, number> = {
  "A": 4.47,
  "B": 3.35,
  "C": 2.24,
  "D_brauchbar": 2.24,
  "D_unbrauchbar": 1.12,
};

router.get("/api/richtwert/values", isAuthenticated, async (_req: Request, res: Response) => {
  try {
    res.json({
      richtwerte: richtwertValues,
      kategorien: kategorieValues,
      stand: "2025/2026",
    });
  } catch (error) {
    res.status(500).json({ error: "Fehler beim Laden der Richtwerte" });
  }
});

router.post("/api/richtwert/calculate", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const {
      bundesland,
      nutzflaeche,
      lagezuschlag = 0,
      ausstattung = 0,
      balkonTerrasse = 0,
      stockwerk = 0,
      aufzug = false,
      aufzugProzent = 10,
      befristung = false,
      moeblierung = 0,
      zustand = 0,
      garageStellplatz = 0,
    } = req.body;

    if (!bundesland || !richtwertValues[bundesland]) {
      return res.status(400).json({ error: "Ungültiges Bundesland" });
    }

    if (!nutzflaeche || nutzflaeche <= 0) {
      return res.status(400).json({ error: "Ungültige Nutzfläche" });
    }

    // Fixe Garage-/Stellplatzkosten sind der einzige Geldbetrag dieses
    // Rechenendpunkts. Derselbe Bereich wie die Mietbeträge (numeric(10,2))
    // verhindert unbrauchbare Ergebnisse bei übergroßen Eingaben.
    const parsedGarageStellplatz = parseMoneyInput(garageStellplatz, "garageStellplatz", 8);
    if ("error" in parsedGarageStellplatz) {
      return res.status(400).json({ error: parsedGarageStellplatz.error });
    }
    const garageStellplatzAmount = Number(parsedGarageStellplatz.value);

    const baseRichtwert = richtwertValues[bundesland];
    const baseRent = nutzflaeche * baseRichtwert;

    let stockwerkProzent = 0;
    if (stockwerk > 0) {
      stockwerkProzent = Math.min(stockwerk * 3, 10);
    } else if (stockwerk < 0) {
      stockwerkProzent = Math.max(stockwerk * 5, -5);
    }

    const aufzugProzentValue = aufzug ? aufzugProzent : 0;
    const befristungProzent = befristung ? -25 : 0;

    const sumPercentage =
      lagezuschlag +
      ausstattung +
      balkonTerrasse +
      stockwerkProzent +
      aufzugProzentValue +
      befristungProzent +
      moeblierung +
      zustand;

    const adjustedRent = baseRent * (1 + sumPercentage / 100);
    const finalRent = adjustedRent + garageStellplatzAmount;

    const surcharges = {
      lagezuschlag: { prozent: lagezuschlag, betrag: baseRent * (lagezuschlag / 100) },
      ausstattung: { prozent: ausstattung, betrag: baseRent * (ausstattung / 100) },
      balkonTerrasse: { prozent: balkonTerrasse, betrag: baseRent * (balkonTerrasse / 100) },
      stockwerk: { prozent: stockwerkProzent, betrag: baseRent * (stockwerkProzent / 100) },
      aufzug: { prozent: aufzugProzentValue, betrag: baseRent * (aufzugProzentValue / 100) },
      befristung: { prozent: befristungProzent, betrag: baseRent * (befristungProzent / 100) },
      moeblierung: { prozent: moeblierung, betrag: baseRent * (moeblierung / 100) },
      zustand: { prozent: zustand, betrag: baseRent * (zustand / 100) },
      garageStellplatz: { fix: true, betrag: garageStellplatzAmount },
    };

    const totalSurchargesPercent = sumPercentage;
    const totalSurchargesAmount = adjustedRent - baseRent + garageStellplatzAmount;

    res.json({
      bundesland,
      nutzflaeche,
      baseRichtwert,
      baseRent: Math.round(baseRent * 100) / 100,
      surcharges,
      totalSurchargesPercent,
      totalSurchargesAmount: Math.round(totalSurchargesAmount * 100) / 100,
      monatsmiete: Math.round(finalRent * 100) / 100,
      jahresmiete: Math.round(finalRent * 12 * 100) / 100,
    });
  } catch (error) {
    res.status(500).json({ error: "Fehler bei der Berechnung" });
  }
});

router.post("/api/kategorie/calculate", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const { kategorie, nutzflaeche } = req.body;

    if (!kategorie || !kategorieValues[kategorie]) {
      return res.status(400).json({ error: "Ungültige Kategorie" });
    }

    if (!nutzflaeche || nutzflaeche <= 0) {
      return res.status(400).json({ error: "Ungültige Nutzfläche" });
    }

    const rate = kategorieValues[kategorie];
    const monatsmiete = nutzflaeche * rate;

    res.json({
      kategorie,
      nutzflaeche,
      rate,
      monatsmiete: Math.round(monatsmiete * 100) / 100,
      jahresmiete: Math.round(monatsmiete * 12 * 100) / 100,
    });
  } catch (error) {
    res.status(500).json({ error: "Fehler bei der Berechnung" });
  }
});

/**
 * GET /api/tenants/:id/mrg-check
 * Prüft ob die Grundmiete den zulässigen Höchstmietzins nach § 16 MRG übersteigt.
 *
 * Sicherheit: Tenant muss zur Organisation des anfragenden Benutzers gehören.
 * Suppression: Warnung nur wenn mietrecht_typ='richtwert' explizit gesetzt ist.
 * Kein Rückschluss aus bundesland — Freie-Markt-Objekte können ebenfalls ein Bundesland haben.
 * Fehlende Nutzfläche unterdrückt ebenfalls.
 */
router.get("/api/tenants/:id/mrg-check", isAuthenticated, async (req: Request, res: Response) => {
  const SUPPRESSED = {
    ueberschritten: false,
    differenz: 0,
    zulassigerHmz: null,
    berechnungsgrundlage: "MRG-Anwendbarkeit nicht bestimmbar — Warnung unterdrückt",
  };

  try {
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Nicht authentifiziert" });

    // Org des anfragenden Benutzers ermitteln — fail closed wenn nicht vorhanden
    const profileRows = await db
      .select({ orgId: profiles.organizationId })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    const callerOrgId = profileRows[0]?.orgId as string | null;
    if (!callerOrgId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });

    const tenantId = req.params.id as string;

    // Tenant + Unit + Property laden — Abfrage auf callerOrgId beschränkt
    const rows = await db
      .select({ tenant: tenants, unit: units, property: properties })
      .from(tenants)
      .innerJoin(units, eq(tenants.unitId, units.id))
      .innerJoin(properties, and(
        eq(units.propertyId, properties.id),
        eq(properties.organizationId, callerOrgId),   // Org-Isolierung auf DB-Ebene
      ))
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!rows.length) return res.status(404).json({ error: "Mieter nicht gefunden" });

    const { tenant, unit, property } = rows[0]!;
    const grundmiete = Number(tenant.grundmiete) || 0;
    const nutzflaeche = Number(unit.flaeche) || 0;

    // Ohne Nutzfläche ist keine Berechnung möglich → Warnung unterdrücken
    if (nutzflaeche <= 0) return res.json(SUPPRESSED);

    // Nur wenn mietrecht_typ explizit auf 'richtwert' gesetzt ist → Berechnung durchführen.
    // Kein Rückschluss aus bundesland allein — Freie-Markt-Objekte können ebenfalls ein
    // Bundesland haben. NULL oder 'frei'/'kategorie' → unterdrücken.
    const mietrechtTyp = (property as any).mietrechtTyp as string | null;
    const bundesland   = (property as any).bundesland   as string | null;
    if (mietrechtTyp !== 'richtwert' || !bundesland || !RICHTWERTE_2025[bundesland]) {
      return res.json(SUPPRESSED);
    }

    // Aktiven Mietvertrag per Status 'aktiv' laden (befristete Verträge haben ein Enddatum,
    // isNull(endDate) würde sie fälschlich ausschließen)
    const leaseRows = await db
      .select({
        befristet: leases.befristet,
        endDate: leases.endDate,
        lagezuschlag: leases.lagezuschlag,
        abschlaege: leases.abschlaege,
      })
      .from(leases)
      .where(and(
        eq(leases.tenantId, tenantId),
        eq(leases.unitId, unit.id),
        eq(leases.status, 'aktiv'),       // status='aktiv' erfasst sowohl befristete als auch unbefristete Verträge
      ))
      .limit(1);

    // Befristung aus explizitem Flag ODER aus gesetztem Enddatum ableiten.
    // Hintergrund: leases.befristet hat DEFAULT false — bestehende Verträge, die nur
    // end_date gesetzt haben (ohne befristet=true), werden so korrekt behandelt.
    const row = leaseRows[0];
    const befristet = (row?.befristet === true) || (row?.endDate != null);

    // Lagezuschlag/Abschläge in €/m² aus dem Mietvertrag übernehmen (§ 16 Abs. 2 MRG).
    // NULL/fehlend → 0 (Basisfall ohne Zu-/Abschlag).
    const lagezuschlag = row?.lagezuschlag != null ? Number(row.lagezuschlag) : 0;
    const abschlaege   = row?.abschlaege   != null ? Number(row.abschlaege)   : 0;

    const input: MrgRentInput = {
      rentType: "richtwert",
      bundesland,
      nutzflaeche,
      befristet,
      lagezuschlag,
      abschlaege,
    };

    const check = checkMrgExcess(grundmiete, input);
    return res.json(check);
  } catch (err) {
    console.error("[mrg-check] error:", err);
    return res.status(500).json({ error: "MRG-Check fehlgeschlagen" });
  }
});

export default router;
