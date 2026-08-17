/**
 * VPI-Import-Service
 *
 * Strategien (in Reihenfolge):
 * 1. Auto-Fetch vom Statistik Austria OGD-JSON-API
 * 2. CSV-Parsing (Upload vom Benutzer)
 *
 * Statistik Austria OGD-API Dokumentation:
 * https://data.statistik.gv.at/ogd/json?dataset=<dataset_id>
 *
 * VPI-Datensatz (Basis 2020=100, monatliche Indexwerte):
 * OGD_VPI2020_VJM_1 — Verbraucherpreisindex 2020 (Indexwerte je Monat)
 */

import { db, rootDb } from "../db";
import { sql } from "drizzle-orm";
import { VPI_ADVISORY_LOCK_ID } from "./vpiLock";

// ── Typen ────────────────────────────────────────────────────────────────────

export interface VpiImportRow {
  year: number;
  month: number;
  value: number;
}

export interface VpiImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  /** Zeilen die wegen bestehender Referenzen NICHT überschrieben wurden (mit Grund). */
  warnings: string[];
  source: string;
}

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────

/** Österreichische Monatsabkürzungen → Monatsnummer */
const AUSTRIAN_MONTHS: Record<string, number> = {
  JÄN: 1, JAN: 1,
  FEB: 2,
  MÄR: 3, MAR: 3, MRZ: 3,
  APR: 4,
  MAI: 5, MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OKT: 10, OCT: 10,
  NOV: 11,
  DEZ: 12, DEC: 12,
};

/**
 * Parst OGD-Zeitcode in { year, month }.
 * Unterstützte Formate: "TJÄN2020", "TFEB2021", "T012022"
 */
function parseOgdTimeCode(code: string): { year: number; month: number } | null {
  // Buchstaben-Abkürzung: TJÄN2020, TFEB2021, ...
  const alphaMatch = code.match(/^T([A-ZÄÖÜ]+)(\d{4})$/i);
  if (alphaMatch) {
    const monthStr = alphaMatch[1].toUpperCase();
    const year = parseInt(alphaMatch[2], 10);
    const month = AUSTRIAN_MONTHS[monthStr];
    if (month && year >= 2000) return { year, month };
  }
  // Numerisch: T012022, T122020, ...
  const numMatch = code.match(/^T(\d{2})(\d{4})$/);
  if (numMatch) {
    const month = parseInt(numMatch[1], 10);
    const year = parseInt(numMatch[2], 10);
    if (month >= 1 && month <= 12 && year >= 2000) return { year, month };
  }
  return null;
}

/**
 * Bereinigt Dezimaltrennzeichen: "100,4" → 100.4
 */
function parseDecimal(raw: string): number | null {
  const cleaned = String(raw).replace(',', '.').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

// ── OGD-API-Import ───────────────────────────────────────────────────────────

const STATISTIK_AUSTRIA_OGD_URL =
  "https://data.statistik.gv.at/ogd/json?dataset=OGD_VPI2020_VJM_1";

/**
 * Versucht VPI-Daten vom Statistik Austria OGD-API abzurufen und zu parsen.
 *
 * Statistik Austria OGD-JSON-Format (vereinfacht):
 * {
 *   "database": {
 *     "measures":   [{ "code": "F-VPI2020", ... }],
 *     "dimensions": [{ "code": "...", "role": "TIME",
 *                      "annotationList": [{ "code": "TJÄN2020", ... }, ...] }]
 *   },
 *   "value": [100.0, 100.4, ...]
 * }
 */
/**
 * Versucht, VPI-CSV direkt von der Statistik Austria-Website herunterzuladen.
 *
 * Statistik Austria stellt VPI-Daten als CSV-Dateien bereit. Wir probieren
 * mehrere bekannte URLs nacheinander, da sich Pfade gelegentlich ändern.
 *
 * Tipp: Falls alle Versuche scheitern (Firewall, geänderter Pfad), soll das
 * Frontend den Benutzer direkt auf die Download-Seite weiterleiten.
 */
export async function fetchVpiFromStatistikAustria(
  timeoutMs = 10_000,
): Promise<VpiImportRow[]> {
  // Mehrere bekannte URLs von Statistik Austria (ältere + neuere Pfade)
  const CANDIDATE_URLS = [
    "https://data.statistik.gv.at/data/OGD_VPI2020_VJM_1_HEADER.csv",
    "https://data.statistik.gv.at/data/OGD_VPI2020_VJM_1.csv",
    "https://www.statistik.at/fileadmin/pages/Statistik_Austria/Publikationen/preise/VPI_Jahresergebnisse.csv",
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let lastError: string = "";

  for (const url of CANDIDATE_URLS) {
    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "text/csv,text/plain,*/*" },
      });

      if (!resp.ok) {
        lastError = `HTTP ${resp.status} von ${url}`;
        continue;
      }

      const raw = await resp.text();

      if (!raw || raw.trim().length === 0) {
        lastError = `Leere Antwort von ${url}`;
        continue;
      }

      // Versuche als CSV zu parsen
      try {
        const rows = parseVpiCsv(raw);
        if (rows.length > 0) {
          clearTimeout(timer);
          return rows;
        }
        lastError = `Keine VPI-Zeilen in Antwort von ${url}`;
      } catch (parseErr: any) {
        lastError = `CSV-Parse-Fehler von ${url}: ${parseErr.message}`;
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        clearTimeout(timer);
        throw new Error(
          "Zeitüberschreitung beim Abruf von Statistik Austria (> 10 s). " +
          "Bitte VPI-Daten manuell herunterladen und per CSV-Upload importieren.",
        );
      }
      lastError = `Netzwerkfehler bei ${url}: ${err.message}`;
    }
  }

  clearTimeout(timer);
  throw new Error(
    `Statistik Austria automatisch nicht erreichbar (${lastError}). ` +
    "Bitte die VPI-Tabelle manuell von statistik.at herunterladen und per CSV-Upload importieren.",
  );
}

