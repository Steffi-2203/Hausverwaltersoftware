/**
 * SEPA Direct Debit XML Export (ISO 20022 pain.008.003.02)
 * Generates SEPA-XML files for Austrian banks
 */

export interface SepaCreditor {
  name: string;
  iban: string;
  bic: string;
  creditorId: string; // SEPA Gläubiger-ID
}

export interface SepaDebtor {
  id: string;
  name: string;
  iban: string;
  bic: string;
  mandateId: string;
  mandateDate: string; // ISO date when mandate was signed
  amount: number;
  remittanceInfo: string; // Verwendungszweck
}

export interface SepaExportOptions {
  creditor: SepaCreditor;
  debtors: SepaDebtor[];
  collectionDate: string; // ISO date for collection
  batchBooking: boolean; // true = single booking, false = individual bookings
}

/**
 * Generates a unique message ID for the SEPA file
 */
export function generateMessageId(): string {
  const now = new Date();
  const dateStr = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `IMMOFLOW-${dateStr}-${random}`;
}

/**
 * Generates a payment information ID
 */
function generatePaymentInfoId(): string {
  const now = new Date();
  const dateStr = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  return `PMT-${dateStr}`;
}

/**
 * Formats IBAN by removing spaces
 */
function formatIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}

/**
 * Escapes XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Truncates string to max length (SEPA has field length limits)
 */
function truncate(str: string, maxLength: number): string {
  return str.length > maxLength ? str.slice(0, maxLength) : str;
}

/**
 * Formats amount to 2 decimal places string
 */
function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

/**
 * Formats date to SEPA format (YYYY-MM-DD)
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toISOString().split('T')[0];
}

/**
 * Formats datetime to SEPA format (YYYY-MM-DDTHH:MM:SS)
 */
function formatDateTime(): string {
  return new Date().toISOString().slice(0, 19);
}

/**
 * Generates SEPA Direct Debit XML (pain.008.003.02)
 */
