import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface VorschreibungParams {
  tenantName: string;
  propertyName: string;
  propertyAddress: string;
  propertyCity: string;
  unitNumber: string;
  month: number;
  year: number;
  grundmiete: number;
  betriebskosten: number;
  heizungskosten: number;
  ustSatzMiete: number;
  ustSatzBk: number;
  ustSatzHeizung: number;
  ust: number;
  gesamtbetrag: number;
  faelligAm: string;
  iban?: string;
  bic?: string;
  // Vortrag fields
  vortragMiete?: number;
  vortragBk?: number;
  vortragHk?: number;
  vortragSonstige?: number;
}

const monthNames = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

function formatCurrency(amount: number): string {
  return `€ ${amount.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Generate a monthly invoice PDF (Vorschreibung)
 * @returns Blob of the generated PDF
 */
export function generateVorschreibungPdf(params: VorschreibungParams): Blob {
  const {
    tenantName,
    propertyName,
    propertyAddress,
    propertyCity,
    unitNumber,
    month,
    year,
    grundmiete,
    betriebskosten,
    heizungskosten,
    ustSatzMiete,
    ustSatzBk,
    ustSatzHeizung,
    ust,
    gesamtbetrag,
    faelligAm,
    iban,
    bic,
    vortragMiete = 0,
    vortragBk = 0,
    vortragHk = 0,
    vortragSonstige = 0,
  } = params;

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let yPos = 20;

  const monthName = monthNames[month - 1];
  const vortragGesamt = vortragMiete + vortragBk + vortragHk + vortragSonstige;
  const hasVortrag = vortragGesamt !== 0;

  // Calculate USt amounts for each position
  const ustMiete = (grundmiete * ustSatzMiete) / 100;
  const ustBk = (betriebskosten * ustSatzBk) / 100;
  const ustHeizung = (heizungskosten * ustSatzHeizung) / 100;

  // Gross amounts (including USt)
  const grundmieteBrutto = grundmiete + ustMiete;
  const betriebskostenBrutto = betriebskosten + ustBk;
  const heizkostenBrutto = heizungskosten + ustHeizung;
  const laufendeKosten = grundmieteBrutto + betriebskostenBrutto + heizkostenBrutto;

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
  doc.text(propertyAddress, margin, yPos);
  yPos += 5;
  doc.text(`Top ${unitNumber}`, margin, yPos);
  yPos += 5;
  doc.text(propertyCity, margin, yPos);
  yPos += 15;

  // Date and invoice number right-aligned
  doc.setFontSize(10);
  const today = new Date();
  doc.text(`Datum: ${today.toLocaleDateString('de-AT')}`, pageWidth - margin - 40, yPos - 30);
  doc.text(`Nr.: ${year}-${String(month).padStart(2, '0')}-${unitNumber}`, pageWidth - margin - 40, yPos - 24);

  // Subject
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(`Monatliche Vorschreibung ${monthName} ${year}`, margin, yPos);
  yPos += 10;

  // Property info
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80);
  doc.text(`Liegenschaft: ${propertyName} | Top ${unitNumber}`, margin, yPos);
  yPos += 10;

  // Salutation
  doc.setTextColor(0);
  doc.text(`Sehr geehrte/r ${tenantName},`, margin, yPos);
  yPos += 8;

  // Introduction text
  const introText = `hiermit übersenden wir Ihnen die monatliche Vorschreibung für ${monthName} ${year}. Bitte überweisen Sie den folgenden Betrag bis zum angegebenen Fälligkeitsdatum.`;
  const splitIntro = doc.splitTextToSize(introText, pageWidth - 2 * margin);
  doc.text(splitIntro, margin, yPos);
  yPos += splitIntro.length * 5 + 10;

  // Build table body
  const tableBody: any[][] = [
    [
      'Grundmiete',
      formatCurrency(grundmiete),
      ustSatzMiete > 0 ? `${ustSatzMiete}% (${formatCurrency(ustMiete)})` : '-',
      formatCurrency(grundmieteBrutto),
    ],
    [
      'Betriebskostenvorschuss',
      formatCurrency(betriebskosten),
      ustSatzBk > 0 ? `${ustSatzBk}% (${formatCurrency(ustBk)})` : '-',
      formatCurrency(betriebskostenBrutto),
    ],
    [
      'Heizungskostenvorschuss',
      formatCurrency(heizungskosten),
      ustSatzHeizung > 0 ? `${ustSatzHeizung}% (${formatCurrency(ustHeizung)})` : '-',
      formatCurrency(heizkostenBrutto),
    ],
  ];

  // Add Vortrag rows if applicable
  if (hasVortrag) {
    // Add subtotal row for running costs
    tableBody.push([
      { content: 'Zwischensumme laufende Kosten', styles: { fontStyle: 'bold' } },
      '',
      '',
      { content: formatCurrency(laufendeKosten), styles: { fontStyle: 'bold' } },
    ]);

    // Add Vortrag header
    tableBody.push([
      { 
        content: `Vortrag aus ${year - 1}`, 
        colSpan: 4, 
        styles: { 
          fontStyle: 'bold', 
          fillColor: [255, 243, 205],
          textColor: [120, 80, 0]
        } 
      },
    ]);

    if (vortragMiete !== 0) {
      tableBody.push([
        '  Offene Miete',
        '',
        '',
        formatCurrency(vortragMiete),
      ]);
    }

    if (vortragBk !== 0) {
      tableBody.push([
        '  Offene Betriebskosten',
        '',
        '',
        formatCurrency(vortragBk),
      ]);
    }

    if (vortragHk !== 0) {
      tableBody.push([
        '  Offene Heizungskosten',
        '',
        '',
        formatCurrency(vortragHk),
      ]);
    }

    if (vortragSonstige !== 0) {
      tableBody.push([
        '  Sonstige (BK-Abrechnung o.ä.)',
        '',
        '',
        formatCurrency(vortragSonstige),
      ]);
    }

    tableBody.push([
      { content: 'Vortrag gesamt', styles: { fontStyle: 'bold' } },
      '',
      '',
      { content: formatCurrency(vortragGesamt), styles: { fontStyle: 'bold' } },
    ]);
  }

  // Invoice table
  autoTable(doc, {
    startY: yPos,
    head: [['Position', 'Netto', 'USt.', 'Brutto']],
    body: tableBody,
    foot: [[
      { content: 'Gesamtbetrag', styles: { fontStyle: 'bold' } },
      { content: formatCurrency(grundmiete + betriebskosten + heizungskosten), styles: { fontStyle: 'bold' } },
      { content: formatCurrency(ust), styles: { fontStyle: 'bold' } },
      { content: formatCurrency(gesamtbetrag), styles: { fontStyle: 'bold', fillColor: [59, 130, 246], textColor: [255, 255, 255] } },
    ]],
    theme: 'striped',
    headStyles: { fillColor: [59, 130, 246], fontSize: 10 },
    footStyles: { fillColor: [240, 240, 240], fontSize: 10 },
    styles: { fontSize: 10, cellPadding: 4 },
    columnStyles: {
      0: { cellWidth: 60 },
      1: { cellWidth: 35, halign: 'right' },
      2: { cellWidth: 45, halign: 'right' },
      3: { cellWidth: 35, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  yPos = (doc as any).lastAutoTable.finalY + 15;

  // Due date box
  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(0.5);
  doc.roundedRect(margin, yPos, pageWidth - 2 * margin, 20, 3, 3);
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Fälligkeitsdatum: ${formatDate(faelligAm)}`, margin + 5, yPos + 8);
  doc.text(`Zu zahlen: ${formatCurrency(gesamtbetrag)}`, margin + 5, yPos + 15);
  
  yPos += 30;

  // Payment information
  if (iban || bic) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Bankverbindung:', margin, yPos);
    yPos += 6;
    
    doc.setFont('helvetica', 'normal');
    if (iban) {
      doc.text(`IBAN: ${iban}`, margin, yPos);
      yPos += 5;
    }
    if (bic) {
      doc.text(`BIC: ${bic}`, margin, yPos);
      yPos += 5;
    }
    doc.text(`Verwendungszweck: Miete ${monthName} ${year} - Top ${unitNumber}`, margin, yPos);
    yPos += 10;
  }

  // Closing text
  yPos += 5;
  const closingText = 'Bei Fragen zu dieser Vorschreibung stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\nIhre Hausverwaltung';
  const splitClosing = doc.splitTextToSize(closingText, pageWidth - 2 * margin);
  doc.text(splitClosing, margin, yPos);

  // Footer
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(128);
  doc.text(`Vorschreibung ${monthName} ${year} - ${propertyName} - Top ${unitNumber}`, margin, pageHeight - 10);
  doc.text('Seite 1 von 1', pageWidth - margin - 20, pageHeight - 10);

  // Return as blob
  return doc.output('blob');
}

/**
 * Generate and download a monthly invoice PDF
 */
export function downloadVorschreibungPdf(params: VorschreibungParams): void {
  const blob = generateVorschreibungPdf(params);
  
  const monthName = monthNames[params.month - 1];
  const sanitizedName = params.tenantName.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, '_');
  const filename = `Vorschreibung_${monthName}_${params.year}_Top${params.unitNumber}_${sanitizedName}.pdf`;
  
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
