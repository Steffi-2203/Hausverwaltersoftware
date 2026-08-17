/**
 * exportOPListe — Restbetrag-Spalten bei Teilzahlungen
 *
 * Prueft dass:
 *  1. Die Spalten "Davon bezahlt" und "Restbetrag" im XLSX vorhanden sind
 *  2. Teilbezahlte Zeilen: Restbetrag = gesamtbetrag − paid_amount
 *  3. Offene Zeilen:       Davon bezahlt = 0,  Restbetrag = gesamtbetrag
 *  4. Vollstaendig bezahlte Zeilen werden vom Aufrufer herausgefiltert —
 *     exportOPListe selbst rechnet: Restbetrag = gesamtbetrag − paid_amount = 0
 */

import { describe, test } from 'node:test';
import { expect } from '../helpers/expect';

import * as XLSX from 'xlsx';
import { exportOPListe } from '../../server/services/xlsxExportService';

// ── Hilfsfunktion: XLSX-Buffer → 2D-Array ab Zeile 1 (Datenzeilen) ───────────
function parseSheet(buf: Buffer): string[][] {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // aoa_to_sheet kehrt zu AOA um
  const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  return aoa.map((row) => row.map((cell: any) => String(cell ?? '')));
}

// Titelzeilen: Zeile 0 = Titel, 1 = Org, 2 = Erstellt, 3 = leer, 4 = Header
const HEADER_ROW = 4;
const DATA_START  = 5;

function headerRow(rows: string[][]): string[] {
  return rows[HEADER_ROW] || [];
}

function dataRow(rows: string[][], idx = 0): string[] {
  return rows[DATA_START + idx] || [];
}

// ── Testdaten ─────────────────────────────────────────────────────────────────
const sampleData = [
  {
    id:             'id-offen',
    tenantName:     'Max Offen',
    unitTopNummer:  'Top 1',
    gesamtbetrag:   '500.00',
    paidAmount:     null,
    status:         'offen',
    faellig_am:     '2030-01-31',
  },
  {
    id:             'id-teil',
    tenantName:     'Erika Teilzahlerin',
    unitTopNummer:  'Top 2',
    gesamtbetrag:   '300.00',
    paidAmount:     '100.00',     // paid → Restbetrag 200
    status:         'teilbezahlt',
    faellig_am:     '2030-02-28',
  },
  {
    id:             'id-snake',  // snake_case-Variante (falls Route so liefert)
    tenantName:     'Otto Snake',
    unitTopNummer:  'Top 3',
    gesamtbetrag:   '250.00',
    paid_amount:    '50.00',      // snake_case → Restbetrag 200
    status:         'teilbezahlt',
    faellig_am:     '2030-03-31',
  },
];

describe('exportOPListe — Restbetrag-Spalten', () => {
  const buf  = exportOPListe(sampleData, 'Test-Org');
  const rows = parseSheet(buf);

  // ── Spaltenstruktur ─────────────────────────────────────────────────────────

  test('Header enthaelt "Davon bezahlt"', () => {
    expect(headerRow(rows)).toContain('Davon bezahlt');
  });

  test('Header enthaelt "Restbetrag"', () => {
    expect(headerRow(rows)).toContain('Restbetrag');
  });

  test('Spaltenreihenfolge: Betrag → Davon bezahlt → Restbetrag', () => {
    const h    = headerRow(rows);
    const iBet = h.indexOf('Betrag');
    const iPaid = h.indexOf('Davon bezahlt');
    const iRest = h.indexOf('Restbetrag');
    expect(iBet).toBeGreaterThanOrEqual(0);
    expect(iPaid).toBe(iBet + 1);
    expect(iRest).toBe(iBet + 2);
  });

  // ── Offene Zeile (paid_amount = null) ──────────────────────────────────────

  test('Offene Zeile: Davon bezahlt = 0,00', () => {
    const h    = headerRow(rows);
    const iPaid = h.indexOf('Davon bezahlt');
    const cell = dataRow(rows, 0)[iPaid];
    expect(cell).toContain('0,00');
  });

  test('Offene Zeile: Restbetrag = gesamtbetrag (500)', () => {
    const h    = headerRow(rows);
    const iRest = h.indexOf('Restbetrag');
    const cell = dataRow(rows, 0)[iRest];
    expect(cell).toContain('500');
  });

  // ── Teilbezahlte Zeile (paidAmount camelCase) ──────────────────────────────

  test('Teilbezahlte Zeile (camelCase): Davon bezahlt = 100', () => {
    const h    = headerRow(rows);
    const iPaid = h.indexOf('Davon bezahlt');
    const cell = dataRow(rows, 1)[iPaid];
    expect(cell).toContain('100');
  });

  test('Teilbezahlte Zeile (camelCase): Restbetrag = 200 (300 − 100)', () => {
    const h    = headerRow(rows);
    const iRest = h.indexOf('Restbetrag');
    const cell = dataRow(rows, 1)[iRest];
    expect(cell).toContain('200');
  });

  // ── Teilbezahlte Zeile (paid_amount snake_case) ────────────────────────────

  test('Teilbezahlte Zeile (snake_case): Davon bezahlt = 50', () => {
    const h    = headerRow(rows);
    const iPaid = h.indexOf('Davon bezahlt');
    const cell = dataRow(rows, 2)[iPaid];
    expect(cell).toContain('50');
  });

  test('Teilbezahlte Zeile (snake_case): Restbetrag = 200 (250 − 50)', () => {
    const h    = headerRow(rows);
    const iRest = h.indexOf('Restbetrag');
    const cell = dataRow(rows, 2)[iRest];
    expect(cell).toContain('200');
  });

  // ── Gesamtanzahl Spalten ────────────────────────────────────────────────────

  test('10 Spalten im Header (inkl. "Typ")', () => {
    expect(headerRow(rows).filter(Boolean).length).toBe(10);
  });
});
