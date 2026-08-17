/**
 * exportOPListe — WEG-Vorschreibungen im Excel-Export
 *
 * Prueft dass:
 *  1. Der Header eine "Typ"-Spalte enthaelt
 *  2. Mieter-Zeilen als "Mieter", WEG-Zeilen als "WEG-Eigentuemervorschreibung"
 *     ausgewiesen werden
 *  3. WEG-Zeilen: Mieter-Spalte zeigt den Eigentuemernamen, Einheit die Top-Nummer
 *  4. Restbetrag-Logik (gesamtbetrag − paid_amount) auch fuer WEG-Zeilen gilt
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

const sampleData = [
  {
    id: 'mi-1',
    source: 'monthly_invoice',
    tenantName: 'Max Mieter',
    unitTopNummer: 'Top 1',
    gesamtbetrag: '500.00',
    paidAmount: null,
    status: 'offen',
    faellig_am: '2030-01-31',
  },
  {
    id: 'weg-1',
    source: 'weg',
    tenantName: 'Erika Eigentuemerin',
    unitTopNummer: 'Top 7',
    gesamtbetrag: '400.00',
    paidAmount: '150.00',
    status: 'teilbezahlt',
    faelligAm: '2030-02-28',
  },
];

describe('exportOPListe — WEG-Zeilen', () => {
  const buf = exportOPListe(sampleData, 'Test-Org');
  const rows = parseSheet(buf);
  const h = rows[HEADER_ROW] || [];
  const iTyp = h.indexOf('Typ');
  const iMieter = h.indexOf('Mieter');
  const iEinheit = h.indexOf('Einheit');
  const iPaid = h.indexOf('Davon bezahlt');
  const iRest = h.indexOf('Restbetrag');
  const miRow = rows[DATA_START];
  const wegRow = rows[DATA_START + 1];

  test('Header enthaelt "Typ"-Spalte', () => {
    expect(iTyp).toBeGreaterThanOrEqual(0);
  });

  test('Mieter-Zeile: Typ = "Mieter"', () => {
    expect(miRow[iTyp]).toBe('Mieter');
  });

  test('WEG-Zeile: Typ = "WEG-Eigentuemervorschreibung"', () => {
    expect(wegRow[iTyp]).toBe('WEG-Eigentuemervorschreibung');
  });

  test('WEG-Zeile: Mieter-Spalte zeigt Eigentuemername', () => {
    expect(wegRow[iMieter]).toBe('Erika Eigentuemerin');
  });

  test('WEG-Zeile: Einheit zeigt Top-Nummer', () => {
    expect(wegRow[iEinheit]).toBe('Top 7');
  });

  test('WEG-Zeile: Davon bezahlt = 150', () => {
    expect(wegRow[iPaid]).toContain('150');
  });

  test('WEG-Zeile: Restbetrag = 250 (400 − 150)', () => {
    expect(wegRow[iRest]).toContain('250');
  });

  test('WEG-Zeile: Faellig am aus faelligAm (camelCase) uebernommen', () => {
    const iDue = h.indexOf('Faellig am');
    expect(wegRow[iDue]).toContain('2030');
  });
});
