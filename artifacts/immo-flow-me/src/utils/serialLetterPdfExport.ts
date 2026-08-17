import jsPDF from 'jspdf';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

interface Recipient {
  name: string;
  address: string;
  unit: string;
}

interface LetterData {
  subject: string;
  body: string;
  senderName: string;
  senderAddress: string;
  date: string;
}

export function generateSerialLetterPdf(
  recipients: Recipient[],
  letter: LetterData
): jsPDF {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 25;
  const maxWidth = pageWidth - 2 * margin;

  recipients.forEach((recipient, index) => {
    if (index > 0) doc.addPage();

    let y = 30;

    // Sender
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(letter.senderName + ' · ' + letter.senderAddress, margin, y);
    y += 15;

    // Recipient
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text(recipient.name, margin, y);
    y += 5;
    doc.text(recipient.address, margin, y);
    y += 5;
    doc.text(`(${recipient.unit})`, margin, y);
    y += 20;

    // Date
    doc.setFontSize(10);
    doc.text(
      format(new Date(letter.date), 'dd. MMMM yyyy', { locale: de }),
      pageWidth - margin - 50,
      y,
      { align: 'left' }
    );
    y += 15;

    // Subject
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(letter.subject, margin, y);
    y += 10;

    // Body
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    
    // Replace placeholders
    let personalizedBody = letter.body
      .replace(/\{\{name\}\}/g, recipient.name)
      .replace(/\{\{einheit\}\}/g, recipient.unit)
      .replace(/\{\{datum\}\}/g, format(new Date(letter.date), 'dd.MM.yyyy'));

    const lines = doc.splitTextToSize(personalizedBody, maxWidth);
    doc.text(lines, margin, y);
    y += lines.length * 5 + 20;

    // Signature
    doc.text('Mit freundlichen Grüßen', margin, y);
    y += 10;
    doc.text(letter.senderName, margin, y);
  });

  return doc;
}
