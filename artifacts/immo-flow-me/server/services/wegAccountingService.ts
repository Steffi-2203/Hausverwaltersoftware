import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { roundMoney } from "@shared/utils";
import { distributeWithRemainder, getReserveFundBalance } from "./wegSettlementService";
import crypto from "crypto";

export async function bookReserveInterest(
  propertyId: string,
  orgId: string,
  year: number,
  month: number,
  interestAmount: number,
  description: string
): Promise<typeof schema.wegReserveFund.$inferSelect> {
  const [entry] = await db
    .insert(schema.wegReserveFund)
    .values({
      organizationId: orgId,
      propertyId,
      year,
      month,
      amount: roundMoney(interestAmount).toString(),
      description: description || "Zinsen auf Rücklage",
      entryType: "zinsen",
    })
    .returning();

  return entry;
}

export async function withdrawFromReserve(
  propertyId: string,
  orgId: string,
  amount: number,
  description: string,
  voteId?: string,
  isEmergency?: boolean
): Promise<{
  entry: typeof schema.wegReserveFund.$inferSelect;
  updatedBalance: number;
}> {
  if (!isEmergency && !voteId) {
    throw new Error("Entnahme nur mit Beschluss möglich");
  }

  if (isEmergency && !description.startsWith("NOTFALL:")) {
    throw new Error(
      'Notfall-Entnahme erfordert Beschreibung mit Präfix "NOTFALL:"'
    );
  }

  const currentBalance = await getReserveFundBalance(propertyId, orgId);
  if (currentBalance < amount) {
    throw new Error(
      `Unzureichendes Guthaben. Verfügbar: ${currentBalance.toFixed(2)} EUR, angefordert: ${amount.toFixed(2)} EUR`
    );
  }

  const now = new Date();
  const [entry] = await db
    .insert(schema.wegReserveFund)
    .values({
      organizationId: orgId,
      propertyId,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      amount: (-roundMoney(amount)).toString(),
      description,
      entryType: "entnahme",
    })
    .returning();

  const updatedBalance = await getReserveFundBalance(propertyId, orgId);

  return { entry, updatedBalance };
}

export async function bookInsuranceClaim(
  propertyId: string,
  orgId: string,
  params: {
    totalDamage: number;
    insurancePayout: number;
    description: string;
    voteId?: string;
  }
): Promise<{
  entry: typeof schema.wegReserveFund.$inferSelect;
  remainderToDistribute: number;
  isFullyCovered: boolean;
}> {
  const { totalDamage, insurancePayout, description } = params;
  const now = new Date();

  const [entry] = await db
    .insert(schema.wegReserveFund)
    .values({
      organizationId: orgId,
      propertyId,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      amount: roundMoney(insurancePayout).toString(),
      description: `Versicherungsleistung: ${description}`,
      entryType: "versicherung",
    })
    .returning();

  const remainder = roundMoney(totalDamage - insurancePayout);
  const isFullyCovered = remainder <= 0;

  return {
    entry,
    remainderToDistribute: isFullyCovered ? 0 : remainder,
    isFullyCovered,
  };
}

export async function getReserveFundOverview(
  propertyId: string,
  orgId: string
): Promise<{
  currentBalance: number;
  entriesByYear: Record<number, typeof schema.wegReserveFund.$inferSelect[]>;
  interestEarned: number;
  totalWithdrawals: number;
  sonderumlagenTotal: number;
}> {
  const entries = await db
    .select()
    .from(schema.wegReserveFund)
    .where(
      and(
        eq(schema.wegReserveFund.propertyId, propertyId),
        eq(schema.wegReserveFund.organizationId, orgId)
      )
    );

  const currentBalance = entries.reduce(
    (sum, e) => sum + (Number(e.amount) || 0),
    0
  );

  const entriesByYear: Record<
    number,
    typeof schema.wegReserveFund.$inferSelect[]
  > = {};
  let interestEarned = 0;
  let totalWithdrawals = 0;

  for (const entry of entries) {
    const y = entry.year;
    if (!entriesByYear[y]) entriesByYear[y] = [];
    entriesByYear[y].push(entry);

    if (entry.entryType === "zinsen") {
      interestEarned += Number(entry.amount) || 0;
    }
    if (entry.entryType === "entnahme") {
      totalWithdrawals += Math.abs(Number(entry.amount) || 0);
    }
  }

  const specialAssessments = await db
    .select()
    .from(schema.wegSpecialAssessments)
    .where(
      and(
        eq(schema.wegSpecialAssessments.propertyId, propertyId),
        eq(schema.wegSpecialAssessments.organizationId, orgId)
      )
    );

  const sonderumlagenTotal = specialAssessments.reduce(
    (sum, sa) => sum + (Number(sa.totalAmount) || 0),
    0
  );

  return {
    currentBalance: roundMoney(currentBalance),
    entriesByYear,
    interestEarned: roundMoney(interestEarned),
    totalWithdrawals: roundMoney(totalWithdrawals),
    sonderumlagenTotal: roundMoney(sonderumlagenTotal),
  };
}

