import { XMLParser } from "fast-xml-parser";

export interface CamtTransaction {
  amount: number;
  currency: string;
  creditDebit: 'CRDT' | 'DBIT';
  bookingDate: string;
  valueDate: string;
  remittanceInfo: string;
  counterpartyName: string;
  counterpartyIban: string;
  endToEndId?: string;
  mandateId?: string;
}

export interface CamtImportResult {
  accountIban: string;
  statementId: string;
  transactions: CamtTransaction[];
  openingBalance: number;
  closingBalance: number;
  importedCount: number;
}

function getTextValue(obj: any): string {
  if (obj === null || obj === undefined) return '';
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number') return String(obj);
  if (typeof obj === 'object' && '#text' in obj) return String(obj['#text']);
  return String(obj);
}

function ensureArray<T>(val: T | T[] | undefined | null): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

function extractBalance(balances: any[], code: string): number {
  for (const bal of balances) {
    const tp = bal?.Tp?.CdOrPrtry?.Cd || bal?.Tp?.CdOrPrtry;
    if (getTextValue(tp) === code) {
      const amt = parseFloat(getTextValue(bal?.Amt)) || 0;
      const cdtDbt = getTextValue(bal?.CdtDbtInd);
      return cdtDbt === 'DBIT' ? -amt : amt;
    }
  }
  return 0;
}

export function parseCamt053(xmlContent: string): CamtImportResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    isArray: (name) => {
      return ['Ntry', 'TxDtls', 'Bal', 'Stmt', 'Ustrd'].includes(name);
    },
  });

  const parsed = parser.parse(xmlContent);

  const doc = parsed?.Document || parsed?.BkToCstmrStmt || parsed;
  const bkToCstmrStmt = doc?.BkToCstmrStmt || doc;

  const statements = ensureArray(bkToCstmrStmt?.Stmt);
  if (statements.length === 0) {
    throw new Error('Keine Kontoauszüge (Stmt) im CAMT.053 gefunden');
  }

  const stmt = statements[0];

  const accountIban = getTextValue(
    stmt?.Acct?.Id?.IBAN
  );
  const statementId = getTextValue(stmt?.Id) || getTextValue(stmt?.ElctrncSeqNb) || 'unknown';

  const balances = ensureArray(stmt?.Bal);
  const openingBalance = extractBalance(balances, 'OPBD') || extractBalance(balances, 'PRCD');
  const closingBalance = extractBalance(balances, 'CLBD') || extractBalance(balances, 'CLAV');

  const entries = ensureArray(stmt?.Ntry);
  const transactions: CamtTransaction[] = [];

  for (const entry of entries) {
    const amount = parseFloat(getTextValue(entry?.Amt)) || 0;
    const currency = entry?.Amt?.['@_Ccy'] || 'EUR';
    const creditDebit = getTextValue(entry?.CdtDbtInd) as 'CRDT' | 'DBIT';
    const bookingDate = getTextValue(entry?.BookgDt?.Dt) || getTextValue(entry?.BookgDt?.DtTm)?.substring(0, 10) || '';
    const valueDate = getTextValue(entry?.ValDt?.Dt) || getTextValue(entry?.ValDt?.DtTm)?.substring(0, 10) || '';

    const ntryDtls = entry?.NtryDtls;
    const txDtlsList = ensureArray(ntryDtls?.TxDtls);

    if (txDtlsList.length === 0) {
      const remittanceInfo = getTextValue(entry?.AddtlNtryInf) || '';
      transactions.push({
        amount,
        currency,
        creditDebit: creditDebit === 'CRDT' || creditDebit === 'DBIT' ? creditDebit : 'CRDT',
        bookingDate,
        valueDate,
        remittanceInfo,
        counterpartyName: '',
        counterpartyIban: '',
      });
      continue;
    }

    for (const txDtls of txDtlsList) {
      const rmtInf = txDtls?.RmtInf;
      const ustrdArr = ensureArray(rmtInf?.Ustrd);
      const remittanceInfo = ustrdArr.map((u: any) => getTextValue(u)).join(' ') || getTextValue(rmtInf?.Strd?.CdtrRefInf?.Ref) || '';

      const rltdPties = txDtls?.RltdPties;
      let counterpartyName = '';
      let counterpartyIban = '';

      if (creditDebit === 'CRDT') {
        counterpartyName = getTextValue(rltdPties?.Dbtr?.Nm) || getTextValue(rltdPties?.Dbtr?.Pty?.Nm) || '';
        counterpartyIban = getTextValue(rltdPties?.DbtrAcct?.Id?.IBAN) || '';
      } else {
        counterpartyName = getTextValue(rltdPties?.Cdtr?.Nm) || getTextValue(rltdPties?.Cdtr?.Pty?.Nm) || '';
        counterpartyIban = getTextValue(rltdPties?.CdtrAcct?.Id?.IBAN) || '';
      }

      if (!counterpartyName) {
        counterpartyName = getTextValue(rltdPties?.Dbtr?.Nm) || getTextValue(rltdPties?.Cdtr?.Nm) || '';
      }
      if (!counterpartyIban) {
        counterpartyIban = getTextValue(rltdPties?.DbtrAcct?.Id?.IBAN) || getTextValue(rltdPties?.CdtrAcct?.Id?.IBAN) || '';
      }

      const refs = txDtls?.Refs;
      const endToEndId = getTextValue(refs?.EndToEndId) || undefined;
      const mandateId = getTextValue(refs?.MndtId) || getTextValue(txDtls?.DrctDbtTxInf?.MndtRltdInf?.MndtId) || undefined;

      transactions.push({
        amount: txDtlsList.length > 1 ? (parseFloat(getTextValue(txDtls?.Amt)) || amount) : amount,
        currency,
        creditDebit: creditDebit === 'CRDT' || creditDebit === 'DBIT' ? creditDebit : 'CRDT',
        bookingDate,
        valueDate,
        remittanceInfo,
        counterpartyName,
        counterpartyIban,
        endToEndId: endToEndId === 'NOTPROVIDED' ? undefined : endToEndId,
        mandateId: mandateId === 'NOTPROVIDED' ? undefined : mandateId,
      });
    }
  }

  return {
    accountIban,
    statementId,
    transactions,
    openingBalance,
    closingBalance,
    importedCount: transactions.length,
  };
}