// ── CSV-Parser ───────────────────────────────────────────────────────────────

/**
 * Parst VPI-CSV-Dateien von Statistik Austria.
 *
 * Unterstützte Formate:
 *
 * Format A (Matrix):
 *   Jahr;Jän;Feb;Mär;Apr;Mai;Jun;Jul;Aug;Sep;Okt;Nov;Dez
 *   2020;100,0;100,4;...
 *
 * Format B (Liste):
 *   Jahr;Monat;VPI
 *   2020;1;100,0
 *   2020;2;100,4
 *
 * Format C (Monat als Text):
 *   2020;Jänner;100,0
 *
 * Trennzeichen: **ausschließlich Semikolon** (Statistik-Austria-Standard).
 * Dezimalzeichen: Komma oder Punkt.
 *
 * Komma-getrennte CSV-Dateien werden bewusst abgelehnt, da Komma gleichzeitig
 * Dezimaltrennzeichen sein kann und dann stille Datenfehler entstehen würden.
 */
export function parseVpiCsv(csvText: string): VpiImportRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (lines.length < 2) {
    throw new Error("CSV enthält zu wenige Zeilen (mindestens Kopfzeile + eine Datenzeile)");
  }

  // Semikolon zwingend erforderlich
  if (!lines[0].includes(";")) {
    throw new Error(
      "CSV-Format nicht erkannt: Semikolon als Trennzeichen erwartet, keines gefunden. " +
      "Bitte speichern Sie die Datei mit Semikolon-Trennung (Windows-Standard in Österreich).",
    );
  }

  const sep = ";";
  const header = lines[0].split(sep).map((h) => h.trim().replace(/"/g, ""));

  const rows: VpiImportRow[] = [];

  // ── Format A: Spalten = Monate (Jän, Feb, …) ─────────────────────────────
  const monthCols: { colIdx: number; month: number }[] = [];
  header.forEach((h, i) => {
    const month = AUSTRIAN_MONTHS[h.toUpperCase()];
    if (month) monthCols.push({ colIdx: i, month });
  });

  const yearColIdx = header.findIndex(
    (h) => h.toLowerCase() === "jahr" || h.toLowerCase() === "year",
  );

  if (monthCols.length >= 1) {
    // Format A
    for (let li = 1; li < lines.length; li++) {
      const cols = lines[li].split(sep).map((c) => c.trim().replace(/"/g, ""));
      const yearIdx = yearColIdx >= 0 ? yearColIdx : 0;
      const year = parseInt(cols[yearIdx], 10);
      if (isNaN(year) || year < 2000 || year > 2100) continue;

      for (const { colIdx, month } of monthCols) {
        if (colIdx >= cols.length) continue;
        const value = parseDecimal(cols[colIdx]);
        if (value !== null && value > 0) {
          rows.push({ year, month, value });
        }
      }
    }
    return rows;
  }

  // ── Format B/C: Liste (Jahr;Monat;VPI) ──────────────────────────────────
  const monatColIdx = header.findIndex(
    (h) => h.toLowerCase() === "monat" || h.toLowerCase() === "month",
  );
  const vpiColIdx = header.findIndex(
    (h) =>
      h.toUpperCase().includes("VPI") ||
      h.toLowerCase() === "wert" ||
      h.toLowerCase() === "value" ||
      h.toLowerCase() === "index",
  );

  if (yearColIdx < 0 || vpiColIdx < 0) {
    throw new Error(
      `CSV-Format nicht erkannt. Erwartete Spalten: "Jahr", "Monat", "VPI". ` +
      `Gefundene Spalten: ${header.join(", ")}`,
    );
  }

  for (let li = 1; li < lines.length; li++) {
    const cols = lines[li].split(sep).map((c) => c.trim().replace(/"/g, ""));
    const year = parseInt(cols[yearColIdx], 10);
    if (isNaN(year) || year < 2000 || year > 2100) continue;

    const value = parseDecimal(cols[vpiColIdx]);
    if (value === null || value <= 0) continue;

    // Monat als Zahl oder Text
    let month: number | null = null;
    if (monatColIdx >= 0) {
      const rawMonth = cols[monatColIdx];
      const asNum = parseInt(rawMonth, 10);
      if (!isNaN(asNum) && asNum >= 1 && asNum <= 12) {
        month = asNum;
      } else {
        month = AUSTRIAN_MONTHS[rawMonth.toUpperCase()] ?? null;
      }
    }
    if (!month) continue;

    rows.push({ year, month, value });
  }

  return rows;
}

// ── Datenbank-Upsert ─────────────────────────────────────────────────────────

/**
 * Liest und schreibt VPI-Werte in die `vpi_values`-Tabelle (upsert).
 * Gibt Import-Statistik zurück.
 */
export async function upsertVpiRows(
  rows: VpiImportRow[],
  source: string,
): Promise<VpiImportResult> {
  if (rows.length === 0) {
    return { imported: 0, skipped: 0, errors: ["Keine gültigen Zeilen zum Importieren"], warnings: [], source };
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const warnings: string[] = [];

  // Alle Upserts in EINER Transaktion mit EXKLUSIVEM VPI-Advisory-Lock:
  // Kein gleichzeitiger POST /api/vpi/apply (SHARED Lock) kann einen Wert als
  // Referenz committen während wir hier Referenzen prüfen und überschreiben —
  // gleiche Strategie wie DELETE /api/vpi/values/:id (Löschschutz, Task-Vorbild).
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${VPI_ADVISORY_LOCK_ID})`);

    for (const row of rows) {
      // Sanity-Check
      if (row.month < 1 || row.month > 12 || row.year < 2000 || row.year > 2100) {
        errors.push(`Ungültige Werte: Jahr=${row.year}, Monat=${row.month}`);
        skipped++;
        continue;
      }
      if (row.value <= 0 || row.value > 10_000) {
        errors.push(`Unplausibler VPI-Wert: ${row.value} (${row.year}/${row.month})`);
        skipped++;
        continue;
      }

      try {
        // Bestehenden Wert laden: Ein Überschreiben mit anderem Wert darf
        // referenzierte Werte NICHT still ändern (Löschschutz-Parität).
        const existing = await tx.execute(sql`
          SELECT value FROM vpi_values WHERE year = ${row.year} AND month = ${row.month}
        `);
        if (existing.rows.length) {
          const oldValue = String((existing.rows[0] as any).value);
          const valueChanges = Number(oldValue) !== row.value;

          if (valueChanges) {
            const refReason = await checkVpiValueReferences(oldValue);
            if (refReason) {
              warnings.push(
                `Übersprungen: ${row.year}/${row.month} (bestehender Wert ${oldValue} wird ${refReason}; nicht überschrieben)`,
              );
              skipped++;
              continue;
            }
          }
        }

        await tx.execute(sql`
          INSERT INTO vpi_values (year, month, value, source)
          VALUES (${row.year}, ${row.month}, ${row.value.toString()}, ${source})
          ON CONFLICT (year, month) DO UPDATE
            SET value = EXCLUDED.value, source = EXCLUDED.source, updated_at = NOW()
        `);
        imported++;
      } catch (err: any) {
        errors.push(`DB-Fehler für ${row.year}/${row.month}: ${err.message}`);
        skipped++;
      }
    }
  });

  return { imported, skipped, errors, warnings, source };
}

/**
 * Prüft ob ein VPI-Wert von Mietverträgen oder Indexanpassungen referenziert
 * wird (gleiche Checks wie DELETE /api/vpi/values/:id).
 *
 * rootDb: VPI-Werte sind global (org-unabhängig); Referenzen können in jeder
 * Org liegen — die Prüfung muss org-übergreifend erfolgen.
 *
 * @returns Beschreibung der Referenz, oder null wenn unreferenziert.
 */
async function checkVpiValueReferences(value: string): Promise<string | null> {
  const tenantRef = await rootDb.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM tenants
    WHERE vpi_base IS NOT NULL
      AND vpi_base::numeric = ${value}::numeric
      AND deleted_at IS NULL
  `);
  if ((tenantRef.rows[0] as any).cnt > 0) {
    return "als Referenzwert in aktiven Mietverträgen verwendet";
  }

  const adjRef = await rootDb.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM vpi_adjustments
    WHERE vpi_new::numeric = ${value}::numeric
  `);
  if ((adjRef.rows[0] as any).cnt > 0) {
    return "in Indexanpassungen als neuer Basiswert verwendet";
  }

  return null;
}

// ── Kombinierte Importer ─────────────────────────────────────────────────────

/** Auto-Import von Statistik Austria + DB-Upsert */
export async function importVpiFromStatistikAustria(): Promise<VpiImportResult> {
  const rows = await fetchVpiFromStatistikAustria();
  return upsertVpiRows(rows, "statistik.at");
}

/** CSV-Import + DB-Upsert */
export async function importVpiFromCsv(csvText: string): Promise<VpiImportResult> {
  const rows = parseVpiCsv(csvText);
  if (rows.length === 0) {
    throw new Error(
      "CSV enthält keine lesbaren VPI-Zeilen. " +
      "Bitte prüfen Sie das Format (Jahr;Monat;VPI oder Jahres-Matrix).",
    );
  }
  return upsertVpiRows(rows, "csv-upload");
}
