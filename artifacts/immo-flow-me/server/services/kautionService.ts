import { db } from "../db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import * as schema from "@shared/schema";
import { roundMoney } from "@shared/utils";
import { encryptField } from "../lib/fieldEncryption";
import { parseMoneyInput } from "../lib/money";

// ─── Reine Berechnungshelfer — exportiert für Unit-Tests ──────────────────────

/**
 * Berechnet den Rückzahlungsbetrag nach § 16b MRG.
 * Einbehalt wird genau EINMAL abgezogen — kein Ledger-Doppeleintrag.
 */
export function calculateKautionRueckzahlung(
  betrag: number,
  aufgelaufeneZinsen: number,
  einbehalten: number,
): {
  rueckzahlungsbetrag: number;
  einbehalten: number;
  maxEinbehalten: number;
} {
  const maxEinbehalten = roundMoney(betrag + aufgelaufeneZinsen);
  const einbehaltenRounded = roundMoney(einbehalten);
  const rueckzahlungsbetrag = roundMoney(betrag + aufgelaufeneZinsen - einbehaltenRounded);
  return { rueckzahlungsbetrag, einbehalten: einbehaltenRounded, maxEinbehalten };
}

/**
 * Prüft ob der einbehaltene Betrag innerhalb der zulässigen Grenzen liegt.
 * Gibt null bei gültigem Einbehalt zurück, sonst Error.
 */
export function validateEinbehalten(
  einbehalten: number,
  betrag: number,
  aufgelaufeneZinsen: number,
): Error | null {
  if (einbehalten < 0) return new Error("Einbehaltener Betrag darf nicht negativ sein");
  const max = roundMoney(betrag + aufgelaufeneZinsen);
  if (einbehalten > max) {
    return new Error(
      `Einbehaltener Betrag (€ ${einbehalten.toFixed(2)}) übersteigt Kaution + Zinsen (€ ${max.toFixed(2)})`,
    );
  }
  return null;
}

export async function createKaution(data: {
  organizationId: string;
  tenantId: string;
  unitId: string;
  leaseId?: string;
  betrag: string;
  eingangsdatum?: string;
  treuhandkontoIban?: string;
  treuhandkontoBank?: string;
  zinssatz?: string;
  notes?: string;
}) {
  const parsedBetrag = parseMoneyInput(data.betrag, "betrag");
  if ("error" in parsedBetrag) {
    throw new Error(parsedBetrag.error);
  }
  const betrag = Number(parsedBetrag.value);
  if (!betrag || betrag <= 0) {
    throw new Error("Kautionsbetrag muss größer als 0 sein");
  }
  // zinssatz ist numeric(5,3): Prozentwert 0–99,999 — nicht über parseMoneyInput
  // (das würde auf 2 Nachkommastellen runden), sondern direkt prüfen.
  let zinssatz = "0";
  if (data.zinssatz !== undefined && data.zinssatz !== null && String(data.zinssatz) !== "") {
    const z = String(data.zinssatz).trim().replace(",", ".");
    const zNum = Number(z);
    if (!/^-?\d+(\.\d+)?$/.test(z) || !Number.isFinite(zNum) || zNum < 0 || zNum >= 100) {
      throw new Error("zinssatz: Ungültiger Zinssatz (erlaubt: 0 bis 99,999)");
    }
    zinssatz = zNum.toFixed(3);
  }

  const [kaution] = await db.insert(schema.kautionen).values({
    organizationId: data.organizationId,
    tenantId: data.tenantId,
    unitId: data.unitId,
    leaseId: data.leaseId || null,
    betrag: String(roundMoney(betrag)),
    eingangsdatum: data.eingangsdatum || null,
    treuhandkontoIban: encryptField(data.treuhandkontoIban || null),
    treuhandkontoBank: data.treuhandkontoBank || null,
    zinssatz,
    notes: data.notes || null,
    status: 'aktiv',
  }).returning();

  if (data.eingangsdatum) {
    await db.insert(schema.kautionsBewegungen).values({
      kautionId: kaution!.id,
      datum: data.eingangsdatum,
      betrag: String(roundMoney(betrag)),
      typ: 'eingang',
      beschreibung: `Kautionseingang: € ${roundMoney(betrag).toFixed(2)}`,
    });

    // Org-Scope: Mieter muss über unit → property zur Organisation der
    // Kaution gehören — fremde tenantId trifft 0 Zeilen (Defense-in-Depth).
    await db.update(schema.tenants)
      .set({ kautionBezahlt: true, updatedAt: new Date() })
      .where(and(
        eq(schema.tenants.id, data.tenantId),
        inArray(schema.tenants.unitId,
          db.select({ id: schema.units.id }).from(schema.units)
            .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
            .where(eq(schema.properties.organizationId, data.organizationId)))
      ));
  }

  return kaution;
}

