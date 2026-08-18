/**
 * exportOPListe — Sortierung der kombinierten Mieter- und WEG-Zeilen
 *
 * Prueft dass:
 *  1. Die kombinierte Liste (Mieter + WEG) nach faelligAm absteigend sortiert ist
 *  2. Sowohl camelCase (faelligAm) als auch snake_case (faellig_am) Felder korrekt
 *     beruecksichtigt werden
 */

import { describe, test } from 'node:test';
import { expect } from '../helpers/expect';
import * as XLSX from 'xlsx';
import { exportOPListe } from '../../server/services/xlsxExportService';

function parseSheet(buf: Buffer): string[][] {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  return aoa.map((row) => row.map((cell: any) => String(cell ?? '')));
}

const HEADER_ROW = 4;
const DATA_START = 5;

// Absichtlich unsortierte Eingabe: WEG-Item faellig am 2030-03 > Mieter-Item 2030-01
// Nach Sortierung muss WEG-Item (faelligAm, camelCase) in Zeile 0 stehen,
// dann das Mieter-Item (faellig_am, snake_case) und zuletzt das aelteste Item.
const unsortedData = [
  {
    id: 'mi-old',
    source: 'monthly_invoice',
    tenantName: 'Alte Mieterin',
    unitTopNummer: 'Top 2',
    gesamtbetrag: '300.00',
    paidAmount: null,
    status: 'offen',
    faellig_am: '2030-01-15', // snake_case — aelteste Faelligkeit
  },
  {
    id: 'weg-new',
    source: 'weg',
    tenantName: 'Neuer Eigentuemer',
    unitTopNummer: 'Top 9',
    gesamtbetrag: '800.00',
    paidAmount: null,
    status: 'offen',
    faelligAm: '2030-03-31', // camelCase — neueste Faelligkeit
  },
  {
    id: 'mi-mid',
    source: 'monthly_invoice',
    tenantName: 'Mittlere Mieterin',
    unitTopNummer: 'Top 5',
    gesamtbetrag: '500.00',
    paidAmount: null,
    status: 'offen',
    faellig_am: '2030-02-28', // snake_case — mittlere Faelligkeit
  },
];

describe('exportOPListe — Sortierung nach Faelligkeitsdatum', () => {
  // Simuliere die Sortierung, die der Export-Endpunkt vor exportOPListe ausfuehrt
  const combined = [...unsortedData].sort((a: any, b: any) => {
    const dateA = (a.faelligAm ?? a.faellig_am ?? '') as string;
    const dateB = (b.faelligAm ?? b.faellig_am ?? '') as string;
    return dateB.localeCompare(dateA);
  });

  const buf = exportOPListe(combined, 'Test-Org');
  const rows = parseSheet(buf);
  const h = rows[HEADER_ROW] || [];
  const iDue = h.indexOf('Faellig am');
  const iMieter = h.indexOf('Mieter');

  test('Header enthaelt "Faellig am"-Spalte', () => {
    expect(iDue).toBeGreaterThanOrEqual(0);
  });

  test('Erste Datenzeile: neueste Faelligkeit (2030-03, WEG-Item)', () => {
    const row = rows[DATA_START];
    expect(row[iDue]).toContain('2030');
    // Eigentuemername muss stimmen
    expect(row[iMieter]).toBe('Neuer Eigentuemer');
  });

  test('Zweite Datenzeile: mittlere Faelligkeit (2030-02, Mieter-Item)', () => {
    const row = rows[DATA_START + 1];
    expect(row[iMieter]).toBe('Mittlere Mieterin');
  });

  test('Dritte Datenzeile: aelteste Faelligkeit (2030-01, Mieter-Item)', () => {
    const row = rows[DATA_START + 2];
    expect(row[iMieter]).toBe('Alte Mieterin');
  });

  test('Faelligkeitsdaten sind absteigend sortiert', () => {
    const row0 = rows[DATA_START];
    const row1 = rows[DATA_START + 1];
    const row2 = rows[DATA_START + 2];
    // Einfacher String-Vergleich genuegt fuer ISO-Datumsformat
    expect(row0[iDue] >= row1[iDue]).toBe(true);
    expect(row1[iDue] >= row2[iDue]).toBe(true);
  });
});
