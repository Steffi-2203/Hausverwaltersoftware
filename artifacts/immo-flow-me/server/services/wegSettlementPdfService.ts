/**
 * WEG-Jahresabrechnung HTML-Renderer (§ 34 WEG 2002)
 *
 * Rendert eine vollständige, druckbare WEG-Jahresabrechnung als HTML-Dokument.
 * Organisationsname und IBAN kommen aus der organizations-Tabelle, nie hardcodiert.
 */
import { rootDb as db } from "../db"; // service functions called directly from tests
import { eq, and, inArray } from "drizzle-orm";
import * as schema from "@shared/schema";
import { decryptIbanFields } from "../lib/fieldEncryption";

function eur(amount: number | string | null | undefined): string {
  const n = Number(amount) || 0;
  return n.toLocaleString("de-AT", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
}

function pct(ratio: number | string | null | undefined, digits = 4): string {
  const n = Number(ratio) || 0;
  return (n * 100).toFixed(digits) + "\u202F‰"; // display as MEA per mille
}

export async function renderWegSettlementHtml(
  settlementId: string,
  orgId: string,
  /** Wenn gesetzt, wird nur die Sektion dieses Eigentümers gerendert (für E-Mail-Versand). */
  ownerId?: string
): Promise<string> {
  // ── Load settlement ────────────────────────────────────────────────────────
  const [settlement] = await db
    .select()
    .from(schema.wegSettlements)
    .where(
      and(
        eq(schema.wegSettlements.id, settlementId),
        eq(schema.wegSettlements.organizationId, orgId)
      )
    )
    .limit(1);

  if (!settlement) throw new Error("Abrechnung nicht gefunden");

  const allDetails = await db
    .select()
    .from(schema.wegSettlementDetails)
    .where(eq(schema.wegSettlementDetails.settlementId, settlementId));

  // Wenn ownerId angegeben: nur die Sektion dieses Eigentümers rendern (DSGVO-konformer E-Mail-Versand)
  const details = ownerId
    ? allDetails.filter(d => d.ownerId === ownerId)
    : allDetails;

  // ── Load supplemental data ─────────────────────────────────────────────────
  const [property] = await db
    .select()
    .from(schema.properties)
    .where(eq(schema.properties.id, settlement.propertyId))
    .limit(1);

  const [rawOrg] = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId))
    .limit(1);
  const org = rawOrg ? decryptIbanFields(rawOrg) : undefined;

  const ownerIds = [...new Set(details.map(d => d.ownerId))];
  const unitIds = [...new Set(details.map(d => d.unitId))];

  const [ownersData, unitsData] = await Promise.all([
    ownerIds.length > 0
      ? db.select().from(schema.owners).where(inArray(schema.owners.id, ownerIds))
      : Promise.resolve([]),
    unitIds.length > 0
      ? db.select().from(schema.units).where(inArray(schema.units.id, unitIds))
      : Promise.resolve([]),
  ]);

  const ownerMap = new Map(ownersData.map(o => [o.id, o]));
  const unitMap = new Map(unitsData.map(u => [u.id, u]));

  // ── Derive aggregate values ────────────────────────────────────────────────
  const totalSonderumlagen = details.reduce(
    (s, d) => s + (Number(d.sonderumlagen) || 0), 0
  );
  const totalRuecklage = details.reduce(
    (s, d) => s + (Number(d.ruecklageAnteil) || 0), 0
  );

  const orgName = org?.brandName || org?.name || "Hausverwaltung";
  const orgIban = org?.iban || "";
  const orgBic = org?.bic || "";
  const orgAddress = [org?.address, org?.postalCode, org?.city].filter(Boolean).join(", ");

  // ── Render ─────────────────────────────────────────────────────────────────
  const ownerSections = details.map(detail => {
    const owner = ownerMap.get(detail.ownerId);
    const unit = unitMap.get(detail.unitId);
    const ownerName = owner ? `${owner.firstName} ${owner.lastName}` : "Unbekannt";
    const topNummer = unit?.topNummer || "?";

    const categories: any[] = Array.isArray(detail.categoryDetails)
      ? detail.categoryDetails
      : [];

    // Split into Rücklage vs. laufende Aufwände
    const ruecklageCategories = categories.filter(c =>
      c.allocationKey === "Rücklage" ||
      String(c.category || "").toLowerCase().includes("rücklage") ||
      String(c.category || "").toLowerCase().includes("ruecklage")
    );
    const laufendeCategories = categories.filter(c =>
      !ruecklageCategories.includes(c)
    );

    const categoryRows = (cats: any[], label: string) => cats.length === 0 ? "" : `
      <tr class="section-header"><td colspan="4">${label}</td></tr>
      ${cats.map(c => `
        <tr>
          <td class="indent">${c.label || c.category}</td>
          <td class="center">${c.allocationKey || "MEA"}</td>
          <td class="right">${eur(c.totalCost)}</td>
          <td class="right">${eur(c.ownerShare)}</td>
        </tr>`).join("")}`;

    const saldo = Number(detail.saldo) || 0;
    const saldoClass = saldo > 0 ? "amount-negative" : saldo < 0 ? "amount-positive" : "";
    const saldoLabel = saldo > 0
      ? "Nachzahlung"
      : saldo < 0
        ? "Guthaben"
        : "Ausgeglichen";

    return `
    <div class="owner-section">
      <h3>Top ${topNummer} — ${ownerName}</h3>
      <p class="meta">
        MEA-Anteil: <strong>${(Number(detail.meaRatio) * 1000).toFixed(4)}‰</strong>
        ${Number(detail.meaShare) > 0 ? `(${Number(detail.meaShare).toFixed(4)} von ${Number(settlement.totalMea).toFixed(4)})` : ""}
      </p>
      <table>
        <thead>
          <tr>
            <th>Kategorie</th>
            <th>Schlüssel</th>
            <th class="right">Gesamtkosten</th>
            <th class="right">Ihr Anteil</th>
          </tr>
        </thead>
        <tbody>
          ${categoryRows(laufendeCategories, "Laufende Aufwände")}
          ${categoryRows(ruecklageCategories, "Rücklage")}
          ${Number(detail.sonderumlagen) > 0 ? `
          <tr class="section-header"><td colspan="4">Sonderumlagen</td></tr>
          <tr>
            <td class="indent">Sonderumlage (beschlossen)</td>
            <td class="center">MEA</td>
            <td class="right">—</td>
            <td class="right">${eur(detail.sonderumlagen)}</td>
          </tr>` : ""}
        </tbody>
        <tfoot>
          <tr class="subtotal">
            <td colspan="3">Gesamtvorschreibung (Soll)</td>
            <td class="right">${eur(detail.totalSoll)}</td>
          </tr>
          <tr>
            <td colspan="3">Geleistete Vorschreibungen (Ist)</td>
            <td class="right">${eur(detail.totalIst)}</td>
          </tr>
          <tr class="saldo-row ${saldoClass}">
            <td colspan="3"><strong>Saldo (${saldoLabel})</strong></td>
            <td class="right"><strong>${eur(Math.abs(saldo))} ${saldo > 0 ? "▲" : saldo < 0 ? "▼" : ""}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WEG-Jahresabrechnung ${settlement.year} — ${property?.name || ""}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Segoe UI", Arial, sans-serif; font-size: 13px; color: #1a1a1a; background: #fff; }
    .page { max-width: 900px; margin: 0 auto; padding: 32px 40px; }

    /* Header */
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px; }
    .header .org { font-size: 11px; color: #555; }
    .header .title h1 { font-size: 20px; font-weight: 700; color: #1e3a5f; }
    .header .title h2 { font-size: 14px; font-weight: 400; color: #555; margin-top: 4px; }

    /* Summary box */
    .summary { background: #f0f6ff; border: 1px solid #bdd7ff; border-radius: 6px; padding: 16px; margin-bottom: 28px; }
    .summary table { width: 100%; border-collapse: collapse; }
    .summary td { padding: 4px 8px; }
    .summary td:last-child { text-align: right; font-weight: 600; }
    .summary .divider td { border-top: 1px solid #bdd7ff; padding-top: 8px; }

    /* Owner sections */
    .owner-section { border: 1px solid #dde4f0; border-radius: 6px; margin-bottom: 24px; overflow: hidden; }
    .owner-section h3 { background: #1e3a5f; color: #fff; padding: 10px 16px; font-size: 14px; }
    .owner-section .meta { padding: 8px 16px; background: #f8faff; font-size: 12px; color: #444; border-bottom: 1px solid #e4eaf5; }
    .owner-section table { width: 100%; border-collapse: collapse; }
    .owner-section th { background: #e8eef9; padding: 6px 10px; font-size: 11px; text-align: left; border-bottom: 1px solid #cdd8ef; }
    .owner-section td { padding: 5px 10px; border-bottom: 1px solid #f0f0f0; }
    .indent { padding-left: 20px !important; }
    .section-header td { background: #f5f7fc; font-weight: 600; font-size: 11px; color: #2563eb; padding: 6px 10px !important; border-bottom: 1px solid #dde4f0 !important; }
    .right { text-align: right; }
    .center { text-align: center; }
    .subtotal td { border-top: 1px solid #cdd8ef; background: #f5f7fc; font-size: 12px; }
    .saldo-row td { font-size: 13px; background: #f0faf0; border-top: 2px solid #4ade80; }
    .amount-negative td { background: #fff0f0 !important; border-top-color: #f87171 !important; color: #b91c1c; }
    .amount-positive td { background: #f0faf0 !important; color: #15803d; }

    /* Footer */
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #dde4f0; font-size: 11px; color: #666; }
    @media print {
      .owner-section { break-inside: avoid; }
      .page { padding: 16px; }
    }
  </style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="title">
      <h1>WEG-Jahresabrechnung ${settlement.year}</h1>
      <h2>${property?.name || ""} — ${property?.address || ""}</h2>
    </div>
    <div class="org">
      <strong>${orgName}</strong><br>
      ${orgAddress ? orgAddress + "<br>" : ""}
      ${orgIban ? `IBAN: ${orgIban}` : ""}
      ${orgBic ? ` · BIC: ${orgBic}` : ""}
    </div>
  </div>

  <div class="summary">
    <h3 style="margin-bottom:12px;color:#1e3a5f;">Gesamtübersicht</h3>
    <table>
      <tr><td>Abrechnungsjahr</td><td>${settlement.year}</td></tr>
      <tr><td>Liegenschaften</td><td>${property?.name || ""}</td></tr>
      <tr><td>Anzahl Eigentümer</td><td>${settlement.ownerCount}</td></tr>
      <tr><td>Gesamt-MEA</td><td>${Number(settlement.totalMea).toFixed(4)}</td></tr>
      <tr><td>Gesamtaufwand (umlagefähig)</td><td>${eur(settlement.totalExpenses)}</td></tr>
      ${totalSonderumlagen > 0 ? `<tr><td>davon Sonderumlagen</td><td>${eur(totalSonderumlagen)}</td></tr>` : ""}
      ${totalRuecklage > 0 ? `<tr><td>davon Rücklage</td><td>${eur(totalRuecklage)}</td></tr>` : ""}
      <tr><td>Geleistete Vorschreibungen</td><td>${eur(settlement.totalPrepayments)}</td></tr>
      <tr class="divider"><td><strong>Gesamtsaldo (alle Eigentümer)</strong></td><td>${eur(settlement.totalDifference)}</td></tr>
      <tr><td>Rücklagenfonds (Stand)</td><td>${eur(settlement.reserveFundBalance)}</td></tr>
    </table>
  </div>

  ${ownerId ? `
  <p style="margin-bottom:16px;font-size:12px;color:#555;background:#fffbeb;border:1px solid #fcd34d;border-radius:4px;padding:8px 12px;">
    Dieser Abschnitt enthält ausschließlich Ihre persönliche Abrechnung.
    Die Abrechnungen der übrigen Eigentümer wurden gemäß DSGVO nicht beigefügt.
  </p>
  <h2 style="margin-bottom:16px;color:#1e3a5f;font-size:16px;">Ihre persönliche Abrechnung</h2>` : `
  <h2 style="margin-bottom:16px;color:#1e3a5f;font-size:16px;">Eigentümer-Einzelabrechnungen</h2>`}
  ${ownerSections}

  <div class="footer">
    <p>Erstellt am ${new Date(settlement.createdAt || Date.now()).toLocaleDateString("de-AT")} · Status: ${settlement.status}</p>
    <p style="margin-top:4px;">Diese Abrechnung wurde automatisch durch IMMO FLOW ME erstellt. Alle Beträge in EUR. Irrtümer vorbehalten.</p>
  </div>

</div>
</body>
</html>`;
}