/**
 * Zinsberechnung transaktional (pessimistisches Locking).
 *
 * SELECT … FOR UPDATE sperrt den Datensatz für die Dauer der Transaktion.
 * Parallele Aufrufe blockieren, sehen danach letzteZinsberechnung = today
 * → 0 Tage → kein Doppelbuchen.
 */
export async function calculateInterest(kautionId: string, organizationId?: string): Promise<number> {
  return db.transaction(async (tx) => {
    // Org-Scope (Defense-in-Depth zu RLS): mit organizationId wird bereits
    // der gesperrte SELECT org-gebunden — fremde IDs → "nicht gefunden".
    const [kaution] = await tx.select().from(schema.kautionen)
      .where(organizationId
        ? and(eq(schema.kautionen.id, kautionId), eq(schema.kautionen.organizationId, organizationId))
        : eq(schema.kautionen.id, kautionId))
      .for('update');

    if (!kaution) throw new Error("Kaution nicht gefunden");

    const zinssatz = parseFloat(String(kaution.zinssatz || '0'));
    if (zinssatz <= 0) return 0;

    const startDate = kaution.letzteZinsberechnung || kaution.eingangsdatum;
    if (!startDate) return 0;

    const today = new Date().toISOString().split('T')[0]!;
    const start = new Date(startDate);
    const end = new Date(today);
    const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (days <= 0) return 0;

    const betrag = parseFloat(String(kaution.betrag));
    const interest = roundMoney(betrag * (zinssatz / 100) * (days / 365));
    if (interest <= 0) return 0;

    const currentZinsen = parseFloat(String(kaution.aufgelaufeneZinsen || '0'));
    const newZinsen = roundMoney(currentZinsen + interest);

    // Hinweis: Die Org-Autorisierung erfolgt oben im org-gebundenen
    // Lock-SELECT (bzw. via RLS); das organization_id-Prädikat hier ist nur
    // eine Konsistenzabsicherung gegen parallele Org-Umzüge.
    await tx.update(schema.kautionen)
      .set({
        aufgelaufeneZinsen: String(newZinsen),
        letzteZinsberechnung: today,
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.kautionen.id, kautionId),
        eq(schema.kautionen.organizationId, kaution.organizationId)
      ));

    await tx.insert(schema.kautionsBewegungen).values({
      kautionId,
      datum: today,
      betrag: String(interest),
      typ: 'zinsen',
      beschreibung: `Zinsberechnung: ${days} Tage à ${zinssatz}% = € ${interest.toFixed(2)}`,
    });

    return interest;
  });
}

export async function calculateAllInterest(orgId: string) {
  const activeKautionen = await db.select().from(schema.kautionen)
    .where(and(
      eq(schema.kautionen.organizationId, orgId),
      eq(schema.kautionen.status, 'aktiv'),
      sql`CAST(${schema.kautionen.zinssatz} AS NUMERIC) > 0`
    ));

  let totalInterest = 0;
  let processed = 0;

  for (const k of activeKautionen) {
    try {
      const interest = await calculateInterest(k.id, k.organizationId);
      totalInterest = roundMoney(totalInterest + interest);
      processed++;
    } catch (err) {
      console.error(`Zinsberechnung fehlgeschlagen für Kaution ${k.id}:`, err);
    }
  }

  return { processed, totalInterest };
}

/**
 * Rückgabe einleiten — vollständig transaktional.
 *
 * Ledger-Invariante nach initiateReturn:
 *   +P (eingang)  +  +I (zinsen, kumuliert)  -  (P+I-W) (rueckzahlung)
 *   = W  (Saldo = genau der einbehaltene Betrag)
 *
 * Einbehalt erscheint NICHT als separate Bewegung — er ist in der
 * Netto-Rückzahlung herausgerechnet und auf dem Kautionsdatensatz
 * (einbehaltenBetrag, einbehaltenGrund) dokumentiert.
 *
 * Schutz:
 * - Status muss 'aktiv' sein (kein zweites Einleiten)
 * - 0 ≤ einbehalten ≤ betrag + aufgelaufeneZinsen
 * - SELECT … FOR UPDATE verhindert Race-Conditions
 */
