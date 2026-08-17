import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface PropertyInfo {
  name: string;
  address: string;
  city: string;
  postal_code: string;
}

interface UnitSettlement {
  top_nummer: string;
  type: string;
  qm: number;
  mea: number;
  bkMieter: string | null;
  hkMieter: string | null;
  totalBkCost: number;
  hkCost: number;
  bkVorschuss: number;
  hkVorschuss: number;
  bkSaldo: number;
  hkSaldo: number;
  gesamtSaldo: number;
  isLeerstandBK: boolean;
  isLeerstandHK: boolean;
  costs: Record<string, number>;
}

interface ExpenseDetail {
  type: string;
  label: string;
  distributionKey: string;
  totalAmount: number;
  unitShare: number;
}

const expenseTypeLabels: Record<string, string> = {
  versicherung: 'Versicherung',
  grundsteuer: 'Grundsteuer',
  muellabfuhr: 'Müllabfuhr',
  wasser_abwasser: 'Wasser/Abwasser',
  strom_allgemein: 'Allgemeinstrom',
  hausbetreuung: 'Hausbetreuung',
  lift: 'Lift',
  gartenpflege: 'Gartenpflege',
  schneeraeumung: 'Schneeräumung',
  verwaltung: 'Verwaltung',
  ruecklage: 'Rücklage',
  sonstiges: 'Sonstiges',
  heizung: 'Heizkosten',
};

const distributionKeyLabels: Record<string, string> = {
  mea: 'MEA',
  qm: 'qm',
  personen: 'Personen',
};

