import jsPDF from 'jspdf';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

interface ContractData {
  title: string;
  owner_name: string;
  property_name: string;
  property_address: string;
  start_date: string;
  end_date?: string;
  auto_renew: boolean;
  renewal_months: number;
  notice_period_months: number;
  monthly_fee: number;
  fee_type: string;
  manager_name: string;
  notes?: string;
}

export function generateManagementContractPdf(contract: ContractData): jsPDF {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 25;
  const maxWidth = pageWidth - 2 * margin;
  let y = 30;

  // Title
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('HAUSVERWALTUNGSVERTRAG', pageWidth / 2, y, { align: 'center' });
  y += 15;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');

  // Parties
  doc.setFont('helvetica', 'bold');
  doc.text('Vertragsparteien', margin, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.text(`Auftraggeber (Eigentümer): ${contract.owner_name}`, margin, y);
  y += 5;
  doc.text(`Auftragnehmer (Hausverwaltung): ${contract.manager_name}`, margin, y);
  y += 12;

  // Object
  doc.setFont('helvetica', 'bold');
  doc.text('Verwaltungsobjekt', margin, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.text(`Liegenschaft: ${contract.property_name}`, margin, y);
  y += 5;
  doc.text(`Adresse: ${contract.property_address}`, margin, y);
  y += 12;

  // Duration
  doc.setFont('helvetica', 'bold');
  doc.text('Vertragslaufzeit', margin, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.text(`Beginn: ${format(new Date(contract.start_date), 'dd.MM.yyyy')}`, margin, y);
  y += 5;
  if (contract.end_date) {
    doc.text(`Ende: ${format(new Date(contract.end_date), 'dd.MM.yyyy')}`, margin, y);
    y += 5;
  }
  if (contract.auto_renew) {
    doc.text(`Automatische Verlängerung: Ja, um ${contract.renewal_months} Monate`, margin, y);
    y += 5;
  }
  doc.text(`Kündigungsfrist: ${contract.notice_period_months} Monate`, margin, y);
  y += 12;

  // Fee
  doc.setFont('helvetica', 'bold');
  doc.text('Verwaltungshonorar', margin, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  const feeLabel = contract.fee_type === 'pro_einheit' ? 'pro Einheit/Monat' :
    contract.fee_type === 'pauschal' ? 'pauschal/Monat' : 'prozentual';
  doc.text(`€ ${contract.monthly_fee.toFixed(2)} ${feeLabel} (zzgl. USt)`, margin, y);
  y += 12;

  // Notes
  if (contract.notes) {
    doc.setFont('helvetica', 'bold');
    doc.text('Besondere Vereinbarungen', margin, y);
    y += 7;
    doc.setFont('helvetica', 'normal');
    const noteLines = doc.splitTextToSize(contract.notes, maxWidth);
    doc.text(noteLines, margin, y);
    y += noteLines.length * 5 + 12;
  }

  // Signatures
  y += 10;
  doc.setFont('helvetica', 'normal');
  const dateStr = format(new Date(), 'dd.MM.yyyy', { locale: de });
  doc.text(`Wien, am ${dateStr}`, margin, y);
  y += 20;
  
  doc.line(margin, y, margin + 60, y);
  doc.line(pageWidth - margin - 60, y, pageWidth - margin, y);
  y += 5;
  doc.setFontSize(8);
  doc.text('Auftraggeber', margin, y);
  doc.text('Auftragnehmer', pageWidth - margin - 60, y);

  return doc;
}