export async function initiateReturn(kautionId: string, params: {
  rueckzahlungsdatum: string;
  einbehaltenBetrag?: number;
  einbehaltenGrund?: string;
}, organizationId?: string) {
  return db.transaction(async (tx) => {
    // Datensatz sperren und Status prüfen — mit organizationId org-gebunden
    // (Defense-in-Depth zu RLS): fremde IDs → "nicht gefunden".
    const [kaution] = await tx.select().from(schema.kautionen)
      .where(organizationId
        ? and(eq(schema.kautionen.id, kautionId), eq(schema.kautionen.organizationId, organizationId))
        : eq(schema.kautionen.id, kautionId))
      .for('update');

    if (!kaution) throw new Error("Kaution nicht gefunden");
    if (kaution.status !== 'aktiv') {
      throw new Error(`Rückgabe kann nur für aktive Kautionen eingeleitet werden (aktueller Status: ${kaution.status})`);
    }

    // Zinsen berechnen (innerhalb derselben Transaktion um Konsistenz zu wahren)
    // Wir berechnen manuell statt calculateInterest aufzurufen, da wir
    // bereits in einer Transaktion sind und den gesperrten Datensatz haben.
    const zinssatz = parseFloat(String(kaution.zinssatz || '0'));
    let zinsen = 0;

    if (zinssatz > 0) {
      const startDate = kaution.letzteZinsberechnung || kaution.eingangsdatum;
      if (startDate) {
        const today = new Date().toISOString().split('T')[0]!;
        const start = new Date(startDate);
        const end = new Date(today);
        const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

        if (days > 0) {
          const betragNum = parseFloat(String(kaution.betrag));
          const interest = roundMoney(betragNum * (zinssatz / 100) * (days / 365));
          if (interest > 0) {
            zinsen = interest;
            const currentZinsen = parseFloat(String(kaution.aufgelaufeneZinsen || '0'));
            const newZinsen = roundMoney(currentZinsen + interest);
            const today2 = today;

            // Org-Scope (Defense-in-Depth): self-consistent write auf die
            // organization_id des gesperrt geladenen Datensatzes.
            await tx.update(schema.kautionen)
              .set({ aufgelaufeneZinsen: String(newZinsen), letzteZinsberechnung: today2, updatedAt: new Date() })
              .where(and(
                eq(schema.kautionen.id, kautionId),
                eq(schema.kautionen.organizationId, kaution.organizationId)
              ));

            await tx.insert(schema.kautionsBewegungen).values({
              kautionId,
              datum: today,
              betrag: String(interest),
              typ: 'zinsen',
              beschreibung: `Zinsberechnung bei Rückgabe: ${days} Tage à ${zinssatz}% = € ${interest.toFixed(2)}`,
            });
          }
        }
      }
    }

    // Aktualisierte Zinsen lesen (nach Update oben)
    const [updated] = await tx.select().from(schema.kautionen)
      .where(eq(schema.kautionen.id, kautionId));

    const betrag = parseFloat(String(updated!.betrag));
    const aufgelaufeneZinsen = parseFloat(String(updated!.aufgelaufeneZinsen || '0'));
    const einbehalten = roundMoney(params.einbehaltenBetrag || 0);

    // Validierung und Berechnung über die exportierten reinen Hilfsfunktionen
    // (dieselbe Logik wie im Unit-Test — so schützen Tests die Produktionspfad)
    const validationError = validateEinbehalten(einbehalten, betrag, aufgelaufeneZinsen);
    if (validationError) throw validationError;

    const { rueckzahlungsbetrag } = calculateKautionRueckzahlung(betrag, aufgelaufeneZinsen, einbehalten);

    // Org-Autorisierung erfolgt oben im org-gebundenen Lock-SELECT (bzw. via
    // RLS); das organization_id-Prädikat hier sichert nur Konsistenz ab.
    await tx.update(schema.kautionen)
      .set({
        status: 'rueckzahlung_angefordert',
        rueckzahlungsdatum: params.rueckzahlungsdatum,
        rueckzahlungsbetrag: String(rueckzahlungsbetrag),
        einbehaltenBetrag: String(einbehalten),
        einbehaltenGrund: params.einbehaltenGrund || null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.kautionen.id, kautionId),
        eq(schema.kautionen.organizationId, kaution.organizationId)
      ));

    // Kein Ledger-Eintrag hier — Zahlung ist noch nicht erfolgt.
    // Die tatsächliche Buchung erfolgt erst in completeReturn wenn
    // die Zahlungsreferenz (Nachweis der erfolgten Zahlung) vorliegt.

    const [finalKaution] = await tx.select().from(schema.kautionen)
      .where(eq(schema.kautionen.id, kautionId));

    return {
      kaution: finalKaution,
      rueckzahlungsbetrag,
      zinsen,
      einbehalten,
    };
  });
}

/**
 * Rückgabe abschließen — vollständig transaktional mit FOR UPDATE.
 *
 * - zahlungsreferenz ist Pflichtfeld
 * - Status muss 'rueckzahlung_angefordert' sein (FOR UPDATE verhindert Race-Condition)
 * - Statuswechsel und Abschlussbewegung atomar in einer Transaktion
 */
