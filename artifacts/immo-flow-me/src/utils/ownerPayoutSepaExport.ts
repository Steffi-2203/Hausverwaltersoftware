import { format } from 'date-fns';

interface SepaPayoutData {
  organizationName: string;
  organizationIban: string;
  organizationBic: string;
  ownerName: string;
  ownerIban: string;
  ownerBic?: string;
  amount: number;
  reference: string;
  executionDate?: Date;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function generateOwnerPayoutSepa(payouts: SepaPayoutData[]): string {
  const msgId = `PAYOUT-${format(new Date(), 'yyyyMMdd-HHmmss')}`;
  const pmtInfId = `PMT-${format(new Date(), 'yyyyMMddHHmmss')}`;
  const creationDate = format(new Date(), "yyyy-MM-dd'T'HH:mm:ss");
  const executionDate = format(payouts[0]?.executionDate || new Date(), 'yyyy-MM-dd');

  const totalAmount = payouts.reduce((sum, p) => sum + p.amount, 0);
  const orgName = payouts[0]?.organizationName || 'Hausverwaltung';
  const orgIban = payouts[0]?.organizationIban || '';
  const orgBic = payouts[0]?.organizationBic || '';

  const transactions = payouts.map(p => `
        <CdtTrfTxInf>
          <PmtId>
            <EndToEndId>${escapeXml(p.reference.substring(0, 35))}</EndToEndId>
          </PmtId>
          <Amt>
            <InstdAmt Ccy="EUR">${p.amount.toFixed(2)}</InstdAmt>
          </Amt>
          ${p.ownerBic ? `<CdtrAgt><FinInstnId><BIC>${escapeXml(p.ownerBic)}</BIC></FinInstnId></CdtrAgt>` : ''}
          <Cdtr>
            <Nm>${escapeXml(p.ownerName.substring(0, 70))}</Nm>
          </Cdtr>
          <CdtrAcct>
            <Id><IBAN>${escapeXml(p.ownerIban.replace(/\s/g, ''))}</IBAN></Id>
          </CdtrAcct>
          <RmtInf>
            <Ustrd>${escapeXml(p.reference.substring(0, 140))}</Ustrd>
          </RmtInf>
        </CdtTrfTxInf>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${escapeXml(msgId)}</MsgId>
      <CreDtTm>${creationDate}</CreDtTm>
      <NbOfTxs>${payouts.length}</NbOfTxs>
      <CtrlSum>${totalAmount.toFixed(2)}</CtrlSum>
      <InitgPty>
        <Nm>${escapeXml(orgName.substring(0, 70))}</Nm>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${escapeXml(pmtInfId)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <NbOfTxs>${payouts.length}</NbOfTxs>
      <CtrlSum>${totalAmount.toFixed(2)}</CtrlSum>
      <PmtTpInf>
        <SvcLvl><Cd>SEPA</Cd></SvcLvl>
      </PmtTpInf>
      <ReqdExctnDt>${executionDate}</ReqdExctnDt>
      <Dbtr>
        <Nm>${escapeXml(orgName.substring(0, 70))}</Nm>
      </Dbtr>
      <DbtrAcct>
        <Id><IBAN>${escapeXml(orgIban.replace(/\s/g, ''))}</IBAN></Id>
      </DbtrAcct>
      ${orgBic ? `<DbtrAgt><FinInstnId><BIC>${escapeXml(orgBic)}</BIC></FinInstnId></DbtrAgt>` : '<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>'}
${transactions}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>`;
}

export function downloadOwnerPayoutSepa(payouts: SepaPayoutData[]): void {
  const xml = generateOwnerPayoutSepa(payouts);
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Eigentuemer-Auszahlung_${format(new Date(), 'yyyy-MM-dd')}.xml`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