export function generateSepaXml(options: SepaExportOptions): string {
  const { creditor, debtors, collectionDate, batchBooking } = options;
  
  if (debtors.length === 0) {
    throw new Error('Keine Lastschriften zum Exportieren');
  }

  // IBAN-Prüfziffer-Validierung vor XML-Generierung
  const ibanErrors = validateSepaOptions(options);
  if (ibanErrors.length > 0) {
    throw new Error(`SEPA-Export abgebrochen — ungültige IBANs:\n${ibanErrors.join('\n')}`);
  }

  const messageId = generateMessageId();
  const paymentInfoId = generatePaymentInfoId();
  const creationDateTime = formatDateTime();
  const numberOfTransactions = debtors.length;
  const controlSum = debtors.reduce((sum, d) => sum + d.amount, 0);
  const formattedCollectionDate = formatDate(collectionDate);

  // Build individual transaction entries
  const transactionEntries = debtors.map((debtor, index) => `
      <DrctDbtTxInf>
        <PmtId>
          <EndToEndId>${escapeXml(truncate(`${paymentInfoId}-${index + 1}`, 35))}</EndToEndId>
        </PmtId>
        <InstdAmt Ccy="EUR">${formatAmount(debtor.amount)}</InstdAmt>
        <DrctDbtTx>
          <MndtRltdInf>
            <MndtId>${escapeXml(truncate(debtor.mandateId, 35))}</MndtId>
            <DtOfSgntr>${formatDate(debtor.mandateDate)}</DtOfSgntr>
          </MndtRltdInf>
        </DrctDbtTx>
        <DbtrAgt>
          <FinInstnId>
            <BIC>${escapeXml(formatIban(debtor.bic))}</BIC>
          </FinInstnId>
        </DbtrAgt>
        <Dbtr>
          <Nm>${escapeXml(truncate(debtor.name, 70))}</Nm>
        </Dbtr>
        <DbtrAcct>
          <Id>
            <IBAN>${formatIban(debtor.iban)}</IBAN>
          </Id>
        </DbtrAcct>
        <RmtInf>
          <Ustrd>${escapeXml(truncate(debtor.remittanceInfo, 140))}</Ustrd>
        </RmtInf>
      </DrctDbtTxInf>`).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.003.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrDrctDbtInitn>
    <GrpHdr>
      <MsgId>${escapeXml(messageId)}</MsgId>
      <CreDtTm>${creationDateTime}</CreDtTm>
      <NbOfTxs>${numberOfTransactions}</NbOfTxs>
      <CtrlSum>${formatAmount(controlSum)}</CtrlSum>
      <InitgPty>
        <Nm>${escapeXml(truncate(creditor.name, 70))}</Nm>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${escapeXml(paymentInfoId)}</PmtInfId>
      <PmtMtd>DD</PmtMtd>
      <BtchBookg>${batchBooking}</BtchBookg>
      <NbOfTxs>${numberOfTransactions}</NbOfTxs>
      <CtrlSum>${formatAmount(controlSum)}</CtrlSum>
      <PmtTpInf>
        <SvcLvl>
          <Cd>SEPA</Cd>
        </SvcLvl>
        <LclInstrm>
          <Cd>CORE</Cd>
        </LclInstrm>
        <SeqTp>RCUR</SeqTp>
      </PmtTpInf>
      <ReqdColltnDt>${formattedCollectionDate}</ReqdColltnDt>
      <Cdtr>
        <Nm>${escapeXml(truncate(creditor.name, 70))}</Nm>
      </Cdtr>
      <CdtrAcct>
        <Id>
          <IBAN>${formatIban(creditor.iban)}</IBAN>
        </Id>
      </CdtrAcct>
      <CdtrAgt>
        <FinInstnId>
          <BIC>${escapeXml(creditor.bic)}</BIC>
        </FinInstnId>
      </CdtrAgt>
      <CdtrSchmeId>
        <Id>
          <PrvtId>
            <Othr>
              <Id>${escapeXml(creditor.creditorId)}</Id>
              <SchmeNm>
                <Prtry>SEPA</Prtry>
              </SchmeNm>
            </Othr>
          </PrvtId>
        </Id>
      </CdtrSchmeId>${transactionEntries}
    </PmtInf>
  </CstmrDrctDbtInitn>
</Document>`;

  return xml;
}

/**
 * Downloads the SEPA XML file
 */
export function downloadSepaXml(xml: string, filename?: string): void {
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || `SEPA-Lastschrift-${new Date().toISOString().slice(0, 10)}.xml`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

import { validateIban } from './ibanValidator';

/**
 * Validates SEPA creditor data (inkl. Modulo-97-Prüfziffer-Validierung)
 */
export function validateCreditor(creditor: Partial<SepaCreditor>): string[] {
  const errors: string[] = [];
  
  if (!creditor.name?.trim()) {
    errors.push('Firmenname ist erforderlich');
  }
  if (!creditor.iban?.trim()) {
    errors.push('IBAN ist erforderlich');
  } else {
    const ibanResult = validateIban(creditor.iban);
    if (!ibanResult.valid) {
      errors.push(ibanResult.error ?? 'Gläubiger-IBAN ist ungültig');
    }
  }
  if (!creditor.bic?.trim()) {
    errors.push('BIC ist erforderlich');
  } else if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/i.test(creditor.bic.replace(/\s/g, ''))) {
    errors.push('BIC ist ungültig');
  }
  if (!creditor.creditorId?.trim()) {
    errors.push('Gläubiger-ID ist erforderlich');
  }
  
  return errors;
}

/**
 * Validates SEPA debtor data (inkl. Modulo-97-Prüfziffer-Validierung)
 */
export function validateDebtor(debtor: Partial<SepaDebtor>): string[] {
  const errors: string[] = [];
  
  if (!debtor.name?.trim()) {
    errors.push('Name ist erforderlich');
  }
  if (!debtor.iban?.trim()) {
    errors.push('IBAN ist erforderlich');
  } else {
    const ibanResult = validateIban(debtor.iban);
    if (!ibanResult.valid) {
      errors.push(ibanResult.error ?? `Schuldner-IBAN ist ungültig: ${debtor.iban}`);
    }
  }
  if (!debtor.mandateId?.trim()) {
    errors.push('Mandatsreferenz ist erforderlich');
  }
  if (!debtor.amount || debtor.amount <= 0) {
    errors.push('Betrag muss größer als 0 sein');
  }
  
  return errors;
}

/**
 * Validiert alle IBANs in einem SepaExportOptions-Objekt vor dem Export.
 * Gibt eine Liste von Fehlern zurück; bei leerem Array ist alles gültig.
 */
export function validateSepaOptions(options: SepaExportOptions): string[] {
  const errors: string[] = [];
  
  // Gläubiger-IBAN
  const creditorIbanResult = validateIban(options.creditor.iban);
  if (!creditorIbanResult.valid) {
    errors.push(`Gläubiger-IBAN ungültig: ${creditorIbanResult.error}`);
  }
  
  // Schuldner-IBANs
  for (const debtor of options.debtors) {
    const debtorIbanResult = validateIban(debtor.iban);
    if (!debtorIbanResult.valid) {
      errors.push(`Schuldner "${debtor.name}": ${debtorIbanResult.error}`);
    }
  }
  
  return errors;
}
