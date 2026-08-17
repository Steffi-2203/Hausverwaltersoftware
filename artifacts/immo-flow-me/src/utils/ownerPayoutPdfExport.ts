import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface OwnerPayoutData {
  ownerName: string;
  ownerAddress?: string;
  ownerIban?: string;
  ownerBic?: string;
  propertyName: string;
  propertyAddress: string;
  periodFrom: string;
  periodTo: string;
  totalIncome: number;
  totalExpenses: number;
  managementFee: number;
  netPayout: number;
  ownershipShare: number;
  organizationName: string;
  incomeDetails?: { label: string; amount: number }[];
  expenseDetails?: { label: string; amount: number }[];
}

function fmt(amount: number): string {
  return `€ ${amount.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function generateOwnerPayoutPdf(data: OwnerPayoutData): jsPDF {
  const doc = new jsPDF();

  // Header
  doc.setFontSize(18);
  doc.text('Eigentümer-Abrechnung', 14, 22);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(data.organizationName, 14, 30);
  doc.text(`Abrechnungszeitraum: ${fmtDate(data.periodFrom)} – ${fmtDate(data.periodTo)}`, 14, 36);

  // Property info
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text('Liegenschaft:', 14, 48);
  doc.setFont(undefined!, 'bold');
  doc.text(data.propertyName, 55, 48);
  doc.setFont(undefined!, 'normal');
  doc.text(data.propertyAddress, 55, 54);

  // Owner info
  doc.text('Eigentümer:', 14, 66);
  doc.setFont(undefined!, 'bold');
  doc.text(data.ownerName, 55, 66);
  doc.setFont(undefined!, 'normal');
  if (data.ownerAddress) doc.text(data.ownerAddress, 55, 72);
  doc.text(`Eigentumsanteil: ${data.ownershipShare}%`, 55, data.ownerAddress ? 78 : 72);

  let yPos = data.ownerAddress ? 90 : 84;

  // Income details
  if (data.incomeDetails && data.incomeDetails.length > 0) {
    autoTable(doc, {
      startY: yPos,
      head: [['Einnahmen', 'Betrag']],
      body: [
        ...data.incomeDetails.map(item => [item.label, fmt(item.amount)]),
        [{ content: 'Gesamt Einnahmen', styles: { fontStyle: 'bold' } }, { content: fmt(data.totalIncome), styles: { fontStyle: 'bold' } }],
      ],
      theme: 'grid',
      headStyles: { fillColor: [46, 125, 50] },
      columnStyles: { 1: { halign: 'right' } },
      margin: { left: 14 },
    });
    yPos = (doc as any).lastAutoTable.finalY + 10;
  }

  // Expense details
  if (data.expenseDetails && data.expenseDetails.length > 0) {
    autoTable(doc, {
      startY: yPos,
      head: [['Ausgaben', 'Betrag']],
      body: [
        ...data.expenseDetails.map(item => [item.label, fmt(item.amount)]),
        [{ content: 'Gesamt Ausgaben', styles: { fontStyle: 'bold' } }, { content: fmt(data.totalExpenses), styles: { fontStyle: 'bold' } }],
      ],
      theme: 'grid',
      headStyles: { fillColor: [211, 47, 47] },
      columnStyles: { 1: { halign: 'right' } },
      margin: { left: 14 },
    });
    yPos = (doc as any).lastAutoTable.finalY + 10;
  }

  // Summary
  autoTable(doc, {
    startY: yPos,
    head: [['Zusammenfassung', 'Betrag']],
    body: [
      ['Mieteinnahmen (Anteil)', fmt(data.totalIncome)],
      ['Abzüglich Ausgaben', fmt(-data.totalExpenses)],
      ['Abzüglich Verwaltungshonorar', fmt(-data.managementFee)],
      [{ content: 'Netto-Auszahlung', styles: { fontStyle: 'bold', fontSize: 12 } }, { content: fmt(data.netPayout), styles: { fontStyle: 'bold', fontSize: 12 } }],
    ],
    theme: 'grid',
    headStyles: { fillColor: [25, 118, 210] },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: 14 },
  });

  yPos = (doc as any).lastAutoTable.finalY + 15;

  // Bank details
  if (data.ownerIban) {
    doc.setFontSize(10);
    doc.text('Auszahlung an:', 14, yPos);
    doc.text(`IBAN: ${data.ownerIban}`, 14, yPos + 6);
    if (data.ownerBic) doc.text(`BIC: ${data.ownerBic}`, 14, yPos + 12);
  }

  // Footer
  const pageHeight = doc.internal.pageSize.height;
  doc.setFontSize(8);
  doc.setTextColor(128);
  doc.text(`Erstellt am ${new Date().toLocaleDateString('de-AT')} | ${data.organizationName}`, 14, pageHeight - 10);

  return doc;
}

export function downloadOwnerPayoutPdf(data: OwnerPayoutData): void {
  const doc = generateOwnerPayoutPdf(data);
  const fileName = `Eigentuemer-Abrechnung_${data.ownerName.replace(/[^a-zA-Z0-9]/g, '_')}_${data.periodFrom}_${data.periodTo}.pdf`;
  doc.save(fileName);
}