function formatCurrency(amount: number): string {
  return `€ ${amount.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function generateTenantSettlementPdf(
  property: PropertyInfo,
  unit: UnitSettlement,
  year: number,
  expensesByType: Record<string, number>,
  totalBkKosten: number,
  totalHeizkosten: number,
  totals: { qm: number; mea: number; personen: number },
  expenseDistributionKeys: Record<string, string>
): void {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let yPos = 20;

  // Determine recipient name
  const recipientName = unit.bkMieter || unit.hkMieter || 'Eigentümer';
  const isBkRecipient = !unit.isLeerstandBK;
  const isHkRecipient = !unit.isLeerstandHK;

  // Header - Absender
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text('HausVerwalter - Immobilienverwaltung', margin, yPos);
  yPos += 15;

  // Empfänger
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text(recipientName, margin, yPos);
  yPos += 5;
  doc.text(`${property.name}`, margin, yPos);
  yPos += 5;
  doc.text(`Top ${unit.top_nummer}`, margin, yPos);
  yPos += 5;
  doc.text(`${property.address}`, margin, yPos);
  yPos += 5;
  doc.text(`${property.postal_code} ${property.city}`, margin, yPos);
  yPos += 15;

  // Datum rechtsbündig
  doc.setFontSize(10);
  doc.text(`Datum: ${formatDate(new Date())}`, pageWidth - margin - 40, yPos - 30);

  // Betreff
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(`Betriebskostenabrechnung ${year}`, margin, yPos);
  yPos += 5;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Abrechnungszeitraum: 01.01.${year} - 31.12.${year}`, margin, yPos);
  yPos += 10;

  // Einleitungstext
  doc.setFontSize(10);
  const introText = `Sehr geehrte/r ${recipientName},\n\nanbei erhalten Sie die Betriebskostenabrechnung für das Jahr ${year} für die Einheit Top ${unit.top_nummer} in der Liegenschaft ${property.name}.`;
  const splitIntro = doc.splitTextToSize(introText, pageWidth - 2 * margin);
  doc.text(splitIntro, margin, yPos);
  yPos += splitIntro.length * 5 + 10;

  // Objektdaten
  doc.setFont('helvetica', 'bold');
  doc.text('Objektdaten:', margin, yPos);
  yPos += 6;
  doc.setFont('helvetica', 'normal');

  autoTable(doc, {
    startY: yPos,
    head: [],
    body: [
      ['Liegenschaft:', property.name],
      ['Adresse:', `${property.address}, ${property.postal_code} ${property.city}`],
      ['Einheit:', `Top ${unit.top_nummer} (${unit.type})`],
      ['Nutzfläche:', `${unit.qm.toLocaleString('de-AT')} m²`],
      ['MEA-Anteil:', `${unit.mea.toLocaleString('de-AT')} ‰`],
    ],
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 1 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 40 },
      1: { cellWidth: 'auto' },
    },
    margin: { left: margin },
  });

  yPos = (doc as any).lastAutoTable.finalY + 10;

  // Betriebskosten-Details (nur wenn Mieter BK zahlt)
  if (isBkRecipient) {
    doc.setFont('helvetica', 'bold');
    doc.text('Betriebskosten - Ihre Anteile:', margin, yPos);
    yPos += 6;

    const bkTableData: any[][] = [];
    Object.entries(expensesByType).forEach(([type, totalAmount]) => {
      const distributionKey = expenseDistributionKeys[type] || 'qm';
      const unitShare = unit.costs[type] || 0;
      bkTableData.push([
        expenseTypeLabels[type] || type,
        distributionKeyLabels[distributionKey] || distributionKey,
        formatCurrency(totalAmount),
        formatCurrency(unitShare),
      ]);
    });

    // Summe BK
    bkTableData.push([
      { content: 'Summe Betriebskosten', styles: { fontStyle: 'bold' } },
      '',
      { content: formatCurrency(totalBkKosten), styles: { fontStyle: 'bold' } },
      { content: formatCurrency(unit.totalBkCost), styles: { fontStyle: 'bold' } },
    ]);

    autoTable(doc, {
      startY: yPos,
      head: [['Kostenart', 'Schlüssel', 'Gesamt', 'Ihr Anteil']],
      body: bkTableData,
      theme: 'striped',
      headStyles: { fillColor: [59, 130, 246], fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: {
        0: { cellWidth: 50 },
        1: { cellWidth: 25 },
        2: { cellWidth: 35, halign: 'right' },
        3: { cellWidth: 35, halign: 'right' },
      },
      margin: { left: margin, right: margin },
    });

    yPos = (doc as any).lastAutoTable.finalY + 10;
  }

  // Heizkosten-Details (nur wenn Mieter/Altmieter HK zahlt)
  if (isHkRecipient) {
    doc.setFont('helvetica', 'bold');
    doc.text('Heizkosten - Ihre Anteile:', margin, yPos);
    yPos += 6;

    autoTable(doc, {
      startY: yPos,
      head: [['Kostenart', 'Schlüssel', 'Gesamt', 'Ihr Anteil']],
      body: [
        ['Heizkosten', 'qm', formatCurrency(totalHeizkosten), formatCurrency(unit.hkCost)],
        [
          { content: 'Summe Heizkosten', styles: { fontStyle: 'bold' } },
          '',
          { content: formatCurrency(totalHeizkosten), styles: { fontStyle: 'bold' } },
          { content: formatCurrency(unit.hkCost), styles: { fontStyle: 'bold' } },
        ],
      ],
      theme: 'striped',
      headStyles: { fillColor: [249, 115, 22], fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: {
        0: { cellWidth: 50 },
        1: { cellWidth: 25 },
        2: { cellWidth: 35, halign: 'right' },
        3: { cellWidth: 35, halign: 'right' },
      },
      margin: { left: margin, right: margin },
    });

    yPos = (doc as any).lastAutoTable.finalY + 10;
  }

  // Saldo-Berechnung
  doc.setFont('helvetica', 'bold');
  doc.text('Abrechnung und Saldo:', margin, yPos);
  yPos += 6;

  const saldoData: any[][] = [];

  if (isBkRecipient) {
    saldoData.push(['Betriebskosten - Ihr Anteil', formatCurrency(unit.totalBkCost)]);
    saldoData.push(['Betriebskosten - Ihre Vorauszahlungen', `- ${formatCurrency(unit.bkVorschuss)}`]);
    saldoData.push([
      { content: 'Saldo Betriebskosten', styles: { fontStyle: 'bold' } },
      {
        content: `${unit.bkSaldo >= 0 ? '' : '-'} ${formatCurrency(Math.abs(unit.bkSaldo))} ${unit.bkSaldo > 0 ? '(Nachzahlung)' : unit.bkSaldo < 0 ? '(Guthaben)' : ''}`,
        styles: { fontStyle: 'bold', textColor: unit.bkSaldo > 0 ? [220, 38, 38] : unit.bkSaldo < 0 ? [22, 163, 74] : [0, 0, 0] },
      },
    ]);
  }

  if (isHkRecipient) {
    if (isBkRecipient) saldoData.push(['', '']); // Leerzeile
    saldoData.push(['Heizkosten - Ihr Anteil', formatCurrency(unit.hkCost)]);
    saldoData.push(['Heizkosten - Ihre Vorauszahlungen', `- ${formatCurrency(unit.hkVorschuss)}`]);
    saldoData.push([
      { content: 'Saldo Heizkosten', styles: { fontStyle: 'bold' } },
      {
        content: `${unit.hkSaldo >= 0 ? '' : '-'} ${formatCurrency(Math.abs(unit.hkSaldo))} ${unit.hkSaldo > 0 ? '(Nachzahlung)' : unit.hkSaldo < 0 ? '(Guthaben)' : ''}`,
        styles: { fontStyle: 'bold', textColor: unit.hkSaldo > 0 ? [220, 38, 38] : unit.hkSaldo < 0 ? [22, 163, 74] : [0, 0, 0] },
      },
    ]);
  }

  // Gesamtsaldo (nur wenn beides zutrifft)
  if (isBkRecipient && isHkRecipient) {
    saldoData.push(['', '']); // Leerzeile
    saldoData.push([
      { content: 'GESAMTSALDO', styles: { fontStyle: 'bold', fontSize: 11 } },
      {
        content: `${unit.gesamtSaldo >= 0 ? '' : '-'} ${formatCurrency(Math.abs(unit.gesamtSaldo))} ${unit.gesamtSaldo > 0 ? '(Nachzahlung)' : unit.gesamtSaldo < 0 ? '(Guthaben)' : ''}`,
        styles: {
          fontStyle: 'bold',
          fontSize: 11,
          textColor: unit.gesamtSaldo > 0 ? [220, 38, 38] : unit.gesamtSaldo < 0 ? [22, 163, 74] : [0, 0, 0],
        },
      },
    ]);
  }

  autoTable(doc, {
    startY: yPos,
    head: [],
    body: saldoData,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 80 },
      1: { cellWidth: 60, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  yPos = (doc as any).lastAutoTable.finalY + 15;

  // Zahlungshinweis
  const gesamtSaldo = (isBkRecipient ? unit.bkSaldo : 0) + (isHkRecipient ? unit.hkSaldo : 0);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  
  let paymentText = '';
  if (gesamtSaldo > 0) {
    paymentText = `Wir bitten Sie, den Nachzahlungsbetrag von ${formatCurrency(gesamtSaldo)} innerhalb von 14 Tagen auf unser Konto zu überweisen.`;
  } else if (gesamtSaldo < 0) {
    paymentText = `Ihr Guthaben von ${formatCurrency(Math.abs(gesamtSaldo))} wird Ihnen mit der nächsten Mietzahlung gutgeschrieben.`;
  } else {
    paymentText = 'Die Abrechnung ist ausgeglichen. Es ergibt sich weder eine Nachzahlung noch ein Guthaben.';
  }

  const splitPayment = doc.splitTextToSize(paymentText, pageWidth - 2 * margin);
  doc.text(splitPayment, margin, yPos);
  yPos += splitPayment.length * 5 + 10;

  // Schlusstext
  const closingText = 'Bei Fragen zur Abrechnung stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\nIhre Hausverwaltung';
  const splitClosing = doc.splitTextToSize(closingText, pageWidth - 2 * margin);
  doc.text(splitClosing, margin, yPos);

  // Footer
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(128);
  doc.text(`Betriebskostenabrechnung ${year} - ${property.name} - Top ${unit.top_nummer}`, margin, pageHeight - 10);
  doc.text(`Seite 1 von 1`, pageWidth - margin - 20, pageHeight - 10);

  // Save PDF
  const sanitizedName = recipientName.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, '_');
  doc.save(`BK-Abrechnung_${year}_Top${unit.top_nummer}_${sanitizedName}.pdf`);
}

export function generateAllTenantSettlementsPdf(
  property: PropertyInfo,
  units: UnitSettlement[],
  year: number,
  expensesByType: Record<string, number>,
  totalBkKosten: number,
  totalHeizkosten: number,
  totals: { qm: number; mea: number; personen: number },
  expenseDistributionKeys: Record<string, string>
): void {
  // Generate individual PDFs for all units with tenants
  const unitsWithTenants = units.filter(u => !u.isLeerstandBK || !u.isLeerstandHK);
  
  unitsWithTenants.forEach((unit, index) => {
    // Small delay to prevent browser blocking multiple downloads
    setTimeout(() => {
      generateTenantSettlementPdf(
        property,
        unit,
        year,
        expensesByType,
        totalBkKosten,
        totalHeizkosten,
        totals,
        expenseDistributionKeys
      );
    }, index * 500);
  });
}

export function generateGesamtabrechnungPdf(
  property: PropertyInfo,
  units: UnitSettlement[],
  year: number,
  expensesByType: Record<string, number>,
  totalBkKosten: number,
  totalHeizkosten: number,
  totals: { qm: number; mea: number; personen: number },
  expenseDistributionKeys: Record<string, string>,
  verificationSums: {
    sumBkVerteilt: number;
    sumHkVerteilt: number;
    bkMieter: number;
    hkMieter: number;
    bkEigentuemer: number;
    hkEigentuemer: number;
    bkVorschuss: number;
    hkVorschuss: number;
    bkSaldoGesamt: number;
    hkSaldoGesamt: number;
  }
): void {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  let yPos = 15;

  // Title
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(`Gesamtbetriebskostenabrechnung ${year}`, margin, yPos);
  yPos += 8;

  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(`${property.name}`, margin, yPos);
  yPos += 5;
  doc.setFontSize(10);
  doc.text(`${property.address}, ${property.postal_code} ${property.city}`, margin, yPos);
  yPos += 10;

  // Gesamtkosten Übersicht
  doc.setFont('helvetica', 'bold');
  doc.text('Gesamtkosten-Übersicht:', margin, yPos);
  yPos += 6;

  autoTable(doc, {
    startY: yPos,
    head: [['Kostenart', 'Gesamt', 'Mieter', 'Eigentümer']],
    body: [
      ['Betriebskosten', formatCurrency(totalBkKosten), formatCurrency(verificationSums.bkMieter), formatCurrency(verificationSums.bkEigentuemer)],
      ['Heizkosten', formatCurrency(totalHeizkosten), formatCurrency(verificationSums.hkMieter), formatCurrency(verificationSums.hkEigentuemer)],
      [
        { content: 'Gesamt', styles: { fontStyle: 'bold' } },
        { content: formatCurrency(totalBkKosten + totalHeizkosten), styles: { fontStyle: 'bold' } },
        { content: formatCurrency(verificationSums.bkMieter + verificationSums.hkMieter), styles: { fontStyle: 'bold' } },
        { content: formatCurrency(verificationSums.bkEigentuemer + verificationSums.hkEigentuemer), styles: { fontStyle: 'bold' } },
      ],
    ],
    theme: 'striped',
    headStyles: { fillColor: [59, 130, 246], fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 2 },
    margin: { left: margin, right: margin },
  });

  yPos = (doc as any).lastAutoTable.finalY + 10;

  // Einzelabrechnungen pro Einheit
  doc.setFont('helvetica', 'bold');
  doc.text('Einzelabrechnungen pro Einheit:', margin, yPos);
  yPos += 6;

  const unitTableData: any[][] = units.map(unit => [
    `Top ${unit.top_nummer}`,
    unit.bkMieter || (unit.isLeerstandBK ? 'Eigentümer' : '-'),
    unit.hkMieter || (unit.isLeerstandHK ? 'Eigentümer' : '-'),
    formatCurrency(unit.totalBkCost),
    formatCurrency(unit.hkCost),
    formatCurrency(unit.totalBkCost + unit.hkCost),
    unit.isLeerstandBK && unit.isLeerstandHK ? '-' : formatCurrency(unit.gesamtSaldo),
  ]);

  // Summenzeile
  const sumBk = units.reduce((s, u) => s + u.totalBkCost, 0);
  const sumHk = units.reduce((s, u) => s + u.hkCost, 0);
  const sumGesamt = sumBk + sumHk;
  const sumSaldo = units.filter(u => !u.isLeerstandBK || !u.isLeerstandHK).reduce((s, u) => s + u.gesamtSaldo, 0);

  unitTableData.push([
    { content: 'SUMME', styles: { fontStyle: 'bold' } },
    '',
    '',
    { content: formatCurrency(sumBk), styles: { fontStyle: 'bold' } },
    { content: formatCurrency(sumHk), styles: { fontStyle: 'bold' } },
    { content: formatCurrency(sumGesamt), styles: { fontStyle: 'bold' } },
    { content: formatCurrency(sumSaldo), styles: { fontStyle: 'bold' } },
  ]);

  autoTable(doc, {
    startY: yPos,
    head: [['Einheit', 'BK Mieter', 'HK Mieter', 'BK Anteil', 'HK Anteil', 'Gesamt', 'Saldo']],
    body: unitTableData,
    theme: 'striped',
    headStyles: { fillColor: [59, 130, 246], fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 30 },
      2: { cellWidth: 30 },
      3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 22, halign: 'right' },
      5: { cellWidth: 22, halign: 'right' },
      6: { cellWidth: 22, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  yPos = (doc as any).lastAutoTable.finalY + 10;

  // Kontrollrechnung
  doc.setFont('helvetica', 'bold');
  doc.text('Kontrollrechnung:', margin, yPos);
  yPos += 6;

  autoTable(doc, {
    startY: yPos,
    head: [],
    body: [
      ['Gesamtkosten laut Buchhaltung:', formatCurrency(totalBkKosten + totalHeizkosten)],
      ['Summe verteilte Einzelabrechnungen:', formatCurrency(verificationSums.sumBkVerteilt + verificationSums.sumHkVerteilt)],
      [
        { content: 'Differenz:', styles: { fontStyle: 'bold' } },
        {
          content: formatCurrency(Math.abs((totalBkKosten + totalHeizkosten) - (verificationSums.sumBkVerteilt + verificationSums.sumHkVerteilt))),
          styles: { fontStyle: 'bold' },
        },
      ],
    ],
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 80 },
      1: { cellWidth: 40, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  // Footer
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(128);
  doc.text(`Gesamtbetriebskostenabrechnung ${year} - ${property.name} - Erstellt am ${formatDate(new Date())}`, margin, pageHeight - 10);

  doc.save(`Gesamtabrechnung_${year}_${property.name.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, '_')}.pdf`);
}
