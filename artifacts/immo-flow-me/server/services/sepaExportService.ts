import { db } from "../db";
import { tenants, units, properties, monthlyInvoices, bankAccounts, sepaCollections } from "@shared/schema";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { format } from "date-fns";
import { logger } from "../lib/logger";
import { decryptField } from "../lib/fieldEncryption";

interface SepaPayment {
  id: string;
  tenantId: string;
  tenantName: string;
  iban: string;
  bic: string;
  amount: number;
  reference: string;
  endToEndId: string;
}

interface SepaTransfer {
  id: string;
  recipientName: string;
  iban: string;
  bic: string;
  amount: number;
  reference: string;
  endToEndId: string;
}

/**
 * Audit-Befund M1: IBAN, BIC, Mandatsdatum und Verwendungszweck wurden
 * ungeprüft in das XML interpoliert. Fehlerhafte Werte hätten zu einer von
 * der Bank abgelehnten Datei geführt — im schlimmsten Fall erst nach dem
 * Einreichen. Diese Helfer validieren strikt vor dem Erzeugen.
 */
const IBAN_RE = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;
const BIC_RE = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Zeichenvorrat nach EPC-Rulebook (SEPA "Latin character set"). */
const SEPA_ALLOWED_RE = /[^A-Za-z0-9/\-?:().,'+ ]/g;

export function normalizeIban(value: string, label: string): string {
  const iban = (value || '').replace(/\s/g, '').toUpperCase();
  if (!IBAN_RE.test(iban)) {
    throw new Error(`${label}: ungültige IBAN (${value || 'leer'})`);
  }
  return iban;
}

export function normalizeBic(value: string | null | undefined, label: string): string {
  const bic = (value || '').replace(/\s/g, '').toUpperCase();
  if (!bic) return 'NOTPROVIDED';
  if (!BIC_RE.test(bic)) {
    throw new Error(`${label}: ungültiger BIC (${value})`);
  }
  return bic;
}

export function normalizeIsoDate(value: string | null | undefined, fallback: string): string {
  if (value && ISO_DATE_RE.test(value)) return value;
  return fallback;
}

export class SepaExportService {
  private escapeXml(str: string): string {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /** Für Felder, die die Bank nur im SEPA-Zeichensatz akzeptiert. */
  private sepaText(str: string, maxLength = 140): string {
    const replaced = String(str ?? '')
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
      .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
      .replace(/ß/g, 'ss')
      .replace(SEPA_ALLOWED_RE, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
    return this.escapeXml(replaced);
  }

  private formatAmount(amount: number): string {
    // Beträge in Cent runden, bevor sie in die Datei gehen
    return (Math.round(Number(amount) * 100) / 100).toFixed(2);
  }

  private generateMessageId(): string {
    return `MSG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`.toUpperCase();
  }

  private generateEndToEndId(tenantId: string, invoiceMonth: number, invoiceYear: number): string {
    return `E2E-${invoiceYear}${String(invoiceMonth).padStart(2, '0')}-${tenantId.substr(0, 8)}`.toUpperCase();
  }


  async generateDirectDebitXml(
    organizationId: string,
    creditorName: string,
    creditorIban: string,
    creditorBic: string,
    creditorId: string,
    invoiceIds: string[]
  ): Promise<string> {
    const invoicesData = await db.select({
      invoice: monthlyInvoices,
      tenant: tenants,
      unit: units,
      property: properties,
    })
      .from(monthlyInvoices)
      .innerJoin(tenants, eq(monthlyInvoices.tenantId, tenants.id))
      .innerJoin(units, eq(tenants.unitId, units.id))
      .innerJoin(properties, eq(units.propertyId, properties.id))
      .where(and(
        inArray(monthlyInvoices.id, invoiceIds),
        eq(properties.organizationId, organizationId)
      ));

    // Audit-Befund M1: Bankdaten vor dem Export validieren statt die Datei
    // von der Bank ablehnen zu lassen. Fehlerhafte Datensätze werden mit
    // Namen gemeldet, damit sie gezielt korrigiert werden können.
    const rejected: string[] = [];
    const payments: SepaPayment[] = [];

    for (const d of invoicesData) {
      const tenantName = `${d.tenant.firstName || ''} ${d.tenant.lastName || ''}`.trim() || 'Unbekannt';
      // Audit-Befund M3: Bei teilbezahlten Rechnungen (status='teilbezahlt')
      // muss der offene Restbetrag (gesamtbetrag - paidAmount) eingezogen werden,
      // nicht der volle Rechnungsbetrag. Andernfalls würde der bereits geleistete
      // Teilbetrag ein zweites Mal belastet.
      const invoiceTotal = Number(d.invoice.gesamtbetrag) || 0;
      const paidAmount = Number(d.invoice.paidAmount) || 0;
      const amount = Math.max(0, Math.round((invoiceTotal - paidAmount) * 100) / 100);

      if (amount <= 0) {
        rejected.push(`${tenantName}: Betrag ist ${amount.toFixed(2)} EUR`);
        continue;
      }

      let iban: string;
      let bic: string;
      try {
        iban = normalizeIban(decryptField(d.tenant.iban) || '', tenantName);
        bic = normalizeBic(decryptField(d.tenant.bic), tenantName);
      } catch (err: any) {
        rejected.push(err.message);
        continue;
      }

      if (!d.tenant.sepaMandatDatum) {
        rejected.push(`${tenantName}: SEPA-Mandatsdatum fehlt`);
        continue;
      }

      payments.push({
        id: d.invoice.id,
        tenantId: d.tenant.id,
        tenantName,
        iban,
        bic,
        amount,
        reference: `Miete ${d.invoice.month}/${d.invoice.year} - ${d.property.name} ${d.unit.topNummer}`,
        endToEndId: this.generateEndToEndId(d.tenant.id, d.invoice.month, d.invoice.year),
      });
    }

    if (payments.length === 0) {
      throw new Error(
        `Keine gültigen Lastschriften gefunden. Ursachen: ${rejected.join('; ') || 'keine Rechnungen ausgewählt'}`
      );
    }

    const normalizedCreditorIban = normalizeIban(creditorIban, 'Gläubigerkonto');
    const normalizedCreditorBic = normalizeBic(creditorBic, 'Gläubigerbank');
    if (rejected.length > 0) {
      logger.warn(`[SEPA] ${rejected.length} Datensätze übersprungen: ${rejected.join('; ')}`);
    }

    const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);
    const messageId = this.generateMessageId();
    const creationDateTime = new Date().toISOString();
    const collectionDate = new Date();
    collectionDate.setDate(collectionDate.getDate() + 5);
    const requestedCollectionDate = format(collectionDate, 'yyyy-MM-dd');

    return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrDrctDbtInitn>
    <GrpHdr>
      <MsgId>${this.escapeXml(messageId)}</MsgId>
      <CreDtTm>${creationDateTime}</CreDtTm>
      <NbOfTxs>${payments.length}</NbOfTxs>
      <CtrlSum>${this.formatAmount(totalAmount)}</CtrlSum>
      <InitgPty>
        <Nm>${this.sepaText(creditorName, 70)}</Nm>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${this.escapeXml(messageId)}-1</PmtInfId>
      <PmtMtd>DD</PmtMtd>
      <NbOfTxs>${payments.length}</NbOfTxs>
      <CtrlSum>${this.formatAmount(totalAmount)}</CtrlSum>
      <PmtTpInf>
        <SvcLvl>
          <Cd>SEPA</Cd>
        </SvcLvl>
        <LclInstrm>
          <Cd>CORE</Cd>
        </LclInstrm>
        <SeqTp>RCUR</SeqTp>
      </PmtTpInf>
      <ReqdColltnDt>${requestedCollectionDate}</ReqdColltnDt>
      <Cdtr>
        <Nm>${this.sepaText(creditorName, 70)}</Nm>
      </Cdtr>
      <CdtrAcct>
        <Id>
          <IBAN>${normalizedCreditorIban}</IBAN>
        </Id>
      </CdtrAcct>
      <CdtrAgt>
        <FinInstnId>
          <BIC>${normalizedCreditorBic}</BIC>
        </FinInstnId>
      </CdtrAgt>
      <ChrgBr>SLEV</ChrgBr>
      <CdtrSchmeId>
        <Id>
          <PrvtId>
            <Othr>
              <Id>${this.escapeXml(creditorId)}</Id>
              <SchmeNm>
                <Prtry>SEPA</Prtry>
              </SchmeNm>
            </Othr>
          </PrvtId>
        </Id>
      </CdtrSchmeId>
${payments.map(p => `      <DrctDbtTxInf>
        <PmtId>
          <EndToEndId>${this.escapeXml(p.endToEndId)}</EndToEndId>
        </PmtId>
        <InstdAmt Ccy="EUR">${this.formatAmount(p.amount)}</InstdAmt>
        <DrctDbtTx>
          <MndtRltdInf>
            <MndtId>MNDT-${p.tenantId.substr(0, 16)}</MndtId>
            <DtOfSgntr>${normalizeIsoDate(
              invoicesData.find(d => d.tenant.id === p.tenantId)?.tenant.sepaMandatDatum as string | undefined,
              format(new Date(), 'yyyy-MM-dd')
            )}</DtOfSgntr>
          </MndtRltdInf>
        </DrctDbtTx>
        <DbtrAgt>
          <FinInstnId>
            <BIC>${p.bic}</BIC>
          </FinInstnId>
        </DbtrAgt>
        <Dbtr>
          <Nm>${this.sepaText(p.tenantName, 70)}</Nm>
        </Dbtr>
        <DbtrAcct>
          <Id>
            <IBAN>${p.iban}</IBAN>
          </Id>
        </DbtrAcct>
        <RmtInf>
          <Ustrd>${this.sepaText(p.reference, 140)}</Ustrd>
        </RmtInf>
      </DrctDbtTxInf>`).join('\n')}
    </PmtInf>
  </CstmrDrctDbtInitn>
</Document>`;
  }

  async generateCreditTransferXml(
    organizationId: string,
    debtorName: string,
    debtorIban: string,
    debtorBic: string,
    transfers: SepaTransfer[]
  ): Promise<string> {
    if (transfers.length === 0) {
      throw new Error('Keine Überweisungen angegeben');
    }

    // Audit-Befund M1: Empfängerdaten strikt validieren (siehe Lastschrift).
    const validated: SepaTransfer[] = transfers.map((t) => {
      const label = t.recipientName || 'Empfänger';
      if (!(Number(t.amount) > 0)) {
        throw new Error(`${label}: Überweisungsbetrag muss größer als 0 sein`);
      }
      return {
        ...t,
        iban: normalizeIban(t.iban, label),
        bic: normalizeBic(t.bic, label),
      };
    });

    const normalizedDebtorIban = normalizeIban(debtorIban, 'Auftraggeberkonto');
    const normalizedDebtorBic = normalizeBic(debtorBic, 'Auftraggeberbank');

    const totalAmount = validated.reduce((sum, t) => sum + t.amount, 0);
    const messageId = this.generateMessageId();
    const creationDateTime = new Date().toISOString();
    const requestedExecutionDate = format(new Date(), 'yyyy-MM-dd');

    return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${this.escapeXml(messageId)}</MsgId>
      <CreDtTm>${creationDateTime}</CreDtTm>
      <NbOfTxs>${transfers.length}</NbOfTxs>
      <CtrlSum>${this.formatAmount(totalAmount)}</CtrlSum>
      <InitgPty>
        <Nm>${this.sepaText(debtorName, 70)}</Nm>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${this.escapeXml(messageId)}-1</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <NbOfTxs>${transfers.length}</NbOfTxs>
      <CtrlSum>${this.formatAmount(totalAmount)}</CtrlSum>
      <PmtTpInf>
        <SvcLvl>
          <Cd>SEPA</Cd>
        </SvcLvl>
      </PmtTpInf>
      <ReqdExctnDt>${requestedExecutionDate}</ReqdExctnDt>
      <Dbtr>
        <Nm>${this.sepaText(debtorName, 70)}</Nm>
      </Dbtr>
      <DbtrAcct>
        <Id>
          <IBAN>${normalizedDebtorIban}</IBAN>
        </Id>
      </DbtrAcct>
      <DbtrAgt>
        <FinInstnId>
          <BIC>${normalizedDebtorBic}</BIC>
        </FinInstnId>
      </DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
${validated.map(t => `      <CdtTrfTxInf>
        <PmtId>
          <EndToEndId>${this.escapeXml(t.endToEndId)}</EndToEndId>
        </PmtId>
        <Amt>
          <InstdAmt Ccy="EUR">${this.formatAmount(t.amount)}</InstdAmt>
        </Amt>
        <CdtrAgt>
          <FinInstnId>
            <BIC>${t.bic}</BIC>
          </FinInstnId>
        </CdtrAgt>
        <Cdtr>
          <Nm>${this.sepaText(t.recipientName, 70)}</Nm>
        </Cdtr>
        <CdtrAcct>
          <Id>
            <IBAN>${t.iban}</IBAN>
          </Id>
        </CdtrAcct>
        <RmtInf>
          <Ustrd>${this.sepaText(t.reference, 140)}</Ustrd>
        </RmtInf>
      </CdtTrfTxInf>`).join('\n')}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>`;
  }
}

export const sepaExportService = new SepaExportService();
