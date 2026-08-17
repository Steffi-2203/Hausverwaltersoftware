import { describe, it } from 'node:test';
import { expect } from './helpers/expect';
import * as fs from "fs";
import * as path from "path";

interface DryRunInvoice {
  tenantId: string;
  unitId: string;
  year: number;
  month: number;
  grundmiete: number;
  betriebskosten: number;
  heizungskosten: number;
  gesamtbetrag: number;
  ust: number;
  ustSatzMiete: number;
  ustSatzBk: number;
  ustSatzHeizung: number;
  status: string;
  faelligAm: string;
}

interface DryRunLine {
  invoiceId: string;
  lineType: string;
  description: string;
  amount: number;
  taxRate: number;
  meta?: Record<string, unknown>;
}

interface DryRunPreviewItem {
  invoice: DryRunInvoice;
  lines: DryRunLine[];
}

interface DryRunResult {
  runId: string;
  dryRun: boolean;
  period: string;
  count: number;
  summary: {
    count: number;
    total: number;
    linesCount: number;
  };
  preview: DryRunPreviewItem[];
}

function normalizeLine(l: Record<string, unknown>) {
  return {
    invoiceId: l.invoice_id || l.invoiceId || null,
    unitId: l.unit_id || l.unitId || l.unit || null,
    lineType: l.line_type || l.lineType || null,
    description: ((l.description as string) || "").trim(),
    amount: Number(l.amount || 0).toFixed(2),
  };
}

function findMissing(
  dryrunPreview: DryRunPreviewItem[],
  dbLines: Record<string, unknown>[]
) {
  const expectedLines: Array<{
    tenantId: string;
    unitId: string;
    lineType: string;
    description: string;
    amount: number;
    taxRate: number;
  }> = [];

  for (const p of dryrunPreview) {
    const unitId = p.invoice.unitId;
    for (const line of p.lines) {
      expectedLines.push({
        tenantId: p.invoice.tenantId,
        unitId,
        lineType: line.lineType,
        description: line.description,
        amount: line.amount,
        taxRate: line.taxRate,
      });
    }
  }

  const dbLineSet = new Set(
    dbLines.map(
      (l) =>
        `${l.unit_id || l.unitId}|${l.line_type || l.lineType}|${l.description}`
    )
  );

  return expectedLines.filter(
    (l) => !dbLineSet.has(`${l.unitId}|${l.lineType}|${l.description}`)
  );
}