export async function completeReturn(kautionId: string, zahlungsreferenz: string, organizationId?: string) {
  if (!zahlungsreferenz || zahlungsreferenz.trim().length === 0) {
    throw new Error("Zahlungsreferenz ist ein Pflichtfeld für den Kautionsabschluss");
  }

  return db.transaction(async (tx) => {
    // Mit organizationId org-gebundener Lock-SELECT (Defense-in-Depth zu RLS).
    const [kaution] = await tx.select().from(schema.kautionen)
      .where(organizationId
        ? and(eq(schema.kautionen.id, kautionId), eq(schema.kautionen.organizationId, organizationId))
        : eq(schema.kautionen.id, kautionId))
      .for('update');

    if (!kaution) throw new Error("Kaution nicht gefunden");
    if (kaution.status !== 'rueckzahlung_angefordert') {
      throw new Error("Kaution muss im Status 'rueckzahlung_angefordert' sein um abgeschlossen zu werden");
    }

    const today = new Date().toISOString().split('T')[0]!;
    const rueckzahlungsdatum = kaution.rueckzahlungsdatum || today;

    // Org-Autorisierung erfolgt oben im org-gebundenen Lock-SELECT (bzw. via
    // RLS); das organization_id-Prädikat hier sichert nur Konsistenz ab.
    await tx.update(schema.kautionen)
      .set({
        status: 'zurueckgezahlt',
        rueckzahlungsdatum,
        zahlungsreferenz: zahlungsreferenz.trim(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.kautionen.id, kautionId),
        eq(schema.kautionen.organizationId, kaution.organizationId)
      ));

    // Ledger-Buchung erst hier: Zahlung ist jetzt durch Zahlungsreferenz belegt.
    // Netto-Ansatz: -(betrag + zinsen - einbehalten). Einbehalt ist auf dem
    // Kautionsdatensatz dokumentiert und nicht als separate Buchung erforderlich.
    const rueckzahlungsbetrag = parseFloat(String(kaution.rueckzahlungsbetrag || '0'));
    const einbehalten = parseFloat(String(kaution.einbehaltenBetrag || '0'));

    await tx.insert(schema.kautionsBewegungen).values({
      kautionId,
      datum: rueckzahlungsdatum,
      betrag: String(-rueckzahlungsbetrag),
      typ: 'rueckzahlung',
      // zahlungsreferenz strukturiert im dedizierten Feld — dient als
      // maschinenlesbarer Zahlungsnachweis (nicht nur in der Beschreibung)
      zahlungsreferenz: zahlungsreferenz.trim(),
      beschreibung: einbehalten > 0
        ? `Rückzahlung: € ${rueckzahlungsbetrag.toFixed(2)} (Einbehalt € ${einbehalten.toFixed(2)}: ${kaution.einbehaltenGrund || 'ohne Angabe'})`
        : `Rückzahlung: € ${rueckzahlungsbetrag.toFixed(2)}`,
    });

    const [finalKaution] = await tx.select().from(schema.kautionen)
      .where(eq(schema.kautionen.id, kautionId));

    return finalKaution;
  });
}

export async function getKautionOverview(orgId: string) {
  const allKautionen = await db.select().from(schema.kautionen)
    .where(eq(schema.kautionen.organizationId, orgId));

  const active = allKautionen.filter(k => k.status === 'aktiv');
  const pendingReturn = allKautionen.filter(k => k.status === 'rueckzahlung_angefordert');

  const totalActiveAmount = roundMoney(
    active.reduce((sum, k) => sum + parseFloat(String(k.betrag || '0')), 0)
  );
  const totalAccruedInterest = roundMoney(
    active.reduce((sum, k) => sum + parseFloat(String(k.aufgelaufeneZinsen || '0')), 0)
  );
  const totalPendingReturn = roundMoney(
    pendingReturn.reduce((sum, k) => sum + parseFloat(String(k.rueckzahlungsbetrag || '0')), 0)
  );

  return {
    totalActive: active.length,
    totalActiveAmount,
    totalAccruedInterest,
    totalAmountHeld: roundMoney(totalActiveAmount + totalAccruedInterest),
    pendingReturnCount: pendingReturn.length,
    totalPendingReturn,
    totalReturned: allKautionen.filter(k => k.status === 'zurueckgezahlt').length,
  };
}

export async function getKautionHistory(kautionId: string) {
  return db.select().from(schema.kautionsBewegungen)
    .where(eq(schema.kautionsBewegungen.kautionId, kautionId))
    .orderBy(desc(schema.kautionsBewegungen.datum), desc(schema.kautionsBewegungen.createdAt));
}