export async function createSpecialAssessmentInvoices(
  assessmentId: string,
  orgId: string
): Promise<{
  created: typeof schema.wegVorschreibungen.$inferSelect[];
  reserveEntry?: typeof schema.wegReserveFund.$inferSelect;
}> {
  // Alle Finanzbuchungen erfolgen in einer einzigen Transaktion.
  // Der atomische Claim (UPDATE ... WHERE status = 'beschlossen' RETURNING)
  // ist die ERSTE Operation — so wird Doppelfakturierung auch bei
  // gleichzeitigen Requests ausgeschlossen (PostgreSQL READ COMMITTED: nur
  // ein Schreiber kann den Status von 'beschlossen' auf 'in_bearbeitung'
  // ändern; alle anderen sehen danach nicht mehr 'beschlossen' und erhalten 0 Rows).

  const created: typeof schema.wegVorschreibungen.$inferSelect[] = [];
  let reserveEntry: typeof schema.wegReserveFund.$inferSelect | undefined;

  await db.transaction(async (tx) => {
    // ── Schritt 1: Atomischen Claim durchführen ───────────────────────────────
    // UPDATE ... WHERE status = 'beschlossen' ist atomar: genau ein konkurrierender
    // Request erhält eine Row zurück; alle anderen erhalten 0 Rows → Fehler.
    const claimed = await tx
      .update(schema.wegSpecialAssessments)
      .set({ status: 'in_bearbeitung', updatedAt: new Date() })
      .where(
        and(
          eq(schema.wegSpecialAssessments.id, assessmentId),
          eq(schema.wegSpecialAssessments.organizationId, orgId),
          eq(schema.wegSpecialAssessments.status, 'beschlossen')
        )
      )
      .returning();

    if (claimed.length === 0) {
      // Entweder nicht gefunden, falsche Org, oder bereits in Bearbeitung / abgerechnet.
      // Sicherheitshalber den aktuellen Status laden um eine präzise Fehlermeldung zu liefern.
      const [current] = await tx
        .select({ status: schema.wegSpecialAssessments.status })
        .from(schema.wegSpecialAssessments)
        .where(
          and(
            eq(schema.wegSpecialAssessments.id, assessmentId),
            eq(schema.wegSpecialAssessments.organizationId, orgId)
          )
        );
      if (!current) {
        throw new Error("Sonderumlage nicht gefunden");
      }
      if (current.status === 'abgerechnet') {
        throw new Error("Diese Sonderumlage wurde bereits abgerechnet. Doppelte Fakturierung ist nicht zulässig.");
      }
      throw new Error(
        `Fakturierung nicht möglich: Sonderumlage ist im Status '${current.status}'. Nur 'beschlossen' kann fakturiert werden.`
      );
    }

    const assessment = claimed[0];

    // ── Schritt 2: Eigentümer laden ──────────────────────────────────────────
    const unitOwners = await tx
      .select()
      .from(schema.wegUnitOwners)
      .where(
        and(
          eq(schema.wegUnitOwners.propertyId, assessment.propertyId),
          eq(schema.wegUnitOwners.organizationId, orgId)
        )
      );

    if (unitOwners.length === 0) {
      throw new Error("Keine Eigentümer für diese Liegenschaft hinterlegt");
    }

    const totalMea = unitOwners.reduce(
      (s, uo) => s + (Number(uo.meaShare) || 0),
      0
    );
    if (totalMea <= 0) {
      throw new Error("Gesamt-MEA ist 0");
    }

    // ── Schritt 3: Verteilung berechnen ──────────────────────────────────────
    const totalAmount = Number(assessment.totalAmount) || 0;
    const shares = unitOwners.map((uo) => ({
      id: uo.id,
      ratio: (Number(uo.meaShare) || 0) / totalMea,
    }));
    const distributed = distributeWithRemainder(totalAmount, shares);

    const now = new Date();
    const runId = crypto.randomUUID();

    // ── Schritt 4: Vorschreibungen anlegen ───────────────────────────────────
    for (const dist of distributed) {
      const uo = unitOwners.find((u) => u.id === dist.id);
      if (!uo) continue;

      const [vorschreibung] = await tx
        .insert(schema.wegVorschreibungen)
        .values({
          organizationId: orgId,
          propertyId: assessment.propertyId,
          unitId: uo.unitId,
          ownerId: uo.ownerId,
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          meaShare: String(uo.meaShare),
          betriebskosten: "0",
          ruecklage: dist.amount.toString(),
          instandhaltung: "0",
          verwaltungshonorar: "0",
          heizung: "0",
          ust: "0",
          gesamtbetrag: dist.amount.toString(),
          status: "offen",
          faelligAm: assessment.dueDate || undefined,
          runId,
        })
        .returning();

      created.push(vorschreibung);
    }

    // ── Schritt 5: Rücklage-Eintrag (optional) ───────────────────────────────
    // Dauerhaftes boolean-Feld statt fragiles Text-Matching auf Titel/Beschreibung.
    if (assessment.creditsReserveFund === true) {
      const [inserted] = await tx.insert(schema.wegReserveFund).values({
        organizationId: orgId,
        propertyId: assessment.propertyId,
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        amount: totalAmount.toString(),
        description: `Sonderumlage: ${assessment.title}`,
        entryType: "einzahlung",
      }).returning();
      reserveEntry = inserted;
    }

    // ── Schritt 6: Endstatus setzen ──────────────────────────────────────────
    await tx
      .update(schema.wegSpecialAssessments)
      .set({ status: 'abgerechnet', updatedAt: new Date() })
      .where(
        and(
          eq(schema.wegSpecialAssessments.id, assessmentId),
          eq(schema.wegSpecialAssessments.organizationId, orgId)
        )
      );
  });

  return { created, reserveEntry };
}