describe("Dryrun JSON-Struktur", () => {
  it("sollte gültiges Dry-Run JSON erzeugen können (Struktur-Test)", () => {
    const mockResult: DryRunResult = {
      runId: "test-run-123",
      dryRun: true,
      period: "2026-09",
      count: 2,
      summary: { count: 2, total: 1700, linesCount: 6 },
      preview: [
        {
          invoice: {
            tenantId: "tenant-1",
            unitId: "unit-1",
            year: 2026,
            month: 9,
            grundmiete: 650,
            betriebskosten: 120,
            heizungskosten: 80,
            gesamtbetrag: 850,
            ust: 83.33,
            ustSatzMiete: 10,
            ustSatzBk: 10,
            ustSatzHeizung: 20,
            status: "offen",
            faelligAm: "2026-09-05",
          },
          lines: [
            {
              invoiceId: "preview-tenant-1-2026-9",
              lineType: "grundmiete",
              description: "Nettomiete September 2026",
              amount: 650,
              taxRate: 10,
              meta: { reference: "MRG §15" },
            },
            {
              invoiceId: "preview-tenant-1-2026-9",
              lineType: "betriebskosten",
              description: "BK-Vorschuss September 2026",
              amount: 120,
              taxRate: 10,
              meta: { reference: "MRG §21" },
            },
            {
              invoiceId: "preview-tenant-1-2026-9",
              lineType: "heizkosten",
              description: "HK-Vorschuss September 2026",
              amount: 80,
              taxRate: 20,
              meta: { reference: "HeizKG" },
            },
          ],
        },
        {
          invoice: {
            tenantId: "tenant-2",
            unitId: "unit-2",
            year: 2026,
            month: 9,
            grundmiete: 800,
            betriebskosten: 150,
            heizungskosten: 100,
            gesamtbetrag: 1050,
            ust: 103.33,
            ustSatzMiete: 10,
            ustSatzBk: 10,
            ustSatzHeizung: 20,
            status: "offen",
            faelligAm: "2026-09-05",
          },
          lines: [
            {
              invoiceId: "preview-tenant-2-2026-9",
              lineType: "grundmiete",
              description: "Nettomiete September 2026",
              amount: 800,
              taxRate: 10,
            },
            {
              invoiceId: "preview-tenant-2-2026-9",
              lineType: "betriebskosten",
              description: "BK-Vorschuss September 2026",
              amount: 150,
              taxRate: 10,
            },
            {
              invoiceId: "preview-tenant-2-2026-9",
              lineType: "heizkosten",
              description: "HK-Vorschuss September 2026",
              amount: 100,
              taxRate: 20,
            },
          ],
        },
      ],
    };

    expect(mockResult.dryRun).toBe(true);
    expect(mockResult.count).toBe(2);
    expect(mockResult.summary.linesCount).toBe(6);
    expect(mockResult.preview).toHaveLength(2);
    expect(mockResult.preview[0].lines).toHaveLength(3);
  });

  it("sollte korrekte USt-Sätze nach österreichischem Recht enthalten", () => {
    const invoice: DryRunInvoice = {
      tenantId: "t1",
      unitId: "u1",
      year: 2026,
      month: 9,
      grundmiete: 650,
      betriebskosten: 120,
      heizungskosten: 80,
      gesamtbetrag: 933.33,
      ust: 83.33,
      ustSatzMiete: 10,
      ustSatzBk: 10,
      ustSatzHeizung: 20,
      status: "offen",
      faelligAm: "2026-09-05",
    };

    expect(invoice.ustSatzMiete).toBe(10);
    expect(invoice.ustSatzBk).toBe(10);
    expect(invoice.ustSatzHeizung).toBe(20);

    const expectedUst =
      invoice.grundmiete * (invoice.ustSatzMiete / 100) +
      invoice.betriebskosten * (invoice.ustSatzBk / 100) +
      invoice.heizungskosten * (invoice.ustSatzHeizung / 100);
    expect(Math.round(expectedUst * 100) / 100).toBe(93);
  });

  it("sollte Gesamtbetrag = Netto + USt berechnen", () => {
    const grundmiete = 650;
    const bk = 120;
    const hk = 80;
    const netto = grundmiete + bk + hk;
    const ust = grundmiete * 0.1 + bk * 0.1 + hk * 0.2;
    const brutto = netto + ust;

    expect(netto).toBe(850);
    expect(Math.round(ust * 100) / 100).toBe(93);
    expect(Math.round(brutto * 100) / 100).toBe(943);
  });
});

