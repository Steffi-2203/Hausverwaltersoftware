import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface WegVorschreibungPdfParams {
  ownerName: string;
  ownerAddress?: string;
  ownerCity?: string;
  propertyName: string;
  propertyAddress: string;
  propertyCity: string;
  unitTop: string;
  unitType: string;
  month: number;
  year: number;
  bkNetto: number;
  bkUstRate: number;
  hkNetto: number;
  hkUstRate: number;
  ruecklage: number;
  verwaltungNetto: number;
  verwaltungUstRate: number;
  sonstigesNetto: number;
  gesamtBrutto: number;
  faelligAm: string;
  iban?: string;
  bic?: string;
  verwendungszweck?: string;
}

const monthNames = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

function fmtCur(amount: number): string {
  return `\u20AC ${amount.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDateStr(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function generateWegVorschreibungPdf(params: WegVorschreibungPdfParams): Blob {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let yPos = 20;

  const monthName = monthNames[params.month - 1];

  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text('Hausverwaltung', margin, yPos);
  yPos += 5;
  doc.text(params.propertyAddress || '', margin, yPos);
  yPos += 5;
  doc.text(params.propertyCity || '', margin, yPos);
  yPos += 12;

  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text(params.ownerName, margin, yPos);
  yPos += 5;
  if (params.ownerAddress) {
    doc.text(params.ownerAddress, margin, yPos);
    yPos += 5;
  }
  if (params.ownerCity) {
    doc.text(params.ownerCity, margin, yPos);
    yPos += 5;
  }
  yPos += 10;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(`Vorschreibung ${monthName} ${params.year}`, margin, yPos);
  yPos += 7;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Liegenschaft: ${params.propertyName}`, margin, yPos);
  yPos += 5;
  doc.text(`Einheit: Top ${params.unitTop} (${params.unitType === 'wohnung' ? 'Wohnung' : params.unitType === 'geschaeft' ? 'Geschäft' : params.unitType === 'garage' ? 'Garage' : params.unitType})`, margin, yPos);
  yPos += 10;

  const bkUst = params.bkNetto * params.bkUstRate / 100;
  const hkUst = params.hkNetto * params.hkUstRate / 100;
  const verwUst = params.verwaltungNetto * params.verwaltungUstRate / 100;
  const sonstigesUst = params.sonstigesNetto * 10 / 100;

  const tableData: (string | number)[][] = [];

  if (params.bkNetto > 0) {
    tableData.push(['Betriebskosten', fmtCur(params.bkNetto), `${params.bkUstRate}%`, fmtCur(bkUst), fmtCur(params.bkNetto + bkUst)]);
  }
  if (params.hkNetto > 0) {
    tableData.push(['Heizkosten-Akonto', fmtCur(params.hkNetto), `${params.hkUstRate}%`, fmtCur(hkUst), fmtCur(params.hkNetto + hkUst)]);
  }
  if (params.ruecklage > 0) {
    tableData.push(['Instandhaltungsrücklage', fmtCur(params.ruecklage), '-', '-', fmtCur(params.ruecklage)]);
  }
  if (params.verwaltungNetto > 0) {
    tableData.push(['Verwaltungshonorar', fmtCur(params.verwaltungNetto), `${params.verwaltungUstRate}%`, fmtCur(verwUst), fmtCur(params.verwaltungNetto + verwUst)]);
  }
  if (params.sonstigesNetto > 0) {
    tableData.push(['Sonstige Kosten', fmtCur(params.sonstigesNetto), '10%', fmtCur(sonstigesUst), fmtCur(params.sonstigesNetto + sonstigesUst)]);
  }

  autoTable(doc, {
    startY: yPos,
    head: [['Position', 'Netto', 'USt %', 'USt', 'Brutto']],
    body: tableData,
    foot: [['Gesamt', '', '', '', fmtCur(params.gesamtBrutto)]],
    theme: 'grid',
    headStyles: { fillColor: [41, 65, 94], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
    footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 10 },
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 55 },
      1: { halign: 'right', cellWidth: 30 },
      2: { halign: 'center', cellWidth: 20 },
      3: { halign: 'right', cellWidth: 25 },
      4: { halign: 'right', cellWidth: 30 },
    },
    margin: { left: margin, right: margin },
  });

  yPos = (doc as any).lastAutoTable.finalY + 15;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`Fälligkeitsdatum: ${fmtDateStr(params.faelligAm)}`, margin, yPos);
  yPos += 10;

  if (params.iban || params.bic) {
    doc.setFont('helvetica', 'normal');
    doc.text('Zahlungsinformationen:', margin, yPos);
    yPos += 6;
    if (params.iban) {
      doc.text(`IBAN: ${params.iban}`, margin, yPos);
      yPos += 5;
    }
    if (params.bic) {
      doc.text(`BIC: ${params.bic}`, margin, yPos);
      yPos += 5;
    }
    if (params.verwendungszweck) {
      doc.text(`Verwendungszweck: ${params.verwendungszweck}`, margin, yPos);
      yPos += 5;
    }
    yPos += 5;
  }

  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  const footerY = doc.internal.pageSize.getHeight() - 15;
  doc.text('Diese Vorschreibung basiert auf dem beschlossenen Wirtschaftsplan gemäß § 20 Abs 2 WEG 2002.', margin, footerY);
  doc.text('Die Beträge sind Vorschüsse – die tatsächliche Abrechnung erfolgt nachträglich.', margin, footerY + 4);

  return doc.output('blob');
}

export function downloadWegVorschreibungPdf(params: WegVorschreibungPdfParams, filename?: string) {
  const blob = generateWegVorschreibungPdf(params);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `Vorschreibung_${params.unitTop}_${monthNames[params.month - 1]}_${params.year}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
