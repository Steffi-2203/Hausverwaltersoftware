import * as XLSX from "xlsx";

function formatDate(date: Date): string {
  const d = date.getDate().toString().padStart(2, "0");
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const y = date.getFullYear();
  return `${d}.${m}.${y}`;
}

function formatEur(value: number): string {
  return value.toLocaleString("de-AT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function createWorkbook(
  title: string,
  orgName: string,
  headers: string[],
  rows: any[][],
): Buffer {
  const wb = XLSX.utils.book_new();
  const wsData: any[][] = [];

  wsData.push([title]);
  wsData.push([`Organisation: ${orgName}`]);
  wsData.push([`Erstellt am: ${formatDate(new Date())}`]);
  wsData.push([]);
  wsData.push(headers);

  for (const row of rows) {
    wsData.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  const colWidths = headers.map((h, i) => {
    let maxLen = h.length;
    for (const row of rows) {
      const cellVal = row[i] != null ? String(row[i]) : "";
      if (cellVal.length > maxLen) maxLen = cellVal.length;
    }
    return { wch: Math.min(maxLen + 4, 40) };
  });
  ws["!cols"] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, title.substring(0, 31));

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return buf as Buffer;
}

export function exportSaldenliste(data: any[], orgName: string): Buffer {
  const headers = ["Kontonummer", "Kontoname", "Soll", "Haben", "Saldo"];
  const rows = data.map((r) => [
    r.account_number || "",
    r.name || "",
    formatEur(Number(r.total_debit || 0)),
    formatEur(Number(r.total_credit || 0)),
    formatEur(Number(r.balance || 0)),
  ]);

  const totalDebit = data.reduce(
    (s, r) => s + Number(r.total_debit || 0),
    0,
  );
  const totalCredit = data.reduce(
    (s, r) => s + Number(r.total_credit || 0),
    0,
  );
  rows.push([
    "",
    "Summe",
    formatEur(totalDebit),
    formatEur(totalCredit),
    formatEur(totalDebit - totalCredit),
  ]);

  return createWorkbook("Saldenliste", orgName, headers, rows);
}

export function exportBilanz(data: any[], orgName: string): Buffer {
  const headers = ["Kontonummer", "Kontoname", "Typ", "Betrag"];

  const typeLabels: Record<string, string> = {
    asset: "Aktiva",
    liability: "Verbindlichkeiten",
    equity: "Eigenkapital",
  };

  const allItems: any[] = [];
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const bs = data as any;
    for (const item of bs.assets?.items || []) {
      allItems.push({ ...item, account_type: "asset" });
    }
    for (const item of bs.liabilities?.items || []) {
      allItems.push({ ...item, account_type: "liability" });
    }
    for (const item of bs.equity?.items || []) {
      allItems.push({ ...item, account_type: "equity" });
    }
  } else if (Array.isArray(data)) {
    allItems.push(...data);
  }

  const rows = allItems.map((r) => [
    r.account_number || "",
    r.name || "",
    typeLabels[r.account_type] || r.account_type || "",
    formatEur(Math.abs(Number(r.balance || 0))),
  ]);

  return createWorkbook("Bilanz", orgName, headers, rows);
}

export function exportGuV(data: any[], orgName: string): Buffer {
  const headers = ["Kontonummer", "Kontoname", "Typ", "Betrag"];

  const typeLabels: Record<string, string> = {
    revenue: "Erloese",
    expense: "Aufwendungen",
  };

  const allItems: any[] = [];
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const pl = data as any;
    for (const item of pl.revenue?.items || []) {
      allItems.push({ ...item, account_type: "revenue" });
    }
    for (const item of pl.expenses?.items || []) {
      allItems.push({ ...item, account_type: "expense" });
    }
  } else if (Array.isArray(data)) {
    allItems.push(...data);
  }

  const rows = allItems.map((r) => [
    r.account_number || "",
    r.name || "",
    typeLabels[r.account_type] || r.account_type || "",
    formatEur(Math.abs(Number(r.balance || 0))),
  ]);

  if (data && typeof data === "object" && !Array.isArray(data)) {
    const pl = data as any;
    rows.push([]);
    rows.push(["", "Jahresergebnis", "", formatEur(Number(pl.netIncome || 0))]);
  }

  return createWorkbook("GuV", orgName, headers, rows);
}

export function exportOPListe(data: any[], orgName: string): Buffer {
  const headers = [
    "Rechnungsnummer",
    "Typ",
    "Mieter",
    "Einheit",
    "Betrag",
    "Davon bezahlt",
    "Restbetrag",
    "Faellig am",
    "Status",
    "Ueberfaellig Tage",
  ];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows = data.map((r) => {
    const dueDate = r.faelligAm || r.faellig_am || r.dueDate;
    let overdueDays = 0;
    const status = r.status || "offen";

    if (dueDate) {
      const due = new Date(dueDate);
      due.setHours(0, 0, 0, 0);
      const diff = Math.floor(
        (today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (diff > 0) overdueDays = diff;
    }

    // Drizzle liefert camelCase (paidAmount), der Export-Endpunkt kann auch
    // snake_case (paid_amount) senden — beide Varianten abfangen.
    const gesamtbetrag = Number(r.gesamtbetrag || r.totalAmount || r.betrag || 0);
    const paidAmount   = Number(r.paidAmount ?? r.paid_amount ?? 0);
    const outstanding  = Math.max(gesamtbetrag - paidAmount, 0);

    return [
      r.rechnungsnummer || r.invoiceNumber || r.id || "",
      r.source === "weg" ? "WEG-Eigentuemervorschreibung" : "Mieter",
      r.tenantName || r.mieter || "",
      r.unitTopNummer || r.einheit || r.unitName || "",
      formatEur(gesamtbetrag),
      formatEur(paidAmount),
      formatEur(outstanding),
      dueDate ? formatDate(new Date(dueDate)) : "",
      status,
      overdueDays > 0 ? overdueDays.toString() : "",
    ];
  });

  return createWorkbook("OP-Liste", orgName, headers, rows);
}

export function exportVacancy(data: any[], orgName: string): Buffer {
  const headers = ["Objekt", "Einheit", "Status", "Flaeche", "Leerstand seit"];

  const rows = data.map((r) => [
    r.propertyName || r.objekt || "",
    r.unitName || r.einheit || r.topNummer || "",
    r.status || "",
    r.flaeche || r.area ? `${r.flaeche || r.area} m²` : "",
    r.leerstandSeit || r.vacantSince
      ? formatDate(new Date(r.leerstandSeit || r.vacantSince))
      : "",
  ]);

  return createWorkbook("Leerstandsbericht", orgName, headers, rows);
}