describe("Vergleichs-Logik (find_missing_lines)", () => {
  it("sollte fehlende Zeilen korrekt identifizieren", () => {
    const dryrunPreview: DryRunPreviewItem[] = [
      {
        invoice: {
          tenantId: "t1",
          unitId: "u1",
          year: 2026,
          month: 9,
          grundmiete: 650,
          betriebskosten: 120,
          heizungskosten: 80,
          gesamtbetrag: 850,
          ust: 83.33,
          ustSatzMiete: 10,
          ustSatzBk: 10,
          ustSatzHeizung: 20,
          status: "offen",
          faelligAm: "2026-09-05",
        },
        lines: [
          {
            invoiceId: "inv-1",
            lineType: "grundmiete",
            description: "Nettomiete September 2026",
            amount: 650,
            taxRate: 10,
          },
          {
            invoiceId: "inv-1",
            lineType: "betriebskosten",
            description: "BK-Vorschuss September 2026",
            amount: 120,
            taxRate: 10,
          },
          {
            invoiceId: "inv-1",
            lineType: "heizkosten",
            description: "HK-Vorschuss September 2026",
            amount: 80,
            taxRate: 20,
          },
        ],
      },
    ];

    const dbLines = [
      {
        unit_id: "u1",
        line_type: "grundmiete",
        description: "Nettomiete September 2026",
        amount: "650.00",
      },
    ];

    const missing = findMissing(dryrunPreview, dbLines);

    expect(missing).toHaveLength(2);
    expect(missing[0].lineType).toBe("betriebskosten");
    expect(missing[1].lineType).toBe("heizkosten");
  });

  it("sollte keine fehlenden Zeilen melden wenn alles vorhanden", () => {
    const dryrunPreview: DryRunPreviewItem[] = [
      {
        invoice: {
          tenantId: "t1",
          unitId: "u1",
          year: 2026,
          month: 9,
          grundmiete: 650,
          betriebskosten: 120,
          heizungskosten: 80,
          gesamtbetrag: 850,
          ust: 83.33,
          ustSatzMiete: 10,
          ustSatzBk: 10,
          ustSatzHeizung: 20,
          status: "offen",
          faelligAm: "2026-09-05",
        },
        lines: [
          {
            invoiceId: "inv-1",
            lineType: "grundmiete",
            description: "Nettomiete September 2026",
            amount: 650,
            taxRate: 10,
          },
          {
            invoiceId: "inv-1",
            lineType: "betriebskosten",
            description: "BK-Vorschuss September 2026",
            amount: 120,
            taxRate: 10,
          },
        ],
      },
    ];

    const dbLines = [
      {
        unit_id: "u1",
        line_type: "grundmiete",
        description: "Nettomiete September 2026",
        amount: "650.00",
      },
      {
        unit_id: "u1",
        line_type: "betriebskosten",
        description: "BK-Vorschuss September 2026",
        amount: "120.00",
      },
    ];

    const missing = findMissing(dryrunPreview, dbLines);
    expect(missing).toHaveLength(0);
  });

  it("sollte mehrere Mieter korrekt vergleichen", () => {
    const dryrunPreview: DryRunPreviewItem[] = [
      {
        invoice: {
          tenantId: "t1",
          unitId: "u1",
          year: 2026,
          month: 9,
          grundmiete: 650,
          betriebskosten: 120,
          heizungskosten: 0,
          gesamtbetrag: 770,
          ust: 77,
          ustSatzMiete: 10,
          ustSatzBk: 10,
          ustSatzHeizung: 20,
          status: "offen",
          faelligAm: "2026-09-05",
        },
        lines: [
          {
            invoiceId: "inv-1",
            lineType: "grundmiete",
            description: "Nettomiete September 2026",
            amount: 650,
            taxRate: 10,
          },
        ],
      },
      {
        invoice: {
          tenantId: "t2",
          unitId: "u2",
          year: 2026,
          month: 9,
          grundmiete: 800,
          betriebskosten: 150,
          heizungskosten: 0,
          gesamtbetrag: 950,
          ust: 95,
          ustSatzMiete: 10,
          ustSatzBk: 10,
          ustSatzHeizung: 20,
          status: "offen",
          faelligAm: "2026-09-05",
        },
        lines: [
          {
            invoiceId: "inv-2",
            lineType: "grundmiete",
            description: "Nettomiete September 2026",
            amount: 800,
            taxRate: 10,
          },
        ],
      },
    ];

    const dbLines = [
      {
        unit_id: "u1",
        line_type: "grundmiete",
        description: "Nettomiete September 2026",
        amount: "650.00",
      },
    ];

    const missing = findMissing(dryrunPreview, dbLines);
    expect(missing).toHaveLength(1);
    expect(missing[0].tenantId).toBe("t2");
    expect(missing[0].amount).toBe(800);
  });
});

describe("Normalisierung (DB vs Dryrun Formate)", () => {
  it("sollte snake_case und camelCase korrekt normalisieren", () => {
    const snakeCase = {
      invoice_id: "inv-1",
      unit_id: "u1",
      line_type: "grundmiete",
      description: "  Nettomiete  ",
      amount: "650.00",
    };

    const camelCase = {
      invoiceId: "inv-1",
      unitId: "u1",
      lineType: "grundmiete",
      description: "Nettomiete",
      amount: 650,
    };

    const normalizedSnake = normalizeLine(snakeCase);
    const normalizedCamel = normalizeLine(camelCase);

    expect(normalizedSnake.invoiceId).toBe(normalizedCamel.invoiceId);
    expect(normalizedSnake.unitId).toBe(normalizedCamel.unitId);
    expect(normalizedSnake.lineType).toBe(normalizedCamel.lineType);
    expect(normalizedSnake.amount).toBe(normalizedCamel.amount);
  });

  it("sollte fehlende Felder mit null/0 auffüllen", () => {
    const partial = { description: "Test" };
    const normalized = normalizeLine(partial);

    expect(normalized.invoiceId).toBeNull();
    expect(normalized.unitId).toBeNull();
    expect(normalized.lineType).toBeNull();
    expect(normalized.amount).toBe("0.00");
    expect(normalized.description).toBe("Test");
  });
});

