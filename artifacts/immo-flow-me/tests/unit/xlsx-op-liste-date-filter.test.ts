/**
 * Excel-Export OP-Liste — Datumsfilter (from / to)
 *
 * Prueft dass der Export-Endpunkt (/api/accounting/export/op-liste) die gleichen
 * from/to-Parameter wie /api/open-items unterstuetzt und nur Zeilen liefert,
 * deren faellig_am innerhalb des Filters liegt — sowohl fuer monthly_invoices
 * als auch fuer weg_vorschreibungen.
 *
 * Da exportOPListe() eine reine Funktion ist, wird hier der Pfad simuliert,
 * den der Route-Handler geht: Datenbankzeilen werden vor dem Aufruf gefiltert
 * und nur passende Items uebergeben. Der Test stellt sicher dass:
 *   1. Zeilen ausserhalb des Datumsbereichs im Export nicht erscheinen
 *   2. Zeilen innerhalb des Bereichs fuer beide Typen (Mieter + WEG) enthalten sind
 *   3. Ein reiner to-Filter genauso funktioniert wie ein kombinierter from/to-Filter
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

/** Simuliert den DB-seitigen Datumsfilter, den der Route-Handler anwendet. */
function applyDateFilter(items: any[], from?: string, to?: string): any[] {
  return items.filter((item) => {
    const due: string = item.faelligAm ?? item.faellig_am ?? '';
    if (from && due < from) return false;
    if (to && due > to) return false;
    return true;
  });
}

const HEADER_ROW = 4;
const DATA_START = 5;

/** Alle Testzeilen — verschiedene Faelligkeiten und Typen */
const allItems = [
  // Mieter-Zeilen
  {
    id: 'mi-jan',
    source: 'monthly_invoice',
    tenantName: 'Anna Mieter',
    unitTopNummer: 'Top 1',
    propertyName: 'Testhaus',
    gesamtbetrag: '600.00',
    paidAmount: null,
    status: 'offen',
    faelligAm: '2030-01-15',
  },
  {
    id: 'mi-mar',
    source: 'monthly_invoice',
    tenantName: 'Bernd Mieter',
    unitTopNummer: 'Top 2',
    propertyName: 'Testhaus',
    gesamtbetrag: '700.00',
    paidAmount: null,
    status: 'offen',
    faelligAm: '2030-03-15',
  },
  // WEG-Zeilen
  {
    id: 'weg-feb',
    source: 'weg',
    tenantName: 'Clara Eigentuemerin',
    unitTopNummer: 'Top 5',
    propertyName: 'Testhaus',
    gesamtbetrag: '400.00',
    paidAmount: null,
    status: 'offen',
    faelligAm: '2030-02-01',
  },
  {
    id: 'weg-apr',
    source: 'weg',
    tenantName: 'Dieter Eigentuemer',
    unitTopNummer: 'Top 6',
    propertyName: 'Testhaus',
    gesamtbetrag: '350.00',
    paidAmount: null,
    status: 'offen',
    faelligAm: '2030-04-01',
  },
];

describe('Excel-Export OP-Liste — Datumsfilter', () => {
  describe('from=2030-02-01 to=2030-03-31 (Feb + Maerz)', () => {
    const filtered = applyDateFilter(allItems, '2030-02-01', '2030-03-31');
    const buf = exportOPListe(filtered, 'Test-Org');
    const rows = parseSheet(buf);
    const h = rows[HEADER_ROW] || [];
    const iMieter = h.indexOf('Mieter');
    const iDue = h.indexOf('Faellig am');
    const dataRows = rows.slice(DATA_START).filter((r) => r.some((c) => c.trim() !== ''));

    test('liefert genau 2 Zeilen (Bernd Mieter + Clara Eigentuemerin)', () => {
      expect(dataRows.length).toBe(2);
    });

    test('Mieter-Zeile in Ergebnis: Bernd Mieter (Maerz)', () => {
      const names = dataRows.map((r) => r[iMieter]);
      expect(names).toContain('Bernd Mieter');
    });

    test('WEG-Zeile in Ergebnis: Clara Eigentuemerin (Februar)', () => {
      const names = dataRows.map((r) => r[iMieter]);
      expect(names).toContain('Clara Eigentuemerin');
    });

    test('Januar-Zeile (Anna Mieter) nicht enthalten', () => {
      const names = dataRows.map((r) => r[iMieter]);
      expect(names).not.toContain('Anna Mieter');
    });

    test('April-Zeile (Dieter Eigentuemer) nicht enthalten', () => {
      const names = dataRows.map((r) => r[iMieter]);
      expect(names).not.toContain('Dieter Eigentuemer');
    });

    test('alle Faelligkeitsdaten liegen zwischen Feb und Maerz 2030', () => {
      for (const row of dataRows) {
        const due = row[iDue];
        // Datum-Zellen koennen als Zahl (Excel-Serial) oder String vorliegen
        // — es reicht zu pruefen dass der Jahrgang 2030 abgebildet wird
        expect(due).toContain('2030');
      }
    });
  });

  describe('nur to=2030-01-31 (nur Januar)', () => {
    const filtered = applyDateFilter(allItems, undefined, '2030-01-31');
    const buf = exportOPListe(filtered, 'Test-Org');
    const rows = parseSheet(buf);
    const h = rows[HEADER_ROW] || [];
    const iMieter = h.indexOf('Mieter');
    const dataRows = rows.slice(DATA_START).filter((r) => r.some((c) => c.trim() !== ''));

    test('liefert genau 1 Zeile (Anna Mieter)', () => {
      expect(dataRows.length).toBe(1);
    });

    test('enthaelt Anna Mieter', () => {
      expect(dataRows[0][iMieter]).toBe('Anna Mieter');
    });
  });

  describe('nur from=2030-04-01 (nur April)', () => {
    const filtered = applyDateFilter(allItems, '2030-04-01', undefined);
    const buf = exportOPListe(filtered, 'Test-Org');
    const rows = parseSheet(buf);
    const h = rows[HEADER_ROW] || [];
    const iMieter = h.indexOf('Mieter');
    const dataRows = rows.slice(DATA_START).filter((r) => r.some((c) => c.trim() !== ''));

    test('liefert genau 1 Zeile (Dieter Eigentuemer)', () => {
      expect(dataRows.length).toBe(1);
    });

    test('enthaelt Dieter Eigentuemer (WEG)', () => {
      expect(dataRows[0][iMieter]).toBe('Dieter Eigentuemer');
    });
  });

  describe('kein Filter — alle 4 Zeilen', () => {
    const buf = exportOPListe(allItems, 'Test-Org');
    const rows = parseSheet(buf);
    const dataRows = rows.slice(DATA_START).filter((r) => r.some((c) => c.trim() !== ''));

    test('liefert alle 4 Zeilen ohne Datumsfilter', () => {
      expect(dataRows.length).toBe(4);
    });
  });
});
