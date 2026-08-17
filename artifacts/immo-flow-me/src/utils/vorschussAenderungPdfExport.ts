import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface VorschussAenderungParams {
  tenantName: string;
  propertyName: string;
  propertyAddress: string;
  unitNumber: string;
  oldBk: number;
  newBk: number;
  oldHk: number;
  newHk: number;
  grundmiete: number;
  effectiveMonth: number;
  effectiveYear: number;
  settlementYear: number;
}

const monthNames = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

function formatCurrency(amount: number): string {
  return `€ ${amount.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Generate a PDF letter informing tenants about changes to their advance payments
 * @returns Blob of the generated PDF
 */
export function generateVorschussAenderungPdf(params: VorschussAenderungParams): Blob {
  const {
    tenantName,
    propertyName,
    propertyAddress,
    unitNumber,
    oldBk,
    newBk,
    oldHk,
    newHk,
    grundmiete,
    effectiveMonth,
    effectiveYear,
    settlementYear,
  } = params;

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let yPos = 20;

  const effectiveMonthName = monthNames[effectiveMonth - 1];
  const effectiveDate = `01.${String(effectiveMonth).padStart(2, '0')}.${effectiveYear}`;

  // Calculate totals
  const oldTotal = grundmiete + oldBk + oldHk;
  const newTotal = grundmiete + newBk + newHk;
  const diffBk = newBk - oldBk;
  const diffHk = newHk - oldHk;
  const diffTotal = newTotal - oldTotal;

  // Header - Sender
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text('HausVerwalter - Immobilienverwaltung', margin, yPos);
  yPos += 15;

  // Recipient
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text(tenantName, margin, yPos);
  yPos += 5;
  doc.text(propertyName, margin, yPos);
  yPos += 5;
  doc.text(`Top ${unitNumber}`, margin, yPos);
  yPos += 5;
  doc.text(propertyAddress, margin, yPos);
  yPos += 15;

  // Date right-aligned
  doc.setFontSize(10);
  doc.text(`Datum: ${formatDate(new Date())}`, pageWidth - margin - 40, yPos - 30);

  // Subject
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(`Anpassung Ihrer monatlichen Vorauszahlungen ab ${effectiveMonthName} ${effectiveYear}`, margin, yPos);
  yPos += 10;

  // Salutation
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Sehr geehrte/r ${tenantName},`, margin, yPos);
  yPos += 8;

  // Introduction text
  const introText = `aufgrund der Betriebskostenabrechnung für das Jahr ${settlementYear} ergibt sich eine Anpassung Ihrer monatlichen Vorauszahlungen. Diese Anpassung erfolgt gemäß § 21 Abs. 3 MRG auf Grundlage der tatsächlich angefallenen Betriebskosten.`;
  const splitIntro = doc.splitTextToSize(introText, pageWidth - 2 * margin);
  doc.text(splitIntro, margin, yPos);
  yPos += splitIntro.length * 5 + 10;

  // Table header
  doc.setFont('helvetica', 'bold');
  doc.text('Ihre neue monatliche Vorschreibung:', margin, yPos);
  yPos += 8;

  // Comparison table
  const formatDiff = (diff: number): string => {
    if (diff === 0) return '±€ 0,00';
    const sign = diff > 0 ? '+' : '';
    return `${sign}${formatCurrency(diff)}`;
  };

  autoTable(doc, {
    startY: yPos,
    head: [['Position', 'Bisher', 'Neu', 'Differenz']],
    body: [
      ['Grundmiete', formatCurrency(grundmiete), formatCurrency(grundmiete), '±€ 0,00'],
      [
        'Betriebskostenvorschuss',
        formatCurrency(oldBk),
        formatCurrency(newBk),
        { content: formatDiff(diffBk), styles: { textColor: diffBk > 0 ? [220, 38, 38] : diffBk < 0 ? [22, 163, 74] : [0, 0, 0] } },
      ],
      [
        'Heizungskostenvorschuss',
        formatCurrency(oldHk),
        formatCurrency(newHk),
        { content: formatDiff(diffHk), styles: { textColor: diffHk > 0 ? [220, 38, 38] : diffHk < 0 ? [22, 163, 74] : [0, 0, 0] } },
      ],
      [
        { content: 'Gesamtbetrag monatlich', styles: { fontStyle: 'bold' } },
        { content: formatCurrency(oldTotal), styles: { fontStyle: 'bold' } },
        { content: formatCurrency(newTotal), styles: { fontStyle: 'bold' } },
        {
          content: formatDiff(diffTotal),
          styles: {
            fontStyle: 'bold',
            textColor: diffTotal > 0 ? [220, 38, 38] : diffTotal < 0 ? [22, 163, 74] : [0, 0, 0],
          },
        },
      ],
    ],
    theme: 'striped',
    headStyles: { fillColor: [59, 130, 246], fontSize: 10 },
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: {
      0: { cellWidth: 60 },
      1: { cellWidth: 35, halign: 'right' },
      2: { cellWidth: 35, halign: 'right' },
      3: { cellWidth: 35, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  yPos = (doc as any).lastAutoTable.finalY + 10;

  // Effective date
  doc.setFont('helvetica', 'bold');
  doc.text(`Gültig ab: ${effectiveDate}`, margin, yPos);
  yPos += 10;

  doc.setFont('helvetica', 'normal');

  // Explanation text based on change direction
  let explanationText = '';
  if (diffTotal > 0) {
    explanationText = `Die Erhöhung um ${formatCurrency(diffTotal)} monatlich ergibt sich aus den gestiegenen Betriebskosten im Abrechnungsjahr ${settlementYear}. Bitte berücksichtigen Sie diese Anpassung ab ${effectiveMonthName} ${effectiveYear} bei Ihrer Mietzahlung.`;
  } else if (diffTotal < 0) {
    explanationText = `Aufgrund der geringeren Kosten im Abrechnungsjahr ${settlementYear} reduziert sich Ihre monatliche Vorauszahlung um ${formatCurrency(Math.abs(diffTotal))}. Die neue Vorschreibung gilt ab ${effectiveMonthName} ${effectiveYear}.`;
  } else {
    explanationText = `Die Vorauszahlungen bleiben unverändert, da die Kosten im Abrechnungsjahr ${settlementYear} den bisherigen Vorauszahlungen entsprechen.`;
  }

  const splitExplanation = doc.splitTextToSize(explanationText, pageWidth - 2 * margin);
  doc.text(splitExplanation, margin, yPos);
  yPos += splitExplanation.length * 5 + 15;

  // Closing text
  const closingText = 'Bei Fragen zur Anpassung der Vorauszahlungen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\nIhre Hausverwaltung';
  const splitClosing = doc.splitTextToSize(closingText, pageWidth - 2 * margin);
  doc.text(splitClosing, margin, yPos);

  // Footer
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(128);
  doc.text(`Vorschuss-Änderung ab ${effectiveMonthName} ${effectiveYear} - ${propertyName} - Top ${unitNumber}`, margin, pageHeight - 10);
  doc.text('Seite 1 von 1', pageWidth - margin - 20, pageHeight - 10);

  // Return as blob
  return doc.output('blob');
}

/**
 * Generate and download a PDF letter for advance payment changes
 */
export function downloadVorschussAenderungPdf(params: VorschussAenderungParams): void {
  const blob = generateVorschussAenderungPdf(params);
  
  const effectiveMonthName = monthNames[params.effectiveMonth - 1];
  const sanitizedName = params.tenantName.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, '_');
  const filename = `Vorschuss-Aenderung_${effectiveMonthName}_${params.effectiveYear}_Top${params.unitNumber}_${sanitizedName}.pdf`;
  
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