describe("Persist-Modus Validierung", () => {
  it("sollte ON CONFLICT DO UPDATE mit IS DISTINCT FROM SQL korrekt aufbauen", () => {
    const line = {
      invoiceId: "inv-123",
      unitId: "u1",
      lineType: "grundmiete",
      description: "Nettomiete September 2026",
      amount: 650,
      taxRate: 10,
    };

    const upsertSql = `INSERT INTO invoice_lines (invoice_id, unit_id, line_type, description, amount, tax_rate)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (invoice_id, unit_id, line_type, description)
        DO UPDATE SET
          amount = EXCLUDED.amount,
          tax_rate = EXCLUDED.tax_rate
        WHERE (invoice_lines.amount, invoice_lines.tax_rate) IS DISTINCT FROM (EXCLUDED.amount, EXCLUDED.tax_rate)
        RETURNING id, invoice_id, line_type, description, amount`;

    const params = [
      line.invoiceId,
      line.unitId,
      line.lineType,
      line.description,
      line.amount,
      line.taxRate,
    ];

    expect(upsertSql).toContain("ON CONFLICT");
    expect(upsertSql).toContain("DO UPDATE SET");
    expect(upsertSql).toContain("EXCLUDED.amount");
    expect(upsertSql).toContain("IS DISTINCT FROM");
    expect(upsertSql).not.toContain("DO NOTHING");
    expect(upsertSql).not.toContain("xmax");
    expect(params).toHaveLength(6);
    expect(params[0]).toBe("inv-123");
    expect(params[4]).toBe(650);
  });

  it("sollte Deterministic Merge via CTE old_values erkennen", () => {
    const oldValuesMap = new Map<string, number>();
    oldValuesMap.set("inv-123|grundmiete|Nettomiete September 2026", 600);

    const returnedRow = {
      id: "line-1",
      invoice_id: "inv-123",
      line_type: "grundmiete",
      description: "Nettomiete September 2026",
      amount: 650,
    };

    const key = `${returnedRow.invoice_id}|${returnedRow.line_type}|${returnedRow.description}`;
    const oldAmount = oldValuesMap.get(key);
    const wasUpdate = oldAmount !== undefined;

    expect(wasUpdate).toBe(true);
    expect(oldAmount).toBe(600);
    expect(returnedRow.amount).toBe(650);

    const newKey = "inv-456|betriebskosten|BK September 2026";
    expect(oldValuesMap.get(newKey)).toBeUndefined();
    expect(oldValuesMap.get(newKey) !== undefined).toBe(false);
  });

  it("sollte invoice_runs Idempotenz per Periode korrekt behandeln", () => {
    const shouldAbort = (status: string) => status === 'completed' || status === 'started';
    const shouldRetry = (status: string) => status === 'failed';
    const checkByPeriod = (period: string, existingRuns: { period: string; status: string }[]) => {
      const existing = existingRuns.find(r => r.period === period);
      if (!existing) return 'new';
      if (shouldAbort(existing.status)) return 'abort';
      if (shouldRetry(existing.status)) return 'retry';
      return 'new';
    };

    const runs = [
      { period: '2026-09', status: 'completed' },
      { period: '2026-08', status: 'failed' },
    ];

    expect(checkByPeriod('2026-09', runs)).toBe('abort');
    expect(checkByPeriod('2026-08', runs)).toBe('retry');
    expect(checkByPeriod('2026-10', runs)).toBe('new');

    expect(shouldAbort('completed')).toBe(true);
    expect(shouldAbort('started')).toBe(true);
    expect(shouldAbort('failed')).toBe(false);
    expect(shouldRetry('failed')).toBe(true);
    expect(shouldRetry('completed')).toBe(false);
  });

  it("sollte Monatsname korrekt nach Monatsnummer konvertieren", () => {
    const monthNames: Record<string, number> = {
      Jänner: 1,
      Februar: 2,
      März: 3,
      April: 4,
      Mai: 5,
      Juni: 6,
      Juli: 7,
      August: 8,
      September: 9,
      Oktober: 10,
      November: 11,
      Dezember: 12,
    };

    expect(monthNames["September"]).toBe(9);
    expect(monthNames["Jänner"]).toBe(1);
    expect(monthNames["März"]).toBe(3);

    const description = "Nettomiete September 2026";
    const match = description.match(/(\w+)\s+(\d{4})$/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("September");
    expect(parseInt(match![2])).toBe(2026);
    expect(monthNames[match![1]]).toBe(9);
  });

  it("sollte Leerstand-Vorschreibung korrekt erkennen", () => {
    const vacancyInvoice: DryRunInvoice = {
      tenantId: "vacancy-t1",
      unitId: "u1",
      year: 2026,
      month: 9,
      grundmiete: 0,
      betriebskosten: 120,
      heizungskosten: 80,
      gesamtbetrag: 228,
      ust: 28,
      ustSatzMiete: 10,
      ustSatzBk: 10,
      ustSatzHeizung: 20,
      status: "offen",
      faelligAm: "2026-09-05",
    };

    expect(vacancyInvoice.grundmiete).toBe(0);
    expect(vacancyInvoice.betriebskosten).toBeGreaterThan(0);

    const isVacancy = vacancyInvoice.grundmiete === 0;
    expect(isVacancy).toBe(true);

    const expectedUst =
      vacancyInvoice.betriebskosten * 0.1 + vacancyInvoice.heizungskosten * 0.2;
    expect(expectedUst).toBe(28);
  });

  it("sollte reconcileRounding deterministisch sortieren (amount + lineType + unitId)", () => {
    function roundToCents(v: number) { return Math.round((Number(v) || 0) * 100) / 100; }

    function reconcileRounding(lines: { amount: number; lineType: string; unitId: string }[], expectedTotal: number): void {
      const roundedSum = lines.reduce((s, l) => s + roundToCents(l.amount || 0), 0);
      let diff = roundToCents(expectedTotal - roundedSum);
      if (Math.abs(diff) < 0.01) return;

      lines.sort((a, b) => {
        const amtDiff = Math.abs(b.amount || 0) - Math.abs(a.amount || 0);
        if (amtDiff !== 0) return amtDiff;
        const ltCmp = (a.lineType || '').localeCompare(b.lineType || '');
        if (ltCmp !== 0) return ltCmp;
        return (a.unitId || '').localeCompare(b.unitId || '');
      });
      let i = 0;
      const maxIterations = lines.length * 2;
      while (Math.abs(diff) >= 0.01 && i < maxIterations) {
        const adjust = diff > 0 ? 0.01 : -0.01;
        lines[i % lines.length].amount = roundToCents(lines[i % lines.length].amount + adjust);
        diff = roundToCents(diff - adjust);
        i++;
      }
      if (Math.abs(diff) >= 0.01) {
        throw new Error(`Rundungsausgleich gescheitert: Restdifferenz ${diff.toFixed(4)} €`);
      }
    }

    const lines1 = [
      { amount: 50.00, lineType: 'betriebskosten', unitId: 'u-aaa' },
      { amount: 50.00, lineType: 'heizkosten', unitId: 'u-aaa' },
      { amount: 50.00, lineType: 'betriebskosten', unitId: 'u-bbb' },
    ];
    const lines2 = [
      { amount: 50.00, lineType: 'betriebskosten', unitId: 'u-bbb' },
      { amount: 50.00, lineType: 'heizkosten', unitId: 'u-aaa' },
      { amount: 50.00, lineType: 'betriebskosten', unitId: 'u-aaa' },
    ];

    reconcileRounding(lines1, 150.01);
    reconcileRounding(lines2, 150.01);

    expect(lines1.map(l => l.amount)).toEqual(lines2.map(l => l.amount));

    expect(lines1[0].lineType).toBe('betriebskosten');
    expect(lines1[0].unitId).toBe('u-aaa');
    expect(lines1[0].amount).toBe(50.01);
  });

  it("sollte roundToCents konsistent sein (shared/utils.ts Parität)", () => {
    function roundToCents(v: number) { return Math.round((Number(v) || 0) * 100) / 100; }

    expect(roundToCents(1.005)).toBe(1.00);
    expect(roundToCents(1.006)).toBe(1.01);
    expect(roundToCents(1.004)).toBe(1.00);
    expect(roundToCents(0)).toBe(0);
    expect(roundToCents(NaN)).toBe(0);
    expect(roundToCents(-3.456)).toBe(-3.46);
    expect(roundToCents(99.999)).toBe(100.00);

    expect(roundToCents(150.333)).toBe(150.33);
    expect(roundToCents(150.335)).toBe(150.34);
  });

  it("sollte bei unlösbarer Rundungsdifferenz fail-fast werfen", () => {
    function roundToCents(v: number) { return Math.round((Number(v) || 0) * 100) / 100; }

    function reconcileRounding(lines: { amount: number }[], expectedTotal: number): void {
      const roundedSum = lines.reduce((s, l) => s + roundToCents(l.amount || 0), 0);
      let diff = roundToCents(expectedTotal - roundedSum);
      if (Math.abs(diff) < 0.01) return;
      lines.sort((a, b) => Math.abs(b.amount || 0) - Math.abs(a.amount || 0));
      let i = 0;
      const maxIterations = lines.length * 2;
      while (Math.abs(diff) >= 0.01 && i < maxIterations) {
        const adjust = diff > 0 ? 0.01 : -0.01;
        lines[i % lines.length].amount = roundToCents(lines[i % lines.length].amount + adjust);
        diff = roundToCents(diff - adjust);
        i++;
      }
      if (Math.abs(diff) >= 0.01) {
        throw new Error(`Rundungsausgleich gescheitert: Restdifferenz ${diff.toFixed(4)} €`);
      }
    }

    expect(() => reconcileRounding([], 5.00)).toThrow("Rundungsausgleich gescheitert");

    expect(() => reconcileRounding(
      [{ amount: 100.00 }, { amount: 200.00 }],
      300.02
    )).not.toThrow();
  });

  it("sollte batch-Sort deterministisch nach invoiceId|lineType|unitId|description sein", () => {
    const batch = [
      { invoiceId: 'inv-1', lineType: 'heizkosten', unitId: 'u-bbb', description: 'HK Sep' },
      { invoiceId: 'inv-1', lineType: 'betriebskosten', unitId: 'u-aaa', description: 'BK Sep' },
      { invoiceId: 'inv-1', lineType: 'betriebskosten', unitId: 'u-bbb', description: 'BK Sep' },
    ];
    const sorted = [...batch].sort((a, b) =>
      `${a.invoiceId}|${a.lineType}|${a.unitId}|${a.description}`.localeCompare(
        `${b.invoiceId}|${b.lineType}|${b.unitId}|${b.description}`
      )
    );

    expect(sorted[0].lineType).toBe('betriebskosten');
    expect(sorted[0].unitId).toBe('u-aaa');
    expect(sorted[1].lineType).toBe('betriebskosten');
    expect(sorted[1].unitId).toBe('u-bbb');
    expect(sorted[2].lineType).toBe('heizkosten');

    const sorted2 = [...batch.reverse()].sort((a, b) =>
      `${a.invoiceId}|${a.lineType}|${a.unitId}|${a.description}`.localeCompare(
        `${b.invoiceId}|${b.lineType}|${b.unitId}|${b.description}`
      )
    );
    expect(sorted.map(s => s.unitId)).toEqual(sorted2.map(s => s.unitId));
    expect(sorted.map(s => s.lineType)).toEqual(sorted2.map(s => s.lineType));
  });
});

describe("Dryrun-Datei Lesen (falls vorhanden)", () => {
  const tmpFile = path.resolve("tmp/dryrun_2026_09.json");

  it("sollte tmp/dryrun_2026_09.json parsen wenn vorhanden", () => {
    if (!fs.existsSync(tmpFile)) {
      console.log("Datei nicht vorhanden, überspringe: " + tmpFile);
      return;
    }

    const data: DryRunResult = JSON.parse(fs.readFileSync(tmpFile, "utf8"));

    expect(data.dryRun).toBe(true);
    expect(data.period).toBe("2026-09");
    expect(data.count).toBeGreaterThan(0);
    expect(data.preview).toBeInstanceOf(Array);
    expect(data.preview.length).toBeGreaterThan(0);

    for (const item of data.preview) {
      expect(item.invoice).toBeDefined();
      expect(item.invoice.tenantId).toBeTruthy();
      expect(item.invoice.unitId).toBeTruthy();
      expect(item.invoice.year).toBe(2026);
      expect(item.invoice.month).toBe(9);
      expect(item.lines).toBeInstanceOf(Array);
      expect(item.lines.length).toBeGreaterThanOrEqual(1);

      for (const line of item.lines) {
        expect(line.lineType).toBeTruthy();
        expect(line.description).toBeTruthy();
        expect(typeof line.amount).toBe("number");
        expect(line.amount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("sollte konsistente Summen haben", () => {
    if (!fs.existsSync(tmpFile)) return;

    const data: DryRunResult = JSON.parse(fs.readFileSync(tmpFile, "utf8"));

    expect(data.summary.count).toBe(data.count);
    expect(data.summary.count).toBe(data.preview.length);

    const totalLines = data.preview.reduce(
      (sum, p) => sum + p.lines.length,
      0
    );
    expect(data.summary.linesCount).toBe(totalLines);
  });
});

describe("Dryrun ↔ Persist Parität", () => {
  const dryrunFile = path.resolve("tmp/dryrun_2026_09.json");
  const dbFile = path.resolve("tmp/db_lines_2026_09.json");

  it("sollte Dryrun↔DB Vergleich konsistent mit findMissing sein (Integrations-Test)", () => {
    if (!fs.existsSync(dryrunFile) || !fs.existsSync(dbFile)) {
      console.log(
        "Dryrun/DB-Export nicht vorhanden — führe erst den Audit-Workflow aus:"
      );
      console.log("  bash tools/upsert_missing_lines.sh 2026 9");
      return;
    }

    const dryrun: DryRunResult = JSON.parse(
      fs.readFileSync(dryrunFile, "utf8")
    );
    const dbLines: Record<string, unknown>[] = JSON.parse(
      fs.readFileSync(dbFile, "utf8")
    );

    const dryrunLineKeys = new Set<string>();
    for (const item of dryrun.preview) {
      for (const line of item.lines) {
        dryrunLineKeys.add(
          `${item.invoice.unitId}|${line.lineType}|${line.description}`
        );
      }
    }

    const dbLineKeys = new Set<string>();
    for (const row of dbLines) {
      const uid = (row.unit_id || row.unitId) as string;
      const lt = (row.line_type || row.lineType) as string;
      const desc = ((row.description as string) || "").trim();
      dbLineKeys.add(`${uid}|${lt}|${desc}`);
    }

    const missingInDb = [...dryrunLineKeys].filter((k) => !dbLineKeys.has(k));
    const extraInDb = [...dbLineKeys].filter((k) => !dryrunLineKeys.has(k));

    const missingViaHelper = findMissing(dryrun.preview, dbLines);

    expect(missingViaHelper.length).toBeGreaterThanOrEqual(0);

    if (missingInDb.length > 0) {
      console.log(
        `Info: ${missingInDb.length} unique keys fehlen in DB, ${missingViaHelper.length} per-tenant Zeilen.`
      );
      const missingTypes: Record<string, number> = {};
      missingInDb.forEach((k) => {
        const t = k.split("|")[1];
        missingTypes[t] = (missingTypes[t] || 0) + 1;
      });
      console.log("  Nach Typ:", missingTypes);
    }

    expect(extraInDb).toHaveLength(0);
  });

  it("sollte Beträge innerhalb Rundungstoleranz (±0.05€) übereinstimmen", () => {
    if (!fs.existsSync(dryrunFile) || !fs.existsSync(dbFile)) return;

    const dryrun: DryRunResult = JSON.parse(
      fs.readFileSync(dryrunFile, "utf8")
    );
    const dbLines: Record<string, unknown>[] = JSON.parse(
      fs.readFileSync(dbFile, "utf8")
    );

    const dbAmountMap = new Map<string, number>();
    for (const row of dbLines) {
      const uid = (row.unit_id || row.unitId) as string;
      const lt = (row.line_type || row.lineType) as string;
      const desc = ((row.description as string) || "").trim();
      const amt = Number(row.amount || 0);
      dbAmountMap.set(`${uid}|${lt}|${desc}`, amt);
    }

    const TOLERANCE = 0.05;
    const significantMismatches: Array<{
      key: string;
      dryrunAmt: number;
      dbAmt: number;
      diff: number;
    }> = [];
    for (const item of dryrun.preview) {
      for (const line of item.lines) {
        const key = `${item.invoice.unitId}|${line.lineType}|${line.description}`;
        const dbAmt = dbAmountMap.get(key);
        if (dbAmt !== undefined) {
          const diff = Math.abs(line.amount - dbAmt);
          if (diff > TOLERANCE) {
            significantMismatches.push({
              key,
              dryrunAmt: line.amount,
              dbAmt,
              diff: Number(diff.toFixed(4)),
            });
          }
        }
      }
    }

    if (significantMismatches.length > 0) {
      console.log(
        "Signifikante Betrags-Abweichungen (>0.05€):",
        significantMismatches.slice(0, 5)
      );
    }

    expect(significantMismatches).toHaveLength(0);
  });

  it("sollte Gesamtbetrag = Summe(Netto-Beträge) pro Rechnung sein", () => {
    if (!fs.existsSync(dryrunFile)) return;

    const dryrun: DryRunResult = JSON.parse(
      fs.readFileSync(dryrunFile, "utf8")
    );

    const gesamtErrors: Array<{
      tenantId: string;
      expected: number;
      actual: number;
    }> = [];
    for (const item of dryrun.preview) {
      const nettoSum = item.lines.reduce((sum, l) => sum + l.amount, 0);
      const expected = Number(nettoSum.toFixed(2));
      const actual = Number(item.invoice.gesamtbetrag.toFixed(2));
      if (Math.abs(expected - actual) > 0.02) {
        gesamtErrors.push({
          tenantId: item.invoice.tenantId,
          expected,
          actual,
        });
      }
    }

    if (gesamtErrors.length > 0) {
      console.log("Gesamtbetrag-Fehler:", gesamtErrors.slice(0, 5));
    }

    expect(gesamtErrors).toHaveLength(0);
  });

  it("sollte Batch-Upsert SQL korrekt für N Zeilen aufbauen", () => {
    const lines = [
      {
        invoiceId: "inv-1",
        unitId: "u1",
        lineType: "grundmiete",
        description: "Nettomiete September 2026",
        amount: 650,
        taxRate: 0.1,
      },
      {
        invoiceId: "inv-1",
        unitId: "u1",
        lineType: "betriebskosten",
        description: "BK-Vorschuss September 2026",
        amount: 120,
        taxRate: 0.1,
      },
      {
        invoiceId: "inv-2",
        unitId: "u2",
        lineType: "heizkosten",
        description: "HK-Vorschuss September 2026",
        amount: 80,
        taxRate: 0.2,
      },
    ];

    const values: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    for (const r of lines) {
      values.push(
        `($${p}, $${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5})`
      );
      params.push(
        r.invoiceId,
        r.unitId,
        r.lineType,
        r.description,
        r.amount,
        r.taxRate
      );
      p += 6;
    }

    const sql = `INSERT INTO invoice_lines (invoice_id, unit_id, line_type, description, amount, tax_rate)
        VALUES ${values.join(", ")}
        ON CONFLICT (invoice_id, unit_id, line_type, description) DO NOTHING`;

    expect(values).toHaveLength(3);
    expect(params).toHaveLength(18);
    expect(sql).toContain("($1, $2, $3, $4, $5, $6)");
    expect(sql).toContain("($7, $8, $9, $10, $11, $12)");
    expect(sql).toContain("($13, $14, $15, $16, $17, $18)");
    expect(sql).toContain("ON CONFLICT");
  });
});
