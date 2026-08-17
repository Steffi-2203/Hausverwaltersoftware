import { jsPDF } from "jspdf";

export interface VorschreibungData {
  hausverwaltung: { name: string; address: string; tel?: string; email?: string; };
  mieter: { name: string; address: string; };
  liegenschaft: string;
  einheit: string;
  monat: string;
  year: number;
  month: number;
  faelligkeitsdatum: string;
  positionen: Array<{ bezeichnung: string; netto: number; ustSatz: number; ust: number; brutto: number; }>;
  gesamtNetto: number;
  gesamtUst: number;
  gesamtBrutto: number;
  bankverbindung?: { iban: string; bic: string; bank: string; };
  rechnungsnummer: string;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(amount);
}

function formatPercent(rate: number): string {
  return `${rate}%`;
}

export async function generatePdfFromHtml(html: string, _filename: string): Promise<Buffer> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const plainText = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/th>/gi, '\t')
    .replace(/<\/td>/gi, '\t')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const lines = doc.splitTextToSize(plainText, 170);
  let y = 20;
  const pageHeight = 280;

  for (const line of lines) {
    if (y > pageHeight) {
      doc.addPage();
      y = 20;
    }
    doc.text(line, 20, y);
    y += 5;
  }

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}

export async function generateSettlementPdfBuffer(html: string): Promise<Buffer> {
  return generatePdfFromHtml(html, "abrechnung.pdf");
}

export async function generateVorschreibungPdf(data: VorschreibungData): Promise<Buffer> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const leftMargin = 20;
  const rightMargin = 190;
  const contentWidth = rightMargin - leftMargin;
  let y = 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(data.hausverwaltung.name, leftMargin, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(data.hausverwaltung.address, leftMargin, y);
  y += 4;

  const contactParts: string[] = [];
  if (data.hausverwaltung.tel) contactParts.push(`Tel: ${data.hausverwaltung.tel}`);
  if (data.hausverwaltung.email) contactParts.push(`E-Mail: ${data.hausverwaltung.email}`);
  if (contactParts.length > 0) {
    doc.text(contactParts.join("  |  "), leftMargin, y);
    y += 4;
  }

  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.line(leftMargin, y, rightMargin, y);
  y += 12;

  doc.setFontSize(10);
  doc.text(data.mieter.name, leftMargin, y);
  y += 5;
  const addressLines = doc.splitTextToSize(data.mieter.address, 80);
  for (const line of addressLines) {
    doc.text(line, leftMargin, y);
    y += 5;
  }
  y += 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(`Vorschreibung ${data.monat}`, leftMargin, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Rechnungsnummer: ${data.rechnungsnummer}`, leftMargin, y);
  doc.text(`Faellig am: ${data.faelligkeitsdatum}`, rightMargin, y, { align: "right" });
  y += 5;
  doc.text(`Liegenschaft: ${data.liegenschaft}`, leftMargin, y);
  y += 5;
  doc.text(`Einheit: ${data.einheit}`, leftMargin, y);
  y += 10;

  const colX = {
    bezeichnung: leftMargin,
    netto: leftMargin + 70,
    ustSatz: leftMargin + 105,
    ust: leftMargin + 125,
    brutto: rightMargin,
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setFillColor(245, 245, 245);
  doc.rect(leftMargin, y - 4, contentWidth, 7, "F");

  doc.text("Bezeichnung", colX.bezeichnung, y);
  doc.text("Netto", colX.netto, y, { align: "right" });
  doc.text("USt-Satz", colX.ustSatz, y, { align: "right" });
  doc.text("USt", colX.ust, y, { align: "right" });
  doc.text("Brutto", colX.brutto, y, { align: "right" });
  y += 3;
  doc.setLineWidth(0.3);
  doc.line(leftMargin, y, rightMargin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  for (const pos of data.positionen) {
    if (y > 260) {
      doc.addPage();
      y = 20;
    }

    const labelLines = doc.splitTextToSize(pos.bezeichnung, 65);
    doc.text(labelLines, colX.bezeichnung, y);
    doc.text(formatCurrency(pos.netto), colX.netto, y, { align: "right" });
    doc.text(formatPercent(pos.ustSatz), colX.ustSatz, y, { align: "right" });
    doc.text(formatCurrency(pos.ust), colX.ust, y, { align: "right" });
    doc.text(formatCurrency(pos.brutto), colX.brutto, y, { align: "right" });

    const lineHeight = Math.max(labelLines.length * 4, 5);
    y += lineHeight + 1;

    doc.setDrawColor(230);
    doc.setLineWidth(0.1);
    doc.line(leftMargin, y, rightMargin, y);
    y += 4;
  }

  y += 3;
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.line(leftMargin, y, rightMargin, y);
  y += 6;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Summe Netto:", leftMargin + 90, y, { align: "right" });
  doc.text(formatCurrency(data.gesamtNetto), rightMargin, y, { align: "right" });
  y += 5;

  doc.text("Summe USt:", leftMargin + 90, y, { align: "right" });
  doc.text(formatCurrency(data.gesamtUst), rightMargin, y, { align: "right" });
  y += 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Gesamtbetrag:", leftMargin + 90, y, { align: "right" });
  doc.text(formatCurrency(data.gesamtBrutto), rightMargin, y, { align: "right" });
  y += 12;

  if (data.bankverbindung) {
    if (y > 250) {
      doc.addPage();
      y = 20;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Bankverbindung", leftMargin, y);
    y += 5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`IBAN: ${data.bankverbindung.iban}`, leftMargin, y);
    y += 4;
    doc.text(`BIC: ${data.bankverbindung.bic}`, leftMargin, y);
    y += 4;
    doc.text(`Bank: ${data.bankverbindung.bank}`, leftMargin, y);
    y += 4;
    doc.text(`Verwendungszweck: ${data.rechnungsnummer}`, leftMargin, y);
    y += 10;
  }

  const footerY = 282;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(128);
  doc.text(
    "Diese Vorschreibung wurde maschinell erstellt und ist ohne Unterschrift gueltig.",
    105,
    footerY,
    { align: "center" }
  );
  doc.setTextColor(0);

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}
