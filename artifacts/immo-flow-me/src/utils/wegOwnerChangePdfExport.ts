import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { OwnerChangePreview } from '@/hooks/useWeg';

const monthNames = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

function fmtCur(amount: number): string {
  return `€ ${amount.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDateStr(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtPct(value: number): string {
  return `${value.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
}

export interface OwnerChangePdfParams {
  preview: OwnerChangePreview;
  propertyName: string;
  propertyAddress: string;
  propertyCity: string;
  rechtsgrund: string;
  grundbuchDate?: string | null;
  tzNumber?: string | null;
  kaufvertragDate?: string | null;
}

const rechtsgrundLabels: Record<string, string> = {
  kauf: 'Kauf', schenkung: 'Schenkung', erbschaft: 'Erbschaft',
  zwangsversteigerung: 'Zwangsversteigerung', einbringung: 'Einbringung',
};

export function generateOwnerChangePdf(params: OwnerChangePdfParams): Blob {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let yPos = 20;
  const p = params.preview;

  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text('Hausverwaltung', margin, yPos);
  yPos += 5;
  doc.text(params.propertyAddress || '', margin, yPos);
  yPos += 5;
  doc.text(params.propertyCity || '', margin, yPos);
  yPos += 15;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('Übergabebestätigung Eigentümerwechsel', margin, yPos);
  yPos += 8;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`gemäß § 38 WEG 2002`, margin, yPos);
  yPos += 12;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Liegenschaft', margin, yPos);
  yPos += 5;
  doc.setFont('helvetica', 'normal');
  doc.text(`${params.propertyName}`, margin, yPos);
  yPos += 5;
  doc.text(`${params.propertyAddress}, ${params.propertyCity}`, margin, yPos);
  yPos += 5;
  doc.text(`Einheit: Top ${p.unit?.top_nummer || '—'} (${p.unit?.type === 'wohnung' ? 'Wohnung' : p.unit?.type === 'geschaeft' ? 'Geschäft' : p.unit?.type === 'garage' ? 'Garage' : p.unit?.type || '—'})`, margin, yPos);
  yPos += 10;

  const detailsData: string[][] = [
    ['Bisheriger Eigentümer', p.previous_owner?.name || '—'],
    ['Neuer Eigentümer', p.new_owner?.name || '—'],
    ['Übergabedatum (Stichtag)', fmtDateStr(p.transfer.transfer_date)],
    ['Rechtsgrund', rechtsgrundLabels[params.rechtsgrund] || params.rechtsgrund],
  ];
  if (params.grundbuchDate) detailsData.push(['Grundbuch-Eintragung', fmtDateStr(params.grundbuchDate)]);
  if (params.tzNumber) detailsData.push(['TZ-Nummer', params.tzNumber]);
  if (params.kaufvertragDate) detailsData.push(['Kaufvertragsdatum', fmtDateStr(params.kaufvertragDate)]);
  detailsData.push(['MEA-Anteil', fmtPct(p.financials.mea_share)]);

  autoTable(doc, {
    startY: yPos,
    head: [['', '']],
    body: detailsData,
    showHead: false,
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
    theme: 'plain',
  });

  yPos = (doc as any).lastAutoTable.finalY + 10;

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Aliquotierung (§ 34 WEG)', margin, yPos);
  yPos += 7;

  const aliqData: string[][] = [
    ['Übergangsmonat', `${monthNames[p.transfer.transfer_month - 1]} ${p.transfer.transfer_year}`],
    ['Übergabetag', `${p.transfer.transfer_day}. des Monats`],
    ['Alter Eigentümer', `${p.aliquotierung.old_owner_days_in_month} Tage → ${fmtCur(p.aliquotierung.aliquot_old_month)}`],
    ['Neuer Eigentümer', `${p.aliquotierung.new_owner_days_in_month} Tage → ${fmtCur(p.aliquotierung.aliquot_new_month)}`],
    ['Monatliche Vorschreibung', fmtCur(p.aliquotierung.monthly_amount)],
    ['Jahresanteil (alt)', `${p.aliquotierung.old_owner_days_in_year} Tage → ${fmtCur(p.aliquotierung.aliquot_old_year)}`],
    ['Jahresanteil (neu)', `${p.aliquotierung.new_owner_days_in_year} Tage → ${fmtCur(p.aliquotierung.aliquot_new_year)}`],
  ];

  autoTable(doc, {
    startY: yPos,
    head: [['', '']],
    body: aliqData,
    showHead: false,
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
    theme: 'striped',
  });

  yPos = (doc as any).lastAutoTable.finalY + 10;

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Finanzielle Auswirkungen', margin, yPos);
  yPos += 7;

  const finData: string[][] = [
    ['Rücklagestand (Gesamt)', fmtCur(p.financials.reserve_total)],
    ['Rücklagen-Anteil (Top)', fmtCur(p.financials.reserve_share)],
    ['Offene Rückstände', fmtCur(p.financials.past_due_amount)],
    ['Stornierte Vorschreibungen', String(p.financials.future_invoices_to_cancel)],
    ['Neue Vorschreibungen', `${p.new_invoices.count} Monate`],
  ];

  autoTable(doc, {
    startY: yPos,
    head: [['', '']],
    body: finData,
    showHead: false,
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
    theme: 'striped',
  });

  yPos = (doc as any).lastAutoTable.finalY + 10;

  if (p.financials.past_due_amount > 0) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(180, 0, 0);
    doc.text('Hinweis § 38 WEG – Solidarhaftung:', margin, yPos);
    yPos += 5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 0, 0);
    const warnText = `Der neue Eigentümer haftet gemäß § 38 Abs 1 WEG solidarisch für BK-Rückstände des Voreigentümers bis zu 3 Jahren. Offene Rückstände: ${fmtCur(p.financials.past_due_amount)}`;
    const splitWarn = doc.splitTextToSize(warnText, pageWidth - margin * 2);
    doc.text(splitWarn, margin, yPos);
    yPos += splitWarn.length * 4 + 6;
  }

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('Rücklage (§ 39 WEG):', margin, yPos);
  yPos += 5;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 80, 80);
  const reserveText = 'Der Anteil an der Instandhaltungsrücklage geht automatisch auf den neuen Eigentümer über. Eine Auszahlung an den bisherigen Eigentümer erfolgt nicht (Vermögen der WEG).';
  const splitReserve = doc.splitTextToSize(reserveText, pageWidth - margin * 2);
  doc.text(splitReserve, margin, yPos);
  yPos += splitReserve.length * 4 + 10;

  doc.setDrawColor(200, 200, 200);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 8;

  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text(`Erstellt am: ${new Date().toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`, margin, yPos);
  yPos += 4;
  doc.text('Dieses Dokument wurde maschinell erstellt und dient als Nachweis des Eigentümerwechsels.', margin, yPos);

  return doc.output('blob');
}

export function downloadOwnerChangePdf(params: OwnerChangePdfParams) {
  const blob = generateOwnerChangePdf(params);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const unitTop = params.preview.unit?.top_nummer || 'X';
  const date = params.preview.transfer.transfer_date.replace(/-/g, '');
  link.download = `Eigentuemerwechsel_Top${unitTop}_${date}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
